# StaticForge #1392, part C: device proof of release 42 on lane emulator aemu-fold-2

Run Nov 27 2026, 15:49-16:55 local. Instance `aemu-fold-2` (Android 17 / SDK 37, two built-in displays, `-no-audio`).
Release 42 = versionCode **3632928** (build/latest `e2a360b`, includes `fix/1392-windows-off-main` `7bfd4d9e`; APK sha256
`3981b1fd...`). Control: release 40 = 3632839 (without the fix). Times are from ActivityManager's `Start proc`.

## Verdicts

| item | verdict |
|---|---|
| A. screen-off UPDATE start: first MelatonBars line and "holder token linked" within 5 s | **PASS** (one real silent self-update: +1.42 s and +3.74 s, host CPU mean 96 %) |
| B. the same for a kill -9 start with the display off | **PASS** when the display stays off through the start (3 of 3: +1.45..+1.53 s; also the two locked runs `lock-a1` / `a2`: +1.68 / +2.93 s). **Not met in 3 locked runs woken 2-3 s after the start on a saturated host** (+5.49, +8.79, +18.22 s; host mean 95-100 %) |
| C. #1371 `crash` step: the button row's flags never drop in SystemUI's log | **PASS** (`RESULT crash: PASS`, 0 flag changes in the window) |
| main thread never stuck 2 s or more outside its looper | **PASS** in the 6 display-off acceptance runs (never outside it for 2 s). Update, kill-on-2 and the crash start have one 2.2-3.0 s stretch outside it, **busy, not parked** (see below). **FAIL in `lock-over-b3`** (22.9 s parked) and by a small margin in `lock-over-b4` (a 2.1 s parked part). b3's stack is not in a window read; b4 has no stack (no read over 1 s was logged) |
| no "engine did not start" | **PASS** (none in any release 42 run) |
| every "window read took N ms" names a non-main thread | **PASS** (all name `window-bars`; none in the locked runs) |
| "first window look applied after N ms (M windows)" appears | **PASS** (every release 42 run) |
| wake during the first read: bars correct | **PASS** (3 runs; screenshots on the inner screen in 2) |
| lock screen (a): cover built with the display off, first frames after the wake are ours | **PASS** twice (wake 22 s after the new process) |
| lock screen: wake within about 3 s of the new process | **Android's own lock screen shows** (3 of 4 such runs; the fourth, `lock-over-b2`, had the cover up at +3.3 s) |
| lock screen (b): a program over the lock takes the cover away | **PASS** for a running app and one normal restart + wake (about 1.1 s and 1.6 s after the program's first frame). The secure camera could not be tested |

## Runs

"stretch" = longest time the main thread was outside its looper's idle wait (2 s or more shown). "parked" = the longest part
of it with under 30 ms CPU. Host = Ruiko CPU mean / max over the first 12-24 s of the run.

| run | release | display at start | first MelatonBars s | token linked s | longest main block s | verdict |
|---|---|---|---|---|---|---|
| control-r40-kill-off | 40 | off | 0.57 | 14.71 | 33.6 (parked 19.9, in `getWindows`) | stalls like part A (expected) |
| update-r40-to-r42-off (real self-update) | 40 -> 42 | off | 1.42 | 3.74 | 3.0, parked 0 | A PASS |
| r42-kill-off-1 | 42 | off | 0.27 | 1.53 | under 2 | PASS |
| r42-kill-off-2 | 42 | off | 0.31 | 1.51 | under 2 | PASS |
| r42-kill-off-3 | 42 | off | 0.40 | 1.45 | under 2 | PASS |
| r42-reinstall-off-1 | 42 | off | 0.90 | 2.22 | under 2 | PASS |
| r42-reinstall-off-2 | 42 | off | 0.94 | 2.36 | under 2 | PASS |
| r42-reinstall-off-3 | 42 | off | 0.97 | 2.32 | under 2 | PASS |
| r42-kill-on-1 (control) | 42 | on | 0.28 | 2.20 | under 2 | PASS |
| r42-kill-on-2 (control) | 42 | on | 0.32 | 2.19 | 2.8, parked 0 | PASS (busy) |
| r42-crash-step | 42 | on | 0.34 | 2.10 | 2.2, parked 0 | C PASS |
| r42-wake-1 | 42 | off, woken +3.3 | 0.28 | 1.37 | under 2 | PASS |
| r42-wake-2 | 42 | off, woken +3.3 | 0.26 | 1.28 | under 2 | PASS |
| r42-wake-3 | 42 | off, woken +3.4 | 0.28 | 1.35 | under 2 | PASS |
| r42-lock-a1 (host 54/76) | 42 | off, locked, woken +23 | 0.33 | 1.68 | under 2 | PASS |
| r42-lock-a2 (host 85/98) | 42 | off, locked, woken +23 | 0.45 | 2.93 | under 2 | PASS |
| r42-lock-over-b2 (host 84/98) | 42 | off, locked, woken +3.4 | 0.34 | 1.88 | under 2 | PASS |
| r42-lock-early-wake (host 95/100) | 42 | off, locked, woken +2.8 | 0.42 | 5.49 | 4.5, parked 1.1 | **FAIL** (5 s; Android's lock screen) |
| r42-lock-over-b4 (host 99/100) | 42 | off, locked, woken +2.9 | 2.07 | 8.79 | 7.9, parked 2.1 | **FAIL** |
| r42-lock-over-b3 (host 99/100) | 42 | off, locked, woken +2.9 | 1.04 | 18.22 (over local ADB) | 24.6, parked 22.9 | **FAIL** (ANR) |

**The busy stretches** (`schedstat`): update 3.0 s = 0.32 s on CPU + 1.40 s waiting for a CPU, 43 main-thread log lines, longest
silence 0.31 s. kill-on-2 2.8 s = 0.30 + 0.51, 56 lines, 0.36 s. crash 2.2 s = 0.25 + 0.52, 53 lines, 0.27 s. In each the
longest part under 30 ms CPU rounds to 0.0 s, and one of them is a display-on start. The control on release 40 had 19.9 s
parked and 10.65 s of silence.

## Quoted lines

Update (A), `update-r40-to-r42-off/logcat-window.txt`:

```
1795812818.709   847   923 I ActivityManager: Start proc 27603:jp.net.seventhreeseven.dreamscape/u0a235 for bound-service {...}
1795812820.134 27603 27603 I MelatonBars: early hold at process start (#1371)
1795812822.447 27603 27964 I MelatonBars: holder token linked (#1331), started over Shizuku
1795812827.249   847  3289 I PowerManagerService: Waking up from Asleep (uid=1000, reason=WAKE_REASON_WAKE_KEY, ...)
1795812827.685 27603 27899 W WindowReads: window read took 6750 ms (on window-bars)
1795812827.721 27603 27603 I MelatonBars: first window look applied after 6793 ms (0 windows)
```

The same run: `ApkInstall: installed jp.net.seventhreeseven.dreamscape (3632928) via shizuku (stream) (confirmed at app start)`,
`RESULT self-update-screen-off: PASS`, row never empty, 0 packageinstaller activities / notifications. Display state at +4.4 s
(`a11y-4.txt` in the archive): both displays `OFF`, `mWakefulness=Asleep`. The wake at +8.5 s is the step's own "display on".
The SIGQUIT dump taken while it was off has `window-bars` inside `IAccessibilityServiceConnection$Stub$Proxy.getWindows` and
`main` idle in `MessageQueue.nativePollOnce`.

kill -9, display off (B), `r42-kill-off-1`:

```
1795813009.420   847   923 I ActivityManager: Start proc 32461:... for started-service {...}
1795813009.690 32461 32461 I MelatonBars: early hold at process start (#1371)
1795813010.952 32461 32479 I MelatonBars: holder token linked (#1331), started over Shizuku
1795813020.238 32461 32594 W WindowReads: window read took 10004 ms (on window-bars)
1795813020.239 32461 32461 I MelatonBars: first window look applied after 10011 ms (0 windows)
```

C, `r42-crash-step/crash-step.txt`: `PASS  net flags: the net disable flags never dropped the row in the window (0 change(s)
logged, none un-held)` and `RESULT crash: PASS (no failed check)`. The same SystemUI log line did record the one change in the
self-update window (`disable1=0x3f30000 row emptied (held)`).

## Wake during the first read (display unlocked, Android Settings in front)

Wake key 3.25-3.35 s after `Start proc`. The read in flight returned 0.24-0.34 s after the wake ("window read took
2676 / 2792 / 2899 ms (on window-bars)", 2 / 1 / 2 windows). `show: on=true` came **1.39 / 1.37 / 1.23 s** after the wake, the
translucent-bar check at 2.3-2.5 s. In runs 1 and 3 the shot begun 0.75 / 0.88 s after the wake shows Settings with no bars
yet; the shot begun 2.6 / 2.5 s after it shows the Melaton title bar, soft key bar and an empty black strip where Android's
buttons were (`r42-wake-1/wake/a,b,d.png`, `r42-wake-3/wake/a,b,d.png`). Run 2's shots took the cover display (a bug in my
tool, fixed for run 3) and were deleted. The dumpsys "visible" flag of the bar windows was already true before they were
painted, so it is not used as proof.

## Lock screen

Needed on the lane, all undone afterwards: the page set to Windows Mobile 6.5 (`localStorage wmVersion`, this WebView only;
on 6.1 it answered `MelatonLock: page: no-lock`, because `wmLock65.js` needs 6.5), the bars' `lockScreen` setting on, a saved
copy `lock-1968.json`, PIN 1234 (with a guest timer that would have cleared it; cleared by hand and verified).

**(a)** Display off and locked, `kill -9`. The old cover died with the process.

| run | cover window first drawn after Start proc (display off) | after the wake |
|---|---|---|
| lock-a1 | +2.20 s; listed visible above `NotificationShade` in the samples at about +3 s and later | 9 of 9 recorded frames are Melaton's cover (recording began 0.07 s after the wake key) |
| lock-a2 | +4.32 s; visible in the samples at +8, +13, +18 s | 6 of 6 recorded frames are the cover (recording began 0.38 s after the wake key) |

**Early wake** (cover not built yet): in `lock-early-wake` the recording shows two black frames, then **Android's lock
screen** for four frames, then Melaton's cover (`wake/frames.txt`, `frame3-*.png`, `frame7-*.png`). The cover was first drawn
at +8.91 s, **about 6 s after the wake**. The first look had been applied at +4.16 s; why the window came 4.3 s later is **not
established**. **Planner's check of that gap (from the code and the same run's records):** `lockUpdate` makes the lock window as soon as a
saved lock picture is loaded (`c.enabled && c.lockScreen && scene != null`); neither the lock state nor the #1392 rule about
what is over the lock (`OverLock`, which only decides whether the window is *shown*) holds the window back. `update()` ran
to its end at +4.17 and +4.24 s (its `show:` lines), so `lockUpdate` ran then and had no picture yet; from about +5.9 to
+7.8 s main sat idle in `epoll`, waiting. What it waits for is `MelatonLock.restore`, which `barsUp` starts and which reads
and decodes the saved copy on its own thread (`MelatonLock`); that code is not changed by #1392. The cover came at +2.2 s
at a host mean of 54 %, +4.3 s at 85 % and +8.4 s at 95 %. That the decode itself took this long is inferred (this run has no
thread dump). On release 40 the same restart with the display off held main for far longer than that.

`lock-over-b3` and `-b4` show Android's lock screen in their first shot too. `lock-over-b2` (woken at +3.4 s)
already had the cover up. Not compared with release 40, and not measured on an idle host with a 2 s wake.

**Not exercised:** `f7b7ab1a` ("a locked look puts the cover up even with no windows"). In every locked run the first look had
1 window, never 0.

**(b)** The secure camera (`STILL_IMAGE_CAMERA_SECURE`) is **not testable here**: the lane has no camera, and `com.android.camera2`
crashed about 0.8 s after the start (`No back-facing camera found`, `ArrayIndexOutOfBoundsException`). The cover stayed.
Used instead: the Clock's screen saver activity (`com.android.deskclock.ScreensaverActivity`, silent, not exported, started
as root). It occludes the keyguard (`mKeyguardOccluded=true`).

| run | `am start` -> app's `over the lock screen: com.google.android.deskclock` | program's first frame (`wm_activity_launch_time`) -> that line | `dumpsys` saw the cover gone, at latest |
|---|---|---|---|
| lock-over-b1 (running app) | 2.34 s | 1.13 s | 3.0 s after `am start` |
| lock-over-b2 (restart, wake +3.4 s) | 2.98 s | 1.64 s | 3.6 s |
| lock-over-b3 (restart, wake +2.9 s, stall) | 28.2 s | 4.3 s | cover was never up before |
| lock-over-b4 (restart, wake +2.9 s, host 99 %) | program started before the cover existed | - | cover built hidden at +18.46 s (`View.INVISIBLE`) |

The `dumpsys` polling itself loads the guest. In b3, the ANR dialog came up about 22 s after the ANR was raised; the app then logged
`over the lock screen: -` and put its cover back over it.

**"window read took" after the wake:** no such line in any locked run, so no read over 1 s there. `SlowReadLog` writes at most
one line per 30 s per process: in the wake and update runs a second slow read within 30 s of the first line would be hidden.
The bars being drawn 1.2-1.4 s after the wake argues against a 5 s one there.

## The failure with a 22.9 s parked main thread (`lock-over-b3`)

Evidence: `traces/anr-app-main-render-windowbars.txt`, `system-wide-frame-stalls.txt`, `summary.txt`, `logcat-window.txt`.

- ANR `Broadcast of Intent { act=android.intent.action.SCREEN_ON ... dreamscape }`.
- `main`: `RenderProxy::setStopped` <- `HardwareRenderer.setStopped` <- `ViewRootImpl.draw` (waiting for its RenderThread).
- `RenderThread`: `eglCreateWindowSurface` -> `rcCreateWindowSurface_enc` -> `qemu_pipe_read`, which is **waiting for the
  emulator's host GPU**.
- `window-bars` was idle (waiting for work). No "window read took" line. This is not the #1392 `getWindows` call.
- Not only our app: SystemUI `Skipped 1343 frames`, another system process (pid 1795) `Skipped 1248 frames`, the Clock took
  23591 ms to launch. The guest's heartbeat had no gap over 0.72 s.
- Ruiko's CPU: mean 99 %, with another session's DSApp unit-test run (coord build 330, started 16:28:55; the run began 16:29:37).
- The holder was started over local ADB (+18.22 s), not Shizuku. Inferred: the Shizuku command waited for main past its deadline.
- The user-visible result in this run: **Android's lock screen at the wake**, our cover not up
  (`wake/a-androids-lock-screen-during-stall.png`).
- **Inferred, not proven:** a graphics stall of the emulator under host load. `b4`, the same steps on a saturated host, was
  slow but not parked like this. Whether a real phone can do it was not tested.
- `b4` and `lock-early-wake` were run without stack dumps, so for their slow stretches only `ticks.txt` (kernel `wchan`:
  `futex_wait`, `binder_ioctl_write_read`) exists. No Java stack.

## What was done to the instance

- Installs of release 42: **1 real silent self-update** (40 -> 42, Shizuku, display off) and **3 same-APK `pm install -r -g`**
  (each `Success`). No `install-release`, no downgrade. Build 42 was not started by me. Release 43 (another session's build)
  was staged by the server at 16:47 and **not installed**.
- `kill -9` of the app: the runs above, plus 2 to restart the page when switching the WM version and back.
- Sound: `lane.sh sound` over the whole run: `playedCount 0`, `alarmLikeStarted 0`.
- Left: running, display on, unlocked, **no PIN** (`locksettings get-disabled` true, as found), page on 6.1
  (`wmVersion` key removed), `lockScreen` false, saved lock copy deleted, release 42, row held, Shizuku running (pid 19508,
  app allowed), my guest files removed. The logcat buffer stays at 16 MiB until a reboot. The coord lease was **not** released.
- With the page alive, Android's own bars show over Settings (`unsupported: extend-off`, `give=true`); it was so in the
  release 40 baseline before any of my actions. After a process-only restart the Melaton bars are drawn.

## Files, privacy, tools

- Each run folder: `summary.txt`, `run.txt`, `events.txt`, `raw-bulk.tar.gz` (unpack in the folder: ticks, heartbeat, host
  samples, thread lists, `debuggerd`, SIGQUIT dumps, dmesg, logcat window). `logcat-window.txt` is left plain for the
  update, `kill-off-1` and `b3`. Other `.gz` files are the #1371 script's records. `wake.txt` = the guest's wake / lock notes.
- Removed from logs: geofence lines (6 in the #1371 script's unfiltered logcat copies, by `tools/redact-logs.py`), lines
  that could carry coordinates, notification text, names or network names. All archives were searched afterwards: 0 hits.
- Screenshots kept show Android Settings, the launcher, Android's lock screen with its own "Set a screen lock" notice, the
  Clock, or the bars. Shots of Melaton's cover are **redacted** (`tools/redact-lock.sh`: Today picture made a mosaic, unread
  count blacked out). The raw shots and recordings are not in the repo.
- `.gitignore` leaves out the `tools/` folder (line 71, part A's tools too) and the #1371 script's three `log.txt` files
  (line 26): `git add -f` them if they are to be kept.
- Tools (`../tools/`): changed `run-one.sh` (`LANE_ID`, `OUT_BASE`, `kill-wake`, `WAKE_SCRIPT`), `replay-1371-crash.sh`,
  `analyze-run.py` (wider redaction, CPU / run-queue per stretch, window lines); new `self-update-watched.sh`, `wake-guest.sh`,
  `lock-guest.sh`, `lock-over-guest.sh`, `redact-lock.sh`, `redact-logs.py`. The SIGQUIT dumps came at +4/+12 s (update),
  +6/+12 s (kill and reinstall runs), +12/+22 s (crash), +9/+14 s (wake), +6/+14 s (`lock-a1`), and not at all in the other
  locked runs. The release 40 control used the tool's default (+3/+6/+9/+14/+22 s).
