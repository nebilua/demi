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

- `artifacts/second-brain/app/index.tsx` — Phase 1 chat surface and local conversation persistence
- `artifacts/second-brain/constants/colors.ts` — mobile color tokens
- `artifacts/second-brain/assets/images/icon.png` — app icon
- `artifacts/api-server` — shared API service for future opt-in network features

## Architecture decisions

- Phase 1 is frontend-only and stores conversation turns with AsyncStorage; no backend or database is required for the local-first default.
- The app is intentionally a single focused chat screen without tabs or account flows.
- The UI uses the scaffold's Expo-compatible dependencies and keeps the inference boundary local so native model loading can be added without changing the conversation surface.

## Product

- A private welcome state establishes local-only behavior.
- Users can send messages, see a local response state, and reopen saved conversation history on the same device.
- Loading, storage-error, typing, disabled-send, empty, and persisted-chat states are handled.

## User preferences

- Keep the build within the phased scope from the Second Brain brief; do not add calendar, todo, voice, or cloud fallback before those phases are requested.

## Gotchas

- The Expo preview starts through the managed `artifacts/second-brain: expo` workflow so preview environment variables are available.
- Native llama.cpp model loading is intentionally kept behind the local inference boundary; adding it will require an Android-compatible native build path rather than Expo Go alone.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
