/**
 * Melaton Mobile: Reference, a phone version of the desktop's Reference Manager (referenceManager.js
 * showCacheManagerModal: the reference image cache of a workspace), Yozora #732 (parent #709). Not
 * the desktop window re-hosted: the same references (loadReferenceImages -> wsClient
 * getWorkspaceReferences) and the same Studio actions (addAsBaseImage / addAsCharacterReference /
 * addAsVibeReference), on WM screens.
 *
 * Laid out like WM 6.1's Pictures & Videos (Device Emulator VGA, 2x halved; wm-shell.css .wm-pv-*):
 *   grid         the folder bar (22 px tab-strip tint, 1 px black rule): the workspace at the left (a
 *                drop-down of the workspaces, as P&V's folders), the kind at the right (All, Image
 *                References, Vibes, Character & Style: the desktop manager's modes); cells 61 px with
 *                #BDBEBD rules, the picture fitted in 68 x 53, 80 px columns (3 at least); a small tag
 *                in a cell's corner names a precise reference (C / S / CS) or a vibe (V). Soft keys
 *                Use / Menu; tap = the details page; tap-and-hold = the cell's menu.
 *   details      Contacts' card look: the picture on top (a tap shows it full screen on black, ok or
 *                back returns), then label / value rows (Type, Encodings, Size, Added, Workspace,
 *                Comment). Soft keys Use (a menu: Base Image / Precise Reference / Vibe, as the desktop's
 *                "Add to Studio as") / Menu (Use, Move To, Delete); ok goes back.
 *   use          opens the phone's Studio (openManualModalWithContent) when it is not open, then runs the
 *                desktop's own add function on the reference.
 *   move/delete  wsClient moveReferences / moveVibeImage and deleteReference / deleteVibeImage (the
 *                desktop's calls, without its Vista progress window); delete asks first (what to delete
 *                when the item has a base image and encodings, as on the desktop).
 *   add          Menu > Add Picture... (a gallery picture, WM's Open dialog) and Add from Device... (the
 *                phone's file picker): wsClient.uploadReference with the picture as base64.
 *
 * Every desktop route to the Reference Manager window (Start menu, Run, Explorer, Studio's reference
 * browser "Open Manager": showCacheManagerModal) opens this app on phones. Only on phones.
 * Styles: public/css/wm-reference.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'reference';
    const ICON = '/static_images/app_icons/ref.png';
    const MODES = [['all', 'All'], ['image', 'Image References'], ['vibe', 'Vibes'], ['character', 'Character & Style']];
    const PRECISE = { 1: ['Character & Style', 'CS'], 2: ['Character', 'C'], 3: ['Style', 'S'] };
    const MODE_KEY = 'wmReferenceMode';
    const MAX_UPLOAD = 20 * 1024 * 1024;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const wsc = () => window.wsClient || null;
    const stored = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const store = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };

    let sh = null;
    let page = null;
    let items = [];
    let loaded = false;
    let loadedWs = null;
    let workspace = null; // the workspace shown (the active one when the app opens)
    let mode = MODES.some(([k]) => k === stored(MODE_KEY)) ? stored(MODE_KEY) : 'all';
    let selected = null; // hash
    let layers = []; // 'details' | 'picture'
    let current = null;
    let loadGen = 0;

    const view = () => layers[layers.length - 1] || 'grid';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const connected = () => { const c = wsc(); return !!(c && typeof c.isConnected === 'function' && c.isConnected()); };
    const px = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1;

    function activeWs() {
        try { /* global activeWorkspace */ return typeof activeWorkspace !== 'undefined' && activeWorkspace ? activeWorkspace : 'default'; } catch (_) { return 'default'; }
    }

    function workspaceList() {
        try {
            /* global workspaces */
            if (typeof workspaces === 'undefined' || !workspaces) return [];
            return Object.values(workspaces).filter(Boolean)
                .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)));
        } catch (_) { return []; }
    }

    function workspaceName(id) {
        const w = workspaceList().find((x) => x.id === id);
        return w ? (w.name || w.id) : (id === 'default' ? 'Default' : String(id || ''));
    }

    // ---------------------------------------------------------------- the desktop's rules

    function isPrecise(it) {
        try { /* global isPrecisionReferenceMetadata */ return typeof isPrecisionReferenceMetadata === 'function' && isPrecisionReferenceMetadata(it.metadata); } catch (_) { return false; }
    }

    function preciseType(it) {
        try { /* global getPrecisionReferenceTypeFromMetadata */ return typeof getPrecisionReferenceTypeFromMetadata === 'function' ? getPrecisionReferenceTypeFromMetadata(it.metadata) : 1; } catch (_) { return 1; }
    }

    const previewUrl = (name) => `/cache/preview/${encodeURIComponent(name)}`;

    /** The manager's thumbnail (createCacheManagerGalleryItem). */
    function thumbOf(it) {
        if (it.isStandalone) return it.hasPreview ? previewUrl(it.hasPreview) : '/static_images/background.jpg';
        return it.hasPreview ? previewUrl(`${it.hash}.webp`) : `/cache/${encodeURIComponent(it.hash)}`;
    }

    /** The full picture (openReferenceImageInViewer's rule). */
    function fullOf(it) {
        if (it.isStandalone) {
            if ((it.type === 'base64' || it.type === 'vibe') && it.source && String(it.source).length > 200) return `data:image/png;base64,${it.source}`;
            return it.hasPreview ? previewUrl(it.hasPreview) : '/static_images/background.jpg';
        }
        return `/cache/upload/${encodeURIComponent(it.hash)}`;
    }

    function typeOf(it) {
        if (it.isStandalone) return [it.importedFrom === 'novelai' ? 'Vibe (NovelAI import)' : 'Vibe', 'V'];
        if (isPrecise(it)) { const [l, t] = PRECISE[preciseType(it)] || PRECISE[1]; return [`Precise reference: ${l}`, t]; }
        return [it.hasVibes ? 'Base image, vibe' : 'Base image', it.hasVibes ? 'V' : ''];
    }

    function encodingsOf(it) {
        const out = [];
        for (const v of it.vibes || []) {
            for (const e of v.encodings || []) {
                let model = e.model;
                try { /* global modelBadges */ if (typeof modelBadges !== 'undefined' && modelBadges[e.model] && modelBadges[e.model].display) model = modelBadges[e.model].display; } catch (_) { /* id */ }
                const ie = e.informationExtraction != null ? ` (IE ${Math.round(Number(e.informationExtraction) * 100)}%)` : '';
                out.push(`${model}${ie}`);
            }
        }
        return out;
    }

    function filtered() {
        try { /* global filterReferenceImages */ if (typeof filterReferenceImages === 'function') return filterReferenceImages(items, mode); } catch (_) { /* below */ }
        return items;
    }

    const byHash = (h) => items.find((x) => String(x.hash) === String(h)) || null;

    // ---------------------------------------------------------------- data

    async function load() {
        if (!connected()) throw new Error('The server connection is down.');
        const gen = ++loadGen;
        const w = workspace;
        /* global loadReferenceImages */
        const list = typeof loadReferenceImages === 'function' ? await loadReferenceImages(w, false) : null;
        if (gen !== loadGen) return;
        items = Array.isArray(list) ? list : [];
        loaded = true;
        loadedWs = w;
    }

    async function refresh(opts = {}) {
        try {
            if (opts.quiet) await load();
            else await sh.busy(load, { paint: true });
        } catch (err) {
            if (!opts.quiet || !loaded) sh.notify({ title: 'Reference', icon: 'error', text: `The references could not be read.\n\n${(err && err.message) || ''}`.trim() });
        }
        renderGrid();
    }

    // ---------------------------------------------------------------- grid

    function layoutGrid() {
        const sc = page.querySelector('.wm-pv-scroll');
        const w = (sc && sc.clientWidth) || page.clientWidth;
        if (!w) return;
        page.style.setProperty('--wm-pv-cols', String(Math.max(3, Math.floor(w / (80 * px())))));
    }

    function cellHtml(it) {
        const [, tag] = typeOf(it);
        const sel = String(it.hash) === String(selected);
        return `<button type="button" class="wm-pv-cell wrf-cell${sel ? ' is-selected' : ''}" data-hash="${esc(it.hash)}" aria-label="${esc(typeOf(it)[0])}">`
            + `<img src="${esc(thumbOf(it))}" alt="" draggable="false" loading="lazy" decoding="async" onerror="this.src='/static_images/background.jpg'">`
            + `${tag ? `<span class="wrf-tag">${esc(tag)}</span>` : ''}${it.locked ? '<span class="wrf-lock" aria-label="Locked"></span>' : ''}</button>`;
    }

    function renderGrid() {
        if (!page) return;
        layoutGrid();
        const list = filtered();
        page.querySelector('.wrf-ws-name').textContent = workspaceName(workspace);
        page.querySelector('.wrf-mode span').textContent = (MODES.find(([k]) => k === mode) || MODES[0])[1];
        page.querySelector('.wm-pv-chunk').innerHTML = list.map(cellHtml).join('');
        const empty = page.querySelector('.wm-photos-empty');
        empty.hidden = !loaded || !!list.length;
        empty.textContent = items.length ? 'No references of this kind.' : 'No references in this workspace. Use Menu > Add Picture... to add one.';
        if (selected && !list.some((x) => String(x.hash) === String(selected))) selected = null;
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function selectCell(hash) {
        selected = hash;
        page.querySelectorAll('.wrf-cell').forEach((c) => c.classList.toggle('is-selected', c.dataset.hash === String(hash)));
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function setWorkspace(id) {
        if (!id || id === workspace) return;
        workspace = id;
        selected = null;
        items = [];
        loaded = false;
        renderGrid();
        refresh();
    }

    function setMode(m) {
        mode = m;
        store(MODE_KEY, m);
        page.querySelector('.wm-pv-scroll').scrollTop = 0;
        renderGrid();
    }

    // ---------------------------------------------------------------- layers

    function showLayer() {
        if (!page) return;
        const v = view();
        page.querySelector('.wrf-gridview').hidden = v !== 'grid';
        page.querySelector('.wrf-details').hidden = v !== 'details';
        page.querySelector('.wrf-picture').hidden = v !== 'picture';
        page.dataset.view = v;
        if (isCurrent()) {
            sh.refreshSoftKeys();
            sh.refreshTitleAction();
        }
    }

    function push(v) {
        layers.push(v);
        showLayer();
        sh.syncHistory();
    }

    function openDetails(it) {
        if (!it) return;
        current = it;
        selected = it.hash;
        renderDetails();
        push('details');
    }

    function renderDetails() {
        if (!page || !current) return;
        const it = current;
        const box = page.querySelector('.wrf-details');
        // cache files are named by their hash: the kind reads better than 40 hex digits
        const named = it.originalFilename || (it.filename && it.filename !== it.hash && !/^[0-9a-f]{24,}(\.\w+)?$/i.test(it.filename) ? it.filename : '');
        box.querySelector('.wrf-card-name').textContent = it.comment || named || typeOf(it)[0].replace(/^Precise reference: /, 'Precise reference (') + (/^Precise reference: /.test(typeOf(it)[0]) ? ')' : '');
        const img = box.querySelector('.wrf-card-pic');
        img.onload = () => { if (current === it && img.naturalWidth) setRow('size', `${img.naturalWidth} x ${img.naturalHeight}`); };
        img.src = thumbOf(it);
        const rows = [['type', 'Type', typeOf(it)[0]]];
        const enc = encodingsOf(it);
        if (enc.length) rows.push(['enc', 'Encodings', enc.join(', ')]);
        rows.push(['size', 'Size', '']);
        const d = it.mtime ? new Date(Number(it.mtime) < 1e12 ? Number(it.mtime) * 1000 : Number(it.mtime)) : null;
        if (d && !Number.isNaN(d.getTime())) rows.push(['date', 'Added', `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`]);
        if (it.size) rows.push(['bytes', 'File size', it.size >= 1048576 ? `${(it.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(it.size / 1024))} KB`]);
        rows.push(['ws', 'Workspace', workspaceName(it.workspaceId || workspace)]);
        if (it.locked) rows.push(['lock', 'Locked', 'Yes']);
        if (it.comment) rows.push(['comment', 'Comment', it.comment]);
        box.querySelector('.wrf-card-rows').innerHTML = rows.map(([k, l, v]) => `<div class="wrf-crow" data-k="${k}"${v === '' ? ' hidden' : ''}><span class="wrf-clabel">${esc(l)}:</span><span class="wrf-cvalue">${esc(v)}</span></div>`).join('');
    }

    function setRow(k, v) {
        const row = page.querySelector(`.wrf-crow[data-k="${k}"]`);
        if (!row) return;
        row.querySelector('.wrf-cvalue').textContent = v;
        row.hidden = !v;
    }

    function showPicture() {
        if (!current) return;
        const img = page.querySelector('.wrf-picture img');
        img.src = thumbOf(current);
        // the full picture replaces the preview once it has loaded
        const full = fullOf(current);
        if (full !== img.src) { const pre = new Image(); pre.onload = () => { if (view() === 'picture') img.src = full; }; pre.src = full; }
        push('picture');
    }

    // ---------------------------------------------------------------- Studio

    function studioOpen() {
        const m = document.getElementById('manualModal');
        return !!(m && !m.classList.contains('hidden') && !m.classList.contains('closing'));
    }

    async function useIn(kind, it) {
        if (!it) return;
        const fn = { base: 'addAsBaseImage', precise: 'addAsCharacterReference', vibe: 'addAsVibeReference' }[kind];
        if (typeof window[fn] !== 'function') { sh.notify({ title: 'Reference', icon: 'error', text: 'Studio is not available.' }); return; }
        try {
            // Studio first (the phone's Studio app comes up with its own wait cursor), then the desktop's add
            if (!studioOpen() && typeof window.openManualModalWithContent === 'function') await window.openManualModalWithContent();
            await sh.busy(() => window[fn](it), { paint: true });
            if (sh.current !== 'studio' && sh.listApps().some((a) => a.id === 'studio')) sh.open('studio');
        } catch (err) {
            sh.notify({ title: 'Reference', icon: 'error', text: `The reference could not be added to Studio.\n\n${(err && err.message) || ''}`.trim() });
        }
    }

    function modelMatches(it) {
        try {
            /* global getCurrentSelectedModel */
            const m = typeof getCurrentSelectedModel === 'function' ? getCurrentSelectedModel() : null;
            if (!m) return true;
            return (it.vibes || []).some((v) => (v.encodings || []).some((e) => e.model === m));
        } catch (_) { return true; }
    }

    function useItems(it) {
        if (!it) return [{ label: '(nothing selected)', disabled: true }];
        return [
            { label: 'Base Image', disabled: !!it.isStandalone, action: () => useIn('base', it) },
            { label: 'Precise Reference', disabled: !!it.isStandalone || !it.hash, action: () => useIn('precise', it) },
            { label: 'Vibe', disabled: !(it.hasVibes && it.vibes && it.vibes.length) || !modelMatches(it), action: () => useIn('vibe', it) }
        ];
    }

    // ---------------------------------------------------------------- move / delete / add

    const say = (title, text, icon = 'error') => sh.notify({ title, text, icon });

    async function moveTo(it, target) {
        if (!it || !target || target === workspace) return;
        const both = !it.isStandalone && it.hasVibes;
        const yes = await sh.messageBox({ title: 'Move', icon: 'question', text: both ? `This item holds a base image and vibe encodings. Both will be moved to ${workspaceName(target)}. Continue?` : `Move this reference to ${workspaceName(target)}?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        const from = workspace;
        try {
            await sh.busy(async () => {
                const c = wsc();
                let r;
                if (it.isStandalone) {
                    if (!it.vibes || !it.vibes.length) throw new Error('This vibe has no data to move.');
                    r = await c.moveVibeImage(it.vibes[0].id, target, from);
                } else {
                    r = await c.moveReferences([it.hash], target, from);
                    if (r && r.success && it.hasVibes) {
                        await Promise.all((it.vibes || []).filter((v) => v.type === 'cache').map((v) => c.moveVibeImage(v.id, target, from).catch(() => null)));
                    }
                }
                if (!r || r.success === false) throw new Error((r && r.message) || 'The server refused.');
                await load();
            }, { paint: true });
        } catch (err) { say('Reference', `The reference could not be moved.\n\n${(err && err.message) || ''}`.trim()); return; }
        if (current && current.hash === it.hash) { layers = []; current = null; showLayer(); sh.syncHistory(); }
        renderGrid();
        say('Reference', `Moved to ${workspaceName(target)}.`, 'success');
    }

    async function remove(it) {
        if (!it) return;
        let what;
        if (it.hasVibes && !it.isStandalone) {
            what = await sh.messageBox({ title: 'Delete', icon: 'warning', text: 'What would you like to delete?', buttons: [{ text: 'Base Image', value: 'base' }, { text: 'Encodings', value: 'vibes' }, { text: 'All', value: 'both' }, { text: 'Cancel', value: null, default: true }], cancelValue: null });
            if (!what) return;
        } else {
            const yes = await sh.messageBox({ title: 'Delete', icon: 'warning', text: it.isStandalone ? 'This vibe encoding will be deleted. Continue?' : 'This reference will be deleted. Continue?', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
            if (!yes) return;
            what = it.isStandalone ? 'vibes' : 'base';
        }
        const target = it.workspaceId || workspace || 'default';
        try {
            await sh.busy(async () => {
                const c = wsc();
                if (what === 'base' || what === 'both') {
                    const r = await c.deleteReference(it.hash, target);
                    if (!r || !r.success) throw new Error((r && r.message) || 'The server refused.');
                }
                if (what === 'vibes' || what === 'both') {
                    for (const v of it.vibes || []) {
                        const r = await c.deleteVibeImage(v.id, target);
                        if (r && r.success === false) console.warn('[wmReference] vibe delete', v.id, r.message);
                    }
                }
                await load();
            }, { paint: true });
        } catch (err) { say('Reference', `The reference could not be deleted.\n\n${(err && err.message) || ''}`.trim()); return; }
        if (current && current.hash === it.hash) {
            const still = byHash(it.hash);
            if (still) { current = still; renderDetails(); } else { layers = []; current = null; showLayer(); sh.syncHistory(); }
        }
        renderGrid();
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] || '');
            r.onerror = () => reject(r.error || new Error('The picture could not be read.'));
            r.readAsDataURL(blob);
        });
    }

    async function upload(files) {
        const list = [...files].filter((f) => f && /^image\//.test(f.type || 'image/'));
        if (!list.length) return;
        const big = list.find((f) => f.size > MAX_UPLOAD);
        if (big) { say('Reference', `"${big.name}" is larger than 20 MB.`, 'warning'); return; }
        let done = 0;
        try {
            await sh.busy(async () => {
                for (const f of list) {
                    const data = await blobToBase64(f);
                    const r = await wsc().uploadReference(data, workspace, null, null, f.name || null, null, []);
                    if (!r || r.success === false) throw new Error((r && r.message) || 'The server refused.');
                    done++;
                }
                await load();
            }, { paint: true, timeout: 120000 });
        } catch (err) { say('Reference', `${done ? `${done} of ${list.length} added. ` : ''}The picture could not be added.\n\n${(err && err.message) || ''}`.trim()); }
        mode = mode === 'vibe' || mode === 'character' ? 'all' : mode;
        renderGrid();
        if (done) say('Reference', done === 1 ? 'Reference added.' : `${done} references added.`, 'success');
    }

    function addFromDevice() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.addEventListener('change', () => { if (input.files && input.files.length) upload(input.files); }, { once: true });
        input.click();
    }

    function addPicture() {
        const fd = window.wmFileDialogs;
        if (!fd || typeof fd.open !== 'function') { addFromDevice(); return; }
        const fileOf = (i) => {
            if (!i) return null;
            if (i.targetKind === 'image' || i.targetKind === 'scrap') return i.previewImageFilename || i.targetId || null;
            if (i.shortcutType === 'image' && i.shortcutData && i.shortcutData.filename) return i.shortcutData.filename;
            return null;
        };
        fd.open({
            title: 'Add Picture',
            appTitle: 'Reference',
            typeLabel: 'Pictures',
            pictures: true,
            accept: (i) => !!fileOf(i),
            extra: [{ label: 'Add from Device...', action: () => { fd.close(); addFromDevice(); } }],
            onPick(item) {
                const name = fileOf(item);
                if (!name) return false;
                setTimeout(async () => {
                    try {
                        const blob = await sh.busy(async () => {
                            const res = await fetch(`/images/${encodeURIComponent(name)}`, { credentials: 'same-origin' });
                            if (!res.ok) throw new Error(`The picture could not be read (${res.status}).`);
                            return res.blob();
                        }, { paint: true });
                        await upload([new File([blob], name, { type: blob.type || 'image/png' })]);
                    } catch (err) { say('Reference', `The picture could not be added.\n\n${(err && err.message) || ''}`.trim()); }
                }, 0);
                return true;
            }
        });
    }

    // ---------------------------------------------------------------- menus

    function moveItems(it) {
        const others = workspaceList().filter((w) => w.id !== workspace);
        return others.length ? others.map((w) => ({ label: w.name || w.id, action: () => moveTo(it, w.id) })) : [{ label: '(no other workspace)', disabled: true }];
    }

    function itemMenu(it) {
        return [
            { label: 'Use in Studio', disabled: !it, submenu: () => useItems(it) },
            { label: 'Properties', disabled: !it || view() === 'details', action: () => openDetails(it) },
            '-',
            { label: 'Move To', disabled: !it, submenu: () => moveItems(it) },
            { label: 'Delete', disabled: !it, action: () => remove(it) }
        ];
    }

    function gridMenu() {
        const it = selected ? byHash(selected) : null;
        return itemMenu(it).concat([
            '-',
            { label: 'Add Picture...', action: addPicture },
            { label: 'Add from Device...', action: addFromDevice },
            '-',
            { label: 'Workspace', submenu: () => workspaceList().map((w) => ({ label: w.name || w.id, radio: w.id === workspace, action: () => setWorkspace(w.id) })) },
            { label: 'Show', submenu: () => MODES.map(([k, l]) => ({ label: l, radio: k === mode, action: () => setMode(k) })) },
            { label: 'Refresh', action: () => refresh() }
        ]);
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
            const t = e.target.closest(selector);
            if (!t) return;
            start = { x: e.clientX, y: e.clientY };
            clear();
            timer = setTimeout(() => { held = true; fn(t, start.x, start.y); }, 550);
        });
        el.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, clear));
        el.addEventListener('contextmenu', (e) => {
            const t = e.target.closest(selector);
            if (!t) return;
            e.preventDefault();
            if (held) return;
            held = true;
            clear();
            fn(t, e.clientX, e.clientY);
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
        p.classList.add('wm-pv', 'wm-reference');
        p.innerHTML = `
            <div class="wrf-gridview">
                <div class="wm-pv-bar">
                    <button type="button" class="wm-pv-folder wrf-ws" aria-haspopup="menu"><span class="wrf-ws-name"></span><i class="wm-pv-arrow"></i></button>
                    <button type="button" class="wm-pv-sort wrf-mode" aria-haspopup="menu"><span>All</span><i class="wm-pv-arrow"></i></button>
                </div>
                <div class="wm-pv-scroll"><div class="wm-pv-chunk" role="listbox" aria-label="References"></div><p class="wm-photos-empty" hidden></p></div>
            </div>
            <div class="wrf-details" hidden>
                <div class="wrf-card-head"><img src="${ICON}" alt="" draggable="false"><span class="wrf-card-name"></span></div>
                <div class="wrf-card-body">
                    <button type="button" class="wrf-card-picbtn" aria-label="View picture"><img class="wrf-card-pic" alt="" draggable="false"></button>
                    <div class="wrf-card-rows"></div>
                </div>
            </div>
            <div class="wrf-picture" hidden><img alt="" draggable="false"></div>`;

        p.querySelector('.wrf-ws').addEventListener('click', (e) => {
            e.stopPropagation();
            sh.dropdown(e.currentTarget, workspaceList().map((w) => ({ label: w.name || w.id, radio: w.id === workspace, action: () => setWorkspace(w.id) })), 'left');
        });
        p.querySelector('.wrf-mode').addEventListener('click', (e) => {
            e.stopPropagation();
            sh.dropdown(e.currentTarget, MODES.map(([k, l]) => ({ label: l, radio: k === mode, action: () => setMode(k) })), 'right');
        });
        const grid = p.querySelector('.wm-pv-chunk');
        onHold(grid, '.wrf-cell', (cell, x, y) => {
            selectCell(cell.dataset.hash);
            sh.menuAt(x, y, itemMenu(byHash(cell.dataset.hash)));
        });
        grid.addEventListener('click', (e) => {
            const cell = e.target.closest('.wrf-cell');
            if (!cell) return;
            selectCell(cell.dataset.hash);
            openDetails(byHash(cell.dataset.hash));
        });
        p.querySelector('.wrf-card-picbtn').addEventListener('click', showPicture);
        p.querySelector('.wrf-picture').addEventListener('click', () => { if (view() === 'picture') { layers.pop(); showLayer(); sh.syncHistory(); } });
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (view() === 'grid') layoutGrid(); }).observe(p);
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        // every desktop route to the Reference Manager window opens this app (Start menu, Run, Explorer, Studio)
        window.showCacheManagerModal = function () { sh.open(APP_ID); return true; };
        sh.registerApp({
            id: APP_ID,
            title: 'Reference',
            icon: ICON,
            inStart: 'programs',
            mount,
            show() {
                const a = activeWs();
                if (!workspace) workspace = a;
                showLayer();
                renderGrid();
                refresh({ quiet: loaded && loadedWs === workspace });
            },
            titleKind: () => (view() === 'grid' ? 'close' : 'ok'),
            historyDepth: () => layers.length,
            onBack() {
                if (!layers.length) return false;
                const v = layers.pop();
                if (v === 'details') current = null;
                showLayer();
                return true;
            },
            softKeys() {
                const v = view();
                if (v === 'picture') return { left: null, right: null };
                const it = v === 'details' ? current : (selected ? byHash(selected) : null);
                const left = { label: 'Use', disabled: !it, menu: () => useItems(it) };
                return { left, right: { label: 'Menu', menu: v === 'details' ? () => itemMenu(current) : gridMenu } };
            }
        });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
