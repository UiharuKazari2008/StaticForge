# #1327 / #1395 Output panel: device run BEFORE the fix

Instance `aemu-fold-1` (`emulator-5556`, Android 17, `-no-audio`), release 36 (versionCode 3632141), Nov 27 2026
03:10-04:02 EST (log times are the guest clock). **Every picture and tap is the inner display (display 0, 1968x2184).**
The cover display, the Quick Access 2-column strip, DeX, the Fold and the A53 were not used. Melaton Bars were on
(accessibility service bound).

Pictures: full screens are saved at half size (984x1092). Tap coordinates below are full size. Pictures taken over
Melaton's own home (01, 02, 11, 12) are cut to the panel's side or top, because the rest is the account's Today screen.

## Results

| case | steps | result | evidence |
| --- | --- | --- | --- |
| Enable Quick Access | real taps in Settings > Buttons > Quick Access | Was `enabled:false`. "Audio output" is NOT in the default control list; it had to be ticked | 00, quickaccess-config-before.json |
| First try, page not up to date | strip tile over home | **No panel.** Quick Access closed; log: `open: router started`, `asking the app's shell once`, `router stopped`, no `bubble`. The page had no `wmOutputPanel` and `roles()` had no `output.N`; a client update was pending. After an app restart it applied and `output.0`..`output.8` existed | log-00-stale-page-tile-no-panel.txt |
| 1 strip, over home | edge swipe, page arrow, Output tile | `output.1`, 14 ms after the tap, no `output.0`. Inside the screen, between the bars, "Speakers" readable. **Visual defect:** the title "Audio output" is drawn over Today's clock and the row over the temperature. Quick Access pushes Today aside; the Output panel does not (Today comes back under a see-through panel) | 01, 02, log-01 |
| 1 strip, over Settings | same, over Network & internet | `output.1`, 17 ms, no `output.0`. In bounds, nothing clipped with the one short name. The panel is see-through grey: the program's rows and switch show through it (Quick Access is opaque) | 03, 04, log-02 |
| 1 wide, over home | layout "Wide panel", edge swipe, Audio output row | `output.1`, 115 ms, no `output.0`. In bounds. **Same defect:** "3:35" and "57 / 44" show through the title area and the Speakers row. A test notice box from another agent's run was up too; the panel dimmed its right part | 11, 12, log-10 |
| 1 wide, over Settings | same | `output.1`, about 100 ms, no `output.0`. In bounds, readable. Program shows through | 13, 14, log-11 |
| output.0 flash | `appops set ... MEDIA_ROUTING_CONTROL default`, then open (wide) | **Yes, only on the first open without the app op:** `output.0` drawn 03:36:32.965, `output.1` 33.674, about 0.71 s. Every open with the op allowed drew `output.1` or `output.2` directly. Not photographed (log only). While not allowed, `getInstance` logs a SecurityException stack (102 `W MediaOutputRouting` lines); opening Quick Access alone logs it too | log-12 |
| 2a Output, `input keyevent 4` | over Network & internet, strip | **Panel stays.** The program under it goes back | 05, log-03a |
| 2a Quick Access, same key (control) | same | **Quick Access stays too**, program goes back. With a key through InputReader (2b) it closes. So injected keys do not behave as reaching the app's key filter (inferred: the app logs no key events) | 06, log-03b |
| 2b Output, evdev KEY_BACK | strip, and again wide | **Panel stays**, program goes back. `BACK(4) scanCode=158` is in InputDispatcher's queue, so the app did not take it | 08, 15, log-04a, log-11 |
| 2b Quick Access, evdev KEY_BACK | strip | **Closes**, program stays. No BACK in InputDispatcher's queue (taken) | 07, log-04b |
| 2c Output, soft bar "Back" (441,2120) | strip | **Closes**, program stays. It is handled as a press outside: `popup tap 441,2120: outside: closed`, `router stopped` | log-05a |
| 2c Quick Access, soft bar "Back" | strip | **Closes**, program stays, `outside: closed` | log-05b |
| 2d control, no popup | left, then right edge swipe | Program goes back, `edge swipe: Back` logged | log-00-controls-no-popup.txt |
| 2d Output, left and right edge swipe | strip | **Panel stays**, program stays, no `edge swipe: Back`, no `popup tap` line | 26, 25 (1st picture: after the right swipe), log-06a, log-07a |
| 2d Quick Access, left and right edge swipe | strip | **Stays**, program stays, no log line | 25 (2nd and 3rd), log-06b, log-07b |
| 2e Android's nav button or gesture | dumpsys | **None usable.** `navigation_mode=0` (3-button), the Taskbar nav window is there with an empty touchable region and Android's buttons are not drawn; the bottom of the screen is Melaton's soft bar | log-08 |
| Battery popup, evdev KEY_BACK | status icon (1843,43) | **Stays**, program goes back. Only (b) was run for this popup | 09, log-09a |
| Volume popup, evdev KEY_BACK | status icon (1771,43) | **Stays**, program goes back. Only (b) was run | 10, 25 (4th), log-09b |
| 3 `kill-page` | `lane.sh kill-page`, wait 12 s | **Does not give a page-less state:** the app lives (same pid) and made a new renderer and page within 12 s (`HomeRole: renderer gone: killed`; `cdp` lists a page again). The panel was not opened in this state | log-13 |
| 3 page absent after `kill-app` | `kill-app` with Settings in front, wait 25 s, edge swipe (wide), Audio output row | **Works.** App process back for its services (pid 4058), no `sandboxed_process0` renderer (only `js_sandboxed_process0`), `cdp` "socket hang up" before and after. A MainActivity record was in the task history. `output.1`, 21 ms, lists Speakers; pid unchanged | 17, 18, log-14 |
| 4 media-session entrance | `eval AndroidMediaSession.openOutputSwitcher("")` | **Page bridge only; the media tile was NOT pressed.** Same panel: `bubble output.1 drawn here` over Settings. No media session existed (`have 0 sessions`) and none was made: no app handles an audio VIEW intent; playing in Chrome or YouTube was not tried. The tile is in the 6.5 (Titanium) home, and `window.wmTitanium` was not loaded on this instance; its layout was not changed | log-15 |
| 5 second output | virtual A2DP sink (below) | **Made.** `dumpsys media_router` lists `Phone` and `Lane Test Speaker`. `output.2`: "Lane Test Speaker" (marked), "Speakers"; one row each | 19, log-16 |
| 5 move to Speakers and back (wide) | tap row 2 (1600,365), then row 1 (1600,220) | **Works.** `move media to ...`, mark moves at once, `move to ... done (moved)` 75 ms and 100 ms later; media_router's selected route follows both times; rows keep their places. No `moved to` line (MediaOutputRouting.onTransfer) was logged for either | 20, 21, log-17, log-18 |
| 5 panel after a move | same | **The panel stays open after the move is done** (still up seconds later, both times). docs/melaton-bars-output-panel.md says a row press closes it once the move is done or has failed | 21, log-17, log-18 |
| 5 strip with a long name | strip, 1 column, two outputs | **Broken:** "Lane Test Speaker" is not fitted to the strip: cut by the screen's right edge ("...Spea") and spilling left past the panel over the program | 23, 23b, log-19 |
| 5 output removed while open | sink process killed, strip panel up | **Works:** about 4 s later `rows: Speakers*`, `output.1` drawn, panel stays | 24, log-20 |
| 5 one row per device with several profiles | - | **Not tested:** the sink offers A2DP only, so there was one route to begin with | - |

Also seen: the wide Quick Access row says "Audio output / Phone" while the panel calls the same output "Speakers".

## Second output: what was tried

Attempts 1 and 2 (full output in log-21-second-output-attempts.txt):

1. Console `event send EV_SW:SW_HEADPHONE_INSERT:1`: no change in media_router. `cmd audio help` gave no output through
   this path and `cmd media_router help` says "No shell command implementation."
2. Virtual input device through `/system/bin/uinput` with SW_HEADPHONE_INSERT: InputReader and WiredAccessoryManager
   took it, audio policy refused (`could not find HW module for device type AUDIO_DEVICE_OUT_WIRED_HEADPHONE`). The
   emulator's audio policy has no wired, USB or HDMI output types. Removed again.
3. **Worked:** a virtual Bluetooth A2DP speaker on the emulator's radio (netsim), Google Bumble 0.0.236,
   `bt-sink.py` here. It receives and drops audio and runs on the dreamscape host, so nothing can reach Ruiko's
   speakers. netsimd is shared by Ruiko's emulators, so other running instances could have seen it in a scan while it
   was up (about 6 minutes).

Repeat:
1. `python3 -m venv V; V/bin/pip install bumble grpcio protobuf`.
2. netsim's port: `grpc.port` in `%LOCALAPPDATA%\Temp\netsim.ini` on Ruiko (63257 in this run; it can change).
3. `ssh -N -L PORT:127.0.0.1:PORT ruiko &`, then `V/bin/python -I bt-sink.py android-netsim:localhost:PORT 900`
   (900 = seconds it stays up).
4. On the instance: `lane.sh aemu-fold-1 sh 'am start -a android.settings.BLUETOOTH_SETTINGS'`, tap "Pair new device",
   "Lane Test Speaker", "Pair" (1553,1197).
5. Set media volume 0 again (the Bluetooth device has its own index: it read 7 after the moves; set to 0 at once).
6. Undo: gear beside the saved device > Forget > Forget this device; kill the sink and the tunnel. Done in this run:
   `Bonded devices: 0`.

## Steps for the after-fix run

`L="scripts/aemu-lane/lane.sh --agent <id> aemu-fold-1"`. After any `up`: `$L sh 'cmd audio set-volume 3 0'` (`up`
sets media to 2).

**First check the page is current:** `$L eval 'wmQuickAccess.roles().join(" ")'` must list `output.0` .. `output.8`. If
not, restart the app (`kill-app`, `start-app`, wait about 2 minutes) and check again.

**Enable Quick Access** (from Melaton's home, `$L start-app`; wait about 3 s after each tap):
1. `tap 100 44` (Start), `tap 157 949` (Settings), `tap 421 180` (Buttons), `tap 407 2060` (tab Quick Access).
2. `tap 38 226` (Swipe from the screen's edge for Quick Access).
3. In Controls: `sh 'input swipe 900 1600 900 1050 600'` twice, then `tap 51 1396` (tick Audio output). Look at a
   screenshot first: the scroll position decides what is under that point.
4. `tap 1917 45` (ok), and `tap 1917 45` again to leave Settings.

**Layout:** same page, "Show as" `tap 1000 963`, then 1 column `tap 546 1029`, 2 columns `tap 546 1084`, Wide panel
`tap 453 1141`; ok, ok. `AndroidQuickAccess.setConfig` alone changed the setting but the panel stayed wide.

**Over another program:** `$L other`, wait 4 s, `tap 336 582` (Network & internet), wait 4 s. Check
`topResumedActivity` is `.SubSettings` (the first tap can come too early). `am force-stop com.android.settings` first
for a clean start.

**Open:** `sh 'input swipe 1962 840 1650 840 250'` (end x 1500 for wide), wait 4 s.
- strip, over a program: `tap 1892 1855` (page arrow), then `tap 1892 1778` (Output tile).
- strip, over home: `tap 1892 1892`, then `tap 1892 1815`.
- wide: over home `tap 1670 704`; over a program `tap 1670 690`.
Close: a tap outside, e.g. `tap 300 600` (wide) or `tap 900 1100` (strip).

**Back kinds:**
- (a) `$L key 4`
- (b) the emulator console's `event send EV_KEY:KEY_BACK:1 ...` (lib/con.py 5556) answered OK on this headless
  instance but no key event showed up in InputDispatcher, and Quick Access did not close. `event send KEY_C` did not
  show up either; only `event text` did. Used instead, a real evdev path through InputReader on the emulator's keyboard
  (`qwerty2.kl`: 158 = BACK):
  `$L su 'sendevent /dev/input/event13 1 158 1; sendevent /dev/input/event13 0 0 0; sleep 0.08; sendevent /dev/input/event13 1 158 0; sendevent /dev/input/event13 0 0 0'`
  (check the node with `getevent -pl`; check delivery in `dumpsys input` > RecentQueue: a key the app takes is absent)
- (c) `tap 441 2120`
- (d) `sh 'input swipe 3 1100 500 1100 200'` and `sh 'input swipe 1964 1500 1450 1500 200'`
- battery `tap 1843 43`, volume `tap 1771 43`

**Page absent:** with another program in front `$L kill-app`, wait 25 s, check `cdp` fails and there is no
`sandboxed_process0` (not `js_sandboxed_process0`), then open as above.

**Logs:** `logcat -d -v threadtime -T '<guest time>' -s MelatonBars OutputPanel MediaOutputRouting QuickAccess`.

## State left on the instance, and incidents

- Running, Melaton home in front, Melaton Bars on, app still release 36, Shizuku running, media volume 0.
- **Quick Access restored to disabled** with the old control list and strip layout, through
  `AndroidQuickAccess.setConfig` (not by taps). The one difference from before: the key `anchor:"top"` now exists
  (quickaccess-config-after.json). The after-fix run must enable it and tick Audio output again.
- `MEDIA_ROUTING_CONTROL` reset to `default`, as first read (the app had set `allow`).
- **Release 37 (3632181) is staged on the instance**, waiting to install (`update state`, 03:59). It can install itself
  at a later app restart: check `appVersionCode` before the after-fix run.
- The app was restarted by this run (`kill-app`), and applied the pending client update then.
- Around 03:38 the emulator stopped answering: `adb shell` and the console timed out, qemu's CPU time did not move in
  15 s, and its log had "detected a hanging thread 'QEMU2 main loop'" and the CPU threads. Cause not found. `lane.sh
  down` and `up` (booted in 28 s, data kept). Shizuku was down right after that boot; it was running again later
  without a command from this run.
- Run mistake, undone: a script went on after a failed setup and its taps toggled Do not disturb on (03:25:02) and
  opened Wallpaper & style. DND was toggled off at 03:26:01 (`zen_mode` 0); the wallpaper app was force-stopped. The
  affected Back cases were run again with checked setup; the saved logs 05b-07b are from the checked runs.
- Test notices from another agent's runs ("Bars heal 1340", naming the A53 and aemu-fold-2) appeared on this instance,
  and so did the app's "Melaton 1.0.3632181 is ready to install" box (answered Later).
- `lane.sh sound` at the end: count 0, alarmLikeStarted 0.
