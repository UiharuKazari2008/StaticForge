# Device pass for #1338 (car status bar icon) on aemu-a53-1

Instance `aemu-a53-1` (A53 shape, 1080x2400 at 420 dpi, CSS 411x824 at 2.625), Android 16 (API 36), appVersionCode 3631778,
app pid 3264 (started about 05:45 UTC, from /proc starttime 14172 ticks and uptime 793 s at 05:56:04 UTC; the files under
`melaton_bars/` date from 01:54 UTC, an earlier run). Start 05:55:27 UTC, end about 05:59 UTC (Nov 27 2026).
Driver: `scripts/aemu-lane/lane.sh --agent claude-af273edc aemu-a53-1 ...`.

## Result in four lines

1. The page on this instance is on WM **6.1** (`data-wm-version=6.1`), not 6.5 / 6.5.1. The holder strip with the large colour
   `holder-car` picture exists only on 6.5 / 6.5.1 (`WM65 ? noteHolderArt(n) : noteIcon(n)`, wmShell.js holderEntries). I did not
   switch the version (hard rule 5), so the holder / drawer picture of the car (steps B2, C2) was NOT seen, in the page or natively.
2. With the car forced in the page, the car item is **not drawn on the page's bar**: its icon has `hidden=false` but computed
   `display:none` (box 0x0). It is folded into the "..." icon (aria-label "6 notifications"). So the glyph is not visible on the bar
   on this instance (it is not black on black, it is not there).
3. With Settings in front, **no Melaton bar is drawn**: Android's own status bar shows. The accessibility service
   `MelatonBarService` is enabled and bound (dumpsys accessibility) but no overlay window of the app exists. So the native bar
   and native holder (C1, C2) could not be shown. Two tries (04, 04c), the second after `home` and 7 s.
4. The page holds the AFTER picture in all three sizes. The app holds NO `holder-car` file at all (never drawn); step D was
   not run, by the planner's instruction (#1340 on this app version).

## A. Baseline

- A1 `status`: running, booted, noAudio true, appPid 3264, appVersionCode 3631778, top `jp.net.seventhreeseven.dreamscape/.MainActivity`,
  screen Awake, doze ACTIVE, deviceId 32448570b3a6f8bd899ef46c3e5f93d0. `shot` -> `device-01-baseline.png`: Melaton Mobile
  Today screen, red 6.1 title bar (Start, "...", inbox-check, Bluetooth, data, signal, battery), a notice's soft keys
  "View | Dismiss" at the bottom and the Android on-screen keyboard up. Page already loaded (`readyState complete`, `wmShell true`).
- A2 eval (`scratchpad/agentB/a2.js`): `data-wm-version=6.1`, `wmRev` undefined (no such attribute), origin
  `https://staticforge.737.jp.net`, devicePixelRatio 2.625, `statusOrder.glyph('carkey')` = `status-traffic`,
  `holderArt('carkey')` = `wm65/holder-car`. `.wm-status-icon[data-role="carkey"]`: hidden=true, display none.
  `[data-role="notify"]`: hidden=false, display block. Visible roles: notify, update, bluetooth, data, signal, battery.
- A3 page's copy (fetch from the page, sha256 with crypto.subtle):

| file | status | bytes | sha256 | class |
| --- | --- | --- | --- | --- |
| holder-car.png | 200 | 1869 | c08cf5769308d4228026b06537a02d19639c886cd84fa07600a3ab16b599974f | AFTER |
| holder-car@2x.png | 200 | 6163 | 49b3eecc08b10b0a01fab52fdb093c7a4e0f18634b31790898f8e2740a21f8d6 | AFTER |
| holder-car@4x.png | 200 | 20051 | 58778e4cf1f19b7cfa32e339bb4ba91642ddcc9ded5e1ed30fb170630428d410 | AFTER |

  (`X-File-Hash` header of each equals the sha256. The fetch answered with `Last-Modified` = the fetch time, so it may have
  gone to the network rather than a service-worker cache entry; I did not prove which.)
- A4 app's copy (`su`): pid 3264, no `kit-*.json` in `files/melaton_bars/` (only `catalog.json` 00:53 EST, `status.json`,
  `titles.json`, `art/`). `art/` holds 15 wm61 `status-*_4x.png` files (activesync, continuity, director, lapis, mail, messenger,
  nightshade, prints, rain-alarm, sms, tape-strip, tape, **traffic**, update, weather-alert), all dated 2026-11-26 20:54 EST
  (= 01:54 UTC). `ls art | grep -i holder`: nothing. `shared_prefs/melaton_bars.xml`: no `holder-car` line (only
  etag:/hash: of the wm61 status files; traffic hash 6fa19ba65175ff97861e96d9aa39f65ca7c32cbdcc535738421171239fb29d12,
  etag W/"209-1a1ecbc2323"). Classification of the app's holder-car: none held. Because no kit exists, `kv`, `sig`,
  `roleIcons.carkey`, `holderRoles` could not be read.

## B. The car in the page

- B1 `window.dispatchEvent(new CustomEvent('androidcarkey', {detail:{cars:[{key:'lane-1338',car:'Lane Test Car',canLock:false,canUnlock:false}]}}))`
  -> `dispatched`. After 2 s: carkey icon `hidden:false`, computed `display:none`, box 0,0,0,0 device px,
  background `image-set(.../wm61/status-traffic.png 1dppx, @2x 2dppx, @4x 4dppx)`, size 100% 100%, no mask, no filter;
  notify ("...") box x 552 y 20 w 64 h 64 device px; visible roles unchanged (notify, update, bluetooth, data, signal, battery).
  localStorage then held `wmCarKeyMine`="Lane Test Car" and `wmCarKeysSeen`=["Lane Test Car"].
  `device-02-page-bar-car.png` / `device-02-page-bar-car-crop.png` (right part of the bar, 4x NEAREST): the bar shows
  "...", inbox-check, Bluetooth, data arrows, signal, battery, all white on the dark red 6.1 bar; **no car glyph** among them
  (the bar is dark red, not black, in this theme). The car's glyph file is `wm61/status-traffic@4x.png` (white car seen from the
  front, per the planner's render); it is not on screen because the item is folded.
- B2 holder: the 6.1 page has no holder strip with `holder-car`. I tapped "..." (584,52): the first tap removed the displayed notice
  (soft keys went from "View | Dismiss" to "Notification 3 | Menu": `noteIconTap` hides a shown note and marks it seen in the page);
  see `device-03a-page-after-first-dots-tap.png`. The second tap changed the soft key to "Notification 4" and opened no tray
  (`device-03-page-holder-car.png`, no tray in the DOM). Nothing was opened that lists the car. No picture of holder-car
  could be read. The car's entry and the car's pop-up were never tapped.

## C. The app's native bar

- C1 car forced again (re-checked: hidden false, display none), `other` ("Settings in front"), 4 s: `device-04-native-bar-car.png`
  shows Settings with **Android's own status bar** (12:57, mute, Wi-Fi, signal), no Melaton bar. `device-04-native-bar-car-crop.png` is the
  top strip 2x. `device-04b-...retry.png` the same 10 s later. Second try after `home`, 3 s, `other`, 7 s:
  `device-04c-native-bar-second-try.png`, the same stock bar (battery icon added). Facts:
  - `status.json` (00:56 EST): `[{"role":"notify","atlas":"notify-many"},{"role":"update","art":"/static_images/wm61/status-update"},{"role":"bluetooth","atlas":"bluetooth"},{"role":"volume","hidden":true}]` -> **no carkey entry** (the page's forced car was not pushed, as it is folded / not shown).
  - `catalog.json`: `{"role":"carkey","art":"/static_images/wm61/status-traffic"}` -> the glyph the app would draw for carkey is `status-traffic` (the white car from the front; the app holds `art/..._wm61_status-traffic_4x.png`).
  - `dumpsys accessibility`: `Bound services:{Service[label=Melaton Bars ...]}`, `Enabled services:{jp.net.seventhreeseven.dreamscape/...MelatonBarService}`, `accessibility_enabled 1`, Crashed services empty.
  - `dumpsys window windows`: no window of uid 10217 except MainActivity (task in back); no accessibility overlay of the app. System windows only (StatusBar, NotificationShade, Settings, ...).
  - `logcat 60` filtered for Melaton / NativeBar / NativeNote / accessib: no line.
- C2 native holder: not possible, no native bar. Not run.
- C3 app's copy again: still no `*holder-car*` file in `art/`, no `holder-car` pref, no kit file; pid unchanged 3264.

## D. Fresh app process

Not run, by the planner's instruction (#1340 on this app version). `stop-app`, `kill-app`, `kill-page` were never run.

## E. Clean-up

`home`, `start-app` (pid 3264 stays), then `androidcarkey` with `{cars:[]}`, `window.wmCarKey.forget('Lane Test Car')`: answer
`forget:"forgot"`, localStorage keys matching /carkey/i: `wmCarKeyFriends`="[]", `wmCarKeysSeen`="[]" (`wmCarKeyMine` is gone);
no key holds "Lane Test Car"; carkey icon hidden=true, display none. No test notice was pushed. `notifs` shows only the app's own
persistent notification and others that were already there. `device-07-after-cleanup.png`: Today screen, "..." still shows (real
pending notices of the page), keyboard gone. Instance left running, Melaton Mobile in front, lease untouched.

## Side effects to know

- One tap on "..." hid the notice that was showing on the page (the page marks it seen; nothing sent to the server by me).
- No sound, no setting changed, no WM version change, no drive state, no notice of mine.

## Screenshot files

- device-01-baseline.png: 6.1 Today, red bar, keyboard up, notice soft keys View / Dismiss.
- device-02-page-bar-car.png: bar with the car forced: no car glyph on the bar.
- device-02-page-bar-car-crop.png: right part of the bar, 4x: "...", inbox, Bluetooth, data, signal, battery.
- device-03a-page-after-first-dots-tap.png: after the first "..." tap: notice gone, soft keys Notification 3 / Menu.
- device-03-page-holder-car.png: after the second tap: no tray open (Notification 4); NOT a holder picture.
- device-04-native-bar-car.png, device-04b-native-bar-car-retry.png, device-04c-native-bar-second-try.png: Settings with Android's stock status bar, no Melaton bar.
- device-04-native-bar-car-crop.png: top strip 2x of 04b, stock bar.
- device-07-after-cleanup.png: after the clean-up.
(There are no device-05 / device-06 pictures: no native holder, step D not run.)


---
Planner note (06:25 UTC): the full-screen PNGs of this round that showed nothing about the car (baseline, no native bar, after clean-up) were not kept in the repo; the crops named above and, for round 2, `device2-03-page-drawer-car-half.png` (the drawer screenshot at half size) and `device2-03-page-drawer-car-crop.png` are. Round 3 (`device3-pass.md`) has the bar, native bar, native holder and app-copy evidence.
