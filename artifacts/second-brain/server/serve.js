/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const STATIC_ROOT = path.resolve(
  process.env.STATIC_BUILD_ROOT || path.join(__dirname, '..', 'static-build'),
);
const TEMPLATE_PATH = path.resolve(__dirname, 'templates', 'landing-page.html');
const INCOMPLETE_MARKER = path.join(STATIC_ROOT, '.build-incomplete');
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');
const metroUrlPattern =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i;
const productionBundleFooterFormats = [
  {
    name: 'debug-id',
    pattern: /\/\/# debugId=[A-Za-z0-9-]+\s*$/,
  },
  {
    // Approved for Expo/Metro versions that keep the source-map footer.
    name: 'debug-id-with-source-map',
    pattern:
      /\/\/# debugId=[A-Za-z0-9-]+\s*\/\/# sourceMappingURL=\S+\s*$/,
  },
];
const bundleHealthCache = new Map();
const bundleAssetPattern =
  /httpServerLocation:"([^"]+)"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"/g;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, '..', 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
    return typeof appJson.expo?.name === 'string'
      ? appJson.expo.name
      : 'App Landing Page';
  } catch {
    return 'App Landing Page';
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toScriptString(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function getReleaseCandidate(releaseId) {
  if (
    !releaseId ||
    releaseId === '.' ||
    releaseId === '..' ||
    !/^[A-Za-z0-9._-]+$/.test(releaseId)
  ) {
    return null;
  }
  const releaseRoot = path.join(STATIC_ROOT, 'releases', releaseId);
  return fs.existsSync(releaseRoot) && fs.statSync(releaseRoot).isDirectory()
    ? { root: releaseRoot, id: releaseId }
    : null;
}

function getVerifiedRelease(releaseId, releaseRoot) {
  const manifests = ['android', 'ios'].map((platform) =>
    getManifestHealth(platform, releaseRoot, releaseId),
  );
  if (!manifests.every((manifest) => manifest.status === 'ready')) {
    return null;
  }

  const manifestIds = manifests.map((manifest) => manifest.buildId);
  if (
    manifestIds.length !== 2 ||
    !manifestIds[0] ||
    manifestIds.some((manifestId) => manifestId !== manifestIds[0])
  ) {
    return null;
  }
  return {
    root: releaseRoot,
    id: manifestIds[0],
  };
}

function findVerifiedRelease(excludedId) {
  const releasesRoot = path.join(STATIC_ROOT, 'releases');
  if (!fs.existsSync(releasesRoot)) return null;

  let releaseIds;
  try {
    releaseIds = fs
      .readdirSync(releasesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
  } catch {
    return null;
  }

  for (const releaseId of releaseIds) {
    if (releaseId === excludedId) continue;
    const candidate = getReleaseCandidate(releaseId);
    const verified = candidate
      ? getVerifiedRelease(candidate.id, candidate.root)
      : null;
    if (verified) return verified;
  }
  return null;
}

function getActiveBuild({ verifyPointer = false } = {}) {
  if (!fs.existsSync(STATIC_ROOT)) return null;

  const pointerPath = path.join(STATIC_ROOT, '.current');
  let pointerProblem = 'Active release pointer is missing.';
  let pointerId = null;
  let failedCandidate = null;
  if (fs.existsSync(pointerPath)) {
    try {
      pointerId = fs.readFileSync(pointerPath, 'utf-8').trim();
      const candidate = getReleaseCandidate(pointerId);
      if (candidate && !verifyPointer) {
        return candidate;
      }
      if (candidate && getVerifiedRelease(candidate.id, candidate.root)) {
        return candidate;
      }
      if (candidate) failedCandidate = candidate;
      pointerProblem = candidate
        ? `Active release ${pointerId} failed verification.`
        : `Active release ${pointerId || '(empty)'} is missing.`;
    } catch (error) {
      pointerProblem = `Active release pointer could not be read: ${error.message}`;
    }
  }

  // Support static builds created before atomic release promotion existed.
  const hasLegacyOutput =
    fs.existsSync(path.join(STATIC_ROOT, 'android')) ||
    fs.existsSync(path.join(STATIC_ROOT, 'ios'));
  if (hasLegacyOutput) {
    if (!verifyPointer) return { root: STATIC_ROOT, id: null };
    const verifiedLegacy = getVerifiedRelease(null, STATIC_ROOT);
    if (verifiedLegacy) return verifiedLegacy;
    failedCandidate = { root: STATIC_ROOT, id: null };
    pointerProblem = 'Legacy static output failed verification.';
  }

  const fallback = findVerifiedRelease(pointerId);
  if (fallback) {
    return {
      ...fallback,
      recovery: {
        status: 'recovered',
        reason: `${pointerProblem} Serving verified previous release ${fallback.id}.`,
      },
    };
  }

  if (failedCandidate) {
    return {
      ...failedCandidate,
      recovery: {
        status: 'unavailable',
        reason: `${pointerProblem} No verified previous release is available.`,
      },
    };
  }

  return {
    root: null,
    id: null,
    recovery: {
      status: 'unavailable',
      reason: `${pointerProblem} No verified previous release is available.`,
    },
  };
}

function getActiveBuildRoot() {
  return getActiveBuild()?.root || null;
}

function serveManifest(platform, res) {
  const activeRoot = getActiveBuildRoot();
  const manifestPath = activeRoot
    ? path.join(activeRoot, platform, 'manifest.json')
    : null;

  if (!manifestPath || !fs.existsSync(manifestPath)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, 'utf-8');
  res.writeHead(200, {
    'content-type': 'application/json',
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
  });
  res.end(manifest);
}

function resolveLocalAsset(assetUrl, activeRoot) {
  if (typeof assetUrl !== 'string' || !assetUrl) {
    return { status: 'invalid', reason: 'Asset URL is missing' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(assetUrl, 'http://static-build.local');
  } catch (error) {
    return { status: 'invalid', reason: error.message, url: assetUrl };
  }

  let pathname = parsedUrl.pathname;
  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return { status: 'invalid', reason: 'Asset URL is not valid UTF-8', url: assetUrl };
  }

  const pathSegments = decodedPath.split(/[\\/]+/).filter(Boolean);
  if (pathSegments.includes('..')) {
    return { status: 'invalid', reason: 'Asset URL escapes the active release', url: assetUrl };
  }

  const filePath = path.resolve(activeRoot, ...pathSegments);
  if (
    filePath !== activeRoot &&
    !filePath.startsWith(`${activeRoot}${path.sep}`)
  ) {
    return { status: 'invalid', reason: 'Asset URL escapes the active release', url: assetUrl };
  }

  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return { status: 'missing', url: assetUrl };
    }
  } catch (error) {
    return { status: 'missing', reason: error.message, url: assetUrl };
  }

  return { status: 'ready', url: assetUrl, filePath };
}

function publicAssetCheck(result) {
  const { filePath, ...publicResult } = result;
  return publicResult;
}

function checkLocalAsset(assetUrl, activeRoot) {
  return publicAssetCheck(resolveLocalAsset(assetUrl, activeRoot));
}

function checkLaunchBundle(assetUrl, activeRoot) {
  const resolved = resolveLocalAsset(assetUrl, activeRoot);
  if (resolved.status !== 'ready') {
    return publicAssetCheck(resolved);
  }

  let stat;
  try {
    stat = fs.statSync(resolved.filePath);
  } catch (error) {
    return {
      status: 'invalid',
      reason: error.message,
      url: assetUrl,
    };
  }
  const signature = [
    stat.dev,
    stat.ino,
    stat.size,
    stat.mtimeMs,
    stat.ctimeMs,
  ].join(':');
  const cached = bundleHealthCache.get(resolved.filePath);
  if (cached?.signature === signature) {
    return cached.result;
  }

  let bundle;
  try {
    bundle = fs.readFileSync(resolved.filePath, 'utf-8');
  } catch (error) {
    return {
      status: 'invalid',
      reason: error.message,
      url: assetUrl,
    };
  }

  let result;
  if (bundle.trim().length === 0) {
    result = {
      status: 'invalid',
      reason: 'Launch bundle is empty',
      url: assetUrl,
    };
  } else if (
    metroUrlPattern.test(bundle) ||
    /\b__DEV__\s*=\s*true\b/.test(bundle)
  ) {
    result = {
      status: 'invalid',
      reason: 'Launch bundle contains development or Metro configuration',
      url: assetUrl,
    };
  } else {
    const footerFormat = productionBundleFooterFormats.find(({ pattern }) =>
      pattern.test(bundle),
    );
    if (!footerFormat) {
      const hasDebugId = /\/\/# debugId=/.test(bundle);
      result = {
        status: 'invalid',
        reason: hasDebugId
          ? `Launch bundle uses an unsupported production footer format (supported: ${productionBundleFooterFormats
              .map(({ name }) => name)
              .join(', ')})`
          : `Launch bundle is truncated or missing a supported production footer (supported: ${productionBundleFooterFormats
              .map(({ name }) => name)
              .join(', ')})`,
        url: assetUrl,
      };
    } else {
      result = {
        ...publicAssetCheck(resolved),
        bundleAssetUrls: extractBundleAssetUrls(bundle),
      };
    }
  }

  bundleHealthCache.set(resolved.filePath, { signature, result });
  return result;
}

function publicBundleCheck(result) {
  if (!result) return result;
  const { bundleAssetUrls, ...publicResult } = result;
  return publicResult;
}

function extractBundleAssetUrls(bundleText) {
  const assetUrls = new Set();
  for (const match of bundleText.matchAll(bundleAssetPattern)) {
    const location = match[1].replace(/\/+$/, '');
    assetUrls.add(`${location}/${match[2]}.${match[3]}`);
  }
  return Array.from(assetUrls);
}

function getManifestBuildId(manifest) {
  const key = manifest.launchAsset?.key;
  if (typeof key !== 'string' || !key.startsWith('bundle-')) {
    return null;
  }

  const keyId = key.slice('bundle-'.length);
  let parsedUrl;
  try {
    parsedUrl = new URL(manifest.launchAsset.url, 'http://static-build.local');
  } catch {
    return null;
  }

  let pathname = parsedUrl.pathname;
  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || '/';
  }
  const pathSegments = pathname.split('/').filter(Boolean);
  return pathSegments[0] === keyId ? keyId : null;
}

function getManifestHealth(platform, activeRoot, expectedBuildId) {
  const manifestPath = activeRoot
    ? path.join(activeRoot, platform, 'manifest.json')
    : null;
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return { status: 'missing' };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!manifest.launchAsset?.url) {
      return { status: 'invalid', reason: 'launchAsset.url is missing' };
    }

    const manifestBuildId = getManifestBuildId(manifest);
    if (!manifestBuildId) {
      return {
        status: 'invalid',
        reason: `${platform} manifest build identifier does not match its launch URL`,
      };
    }
    if (expectedBuildId && manifestBuildId !== expectedBuildId) {
      return {
        status: 'invalid',
        reason: `${platform} manifest build identifier ${manifestBuildId} does not match active build ${expectedBuildId}`,
        buildId: manifestBuildId,
      };
    }

    const bundle = checkLaunchBundle(manifest.launchAsset.url, activeRoot);
    if (bundle.status !== 'ready') {
      return {
        status: bundle.status,
        buildId: manifestBuildId,
        reason: `${platform} launch bundle is ${bundle.status}: ${
          manifest.launchAsset.url
        } (${bundle.reason || 'integrity check failed'})`,
        bundle: publicBundleCheck(bundle),
      };
    }
    const publicBundle = publicBundleCheck(bundle);

    if (!Array.isArray(manifest.assets)) {
      return {
        status: 'invalid',
        buildId: manifestBuildId,
        reason: `${platform} manifest assets must be an array`,
        bundle: publicBundle,
      };
    }

    for (const asset of manifest.assets) {
      const checkedAsset = checkLocalAsset(asset?.url, activeRoot);
      if (checkedAsset.status !== 'ready') {
        return {
          status: checkedAsset.status,
          buildId: manifestBuildId,
          reason: `${platform} asset is ${checkedAsset.status}: ${
            asset?.url || '(missing URL)'
          } (${checkedAsset.reason || 'asset check failed'})`,
          bundle: publicBundle,
          asset: checkedAsset,
        };
      }
    }

    const bundleAssetUrls = bundle.bundleAssetUrls || [];
    for (const assetUrl of bundleAssetUrls) {
      const checkedAsset = checkLocalAsset(assetUrl, activeRoot);
      if (checkedAsset.status !== 'ready') {
        return {
          status: checkedAsset.status,
          buildId: manifestBuildId,
          reason: `${platform} bundle-referenced asset is ${
            checkedAsset.status
          }: ${assetUrl} (${checkedAsset.reason || 'asset check failed'})`,
          bundle: publicBundle,
          asset: checkedAsset,
          bundleAsset: true,
        };
      }
    }

    return {
      status: 'ready',
      buildId: manifestBuildId,
      bundle: publicBundle,
      assets: {
        status: 'ready',
        checked: manifest.assets.length,
        bundleReferenced: bundleAssetUrls.length,
      },
    };
  } catch (error) {
    return { status: 'invalid', reason: error.message };
  }
}

function getBuildHealth() {
  const activeBuild = getActiveBuild({ verifyPointer: true });
  const activeRoot = activeBuild?.root || null;
  const activeBuildId = activeBuild?.id || null;
  const recovery = activeBuild?.recovery;
  const manifests = {
    android: getManifestHealth('android', activeRoot, activeBuildId),
    ios: getManifestHealth('ios', activeRoot, activeBuildId),
  };

  if (fs.existsSync(INCOMPLETE_MARKER) && !activeRoot) {
    return {
      status: 'incomplete',
      buildId: null,
      reason:
        recovery?.reason ||
        'A static build is still in progress or failed before promotion.',
      manifests,
      recovery,
    };
  }

  if (!activeRoot) {
    if (recovery) {
      return {
        status: 'invalid',
        buildId: null,
        reason: recovery.reason,
        manifests,
        recovery,
      };
    }
    return {
      status: 'missing',
      buildId: null,
      reason: 'No static build output directory exists.',
      manifests,
    };
  }

  const manifestStatuses = Object.values(manifests).map((manifest) => manifest.status);
  const manifestBuildIds = Object.values(manifests)
    .map((manifest) => manifest.buildId)
    .filter(Boolean);
  const manifestsShareBuildId =
    manifestBuildIds.length === 2 &&
    manifestBuildIds.every((buildId) => buildId === manifestBuildIds[0]);
  const manifestsReady = manifestStatuses.every(
    (manifestStatus) => manifestStatus === 'ready',
  );
  const status = manifestsReady && manifestsShareBuildId
    ? 'ready'
    : manifestStatuses.includes('invalid') || !manifestsShareBuildId
      ? 'invalid'
      : 'missing';

  return {
    status,
    buildId: status === 'ready' ? manifestBuildIds[0] : null,
    reason:
      status === 'ready'
        ? 'Android and iOS static manifests are ready.'
        : status === 'invalid' && !manifestsShareBuildId
          ? 'Android and iOS manifests do not share one build identifier.'
        : 'One or more platform manifests are unavailable.',
    manifests,
    recovery,
  };
}

function serveHealth(res) {
  const health = getBuildHealth();
  res.writeHead(health.status === 'ready' ? 200 : 503, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(health));
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `exps://${host}${basePath}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_ATTRIBUTE_PLACEHOLDER/g, escapeHtml(expsUrl))
    .replace(/EXPS_URL_JSON_PLACEHOLDER/g, toScriptString(expsUrl))
    .replace(/APP_NAME_PLACEHOLDER/g, escapeHtml(appName));

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function serveStaticFile(urlPath, res) {
  const activeRoot = getActiveBuildRoot();
  if (!activeRoot) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  const pathSegments = decodedPath.split(/[\\/]+/).filter(Boolean);
  if (pathSegments.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const filePath = path.resolve(activeRoot, ...pathSegments);
  const isInsideStaticRoot =
    filePath === activeRoot ||
    filePath.startsWith(`${activeRoot}${path.sep}`);
  if (!isInsideStaticRoot) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'content-type': contentType });
  res.end(content);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
const appName = getAppName();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  if (pathname === '/health') {
    return serveHealth(res);
  }

  if (fs.existsSync(INCOMPLETE_MARKER) && !getActiveBuildRoot()) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Static build is incomplete and unavailable.',
      }),
    );
    return;
  }

  if (pathname === '/' || pathname === '/manifest') {
    const platform = req.headers['expo-platform'];
    if (platform === 'ios' || platform === 'android') {
      return serveManifest(platform, res);
    }

    if (pathname === '/') {
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  serveStaticFile(pathname, res);
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving static Expo build on port ${port}`);
});
