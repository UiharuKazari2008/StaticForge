# Desktop boot sequence (MeletonFX)

How the desktop (`window.isDesktop`, `body.desktop-mode`) comes up, in the order the user
sees it, and which code owns each step. Yozora #401 (parent #399).

## Order on screen

| # | What the user sees | Owner |
|---|--------------------|-------|
| 1 | `/launch` splash, black handoff into `/app` (`body.boot-from-launch`) | `public/launch.html`, inline script in `app.html` |
| 2 | Solid colour (teal, `body.windows-startup`) with the logon dialog `#desktopPreStartupModal`: server status polling, dial beats (Initializing → Dialing → Negotiation → Establishing), password form when the socket is not authenticated | `serviceWorkerManager.js` (`_waitForServerReady`, `_showBootUiEarly`), `websocket.js` (`connect`, `pingHost`, `_renderPreStartupDialog`) |
| 3 | System Update dialog `#windowsUpdateModal` or the install wizard when the service worker has files to fetch | `serviceWorkerManager.js` (`_isPreStartupUpdatePhase`) |
| 4 | "Preparing MeletonFX…", logon dialog closes | `websocket.js` `_completePreStartupHandoff` → `desktopBoot.begin()` |
| 5 | Solid colour only, then the small top-left startup window `#windowsStartupModal` | `desktopBoot.js` stage `session`, `websocket.js` `showWindowsStartupModal` |
| 6 | Staged reveal while init steps run: wallpaper fades in, icons, taskbar slides up, windows | `desktopBoot.js` stages `settings` → `wallpaper` → `icons` → `taskbar` → `windows` |
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

`public/css/desktop-boot.css` hides the wallpaper, icons, taskbar and every `.modal`
without `.boot-dialog` while `body.boot-staged` is set and reveals them per class.
Windows are gated with `visibility` as well as opacity so an open animation (opacity
keyframes) cannot flash one before its stage.

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

After boot, `_applyServerStartupStatus` compares the server start time from `/status`
(`timestamp − uptime`) with the one recorded at boot. A jump larger than
`SERVER_RESTART_DRIFT_MS` (5 s), or `isReady: false`, means the server restarted:

1. `_suspendSession(reason)` sets `sessionSuspended`, clears `preStartupHandoffCompleted`,
   closes the Connection Manager window and calls `desktopBoot.suspend()`.
2. `body.session-suspended` hides every window, the taskbar, desktop icons, the start
   menu, taskbar group menus, tray popups, toasts and tickers behind the solid colour.
   The logon dialog comes back and shows the server's own boot stage and progress
   ("Starting Dreamscape…"), the dial beats, or the password form if the new server
   wants a login.
3. On reconnect `onopen` runs `setActiveWorkspace` and every refresh callback first,
   then `_completePreStartupHandoff` ("Preparing MeletonFX…", dialog closes) calls
   `_resumeSuspendedSession()` → `desktopBoot.resume()`; the desktop returns as it was.

The lock is a no-op while the staged boot itself is running and in non-desktop mode.

## Debugging

- Press `/` while booting to pause stages with the boot debug window
  (`public/scripts/comp/bootUiDebug.js`); Shift on startup steps init one at a time.
- `document.body.dataset.bootStage` and the `boot-reveal-*` classes show where the reveal
  is; `desktopBoot._test.state` holds the queue.
- Events on `document`: `desktopBootBegin`, `desktopBootStage` (`detail.stage`),
  `desktopBootStepStalled`, `desktopBootDone`, `desktopSessionSuspended`,
  `desktopSessionResumed`.
- Tests: `npm run test:desktop-boot`.
