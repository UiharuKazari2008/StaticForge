/**
 * Melaton Mobile: Search Pictures (Yozora #831), the phone's form of the desktop's Image Search
 * (imageSearchApp.js, #828) and of the Global Search DSAP it replaced (dsap://ispy.dreamscape.jp/,
 * omegasearchDsapApplet.js). A WM 6.1 / 6.5 program: Search's form (wmSearch.js, wm-search.css:
 * "Search for:" with the earlier searches under its arrow, "Type:" Images / Scraps / Pinned /
 * Upscaled), a "Results" band, and the results as Pictures & Videos draws a folder (the
 * .wm-pv-cell thumbnail grid of wm-shell.css), as Search's rows (Menu > View > Details), or as the
 * search's prompt usages (Menu > View > Prompt Usages).
 *
 *   search text     comma-separated terms, each a block; "a | b" is one block that matches either
 *                   (the DSAP's own parser). Each term has its match mode (Menu > Match: Substring,
 *                   Whole word, Inner match, Starts with, Ends with); a new term takes the default
 *                   match (Options > Search)
 *   Options...      a WM settings page of this program (wmSettings.registerPage, opened direct, ok
 *                   comes back here): Search (type, workspace, default match, input / final
 *                   prompts), Date (newer / older than, or between two dates), Model (model,
 *                   sampler, noise schedule, resolution), Advanced (steps, guidance, rescale, UC
 *                   preset, content level, quality tags, upscaled, dynamic replacements,
 *                   consecutive seeds). ok runs the search again
 *   paging          the server answers 60 pictures at a time (omegasearch_query offset / limit,
 *                   its search session reused); the next 60 are asked for as the list nears its
 *                   end, and only appended (no rebuild, no poll)
 *   a picture       a tap opens the phone's picture view (lightbox.js openStandalonePhotoSwipe,
 *                   every loaded result a slide); the view's soft keys, Menu and tool strip are
 *                   this program's (wmShell asks the slide's kit: data.wmKit = 'wmSearchPictures'):
 *                   Save | Menu (Zoom, Previous / Next, Add to / Remove from Favorites, Edit >
 *                   DreamStudio / Director, Send > E-mail / Text Message, Set as Today Background,
 *                   Go to Workspace, Properties). Tap-and-hold on a result gives the same Menu.
 *   Properties      the picture's page (request_image_metadata): General (file and generation
 *                   facts), Prompt (input or final, with the characters' prompts), Undesired
 *                   Content; ok returns to the list, or to the picture when it was opened there
 *
 * Server calls are the DSAP's (omegasearch_query, request_image_metadata, both reads); its helpers
 * (omegasearchDsap*) come from omegasearchDsapApplet.js, loaded through the DSAP registry when the
 * program opens. Stored: localStorage wmSearchPictures (type, workspace, view, match modes,
 * filters) and wmSearchPicturesHistory (the earlier searches). Only on phones; a lazy program
 * (wmShell.js LAZY_APPS). Styles: the end of public/css/wm-search.css (.wm-spx).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'search-pictures';
    const TITLE = 'Search Pictures';
    const STATE_KEY = 'wmSearchPictures';
    const HISTORY_KEY = 'wmSearchPicturesHistory';
    const HISTORY_MAX = 10;
    const PAGE = 60;
    const GLOBAL_WS = '*';
    const OPTIONS_PAGE = 'search-pictures-options';
    const MAIL_LIMIT = 20 * 1024 * 1024;

    const VIEW_TYPES = [['images', 'Images'], ['scraps', 'Scraps'], ['pinned', 'Pinned'], ['upscaled', 'Upscaled']];
    const MATCH_MODES = [['substring', 'Substring'], ['word', 'Whole word'], ['inner', 'Inner match'], ['start', 'Starts with'], ['end', 'Ends with']];
    const VIEWS = [['thumbs', 'Thumbnails'], ['details', 'Details'], ['usages', 'Prompt Usages']];
    const RELATIVE = [['', 'Any time'], ['1d', '1 day'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year']];
    const RESOLUTIONS = [['normal', 'Normal'], ['large', 'Large'], ['max', 'Max / wallpaper']];
    const TRI = [['', 'Any'], ['1', 'Yes'], ['0', 'No']];
    const NSFW = [['', 'Any'], ['-2', 'Clense'], ['-1', 'Remove'], ['0', 'Neutral'], ['1', 'Allow'], ['2', 'Skimpy'], ['3', 'Nude']];

    let ws = null;
    let page = null;
    let st = null; // the stored choices (loadState)
    let items = []; // results so far: { filename, metadata }
    let usages = [];
    let total = 0;
    let nextOffset = 0;
    let serverSession = null;
    let query = null; // { key, blocks, payload base } of the search on screen
    let runToken = 0;
    let loading = false;
    let searched = false;
    let failed = '';
    let sel = -1;
    let detail = null; // the Properties page: { file, tab, compiled, at (viewer index or -1) }
    let gridMore = null; // IntersectionObserver on the list's end
    const metaCache = new Map();

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
    const client = () => (typeof wsClient !== 'undefined' && wsClient ? wsClient : null); // eslint-disable-line no-undef
    const connected = () => { const c = client(); return !!(c && typeof c.isConnected === 'function' && c.isConnected()); };
    const fn = (name) => (typeof window[name] === 'function' ? window[name] : null);
    const readJson = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (_) { return fallback; } };
    const writeJson = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* private mode */ } };

    // ---------------------------------------------------------------- the DSAP's helpers

    const have = () => typeof omegasearchDsapBlocksForSearchPayload === 'function'; // eslint-disable-line no-undef
    let helpersP = null;
    /** omegasearchDsapApplet.js through the DSAP registry (dsapRegistry.js), once; resolves false when it could not load. */
    function helpers() {
        if (have()) return Promise.resolve(true);
        if (!helpersP) {
            helpersP = (async () => {
                /* global resolveDsap, loadDsapEntryAssets */
                const m = typeof resolveDsap === 'function' ? resolveDsap('dsap://ispy.dreamscape.jp/') : null;
                if (m && m.entry && typeof loadDsapEntryAssets === 'function') await loadDsapEntryAssets(m.entry);
                return have();
            })().catch((err) => { console.warn('[wmSearchPictures] helpers', err); return false; })
                .then((ok) => { if (!ok) helpersP = null; return ok; });
        }
        return helpersP;
    }
    const H = (name, ...args) => { try { const f = globalThis[name] || (typeof window[name] === 'function' ? window[name] : null); return typeof f === 'function' ? f(...args) : undefined; } catch (_) { return undefined; } };
    // the helpers are top-level functions of a classic script: window properties
    const defaultFilters = () => H('omegasearchDsapDefaultFilters') || {
        dateBefore: null, dateAfter: null, dateRange: null, qualityPreset: null, ucLevel: null, nsfwLevel: null, models: [], stepsMin: null, stepsMax: null,
        sampler: null, scheduler: null, consecutiveSeeds: false, resolutionPreset: [], isUpscaled: null, guidanceMin: null, guidanceMax: null,
        rescaleMin: null, rescaleMax: null, hasDynamicReplacements: null, dateMode: 'relative'
    };

    function loadState() {
        const s = readJson(STATE_KEY, {});
        return {
            viewType: VIEW_TYPES.some(([v]) => v === s.viewType) ? s.viewType : 'images',
            workspaceId: typeof s.workspaceId === 'string' && s.workspaceId ? s.workspaceId : GLOBAL_WS,
            view: VIEWS.some(([v]) => v === s.view) ? s.view : 'thumbs',
            defaultMatch: MATCH_MODES.some(([v]) => v === s.defaultMatch) ? s.defaultMatch : 'substring',
            srcInput: s.srcInput !== false,
            srcCompiled: s.srcCompiled !== false,
            modes: s.modes && typeof s.modes === 'object' ? s.modes : {},
            filters: Object.assign(defaultFilters(), s.filters && typeof s.filters === 'object' ? s.filters : {})
        };
    }
    const saveState = () => {
        // keep the match modes of the last 40 terms only
        const keys = Object.keys(st.modes);
        if (keys.length > 40) keys.slice(0, keys.length - 40).forEach((k) => { delete st.modes[k]; });
        writeJson(STATE_KEY, st);
    };

    const promptSource = () => (st.srcInput && st.srcCompiled ? null : (st.srcCompiled ? 'compiled' : (st.srcInput ? 'input' : null)));
    const filtersPayload = () => H('omegasearchDsapBuildFiltersPayload', st.filters) || {};
    const filtersOn = () => Object.keys(filtersPayload()).length > 0;

    // ---------------------------------------------------------------- names

    const displayName = (f) => String(f || '').replace(/\.(png|jpe?g|webp)$/i, '');
    const imageUrl = (f) => `/images/${encodeURIComponent(f)}`;
    function previewUrl(f) {
        const p = H('omegasearchDsapPreviewUrl', f);
        return p || `/previews/${encodeURIComponent(displayName(f).replace(/_upscaled$/, ''))}.webp`;
    }
    function workspaceLabel(id) {
        if (!id || id === GLOBAL_WS) return 'All Workspaces';
        try { if (typeof workspaces !== 'undefined' && workspaces[id] && workspaces[id].name) return workspaces[id].name; } catch (_) { /* none */ } // eslint-disable-line no-undef
        return id;
    }
    function workspaceList() {
        const l = H('omegasearchDsapGetWorkspaceList');
        if (Array.isArray(l)) return l;
        try { return Object.entries(workspaces || {}).map(([id, w]) => ({ id, name: (w && w.name) || id })); } catch (_) { return []; } // eslint-disable-line no-undef
    }
    const activeWs = () => { try { return typeof activeWorkspace !== 'undefined' && activeWorkspace ? activeWorkspace : null; } catch (_) { return null; } }; // eslint-disable-line no-undef
    const pad = (n) => String(n).padStart(2, '0');
    /** WM's short date: M/D/YY. */
    function shortDate(t) {
        let n = Number(t);
        if (!n) return '';
        if (n < 1e12) n *= 1000;
        const d = new Date(n);
        return Number.isNaN(+d) ? '' : `${d.getMonth() + 1}/${d.getDate()}/${pad(d.getFullYear() % 100)}`;
    }
    function longDate(t) {
        let n = Number(t);
        if (!n) return '';
        if (n < 1e12) n *= 1000;
        const d = new Date(n);
        if (Number.isNaN(+d)) return '';
        const h = d.getHours();
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${(h % 12) || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
    }
    const sizeText = (b) => (b > 0 ? (b < 1024 * 1000 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`) : '');
    function modelName(key) {
        const k = String(key || '').toLowerCase();
        if (!k) return '';
        try {
            /* global modelBadges, modelNames */
            const b = typeof modelBadges !== 'undefined' ? modelBadges[k] : null;
            if (b) return `NovelAI ${b.display_full || b.display || k}${b.badge_full || b.badge ? ` (${b.badge_full || b.badge})` : ''}`;
            if (typeof modelNames !== 'undefined' && modelNames[k]) return modelNames[k];
        } catch (_) { /* lists not loaded */ }
        return key;
    }
    function samplerName(m) {
        if (!m || !m.sampler) return '';
        try { const s = typeof getSamplerMeta === 'function' ? getSamplerMeta(m.sampler) : null; if (s) return s.display_short || s.display || m.sampler; } catch (_) { /* none */ } // eslint-disable-line no-undef
        return m.sampler;
    }

    // ---------------------------------------------------------------- history

    const history = () => { const v = readJson(HISTORY_KEY, []); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; };
    function remember(q) {
        const list = history().filter((x) => x.toLowerCase() !== q.toLowerCase());
        list.unshift(q);
        writeJson(HISTORY_KEY, list.slice(0, HISTORY_MAX));
    }

    // ---------------------------------------------------------------- terms

    const termKey = (b) => b.terms.map((t) => t.toLowerCase()).join('|');
    const termLabel = (b) => (b.mode === 'or' && b.terms.length > 1 ? b.terms.join(' | ') : b.terms[0]);

    /** The field's text as the DSAP's blocks, each with its own match mode. */
    function blocksOf(text) {
        const out = [];
        for (const part of String(text || '').split(',').map((s) => s.trim()).filter(Boolean)) {
            const b = H('omegasearchDsapParseBlockInput', part);
            if (!b || !Array.isArray(b.terms) || !b.terms.length) continue;
            b.matchMode = st.modes[termKey(b)] || st.defaultMatch;
            out.push(b);
        }
        return H('omegasearchDsapNormalizeBlocks', out, { defaultMatchMode: st.defaultMatch }) || out;
    }

    function setBlocksText(blocks) {
        const text = (blocks || []).map((b) => {
            if (b.matchMode && b.matchMode !== st.defaultMatch) st.modes[termKey(b)] = b.matchMode;
            return termLabel(b);
        }).join(', ');
        if (page) field().value = text;
    }

    // ---------------------------------------------------------------- searching

    const field = () => page.querySelector('.wsr-q');

    function searchPayload(blocks) {
        const payload = {
            blocks: H('omegasearchDsapBlocksForSearchPayload', blocks, { defaultMatchMode: st.defaultMatch }) || [],
            workspaceId: st.workspaceId,
            viewType: st.viewType,
            blockOptions: { defaultMatchMode: st.defaultMatch }
        };
        const ps = promptSource();
        if (ps) payload.promptSource = ps;
        const f = filtersPayload();
        if (Object.keys(f).length) payload.filters = f;
        return payload;
    }

    /** A new search from the field (Search, Enter, Options' ok, a match mode). */
    async function search() {
        if (!page) return;
        const raw = field().value.trim();
        if (!raw) return;
        field().blur();
        remember(raw);
        const ok = await ws.busy(helpers(), { paint: true, timeout: 15000 }).catch(() => false);
        if (!ok) { await tell('Search Pictures could not start. Try again when the connection is back.', 'error'); return; }
        const blocks = blocksOf(raw);
        if (!blocks.length) return;
        const base = searchPayload(blocks);
        query = { key: JSON.stringify(base), blocks, base };
        items = [];
        usages = [];
        total = 0;
        nextOffset = 0;
        serverSession = null;
        searched = false;
        failed = '';
        sel = -1;
        const token = ++runToken;
        render(true);
        await ws.busy(fetchPage(token, true), { paint: true, timeout: 60000 }).catch(() => {});
    }

    /** The next PAGE pictures of the search on screen (first: a new search, the server asked afresh). */
    async function fetchPage(token, first) {
        // a new search goes ahead of a page of the old one still on its way (that one is dropped: runToken)
        if (!query || (loading && !first)) return;
        const c = client();
        if (!c || !connected()) {
            failed = 'The server is not connected.';
            searched = true;
            render(true);
            return;
        }
        loading = true;
        const payload = Object.assign({}, query.base, { offset: nextOffset, limit: PAGE });
        if (first) payload.forceRefresh = true;
        else if (serverSession) payload.searchSessionId = serverSession;
        try {
            const data = await c.sendMessage('omegasearch_query', payload, false);
            if (token !== runToken) return;
            const rows = (data && Array.isArray(data.results)) ? data.results.filter((r) => r && r.filename) : [];
            const from = items.length;
            items = items.concat(rows);
            total = (data && Number(data.total)) || 0;
            if (first) usages = (data && Array.isArray(data.usages)) ? data.usages : [];
            if (data && data.searchSessionId) serverSession = data.searchSessionId;
            nextOffset += PAGE;
            searched = true;
            if (first) { sel = items.length ? 0 : -1; render(true); } else appendRows(from);
        } catch (err) {
            if (token !== runToken) return;
            console.warn('[wmSearchPictures] search', err);
            searched = true;
            if (first) { failed = (err && err.message) || 'The search failed.'; render(true); }
        } finally {
            if (token === runToken) loading = false;
            watchEnd();
            if (ws.current === APP_ID) ws.refreshSoftKeys();
        }
    }

    const moreToCome = () => !!query && searched && !failed && nextOffset < total;

    function more() {
        if (!moreToCome() || loading || st.view === 'usages') return;
        void fetchPage(runToken, false);
    }

    // ---------------------------------------------------------------- drawing

    function layout() {
        if (!page) return;
        const box = page.querySelector('.wsp-results');
        const w = (box && box.clientWidth) || page.clientWidth;
        if (!w) return;
        const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;
        page.style.setProperty('--wm-pv-cols', String(Math.max(2, Math.floor(w / (80 * px)))));
    }

    function cellHtml(r, i) {
        const name = r.filename;
        return `<button type="button" class="wm-pv-cell wm-photo${i === sel ? ' is-selected' : ''}" data-i="${i}" aria-label="${esc(displayName(name))}"><img src="${esc(previewUrl(name))}" alt="" loading="lazy" decoding="async" draggable="false"></button>`;
    }

    function rowHtml(r, i) {
        const m = r.metadata || {};
        const dims = m.width && m.height ? `${m.width} x ${m.height}` : '';
        return `<div class="wsr-item${i === sel ? ' is-selected' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">`
            + `<span class="wsr-ico is-thumb"><img src="${esc(previewUrl(r.filename))}" alt="" draggable="false" loading="lazy" decoding="async"></span>`
            + `<span class="wsr-title">${esc(displayName(r.filename))}</span>`
            + `<span class="wsr-line2"><span class="wsr-kind">${esc(dims)}</span><span class="wsr-date">${esc(shortDate(m.mtime))}</span><span class="wsr-size">${esc(sizeText(Number(m.size) || 0))}</span></span></div>`;
    }

    function usageHtml(u, i) {
        const where = [H('omegasearchDsapSourceLabel', u.source) || 'Main prompt'].concat(u.character ? [u.character] : []).join(', ');
        return `<div class="wsr-item wsp-usage" data-u="${i}" role="option">`
            + `<span class="wsr-ico"><img src="${esc(ws.art.url('app-notes'))}" srcset="${esc(ws.art.srcset('app-notes'))}" alt="" draggable="false"></span>`
            + `<span class="wsr-title">${esc(u.block || '')} <span class="wsp-where">(${esc(where)})</span></span>`
            + `<span class="wsr-line2 is-snippet"><span class="wsr-snip">${esc(u.displayText || '')}</span><span class="wsr-date">${esc(num(u.fileCount || 0))}</span></span></div>`;
    }

    function headText() {
        if (!searched || failed) return 'Results';
        if (st.view === 'usages') return `Results (${num(usages.length)})`;
        return `Results (${num(total)})`;
    }

    /** The whole list again (a new search, another view); the next pages are appended (appendRows). */
    function render(top) {
        if (!page) return;
        renderForm();
        page.querySelector('.wsr-head').textContent = headText();
        const box = page.querySelector('.wsp-results');
        box.dataset.view = st.view;
        layout();
        if (!query) { box.innerHTML = ''; return; }
        if (failed) { box.innerHTML = `<div class="wsr-none">${esc(failed)}</div>`; return; }
        if (!searched) { box.innerHTML = ''; return; }
        if (st.view === 'usages') {
            box.innerHTML = usages.length ? usages.map(usageHtml).join('') : '<div class="wsr-none">No prompt usages for this search.</div>';
        } else if (!items.length) {
            box.innerHTML = '<div class="wsr-none">No items found.</div>';
        } else if (st.view === 'details') {
            box.innerHTML = `<div class="wsp-list">${items.map(rowHtml).join('')}</div>`;
        } else {
            box.innerHTML = `<div class="wm-pv-chunk wsp-grid">${items.map(cellHtml).join('')}</div>`;
        }
        if (top) box.scrollTop = 0;
        watchEnd();
    }

    function appendRows(from) {
        if (!page || st.view === 'usages') return;
        page.querySelector('.wsr-head').textContent = headText();
        const host = page.querySelector(st.view === 'details' ? '.wsp-list' : '.wsp-grid');
        if (!host) { render(false); return; }
        const add = items.slice(from).map((r, k) => (st.view === 'details' ? rowHtml(r, from + k) : cellHtml(r, from + k))).join('');
        host.insertAdjacentHTML('beforeend', add);
    }

    /** The next page is asked for when the list's end comes within 1,200 px (no scroll handler work). */
    function watchEnd() {
        if (gridMore) { gridMore.disconnect(); gridMore = null; }
        if (!page || !moreToCome() || st.view === 'usages' || typeof IntersectionObserver !== 'function') return;
        const box = page.querySelector('.wsp-results');
        const host = box.querySelector('.wsp-grid, .wsp-list');
        const last = host && host.lastElementChild;
        if (!last) return;
        gridMore = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { gridMore.disconnect(); gridMore = null; more(); }
        }, { root: box, rootMargin: '0px 0px 1200px 0px' });
        gridMore.observe(last);
    }

    function renderForm() {
        if (!page) return;
        const t = VIEW_TYPES.find(([v]) => v === st.viewType);
        page.querySelector('.wsp-type > span').textContent = t ? t[1] : 'Images';
    }

    function select(i) {
        sel = i;
        page.querySelectorAll('.wsp-results [data-i]').forEach((el) => {
            const on = Number(el.dataset.i) === i;
            el.classList.toggle('is-selected', on);
            if (el.classList.contains('wsr-item')) el.setAttribute('aria-selected', String(on));
        });
    }

    // ---------------------------------------------------------------- the picture

    async function metadata(file) {
        if (metaCache.has(file)) return metaCache.get(file);
        const c = client();
        if (!c || !connected() || typeof c.requestImageMetadata !== 'function') throw new Error('The server is not connected.');
        const meta = await c.requestImageMetadata(file);
        metaCache.set(file, meta || null);
        if (metaCache.size > 200) metaCache.delete(metaCache.keys().next().value);
        return meta;
    }

    /** The picture as the gallery's record (the gallery's own one when it is in this workspace). */
    const imageOf = (file) => H('omegasearchDsapResolveDetailImage', file, metaCache.get(file) || null) || { filename: file, original: file, metadata: metaCache.get(file) || null };

    function pinned(file) {
        const p = H('omegasearchDsapIsDetailImagePinned', file, metaCache.get(file) || null);
        return !!p;
    }

    async function toggleFavorite(file) {
        const toggle = fn('togglePinImage');
        if (!toggle) return;
        const was = pinned(file);
        await ws.busy(Promise.resolve(toggle(imageOf(file))), { paint: true }).catch((err) => console.warn('[wmSearchPictures] favorite', err));
        const m = metaCache.get(file);
        if (m && typeof m === 'object') m.isPinned = !was;
        ws.refreshSoftKeys();
    }

    function studio(file) {
        const open = fn('openManualModalWithContent');
        if (!open) return;
        const image = imageOf(file);
        open({ type: 'image', image, metadata: metaCache.get(file) || image.metadata || null });
    }

    function director(file) {
        const ask = fn('askWrenAboutImage');
        if (ask) ask(file);
    }

    function save(file) {
        if (typeof ws.saveToPhone === 'function') void ws.saveToPhone(imageUrl(file), file);
    }

    function closeViewer() {
        const p = window.pswp;
        return new Promise((resolve) => {
            if (!p || p.isDestroying || typeof p.close !== 'function') { resolve(); return; }
            p.on('destroy', () => resolve());
            setTimeout(resolve, 800);
            try { p.close(); } catch (_) { resolve(); }
        });
    }

    async function fileOf(file) {
        const res = await fetch(imageUrl(file), { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        return new File([blob], file, { type: blob.type || 'image/png' });
    }

    const toBase64 = (blob) => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });

    async function sendMail(file) {
        const compose = fn('wmMessagingCompose');
        if (!compose) return;
        let attachments;
        try {
            await closeViewer();
            const f = await ws.busy(fileOf(file), { paint: true, timeout: 120000 });
            if (f.size > MAIL_LIMIT) { await tell(`The picture is too large to send by e-mail (${Math.round(f.size / 1048576)} MB; at most ${MAIL_LIMIT / 1048576} MB).`, 'warning'); return; }
            attachments = [{ name: f.name, mimeType: f.type || 'application/octet-stream', size: f.size, base64: await toBase64(f) }];
        } catch (err) { await tell('The picture could not be read from the server.', 'error'); console.warn('[wmSearchPictures] send', err); return; }
        compose({ attachments });
    }

    async function sendText(file, accountId) {
        const tm = window.wmTextMessaging;
        if (!tm || typeof tm.composeWithFiles !== 'function' || !accountId) return;
        let f;
        try { await closeViewer(); f = await ws.busy(fileOf(file), { paint: true, timeout: 120000 }); } catch (err) { await tell('The picture could not be read from the server.', 'error'); console.warn('[wmSearchPictures] send', err); return; }
        void tm.composeWithFiles(accountId, [f]);
    }

    function sendItems(file) {
        const tm = window.wmTextMessaging;
        const accounts = tm && typeof tm.accounts === 'function' ? tm.accounts() : [];
        const rows = [];
        if (accounts.length > 1) rows.push({ label: 'Text Message', submenu: () => accounts.map((a) => ({ label: a.name || a.identity || a.id, action: () => sendText(file, a.id) })) });
        else rows.push({ label: 'Text Message', disabled: !accounts.length, action: () => sendText(file, accounts[0] && accounts[0].id) });
        rows.push({ label: 'E-mail', disabled: !fn('wmMessagingCompose'), action: () => sendMail(file) });
        return rows;
    }

    async function goToWorkspace(file) {
        let meta = metaCache.get(file);
        if (meta === undefined) meta = await ws.busy(metadata(file), { paint: true }).catch(() => null);
        const id = H('omegasearchDsapGetDetailWorkspaceId', meta);
        const set = fn('setActiveWorkspace');
        if (!id || !set) { await tell('No workspace was found for this picture.', 'info'); return; }
        await closeViewer();
        set(id);
    }

    /** A picture's commands (the viewer's Menu, a result's tap-and-hold). at: its index in the list. */
    function pictureItems(file, at, inViewer) {
        const out = [];
        if (inViewer) {
            out.push({ label: 'Zoom', action: () => { const p = window.pswp; if (p && typeof p.toggleZoom === 'function') p.toggleZoom(); } });
            const p = window.pswp;
            if (p && typeof p.getNumItems === 'function' && p.getNumItems() > 1) {
                out.push({ label: 'Previous', disabled: p.currIndex <= 0, action: () => p.prev() });
                out.push({ label: 'Next', disabled: p.currIndex >= p.getNumItems() - 1, action: () => p.next() });
            }
            out.push('-');
        } else {
            out.push({ label: 'View', action: () => view(at) });
        }
        out.push({ label: pinned(file) ? 'Remove from Favorites' : 'Add to Favorites', disabled: !fn('togglePinImage'), action: () => toggleFavorite(file) });
        const canStudio = !!fn('openManualModalWithContent');
        const canDirector = !!fn('askWrenAboutImage');
        out.push({ label: 'Edit', disabled: !canStudio && !canDirector, submenu: () => [
            { label: 'DreamStudio', disabled: !canStudio, action: () => studio(file) },
            { label: 'Director', disabled: !canDirector, action: () => director(file) }
        ] });
        out.push({ label: 'Send', submenu: () => sendItems(file) });
        if (!inViewer) out.push({ label: 'Save', action: () => save(file) });
        out.push('-');
        out.push({ label: 'Set as Today Background', action: () => ws.setTodayBackground(file, imageOf(file)) });
        out.push({ label: 'Go to Workspace', disabled: !fn('setActiveWorkspace'), action: () => goToWorkspace(file) });
        out.push('-', { label: 'Properties', action: () => openDetail(file, inViewer ? viewerIndex() : -1) });
        return out;
    }

    // ---------------------------------------------------------------- picture view

    const viewerIndex = () => { const p = window.pswp; return p && typeof p.currIndex === 'number' ? p.currIndex : -1; };

    function slideOf(r) {
        const m = r.metadata || {};
        return {
            src: imageUrl(r.filename),
            msrc: previewUrl(r.filename),
            width: Number(m.width) || 1024,
            height: Number(m.height) || 1024,
            data: { isStandalone: true, title: displayName(r.filename), searchFile: r.filename, wmKit: 'wmSearchPictures' }
        };
    }

    let metaTimer = 0;
    /** The slide's metadata, read once it has been on screen a moment (Favorites' label, Properties). */
    function warmSlide() {
        clearTimeout(metaTimer);
        metaTimer = setTimeout(() => {
            const f = currentFile();
            if (f && !metaCache.has(f)) metadata(f).then(() => { if (ws.current === APP_ID) ws.refreshSoftKeys(); }, () => {});
        }, 350);
    }

    async function view(at) {
        const open = fn('openStandalonePhotoSwipe') || (typeof openStandalonePhotoSwipe === 'function' ? openStandalonePhotoSwipe : null); // eslint-disable-line no-undef
        if (!open || !items[at]) return;
        select(at);
        await ws.busy(Promise.resolve(open(items.map(slideOf), at)), { paint: true });
        const p = window.pswp;
        if (p && typeof p.on === 'function') {
            p.on('change', () => {
                const i = p.currIndex;
                if (typeof i === 'number' && items[i]) select(i);
                warmSlide();
            });
        }
        warmSlide();
    }

    function currentFile() {
        const p = window.pswp;
        const d = p && p.currSlide && p.currSlide.data;
        return (d && d.data && d.data.searchFile) || null;
    }

    // wmShell's picture view asks these for a slide whose data.wmKit names this program
    function viewerSoftKeys(item) {
        const file = (item && item.searchFile) || currentFile();
        return {
            left: { label: 'Save', disabled: !file, action: () => save(file) },
            right: { label: 'Menu', menu: () => (file ? pictureItems(file, viewerIndex(), true) : []) }
        };
    }

    function viewbarState(act, item) {
        const file = item && item.searchFile;
        if (!file) return { enabled: false };
        if (act === 'zoom') return { enabled: true };
        if (act === 'pin') return { enabled: !!fn('togglePinImage'), pressed: pinned(file) };
        if (act === 'studio') return { enabled: !!fn('openManualModalWithContent') };
        if (act === 'director') return { enabled: !!fn('askWrenAboutImage') };
        return { enabled: false }; // Delete: a search deletes nothing
    }

    function viewbarPress(act, item) {
        const file = item && item.searchFile;
        if (!file) return;
        const p = window.pswp;
        if (act === 'zoom') { if (p && typeof p.toggleZoom === 'function') p.toggleZoom(); return; }
        if (act === 'pin') { void toggleFavorite(file); return; }
        if (act === 'studio') { studio(file); return; }
        if (act === 'director') director(file);
    }

    // ---------------------------------------------------------------- Properties

    const DETAIL_TABS = [['general', 'General'], ['prompt', 'Prompt'], ['uc', 'Undesired']];

    async function openDetail(file, at) {
        if (!page) return;
        detail = { file, tab: 'general', compiled: false, at: typeof at === 'number' ? at : -1 };
        if (detail.at >= 0) await closeViewer();
        if (!metaCache.has(file)) await ws.busy(metadata(file), { paint: true, timeout: 20000 }).catch(() => {});
        if (!detail || detail.file !== file) return;
        page.querySelector('.wsp-main').hidden = true;
        page.querySelector('.wsp-detail').hidden = false;
        renderDetail();
        ws.refreshSoftKeys();
        if (typeof ws.syncHistory === 'function') ws.syncHistory();
    }

    function closeDetail() {
        if (!detail) return false;
        const at = detail.at;
        detail = null;
        page.querySelector('.wsp-detail').hidden = true;
        page.querySelector('.wsp-main').hidden = false;
        ws.refreshSoftKeys();
        // opened from the picture view: the picture comes back
        if (at >= 0 && items[at]) void view(at);
        return true;
    }

    function renderDetail() {
        if (!page || !detail) return;
        const ui = window.wmSettings && window.wmSettings.ui;
        const box = page.querySelector('.wsp-detail');
        const file = detail.file;
        const meta = metaCache.get(file) || null;
        const r = items.find((x) => x.filename === file) || { metadata: {} };
        const m = r.metadata || {};
        const e = (s) => esc(s);
        let body = '';
        if (detail.tab === 'general') {
            const facts = [
                ['Name:', displayName(file)],
                ['Type:', `${(String(file).match(/\.([a-z0-9]+)$/i) || [, 'png'])[1].toUpperCase()} Image${m.upscaled || (meta && meta.upscaled) ? ' (upscaled)' : ''}`],
                ['Dimensions:', m.width && m.height ? `${m.width} x ${m.height}` : ''],
                ['Size:', sizeText(Number(m.size) || 0)],
                ['Date:', longDate(m.mtime)]
            ];
            if (meta) {
                const wsl = H('omegasearchDsapFormatImageWorkspaces', meta);
                const model = modelName(meta.model || (typeof determineModelFromMetadata === 'function' ? determineModelFromMetadata(meta) : '')); // eslint-disable-line no-undef
                facts.push(
                    ['Workspace:', wsl && wsl !== '\u2014' ? wsl : ''],
                    ['Model:', model],
                    ['Steps:', meta.steps != null ? String(meta.steps) : ''],
                    ['Guidance:', meta.scale != null ? Number(meta.scale).toFixed(1) : ''],
                    ['Rescale:', meta.cfg_rescale != null ? Number(meta.cfg_rescale).toFixed(2) : ''],
                    ['Sampler:', samplerName(meta)],
                    ['Schedule:', meta.noise_schedule || ''],
                    ['Seed:', meta.seed != null ? String(meta.seed) : ''],
                    ['UC preset:', meta.ucPreset != null ? (H('omegasearchDsapUcLevelLabel', meta.ucPreset) || String(meta.ucPreset)) : ''],
                    ['Quality tags:', meta.qualityToggle === true ? 'Yes' : meta.qualityToggle === false ? 'No' : ''],
                    ['Favorite:', pinned(file) ? 'Yes' : 'No']
                );
            }
            const rows = facts.filter(([, v]) => v !== '' && v != null);
            body = ui ? ui.facts(rows) : rows.map(([l, v]) => `<div>${e(l)} ${e(v)}</div>`).join('');
            if (!meta) body += '<p class="wm-form-note">The picture\'s settings could not be read.</p>';
        } else {
            const f = H('omegasearchDsapResolveDetailPromptFields', meta, detail.compiled) || { mainPrompt: '', mainUc: '', negPrompt: '', chars: [] };
            const chars = Array.isArray(f.chars) ? f.chars : [];
            const combo = `<div class="wm-form-row"><span class="wm-form-label">Show:</span><button type="button" class="wm-combo wsp-src"><span>${detail.compiled ? 'Final prompt' : 'Input prompt'}</span></button></div>`;
            if (detail.tab === 'prompt') {
                body = combo + `<textarea class="wm-edit wsp-text" readonly aria-label="Prompt">${e(f.mainPrompt || '')}</textarea>`;
                chars.forEach((c, i) => {
                    if (!c || !(c.prompt || c.caption)) return;
                    body += `<div class="wm-form-sub">${e(c.chara_name || c.name || `Character ${i + 1}`)}</div><textarea class="wm-edit wsp-text is-short" readonly>${e(c.prompt || c.caption || '')}</textarea>`;
                });
            } else {
                body = combo + `<textarea class="wm-edit wsp-text" readonly aria-label="Undesired Content">${e(f.mainUc || '')}</textarea>`;
                if (f.negPrompt) body += `<div class="wm-form-sub">Negative input</div><textarea class="wm-edit wsp-text is-short" readonly>${e(f.negPrompt)}</textarea>`;
                chars.forEach((c, i) => {
                    if (!c || !c.uc) return;
                    body += `<div class="wm-form-sub">${e(c.chara_name || c.name || `Character ${i + 1}`)}</div><textarea class="wm-edit wsp-text is-short" readonly>${e(c.uc)}</textarea>`;
                });
            }
        }
        box.innerHTML = `<div class="wm-form-hdr">${e(displayName(file))}</div><div class="wm-set-scroll"><div class="wm-form">${body}</div></div>`
            + `<div class="wm-tabs" role="tablist">${DETAIL_TABS.map(([id, label]) => `<button type="button" class="wm-tab" role="tab" data-tab="${id}" aria-selected="${id === detail.tab}">${e(label)}</button>`).join('')}</div>`;
        box.querySelectorAll('.wm-tab').forEach((t) => t.addEventListener('click', () => { detail.tab = t.dataset.tab; renderDetail(); }));
        if (window.wmSettings && typeof window.wmSettings.fitTabs === 'function') window.wmSettings.fitTabs(box.querySelector('.wm-tabs'), detail.tabScroll || (detail.tabScroll = { first: 0 }));
        const src = box.querySelector('.wsp-src');
        if (src) {
            src.addEventListener('click', (ev) => {
                ev.stopPropagation();
                ws.dropdown(src, [[false, 'Input prompt'], [true, 'Final prompt']].map(([v, l]) => ({ label: l, radio: detail.compiled === v, action: () => { detail.compiled = v; renderDetail(); } })), 'left');
            });
        }
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') { await navigator.clipboard.writeText(text); return; }
        } catch (_) { /* below */ }
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) { /* nothing */ }
        ta.remove();
    }

    function detailSoftKeys() {
        const file = detail.file;
        return {
            left: null,
            right: {
                label: 'Menu',
                menu: () => {
                    const f = H('omegasearchDsapResolveDetailPromptFields', metaCache.get(file) || null, detail.compiled) || {};
                    return [
                        { label: 'Copy Prompt', disabled: !f.mainPrompt, action: () => copyText(f.mainPrompt || '') },
                        { label: 'Copy Undesired Content', disabled: !f.mainUc, action: () => copyText(f.mainUc || '') },
                        '-',
                        { label: pinned(file) ? 'Remove from Favorites' : 'Add to Favorites', disabled: !fn('togglePinImage'), action: async () => { await toggleFavorite(file); renderDetail(); } },
                        { label: 'Edit', submenu: () => [
                            { label: 'DreamStudio', disabled: !fn('openManualModalWithContent'), action: () => studio(file) },
                            { label: 'Director', disabled: !fn('askWrenAboutImage'), action: () => director(file) }
                        ] },
                        { label: 'Send', submenu: () => sendItems(file) },
                        { label: 'Save', action: () => save(file) }
                    ];
                }
            }
        };
    }

    // ---------------------------------------------------------------- menus

    function workspaceItems(onPick) {
        const cur = activeWs();
        const rows = [{ label: 'All Workspaces', radio: st.workspaceId === GLOBAL_WS, action: () => onPick(GLOBAL_WS) }];
        if (cur) rows.push({ label: 'This Workspace', radio: st.workspaceId === cur, action: () => onPick(cur) });
        const list = workspaceList().filter((w) => w.id !== cur);
        if (list.length) rows.push('-');
        list.forEach((w) => rows.push({ label: w.name || w.id, radio: st.workspaceId === w.id, action: () => onPick(w.id) }));
        return rows;
    }

    /** Menu > Match: every term of the field with its match mode. */
    function matchItems() {
        const blocks = page ? blocksOf(field().value) : [];
        if (!blocks.length) return [{ label: 'No search terms', disabled: true }];
        return blocks.map((b) => ({
            label: termLabel(b),
            submenu: () => MATCH_MODES.map(([v, l]) => ({ label: l, radio: (b.matchMode || st.defaultMatch) === v, action: () => {
                if (v === st.defaultMatch) delete st.modes[termKey(b)];
                else st.modes[termKey(b)] = v;
                saveState();
                if (query) void search();
            } }))
        }));
    }

    function rerunIfSearched() { saveState(); if (query && page && field().value.trim()) void search(); }

    function mainSoftKeys() {
        const empty = !page || !field().value.trim();
        return {
            left: { label: 'Search', disabled: empty, action: search },
            right: {
                label: 'Menu',
                menu: () => {
                    const picked = sel >= 0 && items[sel] && st.view !== 'usages' ? items[sel].filename : null;
                    const rows = [
                        { label: 'View', submenu: () => VIEWS.map(([v, l]) => ({ label: l, radio: st.view === v, action: () => { st.view = v; saveState(); render(true); } })) },
                        { label: 'Workspace', submenu: () => workspaceItems((id) => { st.workspaceId = id; rerunIfSearched(); }) },
                        { label: 'Match', submenu: matchItems },
                        { label: 'Clear Filters', disabled: !filtersOn(), action: () => { st.filters = defaultFilters(); rerunIfSearched(); } }
                    ];
                    if (picked) rows.push('-', { label: 'Selected Picture', submenu: () => pictureItems(picked, sel, false) });
                    rows.push('-', { label: 'Options...', disabled: !(window.wmSettings && typeof window.wmSettings.open === 'function'), action: openOptions });
                    return rows;
                }
            }
        };
    }

    // ---------------------------------------------------------------- Options (a WM settings page)

    const dateIn = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ''; };
    /** M/D/YYYY (or YYYY-MM-DD) -> YYYY-MM-DD; '' when it is not a date. */
    function dateOut(text) {
        const s = String(text || '').trim();
        let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
        if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
        m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
        if (!m) return '';
        const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        return `${y}-${pad(m[1])}-${pad(m[2])}`;
    }
    const triIn = (v) => (v === true ? '1' : v === false ? '0' : '');
    const triOut = (v) => (v === '1' ? true : v === '0' ? false : null);
    const optNum = (v, float) => { const s = String(v == null ? '' : v).trim(); if (!s) return null; const n = float ? parseFloat(s) : parseInt(s, 10); return Number.isFinite(n) ? n : null; };

    function registerOptions() {
        const S = window.wmSettings;
        if (!S || typeof S.registerPage !== 'function' || !S.ui) return;
        const ui = S.ui;
        S.registerPage({
            id: OPTIONS_PAGE, tab: 'personal', label: 'Options', icon: 'app-image-search', hidden: true,
            title: TITLE,
            tabs: [['search', 'Search'], ['date', 'Date'], ['model', 'Model'], ['advanced', 'Advanced']],
            init: () => {
                const f = JSON.parse(JSON.stringify(st.filters));
                const exact = f.dateMode === 'exact' && f.dateRange && (f.dateRange.start || f.dateRange.end);
                const rel = (f.dateAfter && f.dateAfter.relative) || (f.dateBefore && f.dateBefore.relative);
                return {
                    viewType: st.viewType, workspaceId: st.workspaceId, defaultMatch: st.defaultMatch, srcInput: st.srcInput, srcCompiled: st.srcCompiled,
                    f,
                    date: exact ? 'between' : (rel ? 'relative' : 'any'),
                    after: (f.dateAfter && f.dateAfter.relative) || '', before: (f.dateBefore && f.dateBefore.relative) || '',
                    from: dateIn(f.dateRange && f.dateRange.start), to: dateIn(f.dateRange && f.dateRange.end)
                };
            },
            render(el, tab, d) {
                const opt = (list, v) => (list.find(([x]) => String(x) === String(v)) || list[0])[1];
                if (tab === 'search') {
                    const wsOpts = [[GLOBAL_WS, 'All Workspaces']].concat(workspaceList().map((w) => [w.id, w.name || w.id]));
                    el.innerHTML = ui.row('Type:', ui.comboHtml('viewType', opt(VIEW_TYPES, d.viewType)))
                        + ui.row('Workspace:', ui.comboHtml('workspaceId', opt(wsOpts, d.workspaceId)))
                        + ui.row('Match:', ui.comboHtml('defaultMatch', opt(MATCH_MODES, d.defaultMatch)))
                        + ui.gap() + ui.sub('Search in:')
                        + ui.check('srcInput', 'Input prompts', d.srcInput, 'data-k="srcInput"')
                        + ui.check('srcCompiled', 'Final prompts', d.srcCompiled, 'data-k="srcCompiled"');
                    ui.bindCombo(el.querySelector('[data-act="viewType"]'), VIEW_TYPES, d.viewType, (v) => { d.viewType = v; });
                    ui.bindCombo(el.querySelector('[data-act="workspaceId"]'), wsOpts, d.workspaceId, (v) => { d.workspaceId = v; });
                    ui.bindCombo(el.querySelector('[data-act="defaultMatch"]'), MATCH_MODES, d.defaultMatch, (v) => { d.defaultMatch = v; });
                    el.querySelectorAll('input[data-k]').forEach((cb) => cb.addEventListener('change', () => { d[cb.dataset.k] = cb.checked; }));
                } else if (tab === 'date') {
                    el.innerHTML = ui.radio('wspDate', 'any', 'Any time', d.date === 'any')
                        + ui.radio('wspDate', 'relative', 'Newer or older than:', d.date === 'relative')
                        + `<div class="wsp-indent">${ui.row('Newer than:', ui.comboHtml('after', opt(RELATIVE, d.after), d.date !== 'relative'))}${ui.row('Older than:', ui.comboHtml('before', opt(RELATIVE, d.before), d.date !== 'relative'))}</div>`
                        + ui.radio('wspDate', 'between', 'Between:', d.date === 'between')
                        + `<div class="wsp-indent">${ui.row('From:', ui.edit('', d.from, `data-k="from" placeholder="M/D/YYYY" inputmode="numeric"${d.date !== 'between' ? ' disabled' : ''}`))}${ui.row('To:', ui.edit('', d.to, `data-k="to" placeholder="M/D/YYYY" inputmode="numeric"${d.date !== 'between' ? ' disabled' : ''}`))}</div>`;
                    ui.bindCombo(el.querySelector('[data-act="after"]'), RELATIVE, d.after, (v) => { d.after = v; });
                    ui.bindCombo(el.querySelector('[data-act="before"]'), RELATIVE, d.before, (v) => { d.before = v; });
                    el.querySelectorAll('input[name="wspDate"]').forEach((r) => r.addEventListener('change', () => {
                        if (!r.checked) return;
                        d.date = r.value;
                        el.querySelectorAll('[data-act="after"], [data-act="before"]').forEach((b) => { b.disabled = d.date !== 'relative'; });
                        el.querySelectorAll('input[data-k]').forEach((i) => { i.disabled = d.date !== 'between'; });
                    }));
                    el.querySelectorAll('input[data-k]').forEach((i) => i.addEventListener('input', () => { d[i.dataset.k] = i.value; }));
                } else if (tab === 'model') {
                    const models = [['', 'Any']].concat((H('omegasearchDsapGetModelOptions') || []).map((o) => [o.value, o.label]));
                    const samplers = [['', 'Any']].concat((H('omegasearchDsapGetSamplerOptions') || []).map((o) => [o.value, o.label]));
                    const scheds = [['', 'Any']].concat((H('omegasearchDsapGetSchedulerOptions') || []).map((o) => [o.value, o.label]));
                    const model = (d.f.models && d.f.models[0]) || '';
                    const res = new Set(d.f.resolutionPreset || []);
                    el.innerHTML = ui.row('Model:', ui.comboHtml('model', opt(models, model)))
                        + ui.row('Sampler:', ui.comboHtml('sampler', opt(samplers, d.f.sampler || '')))
                        + ui.row('Schedule:', ui.comboHtml('scheduler', opt(scheds, d.f.scheduler || '')))
                        + ui.gap() + ui.sub('Resolution:')
                        + RESOLUTIONS.map(([v, l]) => ui.check(`wspRes-${v}`, l, res.has(v), `data-res="${v}"`)).join('');
                    ui.bindCombo(el.querySelector('[data-act="model"]'), models, model, (v) => { d.f.models = v ? [v] : []; });
                    ui.bindCombo(el.querySelector('[data-act="sampler"]'), samplers, d.f.sampler || '', (v) => { d.f.sampler = v || null; });
                    ui.bindCombo(el.querySelector('[data-act="scheduler"]'), scheds, d.f.scheduler || '', (v) => { d.f.scheduler = v || null; });
                    el.querySelectorAll('input[data-res]').forEach((cb) => cb.addEventListener('change', () => {
                        const set = new Set(d.f.resolutionPreset || []);
                        if (cb.checked) set.add(cb.dataset.res); else set.delete(cb.dataset.res);
                        d.f.resolutionPreset = [...set];
                    }));
                } else {
                    const ucLabels = [['', 'Any']];
                    for (let i = 0; i <= 8; i++) { const l = H('omegasearchDsapUcLevelLabel', i); if (l) ucLabels.push([String(i), l]); }
                    const pair = (label, kMin, kMax) => ui.row(label, `<span class="wsp-pair">${ui.edit('', d.f[kMin] == null ? '' : d.f[kMin], `data-n="${kMin}" inputmode="decimal" aria-label="${label} from"`)}<span>to</span>${ui.edit('', d.f[kMax] == null ? '' : d.f[kMax], `data-n="${kMax}" inputmode="decimal" aria-label="${label} to"`)}</span>`);
                    el.innerHTML = pair('Steps:', 'stepsMin', 'stepsMax')
                        + pair('Guidance:', 'guidanceMin', 'guidanceMax')
                        + pair('Rescale:', 'rescaleMin', 'rescaleMax')
                        + ui.row('UC preset:', ui.comboHtml('ucLevel', opt(ucLabels, d.f.ucLevel == null ? '' : d.f.ucLevel)))
                        + ui.row('Content:', ui.comboHtml('nsfwLevel', opt(NSFW, d.f.nsfwLevel == null ? '' : d.f.nsfwLevel)))
                        + ui.row('Quality tags:', ui.comboHtml('qualityPreset', opt(TRI, triIn(d.f.qualityPreset))))
                        + ui.row('Upscaled:', ui.comboHtml('isUpscaled', opt(TRI, triIn(d.f.isUpscaled))))
                        + ui.row('Dynamic text:', ui.comboHtml('hasDynamicReplacements', opt(TRI, triIn(d.f.hasDynamicReplacements))))
                        + ui.check('wspSeeds', 'Consecutive seeds only', !!d.f.consecutiveSeeds, 'data-k="consecutiveSeeds"');
                    ui.bindCombo(el.querySelector('[data-act="ucLevel"]'), ucLabels, d.f.ucLevel == null ? '' : String(d.f.ucLevel), (v) => { d.f.ucLevel = v === '' ? null : Number(v); });
                    ui.bindCombo(el.querySelector('[data-act="nsfwLevel"]'), NSFW, d.f.nsfwLevel == null ? '' : String(d.f.nsfwLevel), (v) => { d.f.nsfwLevel = v === '' ? null : Number(v); });
                    ['qualityPreset', 'isUpscaled', 'hasDynamicReplacements'].forEach((k) => ui.bindCombo(el.querySelector(`[data-act="${k}"]`), TRI, triIn(d.f[k]), (v) => { d.f[k] = triOut(v); }));
                    el.querySelectorAll('input[data-n]').forEach((i) => i.addEventListener('input', () => { d.f[i.dataset.n] = optNum(i.value, !/^steps/.test(i.dataset.n)); }));
                    const seeds = el.querySelector('input[data-k="consecutiveSeeds"]');
                    if (seeds) seeds.addEventListener('change', () => { d.f.consecutiveSeeds = seeds.checked; });
                }
            },
            commit(d) {
                const f = d.f;
                f.dateAfter = null;
                f.dateBefore = null;
                f.dateRange = null;
                f.dateMode = 'relative';
                if (d.date === 'relative') {
                    if (d.after) f.dateAfter = { relative: d.after };
                    if (d.before) f.dateBefore = { relative: d.before };
                } else if (d.date === 'between') {
                    const a = dateOut(d.from);
                    const b = dateOut(d.to);
                    if (a || b) { f.dateRange = { start: a || undefined, end: b || undefined }; f.dateMode = 'exact'; }
                }
                Object.assign(st, { viewType: d.viewType, workspaceId: d.workspaceId, defaultMatch: d.defaultMatch, srcInput: d.srcInput, srcCompiled: d.srcCompiled, filters: f });
                saveState();
                if (page) renderForm();
                // ok runs the search on screen again with the new choices (once Search Pictures is back)
                if (query) setTimeout(() => { void search(); }, 0);
                return [];
            }
        });
    }

    async function openOptions() {
        await ws.busy(helpers(), { paint: true, timeout: 15000 }).catch(() => false);
        registerOptions();
        window.wmSettings.open(OPTIONS_PAGE, null, { direct: true });
    }

    // ---------------------------------------------------------------- messages

    function tell(text, icon) {
        if (ws.current === APP_ID) return ws.messageBox({ title: TITLE, text, icon: icon === 'success' ? 'info' : (icon || 'info'), modal: true });
        return ws.notify({ title: TITLE, text, icon: icon || 'info' });
    }

    // ---------------------------------------------------------------- the program

    function mount(p) {
        page = p;
        p.classList.add('wm-search', 'wm-spx');
        p.innerHTML = '<div class="wsp-main">'
            + '<div class="wsr-form">'
            + '<div class="wsr-row"><span class="wsr-label">Search for:</span><span class="wsr-field"><input type="text" class="wsr-q" placeholder="&lt; ... &gt;" autocomplete="off" autocapitalize="none" enterkeyhint="search" aria-label="Search for"><button type="button" class="wsr-drop" aria-label="Earlier searches"></button></span></div>'
            + '<div class="wsr-row"><span class="wsr-label">Type:</span><button type="button" class="wsr-type wsp-type" aria-label="Type"><span>Images</span></button></div>'
            + '</div><div class="wsr-head">Results</div><div class="wsp-results wm-pv-scroll" role="listbox" aria-label="Results"></div>'
            + '</div><div class="wsp-detail" hidden></div>';
        const q = field();
        q.addEventListener('input', () => ws.refreshSoftKeys());
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } });
        p.querySelector('.wsr-drop').addEventListener('click', (e) => {
            const list = history();
            if (!list.length) { q.focus(); return; }
            ws.dropdown(e.currentTarget.parentElement, list.map((h) => ({ label: h, action: () => { q.value = h; ws.refreshSoftKeys(); void search(); } })), 'left');
        });
        p.querySelector('.wsp-type').addEventListener('click', (e) => {
            ws.dropdown(e.currentTarget, VIEW_TYPES.map(([v, l]) => ({ label: l, radio: st.viewType === v, action: () => { st.viewType = v; renderForm(); rerunIfSearched(); } })), 'left');
        });
        const box = p.querySelector('.wsp-results');
        box.addEventListener('click', (e) => {
            const el = e.target.closest('[data-i]');
            if (el) { const i = Number(el.dataset.i); select(i); void view(i); }
        });
        // tap-and-hold (the shell's ring sends contextmenu when it is whole): the picture's Menu
        box.addEventListener('contextmenu', (e) => {
            const el = e.target.closest('[data-i]');
            if (!el) return;
            e.preventDefault();
            const i = Number(el.dataset.i);
            const r = items[i];
            if (!r) return;
            select(i);
            if (!metaCache.has(r.filename)) metadata(r.filename).catch(() => {});
            ws.menuAt(e.clientX, e.clientY, pictureItems(r.filename, i, false));
        });
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => layout()).observe(box);
        renderForm();
        void helpers();
    }

    function register() {
        ws = window.wmShell;
        st = loadState();
        ws.registerApp({
            id: APP_ID,
            title: TITLE,
            startLabel: TITLE,
            icon: 'app-image-search',
            art65: 'image-search',
            inStart: 'programs',
            sip: true,
            mount,
            show() { renderForm(); layout(); ws.refreshSoftKeys(); },
            onEnd() {
                runToken++;
                if (gridMore) { gridMore.disconnect(); gridMore = null; }
                query = null; items = []; usages = []; total = 0; searched = false; failed = ''; sel = -1; detail = null; loading = false;
            },
            titleKind: () => (detail ? 'ok' : 'close'),
            historyDepth: () => (detail ? 1 : 0),
            onBack: () => closeDetail(),
            softKeys: () => (detail ? detailSoftKeys() : mainSoftKeys())
        });
        // a settings page of the program's own (Menu > Options...), drawn once the helpers are there
        if (have()) registerOptions();
    }

    /**
     * wmSearchPictures.open(opts): the program, with a search when opts names one. opts: { text } (the
     * field's text, searched), { focus: true } (the field focused for typing: call it inside the tap),
     * { url } (a dsap://ispy.dreamscape.jp/?... link) or the DSAP's params ({ blocks, viewType,
     * workspaceId, filters, file }), as openImageSearchWindow (dsapManifests.js) passes them.
     */
    async function open(opts) {
        if (!ws) return;
        const o = opts || {};
        ws.open(APP_ID, { fromStart: true });
        if (o.focus && page) {
            const q = field();
            q.focus({ preventScroll: true });
            try { q.setSelectionRange(0, q.value.length); } catch (_) { /* not a text field */ }
        }
        let url = o.url || null;
        const params = o.params || (!o.url && !o.text && !o.focus && Object.keys(o).length ? o : null);
        if (!url && !params && o.text == null) return;
        if (!(await helpers())) return;
        if (!url && params) url = H('omegasearchDsapBuildUrl', params) || null;
        if (url) {
            const raw = String(url);
            const qi = raw.indexOf('?');
            const sp = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
            const host = { getQueryParam: (n) => sp.get(n) };
            const vt = H('omegasearchDsapResolveViewType', host);
            if (vt) st.viewType = vt;
            const wsId = sp.get('workspace') || sp.get('ws');
            if (wsId) st.workspaceId = H('omegasearchDsapResolveWorkspaceId', host) || st.workspaceId;
            const bo = H('omegasearchDsapResolveBlockOptions', host);
            if (bo && bo.defaultMatchMode && (sp.get('modes') || sp.get('matchMode'))) st.defaultMatch = bo.defaultMatchMode;
            const f = H('omegasearchDsapResolveFilters', host);
            if (f && [...sp.keys()].some((k) => k !== 'blocks' && k !== 'q' && k !== 'modes' && k !== 'view' && k !== 'file' && k !== 'viewType' && k !== 'workspace' && k !== 'ws' && k !== 'frame' && k !== 'page')) {
                const ps = f.promptSource;
                delete f.promptSource;
                st.filters = f;
                if (ps) { st.srcInput = ps === 'input'; st.srcCompiled = ps === 'compiled'; }
            }
            saveState();
            const blocks = H('omegasearchDsapResolveBlocks', host) || [];
            if (blocks.length) { setBlocksText(blocks); saveState(); await search(); }
            else renderForm();
            const file = H('omegasearchDsapResolveDetailFile', host);
            if (file) void openDetail(file, -1);
            return;
        }
        if (o.text != null && page) {
            field().value = String(o.text);
            ws.refreshSoftKeys();
            if (String(o.text).trim()) await search();
        }
    }

    window.wmSearchPictures = {
        open,
        viewerSoftKeys,
        viewbarState,
        viewbarPress,
        _state: () => ({ st, items: items.length, total, usages: usages.length, sel, searched, failed, loading, detail: detail && { ...detail }, query: query && query.base })
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
