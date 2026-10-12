# Desktop boot sequence (MeletonFX)

How the desktop (`window.isDesktop`, `body.desktop-mode`) comes up, in the order the user
sees it, and which code owns each step. Yozora #401, #410, #412 (parent #399; plan #411).

## Order on screen

| # | What the user sees | Owner |
|---|--------------------|-------|
| 1 | `/launch` splash, black handoff into `/app` (`body.boot-from-launch`) | `public/launch.html`, inline script in `app.html` |
| 2 | Solid colour (teal, `body.windows-startup`) with the logon dialog `#desktopPreStartupModal`: server status polling, dial beats (Initializing → Dialing → Negotiation → Establishing), password form when the socket is not authenticated | `serviceWorkerManager.js` (`_waitForServerReady`, `_showBootUiEarly`), `websocket.js` (`connect`, `pingHost`, `_renderPreStartupDialog`) |
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
