// MeletonFX remote desktop.
// List window reads Komaki's Guacamole catalog through /api/desktop-guac/connections.
// Choosing a row opens a separate modal with Komaki's native Guacamole client in an
// iframe; Maximize on the list opens Guacamole's home. Both frames are served
// same-origin at /api/desktop-guac/web/ (modules/guacRemoteBridge.js), so the window
// title and taskbar follow the frame's document title and #/client route.
// Guacamole's status boxes come out through mirrorDesktopGuacFrame
// (sent by guacFrameMirror.js inside the frame).
// Not the Grimoire browser.
// openModal / bringModalToFront / restoreMinimizedModal / closeModal: public/scripts/comp/modalUtils.js

const DESKTOP_GUAC_LIST_ID = 'desktopGuacModal';

const DESKTOP_GUAC_HOME_KEY = 'home';
const DESKTOP_GUAC_APP_FA_ICON = 'fas fa-satellite-dish';

const guacSessionModals = new Map();
// Connection id -> { id, name, protocol } from the last list load
const guacCatalog = new Map();
const GUAC_PROTOCOL_ICONS = {
    ssh: 'fas fa-terminal',
    telnet: 'fas fa-terminal',
    vnc: 'fas fa-display',
    rdp: 'fab fa-windows',
    kubernetes: 'fas fa-dharmachakra'
};
const DESKTOP_GUAC_CONNECTING_STATES = new Set(['IDLE', 'CONNECTING', 'WAITING']);
// { frame, kind, id, payload, open, answered, labels } for the mirrored status in the confirmation dialog
let desktopGuacDialog = null;
let desktopGuacDialogClosing = null;

function openDesktopGuac() {
    const modal = ensureDesktopGuacListModal();
    showDesktopGuacModal(modal);
    refreshDesktopGuacList();
}

function showDesktopGuacModal(modal) {
    if (modal.classList.contains('minimised')) {
        // restoreMinimizedModal: public/scripts/comp/modalUtils.js
        restoreMinimizedModal(modal);
    }
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) {
        // openModal: public/scripts/comp/modalUtils.js
        openModal(modal);
    }
    // bringModalToFront: public/scripts/comp/modalUtils.js
    bringModalToFront(modal);
}

function desktopGuacTitle(text, iconClass) {
    const title = document.createElement('div');
    title.className = 'modal-window-title';
    const titleMain = document.createElement('div');
    titleMain.className = 'modal-window-title-main';
    const titleIcon = document.createElement('i');
    titleIcon.className = iconClass;
    titleIcon.setAttribute('aria-hidden', 'true');
    const titleText = document.createElement('span');
    titleText.textContent = text;
    titleMain.appendChild(titleIcon);
    titleMain.appendChild(titleText);
    title.appendChild(titleMain);
    return title;
}

// The taskbar copies the title bar's span and icon: modalUtils.js updateTaskbarWindows
function setDesktopGuacTitle(modal, text, iconClass) {
    const titleText = modal.querySelector('.modal-window-title-main span');
    const titleIcon = modal.querySelector('.modal-window-title-main i');
    if (titleText.textContent === text && titleIcon.className === iconClass) return;
    titleText.textContent = text;
    titleIcon.className = iconClass;
    // debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js
    debouncedUpdateTaskbarWindows();
}

function desktopGuacControls(modal, onClose, onMaximize) {
    const controls = document.createElement('div');
    controls.className = 'modal-window-controls';
    const minimizeBtn = document.createElement('button');
    minimizeBtn.type = 'button';
    minimizeBtn.className = 'btn-secondary minimize-btn btn-small';
    minimizeBtn.title = 'Minimize';
    const minimizeIcon = document.createElement('i');
    minimizeIcon.className = 'fa-regular fa-window-minimize';
    minimizeIcon.setAttribute('aria-hidden', 'true');
    minimizeBtn.appendChild(minimizeIcon);
    const maximizeBtn = document.createElement('button');
    maximizeBtn.type = 'button';
    // modal-work-area-maximize is the shared maximize handler; the list window
    // opens Guacamole's home instead.
    maximizeBtn.className = onMaximize ? 'btn-secondary btn-small' : 'btn-secondary btn-small modal-work-area-maximize';
    maximizeBtn.title = onMaximize ? 'Open Guacamole home' : 'Maximize';
    if (onMaximize) maximizeBtn.addEventListener('click', onMaximize);
    const maximizeIcon = document.createElement('i');
    maximizeIcon.className = 'fa-regular fa-window-maximize';
    maximizeIcon.setAttribute('aria-hidden', 'true');
    maximizeBtn.appendChild(maximizeIcon);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-danger close-btn btn-small';
    closeBtn.title = 'Close';
    const closeIcon = document.createElement('i');
    closeIcon.className = 'fa-regular fa-xmark-large';
    closeIcon.setAttribute('aria-hidden', 'true');
    closeBtn.appendChild(closeIcon);
    closeBtn.addEventListener('click', () => {
        // closeModal: public/scripts/comp/modalUtils.js
        const closing = closeModal(modal);
        if (onClose) closing.then(onClose);
    });
    controls.appendChild(minimizeBtn);
    controls.appendChild(maximizeBtn);
    controls.appendChild(closeBtn);
    return controls;
}

function ensureDesktopGuacListModal() {
    let modal = document.getElementById(DESKTOP_GUAC_LIST_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = DESKTOP_GUAC_LIST_ID;
    modal.className = 'modal resizeable-window hidden';
    modal.dataset.windowIdentifier = 'desktopGuac';
    modal.dataset.windowDefaultWidth = '420';
    modal.dataset.windowDefaultHeight = '520';
    modal.dataset.windowMinWidth = '320';
    modal.dataset.windowMinHeight = '280';
    modal.dataset.windowMaxWidth = '640';
    modal.dataset.windowMaxHeight = '900';
    modal.style.flexDirection = 'column';

    const content = document.createElement('div');
    content.className = 'modal-content modal-padding dark';
    content.style.flex = '1 1 auto';
    content.style.height = 'auto';
    content.style.minHeight = '0';
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.flex = '1 1 auto';
    body.style.minHeight = '0';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';

    const status = document.createElement('p');
    status.id = 'desktopGuacStatus';
    status.className = 'form-hint';
    status.style.flex = '0 0 auto';
    status.textContent = 'Loading connections…';

    const list = document.createElement('div');
    list.id = 'desktopGuacList';
    list.className = 'scrollable-content form-col';
    list.style.flex = '1 1 auto';
    list.style.minHeight = '0';
    list.style.overflow = 'auto';

    body.appendChild(status);
    body.appendChild(list);
    content.appendChild(body);
    modal.appendChild(desktopGuacTitle('Remote Desktop', DESKTOP_GUAC_APP_FA_ICON));
    modal.appendChild(document.createElement('div')).className = 'modal-focus-overlay';
    modal.appendChild(desktopGuacControls(modal, null, () => {
        openDesktopGuacHome();
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    }));
    modal.appendChild(content);
    document.body.appendChild(modal);
    return modal;
}

async function refreshDesktopGuacList() {
    const status = document.getElementById('desktopGuacStatus');
    const list = document.getElementById('desktopGuacList');
    if (!status || !list) return;
    status.hidden = false;
    status.textContent = 'Loading connections…';
    list.replaceChildren();
    let response;
    try {
        response = await fetch('/api/desktop-guac/connections', { credentials: 'same-origin' });
    } catch (_) {
        status.textContent = 'Could not reach Dreamscape for the Komaki connection list.';
        return;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true) {
        status.textContent = (payload && payload.ok === false && payload.error)
            ? payload.error
            : 'Komaki connection list is unavailable.';
        return;
    }
    const connections = Array.isArray(payload.connections) ? payload.connections : [];
    if (!connections.length) {
        status.textContent = 'Komaki returned no connections.';
        return;
    }
    status.hidden = true;
    guacCatalog.clear();
    connections.forEach((conn) => {
        if (!conn || !conn.id) return;
        guacCatalog.set(String(conn.id), conn);
        const row = document.createElement('div');
        row.className = 'form-row';
        const group = document.createElement('div');
        group.className = 'form-group';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-secondary';
        button.style.width = '100%';
        button.textContent = conn.name || conn.id;
        if (conn.protocol) button.title = conn.protocol;
        button.addEventListener('click', () => {
            openDesktopGuacSession(conn);
        });
        group.appendChild(button);
        row.appendChild(group);
        list.appendChild(row);
    });
}

function openDesktopGuacSession(conn) {
    const id = String(conn && conn.id || '');
    if (!id) return;
    openDesktopGuacFrame({
        key: id,
        // Taskbar and active-window tracking key off modal.id: modalUtils.js shouldShowInTaskbar
        modalId: 'desktopGuacSession_' + id.replace(/[^A-Za-z0-9_-]/g, '_'),
        windowIdentifier: 'desktopGuacSession',
        title: conn.name || id,
        iconClass: GUAC_PROTOCOL_ICONS[conn.protocol] || 'fas fa-desktop',
        endpoint: '/api/desktop-guac/session/' + encodeURIComponent(id)
    });
}

function openDesktopGuacHome() {
    openDesktopGuacFrame({
        key: DESKTOP_GUAC_HOME_KEY,
        modalId: 'desktopGuacHome',
        windowIdentifier: 'desktopGuacHome',
        title: 'Remote Desktop',
        iconClass: DESKTOP_GUAC_APP_FA_ICON,
        endpoint: '/api/desktop-guac/home'
    });
}

// #/client/<base64url(id \0 type \0 dataSource)> (Komaki's ClientIdentifier)
function desktopGuacRouteConnection(hash) {
    const match = /^#\/client\/([^/?]+)/.exec(hash || '');
    if (!match) return null;
    try {
        const id = atob(match[1].replace(/-/g, '+').replace(/_/g, '/')).split('\0')[0];
        return guacCatalog.get(id) || { id: id, name: '', protocol: '' };
    } catch (_) {
        return null;
    }
}

// The frame is same-origin, so its <title> and hash route drive the window title and icon.
function trackDesktopGuacFrame(modal, frame, fallbackTitle) {
    const frameWindow = frame.contentWindow;
    const frameDocument = frame.contentDocument;
    if (!frameWindow || !frameDocument || !frameDocument.head) return;
    const sync = () => {
        const conn = desktopGuacRouteConnection(frameWindow.location.hash);
        const text = frameDocument.title || (conn && conn.name) || fallbackTitle;
        if (conn) setDesktopGuacTitle(modal, text, GUAC_PROTOCOL_ICONS[conn.protocol] || 'fas fa-desktop');
        else setDesktopGuacTitle(modal, text, DESKTOP_GUAC_APP_FA_ICON);
    };
    new MutationObserver(sync).observe(frameDocument.head, { childList: true, subtree: true, characterData: true });
    frameWindow.addEventListener('hashchange', sync);
    sync();
}

function desktopGuacDialogOwned(frame) {
    return !!desktopGuacDialog && !desktopGuacDialog.answered && desktopGuacDialog.frame === frame
        // isConfirmationDialogActive: public/scripts/comp/confirmationDialog.js
        && isConfirmationDialogActive() && !!document.getElementById('desktopGuacDialogText');
}

// kind: client (session status), global (Guacamole notifications), page (logged out / fatal pages).
// payload.id is null when Guacamole cleared that status.
function mirrorDesktopGuacFrame(frame, kind, payload) {
    const modal = frame.closest('.modal');
    if (!modal) return;
    if (kind === 'client') {
        const hint = modal.querySelector('.modal-body > .form-hint');
        const connecting = DESKTOP_GUAC_CONNECTING_STATES.has(payload.state);
        hint.hidden = !connecting;
        hint.textContent = (connecting && payload.className === 'connecting' && payload.text) || 'Connecting…';
    }
    const entry = desktopGuacDialog && desktopGuacDialog.frame === frame && desktopGuacDialog.kind === kind ? desktopGuacDialog : null;
    if (!payload.id || payload.className === 'connecting') {
        if (entry && !entry.open) desktopGuacDialog = null;
        else if (entry && desktopGuacDialogOwned(frame)) hideDesktopGuacDialog();
        return;
    }
    if (entry && entry.id === payload.id) {
        entry.payload = payload;
        if (!entry.open || !desktopGuacDialogOwned(frame)) return;
        // Page buttons are translated after their first read
        if (entry.labels !== payload.actions.map((action) => action.label).join('\n')) {
            openDesktopGuacDialog(modal, entry);
            return;
        }
        document.getElementById('desktopGuacDialogText').textContent = payload.text;
        const countdown = document.getElementById('desktopGuacDialogCountdown');
        if (countdown) countdown.textContent = payload.countdown;
        return;
    }
    const next = { frame: frame, kind: kind, id: payload.id, payload: payload, open: false, answered: false, labels: '' };
    desktopGuacDialog = next;
    // Opening while our hide is still closing the shared dialog would be undone by that hide
    Promise.resolve(desktopGuacDialogClosing).then(() => {
        if (desktopGuacDialog === next) openDesktopGuacDialog(modal, next);
    });
}

function hideDesktopGuacDialog() {
    // hideConfirmationDialog: public/scripts/comp/confirmationDialog.js
    desktopGuacDialogClosing = hideConfirmationDialog();
}

// Session errors offer Reconnect + Close window (Guacamole's Logout would revoke the
// token every remote window shares); other statuses keep Guacamole's own buttons.
function openDesktopGuacDialog(modal, entry) {
    const kind = entry.kind;
    const payload = entry.payload;
    entry.open = true;
    entry.labels = payload.actions.map((action) => action.label).join('\n');
    const reconnect = kind === 'client' ? payload.actions.find((action) => /\breconnect\b/.test(action.className)) : null;
    const options = kind === 'client'
        ? [
            ...(reconnect ? [{ text: 'Reconnect', value: 'reconnect', className: 'btn-standard primary' }] : []),
            { text: 'Close window', value: 'close', className: 'btn-standard' }
        ]
        : payload.actions.map((action, index) => ({ text: action.label, value: index, className: index ? 'btn-standard' : 'btn-standard primary' }));
    const windowTitle = modal.querySelector('.modal-window-title-main span').textContent;
    // escapeHtml: public/scripts/comp/utilities.js
    let message = '<p id="desktopGuacDialogText">' + escapeHtml(payload.text) + '</p>';
    if (payload.countdown) message += '<p id="desktopGuacDialogCountdown" class="form-hint">' + escapeHtml(payload.countdown) + '</p>';
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    showConfirmationDialog(message, options, null, {
        title: payload.title ? windowTitle + ' — ' + payload.title : windowTitle,
        icon: payload.className === 'error' ? 'fas fa-triangle-exclamation' : DESKTOP_GUAC_APP_FA_ICON
    }).then((value) => {
        entry.answered = true;
        if (value === 'close') modal.querySelector('.modal-window-controls .close-btn').click();
        else if (value === 'reconnect') reconnect.run();
        else if (Number.isInteger(value)) payload.actions[value].run();
        else if (payload.dismiss) payload.dismiss();
    });
}

function openDesktopGuacFrame(opts) {
    const existing = guacSessionModals.get(opts.key);
    if (existing) {
        showDesktopGuacModal(existing);
        return;
    }
    const modal = document.createElement('div');
    modal.id = opts.modalId;
    modal.className = 'modal resizeable-window hidden';
    modal.dataset.windowIdentifier = opts.windowIdentifier;
    modal.dataset.windowDefaultWidth = '1024';
    modal.dataset.windowDefaultHeight = '640';
    modal.dataset.windowMinWidth = '480';
    modal.dataset.windowMinHeight = '320';
    modal.dataset.windowMaxWidth = '1600';
    modal.dataset.windowMaxHeight = '1000';
    modal.style.flexDirection = 'column';

    const content = document.createElement('div');
    content.className = 'modal-content dark';
    content.style.flex = '1 1 auto';
    content.style.height = 'auto';
    content.style.minHeight = '0';
    content.style.padding = '0';
    content.style.overflow = 'hidden';
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.flex = '1 1 auto';
    body.style.minHeight = '0';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.padding = '0';

    // Placement and [hidden]: public/css/desktop-apps/desktopAppWindows.css
    const status = document.createElement('p');
    status.className = 'form-hint';
    status.textContent = 'Connecting…';
    body.appendChild(status);
    content.appendChild(body);

    guacSessionModals.set(opts.key, modal);
    modal.appendChild(desktopGuacTitle(opts.title, opts.iconClass));
    modal.appendChild(document.createElement('div')).className = 'modal-focus-overlay';
    modal.appendChild(desktopGuacControls(modal, () => {
        guacSessionModals.delete(opts.key);
        const frame = modal.querySelector('iframe');
        if (frame && desktopGuacDialogOwned(frame)) hideDesktopGuacDialog();
        if (desktopGuacDialog && desktopGuacDialog.frame === frame) desktopGuacDialog = null;
        modal.remove();
    }));
    modal.appendChild(content);
    document.body.appendChild(modal);
    showDesktopGuacModal(modal);

    fetch(opts.endpoint, { credentials: 'same-origin' })
        .then((response) => response.json().catch(() => null).then((payload) => {
            if (guacSessionModals.get(opts.key) !== modal) return;
            if (!response.ok || !payload || !payload.url) {
                status.textContent = (payload && payload.error) || 'Komaki session is unavailable.';
                return;
            }
            const frame = document.createElement('iframe');
            frame.title = opts.title;
            frame.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
            frame.style.flex = '1 1 auto';
            frame.style.minHeight = '0';
            frame.style.width = '100%';
            frame.style.border = '0';
            // Activation clicks land on the parent page (overlay, title bar, taskbar),
            // so keys stay in Dreamscape until the frame is focused again.
            const focusFrame = () => {
                if (modal.classList.contains('active-window')) frame.focus();
            };
            // Stays up on a client route until mirrorDesktopGuacFrame reports the session connected
            frame.addEventListener('load', () => {
                status.hidden = !desktopGuacRouteConnection(frame.contentWindow.location.hash);
                trackDesktopGuacFrame(modal, frame, opts.title);
                focusFrame();
            });
            new MutationObserver(focusFrame).observe(modal, { attributes: true, attributeFilter: ['class'] });
            modal.addEventListener('pointerup', (event) => {
                if (!event.target.closest('.modal-window-controls')) focusFrame();
            });
            // Visibility: public/css/desktop-apps/desktopAppWindows.css (:focus-within)
            const badge = document.createElement('span');
            badge.className = 'desktop-guac-capture-badge';
            badge.innerHTML = '<i class="fas fa-keyboard" aria-hidden="true"></i>';
            frame.src = payload.url;
            body.appendChild(frame);
            body.appendChild(badge);
        }))
        .catch(() => {
            status.textContent = 'Could not reach Dreamscape for the Komaki session.';
        });
}
