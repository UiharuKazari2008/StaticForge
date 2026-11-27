# #1405 device proof E2: wide Quick Access tile text (items 2, 3, 5, 6 of the brief) and kept layouts with Quick Access off

**Shape and instance: A53-shaped lane emulator `aemu-a53-4`** (`emulator-5568`, Android 16, 1080x2400 at 420 dpi, `-no-audio`),
booted from `golden` at 17:12 (Nov 27 2026, host clock), lease 292 (coord id `claude-7422ffc1`, shared with E1). **The Fold shape was
not used for these items**, neither was the real A53 or the Fold. (Why not `aemu-fold-1`: see "Incidents" 1.)

DSApp release 44, `1.0.3632992`, versionCode **3632992**: installed once with `lane.sh aemu-a53-4 install-release` behind build gate 342
(`install.json`: before 3631835, after 3632992, sha256 `3443b06b...f86a`). Checked with `dumpsys package` and `status`
(`appVersionCode 3632992`). Media volume 0 (speaker and Bluetooth), `lane.sh sound` at the start and at the end:
count 0, `alarmLikeStarted` 0 (`sound-end.txt`, run from the first mark 17:15:08 to the end).

Pictures: whole screens are reduced to 50 % (540x1200); every "crop" is a **native-resolution crop** of the 1080x2400 screenshot (692 px
wide, nothing scaled; `06` is the one deliberate 2x point-sampled enlargement). I looked at every picture with the Read tool; what it
shows is in the table.

## What the page runs (the "page files" check, before any test)

- **CSS: new.** Over the instance's CDP port, the loaded `vista/quickaccess.css?sha=e90821f9...` holds
  `#wmShell > .wm-qa .qa-sub` with `text-overflow: ellipsis`, `.qa-grid .qa-tile.has-state .qa-sub` with `bottom: calc(10*var(--wm-px))`,
  and `.qa-tile.has-state.is-wide .qa-face` with `background-position: center calc(2*var(--wm-px)), 0 0`.
- **JS at the start of the run (items 1-5 ran on this): the OLD wmShell.js.** `wmShell.quickAccessLayouts.toString()` was `()=>ea()` (the wrapper is the same
  in the new build, so it proves nothing); the served compiled file said it: `curl .../scripts/comp/wmShell.js` had
  `function ea(){...try{if(!JSON.parse(t.config()).enabled)return}...` (no `atStart`). `melatonBars.js` (66408 bytes both times) I could not
  tell old from new by name (minified; `quickAccessChanged:()=>gt()` is in both). The commits cd0b839e2 / 3361b2b3d were in local main but the
  **compiled** wmShell was not refreshed: that happens with `scripts/client-update.sh` (SW notify), which was held (see "Item 6"). The tile text
  items need only the CSS and the app, so they are valid on that page.
- **JS for item 6: NEW, verified.** At 17:34 another session (claude-a73c95b6, #1413, build 328 `sw-notify`: "14 assets recompiled, 16 clients
  notified") sent the update; **I sent none**. Then: served `wmShell.js` has `function ea(t){...if(t)try{if(!JSON.parse(e.config()).enabled)return}...` and
  `setTimeout(()=>ea(!0),8e3)`; the instance took it the rules' way: `serviceWorkerManager.refreshServerCacheAndCheck()` (pending, kind `restart`, 4 files,
  progress 100), then `forceRestart({confirmed:true})` (page up 24-29 s later, pending false); the cached `wmShell.js` has the `ea(!0)` timer, its sha256 prefix
  `e595f1ae5f053e17` equals the served file's and the `?sha=` of the loaded script; the cached `melatonBars.js` (sha256 prefix `149c4b8b53ed6b63`, 66408 bytes) equals the served
  file's and holds the `qatab|quickaccess|output\.\d+$` role regex of `withCurrentQa`. Nothing hot-applied.

## Setup (by taps where the brief says taps)

The golden instance had Melaton Bars off (memories 349 / 352). Device-local, put back at the end: `AndroidBars.setConfig({enabled:true,
softkeys:true,room:true})` and `localStorage.wmCameraExtendBar=1` (then `forceRestart`; Android's own "Viewing full screen / Got it" box
was answered by a tap). Quick Access was then switched on **by taps**: Start (60,50) > Settings (180,1102) > Buttons (540,280) > tab Quick
Access (474,2258): tick the box, "Show as: Wide panel", scroll the Controls, tick Adaptive brightness, Adaptive color tone, Audio output
(like the earlier run's panel), `ok`, `ok` (picture `27`). Result: `enabled:true, layout:"wide", columns:1`, 23 items
(`quickaccess-config-mid.json`). Open = a real edge swipe, `input swipe 1078 860 560 860 250` (strip: end x 880 / 780).
Over Android Settings: `lane.sh other`, tap Network & internet.

## Results

| # | Case | Steps | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1a | **Long Bluetooth sub-label, page alive**, wide, over Android Settings | virtual A2DP speaker "Lane Test Speaker" (netsim + Bumble, the #1395 fixture `bt-sink.py`, paired by taps in Android Settings, route `bluetooth_a2dp_audio_route` selected, media volume 0), edge swipe | **PASS** The Bluetooth tile's line is "Lane Test Sp…": inside the tile (about 25 px inside its right edge at native size), ends in "…", whole glyphs. Wi-Fi's "AndroidWifi" whole. Before (earlier run, picture 18 of #1395): it ran past the screen edge | 07, 08 |
| 1b | Same, **page gone** | `lane.sh kill-app` with Android Settings in front, 30 s, no renderer process (`sandboxed_process` not `js_sandboxed`: 0), `cdp` "socket hang up", app pid back (10875) for its services; edge swipe | **PASS** identical: "Lane Test Sp…" with the ellipsis, drawn from the kept layouts (log: `panel push ... bubble quickaccess drawn here`). Before: cut mid-word "Lane Test Spea", no ellipsis | 09, 10, 11, c-pagegone-check.txt |
| 1c | Same, **over Melaton home** (page alive) | edge swipe on Today | **PASS** same line, panel pushed | 14, 15 |
| 2 | Wi-Fi's and Output's lines whole | Wi-Fi "AndroidWifi" (also "Off" with `net off`), Audio output "Speakers" (no speaker) and "Lane Test Speaker" (speaker), wide | **PASS** whole, unchanged (the Audio output row is a wider tile; "Lane Test Speaker" whole in it, "Speakers" whole in picture `01`) | 01, 02, 07, 08, 17, 18 |
| 3a | **Performance** inside its tile's frame | wide, native crop | **PASS for "inside, ends in …"; the name is NOT whole.** Reads "Performan…": 7 px inside the tile on the left and 6 px on the right (text columns 29..164, measured, in the tile's outline 22..170 of crop `03`), the tighter spacing was not enough on this 1080-px shape. 3 of its 11 letters are lost. Compare the earlier A53 picture 14: "Performance" met the tile's right edge. With the page alive, page gone and over home: same | 03, 11, 16, 06 |
| 3b | Letter spacing of Performance vs a neighbour | 2x point-sampled crop of the "Performan…", "Power share", "VPN", "Pointer Flow" names | Looks **slightly tighter than its neighbours' names, not squeezed**: glyphs closer by about a pixel at native size, no touching, no overlapping, still comfortably readable; the "…" follows without a gap. I would not call it ugly, but "Performan…" is clearly an abbreviated word | 06 |
| 3c | Every other tile's name as before | Rotate, Sound, Hotspot, QR code, Do not disturb (2 lines), Modes, Flashlight, Power saving (2 lines), Auto/Network, Dolby, Eye comfort (2 lines), Record, Power share (2 lines), VPN, Pointer Flow (2 lines), Adaptive brightness / color tone (2 lines) | **PASS** no name cut with "…" except Performance; all look as in earlier pictures 05 (#1395 fold) and 14 (#1395 A53): same wraps, same places. **Not a pixel diff**: the earlier pictures are other shapes and reduced, so the check is by eye | 03, 04, 05, 16 |
| 4a | **Network tile**: state line centred between glyph and name, touches neither, glyph not cut | wide, native crop, 3 places (alive, gone, home) | **PASS with a remark.** "Auto" is between the "5G" glyph and the name "Network", touches neither, the glyph is whole (not cut) and was moved up. **But it is not centred between them by eye**: measured on crop `03` (rows of white / light pixels, native px): glyph rows 59..96, "Auto" rows 127..147, "Network" rows 158..178, so the gap glyph to "Auto" is 31 px and "Auto" to "Network" is 11 px (centred would be about 21 / 21). It reads as a two-line name "Auto / Network" under a glyph, not as a state line floating between two things. See the description below | 03, 11, 16 |
| 4b | Network tile, other faces (on / off / dim) | | **Only one face seen** (the tile is unlit: the lane has no `com.radioswitch.app` tile service, memory: Network tile state comes from it). `net off` (Wi-Fi + data off) changed Wi-Fi to the "Off" face and the sub-label to "Off", not Network. The lit and the dimmed Network faces could not be made on this lane | 17, 18 |
| 4c | Picture's higher place (2 units instead of 4): noticeable or odd? | compare with the rest of the row (Dolby, Eye comfort, Record) | Measured on crop `03`: the top of the "5G" art is at row 59, Dolby's at 60, Eye comfort's at 67, Record's at 68 (the arts differ in height and in their own margin). The 2-unit higher place (about 5 px) is **not noticeable** in the row: "5G" starts level with Dolby's logo. Nothing odd by eye. The glyph's bottom (row 96) is above the other tiles' glyph bottoms, which is the room the state line needs | 03, 16 |
| 5a | **Strip, 1 column**: Network tile's state line and Modes sub-line | strip, page 2 (arrow tap), native crop | **PASS (as before)**: "Modes" with "None" under it in the tall tile; "5G" over "Auto" in the small tile. Same as earlier picture 03 of #1395's before run (`1327/before/03-settings-qa-strip-page2.png`: "Modes / None", "5G / Auto") | 20, 21 |
| 5b | **Strip, 2 columns** | strip 2 columns (set by taps, Show as), page 1, native crop | **PASS, with a limit of the comparison**: the wide Modes tile reads "Modes" over "None", left of it the glyph; "5G" over "Auto" in the small tile; no cut, no overlap. **No earlier picture of the 2-column Modes / Network page exists** in the evidence folders (only the Output panel), so "as before" could not be compared for 2 columns | 25, 26 |
| 6 | **Output panel rows**, wide and strip | wide: Audio output row (page gone, with the speaker); strip: Output tile on page 3 | **PASS** wide: "Lane Test Speaker" (marked) and "Speakers" whole on one line each. Strip 1 column: "Lane Test Speaker" on two lines inside its row, "Speakers" whole, as #1395 left it (picture 15 / 23 of the earlier runs) | 12, 13, 22, 23, 24 |

### The Network tile and the "Performance" tile, in words (for the planner's decision)

- **Network** (crop `03`, `11`, `16`): the glyph "5G" is white and whole, in the upper part of the tile. "Auto" is white, small, one line, horizontally
  centred; "Network" is the tile's name, light grey, centred, directly under "Auto". The picture's top is level with Dolby's (row 59 vs 60), so its higher place does not show. The state line does not touch the glyph (31 px gap) or the name (11 px gap), it is just closer to the name than to the glyph.
  Whoever wants "exactly between" must raise the line (`quickaccess.css`, `.qa-grid .qa-tile.has-state .qa-sub`: `bottom: calc(10*var(--wm-px))`
  to about `calc(12.5*var(--wm-px))`), or move the picture lower again; I did not try.
- **Performance** (crop `03`, `06`): "Performan…" in the tile, ends in an ellipsis after the "n", the tile's frame is kept on both sides. Spacing is a touch tighter than the
  neighbours' names. The brief's expected outcomes were "whole if the tighter spacing is enough, else ending in …": this is the second.
  A name that loses three letters is legible but not nice; a smaller font for this one tile or the second line the "Power share" tile
  uses ("Perfor / mance" does not break at a word) are options that are not in the change.

## Item 6: kept layouts follow the settings with Quick Access off

Shape / page: same instance, the NEW wmShell.js / melatonBars.js (see above). Media entrance = **the page bridge call**
`AndroidMediaSession.openOutputSwitcher("")` over CDP (the call the media tile makes), **not the real media tile**: no media-session fixture
(`LaneSession.java` needs a javac + d8 build on Ruiko) was made. Roles read from the app's `files/melaton_bars/layouts.json` with root `su`
(`roles-*.txt`: the role names and the left edge of the Output panel layout: wide 349.6, strip 2 columns 711.9, strip 1 column 869.4; a Quick Access
role is `qatab` / `quickaccess*`). Everything by real taps in Melaton's Settings (Start > Settings > Buttons > Quick Access) except where "bridge" is said.
"Within 5 s" = time from `lane.sh other` returning (Android Settings in front, page hidden) to the open call.

| # | Case | Steps | Result | Evidence |
| --- | --- | --- | --- | --- |
| 6a1 | Strip + untick in ONE visit, from wide + on | tick, Show as "Sidebar strip, 1 column", untick, OK, OK; `other`; open 2.6 s after Settings was in front | **PASS** the one-column strip Output panel, **no Quick Access tab** on the pushed edge, screen pushed aside; roles: **no `qatab`, no `quickaccess*`**, `output.0`..`output.8` present, `output.1` left edge 869.4 (strip); the file was written at 17:43 right after the OK | 30, 29, log-a1.txt, roles-ra3-strip-off.txt, roles-rb-wide-on-again.txt (before: wide, qatab + quickaccess) |
| 6a1b | First try of 6a1 | same, but I opened at once after `other` returned | The panel was drawn (`bubble output.1 drawn here` 17:41:38.6) and the screenshot 3 s later had no panel (the bar windows were shown again 1 s after the draw, the activity switch was still settling); opened again 70 s later it was the strip with no tab (`ra2`, roles `roles-ra-after-open-1-strip-off.txt`). Not a result: opened 1.5 s later the case passes. Timing of my script, not the fix | 40 |
| 6a2 | Back to wide, QA still off | Show as can NOT be changed with the box unticked (the dropdown is greyed, picture 28), so: tick, Show as "Wide panel", untick, OK, OK; `other`; open 3.0 s after | **PASS** the wide Output panel (693 px), no tab; roles no `qatab` / `quickaccess*`, `output.1` left edge 349.6 | 31, log-a2.txt, roles-ra4-wide-off.txt |
| 6a3 | Columns 1 <-> 2 (strip), QA off | wide -> strip 2 columns; then 2 -> 1; then 1 -> 2 (each: tick, Show as, untick, OK, OK, `other`, open) | **PASS** x3: 2 columns left edge 711.9, 1 column 869.4, 2 columns 711.9; no tab, no QA roles, pushed | 32, 33, 34, log-a3a/b/c.txt, roles-ra5/ra6/ra7 |
| 6a4 | Quick Access on again | tick the box, OK, OK, `other`, open the panel by an edge swipe | **PASS with a remark.** Roles are back at once: `qatab`, `quickaccess`, `quickaccess.2` (strip 2 columns, left edge 711.9); the panel and the tab on its pushed edge come back in the set layout (strip, 2 columns) | 35, roles-u1-qa-on-again.txt |
| 6a4b | **Remark: the edge swipe** | `input swipe 1078 860/880/900 ...` after the on/off series | Starting at x=1078 or 1060 the swipe was **taken as the Android "edge swipe: Back"** (3 of 3: Settings went back one page) and did not open the panel; starting at x=1040 it opened (2 of 2). Before the series, x=1078 opened it every time (7 of 7 in items 1-5; the one earlier try over Melaton home, before any layouts had been written, was also Back). `dumpsys window`: the two `MelatonBarEdge` windows (21 px wide, x 1059..1080) are listed above `MelatonQuickAccessZone` (52 px, x 1028..1080), so the last 21 px belong to the Back edge. Cause of the change not found (not shown to depend on the fix; I did not run the series on the old page). Possibly worth a look: a Quick Access zone that sits under the Back edge | 36, windows-after-reenable.txt |
| 6b1 | **Page hidden, bridge**, with the call | Android Settings in front (page `hidden`), `AndroidQuickAccess.setConfig` wide+on -> strip+off, then `wmShell.quickAccessLayouts()`, open (0.4 s after the call, 2.4 s after setConfig) | **PASS** one-column strip Output panel, no tab; roles no QA roles, `output.1` left edge 869.4; the file was written by the call | 37, log-b1.txt, roles-rb1-strip-off-with-call.txt |
| 6b2 | Same **without** the `quickAccessLayouts()` call | baseline wide+on written first (roles `qatab`, `quickaccess`, left edge 349.6), then `setConfig` strip+off only, open 0.4 s later | As the brief expects, the **old** layout: the wide Output panel with the Quick Access tab (stale). It stayed **at least 81 s** (polled every 4 s from 17:51:50 to 17:53:00: `qatab` still in the file, page `hidden`, nothing wrote the file; I then made the page visible at 17:53:11). **What ended it: the page becoming visible** (`lane start-app`): `qatab` still there +2 s later, gone +6 s later (the `visibilitychange` pass); roles then strip + off. Nothing else rewrote the file in those 81 s (I did not log the app's own passes, only the file) | 39, log-b2.txt, log-b2-poll.txt, roles-rb2-0 / rb2-1 / rb2-2 |
| 6b2b | First try of 6b2 (note) | the wide baseline was NOT in place: after the strip+off case, `setConfig` wide+on + `quickAccessLayouts()` right after `start-app` +4 s with the page visible left the kept layouts strip+off (no `qatab`) when read about 8 s later; the same two calls a second time (page visible, 5 s) wrote wide + on | Unexplained, once. A write that did not happen (or happened and was undone) with the page just made visible. Not reproduced with the second try; recorded because "the kept layouts follow the settings" is the claim | 38, roles-rb2-0 (the second try) |
| 6c | Start-up with Quick Access off | Melaton Bars switched off (else `melaton_bars` is loaded for the bars), Quick Access off, `forceRestart`; look at `window.melatonBars` and the resource list at page time 21 s, 30 s, 46 s | **PASS** `melatonBars` undefined and no `melatonBars.js` request at 46 s (the 8 s start timer has run). **Control, Quick Access on, bars off, restart**: `melatonBars` loaded (object, 1 request) at page time 14 s. So with Quick Access off nothing is loaded for it at start, and with it on it is. `wmShell.quickAccessLayouts(true)` cannot be called from the console (the export drops the argument, `wmShell.js:15066`), so the start timer's own call was what ran | log-start-qa-off.txt |

Remarks on the table:
- 6a1..6a3 show the kept layouts follow Settings' commit with Quick Access off, **by taps**, on the A53-shaped instance. 6b1 shows the bridge path with the call;
  6b2 documents that without the call a page that stays hidden keeps the old panel until it is visible again (the brief's variant; not a defect of the fix, the commit and the call are the entry points).
- Not tried: a change of "Show as" alone with Quick Access off (the dropdown is disabled by the page's own Settings), the real media tile, the fold shape.

## State left

- `aemu-a53-4`: running, release 44 (3632992) installed, page restarted on the new JS. **Quick Access config restored** twice (after items 1-5 and after item 6) by
  `AndroidQuickAccess.setConfig` of the start JSON (`quickaccess-config-start.json` against `quickaccess-config-end2.json`: **one differing key, `anchor:"top"`**, written by
  Settings' OK; `setConfig` only merges so it cannot be removed; absent reads as top aligned, the same behaviour, as in the earlier runs). Melaton Bars config back to the start
  (`bars-state-start.json` / `bars-state-end2.json`: no difference in `config`), `localStorage.wmCameraExtendBar` removed. Melaton 6.1 (no `wmVersion`), as found.
  The kept layouts are the strip + off set (no `qatab`), matching the restored config.
- Bluetooth: the speaker forgotten (`Forget device`), the Bumble sink and its ssh tunnel to netsim killed (pids checked), netsim port 62109, the speaker visible on the shared
  radio from about 17:18 to 17:33. **Bluetooth was found switched ON again at the end of item 6** (`bluetooth_on 1`; it had been off at the start and I had switched it off
  after the fixture; the Settings pages that my blind taps reached include "Bluetooth tethering": my guess is that a tap or the QA tile turned it on, not verified); switched off
  again with `cmd bluetooth_manager disable` (`bluetooth_on 0`).
- Wi-Fi + data on again (`net on`), rotation auto, DND off, as at the start. Media volume 0 on the speaker and Bluetooth devices (the start value of the speaker device was not read; `up` sets it to 2).
  `lane.sh sound --since <first mark>` at the end: count 0, `alarmLikeStarted` 0, played 0 (`sound-end2.txt`).
- The Android Settings task is left in a sub page (Hotspot & tethering / Network); the app was killed once on purpose (`kill-app`) and restarted by `start-app`; the Melaton page was restarted with `forceRestart` 5 times.
- Release 44 stays installed. Lease on `aemu-a53-4`: held for item 6 (lease 296), released at the end of this run; the lease on `aemu-fold-1` was never E2's alone and is left to E1 (not released).
- Big raw files: `~/.cache/claude-run/1405/e2/` (full screenshots, the venv of the speaker fixture, `sink.log`).

## Incidents

1. **Two agents on `aemu-fold-1`.** E1 and I share the coord id `claude-7422ffc1`; `coord_device_request aemu-fold` answered "granted aemu-fold-1,
   renewed" to me although E1 had it. We both ran `lane.sh aemu-fold-1 reset` within a minute (17:12:36 E1, 17:13:28 me). I killed mine at once (pids
   3381299 / 3383118, nothing else of mine ran on it) and told the planner; the planner gave the fold to E1 and sent me to an A53-shaped
   instance. The instance had been wedged before either reset: qemu up since 16:14, adb "device" but `getprop` / `shot` hung, `wait-boot 60`
   "not booted" (the "hanging thread QEMU2 main loop" state of #1395).
2. `coord_device_request aemu-a53` answered `aemu-a53-1`, which claude-b40be32a (#1412) is waiting to use for its AFTER shot: released it unused, took `aemu-a53-4`.
3. Build gate 342 (the install of release 44) had two agents that never answered (claude-rackmgr, 1408-splash-planner; two direct posts, 6 minutes): started with
   `force` and the reason "lane-only adb install, no repo files", as coord allows; the gate text says so. Nothing else was forced.
4. A blind tap (540,2300) meant to close the panel hit the soft key bar's middle button once; no harm seen.
5. Client update: I did not run `client-update.sh` / `sw-notify` and opened no `sw-notify` gate. The refresh came from claude-a73c95b6's build 328 at 17:34 (it carried all
   committed client files; the gate's "ask" for claude-rackmgr's uncommitted files was theirs to answer, not mine). My own `restart-gate.js --client --notify` call (17:3x) asked
   claude-rackmgr in its inbox once and sent nothing to clients.
