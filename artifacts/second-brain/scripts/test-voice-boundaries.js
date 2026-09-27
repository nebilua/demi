const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "react-native") {
    return { Platform: { OS: "web", Version: 0 } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function main() {
  const voice = await import(
    pathToFileURL(path.resolve(__dirname, "../lib/offlineVoice.ts")).href
  );

  assert.equal(voice.voiceMatchesLanguage("en_US", "en-US"), true);
  assert.equal(voice.voiceMatchesLanguage("en-GB", "en-US"), true);
  assert.equal(voice.voiceMatchesLanguage("fr-FR", "en-US"), false);
  assert.equal(
    voice.voiceSelfTestDiagnosis("The local engine failed.").outcome,
    "error",
  );

  const appContext = fs.readFileSync(
    path.resolve(__dirname, "../context/AppContext.tsx"),
    "utf8",
  );
  assert.match(appContext, /PermissionsAndroid\.PERMISSIONS\.RECORD_AUDIO/);
  assert.match(appContext, /local\.voice-input/);
  assert.match(appContext, /local\.voice-output/);
  assert.match(appContext, /startLocalRecognition/);
  assert.match(appContext, /prepareBundledVoiceModels/);
  assert.doesNotMatch(
    appContext,
    /requiresOnDeviceRecognition|com\.google\.android\.|Android 13 or newer/,
  );

  const settings = fs.readFileSync(
    path.resolve(__dirname, "../app/settings.tsx"),
    "utf8",
  );
  assert.match(settings, /offline-speech-setup/);
  assert.match(settings, /offline-tts-setup/);
  assert.match(settings, /voice-recognition-self-test/);
  assert.match(settings, /voice-tts-self-test/);
  assert.match(settings, /English \(US\) is bundled/);
  assert.doesNotMatch(settings, /en-GB|Text-to-speech settings|offline language pack/i);

  const appConfig = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../app.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
  );
  assert.ok(
    appConfig.expo.plugins.includes("./modules/offline-tts/app.plugin.js"),
  );
  assert.ok(
    appConfig.expo.android.permissions.includes("android.permission.RECORD_AUDIO"),
  );
  assert.doesNotMatch(JSON.stringify(appConfig), /expo-speech-recognition|com\.google/);
  assert.equal(packageJson.dependencies["expo-speech-recognition"], undefined);
  const gradleBuild = fs.readFileSync(
    path.resolve(__dirname, "../android/app/build.gradle"),
    "utf8",
  );
  assert.match(gradleBuild, /sherpa-onnx-1\.13\.8\.aar/);
  assert.match(gradleBuild, /lib\/x86_64\/\*\*/);

  const manifest = fs.readFileSync(
    path.resolve(__dirname, "../android/app/src/main/AndroidManifest.xml"),
    "utf8",
  );
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.doesNotMatch(manifest, /com\.google\.android\.|android\.speech\.RecognitionService/);

  const nativeModulePath =
    "../modules/offline-tts/android/src/main/java/com/secondbrain/offlinetts/SecondBrainOfflineVoiceModule.kt";
  const nativeModule = fs.readFileSync(
    path.resolve(__dirname, nativeModulePath),
    "utf8",
  );
  assert.match(nativeModule, /AudioRecord/);
  assert.match(nativeModule, /OfflineRecognizer/);
  assert.match(nativeModule, /OfflineTts/);
  assert.match(nativeModule, /BZip2CompressorInputStream/);
  assert.match(nativeModule, /noBackupFilesDir/);
  assert.match(nativeModule, /MAX_RECORDING_SECONDS/);
  assert.doesNotMatch(nativeModule, /TextToSpeech|com\.google\.android\./);

  const moduleConfig = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../modules/offline-tts/expo-module.config.json"),
      "utf8",
    ),
  );
  assert.deepEqual(moduleConfig.android.modules, [
    "com.secondbrain.offlinetts.SecondBrainOfflineVoiceModule",
  ]);

  const notices = fs.readFileSync(
    path.resolve(__dirname, "../modules/offline-tts/THIRD_PARTY_NOTICES.md"),
    "utf8",
  );
  assert.match(notices, /Apache-2\.0/);
  assert.match(notices, /MIT/);
  assert.match(notices, /GPL-3\.0/);
  assert.match(notices, /public domain/);

  const moduleRoot = path.resolve(__dirname, "../modules/offline-tts");
  const androidAssets = path.join(
    moduleRoot,
    "android/src/main/assets",
  );
  assert.equal(
    fs.readFileSync(path.join(androidAssets, "THIRD_PARTY_NOTICES.md"), "utf8"),
    notices,
  );
  for (const licenseFile of fs.readdirSync(path.join(moduleRoot, "licenses"))) {
    assert.equal(
      fs.readFileSync(
        path.join(androidAssets, "licenses", licenseFile),
        "utf8",
      ),
      fs.readFileSync(path.join(moduleRoot, "licenses", licenseFile), "utf8"),
      `${licenseFile} must be included in Android assets`,
    );
  }

  const files = [
    [
      "../modules/offline-tts/android/libs/sherpa-onnx-1.13.8.aar",
      "633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96",
    ],
    [
      "../modules/offline-tts/android/src/main/assets/voice-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2",
      "d5fe6ec4334fef36255b2a4010412cad4c007e33103fec62fb5d17cad88086f2",
    ],
    [
      "../modules/offline-tts/android/src/main/assets/voice-models/vits-piper-en_US-ljspeech-medium.tar.bz2",
      "3dfb4b759d8be032a4903a9538d128b0fda2a06ab1de6cbc2d93a97e2dd83dba",
    ],
  ];
  for (const [relativePath, expectedHash] of files) {
    const filePath = path.resolve(__dirname, relativePath);
    assert.ok(fs.statSync(filePath).size > 0, `${relativePath} must be bundled`);
    assert.equal(await sha256File(filePath), expectedHash, `${relativePath} checksum`);
  }

  console.log("Bundled offline voice boundary checks passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });