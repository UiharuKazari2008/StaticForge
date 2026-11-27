# Notification sound picker (StaticForge #1298)

Settings > Sounds & Notifications > Sounds > "Notification sound:" opens a full-page picker (Windows Mobile list idiom, soft keys
Select / Back). Yukimi: not every sound in one list, "show a view to select it". Files: `public/scripts/comp/wmNotifySound.js`,
`public/css/wm-notify-sound.css`, the Sounds tab in `wmSettingsPersonal.js`, and the Settings sub-view hooks in `wmPrograms.js`
(`subView()`: a page's `viewDepth / viewTitle / softKeys / back / viewOk`). The sounds come from the Android app's
`window.AndroidSounds` (version 1); where it is missing the row is not drawn.

## Automatic

```
node scripts/test-notify-sound-picker.js
node scripts/test-notify-sound-choice-page.js
```

`test-notify-sound-choice-page.js` is the page in front: it cuts `playSystemSound` and `noteSoundChoice` out of `wmShell.js` and
runs them in a vm with stubs. The page asks the app through `AndroidSounds.note(eventId)` for a notification (`ev.kind ===
'note'`) with no pick of hers: `'chosen'` = the app started the chosen sound (the page plays nothing, the log says
`android/chosen`), `'silent'` = None (nothing plays), anything else, a missing `note` (older app), no bridge or a throwing call =
the event's own WM file as before. It is not asked for her own pick (`prefs.own`, a workspace desktop pick), Play sound off, the
phone's sound mode not On, the 300 ms rate limit (a repeat with `again` asks again) or an event-kind sound (error, warning ...).
It takes an optional path to another `wmShell.js` to prove the checks fail on a shell without the change.

`test-notify-sound-picker.js` (it too takes an optional path to a copy of `wmNotifySound.js`) runs the real `wmNotifySound.js` in
a fake phone page with a fake bridge (3 categories, 120 sounds in one). It checks: no bridge,
no row; level 1 names two defaults and the categories (count, chevron) and never a sound; a category shows 50 + Show more
(never more than 50 per `list()` call, 120 in the end); search goes through `list(cat, query, 0, 50)` after 250 ms and does not
redraw the page; a tap highlights and previews, Play / Stop follow the `androidsoundpreview` event; Select chooses; commit writes
`AndroidSounds.set('sound', id, title, category)` once (and `set('none'|'default', '', '', '')` for the defaults); Back goes
level 2 > 1 > the page, then the page's own; previews stop on Back, on save, on leaving the page and when another program
comes forward; a refused save is told once; nothing plays on open; the screen going off (`melatonscreen`), the page hidden
(`visibilitychange`) and the shell behind an Android program (`wmBehind`) each stop the preview only (the picker stays open, the
Play button goes back to Play, nothing is redrawn) and the listeners are gone once the picker closes; the sound in use, when it
is not on the first page of its category, is the first row (ticked, highlighted, plays and selects like any row, once after Show
more, not pinned with a search text or in another category); opening the picker stops the Notifications tab's preview
(`wmShell.sounds.stop`); every way out (Back, Select, ok, leaving, the away events) sends `stop` to the app even when the page
lost track of a preview (preview A, preview B, A's `stopped` event, Back: a `stop` follows the last `preview`). No sound is played
by the test.

The Settings hooks in `wmPrograms.js` are not covered by it (that file is not loadable without the shell): test them on the phone.

## By hand (the A53, a build with `AndroidSounds` and `AndroidSounds.note`)

1. Settings > Sounds & Notifications > Sounds: the row "Notification sound:" shows Event sounds, under it the note. In a browser
   (no `AndroidSounds`) the row is absent.
2. Tap the row: level 1 shows Event sounds (default), None and the categories with counts. No sound is named. The choice in use
   is ticked (a category when the sound belongs to it). The soft keys read Select / Back; the title band reads "Notification
   sound"; the tab strip is gone.
3. Select a category (highlight it, Select, or tap it twice): search box, sounds 50 at a time, "Show more" at the end of the list.
   Tapping a row highlights it and plays it once; Play / Stop on that row follows the sound (stops by itself after about 8 s).
   Type in the box: the list narrows after a short pause and the keyboard stays up. Clear it: the first page returns.
   A chosen sound further down than the first fifty is the first row of its category, ticked and highlighted, when the
   category opens (nothing plays); after "Show more" it is not listed twice; with a search text only the matches show.
4. Select returns to the page showing the sound's title; Back goes up one level (2 > 1 > page) with no choice made; the phone's
   back key and the corner ok do the same steps (ok on a highlighted sound or on Event sounds / None chooses it). The page's
   own scroll is where it was.
5. Nothing is written until ok on the page: leave with Back x3 and the old sound stays. OK saves (`AndroidSounds.set`); a refusal
   shows one message box and keeps the page open.
6. Home / the screen off / another Android program in front while a preview plays: it stops, and the picker is still open on the
   same row with Play showing. Opening the picker while the Notifications tab's Play was sounding ends that sound. A preview
   never outlives the picker or its level (Back, Select, ok). No toast, balloon or "saved" message appears at any point; a
   sound plays only from a tap on a row or on Play (`wm-notify-sound-preview`,
   `scripts/notice-sources.d/notify-sound-1298.json`).
7. 6.1, 6.5 and 6.5.1: the tick, the chevron and the Stop square follow the text colour; the highlighted row stays one line,
   long titles end in an ellipsis. On 6.5.1 the Play / Stop button keeps its flat black-framed face, is a fixed 22 x 29 units and
   highlighting a row does not make it taller.
8. The choice applies with the page in front (through `AndroidSounds.note`) and behind it (the app's own player): with the
   phone awake and Melaton Mobile in front, raise a notification that has no sound of her own on the Notifications tab (for
   instance a New e-mail message). Choice None: silence (vibration still follows the tab's Vibrate box); a chosen Android
   sound: that sound once and not the WM file as well; Event sounds: the WM file. Then give the event her own sound on the
   Notifications tab (a file ticked as hers): it plays, whatever the choice. Play sound off: silence, whatever the choice. Do the
   same with the screen off or Melaton Mobile behind another program: the app plays by the same rule.

## Checks

`node --check` on the edited files, `scripts/check-ui-standard.js`, `check-app-scope.js`, `check-perf-rules.js`,
`check-notifications.js` (see the turn's report).

## On a device (done on the A53, Nov 27 2026)

Evidence: `docs/testing/evidence/1298/` - `a53-sound-log.txt` (the app's own `NoteAlerts` lines for a notice with the page
asleep, with the page in front, and with None; the bridge timings; what went wrong in the test), `a53-walk/*.png` (one
full-screen capture per step of the picker walk), `unit-tests.txt` (DSApp, 257 tests).

The walk's driver is `scripts/test-notify-sound-picker-device.js` (real touches over the WebView's DevTools port, one named
step at a time, a capture and the picker's state after each; it asserts nothing by itself, the pictures are read by eye):

```
adb -s <phone> forward tcp:9397 localabstract:webview_devtools_remote_$(adb -s <phone> shell pidof jp.net.seventhreeseven.dreamscape)
node scripts/test-notify-sound-picker-device.js 9397 <out dir> '<capture script> {file}' row=01-row open=02-categories \
    category=03-category more=04-more preview=05-preview stop=06-stopped select=08-chosen open=09b-reopen tapcat=10-tick search=11-search
```

A notice sound is proven from the app's log, never by ear alone: `adb logcat -s NoteAlerts` shows
`<event>: ringer 2, sound <file>` + `playing content://media/...` when the app delivers, and
`<event> (page in front): chosen sound | no sound (...) | the event's own sound (the page plays it)` when the page asks
(`AndroidSounds.note`). Send test notices to ONE phone (`PUT /api/test-devices/<id>`, `POST /api/test-devices/<id>/notice`,
clear, `DELETE`), give them `"cls":"reminder"`, keep the notification volume at 0 or 1, and read
`wmShell.sounds.eventPrefs('notification')` first: a phone whose own settings give a class an Alarm file plays it.

Not done: the same walk on a lane emulator (the lane's CPU guard refused every boot of `aemu-a53-2` that night), the picker
on 6.5.1 (the A53 runs 6.5; the 6.5.1 Play button rule is checked by reading the two style rules only), the "Added by you"
category (this phone has none), and a notice with the app's process ended (the page-asleep proof had the app behind Android
Settings).
