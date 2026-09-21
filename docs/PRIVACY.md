# Privacy

## Scheduled digests and monitors

Scheduled work is opt-in per job and bounded to the sources, cadence, local model
runtime, and execution budget shown in the editor. Digest results and monitor
history stay in the encrypted local job record and are pruned according to the
job's seven- or thirty-day retention setting. Notifications contain only generic
result-ready or change-detected text, never private source content.

Android local notifications provide a reboot-safe best-effort wake-up, but Android
may defer background execution because of battery policy, force-stop, locked-device
state, storage pressure, or revoked notification permission. Demi does not promise
exact-time model execution: it recovers due jobs when the app becomes active and
records failed or missed runs without deleting the job definition. Monitors record
a local baseline and notify only when their configured count condition matches.

Demi is designed so its core experience works without an account.

## Stored on the device

- Conversation history
- Approved memories and their short source excerpts
- Appearance and behavior settings
- Important dates and reminder notes
- References to user-imported GGUF models
- The bounded, user-selected private research library (encrypted document
  metadata and passages)
- Sandboxed code action audit records and results (the selected input is used
  transiently and is not copied into the audit record)
- Encrypted scheduled job definitions, selected file contents, and bounded result history
- Capability grants, connector references, schedules, redacted agent traces, and
  user-visible action history

## Shared with Android system services

- Microphone audio is handled by the selected Android speech-recognition
  service only after offline capability and locale installation are verified
  on Android 13+.
- Reply text is passed to Android TextToSpeech only after a voice that reports
  no network requirement is activated.
- Reminder title, body, and timing are passed to Android's local notification
  scheduler.

## Encryption and user control

On Android, the personal profile, approved memories, saved conversations, and
important dates are stored through Android Keystore-backed encrypted storage.
The device-bound encryption material is never placed in AsyncStorage. Existing
plaintext records are removed only after an encrypted copy is written and read
back successfully.

### Local recovery export

Settings provides a user-started local recovery export. The verified,
versioned JSON package contains only the supported recoverable records: saved
conversation turns, approved memories, the personal profile, important dates,
the encrypted research library, and scheduled work. Android lets the user
choose a destination through the system document flow; the browser preview
downloads the package locally. Demi does not upload the package.

Import validates the format, size, record limits, duplicate IDs, record
shapes, and SHA-256 integrity before asking for confirmation. Confirmation
replaces those supported categories as a transaction; a private on-device
journal restores the previous records if a write, verification, storage, or
cancellation step fails. Imported reminders and scheduled work receive new
device-local notification state rather than reusing notification registrations
from another device. A completed import is read back and reported as verified.

The package never contains GGUF model binaries, Android Keystore or other
device-bound encryption keys, privacy capability grants, raw audit events or
runtime traces, notification registrations, credentials, connector secrets, or
cloud provider secrets. Because the export is portable and not separately
encrypted by Demi, save it only where you trust the storage and treat anyone
with access to the file as able to read the included records. A lost or reset
device-bound key still cannot be recovered through an account or cloud backup.

The browser preview does not have Android Keystore protection. It labels this
state as local preview storage and does not claim device encryption.
The preview is not evidence that Android secure storage, native voice, model
loading, notifications, or offline behavior works on a physical device.

## Capability boundary

Every privileged action has a named capability with a purpose, scope, data
sensitivity, lifetime, network classification, and approval state. The local
model, verified offline voice input/output, and local reminders are separate
capabilities. They can be paused or revoked independently from Settings.

Network connectors, remote inference, and recommended model downloads are
separate capabilities. They are not granted by default, do not run as part of
the local assistant flow, and must
describe the exact data that would leave the device before a future feature can
request approval. Demi does not grant unrestricted device, screen, or connector
access.

### Permissioned screen access

Screen understanding is a separate, session-only capability. It is not
provided by ordinary Android runtime permissions and is never enabled silently.
The session screen shows which of these sources are active:

- **Accessibility text:** only available after the user separately enables
  Demi's declared accessibility service in Android Settings. The service is
  scoped to visible node availability and does not log or retain node text.
- **Screenshot pixels:** requested through Android MediaProjection's
  user-facing consent dialog. The native bridge downsamples into a private
  on-device reader, does not return raw pixels to JavaScript, and releases the
  projection when the session ends, the app is paused, or the kill switch is
  pressed.
- **Selected device resource:** granted by Android's document picker one file at
  a time. Demi does not scan shared storage or other apps' private storage.

Protected windows, password fields, banking content, secure/DRM-protected
content, and content excluded by the user may be withheld by Android or
ignored by the session policy. Demi does not bypass those protections. Screen
processing is local by default, transient data is discarded at session end,
and no connector or remote model receives screen data without a separate
future disclosure and confirmation. Opening Android accessibility settings is
shown as a reversible action preview and requires confirmation.

Opt-in web research is a separate capability. It is off by default and can
only fetch one public HTTPS URL shown in a per-request consent dialog. Demi
does not crawl links or silently open a browser. The fetched page is labeled
as untrusted evidence, is passed to the local model only for the current
answer, and is not retained in the encrypted research library. The user sees
the URL, the model route, and the evidence passages used.

The global privacy pause stops privileged actions and records the decision in
local action history. Clearing capability data removes grants, connector
references, schedules, traces, and audit history; it does not delete
conversations, memories, or imported models.

Sandboxed code actions are off by default and require both the capability grant
and a fresh per-run review. They accept only a small JSON program and explicitly
selected CSV or JSON text. The interpreter has no JavaScript evaluator,
filesystem, network, credential, Android-intent, or native-service access. It
enforces bounded input, rows, cells, steps, runtime, and output, writes no
files, and reports cancellation or failure without changing the selected file
or the rest of the app. Results are shown in the current screen; raw code,
input, and output are omitted from the retained privacy audit summaries.

## Threat boundary and retention

The encrypted agent record is used for capability grants, connector references,
scheduled-job metadata, redacted agent input/output and tool-call traces, and
user-visible audit events. These records are retained for up to 30 days unless
the user clears them sooner. Raw prompts, model outputs, credentials, and
authentication secrets are not placed in ordinary local storage or in the
action-history summary. Future connectors must store only a secure reference,
not a secret value, in this record.

Android system services may receive only the data required for an approved
capability: microphone audio during active dictation, reply text for a verified
offline voice, or reminder content and timing for a local notification.
Transient prompts and model outputs exist in the local process while inference
is running. Android Keystore-backed storage does **not** encrypt model prompts
or transient process memory, and Demi does not claim that it does.

The web preview uses local preview storage rather than Android Keystore
protection. It is an interface and persistence preview, not proof of Android
device encryption. No account, cloud sync, remote inference, analytics SDK, or
server-side private-data store is introduced by this foundation.

Research answers are not verification claims. When no matching source passage
is available, the UI says that the answer is not verified by a source. HTML
scripts and styles are removed before display, local files are bounded before
indexing, unsupported/binary files are rejected, and low-storage checks fail
before a file is read into the research library. Cancellation prevents a late
result from replacing the current workspace state.

Memory suggestions are generated by the local model and remain unsaved until
the user saves or edits them. Date suggestions open the Important Dates editor
prefilled but unsaved. Approved memories can be searched, edited, archived, or
deleted in the Memory vault. A lost or reset device-bound key cannot be
recovered through an account or cloud backup.

## Not included by default

- User accounts
- Cloud conversation sync
- Remote AI inference
- Analytics or advertising SDKs
- Bundled model weights

The optional API server is reserved for future opt-in functionality and is not
part of the default mobile flow.

## User responsibility

Android speech and TTS engines are separate software selected and installed by
the device owner. Demi checks the capabilities exposed by Android but
cannot audit a third-party engine's implementation. Users should choose an
engine they trust and install its offline language or voice data.

Imported model files have their own licenses and privacy characteristics. Only
use models from trusted sources whose terms permit your intended use.
