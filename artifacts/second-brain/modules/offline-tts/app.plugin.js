const { withAppBuildGradle } = require("@expo/config-plugins");

const sherpaDependency =
  'implementation files("$rootDir/../modules/offline-tts/android/libs/sherpa-onnx-1.13.8.aar")';
const arm64OnlyJniExcludes =
  'excludes += ["lib/armeabi-v7a/**", "lib/x86/**", "lib/x86_64/**"]';

module.exports = function withOfflineVoice(config) {
  return withAppBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;
    if (!contents.includes(sherpaDependency)) {
      const dependencyBlock = /dependencies\s*\{/;
      if (!dependencyBlock.test(contents)) {
        throw new Error("Could not find the Android app dependencies block.");
      }
      contents = contents.replace(
        dependencyBlock,
        (match) => `${match}\n    ${sherpaDependency}`,
      );
    }
    if (!contents.includes(arm64OnlyJniExcludes)) {
      const jniLibsBlock = /jniLibs\s*\{/;
      if (!jniLibsBlock.test(contents)) {
        throw new Error("Could not find Android JNI packaging options.");
      }
      contents = contents.replace(
        jniLibsBlock,
        (match) => `${match}\n            ${arm64OnlyJniExcludes}`,
      );
    }
    mod.modResults.contents = contents;
    return mod;
  });
};