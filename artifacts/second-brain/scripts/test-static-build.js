const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const staticRoot = path.join(projectRoot, 'static-build');
const serverScript = path.join(projectRoot, 'server', 'serve.js');
const platforms = ['android', 'ios'];
const metroUrlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i;

function fail(message) {
  throw new Error(`[static-build] ${message}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(origin, child) {
  let lastError = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${origin}/`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const details = lastError ? `: ${lastError.message}` : '';
  fail(`static server did not become ready${details}`);
}

async function fetchLocal(origin, remoteUrl, label) {
  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    fail(`${label} is not a valid URL: ${remoteUrl}`);
  }

  if (metroUrlPattern.test(remoteUrl)) {
    fail(`${label} still points at Metro: ${remoteUrl}`);
  }

  const localUrl = `${origin}${parsed.pathname}${parsed.search}`;
  let response;
  try {
    response = await fetch(localUrl, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    fail(`${label} could not be fetched from ${localUrl}: ${error.message}`);
  }

  if (!response.ok) {
    fail(`${label} returned HTTP ${response.status} at ${localUrl}`);
  }

  return response;
}

function readManifest(platform) {
  const manifestPath = path.join(staticRoot, platform, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fail(`${platform} manifest is missing: ${manifestPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`${platform} manifest is not valid JSON: ${error.message}`);
  }
}

async function checkPlatform(platform, origin) {
  const manifest = readManifest(platform);
  if (!manifest.launchAsset?.url) {
    fail(`${platform} manifest has no launchAsset.url`);
  }

  const manifestResponse = await fetch(`${origin}/manifest`, {
    headers: { 'expo-platform': platform },
    signal: AbortSignal.timeout(5_000),
  });
  if (!manifestResponse.ok) {
    fail(`${platform} manifest endpoint returned HTTP ${manifestResponse.status}`);
  }

  const bundleResponse = await fetchLocal(
    origin,
    manifest.launchAsset.url,
    `${platform} launch bundle`,
  );
  const bundle = await bundleResponse.text();

  if (metroUrlPattern.test(bundle)) {
    fail(`${platform} launch bundle contains a Metro URL`);
  }

  const bundleAssetUrls = [
    ...bundle.matchAll(
      /httpServerLocation:"([^"]+)"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"/g,
    ),
  ].map((match) => `${match[1]}/${match[2]}.${match[3]}`);
  const assetUrls = new Set([
    ...bundleAssetUrls,
    ...(manifest.assets || []).map((asset) => asset.url).filter(Boolean),
  ]);

  for (const assetUrl of assetUrls) {
    await fetchLocal(origin, assetUrl, `${platform} asset ${assetUrl}`);
  }

  console.log(
    `${platform}: manifest, launch bundle, and ${assetUrls.size} asset URL(s) reachable`,
  );
}

async function main() {
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(origin, child);
    for (const platform of platforms) {
      await checkPlatform(platform, origin);
    }
    console.log('Static Expo artifact smoke check passed.');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    if (child.exitCode && child.exitCode !== 0 && stderr) {
      console.error(stderr.trim());
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});