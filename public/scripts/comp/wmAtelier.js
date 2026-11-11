/**
 * Melaton Mobile: Atelier, a phone version of the desktop's NAX tag browser (naxtApplet.js,
 * Start > Atelier = openNaxtApplet), Yozora #732 (parent #709). Not the desktop window re-hosted:
 * the same galleries and tags (get_nax_galleries / get_nax_tags with the desktop's payload, sort,
 * marks, quick presets and pins), pictures from /naxCache, and the desktop instance's own actions
 * (naxtApplet.addToPrompt / setFavoriteForTag / setTryMarkForTag / setHiddenForTag / addToBag /
 * compileBag / openNaxItemInViewer) on WM 6.1 screens laid out like Pictures & Videos:
 *
 *   tags      "Enter a tag..." find box (Enter searches, as on the desktop), the Gallery combo, then the
 *             pictures as a thumbnail grid with the tag under each (a star / vial for Favorite / Try);
 *             more load as the grid scrolls. Menu: Sort, Reverse Order, Show (marks), Missing, Quick
 *             filters (GOAT, Hidden Gems, Debated), Reset Filters, Bag, Refresh.
 *   tag       the tag's picture (tap = the picture view), Gallery / Votes / Marks rows. Soft keys Add (to
 *             Studio's prompt; Studio opens first when it is closed, then comes to the front) / Menu
 *             (Replace in Prompt, Copy Tag, View Picture, Favorite, Try, Hidden, Add to Bag).
 *   bag       the tags collected for Phasewalker (the desktop's bag, kept in localStorage): Compile (the
 *             desktop's compileBag into Studio's stages) / Menu (Open in Phasewalker, Remove, Clear).
 *
 * Missing tags (no picture yet) are listed with a question mark; making their picture is a desktop job.
 * The desktop's routes to the Atelier window (openNaxtApplet, naxtApplet.open from Run) open this app on
 * phones. Only on phones. Styles: public/css/wm-atelier.css (+ wm-suite-kit.css).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'atelier';
    const TITLE = 'Atelier';
    const ICON = 'app-atelier';
    const PAGE = 50;
    const SORTS = [['score', 'Score'], ['name', 'Name'], ['date', 'Date (export order)'], ['ratio', 'Ratio'], ['random', 'Random']];
    const MARKS = [['all', 'All Tags'], ['favorites', 'Favorites'], ['try', 'Try'], ['unmarked', 'Unmarked'], ['custom', 'Custom'], ['hidden', 'Hidden']];
    const MISSING = [['include', 'Show Missing'], ['hide', 'Hide Missing'], ['only', 'Only Missing']];
    const QUICK = [['goat', 'GOAT'], ['gems', 'Hidden Gems'], ['debated', 'Debated']];

    let sh = null;
    let K = null;
    let page = null;
    let galleries = [];
    let slug = null;
    let query = '';
    let sort = 'score';
    let invert = false;
    let markFilter = 'all';
    let missingMode = 'include';
    let quick = '';
    let ranges = {}; // minUp, maxUp, minDown, maxDown, minRatio, maxRatio (the quick presets' numbers)
    let seed = 0;
    let items = [];
    let offset = 0;
    let total = 0;
    let hasMore = false;
    let loading = false;
    let gen = 0;
    let started = false;
    let selected = null; // index in items
    let current = null; // the item on the tag screen
    let bagSel = 0;
    let layers = []; // 'tag', 'bag'
    let observer = null;

    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const esc = (s) => K.esc(s);
    const applet = () => window.naxtApplet || null;
    const keyOf = (it) => `${it.gallerySlug}\0${it.tag}`;
    const imageUrl = (it) => `/naxCache/${encodeURIComponent(it.gallerySlug)}/${encodeURIComponent(it.filename)}`;
    const labelOf = (list, v) => (list.find((x) => x[0] === v) || [v, v])[1];

    function galleryLabel(g) {
        /* global naxtGalleryMenuLabel, naxtGalleryVersionBucket */
        const name = typeof naxtGalleryMenuLabel === 'function' ? naxtGalleryMenuLabel(g) : (g.title || g.slug);
        const v = typeof naxtGalleryVersionBucket === 'function' ? naxtGalleryVersionBucket(g.version) : '';
        return v ? `${v}: ${name}` : name;
    }

    // ---------------------------------------------------------------- data

    async function start() {
        if (!K.connected()) throw new Error('The server connection is down.');
        if (!await K.feature('naxt')) throw new Error('Atelier could not be loaded.');
        patchApplet();
        const a = applet();
        if (a && typeof a.loadBagFromStorage === 'function') a.loadBagFromStorage();
        if (!galleries.length) {
            const data = await window.wsClient.sendMessage('get_nax_galleries', {}, false);
            galleries = (data && data.galleries) || [];
        }
        if (!slug || !galleries.some((g) => g.slug === slug)) slug = (a && a.selectedGallerySlug && galleries.some((g) => g.slug === a.selectedGallerySlug)) ? a.selectedGallerySlug : (galleries[0] && galleries[0].slug) || null;
        started = true;
    }

    function payload(append) {
        const num = (k) => (ranges[k] == null || ranges[k] === '' ? null : Number(ranges[k]));
        const p = {
            gallerySlug: slug, query, sort, markFilter, missingMode, invert,
            minUp: num('minUp'), maxUp: num('maxUp'), minDown: num('minDown'), maxDown: num('maxDown'),
            minScore: null, maxScore: null, minRatio: num('minRatio'), maxRatio: num('maxRatio'),
            offset: append ? offset : 0, limit: PAGE
        };
        if (sort === 'random') p.randomSeed = seed;
        /* global naxtNormalizeElevatePins */
        let pins = 0;
        try { pins = Number(localStorage.getItem('naxtElevatePins')) || 0; } catch (_) { pins = 0; }
        p.elevatePins = typeof naxtNormalizeElevatePins === 'function' ? naxtNormalizeElevatePins(pins) : pins;
        return p;
    }

    async function loadPage(append) {
        if (!slug || !K.connected()) return;
        const g = ++gen;
        loading = true;
        try {
            const data = await window.wsClient.sendMessage('get_nax_tags', payload(append), !append);
            if (g !== gen) return;
            const got = (data && data.items) || [];
            total = (data && data.total) || 0;
            hasMore = !!(data && data.hasMore);
            if (!append) { items = []; offset = 0; selected = null; }
            const real = data && data.realCount != null ? Number(data.realCount) : got.length;
            offset += Number.isFinite(real) ? real : got.length;
            const seen = new Set(items.map(keyOf));
            for (const it of got) if (!seen.has(keyOf(it))) items.push(it);
        } finally {
            if (g === gen) loading = false;
        }
    }

    /** From the top: the wait cursor (a tap asked for it), errors as a box. */
    async function reload() {
        try {
            await sh.busy(async () => { if (!started) await start(); await loadPage(false); }, { paint: true });
        } catch (err) {
            K.tell(APP_ID, { title: TITLE, icon: 'error', text: `The tags could not be read.\n\n${K.errText(err)}`.trim() });
        }
        renderGrid(true);
    }

    async function loadMore() {
        if (loading || !hasMore || view() !== 'list') return;
        try { await loadPage(true); } catch (err) { console.warn('[wmAtelier] more', err); return; }
        renderGrid(false);
    }

    // ---------------------------------------------------------------- tags grid

    function cellHtml(it, n) {
        const sel = n === selected;
        const marks = `${it.favorite ? '<span class="wat-mark is-fav" title="Favorite"></span>' : ''}${it.tryMark ? '<span class="wat-mark is-try" title="Try"></span>' : ''}`;
        const pic = it.missing || !it.filename
            ? '<span class="wat-missing">?</span>'
            : `<img src="${esc(imageUrl(it))}" alt="" loading="lazy" decoding="async" draggable="false">`;
        return `<div class="wat-cell${sel ? ' is-selected' : ''}${it.hidden ? ' is-hidden' : ''}" role="option" aria-selected="${sel}" data-n="${n}">`
            + `<span class="wat-pic">${pic}</span><span class="wat-cap">${marks}${esc(it.tag)}</span></div>`;
    }

    function renderGrid(fromTop) {
        if (!page) return;
        const box = page.querySelector('.wat-list');
        const g = galleries.find((x) => x.slug === slug);
        box.querySelector('.wat-gallery .wsk-combo-text').textContent = g ? galleryLabel(g) : '(none)';
        const grid = box.querySelector('.wat-grid');
        if (fromTop) grid.innerHTML = items.map(cellHtml).join('');
        else {
            const have = grid.children.length;
            grid.insertAdjacentHTML('beforeend', items.slice(have).map((it, k) => cellHtml(it, have + k)).join(''));
        }
        if (fromTop) box.querySelector('.wsk-scroll').scrollTop = 0;
        const note = box.querySelector('.wat-foot');
        const filtered = !!(query || quick || markFilter !== 'all' || missingMode !== 'include');
        note.textContent = !started ? '' : !galleries.length ? 'No tag galleries on the server.'
            : !items.length ? (filtered ? 'No tags match.' : 'No tags.')
            : `${items.length} of ${total} tags${hasMore ? '' : '.'}`;
        box.querySelector('.wat-band-filter').textContent = filterText();
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function filterText() {
        const bits = [];
        if (quick) bits.push(labelOf(QUICK, quick));
        if (markFilter !== 'all') bits.push(labelOf(MARKS, markFilter));
        if (missingMode !== 'include') bits.push(labelOf(MISSING, missingMode));
        bits.push(`${labelOf(SORTS, sort).replace(/ \(.*/, '')}${invert ? ' (reversed)' : ''}`);
        return bits.join(', ');
    }

    function selectCell(n) {
        selected = n;
        page.querySelectorAll('.wat-cell').forEach((c) => {
            const on = Number(c.dataset.n) === n;
            c.classList.toggle('is-selected', on);
            c.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function watchScroll() {
        const box = page.querySelector('.wat-list .wsk-scroll');
        if (observer) observer.disconnect();
        observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { root: box, rootMargin: '400px 0px' });
        observer.observe(page.querySelector('.wat-foot'));
    }

    // ---------------------------------------------------------------- filters (the desktop's rules)

    function setFilters(fn) {
        fn();
        reload();
    }

    function applyQuick(id) {
        setFilters(() => {
            ranges = {};
            invert = false;
            if (quick === id) { quick = ''; sort = 'score'; markFilter = 'all'; missingMode = 'include'; return; }
            quick = id;
            if (id === 'goat') { ranges = { minUp: 15, minRatio: 0.75 }; sort = 'score'; }
            else if (id === 'gems') { ranges = { minUp: 1, maxUp: 4, maxDown: 0 }; seed = (Math.random() * 2147483647) | 0; sort = 'random'; }
            else if (id === 'debated') { ranges = { minUp: 5, minDown: 5, minRatio: 0.5, maxRatio: 0.6 }; sort = 'ratio'; }
        });
    }

    function resetFilters() {
        setFilters(() => { quick = ''; ranges = {}; sort = 'score'; seed = 0; invert = false; markFilter = 'all'; missingMode = 'include'; });
    }

    function pickSort(v) {
        setFilters(() => {
            if (v === 'random') { seed = (Math.random() * 2147483647) | 0; invert = false; } else if (sort === 'random') seed = 0;
            sort = v;
            quick = '';
        });
    }

    function pickGallery(v) {
        if (v === slug) return;
        // the desktop resets search, sort and ranges on a category change (resetFiltersOnCategoryChange)
        setFilters(() => {
            slug = v;
            const a = applet();
            if (a) a.selectedGallerySlug = v;
            query = ''; quick = ''; ranges = {}; sort = 'score'; seed = 0; invert = false;
            const s = page && page.querySelector('.wat-search');
            if (s) s.value = '';
        });
    }

    // ---------------------------------------------------------------- tag screen

    function showLayer() {
        if (!page) return;
        const v = view();
        page.querySelector('.wat-list').hidden = v !== 'list';
        page.querySelector('.wat-tag').hidden = v !== 'tag';
        page.querySelector('.wat-bag').hidden = v !== 'bag';
        if (v === 'tag') renderTag();
        if (v === 'bag') renderBag();
        if (isCurrent()) {
            sh.setTitle(TITLE);
            sh.refreshSoftKeys();
            sh.refreshTitleAction();
        }
    }

    function openTag(it) {
        if (!it) return;
        current = it;
        layers.push('tag');
        showLayer();
        page.querySelector('.wat-tag .wsk-body').scrollTop = 0;
        sh.syncHistory();
    }

    function renderTag() {
        const box = page.querySelector('.wat-tag');
        const it = current;
        if (!it) return;
        box.querySelector('.wsk-head-name').textContent = it.tag;
        const img = box.querySelector('.wat-big');
        const missing = it.missing || !it.filename;
        img.hidden = missing;
        if (!missing && img.getAttribute('src') !== imageUrl(it)) img.src = imageUrl(it);
        box.querySelector('.wat-big-missing').hidden = !missing;
        const g = galleries.find((x) => x.slug === it.gallerySlug);
        const marks = [it.favorite && 'Favorite', it.tryMark && 'Try', it.hidden && 'Hidden', it.isCustom && 'Custom', inBag(it) && 'In bag'].filter(Boolean).join(', ') || 'None';
        const rows = [
            ['Gallery', g ? galleryLabel(g) : it.gallerySlug],
            ['Votes', `+${Number(it.upvotes) || 0} / -${Number(it.downvotes) || 0}`],
            ['Marks', marks]
        ];
        box.querySelector('.wat-rows').innerHTML = rows.map(([l, v]) => `<div class="wsk-crow"><span class="wsk-clabel">${esc(l)}:</span><span class="wsk-cvalue">${esc(v)}</span></div>`).join('');
    }

    const inBag = (it) => { const a = applet(); return !!(a && typeof a.isInBag === 'function' && a.isInBag(it.tag, it.gallerySlug)); };

    /** Studio's prompt: the desktop's addToPrompt (artist:x formatting, Replace keeps the emphasis). */
    async function addToStudio(it, mode) {
        const a = applet();
        if (!it || !a) return;
        if (!K.studioOpen() && typeof window.openManualModalWithContent === 'function') {
            try { await sh.busy(() => window.openManualModalWithContent(), { paint: true }); } catch (_) { /* below */ }
        }
        if (!K.studioOpen()) { await sh.messageBox({ title: TITLE, icon: 'error', text: 'Studio could not be opened.' }); return; }
        a.addToPrompt(it.tag, it.gallerySlug, mode || 'add');
        // addToPrompt clears the Try mark (the desktop's rule): keep the phone's copy in step
        if (it.tryMark) { it.tryMark = false; refreshItem(it); }
        sh.open('studio');
    }

    function viewPicture(it) {
        const a = applet();
        if (!it || it.missing || !it.filename || !a) return;
        a.openNaxItemInViewer(it);
    }

    async function setMark(it, kind, on) {
        const a = applet();
        if (!it || !a) return;
        const call = { favorite: 'setFavoriteForTag', tryMark: 'setTryMarkForTag', hidden: 'setHiddenForTag' }[kind];
        try {
            // the desktop methods report their own errors (a toast: a box after a tap on the phone)
            await sh.busy(() => a[call](it.gallerySlug, it.tag, on), { paint: true });
            it[kind] = on;
        } catch (_) { return; }
        refreshItem(it);
    }

    function refreshItem(it) {
        const n = items.indexOf(it);
        const cell = n >= 0 && page && page.querySelector(`.wat-cell[data-n="${n}"]`);
        if (cell) cell.outerHTML = cellHtml(it, n);
        if (view() === 'tag' && current === it) renderTag();
        if (isCurrent()) sh.refreshSoftKeys();
    }

    async function addToBag(it) {
        const a = applet();
        if (!it || !a || it.missing || !it.filename) return;
        if (inBag(it)) { await sh.messageBox({ title: TITLE, icon: 'info', text: `"${it.tag}" is already in the bag.` }); return; }
        await a.addToBag(it.tag, it.gallerySlug, it.filename);
        if (view() === 'tag') renderTag();
    }

    async function copyTag(it) {
        if (!it) return;
        try { await K.copy(it.tag); } catch (_) { await sh.messageBox({ title: TITLE, icon: 'error', text: 'The tag could not be copied.' }); }
    }

    // ---------------------------------------------------------------- bag

    const bag = () => { const a = applet(); return a && Array.isArray(a.bag) ? a.bag : []; };

    function openBag() {
        bagSel = 0;
        layers.push('bag');
        showLayer();
        sh.syncHistory();
    }

    function renderBag() {
        const box = page.querySelector('.wat-bag');
        const list = bag();
        if (bagSel >= list.length) bagSel = Math.max(0, list.length - 1);
        box.querySelector('.wat-bag-rows').innerHTML = list.map((e, n) => {
            const sel = n === bagSel;
            const g = galleries.find((x) => x.slug === e.gallerySlug);
            return `<div class="wsk-row wat-bag-row${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-n="${n}">`
                + `<span class="wsk-ico"><img src="${esc(imageUrl(e))}" alt="" draggable="false"></span>`
                + `<span class="wsk-name">${esc(e.tag)}</span><span class="wsk-sub">${esc(g ? galleryLabel(g) : e.gallerySlug)}</span></div>`;
        }).join('');
        const note = box.querySelector('.wsk-note');
        note.hidden = list.length > 0;
        note.textContent = 'The bag is empty. Add tags from their screens (Menu > Add to Bag).';
        if (isCurrent()) sh.refreshSoftKeys();
    }

    const phasewalkerOnPhone = () => sh.listApps().some((a) => a.id === 'phasewalker');

    async function compileBag() {
        const a = applet();
        if (!a || !bag().length) return;
        if (!K.studioOpen() && typeof window.openManualModalWithContent === 'function') {
            try { await sh.busy(() => window.openManualModalWithContent(), { paint: true }); } catch (_) { /* below */ }
        }
        if (!K.studioOpen()) { await sh.messageBox({ title: TITLE, icon: 'error', text: 'Studio could not be opened.' }); return; }
        a.compileBag();
    }

    async function clearBag() {
        const a = applet();
        if (!a || !bag().length) return;
        const yes = await sh.messageBox({ title: TITLE, icon: 'question', text: `Remove all ${bag().length} tags from the bag?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        a.clearBag();
        renderBag();
    }

    function removeFromBag(n) {
        const a = applet();
        if (!a) return;
        a.removeFromBagAt(n);
        renderBag();
    }

    // ---------------------------------------------------------------- menus / keys

    function tagMenu(it) {
        const ok = !!it;
        const pic = ok && !it.missing && !!it.filename;
        return [
            { label: 'Add to Prompt', disabled: !ok, action: () => addToStudio(it, 'add') },
            { label: 'Replace in Prompt', disabled: !ok, action: () => addToStudio(it, 'replace') },
            { label: 'Copy Tag', disabled: !ok, action: () => copyTag(it) },
            { label: 'View Picture', disabled: !pic, action: () => viewPicture(it) },
            '-',
            { label: 'Favorite', checked: !!(it && it.favorite), disabled: !ok, action: () => setMark(it, 'favorite', !it.favorite) },
            { label: 'Try', checked: !!(it && it.tryMark), disabled: !ok, action: () => setMark(it, 'tryMark', !it.tryMark) },
            { label: 'Hidden', checked: !!(it && it.hidden), disabled: !ok, action: () => setMark(it, 'hidden', !it.hidden) },
            '-',
            { label: 'Add to Bag', disabled: !pic || inBag(it), action: () => addToBag(it) }
        ];
    }

    function listMenu() {
        const it = selected != null ? items[selected] : null;
        return [
            { label: 'Open', disabled: !it, action: () => openTag(it) },
            { label: 'Add to Prompt', disabled: !it, action: () => addToStudio(it, 'add') },
            '-',
            { label: 'Sort', submenu: () => SORTS.map(([v, l]) => ({ label: l, radio: sort === v, action: () => pickSort(v) })) },
            { label: 'Reverse Order', checked: invert, disabled: sort === 'random', action: () => setFilters(() => { invert = !invert; }) },
            { label: 'Show', submenu: () => MARKS.map(([v, l]) => ({ label: l, radio: markFilter === v, action: () => setFilters(() => { markFilter = v; }) })) },
            { label: 'Missing Tags', submenu: () => MISSING.map(([v, l]) => ({ label: l, radio: missingMode === v, action: () => setFilters(() => { missingMode = v; }) })) },
            { label: 'Quick Filter', submenu: () => QUICK.map(([v, l]) => ({ label: l, checked: quick === v, action: () => applyQuick(v) })) },
            { label: 'Reset Filters', action: resetFilters },
            '-',
            { label: `Bag (${bag().length})`, action: openBag },
            { label: 'Refresh', action: reload }
        ];
    }

    function bagMenu() {
        const list = bag();
        return [
            { label: 'Compile into Studio', disabled: !list.length || !phasewalkerOnPhone(), action: compileBag },
            { label: 'Open in Phasewalker', disabled: !list.length || !phasewalkerOnPhone(), action: () => applet().openPhasewalkerFromBag() },
            '-',
            { label: 'Remove', disabled: !list.length, action: () => removeFromBag(bagSel) },
            { label: 'Clear Bag', disabled: !list.length, action: clearBag }
        ];
    }

    function softKeys() {
        const v = view();
        if (v === 'tag') return { left: { label: 'Add', action: () => addToStudio(current, 'add') }, right: { label: 'Menu', menu: () => tagMenu(current) } };
        if (v === 'bag') return { left: { label: 'Compile', disabled: !bag().length || !phasewalkerOnPhone(), action: compileBag }, right: { label: 'Menu', menu: bagMenu } };
        const it = selected != null ? items[selected] : null;
        return { left: { label: 'Open', disabled: !it, action: () => openTag(it) }, right: { label: 'Menu', menu: listMenu } };
    }

    // ---------------------------------------------------------------- desktop routes

    function patchApplet() {
        const a = applet();
        if (!a || a.wmPatched) return;
        a.wmPatched = true;
        // Run's gallery search and the tray open the instance directly
        a.open = async () => { sh.open(APP_ID); };
    }

    // ---------------------------------------------------------------- page

    function mount(p) {
        page = p;
        p.classList.add('wsk', 'wm-atelier');
        p.innerHTML = `
            <div class="wsk-view wat-list">
                <div class="wsk-searchbar"><input class="wsk-search wat-search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Enter a tag..." aria-label="Enter a tag"></div>
                <div class="wsk-band"><span class="wsk-band-label">Gallery:</span>${K.comboHtml('wat-gallery', '')}</div>
                <div class="wat-band-filter"></div>
                <div class="wsk-scroll"><div class="wat-grid" role="listbox" aria-label="Tags"></div><p class="wat-foot"></p></div>
            </div>
            <div class="wsk-view wat-tag" hidden>
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name"></span></div>
                <div class="wsk-body">
                    <div class="wat-split">
                        <div class="wat-stage"><img class="wat-big" alt="" draggable="false"><span class="wat-big-missing" hidden>?</span></div>
                        <div class="wat-rows"></div>
                    </div>
                </div>
            </div>
            <div class="wsk-view is-list wat-bag" hidden>
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name">Bag</span></div>
                <div class="wsk-scroll"><div class="wat-bag-rows" role="listbox" aria-label="Bag"></div><p class="wsk-note" hidden></p></div>
            </div>`;
        const searchEl = p.querySelector('.wat-search');
        searchEl.value = query;
        searchEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const q = searchEl.value.trim();
            searchEl.blur();
            setFilters(() => { query = q; });
        });
        // clearing the box shows everything again, as the desktop's clear button does
        searchEl.addEventListener('input', () => { if (!searchEl.value && query) setFilters(() => { query = ''; }); });
        p.querySelector('.wat-gallery').addEventListener('click', (e) => {
            K.combo(e.currentTarget, galleries.map((g) => ({ value: g.slug, label: galleryLabel(g) })), () => slug, pickGallery);
        });
        const grid = p.querySelector('.wat-grid');
        K.onHold(grid, '.wat-cell', (cell, x, y) => { selectCell(Number(cell.dataset.n)); sh.menuAt(x, y, tagMenu(items[Number(cell.dataset.n)])); });
        grid.addEventListener('click', (e) => {
            const cell = e.target.closest('.wat-cell');
            if (!cell) return;
            const n = Number(cell.dataset.n);
            selectCell(n);
            openTag(items[n]);
        });
        p.querySelector('.wat-stage').addEventListener('click', () => viewPicture(current));
        const bagBox = p.querySelector('.wat-bag .wsk-scroll');
        K.onHold(bagBox, '.wsk-row', (row, x, y) => { bagSel = Number(row.dataset.n); renderBag(); sh.menuAt(x, y, bagMenu()); });
        bagBox.addEventListener('click', (e) => {
            const row = e.target.closest('.wsk-row');
            if (!row) return;
            bagSel = Number(row.dataset.n);
            renderBag();
        });
        watchScroll();
        renderGrid(true);
        showLayer();
    }

    function register() {
        sh = window.wmShell;
        K = window.wmSuiteKit;
        if (!sh || typeof sh.registerApp !== 'function' || !K) return;
        // every desktop route to the Atelier window opens this app (Start, main menu, Run ...)
        window.openNaxtApplet = async function () { sh.open(APP_ID); };
        K.afterFeature('naxt', patchApplet);
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: ICON,
            inStart: 'programs',
            sip: true,
            mount,
            show() {
                showLayer();
                if (!started) reload();
                else renderGrid(false);
            },
            titleKind: () => (view() === 'list' ? 'close' : 'ok'),
            historyDepth: () => layers.length,
            onBack() {
                if (!layers.length) return false;
                layers.pop();
                showLayer();
                return true;
            },
            softKeys
        });
    }

    if (window.wmShell && window.wmSuiteKit) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
