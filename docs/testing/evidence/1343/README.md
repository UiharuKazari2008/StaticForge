# #1343 device evidence: notices, menus and the picture toolbar with the keyboard up

Taken on the A53 test phone (Galaxy A53, 1080x2400, Melaton Mobile 6.5, DSApp release 25 = 3631866), Nov 27 2026,
by Claude Code session 859f3552 for #1349. Shots are scaled to 50 %. Positions are CSS px from the page (innerHeight 914;
keyboard 376 px, so its top is at 538). The test notice was raised in the page (`wmShell.notify`, title "Lane test"),
ringer on vibrate, notification and ring volume 0: nothing played (no Dreamscape player started, no `notification_alert`).

| file | state | what it shows |
| --- | --- | --- |
| `0-kbd-up-no-notice-old-css.png` | keyboard up, before e46d3ccb7 | the Search field with the keyboard up (the page's soft key bar under the keyboard, the app's keys below it) |
| `1-kbd-up-notice.png` | keyboard up | the notice stands on the keyboard's top (box 419-538), title band and Hide / Dismiss reachable |
| `1b-kbd-up-after-dismiss-tap.png` | keyboard up | a real tap on Dismiss (the app's key under the keyboard) closed it; the keyboard stays up |
| `2-kbd-up-long-notice.png` | keyboard up | a 4-line notice fits above the keyboard (410-538); the field (43-73) is not covered |
| `3-kbd-up-softkey-menu.png` | keyboard up | Pictures' right soft key Menu: the menu ends on the keyboard's top (47-538) |
| `5a-kbd-down-notice.png` | keyboard down | the notice on the soft key bar (bottom 48 px = --wm-soft-h), as before |
| `5b-kbd-down-softkey-menu.png` | keyboard down | the menu half over the soft key bar's top edge (bottom 47 px), as before |
| `5c-kbd-down-picture-toolbar.png` | keyboard down | the picture toolbar on the soft key bar (832-866, bottom 48 px), as before |

The picture toolbar with the keyboard up has no shot: the viewer has no text field and opening a picture takes the
focus from the Search field, so the two are never up together on the phone. Its CSS was measured in the page with the
keyboard state set by hand and taken back: bottom 376 px (on the keyboard's top, 504-538) with `data-wm-soft-h`; 415 px
(26 units over the lifted bar) without it; 48 px again afterwards.

Before e46d3ccb7 the notice stood 26 units (39 px) above the keyboard (box 380-499) with its open bottom over a strip
of the page; before 673a6623e a tap on Dismiss over the keyboard did nothing after a page restart.

## The app's own box over another program (`PopupView.lift`, #1356)

Android emulator `aemu-a53-4` (1080x2400, A53-shaped, `-no-audio`), Nov 27 2026, Claude Code session 62ef373d. Android
Settings in front with its search field, the app's Melaton Bars bound (`dumpsys window`: `MelatonBar` windows,
`MelatonPopup` while a notice is up). Notices: `lane.sh notice push`. Pixels are full-screen px (shots scaled to 50 %);
the keyboard's top is at y 1517, the soft key bar's at 2274. The soft keys read Dismiss | Menu (a server notice).
The emulator's golden snapshot has the bars off; the test turned them on through the page bridge
(`AndroidBars.setConfig`) and set `wmCameraExtendBar`, and turned both off afterwards.

### DSApp release 25 (3631866, 312aa34), `app-*`

| file | state | what it shows |
| --- | --- | --- |
| `app-0-kbd-up-no-notice.png` | keyboard up | Settings search with the keyboard, the soft key bar over its bottom strip |
| `app-1-kbd-up-notice-stale-kit.png`, `app-1-kbd-up-stale-kit.txt` | keyboard up, out-of-date layout | the box 25 px over the keyboard (laid out for another soft bar height); the first Dismiss tap closed it without dismissing |
| `app-1b-kbd-up-notice.png` / `.txt` | keyboard up, after `renderKit` | the box on the keyboard's top (ends y 1518), Dismiss / Menu reachable; windows, insets, log |
| `app-1c-kbd-up-after-dismiss.png` | keyboard up | a tap on Dismiss cleared the notice, the keyboard stayed up |
| `app-2-kbd-up-long-notice.png`, `app-2b-*-crop.png` | keyboard up | **defect:** the 4-line box's title is half covered by the white body |
| `app-3-kbd-up-notice-menu.png`, `app-3b-*.png`, `app-2-*-menu.txt` | keyboard up, Menu | the Menu ends on the keyboard; a tap on its lifted Hide row works |
| `app-5a`, `app-5b`, `app-5c`, `app-5-kbd-down-notice.txt` | keyboard down | the box on the soft key bar; Dismiss works; the title is cut in the 4-line box too |
| `app-6a`, `app-6b`, `app-6-*.txt` | keyboard lowered under a notice | the box follows it down |
| `app-7-notice-after-layout-push.png`, `app-7-*.txt` | after a page layout push (replayed) | **defect:** a tap on the drawn Dismiss logs `outside: closed`; the notice stays `seen` |
| `app-8-sound.txt` | sound | `alarmLikeStarted` 0, `playedCount` 0, no `notification_alert`; every decision silent at ringer 0 |
| `app-9-final-no-notice.png` | end | no notice left up |

### Lane-only test APK 3631867 (`fix/1343` with ec8cfd8, merged with main d0b7d70 for the build), `app-fix-*`

Not a server release; installed once, on this emulator only. 224 unit tests, 0 failures (`app-fix-build.txt`).

| file | state | what it shows |
| --- | --- | --- |
| `app-fix-0-stale-kit-before-renderkit.png` | before `renderKit` | the out-of-date layout again (not changed by ec8cfd8) |
| `app-fix-a-4line-kbd-up.png` | keyboard up, 4 lines | title whole on its band, four lines on white, the box on the keyboard |
| `app-fix-b-4line-kbd-down.png` | keyboard down, 4 lines | the same on the soft key bar |
| `app-fix-c-1line-kbd-up.png`, `-down.png` | 1 line | keyboard up: 0 px differ from release 25 inside the box; down: same positions |
| `app-fix-d1`, `d2`, `app-fix-d-layout-push.txt` | after a layout push, keyboard down | Dismiss logs `popup soft key: left (Dismiss)`; the notice is `cleared` |
| `app-fix-d3`, `d4`, `d5` | Menu after a push, keyboard down | the Menu draws, stays through a second push, Hide works |
| `app-fix-a-b-c-notices.txt`, `app-fix-e-sound-restore.txt` | logs, sound | `alarmLikeStarted` 0, `playedCount` 0; bars turned off again |
| `app-fix-9-restored.png` | end | the emulator as found (bars off) |

Not covered: the out-of-date layout through the real Settings screen (seen only after the bridge setup above; the lift
assumes the soft bar height the box was laid out for); Dismiss / Menu after a layout push with the keyboard up; a
keyboard raised under a notice that is already up; 2 and 3 line boxes; a question's box; a width the page never laid
out; real phone hardware.
