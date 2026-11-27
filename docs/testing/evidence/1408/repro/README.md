# #1408 part A: why the emblem and the CaféReady picture were blank on the 6.1 page splash

The first part below is the cause measurement (old code). The follow-up at the end, **Old vs new code**, runs the fix.

Measured Nov 27 2026, 15:54-16:25. No product file edited; server not restarted or reloaded.

## Setup

- Own headless Chromium 156.0.8078.108 (`browser.sh`, port 9361, own profile), 412x915, DPR 2.625, touch, an
  Android WebView user agent (`; wv)`), `window.AndroidCaption = {}` as the bridge. Live server `127.0.0.1:9220`,
  dev login, installed once through `/launch` (`install.js`). Every measured boot: `/app`, service worker stopped
  first, page and worker traced (CDP, the worker's own perf trace, screencast of painted frames).
- **All runs got the OLD code.** Another agent was editing `app.html` / `wmShell.js` in the tree; the server did
  not serve those edits (`served-after-install.txt`; every run JSON has `served.splashArtInHtml: false`; checked
  again at the end). The new code was not run here.
- No Café Miniport in this browser: the test unhid the badge (`--showcafe`). The `<img>` loads either way.
- `inbox_ack` was dropped in the test tab (shared memory #327).
- Host: 8 cores, load 3.7-8.4 from other work. All times below are page ms since navigation start.

## Cached boots (both rows in `static-cache-v2`)

- Rows present: 58412 B and 152752 B, status 200.
- All page requests answered by the service worker; **0** worker network requests for the two URLs.
- Worker trace, 70 rows in the normal boots, all `hit`: queue wait `q` at most 1 ms, wallpaper-set restore `w` at
  most 13 ms, handler `h` 1-93 ms. `transferSize` 0, `workerStart` is 0-8 ms after `startTime`. One resource entry
  per URL.
- Priority without preload: Low at creation (30 requests were then raised to High, 20 stayed Low). With preload: High.
- The `<img>`s are made only by `buildBootLayers()`, after the script chain: about 530 resources had already
  started (1x: 1.2-2.3 s on 8 cores, 4.0-4.4 s on one; 6x: 8.3-10.4 s; 12x: 18-24 s; 20x: 41 s). The request starts
  5-180 ms after insertion.

### What was painted (`classify.js`, per screencast frame)

| plain boots, rows cached | first splash frame lacked art | longest time art was missing on screen |
| --- | --- | --- |
| unthrottled (8 cores and one core, incl. offline / URL-fail runs and the 3 stall runs' first frames) | **13 of 13: both pictures** (emblem blank, badge "Powered by __ TM" collapsed) | 184 ms |
| CPU throttle 6x | 0 of 4 | 0 ms |
| CPU throttle 12x / 20x, one core + 4x | 4 of 8: badge half decoded, emblem there | 150 ms |
| **with injected preload** (all rates, incl. stall runs) | **0 of 18** | 0 ms |

`first-splash-frames.png`, `plain-vs-preload-1x.png`. The 1x blank frame looks like the emulator screenshot.

The first splash frame can be painted after `responseEnd` (base-r1: respEnd 2055 / 2095, blank frame at 2111, art
at 2228): the response being complete does not mean the renderer has the picture yet. The `load` EVENT is no
measure of what is on screen: under throttle the art is painted seconds before `load` fires.

### When the splash ends vs. `load` and `data-wm-splash-painted`

`summary.txt` has every run. Plain boots: img inserted to `load` is 182-225 ms (1x), 563-586 (one core),
1173-1759 (6x), 2750-4454 (12x), 7137 (20x). In all 8 plain boots at 12x, 20x and one core + 4x the splash was
`done` before both `load` events (base-r20: done 44672, load 48079/48166; at 12x often by only a few ms).
`data-wm-splash-painted` was set **after** `done` in every boot at 6x, 12x, 20x and one core + 4x, with and
without preload (not at 1x, injected-stall runs aside). The preload does not change that.

## Server unreachable / rows deleted (1x)

| case | worker | result |
| --- | --- | --- |
| rows cached, both URLs fail on the network (`cached-artfail`) | hit, 0 network requests | art shows (blank first frame, 116 ms) |
| rows cached, whole network offline (`cached-offline`) | hit, 0 network requests | art shows (blank first frame, 183 ms) |
| rows deleted, URLs fail (`deleted-artfail`) | miss, network, error | `error` 174 ms after insert, blank the whole splash |
| rows deleted, offline (`deleted-offline`) | miss, network, error | `error` 434 ms after insert, blank the whole splash |
| rows deleted, network up (`deleted-netup`) | miss, network, 200, **cached again** | art shows (blank 150 ms) |

`network-and-rows.png`. A FAILED load draws Chromium's **broken-image icon** in the emblem box. The emulator
screenshot has none (`emblem-area-emulator-vs-failed-load.png`). So in desktop Chromium that screenshot does not
look like a finished, failed load; it does look like "not delivered / not painted yet". Android WebView's drawing
of a broken image was not tested, and a request that hangs would look like "not delivered".
(The rows were restored by the network-up run.)

## Preload injected by CDP (`<link rel=preload as=image fetchpriority=high>` as soon as `<head>` exists)

`comparison.txt`. Time at which BOTH pictures' responses had ended:

| boot | plain | preload |
| --- | --- | --- |
| 1x (n=5 / 3) | 1340-2391 ms | 299-387 ms |
| one core 1x (3 / 3) | 4215-4654 | 1038-1291 |
| 6x (4 / 3) | 8464-10568 | 1361-1688 |
| 12x (4 / 3) | 18565-24177 | 3194-3638 |
| one core 4x (3 / 3) | 12908-13975 | 2819-2959 |

- With preload the pictures were in 1.1-3.5 s (1x) to 17-20 s (12x) before the `<img>` existed; they were
  `complete` with natural size when observed at insertion. `load` still came 84-1625 ms after insertion.
- `syncstate.js` / `syncstate.txt`: a preloaded, loaded picture is `complete` with its width **in the same task**,
  also on a detached element built with `innerHTML`; a picture without preload is not (both pictures tried both
  ways). Run on a page without app code.
- **Possible cost, n=3+3, not established:** on one core the splash was inserted LATER with preload in all 6 paired
  runs (1x: 4753/4491/4387 vs 4409/3979/3971; 4x: 13011/13715/15212 vs 12614/12524/13272). On 8 cores the ranges
  overlap with no direction. The injected link sits earlier in `<head>` than one written lower in `app.html`.

## Injected stall (`--stall 6000`, artificial): inconclusive

The busy loop started after the renderer already had the art (the next frame, committed just before the loop,
showed it). It does not show whether a blank first frame can be held on screen by a stall.

## Cause, and how sure

1. **Sure (in this harness):** with the rows cached, the cache, the worker's route (`restoreWallpaperUrlSet`
   included) and the network are not what delays the pictures.
2. **Sure (headless Chromium):** the pictures are asked for only when `buildBootLayers()` makes the `<img>`s, late
   in a busy boot, and the splash can be painted before the renderer has them. In unthrottled boots it was, 13 of
   13 times, with the look of the screenshot. The preload removed it (0 of 18).
3. **NOT reproduced / not proven:** art missing for seconds. At most 184 ms with the rows cached. Why the emulator
   still showed it when captured is unknown. In the #1379 files: the renderer process started at device time
   ...813.0; the screen was still black in the screenshot file stamped ...828; the Shizuku window shows in the log
   at ...832.6; the splash screenshot is stamped ...838. So "25 s after the window opened" does not mean 25 s of
   blank splash: the splash may have been on screen under 10 s (host file times vs. device log times). Untested
   guesses: the guest held the page's main thread after the first splash frame, or the WebView stopped drawing
   new frames when Shizuku's dialog came to the front, leaving the early frame up.
4. Not checked: that emulator's Cache Storage, real Android WebView, the app's request interception, the 6.5
   splash, DeX.

## Run again

    ./browser.sh start && node install.js && node served.js
    node measure.js --label x --showcafe --shots --shotdir <dir> [--rate 6] [--preload] [--net offline|art-fail]
    node classify.js runs/x.json <dir>
    SHOTS=<dir> ./matrix.sh "1 6 12" 3 m ; node summarize.js > summary.txt
    node rows.js delete|restore|show ; node syncstate.js
    ./browser.sh stop && rm -rf ~/.cache/claude-run/1408      # the profile holds a signed-in session

Raw numbers: `runs/*.json` (the screencast frames themselves are not kept, so `classify.js` needs a new run).
`ref-splash-full.png` is the classifier's reference; `sheet.js` built the side-by-side PNGs.

# Old vs new code (follow-up, Nov 27, 16:30-17:30)

## How the new code was run, and the proof

- Only in two own browser profiles: `swap.js` puts the files into that profile's Cache Storage (3 rows with the
  right `x-file-hash`, and the kept `/app`). **old** = the server's own compiled bytes as served at 16:31; **new** =
  the tree's `wmShell.js`, `wm-shell.css`, `wm-programs.css` built with the server's compiler, plus the one
  `app.html` block (`build.js`, `newcode-build.json`). The old build matched the server's files except for the
  header's compile date. Someone else restarted the server at 16:37:05; its own build of the new files then matched
  mine except for that date too (`newcode-server-match.txt`). I restarted, reloaded and notified nothing.
- A #1405 commit at 16:58 changed other lines of `wmShell.js`. It is in neither variant; today's #1408 hunks applied
  to the base I used give exactly the measured source (sha256 `346146ba6b2f...`).
- Per run (`audit.js`, `newcode-audit.txt`): the `?sha=` of the three files the page loaded, the splash imgs'
  `width` / `height`, the preload links the page made, the CSS rule, the cache rows before and after, and a wait of
  8 s or more past `window.load`. **70 runs, 0 with a problem; no 6.1 frame between insertion and the splash's end
  was left unjudged.**
- `--miniport`: `window.AndroidMiniport` stub set before page scripts. It only answers the page's `hello` with
  `{op:'state', connected:true}` through the page's own `onmessage`; `melatonContinuity.miniport()` then said
  present / enabled / up by the page's code. The badge was never unhidden by the test. The stub's socket never
  opens, so no WebSocket reached the server (unlike the first session: do not compare times across sessions).
- Badge per painted frame (`classify.js`): complete / absent / incomplete. A complete badge in the new code differs
  from the old code's loaded badge by 0.0 grey levels.

- Harness faults found and fixed: (1) the six `off-* FAILED` lines in `newcode-log-other.txt`: the script cut the
  worker off before its own pre-boot check; rerun in `newcode-log-offline.txt`. (2) The first smoke boot (old
  code, about 16:33-16:37) had an init script that did not parse, so that tab ran without the bridge stub AND
  without the `inbox_ack` guard. The server log shows no inbox ack from any source from 16:30 to 17:29. The guard
  is now its own script, and a probe that does not parse stops the run.

## Results (`newcode-summary.txt`, `runs-newcode/`, logs `newcode-log-*.txt`)

Link up before the splash is built. Cached rows. Boots = 8 cores 1x (4), one core (5 + 5 with the order
reversed), 6x (3), 12x (3), offline 1x (2) and 12x (1), per version.

| | old | new |
| --- | --- | --- |
| (a) first splash frame has both pictures | 6 of 23 | **23 of 23** |
| (c) complete badge painted before the splash ended | 23 of 23 | **23 of 23** (unhidden in the same ms as the splash) |

(b) boots that painted an incomplete badge, all 6.1 boots with a link (these, late link, failed load, and for new
also no-preload): **old 18 of 28, new 0 of 34.** Whenever the link was up at insertion, old unhid the badge before
its picture was in; new never unhid it before its picture was in, in any run.

(d) every run, both versions: 1 page request, 1 resource entry and 1 worker fetch per picture; rows cached:
0 worker network requests, also offline (`navigator.onLine` false, both `hit`). **No "preloaded but not used"
warning for either picture.** The detector works: `--bogus-preload` (an unused third picture) was caught in both
versions. Without the Miniport bridge the new page preloads only the emblem; the badge stays hidden (the hidden
`<img>` still asks once, as before).

### The load gate needs the preload

| new JS + CSS, **old `app.html`** (n=2 each) | complete badge painted before the end |
| --- | --- |
| 1x | 2 of 2 (absent in the first frames) |
| 6x | 2 of 2, only just: unhidden 260 / 325 ms before the end, 1 frame |
| 12x | **0 of 2**: unhidden 1799 / 28 ms after the end |

So if the preload is ever not done when the splash is built, a slow boot can show no badge at all (the old code
showed it, incomplete at first). With the preload this did not happen.

**Link late** (state sent 600 ms after the splash is inserted; the delay is the test's choice): old and new the
same, 2 of 2 painted at 1x, 0 of 2 at 12x (the splash is over before the page takes the state in).

**Failed load** (rows deleted + offline, 1 each): old painted the incomplete badge in 11 of 11 splash frames; new
never unhid it. The emblem draws the broken-image icon in both. `newcode-gate-and-failed-load.png`.

**6.5** (2 + 2, `cmp65.js`, `newcode-wm65-compare.txt`, `newcode-wm65-old-vs-new.png`): same emblem box
(104,67, 114x114; computed 113.719px) and badge box (259,822, 138x78; picture 121x51.2). In the last splash
frame, old and new are pixel-identical in both boxes (max difference 0, both pairs). The difference is the first
frame: old collapsed badge, new complete. 6.1 sizes are also equal (emblem 101.297px, badge picture 121x51.2).
`newcode-first-frames.png`.

### Possible cost on one core: leans later, not settled

New minus old, splash insertion in ms: one core, old run first: +285, +212, +384, +265, +170; new run first: +33,
+555, -13, -137, +1664 (that last pair at host load 15-17). Later in 8 of 10 pairs, median about +0.24 s; the
splash's end moved by similar amounts. 8 cores 1x: -355 to +3 (not later). 6x: +626, +211, +215 (3 of 3 later,
old always ran first there). 12x: -782, +399, +1467 (mixed). The preload is a likely reason, not a proven one.

## Not tested

Real Android WebView or emulator, a real Miniport (and its real timing), DeX window, 6.5.1.

## Run again

    PROFILE=old CDP_PORT=9361 ./browser.sh start && CDP_PORT=9361 node install.js && CDP_PORT=9361 node build.js
    # stop it, copy ~/.cache/claude-run/1408/old to .../new, remove Singleton*, start both (new on 9362)
    CDP_PORT=9362 node swap.js new
    ./newmatrix.sh m8 "1 6 12" 3 "old new"        # CPUSET=7 on browser.sh start and here for one core
    node audit.js ~/.cache/claude-run/1408/frames ; node summarize-newcode.js

`build.js` needs a server that still serves the old code; it records whether it does (`newcode-build.json`:
`...ApartFromTheDate` and `servedAppNamesOldBuild` must be true).

