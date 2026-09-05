# Dependency License Audit

Audit date: 2026-09-04

Second Brain accepts software dependencies only when they declare an
OSI-approved open-source license. Font and data packages must use recognized
open-content licenses and carry required attribution.

## Method

The audit is generated from the complete pnpm workspace lockfile:

```bash
pnpm licenses list --json
```

Both runtime and development dependencies, including transitive packages, are
included. Package manifests with missing or unknown license metadata are
treated as unverified and are removed rather than assumed to be open source.

## Accepted license families

- MIT
- Apache-2.0
- BSD-2-Clause and BSD-3-Clause
- ISC
- 0BSD
- BlueOak-1.0.0
- MPL-2.0
- Python-2.0
- Unlicense
- Compatible dual-license expressions containing the licenses above
- OFL-1.1 for the bundled Rubik font files
- CC0-1.0 and CC-BY-4.0 for non-code browser compatibility data

`caniuse-lite` combines CC0-licensed code with CC-BY-4.0 browser compatibility
data. Its attribution is preserved in `THIRD_PARTY_NOTICES.md`.

`node-forge` offers BSD-3-Clause or GPL-2.0; this project uses it under the
BSD-3-Clause option.

## Removed during the public-release audit

The following development packages did not declare a license in their
installed package metadata and were removed:

- `@replit/connectors-sdk`
- `@replit/vite-plugin-cartographer`
- `@replit/vite-plugin-runtime-error-modal`
- `create-launch`

None is required for the shipped local-first Android experience.

## Verification policy

Run the command above after every dependency update. A release is blocked if
the result contains `Unknown`, a proprietary license, a source-available-only
license, noncommercial terms, or a copyleft license that is incompatible with
the intended distribution.

This inventory is a practical engineering review, not legal advice.