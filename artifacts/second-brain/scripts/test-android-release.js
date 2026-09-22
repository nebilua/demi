const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  expectedPlatform,
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

console.log(
  `Android release identity check passed: ${identity.packageName} ` +
    `${identity.expectedVersionName} (${identity.expectedVersionCode}); ` +
    `platform ${expectedPlatform}.`,
);