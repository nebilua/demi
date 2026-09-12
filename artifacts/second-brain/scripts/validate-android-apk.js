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

const documentedSdkPath =
  '/nix/store/rcpalf7dyjk0bz0ly2j6lkf51b89ramk-androidsdk/libexec/android-sdk';
const packageName = 'com.secondbrain.localassistant';
const requiredPermissions = [
  'android.permission.RECORD_AUDIO',
  'android.permission.POST_NOTIFICATIONS',
];
const requiredNativeEntries = ['lib/arm64-v8a/librnllama.so'];

function fail(message) {
  console.error(`\nAPK validation failed: ${message}`);
  process.exit(1);
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
      .filter((entry) => entry.isDirectory())
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

function resolveAndroidEnvironment() {
  const sdkPath =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    (fs.existsSync(documentedSdkPath) ? documentedSdkPath : '');

  if (!sdkPath || !fs.existsSync(sdkPath)) {
    fail(
      'Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT to an installed SDK ' +
        `before running this check (the documented default was ${documentedSdkPath}).`,
    );
  }

  const configuredNdk = process.env.ANDROID_NDK_HOME;
  const documentedNdk = path.join(sdkPath, 'ndk', '27.1.12297006');
  const ndkPath =
    configuredNdk || (fs.existsSync(documentedNdk) ? documentedNdk : '');

  if (!ndkPath || !fs.existsSync(ndkPath)) {
    fail(
      'Android NDK 27.1.12297006 not found. Set ANDROID_NDK_HOME to that installed ' +
        'NDK before running the constrained arm64 build.',
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

function buildApk(androidEnvironment) {
  console.log('Building arm64 release APK with the documented constrained flags...');
  run('pnpm', ['exec', 'expo', 'prebuild', '--platform', 'android'], {
    env: androidEnvironment.env,
  });
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

const apkPath = path.resolve(
  projectDir,
  process.env.APK_PATH || path.relative(projectDir, defaultApkPath),
);

if (process.env.SKIP_BUILD === '1' && !fs.existsSync(apkPath)) {
  fail(
    `APK is missing at ${apkPath}. Set APK_PATH to a delivery APK or run without ` +
      'SKIP_BUILD to build the arm64 debug APK first.',
  );
}

const androidEnvironment = resolveAndroidEnvironment();
if (process.env.SKIP_BUILD !== '1') {
  buildApk(androidEnvironment);
}
checkApk(apkPath, androidEnvironment);
