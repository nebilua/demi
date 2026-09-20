# Architecture

## Local-first mobile app

The primary product is the Expo / React Native app in
`artifacts/second-brain`. AsyncStorage holds non-sensitive settings and model
references. Conversations, memories, profiles, important dates, and the
versioned privacy/agent state use the secure-record boundary. The app does not
require the API server for its default flow.

Local language-model inference uses `llama.rn`, an Android bridge around
llama.cpp. Users import a compatible GGUF model through the device document
picker. Model files are never committed to this repository.

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

`AppContext` persists the capability grants, connector references, schedule
metadata, redacted agent traces, and audit events through
`secureLocalStorage.ts`. Writes are verified before state changes become
visible. Expired records are pruned, action history is bounded, and Settings
can pause, revoke, or clear the state. A global pause blocks local privileged
actions until resumed.

## Platform fallbacks

The web and Expo Go previews cannot load the custom Android modules or
llama.cpp runtime. Their role is interface preview and local storage testing;
they surface honest unavailable/setup states for native-only capabilities.
They also label secure records as local preview storage and do not claim that
Android secure storage protects prompts or transient process memory.