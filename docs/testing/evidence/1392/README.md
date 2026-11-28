# StaticForge #1392: the app's main thread stalled 10-31 s on some process starts

**Cause:** the Melaton Bars accessibility service read the window list (`AccessibilityService.getWindows()`) on the main
thread. For a **new** accessibility connection while the displays are off, Android's `system_server` waits 5 s **per
display** that has no window list yet (`ensureWindowsAvailableTimedLocked`). Everything else on main waited behind it:
the Shizuku bind that holds Android's button row, notices, playback hand-over. The `JavaScriptSandbox` timeout seen in
CaféReady was a result of this, not a cause.

**Stacks:** `FINDINGS-A.md`, `stack-table.txt`, `stacks-retraced.txt` (the app parked in `getWindows`),
`system_server-getWindows-dexdump.txt` (the 5 s wait on the other side).

**Fix:** DSApp `main` `3150722f`. Only `WindowReads.kt` reads the window list: the bars' reads run on their own thread and
are applied on main; key and tap handlers wait at most 200-300 ms; the PIN pad is looked for off main. A unit test fails
if any other file reads the list. 785 unit tests, 0 failures (`unit-tests.txt`).

The fix does not make Android's wait shorter; it takes the wait off main. In the lane's update run the first read still
took 6750 ms, and in a `kill -9` run 10004 ms (`window read took ... (on window-bars)`), while the row's token had
linked seconds earlier.

## Where each piece of evidence is

| folder or file | what it shows |
|---|---|
| `kill-*`, `reinstall-*`, `replay-crash-*`, `run-table.md` | release 39: 5 of 5 display-off starts stalled (main 10-31 s), 0 of 7 with the display on |
| `lane-r42/README.md` | the fix, release 42 on `aemu-fold-2`: the acceptance runs, and the locked early wakes that missed 5 s |
| `lane-d/README.md` | the user paths the change touched: PIN unlock, soft keys, volume key, popup, bars off/on, rotation, DeX in part |
| `a53/README.md` | the real phone: one screen-off start, no 5 s wait on it |

## Acceptance on the lane (release 42; limit 5 s after the process start)

| start | first `MelatonBars` line | `holder token linked` |
|---|---|---|
| release 40 (no fix), display off, `kill -9`, same instance | - | +14.71 s |
| real silent self-update 40 to 42, display off | +1.42 s | +3.74 s |
| display off, `kill -9`, 3 runs | +0.27 to +0.40 s | +1.45 to +1.53 s |
| display off, reinstall, 3 runs | +0.90 to +0.97 s | +2.22 to +2.36 s |

`crash` step: the row's flags did not change in SystemUI's log.

**Missed:** three runs of a **locked** restart woken about 3 s after the new process, on a test PC at 95-100 % CPU, took
+5.49, +8.79 and +18.22 s. In the one with a thread dump, main waited for the app's render thread inside the emulator's
graphics pipe (`qemu_pipe_read`, host GPU); the new window-read thread was idle. That stack is emulator code and cannot
occur on a phone. The other two have no such stack, so the same cause is **not** shown for them. A quiet-host repeat was
not possible (the PC never went quiet); it is part of the lock-screen work handed on below.

**The old 26.85 s case** (display on, after `kill -9`, #1371): the whole emulator guest had stopped (the samplers and
`system_server` too). Five kills and two replays did not bring it back. That it was a stall of the whole guest is an
inference.

## The A53 (one real-phone run, release 44, which has the fix)

Screen switched off, then one reinstall of the installed APK: first `MelatonBars` line +1.33 s, `holder token linked`
+2.83 s (over local ADB), first window look applied after 430 ms with 1 window, no slow-read line. **The 5 s wait did not
happen on this phone.** Its screen never went fully off (it dozed: `DOZE` / `DOZE_SUSPEND`), unlike the lane's `OFF`; that
this is why is an inference. So **the stall has not been shown on a real phone**, and whether a phone whose screen goes
fully off meets it was not tested. The blocking call itself is Android's accessibility code, not something added by the
emulator, and the app no longer waits for it on main.

## Step 4: the early hold without the main thread (review `../1371/review-9085c00.md`, S7) - not done, on purpose

S7 names three ways out. This work took the first: **(a)** find and remove the main-thread wait at boot. With it gone the
Shizuku holder's token links 1.45-3.74 s after the process start in the runs above, far inside the old holder's 20 s grace.

**(b)** (try local ADB first for the early hold) was **not** done:

- A holder started over ADB is a child of `adbd` and dies when `adbd` restarts. S7 says this itself (its finding N3).
- #1379 has just landed the answer to N3: it **moves** such a holder to Shizuku. ADB-first at every process start would
  create the weaker holder on purpose, then spend a second start moving it.
- It cannot be had by changing Shizuku's route instead: `ShizukuControl.exec` binds the user service from a main-thread
  post, and the connection comes back on main (as S7 assumes; the library was not re-read here).

What this leaves: anything else that blocks main still delays a Shizuku hold. The old holder's grace and the ADB route
after the 15 s latch still cover the row, as before.

## Handed on

Fleet work item 262: PIN unlock without a shell never presses OK (the same on release 40, so older than this change);
Android's lock screen showing first after a locked restart on a busy host; the soft key bar's grey/black see-through
decision.

## For whoever reads the older evidence

`../1371/aemu-fold-1/*logcat.txt` (committed by #1371) holds real place coordinates in `GeofenceRequest(...)` lines. They
were left unchanged here (not this work's files). This folder's copies have them redacted.
