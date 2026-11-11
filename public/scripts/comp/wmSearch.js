/**
 * Melaton Mobile: Search (Windows Mobile 6.1 Professional's Search, "Search Phone" on the 6.5
 * Start screen; shfind.exe), Yozora #748.
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
 * word of the text starts a word of the name, then the keywords; Programs lead, as there):
 *   Programs    the phone's programs (Programs and its folders) and the Settings pages
 *   Notes       the workspace's notes, by name and by text
 *   Tasks       the workspace's tasks (window.wmTasks.search)
 *   Messaging   the subject and sender of the inbox's mail as Messaging lists it (the list request
 *               only: nothing is opened or marked read)
 *   Pictures    the gallery's own search (wsClient.searchFiles: tags and prompt text of the
 *               workspace's images), as rows with the picture's thumbnail; a tap opens the viewer
 *   Help        when a Help program gives window.wmHelp.search
 * A row opens the item in its program. Only on phones. Styles: public/css/wm-search.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'search';
    const HISTORY_KEY = 'wmSearchHistory';
    const HISTORY_MAX = 10;
    const PAGE_ROWS = 60; // rows drawn at a time (a picture search can answer thousands)

    let ws = null;
    let page = null;
    let type = 'all';
    let results = null; // null = not searched yet
    let shown = 0;
    let sel = -1;
    let runId = 0;

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

    function workspaceId() {
        let w = 'Default';
        try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) w = activeWorkspace; } catch (_) { /* none */ } // eslint-disable-line no-undef
        return w;
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
        if ((keywords || []).some((k) => String(k).toLowerCase().startsWith(q) || startsAll(words(k)))) return 2;
        return -1;
    }

    const holdsAll = (q, text) => { const hay = String(text || '').toLowerCase(); return q.split(/\s+/).filter(Boolean).every((t) => hay.includes(t)); };
    const byRank = (a, b) => (a.rank - b.rank) || String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' });

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
            out.push({ kind: kind || 'Programs', title: label, img, rank: r, open });
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

    async function notes(q) {
        const c = window.wsClient;
        if (!c || typeof c.getNotesByWorkspace !== 'function') return [];
        const wsId = workspaceId();
        const res = await c.getNotesByWorkspace(wsId);
        const list = (res && (res.notes || (res.data && res.data.notes))) || [];
        const out = [];
        for (const n of list) {
            let r = rank(q, n.name, []);
            if (r < 0 && holdsAll(q, `${n.name}\n${n.content || ''}`)) r = 3;
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

    async function messages(q) {
        const c = window.wsClient;
        if (!c || typeof c.sendMessage !== 'function' || !window.wmMessaging) return [];
        // the inbox as Messaging lists it: headers only (dovecote_get_mail is what marks a message read)
        const res = await c.sendMessage('dovecote_list_mail', { folder: 'inbox', limit: 200 }, true);
        const list = (res && (res.mail || (res.data && res.data.mail))) || [];
        const out = [];
        for (const m of list) {
            const from = senderOf(m);
            let r = rank(q, m.subject, [from]);
            if (r < 0 && holdsAll(q, `${m.subject || ''}\n${from}`)) r = 3;
            if (r < 0) continue;
            out.push({
                kind: 'Messaging', title: m.subject || '(no subject)', img: artImg(m.read ? 'msg-read' : 'msg-unread'), rank: r, date: toDate(m.createdAt), from,
                open: () => window.wmMessaging.openMail(m.id)
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

    // the Type list, in the device's order (alphabetical after "All data"); "All data" asks them in
    // the Start menu's group order with the pictures last
    const SOURCES = [
        { id: 'help', label: 'Help', run: help, available: () => !!(window.wmHelp && typeof window.wmHelp.search === 'function') },
        { id: 'messages', label: 'Messaging', run: messages, available: () => !!window.wmMessaging },
        { id: 'notes', label: 'Notes', run: notes },
        { id: 'pictures', label: 'Pictures', run: pictures },
        { id: 'programs', label: 'Programs', run: (q) => Promise.resolve(programs(q)) },
        { id: 'tasks', label: 'Tasks', run: tasks, available: () => !!(window.wmTasks && typeof window.wmTasks.search === 'function') }
    ];
    const ALL_ORDER = ['programs', 'notes', 'tasks', 'messages', 'help', 'pictures'];
    const sources = () => SOURCES.filter((s) => !s.available || s.available());

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
        return `<div class="wsr-item${i === sel ? ' is-selected' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">${icon}`
            + `<span class="wsr-title">${esc(r.title)}</span><span class="wsr-line2"><span class="wsr-kind">${esc(r.kind)}</span>`
            + `<span class="wsr-date">${esc(shortDate(r.date))}</span><span class="wsr-size">${esc(sizeText(r.size))}</span></span></div>`;
    }

    function renderResults() {
        const box = page.querySelector('.wsr-results');
        if (results == null) { box.innerHTML = ''; return; }
        if (!results.length) { box.innerHTML = '<div class="wsr-none">No items found.</div>'; return; }
        shown = Math.min(results.length, PAGE_ROWS);
        box.innerHTML = results.slice(0, shown).map(rowHtml).join('');
        box.scrollTop = 0;
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

    async function search() {
        const q = field().value.trim();
        if (!q) return;
        field().blur();
        remember(q);
        const id = ++runId;
        const ql = q.toLowerCase();
        const list = type === 'all' ? ALL_ORDER.map((k) => sources().find((s) => s.id === k)).filter(Boolean) : sources().filter((s) => s.id === type);
        // one source that fails (no connection, no mailbox) leaves the others' answers
        const work = Promise.all(list.map((s) => Promise.resolve().then(() => s.run(ql)).catch((err) => { console.warn('wmSearch:', s.id, err); return []; })));
        const parts = await ws.busy(work, { paint: true, timeout: 30000 }).catch(() => []);
        if (id !== runId) return;
        results = [].concat(...(parts || []));
        sel = results.length ? 0 : -1;
        renderResults();
        ws.refreshSoftKeys();
    }

    function openRow(i) {
        const r = results && results[i];
        if (!r) return;
        sel = i;
        page.querySelectorAll('.wsr-item').forEach((el) => { const on = Number(el.dataset.i) === i; el.classList.toggle('is-selected', on); el.setAttribute('aria-selected', String(on)); });
        try { r.open(); } catch (err) { console.warn('wmSearch: open', err); }
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
            const items = [{ id: 'all', label: 'All data' }].concat(sources()).map((s) => ({ label: s.label, radio: type === s.id, action: () => { type = s.id; renderType(); } }));
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
        types: () => ['all'].concat(sources().map((s) => s.id)),
        _state: () => ({ type, results, sel })
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
