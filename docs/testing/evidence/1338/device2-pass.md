# Device pass round 2 for #1338 (car status bar icon) on aemu-a53-1

Instance `aemu-a53-1` (1080x2400, 420 dpi, devicePixelRatio 2.625), Android 16, appVersionCode **3632021** (release 30), app pid 7009
(started 2026-11-27 06:01:16 UTC by `stat /proc/7009`, which shows 01:01:16 -0500; the device clock is EST, so every file time below
is UTC minus 5 h). Page: `data-wm-version="6.5"`, `data-wm-rev="6.5.1"`. Start 06:04:26 UTC, end about 06:09 UTC (Nov 27 2026).
Driver: `scripts/aemu-lane/lane.sh --agent claude-af273edc aemu-a53-1 ...`. No code or art changed. Step S was NOT run (its condition,
a holder-car file in the app's `art/`, is false).

## Result in five lines

1. The page's 6.5.1 drawer (opened by a real tap on the title bar's status area) lists the car as its own item whose picture is
   `wm65/holder-car` and it is the **bright silver car**: car pixels mean luminance 167.5 against 81.7 for the drawer background in
   the same box (neighbours: Messages envelope 200.2 on 84.7). The page serves the AFTER files (round 1 hashes; unchanged).
2. On the page's bar the car's own small glyph is still NOT drawn: the item is `hidden=false` but computed `display:none`
   (box 0x0), folded away by the bar's fit rules, as in round 1. The "..." shows ("4 notifications").
3. The app drew **no Melaton bar** over Android Settings (two tries, release 30). The accessibility service is bound and enabled,
   no overlay window of the app exists. So the native bar and the native drawer were NOT seen.
4. The app holds no `holder-car` file and no `holder-car` pref (it never drew a drawer). Step S was therefore not possible.
5. The app's kit on disk (`kit-1082.json`, 06:01 UTC) has signature `m35|6.1||...`: it was written while the page was on 6.1 and
   has no `roleIcons` at all in `lists.notifyTray.s` (so no `carkey` picture URL); `window.melatonBars` is `undefined` in the page now
   (the module loads lazily when the app asks for a bar copy, wmShell.js 823), and the page's push of a new kit signature
   (wmShell.js 4906) needs `window.melatonBars`. Inferred from the code, not proven: the app was never told that the look changed to 6.5.1.

## P0 baseline

- `status`: running, booted, appPid 7009, appVersionCode 3632021, top MainActivity.
- eval (`scratchpad/agentC/p0.js`): `rs complete`, `wmShell true`, `wmVersion "6.5"`, `wmRev "6.5.1"`, origin
  `https://staticforge.737.jp.net`, dpr 2.625, `statusOrder.glyph('carkey')` = `status-traffic`, `holderArt('carkey')` = `wm65/holder-car`,
  carkey icon hidden attr true / display none, notify display block, visible roles: notify, update, bluetooth, data, signal, battery.
- `device2-01-baseline.png` (looked at it): Melaton Mobile Today in 6.5 style on the yellow Japanese sign wallpaper; thin dark
  translucent title bar with Start, "...", inbox-check, Bluetooth, data arrows, signal, battery in white; clock 1:04, soft keys
  "Pictures | (task icon) | Set".

## P1 the bar with the car (page in front)

- `window.dispatchEvent(new CustomEvent('androidcarkey', {detail:{cars:[{key:'lane-1338',car:'Lane Test Car',canLock:false,canUnlock:false}]}}))`
  -> `dispatched`; after 2 s (`p1.js`):
  - `.wm-status-icon[data-role="carkey"]`: `hidden:false`, `display:none`, box 0,0,0,0, aria-label "Car: in range or running",
    background `image-set(.../wm61/status-traffic.png 1dppx, @2x 2dppx, @4x 4dppx)`, size 100% 100%, no mask, no filter.
  - `[data-role="notify"]`: hidden false, display block, box x554 y21 w64 h64 (device px), aria-label "4 notifications".
  - visible icons (device px, y21 h64 each): notify x554, update x638, bluetooth x722, data x805, signal x889, battery x973;
    title bar box 0,0,1082x102. `.wm-titlebar .wm-status` box x554 y0 w528 h102.
- `device2-02-page-bar-car.png`, `device2-02-page-bar-car-crop.png` (crop x500-1080, y0-110, 4x NEAREST; looked at the crop): "...", inbox-check,
  Bluetooth, data arrows, signal, battery, all white; **no white car front glyph on the bar**; the car is folded.
- The 6.5.1 bar is a translucent dark band over the wallpaper, not opaque black. Pixel samples of the screenshot (RGB):
  (300,50) 153,142,29; (450,90) 150,142,27; (250,95) 146,136,12; (520,50) 143,118,10 (all over the yellow sign: olive);
  (400,20) 133,30,26 (over the red disc); (60,100) 46,46,39; (1070,50) 34,36,24 (over the dark wall: near black).
  So the bar is near black only where the wallpaper is dark; white glyphs read fine everywhere in the crop.

## P2 the page's drawer (6.5.1 status drawer)

- Code read first: wmShell.js 9395-9570. `d651Trigger(t)` = a tap on `.wm-status` (status icons and the room between them) or, with
  `data-wm-bars="bottom"`, the whole thin bar; here `data-wm-bars` is absent, so the status area (x554-1082) is the trigger. `pointerdown`
  on it calls `d651Toggle()` (opens `.wm651-drawer`); the same spot closes it; a press outside also closes it. Each notification of the
  "..." and each status icon is an item of the one strip (no second holder strip): the "..." stands for its own notifications (`holderEntries()`),
  so I did not look for a separate "..." holder (the code has none).
- Real tap `$L $I tap 628 52` (the gap between "..." and the update icon, device px) -> drawer opened. `p2.js` answer: strip box 0,102,1082x169 (CSS `.wm651-drawer`), 13 items
  (169x169 each, step 169): 0 Zoom in (v651-drawer-zoom-in), 1 "Lane proof 2" (wm61/msgbox-info), 2 "Lane proof" (wm61/msgbox-info),
  **3 "Car: in range or running" -> `wm65/holder-car.png` 1dppx / `holder-car@2x.png` 2dppx / `holder-car@4x.png` 4dppx, box x526 y102 w169 h169**,
  4 Messages (wm65/start-msg), 5 ActiveSync: received items (start-async), 6 Updates ready (start-update), 7 Bluetooth, 8 Connectivity, 9 Phone signal,
  10 Volume, 11 Battery, 12 Clock & Alarms. Items 7-12 are off screen to the right (strip slides).
- `device2-03-page-drawer-car.png`, `device2-03-page-drawer-car-crop.png` (x0-1080, y90-290 at 2x; looked at the crop): a translucent dark band with the
  wallpaper showing through; items left to right: magnifier, two blue info bubbles, **a bright silver sedan seen from the front-left**, the
  open envelope, the green sync disc. The car is sharp (no blur), not clipped, centred in its slot, clearly lighter than the band.
- Measurement from the screenshot, using the alpha of the shipped file to separate car pixels from the background in the picture's own box
  (the pictures are drawn at 128x128 device px at offset 20,18 inside the 169 box; found by best contrast): car pixels (alpha>200) mean
  luminance (plain mean of R,G,B) **167.5**; empty pixels (alpha 0) of the same box **81.7**, RGB about 102,96,61 (a whole-box plain mean, no mask: car box 102.4). Neighbour Messages: pixels 200.2,
  background 84.7 (whole box 126.0); neighbour Lane proof 2 whole box 116.9. Background samples: (540,260) 70,32,31 (over the red disc), (600,270) 84,83,49, (530,200) 75,73,37.
- Size: car and the envelope are both drawn at 128 px; the car's artwork fills 120x80 of its 128 square (wide and low like a car), the envelope fills 180 x 169 of
  180: the car is as wide as its neighbours, shorter by shape. Nothing misplaced.
- Closed with the same tap (`628,52`): `.wm651-drawer` hidden true, 0 items. No entry was tapped.

## P3 the app's native bar

- Car dispatched again, `$L $I other` ("Settings in front"), 4 s: `device2-04-native-bar.png` (looked at it) shows Android Settings with **Android's own status bar** (1:06, mute, Wi-Fi,
  signal, battery); no Melaton bar. `device2-04-native-bar-crop.png` is the top 330 px at 2x.
- Second try: `home`, 3 s, `other`, 8 s: `device2-04b-native-bar-second-try.png`; I looked at its top strip: the same stock status bar, the Settings search field right under it.
- `dumpsys accessibility` (via `sh`): `Bound services:{Service[label=Melaton Bars ...]}`, `Enabled services:{jp.net.seventhreeseven.dreamscape/...MelatonBarService}`,
  `Crashed services:{}`; the accessibility window list shows system, Settings (active), Home, Navigation bar, "DreamScape" (the MainActivity); no overlay window of the app.
  `dumpsys window windows | grep 10217`: only the MainActivity window.
- `logcat` (400 lines) filtered for melat|nativebar|nativenote|barserv: the app's process start line `Start proc 7009 ... for service MelatonBarService` at 06:01:16 and
  `ActiveSyncBoot: Melaton Bars connected after an update, the link's service not running: service started for the link (battery optimisation exempt: false)`;
  no NativeBar / MelatonBars line at all after that (the release build logs under obfuscated class names, so silence is weak evidence).
- No native drawer (nothing to tap): `device2-05` / `-07` not produced.

## P4 the app's files (root, read only)

- `files/melaton_bars/`: `art/`, `catalog.json` (06:02 UTC, 1007 B), `kit-1082.json` (06:01, 31097 B), `layout-sets.json` (06:01), `layouts.json` (06:01),
  `status.json` (06:04, 174 B), `titles.json`, `wm61-status-atlas.json`. `art/` holds only `..._wm61_start-melaton_4x.png` (8405 B, 06:01) and
  `..._wm61_status-traffic_4x.png` (521 B, 2026-11-26 20:54 EST = 01:54 UTC). `ls art | grep -i holder`: nothing. **No `*holder-car*` file.**
- `shared_prefs/melaton_bars.xml` (57 lines, `-rw-rw---- u0_a217 u:object_r:app_data_file:s0:c217,c256,c512,c768`, 7751 B): `grep -n holder-car`: no line.
  Traffic lines (format, for reference):
  - `    <string name="hash:art/staticforge.737.jp.net_static_images_wm61_status-traffic_4x.png">6fa19ba65175ff97861e96d9aa39f65ca7c32cbdcc535738421171239fb29d12</string>`
  - `    <string name="etag:art/staticforge.737.jp.net_static_images_wm61_status-traffic_4x.png">W/&quot;209-1a1ecbc2323&quot;</string>`
- Kit (`scratchpad/agentC/kit-1082.json`, parsed with python): `kv` 4; `sig` `m35|6.1||||1.5px|1.5238095238095237px|||102|hsl(13.8 80.0% 51%)||sm1uufvn1|412` (6.1, no rev);
  `lists.notifyTray.s` keys: items, box, slot, gap, glyph, icons, holderRoles; **no `roleIcons`**, so `roleIcons.carkey` = none;
  `holderRoles` = [carkey, rain, wxalert, chat, mail, sms, xmrec, prints, director, received, update, continuity, nightshade, traffic, lapis];
  `icons` = [notification, reminder, warning, error, lapis, traffic, wxalert, rain]. The kit is the 6.1 tray (it has no holder strip pictures).
- `status.json`: `[{"role":"notify","atlas":"notify-many"},{"role":"update","art":"/static_images/wm61/status-update"},{"role":"bluetooth","atlas":"bluetooth"},{"role":"volume","hidden":true}]` - no carkey entry (the car is folded on the page).
- `catalog.json` carkey entry: `{"role":"carkey","art":"/static_images/wm61/status-traffic"}` (also the `traffic` role uses status-traffic).
- sha256 of `art/*status-traffic_4x.png` = 6fa19ba65175ff97861e96d9aa39f65ca7c32cbdcc535738421171239fb29d12 = the white car front glyph (matches).
- holder-car copy classification: none held (nothing to classify).
- Page side: `kitSignature` is not callable now (`typeof window.melatonBars` = `undefined`; `typeof window.AndroidBars` = `object`, `AndroidBars.kitSig` = function).

## S, not run

Condition false (no holder-car file in `art/`). I did not run stop-app, adb push, nor any write to the app's files or prefs. The question "does the app replace a stale copy at its next start"
stays open; do not read it as a defect or as a pass. The app only fetches a picture when it draws it, and the native bar was never drawn.

## E clean-up

`home`, `start-app` (pid 7009 stays), `androidcarkey` with `{cars:[]}`, `window.wmCarKey.forget('Lane Test Car')` (returned nothing), localStorage keys matching /carkey/i:
`wmCarKeyFriends`="[]", `wmCarKeysSeen`="[]" (no `wmCarKeyMine`); none holds "Lane Test Car". Carkey icon hidden=true, display none (the page re-read "no car" when it became visible).
`/data/local/tmp/hc-before.png` and `mb.xml` were never created (the `rm -f` found nothing). Page still `6.5/6.5.1`. `device2-08-after-cleanup.png` (looked at it): Today, same bar as the baseline, clock 1:08.
Instance running, Melaton Mobile in front, lease untouched. App files not modified, holder-car F not touched.

## Screenshot list

- device2-01-baseline.png: 6.5.1 Today, translucent dark bar, white icons.
- device2-02-page-bar-car.png: bar with the car forced: no car glyph on the bar.
- device2-02-page-bar-car-crop.png: bar right part 4x.
- device2-03-page-drawer-car.png: drawer open, car item 4th of the strip, bright silver car.
- device2-03-page-drawer-car-crop.png: strip 2x.
- device2-04-native-bar.png, device2-04-native-bar-crop.png: Settings with Android's stock bar, no Melaton bar.
- device2-04b-native-bar-second-try.png: the same after the second try.
- device2-08-after-cleanup.png: after clean-up.
(No device2-05 / 06 / 07 files: no native bar, no native drawer, step S not run.)


---
Planner note (06:25 UTC): the full-screen PNGs of this round that showed nothing about the car (baseline, no native bar, after clean-up) were not kept in the repo; the crops named above and, for round 2, `device2-03-page-drawer-car-half.png` (the drawer screenshot at half size) and `device2-03-page-drawer-car-crop.png` are. Round 3 (`device3-pass.md`) has the bar, native bar, native holder and app-copy evidence.
