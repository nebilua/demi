# Second Brain

Second Brain is an open-source, local-first Android personal assistant. Its
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

Second Brain does not upload chats or imported models in its default
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

## Models

No model weights are bundled or redistributed. Import only GGUF files whose
license permits your intended use. Model licenses are separate from Second
Brain's MIT license and from the dependency audit in this repository.

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

Second Brain is released under the [MIT License](LICENSE). Third-party
libraries, fonts, data, and user-supplied models remain under their respective
licenses.