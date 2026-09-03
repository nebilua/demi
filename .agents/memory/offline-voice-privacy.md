---
name: Offline voice privacy boundary
description: Why private dictation is restricted to verified Android on-device recognition.
---

Enable private voice input only on Android 13 or newer and only after the selected locale appears in the recognizer's installed offline locales. For speech output, select only voices Android explicitly marks as not requiring a network connection.

**Why:** Android 12 can honor offline recognition as a preference rather than a guarantee. Android's default TTS engine can also choose a network-backed voice even when installed voices are listed, so generic TTS availability is not proof of local speech.

**How to apply:** Preserve the recognition gate and installed-locale check. For output, reject voices marked network-required and disable speech when no verified offline voice matches the selected language.