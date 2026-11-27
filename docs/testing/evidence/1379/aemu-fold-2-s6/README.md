# #1379 item 1 / review finding S6: a failed first local-ADB attempt with no Shizuku (Nov 27 2026, 15:10-15:43)

**This is an emulator result, not a Galaxy A53 result.** The real A53 was offline (flat battery). Instance
`aemu-fold-2`: Fold-shaped, Android 17 (API 37, userdebug), `-no-audio`. Agent `claude-e45cc6db`. No real phone
was touched.

Builds: release 40 (3632839, `4d04d75`, contains `899d9b5` and `f0fe4c1`) and the control, release 39
(3632745, `19c7c07`, contains neither). Installs went under build gates 319 (to 39) and 321 (back to 40).

Times in TEST A count from ActivityManager's `Start proc` line of the new app process. Times in TEST B say what
they count from.

## Results

| point | result | numbers |
| --- | --- | --- |
| A, 40 run 1: first holder start fails for a non-auth reason, with the trail | PASS | +1.56 s `#1 in a row [shizuku: not usable; adb: The phone's ADB connection dropped: Connection reset]` |
| A, 40 run 1: a later retry works over local ADB and the row is held | PASS | `holder token linked (#1331), started over local ADB` **+13.18 s** (sampler +13.37 s); held in all 378 later samples, to +126.9 s |
| A, 40 run 1: gesture fallback | not triggered | 1 failed hold before the swap; forwarder up +5.62 s |
| A, 40 run 2: same two points | PASS | failed holds #1 +2.51, #2 +3.59, #3 +5.13 s; linked **+10.43 s** (sampler +10.59 s); held in all 329 later samples, to +127.2 s |
| A, 40 run 2: gesture fallback | tried, did **not** switch | the 3rd failure came before the forwarder (up +5.56 s); +5.16 s `gesture fallback: no shell route to read the overlay list`; `navFallback` unset, 3-button overlay kept |
| A, control 39: the bug shows (same script, same timing) | **PASS (bug reproduced)** | forwarder up +5.49 s; **no holder and row not held in all 346 samples** from the kill to +127.1 s; 12 failed holds, then +130.6 s `10 holds in a row failed, no more until the next event`; still open at +149 s |
| A, control 39: no later try uses ADB | PASS for the whole retry chain | the app's last ADB bytes: +3.87 s (before the swap). After it, only connects with no data (`listening()` checks). Outside ADB handshakes through the forwarder worked at +5.6, +30, +60, +90, +125 s |
| A, control 39: "for the whole process" | **not true as worded** | see "The block in 39 can be lifted" below |
| B, reboot run 1, release 40, no Shizuku | PASS | row held **15.5 s after `boot_completed`**, 13.9 s after user unlock, 11.9 s after app `Start proc`; 0 of 411 samples with `shizuku_server` |
| B, reboot run 2 | PASS | **23.1 s after `boot_completed`**, 20.3 s after user unlock, 17.8 s after app `Start proc`; 0 of 446 samples with `shizuku_server` |
| B: a failed first ADB attempt after a reboot | **NOT SHOWN** | in each reboot the first ADB command logged (`ApkInstall` sweep) succeeded; no failed hold. TEST B does not exercise S6 |
| 5555 coming back after a reboot on a phone | NOT SHOWN | the emulator's adbd always listens on 5555 |
| Galaxy A53 | NOT SHOWN | offline |

## How TEST A was built

- App settings: `port` 5599, `shizukuAutoStart` false, `shizukuRecover` false, `allow` true, features unchanged
  (`install` true). Also `autoRestore` **false**: with the app on 5599 a restore could send `tcpip:5599` to the
  real adbd and take the lane's adb link away. Shizuku stopped; no sample in any TEST A run shows `shizuku_server`.
- The key was trusted before: `authorized_once=true`, and the app's Advanced Tools test through the forwarder
  answered `{"ok":true,...,"port":5599,"ms":82}` before the first run.
- "Not ready": `toybox nc -s 127.0.0.1 -L -p 5599 true` (accepts, closes at once). The app saw `Connection reset`.
  Forwarder: `toybox nc -s 127.0.0.1 -L -p 5599 toybox nc 127.0.0.1 5555`. Other signs of a settling adbd
  (refused, broken pipe, EOF, closed stream) were not simulated.
- "Outside the app": a raw ADB `CNXN` packet sent from a root shell. Reject mode: 0 bytes. Forward mode:
  439 bytes, `CNXN ... device::ro.product.name=...`.
- `run` in `guest-s6.sh` kills the app **and the old holder in one `kill -9`** (not `lane.sh kill-app`), so the row
  is open when the new process starts. With the old holder left alive, "held" would have been true from the start.
- The launcher was in front: Android restarted the app for its services only; no page call or tap in a run.
- Swap rule: at least one failed hold logged **and** 5000 ms since `Start proc`. In run 2 and the control three
  failures were already in by then (the 3rd about 0.4 s before the forwarder was up), so "restore before the third
  failure" was met only in run 1. #2 came 1.08 s after #1 in run 2 (0.93 s in the control), sooner than the 1.5 s
  retry step; the log does not name what started it.
- Records: guest sampler of `dumpsys statusbar` (median 295-362 ms, longest spacing 704 / 647 / 811 ms),
  SystemUI disable lines, `tcpdump` of loopback port 5599.

Run 2 and the control match up to the swap (3 failed holds, one fallback try, forwarder at +5.56 / +5.49 s). At the
next retry (about +10 s) release 40 used ADB and held the row; release 39 logged `#4` and sent no ADB byte. In both
40 runs the app's first ADB bytes answered after the swap were the holder start itself (+12.74 / +10.17 s in the
capture), so no other caller helped it. (The earlier data connection after each swap is the outside probe.)

In run 1 the 11 s between the failure and the retry's success was a stall of the app's main thread on this
emulator (`Davey! duration=10943ms`; a binder call to the compositor `took 10503ms`).

## The S6 bug in the log

In every TEST A process the **first** ADB command was not the holder but `ApkInstall`'s leftover sweep
(+0.4 s / +0.6 s / +0.9 s). Same failure, two readings:

- 40: `ApkInstall: ... The phone's ADB connection dropped: Connection reset`
- 39: `ApkInstall: ... Allow USB debugging for Dreamscape on this phone (Always allow).` (a reset taken as
  "unauthorized"). From then on the 39 holder never sent ADB. The app's `adbStatus().authorized` was not read in
  the control, to keep page calls out of it.

## The block in 39 can be lifted

After the control's retry chain had ended, a screen off/on (extra step, `rel39-control1-event-*`) ran hold `#13`,
still without ADB (+169 s). About 1 s later another caller succeeded over local ADB
(`ApkInstall: swept leftover install copies ... via local adb`, +170 s), and the next holder start linked
(+171.6 s): the row was held. So in 39 the holder stays off ADB until some other caller, which does not look at the
flag, gets a command through. In this run that took an outside event. The same step also shows that this very
process could use the forwarder.

## TEST B

- App port 5555, `autoRestore` true (as found), `shizukuAutoStart` and `shizukuRecover` false. 5599 listener gone.
  `lane.sh reboot` (clean shutdown, cold boot). Nothing launched or tapped; the app's activity was never started
  (0 matching activity starts in logcat). Android started the process itself, for `MelatonBarService` (run 1) or
  the notification listener (run 2), 3.6 s / 5.3 s after `boot_completed`.
- `testB-run0` is **not scored**. Shizuku's **own** `BootCompleteReceiver` started `shizuku_server` after that boot
  (first sample with it: +24.4 s). The app did not start it, and the row had been held over local ADB at +15.4 s,
  before Shizuku appeared (`testB-run0-shizuku-bootstart.txt`). For runs 1 and 2 only that receiver was disabled:
  Shizuku stayed installed, nothing started it.
- Until the row was held, Android's buttons were not blanked (3-button overlay, no holder).
- The early hold ran 10.0 s / 15.7 s after `Start proc`, not at 2.5 s. Holder: `started over local ADB`,
  `[shizuku: not usable; adb: ok]`. No gesture fallback, Melaton Bars bound.
- Sampler started before `boot_completed` (about 11 s of uptime); median 383 / 391 ms, longest spacing 2928 ms
  (run 1) and 1226 ms (run 2). `boot_completed` = the `boot_progress_start` event's time, minus its uptime value,
  plus the dmesg time of `processing action (sys.boot_completed=1)`.

## Other notes

- No `FATAL EXCEPTION` or `Fatal signal` line in the raw logs of the two scored reboots. (Raw logs are not in this
  folder.)
- Sound: `lane.sh sound`, which only reaches back to the last reboot: `playedCount 0`, `alarmLikeStarted 0`. No
  `NoteAlerts` line in any run excerpt.
- Release 41 (3632911) was published at 15:35:18, during TEST B run 2, and was **not tested**. The server tried it
  on this instance 3 times (`NOT_PERMITTED: The device is not connected to a computer`) and gave up. 40 was not
  replaced (`lastUpdateTime` 15:23:12, my reinstall).

## State left

Release 40. App ADB settings as found (port 5555, all four switches on, preferred adb, features unchanged).
Shizuku running (pid 19508, started with `lane.sh shizuku start`), the app allowed. Melaton Bars bound, soft keys,
3-button room, row held by a holder over Shizuku (pid 19890), checked after 60 s and a screen off/on. Dreamscape in
front. Wireless debugging setting 1. Shizuku's boot receiver back to its default state. `persist.logd.size` empty
again. Listener, forwarder, sampler, `tcpdump` and guest helper files gone; no iptables rule was added.

Not as found: the guest was rebooted 3 times; the logcat buffer is no longer the 16 MiB it had when found; the
server's delivery record for this instance now reads 3632911 `failed`, `gaveUp` (it was 3632839 `installed`).
The instance is running and the lease was not released.

## Files

`log.txt` (commands and answers in order; the extra control step and restore included). Per TEST A run:
`-swap.txt` (guest timing log and outside probes), `-sample.txt`, `-tcp5599.txt`, `-logcat.txt`, `-analysis.txt`.
Per TEST B run: `-sample.txt`, `-logcat.txt`, `-bootevents.txt`, `-analysis.txt`. Excerpts hold app tags,
SystemUI disable-flag lines and ActivityManager's start lines for the app. Harness: `guest-s6.sh`,
`run-testA.sh`, `run-testB.sh`, `env.sh`, `excerpt.py` (the TEST A excerpts were cut before its filter for
low-level `AndroidRuntime` lines was added), `analyze-s6.py`, `analyze-boot.py`. `run-testA.sh` reads `env.sh` and
`excerpt.py` from the session's scratch folder.
