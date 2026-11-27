# #1379 device proof on aemu-fold-2 (Nov 27 2026, 14:25-15:03)

Instance: `aemu-fold-2`, Fold-shaped, Android 17 (API 37, userdebug), `-no-audio`. App: server release 40
(versionCode 3632839, installed over 3632745 under build gate 310). Source read: DSApp `f0fe4c1`. Shizuku
13.6.0 (its screen says "Version 13.5"), started from the adb shell by `lane.sh shizuku start`. Agent
`claude-e45cc6db`.

**How the row is judged.** (a) A guest sampler (root, moved into the root cgroup so an adbd restart does not
kill it): each line is one `dumpsys statusbar` (shell records, the `cmd statusbar` lock record `lockrec`,
net flags `mDisabled1` of display 0) plus the pids. Its real period was **0.31-0.37 s median**, not 0.2 s
(longest spacing per run in the table). (b) SystemUI's `disableFlagsInteractor` log lines, one per net-flag
change it was handed. The row is held while `0x03600000` is set. Android 17 here keeps no disable history,
so there is no per-call trace of system_server. Positive control: (a) and (b) both show the give-back in
TEST 2 plain, TEST 3 and TEST 4a.

**Two Shizuku configurations**

- **plain** (the lane's normal one): `shizuku_server` is started from the adb shell, so it sits in adbd's
  cgroup `0::/system/uid_0/pid_<adbd>`. Its user service and **every holder it starts** are in that cgroup too.
- **config B** (constructed, not a lane or phone configuration): the same start, then as root only
  `echo <shizuku_server pid> > /sys/fs/cgroup/cgroup.procs` before it had a user service. uid 2000, context
  `u:r:shell:s0`, parent, pgrp and sid are unchanged; only the cgroup is `0::/`. Its children inherit `0::/`.

**How Shizuku was made "running but not usable by the app"** (`take.sh` steps, see log.txt): `pm revoke ...
moe.shizuku.manager.permission.API_V23` alone is **not** enough (probe: `shizuku.json` kept `flags: 2`, the
new process got a Shizuku holder; probe-revoke-*). The manager's "Authorized apps" list was empty on this
image. Used: revoke the permission, stop Shizuku, set `/data/user_de/0/com.android.shell/shizuku.json` to
`{"version":2,"packages":[]}` as root, start Shizuku, then `kill-app`. The grant was the user's way:
`AndroidApplets.action('shizuku','allow','')`, then a tap on "Allow all the time".

## Results

| # | point | config | result | numbers |
| --- | --- | --- | --- | --- |
| 1 | new process, Shizuku not allowed: holder over local ADB | plain x2, B x1 | PASS | `holder token linked (#1331), started over local ADB`; `[shizuku: not usable; adb: ok]` |
| 1 | the three move lines after the grant | plain x2, B x1 (+1 plain at restore) | PASS | tap to "moving" 2.7 / 5.2 / 2.8 s (restore 2.5); "moving" to "moved" 1.17 / 2.92 / 1.11 s (1.98) |
| 1 | no moment without the shell record, no net-flag give-back (whole run, app kill included) | plain run 1 | PASS | 571 samples / 203.9 s, 0 without record; longest spacing 1111 ms (478 ms around the move); 4 SystemUI lines, all row held |
| 1 | same | plain run 2 | PASS | 384 samples / 150.8 s, 0; longest 924 ms (also 924 around the move); 5 lines, all held |
| 1 | same | B | PASS | 449 samples / 146.7 s, 0; longest 588 ms (567 around the move); 4 lines, all held |
| 1 | old holder gone, exactly one `melaton_navblank`, `.out` = OK, no `.move.out` | all | PASS | 9140 -> 15149; 29144 -> 1983; 20483 -> 25048; (23037 -> 24293) |
| 1 | Shizuku-started holder alive with the same pid after 60 s | all | PASS | 15149, 1983, 25048 (24293) |
| 1 | alive after the ShellService process goes away | plain run 1 only | PASS (forced) | it did **not** go away by itself (seen alive 90+ s; run 2 and B too); root `kill -9` 15089: holder 15149 alive 20 s later and after screen off/on |
| 1 | screen off/on starts nothing new | all | PASS | same pid, no holder line after the screen off |
| 2 | Shizuku-started holder survives `adb tcpip 5555` with the same pid | **plain** | **FAIL** | holder 1983 -> 13184 (new, over **local ADB**); `shizuku_server` 28508 and the user service 1790 died, Shizuku not back within 65 s; row given back **1.80 s** (SystemUI), 6 samples without record (1.87 s); app: `holder died after 123 s (#1 in a row): holding again`; init: `Sending SIGKILL to service 'adbd' (pid 549) process group...` |
| 2 | same | **B** | PASS | holder 25048, server 19839, user service 24985 unchanged; adbd 13006 -> 6430; 237 samples / 72 s, 0 without record; 0 SystemUI disable lines; no app line (1256 raw log lines in the window) |
| 3 | blocked Bars: early hold, row held | plain | PASS | `early hold at process start (#1371)` +0.9 s after `Start proc`; holder 15308 over Shizuku +2.0 s |
| 3 | about 30 s: not-bound line, then `gesture fallback on` | plain | PASS | +30.6 s after `Start proc` (29.7 s after the early hold); fallback +0.32 s after that line |
| 3 | afterwards no holder, no shell record, gesture overlay | plain | PASS | same at +95 s: 2 records (systemui, 0x0), `navigation_mode=2`, overlay `...navbar.gestural` (this image has **no** `gestural_no_hint` overlay) |
| 3 | R8: Android's status bar given back | plain | PASS | before: `pkg=android ...StatusBarShellCommandToken what1=0x00930000 what2=0x1` (and still there during the 30 s unbound); gone 44 ms after the not-bound line (SystemUI `disable1=0x3600000`), row released 0.48 s later; after: record absent, `mDisabled1=0x0`. BarsHeal had not given up yet (it did 12 s later) |
| 4a | R5: switch fails once, looked at once more, then works | plain, Shizuku not allowed, ADB gated | PASS | gate on +19 s, off +36 s. +31.4 s: `gesture fallback: no shell route to read the overlay list` + `... looked at once more (#1379)`; +46.4 s second not-bound line; +46.6 s `gesture fallback on` (15.0 s after the first look) |
| 4a | R8 inside this run | | NOT SHOWN | BarsHeal (#1340) was at its cap, gave up at +15.4 s and gave the status bar back itself before the gate closed |
| 4b | route not restored: exactly one extra look, then nothing for 90 s | same | PASS | looks at +31.0 and +46.0 s; **0** MelatonBars lines of any kind from +47 to +151 s |
| 4b | state left behind | | measured | at +150 s: holder 6182 held, 3-button overlay, `navigation_mode=0`, Bars component disabled, gate closed: Android's buttons empty and no Melaton bar. Whether a later event recovers it once the route is back was **not** tested |

## Parent chain, cgroup, process group

Every process below has `ppid=1` except the app (zygote64). Full lines: `*-cgroups*.txt` (plain run 1 is in
log.txt only).

| process | pgrp / sid | cgroup, plain | cgroup, config B |
| --- | --- | --- | --- |
| adbd | own / 0 | `/system/uid_0/pid_<adbd>` | same |
| shizuku_server | own / own | adbd's | `/` |
| Shizuku user service (`...:shell`) | server's / server's | adbd's | `/` |
| holder started over local ADB | own / own | adbd's | adbd's |
| holder started over Shizuku | own / own | **adbd's** | `/` |

So on this image the two holders differ in nothing visible in the plain configuration. In config B they differ
only in the cgroup, and the one outside adbd's cgroup survives the restart. **The move to Shizuku helps
against an adbd restart only when `shizuku_server` is outside adbd's cgroup.** Where it sits on a real phone
was not measured here.

## Other findings

- **Other trigger:** none produced. A Shizuku restart (14:29:15) delivered no binder to the running app process
  6782 (no `ShizukuProvider` line for it). All moves here followed the permission grant; the log does not name
  which `moveCheck` trigger fired.
- `lane.sh adbd gate on|off` works on this instance (root `iptables -S` and a connect test), but its answer
  `appSees5555Closed` is always false: the check runs `iptables` as the shell user ("Permission denied").
- Pressing Home made the app give Android's status bar back (`Android's bar given back: extend-off`, `ext=true`).
  Dreamscape was brought to the front so the bar was locked before TEST 3 and 4.
- TEST 3 / 4 block: root `kill -STOP <app>`, `pm disable .../MelatonBarService`, `kill -9`. The STOP keeps the
  teardown (which unlocks the status bar) from running; `pm disable` itself killed the process (`Killing ...: change`).
- With the component disabled, `enabled_accessibility_services` read `null` after TEST 3.
- Getting Bars bound again after 4a: `pm enable` + writing the same setting left it under "Crashed services"
  (BarsHeal capped). Setting off and on plus a new app process bound it.
- No app crash in the crash buffer. `lane.sh sound` over 45 min: 1 decision (`sms: ringer 0`, silent by ringer,
  at 14:48:49, not a step of these tests), `playedCount 0`, `alarmLikeStarted 0`.
- `test1-run1-shizuku-dialog.png`: the splash behind the dialog shows a "Powered by ... TM" badge with a blank
  where the name or logo would be (seen, not investigated).

## State left

Component back to its manifest default; Bars bound; 3-button room, row held (holder 24293 over Shizuku, one
`melaton_navblank`, `.out` OK), status bar locked; checked after 62 s and a screen off/on (`final-cgroups.txt`,
end of log.txt). Gate off (0 rules). App ADB settings unchanged (port 5555, all four switches on, preferred
adb). Shizuku running in the **plain** configuration (pid 25038) and the app allowed (`flags 2`). Guest helper
files removed.

Not as found: Melaton Bars is **on with soft keys** (after the install it was `enabled=false softkeys=false`,
gesture navigation); the guest logcat buffer was raised to 16 MiB; BarsHeal's cap ("5 switches within 30
minutes") was reached by the blocked runs and may still apply for a while (`lane.sh aemu-fold-2 reset` boots
golden). BarsHeal logged `fault report not due yet` in the capped runs; whether a report from this instance
reached the server was not checked. The instance is running and the lease was not released.

## Files

`log.txt` (everything, in order), `guest-helpers.sh`, `analyze.py`, `move-window.txt`; per run
`<run>-logcat.txt`, `-sample.txt`, `-analysis.txt`, `-cgroups*.txt`, `-statusbar-*.txt`, `-dmesg-init.txt`.
Runs: `setup`, `probe-revoke`, `test1-run1`, `test1-run2`, `configB-test1`, `test2-plain`, `test2-configB`,
`test3`, `test4a`, `test4b`, `restore`.
