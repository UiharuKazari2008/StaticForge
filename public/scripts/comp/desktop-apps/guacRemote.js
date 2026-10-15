// MeletonFX remote desktop.
// List window reads Komaki's Guacamole catalog through /api/desktop-guac/connections
// (connection groups, last-frame previews from .cache/guac-previews).
// Choosing a row opens a separate modal with Komaki's native Guacamole client in an
// iframe. Full view on the list toolbar opens Guacamole's home. Maximize on a session
// covers the desktop (caption and taskbar) and leaves the floating connection bar.
// Both frames are served same-origin at /api/desktop-guac/web/ (modules/guacRemoteBridge.js),
// so the window title and taskbar follow the frame's document title and #/client route.
// Guacamole's status boxes come out through mirrorDesktopGuacFrame
// (sent by guacFrameMirror.js inside the frame). The session toolbar calls dreamscapeGuac.
// Not the Grimoire browser.
// openModal / bringModalToFront / restoreMinimizedModal / closeModal: public/scripts/comp/modalUtils.js

const DESKTOP_GUAC_LIST_ID = 'desktopGuacModal';

const DESKTOP_GUAC_HOME_KEY = 'home';
const DESKTOP_GUAC_APP_FA_ICON = 'fas fa-satellite-dish';
const DESKTOP_GUAC_APP_IMAGE = 'vista-remote-desktop.png';

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
const GUAC_DEFAULT_PORTS = { rdp: '3389', vnc: '5900', ssh: '22', telnet: '23', kubernetes: '443' };
const GUAC_DOWNLOAD_TARGET_KEY = 'desktopGuacDownloadTarget';
let guacGroups = [];
let guacGroupOptions = [];
let guacSearchIndex = -1;
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
    titleIcon.className = iconClass + ' icon-fa';
    titleIcon.setAttribute('aria-hidden', 'true');
    const titleImage = document.createElement('img');
    titleImage.className = 'icon-image';
    titleImage.alt = '';
    // resolveAppIconPath / buildAppIconSrcset: public/scripts/comp/modalUtils.js
    titleImage.src = resolveAppIconPath(DESKTOP_GUAC_APP_IMAGE);
    const srcset = buildAppIconSrcset(DESKTOP_GUAC_APP_IMAGE);
    if (srcset) {
        titleImage.setAttribute('srcset', srcset);
        titleImage.setAttribute('sizes', '32px');
    }
    const titleText = document.createElement('span');
    titleText.textContent = text;
    titleMain.appendChild(titleIcon);
    titleMain.appendChild(titleImage);
    titleMain.appendChild(titleText);
    title.appendChild(titleMain);
    return title;
}

// The taskbar copies the title bar's span and icon: modalUtils.js updateTaskbarWindows
function setDesktopGuacTitle(modal, text, iconClass) {
    const titleText = modal.querySelector('.modal-window-title-main span');
    const titleIcon = modal.querySelector('.modal-window-title-main i');
    const nextIcon = iconClass + ' icon-fa';
    if (titleText.textContent === text && titleIcon.className === nextIcon) return;
    titleText.textContent = text;
    titleIcon.className = nextIcon;
    const pinName = modal.querySelector('.desktop-guac-pin-name');
    if (pinName) pinName.textContent = text;
    // debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js
    debouncedUpdateTaskbarWindows();
}

function toggleDesktopGuacCover(modal) {
    if (!modal) return;
    const covered = modal.classList.contains('desktop-guac-cover');
    if (covered) {
        modal.classList.remove('desktop-guac-cover');
        const layout = modal._guacCoverLayout;
        delete modal._guacCoverLayout;
        // setModalPositionFromViewportRect: public/scripts/comp/modalUtils.js
        if (layout) setModalPositionFromViewportRect(modal, layout);
    } else {
        // finishModalRectMorph / captureModalLayoutState: public/scripts/comp/modalUtils.js
        finishModalRectMorph(modal);
        modal._guacCoverLayout = captureModalLayoutState(modal);
        modal.classList.add('desktop-guac-cover');
    }
    const icon = modal.querySelector('.modal-window-controls .modal-work-area-maximize i');
    const btn = modal.querySelector('.modal-window-controls .modal-work-area-maximize');
    const now = modal.classList.contains('desktop-guac-cover');
    if (icon) icon.className = now ? 'fa-regular fa-window-restore' : 'fa-regular fa-window-maximize';
    if (btn) btn.title = now ? 'Restore' : 'Maximize';
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
    const cover = onMaximize === 'cover';
    maximizeBtn.className = (cover || !onMaximize)
        ? 'btn-secondary btn-small modal-work-area-maximize'
        : 'btn-secondary btn-small';
    maximizeBtn.title = 'Maximize';
    if (cover) {
        maximizeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            toggleDesktopGuacCover(modal);
        }, true);
    } else if (onMaximize) {
        maximizeBtn.addEventListener('click', onMaximize);
    }
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
    modal.dataset.windowDefaultWidth = '760';
    modal.dataset.windowDefaultHeight = '640';
    modal.dataset.windowMinWidth = '420';
    modal.dataset.windowMinHeight = '360';
    modal.dataset.windowMaxWidth = '1800';
    modal.dataset.windowMaxHeight = '900';
    modal.style.flexDirection = 'column';

    const content = document.createElement('div');
    content.className = 'modal-content dark';
    content.style.flex = '1 1 auto';
    content.style.height = 'auto';
    content.style.minHeight = '0';
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.flex = '1 1 auto';
    body.style.minHeight = '0';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';

    const toolbar = document.createElement('div');
    toolbar.className = 'desktop-guac-toolbar';
    const searchWrap = document.createElement('div');
    searchWrap.className = 'desktop-guac-search';
    const search = document.createElement('input');
    search.type = 'text';
    search.id = 'desktopGuacSearch';
    search.className = 'explorer-search-bar';
    search.placeholder = 'Search';
    search.autocomplete = 'off';
    search.setAttribute('aria-label', 'Search connections');
    const searchMenu = document.createElement('div');
    searchMenu.id = 'desktopGuacSearchMenu';
    searchMenu.className = 'desktop-guac-search-menu';
    searchMenu.hidden = true;
    searchWrap.appendChild(search);
    searchWrap.appendChild(searchMenu);
    search.addEventListener('input', () => renderDesktopGuacSearch(search.value));
    search.addEventListener('keydown', desktopGuacSearchKey);
    search.addEventListener('focus', () => renderDesktopGuacSearch(search.value));
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'desktop-guac-bar-btn';
    addBtn.textContent = 'Add connection';
    addBtn.addEventListener('click', () => toggleDesktopGuacAddForm());
    const fullBtn = document.createElement('button');
    fullBtn.type = 'button';
    fullBtn.className = 'desktop-guac-bar-btn';
    fullBtn.textContent = 'Full view';
    fullBtn.title = 'Open Guacamole home';
    fullBtn.addEventListener('click', () => openDesktopGuacHome());
    toolbar.appendChild(addBtn);
    toolbar.appendChild(fullBtn);
    toolbar.appendChild(searchWrap);

    const addForm = document.createElement('form');
    addForm.id = 'desktopGuacAdd';
    addForm.className = 'desktop-guac-add';
    addForm.hidden = true;
    addForm.appendChild(desktopGuacAddField('Name', 'desktopGuacAddName', 'text'));
    addForm.appendChild(desktopGuacProtocolField());
    addForm.appendChild(desktopGuacGroupField());
    addForm.appendChild(desktopGuacAddField('Host', 'desktopGuacAddHost', 'text'));
    addForm.appendChild(desktopGuacAddField('Port', 'desktopGuacAddPort', 'text'));
    addForm.appendChild(desktopGuacAddField('Username', 'desktopGuacAddUser', 'text'));
    addForm.appendChild(desktopGuacAddField('Password', 'desktopGuacAddPass', 'password'));
    const addActions = document.createElement('div');
    addActions.className = 'desktop-guac-add-actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'btn-primary btn-small';
    saveBtn.textContent = 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary btn-small';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { addForm.hidden = true; });
    addActions.appendChild(saveBtn);
    addActions.appendChild(cancelBtn);
    addForm.appendChild(addActions);
    const addStatus = document.createElement('p');
    addStatus.id = 'desktopGuacAddStatus';
    addStatus.className = 'form-hint';
    addStatus.hidden = true;
    addForm.appendChild(addStatus);
    addForm.addEventListener('submit', (event) => {
        event.preventDefault();
        submitDesktopGuacConnection();
    });

    const status = document.createElement('p');
    status.id = 'desktopGuacStatus';
    status.className = 'form-hint';
    status.style.flex = '0 0 auto';
    status.textContent = 'Loading connections...';

    const list = document.createElement('div');
    list.id = 'desktopGuacList';
    list.className = 'desktop-guac-list scrollable-content';

    content.appendChild(toolbar);
    body.appendChild(addForm);
    body.appendChild(status);
    body.appendChild(list);
    content.appendChild(body);
    modal.appendChild(desktopGuacTitle('Remote Desktop', DESKTOP_GUAC_APP_FA_ICON));
    modal.appendChild(document.createElement('div')).className = 'modal-focus-overlay';
    modal.appendChild(desktopGuacControls(modal, null, null));
    modal.appendChild(content);
    document.body.appendChild(modal);
    return modal;
}

function desktopGuacAddField(labelText, id, type) {
    const wrap = document.createElement('label');
    wrap.className = 'desktop-guac-field';
    const label = document.createElement('span');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.id = id;
    input.className = 'form-control';
    input.type = type;
    input.autocomplete = 'off';
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
}

function desktopGuacProtocolField() {
    const wrap = document.createElement('label');
    wrap.className = 'desktop-guac-field';
    const label = document.createElement('span');
    label.textContent = 'Protocol';
    const select = document.createElement('select');
    select.id = 'desktopGuacAddProtocol';
    select.className = 'form-control';
    ['rdp', 'vnc', 'ssh', 'telnet', 'kubernetes'].forEach((protocol) => {
        const option = document.createElement('option');
        option.value = protocol;
        option.textContent = protocol.toUpperCase();
        select.appendChild(option);
    });
    select.addEventListener('change', () => {
        const port = document.getElementById('desktopGuacAddPort');
        if (!port) return;
        const next = GUAC_DEFAULT_PORTS[select.value] || '';
        const currentIsDefault = Object.values(GUAC_DEFAULT_PORTS).indexOf(port.value) !== -1;
        if (!port.value || currentIsDefault) port.value = next;
    });
    wrap.appendChild(label);
    wrap.appendChild(select);
    return wrap;
}

function desktopGuacGroupField() {
    const wrap = document.createElement('label');
    wrap.className = 'desktop-guac-field';
    const label = document.createElement('span');
    label.textContent = 'Group';
    const select = document.createElement('select');
    select.id = 'desktopGuacAddGroup';
    select.className = 'form-control';
    wrap.appendChild(label);
    wrap.appendChild(select);
    return wrap;
}

function fillDesktopGuacGroupOptions() {
    const select = document.getElementById('desktopGuacAddGroup');
    if (!select) return;
    const current = select.value;
    select.replaceChildren();
    const root = document.createElement('option');
    root.value = 'ROOT';
    root.textContent = 'Top level';
    select.appendChild(root);
    guacGroupOptions.forEach((group) => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        select.appendChild(option);
    });
    if (current) select.value = current;
}

function toggleDesktopGuacAddForm() {
    const form = document.getElementById('desktopGuacAdd');
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) {
        fillDesktopGuacGroupOptions();
        const port = document.getElementById('desktopGuacAddPort');
        const protocol = document.getElementById('desktopGuacAddProtocol');
        if (port && protocol && !port.value) port.value = GUAC_DEFAULT_PORTS[protocol.value] || '';
        const name = document.getElementById('desktopGuacAddName');
        if (name) name.focus();
    }
}

async function submitDesktopGuacConnection() {
    const status = document.getElementById('desktopGuacAddStatus');
    const name = document.getElementById('desktopGuacAddName').value.trim();
    const protocol = document.getElementById('desktopGuacAddProtocol').value;
    const parentIdentifier = document.getElementById('desktopGuacAddGroup').value || 'ROOT';
    const hostname = document.getElementById('desktopGuacAddHost').value.trim();
    const port = document.getElementById('desktopGuacAddPort').value.trim();
    const username = document.getElementById('desktopGuacAddUser').value;
    const password = document.getElementById('desktopGuacAddPass').value;
    status.hidden = false;
    status.textContent = 'Saving...';
    let response;
    try {
        response = await fetch('/api/desktop-guac/connections', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                protocol: protocol,
                parentIdentifier: parentIdentifier,
                parameters: { hostname: hostname, port: port, username: username, password: password }
            })
        });
    } catch (_) {
        status.textContent = 'Could not reach Dreamscape.';
        return;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true) {
        status.textContent = (payload && payload.error) || 'Guacamole refused the new connection.';
        return;
    }
    document.getElementById('desktopGuacAddPass').value = '';
    document.getElementById('desktopGuacAdd').hidden = true;
    status.hidden = true;
    refreshDesktopGuacList();
}

function desktopGuacPreviewSrc(conn) {
    if (!conn || !conn.previewAt) return '';
    return '/api/desktop-guac/preview/' + encodeURIComponent(conn.id) + '?t=' + encodeURIComponent(conn.previewAt);
}

function noteDesktopGuacPreview(id) {
    const conn = guacCatalog.get(String(id));
    if (conn) conn.previewAt = Date.now();
    const card = document.querySelector('.desktop-guac-card[data-connection-id="' + CSS.escape(String(id)) + '"] .desktop-guac-thumb');
    if (!card || !conn) return;
    card.replaceChildren();
    const img = document.createElement('img');
    img.alt = '';
    img.src = desktopGuacPreviewSrc(conn);
    card.appendChild(img);
}

function noteDesktopGuacDownload(payload, name) {
    // showGlassToast: public/scripts/comp/glassToast.js
    if (payload && payload.ok) {
        showGlassToast('success', null, (payload.name || name) + ' saved to Downloads', false, 4000, '<i class="fas fa-download"></i>');
        return;
    }
    showGlassToast('error', null, 'Could not save ' + name + ' to Downloads', false, 4000, '<i class="fas fa-download"></i>');
}

function pinDesktopGuacConnection(conn, event) {
    if (event) event.stopPropagation();
    // desktopShortcuts.addShortcut: public/scripts/comp/desktopShortcuts.js
    const workspaceId = currentWorkspace || (desktopShortcuts && desktopShortcuts.currentWorkspace);
    if (!workspaceId || !desktopShortcuts) {
        showGlassToast('error', null, 'Open a workspace before adding a shortcut', false, 4000, '<i class="fas fa-satellite-dish"></i>');
        return;
    }
    const id = String(conn.id);
    const exists = desktopShortcuts.shortcuts.some((shortcut) => (
        shortcut.type === 'remote-desktop' && shortcut.data && String(shortcut.data.connectionId) === id && !shortcut._isDeleted
    ));
    if (exists) {
        showGlassToast('info', null, (conn.name || id) + ' is already on the desktop', false, 3000, '<i class="fas fa-satellite-dish"></i>');
        return;
    }
    desktopShortcuts.addShortcut({
        name: conn.name || id,
        type: 'remote-desktop',
        data: { connectionId: id, protocol: conn.protocol || '', icon: 'fas fa-satellite-dish' }
    });
    showGlassToast('success', null, 'Shortcut added to the desktop', false, 3000, '<i class="fas fa-satellite-dish"></i>');
}

function desktopGuacThumb(conn) {
    const thumb = document.createElement('div');
    thumb.className = 'desktop-guac-thumb';
    const src = desktopGuacPreviewSrc(conn);
    if (src) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = src;
        thumb.appendChild(img);
    } else {
        const icon = document.createElement('i');
        icon.className = GUAC_PROTOCOL_ICONS[conn.protocol] || 'fas fa-desktop';
        icon.setAttribute('aria-hidden', 'true');
        thumb.appendChild(icon);
    }
    return thumb;
}

const desktopGuacCardMenu = {
    sections: [{
        type: 'list',
        items: [
            { text: 'Add to desktop', icon: 'fas fa-desktop', action: 'guac-add-desktop' }
        ]
    }],
    onAction: (action, target) => {
        if (action !== 'guac-add-desktop' || !target) return;
        const conn = guacCatalog.get(String(target.dataset.connectionId || ''));
        if (conn) pinDesktopGuacConnection(conn);
    }
};

function clearDesktopGuacList(list) {
    if (!list) return;
    list.querySelectorAll('.desktop-guac-card').forEach((card) => {
        // contextMenu.detachFromElement: public/scripts/comp/contextMenu.js
        contextMenu.detachFromElement(card);
    });
    list.replaceChildren();
}

function desktopGuacCard(conn) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'desktop-guac-card';
    card.dataset.connectionId = String(conn.id);
    card.appendChild(desktopGuacThumb(conn));
    const meta = document.createElement('span');
    meta.className = 'desktop-guac-card-meta';
    const name = document.createElement('span');
    name.className = 'desktop-guac-card-name';
    name.textContent = conn.name || conn.id;
    const proto = document.createElement('span');
    proto.className = 'desktop-guac-card-proto';
    proto.textContent = (conn.protocol || 'session').toUpperCase();
    meta.appendChild(name);
    meta.appendChild(proto);
    card.appendChild(meta);
    card.addEventListener('click', () => openDesktopGuacSession(conn));
    // contextMenu.attachToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachToElement(card, desktopGuacCardMenu);
    return card;
}

function renderDesktopGuacGroups() {
    const list = document.getElementById('desktopGuacList');
    if (!list) return;
    clearDesktopGuacList(list);
    guacGroups.forEach((group) => {
        const block = document.createElement('section');
        block.className = 'desktop-guac-group';
        const heading = document.createElement('h3');
        heading.textContent = group.name;
        block.appendChild(heading);
        group.connections.forEach((conn) => block.appendChild(desktopGuacCard(conn)));
        list.appendChild(block);
    });
}

function renderDesktopGuacSearch(query) {
    const menu = document.getElementById('desktopGuacSearchMenu');
    if (!menu) return;
    const needle = String(query || '').trim().toLowerCase();
    menu.replaceChildren();
    guacSearchIndex = -1;
    if (!needle) {
        menu.hidden = true;
        return;
    }
    const matches = [];
    guacCatalog.forEach((conn) => {
        const hay = (conn.name + ' ' + (conn.protocol || '') + ' ' + (conn.groupName || '')).toLowerCase();
        if (hay.indexOf(needle) !== -1) matches.push(conn);
    });
    matches.sort((a, b) => a.name.localeCompare(b.name));
    if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'desktop-guac-search-empty';
        empty.textContent = 'No matches';
        menu.appendChild(empty);
        menu.hidden = false;
        return;
    }
    matches.slice(0, 12).forEach((conn, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'desktop-guac-search-row';
        row.dataset.searchIndex = String(index);
        const label = document.createElement('span');
        label.textContent = conn.name || conn.id;
        const extra = document.createElement('span');
        extra.textContent = conn.groupName || (conn.protocol || '').toUpperCase();
        row.appendChild(label);
        row.appendChild(extra);
        row.addEventListener('mousedown', (event) => event.preventDefault());
        row.addEventListener('click', () => {
            menu.hidden = true;
            const input = document.getElementById('desktopGuacSearch');
            if (input) input.value = '';
            openDesktopGuacSession(conn);
        });
        menu.appendChild(row);
    });
    menu.hidden = false;
}

function desktopGuacSearchKey(event) {
    const menu = document.getElementById('desktopGuacSearchMenu');
    if (!menu || menu.hidden) return;
    const rows = menu.querySelectorAll('.desktop-guac-search-row');
    if (!rows.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        guacSearchIndex += event.key === 'ArrowDown' ? 1 : -1;
        if (guacSearchIndex < 0) guacSearchIndex = rows.length - 1;
        if (guacSearchIndex >= rows.length) guacSearchIndex = 0;
        rows.forEach((row, index) => row.classList.toggle('active', index === guacSearchIndex));
        return;
    }
    if (event.key === 'Enter' && guacSearchIndex >= 0 && rows[guacSearchIndex]) {
        event.preventDefault();
        rows[guacSearchIndex].click();
        return;
    }
    if (event.key === 'Escape') menu.hidden = true;
}

async function refreshDesktopGuacList() {
    const status = document.getElementById('desktopGuacStatus');
    const list = document.getElementById('desktopGuacList');
    if (!status || !list) return;
    status.hidden = false;
    status.textContent = 'Loading connections...';
    clearDesktopGuacList(list);
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
    guacGroups = Array.isArray(payload.groups) ? payload.groups : [];
    guacGroupOptions = Array.isArray(payload.groupOptions) ? payload.groupOptions : [];
    if (!guacGroups.length && connections.length) {
        guacGroups = [{ id: 'ROOT', name: 'Connections', connections: connections }];
    }
    if (!connections.length) {
        status.textContent = 'Komaki returned no connections.';
        return;
    }
    status.hidden = true;
    guacCatalog.clear();
    connections.forEach((conn) => {
        if (conn && conn.id) guacCatalog.set(String(conn.id), conn);
    });
    fillDesktopGuacGroupOptions();
    renderDesktopGuacGroups();
    const search = document.getElementById('desktopGuacSearch');
    if (search && search.value) renderDesktopGuacSearch(search.value);
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
        protocol: conn.protocol || '',
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
        const barStatus = modal.querySelector('.desktop-guac-status');
        if (barStatus) {
            barStatus.textContent = desktopGuacStatusLabel(payload);
            barStatus.dataset.state = payload.state || '';
        } else {
            const hint = modal.querySelector('.modal-body > .form-hint');
            const connecting = DESKTOP_GUAC_CONNECTING_STATES.has(payload.state);
            if (hint) {
                hint.hidden = !connecting;
                hint.textContent = (connecting && payload.className === 'connecting' && payload.text) || 'Connecting...';
            }
        }
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

function desktopGuacStatusLabel(payload) {
    const state = payload && payload.state;
    if (!state || DESKTOP_GUAC_CONNECTING_STATES.has(state)) {
        return (payload && payload.className === 'connecting' && payload.text) || 'Connecting...';
    }
    if (state === 'CONNECTED') return 'Connected';
    if (state === 'DISCONNECTING') return 'Disconnecting...';
    if (payload && payload.text && payload.className && payload.className !== 'connecting') return payload.text;
    if (state === 'DISCONNECTED' || state === 'CLIENT_ERROR' || state === 'TUNNEL_ERROR') return 'Disconnected';
    return payload && payload.text || state;
}

function desktopGuacFrameApi(modal) {
    const frame = modal.querySelector('iframe');
    return frame && frame.contentWindow && frame.contentWindow.dreamscapeGuac;
}

function desktopGuacSetStatus(modal, text) {
    const status = modal.querySelector('.desktop-guac-status');
    if (status) status.textContent = text;
}

function desktopGuacBarButton(label, title, iconClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'desktop-guac-bar-btn';
    button.title = title || label;
    if (iconClass) {
        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
    }
    if (label) {
        const text = document.createElement('span');
        text.textContent = label;
        button.appendChild(text);
    }
    return button;
}

function buildDesktopGuacSessionBar(modal) {
    const bar = document.createElement('div');
    bar.className = 'desktop-guac-bar';
    const menuBtn = desktopGuacBarButton('', 'Guacamole menu', 'fas fa-bars');
    menuBtn.setAttribute('aria-label', 'Guacamole menu');
    menuBtn.addEventListener('click', () => {
        const api = desktopGuacFrameApi(modal);
        if (!api || !api.toggleMenu()) desktopGuacSetStatus(modal, 'Session is not ready');
    });
    const disconnectBtn = desktopGuacBarButton('Disconnect', 'Disconnect');
    disconnectBtn.addEventListener('click', () => {
        const api = desktopGuacFrameApi(modal);
        if (!api || !api.disconnect()) desktopGuacSetStatus(modal, 'Session is not ready');
    });
    const refreshBtn = desktopGuacBarButton('Refresh Screen', 'Refresh Screen');
    refreshBtn.addEventListener('click', () => {
        const api = desktopGuacFrameApi(modal);
        if (!api || !api.refresh()) desktopGuacSetStatus(modal, 'Session is not ready');
    });
    const pasteBtn = desktopGuacBarButton('Paste', 'Paste clipboard into the session');
    pasteBtn.addEventListener('click', () => {
        navigator.clipboard.readText().then((text) => {
            const api = desktopGuacFrameApi(modal);
            if (!api || !api.paste(text)) desktopGuacSetStatus(modal, 'Session is not ready');
        }).catch(() => desktopGuacSetStatus(modal, 'Clipboard is not available'));
    });
    const uploadBtn = desktopGuacBarButton('Upload File', 'Upload a file into the session');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = '';
        const api = desktopGuacFrameApi(modal);
        if (!files.length) return;
        if (!api || !api.upload(files)) desktopGuacSetStatus(modal, 'This session has no shared folder');
    });
    uploadBtn.addEventListener('click', () => fileInput.click());
    const downloads = document.createElement('div');
    downloads.className = 'desktop-guac-downloads';
    const downloadsBtn = desktopGuacBarButton('Downloads', 'Where session downloads go');
    downloadsBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = downloads.classList.contains('open');
        document.querySelectorAll('.desktop-guac-downloads.open').forEach((el) => el.classList.remove('open'));
        downloads.classList.toggle('open', !open);
    });
    const menu = document.createElement('div');
    menu.className = 'desktop-guac-downloads-menu';
    ['client', 'vfs'].forEach((value) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'desktop-guac-downloads-item';
        item.dataset.value = value;
        item.textContent = value === 'vfs' ? 'Downloads Folder' : 'Client';
        item.addEventListener('click', (event) => {
            event.stopPropagation();
            localStorage.setItem(GUAC_DOWNLOAD_TARGET_KEY, value);
            markDesktopGuacDownloadTarget(downloads);
            downloads.classList.remove('open');
        });
        menu.appendChild(item);
    });
    markDesktopGuacDownloadTarget(downloads);
    downloads.appendChild(downloadsBtn);
    downloads.appendChild(menu);
    const status = document.createElement('span');
    status.className = 'desktop-guac-status';
    status.dataset.state = 'CONNECTING';
    status.textContent = 'Connecting...';
    bar.appendChild(menuBtn);
    bar.appendChild(disconnectBtn);
    bar.appendChild(refreshBtn);
    bar.appendChild(pasteBtn);
    bar.appendChild(uploadBtn);
    bar.appendChild(fileInput);
    bar.appendChild(downloads);
    bar.appendChild(status);
    return bar;
}

function markDesktopGuacDownloadTarget(downloads) {
    const current = localStorage.getItem(GUAC_DOWNLOAD_TARGET_KEY) === 'vfs' ? 'vfs' : 'client';
    downloads.querySelectorAll('.desktop-guac-downloads-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.value === current);
    });
}

function buildDesktopGuacPinBar(modal) {
    const hit = document.createElement('div');
    hit.className = 'desktop-guac-pin-hit';
    const bar = document.createElement('div');
    bar.className = 'desktop-guac-pinbar';
    const name = document.createElement('span');
    name.className = 'desktop-guac-pin-name';
    name.textContent = modal.querySelector('.modal-window-title-main span').textContent;
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.title = 'Exit full screen';
    restoreBtn.appendChild(Object.assign(document.createElement('i'), { className: 'fa-regular fa-window-restore' }));
    restoreBtn.addEventListener('click', () => toggleDesktopGuacCover(modal));
    const minimizeBtn = document.createElement('button');
    minimizeBtn.type = 'button';
    minimizeBtn.title = 'Minimize';
    minimizeBtn.appendChild(Object.assign(document.createElement('i'), { className: 'fa-regular fa-window-minimize' }));
    minimizeBtn.addEventListener('click', () => modal.querySelector('.modal-window-controls .minimize-btn').click());
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.appendChild(Object.assign(document.createElement('i'), { className: 'fa-regular fa-xmark-large' }));
    closeBtn.addEventListener('click', () => modal.querySelector('.modal-window-controls .close-btn').click());
    bar.appendChild(name);
    bar.appendChild(restoreBtn);
    bar.appendChild(minimizeBtn);
    bar.appendChild(closeBtn);
    return { hit: hit, bar: bar };
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
    content.style.overflow = 'visible';
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.flex = '1 1 auto';
    body.style.minHeight = '0';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.padding = '0';
    body.style.overflow = 'hidden';

    const isSession = opts.windowIdentifier === 'desktopGuacSession';
    // Placement and [hidden]: public/css/desktop-apps/desktopAppWindows.css
    const status = document.createElement('p');
    status.className = 'form-hint';
    status.textContent = 'Connecting...';
    if (isSession) content.appendChild(buildDesktopGuacSessionBar(modal));
    else body.appendChild(status);
    content.appendChild(body);

    guacSessionModals.set(opts.key, modal);
    modal.appendChild(desktopGuacTitle(opts.title, opts.iconClass));
    if (isSession) {
        const pin = buildDesktopGuacPinBar(modal);
        body.appendChild(pin.hit);
        body.appendChild(pin.bar);
    }
    modal.appendChild(document.createElement('div')).className = 'modal-focus-overlay';
    modal.appendChild(desktopGuacControls(modal, () => {
        guacSessionModals.delete(opts.key);
        const frame = modal.querySelector('iframe');
        if (frame && desktopGuacDialogOwned(frame)) hideDesktopGuacDialog();
        if (desktopGuacDialog && desktopGuacDialog.frame === frame) desktopGuacDialog = null;
        modal.remove();
    }, isSession ? 'cover' : null));
    modal.appendChild(content);
    document.body.appendChild(modal);
    showDesktopGuacModal(modal);

    fetch(opts.endpoint, { credentials: 'same-origin' })
        .then((response) => response.json().catch(() => null).then((payload) => {
            if (guacSessionModals.get(opts.key) !== modal) return;
            if (!response.ok || !payload || !payload.url) {
                const message = (payload && payload.error) || 'Komaki session is unavailable.';
                if (isSession) desktopGuacSetStatus(modal, message);
                else status.textContent = message;
                return;
            }
            const frame = document.createElement('iframe');
            frame.title = opts.title;
            if (opts.protocol) frame.dataset.protocol = opts.protocol;
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
                if (!isSession) status.hidden = !desktopGuacRouteConnection(frame.contentWindow.location.hash);
                trackDesktopGuacFrame(modal, frame, opts.title);
                focusFrame();
            });
            new MutationObserver(focusFrame).observe(modal, { attributes: true, attributeFilter: ['class'] });
            modal.addEventListener('pointerup', (event) => {
                if (!event.target.closest('.modal-window-controls, .desktop-guac-bar, .desktop-guac-pinbar')) focusFrame();
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
            const message = 'Could not reach Dreamscape for the Komaki session.';
            if (isSession) desktopGuacSetStatus(modal, message);
            else status.textContent = message;
        });
}

document.addEventListener('click', () => {
    document.querySelectorAll('.desktop-guac-downloads.open').forEach((el) => el.classList.remove('open'));
});
