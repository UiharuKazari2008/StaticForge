/**
 * Melaton Mobile: Messaging, the Windows Mobile 6.1 Professional stock app (Outlook Mobile) over
 * Dreamscape's Dovecote mail, Yozora #709. Dovecote becomes Messaging on the phone (Yukimi's app
 * mapping): the same mailboxes and WS calls the desktop's Dovecote Express uses
 * (public/scripts/comp/desktop-apps/dovecote.js; server modules/ws/handlers/250-dovecoteHandler.js).
 *
 * Accounts (#757, Yukimi's device screenshots tmp/wmss, Nov 11 2026), in the picker's order:
 *   Text Messaging   one row per Text Messaging account (#779, window.textMessaging: iMessage through
 *                    BlueBubbles, later RCS), the Apple ID / phone number on the second line; the
 *                    account opens in wmTextMessaging.js (window.wmTextMessaging), drawn as the
 *                    device's Text Messages; its folders (Inbox, Sent Items, Unknown Senders) are in
 *                    the folder tree under it. Keys 'tm:<account id>'
 *   Dreamscape Messenger  the Chat applet (wmChat.js: window.wmChatApp; was "Text Messages"), key 'sms'
 *   Dreamscape Mail  the signed-in person's mailbox (DESKTOP_DOVECOTE_HUMAN_OWNER) with its outside
 *                    address on the second line (dovecote_list_mailboxes `address`, mailGateway
 *                    toExternal); the agents' mailboxes are not accounts: the folder tree has them
 *                    under Dreamscape Mail > Other Mailboxes, one folder per mailbox (read-only here,
 *                    as on the desktop: every mark / move / delete / send acts on the person's own)
 *   IMAP accounts    one row per e-mail account the server keeps (#789, window.mailAccounts: Gmail,
 *                    iCloud, Outlook.com...), its name (display name or address) with the address on
 *                    the second line and the device's POP3/IMAP account icon. Drawn and handled as
 *                    Dreamscape Mail is (the same list, reading page, new message and menus); its
 *                    folders are the mail server's, named and pictured by special use (Inbox, Drafts,
 *                    Sent Items, Deleted Items, Junk E-mail, the rest as plain folders nested by the
 *                    server's delimiter). Keys 'imap:<account id>'. New Inbox mail the server announces
 *                    (detail.notify) is the device's New E-mail Message notification ('mail' class)
 *   Yumiya, Chiyo, Yozora  the Director personas (wren / kabuki / xi; Yozora only while Xi is on):
 *                    Inbox = the persona's sessions (director_get_sessions), Deleted Items = its
 *                    archived ones, Drafts = a new session. A session opens in Director
 *                    (directorInstance.setPersona + openSessionInWindow); New is the Director's own
 *                    new session for her (wmDirectorApp.newSessionWith)
 *   Setup E-mail     the device's last row
 * "Display account picker when opening Messaging" (Options > Accounts, on as shipped) opens the app
 * on "Select an Account".
 *
 * Pages, each matched to its screenshot at the device's VGA: Select an Account (173612), the list
 * (164304: status line "Connecting..." / "<account>  N Items, M Unread.", Delete / Menu), its menu and
 * sub-menus (165045-165058), the folder tree under the bar (165105, "Show"), Manage Folders (165113),
 * the reading page (165429-165447: "Sent:" band, the sender as a link, the subject; Reply / Menu),
 * the sender's card (165456: Send e-mail; Save / E-mail), the new message (165506-165521: From with
 * the account, To, Subject; Send / Menu) and Message Options (165521). Options (Accounts, Message,
 * Address, Storage) is wmSettingsSystem.js's 'messaging-options' page. "Messages cannot be
 * downloaded..." (165048) is the failed Send/Receive.
 *
 * Measured on the Device Emulator (VGA, 2x halved), Messaging's "Select an Account" page:
 *   header       23 px white, bold menu-text green caption at x 9, 1 px black rule under it
 *   rows         31 px with a 1 px #848284 rule at the bottom; 16 px icon at x 4, bold name at x 27
 *                (first line), a second normal line under it; the selected row is the highlight
 *                colour with white text. Soft keys Select / Menu.
 *
 * Layers: the list is the app's root; the account picker, message, new message, Move, Manage
 * Folders, Message Options and the sender's card are its own back steps (historyDepth / onBack).
 * The picker opened with the app is the root itself (back leaves the app).
 *
 * Only on phones: does nothing unless window.uiShell is 'mobile'. Never opens desktop windows.
 * Styles: public/css/wm-messaging.css. Art: public/static_images/wm61/msg-* (outres.192.dll).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'messaging';
    const ART = '/static_images/wm61/';
    const DOMAIN = '@dream.co.jp';
    const PAGE_LIMIT = 50;
    const SORT_KEY = 'wmMsgSort';
    const MAIL_ACCOUNT = 'Dreamscape Mail';
    const SMS_ACCOUNT = 'Dreamscape Messenger';
    const PERSONAS = [['wren', 'Yumiya'], ['kabuki', 'Chiyo'], ['xi', 'Yozora']];
    // Options (wmSettingsSystem.js 'messaging-options' writes the same keys)
    const OPT = {
        picker: 'wmMsgPicker', // '0' = open on the list
        replyBody: 'wmMsgReplyBody', // '0' = replies without the original
        warnDelete: 'wmMsgWarnDelete', // '0' = no question before a delete from the list
        afterDelete: 'wmMsgAfterDelete', // 'next' | 'list'
        emptyDeleted: 'wmMsgEmptyDeleted', // 'manual' | 'immediate'
        sync: 'wmMsgSync', // { archive, spam, sent }: false = not synchronized (Manage Folders)
        textSize: 'wmMsgTextSize' // reading page View > Text Size
    };
    // Outlook Mobile lists an account's folders alphabetically. The ROM's 22002 strip: frame 1 (the
    // blue arrow, our msg-folder-sent) is the device's Outbox, frame 7 (msg-folder-outbox) Sent Items.
    const FOLDERS = [
        { id: 'archive', label: 'Archive', icon: 'msg-folder-folder', sync: true },
        { id: 'deleted', label: 'Deleted Items', icon: 'msg-folder-deleted' },
        { id: 'inbox', label: 'Inbox', icon: 'msg-folder-inbox' },
        { id: 'spam', label: 'Junk E-mail', icon: 'msg-folder-folder', sync: true },
        { id: 'outbox', label: 'Outbox', icon: 'msg-folder-sent' },
        { id: 'sent', label: 'Sent Items', icon: 'msg-folder-outbox', sync: true }
    ];
    const SMS_FOLDERS = [
        { id: 'deleted', label: 'Deleted Items', icon: 'msg-folder-deleted' },
        { id: 'drafts', label: 'Drafts', icon: 'msg-folder-drafts' },
        { id: 'inbox', label: 'Inbox', icon: 'msg-folder-inbox' },
        { id: 'outbox', label: 'Outbox', icon: 'msg-folder-sent' },
        { id: 'sent', label: 'Sent Items', icon: 'msg-folder-outbox' }
    ];
    const DIR_FOLDERS = [
        { id: 'deleted', label: 'Deleted Items', icon: 'msg-folder-deleted' },
        { id: 'drafts', label: 'Drafts', icon: 'msg-folder-drafts' },
        { id: 'inbox', label: 'Inbox', icon: 'msg-folder-inbox' }
    ];
    // Move targets and the mark patch that puts a message there (modules/dovecoteMail.js markMail)
    const MOVE_TARGETS = [
        { id: 'archive', patch: { archived: true } },
        { id: 'deleted', patch: { deleted: true } },
        { id: 'inbox', patch: { archived: false } },
        { id: 'spam', patch: { spam: true } }
    ];
    const SORTS = [['received', 'Received'], ['from', 'From'], ['subject', 'Subject']];
    const TEXT_SIZES = [['largest', 'Largest', 16], ['larger', 'Larger', 14], ['medium', 'Medium', 12], ['smaller', 'Smaller', 10.5], ['smallest', 'Smallest', 9]];
    // WM 6.1's My Text phrases
    const MY_TEXT = ['Yes.', 'No.', 'I\'m running late.', 'Where are you?', 'Can you talk?', 'Call me.', 'Thank you.', 'I\'ll be there.', 'Talk to you later.', 'I love you.'];
    const PRIORITIES = [['normal', 'Normal'], ['high', 'High'], ['low', 'Low']];
    const LANGUAGES = [['western', 'Western European'], ['utf8', 'Unicode (UTF-8)'], ['japanese', 'Japanese (Shift-JIS)'], ['central', 'Central European']];
    const DOWNLOAD_ERROR = 'Messages cannot be downloaded to your mobile device. Make sure you are connected and that your e-mail account settings are correct. Then, try to download messages again.';

    let ws = null; // window.wmShell
    // WM's wait cursor (wmShell.busy) over work the user waits for: a message sending, a reply's original loading
    const busyOf = (fn, opts) => (ws && typeof ws.busy === 'function' ? ws.busy(fn, opts) : fn());
    let page = null;
    let mailboxes = []; // [{ owner, label, unread, spamUnread, address }]
    let acct = 'mail'; // the account on screen: 'mail' | 'imap' | 'dir'
    let imapId = null; // the IMAP account of an 'imap' account (its folder is the mail server's path)
    let dirP = 'wren'; // the Director persona of a 'dir' account
    let owner = null; // the mailbox on screen ('mail'): the person's, or an agent's (Other Mailboxes)
    let folder = 'inbox';
    let mail = [];
    let nextCursor = null;
    let hasMore = false;
    let loading = false;
    let loadingMore = false;
    let syncing = false; // a Send/Receive in flight (Stop Send/Receive)
    let listError = '';
    let listToken = 0;
    let selectedId = null;
    let multi = new Set(); // Select Messages: the rows picked
    let several = false; // Select Messages > Several: taps pick rows
    let sortField = 'received';
    let layers = []; // back steps over the list: 'accounts' | 'read' | 'compose' | 'move' | 'manage' | 'msgopts' | 'sender' | 'recip'
    let pickerRoot = false; // the picker opened with the app (back leaves the app)
    let freshOpen = true; // the next show() is the app starting (the picker comes first)
    let skipPicker = false;
    let reading = null; // the full message on the reading page
    let readToken = 0;
    let compose = null; // { mode, replyTo, attachments, priority, language, lastField }
    let moveIds = [];
    let pickIndex = 0; // the highlighted row of the account picker / Move list
    let sending = false;
    const dirLists = { wren: null, kabuki: null, xi: null };
    let xiEnabled = false;
    let xiAsked = 0;
    let tree = null; // the open folder tree { el, anchor, opts }
    const expanded = new Set();

    try {
        const s = localStorage.getItem(SORT_KEY);
        if (SORTS.some(([k]) => k === s)) sortField = s;
    } catch (_) { /* storage off */ }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const srcsetOf = (name) => (window.wmShell ? window.wmShell.art.srcset(name) : `${ART}${name}.png 1x, ${ART}${name}@2x.png 2x`);
    const img = (name) => `<img src="${ART}${name}.png" srcset="${srcsetOf(name)}" alt="" draggable="false">`;
    const human = () => (typeof DESKTOP_DOVECOTE_HUMAN_OWNER !== 'undefined' ? DESKTOP_DOVECOTE_HUMAN_OWNER : 'yukimi');
    const wsc = () => window.wsClient || (typeof wsClient !== 'undefined' ? wsClient : null); // eslint-disable-line no-undef
    const isCurrent = () => !!(ws && ws.current === APP_ID);
    const isMail = () => acct === 'mail';
    const isImap = () => acct === 'imap';
    // an e-mail list (Dreamscape Mail or an IMAP account), as against the Director's sessions
    const isList = () => isMail() || isImap();
    const isMine = () => isMail() && owner === human();
    // marks, moves, deletes and replies act here: the person's own mailbox or an IMAP account
    const canAct = () => isImap() || isMine();
    const top = () => (layers.length ? layers[layers.length - 1] : 'list');
    const folderList = () => (isMail() ? FOLDERS : DIR_FOLDERS);
    const folderOf = (id, list) => (list || folderList()).find((f) => f.id === id) || (list || folderList()).find((f) => f.id === 'inbox');
    const mailById = (id) => mail.find((m) => String(m.id) === String(id)) || null;
    const px = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
    // Melaton Mobile 6.5 (Windows Mobile 6.5 Professional's Messaging, measured on its emulator): the list has a
    // status line, Delete / Menu soft keys and New in the menu; the menus have no rules
    const is65 = () => !!(ws && ws.version === '6.5') || document.documentElement.dataset.wmVersion === '6.5';
    const stored = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const store = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage off */ } };
    const optOn = (k) => stored(k) !== '0';
    const personaName = (p) => (PERSONAS.find(([k]) => k === p) || [p, p])[1];

    function send(type, data, quiet) {
        const c = wsc();
        if (!c || typeof c.sendMessage !== 'function') return Promise.reject(new Error('Not connected.'));
        return c.sendMessage(type, data || {}, quiet === undefined ? false : quiet);
    }

    // ---------------------------------------------------------------- names and dates

    const address = (name) => {
        const bare = String(name || '').trim();
        if (!bare) return '';
        return bare.includes('@') ? bare : bare + DOMAIN;
    };
    const bare = (value) => String(value || '').split(/[,;]/).map((part) => {
        const t = part.trim();
        const m = t.match(/<([^>]+)>\s*$/);
        const a = m ? m[1].trim() : t;
        return a.toLowerCase().endsWith(DOMAIN) ? a.slice(0, -DOMAIN.length) : a;
    }).filter(Boolean);
    const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

    function boxLabel(o) {
        const box = mailboxes.find((b) => b.owner === o);
        if (box && box.label && box.label !== box.owner) return String(box.label).replace(/\s*\(you\)\s*$/, '');
        // a mailbox with no label of its own (wren, stylus): its name, capitalised
        const n = String(o || '');
        return n.charAt(0).toUpperCase() + n.slice(1);
    }

    /** The person's outside address (dovecote_list_mailboxes `address`), else the internal one. */
    function mailAddress(o = human()) {
        const box = mailboxes.find((b) => b.owner === o);
        return (box && box.address) || address(o);
    }

    /** The account's name as the title bar gives it. */
    function accountTitle() {
        if (isImap()) return imapName(imapAcct(imapId)) || 'E-mail';
        return isMail() ? MAIL_ACCOUNT : personaName(dirP);
    }

    /** What the status line names: the account, or the agent's mailbox under Other Mailboxes. */
    function statusName() {
        return isMail() && !isMine() ? boxLabel(owner) : accountTitle();
    }

    /** A person's name in a list or header: the mailbox label for ours, else the address. */
    function personName(name) {
        const b = String(name || '').trim();
        if (!b) return '';
        if (!b.includes('@')) {
            const box = mailboxes.find((x) => x.owner === b.toLowerCase());
            if (box) return boxLabel(box.owner);
        }
        return address(b);
    }

    /** The display name of a From header ('"Claude Code" <x@y>' -> Claude Code). */
    function headerName(label) {
        const t = String(label || '').trim();
        const m = t.match(/^"?([^"<]*?)"?\s*<[^>]*>$/);
        return (m && m[1].trim()) || t;
    }

    function senderText(m) {
        if (!m) return '';
        return m.fromLabel && !m.labelSuspicious ? headerName(m.fromLabel) : personName(m.from);
    }

    /** The From line's name: the owner's (Owner Information) on the administrator account, else the mailbox's. */
    function ownerName() {
        const acc = window.meletonAccounts;
        try {
            const who = acc && typeof acc.current === 'function' ? acc.current() : null;
            if (who === 'administrator' && typeof acc.name === 'function') return acc.name(who) || boxLabel(human());
        } catch (_) { /* below */ }
        return boxLabel(human());
    }

    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    function fmtTime(d) {
        let h = d.getHours();
        const ap = h < 12 ? 'AM' : 'PM';
        h = h % 12 || 12;
        return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
    }
    const fmtShortDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
    const toDate = (v) => {
        if (v == null || v === '') return null;
        const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    };

    /** The list's date column: the time for today's mail, M/D/YY before that. */
    function listDate(iso) {
        const d = toDate(iso);
        if (!d) return '';
        return sameDay(d, new Date()) ? fmtTime(d) : fmtShortDate(d);
    }

    function longDate(iso) {
        const d = toDate(iso);
        if (!d) return '';
        const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
        return `${day} ${fmtShortDate(d)} ${fmtTime(d)}`;
    }

    /** The reading page's Sent line: "Wednesday, November 11, 2026" and the time under it. */
    function sentDate(iso) {
        const d = toDate(iso);
        if (!d) return ['', ''];
        const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
        const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()];
        return [`${day}, ${month} ${d.getDate()}, ${d.getFullYear()}`, fmtTime(d)];
    }

    /** The list's size column: "3K" (the device rounds up; nothing under 1K). */
    const sizeText = (n) => `${Math.max(1, Math.ceil((Number(n) || 0) / 1024))}K`;

    // ---------------------------------------------------------------- accounts

    function xiOn() {
        const inst = window.directorInstance;
        const st = inst && inst._status;
        if (st && st.xi && typeof st.xi.enabled === 'boolean') return st.xi.enabled;
        return xiEnabled;
    }

    const personas = () => PERSONAS.filter(([p]) => p !== 'xi' || xiOn());
    const smsUnread = () => { const c = window.wmChatApp; try { return c && typeof c.unread === 'function' ? c.unread() : 0; } catch (_) { return 0; } };
    const mailUnread = (o = human()) => { const box = mailboxes.find((b) => b.owner === o); return box ? box.unread || 0 : 0; };

    // ---- Text Messaging accounts (#779): read through window.textMessaging at call time (a test
    // tab swaps in a stand-in after load); the list is cached here and refreshed on its 'account'
    // and 'unread' events
    let tmAccts = [];
    let tmShown = 0; // Text Messaging rows in the picker as last drawn
    let tmWiredTo = null;
    const tmApi = () => window.textMessaging || null;
    const tmUnread = (id) => { const t = tmApi(); try { const u = t && typeof t.unread === 'function' ? t.unread() : null; return (u && u.byAccount && u.byAccount[id] && u.byAccount[id].unread) || 0; } catch (_) { return 0; } };
    function tmLabel(a) {
        const t = tmApi();
        try { if (t && typeof t.label === 'function') return t.label(a); } catch (_) { /* below */ }
        return { title: a.name || 'Text Messaging', subline: a.identity || '' };
    }
    function tmRepaint() {
        if (page && top() === 'accounts') renderAccounts();
        if (tree) renderTree();
    }
    async function loadTmAccounts(force) {
        const t = tmApi();
        if (!t || typeof t.accounts !== 'function') { tmAccts = []; return tmAccts; }
        try { const d = await t.accounts(force); tmAccts = (d && d.accounts) || []; } catch (_) { /* keeps the last list */ }
        return tmAccts;
    }
    const onTmAccount = () => { loadTmAccounts(true).then(tmRepaint); };
    const onTmUnread = () => tmRepaint();
    function wireTm() {
        const t = tmApi();
        if (!t || t === tmWiredTo || typeof t.on !== 'function') return;
        if (tmWiredTo && typeof tmWiredTo.off === 'function') { tmWiredTo.off('account', onTmAccount); tmWiredTo.off('unread', onTmUnread); }
        t.on('account', onTmAccount);
        t.on('unread', onTmUnread);
        tmWiredTo = t;
        loadTmAccounts(false).then(tmRepaint);
    }
    /** Text Messaging accounts and Dreamscape Messenger's unread counts for the picker. */
    function refreshTm() {
        wireTm();
        loadChatUserName();
        const t = tmApi();
        loadTmAccounts(false).then(() => { tmRepaint(); if (t && typeof t.summary === 'function') t.summary().then((list) => { if (Array.isArray(list)) tmAccts = list; tmRepaint(); }, () => {}); });
    }

    // ---- IMAP e-mail accounts (#789): read through window.mailAccounts at call time (a test tab
    // swaps in a stand-in after load); the accounts and each account's folders are cached here and
    // read again on its events ('new', 'flags', 'removed', 'folders', 'account', 'unread')
    let imapAccts = [];
    let imapLoaded = false;
    const imapFolders = new Map(); // account id -> [{ path, name, delimiter, special, total, unseen }]
    let imapWiredTo = null;
    const maApi = () => window.mailAccounts || null;
    const imapAcct = (id) => imapAccts.find((a) => a.id === id) || null;
    const imapName = (a) => (a ? String(a.displayName || a.name || a.email || '').trim() : '');
    function imapUnread(id) {
        const m = maApi();
        try {
            const u = m && typeof m.unread === 'function' ? m.unread() : null;
            if (u && u.byAccount && u.byAccount[id] != null) return Number(u.byAccount[id]) || 0;
        } catch (_) { /* below */ }
        const a = imapAcct(id);
        return a ? Number(a.unread) || 0 : 0;
    }
    // the folders the device knows by name and picture (special use); the rest keep the server's name
    const SPECIAL = {
        '\\Inbox': { label: 'Inbox', icon: 'msg-folder-inbox' },
        '\\Drafts': { label: 'Drafts', icon: 'msg-folder-drafts' },
        '\\Sent': { label: 'Sent Items', icon: 'msg-folder-outbox' },
        '\\Trash': { label: 'Deleted Items', icon: 'msg-folder-deleted' },
        '\\Junk': { label: 'Junk E-mail', icon: 'msg-folder-folder' }
    };
    const leafName = (p, delim) => { const s = String(p || ''); if (!delim) return s; const i = s.lastIndexOf(delim); return i >= 0 ? s.slice(i + 1) : s; };
    const imapFolderOf = (p, id = imapId) => (imapFolders.get(id) || []).find((f) => f.path === p) || null;
    function imapSpecial(p, id = imapId) {
        const f = imapFolderOf(p, id);
        if (f) return f.special || null;
        return String(p || '').toUpperCase() === 'INBOX' ? '\\Inbox' : null;
    }
    /** A folder's name and picture as the device shows it. */
    function imapFolderInfo(p, id = imapId) {
        const f = imapFolderOf(p, id);
        const sp = SPECIAL[imapSpecial(p, id)];
        if (sp) return { label: sp.label, icon: sp.icon };
        return { label: (f && f.name) || leafName(p, f && f.delimiter) || String(p || ''), icon: 'msg-folder-folder' };
    }
    function imapPathOf(special, id = imapId) {
        const f = (imapFolders.get(id) || []).find((x) => x.special === special);
        return f ? f.path : (special === '\\Inbox' ? 'INBOX' : null);
    }
    // sent mail and drafts list the recipients, not the sender
    const outFolder = () => (isImap() ? ['\\Sent', '\\Drafts'].includes(imapSpecial(folder)) : (folder === 'sent' || folder === 'outbox'));

    async function loadImapAccounts(force) {
        const m = maApi();
        if (!m || typeof m.accounts !== 'function') { imapAccts = []; return imapAccts; }
        try {
            const d = await m.accounts(force);
            imapAccts = ((d && d.accounts) || []).filter((a) => a && a.id && a.enabled !== false);
            imapLoaded = true;
        } catch (_) { /* keeps the last list */ }
        return imapAccts;
    }
    async function loadImapFolders(id) {
        const m = maApi();
        if (!id || !m || typeof m.folders !== 'function') return imapFolders.get(id) || [];
        try { const list = await m.folders(id); if (Array.isArray(list)) imapFolders.set(id, list); } catch (_) { /* keeps the last list */ }
        return imapFolders.get(id) || [];
    }
    function imapRepaint() {
        tmRepaint();
        if (page && isImap() && top() === 'list') { renderBar(); renderStatus(); }
    }
    const shellStatus = () => { if (ws && typeof ws.refreshStatus === 'function') ws.refreshStatus(); };

    // a burst of events (a sync, a batch delete) reads the list and the counts once
    let imapListTimer = null;
    let imapMetaTimer = null;
    const imapMetaDue = new Set();
    function imapChanged(d) {
        if (!d || !d.accountId) return;
        if (imapFolders.has(d.accountId) || d.accountId === imapId) {
            imapMetaDue.add(d.accountId);
            clearTimeout(imapMetaTimer);
            imapMetaTimer = setTimeout(() => {
                const ids = [...imapMetaDue];
                imapMetaDue.clear();
                Promise.all(ids.map(loadImapFolders)).then(imapRepaint);
            }, 400);
        }
        if (page && isImap() && d.accountId === imapId && (!d.folder || d.folder === folder) && isCurrent()) {
            clearTimeout(imapListTimer);
            imapListTimer = setTimeout(() => { if (page && isImap() && d.accountId === imapId && top() !== 'compose') loadFolder({ keep: true }); }, 300);
        }
    }
    const onImapNew = (d) => { imapChanged(d); imapNotify(d); };
    /** Flags changed (here or on another client): flags { uid: [flags] } read at once drop their new state. */
    function onImapFlags(d) {
        imapChanged(d);
        const map = d && d.flags && typeof d.flags === 'object' ? d.flags : null;
        if (!map) return;
        const seen = Object.keys(map).filter((u) => Array.isArray(map[u]) && map[u].includes('\\Seen'));
        if (seen.length) dropFresh(d.accountId, d.folder, seen);
        // the list on screen shows the change before its reload comes back
        if (page && isImap() && d.accountId === imapId && d.folder === folder) {
            let changed = false;
            Object.keys(map).forEach((u) => {
                const r = mailById(u);
                const fl = Array.isArray(map[u]) ? map[u] : null;
                if (!r || !fl) return;
                const read = fl.includes('\\Seen');
                const flagged = fl.includes('\\Flagged');
                if (r.read !== read || r.flagged !== flagged) { r.read = read; r.flagged = flagged; changed = true; }
            });
            if (changed && top() === 'list') renderList();
        }
    }
    const onImapRemoved = (d) => { imapChanged(d); if (d) dropFresh(d.accountId, d.folder, d.uids); };
    function onImapAccount(d) {
        loadImapAccounts(true).then(() => {
            // the account on screen was deleted (Dreamscape CardSpace): back to Dreamscape Mail
            if (isImap() && !imapAcct(imapId) && d && d.accountId === imapId) goTo('mail');
            imapRepaint();
            if (isImap() && top() === 'list') ws.setTitle(titleText());
        });
    }
    function onImapUnread(u) {
        // an account read to the end has nothing new left
        const by = (u && u.byAccount) || {};
        const before = imapFresh.length;
        for (let i = imapFresh.length - 1; i >= 0; i--) if (by[imapFresh[i].accountId] === 0) imapFresh.splice(i, 1);
        [...imapPending].forEach((k) => { if (by[k.split('|')[0]] === 0) imapPending.delete(k); });
        if (imapFresh.length !== before) updateImapNote();
        imapRepaint();
        shellStatus();
    }
    function wireImap() {
        const m = maApi();
        if (!m || typeof m.on !== 'function') return;
        if (m === imapWiredTo) {
            // the first read failed (not connected yet): again until it answers (it also wires the client's events)
            if (!imapLoaded) loadImapAccounts(false).then(imapRepaint);
            return;
        }
        const ev = [['new', onImapNew], ['flags', onImapFlags], ['removed', onImapRemoved], ['folders', imapChanged], ['account', onImapAccount], ['unread', onImapUnread]];
        if (imapWiredTo && typeof imapWiredTo.off === 'function') ev.forEach(([e, fn]) => imapWiredTo.off(e, fn));
        ev.forEach(([e, fn]) => m.on(e, fn));
        imapWiredTo = m;
        imapLoaded = false;
        loadImapAccounts(false).then(imapRepaint);
    }
    function refreshImap() {
        wireImap();
        loadImapAccounts(true).then(imapRepaint);
    }

    // ---- New E-mail Message (outres 33323 / 33324): mail the server announces with notify, until it
    // is read; the shell's envelope and Today count these arrivals (window.wmMessaging.imapNew)
    const imapFresh = []; // the note's arrivals: [{ accountId, folder, uid, from, subject }]
    // arrivals not read yet (the title bar envelope): Dismiss closes the note, the envelope stays until they are read
    const imapPending = new Set(); // 'account|folder|uid'
    const pendKey = (a, f, u) => `${a}|${f}|${u}`;
    let imapNote = null;
    function imapNotify(d) {
        if (!d || d.notify !== true || !d.message || d.message.seen) return;
        // that Inbox on screen in front: the new row is the news
        if (isCurrent() && !document.hidden && isImap() && imapId === d.accountId && folder === d.folder && top() === 'list') return;
        const m = d.message;
        const f = Array.isArray(m.from) && m.from[0] ? m.from[0] : null;
        imapFresh.push({ accountId: d.accountId, folder: d.folder || m.folder, uid: m.uid, from: (f && (f.name || f.address)) || headerName(m.sender) || '', subject: m.subject || '(no subject)' });
        if (imapFresh.length > 50) imapFresh.shift();
        imapPending.add(pendKey(d.accountId, d.folder || m.folder, m.uid));
        showImapNote();
        shellStatus();
    }
    function dropFresh(accountId, f, uids) {
        const set = new Set([].concat(uids || []).map(String));
        const before = imapFresh.length + imapPending.size;
        for (let i = imapFresh.length - 1; i >= 0; i--) {
            const x = imapFresh[i];
            if (x.accountId === accountId && x.folder === f && set.has(String(x.uid))) imapFresh.splice(i, 1);
        }
        set.forEach((u) => imapPending.delete(pendKey(accountId, f, u)));
        if (imapFresh.length + imapPending.size !== before) { updateImapNote(); shellStatus(); }
    }
    function imapNoteParts() {
        const n = imapFresh.length;
        const last = imapFresh[n - 1];
        return {
            title: n === 1 ? 'New E-mail Message' : 'New E-mail Messages',
            html: n === 1
                ? `<button type="button" class="wch-note-open"><span class="wch-note-from">From: ${esc(last.from)}</span><span class="wch-note-text">${esc(last.subject)}</span></button>`
                : `<button type="button" class="wch-note-open"><span class="wch-note-text">You have ${n} unread e-mail messages.</span></button>`
        };
    }
    function closeImapNote(clear) {
        if (clear) imapFresh.length = 0;
        if (imapNote) { try { imapNote.close(); } catch (_) { /* gone */ } }
        imapNote = null;
        shellStatus();
    }
    function openImapFresh() {
        const list = imapFresh.slice();
        closeImapNote(true);
        const last = list[list.length - 1];
        if (!last) return;
        const one = list.every((x) => x.accountId === last.accountId);
        if (list.length === 1) openImapMessage(last.accountId, last.folder, last.uid);
        else goTo(`imap:${one ? last.accountId : list[0].accountId}`);
    }
    function showImapNote() {
        // each arrival is a new notification: it sounds and comes up again
        if (imapNote) { try { imapNote.close(); } catch (_) { /* gone */ } imapNote = null; }
        if (!imapFresh.length || !ws || typeof ws.appNote !== 'function') return;
        const parts = imapNoteParts();
        const note = ws.appNote({
            title: parts.title,
            html: parts.html,
            icon: 'status-mail',
            event: 'mail',
            softKeys: () => ({
                left: { label: 'Dismiss', action: () => closeImapNote(true) },
                right: { label: 'Menu', menu: () => [
                    { label: 'View', action: openImapFresh },
                    { label: 'Hide', action: () => { if (imapNote) imapNote.hide(); } }
                ] }
            })
        });
        if (!note) return;
        imapNote = note;
        const el = document.getElementById(note.id);
        if (el) el.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.wch-note-open')) openImapFresh(); });
    }
    /** What is still waiting, without a new sound: the text changes in place (or the note goes). */
    function updateImapNote() {
        if (!imapNote) return;
        if (!imapFresh.length) { closeImapNote(false); return; }
        imapNote.update(imapNoteParts());
    }

    // Dreamscape Messenger's subline: your name from the persona settings (Control Panel > Chat, the
    // phone's Dreamscape Messenger options), read each time the picker loads
    let chatUserName = '';
    function loadChatUserName() {
        const ws = window.wsClient;
        if (!ws || typeof ws.getPersonaSettings !== 'function') return;
        Promise.resolve(ws.getPersonaSettings()).then((r) => {
            const name = String((r && ((r.settings && r.settings.user_name) || (r.data && r.data.settings && r.data.settings.user_name))) || '').trim();
            if (name !== chatUserName) { chatUserName = name; tmRepaint(); }
        }, () => { /* keeps the last name */ });
    }

    /** The accounts in the picker's order: Text Messaging (each account), Dreamscape Messenger, Dreamscape Mail, the Director personas. */
    function accounts() {
        // before Messaging read them itself: the logon step's snapshot (textMessagingClient.js)
        if (!tmAccts.length) {
            const t = window.textMessaging;
            const snap = t && typeof t.snapshot === 'function' ? t.snapshot() : null;
            if (snap && Array.isArray(snap.accounts)) tmAccts = snap.accounts.filter((a) => a && a.enabled !== false);
        }
        const tms = tmAccts.map((a) => { const l = tmLabel(a); return { key: `tm:${a.id}`, name: l.title, icon: 'msg-acct-sms', sub: l.subline, dim: true, unread: tmUnread(a.id) }; });
        return tms.concat([
            { key: 'sms', name: SMS_ACCOUNT, icon: 'app-chat', sub: chatUserName, dim: !!chatUserName, unread: smsUnread() },
            { key: 'mail', name: MAIL_ACCOUNT, icon: 'msg-acct-outlook', sub: mailAddress(), dim: true, unread: mailUnread() }
        ]).concat(imapAccts.map((a) => ({ key: `imap:${a.id}`, name: imapName(a), icon: 'msg-acct-mail', sub: a.email || '', dim: true, unread: imapUnread(a.id) })))
            .concat(personas().map(([p, n]) => ({ key: `dir:${p}`, name: n, icon: `today-persona-${p}`, sub: 'Director', dim: true, unread: 0 })));
    }

    const currentKey = () => (isImap() ? `imap:${imapId}` : isMail() ? 'mail' : `dir:${dirP}`);

    /** Go To's account rows (the device lists them after Folders..., the current one with a bullet). */
    function accountItems(cur) {
        const now = cur || currentKey();
        return accounts().map((a) => ({ key: a.key, label: a.name, radio: a.key === now, action: () => goTo(a.key) }));
    }

    /** Another account: Text Messaging is wmTextMessaging.js, Dreamscape Messenger the Chat applet; the rest are this app's lists. */
    function goTo(key, f) {
        closeTree();
        if (key.startsWith('tm:')) {
            const t = window.wmTextMessaging;
            if (t && typeof t.showAccount === 'function') t.showAccount(key.slice(3), f || 'inbox');
            return;
        }
        if (key === 'sms') {
            const c = window.wmChatApp;
            if (c && typeof c.showList === 'function') { c.showList(); if (f && typeof c.setFolder === 'function') c.setFolder(f); }
            else if (ws) ws.open('chat');
            return;
        }
        if (key === 'setup') { setupAccount(); return; }
        if (ws && !isCurrent()) { skipPicker = true; ws.open(APP_ID); }
        if (key === 'mail' || key.startsWith('box:')) {
            acct = 'mail';
            switchTo(key === 'mail' ? human() : key.slice(4), f || 'inbox', { popLayers: true });
            return;
        }
        if (key.startsWith('imap:')) {
            const id = key.slice(5);
            if (!imapAcct(id) && imapLoaded) return;
            acct = 'imap';
            imapId = id;
            // the Inbox until the folders are known (its path is INBOX on every server)
            // ('inbox': an account row in the tree, Go To)
            folder = f && f !== 'inbox' ? f : imapPathOf('\\Inbox', id) || 'INBOX';
            layers = [];
            pickerRoot = false;
            endSelect();
            selectedId = null;
            mail = [];
            if (isCurrent()) { ws.setTitle(accountTitle()); ws.syncHistory(); }
            showLayer();
            loadFolder();
            if (!imapFolders.has(id)) loadImapFolders(id).then(() => { if (isImap() && imapId === id) { renderBar(); renderStatus(); } });
            return;
        }
        if (key.startsWith('dir:')) {
            const p = key.slice(4);
            if (!PERSONAS.some(([k]) => k === p)) return;
            acct = 'dir';
            dirP = p;
            folder = f || 'inbox';
            layers = [];
            pickerRoot = false;
            multi.clear();
            several = false;
            selectedId = null;
            mail = [];
            if (isCurrent()) { ws.setTitle(accountTitle()); ws.syncHistory(); }
            showLayer();
            loadDirector({ keep: false });
        }
    }

    /** Setup E-mail / New Account...: accounts are made on the desktop (Dovecote), not here. */
    async function setupAccount() {
        if (!ws) return;
        await ws.messageBox({
            title: 'Messaging',
            icon: 'info',
            text: 'E-mail accounts are set up on the desktop in Control Panel > Dreamscape CardSpace. Messaging shows them with Dreamscape Mail, the other Dreamscape mailboxes (under Other Mailboxes) and the Director personas.'
        });
    }

    // ---------------------------------------------------------------- data

    async function loadMailboxes() {
        try {
            const r = await send('dovecote_list_mailboxes', {});
            mailboxes = (r && (r.mailboxes || (r.data && r.data.mailboxes))) || [];
        } catch (_) { /* the picker keeps what it had */ }
        if (!owner || (owner !== human() && !mailboxes.some((b) => b.owner === owner))) owner = human();
        if (top() === 'accounts') renderAccounts();
        if (tree) renderTree();
        renderBar();
        renderStatus();
    }

    /** Whether Yozora (Xi) is on: the Director's own status, else a session list's xiEnabled. */
    function probeXi() {
        const inst = window.directorInstance;
        if ((inst && inst._status && inst._status.xi) || Date.now() - xiAsked < 60000) return;
        xiAsked = Date.now();
        send('director_get_sessions', { persona: 'wren' }, true).then((r) => {
            const d = r && (Array.isArray(r.sessions) ? r : r.data);
            if (!d) return;
            if (typeof d.xiEnabled === 'boolean') xiEnabled = d.xiEnabled;
            if (Array.isArray(d.sessions)) dirLists.wren = d.sessions;
            if (top() === 'accounts') renderAccounts();
            if (tree) renderTree();
        }).catch(() => { /* Director not running: Yumiya and Chiyo stay, Yozora waits */ });
    }

    /** Dreamscape Messenger's unread count for the picker (the Chat applet reads its chats behind it). */
    function refreshSms() {
        const c = window.wmChatApp;
        if (!c || typeof c.refresh !== 'function') return;
        c.refresh().then(() => { if (top() === 'accounts') renderAccounts(); if (tree) renderTree(); }, () => {});
    }

    function sorted(list) {
        const out = list.slice();
        if (!isList()) return out; // the Director's own order: last activity first
        if (sortField === 'from') out.sort((a, b) => senderText(a).localeCompare(senderText(b), undefined, { sensitivity: 'base' }) || (b.createdAt > a.createdAt ? 1 : -1));
        else if (sortField === 'subject') out.sort((a, b) => String(a.subject || '').localeCompare(String(b.subject || ''), undefined, { sensitivity: 'base' }) || (b.createdAt > a.createdAt ? 1 : -1));
        else out.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));
        return out;
    }

    function syncMap() {
        try { return JSON.parse(stored(OPT.sync) || '{}') || {}; } catch (_) { return {}; }
    }
    // an IMAP account's folders all come from the server's copy
    const folderSynced = (id) => isImap() || !(FOLDERS.find((f) => f.id === id) || {}).sync || syncMap()[id] !== false;

    async function loadFolder(opts = {}) {
        if (isImap()) return loadImap(opts);
        if (!isMail()) return loadDirector(opts);
        const token = ++listToken;
        loading = true;
        // a page of older mail in flight belongs to the old list: drop it and let loadMore run again
        loadingMore = false;
        listError = '';
        if (!opts.keep) { mail = []; hasMore = false; nextCursor = null; selectedId = null; multi.clear(); several = false; renderList(); }
        if (!folderSynced(folder)) {
            loading = false;
            mail = [];
            renderList();
            if (isCurrent()) ws.refreshSoftKeys();
            return true;
        }
        // Drafts live on this phone (Save to Drafts, #757): Dreamscape Mail keeps no drafts folder on the server
        if (folder === 'drafts' && isMine()) {
            loading = false;
            mail = draftRows();
            hasMore = false;
            nextCursor = null;
            renderList();
            if (isCurrent()) ws.refreshSoftKeys();
            return true;
        }
        const request = { folder, limit: Math.max(PAGE_LIMIT, opts.keep ? mail.length : 0) };
        if (!isMine()) request.viewAsOwner = owner;
        let ok = true;
        try {
            // a new folder / account is a wait (the list is empty until it comes): the wait cursor;
            // a refresh of the list on screen (keep) runs behind it
            const r = await (opts.keep ? send('dovecote_list_mail', request) : busyOf(() => send('dovecote_list_mail', request)));
            if (token !== listToken) return false;
            mail = (r && r.mail) || [];
            nextCursor = (r && r.nextCursor) || null;
            hasMore = !!(r && r.hasMore);
            if (selectedId && !mailById(selectedId)) selectedId = null;
            [...multi].forEach((id) => { if (!mailById(id)) multi.delete(id); });
        } catch (err) {
            if (token !== listToken) return false;
            ok = false;
            if (!opts.keep) mail = [];
            hasMore = false;
            listError = (err && err.message) || 'Could not load messages.';
        }
        loading = false;
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
        return ok;
    }

    async function loadDirector(opts = {}) {
        watchDirectorRows();
        const p = dirP;
        const token = ++listToken;
        if (p === 'xi' && !xiOn()) { dirLists.xi = []; loading = false; renderList(); return true; }
        loading = true;
        listError = '';
        if (!opts.keep) renderList();
        let ok = true;
        try {
            const ask = () => send('director_get_sessions', { persona: p }, true);
            const r = await (opts.keep || dirLists[p] ? ask() : busyOf(ask));
            if (token !== listToken) return false;
            const d = r && (Array.isArray(r.sessions) ? r : r.data);
            dirLists[p] = (d && Array.isArray(d.sessions)) ? d.sessions.filter((s) => s && s.id) : [];
            if (d && typeof d.xiEnabled === 'boolean') xiEnabled = d.xiEnabled;
        } catch (err) {
            if (token !== listToken) return false;
            ok = false;
            listError = (err && err.message) || 'The Director sessions could not be read.';
        }
        loading = false;
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
        return ok;
    }

    async function loadMore() {
        if (isImap()) { loadMoreImap(); return; }
        if (!isMail() || !hasMore || loadingMore || loading || !nextCursor) return;
        const token = listToken;
        loadingMore = true;
        const request = { folder, cursor: nextCursor, limit: PAGE_LIMIT };
        if (!isMine()) request.viewAsOwner = owner;
        let stale = false;
        try {
            const r = await send('dovecote_list_mail', request);
            if (token !== listToken) { stale = true; return; }
            const seen = new Set(mail.map((m) => String(m.id)));
            ((r && r.mail) || []).forEach((m) => { if (!seen.has(String(m.id))) mail.push(m); });
            nextCursor = (r && r.nextCursor) || null;
            hasMore = !!(r && r.hasMore);
        } catch (_) {
            if (token !== listToken) { stale = true; return; }
            hasMore = false;
        } finally {
            // a newer list owns the flag once it reset it; only clear our own
            if (!stale) loadingMore = false;
        }
        renderList();
    }

    // ---------------------------------------------------------------- IMAP account lists (#789)

    const addrsOf = (list) => (Array.isArray(list) ? list : []).map((a) => (a && typeof a === 'object' ? a.address || a.name : a)).filter(Boolean);

    /** A list item of window.mailAccounts as the list's row (the shape Dreamscape Mail's rows have). */
    function imapRow(it) {
        const f = Array.isArray(it.from) && it.from[0] ? it.from[0] : null;
        return {
            id: String(it.uid), uid: Number(it.uid), imap: true,
            from: (f && f.address) || headerName(it.sender) || '',
            fromLabel: (f && f.name) || '',
            to: addrsOf(it.to), cc: addrsOf(it.cc),
            subject: it.subject || '', createdAt: Number(it.date) || null,
            read: !!it.seen, flagged: !!it.flagged, answered: !!it.answered,
            size: it.size != null ? it.size : null, snippet: it.snippet || '',
            // the list knows only that there are some: the envelope with the clip
            attachments: it.hasAttachments ? [{ name: '' }] : []
        };
    }

    /** The whole message (message()): the row plus its body, pictures held back and attachments. */
    function imapFull(it) {
        const row = imapRow(it);
        const html = String(it.html || '');
        return Object.assign(row, {
            format: html ? 'html' : 'text',
            body: html || String(it.text || ''),
            html,
            text: String(it.text || ''),
            remoteImages: Array.isArray(it.remoteImages) ? it.remoteImages : [],
            showPictures: false,
            replyTo: addrsOf(it.replyTo),
            bcc: addrsOf(it.bcc),
            // pictures inside the HTML (cid:) are shown there, not listed
            attachments: (it.attachments || []).filter((a) => !(a.inline && a.cid)).map((a) => ({ name: a.filename || 'attachment', url: a.url, mimeType: a.type || 'application/octet-stream', size: a.size, part: a.part != null ? String(a.part) : null }))
        });
    }

    async function loadImap(opts = {}) {
        const m = maApi();
        const id = imapId;
        const token = ++listToken;
        loading = true;
        loadingMore = false;
        listError = '';
        if (!opts.keep) { mail = []; hasMore = false; nextCursor = null; selectedId = null; endSelect(); renderList(); }
        if (!m || typeof m.messages !== 'function') {
            loading = false;
            listError = 'E-mail accounts are not available.';
            renderList();
            return false;
        }
        const ask = () => m.messages(id, folder, { limit: Math.min(500, Math.max(PAGE_LIMIT, opts.keep ? mail.length : 0)) });
        let ok = true;
        try {
            // a new folder / account is a wait (the wait cursor); a refresh of the list on screen runs behind it
            const r = await (opts.keep ? ask() : busyOf(ask));
            if (token !== listToken) return false;
            mail = ((r && r.messages) || []).map(imapRow);
            nextCursor = (r && r.cursor) || null;
            hasMore = !!(r && r.more);
            if (selectedId && !mailById(selectedId)) selectedId = null;
            [...multi].forEach((x) => { if (!mailById(x)) multi.delete(x); });
        } catch (err) {
            if (token !== listToken) return false;
            ok = false;
            if (!opts.keep) mail = [];
            hasMore = false;
            listError = (err && err.message) || 'Could not load messages.';
        }
        loading = false;
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
        return ok;
    }

    /** The next page of older mail (the server's cursor: before the last row's date). */
    async function loadMoreImap() {
        const m = maApi();
        if (!m || !hasMore || loadingMore || loading || !nextCursor) return;
        const token = listToken;
        loadingMore = true;
        let stale = false;
        try {
            const r = await m.messages(imapId, folder, { limit: PAGE_LIMIT, before: nextCursor });
            if (token !== listToken) { stale = true; return; }
            const seen = new Set(mail.map((x) => String(x.id)));
            ((r && r.messages) || []).map(imapRow).forEach((x) => { if (!seen.has(x.id)) mail.push(x); });
            nextCursor = (r && r.cursor) || null;
            hasMore = !!(r && r.more);
        } catch (_) {
            if (token !== listToken) { stale = true; return; }
            hasMore = false;
        } finally {
            if (!stale) loadingMore = false;
        }
        renderList();
    }

    const uidsOf = (ids) => ids.map((x) => Number(String(x))).filter((n) => n > 0);

    /** A change at the mail server under the wait cursor; a refusal is the device's error box. */
    async function imapDo(fn, fail) {
        try {
            await busyOf(fn);
            return true;
        } catch (err) {
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || fail || 'The message could not be changed.' });
            return false;
        }
    }

    /** Follow up > Set Flag / Clear Flag (IMAP's \Flagged; Complete Flag is Exchange's). */
    async function setFlagged(ids, on) {
        const m = maApi();
        if (!isImap() || !ids.length || !m) return;
        if (!(await imapDo(() => (on ? m.flag : m.unflag)(imapId, folder, uidsOf(ids))))) return;
        ids.forEach((x) => {
            const r = mailById(x);
            if (r) r.flagged = on;
            if (reading && String(reading.id) === String(x)) reading.flagged = on;
        });
        endSelect();
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function followUpItem(rows) {
        const list = (rows || []).filter(Boolean);
        return {
            label: 'Follow up',
            disabled: !list.length,
            submenu: () => [
                { label: 'Set Flag', disabled: list.every((m) => m.flagged), action: () => setFlagged(list.map((m) => String(m.id)), true) },
                { label: 'Complete Flag', disabled: true },
                { label: 'Clear Flag', disabled: !list.some((m) => m.flagged), action: () => setFlagged(list.map((m) => String(m.id)), false) }
            ]
        };
    }

    /** Move for an IMAP account: to another of its folders at the mail server. */
    async function moveToImap(target) {
        const ids = moveIds.slice();
        const m = maApi();
        if (!ids.length || !m) return;
        popLayer();
        if (target === folder) return;
        if (!(await imapDo(() => m.move(imapId, folder, uidsOf(ids), target), 'The message could not be moved.'))) return;
        dropFresh(imapId, folder, ids);
        afterRemoved(ids);
    }

    /** Rows gone from the list (deleted, moved): the next one down takes the selection, as on the device. */
    function afterRemoved(ids, opts = {}) {
        const wasReading = top() === 'read';
        if (wasReading) popLayer();
        const rows = sorted(mail);
        const at = rows.findIndex((m) => String(m.id) === String(ids[0]));
        const gone = new Set(ids.map(String));
        mail = mail.filter((m) => !gone.has(String(m.id)));
        endSelect();
        const rest = sorted(mail);
        const next = rest.length ? rest[Math.min(Math.max(at, 0), rest.length - 1)] : null;
        selectedId = next ? String(next.id) : null;
        // Options > Message: "After deleting or moving a message: Show next message"
        if (wasReading && next && !opts.noNext && stored(OPT.afterDelete) !== 'list') openMessage(next);
        renderList();
        loadFolder({ keep: true });
    }

    /** Empty Deleted Items for an IMAP account: everything in its Trash, for good. */
    async function emptyImapTrash() {
        const m = maApi();
        const trash = imapPathOf('\\Trash');
        if (!m || !trash) return;
        const yes = await ws.messageBox({ title: 'Messaging', icon: 'warning', text: 'All items in the Deleted Items folder will be permanently deleted. Continue?', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false });
        if (!yes) return;
        const id = imapId;
        await imapDo(async () => {
            for (let round = 0; round < 20; round++) {
                const r = await m.messages(id, trash, { limit: 500 });
                const uids = ((r && r.messages) || []).map((x) => Number(x.uid)).filter(Boolean);
                if (!uids.length) break;
                await m.remove(id, trash, uids);
                if (!(r && r.more)) break;
            }
        }, 'The Deleted Items folder could not be emptied.');
        if (isImap() && imapId === id && folder === trash) loadFolder();
    }

    /**
     * Search Phone, the new-mail notification: Messaging on that IMAP account and folder, the
     * message open (its list item when the caller has one, else fetched by uid).
     */
    function openImapMessage(accountId, f, uid, item) {
        if (!ws || !accountId || uid == null) return;
        skipPicker = true;
        ws.open(APP_ID, { fromStart: true });
        if (!page) return;
        const path = f || 'INBOX';
        if (!(isImap() && imapId === accountId && folder === path && top() === 'list')) goTo(`imap:${accountId}`, path);
        if (!isImap() || imapId !== accountId) return;
        const row = (item && imapRow(item)) || mailById(String(uid)) || { id: String(uid), uid: Number(uid), imap: true, subject: '', read: true, attachments: [] };
        openMessage(row);
    }

    function switchTo(o, f, opts = {}) {
        acct = 'mail';
        owner = o || human();
        folder = f || 'inbox';
        if (opts.popLayers) { layers = []; pickerRoot = false; }
        multi.clear();
        several = false;
        if (isCurrent()) { ws.setTitle(titleText()); ws.syncHistory(); }
        showLayer();
        loadFolder();
    }

    /** dovecote_mark_mail for the person's own mail; ids[] is one round trip. */
    async function mark(ids, patch) {
        const list = (ids || []).map(String).filter(Boolean);
        if (!list.length || !isMine()) return false;
        try {
            await busyOf(() => send('dovecote_mark_mail', Object.assign({ ids: list }, patch)));
            return true;
        } catch (err) {
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || 'The message could not be changed.' });
            return false;
        }
    }

    function endSelect() {
        multi.clear();
        several = false;
    }

    async function setRead(ids, read) {
        if (isImap()) {
            const m = maApi();
            if (!ids.length || !m || !(await imapDo(() => (read ? m.markRead : m.markUnread)(imapId, folder, uidsOf(ids))))) return;
            if (read) dropFresh(imapId, folder, ids);
        } else if (!(await mark(ids, { read }))) return;
        ids.forEach((id) => {
            const m = mailById(id);
            if (m) m.read = read;
            if (reading && String(reading.id) === String(id)) reading.read = read;
        });
        endSelect();
        renderList();
        if (!isImap()) loadMailboxes();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    async function deleteIds(ids, opts = {}) {
        if (!ids.length || !canAct()) return;
        if (isMail() && folder === 'drafts') {
            if (opts.fromList && optOn(OPT.warnDelete)) {
                const yes = await ws.messageBox({ title: 'Messaging', icon: 'question', text: ids.length === 1 ? 'Delete the selected message?' : `Delete the ${ids.length} selected messages?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false });
                if (!yes) return;
            }
            ids.forEach((id) => dropDraft(String(id).replace(/^draft:/, '')));
            if (top() === 'read') popLayer();
            loadFolder({ keep: true });
            return;
        }
        // an IMAP account's Trash deletes for good at the mail server (mailAccounts.remove)
        const permanent = isImap() ? imapSpecial(folder) === '\\Trash' : folder === 'deleted';
        if (permanent) {
            const yes = await ws.messageBox({
                title: 'Messaging',
                icon: 'warning',
                text: ids.length === 1 ? 'The selected message will be permanently deleted. Continue?' : `The ${ids.length} selected messages will be permanently deleted. Continue?`,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
                cancelValue: false
            });
            if (!yes) return;
        } else if (opts.fromList && optOn(OPT.warnDelete)) {
            // Options > Message: "Warn when deleting messages in the message list"
            const yes = await ws.messageBox({
                title: 'Messaging',
                icon: 'question',
                text: ids.length === 1 ? 'Delete the selected message?' : `Delete the ${ids.length} selected messages?`,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
                cancelValue: false
            });
            if (!yes) return;
        }
        if (isImap()) {
            const m = maApi();
            if (!m || !(await imapDo(() => m.remove(imapId, folder, uidsOf(ids)), 'The message could not be deleted.'))) return;
            dropFresh(imapId, folder, ids);
            afterRemoved(ids);
            return;
        }
        const rows = sorted(mail);
        const at = rows.findIndex((m) => String(m.id) === String(ids[0]));
        if (!(await mark(ids, { deleted: true }))) return;
        // Options > Storage: "Empty deleted items: Immediately" deletes them for good at once
        if (!permanent && stored(OPT.emptyDeleted) === 'immediate') {
            try { await send('dovecote_mark_mail', { ids: ids.map(String), deleted: true }); } catch (_) { /* they stay in Deleted Items */ }
        }
        const gone = new Set(ids.map(String));
        mail = mail.filter((m) => !gone.has(String(m.id)));
        endSelect();
        // the next message down takes the selection, as on the device
        const rest = sorted(mail);
        const next = rest.length ? rest[Math.min(Math.max(at, 0), rest.length - 1)] : null;
        selectedId = next ? String(next.id) : null;
        if (top() === 'read') {
            popLayer();
            // Options > Message: "After deleting or moving a message: Show next message"
            if (next && stored(OPT.afterDelete) !== 'list') openMessage(next);
        }
        renderList();
        loadFolder({ keep: true });
        loadMailboxes();
    }

    async function moveTo(target) {
        if (isImap()) { await moveToImap(target); return; }
        const t = MOVE_TARGETS.find((x) => x.id === target);
        const ids = moveIds.slice();
        if (!t || !ids.length) return;
        popLayer();
        if (target === folder) return;
        if (!(await mark(ids, t.patch))) return;
        const wasReading = top() === 'read';
        if (wasReading) popLayer();
        const rows = sorted(mail);
        const at = rows.findIndex((m) => String(m.id) === String(ids[0]));
        const gone = new Set(ids.map(String));
        mail = mail.filter((m) => !gone.has(String(m.id)));
        endSelect();
        const rest = sorted(mail);
        const next = rest.length ? rest[Math.min(Math.max(at, 0), rest.length - 1)] : null;
        selectedId = next ? String(next.id) : null;
        if (wasReading && next && stored(OPT.afterDelete) !== 'list') openMessage(next);
        renderList();
        loadFolder({ keep: true });
        loadMailboxes();
    }

    async function emptyDeleted() {
        if (isImap()) { await emptyImapTrash(); return; }
        if (!isMine()) return;
        const yes = await ws.messageBox({
            title: 'Messaging',
            icon: 'warning',
            text: 'All items in the Deleted Items folder will be permanently deleted. Continue?',
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
            cancelValue: false
        });
        if (!yes) return;
        await busyOf(async () => {
            for (let round = 0; round < 20; round++) {
                let ids = [];
                try {
                    const r = await send('dovecote_list_mail', { folder: 'deleted', limit: 200 });
                    ids = ((r && r.mail) || []).map((m) => String(m.id));
                } catch (_) { break; }
                if (!ids.length || !(await mark(ids, { deleted: true }))) break;
            }
        });
        if (folder === 'deleted') loadFolder();
        loadMailboxes();
    }

    /** Send/Receive: "Connecting..." on the status line until it answers; a failure is the device's box. */
    async function sendReceive() {
        if (syncing) return;
        syncing = true;
        renderStatus();
        if (isCurrent()) ws.refreshSoftKeys();
        const token = listToken + 1;
        let ok = true;
        try {
            if (isMail()) await loadMailboxes();
            // an IMAP account: the server checks the mail server now (mailAccounts.resync); the list
            // reads its copy, and again as the new mail comes in ('new' / 'folders' events)
            if (isImap()) {
                const m = maApi();
                if (m && typeof m.resync === 'function') await m.resync(imapId, false);
                loadImapFolders(imapId).then(imapRepaint);
            }
            ok = await loadFolder({ keep: true });
        } catch (_) { ok = false; }
        const stopped = !syncing || listToken > token;
        syncing = false;
        renderStatus();
        if (isCurrent()) ws.refreshSoftKeys();
        if (!ok && !stopped && isCurrent()) await ws.messageBox({ title: 'Messaging', icon: 'warning', text: DOWNLOAD_ERROR });
    }

    function stopSendReceive() {
        syncing = false;
        listToken++;
        loading = false;
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- layers

    function pushLayer(kind) {
        if (top() === kind) return;
        closeTree();
        layers.push(kind);
        pickIndex = -1; // the picker starts on its current row
        showLayer();
        if (isCurrent()) ws.syncHistory();
    }

    function popLayer() {
        if (!layers.length) return false;
        const gone = layers.pop();
        if (gone === 'read') { reading = null; readToken++; }
        if (gone === 'compose') compose = null;
        if (gone === 'move') moveIds = [];
        if (gone === 'accounts') pickerRoot = false;
        showLayer();
        if (isCurrent()) ws.syncHistory();
        return true;
    }

    function titleText() {
        const t = top();
        if (t === 'accounts') return 'Messaging';
        if (t === 'move') return 'Move';
        return accountTitle();
    }

    function showLayer() {
        if (!page) return;
        const t = top();
        page.querySelectorAll(':scope > .msg-view').forEach((v) => { v.hidden = v.dataset.view !== t; });
        if (t === 'list') { renderBar(); renderList(); }
        if (t === 'accounts') renderAccounts();
        if (t === 'move') renderMove();
        if (t === 'manage') renderManage();
        if (t === 'msgopts') renderMsgOpts();
        if (t === 'sender') renderSender();
        if (t === 'recip') renderRecipients();
        if (isCurrent()) {
            ws.setTitle(titleText());
            ws.refreshSoftKeys();
        }
    }

    /** Back key: the open tree, a selection, then the open layer (a new message with text asks first). */
    function goBack() {
        if (tree) { closeTree(); return true; }
        const t = top();
        if (t === 'list') {
            if (multi.size || several) { endSelect(); renderList(); if (isCurrent()) ws.refreshSoftKeys(); return true; }
            return false;
        }
        if (t === 'accounts' && pickerRoot) return false;
        if (t === 'compose' && composeDirty()) {
            confirmCancelCompose();
            return true;
        }
        popLayer();
        return true;
    }

    // ---------------------------------------------------------------- list page

    function renderBar() {
        if (!page) return;
        const f = isImap() ? imapFolderInfo(folder) : folderOf(folder);
        const btn = page.querySelector('.msg-folder');
        if (!btn || tree) return;
        btn.querySelector('img').outerHTML = img(f.icon);
        btn.querySelector('.msg-folder-name').textContent = f.label;
        const sort = page.querySelector('.msg-sort');
        sort.hidden = !isList();
        sort.querySelector('span').textContent = (SORTS.find(([k]) => k === sortField) || SORTS[0])[1];
    }

    const isPicked = (id) => (multi.size ? multi.has(String(id)) : String(selectedId) === String(id));

    function rowHtml(m) {
        const id = esc(m.id);
        const out = outFolder() || !!m.draft;
        const who = out ? listOf(m.to).map(personName).join('; ') : senderText(m);
        const unread = !m.read && !out;
        // a message with attachments has the envelope with the paper clip (its unread state is the bold)
        const icon = m.attachments && m.attachments.length ? 'msg-attach-mail' : (unread ? 'msg-unread' : 'msg-read');
        const on = isPicked(m.id);
        // the envelope is a CSS background (wm-messaging.css): an <img srcset> per row cost ~10 ms
        // each to insert on a throttled phone (image selection runs as the list is parsed)
        // a flagged message (Follow up, IMAP accounts) has outres 10006's red flag at the end of its subject line
        return `<div class="msg-row${unread ? ' is-unread' : ''}${on ? ' is-selected' : ''}${m.flagged ? ' is-flagged' : ''}" role="option" data-id="${id}" aria-selected="${on}">
            <span class="msg-ico" data-ico="${icon}"></span>
            <span class="msg-from">${esc(who || (out ? '' : '(no sender)'))}</span>
            <span class="msg-date">${esc(listDate(m.createdAt))}</span>
            <span class="msg-size">${m.size != null ? sizeText(m.size) : ''}</span>
            <span class="msg-subj">${m.importance ? `<span class="msg-prio" data-prio="${m.importance === 'high' ? 'high' : 'low'}" aria-label="${m.importance === 'high' ? 'High priority' : 'Low priority'}"></span>` : ''}${esc(m.subject || '(no subject)')}</span>${m.flagged ? '<span class="msg-flag" aria-label="Flagged"></span>' : ''}
        </div>`;
    }

    /** A Director session as a list row: its name, last activity and last line (running = unread look). */
    function dirRowHtml(s) {
        const on = String(selectedId) === String(s.id);
        const busy = !!s.running;
        const line = s.last_line || (busy ? `${personaName(dirP)} is working on it.` : '');
        return `<div class="msg-row is-nosize${busy ? ' is-unread' : ''}${on ? ' is-selected' : ''}" role="option" data-id="${esc(s.id)}" aria-selected="${on}">
            <span class="msg-ico" data-ico="${busy ? 'msg-unread' : 'msg-read'}"></span>
            <span class="msg-from">${esc(s.name || 'Director')}</span>
            <span class="msg-date">${esc(listDate(s.updated_at || s.created_at))}</span>
            <span class="msg-size"></span>
            <span class="msg-subj">${esc(line)}</span>
        </div>`;
    }

    const DRAFT_ID = '__new';

    /** The rows of a Director folder: Inbox the live sessions, Deleted Items the archived, Drafts a new one. */
    function dirRows() {
        if (folder === 'drafts') return [{ id: DRAFT_ID, name: 'New session', last_line: `A new session with ${personaName(dirP)}.`, draft: true }];
        const list = dirLists[dirP] || [];
        return list.filter((s) => (folder === 'deleted' ? !!s.archived : !s.archived));
    }

    function renderList() {
        if (!page) return;
        const list = page.querySelector('.msg-list');
        const empty = page.querySelector('.msg-empty');
        if (!list) return;
        let text = '';
        if (isList()) {
            const rows = sorted(mail);
            // the device keeps a message selected: the first one when none is
            if (!multi.size && rows.length && (!selectedId || !mailById(selectedId))) selectedId = String(rows[0].id);
            list.innerHTML = rows.map(rowHtml).join('') + (hasMore ? '<div class="msg-more">Loading...</div>' : '');
            if (listError) text = listError;
            else if (loading && !rows.length) text = '';
            else if (!folderSynced(folder)) text = 'This folder is not synchronized. To download its messages, tap Menu > Tools > Manage Folders.';
            else if (!rows.length) text = is65() ? 'To create a new message, tap Menu, then tap New.' : 'No messages.';
        } else {
            const rows = dirRows();
            if (!selectedId || !rows.some((s) => String(s.id) === String(selectedId))) selectedId = rows.length ? String(rows[0].id) : null;
            list.innerHTML = rows.map(dirRowHtml).join('');
            if (listError) text = listError;
            else if (loading && !rows.length) text = '';
            else if (!rows.length) text = folder === 'deleted' ? 'No messages.' : `No sessions with ${personaName(dirP)}. To start one, tap New.`;
        }
        empty.textContent = text;
        empty.hidden = !text;
        page.querySelector('.msg-view[data-view="list"]').classList.toggle('is-several', several);
        renderStatus();
    }

    /** The line under the list: "Connecting..." while it loads, else "<account>  N Items, M Unread." */
    function renderStatus() {
        const line = page && page.querySelector('.msg-status');
        if (!line) return;
        const acctEl = line.querySelector('.msg-status-acct');
        const countEl = line.querySelector('.msg-status-count');
        if (syncing || (loading && !(isList() ? mail.length : dirRows().length))) {
            acctEl.textContent = 'Connecting...';
            countEl.textContent = '';
            return;
        }
        if (!isList()) {
            const n = dirRows().filter((s) => !s.draft).length;
            acctEl.textContent = accountTitle();
            countEl.textContent = `${n} Items.`;
            return;
        }
        const out = isImap() ? outFolder() : (folder === 'sent' || folder === 'outbox' || folder === 'drafts');
        // the inbox's unread count is the mailbox's own (the list holds one page of it); an IMAP
        // folder's is the server's count for the folder
        const box = mailboxes.find((x) => x.owner === owner);
        const imf = isImap() ? imapFolderOf(folder) : null;
        const unread = out ? 0 : isImap() ? (hasMore && imf ? Number(imf.unseen) || 0 : mail.filter((m) => !m.read).length)
            : (folder === 'inbox' && box && !hasMore ? box.unread || 0 : mail.filter((m) => !m.read).length);
        acctEl.textContent = statusName();
        // an IMAP folder knows its size (the server's count); a Dreamscape Mail list counts its pages
        const total = imf && imf.total != null && hasMore ? `${Math.max(Number(imf.total) || 0, mail.length)}` : `${mail.length}${hasMore ? '+' : ''}`;
        countEl.textContent = `${total} Items${unread ? `, ${unread} Unread` : ''}.`;
    }

    function selectRow(id, scroll) {
        selectedId = id == null ? null : String(id);
        page.querySelectorAll('.msg-row').forEach((r) => {
            const on = isPicked(r.dataset.id);
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
            if (r.dataset.id === selectedId && scroll) r.scrollIntoView({ block: 'nearest' });
        });
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function toggleMulti(id) {
        const k = String(id);
        if (multi.has(k)) multi.delete(k); else multi.add(k);
        selectedId = k;
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    const selectedMail = () => (selectedId ? mailById(selectedId) : null);
    /** What a Delete / Mark / Move acts on: the picked rows, else the selected one. */
    const targetIds = () => (multi.size ? [...multi] : (selectedMail() ? [String(selectedMail().id)] : []));

    function selectAll(below) {
        const rows = sorted(mail);
        let from = 0;
        if (below) from = Math.max(0, rows.findIndex((m) => String(m.id) === String(selectedId)));
        multi = new Set(rows.slice(from).map((m) => String(m.id)));
        several = false;
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function startSeveral() {
        several = true;
        multi = new Set(selectedId ? [String(selectedId)] : []);
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function setSort(k) {
        sortField = k;
        try { localStorage.setItem(SORT_KEY, k); } catch (_) { /* storage off */ }
        renderBar();
        renderList();
    }

    // ---------------------------------------------------------------- folder tree (165105, 173942)

    const sortByLabel = (list) => list.slice().sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));

    /** The paths above an IMAP folder in the server's tree (a/b/c -> a, a/b). */
    function imapAncestors(p, id = imapId) {
        const f = imapFolderOf(p, id);
        const d = f && f.delimiter;
        if (!d || SPECIAL[f.special]) return [];
        const parts = String(p).split(d);
        const out = [];
        for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join(d));
        return out;
    }

    /**
     * An IMAP account's folders as tree nodes: the device's folders (by special use) at the top, the
     * rest nested by the server's delimiter; a parent the server does not list (Gmail's [Gmail]) is a
     * node that only opens. Unread counts on all but Sent Items, Drafts and Deleted Items.
     */
    function imapTreeNodes(id, keyOf) {
        const list = imapFolders.get(id) || [];
        const byPath = new Map();
        const roots = [];
        for (const f of list) {
            const info = imapFolderInfo(f.path, id);
            const counted = !['\\Sent', '\\Drafts', '\\Trash'].includes(f.special);
            byPath.set(f.path, { key: keyOf(f.path), label: info.label, icon: info.icon, count: counted ? Number(f.unseen) || 0 : 0, children: [] });
        }
        const place = (p, d, n) => {
            const at = d ? String(p).lastIndexOf(d) : -1;
            if (at <= 0) { roots.push(n); return; }
            const up = String(p).slice(0, at);
            let parent = byPath.get(up);
            if (!parent) {
                parent = { key: keyOf(up), label: leafName(up, d), icon: 'msg-folder-folder', noselect: true, children: [] };
                byPath.set(up, parent);
                place(up, d, parent);
            }
            parent.children.push(n);
        };
        for (const f of list) {
            const n = byPath.get(f.path);
            if (SPECIAL[f.special]) roots.push(n);
            else place(f.path, f.delimiter, n);
        }
        const sortDeep = (nodes) => { nodes.forEach((n) => { if (n.children.length) n.children = sortDeep(n.children); }); return sortByLabel(nodes); };
        return sortDeep(roots);
    }

    /** The tree: every account (alphabetical, as the device sorts them) with its folders. */
    function treeModel(cur) {
        const agents = mailboxes.map((b) => b.owner).filter((o) => o !== human());
        const nodes = accounts().map((a) => {
            let children = [];
            if (a.key === 'sms') children = SMS_FOLDERS.map((f) => ({ key: `sms/${f.id}`, label: f.label, icon: f.icon, count: f.id === 'inbox' ? smsUnread() : 0 }));
            else if (a.key.startsWith('tm:')) {
                // Text Messaging (#779): Inbox, Sent Items, Unknown Senders (wmTextMessaging.FOLDERS)
                const T = window.wmTextMessaging;
                const tf = (T && T.FOLDERS) || [{ id: 'inbox', label: 'Inbox', icon: 'msg-folder-inbox' }, { id: 'sent', label: 'Sent Items', icon: 'msg-folder-outbox' }, { id: 'unknown', label: 'Unknown Senders', icon: 'msg-folder-folder' }];
                const t = tmApi();
                let u = null;
                try { u = t && typeof t.unread === 'function' ? (t.unread().byAccount || {})[a.key.slice(3)] : null; } catch (_) { u = null; }
                children = tf.map((f) => ({ key: `${a.key}/${f.id}`, label: f.label, icon: f.icon, count: u ? (f.id === 'inbox' ? u.unread || 0 : f.id === 'unknown' ? u.unknownUnread || 0 : 0) : 0 }));
            }
            else if (a.key === 'mail') {
                const box = mailboxes.find((b) => b.owner === human());
                children = FOLDERS.map((f) => ({ key: `mail/${f.id}`, label: f.label, icon: f.icon, count: box ? (f.id === 'inbox' ? box.unread || 0 : f.id === 'spam' ? box.spamUnread || 0 : 0) : 0 }));
                if (agents.length) {
                    children.push({
                        key: 'mail/other',
                        label: 'Other Mailboxes',
                        icon: 'msg-folder-folder',
                        children: sortByLabel(agents.map((o) => {
                            const b = mailboxes.find((x) => x.owner === o);
                            return {
                                key: `box:${o}`,
                                label: boxLabel(o),
                                icon: 'msg-folder-account',
                                count: b ? b.unread || 0 : 0,
                                children: FOLDERS.map((f) => ({ key: `box:${o}/${f.id}`, label: f.label, icon: f.icon }))
                            };
                        }))
                    });
                }
                children = sortByLabel(children);
            } else if (a.key.startsWith('imap:')) children = imapTreeNodes(a.key.slice(5), (p) => `${a.key}/${p}`);
            else if (a.key.startsWith('dir:')) children = DIR_FOLDERS.map((f) => ({ key: `${a.key}/${f.id}`, label: f.label, icon: f.icon }));
            // several Text Messaging accounts share the name: the tree tells them apart by the Apple ID / number
            const label = a.key.startsWith('tm:') && tmAccts.length > 1 && a.sub ? `${a.name} (${a.sub})` : a.name;
            return { key: a.key, label, icon: 'msg-folder-account', children };
        });
        return sortByLabel(nodes).map((n) => Object.assign(n, { current: n.key === cur.acct }));
    }

    /** The key of the folder on screen, as the tree names it. */
    function treeCurrent(opts) {
        if (opts.acct === 'sms' || String(opts.acct || '').startsWith('tm:')) return `${opts.acct}/${opts.folder || 'inbox'}`;
        if (isImap()) return `imap:${imapId}/${folder}`;
        if (!isMail()) return `dir:${dirP}/${folder}`;
        return isMine() ? `mail/${folder}` : `box:${owner}/${folder}`;
    }

    function treeRowsHtml(nodes, depth, guides, cur) {
        let html = '';
        nodes.forEach((n, i) => {
            const last = i === nodes.length - 1;
            const kids = n.children && n.children.length;
            const open = kids && expanded.has(n.key);
            const lines = guides.map((on, d) => (on ? `<i class="mt-v" style="--d:${d}"></i>` : '')).join('');
            const first = depth === 0 && i === 0;
            html += `<div class="mt-row${n.key === cur ? ' is-current' : ''}" role="treeitem" data-key="${esc(n.key)}" style="--depth:${depth}"${kids ? ` aria-expanded="${!!open}"` : ''}${n.noselect ? ' data-noselect="1"' : ''}>
                ${lines}<i class="mt-c${first ? ' is-first' : ''}${last ? ' is-last' : ''}" style="--d:${depth}"></i><i class="mt-h" style="--d:${depth}"></i>
                ${kids ? `<button type="button" class="mt-box${open ? ' is-open' : ''}" tabindex="-1" aria-label="${open ? 'Collapse' : 'Expand'}" style="--d:${depth}"></button>` : ''}
                <span class="mt-ico">${img(n.icon)}</span><span class="mt-label">${esc(n.label)}</span>${n.count ? `<span class="mt-count">(${n.count})</span>` : ''}
            </div>`;
            if (open) html += treeRowsHtml(n.children, depth + 1, guides.concat(!last), cur);
        });
        return html;
    }

    function renderTree() {
        if (!tree) return;
        const cur = treeCurrent(tree.opts);
        const box = tree.el.querySelector('.mt-tree');
        const keep = box.scrollTop;
        box.innerHTML = treeRowsHtml(treeModel(tree.opts), 0, [], cur);
        box.scrollTop = keep;
    }

    /**
     * The folder tree under a bar's folder drop-down (Messaging's list, Dreamscape Messenger, Text
     * Messaging): the button reads "Show" while it is open. opts: { acct: 'sms' | 'tm:<id>' | current,
     * folder, onPick(folderId) } (onPick: a folder of that account for the app that opened the tree).
     */
    function showTree(anchor, opts = {}) {
        if (!anchor) return;
        if (tree && tree.anchor === anchor) { closeTree(); return; }
        closeTree();
        if (ws && typeof ws.closeMenus === 'function') ws.closeMenus();
        const host = anchor.closest('.wm-msg, .wm-chat') || anchor.parentElement;
        const o = Object.assign({ acct: currentKey() }, opts);
        // the account on screen is open, and the way down to an agent's mailbox
        const curKey = treeCurrent(o);
        // each opening shows only the account on screen open, as the device does (173942)
        expanded.clear();
        expanded.add(o.acct === 'sms' || String(o.acct || '').startsWith('tm:') ? o.acct : currentKey());
        if (curKey.startsWith('box:')) { expanded.add('mail'); expanded.add('mail/other'); expanded.add(curKey.split('/')[0]); }
        // an IMAP folder deep in the server's tree: the way down to it is open
        if (isImap() && o.acct === currentKey()) imapAncestors(folder).forEach((p) => expanded.add(`imap:${imapId}/${p}`));
        // the IMAP accounts' folders come from the server: the tree fills in as they arrive
        imapAccts.forEach((a) => { if (!imapFolders.has(a.id)) loadImapFolders(a.id).then(() => renderTree()); });
        const el = document.createElement('div');
        el.className = 'wm-msgtree';
        el.innerHTML = '<div class="mt-tree" role="tree" aria-label="Folders"></div>';
        const bar = anchor.closest('.wm-pv-bar') || anchor;
        const hr = host.getBoundingClientRect();
        el.style.top = `${bar.getBoundingClientRect().bottom - hr.top}px`;
        host.appendChild(el);
        tree = { el, anchor, opts: o, label: anchor.querySelector('.msg-folder-name, .wch-folder-name') };
        if (tree.label) { tree.was = tree.label.textContent; tree.label.textContent = 'Show'; }
        const pic = anchor.querySelector('img');
        if (pic) pic.hidden = true;
        anchor.setAttribute('aria-expanded', 'true');
        renderTree();
        const on = el.querySelector('.mt-row.is-current');
        if (on) on.scrollIntoView({ block: 'nearest' });
        el.addEventListener('click', onTreeClick);
        setTimeout(() => document.addEventListener('pointerdown', onTreeOutside, true), 0);
    }

    function closeTree() {
        if (!tree) return;
        const t = tree;
        tree = null;
        document.removeEventListener('pointerdown', onTreeOutside, true);
        t.el.remove();
        t.anchor.setAttribute('aria-expanded', 'false');
        const pic = t.anchor.querySelector('img');
        if (pic) pic.hidden = false;
        if (t.label && t.was != null) t.label.textContent = t.was;
        renderBar();
    }

    function onTreeOutside(e) {
        if (!tree) return;
        if (tree.el.contains(e.target)) return;
        // the drop-down button itself toggles (its click closes it)
        if (tree.anchor.contains(e.target)) return;
        closeTree();
    }

    function onTreeClick(e) {
        if (!tree) return;
        const row = e.target.closest('.mt-row');
        if (!row) return;
        const key = row.dataset.key;
        const kids = row.hasAttribute('aria-expanded');
        if (e.target.closest('.mt-box') || key === 'mail/other' || row.dataset.noselect) {
            if (kids) { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); renderTree(); }
            return;
        }
        const t = tree;
        // an account: its Inbox; a folder: that folder
        const [head, f] = key.includes('/') ? [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)] : [key, 'inbox'];
        closeTree();
        // the app that opened the tree (Dreamscape Messenger, a Text Messaging account) takes its own folders
        if (head === t.opts.acct && (head === 'sms' || head.startsWith('tm:')) && typeof t.opts.onPick === 'function') { t.opts.onPick(f); return; }
        goTo(head, f);
    }

    // ---------------------------------------------------------------- account picker / Move / Manage Folders

    function pickRows(view, rows) {
        const host = page.querySelector(`.msg-view[data-view="${view}"] .msg-pick`);
        if (pickIndex < 0) pickIndex = Math.max(0, rows.findIndex((r) => r.current));
        pickIndex = Math.max(0, Math.min(rows.length - 1, pickIndex));
        host.innerHTML = rows.map((r, n) => `<div class="msg-pick-row${r.two ? ' is-two' : ''}${n === pickIndex ? ' is-selected' : ''}" role="option" data-n="${n}" style="--indent:${r.indent || 0}">
            <span class="msg-ico">${img(r.icon)}</span>
            <span class="msg-pick-name">${esc(r.name)}${r.unread ? ` <span class="msg-pick-count">(${r.unread})</span>` : ''}</span>
            ${r.two ? `<span class="msg-pick-sub${r.dim ? ' is-dim' : ''}">${esc(r.sub || '')}</span>` : ''}
        </div>`).join('');
        host._rows = rows;
    }

    function renderAccounts() {
        // Text Messaging rows come first and arrive late: the highlight stays on the row it was on
        const shift = tmAccts.length - tmShown;
        if (shift && pickIndex >= 0) pickIndex = Math.max(0, pickIndex + shift);
        tmShown = tmAccts.length;
        const cur = currentKey();
        const rows = accounts().map((a) => ({
            two: true, icon: a.icon, name: a.name, unread: a.unread, sub: a.sub, dim: a.dim,
            current: a.key === cur,
            go: () => {
                if (a.key === 'sms') { goTo('sms'); return; }
                goTo(a.key);
            }
        }));
        rows.push({ two: true, icon: 'msg-acct-setup', name: 'Setup E-mail', sub: 'Tap to setup a new account', go: setupAccount });
        pickRows('accounts', rows);
    }

    function renderMove() {
        if (isImap()) {
            // the account's folders as its tree, flattened with their depth (the one on screen is not a target)
            const rows = [];
            const walk = (nodes, depth) => nodes.forEach((n) => {
                const p = n.key.slice(n.key.indexOf('/') + 1);
                rows.push({ icon: n.icon, name: n.label, indent: depth, current: false, go: n.noselect || p === folder ? () => null : () => moveTo(p), path: p, off: !!n.noselect || p === folder });
                if (n.children && n.children.length) walk(n.children, depth + 1);
            });
            walk(imapTreeNodes(imapId, (p) => `imap:${imapId}/${p}`), 1);
            const first = rows.find((r) => !r.off);
            if (first) first.current = true;
            rows.unshift({ icon: 'msg-folder-account', name: accountTitle(), indent: 0, go: () => null });
            pickRows('move', rows);
            return;
        }
        const first = (MOVE_TARGETS.find((t) => t.id !== folder) || MOVE_TARGETS[0]).id;
        const rows = MOVE_TARGETS.map((t) => {
            const f = folderOf(t.id, FOLDERS);
            return { icon: f.icon, name: f.label, indent: 1, current: t.id === first, go: () => moveTo(t.id) };
        });
        rows.unshift({ icon: 'msg-folder-account', name: MAIL_ACCOUNT, indent: 0, go: () => null });
        pickRows('move', rows);
    }

    function pickActivate(view, n) {
        const host = page.querySelector(`.msg-view[data-view="${view}"] .msg-pick`);
        const rows = host && host._rows;
        if (!rows || !rows[n]) return;
        pickIndex = n;
        host.querySelectorAll('.msg-pick-row').forEach((r) => r.classList.toggle('is-selected', Number(r.dataset.n) === n));
        rows[n].go();
    }

    function openMove(ids) {
        if (!canAct() || !ids.length) return;
        moveIds = ids.map(String);
        pushLayer('move');
    }

    /** Manage Folders (165113): the account's tree in a box, a check box on the folders that sync on demand. */
    function renderManage() {
        const view = page.querySelector('.msg-view[data-view="manage"]');
        const sync = syncMap();
        const rows = sortByLabel(FOLDERS.map((f) => ({ key: f.id, label: f.label, icon: f.icon, sync: f.sync })));
        view.querySelector('.mt-tree').innerHTML = `<div class="mt-row" style="--depth:0" aria-expanded="true"><i class="mt-c is-first is-last" style="--d:0"></i><i class="mt-h" style="--d:0"></i><button type="button" class="mt-box is-open" tabindex="-1" style="--d:0" aria-label="Collapse"></button><span class="mt-ico">${img('msg-folder-account')}</span><span class="mt-label">${esc(MAIL_ACCOUNT)}</span></div>`
            + rows.map((r, i) => `<div class="mt-row${r.key === folder ? ' is-current' : ''}${r.sync ? ' has-check' : ''}" style="--depth:1" data-key="${r.key}"><i class="mt-c${i === rows.length - 1 ? ' is-last' : ''}" style="--d:1"></i><i class="mt-h" style="--d:1"></i>${r.sync ? `<input type="checkbox" class="mt-check" data-key="${r.key}" aria-label="Synchronize ${esc(r.label)}"${sync[r.key] !== false ? ' checked' : ''}>` : ''}<span class="mt-ico">${img(r.icon)}</span><span class="mt-label">${esc(r.label)}</span></div>`).join('');
    }

    // ---------------------------------------------------------------- reading page

    async function openMessage(m) {
        if (!m) return;
        if (m.draft) { openDraft(m); return; }
        // a draft in an IMAP account's Drafts folder is edited, not read
        if (isImap() && imapSpecial(folder) === '\\Drafts') { await openImapDraft(m); return; }
        selectedId = String(m.id);
        const token = ++readToken;
        reading = Object.assign({}, m);
        pushLayer('read');
        renderRead(true);
        if (isImap()) {
            // message() marks it read at the mail server
            const api = maApi();
            const id = imapId;
            const f = folder;
            try {
                const full = await busyOf(() => api.message(id, f, Number(m.uid || m.id)));
                if (token !== readToken) return;
                if (full) reading = imapFull(full);
                const row = mailById(m.id);
                if (row && !row.read) { row.read = true; renderList(); }
                dropFresh(id, f, [m.uid || m.id]);
            } catch (err) {
                if (token !== readToken) return;
                reading.loadError = (err && err.message) || 'The message could not be opened.';
            }
            renderRead(false);
            if (isCurrent()) ws.refreshSoftKeys();
            return;
        }
        const request = { id: m.id };
        // an agent's mailbox is only looked at: its unread mail stays unread for the agent
        if (!isMine()) { request.viewAsOwner = owner; request.markRead = false; }
        try {
            const r = await busyOf(() => send('dovecote_get_mail', request, true));
            if (token !== readToken) return;
            const full = r && r.mail;
            if (full) reading = full;
            // dovecote_get_mail marks it read on the server
            const row = mailById(m.id);
            if (row && isMine() && !row.read) {
                row.read = true;
                renderList();
                loadMailboxes();
            }
        } catch (err) {
            if (token !== readToken) return;
            reading.loadError = (err && err.message) || 'The message could not be opened.';
        }
        renderRead(false);
        if (isCurrent()) ws.refreshSoftKeys();
    }

    const textSize = () => { const v = stored(OPT.textSize); return TEXT_SIZES.some(([k]) => k === v) ? v : 'medium'; };
    const textPx = () => (TEXT_SIZES.find(([k]) => k === textSize()) || TEXT_SIZES[2])[2];

    function setTextSize(k) {
        store(OPT.textSize, k);
        if (top() === 'read') renderRead(false);
    }

    function renderRead(pending) {
        const view = page.querySelector('.msg-view[data-view="read"]');
        const m = reading;
        const host = view.querySelector('.msg-read');
        if (!m) { host.innerHTML = ''; return; }
        host.dataset.size = textSize();
        const att = (m.attachments || []).map((a, n) => `<div class="msg-att" role="button" data-n="${n}">${img('msg-attachment')}<span>${esc(a.name || 'attachment')}</span></div>`).join('');
        const [day, time] = sentDate(m.createdAt);
        const out = outFolder();
        const who = out ? listOf(m.to).map(personName).join('; ') : senderText(m);
        host.innerHTML = `
            <div class="msg-hdr">
                <div class="msg-hdr-sent"><span class="msg-hdr-k">Sent:</span><span class="msg-hdr-v">${esc(day)}<br>${esc(time)}</span></div>
                <div class="msg-hdr-from"><span class="msg-sender" role="link" tabindex="0">${esc(who || '(no sender)')}</span></div>
                <div class="msg-hdr-subj">${esc(m.subject || '(no subject)')}</div>
            </div>
            ${att ? `<div class="msg-atts">${att}</div>` : ''}
            <div class="msg-body"></div>`;
        const body = view.querySelector('.msg-body');
        if (m.loadError) { body.textContent = m.loadError; return; }
        if (pending || m.body == null) { body.textContent = m.format === 'html' ? bodyText({ format: 'html', body: m.snippet }) : (m.snippet || ''); return; }
        if (m.format === 'html') renderHtmlBody(body, m);
        else body.textContent = String(m.body || '');
        host.scrollTop = 0;
    }

    /**
     * An agent's HTML mail, cleaned here: dovecote_render_body marks a message read for its owner, and the
     * body fetched with markRead:false is already in hand. No scripts, frames, plug-ins, forms, refreshes,
     * base or linked styles, handlers or script links; the frame's CSP still blocks every remote load.
     */
    function cleanAgentHtml(html) {
        try {
            const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
            doc.querySelectorAll('script, noscript, iframe, frame, frameset, object, embed, applet, meta, base, link, form, template').forEach((n) => n.remove());
            doc.querySelectorAll('*').forEach((el) => {
                for (const at of [...el.attributes]) {
                    const name = at.name.toLowerCase();
                    const v = at.value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
                    if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') el.removeAttribute(at.name);
                    else if (/^(href|src|xlink:href|action|background|poster|data)$/.test(name) && /^(javascript|vbscript|data:text\/html)/.test(v)) el.removeAttribute(at.name);
                }
            });
            return `${[...doc.head.querySelectorAll('style')].map((st) => st.outerHTML).join('')}${doc.body ? doc.body.innerHTML : ''}`;
        } catch (_) {
            return '';
        }
    }

    /** HTML mail: the server's sanitized body (dovecote_render_body) in a script-less frame, as on the desktop. */
    async function renderHtmlBody(host, m) {
        const token = readToken;
        host.textContent = m.snippet || '';
        let r;
        if (m.imap) {
            // the server sanitized it (mailAccounts.message): its own pictures load, the Internet's wait
            r = { html: imapHtml(m) };
        } else if (isMine()) {
            try {
                r = await busyOf(() => send('dovecote_render_body', { id: m.id }, true));
            } catch (_) {
                return;
            }
        } else {
            // an agent's mail stays unread for the agent
            r = { html: cleanAgentHtml(m.body) };
        }
        if (token !== readToken || !host.isConnected) return;
        const frame = document.createElement('iframe');
        // never allow-scripts: the server sanitized this HTML and a scripted frame would undo that
        frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
        frame.className = 'msg-frame';
        // View > Text Size (Medium = the device's 12 units; 6.5 keeps its 12)
        const fs = textPx() * px();
        // Download Internet pictures (IMAP mail) lets the frame load them
        const imgSrc = m.imap && m.showPictures ? "'self' data: blob: https: http:" : "'self' data: blob:";
        frame.srcdoc = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'"><style>html{margin:0;padding:0;overflow-y:hidden;overflow-x:auto}body{margin:0;padding:0;overflow:visible;font:${fs}px Tahoma,'Segoe UI',Verdana,sans-serif;color:#000;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}a{color:#00f}</style></head><body>${(r && r.html) || ''}</body></html>`;
        const fit = () => {
            try {
                const d = frame.contentDocument;
                const de = d && d.documentElement;
                if (!de) return;
                // a wide layout scrolls sideways inside the frame: leave room for that scroll bar
                const bar = Math.max(0, (frame.contentWindow.innerHeight || 0) - de.clientHeight);
                frame.style.height = `${de.scrollHeight + bar}px`;
            } catch (_) { /* cross-origin: keep the default height */ }
        };
        frame.addEventListener('load', () => {
            fit();
            setTimeout(fit, 300);
            try {
                // late images (cid/inline via 'self') and reflows grow the body after load: refit on each
                const d = frame.contentDocument;
                d.querySelectorAll('img').forEach((im) => { im.addEventListener('load', fit); im.addEventListener('error', fit); });
                // the frame's own ResizeObserver: one from this page does not watch another document's layout
                const RO = frame.contentWindow && frame.contentWindow.ResizeObserver;
                if (typeof RO === 'function' && d.body) {
                    const ro = new RO(() => { if (!frame.isConnected) ro.disconnect(); else fit(); });
                    ro.observe(d.body);
                }
            } catch (_) { /* no access */ }
            try {
                frame.contentDocument.addEventListener('click', (ev) => {
                    const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
                    if (!a) return;
                    ev.preventDefault();
                    let url;
                    try { url = new URL(a.getAttribute('href'), location.href); } catch (_) { return; }
                    if (url.protocol === 'mailto:') { newMessage({ to: decodeURIComponent(url.pathname) }); return; }
                    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
                    // Internet Explorer Mobile when the phone has it, else a new tab
                    if (window.wmBrowser && typeof window.wmBrowser.open === 'function' && window.wmBrowser.open(url.href)) return;
                    window.open(url.href, '_blank', 'noopener');
                });
            } catch (_) { /* no access */ }
        });
        host.textContent = '';
        // pictures from the Internet held back (outres 33594 / 33595): the device's line and link over the message
        if (m.imap && !m.showPictures && m.remoteImages && m.remoteImages.length) {
            const band = document.createElement('div');
            band.className = 'msg-pics';
            band.innerHTML = '<span>To protect your privacy, pictures from the Internet are not automatically downloaded.</span> <a href="#" class="msg-pics-link" role="button">Download Internet pictures</a>';
            host.appendChild(band);
        }
        host.appendChild(frame);
    }

    /** An IMAP message's HTML for the frame: same-origin pictures (data-dove-local) loaded, the Internet's on request. */
    function imapHtml(m) {
        try {
            const doc = new DOMParser().parseFromString(String(m.html || ''), 'text/html');
            doc.querySelectorAll('img[data-dove-local]').forEach((el) => {
                const src = el.getAttribute('data-dove-local');
                if (src && src.startsWith('/') && !src.startsWith('//')) el.setAttribute('src', src);
            });
            if (m.showPictures) {
                doc.querySelectorAll('img[data-blocked-src]').forEach((el) => {
                    const src = el.getAttribute('data-blocked-src');
                    if (/^https?:\/\//i.test(src || '')) el.setAttribute('src', src);
                });
            }
            return `${[...doc.head.querySelectorAll('style')].map((st) => st.outerHTML).join('')}${doc.body ? doc.body.innerHTML : ''}`;
        } catch (_) {
            return '';
        }
    }

    function downloadPictures() {
        if (!reading || !reading.imap || top() !== 'read') return;
        reading.showPictures = true;
        renderRead(false);
    }

    /**
     * A tap on an attachment: its bytes (dovecote_get_attachment) under the wait cursor, then a picture in
     * the shell's picture view (lightbox.js), anything else saved (the desktop's Dovecote does the same).
     */
    async function openAttachment(n) {
        const m = reading;
        const a = m && m.attachments && m.attachments[n];
        if (a && m.imap) {
            // an IMAP attachment is a same-origin URL (the server fetches it from the mail server the first time)
            if (!a.url) return;
            if (String(a.mimeType || '').startsWith('image/') && typeof showLightbox === 'function') { // eslint-disable-line no-undef
                try { showLightbox({ url: a.url, title: a.name || 'attachment' }); return; } catch (_) { /* saved below */ } // eslint-disable-line no-undef
            }
            const link = document.createElement('a');
            link.href = a.url;
            link.download = a.name || 'attachment';
            document.body.appendChild(link);
            link.click();
            link.remove();
            return;
        }
        if (!a || !a.id) return;
        const request = { id: a.id };
        if (!isMine()) request.viewAsOwner = owner;
        let base64;
        try {
            const r = await busyOf(() => send('dovecote_get_attachment', request, true));
            base64 = r && r.attachment && r.attachment.base64;
        } catch (err) {
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || 'The attachment could not be opened.' });
            return;
        }
        if (!base64 || reading !== m) return;
        const type = String(a.mimeType || 'application/octet-stream');
        const name = a.name || 'attachment';
        if (type.startsWith('image/') && typeof showLightbox === 'function') { // eslint-disable-line no-undef
            try { showLightbox({ url: `data:${type};base64,${base64}`, title: name }); return; } catch (_) { /* saved below */ } // eslint-disable-line no-undef
        }
        try {
            const bin = atob(base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([bytes], { type }));
            const link = document.createElement('a');
            link.href = url;
            link.download = name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (_) { /* nothing to save */ }
    }

    /** The message one step up or down the list from the one being read. */
    function readSibling(step) {
        if (!reading) return;
        const rows = sorted(mail);
        const at = rows.findIndex((m) => String(m.id) === String(reading.id));
        const next = rows[at + step];
        if (!next) return;
        layers.pop();
        openMessage(next);
    }

    // ---------------------------------------------------------------- the sender's card (165456)

    /** The sender of the message being read: { name, address } (an outside sender's own address). */
    function senderOf(m) {
        if (!m) return null;
        const name = senderText(m);
        const raw = String(m.from || '').trim();
        const labelAddr = (String(m.fromLabel || '').match(/<([^>]+)>/) || [])[1];
        return { name: name || raw, address: raw.includes('@') ? raw : (labelAddr || mailAddress(raw.toLowerCase())) };
    }

    function renderSender() {
        const view = page.querySelector('.msg-view[data-view="sender"]');
        const s = senderOf(reading);
        view.querySelector('.msg-head').textContent = s ? s.name : '';
        view.querySelector('.msg-pick').innerHTML = s ? `<div class="msg-pick-row is-two is-selected" role="option" data-n="0">
            <span class="msg-ico">${img('contacts-email')}</span>
            <span class="msg-pick-name">Send e-mail</span>
            <span class="msg-pick-sub">${esc(s.address)}</span>
        </div>` : '';
    }

    function mailSender() {
        const s = senderOf(reading);
        if (!s) return;
        newMessage({ to: s.address.endsWith(DOMAIN) ? s.address : s.address });
    }

    function saveSender() {
        const s = senderOf(reading);
        const c = window.wmContactsApp;
        if (!s || !c || typeof c.newContact !== 'function') return;
        c.newContact({ name: s.name.includes('@') ? '' : s.name, email: s.address });
    }

    // ---------------------------------------------------------------- new message

    function bodyText(m) {
        if (!m) return '';
        if (m.format !== 'html') return String(m.body || '');
        try {
            const doc = new DOMParser().parseFromString(String(m.body || ''), 'text/html');
            doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
            doc.querySelectorAll('td, th').forEach((b) => b.append('\t'));
            doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4').forEach((b) => b.append('\n'));
            return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
        } catch (_) { return ''; }
    }

    /** Outlook Mobile's quote under a reply or forward (a reply without it when Options says so). */
    function quoted(m, forward) {
        if (!forward && !optOn(OPT.replyBody)) return '';
        // an IMAP message's own text part when it has one (its HTML turned into text otherwise)
        return `\n\n-----Original Message-----\nFrom: ${address(m.from)}\nSent: ${longDate(m.createdAt)}\nTo: ${listOf(m.to).map(address).join('; ')}\n${listOf(m.cc).length ? `Cc: ${listOf(m.cc).map(address).join('; ')}\n` : ''}Subject: ${m.subject || ''}\n\n${m.imap && m.text ? m.text : bodyText(m)}`;
    }

    const prefixed = (pre, subject) => {
        const s = String(subject || '');
        return new RegExp(`^${pre}:`, 'i').test(s) ? s : `${pre}: ${s}`;
    };

    function renderAtts() {
        const view = page.querySelector('.msg-view[data-view="compose"]');
        const atts = view.querySelector('.msg-compose-atts');
        // an IMAP account's attachment goes up to the server as it is added: how far, until it is there
        atts.innerHTML = compose.attachments.map((a, n) => `<div class="msg-att" role="button" data-n="${n}">${img('msg-attachment')}<span>${esc(a.name || 'attachment')}${a.upload && !a.uploadId ? ` (${Math.round((a.progress || 0) * 100)}%)` : ''}</span></div>`).join('');
        atts.hidden = !compose.attachments.length;
        fitCompose();
    }

    /** A tap on an attachment of the new message: its menu (Remove takes it off the message). */
    function attachmentMenu(el) {
        const n = Number(el.dataset.n);
        const c = compose;
        if (!c || !c.attachments[n]) return;
        ws.dropdown(el, [{ label: 'Remove', action: () => {
            const i = c.attachments.indexOf(c.attachments[n]);
            if (i >= 0) c.attachments.splice(i, 1);
            if (compose === c) renderAtts();
        } }], 'left');
    }

    /**
     * The new message's header as the device lays it out (6.1 / 6.5 Outlook E-mail form): Bcc and Cc
     * above From, scrolled out of sight; the form scrolls as one (drag it down, its scroll bar, or up
     * from To) and the text fills the rest of the page. Bcc only where the account sends one (IMAP).
     */
    // a hidden copy of the text box measures how tall its text is (the box itself keeps its height)
    let textMirror = null;
    function textHeight(text) {
        if (!textMirror) {
            textMirror = document.createElement('textarea');
            textMirror.className = text.className;
            textMirror.tabIndex = -1;
            textMirror.setAttribute('aria-hidden', 'true');
            textMirror.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;height:0;min-height:0;overflow:hidden;flex:none';
        }
        if (textMirror.parentNode !== text.parentNode) text.parentNode.appendChild(textMirror);
        textMirror.style.width = `${text.offsetWidth}px`;
        textMirror.value = text.value;
        return textMirror.scrollHeight + (parseFloat(getComputedStyle(text).borderTopWidth) || 0);
    }

    function fitCompose(reveal) {
        const view = page && page.querySelector('.msg-view[data-view="compose"]');
        if (!view || view.hidden) return;
        const form = view.querySelector('.msg-form');
        const from = view.querySelector('.msg-field.is-static');
        const text = view.querySelector('[name="body"]');
        if (!form || !from || !text) return;
        // (fractional rows on 6.5: measured, rounded up, so no rule of Cc peeks over From)
        const above = Math.ceil(from.getBoundingClientRect().top - form.getBoundingClientRect().top + form.scrollTop);
        // (never cleared first: a moment without a height would pull the form's scroll back to the top)
        // the text reaches the page's foot when From is at the top (a pixel over, so From can reach the top)
        const rest = Math.ceil(form.clientHeight - (text.getBoundingClientRect().top - from.getBoundingClientRect().top)) + 1;
        // the text grows with what is typed: one scroll bar, the form's, as on the device
        const h = `${Math.max(60 * px(), rest, textHeight(text))}px`;
        if (text.style.height !== h) text.style.height = h;
        if (reveal === true) form.scrollTop = 0;
        else if (reveal === false) form.scrollTop = above;
    }

    function newMessage(init = {}) {
        // an IMAP account's message goes out from that account (mailAccounts.send), whatever is on screen later
        const imapFrom = init.imapId !== undefined ? init.imapId : (isImap() ? imapId : null);
        // an IMAP account takes the original's attachments along (forwardFrom: a forward's, a draft's own)
        const atts = Array.isArray(init.attachments) ? init.attachments.filter((a) => !imapFrom || a.fwd) : [];
        compose = { mode: init.mode || 'new', replyTo: init.replyTo || null, reply: init.reply || null, imapId: imapFrom, fwd: imapFrom ? init.fwd || null : null, draftUid: imapFrom ? init.draftUid || null : null, attachments: atts, priority: 'normal', language: 'western', lastField: 'to' };
        const view = page.querySelector('.msg-view[data-view="compose"]');
        renderAtts();
        // 6.1: "Name <address> (account)" over two lines; 6.5 names the account in brackets
        const ia = imapFrom ? imapAcct(imapFrom) : null;
        const acctLabel = ia ? imapName(ia) : MAIL_ACCOUNT;
        const fromAddr = ia ? `${ia.displayName || ownerName()} <${ia.email}>` : `${ownerName()} <${mailAddress()}>`;
        view.querySelector('.msg-from-addr').textContent = is65() ? `(${acctLabel})` : `${fromAddr} (${acctLabel})`;
        view.querySelector('[name="to"]').value = init.to || '';
        view.querySelector('[name="cc"]').value = init.cc || '';
        // Bcc: IMAP accounts (Dreamscape Mail sends none); both above From, out of sight until used (fitCompose)
        view.querySelector('[name="bcc"]').value = init.bcc || '';
        view.querySelector('.msg-field.is-bcc').hidden = !imapFrom;
        view.querySelector('[name="subject"]').value = init.subject || '';
        const body = view.querySelector('[name="body"]');
        // the signature goes under the new text, above a quoted message (device)
        const sig = init.noSignature ? '' : signatureFor(compose.mode);
        body.value = sig ? (init.body ? sig + init.body : sig) : (init.body || '');
        pushLayer('compose');
        fitCompose(!!(init.cc || init.bcc));
        requestAnimationFrame(() => {
            const first = init.to ? body : view.querySelector('[name="to"]');
            first.focus({ preventScroll: true });
            if (first === body) body.setSelectionRange(0, 0);
            body.scrollTop = 0;
            fitCompose(!!(init.cc || init.bcc));
        });
    }

    async function respond(kind, m) {
        if (!m || !canAct()) return;
        if (isImap()) { await respondImap(kind, m); return; }
        let full = m;
        if (m.body == null) {
            try {
                const r = await busyOf(() => send('dovecote_get_mail', { id: m.id, markRead: false }, true));
                if (r && r.mail) full = r.mail;
            } catch (_) { /* the quote has no body */ }
        }
        const me = human();
        if (kind === 'forward') {
            newMessage({ mode: 'forward', subject: prefixed('FW', full.subject), body: quoted(full, true) });
            return;
        }
        let to = [full.from];
        let cc = [];
        if (kind === 'replyAll') {
            to = to.concat(listOf(full.to));
            cc = listOf(full.cc);
        }
        const clean = (list, skip) => [...new Set(list.map((n) => String(n).trim()).filter((n) => n && n.toLowerCase() !== me && !(skip || []).includes(n)))];
        to = clean(to);
        if (!to.length && full.from) to = [full.from];
        cc = clean(cc, to);
        newMessage({
            mode: kind,
            replyTo: full.id,
            to: to.map(address).join('; '),
            cc: cc.map(address).join('; '),
            subject: prefixed('RE', full.subject),
            body: quoted(full)
        });
    }

    /** Reply / Reply All / Forward on an IMAP account: the reply goes out threaded (reply: { folder, uid, kind }). */
    async function respondImap(kind, m) {
        let full = m;
        if (m.body == null) {
            const api = maApi();
            try {
                const r = await busyOf(() => api.message(imapId, folder, Number(m.uid || m.id), { markSeen: false }));
                if (r) full = imapFull(r);
            } catch (_) { /* the quote has no body */ }
        }
        const reply = { folder, uid: Number(full.uid || full.id), kind: kind === 'forward' ? 'forward' : 'reply' };
        if (kind === 'forward') {
            // the original's attachments go along (send forwardFrom), each removable
            const fwdAtts = (full.attachments || []).filter((a) => a.part).map((a) => ({ name: a.name, size: a.size, mimeType: a.mimeType, part: a.part, fwd: true }));
            newMessage({ mode: 'forward', subject: prefixed('FW', full.subject), body: quoted(full, true), reply, fwd: { folder, uid: Number(full.uid || full.id) }, attachments: fwdAtts });
            return;
        }
        const me = String((imapAcct(imapId) || {}).email || '').toLowerCase();
        // the sender's Reply-To when the message names one
        let to = full.replyTo && full.replyTo.length ? full.replyTo.slice() : [full.from];
        let cc = [];
        if (kind === 'replyAll') {
            to = to.concat(listOf(full.to));
            cc = listOf(full.cc);
        }
        const clean = (list, skip) => [...new Set(list.map((n) => String(n).trim()).filter((n) => n && n.toLowerCase() !== me && !(skip || []).includes(n)))];
        to = clean(to);
        if (!to.length && full.from) to = [full.from];
        cc = clean(cc, to);
        newMessage({ mode: kind, reply, to: to.join('; '), cc: cc.join('; '), subject: prefixed('RE', full.subject), body: quoted(full) });
    }

    // ---- Drafts, Spell Check, Voice Note, signature (#757) ----

    const DRAFTS_KEY = 'wmMailDrafts';

    function readDrafts() {
        try {
            const list = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (_) { return []; }
    }

    function writeDrafts(list) {
        try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(list.slice(0, 100))); return true; } catch (_) { return false; }
    }

    function draftRows() {
        return readDrafts().sort((a, b) => b.at - a.at).map((d) => ({
            id: 'draft:' + d.id, to: d.to, cc: d.cc, subject: d.subject, createdAt: new Date(d.at).toISOString(),
            read: true, draft: true,
            size: String(d.body || '').length + (d.attachments || []).reduce((n, a) => n + Math.round(String(a.base64 || '').length * 0.75), 0),
            attachments: d.attachments || []
        }));
    }

    function dropDraft(id) {
        writeDrafts(readDrafts().filter((d) => d.id !== id));
    }

    /** Menu > Save to Drafts: the message as it stands goes to Drafts and the page closes (device). */
    async function saveDraft() {
        if (!compose) return;
        const f = composeFields();
        const id = compose.draftId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        // attachments past ~300 KB stay out: the phone's own storage holds the drafts
        const attachments = compose.attachments.filter((a) => String(a.base64 || '').length < 400000);
        const rec = { id, mode: compose.mode, replyTo: compose.replyTo, priority: compose.priority, to: f.to, cc: f.cc, subject: f.subject, body: f.body, attachments, at: Date.now() };
        const list = readDrafts();
        const at = list.findIndex((d) => d.id === id);
        if (at >= 0) list[at] = rec; else list.unshift(rec);
        if (!writeDrafts(list)) {
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: 'The message could not be saved. The device memory is full.' });
            return;
        }
        if (attachments.length < compose.attachments.length) await ws.messageBox({ title: 'Messaging', icon: 'info', text: 'The message was saved to Drafts without its larger attachments.' });
        popLayer();
        if (isMail() && folder === 'drafts') loadFolder({ keep: true });
    }

    function openDraft(m) {
        const d = readDrafts().find((x) => 'draft:' + x.id === String(m.id));
        if (!d) return;
        newMessage({ mode: d.mode || 'new', replyTo: d.replyTo || null, to: d.to, cc: d.cc, subject: d.subject, body: d.body, attachments: d.attachments, noSignature: true });
        compose.draftId = d.id;
        compose.priority = d.priority || 'normal';
    }

    /**
     * Menu > Spell Check (device: each word it does not know is selected with a menu of suggestions,
     * Ignore and Ignore All; at the end "Spell check is complete."). The words come from Dreamscape's
     * spell engine on the server (WS spell_check_text, modules/spellChecker.js).
     */
    async function spellCheckField(field) {
        if (!field) return;
        let words;
        try {
            const r = await busyOf(() => send('spell_check_text', { text: field.value }, true));
            if (r && r.success === false) throw new Error(r.error || 'unavailable');
            words = (r && Array.isArray(r.words)) ? r.words : [];
        } catch (_) {
            await ws.messageBox({ title: 'Messaging', icon: 'info', text: 'Spell check is not available right now.' });
            return;
        }
        const ignored = new Set();
        let shift = 0;
        for (const w of words) {
            if (ignored.has(w.word.toLowerCase())) continue;
            const at = w.start + shift;
            // the text changed under the check (typed meanwhile): stop where it no longer matches
            if (field.value.slice(at, at + w.word.length) !== w.word) break;
            field.focus();
            field.setSelectionRange(at, at + w.word.length);
            const choice = await new Promise((resolve) => {
                let settled = false;
                const done = (v) => { if (!settled) { settled = true; resolve(v); } };
                const items = (w.suggestions || []).map((x) => ({ label: String(x), action: () => done({ replace: String(x) }) }));
                if (!items.length) items.push({ label: '(No Suggestions)', disabled: true });
                items.push('-', { label: 'Ignore', action: () => done({ ignore: false }) }, { label: 'Ignore All', action: () => done({ ignore: true }) }, { label: 'Cancel', action: () => done(null) });
                ws.dropdown(field, items, 'left');
                // a tap outside the menu closes it: the check ends
                const watch = setInterval(() => {
                    const pop = document.querySelector('#wmShell .wm-popup');
                    if (!pop || pop.hidden) { clearInterval(watch); setTimeout(() => done(null), 0); }
                }, 250);
            });
            if (!choice) return;
            if (choice.replace) {
                field.setRangeText(choice.replace, at, at + w.word.length, 'end');
                shift += choice.replace.length - w.word.length;
            } else if (choice.ignore) {
                ignored.add(w.word.toLowerCase());
            }
        }
        await ws.messageBox({ title: 'Messaging', icon: 'info', text: 'Spell check is complete.' });
    }

    /**
     * Insert > Voice Note: records from the microphone until Stop; the note goes in as an attachment.
     * The microphone is the browser's (the Android app asks with its own permission).
     */
    async function recordVoiceNote() {
        if (!compose) return;
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: 'This device cannot record voice notes.' });
            return;
        }
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (_) {
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: 'The microphone could not be used. Allow Melaton Mobile to use the microphone, then try again.' });
            return;
        }
        const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t)) || '';
        const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        const chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        const started = Date.now();
        rec.start();
        const keep = await ws.messageBox({ title: 'Voice Note', icon: 'info', text: 'Recording... Tap Stop when you are done.', buttons: [{ text: 'Stop', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false });
        const stopped = new Promise((resolve) => { rec.onstop = resolve; });
        rec.stop();
        await stopped;
        stream.getTracks().forEach((t) => t.stop());
        if (!keep || !chunks.length || !compose) return;
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const ext = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
        if (compose.imapId) {
            const at = new Date(started).toTimeString().slice(0, 5).replace(':', '');
            const secs0 = Math.max(1, Math.round((Date.now() - started) / 1000));
            addImapFile(new File([blob], `Voice Note ${at} (${secs0}s).${ext}`, { type: blob.type.split(';')[0] }));
            return;
        }
        const base64 = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.readAsDataURL(blob); });
        const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        const hhmm = new Date(started).toTimeString().slice(0, 5).replace(':', '');
        compose.attachments.push({ name: `Voice Note ${hhmm} (${secs}s).${ext}`, mimeType: blob.type.split(';')[0], base64, size: blob.size });
        renderAtts();
    }

    // the signature of Dovecote Express's Mail Options (userGlobalSettings.mail), shared with the desktop;
    // Options > Accounts > Signatures... sets it here
    let mailSig = null;
    async function loadSignature() {
        try {
            const c = window.wsClient;
            const data = c && typeof c.getUserGlobalSettings === 'function' ? await c.getUserGlobalSettings() : null;
            mailSig = (data && data.settings && data.settings.mail) || null;
        } catch (_) { mailSig = null; }
        return mailSig;
    }

    function signatureFor(mode) {
        const m = mailSig;
        if (!m || !m.signature || m.signatureOutgoing === false) return '';
        if (mode !== 'new' && m.signatureSkipReplies) return '';
        return '\n\n' + m.signature;
    }

    function composeFields() {
        const view = page.querySelector('.msg-view[data-view="compose"]');
        return {
            to: view.querySelector('[name="to"]').value,
            cc: view.querySelector('[name="cc"]').value,
            bcc: view.querySelector('[name="bcc"]').value,
            subject: view.querySelector('[name="subject"]').value,
            body: view.querySelector('[name="body"]').value
        };
    }

    function composeDirty() {
        if (!compose) return false;
        const f = composeFields();
        return !!(f.to.trim() || f.cc.trim() || f.bcc.trim() || f.subject.trim() || f.body.trim() || compose.attachments.length);
    }

    async function confirmCancelCompose() {
        const yes = await ws.messageBox({
            title: 'Messaging',
            icon: 'question',
            text: 'Do you want to cancel this message? It will not be saved.',
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
            cancelValue: false
        });
        if (yes && top() === 'compose') popLayer();
        else if (isCurrent()) ws.syncHistory();
    }

    async function sendCompose() {
        if (sending || !compose) return;
        const f = composeFields();
        if (compose.imapId) { await sendImap(f); return; }
        const to = bare(f.to);
        const cc = bare(f.cc);
        if (!to.length && !cc.length) {
            await ws.messageBox({ title: 'Messaging', icon: 'warning', text: 'Before sending this message, please specify at least one recipient.' });
            page.querySelector('.msg-view[data-view="compose"] [name="to"]').focus();
            return;
        }
        const request = {
            to: (to.length ? to : cc).join(', '),
            subject: f.subject.trim(),
            // the server takes no empty body; the device sends one
            body: f.body || ' ',
            format: 'text'
        };
        if (to.length && cc.length) request.cc = cc.join(', ');
        if (compose.replyTo) request.replyTo = compose.replyTo;
        if (compose.priority && compose.priority !== 'normal') request.priority = compose.priority;
        if (compose.attachments.length) request.attachments = compose.attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, base64: a.base64 }));
        sending = true;
        if (isCurrent()) ws.refreshSoftKeys();
        try {
            await busyOf(() => send('dovecote_send_mail', request, true));
        } catch (err) {
            sending = false;
            if (isCurrent()) ws.refreshSoftKeys();
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || 'The message could not be sent.' });
            return;
        }
        sending = false;
        if (compose && compose.draftId) dropDraft(compose.draftId);
        popLayer();
        if (top() === 'read') popLayer();
        if (isMail() && (folder === 'sent' || folder === 'outbox' || owner === human())) loadFolder({ keep: true });
        loadMailboxes();
    }

    const splitAddrs = (v) => String(v || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);

    /** Send from an IMAP account: attachments still going up are waited for, then mailAccounts.send. */
    async function sendImap(f) {
        const to = splitAddrs(f.to);
        const cc = splitAddrs(f.cc);
        const bcc = splitAddrs(f.bcc);
        if (!to.length && !cc.length && !bcc.length) {
            await ws.messageBox({ title: 'Messaging', icon: 'warning', text: 'Before sending this message, please specify at least one recipient.' });
            page.querySelector('.msg-view[data-view="compose"] [name="to"]').focus();
            return;
        }
        const c = compose;
        const api = maApi();
        if (!api || typeof api.send !== 'function') return;
        sending = true;
        if (isCurrent()) ws.refreshSoftKeys();
        try {
            await busyOf(async () => {
                await Promise.all(c.attachments.map((a) => a.upload || null));
                const mail = { to: to.join(', '), subject: f.subject.trim(), text: f.body || ' ' };
                if (cc.length) mail.cc = cc.join(', ');
                if (bcc.length) mail.bcc = bcc.join(', ');
                Object.assign(mail, imapMailParts(c));
                if (c.reply) mail.reply = c.reply;
                // a draft being sent leaves Drafts
                if (c.draftUid) mail.draftUid = c.draftUid;
                await api.send(c.imapId, mail);
            });
        } catch (err) {
            sending = false;
            if (isCurrent()) ws.refreshSoftKeys();
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || 'The message could not be sent.' });
            return;
        }
        sending = false;
        if (compose === c) popLayer();
        if (top() === 'read') popLayer();
        if (isImap() && imapId === c.imapId && c.draftUid && imapSpecial(folder) === '\\Drafts') {
            // the sent draft leaves Drafts (the server's 'removed' event reads the list again too)
            mail = mail.filter((m) => String(m.id) !== String(c.draftUid));
            renderList();
            loadFolder({ keep: true });
        } else if (isImap() && imapId === c.imapId && imapSpecial(folder) === '\\Sent') loadFolder({ keep: true });
    }

    /** The attachments of an IMAP account's message: the uploads, and the original's parts still on it (forwardFrom). */
    function imapMailParts(c) {
        const out = {};
        const ids = c.attachments.map((a) => a.uploadId).filter(Boolean);
        if (ids.length) out.attachments = ids;
        const parts = c.attachments.filter((a) => a.fwd && a.part).map((a) => a.part);
        if (c.fwd && parts.length) out.forwardFrom = { folder: c.fwd.folder, uid: c.fwd.uid, parts };
        return out;
    }

    /** Save to Drafts for an IMAP account: into its Drafts folder on the mail server (the earlier version replaced). */
    async function saveDraftImap() {
        const c = compose;
        const api = maApi();
        if (!c || !api || typeof api.saveDraft !== 'function') return;
        const f = composeFields();
        let saved = null;
        try {
            saved = await busyOf(async () => {
                await Promise.all(c.attachments.map((a) => a.upload || null));
                const mail = Object.assign({ to: splitAddrs(f.to).join(', '), cc: splitAddrs(f.cc).join(', '), bcc: splitAddrs(f.bcc).join(', '), subject: f.subject, text: f.body }, imapMailParts(c));
                if (c.draftUid) mail.replaceUid = c.draftUid;
                return api.saveDraft(c.imapId, mail);
            });
        } catch (err) {
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || 'The message could not be saved.' });
            return;
        }
        if (compose === c) popLayer();
        const drafts = saved && saved.folder;
        if (isImap() && imapId === c.imapId && (folder === drafts || imapSpecial(folder) === '\\Drafts')) loadFolder({ keep: true });
    }

    /** A draft in an IMAP account's Drafts folder opens for editing (the device's Drafts do). */
    async function openImapDraft(m) {
        const api = maApi();
        const id = imapId;
        const f = folder;
        let full = null;
        try {
            const r = await busyOf(() => api.message(id, f, Number(m.uid || m.id), { markSeen: false }));
            if (r) full = imapFull(r);
        } catch (err) {
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || 'The message could not be opened.' });
            return;
        }
        if (!full || !isImap() || imapId !== id) return;
        selectedId = String(m.id);
        const fwdAtts = (full.attachments || []).filter((a) => a.part).map((a) => ({ name: a.name, size: a.size, mimeType: a.mimeType, part: a.part, fwd: true }));
        newMessage({
            mode: 'new', imapId: id, to: listOf(full.to).join('; '), cc: listOf(full.cc).join('; '), bcc: listOf(full.bcc).join('; '),
            subject: full.subject || '', body: full.text || bodyText(full), noSignature: true,
            draftUid: Number(full.uid), fwd: fwdAtts.length ? { folder: f, uid: Number(full.uid) } : null, attachments: fwdAtts
        });
    }

    /** An attachment for an IMAP account's message: up to the server now (mailAccounts.upload), with its progress. */
    function addImapFile(file) {
        const api = maApi();
        if (!compose || !file || !api || typeof api.upload !== 'function') return;
        const c = compose;
        const a = { name: file.name || 'attachment', mimeType: file.type || 'application/octet-stream', size: file.size, progress: 0 };
        const paint = () => { if (compose === c && top() === 'compose') renderAtts(); };
        a.upload = api.upload(file, { onProgress: (p) => { a.progress = p; paint(); } }).then((d) => {
            a.uploadId = d && d.uploadId;
            a.progress = 1;
            paint();
            return d;
        }, async (err) => {
            const i = c.attachments.indexOf(a);
            if (i >= 0) c.attachments.splice(i, 1);
            paint();
            if (compose === c) await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || 'The attachment could not be added.' });
            return null;
        });
        c.attachments.push(a);
        renderAtts();
    }

    /** Add Recipient...: the Dreamscape mailboxes, as Contacts would list them. */
    function recipientList() {
        // an IMAP account's message leaves Dreamscape: only mailboxes with an outside address
        if (compose && compose.imapId) return mailboxes.filter((b) => b.owner !== human() && b.address).map((b) => ({ owner: b.owner, name: boxLabel(b.owner), address: b.address }));
        return mailboxes.map((b) => b.owner).filter((o) => o !== human()).map((o) => ({ owner: o, name: boxLabel(o), address: address(o) }));
    }

    function renderRecipients() {
        const rows = recipientList().map((r) => ({
            two: true, icon: 'contacts-email', name: r.name, sub: r.address,
            go: () => {
                const view = page.querySelector('.msg-view[data-view="compose"]');
                const field = compose && compose.lastField === 'cc' ? 'cc' : 'to';
                const input = view.querySelector(`[name="${field}"]`);
                const now = input.value.trim().replace(/[;,]\s*$/, '');
                input.value = now ? `${now}; ${r.address}` : r.address;
                popLayer();
            }
        }));
        pickRows('recip', rows);
    }

    function checkNames() {
        const view = page.querySelector('.msg-view[data-view="compose"]');
        ['to', 'cc', 'bcc'].forEach((n) => {
            const input = view.querySelector(`[name="${n}"]`);
            // outside addresses as typed for an IMAP account; Dreamscape names get the domain
            input.value = compose && compose.imapId ? splitAddrs(input.value).join('; ') : bare(input.value).map(address).join('; ');
        });
    }

    /** Menu > My Text: the phrase at the cursor of the field last typed in (the body by default). */
    function insertMyText(t) {
        const view = page.querySelector('.msg-view[data-view="compose"]');
        const name = compose && compose.lastField && compose.lastField !== 'to' && compose.lastField !== 'cc' ? compose.lastField : 'body';
        const el = view.querySelector(`[name="${name}"]`);
        const a = el.selectionStart == null ? el.value.length : el.selectionStart;
        const b = el.selectionEnd == null ? a : el.selectionEnd;
        el.value = el.value.slice(0, a) + t + el.value.slice(b);
        el.focus();
        el.selectionStart = el.selectionEnd = a + t.length;
    }

    /** Insert > Picture / File: a file from the phone, attached as the form's attachments are. */
    function insertFile(accept) {
        const input = document.createElement('input');
        input.type = 'file';
        if (accept) input.accept = accept;
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file || !compose) return;
            if (compose.imapId) { addImapFile(file); return; }
            const reader = new FileReader();
            reader.onload = () => {
                if (!compose) return;
                const s = String(reader.result || '');
                compose.attachments.push({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, base64: s.slice(s.indexOf(',') + 1) });
                renderAtts();
            };
            reader.readAsDataURL(file);
        });
        input.click();
    }

    // ---------------------------------------------------------------- Message Options (165521)

    function renderMsgOpts() {
        const view = page.querySelector('.msg-view[data-view="msgopts"]');
        if (!compose) return;
        const ui = window.wmSettings && window.wmSettings.ui;
        const label = (list, v) => (list.find(([k]) => k === v) || list[0])[1];
        const combo = (act, text, off) => (ui ? ui.comboHtml(act, text, off) : `<button type="button" class="wm-combo" data-act="${act}"${off ? ' disabled' : ''}><span>${esc(text)}</span></button>`);
        view.querySelector('.wm-form').innerHTML = `
            <div class="msg-opt"><span>Priority:</span>${combo('priority', label(PRIORITIES, compose.priority))}</div>
            <div class="msg-opt"><span>Security:</span>${combo('security', 'Don\'t sign or encrypt', true)}</div>
            <div class="msg-opt"><span>Permission:</span>${combo('permission', 'Unrestricted Access', true)}</div>
            <div class="msg-opt"><span>Language:</span>${combo('language', label(LANGUAGES, compose.language))}</div>`;
        if (ui) {
            ui.bindCombo(view.querySelector('[data-act="priority"]'), PRIORITIES, compose.priority, (v) => { if (compose) compose.priority = v; });
            ui.bindCombo(view.querySelector('[data-act="language"]'), LANGUAGES, compose.language, (v) => { if (compose) compose.language = v; });
        }
    }

    // ---------------------------------------------------------------- menus

    function respondItems(m) {
        const can = !!m && canAct();
        return [
            { label: 'Reply', disabled: !can, action: () => respond('reply', m) },
            { label: 'Reply All', disabled: !can || !(listOf(m.to).length + listOf(m.cc).length > 1), action: () => respond('replyAll', m) },
            { label: 'Forward', disabled: !can, action: () => respond('forward', m) }
        ];
    }

    /** The sort orders (the bar's drop-down; Tools > Sort By, 6.5 with Message Type first). */
    function sortItems() {
        const rows = SORTS.map(([k, label]) => ({ label, radio: sortField === k, action: () => setSort(k) }));
        if (is65()) rows.unshift({ label: 'Message Type', disabled: true });
        return rows;
    }

    function goToItems() {
        // the device draws a rule under Folders... (165052)
        return [{ label: 'Folders...', action: () => showTree(page.querySelector('.msg-folder')) }, '-'].concat(accountItems());
    }

    const optionsItem = () => ({ label: 'Options...', disabled: !(window.wmSettings && typeof window.wmSettings.open === 'function'), action: () => window.wmSettings.open('messaging-options', null, { direct: true }) });

    function readItem(ids) {
        const list = ids.map(mailById).filter(Boolean);
        const allRead = list.length && list.every((m) => m.read);
        return allRead
            ? { label: 'Mark as Unread', disabled: !canAct(), action: () => setRead(ids, false) }
            : { label: 'Mark as Read', disabled: !list.length || !canAct(), action: () => setRead(ids, true) };
    }

    function selectItems() {
        const any = mail.length > 0;
        return [
            { label: 'All', disabled: !any, action: () => selectAll(false) },
            { label: 'All Below', disabled: !any || !selectedId, action: () => selectAll(true) },
            { label: 'Several', disabled: !any, action: startSeveral }
        ];
    }

    /**
     * The Director's own session menu for a row (Fork, Move to workspace, Auto-Repair, Nuke, Delete:
     * director.js directorSessionContextConfig through wmDirectorApp.sessionMenuRows, #763). The list
     * reads again when the Director answers one of them (watchDirectorRows).
     */
    function dirSessionRows(s) {
        const app = window.wmDirectorApp;
        if (!s || s.draft || !app || typeof app.sessionMenuRows !== 'function') return [];
        try { return app.sessionMenuRows(dirP, s.id, s) || []; } catch (err) { console.warn('[wmMessaging] session menu', err); return []; }
    }

    function directorListMenu() {
        const s = (dirRows().find((x) => String(x.id) === String(selectedId))) || null;
        const rows = dirSessionRows(s);
        return [
            { label: 'New', action: () => newDirectorSession(dirP) },
            { label: 'Open', disabled: !s, action: () => openDirectorRow(s) },
            ...(rows.length ? [{ label: 'Session', submenu: () => dirSessionRows(s) }] : []),
            '-',
            { label: 'Go To', submenu: goToItems },
            { label: 'Tools', submenu: () => [{ label: 'New Account...', action: setupAccount }, optionsItem()] },
            '-',
            syncing ? { label: 'Stop Send/Receive', action: stopSendReceive } : { label: 'Send/Receive', action: sendReceive }
        ];
    }

    function listMenu() {
        if (!isList()) return directorListMenu();
        const m = selectedMail();
        const mine = canAct();
        const ids = targetIds();
        // Follow up (outres 32308) where the account keeps flags: IMAP accounts
        const follow = isImap() ? [followUpItem(ids.map(mailById))] : [];
        const clearItem = { label: `Clear "${accountTitle()}"`, disabled: true };
        if (is65()) {
            // the device's Outlook E-mail list menu (Delete is the left soft key there)
            return [
                { label: 'New', action: () => newMessage() },
                { label: 'Reply/Forward', submenu: () => respondItems(m) },
                readItem(ids),
                ...follow,
                { label: 'Move...', disabled: !ids.length || !mine, action: () => openMove(ids) },
                { label: 'Go To', submenu: goToItems },
                { label: 'Tools', submenu: () => [
                    { label: 'Sort By', submenu: () => sortItems() },
                    { label: 'Manage Folders...', disabled: !isMine(), action: () => pushLayer('manage') },
                    clearItem,
                    { label: 'Empty Deleted Items', disabled: !mine || (isImap() && !imapPathOf('\\Trash')), action: emptyDeleted },
                    { label: 'Enable Updates', disabled: true },
                    { label: 'New Account...', action: setupAccount },
                    optionsItem()
                ] },
                { label: 'Select Messages', submenu: selectItems },
                syncing ? { label: 'Stop Send/Receive', action: stopSendReceive } : { label: 'Send/Receive', action: sendReceive }
            ];
        }
        // 6.1 (164304-165058): New, Reply >, Mark as Read, Move... | Go To >, Tools > | Select Messages >, Send/Receive
        return [
            { label: 'New', action: () => newMessage() },
            { label: 'Reply', submenu: () => respondItems(m) },
            readItem(ids),
            ...follow,
            { label: 'Move...', disabled: !ids.length || !mine, action: () => openMove(ids) },
            '-',
            { label: 'Go To', submenu: goToItems },
            { label: 'Tools', submenu: () => [
                { label: 'Sort By', submenu: sortItems },
                { label: 'Manage Folders...', disabled: !isMine(), action: () => pushLayer('manage') },
                '-',
                { label: 'Empty Deleted Items', disabled: !mine || (isImap() && !imapPathOf('\\Trash')), action: emptyDeleted },
                clearItem,
                '-',
                { label: 'New Account...', action: setupAccount },
                optionsItem()
            ] },
            '-',
            { label: 'Select Messages', submenu: selectItems },
            syncing ? { label: 'Stop Send/Receive', action: stopSendReceive } : { label: 'Send/Receive', action: sendReceive }
        ];
    }

    function contextMenu(m) {
        const mine = canAct();
        if (!isList()) {
            const s = m;
            if (!s) return [{ label: 'New', action: () => newDirectorSession(dirP) }, { label: 'Send/Receive', action: sendReceive }];
            const rows = dirSessionRows(s);
            return [{ label: 'Open', action: () => openDirectorRow(s) }, { label: 'New', action: () => newDirectorSession(dirP) }, ...(rows.length ? ['-', ...rows] : [])];
        }
        if (!m) return [{ label: 'Send/Receive', action: sendReceive }, { label: 'Folders...', action: () => showTree(page.querySelector('.msg-folder')) }];
        if (is65()) {
            return [
                { label: 'Delete', disabled: !mine, action: () => deleteIds([String(m.id)], { fromList: true }) },
                ...respondItems(m),
                m.read
                    ? { label: 'Mark as Unread', disabled: !mine, action: () => setRead([String(m.id)], false) }
                    : { label: 'Mark as Read', disabled: !mine, action: () => setRead([String(m.id)], true) },
                ...(isImap() ? [followUpItem([m])] : []),
                { label: 'Move...', disabled: !mine, action: () => openMove([String(m.id)]) },
                { label: 'Download Message', disabled: true }
            ];
        }
        return [
            { label: 'Delete', disabled: !mine, action: () => deleteIds([String(m.id)], { fromList: true }) },
            '-',
            ...respondItems(m),
            '-',
            m.read
                ? { label: 'Mark as Unread', disabled: !mine, action: () => setRead([String(m.id)], false) }
                : { label: 'Mark as Read', disabled: !mine, action: () => setRead([String(m.id)], true) },
            ...(isImap() ? [followUpItem([m])] : []),
            { label: 'Move...', disabled: !mine, action: () => openMove([String(m.id)]) }
        ];
    }

    /** The reading page's menu (165439-165447). */
    function readMenu() {
        const m = reading;
        const mine = canAct();
        return [
            { label: 'Delete', disabled: !m || !mine, action: () => deleteIds([String(m.id)]) },
            { label: 'Reply', submenu: () => respondItems(m) },
            { label: 'Mark as Unread', disabled: !m || !mine, action: async () => { await setRead([String(m.id)], false); popLayer(); } },
            ...(isImap() ? [followUpItem([m])] : []),
            { label: 'Move...', disabled: !m || !mine, action: () => openMove([String(m.id)]) },
            { label: 'View', submenu: () => [
                // the whole message is downloaded and HTML mail shows as HTML already
                { label: 'Get HTML', disabled: true },
                { label: 'Text Size', submenu: () => TEXT_SIZES.map(([k, l]) => ({ label: l, radio: textSize() === k, action: () => setTextSize(k) })) },
                { label: 'Languages', disabled: true, submenu: () => [] }
            ] },
            '-',
            { label: 'Download Message', disabled: true },
            syncing ? { label: 'Stop Send/Receive', action: stopSendReceive } : { label: 'Send/Receive', action: sendReceive }
        ];
    }

    /** The new message's menu (165514-165517). */
    function composeMenu() {
        const people = recipientList();
        const cancel = () => { if (composeDirty()) confirmCancelCompose(); else popLayer(); };
        const inAddress = !!compose && (compose.lastField === 'to' || compose.lastField === 'cc');
        return [
            { label: 'Add Recipient...', disabled: !people.length || !inAddress, action: () => pushLayer('recip') },
            { label: 'Check Names', action: checkNames },
            { label: 'Insert', submenu: () => [
                { label: 'Picture', action: () => insertFile('image/*') },
                { label: 'Voice Note', action: recordVoiceNote },
                { label: 'File', action: () => insertFile('') }
            ] },
            { label: 'My Text', submenu: () => MY_TEXT.map((t) => ({ label: t, action: () => insertMyText(t) })) },
            // Dreamscape Mail's drafts are kept on this phone; an IMAP account's go to its Drafts folder on the server
            { label: 'Save to Drafts', disabled: !!(compose && compose.imapId && !imapPathOf('\\Drafts', compose.imapId)), action: () => (compose && compose.imapId ? saveDraftImap() : saveDraft()) },
            { label: 'Spell Check', action: () => spellCheckField(page.querySelector('.msg-view[data-view="compose"] [name="body"]')) },
            ...(is65() ? [] : ['-']),
            { label: 'Cancel Message', action: cancel },
            { label: 'Message Options...', action: () => pushLayer('msgopts') }
        ];
    }

    function softKeys() {
        const t = top();
        if (t === 'accounts') {
            return {
                left: { label: 'Select', action: () => pickActivate('accounts', pickIndex) },
                right: { label: 'Menu', menu: () => [optionsItem(), { label: 'Delete', disabled: true }] }
            };
        }
        if (t === 'move') {
            return { left: { label: 'Cancel', action: popLayer }, right: { label: 'Select', action: () => pickActivate('move', pickIndex) } };
        }
        if (t === 'recip') {
            return { left: { label: 'Cancel', action: popLayer }, right: { label: 'Select', disabled: !recipientList().length, action: () => pickActivate('recip', pickIndex) } };
        }
        if (t === 'manage' || t === 'msgopts') return { left: null, right: null };
        if (t === 'sender') {
            return {
                left: { label: 'Save', disabled: !(window.wmContactsApp && typeof window.wmContactsApp.newContact === 'function'), action: saveSender },
                right: { label: 'E-mail', action: mailSender }
            };
        }
        if (t === 'read') {
            return { left: { label: 'Reply', disabled: !reading || !canAct(), action: () => respond('reply', reading) }, right: { label: 'Menu', menu: readMenu } };
        }
        if (t === 'compose') {
            return { left: { label: 'Send', disabled: sending, action: sendCompose }, right: { label: 'Menu', menu: composeMenu } };
        }
        if (!isList()) return { left: { label: 'New', action: () => newDirectorSession(dirP) }, right: { label: 'Menu', menu: listMenu } };
        const ids = targetIds();
        // 6.1 and 6.5 alike: Delete / Menu on the list (164304)
        return { left: { label: 'Delete', disabled: !ids.length || !canAct(), action: () => deleteIds(ids, { fromList: true }) }, right: { label: 'Menu', menu: listMenu } };
    }

    // ---------------------------------------------------------------- Director

    function openDirectorRow(s) {
        if (!s) return;
        if (s.draft) { newDirectorSession(dirP); return; }
        openDirectorSession(dirP, s.id);
    }

    /**
     * The Director app on that persona and THAT session, its messages on screen (#763: the phone's
     * openSessionInWindow only brought the Director up on her front page): wmDirectorApp.openSession.
     */
    async function openDirectorSession(p, id) {
        const app = window.wmDirectorApp;
        if (app && typeof app.openSession === 'function') {
            try { if (await app.openSession(p, id)) return; } catch (err) { console.warn('[wmMessaging] Director', err); }
        }
        const inst = window.directorInstance;
        if (!inst || typeof inst.openSessionInWindow !== 'function') { ws.open('director'); return; }
        try {
            if (inst.persona !== p && typeof inst.setPersona === 'function') await busyOf(() => inst.setPersona(p), { paint: true });
            await inst.openSessionInWindow(id);
        } catch (err) {
            console.warn('[wmMessaging] Director', err);
            ws.open('director');
        }
    }

    /** A session changed by the Director (a menu row run from here, or elsewhere): the list reads again. */
    let dirWatch = false;
    function watchDirectorRows() {
        const c = wsc();
        if (dirWatch || !c || typeof c.on !== 'function') return;
        dirWatch = true;
        let timer = null;
        const again = () => {
            clearTimeout(timer);
            timer = setTimeout(() => { if (acct === 'dir' && page) loadDirector({ keep: true }); }, 400);
        };
        ['director_delete_session_response', 'director_fork_session_response', 'director_move_session_response', 'director_session_renamed', 'director_session_repair', 'director_create_session_response'].forEach((t) => c.on(t, again));
    }

    /** New: the Director app's own New Session with that persona. */
    async function newDirectorSession(p) {
        const app = window.wmDirectorApp;
        ws.open('director');
        if (app && typeof app.newSessionWith === 'function') {
            try { await app.newSessionWith(p); return; } catch (err) { console.warn('[wmMessaging] new session', err); }
        }
        const inst = window.directorInstance;
        if (!inst) return;
        try {
            if (inst.persona !== p && typeof inst.setPersona === 'function') await busyOf(() => inst.setPersona(p), { paint: true });
            if (typeof inst.openNewSession === 'function') await busyOf(() => inst.openNewSession(), { paint: true });
        } catch (err) { console.warn('[wmMessaging] new session', err); }
    }

    // ---------------------------------------------------------------- page

    // the click that ends a tap-and-hold must not reach the shell's outside-click handler or the row
    let suppressClick = false;
    window.addEventListener('click', (e) => {
        if (!suppressClick) return;
        suppressClick = false;
        if (!(e.target && e.target.closest && e.target.closest('.wm-msg .msg-scroll'))) return;
        e.stopPropagation();
        e.preventDefault();
    }, true);

    const rowItem = (id) => (isList() ? mailById(id) : dirRows().find((s) => String(s.id) === String(id)) || null);

    function onListPointer(scroll) {
        let timer = null;
        let start = null;
        let held = false;
        const clear = () => { clearTimeout(timer); timer = null; };
        const hold = (x, y, row) => {
            held = true;
            suppressClick = true;
            clear();
            if (row) selectRow(row.dataset.id);
            ws.menuAt(x, y, contextMenu(row ? rowItem(row.dataset.id) : null));
        };
        scroll.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            held = false;
            suppressClick = false;
            start = { x: e.clientX, y: e.clientY };
            const row = e.target.closest('.msg-row');
            clear();
            if (several) return;
            timer = setTimeout(() => hold(start.x, start.y, row), ((window.wmShell && window.wmShell.holdMs) || 550));
        });
        scroll.addEventListener('pointermove', (e) => {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8 * px()) clear();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => scroll.addEventListener(t, clear));
        scroll.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (held || several) return;
            hold(e.clientX, e.clientY, e.target.closest('.msg-row'));
        });
        scroll.addEventListener('click', (e) => {
            if (held) { held = false; return; }
            const row = e.target.closest('.msg-row');
            if (!row) return;
            if (several) { toggleMulti(row.dataset.id); return; }
            if (multi.size) { endSelect(); renderList(); }
            selectRow(row.dataset.id);
            if (!isList()) { openDirectorRow(rowItem(row.dataset.id)); return; }
            openMessage(mailById(row.dataset.id));
        });
        scroll.addEventListener('scroll', () => {
            if (scroll.scrollTop + scroll.clientHeight > scroll.scrollHeight - 200) loadMore();
        }, { passive: true });
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-msg');
        p.innerHTML = `
            <div class="msg-view" data-view="list">
                <div class="wm-pv-bar msg-bar">
                    <button type="button" class="wm-pv-folder msg-folder" aria-haspopup="tree" aria-expanded="false">${img('msg-folder-inbox')}<span class="msg-folder-name">Inbox</span><i class="wm-pv-arrow"></i></button>
                    <button type="button" class="wm-pv-sort msg-sort" aria-haspopup="menu" aria-expanded="false"><span>Received</span><i class="wm-pv-arrow"></i></button>
                </div>
                <div class="msg-scroll"><div class="msg-list" role="listbox" aria-label="Messages"></div><p class="msg-empty" hidden></p></div>
                <div class="msg-status"><span class="msg-status-acct"></span><span class="msg-status-count"></span></div>
            </div>
            <div class="msg-view" data-view="accounts" hidden>
                <div class="msg-head">Select an Account</div>
                <div class="msg-pick" role="listbox" aria-label="Accounts"></div>
            </div>
            <div class="msg-view" data-view="move" hidden>
                <div class="msg-head">Move to folder:</div>
                <div class="msg-pick is-tree" role="listbox" aria-label="Folders"></div>
            </div>
            <div class="msg-view" data-view="manage" hidden>
                <div class="msg-head">Manage Folders</div>
                <p class="msg-manage-text">Select folders for synchronization. To create or modify folders, tap and hold a folder.</p>
                <div class="msg-manage-box"><div class="mt-tree" role="tree" aria-label="Folders"></div></div>
            </div>
            <div class="msg-view" data-view="msgopts" hidden>
                <div class="msg-head">Message Options<button type="button" class="msg-head-help" data-act="msgopts-help" aria-label="Help">${img('app-help')}</button></div>
                <div class="wm-form msg-opts"></div>
            </div>
            <div class="msg-view" data-view="sender" hidden>
                <div class="msg-head is-card"></div>
                <div class="msg-pick" role="listbox" aria-label="Sender"></div>
            </div>
            <div class="msg-view" data-view="recip" hidden>
                <div class="msg-head">Add Recipient</div>
                <div class="msg-pick" role="listbox" aria-label="Recipients"></div>
            </div>
            <div class="msg-view" data-view="read" hidden>
                <div class="msg-read"></div>
            </div>
            <div class="msg-view" data-view="compose" hidden>
                <form class="msg-form" autocomplete="off" onsubmit="return false">
                    <label class="msg-field is-bcc" hidden><span>Bcc:</span><input name="bcc" type="text" inputmode="email" autocapitalize="off" spellcheck="false"></label>
                    <label class="msg-field is-cc"><span>Cc:</span><input name="cc" type="text" inputmode="email" autocapitalize="off" spellcheck="false"></label>
                    <label class="msg-field is-static"><span>From:</span><output class="msg-from-addr"></output></label>
                    <label class="msg-field"><span>To:</span><input name="to" type="text" inputmode="email" autocapitalize="off" spellcheck="false"></label>
                    <label class="msg-field"><span>Subject:</span><input name="subject" type="text"></label>
                    <div class="msg-atts msg-compose-atts" hidden></div>
                    <textarea name="body" class="msg-text" aria-label="Message" spellcheck="false"></textarea>
                </form>
            </div>`;
        onListPointer(p.querySelector('.msg-scroll'));
        // the heading's ? opens Help on the page, where a Help program is installed
        p.querySelector('[data-act="msgopts-help"]').addEventListener('click', () => {
            const H = window.wmHelp;
            if (H && typeof H.search === 'function') H.search('Message Options');
            else ws.messageBox({ title: 'Message Options', icon: 'info', text: 'Priority, security, permission and language apply to this message only. Priority goes out with the message as its importance.' });
        });
        p.querySelector('.msg-read').addEventListener('click', (e) => {
            if (e.target.closest('.msg-pics-link')) { e.preventDefault(); downloadPictures(); return; }
            const att = e.target.closest('.msg-atts .msg-att[data-n]');
            if (att) { openAttachment(Number(att.dataset.n)); return; }
            if (e.target.closest('.msg-sender')) pushLayer('sender');
        });
        p.querySelector('.msg-read').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.closest('.msg-sender')) { e.preventDefault(); pushLayer('sender'); }
        });
        const folderBtn = p.querySelector('.msg-folder');
        folderBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showTree(folderBtn);
        });
        const sortBtn = p.querySelector('.msg-sort');
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTree();
            sortBtn.setAttribute('aria-expanded', 'true');
            sortBtn.querySelector('span').textContent = is65() ? 'Sort by' : 'Sort By';
            ws.dropdown(sortBtn, sortItems(), 'right', () => { sortBtn.setAttribute('aria-expanded', 'false'); renderBar(); });
        });
        p.querySelectorAll('.msg-pick').forEach((host) => {
            host.addEventListener('click', (e) => {
                const row = e.target.closest('.msg-pick-row');
                if (!row) return;
                const v = host.closest('.msg-view').dataset.view;
                if (v === 'sender') { mailSender(); return; }
                pickActivate(v, Number(row.dataset.n));
            });
        });
        p.querySelector('.msg-manage-box').addEventListener('change', (e) => {
            const box = e.target.closest('.mt-check');
            if (!box) return;
            const m = syncMap();
            m[box.dataset.key] = box.checked;
            store(OPT.sync, JSON.stringify(m));
            if (box.dataset.key === folder) loadFolder();
        });
        const form = p.querySelector('.msg-form');
        // an attachment of the new message: tap for its menu (Remove)
        p.querySelector('.msg-compose-atts').addEventListener('click', (e) => {
            const att = e.target.closest('.msg-att[data-n]');
            if (att) { e.stopPropagation(); attachmentMenu(att); }
        });
        // the input panel opening / closing changes the page's height: the text fills it again
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitCompose()).observe(form);
        form.querySelector('[name="body"]').addEventListener('input', () => fitCompose());
        form.addEventListener('keydown', (e) => {
            // up / down between the header's lines (the device: up from To scrolls Cc and Bcc into sight)
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.tagName === 'INPUT' && compose) {
                const fields = [...p.querySelectorAll('.msg-form input')].filter((x) => !x.closest('[hidden]'));
                const next = fields[fields.indexOf(e.target) + (e.key === 'ArrowUp' ? -1 : 1)];
                if (next) {
                    e.preventDefault();
                    next.focus();
                    if (e.key === 'ArrowUp' && e.target.name === 'to') fitCompose(true);
                    return;
                }
            }
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
                const fields = [...p.querySelectorAll('.msg-form input, .msg-form textarea')].filter((x) => !x.closest('[hidden]') && x !== textMirror);
                const next = fields[fields.indexOf(e.target) + 1];
                if (next) next.focus();
            }
        });
        // Add Recipient... follows the field last typed in (greyed in Subject and the body, as on the device)
        form.addEventListener('focusin', (e) => {
            const n = e.target && e.target.name;
            if (compose && n) { compose.lastField = n; if (isCurrent()) ws.refreshSoftKeys(); }
        });
        // once: a page made again after the app ended keeps the same listeners
        if (!mount.wired) {
            mount.wired = true;
            document.addEventListener('keydown', onKey);
            document.addEventListener('dovecoteMailboxUpdated', onMailboxUpdated);
        }
    }

    function onKey(e) {
        if (!isCurrent()) return;
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        const layer = document.querySelector('#wmShell .wm-msgbox-layer');
        if (layer && !layer.hidden) return;
        if (document.querySelector('#wmShell > .wm-popup:not([hidden]), #wmShell > .wm-startmenu:not([hidden])')) return;
        const t = top();
        if (t === 'accounts' || t === 'move' || t === 'recip') {
            const host = page.querySelector(`.msg-view[data-view="${t}"] .msg-pick`);
            const n = (host._rows || []).length;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                pickIndex = Math.max(0, Math.min(n - 1, pickIndex + (e.key === 'ArrowDown' ? 1 : -1)));
                host.querySelectorAll('.msg-pick-row').forEach((r) => r.classList.toggle('is-selected', Number(r.dataset.n) === pickIndex));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                pickActivate(t, pickIndex);
            }
            return;
        }
        if (t === 'read') {
            if (e.key === 'ArrowLeft') { e.preventDefault(); readSibling(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); readSibling(1); }
            if (e.key === 'Delete' && reading) { e.preventDefault(); deleteIds([String(reading.id)]); }
            return;
        }
        if (t !== 'list') return;
        const rows = isList() ? sorted(mail) : dirRows();
        const at = rows.findIndex((m) => String(m.id) === String(selectedId));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
            if (rows[n]) selectRow(rows[n].id, true);
        } else if (e.key === 'Enter' && at >= 0) {
            e.preventDefault();
            if (several) toggleMulti(rows[at].id);
            else if (isList()) openMessage(rows[at]);
            else openDirectorRow(rows[at]);
        } else if (e.key === 'Delete' && isList() && targetIds().length) {
            e.preventDefault();
            deleteIds(targetIds(), { fromList: true });
        }
    }

    // dovecote.js re-dispatches the server's dovecote_mailbox_updated push as this event
    let pushTimer = null;
    function onMailboxUpdated(ev) {
        const data = ev && ev.detail;
        if (data && Array.isArray(data.mailboxes)) {
            // a push from a server without `address` keeps the addresses already known
            const known = new Map(mailboxes.map((b) => [b.owner, b.address]));
            mailboxes = data.mailboxes.map((b) => (b.address || !known.get(b.owner) ? b : Object.assign({}, b, { address: known.get(b.owner) })));
            if (top() === 'accounts') renderAccounts();
            if (tree) renderTree();
        }
        if (!page || !isMail()) return;
        const owners = data && Array.isArray(data.owners) ? data.owners : null;
        if (owners && owner && !owners.includes(owner)) return;
        // hidden: show() reloads the list anyway (loadFolder keep), so skip background round trips
        if (!isCurrent()) return;
        // several pushes in a row (a batch mark) reload the list once
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
            if (!data) loadMailboxes();
            loadFolder({ keep: true });
        }, 250);
    }

    /** Back to a plain e-mail list on the person's own mailbox (another app hands work over). */
    function resetToMail(keepList) {
        closeTree();
        layers = [];
        pickerRoot = false;
        endSelect();
        if (reading) { reading = null; readToken++; }
        compose = null;
        moveIds = [];
        if (!keepList && (acct !== 'mail' || owner !== human())) {
            acct = 'mail';
            owner = human();
            folder = 'inbox';
            mail = [];
            selectedId = null;
        }
    }

    /**
     * Other apps hand a new message to Messaging (Contacts' Send e-mail, Send Contact > E-mail..., a
     * forwarded text message): { to: [addresses], subject, body, attachments: [{ name, mimeType, base64 }] }.
     * Back from the form returns to the app that asked.
     */
    function composeFromApp(init = {}) {
        if (!ws) return;
        skipPicker = true;
        ws.open(APP_ID);
        if (!page) return;
        const to = (Array.isArray(init.to) ? init.to : (init.to ? [init.to] : [])).map((t) => String(t).trim()).filter(Boolean);
        resetToMail(true);
        if (!isMail()) { acct = 'mail'; owner = human(); folder = 'inbox'; mail = []; }
        newMessage({ to: to.join('; '), subject: init.subject || '', body: init.body || '', attachments: init.attachments });
    }
    window.wmMessagingCompose = composeFromApp;

    /**
     * The home screen's e-mail panel opens one inbox message here: Messaging comes to the front on the
     * person's own inbox and the message opens through openMessage (fetched by id when the list does not
     * hold it yet). An id that cannot be found leaves the app on the inbox list.
     */
    async function openMail(id) {
        if (!ws || id == null) return;
        skipPicker = true;
        ws.open(APP_ID, { fromStart: true });
        if (!page) return;
        const want = String(id);
        if (top() === 'read' && reading && String(reading.id) === want && isMine() && folder === 'inbox') return;
        resetToMail(false);
        const me = human();
        if (folder !== 'inbox') { folder = 'inbox'; mail = []; selectedId = null; }
        showLayer();
        ws.syncHistory();
        // show() has just started the list load (or this does): the row may come with it
        const token = ++listToken;
        loading = true;
        let row = mailById(want);
        try {
            const r = await send('dovecote_list_mail', { folder: 'inbox', limit: Math.max(PAGE_LIMIT, mail.length) }, true);
            if (token === listToken) {
                mail = (r && r.mail) || [];
                nextCursor = (r && r.nextCursor) || null;
                hasMore = !!(r && r.hasMore);
                listError = '';
            }
        } catch (_) { /* the list keeps what it had */ }
        if (token !== listToken) return;
        loading = false;
        loadingMore = false;
        row = mailById(want) || row;
        if (!row) {
            // not in the first page: the message itself, unread state untouched until it is opened
            try {
                const r = await send('dovecote_get_mail', { id, markRead: false }, true);
                const full = r && r.mail;
                if (full && String(full.id) === want && (!full.owner || full.owner === me)) row = full;
            } catch (_) { /* not found: the inbox list stays */ }
        }
        if (token !== listToken || !isMine() || folder !== 'inbox' || layers.length) return;
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
        if (row) openMessage(row);
    }

    window.wmMessaging = {
        openMail, showTree, closeTree, accountItems, goTo, openAccount: (key, f) => goTo(key || 'mail', f), setupAccount, mailAddress: () => mailAddress(), spellCheckField, loadSignature,
        // IMAP accounts (#789): Search Phone opens a message; the shell's envelope / Today count the new arrivals
        openImapMessage,
        imapNew: () => imapPending.size,
        imapAccounts: () => imapAccts.map((a) => ({ id: a.id, name: imapName(a), email: a.email, unread: imapUnread(a.id) }))
    };

    // ---------------------------------------------------------------- registration

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
        // Text Messaging accounts for the picker / Go To / tree, again when window.textMessaging is replaced
        wireTm();
        // and the IMAP accounts (#789): their rows, and their new mail's notification while Messaging is closed
        wireImap();
        setInterval(() => { wireTm(); wireImap(); }, 3000);
        ws.registerApp({
            id: APP_ID,
            title: 'Messaging',
            icon: 'app-messaging',
            inStart: 'top',
            sip: true,
            mount,
            show() {
                if (!owner) owner = human();
                // the signature for new messages (Options > Accounts > Signatures..., the desktop's Mail Options)
                loadSignature();
                // the app starting: "Select an Account" first (Options > Accounts, on as shipped)
                if (freshOpen && !skipPicker && optOn(OPT.picker)) {
                    layers = ['accounts'];
                    pickerRoot = true;
                    pickIndex = -1;
                }
                freshOpen = false;
                skipPicker = false;
                showLayer();
                loadMailboxes();
                probeXi();
                refreshSms();
                refreshTm();
                refreshImap();
                // behind the picker the list loads without the wait cursor (nothing waits on it yet)
                loadFolder({ keep: pickerRoot || (isList() ? mail.length : (dirLists[dirP] || []).length) > 0 });
            },
            hide() {
                clearTimeout(pushTimer);
                closeTree();
            },
            onEnd() {
                // X / Task Manager ended the app: the next start is a fresh one
                closeTree();
                freshOpen = true;
                layers = [];
                pickerRoot = false;
                endSelect();
                reading = null;
                readToken++;
                compose = null;
                moveIds = [];
                page = null;
            },
            // WM: X on the lists (Smart Minimize), ok on a message, a new message and the option pages;
            // Move and Add Recipient have their own Cancel / Select: no corner
            titleKind() {
                const t = top();
                if (t === 'read' || t === 'compose' || t === 'manage' || t === 'msgopts' || t === 'sender') return 'ok';
                return t === 'move' || t === 'recip' ? null : 'close';
            },
            onTitleOk: () => goBack(),
            historyDepth: () => Math.max(0, layers.length - (pickerRoot ? 1 : 0)),
            onBack: () => goBack(),
            softKeys
        });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
