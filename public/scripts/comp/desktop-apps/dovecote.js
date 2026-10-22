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
    { id: 'spam', label: 'Spam', icon: 'fas fa-ban' },
    { id: 'outbox', label: 'Outbox', icon: 'fas fa-paper-plane' },
    { id: 'sent', label: 'Sent Items', icon: 'fas fa-check-double' },
    { id: 'deleted', label: 'Deleted Items', icon: 'fas fa-trash' },
    { id: 'archive', label: 'Archive', icon: 'fas fa-box-archive' }
];

// The folder tree (Windows Mail's Folder Bar drop-down, doveBuildFolderBar): Local Folders is
// the human's own mailbox; the bot mailboxes sit where Windows Mail keeps Microsoft Communities.
const DOVE_LOCAL_FOLDERS_LABEL = 'Local Folders';
const DOVE_COMMUNITIES_LABEL = 'Dreamscape Communities';

// Keep in sync with modules/dovecoteMail.js MAX_ATTACHMENT_BYTES / MAX_TOTAL_ATTACHMENT_BYTES —
// client-side limits are only a fast, friendly check; the server enforces these for real.
const DOVE_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const DOVE_MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// { folder, sortKey, sortDir, viewAsOwner, mail: [], selectedId, selectedIds, mailboxes: [],
//   bodyView, searchText, mobileMessageOpen, nextCursor, hasMore, folderTotal, folderUnread }
const desktopDovecote = {
    loaded: false,
    folder: 'inbox',
    sortKey: 'createdAt',
    sortDir: 'desc',
    viewAsOwner: null,
    mail: [],
    mailboxes: [],
    selectedId: null,
    selectedIds: [],
    anchorId: null,
    selectedMail: null,
    bodyView: 'rendered',
    inboxUnread: 0,
    folderTotal: 0,
    folderUnread: 0,
    nextCursor: null,
    hasMore: false,
    loadingMore: false,
    touchMulti: false,
    allowRemoteImagesOnce: false,
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

// Display-only address style: mailboxes are stored/sent as bare names (yukimi, menma);
// the UI shows them as name@dream.co.jp. doveBareAddress strips the suffix back off input.
const DOVE_ADDRESS_DOMAIN = '@dream.co.jp';
const doveDisplayAddress = function (name) {
    const bare = String(name || '').trim();
    if (!bare) return '';
    return bare.includes('@') ? bare : bare + DOVE_ADDRESS_DOMAIN;
};
// `to` / `cc` are arrays on new mail and a single name on older rows.
const doveFormatAddressList = function (value) {
    const list = Array.isArray(value) ? value : String(value || '').split(',');
    return list.map((name) => doveDisplayAddress(String(name).trim())).filter(Boolean).join(', ');
};
const DOVE_ROUTE_TOOLTIP = {
    internal: 'Internal and trusted. Delivered inside the Dreamscape network and never left it.',
    inbound: 'Arrived from the internet through the mail gateway.',
    outbound: 'Sent to the internet through the mail gateway.'
};
const doveNormalizeRoute = function (route) {
    return route === 'inbound' || route === 'outbound' ? route : 'internal';
};
const doveRouteIconClass = function (route) {
    if (route === 'inbound') return 'fas fa-globe dovecote-route-icon';
    if (route === 'outbound') return 'fas fa-arrow-up-right-from-square dovecote-route-icon';
    return 'fas fa-shield-halved dovecote-route-icon';
};
const doveBuildRouteIcon = function (route) {
    const kind = doveNormalizeRoute(route);
    const icon = document.createElement('i');
    icon.className = doveRouteIconClass(kind);
    icon.dataset.doveRoute = kind;
    icon.title = DOVE_ROUTE_TOOLTIP[kind];
    icon.setAttribute('aria-label', DOVE_ROUTE_TOOLTIP[kind]);
    return icon;
};
const doveFillRouteSlot = function (slot, route) {
    if (!slot) return;
    slot.replaceChildren(doveBuildRouteIcon(route));
};

const doveBareAddress = function (value) {
    return String(value || '').split(',').map((part) => {
        const t = part.trim();
        return t.toLowerCase().endsWith(DOVE_ADDRESS_DOMAIN) ? t.slice(0, -DOVE_ADDRESS_DOMAIN.length) : t;
    }).filter(Boolean).join(', ');
};

const doveIsBotOwner = function (owner) {
    return owner !== DESKTOP_DOVECOTE_HUMAN_OWNER;
};

const doveSelectedIdSet = function () {
    return new Set(desktopDovecote.selectedIds.map(String));
};

const doveSelectedCount = function () {
    return desktopDovecote.selectedIds.length;
};

const doveSelectedMailRows = function () {
    const ids = doveSelectedIdSet();
    return doveFilteredSortedMail().filter((mail) => ids.has(String(mail.id)));
};

const doveClearSelection = function () {
    desktopDovecote.selectedIds = [];
    desktopDovecote.selectedId = null;
    desktopDovecote.anchorId = null;
    desktopDovecote.selectedMail = null;
    desktopDovecote.touchMulti = false;
};

const doveSetSelectedIds = function (ids, focusId) {
    const unique = [];
    const seen = new Set();
    (ids || []).forEach((id) => {
        const text = String(id || '');
        if (!text || seen.has(text)) return;
        seen.add(text);
        unique.push(text);
    });
    desktopDovecote.selectedIds = unique;
    desktopDovecote.selectedId = focusId ? String(focusId) : (unique[unique.length - 1] || null);
};

const doveHasModifierSelect = function (ev) {
    return !!(ev && (ev.ctrlKey || ev.metaKey));
};

// Shared title bar builder for the compose, reader and attachment windows (ensureDesktopDovecoteModal
// builds its own inline, since it also carries the main toolbar). Their caption and taskbar image
// is Dovecote's: data-icon-owner-id -> ensureModalApplicationIcon (modalUtils.js) on openModal.
const doveBuildWindowTitle = function (text, iconClass) {
    const title = document.createElement('div');
    title.className = 'modal-window-title';
    const titleMain = document.createElement('div');
    titleMain.className = 'modal-window-title-main';
    const titleIcon = document.createElement('i');
    titleIcon.className = iconClass + ' icon-fa';
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
    const iconClassName = iconClass + ' icon-fa';
    if (titleText.textContent === text && titleIcon.className === iconClassName) return;
    titleText.textContent = text;
    titleIcon.className = iconClassName;
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
    modal.className = 'modal resizeable-window hidden';
    modal.dataset.windowClient = 'light';
    modal.dataset.windowIdentifier = 'desktopDovecote';
    modal.dataset.windowDefaultWidth = '760';
    modal.dataset.windowDefaultHeight = '520';
    modal.dataset.windowMinWidth = '360';
    modal.dataset.windowMinHeight = '320';
    modal.dataset.windowMaxWidth = '1400';
    modal.dataset.windowMaxHeight = '1000';

    // Caption: Windows Mail's icon and "<Folder> - Dovecote" (doveRenderFolderButton); the
    // toolbar lives in the client, as in Windows Mail (#473).
    const title = document.createElement('div');
    title.className = 'modal-window-title';
    const titleMain = document.createElement('div');
    titleMain.className = 'modal-window-title-main';
    const titleIcon = document.createElement('i');
    titleIcon.className = 'fas fa-envelope icon-fa';
    titleIcon.setAttribute('aria-hidden', 'true');
    const titleImage = document.createElement('img');
    titleImage.className = 'icon-image';
    titleImage.alt = '';
    titleImage.src = '/static_images/app_icons/48/vista-mail.webp';
    const titleText = document.createElement('span');
    titleText.textContent = 'Inbox - Dovecote';
    titleMain.appendChild(titleIcon);
    titleMain.appendChild(titleImage);
    titleMain.appendChild(titleText);
    title.appendChild(titleMain);

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

    // Vista light client with 7.css controls (#444), laid out as Windows Mail (#473): menu band
    // with the search box, the blue command bar, the Folder Bar, list + preview, status bar.
    const content = document.createElement('div');
    content.className = 'modal-content win7 dovecote-client';
    const menuBar = doveBuildMenuBar();
    const toolbar = doveBuildToolbar();
    const folderBar = doveBuildFolderBar();
    const body = document.createElement('div');
    body.className = 'modal-body';

    body.appendChild(doveBuildMainPane());

    content.appendChild(menuBar);
    content.appendChild(toolbar);
    content.appendChild(folderBar);
    content.appendChild(body);
    content.appendChild(doveBuildStatusBar());
    modal.appendChild(title);
    modal.appendChild(focusOverlay);
    modal.appendChild(controls);
    modal.appendChild(content);
    document.body.appendChild(modal);

    desktopDovecoteEls = {
        modal: modal,
        titleText: titleText,
        toolbar: toolbar,
        menuBar: menuBar,
        folderBar: folderBar,
        body: body
    };
    doveCacheEls();
    doveWireEvents();
    doveRenderMailboxBanner();
    doveRenderFolderButton();
    doveRenderToolbarState();
    return modal;
};

// ---- Command bar: Windows Mail's blue toolbar (#473) ------------------------------
// Plain buttons: a Font Awesome glyph for the classic theme, and Windows Mail's own 16px art
// on the Vista desktop, painted from data-dove-icon (dovecote.css, static_images/vista-mail/).
// data-dove-mutating: disabled in the read-only admin view (viewAsOwner set);
// data-dove-needs-mail: disabled while no message is selected (doveRenderToolbarState).

const doveCreateCommand = function (iconKey, title, iconClass, label) {
    const button = doveCreateButton('btn-secondary dovecote-cmd', title, iconClass);
    button.dataset.doveIcon = iconKey;
    if (label) {
        const text = document.createElement('span');
        text.className = 'dovecote-cmd-label';
        text.textContent = label;
        button.appendChild(text);
    }
    return button;
};

const doveCreateCommandSeparator = function () {
    const sep = document.createElement('span');
    sep.className = 'dovecote-cmd-sep';
    sep.setAttribute('aria-hidden', 'true');
    return sep;
};

const doveBuildToolbar = function () {
    const toolbar = document.createElement('div');
    toolbar.className = 'dovecote-command-bar';
    toolbar.setAttribute('role', 'toolbar');

    const createBtn = doveCreateCommand('create', 'Create Mail', 'fas fa-pen-to-square', 'Create Mail');
    createBtn.dataset.doveAction = 'create';
    createBtn.dataset.doveMutating = 'true';
    toolbar.appendChild(createBtn);

    const replyBtn = doveCreateCommand('reply', 'Reply', 'fas fa-reply', 'Reply');
    replyBtn.dataset.doveAction = 'reply';
    const replyAllBtn = doveCreateCommand('replyAll', 'Reply All', 'fas fa-reply-all', 'Reply All');
    replyAllBtn.dataset.doveAction = 'replyAll';
    // Forward opens a mailbox picker (doveForwardMenuConfig) instead of a plain data-dove-action.
    const forwardBtn = doveCreateCommand('forward', 'Forward', 'fas fa-share', 'Forward');
    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(forwardBtn, doveForwardMenuConfig);
    [replyBtn, replyAllBtn, forwardBtn].forEach((btn) => {
        btn.dataset.doveMutating = 'true';
        btn.dataset.doveNeedsMail = 'true';
        toolbar.appendChild(btn);
    });

    toolbar.appendChild(doveCreateCommandSeparator());

    const toggleReadBtn = doveCreateCommand('read', 'Mark as Read / Unread', 'fas fa-envelope-open');
    toggleReadBtn.dataset.doveAction = 'toggleRead';
    const deleteBtn = doveCreateCommand('delete', 'Delete', 'fas fa-trash');
    deleteBtn.dataset.doveAction = 'delete';
    const archiveBtn = doveCreateCommand('archive', 'Move to Archive', 'fas fa-box-archive');
    archiveBtn.dataset.doveAction = 'archive';
    const spamBtn = doveCreateCommand('spam', 'Move to Spam', 'fas fa-ban');
    spamBtn.dataset.doveAction = 'spam';
    const notSpamBtn = doveCreateCommand('notSpam', 'Not spam', 'fas fa-inbox');
    notSpamBtn.dataset.doveAction = 'notSpam';
    const restoreBtn = doveCreateCommand('restore', 'Restore', 'fas fa-inbox');
    restoreBtn.dataset.doveAction = 'restore';
    [toggleReadBtn, deleteBtn, restoreBtn, archiveBtn, spamBtn, notSpamBtn].forEach((btn) => {
        btn.dataset.doveMutating = 'true';
        btn.dataset.doveNeedsMail = 'true';
        toolbar.appendChild(btn);
    });

    const selectedCount = document.createElement('span');
    selectedCount.id = 'desktopDovecoteSelectedCount';
    selectedCount.className = 'indicator';
    selectedCount.dataset.state = 'off';
    selectedCount.title = 'Selected messages';
    selectedCount.textContent = '0';
    toolbar.appendChild(selectedCount);

    toolbar.appendChild(doveCreateCommandSeparator());

    // Windows Mail's Send/Receive: reloads the open folder.
    const refreshBtn = doveCreateCommand('sendReceive', 'Send/Receive', 'fas fa-rotate', 'Send/Receive');
    refreshBtn.dataset.doveAction = 'refresh';
    toolbar.appendChild(refreshBtn);

    // No toolbar click listener: doveWireEvents' modal-wide delegate (doveHandleBodyClick)
    // already sees these clicks. A second listener here made every data-dove-action fire twice
    // (two compose windows).
    return toolbar;
};

// ---- Menu band: Windows Mail's menu bar, the search box at its right ---------------
// Each title opens a click menu (contextMenu.attachClickMenuToElement) rebuilt on every open,
// so enabled/checked states follow the selection, sort, folder and mailbox.

const doveMenuItem = function (text, menuAction, extra) {
    return Object.assign({ text: text, action: 'dove-menu', doveMenu: menuAction }, extra || {});
};

const doveMenuSelection = function () {
    const rows = doveSelectedMailRows();
    const count = rows.length;
    const one = count === 1 ? rows[0] : null;
    const anyUnread = rows.some((mail) => !mail.read);
    const inDeleted = desktopDovecote.folder === 'deleted' || rows.some((mail) => mail.folder === 'deleted');
    const inSpam = rows.length > 0 && rows.every((mail) => mail.folder === 'spam');
    const anyNotSpam = rows.some((mail) => mail.folder !== 'spam');
    return { rows, count, one, anyUnread, inDeleted, inSpam, anyNotSpam };
};

const DOVE_MENUS = {
    file: () => {
        const sel = doveMenuSelection();
        const readOnly = !!desktopDovecote.viewAsOwner;
        return [
            doveMenuItem('New Message', 'create', { disabled: readOnly }),
            doveMenuItem('Open', 'open', { disabled: sel.count !== 1 }),
            { separator: true },
            doveMenuItem('Close', 'close')
        ];
    },
    edit: () => {
        const sel = doveMenuSelection();
        const off = !sel.count || !!desktopDovecote.viewAsOwner;
        return [
            doveMenuItem('Select All', 'selectAll'),
            { separator: true },
            doveMenuItem(sel.inDeleted ? 'Delete Permanently' : 'Delete', 'delete', { disabled: off }),
            doveMenuItem('Restore', 'restore', { disabled: off || !sel.inDeleted }),
            doveMenuItem(sel.anyUnread ? 'Mark as Read' : 'Mark as Unread', 'toggleRead', { disabled: off }),
            doveMenuItem('Mark as Read', 'markRead', { disabled: off || !sel.anyUnread }),
            doveMenuItem('Mark as Unread', 'markUnread', { disabled: off || !sel.rows.some((mail) => mail.read) }),
            doveMenuItem('Move to Archive', 'archive', { disabled: off }),
            doveMenuItem('Move to Spam', 'spam', { disabled: off || !sel.anyNotSpam }),
            doveMenuItem('Not spam', 'notSpam', { disabled: off || !sel.inSpam }),
            { separator: true },
            doveMenuItem('Find', 'find')
        ];
    },
    tools: () => [
        doveMenuItem('Options...', 'options')
    ],
    view: () => {
        const sortItems = [['from', 'From'], ['subject', 'Subject'], ['createdAt', 'Received']].map(([key, text]) => (
            doveMenuItem(text, 'sort', { doveSortKey: key, showIndicator: true, indicatorMark: 'radio', checked: desktopDovecote.sortKey === key })
        ));
        const folderItems = DESKTOP_DOVECOTE_FOLDERS.map((folder) => (
            doveMenuItem(folder.label, 'folder', { doveFolderId: folder.id, showIndicator: true, indicatorMark: 'radio', checked: desktopDovecote.folder === folder.id })
        ));
        return [
            { text: 'Sort By', submenu: sortItems },
            { text: 'Go to Folder', submenu: folderItems },
            { separator: true },
            doveMenuItem('Message in HTML', 'html', { showIndicator: true, checked: desktopDovecote.bodyView === 'rendered' }),
            { separator: true },
            doveMenuItem('Refresh', 'refresh')
        ];
    },
    message: () => {
        const sel = doveMenuSelection();
        const readOnly = !!desktopDovecote.viewAsOwner;
        const others = doveOtherMailboxes();
        return [
            doveMenuItem('New Message', 'create', { disabled: readOnly }),
            { separator: true },
            doveMenuItem('Reply to Sender', 'reply', { disabled: readOnly || sel.count !== 1 }),
            doveMenuItem('Reply to All', 'replyAll', { disabled: readOnly || sel.count !== 1 }),
            {
                text: sel.count > 1 ? 'Forward ' + sel.count + ' Messages' : 'Forward',
                disabled: readOnly || !sel.count || !others.length,
                submenu: others.map((box) => doveMenuItem(box.label, 'forward', { doveOwner: box.owner }))
            }
        ];
    }
};

const doveRunMenuAction = function (item) {
    const sel = doveMenuSelection();
    switch (item.doveMenu) {
        case 'open': if (sel.one) doveOpenReaderWindow(sel.one.id); return;
        // closeModal: public/scripts/comp/modalUtils.js
        case 'close': closeModal(desktopDovecoteEls.modal); return;
        case 'find': desktopDovecoteEls.searchInput.focus(); return;
        case 'sort': doveSetSort(item.doveSortKey); return;
        case 'folder': doveOpenTreeFolder(desktopDovecote.viewAsOwner || DESKTOP_DOVECOTE_HUMAN_OWNER, item.doveFolderId); return;
        case 'html': doveSetBodyView(desktopDovecote.bodyView === 'rendered' ? 'raw' : 'rendered'); return;
        case 'options':
            // cplMail.open: public/scripts/comp/cplMail.js — Control Panel Mail
            if (window.cplMail) cplMail.open();
            return;
        case 'forward': doveForwardSelected(item.doveOwner); return;
        case 'selectAll': doveSelectAllVisible(); return;
        default: doveDispatchAction(item.doveMenu);
    }
};

const doveBuildMenuBar = function () {
    const bar = document.createElement('div');
    bar.className = 'dovecote-menubar';
    const menus = document.createElement('div');
    menus.className = 'dovecote-menus';
    menus.setAttribute('role', 'menubar');
    [['file', 'File'], ['edit', 'Edit'], ['view', 'View'], ['tools', 'Tools'], ['message', 'Message']].forEach(([key, text]) => {
        const title = document.createElement('button');
        title.type = 'button';
        title.className = 'dovecote-menu-title';
        title.setAttribute('role', 'menuitem');
        title.textContent = text;
        // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
        contextMenu.attachClickMenuToElement(title, {
            onAction: (action, target, item) => doveRunMenuAction(item),
            sections: [{ type: 'list', initfn: (section) => { section.items = DOVE_MENUS[key](); } }]
        });
        menus.appendChild(title);
    });
    bar.appendChild(menus);
    bar.appendChild(doveBuildSearchBox());
    return bar;
};

// Inline live filter (#1): Windows Mail's search box, always visible; it filters the message
// list as you type.
const doveBuildSearchBox = function () {
    const searchGroup = document.createElement('div');
    searchGroup.className = 'button-group';
    searchGroup.id = 'desktopDovecoteSearchGroup';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'form-control';
    searchInput.id = 'desktopDovecoteSearchInput';
    searchInput.placeholder = 'Search';
    searchInput.title = 'Filter subject, from, snippet';
    searchGroup.appendChild(searchInput);
    const searchIcon = document.createElement('i');
    searchIcon.className = 'fas fa-magnifying-glass dovecote-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchGroup.appendChild(searchIcon);
    searchInput.addEventListener('input', () => {
        desktopDovecote.searchText = searchInput.value;
        doveRenderMessageList();
    });
    return searchGroup;
};

// ---- Folder Bar: Windows Mail's View > Layout > Folder Bar with the Folder List off ----------
// No folder sidebar (Yukimi #473: "keep that a dropdown menu"): the bar's title drops down the
// folder tree, as in Windows Mail. Local Folders is the human's own mailbox; the bot mailboxes
// sit where Windows Mail keeps Microsoft Communities (Yukimi #473) and open in the read-only
// admin view (doveSwitchMailbox). The tree is our own small panel, not a context menu.

const doveBuildFolderBar = function () {
    const bar = document.createElement('div');
    bar.className = 'dovecote-folder-bar';
    bar.appendChild(doveBuildFolderButton());
    const tree = document.createElement('div');
    tree.className = 'dovecote-folder-tree hidden';
    tree.id = 'desktopDovecoteFolderTree';
    tree.setAttribute('role', 'tree');
    tree.addEventListener('click', (ev) => {
        const row = ev.target.closest('[data-dove-tree-owner]');
        if (!row) return;
        doveToggleFolderTree(false);
        doveOpenTreeFolder(row.dataset.doveTreeOwner, row.dataset.doveTreeFolder || 'inbox');
    });
    bar.appendChild(tree);
    return bar;
};

const doveBuildFolderButton = function () {
    const button = doveCreateButton('dovecote-folder-btn', 'Folder', DESKTOP_DOVECOTE_FOLDERS[0].icon);
    button.id = 'desktopDovecoteFolderBtn';
    button.dataset.doveFolder = DESKTOP_DOVECOTE_FOLDERS[0].id;
    button.setAttribute('aria-haspopup', 'tree');
    button.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'dovecote-folder-btn-label';
    label.textContent = DESKTOP_DOVECOTE_FOLDERS[0].label;
    button.appendChild(label);
    const chevron = document.createElement('span');
    chevron.className = 'dovecote-folder-btn-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    button.appendChild(chevron);
    // Inbox unread badge (classic theme; the Vista tree shows the count instead);
    // doveRenderInboxBadge fills it.
    const badge = document.createElement('span');
    badge.className = 'dovecote-unread-badge hidden';
    button.appendChild(badge);
    button.addEventListener('click', () => doveToggleFolderTree());
    return button;
};

let doveFolderTreeDismiss = null;

const doveToggleFolderTree = function (force) {
    const tree = document.getElementById('desktopDovecoteFolderTree');
    const button = document.getElementById('desktopDovecoteFolderBtn');
    if (!tree || !button) return;
    const open = force === undefined ? tree.classList.contains('hidden') : !!force;
    tree.classList.toggle('hidden', !open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (doveFolderTreeDismiss) {
        document.removeEventListener('pointerdown', doveFolderTreeDismiss, true);
        document.removeEventListener('keydown', doveFolderTreeDismiss, true);
        doveFolderTreeDismiss = null;
    }
    if (!open) return;
    doveRenderFolderTree();
    // Fresh unread counts for every mailbox; doveRefreshMailboxes re-renders the open tree.
    doveRefreshMailboxes();
    doveFolderTreeDismiss = (ev) => {
        if (ev.type === 'keydown') {
            if (ev.key === 'Escape') doveToggleFolderTree(false);
            return;
        }
        if (!tree.contains(ev.target) && !button.contains(ev.target)) doveToggleFolderTree(false);
    };
    document.addEventListener('pointerdown', doveFolderTreeDismiss, true);
    document.addEventListener('keydown', doveFolderTreeDismiss, true);
};

// opts: { level, label, icon, owner, folder, count, expander: 'open' | 'closed', current }
const doveBuildTreeRow = function (opts) {
    const row = document.createElement('div');
    row.className = 'dovecote-tree-row dovecote-tree-level-' + opts.level;
    row.setAttribute('role', 'treeitem');
    if (opts.owner) row.dataset.doveTreeOwner = opts.owner;
    if (opts.folder) row.dataset.doveTreeFolder = opts.folder;
    const expander = document.createElement('span');
    expander.className = 'dovecote-tree-expander';
    if (opts.expander) {
        expander.dataset.state = opts.expander;
        row.setAttribute('aria-expanded', opts.expander === 'open' ? 'true' : 'false');
    }
    row.appendChild(expander);
    const icon = document.createElement('span');
    icon.className = 'dovecote-tree-icon';
    icon.dataset.doveTreeIcon = opts.icon;
    row.appendChild(icon);
    const label = document.createElement('span');
    label.className = 'dovecote-tree-label';
    label.textContent = opts.label;
    if (opts.current) {
        label.classList.add('is-current');
        row.setAttribute('aria-selected', 'true');
    }
    if (opts.count > 0) {
        label.classList.add('has-unread');
        const count = document.createElement('span');
        count.className = 'dovecote-tree-count';
        count.textContent = '(' + opts.count + ')';
        label.appendChild(count);
    }
    row.appendChild(label);
    return row;
};

const doveRenderFolderTree = function () {
    const tree = document.getElementById('desktopDovecoteFolderTree');
    if (!tree || tree.classList.contains('hidden')) return;
    const human = DESKTOP_DOVECOTE_HUMAN_OWNER;
    const current = desktopDovecote.viewAsOwner || human;
    const unreadOf = (owner) => {
        if (owner === current) return desktopDovecote.inboxUnread;
        const box = desktopDovecote.mailboxes.find((b) => b.owner === owner);
        return box ? (box.unread || 0) : 0;
    };
    const spamUnreadOf = (owner) => {
        const box = desktopDovecote.mailboxes.find((b) => b.owner === owner);
        return box ? (box.spamUnread || 0) : 0;
    };
    const folderRows = (owner, level) => DESKTOP_DOVECOTE_FOLDERS.map((folder) => doveBuildTreeRow({
        level: level,
        label: folder.label,
        icon: folder.id,
        owner: owner,
        folder: folder.id,
        count: folder.id === 'inbox' ? unreadOf(owner) : (folder.id === 'spam' ? spamUnreadOf(owner) : 0),
        current: current === owner && desktopDovecote.folder === folder.id
    }));
    const bots = desktopDovecote.mailboxes.filter((box) => doveIsBotOwner(box.owner));
    const rows = [doveBuildTreeRow({ level: 0, label: DOVE_LOCAL_FOLDERS_LABEL, icon: 'local', expander: 'open' })]
        .concat(folderRows(human, 1))
        .concat(doveBuildTreeRow({ level: 0, label: DOVE_COMMUNITIES_LABEL, icon: 'communities', expander: bots.length ? 'open' : null }));
    bots.forEach((box) => {
        const open = current === box.owner;
        rows.push(doveBuildTreeRow({
            level: 1,
            label: box.label,
            icon: 'mailbox',
            owner: box.owner,
            count: open ? 0 : (box.unread || 0),
            expander: open ? 'open' : 'closed'
        }));
        if (open) rows.push(...folderRows(box.owner, 2));
    });
    tree.replaceChildren(...rows);
};

// A tree row or View > Go to Folder: another mailbox switches to it (read-only for bots),
// the same mailbox just loads the folder.
const doveOpenTreeFolder = function (owner, folder) {
    const current = desktopDovecote.viewAsOwner || DESKTOP_DOVECOTE_HUMAN_OWNER;
    desktopDovecote.folder = folder;
    if (owner !== current) {
        doveSwitchMailbox(owner);
        return;
    }
    doveLoadFolder(folder);
};

const doveRenderFolderButton = function () {
    const button = document.getElementById('desktopDovecoteFolderBtn');
    const folder = DESKTOP_DOVECOTE_FOLDERS.find((f) => f.id === desktopDovecote.folder);
    if (!button || !folder) return;
    button.dataset.doveFolder = folder.id;
    button.querySelector('i').className = folder.icon;
    button.querySelector('.dovecote-folder-btn-label').textContent = folder.label;
    doveRenderWindowTitle();
    doveRenderFolderTree();
};

// Windows Mail's caption: "Inbox - Windows Mail"; a bot mailbox adds its name.
const doveRenderWindowTitle = function () {
    const el = desktopDovecoteEls && desktopDovecoteEls.titleText;
    const folder = DESKTOP_DOVECOTE_FOLDERS.find((f) => f.id === desktopDovecote.folder);
    if (!el || !folder) return;
    const owner = desktopDovecote.viewAsOwner;
    const box = owner && desktopDovecote.mailboxes.find((b) => b.owner === owner);
    const text = folder.label + (owner ? ' - ' + ((box && box.label) || owner) : '') + ' - Dovecote';
    if (el.textContent === text) return;
    el.textContent = text;
    // debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js
    debouncedUpdateTaskbarWindows();
};

// Mailboxes other than the one currently being viewed — used by the Forward picker.
const doveOtherMailboxes = function () {
    const current = desktopDovecote.viewAsOwner || DESKTOP_DOVECOTE_HUMAN_OWNER;
    return desktopDovecote.mailboxes.filter((box) => box.owner !== current);
};

// Picking a mailbox autofills the compose "To" field (doveOpenCompose's presetTo) instead of
// sending immediately — Forward now goes through the normal compose/review flow for any mailbox,
// not just bots, and there is no separate one-click "Fwd to Bot" action.
// getMail: reads the mail to forward at click time — the main toolbar's Forward button reads the
// currently selected message, a reader window's Forward button reads its own loaded message.
const doveMakeForwardMenuConfig = function (getMail, getIds) {
    return {
        onAction: (action, target, item) => {
            const ids = getIds ? getIds() : null;
            if (ids && ids.length > 1) {
                doveForwardSelected(item.doveOwner, ids);
                return;
            }
            doveOpenCompose('forward', getMail(), item.doveOwner);
        },
        sections: [{
            type: 'list',
            initfn: (section) => {
                // Read-only admin view: forwarding someone else's mail is still a mutation, same as Reply/Delete/Archive.
                const count = getIds ? getIds().length : (getMail() ? 1 : 0);
                const disabled = !count || !!desktopDovecote.viewAsOwner;
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
// currently selected. Several selected messages become one digest compose.
const doveForwardMenuConfig = doveMakeForwardMenuConfig(
    () => desktopDovecote.selectedMail,
    () => desktopDovecote.selectedIds.slice()
);

// ---- Mail row right-click context menu (#4): Open, Open in window, Reply, Forward > (mailbox
// submenu), Mark read/unread, Archive, Delete. One config attached to the whole rows container
// (contextMenu.attachToElement call in doveBuildMainPane); beforeShow resolves the row under the
// cursor into its summary from desktopDovecote.mail (same list the table itself renders from). ----

const doveMailRowMenuConfig = {
    sections: [],
    beforeShow: (event) => {
        const row = event.target.closest('[data-dove-mail-id]');
        doveMailRowMenuConfig.sections = doveBuildMailRowMenuSections(row ? row.dataset.doveMailId : null);
    },
    onAction: (action, target, item) => doveHandleMailRowMenuAction(item)
};

const doveMenuIdsForRow = function (mailId) {
    const inSel = doveSelectedIdSet().has(String(mailId));
    if (inSel && doveSelectedCount() > 1) return desktopDovecote.selectedIds.slice();
    return mailId ? [String(mailId)] : [];
};

const doveBuildMailRowMenuSections = function (mailId) {
    const ids = doveMenuIdsForRow(mailId);
    const idSet = new Set(ids);
    const rows = desktopDovecote.mail.filter((mail) => idSet.has(String(mail.id)));
    if (!rows.length) return [];
    const mail = rows.find((row) => String(row.id) === String(mailId)) || rows[0];
    const readOnly = !!desktopDovecote.viewAsOwner;
    const others = doveOtherMailboxes();
    const count = rows.length;
    const bulk = count > 1;
    const anyUnread = rows.some((row) => !row.read);
    const anyRead = rows.some((row) => row.read);
    const inSpam = rows.every((row) => row.folder === 'spam');
    const anyNotSpam = rows.some((row) => row.folder !== 'spam');
    const inDeleted = desktopDovecote.folder === 'deleted' || rows.every((row) => row.folder === 'deleted');
    const items = [];
    if (bulk) {
        items.push({ text: count + ' selected', disabled: true });
        items.push({ separator: true });
    } else {
        items.push({ text: 'Open', icon: 'fas fa-envelope-open-text', action: 'dove-row-open', doveMailId: mailId });
        items.push({ text: 'Open in Window', icon: 'fas fa-up-right-from-square', action: 'dove-row-open-window', doveMailId: mailId });
        items.push({ separator: true });
        items.push({ text: 'Reply', icon: 'fas fa-reply', action: 'dove-row-reply', doveMailId: mailId, disabled: readOnly });
    }
    items.push({
        text: bulk ? 'Forward ' + count + ' Messages' : 'Forward',
        icon: 'fas fa-share',
        disabled: readOnly || !others.length,
        submenu: others.length
            ? others.map((box) => ({
                text: box.label,
                icon: doveIsBotOwner(box.owner) ? 'fas fa-robot' : 'fas fa-user',
                action: 'dove-row-forward',
                doveMailIds: ids,
                doveOwner: box.owner
            }))
            : [{ text: 'No other mailboxes', disabled: true }]
    });
    items.push({ separator: true });
    items.push({ text: 'Mark as Read', icon: 'fas fa-envelope-open', action: 'dove-row-mark-read', doveMailIds: ids, disabled: readOnly || !anyUnread });
    items.push({ text: 'Mark as Unread', icon: 'fas fa-envelope', action: 'dove-row-mark-unread', doveMailIds: ids, disabled: readOnly || !anyRead });
    items.push({ text: 'Archive', icon: 'fas fa-box-archive', action: 'dove-row-archive', doveMailIds: ids, disabled: readOnly });
    items.push({ text: 'Move to Spam', icon: 'fas fa-ban', action: 'dove-row-spam', doveMailIds: ids, disabled: readOnly || !anyNotSpam });
    items.push({ text: 'Not spam', icon: 'fas fa-inbox', action: 'dove-row-not-spam', doveMailIds: ids, disabled: readOnly || !inSpam });
    items.push({ text: 'Restore', icon: 'fas fa-inbox', action: 'dove-row-restore', doveMailIds: ids, disabled: readOnly || !inDeleted });
    items.push({
        text: inDeleted ? 'Delete Permanently' : 'Delete',
        icon: 'fas fa-trash',
        action: 'dove-row-delete',
        doveMailIds: ids,
        disabled: readOnly,
        className: 'context-menu-item-danger'
    });
    return [{ type: 'list', items: items }];
};

const doveHandleMailRowMenuAction = function (item) {
    const ids = item.doveMailIds || (item.doveMailId ? [item.doveMailId] : []);
    const mailId = item.doveMailId || ids[0];
    if (!mailId && !ids.length) return;
    switch (item.action) {
        case 'dove-row-open': doveOpenSelected(mailId); return;
        case 'dove-row-open-window': doveOpenReaderWindow(mailId); return;
        case 'dove-row-reply': doveReplyToMailId(mailId); return;
        case 'dove-row-forward': doveForwardSelected(item.doveOwner, ids); return;
        case 'dove-row-mark-read': doveMarkMailIds(ids, { read: true }); return;
        case 'dove-row-mark-unread': doveMarkMailIds(ids, { read: false }); return;
        case 'dove-row-archive': doveMarkMailIds(ids, { archived: true }); return;
        case 'dove-row-spam': doveMarkMailIds(ids, { spam: true }); return;
        case 'dove-row-not-spam': doveMarkMailIds(ids, { spam: false }); return;
        case 'dove-row-restore': doveMarkMailIds(ids, { deleted: false }); return;
        case 'dove-row-delete':
            doveConfirmPermanentDelete(ids.length).then((ok) => { if (ok) doveMarkMailIds(ids, { deleted: true }); });
            return;
        default: return;
    }
};

// Reply/Forward need the full message body, which the list summaries don't carry —
// dovecote_get_mail: modules/ws/handlers/250-dovecoteHandler.js (also marks it read).
const doveFetchMailFull = async function (id, options) {
    const request = { id: id };
    if (desktopDovecote.viewAsOwner) request.viewAsOwner = desktopDovecote.viewAsOwner;
    if (options && options.markRead === false) request.markRead = false;
    try {
        const result = await wsClient.sendMessage('dovecote_get_mail', request);
        return result && result.mail;
    } catch (err) {
        doveShowError((err && err.message) || 'Could not open message');
        return null;
    }
};

const doveReplyToMailId = async function (id) {
    if (desktopDovecote.viewAsOwner) return;
    const mail = await doveFetchMailFull(id);
    if (mail) doveOpenCompose('reply', mail);
};

const doveForwardMailId = async function (id, owner) {
    if (desktopDovecote.viewAsOwner) return;
    const mail = await doveFetchMailFull(id, { markRead: false });
    if (mail) doveOpenCompose('forward', mail, owner);
};

const doveBuildForwardDigest = function (mails) {
    return mails.map((mail, index) => {
        const heading = [
            '-------- Original Message ' + (index + 1) + ' --------',
            'From: ' + doveDisplayAddress(mail.from),
            'To: ' + doveFormatAddressList(mail.to),
            'Subject: ' + (mail.subject || '(no subject)'),
            'Date: ' + doveFormatDate(mail.createdAt)
        ].join('\n');
        return heading + '\n\n' + (mail.body || '');
    }).join('\n\n');
};

const doveForwardSelected = async function (owner, ids) {
    if (desktopDovecote.viewAsOwner) return;
    const list = (ids && ids.length ? ids : desktopDovecote.selectedIds).map(String);
    if (!list.length && desktopDovecote.selectedMail) list.push(String(desktopDovecote.selectedMail.id));
    if (!list.length) return;
    if (list.length === 1) {
        await doveForwardMailId(list[0], owner);
        return;
    }
    const mails = [];
    for (let i = 0; i < list.length; i++) {
        const mail = await doveFetchMailFull(list[i], { markRead: false });
        if (mail) mails.push(mail);
    }
    if (!mails.length) return;
    doveOpenComposeWindow({
        mode: 'forward',
        to: owner || '',
        subject: 'Fwd: ' + mails.length + ' messages',
        body: doveBuildForwardDigest(mails),
        replyTo: null,
        sourceMailId: 'digest:' + list.join(',')
    });
};

const doveToggleReadForId = async function (id) {
    const mail = desktopDovecote.mail.find((m) => String(m.id) === String(id));
    if (!mail || desktopDovecote.viewAsOwner) return;
    await doveMarkMailIds([id], { read: !mail.read }, { stay: true });
};

const doveMarkMailId = async function (id, patch) {
    return doveMarkMailIds([id], patch);
};

const doveMarkMailIds = async function (ids, patch, options) {
    if (desktopDovecote.viewAsOwner) return;
    const list = (ids || []).map(String).filter(Boolean);
    if (!list.length) return;
    const stay = options && options.stay;
    try {
        const request = Object.assign({ ids: list }, patch);
        // dovecote_mark_mail: modules/ws/handlers/250-dovecoteHandler.js — ids[] is one round trip
        await wsClient.sendMessage('dovecote_mark_mail', request);
        if (stay && typeof patch.read === 'boolean') {
            const unreadDelta = list.reduce((sum, id) => {
                const found = desktopDovecote.mail.find((mail) => String(mail.id) === id);
                if (!found || found.read === patch.read) return sum;
                return sum + (patch.read ? -1 : 1);
            }, 0);
            list.forEach((id) => {
                const found = desktopDovecote.mail.find((mail) => String(mail.id) === id);
                if (found) found.read = patch.read;
                if (desktopDovecote.selectedMail && String(desktopDovecote.selectedMail.id) === id) {
                    desktopDovecote.selectedMail.read = patch.read;
                }
            });
            if (desktopDovecote.folder === 'inbox' || !desktopDovecote.viewAsOwner) {
                desktopDovecote.folderUnread = Math.max(0, (desktopDovecote.folderUnread || 0) + unreadDelta);
                if (!desktopDovecote.viewAsOwner) doveRenderInboxBadge(desktopDovecote.folderUnread);
            }
            doveRenderMessageList();
            return;
        }
        const selected = doveSelectedIdSet();
        if (list.some((id) => selected.has(id) || String(desktopDovecote.selectedId) === id)) {
            doveClearSelection();
            doveRenderPreview();
        }
        doveLoadFolder(desktopDovecote.folder);
    } catch (err) {
        doveShowError((err && err.message) || 'Could not update message');
    }
};

const doveSwitchMailbox = function (owner) {
    desktopDovecote.viewAsOwner = owner === DESKTOP_DOVECOTE_HUMAN_OWNER ? null : owner;
    doveClearSelection();
    doveRenderMailboxBanner();
    doveRenderToolbarState();
    // Already-open reader windows (doveReaderWindows) enforce the same read-only rule as
    // the main toolbar, and it can change out from under them while they're open.
    doveReaderWindows.forEach((state) => doveRenderReaderToolbarState(state));
    doveRenderPreview();
    doveLoadFolder(desktopDovecote.folder);
};

const doveRenderInboxBadge = function (unreadCount) {
    // doveApplyTrayBadge: keeps the taskbar tray badge (#dovecoteTrayIcon) live whenever the
    // main window already knows the human's own inbox unread count — not an admin view of
    // someone else's mailbox, the tray only ever reflects Yukimi's own inbox.
    if (!desktopDovecote.viewAsOwner) doveApplyTrayBadge(unreadCount);
    desktopDovecote.inboxUnread = unreadCount;
    desktopDovecoteEls.modal.querySelectorAll('.dovecote-unread-badge').forEach((badge) => {
        if (unreadCount > 0) {
            badge.textContent = String(unreadCount);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    });
};

// ---- Main pane: message list + preview -------------------------------------

const DESKTOP_DOVECOTE_LIST_COLUMNS = [
    { key: 'unread', label: '', sortable: false },
    { key: 'attachment', label: '📎', sortable: false },
    { key: 'route', label: '', sortable: false },
    { key: 'from', label: 'From', sortable: true },
    { key: 'subject', label: 'Subject', sortable: true },
    { key: 'createdAt', label: 'Received', sortable: true }
];

const doveBuildMainPane = function () {
    const pane = document.createElement('div');
    pane.className = 'dovecote-main-pane dovecote-no-selection';
    pane.id = 'desktopDovecoteMainPane';

    const listWrap = document.createElement('div');
    listWrap.className = 'dovecote-message-list-wrap';

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
        doveHandleRowActivate(row.dataset.doveMailId, ev);
    });
    rows.addEventListener('dblclick', (ev) => {
        const row = ev.target.closest('[data-dove-mail-id]');
        if (!row) return;
        doveOpenReaderWindow(row.dataset.doveMailId);
    });
    doveWireListGestures(rows);
    // contextMenu.attachToElement: public/scripts/comp/contextMenu.js — one config attached
    // to the whole rows container, beforeShow resolves which row was targeted (explorerApplet.js
    // setupExplorerContextMenu's gridHost pattern), same as Director's session list rows.
    contextMenu.attachToElement(rows, doveMailRowMenuConfig);

    listWrap.appendChild(table);
    pane.appendChild(listWrap);
    pane.appendChild(doveBuildPreviewPane());
    return pane;
};

// Rendered/Raw toggle (#6): one .button-group (public/css/gallery-core.css) in the header
// tools column (doveBuildOeHeader), under the Safe shield badge.
// Wired with its own click listener rather than relying on doveHandleBodyClick's
// modal-wide delegation, so it can't double-fire the way toolbar action buttons do.
const doveBuildBodyViewToggle = function (onChange) {
    const viewGroup = document.createElement('div');
    viewGroup.className = 'button-group dovecote-body-view-toggle';
    const renderedBtn = doveCreateButton('btn-secondary btn-small btn-toggle', 'Rendered', 'fas fa-eye');
    renderedBtn.dataset.doveBodyView = 'rendered';
    renderedBtn.dataset.state = 'on';
    const rawBtn = doveCreateButton('btn-secondary btn-small btn-toggle', 'Raw', 'fas fa-file-lines');
    rawBtn.dataset.doveBodyView = 'raw';
    rawBtn.dataset.state = 'off';
    viewGroup.appendChild(renderedBtn);
    viewGroup.appendChild(rawBtn);
    viewGroup.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-dove-body-view]');
        if (!btn) return;
        (onChange || doveSetBodyView)(btn.dataset.doveBodyView);
    });
    return viewGroup;
};

// Sanitized-HTML indicator: compact shield badge; the stripped-content summary lives in its tooltip.
const doveBuildSanitizedBadge = function () {
    const badge = document.createElement('span');
    badge.className = 'dovecote-sanitized-badge hidden';
    const icon = document.createElement('i');
    icon.className = 'fas fa-shield-halved';
    const label = document.createElement('span');
    label.textContent = 'Safe';
    badge.appendChild(icon);
    badge.appendChild(label);
    return badge;
};

const doveBuildForgedBadge = function () {
    const badge = document.createElement('span');
    badge.className = 'dovecote-forged-badge hidden';
    badge.title = 'The relay tagged this as looking like a Dreamscape sender (LANTIS_FORGED_OURS).';
    const icon = document.createElement('i');
    icon.className = 'fas fa-triangle-exclamation';
    const label = document.createElement('span');
    label.textContent = 'Forged';
    badge.appendChild(icon);
    badge.appendChild(label);
    return badge;
};

// Message header block shared by the inline preview and reader windows: From/To/Cc/Subject/Date
// rows on the left, and a right-aligned tools column (Safe badge + Rendered/Raw) spanning
// those rows, vertically centred. An empty Cc value is hidden in CSS. Nothing overlays the body.
// options: { idPrefix, badgeId, onBodyView(view) }. Returns { header, fieldEls, safetyBar, viewToggle }.
const doveBuildOeHeader = function (options) {
    const opts = options || {};
    const header = document.createElement('div');
    header.className = 'dovecote-oe-header';
    const fields = document.createElement('div');
    fields.className = 'dovecote-oe-header-fields';
    const fieldEls = {};
    const fieldLabels = {
        from: 'From:',
        to: 'To:',
        originalTo: 'Originally to:',
        cc: 'Cc:',
        subject: 'Subject:',
        date: 'Date:',
        spam: 'Spam:',
        auth: 'Auth:'
    };
    ['from', 'to', 'originalTo', 'cc', 'subject', 'date', 'spam', 'auth'].forEach((field) => {
        const cap = field.charAt(0).toUpperCase() + field.slice(1);
        const row = document.createElement('div');
        row.className = 'dovecote-oe-header-row';
        row.dataset.doveField = field;
        const labelEl = document.createElement('span');
        labelEl.className = 'dovecote-oe-header-label';
        labelEl.textContent = fieldLabels[field] || (cap + ':');
        const valueEl = document.createElement('span');
        valueEl.className = 'dovecote-oe-header-value';
        if (opts.idPrefix) valueEl.id = opts.idPrefix + cap;
        row.appendChild(labelEl);
        if (field === 'from') {
            const routeEl = document.createElement('span');
            routeEl.className = 'dovecote-oe-route';
            if (opts.idPrefix) routeEl.id = opts.idPrefix + 'Route';
            row.appendChild(routeEl);
            fieldEls.route = routeEl;
        }
        row.appendChild(valueEl);
        fields.appendChild(row);
        fieldEls[field] = valueEl;
    });
    header.appendChild(fields);

    const tools = document.createElement('div');
    tools.className = 'dovecote-oe-header-tools';
    const badge = doveBuildSanitizedBadge();
    if (opts.badgeId) badge.id = opts.badgeId;
    tools.appendChild(badge);
    const forgedBadge = doveBuildForgedBadge();
    if (opts.forgedBadgeId) forgedBadge.id = opts.forgedBadgeId;
    tools.appendChild(forgedBadge);
    const viewToggle = doveBuildBodyViewToggle(opts.onBodyView);
    tools.appendChild(viewToggle);
    header.appendChild(tools);
    return { header: header, fieldEls: fieldEls, safetyBar: badge, forgedBadge: forgedBadge, viewToggle: viewToggle };
};

const doveSetViewToggleState = function (root, view) {
    root.querySelectorAll('[data-dove-body-view]').forEach((btn) => {
        btn.dataset.state = btn.dataset.doveBodyView === view ? 'on' : 'off';
    });
};

const doveBuildPreviewPane = function () {
    const preview = document.createElement('div');
    preview.className = 'dovecote-preview-pane';
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
    ['reply', 'replyAll', 'forward', 'archive', 'spam', 'notSpam', 'delete'].forEach((action) => {
        const icons = { reply: 'fas fa-reply', replyAll: 'fas fa-reply-all', forward: 'fas fa-share', archive: 'fas fa-box-archive', spam: 'fas fa-ban', notSpam: 'fas fa-inbox', delete: 'fas fa-trash' };
        const titles = { reply: 'Reply', replyAll: 'Reply All', forward: 'Forward', archive: 'Archive', spam: 'Move to Spam', notSpam: 'Not spam', delete: 'Delete' };
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

    const built = doveBuildOeHeader({
        idPrefix: 'desktopDovecoteOe',
        badgeId: 'desktopDovecoteSafetyBar',
        forgedBadgeId: 'desktopDovecoteForgedBadge'
    });
    const header = built.header;
    header.id = 'desktopDovecoteOeHeader';
    preview.appendChild(header);
    const spamReport = document.createElement('pre');
    spamReport.className = 'dovecote-spam-report hidden';
    spamReport.id = 'desktopDovecoteSpamReport';
    preview.appendChild(spamReport);

    const imagesBar = document.createElement('div');
    imagesBar.className = 'dovecote-images-bar hidden';
    imagesBar.id = 'desktopDovecoteImagesBar';
    preview.appendChild(imagesBar);

    const attachmentsBar = document.createElement('div');
    attachmentsBar.className = 'dovecote-attachments-bar hidden';
    attachmentsBar.id = 'desktopDovecoteAttachmentsBar';
    preview.appendChild(attachmentsBar);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'dovecote-body-wrap';
    bodyWrap.id = 'desktopDovecoteBodyWrap';
    const emptyHint = document.createElement('p');
    emptyHint.className = 'form-hint dovecote-empty-hint';
    emptyHint.id = 'desktopDovecoteEmptyHint';
    emptyHint.textContent = 'There is no message selected.';
    bodyWrap.appendChild(emptyHint);
    preview.appendChild(bodyWrap);

    return preview;
};

const doveBuildStatusBar = function () {
    const status = document.createElement('div');
    status.className = 'dovecote-status-bar';
    const counts = document.createElement('span');
    counts.id = 'desktopDovecoteStatusCounts';
    counts.textContent = '0 message(s), 0 unread';
    const sanitizeState = document.createElement('span');
    sanitizeState.id = 'desktopDovecoteStatusSanitize';
    sanitizeState.className = 'hidden';
    const error = document.createElement('span');
    error.id = 'desktopDovecoteStatusError';
    error.className = 'dovecote-status-error hidden';
    // Windows Mail's right-hand cell: the network computer and "Working Online"
    const online = document.createElement('span');
    online.className = 'dovecote-status-online';
    const onlineIcon = document.createElement('span');
    onlineIcon.className = 'dovecote-status-online-icon';
    onlineIcon.setAttribute('aria-hidden', 'true');
    const onlineText = document.createElement('span');
    onlineText.textContent = 'Working Online';
    online.appendChild(onlineIcon);
    online.appendChild(onlineText);
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
        attachmentsBar: document.getElementById('desktopDovecoteAttachmentsBar'),
        oeFrom: document.getElementById('desktopDovecoteOeFrom'),
        oeRoute: document.getElementById('desktopDovecoteOeRoute'),
        oeTo: document.getElementById('desktopDovecoteOeTo'),
        oeOriginalTo: document.getElementById('desktopDovecoteOeOriginalTo'),
        oeCc: document.getElementById('desktopDovecoteOeCc'),
        oeSubject: document.getElementById('desktopDovecoteOeSubject'),
        oeDate: document.getElementById('desktopDovecoteOeDate'),
        oeSpam: document.getElementById('desktopDovecoteOeSpam'),
        oeAuth: document.getElementById('desktopDovecoteOeAuth'),
        spamReport: document.getElementById('desktopDovecoteSpamReport'),
        forgedBadge: document.getElementById('desktopDovecoteForgedBadge'),
        searchGroup: document.getElementById('desktopDovecoteSearchGroup'),
        searchInput: document.getElementById('desktopDovecoteSearchInput'),
        mainPane: document.getElementById('desktopDovecoteMainPane')
    });
};

const doveWireEvents = function () {
    desktopDovecoteEls.modal.addEventListener('click', doveHandleBodyClick);
    desktopDovecoteEls.modal.addEventListener('keydown', doveHandleListKeydown);
};

const doveHandleListKeydown = function (ev) {
    if (!((ev.ctrlKey || ev.metaKey) && (ev.key === 'a' || ev.key === 'A'))) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    ev.preventDefault();
    doveSelectAllVisible();
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
        case 'markRead': doveMarkMailIds(desktopDovecote.selectedIds, { read: true }, { stay: true }); return;
        case 'markUnread': doveMarkMailIds(desktopDovecote.selectedIds, { read: false }, { stay: true }); return;
        case 'delete': doveDeleteSelected(); return;
        case 'restore': doveRestoreSelected(); return;
        case 'archive': doveArchiveSelected(); return;
        case 'spam': doveSpamSelected(true); return;
        case 'notSpam': doveSpamSelected(false); return;
        case 'selectAll': doveSelectAllVisible(); return;
        case 'refresh': doveLoadFolder(desktopDovecote.folder); return;
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
        doveRenderWindowTitle();
        doveRenderFolderTree();
    } catch (err) {
        doveShowError((err && err.message) || 'Could not load mailbox list');
    }
};

let doveFolderToken = 0;

const doveApplyListPage = function (result, append) {
    const page = (result && result.mail) || [];
    if (append) {
        const seen = new Set(desktopDovecote.mail.map((mail) => String(mail.id)));
        page.forEach((mail) => {
            if (!seen.has(String(mail.id))) desktopDovecote.mail.push(mail);
        });
    } else {
        desktopDovecote.mail = page;
    }
    desktopDovecote.nextCursor = (result && result.nextCursor) || null;
    desktopDovecote.hasMore = !!(result && result.hasMore);
    if (result && result.total != null) desktopDovecote.folderTotal = result.total;
    if (result && result.unread != null) desktopDovecote.folderUnread = result.unread;
};

const doveLoadFolder = async function (folder, options) {
    const token = ++doveFolderToken;
    desktopDovecote.folder = folder;
    desktopDovecote.loadingMore = false;
    doveRenderFolderButton();
    doveShowError(null);
    const request = { folder: folder };
    if (desktopDovecote.viewAsOwner) request.viewAsOwner = desktopDovecote.viewAsOwner;
    try {
        // dovecote_list_mail: modules/ws/handlers/250-dovecoteHandler.js
        const result = await wsClient.sendMessage('dovecote_list_mail', request, false);
        if (token !== doveFolderToken) return;
        doveApplyListPage(result, false);
        doveNoteMailIds(desktopDovecote.mail, { announce: false });
        const keep = doveSelectedIdSet();
        desktopDovecote.selectedIds = desktopDovecote.mail
            .map((mail) => String(mail.id))
            .filter((id) => keep.has(id));
        if (desktopDovecote.selectedId && !doveSelectedIdSet().has(String(desktopDovecote.selectedId))) {
            desktopDovecote.selectedId = desktopDovecote.selectedIds[0] || null;
            desktopDovecote.selectedMail = null;
        }
        doveRenderMessageList();
        if (folder === 'inbox') {
            doveRenderInboxBadge(desktopDovecote.folderUnread);
        } else if (!desktopDovecote.viewAsOwner) {
            const known = options && options.inboxUnread;
            if (known != null) doveRenderInboxBadge(known);
            else doveRefreshInboxBadgeOnly();
        }
    } catch (err) {
        if (token !== doveFolderToken) return;
        desktopDovecote.mail = [];
        desktopDovecote.hasMore = false;
        desktopDovecote.nextCursor = null;
        desktopDovecote.folderTotal = 0;
        desktopDovecote.folderUnread = 0;
        doveRenderMessageList();
        doveShowError((err && err.message) || 'Could not load mail');
    }
};

const doveLoadMoreFolder = async function () {
    if (!desktopDovecote.hasMore || desktopDovecote.loadingMore || !desktopDovecote.nextCursor) return;
    const token = doveFolderToken;
    desktopDovecote.loadingMore = true;
    doveRenderMessageList();
    const request = { folder: desktopDovecote.folder, cursor: desktopDovecote.nextCursor };
    if (desktopDovecote.viewAsOwner) request.viewAsOwner = desktopDovecote.viewAsOwner;
    try {
        // dovecote_list_mail: modules/ws/handlers/250-dovecoteHandler.js
        const result = await wsClient.sendMessage('dovecote_list_mail', request, false);
        if (token !== doveFolderToken) return;
        doveApplyListPage(result, true);
        doveNoteMailIds((result && result.mail) || [], { announce: false });
    } catch (err) {
        if (token !== doveFolderToken) return;
        doveShowError((err && err.message) || 'Could not load older mail');
    }
    desktopDovecote.loadingMore = false;
    doveRenderMessageList();
};

// Keeps the Inbox unread badge current even while another folder is open.
let doveBadgeToken = 0;
const doveRefreshInboxBadgeOnly = async function () {
    const token = ++doveBadgeToken;
    try {
        const result = await wsClient.sendMessage('dovecote_list_mail', { folder: 'inbox', limit: 1 }, false);
        if (token !== doveBadgeToken) return;
        doveRenderInboxBadge((result && result.unread) || 0);
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

const doveSetMobileMessageOpen = function (open) {
    desktopDovecote.mobileMessageOpen = open;
    desktopDovecoteEls.mainPane.classList.toggle('dovecote-mobile-message-open', open);
};

const doveSetBodyView = function (view) {
    desktopDovecote.bodyView = view;
    // Lives in the preview pane header now (#6), not the toolbar — query the whole modal.
    desktopDovecoteEls.modal.querySelectorAll('[data-dove-body-view]').forEach((btn) => {
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
            || doveDisplayAddress(m.from).toLowerCase().includes(query)
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
    // vistaSidebar.js opens a reader before the main window exists (desktopDovecoteEls is null)
    if (!desktopDovecoteEls) return;
    const rows = desktopDovecoteEls.rows;
    if (!rows) return;
    rows.replaceChildren();
    // Windows Mail marks the sorted column: header arrow + tinted cells (dovecote.css)
    rows.parentNode.dataset.sortKey = desktopDovecote.sortKey;
    rows.parentNode.dataset.sortDir = desktopDovecote.sortDir;
    const list = doveFilteredSortedMail();
    list.forEach((mail) => {
        const row = document.createElement('div');
        row.className = 'dovecote-message-row';
        row.dataset.doveMailId = mail.id;
        if (!mail.read) row.classList.add('unread');
        if (doveSelectedIdSet().has(String(mail.id))) row.classList.add('selected');

        const unreadCell = document.createElement('span');
        unreadCell.className = 'dovecote-col-unread';
        if (desktopDovecote.folder === 'sent') {
            // Read receipt (#2): a sent message shows a check once the recipient has opened it.
            if (mail.readByRecipient) {
                const check = document.createElement('i');
                check.className = 'fas fa-check-double dovecote-read-receipt';
                check.title = 'Read by recipient';
                check.setAttribute('aria-hidden', 'true');
                unreadCell.appendChild(check);
            }
        } else if (!mail.read) {
            const dot = document.createElement('i');
            dot.className = 'fas fa-circle';
            dot.setAttribute('aria-hidden', 'true');
            unreadCell.appendChild(dot);
        }

        const attachCell = document.createElement('span');
        attachCell.className = 'dovecote-col-attachment';
        if (mail.attachments && mail.attachments.length) {
            const clip = document.createElement('i');
            clip.className = 'fas fa-paperclip';
            clip.title = mail.attachments.length + ' attachment' + (mail.attachments.length === 1 ? '' : 's');
            clip.setAttribute('aria-hidden', 'true');
            attachCell.appendChild(clip);
        }

        const routeCell = document.createElement('span');
        routeCell.className = 'dovecote-col-route';
        routeCell.appendChild(doveBuildRouteIcon(mail.route));

        const fromCell = document.createElement('span');
        fromCell.className = 'dovecote-col-from';
        fromCell.textContent = doveDisplayAddress(mail.from);

        const subjectCell = document.createElement('span');
        subjectCell.className = 'dovecote-col-subject';
        subjectCell.textContent = mail.subject || '(no subject)';

        const dateCell = document.createElement('span');
        dateCell.className = 'dovecote-col-createdAt';
        dateCell.textContent = doveFormatDate(mail.createdAt);

        row.appendChild(unreadCell);
        row.appendChild(attachCell);
        row.appendChild(routeCell);
        row.appendChild(fromCell);
        row.appendChild(subjectCell);
        row.appendChild(dateCell);
        rows.appendChild(row);
    });
    if (desktopDovecote.hasMore) {
        const more = document.createElement('div');
        more.className = 'form-hint dovecote-empty-hint';
        more.id = 'desktopDovecoteLoadMore';
        more.textContent = desktopDovecote.loadingMore ? 'Loading older messages...' : 'Scroll for older messages';
        rows.appendChild(more);
        doveObserveLoadMore(more);
    }
    doveRenderStatusCounts();
    doveRenderToolbarState();
};

const doveObserveLoadMore = function (el) {
    if (typeof IntersectionObserver !== 'function') {
        doveBindListScroll();
        return;
    }
    if (doveLoadMoreObserver) doveLoadMoreObserver.disconnect();
    doveLoadMoreObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) doveLoadMoreFolder();
    }, { root: desktopDovecoteEls.rows, rootMargin: '40px' });
    doveLoadMoreObserver.observe(el);
};

let doveListScrollBound = false;
let doveLoadMoreObserver = null;
const doveBindListScroll = function () {
    if (doveListScrollBound || !desktopDovecoteEls || !desktopDovecoteEls.rows) return;
    doveListScrollBound = true;
    desktopDovecoteEls.rows.addEventListener('scroll', () => {
        const box = desktopDovecoteEls.rows;
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 48) doveLoadMoreFolder();
    });
};

const doveRenderStatusCounts = function () {
    const total = desktopDovecote.folderTotal || desktopDovecote.mail.length;
    const unread = desktopDovecote.folderUnread;
    const selected = doveSelectedCount();
    if (!desktopDovecoteEls.statusCounts) return;
    // Windows Mail's wording, plus a selected-count when more than one is highlighted
    let text = total + ' message(s), ' + unread + ' unread';
    if (desktopDovecote.hasMore && desktopDovecote.mail.length < total) {
        text = desktopDovecote.mail.length + ' of ' + total + ' message(s), ' + unread + ' unread';
    }
    if (selected > 1) text += ' · ' + selected + ' selected';
    desktopDovecoteEls.statusCounts.textContent = text;
};

// ---- Selection + preview ----------------------------------------------------

const doveSelectRange = function (toId) {
    const list = doveFilteredSortedMail();
    const fromId = desktopDovecote.anchorId || desktopDovecote.selectedId || toId;
    const start = list.findIndex((mail) => String(mail.id) === String(fromId));
    const end = list.findIndex((mail) => String(mail.id) === String(toId));
    if (start < 0 || end < 0) {
        doveSetSelectedIds([toId], toId);
        return;
    }
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    doveSetSelectedIds(list.slice(lo, hi + 1).map((mail) => mail.id), toId);
};

const doveSelectAllVisible = function () {
    const list = doveFilteredSortedMail();
    doveSetSelectedIds(list.map((mail) => mail.id), desktopDovecote.selectedId || (list[0] && list[0].id));
    desktopDovecote.selectedMail = list.length === 1 ? desktopDovecote.selectedMail : null;
    doveRenderMessageList();
    doveRenderPreview();
};

const doveOpenSelected = async function (id) {
    doveShowError(null);
    const request = { id: id };
    if (desktopDovecote.viewAsOwner) request.viewAsOwner = desktopDovecote.viewAsOwner;
    try {
        // dovecote_get_mail: modules/ws/handlers/250-dovecoteHandler.js (also marks the message read server-side)
        const result = await wsClient.sendMessage('dovecote_get_mail', request);
        doveSetSelectedIds([id], id);
        desktopDovecote.anchorId = String(id);
        desktopDovecote.selectedMail = result && result.mail;
        desktopDovecote.allowRemoteImagesOnce = false;
        const found = desktopDovecote.mail.find((m) => String(m.id) === String(id));
        if (found && !found.read) {
            found.read = true;
            if (desktopDovecote.folder === 'inbox') {
                desktopDovecote.folderUnread = Math.max(0, (desktopDovecote.folderUnread || 1) - 1);
            }
        }
        doveRenderMessageList();
        doveRenderInboxBadgeFromState();
        doveRenderPreview();
        doveSetMobileMessageOpen(true);
    } catch (err) {
        doveShowError((err && err.message) || 'Could not open message');
    }
};

const doveSelectMail = doveOpenSelected;

const doveHandleRowActivate = function (id, ev) {
    if (doveIgnoreRowClick) return;
    if (desktopDovecoteEls && desktopDovecoteEls.rows) desktopDovecoteEls.rows.focus();
    if (desktopDovecote.touchMulti) {
        const ids = doveSelectedIdSet();
        if (ids.has(String(id))) ids.delete(String(id));
        else ids.add(String(id));
        doveSetSelectedIds(Array.from(ids), id);
        desktopDovecote.anchorId = String(id);
        if (!ids.size) desktopDovecote.touchMulti = false;
        desktopDovecote.selectedMail = null;
        doveRenderMessageList();
        doveRenderPreview();
        return;
    }
    if (ev && ev.shiftKey) {
        doveSelectRange(id);
        desktopDovecote.selectedMail = doveSelectedCount() === 1 ? desktopDovecote.selectedMail : null;
        doveRenderMessageList();
        if (doveSelectedCount() === 1) doveOpenSelected(id);
        else doveRenderPreview();
        return;
    }
    if (doveHasModifierSelect(ev)) {
        const ids = doveSelectedIdSet();
        if (ids.has(String(id))) ids.delete(String(id));
        else ids.add(String(id));
        doveSetSelectedIds(Array.from(ids), id);
        desktopDovecote.anchorId = String(id);
        if (ids.size === 1) {
            doveOpenSelected(id);
            return;
        }
        desktopDovecote.selectedMail = null;
        doveRenderMessageList();
        doveRenderPreview();
        return;
    }
    doveOpenSelected(id);
};

let doveIgnoreRowClick = false;
let dovePressTimer = null;
const doveWireListGestures = function (rows) {
    rows.tabIndex = 0;
    rows.addEventListener('pointerdown', (ev) => {
        if (ev.pointerType === 'mouse' || ev.button) return;
        const row = ev.target.closest('[data-dove-mail-id]');
        if (!row) return;
        const id = row.dataset.doveMailId;
        const startX = ev.clientX;
        const startY = ev.clientY;
        dovePressTimer = setTimeout(() => {
            dovePressTimer = null;
            doveIgnoreRowClick = true;
            desktopDovecote.touchMulti = true;
            if (!doveSelectedIdSet().has(String(id))) {
                const ids = doveSelectedIdSet();
                ids.add(String(id));
                doveSetSelectedIds(Array.from(ids), id);
            }
            desktopDovecote.anchorId = String(id);
            desktopDovecote.selectedMail = null;
            // contextMenu: public/scripts/comp/contextMenu.js — cancel the same hold's menu
            if (typeof contextMenu !== 'undefined' && contextMenu._cancelTouchLongPress) {
                contextMenu._cancelTouchLongPress();
            }
            doveRenderMessageList();
            doveRenderPreview();
        }, 480);
        const cancel = function (moveEv) {
            if (moveEv && moveEv.type === 'pointermove') {
                const dx = Math.abs(moveEv.clientX - startX);
                const dy = Math.abs(moveEv.clientY - startY);
                if (dx < 12 && dy < 12) return;
            }
            if (dovePressTimer) {
                clearTimeout(dovePressTimer);
                dovePressTimer = null;
            }
            rows.removeEventListener('pointermove', cancel);
            rows.removeEventListener('pointerup', cancel);
            rows.removeEventListener('pointercancel', cancel);
            setTimeout(() => { doveIgnoreRowClick = false; }, 0);
        };
        rows.addEventListener('pointermove', cancel);
        rows.addEventListener('pointerup', cancel);
        rows.addEventListener('pointercancel', cancel);
    });
};

const doveRenderPreview = function () {
    const count = doveSelectedCount();
    const mail = count === 1 ? desktopDovecote.selectedMail : null;
    // No single message: the viewer pane is hidden and the list takes the space.
    desktopDovecoteEls.mainPane.classList.toggle('dovecote-no-selection', !mail);
    desktopDovecoteEls.emptyHint.classList.toggle('hidden', !!mail);
    if (desktopDovecoteEls.emptyHint) {
        desktopDovecoteEls.emptyHint.textContent = count > 1
            ? (count + ' messages selected.')
            : 'There is no message selected.';
    }
    doveRenderOeHeaderInto(desktopDovecoteEls, mail);
    desktopDovecoteEls.safetyBar.classList.add('hidden');
    desktopDovecoteEls.imagesBar.classList.add('hidden');
    doveRenderAttachmentsInto(desktopDovecoteEls, mail, desktopDovecote.viewAsOwner);
    doveRenderPreviewBody();
    doveRenderToolbarState();
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
// doveOpenReaderWindow below) — els is { oeFrom, oeTo, oeCc, oeSubject, oeDate, safetyBar,
// imagesBar, attachmentsBar, bodyWrap }. ----------------------------------------------------------------

const doveRenderOeHeaderInto = function (els, mail) {
    const showLabel = mail && mail.fromLabel && !mail.labelSuspicious;
    els.oeFrom.textContent = mail
        ? (showLabel ? mail.fromLabel : doveDisplayAddress(mail.from))
        : '';
    els.oeTo.textContent = mail ? doveFormatAddressList(mail.to) : '';
    if (els.oeOriginalTo) els.oeOriginalTo.textContent = mail && mail.originalTo ? mail.originalTo : '';
    if (els.oeCc) els.oeCc.textContent = mail ? doveFormatAddressList(mail.cc) : '';
    els.oeSubject.textContent = mail ? (mail.subject || '(no subject)') : '';
    els.oeDate.textContent = mail ? doveFormatDate(mail.createdAt) : '';
    doveFillRouteSlot(els.oeRoute, mail ? mail.route : 'internal');
    if (els.oeRoute) els.oeRoute.classList.toggle('hidden', !mail);
    if (els.oeSpam) els.oeSpam.textContent = doveFormatSpamScore(mail);
    if (els.oeAuth) els.oeAuth.textContent = doveFormatSpamAuth(mail);
    if (els.forgedBadge) els.forgedBadge.classList.toggle('hidden', !(mail && mail.spamForgedOurs));
    if (els.spamReport) {
        const report = mail && mail.spamReport ? String(mail.spamReport) : '';
        els.spamReport.textContent = report;
        els.spamReport.classList.toggle('hidden', !report);
    }
};

const doveFormatSpamScore = function (mail) {
    if (!mail) return '';
    if (mail.spamScore == null && mail.spamRequired == null) return '';
    if (mail.spamScore != null && mail.spamRequired != null) {
        return mail.spamScore + ' / ' + mail.spamRequired;
    }
    return mail.spamScore != null ? String(mail.spamScore) : String(mail.spamRequired);
};

const doveFormatSpamAuth = function (mail) {
    if (!mail) return '';
    const parts = [];
    if (mail.spamReceivedSpf) parts.push('SPF ' + mail.spamReceivedSpf);
    if (mail.spamDkim) parts.push('DKIM ' + mail.spamDkim);
    if (mail.spamDmarc) {
        let dmarc = 'DMARC ' + mail.spamDmarc;
        if (mail.spamDmarcPolicy) dmarc += ' (p=' + mail.spamDmarcPolicy + ')';
        parts.push(dmarc);
    }
    return parts.join(' · ');
};

const doveFormatBytes = function (bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = Number(bytes) || 0;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return (unitIndex === 0 ? value : value.toFixed(1)) + ' ' + units[unitIndex];
};

const doveBase64ToBlob = function (base64, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
};

// dovecote_get_attachment: modules/ws/handlers/250-dovecoteHandler.js — scoped the same
// way mail reads are (viewAsOwner for the read-only admin view, Yukimi's own mailbox otherwise).
const doveFetchAttachmentBase64 = async function (attachmentId, viewAsOwner) {
    const request = { id: attachmentId };
    if (viewAsOwner) request.viewAsOwner = viewAsOwner;
    const result = await wsClient.sendMessage('dovecote_get_attachment', request);
    return result && result.attachment && result.attachment.base64;
};

// ---- Attachments (#3): each one is a button that opens it (Yukimi 2026-10-14: "attachments should
// be buttons so i can open them and view them"), right-click for Open / Save As (Windows Mail's Attach
// row). Bytes are only fetched on use, except image thumbnails. Opening goes to the desktop app for
// the kind: images -> Lumen, audio / video -> Media Player, text and PDF -> a Dovecote viewer window,
// anything else is saved. Text is always shown as plain text (never rendered as HTML).

const DOVE_TEXT_MIME = /^(text\/|application\/(json|xml|x-yaml|yaml|toml|javascript|x-sh|csv|x-ndjson)$)/;
const DOVE_TEXT_EXT = /\.(txt|md|markdown|json|jsonl|log|csv|tsv|ya?ml|toml|xml|ini|cfg|conf|js|mjs|ts|css|html?|py|sh)$/;

const doveAttachmentKind = function (att) {
    const type = String((att && att.mimeType) || '').toLowerCase();
    const name = String((att && att.name) || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('audio/') || type.startsWith('video/')) return 'media';
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (DOVE_TEXT_MIME.test(type) || DOVE_TEXT_EXT.test(name)) return 'text';
    return 'file';
};

const doveAttachmentIcon = function (kind) {
    return { image: 'fas fa-file-image', media: 'fas fa-file-video', pdf: 'fas fa-file-pdf', text: 'fas fa-file-lines' }[kind] || 'fas fa-file';
};

const doveSaveAttachment = function (att, base64) {
    const blob = doveBase64ToBlob(base64, att.mimeType);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = att.name || 'attachment';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const doveOpenAttachment = async function (att, viewAsOwner, action) {
    try {
        const base64 = await doveFetchAttachmentBase64(att.id, viewAsOwner);
        if (!base64) return;
        const kind = doveAttachmentKind(att);
        const name = att.name || 'attachment';
        if (action === 'save' || kind === 'file') {
            doveSaveAttachment(att, base64);
            return;
        }
        // openGalleryImageInViewer: public/scripts/comp/imageViewer.js (Lumen; a data: URL with no
        // gallery filename is shown as is, like the Reference Manager's images)
        if (kind === 'image' && typeof openGalleryImageInViewer === 'function') {
            openGalleryImageInViewer({ url: 'data:' + att.mimeType + ';base64,' + base64, base: name });
            return;
        }
        // openDesktopMediaPlayerUrl: public/scripts/comp/desktop-apps/mediaPlayer.js
        if (kind === 'media' && typeof openDesktopMediaPlayerUrl === 'function') {
            openDesktopMediaPlayerUrl(URL.createObjectURL(doveBase64ToBlob(base64, att.mimeType)), name);
            return;
        }
        if (kind === 'text' || kind === 'pdf') {
            doveOpenAttachmentViewer(att, base64, kind);
            return;
        }
        doveSaveAttachment(att, base64);
    } catch (err) {
        doveShowError((err && err.message) || 'Could not open attachment');
    }
};

// One viewer window per attachment id (doveShowWindow raises an open one).
const doveAttachmentWindows = new Map();

const doveOpenAttachmentViewer = function (att, base64, kind) {
    const key = String(att.id);
    const existing = doveAttachmentWindows.get(key);
    if (existing) {
        doveShowWindow(existing);
        return;
    }
    const name = att.name || 'attachment';
    const modal = document.createElement('div');
    modal.id = 'desktopDovecoteAttachment_' + key.replace(/[^A-Za-z0-9_-]/g, '_');
    modal.className = 'modal resizeable-window dovecote-attachment-window hidden';
    modal.dataset.windowClient = 'light';
    modal.dataset.windowIdentifier = 'desktopDovecoteAttachment';
    modal.dataset.windowDefaultWidth = '640';
    modal.dataset.windowDefaultHeight = '560';
    modal.dataset.windowMinWidth = '320';
    modal.dataset.windowMinHeight = '240';
    modal.dataset.windowMaxWidth = '1600';
    modal.dataset.windowMaxHeight = '1200';

    let objectUrl = null;
    const close = () => {
        doveAttachmentWindows.delete(key);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        modal.remove();
    };
    modal.dataset.iconOwnerId = DESKTOP_DOVECOTE_MODAL_ID;
    modal.appendChild(doveBuildWindowTitle(name, doveAttachmentIcon(kind)));
    modal.appendChild(document.createElement('div')).className = 'modal-focus-overlay';
    modal.appendChild(doveBuildWindowControls(modal, close));

    const content = document.createElement('div');
    content.className = 'modal-content win7 dovecote-client';
    const toolbar = document.createElement('div');
    toolbar.className = 'dovecote-command-bar';
    toolbar.setAttribute('role', 'toolbar');
    const saveBtn = doveCreateCommand('save', 'Save As', 'fas fa-floppy-disk', 'Save As…');
    saveBtn.addEventListener('click', () => doveSaveAttachment(att, base64));
    toolbar.appendChild(saveBtn);
    content.appendChild(toolbar);

    const body = document.createElement('div');
    body.className = 'modal-body dovecote-attachment-body';
    if (kind === 'pdf') {
        // a blob typed application/pdf: Chrome's PDF viewer, never parsed as HTML
        objectUrl = URL.createObjectURL(doveBase64ToBlob(base64, 'application/pdf'));
        const frame = document.createElement('iframe');
        frame.className = 'dovecote-body-frame';
        frame.title = name;
        frame.src = objectUrl;
        body.appendChild(frame);
    } else {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const pre = document.createElement('pre');
        pre.className = 'dovecote-raw-body';
        pre.textContent = new TextDecoder('utf-8').decode(bytes);
        body.appendChild(pre);
    }
    content.appendChild(body);
    const status = document.createElement('div');
    status.className = 'dovecote-status-bar';
    const statusText = document.createElement('span');
    statusText.textContent = (att.mimeType || 'file') + ', ' + doveFormatBytes(att.size);
    status.appendChild(statusText);
    content.appendChild(status);
    modal.appendChild(content);

    doveAttachmentWindows.set(key, modal);
    document.body.appendChild(modal);
    doveShowWindow(modal);
};

const doveAttachmentMenuConfig = function (att, viewAsOwner) {
    return {
        sections: [{
            type: 'list',
            items: [
                { text: 'Open', action: 'dove-attachment-open' },
                { text: 'Save As…', action: 'dove-attachment-save' }
            ]
        }],
        onAction: (action) => doveOpenAttachment(att, viewAsOwner, action === 'dove-attachment-save' ? 'save' : 'open')
    };
};

const doveRenderAttachmentsInto = function (els, mail, viewAsOwner) {
    const bar = els.attachmentsBar;
    if (!bar) return;
    bar.replaceChildren();
    const attachments = (mail && mail.attachments) || [];
    if (!attachments.length) {
        bar.classList.add('hidden');
        return;
    }
    bar.classList.remove('hidden');
    attachments.forEach((att) => {
        const kind = doveAttachmentKind(att);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dovecote-attachment-chip';
        button.dataset.doveAttachmentKind = kind;
        button.title = 'Open ' + (att.name || 'attachment') + ' (right-click to save)';
        if (kind === 'image') {
            const thumb = document.createElement('img');
            thumb.className = 'dovecote-attachment-thumb';
            thumb.alt = '';
            button.appendChild(thumb);
            doveFetchAttachmentBase64(att.id, viewAsOwner).then((base64) => {
                if (base64) thumb.src = 'data:' + att.mimeType + ';base64,' + base64;
            }).catch(() => {});
        } else {
            const icon = document.createElement('i');
            icon.className = doveAttachmentIcon(kind);
            icon.setAttribute('aria-hidden', 'true');
            button.appendChild(icon);
        }
        const label = document.createElement('span');
        label.className = 'dovecote-attachment-name';
        label.textContent = (att.name || 'attachment') + ' (' + doveFormatBytes(att.size) + ')';
        button.appendChild(label);
        button.addEventListener('click', () => doveOpenAttachment(att, viewAsOwner, 'open'));
        // contextMenu.attachToElement: public/scripts/comp/contextMenu.js
        contextMenu.attachToElement(button, doveAttachmentMenuConfig(att, viewAsOwner));
        bar.appendChild(button);
    });
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

// Vista's scrollbar inside the sandboxed message frame (#473): the frame's CSP allows only inline
// styles and data: images, so the generated frame sheet (scripts/build-vista-scrollbars.js, art
// inlined) goes into the srcdoc as a <style>, with the bar always shown as in Windows Mail's
// preview. Vista desktop only; fetched once.
let doveFrameScrollbarCss = null;
const doveFrameScrollbarStyle = async function () {
    const body = document.body;
    if (!body.classList.contains('desktop-mode') || body.classList.contains('windows-classic-theme')) return '';
    if (doveFrameScrollbarCss === null) {
        doveFrameScrollbarCss = fetch('/css/vista-scrollbars-frame.css')
            .then((response) => (response.ok ? response.text() : ''))
            .catch(() => '');
    }
    const css = await doveFrameScrollbarCss;
    if (!css) return '';
    return '<style>html { overflow-y: scroll; }\n' + css.replace(/<\/style/gi, '') + '</style>';
};

// Word wrap inside the message frame (#520): long lines, URLs and unbroken strings wrap instead of
// widening the frame; preformatted text keeps its spacing but wraps; images shrink to the frame.
// Placed first in <head> so the mail's own styles still win for everything but pre wrapping.
const DOVE_FRAME_WRAP_STYLE = '<style>'
    + 'body { overflow-wrap: anywhere; word-break: break-word; }\n'
    + 'pre, xmp, listing, plaintext { white-space: pre-wrap !important; overflow-wrap: anywhere; }\n'
    + 'img, video { max-width: 100%; height: auto; }\n'
    + 'table { max-width: 100%; }\n'
    + '.dovecote-wide-table { max-width: 100%; overflow-x: auto; }\n'
    + '</style>';

// A table that still cannot shrink to the frame (fixed widths, nowrap cells) scrolls sideways in
// its own box rather than pushing the whole message wider. Outermost overflowing tables only.
const doveWrapWideFrameTables = function (iframe) {
    const wrap = () => {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return;
        const limit = doc.documentElement.clientWidth;
        doc.body.querySelectorAll('table').forEach((table) => {
            if (table.parentElement && table.parentElement.closest('table, .dovecote-wide-table')) return;
            if (table.getBoundingClientRect().right <= limit + 1) return;
            const box = doc.createElement('div');
            box.className = 'dovecote-wide-table';
            table.parentNode.insertBefore(box, table);
            box.appendChild(table);
        });
    };
    iframe.addEventListener('load', wrap);
};

// options: { viewAsOwner, allowRemoteImages, isStale(), onLoadImages() }
// Inline images in rendered mail (Yukimi, Oct 14). The sanitizer (modules/dovecoteSanitize.js)
// marks cid: images as data-dove-cid and same-origin relative images as data-dove-local; here they
// become data: URLs from the mail's own attachments (matched by attachment id or file name, so a
// send_mail attachment given by vfsPath can be referenced as cid:<name> or by its vfsPath), and
// otherwise stay as same-origin URLs. Remote images blocked by Safe that point at this origin are
// restored too; true remote images still need Safe off (Load images / always-load sender).
const doveResolveInlineImages = async function (html, mail, viewAsOwner) {
    if (!/data-dove-(cid|local)|data-blocked-src/.test(html)) return html;
    const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    const attachments = (mail && mail.attachments) || [];
    const findAttachment = (ref) => {
        const key = String(ref || '').trim();
        if (!key) return null;
        const base = key.split('/').pop().split('?')[0];
        return attachments.find((a) => String(a.id) === key || a.name === key || a.name === base) || null;
    };
    const toDataUrl = async (att) => {
        if (!att || !(att.mimeType || '').startsWith('image/')) return null;
        const base64 = await doveFetchAttachmentBase64(att.id, viewAsOwner).catch(() => null);
        return base64 ? 'data:' + att.mimeType + ';base64,' + base64 : null;
    };
    const jobs = [];
    doc.querySelectorAll('img[data-dove-cid]').forEach((img) => {
        const ref = img.getAttribute('data-dove-cid').replace(/^cid:/i, '');
        jobs.push(toDataUrl(findAttachment(ref)).then((src) => { if (src) img.setAttribute('src', src); }));
    });
    doc.querySelectorAll('img[data-dove-local]').forEach((img) => {
        const local = img.getAttribute('data-dove-local');
        jobs.push(toDataUrl(findAttachment(local)).then((src) => { img.setAttribute('src', src || local); }));
    });
    doc.querySelectorAll('img[data-blocked-src]').forEach((img) => {
        try {
            const url = new URL(img.getAttribute('data-blocked-src'));
            if (url.origin === window.location.origin) img.setAttribute('src', url.href);
        } catch (_) { /* leave blocked */ }
    });
    await Promise.all(jobs);
    return doc.body.innerHTML;
};
// Links in the message body open in Alchemy (openGrimoireUrl: public/scripts/comp/featureLoader.js)
// instead of a new browser tab. mailto: and same-origin (in-app) links keep their default behaviour.
// The frame is sandboxed with allow-same-origin but never allow-scripts, so the parent can listen.
const doveWireFrameLinks = function (iframe) {
    const wire = () => {
        const doc = iframe.contentDocument;
        if (!doc || doc.__doveLinksWired) return;
        doc.__doveLinksWired = true;
        doc.addEventListener('click', (ev) => {
            const anchor = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
            if (!anchor) return;
            let url;
            try { url = new URL(anchor.getAttribute('href'), window.location.href); } catch (_) { return; }
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
            if (url.origin === window.location.origin) return;
            if (typeof openGrimoireUrl !== 'function') return;
            ev.preventDefault();
            openGrimoireUrl(url.href).catch(() => window.open(url.href, '_blank', 'noopener'));
        });
    };
    iframe.addEventListener('load', wire);
};
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
    const scrollbarStyle = await doveFrameScrollbarStyle();
    if (options.isStale && options.isStale()) return;

    const summary = doveSummarizeStrippedCounts(result.strippedCounts);
    els.safetyBar.classList.remove('hidden');
    els.safetyBar.title = 'Sanitized HTML' + (summary ? ' — ' + summary : '');

    const remoteImages = result.remoteImages || [];
    if (remoteImages.length > 0 && !options.allowRemoteImages) {
        doveRenderImagesBarInto(els, mail, options.onLoadImages);
    } else {
        els.imagesBar.classList.add('hidden');
    }

    const bodyHtml = await doveResolveInlineImages(result.html || '', mail, options.viewAsOwner);
    if (options.isStale && options.isStale()) return;
    els.bodyWrap.querySelectorAll('iframe, pre.dovecote-raw-body').forEach((node) => node.remove());
    const iframe = document.createElement('iframe');
    // allow-scripts must never be added: the server sanitizes HTML but an iframe that can execute
    // script would defeat that sanitization entirely. allow-popups only lets surviving <a target="_blank"> links open.
    iframe.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox allow-same-origin');
    iframe.className = 'dovecote-body-frame';
    iframe.srcdoc = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data: blob: https: http:; style-src \'unsafe-inline\'">' + DOVE_FRAME_WRAP_STYLE + scrollbarStyle + '</head><body>' + bodyHtml + '</body></html>';
    doveWireFrameLinks(iframe);
    doveWrapWideFrameTables(iframe);
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
    alwaysBtn.textContent = 'Always load images from ' + (doveDisplayAddress(mail.from) || 'sender');
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
    // Same as doveRenderMessageList: a sidebar reader has no main toolbar yet
    if (!desktopDovecoteEls || !desktopDovecoteEls.toolbar) return;
    const sel = doveMenuSelection();
    const readOnly = !!desktopDovecote.viewAsOwner;
    const noMail = sel.count === 0;
    desktopDovecoteEls.toolbar.querySelectorAll('[data-dove-mutating="true"]').forEach((btn) => {
        const action = btn.dataset.doveAction;
        let off = readOnly || (noMail && btn.dataset.doveNeedsMail === 'true');
        if (action === 'reply' || action === 'replyAll') off = off || sel.count !== 1;
        if (action === 'spam') off = off || !sel.anyNotSpam;
        if (action === 'notSpam') off = off || !sel.inSpam;
        if (action === 'restore') off = off || !sel.inDeleted;
        btn.disabled = off;
    });
    const countEl = document.getElementById('desktopDovecoteSelectedCount');
    if (countEl) {
        countEl.textContent = String(sel.count);
        countEl.dataset.state = sel.count > 1 ? 'on' : 'off';
        countEl.title = sel.count ? (sel.count + ' selected') : 'Selected messages';
        countEl.classList.toggle('hidden', sel.count < 2);
    }
};

// ---- Mutations ---------------------------------------------------------------

const doveToggleRead = async function () {
    const rows = doveSelectedMailRows();
    if (!rows.length || desktopDovecote.viewAsOwner) return;
    const markRead = rows.some((mail) => !mail.read);
    await doveMarkMailIds(rows.map((mail) => mail.id), { read: markRead }, { stay: true });
};

// Deleting from Trash is permanent: ask first (Vista message box).
const doveConfirmPermanentDelete = async function (count) {
    if (desktopDovecote.folder !== 'deleted') return true;
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    if (typeof showConfirmationDialog !== 'function') return window.confirm('Permanently delete ' + count + ' message(s)?');
    const answer = await showConfirmationDialog(
        'Permanently delete ' + (count === 1 ? 'this message' : count + ' messages') + '? This cannot be undone.',
        [
            { text: 'Delete', value: 'delete', className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        null,
        { title: 'Delete Permanently', icon: 'fas fa-trash' }
    );
    return answer === 'delete';
};

const doveDeleteSelected = async function () {
    const ids = desktopDovecote.selectedIds.slice();
    if (!ids.length && desktopDovecote.selectedMail) ids.push(desktopDovecote.selectedMail.id);
    if (!ids.length) return;
    if (!(await doveConfirmPermanentDelete(ids.length))) return;
    await doveMarkMailIds(ids, { deleted: true });
};

const doveRestoreSelected = async function () {
    const ids = desktopDovecote.selectedIds.slice();
    if (!ids.length && desktopDovecote.selectedMail) ids.push(desktopDovecote.selectedMail.id);
    if (!ids.length) return;
    await doveMarkMailIds(ids, { deleted: false });
};

const doveArchiveSelected = async function () {
    const ids = desktopDovecote.selectedIds.slice();
    if (!ids.length && desktopDovecote.selectedMail) ids.push(desktopDovecote.selectedMail.id);
    if (!ids.length) return;
    await doveMarkMailIds(ids, { archived: true });
};

const doveSpamSelected = async function (toSpam) {
    const ids = desktopDovecote.selectedIds.slice();
    if (!ids.length && desktopDovecote.selectedMail) ids.push(desktopDovecote.selectedMail.id);
    if (!ids.length) return;
    await doveMarkMailIds(ids, { spam: toSpam === true });
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
        subject = /^re:/i.test(mail.subject || '') ? mail.subject : 'Re: ' + (mail.subject || '');
        replyTo = mail.id;
        if (mode === 'reply') {
            to = mail.from || '';
        } else {
            const names = [];
            const pushName = (value) => {
                const list = Array.isArray(value) ? value : String(value || '').split(',');
                list.forEach((name) => {
                    const bare = String(name || '').trim().toLowerCase();
                    if (!bare || names.includes(bare) || bare === DESKTOP_DOVECOTE_HUMAN_OWNER) return;
                    names.push(bare);
                });
            };
            pushName(mail.from);
            pushName(mail.to);
            pushName(mail.cc);
            to = names.join(', ') || (mail.from || '');
        }
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
    modal.dataset.windowClient = 'light';
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
    modal.dataset.iconOwnerId = DESKTOP_DOVECOTE_MODAL_ID;
    modal.appendChild(doveBuildWindowTitle(doveComposeWindowTitle(initial.mode), 'fas fa-pen-to-square'));
    modal.appendChild(document.createElement('div')).className = 'modal-focus-overlay';
    modal.appendChild(doveBuildWindowControls(modal, closeCompose));

    // Vista light client with 7.css controls (#444), laid out as Windows Mail's New Message
    // (#473): Send / Attach on the blue command bar, the address block on the window face,
    // the white message body, a status bar.
    const content = document.createElement('div');
    content.className = 'modal-content win7 dovecote-client';
    const toolbar = document.createElement('div');
    toolbar.className = 'dovecote-command-bar';
    toolbar.setAttribute('role', 'toolbar');
    const sendBtn = doveCreateCommand('send', 'Send', 'fas fa-paper-plane', 'Send');
    toolbar.appendChild(sendBtn);
    toolbar.appendChild(doveCreateCommandSeparator());
    const attachBtn = doveCreateCommand('attach', 'Attach File to Message', 'fas fa-paperclip');
    toolbar.appendChild(attachBtn);
    content.appendChild(toolbar);
    const body = document.createElement('div');
    body.className = 'modal-body';
    const header = document.createElement('div');
    header.className = 'dovecote-compose-header';
    body.appendChild(header);

    // dovecote-compose-field-row: vertically centers the label against the input (the plain
    // form-row default is top-aligned, which looks off for a single-line label + input pair).
    const toRow = document.createElement('div');
    toRow.className = 'form-row dovecote-compose-field-row';
    const toLabel = document.createElement('label');
    toLabel.className = 'dovecote-compose-to-label';
    toLabel.textContent = 'To:';
    const toInput = document.createElement('input');
    toInput.type = 'text';
    toInput.className = 'form-control';
    toInput.value = doveFormatAddressList(initial.to);
    toInput.placeholder = 'name' + DOVE_ADDRESS_DOMAIN;
    toRow.appendChild(toLabel);
    toRow.appendChild(toInput);
    header.appendChild(toRow);

    const subjectRow = document.createElement('div');
    subjectRow.className = 'form-row dovecote-compose-field-row';
    const subjectLabel = document.createElement('label');
    subjectLabel.textContent = 'Subject:';
    const subjectInput = document.createElement('input');
    subjectInput.type = 'text';
    subjectInput.className = 'form-control';
    subjectInput.value = initial.subject;
    subjectRow.appendChild(subjectLabel);
    subjectRow.appendChild(subjectInput);
    header.appendChild(subjectRow);

    const bodyTextarea = document.createElement('textarea');
    bodyTextarea.className = 'form-control dovecote-compose-body';
    bodyTextarea.value = initial.body;
    body.appendChild(bodyTextarea);

    // Attachments (#3): picked files are read client-side to base64 (fileToBase64:
    // public/scripts/utils/referenceUtils.js) and held in pendingAttachments until Send.
    // Windows Mail lists them on an "Attach:" row under Subject once there are any.
    const pendingAttachments = [];
    const attachRow = document.createElement('div');
    attachRow.className = 'form-row dovecote-compose-field-row dovecote-compose-attach-row hidden';
    const attachLabel = document.createElement('label');
    attachLabel.textContent = 'Attach:';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.className = 'hidden';
    const attachList = document.createElement('div');
    attachList.className = 'dovecote-compose-attach-list';
    attachRow.appendChild(attachLabel);
    attachRow.appendChild(attachList);
    header.appendChild(attachRow);
    body.appendChild(fileInput);

    const renderAttachList = function () {
        attachList.replaceChildren();
        attachRow.classList.toggle('hidden', !pendingAttachments.length);
        pendingAttachments.forEach((att, index) => {
            const chip = document.createElement('span');
            chip.className = 'dovecote-compose-attach-chip';
            const icon = document.createElement('i');
            icon.className = (att.mimeType || '').startsWith('image/') ? 'fas fa-image' : 'fas fa-paperclip';
            icon.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span');
            name.textContent = att.name + ' (' + doveFormatBytes(att.size) + ')';
            const removeBtn = doveCreateButton('btn-secondary btn-small', 'Remove', 'fa-regular fa-xmark');
            removeBtn.addEventListener('click', () => {
                pendingAttachments.splice(index, 1);
                renderAttachList();
            });
            chip.appendChild(icon);
            chip.appendChild(name);
            chip.appendChild(removeBtn);
            attachList.appendChild(chip);
        });
    };

    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = '';
        for (const file of files) {
            if (file.size > DOVE_MAX_ATTACHMENT_BYTES) {
                doveShowError(`"${file.name}" exceeds the ${Math.round(DOVE_MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB per-file limit`);
                continue;
            }
            const totalSoFar = pendingAttachments.reduce((sum, att) => sum + att.size, 0);
            if (totalSoFar + file.size > DOVE_MAX_TOTAL_ATTACHMENT_BYTES) {
                doveShowError(`Attachments would exceed the ${Math.round(DOVE_MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024)}MB total limit`);
                continue;
            }
            // fileToBase64: public/scripts/utils/referenceUtils.js
            const base64 = await fileToBase64(file);
            pendingAttachments.push({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, base64: base64 });
        }
        renderAttachList();
    });

    // Send on the command bar; Windows Mail has no Cancel, the caption's close discards.
    sendBtn.addEventListener('click', () => doveSendComposeWindow(toInput, subjectInput, bodyTextarea, initial.replyTo, pendingAttachments, closeCompose));

    content.appendChild(body);
    const status = document.createElement('div');
    status.className = 'dovecote-status-bar';
    content.appendChild(status);
    modal.appendChild(content);
    requestAnimationFrame(() => toInput.focus());
    return modal;
};

const doveSendComposeWindow = async function (toInput, subjectInput, bodyTextarea, replyTo, attachments, onSent) {
    // Accepts 'menma' or 'menma@dream.co.jp'; the server only ever sees the bare mailbox name.
    const to = doveBareAddress(toInput.value);
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
        if (attachments && attachments.length) {
            request.attachments = attachments.map((att) => ({ name: att.name, mimeType: att.mimeType, base64: att.base64 }));
        }
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
    // Windows Mail's message window: the same blue command bar as the main window (#473).
    const toolbar = document.createElement('div');
    toolbar.className = 'dovecote-command-bar';
    toolbar.setAttribute('role', 'toolbar');

    const replyBtn = doveCreateCommand('reply', 'Reply', 'fas fa-reply', 'Reply');
    replyBtn.dataset.doveReaderAction = 'reply';
    const replyAllBtn = doveCreateCommand('replyAll', 'Reply All', 'fas fa-reply-all', 'Reply All');
    replyAllBtn.dataset.doveReaderAction = 'replyAll';
    const forwardBtn = doveCreateCommand('forward', 'Forward', 'fas fa-share', 'Forward');
    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(forwardBtn, doveMakeForwardMenuConfig(getMail));
    const toggleReadBtn = doveCreateCommand('read', 'Mark as Read / Unread', 'fas fa-envelope-open');
    toggleReadBtn.dataset.doveReaderAction = 'toggleRead';
    const deleteBtn = doveCreateCommand('delete', 'Delete', 'fas fa-trash');
    deleteBtn.dataset.doveReaderAction = 'delete';
    const archiveBtn = doveCreateCommand('archive', 'Move to Archive', 'fas fa-box-archive');
    archiveBtn.dataset.doveReaderAction = 'archive';
    const spamBtn = doveCreateCommand('spam', 'Move to Spam', 'fas fa-ban');
    spamBtn.dataset.doveReaderAction = 'spam';
    const notSpamBtn = doveCreateCommand('notSpam', 'Not spam', 'fas fa-inbox');
    notSpamBtn.dataset.doveReaderAction = 'notSpam';

    [replyBtn, replyAllBtn, forwardBtn, null, toggleReadBtn, deleteBtn, archiveBtn, spamBtn, notSpamBtn].forEach((btn) => {
        if (!btn) {
            toolbar.appendChild(doveCreateCommandSeparator());
            return;
        }
        btn.dataset.doveMutating = 'true';
        toolbar.appendChild(btn);
    });
    return toolbar;
};

const doveOpenReaderWindow = function (id, options) {
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
    doveLoadReaderMail(state, key, options);
};

const doveBuildReaderWindow = function (key) {
    const modalId = 'desktopDovecoteReader_' + key.replace(/[^A-Za-z0-9_-]/g, '_');
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal resizeable-window dovecote-reader-window hidden';
    modal.dataset.windowClient = 'light';
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
    modal.dataset.iconOwnerId = DESKTOP_DOVECOTE_MODAL_ID;
    modal.appendChild(doveBuildWindowTitle('Message', 'fas fa-envelope-open'));
    modal.appendChild(document.createElement('div')).className = 'modal-focus-overlay';
    modal.appendChild(doveBuildWindowControls(modal, closeReader));

    // Vista light client with 7.css controls (#444); the command bar is the client's first row
    const content = document.createElement('div');
    content.className = 'modal-content win7 dovecote-client';
    content.appendChild(toolbar);
    const body = document.createElement('div');
    body.className = 'modal-body';

    const built = doveBuildOeHeader({
        onBodyView: (view) => {
            state.bodyView = view;
            doveSetViewToggleState(built.viewToggle, view);
            if (state.mail) doveRenderReaderBody(state);
        }
    });
    const header = built.header;
    const fieldEls = built.fieldEls;
    body.appendChild(header);
    const spamReport = document.createElement('pre');
    spamReport.className = 'dovecote-spam-report hidden';
    body.appendChild(spamReport);

    const imagesBar = document.createElement('div');
    imagesBar.className = 'dovecote-images-bar hidden';
    body.appendChild(imagesBar);

    const attachmentsBar = document.createElement('div');
    attachmentsBar.className = 'dovecote-attachments-bar hidden';
    body.appendChild(attachmentsBar);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'dovecote-body-wrap';
    const loadingHint = document.createElement('p');
    loadingHint.className = 'form-hint dovecote-empty-hint';
    loadingHint.textContent = 'Loading…';
    bodyWrap.appendChild(loadingHint);
    const safetyBar = built.safetyBar;
    body.appendChild(bodyWrap);

    content.appendChild(body);
    modal.appendChild(content);

    state.els = {
        oeFrom: fieldEls.from,
        oeRoute: fieldEls.route,
        oeTo: fieldEls.to,
        oeOriginalTo: fieldEls.originalTo,
        oeCc: fieldEls.cc,
        oeSubject: fieldEls.subject,
        oeDate: fieldEls.date,
        oeSpam: fieldEls.spam,
        oeAuth: fieldEls.auth,
        spamReport: spamReport,
        forgedBadge: built.forgedBadge,
        safetyBar: safetyBar,
        imagesBar: imagesBar,
        attachmentsBar: attachmentsBar,
        bodyWrap: bodyWrap,
        loadingHint: loadingHint
    };

    toolbar.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-dove-reader-action]');
        if (!btn) return;
        doveDispatchReaderAction(state, btn.dataset.doveReaderAction);
    });

    return state;
};

const doveLoadReaderMail = async function (state, id, options) {
    const request = { id: id };
    if (desktopDovecote.viewAsOwner && !(options && options.ownMailbox)) request.viewAsOwner = desktopDovecote.viewAsOwner;
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
    doveRenderAttachmentsInto(state.els, mail, desktopDovecote.viewAsOwner);
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
        case 'spam': doveReaderMarkSelected(state, { spam: true }); return;
        case 'notSpam': doveReaderMarkSelected(state, { spam: false }); return;
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
    if (patch && patch.deleted === true && mail.folder === 'deleted') {
        const prev = desktopDovecote.folder;
        desktopDovecote.folder = 'deleted';
        const ok = await doveConfirmPermanentDelete(1);
        desktopDovecote.folder = prev;
        if (!ok) return;
    }
    try {
        await wsClient.sendMessage('dovecote_mark_mail', Object.assign({ id: mail.id }, patch));
        if (doveSelectedIdSet().has(String(mail.id)) || String(desktopDovecote.selectedId) === String(mail.id)) {
            doveClearSelection();
            doveRenderPreview();
        }
        if (desktopDovecote.loaded) doveLoadFolder(desktopDovecote.folder);
        state.modal.querySelector('.modal-window-controls .close-btn').click();
    } catch (err) {
        doveShowError((err && err.message) || 'Could not update message');
    }
};

// ---- New mail tool window --------------------------------------------------------
// Bottom-right of the work area, above the taskbar (placeDesktopWindow). A Vista message
// box: envelope, From, Subject, a short preview, Read and Close. One window; a later
// message replaces the preview. Not a taskbar button (TASKBAR_SYSTEM_MODAL_IDS).

const DOVE_NEW_MAIL_ID = 'dovecoteNewMailModal';
const DOVE_NEW_MAIL_PARENT = 'dovecoteNewMailAnchor';
let doveNewMailToken = 0;

const dovePlaceNewMail = function (modal) {
    // clearModalPixelAnchor: public/scripts/comp/modalUtils.js
    // placeDesktopWindow: public/scripts/comp/melatonNetworkDialogs.js
    if (typeof clearModalPixelAnchor === 'function') clearModalPixelAnchor(modal);
    if (window.melatonNetworkDialogs) melatonNetworkDialogs.placeDesktopWindow(modal);
};

const doveEnsureNewMailModal = function () {
    let modal = document.getElementById(DOVE_NEW_MAIL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = DOVE_NEW_MAIL_ID;
    modal.className = 'modal hidden transient tool-window on-top';
    modal.dataset.windowClient = 'light';
    modal.dataset.windowPositionMode = 'manual-only';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'New Mail');

    const title = document.createElement('div');
    title.className = 'modal-window-title';
    const titleMain = document.createElement('div');
    titleMain.className = 'modal-window-title-main';
    const titleIcon = document.createElement('i');
    titleIcon.className = 'fas fa-envelope icon-fa';
    titleIcon.setAttribute('aria-hidden', 'true');
    const titleImage = document.createElement('img');
    titleImage.className = 'icon-image';
    titleImage.alt = '';
    titleImage.src = '/static_images/app_icons/48/vista-mail.webp';
    const titleText = document.createElement('span');
    titleText.textContent = 'New Mail';
    titleMain.appendChild(titleIcon);
    titleMain.appendChild(titleImage);
    titleMain.appendChild(titleText);
    title.appendChild(titleMain);

    const controls = document.createElement('div');
    controls.className = 'modal-window-controls';
    const closeBtn = doveCreateButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
    controls.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'modal-content win7';

    const body = document.createElement('div');
    body.className = 'dovecote-new-mail';
    const icon = document.createElement('img');
    icon.className = 'dovecote-new-mail-icon';
    icon.alt = '';
    icon.src = '/static_images/app_icons/vista-mail.webp';
    const text = document.createElement('div');
    text.className = 'dovecote-new-mail-text';
    const count = document.createElement('p');
    count.className = 'dovecote-new-mail-count hidden';
    const from = document.createElement('p');
    from.className = 'dovecote-new-mail-from';
    const subject = document.createElement('p');
    subject.className = 'dovecote-new-mail-subject';
    const preview = document.createElement('p');
    preview.className = 'dovecote-new-mail-preview hidden';
    text.appendChild(count);
    text.appendChild(from);
    text.appendChild(subject);
    text.appendChild(preview);
    body.appendChild(icon);
    body.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'dovecote-new-mail-actions';
    const readBtn = doveCreateButton('btn-primary', 'Read');
    readBtn.dataset.dialogPrimary = '1';
    readBtn.textContent = 'Read';
    const dismissBtn = doveCreateButton('btn-secondary', 'Close');
    dismissBtn.textContent = 'Close';
    actions.appendChild(readBtn);
    actions.appendChild(dismissBtn);

    content.appendChild(body);
    content.appendChild(actions);
    modal.appendChild(title);
    modal.appendChild(controls);
    modal.appendChild(content);
    document.body.appendChild(modal);

    const dismiss = () => {
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    };
    closeBtn.addEventListener('click', dismiss);
    dismissBtn.addEventListener('click', dismiss);
    readBtn.addEventListener('click', () => {
        const id = modal.dataset.doveMailId;
        dismiss();
        if (id) doveOpenReaderWindow(id, { ownMailbox: true });
    });
    modal.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        dismiss();
    });
    return modal;
};

function dovePresentNewMail(mail, count) {
    const modal = doveEnsureNewMailModal();
    modal.dataset.doveMailId = String(mail.id);
    const countEl = modal.querySelector('.dovecote-new-mail-count');
    const fromEl = modal.querySelector('.dovecote-new-mail-from');
    const subjectEl = modal.querySelector('.dovecote-new-mail-subject');
    const previewEl = modal.querySelector('.dovecote-new-mail-preview');
    if (count > 1) {
        countEl.textContent = 'You have ' + count + ' new messages';
        countEl.classList.remove('hidden');
    } else {
        countEl.textContent = '';
        countEl.classList.add('hidden');
    }
    fromEl.textContent = 'From: ' + (doveDisplayAddress(mail.from) || '');
    subjectEl.textContent = 'Subject: ' + (mail.subject || '(no subject)');
    const snippet = String(mail.snippet || '').trim();
    previewEl.textContent = snippet;
    previewEl.classList.toggle('hidden', !snippet);
    // closeModal strips the parent link; set it again so this toast is not tied to
    // whichever window is active (openModal would otherwise close it with that window).
    modal.setAttribute('data-parent-modal-id', DOVE_NEW_MAIL_PARENT);
    doveShowWindow(modal);
    requestAnimationFrame(() => dovePlaceNewMail(modal));
};

// showPopover: public/scripts/comp/popoverManager.js
function doveMailBalloon(title, body) {
    const icon = document.getElementById('dovecoteTrayIcon');
    if (!icon || icon.classList.contains('hidden')) return;
    showPopover(
        icon,
        'info',
        title,
        body,
        false,
        8000,
        '<img src="/static_images/vista-icons/dovecote-32.png" alt="" width="32" height="32">',
        null,
        { position: 'top', arrowPosition: 'bottom-right', popupId: 'mail' }
    );
}

function doveShowUnreadBalloon(unread) {
    const n = unread === 1 ? '1 unread message' : unread + ' unread messages';
    doveMailBalloon('You have mail', 'You have ' + n + ' in your Inbox.');
}

const doveShowNewMail = async function (count) {
    const token = ++doveNewMailToken;
    try {
        // dovecote_list_mail: modules/ws/handlers/250-dovecoteHandler.js
        const result = await wsClient.sendMessage('dovecote_list_mail', {
            folder: 'inbox',
            unreadOnly: true,
            limit: 1
        }, false);
        if (token !== doveNewMailToken) return;
        const mail = result && result.mail && result.mail[0];
        if (!mail) return;
        if (window.cplMail && !window.cplMail.dialogOn()) return;
        const from = doveDisplayAddress(mail.from) || '';
        const subject = mail.subject || '(no subject)';
        const body = count > 1
            ? 'You have ' + count + ' new messages.'
            : (from ? 'From: ' + from + '. ' : '') + subject;
        doveMailBalloon('New mail', body);
    } catch (_err) {
        // The tray badge already updated; the balloon is optional.
    }
};

// ---- Tray icon (#dovecoteTrayIcon, public/app.html) ------------------------------
// Same pattern as #directorTrayIcon (public/scripts/comp/director.js): hidden by
// default, revealed by systemTrayManager.js's staggered boot sequence, shows/hides
// live from here afterward. The glyph is the mail program icon, and a closed
// envelope once the Inbox has unread mail. The icon stays in the tray at zero.

let doveTrayInitialized = false;
let doveLastUnread = null;
let doveHasAnnouncedMail = false;
let doveTrayRegistered = false;
// Inbox ids already seen this session. A delete/mark/move/refresh/page must not
// re-play the new-mail sound just because the unread count moved.
const doveNotifiedMailIds = new Set();
// Primed after the first note (even an empty inbox), so the first mail into an
// empty inbox still dings. Newest createdAt seen: an old id that reappears
// (not-spam, restore, mark unread on an unpaged row) is not "new mail".
let doveNotifyPrimed = false;
let doveNotifyNewestAt = '';
// Login fills the tray with balloons. The mail icon waits, then the unread balloon can be seen.
const DOVE_TRAY_REGISTER_DELAY_MS = 60000;

const doveCollectFreshMailIds = function (seen, mail) {
    const fresh = [];
    (Array.isArray(mail) ? mail : []).forEach((item) => {
        const id = item && item.id != null ? String(item.id) : '';
        if (!id) return;
        if (!seen.has(id)) fresh.push(id);
        seen.add(id);
    });
    return fresh;
};

const doveNoteMailIds = function (mail, options) {
    const announce = !!(options && options.announce) && doveNotifyPrimed;
    const watermark = doveNotifyNewestAt;
    const fresh = doveCollectFreshMailIds(doveNotifiedMailIds, mail);
    (Array.isArray(mail) ? mail : []).forEach((item) => {
        const at = item && item.createdAt ? String(item.createdAt) : '';
        if (at > doveNotifyNewestAt) doveNotifyNewestAt = at;
    });
    doveNotifyPrimed = true;
    if (announce && fresh.length) {
        const freshSet = new Set(fresh);
        const newer = (Array.isArray(mail) ? mail : []).filter((item) => item && freshSet.has(String(item.id))
            && (!item.createdAt || String(item.createdAt) > watermark));
        if (newer.length) dovePlayNewMailAlert(newer.length);
    }
    return fresh;
};

const dovePlayNewMailAlert = function (count) {
    if (!doveTrayRegistered || (typeof isDesktopTrayBootPending === 'function' && isDesktopTrayBootPending())) {
        return;
    }
    // cplMail: public/scripts/comp/cplMail.js — Windows Mail's "Play sound when new messages arrive"
    const mailSettings = window.cplMail;
    if (!mailSettings || mailSettings.soundOn()) {
        // desktopSounds.play: public/scripts/comp/desktopSounds.js
        desktopSounds.play('notify');
    }
    if (!mailSettings || mailSettings.dialogOn()) doveShowNewMail(count);
};

// options: { reveal } — same two-phase boot convention as updateFixedCreditsIndicator
// (public/scripts/comp/trayIndicators.js): reveal:false sets state without showing,
// reveal:true (or omitted, post-boot) shows/hides for real. Never plays the new-mail
// sound; that is doveNoteMailIds({ announce: true }) when a new inbox id appears.
const doveApplyTrayBadge = function (unread, options) {
    const icon = document.getElementById('dovecoteTrayIcon');
    const badge = document.getElementById('dovecoteTrayBadge');
    if (!icon || !badge) return;
    const opts = options || {};
    // isDesktopTrayBootPending: public/scripts/comp/trayIndicators.js
    const reveal = opts.reveal !== false && !isDesktopTrayBootPending() && doveTrayRegistered;
    doveLastUnread = unread;
    icon.classList.toggle('hidden', !reveal);
    icon.classList.toggle('has-unread', unread > 0);
    if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.remove('hidden');
        icon.title = 'Dovecote — ' + unread + ' unread';
        if (reveal && !doveHasAnnouncedMail) {
            const mailSettings = window.cplMail;
            if (!mailSettings || mailSettings.dialogOn()) doveShowUnreadBalloon(unread);
            doveHasAnnouncedMail = true;
        }
    } else {
        badge.classList.add('hidden');
        icon.title = 'Dovecote';
    }
};

const doveRefreshTrayUnread = async function (options) {
    try {
        // dovecote_list_mailboxes: modules/ws/handlers/250-dovecoteHandler.js
        const result = await wsClient.sendMessage('dovecote_list_mailboxes', {}, false);
        const mailboxes = (result && result.mailboxes) || [];
        const mine = mailboxes.find((box) => box.owner === DESKTOP_DOVECOTE_HUMAN_OWNER);
        doveApplyTrayBadge(mine ? (mine.unread || 0) : 0, options);
        if (!doveNotifiedMailIds.size) {
            const listed = await wsClient.sendMessage('dovecote_list_mail', { folder: 'inbox', limit: 200 }, false);
            doveNoteMailIds(listed && listed.mail, { announce: false });
        }
    } catch (_) {
        // Non-critical background refresh.
    }
};

// Keeps the tray badge live whenever the main window already has the human's own inbox
// unread count in hand, without an extra round trip — doveLoadFolder('inbox') and
// doveRefreshInboxBadgeOnly both land here, same as doveRenderInboxBadge.
const doveRenderInboxBadgeFromState = function () {
    if (desktopDovecote.viewAsOwner) return;
    // Folder-wide unread from list_mail, not the loaded page — pagination and
    // deletes must not paint the tray from a 50-row slice.
    if (desktopDovecote.loaded && desktopDovecote.folder === 'inbox' && desktopDovecote.folderUnread != null) {
        doveApplyTrayBadge(desktopDovecote.folderUnread);
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
        doveToggleTrayInbox();
        // PopoverManager.hide: public/scripts/comp/popoverManager.js
        PopoverManager.hide(icon);
    });
    doveRefreshTrayUnread({ reveal: false });
    setTimeout(() => {
        doveTrayRegistered = true;
        doveRefreshTrayUnread({ reveal: true });
    }, DOVE_TRAY_REGISTER_DELAY_MS);
}

let doveInboxFlyout = null;
let doveInboxAnchor = null;

const doveHideInboxFlyout = function () {
    if (doveInboxFlyout) doveInboxFlyout.classList.add('hidden');
};

const dovePlaceInboxFlyout = function () {
    if (!doveInboxFlyout) return;
    const width = doveInboxFlyout.offsetWidth || 300;
    const margin = 8;
    let rect = doveInboxAnchor ? doveInboxAnchor.getBoundingClientRect() : null;
    if (!rect || !rect.width) {
        const taskbar = document.getElementById('desktopTaskbar');
        const top = taskbar ? taskbar.getBoundingClientRect().top : innerHeight - 40;
        rect = { right: innerWidth - margin, top };
    }
    const right = Math.max(margin, innerWidth - rect.right - 12);
    const left = Math.min(innerWidth - width - margin, innerWidth - right - width);
    doveInboxFlyout.style.left = Math.max(margin, left) + 'px';
    doveInboxFlyout.style.bottom = Math.max(margin, innerHeight - rect.top + 6) + 'px';
};

const doveFillInboxFlyout = async function (preloaded) {
    const list = doveInboxFlyout.querySelector('.dove-inbox-flyout-list');
    list.replaceChildren();
    const waiting = document.createElement('p');
    waiting.className = 'dove-inbox-flyout-empty';
    waiting.textContent = 'Loading...';
    list.appendChild(waiting);
    let mail = Array.isArray(preloaded) ? preloaded : null;
    if (!mail) {
        try {
            // dovecote_list_mail: modules/ws/handlers/250-dovecoteHandler.js
            const result = await wsClient.sendMessage('dovecote_list_mail', { folder: 'inbox', limit: 8 }, false);
            mail = (result && result.mail) || [];
        } catch (_) {
            waiting.textContent = 'Dovecote is not available';
            return;
        }
    }
    if (!doveInboxFlyout || doveInboxFlyout.classList.contains('hidden')) return;
    list.replaceChildren();
    if (!mail.length) {
        const empty = document.createElement('p');
        empty.className = 'dove-inbox-flyout-empty';
        empty.textContent = 'No messages';
        list.appendChild(empty);
        dovePlaceInboxFlyout();
        return;
    }
    doveNoteMailIds(mail, { announce: false });
    mail.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'dove-inbox-flyout-row';
        if (!item.read) row.classList.add('unread');
        if (item.attachments && item.attachments.length) row.classList.add('has-attachment');
        row.dataset.doveMailId = item.id;
        const mark = document.createElement('span');
        mark.className = 'dove-inbox-flyout-mark';
        const clip = document.createElement('span');
        clip.className = 'dove-inbox-flyout-clip';
        const subject = document.createElement('span');
        subject.className = 'dove-inbox-flyout-subject';
        subject.textContent = item.subject || '(no subject)';
        const from = document.createElement('span');
        from.className = 'dove-inbox-flyout-from';
        from.textContent = doveDisplayAddress(item.from) || '';
        row.appendChild(mark);
        row.appendChild(clip);
        row.appendChild(subject);
        row.appendChild(from);
        list.appendChild(row);
    });
    dovePlaceInboxFlyout();
};

const doveEnsureInboxFlyout = function () {
    if (doveInboxFlyout) return doveInboxFlyout;
    const flyout = document.createElement('div');
    flyout.id = 'doveInboxFlyout';
    flyout.className = 'dove-inbox-flyout hidden';
    flyout.setAttribute('role', 'dialog');
    flyout.setAttribute('aria-label', 'Inbox');
    flyout.innerHTML = '<div class="dove-inbox-flyout-body"><div class="dove-inbox-flyout-heading">Inbox</div><div class="dove-inbox-flyout-list"></div></div><div class="dove-inbox-flyout-links"><button type="button" class="dove-inbox-flyout-link" data-dove-flyout="open">Open Dovecote</button></div>';
    flyout.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const link = ev.target.closest('[data-dove-flyout]');
        if (link) {
            doveHideInboxFlyout();
            openDesktopDovecote();
            return;
        }
        const row = ev.target.closest('.dove-inbox-flyout-row');
        if (!row) return;
        doveHideInboxFlyout();
        doveOpenReaderWindow(row.dataset.doveMailId, { ownMailbox: true });
    });
    document.body.appendChild(flyout);
    document.addEventListener('pointerdown', (ev) => {
        if (!doveInboxFlyout || doveInboxFlyout.classList.contains('hidden')) return;
        if (doveInboxFlyout.contains(ev.target)) return;
        if (doveInboxAnchor && doveInboxAnchor.contains(ev.target)) return;
        doveHideInboxFlyout();
    }, true);
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && doveInboxFlyout && !doveInboxFlyout.classList.contains('hidden')) doveHideInboxFlyout();
    }, true);
    doveInboxFlyout = flyout;
    return flyout;
};

const doveToggleTrayInbox = function () {
    const flyout = doveEnsureInboxFlyout();
    if (!flyout.classList.contains('hidden')) {
        doveHideInboxFlyout();
        return;
    }
    doveInboxAnchor = document.getElementById('dovecoteTrayIcon');
    flyout.classList.remove('hidden');
    doveFillInboxFlyout();
    dovePlaceInboxFlyout();
};

// dovecote_mailbox_updated: modules/ws/handlers/250-dovecoteHandler.js
// Pushed when a mailbox changes (send, read, mark, forward, delete), including MCP.
const doveOnMailboxUpdated = function (message) {
    const data = message && (message.data || message);
    if (!data || !Array.isArray(data.mailboxes)) return;
    doveBadgeToken++;
    desktopDovecote.mailboxes = data.mailboxes;
    const human = data.mailboxes.find((box) => box.owner === DESKTOP_DOVECOTE_HUMAN_OWNER);
    doveApplyTrayBadge(human ? (human.unread || 0) : 0);
    const humanInbox = data.inbox && data.inbox[DESKTOP_DOVECOTE_HUMAN_OWNER];
    const humanUnread = data.unreadInbox && data.unreadInbox[DESKTOP_DOVECOTE_HUMAN_OWNER];
    doveNoteMailIds(Array.isArray(humanUnread) ? humanUnread : [], { announce: true });
    doveNoteMailIds(Array.isArray(humanInbox) ? humanInbox : [], { announce: false });
    document.dispatchEvent(new CustomEvent('dovecoteMailboxUpdated', { detail: data }));

    const owners = Array.isArray(data.owners) ? data.owners : [];
    if (doveInboxFlyout && !doveInboxFlyout.classList.contains('hidden') && Array.isArray(humanInbox) && owners.indexOf(DESKTOP_DOVECOTE_HUMAN_OWNER) !== -1) {
        doveFillInboxFlyout(humanInbox.slice(0, 8));
    }
    if (!desktopDovecote.loaded || !desktopDovecoteEls) return;
    doveRenderMailboxBanner();
    doveRenderWindowTitle();
    doveRenderFolderTree();

    const viewing = desktopDovecote.viewAsOwner || DESKTOP_DOVECOTE_HUMAN_OWNER;
    if (owners.indexOf(viewing) === -1) return;
    const pushedInbox = data.inbox && data.inbox[viewing];
    if (desktopDovecote.folder === 'inbox' && Array.isArray(pushedInbox)) {
        doveFolderToken++;
        const meta = (data.inboxMeta && data.inboxMeta[viewing]) || {};
        doveApplyListPage({
            mail: pushedInbox,
            nextCursor: meta.nextCursor,
            hasMore: meta.hasMore,
            total: meta.total,
            unread: meta.unread != null ? meta.unread : (human && viewing === DESKTOP_DOVECOTE_HUMAN_OWNER ? human.unread : undefined)
        }, false);
        doveNoteMailIds(pushedInbox, { announce: false });
        doveRenderMessageList();
        const box = data.mailboxes.find((entry) => entry.owner === viewing);
        doveRenderInboxBadge(box ? (box.unread || 0) : (meta.unread != null ? meta.unread : 0));
        return;
    }
    doveLoadFolder(desktopDovecote.folder, human ? { inboxUnread: human.unread || 0 } : null);
};

let doveMailboxPushBound = false;

const doveBindMailboxPush = function () {
    if (doveMailboxPushBound || typeof wsClient === 'undefined' || !wsClient || !wsClient.on) return;
    doveMailboxPushBound = true;
    // wsClient.on / registerRefreshCallback: public/scripts/websocket.js
    wsClient.on('dovecote_mailbox_updated', doveOnMailboxUpdated);
    if (wsClient.registerRefreshCallback) {
        wsClient.registerRefreshCallback('dovecote-mailbox', 45, () => {
            doveRefreshTrayUnread();
            if (desktopDovecote.loaded) doveLoadFolder(desktopDovecote.folder);
            document.dispatchEvent(new CustomEvent('dovecoteMailboxUpdated'));
        });
    }
};

doveBindMailboxPush();

if (typeof module !== 'undefined' && module.exports) {
    module.exports._test = {
        doveCollectFreshMailIds: doveCollectFreshMailIds,
        doveNotifiedMailIds: doveNotifiedMailIds
    };
}

