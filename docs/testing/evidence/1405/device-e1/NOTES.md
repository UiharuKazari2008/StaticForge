# #1405 device proof E1: drawer still, battery icon over home, foreground service start (DSApp release 44)

Nov 27 2026, 17:00-19:30 EST (log times are the guest clocks). Planner: Fleet session 7422ffc1 (E1 and E2 share its coord id).
Release 44 = 1.0.3632992 (versionCode 3632992, build/latest 7d8a6d8, APK sha256
`3443b06ba98db4d985ef4a13b12fb5efa23593742d1d0389d02d52451069f86a`). Code read in `/home/kanmi/wt/dsapp-1405` (0270983d) and
`/home/kanmi/wt/dsapp-1405-fgs` (840fde9a). No source was changed. No sound was made (`lane.sh sound`: see "State left").

**Devices**
- `aemu-fold-1` (Android 17, inner display 1968x2184). It was granted at 17:00, was found wedged (adb answered `get-state`, every
  `shell` hung 100+ s, the guest did not answer), `reset` from golden failed twice (`golden did not boot`), a cold `up` worked at
  17:19. Golden has Melaton Bars off and an older app (3631770): installed release 44 once (gate 343, forced with a reason: the two
  agents that did not answer were idle and the install touches no repo file; result `{"versionCodeAfter": 3632992}`).
- The A53 (`R5CT71TSEMZ`, SM-A536U1, Android 16) was **not reachable at first** (ping and 5555 dead at .236, Bluetooth link
  `Custodian service not found`, 17:09 to 18:35). `a53.sh up` found it at 18:36 by its mDNS name at **192.168.100.233** (new address),
  5555 re-armed over Wireless debugging, unlocked. Release 44 installed once with `adb install -r` over Wi-Fi (gate 349), versionCode
  checked (3632992 before: 3632251), lease released at 18:50.
- Ruiko (the host of the emulators) was at **85-100 % CPU the whole run** (other agents' emulators and builds). Every lane time below
  is measured on a busy host: the "normal" opens are not calm-system times. The A53 numbers are the only ones free of it.
- Collision: E2 (same coord id) took the same alias and overwrote my lease's `why`; E2 moved to `aemu-a53-4`. The `why` of the fold-1
  lease still says E2.

## Summary

- **Item 1 (drawer still): PASS on the lane, measured on the A53.** 40 of 40 normal opens `still in time` and pushed; under load the 180-400 ms
  stills (up to 259 ms) were pushed in time, 15 of 15 opens that passed 400 ms got the late push with the slide and a pushed screen, the
  late display still is recycled every time. The A53's slowest capture in 49 opens was 44 ms (median 21): 400 ms is sound.
- **Item 3 (interval): the two limits are separate** (AOSP and the image's services.jar). `firstAskDelay` was never engaged on a possible
  re-open; the late push's own wait (`latePlan`) added 38-300 ms 17 times for nothing. A real `code 3` happened once from another caller
  of `takeScreenshot` that does not set `lastShotAt`. Change: split the timestamps (details below).
- **Item 4 (battery icon over home): PASS** for every case asked (battery, volume, signal, Start, empty bar, Output panel, soft keys,
  corner ok over a program, over a program as before). Strip popup came late on the loaded guest.
- **Item 5 (foreground service): FAIL for 5.2.** The exception still happens when the main thread's backlog keeps `onCreate` away for more
  than the system's timeout: 1 of 5 loaded cold boots (load average 47-66) on release 44. Normal cold boot, `kill-app` x3 and the window's
  redundant start are fine; the type and notification are unchanged.

## Results

| # | case | steps | result | evidence |
| --- | --- | --- | --- | --- |
| 1.1a | Normal opens, strip, Quick Access, over Android Settings | 10 real edge swipes, each closed by a tap outside | **PASS** 10/10 `still in time, ask -> got N ms`, 10/10 pushed (pixel comparison: after = before moved left 148 px). N 24-55 ms, median 39.5 | item1-1-normal-opens.txt, img-1a |
| 1.1b | strip, Output panel | 10 fresh drawer opens through the page bridge `AndroidMediaSession.openOutputSwitcher("")` (see note 1) | **PASS** 10/10 in time, 10/10 pushed. N 16-38, median 21.5 | same, img-1b |
| 1.1c | wide, Quick Access | 10 real swipes (594 px) | **PASS** 10/10 in time and pushed. N 16-83, median 28.5 | same, img-1c |
| 1.1d | wide, Output panel | 10 bridge opens | **PASS** 10/10. N 14-58, median 19.5 | same, img-1d |
| 2a | Stills between 180 and 400 ms | load sweep (2, 4, 6, 8 busy loops, 2 screencap loops, 12 loops + screenrecord) | **PASS** the stills that took 159, 170, 172, 192, 194, 234, 244, 259 ms (all > 146 ms) were `still in time` and the screen was pushed (pixel + picture). **The highest in-time N was 259 ms** | item2-load-opens.txt, img-2c |
| 2b | Limit passed, late push | same sweep + 3 transient-load recordings | **PASS** 15 of 54 opens under load passed the 400 ms limit; **15 of 15** then logged `late push asks for the program's window picture` and `late push: window picture in N ms, screen pushed aside`, and the final screenshot was pushed in every one. The late display still's line says `recycled` every time. Window pictures took 465-2289 ms under load | item2-load-opens.txt, img-2b |
| 2b-rec | Recording: panel first, then the screen slides | screenrecord during a transient load (8 loops for 2 s) | **PASS, weakly**: frame at 6.24 s panel up over the unmoved program, frame at 6.58 s program part-way (offset about a third), frame at 6.70 s fully pushed. The recorder gives 7-9 frames per second, so only one intermediate frame is caught of the 180 ms curve. Three other recordings showed panel-then-pushed with no intermediate frame | img-2b-late-push-frames.png |
| 3 | Interval question | AOSP source of two branches, the emulator image's services.jar, 38 re-opens (fold) + 8 (A53) | see "Answer to the interval question": **the two limits are separate**; and the re-open delay (`firstAskDelay`) was never reached on a re-open that can be made | item3-*.txt |
| 4.1 | Back key (`sendevent`), soft Back, left edge, right edge, outside tap over Android Settings, wide Quick Access and Output | 5 closes x 2 panels | **PASS** every close left the screen equal to before (0-368 px of 4.3 M differ: clock), program stayed (`topResumedActivity` Settings), no leftover | item4-regression-run1.txt (first 5 rows), item4-regression-run2-settings.txt |
| 4.2 | Swipe up from the soft key bar | wide QA and Output over Settings | **PASS** closes, Home (Nexus launcher on the lane) | same |
| 4.3 | Screen off 6 s / on with a panel up | wide QA and Output over Settings | **PASS** panel gone after the wake, program unchanged | same |
| 4.4 | 10 quick open-close | guest loop `swipe; sleep 0.7; tap; sleep 0.9` x10 with a screenrecord | **PARTIAL** the loaded guest ran the loop slowly: 4 opens and 2 outside closes registered, the others were cancelled by the next open; last log line `window picture came after 1451 ms, recycled (another open or a cancel took the panel's place)`; final screen equal to before. Not 10 real open-close pairs | item4-quick10-segment.txt |
| 4.5 | Crash / bitmap check | `logcat -d` and `-b crash` on the fold during all of items 1-4 | **PASS** no FATAL, crash buffer empty, no `recycled bitmap` / `Canvas: trying to use a recycled bitmap` in the log. (Item 5 crashed once: below) | - |
| H1 | Battery icon over Melaton home, wide Quick Access | tap 1900,43 | **PASS** log `popup bar tap over Melaton Mobile's page: closes quickaccess, the tap at 1900,43 handed to the page (battery)`; panel gone, the Power popup open; after Hide nothing left | img-4-home-w1-battery-all.png |
| H2 | Volume icon | tap 1833,43 | **PASS** `(volume)`, Volume popup opens | img-4-home-w2-volume-all.png |
| H3 | Signal icon | tap 1753,43 | **PASS** `(signal)`, Phone popup | img-4-home-cases-a.png (row 1) |
| H4 | Start corner | tap 100,44 | **PASS** `(start)`, Start menu opens | img-4-home-cases-a.png (row 2) |
| H5 | Empty part of the title bar | tap 1000,43 | **PASS** `(no icon)`: panel closes, nothing opens | img-4-home-cases-a.png (row 3) |
| H6 | Output panel instead of Quick Access, battery | bridge open, tap 1900,43 | **PASS** `closes output.1 ... (battery)`, Power popup | img-4-home-cases-b.png (row 1) |
| H7 | Strip layout, battery | 4 runs | **PASS with a delay**: the log line `closes quickaccess ... handed to the page (battery)` was there in all 4 (and `closes output.1 ... (battery)` for the Output strip); the Power popup was on screen 3 s after the tap in 1 of 3 runs I looked at, in another it was on screen only when the next run opened (the guest was loaded); the 8 s run was spoiled by my stray tap (observation 5) | img-4-home-s23-all.png |
| H8 | Soft keys over home with a panel up | tap the left soft key 441,2120 | **as expected**: panel closes only (`popup tap 442,2120: outside: closed`), nothing opens | img-4-home-cases-b.png (row 2) |
| H9 | Title bar corner = ok, over a program | `AndroidBars.setConfig corner:ok`, tap 1917,45 with wide Quick Access up over Settings | **PASS** `popup bar tap: corner`, panel closes, program unchanged (133 px differ), corner restored to `close` | img-4-prog-p2-all.png |
| H9b | Title bar corner = ok, over home | tap 1917,45 | **not testable as intended**: Melaton's home title bar has no corner button; the rightmost icon there is the battery, the tap at 1917,45 landed on it (`(battery)`) | img-4-home-w7-corner-ok-all.png |
| H10 | Over a program (battery) | wide QA over Settings, tap 1840,43 | **PASS, behaves as before**: `popup bar tap: battery (open: quickaccess)`, panel closes, Power popup opens | img-4-prog-p1-all.png |
| 5.1 | Cold boot, fresh app start | `lane.sh up` (cold boot) then `start-app` | **PASS** `startForeground at create, type 1073741824, 10781 ms after the process started` at boot (`foreground from boot / update`), then `startForegroundService asked by the window, after its launch message` 4 s after `start-app`, then `startForeground at start ... 42816 ms`. Type, channel and flags equal the old build's (below) | fgs-normal1.txt |
| 5.2 | Cold boot under load, 5 runs | busy loops started at the first adb answer (`LOADN`), then `start-app` 30 s after the boot; crash buffer read at +40 s (runs 1-3) or +150 s (runs 4-5) | **FAIL**: run 3 (20 loops) crashed with `ForegroundServiceDidNotStartInTimeException`, the other four did not (runs 1-2 were looked at for 40 s only, so they are not proven) | fgs-load1..5.txt, fgs-load3-crash-log.txt |
| 5.3 | `kill-app` x3 | see below **PASS** 3 of 3: new pid after 2, 4 and 15 s (`lane.sh kill-app`, root kill -9), `startForeground at create` 838, 113 and 129 ms after the process started, `isForeground=true types=0x40000000`, no crash of the app, no page started (the page was absent until my `start-app` afterwards). The first kill ran while the guest still had a load average of 68 (the loops of run 5 had just been stopped) | fgs-kill.txt |
| 5.4 | A start while the service runs | the window's start after `start-app` on a running service; page `setSession` and the boot alarm were not triggered | **PASS for the window path** (`startForeground at start`, type unchanged, service stayed foreground); the page path and the alarm were **not triggered** | fgs-normal1.txt |
| A53 | Capture times on the phone (item 5 of the brief) | 49 opens over Android Settings | numbers below | a53-item5-opens.txt |

Note 1 (Output panel opens): the Output panel is opened from Quick Access as the next page of the open panel (no new drawer: no new
still). A fresh drawer open of the Output panel comes only from the media entrance, so the 20 "Output" opens above use the bridge
call the media tile makes (`AndroidMediaSession.openOutputSwitcher("")` over DevTools). The real media tile was not pressed.

## Capture times

Fold lane, `ask -> got` in ms, 40 normal opens: min 14, median 25, max 83 (strip QA 24/39.5/55, strip Output 16/21.5/38, wide QA
16/28.5/83, wide Output 14/19.5/58). Under load, 39 in-time opens: min 35, median 103, max 259; 15 of 54 passed the limit.
All lane times were taken with Ruiko at 85-100 % CPU.

**A53 (real phone), release 44, Android Settings in front, Quick Access strip (173 px) and wide (693 px) and the Output panel:**

| kind | opens | min | median | max |
| --- | --- | --- | --- | --- |
| strip, Quick Access | 13 | 15 | 20 | 32 |
| strip, Output | 6 | 18 | 34.5 | 44 |
| wide, Quick Access | 16 | 15 | 20 | 24 |
| wide, Output | 6 | 15 | 32.5 | 37 |
| **all** | **41** | **15** | **21** | **44** |

Eight re-opens of the Output panel 0.96-7.6 s after a close (`item3-a53-output-reopen.txt`): N 21-36 ms. So 49 opens in all; **0 of 49
passed 146 ms, 180 ms or 400 ms**; the slowest was 44 ms. 400 ms is nine times the slowest capture measured on the phone, and on the
slowest the lane showed (259 ms in time; 15 of 54 loaded opens over 400 ms, at a load average of 20-65 on 4 CPUs) the limit decides
whether a screen is pushed at once or by the late path. On the phone 400 ms is sound, with margin to spare; 180 ms would have been sound
there too. (The first four "wide" A53 opens came up as the strip: the kept layout followed Quick Access's setting only from the fifth
open, about a minute after `setConfig` + `quickAccessLayouts()`; that is E2's item 6, not retested here.)

## Answer to the interval question (item 3)

**The two limits are separate. A window picture does not use the display screenshot's limit.**
1. AOSP `AbstractAccessibilityServiceConnection.java` (branch `main` and `android16-release`, fetched from android.googlesource.com):
   `takeScreenshot(displayId)` checks `mRequestTakeScreenshotTimestampMs` (one `long` per service connection, line 245, check 1472-1479);
   `takeScreenshotOfWindow(windowId)` checks `mRequestTakeScreenshotOfWindowTimestampMs`, a `SparseArray<Long>` **per accessibility
   window id** (line 250, check 1421-1427). Both compare against `ACCESSIBILITY_TAKE_SCREENSHOT_REQUEST_INTERVAL_TIMES_MS` (333).
2. The emulator image's own `/system/framework/services.jar` (Android 17, API 37) holds both fields in `classes.dex`
   (`mRequestTakeScreenshotOfWindowTimestampMs`, `mRequestTakeScreenshotTimestampMs`): `item3-interval-source.txt`.
3. On the device this could **not be shown directly**: no re-open could be made within 333 ms of a window picture (see below), and the app's own
   delay never lets a display ask follow its own pictures that closely, so it would hide a refusal anyway. The sources are the evidence.

What this means for the code (file:line in `/home/kanmi/wt/dsapp-1405/app/src/main/java/jp/net/seventhreeseven/dreamscape/`):
- `MelatonBars.kt:3654` `firstAskDelay(t0, lastShotAt)` delays the display still after **any** recent picture (`lastShotAt` is set by the
  live refresh at 3920/`shotAsked()` 3607, the translucent check 2927, the late push 3727, and the display shots 3660, 6193, 6221).
  On a re-open that can really be made it was **never engaged**: the Output re-open after a close came 467-3844 ms after the close
  (the live refresh stops with the panel, its last picture is that old), the ask was always 34-49 ms after the open (34 ms plan) in all
  28 fold and 8 A53 re-opens that show it (from the `still in time` N, or from `still out for X ms ... since the open Y`). The edge
  swipe cannot re-open earlier at all: 10 of 10 swipes that started 0.2-0.7 s after a close opened nothing (the edge zone is not back
  yet); the two that started 0.9 s and later opened. So the cost the brief feared ("up to ~300 ms on a re-open
  right after a close") is not reachable by an edge swipe or the bridge; it could only follow another window picture within 333 ms
  (the translucent check right after a program change).
- `MelatonBars.kt:3707` `DrawerStill.latePlan(why, now, lastShotAt)` makes the **late push wait for a window picture's turn after the
  display still's ask**. It logged `late push waits N ms for Android's interval between screenshots` 17 times, N = 38 to 300 ms
  (38, 51, 77, 87, 91, 119, 124, 125, 159, 182, 204, 223, 232, 236, 252, 292, 300): each is added to the time the screen is pushed.
  With separate limits it is pure delay. Fix: a window picture is delayed only by an earlier picture **of the same window id** (keep a
  per-window timestamp for the live tick 3920, translucent 2927, `lateShot` 3727), and the display still only by an earlier
  **display** screenshot (3660, 6193, 6221 and the other callers below). `DrawerStill.kt` `gapWait` / `firstAskDelay` / `latePlan` take
  the right timestamp instead of one `lastAskAt`.
- **A real `code 3` did happen once on the display still** (18:32:51, `panel push: no still (code 3 - Android's interval between
  screenshots, 421 ms after the ask)`), over Melaton home right after a program window was opened and closed by a stray tap of mine
  (a Videos window). The display limit is per service connection and **other callers do not set `lastShotAt`**:
  `TaskShots.kt:30,97`, `HomeSwipe.kt:140`, `ScreenGrab.kt:61`, `DexAltTab.kt:179`, `DexStartMenu.kt:348`, `WalletImport.kt:288` all
  call `takeScreenshot` on the same connection. A shared timestamp of the last display screenshot, set by one wrapper that all of them use,
  would make `firstAskDelay` right. (The cause of that one refusal is not proven: the log tags I captured do not name the other caller.)

Other measured facts that bear on the 400 ms: re-opens within about 620 ms of a close (Output panel, fold) had their display still
arrive after the limit in 6 of 6 cases at 467-621 ms (still out 361-372 ms at the limit, the late still 436-1504 ms after the ask);
of the 8 re-opens at 642-998 ms, 5 were in time, 2 passed the limit (824, 844 ms) and 1 logged no panel line at all; the cause is not shown (a window picture of the live refresh may still be in flight in system_server). On the A53 no such effect
(21-36 ms at every re-open).

## Defects and observations

**FAIL 1. The foreground service still crashed on a loaded cold boot (item 5.2).** Release 44, 20 busy loops from the first adb answer
(load average 47 to 66 on 4 CPUs): 18:58:39 `ForegroundServiceDidNotStartInTimeException` in `DreamScapeForegroundService`
(`fgs-load3-crash-log.txt`). Timeline from the log: process started 18:57:00; **18:57:35.462 the boot path calls
`startForegroundService`** (system_server: `Background started FGS ... intent has extras`, the `EXTRA_FROM_BOOT` start of
`activesync/ActiveSyncBootReceiver.kt:98`); the main thread did not reach the service's `onCreate` until 18:58:20.891 (`startForeground at
create ... 80730 ms after the process started`); system_server had already logged `Bringing down service while still waiting for start
foreground` at 18:58:11; the app crashed at 18:58:39 and Android restarted it 21 s later (the service was foreground again at 18:58:44, pid
3347). The fix puts `startForeground` first in `onCreate` and moves the window's start after its launch message, but a start made
**from the receiver / identity path** is still queued behind the main thread's backlog (the main window's launch, started by my
`start-app` 14 s earlier, took the main thread for 70 s: `startForegroundService asked by the window` came only at 18:58:31). Calls that
run from the same main thread and are followed by a long backlog cannot make the 10 s: `activesync/ActiveSyncBootReceiver.kt:98`,
`activesync/ActiveSyncIdentity.kt:82`. What the change must do: ask for the start only when the main thread is about to be free (post the
call from an idle handler / after the launch message, as the window path now does; or do not start the foreground service from a
receiver while an activity launch is pending), and check the timeline above. Other loaded boots: see the table; a run is only counted as
passed here when the crash buffer was still empty 150 s after `start-app` (the first three runs were looked at for 40 s only: load 1 and
2 are **not proven**, the crash of run 3 came 78 s after `start-app`).

**The five loaded cold boots** (busy loops started at the first adb answer; `start-app` 30 s after `boot_completed`; the guest has 4 CPUs):

| run | busy loops | load average at +0 / +25 s / +40-150 s | start that the service waited for | `startForeground at create` | own crash? |
| --- | --- | --- | --- | --- | --- |
| load1 | 12 | 33 / 45 / 63 | boot path, time of the call not logged | 18:47:20, 54977 ms after the process started; ANRs in systemui, phone, gms, ime, calendar | none in 40 s (not proven) |
| load2 | 16 | 34 / 49 / 55 | the window's call 18:52:02.287 | 18:52:03.786 = 1.5 s later, 61367 ms after the process | none in 40 s (not proven) |
| **load3** | 20 | 47 / 55 / 66 | **boot path 18:57:35.462** | **18:58:20.891 = 45 s later**, 80730 ms after the process | **CRASH 18:58:39, `ForegroundServiceDidNotStartInTimeException`; the system restarted the service 21 s later, foreground again, pid 3347** |
| load4 | 12 | 40 / 41 / 64 | the window's call 19:05:32.978 | 19:05:54.867 = 21.9 s later, 175591 ms after the process | none in 150 s |
| load5 | 20 | 48 / 57 / 80 | boot path 19:10:44.478 | 19:11:05.205 = 20.7 s later, 91035 ms after the process; SystemUI itself crashed at 19:09:17 (`Timed out waiting for 10000 ms`, not ours) | none in 150 s |

The service is created 20 to 45 s after the call in every loaded run that logged it; whether the app crashes depends on when
system_server's 10 s timeout message reaches the app's busy main thread (load4 and load5 survived 21 s, load3 did not survive 45 s). So the
fix makes `onCreate` cheap but does not make it earlier: under this load nothing the service does can run before the main thread's backlog
(the activity's launch, the WebView start) is through.


**Observation 2. A stalled capture can leave a panel laid over with no push.** Once in about 190 opens the system's screenshot service did not
answer for 48 s (guest-wide stall, adb commands also stalled; Ruiko at 100 %): the late display still came `48758 ms after the ask`, the
late window picture failed with `code 1` and `given up`. The panel stayed laid over an unmoved program until closed. The line is logged;
only code 3 is retried (`DrawerStill.retryDelay`).

**Observation 3. A pixel check of "pushed" needs the shot to wait for the late push.** The first two loaded opens looked "unmoved" in a
screenshot taken 4 s after the swipe while the late push came at 4 s; with a 7-9 s wait every one was pushed. Two other "unmoved"
verdicts (loaded runs `ld12-wide-out-4` and `lv6b2c-wide-qa-3`) were my comparison's stale "before" picture (the shot call failed under
load); the pictures themselves show the screen pushed.

**Observation 4. Back key and the battery / volume popup.** With the Power or Volume popup open (over home: the page's popup; over a
program: the app's), a key through `sendevent` (the real Back) did not close the popup; over the program it went to the program (Storage
went back to Settings). Closing needs Hide or an outside tap. Not part of this change.

**Observation 5. One accidental side effect, restored.** My first run toggled Airplane mode on (a tap that landed on the Settings row
"Airplane mode" when the Settings page was already on Network & internet): Wi-Fi was off for the wide-panel run until I found it at
17:41 (`cmd connectivity airplane-mode disable`, value 0). It did not change the panel measurements (no network is used by the panel).
Two later "Hide" taps with no popup open landed on a Today item and opened a stream / Videos window; both were closed by the corner.

**Observation 6. Strip over home:** the popup after a battery tap took more than 3 s in 2 of 3 looked-at runs on the loaded guest; the log
line is always there.

**Observation 7. Output panel opens: two timer-based tries of mine (`setTimeout` in the hidden page) fired when the page became visible
later and opened an Output panel over Melaton home by themselves** (a page effect of my driver, not an app defect).

## Not tested

- The real media tile (Output panel's fresh open used the bridge call); a second output device; the 2-column strip.
- Item 4 over Android Settings on the A53 and the battery icon on the A53 (not asked for the phone).
- The page `setSession` path and the boot receiver's alarm for item 5.4.
- The old build's loaded boot for comparison (one install of release 44 only; the baseline is the golden's build 3631770 at a normal boot).
- Real finger gestures (all input is `adb shell input`; the Back key is `sendevent` on the emulator keyboard).
- A mid-slide capture on the way out of a panel (the recorder's frame gap is longer than the 180 ms slide).

## Baseline of the notification and the service type (item 5.1)

| | golden build 3631770 (before) | release 44 after the install | release 44 after a cold boot + start-app |
| --- | --- | --- | --- |
| channel | `dreamscape_persistent` | same | same |
| flags | ONGOING_EVENT, ONLY_ALERT_ONCE, NO_CLEAR, FOREGROUND_SERVICE | same | same |
| title | DreamScape | DreamScape | DreamScape |
| text | "Waiting for Application" (page not connected yet) | "Default · 92 · 6633 + 22825 anlas" (page connected) | same as the middle |
| service type | `types=0x40000000` (special use), `isForeground=true foregroundId=1` | same | same |
| small icon resource id | 0x7f0800c1 | - | 0x7f0800c0 (resource ids differ between builds) |

The notification text is the page's state, not the build's: the old build showed "Waiting for Application" while no page was
connected, release 44 the same state right after the boot before the page connected (not captured: the first snapshot after the
boot has the page connected).

## State left

**aemu-fold-1** (kept running, lease released at the end): release 44 installed (was 3631770, the golden's); Quick Access config restored with
`AndroidQuickAccess.setConfig(<found>)`: equal to `quickaccess-config-found.json` except the key `anchor: "top"`, which `setConfig` adds
(absent reads as top, same behaviour; same as the earlier #1327 runs); Melaton Bars config restored with `AndroidBars.setConfig(<found>)`:
equal to `bars-config-found.json` (enabled false, softkeys false, corner close); `localStorage.wmCameraExtendBar` removed (was unset); Android
Settings task left on its main page; Airplane mode 0; auto-rotate 1; rotation 0; no loops, no recording, no files of mine in the guest
(`/sdcard/e1-*.mp4`, `/data/local/tmp/e1load.pids` removed). The kept panel layouts were not rewritten after the restore (the page's `wmShell`
was not loaded yet): they follow the settings once it is (E2's item 6). The page is on 6.1 as found. The instance was down 17:00-17:19 (found
wedged) and was cold-booted 7 times by this run (for items 1 and 5). Sound: `lane.sh sound` at the start and at the end: `count 0`,
`playedCount 0`, `alarmLikeStarted 0`; media volume untouched (the lane sets it at `up`); nothing played, no notice sent.

**A53**: unlocked (by `a53.sh up`), Melaton home in front (as found), now at 192.168.100.233:5555 (it was .236), release 44 installed (was
3632251), Quick Access config restored with `setConfig(<found>)` and checked equal to `a53-quickaccess-config-found.json`
(enabled false, strip, anchor top), Bars config untouched (already on), my `adb forward tcp:9453` removed (list empty), my two logcat readers
stopped, nothing recorded or left in `/sdcard` by me (`fl.mp4` and `qc.mp4` there are other agents'), no sleep / lock / reboot of the phone,
battery 39 to 43 % on AC, lease released at 18:50.

**Files**: big raw files (logcat of the run, the screen recordings `e1-load.mp4`, `e1-slide-*.mp4`, `e1-close.mp4`, `e1-quick.mp4`, the AOSP
source, the frame folders, the scripts `cycle.sh`, `pushed.py`, `analyze.py`, `itvtable.py`, `reboot_test*.sh`, `slideoff.sh`) are in
`~/.cache/claude-run/1405/e1/`. Build gates: 343 (fold install, forced), 349 (A53 install, forced), both ended `ok`.

