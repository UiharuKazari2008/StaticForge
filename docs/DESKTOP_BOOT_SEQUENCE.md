# Desktop boot sequence (MeletonFX)

How the desktop (`window.isDesktop`, `body.desktop-mode`) comes up, in the order the user
sees it, and which code owns each step. Yozora #401, #410, #412, #416, #417 (parent #399; plan #411).

## Order on screen

| # | What the user sees | Owner |
|---|--------------------|-------|
| 1 | Melaton boot on `/launch` (every desktop start, PWA and tabs): Vista boot screen with the Enso while the server and session are checked; on failure the boot menu; on success a cut to teal and `/app` | `public/launch.html`, `public/scripts/launch/melatonBoot.js` (see below) |
| 2 | Teal (`body.windows-startup`); after max(2 s from the cut, `/app`'s own startup) the logon dialog `#desktopPreStartupModal`: dial beats (Initializing → Dialing → Negotiation → Establishing), password form when the socket is not authenticated | `app.html` teal handoff, `websocket.js` (`_deferPreStartupForTealHold`, `connect`, `pingHost`, `_renderPreStartupDialog`), `serviceWorkerManager.js` (`_waitForServerReady`, `_showBootUiEarly`) |
| 3 | System Update dialog `#windowsUpdateModal` or the install wizard when the service worker has files to fetch | `serviceWorkerManager.js` (`_isPreStartupUpdatePhase`) |
| 4 | "Preparing MeletonFX…", logon dialog closes | `websocket.js` `_completePreStartupHandoff` → `desktopBoot.begin()` |
| 5 | Solid colour only, then the small top-left startup window `#windowsStartupModal` | `desktopBoot.js` stage `session`, `websocket.js` `showWindowsStartupModal` |
| 6 | Staged reveal while init steps run: wallpaper, icons, taskbar, windows, each appearing at once like Windows (no fade, no slide) | `desktopBoot.js` stages `settings` → `wallpaper` → `icons` → `taskbar` → `windows` |
| 7 | "Welcome", startup window closes last | `desktopBoot.finish()` awaited by `hideProgressNotification` |

Each stage holds for at least `desktopBoot.config.dwellMs[stage]` so the sequence reads
even when the init steps finish in a few hundred milliseconds; when a step is slow the
stage simply waits for it. The headline in the startup window belongs to the stage
("Loading your personal settings…", "Applying your personal settings…", "Preparing your
desktop…", "Restoring your windows…"); the real init step runs on the small detail line
underneath, so nothing is hidden from a developer.

## Melaton boot (`/launch`)

`login.js` (PIN login and the already-signed-in redirect) sends desktop starts to `/launch`;
the PWA starts there (`manifest.json` start_url). `public/scripts/launch/desktopStart.js`
applies `app.html`'s desktop rule (viewport ≥ 1200 px and gallery window mode windowed);
a desktop start gets `html.melaton-boot`, narrow / phone starts keep the old card and go
straight on to `/app`.

| Screen | What it is |
|--------|------------|
| boot | Vista's boot screen on a 640×480 stage scaled to fit (letterbox black), sizes in stage pixels as measured from the stock Vista boot screen: two-tone bar frame at x 257–378, y 353–363 (#737373 / #424242), 120×9 interior, a cluster of six 2 px stripes with 2 px gaps (rows #F1F5E1 ×2, #A3B16E ×2, #4D5622 ×5) sliding across in 2 px steps (`--melaton-sweep` 2 s per pass, the one estimated value), "© Dreamscape" centred at y 389–400. The Enso takes the Windows 7 logo's place: 84 px, centred at y 205. Shown at least `minBootMs` (2.5 s). F8 opens the menu (no countdown). |
| teal | Success: cut to teal, `sessionStorage` `dreamscapeLaunchHandoff=teal` + `dreamscapeBootTealHoldUntil` (cut + 2 s), `location.replace('/app')`. `app.html` puts up a teal `#launchHandoff` (removed without a fade) and sets `window.dreamscapeTealHoldUntil`; `websocket.js` holds the logon dialog (and "Preparing MeletonFX…") until then while startup runs underneath. |
| menu | Failure: cut to black, then the Boot Manager text screen ("Melaton Boot Manager"): **Dreamscape Melaton** (retry: black → boot screen → checks) and **Melaton Recovery (Reinstall)**, a 10 s countdown to the highlighted entry, an `Info:` line with the reason, `ENTER=Choose`. ↑/↓/Enter; any key or press stops the countdown; a tap chooses. |
| confirm | Recovery confirm: ENTER continue / ESC back to the menu. Chosen by touch or pen (no keyboard to assume): a two-item menu, **Continue** / **Return to Boot Menu** (tap, or arrows + Enter). |
| recover | "Formatting startup disk..." and a progress bar while the clean install runs: Cache Storage (45 %), SW registrations (10 %), localStorage + sessionStorage (10 %), IndexedDB (35 %; `indexedDB.databases()`, 2 s per database), moving per cache / database inside a step. A failed step does not stop the rest. Then black and `/launch` again. |

Checks under the boot screen (`runChecks`):

- `navigator.onLine === false` → menu (offline).
- `OPTIONS /status` every 2 s with a 4 s timeout. **Any JSON answer counts as connected**: a
  server that is starting keeps the marquee running until it reports `isReady`, however
  long that takes. A client-side timeout means alive but busy (a restarting server's event
  loop is blocked for a while); only `busyTimeoutMs` (2 min) of timeouts with no answer goes
  to the menu. Network errors and proxy error pages (502 …) count up; `maxFailures` (6, ~12 s)
  in a row → menu. An answer resets both.
- `OPTIONS /app` (session): 200 → teal; 401 / 403 → the login page; anything else → menu.

Design mode: `/` on `/launch` (or `/launch?design=1`) pauses the checks; the HUD has a
preset per screen and `/launch?design=1&screen=menu` (`boot`, `menu`, `menu-info`,
`confirm`, `confirm-touch`, `recover`, `teal`, `black`) opens one directly at any window
size; `&hud=0` hides the HUD (clean screenshots). Recovery in design mode never wipes and
nothing navigates. Test: `npm run test:melaton-boot`.

## Stage triggers

| Stage | Triggered by | Body classes |
|-------|--------------|--------------|
| `session` | `begin()` after the logon handoff | `boot-staged`, `data-boot-stage="session"`; `boot-from-launch` removed |
| `settings` | any init step with priority < 12 | — |
| `wallpaper` | step 12 `Loading Workspaces` finished (`onStepDone`) | `boot-reveal-wallpaper` |
| `icons` | queued right after wallpaper | `boot-reveal-icons` |
| `taskbar` | step 16 `Starting Taskbar` finished | `boot-reveal-taskbar` |
| `windows` | step 31 `Loading Gallery` starts | `boot-reveal-windows`; `no-animation` removed |
| `done` | `finish()` | all boot classes removed when the dwell ends |

`public/css/desktop-boot.css` hides the wallpaper, icons, taskbar, `.gallery-window` and
every `.modal` without `.boot-dialog` while `body.boot-staged` is set, and drops each hide
rule when its `boot-reveal-*` class lands. Transitions are off on those layers for the whole
staged boot, so every reveal is instant. Hidden layers use opacity (a child with its own
`visibility: visible`, such as `.gallery`, stays hidden) plus `visibility` (no hits, and an
open animation's opacity keyframes cannot flash a window before its stage).

## Hardening

- **Step watchdog.** `executeInitSteps` races every step against
  `desktopBoot.watchStep(step)`. After `config.stepWatchdogMs` (25 s) the startup window
  reads "Still working on: <step>" and shows **Skip this step**; skipping resolves the race
  and boot continues. Nothing is skipped automatically.
- **Connection drop during boot.** `_renderConnectionDial` routes dial beats into the
  startup window while `desktopBoot.isBooting()`, so the Connection Manager window never
  opens over the splash. The stage queue holds while the phase is `dialing`, `failed` or
  `auth` and continues on `idle`/`connected`. Circuit-breaker failures still go to the
  connectivity error page.
- **Resume, not restart.** Steps that completed in this boot carry `_bootCompleted`; a
  mid-boot reconnect re-enters `executeInitSteps` and skips them (steps flagged
  `runOnReconnect` still run). `resetInitialization()` clears the flags.
- **Splash can never stick.** `finish({ timeoutMs })` caps the wait on the staged reveal
  (`TIMEOUT_BOOT_REVEAL_FINISH`, 15 s) and strips the boot classes.

## Session lock on server restart

After boot, a socket drop sends the Connection Manager through its redial; `pingHost` then
asks `/status`. The session locks when:

- `/status` fails, times out or is not OK (`_suspendIfServerUnreachable`, reason
  `server-unreachable`): the server is down or still loading. During a real restart its
  event loop is busy and `/status` times out for most of the boot, so this is the usual
  trigger, about 2 s after the drop.
- `/status` says `isReady: false` (`server-booting`), or its start time
  (`timestamp − uptime`) jumped more than `SERVER_RESTART_DRIFT_MS` (5 s) from the one
  recorded at boot (`server-restarted`), checked in `_noteServerInstance` before the new
  status is stored.

The same server answering ready (a network blip) does not lock; the Connection Manager
shows its plain dial beat, never the server's "Starting Dreamscape…" stage.

1. `_suspendSession(reason)` sets `sessionSuspended`, clears `preStartupHandoffCompleted`,
   drops the previous server's status (`lastServerStartupStatus`, `serverStartupStatusOk`,
   `serverStartupReady`) so `pingHost` waits like a first boot instead of failing to
   NO CARRIER, clears a tray-only reconnect so the lock dialog always shows, closes the
   Connection Manager window and calls `desktopBoot.suspend()`.
2. `body.session-suspended` puts a teal cover (`body::before`, just under the boot
   dialogs) over everything, and hides every window, gallery grid, the taskbar, desktop
   icons, the start menu, menus, tray popups, toasts and tickers under it, instantly.
   `desktopBoot.suspend()` also adds `windows-classic-theme` to body (only when it was
   not on), so the logon dialog is Windows Classic like the first logon; the layers under
   the cover never show it, and `loadWorkspaces` skips its Classic → Aero swap while
   locked. The dialog shows "Waiting for server…", the new server's boot stage and
   progress, the dial beats, or the password form if the new server wants a login.
3. On reconnect `onopen` runs `setActiveWorkspace` and every refresh callback first,
   then `_completePreStartupHandoff` shows "Preparing MeletonFX…" for a second and calls
   `_resumeSuspendedSession()` → `desktopBoot.resume()` *before* the logon dialog closes,
   so the dialog, the cover and the Classic theme all go under the black cut below; the
   desktop returns as it was.

**Session switch.** Both ways go through one black cut, `#sessionSwitchOverlay` (created
by `desktopBoot`, z 2147482500: above the lock dialogs, below the fatal error page):
lock = black for `config.lockSwitchMs` (500 ms) while the lock screen is built under it;
unlock = black for `config.unlockSwitchMs` (1.5 s) while the cover comes off, Classic swaps
back to Aero and paused loops restart. No fades either way. `desktopSessionSwitchDone`
fires when the black lifts.

**Paused while locked.** `body.session-suspended *:not(.boot-dialog, .boot-dialog *)` (and
their `::before` / `::after`) get `animation-play-state: paused !important`, so the logon
marquee is the only thing moving. `desktopBoot` pause hooks stop JS motion: playing
`<video>` elements (resumed on unlock, only those the lock paused) and the planet
switcher's render loop. Features add their own with
`desktopBoot.registerPauseHook({ pause, resume })` or a function returning its resume
function. Timers, alarms, network, generation and local work are not touched; a window
open/close animation caught by the lock finishes after unlock (`closeModal` resolves on
its 600 ms fallback).

The lock is a no-op while the staged boot itself is running and in non-desktop mode.
Locking and unlocking each cost one full style pass (~150 ms on Yukimi's box), once per
restart.

## Debugging

- Press `/` while booting to pause stages with the boot debug window
  (`public/scripts/comp/bootUiDebug.js`); Shift on startup steps init one at a time.
- `document.body.dataset.bootStage` and the `boot-reveal-*` classes show where the reveal
  is; `desktopBoot._test.state` holds the queue.
- Events on `document`: `desktopBootBegin`, `desktopBootStage` (`detail.stage`),
  `desktopBootStepStalled`, `desktopBootDone`, `desktopSessionSuspended`,
  `desktopSessionResumed`, `desktopSessionSwitchDone` (`detail.locked`).
- Tests: `npm run test:desktop-boot`.
