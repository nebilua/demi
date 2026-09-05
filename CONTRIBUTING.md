# Contributing to Second Brain

Thank you for helping improve a private, local-first assistant.

## Ground rules

- Preserve the offline, local-first default. Network features must be optional,
  explicit, and honest about what leaves the device.
- Add only dependencies with a declared OSI-approved open-source software
  license. Data or font packages must use an appropriate open-content license
  and include required attribution.
- Never commit model files, secrets, signing keys, local databases, generated
  Android/iOS projects, or user conversation data.
- Keep browser and Expo Go fallbacks honest when a feature requires native
  Android modules.
- Use in-app confirmation dialogs for destructive cross-platform actions.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/second-brain exec expo install --check
```

Run the mobile preview with:

```bash
pnpm --filter @workspace/second-brain run dev
```

## Pull requests

1. Keep each pull request focused on one user-visible change.
2. Explain privacy, storage, permission, and offline implications.
3. List any new direct or transitive dependencies and their licenses.
4. Run the workspace typecheck and Expo dependency check.
5. Include narrow Android screenshots for interface changes.
6. Never include third-party model weights in a pull request.

By contributing, you agree that your contribution is licensed under the
project's MIT License.