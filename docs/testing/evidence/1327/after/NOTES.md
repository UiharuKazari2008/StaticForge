# #1327 / #1395 Output panel: device run AFTER the fix

Instance `aemu-fold-1` (`emulator-5556`, Android 17, `-no-audio`), release 38 (versionCode 3632251, build/latest
5745486, which holds `feat/1327-output-panel` 94d2420: `release-proof.txt`), Nov 27 2026, about 04:33-05:35 EST (log
times are the guest clock). **Every picture and tap is the inner display (display 0, 1968x2184).** Cover display, DeX,
external display, the A53 and the Fold were not used. Pictures are scaled down and reduced to 160 colours. Pictures over
Melaton's own home are cut to the panel's side or the top, because the rest is the account's Today screen.

Open = real swipes and taps (strip: edge swipe, page arrow, tile; wide: edge swipe, row). "Back key" = `sendevent` on
`/dev/input/event13` (through InputReader). "Soft Back" = tap 441,2120. Edge swipes = the before run's two commands
(left from x=3, right from x=1964, on the panel itself); both are logged as "edge swipe on the popup".

## Results

| # | case | steps | result | evidence |
| --- | --- | --- | --- | --- |
| 0 | Page current | `wmQuickAccess.roles()` | **PASS** output.0..output.8. Right after the install and app start `wmQuickAccess` was not loaded yet; it loaded once Settings was in front | release-proof.txt |
| 1a | Strip 1 column over Settings | tile, screenrecord | **PASS** Quick Access page -> Output, program stays pushed, no slide home or blink in 21 frames; in bounds, opaque like Quick Access, "Speakers" in its row | 01, 02, log-01 |
| 1b | Strip 1 column over Melaton home | same | **PASS** Today pushed; the recording has only the before and after frames | 03, log-01 |
| 1c | Strip 2 columns over Settings | same | **PASS** 28 frames | 04, log-01 |
| 1d | Wide over Settings | same | **PASS** 34 frames | 05, 06, log-01 |
| 1e | Wide over home | same | **PASS** Quick Access -> Output, 3 frames | 07, log-01 |
| 1f | The drawer pushes the screen aside on EVERY open | repeated opens | **FAIL** 05:18-05:24: 12 of 12 opens over Settings (strip 1 column, Quick Access and Output, also in a fresh app process) came up laid over an unmoved program, with no slide. See defect 1 | 26, 27, log-08 |
| 2 | One draw only | all logs | **PASS** no `output.0` in the saved logs (26 output.N draws in the logcat extract 04:39-05:19, all .1 or .2; the later ones logged at 05:20, 05:22 and 05:31 were .1 too) | log-01, log-08 |
| 2b | First open with MEDIA_ROUTING_CONTROL at default | `appops set ... default`, open | **PASS** "media routing not allowed: asking the app's shell once", `output.1` 54 ms after the tap, no `output.0`; app op then `allow`. The SecurityException warning stack is still logged (10 lines) | log-01 |
| 3a | Output: Back key | over Settings | **PASS** closed, program stayed; next Back reached the program | 08, log-02 (`back-out-key`) |
| 3b | Output: soft Back | strip; also wide | **PASS** same | 08, log-02, log-01 |
| 3c | Output: left edge swipe | | **PASS** same | 08, log-02 |
| 3d | Output: right edge swipe | starts on the panel | **PASS** same | 08, log-02 |
| 3e | Output: title bar corner as ok | `AndroidBars.setConfig corner:ok` (not by taps), restored to close | **PASS** closed, program stayed; second ok went Back in the program | 11, log-09 |
| 3f | Output: title bar corner as X (the setting found) | | Closes and goes Home: X is Home, not Back, in this setting | log-09 |
| 3g | Quick Access: Back key, soft Back, left, right | over Settings | **PASS** 4 of 4, program stayed, next Back reached it | 09, log-02 |
| 3h | `input keyevent 4`, once (record only) | Output strip | As documented: panel **stays**, program under it goes back (a second one left Settings and the panel went) | 10, log-02 |
| 4a | Swipe up from the soft key bar | Output and Quick Access over Settings; Output over home | **PASS** closed, Home (stock launcher here: Melaton is not the lane's default home) | 12, log-09, log-03 |
| 4b | Outside tap | Settings and home | **PASS** | log-01, log-03 |
| 4c | Over home, Today back after each close | key, left, right, outside, swipe up then app start | **PASS** | 13, log-03 |
| 4d | Screen off 6 s, on | panel up | **PASS** no panel, no still; "router stopped" | 14, log-03 |
| 4e | Battery icon with the panel up, over Settings | | **PASS** panel gone, battery popup up, nothing left after closing it | 14, log-03 |
| 4f | Battery icon with the panel up, over home | tap 1900,43 | **PASS** for "panel goes, nothing left"; the tap counts as "outside" and **no battery popup opens** (it does over a program) | 13, log-03 |
| 4g | 10 opens in a row, Back right after the tile | script on the guest: Back key x6, soft x2, outside x1, right edge x1; 0 to 0.3 s after the tap returned | **PASS** 10 router starts, 10 stops, 10 draws of output.1, program never moved back, nothing left. Closes came 48-433 ms after the tile press; the draws took 7-47 ms, so **Back before the draw was not reached** | 14, log-04 |
| 5a | Second output, one row per device | virtual A2DP speaker (netsim + Bumble) | **PASS** `output.2`, two rows. The sink is A2DP only: merging several profiles of one device is **not tested** | 15, 16 |
| 5b | Names in their rows | 1 column, 2 columns, wide | **PASS** two lines inside the row in 1 column, one line in the others; "Speakers" whole | 15, 16 |
| 5c | Move to Speakers and back | wide and 1 column | **PASS** mark follows, "move media to" / "done (moved)", media_router's selected route follows, panel stays up. 2 columns: shown, no move | 15, 16, log-09 |
| 5d | Speaker removed with the panel open | kill the sink | **PASS** `output.1`, "Speakers*" marked about 4.5 s later, panel stayed, edge Back closed it. (A first try killed only the wrapper shell, not the sink: no change, not a result) | 19, log-05 |
| 5e | Wide tile's sub-label | one and two outputs | **PASS** "Speakers" / "Lane Test Speaker", as the panel | 05, 17 |
| 6 | Page absent | Settings in front, `kill-app`, 30 s; wide | **PASS** app back for its services (pid 13834), no `sandboxed_process0` renderer, cdp "socket hang up" before, during and after; `output.2`, moved both ways; Back key, soft, left, right all close, program stays. No page was needed | 20, 21, log-05 |
| 7 | Media-session entrance, the real tile | 6.5 home, tap the clock, tap the Super Bar's output button | **PASS** same panel, one draw (`output.1`, 394 ms after the open started), page pushed as for Quick Access, Back key closed it, Super Bar back in place. See "How the session was made" | 22, 23, 24, log-05 |
| 8 | Regression | Quick Access open, page down, page up, rotation tile twice, outside tap | **PASS** `accelerometer_rotation` 1 -> 0 -> 1 (this part ran in the no-push state of 1f) | 25, log-06 |
| - | Sound | `lane.sh sound` at the start, with the fixture, at the end | count 0, alarmLikeStarted 0; media volume 0 after `up`, the reboot and each Bluetooth change or move | - |

## Defects and observations

1. **The panel can come up with no push and no slide, silently** (Quick Access and Output alike).
   - Seen: all shots over a program up to 05:06 were pushed. From 05:18 to 05:24 none was: 12 of 12 opens
     compared pixel by pixel (100x100 around the back arrow) were identical to the program without a panel; a recording
     shows the strip appearing in place. A fresh app process did not help. After `lane.sh reboot` (05:25): 6 of 6 pushed again.
   - Between 05:06 and 05:18 no open over a program was made. In that time the run paired and forgot the Bluetooth
     speaker, started Chrome once, ran the media fixture, restarted the page twice (6.5 and back) and used screenrecord.
     **What put the emulator in that state is not known.** Wide and 2 columns were not tried while it lasted.
   - Likely cause, **read from code, not measured**: `MelatonBars.kt:3306`, `stillWait` waits only 180 ms for
     `takeScreenshot`; then `panelShow` draws with `still == null`, which overlays the program without any movement, the
     late bitmap is recycled and **nothing is logged** (only `onFailure` logs). The captureDisplay -> drawn times in
     log-08 do not prove it (they start after the ask).
2. **Wide Quick Access, Bluetooth tile sub-label** "Lane Test Speaker": with the page alive it runs past the tile to the
   screen's edge; with the layouts used after `kill-app` it is cut mid-word at the tile ("Lane Test Spea"), no ellipsis.
   Not the Output panel; picture 18.
3. Wide Quick Access, smaller: "Performance" is wider than its tile (about 2 px past it at half size), and "Auto" sits on
   the top left of the "5G" glyph in the Network tile (05, left half).
4. Over Melaton home a tap on the battery icon only closes the panel (4f).
5. **Release 36, before the install:** the app crashed on the first cold boot at 04:33:44,
   `ForegroundServiceDidNotStartInTimeException` (`DreamScapeForegroundService`), with the guest's load at 40 and ANRs
   in Calendar, SystemUI, the app and another Google process (log-07). The crash buffer after the reboot on release 38
   was empty.

## How the media session was made, and the layout switch

- No app on the lane could play: Chrome asks for first-run sign-in (not taken further, force-stopped). Used instead:
  `LaneSession.java` here, run by `app_process` as shell. It is a real framework `MediaSession` (state PLAYING, title
  "Lane silent track") that **opens no audio at all**; the app saw it (`getState`: one session, playing), and
  `dumpsys audio` showed no started player. It was compiled with javac + d8 in a temporary folder on Ruiko (build gates
  296, 297), which was removed. About 6 minutes. The `eval openOutputSwitcher` fallback was not needed.
- The 6.5 layout: `localStorage wmVersion=6.5` by `eval`, then the same `forceRestart` that Settings' Yes calls (not by
  taps). Found: no `wmVersion` key, 6.1. Restored by removing the key and restarting; checked on screen.

## State left

- Quick Access disabled; config equal to the one found at this run's start (`quickaccess-config-start.json` /
  `-end.json`; against the before run's original the only difference is `anchor:"top"`, left by that run). Restored with
  `AndroidQuickAccess.setConfig`.
- `MEDIA_ROUTING_CONTROL` default (as found). Title bar corner "close". Melaton 6.1. Rotation auto (1). DND off.
- Bluetooth: speaker forgotten, `Bonded devices: 0`; sink, both ssh tunnels and the local web server stopped. The
  virtual speaker was visible on netsim's shared radio from about 04:59 to 05:07.
- Media volume 0. Fixture files removed from the guest. Release 38 stays installed.
- The page's own "1 update is available for Melaton" box (client files) came up over home; it was answered Later once.
- One extra cold reboot of this instance (05:25) for defect 1.
- The instance was down when this run began; it was brought up by this run and taken down at the end.
