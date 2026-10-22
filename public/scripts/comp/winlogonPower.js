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
// Then every path goes dark, like the monitor losing its signal, before /launch POSTs
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
    document.body.classList.add('winlogon-power');
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
        if (window.wsClient && window.wsClient.initializationCompleted) {
            modal.classList.add('hidden');
        }
    }
    if (window.wsClient) window.wsClient.winlogonPowerText = '';
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
function startWinlogonPowerWork(kind, onCommit) {
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
        // handleLogout: public/scripts/comp/connectionManager.js (stays put; /launch is next)
        jobs.push(Promise.resolve().then(() => handleLogout({ redirect: false })).then((ok) => {
            if (!ok) throw new Error('Could not log off. You are still signed in.');
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

/** Narrow mode has no Welcome screen: the old direct exits. */
function commitWinlogonPower(kind, onCommit) {
    bypassConfirmation = true;
    // suppressWebSocketReconnectForReload: public/scripts/comp/modalUtils.js
    suppressWebSocketReconnectForReload();
    const after = () => {
        if (kind === 'shutdown') {
            window.close();
            return;
        }
        if (kind === 'logoff') {
            // handleLogout: public/scripts/comp/connectionManager.js
            handleLogout();
            return;
        }
        // restartClientNavigate: public/scripts/comp/modalUtils.js
        restartClientNavigate();
    };
    if (kind === 'server' && typeof onCommit === 'function') {
        return Promise.resolve(onCommit()).then(after);
    }
    after();
    return Promise.resolve();
}

/**
 * kind: 'restart' | 'shutdown' | 'logoff' | 'server'
 * options.onCommit runs once "Shutting down..." has gone dark (server restart posts PM2
 * from there). Resolves false when the still-running list is cancelled. On the desktop
 * every kind ends on /launch; after a log off its boot lands on the logon page.
 */
async function runWinlogonPower(kind, options) {
    if (winlogonPowerRunning) return false;
    const copy = winlogonPowerCopy(kind);
    const opts = options || {};
    if (!window.isDesktop) {
        await commitWinlogonPower(kind, opts.onCommit);
        return true;
    }
    winlogonPowerRunning = true;
    try {
        const blockers = collectLogoffBlockers();
        if (blockers.length) {
            const accepted = await askWinlogonBlock(kind, collectWinlogonPrograms(blockers));
            if (!accepted) {
                winlogonPowerRunning = false;
                return false;
            }
        }
        // desktopSounds.play: public/scripts/comp/desktopSounds.js
        desktopSounds.play(copy.sound);
        // dismissTransientUIForShutdown: public/scripts/comp/modalUtils.js
        dismissTransientUIForShutdown();
        await fadeShutdownCover(true);
        await winlogonDelay(WINLOGON_BLACK_HOLD_MS);
        showWinlogonPowerScreen(copy.screen);
        await fadeShutdownCover(false);
        await winlogonDelay(WINLOGON_TEXT_HOLD_MS);
        const work = startWinlogonPowerWork(kind, opts.onCommit);
        await lingerWinlogonPowerBlack(work, fadeShutdownCover(true),
            kind === 'server' ? Infinity : WINLOGON_POWER_BLACK_MAX_MS);
        if (kind === 'shutdown' || kind === 'logoff') forgetDirectorReopen();
        // restartClientNavigate: public/scripts/comp/modalUtils.js (desktop: /launch)
        restartClientNavigate();
        return true;
    } catch (error) {
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
