# Fold7 test emulator (Ruiko)

An Android emulator on Ruiko that behaves like Yukimi's Galaxy Z Fold7, so the Dreamscape app (DSApp) is tested there
and not on her phone (Nov 18 2026). Driver: `scripts/fold7-emu.sh`; checks: `scripts/test-phone-emu.js`.

## What it is

- AVD `fold7-test` in `C:\Users\ykaza\claude-fold7` on Ruiko, its own SDK root there (emulator 37.2.13, Android 17 =
  API 37.0 `google_apis` x86_64, userdebug so `adb root` works). The shared SDK in `E:\Users\kazari\android\sdk` is
  not changed (only its `platform-tools` is used, through a junction).
- Hidden: started through WMI in Ruiko's session 0 (`-no-window`), never on Yukimi's desktop. GPU `-gpu host`.
- Serial `emulator-5570` (console 5570). Every adb call in the scripts is pinned to it: the A53, the other session's
  `emulator-5580` (`~/.config/aemu`, AVD DSFold7) and the Fold are never touched.
- Geometry: inner panel 1968x2184 @ 360 dpi (2.25), the cover 1080x2520. A fold = logical display 0 resized to
  1080x2520 (`wm size`) + hinge sensor 0, the way One UI does it (the app reads the hinge and smallestScreenWidthDp).
  The emulator also shows the cover panel as a second display (display 2); this emulator build crashes without it.
  The scripts always launch, tap and screenshot on display 0.
- Cameras: a fabricated framework overlay (`com.android.shell:fold7cam`) sets Android's display cutout to the Fold7's
  cameras: inner Rect(1450,18,1520,88), cover Rect(510,0,570,102) (the cover path is pre-scaled by 1968/1080 because
  `wm size` scales the cutout). Android sizes the status bar from it: inner 88 px (the Fold: ~89), cover 102 px.
  The app takes a reported cutout before its own Fold7 table, so it gets the Fold's camera here without
  `Build.MODEL` being `SM-F966*` (the model is `sdk_gphone64_x86_64`).
- Test device: the emulator is marked in `/api/test-devices` (its own id, in `~/.config/fold7-test/device-id`), so
  its notices run in the `test` lane and never reach a real phone. Note: the lane is shared with the other test
  emulator; a test notice reaches both.

## Run it

```
E=scripts/fold7-emu.sh
$E up                                   # boot (~40-80 s) + device setup (root, never sleeps, cutout)
$E install ~/.cache/claude-run/apk-keep/dsapp-<sha>.apk   # once per build; the same file is never reinstalled
$E start-app
node scripts/test-phone-emu.js setup    # first time: site cookie + dev-login session, mark the test device;
                                        # tap Restart on the Recovery screen, let the installer finish, run setup again
node scripts/test-phone-emu.js partner  # first time: ActiveSync partnership (tap Yes on the emulator) - check d needs it
node scripts/test-phone-emu.js run      # all checks; --only a,b,c,d ; --out DIR (screens + results.json)
```

Driving by hand: `$E fold | unfold | rotate 0..3 | net on|off|hang|slow|flaky | shot f.png | ui f.xml | tap X Y |
key KEYCODE | other | home | status | cdp` (WebView DevTools on localhost:9352; `node scripts/test-phone-emu.js eval
'<js>'` evaluates in the page). `$E down` stops it.

Network modes: `off` = Wi-Fi and data off; `hang` = HTTPS black-holed with iptables (requests hang, the worst case
for a wait on the server); `slow` = netem 2 s delay at 64 kbit/s; `flaky` = netem 40 % loss, 300 +- 200 ms.

## The checks

- **a** cold start (force stop, then launch) online as the baseline, then off / hang / slow / flaky: launch -> Today
  (`html[data-wm-boot=done]` and the Today page shown) must stay within the online time + 1.5 s, with the requests to
  the server seen before Today (CDP Network: served by the SW, or to the network and still open at Today).
- **b** status bar: every visible `#wmShell .wm-titlebar .wm-status-icon` and the close corner inside the screen and
  clear of Android's camera cutout (CSS px x devicePixelRatio), on the inner screen, with a program open, after a fold,
  turned, after an unfold.
- **c** the notification icon (`data-role=notify`): hidden with an empty test lane, shown with a waiting test notice,
  a tap opens the tray / bubble / box, hidden again once the server clears it.
- **d** a test-lane notice with Android Settings in front: the app's WM box (MelatonBars log), no Android heads-up.

## Setup notes / pitfalls

- `setup` also runs `fold7-emu.sh appsetup` (the bars' accessibility service, the notification listener, Dreamscape as
  the home app) and turns the page's bars on. Enabling the home alias the first time kills the app once: start it again.
- A fresh install may download the whole copy twice (the first pass ends with "N files to update: rebooting into the
  installer"); let it finish.
- `DELETE /api/test-devices/notices` does not clear (the `DELETE /:id` route catches it); the script clears notices
  one by one: its own (`fold7:` ids) and any older than 10 minutes, so the other test emulator's live tests are spared.
- Turning the cover screen crashed qemu once (dump in the 37.2.13 crash database); `up` brings it back, the app and
  its sign-in survive.
- Starting while the previous instance still shuts down (20 s) leaves `*.lock` files in the AVD folder; delete them.
- A killed emulator can leave a broken crash database (`%TEMP%\AndroidEmulator\emu-crash-37.2.13.db`); delete only
  that one (36.3.10 is the other emulator's).
- The `vulkan-1.dll` version query can hang the start; `up` gives up after 240 s.
