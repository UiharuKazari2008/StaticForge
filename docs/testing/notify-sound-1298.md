# Notification sound picker (StaticForge #1298)

Settings > Sounds & Notifications > Sounds > "Notification sound:" opens a full-page picker (Windows Mobile list idiom, soft keys
Select / Back). Yukimi: not every sound in one list, "show a view to select it". Files: `public/scripts/comp/wmNotifySound.js`,
`public/css/wm-notify-sound.css`, the Sounds tab in `wmSettingsPersonal.js`, and the Settings sub-view hooks in `wmPrograms.js`
(`subView()`: a page's `viewDepth / viewTitle / softKeys / back / viewOk`). The sounds come from the Android app's
`window.AndroidSounds` (version 1); where it is missing the row is not drawn.

## Automatic

```
node scripts/test-notify-sound-picker.js
```

Runs the real `wmNotifySound.js` in a fake phone page with a fake bridge (3 categories, 120 sounds in one). It checks: no bridge,
no row; level 1 names two defaults and the categories (count, chevron) and never a sound; a category shows 50 + Show more
(never more than 50 per `list()` call, 120 in the end); search goes through `list(cat, query, 0, 50)` after 250 ms and does not
redraw the page; a tap highlights and previews, Play / Stop follow the `androidsoundpreview` event; Select chooses; commit writes
`AndroidSounds.set('sound', id, title, category)` once (and `set('none'|'default', '', '', '')` for the defaults); Back goes
level 2 > 1 > the page, then the page's own; previews stop on Back, on save, on leaving the page and when another program
comes forward; a refused save is told once; nothing plays on open. No sound is played by the test.

The Settings hooks in `wmPrograms.js` are not covered by it (that file is not loadable without the shell): test them on the phone.

## By hand (the A53, a build with `AndroidSounds`)

1. Settings > Sounds & Notifications > Sounds: the row "Notification sound:" shows Event sounds, under it the note. In a browser
   (no `AndroidSounds`) the row is absent.
2. Tap the row: level 1 shows Event sounds (default), None and the categories with counts. No sound is named. The choice in use
   is ticked (a category when the sound belongs to it). The soft keys read Select / Back; the title band reads "Notification
   sound"; the tab strip is gone.
3. Select a category (highlight it, Select, or tap it twice): search box, sounds 50 at a time, "Show more" at the end of the list.
   Tapping a row highlights it and plays it once; Play / Stop on that row follows the sound (stops by itself after about 8 s).
   Type in the box: the list narrows after a short pause and the keyboard stays up. Clear it: the first page returns.
4. Select returns to the page showing the sound's title; Back goes up one level (2 > 1 > page) with no choice made; the phone's
   back key and the corner ok do the same steps (ok on a highlighted sound or on Event sounds / None chooses it). The page's
   own scroll is where it was.
5. Nothing is written until ok on the page: leave with Back x3 and the old sound stays. OK saves (`AndroidSounds.set`); a refusal
   shows one message box and keeps the page open.
6. Home / another program while a preview plays: it stops. No toast, balloon or "saved" message appears at any point; a sound
   plays only from a tap on a row or on Play (`wm-notify-sound-preview`, `scripts/notice-sources.d/notify-sound-1298.json`).
7. 6.1, 6.5 and 6.5.1: the tick, the chevron and the Stop square follow the text colour; the highlighted row stays one line,
   long titles end in an ellipsis.

## Checks

`node --check` on the edited files, `scripts/check-ui-standard.js`, `check-app-scope.js`, `check-perf-rules.js`,
`check-notifications.js` (see the turn's report).
