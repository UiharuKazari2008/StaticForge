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

// The folder tree (Windows Mail's Folder Bar drop-down, doveBuildFolderBar): Local Folders is
// the human's own mailbox; the bot mailboxes sit where Windows Mail keeps Microsoft Communities.
const DOVE_LOCAL_FOLDERS_LABEL = 'Local Folders';
const DOVE_COMMUNITIES_LABEL = 'Dreamscape Communities';

// Keep in sync with modules/dovecoteMail.js MAX_ATTACHMENT_BYTES / MAX_TOTAL_ATTACHMENT_BYTES —
// client-side limits are only a fast, friendly check; the server enforces these for real.
const DOVE_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const DOVE_MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

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
    inboxUnread: 0,
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
const doveBareAddress = function (value) {
    return String(value || '').split(',').map((part) => {
        const t = part.trim();
        return t.toLowerCase().endsWith(DOVE_ADDRESS_DOMAIN) ? t.slice(0, -DOVE_ADDRESS_DOMAIN.length) : t;
    }).filter(Boolean).join(', ');
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
    titleImage.src = '/static_images/app_icons/vista-mail.png';
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
    [toggleReadBtn, deleteBtn, archiveBtn].forEach((btn) => {
        btn.dataset.doveMutating = 'true';
        btn.dataset.doveNeedsMail = 'true';
        toolbar.appendChild(btn);
    });

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

const DOVE_MENUS = {
    file: () => {
        const mail = desktopDovecote.selectedMail;
        const readOnly = !!desktopDovecote.viewAsOwner;
        return [
            doveMenuItem('New Message', 'create', { disabled: readOnly }),
            doveMenuItem('Open', 'open', { disabled: !mail }),
            { separator: true },
            doveMenuItem('Close', 'close')
        ];
    },
    edit: () => {
        const mail = desktopDovecote.selectedMail;
        const off = !mail || !!desktopDovecote.viewAsOwner;
        return [
            doveMenuItem('Delete', 'delete', { disabled: off }),
            doveMenuItem(mail && !mail.read ? 'Mark as Read' : 'Mark as Unread', 'toggleRead', { disabled: off }),
            doveMenuItem('Move to Archive', 'archive', { disabled: off }),
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
        const mail = desktopDovecote.selectedMail;
        const readOnly = !!desktopDovecote.viewAsOwner;
        const others = doveOtherMailboxes();
        return [
            doveMenuItem('New Message', 'create', { disabled: readOnly }),
            { separator: true },
            doveMenuItem('Reply to Sender', 'reply', { disabled: readOnly || !mail }),
            doveMenuItem('Reply to All', 'replyAll', { disabled: readOnly || !mail }),
            {
                text: 'Forward',
                disabled: readOnly || !mail || !others.length,
                submenu: others.map((box) => doveMenuItem(box.label, 'forward', { doveOwner: box.owner }))
            }
        ];
    }
};

const doveRunMenuAction = function (item) {
    const mail = desktopDovecote.selectedMail;
    switch (item.doveMenu) {
        case 'open': if (mail) doveOpenReaderWindow(mail.id); return;
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
        case 'forward': if (mail) doveOpenCompose('forward', mail, item.doveOwner); return;
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
    const folderRows = (owner, level) => DESKTOP_DOVECOTE_FOLDERS.map((folder) => doveBuildTreeRow({
        level: level,
        label: folder.label,
        icon: folder.id,
        owner: owner,
        folder: folder.id,
        count: folder.id === 'inbox' ? unreadOf(owner) : 0,
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

const doveBuildMailRowMenuSections = function (mailId) {
    const mail = desktopDovecote.mail.find((m) => String(m.id) === String(mailId));
    if (!mail) return [];
    const readOnly = !!desktopDovecote.viewAsOwner;
    const others = doveOtherMailboxes();
    return [{
        type: 'list',
        items: [
            { text: 'Open', icon: 'fas fa-envelope-open-text', action: 'dove-row-open', doveMailId: mailId },
            { text: 'Open in Window', icon: 'fas fa-up-right-from-square', action: 'dove-row-open-window', doveMailId: mailId },
            { separator: true },
            { text: 'Reply', icon: 'fas fa-reply', action: 'dove-row-reply', doveMailId: mailId, disabled: readOnly },
            {
                text: 'Forward',
                icon: 'fas fa-share',
                disabled: readOnly || !others.length,
                submenu: others.length
                    ? others.map((box) => ({
                        text: box.label,
                        icon: doveIsBotOwner(box.owner) ? 'fas fa-robot' : 'fas fa-user',
                        action: 'dove-row-forward',
                        doveMailId: mailId,
                        doveOwner: box.owner
                    }))
                    : [{ text: 'No other mailboxes', disabled: true }]
            },
            { separator: true },
            { text: mail.read ? 'Mark Unread' : 'Mark Read', icon: 'fas fa-envelope', action: 'dove-row-toggle-read', doveMailId: mailId, disabled: readOnly },
            { text: 'Archive', icon: 'fas fa-box-archive', action: 'dove-row-archive', doveMailId: mailId, disabled: readOnly },
            { text: 'Delete', icon: 'fas fa-trash', action: 'dove-row-delete', doveMailId: mailId, disabled: readOnly, className: 'context-menu-item-danger' }
        ]
    }];
};

const doveHandleMailRowMenuAction = function (item) {
    const mailId = item.doveMailId;
    if (!mailId) return;
    switch (item.action) {
        case 'dove-row-open': doveSelectMail(mailId); return;
        case 'dove-row-open-window': doveOpenReaderWindow(mailId); return;
        case 'dove-row-reply': doveReplyToMailId(mailId); return;
        case 'dove-row-forward': doveForwardMailId(mailId, item.doveOwner); return;
        case 'dove-row-toggle-read': doveToggleReadForId(mailId); return;
        case 'dove-row-archive': doveMarkMailId(mailId, { archived: true }); return;
        case 'dove-row-delete': doveMarkMailId(mailId, { deleted: true }); return;
        default: return;
    }
};

// Reply/Forward need the full message body, which the list summaries don't carry —
// dovecote_get_mail: modules/ws/handlers/250-dovecoteHandler.js (also marks it read).
const doveFetchMailFull = async function (id) {
    const request = { id: id };
    if (desktopDovecote.viewAsOwner) request.viewAsOwner = desktopDovecote.viewAsOwner;
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
    const mail = await doveFetchMailFull(id);
    if (mail) doveOpenCompose('forward', mail, owner);
};

const doveToggleReadForId = async function (id) {
    const mail = desktopDovecote.mail.find((m) => String(m.id) === String(id));
    if (!mail || desktopDovecote.viewAsOwner) return;
    try {
        await wsClient.sendMessage('dovecote_mark_mail', { id: id, read: !mail.read });
        mail.read = !mail.read;
        if (desktopDovecote.selectedMail && String(desktopDovecote.selectedMail.id) === String(id)) {
            desktopDovecote.selectedMail.read = mail.read;
        }
        doveRenderMessageList();
        doveRenderInboxBadgeFromState();
    } catch (err) {
        doveShowError((err && err.message) || 'Could not update read state');
    }
};

const doveMarkMailId = async function (id, patch) {
    if (desktopDovecote.viewAsOwner) return;
    try {
        await wsClient.sendMessage('dovecote_mark_mail', Object.assign({ id: id }, patch));
        if (desktopDovecote.selectedId && String(desktopDovecote.selectedId) === String(id)) {
            desktopDovecote.selectedId = null;
            desktopDovecote.selectedMail = null;
            doveRenderPreview();
        }
        doveLoadFolder(desktopDovecote.folder);
    } catch (err) {
        doveShowError((err && err.message) || 'Could not update message');
    }
};

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
        doveSelectMail(row.dataset.doveMailId);
    });
    rows.addEventListener('dblclick', (ev) => {
        const row = ev.target.closest('[data-dove-mail-id]');
        if (!row) return;
        doveOpenReaderWindow(row.dataset.doveMailId);
    });
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

// Message header block shared by the inline preview and reader windows: the four compact
// From/To/Subject/Date rows on the left, and a right-aligned tools column (Safe badge +
// Rendered/Raw) spanning those rows, vertically centred. Nothing overlays the body.
// options: { idPrefix, badgeId, onBodyView(view) }. Returns { header, fieldEls, safetyBar, viewToggle }.
const doveBuildOeHeader = function (options) {
    const opts = options || {};
    const header = document.createElement('div');
    header.className = 'dovecote-oe-header';
    const fields = document.createElement('div');
    fields.className = 'dovecote-oe-header-fields';
    const fieldEls = {};
    ['from', 'to', 'subject', 'date'].forEach((field) => {
        const cap = field.charAt(0).toUpperCase() + field.slice(1);
        const row = document.createElement('div');
        row.className = 'dovecote-oe-header-row';
        row.dataset.doveField = field;
        const labelEl = document.createElement('span');
        labelEl.className = 'dovecote-oe-header-label';
        labelEl.textContent = cap + ':';
        const valueEl = document.createElement('span');
        valueEl.className = 'dovecote-oe-header-value';
        if (opts.idPrefix) valueEl.id = opts.idPrefix + cap;
        row.appendChild(labelEl);
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
    const viewToggle = doveBuildBodyViewToggle(opts.onBodyView);
    tools.appendChild(viewToggle);
    header.appendChild(tools);
    return { header: header, fieldEls: fieldEls, safetyBar: badge, viewToggle: viewToggle };
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

    const built = doveBuildOeHeader({ idPrefix: 'desktopDovecoteOe', badgeId: 'desktopDovecoteSafetyBar' });
    const header = built.header;
    header.id = 'desktopDovecoteOeHeader';
    preview.appendChild(header);

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
        oeTo: document.getElementById('desktopDovecoteOeTo'),
        oeSubject: document.getElementById('desktopDovecoteOeSubject'),
        oeDate: document.getElementById('desktopDovecoteOeDate'),
        searchGroup: document.getElementById('desktopDovecoteSearchGroup'),
        searchInput: document.getElementById('desktopDovecoteSearchInput'),
        mainPane: document.getElementById('desktopDovecoteMainPane')
    });
};

const doveWireEvents = function () {
    desktopDovecoteEls.modal.addEventListener('click', doveHandleBodyClick);
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

const doveLoadFolder = async function (folder) {
    desktopDovecote.folder = folder;
    doveRenderFolderButton();
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
        if (mail.id === desktopDovecote.selectedId) row.classList.add('selected');

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
    // Windows Mail's wording
    desktopDovecoteEls.statusCounts.textContent = total + ' message(s), ' + unread + ' unread';
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
    // No selection: the viewer pane is hidden entirely and the list takes the space.
    desktopDovecoteEls.mainPane.classList.toggle('dovecote-no-selection', !mail);
    desktopDovecoteEls.emptyHint.classList.toggle('hidden', !!mail);
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
// doveOpenReaderWindow below) — els is { oeFrom, oeTo, oeSubject, oeDate, safetyBar,
// imagesBar, attachmentsBar, bodyWrap }. ----------------------------------------------------------------

const doveRenderOeHeaderInto = function (els, mail) {
    els.oeFrom.textContent = mail ? doveDisplayAddress(mail.from) : '';
    els.oeTo.textContent = mail ? doveDisplayAddress(mail.to) : '';
    els.oeSubject.textContent = mail ? (mail.subject || '(no subject)') : '';
    els.oeDate.textContent = mail ? doveFormatDate(mail.createdAt) : '';
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
    iframe.srcdoc = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data: blob: https: http:; style-src \'unsafe-inline\'">' + scrollbarStyle + '</head><body>' + bodyHtml + '</body></html>';
    doveWireFrameLinks(iframe);
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
    const readOnly = !!desktopDovecote.viewAsOwner;
    const noMail = !desktopDovecote.selectedMail;
    desktopDovecoteEls.toolbar.querySelectorAll('[data-dove-mutating="true"]').forEach((btn) => {
        btn.disabled = readOnly || (noMail && btn.dataset.doveNeedsMail === 'true');
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
    toInput.value = doveDisplayAddress(initial.to);
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

    [replyBtn, replyAllBtn, forwardBtn, null, toggleReadBtn, deleteBtn, archiveBtn].forEach((btn) => {
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
        oeTo: fieldEls.to,
        oeSubject: fieldEls.subject,
        oeDate: fieldEls.date,
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
    titleImage.src = '/static_images/app_icons/vista-mail.png';
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
    icon.src = '/static_images/app_icons/vista-mail.png';
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
        dovePresentNewMail(mail, count);
    } catch (_err) {
        // The tray badge already updated; the toast is optional.
    }
};

// ---- Tray icon (#dovecoteTrayIcon, public/app.html) ------------------------------
// Same pattern as #directorTrayIcon (public/scripts/comp/director.js): hidden by
// default, revealed by systemTrayManager.js's staggered boot sequence, shows/hides
// live from here afterward. Unlike Director's state icon, this one carries a plain
// unread-count badge, hidden entirely at zero.

let doveTrayInitialized = false;
let doveLastUnread = null;
let doveHasAnnouncedMail = false;

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
    const prev = doveLastUnread;
    doveLastUnread = unread;
    if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.remove('hidden');
        icon.title = 'Dovecote — ' + unread + ' unread';
        icon.classList.toggle('hidden', !reveal);
        if (reveal && (!doveHasAnnouncedMail || (prev != null && unread > prev))) {
            const fresh = prev != null && unread > prev;
            // cplMail: public/scripts/comp/cplMail.js — Windows Mail's "Play sound when new messages arrive"
            const mailSettings = window.cplMail;
            if (!mailSettings || mailSettings.soundOn()) {
                // desktopSounds.play: public/scripts/comp/desktopSounds.js
                desktopSounds.play('notify');
            }
            if (fresh && (!mailSettings || mailSettings.dialogOn())) doveShowNewMail(unread - prev);
            doveHasAnnouncedMail = true;
        }
    } else {
        badge.classList.add('hidden');
        icon.title = 'Dovecote';
        icon.classList.add('hidden');
        doveHasAnnouncedMail = false;
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
