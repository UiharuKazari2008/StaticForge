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
 * #757: Chat is Messaging's Text Messages account (the account picker, Go To and the folder tree name
 * it), drawn as the device's Text Messages (Yukimi's 31 screenshots, tmp/wmss 173927-174305): the list
 * rows are conversations (envelope, "Name (unread)", date, size, the last line; unread bold), the
 * status line "1 conversation selected", the conversation an HTML-style thread ("Conversation with
 * <persona>", an "Older" link, "Name (M/D):" headers in link green over each message, unread bold,
 * the selected one on pale blue) over a white reply box. Unread = persona lines newer than when the
 * conversation was last open (localStorage wmChatSeen). The menus follow 173945 / 174005.
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
    const SEEN_KEY = 'wmChatSeen'; // { chatId: ms } when each conversation was last read
    const DRAFTS_KEY = 'wmChatDrafts'; // { chatId: text } Save to Drafts
    // the account's name (#779: Text Messages is the device's own name, now the Text Messaging accounts')
    const SMS_TITLE = 'Dreamscape Messenger';
    // WM 6.1's My Text phrases (Menu > My Text)
    const MY_TEXT = ['Yes.', 'No.', 'I\'m running late.', 'Where are you?', 'Can you talk?', 'Call me.', 'Thank you.', 'I\'ll be there.', 'Talk to you later.', 'I love you.'];
    const ACTIONS_KEY = 'wmChatShowActions';
    const EVENTS_KEY = 'wmChatShowEvents'; // the desktop's "4th wall events" (memory, emotion, plans ...)
    // the desktop's metadata events (chatSystem.js CHAT_METADATA_EVENT_TYPES) and their names there
    const META = { memory: 'Memory', environment: 'Environment', sensory: 'Sensory', emotion: 'Emotion', location: 'Location', timeofday: 'Time', innerspeech: 'Inner Thought', currplan: 'Current Plan', futureplans: 'Future Plans', trustlevel: 'Trust', inventory: 'Inventory', offlinemessage: 'Message' };
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
    let sort = stored(SORT_KEY) === 'name' ? 'name' : 'date';
    let showActions = stored(ACTIONS_KEY) === '1';
    let showEvents = stored(EVENTS_KEY) === '1';
    const previews = new Map(); // chatId -> { stamp, text }
    let previewGen = 0;

    let smsFolder = 'inbox'; // the Text Messages folder on screen (only the Inbox holds chats)
    let selEntry = -1; // the selected message of the conversation
    let unreadFrom = 0; // the conversation's lines after this time read bold (when it was opened)
    let seen = null; // SEEN_KEY, read on first use

    let layers = []; // 'conv' | 'new' | 'opts' | 'edit' | 'state'
    let conv = null; // { id, session, entries: [], hasMore, offset }
    let draft = null; // the new-chat form { filename, name, seed, story, viewer, verbosity }
    let editing = null; // Edit Persona: { id, name, seed, story, viewer, verbosity }
    let stateOf = null; // Persona State: { id, session, rows, loading }
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

    /** ms of a date value (0 when unknown). */
    const msOf = (v) => { const d = toDate(v); return d ? d.getTime() : 0; };

    function seenMap() {
        if (seen) return seen;
        try { seen = JSON.parse(stored(SEEN_KEY) || 'null'); } catch (_) { seen = null; }
        if (!seen || typeof seen !== 'object') seen = null;
        return seen;
    }
    function saveSeen() { if (seen) store(SEEN_KEY, JSON.stringify(seen)); }
    /** The first list ever read here counts as read (nothing goes bold from before Text Messages existed). */
    function baselineSeen() {
        if (seenMap()) return;
        seen = {};
        const now = Date.now();
        sessions.forEach((x) => { seen[x.id] = Math.max(now, msOf(x.updated_at)); });
        saveSeen();
    }
    const seenOf = (id) => { const m = seenMap(); return m && m[id] ? Number(m[id]) || 0 : 0; };
    function markSeen(id, at) {
        if (!id || id === 'new') return;
        seenMap();
        if (!seen) seen = {};
        seen[id] = Math.max(Number(at) || Date.now(), seen[id] || 0);
        saveSeen();
    }
    /** The persona's lines in a list of entries that came after the conversation was last read. */
    const unreadIn = (id, ents) => { const t = seenOf(id); return ents.filter((e) => e.kind === 'them' && (e.says || e.actions) && msOf(e.at) > t).length; };

    function draftsOf() { try { return JSON.parse(stored(DRAFTS_KEY) || '{}') || {}; } catch (_) { return {}; } }
    function setDraft(id, text) {
        const d = draftsOf();
        if (text) d[id] = text; else delete d[id];
        store(DRAFTS_KEY, JSON.stringify(d));
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
        return sh.notify({ title: SMS_TITLE, icon: 'error', text: `${text}${why}` });
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
                const meta = ms.filter((m) => META[m.event_type] && m.content).map((m) => ({ type: m.event_type, text: String(m.content) }));
                if (!x.says && !x.actions && !x.sfx && !meta.length) return;
                out.push({ kind: 'them', ...x, meta, ids: ms.map((m) => m.id).filter((id) => id != null), at: ms[0].created_at });
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
        baselineSeen();
        return true;
    }

    /** The list's second line: the last thing said in each chat, read a few rows at a time. */
    async function loadPreviews(only) {
        const gen = ++previewGen;
        const todo = sessions.filter((s) => {
            const p = previews.get(s.id);
            return (!p || p.stamp !== s.updated_at) && (!only || only(s));
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
                    previews.set(s.id, { stamp: s.updated_at, text: last ? (last.says || `*${last.actions}*`) : '', mine: !!(last && last.kind === 'me'), unread: unreadIn(s.id, ents), bytes: ents.reduce((n, e) => n + String(e.says || '').length + String(e.actions || '').length, 0) });
                    if (gen === previewGen && view() === 'list') paintRowPreview(s.id);
                } catch (_) { /* the row keeps its placeholder */ }
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (gen === previewGen) unreadChanged();
    }

    /** The unread count changed: the title bar glyph, Today and its 6.5 panel follow. */
    function unreadChanged() {
        if (!sh) return;
        if (typeof sh.refreshStatus === 'function') sh.refreshStatus();
        const ti = window.wmTitanium;
        if (ti && typeof ti.refresh === 'function') { try { ti.refresh(); } catch (_) { /* next pass */ } }
    }

    /**
     * Unread texts without opening Chat (#763: Today's Messages row, the title bar, the 6.5 text
     * panel): the chat list once, then the threads that changed since they were last read (reading
     * a thread marks nothing). Not the desktop chat feature: that loads when Chat opens.
     */
    let bgDone = false;
    async function bgUnread() {
        if (bgDone || !connected()) return false;
        bgDone = true;
        try { await loadSessions(); } catch (_) { bgDone = false; return false; }
        await loadPreviews((s) => msOf(s.updated_at) > seenOf(s.id));
        unreadChanged();
        return true;
    }

    function scheduleBgUnread() {
        let tries = 0;
        const t = setInterval(() => {
            const c = wsc();
            const ready = document.documentElement.dataset.wmBoot === 'done' && c && c.initializationCompleted && connected();
            if (bgDone || ++tries > 40) { clearInterval(t); return; }
            if (ready) { clearInterval(t); setTimeout(() => { if (!loaded) bgUnread(); }, 8000); }
        }, 3000);
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
        if (last) previews.set(id, { stamp: conv.session && conv.session.updated_at, text: last.says || `*${last.actions}*`, mine: last.kind === 'me', unread: 0, bytes: conv.entries.reduce((n, e) => n + String(e.says || '').length + String(e.actions || '').length, 0) });
    }

    // ---------------------------------------------------------------- list

    function visibleSessions() {
        // only the Inbox holds conversations: Deleted Items, Drafts, Outbox and Sent Items stay empty
        if (smsFolder !== 'inbox') return [];
        let list = sessions.slice();
        if (sort === 'name') {
            const coll = new Intl.Collator(undefined, { sensitivity: 'base' });
            list.sort((a, b) => coll.compare(titleOf(a), titleOf(b)));
        }
        return list;
    }

    /** A conversation row (173927): envelope, "Name (unread)", date, size; the last line under it. */
    function rowHtml(s) {
        const p = previews.get(s.id);
        const sel = s.id === selectedId;
        const unread = p ? p.unread || 0 : 0;
        const line = p ? (p.text || '') : '';
        const kb = `${Math.max(1, Math.ceil(((p && p.bytes) || 0) / 1024))}K`;
        return `<div class="wch-row${sel ? ' is-selected' : ''}${unread ? ' is-unread' : ''}" role="option" aria-selected="${sel}" data-id="${esc(s.id)}">`
            + `<span class="wch-ico" data-ico="${unread ? 'msg-unread' : 'msg-read'}"></span>`
            + `<span class="wch-namecell"><span class="wch-name">${esc(titleOf(s))}</span>${unread ? `<span class="wch-count">(${unread})</span>` : ''}</span>`
            + `<span class="wch-date">${esc(listDate(s.updated_at || s.created_at))}</span><span class="wch-size">${kb}</span>`
            + `<span class="wch-last">${esc(line)}</span></div>`;
    }

    const FOLDER_LABELS = { deleted: 'Deleted Items', drafts: 'Drafts', inbox: 'Inbox', outbox: 'Outbox', sent: 'Sent Items' };

    function renderList() {
        if (!page) return;
        const list = visibleSessions();
        // the device keeps a conversation selected: the first one when none is
        if (!selectedId || !list.some((s) => s.id === selectedId)) selectedId = list.length ? list[0].id : null;
        const box = page.querySelector('.wch-list');
        box.innerHTML = list.map(rowHtml).join('');
        const empty = page.querySelector('.wch-empty');
        empty.hidden = !!list.length || !loaded;
        empty.textContent = smsFolder !== 'inbox' ? 'No messages.' : 'To start a conversation, tap Menu, then New, and choose a picture for the persona.';
        const n = selectedId ? 1 : 0;
        page.querySelector('.wch-status').textContent = `${n} conversation${n === 1 ? '' : 's'} selected`;
        page.querySelector('.wch-folder-name').textContent = FOLDER_LABELS[smsFolder] || 'Inbox';
        page.querySelector('.wch-sort span').textContent = sort === 'name' ? 'From' : 'Received';
        if (isCurrent()) sh.refreshSoftKeys();
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
        page.querySelector('.wch-optsview').hidden = v !== 'opts';
        page.querySelector('.wch-editview').hidden = v !== 'edit';
        page.querySelector('.wch-stateview').hidden = v !== 'state';
        page.dataset.view = v;
        if (v === 'opts') renderOpts();
        if (v === 'state') renderState();
        if (isCurrent()) {
            sh.setTitle(v === 'new' ? 'New Chat' : SMS_TITLE);
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
        if (v === 'conv') { markConvSeen(); conv = null; selEntry = -1; }
        if (v === 'new') draft = null;
        if (v === 'edit') editing = null;
        if (v === 'state') stateOf = null;
        showLayer();
        if (view() === 'list') renderList();
    }

    // ---------------------------------------------------------------- conversation

    async function openConversation(session, opts = {}) {
        if (!session) return;
        if (conv && conv.id !== session.id) markConvSeen();
        conv = { id: session.id, session, entries: [], rows: [], hasMore: false, offset: 0 };
        selectedId = session.id;
        selEntry = -1;
        // what came since the last visit reads bold while the conversation is open
        unreadFrom = seenOf(session.id);
        renderConvHead();
        renderEntries();
        const box = inputEl();
        box.value = draftsOf()[session.id] || '';
        fitInput();
        if (opts.replace) { layers = ['conv']; showLayer(); sh.syncHistory(); } else push('conv');
        try {
            await sh.busy(() => loadConversation(false), { paint: true });
        } catch (err) { failBox('The conversation could not be read.', err); }
        renderEntries(true);
        markConvSeen();
        if (isCurrent()) sh.refreshSoftKeys();
    }

    /** The conversation as read now: its persona lines stop counting as unread. */
    function markConvSeen() {
        if (!conv || conv.id === 'new') return;
        const last = conv.entries.reduce((m, e) => Math.max(m, msOf(e.at)), 0);
        markSeen(conv.id, Math.max(last, Date.now()));
        const p = previews.get(conv.id);
        if (p) p.unread = 0;
        readFresh(conv.id);
    }


    function renderConvHead() {
        // the header is part of the thread (renderEntries); the reply box has no picture column
    }

    /** "(10/19)" for an earlier day, "(4:50 PM)" today, as the thread's headers give it. */
    function headDate(v) {
        const d = toDate(v);
        if (!d) return '';
        return sameDay(d, new Date()) ? fmtTime(d) : `${d.getMonth() + 1}/${d.getDate()}`;
    }

    function entryHtml(e, n, live) {
        const who = e.kind === 'me' ? userName() : personaOf(conv && conv.session);
        let body = '';
        if (e.says) body += `<div class="wch-says">${esc(e.says)}</div>`;
        if (showActions && e.actions) body += `<div class="wch-act">*${esc(e.actions)}*</div>`;
        if (showActions && e.sfx) body += `<div class="wch-sfx">~${esc(e.sfx)}~</div>`;
        // the desktop's 4th wall events, each on its own line under the reply (Message Options)
        if (showEvents && e.meta && e.meta.length) body += e.meta.map((m) => `<div class="wch-meta"><span class="wch-meta-name">${esc(META[m.type])}:</span> ${esc(m.text)}</div>`).join('');
        if (!body) body = live ? '<div class="wch-says wch-typing">...</div>' : '';
        if (!body) return '';
        const unread = e.kind === 'them' && (live || msOf(e.at) > unreadFrom);
        const date = live ? '' : headDate(e.at);
        return `<div class="wch-entry is-${e.kind}${live ? ' is-live' : ''}${unread ? ' is-unread' : ''}${n >= 0 && n === selEntry ? ' is-selected' : ''}" data-n="${n}">`
            + `<span class="wch-eico" data-ico="${unread ? 'msg-unread' : 'msg-read'}"></span>`
            + `<div class="wch-who"><span class="wch-link">${esc(who)}${date ? ` (${esc(date)})` : ''}:</span></div>${body}</div>`;
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
        const persona = personaOf(conv && conv.session);
        let html = `<p class="wch-convhead"><i>Conversation with <span class="wch-link wch-plink" role="link">${esc(persona)}</span></i></p>`;
        html += conv && conv.hasMore ? '<p class="wch-olderp"><a class="wch-more" role="link">Older</a></p>' : '';
        html += list.map((e, n) => entryHtml(e, n, false)).join('');
        const live = liveEntry();
        if (live) html += entryHtml(live, -1, true);
        box.innerHTML = html;
        if (toEnd || atEnd) box.scrollTop = box.scrollHeight;
    }

    function selectEntry(n) {
        selEntry = n;
        page.querySelectorAll('.wch-entry').forEach((el) => el.classList.toggle('is-selected', Number(el.dataset.n) === n && n >= 0));
        if (isCurrent()) sh.refreshSoftKeys();
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
        setDraft(id, '');
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
        if (!viewing && said) arrived(id, said, st && st.events);
        finishReply(id);
    }

    function onMessageResponse(msg) {
        const d = msg && msg.data;
        if (!(d && d.chatId && d.streaming === false)) return;
        // streaming off on the server: the whole reply comes at once (chatImpl.js extractEventsByType)
        const r = d.response || {};
        const first = (k) => (Array.isArray(r[k]) && r[k].length ? String(r[k][0]) : '');
        const said = first('speechdirect') || first('speech') || first('reply');
        const viewing = showingChat(d.chatId) && isCurrent() && !document.hidden;
        if (!viewing && said && d.success !== false) arrived(d.chatId, said, null);
        finishReply(d.chatId);
    }

    // ---------------------------------------------------------------- new text message (#763)

    /**
     * A persona's reply that came while its conversation was not on screen (another program in
     * front, the list, another conversation, the phone asleep). The thread counts it unread
     * (Today's Messaging row, Messaging's picker, the title bar's Messenger buddy glyph,
     * WLMMessengerResources icon 12000) and a notification comes up in Dreamscape Messenger's own
     * class, 'chat' (#779: text messages are 'sms'), drawn like the device's new message notice: the
     * sender and the text, "You have N new messages." with several. Settings > Sounds &
     * Notifications' "Dreamscape Messenger: New message" decides its sound, repeat, whether the
     * bubble shows and vibration (wmShell noteEvent / playSystemSound). Tapping the text opens that
     * conversation; with several waiting it opens the list.
     */
    const fresh = new Map(); // chatId -> { said, at }: replies not read yet, in arrival order
    let smsNote = null;
    const SMS_ICON = 'status-messenger';

    function arrived(id, said, events) {
        void events;
        const p = previews.get(id);
        const line = said.length > 160 ? `${said.slice(0, 157)}...` : said;
        // the list's row: the new line, one more unread (until loadPreviews reads the thread again)
        previews.set(id, { stamp: p ? p.stamp : null, text: said, mine: false, unread: ((p && p.unread) || 0) + 1, bytes: (p && p.bytes) || said.length });
        fresh.delete(id);
        fresh.set(id, { said: line, at: Date.now() });
        showSmsNote();
        if (view() === 'list' && page) paintRowPreview(id);
        if (typeof sh.refreshStatus === 'function') sh.refreshStatus();
    }

    function closeSmsNote() {
        if (smsNote) { try { smsNote.close(); } catch (_) { /* gone */ } }
        smsNote = null;
    }

    function showSmsNote() {
        closeSmsNote(); // a new arrival is a new notification: it sounds and comes up again
        if (!fresh.size || typeof sh.appNote !== 'function') return;
        const n = fresh.size;
        const [id, last] = [...fresh.entries()].pop();
        const s = sessionById(id);
        const html = n === 1
            ? `<button type="button" class="wch-note-open"><span class="wch-note-from">From: ${esc(personaOf(s))}</span><span class="wch-note-text">${esc(last.said)}</span></button>`
            : `<button type="button" class="wch-note-open"><span class="wch-note-text">You have ${n} new messages.</span></button>`;
        const open = () => { const one = fresh.size === 1 ? [...fresh.keys()][0] : null; closeSmsNote(); if (one != null) openFromNotice(one); else if (window.wmChatApp) window.wmChatApp.showList(); };
        const icon = SMS_ICON;
        const note = sh.appNote({
            title: SMS_TITLE,
            html,
            icon,
            event: 'chat',
            softKeys: () => ({
                left: { label: 'Dismiss', action: () => closeSmsNote() },
                right: { label: 'Menu', menu: () => [
                    { label: n === 1 ? 'Reply' : 'View', action: open },
                    { label: 'Hide', action: () => { if (smsNote) smsNote.hide(); } }
                ] }
            })
        });
        if (!note) return;
        smsNote = note;
        // the bubble's copy forwards a tap on its button to this toast's own button
        const el = document.getElementById(note.id);
        if (el) el.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.wch-note-open')) open(); });
    }

    /** A conversation read: its replies are no longer new (the notification follows). */
    function readFresh(id) {
        if (!fresh.delete(id)) return;
        if (fresh.size) showSmsNoteQuiet(); else closeSmsNote();
        if (typeof sh.refreshStatus === 'function') sh.refreshStatus();
    }

    /** What is still waiting, without a new sound: the note's text changes in place. */
    function showSmsNoteQuiet() {
        if (!smsNote || !fresh.size) { closeSmsNote(); return; }
        const n = fresh.size;
        const [id, last] = [...fresh.entries()].pop();
        smsNote.update({
            title: SMS_TITLE,
            html: n === 1
                ? `<button type="button" class="wch-note-open"><span class="wch-note-from">From: ${esc(personaOf(sessionById(id)))}</span><span class="wch-note-text">${esc(last.said)}</span></button>`
                : `<button type="button" class="wch-note-open"><span class="wch-note-text">You have ${n} new messages.</span></button>`
        });
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
        const yes = await sh.messageBox({ title: SMS_TITLE, icon: 'warning', text: `The conversation with ${personaOf(s)} ("${titleOf(s)}") will be deleted with all its messages. This cannot be undone. Continue?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
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
        const yes = await sh.messageBox({ title: SMS_TITLE, icon: 'question', text: 'Restart this conversation? This will clear all its messages.', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
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
        const yes = await sh.messageBox({ title: SMS_TITLE, icon: 'warning', text: 'Delete this message? This cannot be undone.', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
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
        selEntry = -1;
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

    const msgApi = () => window.wmMessaging || null;
    /** Messaging's Go To: Folders... then the accounts, ours marked (164304 / 173945). */
    function goToItems() {
        const m = msgApi();
        const accts = m && typeof m.accountItems === 'function' ? m.accountItems('sms') : [];
        return [{ label: 'Folders...', action: () => openTree() }, '-'].concat(accts);
    }

    function openTree(anchor) {
        const m = msgApi();
        if (!m || typeof m.showTree !== 'function') return;
        m.showTree(anchor || page.querySelector('.wch-folder'), { acct: 'sms', folder: smsFolder, onPick: (f) => setFolder(f) });
    }

    function setFolder(f) {
        smsFolder = FOLDER_LABELS[f] ? f : 'inbox';
        renderList();
    }

    function sortItems() {
        return [['date', 'Received'], ['name', 'From']].map(([k, l]) => ({ label: l, radio: sort === k, action: () => setSort(k) }));
    }

    function optionsAction() {
        const st = window.wmSettings;
        if (st && typeof st.open === 'function') st.open('messaging-options', null, { direct: true });
    }

    function markRead(s) {
        if (!s) return;
        const p = previews.get(s.id);
        markSeen(s.id, Math.max(Date.now(), msOf(s.updated_at)));
        if (p) p.unread = 0;
        readFresh(s.id);
        renderList();
    }

    /** The list menu (173945): New, Delete, Mark as Read, Move... | Go To, Tools | Select Messages, Reply. */
    function listMenu() {
        const s = selectedSession();
        const p = s ? previews.get(s.id) : null;
        return [
            { label: 'New', action: newChat },
            { label: 'Delete', disabled: !s, action: () => deleteChat(s) },
            { label: 'Mark as Read', disabled: !(p && p.unread), action: () => markRead(s) },
            { label: 'Move...', disabled: true },
            '-',
            { label: 'Go To', submenu: goToItems },
            { label: 'Tools', submenu: () => [
                { label: 'Sort By', submenu: sortItems },
                { label: 'Manage Folders...', disabled: true },
                '-',
                { label: 'Empty Deleted Items', disabled: true },
                { label: 'Restart Conversation...', disabled: !s, action: () => restartChat(s) },
                { label: 'Edit Persona...', disabled: !s, action: () => openEdit(s) },
                { label: 'Persona State...', disabled: !s, action: () => openState(s) },
                '-',
                { label: 'New Account...', disabled: !(msgApi() && msgApi().setupAccount), action: () => msgApi().setupAccount() },
                { label: 'Options...', disabled: !(window.wmSettings && typeof window.wmSettings.open === 'function'), action: optionsAction },
                { label: 'Account Options...', disabled: !(window.wmSettings && typeof window.wmSettings.openChatOptions === 'function'), action: () => window.wmSettings.openChatOptions() }
            ] },
            '-',
            { label: 'Select Messages', submenu: () => [{ label: 'All', disabled: true }, { label: 'All Below', disabled: true }, { label: 'Several', disabled: true }] },
            { label: 'Reply', submenu: () => [
                { label: 'Reply', disabled: !s, action: () => openConversation(s) },
                { label: 'Reply All', disabled: true },
                { label: 'Forward', disabled: !(s && p && p.text), action: () => forwardText(p.text) }
            ] }
        ];
    }

    /** Forward: the text in a new e-mail (Messaging), as the device forwards a text message. */
    function forwardText(text) {
        if (!text || typeof window.wmMessagingCompose !== 'function') return;
        window.wmMessagingCompose({ body: text });
    }

    function entryText(e) {
        return e ? [e.says, e.actions ? `*${e.actions}*` : '', e.sfx ? `~${e.sfx}~` : ''].filter(Boolean).join('\n') : '';
    }

    function insertText(t) {
        const box = inputEl();
        const a = box.selectionStart == null ? box.value.length : box.selectionStart;
        const b = box.selectionEnd == null ? a : box.selectionEnd;
        box.value = box.value.slice(0, a) + t + box.value.slice(b);
        box.selectionStart = box.selectionEnd = a + t.length;
        fitInput();
        if (isCurrent()) sh.refreshSoftKeys();
    }

    /** The conversation menu (174005). */
    function convMenu() {
        const s = conv && conv.id !== 'new' ? (sessionById(conv.id) || conv.session) : null;
        const en = conv && selEntry >= 0 ? conv.entries[selEntry] : null;
        return [
            { label: 'Delete', disabled: !(en && en.ids.length), action: () => deleteEntry(en) },
            { label: 'Forward', disabled: !en || typeof window.wmMessagingCompose !== 'function', action: () => forwardText(entryText(en)) },
            { label: 'Insert', disabled: true, submenu: () => [] },
            { label: 'My Text', submenu: () => MY_TEXT.map((t) => ({ label: t, action: () => insertText(t) })) },
            { label: 'Save to Drafts', disabled: !s, action: () => { setDraft(s.id, inputEl().value.trim() ? inputEl().value : ''); } },
            { label: 'Spell Check', disabled: !(window.wmMessaging && typeof window.wmMessaging.spellCheckField === 'function'), action: () => window.wmMessaging.spellCheckField(inputEl()) },
            { label: 'Persona', disabled: !s, submenu: () => personaItems(s) },
            '-',
            { label: 'Close', action: () => { popLayer(); sh.syncHistory(); } },
            { label: 'Message Options', action: () => push('opts') },
            { label: 'Copy to SIM', disabled: true }
        ];
    }

    /** Message Options: what the thread shows of a reply besides its words. */
    function renderOpts() {
        const box = page.querySelector('.wch-optsview');
        const ui = window.wmSettings && window.wmSettings.ui;
        const check = (name, label, on, attrs = '') => (ui ? ui.check(name, label, on, attrs) : `<label class="wm-check"><input type="checkbox" name="${name}"${on ? ' checked' : ''} ${attrs}><span>${esc(label)}</span></label>`);
        box.innerHTML = `<div class="wm-form-hdr">Message Options</div><div class="wch-form-scroll"><div class="wm-form">
            ${check('actions', 'Show actions and sound effects', showActions)}
            ${check('events', 'Show 4th wall events (memory, emotion, plans)', showEvents)}
            ${check('receipt', 'Request message delivery notification', false, 'disabled')}
        </div></div>`;
        box.querySelector('input[name="actions"]').addEventListener('change', (e) => { if (e.target.checked !== showActions) toggleActions(); });
        box.querySelector('input[name="events"]').addEventListener('change', (e) => {
            showEvents = e.target.checked;
            store(EVENTS_KEY, showEvents ? '1' : '0');
            renderEntries();
        });
    }

    function formMenu() {
        return [
            { label: 'Create', action: createChat },
            { label: 'Change Picture...', action: () => choosePicture((f) => { if (draft) { readForm(); draft.filename = f; renderForm(); } }) },
            '-',
            { label: 'Cancel', action: () => { popLayer(); sh.syncHistory(); } }
        ];
    }

    function setSort(k) { sort = k; store(SORT_KEY, k); renderList(); }

    async function loadOlder() {
        if (!conv || !conv.hasMore) return;
        const box = page.querySelector('.wch-history');
        const fromEnd = box.scrollHeight - box.scrollTop;
        try { await sh.busy(() => loadConversation(true), { paint: true }); } catch (err) { failBox('Older messages could not be read.', err); return; }
        renderEntries();
        box.scrollTop = box.scrollHeight - fromEnd;
    }

    // ---------------------------------------------------------------- persona (#763)

    /**
     * Edit Persona: the fields a chat was made with (Name, Verbosity, Mind Seed, Story So Far, Viewer
     * Context), changed on the server with update_chat_context (chatImpl.js handleUpdateChatContext;
     * a new Name renames the chat too). The persona's picture is the gallery picture the chat was
     * made from: the server has no call to change it, so it shows and does not change.
     */
    function openEdit(s) {
        if (!s) return;
        const v = String(s.verbosity_level || '3');
        editing = { id: s.id, filename: s.filename, name: s.character_name || s.chat_name || '', verbosity: VERBOSITY.some(([k]) => k === v) ? v : '3', seed: s.text_context_info || '', story: s.story_context || '', viewer: s.text_viewer_info || '' };
        editing.initial = JSON.stringify([editing.name, editing.verbosity, editing.seed, editing.story, editing.viewer]);
        renderEdit();
        if (view() === 'edit') showLayer(); else push('edit');
    }

    function renderEdit() {
        const ui = window.wmSettings && window.wmSettings.ui;
        const box = page.querySelector('.wch-editview');
        if (!editing) { box.innerHTML = ''; return; }
        const e = editing;
        const verb = (VERBOSITY.find(([v]) => v === e.verbosity) || VERBOSITY[2])[1];
        box.innerHTML = `
            <div class="wm-form-hdr">Edit Persona</div>
            <div class="wch-form-scroll"><div class="wm-form wch-form">
                <div class="wch-form-pic">
                    <img src="${esc(pictureOf(e.filename))}" alt="" draggable="false" onerror="this.src='/static_images/icon-96x96.png'">
                    <div><div class="wch-form-file">${esc(e.filename || '')}</div></div>
                </div>
                <div class="wm-form-row is-wide"><label for="wchEName">Name:</label><input id="wchEName" class="wm-edit" type="text" autocomplete="off" data-e="name" value="${esc(e.name)}"></div>
                <div class="wm-form-row is-wide"><span class="wm-form-label">Verbosity:</span>${ui ? ui.comboHtml('everbosity', verb) : `<button type="button" class="wm-combo" data-act="everbosity"><span>${esc(verb)}</span></button>`}</div>
                <div class="wm-form-sub"><label for="wchESeed">Mind Seed:</label></div>
                <textarea id="wchESeed" class="wm-edit wch-area" data-e="seed" rows="3"></textarea>
                <div class="wm-form-sub"><label for="wchEStory">Story So Far:</label></div>
                <textarea id="wchEStory" class="wm-edit wch-area" data-e="story" rows="3"></textarea>
                <div class="wm-form-sub"><label for="wchEViewer">Viewer Context:</label></div>
                <textarea id="wchEViewer" class="wm-edit wch-area" data-e="viewer" rows="3"></textarea>
            </div></div>`;
        box.querySelector('[data-e="seed"]').value = e.seed;
        box.querySelector('[data-e="story"]').value = e.story;
        box.querySelector('[data-e="viewer"]').value = e.viewer;
        if (ui) ui.bindCombo(box.querySelector('[data-act="everbosity"]'), VERBOSITY, e.verbosity, (v) => { if (editing) editing.verbosity = v; });
    }

    function readEdit() {
        if (!editing || !page) return;
        const v = (f) => { const el = page.querySelector(`.wch-editview [data-e="${f}"]`); return el ? el.value : ''; };
        editing.name = v('name');
        editing.seed = v('seed');
        editing.story = v('story');
        editing.viewer = v('viewer');
    }

    async function saveEdit() {
        if (!editing || editing.saving) return;
        readEdit();
        const e = editing;
        if (JSON.stringify([e.name, e.verbosity, e.seed, e.story, e.viewer]) === e.initial) { popLayer(); sh.syncHistory(); return; }
        if (!connected()) { failBox('The persona was not changed: the server connection is down.'); return; }
        e.saving = true;
        try {
            await sh.busy(async () => {
                const r = await wsc().sendMessage('update_chat_context', {
                    chatId: e.id,
                    characterName: e.name.trim(),
                    verbosityLevel: parseInt(e.verbosity, 10) || 3,
                    textContextInfo: e.seed.trim(),
                    storyContext: e.story.trim(),
                    textViewerInfo: e.viewer.trim()
                });
                const d = r && r.data && r.data.success !== undefined ? r.data : r;
                if (!d || d.success === false) throw new Error((d && (d.message || d.error)) || 'The server refused.');
                try { await loadSessions(); } catch (_) { /* the old row */ }
            }, { paint: true });
        } catch (err) {
            e.saving = false;
            failBox('The persona could not be changed.', err);
            return;
        }
        if (conv && conv.id === e.id) { conv.session = sessionById(e.id) || conv.session; }
        popLayer();
        sh.syncHistory();
        if (view() === 'conv') renderEntries();
        else if (view() === 'state' && stateOf) { stateOf.session = sessionById(stateOf.id) || stateOf.session; renderState(); }
    }

    function editMenu() {
        return [
            { label: 'Save', action: saveEdit },
            '-',
            { label: 'Cancel', action: () => { popLayer(); sh.syncHistory(); } }
        ];
    }

    /**
     * Persona State: what the persona's 4th wall events last said (emotion, location, plans, trust,
     * inventory, memories; chatSystem.js shows them in the thread only), then the fields the chat was
     * made with and its engine. Read from the conversation's last 200 rows; nothing is written.
     */
    async function openState(s) {
        if (!s) return;
        stateOf = { id: s.id, session: s, rows: null, loading: true };
        if (view() === 'state') showLayer(); else push('state');
        const token = stateOf;
        try {
            const r = await sh.busy(() => wsc().getChatMessages(s.id, 200, 0), { paint: true });
            if (stateOf !== token) return;
            if (!r || !r.success) throw new Error((r && (r.message || r.error)) || 'The conversation could not be read.');
            token.rows = Array.isArray(r.messages) ? r.messages : []; // newest first
        } catch (err) {
            if (stateOf !== token) return;
            token.error = (err && err.message) || 'The conversation could not be read.';
        }
        token.loading = false;
        if (view() === 'state') renderState();
    }

    function renderState() {
        const box = page.querySelector('.wch-stateview');
        const st = stateOf;
        if (!st) { box.innerHTML = ''; return; }
        const s = sessionById(st.id) || st.session || {};
        const latest = {};
        const memories = [];
        for (const m of st.rows || []) {
            const t = m.event_type;
            if (m.message_type !== 'assistant' || !META[t] || !m.content) continue;
            if (t === 'memory') { if (memories.length < 8) memories.push(String(m.content)); continue; }
            if (!(t in latest)) latest[t] = String(m.content);
        }
        const item = (label, text) => (text ? `<div class="wm-form-sub">${esc(label)}:</div><p class="wch-state-val">${esc(text)}</p>` : '');
        const now = ['emotion', 'location', 'timeofday', 'environment', 'sensory', 'trustlevel', 'inventory', 'currplan', 'futureplans', 'innerspeech', 'offlinemessage'].map((t) => item(META[t], latest[t])).join('');
        const verb = (VERBOSITY.find(([v]) => v === String(s.verbosity_level || '')) || [null, ''])[1];
        const engine = [s.provider, s.model].filter(Boolean).join(', ');
        const body = st.loading ? '<p>Reading the conversation...</p>'
            : st.error ? `<p>${esc(st.error)}</p>`
                : `${now || '<p class="wch-state-none">The persona has not said how she is yet.</p>'}
                ${memories.length ? `<div class="wm-form-sub">Memories:</div><ul class="wch-state-list">${memories.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
        box.innerHTML = `
            <div class="wm-form-hdr">Persona State</div>
            <div class="wch-form-scroll"><div class="wm-form wch-state">
                <div class="wch-form-pic">
                    <img src="${esc(pictureOf(s.filename))}" alt="" draggable="false" onerror="this.src='/static_images/icon-96x96.png'">
                    <div><div class="wch-state-name">${esc(personaOf(s))}</div>${s.updated_at ? `<div class="wch-state-when">${esc(entryDate(s.updated_at))}</div>` : ''}</div>
                </div>
                ${body}
                <div class="wch-state-rule"></div>
                ${item('Verbosity', verb)}
                ${item('Mind Seed', s.text_context_info)}
                ${item('Story So Far', s.story_context)}
                ${item('Viewer Context', s.text_viewer_info)}
                ${item('Engine', engine)}
                ${s.total_tokens ? item('Tokens Used', Number(s.total_tokens).toLocaleString()) : ''}
            </div></div>`;
    }

    function stateMenu() {
        const s = stateOf && sessionById(stateOf.id);
        return [
            { label: 'Edit Persona...', disabled: !s, action: () => openEdit(s) },
            { label: 'Refresh', disabled: !s, action: () => openState(s) },
            '-',
            { label: 'Close', action: () => { popLayer(); sh.syncHistory(); } }
        ];
    }

    /** The persona's own items (the conversation's and the list's menus). */
    function personaItems(s) {
        return [
            { label: 'Edit Persona...', disabled: !s, action: () => openEdit(s) },
            { label: 'Persona State...', disabled: !s, action: () => openState(s) },
            { label: 'View Picture', disabled: !(s && s.filename), action: () => showPersonaPicture(s) },
            '-',
            { label: 'Restart Conversation...', disabled: !s, action: () => restartChat(s) },
            { label: 'Delete Conversation...', disabled: !s, action: () => deleteChat(s) }
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
        p.classList.add('wm-chat');
        p.innerHTML = `
            <div class="wch-listview">
                <div class="wm-pv-bar wch-bar">
                    <button type="button" class="wm-pv-folder wch-folder" aria-haspopup="tree"><span class="wch-folder-name">Inbox</span><i class="wm-pv-arrow"></i></button>
                    <button type="button" class="wm-pv-sort wch-sort" aria-haspopup="menu"><span>Received</span><i class="wm-pv-arrow"></i></button>
                </div>
                <div class="wch-scroll"><div class="wch-list" role="listbox" aria-label="Chats"></div><p class="wch-empty" hidden></p></div>
                <div class="wch-status"></div>
            </div>
            <div class="wch-convview" hidden>
                <div class="wch-history" role="log" aria-live="polite"></div>
                <div class="wch-compose"><textarea class="wch-input" rows="2" enterkeyhint="send" autocomplete="off" aria-label="Message"></textarea></div>
            </div>
            <div class="wch-newview" hidden></div>
            <div class="wch-optsview" hidden></div>
            <div class="wch-editview" hidden></div>
            <div class="wch-stateview" hidden></div>`;

        p.querySelector('.wch-folder').addEventListener('click', (e) => {
            e.stopPropagation();
            openTree(e.currentTarget);
        });
        p.querySelector('.wch-sort').addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            btn.querySelector('span').textContent = 'Sort By';
            sh.dropdown(btn, sortItems(), 'right', () => renderList());
        });
        const scroll = p.querySelector('.wch-scroll');
        onHold(scroll, '.wch-row', (row, x, y) => {
            selectRow(row.dataset.id);
            const s = sessionById(row.dataset.id);
            sh.menuAt(x, y, [
                { label: 'Delete', action: () => deleteChat(s) },
                { label: 'Reply', action: () => openConversation(s) },
                { label: 'Mark as Read', disabled: !((previews.get(s.id) || {}).unread), action: () => markRead(s) },
                { label: 'Restart Conversation...', action: () => restartChat(s) },
                '-',
                { label: 'Edit Persona...', action: () => openEdit(s) },
                { label: 'Persona State...', action: () => openState(s) }
            ]);
        });
        scroll.addEventListener('click', (e) => {
            const row = e.target.closest('.wch-row');
            if (!row) return;
            selectRow(row.dataset.id);
            openConversation(sessionById(row.dataset.id));
        });

        const hist = p.querySelector('.wch-history');
        hist.addEventListener('click', (e) => {
            if (e.target.closest('.wch-more')) { loadOlder(); return; }
            if (e.target.closest('.wch-plink')) { showPersonaPicture(); return; }
            const el = e.target.closest('.wch-entry');
            if (el && Number(el.dataset.n) >= 0) selectEntry(Number(el.dataset.n));
        });
        onHold(hist, '.wch-entry', (el, x, y) => {
            const n = Number(el.dataset.n);
            const en = conv && n >= 0 ? conv.entries[n] : null;
            if (!en) return;
            selectEntry(n);
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
        scheduleBgUnread();
        // Messaging > Options > Dreamscape Messenger saved (wmSettingsSystem.js chat-options)
        window.addEventListener('wmChatOptionsChange', () => {
            showActions = stored(ACTIONS_KEY) === '1';
            showEvents = stored(EVENTS_KEY) === '1';
            if (page && view() === 'conv') renderEntries();
            if (page && view() === 'opts') renderOpts();
        });
        registerToday();
        startTextShell();
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
                else if (view() === 'conv') { renderEntries(); markConvSeen(); }
            },
            hide() { shown = false; },
            // WM: X on the list, ok on a conversation and on the new chat form (ok creates it)
            titleKind: () => (view() === 'list' ? 'close' : 'ok'),
            onTitleOk() {
                if (view() === 'new') { createChat(); return true; }
                if (view() === 'edit') { saveEdit(); return true; }
                if (view() === 'conv' || view() === 'opts' || view() === 'state') { popLayer(); return true; }
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
                if (v === 'opts') return { left: null, right: null };
                if (v === 'edit') return { left: { label: 'Save', disabled: !!(editing && editing.saving), action: saveEdit }, right: { label: 'Menu', menu: editMenu } };
                if (v === 'state') return { left: { label: 'Edit', disabled: !stateOf || !sessionById(stateOf.id), action: () => { const s = stateOf && sessionById(stateOf.id); if (s) openEdit(s); } }, right: { label: 'Menu', menu: stateMenu } };
                const s = selectedSession();
                return { left: { label: 'Reply', disabled: !s, action: () => openConversation(s) }, right: { label: 'Menu', menu: listMenu } };
            }
        });
        void shown;
    }

    /** The persona's picture (the gallery picture the chat was made from) in the shell's picture view. */
    function showPersonaPicture(of) {
        const s = of || (conv && conv.session);
        if (!s || !s.filename || typeof showLightbox !== 'function') return; // eslint-disable-line no-undef
        try { showLightbox({ url: pictureOf(s.filename), title: personaOf(s) }); } catch (_) { /* no viewer */ } // eslint-disable-line no-undef
    }

    /** Conversations with unread persona lines, newest first: { id, name, text, at } (6.5's text panel). */
    function unreadList() {
        return sessions.filter((x) => ((previews.get(x.id) || {}).unread || 0) > 0)
            .map((x) => ({ id: x.id, name: personaOf(x), text: (previews.get(x.id) || {}).text || '', unread: previews.get(x.id).unread, at: Math.max(msOf(x.updated_at), (fresh.get(x.id) || {}).at || 0) }))
            .sort((a, b) => b.at - a.at);
    }

    async function openChatById(id) {
        if (!sh) return false;
        if (!sessionById(id)) { try { await loadSessions(); } catch (_) { return false; } }
        const s = sessionById(id);
        if (!s) return false;
        sh.open(APP_ID);
        smsFolder = 'inbox';
        openConversation(s, { replace: true });
        return true;
    }

    const whenShort = (ms) => {
        if (!ms) return '';
        const d = new Date(ms);
        return sameDay(d, new Date()) ? fmtTime(d) : fmtShortDate(d);
    };

    /**
     * 6.5's home screen: Dreamscape Messenger's own panel (#779; the device's text panel, CHome\CText,
     * is Text Messaging's now: registerTextToday below), a page per unread conversation (the
     * persona, the last line, the time); a tap opens that conversation, the soft key the list. Only
     * in 6.5: 6.1's Today counts Dreamscape Messenger in its Messaging row.
     */
    function registerToday() {
        if (sh.version !== '6.5' || typeof sh.registerTodayItem !== 'function') return;
        const showList = () => window.wmChatApp.showList();
        sh.registerTodayItem({
            id: 'messenger',
            label: SMS_TITLE,
            icon: 'x:app-chat-lg',
            after: 'text',
            text: () => { const n = window.wmChatApp.unread(); return n ? `${n} new ${n === 1 ? 'message' : 'messages'}` : 'No new messages'; },
            onTap: showList,
            titanium() {
                const list = unreadList();
                const n = list.reduce((k, x) => k + x.unread, 0);
                return {
                    label: 'messenger',
                    icon: 'x:app-chat-lg',
                    count: n ? String(n) : '',
                    pages: list.length
                        ? list.map((x) => ({ title: x.name, line2: x.text, line3: whenShort(x.at), onTap: () => { openChatById(x.id); } }))
                        : [{ title: 'No New Messages' }],
                    softKey: { label: 'Messenger', action: showList },
                    onTap: showList
                };
            }
        });
    }

    // ---------------------------------------------------------------- Text Messaging in the shell (#779)

    /**
     * The phone shell's half of Text Messaging (textMessagingClient.js = window.textMessaging; the
     * accounts' own screens are wmTextMessaging.js): the counts the title bar's new text message
     * glyph and Today read (window.wmTextShell), the device's "New Text Message" notification in
     * the 'sms' class (only for a message the server marks notify: an Unknown Sender only with
     * "Notify me about unknown senders" on), and 6.5's text panel, a page per account.
     * window.textMessaging is read at call time and its events are bound again when it is replaced
     * (the test fake).
     */
    const tmApi = () => window.textMessaging || null;
    const tmUi = () => window.wmTextMessaging || null;
    const tmState = { accounts: [], unread: {}, last: {} };
    const tmFresh = []; // [{ accountId, chatGuid, from, text }]: arrived, not read yet, oldest first
    let tmBound = null;
    let tmTimer = 0;
    let tmNote = null;

    const tmUnread = (id) => (id == null
        ? tmState.accounts.reduce((n, a) => n + (Number(tmState.unread[a.id]) || 0), 0)
        : Number(tmState.unread[id]) || 0);
    const tmLabel = (a) => {
        const tm = tmApi();
        try { if (tm && typeof tm.label === 'function') return tm.label(a); } catch (_) { /* below */ }
        return { title: (a && a.name) || 'Text Messaging', subline: (a && (a.identity || a.service)) || '' };
    };
    const tmPerson = (p) => (p && (p.name || p.address)) || '';
    function tmFrom(chat, m, title) {
        if (m && m.fromMe) return 'Me';
        const who = tmPerson(m && m.sender);
        if (chat && chat.isGroup) return who || chat.title || title || 'Unknown';
        return (chat && chat.title) || title || who || 'Unknown';
    }
    function tmText(m) {
        if (!m) return '';
        if (m.retracted) return 'This message was unsent.';
        const t = String(m.text || '').replace(/\s+/g, ' ').trim();
        if (t) return t.length > 160 ? `${t.slice(0, 157)}...` : t;
        const att = (m.attachments || [])[0];
        if (!att) return '';
        if (/^image\//.test(att.mime || '')) return 'Picture';
        if (/^video\//.test(att.mime || '')) return 'Video';
        if (/^audio\//.test(att.mime || '')) return 'Voice note';
        return att.name || 'Attachment';
    }

    function tmRefreshSoon(ms) {
        clearTimeout(tmTimer);
        tmTimer = setTimeout(tmRefresh, ms == null ? 400 : ms);
    }

    /** The accounts, their unread counts and each one's newest line (Today's pages). */
    /** The logon step's snapshot (textMessaging.snapshot()): Today and the status bar right away. */
    function tmSeed(tm) {
        const snap = tm && typeof tm.snapshot === 'function' ? tm.snapshot() : null;
        if (!snap || tmState.accounts.length) return;
        tmState.accounts = (snap.accounts || []).filter((a) => a && a.enabled !== false);
        for (const a of tmState.accounts) {
            tmState.unread[a.id] = Number(a.unread) || 0;
            const chats = ((snap.inbox && snap.inbox[a.id]) || []).filter((c) => c && c.last);
            const c = chats.find((x) => x.unread && !x.last.fromMe) || chats[0];
            if (c) tmState.last[a.id] = { from: tmFrom(c, c.last), text: tmText(c.last), at: Number(c.last.date) || 0 };
        }
        tmTodayChanged();
        if (sh && typeof sh.refreshStatus === 'function') sh.refreshStatus();
    }

    async function tmRefresh() {
        const tm = tmApi();
        if (!tm || typeof tm.accounts !== 'function') return;
        tmSeed(tm);
        try {
            let list = null;
            if (typeof tm.summary === 'function') { try { list = await tm.summary(); } catch (_) { list = null; } }
            if (!Array.isArray(list)) list = ((await tm.accounts()) || {}).accounts || [];
            tmState.accounts = list.filter((a) => a && a.enabled !== false);
            for (const a of tmState.accounts) tmState.unread[a.id] = Number(a.unread) || 0;
            await Promise.all(tmState.accounts.map(async (a) => {
                try {
                    const r = await tm.chats(a.id, { folder: 'inbox', limit: 10 });
                    const chats = ((r && r.chats) || []).filter((c) => c && c.last);
                    const c = chats.find((x) => x.unread && !x.last.fromMe) || chats[0];
                    tmState.last[a.id] = c ? { from: tmFrom(c, c.last), text: tmText(c.last), at: Number(c.last.date) || 0 } : null;
                } catch (_) { /* keeps the line it had */ }
            }));
        } catch (_) { /* not connected yet: the next event tries again */ }
        if (sh && typeof sh.refreshStatus === 'function') sh.refreshStatus();
        tmTodayChanged();
    }

    // Today drew its Text panel before the accounts arrived: draw it again when what it shows changed
    let tmTodayKey = '';
    function tmTodayChanged() {
        const key = JSON.stringify([tmState.accounts.map((a) => [a.id, a.identity, a.status, tmState.unread[a.id] || 0]), tmState.last]);
        if (key !== tmTodayKey) { tmTodayKey = key; if (sh && typeof sh.refreshToday === 'function') sh.refreshToday(); }
    }

    function tmOnUnread(d) {
        const by = (d && d.byAccount) || {};
        for (const id of Object.keys(by)) tmState.unread[id] = Number(by[id] && by[id].unread) || 0;
        if (sh && typeof sh.refreshStatus === 'function') sh.refreshStatus();
        tmTodayChanged();
    }

    function tmOnMessage(d) {
        if (!d || !d.message) return;
        tmRefreshSoon();
        if (d.message.fromMe || d.notify !== true) return;
        // the conversation on screen in front: read as it comes, no notice (wmTextMessaging may say so)
        const ui = tmUi();
        try { if (ui && (typeof ui.isShowing === 'function' ? ui.isShowing(d.accountId, d.chatGuid) : (typeof ui.isOpen === 'function' && ui.isOpen(d.accountId, d.chatGuid))) && !document.hidden) return; } catch (_) { /* notify */ }
        tmFresh.push({ accountId: d.accountId, chatGuid: d.chatGuid, from: tmFrom(d.isGroup ? { isGroup: true, title: d.chatTitle } : null, d.message, d.chatTitle), text: tmText(d.message) });
        if (tmFresh.length > 50) tmFresh.shift();
        // inside the Android app with the app in the background, the app posts Android's own
        // notification (its background link): the WM notice waits for the return without a sound of
        // its own. Nothing here calls an Android notification bridge (toasts never go there on phones)
        tmShowNote({ silent: inAndroidApp() && document.hidden });
    }

    const inAndroidApp = () => !!(window.AndroidActiveSync || window.AndroidNotification || window.AndroidDevice);

    function tmOnRead(d) {
        if (!d) return;
        tmRefreshSoon();
        let gone = false;
        for (let i = tmFresh.length - 1; i >= 0; i--) {
            const f = tmFresh[i];
            if (f.chatGuid === d.chatGuid && (!d.accountId || f.accountId === d.accountId)) { tmFresh.splice(i, 1); gone = true; }
        }
        if (gone) tmUpdateNote();
    }

    const TM_EVENTS = [
        ['message', tmOnMessage], ['read', tmOnRead], ['unread', tmOnUnread],
        ['account', () => tmRefreshSoon(0)], ['resync', () => tmRefreshSoon()], ['chat', () => tmRefreshSoon()]
    ];

    function tmBind() {
        const tm = tmApi();
        if (!tm || tm === tmBound || typeof tm.on !== 'function') return;
        if (tmBound && typeof tmBound.off === 'function') TM_EVENTS.forEach(([ev, fn]) => { try { tmBound.off(ev, fn); } catch (_) { /* gone */ } });
        tmBound = tm;
        TM_EVENTS.forEach(([ev, fn]) => tm.on(ev, fn));
        tmRefreshSoon(0);
    }

    /** Open Text Messaging on an account (the one with the newest unread message without one). */
    function tmOpenAccount(id) {
        let acct = id;
        if (acct == null) {
            const withNews = tmState.accounts.filter((a) => tmUnread(a.id) > 0).sort((x, y) => ((tmState.last[y.id] || {}).at || 0) - ((tmState.last[x.id] || {}).at || 0));
            acct = (withNews[0] || tmState.accounts[0] || {}).id;
        }
        const ui = tmUi();
        if (ui && typeof ui.showAccount === 'function' && acct != null) { ui.showAccount(acct, 'inbox'); return; }
        if (sh) sh.open('messaging');
    }

    function tmOpenFresh() {
        const list = tmFresh.slice();
        tmCloseNote(true);
        const last = list[list.length - 1];
        if (!last) { tmOpenAccount(); return; }
        const one = list.every((f) => f.accountId === last.accountId && f.chatGuid === last.chatGuid);
        const ui = tmUi();
        if (one && ui && typeof ui.openChat === 'function') ui.openChat(last.accountId, last.chatGuid);
        else tmOpenAccount(last.accountId);
    }

    function tmCloseNote(clear) {
        if (clear) tmFresh.length = 0;
        if (tmNote) { try { tmNote.close(); } catch (_) { /* gone */ } }
        tmNote = null;
        if (sh && typeof sh.refreshStatus === 'function') sh.refreshStatus();
    }

    /** The device's notice (outres 33321 "New Text Message" / 33322 "New Text Messages"). */
    function tmNoteParts() {
        const n = tmFresh.length;
        const last = tmFresh[n - 1];
        return {
            title: n === 1 ? 'New Text Message' : 'New Text Messages',
            html: n === 1
                ? `<button type="button" class="wch-note-open"><span class="wch-note-from">From: ${esc(last.from)}</span><span class="wch-note-text">${esc(last.text)}</span></button>`
                : `<button type="button" class="wch-note-open"><span class="wch-note-text">You have ${n} new text messages.</span></button>`
        };
    }

    function tmShowNote(o) {
        // a new arrival is a new notification: it sounds and comes up again
        if (tmNote) { try { tmNote.close(); } catch (_) { /* gone */ } tmNote = null; }
        if (!tmFresh.length || !sh || typeof sh.appNote !== 'function') return;
        const parts = tmNoteParts();
        const note = sh.appNote({
            title: parts.title,
            html: parts.html,
            icon: 'status-sms',
            event: 'sms',
            silent: !!(o && o.silent),
            softKeys: () => ({
                left: { label: 'Dismiss', action: () => tmCloseNote(true) },
                right: { label: 'Menu', menu: () => [
                    { label: tmFresh.length === 1 ? 'Reply' : 'View', action: tmOpenFresh },
                    { label: 'Hide', action: () => { if (tmNote) tmNote.hide(); } }
                ] }
            })
        });
        if (!note) return;
        tmNote = note;
        const el = document.getElementById(note.id);
        if (el) el.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.wch-note-open')) tmOpenFresh(); });
        if (typeof sh.refreshStatus === 'function') sh.refreshStatus();
    }

    /** What is still waiting, without a new sound: the note's text changes in place. */
    function tmUpdateNote() {
        if (!tmNote || !tmFresh.length) { tmCloseNote(false); return; }
        tmNote.update(tmNoteParts());
    }

    /**
     * 6.5's text panel (device CHome\CText: icon 2007 chNotifications_textmessage, after the clock and
     * before e-mail) for Text Messaging: a page per account, left / right between them (arrows,
     * swipe, the D-pad: wmTitanium.js). A page: the newest sender and line, the account's Apple ID or
     * number and its unread count. A tap opens that account.
     */
    function registerTextToday() {
        if (sh.version !== '6.5' || typeof sh.registerTodayItem !== 'function') return;
        sh.registerTodayItem({
            id: 'text',
            label: 'Text',
            icon: 'ti-2007',
            after: 'connection',
            text: () => { const n = tmUnread(); return n ? `${n} new text ${n === 1 ? 'message' : 'messages'}` : 'No new messages'; },
            onTap: () => tmOpenAccount(),
            titanium() {
                const n = tmUnread();
                const pages = tmState.accounts.map((a) => {
                    const u = tmUnread(a.id);
                    const last = tmState.last[a.id];
                    const sub = tmLabel(a).subline;
                    const open = () => tmOpenAccount(a.id);
                    const count = u ? `${u} new` : '';
                    return last
                        ? { title: last.from, line2: last.text, line3: [sub, count, u ? '' : whenShort(last.at)].filter(Boolean).join(', '), onTap: open }
                        : { title: 'No New Messages', line2: sub, onTap: open };
                });
                return {
                    label: 'text',
                    icon: 'ti-2007',
                    count: n ? String(n) : '',
                    pages: pages.length ? pages : [{ title: 'No New Messages' }],
                    softKey: { label: 'Messaging', action: () => tmOpenAccount() },
                    onTap: () => tmOpenAccount()
                };
            }
        });
    }

    function startTextShell() {
        registerTextToday();
        tmBind();
        // the client may come after this script, or be replaced (the test fake): bind again then
        setInterval(tmBind, 3000);
    }

    /** For wmShell (title bar glyph, Today's Messaging row, the status bubble). */
    window.wmTextShell = {
        unread: (id) => tmUnread(id),
        accounts: () => tmState.accounts.slice(),
        noteWaiting: () => !!tmNote,
        openAccount: (id) => tmOpenAccount(id),
        refresh: () => tmRefresh()
    };

    const norm = (t) => String(t || '').trim().toLowerCase();

    /**
     * Messaging and Contacts (#757): Text Messages is this app. openWith(name) opens the newest
     * conversation with that persona (Contacts' Send Text Message); unread() is the account picker's count.
     */
    window.wmChatApp = {
        showList() {
            if (!sh) return;
            sh.open(APP_ID);
            if (layers.length) { if (view() === 'conv') markConvSeen(); layers = []; conv = null; draft = null; showLayer(); sh.syncHistory(); }
            smsFolder = 'inbox';
            renderList();
        },
        setFolder(f) { setFolder(f); },
        hasPersona(name) {
            const n = norm(name);
            return !!n && sessions.some((x) => norm(personaOf(x)) === n || norm(titleOf(x)) === n);
        },
        async openWith(name) {
            if (!sh) return false;
            const n = norm(name);
            if (!n) return false;
            if (!loaded) { try { await ensureChat(); await loadSessions(); } catch (_) { return false; } }
            const s = sessions.find((x) => norm(personaOf(x)) === n) || sessions.find((x) => norm(titleOf(x)) === n);
            if (!s) return false;
            sh.open(APP_ID);
            smsFolder = 'inbox';
            openConversation(s, { replace: true });
            return true;
        },
        unread() {
            return sessions.reduce((n, x) => n + ((previews.get(x.id) || {}).unread || 0), 0);
        },
        unreadList: () => unreadList(),
        openChat: (id) => openChatById(id),
        // Contacts' persona cards (#763, wmNotes.js): that conversation by its chat id
        openWithId: (id) => openChatById(id),
        async refresh() {
            try { if (await ensureChat()) { await loadSessions(); await loadPreviews(); } } catch (_) { /* keeps the old count */ }
            if (page && view() === 'list') renderList();
        }
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
