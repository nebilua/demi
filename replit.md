# Second Brain

A local-first Android personal assistant for private, natural conversations stored on the device.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/second-brain run dev` — run the Expo mobile preview
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo, Expo Router, React Native, TypeScript
- Local persistence: AsyncStorage
- API: Express 5 (reserved for later opt-in network features)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/second-brain/app/index.tsx` — local chat, offline voice controls, and conversation persistence
- `artifacts/second-brain/app/settings.tsx` — appearance, voice, model, and local-data controls
- `artifacts/second-brain/lib/offlineLlm.ts` — Android llama.cpp model runtime boundary
- `artifacts/second-brain/lib/offlineVoice.ts` — Android on-device recognition and verified offline speech boundary
- `artifacts/second-brain/modules/offline-tts` — local Android module that rejects network-backed TTS voices
- `artifacts/second-brain/constants/colors.ts` — mobile color tokens
- `artifacts/second-brain/assets/images/icon.png` — app icon
- `artifacts/api-server` — shared API service for future opt-in network features

## Architecture decisions

- The local-first default stores conversation turns and settings with AsyncStorage; no backend or database is required.
- Real model inference runs through llama.cpp in an installed native Android build after the user imports a compatible GGUF file.
- Voice input requires Android 13+ on-device recognition and a verified installed offline language pack; Android 12 and older are blocked to prevent network fallback.
- Spoken replies use only Android voices marked as not requiring a network connection; speaking stays unavailable until such a voice is installed.
- The product uses Rubik throughout the mobile interface.

## Product

- A private welcome state establishes local-only behavior.
- Users can send messages, see a local response state, and reopen saved conversation history on the same device.
- Users can configure appearance, haptics, and conversation saving from a dedicated Settings screen.
- Users can dictate editable text offline and listen to or immediately stop locally spoken replies.
- Users can install/manage Android offline recognition data and choose automatic spoken replies and speaking pace.
- Users can review the saved message count and clear local history through a cross-platform confirmation flow.
- Loading, storage-error, typing, disabled-send, empty, and persisted-chat states are handled.

## User preferences

- Keep cloud fallback, accounts, semantic memory, and task integrations opt-in and out of the local-first default.

## Gotchas

- The Expo preview starts through the managed `artifacts/second-brain: expo` workflow so preview environment variables are available.
- Native llama.cpp and offline recognition require an installed Android native build; Expo Go and the browser preview remain honest setup/text previews.
- Android publishing is not handled by Replit's Expo Launch; the static app config includes the package identity and native plugins needed by an external Android build pipeline.
- Use an in-app confirmation modal for destructive actions; React Native system alerts do not provide a reliable confirmation flow in the web preview.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
