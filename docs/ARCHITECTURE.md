# Architecture

This guide describes how the app is implemented. For the user-facing account of
data handling, privacy controls, and recovery limits, see
[Privacy](PRIVACY.md).

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

## Bundled offline voice

`modules/offline-tts` packages sherpa-onnx, the Moonshine Tiny English
recognizer, and the Piper US English voice. In the installed Android app,
`AudioRecord` captures user-started microphone input and sherpa-onnx runs
recognition and speech synthesis locally; neither Android speech recognition
nor Android TextToSpeech is used. The app requests microphone permission and
checks the separate local voice capability before dictation.

The model archives are included in the Android app and extracted into its
private, no-backup storage when prepared. They are not downloaded at runtime.
The bundled voice currently supports US English only. License notices and
checksums for the packaged components are in
`modules/offline-tts/THIRD_PARTY_NOTICES.md`.

## Calendar and notifications

Important dates are stored locally. Android receives only the notification
content and trigger needed to show the alert. One-time and annual notification
identifiers are retained so edits and deletions can cancel previous alerts.

## Optional API

`artifacts/api-server` and shared `lib` packages provide optional network
features, including remote inference. The default local assistant flow does
not call them. Remote inference requires a configured server-managed provider
and a separate active capability approval; it receives only a bounded,
redacted current-task input (up to 1,800 characters) when local inference is
unavailable or fails for an eligible device/runtime reason. Email addresses,
phone numbers, and token-like secrets are redacted. The request includes its
task and local-failure reason, not saved conversation history, profile,
memories, files, contacts, or screen content. Running the API service requires
a PostgreSQL `DATABASE_URL`.

## Privacy capability boundary

`lib/privacyCapabilities.ts` is the common model for every privileged action.
It describes purpose, data scope, sensitivity, lifetime, network use, approval
state, and destructive-action requirements. Local capabilities remain
account-free and follow the approval state defined for each capability.
Remote inference and recommended model downloads are off by default and need
separate approval. Screen access uses a visible, session-only flow; scheduled
actions require per-job opt-in. Model downloads have their own network
capability and approval.

## Permissioned screen and device access

`modules/screen-access` is an Android-only Expo module. It has three narrow
boundaries rather than a generic device-control API:

1. The user-enabled accessibility service reads bounded visible text, withholds
   editable/password fields and excluded applications, and can take one
   user-requested screenshot on Android 11+. Bundled open-source English
   Tesseract OCR converts pixels to text locally. Pixels never reach JavaScript
   or the GGUF. The former availability-only MediaProjection API now explicitly
   reports unavailable; it does not pretend discarded frames are usable input.
2. A selected resource retains its readable URI only for this request. Text,
   Markdown, CSV, JSON, PNG and JPEG are supported with byte/pixel limits.
   Unsupported formats fail explicitly. Imported images cannot be app-excluded
   automatically, so the UI requires review.
3. Capture, review and attachment are distinct states. Generation receives at
   most 6,000 characters of untrusted evidence, further bounded by real tokenizer
   counts. Epoch, consent and expiry checks run before capture completion,
   queued inference, each stream callback and final delivery.

The React context owns an ephemeral session and a persisted screen policy
(retention and excluded-app rules). Sessions stop on app pause and expose a
kill switch. Actions that leave the session or open Android settings are
previewed and confirmed; there is no generic model-facing tap/type primitive.

Screen-derived conversation pairs are transient and explicitly filtered at both
conversation persistence and export boundaries. Subsequent unshared prompts
exclude those pairs. Native prompt and KV tensor data are cleared inside the
same serialized operation after each shared request, including failures.
They cannot trigger cloud fallback, reminder parsing,
memory extraction or spoken replies.

## Native model scheduling and budgets

All native context operations share one priority queue: foreground chat,
interactive tools/research, then scheduled work and explicit memory extraction.
Release retires a context immediately but waits for running work; queued old
users cannot enter the released context. There is no overlapping completion.
Callers recheck current capabilities and cancellation before and during work.
Normal chat no longer requests optional background extraction after every turn.

Prompts are formatted with the runtime chat template, then tokenized with the
runtime tokenizer. Reserve output tokens and safety space first, keep the
current request intact, add bounded shared evidence and recent complete turns,
then optional personal context if it fits. Saved history is not trimmed.
Oversized current requests fail clearly. Native failures use fixed sanitized
categories and preserve already streamed output; the affected context is
retired so the model can be loaded again.

Diagnostics contain context/token counts, first-token/load/generation timings
and sanitized error categories, never private inputs or model paths. Settings
exposes recent native measurements. CPU/thread/batch defaults are unchanged;
there is no unmeasured GPU or Pixel performance claim. See
`DEMI_REPAIR_VERIFICATION.md` for evidence limits.

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
they surface unavailable/setup states for native-only capabilities. The
privacy page describes the preview's storage and recovery limitations.
