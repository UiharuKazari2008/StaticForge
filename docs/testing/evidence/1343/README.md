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
