# Demi

Demi is an Android assistant that keeps your chats on your device by default.
Keep online features optional and don’t claim that a preview proves an Android
feature works.

## Getting started

Use Node.js 24 and pnpm 10:

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/second-brain run dev
```

Useful checks:

- `pnpm run typecheck` — check the project
- `pnpm run build` — check and build the packages
- `pnpm --filter @workspace/api-server run dev` — start the optional API server

The API server needs `DATABASE_URL`. The mobile preview does not.

## Where to look

- `artifacts/second-brain/app/` — app screens
- `artifacts/second-brain/lib/` — local model, voice, and privacy features
- `artifacts/second-brain/modules/` — Android-specific features
- `artifacts/api-server/` — optional server

## Please keep in mind

- Chats and settings stay local by default. Keep cloud features off unless the
  user clearly chooses them.
- Real model replies and offline voice need an installed Android build. The
  browser and Expo Go previews are useful for checking screens, not those
  Android-only features.
- Android speech input needs Android 13 or newer and its offline language pack.
- Android’s secure storage protects saved data on the device; it does not
  encrypt prompts while the app is using them.
- Ask for confirmation before clearing data or doing anything destructive.
- See `docs/PRIVACY.md` before changing what Demi stores, shares, or sends online.
