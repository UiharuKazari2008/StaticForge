# StaticForge #1392, part A: what blocks the app's main thread on a new process

Run Nov 27 2026, about 13:54-14:30 local, on lane emulator `aemu-fold-1` (Android 17 / SDK 37, 2 built-in displays), installed
release 39 (versionCode 3632745, `base.apk` sha256 `12b94ed9...2797b` = the server's release 39).

## Verdict

- **Reproduced and named.** The main thread sits in a **synchronous binder call, `AccessibilityService.getWindows()`**, made by
  `MelatonBarService.scanWindows()` (`windows`, MelatonBars.kt:2460 in build 19c7c07613). It is called from
  `onServiceConnected -> barsUp()` (:1984) and again from the posted `scanSoon` runnable (:2285).
- On the other end, `system_server` holds the call in `AbstractAccessibilityServiceConnection.ensureWindowsAvailableTimedLocked`
  (a timed `Object.wait`). This image's bytecode waits **up to 5000 ms for each display that has no window list**.
- **Trigger: a new accessibility-service connection while the displays are off.** The accessibility manager then has no window list
  for display 0 or display 2, so one call costs 2 x 5 s = about 10 s. Two or three calls follow each other: 20-31 s.
- **App, not the guest as a whole, not Ruiko.** The app makes a call that can take 10 s on its main thread; Android's service
  behaves as its code says. The guest's heartbeat never stopped.
- **Display off at the new process: 5 of 5 starts stalled. Display on: no `getWindows` stall in 7 starts** (nor in 2 replays of the old crash step).
- **Not reproduced: the older #1371 KILL case** (display on, every guest sampler silent for 26.85 s). It is a different signature
  and `getWindows` does not explain it (below).

## Runs

Offsets are from ActivityManager's "Start proc". "Outside its looper" comes from `ticks.txt` (every ~0.6 s): the main thread was
not in its idle `epoll` wait in any sample of the stretch. In the stalled runs it handled queued messages only briefly between calls.
`kill-*` = `kill -9` of the main pid. `reinstall-*` = `pm install -r -g` of the same installed release 39 APK.
`replay-crash-*` = the exact #1371 `crash` step with the watcher beside it.

| run | display | first MelatonBars | token linked | main thread outside its looper for 2 s or more | longest main-thread log silence up to the link | longest hb.txt gap (wall / uptime) | getWindows seen in system_server | host: qemu cores mean (max), host CPU % mean (max), longest sample step |
|---|---|---|---|---|---|---|---|---|
| kill-1 | on | +0.34 s | +1.87 s | never | 0.34 s from +1.10 | 0.17 / 0.17 s | - | 1.2 (3.9), 21 (47), 1.1 s |
| kill-2 | on | +0.25 s | +1.32 s | never | 0.14 s from +0.45 | 0.16 / 0.14 s | - | 1.4 (3.8), 22 (52), 1.1 s |
| kill-3 | on | +0.28 s | +1.49 s | never | 0.32 s from +0.51 | 0.20 / 0.21 s | - | 1.3 (3.4), 22 (50), 1.3 s |
| kill-4 | on | +0.26 s | +1.43 s | never | 0.27 s from +0.63 | 0.20 / 0.20 s | - | 1.2 (4.0), 20 (41), 1.1 s |
| kill-5 | on | +0.27 s | +1.36 s | never | 0.17 s from +0.42 | 0.21 / 0.23 s | - | 1.2 (3.9), 20 (63), 1.4 s |
| kill-off-1 | OFF | +0.43 s | +12.00 s | +0.5..+31.4 s (30.9 s) | 5.77 s from +0.99 | 0.31 / 0.15 s | 4 of 6 dumps | 1.5 (2.7), 81 (100), 1.3 s |
| kill-off-2 | OFF | +0.29 s | +11.48 s | +0.4..+11.1 s (10.7 s); +12.3..+21.4 s (9.1 s) | 5.12 s from +0.77 | 0.17 / 0.17 s | 4 of 6 dumps | 1.3 (2.7), 39 (79), 1.2 s |
| reinstall-off-1 | OFF | +0.73 s | +11.71 s | +0.3..+31.3 s (31.0 s) | 6.77 s from +0.95 | 0.21 / 0.21 s | - | 1.1 (3.9), 18 (38), 1.1 s |
| reinstall-off-2 | OFF | +0.81 s | +11.74 s | +0.6..+31.7 s (31.1 s) | 4.58 s from +4.75 | 0.17 / 0.17 s | 5 of 6 dumps | 1.2 (3.8), 22 (52), 1.1 s |
| reinstall-off-3 | OFF | +0.78 s | +11.66 s | +0.4..+31.6 s (31.2 s) | 6.46 s from +4.57 | 0.21 / 0.20 s | 5 of 6 dumps | 1.3 (3.9), 23 (61), 1.2 s |
| reinstall-on-1 | on | +0.86 s | +2.13 s | never | 0.24 s from +0.04 | 0.18 / 0.18 s | 0 of 5 dumps | 1.6 (4.1), 25 (60), 1.1 s |
| reinstall-on-2 | on | +0.78 s | +2.24 s | never | 0.20 s from +0.06 | 0.21 / 0.21 s | - | 1.6 (4.4), 29 (65), 1.7 s |
| replay-crash-1 | on | +0.85 s | +5.58 s | +0.7..+12.7 s (12.0 s) | 1.09 s from +1.79 | 0.97 / 0.61 s | 0 of 5 dumps | 2.3 (3.9), 97 (100), 5.2 s |
| replay-crash-2 | on | +1.53 s | +3.53 s | +0.3..+3.7 s (3.3 s) | 0.44 s from +0.71 | 0.24 / 0.24 s | 0 of 2 dumps | 2.3 (4.4), 70 (98), 1.2 s |

(`-` in the getWindows column: `system_server` was not dumped in that run. The watcher gained that dump after `reinstall-off-1`.)

Same process, no restart (`screenoff-running-1`): display switched off under a running app. The accessibility manager **kept** both
window lists (`a11y-28.txt`: `Display[0]`, `Display[2]` with the displays `OFF`) and the main thread was never outside its looper
for 2 s. Only a **new** service connection starts with no list.

Stacks per dump (`stack-table.txt`):

| run (display off) | app dumps inside `getWindows` | `system_server` dumps inside the timed wait |
|---|---|---|
| kill-off-1 | 4 of 6 | 4 of 6 |
| kill-off-2 | 2 of 6 | 4 of 6 (app and server are dumped a few seconds apart) |
| reinstall-off-1 | 5 of 6 | not dumped |
| reinstall-off-2 | 5 of 6 | 5 of 6 |
| reinstall-off-3 | 5 of 6 | 5 of 6 |

No `system_server` dump of a display-on run has a thread in `getWindows`, and no app dump of a display-on run has the main thread in it.

## The blocking call (stacks taken during the stall)

Full file: `stacks-retraced.txt`. From `kill-off-1/traces/trace_16` (14:15:18, pid 21599):

```
"main" prio=5 tid=1 Native
  native: #00 libc.so (__ioctl+7)
  native: #02 libbinder.so (android::IPCThreadState::transact+1808)
  at android.os.BinderProxy.transactNative(Native method)
  at android.os.BinderProxy.transact(BinderProxy.java:626)
  at android.accessibilityservice.IAccessibilityServiceConnection$Stub$Proxy.getWindows(IAccessibilityServiceConnection.java:1379)
  at android.view.accessibility.AccessibilityInteractionClient.getWindowsOnAllDisplays(AccessibilityInteractionClient.java:521)
  at android.view.accessibility.AccessibilityInteractionClient.getWindowsOnDisplay(AccessibilityInteractionClient.java:480)
  at android.view.accessibility.AccessibilityInteractionClient.getWindows(AccessibilityInteractionClient.java:469)
  at android.accessibilityservice.AccessibilityService.getWindows(AccessibilityService.java:1074)
  at ...MelatonBarService.D0(unavailable:2)      => MelatonBarService.scanWindows:2460
  at ...MelatonBarService.i(unavailable:1096)    => MelatonBarService.barsUp:1984
  at ...MelatonBarService.onServiceConnected(unavailable:44)
  at android.accessibilityservice.AccessibilityService.dispatchServiceConnected(AccessibilityService.java:914)
```

The later calls (`trace_18`): `scanWindows:2460 <- wd1.run => MelatonBarService.scanSoon$lambda$69:2287`. `debuggerd -b` taken in the
same stall shows the same path (`kill-off-1/debuggerd-3.txt`, thread `even.dreamscape` sysTid=21599).

`system_server`, same run (`kill-off-1/traces/trace_21.system_server-extract.txt`):

```
"binder:677_1F" prio=5 tid=251 TimedWaiting
  at java.lang.Object.wait(Native method)
  - waiting on <0x0fb81a06> (a java.lang.Object)
  at com.android.server.accessibility.AbstractAccessibilityServiceConnection.ensureWindowsAvailableTimedLocked(AbstractAccessibilityServiceConnection.java:2284)
  at com.android.server.accessibility.AbstractAccessibilityServiceConnection.getWindows(AbstractAccessibilityServiceConnection.java:618)
  - locked <0x0fb81a06> (a java.lang.Object)
  at android.accessibilityservice.IAccessibilityServiceConnection$Stub.onTransact(IAccessibilityServiceConnection.java:668)
```

**Who holds what is waited for:** no thread holds anything the call needs. The lock shown is the call's own monitor, released by
`wait`. It waits for a window list that does not come while the displays are off, and gives up on a timer.
`system_server-getWindows-dexdump.txt` (this image's `services.jar`): `getWindows` takes `mLock`, loops over
`getDisplayListLocked()`, and for each display `ensureWindowsAvailableTimedLocked` returns at once if there is a list, else
`mLock.wait` until `const-wide/16 v4, #int 5000` ms have passed.

Deobfuscation: the mapping is on Ruiko only (`C:/Users/ykaza/claude-build/dsapp-latest/app/build/outputs/mapping/release/mapping.txt`);
the server's builds store keeps APKs and no mapping. Its `pg_map_id 0d509ccd...783c` equals the id inside the installed APK.
The next build replaces that folder (release 40 was built during these runs, after the copy). The entries needed here are kept in
`r8-mapping-excerpt.txt`. The #1371 crash logs are from an older release, so this mapping does not apply to them.

## What the stall does to the app

- **The row holder starts late.** `ShizukuControl.exec` is `main.post { withService { bindUserService ... } }`, and the
  `ServiceConnection` answers on main. The Shizuku starter had sent its binder at about +1.2 s, but `melaton_navblank` started only
  when main was free: "holder token linked" at +11.48..12.00 s with the display off, +1.3..2.3 s on the 7 starts with it on.
- **CaféReady's sandbox times out.** "engine did not start: no sandbox" (10 000 ms `TimeoutException`) in the stalled runs: the
  connect callback needs main. The engine came up at +21.5..21.8 s in 4 of them (+11.3 s in `kill-off-2`), against +0.8..1.5 s.
- **The earlier suspicion (main waits on CaféReady's timeout) is not supported.** In the stall dumps main is in the binder call,
  with no "waiting to lock" and no app latch; what ends each wait is `system_server`'s own 5 s timer per display. In the 31 s runs
  the third block is still going after "engine started" (+21.5 s), with no CaféReady timer left to end it. The two 10 s are separate
  timers: 2 displays x 5 s, and `CafeTasks.EVAL_S = 10`. (Log order alone proves nothing here: the `TimeoutException` line is
  written after `giveUp`, which may itself wait up to `LET_GO_S = 2` s for main.)

## Where it is, and the emulator-only questions

- **Guest as a whole: no.** `hb.txt` (never looks at a process) had no gap over 0.31 s wall / 0.21 s uptime in any stalled run.
  The ticks, which read `/proc`, kept coming (longest gap 0.77 s).
- **Host: no.** The same stall with Ruiko at a mean 18-23 % CPU (reinstalls) and at 81 % (`kill-off-1`; coord announced a DSApp
  unit-test build, Build 306, for that time). qemu used 1.1-1.5 cores in the stall windows, no host sample step over 1.3 s (`host.txt` per run).
- **dex2oat / verify-only: not needed.** All 12 `run-one.sh` runs had `[status=verify] [reason=install]`, the clean ones too, and `kill-off`
  stalls with no install and no `PACKAGE_REPLACED`.
- **berberis: no sign.** The blocked thread waits in a binder call into `system_server`.
- **Emulator-only? Not decided.** The 5 s wait is framework code. Whether a real phone also gives a new service no window list while
  its display is off was **not tested** (no real device in this task; the #1371 A53 log says display off was not tried).
  If it does, a one-display phone would be expected to lose about 5 s per call. That figure is inferred.

## The older #1371 KILL case (26.85 s, display on): not reproduced

- Tries: 5 plain `kill -9` starts and 2 exact replays of the `crash` step. No stall like it. Longest `hb.txt` gap 0.97 s.
- `replay-crash-1` (guest CPU 85-97 %, Ruiko 97 %) had main busy for 12 s: it moved on through surface creation and draws that each
  took about 1 s, "Skipped 157 frames", token at +5.58 s. It was slow, not parked in one call. The first app dump came at +16.5 s,
  so there is no stack for its longest `futex_wait` stretch (about +5.8..+11.6 s). `replay-crash-2`: 3.3 s, token at +3.53 s.
- Why `getWindows` does not explain the old case (read from `../1371/aemu-fold-1/crash-20261127-024954-*`): the status said the
  display was awake; both guest loops stopped (`pidof` sampler 26.85 s, observer 27.4 s); `system_server`'s main thread reported a
  26 499 ms dispatch; SystemUI threads ran 17-27 s late and two `Davey!` frames took 28.7-28.9 s; CaféReady's 10 s wait woke
  "17 seconds late"; the logcat kept by that step has no line from any process between +2.2 and +27.5 s. A blocked app main thread
  does none of that.
- **Inferred, not proven:** something guest-wide (the guest not running, or a kernel-level lock). The old evidence has no heartbeat
  and no host sample, so **guest or host cannot be decided**. The Windows System log had no events from 02:45 to 02:56 (read today).
  If it comes back, `stall-watch-guest.sh` + `tools/host-sample.sh` tell the two apart.
- The older UPDATE case with the display off (+2.5..+12.8 s, "Skipped 616 frames") matches this finding in trigger, length and frame
  count. That it was `getWindows` is **inferred** (no stack was taken then).

## Recommended fix (DSApp; nothing was edited)

1. **Never read `windows` / `windowsOnAllDisplays` on the main thread.** In `scanWindows()`, read the list on one dedicated thread
   (one read in flight, one pending; further asks coalesce) and apply the result on main. Apply the latest state only (a read can
   come back 10 s old), and drop it if the service was torn down. This does not depend on guessing when Android has a list.
2. **Do not treat an empty or partial list from an off display as "nothing in front".** The existing `ACTION_SCREEN_ON` receiver
   already calls `scanWindows()`, so the real read happens when the screen comes back. Do not simply skip all reads while the
   screen is off: a long-running service keeps its lists then, and the lock-screen looks (`lockedLook`) use them.
3. Move the other callers off main too, or prove they cannot run on a fresh connection: MelatonBars.kt:2176 `focusedDexDisplay`,
   :2223 `focusOffPhone` (key events), :5804; AndroidWindows.kt:363/651/685; DexAltTab.kt:214/237; DexStartMenu.kt:114/146;
   MelatonLock.kt:401/455; WalletImport.kt:116 (line numbers: origin/main 8f205732; their threads were not checked).
4. **Acceptance:** `tools/run-one.sh <name> kill-off` on a lane fold, at least 3 times: the main thread never outside its looper for
   2 s, "holder token linked" under 3 s, no "engine did not start", then screen on and the bars correct.
5. CaféReady's `SandboxConnect` needs no change for this stall.

**For the planner:** release 40 (`4d04d75`, `fix/1379-navrow-followups`, claude-e45cc6db) still has the synchronous read
(`scanWindows`, MelatonBars.kt:2748) and that session edits `MelatonBars.kt`: coordinate. Its message says a Shizuku command not
started after its deadline (holder 15 s) is now dropped. Inferred risk, not tested: with this stall the holder command waits for
main (about 10 s here); a longer first block would drop it.

## Method, limits, state left behind

- `stall-watch-guest.sh` (root, in the guest): heartbeat with uptime, main-thread ticks (state, wchan, kernel stack, schedstat,
  guest CPU, PSI), and at fixed offsets SIGQUIT of `system_server` and of the app, `debuggerd -b`, and the accessibility window
  list (titles stripped). The dumps disturb timing; the display-on controls had the same dumps and did not stall.
- Fixed during the session: new ANR files are now found by time (Android reuses `trace_00..63`, so `kill-off-1/2` first pulled
  none; they were fetched from `/data/anr` by modification time). For the same reason `kill-1..5` have only some of their app
  dumps and `reinstall-on-2` has none; their "never blocked" rests on `ticks.txt` and the log.
- Tools in `tools/`: `run-one.sh`, `replay-1371-crash.sh`, `analyze-run.py`, `run-table.py`, `stack-table.py`, `retrace.py`,
  `host-sample.sh` + `.ps1` (read-only on Ruiko). Use `WORK=<scratch> AGENT=<coord id>`.
- Raw files: plain in `kill-off-1/` and `reinstall-off-2/`; in the other runs the thread lists, `debuggerd` dumps and app ANR dumps
  are in `<run>/raw-bulk.tar.gz` (unpack in the run folder before `stack-table.py`). `system_server` dumps are extracts (main
  thread, accessibility threads, lock holders). `logcat-window.txt` is cut around the process start, with lines that could carry
  notification text, names or SSIDs removed and `SettingsToPropertiesMapper` spam dropped.
- `baseline/`: the #1371 `baseline` step had 1 FAIL (the page's setter: "socket hang up" just after boot). The needed state held
  (row held, one holder, Bars bound, Shizuku). Its screenshots showed the signed-in page and were deleted.
- Done to the instance: **5 installs** of the same release 39 APK (3 display off, 2 on); **9 `kill -9`** of the app's main process
  (5 `kill`, 2 `kill-off`, 2 in replays); display off and on again for 6 runs. The SIGQUIT dumps pushed older files out of
  Android's 64 ANR slots.
- Left: running, display on, Shizuku running (same pid 3056), row held, Bars bound, release 39 (sha checked), my files in
  `/data/local/tmp` removed (`lane-shot.png` there is the lane's own shot file, rewritten by the baseline step), no sound played.
