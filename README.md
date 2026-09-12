# Demi

Demi is an open-source, local-first Android personal assistant. Its
default experience keeps conversations, settings, model files, and important
dates on the device instead of requiring an account or cloud service.

## What it does

- Runs compatible GGUF language models locally through
  [llama.rn](https://github.com/mybigday/llama.rn)
- Stores conversation history and settings on-device with AsyncStorage
- Supports Android 13+ offline speech recognition when an installed offline
  language pack is available
- Speaks replies using only Android text-to-speech voices that report no
  network requirement
- Tracks birthdays, anniversaries, and other important dates in a separate
  local calendar
- Schedules one-time and annual Android notifications
- Handles display cutouts, gesture navigation, keyboards, and compact screens
- Keeps the API server optional and outside the default local-first flow

## Privacy model

Demi does not upload chats or imported models in its default
configuration. Conversation history, settings, and calendar entries are stored
locally. The user chooses and imports their own GGUF model.

Android's speech and TTS services are supplied by the device. To prevent an
accidental cloud fallback, voice recognition is limited to Android 13+ and
requires an installed offline locale; spoken replies use only voices that
Android marks as not requiring a network connection.

See [docs/PRIVACY.md](docs/PRIVACY.md) for the complete boundary and known
limitations.

## Requirements

- Node.js 24
- pnpm 10
- Android 13 or newer for private offline voice input
- Android Studio and an Android SDK for native development builds
- A compatible quantized GGUF model for local AI responses

The browser and Expo Go previews cannot run llama.cpp or the custom native
offline speech modules. They intentionally show setup or unavailable states
instead of pretending those capabilities work.

## Set up the workspace

```bash
git clone https://github.com/nebilua/second-brain.git
cd second-brain
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
```

Start the Expo development server:

```bash
pnpm --filter @workspace/second-brain run dev
```

The optional API server is not required by the mobile app's default flow. To
run it, provide a PostgreSQL `DATABASE_URL`, then:

```bash
pnpm --filter @workspace/api-server run dev
```

## Build an Android development app

Native offline inference, recognition, TTS, and notifications require a custom
Android build rather than Expo Go.

```bash
cd artifacts/second-brain
pnpm exec expo prebuild --platform android
pnpm exec expo run:android
```

The generated `android/` directory is intentionally ignored. Re-run prebuild
after changing Expo plugins or native configuration. Do not commit signing
keys, keystores, imported GGUF models, or generated native output.

### Build a downloadable APK

The repository's standalone release artifact targets `arm64-v8a`, the ABI used
by supported modern Android phones. It includes the native llama.rn,
speech-recognition, offline TTS, and notification modules; it does not require
Expo Go. With the Android SDK and NDK installed, run:

```bash
cd artifacts/second-brain
pnpm exec expo prebuild --platform android

export ANDROID_HOME=/nix/store/rcpalf7dyjk0bz0ly2j6lkf51b89ramk-androidsdk/libexec/android-sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
export CMAKE_BUILD_PARALLEL_LEVEL=1

cd android
./gradlew assembleRelease --no-daemon --console=plain --max-workers=1 \
  -Dorg.gradle.parallel=false \
  -Dorg.gradle.jvmargs='-Xmx2048m -XX:MaxMetaspaceSize=512m' \
  -PrnllamaBuildFromSource=false \
  -PreactNativeArchitectures=arm64-v8a \
  -PrnllamaVariants=rnllama
```

The generated APK is `android/app/build/outputs/apk/release/app-release.apk`.
The build includes llama.rn's generic arm64 runtime, which works on supported
arm64 devices without CPU-feature assumptions. For delivery, preserve a copy
outside generated native output at
`artifacts/second-brain/releases/demi-release-arm64-v8a.apk`. The
`rnllamaBuildFromSource=false` flag uses llama.rn's Android prebuilt native
libraries and keeps the build reproducible on a constrained workspace.

Run the named packaging smoke check before handing an APK to a tester:

```bash
pnpm --filter @workspace/second-brain run validate:android-apk
```

The check performs the constrained arm64 build above, then verifies that the
APK has the `com.secondbrain.localassistant` package identity, microphone and
notification permissions, only arm64 native libraries including
`librnllama.so`, valid zip alignment, and a valid Android signature. To inspect
an existing delivery copy without rebuilding, set `SKIP_BUILD=1` and
`APK_PATH`:

```bash
SKIP_BUILD=1 APK_PATH=releases/demi-release-arm64-v8a.apk \
  pnpm --filter @workspace/second-brain run validate:android-apk
```

Install it on a compatible phone with Android's file installer, or with:

```bash
adb install -r artifacts/second-brain/releases/demi-debug-arm64-v8a.apk
```

On first launch, allow microphone access for voice input and notification
access for reminders. Private offline dictation additionally requires Android
13 or newer and an installed English offline language pack; use the app's
offline voice setup action if Android needs to download that language pack.
Open the model import action and select a compatible GGUF file separately:
model weights are not bundled in the APK and must not be redistributed with
the project. The debug APK is arm64-only and cannot be installed on
unsupported ABIs.

## Models

No model weights are bundled or redistributed. Import only GGUF files whose
license permits your intended use. Model licenses are separate from Demi's MIT
license and from the dependency audit in this repository.

## Repository layout

```text
artifacts/second-brain/  Expo / React Native Android app
artifacts/api-server/    optional Express API service
lib/                     shared API, database, and validation packages
scripts/                 workspace maintenance scripts
docs/                    privacy, architecture, and license audit notes
```

## Open-source policy

Project libraries must use declared open-source licenses. The complete
lockfile is audited before public releases, and dependencies with absent,
proprietary, source-available-only, or noncommercial terms are not accepted.
See [docs/DEPENDENCY_LICENSES.md](docs/DEPENDENCY_LICENSES.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Contributing

Issues and pull requests are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before making a change.

## License

Demi is released under the [MIT License](LICENSE). Third-party
libraries, fonts, data, and user-supplied models remain under their respective
licenses.