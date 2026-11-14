/**
 * Enshutsuka (Yozora #828): the MMC snap-in that replaced the Knowledge Memories DSAP
 * (dsap://memories.dyna.dreamscape.jp/ and dsap://xi.dyna.dreamscape.jp/persona open it on the desktop).
 *
 *   Enshutsuka (Local)      the stores and the Director's data at a glance
 *     Studio Memories       the Director's knowledge memories: a find box (fast search; Enter opens the
 *     Obliterated Memories  top hit), a category filter, List / Cards / Mind map (View menu), sort and
 *                           items per page (View menu, or a column heading), paging under the list
 *     Director Rules        the static rules: New / Edit / Delete / Copy Rule Text
 *     Director Feedback     the SI feedback entries: Edit / Delete
 *     LinkXi Persona        My Name, Profile Photo, Backstory, Default Verbosity
 *
 * A memory opens as a property sheet (General, Entities, Relations, Observations, Revisions); OK or
 * Apply saves it (update_knowledge_memory). Delete Memories... is an Aero Wizard: the filter with a
 * live count, then a danger page. Server calls are the DSAP's: list / get / update / delete
 * knowledge memories, search_knowledge_memories_fast, get_memory_mind_map, count / delete by filter,
 * director_load / save_rules, director_load / save / delete_feedback, get / save_persona_settings.
 *
 *   window.openEnshutsukaConsole(node?, opts?)
 *       node: 'root' | 'mem' | 'obl' | 'rules' | 'feedback' | 'persona'
 *       opts: { memory (open its sheet), bulk (the Delete Memories wizard; bulk: filter preselects),
 *               search, category, page, perPage, sort, view }
 */
(function (root) {
    'use strict';

    const ID = 'enshutsuka';
    const TITLE = 'Enshutsuka';
    const APP = '/static_images/app_icons';
    // the app icon's compiled sizes (modules/appIconRuntimeAssets.js: /app_icons/<size>/<master>)
    const ICON16 = `${APP}/16/dna.png`;
    const ICON32 = `${APP}/32/dna.png`;
    const ICON48 = `${APP}/48/dna.png`;
    const CMD = '/static_images/vista-cmdbar';
    const VI = '/static_images/vista-icons';
    const ROW_ICON = `${CMD}/note.png`;
    const PER_PAGE = [10, 25, 50, 100];
    const V5_EFFORT = 'V5 Medium effort testing';

    const SORTS = [
        { id: '', label: 'Most used' },
        { id: 'name', label: 'Name' },
        { id: 'updated', label: 'Updated' },
        { id: 'confidence', label: 'Confidence' },
        { id: 'category', label: 'Category' },
        { id: 'model', label: 'Model' }
    ];
    const VIEWS = [
        { id: 'list', label: 'List' },
        { id: 'cards', label: 'Cards' },
        { id: 'map', label: 'Mind Map' }
    ];
    const VERBOSITY = [
        { value: 'auto', text: 'Auto' },
        { value: '1', text: 'Brief' },
        { value: '2', text: 'Direct' },
        { value: '3', text: 'Expressive' },
        { value: '4', text: 'Elaborate' },
        { value: '5', text: 'Poetic' }
    ];
    const FILTERS = [
        { id: 'low_confidence', radio: 201, text: '&Low confidence (below 30%)', desc: 'low confidence (below 30%)' },
        { id: 'old_usage', radio: 202, text: '&Not used in the last 30 days', desc: 'not used in the last 30 days' },
        { id: 'never_used', radio: 203, text: 'N&ever used', desc: 'never used' },
        { id: 'everything', radio: 204, text: 'E&very memory in this store', desc: 'every memory in this store' }
    ];

    // dialog styles (Win32)
    const SS = 0x50020000;
    const ETCHED = 0x50000010;
    const ICON = 0x50000003;
    const EDIT = 0x50010080;
    const MULTI = 0x50211044;
    const PUSH = 0x50010000;
    const DEFPUSH = 0x50010001;
    const RADIO_FIRST = 0x50030009;
    const RADIO = 0x50010009;
    const COMBO_EDIT = 0x50210042;
    const LV = 0x5001000D;
    const EDGE = 0x200;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const isMemNode = (id) => id === 'mem' || id === 'obl';
    const storeOf = (id) => (id === 'obl' ? 'obliterated' : '');
    const nodeOfStore = (store) => (store === 'obliterated' ? 'obl' : 'mem');
    const plural = (n, one, many) => `${Number(n || 0).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;

    function blank() {
        return { page: 1, search: '', category: '', total: 0, memories: [], stats: null, loaded: false, loading: false, error: '', map: null, seq: 0 };
    }

    const state = {
        lists: { '': blank(), obliterated: blank() },
        rules: null,
        feedback: null,
        persona: null,      // the form's values, kept as they are typed
        personaError: '',
        hits: [],           // fast search hits
        hitIndex: 0,
        timers: {},
        c: null
    };

    // ---- the server -------------------------------------------------------------------------------

    async function send(type, data) {
        const client = root.wsClient;
        if (!client || typeof client.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        const r = await client.sendMessage(type, data || {}, false);
        // the Director's handlers answer { data: { success, ... } } inside the reply
        return r && r.data && typeof r.data === 'object' && r.data.success !== undefined && r.success === undefined ? r.data : r;
    }

    function fail(r, text) {
        if (r && r.success) return;
        throw new Error((r && (r.error || r.message)) || text);
    }

    // ---- registry-kept view choices -----------------------------------------------------------------

    const viewOf = (c) => { const v = c.reg('View', 'list'); return VIEWS.some((x) => x.id === v) ? v : 'list'; };
    const perOf = (c) => { const n = Number(c.reg('PerPage', 25)); return PER_PAGE.includes(n) ? n : 25; };
    const sortOf = (c) => { const s = c.reg('Sort', ''); return SORTS.some((x) => x.id === s) ? s : ''; };
    const sortLabel = (id) => (SORTS.find((x) => x.id === id) || SORTS[0]).label;

    // ---- memories ---------------------------------------------------------------------------------

    async function loadList(c, store) {
        const L = state.lists[store];
        const seq = ++L.seq;
        L.loading = true;
        L.error = '';
        paint(c);
        try {
            const r = await send('list_knowledge_memories', {
                page: L.page,
                perPage: perOf(c),
                search: L.search,
                category: L.category || null,
                sort: sortOf(c) || undefined,
                store: store || undefined
            });
            if (seq !== L.seq) return;
            fail(r, 'The memories could not be read.');
            L.memories = Array.isArray(r.memories) ? r.memories : [];
            L.total = Number(r.total) || 0;
            L.page = Number(r.page) || L.page;
            L.stats = r.stats || L.stats;
            L.loaded = true;
            // a page past the end after a delete: go back to the last page
            if (!L.memories.length && L.total && L.page > 1) {
                L.page = Math.max(1, Math.ceil(L.total / perOf(c)));
                L.loading = false;
                void loadList(c, store);
                return;
            }
        } catch (err) {
            if (seq !== L.seq) return;
            L.error = (err && err.message) || 'The server did not answer.';
            L.memories = [];
        }
        L.loading = false;
        if (viewOf(c) === 'map' && c.node === nodeOfStore(store)) await loadMap(c, store, true);
        paint(c);
        if (c.node === 'root') c.refresh();
    }

    async function loadMap(c, store, quiet) {
        const L = state.lists[store];
        L.map = { loading: true };
        if (!quiet) paint(c);
        try {
            const r = await send('get_memory_mind_map', { search: L.search, category: L.category || null, limit: 60, store: store || undefined });
            fail(r, 'The mind map is not available.');
            L.map = { nodes: r.nodes || [], edges: r.edges || [] };
        } catch (err) {
            L.map = { error: (err && err.message) || 'The mind map could not be built.' };
        }
        if (!quiet) paint(c);
    }

    function reload(c, store, opts = {}) {
        const L = state.lists[store];
        if (opts.page !== undefined) L.page = Math.max(1, opts.page);
        void loadList(c, store);
    }

    /** A memory on the list's page, or a box of the mind map (its name and category only). */
    function memByName(store, name) {
        const L = state.lists[store];
        const m = L.memories.find((x) => x.name === name);
        if (m) return m;
        const n = L.map && L.map.nodes && L.map.nodes.find((x) => x.kind === 'memory' && x.name === name);
        return n ? { name: n.name, category: n.category || '', description: '' } : null;
    }
    const confPct = (m) => `${Math.round((Number(m && m.confidence) || 0) * 100)}%`;

    function stamp(t) {
        if (!t) return 0;
        const n = typeof t === 'number' ? t : (/^\d+$/.test(String(t)) ? Number(t) : Date.parse(t));
        if (!Number.isFinite(n)) return 0;
        return n < 1e10 ? n * 1000 : n;
    }

    const whenOrNever = (t) => { const s = stamp(t); return s ? root.mmcConsole.when(s) : 'Never'; };

    // ---- the console tree and pages ------------------------------------------------------------------

    function nodes() {
        return [{
            id: 'root',
            name: `${TITLE} (Local)`,
            icon: ICON16,
            children: [
                { id: 'mem', name: 'Studio Memories', icon: '/static_images/vista-cpl/bulb-16.png' },
                { id: 'obl', name: 'Obliterated Memories', icon: `${CMD}/recycle-bin.png` },
                { id: 'rules', name: 'Director Rules', icon: `${CMD}/checklist.png` },
                { id: 'feedback', name: 'Director Feedback', icon: `${CMD}/discuss.png` },
                { id: 'persona', name: 'LinkXi Persona', icon: '/static_images/vista-contacts/contact-16.png' }
            ]
        }];
    }

    function statsRows(store) {
        const L = state.lists[store];
        const s = L.stats;
        if (!s) return [['Memories', L.error ? esc(L.error) : 'Reading data, please wait...']];
        return [
            ['Memories', esc(Number(s.totalMemories || 0).toLocaleString('en-US'))],
            ['Entities', esc(Number(s.totalEntities || 0).toLocaleString('en-US'))],
            ['Relations', esc(Number(s.totalRelations || 0).toLocaleString('en-US'))],
            ['Categories', esc(String((s.categories || []).length))]
        ];
    }

    function rootPage(c) {
        const link = (id, text) => `<span class="mmc-link" data-act="nav:${id}">${esc(text)}</span>`;
        return c.page(TITLE, 'Director knowledge and persona', [
            { id: 'ens-overview', title: 'Overview', body: c.overview(ICON48, [
                'Enshutsuka keeps what the Director has learned: knowledge memories with their entities, relations and observations, the static rules the Director always follows, the feedback entries from Studio Intelligence, and your LinkXi chat persona.',
                `Open ${link('mem', 'Studio Memories')} to find, read and edit memories. Custom models marked for it share ${link('obl', 'Obliterated Memories')}.`
            ]) },
            { id: 'ens-studio', title: 'Studio Memories', body: c.props(statsRows('')) + `<div class="mmc-buttons"><button type="button" class="btn-standard" data-act="nav:mem">Open Studio Memories</button></div>` },
            { id: 'ens-obl', title: 'Obliterated Memories', body: c.props(statsRows('obliterated')) },
            { id: 'ens-director', title: 'Director', body: c.props([
                ['Director rules', state.rules ? esc(String(state.rules.length)) : 'Reading data, please wait...'],
                ['Feedback entries', state.feedback ? esc(String(state.feedback.length)) : 'Reading data, please wait...'],
                ['LinkXi persona', state.persona ? esc(state.persona.user_name || '(no name set)') : 'Reading data, please wait...']
            ]) + `<p>${link('rules', 'Director Rules')} &middot; ${link('feedback', 'Director Feedback')} &middot; ${link('persona', 'LinkXi Persona')}</p>` }
        ]);
    }

    // The memories page is a frame (the find bar, the body, the pager) that stays while the list
    // changes: loads repaint the body only, so typing in the find box never loses the caret.
    function memPage(node, c) {
        const store = storeOf(node.id);
        const L = state.lists[store];
        const cats = categories(store);
        const html = `<div class="ens-mem" data-store="${esc(store)}">
            <div class="ens-bar">
                <label class="ens-find"><span>F<u>i</u>nd:</span><span class="ens-find-box"><input type="text" class="ens-search" data-field="ens-search-${esc(node.id)}" value="${esc(L.search)}" placeholder="Search memories - Enter opens the top hit" autocomplete="off" spellcheck="false"><span class="ens-hits" hidden></span></span></label>
                <label class="ens-cat"><span>Category:</span><select class="ens-category" data-field="ens-cat-${esc(node.id)}">${catOptions(cats, L.category)}</select></label>
            </div>
            <div class="ens-body" data-mmc-scroll></div>
            <div class="ens-pager"></div>
        </div>`;
        return { html, list: true, mount: (pane) => { wireMemPage(pane, c, store); paintBody(pane, c, store); } };
    }

    function categories(store) {
        const s = state.lists[store].stats;
        return ((s && s.categories) || []).map((x) => (x && typeof x === 'object' ? x.category : x)).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
    }

    function catOptions(cats, current) {
        const list = cats.slice();
        if (current && !list.includes(current)) list.push(current);
        return `<option value="">All Categories</option>${list.map((x) => `<option value="${esc(x)}"${x === current ? ' selected' : ''}>${esc(x)}</option>`).join('')}`;
    }

    /** Repaint the memories page in place (or the root summary), and the Action pane / status bar. */
    function paint(c) {
        if (!c || !c.modal || !c.modal.isConnected) return;
        if (isMemNode(c.node)) {
            const pane = c.el('.mmc-result');
            const store = storeOf(c.node);
            if (pane && pane.querySelector(`.ens-mem[data-store="${store}"]`)) paintBody(pane, c, store);
            else c.render();
        }
        c.renderToolbar();
        c.renderActions();
        c.renderStatus();
    }

    const COLS = [
        { key: 'name', t: 'Name', w: 190, sort: 'name', text: (m) => m.name || '' },
        { key: 'category', t: 'Category', w: 100, sort: 'category', text: (m) => m.category || '' },
        { key: 'confidence', t: 'Confidence', w: 72, sort: 'confidence', num: true, text: (m) => confPct(m) },
        { key: 'uses', t: 'Uses', w: 50, sort: '', num: true, text: (m) => String(m.usage_count || 0) },
        { key: 'last', t: 'Last Used', w: 128, text: (m) => whenOrNever(m.last_used_at) },
        { key: 'updated', t: 'Updated', w: 128, sort: 'updated', text: (m) => whenOrNever(m.updated_at) },
        { key: 'model', t: 'Model', w: 100, sort: 'model', text: (m) => m.model || '' },
        { key: 'desc', t: 'Description', w: 320, text: (m) => m.description || '' }
    ];

    function listHtml(c, L) {
        const cur = sortOf(c);
        const tpl = `${COLS.map((col) => `${col.w}px`).join(' ')} minmax(0, 1fr)`;
        const head = COLS.map((col) => {
            const sortable = col.sort !== undefined;
            const on = sortable && col.sort === cur;
            // the server sorts one way per column: most used and newest first, names A to Z
            const down = on && (col.sort === '' || col.sort === 'updated' || col.sort === 'confidence');
            return `<span class="mmc-col${col.num ? ' is-num' : ''}${on ? ' is-sorted' : ''}"${sortable ? ` data-act="sort:${esc(col.sort)}" title="Sort by ${esc(col.t)}"` : ''}>${on ? `<span class="mmc-arrow${down ? ' is-down' : ''}"></span>` : ''}${esc(col.t)}</span>`;
        }).join('') + '<span class="mmc-col mmc-col-rest"></span>';
        const body = L.memories.map((m) => `<div class="mmc-row${String(m.name) === String(c.sel) ? ' is-selected' : ''}" data-key="${esc(m.name)}">${COLS.map((col, i) => `<span${col.num ? ' class="is-num"' : ''}>${i === 0 ? `<img class="mmc-row-icon" src="${ROW_ICON}" alt="">` : ''}<i>${esc(col.text(m))}</i></span>`).join('')}<span></span></div>`).join('');
        return `<div class="mmc-list ens-list" tabindex="0" style="--cols:${tpl}"><div class="mmc-lhead">${head}</div><div class="mmc-lbody">${body}</div></div>`;
    }

    function cardsHtml(c, L) {
        return `<div class="ens-cards">${L.memories.map((m) => `<div class="ens-card${String(m.name) === String(c.sel) ? ' is-selected' : ''}" data-card="${esc(m.name)}" tabindex="-1">
                <div class="ens-card-head"><img src="${ROW_ICON}" alt=""><b title="${esc(m.name)}">${esc(m.name)}</b></div>
                <div class="ens-card-tags">${m.category ? `<span>${esc(m.category)}</span>` : ''}${m.model ? `<span>${esc(m.model)}</span>` : ''}</div>
                <div class="ens-card-desc">${esc(m.description || '')}</div>
                <div class="ens-card-meta">Confidence ${esc(confPct(m))} &middot; ${esc(plural(m.usage_count || 0, 'use', 'uses'))} &middot; Updated ${esc(whenOrNever(m.updated_at))}</div>
            </div>`).join('')}</div>`;
    }

    function mapHtml(L) {
        const g = L.map;
        if (!g || g.loading) return '<div class="mmc-empty">Building the mind map, please wait...</div>';
        if (g.error) return `<div class="mmc-empty">${esc(g.error)}</div>`;
        const nodes0 = g.nodes || [];
        const memories = nodes0.filter((n) => n.kind === 'memory');
        if (!memories.length) return '<div class="mmc-empty">There are no memories to draw.</div>';
        const byCat = new Map();
        memories.forEach((n) => {
            const cat = n.category || 'uncategorized';
            if (!byCat.has(cat)) byCat.set(cat, []);
            byCat.get(cat).push(n);
        });
        const pos = {};
        let col = 0;
        let maxRows = 1;
        byCat.forEach((group, cat) => {
            const x = 16 + col * 230;
            pos[`cat:${cat}`] = { x, y: 12 };
            group.forEach((n, i) => { pos[n.id] = { x, y: 70 + i * 60 }; });
            maxRows = Math.max(maxRows, group.length);
            col += 1;
        });
        const tags = nodes0.filter((n) => n.kind === 'tag');
        tags.forEach((n, i) => { pos[n.id] = { x: 16 + (i % 4) * 230, y: 70 + maxRows * 60 + 30 + Math.floor(i / 4) * 46 }; });
        const width = Math.max(600, col * 230 + 30);
        const height = Math.max(260, 70 + maxRows * 60 + 60 + Math.ceil(tags.length / 4) * 46);
        const stroke = { reference: '#1d4e89', link: '#8a3b12', shared_tag: '#2f6b3a' };
        const lines = (g.edges || []).map((e) => {
            const a = pos[e.from];
            const b = pos[e.to];
            if (!a || !b) return '';
            return `<line x1="${a.x + 90}" y1="${a.y + 13}" x2="${b.x + 70}" y2="${b.y + 13}" stroke="${stroke[e.kind] || '#999'}" stroke-width="1"/>`;
        }).join('');
        const boxes = nodes0.map((n) => {
            const p = pos[n.id];
            if (!p) return '';
            const mem = n.kind === 'memory';
            const w = mem ? 200 : 150;
            const fill = mem ? '#fffbe9' : (n.kind === 'category' ? '#eaf2fb' : '#ecf6ec');
            const label = String(n.label || n.name || '');
            return `<g class="ens-map-node${mem ? ' is-memory' : ''}" transform="translate(${p.x},${p.y})"${mem ? ` data-card="${esc(n.name)}"` : ''}>
                <rect width="${w}" height="26" rx="2" fill="${fill}" stroke="${mem ? '#c8b68a' : '#9fb4cc'}"/>
                <text x="7" y="17">${esc(label.length > 30 ? `${label.slice(0, 29)}...` : label)}</text><title>${esc(label)}</title></g>`;
        }).join('');
        return `<div class="ens-map"><svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${lines}${boxes}</svg></div>`;
    }

    function paintBody(pane, c, store) {
        const L = state.lists[store];
        const body = pane.querySelector('.ens-body');
        const pager = pane.querySelector('.ens-pager');
        const sel = pane.querySelector('.ens-category');
        if (sel && document.activeElement !== sel) {
            const opts = catOptions(categories(store), L.category);
            if (sel.dataset.opts !== opts) { sel.innerHTML = opts; sel.dataset.opts = opts; }
        }
        const view = viewOf(c);
        let html;
        if (!L.loaded && L.loading) html = '<div class="mmc-empty">Reading data, please wait...</div>';
        else if (L.error) html = `<div class="mmc-empty">${esc(L.error)}</div>`;
        else if (view === 'map') html = mapHtml(L);
        else if (!L.memories.length) html = `<div class="mmc-empty">${L.search || L.category ? 'No memories match the search or the category.' : 'There are no memories in this store.'}</div>`;
        else html = view === 'cards' ? cardsHtml(c, L) : listHtml(c, L);
        if (body && body.dataset.html !== html) {
            const top = body.scrollTop;
            const hadFocus = body.contains(document.activeElement);
            body.innerHTML = html;
            body.dataset.html = html;
            body.scrollTop = top;
            body.classList.toggle('is-list', view === 'list' && !!L.memories.length && !L.error);
            body.classList.toggle('is-busy', !!L.loading);
            if (hadFocus) { const f = body.querySelector('.mmc-list') || body; f.focus({ preventScroll: true }); }
        } else if (body) body.classList.toggle('is-busy', !!L.loading);
        if (pager) {
            const per = perOf(c);
            const pages = Math.max(1, Math.ceil(L.total / per));
            const start = L.total ? (L.page - 1) * per + 1 : 0;
            const end = Math.min(L.page * per, L.total);
            const ph = view === 'map' ? `<span class="ens-pager-text">${esc(plural(((L.map && L.map.nodes) || []).filter((n) => n.kind === 'memory').length, 'memory', 'memories'))} drawn (up to 60)</span>`
                : `<button type="button" class="ens-pg" data-act="page:prev" title="Previous page"${L.page <= 1 ? ' disabled' : ''}>&lt; Previous</button><button type="button" class="ens-pg" data-act="page:next" title="Next page"${L.page >= pages ? ' disabled' : ''}>Next &gt;</button>
                <span class="ens-pager-text" title="Page ${L.page} of ${pages}">${start}-${end} of ${L.total.toLocaleString('en-US')}</span>
                <label class="ens-per">Per page: <select class="ens-perpage">${PER_PAGE.map((n) => `<option value="${n}"${n === per ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
            if (pager.dataset.html !== ph) { pager.innerHTML = ph; pager.dataset.html = ph; }
        }
    }

    function wireMemPage(pane, c, store) {
        const L = state.lists[store];
        const input = pane.querySelector('.ens-search');
        const hitsBox = pane.querySelector('.ens-hits');
        const cat = pane.querySelector('.ens-category');
        input.addEventListener('input', () => {
            clearTimeout(state.timers.fast);
            clearTimeout(state.timers.search);
            const q = input.value;
            state.timers.fast = setTimeout(() => { void fastSearch(c, store, q, hitsBox); }, 80);
            state.timers.search = setTimeout(() => {
                if (L.search === input.value) return;
                L.search = input.value;
                L.page = 1;
                void loadList(c, store);
            }, 280);
        });
        input.addEventListener('keydown', (ev) => {
            const shown = !hitsBox.hidden && state.hits.length;
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                if (!shown) return;
                ev.preventDefault();
                state.hitIndex = (state.hitIndex + (ev.key === 'ArrowDown' ? 1 : -1) + state.hits.length) % state.hits.length;
                hitsBox.querySelectorAll('.ens-hit').forEach((h, i) => h.classList.toggle('is-active', i === state.hitIndex));
            } else if (ev.key === 'Enter') {
                ev.preventDefault();
                clearTimeout(state.timers.search);
                const hit = shown ? state.hits[state.hitIndex] : null;
                hideHits(hitsBox);
                if (hit && hit.name) { void openMemory(c, store, hit.name); return; }
                if (L.search !== input.value) { L.search = input.value; L.page = 1; void loadList(c, store); }
            } else if (ev.key === 'Escape') {
                if (shown) { ev.preventDefault(); ev.stopPropagation(); hideHits(hitsBox); }
            }
        });
        input.addEventListener('blur', () => setTimeout(() => hideHits(hitsBox), 150));
        hitsBox.addEventListener('mousedown', (ev) => {
            const h = ev.target.closest('.ens-hit');
            if (!h) return;
            ev.preventDefault();
            hideHits(hitsBox);
            void openMemory(c, store, h.dataset.name);
        });
        cat.addEventListener('change', () => {
            L.category = cat.value;
            L.page = 1;
            void loadList(c, store);
        });
        pane.querySelector('.ens-pager').addEventListener('change', (ev) => {
            if (!ev.target.classList.contains('ens-perpage')) return;
            c.setReg({ PerPage: Number(ev.target.value) || 25 });
            Object.values(state.lists).forEach((x) => { x.page = 1; });
            void loadList(c, store);
        });
        // cards and mind-map boxes pick like rows; a double click opens the memory
        const body = pane.querySelector('.ens-body');
        const pick = (ev) => {
            const card = ev.target.closest('[data-card]');
            if (!card) return null;
            c.selectRow(card.dataset.card);
            markCards(pane, card.dataset.card);
            return card.dataset.card;
        };
        body.addEventListener('click', pick);
        body.addEventListener('mousedown', (ev) => { if (ev.button === 2) pick(ev); });
        body.addEventListener('dblclick', (ev) => { const name = pick(ev); if (name) void openMemory(c, store, name); });
        if (viewOf(c) === 'map' && !L.map && L.loaded) void loadMap(c, store);
    }

    function markCards(pane, name) {
        pane.querySelectorAll('[data-card]').forEach((el) => el.classList.toggle('is-selected', el.dataset.card === name));
    }

    function hideHits(box) {
        if (!box) return;
        box.hidden = true;
        box.innerHTML = '';
        state.hits = [];
    }

    async function fastSearch(c, store, query, box) {
        const q = String(query || '').trim();
        if (q.length < 2) { hideHits(box); return; }
        try {
            const r = await send('search_knowledge_memories_fast', { query: q, limit: 12, store: store || undefined });
            const input = box && box.parentElement && box.parentElement.querySelector('.ens-search');
            if (!input || input.value.trim() !== q) return;
            const hits = (r && r.success && Array.isArray(r.results)) ? r.results : [];
            if (!hits.length) { hideHits(box); return; }
            state.hits = hits;
            state.hitIndex = 0;
            box.innerHTML = hits.map((h, i) => `<span class="ens-hit${i === 0 ? ' is-active' : ''}" data-name="${esc(h.name)}"><img src="${ROW_ICON}" alt=""><b>${esc(h.name)}</b><small>${esc([h.category, h.model].filter(Boolean).join(' - '))}</small></span>`).join('');
            box.hidden = false;
        } catch (_) {
            hideHits(box);
        }
    }

    // ---- Director Rules and Feedback ------------------------------------------------------------------

    async function loadRules(c) {
        try {
            const r = await send('director_load_rules', {});
            state.rules = r && r.success ? (r.rules || []) : [];
        } catch (_) { state.rules = state.rules || []; }
        if (c && (c.node === 'rules' || c.node === 'root')) c.refresh();
    }

    async function loadFeedback(c) {
        try {
            const r = await send('director_load_feedback', {});
            state.feedback = r && r.success ? (r.feedback || []) : [];
        } catch (_) { state.feedback = state.feedback || []; }
        if (c && (c.node === 'feedback' || c.node === 'root')) c.refresh();
    }

    async function saveRules(c) {
        try {
            const r = await send('director_save_rules', { rules: state.rules || [] });
            if (r && r.success === false) throw new Error(r.error || r.message || 'The rules were not saved.');
            return true;
        } catch (err) {
            await c.box(`<p>The Director rules could not be saved.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
            return false;
        }
    }

    function rulesPage(c) {
        if (!state.rules) return { html: `<div class="mmc-empty">Reading data, please wait...</div>`, list: true };
        const cols = [
            { key: 'text', t: 'Rule', w: 420, text: (r) => r.text || '' },
            { key: 'created', t: 'Created', w: 130, value: (r) => stamp(r.created), text: (r) => whenOrNever(r.created) }
        ];
        const rows = state.rules.map((r) => ({ key: r.id, data: r, icon: `${CMD}/checklist.png` }));
        return { html: c.listView(cols, rows, { sortId: 'ens-rules', empty: 'No static rules are defined. Use New Rule... to add one.' }), list: true };
    }

    function feedbackPage(c) {
        if (!state.feedback) return { html: `<div class="mmc-empty">Reading data, please wait...</div>`, list: true };
        const cols = [
            { key: 'date', t: 'Date', w: 120, value: (f) => stamp(f.timestamp), text: (f) => whenOrNever(f.timestamp) },
            { key: 'action', t: 'Action', w: 80, text: (f) => f.action || '' },
            { key: 'fb', t: 'Feedback', w: 240, text: (f) => f.user_feedback || '(no feedback)' },
            { key: 'sel', t: 'Original', w: 160, text: (f) => f.select_text || '' },
            { key: 'rep', t: 'Replaced With', w: 160, text: (f) => f.replace_text || '' },
            { key: 'why', t: 'SI Reason', w: 240, text: (f) => f.ai_reason || '' }
        ];
        const rows = state.feedback.map((f) => ({ key: f.id, data: f, icon: `${CMD}/discuss.png` }));
        return { html: c.listView(cols, rows, { sortId: 'ens-feedback', sort: { key: 'date', dir: -1 }, empty: 'There are no feedback entries.' }), list: true };
    }

    const ruleById = (id) => (state.rules || []).find((r) => String(r.id) === String(id)) || null;
    const fbById = (id) => (state.feedback || []).find((f) => String(f.id) === String(id)) || null;

    function ruleDialog(c, rule) {
        const api = dialogApi();
        api.openDialog({
            id: 'enshutsukaRuleDialog',
            key: 'ens:rule',
            title: rule ? 'Edit Rule' : 'New Rule',
            owner: c.modal,
            focusFirst: true,
            init: (ctx) => { ctx.set(102, rule ? rule.text || '' : ''); },
            ok: async (ctx) => {
                const text = String(ctx.get(102) || '').trim();
                if (!text) { dlgError(ctx, 103, 'Type the rule.'); return false; }
                if (rule) rule.text = text;
                else (state.rules = state.rules || []).push({ id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`, text, created: new Date().toISOString() });
                const ok = await saveRules(c);
                if (ok) c.note(rule ? 'The rule was changed.' : 'The rule was added.');
                c.refresh();
                return true;
            }
        });
    }

    async function deleteRule(c, id) {
        const rule = ruleById(id);
        if (!rule) return;
        const yes = await c.box('<p>Are you sure you want to delete this rule?</p>', [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: 'warning', title: 'Delete Rule' });
        if (yes !== true) return;
        state.rules = state.rules.filter((r) => r !== rule);
        c.sel = null;
        if (await saveRules(c)) c.note('The rule was deleted.');
        c.refresh();
    }

    function feedbackDialog(c, fb) {
        const api = dialogApi();
        api.openDialog({
            id: 'enshutsukaFeedbackDialog',
            key: 'ens:feedback',
            title: 'Edit Feedback',
            owner: c.modal,
            focusFirst: true,
            init: (ctx) => {
                ctx.set(102, fb.user_feedback || '');
                const rows = [['Date', whenOrNever(fb.timestamp)], ['Action', fb.action], ['Original', fb.select_text], ['Replaced with', fb.replace_text], ['SI reason', fb.ai_reason]].filter(([, v]) => v);
                ctx.html(104, `<div class="ens-dlg-details">${rows.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</div>`);
            },
            ok: async (ctx) => {
                fb.user_feedback = String(ctx.get(102) || '').trim();
                try {
                    await send('director_save_feedback', { feedback: state.feedback });
                    c.note('The feedback entry was changed.');
                } catch (err) {
                    await c.box(`<p>The feedback could not be saved.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
                }
                c.refresh();
                return true;
            }
        });
    }

    async function deleteFeedback(c, id) {
        if (!fbById(id)) return;
        const yes = await c.box('<p>Are you sure you want to delete this feedback entry?</p>', [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: 'warning', title: 'Delete Feedback' });
        if (yes !== true) return;
        try {
            await send('director_delete_feedback', { feedbackId: id });
            state.feedback = state.feedback.filter((f) => String(f.id) !== String(id));
            c.sel = null;
            c.note('The feedback entry was deleted.');
        } catch (err) {
            await c.box(`<p>The feedback entry could not be deleted.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
        c.refresh();
    }

    // ---- LinkXi persona -------------------------------------------------------------------------------

    async function loadPersona(c) {
        try {
            const r = await send('get_persona_settings', {});
            const s = (r && r.success && r.settings) || {};
            state.persona = {
                user_name: s.user_name || '',
                backstory: s.backstory || '',
                default_verbosity: s.default_verbosity != null && s.default_verbosity !== '' ? String(s.default_verbosity) : '3',
                profile_photo_base64: s.profile_photo_base64 || ''
            };
            state.personaError = '';
        } catch (err) {
            state.personaError = (err && err.message) || 'The persona settings could not be read.';
        }
        if (c && (c.node === 'persona' || c.node === 'root')) c.refresh();
    }

    function personaPage(c) {
        const p = state.persona;
        if (!p) {
            return c.page('LinkXi Persona', '', [{ id: 'ens-persona', title: 'Chat Persona', body: state.personaError ? `<p>${c.state(false, state.personaError)}</p>` : '<p>Reading data, please wait...</p>' }]);
        }
        const photo = p.profile_photo_base64 ? `data:image/jpeg;base64,${p.profile_photo_base64}` : '/static_images/account-pictures/guest.png';
        const body = `${c.overview('', ['Your LinkXi chat persona for Director conversations: the name the Director calls you, your picture, a backstory it keeps in mind, and how much it says by default. The settings are saved to your account.'])}
            <div class="mmc-form ens-persona">
                <label for="ensPersonaName">My <u>n</u>ame:</label>
                <input type="text" id="ensPersonaName" data-pfield="user_name" value="${esc(p.user_name)}" placeholder="Enter your name" autocomplete="off" spellcheck="false">
                <label>Profile photo:</label>
                <div class="ens-photo-row"><span class="ens-photo"><img src="${esc(photo)}" alt=""></span><span class="ens-photo-btns"><button type="button" class="btn-standard" data-act="photo">Browse...</button>${p.profile_photo_base64 ? '<button type="button" class="btn-standard" data-act="photo-clear">Remove</button>' : ''}</span></div>
                <label for="ensPersonaBackstory" class="ens-top">My <u>b</u>ackstory:</label>
                <textarea id="ensPersonaBackstory" data-pfield="backstory" rows="6" spellcheck="true">${esc(p.backstory)}</textarea>
                <label for="ensPersonaVerbosity">Default <u>v</u>erbosity:</label>
                <select id="ensPersonaVerbosity" data-pfield="default_verbosity">${VERBOSITY.map((o) => `<option value="${o.value}"${o.value === p.default_verbosity ? ' selected' : ''}>${o.text}</option>`).join('')}</select>
            </div>
            <div class="mmc-buttons"><button type="button" class="btn-standard" data-act="persona-save">Save Persona</button><button type="button" class="btn-standard" data-act="refresh">Revert</button></div>`;
        return {
            html: c.page('LinkXi Persona', p.user_name ? p.user_name : '', [{ id: 'ens-persona', title: 'Chat Persona', body }]),
            mount: (pane) => {
                pane.querySelectorAll('[data-pfield]').forEach((el) => {
                    const keep = () => { if (state.persona) state.persona[el.dataset.pfield] = el.value; };
                    el.addEventListener('input', keep);
                    el.addEventListener('change', keep);
                });
            }
        };
    }

    function pickPhoto(c) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file || !state.persona) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                state.persona.profile_photo_base64 = String(e.target.result || '').split(',')[1] || '';
                c.note('The photo is used when you save the persona.');
                c.refresh();
            };
            reader.readAsDataURL(file);
        });
        input.click();
    }

    async function savePersona(c) {
        const p = state.persona;
        if (!p) return;
        const settings = {
            user_name: p.user_name || '',
            backstory: p.backstory || '',
            // the column is an integer: Auto is stored as the default (3), as the DSAP did
            default_verbosity: parseInt(p.default_verbosity, 10) || 3,
            profile_photo_base64: p.profile_photo_base64 || ''
        };
        try {
            const client = root.wsClient;
            const r = client && typeof client.savePersonaSettings === 'function' ? await client.savePersonaSettings(settings) : await send('save_persona_settings', { settings });
            fail(r, 'The persona settings were not saved.');
            if (root.chatSystem) root.chatSystem.personaSettings = settings;
            c.note('The persona was saved.');
            c.refresh();
        } catch (err) {
            await c.box(`<p>The persona settings could not be saved.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    // ---- a memory's property sheet ---------------------------------------------------------------------

    function templates() {
        const lvPage = (base, text, extra) => ({ t: '', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
            [base, 'S', 7, 7, 238, 16, SS, text, 0],
            [base + 1, 'SysListView32', 7, 26, 238, extra ? 112 : 150, LV, '', EDGE],
            ...(extra ? [[base + 5, 'S', 7, 142, 238, 34, SS, '', 0]] : []),
            [base + 2, 'B', 7, 182, 50, 14, PUSH, '&Add...', 0],
            [base + 3, 'B', 61, 182, 50, 14, PUSH, '&Edit...', 0],
            [base + 4, 'B', 115, 182, 50, 14, PUSH, '&Remove', 0]
        ] });
        const T = {
            'ens:general': { t: 'General', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'E', 44, 10, 201, 13, EDIT, '', EDGE],
                [12, 'S', 7, 34, 238, 1, ETCHED, '', 0],
                [13, 'S', 7, 42, 60, 8, SS, '&Description:', 0],
                [14, 'E', 7, 52, 238, 62, MULTI, '', EDGE],
                [15, 'S', 7, 122, 50, 8, SS, '&Category:', 0],
                [16, 'C', 60, 120, 120, 120, COMBO_EDIT, '', 0],
                [17, 'S', 7, 139, 50, 8, SS, 'C&onfidence:', 0],
                [18, 'E', 60, 137, 40, 13, EDIT | 0x2000, '', EDGE],
                [19, 'S', 104, 139, 20, 8, SS, '%', 0],
                [20, 'S', 7, 156, 238, 1, ETCHED, '', 0],
                [21, 'S', 7, 164, 50, 8, SS, 'Usage:', 0], [22, 'S', 60, 164, 185, 8, SS, '', 0],
                [23, 'S', 7, 176, 50, 8, SS, 'Last used:', 0], [24, 'S', 60, 176, 185, 8, SS, '', 0],
                [25, 'S', 7, 188, 50, 8, SS, 'Updated:', 0], [26, 'S', 60, 188, 185, 8, SS, '', 0],
                [27, 'S', 7, 200, 50, 8, SS, 'Model:', 0], [28, 'S', 60, 200, 185, 8, SS, '', 0]
            ] },
            'ens:entities': Object.assign(lvPage(30, 'The people, things and ideas this memory is about.'), { t: 'Entities' }),
            'ens:relations': Object.assign(lvPage(40, 'How the entities are related to each other.'), { t: 'Relations' }),
            'ens:observations': Object.assign(lvPage(50, 'What the Director has noticed. Select an observation to see its pictures.', true), { t: 'Observations' }),
            'ens:revisions': { t: 'Revisions', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [60, 'S', 7, 7, 238, 16, SS, 'Each time the memory was saved with pictures. Select a revision to see them.', 0],
                [61, 'SysListView32', 7, 26, 238, 92, LV, '', EDGE],
                [62, 'S', 7, 124, 238, 88, SS, '', 0]
            ] },
            'ens:entity': { t: 'Entity', w: 232, h: 170, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 9, 40, 8, SS, '&Name:', 0], [102, 'E', 50, 7, 175, 13, EDIT, '', EDGE],
                [103, 'S', 7, 27, 40, 8, SS, '&Type:', 0], [104, 'E', 50, 25, 100, 13, EDIT, '', EDGE],
                [105, 'S', 7, 45, 200, 8, SS, '&Attributes (JSON):', 0], [106, 'E', 7, 56, 218, 86, MULTI, '', EDGE],
                [107, 'S', 7, 148, 110, 18, SS, '', 0],
                [1, 'B', 121, 149, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 175, 149, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ens:relation': { t: 'Relation', w: 232, h: 106, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 9, 40, 8, SS, '&From:', 0], [102, 'E', 50, 7, 175, 13, EDIT, '', EDGE],
                [103, 'S', 7, 27, 40, 8, SS, '&Relation:', 0], [104, 'E', 50, 25, 175, 13, EDIT, '', EDGE],
                [105, 'S', 7, 45, 40, 8, SS, '&To:', 0], [106, 'E', 50, 43, 175, 13, EDIT, '', EDGE],
                [107, 'S', 7, 63, 40, 8, SS, '&Weight:', 0], [108, 'E', 50, 61, 40, 13, EDIT, '', EDGE],
                [110, 'S', 94, 63, 131, 8, SS, '(0 to 1)', 0],
                [109, 'S', 7, 82, 110, 18, SS, '', 0],
                [1, 'B', 121, 85, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 175, 85, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ens:obs': { t: 'Observation', w: 262, h: 170, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 7, 200, 8, SS, '&Observation:', 0], [102, 'E', 7, 18, 248, 106, MULTI, '', EDGE],
                [103, 'S', 7, 132, 40, 8, SS, '&Importance:', 0], [104, 'E', 50, 130, 40, 13, EDIT | 0x2000, '', EDGE],
                [105, 'S', 94, 132, 20, 8, SS, '%', 0],
                [106, 'S', 7, 148, 140, 18, SS, '', 0],
                [1, 'B', 151, 149, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 149, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ens:rule': { t: 'Rule', w: 262, h: 122, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 7, 248, 8, SS, 'The Director follows this rule in every conversation. &Rule:', 0],
                [102, 'E', 7, 18, 248, 74, MULTI, '', EDGE],
                [103, 'S', 7, 98, 140, 18, SS, '', 0],
                [1, 'B', 151, 101, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 101, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'ens:feedback': { t: 'Feedback', w: 262, h: 182, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 7, 248, 8, SS, '&Feedback:', 0],
                [102, 'E', 7, 18, 248, 60, MULTI, '', EDGE],
                [104, 'S', 7, 84, 248, 72, SS, '', 0],
                [1, 'B', 151, 161, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 161, 50, 14, PUSH, 'Cancel', 0]
            ] },
            // Delete Memories: the filter with a live count, the danger page, the result
            'ens:bd-choose': { t: '', w: 300, h: 190, f: ['MS Shell Dlg', 8], s: 0, c: [
                [200, 'S', 0, 0, 290, 18, SS, '', 0],
                [201, 'B', 8, 26, 270, 10, RADIO_FIRST, FILTERS[0].text, 0],
                [202, 'B', 8, 42, 270, 10, RADIO, FILTERS[1].text, 0],
                [203, 'B', 8, 58, 270, 10, RADIO, FILTERS[2].text, 0],
                [204, 'B', 8, 74, 270, 10, RADIO, FILTERS[3].text, 0],
                [205, 'S', 0, 98, 290, 40, SS, '', 0]
            ] },
            'ens:bd-danger': { t: '', w: 300, h: 190, f: ['MS Shell Dlg', 8], s: 0, c: [
                [300, 'S', 0, 0, 290, 180, SS, '', 0]
            ] },
            'ens:bd-done': { t: '', w: 300, h: 190, f: ['MS Shell Dlg', 8], s: 0, c: [
                [400, 'S', 0, 0, 290, 160, SS, '', 0]
            ] }
        };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, T);
    }

    function dialogApi() {
        const api = root.vistaDialogTemplate;
        if (!api || typeof api.openSheet !== 'function') throw new Error('The dialog could not be shown.');
        templates();
        return api;
    }

    function dlgError(ctx, id, text, key) {
        ctx.html(id, text ? `<span class="ens-dlg-error"><img src="${VI}/error-16.png" alt="">${esc(text)}</span>` : '', key);
    }

    /** A list view in a sheet page: cols [{ t, w }], rows [{ cells, icon? }]. */
    function fillList(lv, cols, rows, empty) {
        if (!lv) return;
        lv.classList.add('is-report');
        lv.querySelector('.vdt-lv-header').innerHTML = cols.map((col) => `<span class="vdt-lv-col" style="width:${col.w}px">${esc(col.t)}</span>`).join('');
        lv.querySelector('.vdt-lv-body').innerHTML = rows.length
            ? rows.map((r, i) => `<div class="vdt-lv-row" data-row="${i}">${r.cells.map((cell, j) => `<span style="width:${cols[j].w}px">${j === 0 && r.icon ? `<img src="${esc(r.icon)}" alt="">` : ''}${esc(cell)}</span>`).join('')}</div>`).join('')
            : `<div class="ens-lv-empty">${esc(empty || '')}</div>`;
    }

    const selectedRow = (lv) => { const r = lv && lv.querySelector('.vdt-lv-row.is-selected'); return r ? Number(r.dataset.row) : -1; };

    function thumbs(images) {
        const list = Array.isArray(images) ? images : [];
        if (!list.length) return '';
        return `<div class="ens-thumbs">${list.map((img) => {
            const id = img && (img.imageId || img.image || img);
            if (!id || typeof id !== 'string') return '';
            const tip = [img.note, img.source].filter(Boolean).join(' - ') || id;
            return `<button type="button" class="ens-thumb" data-image="${esc(id)}" title="${esc(tip)}"><img src="/images/${encodeURIComponent(id)}" alt="" loading="lazy"></button>`;
        }).join('')}</div>`;
    }

    function openImage(id) {
        if (!id) return;
        // openLumenForFilenames: public/scripts/comp/mcpActivityClient.js
        if (typeof root.openLumenForFilenames === 'function') {
            try { const r = root.openLumenForFilenames([id]); if (r && r.ok) return; } catch (_) { /* fall back */ }
        }
        root.open(`/images/${encodeURIComponent(id)}`, '_blank', 'noopener');
    }

    async function openMemory(c, store, name, again) {
        let mem = again || null;
        if (!mem) {
            try {
                const r = await send('get_knowledge_memory', { name, store: store || undefined });
                fail(r, `The memory "${name}" could not be loaded.`);
                mem = r.memory;
                if (!mem) throw new Error(`The memory "${name}" could not be loaded.`);
            } catch (err) {
                await c.box(`<p>${esc((err && err.message) || `The memory "${name}" could not be loaded.`)}</p>`, null, { icon: 'error' });
                return;
            }
        }
        memorySheet(c, store, mem, !!again);
    }

    const sheets = new Map(); // store + name -> the open sheet's ctx
    let sheetSeq = 0;

    function memorySheet(c, store, mem, dirty0) {
        const api = dialogApi();
        const sheetKey = `${store}\n${mem.name}`;
        const open0 = sheets.get(sheetKey);
        if (open0 && open0.modal && open0.modal.isConnected) {
            if (typeof root.bringModalToFront === 'function') root.bringModalToFront(open0.modal);
            return;
        }
        const original = mem.name;
        const work = JSON.parse(JSON.stringify(mem));
        // the list row has the dates get_knowledge_memory leaves out
        const row = memByName(store, original);
        if (row) ['updated_at', 'last_used_at', 'usage_count', 'model'].forEach((k) => { if (work[k] == null && row[k] != null) work[k] = row[k]; });
        work.entities = Array.isArray(work.entities) ? work.entities : [];
        work.relations = Array.isArray(work.relations) ? work.relations : [];
        work.observations = Array.isArray(work.observations) ? work.observations : [];
        const findings = () => work.name === V5_EFFORT || work.observations.some((o) => o && o.finding);
        let saved = false;

        const paintEntities = (ctx) => fillList(ctx.el(31, 'ens:entities'), [{ t: 'Name', w: 130 }, { t: 'Type', w: 80 }, { t: 'Attributes', w: 220 }],
            work.entities.map((e) => ({ cells: [e.name || '', e.type || '', e.attributes && Object.keys(e.attributes).length ? JSON.stringify(e.attributes) : ''] })), 'There are no entities.');
        const paintRelations = (ctx) => fillList(ctx.el(41, 'ens:relations'), [{ t: 'From', w: 110 }, { t: 'Relation', w: 90 }, { t: 'To', w: 110 }, { t: 'Weight', w: 50 }],
            work.relations.map((r) => ({ cells: [r.from || '', r.type || '', r.to || '', r.weight != null ? Number(r.weight).toFixed(2) : '1.00'] })), 'There are no relations.');
        const paintObs = (ctx) => {
            const cols = findings()
                ? [{ t: 'Date', w: 70 }, { t: 'Prompt gist', w: 160 }, { t: 'Medium vs high', w: 110 }, { t: 'Verdict', w: 80 }, { t: 'Pictures', w: 56 }]
                : [{ t: 'Observation', w: 270 }, { t: 'Importance', w: 70 }, { t: 'Pictures', w: 56 }];
            fillList(ctx.el(51, 'ens:observations'), cols, work.observations.map((o) => {
                const pics = String((o.images || []).length || '');
                if (!findings()) return { cells: [o.content || '', o.importance != null ? `${Math.round(Number(o.importance) * 100)}%` : '', pics] };
                const f = o.finding || { date: '', gist: o.content || '', result: '', verdict: '' };
                return { cells: [f.date || '', f.gist || o.content || '', f.result || '', f.verdict || '', pics] };
            }), findings() ? 'No findings.' : 'There are no observations.');
            ctx.html(55, '', 'ens:observations');
        };
        const paintRevisions = (ctx) => {
            const revs = Array.isArray(work.revisions) ? work.revisions : [];
            fillList(ctx.el(61, 'ens:revisions'), [{ t: 'Revision', w: 70 }, { t: 'Date', w: 130 }, { t: 'Pictures', w: 60 }],
                revs.map((r) => ({ cells: [`Revision ${r.revision != null ? r.revision : ''}`, whenOrNever(r.createdAt), String((r.images || []).length)] })), 'There are no revisions yet.');
            ctx.html(62, revs.length ? '<span class="ens-hint">Select a revision to see its pictures.</span>' : '', 'ens:revisions');
        };

        // Add / Edit for the three lists: the item's dialog, then the list and Apply
        const editEntity = (ctx, i) => {
            const e = i >= 0 ? work.entities[i] : null;
            api.openDialog({
                id: 'enshutsukaEntityDialog', key: 'ens:entity', title: e ? 'Edit Entity' : 'Add Entity', owner: ctx.modal, focusFirst: true,
                init: (d) => { d.set(102, e ? e.name || '' : ''); d.set(104, e ? e.type || '' : ''); d.set(106, e && e.attributes && Object.keys(e.attributes).length ? JSON.stringify(e.attributes, null, 2) : '{}'); },
                ok: (d) => {
                    const name = String(d.get(102) || '').trim();
                    if (!name) { dlgError(d, 107, 'Type a name.'); return false; }
                    let attributes = {};
                    const raw = String(d.get(106) || '').trim();
                    if (raw) {
                        try { attributes = JSON.parse(raw); } catch (_) { dlgError(d, 107, 'The attributes are not valid JSON.'); return false; }
                        if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) { dlgError(d, 107, 'The attributes must be a JSON object.'); return false; }
                    }
                    const item = { name, type: String(d.get(104) || '').trim(), attributes };
                    if (e) work.entities[i] = item; else work.entities.push(item);
                    paintEntities(ctx);
                    ctx.dirty();
                    return true;
                }
            });
        };
        const editRelation = (ctx, i) => {
            const r = i >= 0 ? work.relations[i] : null;
            api.openDialog({
                id: 'enshutsukaRelationDialog', key: 'ens:relation', title: r ? 'Edit Relation' : 'Add Relation', owner: ctx.modal, focusFirst: true,
                init: (d) => { d.set(102, r ? r.from || '' : ''); d.set(104, r ? r.type || '' : ''); d.set(106, r ? r.to || '' : ''); d.set(108, r && r.weight != null ? String(r.weight) : '1'); },
                ok: (d) => {
                    const from = String(d.get(102) || '').trim();
                    const type = String(d.get(104) || '').trim();
                    const to = String(d.get(106) || '').trim();
                    if (!from || !type || !to) { dlgError(d, 109, 'Type From, Relation and To.'); return false; }
                    let weight = parseFloat(d.get(108));
                    if (!Number.isFinite(weight)) weight = 1;
                    weight = Math.max(0, Math.min(1, weight));
                    const item = { from, type, to, weight };
                    if (r) work.relations[i] = item; else work.relations.push(item);
                    paintRelations(ctx);
                    ctx.dirty();
                    return true;
                }
            });
        };
        const editObs = (ctx, i) => {
            const o = i >= 0 ? work.observations[i] : null;
            api.openDialog({
                id: 'enshutsukaObservationDialog', key: 'ens:obs', title: o ? 'Edit Observation' : 'Add Observation', owner: ctx.modal, focusFirst: true,
                overrides: { 104: { spin: [0, 100] } },
                init: (d) => { d.set(102, o ? o.content || '' : ''); d.set(104, String(Math.round((o && o.importance != null ? Number(o.importance) : 0.5) * 100))); },
                ok: (d) => {
                    const content = String(d.get(102) || '').trim();
                    if (!content) { dlgError(d, 106, 'Type the observation.'); return false; }
                    const pct = parseFloat(d.get(104));
                    const importance = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) / 100 : 0.5;
                    // pictures and a finding stay with the observation
                    const item = Object.assign({}, o || {}, { content, importance });
                    if (o) work.observations[i] = item; else work.observations.push(item);
                    paintObs(ctx);
                    ctx.dirty();
                    return true;
                }
            });
        };
        const lists = [
            { page: 'ens:entities', lv: 31, add: 32, edit: 33, remove: 34, arr: () => work.entities, open: editEntity, paint: paintEntities },
            { page: 'ens:relations', lv: 41, add: 42, edit: 43, remove: 44, arr: () => work.relations, open: editRelation, paint: paintRelations },
            { page: 'ens:observations', lv: 51, add: 52, edit: 53, remove: 54, arr: () => work.observations, open: editObs, paint: paintObs }
        ];

        const sheet = api.openSheet({
            id: `enshutsukaMemorySheet${++sheetSeq}`,
            title: `${work.name || 'Memory'} Properties`,
            icon: ICON16,
            owner: c.modal,
            pages: [{ key: 'ens:general', overrides: { 10: { image: ICON32 }, 18: { spin: [0, 100] } } }, { key: 'ens:entities' }, { key: 'ens:relations' }, { key: 'ens:observations' }, { key: 'ens:revisions' }],
            init: (ctx) => {
                ctx.set(11, work.name || '', 'ens:general');
                ctx.set(14, work.description || '', 'ens:general');
                ctx.options(16, categories(store), undefined, 'ens:general');
                ctx.set(16, work.category || '', 'ens:general');
                ctx.set(18, String(Math.round((Number(work.confidence) || 0) * 100)), 'ens:general');
                ctx.text(22, plural(work.usage_count || 0, 'time', 'times'), 'ens:general');
                ctx.text(24, whenOrNever(work.last_used_at), 'ens:general');
                ctx.text(26, whenOrNever(work.updated_at), 'ens:general');
                ctx.text(28, work.model || '(any)', 'ens:general');
                paintEntities(ctx);
                paintRelations(ctx);
                paintObs(ctx);
                paintRevisions(ctx);
                lists.forEach((L) => {
                    const lv = ctx.el(L.lv, L.page);
                    const sync = () => { const on = selectedRow(lv) >= 0; ctx.enable(L.edit, on, L.page); ctx.enable(L.remove, on, L.page); };
                    sync();
                    // picking a row is not a change to the memory (Apply stays off)
                    lv.addEventListener('change', (ev) => {
                        ev.stopPropagation();
                        sync();
                        if (L.page === 'ens:observations') {
                            const o = work.observations[selectedRow(lv)];
                            ctx.html(55, o && (o.images || []).length ? thumbs(o.images) : '', L.page);
                        }
                    });
                    lv.addEventListener('dblclick', (ev) => { if (ev.target.closest('.vdt-lv-row')) L.open(ctx, selectedRow(lv)); });
                    lv.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Delete' && selectedRow(lv) >= 0) { ev.preventDefault(); ctx.el(L.remove, L.page).click(); }
                    });
                    ctx.on(L.add, 'click', () => L.open(ctx, -1), L.page);
                    ctx.on(L.edit, 'click', () => { const i = selectedRow(lv); if (i >= 0) L.open(ctx, i); }, L.page);
                    ctx.on(L.remove, 'click', () => {
                        const i = selectedRow(lv);
                        if (i < 0) return;
                        L.arr().splice(i, 1);
                        L.paint(ctx);
                        sync();
                        ctx.dirty();
                    }, L.page);
                });
                const revLv = ctx.el(61, 'ens:revisions');
                revLv.addEventListener('change', (ev) => {
                    ev.stopPropagation();
                    const r = (work.revisions || [])[selectedRow(revLv)];
                    ctx.html(62, r && (r.images || []).length ? thumbs(r.images) : '<span class="ens-hint">This revision has no pictures.</span>', 'ens:revisions');
                });
                ctx.content.addEventListener('click', (ev) => { const t = ev.target.closest('.ens-thumb'); if (t) openImage(t.dataset.image); });
                if (dirty0) ctx.dirty();
            },
            apply: async (ctx) => {
                const name = String(ctx.get(11, 'ens:general') || '').trim() || original;
                const pct = parseFloat(ctx.get(18, 'ens:general'));
                work.name = name;
                work.description = String(ctx.get(14, 'ens:general') || '').trim();
                work.category = String(ctx.get(16, 'ens:general') || '').trim() || null;
                if (Number.isFinite(pct)) work.confidence = Math.max(0, Math.min(100, pct)) / 100;
                const updates = {
                    name,
                    description: work.description,
                    category: work.category,
                    confidence: work.confidence,
                    entities: work.entities.filter((e) => e && e.name),
                    relations: work.relations.filter((r) => r && r.from && r.type && r.to),
                    observations: work.observations.filter((o) => o && o.content)
                };
                try {
                    const r = await send('update_knowledge_memory', { name: original, updates, store: store || undefined });
                    fail(r, 'The memory was not saved.');
                    saved = true;
                    c.note(`The memory ${name} was saved.`);
                    if (name !== original && String(c.sel) === String(original)) c.sel = name;
                    reload(c, store);
                } catch (err) {
                    // keep the edits: say why, then open the sheet again with them
                    const msg = (err && err.message) || 'The memory was not saved.';
                    setTimeout(async () => {
                        await c.box(`<p>The memory could not be saved.</p><p>${esc(msg)}</p>`, null, { icon: 'error' });
                        memorySheet(c, store, Object.assign({}, work, { name: original, _renamed: name }), true);
                    }, 0);
                    sheets.delete(sheetKey);
                    ctx.close();
                }
            },
            close: () => { sheets.delete(sheetKey); if (saved) c.renderActions(); }
        });
        if (!sheet) return;
        sheets.set(sheetKey, sheet);
        // a sheet reopened after a failed save keeps the typed name
        if (mem._renamed) sheet.set(11, mem._renamed, 'ens:general');
    }

    async function deleteMemory(c, store, name) {
        if (!name) return;
        const yes = await c.box(`<p>Are you sure you want to permanently delete the memory <b>${esc(name)}</b>?</p><p>This cannot be undone.</p>`, [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: 'warning', title: 'Delete Memory' });
        if (yes !== true) return;
        try {
            const r = await send('delete_knowledge_memory', { name, store: store || undefined });
            fail(r, 'The memory was not deleted.');
            if (String(c.sel) === String(name)) c.sel = null;
            c.note(`The memory ${name} was deleted.`);
            reload(c, store);
        } catch (err) {
            await c.box(`<p>The memory could not be deleted.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    // ---- Delete Memories (Aero Wizard) ----------------------------------------------------------------

    function bulkWizard(c, store, preset) {
        const api = dialogApi();
        const storeName = store ? 'Obliterated Memories' : 'Studio Memories';
        let filter = null;
        let count = 0;
        let seq = 0;
        let deleted = 0;
        const next = (ctx) => ctx.content.querySelector('.vdt-wizard-next');
        const choose = async (ctx, id) => {
            filter = id;
            count = 0;
            const mine = ++seq;
            next(ctx).disabled = true;
            ctx.html(205, '<div class="ens-count"><span>Matching memories:</span><b>Counting...</b></div>', 'ens:bd-choose');
            try {
                const r = await send('count_knowledge_memories_by_filter', { filterType: id, store: store || undefined });
                if (mine !== seq) return;
                fail(r, 'The memories could not be counted.');
                count = Number(r.count) || 0;
                ctx.html(205, `<div class="ens-count"><span>Matching memories:</span><b>${count.toLocaleString('en-US')}</b>${count ? '' : '<i>Nothing matches; there is nothing to delete.</i>'}</div>`, 'ens:bd-choose');
                next(ctx).disabled = count === 0;
            } catch (err) {
                if (mine !== seq) return;
                ctx.html(205, `<span class="ens-dlg-error"><img src="${VI}/error-16.png" alt="">${esc((err && err.message) || 'The memories could not be counted.')}</span>`, 'ens:bd-choose');
            }
        };
        const desc = () => (FILTERS.find((f) => f.id === filter) || {}).desc || filter;
        api.openWizard({
            id: 'enshutsukaDeleteWizard',
            title: 'Delete Memories',
            icon: ICON32,
            owner: c.modal,
            init: (ctx) => {
                ctx.text(200, `Choose which memories to delete from ${storeName}. The memories that match are counted before anything is deleted.`, 'ens:bd-choose');
                ctx.html(205, '<div class="ens-count"><span>Matching memories:</span><b>-</b><i>Choose a filter above.</i></div>', 'ens:bd-choose');
                FILTERS.forEach((f) => ctx.on(f.radio, 'change', () => { if (ctx.get(f.radio, 'ens:bd-choose')) void choose(ctx, f.id); }, 'ens:bd-choose'));
                const pre = FILTERS.find((f) => f.id === preset);
                if (pre) { ctx.set(pre.radio, true, 'ens:bd-choose'); void choose(ctx, pre.id); }
            },
            pages: [
                {
                    key: 'ens:bd-choose', instruction: 'Which memories do you want to delete?',
                    show: (ctx) => { next(ctx).disabled = !filter || count === 0; },
                    next: () => (filter && count ? 'ens:bd-danger' : false)
                },
                {
                    key: 'ens:bd-danger', instruction: 'Are you sure you want to delete these memories?', nextText: 'Delete',
                    show: (ctx) => {
                        next(ctx).disabled = false;
                        ctx.html(300, `<div class="ens-wiz-text"><div class="ens-wiz-banner is-danger"><img src="${VI}/msgbox-warning-32.png" alt=""><span><b>${esc(plural(count, 'memory', 'memories'))} will be deleted permanently.</b></span></div>
                            <p>Every memory in ${esc(storeName)} that is ${esc(desc())} is deleted, with its entities, relations, observations and revisions. Deleted memories cannot be recovered.</p>
                            <p>The Director forgets what they taught it. Memories it learns later start again from nothing.</p></div>`, 'ens:bd-danger');
                    },
                    next: async (ctx) => {
                        next(ctx).disabled = true;
                        try {
                            const r = await send('delete_knowledge_memories_by_filter', { filterType: filter, store: store || undefined });
                            fail(r, 'The memories were not deleted.');
                            deleted = Number(r.deletedCount) || 0;
                        } catch (err) {
                            next(ctx).disabled = false;
                            await c.box(`<p>The memories could not be deleted.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
                            return false;
                        }
                        return 'ens:bd-done';
                    }
                },
                {
                    key: 'ens:bd-done', instruction: 'The memories were deleted', finish: true, noBack: true,
                    show: (ctx) => {
                        next(ctx).disabled = false;
                        ctx.html(400, `<div class="ens-wiz-text"><p>${esc(plural(deleted, 'memory was', 'memories were'))} deleted from ${esc(storeName)}.</p></div>`, 'ens:bd-done');
                    }
                }
            ],
            finish: () => { state.lists[store].page = 1; reload(c, store); },
            close: () => { if (deleted) { c.note(`${plural(deleted, 'memory was', 'memories were')} deleted.`); reload(c, store); } }
        });
    }

    // ---- commands ---------------------------------------------------------------------------------

    function copyText(c, text) {
        const t = String(text || '');
        if (!t) return;
        // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
        const p = typeof root.copyTextToClipboard === 'function' ? root.copyTextToClipboard(t) : (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject(new Error('no clipboard')));
        Promise.resolve(p).then(() => c.note('Copied to the Clipboard.')).catch(() => c.note('The text could not be copied.'));
    }

    function commands(node, c) {
        if (isMemNode(node.id)) {
            return [
                { text: 'Find...', action: 'find', icon: `${CMD}/find.png` },
                { text: 'Delete Memories...', action: 'bulk', icon: `${CMD}/delete.png` },
                { separator: true },
                ...VIEWS.map((v) => ({ text: `View as ${v.label}`, action: `view:${v.id}`, disabled: viewOf(c) === v.id }))
            ];
        }
        if (node.id === 'rules') return [{ text: 'New Rule...', action: 'rule-new', icon: `${CMD}/add.png` }];
        if (node.id === 'persona') {
            return [
                { text: 'Save Persona', action: 'persona-save', icon: `${CMD}/save.png`, disabled: !state.persona },
                { text: 'Change Photo...', action: 'photo', icon: `${CMD}/picture.png`, disabled: !state.persona }
            ];
        }
        return [];
    }

    function selCommands(node, key, c) {
        if (isMemNode(node.id)) {
            const m = memByName(storeOf(node.id), key);
            if (!m) return null;
            return { title: m.name, items: [
                { text: 'Open', action: 'open', icon: 8 },
                { separator: true },
                { text: 'Copy Name', action: 'copy-name', icon: `${CMD}/copy.png` },
                { text: 'Copy Description', action: 'copy-desc', disabled: !m.description },
                { separator: true },
                { text: 'Delete', action: 'delete', icon: `${CMD}/delete.png` }
            ] };
        }
        if (node.id === 'rules') {
            const r = ruleById(key);
            if (!r) return null;
            const t = String(r.text || '');
            return { title: t.length > 28 ? `${t.slice(0, 27)}...` : t, items: [
                { text: 'Edit Rule...', action: 'open', icon: 8 },
                { text: 'Copy Rule Text', action: 'copy-rule', icon: `${CMD}/copy.png` },
                { separator: true },
                { text: 'Delete Rule', action: 'delete', icon: `${CMD}/delete.png` }
            ] };
        }
        if (node.id === 'feedback') {
            const f = fbById(key);
            if (!f) return null;
            return { title: 'Feedback entry', items: [
                { text: 'Edit Feedback...', action: 'open', icon: 8 },
                { text: 'Copy Feedback Text', action: 'copy-fb', icon: `${CMD}/copy.png`, disabled: !f.user_feedback },
                { separator: true },
                { text: 'Delete Feedback', action: 'delete', icon: `${CMD}/delete.png` }
            ] };
        }
        return null;
    }

    function toolbar(node, c) {
        const none = c.sel == null;
        if (isMemNode(node.id) || node.id === 'rules' || node.id === 'feedback') {
            return [{ id: 'refresh', i: 3, title: 'Refresh' }, { id: 'open', i: 8, title: 'Properties', disabled: none }, { id: 'delete', i: 11, title: 'Delete', disabled: none }];
        }
        return node.id === 'root' ? [] : [{ id: 'refresh', i: 3, title: 'Refresh' }];
    }

    function viewMenu(node, c) {
        if (!isMemNode(node.id)) return [];
        const radio = (text, action, on) => ({ text, action, checked: on, showIndicator: true, indicatorMark: 'radio' });
        return [
            ...VIEWS.map((v) => radio(v.label, `view:${v.id}`, viewOf(c) === v.id)),
            { separator: true },
            { text: 'Sort By', submenu: SORTS.map((s) => radio(s.label, `sort:${s.id}`, sortOf(c) === s.id)) },
            { text: 'Items per Page', submenu: PER_PAGE.map((n) => radio(String(n), `per:${n}`, perOf(c) === n)) }
        ];
    }

    async function action(a, c) {
        const node = c.node;
        const store = storeOf(node);
        if (a.startsWith('view:')) {
            c.setReg({ View: a.slice(5) });
            if (isMemNode(node)) {
                if (a === 'view:map') await loadMap(c, store);
                paint(c);
            }
            return true;
        }
        if (a.startsWith('sort:')) {
            c.setReg({ Sort: a.slice(5) });
            Object.values(state.lists).forEach((x) => { x.page = 1; });
            if (isMemNode(node)) void loadList(c, store);
            return true;
        }
        if (a.startsWith('per:')) {
            c.setReg({ PerPage: Number(a.slice(4)) || 25 });
            Object.values(state.lists).forEach((x) => { x.page = 1; });
            if (isMemNode(node)) void loadList(c, store);
            return true;
        }
        if (a === 'page:prev' || a === 'page:next') {
            const L = state.lists[store];
            L.page = Math.max(1, L.page + (a === 'page:next' ? 1 : -1));
            const body = c.el('.ens-body');
            if (body) body.scrollTop = 0;
            void loadList(c, store);
            return true;
        }
        switch (a) {
            case 'refresh':
                if (isMemNode(node)) { state.lists[store].map = null; void loadList(c, store); } else if (node === 'rules') void loadRules(c);
                else if (node === 'feedback') void loadFeedback(c);
                else if (node === 'persona') { state.persona = null; c.refresh(); void loadPersona(c); } else { void loadList(c, ''); void loadList(c, 'obliterated'); void loadRules(c); void loadFeedback(c); void loadPersona(c); }
                return true;
            case 'find': { const i = c.el('.ens-search'); if (i) { i.focus(); i.select(); } return true; }
            case 'bulk': if (isMemNode(node)) bulkWizard(c, store); return true;
            case 'open':
                if (c.sel == null) return true;
                if (isMemNode(node)) void openMemory(c, store, c.sel);
                else if (node === 'rules') { const r = ruleById(c.sel); if (r) ruleDialog(c, r); } else if (node === 'feedback') { const f = fbById(c.sel); if (f) feedbackDialog(c, f); }
                return true;
            case 'delete':
                if (c.sel == null) return true;
                if (isMemNode(node)) await deleteMemory(c, store, c.sel);
                else if (node === 'rules') await deleteRule(c, c.sel);
                else if (node === 'feedback') await deleteFeedback(c, c.sel);
                return true;
            case 'copy-name': copyText(c, c.sel); return true;
            case 'copy-desc': { const m = memByName(store, c.sel); copyText(c, m && m.description); return true; }
            case 'copy-rule': { const r = ruleById(c.sel); copyText(c, r && String(r.text || '').trim()); return true; }
            case 'copy-fb': { const f = fbById(c.sel); copyText(c, f && f.user_feedback); return true; }
            case 'rule-new': ruleDialog(c, null); return true;
            case 'persona-save': await savePersona(c); return true;
            case 'photo': pickPhoto(c); return true;
            case 'photo-clear': if (state.persona) { state.persona.profile_photo_base64 = ''; c.refresh(); } return true;
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('enshutsuka'); return true;
            default: return false;
        }
    }

    function status(node, c) {
        if (isMemNode(node.id)) {
            const L = state.lists[storeOf(node.id)];
            if (L.error) return 'The server did not answer.';
            if (!L.loaded) return 'Reading data, please wait...';
            const s = L.stats || {};
            return `${plural(s.totalMemories != null ? s.totalMemories : L.total, 'memory', 'memories')}, ${plural(s.totalEntities || 0, 'entity', 'entities')}, ${plural(s.totalRelations || 0, 'relation', 'relations')}${L.search || L.category ? ` - ${plural(L.total, 'match', 'matches')}` : ''} - sorted by ${sortLabel(sortOf(c))}`;
        }
        if (node.id === 'rules') return state.rules ? plural(state.rules.length, 'rule', 'rules') : 'Reading data, please wait...';
        if (node.id === 'feedback') return state.feedback ? plural(state.feedback.length, 'feedback entry', 'feedback entries') : 'Reading data, please wait...';
        if (node.id === 'persona') return state.persona ? '' : 'Reading data, please wait...';
        return '';
    }

    function page(node, c) {
        if (isMemNode(node.id)) return memPage(node, c);
        if (node.id === 'rules') return rulesPage(c);
        if (node.id === 'feedback') return feedbackPage(c);
        if (node.id === 'persona') return personaPage(c);
        return rootPage(c);
    }

    function rowOpen(key, node, c) {
        state.c = c;
        void action('open', c);
    }

    // ---- open ---------------------------------------------------------------------------------------

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            nodes,
            page,
            commands,
            selCommands,
            toolbar,
            viewMenu,
            action,
            rowOpen,
            status,
            onSelectRow: (key, node, c) => { c.renderToolbar(); },
            about: { version: '1.0.0', lines: ['Enshutsuka keeps the Director\'s knowledge memories, static rules, feedback and your LinkXi persona.'] },
            onOpen: (c) => {
                state.c = c;
                // the first time: both stores' counts for the summary, then the rest
                void loadList(c, '');
                void loadList(c, 'obliterated');
                void loadRules(c);
                void loadFeedback(c);
                void loadPersona(c);
            },
            onClose: () => { Object.values(state.timers).forEach((t) => clearTimeout(t)); state.c = null; }
        };
    }

    /** Apply opts (a dsap:// link's filters, a memory to open, the wizard) to an open console. */
    function apply(c, node, opts) {
        const o = opts || {};
        if (isMemNode(node)) {
            const store = storeOf(node);
            const L = state.lists[store];
            let changed = false;
            ['search', 'category'].forEach((k) => { if (o[k] !== undefined && L[k] !== String(o[k] || '')) { L[k] = String(o[k] || ''); changed = true; } });
            if (o.page) { L.page = Math.max(1, Number(o.page) || 1); changed = true; }
            if (o.perPage && PER_PAGE.includes(Number(o.perPage))) { c.setReg({ PerPage: Number(o.perPage) }); changed = true; }
            if (o.sort !== undefined && SORTS.some((s) => s.id === o.sort)) { c.setReg({ Sort: o.sort }); changed = true; }
            if (o.view && VIEWS.some((v) => v.id === o.view)) c.setReg({ View: o.view });
            if (changed) { if (!o.page) L.page = 1; void loadList(c, store); }
            delete c.el('.mmc-result').dataset.html;
            c.render();
            if (o.memory) void openMemory(c, store, String(o.memory));
            if (o.bulk) bulkWizard(c, store, typeof o.bulk === 'string' ? o.bulk : null);
        }
    }

    async function openEnshutsukaConsole(node, opts) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        const valid = ['root', 'mem', 'obl', 'rules', 'feedback', 'persona'];
        const target = valid.includes(node) ? node : (opts && (opts.memory || opts.bulk) ? 'mem' : null);
        const had = !!root.mmcConsole.get(ID);
        const c = root.mmcConsole.open(def(), target ? { node: target } : {});
        if (c && opts) apply(c, target || c.node, opts);
        if (c && had && target === 'persona' && !state.persona) void loadPersona(c);
        return c;
    }

    root.openEnshutsukaConsole = openEnshutsukaConsole;
    root.mmcEnshutsuka = { open: openEnshutsukaConsole, _state: state };
})(typeof window !== 'undefined' ? window : globalThis);
