# Fix 1 startup review: what `public/app.html` loads at boot

Review only. No code was changed. Host `dreamscape`, live tree `~/staticforge` at `3ae4762` plus the uncommitted working-tree edits present on 2026-10-14 14:30 ET (including `public/app.html`, `websocket.js`, `serviceWorkerManager.js`, `vistaSidebar.js`, `assetPreload.js`, `workspaceUtils.js`, `cplUpdate.js`, `masterWsBridge.js`, `sw.js`).

## How each file was checked

- **Tag inventory:** parsed `app.html` in order: 195 external scripts, 3 inline scripts, 91 stylesheets (289 tags, 12.36 MB on disk). None use `defer`, `async` or `type=module`.
- **Static call graph (acorn AST):** for every script: top-level declarations and `window.X =` exports; identifiers used at load (top level and IIFEs); identifiers used inside `DOMContentLoaded`/`load` handlers; every file that references each export. A second pass listed **unguarded** call sites (no `typeof X` / `window.X` check nearby) from A/B/D files into each C file. These are the calls that would throw if the file were lazy.
- **Boot hooks:** grep of `registerInitStep(` (48 steps in 41 files), DOMContentLoaded self-registration, `document.write`, the `FEATURE_MANIFEST` in `featureLoader.js` and the Start-menu launch table in `modalUtils.js` (launchId → action).
- **Inline handlers:** `on*=` attributes in the app.html markup, resolved to the file that defines each global.
- **Chrome coverage:** host Chromium (headless, raw CDP from Node, no Puppeteer on the host) on `http://127.0.0.1:9220/app`, logged out, cold profile. Precise JS coverage was taken at DOMContentLoaded, +3 s and +10 s, along with CSS rule usage and a check of which rules match a *visible* element. Two runs: DCL at **33.7 s** and **36.4 s**, load at 35.2 s and 38.4 s. The page showed the Vista logon screen, the WebSocket returned "Authentication required" at about 47 s, and the page redirected to `/launch` at about 58 s.
- **Limitation:** logged out, the app never runs the `registerInitStep` boot (steps 0.45 to 100), so anything those steps touch is only checked statically. Those files are marked **UNVERIFIED (logged-in)**.

## Summary

| Bucket | JS files | JS size | CSS files | CSS size | Total |
|---|---:|---:|---:|---:|---:|
| A: blocking, before first paint | 5 | 47.2 KB | 15 | 1.37 MB | 1.42 MB |
| B: boot, `defer` (CSS: non-blocking, in order) | 100 | 3.69 MB | 27 | 535.0 KB | 4.21 MB |
| C1: on-open, low coupling (do first) | 30 | 1.18 MB | 17 | 393.2 KB | 1.57 MB |
| C2: on-open, Studio bundle / high coupling | 56 | 3.95 MB | 23 | 509.4 KB | 4.45 MB |
| D: idle / after first paint | 5 | 112.9 KB | 8 | 583.7 KB | 696.6 KB |
| E: dead or duplicate (flag only) | 2 | 16.9 KB | 1 | 16.7 KB | 33.5 KB |
| **All** | 198 | 8.99 MB | 91 | 3.37 MB | 12.36 MB |

### Estimated savings (rough)

- **Off the boot path (C+D+E):** 6.73 MB (54% of bytes) and 142 fewer requests at boot. C1 alone is 1.57 MB, C2 (Studio) 4.45 MB.
- **Render-blocking CSS:** 3.37 MB today, 1.37 MB after (A only). About 832.2 KB of that is Font Awesome `all.min.css`, which has 10,509 rules but only 33 visible at first paint; subsetting it would cut roughly another 0.8 MB.
- **JS run before DCL:** 8.99 MB today, 3.73 MB with A+B only. Assuming DCL scales with blocking bytes, the measured cold DCL of about 34 to 36 s (local, unthrottled, first visit) would drop to about **14 to 15 s**, or about 30 s with only C1+D (C2 waiting).
- **First paint:** on Lighthouse's throttled profile, FCP is 16.4 s and LCP 78 s after fix 5. If paint scales with blocking CSS plus head JS, FCP falls to roughly **7 s**, and to about 3 to 4 s with a Font Awesome subset. These are estimates; re-measure after each step.
- **B `defer` on its own** saves almost no bytes, since deferred scripts still run before DCL. Its value is unblocking the parser and paint. The large gains come from C, D and the Font Awesome subset.
- **Cost on first open:** the first time an app opens, it pays its own fetch and parse (Director about 400 KB with CSS, the Studio bundle about 4.5 MB). The service worker already caches by `?sha`, so later opens come from cache.

## Top risks

1. **`document.write` cannot be deferred.** `scripts/ws/inboundHandlerManifest.js` injects 14 WebSocket handler scripts (53 KB) with `document.write`, and inline@390 writes `#launchHandoff`. Deferred scripts ignore `document.write`, so the 14 handlers would silently never load. Rewrite the manifest to append real `<script defer>` tags, or list the 14 in app.html, before deferring anything after it.
2. **Inline `onclick` globals in app.html:** `window.directorInstance.toggleSessionPreview()` (director.js, C1) and `createTextReplacement()` / `showFavoritesManager()` (textReplacementManager.js, C2). Swap them for `featureLoader` wrappers, or the buttons throw. `closeModal()` (modalUtils.js) stays B, so it is safe.
3. **Tray code calls C files without a guard at boot:** `systemTrayManager.js` calls `initializeDirectorTray()` (director.js) and `initializeDovecoteTray()` / `doveRefreshTrayUnread()` (dovecote.js) without checks. Split the tray parts into small B files before Director and Dovecote become lazy.
4. **41 component files register init steps at load.** Moving a file to C drops its step: Director step 60, inpaint 39, referenceManager 40, textReplacementManager 45, presetManager 461, and the Studio listener-scope steps 460 to 487. Those steps need to move into each feature's on-open hook, and their order must be kept.
5. **Cross-app coupling into Studio (C2).** `manualModalManager.js` has 94 unguarded references from eager files (agentClientBridge `openManualModalWithContent`, keyboardShortcuts, bulkOperations, desktopShortcuts and others). `appInitSteps` reads `manualPrompt`/`manualUc` and calls `generate*Options`, `initializeEmphasisOverlay` and `bindPromptListTokenizer` during boot. Studio needs a facade (stub globals that call `loadFeature("studio")`) before it can be lazy. Do it after C1. **UNVERIFIED (logged-in)**: a restored Studio session may open Studio right after login, which would pull C2 in anyway.
6. **Agent and MCP entry points:** `open_application`, `apply_studio`, `print_studio`, `get_calculator`/`set_calculator`, `open_image` and `ledge` reach C code through agentClientBridge. Each call must `await featureLoader.loadFeature(...)` before acting, or agent tools break when the app has not been opened yet.
7. **Desktop shell CSS:** `vista-explorer.css`, `7.scoped.css`, `windows-classic-theme.css`, `vista-dialogs.css` and `desktopAppWindows.css` style windows across many apps, so they stay B (non-blocking but loaded at boot). `desktopAppWindows.css` must load before any C1 desktop app opens. `manual-modal-generate.css`, `-viewer.css` and `-preview-tools.css` matched a few *visible* rules on the logon screen. Those are probably generic selectors, but check them before moving to C2.
8. **Load order of `featureLoader.js`:** it currently sits near the end (line 8952), after modalUtils. C stubs need it loaded first. Its `_loadScript` must use the same `?sha=` URLs as the service worker's static cache, and `sw.js` precache lists need updating.
9. **Self-registering files** (cpl*, windowsDefender, vistaImportWizard, vistaSidebar, presetManager, characterPromptManager and others) hook `DOMContentLoaded`. When loaded late they must register right away. The cpl* files already check `document.readyState`; confirm the rest do.
10. **Background behaviour:** alarms in `alarmPomodoro.js`, Dovecote unread badges/toasts and Director long-job notices may need code running while their window is closed. Check for timers or WebSocket listeners before moving them; leave a small B piece if needed.
11. **The live tree has uncommitted edits** in app.html and eight boot files. Implement against a committed tree, and re-run this review's scripts afterwards.

### Found along the way (not fix 1)

- Console: `Predictionary not available ... Failed to resolve module specifier 'predictionary'` (autocomplete falls back to basic ranking).
- `protected/fflate.js` is referenced by app.html but is not on disk under `public/protected/` (the t5 and qwen tokenizers are). Logged out it returns 403, so a logged-in 404 is possible. Unverified.
- The service worker's hash check fetched every CSS file again during boot (logged as "Hash mismatch ... adding to update list"), competing with the page load. Move it to idle (D).
- `css/image-prompt-inspector.css` is linked in app.html and also in `FEATURE_MANIFEST.image_prompt_inspector`, so it loads twice.

## Suggested order for fix 1

1. Remove the `document.write` from inboundHandlerManifest; move `featureLoader.js` early; add `FEATURE_MANIFEST` entries and stubs for C1.
2. Split the Director and Dovecote tray code; wrap the launch-table actions, inline onclicks and agentClientBridge entry points with `loadFeature`.
3. Move C1 and D files; switch B CSS to non-blocking; `defer` the B scripts in their current order. Measure.
4. Subset Font Awesome. Measure.
5. Studio facade, then C2. Measure logged in.

## A: blocking before first paint (20 files, 1.42 MB)

| File | Line | Size | Why | Evidence |
|---|---|---|---|---|
| `scripts/comp/fatalErrorBootstrap.js` | 10 | 39.2 KB | Installs global error/fatal-overlay handlers; must exist before any other script can throw. | boot fns run: 8/48; used by 3 files |
| `inline@13` | 13 | 2.9 KB | Sets `isDesktop`, `galleryWindowPreference`, html classes (safe mode, hover) before CSS applies; read at top level by modalUtils/assetPreload. | boot fns run: None/None; used by 38 files |
| `css/fonts.css` | 223 | 14.4 KB | @font-face only; needed before text paints (consider font-display:swap). | visible rules 0 / matched 0 / total 0 |
| `dist/fontawesome/css/all.min.css` | 224 | 832.2 KB | 852 KB, 10,509 rules, only 33 visible at first paint. Keep blocking for now but SUBSET it (biggest single CSS win, ~800 KB). | visible rules 33 / matched 265 / total 10509 |
| `css/app.css` | 225 | 140.4 KB | Visible on the logged-out first screen (57 visible rules) | visible rules 57 / matched 267 / total 649 |
| `css/workspaces.css` | 226 | 94.1 KB | Runtime-compiled workspace theme served by runtimeAssetService; size measured over HTTP (96 KB). | visible rules 1 / matched 1 / total 29 |
| `css/desktop-shell.css` | 231 | 65.7 KB | Visible on the logged-out first screen (8 visible rules) | visible rules 8 / matched 91 / total 292 |
| `css/menu-chrome.css` | 233 | 2.4 KB | Shell/boot styling; must not flash. | visible rules 0 / matched 3 / total 7 |
| `css/toasts.css` | 295 | 7.8 KB | Visible on the logged-out first screen (5 visible rules) | visible rules 5 / matched 5 / total 41 |
| `css/fatal-error.css` | 300 | 7.2 KB | Fatal overlay must style even if boot dies before any lazy load. | visible rules 0 / matched 15 / total 40 |
| `css/desktop-boot.css` | 310 | 43.8 KB | Visible on the logged-out first screen (53 visible rules) | visible rules 53 / matched 107 / total 184 |
| `css/modal-window-title-toolbar.css` | 328 | 80.1 KB | Visible on the logged-out first screen (6 visible rules) | visible rules 6 / matched 180 / total 268 |
| `css/desktop-cursors.css` | 366 | 5.1 KB | Visible on the logged-out first screen (2 visible rules) | visible rules 2 / matched 2 / total 5 |
| `css/aero-glass.css` | 367 | 21.0 KB | Visible on the logged-out first screen (3 visible rules) | visible rules 3 / matched 4 / total 31 |
| `css/vista-glass-controls.css` | 368 | 60.9 KB | Visible on the logged-out first screen (5 visible rules) | visible rules 5 / matched 79 / total 132 |
| `css/vista-scrollbars.css` | 373 | 32.1 KB | Visible on the logged-out first screen (4 visible rules) | visible rules 4 / matched 6 / total 150 |
| `css/hidden.css` | 379 | 0.6 KB | Visible on the logged-out first screen (1 visible rules) | visible rules 1 / matched 2 / total 5 |
| `inline@390` | 390 | 3.0 KB | `document.write` of #launchHandoff and `dismissLaunchHandoffIfNeeded`; document.write is ignored in deferred scripts. | boot fns run: None/None; used by 2 files |
| `inline@451` | 451 | 0.9 KB | Adds desktop-mode / windows-startup / vista-logon body classes before first paint (avoids flash of wrong shell). | boot fns run: None/None; used by 0 files |
| `scripts/ws/inboundHandlerManifest.js` | 8776 | 1.3 KB | Uses `document.write` to inject 14 ws handler scripts (53 KB). Breaks under defer. Must stay blocking OR be rewritten to emit real <script defer> tags (recommended), after which it is B. | boot fns run: 1/1; used by 0 files |

## B: needed at boot, defer (CSS non-blocking) with order kept (127 files, 4.21 MB)

| File | Line | Size | Why | Evidence |
|---|---|---|---|---|
| `css/custom-dropdown.css` | 228 | 18.0 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 28 / total 114 |
| `css/modal-dimensions.css` | 237 | 1.2 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 14 / total 16 |
| `css/modal-theme-glass.css` | 239 | 6.9 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 6 / total 28 |
| `css/context-menu.css` | 241 | 28.1 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 10 / total 159 |
| `css/gallery-toolbar.css` | 243 | 14.8 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 1 / matched 22 / total 69 |
| `css/gallery-core.css` | 245 | 31.4 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 1 / matched 53 / total 182 |
| `css/gallery-move.css` | 247 | 35.2 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 5 / matched 71 / total 174 |
| `css/novel-tool.css` | 255 | 3.2 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 10 / total 19 |
| `css/studio-activity-tool.css` | 257 | 2.6 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 8 / total 18 |
| `css/custom-scrollbar.css` | 265 | 3.3 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 4 / total 17 |
| `css/genso-lock.css` | 267 | 25.7 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 22 / total 155 |
| `css/keyboard-shortcuts.css` | 302 | 12.4 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 8 / total 72 |
| `css/window-switcher.css` | 304 | 4.2 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 0 / total 13 |
| `css/confirmation-dialogs.css` | 306 | 15.9 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 0 / total 107 |
| `css/connection-dial.css` | 312 | 1.3 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 6 / total 8 |
| `css/melaton-network.css` | 314 | 54.3 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 21 / total 354 |
| `css/wallet-tray.css` | 316 | 11.9 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 3 / total 77 |
| `css/windows-classic-theme.css` | 340 | 13.5 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 0 / total 39 |
| `css/service-worker-tray.css` | 342 | 3.3 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 0 / total 21 |
| `css/gallery-loading.css` | 344 | 0.3 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 1 / total 1 |
| `css/7.scoped.css` | 346 | 82.0 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 36 / total 297 |
| `css/pin-modal.css` | 348 | 4.1 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 1 / matched 21 / total 26 |
| `css/desktop-apps/desktopAppWindows.css` | 362 | 14.7 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 0 / total 74 |
| `css/vista-menus.css` | 370 | 16.6 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 3 / total 45 |
| `css/vista-explorer.css` | 371 | 100.5 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 125 / total 327 |
| `css/vista-dialogs.css` | 374 | 19.5 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 35 / total 63 |
| `css/vista-visual-index.css` | 376 | 10.3 KB | No visible rules on the logged-out screen; used by shell windows/menus after login. Load non-blocking (preload + onload swap, or append at DCL) in original order. UNVERIFIED logged-in. | visible rules 0 / matched 12 / total 21 |
| `scripts/utils/deviceUtils.js` | 383 | 3.2 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 3/10; used by 9 files |
| `scripts/utils/dreamscapeClipboard.js` | 384 | 20.0 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 2/37; used by 14 files |
| `scripts/utils/touchSlopUtils.js` | 385 | 1.7 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/4; used by 7 files |
| `scripts/utils/wheelTickGate.js` | 386 | 0.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/3; used by 14 files |
| `scripts/comp/toastManager.js` | 8767 | 56.4 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 2/45; used by 74 files |
| `scripts/comp/popoverManager.js` | 8768 | 26.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/18; used by 5 files |
| `scripts/comp/contextMenu.js` | 8769 | 169.7 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 8/131; used by 43 files |
| `scripts/comp/windowGeometry.js` | 8770 | 5.5 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 6/12; used by 1 files |
| `scripts/comp/modalUtils.js` | 8771 | 431.9 KB | 442 KB, 526 globals, used by 89 files; owns Start menu launch table + window manager. Biggest B file; splitting the launch table from window helpers is a later step. | boot fns run: 154/616; used by 89 files |
| `scripts/comp/modalListenerScope.js` | 8772 | 3.7 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 8/11; used by 23 files |
| `scripts/comp/modalKeyboardRegistry.js` | 8773 | 32.4 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 22/68; used by 33 files |
| `scripts/comp/bootUiDebug.js` | 8774 | 12.9 KB | Debug overlay but `bootUiDebug` is referenced by appInitSteps; defer (could become D with a no-op shim). | boot fns run: 6/31; used by 3 files |
| `scripts/ws/wsInboundRegistry.js` | 8775 | 4.3 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 5/13; used by 3 files |
| `scripts/comp/generationProgress.js` | 8777 | 8.9 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/4; used by 4 files |
| `scripts/comp/desktopBoot.js` | 8778 | 29.1 KB | Boot/logon screen; 9 fns ran at DCL logged out (this is the visible first screen). | boot fns run: 9/49; used by 0 files |
| `scripts/comp/desktopSounds.js` | 8779 | 10.1 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 14/32; used by 0 files |
| `scripts/comp/desktopCursors.js` | 8780 | 3.2 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 5/9; used by 0 files |
| `scripts/comp/desktopTaskMonitor.js` | 8781 | 8.7 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 7/14; used by 0 files |
| `scripts/comp/bootMessageBox.js` | 8782 | 5.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/4; used by 0 files |
| `scripts/comp/workstationLock.js` | 8783 | 14.7 KB | Lock/logon screen logic. | boot fns run: 2/18; used by 0 files |
| `scripts/comp/melatonNetworkDialogs.js` | 8784 | 19.7 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 12/24; used by 0 files |
| `scripts/comp/mainframeServerWindow.js` | 8785 | 13.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 14/19; used by 0 files |
| `scripts/comp/mainframeExceptionDialog.js` | 8786 | 11.5 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/19; used by 0 files |
| `scripts/websocket.js` | 8795 | 413.2 KB | Core client; `wsClient` used at boot by 41 files and registers every init step. | boot fns run: 91/573; used by 87 files |
| `scripts/comp/serviceWorkerManager.js` | 8797 | 180.9 KB | app.js awaits `serviceWorkerManager.ensureBootComplete()` at DCL. Defer is fine; but its precache/hash pass (seen fetching every css/js after DCL) should move to idle. | boot fns run: 53/196; used by 14 files |
| `scripts/comp/dropdown.js` | 8798 | 15.3 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/19; used by 18 files |
| `scripts/comp/lightbox.js` | 8800 | 52.0 KB | Registers init step 36 (PhotoSwipe); used by 11 files incl. gallery and agent open_image. Candidate for C later (trigger: first image open), needs stub for `openLightbox*`. Init steps: 36, Initializing PhotoSwipe Lightbox | boot fns run: 0/33; used by 11 files |
| `scripts/comp/copyLookback.js` | 8801 | 4.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/9; used by 5 files |
| `scripts/comp/imageViewer.js` | 8802 | 66.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 3/75; used by 14 files |
| `scripts/comp/blurhashUtil.js` | 8803 | 5.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/12; used by 0 files |
| `scripts/comp/workspaceUtils.js` | 8806 | 152.2 KB | Steps 11-16, 87 (workspace, taskbar, background). Shell-critical. Init steps: 11, Initializing workspace system; 12, Loading Workspaces; 14, Setting up workspace events; 15, Setting up workspace settings; 16, Starting Taskbar; 87, Initializing background layers | boot fns run: 0/112; used by 43 files |
| `scripts/comp/textareaUtils.js` | 8807 | 19.0 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 4/21; used by 24 files |
| `scripts/utils/referenceUtils.js` | 8822 | 2.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/4; used by 6 files |
| `protected/fflate.js` | 8830 | logged-in only | Logged-in only (403 logged out, not measured). Tokenizers are used by init step 5 "Initializing Tokenizer"; fflate.js not found on disk under public/protected. UNVERIFIED: tokenizers could be C (Studio) if step 5 becomes lazy. | boot fns run: None/None; used by 0 files |
| `protected/t5-tokenizer.js` | 8831 | logged-in only | Logged-in only (403 logged out, not measured). Tokenizers are used by init step 5 "Initializing Tokenizer"; fflate.js not found on disk under public/protected. UNVERIFIED: tokenizers could be C (Studio) if step 5 becomes lazy. | boot fns run: None/None; used by 0 files |
| `protected/qwen-tokenizer.js` | 8832 | logged-in only | Logged-in only (403 logged out, not measured). Tokenizers are used by init step 5 "Initializing Tokenizer"; fflate.js not found on disk under public/protected. UNVERIFIED: tokenizers could be C (Studio) if step 5 becomes lazy. | boot fns run: None/None; used by 0 files |
| `scripts/comp/emphasisHighlight.js` | 8838 | 47.6 KB | appInitSteps calls `initializeEmphasisOverlay` at boot. | boot fns run: 0/44; used by 22 files |
| `scripts/comp/dsapRegistry.js` | 8843 | 42.2 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 16/56; used by 17 files |
| `scripts/comp/dsapManifests.js` | 8845 | 14.9 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/15; used by 6 files |
| `scripts/comp/dreamscapeHomeDsap.js` | 8848 | 2.4 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/7; used by 0 files |
| `scripts/ws/wsDispatchPolicy.js` | 8849 | 3.0 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/4; used by 1 files |
| `scripts/comp/confirmationDialog.js` | 8851 | 31.3 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/18; used by 40 files |
| `scripts/comp/vistaDialogs.js` | 8852 | 11.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 14/18; used by 0 files |
| `scripts/comp/galleryToolbar.js` | 8855 | 22.3 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/16; used by 2 files |
| `scripts/comp/wheelScrollLock.js` | 8856 | 3.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/2; used by 0 files |
| `scripts/comp/customScrollbar.js` | 8857 | 29.0 KB | step 25. Init steps: 25, Initializing Scrollbars | boot fns run: 0/24; used by 16 files |
| `scripts/comp/pinModal.js` | 8858 | 7.5 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/14; used by 2 files |
| `scripts/comp/keyboardShortcuts.js` | 8860 | 71.0 KB | Global hotkeys + Alt-Tab (step 50). Init steps: 50, Initializing Keyboard Shortcuts | boot fns run: 2/58; used by 6 files |
| `scripts/comp/virtualKeyboard.js` | 8861 | 32.7 KB | `initVirtualKeyboard` is called unguarded in app.js DCL; 23 fns ran. Could be D if app.js call is guarded. | boot fns run: 23/62; used by 3 files |
| `scripts/comp/assetUrlResolver.js` | 8864 | 5.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/16; used by 30 files |
| `scripts/comp/masterWsBridge.js` | 8865 | 17.9 KB | Called from appBootstrap.js (replication master link). | boot fns run: 0/29; used by 1 files |
| `scripts/comp/replicationGalleryBanner.js` | 8866 | 2.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/5; used by 2 files |
| `scripts/comp/galleryMetadataCache.js` | 8867 | 10.9 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 18/34; used by 2 files |
| `scripts/comp/appSplash.js` | 8868 | 3.5 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/6; used by 2 files |
| `scripts/comp/galleryJumpIndex.js` | 8869 | 31.5 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/26; used by 2 files |
| `scripts/comp/galleryImagesLoad.js` | 8870 | 28.9 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/55; used by 6 files |
| `scripts/comp/galleryView.js` | 8871 | 407.2 KB | 417 KB; appInitSteps step 30/31 builds gallery. Logged-in boot path. Init steps: 30, Initializing Gallery System | boot fns run: 1/250; used by 34 files |
| `scripts/comp/vfsClient.js` | 8872 | 4.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/33; used by 10 files |
| `scripts/comp/vfsSystemOpenRouter.js` | 8875 | 10.1 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/13; used by 1 files |
| `scripts/comp/desktopShortcuts.js` | 8876 | 178.8 KB | Desktop icons (step 18). 183 KB; shell-critical after login. Init steps: 18, Loading Desktop Shortcuts | boot fns run: 1/142; used by 2 files |
| `scripts/comp/fileSearch.js` | 8885 | 50.2 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 7/57; used by 6 files |
| `scripts/comp/promptListFold.js` | 8888 | 33.1 KB | appInitSteps calls `bindPromptListTokenizer`. | boot fns run: 0/58; used by 50 files |
| `scripts/comp/utilities.js` | 8889 | 141.7 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 19/113; used by 61 files |
| `scripts/comp/manualDropdownManager.js` | 8891 | 151.6 KB | appInitSteps calls generateModelOptions/... at boot and registers step 486; keep B until Studio split. Init steps: 486, Manual resolution and dropdown listeners | boot fns run: 0/127; used by 32 files |
| `scripts/comp/novelContextMenu.js` | 8901 | 8.8 KB | appInitSteps calls `setupNovelContextMenu`. | boot fns run: 0/2; used by 2 files |
| `scripts/comp/textDisplayStyles.js` | 8909 | 13.5 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 2/13; used by 2 files |
| `scripts/comp/agentClientUpdateDialog.js` | 8912 | 15.9 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/17; used by 2 files |
| `scripts/comp/agentClientBridge.js` | 8913 | 63.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 9/58; used by 2 files |
| `scripts/comp/focusOverlayManager.js` | 8921 | 10.3 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/4; used by 2 files |
| `scripts/comp/mainMenuManager.js` | 8922 | 64.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/3; used by 7 files |
| `scripts/comp/novelAiAccountStatus.js` | 8923 | 10.4 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/17; used by 22 files |
| `scripts/comp/accountDataBootstrap.js` | 8924 | 13.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/19; used by 13 files |
| `scripts/comp/exitConfirmation.js` | 8926 | 4.2 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/8; used by 11 files |
| `scripts/comp/trayIndicators.js` | 8927 | 18.3 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/23; used by 16 files |
| `scripts/comp/mcpActivityClient.js` | 8928 | 15.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 4/31; used by 3 files |
| `scripts/comp/studioActivityTool.js` | 8929 | 8.0 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/9; used by 3 files |
| `scripts/comp/runpodTray.js` | 8930 | 6.4 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/13; used by 1 files |
| `scripts/comp/walletTray.js` | 8931 | 56.4 KB | Self-registers tray item on DCL. | boot fns run: 1/65; used by 0 files |
| `scripts/comp/systemTrayManager.js` | 8932 | 25.4 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 3/11; used by 5 files |
| `scripts/comp/windowControlsOverlay.js` | 8933 | 19.1 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 7/13; used by 2 files |
| `scripts/comp/errorDisplay.js` | 8934 | 3.9 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/6; used by 17 files |
| `scripts/comp/themePreferences.js` | 8935 | 2.5 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/5; used by 3 files |
| `scripts/comp/aeroGlass.js` | 8936 | 23.8 KB | Self-registers; 14 functions ran at boot (glass on lock screen). | boot fns run: 14/35; used by 0 files |
| `scripts/comp/appBootstrap.js` | 8937 | 7.5 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/3; used by 30 files |
| `scripts/comp/balanceDisplay.js` | 8938 | 6.3 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/15; used by 12 files |
| `scripts/comp/generationOrchestrator.js` | 8940 | 13.3 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/4; used by 15 files |
| `scripts/comp/studioSession.js` | 8941 | 36.0 KB | Studio session restore at login (unverified logged-in). | boot fns run: 0/41; used by 4 files |
| `scripts/comp/androidNotificationBridge.js` | 8942 | 6.3 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/9; used by 8 files |
| `scripts/comp/connectionManager.js` | 8943 | 7.4 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/8; used by 11 files |
| `scripts/comp/manualFormHelpers.js` | 8944 | 3.4 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/4; used by 5 files |
| `scripts/comp/manualUploadHandlers.js` | 8945 | 4.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/4; used by 11 files |
| `scripts/comp/galleryActions.js` | 8946 | 22.6 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/14; used by 9 files |
| `scripts/comp/bulkOperationsManager.js` | 8947 | 27.1 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/14; used by 2 files |
| `scripts/comp/uiResize.js` | 8948 | 1.1 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/2; used by 1 files |
| `scripts/comp/cacheAndReadOnly.js` | 8949 | 7.7 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/3; used by 2 files |
| `scripts/comp/windowManagementHelpers.js` | 8950 | 10.0 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/4; used by 1 files |
| `scripts/appWebSocketHandlers.js` | 8951 | 4.8 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/7; used by 0 files |
| `scripts/comp/featureLoader.js` | 8952 | 8.0 KB | Must be moved EARLY (before any C stubs and before modalUtils) once C stubs exist. | boot fns run: 1/11; used by 30 files |
| `scripts/appInitSteps.js` | 8953 | 17.5 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 0/17; used by 1 files |
| `scripts/app.js` | 8955 | 1.9 KB | Used at boot (DCL/init steps) or by many boot files; defer with order kept. | boot fns run: 1/3; used by 9 files |

## C1: dynamic load on open, low coupling (47 files, 1.57 MB)

| File | Line | Size | Trigger | Globals others expect / unguarded eager call sites | Evidence |
|---|---|---|---|---|---|
| `css/desktop-settings.css` | 235 | 20.7 KB | Control Panel (cpl-settings-host) | 0 visible rules logged out (62 of 100 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 62 / total 100 |
| `css/lightbox.css` | 249 | 21.3 KB | first image open (with lightbox.js) | 0 visible rules logged out (42 of 132 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 42 / total 132 |
| `css/director.css` | 277 | 79.3 KB | Director | 0 visible rules logged out (84 of 452 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 84 / total 452 |
| `css/memoriesDsap.css` | 296 | 6.9 KB | memories DSAP | 0 visible rules logged out (0 of 43 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 43 |
| `css/dsap-smf.css` | 298 | 19.4 KB | DSAP applets | 0 visible rules logged out (0 of 84 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 84 |
| `css/about-melaton.css` | 308 | 2.6 KB | About dialog | 0 visible rules logged out (11 of 21 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 11 / total 21 |
| `css/websocket-requests.css` | 318 | 7.5 KB | WebSocket requests window | 0 visible rules logged out (16 of 56 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 16 / total 56 |
| `css/grimoire-browser.css` | 330 | 22.8 KB | grimoire feature | 0 visible rules logged out (13 of 140 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 13 / total 140 |
| `dist/photoswipe/photoswipe.css` | 350 | 6.8 KB | first image open (with lightbox.js) | 0 visible rules logged out (0 of 52 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 52 |
| `css/desktop-apps/mediaPlayer.css` | 361 | 36.6 KB | media-player | 0 visible rules logged out (0 of 181 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 181 |
| `css/desktop-apps/dovecote.css` | 363 | 50.4 KB | dovecote | 0 visible rules logged out (2 of 223 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 2 / total 223 |
| `css/desktop-apps/emotion.css` | 364 | 5.5 KB | emotion | 0 visible rules logged out (0 of 28 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 28 |
| `css/vista-director.css` | 369 | 22.6 KB | Director | 0 visible rules logged out (29 of 73 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 29 / total 73 |
| `css/vista-defender.css` | 372 | 11.0 KB | Control Panel / Defender | 0 visible rules logged out (0 of 75 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 75 |
| `css/vista-sidebar.css` | 375 | 36.0 KB | vista-sidebar (or boot if enabled) | 0 visible rules logged out (0 of 293 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 293 |
| `css/vista-calculator.css` | 377 | 17.2 KB | calculator | 0 visible rules logged out (0 of 57 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 57 |
| `css/vista-import-wizard.css` | 378 | 26.4 KB | Import wizard | 0 visible rules logged out (72 of 91 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 72 / total 91 |
| `scripts/comp/melatonControlPanel.js` | 8787 | 53.8 KB | Control Panel open (Start / cpl links) | cpl* files self-register on DCL into the panel -> must load as one `control_panel` feature | boot fns run: 6/64; used by 0 files |
| `scripts/comp/cplAuthentication.js` | 8788 | 24.3 KB | Control Panel | registers on DCL | boot fns run: 2/21; used by 0 files |
| `scripts/comp/cplUpdate.js` | 8789 | 16.5 KB | Control Panel | registers on DCL; RISK uncommitted edits in live tree | boot fns run: 2/22; used by 0 files |
| `scripts/comp/cplUserAccounts.js` | 8790 | 18.6 KB | Control Panel | registers on DCL | boot fns run: 6/31; used by 0 files |
| `scripts/comp/windowsDefender.js` | 8791 | 18.4 KB | Control Panel / Defender | registers item on DCL | boot fns run: 2/18; used by 0 files |
| `scripts/comp/cplSearch.js` | 8792 | 10.5 KB | Control Panel | registers on DCL | boot fns run: 2/15; used by 0 files |
| `scripts/comp/cplMail.js` | 8793 | 5.0 KB | Control Panel | registers on DCL | boot fns run: 2/15; used by 0 files |
| `scripts/comp/cplDesktopBackground.js` | 8794 | 15.8 KB | Control Panel / Personalize | registers on DCL | boot fns run: 2/18; used by 0 files |
| `scripts/comp/uploadHandlers.js` | 8825 | 8.1 KB | launchId `import` / drag-drop upload |  | boot fns run: 0/5; used by 2 files |
| `scripts/comp/reference/pngMetadata.js` | 8826 | 17.1 KB | Import / reference upload | ; unguarded: utilities.js→determineModelFromMetadata | boot fns run: 0/15; used by 2 files |
| `scripts/comp/referenceContextMenu.js` | 8827 | 42.7 KB | Reference manager |  | boot fns run: 0/19; used by 1 files |
| `scripts/comp/dsapSmfMarkup.js` | 8844 | 9.4 KB | DSAP applet windows (memories etc.) | ; unguarded: dreamscapeHomeDsap.js→dsapSmfBuildDreamscapeHomeHtml | boot fns run: 0/15; used by 1 files |
| `scripts/comp/grimoireCoreDomains.js` | 8847 | 13.4 KB | Grimoire feature (`grimoire`) | self-registers domains with dsapRegistry at load -> add to FEATURE_MANIFEST.grimoire | boot fns run: 0/7; used by 0 files |
| `scripts/comp/websocketRequestsModal.js` | 8850 | 25.4 KB | WebSocket requests window (tray/diagnostics) | step 480; unguarded: app.html→websocketRequestsModal | boot fns run: 5/28; used by 0 files |
| `scripts/comp/vistaImportWizard.js` | 8853 | 6.6 KB | Import wizard | registers on DCL | boot fns run: 6/9; used by 0 files |
| `scripts/comp/runCommandIndex.js` | 8859 | 69.5 KB | Run feature (`run`, Win+R) | 85 globals, used by runApplet; unguarded: imageViewer.js→handlePhasewalkerContextSubmenuAction | boot fns run: 0/67; used by 4 files |
| `scripts/comp/vfsVirtualGrid.js` | 8873 | 36.5 KB | Cartograph (`explorer` feature) | only explorer uses; unguarded: studioSession.js→VfsVirtualGrid | boot fns run: 0/57; used by 1 files |
| `scripts/comp/vfsImportRouter.js` | 8874 | 7.3 KB | Cartograph (`explorer` feature) | only explorerApplet uses `vfsImportRouter`; unguarded: app.html→vfsImportRouter | boot fns run: 0/10; used by 0 files |
| `scripts/comp/desktop-apps/calculator.js` | 8877 | 74.9 KB | launchId `calculator`; agent `get_calculator`/`set_calculator` | `readDesktopCalculatorForAgent`, `applyDesktopCalculatorAgentAction` called by agentClientBridge -> needs async stub; unguarded: agentClientBridge.js→applyDesktopCalculatorAgentAction, agentClientBridge.js→readDesktopCalculatorForAgent, modalUtils.js→openDesktopCalculator | boot fns run: 4/128; used by 3 files |
| `scripts/comp/desktop-apps/alarmPomodoro.js` | 8878 | 24.0 KB | launchId `alarm` / `pomodoro` | RISK: alarms must fire while window closed; verify no background timer state before moving; unguarded: modalUtils.js→openDesktopAlarm, modalUtils.js→openDesktopPomodoro | boot fns run: 0/44; used by 1 files |
| `scripts/comp/desktop-apps/startMenuOrganizer.js` | 8879 | 21.4 KB | Start menu "Organize" entry | organizer globals used by modalUtils start menu; unguarded: modalUtils.js→openStartMenuOrganizer | boot fns run: 0/27; used by 1 files |
| `scripts/comp/desktop-apps/mediaPlayer.js` | 8880 | 66.1 KB | launchId `media-player`; VFS open of audio/video via vfsSystemOpenRouter | `openDesktopMediaPlayer*` used by vfsSystemOpenRouter; unguarded: galleryActions.js→openDesktopVideoPlayerUrl, modalUtils.js→openDesktopMediaPlayer | boot fns run: 0/71; used by 4 files |
| `scripts/comp/desktop-apps/guacRemote.js` | 8881 | 19.6 KB | launchId `remote-desktop` | `openDesktopGuac`; unguarded: modalUtils.js→openDesktopGuac | boot fns run: 0/16; used by 1 files |
| `scripts/comp/desktop-apps/dovecote.js` | 8882 | 112.6 KB | launchId `dovecote`; cplMail; mail notifications | `openDesktopDovecote`; RISK: unread badge/new-mail toasts if any are driven from this file; unguarded: modalUtils.js→openDesktopDovecote, systemTrayManager.js→doveRefreshTrayUnread, systemTrayManager.js→initializeDovecoteTray | boot fns run: 1/120; used by 3 files |
| `scripts/comp/vistaSidebar.js` | 8883 | 95.4 KB | launchId `vista-sidebar`; autostart if sidebar enabled in desktop settings | 131 globals; DCL listener. Load at boot only when the saved setting says sidebar is on; unguarded: modalUtils.js→openVistaSidebar | boot fns run: 1/117; used by 1 files |
| `scripts/comp/desktop-apps/emotion.js` | 8884 | 38.0 KB | launchId `emotion` | `openDesktopEmotion*`; unguarded: galleryActions.js→openEmotion, modalUtils.js→openDesktopEmotion | boot fns run: 0/39; used by 2 files |
| `scripts/comp/director.js` | 8886 | 317.7 KB | Director: launchId `director` (Start), tray Open, agent `open_application director`, `offer_director_window` | `openDirectorWindow`, `directorInstance` (inline onclick in app.html!), init step 60; unguarded: galleryView.js→askWrenAboutImage, imageViewer.js→askWrenAboutImage, modalUtils.js→openDirectorWindow, systemTrayManager.js→initializeDirectorTray | boot fns run: 0/311; used by 10 files |
| `scripts/comp/metadataDialogManager.js` | 8905 | 7.9 KB | Image metadata dialog | step 476; unguarded: keyboardShortcuts.js→hideMetadataDialog, lightbox.js→showMetadataDialog | boot fns run: 0/7; used by 1 files |
| `scripts/comp/directorLearningAdmin.js` | 8907 | 21.7 KB | Director (load with director) | step 478 listener scope | boot fns run: 0/23; used by 2 files |
| `scripts/comp/ledgeDesk.js` | 8920 | 12.1 KB | Ledge desk (agent `ledge`) | `currentManualPreviewImage` coupling | boot fns run: 0/14; used by 21 files |

## C2: dynamic load on open, Studio bundle / high coupling (79 files, 4.45 MB)

| File | Line | Size | Trigger | Globals others expect / unguarded eager call sites | Evidence |
|---|---|---|---|---|---|
| `css/manual-modal.css` | 251 | 111.0 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (259 of 574 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 259 / total 574 |
| `css/manual-modal-prompt-form.css` | 253 | 38.1 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (56 of 228 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 56 / total 228 |
| `css/manual-modal-preview-tools.css` | 259 | 54.7 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (104 of 282 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 2 / matched 104 / total 282 |
| `css/manual-modal-generate.css` | 261 | 21.7 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (88 of 149 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 7 / matched 88 / total 149 |
| `css/manual-modal-viewer.css` | 263 | 17.4 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (40 of 99 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 4 / matched 40 / total 99 |
| `css/imageExpansion.css` | 269 | 5.2 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (26 of 32 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 26 / total 32 |
| `css/vibe-manager.css` | 279 | 16.8 KB | Studio vibes | 0 visible rules logged out (8 of 110 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 8 / total 110 |
| `css/mask-editor.css` | 281 | 38.7 KB | inpaint (Studio) | 0 visible rules logged out (59 of 168 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 1 / matched 59 / total 168 |
| `css/cache-browser.css` | 283 | 34.3 KB | reference | 0 visible rules logged out (43 of 212 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 43 / total 212 |
| `css/unified-upload.css` | 285 | 10.6 KB | import | 0 visible rules logged out (34 of 64 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 34 / total 64 |
| `css/genso-manager.css` | 287 | 19.7 KB | expanders / text replacement manager | 0 visible rules logged out (25 of 125 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 25 / total 125 |
| `css/shared-text-replacement.css` | 289 | 1.2 KB | expanders | 0 visible rules logged out (0 of 6 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 6 |
| `css/autocomplete.css` | 291 | 45.1 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (70 of 277 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 4 / matched 70 / total 277 |
| `css/spell-check.css` | 293 | 9.5 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (0 of 70 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 70 |
| `css/requestBodyReplacements.css` | 320 | 3.7 KB | Studio request body replacements | 0 visible rules logged out (2 of 23 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 2 / total 23 |
| `css/manual-modal-splash.css` | 324 | 11.6 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (93 of 102 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 93 / total 102 |
| `css/token-display.css` | 326 | 2.0 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (4 of 10 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 4 / total 10 |
| `css/emphasis-groups-tool.css` | 332 | 14.5 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (13 of 65 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 13 / total 65 |
| `css/character-position-tool.css` | 334 | 3.6 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (11 of 18 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 11 / total 18 |
| `css/studio-vslider.css` | 336 | 11.2 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (12 of 61 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 12 / total 61 |
| `css/emphasis-manager.css` | 338 | 24.9 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 0 visible rules logged out (70 of 134 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 1 / matched 70 / total 134 |
| `css/blockContainer.css` | 351 | 2.6 KB | Studio | 0 visible rules logged out (0 of 7 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 7 |
| `css/image-loupe.css` | 353 | 11.1 KB | Studio | 0 visible rules logged out (0 of 44 rules match hidden DOM). Move into the owning feature's `styles`. | visible rules 0 / matched 0 / total 44 |
| `scripts/comp/blockContainer.js` | 382 | 32.7 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | head-blocking today; only manualModalManager uses it | boot fns run: 0/30; used by 1 files |
| `scripts/comp/imageLoupe.js` | 8799 | 59.2 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | only used by manualModalManager | boot fns run: 0/87; used by 1 files |
| `scripts/comp/inpaint.js` | 8805 | 85.4 KB | Studio mask/inpaint button | 72 globals, step 39; used by 11 files; unguarded: generationOrchestrator.js→saveMaskCompressed, imageViewer.js→handleTouchEnd, imageViewer.js→handleTouchMove, imageViewer.js→handleTouchStart, manualDropdownManager.js→updateInpaintButtonState | boot fns run: 0/45; used by 11 files |
| `scripts/comp/textReplacementManager.js` | 8808 | 261.7 KB | launchId `expanders`; Studio prompt expansion | step 45; `showTextReplacementManager`, `createTextReplacement`/`showFavoritesManager` (inline onclick in app.html!); unguarded: app.html→createTextReplacement, app.html→showFavoritesManager, mainMenuManager.js→compileAllTendaiReplacements, mainMenuManager.js→showTextReplacementManager, mainMenuManager.js→updateMainLockButtonState | boot fns run: 0/110; used by 13 files |
| `scripts/comp/promptApplyPipeline.js` | 8809 | 22.4 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | apply_studio path from agentClientBridge | boot fns run: 0/19; used by 2 files |
| `scripts/comp/compileToPromptsApplet.js` | 8810 | 11.9 KB | Studio "Compile to prompts" | step 462 | boot fns run: 0/13; used by 11 files |
| `scripts/comp/requestBodyReplacementsModal.js` | 8811 | 58.5 KB | Studio request body replacements | step 460; unguarded: app.html→requestBodyReplacements | boot fns run: 0/39; used by 10 files |
| `scripts/comp/seedSproutManager.js` | 8812 | 10.9 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | `lastLoadedSeed` read by manualModalManager; unguarded: galleryActions.js→updateSproutSeedButtonFromPreviewSeed, keyboardShortcuts.js→toggleSproutSeed, keyboardShortcuts.js→updateSproutSeedButton | boot fns run: 0/10; used by 12 files |
| `scripts/comp/presetManager.js` | 8813 | 79.5 KB | launchId `presets` (Spellbook tools) | `showPresetManager`, step 461, DCL listener; unguarded: desktopShortcuts.js→presetData, generationOrchestrator.js→saveManualPreset, generationOrchestrator.js→updateManualPresetToggleBtn, mainMenuManager.js→showPresetManager, manualDropdownManager.js→updateManualPresetPlaceholder | boot fns run: 2/54; used by 12 files |
| `scripts/comp/autofillRankingConfig.js` | 8814 | 6.3 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 39; unguarded: app.html→autofillRankingConfig, websocket.js→getAutofillRanking | boot fns run: 0/7; used by 2 files |
| `scripts/comp/autocompleteRanking.js` | 8815 | 18.9 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) |  | boot fns run: 0/9; used by 3 files |
| `scripts/comp/autofill/spellCheck.js` | 8816 | 28.5 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`); also notepad feature |  | boot fns run: 0/30; used by 2 files |
| `scripts/comp/autofill/wordLookup.js` | 8817 | 21.9 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) |  | boot fns run: 0/27; used by 3 files |
| `scripts/comp/autocompleteUtils.js` | 8818 | 425.6 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`); chat/notepad features | 436 KB, 528 globals, step 487; used by 21 files -> biggest single C win but high coupling; unguarded: app.html→updateAutofillKeyguide, keyboardShortcuts.js→characterAutocompleteOverlay, keyboardShortcuts.js→getSelectedTextFromTextarea, keyboardShortcuts.js→handleCharacterDetailArrowKeys, keyboardShortcuts.js→handleCharacterDetailEnter | boot fns run: 5/416; used by 21 files |
| `scripts/comp/characterAutofillToolManager.js` | 8819 | 17.5 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: app.html→characterAutofillToolManager | boot fns run: 5/44; used by 1 files |
| `scripts/comp/autofillSettings.js` | 8820 | 12.5 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 38 | boot fns run: 2/28; used by 3 files |
| `scripts/comp/imageGenerationSettings.js` | 8821 | 98.9 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 471.5; unguarded: modalUtils.js→applyImageGenerationSettingsToClient, modalUtils.js→syncImageGenerationSettingsUI, studioSession.js→forgetLastStudioPreview, websocket.js→isStudioStreamUnprocessed | boot fns run: 0/124; used by 9 files |
| `scripts/comp/imageBias.js` | 8823 | 74.3 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 38; unguarded: manualDropdownManager.js→cropImageToResolution, manualDropdownManager.js→debouncedCropImageToResolution, manualDropdownManager.js→hideImageBiasDropdown, manualDropdownManager.js→imageBiasHidden, manualDropdownManager.js→refreshImageBiasState | boot fns run: 0/69; used by 11 files |
| `scripts/comp/imageExpansion.js` | 8824 | 162.3 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) (expand image) | DCL listener, 11 fns ran; unguarded: galleryView.js→openEnhanceFromImage, galleryView.js→openImageExpansionModal, imageViewer.js→openEnhanceFromImage, keyboardShortcuts.js→switchExpansionCompiledPromptTab, lightbox.js→openImageExpansionModal | boot fns run: 11/123; used by 7 files |
| `scripts/comp/referenceManager.js` | 8828 | 376.4 KB | launchId `reference` / `import`; Studio vibe/reference panels | 385 KB, step 40, `uploadedImageData` read by imageBias/manualDropdownManager; unguarded: contextMenu.js→revealPreviewMetaOverlay, desktopShortcuts.js→cacheImages, desktopShortcuts.js→deleteReferenceImage, galleryToolbar.js→loadCacheImages, galleryToolbar.js→showVibeEncodingModal | boot fns run: 0/187; used by 26 files |
| `scripts/comp/promptStageBlocks.js` | 8829 | 1.6 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) |  | boot fns run: 0/3; used by 5 files |
| `scripts/comp/emphasisWeightMath.js` | 8833 | 14.0 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: emphasisHighlight.js→DISABLE_SYNTAX_HIGHLIGHT, emphasisHighlight.js→NSFW_TAG_HIGHLIGHT | boot fns run: 0/19; used by 7 files |
| `scripts/comp/emphasisParse.js` | 8834 | 69.5 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: emphasisHighlight.js→computeEmphasisWeightColor, emphasisHighlight.js→ensurePromptEmphasisHighlightOverlay, emphasisHighlight.js→weightFromBraceLevel, utilities.js→listEmphasisBlocks, utilities.js→normalizeEmphasisPromptSyntax | boot fns run: 0/74; used by 12 files |
| `scripts/comp/emphasisGroupIdCodec.js` | 8835 | 161.6 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | used by 20 files; unguarded: emphasisHighlight.js→hasManagedEmphasisGroupIds, manualDropdownManager.js→hasManagedEmphasisGroupIds, textareaUtils.js→wireManagedEmphasisCaretGuards, utilities.js→hasManagedEmphasisGroupIds, utilities.js→importUnmanagedEmphasisGroupsForTextarea | boot fns run: 2/127; used by 20 files |
| `scripts/comp/emphasisSelection.js` | 8836 | 13.2 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: emphasisHighlight.js→capturePromptTextareaSelection | boot fns run: 0/19; used by 5 files |
| `scripts/comp/emphasisSubgroup.js` | 8837 | 15.5 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) |  | boot fns run: 0/10; used by 1 files |
| `scripts/comp/emphasisEditing.js` | 8839 | 54.1 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: emphasisHighlight.js→addEmphasisSelectionHighlight | boot fns run: 2/33; used by 8 files |
| `scripts/comp/emphasisSyntaxToggles.js` | 8840 | 9.2 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: keyboardShortcuts.js→removeAllEmphasisFromSelection | boot fns run: 0/8; used by 5 files |
| `scripts/comp/emphasisTokenModal.js` | 8841 | 7.1 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) |  | boot fns run: 3/10; used by 1 files |
| `scripts/comp/emphasisGroupsToolManager.js` | 8842 | 216.0 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 221 KB, step 36; unguarded: app.html→emphasisGroupsToolManager, keyboardShortcuts.js→emphasisGroupsToolManager | boot fns run: 1/172; used by 8 files |
| `scripts/comp/creditCostDialog.js` | 8854 | 22.4 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) (paid generation confirm) | ; unguarded: galleryActions.js→confirmNaiUpscaleFallback, galleryActions.js→showCreditCostDialog, generationOrchestrator.js→showCreditCostDialog | boot fns run: 0/13; used by 6 files |
| `scripts/comp/presetTokenCount.js` | 8862 | 25.5 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: manualDropdownManager.js→refreshTokenBarCounts, utilities.js→refreshTokenBarCounts | boot fns run: 0/25; used by 10 files |
| `scripts/comp/promptTextareaToolbar.js` | 8863 | 152.2 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 156 KB, step 37; used by 23 files; unguarded: app.html→promptTextareaToolbar, keyboardShortcuts.js→promptTextareaToolbar, manualDropdownManager.js→promptTextareaToolbar, textareaUtils.js→promptTextareaToolbar, utilities.js→promptTextareaToolbar | boot fns run: 0/100; used by 23 files |
| `scripts/comp/keyboardPromptChars.js` | 8887 | 6.4 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: utilities.js→normalizeKeyboardPromptChars | boot fns run: 0/4; used by 1 files |
| `scripts/comp/usageToolManager.js` | 8890 | 15.0 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 36; unguarded: accountDataBootstrap.js→usageToolManager, app.html→usageToolManager, appBootstrap.js→usageToolManager, connectionManager.js→usageToolManager, mainMenuManager.js→usageToolManager | boot fns run: 1/25; used by 6 files |
| `scripts/comp/studioSoftTips.js` | 8892 | 6.0 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 475; unguarded: manualDropdownManager.js→notifyStudioSoftTipsDatasetChange | boot fns run: 0/12; used by 1 files |
| `scripts/comp/promptTextareaContextMenu.js` | 8893 | 79.2 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: textareaUtils.js→attachPromptTextareaContextMenu | boot fns run: 4/121; used by 6 files |
| `scripts/comp/dynamicGenerationLockState.js` | 8895 | 13.8 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) / dynamic generation | ; unguarded: agentClientBridge.js→readDynamicGenerationSnapshot, mainMenuManager.js→dynamicGenerationHasCompileCache, mainMenuManager.js→setDynamicGenerationLockState, websocket.js→isDynamicGenerationEnabled | boot fns run: 0/15; used by 16 files |
| `scripts/comp/dynamicGenerationCarousel.js` | 8896 | 31.9 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) |  | boot fns run: 0/13; used by 8 files |
| `scripts/comp/dynamicGenerationManager.js` | 8897 | 75.1 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 85.1 | boot fns run: 0/35; used by 3 files |
| `scripts/comp/novelManager.js` | 8900 | 26.0 KB | Novel tool (Studio) | DCL listener; unguarded: novelContextMenu.js→NOVEL_EXPLICITNESS_OPTIONS, novelContextMenu.js→NOVEL_PERSUASIVENESS_OPTIONS, novelContextMenu.js→NOVEL_STYLE_OPTIONS, novelContextMenu.js→NOVEL_TONE_OPTIONS, novelContextMenu.js→novelEnsureNote | boot fns run: 9/50; used by 3 files |
| `scripts/comp/manualModalManager.js` | 8902 | 286.6 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 293 KB, 290 globals, used by 75 files; appInitSteps reads `manualPrompt`/`manualUc` at boot -> LAST to move; unguarded: agentClientBridge.js→manualModal, agentClientBridge.js→openManualModalWithContent, bulkOperationsManager.js→showManualLoading, desktopShortcuts.js→manualModal, desktopShortcuts.js→openManualModalWithContent | boot fns run: 0/123; used by 75 files |
| `scripts/comp/manualPreviewManager.js` | 8903 | 92.6 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 471; unguarded: galleryView.js→loadWorkspaceImagesForOverlay, galleryView.js→resumeManualPreviewAfterRemoval, generationOrchestrator.js→resumeManualPreviewAfterRemoval, keyboardShortcuts.js→navigateManualPreview, keyboardShortcuts.js→resetManualPreview | boot fns run: 0/40; used by 25 files |
| `scripts/comp/manualGenerationParams.js` | 8904 | 10.9 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 474 | boot fns run: 0/3; used by 0 files |
| `scripts/comp/randomPromptManager.js` | 8906 | 9.7 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 477 | boot fns run: 0/7; used by 0 files |
| `scripts/comp/characterPromptManager.js` | 8908 | 74.1 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 472, DCL listener; unguarded: keyboardShortcuts.js→addCharacterPrompt, manualDropdownManager.js→updateAutoPositionToggle | boot fns run: 0/46; used by 11 files |
| `scripts/comp/studioChangeJson.js` | 8910 | 127.2 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | 130 KB; `lastLoadedSeed`; unguarded: desktopShortcuts.js→handleStudioChangeShortcutClick, modalUtils.js→isStudioModalOpen, websocket.js→applyStudioChangePayloadSilent | boot fns run: 0/97; used by 16 files |
| `scripts/comp/studioVSlider.js` | 8911 | 81.3 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | DCL listener; unguarded: agentClientBridge.js→getStudioVSliderSnapshot | boot fns run: 5/97; used by 5 files |
| `scripts/comp/characterPositionToolManager.js` | 8914 | 24.8 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 472.5; unguarded: app.html→characterPositionToolManager, manualDropdownManager.js→characterPositionToolManager | boot fns run: 1/44; used by 3 files |
| `scripts/comp/manualTabManager.js` | 8915 | 12.2 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | step 473; unguarded: keyboardShortcuts.js→switchManualTab, keyboardShortcuts.js→toggleManualShowBoth | boot fns run: 0/10; used by 4 files |
| `scripts/comp/textOverlayManager.js` | 8916 | 47.8 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) |  | boot fns run: 0/32; used by 6 files |
| `scripts/comp/pipelineStageControls.js` | 8917 | 76.0 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) pipeline | step 475 | boot fns run: 0/12; used by 1 files |
| `scripts/comp/pipelineStageManager.js` | 8918 | 189.5 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) pipeline | 194 KB; unguarded: manualDropdownManager.js→updateAllStagesInheritedValues, manualDropdownManager.js→updatePipelineStages | boot fns run: 0/84; used by 13 files |
| `scripts/comp/stageResultsReview.js` | 8919 | 28.9 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) pipeline | step 40; unguarded: websocket.js→applyStageResultsReviewProgress | boot fns run: 1/37; used by 4 files |
| `scripts/comp/compareViewManager.js` | 8925 | 59.4 KB | Compare view (gallery compare) | DCL listener, 15 fns ran at boot; unguarded: galleryView.js→isGalleryCompareSourceAvailable, galleryView.js→setCompareSourceFromGalleryImage, keyboardShortcuts.js→compareAltF10CycleHotkey, keyboardShortcuts.js→compareSourceAltF8Hotkey, keyboardShortcuts.js→compareSourcePrimaryClick | boot fns run: 15/113; used by 6 files |
| `scripts/comp/dynamicGenerationOverrides.js` | 8939 | 44.9 KB | Studio (launchId `studio` / manual modal open; agent `open_application studio`, `apply_studio`) | ; unguarded: agentClientBridge.js→collectDynamicButtonState | boot fns run: 0/29; used by 7 files |

## D: idle / after first paint (13 files, 696.6 KB)

| File | Line | Size | Why | Evidence |
|---|---|---|---|---|
| `css/weather-location.css` | 271 | 1.0 KB | 0 visible rules at first paint (4 rules matched DOM); weather/quips/keyboard widgets. | visible rules 0 / matched 4 / total 7 |
| `css/weather-cards.css` | 273 | 52.0 KB | 0 visible rules at first paint (18 rules matched DOM); weather/quips/keyboard widgets. | visible rules 0 / matched 18 / total 236 |
| `css/weather-lcd.css` | 275 | 4.8 KB | 0 visible rules at first paint (0 rules matched DOM); weather/quips/keyboard widgets. | visible rules 0 / matched 0 / total 29 |
| `css/generation-quips.css` | 322 | 7.3 KB | 0 visible rules at first paint (2 rules matched DOM); weather/quips/keyboard widgets. | visible rules 0 / matched 2 / total 55 |
| `css/virtual-keyboard.css` | 355 | 5.5 KB | 0 visible rules at first paint (22 rules matched DOM); weather/quips/keyboard widgets. | visible rules 0 / matched 22 / total 30 |
| `dist/mdi/materialdesignicons.min.css` | 357 | 338.5 KB | 0 visible rules at first paint (13 rules matched DOM); icon font used by Studio/chat/explorer markup (mdi 74 refs, remix 33, weather 23) -> load at idle, or with Studio. | visible rules 0 / matched 13 / total 7467 |
| `dist/fonts/weather-icons.min.css` | 358 | 25.3 KB | 0 visible rules at first paint (0 rules matched DOM); icon font used by Studio/chat/explorer markup (mdi 74 refs, remix 33, weather 23) -> load at idle, or with Studio. | visible rules 0 / matched 0 / total 594 |
| `dist/remixicon/remixicon.css` | 359 | 149.4 KB | 0 visible rules at first paint (6 rules matched DOM); icon font used by Studio/chat/explorer markup (mdi 74 refs, remix 33, weather 23) -> load at idle, or with Studio. | visible rules 0 / matched 6 / total 3152 |
| `scripts/comp/assetPreload.js` | 381 | 32.5 KB | Wallpaper/icon preload (init steps 12.2/18.2/18.4). Head-blocking today for no paint reason. Move to after-first-paint; keep init steps registering via featureLoader stub. Init steps: 12.2, Loading wallpaper; 18.2, Loading desktop icons; 18.4, Loading desktop assets | boot fns run: 36/57; used by 2 files |
| `scripts/comp/clientPerfSampler.js` | 8796 | 15.5 KB | Only started at end of app.js DCL (`startClientPerfSampler`). Load at idle; guard the call. | boot fns run: 1/18; used by 2 files |
| `scripts/comp/generationQuips.js` | 8898 | 40.2 KB | Generation flavor text; ran 7 functions at boot (string tables). Idle. | boot fns run: 7/32; used by 4 files |
| `scripts/comp/generationQuipsTray.js` | 8899 | 21.2 KB | Tray quips; idle. | boot fns run: 0/34; used by 2 files |
| `scripts/comp/telemetryClient.js` | 8954 | 3.4 KB | `sendAppTelemetryPing` at DCL; fire-and-forget. Idle load + guard. | boot fns run: 7/9; used by 1 files |

## E: dead or duplicate (flag only, nothing deleted) (3 files, 33.5 KB)

| File | Line | Size | Why | Evidence |
|---|---|---|---|---|
| `css/image-prompt-inspector.css` | 360 | 16.7 KB | Also listed in FEATURE_MANIFEST.image_prompt_inspector -> loaded twice. Remove from app.html (flag only). | visible rules 0 / matched 43 / total 68 |
| `scripts/comp/modelManager.js` | 8804 | 5.3 KB | `window.modelManager` is constructed but referenced by no file in public/ (grep incl. feature scripts, templates, ws handlers). Only cost: 5 KB + a constructor. Confirm with server-side/agent code before removal. | boot fns run: 1/11; used by 0 files |
| `scripts/comp/requestForm.js` | 8894 | 11.6 KB | `presentRequestForm`/`openRequestFormWindow` are never called anywhere in public/ (websocket.js only has a label). Either unfinished wiring for MCP `request_form` or dead. Flag, do not delete. | boot fns run: 0/10; used by 0 files |

## Unverified (needs a logged-in Studio session)

- Everything reached only through `registerInitStep` (steps 0.45 to 100): galleryView, workspaceUtils, desktopShortcuts, manualDropdownManager, studioSession, the tokenizers in `protected/`, mainMenuManager, systemTrayManager, plus every C2 listener-scope step.
- Which B CSS (gallery, menus, Vista windows) is visible on the logged-in desktop at first paint. Some of it may belong in A.
- Whether a restored Studio session or workspace opens Studio, Director or the Sidebar at login, which would load those C files at boot anyway.

Raw data: `/workspace/f1/` on the box (`rows.json`, `jsinfo.json`, `unguarded.json`, `cssvis.json`, `f1cov2.json` coverage, `f1shot.png` first-screen screenshot).