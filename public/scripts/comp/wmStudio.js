/**
 * Melaton Mobile: Studio (Yozora #709).
 *
 * Studio is Dreamscape's image generation app with no WM stock counterpart, so it keeps its own
 * name and icon (wm61/app-studio*.png, made from app_icons/studio.png). Like the Director
 * (wmDirector.js), it is not a copy: the desktop Studio window (#manualModal, manualModalManager.js)
 * is moved into this app's page and opened the normal way (openManualModalWithContent), so prompts,
 * characters, presets, settings, the stage pipeline, MCP apply_studio_changes / print_studio, the
 * Anlas cost display and Generate all stay the desktop's code. wm-studio.css drops the window frame
 * and splits the long desktop layout into the pages of a WM tabbed form:
 *
 *   Prompt      one scrolling form: base prompt / creative directive / undesired content (the
 *               desktop's own toggle) with its emphasis highlighting, preset row, Rentan, the token and
 *               Anlas row; then Characters (character prompts and text overlays, a "No characters"
 *               row with Add when there are none); then Settings (model, steps, guidance, resolution,
 *               upscale, sampler, workspace, locks, seed, prints)
 *   Images      base image, director reference, vibe transfers, pipeline stages
 *   Print       the preview (the finished print, its progress while printing); a tap on the print
 *               opens the shell's picture view
 *
 *   soft keys   Generate (the desktop's Generate button; it queues another print while one runs, the
 *               progress shows in the title) | Menu: the desktop menu bar's File Edit Add Model Image Tools View Help, built
 *               from the same item builders (studioMenuBarItems / handleStudioMenuBarAction)
 *   tool pages  any desktop window that opens while Studio is on screen (Character Positions, Text
 *               Expanders, Stage Results ...) is moved into a full-screen sub-page with Done; a window
 *               opened from it (the vSlider editor) stacks over it. The back key and Done close the top
 *               one the window's own way; switching apps closes none. Desktop context menus raised
 *               inside Studio (contextMenu.js) are shown as WM menus (combos as WM drop-downs) and run
 *               the desktop menu's onHide when they close. The Anlas question (a WM message box), the
 *               upscale choices and Expand Canvas are wmDialogs.js's WM forms, as everywhere on the phone.
 *   entry points every path that opens the desktop Studio (openManualModalWithContent: MCP open_in_studio /
 *               apply_studio_changes / print_studio, gallery and viewer "open in Studio", presets,
 *               Programs) brings this app up; so does #manualModal opening by any other route.
 *   title X     back to Today; Studio stays open in the background with its state (the desktop's close is
 *               Menu > File > Close).
 *
 * Only on phones: does nothing unless window.uiShell is 'mobile'. Styles: public/css/wm-studio.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'studio';
    const root = document.documentElement;
    const TABS = [['prompt', 'Prompt'], ['images', 'Images'], ['print', 'Print']];
    // the former Characters and Settings tabs are sections of the Prompt page
    const SECTIONS = { chars: '.wms-chars', characters: '.wms-chars', settings: '.model-control' };
    const MENUS = ['File', 'Edit', 'Add', 'Model', 'Image', 'Tools', 'View', 'Help'];
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let ws = null; // window.wmShell
    let page = null;
    let shown = false;
    let tab = 'prompt';
    let paintedTab = '';
    let addAt = 0; // a character / overlay was just asked for: the new one is scrolled to
    let opening = false; // an openManualModalWithContent call is running
    const tools = []; // [{ win, parent, next, title }] desktop windows hosted as sub-pages, the last on top
    let progressTimer = null;
    let wasGenerating = false;

    const modal = () => document.getElementById('manualModal');
    const isCurrent = () => !!(ws && ws.current === APP_ID);
    const studioOpen = () => { const m = modal(); return !!(m && !m.classList.contains('hidden')); };

    function generating() {
        try {
            // generationOrchestrator.js: top-level let isGenerating
            // eslint-disable-next-line no-undef
            if (typeof isGenerating !== 'undefined' && isGenerating) return true;
        } catch (_) { /* not loaded */ }
        const btn = document.getElementById('manualGenerateBtn');
        return !!(btn && btn.classList.contains('generating-effect'));
    }

    // Rentan's phases before the print starts (modules/dynagenWren.js progress, imageGeneration.js review)
    const RENTAN_PHASES = new Set(['thinking', 'streaming', 'reviewing', 'tool_execution']);

    /**
     * The print's progress from the socket (websocket.js progressStates): { phase, pct, rentan, queued }
     * or null. queued: prints waiting behind it in the server FIFO (generationJobQueue.js 'queued').
     */
    function progress() {
        const states = window.wsClient && window.wsClient.progressStates;
        if (!states || typeof states.forEach !== 'function') return null;
        let best = null;
        let queued = 0;
        let rentan = false;
        states.forEach((s) => {
            if (!s) return;
            if (s.phase === 'queued') { queued++; return; }
            if (RENTAN_PHASES.has(s.phase)) rentan = true;
            const pct = Number(s.progress);
            if (!best || (Number.isFinite(pct) && pct > best.pct)) best = { phase: s.phase || '', pct: Number.isFinite(pct) ? pct : 0 };
        });
        if (!best && !queued) return null;
        return { ...(best || { phase: 'queued', pct: 0 }), rentan, queued };
    }

    // ---------------------------------------------------------------- hosting the desktop Studio

    function hostStudio() {
        const m = modal();
        const host = page && page.querySelector('.wms-host');
        if (!m || !host) return false;
        if (m.parentNode !== host) host.appendChild(m);
        ensureCharsSection();
        watchPromptEditors();
        lightOverlays();
        modelName();
        steppers();
        stagePercents();
        foldSections();
        pairsLayout();
        diceBySeed();
        resolutionDims();
        watchPopupDecor();
        return true;
    }

    // ---------------------------------------------------------------- the stages' percent fields

    /**
     * A pipeline stage's Strength / Noise (and any other percent field on the Images page) are the
     * same 0..1 input under a "NN%" overlay as Rescale: each gets the WM percent edit box
     * (percentProxy), stages added later too.
     */
    let stagesWatched = false;
    function stagePercents() {
        const box = document.getElementById('pipelineStagesContainer');
        const row = document.getElementById('transformationRow');
        const scan = () => [box, row].forEach((root) => {
            if (!root) return;
            root.querySelectorAll('.percentage-input-container:not(.wms-pct-host)').forEach((field) => {
                const input = field.querySelector('input');
                if (input) percentProxy(input, field);
            });
        });
        scan();
        if (stagesWatched || typeof MutationObserver !== 'function') return;
        stagesWatched = true;
        let queued = false;
        const mo = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; scan(); });
        });
        [box, row].forEach((root) => { if (root) mo.observe(root, { childList: true, subtree: true }); });
    }

    // ---------------------------------------------------------------- Settings: pairs or one per row

    /**
     * Steps | Guidance and Rescale | Prints share a row only where both - / + steppers keep their
     * value readable: about 312 WM px of form (a 390 px phone at 1x, landscape at the touch scale).
     * A narrower form (a 411 px phone at the touch scale 1.5) gets one field per row.
     */
    let pairsWatched = false;
    function pairsLayout() {
        const holder = document.querySelector('#manualModal .model-control .control-holder');
        if (!holder || !page) return;
        const fit = () => {
            if (!page || shownTab() !== 'prompt' || !holder.offsetWidth) return;
            const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
            const w = holder.offsetWidth / px;
            page.classList.toggle('wms-pairs', w >= 312);
            // a wide form (a tablet held upright, Yozora #732): every field takes half a row
            page.classList.toggle('wms-wide', w >= 480);
        };
        fit();
        if (pairsWatched || typeof ResizeObserver !== 'function') return;
        pairsWatched = true;
        new ResizeObserver(fit).observe(holder);
        // Settings > Screen changes the scale (--wm-px) without resizing the form
        new MutationObserver(fit).observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    // ---------------------------------------------------------------- the dice beside Seed

    /**
     * The random prompt toggle (the dice) sat alone in a row under the token strip; on the phone it
     * sits in the Seed row with the locks (the Locks label goes), so that row holds the badges only.
     */
    function diceBySeed() {
        const dice = document.getElementById('randomPromptToggleBtn');
        const locks = document.querySelector('#manualModal .control-row-lockcontrols .seed-input-group');
        if (!dice || !locks || dice.parentNode === locks) return;
        dice.classList.add('wms-dice');
        locks.insertBefore(dice, locks.firstChild);
    }

    // ---------------------------------------------------------------- Resolution: its size in the combo

    function resolutionItems() {
        /* global getStudioResolutionMenuItems */
        try { return typeof getStudioResolutionMenuItems === 'function' ? getStudioResolutionMenuItems() : []; } catch (_) { return []; }
    }

    /** "Square" + "1024x1024" in the closed combo when both fit; the name (and its badge) alone when not. */
    let resWatched = false;
    function resolutionDims() {
        const btn = document.getElementById('manualResolutionDropdownBtn');
        const sel = document.getElementById('manualResolutionSelected');
        if (!btn || !sel) return;
        let dims = btn.querySelector(':scope > .wms-res-dims');
        if (!dims) {
            dims = document.createElement('span');
            dims.className = 'wms-res-dims';
            sel.after(dims);
        }
        const paint = () => {
            const cur = resolutionItems().find((i) => i && !i.separator && i.checked);
            dims.textContent = (cur && cur.subtext) || '';
            dims.hidden = false;
            // only when the name and its badge still fit beside it
            requestAnimationFrame(() => {
                if (!btn.offsetWidth) return;
                if (btn.scrollWidth > btn.clientWidth + 1 || sel.scrollWidth > sel.clientWidth + 1) dims.hidden = true;
            });
        };
        paint();
        if (resWatched || typeof MutationObserver !== 'function') return;
        resWatched = true;
        new MutationObserver(paint).observe(sel, { childList: true, subtree: true, characterData: true });
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => paint()).observe(btn.parentNode);
    }

    // ---------------------------------------------------------------- badges and sizes in WM drop-down rows

    /**
     * The desktop's model badges (F full, C curated, L legacy) and resolution group badges (LG, WP, XL
     * cost Anlas; SM and the free wallpapers are free) as WM badges in the drop-down / submenu rows.
     * Rows are matched by their label; labels carrying a badge are unique (resolutions carry their size).
     */
    const decor = new Map(); // label -> { badge, cls }

    function modelBadge(value) {
        /* global modelGroups */
        try {
            for (const g of modelGroups) {
                const o = g.options.find((x) => x.value === value);
                if (o) return o.badge ? { badge: o.badge, cls: o.badge_class || '' } : null;
            }
        } catch (_) { /* no list */ }
        return null;
    }

    function resolutionBadge(value) {
        /* global RESOLUTION_GROUPS */
        if (String(value).startsWith('normal_wallpaper_')) return { badge: 'WP', cls: 'free-badge' };
        try {
            const g = RESOLUTION_GROUPS.find((x) => x.options.some((o) => o.value === value));
            if (g && g.badge) return { badge: g.badge, cls: g.free ? 'free-badge' : 'paid-badge' };
        } catch (_) { /* no list */ }
        return null;
    }

    /** A desktop row's phone label and badge (registered for the popup decorator). */
    function rowDecor(item, label) {
        let text = label;
        let deco = null;
        if (item.action === 'studio-select-model') deco = modelBadge(item.value);
        else if (item.action === 'studio-select-resolution') {
            // short names: the free wallpapers are Portrait / Landscape with a WP badge, as the combo shows them
            if (String(item.value).startsWith('normal_wallpaper_')) text = String(item.value).endsWith('_portrait') ? 'Portrait' : 'Landscape';
            if (item.subtext) text += ` ${item.subtext}`;
            deco = resolutionBadge(item.value);
        } else if (item.subtext) {
            text += ` ${item.subtext}`;
        }
        if (deco) decor.set(text, deco);
        return text;
    }

    function decorateRows(scope) {
        if (!decor.size) return;
        scope.querySelectorAll('.wm-popup-item').forEach((b) => {
            if (b.querySelector('.wms-badge')) return;
            const d = decor.get(b.textContent);
            if (!d) return;
            const s = document.createElement('span');
            s.className = `wms-badge ${d.cls}`;
            s.textContent = d.badge;
            b.appendChild(s);
        });
    }

    let decorWatched = false;
    function watchPopupDecor() {
        const pop = shellPopup();
        if (decorWatched || !pop || typeof MutationObserver !== 'function') return;
        decorWatched = true;
        new MutationObserver(() => decorateRows(pop)).observe(pop, { childList: true, subtree: true });
    }

    /**
     * A WM drop-down hangs under its combo; one taller than the room left (Resolution near the
     * bottom) opens above the combo when there is more room there, and scrolls within the room.
     */
    function fitDropdown(anchor) {
        const pop = shellPopup();
        const content = document.querySelector('#wmShell > .wm-content');
        if (!pop || pop.hidden || !content || !pop.offsetParent) return;
        const cr = content.getBoundingClientRect();
        const ar = anchor.getBoundingClientRect();
        const or = pop.offsetParent.getBoundingClientRect();
        const below = cr.bottom - ar.bottom - 2;
        const above = ar.top - cr.top - 2;
        const h = pop.scrollHeight;
        if (h <= below) return;
        const up = above > below;
        const room = Math.max(40, up ? above : below);
        pop.style.maxHeight = `${room}px`;
        pop.style.overflowY = 'auto';
        if (up) pop.style.top = `${ar.top - Math.min(h, room) - or.top}px`;
    }

    // ---------------------------------------------------------------- Characters / Settings fold

    const FOLD_KEY = 'wmStudioFold';
    let fold = {};
    try { fold = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (_) { fold = {}; }

    function setFold(name, closed) {
        fold[name] = !!closed;
        try { localStorage.setItem(FOLD_KEY, JSON.stringify(fold)); } catch (_) { /* private mode */ }
        paintFold();
    }

    function foldHead(name, label) {
        const head = document.createElement('div');
        head.className = 'wms-sect wms-fold';
        head.dataset.fold = name;
        head.setAttribute('role', 'button');
        head.tabIndex = 0;
        head.innerHTML = `<span class="wms-fold-name">${esc(label)}</span><span class="wms-fold-sum"></span><span class="wms-fold-box" aria-hidden="true"></span>`;
        const toggle = (e) => {
            e.preventDefault();
            setFold(name, !fold[name]);
        };
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e); });
        return head;
    }

    function foldSections() {
        if (!page) return;
        const chars = page.querySelector('.wms-chars > .wms-sect:not(.wms-fold)');
        if (chars) chars.replaceWith(foldHead('chars', 'Characters'));
        const mc = document.querySelector('#manualModal .model-control');
        if (mc && !mc.querySelector(':scope > .wms-fold')) mc.insertBefore(foldHead('settings', 'Settings'), mc.firstChild);
        paintFold();
    }

    function settingsSummary() {
        const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
        const model = (document.querySelector('#manualModelDropdownBtn > .wms-model-name') || {}).textContent || '';
        const res = (document.getElementById('manualResolutionSelected') || {}).textContent || '';
        const g = parseFloat(val('manualGuidance'));
        return [model.trim(), val('manualSteps') && `${val('manualSteps')} steps`, Number.isFinite(g) ? g.toFixed(1) : '', res.replace(/\s+/g, ' ').trim()]
            .filter(Boolean).join(', ');
    }

    function charsSummary() {
        const chars = document.getElementById('characterPromptsContainer');
        const n = chars ? chars.children.length : 0;
        return n ? `${n} ${n === 1 ? 'character' : 'characters'}` : 'None';
    }

    function paintFold() {
        if (!page) return;
        ['chars', 'settings'].forEach((name) => {
            const closed = !!fold[name];
            page.classList.toggle(`wms-fold-${name}`, closed);
            const head = name === 'settings'
                ? document.querySelector('#manualModal .model-control > .wms-fold')
                : page.querySelector('.wms-chars > .wms-fold');
            if (!head) return;
            head.setAttribute('aria-expanded', String(!closed));
            const sum = head.querySelector('.wms-fold-sum');
            if (sum) sum.textContent = closed ? (name === 'settings' ? settingsSummary() : charsSummary()) : '';
        });
    }

    /** A section asked for (Menu > Add > Character, the Settings shortcut): opened first. */
    function unfold(name) {
        if (fold[name]) setFold(name, false);
    }

    // ---------------------------------------------------------------- the model's full name

    /**
     * The model combo shows the desktop's short form (v5 + an F badge); the phone row has room for the
     * name the model list uses (NovelAI v5, NovelAI v5 (Curated) ...), kept in step with the choice.
     */
    let modelWatched = false;
    function modelName() {
        const btn = document.getElementById('manualModelDropdownBtn');
        const sel = document.getElementById('manualModelSelected');
        if (!btn || !sel) return;
        let span = btn.querySelector(':scope > .wms-model-name');
        if (!span) {
            span = document.createElement('span');
            span.className = 'wms-model-name';
            btn.insertBefore(span, sel);
        }
        const paint = () => {
            const value = (document.getElementById('manualModel') || {}).value || '';
            const menu = btn.parentNode && btn.parentNode.querySelector(':scope > .custom-dropdown-menu');
            const opt = value && menu ? Array.from(menu.querySelectorAll('.custom-dropdown-option')).find((o) => o.dataset.value === value) : null;
            span.textContent = (opt && opt.textContent.replace(/\s+/g, ' ').trim()) || sel.textContent.replace(/\s+/g, ' ').trim();
            // the desktop's badge (F full, C curated, L legacy) after the name, as in the drop-down rows
            let badge = btn.querySelector(':scope > .wms-badge');
            const d = modelBadge(value);
            if (!d) { if (badge) badge.remove(); return; }
            if (!badge) {
                badge = document.createElement('span');
                span.after(badge);
            }
            badge.className = `wms-badge ${d.cls}`;
            badge.textContent = d.badge;
        };
        paint();
        if (modelWatched || typeof MutationObserver !== 'function') return;
        modelWatched = true;
        new MutationObserver(paint).observe(sel, { childList: true, subtree: true, characterData: true });
    }

    // ---------------------------------------------------------------- number steppers

    /**
     * - / + beside the numeric settings. Steps, Guidance and Rescale take the desktop's own wheel step
     * (manualGenerationParams.js: Steps' pause at 28, Guidance 0.1, Rescale 0.01, the Medium locks);
     * other fields step by their step / min / max. Each step fires input and change; holding repeats.
     */
    const STEPPERS = [
        { id: 'manualSteps', wheel: true },
        { id: 'manualGuidance', wheel: true },
        { id: 'manualRescale', wheel: true, field: '.percentage-input-container' },
        { id: 'manualPrintsCountAlt' },
        { id: 'manualStrengthValue', field: '.percentage-input-container' },
        { id: 'manualNoiseValue', field: '.percentage-input-container' }
    ];

    function stepInput(input, cfg, dir) {
        if (!input || input.disabled || input.readOnly) return;
        const before = input.value;
        if (cfg.wheel) {
            input.dispatchEvent(new WheelEvent('wheel', { deltaY: dir > 0 ? -100 : 100, bubbles: true, cancelable: true }));
        } else {
            try { if (dir > 0) input.stepUp(); else input.stepDown(); } catch (_) {
                const st = Number(input.step) || 1;
                let v = (Number(input.value) || 0) + dir * st;
                if (input.min !== '') v = Math.max(Number(input.min), v);
                if (input.max !== '') v = Math.min(Number(input.max), v);
                input.value = String(v);
            }
        }
        if (input.value === before) return;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function steppers() {
        for (const cfg of STEPPERS) {
            const input = document.getElementById(cfg.id);
            if (!input) continue;
            const field = (cfg.field && input.closest(cfg.field)) || input;
            if (field.parentNode && field.parentNode.classList.contains('wms-stepper')) continue;
            const box = document.createElement('span');
            box.className = 'wms-stepper';
            field.parentNode.insertBefore(box, field);
            const mk = (dir) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.tabIndex = -1;
                b.className = `wms-step ${dir > 0 ? 'wms-step-up' : 'wms-step-down'}`;
                b.setAttribute('aria-label', dir > 0 ? 'Increase' : 'Decrease');
                b.textContent = dir > 0 ? '+' : '\u2212';
                let hold = 0;
                let rep = 0;
                const stop = () => { clearTimeout(hold); clearInterval(rep); hold = rep = 0; };
                let pressed = false;
                b.addEventListener('pointerdown', (e) => {
                    if (e.button > 0) return;
                    e.preventDefault();
                    pressed = true;
                    stop();
                    stepInput(input, cfg, dir);
                    // held: repeats a little slower than the wheel gate (150 ms) so no step is dropped
                    hold = setTimeout(() => { rep = setInterval(() => stepInput(input, cfg, dir), 170); }, 400);
                });
                ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach((t) => b.addEventListener(t, stop));
                // keyboard / assistive clicks (no pointer press before them; a tap's click has detail 0 too)
                b.addEventListener('click', () => {
                    if (pressed) { pressed = false; return; }
                    stepInput(input, cfg, dir);
                });
                return b;
            };
            box.append(mk(-1), field, mk(1));
            if (cfg.field === '.percentage-input-container') percentProxy(input, field);
        }
    }

    /**
     * Rescale / Strength / Noise: the desktop field is a 0..1 number under a "NN%" overlay that hides
     * while it is edited, so the phone showed "0%" and then "0.00" in a box with the desktop's blue
     * glow. A WM edit box takes its place and is edited in percent; it writes the fraction into the
     * desktop's input and fires the desktop's input / change, and follows any change made to it.
     */
    function percentProxy(input, field) {
        if (field.querySelector('.wms-pct')) return;
        const px = document.createElement('input');
        px.type = 'text';
        px.className = 'wms-pct';
        px.inputMode = 'decimal';
        px.autocomplete = 'off';
        px.spellcheck = false;
        px.setAttribute('aria-label', (input.getAttribute('aria-label') || input.id || 'Value') + ' (percent)');
        const pct = () => {
            if (String(input.value).trim() === '') return ''; // empty: inherited (a stage's Strength)
            const v = Number(input.value);
            if (!Number.isFinite(v)) return '';
            return String(Math.round(v * 1000) / 10);
        };
        const ov = field.querySelector('.percentage-input-overlay');
        let typing = false; // the user's own keys since the box took focus: leave their text alone
        const show = () => {
            px.disabled = !!input.disabled;
            if (typing) return;
            const p = pct();
            px.value = p === '' ? '' : document.activeElement === px ? p : `${p}%`;
            // an empty field shows what it inherits (a stage's Strength: the overlay's "50%"), greyed
            const ovText = ov ? ov.textContent.trim() : '';
            px.placeholder = p === '' ? ovText : '';
        };
        const commit = () => {
            if (!typing) { show(); return; }
            const n = parseFloat(String(px.value).replace('%', '').replace(',', '.'));
            if (!Number.isFinite(n)) { show(); return; }
            let v = Math.max(0, Math.min(100, n)) / 100;
            const min = input.min !== '' ? Number(input.min) : null;
            const max = input.max !== '' ? Number(input.max) : null;
            if (min !== null && Number.isFinite(min)) v = Math.max(min, v);
            if (max !== null && Number.isFinite(max)) v = Math.min(max, v);
            const next = v.toFixed(2);
            if (next !== input.value) {
                input.value = next;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            typing = false;
            show();
        };
        px.addEventListener('focus', () => { typing = false; px.value = pct(); requestAnimationFrame(() => { try { px.select(); } catch (_) { /* no selection */ } }); });
        px.addEventListener('input', () => { typing = true; });
        px.addEventListener('blur', commit);
        px.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); px.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); typing = false; px.value = pct(); px.blur(); }
        });
        // the desktop sets the field from presets, the wheel steps, locks: follow it
        ['input', 'change'].forEach((t) => input.addEventListener(t, show));
        if (ov && typeof MutationObserver === 'function') new MutationObserver(show).observe(ov, { childList: true, characterData: true, subtree: true });
        new MutationObserver(show).observe(input, { attributes: true, attributeFilter: ['disabled', 'value'] });
        field.classList.add('wms-pct-host');
        field.appendChild(px);
        show();
    }

    // ---------------------------------------------------------------- the light highlight palette everywhere

    /**
     * initializeEmphasisOverlay (emphasisHighlight.js: app start, a prompt put in by open / apply, a
     * new character) paints with the dark-box palette; only updateEmphasisHighlighting asks the box
     * for --prompt-surface. On the white WM field that left near-white rings and solid syntax chips
     * until the next keystroke: Studio's editors are repainted here in the light palette.
     */
    function repaintOverlay(ta) {
        /* global findPromptEmphasisHighlightOverlay, highlightEmphasisForTextarea, resolveEmphasisBagForTextarea, invalidateEmphasisSpanIndex */
        if (!ta || ta.closest('.creative-directive-container, .prompt-textarea-container.director-prompt')) return;
        if (typeof findPromptEmphasisHighlightOverlay !== 'function' || typeof highlightEmphasisForTextarea !== 'function') return;
        const ov = findPromptEmphasisHighlightOverlay(ta);
        if (!ov) return;
        try {
            const bag = typeof resolveEmphasisBagForTextarea === 'function' ? resolveEmphasisBagForTextarea(ta) : null;
            ov.innerHTML = highlightEmphasisForTextarea(ta, ta.value, bag);
            if (typeof invalidateEmphasisSpanIndex === 'function') invalidateEmphasisSpanIndex(ov);
            ov.scrollTop = ta.scrollTop;
        } catch (err) { console.warn('[wmStudio] highlight', err); }
    }

    let lightWrapped = false;
    function lightOverlays() {
        const m = modal();
        if (!m) return;
        /* global invalidateLightPromptSurfaceCache */
        try { if (typeof invalidateLightPromptSurfaceCache === 'function') invalidateLightPromptSurfaceCache(); } catch (_) { /* below */ }
        if (!lightWrapped && typeof window.initializeEmphasisOverlay === 'function') {
            lightWrapped = true;
            const orig = window.initializeEmphasisOverlay;
            window.initializeEmphasisOverlay = function (ta) {
                const out = orig.apply(this, arguments);
                if (ta && ta.nodeType === 1 && m.contains(ta)) repaintOverlay(ta);
                return out;
            };
        }
        m.querySelectorAll('.prompt-textarea-container textarea, .character-prompt-textarea-container textarea').forEach(repaintOverlay);
    }

    /** The Characters section head and its empty row, in the Prompt page's flow before the overlays. */
    function ensureCharsSection() {
        if (!page || page.querySelector('.wms-chars')) return;
        const list = document.getElementById('textOverlaysContainer') || document.getElementById('characterPromptsContainer');
        if (!list || !list.parentNode) return;
        const box = document.createElement('div');
        box.className = 'wms-chars';
        box.innerHTML = '<div class="wms-sect">Characters</div><div class="wms-chars-none"><span>No characters.</span><button type="button" class="wms-chars-add">Add</button></div>';
        box.querySelector('.wms-chars-add').addEventListener('click', addCharacter);
        list.parentNode.insertBefore(box, list);
        paintEmpty();
    }

    function addCharacter() {
        /* global handleStudioMenuBarAction */
        if (typeof handleStudioMenuBarAction !== 'function') return;
        addAt = Date.now();
        unfold('chars');
        try { handleStudioMenuBarAction('studio-add-character', menuBarTitle('Add'), { action: 'studio-add-character' }); } catch (err) { console.warn('[wmStudio] add character', err); }
        afterAction();
    }

    /** The Prompt page's scroller (the whole form scrolls as one page). */
    const formScroller = () => document.getElementById('manualForm');

    /** A section of the Prompt page (the former Characters / Settings tabs) scrolled to the top. */
    function showSection(name) {
        const sel = SECTIONS[name];
        if (!sel || !page) return;
        if (tab !== 'prompt') setTab('prompt');
        unfold(name === 'settings' ? 'settings' : 'chars');
        const el = page.querySelector(`#manualModal ${sel}`) || page.querySelector(sel);
        const sc = formScroller();
        if (!el || !sc) return;
        sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    }

    // ---------------------------------------------------------------- prompt highlighting

    /**
     * The emphasis / tag highlight overlay (emphasisHighlight.js) is the textarea's absolutely placed
     * sibling. On the desktop the textarea grows with its text; here it has a fixed height and
     * scrolls, so the overlay is sized to the textarea (--wms-ta-*) and follows its scrolling.
     */
    let editorsWatched = false;
    function watchPromptEditors() {
        const m = modal();
        if (editorsWatched || !m) return;
        editorsWatched = true;
        const fit = (ta) => {
            const host = ta.parentElement;
            if (!host || ta.offsetParent === null) return;
            host.style.setProperty('--wms-ta-top', `${ta.offsetTop}px`);
            host.style.setProperty('--wms-ta-h', `${ta.offsetHeight}px`);
            syncOverlayScroll(ta);
        };
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => entries.forEach((e) => fit(e.target))) : null;
        const seen = new WeakSet();
        const scan = () => {
            m.querySelectorAll('textarea.prompt-textarea, textarea.character-prompt-textarea, .prompt-textarea-container textarea, .character-prompt-textarea-container textarea').forEach((ta) => {
                if (seen.has(ta)) return;
                seen.add(ta);
                if (ro) ro.observe(ta); else fit(ta);
            });
        };
        scan();
        if (typeof MutationObserver === 'function') {
            let queued = false;
            // new editors come with characters and text overlays (the main ones are static)
            const mo = new MutationObserver(() => {
                if (queued) return;
                queued = true;
                requestAnimationFrame(() => { queued = false; scan(); });
            });
            ['characterPromptsContainer', 'textOverlaysContainer'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) mo.observe(el, { childList: true });
            });
        }
        // the textarea scrolling inside its box: the overlays scroll with it
        m.addEventListener('scroll', (e) => { if (e.target && e.target.tagName === 'TEXTAREA') syncOverlayScroll(e.target); }, true);
    }

    function syncOverlayScroll(ta) {
        const host = ta.parentElement;
        if (!host) return;
        host.querySelectorAll(':scope > .emphasis-highlight-overlay, :scope > .search-highlight-overlay').forEach((ov) => {
            if (ov.scrollTop !== ta.scrollTop) ov.scrollTop = ta.scrollTop;
            if (ov.scrollLeft !== ta.scrollLeft) ov.scrollLeft = ta.scrollLeft;
        });
    }

    async function attach() {
        if (!page) return;
        const status = page.querySelector('.wms-status');
        if (!modal() || typeof window.openManualModalWithContent !== 'function') {
            status.hidden = false;
            setTimeout(() => { if (shown) void attach(); }, 1000);
            return;
        }
        status.hidden = true;
        hostStudio();
        if (!studioOpen() && !opening) {
            try { await window.openManualModalWithContent(); } catch (err) { console.warn('[wmStudio] open failed', err); }
        }
        if (!shown) return;
        hostStudio();
        adoptOpenWindows();
        paintTab();
        refreshTitle();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function refreshTitle() {
        if (!ws || !isCurrent() || root.hasAttribute('data-wm-viewer')) return;
        const top = tools[tools.length - 1];
        if (top) { ws.setTitle(windowTitle(top.win)); return; }
        // a print running: its progress in the title (Generate stays free to queue another)
        if (generating()) {
            const p = progress();
            // Rentan resolves the scene before the print goes out (it can take a while): say so
            let title = 'Printing...';
            if (p && p.rentan) title = 'Rentan...';
            else if (p && p.pct > 0 && p.pct <= 100) title = `Printing ${Math.round(p.pct)}%`;
            else if (p && p.phase === 'queued') title = 'Queued...';
            if (p && p.queued && p.phase !== 'queued') title += ` +${p.queued}`;
            ws.setTitle(title);
            return;
        }
        ws.setTitle('Studio');
    }

    // ---------------------------------------------------------------- tabs

    /**
     * The page's layout for the screen it has (Yozora #732), from wm-studio.css's container queries:
     * 'tabs' (a phone: one page per tab), 'split' (the Print beside the form) or 'stack' (the Print
     * under the form). With the Print always on screen the Print tab is not on the strip: a switch to
     * it (Generate, Previous / Next Print) keeps the form page that was showing.
     */
    let layout = 'tabs';
    let formTab = 'prompt'; // the last of Prompt / Images, the form page beside the Print
    function readLayout() {
        const host = page && page.querySelector('.wms-host');
        const v = host ? getComputedStyle(host).getPropertyValue('--wms-layout').trim() : '';
        return v === 'split' || v === 'stack' ? v : 'tabs';
    }

    const printBeside = () => layout !== 'tabs';
    const shownTab = () => (tab === 'print' && printBeside() ? formTab : tab);
    const printOnScreen = () => tab === 'print' || printBeside();

    let layoutWatched = false;
    function watchLayout() {
        if (layoutWatched || !page || typeof ResizeObserver !== 'function') return;
        layoutWatched = true;
        // rotation and resizes: the container queries have already reflowed the page; the tabs follow
        const check = () => {
            const now = readLayout();
            if (now === layout) return;
            layout = now;
            paintTab();
            pairsLayout();
        };
        new ResizeObserver(check).observe(page);
        // Settings > Screen changes the scale (--wm-px, so the em breakpoints) without a resize
        if (typeof MutationObserver === 'function') new MutationObserver(check).observe(root, { attributes: true, attributeFilter: ['style'] });
    }

    function setTab(id) {
        if (SECTIONS[id]) { showSection(id); return; }
        if (!TABS.some(([t]) => t === id)) return;
        tab = id;
        if (id !== 'print') formTab = id;
        paintTab();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function paintTab() {
        if (!page) return;
        const cur = shownTab();
        page.dataset.tab = cur;
        page.querySelectorAll('.wms-tabs .wm-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === cur)));
        // each page starts at its top when it is switched to
        if (paintedTab !== cur) {
            paintedTab = cur;
            const scroll = page.querySelector('#manualModal .form-section-scroll');
            if (scroll) scroll.scrollTop = 0;
            const form = formScroller();
            if (form && page.contains(form)) form.scrollTop = 0;
        }
        paintEmpty();
    }

    /** Characters with none yet: a "No characters" row with Add in the Prompt page's Characters section. */
    function paintEmpty() {
        if (!page) return;
        const empty = page.querySelector('.wms-chars-none');
        const chars = document.getElementById('characterPromptsContainer');
        const overlays = document.getElementById('textOverlaysContainer');
        const none = !(chars && chars.children.length) && !(overlays && overlays.children.length && !overlays.classList.contains('hidden'));
        if (empty) empty.hidden = !none;
        paintFold();
        const noprint = page.querySelector('.wms-noprint');
        const img = document.getElementById('manualPreviewImage');
        const hasPrint = !!(img && !img.classList.contains('hidden') && img.getAttribute('src'));
        noprint.hidden = !(printOnScreen() && !hasPrint && !generating());
        // Images: nothing on the page (the desktop keeps its empty containers in the layout)
        const norefs = page.querySelector('.wms-norefs');
        const images = shownTab() === 'images';
        let refs = 0;
        if (images) {
            ['transformationRow', 'pipelineStagesSection'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) refs += el.getBoundingClientRect().height;
            });
        }
        norefs.hidden = !(images && refs < 4);
    }

    // ---------------------------------------------------------------- generate

    function generate() {
        const btn = document.getElementById('manualGenerateBtn');
        // as on the desktop, a print can be queued while another runs
        if (!btn || btn.disabled) return;
        // the desktop's own Generate (its Anlas question is the shell's WM message box)
        btn.click();
        setTimeout(syncGenerating, 50);
    }

    function syncGenerating() {
        const now = generating();
        if (now && !wasGenerating) {
            // the print shows on the Print page while it runs
            if (shown && !tools.length) setTab('print');
            if (!progressTimer) progressTimer = setInterval(syncGenerating, 500);
        }
        if (!now && progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        wasGenerating = now;
        if (page) { page.classList.toggle('wms-generating', now); paintEmpty(); }
        refreshTitle();
        if (isCurrent() && !tools.length) ws.refreshSoftKeys();
    }

    function generateKey() {
        const btn = document.getElementById('manualGenerateBtn');
        return { label: 'Generate', disabled: !studioOpen() || !btn || btn.disabled, action: generate };
    }

    // ---------------------------------------------------------------- desktop menus as WM menus

    function resolve(v, target) {
        try { return typeof v === 'function' ? v(target) : v; } catch (_) { return undefined; }
    }

    function visible(item) {
        try {
            /* global contextMenu */
            if (typeof contextMenu !== 'undefined' && contextMenu && typeof contextMenu.shouldShowItem === 'function') return contextMenu.shouldShowItem(item) !== false;
        } catch (_) { /* show it */ }
        return !resolve(item.hidden);
    }

    /**
     * contextMenu.js rows -> WM menu rows: text, disabled (bool or fn), checked / radio marks
     * (showIndicator, indicatorMark), submenus (submenu array or optionsfn), separators with a heading
     * (a greyed row). run(action, target, item) carries out a row (the menu's onAction).
     */
    function wmItems(items, target, run, handlerfn) {
        const out = [];
        for (const raw of items || []) {
            if (!raw) continue;
            const item = raw;
            if (item.separator) {
                if (out.length && out[out.length - 1] !== '-') out.push('-');
                const heading = resolve(item.text, target);
                if (heading) out.push({ label: String(heading), disabled: true, indent: 0, heading: true });
                continue;
            }
            if (!visible(item)) continue;
            try { if (typeof item.initfn === 'function') item.initfn(item, target); } catch (_) { /* as is */ }
            try { if (typeof item.loadfn === 'function') item.loadfn(item, target); } catch (_) { /* as is */ }
            let label = resolve(item.text, target) || resolve(item.tooltip, target) || resolve(item.label, target);
            // rows drawn by a content() function (Datasets, Adjustments: a name and, when on, a bias
            // stepper): the name is the label; the bias steps are a submenu
            let node = null;
            if (!label && typeof item.content === 'function') {
                try { node = item.content(target); } catch (_) { node = null; }
                if (node && node.nodeType === 1) {
                    const name = node.querySelector('.dataset-name');
                    label = (name || node).textContent;
                }
            }
            if (!label) continue; // custom rows (sliders, grids) have no WM counterpart
            const row = { label: rowDecor(item, String(label).replace(/\s+/g, ' ').trim()), disabled: !!resolve(item.disabled) };
            const sub = Array.isArray(item.submenu) ? item.submenu : null;
            if (sub || typeof item.optionsfn === 'function') {
                row.submenu = () => {
                    let list = sub;
                    if (!list) { try { list = item.optionsfn(target); } catch (_) { list = []; } }
                    return wmItems(list, target, run, item.handlerfn || handlerfn);
                };
            } else if ((handlerfn || item.action) && node && node.querySelector('[data-bias-step]')) {
                row.checked = !!item.checked;
                const biasEl = node.querySelector('.dataset-bias-value');
                const bias = biasEl ? biasEl.textContent.trim() : '';
                if (bias) row.label += `  ${bias}`;
                const toggle = () => {
                    addAt = Date.now();
                    try {
                        if (handlerfn) handlerfn(item, target, null);
                        else run(item.action, target, item);
                    } catch (err) { console.warn('[wmStudio] menu action failed', err); }
                    afterAction();
                };
                // the desktop row's own - / + (wireStudioBiasControls listens for mousedown)
                const step = (dir) => () => {
                    let fresh = null;
                    try { fresh = item.content(target); } catch (_) { fresh = null; }
                    const btn = fresh && Array.from(fresh.querySelectorAll('[data-bias-step]')).find((el) => Math.sign(Number(el.dataset.biasStep)) === dir);
                    if (btn) btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    afterAction();
                };
                row.submenu = () => [
                    { label: 'On', checked: !!item.checked, action: toggle },
                    '-',
                    { label: bias ? `Bias ${bias}` : 'Bias', disabled: true, heading: true },
                    { label: 'Increase', action: step(1) },
                    { label: 'Decrease', action: step(-1) }
                ];
            } else if (handlerfn || item.action) {
                const marked = item.showIndicator || item.indicatorMark || item.checked != null;
                if (marked && item.indicatorMark === 'radio') row.radio = !!item.checked;
                else if (marked) row.checked = !!item.checked;
                row.action = () => {
                    addAt = Date.now();
                    try {
                        if (handlerfn) handlerfn(item, target, null);
                        else run(item.action, target, item);
                    } catch (err) { console.warn('[wmStudio] menu action failed', err); }
                    afterAction();
                };
            } else {
                continue;
            }
            out.push(row);
        }
        while (out.length && out[out.length - 1] === '-') out.pop();
        while (out.length && out[0] === '-') out.shift();
        return out;
    }

    /** A contextMenu config (sections: list / icons; custom and grid sections have no WM rows). */
    function wmItemsFromConfig(config, target, flat) {
        const run = (action, t, item) => {
            if (config && typeof config.onAction === 'function') { config.onAction(action, t, item); return; }
            document.dispatchEvent(new CustomEvent('contextMenuAction', { detail: { action, target: t, item, menu: contextMenu } }));
        };
        const out = [];
        try { if (typeof config.beforeShow === 'function') config.beforeShow(null, target, true); } catch (_) { /* as is */ }
        for (const section of (config && config.sections) || []) {
            if (!section) continue;
            try { if (typeof section.initfn === 'function') section.initfn(section, target); } catch (_) { /* as is */ }
            try { if (typeof section.loadfn === 'function' && section.type === 'list') section.loadfn(section, target); } catch (_) { /* as is */ }
            if (resolve(section.hidden, target) === true) continue;
            let rows = [];
            if (section.type === 'icons' && Array.isArray(section.icons)) rows = section.icons.map((ic) => Object.assign(ic, { text: ic.text || ic.tooltip }));
            else if (Array.isArray(section.items) && section.type !== 'grid' && section.type !== 'custom') rows = section.items;
            const items = wmItems(rows, target, run);
            if (!items.length) continue;
            const title = resolve(section.title, target);
            if (title && flat) {
                // a combo's list: the title is a greyed heading (dropped when it only repeats the label)
                if (out.length && out[out.length - 1] !== '-') out.push('-');
                out.push({ label: String(title).replace(/\s+/g, ' ').trim(), disabled: true, heading: true }, ...items);
                continue;
            }
            if (title) {
                // a titled section is one row with its rows as a submenu: long desktop menus stay short
                out.push({ label: String(title).replace(/\s+/g, ' ').trim(), submenu: () => items });
                continue;
            }
            if (out.length && out[out.length - 1] !== '-') out.push('-');
            out.push(...items);
        }
        while (out.length && out[out.length - 1] === '-') out.pop();
        return out;
    }

    /** Heading rows that only repeat the field label (a combo's single group) go. */
    function dropLoneHeading(items) {
        const headings = items.filter((i) => i && i.heading);
        if (headings.length !== 1) return items;
        const out = items.filter((i) => !(i && i.heading));
        while (out.length && out[0] === '-') out.shift();
        return out;
    }

    // ---------------------------------------------------------------- WM menu closing = the desktop menu's onHide

    let menuHide = null; // what the desktop menu would run when it hides (onHide, SmartText draft save)
    let popupWatched = false;

    function flushSmartText() {
        /* global flushAutofillSettingsDraftIfDirty */
        try { if (typeof flushAutofillSettingsDraftIfDirty === 'function') void flushAutofillSettingsDraftIfDirty(); } catch (_) { /* nothing to save */ }
    }

    function shellPopup() {
        return document.querySelector('#wmShell > .wm-popup');
    }

    /** The shell runs no close callback for menu / menuAt: its popup going hidden is the close. */
    function armMenuHide(fn) {
        const prev = menuHide;
        menuHide = fn;
        if (prev && prev !== fn) { try { prev(); } catch (_) { /* best effort */ } }
        const pop = shellPopup();
        if (!pop || popupWatched || typeof MutationObserver !== 'function') return;
        popupWatched = true;
        new MutationObserver(() => {
            if (!pop.hidden) return;
            pop.style.maxHeight = '';
            pop.style.overflowY = '';
            pop.style.minWidth = '';
            if (!menuHide) return;
            const run = menuHide;
            menuHide = null;
            try { run(); } catch (err) { console.warn('[wmStudio] menu onHide', err); }
        }).observe(pop, { attributes: true, attributeFilter: ['hidden'] });
    }

    /** A context menu kept between the title bar and the soft keys (it scrolls when longer). */
    function menuInContent(x, y, items) {
        ws.menuAt(x, y, items);
        const pop = shellPopup();
        const content = document.querySelector('#wmShell > .wm-content');
        if (!pop || !content || !pop.offsetParent) return;
        const cr = content.getBoundingClientRect();
        const or = pop.offsetParent.getBoundingClientRect();
        pop.style.maxHeight = `${Math.max(40, cr.height - 4)}px`;
        pop.style.overflowY = 'auto';
        const h = pop.offsetHeight;
        const top = Math.max(cr.top + 2, Math.min(y, cr.bottom - h - 2));
        pop.style.top = `${top - or.top}px`;
    }

    function menuBarTitle(name) {
        return document.querySelector(`#manualModalMenuBar .naxt-menu-title[data-menu="${name}"]`) || modal();
    }

    function menuBarItems(name) {
        /* global studioMenuBarItems, handleStudioMenuBarAction */
        if (typeof studioMenuBarItems !== 'function' || typeof handleStudioMenuBarAction !== 'function') return [{ label: 'Not ready yet', disabled: true }];
        let rows = [];
        try { rows = studioMenuBarItems(name); } catch (err) { console.warn('[wmStudio] menu', name, err); }
        const target = menuBarTitle(name);
        const items = wmItems(rows, target, (action, t, item) => handleStudioMenuBarAction(action, t, item));
        return items.length ? items : [{ label: '(empty)', disabled: true }];
    }

    /** The desktop menu bar's onHide (attachClickMenuToElement options): saves Edit > SmartText changes. */
    function menuBarHide() {
        let ran = false;
        try {
            const title = document.querySelector('#manualModalMenuBar .naxt-menu-title[data-click-menu]');
            const cfg = title && contextMenu && contextMenu.clickMenuConfigs && contextMenu.clickMenuConfigs[title.dataset.clickMenu];
            if (cfg && typeof cfg.onHide === 'function') { cfg.onHide(title); ran = true; }
        } catch (_) { /* below */ }
        if (!ran) flushSmartText();
    }

    function clickIf(id) {
        const b = document.getElementById(id);
        if (b && !b.disabled && !b.classList.contains('hidden')) { b.click(); return true; }
        return false;
    }

    function enabled(id) {
        const b = document.getElementById(id);
        return !!(b && !b.disabled && !b.classList.contains('hidden'));
    }

    function mainMenu() {
        if (!studioOpen()) return [{ label: 'Studio is starting...', disabled: true }];
        armMenuHide(menuBarHide);
        const items = MENUS.map((name) => ({ label: name, submenu: () => menuBarItems(name) }));
        // the Settings section's Workspace row lives here on the phone (its combo's own list and action)
        items.splice(MENUS.indexOf('View') + 1, 0, { label: 'Workspace', submenu: workspaceItems });
        // the preview's own buttons (manualPreviewManager.js)
        items.splice(items.findIndex((i) => i.label === 'Help'), 0, '-',
            { label: 'Previous Print', disabled: !enabled('manualPreviewPrevBtn'), action: () => { clickIf('manualPreviewPrevBtn'); setTab('print'); } },
            { label: 'Next Print', disabled: !enabled('manualPreviewNextBtn'), action: () => { clickIf('manualPreviewNextBtn'); setTab('print'); } },
            { label: 'View Print', disabled: !printName(), action: viewPrint },
            '-');
        return items;
    }

    /** The Workspace combo's own click menu (manualWorkspaceDropdownBtn): its rows, its radio, its action. */
    function workspaceItems() {
        const btn = document.getElementById('manualWorkspaceDropdownBtn');
        const cfg = btn && typeof contextMenu !== 'undefined' && contextMenu && contextMenu.clickMenuConfigs && contextMenu.clickMenuConfigs[btn.dataset.clickMenu];
        if (!cfg) return [{ label: 'Not ready yet', disabled: true }];
        let items = [];
        try { items = dropLoneHeading(wmItemsFromConfig(cfg, btn, true)); } catch (err) { console.warn('[wmStudio] workspaces', err); }
        return items.length ? items : [{ label: '(empty)', disabled: true }];
    }

    function afterAction() {
        setTimeout(() => {
            paintEmpty();
            if (isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
        }, 60);
    }

    let lastCombo = { el: null, at: 0 };

    /** Desktop context menus raised inside Studio (long press on a prompt, the print, Generate ...) as WM menus. */
    function patchContextMenu() {
        /* global contextMenu */
        if (typeof contextMenu === 'undefined' || !contextMenu || contextMenu._wmStudioPatched || typeof contextMenu._openMenu !== 'function') return !!(typeof contextMenu !== 'undefined' && contextMenu && contextMenu._wmStudioPatched);
        contextMenu._wmStudioPatched = true;
        const open = contextMenu._openMenu.bind(contextMenu);
        contextMenu._openMenu = function (event, target, trigger, isTouch, isProxyEvent) {
            // Studio's page, or a desktop app hosted by wmHost.js (it uses this same WM menu proxy)
            const inStudio = isCurrent() && target && page && page.contains(target);
            const inHost = !!(target && window.wmHost && typeof window.wmHost.owns === 'function' && window.wmHost.owns(target));
            if (!inStudio && !inHost) return open(event, target, trigger, isTouch, isProxyEvent);
            const config = trigger === 'click'
                ? (this.clickMenuConfigs && this.clickMenuConfigs[target.dataset.clickMenu])
                : (this.configs && this.configs[target.dataset.contextMenu]);
            if (!config) return undefined;
            const combo = trigger === 'click' && target.closest && target.closest('.custom-dropdown');
            let items = [];
            try { items = wmItemsFromConfig(config, target, !!combo); } catch (err) { console.warn('[wmStudio] context menu', err); }
            if (!items.length) return undefined;
            const onHide = () => {
                if (typeof config.onHide !== 'function') { flushSmartText(); return; }
                try { config.onHide(target); } catch (err) { console.warn('[wmStudio] onHide', err); }
            };
            // a desktop combo (Sampler, Model ...): a WM drop-down under the whole combo, at least its width
            if (combo) {
                // a touch raises the desktop menu twice (touch, then its click): the second would close it again
                const pop0 = shellPopup();
                if (pop0 && !pop0.hidden && lastCombo.el === combo && Date.now() - lastCombo.at < 600) return undefined;
                lastCombo = { el: combo, at: Date.now() };
                armMenuHide(null);
                ws.dropdown(combo, dropLoneHeading(items), sideOf(combo), onHide);
                const pop = shellPopup();
                if (pop && !pop.hidden) pop.style.minWidth = `${Math.round(combo.getBoundingClientRect().width)}px`;
                fitDropdown(combo);
                return undefined;
            }
            let x = 0;
            let y = 0;
            const pt = event && ((event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]) || event);
            if (pt && Number.isFinite(pt.clientX) && (pt.clientX || pt.clientY)) { x = pt.clientX; y = pt.clientY; } else {
                const r = target.getBoundingClientRect();
                x = r.left; y = r.bottom;
            }
            armMenuHide(onHide);
            menuInContent(x, y, items);
            return undefined;
        };
        return true;
    }

    // ---------------------------------------------------------------- drop-down combos

    let proxying = false;

    /** A narrow control at the right edge (the toolbar's Add) drops its list leftwards, kept on screen. */
    function sideOf(el) {
        const r = el.getBoundingClientRect();
        return r.left > window.innerWidth / 2 ? 'right' : 'left';
    }

    /**
     * A desktop custom drop-down (manualDropdownManager.js) that just opened: its rows (groups as greyed
     * headings, .selected as the dot) as a WM drop-down; a pick clicks the desktop row, so its handler
     * does the work. Lists without plain rows (sliders, custom content) stay the desktop's.
     */
    function proxyDropdown(btn) {
        const box = btn.closest('.custom-dropdown');
        const menu = box && box.querySelector(':scope > .custom-dropdown-menu');
        if (!menu || menu.classList.contains('hidden') || getComputedStyle(menu).display === 'none') return;
        const rows = Array.from(menu.querySelectorAll('.custom-dropdown-group, .custom-dropdown-option'));
        if (!rows.some((r) => r.classList.contains('custom-dropdown-option'))) return;
        const items = [];
        for (const r of rows) {
            const text = r.textContent.replace(/\s+/g, ' ').trim();
            if (!text || r.classList.contains('hidden') || r.closest('.hidden') !== menu.closest('.hidden')) continue;
            if (r.classList.contains('custom-dropdown-group')) {
                if (items.length) items.push('-');
                items.push({ label: text, disabled: true, heading: true });
                continue;
            }
            items.push({
                label: text,
                radio: r.classList.contains('selected') || r.getAttribute('aria-selected') === 'true',
                disabled: r.classList.contains('disabled') || r.getAttribute('aria-disabled') === 'true',
                action: () => { picked = true; r.click(); afterAction(); }
            });
        }
        let picked = false;
        // the desktop list leaves the layout first, so the combo is measured where it sits
        menu.classList.add('wms-dd-proxied');
        ws.dropdown(box, dropLoneHeading(items), sideOf(box), () => {
            menu.classList.remove('wms-dd-proxied');
            // closed without a pick: the desktop list closes too
            setTimeout(() => {
                if (picked || menu.classList.contains('hidden')) return;
                proxying = true;
                try { btn.click(); } finally { proxying = false; }
                if (!menu.classList.contains('hidden')) menu.classList.add('hidden');
                box.classList.remove('open', 'active');
            }, 0);
        });
        const pop = shellPopup();
        if (pop && !pop.hidden) pop.style.minWidth = `${Math.round(box.getBoundingClientRect().width)}px`;
        fitDropdown(box);
    }

    // ---------------------------------------------------------------- the print

    function printName() {
        const img = document.getElementById('manualPreviewImage');
        if (!img || img.classList.contains('hidden') || !img.getAttribute('src')) return '';
        const cur = window.currentManualPreviewImage;
        return (cur && (cur.filename || cur.original || cur.upscaled)) || window.lastGeneratedImageName || '';
    }

    /** A tap on the print: the shell's picture view (PhotoSwipe, lightbox.js), as in Pictures & Videos. */
    function viewPrint() {
        const name = printName();
        /* global showLightbox */
        if (!name || typeof showLightbox !== 'function') return;
        try { showLightbox({ filename: name }); } catch (err) { console.warn('[wmStudio] viewer', err); }
    }

    // ---------------------------------------------------------------- tool windows as sub-pages

    // windows this page is closing (Done / back): never hosted again while they animate out
    const dismissed = new WeakSet();
    const NOT_TOOLS = new Set(['manualModal', 'galleryWindow', 'confirmationDialog', 'bootMessageBox', 'pinModal', 'agentClientUpdateDialog', 'directorWindow']);

    function isToolCandidate(el) {
        return !!(el && el.nodeType === 1 && el.parentNode === document.body && el.classList.contains('modal')
            && !NOT_TOOLS.has(el.id) && !(window.wmDialogs && window.wmDialogs.claims(el)) && !el.classList.contains('hidden') && !el.classList.contains('hidden-alt')
            && !el.classList.contains('minimised') && !el.classList.contains('closing') && !dismissed.has(el));
    }

    /** The window's caption: its title bar's own text first (not the toolbar beside it), else a header. */
    function windowTitle(win, fallback = 'Studio') {
        const sels = [
            ':scope > .modal-window-title .modal-window-title-main span',
            ':scope > .modal-window-title .modal-window-title-main',
            ':scope > .modal-window-title > span',
            '.credit-cost-header span', '.modal-header h3', '.modal-header h2', '.modal-header .modal-title',
            '[class$="-header"] > span', '[class$="-header"] > h3'
        ];
        for (const sel of sels) {
            const t = win.querySelector(sel);
            const text = t && t.textContent.replace(/\s+/g, ' ').trim();
            if (text) return text;
        }
        return fallback;
    }

    // ---------------------------------------------------------------- a tool page's soft keys

    const FOOTERS = '.modal-footer, .modal-footer-colored, .character-position-footer, .modal-actions, .dialog-buttons';

    /** The buttons of the window's footer rows (hidden on the phone: they are its soft keys and Menu). */
    function toolButtons(win) {
        const seen = new Set();
        const out = [];
        win.querySelectorAll(FOOTERS).forEach((f) => {
            if (f.closest('.modal') !== win) return; // a nested window's footer is its own
            f.querySelectorAll('button').forEach((b) => {
                if (seen.has(b) || b.hidden || b.classList.contains('hidden') || b.closest('.hidden')) return;
                if (getComputedStyle(b).display === 'none') return;
                const label = (b.textContent || '').replace(/\s+/g, ' ').trim() || b.title || b.getAttribute('aria-label') || '';
                if (!label) return;
                seen.add(b);
                out.push({ b, label });
            });
        });
        return out;
    }

    /**
     * Soft keys of the top tool page. A form with Cancel or a Save (vSlider editor, Text Expander,
     * Time and Date ...): left = its own primary button (Save, Apply ...), Menu = the other buttons
     * and Cancel. A tool window (Character Positions, vSlider, Activity ...): left = Done (its close),
     * Menu = its footer's buttons. Every row presses the desktop button.
     */
    function toolKeys(win) {
        const btns = toolButtons(win);
        const cancel = btns.find((x) => /^(cancel|close)$/i.test(x.label));
        const prim = btns.filter((x) => x !== cancel && x.b.classList.contains('btn-primary')).pop();
        const form = !!(prim && (cancel || /^(save|ok|update|write|process|combine|replace)/i.test(prim.label)));
        const press = (x) => () => { if (!x.b.disabled) { x.b.click(); afterAction(); } };
        const left = form
            ? { label: prim.label.length > 14 ? prim.label.split(' ')[0] : prim.label, disabled: prim.b.disabled, action: press(prim) }
            : { label: 'Done', action: closeTool };
        const rows = btns.filter((x) => x !== cancel && !(form && x === prim))
            .map((x) => ({ label: x.label, disabled: !!x.b.disabled, action: press(x) }));
        if (form) rows.push('-', { label: cancel ? cancel.label : 'Cancel', action: closeTool });
        return { left, right: rows.length ? { label: 'Menu', menu: () => toolKeys(win).rows } : null, rows, form, prim };
    }

    function setUnder() {
        tools.forEach((t, i) => {
            if (i === tools.length - 1) t.win.removeAttribute('data-wms-under');
            else t.win.setAttribute('data-wms-under', '');
        });
    }

    /**
     * A desktop window that opens over Studio is pushed as a sub-page over the one before it (the
     * vSlider editor over vSlider): nothing under it closes; Done or back pops back down.
     */
    function hostTool(win) {
        if (!page || tools.some((t) => t.win === win)) return;
        const box = page.querySelector('.wms-tool');
        const entry = { win, parent: win.parentNode, next: win.nextSibling, title: windowTitle(win), mo: null };
        tools.push(entry);
        // its caption (SmartText [field]) and footer buttons (enabled, shown) follow on the title bar / soft keys
        if (typeof MutationObserver === 'function') {
            let queued = false;
            entry.mo = new MutationObserver(() => {
                if (queued) return;
                queued = true;
                requestAnimationFrame(() => {
                    queued = false;
                    if (tools[tools.length - 1] !== entry || !isCurrent()) return;
                    refreshTitle();
                    ws.refreshSoftKeys();
                });
            });
            const watch = [win.querySelector(':scope > .modal-window-title'), ...win.querySelectorAll(FOOTERS)].filter(Boolean);
            watch.forEach((el) => entry.mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'class', 'hidden'] }));
        }
        box.querySelector('.wms-tool-host').appendChild(win);
        setUnder();
        box.hidden = false;
        page.classList.add('wms-has-tool');
        refreshTitle();
        if (isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
    }

    /** A window is back where the desktop keeps it (body); the sub-page under it shows again. */
    function releaseTool(win, silent) {
        const i = tools.findIndex((t) => t.win === win);
        if (i < 0) return;
        const { parent, next, mo } = tools[i];
        if (mo) mo.disconnect();
        tools.splice(i, 1);
        win.removeAttribute('data-wms-under');
        try {
            if (next && next.parentNode === parent) parent.insertBefore(win, next);
            else (parent || document.body).appendChild(win);
        } catch (_) { document.body.appendChild(win); }
        setUnder();
        if (page && !tools.length) {
            page.querySelector('.wms-tool').hidden = true;
            page.classList.remove('wms-has-tool');
        }
        if (silent) return;
        refreshTitle();
        if (isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
    }

    function releaseAll() {
        while (tools.length) releaseTool(tools[tools.length - 1].win, true);
    }

    /**
     * Done / back: the top window closes its own way (its close button, else a dialog's own Cancel),
     * so its code saves or discards and resolves whatever waits on it, as on the desktop.
     */
    function closeTool() {
        const top = tools[tools.length - 1];
        if (!top) return;
        const win = top.win;
        dismissed.add(win);
        const btn = win.querySelector('.modal-window-controls .close-btn, .modal-window-controls [id^="close"], [data-action="close"]')
            || win.querySelector('.credit-cost-cancel-btn, [data-dialog-cancel], [data-action="cancel"]')
            || Array.from(win.querySelectorAll('button.btn-secondary, button')).find((b) => /^\s*cancel\s*$/i.test(b.textContent || ''));
        if (btn) btn.click();
        else if (typeof window.closeModal === 'function') { try { window.closeModal(win); } catch (_) { /* below */ } }
        // a window that keeps itself open after its close is let go anyway
        setTimeout(() => {
            if (!tools.some((t) => t.win === win)) return;
            if (!win.classList.contains('hidden')) win.classList.add('hidden');
            releaseTool(win);
        }, 1000); // after closeModal's own 600 ms fallback (modalUtils.js)
    }

    /**
     * Desktop windows open while another app is on screen (SmartText, Ledge from a Director print, a
     * tool from an MCP action) are drawn nowhere: the shell covers the desktop. Each gets a WM
     * notification (Show brings Studio up), and Studio hosts every such window when it comes up, so
     * no window stays open unseen and asking for it again from Studio's menu shows it.
     */
    const behind = new Map(); // win -> toast id of its notification

    function unnotify(win) {
        const id = behind.get(win);
        if (!id) return;
        behind.delete(win);
        try { if (typeof window.removeGlassToast === 'function') window.removeGlassToast(id); } catch (_) { /* gone */ }
    }

    function notifyBehind(win) {
        if (root.dataset.wmBoot !== 'done' || !isToolCandidate(win) || typeof window.showGlassToast !== 'function') return;
        unnotify(win);
        const id = window.showGlassToast('info', esc(windowTitle(win)), 'Open in Studio.', false, false, null,
            [{ text: 'Show', onClick: () => { unnotify(win); if (!isCurrent()) ws.open(APP_ID); } }]);
        if (id) behind.set(win, id);
    }

    /** Studio is on screen: windows left open behind other apps become its tool pages, the topmost last. */
    function adoptOpenWindows() {
        if (!page || !shown || !isCurrent() || !studioOpen()) return;
        const z = (w) => parseInt(getComputedStyle(w).zIndex, 10) || 0;
        Array.from(document.body.children).filter(isToolCandidate)
            .sort((a, b) => z(a) - z(b))
            .forEach((w) => { unnotify(w); hostTool(w); });
    }

    /** A window opening, or asked for again while open: hosted over Studio, else a notification. */
    function routeWindow(el) {
        if (!isToolCandidate(el)) return;
        if (isCurrent() && studioOpen()) { unnotify(el); hostTool(el); }
        // anywhere else the window is its own WM app (wmHost.js); without it, a notification
        else if (window.wmHost && typeof window.wmHost.take === 'function' && window.wmHost.take(el)) unnotify(el);
        else notifyBehind(el);
    }

    /**
     * openModal on a window that is already open only raises it on the desktop (no class change for
     * the watcher to see). On the phone that is the user asking for it again: route it as an opening.
     * The Director window has its own route (patchDirectorFocus).
     */
    function wrapOpenModal() {
        const orig = window.openModal;
        if (typeof orig !== 'function' || orig._wmStudio) return;
        const wrapped = function (m) {
            const reopen = !!(m && m.nodeType === 1 && m.id !== 'directorWindow' && m.parentNode === document.body
                && !m.classList.contains('hidden') && !m.classList.contains('hidden-alt'));
            const out = orig.apply(this, arguments);
            if (reopen && root.dataset.wmBoot === 'done') routeWindow(m);
            return out;
        };
        wrapped._wmStudio = true;
        window.openModal = wrapped;
    }

    function openDirectorApp() {
        if (ws.listApps().some((a) => a.id === 'director')) ws.open('director');
    }

    /**
     * Ask Wren, the Director button and the tray focus an already open Director window
     * (director.js focusDirectorWindow): over Studio that is the Director app. Explicit, so a window
     * merely losing or regaining active-window (another window opening or closing) moves nothing.
     */
    function patchDirectorFocus() {
        const d = window.directorInstance;
        if (!d || typeof d.focusDirectorWindow !== 'function') return false;
        if (d.focusDirectorWindow._wmStudio) return true;
        const orig = d.focusDirectorWindow;
        const wrapped = function () {
            const out = orig.apply(this, arguments);
            if (isCurrent() && root.dataset.wmBoot === 'done') openDirectorApp();
            return out;
        };
        wrapped._wmStudio = true;
        d.focusDirectorWindow = wrapped;
        return true;
    }

    /**
     * Only a window that opens (hidden -> shown) while Studio is on screen becomes a tool page. Any
     * other class change (setActiveWindow moving active-window, opening / closing animations) is not
     * an opening: without this a window left open behind another app, or the Director window hosted
     * in its own app, was grabbed (or the Director app opened) the next time a window took focus.
     */
    function watchWindows() {
        if (typeof MutationObserver !== 'function') return;
        const seen = new WeakSet();
        const wasOpen = new WeakMap();
        const isOpen = (el) => !el.classList.contains('hidden') && !el.classList.contains('hidden-alt') && !el.classList.contains('minimised');
        const check = (el) => {
            // the Director (Image > Ask Wren ...) is its own app (wmDirector.js): its window opening
            // over Studio opens that app (an already open one is brought up by patchDirectorFocus)
            if (el.id === 'directorWindow') {
                if (isCurrent() && studioOpen()) openDirectorApp();
                return;
            }
            routeWindow(el);
        };
        const observeWin = (el) => {
            if (seen.has(el) || !el.classList || !el.classList.contains('modal')) return;
            seen.add(el);
            wasOpen.set(el, isOpen(el));
            new MutationObserver(() => {
                const open = isOpen(el);
                const opened = open && !wasOpen.get(el);
                wasOpen.set(el, open);
                if (!open) unnotify(el);
                if (tools.some((t) => t.win === el)) {
                    if (!open) releaseTool(el);
                    return;
                }
                if (el.classList.contains('hidden')) dismissed.delete(el);
                if (opened) check(el);
            }).observe(el, { attributes: true, attributeFilter: ['class'] });
        };
        Array.from(document.body.children).forEach(observeWin);
        new MutationObserver((muts) => {
            // only windows new to the page: a hosted window put back on body is not a new opening
            for (const m of muts) {
                m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !seen.has(n)) { observeWin(n); check(n); } });
                // a dialog removed from the page (not hosted) needs no notification any more
                m.removedNodes.forEach((n) => { if (behind.has(n)) setTimeout(() => { if (!n.isConnected) unnotify(n); }, 0); });
            }
        }).observe(document.body, { childList: true });
    }

    // ---------------------------------------------------------------- entry points

    function openApp() {
        if (!ws) return;
        if (!isCurrent()) ws.open(APP_ID);
    }

    /** The shell's wait cursor (wmShell.busy) around work the user waits on; not before boot ends. */
    function waitCursor(fn) {
        if (!ws || typeof ws.busy !== 'function' || root.dataset.wmBoot !== 'done') return fn();
        // paint: the cursor is on screen before the desktop Studio's synchronous open blocks the thread
        return ws.busy(fn, { paint: true });
    }

    /** Everything that opens the desktop Studio opens this app (it would otherwise be invisible). */
    function wrapEntryPoints() {
        const orig = window.openManualModalWithContent;
        if (typeof orig === 'function' && !orig._wmStudio) {
            const wrapped = async function (content, event) {
                opening = true;
                // something to edit (a print, a preset, metadata) opens on its prompt
                if (content && typeof content === 'object' && ['image', 'preset', 'metadata'].includes(content.type)) tab = 'prompt';
                try {
                    if (root.dataset.wmBoot === 'done') openApp();
                    // the shell's wait cursor while the print / preset / metadata loads
                    return await waitCursor(() => orig.apply(this, arguments));
                } finally {
                    opening = false;
                    hostStudio();
                    if (isCurrent()) { paintTab(); ws.refreshSoftKeys(); }
                }
            };
            wrapped._wmStudio = true;
            window.openManualModalWithContent = wrapped;
        }
        // loading a print's metadata or a preset into the form (menus, presets, MCP) on Studio's screen
        const load = window.loadIntoManualForm;
        if (typeof load === 'function' && !load._wmStudio) {
            const wrappedLoad = function () {
                const args = arguments;
                if (!isCurrent() && !opening) return load.apply(this, args);
                return waitCursor(() => load.apply(this, args));
            };
            wrappedLoad._wmStudio = true;
            window.loadIntoManualForm = wrappedLoad;
        }
        // the print view's loading overlay (prev / next print, delete, Open in Studio): the desktop draws
        // an image-and-arrows throbber over the print; on the phone the shell's wait cursor stands for
        // it (wm-studio.css hides the throbber; a download's progress bar stays)
        const navLoading = window.showManualPreviewNavigationLoading;
        if (typeof navLoading === 'function' && !navLoading._wmStudio) {
            let release = null;
            const wrappedNav = function (show) {
                const out = navLoading.apply(this, arguments);
                if (show && !release && ws && typeof ws.busy === 'function' && root.dataset.wmBoot === 'done') release = ws.busy(true);
                else if (!show && release) { release(); release = null; }
                return out;
            };
            wrappedNav._wmStudio = true;
            window.showManualPreviewNavigationLoading = wrappedNav;
        }
        // any other route that shows #manualModal (openModal, a restore)
        const m = modal();
        if (m && typeof MutationObserver === 'function') {
            let was = studioOpen();
            new MutationObserver(() => {
                const now = studioOpen();
                if (now === was) return;
                was = now;
                if (now) {
                    hostStudio();
                    if (root.dataset.wmBoot === 'done' && !isCurrent()) openApp();
                } else if (isCurrent()) {
                    // the desktop closed Studio (File > Close): the app closes too
                    releaseAll();
                    ws.back();
                }
            }).observe(m, { attributes: true, attributeFilter: ['class'] });
        }
        const btn = document.getElementById('manualGenerateBtn');
        if (btn && typeof MutationObserver === 'function') {
            new MutationObserver(syncGenerating).observe(btn, { attributes: true, attributeFilter: ['class', 'disabled'] });
        }
        // a character or text overlay added from Menu > Add or the Add row: shown where it lands
        const onAdded = (muts) => {
            paintEmpty();
            if (!shown || shownTab() !== 'prompt' || Date.now() - addAt > 2000) return;
            const added = muts.flatMap((mu) => Array.from(mu.addedNodes)).filter((n) => n.nodeType === 1).pop();
            if (!added) return;
            addAt = 0;
            unfold('chars');
            requestAnimationFrame(() => {
                const sc = formScroller();
                if (!sc) return;
                const r = added.getBoundingClientRect();
                const s = sc.getBoundingClientRect();
                if (r.top < s.top || r.bottom > s.bottom) sc.scrollTop += r.top - s.top - 4;
            });
        };
        ['characterPromptsContainer', 'textOverlaysContainer'].forEach((id) => {
            const el = document.getElementById(id);
            if (el && typeof MutationObserver === 'function') new MutationObserver(onAdded).observe(el, id === 'textOverlaysContainer' ? { childList: true, attributes: true, attributeFilter: ['class'] } : { childList: true });
        });
        const img = document.getElementById('manualPreviewImage');
        if (img && typeof MutationObserver === 'function') new MutationObserver(paintEmpty).observe(img, { attributes: true, attributeFilter: ['class', 'src'] });
        let queued = false;
        const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (shown) paintEmpty(); }); };
        ['transformationRow', 'pipelineStagesSection'].forEach((id) => {
            const el = document.getElementById(id);
            if (el && typeof MutationObserver === 'function') new MutationObserver(later).observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'src'] });
        });
    }

    // ---------------------------------------------------------------- the app icon at dpr 3

    /**
     * The shell's art table (HD_ART, wmShell.js) has no app-studio yet, so its srcset stops at @2x and
     * the icon is scaled up on dpr-3 phones. Until the shell lists it, its images get the @4x art
     * (app-studio@4x.png, app-studio-lg@4x.png) here.
     */
    function hdIcon() {
        const shell = document.getElementById('wmShell');
        if (!shell) return;
        const fix = (scope) => {
            scope.querySelectorAll('img[src*="/app-studio"]').forEach((img) => {
                const m = /\/(app-studio(?:-lg)?)\.png(?:$|\?)/.exec(img.getAttribute('src') || '');
                const set = img.getAttribute('srcset') || '';
                if (!m || / 4x/.test(set)) return;
                img.setAttribute('srcset', `${set ? `${set}, ` : ''}/static_images/wm61/${m[1]}@4x.png 4x`);
            });
        };
        fix(shell);
        if (typeof MutationObserver !== 'function') return;
        new MutationObserver((muts) => {
            for (const mu of muts) mu.addedNodes.forEach((n) => { if (n.nodeType === 1) fix(n.tagName === 'IMG' ? n.parentNode || shell : n); });
        }).observe(shell, { childList: true, subtree: true });
    }

    // ---------------------------------------------------------------- app

    /**
     * The tag autocomplete (body children) wears the WM look while Studio is on screen: wm-studio.css
     * keys it on .wms-ac on the two elements, not on html[data-wm-app] (a descendant rule hanging off
     * the root attribute restyled the whole document on every app switch, Yozora #723).
     */
    function markAutocomplete(on) {
        ['characterAutocompleteOverlay', 'characterAutocompleteViewBar'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('wms-ac', on);
        });
    }

    function mount(p) {
        page = p;
        page.classList.add('wm-studio', 'wms-prepaint');
        page.dataset.tab = tab;
        page.innerHTML = `
            <div class="wms-host"></div>
            <div class="wms-status" hidden><img src="/static_images/app_icons/64/studio.webp" alt=""><span>Studio is starting...</span></div>
            <p class="wms-noprint" hidden>No print yet. Tap Generate.</p>
            <p class="wms-norefs" hidden>No images.<br>Tap Menu, Add, Base Image.</p>
            <div class="wms-wait" aria-hidden="true"></div>
            <div class="wms-tool" hidden><div class="wms-tool-host"></div></div>
            <div class="wm-tabs wms-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" class="wm-tab" role="tab" data-tab="${esc(id)}" aria-selected="${id === tab}">${esc(label)}</button>`).join('')}</div>`;
        page.querySelector('.wms-tabs').addEventListener('click', (e) => {
            const b = e.target.closest('.wm-tab');
            if (b) setTab(b.dataset.tab);
        });
        layout = readLayout();
        watchLayout();
        // a field typed in: on a short page (a landscape phone, keyboard up) the tab strip steps aside
        const typing = (e) => {
            const t = e.target;
            const on = e.type === 'focusin' && !!t && /^(TEXTAREA|INPUT)$/.test(t.tagName) && !!t.closest('#manualModal') && !/^(checkbox|radio|range|button|submit|file|color)$/.test(t.type || '');
            if (page.classList.contains('wms-typing') !== on) page.classList.toggle('wms-typing', on);
        };
        page.addEventListener('focusin', typing);
        page.addEventListener('focusout', typing);
        // the Director button (Studio's docked Director, hidden here) opens the Director app
        page.addEventListener('click', (e) => {
            if (!e.target.closest || !e.target.closest('#directorBtn')) return;
            e.preventDefault();
            e.stopPropagation();
            ws.open('director');
        }, true);
        // the desktop's drop-down lists open as WM drop-downs under their combo
        page.addEventListener('click', (e) => {
            if (proxying || !e.target.closest) return;
            const btn = e.target.closest('.custom-dropdown > button, .custom-dropdown > .custom-dropdown-btn');
            if (!btn || !page.contains(btn)) return;
            setTimeout(() => proxyDropdown(btn), 0);
        }, true);
        // a long press on a prompt field: Chrome on Android raises contextmenu (pointerType touch) before
        // contextMenu.js's own long-press timer confirms the press, so the desktop let the native text
        // menu through and the prompt menu never showed. On the phone the hold opens the prompt's menu
        // (Copy / Cut / Paste are on it) as a WM menu.
        page.addEventListener('contextmenu', (e) => {
            if (!isCurrent() || !e.target.closest || e.pointerType === 'mouse') return;
            const t = e.target.closest('[data-context-menu]');
            if (!t || !page.contains(t) || !/^(TEXTAREA|INPUT)$/.test(t.tagName) || typeof contextMenu === 'undefined' || !contextMenu) return;
            e.preventDefault();
            e.stopPropagation();
            if (contextMenu.touchTimer) { clearTimeout(contextMenu.touchTimer); contextMenu.touchTimer = null; }
            const pop = shellPopup();
            if (pop && !pop.hidden) return; // the timer already opened it
            try { contextMenu.showMenu(e, t, true, true); } catch (err) { console.warn('[wmStudio] prompt menu', err); }
        }, true);
        // a tap on the finished print opens it in the picture view
        page.addEventListener('click', (e) => {
            if (!printOnScreen() || !e.target.closest) return;
            if (!e.target.closest('#manualPreviewImage, .manual-preview-image-container-inner')) return;
            if (!printName()) return;
            e.preventDefault();
            e.stopPropagation();
            viewPrint();
        }, true);
    }

    function softKeys() {
        if (tools.length) {
            const k = toolKeys(tools[tools.length - 1].win);
            return { left: k.left, right: k.right };
        }
        return { left: generateKey(), right: { label: 'Menu', menu: mainMenu } };
    }

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
        ws.registerApp({
            id: APP_ID,
            title: 'Studio',
            icon: 'app-studio',
            inStart: 'top',
            sip: true,
            mount,
            show(p) {
                page = p;
                shown = true;
                markAutocomplete(true);
                patchContextMenu();
                patchDirectorFocus();
                // the desktop form's first style pass on screen is ~400 ms at 4x throttle (Yozora #723):
                // the page left hidden holds it back (hide() sets wms-prepaint, so the shell's own
                // measuring in the tap does not lay it out); the title, tabs and soft keys paint with
                // the wait cursor first, the form right after
                const prepaint = p.classList.contains('wms-prepaint');
                if (prepaint && ws && typeof ws.busy === 'function' && root.dataset.wmBoot === 'done') {
                    syncGenerating();
                    void ws.busy(() => {
                        if (!shown) return null;
                        p.classList.remove('wms-prepaint');
                        return attach();
                    }, { paint: true });
                    return;
                }
                p.classList.remove('wms-prepaint');
                void attach();
                syncGenerating();
            },
            hide() {
                shown = false;
                markAutocomplete(false);
                if (page) page.classList.add('wms-prepaint');
                // open tool pages stay hosted in the hidden page, as they were (switching apps closes nothing)
                const a = document.activeElement;
                if (a && page && page.contains(a) && typeof a.blur === 'function') a.blur();
            },
            softKeys,
            // WM: X on Studio, ok on a tool page (as its Done soft key)
            titleKind: () => (tools.length ? 'ok' : 'close'),
            onTitleOk() {
                if (!tools.length) return false;
                // ok = the page's left soft key (a form's Save, else Done)
                const k = toolKeys(tools[tools.length - 1].win);
                if (k.left && typeof k.left.action === 'function' && !k.left.disabled) k.left.action();
                return true;
            },
            historyDepth() { return tools.length; },
            onBack() {
                if (tools.length) { closeTool(); return true; }
                return false;
            }
        });
        wrapEntryPoints();
        watchWindows();
        wrapOpenModal();
        hdIcon();
        // the shell puts the app title back when the picture view closes: a tool page keeps its own
        if (typeof MutationObserver === 'function') {
            new MutationObserver(() => { if (!root.hasAttribute('data-wm-viewer')) refreshTitle(); })
                .observe(root, { attributes: true, attributeFilter: ['data-wm-viewer'] });
        }
        if (!patchContextMenu()) {
            const t = setInterval(() => { if (patchContextMenu()) clearInterval(t); }, 1000);
            setTimeout(() => clearInterval(t), 60000);
        }
    }

    // shared with wmHost.js (desktop apps hosted as WM apps): the same menu and drop-down proxies
    window.wmStudioKit = {
        wmItemsFromConfig: (config, target, flat) => wmItemsFromConfig(config, target, flat),
        dropLoneHeading: (items) => dropLoneHeading(items),
        proxyDropdown: (btn) => proxyDropdown(btn),
        windowTitle: (win, fallback) => windowTitle(win, fallback),
        armMenuHide: (fn) => armMenuHide(fn),
        menuInContent: (x, y, items) => menuInContent(x, y, items)
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
