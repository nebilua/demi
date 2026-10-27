# Demi alpha.3 focused beta checks

This is a focused regression record, not a public-beta readiness claim.

## Fixes in this baseline

- The Home composer now gives the close, attach, and send controls fixed 44-point touch targets and lets its multiline input shrink within a narrow row.
- Home is the single launcher for screen access, sandboxed code actions, and private research. Settings retains permission decisions, revocation, configuration, and optional connector status.
- The reminder time switch has its own labeled row. Date and time fields use matching input geometry and stack on narrow screens or when system text is enlarged.
- Timed reminder values survive create, edit, save, reopening, and notification retry. Date-only reminders continue to use 9:00 AM local time.

## Automated checks

The component regression, feature-flow, Android reminder scheduling, Android release identity, and TypeScript checks cover:

- First-run Home/model-not-ready presentation and a visible failed-response message.
- Long multiline composer drafts at a 280-point width, with close, attachment, send, and reopen interactions.
- Local document selection, cancellation, local send, and permission revocation handling.
- Home navigation to screen access, sandboxed actions, private research, and Settings; Settings permission and connector controls remain available without duplicate launch links.
- Reminder create/edit/reopen/delete, responsive date/time layouts, exact timed values, date-only 9:00 AM scheduling, and notification permission denial/recovery.

## Not verified on a device

No Android device or emulator is attached to this workspace. These checks remain unverified:

- Android keyboard resizing, IME transitions, and real touch behavior on a phone.
- Native first-launch model installation/loading and actual inference performance.
- The operating system's document picker and notification permission prompt.
- Reminder sound, background delivery, exact-alarm behavior, and notification recovery after changing Android permissions.
- Whether this APK's signing certificate can update an earlier tester installation. Keep exported app data before replacing an installation if Android reports a signature conflict; do not clear app data as a troubleshooting step.

The web preview shows the date/time fields side by side at 402 points and stacked at 360 points. The first-run Home preview shows onboarding, so the composer is verified by component checks rather than a visual Home screenshot. Neither preview is Android-device evidence.

Do not treat the automated checks or this alpha build as evidence of production or public-beta readiness.
