# UI standard: one contract for every app

Yukimi, 2026-11-15 (Yozora #851). Every app on the desktop and on the phone follows this, so new
apps share one design, a theme can be swapped in one place, and no app drifts from the rest.

Short form for agents: `.cursor/rules/ui-standard.mdc` and `.cursor/rules/no-native-browser-ui.mdc`.
Check: `node scripts/check-ui-standard.js` (section 9).

The standard fixes **where a value lives and who draws a control**. It does not change what the
reference measures: a 1:1 measurement of the Vista VM, the XP VM or the WM emulator stays, in the
theme or the kit, where every app gets it.

Each section says what is **in force now** and what **lands with a later slice**. "In force now"
binds all new code and every file you touch. Later-slice items become binding when that slice lands;
until then, do not build a private substitute: use the nearest shared piece and note the gap on #851.

## 1. Platforms and themes

| Platform | Theme | State |
| --- | --- | --- |
| Desktop | **Vista** (Aero; live, frosted or basic glass) | the only desktop look today: "Vista or nothing" |
| Desktop | **XP** (Luna, 1:1 style and handling) | coming; must be complete, with **zero leak** between Vista and XP |
| Desktop | Classic, Vista Basic | boot and logon only |
| Phone | **Windows Mobile 6.1**, **6.5** | user-selectable |

Rules, in force now:

- A theme is **named**. New CSS scopes Vista-only rules by the theme id, never by
  `:not(.windows-classic-theme)` ("not the other one" leaks into every theme added later).
- Until slice 2 lands the id, write Vista-only rules in a theme or kit file, not in app CSS. App CSS
  should not need a theme scope at all: it uses kit classes and tokens.
- Desktop and phone UIs are never on screen together and never cross over on resize
  (`window.uiShell`, decided once at load).
- No script carries its own theme test (`classList.contains('windows-classic-theme')`,
  `localStorage.wmVersion`, a private `isVista()` or `WM65`). Use the shared helper.

Lands with slice 2: `html[data-theme="vista" | "xp"]`, the helper `uiTheme` (`uiTheme.desktop()`,
`uiTheme.phone()`, `uiTheme.is('xp')`), theme folders under `public/css/themes/<id>/`, and a theme's
art root as a token so no path names a theme folder.

**Zero leak** means: with theme A active, no rule, art, font, metric, sound or behaviour written for
theme B applies. A theme file contains only its own theme's selectors; shared structure (layout that
is the same in both) lives in the kit without colours, art or fonts.

## 2. One app descriptor

In force now: an app has one id, one title, one image icon per size, on both platforms. A new app
must be added to every list below in the same change, and the entries must agree.

| List | Where |
| --- | --- |
| Package manifest | `apps/<id>/manifest.json` |
| Start menu / Toolbox | `modalUtils.js` `startMenuLaunchables`, Toolbox rows, `START_MENU_PACKAGE_APPS`, `START_MENU_SYSTEM_PLACES` |
| Phone Programs | `wmPrograms.js` `MAPPED` (and `TOOLBOX_SKIP` when there is no phone app: no lazy ports) |
| Phone lazy load | `wmShell.js` `LAZY_APPS`, `NEEDS_SERVER`, `HD_ART` |
| 6.5 Start art | `wmStart65.js` `APP_ART65` or the app's `art65` |

Lands with slice 1 (after #817's loader): a single registry entry (id, title, publisher, icon set,
Start place, Programs place, single instance, needs server, admin / desktop only, desktop entry,
phone entry, window kind). The lists above are generated from it; the package manifest carries the
same fields.

## 3. Windows and pages come from the factory

### Desktop

Window kinds:

| Kind | Look | Use for |
| --- | --- | --- |
| `app` | light client + `.win7` controls; optional menu bar, command bar, status bar | every application window |
| `dialog` | Vista dialog (`message`, `task`, `form`) | questions, notices, small forms |
| `sheet` | property sheet, Tahoma 11 px, dialog units (`vistaDialogTemplate`) | Properties, Options |
| `tool` | attached tool window | palettes, Find, inspectors |
| `custom` | the base frame and builder, plus the app's own drawn elements | hardware consoles, games, media (section 6) |

In force now:

- New application windows are `app` kind: `data-window-client="light"` and `modal-content win7`.
  **No new dark glass windows.** The existing dark glass windows are defects to migrate (#851).
- Every window has an image icon in the caption (child windows take the parent's) and a taskbar
  image (`window-icon-policy`). Vista art, never a Font Awesome glyph (`vista-icons-not-fa.mdc`).
- Message boxes go through `showConfirmationDialog` / `showInputDialog`. Property sheets and
  wizards go through `vistaDialogTemplate`. Do not hand-build either.
- Do not add an id to the runtime retag list in `vistaDialogs.js`; give the window its attributes.

Lands with slice 3: `openWindow({ kind, ... })` for packages and built-in apps, which writes the
caption, icon, taskbar entry, fault registration, single instance and client attributes. From then
on a hand-written `modal-window-title` skeleton is a violation in new code (the checker already
counts them so the number cannot grow).

### Phone

In force now:

- An app is `wmShell.registerApp({...})`: the shell owns the title bar, corner button, soft keys,
  SIP, history, busy cursor and transitions. An app never draws its own.
- **X ends the app; ok steps back** (`onTitleOk`, then `onBack`).
- **An edit form saves on title ok.** No Save soft key; Cancel is in the Menu. (Yukimi, Nov 15.)
- A desktop program is on the phone only as a real phone app, or not at all (no lazy ports).
- Settings pages use `wmSettings.registerPage`.

Lands with slice 4: a shared page stack (push / pop a layer; soft keys, title kind and history kept
in step by the helper), replacing the private `layers` arrays.

## 4. Controls come from the kit

An app **composes** kit controls; it does not draw a control the kit has. A control the kit lacks is
added to the kit first (in the kit file, for every theme), then used.

### Desktop kit (in force now)

Scope: `:is(.modal[data-window-client="light"], .modal[data-vista-dialog], .win7)` in
`vista-glass-controls.css` on `7.scoped.css`.

| Control | Use |
| --- | --- |
| Push button, default button | `<button>`; default = `[data-dialog-primary]`; 75 x 23 minimum |
| Button row | `.vista-dialog-footer` |
| Check box, radio | `input + label` inside `.win7` |
| Text box, spin, native-skinned edit | plain inputs inside the scope |
| Combo | `.custom-dropdown-btn` + `dropdown.js` |
| Tabs | `menu[role=tablist]` |
| Group box | `fieldset` |
| Trackbar | `input[type=range]` inside the scope only (`sliders-platform.mdc`) |
| Progress bar | the kit progress |
| Link | `a[href]` without a class |
| Menus | `contextMenu.js`; menu bar markup `.naxt-menubar > .naxt-menu-title` |
| Scroll bars | the theme's (`vista-scrollbars.css`, `customScrollbar.js`) |
| Balloon | `PopoverManager` / `showGlassToast` routing (`tray-balloons.mdc`) |
| Message box | `showConfirmationDialog` |

Not in the kit yet (slice 3): one menu bar class set with fixed height and art, command bar, status
bar, list view, tree, window layout classes, busy state, tooltip. Until then reuse the closest
existing shared one (Explorer's command bar, 7.css `.status-bar`, `.naxt-menubar`); do not add a
new private class family.

### Phone kit (in force now)

`wmSettings.ui` in `wmPrograms.js`, styles in `wm-programs.css`: `check`, `radio`, `row`, `value`,
`edit` (`.wm-edit`; multi-line `textarea.wm-edit`), `comboHtml` + `bindCombo` (`.wm-combo`),
`buttons` (`.wm-button`), `listbox`, `trackbar` (`.wm-slider`), tabs `.wm-tabs` **through
`fitTabs`**, `.wm-form-hdr`, `messageBox`. From the shell: `menu`, `dropdown`, `notify`, `appNote`,
`progressBox`, `busy`, `holdMs`, `escapeHtml`, `art`.

Not in the kit yet (slice 4): list row (one-line, two-line), page header band, record form, date
and time picker, scroll container, empty / loading state, hold helper. `wsk-*` (wm-suite-kit) is a
second kit and is frozen: no new uses; it folds into the phone kit in slice 4.

## 5. Tokens: literals belong to the theme

Three layers:

1. **Theme**: semantic roles (window, window text, control face, control border, disabled,
   highlight, highlight text, link, UI font, sheet font, control and row heights, paddings, art
   root). Defined once per theme.
2. **Kit**: uses theme tokens only.
3. **App**: uses kit classes and theme tokens.

In force now, in app CSS and scripts:

- No new colour literal (hex, `rgb()`, `hsl()`), no font family, no art path naming a theme folder,
  no `style="..."` in script templates, no colour set from script. Use an existing token
  (`--wm-highlight`, `--wm-tint`, `--wm-font`, `--wm-fs`, `--wm-px` units on the phone; the kit's
  inherited colours and font on the desktop).
- Phone lengths are `calc(N * var(--wm-px))`, never raw px.
- Fonts are inherited from the window: Segoe UI 9 pt (12 px) in app windows, Tahoma 11 px in
  property sheets, Tahoma via `--wm-font` on the phone. Do not restate them per rule.
- An app's 6.5 rules live in the app's own stylesheet, not in `wm65.css`.

Lands with slice 2: the desktop semantic tokens (there are none today), the phone's missing neutral
and metric tokens, and the theme id.

## 6. Custom apps

An app may look like a third-party program (QuickCast, PayPass, XLink, games, the Director, Studio
surfaces): it uses the base builder and adds its own drawn elements.

- Still from the shell and kit: the frame and caption, icon, taskbar, menus and context menus,
  message boxes, balloons / notifications, file dialogs, scroll bars, fault handling, and on the
  phone the title bar, soft keys and SIP.
- Its own elements are **properly drawn**: every state (normal, hot, pressed, focused, disabled),
  keyboard support, ARIA role. Never a browser default (section 7).
- Its private colours sit in **one token block** at the top of its stylesheet (`--qc-*`), and its
  rules use those tokens. The block is the only place its literals live.
- It declares itself `custom` (window kind) so the choice is visible, not accidental.

## 7. No native browser UI

Nothing the browser draws on its own may reach the screen. Full rule: `no-native-browser-ui.mdc`.
Banned everywhere: the range slider outside the Vista-skinned scope, date / time / colour pickers,
`<select>` lists on the phone, `alert` / `confirm` / `prompt`, `<progress>`, `<meter>`, `<details>`,
`<dialog>`, media `controls`, default focus rings, default scroll bars, validation bubbles,
autofill and spell-check chrome, the default context menu, `title` tooltips in new phone code.

## 8. Behaviour contract

These are standing rules, gathered here:

| Rule | Where |
| --- | --- |
| Image icon on every window; Vista art, not FA | `vista-icons-not-fa.mdc` |
| No toasts. Desktop: tray balloon or message box. Phone: notification or message box | `tray-balloons.mdc`, `toastManager.js` policy |
| Phone: the answer to what the user just did is a message box; something that arrived on its own is a notification. WM notifications never auto-close | `wmShell.notify`, `wmSuiteKit.tell` |
| Sliders follow the platform | `sliders-platform.mdc` |
| No client polling; the server pushes | `server-push-not-polling.mdc` |
| Busy state on a slow tap | `wmShell.busy` |
| WM status glyphs are ROM art, white, never colour | shell |
| Android items in the WM shell use the WM icon when one exists | shell |
| A UI defect you see is fixed or handed on | `fix-ui-issues-you-find.mdc` |
| A Vista or WM behaviour is wired on every call site, and the old feedback retired | (full integration) |
| The device's real quirks are copied, not written off | (1:1) |

Icons an app must ship: desktop master in `public/static_images/app_icons/` (sizes are generated);
phone 6.1 `app-<name>` 16 and `-lg` 32 with @2x and @4x; phone 6.5 `start-<name>` with @2x and
@4x (`docs/design/wm61-icon-style.md`).

Class names: one prefix per app, unique across desktop and phone.

## 9. The check

`node scripts/check-ui-standard.js` counts, per file, what this standard bans, against
`scripts/ui-standard-baseline.json` (the tree on 2026-11-15).

- A count may only go **down**. A new file must be clean. A file you touch may not get worse.
- Run it before every commit that touches `public/css`, `public/scripts/comp`, `public/templates`,
  `public/app.html` or `apps/`. `--list <rule> <file>` shows the lines.
- When your change lowers a count, run `--update` and commit the baseline with it.
- A rise is never recorded by an agent on its own: it needs Yukimi's decision
  (`--accept-rise <rule>:<file>`), named in the commit message.
- Theme and kit files are listed at the top of the script; a new theme file goes under
  `public/css/themes/`.

Rules it counts: `native-range`, `native-picker`, `native-select`, `native-dialog`,
`native-widget`, `native-scrollbar`, `colour-literal`, `colour-in-script`, `font-literal`,
`inline-style`, `theme-negative`, `theme-test-copy`, `theme-art-path`, `hand-built-window`,
`own-menubar`, `own-control`, `toast`.

The check is a floor, not the standard: a file can pass it and still break a rule above.

## 10. Slices

| Slice | What | State |
| --- | --- | --- |
| 0 | This document, the rules, the check (#863) | done |
| 1 | App descriptor registry; hand lists generated | after #817 |
| 2 | Theme id, `uiTheme`, semantic tokens, theme folders; the XP theme plugs in here | next |
| 3 | Desktop window factory and kit gaps; dark glass windows migrated | after #817 for the factory |
| 4 | Phone page stack and kit gaps; `wsk-*` folded in | open |
| 5 | Per-app migrations, tracked by the baseline falling | ongoing |
