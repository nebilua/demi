const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  expectedPlatform,
  findSdkTool,
  readReleaseIdentity,
} = require('./validate-android-apk');

const projectRoot = path.resolve(__dirname, '..');
const appConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'),
);
const identity = readReleaseIdentity();

assert.equal(identity.packageName, appConfig.expo.android.package);
assert.equal(identity.expectedVersionName, appConfig.expo.version);
assert.equal(
  identity.expectedVersionCode,
  String(appConfig.expo.android.versionCode),
);
assert.equal(expectedPlatform, 'android-35');

const sdkFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'second-brain-sdk-'));
try {
  const buildToolsDir = path.join(sdkFixture, 'build-tools');
  const realBuildToolsDir = path.join(sdkFixture, 'real-build-tools');
  fs.mkdirSync(buildToolsDir, { recursive: true });
  fs.mkdirSync(realBuildToolsDir);
  fs.writeFileSync(path.join(realBuildToolsDir, 'aapt'), '');
  fs.symlinkSync(realBuildToolsDir, path.join(buildToolsDir, '35.0.0'), 'dir');
  assert.equal(
    findSdkTool(sdkFixture, 'aapt'),
    path.join(buildToolsDir, '35.0.0', 'aapt'),
  );
} finally {
  fs.rmSync(sdkFixture, { recursive: true, force: true });
}

console.log(
  `Android release identity check passed: ${identity.packageName} ` +
    `${identity.expectedVersionName} (${identity.expectedVersionCode}); ` +
    `platform ${expectedPlatform}.`,
);