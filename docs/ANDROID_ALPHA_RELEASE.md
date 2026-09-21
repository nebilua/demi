# Android alpha release checklist

This checklist is the go/no-go gate for the `0.1.0-alpha.1` Android alpha.
It separates checks that can be reproduced in the workspace from evidence that
requires a physical Android device. Passing it does not mean Demi is
production-ready, published to a store, synchronized to the cloud, or
recoverable across devices.

## Release identity

- [ ] The app and workspace package versions are `0.1.0-alpha.1`.
- [ ] The APK reports Android package `com.secondbrain.localassistant`.
- [ ] The APK reports Android `versionCode` 1 for this first alpha.
- [ ] Any later installable artifact increments `versionCode`; it never reuses
      a code, including for a new alpha build with the same version name.
- [ ] The delivery copy is the arm64 artifact at
      `artifacts/second-brain/releases/demi-release-arm64-v8a.apk`.
- [ ] Record the APK SHA-256, version name/code, build date, and tester-facing
      artifact filename.

## Workspace hard gates

Run from the repository root:

```bash
pnpm run verify:android-alpha
```

This one command runs typecheck and the complete deterministic suite. It
includes the feature, component-failure, voice-boundary, reminder,
scheduled-job, privacy, cloud-fallback, tool-registry, sandbox-code, and
research suites. It also runs the build cleanup/port checks and the static
artifact checks.

The static checks are the existing release-server validation matrix in
`artifacts/second-brain/scripts/test-static-build.js`, invoked through these
package scripts:

- `test:static-build` — active release health, manifests, bundles, and assets
- `test:release-cleanup` — retained-release cleanup
- `test:build-lock` — concurrent build locking
- `test:build-failure` — failed-build cleanup and incomplete-output handling

Do not replace these checks with a browser preview. The static server returns
HTTP 200 only for a complete healthy release and HTTP 503 for unavailable or
invalid output.

## APK hard gate

With the documented Android SDK, build-tools, and NDK
`27.1.12297006` available, run:

```bash
pnpm --filter @workspace/second-brain run validate:android-apk
```

The validator performs the constrained arm64 release build unless `SKIP_BUILD=1`
is set, then checks package identity, microphone and notification permissions,
arm64-only native libraries including `librnllama.so`, native voice/TTS
modules, DEX contents, zip alignment, and APK signature. If the SDK or NDK is
unavailable, record the gate as **blocked**, not passed; do not infer APK
validity from the JavaScript or browser suites.

## Physical-device evidence

Use a supported arm64 Android phone running Android 13 or newer. Record device
model, Android version, ABI, APK SHA-256, app version/code, test date, and any
network state used. These checks are not automated by
`verify:android-alpha`:

- [ ] **Voice and model:** grant microphone permission; install an offline
      English speech locale; confirm dictation starts only after offline setup
      reports ready and the resulting text remains editable. Import a
      compatible GGUF model, load it, receive a local response, restart the
      app, and confirm the model remains available.
- [ ] **Offline behavior:** repeat dictation and local model response with
      network access disabled. Record any unexpected network dependency or
      unavailable state.
- [ ] **Notifications:** grant notification permission, create a one-time and
      annual reminder, confirm delivery, then edit and delete them. Confirm
      behavior after an app restart.
- [ ] **Permissions and recovery:** deny microphone and notification access,
      confirm the app explains the unavailable capability, then grant access
      and retry successfully. Do not treat a permission prompt shown in a
      browser as evidence.
- [ ] **Compact layout:** exercise a compact phone, display cutout, gesture
      navigation, keyboard, portrait rotation policy, and long conversation or
      settings content. Confirm controls remain reachable and editable.
- [ ] **Restart and persistence:** force-stop and relaunch after saving a
      conversation, memory, important date, settings change, and model
      reference. Confirm the saved state is present and no action is reported
      complete before its write succeeds.
- [ ] **Low storage:** use a device with constrained free space or a controlled
      low-storage test condition. Confirm model/research imports fail clearly,
      do not replace valid prior data, and do not leave unsafe partial files.

## Known limitations and stop conditions

- The local-first boundary has no account, cloud conversation sync, remote
  inference in the default flow, or multi-device recovery. A lost or reset
  Android device-bound key cannot be recovered through the project.
- Android speech and TTS engines are device-supplied. Demi checks the
  capabilities they report but cannot certify a third-party engine.
- Browser and Expo Go previews use local preview storage and cannot prove
  Android Keystore protection, native llama.cpp/model loading, native voice,
  notifications, permissions, restart behavior, storage pressure, or offline
  behavior.
- Stop distribution if any workspace hard gate, APK check, or required device
  check fails; preserve the failing logs and artifact identity.
- If a later build is invalid, do not overwrite a known-good delivery copy or
  promote incomplete static output. Return to the last verified artifact and
  rerun the gate. This checklist does not automate store rollback or
  publication.

The alpha is **go** only when all workspace hard gates, the APK hard gate, and
the required supported-device evidence are recorded for the exact artifact
being distributed. Otherwise it is **no-go** or **blocked**, with the missing
evidence named explicitly.
