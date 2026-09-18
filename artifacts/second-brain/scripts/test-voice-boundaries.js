const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'react-native') {
    return { Platform: { OS: 'web', Version: 0 } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const voice = await import(
    pathToFileURL(path.resolve(__dirname, '../lib/offlineVoice.ts')).href
  );

  assert.equal(voice.voiceMatchesLanguage('en_US', 'en-US'), true);
  assert.equal(voice.voiceMatchesLanguage('en-GB', 'en-US'), true);
  assert.equal(voice.voiceMatchesLanguage('fr-FR', 'en-US'), false);
  assert.equal(voice.voiceMatchesLanguage('EN-us', 'en_US'), true);

  const appContext = fs.readFileSync(
    path.resolve(__dirname, '../context/AppContext.tsx'),
    'utf8',
  );
  assert.match(appContext, /Platform\.OS !== 'android'/);
  assert.match(appContext, /androidApiLevel < 33/);
  assert.match(appContext, /requestPermissionsAsync/);
  assert.match(appContext, /requiresOnDeviceRecognition: true/);
  assert.match(appContext, /event\.error === 'network'/);
  assert.match(appContext, /spokenRepliesEnabled/);
  assert.match(appContext, /No verified offline Android voice is installed/);

  const ttsModule = fs.readFileSync(
    path.resolve(
      __dirname,
      '../modules/offline-tts/android/src/main/java/com/secondbrain/offlinetts/SecondBrainOfflineTtsModule.kt',
    ),
    'utf8',
  );
  assert.match(ttsModule, /!voice\.isNetworkConnectionRequired/);
  assert.match(ttsModule, /ERR_NO_OFFLINE_VOICE/);
  assert.match(ttsModule, /resolveAllAsStopped/);

  console.log('Voice boundary checks passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
  });