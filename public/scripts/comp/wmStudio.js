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
 *   soft keys   Generate (the desktop's Generate button; disabled with the progress while a print
 *               runs) | Menu: the desktop menu bar's File Edit Add Model Image Tools View Help, built
 *               from the same item builders (studioMenuBarItems / handleStudioMenuBarAction)
 *   tool pages  any desktop window that opens while Studio is on screen (Character Positions, Text
 *               Expanders, Stage Results ...) is moved into a full-screen sub-page with Done; the back
 *               key and Done close it the window's own way. Desktop context menus raised inside Studio
 *               (contextMenu.js) are shown as WM menus.
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
    let tool = null; // { win, parent, next, title } a desktop window hosted as a sub-page
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
        if (!ws || !isCurrent()) return;
        ws.setTitle(tool ? tool.title : 'Studio');
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
        if (!btn || btn.disabled || generating()) return;
        // the desktop's own Generate (its Anlas question is the shell's WM message box)
        btn.click();
        setTimeout(syncGenerating, 50);
    }

    function syncGenerating() {
        const now = generating();
        if (now && !wasGenerating) {
            // the print shows on the Print page while it runs
            if (shown && !tool) setTab('print');
            if (!progressTimer) progressTimer = setInterval(syncGenerating, 500);
        }
        if (!now && progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        wasGenerating = now;
        if (page) { page.classList.toggle('wms-generating', now); paintEmpty(); }
        if (isCurrent() && !tool) ws.refreshSoftKeys();
    }

    function generateKey() {
        if (generating()) {
            const p = progress();
            const pct = p && p.pct > 0 && p.pct <= 100 ? ` ${Math.round(p.pct)}%` : '...';
            return { label: `Printing${pct}`, disabled: true };
        }
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
                if (heading) out.push({ label: String(heading), disabled: true, indent: 0 });
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
    function wmItemsFromConfig(config, target) {
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
            if (section.title) rows = [{ separator: true, text: section.title }, ...rows];
            const items = wmItems(rows, target, run);
            if (!items.length) continue;
            if (out.length) out.push('-');
            out.push(...items);
        }
        return out;
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
            let items = [];
            try { items = wmItemsFromConfig(config, target); } catch (err) { console.warn('[wmStudio] context menu', err); }
            if (!items.length) return undefined;
            let x = 0;
            let y = 0;
            const pt = event && ((event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]) || event);
            if (pt && Number.isFinite(pt.clientX) && (pt.clientX || pt.clientY)) { x = pt.clientX; y = pt.clientY; } else {
                const r = target.getBoundingClientRect();
                x = r.left; y = r.bottom;
            }
            ws.menuAt(x, y, items);
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
                items.push({ label: text, disabled: true });
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
        menu.classList.add('wms-dd-proxied');
        ws.dropdown(btn, items, 'left', () => {
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

    // windows this page closed on its own (a second tool page replaced them): never hosted again
    // while they animate out, or two windows would keep swapping places
    const dismissed = new WeakSet();
    const NOT_TOOLS = new Set(['manualModal', 'galleryWindow', 'confirmationDialog', 'bootMessageBox', 'pinModal', 'agentClientUpdateDialog', 'directorWindow']);

    function isToolCandidate(el) {
        return !!(el && el.nodeType === 1 && el.parentNode === document.body && el.classList.contains('modal')
            && !NOT_TOOLS.has(el.id) && !el.classList.contains('hidden') && !el.classList.contains('hidden-alt')
            && !el.classList.contains('minimised') && !el.classList.contains('closing') && !dismissed.has(el));
    }

    function windowTitle(win) {
        const t = win.querySelector('.modal-window-title-main span, .modal-window-title span, .modal-window-title');
        const text = t && t.textContent.replace(/\s+/g, ' ').trim();
        return text || 'Studio';
    }

    function hostTool(win) {
        if (tool && tool.win === win) return;
        if (tool) {
            // one tool page at a time: the one under it closes its own way
            const prev = tool.win;
            releaseTool(true);
            const close = prev.querySelector('.modal-window-controls .close-btn, .modal-window-controls [id^="close"]');
            if (!prev.classList.contains('hidden')) {
                dismissed.add(prev);
                if (close) close.click();
            }
        }
        const box = page.querySelector('.wms-tool');
        tool = { win, parent: win.parentNode, next: win.nextSibling, title: windowTitle(win) };
        box.querySelector('.wms-tool-host').appendChild(win);
        box.hidden = false;
        page.classList.add('wms-has-tool');
        refreshTitle();
        ws.refreshSoftKeys();
        ws.syncHistory();
    }

    /** The window is back where the desktop keeps it (body); the sub-page closes. */
    function releaseTool(silent) {
        if (!tool) return;
        const { win, parent, next } = tool;
        tool = null;
        try {
            if (next && next.parentNode === parent) parent.insertBefore(win, next);
            else (parent || document.body).appendChild(win);
        } catch (_) { document.body.appendChild(win); }
        if (page) {
            page.querySelector('.wms-tool').hidden = true;
            page.classList.remove('wms-has-tool');
        }
        if (silent) return;
        refreshTitle();
        if (isCurrent()) { ws.refreshSoftKeys(); ws.syncHistory(); }
    }

    /** Done / back: the window's own close button (its code saves or discards as on the desktop). */
    function closeTool() {
        if (!tool) return;
        const win = tool.win;
        const btn = win.querySelector('.modal-window-controls .close-btn, .modal-window-controls [id^="close"], [data-action="close"]');
        if (btn) btn.click();
        else if (typeof window.closeModal === 'function') { try { window.closeModal(win); } catch (_) { /* below */ } }
        // a window that keeps itself open after its close is let go anyway
        setTimeout(() => { if (tool && tool.win === win) { if (!win.classList.contains('hidden')) win.classList.add('hidden'); releaseTool(); } }, 600);
    }

    function watchWindows() {
        if (typeof MutationObserver !== 'function') return;
        const seen = new WeakSet();
        const check = (el) => {
            if (!isCurrent() || !studioOpen()) return;
            // the Director (Image > Ask Wren ...) is its own app (wmDirector.js)
            if (el.id === 'directorWindow') {
                if (!el.classList.contains('hidden') && ws.listApps().some((a) => a.id === 'director')) ws.open('director');
                return;
            }
            if (isToolCandidate(el)) hostTool(el);
        };
        const observeWin = (el) => {
            if (seen.has(el) || !el.classList || !el.classList.contains('modal')) return;
            seen.add(el);
            new MutationObserver(() => {
                if (tool && tool.win === el) {
                    if (el.classList.contains('hidden') || el.classList.contains('minimised')) releaseTool();
                    return;
                }
                if (el.classList.contains('hidden')) dismissed.delete(el);
                check(el);
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
                    if (tool) releaseTool(true);
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
        if (tool) return { left: { label: 'Done', action: closeTool }, right: null };
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
                void attach();
                syncGenerating();
            },
            hide() {
                shown = false;
                if (tool) closeTool();
                const a = document.activeElement;
                if (a && page && page.contains(a) && typeof a.blur === 'function') a.blur();
            },
            softKeys,
            historyDepth() { return tool ? 1 : 0; },
            onBack() {
                if (tool) { closeTool(); return true; }
                return false;
            }
        });
        wrapEntryPoints();
        watchWindows();
        if (!patchContextMenu()) {
            const t = setInterval(() => { if (patchContextMenu()) clearInterval(t); }, 1000);
            setTimeout(() => clearInterval(t), 60000);
        }
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
