# Demi repair verification

## Evidence and limits

The reported Android failure, third-turn HostFunction exception and Pixel
slowness were reports, not reproduced device failures in this workspace.
Inspection and deterministic tests confirmed inconsistent voice consent paths,
immediately expiring session grants, unbounded chat history, overlapping native
completion callers and availability-only screen sources.

The repair tests run the real React provider, prompt builder and native-operation
scheduler with mocked Android/llama boundaries. They prove JavaScript behavior,
not recognition accuracy, native OCR accuracy or physical-device performance.
`adb devices` returned no attached devices. The user's exact Qwen2.5-3B Q4 GGUF
and its checksum are not available here. No physical Pixel or installed-APK
behavior has been marked passed.

The rebuilt arm64 release APK passed native class/library, bundled English OCR
and offline-speech asset, package identity, permissions, alignment and signature
checks. It is an alpha artifact signed with the existing Android debug key,
not a production release. Output:
`artifacts/second-brain/android/app/build/outputs/apk/release/app-release.apk`
(ignored build output). SHA-256:
`54f8f6d2189aa7810c3af4d4312157275f3b5a1c211d2cda7f9323e0b5569fbf`.
This includes the final direct-route navigation and session fixes.

## Affected entry-point smoke matrix

“Working” below means the stated automated check, not a physical-device claim.

| Entry point | Automated result / expected state | Android-only evidence still required |
|---|---|---|
| Home orange microphone | Working provider/component checks: independent of LLM readiness; preserves typed draft; final transcript editable, never auto-sent; actionable error + Settings route | Real recording, stop latency, transcript accuracy, repeated attempts in airplane mode |
| Home stop/cancel, Settings microphone test | Working provider checks: same preference/consent/readiness/mic permission; late session IDs ignored; denial and recovery; no native call when paused/revoked | Actual never-ask-again recovery, rapid tap/stop/cancel, background during native initialization |
| Spoken replies / Settings voice sample | Capability checks and session-scoped callbacks; Home interrupts speech before listening; Voice setup consolidated, input/output preferences and tests retained | Real playback interruption, model preparation failure/retry and airplane mode |
| Model load / Home chat | Six sequential turns, no unsolicited extraction completions, concurrent tools serialized, release waits, reload recovers from injected bridge failure | Exact third/later-turn native failure reproduction and sustained Pixel memory usage |
| Long/tiny-context chat | Real prompt-budget code with mocked token counts: current request and output reserve retained, complete old pairs removed only from prompt; oversized current request rejected | Actual Qwen tokenizer/template counts and native cache behavior |
| Partial-stream failure | Valid partial reply and original user request retained; fixed recoverable error; raw native exception/path omitted | Native exception behavior and reload on phone |
| Privacy & Permissions | Session approval immediately usable; restart expires sessions; background ends session grants; timed grants and global pause remain separate; app approval distinct from Android permissions | Android runtime permission refresh after Settings return and notifications on Android 13+ |
| Contacts / connectors | Unavailable, not “enabled” by a grant. No duplicate contacts reader | Contacts implementation remains separate work |
| Screen visible-text source | Real source-to-prompt provider checks; no attachment before review; excluded/protected/empty snapshots rejected | Actual accessibility trees, excluded apps, editable/password fields and complex-window fail-closed behavior |
| Screen screenshot OCR | Native one-shot screenshot + bundled open-source English OCR; mocked OCR source-to-review check | Real hardware buffer, Android secure-window rejection, OCR accuracy, app-switch/background and excluded-window races |
| Selected text/image resource | URI retained for a single explicit read; supported text/Markdown/CSV/JSON or PNG/JPEG; bounded size; unsupported formats explicit; local.files revocation clears data | Real document-provider URIs, image decoding/OCR, expired URI grants |
| Screen review/share/Home attachment | Working provider checks: review separate from attachment, epoch/expiry checked, local-only prompt, untrusted evidence, token-bounded excerpt, no raw image to GGUF | User review/edit/share navigation and Android font rendering |
| Screen Stop/pause/revoke/background/policy | Working provider checks: late capture withheld, attachments and transient derived turns cleared; future ordinary prompts exclude shared text | Native callback timing while stopping/revoking; physical background transitions |
| Screen privacy boundaries | Saved conversation, audit and diagnostic assertions omit sentinel shared text and derived questions; export filters transient turns; native KV-cache wipe requested within the operation; no cloud call or memory extraction | Device logcat inspection and native cache wipe behavior without collecting private test content |
| Settings, Home/menu, scheduled list | Real component checks cover navigation, compact-width controls, confirmations and voice spacing. Scheduled backend checks preserve create/edit/pause/resume/run/retry/delete/results/failures | Native enlarged-font layout, keyboard behavior, safe areas and screen-reader order |
| Browser / Expo Go | Native voice, model execution and screen/OCR unavailable, stated honestly; layout only | Not substitutes for installed Android checks |

## Deterministic checks

Browser smoke at 320×640 reached Home after the optional profile setup/startup
transition settled; it did not reproduce a persistent blank or network/page
errors. Voice, app-vs-Android permission labels, unavailable contacts and disabled
web screen capture were visible. Direct-route Back was repaired with an explicit
Settings fallback and a component regression. A scheduled create attempt without
app approval was blocked with no saved job; this is a consent boundary, not a
successful create. Scheduled creation with approval remains covered by the
deterministic provider checks, not a claimed successful browser save. The browser
does not offer an app-specific font-size preference; system large-font layout
still requires a device. Component action checks use a compact 320×640,
fontScale=2 fixture, not native font rendering.

Run from the repository root:

```sh
pnpm --filter @workspace/second-brain typecheck
pnpm --filter @workspace/second-brain verify:android-alpha
pnpm --filter @workspace/second-brain profile:runtime
pnpm --filter @workspace/second-brain preflight:android-alpha
pnpm --filter @workspace/second-brain validate:android-apk
```

The deterministic gate includes the real-provider repair harness, feature,
component failure, voice, privacy, tool, cloud, export, scheduled, research,
Android release identity and static-build checks. `profile:runtime` validates
the metric contract, not device speed. The APK check builds an arm64 release,
checks native classes/libraries and bundled OCR/speech data, identity,
permissions, signature and alignment. A built APK still requires installation.
No production deployment or public release is part of this repair.

## Pixel benchmark record — not measured

Required device: user's Pixel 9 Pro XL. Required model: user's exact
Qwen2.5-3B Q4 GGUF, recorded with its SHA-256. Neither is available to execute
the comparison here. The exact HostFunction message/stack was not available;
the harness injects a representative sanitized bridge failure, not a claimed
reproduction.

| Metric | Before | After | Reason not measured |
|---|---|---|---|
| Cold native load, ms | Unmeasured | Unmeasured | No connected Pixel/exact model |
| Warm first token, ms | Unmeasured | Unmeasured | No connected Pixel/exact model |
| Native generated tokens/s | Unmeasured | Unmeasured | No connected Pixel/exact model |
| Turns 1, 3, 6, 10 | Reported failure around turn 3; unverified | Six-turn mocked-native regression passes; physical result unmeasured | No connected Pixel/exact model |
| CPU/thread/batch/cache alternatives | Unmeasured | Defaults unchanged | No valid comparative device measurement |
| GPU/acceleration | Not established | Not enabled or claimed | No verified supported backend measurement |

Retained defaults: CPU, zero GPU layers, mmap enabled, mlock off, batch 256,
microbatch 128, four threads (three on the existing low-memory profile), existing
device-selected context size. The imported model is not replaced or deleted.
A smaller model remains an explicit optional import/download, not an automatic
quality reduction.

For a real comparison, record Android version, app/APK hash, model hash, context,
threads/batch and thermal/battery state. Start from a cold process for load;
then run the same public non-private requests and output budget for ten turns
on baseline and repaired builds. Record first-token latency and native
`predicted_per_second` for each turn, not streaming chunk counts. Use
Settings → AI model → Diagnostics for the bounded timing records; capture
only counters/timings/error categories, never prompts, transcripts or paths.
Benchmark changed thread/cache choices individually before changing defaults.

## Screen implementation choice

The old MediaProjection path discarded frames and was not a content source.
It was replaced with an explicit one-shot Accessibility screenshot, rather
than continuous foreground-service capture. Leaving Demi stops sharing; for
another app the user deliberately imports its screenshot. Android
Accessibility must be enabled separately. This is intentionally not live
vision, background monitoring, autonomous device control or secure-window
bypass. Bundled English Tesseract OCR is open source and needs no runtime
network download; non-English OCR is not claimed.
