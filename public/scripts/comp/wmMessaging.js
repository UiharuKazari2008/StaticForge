/**
 * Melaton Mobile: Messaging, the Windows Mobile 6.1 Professional stock app (Outlook Mobile) over
 * Dreamscape's Dovecote mail, Yozora #709. Dovecote becomes Messaging on the phone (Yukimi's app
 * mapping): the same mailboxes and WS calls the desktop's Dovecote Express uses
 * (public/scripts/comp/desktop-apps/dovecote.js; server modules/ws/handlers/250-dovecoteHandler.js).
 *
 * Accounts: the signed-in person's mailbox (DESKTOP_DOVECOTE_HUMAN_OWNER) is the "Dovecote E-mail"
 * account, as Outlook E-mail is on the device; the agents' mailboxes are the other accounts of the
 * account picker. Those are read-only here, as on the desktop (the server writes only as the
 * person: every mark / move / delete / send acts on their own mailbox).
 *
 * Measured on the Device Emulator (VGA, 2x halved), Messaging's "Select an Account" page:
 *   header       23 px white, bold menu-text green caption at x 9, 1 px black rule under it
 *   rows         31 px with a 1 px #848284 rule at the bottom; 16 px icon at x 4, bold name at x 27
 *                (first line), a second normal line under it; the selected row is the highlight
 *                colour with white text. Soft keys Select / Menu (Options, Delete).
 * The message list, reading page and compose form follow Outlook Mobile 6.1: folder bar (the
 * folder drop-down at the left, the sort order at the right; Pictures & Videos' .wm-pv-bar), two
 * line rows (sender + date, subject; unread bold with the closed envelope), New / Menu on the list,
 * Reply / Menu on a message, Send / Menu on a new message (To, Cc, Subject, body).
 *
 * Layers: the list is the app's root; the account picker, folder list, message, new message and
 * Move are its own back steps (historyDepth / onBack), so the phone's back key retraces them.
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
    const HUMAN_ACCOUNT = 'Dovecote E-mail';
    // Outlook Mobile lists an account's folders alphabetically
    const FOLDERS = [
        { id: 'archive', label: 'Archive', icon: 'msg-folder-folder' },
        { id: 'deleted', label: 'Deleted Items', icon: 'msg-folder-deleted' },
        { id: 'inbox', label: 'Inbox', icon: 'msg-folder-inbox' },
        { id: 'spam', label: 'Junk E-mail', icon: 'msg-folder-folder' },
        { id: 'outbox', label: 'Outbox', icon: 'msg-folder-outbox' },
        { id: 'sent', label: 'Sent Items', icon: 'msg-folder-sent' }
    ];
    // Move targets and the mark patch that puts a message there (modules/dovecoteMail.js markMail)
    const MOVE_TARGETS = [
        { id: 'archive', patch: { archived: true } },
        { id: 'deleted', patch: { deleted: true } },
        { id: 'inbox', patch: { archived: false } },
        { id: 'spam', patch: { spam: true } }
    ];
    const SORTS = [['received', 'Received'], ['from', 'From'], ['subject', 'Subject']];

    let ws = null; // window.wmShell
    let page = null;
    let mailboxes = []; // [{ owner, label, unread, spamUnread }]
    let owner = null; // the account on screen
    let folder = 'inbox';
    let mail = [];
    let nextCursor = null;
    let hasMore = false;
    let loading = false;
    let loadingMore = false;
    let listError = '';
    let listToken = 0;
    let selectedId = null;
    let sortField = 'received';
    let layers = []; // back steps over the list: 'accounts' | 'folders' | 'read' | 'compose' | 'move'
    let reading = null; // the full message on the reading page
    let readToken = 0;
    let compose = null; // { mode, replyTo }
    let moveIds = [];
    let pickIndex = 0; // the highlighted row of the account picker / folder list / Move list
    let sending = false;

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
    const isMine = () => owner === human();
    const top = () => (layers.length ? layers[layers.length - 1] : 'list');
    const folderOf = (id) => FOLDERS.find((f) => f.id === id) || FOLDERS[2];
    const mailById = (id) => mail.find((m) => String(m.id) === String(id)) || null;
    const px = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;

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
        return t.toLowerCase().endsWith(DOMAIN) ? t.slice(0, -DOMAIN.length) : t;
    }).filter(Boolean);
    const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

    function boxLabel(o) {
        const box = mailboxes.find((b) => b.owner === o);
        if (box && box.label && box.label !== box.owner) return String(box.label).replace(/\s*\(you\)\s*$/, '');
        // a mailbox with no label of its own (wren, stylus): its name, capitalised
        const n = String(o || '');
        return n.charAt(0).toUpperCase() + n.slice(1);
    }

    /** The account's name as the picker and title bar give it. */
    function accountName(o) {
        return o === human() ? HUMAN_ACCOUNT : boxLabel(o);
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

    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    function fmtTime(d) {
        let h = d.getHours();
        const ap = h < 12 ? 'AM' : 'PM';
        h = h % 12 || 12;
        return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
    }
    const fmtShortDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;

    /** The list's date column: the time for today's mail, M/D/YY before that. */
    function listDate(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return sameDay(d, new Date()) ? fmtTime(d) : fmtShortDate(d);
    }

    function longDate(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
        return `${day} ${fmtShortDate(d)} ${fmtTime(d)}`;
    }

    // ---------------------------------------------------------------- data

    async function loadMailboxes() {
        try {
            const r = await send('dovecote_list_mailboxes', {});
            mailboxes = (r && (r.mailboxes || (r.data && r.data.mailboxes))) || [];
        } catch (_) { /* the picker keeps what it had */ }
        if (!owner || (owner !== human() && !mailboxes.some((b) => b.owner === owner))) owner = human();
        if (top() === 'accounts') renderAccounts();
        if (top() === 'folders') renderFolders();
        renderBar();
    }

    function sorted(list) {
        const out = list.slice();
        if (sortField === 'from') out.sort((a, b) => senderText(a).localeCompare(senderText(b), undefined, { sensitivity: 'base' }) || (b.createdAt > a.createdAt ? 1 : -1));
        else if (sortField === 'subject') out.sort((a, b) => String(a.subject || '').localeCompare(String(b.subject || ''), undefined, { sensitivity: 'base' }) || (b.createdAt > a.createdAt ? 1 : -1));
        else out.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));
        return out;
    }

    async function loadFolder(opts = {}) {
        const token = ++listToken;
        loading = true;
        // a page of older mail in flight belongs to the old list: drop it and let loadMore run again
        loadingMore = false;
        listError = '';
        if (!opts.keep) { mail = []; hasMore = false; nextCursor = null; selectedId = null; renderList(); }
        const request = { folder, limit: Math.max(PAGE_LIMIT, opts.keep ? mail.length : 0) };
        if (!isMine()) request.viewAsOwner = owner;
        try {
            const r = await send('dovecote_list_mail', request);
            if (token !== listToken) return;
            mail = (r && r.mail) || [];
            nextCursor = (r && r.nextCursor) || null;
            hasMore = !!(r && r.hasMore);
            if (selectedId && !mailById(selectedId)) selectedId = null;
        } catch (err) {
            if (token !== listToken) return;
            mail = [];
            hasMore = false;
            listError = (err && err.message) || 'Could not load messages.';
        }
        loading = false;
        renderList();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    async function loadMore() {
        if (!hasMore || loadingMore || loading || !nextCursor) return;
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
        owner = o || human();
        folder = f || 'inbox';
        if (opts.popLayers) layers = [];
        if (isCurrent()) { ws.setTitle(titleText()); ws.syncHistory(); }
        showLayer();
        loadFolder();
    }

    /** dovecote_mark_mail for the person's own mail; ids[] is one round trip. */
    async function mark(ids, patch) {
        const list = (ids || []).map(String).filter(Boolean);
        if (!list.length || !isMine()) return false;
        try {
            await send('dovecote_mark_mail', Object.assign({ ids: list }, patch));
            return true;
        } catch (err) {
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || 'The message could not be changed.' });
            return false;
        }
    }

    async function setRead(ids, read) {
        if (!(await mark(ids, { read }))) return;
        ids.forEach((id) => {
            const m = mailById(id);
            if (m) m.read = read;
            if (reading && String(reading.id) === String(id)) reading.read = read;
        });
        renderList();
        loadMailboxes();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    async function deleteIds(ids) {
        if (!ids.length || !isMine()) return;
        if (folder === 'deleted') {
            const yes = await ws.messageBox({
                title: 'Messaging',
                icon: 'warning',
                text: ids.length === 1 ? 'The selected message will be permanently deleted. Continue?' : `The ${ids.length} selected messages will be permanently deleted. Continue?`,
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
                cancelValue: false
            });
            if (!yes) return;
        }
        const at = sorted(mail).findIndex((m) => String(m.id) === String(ids[0]));
        if (!(await mark(ids, { deleted: true }))) return;
        const gone = new Set(ids.map(String));
        mail = mail.filter((m) => !gone.has(String(m.id)));
        // the next message down takes the selection, as on the device
        const rest = sorted(mail);
        selectedId = rest.length ? String(rest[Math.min(Math.max(at, 0), rest.length - 1)].id) : null;
        if (top() === 'read') popLayer();
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
        if (top() === 'read') popLayer();
        const gone = new Set(ids.map(String));
        mail = mail.filter((m) => !gone.has(String(m.id)));
        if (gone.has(String(selectedId))) selectedId = null;
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
        for (let round = 0; round < 20; round++) {
            let ids = [];
            try {
                const r = await send('dovecote_list_mail', { folder: 'deleted', limit: 200 });
                ids = ((r && r.mail) || []).map((m) => String(m.id));
            } catch (_) { break; }
            if (!ids.length || !(await mark(ids, { deleted: true }))) break;
        }
        if (folder === 'deleted') loadFolder();
        loadMailboxes();
    }

    async function sendReceive() {
        await loadMailboxes();
        await loadFolder({ keep: true });
    }

    // ---------------------------------------------------------------- layers

    function pushLayer(kind) {
        if (top() === kind) return;
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
        showLayer();
        if (isCurrent()) ws.syncHistory();
        return true;
    }

    function titleText() {
        const t = top();
        if (t === 'accounts' || t === 'folders') return 'Messaging';
        if (t === 'move') return 'Move';
        return accountName(owner);
    }

    function showLayer() {
        if (!page) return;
        const t = top();
        page.querySelectorAll(':scope > .msg-view').forEach((v) => { v.hidden = v.dataset.view !== t; });
        if (t === 'list') { renderBar(); renderList(); }
        if (t === 'accounts') renderAccounts();
        if (t === 'folders') renderFolders();
        if (t === 'move') renderMove();
        if (isCurrent()) {
            ws.setTitle(titleText());
            ws.refreshSoftKeys();
        }
    }

    /** Back key: the open layer first (a new message with text asks first). */
    function goBack() {
        const t = top();
        if (t === 'list') return false;
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
        if (!btn) return;
        btn.querySelector('img').outerHTML = img(f.icon);
        btn.querySelector('.msg-folder-name').textContent = f.label;
        page.querySelector('.msg-sort span').textContent = (SORTS.find(([k]) => k === sortField) || SORTS[0])[1];
    }

    function rowHtml(m) {
        const id = esc(m.id);
        const out = folder === 'sent' || folder === 'outbox';
        const who = out ? listOf(m.to).map(personName).join('; ') : senderText(m);
        const unread = !m.read && !out;
        // a message with attachments has the envelope with the paper clip (its unread state is the bold)
        const icon = m.attachments && m.attachments.length ? 'msg-attach-mail' : (unread ? 'msg-unread' : 'msg-read');
        return `<div class="msg-row${unread ? ' is-unread' : ''}${String(selectedId) === String(m.id) ? ' is-selected' : ''}" role="option" data-id="${id}" aria-selected="${String(selectedId) === String(m.id)}">
            <span class="msg-ico">${img(icon)}</span>
            <span class="msg-from">${esc(who || '(no sender)')}</span>
            <span class="msg-date">${esc(listDate(m.createdAt))}</span>
            <span class="msg-subj">${esc(m.subject || '(no subject)')}</span>
        </div>`;
    }

    function renderList() {
        if (!page) return;
        const list = page.querySelector('.msg-list');
        const empty = page.querySelector('.msg-empty');
        if (!list) return;
        const rows = sorted(mail);
        list.innerHTML = rows.map(rowHtml).join('') + (hasMore ? '<div class="msg-more">Loading...</div>' : '');
        let text = '';
        if (listError) text = listError;
        else if (loading && !rows.length) text = 'Loading...';
        else if (!rows.length) text = 'No messages.';
        empty.textContent = text;
        empty.hidden = !text;
    }

    function selectRow(id, scroll) {
        selectedId = id == null ? null : String(id);
        page.querySelectorAll('.msg-row').forEach((r) => {
            const on = r.dataset.id === selectedId;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
            if (on && scroll) r.scrollIntoView({ block: 'nearest' });
        });
        if (isCurrent()) ws.refreshSoftKeys();
    }

    const selectedMail = () => (selectedId ? mailById(selectedId) : null);

    function setSort(k) {
        sortField = k;
        try { localStorage.setItem(SORT_KEY, k); } catch (_) { /* storage off */ }
        renderBar();
        renderList();
    }

    function folderDropdownItems() {
        // the account's folders, then the other accounts (the device lists them under a rule)
        const items = [{ label: accountName(owner), indent: 0, action: () => pushLayer('folders') }];
        FOLDERS.forEach((f) => items.push({ label: f.label, indent: 1, radio: f.id === folder, action: () => switchTo(owner, f.id) }));
        const others = accountsInOrder().filter((o) => o !== owner);
        if (others.length) {
            items.push('-');
            others.forEach((o) => items.push({ label: accountName(o), action: () => switchTo(o, 'inbox') }));
        }
        return items;
    }

    function accountsInOrder() {
        const me = human();
        const rest = mailboxes.map((b) => b.owner).filter((o) => o !== me);
        return [me].concat(rest);
    }

    // ---------------------------------------------------------------- account picker / folder list / Move

    function pickRows(view, rows) {
        const host = page.querySelector(`.msg-view[data-view="${view}"] .msg-pick`);
        if (pickIndex < 0) pickIndex = Math.max(0, rows.findIndex((r) => r.current));
        pickIndex = Math.max(0, Math.min(rows.length - 1, pickIndex));
        host.innerHTML = rows.map((r, n) => `<div class="msg-pick-row${r.two ? ' is-two' : ''}${n === pickIndex ? ' is-selected' : ''}" role="option" data-n="${n}" style="--indent:${r.indent || 0}">
            <span class="msg-ico">${img(r.icon)}</span>
            <span class="msg-pick-name">${esc(r.name)}</span>
            ${r.two ? `<span class="msg-pick-sub">${esc(r.sub || '')}</span>` : ''}
        </div>`).join('');
        host._rows = rows;
    }

    function renderAccounts() {
        const me = human();
        const rows = accountsInOrder().map((o) => {
            const box = mailboxes.find((b) => b.owner === o);
            const unread = box ? box.unread || 0 : 0;
            return {
                two: true,
                icon: o === me ? 'msg-acct-outlook' : 'msg-acct-mail',
                name: `${accountName(o)}${unread ? ` (${unread})` : ''}`,
                sub: address(o),
                current: o === owner,
                go: () => switchTo(o, 'inbox', { popLayers: true })
            };
        });
        pickRows('accounts', rows);
    }

    function renderFolders() {
        const box = mailboxes.find((b) => b.owner === owner);
        const rows = [{ icon: 'msg-folder-account', name: accountName(owner), indent: 0, go: () => null }];
        FOLDERS.forEach((f) => {
            let n = 0;
            if (box && f.id === 'inbox') n = box.unread || 0;
            if (box && f.id === 'spam') n = box.spamUnread || 0;
            rows.push({ icon: f.icon, name: `${f.label}${n ? ` (${n})` : ''}`, indent: 1, current: f.id === folder, go: () => switchTo(owner, f.id, { popLayers: true }) });
        });
        pickRows('folders', rows);
    }

    function renderMove() {
        const first = (MOVE_TARGETS.find((t) => t.id !== folder) || MOVE_TARGETS[0]).id;
        const rows = MOVE_TARGETS.map((t) => {
            const f = folderOf(t.id);
            return { icon: f.icon, name: f.label, indent: 1, current: t.id === first, go: () => moveTo(t.id) };
        });
        rows.unshift({ icon: 'msg-folder-account', name: accountName(owner), indent: 0, go: () => null });
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

    // ---------------------------------------------------------------- reading page

    async function openMessage(m) {
        if (!m) return;
        selectedId = String(m.id);
        const token = ++readToken;
        reading = Object.assign({}, m);
        pushLayer('read');
        renderRead(true);
        const request = { id: m.id };
        // an agent's mailbox is only looked at: its unread mail stays unread for the agent
        if (!isMine()) { request.viewAsOwner = owner; request.markRead = false; }
        try {
            const r = await send('dovecote_get_mail', request, true);
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

    function renderRead(pending) {
        const view = page.querySelector('.msg-view[data-view="read"]');
        const m = reading;
        if (!m) { view.querySelector('.msg-read').innerHTML = ''; return; }
        const to = listOf(m.to).map(personName).join('; ');
        const cc = listOf(m.cc).map(personName).join('; ');
        const att = (m.attachments || []).map((a) => `<div class="msg-att">${img('msg-attachment')}<span>${esc(a.name || 'attachment')}</span></div>`).join('');
        view.querySelector('.msg-read').innerHTML = `
            <div class="msg-hdr">
                <div class="msg-hdr-from">${esc(senderText(m))}</div>
                <div class="msg-hdr-line"><span class="msg-hdr-k">To:</span> ${esc(to)}</div>
                ${cc ? `<div class="msg-hdr-line"><span class="msg-hdr-k">Cc:</span> ${esc(cc)}</div>` : ''}
                <div class="msg-hdr-subj">${esc(m.subject || '(no subject)')}</div>
                <div class="msg-hdr-line">${esc(longDate(m.createdAt))}</div>
            </div>
            ${att ? `<div class="msg-atts">${att}</div>` : ''}
            <div class="msg-body"></div>`;
        const body = view.querySelector('.msg-body');
        if (m.loadError) { body.textContent = m.loadError; return; }
        if (pending || m.body == null) { body.textContent = m.format === 'html' ? bodyText({ format: 'html', body: m.snippet }) : (m.snippet || ''); return; }
        if (m.format === 'html') renderHtmlBody(body, m);
        else body.textContent = String(m.body || '');
        view.querySelector('.msg-read').scrollTop = 0;
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
                r = await send('dovecote_render_body', { id: m.id }, true);
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
        const fs = 12 * px();
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

    /** Outlook Mobile's quote under a reply or forward. */
    function quoted(m) {
        return `\n\n-----Original Message-----\nFrom: ${address(m.from)}\nSent: ${longDate(m.createdAt)}\nTo: ${listOf(m.to).map(address).join('; ')}\n${listOf(m.cc).length ? `Cc: ${listOf(m.cc).map(address).join('; ')}\n` : ''}Subject: ${m.subject || ''}\n\n${bodyText(m)}`;
    }

    const prefixed = (pre, subject) => {
        const s = String(subject || '');
        return new RegExp(`^${pre}:`, 'i').test(s) ? s : `${pre}: ${s}`;
    };

    function newMessage(init = {}) {
        compose = { mode: init.mode || 'new', replyTo: init.replyTo || null, attachments: Array.isArray(init.attachments) ? init.attachments : [] };
        const view = page.querySelector('.msg-view[data-view="compose"]');
        const atts = view.querySelector('.msg-compose-atts');
        atts.innerHTML = compose.attachments.map((a) => `<div class="msg-att">${img('msg-attachment')}<span>${esc(a.name || 'attachment')}</span></div>`).join('');
        atts.hidden = !compose.attachments.length;
        view.querySelector('.msg-from-addr').textContent = address(human());
        view.querySelector('[name="to"]').value = init.to || '';
        view.querySelector('[name="cc"]').value = init.cc || '';
        view.querySelector('[name="subject"]').value = init.subject || '';
        const body = view.querySelector('[name="body"]');
        body.value = init.body || '';
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
                const r = await send('dovecote_get_mail', { id: m.id, markRead: false }, true);
                if (r && r.mail) full = r.mail;
            } catch (_) { /* the quote has no body */ }
        }
        const me = human();
        if (kind === 'forward') {
            newMessage({ mode: 'forward', subject: prefixed('FW', full.subject), body: quoted(full) });
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
        return !!(f.to.trim() || f.cc.trim() || f.subject.trim() || f.body.trim());
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
        if (compose.attachments.length) request.attachments = compose.attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, base64: a.base64 }));
        sending = true;
        if (isCurrent()) ws.refreshSoftKeys();
        try {
            await send('dovecote_send_mail', request, true);
        } catch (err) {
            sending = false;
            if (isCurrent()) ws.refreshSoftKeys();
            await ws.messageBox({ title: 'Messaging', icon: 'error', text: (err && err.message) || 'The message could not be sent.' });
            return;
        }
        sending = false;
        popLayer();
        if (top() === 'read') popLayer();
        if (folder === 'sent' || folder === 'outbox' || owner === human()) loadFolder({ keep: true });
        loadMailboxes();
    }

    /** Menu > Add Recipient...: the Dreamscape mailboxes, as Contacts would list them. */
    function addRecipientItems() {
        return accountsInOrder().filter((o) => o !== human()).map((o) => ({
            label: `${boxLabel(o)} <${address(o)}>`,
            action: () => {
                const input = page.querySelector('.msg-view[data-view="compose"] [name="to"]');
                const now = input.value.trim().replace(/[;,]\s*$/, '');
                input.value = now ? `${now}; ${address(o)}` : address(o);
            }
        }));
    }

    function checkNames() {
        const view = page.querySelector('.msg-view[data-view="compose"]');
        ['to', 'cc'].forEach((n) => {
            const input = view.querySelector(`[name="${n}"]`);
            input.value = bare(input.value).map(address).join('; ');
        });
    }

    // ---------------------------------------------------------------- menus

    function respondItems(m) {
        const can = !!m && isMine();
        return [
            { label: 'Reply', disabled: !can, action: () => respond('reply', m) },
            { label: 'Reply All', disabled: !can, action: () => respond('replyAll', m) },
            { label: 'Forward', disabled: !can, action: () => respond('forward', m) }
        ];
    }

    function goToItems() {
        return accountsInOrder().map((o) => ({ label: accountName(o), radio: o === owner, action: () => switchTo(o, 'inbox', { popLayers: true }) }));
    }

    function listMenu() {
        const m = selectedMail();
        const mine = isMine();
        return [
            { label: 'Delete', disabled: !m || !mine, action: () => deleteIds([String(m.id)]) },
            { label: 'Reply/Send', submenu: () => respondItems(m) },
            m && m.read
                ? { label: 'Mark as Unread', disabled: !mine, action: () => setRead([String(m.id)], false) }
                : { label: 'Mark as Read', disabled: !m || !mine, action: () => setRead([String(m.id)], true) },
            { label: 'Move...', disabled: !m || !mine, action: () => openMove([String(m.id)]) },
            '-',
            { label: 'Folders', action: () => pushLayer('folders') },
            { label: 'Go To', submenu: goToItems },
            { label: 'Send/Receive', action: sendReceive },
            '-',
            { label: 'Tools', submenu: () => [
                { label: 'Switch Accounts...', action: () => pushLayer('accounts') },
                { label: 'Empty Deleted Items', disabled: !mine, action: emptyDeleted }
            ] }
        ];
    }

    function contextMenu(m) {
        const mine = isMine();
        if (!m) return [{ label: 'Send/Receive', action: sendReceive }, { label: 'Folders', action: () => pushLayer('folders') }];
        return [
            { label: 'Delete', disabled: !mine, action: () => deleteIds([String(m.id)]) },
            '-',
            ...respondItems(m),
            '-',
            m.read
                ? { label: 'Mark as Unread', disabled: !mine, action: () => setRead([String(m.id)], false) }
                : { label: 'Mark as Read', disabled: !mine, action: () => setRead([String(m.id)], true) },
            { label: 'Move...', disabled: !mine, action: () => openMove([String(m.id)]) }
        ];
    }

    function readMenu() {
        const m = reading;
        const mine = isMine();
        const rows = sorted(mail);
        const at = m ? rows.findIndex((x) => String(x.id) === String(m.id)) : -1;
        return [
            { label: 'Reply All', disabled: !m || !mine, action: () => respond('replyAll', m) },
            { label: 'Forward', disabled: !m || !mine, action: () => respond('forward', m) },
            '-',
            { label: 'Delete', disabled: !m || !mine, action: () => deleteIds([String(m.id)]) },
            { label: 'Mark as Unread', disabled: !m || !mine, action: async () => { await setRead([String(m.id)], false); popLayer(); } },
            { label: 'Move...', disabled: !m || !mine, action: () => openMove([String(m.id)]) },
            '-',
            { label: 'Previous', disabled: at <= 0, action: () => readSibling(-1) },
            { label: 'Next', disabled: at < 0 || at >= rows.length - 1, action: () => readSibling(1) }
        ];
    }

    function composeMenu() {
        const people = addRecipientItems();
        return [
            { label: 'Add Recipient...', disabled: !people.length, submenu: () => people },
            { label: 'Check Names', action: checkNames },
            '-',
            { label: 'Insert', disabled: true },
            { label: 'My Text', disabled: true },
            { label: 'Spell Check', disabled: true },
            '-',
            { label: 'Save to Drafts', disabled: true },
            { label: 'Cancel Message', action: () => { if (composeDirty()) confirmCancelCompose(); else popLayer(); } }
        ];
    }

    function softKeys() {
        const t = top();
        if (t === 'accounts') {
            return {
                left: { label: 'Select', action: () => pickActivate('accounts', pickIndex) },
                right: { label: 'Menu', menu: () => [{ label: 'Options', disabled: true }, { label: 'Delete', disabled: true }] }
            };
        }
        if (t === 'folders') {
            return {
                left: { label: 'Select', action: () => pickActivate('folders', pickIndex) },
                right: { label: 'Menu', menu: () => [{ label: 'Switch Accounts...', action: () => { layers.pop(); pushLayer('accounts'); } }, { label: 'Empty Deleted Items', disabled: !isMine(), action: emptyDeleted }] }
            };
        }
        if (t === 'move') {
            return { left: { label: 'Cancel', action: popLayer }, right: { label: 'Select', action: () => pickActivate('move', pickIndex) } };
        }
        if (t === 'read') {
            return { left: { label: 'Reply', disabled: !reading || !isMine(), action: () => respond('reply', reading) }, right: { label: 'Menu', menu: readMenu } };
        }
        if (t === 'compose') {
            return { left: { label: 'Send', disabled: sending, action: sendCompose }, right: { label: 'Menu', menu: composeMenu } };
        }
        return { left: { label: 'New', action: () => newMessage() }, right: { label: 'Menu', menu: listMenu } };
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
            ws.menuAt(x, y, contextMenu(row ? mailById(row.dataset.id) : null));
        };
        scroll.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            held = false;
            suppressClick = false;
            start = { x: e.clientX, y: e.clientY };
            const row = e.target.closest('.msg-row');
            clear();
            timer = setTimeout(() => hold(start.x, start.y, row), 550);
        });
        scroll.addEventListener('pointermove', (e) => {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8 * px()) clear();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => scroll.addEventListener(t, clear));
        scroll.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (held) return;
            hold(e.clientX, e.clientY, e.target.closest('.msg-row'));
        });
        scroll.addEventListener('click', (e) => {
            if (held) { held = false; return; }
            const row = e.target.closest('.msg-row');
            if (!row) return;
            selectRow(row.dataset.id);
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
                    <button type="button" class="wm-pv-folder msg-folder" aria-haspopup="menu" aria-expanded="false">${img('msg-folder-inbox')}<span class="msg-folder-name">Inbox</span><i class="wm-pv-arrow"></i></button>
                    <button type="button" class="wm-pv-sort msg-sort" aria-haspopup="menu" aria-expanded="false"><span>Received</span><i class="wm-pv-arrow"></i></button>
                </div>
                <div class="msg-scroll"><div class="msg-list" role="listbox" aria-label="Messages"></div><p class="msg-empty" hidden></p></div>
            </div>
            <div class="msg-view" data-view="accounts" hidden>
                <div class="msg-head">Select an Account</div>
                <div class="msg-pick" role="listbox" aria-label="Accounts"></div>
            </div>
            <div class="msg-view" data-view="folders" hidden>
                <div class="msg-head">Folders</div>
                <div class="msg-pick is-tree" role="listbox" aria-label="Folders"></div>
            </div>
            <div class="msg-view" data-view="move" hidden>
                <div class="msg-head">Move to folder:</div>
                <div class="msg-pick is-tree" role="listbox" aria-label="Folders"></div>
            </div>
            <div class="msg-view" data-view="read" hidden>
                <div class="msg-read"></div>
            </div>
            <div class="msg-view" data-view="compose" hidden>
                <form class="msg-form" autocomplete="off" onsubmit="return false">
                    <label class="msg-field is-static"><span>From:</span><output class="msg-from-addr"></output></label>
                    <label class="msg-field"><span>To:</span><input name="to" type="text" inputmode="email" autocapitalize="off" spellcheck="false"></label>
                    <label class="msg-field"><span>Cc:</span><input name="cc" type="text" inputmode="email" autocapitalize="off" spellcheck="false"></label>
                    <label class="msg-field"><span>Subject:</span><input name="subject" type="text"></label>
                    <div class="msg-atts msg-compose-atts" hidden></div>
                    <textarea name="body" class="msg-text" aria-label="Message" spellcheck="false"></textarea>
                </form>
            </div>`;
        onListPointer(p.querySelector('.msg-scroll'));
        const folderBtn = p.querySelector('.msg-folder');
        folderBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            folderBtn.setAttribute('aria-expanded', 'true');
            folderBtn.querySelector('.msg-folder-name').textContent = 'Show';
            ws.dropdown(folderBtn, folderDropdownItems(), 'left', () => { folderBtn.setAttribute('aria-expanded', 'false'); renderBar(); });
        });
        const sortBtn = p.querySelector('.msg-sort');
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sortBtn.setAttribute('aria-expanded', 'true');
            sortBtn.querySelector('span').textContent = 'Sort By';
            ws.dropdown(sortBtn, SORTS.map(([k, label]) => ({ label, radio: sortField === k, action: () => setSort(k) })), 'right', () => { sortBtn.setAttribute('aria-expanded', 'false'); renderBar(); });
        });
        p.querySelectorAll('.msg-pick').forEach((host) => {
            host.addEventListener('click', (e) => {
                const row = e.target.closest('.msg-pick-row');
                if (!row) return;
                pickActivate(host.closest('.msg-view').dataset.view, Number(row.dataset.n));
            });
        });
        p.querySelector('.msg-form').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
                const fields = [...p.querySelectorAll('.msg-form input, .msg-form textarea')];
                const next = fields[fields.indexOf(e.target) + 1];
                if (next) next.focus();
            }
        });
        document.addEventListener('keydown', onKey);
        document.addEventListener('dovecoteMailboxUpdated', onMailboxUpdated);
    }

    function onKey(e) {
        if (!isCurrent()) return;
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        const layer = document.querySelector('#wmShell .wm-msgbox-layer');
        if (layer && !layer.hidden) return;
        if (document.querySelector('#wmShell > .wm-popup:not([hidden]), #wmShell > .wm-startmenu:not([hidden])')) return;
        const t = top();
        if (t === 'accounts' || t === 'folders' || t === 'move') {
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
        const rows = sorted(mail);
        const at = rows.findIndex((m) => String(m.id) === String(selectedId));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
            if (rows[n]) selectRow(rows[n].id, true);
        } else if (e.key === 'Enter' && at >= 0) {
            e.preventDefault();
            openMessage(rows[at]);
        } else if (e.key === 'Delete' && at >= 0) {
            e.preventDefault();
            deleteIds([String(rows[at].id)]);
        }
    }

    // dovecote.js re-dispatches the server's dovecote_mailbox_updated push as this event
    let pushTimer = null;
    function onMailboxUpdated(ev) {
        const data = ev && ev.detail;
        if (data && Array.isArray(data.mailboxes)) {
            mailboxes = data.mailboxes;
            if (top() === 'accounts') renderAccounts();
            if (top() === 'folders') renderFolders();
        }
        if (!page) return;
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

    /**
     * Other apps hand a new message to Messaging (Contacts' Send e-mail / Send Text Message,
     * Send Contact > E-mail...): { to: [addresses], subject, body, attachments: [{ name, mimeType, base64 }] }.
     * Back from the form returns to the app that asked.
     */
    function composeFromApp(init = {}) {
        if (!ws) return;
        ws.open(APP_ID);
        if (!page) return;
        const to = (Array.isArray(init.to) ? init.to : (init.to ? [init.to] : [])).map((t) => String(t).trim()).filter(Boolean);
        layers = [];
        if (reading) { reading = null; readToken++; }
        compose = null;
        newMessage({ to: to.join('; '), subject: init.subject || '', body: init.body || '', attachments: init.attachments });
    }
    window.wmMessagingCompose = composeFromApp;

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
                showLayer();
                loadMailboxes();
                loadFolder({ keep: mail.length > 0 });
            },
            hide() {
                clearTimeout(pushTimer);
            },
            // the title bar's X steps out of a message or form first; on the list it closes the app
            onTitleAction() {
                if (top() === 'list') return true;
                goBack();
                return false;
            },
            historyDepth: () => layers.length,
            onBack: () => goBack(),
            softKeys
        });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
