# #1421 lane evidence: first row of a soft key menu over an Android program, 6.1 / 6.5 / 6.5.1

Instance: `aemu-a53-2` (A53-shaped emulator, Android 16, lease held by claude-224cddc6 and released at the end).
App `lane.sh aemu-a53-2 status` appVersionCode **3633156** (build 45; it was 3632021 when the instance booted, the app staged 3633156 itself).

## The new client runs
- Before: the page held the OLD client (cache `static-cache-v2` wmShell.js 372563 bytes): `old-client-before-update.txt`, first row `wm-popup-item is-hot`.
- The page listed 41 waiting client files (wmShell.js among them; the server serves the `!o.sample` fix). Taken through the page's own path:
  `serviceWorkerManager.installAvailableUpdates()` (download, 27 files), then `serviceWorkerManager.installUpdates()` (kind `restart`), app process restarted (`kill-app` + `start-app`).
  Cached wmShell.js became 374774 bytes.
- After: `new-client-proof.txt`: `wmShell.menuSample('right',[A,B])` classes `["wm-popup-item","wm-popup-item"]`, first row has NO `is-hot`, closed with `.close()`.

## Results (screenshots read one by one)
Bar and Menu were opened by a real `lane.sh tap` on the bar's Menu key (right soft key). Soft Key Menu = Android Settings in front (default profile, right key "Menu").
Own menu = YouTube in front with a hand-set profile (right key "Menu of its own": Home, Shorts, Watch Later, Search, divider, My Account, History).

| file | look | rows read, top to bottom | highlighted row | result |
| --- | --- | --- | --- | --- |
| `6.1-soft-menu.png` | 6.1 | Task Manager, All Notifications, Quick Settings, Maximize, Minimize, Close | none | PASS |
| `6.1-own-menu.png` | 6.1 | Home, Shorts, Watch Later, Search, (divider), My Account, History | none | PASS |
| `6.5-soft-menu.png` | 6.5 | Task Manager, All Notifications, Quick Settings, Maximize, Minimize, Close | none | PASS |
| `6.5-own-menu.png` | 6.5 | Home, Shorts, Watch Later, Search, (divider), My Account, History | none | PASS |
| `6.5.1-soft-menu.png` | 6.5.1 (html data-wm-rev=6.5.1, bars "top" default) | Task Manager, All Notifications, Quick Settings, Maximize, Minimize, Close | none | PASS |
| `6.5.1-own-menu.png` | 6.5.1 | Home, Shorts, Watch Later, Search, (divider), My Account, History | none | PASS |

In all six the first row is drawn in the same dark-red menu text colour as the other rows, on the white menu, no row has a highlight band.
(6.5 and 6.5.1 menus have rounded boxes and wider row spacing than 6.1, as before.)

## How the setup was made (not all by taps)
- The instance (reset to golden earlier) had no bars and no YouTube profile. Set through the page's own bridge: `AndroidBars.setConfig({enabled, softkeys, softRight:'menu', room, softProfiles:{YouTube...}})`, `localStorage wmCameraExtendBar=1`, then `AndroidBars.requestRender()`.
- The look was switched by writing `localStorage wmVersion` (`6.5`, `6.5.1`; the same value Settings > System > Version commits) and restarting the app process (`kill-app` + `start-app`), NOT by tapping the Settings page. The app drew each look's own bar art after the restart (6.1 orange bar, 6.5 / 6.5.1 black bar), so the kits were re-synced.
- The YouTube profile is hand-written, not the AI-generated one; the own-menu actions were not tapped (only the first-row text and highlight were judged). YouTube's notification permission dialog was dismissed with Don't allow.

## Not done / caveats
- No taps in the Settings app for the look switch (above). The 6.5.1 "buttons at the bottom" layout option was not tried (default top).
- Notification box menus (`menu` / `replyMenu`) and Task Manager hold menus were not exercised.
- The A53 hardware phone was not used (another agent has it).

## State left behind
Look back to 6.1 (`wmVersion` removed, page reports 6.1), `wmCameraExtendBar` removed, bars `enabled:false`, `softkeys:false`, `softRight:'home'`, `softProfiles` is `{}` (it was `null`; `setConfig` merges, so `null` did not clear it, `{}` is empty and equivalent). No menu open; YouTube force-stopped. The instance keeps running (reaper stops it); the page now runs the new client (stays).
