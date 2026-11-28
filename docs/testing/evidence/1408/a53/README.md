# #1408 splash on the real A53

Nov 27 2026, about 18:48-18:58 (server clock, UTC-5), session `claude-dac77be9`. Fix under test: `6f744d78a`.
Nothing was installed, no product file or script was edited, the server was not restarted or reloaded and no client
update was sent.

## Result

- **The phone is set to Melaton Mobile 6.5** (`localStorage.wmVersion` = `6.5`), so it draws the **6.5 splash**
  (orange, white flag, "Melaton"). The setting was not changed. **The green 6.1 splash of the defect was not seen on
  this phone.**
- 5 recorded starts of the fixed client, network on: **350 of 350 full splash frames have the emblem and the complete
  badge** ("Powered by", the CafeReady picture, the mark at its lower right). No full splash frame had the badge
  hidden or incomplete, or the emblem blank.
- **No old-client start was recorded**, so there is no old-versus-new comparison.

## Device and client

- Galaxy A53, DSApp versionCode 3632992 (1.0.3632992), WebView `com.google.android.webview` 157.0.8103.50, page
  411x914 CSS at 2.625.

### Before the first force-stop (read over the DevTools socket)

| what | seen |
| --- | --- |
| running document (loaded 18:36:36) | **old**: it had loaded `wmShell.js?sha=0ca83ba95651...`; the copy of that in `script-code-cache-v1` has no `width="704"`; the splash badge `<img>` in its DOM had no `width` |
| `static-cache-v2` `wmShell.js` | **new**: hash `e595f1ae5f05...`, has `width="704"` (the hash the emulator run recorded as new) |
| cached launch copy of `/app` (`melaton-launch-shell-v1`, response date 18:45:20) | **new**: has the splash preload block |
| live `/app` | new: names both pictures |
| `serviceWorkerManager` | mode `notify`, `updateAvailable` true, `availableUpdates` empty, `updateAction()` = `{kind:'restart', files:27}`, progress 100 |

So the update was already in the caches, waiting for a restart; only the running page was old. A restart would load
the new files, so an old start was not available. I did not call `installUpdates()`: my first force-stop and start
(r1) already ran the new `wmShell.js`. Who or what downloaded the update was not looked into.

### After each start

`page-state-after-each-start.jsonl` (read after the boot had finished). All 5: `wmShell.js` `e595f1ae5f05`, 6.5
splash class, badge `img` `width=704`, natural width 704, badge not hidden, `miniport` present / enabled / **up**,
`onLine` true. Each splash picture (`melaton-white-256.png` 11172 B, `cafe-ready-dark.png` 152752 B) had one resource
entry listed there: `initiatorType=link` (the preload), `transferSize` 0, `workerStart` above 0.

## How a start was made

Settings in front, `am force-stop`, 4 s, guest `screenrecord` (540x1200, half size, 22 s limit), 1.5 s, `am start`
of `.HomeAlias` with the HOME intent (the app is this phone's home app).

**These are not process-cold starts.** All 5 answered `LaunchState: WARM`, and the app process was already back
before `am start`: in all 5 the pid read before the launch was the pid read after the boot. Each page was new
(`timeOrigin` after the launch).

## Per start

"Full" = the splash covers the screen (at least 90 % of the sampled points orange). "Exit" = Today covers the middle
and the splash still shows in a strip at the top and at the bottom, where Melaton's bars are not drawn yet.
Art = response end of emblem / badge picture, ms into the document. Painted = `data-wm-splash-painted`.

| start | launched | client | full frames (numbers) | full for | emblem | badge in full frames | Miniport (page, after boot) | exit frames | art | painted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r1 | 18:50:11 | new | 57 (96-152) | 1.71 s | all | complete, all | up | 29 (153-181), 0.46 s | 464 / 478 | 5822 |
| r2 | 18:54:57 | new | 76 (96-171) | 1.77 s | all | complete, all | up | 26 (172-197), 0.43 s | 272 / 281 | 4978 |
| r3 | 18:55:39 | new | 69 (80-148) | 1.72 s | all | complete, all | up | 2 (149-150), 0.07 s | 302 / 308 | 5236 |
| r4 | 18:56:24 | new | 70 (81-150) | 1.74 s | all | complete, all | up | 2 (151-152), 0.05 s | 272 / 282 | 5083 |
| r5 | 18:56:59 | new | 78 (102-179) | 1.81 s | all | complete, all | up | 28 (180-207), 0.47 s | 304 / 338 | 5690 |

- Full frames (`measure.py`): the emblem box, the "Melaton" word box and the badge box of all 350 were compared with
  r1 frame 120 (checked by eye at recorded size). Largest mean absolute difference, of 255: emblem 0.03, word 0.16,
  badge 0.15 (r1-r4: 0.00). The crops of all 350 were also looked at on the contact sheet (downscaled).
- The frame just before the first full splash frame has no orange in the sampled points in all 5 (r1's was looked at:
  solid black). The coarser pass over each whole recording found no other splash-coloured stretch before it.
- Exit frames (`exit.py`, 87 in all): the bottom strip (x 338-522, y 1160-1182: the lower part of the badge) matches
  the same start's full splash (mean difference at most 2). In these frames Today covers the emblem and the upper part
  of the badge. By eye, in full: r1 frames 153, 165 and 181 and r3 frame 150; there the uncovered part of the badge
  has its picture. The next frame in each start has Melaton's bottom bar over that strip.
- The recorder writes a frame when the screen changes. A frame it dropped could not be seen.

## Not tested

The 6.1 splash (the one in the defect); the old client; the badge's hidden case (Miniport down or network off: no
setting was changed); process-cold start; the first start after a reboot; DeX or an external display; a slow or hung
network.

## State of the phone

- The enabled accessibility list was the same before the first force-stop and after the 5th start:
  `dev.custodian.agent/dev.custodian.agent.InputGuardService:jp.net.seventhreeseven.dreamscape/jp.net.seventhreeseven.dreamscape.MelatonBarService`,
  `accessibility_enabled` 1. After the 5th start both services were listed as bound. It was not re-read between
  starts and nothing had to be written back.
- No system setting was changed. The temporary recordings on the phone and the server's `adb forward` were removed.
- The app was left in front (`.HomeAlias`), keyguard not showing. It was running the new client; the earlier pending
  update was applied by the restarts.
- The lease was released at about 18:57:47, after the last command to the phone. The next holder's lease starts at
  that time.

## Files

- `first-splash-frame-per-start.png`: the first full splash frame of r1-r5.
- `r1-splash-frame-recorded-size.png`: r1 frame 120 at the recorded size.
- `crops-every-full-splash-frame.png`: emblem with word, and badge, of all 350 full frames in order (cyan lines
  separate r1-r5).
- `last-exit-frame-bottom-strip-per-start.png`: the bottom strip of each start's last exit frame, r1 at the top.
- `page-state-after-each-start.jsonl`: the page probe of each start.
- `measure.py`, `exit.py`: the measurements. The recordings are not kept (they also show Today), so the scripts
  cannot be run again without new recordings.
