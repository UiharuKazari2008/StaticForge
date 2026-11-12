/**
 * Melaton Mobile: Messaging, the Windows Mobile 6.1 Professional stock app (Outlook Mobile) over
 * Dreamscape's Dovecote mail, Yozora #709. Dovecote becomes Messaging on the phone (Yukimi's app
 * mapping): the same mailboxes and WS calls the desktop's Dovecote Express uses
 * (public/scripts/comp/desktop-apps/dovecote.js; server modules/ws/handlers/250-dovecoteHandler.js).
 *
 * Accounts (#757, Yukimi's device screenshots tmp/wmss, Nov 11 2026), in the picker's order:
 *   Text Messages    the Chat applet (wmChat.js: window.wmChatApp), the device's Text Messages
 *   Dreamscape Mail  the signed-in person's mailbox (DESKTOP_DOVECOTE_HUMAN_OWNER) with its outside
 *                    address on the second line (dovecote_list_mailboxes `address`, mailGateway
 *                    toExternal); the agents' mailboxes are not accounts: the folder tree has them
 *                    under Dreamscape Mail > Other Mailboxes, one folder per mailbox (read-only here,
 *                    as on the desktop: every mark / move / delete / send acts on the person's own)
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
    const SMS_ACCOUNT = 'Text Messages';
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
    let acct = 'mail'; // the account on screen: 'mail' | 'dir'
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
    const isMine = () => isMail() && owner === human();
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

    /** The accounts in the picker's order: Text Messages, Dreamscape Mail, the Director personas. */
    function accounts() {
        return [
            { key: 'sms', name: SMS_ACCOUNT, icon: 'msg-acct-sms', sub: '', unread: smsUnread() },
            { key: 'mail', name: MAIL_ACCOUNT, icon: 'msg-acct-outlook', sub: mailAddress(), dim: true, unread: mailUnread() }
        ].concat(personas().map(([p, n]) => ({ key: `dir:${p}`, name: n, icon: `today-persona-${p}`, sub: 'Director', dim: true, unread: 0 })));
    }

    const currentKey = () => (isMail() ? 'mail' : `dir:${dirP}`);

    /** Go To's account rows (the device lists them after Folders..., the current one with a bullet). */
    function accountItems(cur) {
        const now = cur || currentKey();
        return accounts().map((a) => ({ label: a.name, radio: a.key === now, action: () => goTo(a.key) }));
    }

    /** Another account: Text Messages is the Chat applet; the rest are this app's lists. */
    function goTo(key, f) {
        closeTree();
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
            text: 'E-mail accounts are set up on the desktop in Dovecote. Messaging shows Dreamscape Mail, the other Dreamscape mailboxes (under Other Mailboxes) and the Director personas.'
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

    /** Text Messages' unread count for the picker (the Chat applet reads its chats behind it). */
    function refreshSms() {
        const c = window.wmChatApp;
        if (!c || typeof c.refresh !== 'function') return;
        c.refresh().then(() => { if (top() === 'accounts') renderAccounts(); if (tree) renderTree(); }, () => {});
    }

    function sorted(list) {
        const out = list.slice();
        if (!isMail()) return out; // the Director's own order: last activity first
        if (sortField === 'from') out.sort((a, b) => senderText(a).localeCompare(senderText(b), undefined, { sensitivity: 'base' }) || (b.createdAt > a.createdAt ? 1 : -1));
        else if (sortField === 'subject') out.sort((a, b) => String(a.subject || '').localeCompare(String(b.subject || ''), undefined, { sensitivity: 'base' }) || (b.createdAt > a.createdAt ? 1 : -1));
        else out.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));
        return out;
    }

    function syncMap() {
        try { return JSON.parse(stored(OPT.sync) || '{}') || {}; } catch (_) { return {}; }
    }
    const folderSynced = (id) => !(FOLDERS.find((f) => f.id === id) || {}).sync || syncMap()[id] !== false;

    async function loadFolder(opts = {}) {
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
        if (!(await mark(ids, { read }))) return;
        ids.forEach((id) => {
            const m = mailById(id);
            if (m) m.read = read;
            if (reading && String(reading.id) === String(id)) reading.read = read;
        });
        endSelect();
        renderList();
        loadMailboxes();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    async function deleteIds(ids, opts = {}) {
        if (!ids.length || !isMine()) return;
        if (folder === 'drafts') {
            if (opts.fromList && optOn(OPT.warnDelete)) {
                const yes = await ws.messageBox({ title: 'Messaging', icon: 'question', text: ids.length === 1 ? 'Delete the selected message?' : `Delete the ${ids.length} selected messages?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false });
                if (!yes) return;
            }
            ids.forEach((id) => dropDraft(String(id).replace(/^draft:/, '')));
            if (top() === 'read') popLayer();
            loadFolder({ keep: true });
            return;
        }
        const permanent = folder === 'deleted';
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
        const f = folderOf(folder);
        const btn = page.querySelector('.msg-folder');
        if (!btn || tree) return;
        btn.querySelector('img').outerHTML = img(f.icon);
        btn.querySelector('.msg-folder-name').textContent = f.label;
        const sort = page.querySelector('.msg-sort');
        sort.hidden = !isMail();
        sort.querySelector('span').textContent = (SORTS.find(([k]) => k === sortField) || SORTS[0])[1];
    }

    const isPicked = (id) => (multi.size ? multi.has(String(id)) : String(selectedId) === String(id));

    function rowHtml(m) {
        const id = esc(m.id);
        const out = folder === 'sent' || folder === 'outbox' || !!m.draft;
        const who = out ? listOf(m.to).map(personName).join('; ') : senderText(m);
        const unread = !m.read && !out;
        // a message with attachments has the envelope with the paper clip (its unread state is the bold)
        const icon = m.attachments && m.attachments.length ? 'msg-attach-mail' : (unread ? 'msg-unread' : 'msg-read');
        const on = isPicked(m.id);
        // the envelope is a CSS background (wm-messaging.css): an <img srcset> per row cost ~10 ms
        // each to insert on a throttled phone (image selection runs as the list is parsed)
        return `<div class="msg-row${unread ? ' is-unread' : ''}${on ? ' is-selected' : ''}" role="option" data-id="${id}" aria-selected="${on}">
            <span class="msg-ico" data-ico="${icon}"></span>
            <span class="msg-from">${esc(who || (out ? '' : '(no sender)'))}</span>
            <span class="msg-date">${esc(listDate(m.createdAt))}</span>
            <span class="msg-size">${m.size != null ? sizeText(m.size) : ''}</span>
            <span class="msg-subj">${m.importance ? `<span class="msg-prio" data-prio="${m.importance === 'high' ? 'high' : 'low'}" aria-label="${m.importance === 'high' ? 'High priority' : 'Low priority'}"></span>` : ''}${esc(m.subject || '(no subject)')}</span>
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
        if (isMail()) {
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
        if (syncing || (loading && !(isMail() ? mail.length : dirRows().length))) {
            acctEl.textContent = 'Connecting...';
            countEl.textContent = '';
            return;
        }
        if (!isMail()) {
            const n = dirRows().filter((s) => !s.draft).length;
            acctEl.textContent = accountTitle();
            countEl.textContent = `${n} Items.`;
            return;
        }
        const out = folder === 'sent' || folder === 'outbox' || folder === 'drafts';
        // the inbox's unread count is the mailbox's own (the list holds one page of it)
        const box = mailboxes.find((x) => x.owner === owner);
        const unread = out ? 0 : (folder === 'inbox' && box && !hasMore ? box.unread || 0 : mail.filter((m) => !m.read).length);
        acctEl.textContent = statusName();
        countEl.textContent = `${mail.length}${hasMore ? '+' : ''} Items${unread ? `, ${unread} Unread` : ''}.`;
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

    /** The tree: every account (alphabetical, as the device sorts them) with its folders. */
    function treeModel(cur) {
        const agents = mailboxes.map((b) => b.owner).filter((o) => o !== human());
        const nodes = accounts().map((a) => {
            let children = [];
            if (a.key === 'sms') children = SMS_FOLDERS.map((f) => ({ key: `sms/${f.id}`, label: f.label, icon: f.icon, count: f.id === 'inbox' ? smsUnread() : 0 }));
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
            } else if (a.key.startsWith('dir:')) children = DIR_FOLDERS.map((f) => ({ key: `${a.key}/${f.id}`, label: f.label, icon: f.icon }));
            return { key: a.key, label: a.name, icon: 'msg-folder-account', children };
        });
        return sortByLabel(nodes).map((n) => Object.assign(n, { current: n.key === cur.acct }));
    }

    /** The key of the folder on screen, as the tree names it. */
    function treeCurrent(opts) {
        if (opts.acct === 'sms') return `sms/${opts.folder || 'inbox'}`;
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
            html += `<div class="mt-row${n.key === cur ? ' is-current' : ''}" role="treeitem" data-key="${esc(n.key)}" style="--depth:${depth}"${kids ? ` aria-expanded="${!!open}"` : ''}>
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
     * The folder tree under a bar's folder drop-down (Messaging's list and Text Messages): the button
     * reads "Show" while it is open. opts: { acct: 'sms' | current, folder, onPick(folderId) } (onPick:
     * a Text Messages folder for the Chat applet).
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
        expanded.add(o.acct === 'sms' ? 'sms' : currentKey());
        if (curKey.startsWith('box:')) { expanded.add('mail'); expanded.add('mail/other'); expanded.add(curKey.split('/')[0]); }
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
        if (e.target.closest('.mt-box') || key === 'mail/other') {
            if (kids) { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); renderTree(); }
            return;
        }
        const t = tree;
        // an account: its Inbox; a folder: that folder
        const [head, f] = key.includes('/') ? [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)] : [key, 'inbox'];
        closeTree();
        if (head === 'sms' && t.opts.acct === 'sms' && typeof t.opts.onPick === 'function') { t.opts.onPick(f); return; }
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
        if (!isMine() || !ids.length) return;
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
        selectedId = String(m.id);
        const token = ++readToken;
        reading = Object.assign({}, m);
        pushLayer('read');
        renderRead(true);
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
        const out = folder === 'sent' || folder === 'outbox';
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
        if (isMine()) {
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
        frame.srcdoc = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'"><style>html{margin:0;padding:0;overflow-y:hidden;overflow-x:auto}body{margin:0;padding:0;overflow:visible;font:${fs}px Tahoma,'Segoe UI',Verdana,sans-serif;color:#000;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}a{color:#00f}</style></head><body>${(r && r.html) || ''}</body></html>`;
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
        host.appendChild(frame);
    }

    /**
     * A tap on an attachment: its bytes (dovecote_get_attachment) under the wait cursor, then a picture in
     * the shell's picture view (lightbox.js), anything else saved (the desktop's Dovecote does the same).
     */
    async function openAttachment(n) {
        const m = reading;
        const a = m && m.attachments && m.attachments[n];
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
        return `\n\n-----Original Message-----\nFrom: ${address(m.from)}\nSent: ${longDate(m.createdAt)}\nTo: ${listOf(m.to).map(address).join('; ')}\n${listOf(m.cc).length ? `Cc: ${listOf(m.cc).map(address).join('; ')}\n` : ''}Subject: ${m.subject || ''}\n\n${bodyText(m)}`;
    }

    const prefixed = (pre, subject) => {
        const s = String(subject || '');
        return new RegExp(`^${pre}:`, 'i').test(s) ? s : `${pre}: ${s}`;
    };

    function renderAtts() {
        const view = page.querySelector('.msg-view[data-view="compose"]');
        const atts = view.querySelector('.msg-compose-atts');
        atts.innerHTML = compose.attachments.map((a, n) => `<div class="msg-att" data-n="${n}">${img('msg-attachment')}<span>${esc(a.name || 'attachment')}</span></div>`).join('');
        atts.hidden = !compose.attachments.length;
    }

    function newMessage(init = {}) {
        compose = { mode: init.mode || 'new', replyTo: init.replyTo || null, attachments: Array.isArray(init.attachments) ? init.attachments.slice() : [], priority: 'normal', language: 'western', lastField: 'to' };
        const view = page.querySelector('.msg-view[data-view="compose"]');
        renderAtts();
        // 6.1: "Name <address> (account)" over two lines; 6.5 names the account in brackets
        view.querySelector('.msg-from-addr').textContent = is65() ? `(${MAIL_ACCOUNT})` : `${ownerName()} <${mailAddress()}> (${MAIL_ACCOUNT})`;
        view.querySelector('[name="to"]').value = init.to || '';
        view.querySelector('[name="cc"]').value = init.cc || '';
        // the device keeps Cc out of sight until it is used (Reply All fills it)
        view.querySelector('.msg-field.is-cc').hidden = !init.cc;
        view.querySelector('[name="subject"]').value = init.subject || '';
        const body = view.querySelector('[name="body"]');
        // the signature goes under the new text, above a quoted message (device)
        const sig = init.noSignature ? '' : signatureFor(compose.mode);
        body.value = sig ? (init.body ? sig + init.body : sig) : (init.body || '');
        pushLayer('compose');
        requestAnimationFrame(() => {
            const first = init.to ? body : view.querySelector('[name="to"]');
            first.focus();
            if (first === body) body.setSelectionRange(0, 0);
            body.scrollTop = 0;
        });
    }

    async function respond(kind, m) {
        if (!m || !isMine()) return;
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
            subject: view.querySelector('[name="subject"]').value,
            body: view.querySelector('[name="body"]').value
        };
    }

    function composeDirty() {
        if (!compose) return false;
        const f = composeFields();
        return !!(f.to.trim() || f.cc.trim() || f.subject.trim() || f.body.trim() || compose.attachments.length);
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

    /** Add Recipient...: the Dreamscape mailboxes, as Contacts would list them. */
    function recipientList() {
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
        ['to', 'cc'].forEach((n) => {
            const input = view.querySelector(`[name="${n}"]`);
            input.value = bare(input.value).map(address).join('; ');
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
        const can = !!m && isMine();
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
            ? { label: 'Mark as Unread', disabled: !isMine(), action: () => setRead(ids, false) }
            : { label: 'Mark as Read', disabled: !list.length || !isMine(), action: () => setRead(ids, true) };
    }

    function selectItems() {
        const any = mail.length > 0;
        return [
            { label: 'All', disabled: !any, action: () => selectAll(false) },
            { label: 'All Below', disabled: !any || !selectedId, action: () => selectAll(true) },
            { label: 'Several', disabled: !any, action: startSeveral }
        ];
    }

    function directorListMenu() {
        const s = (dirRows().find((x) => String(x.id) === String(selectedId))) || null;
        return [
            { label: 'New', action: () => newDirectorSession(dirP) },
            { label: 'Open', disabled: !s, action: () => openDirectorRow(s) },
            '-',
            { label: 'Go To', submenu: goToItems },
            { label: 'Tools', submenu: () => [{ label: 'New Account...', action: setupAccount }, optionsItem()] },
            '-',
            syncing ? { label: 'Stop Send/Receive', action: stopSendReceive } : { label: 'Send/Receive', action: sendReceive }
        ];
    }

    function listMenu() {
        if (!isMail()) return directorListMenu();
        const m = selectedMail();
        const mine = isMine();
        const ids = targetIds();
        if (is65()) {
            // the device's Outlook E-mail list menu (Delete is the left soft key there)
            return [
                { label: 'New', action: () => newMessage() },
                { label: 'Reply/Forward', submenu: () => respondItems(m) },
                readItem(ids),
                { label: 'Move...', disabled: !ids.length || !mine, action: () => openMove(ids) },
                { label: 'Go To', submenu: goToItems },
                { label: 'Tools', submenu: () => [
                    { label: 'Sort By', submenu: () => sortItems() },
                    { label: 'Manage Folders...', disabled: !mine, action: () => pushLayer('manage') },
                    { label: `Clear "${MAIL_ACCOUNT}"`, disabled: true },
                    { label: 'Empty Deleted Items', disabled: !mine, action: emptyDeleted },
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
            { label: 'Move...', disabled: !ids.length || !mine, action: () => openMove(ids) },
            '-',
            { label: 'Go To', submenu: goToItems },
            { label: 'Tools', submenu: () => [
                { label: 'Sort By', submenu: sortItems },
                { label: 'Manage Folders...', disabled: !mine, action: () => pushLayer('manage') },
                '-',
                { label: 'Empty Deleted Items', disabled: !mine, action: emptyDeleted },
                { label: `Clear "${MAIL_ACCOUNT}"`, disabled: true },
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
        const mine = isMine();
        if (!isMail()) {
            const s = m;
            if (!s) return [{ label: 'New', action: () => newDirectorSession(dirP) }, { label: 'Send/Receive', action: sendReceive }];
            return [{ label: 'Open', action: () => openDirectorRow(s) }, { label: 'New', action: () => newDirectorSession(dirP) }];
        }
        if (!m) return [{ label: 'Send/Receive', action: sendReceive }, { label: 'Folders...', action: () => showTree(page.querySelector('.msg-folder')) }];
        if (is65()) {
            return [
                { label: 'Delete', disabled: !mine, action: () => deleteIds([String(m.id)], { fromList: true }) },
                ...respondItems(m),
                m.read
                    ? { label: 'Mark as Unread', disabled: !mine, action: () => setRead([String(m.id)], false) }
                    : { label: 'Mark as Read', disabled: !mine, action: () => setRead([String(m.id)], true) },
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
            { label: 'Move...', disabled: !mine, action: () => openMove([String(m.id)]) }
        ];
    }

    /** The reading page's menu (165439-165447). */
    function readMenu() {
        const m = reading;
        const mine = isMine();
        return [
            { label: 'Delete', disabled: !m || !mine, action: () => deleteIds([String(m.id)]) },
            { label: 'Reply', submenu: () => respondItems(m) },
            { label: 'Mark as Unread', disabled: !m || !mine, action: async () => { await setRead([String(m.id)], false); popLayer(); } },
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
            { label: 'Save to Drafts', action: saveDraft },
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
            return { left: { label: 'Reply', disabled: !reading || !isMine(), action: () => respond('reply', reading) }, right: { label: 'Menu', menu: readMenu } };
        }
        if (t === 'compose') {
            return { left: { label: 'Send', disabled: sending, action: sendCompose }, right: { label: 'Menu', menu: composeMenu } };
        }
        if (!isMail()) return { left: { label: 'New', action: () => newDirectorSession(dirP) }, right: { label: 'Menu', menu: listMenu } };
        const ids = targetIds();
        // 6.1 and 6.5 alike: Delete / Menu on the list (164304)
        return { left: { label: 'Delete', disabled: !ids.length || !isMine(), action: () => deleteIds(ids, { fromList: true }) }, right: { label: 'Menu', menu: listMenu } };
    }

    // ---------------------------------------------------------------- Director

    function openDirectorRow(s) {
        if (!s) return;
        if (s.draft) { newDirectorSession(dirP); return; }
        openDirectorSession(dirP, s.id);
    }

    /** The Director app on that persona and session (the Today widget's hand-off, wmTodayWidgets.js). */
    async function openDirectorSession(p, id) {
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

    const rowItem = (id) => (isMail() ? mailById(id) : dirRows().find((s) => String(s.id) === String(id)) || null);

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
            if (!isMail()) { openDirectorRow(rowItem(row.dataset.id)); return; }
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
                    <label class="msg-field is-static"><span>From:</span><output class="msg-from-addr"></output></label>
                    <label class="msg-field"><span>To:</span><input name="to" type="text" inputmode="email" autocapitalize="off" spellcheck="false"></label>
                    <label class="msg-field is-cc" hidden><span>Cc:</span><input name="cc" type="text" inputmode="email" autocapitalize="off" spellcheck="false"></label>
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
        form.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
                const fields = [...p.querySelectorAll('.msg-form input, .msg-form textarea')].filter((x) => !x.closest('[hidden]'));
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
        const rows = isMail() ? sorted(mail) : dirRows();
        const at = rows.findIndex((m) => String(m.id) === String(selectedId));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
            if (rows[n]) selectRow(rows[n].id, true);
        } else if (e.key === 'Enter' && at >= 0) {
            e.preventDefault();
            if (several) toggleMulti(rows[at].id);
            else if (isMail()) openMessage(rows[at]);
            else openDirectorRow(rows[at]);
        } else if (e.key === 'Delete' && isMail() && targetIds().length) {
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

    window.wmMessaging = { openMail, showTree, closeTree, accountItems, goTo, setupAccount, mailAddress: () => mailAddress(), spellCheckField, loadSignature };

    // ---------------------------------------------------------------- registration

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
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
                // behind the picker the list loads without the wait cursor (nothing waits on it yet)
                loadFolder({ keep: pickerRoot || (isMail() ? mail.length : (dirLists[dirP] || []).length) > 0 });
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
