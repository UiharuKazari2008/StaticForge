# Desktop boot sequence (MeletonFX)

How the desktop (`window.isDesktop`, `body.desktop-mode`) comes up, in the order the user
sees it, and which code owns each step. Yozora #401, #410, #412, #416, #417, #420, #421 (parent #399; plan #411).

## Order on screen

| # | What the user sees | Owner |
|---|--------------------|-------|
| 1 | Melaton boot on `/launch` (every desktop start, PWA and tabs): Vista boot screen with the Enso while the server and session are checked; on failure the boot menu; on success a cut to teal and `/app` | `public/launch.html`, `public/scripts/launch/melatonBoot.js` (see below) |
| 2 | Teal (`body.windows-startup`); after max(2 s from the cut, `/app`'s own startup) the logon dialog `#desktopPreStartupModal`: dial beats (Initializing → Dialing → Negotiation → Establishing), password form when the socket is not authenticated | `app.html` teal handoff, `websocket.js` (`_deferPreStartupForTealHold`, `connect`, `pingHost`, `_renderPreStartupDialog`), `serviceWorkerManager.js` (`_waitForServerReady`, `_showBootUiEarly`) |
| 3 | System Update dialog `#windowsUpdateModal` or the install wizard when the service worker has files to fetch | `serviceWorkerManager.js` (`_isPreStartupUpdatePhase`) |
| 3b | Logon-phase init steps in the logon dialog (desktop first boot): user global settings and **Loading Application Data** (`{ logon: true }`), one status line, no progress bar. A critical failure keeps the dialog on its line and opens a Windows message box (Retry / Restart); the desktop never starts | `websocket.js` `_runLogonInitSteps`, `bootMessageBox.js` (see below) |
| 4 | "Preparing MeletonFX…", logon dialog closes | `websocket.js` `_completePreStartupHandoff` → `desktopBoot.begin()` |
| 5 | Solid colour only, then the small top-left startup window `#windowsStartupModal` | `desktopBoot.js` stage `session`, `websocket.js` `showWindowsStartupModal` |
| 6 | Staged reveal while init steps run: wallpaper, icons, taskbar, windows, each appearing at once like Windows (no fade, no slide) | `desktopBoot.js` stages `settings` → `wallpaper` → `icons` → `taskbar` → `windows` |
| 7 | "Welcome", startup window closes last | `desktopBoot.finish()` awaited by `hideProgressNotification` |

Each stage holds for at least `desktopBoot.config.dwellMs[stage]` so the sequence reads
even when the init steps finish in a few hundred milliseconds; when a step is slow the
stage simply waits for it.

**Wording (Vista, Yukimi 2026-10-12).** The logon dialog reads "Please wait..." for every
stage before the handoff (connection, server status, update check, logon steps) and
"Welcome" at the handoff; the password prompt and connection failures keep their own text,
and the server's real boot stage stays in the stage bar's tooltip
(`websocket.js _preStartupDisplayText`). The small startup window reads "Preparing your
desktop..." for every stage and "Welcome" at the end (`desktopBoot.STAGE_TEXT`); the real
init step is kept on the hidden detail element and logged with `console.debug('[boot] …')`.

## Melaton boot (`/launch`)

`login.js` (PIN login and the already-signed-in redirect) sends desktop starts to `/launch`;
the PWA starts there (`manifest.json` start_url). `public/scripts/launch/desktopStart.js`
applies `app.html`'s desktop rule (viewport ≥ 1200 px and gallery window mode windowed);
a desktop start gets `html.melaton-boot`, narrow / phone starts keep the old card and go
straight on to `/app`.

| Screen | What it is |
|--------|------------|
| boot | Vista's boot screen on a 640×480 stage scaled to fit (letterbox black), sizes in stage pixels as measured from the stock Vista boot screen: two-tone bar frame at x 257–378, y 353–363 (#737373 / #424242), 120×9 interior, a cluster of six 2 px stripes with 2 px gaps (rows #F1F5E1 ×2, #A3B16E ×2, #4D5622 ×5) sliding across in 2 px steps (`--melaton-sweep` 2 s per pass, the one estimated value), "© Dreamscape" centred at y 389–400. The Enso takes the Windows 7 logo's place: 84 px, centred at y 205. Shown at least `minBootMs` (2.5 s). F8 opens the menu (no countdown). |
| teal | Success: cut to black for `modeSwitchMs` (1.5 s, Windows switching graphics modes), then `sessionStorage` `dreamscapeLaunchHandoff=teal` + `dreamscapeBootTealHoldUntil` (now + 2 s) and `location.replace('/app')`, which opens on teal. `app.html` puts up a teal `#launchHandoff` (removed without a fade) and sets `window.dreamscapeTealHoldUntil`; `websocket.js` holds the logon dialog (and "Preparing MeletonFX…") until then while startup runs underneath. |
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

## Default wallpapers (Yozora #419)

`public/static_images/wallpapers/` (3840×2160 WebP), generated with
`scripts/generate-setup-background.js` (GPT Image, Vista desktop aurora composition) and
upscaled:

| File | What |
|------|------|
| `aurora.webp` | The default: the `vista` aurora with the Dreamscape text logo (Mozilla Headline 600, white) on the left of the aurora, its left margin equal to the gap below it. Also the installer backdrop. |
| `aurora-plain.webp` | The same aurora without the logo |
| `aurora-blue.webp`, `aurora-dusk.webp`, `aurora-emerald.webp` | The other palettes, offered as default wallpapers to pick from |

**Default** (Yozora #424): `desktop-shell.css` defines `--desktop-wallpaper-default` (the
`aurora.webp` URL) on `:root`, and `.desktop-wallpaper`, the workstation-lock cover and the
Aero frosted glass (`aeroGlass.readWallpaperUrl`) use it whenever a workspace has no
wallpaper (the server then emits no `--desktop-wallpaper` for it). Nothing is stored for the
default. The teal boot / restart-lock cover stays as it is: it is the "you are not at your
desktop" screen.

**Personalize → Select**: the old "Custom" button is a click menu (`contextMenu`):
**Upload...** (the existing custom upload) and **Stock** ▸ Melaton Aurora (default), Aurora,
Blue Aurora, Dusk Aurora, Emerald Aurora (`STOCK_DESKTOP_WALLPAPERS` in `modalUtils.js`; the
current one is highlighted). A stock pick sets the preview and saves on Save as
`url:/static_images/wallpapers/<file>`; "default" clears the workspace's own wallpaper. The
preview shows the default when the workspace has none.

## Restart (Yozora #420)

A restart is a Windows restart: the shutdown sequence (`modalUtils.runClientShutdownSequence`:
windows close one by one, then a fade to black), then the full Melaton boot on `/launch`
(`restartClientNavigate`; narrow / non-desktop mode reloads in place instead).

| Path | Behaviour |
|------|-----------|
| Start menu **Restart** (`runClientRestartDirect`), restart prompts that call it (`accountDataBootstrap`) | shutdown fade → `/launch` |
| Update **Restart** / **Restart Now**, the agent System Update dialog (`serviceWorkerManager.forceRestart()`) | desktop up: shutdown fade → `/launch`; during boot: straight to `/launch` |
| Spectator error window **Restart** (`fatalErrorBootstrap.restartApplication`) and the reload after a DSS server restart (`serverManagement`) | shutdown fade → `/launch` (the boot screen then covers the server start) |
| Agent `restart_client` (`agentClientBridge.restartClientFromCommand`) | `forceRestart({ direct: true })`: in-place reload, so test reattach stays quick |

Browser refresh (F5 confirm) stays a plain reload.
Test: `npm run test:melaton-restart`.

## Workstation lock (Yozora #423)

The start menu's **Lock** (power options, desktop only) and **Ctrl+Alt+L** (Win+L never
reaches a page) lock the desktop like Windows XP Classic:

- `desktopBoot.lockWorkstation()`: black session-switch cut, `body.workstation-locked`
  hides every window, icon, the taskbar, menus and toasts under a cover that repeats the
  wallpaper (the wallpaper stays, like Windows), Classic theme, animations and render loops
  paused (the same pause hooks as the restart lock; pauses nest when both locks are up).
- `public/scripts/comp/workstationLock.js` shows **Computer Locked** (banner, padlock, "This
  computer is in use and has been locked.", `<domain>\Administrator` (the configured domain
  name), "Press
  Ctrl+Alt+Delete to unlock this computer."). Ctrl+Alt+Delete where the browser passes it,
  Ctrl+Alt+End (the Remote Desktop stand-in), Enter or a click / tap opens **Unlock
  Computer** (user name, password, OK / Cancel; Escape goes back). The password is checked
  with the server's login (same call as the logon dialog); a wrong one gets XP's "The system
  could not log you on…" Logon Message box. Success: `unlockWorkstation()` (black cut, the
  desktop back).
- While locked a critical priority-100 keyboard listener swallows every app shortcut
  (typing in the form still works).
- The lock survives reloads (`localStorage.melatonWorkstationLocked`): the next boot sets
  the logon dialog to its password form before the logon steps (`_requireLogonAfterLock`),
  and a successful logon clears it.
- The restart lock (teal) wins while both are up; when the server is back the workstation is
  still locked.

## Domain connection dialogs (Yozora #427, #428, #429)

The client is a PC joined to a domain; the server is its domain controller, reached through a
VPN connection. Two names, both in `config.json` `userGlobalSettings.desktop`:

- `domainName` (default `DREAMSCAPE`): the domain / network name. It only shows where Windows
  shows the domain: the Domain field of Connect, `DOMAIN\Administrator` on the lock screen,
  the network map and the domain network box, the tray flyout, XP's "domain … is not available".
  Network and Server Center → Customize network name.
- `connectionName` (default `VPN Connection`): the network interface. Dialog titles, the tray
  tooltip and the status dialog use it. Network and Server Center → Rename this connection.

Everything else says "domain controller" (e.g. **Error Connecting to domain controller**). Both
are saved through `persistUserGlobalSettingsPatch`. The public `OPTIONS /status` carries
`melaton: { domain, connectionName, connectionType, device }` (`modules/melatonNetwork.js`):
`Ethernet` when the trusted client IP is private (the LAN through the local nginx), `WAN` over
the Internet; `L-PPoP` is the LANTIS Public Point of Presence (FireStorm load balancer). The
wording is VPN, not modem: Connecting / Reconnecting, "Reconnect attempt n of m", Reconnect.

- **Connecting to <connection>...** (`#connectionDialModal`, Vista VPN dialog,
  `_renderVpnConnectionDialog`): `dialing` → "Connecting to <fqdn> using '<type> Miniport
  (L-PPoP)'...", `negotiation` → "Verifying user name and password...", `establishing` →
  "Registering your computer on the network...", plus "Reconnect attempt n of m." On the
  desktop it keeps out of the way (#434, `placeDesktopWindow` / `desktopWindowOffset`):
  bottom-right of the work area above the taskbar (by the tray), padded 1.8 % of the width
  (16–40 px), and stepped clear of any desktop icons in that band. Cancel (or the title close / Esc) calls
  `wsClient.cancelConnectionFromUser()`: no more reconnects, offline until Connect / Reconnect.
- **Server errors** (#434): on the desktop a WebSocket `error` packet is no longer a toast but
  the **MeletonFX Framework** unhandled-exception window (`mainframeExceptionDialog.js`, .NET's
  ThreadExceptionDialog): "Unhandled exception has occurred in a component in your
  application…" plus the error in Windows language ("Unknown message type" → "Dreamscape
  Mainframe Server Exception: Illegal Operation in Packet"; malformed packet, packet handler
  fault, access denied, operation not permitted, server busy, timed out, object not found,
  invalid argument, internal error). Details ▼ shows a .NET-style report (exception, packet
  type and request id from the pending request, connection); Continue closes, Quit restarts
  through `/launch`. Errors arriving while it is open add to the report (+N more). Logon / boot
  errors, `AUTH_REQUIRED` and narrow mode keep the banner.
- **At the logon screen** (before the handoff and during the restart lock,
  `_shouldShowLogonConnectingDialog`): the connection test (`/status`) and the WebSocket connect
  show the same small dialog on top of the logon dialog, which stays up with "Please wait...".
  Logon-screen windows sit in the bottom-right quadrant, a little off any grid and below the
  logon dialog where the screen allows (`melatonNetworkDialogs.placeLogonWindow`; the Connecting
  dialog and the Mainframe Server window get different spots). A starting server, the password
  prompt, the logon steps and the handoff need no dialog on top; the socket coming up closes it.
- **Dreamscape Mainframe Server** (`mainframeServerWindow.js`): the logon dialog has no progress
  bar; the server's own boot (`/status` `progressPercent`, only while `isReady: false`; an up
  server at a normal logon never opens it) shows in this vendor-style window ("The
  domain controller is starting. Logons are held until the directory is ready.", stage, bar), with
  an animated 256-colour "building blocks" icon: tetrominoes fall into an 8 × 8 well until it is
  exactly full (a fresh gravity-valid tiling per round, `tileWell`), flash, clear, repeat.
- **Boot stream**: once `/status` says the server is booting, `pingHost` stops polling and follows
  `GET /status/stream` (`_followServerBootStream`): NDJSON status lines as the boot moves, then a
  `done` line and the end; "done" sends one more `/status` and the connect goes on. A stream that
  ends early or stalls for 30 s falls back to the 2 s poll; a 404 (older server) disables it. Cancel there gives XP's Logon Message "The system cannot
  log you on now because the domain <domain> is not available." with Retry / Restart; an error
  has no Close (nothing behind it).
- **Error Connecting to domain controller**: the same window with a RAS error for the failure
  message (800 unreachable, 629 closed by the remote computer, 619 connection failed, 868
  offline) and Reconnect / Close / More Info (the raw message). Circuit-breaker failures still go
  to the connectivity error page.
- **Connect <connection>**: when the session needs the password again after boot
  (`handleAuthError` / `ensureSessionValid` → `showPinModal`, which routes to
  `melatonNetworkDialogs.connect.show()` on the desktop). Wrong password → Error 691 message box.
  Cancel closes it but the prompt stays pending; Network and Server Center → "Log on to the
  domain..." opens it again.
- **Network tray icon**: one click opens Vista's flyout ("Currently connected to:" the domain
  network with its access and the VPN connection with its state; Connect or disconnect, Network
  and Server Center); right-click has Connect / Disconnect <connection>, Network and Server
  Center, Diagnose and repair. Tooltip: "<connection> / Access: Local and Internet",
  "Connecting to <connection>...", "Not connected".
- **Control Panel** (`melatonControlPanel.js`, Classic View): Network and Server Center (map,
  domain network box with the connection and View status, server status, tasks), the
  "<connection> Status" dialog (device, duration, latency, messages sent / received),
  Personalization, Remote Access, Runes, System and Dreamscape Services. Settings move in with
  `melatonControlPanel.registerItem({ id, name, image | icon, description, open })`.

Test: `npm run test:melaton-network`.

## Tray balloons and the taskbar (Yozora #435)

A balloon anchored to a tray icon is only shown while the taskbar is on screen
(`desktopBoot.isTaskbarVisible()`: `#desktopTaskbar` not hidden, the staged boot past
`boot-reveal-taskbar`, no `session-suspended` / `workstation-locked`, no black switch). Before,
a balloon fired at the logon screen or during the staged boot landed in the top-left corner
(its anchor had no box). The gate sits in the two places every automatic balloon goes through:

- `PopoverManager.showPopover`: anchors inside `#desktopTaskbar`. Wallet receipts are dropped
  (the wallet shows the balance; `onHide` still runs so toastManager clears its entry), Generation
  Complete is dropped during boot and deferred under a lock, the latency warning is deferred during
  boot and dropped under a lock, everything else (Remote Access, …) is deferred.
- `serviceWorkerManager._showServiceWorkerTrayPopup`: checking / downloading progress and runtime
  compile progress / success are dropped; the restart prompt ("Updates complete"), "Updates
  available" and a compile failure are deferred. Silent update checks no longer show the download
  popup, and compile progress at the logon screen only updates the logon line.

`desktopBoot.whenTaskbarVisible(key, fn)` keeps one deferred notice per key (the latest wins) and
runs it when the taskbar is back (a MutationObserver on the body / taskbar classes, so every path
back counts: staged reveal, resume, unlock). Locks also hide `.popover`, `.network-flyout` and
`.wallet-flyout`, and close the network / wallet flyouts. The notices that should become a dialog
when they fire during startup (the restart prompt, User Data Error, the agent client update
countdown) are listed in #435.

## Logon-phase init steps (Yozora #421)

Application data is mission-critical for the desktop, so on a desktop first boot the init
steps registered with `{ logon: true }` run inside the logon dialog after the SW boot gate
and authentication, before "Preparing MeletonFX…": 0.45 user global settings and
1 **Loading Application Data** (`critical: true`, `failureText`). Everything that builds the
desktop (0.46 start menu layout, 0.5 desktop settings, 0.55 icons, …) stays in the startup
window.

- `_runLogonInitSteps` shows the step on the dialog's status line, no progress bar;
  finished steps get `_logonPhase` and `_bootCompleted`.
- A critical step that throws (`appInitSteps` rethrows `loadOptions` failures while
  `wsClient.isLogonInitPhase()`, instead of its old confirmation dialog) leaves the logon
  dialog on its status line (marquee paused) and opens a Windows message box over it
  (`public/scripts/comp/bootMessageBox.js`: error icon, "MeletonFX could not load your
  application data.", "DETAIL - <reason>", centred 75×23 **Retry** / **Restart**). Retry =
  `retryLogonInitSteps` (the steps again, then the normal handoff); Restart =
  `restartClientNavigate`, a full restart through `/launch`. `_canCompletePreStartupHandoff`
  refuses while the error is up.
- The logon dialog opens only when it is not up yet and keeps an open prompt above it, so
  `loadOptions`' own account-data prompt (account data unavailable) stays reachable.
- A non-critical step that throws is reported as before (application error) and the boot
  goes on.
- `executeInitSteps` then runs only the steps without `_logonPhase`; the small startup
  window's progress is 0–100 % over those (`_initProgressRange`; the non-desktop toast keeps
  its 25 % connection base). `updateCurrentInitStepProgress` reads the list being run.
- Non-desktop starts and reconnects after boot are unchanged; `resetInitialization()` clears
  the flags.

## Stage triggers

| Stage | Triggered by | Body classes |
|-------|--------------|--------------|
| `session` | `begin()` after the logon handoff | `boot-staged`, `data-boot-stage="session"`; `boot-from-launch` removed |
| `settings` | any init step with priority < 12 (from 5 on the desktop; ≤ 1 ran in the logon dialog) | — |
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
  startup window while `desktopBoot.isBooting()`, so the Connecting dialog never
  opens over the splash. The stage queue holds while the phase is `dialing`, `failed` or
  `auth` and continues on `idle`/`connected`. Circuit-breaker failures still go to the
  connectivity error page.
- **Resume, not restart.** Steps that completed in this boot carry `_bootCompleted`; a
  mid-boot reconnect re-enters `executeInitSteps` and skips them (steps flagged
  `runOnReconnect` still run). `resetInitialization()` clears the flags.
- **Splash can never stick.** `finish({ timeoutMs })` caps the wait on the staged reveal
  (`TIMEOUT_BOOT_REVEAL_FINISH`, 15 s) and strips the boot classes.

## Session lock on server restart

After boot, a socket drop sends the Connecting dialog through its reconnect; `pingHost` then
asks `/status`. A `/status` that fails, times out or is not OK does **not** lock (#429,
Yukimi: no teal "secure desktop" before we know): `_noteServerUnreachable` only drops the old
server's status so the poll waits like a first boot instead of failing, and the desktop keeps
"Connecting to <connection>...". The session locks when the server answers and says it
restarted:

- `/status` says `isReady: false` (`server-booting`), or its start time
  (`timestamp − uptime`) jumped more than `SERVER_RESTART_DRIFT_MS` (5 s) from the one
  recorded at boot (`server-restarted`), checked in `_noteServerInstance` before the new
  status is stored.

The same server answering ready (a network blip) does not lock; the Connecting dialog
shows its plain dial line, never the server's "Starting Dreamscape…" stage.

1. `_suspendSession(reason)` sets `sessionSuspended`, clears `preStartupHandoffCompleted`,
   drops the previous server's status (`lastServerStartupStatus`, `serverStartupStatusOk`,
   `serverStartupReady`) so `pingHost` waits like a first boot instead of failing to
   NO CARRIER, clears a tray-only reconnect so the lock dialog always shows, closes the
   Connecting dialog and calls `desktopBoot.suspend()`.
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
