# Demi

Demi is a personal assistant for Android. It keeps your chats and personal
information on your phone by default, and you don’t need an account to use it.
You can use it offline with a compatible model you choose.

## Try it on your computer

You’ll need Node.js 24 and pnpm 10. From the project folder, run:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @workspace/second-brain run dev
```

This opens a preview so you can look around. Some features—like offline voice,
Android storage protection, and running a model—need an Android build to test.

## A few things to know

- Demi includes bundled English voice input and spoken replies that work offline on
  supported Android devices.
- Model files aren’t included. Import a compatible model in **Settings** to use
  on-device replies.
- Online features are optional and ask for permission before they’re used.

## More

- [How Demi handles your data](docs/PRIVACY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)
- [Android release checklist](docs/ANDROID_ALPHA_RELEASE.md)
- [Other project guides](docs/)
- [License](LICENSE)

Imported models have their own licenses, so check the terms before using one.
Demi’s code is released under the MIT License.
