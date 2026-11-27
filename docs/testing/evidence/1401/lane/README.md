# #1401 acceptance on the emulator lane: the 3 s limit of the wait for the task thread

Device: `aemu-fold-2` (Fold-shaped emulator on Ruiko). Date: Nov 27 2026, 12:50 to 13:10 (device time, same as the log times).
Build: release 39, versionCode 3632745 (DSApp-Kotlin c9806bef). Checked with `dumpsys package jp.net.seventhreeseven.dreamscape | grep versionCode`
after `install-release 39` (answer: before 3632181, after 3632745, installed once) and again at the end. The emulator was not running at the start:
`L up` + `L wait-boot` (no reset).

Method: made-up open-Pacific position fed with `geo`, mock GPS on, one place `p-retest` (NR only, 200 m), drive detection idle, screen off with Settings in front
for the G steps (kit `run.sh`), kill loop `loop.sh 45` (kill -9 of `js_sandboxed_process` as fast as it comes back) started just before the exit.

## Table

| step | kill mode | reached | T_exit (`left p-retest`) | T_auto (`write <Auto mask> ... read back ok`) | difference | kills before T_auto | 3 s line | PASS/FAIL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G0-enter | none | REACHED | (the save had already entered the place, see below) | - | - | - | - | REACHED |
| G1-guard-exit | long45 | REACHED (30 s) | 12:54:49.697 | 12:55:16.238 | 26.5 s | 8 | absent | FAIL (criterion "3 s line" not met; timing met) |
| G0b-enter | none | REACHED (7 s) | - | - | - | - | - | REACHED |
| G2-guard-exit | long45 | REACHED (30 s) | 12:57:01.749 | 12:57:29.869 | 28.1 s | 5 | present | PASS |
| G0c-enter | none | REACHED (8 s) | - | - | - | - | - | REACHED |
| G3-guard-exit (third try, extra) | long45 | REACHED (29 s) | 12:58:37.157 | 12:59:05.291 | 28.1 s | 4 | present | PASS |
| H1-hand-set / H1b / H1c | long45 | see below | - | - | - | - | absent in all three | hand set works, 3 s limit not shown on this path |

Before the fix (old run, `G1-guard-exit.log` of r1328c): Auto written 45.4 s after the exit (the old log: left 04:18:31.824, write 04:19:17.387).

Kill loops: G1 loop 12:54:49.469 to 12:55:34.008 (12 kills, still running at T_auto); G2 12:57:01.526 to 12:57:46.007 (6 kills, running at T_auto);
G3 12:58:36.931 to 12:59:21.026 (5 kills, running at T_auto).

## Key lines

G1 (`G1-guard-exit.log`):
```
12:54:49.695 DriveState: geofence transition 2 radio:p-retest [idle]
12:54:49.697 RadioMode: left p-retest (in 0)
12:55:16.115 CafeTasks: radio-mode rules not delivered (NO_ENGINE)
12:55:16.126 RadioMode: no answer after leaving p-retest: the app puts Auto back
12:55:16.238 RadioMode: write 10001101001110000111 slot 0: read back ok
```
No `the task thread did not answer in 3 s` line in G1 (grep count 0 over the whole run). The guard fired (Auto came from the app, `no answer after leaving`) and
wrote 26.5 s after the exit, so the wait ended inside its 3 s without being cut; the log does not say how long it took (the guard line is 1.4 s after the
25 s mark). By the rule of the brief (the 3 s line must be there) G1 is FAIL; it is not a timing failure.

G2 (`G2-guard-exit.log`):
```
12:57:01.747 DriveState: geofence transition 2 radio:p-retest [idle]
12:57:01.749 RadioMode: left p-retest (in 0)
12:57:29.760 RadioMode: the task thread did not answer in 3 s: the app goes on without it
12:57:29.760 RadioMode: no answer after leaving p-retest: the app puts Auto back
12:57:29.869 RadioMode: write 10001101001110000111 slot 0: read back ok
```
G3 (`G3-guard-exit.log`): exit 12:58:37.157, `did not answer in 3 s` 12:59:05.170, `no answer after leaving` 12:59:05.170, write 12:59:05.291.

Health in G1/G2/G3: crash buffer lines 0, AndroidRuntime errors 0, app pid 3031 before and after (never died). The app was never restarted after `start-app`.
Final state lines right after the step and 30 s later, in G1, G2 and G3: `app : applied null, owed false, guardAt 0, inside []` and `task: inside [], armed false, want null`,
but `untold {"exits":["p-retest"],...}` stayed set in the app state (not null as in the old run, where it was `untold null`). It became null again at the next entry (G0b, G0c: untold null).
The task engine had restarted ("engine started (9 files)") a few seconds after the loop ended and had asked `auto` (exit) in G1. Not investigated further.

## H1 (hand set under the kill loop)

Bridge method: `AndroidDevice.setRadioMode(mode, mask)` (DeviceControl.kt:439 -> RadioMode.setFromPage), mode `lte`, mask from `CafeTasks.lib.radio.maskFor("lte", supported, baseline)` = `00000001000000000000` (reads as `LTE|LTE_CA`).
- H1 (first try, `H1-hand-set.log`): loop started 13:00:14.2, call at about 13:00:16.4 (the page's own clock was not recorded: the eval timed out, see below), write 13:00:16.765, i.e. under 0.5 s.
  Reads 13:00:46.8 (about 30 s) and 13:01:28.8 / 13:01:32.0 (about 72 s): `LTE|LTE_CA`. The 5 s read was missed. No `RadioMode: write` line after 13:00:16.765 up to the end.
- H1b (second try, `H1b-hand-set.log`): call about 13:02:15.0, write 13:02:15.313 (0.3 s). A 1 per second sampler on the device (about 85 s) shows `LTE|LTE_CA` in every sample from 13:02:15.96 to 13:03:36.4.
- H1c (third try, app in front, `H1c-hand-set.log`): page clock call 13:07:18.341, bridge returned 13:07:18.345 `{"ok":true,"pending":true}`, page event `op set ok true` at 13:07:18.482,
  write 13:07:18.471 (0.13 s). Samples every about 5 s (the sampler was slower with the page awake) at 13:07:23.2 (+5 s), 13:07:28.3, 13:07:49.0, 13:08:18.9 (+60 s), 13:08:23.0, 13:08:28.2 (+70 s): all `LTE|LTE_CA`; nothing but `LTE|LTE_CA` after the call.
  Final state `applied lte`, `status hand` (the task keeps `want nr`, `status hand`), no `task asks ...` line after the write, loop 13:07:15.8 to 13:08:00.0, 6 kills.
In all three tries there is no `the task thread did not answer in 3 s` line: at the call the engine was closed (`radio-mode manual failed: the engine is closed`), so the catch-up did not have to wait.
So H1 shows only that the hand set is written at once under the kill loop and is not written over; the 3 s cut on the hand-set path was not shown.

## Did not go as planned

- The as-found file was taken after the boot and after the install (the emulator had 3632181 before the install). Types as found were the emulator default text with CDMA/EvDo/TD_SCDMA.
- G0-enter: the save of the place already entered it (position "in"), so the G0 log has no `entered` line; the state lines show applied nr, inside [p-retest].
- G1 had no 3 s line (above). G2 and G3 had it.
- H1 and H1b: the page eval returned `timeout (30 s)`: `run.sh` puts Settings in front, and the page's timers stop while the app is behind it. The bridge call itself ran at once (its write is in the log), but the answer event was not seen. The place removal (`save-none`) hit the same: the two timed-out evals ran later when `start-app` brought the app to the front (rules emptied, Auto written 13:06:24). H1c was done with the app in front (screen on) and shows the answer.
- `run.sh`'s log is taken at the moment Auto is seen, so the kill loop's end line is in the "post-step" blocks that were appended to the G logs.

## Put back

Place removed (`save-none`, result ok, rules 0; `logs/save-none.txt`), Auto back, `restore.sh` run: types equal the as-found text (`logs/restore.txt`, `logs/asleft.txt`), mock provider removed, mock appop `default` (as found),
`/data/local/tmp/c-*` files and `c-loop.log` removed, screen off, emulator running, release 39 installed. Differences from as found: `radio_mode.json` exists now (absent at first; the app made it, rules empty) and the app cache file `state-radio-mode.json` has another hash.
No device other than `aemu-fold-2`, no sound, no screenshots, no git add or commit.

## Planner's reading (session 9dca573c, after reading the logs)

- The acceptance asked for the guard on time under the kill loop. All three guard runs meet it: 26.5 s, 28.1 s and 28.1 s after the exit, with the loop
  still running (45.4 s before the fix). The test agent's stricter rule also wanted the "did not answer in 3 s" line; in G1 the task thread happened to
  answer inside the 3 s (its "not delivered" report came at 12:55:16.115, the guard wrote at 12:55:16.238), so the wait ended by itself. That is the
  limit not being needed, not a failure of it.
- `untold: exits [p-retest]` left on disk after G1 to G3: the last "said again" exit word was reported lost while the loop still ran (G1: 12:55:36.259),
  and the engine came back a moment later and heard the guard's own exit word (`task asks auto - (exit)`, the task ends with inside []). The lost word
  waits for the retry backoff or the next event and was gone at the next entry. This is the #1328 lost-word bookkeeping, which #1401 did not change;
  the phone was on Auto and the task agreed. Not looked into further.
- The 3 s cut on the hand-set path was not shown on the device (the task thread was idle at each call). It is covered by the unit tests only
  (`RadioCoreTest`: an older Auto of the task's is not written over a hand set made before the task thread answered).
- The merge that went to DSApp main is 8f205732 (main b6ece80 + c9806bef); release 39 was built from the same two plus the other unmerged branches.
