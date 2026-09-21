# Architecture

## Local-first mobile app

The primary product is the Expo / React Native app in
`artifacts/second-brain`. AsyncStorage holds non-sensitive settings and model
references. Conversations, memories, profiles, important dates, and the
versioned privacy/agent state use the secure-record boundary. On Android, that
boundary is backed by Android Keystore through `expo-secure-store`; in the
browser preview it falls back to local preview storage without Keystore
protection. The app does not require the API server for its default flow.

Local language-model inference uses `llama.rn`, an Android bridge around
llama.cpp. Users import a compatible GGUF model through the device document
picker. Model files are never committed to this repository.

## Private research workspace

`context/ResearchContext.tsx` owns the private research library. The user
selects TXT, Markdown, CSV, or JSON files through the scoped document picker.
Files are bounded to 120 KB each and 12 documents total, split into bounded
passages, and written to a verified encrypted secure record. The retrieval
function is deterministic, caps the number of passages and passages per source,
excludes archived documents, and removes deleted documents before the next
query. Source text is wrapped as untrusted evidence in the local-model prompt,
so document instructions cannot become Demi instructions.

Research results are transient. The UI shows the local file names or the one
approved web URL used, labels the model output as interpretation, and lets the
user forget the result. Web mode is disabled by default, accepts one public
HTTPS URL, does not follow links, and fetches only after a per-request consent
surface. Fetched web text is passed to the on-device model and is not stored in
the local library. Remote inference is a separate capability and is not used by
this workspace.

## Voice privacy boundary

Recognition is available only in an installed native Android build. Android
13+ is required because earlier versions can treat offline recognition as a
preference rather than a guarantee. Demi verifies that the selected
locale is installed for offline recognition before dictation begins.

Spoken replies use a small local Expo module wrapping Android
`TextToSpeech`. It rejects voices that require a network connection, are not
installed, or fail activation.

## Calendar and notifications

Important dates are stored locally. Android receives only the notification
content and trigger needed to show the alert. One-time and annual notification
identifiers are retained so edits and deletions can cancel previous alerts.

## Optional API

`artifacts/api-server` and the shared `lib` packages reserve a path for
explicit opt-in network features. They are not called by the default local
assistant experience. Running that service requires a PostgreSQL
`DATABASE_URL`.

## Privacy capability boundary

`lib/privacyCapabilities.ts` is the common model for every privileged action.
It describes purpose, data scope, sensitivity, lifetime, network use, approval
state, and destructive-action requirements. Local capabilities remain
account-free and default to the existing on-device behavior. Network,
connector, screen, and future automation capabilities are separate and
ungranted until an explicit future approval flow exists.
The recommended model download is also represented separately as a network
capability; users must enable it before a model file is fetched.

## Permissioned screen and device access

`modules/screen-access` is an Android-only Expo module. It has three narrow
boundaries rather than a generic device-control API:

1. MediaProjection requests Android's consent dialog and feeds a tiny native
   `ImageReader` only to confirm capture availability. It does not expose a
   screenshot byte array to JavaScript or write screen pixels to logs.
2. The declared accessibility service is independently enabled by the user in
   Android Settings. It reports bounded node availability for the active
   window, never stores node text, and cannot be enabled by Demi.
3. The document picker grants one user-selected resource. App-scoped storage,
   contacts/calendar providers, and ordinary runtime permissions remain
   separate capabilities and do not imply screen access.

The React context owns an ephemeral session and a persisted screen policy
(retention and excluded-app rules). Sessions stop on app pause and expose a
kill switch. Actions that leave the session or open Android settings are
previewed and confirmed; there is no generic model-facing tap/type primitive.

`AppContext` persists the capability grants, connector references, schedule
metadata, redacted agent traces, and audit events through
`secureLocalStorage.ts`. Writes are verified before state changes become
visible. Expired records are pruned, action history is bounded, and Settings
can pause, revoke, or clear the state. A global pause blocks local privileged
actions until resumed.

## Sandboxed code actions

Sandboxed code actions use a deliberately small JSON program language interpreted
by `lib/sandboxCode.ts`. The supported operations are bounded arithmetic,
count, sum, average, filter, and field selection over one explicitly selected
CSV or JSON input. This is not JavaScript execution: there is no evaluator,
module loader, shell, filesystem API, network API, credential access, Android
intent, or native-service bridge.

The code action capability is not granted by default. Each run presents the
program, selected input, privacy impact, and limits before execution. The
interpreter enforces input, row, column, cell, output, step, and wall-clock
budgets, reports stdout/stderr and resource usage, and returns no generated
files. Cancellation and malformed, oversized, or interrupted runs are recorded
as non-successful results without mutating app data. Any future write, message,
or system action must be a separate typed tool outside this interpreter.

## Platform fallbacks

The web and Expo Go previews cannot load the custom Android modules or
llama.cpp runtime. Their role is interface preview and local storage testing;
they surface honest unavailable/setup states for native-only capabilities.
They also label secure records as local preview storage and do not claim that
Android secure storage protects prompts or transient process memory. A lost or
reset device-bound key cannot be recovered through an account or cloud backup.
