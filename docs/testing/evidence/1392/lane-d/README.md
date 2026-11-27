# StaticForge #1392, part D: the user paths the window-read change touched, release 42 on aemu-fold-2

Run Nov 27 2026 from 17:00 local. Instance `aemu-fold-2` (Android 17 / SDK 37, `-no-audio`). Release 42 = versionCode
**3632928** (APK sha256 `3981b1fd...`, includes `fix/1392-windows-off-main` `7bfd4d9e`). Control: release 40 = 3632839
(without the fix). Change read: `git diff 1350e0d..7bfd4d9e -- app/src/main`.

## Results

| # | path | result |
|---|---|---|
| 1 | PIN unlock on Melaton's cover by real taps, shell available (3 runs, and 1 after a wrong PIN) | **PASS** 4 of 4: really unlocked, Android Settings back in front, 5.8-6.8 s after the last tap |
| 1 | wrong PIN | **PASS**: no unlock, one attempt counted, cover steps aside, no crash; the next correct one unlocks |
| 1 | PIN unlock with no shell (accessibility clicks, `clickKeys`) | **FAIL** 3 of 3 on release 42: digits typed, OK never pressed. **Release 40 fails the same way (2 of 2): not caused by this change** |
| 2 | locked restart woken about 3 s after the new process, on a quiet host | **NOT TESTABLE** in this run: Ruiko was never quiet |
| 3 | soft keys Back and Home over Android Settings | **PASS** (Back in portrait and landscape). The branch where Melaton itself is in front under the bar was not exercised |
| 3 | volume key: Melaton's volume box on the phone screen | **PASS** 3 of 3 (first press: its key-up reached Android about 0.5 s later, changing nothing) |
| 3 | a bar popup opens and closes | **PASS** |
| 3 | Melaton Bars off and on again | **PASS** 2 complete cycles (a third was cut off after "off" by a client update): no window left over, none doubled, button row released and held again |
| 3 | rotate and back | **PASS** |
| 4 | DeX desktop window on a second display | **PARTLY**: a desktop window there gets the window bridge (`AndroidWindows.list()` answers `ok:true`); **taskbar listing and click NOT TESTED** |

**For the merge:** no path that was run broke because of the change. Not covered: test 2, a taskbar click, the
"Melaton in front under the bar" tap branch, and any real phone (One UI's PIN pad).

## 1. PIN unlock on Melaton's lock screen

Setup (all undone afterwards): page on Windows Mobile 6.5, bars setting `lockScreen` on, saved copy `lock-1968.json`, throwaway
PIN 1234 with a guest timer that clears it (`tools/pin-guard-guest.sh`). Every unlock is real touches on Melaton's own
window (`tools/pin-guest.sh`): `input swipe` on the slide, `input tap` on the four keys, `input tap` on its OK (open
padlock) key, at the key rectangles of the saved copy. The route is told by the app's own log: a shell that fails logs
`shell failed (input)` and the app clicks the keys through accessibility; a shell that works logs nothing (here the app's
preferred shell is local ADB, then Shizuku). The trace agrees:
in the shell runs that were traced, the app's main thread sent **no** accessibility action.

All offsets are seconds from the start of the guest's `input tap` on the OK key (the command returned 30-50 ms later in the
release 42 runs, 116-180 ms in release 40 runs 3 and 1). "unlocked" = `deviceLocked=0`, polled every 0.2 s. CPU = Ruiko's mean just before the run.

| run | release | shell | CPU | PIN pad asked | PIN checked | keyguard gone (WM) | unlocked | verdict |
|---|---|---|---|---|---|---|---|---|
| pin-shell-1 | 42 | yes | 74 % | +1.71 | +3.70 | +6.35 | +6.60 | **PASS**, Android Settings back in front |
| pin-shell-2 | 42 | yes | 76 % | +1.59 | +3.08 | +5.69 | +5.89 | **PASS**, same |
| pin-shell-3 | 42 | yes | 80 % | +1.76 | +3.76 | +6.67 | +6.80 | **PASS**, same |
| pin-wrong (9999) | 42 | yes | 77 % | +1.59 | +3.03, refused | - | not unlocked | **PASS**: 1 check, `numFailedAttempts=1` |
| pin-after-wrong | 42 | yes | 81 % | +1.67 | +3.33 | +5.58 | +5.84 | **PASS**: next screen off/on shows Melaton's cover again, it unlocks |
| pin-noshell-1 | 42 | no | 70 % | +1.69 | **never** | - | no | **FAIL** |
| pin-noshell-2 | 42 | no | 64 % | +1.62 | **never** | - | no | **FAIL**, `pinEntry` shows `••••` |
| pin-noshell-3 | 42 | no | 83 % | +1.71 | **never** | - | no | **FAIL**, `pinEntry` shows `••••` |
| pin-r40-noshell-1 | **40** | no | 96 % | +1.78 | **never** | - | no | **FAIL the same way**, `pinEntry` shows `••••` |
| pin-r40-noshell-3 | **40** | no | 93 % | +1.63 | **never** | - | no | **FAIL the same way** |
| pin-r40-noshell-2 | 40 | no | 95 % | - | - | - | no | not counted: my slide did not register, so no PIN was entered (cause not established; the tool's swipe was made longer, and run 3 registered) |

After the PIN is accepted, most of the rest is Android's own unlock (StartUnlock to keyguard gone: 2.0-2.7 s).

In every release 42 and 40 run above: **no** "no PIN pad", **no** "window read took", no "window scan failed", no ANR, no
crash. The app's process id did not change within the release 42 runs (18716).

**Pad looks off main.** In the traced release 42 runs the longest burst of one `window-read` lane was 167-720 ms
(`pin/*/pin-trace.txt`), against the 1500 ms a look may take (`MelatonLock.PAD_MS`, line 395). The worst, 720 ms, was at a
host load of 77 %. A look slower than 1500 ms is dropped; no run got there. The lane cannot say what a real phone takes.

**Wrong PIN.** `LockSettingsService: Verifying lockscreen credential`, `gatekeeperd: verify transaction failed`,
`reportAuthAttempt: numFailedAttempts=1`. 17 s later: still locked, Melaton's cover hidden (it stepped aside), Android's
lock screen window up, same process. That window is `FLAG_SECURE`, so the screencap is black; its "Wrong PIN" text was not
read.

### Without a shell the phone is not unlocked: release 40 does the same (not caused by the change)

Shell made unavailable with the app's own setter (`AndroidActiveSync.setAdbSettings`: `allow`, `autoRestore`,
`shizukuAutoStart`, `shizukuRecover` false) plus `lane.sh shizuku stop`; both restored afterwards.

- `W MelatonBars: shell failed (input)` about 2.7-3.0 s after the tap, so the app took `clickKeys`.
- The four digits arrive: Android's bouncer read afterwards says `bouncer_primary_message_area text="Enter PIN"`,
  `pinEntry text="••••"` (`pin/pin-noshell-2/bouncer.txt`, `-3`, `pin-r40-noshell-1`).
- **Its OK key is never pressed.** The trace shows exactly four accessibility actions from the app's main thread (binder
  code 0x8 to system_server, each followed by system_server to SystemUI 0x6) and no fifth, on 42 (runs 1-3) and on 40 (runs
  1 and 3). No credential check follows. Melaton's cover steps aside; the person is on Android's PIN pad with four dots.
- What that points to: there was no OK node to press, so both `look.enter` (the look 350 ms after the digits) and the
  first look's `enter` were null (`MelatonLock.kt:513`; release 40: `pad(svc).second ?: enter`). The values themselves are
  not logged.
- Where to look (**inferred, not proven**): the only difference between how digits and OK are found is that OK needs
  `n.isVisibleToUser` (`MelatonLock.kt:427`, the same line as release 40's 416), while `key0..key9` are taken by id alone
  (`:424`). `key_enter` is there, clickable, in a `uiautomator` dump taken afterwards. Why it would read as not visible to
  this service (Melaton's own cover being over the bouncer, or a copy from the bouncer's appear animation) was not
  established.
- Smallest fix to try (outside #1392): take `key_enter` by its id as the digit keys are taken, without the visibility
  test; keep the test for the wider `ok_button|enter` pattern (`enter` also matches any id containing "center").
- Real phones: One UI's pad and its "OK without tapping" setting were not tested. The route is only used with no Shizuku
  and no local ADB.

### Seen on both releases, not part of the change

The PIN pad is asked for 1.6-1.8 s after the OK tap in **every** counted run, release 40 included. That matches the
**second** swipe (`waited in 1500..1650`, `MelatonLock.kt:463`), so the first one, sent right after `passThrough(true)`,
evidently does not bring the pad up. That the window flag has not taken effect yet by then is inferred. If so, about 1.5 s
of each unlock is this.

## 2. Locked restart woken early, quiet host: not run

The condition was Ruiko's CPU mean under about 60 % (`cpu-samples.txt`, the lane's own measure). From 17:01 to 18:43 exactly
**one** read was under it: 57 % at 18:24:40, in the middle of the DeX steps; the next one, 47 s later, was 77 %. A watch made
for this test, one read a minute from 18:29 to 18:41, read 94 98 99 99 99 96 72 86 99 100 99 97 %. Other agents' lane
instances (up to four beside this one), their builds and client updates were running. So nothing new is known about a wake
about 3 s after a restart on an idle host; part C's results (`../lane-r42/README.md`) stand as they were, and whether the
`MelatonLock` thread's decode is what the missing cover waits for is **still not established**.

Ready for a quiet host, **written but never run**: `tools/run-locked-wake.sh <name>` (part C's `run-one.sh` mode
`kill-wake` with `lock-guest.sh`, no `dumpsys` samples before the wake, and `thread-sample-guest.sh`: the app's thread dumps
at +4 / +8 s only, and the `MelatonLock` and main threads' CPU time every 0.2 s). It needs the setup of section 1.

## 3. Bars after the change, display on, over Android Settings

With the page alive the lane's page answers `extend-off` and Android's bars show (as found, and in part C's release 40
baseline). Melaton's bars were drawn two ways: after a process-only restart (`kill-app`, no page: the app's own drawing),
and with the page alive and hidden with this WebView's `localStorage wmCameraExtendBar=1` (as #1343 did; removed after).
Taps are `input tap` on what the screenshot shows. Log lines and window lists: `bars/excerpts.txt`.

- **Back** (`bars/softkey-back.jpg`): from Settings > Network & internet, `bar tap: soft-left`, `soft key left: back`, the
  Settings home page came back. Again in landscape (`.SubSettings` -> `.SettingsHomepageActivity`).
- **Home** (`bars/softkey-home.jpg`): `soft key right: home`, the lane's default home (Pixel launcher) in front.
  Each soft key tap goes through `melatonInFront()` first; here it answered "no", which is right. The "yes" branch (the tap
  handed to Melaton's page) was not exercised.
- **Popup** (`bars/popup-open-close.jpg`): a tap on the title bar's status icons opened the volume bubble; the same tap
  closed it; Settings stayed in front. No volume was changed by it.
- **Volume key** (`bars/volume-key.jpg`): sent through InputReader as root (`sendevent /dev/input/event13`, KEY_VOLUMEDOWN;
  `input keyevent` does not reach the key filter, shared memory 361), with the bars' `volumePopup` setting on for the test.
  `keys answered on binder:30826_6, not the main thread`, Melaton's box on the phone screen, 3 of 3 presses (so
  `focusOffPhone()` answered "no"; it also answers "no" when it gets no answer in 200 ms, which the lane cannot tell apart).
  Only "down" was pressed, with media at 2 and then 0, so that the app's volume beep (steps above 0 only) never played.
  First press after the process start: its **key-up** also reached Android (`dispatchVolumeKeyEvent ... ACTION_UP`,
  `Adjusting ... by 0`) 0.5 s after the press, the time after which Android lets an unanswered key go on (the comment at
  `onKeyEvent`). It changed nothing, did not happen in the two later presses, and was not compared with release 40. That the
  main thread was busy with the box's first draw is a guess.
- **Off and on** (`bars/toggle-cycle1.jpg`, `toggle-cycle2.jpg`; the page's own `AndroidBars.setConfig`): off leaves
  **no** Melaton window at all, the row holder gone and the status bar record released; on brings back the same set, each
  once (two `MelatonBar`, two `MelatonBarEdge`, the two probes, the hidden `MelatonLock`), `holder token linked ... Shizuku`,
  `locked=true`. `MelatonHomeStrip` (gone, `0x8`) is made only when needed and was not in the list right after "on".
  Two complete cycles (one before and one after the reboot below). In a third, "off" worked and the "on" call reached the
  update page instead (`AndroidBars is not defined`): the live site's client update had just replaced the app page.
- **Rotate** (`bars/rotate.jpg`, `rotate-logcat.txt`): rotation 1, bars across the full 2184 px, Back works; rotation 0,
  the same windows; then `rotate auto` (as found). In landscape there is no `MelatonLock` window (the app makes none without
  a saved lock copy for the width, and there was only the 1968 one); it was back in portrait.
- **Seen, not investigated:** the soft key bar is grey in some shots and black in others, also over the same Settings page
  (for example black right after the off/on of cycle 2, grey again after a program switch). The app decides a see-through
  soft key bar from the program's picture, and that decision flipped during these runs (`translucent soft key bar for
  com.android.settings: true / false`); whether it explains every shot was not checked, nor was release 40. Keys, places
  and taps were the same.
- No `FATAL`, ANR or app crash line in the logs read for these steps. The logcat of the first steps was lost with the
  instance; their lines were copied from the live reads into `bars/excerpts.txt`.

## 4. DeX paths: partly testable

- `lane.sh display add-external 1920x1080@160` made an overlay display (id 3; `setMultiDisplay not supported` on this
  image). Its only picture is Android's preview window on the phone screen.
- `MainActivity` is `singleTask`: moving the running one there keeps the phone's bridge (`AndroidWindows.list()`
  `ok:false`, "Only a desktop window on another screen ..."). After a process restart and `am start --display 3`, the page
  showed its "The display changed" screen; **Restart on this screen** (tapped with `input -d 3 tap`) gave the desktop page,
  1920x1080, and `AndroidWindows.list()` answered `ok:true, displayId:3, access:{service:true, shell:true}`,
  `can:{activate, minimize, close: true, minimizeVia: shell, closeVia: shell}`, `windows: []` (no program had been opened
  there yet, so this does not show that the follower's reads find one). No slow-read, ANR or crash line in the log then.
- **Not tested: the taskbar's list of programs and a taskbar click.** The Clock started on that display opened full screen
  over the desktop, and just then a client update of the live site replaced the page with `updater.html`. It was stopped
  there to leave the time for test 2. Alt+Tab and the DeX Start menu were not tried either.
- Two faults of the lane (`scripts/aemu-lane/lane.sh`, not edited): `display remove-external` does **not** remove an
  overlay display (line 994 puts an empty value, which `adb shell` drops); it was removed with
  `settings delete global overlay_display_devices`. And line 990 sets `force_desktop_mode_on_external_displays`,
  `enable_freeform_support`, `freeform_window_management` and `force_resizable_activities` to 1 and nothing sets them back.
  Android's settings history shows all four existed before this call; their earlier values were not read. Left at 1.

## The instance vanished at about 17:40 and came back at 18:10

- About 17:37: a `lane.sh shot` hung until its 200 s time-out; at 17:40 the app's DevTools did not answer and `screencap`
  failed; at 17:41 there was no emulator process. Ruiko's CPU read 99 % at 17:38 and 17:39.
- In the guest, read after the next boot: `system_server_pre_watchdog` at 17:40:30 and a watchdog dump at 17:40:06,
  `Blocked in monitor com.android.server.wm.WindowManagerService ... Blocked in handler on animation thread`. The lock's
  holder (`binder:847_1F`) was taking a **task snapshot** and waiting in SurfaceFlinger (`captureLayersSync`)
  (`instance-loss/system_server-anr-extract.txt`). `android.anim` and `android.display` waited for it. No `system_server`
  thread in that dump was in accessibility code.
- That is Android's own snapshot code waiting for graphics. **Inferred:** the emulator's graphics stalling on a saturated
  host, as part C saw in `lock-over-b3` (there the app's own render thread, in the GPU pipe). How the emulator process then ended is not established. Windows
  logged no crash event I found, the lane's reaper log says `stopped:false` for it at 17:38:45, and no agent had replied to
  my question about it.
- `lane.sh up` refused until 18:10 (CPU above 85 %, then too little free memory). The guard was not raised. After the
  boot: release 42, the app's settings kept (also "bars off" from the cut-off cycle, which was then turned on again).

## What was done to the instance, and the state left

- Installs: **one** downgrade to release 40 (`lane.sh install-release 3632839`) for the control and **one** back to
  release 42 (`install-release 3632928`; APK sha256 on the guest `3981b1fd...`, as before). Release 44 stayed staged and
  was never installed.
- Throwaway PIN 1234 set once, cleared by hand with `--old 1234` after test 1; the guard (re-armed once) was killed after
  that and never fired. `locksettings get-disabled` true, as found.
- Shell off and on again for the no-shell runs (settings back exactly as read before; Shizuku started again, app allowed).
- Media volume 2 -> 0 -> 2. Sound: the lane's check read 0 played, 0 alarm-like, over the volume steps and again for the
  time since the last boot. It cannot cover the log lost at 17:40. The emulator runs `-no-audio`.
- **Left** (18:43, `final-state.jpg`): running, display on, unlocked, **no PIN**, Android Settings in front, release 42,
  the bars' whole configuration equal to what was found (bars on, `lockScreen` false, `volumePopup` false), page on 6.1
  (`wmVersion` and `wmCameraExtendBar` removed), saved lock copy deleted, row held, Shizuku running, rotation auto, media 2,
  no external display, my guest files removed. Different from found: the four DeX global settings above stay 1 (they
  existed before), and the lane's marker `/data/local/tmp/lane-apk.sha` now names release 42 (it named release 40, stale
  since part C's self-update). The coord lease was **not** released.

## Files, privacy, tools

- `pin/<run>/`: `notes.txt` (the guest's times, keyguard and window states), `logcat.txt.gz` (cut by `tools/logcut.py`),
  `pin-trace.txt` (when each pad look ran), `bouncer.txt` (Android's PIN pad nodes, three runs),
  `shots-cover-keypad-after.jpg`. `pin/pin-summary.txt` has every run's numbers. `bars/`, `instance-loss/`,
  `cpu-samples.txt`, `final-state.jpg`.
- The `uiautomator` dump behind `bouncer.txt` unbinds accessibility services while it runs, so Melaton's cover comes back
  after it. `pin-r40-noshell-1/notes.txt` ends with a tap on Android's OK key that I added to the tool and removed again: it
  **proves nothing** (the tap landed on the cover that had come back).
- Log lines that could carry coordinates, notification text, names or network names are removed. Lock shots are redacted
  (Today picture a mosaic, unread count blacked out; only the keys and the entry bar kept on the keypad). No shot with
  personal content is kept. The raw shots, scheduler traces and full logs were in `~/.cache/claude-run/1392/partd/` and
  were deleted.
- `.gitignore` line 71 leaves out `tools/`: `git add -f` them. New: `pin-guest.sh`, `pin-guard-guest.sh`, `run-pin.sh`,
  `pin-summary.py`, `pin-trace.py`, `logcut.py`, `redact-pin.sh` (used); `run-locked-wake.sh`, `thread-sample-guest.sh`
  (never run). Changed, also not run since: `lock-guest.sh` (`none` = no samples), `host-sample.sh` / `.ps1` (instance
  name from `LANE_ID`).

## Planner's check (claude-974b3227, Nov 27 2026)

Checked against the files here, not taken from the report:

- Raw notes and logs of `pin-shell-1`, `pin-wrong`, `pin-noshell-2`, `pin-r40-noshell-1` and `-3`: the shell run checks
  the credential and unlocks; both releases without a shell log `shell failed (input)` and never check a credential.
- That the control really ran release 40: only the fixed build logs `first window look applied`. After the same
  `uiautomator` dump (which rebinds the service) `pin-noshell-2` (release 42) has the line, `pin-r40-noshell-1` has not.
- `git diff 1350e0d..7bfd4d9e -- MelatonLock.kt`: the visibility test on the OK key is the old line, unchanged. The fix
  moved the pad looks off the main thread and added "type nothing once unlocked".
- All 17 pictures viewed (the PIN shots as two sheets): no personal content; they show what the table says.
- Text and gzip files scanned for coordinates, network names, notification text, mail addresses and tokens: 0 hits.
- The instance afterwards: versionCode 3632928, no lock credential, keyguard not showing, no overlay display.

**Merged:** DSApp `main` = `3150722f` (the fix on `eb366dd7`), 785 unit tests, 0 failures (`../unit-tests.txt`). The
no-shell PIN failure is older than this change and is handed on as its own work.
