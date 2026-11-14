/**
 * Melaton Mobile: Search (Windows Mobile 6.1 Professional's Search, "Search Phone" on the 6.5
 * Start screen; shfind.exe), Yozora #748; a search for anything on the phone and in Dreamscape (#779).
 *
 * Measured on the Device Emulators (VGA halved; captures in ~/.cache/claude-run/wm65apps/progs/emu61
 * s*.png and emu65 b3-*.png):
 *   the form    "Search for:" (label right-aligned to x 71.5, the field x 81..231 on a 1 px black
 *               rule while it has the focus, "< ... >" while it is empty without it, its history
 *               under the arrow) and "Type:" (a drop-down, "All data" first), 27 px apart
 *   Results     a 20 px tint band between two hairlines, "Results" bold at x 5.5; under it rows
 *               of 33 px: the 16 px icon at x 2, the name from x 22, a second line with the kind
 *               (x 22), the date (x 110) and the size (right edge x 190.5); a hairline under each
 *               row; the first row is selected; "No items found." when there is none
 *   soft keys   Search | Advanced, both grey while the field is empty (Advanced stays grey)
 *
 * Ours searches what the phone holds, like the desktop Start menu's search box and with its
 * ranking (runCommandIndex.js runWordPrefixRank: the whole name starts with the text, then every
 * word of the text starts a word of the name, then the keywords, then the text anywhere in the
 * item; Programs lead, as there). Each source is one "Type:" entry; "All data" asks them all, in
 * ALL_ORDER. A source whose program or API is missing is left out of the list (fail soft):
 *   Programs       the phone's programs (Programs and its folders) and the Settings pages
 *   Android        the phone's Android programs (window.wmAndroidApps.list), hidden ones too; a
 *                  hidden one starts through the app bridge (window.AndroidApps.launch)
 *   Contacts       the workspace's Contacts folder (.vcf, read with window.melatonVCard) and the
 *                  phone's own contacts when they are shown live (window.wmPhoneData); by name,
 *                  company, e-mail address and number; a tap opens the card (wmContactsApp.openFile)
 *   E-mail         Dreamscape Mail: subject, sender and the start of the text of the newest 200
 *                  messages of every folder but Junk (dovecote_list_mail, headers only: nothing is
 *                  marked read); a tap opens the message (wmMessaging.openMail). The IMAP e-mail
 *                  accounts (#789) answer under the same Type: the server's search of its copy
 *                  (window.mailAccounts.search, every folder but Junk); a tap opens the message in
 *                  Messaging on that account (wmMessaging.openImapMessage)
 *   Text Messages  iMessage / RCS through the server's search (window.textMessaging.search); the
 *                  row's second line is the matching text and its date; a tap opens the
 *                  conversation (wmTextMessaging.openChat)
 *   Messenger      Dreamscape Messenger's conversations (wsClient.getChatSessions; wmChatApp.openChat)
 *   Director       the Director sessions of each persona (director_get_sessions; wmDirectorApp.openSession)
 *   Calendar       the appointments of the year either side of today (wmCalendar.occurrences /
 *                  openEvent), by subject, location and notes; dated by the next occurrence
 *   Tasks          the workspace's tasks (window.wmTasks.search)
 *   Notes          the workspace's notes, by name and by text
 *   Presets        Studio's presets (window.optionsData.presets), by name and prompt; a tap opens
 *                  the preset (wmSpellbook.openPreset when there, else Spellcaster's spell page)
 *   Files          the workspace's files and folders (My Documents and the folders at My Device's
 *                  root, without Pictures / Scraps / Notes / Trash; vfsClient.listDirectory, walked
 *                  a level at a time, at most MAX_FOLDERS folders, kept for a minute); a tap opens the
 *                  file as File Explorer would (wmFileExplorer.openFile / openFolder)
 *   Help           when a Help program gives window.wmHelp.search
 *   Pictures       the gallery's own search (wsClient.searchFiles: tags and prompt text of the
 *                  workspace's images), as rows with the picture's thumbnail; a tap opens the viewer
 * The quick sources answer under the wait cursor; the slow ones (server searches, file walks) are
 * added to the list in their place as they come in, so the first rows are never held up by them.
 * "No items found." only once every source has answered. Only on phones. Styles:
 * public/css/wm-search.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'search';
    const HISTORY_KEY = 'wmSearchHistory';
    const HISTORY_MAX = 10;
    const PAGE_ROWS = 60; // rows drawn at a time (a picture search can answer thousands)
    const CACHE_MS = 60000; // contacts and the file tree are read again after a minute
    const MAX_FOLDERS = 80; // folders the file walk lists at most
    const MAX_DEPTH = 6;
    const FIRST_WAIT_MS = 30000; // the wait cursor gives up on a source that never answers
    const QUICK_WAIT_MS = 1500; // a quick source slower than this (a busy server) is added later too

    let ws = null;
    let page = null;
    let type = 'all';
    let results = null; // null = not searched yet
    let shown = 0;
    let sel = -1;
    let runId = 0;
    let picked = false; // a row of this search has been tapped

    const esc = (s) => ws.escapeHtml(String(s == null ? '' : s));
    const pad = (n) => String(n).padStart(2, '0');
    const shortDate = (d) => (d && !Number.isNaN(+d) ? `${d.getMonth() + 1}/${d.getDate()}/${pad(d.getFullYear() % 100)}` : '');
    // the device's column fits "83.9 KB": a megabyte and more is written in MB
    const sizeText = (bytes) => (bytes > 0 ? (bytes < 1024 * 1000 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`) : '');
    const toDate = (v) => {
        if (v == null || v === '') return null;
        if (v instanceof Date) return v;
        const n = Number(v);
        const d = Number.isFinite(n) ? new Date(n < 1e11 ? n * 1000 : n) : new Date(v);
        return Number.isNaN(+d) ? null : d;
    };
    const readJson = (key, fallback) => {
        try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (_) { return fallback; }
    };
    const vfs = () => (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef

    function workspaceId() {
        let w = 'Default';
        try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) w = activeWorkspace; } catch (_) { /* none */ } // eslint-disable-line no-undef
        return w;
    }

    /** A read kept for CACHE_MS (one at a time per key; a failed read is not kept). */
    const cache = new Map();
    function cached(key, load) {
        const c = cache.get(key);
        if (c && c.p) return c.p;
        if (c && Date.now() - c.at < CACHE_MS) return Promise.resolve(c.data);
        const p = Promise.resolve().then(load).then((data) => { cache.set(key, { at: Date.now(), data }); return data; }, (err) => { cache.delete(key); throw err; });
        cache.set(key, { p });
        return p;
    }

    /** Runs fn over list with at most n at a time. */
    async function eachLimit(list, n, fn) {
        let at = 0;
        const worker = async () => { while (at < list.length) { const i = at++; await fn(list[i], i); } };
        await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
    }

    // ---------------------------------------------------------------- matching (the Start menu's)

    /** "DreamStudio 2026" -> dream, studio, 2026 (runCommandIndex.js runSearchWords). */
    function words(text) {
        return String(text || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9\u00C0-\uFFFF]+/).filter(Boolean);
    }

    /** 0 the name starts with the text, 1 every term starts a word of it, 2 the same in a keyword, -1 no match. */
    function rank(q, label, keywords) {
        const terms = q.split(/\s+/).filter(Boolean);
        if (!terms.length) return -1;
        if (String(label || '').toLowerCase().startsWith(q)) return 0;
        const startsAll = (w) => terms.every((t) => w.some((x) => x.startsWith(t)));
        if (startsAll(words(label))) return 1;
        if ((keywords || []).some((k) => k && (String(k).toLowerCase().startsWith(q) || startsAll(words(k))))) return 2;
        return -1;
    }

    const holdsAll = (q, text) => { const hay = String(text || '').toLowerCase(); return q.split(/\s+/).filter(Boolean).every((t) => hay.includes(t)); };
    /** rank(), or 3 when every term is somewhere in the item's text. */
    const rankIn = (q, label, keywords, text) => { const r = rank(q, label, keywords); return r >= 0 ? r : (holdsAll(q, `${label || ''}\n${(keywords || []).join('\n')}\n${text || ''}`) ? 3 : -1); };
    const byRank = (a, b) => (a.rank - b.rank) || String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' });

    /** The text from a little before the first term found, so the match is on the narrow line. */
    function snippetAround(text, q) {
        const t = String(text || '').replace(/\s+/g, ' ').trim();
        const low = t.toLowerCase();
        const hits = q.split(/\s+/).filter(Boolean).map((x) => low.indexOf(x)).filter((i) => i >= 0);
        const at = hits.length ? Math.min(...hits) : -1;
        if (at < 18) return t;
        const from = t.lastIndexOf(' ', at - 1) > at - 14 ? t.lastIndexOf(' ', at - 1) + 1 : at - 8;
        return `...${t.slice(from)}`;
    }

    // ---------------------------------------------------------------- sources

    const artImg = (name) => ({ src: ws.art.url(name), srcset: ws.art.srcset(name) });

    function programs(q) {
        const out = [];
        const seen = new Set();
        const S = window.wmSettings;
        const add = (key, label, img, keywords, open, kind) => {
            if (seen.has(key)) return;
            const r = rank(q, label, keywords);
            if (r < 0) return;
            seen.add(key);
            out.push({ key, kind: kind || 'Programs', title: label, img, rank: r, open });
        };
        const walk = (folder) => {
            let items = [];
            try { items = (S && typeof S.programItems === 'function' && S.programItems(folder)) || []; } catch (_) { items = []; }
            for (const it of items) {
                if (it.folder) { walk(it.folder); continue; }
                if (it.key.startsWith('a:')) add(it.key, it.label, it.img, [it.key.slice(2)], () => ws.open(it.key.slice(2), { fromStart: true }));
                else if (it.launch) add(it.key, it.label, it.img, [it.key.slice(2)], () => ws.busy(() => it.launch.action(), { paint: true, timeout: 15000 }));
            }
        };
        walk();
        let grid = [];
        try { grid = (S && typeof S.gridItems === 'function' && S.gridItems()) || []; } catch (_) { grid = []; }
        // a program Settings lists (Task Manager) is found there, once
        const inSettings = new Set(grid.filter((g) => g.app).map((g) => g.app));
        for (const g of grid) {
            add(`s:${g.key}`, g.label, artImg(g.icon || 'app-settings'), [g.key, 'settings'], () => {
                if (g.app) ws.open(g.app);
                else if (typeof g.open === 'function') g.open();
                else S.open(g.key, null, { direct: true });
            }, 'Settings');
        }
        // the Start menu's own entries (Today, Programs, Settings ...) are programs too
        for (const a of ws.listApps()) {
            if (!a.inStart || a.id === APP_ID || a.id === 'start' || inSettings.has(a.id)) continue;
            add(`a:${a.id}`, a.startLabel || a.title || a.id, artImg(a.icon || 'app-programs'), [a.id], () => ws.open(a.id, { fromStart: true }));
        }
        return out.sort(byRank);
    }

    /**
     * Every Android program the phone lists, the hidden ones too (wmAndroidApps.js keeps the list,
     * the names given to programs and the hidden set). A shown one is also a row of Programs: "All
     * data" keeps that one (same key). A shown program opens through the shell, a hidden one
     * through the bridge.
     */
    function android(q) {
        const A = window.wmAndroidApps;
        if (!A || typeof A.list !== 'function') return [];
        let list = [];
        try { list = A.list() || []; } catch (_) { list = []; }
        let store = null;
        try { store = typeof A.store === 'function' ? A.store() : null; } catch (_) { store = null; }
        const icons = (store && store.icons) || {};
        const names = readJson('wmAndroidNames', {}) || {};
        const hidden = new Set((readJson('wmAndroidHidden', []) || []).map(String));
        const iconOf = (a) => {
            const k = icons[a.id] ? a.id : icons[a.package] ? a.package : Object.keys(icons).find((x) => icons[x] && icons[x].package === a.package);
            return (k && icons[k] && icons[k].icon) || a.icon || null;
        };
        const out = [];
        for (const a of list) {
            if (!a || !a.id || a.role === 'settings') continue; // Android Settings is a Settings page
            const label = (typeof names[a.id] === 'string' && names[a.id].trim()) || a.label;
            const r = rank(q, label, [a.label, a.package]);
            if (r < 0) continue;
            const shellId = `android:${a.id}`;
            const icon = iconOf(a);
            out.push({
                key: `a:${shellId}`, kind: 'Android', title: label, img: icon ? { src: icon, srcset: '' } : artImg('app-android'), rank: r,
                open: () => {
                    if (!hidden.has(a.id) && ws.listApps().some((x) => x.id === shellId)) { ws.open(shellId, { fromStart: true }); return; }
                    // with WM's wait cursor through the start (#816, wmAndroidApps)
                    if (typeof window.wmAndroidLaunch === 'function') { void window.wmAndroidLaunch(a.id, label); return; }
                    let ok = false;
                    try { ok = !!(window.AndroidApps && window.AndroidApps.launch(a.id) === true); } catch (_) { ok = false; }
                    if (!ok) void ws.messageBox({ title: label, text: `${label} could not be started. It may have been removed from the device.`, icon: 'warning' });
                }
            });
        }
        return out.sort(byRank);
    }

    /** The workspace's own folders (its home listing, kept for a minute): a missing folder is never listed. */
    function homeFolders(wsId) {
        return cached(`home:${wsId}`, async () => {
            const res = await vfs().listDirectory(`/Workspaces/${wsId}`, { offset: 0, limit: 500, sortField: 'name', sortDirection: 'asc', search: '' });
            return ((res && res.items) || []).filter((i) => i && i.kind === 'folder').map((i) => String(i.name || '').toLowerCase());
        });
    }

    /** vcard.js comes with Explorer's feature on the desktop; the phone loads it alone (as wmNotes.js does). */
    let vcardLoading = null;
    function ensureVCard() {
        if (window.melatonVCard) return Promise.resolve(true);
        if (!vcardLoading) {
            const fl = window.featureLoader;
            vcardLoading = (fl && typeof fl._loadScript === 'function'
                ? fl._loadScript('scripts/comp/vcard.js')
                : new Promise((resolve, reject) => {
                    const el = document.createElement('script');
                    el.src = '/scripts/comp/vcard.js';
                    el.onload = resolve;
                    el.onerror = reject;
                    document.body.appendChild(el);
                })).then(() => !!window.melatonVCard, () => { vcardLoading = null; return false; });
        }
        return vcardLoading;
    }

    /** The Contacts folder's cards: [{ c, item, folder }] (contact groups left out, as Contacts lists people). */
    function contactCards(wsId) {
        return cached(`contacts:${wsId}`, async () => {
            if (!(await ensureVCard())) return [];
            if (!(await homeFolders(wsId)).includes('contacts')) return [];
            const VC = window.melatonVCard;
            const folder = `/Workspaces/${wsId}/Contacts`;
            const res = await vfs().listDirectory(folder, { offset: 0, limit: 1000, sortField: 'name', sortDirection: 'asc', search: '' });
            let files = ((res && res.items) || []).filter((i) => /\.vcf$/i.test(i.name || '') && i.kind !== 'folder');
            // the phone's own mirror file is shown live from the phone instead (wmNotes.js Contacts)
            const pdm = window.wmPhoneData;
            const live = !!(pdm && typeof pdm.live === 'function' && pdm.live('contacts'));
            if (live && typeof pdm.isOwnMirror === 'function') files = files.filter((f) => !pdm.isOwnMirror(f.name));
            const out = [];
            await eachLimit(files, 6, async (f) => {
                try {
                    const r = await vfs().downloadFile(f.targetId || f.id);
                    const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).text();
                    VC.parseVcf(text).forEach((c) => { if (!c.group) out.push({ c, item: f, folder }); });
                } catch (_) { /* an unreadable card is left out */ }
            });
            return out;
        });
    }

    async function contacts(q) {
        if (!vfs() || !window.wmContactsApp) return [];
        const list = (await contactCards(workspaceId())).slice();
        const VC = window.melatonVCard;
        if (!VC) return [];
        const pdm = window.wmPhoneData;
        if (pdm && typeof pdm.live === 'function' && pdm.live('contacts') && typeof pdm.contactEntries === 'function') {
            try { (pdm.contactEntries(VC) || []).forEach((e) => { if (e && e.c) list.push({ c: e.c, item: null }); }); } catch (_) { /* the folder's cards only */ }
        }
        const digits = q.replace(/\D/g, '');
        const isNumber = digits.length >= 2 && q.replace(/[\d\s()+-]/g, '') === '';
        const out = [];
        for (const e of list) {
            const c = e.c;
            const name = VC.displayName(c) || '';
            const home = c.home || {};
            const work = c.work || {};
            let r = rank(q, name, [c.first, c.last, c.nickname, work.company, VC.email(c)]);
            if (r < 0 && isNumber && [home.mobile, home.phone, work.phone].some((n) => String(n || '').replace(/\D/g, '').includes(digits))) r = 3;
            if (r < 0) continue;
            out.push({
                kind: 'Contacts', title: name || '(No name)', img: artImg('contacts-card'), rank: r,
                open: () => { if (e.item) window.wmContactsApp.openFile(e.item, e.folder); else ws.open('contacts'); }
            });
        }
        return out.sort(byRank);
    }

    async function notes(q) {
        const c = window.wsClient;
        if (!c || typeof c.getNotesByWorkspace !== 'function') return [];
        const wsId = workspaceId();
        const res = await c.getNotesByWorkspace(wsId);
        const list = (res && (res.notes || (res.data && res.data.notes))) || [];
        const out = [];
        for (const n of list) {
            const r = rankIn(q, n.name, [], n.content);
            if (r < 0) continue;
            out.push({
                kind: 'Notes', title: n.name || 'Note', img: artImg('notes-note'), rank: r, date: toDate(n.updated_at), size: String(n.content || '').length,
                open: () => { if (window.wmNotesApp) window.wmNotesApp.openNote(n.id, n.workspace_id || wsId, n.name); }
            });
        }
        return out.sort(byRank);
    }

    async function tasks(q) {
        const T = window.wmTasks;
        if (!T || typeof T.search !== 'function') return [];
        const list = await T.search(q);
        return list.map((t) => ({ kind: 'Tasks', title: t.title, img: artImg('app-tasks'), rank: rank(q, t.title, []) < 0 ? 3 : rank(q, t.title, []), date: t.due || null, open: t.open })).sort(byRank);
    }

    function senderOf(m) {
        if (m.fromLabel && !m.labelSuspicious) return String(m.fromLabel).replace(/^"?([^"<]*)"?\s*<[^>]*>$/, '$1').trim() || m.fromLabel;
        return m.from ? (String(m.from).includes('@') ? m.from : `${m.from}@dream.co.jp`) : '';
    }

    async function email(q) {
        const c = window.wsClient;
        if (!c || typeof c.sendMessage !== 'function' || !window.wmMessaging) return [];
        // every folder as Messaging lists it: headers and the text's start only (dovecote_get_mail is
        // what marks a message read). No server-side mail search exists: the newest 200 are looked at.
        const res = await c.sendMessage('dovecote_list_mail', { limit: 200 }, true);
        const list = (res && (res.mail || (res.data && res.data.mail))) || [];
        const out = [];
        for (const m of list) {
            if (m.folder === 'spam') continue;
            const from = senderOf(m);
            const r = rankIn(q, m.subject, [from], m.snippet);
            if (r < 0) continue;
            out.push({
                kind: 'E-mail', title: m.subject || '(no subject)', img: artImg(m.read ? 'msg-read' : 'msg-unread'), rank: r, date: toDate(m.createdAt), size: Number(m.size) || 0,
                open: () => window.wmMessaging.openMail(m.id)
            });
        }
        return out.sort(byRank);
    }

    /** The IMAP e-mail accounts (#789): the server's search of its copy (headers and text), its order (newest first). */
    async function imapMail(q, raw) {
        const M = window.mailAccounts;
        const W = window.wmMessaging;
        if (!M || typeof M.search !== 'function' || !W || typeof W.openImapMessage !== 'function') return [];
        const list = (await M.search(raw || q, { limit: 60 })) || [];
        // Junk is left out, as Dreamscape Mail's spam is; the folder's special use is in Messaging's copy of the folders
        return list.filter((m) => !/(^|[/.])(junk|spam)( e-?mail)?$/i.test(String(m.folder || ''))).map((m, i) => {
            const f = Array.isArray(m.from) && m.from[0] ? m.from[0] : null;
            const from = (f && (f.name || f.address)) || String(m.sender || '').replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '');
            const r = rankIn(q, m.subject, [from], m.snippet);
            return {
                kind: 'E-mail', title: m.subject || '(no subject)', img: artImg(m.seen ? 'msg-read' : 'msg-unread'), rank: r < 0 ? 1000 + i : r, date: toDate(m.date), size: Number(m.size) || 0,
                open: () => W.openImapMessage(m.accountId, m.folder, m.uid, m)
            };
        }).sort(byRank);
    }

    /** The server's search over the Text Messaging accounts (iMessage, RCS): its own order (newest first). */
    async function texts(q, raw) {
        const T = window.textMessaging;
        if (!T || typeof T.search !== 'function') return [];
        const list = (await T.search(raw || q, { limit: 50 })) || [];
        return list.filter((x) => x && x.message && x.chatGuid).map((x, i) => {
            const m = x.message;
            const text = m.text || m.subject || ((m.attachments || [])[0] || {}).name || '';
            return {
                kind: 'Text Messages', title: x.chatTitle || 'Text Message', img: artImg('app-sms'), rank: i, date: toDate(m.date), snippet: snippetAround(text, q),
                open: () => { if (window.wmTextMessaging) window.wmTextMessaging.openChat(x.accountId, x.chatGuid); }
            };
        });
    }

    /** Dreamscape Messenger's conversations with the chat personas (wmChat.js). */
    async function chats(q) {
        const c = window.wsClient;
        if (!c || typeof c.getChatSessions !== 'function' || !window.wmChatApp) return [];
        const r = await c.getChatSessions();
        const list = (r && r.success && Array.isArray(r.sessions)) ? r.sessions : [];
        const out = [];
        for (const s of list) {
            const title = s.chat_name || s.character_name || 'Unnamed Chat';
            const rk = rank(q, title, [s.character_name]);
            if (rk < 0) continue;
            out.push({ kind: 'Messenger', title, img: artImg(document.documentElement.dataset.wmVersion === '6.5' ? 'app-messenger' : 'app-chat'), rank: rk, date: toDate(s.updated_at || s.created_at), open: () => window.wmChatApp.openChat(s.id) });
        }
        return out.sort(byRank);
    }

    const PERSONAS = [['wren', 'Yumiya'], ['kabuki', 'Chiyo'], ['xi', 'Yozora']];
    function xiOn() {
        const st = window.directorInstance && window.directorInstance._status;
        return !!(st && st.xi && st.xi.enabled === true);
    }

    /** The Director's sessions, each persona's (Messaging's Director accounts read the same list). */
    async function director(q) {
        const c = window.wsClient;
        if (!c || typeof c.sendMessage !== 'function') return [];
        const out = [];
        await Promise.all(PERSONAS.filter(([p]) => p !== 'xi' || xiOn()).map(async ([p, name]) => {
            let r = null;
            try { r = await c.sendMessage('director_get_sessions', { persona: p }, true); } catch (_) { return; }
            const d = r && (Array.isArray(r.sessions) ? r : r.data);
            for (const s of (d && Array.isArray(d.sessions) ? d.sessions : [])) {
                if (!s || !s.id) continue;
                const rk = rankIn(q, s.name, [name], s.last_line);
                if (rk < 0) continue;
                out.push({
                    kind: 'Director', title: s.name || 'Director', img: artImg(`today-persona-${p}`), rank: rk, date: toDate(s.updated_at || s.created_at),
                    open: async () => {
                        const app = window.wmDirectorApp;
                        if (app && typeof app.openSession === 'function') {
                            try { if (await app.openSession(p, s.id)) return; } catch (err) { console.warn('wmSearch: Director', err); }
                        }
                        ws.open('director');
                    }
                });
            }
        }));
        return out.sort(byRank);
    }

    /** The calendar's appointments, each once: its next occurrence, else its last one. */
    async function calendar(q) {
        const C = window.wmCalendar;
        if (!C || typeof C.occurrences !== 'function') return [];
        if (typeof C.loaded === 'function' && !C.loaded()) await C.reload();
        const now = new Date();
        const day = 86400000;
        const occs = C.occurrences(new Date(+now - 365 * day), new Date(+now + 365 * day)) || [];
        const pick = new Map();
        for (const o of occs) {
            const k = o.ev.uid || o.ev;
            const cur = pick.get(k);
            const better = !cur || (o.end >= now ? (cur.end < now || o.start < cur.start) : (cur.end < now && o.start > cur.start));
            if (better) pick.set(k, o);
        }
        const out = [];
        for (const o of pick.values()) {
            const ev = o.ev;
            const r = rankIn(q, ev.summary, [ev.location], ev.description);
            if (r < 0) continue;
            out.push({ kind: 'Calendar', title: ev.summary || '(No subject)', img: artImg('app-calendar'), rank: r, date: o.start, open: () => C.openEvent(o) });
        }
        return out.sort(byRank);
    }

    /** Studio's presets as the client holds them (appBootstrap.js; Spellcaster lists the same). */
    function presets(q) {
        const list = (window.optionsData && Array.isArray(window.optionsData.presets)) ? window.optionsData.presets : [];
        const out = [];
        for (const p of list) {
            if (!p || !p.name) continue;
            const r = rankIn(q, p.name, [], p.prompt);
            if (r < 0) continue;
            out.push({
                kind: 'Presets', title: p.name, img: artImg('app-spellbook'), rank: r,
                open: () => {
                    if (window.wmSpellbook && typeof window.wmSpellbook.openPreset === 'function') window.wmSpellbook.openPreset(p.name);
                    else if (window.wmSpellcaster && typeof window.wmSpellcaster.openSpell === 'function') window.wmSpellcaster.openSpell(p.name);
                    else if (typeof window.showPresetManager === 'function') window.showPresetManager();
                }
            });
        }
        return out.sort(byRank);
    }

    // the workspace's system folders the file walk leaves out: other sources search them (Pictures,
    // Scraps, Notes) or they are not files to find (Trash); at My Device's root the System and
    // Workspaces folders
    const SKIP_FOLDERS = new Set(['pictures', 'scraps', 'notes', 'trash', 'system', 'workspaces']);

    /** Every file and folder under My Documents and My Device's own folders: [{ item }] (a minute's cache). */
    function fileTree(wsId) {
        return cached(`files:${wsId}`, async () => {
            const out = [];
            const seen = new Set();
            let level = [`/Workspaces/${wsId}`, '/'];
            let listed = 0;
            for (let depth = 0; level.length && depth <= MAX_DEPTH && listed < MAX_FOLDERS; depth++) {
                const next = [];
                const todo = level.filter((p) => !seen.has(p)).slice(0, MAX_FOLDERS - listed);
                todo.forEach((p) => seen.add(p));
                listed += todo.length;
                await eachLimit(todo, 4, async (path) => {
                    let res;
                    try { res = await vfs().listDirectory(path, { offset: 0, limit: 500, sortField: 'name', sortDirection: 'asc', search: '' }); } catch (_) { return; }
                    for (const i of (res && res.items) || []) {
                        const name = String((i && i.name) || '');
                        if (!name || name.startsWith('.')) continue;
                        if (i.kind === 'folder') {
                            if (i.system && (path === '/' || SKIP_FOLDERS.has(name.toLowerCase()))) continue;
                            out.push({ item: i });
                            // a shortcut to a folder is found, not walked (it can point back up)
                            if (!i.isShortcut && i.navPath && !/\.(7z|zip|rar|tar|gz)$/i.test(name)) next.push(i.navPath);
                        } else {
                            out.push({ item: i });
                        }
                    }
                });
                level = next;
            }
            return out;
        });
    }

    async function files(q) {
        if (!vfs() || !window.wmFileExplorer) return [];
        const FE = window.wmFileExplorer;
        const out = [];
        for (const { item: i } of await fileTree(workspaceId())) {
            const r = rankIn(q, i.name, [], ''); // "calendar.ics" finds "Yukimi's Calendar.ics"
            if (r < 0) continue;
            const folder = i.kind === 'folder';
            const img = folder ? 'fe-folder' : (i.targetKind === 'image' || i.targetKind === 'scrap' || /^image\//.test(i.mimeType || '')) ? 'app-pictures' : i.targetKind === 'note' ? 'app-notes' : 'fe-file';
            out.push({
                kind: 'Files', title: i.name, img: artImg(img), rank: r, date: toDate(i.modifiedAt || i.updatedAt), size: folder ? 0 : Number(i.size || i.sizeBytes) || 0,
                open: () => { if (folder && i.navPath && !i.isShortcut) FE.openFolder(i.navPath, i.name); else FE.openFile(i); }
            });
        }
        return out.sort(byRank);
    }

    function thumbOf(filename) {
        try {
            if (typeof resolveGalleryPreviewUrl === 'function') return resolveGalleryPreviewUrl({ preview: filename }); // eslint-disable-line no-undef
        } catch (_) { /* the plain path below */ }
        return `/previews/${String(filename).replace(/\.(png|jpe?g|webp)$/i, '')}.webp`;
    }

    function inGallery(filename) {
        try {
            // eslint-disable-next-line no-undef
            if (typeof allImages !== 'undefined' && Array.isArray(allImages)) return allImages.some((i) => i && (i.filename === filename || i.original === filename || i.upscaled === filename));
        } catch (_) { /* gallery not loaded */ }
        return false;
    }

    function viewPicture(filename) {
        if (typeof showLightbox !== 'function') return; // eslint-disable-line no-undef
        const open = () => (inGallery(filename) ? showLightbox({ filename }) : showLightbox({ url: `/images/${encodeURIComponent(filename)}`, title: filename })); // eslint-disable-line no-undef
        ws.busy(Promise.resolve().then(open).catch(() => { /* viewer not ready */ }));
    }

    async function pictures(q) {
        const c = window.wsClient;
        if (!c || typeof c.searchFiles !== 'function') return [];
        // the gallery's search: comma-separated terms must all match the tags / prompt text
        const res = await c.searchFiles(q, 'images');
        const list = (res && res.results) || [];
        return list.map((r, i) => {
            const m = r.metadata || {};
            return { kind: 'Pictures', title: r.filename, thumb: thumbOf(r.filename), rank: i, date: toDate(m.mtime), size: Number(m.size) || 0, open: () => viewPicture(r.filename) };
        });
    }

    async function help(q) {
        const H = window.wmHelp;
        if (!H || typeof H.search !== 'function') return [];
        const list = (await H.search(q)) || [];
        return list.map((h, i) => ({ kind: 'Help', title: h.title, img: artImg('app-help'), rank: i, date: toDate(h.date), size: Number(h.size) || 0, open: h.open }));
    }

    // the Type list, in the device's order (alphabetical after "All data"); slow: answers after the
    // first rows are up (a server search or a walk of many folders)
    const SOURCES = [
        { id: 'android', label: 'Android', run: android, available: () => !!(window.wmAndroidApps && typeof window.wmAndroidApps.list === 'function') },
        { id: 'calendar', label: 'Calendar', run: calendar, slow: true, available: () => !!(window.wmCalendar && typeof window.wmCalendar.occurrences === 'function') },
        { id: 'contacts', label: 'Contacts', run: contacts, slow: true, available: () => !!window.wmContactsApp },
        { id: 'director', label: 'Director', run: director, slow: true, available: () => !!(window.wmDirectorApp || window.directorInstance) },
        { id: 'messages', label: 'E-mail', run: email, available: () => !!window.wmMessaging },
        // the IMAP accounts are more E-mail (group: the same Type entry, not one of their own)
        { id: 'mailaccounts', label: 'E-mail', group: 'messages', run: imapMail, slow: true, available: () => !!(window.mailAccounts && typeof window.mailAccounts.search === 'function' && window.wmMessaging) },
        { id: 'files', label: 'Files', run: files, slow: true, available: () => !!window.wmFileExplorer },
        { id: 'help', label: 'Help', run: help, available: () => !!(window.wmHelp && typeof window.wmHelp.search === 'function') },
        { id: 'chats', label: 'Messenger', run: chats, slow: true, available: () => !!window.wmChatApp },
        { id: 'notes', label: 'Notes', run: notes },
        { id: 'pictures', label: 'Pictures', run: pictures, slow: true },
        { id: 'presets', label: 'Presets', run: presets },
        { id: 'programs', label: 'Programs', run: programs },
        { id: 'tasks', label: 'Tasks', run: tasks, available: () => !!(window.wmTasks && typeof window.wmTasks.search === 'function') },
        { id: 'texts', label: 'Text Messages', run: texts, slow: true, available: () => !!(window.textMessaging && typeof window.textMessaging.search === 'function' && window.wmTextMessaging) }
    ];
    // "All data": Programs lead (the Start menu's order), the people and messages next, the
    // workspace's things after, the pictures last
    const ALL_ORDER = ['programs', 'android', 'contacts', 'messages', 'mailaccounts', 'texts', 'chats', 'director', 'calendar', 'tasks', 'notes', 'presets', 'files', 'help', 'pictures'];
    const sources = () => SOURCES.filter((s) => { try { return !s.available || s.available(); } catch (_) { return false; } });

    // ---------------------------------------------------------------- history

    function history() {
        try { const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch (_) { return []; }
    }

    function remember(q) {
        const list = history().filter((x) => x.toLowerCase() !== q.toLowerCase());
        list.unshift(q);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch (_) { /* private mode */ }
    }

    // ---------------------------------------------------------------- drawing

    const field = () => page.querySelector('.wsr-q');

    function rowHtml(r, i) {
        const icon = r.thumb
            ? `<span class="wsr-ico is-thumb"><img src="${esc(r.thumb)}" alt="" draggable="false" loading="lazy"></span>`
            : `<span class="wsr-ico"><img src="${esc(r.img.src)}" srcset="${esc(r.img.srcset || '')}" alt="" draggable="false"></span>`;
        // a message's row: the matching text where the kind goes, its date at the right
        const line2 = r.snippet != null
            ? `<span class="wsr-line2 is-snippet"><span class="wsr-snip">${esc(r.snippet)}</span><span class="wsr-date">${esc(shortDate(r.date))}</span></span>`
            : `<span class="wsr-line2"><span class="wsr-kind">${esc(r.kind)}</span><span class="wsr-date">${esc(shortDate(r.date))}</span><span class="wsr-size">${esc(sizeText(r.size))}</span></span>`;
        return `<div class="wsr-item${i === sel ? ' is-selected' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">${icon}`
            + `<span class="wsr-title">${esc(r.title)}</span>${line2}</div>`;
    }

    /** keep: a slow source's rows came in; the list keeps its scroll position and selected row. */
    function renderResults(keep) {
        const box = page.querySelector('.wsr-results');
        if (results == null) { box.innerHTML = ''; return; }
        if (!results.length) { box.innerHTML = '<div class="wsr-none">No items found.</div>'; return; }
        const top = box.scrollTop;
        shown = Math.min(results.length, keep ? Math.max(shown, PAGE_ROWS) : PAGE_ROWS);
        box.innerHTML = results.slice(0, shown).map(rowHtml).join('');
        box.scrollTop = keep ? top : 0;
    }

    function more() {
        if (!results || shown >= results.length) return;
        const box = page.querySelector('.wsr-results');
        const next = Math.min(results.length, shown + PAGE_ROWS);
        box.insertAdjacentHTML('beforeend', results.slice(shown, next).map((r, k) => rowHtml(r, shown + k)).join(''));
        shown = next;
    }

    function renderType() {
        const s = sources().find((x) => x.id === type);
        if (!s) type = 'all';
        page.querySelector('.wsr-type > span').textContent = s ? s.label : 'All data';
    }

    /** The answers so far in the sources' order, each item once (a shown Android program is a Program). */
    function merge(parts) {
        const out = [];
        const keys = new Set();
        for (const rows of parts) {
            for (const r of rows || []) {
                if (r.key) { if (keys.has(r.key)) continue; keys.add(r.key); }
                out.push(r);
            }
        }
        return out;
    }

    async function search() {
        const raw = field().value.trim();
        if (!raw) return;
        field().blur();
        remember(raw);
        const id = ++runId;
        const ql = raw.toLowerCase();
        const list = type === 'all' ? ALL_ORDER.map((k) => sources().find((s) => s.id === k)).filter(Boolean) : sources().filter((s) => s.id === type || s.group === type);
        const parts = list.map(() => null); // null = still asking
        let drawn = false;
        picked = false;
        let ready = null;
        let patience = false; // QUICK_WAIT_MS has passed: draw what has come
        const first = new Promise((resolve) => { ready = resolve; });
        // the first drawing waits for the quick sources (at most QUICK_WAIT_MS while the server is
        // busy), and for the slow ones too while nothing is found
        const check = () => {
            const all = parts.every((p) => p !== null);
            const quick = patience || list.every((s, i) => s.slow || parts[i] !== null);
            if (all || (quick && parts.some((p) => p && p.length))) ready();
        };
        const quickTimer = setTimeout(() => { patience = true; if (id === runId) check(); }, QUICK_WAIT_MS);
        list.forEach((s, i) => {
            // one source that fails (no connection, no mailbox, refused) leaves the others' answers
            Promise.resolve().then(() => s.run(ql, raw)).catch((err) => { console.warn('wmSearch:', s.id, err); return []; }).then((rows) => {
                if (id !== runId) return;
                parts[i] = Array.isArray(rows) ? rows : [];
                if (drawn) {
                    // in its place in the list, the list where it was; the first row stays the selected
                    // one (the device's) until a row has been tapped, then that row stays selected
                    const was = picked && results && results[sel];
                    results = merge(parts);
                    sel = was ? results.indexOf(was) : -1;
                    if (sel < 0 && results.length) sel = 0;
                    if (page) renderResults(true);
                    if (ws.current === APP_ID) ws.refreshSoftKeys();
                }
                check();
            });
        });
        check();
        let timer = null;
        const limit = new Promise((resolve) => { timer = setTimeout(resolve, FIRST_WAIT_MS); });
        await ws.busy(Promise.race([first, limit]), { paint: true, timeout: FIRST_WAIT_MS }).catch(() => {});
        clearTimeout(timer);
        clearTimeout(quickTimer);
        if (id !== runId) return;
        drawn = true;
        results = merge(parts);
        sel = results.length ? 0 : -1;
        renderResults();
        ws.refreshSoftKeys();
    }

    function openRow(i) {
        const r = results && results[i];
        if (!r) return;
        sel = i;
        picked = true;
        page.querySelectorAll('.wsr-item').forEach((el) => { const on = Number(el.dataset.i) === i; el.classList.toggle('is-selected', on); el.setAttribute('aria-selected', String(on)); });
        try {
            const p = r.open();
            if (p && typeof p.catch === 'function') p.catch((err) => console.warn('wmSearch: open', err));
        } catch (err) { console.warn('wmSearch: open', err); }
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-search');
        p.innerHTML = '<div class="wsr-form">'
            + '<div class="wsr-row"><span class="wsr-label">Search for:</span><span class="wsr-field"><input type="text" class="wsr-q" placeholder="&lt; ... &gt;" autocomplete="off" autocapitalize="none" enterkeyhint="search" aria-label="Search for"><button type="button" class="wsr-drop" aria-label="Earlier searches"></button></span></div>'
            + '<div class="wsr-row"><span class="wsr-label">Type:</span><button type="button" class="wsr-type" aria-label="Type"><span>All data</span></button></div>'
            + '</div><div class="wsr-head">Results</div><div class="wsr-results wm-pg-scroll" role="listbox" aria-label="Results"></div>';
        const q = field();
        q.addEventListener('input', () => ws.refreshSoftKeys());
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
        p.querySelector('.wsr-drop').addEventListener('click', (e) => {
            const list = history();
            if (!list.length) { q.focus(); return; }
            ws.dropdown(e.currentTarget.parentElement, list.map((h) => ({ label: h, action: () => { q.value = h; ws.refreshSoftKeys(); } })), 'left');
        });
        p.querySelector('.wsr-type').addEventListener('click', (e) => {
            const items = [{ id: 'all', label: 'All data' }].concat(sources().filter((s) => !s.group)).map((s) => ({ label: s.label, radio: type === s.id, action: () => { type = s.id; renderType(); } }));
            ws.dropdown(e.currentTarget, items, 'left');
        });
        const box = p.querySelector('.wsr-results');
        box.addEventListener('click', (e) => {
            const row = e.target.closest('.wsr-item');
            if (row) openRow(Number(row.dataset.i));
        });
        box.addEventListener('scroll', () => { if (box.scrollTop + box.clientHeight > box.scrollHeight - 200) more(); }, { passive: true });
        renderType();
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: 'Search',
            startLabel: ws.version === '6.5' ? 'Search Phone' : 'Search',
            icon: 'app-search',
            inStart: 'programs',
            sip: true,
            mount,
            show() { renderType(); ws.refreshSoftKeys(); },
            onEnd() { results = null; sel = -1; runId++; if (page) { field().value = ''; renderResults(); } },
            softKeys() {
                const empty = !page || !field().value.trim();
                return { left: { label: 'Search', disabled: empty, action: search }, right: { label: 'Advanced', disabled: true } };
            }
        });
    }

    /** search.open(text, typeId): the program with that text searched (Today's search box, other programs). */
    window.wmSearch = {
        open(text, typeId) {
            if (!ws) return;
            ws.open(APP_ID, { fromStart: true });
            if (typeId && (typeId === 'all' || sources().some((s) => s.id === typeId))) { type = typeId; renderType(); }
            if (text != null && page) { field().value = String(text); ws.refreshSoftKeys(); if (String(text).trim()) search(); }
        },
        types: () => ['all'].concat(sources().filter((s) => !s.group).map((s) => s.id)),
        _state: () => ({ type, results, sel })
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
