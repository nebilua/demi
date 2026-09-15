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
const productionBundleFooterPattern = /\/\/# debugId=[A-Za-z0-9-]+\s*$/;

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

function getActiveBuildRoot() {
  if (!fs.existsSync(STATIC_ROOT)) return null;

  const pointerPath = path.join(STATIC_ROOT, '.current');
  if (fs.existsSync(pointerPath)) {
    const releaseId = fs.readFileSync(pointerPath, 'utf-8').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(releaseId)) return null;

    const releaseRoot = path.join(STATIC_ROOT, 'releases', releaseId);
    return fs.existsSync(releaseRoot) && fs.statSync(releaseRoot).isDirectory()
      ? releaseRoot
      : null;
  }

  // Support static builds created before atomic release promotion existed.
  return fs.existsSync(path.join(STATIC_ROOT, 'android')) ||
    fs.existsSync(path.join(STATIC_ROOT, 'ios'))
    ? STATIC_ROOT
    : null;
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

  if (bundle.trim().length === 0) {
    return {
      status: 'invalid',
      reason: 'Launch bundle is empty',
      url: assetUrl,
    };
  }

  if (metroUrlPattern.test(bundle) || /\b__DEV__\s*=\s*true\b/.test(bundle)) {
    return {
      status: 'invalid',
      reason: 'Launch bundle contains development or Metro configuration',
      url: assetUrl,
    };
  }

  if (!productionBundleFooterPattern.test(bundle)) {
    return {
      status: 'invalid',
      reason: 'Launch bundle is truncated or missing its production footer',
      url: assetUrl,
    };
  }

  return publicAssetCheck(resolved);
}

function getManifestHealth(platform, activeRoot) {
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

    const bundle = checkLaunchBundle(manifest.launchAsset.url, activeRoot);
    if (bundle.status !== 'ready') {
      return {
        status: bundle.status,
        reason: `${platform} launch bundle is ${bundle.status}: ${
          manifest.launchAsset.url
        } (${bundle.reason || 'integrity check failed'})`,
        bundle,
      };
    }

    if (!Array.isArray(manifest.assets)) {
      return {
        status: 'invalid',
        reason: `${platform} manifest assets must be an array`,
        bundle,
      };
    }

    for (const asset of manifest.assets) {
      const checkedAsset = checkLocalAsset(asset?.url, activeRoot);
      if (checkedAsset.status !== 'ready') {
        return {
          status: checkedAsset.status,
          reason: `${platform} asset is ${checkedAsset.status}: ${
            asset?.url || '(missing URL)'
          } (${checkedAsset.reason || 'asset check failed'})`,
          bundle,
          asset: checkedAsset,
        };
      }
    }

    return {
      status: 'ready',
      bundle,
      assets: { status: 'ready', checked: manifest.assets.length },
    };
  } catch (error) {
    return { status: 'invalid', reason: error.message };
  }
}

function getBuildHealth() {
  const activeRoot = getActiveBuildRoot();
  const manifests = {
    android: getManifestHealth('android', activeRoot),
    ios: getManifestHealth('ios', activeRoot),
  };

  if (fs.existsSync(INCOMPLETE_MARKER) && !activeRoot) {
    return {
      status: 'incomplete',
      reason: 'A static build is still in progress or failed before promotion.',
      manifests,
    };
  }

  if (!activeRoot) {
    return {
      status: 'missing',
      reason: 'No static build output directory exists.',
      manifests,
    };
  }

  const manifestStatuses = Object.values(manifests).map((manifest) => manifest.status);
  const status = manifestStatuses.every((manifestStatus) => manifestStatus === 'ready')
    ? 'ready'
    : manifestStatuses.includes('invalid')
      ? 'invalid'
      : 'missing';

  return {
    status,
    reason:
      status === 'ready'
        ? 'Android and iOS static manifests are ready.'
        : 'One or more platform manifests are unavailable.',
    manifests,
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
