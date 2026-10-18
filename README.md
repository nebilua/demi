# Demi

Demi is an open-source, local-first Android personal assistant. By default, it
keeps conversations and personal data on your device, works without an account,
and can run replies with a compatible GGUF model you choose. The Android app
also bundles US English offline dictation and spoken replies.

## Get started

Requirements: Node.js 24 and pnpm 10. Start the mobile preview with:

```bash
git clone https://github.com/nebilua/second-brain.git
cd second-brain
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @workspace/second-brain run dev
```

For native Android development, install Android Studio and its SDK, then run:

```bash
cd artifacts/second-brain
pnpm exec expo prebuild --platform android
pnpm exec expo run:android
```

In Demi, prepare the bundled English voice in **Settings → Local voice setup**
and import a compatible GGUF model in **Settings → Model setup & diagnostics**
for local replies. Model weights are not included. The browser and Expo Go
previews are for interface checks; they cannot verify native voice, model
loading, Android secure storage, or offline behavior.

## Guides

- [Privacy and data handling](docs/PRIVACY.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)
- [Android alpha release checklist](docs/ANDROID_ALPHA_RELEASE.md) — required
  workspace, APK, and physical-device checks before distributing an alpha
- [Dependency license audit](docs/DEPENDENCY_LICENSES.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Demi is released under the [MIT License](LICENSE). Imported model files have
their own licenses; use only models whose terms permit your intended use.
