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
    dreamscapeOsInstallWizardModal: 1,
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

function winlogonBlockerFromModal(modal) {
    return {
        name: winlogonBlockerName(modal),
        icon: winlogonBlockerIcon(modal)
    };
}

/** Studio open, or a Notepad with unsaved changes. Those gate logoff. */
function collectLogoffBlockers() {
    const items = [];
    const seen = new Set();
    const add = (modal) => {
        if (!winlogonModalOpen(modal) || seen.has(modal)) return;
        if (modal.id && LOGOFF_SKIP_IDS[modal.id]) return;
        seen.add(modal);
        items.push(winlogonBlockerFromModal(modal));
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

function ensureWinlogonBlock() {
    let root = document.getElementById('winlogonBlock');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'winlogonBlock';
    root.className = 'winlogon-block';
    root.hidden = true;
    root.innerHTML = '<div class="winlogon-block-title" id="winlogonBlockTitle"></div>'
        + '<div class="winlogon-block-rule"></div>'
        + '<div class="winlogon-block-list" id="winlogonBlockList"></div>'
        + '<div class="winlogon-block-footer" id="winlogonBlockFooter"></div>'
        + '<div class="winlogon-block-actions">'
        + '<button type="button" class="winlogon-block-go" id="winlogonBlockGo"></button>'
        + '<button type="button" class="winlogon-block-cancel" id="winlogonBlockCancel">Cancel</button>'
        + '</div>';
    document.body.appendChild(root);
    return root;
}

function fillWinlogonBlock(kind, items) {
    const copy = winlogonPowerCopy(kind);
    const root = ensureWinlogonBlock();
    const title = document.getElementById('winlogonBlockTitle');
    const list = document.getElementById('winlogonBlockList');
    const footer = document.getElementById('winlogonBlockFooter');
    const go = document.getElementById('winlogonBlockGo');
    title.textContent = 'The following programs are still running:';
    footer.textContent = copy.footer;
    go.textContent = '';
    const label = document.createElement('span');
    const accel = copy.accel;
    const action = copy.action;
    if (accel && action.charAt(0).toUpperCase() === accel) {
        const mark = document.createElement('u');
        mark.textContent = action.charAt(0);
        label.appendChild(mark);
        label.appendChild(document.createTextNode(action.slice(1)));
    } else {
        label.textContent = action;
    }
    go.appendChild(label);
    go.accessKey = accel ? accel.toLowerCase() : '';
    list.textContent = '';
    items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'winlogon-block-row';
        const icon = document.createElement('span');
        icon.className = 'winlogon-block-icon';
        if (item.icon) icon.appendChild(item.icon);
        const text = document.createElement('span');
        text.className = 'winlogon-block-text';
        const name = document.createElement('span');
        name.className = 'winlogon-block-name';
        name.textContent = item.name;
        const reason = document.createElement('span');
        reason.className = 'winlogon-block-reason';
        reason.textContent = copy.reason;
        text.appendChild(name);
        text.appendChild(reason);
        row.appendChild(icon);
        row.appendChild(text);
        list.appendChild(row);
    });
    return root;
}

function askWinlogonBlock(kind, items) {
    const root = fillWinlogonBlock(kind, items);
    const go = document.getElementById('winlogonBlockGo');
    const cancel = document.getElementById('winlogonBlockCancel');
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
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            } else if (event.key === 'Enter') {
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
            // handleLogout: public/scripts/app.js
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
 * options.onCommit runs once "Shutting down..." is on the Welcome screen (server restart
 * posts PM2 from there). Resolves false when the still-running list is cancelled.
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
            const accepted = await askWinlogonBlock(kind, blockers);
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
        await commitWinlogonPower(kind, opts.onCommit);
        if (kind === 'shutdown' || kind === 'logoff') winlogonPowerRunning = false;
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
