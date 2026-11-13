/**
 * Melaton Mobile: Text Messaging, Messaging's text message accounts (Yozora #779): iMessage through
 * BlueBubbles today, RCS later, N accounts, all through window.textMessaging
 * (public/scripts/comp/textMessagingClient.js, server modules/textMessaging.js).
 *
 * Drawn as the device's own Text Messages, the look wmChat.js (Dreamscape Messenger) already
 * reproduces from Yukimi's screenshots (tmp/wmss 173927-174305): this page carries .wm-chat too and
 * reuses its classes (wm-chat.css: the folder bar, the conversation rows, the threaded conversation,
 * the reply box, and 6.5's list measures); what text messages add is in wm-textmessaging.css.
 *
 *   list          the folder bar (folder tree from Messaging: wmMessaging.showTree with acct 'tm:<id>'),
 *                 the conversations (envelope, title, date, size, the last line; unread bold; group
 *                 chats with the sender before the line), the status line. Soft keys Reply / Menu.
 *                 Folders: Inbox (known chats), Sent Items (chats you wrote in last), Unknown Senders.
 *   conversation  "Conversation with <title>", Older, each message "Name (date):" over its text, the
 *                 quote of the message it replies to, pictures / videos inline (tap: full size),
 *                 other files as a row that downloads, tapbacks under the text, "(Edited)", "This
 *                 message was unsent.", "Read 10:42" / "Delivered" under your last message, "<name>
 *                 is typing..." at the end. The reply box at the bottom. Soft keys Send / Menu.
 *   new message   To: and the text (Send); a chat that already exists with that one address opens.
 *   picture       the full-size picture or video (ok goes back).
 * Commands the account's features{} lacks (tapbacks, edit, unsend, reply, typing, attachments,
 * newChat) are not offered.
 *
 * window.wmTextMessaging = { showAccount(accountId, folder), openChat(accountId, chatGuid),
 *   compose(accountId, addresses), accounts() }: accounts() is the last list read (synchronous; it
 *   also starts a fresh read), the others open this app. Only on phones.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'textmessaging';
    const TITLE = 'Text Messaging';
    const SORT_KEY = 'wmTmSort';
    const PAGE = 50;
    // alphabetical, as Outlook Mobile lists an account's folders
    const FOLDERS = [
        { id: 'inbox', label: 'Inbox', icon: 'msg-folder-inbox' },
        { id: 'sent', label: 'Sent Items', icon: 'msg-folder-outbox' },
        { id: 'unknown', label: 'Unknown Senders', icon: 'msg-folder-folder' }
    ];
    const MY_TEXT = ['Yes.', 'No.', 'I\'m running late.', 'Where are you?', 'Can you talk?', 'Call me.', 'Thank you.', 'I\'ll be there.', 'Talk to you later.', 'I love you.'];
    const TYPING_MS = 15000; // a typing line with no "stopped" goes after this

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const stored = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const store = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
    // read at call time: a test tab swaps in a stand-in after load
    const tm = () => window.textMessaging || null;

    let sh = null; // window.wmShell
    let page = null;
    let accts = []; // the accounts as last read
    let accountId = null; // the account on screen
    let folder = 'inbox';
    let chats = [];
    let loaded = false;
    let listError = '';
    let listTok = 0;
    let selectedGuid = null;
    let sort = stored(SORT_KEY) === 'name' ? 'name' : 'date';

    let layers = []; // 'conv' | 'new' | 'media'
    let conv = null; // { accountId, guid, chat, messages: [], more, unreadFrom }
    let convTok = 0;
    let selMsg = null; // the selected message's guid
    let replyTo = null; // the message the reply box answers (guid)
    let media = null; // the attachment in the picture view
    let newDraft = null; // { to, text }
    let localN = 0;
    const typingIn = new Map(); // chatGuid -> timer while the other side types
    let wiredTo = null;

    const PAIR_NOTE = 'Pair this account on your computer: Control Panel > Dreamscape CardSpace.';
    const unpaired = (a) => !!(a && (a.status === 'unpaired' || a.status === 'pairing'));
    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const acctById = (id) => accts.find((a) => a.id === id) || null;
    const acct = () => acctById(accountId);
    const feat = (k, a) => { const x = a || acct(); return !!(x && x.features && x.features[k]); };
    const folderOf = (id) => FOLDERS.find((f) => f.id === id) || FOLDERS[0];
    const msgByGuid = (g) => (conv ? conv.messages.find((m) => m.guid === g) : null) || null;
    const chatByGuid = (g) => chats.find((c) => c.guid === g) || null;

    // ---------------------------------------------------------------- helpers

    function toMs(v) {
        if (v == null || v === '') return 0;
        if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    }

    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    function fmtTime(d) {
        let h = d.getHours();
        const ap = h < 12 ? 'AM' : 'PM';
        h = h % 12 || 12;
        return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
    }
    /** Outlook Mobile's list column: the time today, M/D/YY before. */
    function listDate(v) {
        const ms = toMs(v);
        if (!ms) return '';
        const d = new Date(ms);
        return sameDay(d, new Date()) ? fmtTime(d) : `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
    }
    /** "(10/19)" for an earlier day, "(4:50 PM)" today, as the thread's headers give it. */
    function headDate(v) {
        const ms = toMs(v);
        if (!ms) return '';
        const d = new Date(ms);
        return sameDay(d, new Date()) ? fmtTime(d) : `${d.getMonth() + 1}/${d.getDate()}`;
    }

    const normAddr = (a) => {
        const s = String(a || '').trim().toLowerCase();
        if (s.includes('@')) return s;
        const digits = s.replace(/[^\d]/g, '');
        return digits.length > 10 ? digits.slice(-10) : digits;
    };

    function chatTitle(c) {
        if (!c) return '';
        if (c.title) return c.title;
        const p = (c.participants || []).map((x) => x.name || x.address).filter(Boolean);
        return p.join(', ') || c.identifier || 'Conversation';
    }

    function senderName(m, c) {
        if (!m) return '';
        if (m.fromMe) return 'Me';
        const s = m.sender || {};
        if (s.name) return s.name;
        const chat = c || (conv && conv.chat);
        const p = chat && (chat.participants || []).find((x) => normAddr(x.address) === normAddr(s.address));
        return (p && p.name) || s.address || chatTitle(chat);
    }

    const isImage = (a) => /^image\//i.test(a.mime || '') || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name || '');
    const isVideo = (a) => /^video\//i.test(a.mime || '') || /\.(mov|mp4|m4v|webm)$/i.test(a.name || '');
    const isAudio = (a) => /^audio\//i.test(a.mime || '') || /\.(caf|m4a|mp3|amr)$/i.test(a.name || '');
    function attLabel(a) {
        if (isImage(a)) return 'Picture';
        if (isVideo(a)) return 'Video';
        if (isAudio(a)) return 'Voice Note';
        return a.name || 'Attachment';
    }
    function sizeText(n) {
        const b = Number(n) || 0;
        if (b >= 1048576) return `${(b / 1048576).toFixed(1)}M`;
        return `${Math.max(1, Math.ceil(b / 1024))}K`;
    }

    function groupEventText(m) {
        const g = m.groupEvent;
        if (typeof g === 'string') return g;
        if (g && typeof g === 'object') return g.text || g.description || '';
        return '';
    }

    /** A message as one line (the list's last line, a quote). */
    function summary(m, c, withSender) {
        if (!m) return '';
        let t = m.retracted ? 'This message was unsent.' : String(m.text || '').replace(/\s+/g, ' ').trim();
        if (!t && m.groupEvent) t = groupEventText(m);
        const atts = m.attachments || [];
        if (!t && atts.length) t = attLabel(atts[0]) + (atts.length > 1 ? ` (+${atts.length - 1})` : '');
        if (withSender && !m.fromMe && !m.groupEvent) t = `${senderName(m, c)}: ${t}`;
        return t;
    }

    async function errorBox(text, err) {
        const why = err && err.message ? `\n\n${err.message}` : '';
        if (sh) await sh.messageBox({ title: TITLE, icon: 'error', text: `${text}${why}` });
    }

    // ---------------------------------------------------------------- events

    const EVENTS = {
        message: (d) => onMessage(d, false),
        updated: (d) => onMessage(d, true),
        reaction: (d) => onReaction(d),
        typing: (d) => onTyping(d),
        read: (d) => onRead(d),
        chat: (d) => onChat(d),
        account: () => { loadAccounts(true).then(() => { if (page) { showLayer(); if (view() === 'list') refresh({ quiet: true }); } }); },
        resync: (d) => { if (d && d.accountId && d.accountId !== accountId) return; if (page && loaded) refresh({ quiet: true }); if (conv) reloadConv(); }
    };

    /** Listen to window.textMessaging, again when a different one took its place. */
    function wire() {
        const t = tm();
        if (!t || t === wiredTo || typeof t.on !== 'function') return;
        if (wiredTo && typeof wiredTo.off === 'function') Object.entries(EVENTS).forEach(([e, fn]) => wiredTo.off(e, fn));
        Object.entries(EVENTS).forEach(([e, fn]) => t.on(e, fn));
        wiredTo = t;
    }

    function onMessage(d, updated) {
        if (!d || !d.message) return;
        const m = d.message;
        const g = d.chatGuid || m.chatGuid;
        if (d.accountId === accountId) {
            const c = chatByGuid(g);
            const open = !!(conv && conv.guid === g && conv.accountId === d.accountId && view() !== 'list');
            if (c) {
                if (!updated) {
                    c.last = m;
                    if (!m.fromMe && !open) c.unread = true;
                    chats = [c].concat(chats.filter((x) => x !== c));
                } else if (c.last && c.last.guid === m.guid) {
                    c.last = m;
                }
                if (view() === 'list') renderList();
            } else if (!updated && loaded && page) {
                refresh({ quiet: true });
            }
        }
        if (!conv || conv.accountId !== d.accountId || conv.guid !== g) return;
        const list = conv.messages;
        let at = list.findIndex((x) => x.guid === m.guid);
        // our own send: the server's copy takes the place of the one Send put up
        if (at < 0 && m.fromMe) at = list.findIndex((x) => x._local && String(x.text || '') === String(m.text || '') && (x.attachments || []).length === (m.attachments || []).length);
        if (at >= 0) list[at] = m;
        else if (!updated) list.push(m);
        else return;
        if (!m.fromMe) stopTyping(g);
        renderEntries();
        if (!updated && !m.fromMe && isCurrent() && view() === 'conv' && document.visibilityState !== 'hidden') markRead();
    }

    function onReaction(d) {
        if (!d || !conv || conv.accountId !== d.accountId || conv.guid !== d.chatGuid) return;
        const m = msgByGuid(d.targetGuid);
        const r = d.reaction;
        if (!m || !r) return;
        const who = (x) => (x.fromMe ? 'me' : normAddr(x.sender && x.sender.address));
        m.reactions = (m.reactions || []).filter((x) => who(x) !== who(r));
        if (!r.removed) m.reactions.push(r);
        renderEntries();
    }

    function stopTyping(g) {
        clearTimeout(typingIn.get(g));
        typingIn.delete(g);
    }

    function onTyping(d) {
        if (!d || d.accountId !== accountId) return;
        stopTyping(d.chatGuid);
        if (d.typing) typingIn.set(d.chatGuid, setTimeout(() => { typingIn.delete(d.chatGuid); paintTyping(); }, TYPING_MS));
        paintTyping();
    }

    function onRead(d) {
        if (!d || d.accountId !== accountId) return;
        const c = chatByGuid(d.chatGuid);
        if (c) { c.unread = !d.read; if (view() === 'list') renderList(); }
    }

    function onChat(d) {
        if (!d || d.accountId !== accountId) return;
        const t = tm();
        if (!t || !d.chatGuid) { if (loaded) refresh({ quiet: true }); return; }
        t.chat(accountId, d.chatGuid).then((c) => {
            if (!c) return;
            const at = chats.findIndex((x) => x.guid === c.guid);
            if (at >= 0) chats[at] = Object.assign({}, chats[at], c);
            if (conv && conv.guid === c.guid) { conv.chat = Object.assign({}, conv.chat, c); renderEntries(); }
            if (view() === 'list') renderList();
        }, () => {});
    }

    // ---------------------------------------------------------------- data

    async function loadAccounts(force) {
        wire();
        const t = tm();
        if (!t) return accts;
        try {
            const d = await t.accounts(force);
            accts = (d && d.accounts) || [];
        } catch (_) { /* keeps the last list */ }
        if (accountId && !acctById(accountId)) accountId = null;
        if (!accountId && accts.length) accountId = accts[0].id;
        return accts;
    }

    async function loadChats() {
        const t = tm();
        const id = accountId;
        const tok = ++listTok;
        if (!t || !id) { chats = []; loaded = true; return; }
        const f = folder;
        // the logon step's snapshot draws the Inbox at once; the full list follows
        const snap = typeof t.snapshot === 'function' ? t.snapshot() : null;
        if (f === 'inbox' && !chats.length && snap && snap.inbox && snap.inbox[id]) {
            chats = snap.inbox[id].slice();
            loaded = true;
            try { renderList(); } catch (_) { /* drawn after the read */ }
        }
        const d = await t.chats(id, { folder: f === 'sent' ? 'all' : f, limit: 200 });
        if (tok !== listTok || id !== accountId || f !== folder) return;
        let list = (d && d.chats) || [];
        if (f === 'sent') list = list.filter((c) => c.last && c.last.fromMe);
        chats = list;
        loaded = true;
        listError = '';
    }

    async function refresh(opts = {}) {
        const work = async () => {
            if (!accts.length || opts.accounts) await loadAccounts(!!opts.accounts);
            await loadChats();
        };
        try {
            if (opts.quiet || !sh) await work();
            else await sh.busy(work, { paint: true });
        } catch (err) {
            loaded = true;
            listError = (err && err.message) || 'The conversations could not be read.';
        }
        if (page && view() === 'list') renderList();
    }

    // ---------------------------------------------------------------- list

    function visibleChats() {
        const list = chats.slice();
        if (sort === 'name') {
            const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
            list.sort((a, b) => coll.compare(chatTitle(a), chatTitle(b)));
        } else {
            list.sort((a, b) => toMs(b.last && b.last.date) - toMs(a.last && a.last.date));
        }
        return list;
    }

    /** A conversation row as Dreamscape Messenger's (173927): envelope, title, date, size; the last line under it. */
    function rowHtml(c) {
        const sel = c.guid === selectedGuid;
        const unread = !!c.unread;
        const m = c.last;
        const bytes = m ? String(m.text || '').length + (m.attachments || []).reduce((n, a) => n + (Number(a.size) || 0), 0) : 0;
        return `<div class="wch-row wtm-row${sel ? ' is-selected' : ''}${unread ? ' is-unread' : ''}${c.isGroup ? ' is-group' : ''}" role="option" aria-selected="${sel}" data-guid="${esc(c.guid)}">`
            + `<span class="wch-ico" data-ico="${unread ? 'msg-unread' : 'msg-read'}"></span>`
            + `<span class="wch-namecell"><span class="wch-name">${esc(chatTitle(c))}</span></span>`
            + `<span class="wch-date">${esc(listDate(m && m.date))}</span><span class="wch-size">${sizeText(bytes)}</span>`
            + `<span class="wch-last">${esc(summary(m, c, c.isGroup))}</span></div>`;
    }

    function emptyText() {
        const a = acct();
        if (!tm()) return 'Text Messaging is not available.';
        if (!accts.length) return 'No Text Messaging account is set up. Set one up on the desktop in Control Panel > Dreamscape CardSpace.';
        if (listError) return listError;
        if (unpaired(a)) return PAIR_NOTE;
        if (a && a.status !== 'connected') return `${(a && a.name) || TITLE} is not connected${a.error ? `: ${a.error}` : '.'}`;
        if (folder === 'unknown') return 'No messages from unknown senders.';
        if (folder === 'sent') return 'No messages.';
        return feat('newChat') ? 'To start a conversation, tap Menu, then New.' : 'No messages.';
    }

    function renderList() {
        if (!page) return;
        // an RCS account not paired yet: only the note, no list
        const list = unpaired(acct()) ? [] : visibleChats();
        if (!selectedGuid || !list.some((c) => c.guid === selectedGuid)) selectedGuid = list.length ? list[0].guid : null;
        page.querySelector('.wch-list').innerHTML = list.map(rowHtml).join('');
        const empty = page.querySelector('.wch-empty');
        empty.hidden = !!list.length || !loaded;
        empty.textContent = emptyText();
        const n = selectedGuid ? 1 : 0;
        page.querySelector('.wch-status').textContent = `${n} conversation${n === 1 ? '' : 's'} selected`;
        const f = folderOf(folder);
        const name = page.querySelector('.wch-folder-name');
        if (name.textContent !== 'Show') name.textContent = f.label;
        page.querySelector('.wch-sort span').textContent = sort === 'name' ? 'From' : 'Received';
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function selectRow(g) {
        selectedGuid = g;
        page.querySelectorAll('.wtm-row').forEach((r) => {
            const on = r.dataset.guid === g;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    const selectedChat = () => (selectedGuid ? chatByGuid(selectedGuid) : null);

    function setFolder(f) {
        folder = FOLDERS.some((x) => x.id === f) ? f : 'inbox';
        chats = [];
        loaded = false;
        selectedGuid = null;
        renderList();
        refresh({ quiet: false });
    }

    function setSort(k) { sort = k; store(SORT_KEY, k); renderList(); }

    // ---------------------------------------------------------------- layers

    function showLayer() {
        if (!page) return;
        const v = view();
        page.querySelector('.wch-listview').hidden = v !== 'list';
        page.querySelector('.wch-convview').hidden = v !== 'conv';
        page.querySelector('.wtm-newview').hidden = v !== 'new';
        page.querySelector('.wtm-mediaview').hidden = v !== 'media';
        page.dataset.view = v;
        if (isCurrent()) {
            // the account's own name: Apple iMessage (BlueBubbles) or Text Messaging (RCS)
            sh.setTitle((acct() && acct().name) || TITLE);
            sh.refreshSoftKeys();
        }
    }

    function push(v) {
        layers.push(v);
        showLayer();
        sh.syncHistory();
    }

    function popLayer() {
        const v = layers.pop();
        if (v === 'conv') leaveConv();
        if (v === 'new') newDraft = null;
        if (v === 'media') { media = null; const box = page.querySelector('.wtm-media'); box.innerHTML = ''; }
        showLayer();
        if (view() === 'list') renderList();
    }

    function leaveConv() {
        if (conv && feat('typing')) { const t = tm(); if (t) t.typing(conv.accountId, conv.guid, false); }
        conv = null;
        selMsg = null;
        replyTo = null;
    }

    // ---------------------------------------------------------------- conversation

    async function openConversation(c, opts = {}) {
        if (!c) return;
        if (conv && conv.guid !== c.guid) leaveConv();
        const tok = ++convTok;
        conv = { accountId, guid: c.guid, chat: c, messages: [], more: false, unreadFrom: c.unread ? toMs(c.last && c.last.date) - 1 : Infinity };
        selectedGuid = c.guid;
        selMsg = null;
        replyTo = null;
        renderEntries();
        renderReply();
        const box = inputEl();
        box.value = '';
        fitInput();
        if (opts.replace) { layers = ['conv']; showLayer(); sh.syncHistory(); } else push('conv');
        try {
            await sh.busy(async () => {
                const t = tm();
                const d = await t.messages(accountId, c.guid, { limit: PAGE });
                if (tok !== convTok || !conv) return;
                conv.messages = (d && d.messages) || [];
                conv.more = !!(d && d.more);
                conv.cursor = (d && d.cursor) || null;
                // what arrived unread reads bold while the conversation is open
                if (c.unread) {
                    const lastMine = conv.messages.reduce((ms, m) => (m.fromMe ? Math.max(ms, toMs(m.date)) : ms), 0);
                    const firstNew = conv.messages.find((m) => !m.fromMe && !m.dateRead && toMs(m.date) > lastMine);
                    conv.unreadFrom = firstNew ? toMs(firstNew.date) - 1 : Infinity;
                }
            }, { paint: true });
        } catch (err) { errorBox('The conversation could not be read.', err); }
        if (tok !== convTok) return;
        renderEntries(true);
        markRead();
        if (isCurrent()) sh.refreshSoftKeys();
    }

    async function reloadConv() {
        if (!conv) return;
        const t = tm();
        const c = conv;
        try {
            const d = await t.messages(c.accountId, c.guid, { limit: Math.max(PAGE, c.messages.length) });
            if (conv !== c) return;
            c.messages = (d && d.messages) || [];
            c.more = !!(d && d.more);
            c.cursor = (d && d.cursor) || null;
            renderEntries();
        } catch (_) { /* the thread stays as it was */ }
    }

    function markRead() {
        if (!conv) return;
        const t = tm();
        const c = chatByGuid(conv.guid) || conv.chat;
        if (c) c.unread = false;
        if (t && typeof t.markRead === 'function') t.markRead(conv.accountId, conv.guid).catch(() => {});
    }

    async function loadOlder() {
        if (!conv || !conv.more) return;
        const t = tm();
        const c = conv;
        // the server's own cursor (opaque): never worked out here
        const before = c.cursor || (c.messages[0] ? c.messages[0].date : undefined);
        try {
            const d = await sh.busy(() => t.messages(c.accountId, c.guid, { limit: PAGE, before }), { paint: true });
            if (conv !== c) return;
            const have = new Set(c.messages.map((m) => m.guid));
            c.messages = ((d && d.messages) || []).filter((m) => !have.has(m.guid)).concat(c.messages);
            c.more = !!(d && d.more);
            c.cursor = (d && d.cursor) || null;
        } catch (err) { errorBox('Older messages could not be read.', err); }
        const box = page.querySelector('.wch-history');
        const fromEnd = box.scrollHeight - box.scrollTop;
        renderEntries();
        box.scrollTop = box.scrollHeight - fromEnd;
    }

    function quoteHtml(guid) {
        const o = msgByGuid(guid);
        const text = o ? summary(o, conv && conv.chat, false) : 'Earlier message';
        const who = o ? senderName(o) : '';
        return `<div class="wtm-quote" data-quote="${esc(guid)}">${who ? `<b>${esc(who)}:</b> ` : ''}${esc(text)}</div>`;
    }

    function attHtml(a, n, m) {
        const label = esc(a.name || attLabel(a));
        if ((isImage(a) || isVideo(a)) && (a.thumbUrl || (isImage(a) && a.url))) {
            return `<div class="wtm-att is-pic${isVideo(a) ? ' is-video' : ''}" data-msg="${esc(m.guid)}" data-att="${n}" role="button" aria-label="${label}">`
                + `<img src="${esc(a.thumbUrl || a.url)}" alt="" loading="lazy" draggable="false">${isVideo(a) ? '<i class="wtm-play"></i>' : ''}</div>`;
        }
        return `<div class="wtm-att is-file" data-msg="${esc(m.guid)}" data-att="${n}" role="button"><span class="wtm-att-ico"></span>`
            + `<span class="wtm-att-name">${label}</span><span class="wtm-att-size">${a.size ? sizeText(a.size) : ''}</span></div>`;
    }

    function tapbacksHtml(m) {
        const list = (m.reactions || []).filter((r) => r && !r.removed);
        if (!list.length) return '';
        const R = (tm() && tm().REACTIONS) || [];
        const by = new Map();
        for (const r of list) {
            // Google Messages (RCS) reacts with any emoji: type 'emoji' and the emoji itself
            const key = r.type === 'emoji' ? `emoji:${r.emoji || ''}` : r.type;
            if (!by.has(key)) by.set(key, []);
            by.get(key).push(r.fromMe ? 'Me' : senderName({ sender: r.sender }));
        }
        return `<div class="wtm-tapbacks">${[...by.entries()].map(([type, names]) => {
            const def = type.startsWith('emoji:') ? { glyph: type.slice(6) || '?', label: 'Reaction' } : (R.find((x) => x.type === type) || { glyph: type, label: type });
            return `<span class="wtm-tb" title="${esc(`${def.label}: ${names.join(', ')}`)}"><span class="wtm-tb-glyph">${esc(def.glyph)}</span>${names.length > 1 ? `<span class="wtm-tb-n">${names.length}</span>` : ''}</span>`;
        }).join('')}</div>`;
    }

    function receiptText(m) {
        if (m._upload) return `Sending ${Math.round((m._progress || 0) * 100)}%`;
        if (m.error) return '';
        if (m.sending || (m._local && m._sending)) return 'Sending...';
        if (m._local && !m.dateDelivered) return '';
        if (m.dateRead && feat('readReceipts')) return `Read ${headDate(m.dateRead)}`;
        if (m.dateDelivered) return 'Delivered';
        return '';
    }

    function entryHtml(m, n, lastMine) {
        if (m.groupEvent && !m.text) return `<div class="wtm-event" data-n="${n}">${esc(groupEventText(m))}</div>`;
        const unread = !m.fromMe && conv && toMs(m.date) > conv.unreadFrom;
        let body = '';
        if (m.replyTo) body += quoteHtml(m.replyTo);
        if (m.retracted) {
            body += '<div class="wch-says wtm-unsent">This message was unsent.</div>';
        } else {
            if (m.subject) body += `<div class="wtm-subject">${esc(m.subject)}</div>`;
            if (m.text) body += `<div class="wch-says">${esc(m.text)}${m.dateEdited ? ' <span class="wtm-edited">(Edited)</span>' : ''}</div>`;
            (m.attachments || []).forEach((a, i) => { body += attHtml(a, i, m); });
            if (m._upload) body += `<div class="wtm-progress"><i style="width:${Math.round((m._progress || 0) * 100)}%"></i></div>`;
        }
        body += tapbacksHtml(m);
        if (m.error) body += `<div class="wtm-failed">Message not sent.${typeof m.error === 'string' ? ` ${esc(m.error)}` : ''}</div>`;
        if (m.fromMe && (m.guid === lastMine || m._upload || m._sending || m.sending)) {
            const r = receiptText(m);
            if (r) body += `<div class="wtm-receipt">${esc(r)}</div>`;
        }
        const date = headDate(m.date);
        return `<div class="wch-entry wtm-entry is-${m.fromMe ? 'me' : 'them'}${unread ? ' is-unread' : ''}${m.guid === selMsg ? ' is-selected' : ''}" data-n="${n}" data-guid="${esc(m.guid)}">`
            + `<span class="wch-eico" data-ico="${unread ? 'msg-unread' : 'msg-read'}"></span>`
            + `<div class="wch-who"><span class="wch-link">${esc(senderName(m))}${date ? ` (${esc(date)})` : ''}:</span></div>${body}</div>`;
    }

    function typingHtml() {
        if (!conv || !typingIn.has(conv.guid)) return '';
        const c = conv.chat || {};
        const who = c.isGroup ? 'Someone' : chatTitle(c);
        return `<div class="wtm-typing">${esc(who)} is typing...</div>`;
    }

    function renderEntries(toEnd) {
        if (!page) return;
        const box = page.querySelector('.wch-history');
        const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        const list = conv ? conv.messages : [];
        const lastMine = (list.slice().reverse().find((m) => m.fromMe && !m.retracted) || {}).guid;
        const c = conv && conv.chat;
        let html = `<p class="wch-convhead"><i>Conversation with <span class="wch-link">${esc(chatTitle(c))}</span></i></p>`;
        if (c && c.isGroup) html += `<p class="wtm-members">${esc((c.participants || []).map((p) => p.name || p.address).join(', '))}</p>`;
        html += conv && conv.more ? '<p class="wch-olderp"><a class="wch-more" role="link">Older</a></p>' : '';
        html += list.map((m, n) => entryHtml(m, n, lastMine)).join('');
        html += `<div class="wtm-typing-slot">${typingHtml()}</div>`;
        box.innerHTML = html;
        if (toEnd || atEnd) box.scrollTop = box.scrollHeight;
    }

    function paintTyping() {
        if (!page || view() !== 'conv') return;
        const box = page.querySelector('.wch-history');
        const slot = box.querySelector('.wtm-typing-slot');
        if (!slot) return;
        const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        slot.innerHTML = typingHtml();
        if (atEnd) box.scrollTop = box.scrollHeight;
    }

    function selectEntry(g) {
        selMsg = g;
        page.querySelectorAll('.wtm-entry').forEach((el) => el.classList.toggle('is-selected', el.dataset.guid === g));
        if (isCurrent()) sh.refreshSoftKeys();
    }

    const selected = () => (selMsg ? msgByGuid(selMsg) : null);

    function inputEl() { return page.querySelector('.wtm-convview .wch-input'); }

    function fitInput() {
        const t = inputEl();
        t.style.height = 'auto';
        const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
        t.style.height = `${Math.min(t.scrollHeight, 70 * px)}px`;
    }

    function insertText(t) {
        const box = view() === 'new' ? page.querySelector('.wtm-new-text') : inputEl();
        const a = box.selectionStart == null ? box.value.length : box.selectionStart;
        const b = box.selectionEnd == null ? a : box.selectionEnd;
        box.value = box.value.slice(0, a) + t + box.value.slice(b);
        box.selectionStart = box.selectionEnd = a + t.length;
        if (box === inputEl()) fitInput();
        if (isCurrent()) sh.refreshSoftKeys();
    }

    const canSend = () => !!(conv && inputEl().value.trim());

    async function send() {
        if (!canSend()) return;
        const t = tm();
        const box = inputEl();
        const text = box.value.trim();
        const c = conv;
        const local = { guid: `local-${++localN}`, _local: true, _sending: true, chatGuid: c.guid, text, fromMe: true, sender: { me: true }, date: Date.now(), reactions: [], attachments: [], replyTo: replyTo || null };
        const reply = replyTo;
        box.value = '';
        fitInput();
        replyTo = null;
        renderReply();
        c.messages.push(local);
        renderEntries(true);
        sh.refreshSoftKeys();
        if (feat('typing')) t.typing(c.accountId, c.guid, false);
        try {
            const r = await t.send(c.accountId, { chatGuid: c.guid, text, replyTo: reply || undefined });
            const m = r && r.message;
            const at = c.messages.indexOf(local);
            if (m && at >= 0) {
                if (c.messages.some((x) => x.guid === m.guid)) c.messages.splice(at, 1);
                else c.messages[at] = Object.assign({}, m, { _local: true });
            } else if (at >= 0) local._sending = false;
            const ch = chatByGuid(c.guid);
            if (ch && m) { ch.last = m; chats = [ch].concat(chats.filter((x) => x !== ch)); }
        } catch (err) {
            local._sending = false;
            local.error = (err && err.message) || true;
            errorBox('The message was not sent.', err);
        }
        if (conv === c) renderEntries(true);
    }

    function pickFile(accept) {
        if (!conv || !feat('attachments')) return;
        const input = document.createElement('input');
        input.type = 'file';
        if (accept) input.accept = accept;
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            input.remove();
            if (file) sendFile(file);
        }, { once: true });
        input.click();
        // a cancelled picker fires no change: tidy up later
        setTimeout(() => { if (input.isConnected && !(input.files && input.files.length)) input.remove(); }, 120000);
    }

    async function sendFile(file) {
        const t = tm();
        const c = conv;
        if (!c) return;
        const local = { guid: `local-${++localN}`, _local: true, _upload: true, _progress: 0, chatGuid: c.guid, text: '', fromMe: true, sender: { me: true }, date: Date.now(), reactions: [], attachments: [{ name: file.name, mime: file.type, size: file.size }], replyTo: replyTo || null };
        const reply = replyTo;
        replyTo = null;
        renderReply();
        c.messages.push(local);
        renderEntries(true);
        let last = 0;
        const paint = () => {
            if (conv !== c) return;
            const el = page.querySelector(`.wtm-entry[data-guid="${CSS.escape(local.guid)}"]`);
            if (!el) return;
            const pct = Math.round(local._progress * 100);
            const bar = el.querySelector('.wtm-progress i');
            if (bar) bar.style.width = `${pct}%`;
            const r = el.querySelector('.wtm-receipt');
            if (r) r.textContent = `Sending ${pct}%`;
        };
        try {
            const r = await t.sendFile(c.accountId, c.guid, file, {
                replyTo: reply || undefined,
                onProgress: (p) => { local._progress = p; const now = Date.now(); if (now - last > 120 || p >= 1) { last = now; paint(); } }
            });
            const m = r && r.message;
            const at = c.messages.indexOf(local);
            if (m && at >= 0) {
                if (c.messages.some((x) => x.guid === m.guid)) c.messages.splice(at, 1);
                else c.messages[at] = Object.assign({}, m, { _local: true });
            } else if (at >= 0) { local._upload = false; }
        } catch (err) {
            local._upload = false;
            local.error = (err && err.message) || true;
            errorBox(`${file.name} was not sent.`, err);
        }
        if (conv === c) renderEntries(true);
    }

    function renderReply() {
        if (!page) return;
        const band = page.querySelector('.wtm-replyband');
        const o = replyTo ? msgByGuid(replyTo) : null;
        band.hidden = !o;
        if (o) band.querySelector('.wtm-replyband-text').textContent = `${senderName(o)}: ${summary(o, conv && conv.chat, false)}`;
    }

    function startReply(m) {
        if (!m || !feat('reply')) return;
        replyTo = m.guid;
        renderReply();
        inputEl().focus();
        if (isCurrent()) sh.refreshSoftKeys();
    }

    async function react(m, type) {
        const t = tm();
        if (!m || !conv) return;
        const mine = (m.reactions || []).find((r) => r.fromMe && !r.removed);
        const remove = !!(mine && mine.type === type);
        try {
            await t.react(conv.accountId, { chatGuid: conv.guid, messageGuid: m.guid, messageText: m.text || '', reaction: type, remove });
        } catch (err) { errorBox('The reaction was not sent.', err); }
    }

    function reactionItems(m) {
        const R = (tm() && tm().REACTIONS) || [];
        const mine = (m.reactions || []).find((r) => r.fromMe && !r.removed);
        return R.map((r) => ({ label: r.label, radio: !!(mine && mine.type === r.type), action: () => react(m, r.type) }));
    }

    async function editMessage(m) {
        const t = tm();
        if (!m || !conv) return;
        const c = conv;
        const text = await sh.messageBox({ title: 'Edit Message', text: 'Message:', input: { value: m.text || '' }, buttons: [{ text: 'Save', value: true }, { text: 'Cancel', value: false }], modal: true });
        if (typeof text !== 'string' || !text.trim() || text === m.text) return;
        try {
            const r = await sh.busy(() => t.edit(c.accountId, { messageGuid: m.guid, text }));
            const nm = r && r.message;
            Object.assign(m, nm || { text, dateEdited: Date.now() });
        } catch (err) { errorBox('The message was not changed.', err); return; }
        if (conv === c) renderEntries();
    }

    async function unsendMessage(m) {
        const t = tm();
        if (!m || !conv) return;
        const c = conv;
        const ok = await sh.messageBox({ title: TITLE, icon: 'question', text: 'Unsend this message? It is taken back from everyone in the conversation.', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }] });
        if (!ok) return;
        try {
            const r = await sh.busy(() => t.unsend(c.accountId, { messageGuid: m.guid }));
            Object.assign(m, (r && r.message) || { retracted: true, text: '', attachments: [] });
        } catch (err) { errorBox('The message could not be unsent.', err); return; }
        if (conv === c) renderEntries();
    }

    function copyText(m) {
        const text = m && m.text;
        if (!text) return;
        try { navigator.clipboard.writeText(text); } catch (_) { /* no clipboard */ }
    }

    function forwardText(text) {
        if (!text || typeof window.wmMessagingCompose !== 'function') return;
        window.wmMessagingCompose({ body: text });
    }

    // ---------------------------------------------------------------- attachments

    function attOf(el) {
        const m = msgByGuid(el.dataset.msg);
        return m ? (m.attachments || [])[Number(el.dataset.att)] || null : null;
    }

    function download(a) {
        if (!a || !a.url) return;
        const link = document.createElement('a');
        link.href = a.url;
        link.download = a.name || '';
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function openMedia(a) {
        if (!a || !a.url) return;
        media = a;
        const box = page.querySelector('.wtm-media');
        box.innerHTML = isVideo(a)
            ? `<video src="${esc(a.url)}" controls playsinline preload="metadata"></video>`
            : `<img src="${esc(a.url)}" alt="${esc(a.name || '')}" draggable="false">`;
        page.querySelector('.wtm-media-name').textContent = a.name || attLabel(a);
        push('media');
    }

    // ---------------------------------------------------------------- new message

    function openNew(addresses, text) {
        newDraft = { to: (addresses || []).join('; '), text: text || '' };
        const v = page.querySelector('.wtm-newview');
        v.querySelector('.wtm-new-from').textContent = acctLine(acct());
        v.querySelector('input[name="to"]').value = newDraft.to;
        v.querySelector('.wtm-new-text').value = newDraft.text;
        if (view() === 'new') showLayer(); else push('new');
        setTimeout(() => { const f = newDraft && newDraft.to ? v.querySelector('.wtm-new-text') : v.querySelector('input[name="to"]'); if (f) f.focus(); }, 0);
    }

    const acctLine = (a) => {
        if (!a) return TITLE;
        const t = tm();
        const l = t && typeof t.label === 'function' ? t.label(a) : { title: a.name || TITLE, subline: a.identity || '' };
        return l.subline ? `${l.title} (${l.subline})` : l.title;
    };

    const newTo = () => String(page.querySelector('.wtm-newview input[name="to"]').value || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    const canSendNew = () => !!(page && newTo().length && page.querySelector('.wtm-new-text').value.trim());

    async function sendNew() {
        if (!canSendNew()) return;
        const t = tm();
        const id = accountId;
        const addresses = newTo();
        const text = page.querySelector('.wtm-new-text').value.trim();
        // a conversation with that one address already: the message goes there
        const have = addresses.length === 1 ? findChatWith(addresses[0]) : null;
        let r = null;
        try {
            r = await sh.busy(() => t.send(id, have ? { chatGuid: have.guid, text } : { addresses, text }), { paint: true });
        } catch (err) { errorBox('The message was not sent.', err); return; }
        const guid = (r && r.chatGuid) || (have && have.guid);
        newDraft = null;
        if (!guid) { layers.pop(); showLayer(); sh.syncHistory(); refresh({ quiet: true }); return; }
        let c = chatByGuid(guid);
        if (!c) { try { c = await t.chat(id, guid); } catch (_) { c = null; } }
        if (!c) c = { guid, title: addresses.join(', '), participants: addresses.map((a) => ({ address: a, name: '' })), isGroup: addresses.length > 1, known: true, last: r && r.message };
        if (!chatByGuid(guid) && folder !== 'unknown') chats.unshift(c);
        layers = [];
        openConversation(c, { replace: true });
    }

    function findChatWith(address) {
        const k = normAddr(address);
        if (!k) return null;
        return chats.find((c) => !c.isGroup && ((c.participants || []).some((p) => normAddr(p.address) === k) || normAddr(c.identifier) === k)) || null;
    }

    // ---------------------------------------------------------------- menus

    function goToItems() {
        const m = window.wmMessaging;
        const accounts = m && typeof m.accountItems === 'function' ? m.accountItems(`tm:${accountId}`) : [];
        return [{ label: 'Folders...', action: () => openTree() }, '-'].concat(accounts);
    }

    function openTree(anchor) {
        const m = window.wmMessaging;
        if (!m || typeof m.showTree !== 'function') return;
        m.showTree(anchor || page.querySelector('.wch-folder'), { acct: `tm:${accountId}`, folder, onPick: (f) => setFolder(f) });
    }

    function sortItems() {
        return [['date', 'Received'], ['name', 'From']].map(([k, l]) => ({ label: l, radio: sort === k, action: () => setSort(k) }));
    }

    function markChatRead(c) {
        if (!c) return;
        const t = tm();
        c.unread = false;
        renderList();
        if (t) t.markRead(accountId, c.guid).catch(() => {});
    }

    function listMenu() {
        const c = selectedChat();
        const items = [];
        if (feat('newChat')) items.push({ label: 'New', action: () => openNew([]) });
        items.push({ label: 'Mark as Read', disabled: !(c && c.unread), action: () => markChatRead(c) });
        items.push('-');
        items.push({ label: 'Go To', submenu: goToItems });
        items.push({ label: 'Tools', submenu: () => [
            { label: 'Sort By', submenu: sortItems },
            '-',
            { label: 'Options...', disabled: !(window.wmSettings && typeof window.wmSettings.open === 'function'), action: () => window.wmSettings.open('messaging-options', null, { direct: true }) }
        ] });
        items.push('-');
        items.push({ label: 'Reply', submenu: () => [
            { label: 'Reply', disabled: !c, action: () => openConversation(c) },
            { label: 'Forward', disabled: !(c && c.last && c.last.text) || typeof window.wmMessagingCompose !== 'function', action: () => forwardText(c.last.text) }
        ] });
        return items;
    }

    function rowMenu(c) {
        return [
            { label: 'Reply', action: () => openConversation(c) },
            { label: 'Mark as Read', disabled: !c.unread, action: () => markChatRead(c) }
        ];
    }

    /** What can be done to one message (the conversation menu and its tap-and-hold menu). */
    function messageItems(m) {
        const live = !!(m && !m.retracted && !m._local);
        const own = !!(m && m.fromMe);
        const items = [];
        if (feat('reply')) items.push({ label: 'Reply', disabled: !live, action: () => startReply(m) });
        if (feat('tapbacks')) items.push({ label: 'Reactions', disabled: !live, submenu: () => reactionItems(m) });
        if (feat('edit') && own) items.push({ label: 'Edit...', disabled: !(live && m.text), action: () => editMessage(m) });
        if (feat('unsend') && own) items.push({ label: 'Unsend', disabled: !live, action: () => unsendMessage(m) });
        items.push({ label: 'Copy Text', disabled: !(m && m.text && !m.retracted), action: () => copyText(m) });
        return items;
    }

    function convMenu() {
        const m = selected();
        const items = messageItems(m);
        items.push({ label: 'Forward', disabled: !(m && m.text && !m.retracted) || typeof window.wmMessagingCompose !== 'function', action: () => forwardText(m.text) });
        items.push('-');
        if (feat('attachments')) {
            items.push({ label: 'Insert', submenu: () => [
                { label: 'Picture...', action: () => pickFile('image/*') },
                { label: 'Video...', action: () => pickFile('video/*') },
                { label: 'File...', action: () => pickFile('') }
            ] });
        }
        items.push({ label: 'My Text', submenu: () => MY_TEXT.map((t) => ({ label: t, action: () => insertText(t) })) });
        if (replyTo) items.push({ label: 'Cancel Reply', action: () => { replyTo = null; renderReply(); sh.refreshSoftKeys(); } });
        items.push('-');
        items.push({ label: 'Close', action: () => { popLayer(); sh.syncHistory(); } });
        return items;
    }

    function newMenu() {
        return [
            { label: 'My Text', submenu: () => MY_TEXT.map((t) => ({ label: t, action: () => insertText(t) })) },
            '-',
            { label: 'Cancel Message', action: () => { popLayer(); sh.syncHistory(); } }
        ];
    }

    // ---------------------------------------------------------------- page

    function onHold(el, selector, fn) {
        let timer = null;
        let start = null;
        let held = false;
        const clear = () => { clearTimeout(timer); timer = null; };
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            held = false;
            const row = e.target.closest(selector);
            if (!row) return;
            start = { x: e.clientX, y: e.clientY };
            clear();
            timer = setTimeout(() => { held = true; fn(row, start.x, start.y); }, ((window.wmShell && window.wmShell.holdMs) || 550));
        });
        el.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, clear));
        el.addEventListener('contextmenu', (e) => {
            const row = e.target.closest(selector);
            if (!row) return;
            e.preventDefault();
            if (held) return;
            held = true;
            clear();
            fn(row, e.clientX, e.clientY);
        });
        el.addEventListener('click', (e) => {
            if (!held) return;
            held = false;
            e.stopPropagation();
            e.preventDefault();
        }, true);
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-chat', 'wm-tm');
        p.innerHTML = `
            <div class="wch-listview">
                <div class="wm-pv-bar wch-bar">
                    <button type="button" class="wm-pv-folder wch-folder" aria-haspopup="tree"><span class="wch-folder-name">Inbox</span><i class="wm-pv-arrow"></i></button>
                    <button type="button" class="wm-pv-sort wch-sort" aria-haspopup="menu"><span>Received</span><i class="wm-pv-arrow"></i></button>
                </div>
                <div class="wch-scroll"><div class="wch-list" role="listbox" aria-label="Conversations"></div><p class="wch-empty" hidden></p></div>
                <div class="wch-status"></div>
            </div>
            <div class="wch-convview wtm-convview" hidden>
                <div class="wch-history" role="log" aria-live="polite"></div>
                <div class="wtm-replyband" hidden><span class="wtm-replyband-text"></span><button type="button" class="wtm-replyband-x" aria-label="Cancel reply">Cancel</button></div>
                <div class="wch-compose"><textarea class="wch-input" rows="2" enterkeyhint="send" autocomplete="off" aria-label="Message"></textarea></div>
            </div>
            <div class="wtm-newview wm-msg" hidden>
                <form class="msg-form" autocomplete="off" onsubmit="return false">
                    <label class="msg-field is-static"><span>From:</span><output class="wtm-new-from"></output></label>
                    <label class="msg-field"><span>To:</span><input name="to" type="text" inputmode="email" autocapitalize="off" spellcheck="false" aria-label="To"></label>
                    <textarea class="msg-text wtm-new-text" aria-label="Message"></textarea>
                </form>
            </div>
            <div class="wtm-mediaview" hidden>
                <div class="wtm-media"></div>
                <div class="wtm-media-name"></div>
            </div>`;

        p.querySelector('.wch-folder').addEventListener('click', (e) => {
            e.stopPropagation();
            openTree(e.currentTarget);
        });
        p.querySelector('.wch-sort').addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            btn.querySelector('span').textContent = sh.version === '6.5' ? 'Sort by' : 'Sort By';
            sh.dropdown(btn, sortItems(), 'right', () => renderList());
        });
        const scroll = p.querySelector('.wch-scroll');
        onHold(scroll, '.wtm-row', (row, x, y) => {
            selectRow(row.dataset.guid);
            const c = chatByGuid(row.dataset.guid);
            if (c) sh.menuAt(x, y, rowMenu(c));
        });
        scroll.addEventListener('click', (e) => {
            const row = e.target.closest('.wtm-row');
            if (!row) return;
            selectRow(row.dataset.guid);
            openConversation(chatByGuid(row.dataset.guid));
        });

        const hist = p.querySelector('.wch-history');
        hist.addEventListener('click', (e) => {
            if (e.target.closest('.wch-more')) { loadOlder(); return; }
            const att = e.target.closest('.wtm-att');
            if (att) {
                const a = attOf(att);
                if (!a) return;
                if (att.classList.contains('is-pic')) openMedia(a); else download(a);
                return;
            }
            const q = e.target.closest('.wtm-quote');
            if (q) {
                const el = hist.querySelector(`.wtm-entry[data-guid="${CSS.escape(q.dataset.quote)}"]`);
                if (el) { el.scrollIntoView({ block: 'center' }); selectEntry(q.dataset.quote); }
                return;
            }
            const el = e.target.closest('.wtm-entry');
            if (el) selectEntry(el.dataset.guid);
        });
        onHold(hist, '.wtm-entry', (el, x, y) => {
            const m = msgByGuid(el.dataset.guid);
            if (!m) return;
            selectEntry(m.guid);
            sh.menuAt(x, y, messageItems(m));
        });

        const input = p.querySelector('.wtm-convview .wch-input');
        input.addEventListener('input', () => {
            fitInput();
            if (conv && feat('typing') && input.value.trim()) { const t = tm(); if (t) t.typing(conv.accountId, conv.guid, true); }
            if (isCurrent()) sh.refreshSoftKeys();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
        });
        p.querySelector('.wtm-replyband-x').addEventListener('click', () => { replyTo = null; renderReply(); if (isCurrent()) sh.refreshSoftKeys(); });

        const nv = p.querySelector('.wtm-newview');
        nv.addEventListener('input', () => { if (isCurrent()) sh.refreshSoftKeys(); });
        nv.querySelector('input[name="to"]').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nv.querySelector('.wtm-new-text').focus(); }
        });
    }

    // ---------------------------------------------------------------- app

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        wire();
        // a stand-in (tests) or a late client: listen to whichever window.textMessaging is there
        setInterval(wire, 3000);
        loadAccounts(false);
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: 'msg-acct-sms',
            inStart: false,
            sip: true,
            mount,
            show() {
                wire();
                showLayer();
                if (view() === 'list') refresh({ quiet: loaded });
                else if (view() === 'conv') { renderEntries(); markRead(); }
            },
            hide() {
                if (conv && feat('typing')) { const t = tm(); if (t) t.typing(conv.accountId, conv.guid, false); }
            },
            titleKind: () => (view() === 'list' ? 'close' : 'ok'),
            onTitleOk() {
                if (view() === 'new') { if (canSendNew()) sendNew(); else { popLayer(); sh.syncHistory(); } return true; }
                if (layers.length) { popLayer(); return true; }
                return false;
            },
            historyDepth: () => layers.length,
            onBack() {
                if (!layers.length) return false;
                popLayer();
                return true;
            },
            softKeys() {
                const v = view();
                if (v === 'conv') return { left: { label: 'Send', disabled: !canSend(), action: send }, right: { label: 'Menu', menu: convMenu } };
                if (v === 'new') return { left: { label: 'Send', disabled: !canSendNew(), action: sendNew }, right: { label: 'Menu', menu: newMenu } };
                if (v === 'media') return { left: { label: 'Save', disabled: !(media && media.url), action: () => download(media) }, right: null };
                const c = selectedChat();
                return { left: { label: 'Reply', disabled: !c, action: () => openConversation(c) }, right: { label: 'Menu', menu: listMenu } };
            }
        });
    }

    /** This app on an account's list, the given folder (Inbox when none). */
    async function showAccount(id, f) {
        if (!sh) return false;
        await loadAccounts(false);
        const next = (id && acctById(id)) ? id : (accts[0] && accts[0].id) || null;
        const changed = next !== accountId;
        accountId = next;
        sh.open(APP_ID);
        if (layers.length) { if (view() === 'conv') leaveConv(); layers = []; newDraft = null; media = null; showLayer(); sh.syncHistory(); }
        const nf = FOLDERS.some((x) => x.id === f) ? f : 'inbox';
        if (changed || nf !== folder) { folder = nf; chats = []; loaded = false; selectedGuid = null; }
        renderList();
        refresh({ quiet: loaded });
        return true;
    }

    async function openChat(id, guid) {
        if (!sh || !guid) return false;
        await loadAccounts(false);
        const a = acctById(id) || accts[0];
        if (!a) return false;
        if (a.id !== accountId) { accountId = a.id; chats = []; loaded = false; }
        let c = chatByGuid(guid);
        if (!c) { try { c = await tm().chat(a.id, guid); } catch (_) { c = null; } }
        if (!c) return false;
        const f = c.known === false ? 'unknown' : 'inbox';
        if (f !== folder) { folder = f; chats = []; loaded = false; }
        sh.open(APP_ID);
        if (!loaded) refresh({ quiet: true });
        openConversation(c, { replace: true });
        return true;
    }

    async function compose(id, addresses) {
        if (!sh) return false;
        await loadAccounts(false);
        const a = acctById(id) || accts[0];
        if (!a) return false;
        if (a.id !== accountId) { accountId = a.id; folder = 'inbox'; chats = []; loaded = false; }
        const list = (Array.isArray(addresses) ? addresses : [addresses]).map((s) => String(s || '').trim()).filter(Boolean);
        sh.open(APP_ID);
        if (!loaded) await refresh({ quiet: true });
        const have = list.length === 1 ? findChatWith(list[0]) : null;
        if (have) { openConversation(have, { replace: true }); return true; }
        layers = [];
        openNew(list);
        return true;
    }

    window.wmTextMessaging = {
        showAccount: (id, f) => showAccount(id, f),
        openChat: (id, guid) => openChat(id, guid),
        compose: (id, addresses) => compose(id, addresses),
        /** The accounts as last read (synchronous; a fresh read starts and fires the picker's refresh). */
        accounts() { loadAccounts(false); return accts.slice(); },
        /** The account on screen and its folder (Messaging's tree marks it). */
        current: () => ({ accountId, folder }),
        /** True while that conversation is open on screen (a notification for it is not needed). */
        isOpen: (id, guid) => !!(conv && conv.accountId === id && conv.guid === guid && isCurrent() && view() === 'conv' && document.visibilityState !== 'hidden'),
        FOLDERS: FOLDERS.map((f) => Object.assign({}, f))
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
