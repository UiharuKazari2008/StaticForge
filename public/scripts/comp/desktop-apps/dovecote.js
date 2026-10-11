// Dovecote: Outlook-Express-style internal mail client.
// Server side (mail store, privacy enforcement, MCP tools, WS handlers, HTML sanitizer):
// modules/dovecoteMail.js, modules/dovecoteRender.js, modules/dovecoteSanitize.js,
// modules/ws/handlers/250-dovecoteHandler.js. This file is the desktop window only.
// openModal / bringModalToFront / restoreMinimizedModal / closeModal: public/scripts/comp/modalUtils.js
// contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js (Mailbox + Forward pickers)
// escapeHtml / escapeHtmlAttribute: public/scripts/comp/utilities.js
// wsClient.sendMessage: public/scripts/websocket.js
// Layout and mobile breakpoint: public/css/desktop-apps/dovecote.css

const DESKTOP_DOVECOTE_MODAL_ID = 'desktopDovecoteModal';
const DESKTOP_DOVECOTE_HUMAN_OWNER = 'yukimi';

const DESKTOP_DOVECOTE_FOLDERS = [
    { id: 'inbox', label: 'Inbox', icon: 'fas fa-inbox' },
    { id: 'outbox', label: 'Outbox', icon: 'fas fa-paper-plane' },
    { id: 'sent', label: 'Sent Items', icon: 'fas fa-check-double' },
    { id: 'deleted', label: 'Deleted Items', icon: 'fas fa-trash' },
    { id: 'archive', label: 'Archive', icon: 'fas fa-box-archive' }
];

// { folder, sortKey, sortDir, viewAsOwner, mail: [], selectedId, mailboxes: [], bodyView, searchOpen, searchText, mobileMessageOpen }
const desktopDovecote = {
    loaded: false,
    folder: 'inbox',
    sortKey: 'createdAt',
    sortDir: 'desc',
    viewAsOwner: null,
    mail: [],
    mailboxes: [],
    selectedId: null,
    selectedMail: null,
    bodyView: 'rendered',
    allowRemoteImagesOnce: false,
    searchOpen: false,
    searchText: '',
    mobileMessageOpen: false,
    statusError: null
};
let desktopDovecoteEls = null;

// Compose and reader messages each pop out into their own top-level window
// (guacRemote.js guacSessionModals pattern), so several can be open at once.
// key -> modal (compose) / key -> { modal, els, mail, bodyView } (reader)
const doveComposeWindows = new Map();
const doveReaderWindows = new Map();
let doveComposeSeq = 0;

// Shared show/raise logic for every Dovecote top-level window (main, compose, reader).
// showDesktopGuacModal: public/scripts/comp/desktop-apps/guacRemote.js — same pattern.
function doveShowWindow(modal) {
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

function openDesktopDovecote() {
    const modal = ensureDesktopDovecoteModal();
    doveShowWindow(modal);
    if (!desktopDovecote.loaded) {
        desktopDovecote.loaded = true;
        doveRefreshMailboxes();
        doveLoadFolder(desktopDovecote.folder);
    }
}

const doveCreateButton = function (className, title, iconClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    if (iconClass) {
        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
    }
    return button;
};

const doveIsBotOwner = function (owner) {
    return owner !== DESKTOP_DOVECOTE_HUMAN_OWNER;
};

// Shared title bar builder for the compose and reader windows (ensureDesktopDovecoteModal
// builds its own inline, since it also carries the main toolbar).
const doveBuildWindowTitle = function (text, iconClass) {
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
};

// The taskbar copies the title bar's span and icon: modalUtils.js updateTaskbarWindows
const doveSetWindowTitle = function (modal, text, iconClass) {
    const titleText = modal.querySelector('.modal-window-title-main span');
    const titleIcon = modal.querySelector('.modal-window-title-main i');
    if (titleText.textContent === text && titleIcon.className === iconClass) return;
    titleText.textContent = text;
    titleIcon.className = iconClass;
    // debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js
    debouncedUpdateTaskbarWindows();
};

// Minimize + close window controls shared by the compose and reader windows.
const doveBuildWindowControls = function (modal, onClose) {
    const controls = document.createElement('div');
    controls.className = 'modal-window-controls';
    const minimizeBtn = doveCreateButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize');
    const closeBtn = doveCreateButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    closeBtn.addEventListener('click', () => {
        // closeModal: public/scripts/comp/modalUtils.js
        const closing = closeModal(modal);
        if (onClose) closing.then(onClose);
    });
    return controls;
};

// ---- Modal skeleton --------------------------------------------------------

const ensureDesktopDovecoteModal = function () {
    let modal = document.getElementById(DESKTOP_DOVECOTE_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = DESKTOP_DOVECOTE_MODAL_ID;
    modal.className = 'modal resizeable-window toolbar-visible hidden';
    modal.dataset.windowIdentifier = 'desktopDovecote';
    modal.dataset.windowDefaultWidth = '760';
    modal.dataset.windowDefaultHeight = '520';
    modal.dataset.windowMinWidth = '360';
    modal.dataset.windowMinHeight = '320';
    modal.dataset.windowMaxWidth = '1400';
    modal.dataset.windowMaxHeight = '1000';

    const title = document.createElement('div');
    title.className = 'modal-window-title';
    const titleMain = document.createElement('div');
    titleMain.className = 'modal-window-title-main';
    const titleIcon = document.createElement('i');
    titleIcon.className = 'fas fa-envelope';
    titleIcon.setAttribute('aria-hidden', 'true');
    const titleText = document.createElement('span');
    titleText.textContent = 'Dovecote';
    titleMain.appendChild(titleIcon);
    titleMain.appendChild(titleText);
    title.appendChild(titleMain);

    const toolbar = doveBuildToolbar(modal);
    title.appendChild(toolbar);

    const focusOverlay = document.createElement('div');
    focusOverlay.className = 'modal-focus-overlay';

    const controls = document.createElement('div');
    controls.className = 'modal-window-controls';
    const minimizeBtn = doveCreateButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize');
    const closeBtn = doveCreateButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    closeBtn.addEventListener('click', () => {
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    });

    const content = document.createElement('div');
    content.className = 'modal-content modal-padding dark';
    const body = document.createElement('div');
    body.className = 'modal-body';

    body.appendChild(doveBuildFolderTree());
    body.appendChild(doveBuildMainPane());
    body.appendChild(doveBuildMobileFolderDrawer());

    content.appendChild(body);
    modal.appendChild(title);
    modal.appendChild(focusOverlay);
    modal.appendChild(controls);
    modal.appendChild(content);
    document.body.appendChild(modal);

    desktopDovecoteEls = {
        modal: modal,
        toolbar: toolbar,
        body: body
    };
    doveCacheEls();
    doveWireEvents();
    doveRenderMailboxBanner();
    doveRenderFolderTree();
    doveRenderToolbarState();
    return modal;
};

// ---- Toolbar ---------------------------------------------------------------

const doveBuildToolbar = function () {
    const toolbar = document.createElement('div');
    toolbar.className = 'modal-window-title-toolbar';

    // data-dove-mutating marks every button doveRenderToolbarState must disable in read-only
    // admin view (viewAsOwner set) — one attribute to check rather than a hardcoded action list.
    const createBtn = doveCreateButton('btn-secondary', 'Create Mail', 'fas fa-pen-to-square');
    createBtn.dataset.doveAction = 'create';
    createBtn.dataset.doveMutating = 'true';
    toolbar.appendChild(createBtn);

    const replyGroup = document.createElement('div');
    replyGroup.className = 'button-group';
    const replyBtn = doveCreateButton('btn-secondary', 'Reply', 'fas fa-reply');
    replyBtn.dataset.doveAction = 'reply';
    replyBtn.dataset.doveMutating = 'true';
    const replyAllBtn = doveCreateButton('btn-secondary', 'Reply All', 'fas fa-reply-all');
    replyAllBtn.dataset.doveAction = 'replyAll';
    replyAllBtn.dataset.doveMutating = 'true';
    // Forward opens a mailbox picker (doveForwardMenuConfig) instead of a plain data-dove-action.
    const forwardBtn = doveCreateButton('btn-secondary', 'Forward', 'fas fa-share');
    forwardBtn.dataset.doveMutating = 'true';
    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(forwardBtn, doveForwardMenuConfig);
    replyGroup.appendChild(replyBtn);
    replyGroup.appendChild(replyAllBtn);
    replyGroup.appendChild(forwardBtn);
    toolbar.appendChild(replyGroup);

    const toggleReadBtn = doveCreateButton('btn-secondary', 'Toggle Read', 'fas fa-envelope-open');
    toggleReadBtn.dataset.doveAction = 'toggleRead';
    toggleReadBtn.dataset.doveMutating = 'true';
    toolbar.appendChild(toggleReadBtn);

    const deleteBtn = doveCreateButton('btn-secondary', 'Delete', 'fas fa-trash');
    deleteBtn.dataset.doveAction = 'delete';
    deleteBtn.dataset.doveMutating = 'true';
    toolbar.appendChild(deleteBtn);

    const archiveBtn = doveCreateButton('btn-secondary', 'Archive', 'fas fa-box-archive');
    archiveBtn.dataset.doveAction = 'archive';
    archiveBtn.dataset.doveMutating = 'true';
    toolbar.appendChild(archiveBtn);

    const refreshBtn = doveCreateButton('btn-secondary', 'Refresh', 'fas fa-rotate');
    refreshBtn.dataset.doveAction = 'refresh';
    toolbar.appendChild(refreshBtn);

    const findBtn = doveCreateButton('btn-secondary btn-toggle', 'Find', 'fas fa-magnifying-glass');
    findBtn.dataset.doveAction = 'find';
    findBtn.dataset.state = 'off';
    toolbar.appendChild(findBtn);

    const searchGroup = document.createElement('div');
    searchGroup.className = 'button-group hidden';
    searchGroup.id = 'desktopDovecoteSearchGroup';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'form-control';
    searchInput.id = 'desktopDovecoteSearchInput';
    searchInput.placeholder = 'Filter subject, from, snippet…';
    searchGroup.appendChild(searchInput);
    toolbar.appendChild(searchGroup);

    const viewGroup = document.createElement('div');
    viewGroup.className = 'button-group';
    const renderedBtn = doveCreateButton('btn-secondary btn-toggle toolbar-input-segment', 'Rendered', 'fas fa-code');
    renderedBtn.dataset.doveBodyView = 'rendered';
    renderedBtn.dataset.state = 'on';
    const rawBtn = doveCreateButton('btn-secondary btn-toggle toolbar-input-segment', 'Raw', 'fas fa-file-lines');
    rawBtn.dataset.doveBodyView = 'raw';
    rawBtn.dataset.state = 'off';
    viewGroup.appendChild(renderedBtn);
    viewGroup.appendChild(rawBtn);
    toolbar.appendChild(viewGroup);

    toolbar.appendChild(doveBuildMailboxButton());

    toolbar.addEventListener('click', doveHandleToolbarClick);
    searchInput.addEventListener('input', () => {
        desktopDovecote.searchText = searchInput.value;
        doveRenderMessageList();
    });

    return toolbar;
};

// Mailboxes other than the one currently being viewed — used by the Forward picker.
const doveOtherMailboxes = function () {
    const current = desktopDovecote.viewAsOwner || DESKTOP_DOVECOTE_HUMAN_OWNER;
    return desktopDovecote.mailboxes.filter((box) => box.owner !== current);
};

// contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js — items rebuilt on
// every open via initfn so the menu always reflects the live mailbox list.
const doveMailboxMenuConfig = {
    onAction: (action, target, item) => doveSwitchMailbox(item.doveOwner),
    sections: [{
        type: 'list',
        initfn: (section) => {
            section.items = desktopDovecote.mailboxes.length
                ? desktopDovecote.mailboxes.map((box) => ({
                    text: box.label + (box.unread ? ' (' + box.unread + ')' : ''),
                    icon: doveIsBotOwner(box.owner) ? 'fas fa-robot' : 'fas fa-user',
                    action: 'dove-mailbox-pick',
                    doveOwner: box.owner,
                    showIndicator: true,
                    loadfn: (it) => { it.checked = (desktopDovecote.viewAsOwner || DESKTOP_DOVECOTE_HUMAN_OWNER) === box.owner; }
                }))
                : [{ text: 'Loading…', disabled: true }]
        }
    }]
};

const doveBuildMailboxButton = function () {
    const button = doveCreateButton('btn-secondary dovecote-mailbox-btn', 'Mailbox', 'fas fa-inbox');
    const label = document.createElement('span');
    label.textContent = 'Mailbox';
    button.appendChild(label);
    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(button, doveMailboxMenuConfig);
    return button;
};

// Picking a mailbox autofills the compose "To" field (doveOpenCompose's presetTo) instead of
// sending immediately — Forward now goes through the normal compose/review flow for any mailbox,
// not just bots, and there is no separate one-click "Fwd to Bot" action.
// getMail: reads the mail to forward at click time — the main toolbar's Forward button reads the
// currently selected message, a reader window's Forward button reads its own loaded message.
const doveMakeForwardMenuConfig = function (getMail) {
    return {
        onAction: (action, target, item) => doveOpenCompose('forward', getMail(), item.doveOwner),
        sections: [{
            type: 'list',
            initfn: (section) => {
                // Read-only admin view: forwarding someone else's mail is still a mutation, same as Reply/Delete/Archive.
                const disabled = !getMail() || !!desktopDovecote.viewAsOwner;
                const others = doveOtherMailboxes();
                section.items = others.length
                    ? others.map((box) => ({
                        text: box.label,
                        icon: doveIsBotOwner(box.owner) ? 'fas fa-robot' : 'fas fa-user',
                        action: 'dove-forward-pick',
                        doveOwner: box.owner,
                        disabled: disabled
                    }))
                    : [{ text: 'No other mailboxes', disabled: true }]
            }
        }]
    };
};

// Main window's own Forward button (toolbar + mobile preview toolbar) forwards whatever is
// currently selected.
const doveForwardMenuConfig = doveMakeForwardMenuConfig(() => desktopDovecote.selectedMail);

const doveSwitchMailbox = function (owner) {
    desktopDovecote.viewAsOwner = owner === DESKTOP_DOVECOTE_HUMAN_OWNER ? null : owner;
    desktopDovecote.selectedId = null;
    desktopDovecote.selectedMail = null;
    doveRenderMailboxBanner();
    doveRenderToolbarState();
    // Already-open reader windows (doveReaderWindows) enforce the same read-only rule as
    // the main toolbar, and it can change out from under them while they're open.
    doveReaderWindows.forEach((state) => doveRenderReaderToolbarState(state));
    doveRenderPreview();
    doveLoadFolder(desktopDovecote.folder);
};

// ---- Folder tree ------------------------------------------------------------

const doveBuildFolderTree = function () {
    const tree = document.createElement('div');
    // director-content-inner: public/css/director.css — same recessed panel treatment as
    // Director's session list (.director-sessions-list.director-content-inner).
    tree.className = 'dovecote-folder-tree director-content-inner';
    tree.id = 'desktopDovecoteFolderTree';
    DESKTOP_DOVECOTE_FOLDERS.forEach((folder) => {
        tree.appendChild(doveBuildFolderRow(folder));
    });
    tree.addEventListener('click', (ev) => {
        const row = ev.target.closest('[data-dove-folder]');
        if (!row) return;
        doveLoadFolder(row.dataset.doveFolder);
    });
    return tree;
};

const doveBuildFolderRow = function (folder) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dovecote-folder-row';
    row.dataset.doveFolder = folder.id;
    const icon = document.createElement('i');
    icon.className = folder.icon;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'dovecote-folder-label';
    label.textContent = folder.label;
    row.appendChild(icon);
    row.appendChild(label);
    if (folder.id === 'inbox') {
        const badge = document.createElement('span');
        // Class, not id: this row is built twice (sidebar tree + mobile drawer).
        badge.className = 'dovecote-unread-badge hidden';
        row.appendChild(badge);
    }
    return row;
};

const doveRenderFolderTree = function () {
    desktopDovecoteEls.modal.querySelectorAll('[data-dove-folder]').forEach((row) => {
        row.classList.toggle('selected', row.dataset.doveFolder === desktopDovecote.folder);
    });
};

const doveRenderInboxBadge = function (unreadCount) {
    // doveApplyTrayBadge: keeps the taskbar tray badge (#dovecoteTrayIcon) live whenever the
    // main window already knows the human's own inbox unread count — not an admin view of
    // someone else's mailbox, the tray only ever reflects Yukimi's own inbox.
    if (!desktopDovecote.viewAsOwner) doveApplyTrayBadge(unreadCount);
    desktopDovecoteEls.modal.querySelectorAll('.dovecote-unread-badge').forEach((badge) => {
        if (unreadCount > 0) {
            badge.textContent = String(unreadCount);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    });
};

// ---- Mobile folder drawer ---------------------------------------------------

const doveBuildMobileFolderDrawer = function () {
    const drawer = document.createElement('div');
    drawer.className = 'dovecote-mobile-folder-drawer hidden';
    drawer.id = 'desktopDovecoteMobileDrawer';
    DESKTOP_DOVECOTE_FOLDERS.forEach((folder) => {
        drawer.appendChild(doveBuildFolderRow(folder));
    });
    drawer.addEventListener('click', (ev) => {
        const row = ev.target.closest('[data-dove-folder]');
        if (!row) return;
        drawer.classList.add('hidden');
        doveLoadFolder(row.dataset.doveFolder);
    });
    return drawer;
};

// ---- Main pane: message list + preview -------------------------------------

const DESKTOP_DOVECOTE_LIST_COLUMNS = [
    { key: 'unread', label: '', sortable: false },
    { key: 'attachment', label: '📎', sortable: false },
    { key: 'from', label: 'From', sortable: true },
    { key: 'subject', label: 'Subject', sortable: true },
    { key: 'createdAt', label: 'Received', sortable: true }
];

const doveBuildMainPane = function () {
    const pane = document.createElement('div');
    pane.className = 'dovecote-main-pane';
    pane.id = 'desktopDovecoteMainPane';

    const listWrap = document.createElement('div');
    // director-content-inner: public/css/director.css — recessed panel treatment, same as
    // Director's chat messages container.
    listWrap.className = 'dovecote-message-list-wrap director-content-inner';

    const mobileToolbar = document.createElement('div');
    mobileToolbar.className = 'dovecote-mobile-list-toolbar';
    const foldersBtn = doveCreateButton('btn-secondary btn-small', 'Folders', 'fas fa-bars');
    foldersBtn.dataset.doveAction = 'mobileFolders';
    mobileToolbar.appendChild(foldersBtn);
    listWrap.appendChild(mobileToolbar);

    const table = document.createElement('div');
    table.className = 'dovecote-message-list';
    table.id = 'desktopDovecoteMessageList';

    const header = document.createElement('div');
    header.className = 'dovecote-message-row dovecote-message-header';
    DESKTOP_DOVECOTE_LIST_COLUMNS.forEach((col) => {
        const cell = document.createElement('span');
        cell.className = 'dovecote-col-' + col.key;
        cell.textContent = col.label;
        if (col.sortable) {
            cell.classList.add('sortable');
            cell.dataset.doveSortKey = col.key;
        }
        header.appendChild(cell);
    });
    table.appendChild(header);

    const rows = document.createElement('div');
    rows.className = 'dovecote-message-rows scrollable-content';
    rows.id = 'desktopDovecoteMessageRows';
    table.appendChild(rows);

    header.addEventListener('click', (ev) => {
        const cell = ev.target.closest('[data-dove-sort-key]');
        if (!cell) return;
        doveSetSort(cell.dataset.doveSortKey);
    });
    rows.addEventListener('click', (ev) => {
        const row = ev.target.closest('[data-dove-mail-id]');
        if (!row) return;
        doveSelectMail(row.dataset.doveMailId);
    });
    rows.addEventListener('dblclick', (ev) => {
        const row = ev.target.closest('[data-dove-mail-id]');
        if (!row) return;
        doveOpenReaderWindow(row.dataset.doveMailId);
    });

    listWrap.appendChild(table);
    pane.appendChild(listWrap);
    pane.appendChild(doveBuildPreviewPane());
    return pane;
};

const doveBuildPreviewPane = function () {
    const preview = document.createElement('div');
    // director-content-inner: public/css/director.css — recessed panel treatment, same as
    // Director's chat messages container.
    preview.className = 'dovecote-preview-pane director-content-inner';
    preview.id = 'desktopDovecotePreviewPane';

    const mobileBackBar = document.createElement('div');
    mobileBackBar.className = 'dovecote-mobile-message-toolbar';
    const backBtn = doveCreateButton('btn-secondary btn-small', 'Back to list', 'fas fa-chevron-left');
    backBtn.dataset.doveAction = 'mobileBack';
    const backLabel = document.createElement('span');
    backLabel.textContent = ' Inbox';
    backBtn.appendChild(backLabel);
    mobileBackBar.appendChild(backBtn);
    const mobileActions = document.createElement('div');
    mobileActions.className = 'button-group';
    ['reply', 'replyAll', 'forward', 'archive', 'delete'].forEach((action) => {
        const icons = { reply: 'fas fa-reply', replyAll: 'fas fa-reply-all', forward: 'fas fa-share', archive: 'fas fa-box-archive', delete: 'fas fa-trash' };
        const titles = { reply: 'Reply', replyAll: 'Reply All', forward: 'Forward', archive: 'Archive', delete: 'Delete' };
        const btn = doveCreateButton('btn-secondary btn-small', titles[action], icons[action]);
        if (action === 'forward') {
            // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
            contextMenu.attachClickMenuToElement(btn, doveForwardMenuConfig);
        } else {
            btn.dataset.doveAction = action;
        }
        mobileActions.appendChild(btn);
    });
    mobileBackBar.appendChild(mobileActions);
    preview.appendChild(mobileBackBar);

    const header = document.createElement('div');
    header.className = 'dovecote-oe-header';
    header.id = 'desktopDovecoteOeHeader';
    ['from', 'to', 'subject', 'date'].forEach((field) => {
        const row = document.createElement('div');
        row.className = 'dovecote-oe-header-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'dovecote-oe-header-label';
        labelEl.textContent = field.charAt(0).toUpperCase() + field.slice(1) + ':';
        const valueEl = document.createElement('span');
        valueEl.className = 'dovecote-oe-header-value';
        valueEl.id = 'desktopDovecoteOe' + field.charAt(0).toUpperCase() + field.slice(1);
        row.appendChild(labelEl);
        row.appendChild(valueEl);
        header.appendChild(row);
    });
    preview.appendChild(header);

    const safetyBar = document.createElement('div');
    safetyBar.className = 'dovecote-safety-bar hidden';
    safetyBar.id = 'desktopDovecoteSafetyBar';
    preview.appendChild(safetyBar);

    const imagesBar = document.createElement('div');
    imagesBar.className = 'dovecote-images-bar hidden';
    imagesBar.id = 'desktopDovecoteImagesBar';
    preview.appendChild(imagesBar);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'dovecote-body-wrap';
    bodyWrap.id = 'desktopDovecoteBodyWrap';
    const emptyHint = document.createElement('p');
    emptyHint.className = 'form-hint dovecote-empty-hint';
    emptyHint.id = 'desktopDovecoteEmptyHint';
    emptyHint.textContent = 'Select a message to read it.';
    bodyWrap.appendChild(emptyHint);
    preview.appendChild(bodyWrap);

    return preview;
};

const doveBuildStatusBar = function () {
    const status = document.createElement('div');
    status.className = 'dovecote-status-bar';
    const counts = document.createElement('span');
    counts.id = 'desktopDovecoteStatusCounts';
    counts.textContent = '0 messages, 0 unread';
    const sanitizeState = document.createElement('span');
    sanitizeState.id = 'desktopDovecoteStatusSanitize';
    sanitizeState.className = 'hidden';
    const error = document.createElement('span');
    error.id = 'desktopDovecoteStatusError';
    error.className = 'dovecote-status-error hidden';
    const online = document.createElement('span');
    online.className = 'dovecote-status-online';
    online.textContent = 'Working Online';
    status.appendChild(counts);
    status.appendChild(sanitizeState);
    status.appendChild(error);
    status.appendChild(online);
    return status;
};

// ---- Cache + wiring ----------------------------------------------------------

const doveCacheEls = function () {
    desktopDovecoteEls = Object.assign(desktopDovecoteEls || {}, {
        modal: document.getElementById(DESKTOP_DOVECOTE_MODAL_ID),
        rows: document.getElementById('desktopDovecoteMessageRows'),
        statusCounts: document.getElementById('desktopDovecoteStatusCounts'),
        statusSanitize: document.getElementById('desktopDovecoteStatusSanitize'),
        statusError: document.getElementById('desktopDovecoteStatusError'),
        bodyWrap: document.getElementById('desktopDovecoteBodyWrap'),
        emptyHint: document.getElementById('desktopDovecoteEmptyHint'),
        safetyBar: document.getElementById('desktopDovecoteSafetyBar'),
        imagesBar: document.getElementById('desktopDovecoteImagesBar'),
        oeFrom: document.getElementById('desktopDovecoteOeFrom'),
        oeTo: document.getElementById('desktopDovecoteOeTo'),
        oeSubject: document.getElementById('desktopDovecoteOeSubject'),
        oeDate: document.getElementById('desktopDovecoteOeDate'),
        searchGroup: document.getElementById('desktopDovecoteSearchGroup'),
        searchInput: document.getElementById('desktopDovecoteSearchInput'),
        mainPane: document.getElementById('desktopDovecoteMainPane'),
        mobileDrawer: document.getElementById('desktopDovecoteMobileDrawer')
    });
};

const doveWireEvents = function () {
    desktopDovecoteEls.modal.addEventListener('click', doveHandleBodyClick);
};

const doveHandleToolbarClick = function (ev) {
    const bodyBtn = ev.target.closest('[data-dove-body-view]');
    if (bodyBtn) {
        doveSetBodyView(bodyBtn.dataset.doveBodyView);
        return;
    }
    const button = ev.target.closest('[data-dove-action]');
    if (!button) return;
    doveDispatchAction(button.dataset.doveAction);
};

const doveHandleBodyClick = function (ev) {
    const button = ev.target.closest('[data-dove-action]');
    if (!button) return;
    doveDispatchAction(button.dataset.doveAction);
};

const doveDispatchAction = function (action) {
    switch (action) {
        case 'create': doveOpenCompose('create', null); return;
        case 'reply': doveOpenCompose('reply', desktopDovecote.selectedMail); return;
        case 'replyAll': doveOpenCompose('replyAll', desktopDovecote.selectedMail); return;
        case 'toggleRead': doveToggleRead(); return;
        case 'delete': doveDeleteSelected(); return;
        case 'archive': doveArchiveSelected(); return;
        case 'refresh': doveLoadFolder(desktopDovecote.folder); return;
        case 'find': doveToggleFind(); return;
        case 'mobileFolders': doveToggleMobileDrawer(); return;
        case 'mobileBack': doveSetMobileMessageOpen(false); return;
        default: return;
    }
};

// ---- Data loading -------------------------------------------------------------

const doveShowError = function (message) {
    desktopDovecote.statusError = message;
    if (message && typeof showGlassToast === 'function') {
        showGlassToast('error', 'Dovecote', message, false, 6000, '<i class="fas fa-dove"></i>');
    }
};

const doveRefreshMailboxes = async function () {
    try {
        // dovecote_list_mailboxes: modules/ws/handlers/250-dovecoteHandler.js
        const result = await wsClient.sendMessage('dovecote_list_mailboxes', {}, false);
        desktopDovecote.mailboxes = (result && result.mailboxes) || [];
        doveRenderMailboxBanner();
    } catch (err) {
        doveShowError((err && err.message) || 'Could not load mailbox list');
    }
};

const doveLoadFolder = async function (folder) {
    desktopDovecote.folder = folder;
    doveRenderFolderTree();
    doveShowError(null);
    const request = { folder: folder };
    if (desktopDovecote.viewAsOwner) request.viewAsOwner = desktopDovecote.viewAsOwner;
    try {
        // dovecote_list_mail: modules/ws/handlers/250-dovecoteHandler.js
        const result = await wsClient.sendMessage('dovecote_list_mail', request, false);
        desktopDovecote.mail = (result && result.mail) || [];
        doveRenderMessageList();
        if (folder === 'inbox') {
            doveRenderInboxBadge(desktopDovecote.mail.filter((m) => !m.read).length);
        } else if (!desktopDovecote.viewAsOwner) {
            doveRefreshInboxBadgeOnly();
        }
    } catch (err) {
        desktopDovecote.mail = [];
        doveRenderMessageList();
        doveShowError((err && err.message) || 'Could not load mail');
    }
};

// Keeps the Inbox unread badge current even while another folder is open.
const doveRefreshInboxBadgeOnly = async function () {
    try {
        const result = await wsClient.sendMessage('dovecote_list_mail', { folder: 'inbox' }, false);
        const mail = (result && result.mail) || [];
        doveRenderInboxBadge(mail.filter((m) => !m.read).length);
    } catch (_) {
        // Non-critical background refresh; the visible folder's own error path already surfaced issues.
    }
};

const doveSetSort = function (key) {
    if (desktopDovecote.sortKey === key) {
        desktopDovecote.sortDir = desktopDovecote.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        desktopDovecote.sortKey = key;
        desktopDovecote.sortDir = key === 'createdAt' ? 'desc' : 'asc';
    }
    doveRenderMessageList();
};

const doveToggleFind = function () {
    desktopDovecote.searchOpen = !desktopDovecote.searchOpen;
    desktopDovecoteEls.searchGroup.classList.toggle('hidden', !desktopDovecote.searchOpen);
    const findBtn = desktopDovecoteEls.toolbar.querySelector('[data-dove-action="find"]');
    if (findBtn) findBtn.dataset.state = desktopDovecote.searchOpen ? 'on' : 'off';
    if (desktopDovecote.searchOpen) {
        desktopDovecoteEls.searchInput.focus();
    } else {
        desktopDovecote.searchText = '';
        desktopDovecoteEls.searchInput.value = '';
        doveRenderMessageList();
    }
};

const doveToggleMobileDrawer = function () {
    desktopDovecoteEls.mobileDrawer.classList.toggle('hidden');
};

const doveSetMobileMessageOpen = function (open) {
    desktopDovecote.mobileMessageOpen = open;
    desktopDovecoteEls.mainPane.classList.toggle('dovecote-mobile-message-open', open);
};

const doveSetBodyView = function (view) {
    desktopDovecote.bodyView = view;
    desktopDovecoteEls.toolbar.querySelectorAll('[data-dove-body-view]').forEach((btn) => {
        btn.dataset.state = btn.dataset.doveBodyView === view ? 'on' : 'off';
    });
    doveRenderPreviewBody();
};

// ---- Message list rendering ----------------------------------------------------

const doveFilteredSortedMail = function () {
    const query = desktopDovecote.searchText.trim().toLowerCase();
    let list = desktopDovecote.mail;
    if (query) {
        list = list.filter((m) => (
            (m.subject || '').toLowerCase().includes(query)
            || (m.from || '').toLowerCase().includes(query)
            || (m.snippet || '').toLowerCase().includes(query)
        ));
    }
    const key = desktopDovecote.sortKey;
    const dir = desktopDovecote.sortDir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
        const av = (a[key] || '').toString().toLowerCase();
        const bv = (b[key] || '').toString().toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
    });
};

const doveFormatDate = function (iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
};

const doveRenderMessageList = function () {
    const rows = desktopDovecoteEls.rows;
    if (!rows) return;
    rows.replaceChildren();
    const list = doveFilteredSortedMail();
    list.forEach((mail) => {
        const row = document.createElement('div');
        row.className = 'dovecote-message-row';
        row.dataset.doveMailId = mail.id;
        if (!mail.read) row.classList.add('unread');
        if (mail.id === desktopDovecote.selectedId) row.classList.add('selected');

        const unreadCell = document.createElement('span');
        unreadCell.className = 'dovecote-col-unread';
        if (!mail.read) {
            const dot = document.createElement('i');
            dot.className = 'fas fa-circle';
            dot.setAttribute('aria-hidden', 'true');
            unreadCell.appendChild(dot);
        }

        // There are no real attachments in this version; the column exists for layout fidelity only.
        const attachCell = document.createElement('span');
        attachCell.className = 'dovecote-col-attachment';

        const fromCell = document.createElement('span');
        fromCell.className = 'dovecote-col-from';
        fromCell.textContent = mail.from || '';

        const subjectCell = document.createElement('span');
        subjectCell.className = 'dovecote-col-subject';
        subjectCell.textContent = mail.subject || '(no subject)';

        const dateCell = document.createElement('span');
        dateCell.className = 'dovecote-col-createdAt';
        dateCell.textContent = doveFormatDate(mail.createdAt);

        row.appendChild(unreadCell);
        row.appendChild(attachCell);
        row.appendChild(fromCell);
        row.appendChild(subjectCell);
        row.appendChild(dateCell);
        rows.appendChild(row);
    });
    doveRenderStatusCounts();
};

const doveRenderStatusCounts = function () {
    const total = desktopDovecote.mail.length;
    const unread = desktopDovecote.mail.filter((m) => !m.read).length;
    if (!desktopDovecoteEls.statusCounts) return;
    desktopDovecoteEls.statusCounts.textContent = total + ' message' + (total === 1 ? '' : 's') + ', ' + unread + ' unread';
};

// ---- Selection + preview ----------------------------------------------------

const doveSelectMail = async function (id) {
    doveShowError(null);
    const request = { id: id };
    if (desktopDovecote.viewAsOwner) request.viewAsOwner = desktopDovecote.viewAsOwner;
    try {
        // dovecote_get_mail: modules/ws/handlers/250-dovecoteHandler.js (also marks the message read server-side)
        const result = await wsClient.sendMessage('dovecote_get_mail', request);
        desktopDovecote.selectedId = id;
        desktopDovecote.selectedMail = result && result.mail;
        desktopDovecote.allowRemoteImagesOnce = false;
        const found = desktopDovecote.mail.find((m) => String(m.id) === String(id));
        if (found) found.read = true;
        doveRenderMessageList();
        doveRenderInboxBadgeFromState();
        doveRenderPreview();
        doveRenderToolbarState();
        doveSetMobileMessageOpen(true);
    } catch (err) {
        doveShowError((err && err.message) || 'Could not open message');
    }
};

const doveRenderPreview = function () {
    const mail = desktopDovecote.selectedMail;
    desktopDovecoteEls.emptyHint.classList.toggle('hidden', !!mail);
    doveRenderOeHeaderInto(desktopDovecoteEls, mail);
    desktopDovecoteEls.safetyBar.classList.add('hidden');
    desktopDovecoteEls.imagesBar.classList.add('hidden');
    doveRenderPreviewBody();
};

const doveRenderPreviewBody = function () {
    const mail = desktopDovecote.selectedMail;
    doveRenderBodyInto(desktopDovecoteEls, mail, desktopDovecote.bodyView, {
        viewAsOwner: desktopDovecote.viewAsOwner,
        allowRemoteImages: desktopDovecote.allowRemoteImagesOnce,
        isStale: () => !desktopDovecote.selectedMail || !mail || desktopDovecote.selectedMail.id !== mail.id,
        onLoadImages: () => {
            desktopDovecote.allowRemoteImagesOnce = true;
            doveRenderBodyInto(desktopDovecoteEls, mail, 'rendered', {
                viewAsOwner: desktopDovecote.viewAsOwner,
                allowRemoteImages: true,
                isStale: () => !desktopDovecote.selectedMail || desktopDovecote.selectedMail.id !== mail.id
            });
        }
    });
};

// ---- Shared reading-pane rendering (main inline preview + standalone reader windows,
// doveOpenReaderWindow below) — els is { oeFrom, oeTo, oeSubject, oeDate, safetyBar,
// imagesBar, bodyWrap }. ----------------------------------------------------------------

const doveRenderOeHeaderInto = function (els, mail) {
    els.oeFrom.textContent = mail ? mail.from || '' : '';
    els.oeTo.textContent = mail ? mail.to || '' : '';
    els.oeSubject.textContent = mail ? (mail.subject || '(no subject)') : '';
    els.oeDate.textContent = mail ? doveFormatDate(mail.createdAt) : '';
};

// Plain text only: never innerHTML the raw body, it is untrusted and unsanitized here.
const doveRenderRawBodyInto = function (els, mail) {
    els.safetyBar.classList.add('hidden');
    els.imagesBar.classList.add('hidden');
    els.bodyWrap.querySelectorAll('iframe, pre.dovecote-raw-body').forEach((node) => node.remove());
    const pre = document.createElement('pre');
    pre.className = 'dovecote-raw-body';
    pre.textContent = mail.body || '';
    els.bodyWrap.appendChild(pre);
};

const doveSummarizeStrippedCounts = function (counts) {
    if (!counts) return '';
    const parts = [];
    Object.keys(counts).forEach((key) => {
        const value = counts[key];
        if (!value) return;
        const label = key.replace(/^tagsDropped:/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
        parts.push(value + ' ' + label);
    });
    return parts.join(', ');
};

// options: { viewAsOwner, allowRemoteImages, isStale(), onLoadImages() }
const doveRenderRenderedBodyInto = async function (els, mail, options) {
    const request = { id: mail.id };
    if (options.viewAsOwner) request.viewAsOwner = options.viewAsOwner;
    if (options.allowRemoteImages) request.allowRemoteImages = true;
    let result;
    try {
        // dovecote_render_body: modules/ws/handlers/250-dovecoteHandler.js — html is already fully
        // sanitized server-side. Never run any client-side sanitization or trust-adding logic here.
        result = await wsClient.sendMessage('dovecote_render_body', request);
    } catch (err) {
        doveShowError((err && err.message) || 'Could not render message body');
        return;
    }
    if (options.isStale && options.isStale()) return;

    const summary = doveSummarizeStrippedCounts(result.strippedCounts);
    els.safetyBar.classList.remove('hidden');
    els.safetyBar.textContent = '✓ Sanitized HTML' + (summary ? ' — ' + summary : '');

    const remoteImages = result.remoteImages || [];
    if (remoteImages.length > 0 && !options.allowRemoteImages) {
        doveRenderImagesBarInto(els, mail, options.onLoadImages);
    } else {
        els.imagesBar.classList.add('hidden');
    }

    els.bodyWrap.querySelectorAll('iframe, pre.dovecote-raw-body').forEach((node) => node.remove());
    const iframe = document.createElement('iframe');
    // allow-scripts must never be added: the server sanitizes HTML but an iframe that can execute
    // script would defeat that sanitization entirely. allow-popups only lets surviving <a target="_blank"> links open.
    iframe.setAttribute('sandbox', 'allow-popups');
    iframe.className = 'dovecote-body-frame';
    iframe.srcdoc = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'"></head><body>' + result.html + '</body></html>';
    els.bodyWrap.appendChild(iframe);
};

const doveRenderImagesBarInto = function (els, mail, onLoadImages) {
    const bar = els.imagesBar;
    bar.classList.remove('hidden');
    bar.replaceChildren();
    const text = document.createElement('span');
    text.textContent = 'Images are blocked.';
    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn-secondary btn-small';
    loadBtn.textContent = 'Load images';
    loadBtn.addEventListener('click', () => onLoadImages());
    const alwaysBtn = document.createElement('button');
    alwaysBtn.type = 'button';
    alwaysBtn.className = 'btn-secondary btn-small';
    alwaysBtn.textContent = 'Always load images from ' + (mail.from || 'sender');
    alwaysBtn.addEventListener('click', async () => {
        try {
            // dovecote_set_image_pref: modules/ws/handlers/250-dovecoteHandler.js
            await wsClient.sendMessage('dovecote_set_image_pref', { sender: mail.from, alwaysLoad: true });
            onLoadImages();
        } catch (err) {
            doveShowError((err && err.message) || 'Could not save image preference');
        }
    });
    bar.appendChild(text);
    bar.appendChild(loadBtn);
    bar.appendChild(alwaysBtn);
};

// bodyView: 'raw' | 'rendered'. options: see doveRenderRenderedBodyInto, minus onLoadImages
// defaults to re-rendering rendered+allowRemoteImages=true if the caller does not override it.
const doveRenderBodyInto = function (els, mail, bodyView, options) {
    els.bodyWrap.querySelectorAll('iframe, pre.dovecote-raw-body').forEach((node) => node.remove());
    if (!mail) return;
    if (bodyView === 'raw') {
        doveRenderRawBodyInto(els, mail);
    } else {
        doveRenderRenderedBodyInto(els, mail, options || {});
    }
};

// ---- Mailbox banner / read-only admin view -----------------------------------

const doveRenderMailboxBanner = function () {
    let banner = document.getElementById('desktopDovecoteMailboxBanner');
    const owner = desktopDovecote.viewAsOwner;
    if (!owner) {
        if (banner) banner.remove();
        return;
    }
    const box = desktopDovecote.mailboxes.find((b) => b.owner === owner);
    const labelText = (box && box.label) || owner;
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'dovecote-admin-banner';
        banner.id = 'desktopDovecoteMailboxBanner';
        const text = document.createElement('span');
        text.id = 'desktopDovecoteMailboxBannerText';
        const backLink = document.createElement('a');
        backLink.href = '#';
        backLink.textContent = 'Back to my mailbox';
        backLink.addEventListener('click', (ev) => {
            ev.preventDefault();
            doveSwitchMailbox(DESKTOP_DOVECOTE_HUMAN_OWNER);
        });
        banner.appendChild(text);
        banner.appendChild(backLink);
        desktopDovecoteEls.body.insertBefore(banner, desktopDovecoteEls.mainPane);
    }
    document.getElementById('desktopDovecoteMailboxBannerText').textContent = '👁 Viewing ' + labelText + "'s mailbox";
};

const doveRenderToolbarState = function () {
    const readOnly = !!desktopDovecote.viewAsOwner;
    desktopDovecoteEls.toolbar.querySelectorAll('[data-dove-mutating="true"]').forEach((btn) => {
        btn.disabled = readOnly;
    });
};

// ---- Mutations ---------------------------------------------------------------

const doveToggleRead = async function () {
    const mail = desktopDovecote.selectedMail;
    if (!mail || desktopDovecote.viewAsOwner) return;
    try {
        // dovecote_mark_mail: modules/ws/handlers/250-dovecoteHandler.js
        await wsClient.sendMessage('dovecote_mark_mail', { id: mail.id, read: !mail.read });
        mail.read = !mail.read;
        const found = desktopDovecote.mail.find((m) => String(m.id) === String(mail.id));
        if (found) found.read = mail.read;
        doveRenderMessageList();
        doveRenderInboxBadgeFromState();
    } catch (err) {
        doveShowError((err && err.message) || 'Could not update read state');
    }
};

const doveDeleteSelected = async function () {
    const mail = desktopDovecote.selectedMail;
    if (!mail || desktopDovecote.viewAsOwner) return;
    try {
        await wsClient.sendMessage('dovecote_mark_mail', { id: mail.id, deleted: true });
        desktopDovecote.selectedId = null;
        desktopDovecote.selectedMail = null;
        doveRenderPreview();
        doveLoadFolder(desktopDovecote.folder);
    } catch (err) {
        doveShowError((err && err.message) || 'Could not delete message');
    }
};

const doveArchiveSelected = async function () {
    const mail = desktopDovecote.selectedMail;
    if (!mail || desktopDovecote.viewAsOwner) return;
    try {
        await wsClient.sendMessage('dovecote_mark_mail', { id: mail.id, archived: true });
        desktopDovecote.selectedId = null;
        desktopDovecote.selectedMail = null;
        doveRenderPreview();
        doveLoadFolder(desktopDovecote.folder);
    } catch (err) {
        doveShowError((err && err.message) || 'Could not archive message');
    }
};

// ---- Compose: its own top-level window (desktopDovecoteCompose_*), not an overlay
// inside the main modal — doveComposeWindows (module-level Map) tracks the open ones,
// same pattern as guacSessionModals in guacRemote.js. ------------------------------

// mail: the message being replied to / forwarded (null for 'create'). presetTo: recipient
// picked from a Forward menu (doveMakeForwardMenuConfig), used only in 'forward' mode.
const doveOpenCompose = function (mode, mail, presetTo) {
    if (desktopDovecote.viewAsOwner) return;
    if (mode !== 'create' && !mail) return;

    let to = '';
    let subject = '';
    let body = '';
    let replyTo = null;
    if (mode === 'reply' || mode === 'replyAll') {
        // Only one recipient exists in this mail model, so Reply All behaves the same as Reply.
        to = mail.from || '';
        subject = /^re:/i.test(mail.subject || '') ? mail.subject : 'Re: ' + (mail.subject || '');
        replyTo = mail.id;
    } else if (mode === 'forward') {
        to = presetTo || '';
        subject = /^fwd:/i.test(mail.subject || '') ? mail.subject : 'Fwd: ' + (mail.subject || '');
        body = mail.body || '';
    }

    doveOpenComposeWindow({
        mode: mode,
        to: to,
        subject: subject,
        body: body,
        replyTo: replyTo,
        // Keys the window below — not sent to the server. 'create' always gets a fresh
        // window; reopening Reply/Forward on the same message raises the existing one.
        sourceMailId: mail ? mail.id : null
    });
};

const doveComposeWindowTitle = function (mode) {
    return mode === 'create' ? 'New Message' : (mode === 'forward' ? 'Forward Message' : 'Reply');
};

const doveComposeWindowKey = function (initial) {
    if (initial.mode === 'create') return 'create:' + (++doveComposeSeq);
    if (initial.mode === 'forward') return 'forward:' + initial.sourceMailId + ':' + initial.to;
    return initial.mode + ':' + initial.sourceMailId;
};

const doveOpenComposeWindow = function (initial) {
    const key = doveComposeWindowKey(initial);
    const existing = doveComposeWindows.get(key);
    if (existing) {
        doveShowWindow(existing);
        return;
    }
    const modal = doveBuildComposeWindow(key, initial);
    doveComposeWindows.set(key, modal);
    document.body.appendChild(modal);
    doveShowWindow(modal);
};

const doveBuildComposeWindow = function (key, initial) {
    const modalId = 'desktopDovecoteCompose_' + key.replace(/[^A-Za-z0-9_-]/g, '_');
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal resizeable-window dovecote-compose-window hidden';
    modal.dataset.windowIdentifier = 'desktopDovecoteCompose';
    modal.dataset.windowDefaultWidth = '480';
    modal.dataset.windowDefaultHeight = '520';
    modal.dataset.windowMinWidth = '360';
    modal.dataset.windowMinHeight = '360';
    modal.dataset.windowMaxWidth = '900';
    modal.dataset.windowMaxHeight = '1000';

    const closeCompose = () => {
        doveComposeWindows.delete(key);
        modal.remove();
    };
    modal.appendChild(doveBuildWindowTitle(doveComposeWindowTitle(initial.mode), 'fas fa-pen-to-square'));
    modal.appendChild(document.createElement('div')).className = 'modal-focus-overlay';
    modal.appendChild(doveBuildWindowControls(modal, closeCompose));

    const content = document.createElement('div');
    content.className = 'modal-content modal-padding dark';
    const body = document.createElement('div');
    body.className = 'modal-body';

    const titleEl = document.createElement('div');
    titleEl.className = 'dovecote-compose-title';
    titleEl.textContent = doveComposeWindowTitle(initial.mode);
    body.appendChild(titleEl);

    const toRow = document.createElement('div');
    toRow.className = 'form-row';
    const toLabel = document.createElement('label');
    toLabel.textContent = 'To';
    const toInput = document.createElement('input');
    toInput.type = 'text';
    toInput.className = 'form-control';
    toInput.value = initial.to;
    toRow.appendChild(toLabel);
    toRow.appendChild(toInput);
    body.appendChild(toRow);

    const subjectRow = document.createElement('div');
    subjectRow.className = 'form-row';
    const subjectLabel = document.createElement('label');
    subjectLabel.textContent = 'Subject';
    const subjectInput = document.createElement('input');
    subjectInput.type = 'text';
    subjectInput.className = 'form-control';
    subjectInput.value = initial.subject;
    subjectRow.appendChild(subjectLabel);
    subjectRow.appendChild(subjectInput);
    body.appendChild(subjectRow);

    const bodyTextarea = document.createElement('textarea');
    bodyTextarea.className = 'form-control dovecote-compose-body';
    bodyTextarea.value = initial.body;
    body.appendChild(bodyTextarea);

    const actions = document.createElement('div');
    actions.className = 'dovecote-compose-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeCompose);
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn-primary';
    sendBtn.textContent = 'Send';
    sendBtn.addEventListener('click', () => doveSendComposeWindow(toInput, subjectInput, bodyTextarea, initial.replyTo, closeCompose));
    actions.appendChild(cancelBtn);
    actions.appendChild(sendBtn);
    body.appendChild(actions);

    content.appendChild(body);
    modal.appendChild(content);
    requestAnimationFrame(() => toInput.focus());
    return modal;
};

const doveSendComposeWindow = async function (toInput, subjectInput, bodyTextarea, replyTo, onSent) {
    const to = toInput.value.trim();
    const subject = subjectInput.value.trim();
    const body = bodyTextarea.value;
    if (!to) {
        doveShowError('To is required');
        return;
    }
    try {
        // dovecote_send_mail: modules/ws/handlers/250-dovecoteHandler.js
        const request = { to: to, subject: subject, body: body, format: 'text' };
        if (replyTo) request.replyTo = replyTo;
        await wsClient.sendMessage('dovecote_send_mail', request);
        onSent();
        if (desktopDovecote.loaded) doveLoadFolder(desktopDovecote.folder);
    } catch (err) {
        doveShowError((err && err.message) || 'Could not send message');
    }
};

// ---- Reader: double-clicking a message (doveBuildMainPane's rows dblclick listener above)
// opens it in its own standalone window — same sandboxed rendering as the inline preview,
// with Reply/Reply All/Forward available from its own toolbar. ----------------------------

const doveBuildReaderToolbar = function (getMail) {
    const toolbar = document.createElement('div');
    toolbar.className = 'modal-window-title-toolbar';

    const replyGroup = document.createElement('div');
    replyGroup.className = 'button-group';
    const replyBtn = doveCreateButton('btn-secondary', 'Reply', 'fas fa-reply');
    replyBtn.dataset.doveReaderAction = 'reply';
    replyBtn.dataset.doveMutating = 'true';
    const replyAllBtn = doveCreateButton('btn-secondary', 'Reply All', 'fas fa-reply-all');
    replyAllBtn.dataset.doveReaderAction = 'replyAll';
    replyAllBtn.dataset.doveMutating = 'true';
    const forwardBtn = doveCreateButton('btn-secondary', 'Forward', 'fas fa-share');
    forwardBtn.dataset.doveMutating = 'true';
    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(forwardBtn, doveMakeForwardMenuConfig(getMail));
    replyGroup.appendChild(replyBtn);
    replyGroup.appendChild(replyAllBtn);
    replyGroup.appendChild(forwardBtn);
    toolbar.appendChild(replyGroup);

    const toggleReadBtn = doveCreateButton('btn-secondary', 'Toggle Read', 'fas fa-envelope-open');
    toggleReadBtn.dataset.doveReaderAction = 'toggleRead';
    toggleReadBtn.dataset.doveMutating = 'true';
    toolbar.appendChild(toggleReadBtn);

    const deleteBtn = doveCreateButton('btn-secondary', 'Delete', 'fas fa-trash');
    deleteBtn.dataset.doveReaderAction = 'delete';
    deleteBtn.dataset.doveMutating = 'true';
    toolbar.appendChild(deleteBtn);

    const archiveBtn = doveCreateButton('btn-secondary', 'Archive', 'fas fa-box-archive');
    archiveBtn.dataset.doveReaderAction = 'archive';
    archiveBtn.dataset.doveMutating = 'true';
    toolbar.appendChild(archiveBtn);

    return toolbar;
};

const doveOpenReaderWindow = function (id) {
    const key = String(id);
    const existing = doveReaderWindows.get(key);
    if (existing) {
        doveShowWindow(existing.modal);
        return;
    }
    const state = doveBuildReaderWindow(key);
    doveReaderWindows.set(key, state);
    document.body.appendChild(state.modal);
    doveShowWindow(state.modal);
    doveLoadReaderMail(state, key);
};

const doveBuildReaderWindow = function (key) {
    const modalId = 'desktopDovecoteReader_' + key.replace(/[^A-Za-z0-9_-]/g, '_');
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal resizeable-window dovecote-reader-window hidden';
    modal.dataset.windowIdentifier = 'desktopDovecoteReader';
    modal.dataset.windowDefaultWidth = '640';
    modal.dataset.windowDefaultHeight = '560';
    modal.dataset.windowMinWidth = '380';
    modal.dataset.windowMinHeight = '320';
    modal.dataset.windowMaxWidth = '1400';
    modal.dataset.windowMaxHeight = '1000';

    const state = { modal: modal, els: null, mail: null, bodyView: 'rendered', allowRemoteImagesOnce: false, closed: false };
    const getMail = () => state.mail;

    const closeReader = () => {
        state.closed = true;
        doveReaderWindows.delete(key);
        modal.remove();
    };
    const toolbar = doveBuildReaderToolbar(getMail);
    modal.appendChild(doveBuildWindowTitle('Message', 'fas fa-envelope-open'));
    modal.querySelector('.modal-window-title').appendChild(toolbar);
    modal.appendChild(document.createElement('div')).className = 'modal-focus-overlay';
    modal.appendChild(doveBuildWindowControls(modal, closeReader));

    const content = document.createElement('div');
    content.className = 'modal-content modal-padding dark';
    const body = document.createElement('div');
    body.className = 'modal-body';

    const header = document.createElement('div');
    header.className = 'dovecote-oe-header';
    const fieldEls = {};
    ['from', 'to', 'subject', 'date'].forEach((field) => {
        const row = document.createElement('div');
        row.className = 'dovecote-oe-header-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'dovecote-oe-header-label';
        labelEl.textContent = field.charAt(0).toUpperCase() + field.slice(1) + ':';
        const valueEl = document.createElement('span');
        valueEl.className = 'dovecote-oe-header-value';
        row.appendChild(labelEl);
        row.appendChild(valueEl);
        header.appendChild(row);
        fieldEls[field] = valueEl;
    });
    body.appendChild(header);

    const safetyBar = document.createElement('div');
    safetyBar.className = 'dovecote-safety-bar hidden';
    body.appendChild(safetyBar);

    const imagesBar = document.createElement('div');
    imagesBar.className = 'dovecote-images-bar hidden';
    body.appendChild(imagesBar);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'dovecote-body-wrap';
    const loadingHint = document.createElement('p');
    loadingHint.className = 'form-hint dovecote-empty-hint';
    loadingHint.textContent = 'Loading…';
    bodyWrap.appendChild(loadingHint);
    body.appendChild(bodyWrap);

    content.appendChild(body);
    modal.appendChild(content);

    state.els = {
        oeFrom: fieldEls.from,
        oeTo: fieldEls.to,
        oeSubject: fieldEls.subject,
        oeDate: fieldEls.date,
        safetyBar: safetyBar,
        imagesBar: imagesBar,
        bodyWrap: bodyWrap,
        loadingHint: loadingHint
    };

    toolbar.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-dove-reader-action]');
        if (!btn) return;
        doveDispatchReaderAction(state, btn.dataset.doveReaderAction);
    });

    return modal;
};

const doveLoadReaderMail = async function (state, id) {
    const request = { id: id };
    if (desktopDovecote.viewAsOwner) request.viewAsOwner = desktopDovecote.viewAsOwner;
    try {
        // dovecote_get_mail: modules/ws/handlers/250-dovecoteHandler.js (also marks the message read server-side)
        const result = await wsClient.sendMessage('dovecote_get_mail', request);
        if (state.closed) return;
        state.mail = result && result.mail;
        const found = desktopDovecote.mail.find((m) => String(m.id) === String(id));
        if (found) found.read = true;
        doveRenderMessageList();
        doveRenderInboxBadgeFromState();
        doveRenderToolbarState();
        doveRenderReaderWindow(state);
    } catch (err) {
        if (state.closed) return;
        state.els.loadingHint.textContent = (err && err.message) || 'Could not open message';
    }
};

const doveRenderReaderWindow = function (state) {
    const mail = state.mail;
    if (!mail) return;
    doveSetWindowTitle(state.modal, mail.subject || '(no subject)', 'fas fa-envelope-open');
    doveRenderOeHeaderInto(state.els, mail);
    state.els.loadingHint.remove();
    doveRenderReaderToolbarState(state);
    doveRenderReaderBody(state);
};

const doveRenderReaderBody = function (state) {
    const mail = state.mail;
    doveRenderBodyInto(state.els, mail, state.bodyView, {
        viewAsOwner: desktopDovecote.viewAsOwner,
        allowRemoteImages: state.allowRemoteImagesOnce,
        isStale: () => state.closed,
        onLoadImages: () => {
            state.allowRemoteImagesOnce = true;
            doveRenderBodyInto(state.els, mail, 'rendered', {
                viewAsOwner: desktopDovecote.viewAsOwner,
                allowRemoteImages: true,
                isStale: () => state.closed
            });
        }
    });
};

// Read-only admin view (desktopDovecote.viewAsOwner) disables mutating actions the same
// way the main toolbar does — called again by doveSwitchMailbox below when it changes.
const doveRenderReaderToolbarState = function (state) {
    const readOnly = !!desktopDovecote.viewAsOwner;
    state.modal.querySelectorAll('[data-dove-mutating="true"]').forEach((btn) => {
        btn.disabled = readOnly;
    });
};

const doveDispatchReaderAction = function (state, action) {
    const mail = state.mail;
    if (!mail) return;
    switch (action) {
        case 'reply': doveOpenCompose('reply', mail); return;
        case 'replyAll': doveOpenCompose('replyAll', mail); return;
        case 'toggleRead': doveReaderToggleRead(state); return;
        case 'delete': doveReaderMarkSelected(state, { deleted: true }); return;
        case 'archive': doveReaderMarkSelected(state, { archived: true }); return;
        default: return;
    }
};

const doveReaderToggleRead = async function (state) {
    const mail = state.mail;
    if (!mail || desktopDovecote.viewAsOwner) return;
    try {
        // dovecote_mark_mail: modules/ws/handlers/250-dovecoteHandler.js
        await wsClient.sendMessage('dovecote_mark_mail', { id: mail.id, read: !mail.read });
        mail.read = !mail.read;
        const found = desktopDovecote.mail.find((m) => String(m.id) === String(mail.id));
        if (found) found.read = mail.read;
        doveRenderMessageList();
        doveRenderInboxBadgeFromState();
    } catch (err) {
        doveShowError((err && err.message) || 'Could not update read state');
    }
};

const doveReaderMarkSelected = async function (state, patch) {
    const mail = state.mail;
    if (!mail || desktopDovecote.viewAsOwner) return;
    try {
        await wsClient.sendMessage('dovecote_mark_mail', Object.assign({ id: mail.id }, patch));
        if (desktopDovecote.selectedId && String(desktopDovecote.selectedId) === String(mail.id)) {
            desktopDovecote.selectedId = null;
            desktopDovecote.selectedMail = null;
            doveRenderPreview();
        }
        if (desktopDovecote.loaded) doveLoadFolder(desktopDovecote.folder);
        state.modal.querySelector('.modal-window-controls .close-btn').click();
    } catch (err) {
        doveShowError((err && err.message) || 'Could not update message');
    }
};

// ---- Tray icon (#dovecoteTrayIcon, public/app.html) ------------------------------
// Same pattern as #directorTrayIcon (public/scripts/comp/director.js): hidden by
// default, revealed by systemTrayManager.js's staggered boot sequence, shows/hides
// live from here afterward. Unlike Director's state icon, this one carries a plain
// unread-count badge, hidden entirely at zero.

let doveTrayInitialized = false;

// options: { reveal } — same two-phase boot convention as updateFixedCreditsIndicator
// (public/scripts/comp/trayIndicators.js): reveal:false sets state without showing,
// reveal:true (or omitted, post-boot) shows/hides for real.
const doveApplyTrayBadge = function (unread, options) {
    const icon = document.getElementById('dovecoteTrayIcon');
    const badge = document.getElementById('dovecoteTrayBadge');
    if (!icon || !badge) return;
    const opts = options || {};
    // isDesktopTrayBootPending: public/scripts/comp/trayIndicators.js
    const reveal = opts.reveal !== false && !isDesktopTrayBootPending();
    if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.remove('hidden');
        icon.title = 'Dovecote — ' + unread + ' unread';
        icon.classList.toggle('hidden', !reveal);
    } else {
        badge.classList.add('hidden');
        icon.title = 'Dovecote';
        icon.classList.add('hidden');
    }
};

const doveRefreshTrayUnread = async function (options) {
    try {
        // dovecote_list_mailboxes: modules/ws/handlers/250-dovecoteHandler.js
        const result = await wsClient.sendMessage('dovecote_list_mailboxes', {}, false);
        const mailboxes = (result && result.mailboxes) || [];
        const mine = mailboxes.find((box) => box.owner === DESKTOP_DOVECOTE_HUMAN_OWNER);
        doveApplyTrayBadge(mine ? (mine.unread || 0) : 0, options);
    } catch (_) {
        // Non-critical background refresh.
    }
};

// Keeps the tray badge live whenever the main window already has the human's own inbox
// unread count in hand, without an extra round trip — doveLoadFolder('inbox') and
// doveRefreshInboxBadgeOnly both land here, same as doveRenderInboxBadge.
const doveRenderInboxBadgeFromState = function () {
    if (desktopDovecote.viewAsOwner) return;
    const mail = desktopDovecote.folder === 'inbox' ? desktopDovecote.mail : null;
    if (mail) {
        doveApplyTrayBadge(mail.filter((m) => !m.read).length);
    } else {
        doveRefreshTrayUnread();
    }
};

// Called from startBackgroundTrayServices (systemTrayManager.js)
function initializeDovecoteTray() {
    const icon = document.getElementById('dovecoteTrayIcon');
    if (!icon || doveTrayInitialized) return;
    doveTrayInitialized = true;
    icon.addEventListener('click', (e) => {
        e.preventDefault();
        openDesktopDovecote();
    });
    doveRefreshTrayUnread({ reveal: false });
}
