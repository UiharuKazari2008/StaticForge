# The emulator lane

Phone acceptance runs on Android emulators on Ruiko, not on Yukimi's phones (StaticForge #1309, #1312).
The lane is a pool of Fold-shaped and A53-shaped emulators. Each one has the app, Shizuku, its own
test-device id and a golden snapshot. One agent holds one instance at a time, through coord.

Driver: `scripts/aemu-lane/lane.sh`. One command per action. Answers are JSON.

**Status (Nov 26 2026, first version):** proven on `aemu-fold-1`: create / up / provision / golden / status / shot /
Shizuku as shell / 5555 / partner / fence. Rows marked (todo) below are written but not yet proven or not built
yet: `display add-external`, `keep`, the closed-posture shot, `sound` end to end, `reset`, `reboot` facts, the
A53 shape, the `-2` instances. This page is updated as each is proven.

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
| `aemu-fold-1` | fold | 5600 / 5601 | 15101 | 9381 | 17 (API 37, google_apis x86_64, userdebug) |
| `aemu-fold-2` | fold | 5602 / 5603 | 15102 | 9382 | 17 |
| `aemu-a53-1` | a53 | 5610 / 5611 | 15111 | 9391 | 16 (API 36, google_apis x86_64, userdebug) |
| `aemu-a53-2` | a53 | 5612 / 5613 | 15112 | 9392 | 16 |

- **fold**: inner display 1968x2184 at 360 dpi, cover display 1080x2520 as a second built-in display,
  hinge sensor, the Fold7 camera cutout (fabricated overlay, as `scripts/fold7-emu.sh`).
- **a53**: one display 1080x2400 at 420 dpi (411x824 CSS at 2.625, memory #3).
- At most 4 run at once (48 GB RAM on Ruiko). An instance nobody used for 30 minutes is stopped by
  `ruiko/reap.ps1`, run by the Ruiko scheduled task `aemu-lane-reap` every 10 minutes (and by `lane.sh reap`).
  Every `lane.sh` command refreshes the idle clock. Long quiet work: `lane.sh <id> keep 60`.
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
| `$L list` | every id: created, running, golden, lease holder |
| `$L create fold 1` | make the AVD, boot, provision, save `golden` (10-20 minutes the first time) |
| `$L $I up [--golden]` | cold boot (state kept), or boot from the golden snapshot |
| `$L $I down` / `status` / `wait-boot [secs]` | stop / one JSON with everything we know / wait |
| `$L $I provision` | the setup steps of `create` again (idempotent) |
| `$L $I golden` | save the snapshot `golden` of the running state |
| `$L $I reset` | stop, boot from `golden`: the instance as it was when it was saved |
| `$L $I reboot` | `adb reboot`, wait for boot. Nothing is set up again (see "What survives a reboot") |
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
| `$L $I adbd status\|tcpip [port]\|usb\|wireless on\|off` | the guest's adbd: 5555, wireless debugging |
| `$L $I cdp` / `eval '<js>'` | the page's DevTools pages / run JavaScript in the page |
| `$L $I tap X Y` / `key KEYCODE` / `text 'str'` / `tap-text '<regex>'` | input on display 0; `tap-text` taps an Android view by its text (uiautomator) |
| `$L $I sh '<cmd>'` / `su '<script>'` / `adb <args>` | shell / root shell (userdebug `su`) / adb, pinned to the serial |
| `$L reap` | stop idle lane instances now |

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

`$L $I reboot` is a real guest reboot (`adb reboot`). Nothing is set up again. The table is filled from a
real run (see the "Reboot facts" section at the end).

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

## The A53, our real Samsung

The A53 (Galaxy A53 5G, SM-A536U1, Android 16, `192.168.100.240`, ActiveSync id `ba8e2f6edacbc667c87f18bae8683798`
"A53 Test") is the agents' own phone (`fold-off-limits.mdc`, Yukimi Nov 26 2026: "you can break it, that's up to you
to fix"). No state of it needs Yukimi: not a reboot, Wi-Fi gone, adb lost, a locked screen, a crashed app, a low
battery. This section says what brings it back in each state, with no person. Status line per row: **proven**
(run on the phone, output in #1312) or **not proven yet**.

Take it like any device: `coord_device_request a53` (one agent at a time; it never asks Yukimi), release it with
`coord_device_release`. The driver is `scripts/aemu-lane/a53/a53.sh` (server adb, every call pinned to
`192.168.100.240:5555`, the perceptible commands refuse unless your agent id holds the lease). The older
`~/.config/a53/a53.sh` (Ruiko's adb, CDP tunnel, taps) stays for UI work.

```
A=scripts/aemu-lane/a53/a53.sh      # env A53_AGENT=claude-<id> (or COORD_AGENT_ID)
$A status      # link, boot, lock, Wi-Fi, battery, adb ports, MAC (stored in ~/.config/a53/a53.env)
$A up          # climbs the ladder below until adb answers, then unlocks
$A unlock      # locksettings verify first, then wake + PIN; the PIN is never printed
$A reboot      # verifies the PIN, adb reboot, waits with progress, unlocks
```

### What brings it back (the ladder)

| State | What brings it back, no person | Status |
| --- | --- | --- |
| adb is up, screen locked | `$A unlock`: `locksettings verify --old <PIN>` (a wrong guess counts toward the lockout, so never type before it verifies), wake, swipe, type the PIN, Enter; `isKeyguardShowing=false` | not proven yet |
| Rebooted | adbd listens on 5555 again by itself (the app's own recovery, `LocalAdb.restore`, over the Wireless-debugging TLS door; and `persist.adb.tcp.port` if the shell may set it); `$A reboot` waits for `sys.boot_completed`, then `$A unlock` (first unlock after boot needs the PIN) | not proven yet |
| 5555 closed, phone on Wi-Fi | server adb asks adbd for `tcpip:5555` over the phone's Wireless-debugging TLS port (`adb mdns services` filtered to the phone's own IP, never other devices): `$A up` rung 2, and `modules/deviceAdb.js` `tlsRestore` (device-adb settings `autoRestore` + `tlsRestore` on for this device only) | not proven yet |
| adb key refused ("unauthorized") | the second channel approves it: Ruiko's adb key is also allowed, `$A up` rung 1b taps "Always allow" through it (uiautomator) | not proven yet |
| Wi-Fi off / phone not at its address | the server cannot reach it; Wi-Fi comes back by itself only when an agent's own test armed the one-shot timer (below) or the app does it; a new address is found by the phone's MAC in the ARP table (`$A find`) | not proven yet |
| App crashed | `adb shell am start` of the launcher activity; the app's boot receiver brings the services back | not proven yet |
| Battery low | it sits on a charger (AC, Wi-Fi charging off); `$A status` shows level and charging. Only a fully dead battery needs a power button: the one case no software path covers, so keep it charging and below no test that drains it | note |

### One-shot Wi-Fi timer (test harness, not a feature)

A Wi-Fi-off test must come back by itself. `$A deadman <sec>` starts ONE shell on the phone:
`setsid nohup sh -c 'sleep <sec>; cmd wifi set-wifi-enabled enabled'`. No loop, no polling, no wakelock, no notice,
nothing left on the phone but a pid file it removes. Keep the screen on during the test
(`$A keepawake on`, and `off` afterwards: other agents' tests look at screen-off behaviour, so it is never left on).
`$A deadman-selftest` first proves the timer outlives the adb link going down. A permanent version (Wi-Fi back by
itself after a change that leaves the phone off the LAN) is app code (`WifiControl`), not a shell script on the phone.

### Custodian / Bluetooth: not available, and what it would take

The custodian-phone skill assumes a Custodian PC daemon paired over Bluetooth. On Nov 27 2026 it does not exist
here: there is no `custodian` module, CLI or daemon on the Dreamscape server or on Ruiko (searched both), the server
has no Bluetooth adapter (`/sys/class/bluetooth` is absent), and Ruiko's USB Bluetooth dongle is paired with the Fold7
and an Xperia, not with the A53. So Custodian is not a fallback today. What it would take: one USB Bluetooth adapter on
the server (or the Custodian daemon on Ruiko, whose dongle then pairs with the A53), the Custodian app on the A53
(`dev.custodian.agent` was seen installed on Nov 14), the daemon, and one pairing on the phone. That is a physical
step; it is only worth asking for if the Wi-Fi/adb paths above cannot cover a state.
