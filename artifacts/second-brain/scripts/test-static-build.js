const assert = require('node:assert/strict');
const os = require('node:os');
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
      if (response.status > 0) return;
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

async function runSmokeCheck() {
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

async function checkHealthFixture(label, staticRoot, expectedStatus, expectedHttpStatus) {
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), STATIC_BUILD_ROOT: staticRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(origin, child);
    const response = await fetch(`${origin}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.json();

    assert.equal(response.status, expectedHttpStatus, `${label} HTTP status`);
    assert.equal(body.status, expectedStatus, `${label} health status`);
    assert.ok(body.manifests?.android, `${label} Android manifest status`);
    assert.ok(body.manifests?.ios, `${label} iOS manifest status`);

    if (expectedStatus === 'ready') {
      assert.equal(body.manifests.android.status, 'ready');
      assert.equal(body.manifests.ios.status, 'ready');
    }
    console.log(`${label}: /health returned ${body.status}`);
  } catch (error) {
    fail(`${label} health check failed: ${error.message}`);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    if (child.exitCode && child.exitCode !== 0 && stderr) {
      console.error(stderr.trim());
    }
  }
}

async function runHealthCheck() {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'second-brain-static-health-'),
  );
  const missingRoot = path.join(fixtureRoot, 'missing');
  const incompleteRoot = path.join(fixtureRoot, 'incomplete');
  const readyRoot = path.join(fixtureRoot, 'ready');

  fs.mkdirSync(incompleteRoot, { recursive: true });
  fs.writeFileSync(
    path.join(incompleteRoot, '.build-incomplete'),
    'fixture build is incomplete\n',
  );

  for (const platform of platforms) {
    fs.mkdirSync(path.join(readyRoot, platform), { recursive: true });
    fs.writeFileSync(
      path.join(readyRoot, platform, 'manifest.json'),
      JSON.stringify({ launchAsset: { url: `https://example.test/${platform}.js` } }),
    );
  }

  try {
    await checkHealthFixture('missing static output', missingRoot, 'missing', 503);
    await checkHealthFixture('incomplete static output', incompleteRoot, 'incomplete', 503);
    await checkHealthFixture('ready static output', readyRoot, 'ready', 200);
    console.log('Static Expo health check passed.');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function runBuildFailure(stage) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'build.js')], {
      cwd: projectRoot,
      env: { ...process.env, SECOND_BRAIN_BUILD_FAILURE: stage },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, output }));
  });
}

async function runFailureCheck() {
  const backupRoot = `${staticRoot}.failure-test-backup-${process.pid}`;
  const hadExistingBuild = fs.existsSync(staticRoot);
  if (hadExistingBuild) {
    fs.renameSync(staticRoot, backupRoot);
  }

  const scenarios = [
    ['bundle', 'Failed to download ios bundle'],
    ['manifest', 'Failed to download ios manifest'],
    ['asset', 'Simulated asset copy failure for android and ios assets'],
  ];

  try {
    for (const [stage, expectedMessage] of scenarios) {
      const result = await runBuildFailure(stage);
      if (result.code !== 1) {
        fail(
          `${stage} failure exited with ${result.code ?? result.signal}, output:\n${result.output}`,
        );
      }
      if (!result.output.includes(expectedMessage)) {
        fail(
          `${stage} failure did not identify the expected artifact "${expectedMessage}":\n${result.output}`,
        );
      }
      if (fs.existsSync(staticRoot)) {
        fail(`${stage} failure left partial static-build output at ${staticRoot}`);
      }
      console.log(`${stage}: failure reported and partial output removed`);
    }
  } finally {
    if (fs.existsSync(staticRoot)) {
      fs.rmSync(staticRoot, { recursive: true, force: true });
    }
    if (hadExistingBuild) {
      fs.renameSync(backupRoot, staticRoot);
    }
  }

  console.log('Static Expo failure cleanup check passed.');
}

const run = process.argv.includes('--failure-check')
  ? runFailureCheck
  : async () => {
      await runSmokeCheck();
      await runHealthCheck();
    };

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});