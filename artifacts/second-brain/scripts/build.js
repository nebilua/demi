const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { createMetroConfig, getMetroUrl } = require('./build-config');

let metroProcess = null;
let signalShutdownPromise = null;
let staticBuildInProgress = false;
let buildRoot = null;
let buildLockFd = null;
let buildLockPath = null;

const projectRoot = path.resolve(__dirname, '..');

function findWorkspaceRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'Could not find workspace root (no pnpm-workspace.yaml found)',
  );
}

const workspaceRoot = findWorkspaceRoot(projectRoot);
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');
const { port: metroPort, baseUrl: metroBaseUrl } = createMetroConfig(
  process.env.EXPO_BUILD_PORT,
);

function exitWithError(message) {
  throw new Error(message);
}

function terminateProcessTree(child, gracePeriodMs = 1500) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let forceTimer;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };

    child.once('exit', finish);
    child.once('error', finish);

    const sendSignal = (signal) => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch (error) {
        if (error.code !== 'ESRCH') {
          console.error(`Failed to send ${signal} to Metro: ${error.message}`);
        }
        if (signal === 'SIGKILL') finish();
      }
    };

    sendSignal('SIGTERM');
    forceTimer = setTimeout(() => {
      sendSignal('SIGKILL');
      setTimeout(finish, 250);
    }, gracePeriodMs);
  });
}

async function cleanupMetro() {
  const child = metroProcess;
  metroProcess = null;
  await terminateProcessTree(child);
}

function getStaticBuildRoot() {
  return path.join(projectRoot, 'static-build');
}

function acquireBuildLock(publishedRoot = getStaticBuildRoot()) {
  if (buildLockFd !== null) {
    throw new Error('This process already owns the static build lock.');
  }

  fs.mkdirSync(publishedRoot, { recursive: true });
  const lockPath = path.join(publishedRoot, '.build.lock');
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      let holder = '';
      try {
        holder = fs.readFileSync(lockPath, 'utf-8').trim();
      } catch {
        holder = 'holder details unavailable';
      }
      throw new Error(
        `Another static build is already running (${holder || 'holder details unavailable'}).`,
      );
    }
    throw error;
  }

  try {
    fs.writeFileSync(
      lockFd,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
  } catch (error) {
    fs.closeSync(lockFd);
    fs.rmSync(lockPath, { force: true });
    throw error;
  }

  buildLockFd = lockFd;
  buildLockPath = lockPath;
}

function releaseBuildLock() {
  const lockFd = buildLockFd;
  const lockPath = buildLockPath;
  buildLockFd = null;
  buildLockPath = null;

  if (lockFd === null) return;
  try {
    fs.closeSync(lockFd);
  } catch (error) {
    console.error(`Could not close static build lock: ${error.message}`);
  }
  try {
    fs.rmSync(lockPath, { force: true });
  } catch (error) {
    console.error(`Could not remove static build lock: ${error.message}`);
  }
}

function getBuildRoot() {
  return buildRoot || getStaticBuildRoot();
}

function invalidatePartialBuild() {
  const partialRoot = buildRoot;
  const markerPath = path.join(getStaticBuildRoot(), '.build-incomplete');
  buildRoot = null;

  try {
    if (partialRoot && partialRoot !== getStaticBuildRoot()) {
      fs.rmSync(partialRoot, { recursive: true, force: true });
    }
    fs.rmSync(markerPath, { force: true });
    console.log('Removed incomplete static build output.');
  } catch (error) {
    try {
      fs.mkdirSync(getStaticBuildRoot(), { recursive: true });
      fs.writeFileSync(
        markerPath,
        `Build output is incomplete and must not be served.\n${error.message}\n`,
      );
      console.error(
        `Could not remove incomplete static build output; wrote ${markerPath}.`,
      );
    } catch (markerError) {
      console.error(
        `Could not remove or mark incomplete static build output: ${markerError.message}`,
      );
    }
  }
}

const DEFAULT_RELEASE_RETENTION = 2;

function getReleaseRetention() {
  const configured = process.env.STATIC_BUILD_KEEP_RELEASES;
  if (configured === undefined || configured === '') {
    return DEFAULT_RELEASE_RETENTION;
  }

  const normalized = configured.trim();
  const retention = Number(normalized);
  if (!/^[1-9]\d*$/.test(normalized) || !Number.isSafeInteger(retention)) {
    console.warn(
      `Invalid STATIC_BUILD_KEEP_RELEASES="${configured}"; using ${DEFAULT_RELEASE_RETENTION}.`,
    );
    return DEFAULT_RELEASE_RETENTION;
  }
  return retention;
}

function cleanupOldReleases(
  activeId,
  publishedRoot = getStaticBuildRoot(),
  retention = getReleaseRetention(),
) {
  const releasesRoot = path.join(publishedRoot, 'releases');
  if (!fs.existsSync(releasesRoot)) return;

  let releaseIds;
  try {
    releaseIds = fs
      .readdirSync(releasesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
  } catch (error) {
    console.error(`Could not inspect old static releases: ${error.message}`);
    return;
  }

  const retained = new Set();
  if (releaseIds.includes(activeId)) {
    retained.add(activeId);
  }
  for (const releaseId of releaseIds) {
    if (retained.size >= retention) break;
    retained.add(releaseId);
  }

  for (const releaseId of releaseIds) {
    if (retained.has(releaseId)) continue;
    try {
      fs.rmSync(path.join(releasesRoot, releaseId), {
        recursive: true,
        force: true,
      });
      console.log(`Removed old static release: ${releaseId}`);
    } catch (error) {
      console.error(`Could not remove old static release ${releaseId}: ${error.message}`);
    }
  }
}

function promoteBuild(timestamp) {
  const publishedRoot = getStaticBuildRoot();
  const stagedRoot = buildRoot;
  if (!stagedRoot || stagedRoot === publishedRoot) {
    throw new Error('Cannot promote a build without a staging directory.');
  }

  const releasesRoot = path.join(publishedRoot, 'releases');
  const releaseRoot = path.join(releasesRoot, timestamp);
  fs.mkdirSync(releasesRoot, { recursive: true });
  fs.renameSync(stagedRoot, releaseRoot);
  buildRoot = releaseRoot;

  const pointerPath = path.join(publishedRoot, '.current');
  const nextPointerPath = path.join(
    publishedRoot,
    `.current-${timestamp}-${process.pid}`,
  );
  fs.writeFileSync(nextPointerPath, `${timestamp}\n`);
  fs.renameSync(nextPointerPath, pointerPath);
  fs.rmSync(path.join(publishedRoot, '.build-incomplete'), { force: true });
  cleanupOldReleases(timestamp, publishedRoot);

  buildRoot = null;
  staticBuildInProgress = false;
}

function setupSignalHandlers() {
  const cleanup = (signal) => {
    if (!signalShutdownPromise) {
      console.log(`Received ${signal}; cleaning up Metro process...`);
      signalShutdownPromise = cleanupMetro().finally(() => {
        if (staticBuildInProgress) {
          invalidatePartialBuild();
          staticBuildInProgress = false;
        }
        releaseBuildLock();
        process.exit(signal === 'SIGINT' ? 130 : 143);
      });
    }
  };

  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGHUP', () => cleanup('SIGHUP'));
}

function stripProtocol(domain) {
  let urlString = domain.trim();

  if (!/^https?:\/\//i.test(urlString)) {
    urlString = `https://${urlString}`;
  }

  return new URL(urlString).host;
}

function getDeploymentDomain() {
  if (process.env.REPLIT_INTERNAL_APP_DOMAIN) {
    return stripProtocol(process.env.REPLIT_INTERNAL_APP_DOMAIN);
  }

  if (process.env.REPLIT_DEV_DOMAIN) {
    return stripProtocol(process.env.REPLIT_DEV_DOMAIN);
  }

  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return stripProtocol(process.env.EXPO_PUBLIC_DOMAIN);
  }

  throw new Error(
    'No deployment domain found. Set REPLIT_INTERNAL_APP_DOMAIN, REPLIT_DEV_DOMAIN, or EXPO_PUBLIC_DOMAIN',
  );
}

function prepareDirectories(timestamp) {
  console.log('Preparing build directories...');

  const publishedRoot = getStaticBuildRoot();
  const stagingRoot = path.join(publishedRoot, `.staging-${timestamp}`);
  if (fs.existsSync(stagingRoot)) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(publishedRoot, { recursive: true });
  buildRoot = stagingRoot;
  staticBuildInProgress = true;

  const dirs = [
    path.join(stagingRoot, timestamp, '_expo', 'static', 'js', 'ios'),
    path.join(stagingRoot, timestamp, '_expo', 'static', 'js', 'android'),
    path.join(stagingRoot, 'ios'),
    path.join(stagingRoot, 'android'),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(publishedRoot, '.build-incomplete'),
    `Build ${timestamp} is in progress and must not be served.\n`,
  );

  console.log('Build:', timestamp);
}

function clearMetroCache() {
  console.log('Clearing Metro cache...');

  const cacheDirs = [
    path.join(projectRoot, '.metro-cache'),
    path.join(projectRoot, 'node_modules/.cache/metro'),
  ];

  for (const dir of cacheDirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('Cache cleared');
}

async function checkMetroHealth() {
  try {
    const response = await fetch(getMetroUrl({ baseUrl: metroBaseUrl }, '/status'), {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function getExpoPublicReplId() {
  return process.env.REPL_ID || process.env.EXPO_PUBLIC_REPL_ID;
}

async function startMetro(expoPublicDomain, expoPublicReplId) {
  const isRunning = await checkMetroHealth();
  if (isRunning) {
    console.log('Metro already running');
    return;
  }

  console.log('Starting Metro...');
  console.log(`Using Metro port ${metroPort}`);
  console.log(`Setting EXPO_PUBLIC_DOMAIN=${expoPublicDomain}`);
  const env = {
    ...process.env,
    EXPO_PUBLIC_DOMAIN: expoPublicDomain,
    EXPO_PUBLIC_REPL_ID: expoPublicReplId,
  };

  if (expoPublicReplId) {
    console.log(`Setting EXPO_PUBLIC_REPL_ID=${expoPublicReplId}`);
  }

  metroProcess = spawn(
    'pnpm',
    [
      'exec',
      'expo',
      'start',
      '--no-dev',
      '--minify',
      '--localhost',
      '--port',
      String(metroPort),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      cwd: projectRoot,
      env,
    },
  );

  if (metroProcess.stdout) {
    metroProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) console.log(`[Metro] ${output}`);
    });
  }
  if (metroProcess.stderr) {
    metroProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) console.error(`[Metro Error] ${output}`);
    });
  }

  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (metroProcess.exitCode !== null) {
      throw new Error('Metro exited before becoming ready.');
    }

    const healthy = await checkMetroHealth();
    if (healthy) {
      console.log('Metro ready');
      return;
    }
  }

  throw new Error('Metro timeout.');
}

async function downloadFile(url, outputPath) {
  const controller = new AbortController();
  const fiveMinMS = 5 * 60 * 1_000;
  const timeoutId = setTimeout(() => controller.abort(), fiveMinMS);

  try {
    console.log(`Downloading: ${url}`);
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const file = fs.createWriteStream(outputPath);
    await pipeline(Readable.fromWeb(response.body), file);

    const fileSize = fs.statSync(outputPath).size;

    if (fileSize === 0) {
      fs.unlinkSync(outputPath);
      throw new Error('Downloaded file is empty');
    }
  } catch (error) {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    if (error.name === 'AbortError') {
      throw new Error(`Download timeout after 5m: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadBundle(platform, timestamp) {
  const entryPath = path.resolve(
    projectRoot,
    'node_modules',
    'expo-router',
    'entry',
  );
  const bundlePath = path.relative(workspaceRoot, entryPath);
  const url = new URL(getMetroUrl({ baseUrl: metroBaseUrl }, `${bundlePath}.bundle`));
  url.searchParams.set('platform', platform);
  url.searchParams.set('dev', 'false');
  url.searchParams.set('hot', 'false');
  url.searchParams.set('lazy', 'false');
  url.searchParams.set('minify', 'true');

  const output = path.join(
    getBuildRoot(),
    timestamp,
    '_expo',
    'static',
    'js',
    platform,
    'bundle.js',
  );

  console.log(`Fetching ${platform} bundle...`);
  try {
    if (process.env.SECOND_BRAIN_BUILD_FAILURE === 'bundle') {
      throw new Error(`Simulated ${platform} bundle failure`);
    }
    await downloadFile(url.toString(), output);
  } catch (error) {
    throw new Error(
      `Failed to download ${platform} bundle (${url}): ${error.message}`,
    );
  }
  console.log(`${platform} bundle ready`);
}

async function downloadManifest(platform) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  try {
    console.log(`Fetching ${platform} manifest...`);
    if (process.env.SECOND_BRAIN_BUILD_FAILURE === 'manifest') {
      throw new Error(`Simulated ${platform} manifest failure`);
    }
    const response = await fetch(getMetroUrl({ baseUrl: metroBaseUrl }, '/manifest'), {
      headers: { 'expo-platform': platform },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const manifest = await response.json();
    console.log(`${platform} manifest ready`);
    return manifest;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(
        `Manifest download timeout after 5m for platform: ${platform}`,
      );
    }
    throw new Error(`Failed to download ${platform} manifest: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadBundlesAndManifests(timestamp) {
  console.log('Downloading bundles and manifests...');
  console.log('This may take several minutes for production builds...');

  try {
    // Bundles are sequential — Metro can't handle both platforms simultaneously
    // without stalling. Manifests are cheap and run in parallel after.
    await downloadBundle('ios', timestamp);
    await downloadBundle('android', timestamp);

    const [iosManifest, androidManifest] = await Promise.all([
      downloadManifest('ios'),
      downloadManifest('android'),
    ]);

    console.log('All downloads completed successfully');
    return { ios: iosManifest, android: androidManifest };
  } catch (error) {
    exitWithError(`Download failed: ${error.message}`);
  }
}

function extractAssets(timestamp) {
  const staticBuild = getBuildRoot();
  const bundles = {
    ios: fs.readFileSync(
      path.join(
        staticBuild,
        timestamp,
        '_expo',
        'static',
        'js',
        'ios',
        'bundle.js',
      ),
      'utf-8',
    ),
    android: fs.readFileSync(
      path.join(
        staticBuild,
        timestamp,
        '_expo',
        'static',
        'js',
        'android',
        'bundle.js',
      ),
      'utf-8',
    ),
  };

  const assetsMap = new Map();
  const assetPattern =
    /httpServerLocation:"([^"]+)"[^}]*hash:"([^"]+)"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"/g;

  const extractFromBundle = (bundle, platform) => {
    for (const match of bundle.matchAll(assetPattern)) {
      const originalPath = match[1];
      const filename = match[3] + '.' + match[4];

      const tempUrl = new URL(`${metroBaseUrl}${originalPath}`);
      const unstablePath = tempUrl.searchParams.get('unstable_path');

      if (!unstablePath) {
          throw new Error(
            `Asset missing unstable_path for ${platform}: ${originalPath}`,
          );
      }

      const decodedPath = decodeURIComponent(unstablePath);
      const key = path.posix.join(decodedPath, filename);

      if (!assetsMap.has(key)) {
        const asset = {
          url: path.posix.join('/', decodedPath, filename),
          originalPath: originalPath,
          filename: filename,
          relativePath: decodedPath,
          hash: match[2],
          platforms: new Set(),
        };

        assetsMap.set(key, asset);
      }
      assetsMap.get(key).platforms.add(platform);
    }
  };

  extractFromBundle(bundles.ios, 'ios');
  extractFromBundle(bundles.android, 'android');

  return Array.from(assetsMap.values());
}

async function downloadAssets(assets, timestamp) {
  if (assets.length === 0) {
    return 0;
  }

  console.log('Copying assets...');
  if (process.env.SECOND_BRAIN_BUILD_FAILURE === 'asset') {
    throw new Error('Simulated asset copy failure for android and ios assets');
  }
  let successCount = 0;
  const failures = [];

  const downloadPromises = assets.map(async (asset) => {
    const tempUrl = new URL(
      getMetroUrl({ baseUrl: metroBaseUrl }, asset.originalPath),
    );
    const unstablePath = tempUrl.searchParams.get('unstable_path');

    if (!unstablePath) {
      throw new Error(`Asset missing unstable_path: ${asset.originalPath}`);
    }

    const decodedPath = decodeURIComponent(unstablePath);

    const outputDir = path.join(
      getBuildRoot(),
      timestamp,
      '_expo',
      'static',
      'js',
      asset.relativePath,
    );
    fs.mkdirSync(outputDir, { recursive: true });
    const output = path.join(outputDir, asset.filename);

    try {
      const candidates = [
        path.join(projectRoot, decodedPath, asset.filename),
        path.join(workspaceRoot, decodedPath, asset.filename),
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      if (!found) {
        throw new Error(`Asset not found on disk: ${asset.filename}`);
      }
      fs.copyFileSync(found, output);
      successCount++;
    } catch (error) {
      failures.push({
        filename: asset.filename,
        platforms: Array.from(asset.platforms).join(', '),
        error: error.message,
        url: asset.originalPath,
      });
    }
  });

  await Promise.all(downloadPromises);

  if (failures.length > 0) {
    const errorMsg =
      `Failed to download ${failures.length} asset(s):\n` +
      failures
        .map(
          (f) =>
            `  - ${f.platforms} asset ${f.filename}: ${f.error} (${f.url})`,
        )
        .join('\n');
    exitWithError(errorMsg);
  }

  console.log(`Copied ${successCount} assets`);
  return successCount;
}

function updateBundleUrls(timestamp, baseUrl) {
  const updateForPlatform = (platform) => {
    const bundlePath = path.join(
      getBuildRoot(),
      timestamp,
      '_expo',
      'static',
      'js',
      platform,
      'bundle.js',
    );
    let bundle = fs.readFileSync(bundlePath, 'utf-8');
    const staticBundleBaseUrl =
      `${baseUrl}${basePath}/${timestamp}/_expo/static/js/${platform}/`;

    // Static builds do not ship Metro source maps or a development server.
    // Remove the generated source-map footer and replace Expo's development
    // fallback before the bundle is served to a device.
    bundle = bundle
      .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
      .replace(/http:\/\/localhost:\d+\//g, staticBundleBaseUrl)
      .replace(
        /http:\/\/localhost:\d+(?=['"`])/g,
        `${baseUrl}${basePath}`,
      );

    bundle = bundle.replace(
      /httpServerLocation:"(\/[^"]+)"/g,
      (_match, capturedPath) => {
        const tempUrl = new URL(`${metroBaseUrl}${capturedPath}`);
        const unstablePath = tempUrl.searchParams.get('unstable_path');

        if (!unstablePath) {
          throw new Error(
            `Asset missing unstable_path in bundle: ${capturedPath}`,
          );
        }

        const decodedPath = decodeURIComponent(unstablePath);
        return `httpServerLocation:"${baseUrl}${basePath}/${timestamp}/_expo/static/js/${decodedPath}"`;
      },
    );

    fs.writeFileSync(bundlePath, bundle);
  };

  updateForPlatform('ios');
  updateForPlatform('android');
  console.log('Updated bundle URLs');
}

function updateManifests(manifests, timestamp, baseUrl, assetsByHash) {
  const updateForPlatform = (platform, manifest) => {
    if (!manifest.launchAsset || !manifest.extra) {
      exitWithError(`Malformed manifest for ${platform}`);
    }

    manifest.launchAsset.url = `${baseUrl}${basePath}/${timestamp}/_expo/static/js/${platform}/bundle.js`;
    manifest.launchAsset.key = `bundle-${timestamp}`;
    manifest.createdAt = new Date(
      Number(timestamp.split('-')[0]),
    ).toISOString();
    manifest.extra.expoClient.hostUri =
      baseUrl.replace('https://', '') + '/' + platform;
    manifest.extra.expoGo.debuggerHost =
      baseUrl.replace('https://', '') + '/' + platform;
    manifest.extra.expoGo.packagerOpts.dev = false;

    if (manifest.assets && manifest.assets.length > 0) {
      manifest.assets.forEach((asset) => {
        if (!asset.url) return;

        const hash = asset.hash;
        if (!hash) return;

        const assetInfo = assetsByHash.get(hash);
        if (!assetInfo) return;

        asset.url = `${baseUrl}${basePath}/${timestamp}/_expo/static/js/${assetInfo.relativePath}/${assetInfo.filename}`;
      });
    }

    fs.writeFileSync(
      path.join(getBuildRoot(), platform, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  };

  updateForPlatform('ios', manifests.ios);
  updateForPlatform('android', manifests.android);
  console.log('Manifests updated');
}

async function main() {
  console.log('Building static Expo Go deployment...');

  setupSignalHandlers();

  let buildSucceeded = false;
  try {
    const domain = getDeploymentDomain();
    const expoPublicReplId = getExpoPublicReplId();
    const baseUrl = `https://${domain}`;
    const timestamp = `${Date.now()}-${process.pid}`;

    acquireBuildLock();
    prepareDirectories(timestamp);
    clearMetroCache();

    await startMetro(domain, expoPublicReplId);

    const downloadTimeout = 600000;
    let timeoutId;
    const downloadPromise = downloadBundlesAndManifests(timestamp);
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Overall download timeout after ${downloadTimeout / 1000} seconds. ` +
              'Metro may be struggling to generate bundles. Check Metro logs above.',
          ),
        );
      }, downloadTimeout);
    });

    let manifests;
    try {
      manifests = await Promise.race([downloadPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }

    console.log('Processing assets...');
    const assets = extractAssets(timestamp);
    console.log('Found', assets.length, 'unique asset(s)');

    const assetsByHash = new Map();
    for (const asset of assets) {
      assetsByHash.set(asset.hash, {
        relativePath: asset.relativePath,
        filename: asset.filename,
      });
    }

    await downloadAssets(assets, timestamp);

    updateBundleUrls(timestamp, baseUrl);

    console.log('Updating manifests and creating landing page...');
    updateManifests(manifests, timestamp, baseUrl, assetsByHash);

    promoteBuild(timestamp);
    buildSucceeded = true;
    console.log('Build complete! Deploy to:', baseUrl);
  } finally {
    await cleanupMetro();
    if (!buildSucceeded && staticBuildInProgress) {
      invalidatePartialBuild();
      staticBuildInProgress = false;
    }
    releaseBuildLock();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Build failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  getMetroUrl: (pathname) => getMetroUrl({ baseUrl: metroBaseUrl }, pathname),
  metroBaseUrl,
  metroPort,
  terminateProcessTree,
  cleanupOldReleases,
  getReleaseRetention,
  acquireBuildLock,
  releaseBuildLock,
  setupSignalHandlers,
};
