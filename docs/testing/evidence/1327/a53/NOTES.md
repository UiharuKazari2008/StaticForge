# #1327 / #1395 Output panel on the real Samsung (A53), release 38

A53 `R5CT71TSEMZ` (SM-A536U1, `192.168.100.236:5555`, serial checked first), 1080x2400, 3-button navigation, Melaton 6.5,
Nov 27 2026, 05:37-05:55 EST (log times are the phone's clock). Lease 262 (`claude-4eb123bc`), build gate 298. The Fold
was not used. Taps and swipes are `adb shell input`. Pictures are reduced; pictures over Melaton's home are cut to the
panel's side. "Pushed" is a pixel comparison: the opened screenshot equals the shot before it moved left by exactly the
panel's width (173 px strip, 693 px wide).

## Install (once, `adb install -r`)

| | before | after |
| --- | --- | --- |
| versionCode | 3632194 (`1.0.3632194-radio1328c`, #1328's build) | 3632251 (`1.0.3632251`) |
| lastUpdateTime | 2026-11-27 04:32:42 | 2026-11-27 05:37:52 |

APK and installed `base.apk` sha256 `217a601d27d73bb885ad82750462baca19981a30e594028592097dac6c33d375`. 40a6f89 (#1328 on
DSApp main), e6b9607, 6b59b5c and 94d2420 are ancestors of 5745486. Melaton Bars bound again, no crashed service. Nav:
`navigation_mode=0`, three-button overlay, same nav-bar inset before and after (`state-*-install.txt`; the only other
differences are window numbers and two lines the second capture did not collect). The app came back to Melaton home by itself.

## Results

| # | case | result | evidence |
| --- | --- | --- | --- |
| 0 | Page current (`wmQuickAccess.roles()` = output.0..output.8, `wmOutputPanel.VERSION` o1) | **PASS** | page-state.txt |
| 1a | Tile, 1-column strip, over Android Settings | **PASS** pushed; the recording goes from the Quick Access page to Output with no slide home and no blink; in bounds, between the bars, opaque, "Speakers" in its row | 01, 02 |
| 1b | Tile, strip, over Melaton home | **PASS** Today pushed | 03 |
| 1c | Tile, wide panel, over Android Settings | **PASS** pushed | 04, 05 |
| 1d | Tile, wide panel, over Melaton home | **PASS** Today pushed | 06 |
| 2 | Rows match the real outputs | **PASS** one row, "Speakers", marked. Android: system route `ROUTE_ID_BUILTIN_SPEAKER` only, no selectable or transferable route; `dumpsys audio` connected device: speaker only. Bonded: RedDot Status (LE, no audio profile), MODERNIA ("Connected", but A2DP Disconnected, no active A2DP or headset device) | outputs.txt |
| 3 | One draw only, also the first open after the install (05:40:20) | **PASS** 33 `output.1` draws in the tag log, 33 router starts, 33 stops, 0 `output.0`. `MEDIA_ROUTING_CONTROL` was already `allow` (since about 03:00), so the "ask the app's shell" first-open path did **not** run here | log-run.txt |
| 4a | Output over Settings: soft Back | **PASS** strip and wide; closed, program stayed (screen equal to before, 0 px differ), the next Back reached the program | 07, log-run.txt |
| 4b | Output: left edge swipe | **PASS** strip and wide, same | 07 |
| 4c | Output: right edge swipe, from x=1077 on the panel | **PASS** strip and wide, same. "Next Back" after the wide left and right closes was checked once, after the three wide closes | 07 |
| 4d | Output: `input keyevent 4`, once (record only) | As documented: the panel **stays** and the program under it goes back (Connections to the Settings homepage, same task, `SubSettings` to `SettingsHomepageActivity`) | 09 |
| 4e | Quick Access: soft Back, left, right | **PASS** 3 of 3, program stayed, next Back reached it | 08 |
| 5a | Outside tap, over Settings (strip, wide) and home (strip) | **PASS** closed, nothing leaked to what is under it | 09, 10 |
| 5b | Swipe up from the soft key bar (strip over Settings and home, wide over Settings) | **PASS** "swipe up on output.1: Home", Melaton home, nothing left | 10 |
| 5c | Over home: left, right, left soft key | **PASS** closed, Today back. Over home the bar keeps home's keys ("Notification", "Set"); a tap on the left one counts as outside and does not open Notification | 10 |
| 6 | The drawer pushes the screen aside | **PASS, the lane's no-push state was not reproduced.** Of 31 fresh drawer opens over Settings, 25 were screenshotted while open: 25 pushed, 0 laid over (strip 20, of which 12 in one loop; wide 5); the Output page was in 22 of those pictures. 1 more shows pushed in a screen recording; 5 were not photographed while open | 11, opens-12-pixel.txt |
| 7 | Media-session entrance | **PASS** by the page bridge call the media tile makes, `AndroidMediaSession.openOutputSwitcher("")`, over CDP. **The real media tile was not pressed here** (it was on the lane); no media session existed and nothing played. Wide with Quick Access on, and strip with Quick Access off: pushed, one draw, soft Back / right edge closed it, program stayed. No Android Media output window. See observation 2 on the slide | 12, 13 |

### captureDisplay -> drawn (`log-capture-draw-times.txt`)

37 fresh drawer opens: 28-72 ms from system_server's `WindowManager: captureDisplay` line to "bubble ... drawn here".
Strip Quick Access 28-43 ms (the 12-open loop: 33-43), wide Quick Access 55-71 ms, media entrance 64-72 ms as the wide panel (two opens) and 42 ms as the strip (one). The two wide media
entrances from "open: router started" to drawn: 103-115 ms. The tile's page reuses the still (no new capture): tap to `output.1`
12-26 ms in the strip, about 36-38 ms wide. The app waits 180 ms for its screenshot (`MelatonBars.kt` `stillWait`, as read
in the lane notes); these times start at system_server's line, so they are not exactly the app's own wait. The lane's
no-push state did not happen here; its cause is still not proven.

## Defects and observations

1. **Kept layouts stayed old after Quick Access was set to strip and off in one save.** After the restore
   (`AndroidQuickAccess.setConfig` + `wmShell.quickAccessLayouts()`, wide+on -> strip+off), the media button opened the
   **wide** panel 23 s later with Settings in front, with the Quick Access tab on the pushed edge although Quick Access was
   off. After Home (page visible, 12 s) it opened as the strip with no tab. Read from code: `quickAccessLayouts()` in
   `wmShell.js` returns early when `enabled` is false, and `melatonBars.js` `pushOnScreen` runs only while the page is
   visible. Settings' commit calls the same function; by taps this needs "Show as" changed and the box unticked in the same
   visit (not tried by taps). Picture 13.
2. **The media entrance's slide is barely visible.** In one recording the first moving frame is already at 224/231 of the
   travel (97%) and settles over about 50 ms. The Quick Access swipe's first moving frame in its recording was at 198/231
   (86%). One recording each. Picture 12.
3. Wide Quick Access (not the Output panel; the lane saw it too): "Performance" is as wide as or wider than its tile and
   meets its right edge; "Auto" is crammed against the top left of the "5G" glyph. Picture 14.
4. Not the Output panel: the "1 update is available for Melaton. Melaton restarts to install them." box was on screen at
   the start and showed again after being answered **Later** (answered 3 times in the first minutes: on Start, after the
   Settings OK, on home after a swipe up). After the third it stayed as "Notification 1". Not installed.
5. About 20 s after the install the first home picture had a plain grey wallpaper and "studio" as the first row; the
   pictures before the install and later have the photo wallpaper and "director". Seen once, not looked into.
6. **The A53 was not charging:** AC, USB and wireless powered all false at start and end; 52% -> 49%.
7. `~/.config/a53/a53.sh` still defaults to `192.168.100.240`; one `getprop` through it at the start answered
   "device not found" (nothing ran).
8. Seen in the full log at 05:41:40 (the key-4 case): `translucent check for com.android.settings: no screenshot (3), solid bar`.
   That is the bar's own check, not a panel open.

Not tested: moving media (the phone has one output), the 2-column strip, the page absent, the real media tile.

## Quick Access config

Off before; switched on by taps (Start > Settings > Personal > Buttons > Quick Access: box ticked, "Audio output" ticked
in Controls, later "Show as: Wide panel"). Restored with `AndroidQuickAccess.setConfig(<before>)`.
`quickaccess-config-before.json` against `quickaccess-config-after.json`: **one differing key, `anchor`** (absent ->
`"top"`). Settings' OK wrote it; `setConfig` only merges and accepts "top" or "bottom", so it cannot be removed through the
app. Absent reads as top aligned, so behaviour is the same. All other keys equal (`enabled` false, strip, 1 column, the
original 20 items). The kept panel layouts are the strip again (picture 13, right).

## State left

Unlocked, awake, Melaton home in front (as found), 6.5. Release 38 installed. Media volume 0 at the start and the end;
nothing played, no notice sent, no reboot, no sleep or lock. Rotation auto 1, zen 0, ringer mode 1, Wi-Fi and Bluetooth
on, `stay_on_while_plugged_in` 15, `MEDIA_ROUTING_CONTROL` allow (as found); nothing paired. Crash buffer empty, no
FATAL EXCEPTION in the log. The adb forward I added (tcp:9453) is removed (forward list empty, as found); the two logcat
readers are stopped; the screen recordings are deleted from the phone. The Android Settings task (it already existed) is
left on Connections. The `MelatonQuickAccessTab` / `Zone` windows still exist but are GONE with no surface. The lease was
not released.
