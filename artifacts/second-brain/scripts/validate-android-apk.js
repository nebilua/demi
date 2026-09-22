#!/usr/bin/env node

/**
 * Build and smoke-check the standalone arm64 release APK.
 *
 * Set SKIP_BUILD=1 to inspect an existing APK_PATH without running Gradle.
 * This is useful for release copies and for diagnosing a failed delivery
 * artifact, while the normal package command always performs a fresh build.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectDir = path.resolve(__dirname, '..');
const androidDir = path.join(projectDir, 'android');
const defaultApkPath = path.join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk',
);

const expectedNdkVersion = '27.1.12297006';
const expectedPlatform = 'android-35';
const requiredPermissions = [
  'android.permission.RECORD_AUDIO',
  'android.permission.POST_NOTIFICATIONS',
];
const requiredNativeEntries = ['lib/arm64-v8a/librnllama.so'];
const requiredNativeClassFragments = [
  {
    label: 'offline TTS module',
    fragment: 'com/secondbrain/offlinetts/SecondBrainOfflineTtsModule',
  },
  {
    label: 'offline speech recognition module',
    fragment: 'expo/modules/speechrecognition/ExpoSpeechRecognitionModule',
  },
];
const maxDexBytes = 64 * 1024 * 1024;

function fail(message) {
  console.error(`\nAPK validation failed: ${message}`);
  process.exit(1);
}

function readReleaseIdentity() {
  const appConfigPath = path.join(projectDir, 'app.json');
  let appConfig;
  try {
    appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
  } catch (error) {
    fail(`could not read release identity from ${appConfigPath}: ${error.message}`);
  }

  const expo = appConfig?.expo;
  const packageName = expo?.android?.package;
  const expectedVersionName = expo?.version;
  const versionCode = expo?.android?.versionCode;
  if (
    typeof packageName !== 'string' ||
    typeof expectedVersionName !== 'string' ||
    !Number.isInteger(versionCode) ||
    versionCode < 1
  ) {
    fail(
      'app.json has an incomplete Android release identity; expected ' +
        'expo.version, expo.android.package, and a positive integer expo.android.versionCode.',
    );
  }

  return {
    packageName,
    expectedVersionName,
    expectedVersionCode: String(versionCode),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectDir,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) {
    fail(`could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}`);
  }
  return result.stdout ?? '';
}

function findSdkTool(sdkPath, toolName) {
  const buildToolsDir = path.join(sdkPath, 'build-tools');
  if (fs.existsSync(buildToolsDir)) {
    const versions = fs
      .readdirSync(buildToolsDir, { withFileTypes: true })
      // Nix's composed SDK exposes version directories as symlinks.
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const version of versions) {
      const candidate = path.join(buildToolsDir, version, toolName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  const fromPath = spawnSync('sh', ['-c', `command -v ${toolName}`], {
    encoding: 'utf8',
  }).stdout?.trim();
  return fromPath || null;
}

function findSdkCandidates() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    '/opt/android-sdk',
    '/usr/lib/android-sdk',
    path.join(process.env.HOME || '', 'Android', 'Sdk'),
  ].filter(Boolean);

  for (const toolName of ['sdkmanager', 'aapt', 'zipalign', 'apksigner', 'adb']) {
    const toolPath = spawnSync('sh', ['-c', `command -v ${toolName}`], {
      encoding: 'utf8',
    }).stdout?.trim();
    if (!toolPath) continue;

    let toolDir = path.dirname(toolPath);
    for (let depth = 0; depth < 5; depth += 1) {
      candidates.push(toolDir);
      toolDir = path.dirname(toolDir);
    }
  }

  return [...new Set(candidates)];
}

function isAndroidSdk(sdkPath) {
  return (
    fs.existsSync(path.join(sdkPath, 'platform-tools', 'adb')) ||
    fs.existsSync(path.join(sdkPath, 'build-tools')) ||
    fs.existsSync(path.join(sdkPath, 'cmdline-tools'))
  );
}

function findNdkPath(sdkPath) {
  const configuredNdk = process.env.ANDROID_NDK_HOME;
  if (configuredNdk) return configuredNdk;

  const expectedPath = path.join(sdkPath, 'ndk', expectedNdkVersion);
  if (fs.existsSync(expectedPath)) return expectedPath;

  return '';
}

function resolveAndroidEnvironment() {
  const sdkPath = findSdkCandidates().find(isAndroidSdk) || '';

  if (!sdkPath || !fs.existsSync(sdkPath)) {
    fail(
      'Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed SDK ' +
        'before running this check. Replit workspaces should provide ' +
        'androidenv.androidPkgs.androidsdk or an SDK at /opt/android-sdk.',
    );
  }

  const ndkPath = findNdkPath(sdkPath);

  if (!ndkPath || !fs.existsSync(ndkPath)) {
    fail(
      `Android NDK ${expectedNdkVersion} not found. Set ANDROID_NDK_HOME to that installed ` +
        'NDK before running the constrained arm64 build.',
    );
  }

  const platformJar = path.join(sdkPath, 'platforms', expectedPlatform, 'android.jar');
  if (!fs.existsSync(platformJar)) {
    fail(
      `Android platform ${expectedPlatform} not found at ${platformJar}. ` +
        `Install the ${expectedPlatform} SDK platform before running the constrained arm64 build.`,
    );
  }

  const tools = Object.fromEntries(
    ['aapt', 'zipalign', 'apksigner'].map((toolName) => [
      toolName,
      findSdkTool(sdkPath, toolName),
    ]),
  );
  const missingTools = Object.entries(tools)
    .filter(([, toolPath]) => !toolPath)
    .map(([toolName]) => toolName);

  if (missingTools.length > 0) {
    fail(
      `Android build-tools are incomplete; missing ${missingTools.join(
        ', ',
      )}. Install Android build-tools and retry.`,
    );
  }
  if (!spawnSync('sh', ['-c', 'command -v unzip'], { encoding: 'utf8' }).stdout?.trim()) {
    fail('the unzip command is required to inspect APK native libraries.');
  }

  return {
    sdkPath,
    ndkPath,
    platform: expectedPlatform,
    tools,
    env: {
      ...process.env,
      ANDROID_HOME: sdkPath,
      ANDROID_SDK_ROOT: sdkPath,
      ANDROID_NDK_HOME: ndkPath,
      CMAKE_BUILD_PARALLEL_LEVEL: '1',
    },
  };
}

function printPreflight(androidEnvironment) {
  console.log('Android alpha preflight passed:');
  console.log(`  SDK: ${androidEnvironment.sdkPath}`);
  console.log(`  platform: ${androidEnvironment.platform}`);
  console.log(`  NDK: ${androidEnvironment.ndkPath}`);
  console.log(
    `  build tools: ${Object.entries(androidEnvironment.tools)
      .map(([name, toolPath]) => `${name}=${toolPath}`)
      .join(', ')}`,
  );
}

function buildApk(androidEnvironment) {
  console.log('Building arm64 release APK with the documented constrained flags...');
  const packageJsonPath = path.join(projectDir, 'package.json');
  const originalPackageJson = fs.readFileSync(packageJsonPath);
  const restorePackageJson = () => {
    fs.writeFileSync(packageJsonPath, originalPackageJson);
  };
  process.once('exit', restorePackageJson);
  run(
    'pnpm',
    ['exec', 'expo', 'prebuild', '--platform', 'android', '--no-install'],
    {
      env: androidEnvironment.env,
    },
  );
  restorePackageJson();
  process.removeListener('exit', restorePackageJson);
  run(
    './gradlew',
    [
      'assembleRelease',
      '--no-daemon',
      '--console=plain',
      '--max-workers=1',
      '-Dorg.gradle.parallel=false',
      "-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m",
      '-PrnllamaBuildFromSource=false',
      '-PreactNativeArchitectures=arm64-v8a',
      '-PrnllamaVariants=rnllama',
    ],
    {
      cwd: androidDir,
      env: androidEnvironment.env,
    },
  );
}

function checkApk(apkPath, androidEnvironment) {
  const {
    packageName,
    expectedVersionName,
    expectedVersionCode,
  } = readReleaseIdentity();
  if (!fs.existsSync(apkPath)) {
    fail(
      `APK is missing at ${apkPath}. The arm64 Gradle build did not produce ` +
        'android/app/build/outputs/apk/release/app-release.apk.',
    );
  }

  console.log(`Checking ${apkPath}...`);
  const badging = run(
    androidEnvironment.tools.aapt,
    ['dump', 'badging', apkPath],
    { capture: true },
  );
  const declaredPackage = badging.match(/package: name='([^']+)'/)?.[1];
  if (declaredPackage !== packageName) {
    fail(
      `package identity is ${declaredPackage || 'missing'}; expected ${packageName}.`,
    );
  }
  console.log(`  package: ${packageName}`);

  const declaredVersionCode = badging.match(/versionCode='([^']+)'/)?.[1];
  if (declaredVersionCode !== expectedVersionCode) {
    fail(
      `Android version code is ${declaredVersionCode || 'missing'}; expected ` +
        `${expectedVersionCode} for ${expectedVersionName}.`,
    );
  }
  console.log(`  version code: ${expectedVersionCode}`);

  const declaredVersionName = badging.match(/versionName='([^']+)'/)?.[1];
  if (declaredVersionName !== expectedVersionName) {
    fail(
      `Android version name is ${declaredVersionName || 'missing'}; expected ` +
        `${expectedVersionName}.`,
    );
  }
  console.log(`  version name: ${expectedVersionName}`);

  const permissions = run(
    androidEnvironment.tools.aapt,
    ['dump', 'permissions', apkPath],
    { capture: true },
  );
  for (const permission of requiredPermissions) {
    if (!permissions.includes(permission)) {
      fail(`required Android permission is missing: ${permission}.`);
    }
    console.log(`  permission: ${permission}`);
  }

  const entries = run('unzip', ['-Z1', apkPath], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  if (entries.length === 0) {
    fail('APK contains no readable ZIP entries; the artifact is invalid.');
  }

  const nativeEntries = entries.filter(
    (entry) => entry.startsWith('lib/') && entry.endsWith('.so'),
  );
  if (nativeEntries.some((entry) => !entry.startsWith('lib/arm64-v8a/'))) {
    const unexpectedAbis = nativeEntries
      .filter((entry) => !entry.startsWith('lib/arm64-v8a/'))
      .join(', ');
    fail(`APK contains non-arm64 native libraries: ${unexpectedAbis}.`);
  }

  for (const requiredEntry of requiredNativeEntries) {
    if (!entries.includes(requiredEntry)) {
      fail(
        `required native module is absent: ${requiredEntry}. ` +
          'Check the llama.rn prebuilt artifact and the arm64 Gradle flags.',
      );
    }
    console.log(`  native module: ${requiredEntry}`);
  }

  const dexEntries = entries.filter((entry) => /^classes\d*\.dex$/.test(entry));
  if (dexEntries.length === 0) {
    fail('APK contains no DEX files; the native application artifact is invalid.');
  }
  for (const requiredClass of requiredNativeClassFragments) {
    const found = dexEntries.some((entry) => {
      const result = spawnSync('unzip', ['-p', apkPath, entry], {
        maxBuffer: maxDexBytes,
      });
      return (
        result.status === 0 &&
        Buffer.isBuffer(result.stdout) &&
        result.stdout.includes(Buffer.from(requiredClass.fragment))
      );
    });
    if (!found) {
      fail(
        `required ${requiredClass.label} is absent from the APK. ` +
          'Check Expo autolinking and regenerate the native project.',
      );
    }
    console.log(`  native module: ${requiredClass.label}`);
  }

  run(
    androidEnvironment.tools.zipalign,
    ['-c', '-P', '4', '-v', '4', apkPath],
  );
  console.log('  alignment: valid');

  run(androidEnvironment.tools.apksigner, [
    'verify',
    '--verbose',
    '--print-certs',
    apkPath,
  ]);
  console.log('  signature: valid');
  console.log('APK validation passed.');
}

function main() {
  const apkPath = path.resolve(
    projectDir,
    process.env.APK_PATH || path.relative(projectDir, defaultApkPath),
  );

  if (process.env.SKIP_BUILD === '1' && !fs.existsSync(apkPath)) {
    fail(
      `APK is missing at ${apkPath}. Set APK_PATH to a delivery APK or run without ` +
        'SKIP_BUILD to build the arm64 release APK first.',
    );
  }

  const androidEnvironment = resolveAndroidEnvironment();
  if (process.env.ANDROID_PREFLIGHT_ONLY === '1') {
    printPreflight(androidEnvironment);
    return;
  }
  if (process.env.SKIP_BUILD !== '1') {
    buildApk(androidEnvironment);
  }
  checkApk(apkPath, androidEnvironment);
}

if (require.main === module) {
  main();
}

module.exports = {
  expectedNdkVersion,
  expectedPlatform,
  findSdkTool,
  readReleaseIdentity,
  findSdkCandidates,
  isAndroidSdk,
};
