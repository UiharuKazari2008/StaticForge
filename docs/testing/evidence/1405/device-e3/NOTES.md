# #1405 device re-check E3: tile name, drawer after the follow-up, edge swipe after Quick Access off/on, foreground service under load (DSApp release 45)

Nov 27 2026, 19:40-21:30 EST (log times are the guest clocks). Planner: Fleet session 7422ffc1. No source was changed, nothing committed.
Release 45 = `1.0.3633156` (versionCode **3633156**, build/latest `f07e730`, 6 branches: shake-torch-1104, 1309-emu-shims,
1343-notice-above-keyboard, fix/1405-drawer-still 6a542201, fix/1405-fgs-start 0b167e3b, fix/1405-tile-text 08308aaf; APK sha256
`7eb6098c24c19365e176da43ed90169fdaa9daa8647b084efae3699257525e9b`). Build job 45 ran 00:36-00:40 UTC; build gate 361 ended `ok`.

**Device**: `aemu-fold-1` (Android 17, 1968x2184, 4 CPUs), lease 320, renewed 3 times, released at the end. The instance was down when
granted; `lane.sh up` booted it (33 s). Installed release 45 **once** with `lane.sh install-release 45` behind gate 362
(`dsapp-install-aemu-fold-1`): versionCode before **3632992**, after **3633156** (`install-release.json`). The gate waited on one agent
(`replicas-agent`, no claims, no answer for 3+ minutes, the same agent the earlier runs forced past): `coord_build_begin` **with force and
the reason** "lane-only adb install on my own leased emulator, no repo file touched"; gate ended `ok`. The Fold and the A53 were not used.
Ruiko was not at the CPU guard (every `up` worked first time).
The golden had Melaton Bars off and Quick Access off (configs saved: `bars-config-found.json`, `quickaccess-config-found.json`).
For A-C I switched them on by the bridge (`AndroidBars.setConfig`, `AndroidQuickAccess.setConfig`, `localStorage.wmCameraExtendBar=1`,
`forceRestart`), as E2 did; the Quick Access off/on of C was done **by taps** in Settings.

Pictures are crops (full resolution unless "x4") of the guest screenshots, reduced like the earlier folders; the Today page is never in a
crop except a few pixels of its background beside the Power popup. I looked at every picture cited with the Read tool.
Scripts and raw logs: `~/.cache/claude-run/1405/e3/` (cycle2.sh, loadrun*.sh, regress2.sh, swipes.sh, fgsrun.sh, fgsan.py, fgstable.py).

## Summary

| Part | Result |
| --- | --- |
| A "Performance" tile | **PASS** whole, no ellipsis, inside its tile - but only 1-2 px clear of the frame (remark below). Page alive and after `kill-app`. Strip shows nothing cut. |
| B1 normal opens | **PASS** 10/10 strip, 10/10 wide: `still in time`, pushed |
| B2 opens under load | **PASS** 20 opens passed the limit; all 20 asked the window picture at 2-804 ms after the limit, before the draw; no `waits ... interval` line, no `no window picture` line; all pushed |
| B3 regression | **PASS** all closes, Output panel too; battery tap over home: wide **PASS**, strip **PASS in 1 of 2 tries (log in 2 of 2)** |
| C edge swipe | **PASS** 4 steps x 2 start points, zone above the strips in every dump |
| D foreground service | **PASS on release 45 under load: 0 crashes in 8 clean loaded cold boots** (1 more loaded boot is void: the guest's own system_server died); normal boot, `kill-app` x3, redundant start PASS |

## A. "Performance" tile and other names (item 3)

Wide Quick Access (693 px, 23 tiles) over Android Settings, real edge swipe `input swipe 1962 840 1500 840 250`.

| # | Case | Result | Evidence |
| --- | --- | --- | --- |
| A1 | page alive | **PASS** "Performance" reads whole, no "...", inside the tile frame. Native crop: frame border at x 409-411 and 534-536, text x 414..532, i.e. **2 px clear on the left, 1 px on the right**, measured on the crop. Visible at x4: the "e" ends 1-2 px from the border, no overlap. Smaller type than its neighbours, same baseline, centred. | A1, A2 |
| A2 | page gone (`kill-app`, 25 s, only the js sandbox process left, `cdp` "socket hang up", kept layouts) | **PASS** identical picture and measures (log `bubble quickaccess drawn here`) | A3, A4 |
| A3 | other names / sub-labels | **PASS** Wi-Fi "AndroidWifi", Bluetooth "Not connected", Audio output "Speakers", "Auto" over "Network" (5G glyph whole), Adaptive brightness / color tone, Do not disturb, Power saving, Eye comfort, Power share, Pointer Flow: all inside their tiles, same wraps as E2's pictures | A1, A3 |
| A4 | strip, 1 column | **PASS** page 1 icon only; page 2 "Modes / None" and "5G / Auto" whole; page 3 two tiles; nothing cut | A5, A6, A7 |

Remark: the name is whole, but with **1-2 px** between the last letter and the frame it looks tight; the planner may want a pixel of padding.
Not tested: a long Bluetooth sub-label (E2's virtual speaker fixture was not rebuilt; "Not connected" fits), the 2-column strip, the panel over
Melaton home.

## B. Drawer (item 1)

| # | Case | Result | Evidence |
| --- | --- | --- | --- |
| B1a | 10 normal opens, strip, QA, over Settings | **PASS** 10/10 `still in time`, N = 19 20 21 23 24 29 38 41 45 45 ms (median 26.5); 10/10 pushed (pixel: after = before moved left 148 px) | B1-strip-log, B1-pixel |
| B1b | 10 normal opens, wide | **PASS** 10/10, N = 23 24 24 28 28 29 38 48 50 58 (median 28.5); 10/10 pushed (594 px) | B1-wide-log, B1-qa pictures |
| B2a | Load set A: 8, 12, 16 busy loops + 2 screencap loops; 6 QA swipes + 6 Output bridge opens per level (36 opens) | 29 in time (N 27-200 ms, max 200), **7 passed the limit** (all QA swipes), 0 Output | B2-set-a |
| B2b | Load set B: 28 busy + 4 screencap loops (load average 40), 16 QA swipes, screenshot 8 s after the swipe | 3 in time (65, 84, 84 ms), **13 passed the limit** | B2-set-b |
| B2c | the 20 opens that passed the limit | each logged `late push asks for the program's window picture (try 1, A ms after the open, B ms after the limit, before the panel is drawn)`, then `drawn without a still, the draw took N ms`, then `late push: window picture in W ms, screen pushed aside` | same |
| B2d | **B** (ms after the limit) | set A: 9, 85, 232, 6, 225, 91, 30. set B: 6, 240, 804, 528, 335, 118, 778, 248, 465, 2, 521, 208, 143. **Max 804** (first run: 200-1600). Draw took 246-1301 ms. Window picture came 273-2607 ms after its ask; screen pushed 742-3528 ms after the open | same |
| B2e | `late push waits ... for Android's interval` (old or new wording) | **0 lines** in both sets (so no wait was added at all) | greps of both files |
| B2f | `no window picture (code ...)` | **0 lines**, no retry line | same |
| B2g | pushed in the screenshot 8 s after the swipe | **52 of 52** (36 + 16) `pushed`, shifted diff 0.0 | B2 pixel verdicts |
| B3a | Back key (sendevent), soft Back, left edge, right edge, outside tap, swipe up from the bar, screen off 6 s / on, each with the wide panel and the Output panel (14 runs) | **PASS** the panel was up each time (1.4 M px differ), after the close the screen equals the one before (0-629 px of 4.3 M: clock, a few px) and Android Settings is in front; swipe up goes Home (Nexus launcher), as in E1 | B3-regression |
| B3b | Battery icon (1900,43) tapped over Melaton home, wide panel up | **PASS** log `popup bar tap over Melaton Mobile's page: closes quickaccess, the tap at 1900,43 handed to the page (battery)`; picture 3 s later: panel gone, Power popup open ("Main battery 100 %") | B3-battery-wide |
| B3c | same, strip | log line in 2 of 2 tries. First try (shot 4 s after): **no popup on screen**; second try (3 s and 9 s after): Power popup open. So **1 of 2** showed the popup in time, as E1's H7 ("late") | B3-battery-strip |
| B3d | FATAL / crash buffer during A, B, battery tests | `logcat -s AndroidRuntime:E` 0 lines, `logcat -b crash` empty (checked after B2, after B3) | - |

No timer loop or repeated screenshot added by the fix was seen: in the loaded sets the window picture was asked once per open (`try 1`) and never again.

## C. Edge swipe after Quick Access off / on (new fix)

Quick Access off and on **by taps**: Start (60,43) > Settings > Personal (the opening tab) > Buttons > tab Quick Access > untick "Swipe from the screen's
edge for Quick Access" > `ok` (config `enabled:false`) > (Melaton's update box "1 update is available for Melaton" answered with Later) > the same path, tick > `ok`
(`enabled:true`). Swipes over a fresh Android Settings: `input swipe 1965 840 1500 840 250` (starts on the last 3 px of the 1968 px width)
and `input swipe 1948 ...` (20 px in). "Pushed" = pixel test as in B; "stays" = `topResumedActivity` is Settings' homepage (a Back would leave it).

| Step | x=1965 | x=1948 | `dumpsys window windows` (top first; lower # = above) |
| --- | --- | --- | --- |
| C1 QA off, then on, by taps | **PASS** pushed, Settings stays, `bubble quickaccess drawn here` | **PASS** | zone #4 above BarEdge #5, #6 (windows-3) |
| C2 bars away and back: `AndroidBars.setConfig({enabled:false})` then `{enabled:true}` (the route of `configChanged` > `barsDown`) | **PASS** | **PASS** | bars off: only the zone is left (#3, windows-4); bars on again: **zone #2 above BarEdge #3, #4** and bars #5, #6 (windows-5); after the swipes zone #3 above BarEdge #4, #5 (windows-6) |
| C3 rotate 1 then back to 0 | **PASS** | **PASS** | zone above edges both times (windows-7, -8); rotation put back to auto (`accelerometer_rotation 1`, `user_rotation 0`) |
| C4 screen off 6 s / on | **PASS** | **PASS** | zone above edges (windows-9) |

Picture C2 (swipe from the last 3 px after bars off/on): Quick Access wide panel open, Settings pushed aside, soft keys Back / Home. The
trigger is only `configChanged` (bars enabled false) and `shutdown`: rotation and screen off/on do not take the strips away (the windows listing
is the same before and after), so C3 and C4 only prove the order stays right. The failure on release 44 was not reproduced here (not asked).
The first C1 run printed "unclear" for x=1965: my script's before-shot was taken while the Melaton Settings window was still going away, and a close-tap I
sent without a panel opened an Android Settings sub page (Storage); no setting was changed (airplane mode 0); redone from a force-stopped Settings
with a Back key close (the results above).

## D. Foreground service under load (item 5)

Tag DreamScapeFGS. Load = 20 busy loops started at the first adb answer (`LOADN`, as E1), `boot_completed`, +25 s `start-app`,
watch to the end. 4 CPUs. Each run: `lane.sh down`, `up` (cold boot). Raw filtered logs: `fgs-<run>.txt`, table: `fgs-table.txt`.

**D1 normal cold boot** (20:26): `start asked at idle after 230 ms (2 asks, from boot: true)` 20:26:23.873, `startForeground at create, type 1073741824, 3855 ms
after the process started` 20:26:24.140 (gap 0.27 s), then the window's own start 7 ms after its ask: `startForeground at start` x2, type unchanged.
Notification: id 1, channel `dreamscape_persistent`, flags ONGOING_EVENT|ONLY_ALERT_ONCE|NO_CLEAR|FOREGROUND_SERVICE, importance 2; service
`isForeground=true types=0x40000000`, as in E1. Crash buffer empty.

**D2 loaded cold boots** (load average = 1 min value at boot_completed / +25 s / end; ask = first `start asked at ...`; gap = ask to `startForeground at create`;
"seen" = seconds from the first DreamScapeFGS line to the end of the run):

| run | load avg | start ask | startForeground at create | gap | later ask at the bound | refused / fell back | exception / FATAL of the app | running + foreground at end | seen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 48 / 57 / 72 | 20:32:39.542 idle (1399 ms) | 20:32:42.782 | 3.24 s | 20:33:19.455 after 27292 ms | none | none | yes | 166 s |
| 2 | 40 / 50 / 69 | 20:38:18.222 idle (164 ms) | 20:38:25.530 | **7.31 s** | - | none | none from the app - **void run, see below** | yes (second process) | 172 s |
| 3 | 41 / 54 / 82 | 20:44:45.408 idle (20288 ms, after start-app) | 20:44:45.586 | 0.18 s | - | none | none; ANR 20:45:14 (below) | yes | 128 s |
| 4 | 38 / 54 / 87 | 20:50:18.936 **at the bound** (23975 ms, warn) | 20:50:23.545 | 4.61 s | (the first) | none | none; ANR 20:50:25 | yes | 134 s |
| 5 | 44 / 55 / 92 | 20:56:30.954 **at the bound** (46261 ms, 3 asks) | 20:56:33.271 (92265 ms after the process started) | 2.32 s | (the first) | none | none | yes | 105 s |
| 6 | 37 / 45 / 86 | 21:01:50.998 idle (21463 ms, after start-app) | 21:01:51.473 | 0.47 s | - | none | none; ANR 21:02:32 | yes | 115 s |
| 7 | 34 / 47 / 81 | 21:07:40.760 **at the bound** (27796 ms, 3 asks) | 21:07:43.014 | 2.25 s | (the first) | none | none; crash buffer: Bluetooth stack (below) | yes | 113 s |
| 8 | 42 / 54 / 77 | 21:18:11.700 idle (384 ms) | 21:18:13.766 | 2.07 s | 21:19:14.839 after 21095 ms | none | none | yes | **225 s** |
| 9 | 37 / 46 / 72 | 21:24:48.383 idle (619 ms) | 21:24:52.792 | 4.41 s | 21:25:31.029 after 17600 ms | none | none | yes | **227 s** |

- No `start refused`, no `fell back`, no `ForegroundServiceDidNotStartInTimeException`, no `Bringing down service while still waiting for start foreground`
  anywhere in the 10 logs; every run ended with `DreamScapeForegroundService isForeground=true types=0x40000000`, the notification posted.
- **Run 2 is not a result.** At 20:38:15 `com.android.systemui` crashed (`BluetoothAdapter.registerBluetoothManagerCallback`, "Timed out waiting for 10000 ms"),
  at 20:38:34 `system_server` died ("Lost network stack ... side effect of a crash that happened earlier"), every process was killed; the app logged
  `DeadSystemException` at 20:38:40 (SIGKILL). The service had been foreground at 20:38:25 before that. After the framework came back the app started again
  (ask idle 20:40:57.329 after 1020 ms, create 20:41:01.809, gap 4.48 s) and was foreground at the end. It is the guest failing under load average 70, not a
  start failure; I counted it out and ran **runs 8 and 9** in its place.
- **Runs 1-7 were watched less than the 150 s you asked for after the start line in runs 3-7** (105-134 s; the first line came late because the app's process
  started late). They cover the 64 s that E1's crash needed (18:57:35 ask, 18:58:39 crash). Runs 8 and 9 (watch 215 s after `start-app`) saw 225 and 227 s.
- Observations outside the service: ANR in `jp.net.seventhreeseven.dreamscape`, "executing service .../MelatonBarService, waited 42798 ms / 20671 ms / 20655 ms"
  in runs 3, 4, 6 (load average 60-84); the process was not killed. The same main-thread backlog is what the FGS fix avoids. Run 7: crash buffer holds a
  native abort of `com.google.android.bluetooth` (HCI timeout 21:08:39), run 3: `crash_dump helper failed to exec` of pid 716 (system_server) - the guest's own
  stack under load, nothing of the app. Closest call: run 2, 7.31 s from the ask to `startForeground` (the platform limit is 10 s); the start asks come from the idle hook
  now, but onCreate still waited 7 s for the main thread once.
- Honest limit: in the `at the bound` runs the main thread never went idle for 18-46 s after boot; the fix then asks at the bound and `startForeground` followed
  within 2-5 s. That is what the fix is built to do, and it held 8 of 8; it does not mean the thread is any less busy.

**D3 `kill-app` x3** (`fgs-kill.txt`): killed pids 2036 (load average 73 at that moment), 4557, 4940; new pids 4557 (after 1 s), 4940 (4 s), 5130 (15 s);
`startForeground at create` 675, 102 and 96 ms after the process started; 25 s later `isForeground=true types=0x40000000`, notification flags as above, no crash
of the app (the crash buffer still held only the earlier Bluetooth abort). **PASS 3 of 3.**

**D4 redundant start** (`fgs-redundant-start.txt`): with the service running, `start-app` twice: `start asked at idle after 873 ms` / `after 2 ms`, each
`startForeground at start, type 1073741824`; the service stayed foreground, type 0x40000000 unchanged, no AndroidRuntime line, crash buffer empty. A further
`start-app` with the app already open logged nothing (no start is made). The page path and the boot alarm were not triggered (as in E1).
**PASS.**

## Defects and observations

1. Tile: "Performance" is whole but 1-2 px from the frame (A). Not a defect of the brief's wording, a taste call.
2. Strip + home + battery: the Power popup was missing 4 s after the tap in one of two tries (B3c); the log line was there both times. E1 saw the same delay.
3. D: ANRs of `MelatonBarService` (20-43 s) and 7.3 s from ask to onCreate under load average 40-90. Not caused by the FGS change, but the service start still depends on the
   main thread; the fix lets it survive, it does not shorten the backlog.
4. Melaton's page shows its own "1 update is available for Melaton. Melaton restarts to install them." box (Install Now / Later) on the Today page after each page
   restart (the lane's page is behind a pending client update from other sessions' builds). I answered Later where it covered a soft key; not a notice of this work.
5. The lane's `up` sets music volume to 2 after every cold boot (`quiet_volumes`: "media 2"), so media was 2 on the speaker after each cold boot of the run, not 0 (the instance
   is `-no-audio`). I set it to 0 at the end. `lane.sh sound` from the start mark to the end: `count 0`, `playedCount 0`, `alarmLikeStarted 0`. No new notice, sound
   or icon from the app was seen.
6. My own mistakes, all harmless: the first load run was started twice by my scripts (two loops interleaved; both killed, load removed, results discarded and run again);
   a stray close-tap opened Android's Storage page once (force-stopped Settings after; airplane mode 0 checked).

## Not tested

A long Bluetooth sub-label (no speaker fixture), the 2-column strip, the wide panel over Melaton home (A only over Settings), the real media tile (Output opened by
`AndroidMediaSession.openOutputSwitcher("")` as in E1), the A53 or any real phone, the failure on release 44 for C, a loaded boot with Quick Access / Bars on (the loaded boots ran with
both off, as the golden has them).

## State left

`aemu-fold-1`: running, release 45 (3633156) installed, app and page up on Melaton 6.1; Melaton Bars config and Quick Access config **restored** with `setConfig(<found>)`
and compared: no difference to `bars-config-found.json` / `quickaccess-config-found.json` (enabled false both); `localStorage.wmCameraExtendBar` removed; kept layouts rebuilt
(`wmShell.quickAccessLayouts()`); rotation auto (`accelerometer_rotation 1`, `user_rotation 0`); airplane mode 0; media volume set to 0 at the end; no busy loops, no
`/data/local/tmp` files of mine; Android Settings stopped. Gates: 361 (build, ended ok), 362 (install, forced with reason, ended ok). Lease 320 released at the end
with `coord_device_release aemu-fold-1`.
