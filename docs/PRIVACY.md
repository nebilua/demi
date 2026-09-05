# Privacy

Second Brain is designed so its core experience works without an account.

## Stored on the device

- Conversation history
- Appearance and behavior settings
- Important dates and reminder notes
- References to user-imported GGUF models

## Shared with Android system services

- Microphone audio is handled by the selected Android speech-recognition
  service only after offline capability and locale installation are verified
  on Android 13+.
- Reply text is passed to Android TextToSpeech only after a voice that reports
  no network requirement is activated.
- Reminder title, body, and timing are passed to Android's local notification
  scheduler.

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
the device owner. Second Brain checks the capabilities exposed by Android but
cannot audit a third-party engine's implementation. Users should choose an
engine they trust and install its offline language or voice data.

Imported model files have their own licenses and privacy characteristics. Only
use models from trusted sources whose terms permit your intended use.