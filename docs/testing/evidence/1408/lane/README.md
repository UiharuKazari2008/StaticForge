# #1408 splash on the emulator lane (real DSApp WebView)

Run Nov 27 2026, about 17:33-18:45 (server clock, UTC-5). Fix under test: `6f744d78a`. No product file or script was
edited, the server was not restarted and no client update was sent.

## Result

7 recorded starts of the fixed client (5 with network, 2 without). **No recorded splash frame showed a blank emblem or
"Powered by [blank] TM".**

- Network on: 72 of 72 full splash frames have the emblem and the complete badge.
- Network off: 36 of 36 full splash frames have the emblem; the badge is hidden (plain green, no text) in all 36.

**The old client was not run on the emulator, and the original blank was not reproduced there.** This shows the fixed
client not showing the defect in these starts. It is not an old-versus-new proof on Android.

## Device and client

- `aemu-fold-3`, Android 17 (API 37), inner display 1968x2184 at 360 dpi, hinge 180, `-no-audio`.
  WebView 145.0.7632.218. Page: Melaton Mobile 6.1, splash "Version 2026 R7".
- The AVD existed without a golden snapshot and without the app. `lane.sh create fold 3` finished it (one
  `adb install`, sign-in, partnership, Shizuku, `golden` saved). DSApp: **not installed before, then release build 44,
  versionCode 3632992** (build gate 344, installed 18:27). No client update was needed: this first install got the
  running server's client.
- New client confirmed over the WebView DevTools socket:
  - live `/app` has `link rel=preload as=image fetchpriority=high` for `boot-melaton.png` and `cafe-ready-dark.png`;
  - cached `wmShell.js` (`static-cache-v2`, hash `e595f1ae5f05...`, the same `?sha=` the page loaded) has the badge
    `<img width="704" height="298">` and hides it unless `complete && naturalWidth > 0`;
  - cached `wm-shell.css` / `wm-programs.css` have the held boxes (`height:auto`, `704 / 298`); the cached launch
    copy of `/app` has the preload block.

## How a start was made and recorded

Settings in front, `am force-stop`, 4 s, guest `screenrecord` (984x1092, half size), `am start`, record until the page
said `data-wm-boot=done`, plus 6 s. During the boot, DevTools was asked for the page state about every 6 s.

- Android had restarted the app **process** within the 4 s (a pid in all 7; `LaunchState: WARM`). The activity, the
  WebView renderer and the page were new each time (renderer process started 0.37-0.61 s after `am start`). These
  are not process-cold starts.
- `force-stop` removes the Melaton Bars accessibility service from the enabled list (known, shared memory #356), so
  the 7 starts ran with it off. It was switched on again afterwards.
- The recorder writes a frame when the screen changes. In all 7, the frame before the first splash frame is solid
  black. A frame the recorder itself dropped could not be seen. Recording adds guest load.

## Per start

"Full" = the splash covers the screen. "Exit" = Today is sliding over it. Times of `/app` are from the device log
(`am start` to the document's `timeOrigin`).

| start | launched | `/app` document after | full frames (numbers) | emblem | badge in full frames | exit frames |
| --- | --- | --- | --- | --- | --- | --- |
| run1 | 18:35:06 | **41.6 s** | 21 (66-86) | all | complete, all | 87-88 |
| run2 | 18:36:52 | 4.5 s | 13 (49-61) | all | complete, all | 62-64 |
| run3 | 18:37:41 | 4.5 s | 14 (56-69) | all | complete, all | 70-71 |
| run4 | 18:38:17 | 4.4 s | 8 (54-61) | all | complete, all | 62 |
| run5 | 18:38:52 | 4.2 s | 16 (49-64) | all | complete, all | 65-66 |
| off1 (network off) | 18:40:28 | 4.6 s | 16 (56-71) | all | hidden, all | 72-81 |
| off2 (network off) | 18:41:02 | 4.1 s | 20 (52-71) | all | hidden, all | 72 |

- Measurement: `frame-measurements.txt` (`analyze.py`). Emblem box in every full frame of all 7: mean absolute
  difference from run1 frame 66 at most 0.17 of 255. Badge box, network on: at most 0.06. Network off: 70.52 (no badge).
  The crops of all 108 full frames were also checked by eye.
- Exit frames (by eye, contact sheets; some at full size): Today covers the splash from the top. Network on, the
  strip of the badge still uncovered has its picture. Network off, that corner is plain green.
- Network on: the badge was shown because the page had the Miniport link up. At the later page probe (about 18 s
  after the document, after the splash) run2 reported `miniport.up=false`; runs 1, 3, 4, 5 reported `true`. The app
  log says the CafeReady check passed at +1.4 to +2.0 s in runs 2-5. In run1 it failed at +2.5 s ("no answer within
  1500 ms"), and the link was up by the time of the splash.
- Network off: correct hidden case. Wi-Fi and mobile data were off (ping "Network is unreachable", no default
  network, before and between the two starts), the page said `onLine=false`, and the app log has
  `SiteAccess ... UNREACHABLE` and `CafeReady check FAILED ... Unable to resolve host`. Both starts went on to Today.
  The network was restored and ping worked again.
- Art from cache, all 7: one resource entry per picture, started by the preload (`initiatorType=link`),
  `transferSize 0`, through the service worker, full size (58412 and 152752 bytes). Response end 403-888 ms into the
  `/app` document, network on or off.

## Seen, outside #1408

- **run1 stayed black for about 40 s.** The first document was complete with no `data-wm-boot`; the `/app` document
  began at +41.6 s. The app log has `SiteAccess: startup check (behind): READY` at +40.8 s (runs 2-5: +1.4 to
  +1.7 s). run1's first document path was not recorded. It was the first of my starts after provisioning and the
  golden save. **Cause not established**; worth a look against `installed-boot-zero-wait`.
- In runs 2-5 and both offline starts the screen was also black (with a short Xyridian logo in the sheets looked at)
  until the splash: first splash frame about 13.4-15.0 s into a recording that began about 3 s before the launch.
  This is an emulator on a loaded host; it says nothing about a phone's timing.
- **`lane.sh keep` race.** `keep 60` ran at 17:43:42; the reaper stopped the instance at 18:14:01 as "idle 30.3 min",
  with the coord lease held. From the code: `touch_last` writes Ruiko's `last\<id>.txt` = now in the background just
  before `keep` writes now + N, and the background write can land last. Later commands then skip the write because
  the local `.keep` is in the future. A second `keep` has no such race (it was used for the rest of the run, which was
  not stopped).

## Not tested

Old client on the emulator; process-cold start; the original situation with the Shizuku window in front; Melaton Bars
service on during a start; cover display, DeX / external display; 6.5 splash; a slow or hung (not absent) network; a
real phone.

## Files

- `first-splash-frame-per-boot.png`: the first full splash frame of each of the 7 starts.
- `run1-first-splash-frame.png`, `off1-first-splash-frame-network-off.png`: one of each at the recorded size.
- `crops-every-splash-frame-network-on.png`: emblem and badge boxes of all 72 frames (red bars separate runs 1-5).
- `crops-every-splash-frame-network-off.png`: the same boxes of all 36 offline frames (off1, red bar, off2).
- `frame-measurements.txt`, `analyze.py`: the numbers. The recordings are not kept (they also show Today), so
  `analyze.py` cannot be run again without a new recording.
