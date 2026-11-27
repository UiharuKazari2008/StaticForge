# The emulator lane

Phone acceptance runs on Android emulators on Ruiko, not on Yukimi's phones (StaticForge #1309, #1312).
The lane is a pool of Fold-shaped and A53-shaped emulators. Each one has the app, Shizuku, its own
test-device id and a golden snapshot. One agent holds one instance at a time, through coord.

Driver: `scripts/aemu-lane/lane.sh`. One command per action. Answers are JSON.

**Status (Nov 26 2026, night):** proven on real instances: create / up / down / provision / golden / status / shot (inner, cover,
external) / the Android shade shot / `notice` (one device) + `notifs` + `sound` / Shizuku as the shell user / the permission dialog
tap / partner + fence / `display add-external` (a freeform window on a second display) / `reboot` (clean shutdown + cold boot) /
the memory and CPU guards and the provision lock / `reap`. **Not proven yet:** `reset` from `golden` (the snapshot is saved, a
restore has not been run), `posture half`, the closed-posture shot (logical display 0 comes out black, see Gotchas), the fold
shade and external display shots, a 2 GB A53 guest (a53-3: the first-start download of the app's ~211 MB pack failed
three times while Ruiko was at 100 % CPU, so the app never reached its page), real audio capture (not possible with
`-no-audio`), `aemu-fold-3/4` and `aemu-a53-4` (not created by me; other agents created some of them with this script).

**Written Nov 27 2026 00:15 (part A2, #1309) but not yet run on any instance, because Ruiko's CPU stayed at 94-100 % from 22:49
to this line (the guard answers exit 5; no guard was raised):** `lane.sh <id> update state|restart-now|proof` (the app's own silent
update), `lane.sh <id> app-port`, `reset` restoring the app's port to 5555, the adb re-registration of an unlisted emulator
(see Gotchas), `scripts/aemu-lane/tests/accept-1272.sh` (the example acceptance, see "Example acceptance: #1272"). Still to run:
`reset` from golden, `posture closed|half` (the black display 0), the fold shade and external-display shots, the two update proofs
(Shizuku route; waiting, then installing by itself), the #1272 run. The `app-update-waiting` Fleet notice cannot be seen on a lane
instance: since #1334 a test device raises no notice, by design; its delivery record (`waiting` + why) is the lane evidence.

## Rules of the lane (HARD)

- **Never Ruiko's speakers.** Ruiko is Yukimi's desktop PC. Every start carries `-no-audio`
  (`scripts/aemu-lane/ruiko/start.cmd`). `lane.sh up`, `reset` and `create` check the qemu command line
  and stop the emulator if the flag is missing. `lane.sh <id> status` shows `"noAudio": true`.
- **No alarm sound, no ringtone, ever.** Alarm, ring, system and voice streams are 0, the ringer is
  silent, media is 2, the notification stream is 2 (of 7). `setup_device` sets this on every boot.
  A test notice is soft, or it is checked silently from logs. `lane.sh <id> sound` reports
  `alarmLikeStarted`: it must stay 0.
- **The Fold is Yukimi's phone.** The lane never reaches it. Every adb call is pinned to the lane
  serial `emulator-<port>`. `lane.sh <id> adb` refuses `-s`, `devices`, `connect`, `kill-server`,
  `forward --remove-all` and any other device. The A53 is the agents' own test phone, see below.
- **Hidden.** Emulators start in Ruiko's session 0 through WMI (never on her desktop). GPU is
  `-gpu host`: SwiftShader and guest GPU crash qemu when the page draws.
- **Do not touch** `emulator-5570` (fold7-test), `emulator-5580` (DSFold7) or their folders. They belong to
  other sessions.

## The pool

| id | shape | console / adb port | tunnel port | CDP port | Android |
| --- | --- | --- | --- | --- | --- |
| `aemu-fold-1` | fold | 5556 / 5557 (5600 until it is restarted) | 15101 | 9381 | 17 (API 37, google_apis x86_64, userdebug) |
| `aemu-fold-2` | fold | 5558 / 5559 | 15102 | 9382 | 17 |
| `aemu-fold-3` | fold | 5564 / 5565 | 15103 | 9383 | 17 |
| `aemu-fold-4` | fold | 5572 / 5573 | 15104 | 9384 | 17 |
| `aemu-a53-1` | a53 | 5560 / 5561 | 15111 | 9391 | 16 (API 36, google_apis x86_64, userdebug) |
| `aemu-a53-2` | a53 | 5562 / 5563 | 15112 | 9392 | 16 |
| `aemu-a53-3` | a53 | 5566 / 5567 | 15113 | 9393 | 16 |
| `aemu-a53-4` | a53 | 5568 / 5569 | 15114 | 9394 | 16 |

`lane.sh list` shows which exist, which run and who holds a lease. An id that was never created is made with
`lane.sh create <fold|a53> <n>` (after `coord_device_request <id>`).

**What exists.** One probe on Ruiko reads four facts for an id: its `.ini`, the AVD's `config.ini`, the AVD folder and the
`golden` snapshot. They make one word, `state`: `absent` (none of it), `partial` (some of it: a `create` died midway, for
example a folder without `config.ini`, or an `.ini` alone), `created` (`.ini` and `config.ini`, no snapshot yet) and `golden`
(created, and the `golden` snapshot is saved). `list`, `create`, `up` and `reset` all read that same probe, so they cannot
disagree: `list` shows `created: true` for `created` and `golden`, `golden: true` only for `golden`.

- **Ruiko unreachable is its own answer (exit code 7).** Ruiko's sshd refuses connections past ten unauthenticated ones at a
  time (`MaxStartups 10:30:100`), and with several agents driving several instances some connections are reset
  (`kex_exchange_identification: Connection reset by peer`). The lane retries such a call (4 tries, 1, 2 and 4 seconds
  apart) and then answers "cannot reach Ruiko" with exit code 7 and changes nothing. It never reads a dropped connection as
  "no AVD", "not created", "no golden" or "no process"; run the command again. Only a call that did not connect is
  retried, never one that ran. `LANE_RUIKO_HOST` is the ssh name of Ruiko (default `ruiko`).

- **Console ports are even and inside adb's scan range 5554..5584.** adb's server finds and reconnects emulators there
  by itself. Outside it (the first lane used 5600) an emulator is registered once at its start and stays `offline`
  after a guest reboot. 5570 and 5580 are the other sessions' emulators (`fold7-test`, `DSFold7`): never touch them.
  An instance that still runs on old ports keeps them in `~/.config/aemu-lane/<id>.ports` until it is restarted.
- **fold**: inner display 1968x2184 at 360 dpi, cover display 1080x2520 as a second built-in display,
  hinge sensor, the Fold7 camera cutout (fabricated overlay, as `scripts/fold7-emu.sh`). 3 GB guest.
- **a53**: one display 1080x2400 at 420 dpi (411x824 CSS at 2.625, memory #3).
- **Capacity is Ruiko's memory, not a count.** One running instance takes about 4.6 GB (fold) / 3.3 GB (a53).
  `lane.sh up` and `create` read Ruiko's free memory and refuse (exit code 4, a clear message) when one more instance
  would leave less than 3 GB free. Stop what you do not use: `lane.sh <id> down` keeps the instance and its `golden`
  snapshot, and frees the memory for the next one. A lease held only for "building" counts as idle.
- **CPU guard**: `up` and `create` also refuse (exit code 5) when Ruiko's CPU load is above 85 % (mean of five samples
  over about 10 s, `LANE_MAX_CPU` changes it). Ruiko is Yukimi's desktop: six emulators at once make every page
  download crawl and adb time out.
- **One create / provision at a time**: they take a lock (`~/.cache/claude-run/aemu-lane/provision.lock`); a second one
  answers with exit code 6 and names the holder. Each downloads ~200 MB and installs ~8,000 files; the server rebuilds its
  pack on every publish, so a first install may show "Couldn't download updates": `provision` presses RETRY by itself.
- **Reaper**: `lane.sh reap` stops a running instance that nobody used for 30 minutes, and one whose coord lease has
  ended and that has been idle for 5 minutes. It runs from the Ruiko scheduled task (idle rule only, Ruiko cannot read
  the lease) and, at most every 5 minutes, from any `lane.sh` command. Always `release` your lease when done.
- An instance nobody used for 30 minutes is stopped by `ruiko/reap.ps1`: the Ruiko scheduled task
  `aemu-lane-reap` (every 10 minutes) and, at most every 5 minutes, any `lane.sh` command (no polling loop on the
  Dreamscape server). Every `lane.sh` command refreshes the idle clock. Long quiet work: `lane.sh <id> keep 60`.
- Each instance is its own AVD with its own userdata, so it has its own ActiveSync device id.
  The device is a marked test device named `Lane <id>` (modules/testDevices.js): household notices never
  reach it and its test notices never reach a real phone.
- Files on Ruiko: `C:\Users\ykaza\claude-lane\` (`sdk\` private SDK root with its own emulator 37.2.13 and
  system images copied from the existing roots, `platform-tools` is a junction to the shared one,
  `avd\`, `home\`, `logs\`, `last\`). The shared SDK in `E:\Users\kazari\android\sdk` is not changed.
  Its adb server on :5037 also holds Yukimi's phones: that is why every call is pinned.

## Check out an instance

```
mcp__agent-coord__coord_device_request device=aemu-a53-1 why="..." minutes=30
scripts/aemu-lane/lane.sh --agent claude-<your id> aemu-a53-1 status
mcp__agent-coord__coord_device_release device=aemu-a53-1
```

`lane.sh` reads agent-coord's sqlite file (`~/.local/state/dreamscape-agents/coord.db`, read-only)
and refuses to drive an instance whose lease you do not hold. Your id is `--agent <id>`, or env
`COORD_AGENT_ID`, else `claude-<first 8 of CLAUDE_CODE_SESSION_ID>`. `list`, `status` and `wait-boot`
need no lease. `LANE_NO_LEASE=1` turns the check off (for the lane's own scripts).
Release the instance when your test ends. Leave it running: the reaper stops it when idle.

## Commands

`L=scripts/aemu-lane/lane.sh`, `I=aemu-fold-1` (or any id).

| command | what it does |
| --- | --- |
| `$L list` | every id: `state` (`absent`, `partial`, `created`, `golden`), created, running, golden, lease holder; exit 7 and no rows when Ruiko cannot be reached |
| `$L create fold 1` | make the AVD, boot, provision, save `golden` (10-20 minutes the first time). Finishes a half-made instance (state `created` or `partial`); refuses one that is `golden` |
| `$L $I up [--golden]` | cold boot (state kept), or boot from the golden snapshot. A boot already in progress is waited for (up to 4 minutes), never killed |
| `$L $I delete --yes` | remove the instance on Ruiko (its AVD folder, `.ini`, last-use and log file) and its local leftovers; `create` then starts over. Without `--yes` it refuses |
| `$L $I down` / `status` / `wait-boot [secs]` | stop / one JSON with everything we know / wait |
| `$L $I provision` | the setup steps of `create` again (idempotent) |
| `$L $I golden` | save the snapshot `golden` of the running state |
| `$L $I reset` | stop, boot from `golden`: the instance as it was when it was saved |
| `$L $I reboot` | clean guest shutdown, then a cold boot of a fresh emulator process (disk kept). Nothing is set up again (see "What survives a reboot") |
| `$L $I posture closed\|half\|open` | fold only: cover (logical display 0 = 1080x2520, hinge 0) / hinge 90 / inner |
| `$L $I rotate 0..3\|auto` | fixed rotation / auto-rotate |
| `$L $I shot out.png [inner\|cover\|external\|<id>\|all]` | screencap of a display; `all` writes `out-inner.png`, `out-cover.png`, ... |
| `$L $I shade out.png` | expand the notification shade, capture, collapse |
| `$L $I notifs` | the app's posted Android notifications (key, channel, title, text, flags, importance) |
| `$L $I logcat [secs] [--all]` | app-related lines of the last N seconds, or everything |
| `$L $I sound [--since <ms>]` | what played, from logs (see "Prove a notice") |
| `$L $I notice push\|get '<json>'` | a test notice for this one device |
| `$L $I kill-page` / `kill-app` / `stop-app` / `start-app` | WebView renderer killed / app process killed (root kill -9, as the low-memory killer) / force stop / start |
| `$L $I home` / `other` / `screen on\|off` / `doze on\|off` | Home key / Settings in front / power key / forced Doze |
| `$L $I net on\|off\|hang\|slow\|flaky` | Wi-Fi + data on / off; HTTPS black-holed; 2 s delay at 64 kbit/s; 40 % loss |
| `$L $I install-release [buildId] [--force]` | newest server release (`GET /api/android-builds`), sha256 checked, `adb install -r -g` on this emulator only, once per build |
| `$L $I shizuku start\|stop\|grant\|status` | Shizuku as the shell user |
| `$L $I adbd status\|tcpip [port]\|usb\|gate on\|off\|wireless on\|off` | the guest's adbd: 5555, wireless debugging; `gate` is the manual shim below |
| `$L $I update state\|restart-now\|proof [secs]` | the app's own silent update (#1309 part 3): `state` = installed versionCode + the page bridge's staged / waiting state + the SERVER's delivery record of this device; `restart-now` = `window.MelatonAppUpdate.restartNow()` in the page (what Restart Now does); `proof` = the `ApkInstall` log lines, installed versionCode, how many packageinstaller activities / notifications exist (must be 0) |
| `$L $I app-port [N]` | the app's local-ADB port preference (Advanced Tools > Port), default 5555; only the port changes. `reset` does it by itself |
| `$L $I cdp` / `eval '<js>'` | the page's DevTools pages / run JavaScript in the page |
| `$L $I tap X Y` / `key KEYCODE` / `text 'str'` / `tap-text '<regex>'` | input on display 0; `tap-text` taps an Android view by its text (uiautomator) |
| `$L $I sh '<cmd>'` / `su '<script>'` / `adb <args>` | shell / root shell (userdebug `su`) / adb, pinned to the serial |
| `$L reap` | stop idle lane instances now |

The lane's own hermetic test, with a fake ssh and no Ruiko or emulator (list states, dropped connections, create / up / delete /
provision refusals): `scripts/aemu-lane/test-state.sh`.

Examples:

```
$L --agent $ME $I status | jq '{booted,shizukuRunning,adb}'
$L --agent $ME $I shot /tmp/f1.png all          # /tmp/f1-inner.png, /tmp/f1-cover.png
$L --agent $ME $I notice push '{"title":"Lane test","text":"hello","id":"lane:1"}'
$L --agent $ME $I shade /tmp/shade.png
```

## Shizuku and ADB, the phone's way

- adbd runs as the **shell user**, as on the phone. The lane never uses `adb root`: restarting adbd as
  root would kill Shizuku. Root things (cutout overlay, `kill -9`, `tc`, app data) go through the
  userdebug image's `su`: `$L $I su '<script>'`.
- Shizuku 13.6.0 (`~/.cache/claude-run/aemu-lane/shizuku-13.6.0.apk`, sha256
  `6e273ab0e991c4e79bc8b1bbb9b9dd739ccac1a8712a541a214078886b7b790f`, from
  `github.com/RikkaApps/Shizuku/releases/tag/v13.6.0`) is started by the shell user running the starter
  from the package's lib dir: `<lib>/x86_64/libshizuku.so`. This is what the Shizuku app's "View command"
  shows. `$L $I shizuku start` does it.
- The permission is granted the way the user does it: the page's Shizuku applet "Allow Access"
  (`AndroidApplets.action('shizuku','allow','')` over CDP) opens Shizuku's own dialog, and the lane taps
  "Allow all the time" with uiautomator. `$L $I shizuku grant`.
- `adb tcpip 5555` makes the guest listen on 5555 for the app's local ADB (`LocalAdb`, 127.0.0.1:5555).
  **Order matters: restarting adbd (tcpip, usb) kills Shizuku**, so `provision` does tcpip first, then starts
  Shizuku. This is the same on a phone.
- Wireless debugging: `settings put global adb_wifi_enabled 1`. Android asks "Allow wireless debugging on
  this network?" once: the lane taps "Always allow" + Allow.

## What survives a reboot

`$L $I reboot` is a clean guest shutdown (`svc power shutdown`) and a cold boot of a fresh emulator process. The AVD's
disk is kept, so everything the phone keeps in `/data` is kept. Nothing is set up again (`up --nosetup`: only the
quiet volumes). Why not `adb reboot`: inside the running emulator process it leaves adb's transport flapping `offline`
a minute after the guest is back (seen on `aemu-a53-1` and `aemu-fold-1`).

Measured on `aemu-a53-1` after a reboot (real `status` output, 40 s boot):

| thing | after the reboot |
| --- | --- |
| Shizuku server | **gone** (`shizukuRunning: false`), as on the phone. Start it again with `shizuku start` or let the app do it |
| guest adbd on 5555 | **listening** (`listening5555: true`) with `service.adb.tcp.port` and `persist.adb.tcp.port` empty: see "5555 on the emulator" |
| wireless debugging | **off** (`adbWifiEnabled: 0`), as Android does after a restart |
| the app | not started by Android by itself within 40 s (`appPid: null`, the stock launcher in front). The phone starts it as the home app. Open question for part B (boot receiver / home role), not a lane setting |
| test-device mark, partnership, golden snapshot | kept (server side and userdata) |

### 5555 on the emulator (read this before a reboot test)

The emulator's guest adbd **always listens on `*:5555`**, even right after a boot with no tcp port property. That is
the listener the host's adb link uses: `adb tcpip 5556` moves it and the instance goes `offline`. So "5555 is
back after a reboot" is true on the lane whatever the app does, and proves nothing about a phone.
What can be proven on the lane: Shizuku is gone after a reboot, the app's restore logic runs, the refusal of
`setprop service.adb.tcp.port` by the shell user on Android 17 (fold instances), the Wireless-debugging door.
`$L $I adbd gate on` is a **manual shim**: it rejects connections to 5555 on the loopback interface only (the app's
`127.0.0.1:5555`), the host link keeps working, so the app sees a closed port. `gate off` opens it. The gate is not
automatic and is lost at the next boot. The iptables calls need a root with network capabilities: if they answer
"Permission denied" the status says `appSees5555Closed: false`.

## Prove a notice

1. Take a mark: `NOW=$($L $I now | jq .localMs)`.
2. `$L $I notice push '{"title":"x","text":"y","id":"lane:x","data":{"kind":"test"}}'`
   (the answer says `sent`).
3. `$L $I notifs`: the Android notification of the app (title, text, channel, importance).
4. `$L $I shade /tmp/shade.png` and read the PNG: the notice is in the shade.
5. `$L $I sound --since $NOW`: JSON of the sounds since then.

`sound` sources, strongest first:

1. **`NoteAlerts:` lines of the app** (`ringer N, sound <file>?v=<sha256 prefix>` and `playing <file>`).
   The app names the file and the sha it played. This is the authoritative source (memory #316).
2. `AudioPlayerStateMonitor` / `AudioService` lines in logcat main: `state:started usage=USAGE_NOTIFICATION`
   for the app's uid. Android saw a player start.
3. `notification_alert` in `logcat -b events`: the system sounded / vibrated / blinked.
4. `dumpsys audio` playback activity: players running right now.

Real audio (a WAV of what was played) is **not captured**: the emulator is always started with
`-no-audio`, so nothing can reach Ruiko's speakers, and this emulator build has no file audio backend
(`-audio <backend>` offers only `none`; the legacy `QEMU_AUDIO_DRV=wav` is not in 37.2.13). Plan: a debug
sound probe in the app and an AudioRecord of the remote submix in the guest; until then silence and a
sound are told apart by the four log sources above.

## Reproduce each phone situation

| situation | commands |
| --- | --- |
| unfolded / folded / half-open | `posture open` / `posture closed` / `posture half` |
| cover screen | `shot out.png cover`; `posture closed` |
| DeX / NexDock (external display) | `display add-external 1920x1080@160`, `shot out.png external`, `display remove-external` |
| page killed (app alive) | `kill-page` |
| app killed | `kill-app` (root `kill -9`); `stop-app` = force stop |
| another program in front | `other`; back with `home` / `start-app` |
| Doze | `doze on`, `doze off` |
| network down / hung / slow / flaky | `net off\|hang\|slow\|flaky`, back with `net on` |
| reboot | `reboot`, then `status` and the table below |
| Shizuku down | `shizuku stop`; up again with `shizuku start` |
| 5555 down | `adbd usb` (also kills Shizuku); up with `adbd tcpip` then `shizuku start` |
| rotation | `rotate 0..3\|auto` |
| a fresh app build | `install-release` (newest) or `install-release <id>` |
| clean state | `reset` (boots `golden`) |

## What is shimmed or not real

- The emulator's adbd has `ro.adb.secure=0`: no "Allow USB debugging?" RSA dialog ever appears for the
  app's key (the phone shows it once). The lane cannot test that dialog.
- The app starts Shizuku over 5555 from `lib/arm64/libshizuku.so`; the emulator package has `lib/x86_64`.
  `provision` adds a symlink `lib/arm64 -> x86_64` so that route works. Plan: the app asks for the ABI dir.
- `Build.MODEL` is `sdk_gphone64_x86_64`, not `SM-F966`. The camera cutout comes from the overlay. Plan: DSApp
  emulator shims (`ro.boot.qemu=1` only) for Samsung-only paths: DeX `semDesktopModeEnabled`, One UI notification
  look, `Build.MODEL` family. Part after A1.
- The cover screen is the emulator's second built-in display (it runs the AOSP secondary-display launcher).
  A "closed" fold resizes logical display 0 (`wm size`) and moves the hinge sensor, as `scripts/fold7-emu.sh`.
  There is no device-state table, so Android does not switch displays by itself.
- No cellular modem, car Bluetooth, car key or geofence (DSApp has the emulator-only `TestLaneReceiver`,
  `aemu.sh drive` / `fix` in `~/.config/aemu`).
- The page of every lane instance is signed in as the household admin on the live server (dev-login). Its
  notices are fenced (test lane), its page broadcasts are not: never tap a household box there.

## Gotchas

- **An emulator that booted but adb does not list it** (`emulator-<port> not found`, or `offline` for ever): Ruiko's adb server was restarted
  after the emulator started, or was not up at its start, so the emulator's own registration is lost. Do NOT stop the process
  (that kills a boot another agent is waiting for). `wait_boot` and `status` register it again: they send the server's smart socket
  `host:emulator:<console port + 1>` through the instance's own tunnel, which is what the emulator does at its start. **Not yet proven
  on an unlisted booted emulator** (one try by hand on `aemu-fold-1` at 23:23 sent the line, got an empty answer and the serial
  stayed unlisted 4 s later; that instance was stopped by its next holder before it could be tried again). Only when the register
  call does not bring it back is the process stopped and started again (`up` does that after waiting 240 s for a boot in progress).
- **A tunnel that forwards an old console port.** The tunnel (`ssh -L <tunnel>:5037 -L <console> -L <cdp>`) is one per instance and is
  kept across commands. An instance that moved ports (fold-1 left console 5600 for its pool row 5556) kept a tunnel to 5600, so every
  console command failed. `tunnel()` now checks the ssh command line against the pool row and replaces it.
- **One agent id can hold a lease several parts asked for.** Parts of one planner session share one coord id, so a queue row asked for
  by part B is granted to "you" in another part. Read the row's `why` (`coord_devices`) before you drive an instance, and never run a
  retry loop of `up` or `create` on an instance whose lease is not clearly yours: `up` stops a process adb does not list.
- **After `reset`, or after a reboot test, the app's local-ADB port may be 5556.** The reboot test (`tests/reboot-recovery.sh`) moves it
  because the emulator's own adbd always listens on 5555. `reset` puts it back to 5555 (`appPort5555Restored` in its answer); by hand
  `lane.sh <id> app-port`.
- **Ruiko's CPU is the bottleneck, not its memory.** Two legacy emulators of other sessions (`fold7-test` 5570 and `DSFold7` 5580)
  take about 22 % of the machine each, a Gradle build 10-30 %, one lane instance about 22 %. With those running `lane.sh up` answers
  exit 5 for an hour (CPU mean 94-100 %, limit 85 %). Nothing in the lane may raise the guard on its own; the agent that needs the
  instance asks the planner, or waits.

- **A first provision needs the app's ~211 MB page pack and fails while Ruiko is saturated.** At 100 % CPU the guest
  pings its host at 300-500 ms and the download crawls (35 KB/s) or ends in "Couldn't download updates"; the server also
  rebuilds the pack on every publish. `provision` presses RETRY by itself and waits up to 25 minutes; when it still fails,
  stop other instances and run `lane.sh <id> provision` again (it is resumable, nothing is installed twice).
  `create` saves `golden` only after a provision that succeeded.
- **Closed posture shot is black.** After `posture closed` the capture of display 0 (resized to 1080x2520 with `wm size`)
  is black on `aemu-fold-1`; the cover display (`shot out.png cover`) shows only the secondary launcher, not the app.
  Not solved: part of the open "fold" shim (see the plan for a debug-build shim).
- First start of the app downloads and installs about 8,000 files. It takes 5-10 minutes on the emulator.
  "Software updated 100%" can sit for a minute or two (the page tops up files published meanwhile).
- `adb forward` goes to Ruiko's shared server: `lane.sh` forwards only its own CDP port.
- The status bar's cutout is the Fold7's, not the A53's hole.
- The console token (`~/.secrets/aemu-console.token`) is Ruiko's. `lib/con.py` talks to the console through
  the tunnel. `avd snapshot save` takes 10+ seconds.
- The server must be told about a new `POST /api/test-devices/:id/notice` route with a restart
  (modules/testDevicesRoute.js is not hot-reloadable). Until then `notice` uses the live routes: store
  without the live send (`mode: get`), then `POST /api/test-devices/:id/catch-up` for that device.
- A53 companion: the real A53 test phone (`~/.config/a53/a53.sh`, coord id `a53`, PIN in
  `~/.secrets/ruiko-windows-pin.token`, memory #300) is the agents' own phone. Use it for real-Samsung
  evidence after the lane, request it with `coord_device_request a53`, and release it.
- **A create that died midway.** When the first boot of a `create` fails, it leaves an AVD without `golden`: `list` shows
  state `created` (or `partial` when the files were not all copied), and `up` / `provision` of it may fail. Run
  `lane.sh create <shape> <n>` again: it finishes the instance (skips making the AVD, boots, provisions, saves `golden`) and
  answers `"resumed": true`. To start over instead: `lane.sh <id> delete --yes`, then `create`. `provision` and `golden` on
  an instance that is not running say so ("is not running: lane.sh <id> up first") instead of failing late. A start that
  launches no emulator process (`start.cmd` ran, nothing appeared within 30 s) is reported at once and `up` tries a second
  start. `up` on an id whose emulator process is already starting waits for it (up to 4 minutes): after a shell timeout during
  a slow first boot run `up` again, it does not kill the boot.

## Example acceptance: #1272 (a text notice sounds with the event's sound while the page is killed)

**Status: written, not yet run (Nov 27 2026 00:15).** This is the shape every later phone acceptance copies: one instance, one lease,
one script, evidence files, PASS / FAIL per check. Replace step 3 (the notice) and the asserts; keep the rest.

```
# 1. the instance (coord: the real id, one at a time; see "Check out an instance")
node -e 'require("/home/kanmi/staticforge/modules/agentCoord/deviceQueue").request("<your id>","aemu-a53-1",{minutes:40,why:"#1272 acceptance"})'
export COORD_AGENT_ID=<your id>; L=scripts/aemu-lane/lane.sh
$L aemu-a53-1 up                       # exit 4 / 5 = Ruiko is short of memory / CPU: wait, never raise the guard
# 2. the whole acceptance, evidence in /tmp/accept-1272-<id>-<time>/ (or --out DIR)
scripts/aemu-lane/tests/accept-1272.sh aemu-a53-1
# 3. down + release
$L aemu-a53-1 down; node -e 'require("/home/kanmi/staticforge/modules/agentCoord/deviceQueue").release("<your id>","aemu-a53-1")'
```

What `accept-1272.sh` runs, by hand (so a failing step can be run alone):

| step | command | what it must show |
| --- | --- | --- |
| page killed | `$L $I kill-app`, then `sh 'pidof jp.net.seventhreeseven.dreamscape'` until a pid is back | the app restarted for its services only: a pid, no `sandboxed_process` / `webview_service`, no activity of the app in `dumpsys activity activities` (`topResumedActivity`), `$L $I cdp` finds no page; server: `GET /api/test-devices` says `service: true, pageInFront: false` |
| mark | `NOW=$($L $I now \| jq .localMs)` | the server's clock in ms |
| one text | `$L $I notice push '{"id":"sms:lane-acct:lane-chat-1272","cls":"sms","app":"messaging","alert":true,"title":"New Text Message","text":"From: ...","actions":["reply"],"data":{"app":"messaging","kind":"sms","accountId":"lane-acct","chatGuid":"lane-chat-1272","from":"...","text":"..."}}'` | `POST /api/test-devices/<device id>/notice`: stored in the test lane, then that device's catch-up only (`sent: 1`). The real shape (`cls: sms`, `data.kind: sms`, id `sms:<account>:<chat>`) is what makes the app take the TextMessageNotifier path and what lets the server clear remove its Android notification (memory #316) |
| shade | `$L $I notifs`, `$L $I shade shade.png` | the app's posted notification (channel `text_messages_wm`); read the PNG: the text is in the shade |
| sound | `$L $I sound --since $NOW` | `count: 1` (exactly one decision), `sounds[0].file` is the sms event's sound as the page chose it (the default `online.mp3`; never `Alarm*`), `alarmLikeStarted: 0`. The lane runs `-no-audio` with the ringer silent, so the app logs what it would play (`NoteAlerts: sms: ringer 0, sound online.mp3?v=<sha256 prefix>`) and plays nothing: the decision line is the proof, as on the A53 (memory #316) |
| server clear | `$L $I notice clear sms:lane-acct:lane-chat-1272`, then `notifs` and `shade` again | `{"success":true}`, the notification is gone from `notifs` and from the shade |

## The A53, our real Samsung

The A53 (Galaxy A53 5G, SM-A536U1, Android 16, serial `R5CT71TSEMZ`, ActiveSync id `ba8e2f6edacbc667c87f18bae8683798`
"A53 Test", Custodian name Marine / `dev`) is the agents' own phone (`fold-off-limits.mdc`, Yukimi Nov 26 2026: "you can
break it, that's up to you to fix"). No state of it needs Yukimi: not a reboot, Wi-Fi gone, a new address, adb lost, a
locked screen, a crashed app. Every row below was run for real on Nov 27 2026 (StaticForge #1309 part D, output in #1312).

Take it like any device: `coord_device_request a53` (one agent at a time, never asks Yukimi), release it with
`coord_device_release`. Driver: `scripts/aemu-lane/a53/a53.sh` (server adb; every adb call is `-s` the phone and a
serial check `ro.serialno` runs before anything else, so a reused address never reaches another phone; every perceptible
command refuses unless your agent id holds the lease: env `A53_AGENT=claude-<id>`). The older `~/.config/a53/a53.sh`
(Ruiko's adb, CDP tunnel, taps) stays for UI work.

```
A=scripts/aemu-lane/a53/a53.sh
$A status      # link, boot, lock, Wi-Fi, battery, adb ports, MAC (needs the lease)
$A up          # climbs the ladder below until adb answers, then unlocks
$A unlock      # locksettings verify first, then wake + PIN (4 tries); the PIN is never printed
$A reboot      # verifies the PIN, adb reboot, follows the phone to a new address, waits, unlocks
$A tcp-off     # adb usb: adbd restarts without tcp (the state "5555 closed")
$A bt <args>   # the custodian CLI on MODERNIA, always --device dev (status, unlock, call wifi_enable '{}', tap X Y)
$A approve     # Custodian taps "Allow USB debugging?" over Bluetooth when this server's key is refused
```

### Two doors that need no person

1. **adb over Wi-Fi.** `5555` (the app re-arms it after a reboot, `LocalAdb.restore`, and the server can ask for it) and the
   **Wireless-debugging TLS port** (on, and this server's adb is paired with it: `adb connect <ip>:<tls port>` answers
   `device`). The shell user may NOT set `persist.adb.tcp.port` or `service.adb.tcp.port` on this phone (SELinux: "Failed
   to set property"), so 5555 cannot be made reboot-proof from adb; after a reboot `persist.adb.tcp.port` is empty and
   5555 still comes back (49-58 s) because the app / Custodian re-arm it.
2. **Custodian over Bluetooth** (the non-Wi-Fi path). The Custodian PC daemon (`pythonw -m custodian daemon`) runs on
   **MODERNIA** (Yukimi's PC, `ssh modernia`, Windows, default shell cmd: wrap in `powershell -EncodedCommand`; `a53.sh bt`
   does that). The A53 is paired with it (Marine, Bluetooth `A8:79:8D:F7:CC:69`); `dev.custodian.agent` is the phone's
   **device owner** (admin, accessibility, WRITE_SECURE_SETTINGS, battery optimisation ignored), the control policy is
   `allow` with no approval and no lease cap. Hard limits: on MODERNIA only the `custodian` CLI is run (no installs, no
   config, no daemon restart), EVERY call carries `--device dev` (`a53.sh bt` refuses a call that names a device; Marian
   is the Fold, off limits), control mode is not taken for these recoveries.
   Phone commands for `custodian call <cmd> '{}'`: `wifi_status`, `wifi_enable` (found by trying names; unknown ones answer
   `unknown command`). The PowerShell quoting turns `{"a":1}` into garbage: only `'{}'` arguments work through ssh.

### What brings it back, with what was run

| State | What brings it back, no person | Proof (Nov 27 2026) |
| --- | --- | --- |
| Screen locked | `$A unlock` (PIN over adb) or `custodian unlock --device dev` (Bluetooth, PIN stored in Custodian) | `input keyevent KEYCODE_SLEEP` -> `isKeyguardShowing=true Dozing`; `$A up` -> `unlock: unlocked`, `false Awake`; locked again, `custodian unlock` -> `"unlocked": true, "pin_entered": true`, `false Awake` |
| 5555 closed (`adb usb`) | the server rung: `adb mdns services` filtered to THIS phone's address and serial name, `adb connect <ip>:<tls port>`, `adb tcpip 5555` (`$A up` rung 2); `modules/deviceAdb.js` `tlsRestore` does the same (device-adb settings `autoRestore` + `tlsRestore` on for this device only, through `PUT /api/activesync/adb/<id>/settings`); the app alone also does it | `tcp-off` then `up` 3 s later: `rung 2 ... tls 192.168.100.240:43667 ... 5555 now: device` in 4 s; `GET ...?detect=1` after `tcp-off`: `state ready` in 4 s; the app alone (logcat): `NetIfaces: ADB is not listening on port 5555` 21:52:07, `Received WIFI TLS connected key` 21:52:15, 5555 back 21:52:18 (about 28 s) |
| Rebooted | 5555 re-armed by the app / Custodian (49 s), a new address followed by mDNS name, Custodian or `$A unlock` for the first unlock after boot (keyguard `strongAuth(1)`) | `$A reboot`: `+49s adb=device boot=1`, `phone is now at 192.168.100.240` (it had been .236), `unlock: try 1, still locked`, `unlock: unlocked (try 2)`; the first reboot logged `Custodian: session_opened {"transport":"bluetooth","pc":"MODERNIA"}` 5 s after the boot and a Custodian `unlocked` at +25 s (someone's unlock over Bluetooth; the next two reboots had none for 3 minutes, so do not count on it). The keyguard is not ready for the first seconds: `unlock` retries 4 times (the PIN is verified first, so a try is never a wrong guess) |
| Wi-Fi off / not joined | the phone is unreachable on the LAN; Custodian over Bluetooth re-enables it: `custodian call wifi_enable '{}' --device dev` (`$A up` rung 4 does it and waits for the phone on the LAN) | `cmd wifi set-wifi-enabled disabled`; ping down, no 5555, `custodian status`: `link bluetooth, wifi.enabled false`; `wifi_enable` -> `"enabled": true`; ping up 5 s later, `$A up` found it (`device`); then Wi-Fi off again and `$A up` alone: `rung 4 ... Wi-Fi is disabled ... back on the LAN at 192.168.100.236 ... up: ok` (the first `up` attempt failed on a stale mDNS entry and an old adb transport; both fixed in the script) |
| New address / other SSID | the phone is found by its own mDNS name `adb-R5CT71TSEMZ-...` (the address must answer ping: mDNS keeps an entry of a phone that left); its MAC is random per SSID, so the ARP/MAC fallback is the weak one | after a reboot it was on SSID "Radio Noise" at `.236`, not "Radio Noise AX" at `.240`; found by name, serial checked, adb `device`; the next reboot it was back at `.240` and followed again |
| adb key refused ("unauthorized", the phone asks "Allow USB debugging?") | Custodian over Bluetooth: unlock, tap "Always allow" (146,2126), tap Allow (752,2257) on the 1080x2400 screen (`$A approve`); no adb needed | a throwaway adb server (own key, own port 5099) -> `device unauthorized` and the dialog on screen; `custodian tap 146 2126` -> `checked="true"`, tapped again -> `false` (no junk key kept), `custodian tap 752 2257` -> the throwaway key `get-state: device`, ran a command as `shell`; the throwaway server was killed by pid |
| App stopped / crashed | the app restarts itself (foreground services, notification listener): `am force-stop` -> pid back with 2 foreground services within 25 s. `am crash` does nothing on this app | `force-stopped: pid='' fgsvc=0` then `+25s pid='10421' fgsvc=2` |
| Battery low | it sits on AC (`AC powered: true`, 53% -> 90% during the run); Custodian is configured to report `battery_low` (15) and `battery_critical` (5). A fully dead battery needs a power button, which no software reaches: keep it charging, never run a test that drains it | only observed |

Not run on purpose: a revoked key on every channel at once (would need the key files on the phone), a router change to a
third SSID (no third network), the battery at 0%.

### One-shot Wi-Fi timer (test harness, kept but no longer needed)

Before Custodian was found, `$A deadman <sec>` was the plan for a Wi-Fi-off test: ONE shell on the phone,
`setsid nohup sh -c 'sleep <sec>; cmd wifi set-wifi-enabled enabled'` (no loop, no polling, no wakelock, no notice;
one pid file it removes). `$A deadman-selftest` proved it outlives the adb link going down (`selftest: OK, the timer fired
with the link down`). Custodian replaces it as the way back; a permanent on-phone version would be app code.

### Left as found / careful

- Volumes, ringer and `stay_on_while_plugged_in` (15, set by someone else) are not touched; nothing sounds.
- Custodian control mode is never taken for these recoveries; `custodian status` shows `control.active false`.
- `$A status` writes `A53_MAC` and `A53_IP` to `~/.config/a53/a53.env`.
- When this does not hold: the one case no software covers is a battery at 0% (power button). Ask Yukimi only then.
