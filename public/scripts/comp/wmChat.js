/**
 * Melaton Mobile: Chat, a phone version of the desktop's AI chat (chatSystem.js), drawn as WM 6.1's
 * Text Messages / Windows Live Messenger (Yozora #732, parent #709). Not the desktop window re-hosted:
 * the same chats, the same server calls (wsClient createChatSession / getChatSessions /
 * getChatMessages / sendChatMessage / deleteChatSession / restartChatSession / deleteChatMessage) and
 * the same stream (chat_streaming_start / _update / _complete), on WM screens.
 *
 * Measured on the Device Emulator (VGA, 2x halved; Text Messages and Messenger, Nov 10 2026):
 *   list         Text Messages' folder bar (Pictures & Videos' .wm-pv-bar: 22 px tab-strip tint, 1 px
 *                black rule; the folder drop-down at the left, the sort at the right), two-line rows
 *                like Outlook Mobile's (31 px, 1 px #848284 rule): the persona's picture, bold name and
 *                the date (time today, M/D/YY before), the last thing said under it; the status line
 *                at the bottom (1 px black rule, 19 px tint: "Chat  3 Items."); the empty list says how
 *                to start one. Soft keys New / Menu; tap-and-hold a row for its menu.
 *   conversation WM 6.1's threaded text messages: a header band with the persona's picture and name
 *                (Messenger's white-to-pink band, 1 px #B5CFDE rule), the history oldest first, each
 *                entry "Name:" in bold (the persona in the highlight colour, "Me" in black) over the
 *                text, received entries on the list tint; the reply streams into its entry as it
 *                arrives. Messenger's compose panel at the bottom (38 px: a 48 px white column with
 *                the user's picture or Messenger's buddy glyph, the text box with a 1 px #0082FF edge
 *                on a pale pink field). Soft keys Send / Menu; ok goes back to the list.
 *   new chat     a WM form (23 px highlight header, label | box rows) over the desktop's fields: the
 *                picture (a chat's persona is a gallery picture), Name, Verbosity, Mind Seed, Story So
 *                Far, Viewer Context. ok / Create starts it; the persona's first words stream in.
 *
 * Desktop routes that open the chat windows (Start menu 'chat', a picture's "Chat" action:
 * chatSystem.showAllChats / openChatModal / openChatInterfaceModal) open this app on phones, so the
 * desktop window never opens unseen. Only on phones. Styles: public/css/wm-chat.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'chat';
    const ART = '/static_images/wm61/';
    const SORT_KEY = 'wmChatSort';
    const ACTIONS_KEY = 'wmChatShowActions';
    const PREVIEW_ROWS = 12; // messages read per chat for the list's last line
    const VISIBLE = new Set(['speechdirect', 'speech', 'reply', 'actions', 'sfx', 'myname']);
    const SAYS = ['speechdirect', 'speech', 'reply'];
    const VERBOSITY = [['1', 'Brief'], ['2', 'Direct'], ['3', 'Expressive'], ['4', 'Elaborate'], ['5', 'Poetic']];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const wsc = () => window.wsClient || null;
    const stored = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const store = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };

    let sh = null; // window.wmShell
    let page = null;
    let shown = false;
    let sessions = []; // the server's chat rows, newest first
    let loaded = false;
    let selectedId = null;
    let filter = '*'; // '*' or a persona name
    let sort = stored(SORT_KEY) === 'name' ? 'name' : 'date';
    let showActions = stored(ACTIONS_KEY) === '1';
    const previews = new Map(); // chatId -> { stamp, text }
    let previewGen = 0;

    let layers = []; // 'conv' | 'new'
    let conv = null; // { id, session, entries: [], hasMore, offset }
    let draft = null; // the new-chat form { filename, name, seed, story, viewer, verbosity }
    let creating = false; // a create_chat_session in flight: its stream belongs to the new chat
    const streams = new Map(); // chatId -> { events: [], waitingSince }
    const waiting = new Map(); // chatId -> timer: a reply is on its way (Send waits)

    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;

    // ---------------------------------------------------------------- helpers

    /** Seconds, milliseconds or a SQLite / ISO date string as a Date. */
    function toDate(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) {
            const n = Number(v);
            return new Date(n < 1e12 ? n * 1000 : n);
        }
        let s = String(v);
        if (/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`; // SQLite UTC
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    function fmtTime(d) {
        let h = d.getHours();
        const ap = h < 12 ? 'AM' : 'PM';
        h = h % 12 || 12;
        return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
    }
    const fmtShortDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
    /** Outlook Mobile's list column: the time today, M/D/YY before. */
    function listDate(v) {
        const d = toDate(v);
        if (!d) return '';
        return sameDay(d, new Date()) ? fmtTime(d) : fmtShortDate(d);
    }
    function entryDate(v) {
        const d = toDate(v);
        if (!d) return '';
        return sameDay(d, new Date()) ? fmtTime(d) : `${fmtShortDate(d)} ${fmtTime(d)}`;
    }

    const titleOf = (s) => (s && (s.chat_name || s.character_name)) || 'Unnamed Chat';
    const personaOf = (s) => (s && (s.character_name || s.chat_name)) || 'Persona';
    /** The persona's picture: the gallery picture the chat was made from (the desktop's list thumbnail). */
    function pictureOf(filename) {
        if (!filename) return '/static_images/icon-96x96.png';
        const stem = String(filename).replace(/\.(png|jpe?g|webp)$/i, '');
        return `/previews/${encodeURIComponent(`${stem}.webp`)}`;
    }

    /** WM's threaded messages call the phone's owner "Me". */
    const userName = () => 'Me';

    function userPicture() {
        const p = window.chatSystem && window.chatSystem.personaSettings;
        return p && p.profile_photo_base64 ? `data:image/jpeg;base64,${p.profile_photo_base64}` : null;
    }

    function connected() {
        const c = wsc();
        return !!(c && typeof c.isConnected === 'function' && c.isConnected());
    }

    /** The desktop chat feature (chatSystem.js): its stream handlers resolve sendChatMessage, so it must be loaded. */
    let chatLoading = null;
    function ensureChat() {
        if (window.chatSystem) { patchDesktop(); return Promise.resolve(true); }
        if (chatLoading) return chatLoading;
        chatLoading = (async () => {
            try {
                if (window.featureLoader && typeof window.featureLoader.loadFeature === 'function') await window.featureLoader.loadFeature('chat');
            } catch (err) { console.warn('[wmChat] chat feature', err); }
            // the instance waits for the socket's init step 88
            for (let i = 0; i < 50 && !window.chatSystem; i++) await new Promise((r) => setTimeout(r, 100));
            patchDesktop();
            chatLoading = null;
            return !!window.chatSystem;
        })();
        return chatLoading;
    }

    function failBox(text, err) {
        const why = err && (err.message || err.error) ? `\n\n${err.message || err.error}` : '';
        return sh.notify({ title: 'Chat', icon: 'error', text: `${text}${why}` });
    }

    /** What a list of chat events says: the speech line, the actions and sound effects (the desktop's rules). */
    function eventsText(events, typeOf) {
        let says = '';
        let actions = '';
        let sfx = '';
        for (const e of events) {
            const t = typeOf(e);
            const c = e.content;
            if (!c || !VISIBLE.has(t)) continue;
            if (SAYS.includes(t)) { if (!says) says = String(c); } else if (t === 'myname') { if (!says) says = `My name is ${c}`; } else if (t === 'actions') actions = String(c);
            else if (t === 'sfx') sfx = String(c);
        }
        return { says, actions, sfx };
    }

    /** Server rows (oldest first) as threaded entries: the user's lines, and each reply's moments. */
    function entriesOf(rows) {
        const out = [];
        let group = [];
        const flush = () => {
            if (!group.length) return;
            // one reply is several rows (one per event), grouped by response_id then by the event moment
            const byTime = new Map();
            for (const m of group) {
                let t = 0;
                try { const md = m.event_metadata ? JSON.parse(m.event_metadata) : null; if (md && md.timestamp !== undefined) t = Number(md.timestamp) || 0; } catch (_) { t = 0; }
                if (!byTime.has(t)) byTime.set(t, []);
                byTime.get(t).push(m);
            }
            [...byTime.keys()].sort((a, b) => a - b).forEach((t) => {
                const ms = byTime.get(t);
                const x = eventsText(ms, (m) => m.event_type);
                if (!x.says && !x.actions && !x.sfx) return;
                out.push({ kind: 'them', ...x, ids: ms.map((m) => m.id).filter((id) => id != null), at: ms[0].created_at });
            });
            group = [];
        };
        for (const m of rows) {
            if (m.message_type === 'user') {
                flush();
                out.push({ kind: 'me', says: String(m.content || ''), ids: m.id != null ? [m.id] : [], at: m.created_at });
            } else if (m.message_type === 'assistant') {
                const last = group[group.length - 1];
                if (group.length && !(m.response_id && last && last.response_id === m.response_id)) flush();
                group.push(m);
            }
        }
        flush();
        return out;
    }

    // ---------------------------------------------------------------- data

    async function loadSessions() {
        if (!connected()) return false;
        const r = await wsc().getChatSessions();
        if (!r || !r.success) throw new Error((r && (r.message || r.error)) || 'The chats could not be read.');
        sessions = Array.isArray(r.sessions) ? r.sessions : [];
        loaded = true;
        return true;
    }

    /** The list's second line: the last thing said in each chat, read a few rows at a time. */
    async function loadPreviews() {
        const gen = ++previewGen;
        const todo = sessions.filter((s) => {
            const p = previews.get(s.id);
            return !p || p.stamp !== s.updated_at;
        }).slice(0, 40);
        let at = 0;
        const worker = async () => {
            while (at < todo.length && gen === previewGen) {
                const s = todo[at++];
                try {
                    const r = await wsc().getChatMessages(s.id, PREVIEW_ROWS, 0);
                    if (!r || !r.success || !Array.isArray(r.messages)) continue;
                    const ents = entriesOf(r.messages.slice().reverse());
                    const last = [...ents].reverse().find((e) => e.says || e.actions);
                    previews.set(s.id, { stamp: s.updated_at, text: last ? (last.says || `*${last.actions}*`) : '', mine: !!(last && last.kind === 'me') });
                    if (gen === previewGen && view() === 'list') paintRowPreview(s.id);
                } catch (_) { /* the row keeps its placeholder */ }
            }
        };
        await Promise.all([worker(), worker(), worker()]);
    }

    async function loadConversation(more) {
        if (!conv) return;
        const id = conv.id;
        const offset = more ? conv.offset : 0;
        const r = await wsc().getChatMessages(id, 50, offset);
        if (!conv || conv.id !== id) return;
        if (!r || !r.success) throw new Error((r && (r.message || r.error)) || 'The conversation could not be read.');
        const rows = (Array.isArray(r.messages) ? r.messages : []).slice().reverse();
        conv.rows = more ? rows.concat(conv.rows || []) : rows;
        conv.offset = offset + rows.length;
        conv.hasMore = rows.length === 50;
        conv.entries = entriesOf(conv.rows);
        const last = [...conv.entries].reverse().find((e) => e.says || e.actions);
        if (last) previews.set(id, { stamp: conv.session && conv.session.updated_at, text: last.says || `*${last.actions}*`, mine: last.kind === 'me' });
    }

    // ---------------------------------------------------------------- list

    function visibleSessions() {
        let list = sessions.slice();
        if (filter !== '*') list = list.filter((s) => personaOf(s) === filter);
        if (sort === 'name') {
            const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
            list.sort((a, b) => coll.compare(titleOf(a), titleOf(b)));
        }
        return list;
    }

    function rowHtml(s) {
        const p = previews.get(s.id);
        const sel = s.id === selectedId;
        const line = p ? (p.text ? `${p.mine ? 'Me: ' : ''}${p.text}` : 'No messages') : '';
        return `<div class="wch-row${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-id="${esc(s.id)}">`
            + `<img class="wch-pic" src="${esc(pictureOf(s.filename))}" alt="" draggable="false" loading="lazy" onerror="this.src='/static_images/icon-96x96.png'">`
            + `<span class="wch-name">${esc(titleOf(s))}</span><span class="wch-date">${esc(listDate(s.updated_at || s.created_at))}</span>`
            + `<span class="wch-last">${esc(line)}</span></div>`;
    }

    function renderList() {
        if (!page) return;
        const list = visibleSessions();
        const box = page.querySelector('.wch-list');
        box.innerHTML = list.map(rowHtml).join('');
        const empty = page.querySelector('.wch-empty');
        empty.hidden = !!list.length || !loaded;
        empty.textContent = filter !== '*' ? `No chats with ${filter}.` : 'To start a chat, tap New, then choose a picture for the persona.';
        page.querySelector('.wch-status').textContent = `Chat\u2003${list.length} ${list.length === 1 ? 'Item' : 'Items'}.`;
        page.querySelector('.wch-folder-name').textContent = filter === '*' ? 'All Chats' : filter;
        page.querySelector('.wch-sort span').textContent = sort === 'name' ? 'Name' : 'Date';
        if (selectedId && !list.some((s) => s.id === selectedId)) selectedId = null;
    }

    function paintRowPreview(id) {
        const row = page && page.querySelector(`.wch-row[data-id="${CSS.escape(String(id))}"]`);
        const s = sessions.find((x) => x.id === id);
        if (row && s) row.outerHTML = rowHtml(s);
    }

    function selectRow(id) {
        selectedId = id;
        page.querySelectorAll('.wch-row').forEach((r) => {
            const on = r.dataset.id === String(id);
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    const sessionById = (id) => sessions.find((s) => String(s.id) === String(id)) || null;
    const selectedSession = () => (selectedId != null ? sessionById(selectedId) : null);

    async function refresh(opts = {}) {
        const work = async () => {
            if (!(await ensureChat())) throw new Error('Chat could not be started.');
            await loadSessions();
        };
        try {
            if (opts.quiet) await work();
            else await sh.busy(work, { paint: true });
        } catch (err) {
            if (!opts.quiet) failBox('The chats could not be read.', err);
        }
        renderList();
        if (loaded) loadPreviews();
    }

    // ---------------------------------------------------------------- layers

    function showLayer() {
        if (!page) return;
        const v = view();
        page.querySelector('.wch-listview').hidden = v !== 'list';
        page.querySelector('.wch-convview').hidden = v !== 'conv';
        page.querySelector('.wch-newview').hidden = v !== 'new';
        page.dataset.view = v;
        if (isCurrent()) {
            sh.setTitle(v === 'new' ? 'New Chat' : 'Chat');
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
        if (v === 'conv') conv = null;
        if (v === 'new') draft = null;
        showLayer();
        if (view() === 'list') renderList();
    }

    // ---------------------------------------------------------------- conversation

    async function openConversation(session, opts = {}) {
        if (!session) return;
        conv = { id: session.id, session, entries: [], rows: [], hasMore: false, offset: 0 };
        selectedId = session.id;
        renderConvHead();
        renderEntries();
        if (opts.replace) { layers = ['conv']; showLayer(); sh.syncHistory(); } else push('conv');
        try {
            await sh.busy(() => loadConversation(false), { paint: true });
        } catch (err) { failBox('The conversation could not be read.', err); }
        renderEntries(true);
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function renderConvHead() {
        if (!page || !conv) return;
        const s = conv.session || {};
        const img = page.querySelector('.wch-head-pic');
        img.src = pictureOf(s.filename);
        page.querySelector('.wch-head-name').textContent = titleOf(s);
        const sub = [s.character_name && s.chat_name && s.character_name !== s.chat_name ? s.character_name : '', s.model || ''].filter(Boolean).join(' \u00b7 ');
        page.querySelector('.wch-head-sub').textContent = sub;
        const me = userPicture();
        const mine = page.querySelector('.wch-me');
        mine.style.backgroundImage = me ? `url("${me}")` : '';
        mine.classList.toggle('has-photo', !!me);
    }

    function entryHtml(e, n, live) {
        const who = e.kind === 'me' ? userName() : personaOf(conv && conv.session);
        let body = '';
        if (e.says) body += `<div class="wch-says">${esc(e.says)}</div>`;
        if (showActions && e.actions) body += `<div class="wch-act">*${esc(e.actions)}*</div>`;
        if (showActions && e.sfx) body += `<div class="wch-sfx">~${esc(e.sfx)}~</div>`;
        if (!body) body = live ? '<div class="wch-says wch-typing">...</div>' : '';
        if (!body) return '';
        return `<div class="wch-entry is-${e.kind}${live ? ' is-live' : ''}" data-n="${n}">`
            + `<div class="wch-who"><b>${esc(who)}:</b>${e.at && !live ? `<span class="wch-at">${esc(entryDate(e.at))}</span>` : ''}</div>${body}</div>`;
    }

    function liveEntry() {
        if (!conv) return null;
        const st = streams.get(conv.id);
        if (!st) return waiting.has(conv.id) || (creating && conv.id === 'new') ? { kind: 'them', says: '', actions: '', sfx: '' } : null;
        return { kind: 'them', ...eventsText(st.events, (e) => e.type) };
    }

    function renderEntries(toEnd) {
        if (!page) return;
        const box = page.querySelector('.wch-history');
        const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        const list = conv ? conv.entries : [];
        let html = conv && conv.hasMore ? '<button type="button" class="wch-more">Older messages...</button>' : '';
        html += list.map((e, n) => entryHtml(e, n, false)).join('');
        const live = liveEntry();
        if (live) html += entryHtml(live, -1, true);
        if (!list.length && !live) html += `<p class="wch-none">${conv && conv.id === 'new' ? '' : 'No messages yet. Type below and tap Send.'}</p>`;
        box.innerHTML = html;
        if (toEnd || atEnd) box.scrollTop = box.scrollHeight;
    }

    /** Only the streaming entry changes while a reply arrives. */
    function paintLive() {
        if (!page || view() !== 'conv') return;
        const box = page.querySelector('.wch-history');
        const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 32;
        const live = liveEntry();
        const old = box.querySelector('.wch-entry.is-live');
        const html = live ? entryHtml(live, -1, true) : '';
        if (old) {
            if (html) old.outerHTML = html; else old.remove();
        } else if (html) {
            const none = box.querySelector('.wch-none');
            if (none) none.remove();
            box.insertAdjacentHTML('beforeend', html);
        }
        if (atEnd) box.scrollTop = box.scrollHeight;
    }

    function inputEl() { return page.querySelector('.wch-input'); }

    function fitInput() {
        const t = inputEl();
        t.style.height = 'auto';
        const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
        t.style.height = `${Math.min(t.scrollHeight, 70 * px)}px`;
    }

    const canSend = () => !!(conv && conv.id !== 'new' && !waiting.has(conv.id) && !streams.has(conv.id) && inputEl().value.trim());

    function stopWaiting(id) {
        clearTimeout(waiting.get(id));
        waiting.delete(id);
    }

    async function send() {
        if (!canSend()) return;
        const t = inputEl();
        const text = t.value.trim();
        const id = conv.id;
        if (!connected()) { failBox('The message was not sent: the server connection is down.'); return; }
        t.value = '';
        fitInput();
        conv.entries.push({ kind: 'me', says: text, ids: [], at: Date.now(), pending: true });
        // the reply streams in; Send waits for it (the desktop's rule), at most two minutes
        waiting.set(id, setTimeout(() => { waiting.delete(id); if (conv && conv.id === id) { renderEntries(); sh.refreshSoftKeys(); } }, 120000));
        renderEntries(true);
        sh.refreshSoftKeys();
        previews.set(id, { stamp: null, text, mine: true });
        try {
            await ensureChat();
            // wsClient.sendMessage (not ...WithCallback): no wait cursor over a reply that streams
            const r = await wsc().sendChatMessage(id, text);
            // the AI failing answers { success: false, error } (chatImpl.js handleSendChatMessage)
            if (r && r.success === false) throw new Error(r.error || r.message || 'The persona could not answer.');
        } catch (err) {
            stopWaiting(id);
            streams.delete(id);
            if (conv && conv.id === id) {
                const e = conv.entries.find((x) => x.pending && x.says === text);
                if (e) conv.entries.splice(conv.entries.indexOf(e), 1);
                inputEl().value = text;
                fitInput();
                renderEntries(true);
                if (isCurrent()) sh.refreshSoftKeys();
            }
            failBox('The message was not sent.', err);
            return;
        }
        // streaming mode resolves on completion (chatInbound.js); the complete handler reloads too
        finishReply(id);
    }

    async function finishReply(id) {
        stopWaiting(id);
        streams.delete(id);
        if (conv && conv.id === id) {
            try { await loadConversation(false); } catch (_) { /* keeps what it has */ }
            if (conv && conv.id === id) {
                renderEntries(true);
                if (isCurrent()) sh.refreshSoftKeys();
            }
        }
        // the list's order and dates follow the server
        try { await loadSessions(); } catch (_) { /* old list */ }
        if (conv && conv.id === id) conv.session = sessionById(id) || conv.session;
        if (view() === 'list') renderList();
    }

    // ---------------------------------------------------------------- stream

    function streamFor(msg, make) {
        let id = msg && msg.chatId;
        if (!id) return null;
        // the persona's first words while a new chat is being made
        if (creating && conv && conv.id === 'new' && !sessionById(id)) conv.pendingId = id;
        if (!streams.has(id) && make) streams.set(id, { events: [] });
        const st = streams.get(id) || null;
        if (st) watchStream(id, st);
        return st;
    }

    /**
     * The server sends no message when a reply fails after its start (chatImpl.js: a missing AI key,
     * an AI error): a stream with no news for STALL_MS ends here, so the thread and Send never wait forever.
     */
    const STALL_MS = 45000;
    function watchStream(id, st) {
        clearTimeout(st.stall);
        st.stall = setTimeout(() => {
            if (streams.get(id) !== st) return;
            streams.delete(id);
            stopWaiting(id);
            const s = sessionById(id);
            if (showingChat(id)) { paintLive(); renderEntries(); if (isCurrent()) sh.refreshSoftKeys(); }
            sh.notify({ title: s ? titleOf(s) : 'Chat', icon: 'warning', text: st.events.length ? 'The reply stopped before it was finished.' : 'The persona did not answer. The chat service may be unavailable; try again later.' });
            finishReply(id);
        }, STALL_MS);
    }

    const showingChat = (id) => !!(conv && (conv.id === id || conv.pendingId === id) && view() === 'conv');

    function onStreamStart(msg) {
        const st = streamFor(msg, true);
        if (!st) return;
        if (showingChat(msg.chatId)) { paintLive(); if (isCurrent()) sh.refreshSoftKeys(); }
    }

    function onStreamUpdate(msg) {
        const st = streamFor(msg, true);
        if (!st || !Array.isArray(msg.events)) return;
        // updates resend earlier events: merged by (timestamp, type) as on the desktop
        for (const ev of msg.events) {
            const at = st.events.findIndex((e) => e.timestamp === ev.timestamp && e.type === ev.type);
            if (at >= 0) st.events[at] = ev; else st.events.push(ev);
        }
        st.events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (showingChat(msg.chatId)) paintLive();
    }

    function onStreamComplete(msg) {
        const id = msg && msg.chatId;
        if (!id) return;
        const st = streams.get(id);
        const said = st ? eventsText(st.events, (e) => e.type).says : '';
        if (creating && conv && conv.pendingId === id) { streams.delete(id); return; } // create() reloads
        const viewing = showingChat(id) && isCurrent() && !document.hidden;
        finishReply(id);
        if (!viewing && said) {
            const s = sessionById(id);
            sh.notify({ title: s ? titleOf(s) : 'Chat', text: said.length > 140 ? `${said.slice(0, 137)}...` : said, icon: 'info', buttons: [{ text: 'Open', onClick: () => openFromNotice(id) }] });
        }
    }

    function onMessageResponse(msg) {
        const d = msg && msg.data;
        if (d && d.chatId && d.streaming === false) finishReply(d.chatId);
    }

    async function openFromNotice(id) {
        sh.open(APP_ID);
        if (!sessionById(id)) await refresh({ quiet: true });
        const s = sessionById(id);
        if (s) openConversation(s, { replace: true });
    }

    let streamHooked = false;
    function hookStream() {
        if (streamHooked || typeof registerWsInboundHandler !== 'function') return; // eslint-disable-line no-undef
        streamHooked = true;
        // wsClient.on never sees chat_* messages (websocket.js sends them only to the registry's 'only' phase)
        const reg = (type, fn) => registerWsInboundHandler({ id: `wmChat.${type}`, type, phase: 'only', priority: -10, handler: (m) => { try { fn(m); } catch (err) { console.warn('[wmChat]', type, err); } } }); // eslint-disable-line no-undef
        reg('chat_streaming_start', onStreamStart);
        reg('chat_streaming_update', onStreamUpdate);
        reg('chat_streaming_complete', onStreamComplete);
        reg('chat_message_response', onMessageResponse);
    }

    // ---------------------------------------------------------------- actions

    async function deleteChat(s) {
        if (!s) return;
        const yes = await sh.messageBox({ title: 'Chat', icon: 'warning', text: `"${titleOf(s)}" will be deleted with all its messages. This cannot be undone. Continue?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        try {
            await sh.busy(async () => {
                const r = await wsc().deleteChatSession(s.id);
                if (r && r.success === false) throw new Error(r.message || r.error || 'The server refused.');
                previews.delete(s.id);
                sessions = sessions.filter((x) => x.id !== s.id);
            }, { paint: true });
        } catch (err) { failBox('The chat could not be deleted.', err); return; }
        if (conv && conv.id === s.id) { layers = []; conv = null; showLayer(); sh.syncHistory(); }
        if (selectedId === s.id) selectedId = null;
        renderList();
    }

    async function restartChat(s) {
        if (!s) return;
        const yes = await sh.messageBox({ title: 'Restart Chat', icon: 'question', text: 'Restart this chat? This will clear all its messages.', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        try {
            await sh.busy(async () => {
                const r = await wsc().restartChatSession(s.id);
                if (r && r.success === false) throw new Error(r.message || r.error || 'The server refused.');
                previews.delete(s.id);
                if (conv && conv.id === s.id) await loadConversation(false);
            }, { paint: true });
        } catch (err) { failBox('The chat could not be restarted.', err); return; }
        if (conv && conv.id === s.id) renderEntries(true);
        loadPreviews();
    }

    async function deleteEntry(e) {
        if (!e || !e.ids.length) return;
        const yes = await sh.messageBox({ title: 'Chat', icon: 'warning', text: 'Delete this message? This cannot be undone.', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        try {
            await sh.busy(async () => {
                for (const id of e.ids) {
                    const r = await wsc().deleteChatMessage(id);
                    if (r && r.success === false) throw new Error(r.message || r.error || 'The server refused.');
                }
                await loadConversation(false);
            }, { paint: true });
        } catch (err) { failBox('The message could not be deleted.', err); }
        renderEntries();
    }

    function copyEntry(e) {
        const text = [e.says, e.actions ? `*${e.actions}*` : '', e.sfx ? `~${e.sfx}~` : ''].filter(Boolean).join('\n');
        try { navigator.clipboard.writeText(text); } catch (_) { /* no clipboard */ }
    }

    function toggleActions() {
        showActions = !showActions;
        store(ACTIONS_KEY, showActions ? '1' : '0');
        renderEntries();
    }

    /** New Chat: a gallery picture is the persona (WM's Open dialog over Pictures). */
    function choosePicture(then) {
        const fd = window.wmFileDialogs;
        if (!fd || typeof fd.open !== 'function') { failBox('Pictures cannot be opened here.'); return; }
        fd.open({
            title: 'Choose a Picture',
            appTitle: 'Chat',
            typeLabel: 'Pictures',
            pictures: true,
            accept: (i) => !!pictureFile(i),
            onPick(item) {
                const f = pictureFile(item);
                if (!f) return false;
                // the dialog closes back to this app first
                setTimeout(() => then(f, item.name), 0);
                return true;
            }
        });
    }

    function pictureFile(item) {
        if (!item) return null;
        if (item.targetKind === 'image' || item.targetKind === 'scrap') return item.previewImageFilename || item.targetId || null;
        if (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) return item.shortcutData.filename;
        return null;
    }

    // ---------------------------------------------------------------- new chat form

    function openForm(filename, name) {
        draft = { filename, name: name || '', seed: '', story: '', viewer: '', verbosity: String((window.chatSystem && window.chatSystem.personaSettings && window.chatSystem.personaSettings.default_verbosity) || '3') };
        if (!VERBOSITY.some(([v]) => v === draft.verbosity)) draft.verbosity = '3';
        renderForm();
        if (view() === 'new') showLayer(); else push('new');
        // the picture's own character name and creative directive, as the desktop prefills them
        const token = draft;
        if (!connected()) return;
        wsc().sendMessage('request_image_metadata', { filename }).then((md) => {
            if (draft !== token || !md) return;
            const metaName = md.character_name || md.characterName;
            const directive = md.dynamic_generation && md.dynamic_generation.directive;
            const nameEl = page.querySelector('[data-f="name"]');
            const seedEl = page.querySelector('[data-f="seed"]');
            if (metaName && !draft.name && nameEl && !nameEl.value) { draft.name = metaName; nameEl.value = metaName; }
            if (directive && String(directive).trim() && seedEl && !seedEl.value) { draft.seed = String(directive).trim(); seedEl.value = draft.seed; }
        }).catch(() => { /* blank fields */ });
    }

    function renderForm() {
        const ui = window.wmSettings && window.wmSettings.ui;
        const box = page.querySelector('.wch-newview');
        if (!draft) { box.innerHTML = ''; return; }
        const verb = (VERBOSITY.find(([v]) => v === draft.verbosity) || VERBOSITY[2])[1];
        box.innerHTML = `
            <div class="wm-form-hdr">New Chat</div>
            <div class="wch-form-scroll"><div class="wm-form wch-form">
                <div class="wch-form-pic">
                    <img src="${esc(pictureOf(draft.filename))}" alt="" draggable="false" onerror="this.src='/static_images/icon-96x96.png'">
                    <div><div class="wch-form-file">${esc(draft.filename)}</div>
                    <button type="button" class="wm-button" data-act="picture">Change...</button></div>
                </div>
                <div class="wm-form-row is-wide"><label for="wchName">Name:</label><input id="wchName" class="wm-edit" type="text" autocomplete="off" data-f="name" value="${esc(draft.name)}" placeholder="(optional)"></div>
                <div class="wm-form-row is-wide"><span class="wm-form-label">Verbosity:</span>${ui ? ui.comboHtml('verbosity', verb) : `<button type="button" class="wm-combo" data-act="verbosity"><span>${esc(verb)}</span></button>`}</div>
                <div class="wm-form-sub"><label for="wchSeed">Mind Seed:</label></div>
                <textarea id="wchSeed" class="wm-edit wch-area" data-f="seed" rows="3" placeholder="Character context or personality traits">${esc(draft.seed)}</textarea>
                <div class="wm-form-sub"><label for="wchStory">Story So Far (Optional):</label></div>
                <textarea id="wchStory" class="wm-edit wch-area" data-f="story" rows="3" placeholder="What has happened so far">${esc(draft.story)}</textarea>
                <div class="wm-form-sub"><label for="wchViewer">Viewer Context:</label></div>
                <textarea id="wchViewer" class="wm-edit wch-area" data-f="viewer" rows="3" placeholder="Your character or relationship">${esc(draft.viewer)}</textarea>
            </div></div>`;
        const combo = box.querySelector('[data-act="verbosity"]');
        if (ui) ui.bindCombo(combo, VERBOSITY, draft.verbosity, (v) => { if (draft) draft.verbosity = v; });
        box.querySelector('[data-act="picture"]').addEventListener('click', () => choosePicture((f) => { if (draft) { readForm(); draft.filename = f; renderForm(); } }));
    }

    function readForm() {
        if (!draft || !page) return;
        const v = (f) => { const el = page.querySelector(`[data-f="${f}"]`); return el ? el.value : ''; };
        draft.name = v('name');
        draft.seed = v('seed');
        draft.story = v('story');
        draft.viewer = v('viewer');
    }

    async function createChat() {
        if (!draft || creating) return;
        readForm();
        if (!connected()) { failBox('The chat was not started: the server connection is down.'); return; }
        const d = draft;
        const data = {
            filename: d.filename,
            characterName: d.name.trim() || null,
            textContextInfo: d.seed.trim() || null,
            textViewerInfo: d.viewer.trim() || null,
            storyContext: d.story.trim() || null,
            verbosityLevel: parseInt(d.verbosity, 10) || 3,
            provider: 'deepinfra',
            model: (window.optionsData && window.optionsData.chatModel) || null
        };
        // the conversation opens at once: the persona's first words stream in while it is made
        creating = true;
        conv = { id: 'new', session: { filename: d.filename, chat_name: data.characterName, character_name: data.characterName }, entries: [], rows: [], hasMore: false, offset: 0 };
        layers = ['conv'];
        draft = null;
        renderConvHead();
        renderEntries(true);
        showLayer();
        sh.syncHistory();
        let r = null;
        try {
            await ensureChat();
            r = await sh.busy(() => wsc().createChatSession(data), { delay: 1500, timeout: 60000 });
            if (!r || !r.success) throw new Error((r && (r.message || r.error)) || 'The server did not make the chat.');
        } catch (err) {
            creating = false;
            if (conv && conv.id === 'new') { if (conv.pendingId) streams.delete(conv.pendingId); layers = []; conv = null; showLayer(); sh.syncHistory(); }
            failBox('The chat could not be started.', err);
            return;
        }
        creating = false;
        const id = r.chatId;
        try { await loadSessions(); } catch (_) { /* below */ }
        const s = sessionById(id) || { id, filename: d.filename, chat_name: data.characterName, character_name: data.characterName };
        if (conv && conv.id === 'new') {
            const pend = conv.pendingId;
            conv = { id, session: s, entries: [], rows: [], hasMore: false, offset: 0 };
            if (pend && pend !== id && streams.has(pend)) { streams.set(id, streams.get(pend)); streams.delete(pend); }
            selectedId = id;
            renderConvHead();
            try { await loadConversation(false); } catch (_) { /* empty */ }
            renderEntries(true);
            if (isCurrent()) sh.refreshSoftKeys();
        }
        renderList();
    }

    function newChat() {
        choosePicture((f, name) => {
            sh.open(APP_ID);
            openForm(f, null, name);
        });
    }

    // ---------------------------------------------------------------- menus

    function listMenu() {
        const s = selectedSession();
        const personas = [...new Set(sessions.map(personaOf))].sort((a, b) => a.localeCompare(b));
        return [
            { label: 'Open', disabled: !s, action: () => openConversation(s) },
            { label: 'New Chat...', action: newChat },
            '-',
            { label: 'Restart Chat...', disabled: !s, action: () => restartChat(s) },
            { label: 'Delete Chat', disabled: !s, action: () => deleteChat(s) },
            '-',
            { label: 'Show', submenu: () => [{ label: 'All Chats', radio: filter === '*', action: () => setFilter('*') }].concat(personas.map((p) => ({ label: p, radio: filter === p, action: () => setFilter(p) }))) },
            { label: 'Sort By', submenu: () => [['date', 'Date'], ['name', 'Name']].map(([k, l]) => ({ label: l, radio: sort === k, action: () => setSort(k) })) },
            '-',
            { label: 'Refresh', action: () => refresh() }
        ];
    }

    function convMenu() {
        const s = conv && conv.id !== 'new' ? (sessionById(conv.id) || conv.session) : null;
        return [
            { label: 'Send', disabled: !canSend(), action: send },
            { label: 'Clear Text', disabled: !inputEl().value, action: () => { inputEl().value = ''; fitInput(); sh.refreshSoftKeys(); } },
            '-',
            { label: 'Show Actions and Sounds', checked: showActions, action: toggleActions },
            { label: 'Older Messages', disabled: !(conv && conv.hasMore), action: loadOlder },
            '-',
            { label: 'New Chat with Persona...', disabled: !s, action: () => openForm(s.filename, s.character_name) },
            { label: 'Restart Chat...', disabled: !s, action: () => restartChat(s) },
            { label: 'Delete Chat', disabled: !s, action: () => deleteChat(s) }
        ];
    }

    function formMenu() {
        return [
            { label: 'Create', action: createChat },
            { label: 'Change Picture...', action: () => choosePicture((f) => { if (draft) { readForm(); draft.filename = f; renderForm(); } }) },
            '-',
            { label: 'Cancel', action: () => { popLayer(); sh.syncHistory(); } }
        ];
    }

    function setFilter(f) { filter = f; renderList(); }
    function setSort(k) { sort = k; store(SORT_KEY, k); renderList(); }

    async function loadOlder() {
        if (!conv || !conv.hasMore) return;
        const box = page.querySelector('.wch-history');
        const fromEnd = box.scrollHeight - box.scrollTop;
        try { await sh.busy(() => loadConversation(true), { paint: true }); } catch (err) { failBox('Older messages could not be read.', err); return; }
        renderEntries();
        box.scrollTop = box.scrollHeight - fromEnd;
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
            timer = setTimeout(() => { held = true; fn(row, start.x, start.y); }, 550);
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
        p.classList.add('wm-chat');
        p.innerHTML = `
            <div class="wch-listview">
                <div class="wm-pv-bar wch-bar">
                    <button type="button" class="wm-pv-folder wch-folder" aria-haspopup="menu"><span class="wch-folder-name">All Chats</span><i class="wm-pv-arrow"></i></button>
                    <button type="button" class="wm-pv-sort wch-sort" aria-haspopup="menu"><span>Date</span><i class="wm-pv-arrow"></i></button>
                </div>
                <div class="wch-scroll"><div class="wch-list" role="listbox" aria-label="Chats"></div><p class="wch-empty" hidden></p></div>
                <div class="wch-status"></div>
            </div>
            <div class="wch-convview" hidden>
                <div class="wch-head"><img class="wch-head-pic" alt="" draggable="false" onerror="this.src='/static_images/icon-96x96.png'"><div class="wch-head-text"><div class="wch-head-name"></div><div class="wch-head-sub"></div></div></div>
                <div class="wch-history" role="log" aria-live="polite"></div>
                <div class="wch-compose"><span class="wch-me" aria-hidden="true"></span><textarea class="wch-input" rows="1" enterkeyhint="send" autocomplete="off" aria-label="Message"></textarea></div>
            </div>
            <div class="wch-newview" hidden></div>`;

        p.querySelector('.wch-folder').addEventListener('click', (e) => {
            e.stopPropagation();
            const personas = [...new Set(sessions.map(personaOf))].sort((a, b) => a.localeCompare(b));
            sh.dropdown(e.currentTarget, [{ label: 'All Chats', radio: filter === '*', action: () => setFilter('*') }].concat(personas.map((n) => ({ label: n, radio: filter === n, action: () => setFilter(n) }))), 'left');
        });
        p.querySelector('.wch-sort').addEventListener('click', (e) => {
            e.stopPropagation();
            sh.dropdown(e.currentTarget, [['date', 'Date'], ['name', 'Name']].map(([k, l]) => ({ label: l, radio: sort === k, action: () => setSort(k) })), 'right');
        });
        const scroll = p.querySelector('.wch-scroll');
        onHold(scroll, '.wch-row', (row, x, y) => {
            selectRow(row.dataset.id);
            const s = sessionById(row.dataset.id);
            sh.menuAt(x, y, [
                { label: 'Open', action: () => openConversation(s) },
                { label: 'Restart Chat...', action: () => restartChat(s) },
                { label: 'Delete Chat', action: () => deleteChat(s) }
            ]);
        });
        scroll.addEventListener('click', (e) => {
            const row = e.target.closest('.wch-row');
            if (!row) return;
            selectRow(row.dataset.id);
            openConversation(sessionById(row.dataset.id));
        });

        const hist = p.querySelector('.wch-history');
        hist.addEventListener('click', (e) => { if (e.target.closest('.wch-more')) loadOlder(); });
        onHold(hist, '.wch-entry', (el, x, y) => {
            const n = Number(el.dataset.n);
            const en = conv && n >= 0 ? conv.entries[n] : null;
            if (!en) return;
            sh.menuAt(x, y, [
                { label: 'Copy Text', action: () => copyEntry(en) },
                { label: 'Delete Message', disabled: !en.ids.length, action: () => deleteEntry(en) }
            ]);
        });

        const input = p.querySelector('.wch-input');
        input.addEventListener('input', () => {
            fitInput();
            if (isCurrent()) sh.refreshSoftKeys();
        });
        input.addEventListener('keydown', (e) => {
            // Enter sends (a hardware keyboard or the input panel's send key); Shift+Enter is a new line
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
        });
    }

    // ---------------------------------------------------------------- desktop routes

    /** Every desktop route to the chat windows opens this app on the phone (the window would open unseen). */
    function patchDesktop() {
        const C = window.ChatSystem;
        const proto = C && C.prototype;
        if (!proto || proto._wmChat) return;
        proto._wmChat = true;
        proto.showAllChats = function () { sh.open(APP_ID); };
        proto.openChatInterfaceModal = function () { sh.open(APP_ID); };
        proto.openChatModal = async function (filename, characterName) {
            if (!filename) { sh.open(APP_ID); return; }
            sh.open(APP_ID);
            openForm(filename, characterName || null);
        };
    }

    function wrapLoader() {
        const fl = window.featureLoader;
        if (!fl || typeof fl.loadFeature !== 'function' || fl.loadFeature._wmChat) return !!(fl && fl.loadFeature && fl.loadFeature._wmChat);
        const orig = fl.loadFeature;
        const wrapped = function (name) {
            const r = orig.apply(this, arguments);
            if (name === 'chat') Promise.resolve(r).then(() => { patchDesktop(); setTimeout(patchDesktop, 1500); }, () => {});
            return r;
        };
        wrapped._wmChat = true;
        fl.loadFeature = wrapped;
        return true;
    }

    // ---------------------------------------------------------------- app

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        hookStream();
        patchDesktop();
        if (!wrapLoader()) { let n = 0; const t = setInterval(() => { if (wrapLoader() || ++n > 60) clearInterval(t); }, 500); }
        sh.registerApp({
            id: APP_ID,
            title: 'Chat',
            icon: 'app-chat',
            inStart: 'programs',
            sip: true,
            mount,
            show() {
                shown = true;
                showLayer();
                if (view() === 'list') refresh({ quiet: loaded });
                else if (view() === 'conv') renderEntries();
            },
            hide() { shown = false; },
            // WM: X on the list, ok on a conversation and on the new chat form (ok creates it)
            titleKind: () => (view() === 'list' ? 'close' : 'ok'),
            onTitleOk() {
                if (view() === 'new') { createChat(); return true; }
                if (view() === 'conv') { popLayer(); return true; }
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
                if (v === 'new') return { left: { label: 'Create', disabled: creating, action: createChat }, right: { label: 'Menu', menu: formMenu } };
                return { left: { label: 'New', action: newChat }, right: { label: 'Menu', menu: listMenu } };
            }
        });
        void shown;
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
