// Dovecote: Outlook-Express-style internal mail client.
// Server side (mail store, privacy enforcement, MCP tools, WS handlers, HTML sanitizer):
// modules/dovecoteMail.js, modules/dovecoteRender.js, modules/dovecoteSanitize.js,
// modules/ws/handlers/250-dovecoteHandler.js.
// This file is the part every boot runs (#1001): the tray icon and its unread badge, the Inbox flyout, the new-mail
// sound and balloons, Mail Options' settings, the mailbox pushes and the e-mail accounts' events. The windows (main,
// reader, compose, attachments) are desktop-apps/dovecoteWindow.js, featureLoader feature 'dovecote', loaded on
// first use (doveUi below).
// openModal / bringModalToFront / restoreMinimizedModal / closeModal: public/scripts/comp/modalUtils.js
// contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js (Mailbox + Forward pickers)
// escapeHtml / escapeHtmlAttribute: public/scripts/comp/utilities.js
// wsClient.sendMessage: public/scripts/websocket.js
// The tray icon, the Inbox flyout and the New Mail box: public/css/desktop-apps/dovecote-tray.css

const DESKTOP_DOVECOTE_HUMAN_OWNER = 'yukimi';

// ---- Mail options (Tools > Options..., public/scripts/comp/mailOptions.js; Control Panel's Mail
// item opens the same dialog) -----------------------------------------------------------------
// "Play sound" and "Show a notification" stay on this computer (localStorage, the keys cplMail.js
// used). The signature is the user's own: userGlobalSettings.mail on the server
// (modules/websocketHandlers.js normalizeUserGlobalSettings), with a copy here so a compose window
// has it at once. A save the server could not keep (it predates the field) stays pendingSync and
// goes up again when the server's settings next arrive (doveApplyServerMailSettings).
const DOVE_SOUND_KEY = 'dovecote-mail-sound';
const DOVE_NOTIFY_KEY = 'dovecote-mail-dialog';
const DOVE_SIGNATURE_KEY = 'dovecote-mail-signature';
const DOVE_SIGNATURE_MAX = 4000;

const doveLocalStore = function () {
    try {
        return window.localStorage || null;
    } catch (_) {
        return null;
    }
};

const doveReadFlag = function (key) {
    try {
        const store = doveLocalStore();
        return !store || store.getItem(key) !== 'off';
    } catch (_) {
        return true;
    }
};

const doveWriteFlag = function (key, on) {
    try {
        const store = doveLocalStore();
        if (store) store.setItem(key, on ? 'on' : 'off');
    } catch (_) { /* quota / private mode */ }
};

// Windows Mail's Signatures tab: "Add signatures to all outgoing messages" (on here, so a saved
// signature is used) and "Don't add signatures to Replies and Forwards" (off).
const doveNormalizeSignatureSettings = function (raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        signature: typeof base.signature === 'string' ? base.signature.replace(/\r\n?/g, '\n').slice(0, DOVE_SIGNATURE_MAX) : '',
        signatureOutgoing: base.signatureOutgoing !== false,
        signatureSkipReplies: base.signatureSkipReplies === true
    };
};

const doveReadLocalSignature = function () {
    try {
        const store = doveLocalStore();
        const text = store && store.getItem(DOVE_SIGNATURE_KEY);
        return text ? JSON.parse(text) : null;
    } catch (_) {
        return null;
    }
};

const doveWriteLocalSignature = function (settings, pendingSync) {
    try {
        const store = doveLocalStore();
        if (store) store.setItem(DOVE_SIGNATURE_KEY, JSON.stringify(Object.assign({}, settings, { pendingSync: !!pendingSync })));
    } catch (_) { /* quota / private mode */ }
};

let doveSignatureSettings = doveNormalizeSignatureSettings(doveReadLocalSignature());

// Resolves true once the server has kept it, false while only this computer has it.
const doveSaveSignatureSettings = async function (patch) {
    const next = doveNormalizeSignatureSettings(Object.assign({}, doveSignatureSettings, patch));
    doveSignatureSettings = next;
    doveWriteLocalSignature(next, true);
    if (typeof wsClient === 'undefined' || !wsClient || !wsClient.isConnected || !wsClient.isConnected()) return false;
    try {
        // update_user_global_settings: modules/ws/handlers/200-userSettingsHandler.js
        const result = await wsClient.sendMessage('update_user_global_settings', { settings: { mail: next } }, false);
        const kept = !!(result && result.settings && result.settings.mail);
        if (kept && doveSignatureSettings === next) doveWriteLocalSignature(next, false);
        return kept;
    } catch (err) {
        console.error('Dovecote signature save failed:', err);
        return false;
    }
};

// applyUserGlobalSettingsToClient (public/scripts/comp/modalUtils.js) hands over the server's copy.
const doveApplyServerMailSettings = function (mail) {
    if (!mail || typeof mail !== 'object') return;
    const local = doveReadLocalSignature();
    if (local && local.pendingSync) {
        doveSaveSignatureSettings(local);
        return;
    }
    doveSignatureSettings = doveNormalizeSignatureSettings(mail);
    doveWriteLocalSignature(doveSignatureSettings, false);
};

// The signature goes under what the user writes, after a blank line: at the bottom of a new message
// or a reply, and above a forwarded message's text (which is quoted under it).
// quoted: the body is the original message under the reply (an e-mail account's reply, doveImapOpenCompose),
// so the signature goes above it, as for a forward.
const doveWithSignature = function (mode, body, quoted) {
    const opts = doveSignatureSettings;
    const signature = opts.signature.replace(/\s+$/, '');
    if (!signature.trim() || !opts.signatureOutgoing) return body || '';
    if (mode !== 'create' && opts.signatureSkipReplies) return body || '';
    if (mode === 'forward' || quoted) return '\n\n' + signature + (body ? '\n\n' + String(body).replace(/^\n+/, '') : '');
    return (body || '') + '\n\n' + signature;
};

const doveMailOptions = {
    soundOn: () => doveReadFlag(DOVE_SOUND_KEY),
    notifyOn: () => doveReadFlag(DOVE_NOTIFY_KEY),
    setSound: (on) => doveWriteFlag(DOVE_SOUND_KEY, on),
    setNotify: (on) => doveWriteFlag(DOVE_NOTIFY_KEY, on),
    signature: () => Object.assign({}, doveSignatureSettings),
    saveSignature: doveSaveSignatureSettings,
    applyServer: doveApplyServerMailSettings,
    SIGNATURE_MAX: DOVE_SIGNATURE_MAX
};
window.dovecoteMailSettings = doveMailOptions;

// Tools > Options... and Control Panel's Mail item: Mail Options (lazy feature mail_options,
// public/scripts/comp/featureLoader.js)
const doveOpenMailOptions = function (tab) {
    if (!window.featureLoader) return;
    featureLoader.loadFeature('mail_options')
        .then(() => { if (window.mailOptions) mailOptions.open(tab); })
        .catch((err) => doveShowError((err && err.message) || 'Could not open Mail Options'));
};
window.openDovecoteMailOptions = doveOpenMailOptions;

// { folder, sortKey, sortDir, viewAsOwner, mail: [], selectedId, selectedIds, mailboxes: [],
//   bodyView, searchText, mobileMessageOpen, nextCursor, hasMore, folderTotal, folderUnread,
//   countsKey (doveCountsKey of the folder those counts belong to) }
// account: the open IMAP e-mail account's id (Yozora #789, doveOpenImapFolder), null for Dreamscape
// Mail; folder is then that account's folder path.
const desktopDovecote = {
    loaded: false,
    account: null,
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
    countsKey: null,
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

// ---- The windows (dovecoteWindow.js, featureLoader feature 'dovecote', #1001) ----------------------
// doveUi is what dovecoteWindow.js hands back once it has run. An opener (the Start menu, the tray flyout, a balloon,
// the Sidebar, another program's Send To) loads it first: from the service worker's copy when there is no server.
// The rest only draws a window that is open, which cannot be before the file has run: without it there is nothing
// to draw.
let doveUi = null;
const doveLoadUi = function () {
    if (doveUi) return Promise.resolve(doveUi);
    // featureLoader.loadFeature: public/scripts/comp/featureLoader.js
    if (typeof window === 'undefined' || !window.featureLoader) return Promise.resolve(null);
    return window.featureLoader.loadFeature('dovecote').then(() => doveUi);
};
const doveUiRun = function (name, args) {
    if (doveUi) return doveUi[name].apply(null, args);
    return doveLoadUi().then((ui) => (ui ? ui[name].apply(null, args) : undefined));
};
const doveUiOpener = (name) => function () { return doveUiRun(name, arguments); };
const doveUiIfLoaded = (name) => function () { return doveUi ? doveUi[name].apply(null, arguments) : undefined; };

function openDesktopDovecote() {
    return doveUiRun('openDesktopDovecote', arguments);
}
const doveOpenReaderWindow = doveUiOpener('doveOpenReaderWindow');
const doveOpenCompose = doveUiOpener('doveOpenCompose');
// Calendar, Contacts, Snipping Tool, WordPad, Reader and Glancewell's Send To (typeof doveOpenComposeWindow)
const doveOpenComposeWindow = doveUiOpener('doveOpenComposeWindow');
const doveOpenImapFolder = doveUiOpener('doveOpenImapFolder');
const doveOpenTreeFolder = doveUiOpener('doveOpenTreeFolder');
const doveLoadFolder = doveUiIfLoaded('doveLoadFolder');
const doveApplyListPage = doveUiIfLoaded('doveApplyListPage');
const doveImapScheduleReload = doveUiIfLoaded('doveImapScheduleReload');
const doveClearSelection = doveUiIfLoaded('doveClearSelection');
const doveRenderMailboxBanner = doveUiIfLoaded('doveRenderMailboxBanner');
const doveRenderWindowTitle = doveUiIfLoaded('doveRenderWindowTitle');
const doveRenderFolderTree = doveUiIfLoaded('doveRenderFolderTree');
const doveRenderFolderButton = doveUiIfLoaded('doveRenderFolderButton');
const doveRenderMessageList = doveUiIfLoaded('doveRenderMessageList');
const doveRenderPreview = doveUiIfLoaded('doveRenderPreview');
const doveRenderInboxBadge = doveUiIfLoaded('doveRenderInboxBadge');
const doveRenderStatusCounts = doveUiIfLoaded('doveRenderStatusCounts');
const doveRenderToolbarState = doveUiIfLoaded('doveRenderToolbarState');

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

const doveDecodeRfc2047 = function (value) {
    const text = String(value == null ? '' : value);
    if (text.indexOf('=?') === -1) return text;
    const re = /=\?([A-Za-z0-9][A-Za-z0-9_.:-]*)(?:\*[^\?]*)?\?([BQbq])\?([^?]*)\?=/g;
    let out = '';
    let last = 0;
    let lastWasWord = false;
    let match;
    const decodeBytes = function (buf, charset) {
        const cs = String(charset || 'utf-8').toLowerCase();
        const alias = { utf8: 'utf-8', 'us-ascii': 'utf-8', ascii: 'utf-8', latin1: 'windows-1252', 'iso-8859-1': 'windows-1252', cp1252: 'windows-1252' };
        const enc = alias[cs] || cs;
        try {
            return new TextDecoder(enc).decode(buf);
        } catch (_err) {
            try { return new TextDecoder('utf-8').decode(buf); } catch (_err2) {
                return typeof TextDecoder === 'function' ? new TextDecoder().decode(buf) : text;
            }
        }
    };
    const decodeWord = function (charset, encoding, encoded) {
        try {
            if (String(encoding).toUpperCase() === 'B') {
                const compact = String(encoded || '').replace(/\s+/g, '');
                const binary = atob(compact);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return decodeBytes(bytes, charset);
            }
            const raw = String(encoded || '').replace(/_/g, ' ');
            const bytes = [];
            for (let i = 0; i < raw.length; i++) {
                if (raw[i] === '=' && /^[0-9A-Fa-f]{2}/.test(raw.slice(i + 1, i + 3))) {
                    bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
                    i += 2;
                } else bytes.push(raw.charCodeAt(i) & 0xff);
            }
            return decodeBytes(new Uint8Array(bytes), charset);
        } catch (_err) {
            return null;
        }
    };
    while ((match = re.exec(text)) !== null) {
        const gap = text.slice(last, match.index);
        if (!(lastWasWord && /^[ \t\r\n]*$/.test(gap))) out += gap;
        const decoded = decodeWord(match[1], match[2], match[3]);
        if (decoded === null) { out += match[0]; lastWasWord = false; }
        else { out += decoded; lastWasWord = true; }
        last = re.lastIndex;
    }
    return out + text.slice(last);
};
const doveSubjectText = function (mail) {
    const subject = doveDecodeRfc2047(mail && mail.subject ? mail.subject : '');
    return subject || '(no subject)';
};
const doveDisplayAddress = function (name) {
    const bare = String(name || '').trim();
    if (!bare) return '';
    return bare.includes('@') ? bare : bare + DOVE_ADDRESS_DOMAIN;
};
// The sender as the reading pane shows it: the From header's name (fromLabel) unless the gateway
// flagged it as impersonating one of ours, else the address. The message list's From column too.
const doveSenderText = function (mail) {
    if (!mail) return '';
    const label = doveDecodeRfc2047(mail.fromLabel || '');
    return label && !mail.labelSuspicious ? label : doveDisplayAddress(mail.from);
};

// The folder whose counts desktopDovecote.folderTotal / folderUnread hold (doveApplyListPage):
// the caption leaves the count off while a newly picked folder is still loading.
const doveCountsKey = function () {
    if (desktopDovecote.account) return DOVE_IMAP_PREFIX + desktopDovecote.account + '/' + desktopDovecote.folder;
    return (desktopDovecote.viewAsOwner || DESKTOP_DOVECOTE_HUMAN_OWNER) + '/' + desktopDovecote.folder;
};

// ---- Data loading (the window's loads are in dovecoteWindow.js; these are shared with it) ----------

const doveShowError = function (message) {
    desktopDovecote.statusError = message;
    if (message && typeof showGlassToast === 'function') {
        showGlassToast('error', 'Dovecote', message, false, 6000, '<i class="fas fa-dove"></i>');
    }
};

let doveFolderToken = 0;

// Keeps the Inbox unread badge current even while another folder is open.
let doveBadgeToken = 0;

// ---- IMAP e-mail accounts (Yozora #789) --------------------------------------------------------
// window.mailAccounts (public/scripts/comp/mailAccountsClient.js) reaches the server's IMAP accounts:
// the server is the mail client and keeps the copy (modules/mailAccounts.js). Each account is its own
// tree in the folder list, as Windows Mail shows several accounts (Local Folders stay Dreamscape
// Mail's). desktopDovecote.account is the open account's id and desktopDovecote.folder its folder
// path then. Its messages keep Dovecote's row shape (doveImapRow, ids 'imap:<account>:<uid>:<folder>'),
// so the list, reading pane, message windows and New Message are the same views; only the data
// calls switch on an imap id / mail.imap.

const DOVE_IMAP_PREFIX = 'imap:';
// Special-use folders: Windows Mail's names and pictures, in this order before the others
const DOVE_IMAP_SPECIAL = {
    '\\Inbox': { label: 'Inbox', icon: 'inbox', kind: 'inbox', order: 0 },
    '\\Drafts': { label: 'Drafts', icon: 'drafts', kind: 'drafts', order: 1 },
    '\\Sent': { label: 'Sent Items', icon: 'sent', kind: 'sent', order: 2 },
    '\\Trash': { label: 'Deleted Items', icon: 'deleted', kind: 'deleted', order: 3 },
    '\\Junk': { label: 'Junk E-mail', icon: 'spam', kind: 'spam', order: 4 },
    '\\Archive': { label: 'Archive', icon: 'archive', kind: 'archive', order: 5 }
};

// accounts: mailAccounts.accounts(); folders: accountId -> mailAccounts.folders(); collapsed: account
// trees ('id') and folders ('id|path') folded in the folder list, kept on this computer; recent: 'account|folder|uid' -> when this window changed its flags
// (the server's 'flags' echo of our own change does not reload the list)
const doveImap = {
    accounts: [],
    folders: {},
    collapsed: (() => {
        try {
            const store = doveLocalStore();
            const list = store ? JSON.parse(store.getItem('dovecote-imap-collapsed') || '[]') : [];
            return new Set(Array.isArray(list) ? list.map(String) : []);
        } catch (_) {
            return new Set();
        }
    })(),
    bound: false,
    accountsPromise: null,
    searchTimer: null,
    reloadTimer: null,
    folderTimers: {},
    recent: new Map(),
    announce: [],
    announceTimer: null
};

const doveImapApi = function () {
    return window.mailAccounts && typeof window.mailAccounts.messages === 'function' ? window.mailAccounts : null;
};
const doveImapId = function (accountId, folder, uid) {
    return DOVE_IMAP_PREFIX + accountId + ':' + uid + ':' + folder;
};

const doveImapAccount = function (id) {
    return doveImap.accounts.find((account) => account.id === id) || null;
};
// The folder list shows the account by the name the user gave it in Messaging (#978), else its address (two
// accounts may share a display name)
const doveImapAccountLabel = function (account) {
    return (account && (account.accountName || account.email || account.name || account.id)) || '';
};

const doveImapSpecialOf = function (folder) {
    if (!folder) return null;
    if (folder.special && DOVE_IMAP_SPECIAL[folder.special]) return folder.special;
    return String(folder.path || '').toUpperCase() === 'INBOX' ? '\\Inbox' : null;
};
const doveImapFolderInfo = function (accountId, path) {
    return (doveImap.folders[accountId] || []).find((folder) => folder.path === path) || null;
};
const doveImapFolderBySpecial = function (accountId, special) {
    return (doveImap.folders[accountId] || []).find((folder) => doveImapSpecialOf(folder) === special) || null;
};
const doveImapFolderKind = function (accountId, path) {
    const special = doveImapSpecialOf(doveImapFolderInfo(accountId, path) || { path: path });
    return special ? DOVE_IMAP_SPECIAL[special].kind : 'other';
};

const doveImapUnreadTotal = function () {
    const api = doveImapApi();
    if (!api || typeof api.unread !== 'function') return 0;
    const unread = api.unread();
    return (unread && Number(unread.total)) || 0;
};

// Accounts and their folders. A user who is not an admin, or no server, has none: Dovecote is
// then Dreamscape Mail only.
const doveImapRefreshAccounts = function () {
    const api = doveImapApi();
    if (!api) return Promise.resolve([]);
    if (doveImap.accountsPromise) return doveImap.accountsPromise;
    doveImap.accountsPromise = (async () => {
        let list = [];
        try {
            const result = await api.accounts(true);
            list = (result && result.accounts) || [];
        } catch (_) {
            list = [];
        }
        doveImap.accounts = list.filter((account) => account && account.id && account.enabled !== false);
        Object.keys(doveImap.folders).forEach((id) => { if (!doveImapAccount(id)) delete doveImap.folders[id]; });
        if (desktopDovecote.account && !doveImapAccount(desktopDovecote.account)) {
            doveLeaveImapAccount();
            desktopDovecote.folder = 'inbox';
            if (desktopDovecote.loaded) doveLoadFolder('inbox');
        }
        await Promise.all(doveImap.accounts.map((account) => doveImapRefreshFolders(account.id)));
        doveImapRenderAccountState();
        return doveImap.accounts;
    })().finally(() => { doveImap.accountsPromise = null; });
    return doveImap.accountsPromise;
};

const doveImapRefreshFolders = async function (accountId) {
    const api = doveImapApi();
    if (!api) return;
    try {
        doveImap.folders[accountId] = (await api.folders(accountId)) || [];
    } catch (_) {
        // the account is not running (bad password, server down): keep what we had
        if (!doveImap.folders[accountId]) doveImap.folders[accountId] = [];
        return;
    }
    // the open folder's counts from the server's copy (not while a search result is listed)
    if (desktopDovecote.account === accountId && desktopDovecote.countsKey === doveCountsKey() && !desktopDovecote.searchText.trim()) {
        const info = doveImapFolderInfo(accountId, desktopDovecote.folder);
        if (info) {
            desktopDovecote.folderTotal = Number(info.total) || 0;
            desktopDovecote.folderUnread = Number(info.unseen) || 0;
        }
    }
};

const doveImapRenderAccountState = function () {
    if (!desktopDovecoteEls) return;
    doveRenderFolderTree();
    if (desktopDovecote.account) {
        doveRenderFolderButton();
        doveRenderStatusCounts();
        doveRenderToolbarState();
    }
};

const doveImapScheduleFolders = function (accountId) {
    if (!accountId) return;
    clearTimeout(doveImap.folderTimers[accountId]);
    doveImap.folderTimers[accountId] = setTimeout(async () => {
        delete doveImap.folderTimers[accountId];
        await doveImapRefreshFolders(accountId);
        doveImapRenderAccountState();
    }, 600);
};

const doveImapClearSearch = function () {
    desktopDovecote.searchText = '';
    if (desktopDovecoteEls && desktopDovecoteEls.searchInput) desktopDovecoteEls.searchInput.value = '';
};

// Back to Dreamscape Mail (a Local Folders / communities row): the caller loads its folder
const doveLeaveImapAccount = function () {
    desktopDovecote.account = null;
    doveImapClearSearch();
    if (!desktopDovecoteEls) return;
    doveClearSelection();
    doveRenderPreview();
};

const doveImapAddress = function (entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    const address = entry.address || '';
    const name = String(entry.name || '').replace(/[",;<>]/g, '').trim();
    return name && address ? name + ' <' + address + '>' : (address || name);
};

const doveImapIso = function (value) {
    if (value == null || value === '') return '';
    const d = new Date(typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

// mailAccounts list item -> Dovecote's row: folder is the folder's kind (inbox, sent, deleted, spam,
// archive, drafts, other) for the menus' checks, imap holds where it really is.
const doveImapRow = function (item) {
    const from0 = Array.isArray(item.from) ? item.from[0] : null;
    const kind = doveImapFolderKind(item.accountId, item.folder);
    return {
        id: doveImapId(item.accountId, item.folder, item.uid),
        imap: { accountId: item.accountId, folder: item.folder, uid: Number(item.uid) },
        folder: kind,
        from: from0 ? (from0.address || from0.name || '') : (item.sender || ''),
        fromLabel: from0 && from0.name ? String(from0.name) : '',
        to: (item.to || []).map(doveImapAddress).filter(Boolean),
        cc: (item.cc || []).map(doveImapAddress).filter(Boolean),
        subject: item.subject || '',
        createdAt: doveImapIso(item.date),
        read: !!item.seen,
        flagged: !!item.flagged,
        answered: !!item.answered,
        snippet: item.snippet || '',
        hasAttachments: !!item.hasAttachments,
        size: Number(item.size) || 0,
        // Dovecote's route column is Dreamscape Mail's; an account's mail all came over the internet
        route: kind === 'sent' || kind === 'drafts' ? 'outbound' : 'inbound'
    };
};

// Every uid a recent change of ours (doveImapApply): the server's 'flags' echo needs no reload
const doveImapAllRecent = function (accountId, folder, uids) {
    const now = Date.now();
    doveImap.recent.forEach((at, key) => { if (now - at > 8000) doveImap.recent.delete(key); });
    const list = uids || [];
    return list.length > 0 && list.every((uid) => doveImap.recent.has(accountId + '|' + folder + '|' + uid));
};

// New mail for an account with notify on: the same alert as Dreamscape Mail's (dovePlayNewMailAlert:
// Mail Options' sound, then the tray balloon), one for a burst of messages.
const doveImapQueueAnnounce = function (message) {
    doveImap.announce.push(message);
    clearTimeout(doveImap.announceTimer);
    doveImap.announceTimer = setTimeout(() => doveImapAnnounce(doveImap.announce.splice(0)), 700);
};

const doveImapAnnounce = function (list) {
    if (!list.length) return;
    // the phone shell's Messaging raises its own notification and sound for the same mail
    if (window.uiShell === 'mobile') return;
    // isDesktopTrayBootPending: public/scripts/comp/trayIndicators.js
    if (!doveTray.registered || (typeof isDesktopTrayBootPending === 'function' && isDesktopTrayBootPending())) return;
    // desktopSounds.play: public/scripts/comp/desktopSounds.js
    if (doveMailOptions.soundOn() && typeof desktopSounds !== 'undefined') desktopSounds.play('notify');
    if (!doveMailOptions.notifyOn()) return;
    const latest = list[list.length - 1];
    const from0 = Array.isArray(latest.from) ? latest.from[0] : null;
    const from = from0 ? (from0.name || from0.address || '') : (latest.sender || '');
    const body = list.length > 1
        ? 'You have ' + list.length + ' new messages.'
        : (from ? 'From: ' + from + '. ' : '') + (latest.subject || '(no subject)');
    const accounts = new Set(list.map((m) => m.accountId));
    // one message: the message; several in one account: its Inbox
    const open = list.length === 1 && latest.accountId && latest.uid != null
        ? () => { openDesktopDovecote(); doveOpenReaderWindow(doveImapId(latest.accountId, latest.folder || 'INBOX', latest.uid)); }
        : (accounts.size === 1 && latest.accountId ? String(latest.accountId) : null);
    doveMailBalloon('New mail', body, open);
};

// mailAccounts events: 'new' / 'flags' / 'removed' / 'folders' / 'sync' refresh the account's counts
// and, when it is open, its list; 'account' re-reads the accounts; 'unread' repaints the tray badge.
const doveImapOnEvent = function (type, detail) {
    const d = detail || {};
    const accountId = d.accountId;
    if (type === 'account') {
        doveImapRefreshAccounts();
        return;
    }
    // a sync pass that changed nothing (#890 W6): no counts to read, no list to reload
    if (type === 'sync' && d.changed === false) return;
    if (type === 'new' && d.notify && d.message) doveImapQueueAnnounce(Object.assign({ accountId, folder: d.folder }, d.message));
    if (accountId) doveImapScheduleFolders(accountId);
    // the tray's Inbox flyout, when open, lists the accounts' unread too
    if ((type === 'new' || type === 'flags' || type === 'removed') && doveInboxFlyout && !doveInboxFlyout.classList.contains('hidden')) doveFillInboxFlyout();
    if (!desktopDovecote.loaded || !desktopDovecoteEls || desktopDovecote.account !== accountId) return;
    if (desktopDovecote.searchText.trim()) return;
    const here = d.folder === desktopDovecote.folder;
    if (type === 'removed') {
        if (!here) return;
        const gone = new Set((d.uids || []).map((uid) => doveImapId(accountId, d.folder, uid)));
        const before = desktopDovecote.mail.length;
        desktopDovecote.mail = desktopDovecote.mail.filter((mail) => !gone.has(String(mail.id)));
        if (desktopDovecote.mail.length === before) return;
        desktopDovecote.folderTotal = Math.max(0, (desktopDovecote.folderTotal || 0) - (before - desktopDovecote.mail.length));
        if (desktopDovecote.selectedIds.some((id) => gone.has(String(id)))) {
            doveClearSelection();
            doveRenderPreview();
        }
        doveRenderMessageList();
        return;
    }
    if (type === 'flags' && (!here || doveImapAllRecent(accountId, d.folder, d.uids))) return;
    // flags: { uid: [flags] } -> the rows change in place, no reload
    if (type === 'flags' && d.flags && typeof d.flags === 'object') {
        let unreadDelta = 0;
        Object.keys(d.flags).forEach((uid) => {
            const flags = Array.isArray(d.flags[uid]) ? d.flags[uid] : [];
            const id = doveImapId(accountId, d.folder, uid);
            [desktopDovecote.mail.find((mail) => String(mail.id) === id), desktopDovecote.selectedMail].forEach((mail, index) => {
                if (!mail || String(mail.id) !== id) return;
                const read = flags.includes('\\Seen');
                if (index === 0 && mail.read !== read) unreadDelta += read ? -1 : 1;
                mail.read = read;
                mail.flagged = flags.includes('\\Flagged');
                mail.answered = flags.includes('\\Answered');
            });
        });
        desktopDovecote.folderUnread = Math.max(0, (desktopDovecote.folderUnread || 0) + unreadDelta);
        doveRenderMessageList();
        return;
    }
    if ((type === 'new' || type === 'folders') && d.folder && !here) return;
    doveImapScheduleReload();
};

const doveImapBind = function () {
    const api = doveImapApi();
    if (!api || doveImap.bound || typeof api.on !== 'function') return;
    doveImap.bound = true;
    ['new', 'flags', 'removed', 'folders', 'account', 'sync'].forEach((type) => api.on(type, (detail) => doveImapOnEvent(type, detail)));
    api.on('unread', () => {
        if (doveDreamUnread !== null) doveApplyTrayBadge(doveDreamUnread);
    });
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
    modal.className = 'modal hidden transient owned-window on-top';
    // a Vista message box (vista-dialogs.css): the tags vistaDialogs.js used to add at run time
    modal.dataset.vistaDialog = 'message';
    modal.dataset.vistaIcon = 'info';
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
    actions.className = 'dovecote-new-mail-actions vista-dialog-footer';
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
    fromEl.textContent = 'From: ' + (doveSenderText(mail) || '');
    subjectEl.textContent = 'Subject: ' + doveSubjectText(mail);
    const snippet = String(mail.snippet || '').trim();
    previewEl.textContent = snippet;
    previewEl.classList.toggle('hidden', !snippet);
    // closeModal strips the parent link; set it again so this toast is not tied to
    // whichever window is active (openModal would otherwise close it with that window).
    modal.setAttribute('data-parent-modal-id', DOVE_NEW_MAIL_PARENT);
    doveShowWindow(modal);
    requestAnimationFrame(() => dovePlaceNewMail(modal));
}

// showPopover: public/scripts/comp/popoverManager.js. A click opens what it is about (tray balloon click actions,
// Nov 20 2026): `open` is the message's opener, or an e-mail account's id for its Inbox; none: Dreamscape Mail's Inbox
function doveMailBalloon(title, body, open) {
    const icon = document.getElementById('dovecoteTrayIcon');
    if (!icon || icon.classList.contains('hidden')) return;
    const openInbox = () => {
        openDesktopDovecote();
        if (typeof open === 'string') doveOpenImapFolder(open, 'INBOX');
        else if (desktopDovecote.account || desktopDovecote.viewAsOwner || desktopDovecote.folder !== 'inbox') doveOpenTreeFolder(DESKTOP_DOVECOTE_HUMAN_OWNER, 'inbox');
    };
    showPopover(
        icon,
        'info',
        title,
        body,
        false,
        8000,
        '<img src="/static_images/vista-icons/dovecote-32.png" alt="" width="32" height="32">',
        null,
        { position: 'top', arrowPosition: 'bottom-right', popupId: 'mail', onClick: typeof open === 'function' ? open : openInbox }
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
        if (!doveMailOptions.notifyOn()) return;
        const from = doveSenderText(mail) || '';
        const subject = doveSubjectText(mail);
        const body = count > 1
            ? 'You have ' + count + ' new messages.'
            : (from ? 'From: ' + from + '. ' : '') + subject;
        doveMailBalloon('New mail', body, count > 1 ? null : () => { openDesktopDovecote(); doveOpenReaderWindow(mail.id); });
    } catch (_err) {
        // The tray badge already updated; the balloon is optional.
    }
};

// ---- Tray icon (#dovecoteTrayIcon, public/app.html) ------------------------------
// Same pattern as #directorTrayIcon (public/scripts/comp/director.js): hidden by
// default, revealed by systemTrayManager.js's staggered boot sequence, shows/hides
// live from here afterward. The glyph is the mail program icon, and a closed
// envelope once the Inbox has unread mail. The icon stays in the tray at zero.

// initialized: wired once; registered: the login delay is over and the icon may show; announced: the unread
// balloon has shown this session
const doveTray = { initialized: false, registered: false, announced: false };
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
    if (!doveTray.registered || (typeof isDesktopTrayBootPending === 'function' && isDesktopTrayBootPending())) {
        return;
    }
    // Mail Options' "Play sound when new messages arrive" / "Show a notification ..." (doveMailOptions)
    if (doveMailOptions.soundOn()) {
        // desktopSounds.play: public/scripts/comp/desktopSounds.js
        desktopSounds.play('notify');
    }
    if (doveMailOptions.notifyOn()) doveShowNewMail(count);
};

// options: { reveal } — same two-phase boot convention as updateFixedCreditsIndicator
// (public/scripts/comp/trayIndicators.js): reveal:false sets state without showing,
// reveal:true (or omitted, post-boot) shows/hides for real. Never plays the new-mail
// sound; that is doveNoteMailIds({ announce: true }) when a new inbox id appears.
// unread: Dreamscape Mail's Inbox; the e-mail accounts' Inbox unread (mailAccounts.unread) is added on.
let doveDreamUnread = null;
const doveApplyTrayBadge = function (dreamUnread, options) {
    const icon = document.getElementById('dovecoteTrayIcon');
    const badge = document.getElementById('dovecoteTrayBadge');
    if (!icon || !badge) return;
    doveDreamUnread = Number(dreamUnread) || 0;
    const unread = doveDreamUnread + doveImapUnreadTotal();
    const opts = options || {};
    // isDesktopTrayBootPending: public/scripts/comp/trayIndicators.js
    const reveal = opts.reveal !== false && !isDesktopTrayBootPending() && doveTray.registered;
    // every mailbox push lands here: write only what changed (a same-value title or class write is still a mutation,
    // and the notification area counts it as the icon's activity, #998). toggle(force) writes only on a change.
    icon.classList.toggle('hidden', !reveal);
    icon.classList.toggle('has-unread', unread > 0);
    const text = unread > 99 ? '99+' : String(unread);
    const title = unread > 0 ? 'Dovecote — ' + unread + ' unread' : 'Dovecote';
    if (unread > 0 && badge.textContent !== text) badge.textContent = text;
    badge.classList.toggle('hidden', !(unread > 0));
    if (icon.title !== title) icon.title = title;
    if (unread > 0 && reveal && !doveTray.announced) {
        if (doveMailOptions.notifyOn()) doveShowUnreadBalloon(unread);
        doveTray.announced = true;
    }
};

const doveRefreshTrayUnread = async function (options) {
    // Melaton Mobile has no Dovecote tray (#890): the two reads (every mailbox, then up to 200 inbox
    // rows) filled a hidden badge on every reconnect. The phone's Messaging, Today and status bar take
    // their counts from the dovecote_mailbox_updated push, and read for themselves on the
    // dovecoteMailboxUpdated event without a detail that the reconnect still sends (below).
    if (window.uiShell === 'mobile') return;
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

// Called from startBackgroundTrayServices (systemTrayManager.js)
function initializeDovecoteTray() {
    const icon = document.getElementById('dovecoteTrayIcon');
    if (!icon || doveTray.initialized) return;
    doveTray.initialized = true;
    // e-mail accounts' new mail and Inbox unread reach the tray too (doveImapOnEvent)
    doveImapBind();
    icon.addEventListener('click', (e) => {
        e.preventDefault();
        doveToggleTrayInbox();
        // PopoverManager.hide: public/scripts/comp/popoverManager.js
        PopoverManager.hide(icon);
    });
    doveRefreshTrayUnread({ reveal: false });
    setTimeout(() => {
        doveTray.registered = true;
        // the dovecote_mailbox_updated push has kept the count current since the boot read: show it, no second read
        // (#998); read only if the boot read never answered (or never primed the new-mail ids)
        if (window.uiShell !== 'mobile' && doveDreamUnread !== null && doveNotifyPrimed) doveApplyTrayBadge(doveDreamUnread, { reveal: true });
        else doveRefreshTrayUnread({ reveal: true });
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
    // the e-mail accounts' newest unread Inbox mail joins in, newest first, each with its account
    const imapMail = await doveImapFlyoutMail();
    if (!doveInboxFlyout || doveInboxFlyout.classList.contains('hidden')) return;
    list.replaceChildren();
    doveNoteMailIds(mail, { announce: false });
    if (imapMail.length) {
        mail = mail.concat(imapMail).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 10);
    }
    if (!mail.length) {
        const empty = document.createElement('p');
        empty.className = 'dove-inbox-flyout-empty';
        empty.textContent = 'No messages';
        list.appendChild(empty);
        dovePlaceInboxFlyout();
        return;
    }
    mail.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'dove-inbox-flyout-row';
        if (!item.read) row.classList.add('unread');
        if ((item.attachments && item.attachments.length) || item.hasAttachments) row.classList.add('has-attachment');
        row.dataset.doveMailId = item.id;
        const mark = document.createElement('span');
        mark.className = 'dove-inbox-flyout-mark';
        const clip = document.createElement('span');
        clip.className = 'dove-inbox-flyout-clip';
        const subject = document.createElement('span');
        subject.className = 'dove-inbox-flyout-subject';
        subject.textContent = doveSubjectText(item);
        const from = document.createElement('span');
        from.className = 'dove-inbox-flyout-from';
        from.textContent = doveSenderText(item) || '';
        if (item.imapAccountLabel) {
            const account = document.createElement('span');
            account.className = 'dove-inbox-flyout-account';
            account.textContent = item.imapAccountLabel;
            from.appendChild(account);
        }
        row.appendChild(mark);
        row.appendChild(clip);
        row.appendChild(subject);
        row.appendChild(from);
        list.appendChild(row);
    });
    dovePlaceInboxFlyout();
};

// The accounts' newest unread Inbox mail for the tray flyout (none while there are no accounts)
const doveImapFlyoutMail = async function () {
    const api = doveImapApi();
    if (!api) return [];
    if (!doveImap.accounts.length) await doveImapRefreshAccounts();
    const lists = await Promise.all(doveImap.accounts.map(async (account) => {
        const inbox = (doveImapFolderBySpecial(account.id, '\\Inbox') || { path: 'INBOX' }).path;
        try {
            const page = await api.messages(account.id, inbox, { limit: 8, unseenOnly: true });
            return ((page && page.messages) || []).map((item) => Object.assign(doveImapRow(item), { imapAccountLabel: doveImapAccountLabel(account) }));
        } catch (_) {
            return [];
        }
    }));
    return [].concat(...lists);
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
    // an e-mail account is open: its list follows the account's own events (doveImapOnEvent)
    if (desktopDovecote.account) return;

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
doveImapBind();

if (typeof module !== 'undefined' && module.exports) {
    module.exports._test = {
        doveCollectFreshMailIds: doveCollectFreshMailIds,
        doveNotifiedMailIds: doveNotifiedMailIds
    };
}

