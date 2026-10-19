# Privacy

The short version: Demi keeps your chats and personal details on your Android
device by default. You don’t need an account, and Demi doesn’t sync your chats
to the cloud. Online features are separate and off until you choose to use them.

## What stays on your device

Demi can store your chats, saved memories, profile, reminders, settings, imported
models, and files you choose for research or scheduled work. It also keeps a
record of approved actions so you can review what happened.

On Android, saved personal data is protected with device-bound encryption.
That protects stored data; it does not encrypt a prompt while the app is using
it. The browser preview does not have Android’s encryption, so it should not be
treated as proof of Android security.

## Voice, reminders, and background work

- Voice input and spoken replies are processed on your device with the bundled
  English models: sherpa-onnx runs Moonshine recognition and Piper speech.
  Audio and reply text aren’t sent to a speech service.
- Android receives reminder text and timing to show local notifications.
- Scheduled work is optional. Notifications use general wording rather than
  showing private source text. Android may delay background work, so Demi
  can’t promise that it will run at an exact time.
- Scheduled results stay on your device and are removed based on the retention
  period shown for that job.

## Online features

Remote inference (remote replies), web research, model downloads, and connected services are
optional. Each has its own approval.

If you turn on remote replies, Demi may send the current-task input—up to 1,800
characters—to the provider you selected when an eligible local reply can’t run.
It redacts email addresses, phone numbers, and token-like secrets. The request
identifies the task and reason for fallback. Saved conversation history, profile,
memories, files, contacts, and screen content are not sent with that request.

Web research only opens one public web address that you approve. The page is
used for that answer and isn’t saved to your research library. Demi treats
webpage content as untrusted and shows you the source used.

Connected services need a separate connection and review for each action.
They don’t get general access to your phone or screen.

## Screen and file access

Screen sharing is off until you approve a session, capture text, review it, and
attach it to one local request. App approval is separate from Android
Accessibility access. A snapshot reads visible non-editable accessibility text,
or uses Android 11+'s one-shot accessibility screenshot API with bundled English
Tesseract OCR. There is no continuous MediaProjection session or live vision.
For another app, explicitly select a screenshot or supported text file.

Capture is bounded to 6,000 characters and a two-minute review window; prompt
token limits may reduce the shared excerpt further. It is treated as untrusted
data, not instructions. Only extracted text reaches the local text-only model.
Raw screenshots are not written to storage. OCR language data is bundled in the
APK, copied into no-backup app storage, and never downloaded at runtime.

Screen text and screen-derived questions and answers are transient: they are
never implicitly saved to chat, memories, exports, cloud fallback, action history,
or diagnostic logs. Clear-on-start and clear-after-request policies control when
the reviewed attachment disappears, not whether it is saved. Stop, revocation,
privacy pause, backgrounding, session expiry, and source-policy changes discard
the attachment and transient conversation. App-snapshot exclusions match Android
package or application name. Editable/password fields are withheld; a password
field blocks the entire snapshot. Android secure-window errors are not bypassed.
An imported file cannot reveal which app it came from or which fields were
protected: review and remove private text yourself before sharing it.

Session approval lasts until backgrounding, explicit stop/revocation, or process
end. It is not restored as active on restart. Timed grants expire by their clock;
global pause blocks actions without silently changing Android permissions.

When you choose a file, Demi can use that file for the feature you selected.
It doesn’t scan shared storage or other apps’ private files on its own.

## Exporting and restoring your data

You can start a local recovery export from Settings. Demi doesn’t upload it.
The export includes supported items such as chats, saved memories, your profile,
important dates, research files, and scheduled work. It does not include model
files, device encryption keys, permissions, credentials, or private action
traces.

The export file is not separately encrypted by Demi. Anyone who can open the
file can read its contents, so save it somewhere you trust. Restoring it replaces
the supported data after you confirm. Demi checks the file and verifies the
restore; it can roll back if something goes wrong. A lost device encryption key
cannot be recovered through an account or cloud backup.

## Your controls

You can pause or revoke optional capabilities in Settings. Clearing capability
records removes permissions, connected-service references, schedules, and
action history; it does not clear your chats, memories, or imported models.
Memory and date suggestions aren’t saved unless you choose to save them.

Code actions are off by default. If enabled, they work only with a CSV or JSON
file you select, run limited calculations on-device, and cannot use the network
or change files.

## What Demi doesn’t do by default

- Create an account or sync chats to the cloud
- Send data to a remote model or connected service without separate approval
- Include language-model weights in the app
- Use advertising or analytics software

Imported models have their own privacy practices and licenses. Only use models
you trust.
