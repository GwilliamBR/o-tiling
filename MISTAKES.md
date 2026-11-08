# Mistakes Log

Lessons learned from past agent sessions. Agents must read this file at the start of each session to avoid repeating known mistakes.

---

## Launcher Stylesheet Media Queries and Key Handling

**Date:** 2026-11-08
**Category:** Logic error

**What happened:**
The launcher was stuck in light mode and pressing the Escape key did not close the window.

**Root cause:**
1. The GNOME Shell St stylesheet parser does not support CSS `@media` queries. Putting dark mode styles inside `@media (prefers-color-scheme: dark)` caused them to be completely ignored, keeping the hardcoded light theme active.
2. Modern GNOME dark mode is primarily toggled through `org.gnome.desktop.interface color-scheme` (`prefer-dark` vs `default`), not just `gtk-theme`.
3. In `search_dialog.ts`, key event throttling checked `event.get_flags() !== Clutter.EventFlags.NONE` and returned `EVENT_PROPAGATE` for any non-arrow keys. On Wayland and X11, events often contain flags, causing Escape to return early and never reach the dismissal branch.

**How it was fixed:**
1. Defaulted the launcher stylesheet to dark mode and added a `.light` class modifier applied dynamically when light mode is detected.
2. Updated `is_dark()` in settings to check `org.gnome.desktop.interface color-scheme` and synced appearance on settings changes.
3. Attached a `captured-event` handler to the modal dialog to intercept `Clutter.KEY_Escape` immediately, and placed the Escape check at the top of the key press handler before key repeat throttling.

**Prevention rule:**
Never use CSS `@media` queries in GNOME Shell extension stylesheets. Always toggle classes dynamically on actors and listen to `org.gnome.desktop.interface` changes. In Clutter key handlers, place modal exit keys (like Escape) before any repeat-throttling logic.
