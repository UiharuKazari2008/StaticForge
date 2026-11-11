/**
 * Melaton Mobile: Spellcaster, a phone version of the desktop's Spellcaster (spellbookModal.js,
 * Start > Spellcaster = openSpellbookApplet), Yozora #732 (parent #709). Not the desktop window
 * re-hosted: the desktop's spells (window.optionsData.presets), its Anlas check (calculateCreditCost +
 * showCreditCostDialog, a WM message box on phones: wmDialogs.js) and its cast
 * (wsClient.generatePreset with step streaming, finalizeGenerationPreview, localGalleryImageUrl) on
 * WM 6.1 screens.
 *
 *   spells       Contacts-style list: "Enter a name..." find box, rows with the bold spell name and its
 *                model and size; newest first as on the desktop. Tap = the spell's screen.
 *   spell        the name band, Model / Size / Steps / Cost rows, then the picture: the streamed steps
 *                while it casts (the desktop manager's preview image, mirrored), then the result. A WM
 *                progress bar and the elapsed time under it. Soft keys Generate (Stop while it casts) /
 *                Menu (View Picture: the phone's picture view, which has Upscale, Expand ... ; Open in
 *                Studio). Tap the picture = View.
 *   background   X while casting asks Close / Minimize / Cancel; the cast keeps going either way. When
 *                it finishes and Spellcaster is not in front, a WM notification says so (View opens the
 *                picture); errors from a tap are message boxes.
 *
 * The desktop's routes to the Spellcaster window (openSpellbookApplet: Start, Run, the main menu, the
 * preset manager's Generate) open this app on phones; selectPreset / handleGenerate on the desktop
 * manager pick and cast here; Spellbook's Open in Spellcaster calls window.wmSpellcaster.openSpell(name). Only on phones. Styles: public/css/wm-spellcaster.css (+ wm-suite-kit.css).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'spellcaster';
    const TITLE = 'Spellcaster';
    const ICON = 'app-spellcaster'; // WM art (public/static_images/wm61)
    const ROW_ICON = '/static_images/app_icons/presetbook.png';

    let sh = null;
    let K = null;
    let page = null;
    let search = '';
    let selected = null; // spell name highlighted in the list
    let current = null; // spell name on the spell screen
    let layers = []; // 'spell'
    let job = null; // { name, startedAt, running, error }
    let tick = null;
    let stepObserver = null;
    const results = new Map(); // spell name -> { filename, workspace, width, height, metadata }

    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const esc = (s) => K.esc(s);
    const mgr = () => window.spellbookModalManager || null;

    // ---------------------------------------------------------------- spells (the desktop's list)

    function spells() {
        const list = (window.optionsData && Array.isArray(window.optionsData.presets)) ? window.optionsData.presets : [];
        // the desktop's drop-down shows the newest first (renderCustomPresetDropdown)
        return list.filter((p) => p && p.name).slice().reverse();
    }

    const spellByName = (n) => spells().find((p) => p.name === n) || null;

    function visible() {
        const q = search.toLowerCase();
        if (!q) return spells();
        return spells().filter((p) => String(p.name).toLowerCase().includes(q) || String(p.prompt || p.input || '').toLowerCase().includes(q));
    }

    function modelLabel(model) {
        const v = String(model || '').toLowerCase();
        try {
            /* global modelGroups */
            if (typeof modelGroups !== 'undefined' && Array.isArray(modelGroups)) {
                for (const g of modelGroups) {
                    const o = (g.options || []).find((x) => String(x.value).toLowerCase() === v);
                    if (o) return `${o.display}${o.badge_full || o.badge ? ` ${o.badge_full || o.badge}` : ''}`;
                }
            }
        } catch (_) { /* below */ }
        return model ? String(model) : 'Default';
    }

    function sizeOf(res) {
        const v = String(res || '').toLowerCase();
        try {
            /* global RESOLUTIONS */
            if (typeof RESOLUTIONS !== 'undefined' && Array.isArray(RESOLUTIONS)) {
                const r = RESOLUTIONS.find((x) => String(x.value).toLowerCase() === v);
                if (r) return { label: r.display.replace('Normal ', ''), dims: `${r.width}x${r.height}` };
            }
        } catch (_) { /* below */ }
        return { label: res ? String(res) : 'Default', dims: '' };
    }

    function subLine(p) {
        const s = sizeOf(p.resolution);
        return [modelLabel(p.model), `${s.label}${s.dims ? ` ${s.dims}` : ''}`].join('  ');
    }

    /** The desktop's own cost rule (handleGenerate): free unless the preset allows paid or costs. */
    function costOf(p) {
        if (!p || p.allow_paid) return { cost: 0, paidOk: !!(p && p.allow_paid) };
        const body = { ...p };
        try {
            /* global getDimensionsFromResolution, calculateCreditCost */
            if (body.resolution && !body.width && !body.height && typeof getDimensionsFromResolution === 'function') {
                const d = getDimensionsFromResolution(body.resolution);
                if (d) { body.width = d.width; body.height = d.height; }
            }
            // calculateCreditCost returns { list, opus, isFree }: Studio's rule (manualModalManager.js)
            const c = typeof calculateCreditCost === 'function' ? calculateCreditCost(body) : 0;
            const n = c && typeof c === 'object' ? (c.isFree ? c.opus : c.list) : c;
            return { cost: Number(n) || 0, paidOk: false };
        } catch (_) {
            return { cost: 0, paidOk: false };
        }
    }

    // ---------------------------------------------------------------- list

    function renderList() {
        if (!page) return;
        const shown = visible();
        if (!shown.some((p) => p.name === selected)) selected = shown.length ? shown[0].name : null;
        const nomatch = page.querySelector('.wsc-nomatch');
        nomatch.hidden = !(search && !shown.length && spells().length);
        nomatch.textContent = `No matches: ${search}`;
        const note = page.querySelector('.wsc-note');
        note.hidden = spells().length > 0;
        note.textContent = 'No spells. Save one from Studio (Menu > File > Save Preset).';
        page.querySelector('.wsc-list').innerHTML = shown.map((p) => {
            const sel = p.name === selected;
            const busyMark = job && job.running && job.name === p.name ? '<span class="wsk-right">Casting</span>' : '';
            return `<div class="wsk-row${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-name="${esc(p.name)}">`
                + `<span class="wsk-ico"><img src="${ROW_ICON}" alt="" draggable="false"></span>`
                + `<span class="wsk-name">${esc(p.name)}</span>${busyMark}`
                + `<span class="wsk-sub">${esc(subLine(p))}</span></div>`;
        }).join('');
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function selectRow(name) {
        selected = name;
        page.querySelectorAll('.wsc-list .wsk-row').forEach((r) => {
            const on = r.dataset.name === name;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- spell screen

    function showLayer() {
        if (!page) return;
        const v = view();
        page.querySelector('.wsc-listview').hidden = v !== 'list';
        page.querySelector('.wsc-spell').hidden = v !== 'spell';
        if (isCurrent()) {
            sh.setTitle(TITLE);
            sh.refreshSoftKeys();
            sh.refreshTitleAction();
        }
    }

    function openSpell(name) {
        if (!name) return;
        current = name;
        selected = name;
        if (view() !== 'spell') layers.push('spell');
        renderSpell();
        showLayer();
        sh.syncHistory();
    }

    function renderSpell() {
        if (!page || !current) return;
        const p = spellByName(current);
        const box = page.querySelector('.wsc-spell');
        box.querySelector('.wsk-head-name').textContent = current;
        const rows = [];
        if (p) {
            const s = sizeOf(p.resolution);
            rows.push(['Model', modelLabel(p.model)]);
            rows.push(['Size', `${s.label}${s.dims ? ` (${s.dims})` : ''}`]);
            if (p.steps) rows.push(['Steps', String(p.steps)]);
            const c = costOf(p);
            rows.push(['Cost', c.cost > 0 ? `${c.cost} Anlas (asked first)` : (c.paidOk ? 'May use Anlas' : 'Free')]);
        } else {
            rows.push(['Spell', 'This spell is no longer in the list.']);
        }
        box.querySelector('.wsc-rows').innerHTML = rows.map(([l, v]) => `<div class="wsk-crow"><span class="wsk-clabel">${esc(l)}:</span><span class="wsk-cvalue">${esc(v)}</span></div>`).join('');
        renderStage();
    }

    function resultFor(name) { return results.get(name) || null; }

    function renderStage() {
        if (!page || !current) return;
        const box = page.querySelector('.wsc-spell');
        const img = box.querySelector('.wsc-pic');
        const empty = box.querySelector('.wsc-empty');
        const status = box.querySelector('.wsc-status');
        const casting = !!(job && job.running && job.name === current);
        const res = resultFor(current);
        if (casting) {
            const src = job.stepSrc || '';
            img.hidden = !src;
            if (src && img.getAttribute('src') !== src) img.src = src;
            empty.hidden = !!src;
            empty.textContent = 'Casting...';
        } else if (res) {
            const src = typeof window.localGalleryImageUrl === 'function' ? window.localGalleryImageUrl(res.filename) : `/images/${encodeURIComponent(res.filename)}`;
            if (img.getAttribute('src') !== src) img.src = src;
            img.hidden = false;
            empty.hidden = true;
        } else {
            img.hidden = true;
            img.removeAttribute('src');
            empty.hidden = false;
            empty.textContent = job && job.running ? `"${job.name}" is being cast. One spell at a time.` : 'Tap Generate to cast this spell.';
        }
        status.hidden = !casting;
        if (casting) {
            const secs = Math.max(0, Math.round((Date.now() - job.startedAt) / 1000));
            status.querySelector('.wsc-status-text').textContent = `Generating... ${secs} s`;
        }
        box.querySelector('.wsc-result').hidden = casting || !res;
        if (res && !casting) box.querySelector('.wsc-result').textContent = res.filename;
    }

    // ---------------------------------------------------------------- casting

    /** The desktop manager's preview image gets the streamed steps (websocket.js, modal type 'spellbook'). */
    function watchSteps() {
        const m = mgr();
        const img = m && m.previewImage;
        if (!img || stepObserver) return;
        stepObserver = new MutationObserver(() => {
            if (!job || !job.running) return;
            const src = img.currentSrc || img.src;
            if (!src || src === location.href) return;
            job.stepSrc = src;
            if (current === job.name) renderStage();
        });
        stepObserver.observe(img, { attributes: true, attributeFilter: ['src'] });
    }

    async function generate(name) {
        const p = spellByName(name);
        if (!p) return;
        if (job && job.running) {
            await sh.messageBox({ title: TITLE, icon: 'warning', text: `"${job.name}" is still being cast. Wait for it to finish or stop it first.` });
            return;
        }
        if (!K.connected()) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: 'The server connection is down.' });
            return;
        }
        // the desktop's code: step streaming needs spellbookModal.js (getSpellbookStepPreviewDimensions)
        let cost = { cost: 0 };
        const ok = await sh.busy(async () => {
            const loaded = await K.feature('spellbook');
            patchManager();
            cost = costOf(p);
            return loaded;
        }, { paint: true });
        if (!ok || typeof window.wsClient.generatePreset !== 'function') {
            await sh.messageBox({ title: TITLE, icon: 'error', text: 'Spellcaster could not start. Try again in a moment.' });
            return;
        }
        let allowPaid = false;
        if (cost.cost > 0) {
            /* global showCreditCostDialog */
            const yes = typeof showCreditCostDialog === 'function' ? await showCreditCostDialog(cost.cost) : false;
            if (!yes) return;
            allowPaid = true;
        }
        const m = mgr();
        job = { name, startedAt: Date.now(), running: true, stepSrc: null };
        watchSteps();
        if (m) { m.isGenerating = true; m.selectedPreset = name; }
        /* global updateImageGenerationIndicator */
        if (typeof updateImageGenerationIndicator === 'function') { try { updateImageGenerationIndicator(); } catch (_) { /* indicator only */ } }
        clearInterval(tick);
        tick = setInterval(() => { if (current === name && isCurrent()) renderStage(); }, 1000);
        refreshAll();
        let result = null;
        let error = null;
        try {
            result = await window.wsClient.generatePreset(name, null, allowPaid, true);
            if (!result || !result.filename) throw new Error('The server sent no picture.');
            try {
                const ws = window.wsClient;
                let contentLength = result.contentLength || (result.metadata && result.metadata.file_size) || null;
                if ((!contentLength || contentLength <= 0) && ws.pendingGenerationDownloadBytes > 0 && (!ws.pendingGenerationDownloadFilename || ws.pendingGenerationDownloadFilename === result.filename)) {
                    contentLength = ws.pendingGenerationDownloadBytes;
                }
                if (typeof ws.finalizeGenerationPreview === 'function') await ws.finalizeGenerationPreview('spellbook', { filename: result.filename, contentLength });
                else if (typeof ws.waitForStreamingStepsComplete === 'function') await ws.waitForStreamingStepsComplete('spellbook');
                ws.pendingGenerationDownloadBytes = null;
                ws.pendingGenerationDownloadFilename = null;
            } catch (_) { /* the steps only */ }
        } catch (err) {
            error = err;
        } finally {
            clearInterval(tick);
            tick = null;
            if (m) m.isGenerating = false;
            if (typeof updateImageGenerationIndicator === 'function') { try { updateImageGenerationIndicator(); } catch (_) { /* indicator only */ } }
            job = null;
        }
        if (result && result.filename) {
            results.set(name, { filename: result.filename, workspace: result.workspace || null, width: result.width, height: result.height, metadata: result.metadata || null });
            // the desktop refreshes its gallery after a cast (Pictures & Videos reads the same list)
            /* global loadGallery */
            if (typeof loadGallery === 'function') { try { loadGallery(true); } catch (_) { /* list only */ } }
        }
        refreshAll();
        if (error) {
            if (error.code === 'CLIENT_CANCELLED') return;
            K.tell(APP_ID, { title: TITLE, icon: 'error', text: `"${name}" could not be cast.\n\n${K.errText(error)}`.trim() });
            return;
        }
        // finished while Spellcaster was not in front (or on another spell): background information
        if (!isCurrent() || current !== name || view() !== 'spell') {
            const filename = result.filename;
            sh.notify({ title: TITLE, icon: 'success', asNote: true, text: `"${name}" is ready.`, buttons: [{ text: 'View', onClick: () => viewPicture(filename) }] });
        }
    }

    function stop() {
        if (!job || !job.running) return;
        try { window.wsClient.cancelClientImageGeneration('Generation cancelled'); } catch (_) { /* below */ }
    }

    function viewPicture(filename) {
        if (!filename) return;
        /* global showLightbox */
        if (typeof showLightbox === 'function') {
            try { showLightbox({ filename }); } catch (err) { console.warn('[wmSpellcaster] viewer', err); }
        }
    }

    function openInStudio(name) {
        if (!name || typeof window.openManualModalWithContent !== 'function') return;
        window.openManualModalWithContent({ type: 'preset', name, title: name });
    }

    function refreshAll() {
        renderList();
        renderStage();
        if (isCurrent()) sh.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- menus

    function spellMenu(name) {
        const res = name ? resultFor(name) : null;
        const casting = !!(job && job.running);
        return [
            casting && job.name === name ? { label: 'Stop', action: stop } : { label: 'Generate', disabled: !name || casting, action: () => generate(name) },
            { label: 'View Picture', disabled: !res, action: () => viewPicture(res && res.filename) },
            '-',
            { label: 'Open in Studio', disabled: !name, action: () => openInStudio(name) }
        ];
    }

    function listMenu() {
        return [
            { label: 'Open', disabled: !selected, action: () => openSpell(selected) },
            ...spellMenu(selected),
            '-',
            { label: 'Spellbook', action: () => { if (typeof window.showPresetManager === 'function') window.showPresetManager(); } }
        ];
    }

    // ---------------------------------------------------------------- desktop routes

    let patched = false;
    function patchManager() {
        const m = mgr();
        if (!m || patched) return;
        patched = true;
        // the desktop's callers (Run, the preset manager) pick a spell and cast through the manager
        m.openModal = () => sh.open(APP_ID);
        m.selectPreset = (name) => { if (name) { sh.open(APP_ID); openSpell(name); } };
        m.handleGenerate = () => (current ? generate(current) : Promise.resolve());
    }

    // ---------------------------------------------------------------- page

    function mount(p) {
        page = p;
        p.classList.add('wsk', 'wm-spellcaster');
        p.innerHTML = `
            <div class="wsk-view is-list wsc-listview">
                <div class="wsk-searchbar"><input class="wsk-search wsc-search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Enter a name..." aria-label="Enter a name"></div>
                <div class="wsk-nomatch wsc-nomatch" hidden></div>
                <div class="wsk-scroll"><div class="wsc-list" role="listbox" aria-label="Spells"></div><p class="wsk-note wsc-note" hidden></p></div>
            </div>
            <div class="wsk-view wsc-spell" hidden>
                <div class="wsk-head"><img src="${ROW_ICON}" alt="" draggable="false"><span class="wsk-head-name"></span></div>
                <div class="wsc-split">
                    <div class="wsc-side">
                        <div class="wsc-rows"></div>
                        <div class="wsc-status" hidden><div class="wsk-progress is-marquee"><div class="wsk-progress-fill"></div></div><div class="wsc-status-text"></div></div>
                        <div class="wsc-result" hidden></div>
                    </div>
                    <div class="wsc-stage"><img class="wsc-pic" alt="" draggable="false" hidden><p class="wsc-empty"></p></div>
                </div>
            </div>`;
        const searchEl = p.querySelector('.wsc-search');
        searchEl.value = search;
        searchEl.addEventListener('input', () => { search = searchEl.value.trim(); renderList(); });
        searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (selected) openSpell(selected); } });
        const scroll = p.querySelector('.wsc-listview .wsk-scroll');
        K.onHold(scroll, '.wsk-row', (row, x, y) => { selectRow(row.dataset.name); sh.menuAt(x, y, spellMenu(row.dataset.name)); });
        scroll.addEventListener('click', (e) => {
            const row = e.target.closest('.wsk-row');
            if (!row) return;
            selectRow(row.dataset.name);
            openSpell(row.dataset.name);
        });
        p.querySelector('.wsc-stage').addEventListener('click', () => {
            const res = current && resultFor(current);
            if (res && !(job && job.running && job.name === current)) viewPicture(res.filename);
        });
        renderList();
        if (current && layers.length) renderSpell();
        showLayer();
    }

    function register() {
        sh = window.wmShell;
        K = window.wmSuiteKit;
        if (!sh || typeof sh.registerApp !== 'function' || !K) return;
        // every desktop route to the Spellcaster window opens this app (Start, Run, main menu ...)
        window.openSpellbookApplet = async function () {
            sh.open(APP_ID);
            await K.feature('spellbook');
            patchManager();
            return mgr();
        };
        // the phone's own entry (Spellbook's Open in Spellcaster): this app on that spell's screen
        window.wmSpellcaster = {
            openSpell(name) {
                if (!name) { sh.open(APP_ID); return; }
                sh.open(APP_ID);
                openSpell(String(name));
            }
        };
        window.addEventListener('appOptionsChunkLoaded', () => { if (page) { renderList(); renderSpell(); } });
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: ICON,
            inStart: 'programs',
            sip: true,
            mount,
            show() {
                showLayer();
                renderList();
                if (current) renderSpell();
            },
            titleKind: () => (view() === 'list' ? 'close' : 'ok'),
            historyDepth: () => layers.length,
            onBack() {
                if (!layers.length) return false;
                layers.pop();
                showLayer();
                renderList();
                return true;
            },
            closeQuestion: () => (job && job.running ? `"${job.name}" is still being cast. It keeps going in the background and arrives in Pictures & Videos.` : null),
            softKeys() {
                if (view() === 'spell') {
                    const casting = !!(job && job.running && job.name === current);
                    return {
                        left: casting ? { label: 'Stop', action: stop } : { label: 'Generate', disabled: !spellByName(current) || !!(job && job.running), action: () => generate(current) },
                        right: { label: 'Menu', menu: () => spellMenu(current) }
                    };
                }
                return { left: { label: 'Open', disabled: !selected, action: () => openSpell(selected) }, right: { label: 'Menu', menu: listMenu } };
            }
        });
    }

    if (window.wmShell && window.wmSuiteKit) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
