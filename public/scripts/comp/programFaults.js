/**
 * Program faults: Vista's "<program> has stopped working" dialog (Windows Error Reporting) for an
 * uncaught exception in one desktop program, with Close and Restart acting on that program only.
 *
 *   Microsoft Windows                                         [_][ ][X]
 *   Solitaire has stopped working
 *   A problem caused the program to stop working correctly. Windows will close the program
 *   and notify you if a solution is available.
 *                                                        [Close program]
 *
 * Measured on the Vista VM (WerFault.exe / dw20.exe, Aero, 96 dpi): a 360 px white client, the
 * #003399 12 pt heading and the 9 pt body 10 px from the left. Every crash first shows "Windows is
 * checking for a solution to the problem..." over a marquee bar with Cancel. Then:
 *   - a program registered for restart (Explorer on the VM; here, any program with a launcher):
 *     "<program> is restarting..." over the bar with Cancel, and the program comes back by itself;
 *     Cancel leaves it closed. Vista restarts a program only if it ran 60 s since its last restart,
 *     so a second crash inside a minute gets the page below instead;
 *   - any other program: the page above, Close program.
 * The shell ("Melaton Desktop", this desktop's Explorer) cannot come back on its own: its page
 * offers the client restart (runWinlogonPower('restart'), the Start menu's Restart) or Restart later.
 * The caption carries wer.dll's Problem Reports icon (static_images/vista-icons/problem-reports-*)
 * and the caption buttons of the reference capture (minimize, maximize greyed, close).
 *
 * Attribution. fatalErrorBootstrap.js hands every window error / unhandled rejection here first
 * (present), and the WebSocket dispatch catch sites report the handler errors they swallow
 * (report). The fault belongs to:
 *   1. the topmost stack frame in a program's script: FEATURE_MANIFEST (featureLoader.js) for the
 *      lazy features, MONOLITH_PROGRAMS for the program scripts app.html loads;
 *   2. else, with a frame in a shell script (CORE_SCRIPT), the desktop itself: "Melaton Desktop";
 *   3. else (shared libraries only, or no stack) the window the current input event targeted
 *      (capture listeners below), or the shell when the event hit the taskbar / Start menu;
 *   4. else, with any frame of ours, the shell again.
 * Only a fault with no frames of ours and no event (an extension, a bare message) falls back to
 * Spectator Fault Detection. Before the desktop is up (boot, logon) the dialog shows on its own,
 * above the boot layers, instead of through the window manager.
 *
 * A program is its root window (data-parent-modal-id walked up) and, when known, its launcher
 * (a Start menu launchId, or a Vista game id). Closing it closes that window and its tool windows
 * the way ending its process would (no "save?" prompts); restarting it closes it and runs the
 * launcher again. One dialog per program: repeated faults while its dialog is up, or for a few
 * seconds after it was closed, are counted, not shown again; at most MAX_OPEN dialogs at once,
 * the rest wait. Continue (and the shell's Restart later) leaves the program running: the same
 * fault from it is then only counted, until its window closes; a different fault shows again.
 *
 * Reports. Every dialog is upserted to the server (POST /api/fault-reports,
 * modules/programFaultReports.js) when it opens, and again when more faults were counted into it
 * or a button closed it. Copy Report, on the footer's left, reads the report back from the server:
 * confirmed, it copies the report id and a summary for an agent to look up; not confirmed (no
 * answer, not saved, or the server has no such report), it copies the full error details instead.
 *
 *   programFaults.present(detail, { error, filename }) -> true when the dialog took it
 *   programFaults.report(error, { source }) -> same, for errors a catch block swallowed
 *   programFaults.attribute({ stack, filename, eventWindow, eventShell }) -> program | null
 *   programFaults.registerProgram(windowId, { name, launchId, relaunch, terminate, core })
 *
 * Test: scripts/test-program-faults.js
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;

    const CHECKING_MS = 2600;
    const RESTARTING_MS = 2400;
    const RESTART_GUARD_MS = 60000;
    const RESTART_FALLBACK_MS = 20000;
    const MAX_OPEN = 3;
    const MAX_QUEUED = 12;
    const DEAD_GRACE_MS = 4000;
    const DESKTOP_NAME = 'Melaton Desktop';
    const REPORT_URL = '/api/fault-reports';
    const REPORT_POST_MS = 8000;
    const REPORT_WAIT_MS = 1500;
    const REPORT_UPDATE_MS = 1200;
    // a continued program faulting in a timer: at most one update per dialog this often
    // (modules/programFaultReports.js allows 30 posts a minute per session)
    const REPORT_MIN_GAP_MS = 10000;
    const COPIED_MS = 1600;
    const MAX_DETAILS = 50;

    const TEXT = {
        caption: 'Melaton',
        heading: (name) => `${name} has stopped working`,
        restarting: (name) => `${name} is restarting...`,
        checking: 'Melaton is checking for a solution to the problem...',
        close: 'A problem caused the program to stop working correctly. Melaton will close the program and notify you if a solution is available.',
        core: 'A problem caused the program to stop working correctly. Melaton needs to restart to recover from this problem.',
        closeButton: 'Close program',
        restartNow: 'Restart now',
        restartLater: 'Restart later',
        cancel: 'Cancel',
        continueButton: 'Continue',
        copyReport: 'Copy Report',
        copied: 'Copied',
        copyFailed: 'Copy failed'
    };

    // ---- scripts -------------------------------------------------------------------------------

    /** The shell: window manager, taskbar, Start menu, boot, connection, tray. A fault only in these is the desktop's. */
    const CORE_SCRIPT = new RegExp('^/scripts/(?:'
        + 'app|appInitSteps|appWebSocketHandlers|websocket|ws/[^/]+'
        + '|comp/(?:fatalErrorBootstrap|programFaults|blockContainer|rootStateFlags|toastManager|trayRegistry|popoverManager'
        + '|contextMenu|windowGeometry|modalUtils|winlogonPower|modalListenerScope|modalKeyboardRegistry|bootUiDebug'
        + '|desktopBoot|tabVolume|desktopSounds|desktopTaskMonitor|bootMessageBox|workstationLock|melatonNetworkDialogs'
        + '|mainframeServerWindow|mainframeExceptionDialog|serviceWorkerManager|confirmationDialog|vistaDialogs|workspaceUtils'
        + '|keyboardShortcuts|desktopShortcuts|appSplash|mainMenuManager|exitConfirmation|trayIndicators|systemTrayManager'
        + '|windowControlsOverlay|errorDisplay|themePreferences|aeroGlass|appBootstrap|connectionManager'
        + '|accountDataBootstrap|uiResize|windowManagementHelpers|featureLoader|telemetryClient|agentClientBridge'
        + '|agentClientUpdateDialog|assetPreload|startMenuOrganizer)'
        + ')\\.js$');

    /** Program scripts app.html loads up front (the lazy ones come from FEATURE_MANIFEST). */
    const MONOLITH_PROGRAMS = {
        '/scripts/comp/director.js': 'director',
        '/scripts/comp/galleryView.js': 'workspace',
        '/scripts/comp/galleryToolbar.js': 'workspace',
        '/scripts/comp/galleryImagesLoad.js': 'workspace',
        '/scripts/comp/galleryJumpIndex.js': 'workspace',
        '/scripts/comp/galleryActions.js': 'workspace',
        '/scripts/comp/bulkOperationsManager.js': 'workspace',
        '/scripts/comp/desktop-apps/dovecote.js': 'dovecote',
        '/scripts/comp/vistaSidebar.js': 'vista-sidebar',
        '/scripts/comp/manualModalManager.js': 'studio',
        '/scripts/comp/manualPreviewManager.js': 'studio',
        '/scripts/comp/manualGenerationParams.js': 'studio',
        '/scripts/comp/manualTabManager.js': 'studio',
        '/scripts/comp/manualFormHelpers.js': 'studio',
        '/scripts/comp/manualUploadHandlers.js': 'studio',
        '/scripts/comp/manualDropdownManager.js': 'studio',
        '/scripts/comp/studioSession.js': 'studio',
        '/scripts/comp/studioVSlider.js': 'studio',
        '/scripts/comp/studioSoftTips.js': 'studio',
        '/scripts/comp/pipelineStageControls.js': 'studio',
        '/scripts/comp/pipelineStageManager.js': 'studio',
        '/scripts/comp/stageResultsReview.js': 'studio',
        '/scripts/comp/characterPromptManager.js': 'studio'
    };

    /** featureLoader.js feature -> launchId; 'lib' for shared code (attributed by window), 'core' for shell parts. */
    const FEATURE_PROGRAMS = {
        spellbook: 'spellbook',
        notepad: 'notebook',
        chat: 'chat',
        config_editor: 'config-editor',
        character_db: 'character-db',
        log_viewer: 'event-viewer',
        run: 'run',
        grimoire: 'encyclopedia',
        explorer: 'explorer',
        naxt: 'naxt',
        bracket_gen: 'bracket-generation',
        planet_switcher: 'planet-switcher',
        calculator: 'calculator',
        media_player: 'media-player',
        alarm: 'alarm',
        remote_desktop: 'remote-desktop',
        remote_desktop_connection: 'remote-desktop-connection',
        emotion: 'emotion',
        exchange: 'exchange',
        control_panel: 'control-panel',
        start_menu_organizer: 'core',
        vista_games: 'lib',
        vista_cards: 'lib'
    };

    /** A program's main window id -> its launcher (the Start menu launchId). */
    const WINDOW_LAUNCH = {
        galleryWindow: 'workspace',
        manualModal: 'studio',
        spellbookGenerationModal: 'spellbook',
        cacheManagerModal: 'reference',
        bracketGenerationModal: 'bracket-generation',
        directorWindow: 'director',
        tagWikiSearchModal: 'encyclopedia',
        naxtModal: 'naxt',
        notebookModal: 'notebook',
        chatModal: 'chat',
        chatInterfaceModal: 'chat',
        explorerModal: 'explorer',
        desktopGuacDialog: 'remote-desktop',
        remoteDesktopConnectionModal: 'remote-desktop-connection',
        unifiedUploadModal: 'import',
        presetManagerModal: 'presets',
        textReplacementManagerModal: 'expanders',
        configEditorModal: 'config-editor',
        characterDbModal: 'character-db',
        logViewerModal: 'event-viewer',
        melatonControlPanelModal: 'control-panel',
        desktopTimerModal: 'alarm',
        desktopCalculatorModal: 'calculator',
        runModal: 'run'
    };

    const registered = new Map(); // window id -> registerProgram options
    const learned = new Map(); // window id -> launchId, from faults whose input event hit that window

    function scriptPath(url) {
        const m = /^(?:[a-z][\w+.-]*:\/\/[^/\s)]+)?(\/[^\s)?#:]+\.js)/i.exec(String(url || '').trim());
        if (!m) return '';
        if (/^[a-z][\w+.-]*:\/\//i.test(url) && root && root.location && root.location.origin
            && String(url).indexOf(root.location.origin) !== 0) return '';
        return m[1];
    }

    /** Same-origin script paths of a stack, topmost frame first. */
    function stackScripts(stack) {
        const out = [];
        const re = /((?:[a-z][\w+.-]*:\/\/[^/\s)]+)?\/[^\s)?#:]+\.js)(?:\?[^\s):]*)?:\d+(?::\d+)?/gi;
        for (const line of String(stack || '').split('\n')) {
            re.lastIndex = 0;
            const m = re.exec(line);
            if (!m) continue;
            const path = scriptPath(m[1]);
            if (path) out.push(path);
        }
        return out;
    }

    function featureManifest(options) {
        if (options && options.manifest) return options.manifest;
        // FEATURE_MANIFEST: public/scripts/comp/featureLoader.js
        return typeof FEATURE_MANIFEST !== 'undefined' ? FEATURE_MANIFEST : null;
    }

    /** 'core' | 'lib' | { launchId } | { game } for one script path. */
    function classifyScript(path, options) {
        if (!path) return 'lib';
        if (CORE_SCRIPT.test(path)) return 'core';
        if (MONOLITH_PROGRAMS[path]) return { launchId: MONOLITH_PROGRAMS[path] };
        const manifest = featureManifest(options);
        if (manifest) {
            const rel = path.replace(/^\//, '');
            for (const name of Object.keys(manifest)) {
                const scripts = manifest[name] && manifest[name].scripts;
                if (!Array.isArray(scripts) || !scripts.some((s) => String(s).replace(/^\//, '') === rel)) continue;
                const mapped = FEATURE_PROGRAMS[name];
                if (mapped === 'lib' || mapped === 'core') return mapped;
                if (mapped) return { launchId: mapped };
                if (/^vista_/.test(name)) return { game: name.slice(6) };
                return 'lib';
            }
        }
        return 'lib';
    }

    // ---- programs ------------------------------------------------------------------------------

    function launchables() {
        // collectStartMenuLaunchableDescriptors: public/scripts/comp/modalUtils.js
        try {
            return typeof collectStartMenuLaunchableDescriptors === 'function' ? collectStartMenuLaunchableDescriptors() : [];
        } catch (_) {
            return [];
        }
    }

    function launchableFor(launchId) {
        return launchId ? launchables().find((d) => d.launchId === launchId) || null : null;
    }

    function windowTitle(win) {
        const span = win && win.querySelector(':scope > .modal-window-title .modal-window-title-main span');
        const text = span ? span.textContent.trim() : '';
        return text || (win && win.id) || '';
    }

    /** The program's root window: tool windows and owned dialogs belong to their parent. */
    function rootWindow(win) {
        let cur = win;
        for (let i = 0; cur && i < 8; i++) {
            const parentId = cur.getAttribute && cur.getAttribute('data-parent-modal-id');
            const parent = parentId && doc ? doc.getElementById(parentId) : null;
            if (!parent) break;
            cur = parent;
        }
        return cur;
    }

    function launchIdOfWindow(id) {
        const reg = registered.get(id);
        return (reg && reg.launchId) || WINDOW_LAUNCH[id] || learned.get(id) || null;
    }

    /** The open window of a launcher's program: the maps above, else a window titled like the launcher. */
    function findLaunchWindow(launchId) {
        if (!doc || !launchId) return null;
        const open = Array.from(doc.querySelectorAll('.modal')).filter((el) => el.id && !el.classList.contains('hidden')
            && !el.classList.contains('program-fault-dialog'));
        const byId = open.find((el) => launchIdOfWindow(el.id) === launchId);
        if (byId) return byId;
        const d = launchableFor(launchId);
        const names = d ? [d.text, d.fullName].filter(Boolean) : [];
        return open.find((el) => !el.getAttribute('data-parent-modal-id') && names.includes(windowTitle(el))) || null;
    }

    function findGameWindow(game) {
        if (!doc || !game) return null;
        return Array.from(doc.querySelectorAll('.vista-game-window')).find((el) => el.dataset.vistaGame === game) || null;
    }

    function coreProgram() {
        return { key: 'core', name: DESKTOP_NAME, core: true, window: null, launchId: null, game: null };
    }

    function programForLaunch(launchId, win) {
        const d = launchableFor(launchId);
        if (d && d.game) return programForGame(d.game, win);
        const w = win || findLaunchWindow(launchId);
        return {
            key: 'launch:' + launchId,
            name: (d && (d.fullName || d.text)) || windowTitle(w) || launchId,
            core: false,
            window: w,
            launchId,
            game: null
        };
    }

    function programForGame(game, win) {
        const w = win || findGameWindow(game);
        const d = launchables().find((x) => x.game === game);
        return {
            key: 'game:' + game,
            name: (d && d.text) || windowTitle(w) || game,
            core: false,
            window: w,
            launchId: d ? d.launchId : null,
            game
        };
    }

    /** The program a window belongs to (null for none, or the fault dialogs themselves). */
    function programForWindow(win) {
        if (!win || !win.classList || win.classList.contains('program-fault-dialog')) return null;
        const top = rootWindow(win);
        if (!top || !top.id) return null;
        if (top.__vg || top.dataset.vistaGame) return programForGame(top.dataset.vistaGame || top.id, top);
        const reg = registered.get(top.id);
        if (reg && reg.core) return coreProgram();
        const launchId = launchIdOfWindow(top.id);
        if (launchId) {
            const p = programForLaunch(launchId, top);
            if (reg && reg.name) p.name = reg.name;
            return p;
        }
        return { key: 'window:' + top.id, name: (reg && reg.name) || windowTitle(top), core: false, window: top, launchId: null, game: null };
    }

    /**
     * ctx: { stack, filename, eventWindow, eventShell, manifest }. The topmost program frame wins;
     * then any shell frame makes it the desktop's; then the event's window or the shell.
     */
    function attribute(ctx) {
        const c = ctx || {};
        const scripts = stackScripts(c.stack);
        const file = scriptPath(c.filename);
        if (!scripts.length && file) scripts.push(file);
        let sawCore = false;
        for (const path of scripts) {
            const kind = classifyScript(path, c);
            if (kind === 'core') { sawCore = true; continue; }
            if (kind === 'lib') continue;
            if (kind.game) return programForGame(kind.game);
            const p = programForLaunch(kind.launchId);
            // the program's code ran for an input event in a window no other launcher claims:
            // that window is this program's (remembered for its next fault)
            if (c.eventWindow) {
                const ev = programForWindow(c.eventWindow);
                if (ev && ev.key === p.key) return ev;
                if (ev && !p.window && !ev.launchId && !ev.game && ev.window) {
                    learned.set(ev.window.id, kind.launchId);
                    return programForLaunch(kind.launchId, ev.window);
                }
            }
            return p;
        }
        if (sawCore) return coreProgram();
        if (c.eventWindow) {
            const p = programForWindow(c.eventWindow);
            if (p) return p;
        }
        if (c.eventShell) return coreProgram();
        // frames of ours with no window to pin them on: the desktop's, which loaded the shared
        // code. Nothing of ours at all (an extension, a bare message) is left for Spectator
        if (scripts.length) return coreProgram();
        return null;
    }

    function registerProgram(windowId, options) {
        if (windowId) registered.set(String(windowId), options || {});
    }

    // ---- the input event a fault happens under ------------------------------------------------

    const SHELL_SELECTOR = '#desktopTaskbar, .desktop-taskbar, #startMenu, .start-menu, .desktop-icons, #desktopIcons, .context-menu, #systemTray';
    const eventContext = { window: null, shell: false, stamp: 0 };
    let eventClearTimer = 0;

    function noteEvent(ev) {
        const t = ev && ev.target;
        if (!t || !t.closest) return;
        const win = t.closest('.modal');
        eventContext.window = win && !win.classList.contains('program-fault-dialog') ? win : null;
        eventContext.shell = !win && !!t.closest(SHELL_SELECTOR);
        eventContext.stamp++;
        // listeners for this event run inside this task; a timer clears the context after them
        if (!eventClearTimer) {
            eventClearTimer = setTimeout(() => {
                eventClearTimer = 0;
                eventContext.window = null;
                eventContext.shell = false;
            }, 0);
        }
    }

    const NOTED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu',
        'keydown', 'keyup', 'input', 'change', 'submit', 'wheel', 'dragstart', 'drop', 'focusin'];

    // ---- the dialog ----------------------------------------------------------------------------

    const dialogs = new Map(); // program key -> state
    const queue = [];
    const dead = new Map(); // program key -> time until which its faults are dropped
    const restartedAt = new Map(); // program key -> when the dialog last restarted it
    const continued = new Map(); // program key -> { state, window, signatures } after Continue
    let dialogSeq = 0;
    let occurrenceSeq = 0;

    function now() {
        return Date.now();
    }

    function isDesktopUp() {
        if (!doc || !doc.body || !doc.body.classList.contains('desktop-mode')) return false;
        // getClientDesktopState: public/scripts/comp/desktopBoot.js
        if (typeof root.getClientDesktopState === 'function') {
            try {
                return root.getClientDesktopState() === 'desktop';
            } catch (_) {
                return false;
            }
        }
        return true;
    }

    function el(tag, className, text) {
        const n = doc.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function captionButton(className, title, iconClass, disabled) {
        const b = el('button', className);
        b.type = 'button';
        b.title = title;
        if (disabled) b.disabled = true;
        const i = el('i', iconClass);
        i.setAttribute('aria-hidden', 'true');
        b.appendChild(i);
        return b;
    }

    function buildDialog(state) {
        const modal = el('div', 'modal hidden on-top program-fault-dialog');
        modal.id = 'programFaultDialog' + (++dialogSeq);
        modal.dataset.windowIdentifier = 'programFaultDialog';
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.dataset.windowFixedSize = 'true';
        // vista-dialogs.css: the light client, 7.css buttons and the default button's pulse
        modal.dataset.vistaDialog = 'task';
        modal.dataset.windowClient = 'light';
        modal.setAttribute('role', 'alertdialog');
        modal.setAttribute('aria-labelledby', modal.id + 'Heading');

        const title = el('div', 'modal-window-title');
        const main = el('div', 'modal-window-title-main');
        const img = el('img', 'icon-image');
        img.alt = '';
        img.src = '/static_images/vista-icons/problem-reports-16.png';
        img.srcset = '/static_images/vista-icons/problem-reports-16.png 1x, /static_images/vista-icons/problem-reports-32.png 2x';
        main.appendChild(img);
        main.appendChild(el('span', '', TEXT.caption));
        title.appendChild(main);

        const controls = el('div', 'modal-window-controls');
        const minimizeBtn = captionButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize');
        const maximizeBtn = captionButton('btn-secondary btn-small program-fault-maximize', 'Maximize', 'fa-regular fa-window-maximize', true);
        const closeBtn = captionButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
        controls.append(minimizeBtn, maximizeBtn, closeBtn);

        const content = el('div', 'modal-content win7 program-fault-content');
        const body = el('div', 'program-fault-body');
        const heading = el('h1', 'program-fault-heading', TEXT.heading(state.program.name));
        heading.id = modal.id + 'Heading';
        const text = el('p', 'program-fault-text');
        // 7.css's marquee bar (the content carries .win7)
        const bar = el('div', 'program-fault-progress marquee');
        bar.setAttribute('role', 'progressbar');
        body.append(heading, text, bar);
        const footer = el('div', 'vista-dialog-footer program-fault-footer');
        content.append(body, footer);

        modal.append(title, el('div', 'modal-focus-overlay'), controls, content);
        doc.body.appendChild(modal);

        // the caption's close and Escape do what the page's Cancel / last button would
        const dismiss = () => finish(state, state.page === 'checking' || state.page === 'restarting' ? 'cancel' : (state.program.core ? 'dismiss' : 'close'));
        closeBtn.addEventListener('click', dismiss);
        modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                dismiss();
            }
        });

        state.modal = modal;
        state.heading = heading;
        state.text = text;
        state.bar = bar;
        state.footer = footer;
        return modal;
    }

    function button(label, primary, onClick) {
        const b = el('button', 'btn-secondary program-fault-button', label);
        b.type = 'button';
        if (primary) b.dataset.dialogPrimary = '1';
        b.addEventListener('click', onClick);
        return b;
    }

    /** checking -> restarting (a program that can come back) or final. */
    function pageAfterChecking(p) {
        if (p.core || !canRelaunch(p)) return 'final';
        const last = restartedAt.get(p.key);
        return last && now() - last < RESTART_GUARD_MS ? 'final' : 'restarting';
    }

    function showPage(state, page) {
        const p = state.program;
        state.page = page;
        state.modal.dataset.faultPage = page;
        state.footer.textContent = '';
        state.heading.textContent = page === 'restarting' ? TEXT.restarting(p.name) : TEXT.heading(p.name);
        state.bar.hidden = page === 'final';
        let focus = null;
        state.footer.appendChild(copyButton(state));
        if (page === 'checking' || page === 'restarting') {
            state.text.textContent = page === 'checking' ? TEXT.checking : '';
            focus = button(TEXT.cancel, true, () => finish(state, 'cancel'));
            // once restarting, the program is already closed: nothing to continue
            if (page === 'checking' && !p.core) state.footer.appendChild(button(TEXT.continueButton, false, () => finish(state, 'continue')));
            state.footer.appendChild(focus);
        } else if (p.core) {
            state.text.textContent = TEXT.core;
            focus = button(TEXT.restartNow, true, () => finish(state, 'restart-os'));
            state.footer.append(focus, button(TEXT.restartLater, false, () => finish(state, 'dismiss')));
        } else {
            state.text.textContent = TEXT.close;
            focus = button(TEXT.closeButton, true, () => finish(state, 'close'));
            state.footer.append(button(TEXT.continueButton, false, () => finish(state, 'continue')), focus);
        }
        // the default button takes the focus, as WER's dialog takes the foreground
        if (focus) {
            setTimeout(() => {
                try { focus.focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
            }, 0);
        }
    }

    function openState(state) {
        dialogs.set(state.program.key, state);
        buildDialog(state);
        showPage(state, 'checking');
        try {
            // before the desktop is up (boot, logon) the window manager's windows sit under
            // the boot layers: the dialog shows on its own, over them
            if (!isDesktopUp()) throw new Error('desktop not up');
            // openModal: public/scripts/comp/modalUtils.js
            if (typeof root.openModal !== 'function') throw new Error('no window manager');
            root.openModal(state.modal);
            if (state.modal.classList.contains('hidden')) throw new Error('window manager did not open it');
        } catch (err) {
            // the window manager is what broke (a shell fault), or is not up yet: show the
            // dialog on its own
            if (isDesktopUp()) console.error('Program fault: showing the dialog without the window manager:', err);
            state.modal.classList.remove('hidden');
            state.modal.classList.add('program-fault-standalone');
        }
        state.timer = setTimeout(() => {
            state.timer = 0;
            if (dialogs.get(state.program.key) === state) advance(state);
        }, CHECKING_MS);
    }

    /** Leave the checking page: to the last page, or close the program and bring it back. */
    function advance(state) {
        if (state.timer) clearTimeout(state.timer);
        state.timer = 0;
        const page = pageAfterChecking(state.program);
        showPage(state, page);
        if (page !== 'restarting') return;
        const p = state.program;
        restartedAt.set(p.key, now());
        const closed = terminate(p);
        state.timer = setTimeout(() => {
            state.timer = 0;
            if (state.finished) return;
            state.finished = true;
            state.action = 'restarted';
            updateReport(state, true);
            closed.then(() => relaunch(p)).catch((err) => {
                console.error('Program fault: restarting', p.name, 'failed:', err);
            }).then(() => removeDialog(state)).then(nextFromQueue);
        }, RESTARTING_MS);
    }

    function removeDialog(state) {
        if (state.timer) clearTimeout(state.timer);
        state.timer = 0;
        if (dialogs.get(state.program.key) === state) dialogs.delete(state.program.key);
        const modal = state.modal;
        state.modal = null;
        if (!modal) return Promise.resolve();
        let done = Promise.resolve();
        if (!modal.classList.contains('program-fault-standalone') && typeof root.closeModal === 'function') {
            // closeModal: public/scripts/comp/modalUtils.js
            done = Promise.resolve().then(() => root.closeModal(modal));
        }
        return done.catch(() => {}).then(() => {
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        });
    }

    function nextFromQueue() {
        while (queue.length && dialogs.size < MAX_OPEN) {
            const state = queue.shift();
            if (dialogs.has(state.program.key)) continue;
            openState(state);
        }
    }

    // ---- close / restart -----------------------------------------------------------------------

    function liveWindow(p) {
        if (p.window && p.window.isConnected) return p.window;
        if (p.game) return findGameWindow(p.game);
        if (p.launchId) return findLaunchWindow(p.launchId);
        return null;
    }

    function canRelaunch(p) {
        if (!p || p.core) return false;
        const reg = p.window && p.window.id ? registered.get(p.window.id) : null;
        if (reg && typeof reg.relaunch === 'function') return true;
        // openVistaGame: public/scripts/comp/featureLoader.js
        if (p.game) return typeof root.openVistaGame === 'function';
        const d = launchableFor(p.launchId);
        return !!(d && typeof d.action === 'function');
    }

    /** Close the program's windows the way ending its process would: no "save?" prompts. */
    function terminate(p) {
        dead.set(p.key, now() + DEAD_GRACE_MS);
        const win = liveWindow(p);
        if (!win) return Promise.resolve();
        const reg = registered.get(win.id);
        try {
            if (reg && typeof reg.terminate === 'function') return Promise.resolve(reg.terminate(win)).catch(() => {});
            if (win.__vg && root.VistaGames && typeof root.VistaGames.closeWindow === 'function') {
                // the game's own close (its loops stop), without its "save the game?" question
                root.VistaGames.closeWindow(win.__vg);
                return whenHidden(win);
            }
            if (win.classList.contains('hidden')) return Promise.resolve();
            if (typeof root.closeModal === 'function') return Promise.resolve(root.closeModal(win)).catch(() => {}).then(() => whenHidden(win));
            win.classList.add('hidden');
        } catch (err) {
            console.error('Program fault: closing', p.name, 'failed:', err);
        }
        return Promise.resolve();
    }

    /** Resolves once the window's close animation has hidden it (a relaunch before that is undone by it). */
    function whenHidden(win, timeoutMs = 1500) {
        return new Promise((resolve) => {
            const t0 = now();
            (function check() {
                if (!win.isConnected || win.classList.contains('hidden') || now() - t0 > timeoutMs) resolve();
                else setTimeout(check, 50);
            })();
        });
    }

    function relaunch(p) {
        const reg = p.window && p.window.id ? registered.get(p.window.id) : null;
        dead.delete(p.key);
        if (reg && typeof reg.relaunch === 'function') return Promise.resolve().then(() => reg.relaunch());
        if (p.game) return Promise.resolve().then(() => root.openVistaGame(p.game));
        const d = launchableFor(p.launchId);
        return Promise.resolve().then(() => d.action());
    }

    function restartClient() {
        // fatalErrorBootstrap.js: no "leave the page?" prompt on the way out
        root.__dreamscapeFatalNavBypass = true;
        const navigate = () => {
            // restartClientNavigate: public/scripts/comp/modalUtils.js
            if (typeof root.restartClientNavigate === 'function') root.restartClientNavigate();
            else if (root.location) root.location.reload();
        };
        // runWinlogonPower: public/scripts/comp/winlogonPower.js (the Start menu's Restart). A broken
        // shell may fail or stall on its way down: then straight to /launch.
        if (typeof root.runWinlogonPower !== 'function') return navigate();
        setTimeout(navigate, RESTART_FALLBACK_MS);
        Promise.resolve().then(() => root.runWinlogonPower('restart')).catch(navigate);
    }

    function finish(state, action) {
        if (state.finished) return;
        if (action === 'cancel' && state.page === 'checking') {
            // Cancel stops the check; the dialog moves on to its next page
            advance(state);
            return;
        }
        state.finished = true;
        state.action = action;
        const p = state.program;
        updateReport(state, true);
        removeDialog(state).then(nextFromQueue);
        if (action === 'restart-os') {
            restartClient();
        } else if (action === 'close') {
            terminate(p);
        } else if (action === 'continue' || (action === 'dismiss' && p.core)) {
            // the program keeps running; the same fault from it is only counted from now on
            const prev = continued.get(p.key);
            const signatures = prev ? prev.signatures : new Set();
            for (const d of state.details) signatures.add(faultSignature(d));
            continued.set(p.key, { state, window: liveWindow(p), signatures });
        } else if (action === 'cancel' || action === 'dismiss') {
            // Cancel while restarting: the program was closed and stays closed
            dead.set(p.key, now() + DEAD_GRACE_MS);
        }
    }

    /** A continued program's repeat of a fault it already showed: count it, no new dialog. */
    function countContinued(p, detail) {
        const entry = continued.get(p.key);
        if (!entry) return false;
        const win = entry.window;
        if (win && (!win.isConnected || win.classList.contains('hidden'))) {
            // its window closed: a fault from a new run shows again
            continued.delete(p.key);
            return false;
        }
        if (!entry.signatures.has(faultSignature(detail))) return false;
        countInto(entry.state, detail);
        return true;
    }

    function countInto(state, detail) {
        state.repeats++;
        if (state.details.length < MAX_DETAILS) state.details.push(detail);
        updateReport(state, false);
    }

    // ---- reports -------------------------------------------------------------------------------

    function errorNameOf(detail) {
        const m = String(detail.stack || '').match(/^\s*((?:[A-Z][\w$]*)?(?:Error|Exception))\b/);
        return detail.errorName || (m ? m[1] : 'Error');
    }

    /** Same fault, another time: its message without numbers / quoted values, and its top script. */
    function faultSignature(detail) {
        const d = detail || {};
        const msg = String(d.message || d.reason || '').replace(/(["'`]).*?\1/g, '$1$1').replace(/\d+/g, '#');
        return msg + '\n' + (stackScripts(d.stack)[0] || '');
    }

    function openWindowTitles() {
        if (!doc) return [];
        const out = [];
        for (const m of doc.querySelectorAll('.modal')) {
            if (m.classList.contains('hidden') || m.classList.contains('program-fault-dialog') || (m.dataset && m.dataset.parentModalId)) continue;
            const t = windowTitle(m);
            out.push(t ? `${t} (#${m.id || '?'})` : '#' + (m.id || '?'));
            if (out.length >= 30) break;
        }
        return out;
    }

    function clientInfo() {
        let desktopState = '';
        try {
            if (typeof root.getClientDesktopState === 'function') desktopState = String(root.getClientDesktopState());
        } catch (_) { /* the shell may be what broke */ }
        const nav = root.navigator || {};
        return {
            url: root.location ? root.location.pathname : '',
            userAgent: nav.userAgent || '',
            viewport: root.innerWidth ? `${root.innerWidth}x${root.innerHeight}` : '',
            uptimeMs: root.performance && typeof root.performance.now === 'function' ? Math.round(root.performance.now()) : null,
            desktopState,
            windows: openWindowTitles()
        };
    }

    function reportBody(state) {
        const p = state.program;
        const d = state.details[0] || {};
        const win = liveWindow(p);
        const first = faultSignature(d);
        const seen = new Set([first]);
        const extraFaults = [];
        for (const x of state.details.slice(1)) {
            const sig = faultSignature(x);
            if (seen.has(sig)) continue;
            seen.add(sig);
            extraFaults.push({ message: x.message || x.reason || '', stack: x.stack || '' });
            if (extraFaults.length >= 5) break;
        }
        return {
            occurrenceId: state.occurrenceId,
            at: d.timestamp || new Date().toISOString(),
            program: {
                key: p.key,
                name: p.name,
                launchId: p.launchId || null,
                game: p.game || null,
                core: !!p.core,
                windowId: win ? win.id : null,
                windowTitle: win ? windowTitle(win) : null
            },
            errorName: errorNameOf(d),
            message: d.message || d.reason || '',
            stack: d.stack || '',
            fileLine: d.fileLine || '',
            source: d.source || '',
            scripts: stackScripts(d.stack),
            page: state.page,
            action: state.action || null,
            repeats: state.repeats,
            extraFaults,
            client: clientInfo()
        };
    }

    function timeout(promise, ms, what) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms);
            Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
        });
    }

    function postReport(state, final) {
        const r = state.report;
        const body = JSON.stringify(reportBody(state));
        r.sent = state.repeats;
        r.lastPostAt = now();
        r.sentAction = state.action || null;
        // the last post of a dialog may outlive the page (Restart now navigates away)
        const init = { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body };
        if (final && body.length < 60000) init.keepalive = true;
        return timeout(root.fetch(REPORT_URL, init), REPORT_POST_MS, 'Upload').then((res) => res.json().catch(() => null).then((j) => {
            if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || `HTTP ${res.status}`);
            r.status = 'saved';
            r.id = j.id;
            r.file = j.file || '';
            r.error = '';
        })).catch((err) => {
            // a failed update leaves an earlier saved report saved
            if (r.status !== 'saved') r.status = 'failed';
            r.error = err && err.message ? err.message : String(err);
        });
    }

    /** First upload of a dialog's fault. */
    function sendReport(state) {
        state.occurrenceId = `${Date.now().toString(36)}-${(++occurrenceSeq).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const r = state.report = { status: 'pending', id: null, file: '', error: '', sent: 0, sentAction: null, timer: 0, promise: null };
        if (typeof root.fetch !== 'function') {
            r.status = 'failed';
            r.error = 'no fetch';
            r.promise = Promise.resolve();
            return;
        }
        r.promise = postReport(state, false);
    }

    /** More faults counted, or the button that closed it: post the same occurrence again. */
    function updateReport(state, final) {
        const r = state.report;
        if (!r || (r.status === 'failed' && r.error === 'no fetch')) return;
        if (r.timer) clearTimeout(r.timer);
        r.timer = 0;
        const post = () => {
            r.timer = 0;
            if (r.sent === state.repeats && r.sentAction === (state.action || null)) return r.promise;
            return (r.promise = r.promise.then(() => postReport(state, final)));
        };
        if (final) post();
        else r.timer = setTimeout(post, Math.max(REPORT_UPDATE_MS, (r.lastPostAt || 0) + REPORT_MIN_GAP_MS - now()));
    }

    /** The report as the server has it, or null with why (r.error) when it cannot be confirmed. */
    function confirmReport(state) {
        const r = state.report;
        if (!r) return Promise.resolve(null);
        return timeout(r.promise, REPORT_WAIT_MS, 'Upload').catch(() => {}).then(() => {
            if (!r.id) {
                if (!r.error) r.error = r.status === 'pending' ? 'upload still pending' : 'not saved';
                return null;
            }
            return timeout(root.fetch(`${REPORT_URL}/${encodeURIComponent(r.id)}`, { credentials: 'same-origin', cache: 'no-store' }), REPORT_WAIT_MS, 'Check')
                .then((res) => res.json().catch(() => null).then((j) => {
                    if (!res.ok || !j || !j.ok || !j.report) throw new Error(res.status === 404 ? 'the server has no such report' : ((j && j.error) || `HTTP ${res.status}`));
                    const rep = j.report;
                    const mine = rep.id === r.id && Array.isArray(rep.recent) && rep.recent.some((o) => o.occurrenceId === state.occurrenceId);
                    if (!mine) throw new Error('the server report does not have this fault');
                    return { report: rep, file: j.file || r.file };
                }))
                .catch((err) => {
                    r.error = 'check failed: ' + (err && err.message ? err.message : String(err));
                    return null;
                });
        });
    }

    /** The top frame in a script of ours, as path:line:column (the build's ?sha= dropped). */
    function topFrame(stack) {
        const re = /((?:[a-z][\w+.-]*:\/\/[^/\s)]+)?\/[^\s)?#:]+\.js)(?:\?[^\s):]*)?:(\d+)(?::(\d+))?/i;
        for (const line of String(stack || '').split('\n')) {
            const m = re.exec(line);
            const file = m && scriptPath(m[1]);
            if (file) return `${file}:${m[2]}${m[3] ? ':' + m[3] : ''}`;
        }
        return '';
    }

    function fmtTime(iso) {
        return iso ? String(iso).replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '?';
    }

    function programLine(p) {
        const bits = [];
        if (p.core) bits.push('the desktop shell');
        if (p.launchId) bits.push('launcher ' + p.launchId);
        if (p.game) bits.push('game ' + p.game);
        return `Program: ${p.name}${bits.length ? ' (' + bits.join(', ') + ')' : ''}`;
    }

    /** What Copy Report puts on the clipboard: for an agent to read. */
    function reportText(state, confirmed) {
        const p = state.program;
        const d = state.details[0] || {};
        const name = errorNameOf(d);
        const msg = d.message || d.reason || 'Error';
        const err = name === 'Error' || msg.startsWith(name + ':') ? msg : `${name}: ${msg}`;
        const where = topFrame(d.stack) || (d.fileLine && d.fileLine !== '(unknown)' ? d.fileLine : '');
        if (confirmed) {
            const rep = confirmed.report;
            return [
                `Dreamscape fault report ${rep.id} (saved on the server)`,
                TEXT.heading(p.name),
                programLine(p),
                `Error: ${err}`,
                where ? `In: ${where}` : '',
                `Seen: ${rep.count} dialog(s), ${rep.repeats} fault(s); first ${fmtTime(rep.firstSeen)}, last ${fmtTime(rep.lastSeen)}`,
                `Full report: ${confirmed.file || 'data/fault-reports/' + rep.id + '.json'} on the Dreamscape server (GET /api/fault-reports/${rep.id})`
            ].filter(Boolean).join('\n');
        }
        const c = clientInfo();
        const body = reportBody(state);
        const lines = [
            `Dreamscape fault report (not saved on the server: ${(state.report && state.report.error) || 'no report'}; the full error is below)`,
            TEXT.heading(p.name),
            programLine(p),
            body.program.windowTitle ? `Window: ${body.program.windowTitle} (#${body.program.windowId})` : null,
            `Error: ${err}`,
            where ? `In: ${where}` : null,
            d.source ? `Source: ${d.source}` : null,
            `Time: ${fmtTime(d.timestamp)}`,
            `Faults counted into this dialog: ${state.repeats}`,
            `Dialog: ${state.page}${state.action ? ', ' + state.action : ''}`,
            `Client: ${c.url} ${c.viewport}, up ${c.uptimeMs != null ? Math.round(c.uptimeMs / 1000) + ' s' : '?'}, ${c.desktopState || '?'}; ${c.userAgent}`,
            c.windows.length ? `Open windows: ${c.windows.join('; ')}` : null,
            '',
            'Stack:',
            d.stack || '(no stack)'
        ];
        for (const x of body.extraFaults) {
            lines.push('', `Also counted: ${x.message}`, x.stack || '(no stack)');
        }
        return lines.filter((l) => l !== null).join('\n');
    }

    function copyText(text) {
        const legacy = () => {
            // execCommand needs a selection inside the dialog's focus scope
            const ta = el('textarea', 'program-fault-clip');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            (doc.activeElement && doc.activeElement.closest && doc.activeElement.closest('.program-fault-dialog') || doc.body).appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = doc.execCommand('copy'); } catch (_) { ok = false; }
            ta.remove();
            return ok;
        };
        const clip = root.navigator && root.navigator.clipboard;
        if (clip && typeof clip.writeText === 'function') {
            return clip.writeText(text).then(() => true, () => legacy());
        }
        return Promise.resolve(legacy());
    }

    function copyButton(state) {
        const b = button(TEXT.copyReport, false, () => {
            if (b.disabled) return;
            b.disabled = true;
            if (b.style && b.offsetWidth) b.style.minWidth = b.offsetWidth + 'px';
            confirmReport(state).then((confirmed) => {
                const text = reportText(state, confirmed);
                state.lastCopied = text;
                return copyText(text);
            }).catch(() => false).then((ok) => {
                b.textContent = ok ? TEXT.copied : TEXT.copyFailed;
                setTimeout(() => {
                    b.textContent = TEXT.copyReport;
                    b.disabled = false;
                }, COPIED_MS);
            });
        });
        b.classList.add('program-fault-copy');
        return b;
    }

    // ---- entry points --------------------------------------------------------------------------

    /** Show (or count into) the dialog for program p. */
    function presentProgram(p, detail) {
        const open = dialogs.get(p.key) || queue.find((s) => s.program.key === p.key);
        if (open) {
            countInto(open, detail);
            return true;
        }
        const until = dead.get(p.key);
        if (until && until > now()) return true;
        dead.delete(p.key);
        if (countContinued(p, detail)) return true;
        const state = { program: p, repeats: 1, details: [detail], page: '', modal: null, timer: 0, finished: false, action: null, report: null };
        sendReport(state);
        if (dialogs.size >= MAX_OPEN) {
            if (queue.length < MAX_QUEUED) queue.push(state);
            return true;
        }
        openState(state);
        return true;
    }

    let presenting = false;

    /** From fatalErrorBootstrap.js: true when this dialog took the fault (Spectator otherwise). */
    function present(detail, context) {
        if (presenting || !doc || !doc.body) return false;
        const d = detail || {};
        const c = context || {};
        const stack = d.stack || (c.error && c.error.stack) || '';
        // a fault in this file (or the dialog's own code) goes to Spectator, never round again
        if (/\/scripts\/comp\/programFaults\.js/.test(stack)) return false;
        presenting = true;
        try {
            const p = attribute({
                stack,
                filename: c.filename || '',
                eventWindow: eventContext.window,
                eventShell: eventContext.shell
            });
            if (!p || (p.core && c.appsOnly)) return false;
            console.error(`Program fault: ${p.name} (${p.key})`, c.error || d.message || d);
            return presentProgram(p, d);
        } catch (err) {
            try { console.error('Program fault dialog failed:', err); } catch (_) { /* ignore */ }
            return false;
        } finally {
            presenting = false;
        }
    }

    /**
     * For catch blocks that swallow a handler's error (WebSocket dispatch): only faults traced to a
     * program show; a shell handler's error stays a console line, as before.
     */
    function report(error, options) {
        const err = error instanceof Error ? error : new Error(String(error));
        const detail = {
            message: err.message || 'Error',
            reason: err.message || 'Error',
            stack: err.stack || '',
            source: (options && options.source) || '',
            timestamp: new Date().toISOString()
        };
        return present(detail, { error: err, appsOnly: !(options && options.core) });
    }

    function init() {
        if (!doc || init.done) return;
        init.done = true;
        for (const type of NOTED_EVENTS) root.addEventListener(type, noteEvent, { capture: true, passive: true });
    }

    function reset() {
        for (const state of Array.from(dialogs.values())) removeDialog(state);
        queue.length = 0;
        dead.clear();
        continued.clear();
    }

    const api = {
        present,
        report,
        attribute,
        registerProgram,
        programForWindow,
        classifyScript,
        stackScripts,
        openDialogs: () => Array.from(dialogs.values()).map((s) => ({ key: s.program.key, name: s.program.name, page: s.page, repeats: s.repeats, id: s.modal && s.modal.id, report: s.report && { status: s.report.status, id: s.report.id, error: s.report.error } })),
        continuedPrograms: () => Array.from(continued.keys()),
        faultSignature,
        reportText,
        queued: () => queue.map((s) => s.program.key),
        reset,
        TEXT,
        CORE_SCRIPT,
        MONOLITH_PROGRAMS,
        FEATURE_PROGRAMS,
        WINDOW_LAUNCH,
        _eventContext: eventContext,
        _noteEvent: noteEvent
    };
    if (root) {
        root.programFaults = api;
        init();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
