const assert = require('node:assert/strict');
const os = require('node:os');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { cleanupOldReleases } = require('./build');

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

async function checkPlatform(platform, origin, expectedBuildId) {
  const manifestResponse = await fetch(`${origin}/manifest`, {
    headers: { 'expo-platform': platform },
    signal: AbortSignal.timeout(5_000),
  });
  if (!manifestResponse.ok) {
    fail(`${platform} manifest endpoint returned HTTP ${manifestResponse.status}`);
  }
  const manifest = await manifestResponse.json();
  if (!manifest.launchAsset?.url) {
    fail(`${platform} manifest has no launchAsset.url`);
  }
  assert.equal(manifest.launchAsset.key, `bundle-${expectedBuildId}`);
  assert.ok(
    new URL(manifest.launchAsset.url).pathname.includes(`/${expectedBuildId}/`),
    `${platform} launch URL build identifier`,
  );

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
    const healthResponse = await fetch(`${origin}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200, 'active release health HTTP status');
    assert.equal(health.status, 'ready', 'active release health status');
    assert.ok(health.buildId, 'active release build identifier');
    for (const platform of platforms) {
      assert.equal(
        health.manifests?.[platform]?.status,
        'ready',
        `${platform} active release health status`,
      );
      assert.equal(
        health.manifests?.[platform]?.bundle?.status,
        'ready',
        `${platform} launch bundle health status`,
      );
      assert.equal(
        health.manifests?.[platform]?.buildId,
        health.buildId,
        `${platform} manifest build identifier`,
      );
      assert.equal(
        typeof health.manifests?.[platform]?.assets?.bundleReferenced,
        'number',
        `${platform} bundle-referenced asset count`,
      );
    }
    for (const platform of platforms) {
      await checkPlatform(platform, origin, health.buildId);
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

async function checkHealthFixture(
  label,
  staticRoot,
  expectedStatus,
  expectedHttpStatus,
  expectedFailure,
  expectedBuildId,
  expectedRecovery,
  expectedBundleReferences,
  maxHealthMs,
) {
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
    const healthStartedAt = performance.now();
    const response = await fetch(`${origin}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const healthElapsedMs = performance.now() - healthStartedAt;
    const body = await response.json();

    assert.equal(response.status, expectedHttpStatus, `${label} HTTP status`);
    assert.equal(body.status, expectedStatus, `${label} health status`);
    if (maxHealthMs !== undefined) {
      assert.ok(
        healthElapsedMs < maxHealthMs,
        `${label} first health request took ${healthElapsedMs.toFixed(1)}ms`,
      );
    }
    if (expectedStatus === 'ready') {
      assert.equal(body.buildId, expectedBuildId);
    } else {
      assert.equal(body.buildId, null);
    }
    assert.ok(body.manifests?.android, `${label} Android manifest status`);
    assert.ok(body.manifests?.ios, `${label} iOS manifest status`);

    if (expectedStatus === 'ready') {
      assert.equal(body.manifests.android.status, 'ready');
      assert.equal(body.manifests.ios.status, 'ready');
      assert.equal(body.manifests.android.buildId, body.buildId);
      assert.equal(body.manifests.ios.buildId, body.buildId);
      if (expectedBundleReferences !== undefined) {
        for (const platform of platforms) {
          assert.equal(
            body.manifests[platform].assets.bundleReferenced,
            expectedBundleReferences,
            `${label} ${platform} bundle-referenced asset count`,
          );
        }
      }
      const manifestResponse = await fetch(`${origin}/android/manifest.json`, {
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(manifestResponse.status, 200, `${label} manifest status`);
      const servedManifest = await manifestResponse.json();
      assert.equal(
        servedManifest.launchAsset?.key,
        `bundle-${expectedBuildId}`,
        `${label} served release`,
      );
      if (maxHealthMs !== undefined) {
        const cachedHealthStartedAt = performance.now();
        const cachedResponse = await fetch(`${origin}/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        const cachedHealthElapsedMs = performance.now() - cachedHealthStartedAt;
        assert.equal(cachedResponse.status, expectedHttpStatus);
        assert.ok(
          cachedHealthElapsedMs < maxHealthMs,
          `${label} cached health request took ${cachedHealthElapsedMs.toFixed(1)}ms`,
        );
      }
    }
    if (expectedFailure) {
      const platformHealth = body.manifests[expectedFailure.platform];
      assert.equal(platformHealth.status, expectedFailure.status);
      assert.match(platformHealth.reason, expectedFailure.reason);
      assert.equal(
        platformHealth[expectedFailure.field]?.url,
        expectedFailure.url,
      );
    }
    if (expectedRecovery) {
      assert.equal(body.recovery?.status, expectedRecovery.status);
      assert.match(body.recovery?.reason || '', expectedRecovery.reason);
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
  const missingBundleRoot = path.join(fixtureRoot, 'missing-bundle');
  const missingAssetRoot = path.join(fixtureRoot, 'missing-asset');
  const missingBundleAssetRoot = path.join(
    fixtureRoot,
    'missing-bundle-asset',
  );
  const bundleAssetsRoot = path.join(fixtureRoot, 'bundle-assets');
  const largeBundleRoot = path.join(fixtureRoot, 'large-bundle');
  const emptyBundleRoot = path.join(fixtureRoot, 'empty-bundle');
  const truncatedBundleRoot = path.join(fixtureRoot, 'truncated-bundle');
  const futureFooterRoot = path.join(fixtureRoot, 'future-footer');
  const unsupportedFooterRoot = path.join(fixtureRoot, 'unsupported-footer');
  const developmentBundleRoot = path.join(fixtureRoot, 'development-bundle');
  const stagingRoot = path.join(fixtureRoot, 'staging');
  const mismatchRoot = path.join(fixtureRoot, 'mismatch');
  const malformedPointerRoot = path.join(fixtureRoot, 'malformed-pointer');
  const missingTargetRoot = path.join(fixtureRoot, 'missing-target');
  const unavailablePointerRoot = path.join(fixtureRoot, 'unavailable-pointer');

  fs.mkdirSync(incompleteRoot, { recursive: true });
  fs.writeFileSync(
    path.join(incompleteRoot, '.build-incomplete'),
    'fixture build is incomplete\n',
  );

  function writePlatformFixture(root, options = {}) {
    const validBundle =
      'var __BUNDLE_START_TIME__=Date.now(),__DEV__=false;__r(0);' +
      '\n//# debugId=fixture-production-bundle';
    for (const platform of platforms) {
      fs.mkdirSync(root, { recursive: true });
      const buildId = options.buildId || 'fixture-build';
      const buildRoot = path.join(root, buildId);
      fs.mkdirSync(path.join(root, platform), { recursive: true });
      fs.mkdirSync(path.join(buildRoot, platform), { recursive: true });
      const bundleUrl = `/${buildId}/${platform}.js`;
      const assetUrl = `/${buildId}/${platform}.png`;
      if (options.missingBundle !== platform) {
        const bundleAsset = options.bundleAsset?.[platform];
        const bundleContent =
          options.bundleContent?.[platform] ??
          (bundleAsset
            ? `var __BUNDLE_START_TIME__=Date.now(),__DEV__=false;__r(0);httpServerLocation:"/${buildId}",name:"${bundleAsset}",type:"png";\n//# debugId=fixture-production-bundle`
            : validBundle);
        fs.writeFileSync(
          path.join(buildRoot, `${platform}.js`),
          bundleContent,
        );
      }
      if (options.missingAsset !== platform) {
        fs.writeFileSync(path.join(buildRoot, `${platform}.png`), 'asset');
      }
      const bundleAsset = options.bundleAsset?.[platform];
      if (bundleAsset && options.missingBundleAsset !== platform) {
        fs.writeFileSync(path.join(buildRoot, `${bundleAsset}.png`), 'asset');
      }
      fs.writeFileSync(
        path.join(root, platform, 'manifest.json'),
        JSON.stringify({
          launchAsset: {
            key: `bundle-${buildId}`,
            url: bundleUrl,
          },
          assets: [{ url: assetUrl }],
        }),
      );
    }
  }

  writePlatformFixture(readyRoot);
  writePlatformFixture(missingBundleRoot, { missingBundle: 'android' });
  writePlatformFixture(missingAssetRoot, { missingAsset: 'ios' });
  writePlatformFixture(missingBundleAssetRoot, {
    bundleAsset: { android: 'bundle-only' },
    missingBundleAsset: 'android',
  });
  writePlatformFixture(bundleAssetsRoot, {
    bundleAsset: { android: 'android-bundle', ios: 'ios-bundle' },
  });
  const largeBundle =
    `${'x'.repeat(8 * 1024 * 1024)}\n` +
    '//# debugId=fixture-large-bundle';
  writePlatformFixture(largeBundleRoot, {
    bundleContent: {
      android: largeBundle,
      ios: largeBundle,
    },
  });
  writePlatformFixture(emptyBundleRoot, {
    bundleContent: { android: '' },
  });
  writePlatformFixture(truncatedBundleRoot, {
    bundleContent: { android: 'var __DEV__=false;__r(0);' },
  });
  writePlatformFixture(futureFooterRoot, {
    bundleContent: {
      android:
        'var __BUNDLE_START_TIME__=Date.now(),__DEV__=false;__r(0);\n' +
        '//# debugId=fixture-future-footer\n' +
        '//# sourceMappingURL=android.bundle.js.map',
    },
  });
  writePlatformFixture(unsupportedFooterRoot, {
    bundleContent: {
      android:
        'var __BUNDLE_START_TIME__=Date.now(),__DEV__=false;__r(0);\n' +
        '//# debugId=fixture-unsupported-footer\n' +
        '//# chunk=android',
    },
  });
  writePlatformFixture(developmentBundleRoot, {
    bundleContent: {
      android: 'var __DEV__=true;fetch("http://localhost:8081");',
    },
  });

  const previousReleaseRoot = path.join(stagingRoot, 'releases', 'previous');
  writePlatformFixture(previousReleaseRoot, { buildId: 'previous' });
  fs.writeFileSync(path.join(stagingRoot, '.current'), 'previous\n');
  fs.writeFileSync(
    path.join(stagingRoot, '.build-incomplete'),
    'a replacement build is staging\n',
  );
  fs.mkdirSync(path.join(stagingRoot, '.staging-next'), { recursive: true });

  const mismatchReleaseRoot = path.join(mismatchRoot, 'releases', 'active');
  writePlatformFixture(mismatchReleaseRoot, { buildId: 'other' });
  fs.writeFileSync(path.join(mismatchRoot, '.current'), 'active\n');

  writePlatformFixture(
    path.join(malformedPointerRoot, 'releases', 'previous'),
    { buildId: 'previous' },
  );
  fs.writeFileSync(path.join(malformedPointerRoot, '.current'), '../staging\n');

  writePlatformFixture(
    path.join(missingTargetRoot, 'releases', 'previous'),
    { buildId: 'previous' },
  );
  fs.writeFileSync(path.join(missingTargetRoot, '.current'), 'missing\n');
  fs.mkdirSync(unavailablePointerRoot, { recursive: true });
  fs.writeFileSync(path.join(unavailablePointerRoot, '.current'), 'missing\n');

  try {
    await checkHealthFixture('missing static output', missingRoot, 'missing', 503);
    await checkHealthFixture('incomplete static output', incompleteRoot, 'incomplete', 503);
    await checkHealthFixture(
      'ready static output',
      readyRoot,
      'ready',
      200,
      undefined,
      'fixture-build',
    );
    await checkHealthFixture(
      'bundle-referenced assets for both platforms',
      bundleAssetsRoot,
      'ready',
      200,
      undefined,
      'fixture-build',
      undefined,
      1,
    );
    await checkHealthFixture(
      'large launch bundles',
      largeBundleRoot,
      'ready',
      200,
      undefined,
      'fixture-build',
      undefined,
      undefined,
      1_500,
    );
    await checkHealthFixture(
      'missing launch bundle',
      missingBundleRoot,
      'missing',
      503,
      {
        platform: 'android',
        status: 'missing',
        reason: /android launch bundle.*\/android\.js/,
        field: 'bundle',
        url: '/fixture-build/android.js',
      },
    );
    await checkHealthFixture(
      'missing declared asset',
      missingAssetRoot,
      'missing',
      503,
      {
        platform: 'ios',
        status: 'missing',
        reason: /ios asset.*ios\.png/,
        field: 'asset',
        url: '/fixture-build/ios.png',
      },
    );
    await checkHealthFixture(
      'missing bundle-referenced asset',
      missingBundleAssetRoot,
      'missing',
      503,
      {
        platform: 'android',
        status: 'missing',
        reason:
          /android bundle-referenced asset is missing.*\/fixture-build\/bundle-only\.png/,
        field: 'asset',
        url: '/fixture-build/bundle-only.png',
      },
    );
    await checkHealthFixture(
      'empty launch bundle',
      emptyBundleRoot,
      'invalid',
      503,
      {
        platform: 'android',
        status: 'invalid',
        reason: /android launch bundle.*\/android\.js.*empty/,
        field: 'bundle',
        url: '/fixture-build/android.js',
      },
    );
    await checkHealthFixture(
      'truncated launch bundle',
      truncatedBundleRoot,
      'invalid',
      503,
      {
        platform: 'android',
        status: 'invalid',
        reason: /android launch bundle.*\/android\.js.*truncated/,
        field: 'bundle',
        url: '/fixture-build/android.js',
      },
    );
    await checkHealthFixture(
      'approved future footer format',
      futureFooterRoot,
      'ready',
      200,
      undefined,
      'fixture-build',
    );
    await checkHealthFixture(
      'unsupported future footer format',
      unsupportedFooterRoot,
      'invalid',
      503,
      {
        platform: 'android',
        status: 'invalid',
        reason: /unsupported production footer format.*debug-id-with-source-map/,
        field: 'bundle',
        url: '/fixture-build/android.js',
      },
    );
    await checkHealthFixture(
      'development launch bundle',
      developmentBundleRoot,
      'invalid',
      503,
      {
        platform: 'android',
        status: 'invalid',
        reason: /android launch bundle.*\/android\.js.*development|Metro/,
        field: 'bundle',
        url: '/fixture-build/android.js',
      },
    );
    await checkHealthFixture(
      'previous release during staging',
      stagingRoot,
      'ready',
      200,
      undefined,
      'previous',
    );
    await checkHealthFixture(
      'active pointer and manifest mismatch',
      mismatchRoot,
      'invalid',
      503,
      {
        platform: 'android',
        status: 'invalid',
        reason: /does not match active build active/,
      },
      undefined,
      {
        status: 'unavailable',
        reason: /failed verification.*No verified previous release/,
      },
    );
    await checkHealthFixture(
      'malformed active release pointer',
      malformedPointerRoot,
      'ready',
      200,
      undefined,
      'previous',
      {
        status: 'recovered',
        reason: /malformed|does not match|missing|Serving verified previous release previous/,
      },
    );
    await checkHealthFixture(
      'missing active release target',
      missingTargetRoot,
      'ready',
      200,
      undefined,
      'previous',
      {
        status: 'recovered',
        reason: /Active release missing is missing.*Serving verified previous release previous/,
      },
    );
    await checkHealthFixture(
      'unavailable pointer recovery',
      unavailablePointerRoot,
      'invalid',
      503,
      undefined,
      undefined,
      {
        status: 'unavailable',
        reason: /No verified previous release is available/,
      },
    );
    console.log('Static Expo health check passed.');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function runReleaseCleanupCheck() {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'second-brain-release-cleanup-'),
  );
  const releasesRoot = path.join(fixtureRoot, 'releases');
  const releaseIds = ['100-active', '200-old', '300-previous', '400-newest'];

  try {
    for (const releaseId of releaseIds) {
      fs.mkdirSync(path.join(releasesRoot, releaseId), { recursive: true });
    }

    cleanupOldReleases('100-active', fixtureRoot, 2);
    assert.deepEqual(fs.readdirSync(releasesRoot).sort(), [
      '100-active',
      '400-newest',
    ]);
    console.log('Static release retention check passed.');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function runBuildLockCheck() {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'second-brain-build-lock-'),
  );
  const buildScript = path.join(projectRoot, 'scripts', 'build.js');
  const holderScript = `
    const { acquireBuildLock, setupSignalHandlers } = require(${JSON.stringify(buildScript)});
    setupSignalHandlers();
    acquireBuildLock(${JSON.stringify(fixtureRoot)});
    console.log('LOCKED');
    setInterval(() => {}, 1000);
  `;
  const holder = spawn(process.execPath, ['-e', holderScript], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let holderOutput = '';

  try {
    await new Promise((resolve, reject) => {
      holder.stdout.on('data', (chunk) => {
        holderOutput += chunk.toString();
        if (holderOutput.includes('LOCKED')) resolve();
      });
      holder.stderr.on('data', (chunk) => {
        holderOutput += chunk.toString();
      });
      holder.once('error', reject);
      holder.once('exit', (code) => {
        reject(new Error(`Lock holder exited before acquiring lock (${code})`));
      });
    });

    const contenderScript = `
      const { acquireBuildLock } = require(${JSON.stringify(buildScript)});
      try {
        acquireBuildLock(${JSON.stringify(fixtureRoot)});
        process.exit(0);
      } catch (error) {
        console.error(error.message);
        process.exit(1);
      }
    `;
    const contender = spawn(process.execPath, ['-e', contenderScript], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let contenderOutput = '';
    contender.stdout.on('data', (chunk) => {
      contenderOutput += chunk.toString();
    });
    contender.stderr.on('data', (chunk) => {
      contenderOutput += chunk.toString();
    });
    const contenderResult = await new Promise((resolve, reject) => {
      contender.once('error', reject);
      contender.once('close', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(contenderResult.code, 1);
    assert.match(contenderOutput, /Another static build is already running/);

    holder.kill('SIGINT');
    const holderResult = await new Promise((resolve) => {
      holder.once('close', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(holderResult.code, 130);
    assert.equal(fs.existsSync(path.join(fixtureRoot, '.build.lock')), false);
    console.log('Concurrent static build lock check passed.');
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) {
      holder.kill('SIGKILL');
    }
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
  const hadExistingBuild = fs.existsSync(staticRoot);
  const pointerPath = path.join(staticRoot, '.current');
  const previousPointer = fs.existsSync(pointerPath)
    ? fs.readFileSync(pointerPath, 'utf8')
    : null;
  const releasesPath = path.join(staticRoot, 'releases');
  const previousReleases = fs.existsSync(releasesPath)
    ? fs.readdirSync(releasesPath).sort()
    : null;

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
      const partialEntries = fs.existsSync(staticRoot)
        ? fs
            .readdirSync(staticRoot)
            .filter((entry) => entry.startsWith('.staging-'))
        : [];
      if (
        partialEntries.length > 0 ||
        fs.existsSync(path.join(staticRoot, '.build-incomplete'))
      ) {
        fail(
          `${stage} failure left partial staging output: ${partialEntries.join(', ')}`,
        );
      }
      if (
        hadExistingBuild &&
        previousPointer !== null &&
        fs.readFileSync(pointerPath, 'utf8') !== previousPointer
      ) {
        fail(`${stage} failure changed the active release pointer.`);
      }
      if (
        hadExistingBuild &&
        previousReleases &&
        JSON.stringify(fs.readdirSync(releasesPath).sort()) !==
          JSON.stringify(previousReleases)
      ) {
        fail(`${stage} failure changed the retained release set.`);
      }
      console.log(`${stage}: failure reported and partial output removed`);
    }
  } finally {
    if (!hadExistingBuild && fs.existsSync(staticRoot)) {
      fs.rmSync(staticRoot, { recursive: true, force: true });
    }
  }

  console.log('Static Expo failure cleanup check passed.');
}

const run = process.argv.includes('--failure-check')
  ? runFailureCheck
  : process.argv.includes('--release-cleanup')
    ? runReleaseCleanupCheck
    : process.argv.includes('--build-lock')
      ? runBuildLockCheck
    : async () => {
        await runSmokeCheck();
        await runHealthCheck();
        runReleaseCleanupCheck();
        await runBuildLockCheck();
      };

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});