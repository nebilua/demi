---
name: Cross-platform confirmations
description: Destructive confirmations in the Expo app must behave consistently on native and web previews.
---

Use an in-app modal for destructive confirmations instead of relying on the React Native system alert API.

**Why:** The Expo web preview rendered the clear-history action but did not expose a usable confirmation callback, so the destructive operation silently did nothing.

**How to apply:** For any destructive action that must work in both Expo Go and the web preview, render explicit cancel and confirm controls inside the app and verify the callback changes visible state.