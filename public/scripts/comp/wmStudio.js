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
 *   Prompt      base prompt / creative directive / undesired content (the desktop's own toggle),
 *               preset row, Rentan, the token and Anlas row
 *   Characters  character prompts and text overlays (Menu > Add adds them)
 *   Images      base image, director reference, vibe transfers, pipeline stages
 *   Settings    model, steps, guidance, resolution, upscale, sampler, workspace, locks, seed
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
 *               the desktop menu's onHide when they close. The Anlas question is a WM message box.
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
    const TABS = [['prompt', 'Prompt'], ['chars', 'Characters'], ['images', 'Images'], ['settings', 'Settings'], ['print', 'Print']];
    const MENUS = ['File', 'Edit', 'Add', 'Model', 'Image', 'Tools', 'View', 'Help'];
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let ws = null; // window.wmShell
    let page = null;
    let shown = false;
    let tab = 'prompt';
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

    /** The print's progress from the socket (websocket.js progressStates): { phase, pct } or null. */
    function progress() {
        const states = window.wsClient && window.wsClient.progressStates;
        if (!states || typeof states.forEach !== 'function') return null;
        let best = null;
        states.forEach((s) => {
            if (!s) return;
            const pct = Number(s.progress);
            if (!best || (Number.isFinite(pct) && pct > best.pct)) best = { phase: s.phase || '', pct: Number.isFinite(pct) ? pct : 0 };
        });
        return best;
    }

    // ---------------------------------------------------------------- hosting the desktop Studio

    function hostStudio() {
        const m = modal();
        const host = page && page.querySelector('.wms-host');
        if (!m || !host) return false;
        if (m.parentNode !== host) host.appendChild(m);
        return true;
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
        paintTab();
        refreshTitle();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function refreshTitle() {
        if (!ws || !isCurrent() || root.hasAttribute('data-wm-viewer')) return;
        const top = tools[tools.length - 1];
        if (top) { ws.setTitle(top.title); return; }
        // a print running: its progress in the title (Generate stays free to queue another)
        if (generating()) {
            const p = progress();
            ws.setTitle(p && p.pct > 0 && p.pct <= 100 ? `Printing ${Math.round(p.pct)}%` : 'Printing...');
            return;
        }
        ws.setTitle('Studio');
    }

    // ---------------------------------------------------------------- tabs

    function setTab(id) {
        if (!TABS.some(([t]) => t === id)) return;
        tab = id;
        paintTab();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function paintTab() {
        if (!page) return;
        page.dataset.tab = tab;
        page.querySelectorAll('.wms-tabs .wm-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
        // each page starts at its top
        const scroll = page.querySelector('#manualModal .form-section-scroll');
        if (scroll) scroll.scrollTop = 0;
        const ctl = page.querySelector('#manualModal .model-control');
        if (ctl) ctl.scrollTop = 0;
        paintEmpty();
    }

    /** Characters with none yet: WM's empty-list text. */
    function paintEmpty() {
        if (!page) return;
        const empty = page.querySelector('.wms-empty');
        const chars = document.getElementById('characterPromptsContainer');
        const overlays = document.getElementById('textOverlaysContainer');
        const none = !(chars && chars.children.length) && !(overlays && overlays.children.length && !overlays.classList.contains('hidden'));
        empty.hidden = !(tab === 'chars' && none);
        const noprint = page.querySelector('.wms-noprint');
        const img = document.getElementById('manualPreviewImage');
        const hasPrint = !!(img && !img.classList.contains('hidden') && img.getAttribute('src'));
        noprint.hidden = !(tab === 'print' && !hasPrint && !generating());
        // Images: nothing on the page (the desktop keeps its empty containers in the layout)
        const norefs = page.querySelector('.wms-norefs');
        let refs = 0;
        if (tab === 'images') {
            ['transformationRow', 'pipelineStagesSection'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) refs += el.getBoundingClientRect().height;
            });
        }
        norefs.hidden = !(tab === 'images' && refs < 4);
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
            const label = resolve(item.text, target) || resolve(item.tooltip, target) || resolve(item.label, target);
            if (!label) continue; // custom rows (sliders, grids) have no WM counterpart
            const row = { label: String(label).replace(/\s+/g, ' ').trim(), disabled: !!resolve(item.disabled) };
            const sub = Array.isArray(item.submenu) ? item.submenu : null;
            if (sub || typeof item.optionsfn === 'function') {
                row.submenu = () => {
                    let list = sub;
                    if (!list) { try { list = item.optionsfn(target); } catch (_) { list = []; } }
                    return wmItems(list, target, run, item.handlerfn || handlerfn);
                };
            } else if (handlerfn || item.action) {
                const marked = item.showIndicator || item.indicatorMark || item.checked != null;
                if (marked && item.indicatorMark === 'radio') row.radio = !!item.checked;
                else if (marked) row.checked = !!item.checked;
                row.action = () => {
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
        // the preview's own buttons (manualPreviewManager.js)
        items.splice(MENUS.indexOf('Help'), 0, '-',
            { label: 'Previous Print', disabled: !enabled('manualPreviewPrevBtn'), action: () => { clickIf('manualPreviewPrevBtn'); setTab('print'); } },
            { label: 'Next Print', disabled: !enabled('manualPreviewNextBtn'), action: () => { clickIf('manualPreviewNextBtn'); setTab('print'); } },
            { label: 'View Print', disabled: !printName(), action: viewPrint },
            '-');
        return items;
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
            if (!isCurrent() || !target || !page || !page.contains(target)) return open(event, target, trigger, isTouch, isProxyEvent);
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
                ws.dropdown(combo, dropLoneHeading(items), 'left', onHide);
                const pop = shellPopup();
                if (pop && !pop.hidden) pop.style.minWidth = `${Math.round(combo.getBoundingClientRect().width)}px`;
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
        ws.dropdown(box, dropLoneHeading(items), 'left', () => {
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
            && !NOT_TOOLS.has(el.id) && !el.classList.contains('hidden') && !el.classList.contains('hidden-alt')
            && !el.classList.contains('minimised') && !el.classList.contains('closing') && !dismissed.has(el));
    }

    function windowTitle(win) {
        const t = win.querySelector(':scope > .modal-window-title .modal-window-title-main span, :scope > .modal-window-title span, :scope > .modal-window-title')
            || win.querySelector('.credit-cost-header span, .modal-header h3, .modal-header h2, .modal-header .modal-title, [class$="-header"] > span, [class$="-header"] > h3');
        const text = t && t.textContent.replace(/\s+/g, ' ').trim();
        return text || 'Studio';
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
        tools.push({ win, parent: win.parentNode, next: win.nextSibling, title: windowTitle(win) });
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
        const { parent, next } = tools[i];
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
            if (!isCurrent() || !studioOpen()) return;
            // the Director (Image > Ask Wren ...) is its own app (wmDirector.js): its window opening
            // over Studio opens that app (an already open one is brought up by patchDirectorFocus)
            if (el.id === 'directorWindow') {
                openDirectorApp();
                return;
            }
            if (isToolCandidate(el)) hostTool(el);
        };
        const observeWin = (el) => {
            if (seen.has(el) || !el.classList || !el.classList.contains('modal')) return;
            seen.add(el);
            wasOpen.set(el, isOpen(el));
            new MutationObserver(() => {
                const open = isOpen(el);
                const opened = open && !wasOpen.get(el);
                wasOpen.set(el, open);
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
            for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !seen.has(n)) { observeWin(n); check(n); } });
        }).observe(document.body, { childList: true });
    }

    // ---------------------------------------------------------------- entry points

    function openApp() {
        if (!ws) return;
        if (!isCurrent()) ws.open(APP_ID);
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
                    return await orig.apply(this, arguments);
                } finally {
                    opening = false;
                    hostStudio();
                    if (isCurrent()) { paintTab(); ws.refreshSoftKeys(); }
                }
            };
            wrapped._wmStudio = true;
            window.openManualModalWithContent = wrapped;
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
        const chars = document.getElementById('characterPromptsContainer');
        if (chars && typeof MutationObserver === 'function') new MutationObserver(paintEmpty).observe(chars, { childList: true });
        const img = document.getElementById('manualPreviewImage');
        if (img && typeof MutationObserver === 'function') new MutationObserver(paintEmpty).observe(img, { attributes: true, attributeFilter: ['class', 'src'] });
        let queued = false;
        const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; if (shown) paintEmpty(); }); };
        ['transformationRow', 'pipelineStagesSection'].forEach((id) => {
            const el = document.getElementById(id);
            if (el && typeof MutationObserver === 'function') new MutationObserver(later).observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'src'] });
        });
    }

    // ---------------------------------------------------------------- the Anlas question

    /**
     * creditCostDialog.js builds a desktop window and resolves only through its own buttons. On the
     * phone the print's question is a WM message box (Generate resolves true, Cancel false), so
     * nothing is left half-open behind the shell. The upscale form (scale and delivery choices) stays
     * the desktop's, hosted as a tool page whose Done is its Cancel.
     */
    function wrapCreditCost() {
        /* global showCreditCostDialog */
        if (typeof showCreditCostDialog !== 'function' || showCreditCostDialog._wmStudio) return;
        const orig = showCreditCostDialog;
        const wrapped = function (cost, event, outputResolution, isUpscaling) {
            if (isUpscaling || !ws || typeof ws.messageBox !== 'function') return orig.apply(this, arguments);
            let text = `This will cost ${cost} Anlas to generate`;
            if (outputResolution && outputResolution.width && outputResolution.height) text += ` (${outputResolution.width} x ${outputResolution.height})`;
            text += '.';
            return ws.messageBox({
                title: 'Payment Required',
                text,
                icon: 'question',
                buttons: [{ text: 'Generate', value: true, default: true }, { text: 'Cancel', value: false }],
                cancelValue: false
            }).then((v) => v === true);
        };
        wrapped._wmStudio = true;
        window.showCreditCostDialog = wrapped;
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

    function mount(p) {
        page = p;
        page.classList.add('wm-studio');
        page.dataset.tab = tab;
        page.innerHTML = `
            <div class="wms-host"></div>
            <div class="wms-status" hidden><img src="/static_images/app_icons/64/studio.webp" alt=""><span>Studio is starting...</span></div>
            <p class="wms-empty" hidden>No characters.<br>Tap Menu, Add, Character.</p>
            <p class="wms-noprint" hidden>No print yet. Tap Generate.</p>
            <p class="wms-norefs" hidden>No images.<br>Tap Menu, Add, Base Image.</p>
            <div class="wms-wait" aria-hidden="true"></div>
            <div class="wms-tool" hidden><div class="wms-tool-host"></div></div>
            <div class="wm-tabs wms-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" class="wm-tab" role="tab" data-tab="${esc(id)}" aria-selected="${id === tab}">${esc(label)}</button>`).join('')}</div>`;
        page.querySelector('.wms-tabs').addEventListener('click', (e) => {
            const b = e.target.closest('.wm-tab');
            if (b) setTab(b.dataset.tab);
        });
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
        // a tap on the finished print opens it in the picture view
        page.addEventListener('click', (e) => {
            if (tab !== 'print' || !e.target.closest) return;
            if (!e.target.closest('#manualPreviewImage, .manual-preview-image-container-inner')) return;
            if (!printName()) return;
            e.preventDefault();
            e.stopPropagation();
            viewPrint();
        }, true);
    }

    function softKeys() {
        if (tools.length) return { left: { label: 'Done', action: closeTool }, right: null };
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
                patchContextMenu();
                patchDirectorFocus();
                void attach();
                syncGenerating();
            },
            hide() {
                shown = false;
                // open tool pages stay hosted in the hidden page, as they were (switching apps closes nothing)
                const a = document.activeElement;
                if (a && page && page.contains(a) && typeof a.blur === 'function') a.blur();
            },
            softKeys,
            historyDepth() { return tools.length; },
            onBack() {
                if (tools.length) { closeTool(); return true; }
                return false;
            }
        });
        wrapEntryPoints();
        wrapCreditCost();
        watchWindows();
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

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
