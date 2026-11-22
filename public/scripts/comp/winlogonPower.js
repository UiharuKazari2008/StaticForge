// Vista winlogon power path. Restart, shutdown, log off, and Restart Server all come
// back to the Welcome screen before the browser is released. The copy is winsrv.dll
// (the "still running" list) and the screen captured on the Vista VM: the aurora with
// the wait spinner and "Shutting down..." (a forced restart landed there in one frame,
// under 225 ms). "Logging off..." is winlogon string 1003, used for Log Off.

// Desktop fades to black, holds, then the Welcome screen is revealed. The browser
// stays until "Shutting down..." / "Logging off..." has been on screen.
const WINLOGON_FADE_OUT_MS = 900;
const WINLOGON_BLACK_HOLD_MS = 250;
const WINLOGON_FADE_IN_MS = 800;
const WINLOGON_TEXT_HOLD_MS = 700;
// Then every path cuts to black at once (cutShutdownCover), like the monitor losing its
// signal (a real PC does not fade "Shutting down..." out), before /launch POSTs
// again. The work that has to finish (the log off request, pending desktop saves, the
// server restart) runs in the dark: it stays dark past the usual few seconds only while
// that work is still running, and never past the cap.
const WINLOGON_POWER_BLACK_MS = 2500;
const WINLOGON_POWER_BLACK_MAX_MS = 8000;

const WINLOGON_POWER_COPY = {
    restart: {
        footer: 'To close these programs and restart your computer,\nclick Restart now.\nYou may lose work that you haven\'t saved.',
        action: 'Restart now',
        accel: 'R',
        reason: 'This program is preventing your computer from restarting.',
        screen: 'Shutting down...',
        sound: 'shutdown'
    },
    shutdown: {
        footer: 'To close these programs and turn off your computer,\nclick Shut down now.\nYou may lose work that you haven\'t saved.',
        action: 'Shut down now',
        accel: 'S',
        reason: 'This program is preventing your computer from shutting down.',
        screen: 'Shutting down...',
        sound: 'shutdown'
    },
    logoff: {
        footer: 'To close these programs and log off your computer,\nclick Log off now.\nYou may lose work that you haven\'t saved.',
        action: 'Log off now',
        accel: 'L',
        reason: 'This program is preventing you from logging off.',
        screen: 'Logging off...',
        sound: 'lock'
    }
};

// Restart Server uses the same screen and list as Restart.
WINLOGON_POWER_COPY.server = WINLOGON_POWER_COPY.restart;

const LOGOFF_SKIP_IDS = {
    desktopPreStartupModal: 1,
    connectionDialModal: 1,
    confirmationDialog: 1,
    bootMessageBox: 1,
    mainframeServerModal: 1,
    windowsStartupModal: 1,
    workstationLockModal: 1,
    agentClientUpdateDialog: 1,
    galleryWindow: 1,
    winlogonBlock: 1
};

let winlogonPowerRunning = false;

function winlogonPowerCopy(kind) {
    return WINLOGON_POWER_COPY[kind] || WINLOGON_POWER_COPY.restart;
}

function winlogonDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function winlogonModalOpen(modal) {
    return modal && !modal.classList.contains('hidden') && !modal.classList.contains('closing');
}

function winlogonBlockerName(modal) {
    const span = modal.querySelector('.modal-window-title-main span');
    const text = span ? String(span.textContent || '').trim() : '';
    return text || 'Untitled';
}

function winlogonBlockerIcon(modal) {
    const img = modal.querySelector('.modal-window-title-main .icon-image');
    if (img && img.getAttribute('src')) {
        const copy = document.createElement('img');
        copy.src = img.getAttribute('src');
        copy.alt = '';
        return copy;
    }
    const icon = modal.querySelector('.modal-window-title-main i');
    if (icon) return icon.cloneNode(true);
    return null;
}

function winlogonProgramFromModal(modal, blocking) {
    // getModalTitle / getModalIcons / getIconHTML: public/scripts/comp/modalUtils.js (the taskbar's own)
    let name = typeof getModalTitle === 'function' ? String(getModalTitle(modal) || '').trim() : '';
    if (!name) name = winlogonBlockerName(modal);
    let icon = null;
    if (typeof getModalIcons === 'function' && typeof getIconHTML === 'function') {
        const icons = getModalIcons(modal) || {};
        if (icons.icon || icons.imageIcon) {
            const holder = document.createElement('span');
            holder.innerHTML = getIconHTML(icons.icon, icons.imageIcon, '', 32);
            // dual markup is <i class="icon-fa"> + <img>: the desktop draws the image
            icon = holder.querySelector('img') || holder.firstElementChild;
        }
    }
    return { modal, name, icon: icon || winlogonBlockerIcon(modal), blocking: !!blocking };
}

/** Studio open, or a Notepad with unsaved changes. Those gate logoff. */
function collectLogoffBlockers() {
    const items = [];
    const seen = new Set();
    const add = (modal) => {
        if (!winlogonModalOpen(modal) || seen.has(modal)) return;
        if (modal.id && LOGOFF_SKIP_IDS[modal.id]) return;
        seen.add(modal);
        items.push(winlogonProgramFromModal(modal, true));
    };

    add(document.getElementById('manualModal'));

    // notepadManager: public/scripts/comp/notepadManager.js (notepad feature)
    const pads = window.notepadManager && window.notepadManager.notepads;
    if (pads && typeof pads.forEach === 'function') {
        pads.forEach((pad) => {
            if (!pad || !pad.hasUnsavedChanges) return;
            add(pad.element);
        });
    }
    return items;
}

/**
 * Vista lists every program that still has a window, not only the ones that block: the
 * blockers first (with the orange reason), then the rest front to back, minimised last.
 */
function collectWinlogonPrograms(blockers) {
    const items = blockers.slice();
    const seen = new Set(blockers.map((item) => item.modal));
    // getOpenTaskbarModals / windowUsageStack: public/scripts/comp/modalUtils.js
    const open = typeof getOpenTaskbarModals === 'function' ? getOpenTaskbarModals() : [];
    const usage = typeof windowUsageStack !== 'undefined' && Array.isArray(windowUsageStack) ? windowUsageStack : [];
    const depth = (modal) => Number(modal.style && modal.style.zIndex) || 0;
    const others = open.filter((modal) => modal && !seen.has(modal) && !(modal.id && LOGOFF_SKIP_IDS[modal.id]));
    others.sort((a, b) => {
        const aMin = a.classList.contains('minimised') ? 1 : 0;
        const bMin = b.classList.contains('minimised') ? 1 : 0;
        if (aMin !== bMin) return aMin - bMin;
        return (depth(b) - depth(a)) || (usage.lastIndexOf(b) - usage.lastIndexOf(a));
    });
    others.forEach((modal) => items.push(winlogonProgramFromModal(modal, false)));
    return items;
}

function winlogonBlockEl(tag, className, id) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (id) el.id = id;
    return el;
}

// winsrv.dll dialog 20 (Segoe UI 10 pt, 266x224 DLU) with row dialogs 21 / 22 under it.
function ensureWinlogonBlock() {
    let root = document.getElementById('winlogonBlock');
    if (root) return root;
    root = winlogonBlockEl('div', 'winlogon-block', 'winlogonBlock');
    root.hidden = true;
    const dialog = winlogonBlockEl('div', 'winlogon-block-dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-labelledby', 'winlogonBlockTitle');
    dialog.setAttribute('aria-describedby', 'winlogonBlockFooter');
    const actions = winlogonBlockEl('div', 'winlogon-block-actions');
    const go = winlogonBlockEl('button', 'winlogon-block-go', 'winlogonBlockGo');
    go.type = 'button';
    go.appendChild(winlogonBlockEl('span', 'winlogon-block-busy'));
    go.appendChild(winlogonBlockEl('span', 'winlogon-block-label', 'winlogonBlockGoLabel'));
    const cancel = winlogonBlockEl('button', 'winlogon-block-cancel', 'winlogonBlockCancel');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    actions.appendChild(go);
    actions.appendChild(cancel);
    dialog.appendChild(winlogonBlockEl('div', 'winlogon-block-title', 'winlogonBlockTitle'));
    dialog.appendChild(winlogonBlockEl('div', 'winlogon-block-rule'));
    dialog.appendChild(winlogonBlockEl('div', 'winlogon-block-list', 'winlogonBlockList'));
    dialog.appendChild(winlogonBlockEl('div', 'winlogon-block-rule'));
    dialog.appendChild(winlogonBlockEl('div', 'winlogon-block-footer', 'winlogonBlockFooter'));
    dialog.appendChild(actions);
    root.appendChild(dialog);
    document.body.appendChild(root);
    return root;
}

function fillWinlogonBlock(kind, items) {
    const copy = winlogonPowerCopy(kind);
    const root = ensureWinlogonBlock();
    const title = document.getElementById('winlogonBlockTitle');
    const list = document.getElementById('winlogonBlockList');
    const footer = document.getElementById('winlogonBlockFooter');
    const label = document.getElementById('winlogonBlockGoLabel');
    title.textContent = 'The following programs are still running:';
    footer.textContent = copy.footer;
    label.textContent = '';
    const accel = copy.accel;
    const action = copy.action;
    // The underline only shows once Alt is pressed (Vista hides keyboard cues by default).
    if (accel && action.charAt(0).toUpperCase() === accel) {
        const mark = document.createElement('u');
        mark.textContent = action.charAt(0);
        label.appendChild(mark);
        label.appendChild(document.createTextNode(action.slice(1)));
    } else {
        label.textContent = action;
    }
    root.classList.remove('winlogon-block-cues');
    list.textContent = '';
    items.forEach((item) => {
        const row = winlogonBlockEl('div', item.blocking ? 'winlogon-block-row blocking' : 'winlogon-block-row');
        const icon = winlogonBlockEl('span', 'winlogon-block-icon');
        if (item.icon) icon.appendChild(item.icon);
        const name = winlogonBlockEl('span', 'winlogon-block-name');
        name.textContent = item.name;
        row.appendChild(icon);
        row.appendChild(name);
        if (item.blocking) {
            const reason = winlogonBlockEl('span', 'winlogon-block-reason');
            reason.textContent = copy.reason;
            row.appendChild(reason);
        }
        list.appendChild(row);
    });
    return root;
}

const WINLOGON_BLOCK_ART = ['restart', 'cancel'].reduce((list, name) => list.concat(
    ['normal', 'hot', 'pressed', 'focus', 'focus-hot'].map((state) => `${name}-${state}.png`)
), ['busy.png', 'rule.png']).map((file) => `/static_images/vista-shutdown/${file}`);

/** The screen comes up whole, as Vista's does: its bitmaps are decoded first (briefly). */
function preloadWinlogonBlockArt() {
    const loads = WINLOGON_BLOCK_ART.map((src) => {
        const img = new Image();
        img.src = src;
        return typeof img.decode === 'function' ? img.decode().catch(() => null) : null;
    });
    return Promise.race([Promise.all(loads), winlogonDelay(400)]);
}

async function askWinlogonBlock(kind, items) {
    await preloadWinlogonBlockArt();
    const root = fillWinlogonBlock(kind, items);
    const go = document.getElementById('winlogonBlockGo');
    const cancel = document.getElementById('winlogonBlockCancel');
    const accel = (winlogonPowerCopy(kind).accel || '').toLowerCase();
    root.hidden = false;
    return new Promise((resolve) => {
        let settled = false;
        const finish = (accepted) => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKey, true);
            go.removeEventListener('click', onGo);
            cancel.removeEventListener('click', onCancel);
            root.hidden = true;
            resolve(accepted);
        };
        const onGo = () => finish(true);
        const onCancel = () => finish(false);
        const onKey = (event) => {
            if (event.key === 'Alt') root.classList.add('winlogon-block-cues');
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            } else if (event.key === 'Enter') {
                // Enter presses the focused button; Restart now has the focus at first
                event.preventDefault();
                finish(document.activeElement !== cancel);
            } else if (event.key === 'Tab') {
                event.preventDefault();
                (document.activeElement === go ? cancel : go).focus();
            } else if (event.altKey && accel && String(event.key).toLowerCase() === accel) {
                event.preventDefault();
                finish(true);
            }
        };
        go.addEventListener('click', onGo);
        cancel.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey, true);
        go.focus();
    });
}

function shutdownCover() {
    let overlay = document.getElementById('clientShutdownOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'clientShutdownOverlay';
        overlay.className = 'client-shutdown-overlay';
        document.body.appendChild(overlay);
    }
    overlay.classList.add('winlogon-pace');
    return overlay;
}

function fadeShutdownCover(show) {
    const overlay = shutdownCover();
    const ms = show ? WINLOGON_FADE_OUT_MS : WINLOGON_FADE_IN_MS;
    overlay.style.transitionDuration = ms + 'ms';
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            overlay.removeEventListener('transitionend', onEnd);
            resolve();
        };
        const onEnd = (event) => {
            if (event.target === overlay && event.propertyName === 'opacity') finish();
        };
        overlay.addEventListener('transitionend', onEnd);
        setTimeout(finish, ms + 80);
        if (show) {
            overlay.classList.remove('show');
            void overlay.offsetWidth;
        }
        overlay.classList.toggle('show', show);
    });
}

/** Black in the same frame, no fade: the display going off after "Shutting down...". */
function cutShutdownCover() {
    const overlay = shutdownCover();
    overlay.style.transitionDuration = '0ms';
    overlay.classList.add('show');
    void overlay.offsetWidth;
    // a frame or 200 ms, whichever comes first: with no frames drawn (the DreamOS Mac, Nov 20: its compositor stopped
    // after "Configuring updates: Stage 2 of 3 - 100% complete", CDP screenshots timed out too) a bare
    // requestAnimationFrame never resolved and the restart never reached DreamOSPower, every time (#951)
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, 200);
        requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
    });
}

function showWinlogonPowerScreen(text) {
    const modal = document.getElementById('desktopPreStartupModal');
    if (!modal) return false;
    // wsClient: public/scripts/websocket.js
    if (window.wsClient) {
        window.wsClient.winlogonPowerText = text;
        window.wsClient._hideConnectionDialModal();
    }
    const status = document.getElementById('desktopPreStartupStatus');
    if (status) status.textContent = text;
    // the wait ring turns for as long as a power or update line is up (websocket.js pauses it on the password box)
    const ring = modal.querySelector('.desktop-prestartup-progress');
    if (ring) ring.classList.remove('paused');
    document.body.classList.add('winlogon-power');
    // the classic logon's box is in Windows Classic, as at the logon (uiTheme.setBootTheme: public/scripts/comp/uiTheme.js);
    // the desktop is under the black cover by now
    if (!document.body.classList.contains('vista-logon') && !document.body.classList.contains('windows-classic-theme') && window.uiTheme) {
        window.uiTheme.setBootTheme('classic');
        modal.dataset.powerClassic = '1';
    }
    modal.classList.add('power-status-only', 'vista-logon-art-ready');
    modal.classList.remove('auth-active', 'auth-busy', 'closing');
    if (modal.classList.contains('hidden')) {
        // openModal: public/scripts/comp/modalUtils.js
        openModal(modal);
    }
    return true;
}

function hideWinlogonPowerScreen() {
    const overlay = document.getElementById('clientShutdownOverlay');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('winlogon-power');
    const modal = document.getElementById('desktopPreStartupModal');
    if (modal) {
        modal.classList.remove('winlogon-power-in', 'power-status-only');
        if (modal.dataset.powerClassic && window.uiTheme) {
            delete modal.dataset.powerClassic;
            window.uiTheme.setBootTheme(null);
        }
        if (window.wsClient && window.wsClient.initializationCompleted) {
            modal.classList.add('hidden');
        }
    }
    if (window.wsClient) window.wsClient.winlogonPowerText = '';
    const status = document.getElementById('desktopPreStartupStatus');
    if (status) delete status.dataset.lines;
}

function winlogonPowerQuiet(label, job) {
    return Promise.resolve().then(job).catch((error) => {
        console.warn(`⚠️ ${label} did not finish before the power screen:`, error);
    });
}

/**
 * What has to finish before the browser lets go, started as the screen goes dark. Pending
 * desktop saves never stop the shutdown; a failed log off or server restart does (the
 * caller shows why), since /launch would boot straight back in or against the old server.
 */
function startWinlogonPowerWork(kind, onCommit, signOut) {
    bypassConfirmation = true;
    // suppressWebSocketReconnectForReload: public/scripts/comp/modalUtils.js
    suppressWebSocketReconnectForReload();
    const jobs = [
        // desktopShortcuts.flushPendingDesktopLayout: public/scripts/comp/desktopShortcuts.js
        winlogonPowerQuiet('Desktop layout save', () => {
            const shortcuts = window.desktopShortcuts;
            if (shortcuts && typeof shortcuts.hasPendingDesktopChanges === 'function'
                && shortcuts.hasPendingDesktopChanges()) {
                return shortcuts.flushPendingDesktopLayout();
            }
            return null;
        })
    ];
    if (kind === 'logoff') {
        // the next logon asks for the password, whatever the server still holds (cachedLogon.js, Yukimi Nov 19)
        if (window.cachedLogon && typeof window.cachedLogon.markLoggedOff === 'function') window.cachedLogon.markLoggedOff();
        // handleLogout: public/scripts/comp/connectionManager.js (stays put; the logon is next). An installed copy
        // logs off without its server too (the mark above keeps the desktop shut); a plain tab needs the server.
        // A certificate client (CaféReady, the Android app) keeps its session: Log off is a lock there, and only the
        // Nightshade client's Sign Out (signOut) ends it (Yukimi, Nov 20 2026)
        // keepSiteAccess: the user signs out, the computer keeps its site key - the logon that follows reaches the server
        jobs.push(Promise.resolve().then(() => handleLogout({ redirect: false, keepSiteAccess: true, signOut: !!signOut })).then((ok) => {
            if (!ok && signOut) throw new Error('Could not sign out of the Nightshade Network. Connect to it and try again.');
            if (!ok && !winlogonInstalledCopy()) throw new Error('Could not log off. You are still signed in.');
        }));
    }
    if (kind === 'server' && typeof onCommit === 'function') {
        jobs.push(Promise.resolve().then(onCommit));
    }
    return Promise.all(jobs);
}

/**
 * The dark screen (dark: the fade to black): WINLOGON_POWER_BLACK_MS once it is black, longer
 * only while the work is still running, never past maxMs (Infinity: until the work settles,
 * for a server restart whose onCommit carries its own timeouts). Throws if the work failed.
 */
async function lingerWinlogonPowerBlack(work, dark, maxMs = WINLOGON_POWER_BLACK_MAX_MS) {
    let failure = null;
    let done = false;
    const settled = work.then(() => { done = true; }, (error) => {
        failure = error || new Error('Power work failed');
        done = true;
    });
    await dark;
    await winlogonDelay(WINLOGON_POWER_BLACK_MS);
    if (!done && Number.isFinite(maxMs)) {
        await Promise.race([settled, winlogonDelay(maxMs - WINLOGON_POWER_BLACK_MS)]);
    } else if (!done) {
        await settled;
    }
    if (failure) throw failure;
}

/**
 * Shut down and log off end the session: the Director's pagehide reopen flag
 * (DIRECTOR_REOPEN_KEY, public/scripts/comp/director.js) must not carry through /launch,
 * which never reads it, into the next logon. Added at the exit, so it runs after the
 * Director's own pagehide save. Restart keeps it (a restart reopens the window).
 */
function forgetDirectorReopen() {
    window.addEventListener('pagehide', () => {
        try { sessionStorage.removeItem('staticforge_director_reopen'); } catch (_) { /* storage blocked */ }
    }, { once: true });
}

// ---- Updates on the Welcome screen (Yozora #924), one scope: nothing here is a page global ----
(() => {
    /** The Welcome screen's status while a power sequence or the configuring stage holds it: one or two lines ('\n'). */
    function setWinlogonPowerText(text) {
        if (window.wsClient) window.wsClient.winlogonPowerText = text;
        const status = document.getElementById('desktopPreStartupStatus');
        if (!status) return;
        if (status.textContent !== text) status.textContent = text;
        // two lines lay out as Vista's do (desktop-boot.css): 32 px apart, the wait ring centred beside both
        const two = String(text).indexOf('\n') >= 0;
        if (two !== (status.dataset.lines === '2')) {
            if (two) status.dataset.lines = '2';
            else delete status.dataset.lines;
        }
    }

    // ---- Updates install on the way down, like Windows (Yozora #924) ----
    // serviceWorkerManager.js plans (what is downloaded and waiting, what the server has since) and
    // installs; this file owns the screen. The lines are Windows Update's and the servicing stack's
    // (wuaueng.dll.mui, cbsmsg.dll.mui), shown where Vista shows them: the Welcome screen's status,
    // between "Logging off..." and "Shutting down...".
    const WINLOGON_UPDATE_PLAN_MAX_MS = 8000;

    function winlogonUpdater(kind) {
        // updates install at shut down and restart only, as in Vista; log off leaves them waiting (Yukimi, Nov 19)
        if (kind === 'server' || kind === 'logoff') return null;
        // serviceWorkerManager: public/scripts/comp/serviceWorkerManager.js
        const m = window.serviceWorkerManager;
        return m && typeof m.planShutdownInstall === 'function' && typeof m.installUpdatesAtShutdown === 'function' ? m : null;
    }

    /** The plan, or null when it is not known in time (the updates stay in the cache for the next start). */
    function winlogonUpdatePlan(updater, planning) {
        if (!updater || !planning) return Promise.resolve(null);
        return Promise.race([planning, winlogonDelay(WINLOGON_UPDATE_PLAN_MAX_MS).then(() => null)])
            .then((plan) => (plan && Array.isArray(plan.updates) && (plan.updates.length || (Array.isArray(plan.firmware) && plan.firmware.length)) ? plan : null), () => null);
    }

    /**
     * The configuring stage at the next start (serviceWorkerManager._configureUpdatesAtBoot): the
     * Welcome screen with only its status, before the logon. hideWinlogonStatus hands the screen back
     * to the boot as it was.
     */
    let statusHeld = null;
    function showWinlogonStatus(text) {
        const modal = document.getElementById('desktopPreStartupModal');
        if (!modal) return false;
        if (!statusHeld) {
            statusHeld = { wasHidden: modal.classList.contains('hidden') || modal.classList.contains('closing'), hadArt: modal.classList.contains('vista-logon-art-ready') };
            showWinlogonPowerScreen(text);
            setWinlogonPowerText(text);
            document.body.classList.add('winlogon-configuring');
        } else {
            setWinlogonPowerText(text);
        }
        return true;
    }

    function hideWinlogonStatus() {
        const held = statusHeld;
        if (!held) return;
        statusHeld = null;
        const ws = window.wsClient;
        // Vista goes on from "Configuring updates" to the logon (Yukimi, Nov 19: after an update it jumped to the
        // desktop and the ring stopped). While the logon is still to come, the Welcome screen stays up with its art and
        // the boot's own logon dialog takes it over at once - the password box, or "Please wait..." / "Welcome" with
        // the ring turning - whatever the connection reached while the stage held the screen (its renders were held).
        // desktopBoot.isWelcomeUp: public/scripts/comp/desktopBoot.js - a logon that went on behind the stage is building
        // the desktop under this screen; it keeps it until the desktop is complete (Nov 20 2026, the DreamOS Mac: hiding
        // it here showed the wallpaper alone, then the icons, taskbar and Sidebar popping in)
        const welcomeBoot = !!(window.desktopBoot && typeof window.desktopBoot.isWelcomeUp === 'function' && window.desktopBoot.isWelcomeUp());
        const logonAhead = welcomeBoot || !!(ws && window.isDesktop && typeof ws._shouldUsePreStartupDialog === 'function'
            && ws._shouldUsePreStartupDialog() && !ws.initializationCompleted);
        document.body.classList.remove('winlogon-power', 'winlogon-configuring');
        const modal = document.getElementById('desktopPreStartupModal');
        if (modal) {
            modal.classList.remove('power-status-only');
            if (!logonAhead) {
                if (!held.hadArt) modal.classList.remove('vista-logon-art-ready');
                if (held.wasHidden) modal.classList.add('hidden');
            }
        }
        const status = document.getElementById('desktopPreStartupStatus');
        if (status) delete status.dataset.lines;
        if (ws) {
            ws.winlogonPowerText = '';
            // the boot's own logon dialog takes the screen back (public/scripts/websocket.js)
            // (the desktop being built under it: its own line, "Preparing your desktop...", and a reveal held back for this)
            if (welcomeBoot) window.desktopBoot.refresh();
            else if ((logonAhead || !held.wasHidden) && typeof ws._renderPreStartupDialog === 'function') ws._renderPreStartupDialog();
        }
    }

    /**
     * The native host's power switch, when the machine has one for the page: window.DreamOSPower
     * { shutdown(), restart() } (the DreamOS shell bridge). True when the host took it; the page then
     * stays dark and does nothing more. Log off and a server restart are always the page's own.
     */
    function winlogonHostPower(kind) {
        if (kind !== 'shutdown' && kind !== 'restart') return false;
        // a Continuity desktop (the phone's DeX window) shut down: the window closes, the phone stays on (#945)
        const mc = window.melatonContinuity;
        if (kind === 'shutdown' && mc && typeof mc.hostShutdown === 'function' && typeof mc.isDexWindow === 'function' && mc.isDexWindow()) {
            try { if (mc.hostShutdown()) return true; } catch (_) { /* restart into /launch instead */ }
        }
        const host = window.DreamOSPower;
        try {
            if (!host || typeof host[kind] !== 'function') return false;
            if (host[kind]() === false) return false;
            // suppressWebSocketReconnectForReload already ran: nothing reconnects while the host powers down
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * The phone's restart / shut down: its waiting updates install under wceload's package screen first. opts.beforeInstall
     * (a restart of both Continuity windows, Yukimi Nov 20 2026): the screen shows at once, then the hook shuts the DeX
     * window down (melatonContinuity.dexShutdownFirst) before anything installs; a hook that answers false (a program kept
     * open on the desktop) closes the screen and nothing restarts - this then answers false.
     */
    async function installWaitingUpdatesNarrow(kind, opts = {}) {
        const updater = winlogonUpdater(kind);
        const dexFirst = typeof opts.beforeInstall === 'function';
        const waiting = !!(updater && kind !== 'logoff' && updater.updatesWaitingCount());
        if (!waiting && !dexFirst) return true;
        // wmShell.progressBox: public/scripts/comp/wmShell.js (#806)
        // the box only when the install takes long enough to see (files already in the cache check in
        // an instant: a box that flashes says nothing)
        let box = null;
        let text = 'Installing updates...';
        // #951: the phone installs its updates the way Windows Mobile installs a package - wceload's
        // "Installing Melaton Mobile update..." screen and bar, then its success page after the restart
        // (wmShell.packageInstall); the progress box stays for a shell without it
        const pkg = window.wmShell && typeof window.wmShell.packageInstall === 'function' ? window.wmShell.packageInstall : null;
        let installed = false;
        const openBox = () => {
            if (box) return;
            if (pkg) {
                const screen = pkg();
                box = { update: (o) => { if (o && o.pct != null) screen.progress(o.pct); }, close: () => { if (installed) screen.restartNext(); else screen.cancel(); }, screen };
                return;
            }
            if (window.wmShell && typeof window.wmShell.progressBox === 'function') box = window.wmShell.progressBox({ title: 'Melaton Update', text, pct: null });
        };
        let boxTimer = 0;
        if (dexFirst) {
            openBox();
            let go = true;
            try { go = (await opts.beforeInstall()) !== false; } catch (_) { go = true; }
            if (!go) {
                if (box) box.close();
                return false;
            }
        } else {
            boxTimer = setTimeout(openBox, 400);
        }
        try {
            // waiting updates only: a phone restart does not wait on the server for more
            // the server's newer files join this restart (#951): it is a shut down, not a start, so the list may be
            // asked (bounded); before, a phone restart installed only what was waiting and the next start found more
            // a plan worked out earlier (a power menu's shield, an earlier check) may predate what is counted now: the
            // restart plans afresh (#951: a phone restart installed nothing of 27 counted files)
            if (waiting && typeof updater.forgetShutdownPlan === 'function') updater.forgetShutdownPlan();
            const plan = waiting ? await winlogonUpdatePlan(updater, updater.planShutdownInstall()) : null;
            let result = null;
            if (plan) {
                // Windows Mobile installs before the restart, under its own box: no Welcome screen, no
                // servicing stages (those are the desktop's)
                result = await updater.installUpdatesAtShutdown(plan, {
                    kind,
                    plain: true,
                    onStatus: (line) => { text = String(line).split('\n')[0]; if (box) box.update({ text, pct: null }); },
                    // the download's progress on the box's bar (#951: updates held as a count download here)
                    onPercent: (pct) => { if (box) box.update({ text, pct }); }
                });
            }
            // nothing to install and no restart of both: the screen goes back as it was (wceload's success page is for
            // an install)
            // an install that failed is not wceload's success page (#1022): the updates stay waiting
            installed = (!!plan && !(result && result.failed > 0)) || dexFirst;
            if (installed && box && box.screen) box.screen.progress(100);
        } catch (_) { /* restart anyway: the files are in the cache */ }
        clearTimeout(boxTimer);
        if (box) box.close();
        return true;
    }

    /**
     * Before the page goes (#951): a download still running finishes (it may hold a later set of updates), then the
     * worker takes the server's newest /app and /launch and keeps them once their files are here - an installed
     * client starts on the kept /app, so the restart runs what was just installed instead of the old page that then
     * asked for a second restart. Only after updates this session; bounded, never throws.
     */
    async function commitShellBeforeLeaving(kind) {
        if (kind === 'server') return;
        const m = window.serviceWorkerManager;
        if (!m || typeof m.commitShellAndWait !== 'function' || !(m._shellCommitWanted || m.pendingUpdateFuse || m.isUpdating)) return;
        try {
            if (m.isUpdating && typeof m.attachToDownloadProgress === 'function') {
                await Promise.race([m.attachToDownloadProgress({ stallMs: 20000 }), winlogonDelay(60000)]);
            }
        } catch (_) { /* the commit below keeps the old shell if files are missing */ }
        // the server's newest /app (~550 KB) over a phone's link: up to 8 s per fetch, two at most (#951)
        const r = await m.commitShellAndWait({ refresh: true, fetchMs: 8000, timeoutMs: 18000 });
        if (!r || !r.app) console.warn('[update] the restart keeps the previous /app: the new one is not complete in the cache', r);
    }

    window.winlogonUpdates = {
        commitShell: commitShellBeforeLeaving,
        setText: setWinlogonPowerText,
        updater: winlogonUpdater,
        plan: winlogonUpdatePlan,
        hostPower: winlogonHostPower,
        installNarrow: installWaitingUpdatesNarrow
    };
    window.showWinlogonStatus = showWinlogonStatus;
    window.hideWinlogonStatus = hideWinlogonStatus;
})();

/** This computer runs an installed copy of Melaton (its /app is kept): it can start at the logon by itself. */
function winlogonInstalledCopy() {
    try { return !!localStorage.getItem('melatonManifestHash'); } catch (_) { return false; }
}

/**
 * Log off ends on the Welcome screen, as Windows' does: every program is closed (the page goes) and the logon
 * comes back with no POST, no boot screen and no automatic sign-in - the password is asked (cachedLogon.mustSignIn).
 * An installed copy opens its kept /app directly, as DreamOS' native boot does (melatonBoot.js nativeBootHandOff);
 * anything else starts through /launch.
 */
function winlogonLogoffNavigate() {
    if (!winlogonInstalledCopy()) {
        restartClientNavigate();
        return;
    }
    if (typeof melatonNoteRestart === 'function') melatonNoteRestart('logoff');
    try { suppressWebSocketReconnectForReload(); } catch (_) { /* go anyway */ }
    bypassConfirmation = true;
    window.bypassConfirmation = true;
    window.melatonRestarting = true;
    try {
        sessionStorage.setItem('dreamscapeLaunchHandoff', 'teal');
        sessionStorage.setItem('dreamscapeBootTealHoldUntil', String(Date.now()));
        sessionStorage.removeItem('melatonSafeMode');
    } catch (_) { /* the logon just shows */ }
    location.replace('/app');
}

/** Narrow mode has no Welcome screen: the old direct exits. */
function commitWinlogonPower(kind, onCommit, signOut) {
    bypassConfirmation = true;
    // suppressWebSocketReconnectForReload: public/scripts/comp/modalUtils.js
    suppressWebSocketReconnectForReload();
    const after = () => {
        if (kind === 'shutdown') {
            // the DeX desktop as the external screen's home (#1013): its off state (a home cannot close)
            try {
                const ad = window.AndroidDisplay;
                if (ad && typeof ad.desktopOff === 'function' && ad.desktopOff()) return;
            } catch (_) { /* close below */ }
            window.close();
            return;
        }
        if (kind === 'logoff' && !signOut && handleLogout.certificateClient()) {
            // a certificate client's Log off is a lock: no sign-out, back to the logon (connectionManager.js)
            if (window.cachedLogon && typeof window.cachedLogon.markLoggedOff === 'function') window.cachedLogon.markLoggedOff();
            winlogonLogoffNavigate();
            return;
        }
        if (kind === 'logoff') {
            // handleLogout: public/scripts/comp/connectionManager.js
            return handleLogout({ signOut: !!signOut }).then((ok) => {
                if (!ok && signOut) throw new Error('Could not sign out of the Nightshade Network. Connect to it and try again.');
            });
        }
        // Restart on the phone: the app's connection (Melaton Miniport, #815) starts fresh too
        if (kind === 'restart' && window.melatonContinuity && window.melatonContinuity.resetMiniport) {
            try { window.melatonContinuity.resetMiniport(); } catch (_) { /* restart anyway */ }
        }
        // restartClientNavigate: public/scripts/comp/modalUtils.js
        restartClientNavigate();
    };
    if (kind === 'server' && typeof onCommit === 'function') {
        return Promise.resolve(onCommit()).then(after);
    }
    return Promise.resolve().then(after);
}

/**
 * kind: 'restart' | 'shutdown' | 'logoff' | 'server'
 * options.signOut (logoff): the Nightshade client's Sign Out - the same log off, and the server session ends too
 * options.onCommit runs once "Shutting down..." has gone dark (server restart posts PM2
 * from there). Resolves false when the still-running list is cancelled. On the desktop
 * every kind ends on /launch; after a log off its boot lands on the logon page.
 */
async function runWinlogonPower(kind, options) {
    if (winlogonPowerRunning) return false;
    const copy = winlogonPowerCopy(kind);
    const opts = options || {};
    if (!window.isDesktop) {
        // the phone in the app restarting: at once, nothing awaited (serviceWorkerManager.restartPhoneNow, Yukimi Nov 21
        // 2026: never wait on the WebView); a caller's hook still runs, bounded, before the page goes
        const swm = window.serviceWorkerManager;
        if (kind === 'restart' && swm && typeof swm.restartPhoneNow === 'function' && !opts.beforeInstall) {
            if (typeof opts.beforeNavigate === 'function') {
                try { await Promise.race([Promise.resolve().then(opts.beforeNavigate), winlogonDelay(1000)]); } catch (_) { /* restart anyway */ }
            }
            if (swm.restartPhoneNow()) return true;
        }
        if (await winlogonUpdates.installNarrow(kind, opts) === false) return false;
        await winlogonUpdates.commitShell(kind);
        // the hook runs here too (Yukimi, Nov 21: Install "does not do anything"): a DeX window in app mode takes this
        // path, and its Continuity answer ('done', melatonContinuity dex-shutdown) was never sent - the phone waited
        // out its 60 s for it with its install window up
        if (typeof opts.beforeNavigate === 'function') {
            try { await Promise.race([Promise.resolve().then(opts.beforeNavigate), winlogonDelay(3000)]); } catch (_) { /* restart anyway */ }
        }
        await commitWinlogonPower(kind, opts.onCommit, opts.signOut);
        return true;
    }
    winlogonPowerRunning = true;
    const updater = winlogonUpdates.updater(kind);
    try {
        const blockers = collectLogoffBlockers();
        if (blockers.length) {
            const accepted = await askWinlogonBlock(kind, collectWinlogonPrograms(blockers));
            if (!accepted) {
                winlogonPowerRunning = false;
                return false;
            }
        }
        if (updater) updater.forgetShutdownPlan();
        // what this shutdown installs is worked out while the desktop fades (#924)
        const planning = updater ? Promise.resolve().then(() => updater.planShutdownInstall()).catch(() => null) : null;
        const updatesWaiting = !!(updater && updater.updatesWaitingCount() > 0);
        // desktopSounds.play: public/scripts/comp/desktopSounds.js
        desktopSounds.play(copy.sound);
        // dismissTransientUIForShutdown: public/scripts/comp/modalUtils.js
        dismissTransientUIForShutdown();
        await fadeShutdownCover(true);
        await winlogonDelay(WINLOGON_BLACK_HOLD_MS);
        // with updates to install Vista logs off first, installs, then shuts down
        showWinlogonPowerScreen(updatesWaiting ? WINLOGON_POWER_COPY.logoff.screen : copy.screen);
        await fadeShutdownCover(false);
        const plan = await winlogonUpdates.plan(updater, planning);
        if (plan) {
            // "Installing update n of N...", then copy.screen and the configuring stages (the last one
            // stays up for the hold below, then the screen goes dark)
            await updater.installUpdatesAtShutdown(plan, { kind, screenText: copy.screen, onStatus: winlogonUpdates.setText });
        } else if (updatesWaiting) {
            winlogonUpdates.setText(copy.screen);
        }
        await winlogonDelay(WINLOGON_TEXT_HOLD_MS);
        const work = startWinlogonPowerWork(kind, opts.onCommit, opts.signOut);
        await lingerWinlogonPowerBlack(work, cutShutdownCover(),
            kind === 'server' ? Infinity : WINLOGON_POWER_BLACK_MAX_MS);
        if (kind === 'shutdown' || kind === 'logoff') forgetDirectorReopen();
        // a hook once this computer has shut down (Continuity, Yukimi Nov 18 2026: the DeX window shuts down first,
        // then the phone restarts and both start together): awaited, at most 3 s
        // the kept shell switches with the files just installed before the restart (#951)
        await winlogonUpdates.commitShell(kind);
        if (typeof opts.beforeNavigate === 'function') {
            try { await Promise.race([Promise.resolve().then(opts.beforeNavigate), winlogonDelay(3000)]); } catch (_) { /* restart anyway */ }
        }
        // A machine whose power is the page's to switch (DreamOS, #910/#924): its host turns the
        // computer off or restarts it here, after the updates are installed and the screen is dark.
        // No host, or one that declines (returns false): the page restarts into /launch as before.
        if (winlogonUpdates.hostPower(kind)) return true;
        if (kind === 'logoff') {
            winlogonLogoffNavigate();
            return true;
        }
        // restartClientNavigate: public/scripts/comp/modalUtils.js (desktop: /launch)
        restartClientNavigate();
        return true;
    } catch (error) {
        if (updater) updater.forgetShutdownPlan();
        hideWinlogonPowerScreen();
        winlogonPowerRunning = false;
        throw error;
    }
}

window.runWinlogonPower = runWinlogonPower;
window.collectLogoffBlockers = collectLogoffBlockers;
window.hideWinlogonPowerScreen = hideWinlogonPowerScreen;
window.WINLOGON_FADE_OUT_MS = WINLOGON_FADE_OUT_MS;
window.WINLOGON_FADE_IN_MS = WINLOGON_FADE_IN_MS;
