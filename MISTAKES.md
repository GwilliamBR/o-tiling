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

---

## ModalDialog Style Class Targeting and StEntry Focus Outlines

**Date:** 2026-11-08
**Category:** Logic error

**What happened:**
The launcher did not update to light mode despite system settings, and the search input displayed two focus outlines with a stuck blue cursor.

**Root cause:**
1. In GNOME Shell's `ModalDialog`, the style classes passed in constructor parameters (such as `o-tiling-search modal-dialog`) are placed on `dialogLayout._dialog`, not on the root `ModalDialog` widget. Calling `add_style_class_name` solely on `this.dialog` left `dialogLayout._dialog` without `.light`, so light mode CSS rules never matched.
2. In GNOME Shell themes, `StEntry:focus` has a default focus ring outline or box-shadow. Adding a custom `border-color` without specifying `outline: none` and `box-shadow: none` resulted in both borders rendering simultaneously.

**How it was fixed:**
1. Updated `sync_appearance` to add and remove theme and accent classes on both `this.dialog` and `dialogLayout._dialog`.
2. Added `outline: none; box-shadow: none;` to `.o-tiling-entry` and `.o-tiling-entry:focus`, and softened dialog outer shadow to `0 2px 6px`.

**Prevention rule:**
When styling GNOME Shell `ModalDialog` instances dynamically, always apply style classes to `this.dialog.dialogLayout._dialog` alongside `this.dialog`. When customizing `StEntry` focus borders, explicitly reset `outline` and `box-shadow` to avoid stacking on the shell's default focus ring.

---

## Color Scheme Fallback to GTK Theme and Cross-Workspace Window Activation

**Date:** 2026-11-08
**Category:** Logic error

**What happened:**
The launcher stayed in dark mode when the system was switched to light mode, and selecting a window from a different workspace in the launcher did not switch to that workspace.

**Root cause:**
1. On GNOME 42+, switching to Light mode sets `org.gnome.desktop.interface color-scheme` to `'default'`, while `gtk-theme` on CachyOS remained `'adw-gtk3-dark'`. In `is_dark()`, only `'prefer-light'` returned `false`, so `'default'` fell through to checking `gtk-theme`, matched `'dark'`, and returned `true`.
2. In `src/window/window.ts`, `activate()` had a guard skipping `workspace.activate_with_focus` whenever `workspace.index() !== active_index`. When `dbus.WindowFocus` called `target_window.activate()`, that guard blocked workspace switching.

**How it was fixed:**
1. Returned `scheme === 'prefer-dark'` directly in `is_dark()` whenever the `color-scheme` key exists.
2. Added `switch_workspace` parameter to `activate()`, passed `true` from `dbus.WindowFocus`, closed the launcher before activation, and fell back to `global.get_current_time()` when `Clutter.get_current_event_time()` is 0.

**Prevention rule:**
On GNOME 42+, treat `color-scheme` as the authoritative source of truth (`'prefer-dark'` = dark, `'default'` / `'prefer-light'` = light) without falling back to `gtk-theme`. When explicitly focusing a window from user navigation or launcher selection, bypass background workspace-switch guards and ensure a valid timestamp is passed to `activate_with_focus`.

---

## Overlay Scrollbar Dimensions, Proportional Right Spacing, and Gutter Overlap

**Date:** 2026-11-09
**Category:** Logic error

**What happened:**
The overlay scrollbar in the launcher overlapped the right side of the search result items, was wider than native GNOME scrollbars, and had a dragged color darker than upstream GNOME.

**Root cause:**
1. `StScrollView` ignores CSS `margin-right` on its child `StBoxLayout` because it forces its scroll child to allocate to the full viewport width. Therefore, `margin-right: 12px` on the list did not inset the search elements, causing them to extend under the overlay scrollbar.
2. The scrollbar widths needed to be cut in half to match native GNOME: 1px thumb with 1px right spacing in half-width state, and 2px thumb with 2px right spacing in full-width state.
3. The dragged state gray was too dark (#5e5c64 / #46454b) compared to upstream GNOME Shell (#868689 / #a4a4a6).

**How it was fixed:**
1. Added `padding-right: 12px` to `.o-tiling-search-list` so `StBoxLayout` insets each result row by 12px, providing a clear 6px gutter before the 6px max scrollbar.
2. Cut scrollbar widths in half: set `StScrollBar` `min-width: 3px` with `border: 1px solid transparent` on `.vhandle` and `trough` for half-width (1px thumb, 1px right spacing); `min-width: 6px` with `border: 2px solid transparent` for full-width (2px thumb, 2px right spacing).
3. Used user-preferred deeper dark gray for dragged state: `#5e5c64` in dark mode and `#46454b` in light mode.

**Prevention rule:**
For GNOME-style overlay scrollbars in `StScrollView`, never rely on `margin-right` on the scroll child because `StScrollView` ignores it. Always use `padding-right` on the container `StBoxLayout` to inset list rows away from the scrollbar. For proportional spacing matching thumb width `W`, use `min-width: 3 * W` with `border: W solid transparent` on the handle.

---

## Forbidden Gdk Imports in Extension Process

**Date:** 2026-11-10
**Category:** Outdated knowledge

**What happened:**
The GitHub Actions release build failed during the check for forbidden `gi://Gdk` imports in extension files.

**Root cause:**
`src/ui/launcher/search_dialog.ts` imported `gi://Gdk` to convert key symbols (`Gdk.keyval_name`, `Gdk.keyval_to_upper`). GNOME Shell extensions run inside the Shell compositor process, where Gdk is strictly forbidden to prevent conflicts with Clutter and Mutter.

**How it was fixed:**
Replaced `Gdk` with standard `Clutter.KEY_*` constants for all keyboard navigation and shortcuts, and removed `import Gdk from 'gi://Gdk'`.

**Prevention rule:**
Never import `gi://Gdk` in GNOME Shell extension files outside preferences (`prefs.js` / `color_dialog`). Use `Clutter.KEY_*` constants and Clutter events for all keyboard input.




