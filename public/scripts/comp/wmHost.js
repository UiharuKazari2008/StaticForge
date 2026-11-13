/**
 * Melaton Mobile: desktop programs as WM apps (Yozora #732, parent #709).
 *
 * A Dreamscape desktop app with no phone version of its own (Spellcaster, Reference, Phasewalker,
 * Atelier, Chat, Remote Desktop, Teleport, the Toolbox programs ...) runs its desktop code unchanged;
 * this file puts its window on the phone as a full-screen WM app, the way wmStudio.js hosts Studio's
 * tool windows:
 *
 *   app         each program is its own shell app ('host:<launchId or window id>'), registered when it
 *               first opens: its window's caption is the WM title, X goes back (the program keeps
 *               running, WM's Smart Minimize), Menu > Close closes it the window's own way.
 *   page        the window is moved into the app's page; wm-host.css drops the frame, the shared WM
 *               form look (wm-studio-tools.css) restyles its content. A window opened from it (its
 *               data-parent-modal-id, or any window that opens while it is on screen) stacks over it
 *               as a sub-page with ok / Done; back and ok close the top one its own way.
 *   soft keys   a form (a primary button with Cancel / Save ...): left = its primary button, Menu = the
 *               other footer buttons and Cancel. Otherwise left = Done (back), Menu = the footer buttons
 *               and Close. Every row presses the desktop button.
 *   menus       desktop context menus, click menus and combos inside a hosted window are WM menus and
 *               drop-downs (wmStudio.js's proxy, window.wmStudioKit).
 *   entry       Programs launches a desktop app through launch() (its Start menu action under the wait
 *               cursor). Any other desktop window that opens outside Studio (an MCP action, a link in
 *               an app, a notification) is routed here by wmStudio.js routeWindow -> take(): after a tap
 *               it comes to the front; with no tap it waits behind with a WM notification (Show).
 *
 * Only on phones: does nothing unless window.uiShell is 'mobile'. Styles: public/css/wm-host.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const root = document.documentElement;
    const PREFIX = 'host:';
    const NOT_HOSTED = new Set(['manualModal', 'galleryWindow', 'confirmationDialog', 'bootMessageBox', 'pinModal', 'agentClientUpdateDialog', 'directorWindow']);
    const LOOSE_FOOTER = '.modal-content > button.tbp-button.rdc-foot, .modal-content > button[data-dialog-footer]';
    const FOOTERS = '.modal-footer, .modal-footer-colored, .modal-actions, .dialog-buttons, .dialog-footer, .vista-dialog-buttons, .wizard-buttons';

    let ws = null; // window.wmShell
    const hosts = new Map(); // appId -> { id, title, icon, page, stack: [entry] }
    const byWin = new WeakMap(); // window -> its host
    const dismissed = new WeakSet(); // windows closing (Done / back): not hosted again while they animate out
    let lastTapAt = -1e9;
    let pendingLaunch = null; // { key, title, icon, at } a Programs launch waiting for its window
    let launched = false; // hostFor just matched a window to pendingLaunch

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const kit = () => window.wmStudioKit || null;
    const isOpen = (el) => !el.classList.contains('hidden') && !el.classList.contains('hidden-alt') && !el.classList.contains('minimised') && !el.classList.contains('closing');

    function candidate(el) {
        return !!(el && el.nodeType === 1 && el.parentNode === document.body && el.classList.contains('modal')
            && !NOT_HOSTED.has(el.id) && !(window.wmDialogs && window.wmDialogs.claims(el)) && isOpen(el) && !dismissed.has(el));
    }

    function windowTitle(win, fallback) {
        const k = kit();
        if (k) return k.windowTitle(win, fallback);
        const t = win.querySelector('.modal-window-title-main span, .modal-window-title-main, .modal-header h3');
        return (t && t.textContent.replace(/\s+/g, ' ').trim()) || fallback;
    }

    /** The window's own title-bar icon (image or FA glyph) as a picture for the notification, else none. */
    function windowIconSrc(win) {
        const img = win.querySelector(':scope > .modal-window-title img');
        return img && img.getAttribute('src') ? img.getAttribute('src') : '';
    }

    // ---------------------------------------------------------------- soft keys

    function footerButtons(win) {
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
        // Vista property-sheet dialogs (tbp-*) place their footer buttons loose in the content
        win.querySelectorAll(LOOSE_FOOTER).forEach((b) => {
            // (hidden by wm-host.css as soft keys: only the desktop's own hiding counts)
            if (seen.has(b) || b.closest('.modal') !== win || b.hidden || b.classList.contains('hidden') || b.style.display === 'none') return;
            const label = (b.textContent || '').replace(/\s+/g, ' ').trim();
            if (!label) return;
            seen.add(b);
            out.push({ b, label });
        });
        return out;
    }

    // ---------------------------------------------------------------- windows given a WM form

    /**
     * A picture's metadata Properties (imagePromptInspector.js: Glancewell's File > Properties,
     * Studio's View Image Data, Explorer's Properties of a print) as a WM property page: "Properties"
     * in the title bar (the file name is on the page), the command bar's Copy / Edit / Open /
     * Metadata / Find and the Computed toggle in the Menu soft key, Prompt / Director / UC as WM's
     * tabs along the bottom (the desktop's own tab buttons, given .wm-tab), one page that scrolls
     * (wm-host.css [data-wmh-form="inspector"]).
     */
    function adaptWindow(win) {
        const content = win.querySelector(':scope > .image-prompt-inspector-content');
        if (!content || win.dataset.wmhForm) return;
        win.dataset.wmhForm = 'inspector';
        win.dataset.wmhTitle = 'Properties';
        const tabs = content.querySelector(':scope > .explorer-actions-header > [role="tablist"]');
        if (tabs) {
            tabs.classList.add('wm-tabs', 'wmh-tabs');
            tabs.querySelectorAll('[role="tab"]').forEach((b) => b.classList.add('wm-tab'));
            // the Computed toggle is no tab: it stays with the command bar (a Menu row)
            const lane = tabs.querySelector('[id^="imagePromptInspectorLaneToggle"]');
            const bar = content.querySelector(':scope > .explorer-actions-header > .explorer-command-set:not([role="tablist"])');
            if (lane && bar) bar.appendChild(lane);
            content.appendChild(tabs);
        }
    }

    /** The inspector object behind an image Properties window (imagePromptInspector.js), or null. */
    function inspectorOf(win) {
        try {
            // eslint-disable-next-line no-undef
            const m = typeof imagePromptInspectorManager !== 'undefined' ? imagePromptInspectorManager : null;
            return (m && m.instances && m.instances.get(win.id)) || null;
        } catch (_) { return null; }
    }

    /** Menu rows for a window's own command bar (adaptWindow), before its footer's. */
    function commandRows(win, press) {
        if (win.dataset.wmhForm !== 'inspector') return [];
        const rows = [];
        const bar = win.querySelector('.image-prompt-inspector-content > .explorer-actions-header:not(.image-prompt-inspector-findbar) > .explorer-command-set:not([role="tablist"])');
        if (bar) {
            bar.querySelectorAll(':scope > button').forEach((b) => {
                if (b.hidden || b.classList.contains('hidden') || b.id.startsWith('imagePromptInspectorLaneToggle')) return;
                const text = (b.textContent || '').replace(/\s+/g, ' ').trim() || b.title || '';
                if (!text) return;
                // Copy's click menu (contextMenu.js on the desktop) is a WM submenu of the same rows,
                // each run by the inspector itself (imagePromptInspector.js runAction)
                const inst = b.classList.contains('has-menu') ? inspectorOf(win) : null;
                if (inst && typeof inst.copyMenuItems === 'function') {
                    rows.push({
                        label: text,
                        submenu: () => inst.copyMenuItems('').map((it) => (it.separator ? '-' : {
                            label: it.text, disabled: !!it.disabled, action: () => { inst.runAction(it.action); }
                        }))
                    });
                    return;
                }
                // the device's wording: a command that opens a page ends with ...
                const more = /^(find|metadata)$/i.test(text) ? '...' : '';
                rows.push({ label: text + more, disabled: !!b.disabled, action: press({ b }) });
            });
        }
        const lane = win.querySelector('[id^="imagePromptInspectorLaneToggle"]');
        if (lane && !lane.classList.contains('hidden')) {
            if (rows.length) rows.push('-');
            rows.push({ label: 'Computed Prompt', checked: lane.getAttribute('aria-pressed') === 'true', action: press({ b: lane }) });
        }
        return rows;
    }

    function keysFor(host) {
        const top = host.stack[host.stack.length - 1];
        if (!top) return { left: null, right: null, rows: [] };
        const win = top.win;
        const btns = footerButtons(win);
        const cancel = btns.find((x) => /^(cancel|close)$/i.test(x.label));
        const prim = btns.filter((x) => x !== cancel && (x.b.classList.contains('btn-primary') || x.b.classList.contains('primary') || x.b.classList.contains('is-default') || x.b.dataset.dialogPrimary === '1')).pop()
            // a dialog with Cancel whose default button is unmarked (Connect, OK ...): the first action button
            || (cancel && btns.find((x) => x !== cancel && /^(ok|save|connect|apply|send|create|add|import|start|run|next|finish|done|open|yes)\b/i.test(x.label)));
        const form = !!(prim && (cancel || /^(save|ok|apply|update|write|create|add|connect|send|import|start|run|next|finish|done)/i.test(prim.label)));
        const press = (x) => () => { if (!x.b.disabled) { x.b.click(); later(host); } };
        const sub = host.stack.length > 1;
        const left = form
            ? { label: prim.label.length > 14 ? prim.label.split(' ')[0] : prim.label, disabled: prim.b.disabled, action: press(prim) }
            : { label: sub ? 'Done' : 'Back', action: () => (sub ? closeTop(host) : ws.back()) };
        const cmds = commandRows(win, press);
        const foot = btns.filter((x) => x !== cancel && !(form && x === prim))
            .map((x) => ({ label: x.label, disabled: !!x.b.disabled, action: press(x) }));
        const rows = cmds.length && foot.length ? [...cmds, '-', ...foot] : [...cmds, ...foot];
        if (rows.length) rows.push('-');
        if (form) rows.push({ label: cancel ? cancel.label : 'Cancel', action: () => closeTop(host) });
        // (a window given a WM form names itself on the page: plain Close, or the menu ran off screen)
        else rows.push({ label: sub || win.dataset.wmhForm ? 'Close' : `Close ${host.title}`, action: () => closeTop(host) });
        return { left, right: { label: 'Menu', menu: () => keysFor(host).rows }, rows, form, prim };
    }

    function later(host) {
        setTimeout(() => {
            if (ws.current !== host.id) return;
            refreshTitle(host);
            ws.refreshSoftKeys();
            ws.syncHistory();
        }, 60);
    }

    function refreshTitle(host) {
        const top = host.stack[host.stack.length - 1];
        const t = top ? (top.win.dataset.wmhTitle || windowTitle(top.win, host.title)) : host.title;
        if (ws.current === host.id && !root.hasAttribute('data-wm-viewer')) ws.setTitle(t);
    }

    // ---------------------------------------------------------------- hosting

    function setUnder(host) {
        host.stack.forEach((e, i) => {
            if (i === host.stack.length - 1) e.win.removeAttribute('data-wmh-under');
            else e.win.setAttribute('data-wmh-under', '');
        });
    }

    function ensureHost(id, title, icon) {
        const appId = PREFIX + id;
        let host = hosts.get(appId);
        if (host) {
            if (title) host.title = title;
            return host;
        }
        host = { id: appId, title: title || 'Program', icon: icon || '', page: null, stack: [] };
        hosts.set(appId, host);
        ws.registerApp({
            id: appId,
            title: host.title,
            icon: 'app-programs',
            inStart: false,
            sip: true,
            mount(p) {
                host.page = p;
                p.classList.add('wm-host');
                p.innerHTML = '<div class="wmh-host"></div><div class="wmh-empty" hidden></div>';
                // the desktop's drop-down lists open as WM drop-downs under their combo
                p.addEventListener('click', (e) => {
                    if (!e.target.closest) return;
                    const btn = e.target.closest('.custom-dropdown > button, .custom-dropdown > .custom-dropdown-btn');
                    const k = kit();
                    if (btn && k && p.contains(btn)) setTimeout(() => k.proxyDropdown(btn), 0);
                }, true);
            },
            show() {
                if (!host.stack.length) {
                    // nothing left to show (closed behind the user's back): back to what was under it
                    setTimeout(() => { if (ws.current === host.id && !host.stack.length) ws.back({ app: true }); }, 0);
                    return;
                }
                refreshTitle(host);
            },
            softKeys() {
                const k = keysFor(host);
                return { left: k.left, right: k.right };
            },
            titleKind: () => (host.stack.length > 1 ? 'ok' : 'close'),
            // X closes the program: every window it has open, each its own way
            onTitleClose() {
                for (let i = host.stack.length - 1; i >= 0; i--) closeTop(host);
            },
            onTitleOk() {
                if (host.stack.length < 2) return false;
                const k = keysFor(host);
                if (k.left && typeof k.left.action === 'function' && !k.left.disabled) k.left.action();
                return true;
            },
            historyDepth: () => Math.max(0, host.stack.length - 1),
            onBack() {
                if (host.stack.length > 1) { closeTop(host); return true; }
                return false;
            }
        });
        return host;
    }

    function host(win, host, foreground) {
        if (byWin.has(win)) return byWin.get(win);
        const page = host.page || ws.pageOf(host.id);
        const entry = { win, parent: win.parentNode, next: win.nextSibling, mo: null };
        host.stack.push(entry);
        byWin.set(win, host);
        adaptWindow(win);
        let queued = false;
        entry.mo = new MutationObserver(() => {
            if (!isOpen(win)) { release(win); return; }
            if (queued) return;
            queued = true;
            setTimeout(() => {
                queued = false;
                if (ws.current !== host.id || host.stack[host.stack.length - 1] !== entry) return;
                refreshTitle(host);
                ws.refreshSoftKeys();
            }, 50);
        });
        entry.mo.observe(win, { attributes: true, attributeFilter: ['class'] });
        const watch = [win.querySelector(':scope > .modal-window-title'), ...win.querySelectorAll(FOOTERS)].filter(Boolean);
        watch.forEach((el) => entry.mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'class', 'hidden'] }));
        page.querySelector('.wmh-host').appendChild(win);
        setUnder(host);
        if (foreground) {
            if (ws.current !== host.id) ws.open(host.id);
            else { refreshTitle(host); ws.refreshSoftKeys(); ws.syncHistory(); }
        } else if (ws.current === host.id) {
            refreshTitle(host);
            ws.refreshSoftKeys();
        } else {
            notifyBehind(host, win);
        }
        return host;
    }

    /** The window closed (or Close): back on body where the desktop keeps it; the page under it shows. */
    function release(win) {
        const h = byWin.get(win);
        if (!h) return;
        const i = h.stack.findIndex((e) => e.win === win);
        byWin.delete(win);
        if (i < 0) return;
        const { parent, next, mo } = h.stack[i];
        if (mo) mo.disconnect();
        h.stack.splice(i, 1);
        win.removeAttribute('data-wmh-under');
        try {
            if (next && next.parentNode === parent) parent.insertBefore(win, next);
            else (parent && parent.isConnected ? parent : document.body).appendChild(win);
        } catch (_) { document.body.appendChild(win); }
        setUnder(h);
        if (ws.current !== h.id) return;
        if (!h.stack.length) { ws.back({ app: true }); return; }
        refreshTitle(h);
        ws.refreshSoftKeys();
        ws.syncHistory({ noPush: true });
    }

    /** Close the top window its own way (its close button, else Cancel), so its code saves or discards. */
    function closeTop(h) {
        const top = h.stack[h.stack.length - 1];
        if (!top) return;
        const win = top.win;
        dismissed.add(win);
        const btn = win.querySelector(':scope > .modal-window-controls .close-btn, :scope > .modal-window-controls [id^="close"], :scope > .modal-window-title .close-btn, [data-action="close"]')
            || win.querySelector('[data-dialog-cancel], [data-action="cancel"]')
            || Array.from(win.querySelectorAll('button')).find((b) => /^\s*(cancel|close)\s*$/i.test(b.textContent || ''));
        if (btn) btn.click();
        else if (typeof window.closeModal === 'function') { try { window.closeModal(win); } catch (_) { /* below */ } }
        // a window that keeps itself open after its close is let go anyway (closeModal's fallback is
        // 600 ms), unless it is asking (its own "save changes?" dialog): then its answer decides
        const asking = () => { const d = document.getElementById('confirmationDialog'); return !!(d && !d.classList.contains('hidden')); };
        setTimeout(() => {
            if (!byWin.has(win) || asking()) return;
            if (!win.classList.contains('hidden')) win.classList.add('hidden');
            release(win);
        }, 1000);
        setTimeout(() => dismissed.delete(win), 1500);
    }

    // ---------------------------------------------------------------- notifications

    const behind = new Map(); // win -> toast id

    function notifyBehind(h, win) {
        if (root.dataset.wmBoot !== 'done' || typeof window.showGlassToast !== 'function') return;
        const old = behind.get(win);
        if (old && typeof window.removeGlassToast === 'function') window.removeGlassToast(old);
        const id = window.showGlassToast('info', esc(windowTitle(win, h.title)), 'Opened in the background.', false, false, null,
            [{ text: 'Show', onClick: () => { behind.delete(win); if (byWin.get(win) === h) ws.open(h.id); } }]);
        if (id) behind.set(win, id);
    }

    function unnotify(win) {
        const id = behind.get(win);
        if (!id) return;
        behind.delete(win);
        try { if (typeof window.removeGlassToast === 'function') window.removeGlassToast(id); } catch (_) { /* gone */ }
    }

    // ---------------------------------------------------------------- routing

    /** Which program a newly opened window belongs to: its parent's, the launch it answers, or its own. */
    function hostFor(win) {
        const parentId = win.dataset.parentModalId;
        if (parentId) {
            const parent = document.getElementById(parentId);
            if (parent && byWin.has(parent)) return byWin.get(parent);
        }
        if (pendingLaunch && Date.now() - pendingLaunch.at < 15000) {
            const l = pendingLaunch;
            pendingLaunch = null;
            launched = true;
            return ensureHost(l.key, l.title, l.icon);
        }
        // a window opening while a hosted program is on screen (its dialogs, pickers) stacks over it
        const cur = ws.current && hosts.get(ws.current);
        if (cur && cur.stack.length && tapped()) return cur;
        return ensureHost(win.id || `w${Date.now()}`, windowTitle(win, 'Program'), windowIconSrc(win));
    }

    /** wmStudio.js routeWindow: a desktop window opened outside Studio. true = hosted here. */
    function take(win) {
        if (!ws || !candidate(win) || root.dataset.wmBoot !== 'done') return false;
        if (byWin.has(win)) {
            // asked for again while open: its program comes up
            const h = byWin.get(win);
            if (tapped()) { unnotify(win); ws.open(h.id); }
            return true;
        }
        launched = false;
        const h = hostFor(win);
        // after a tap, or the window a Programs launch was waiting for: to the front
        host(win, h, launched || tapped());
        return true;
    }

    /** Windows left open on body (opened before boot ended, or by a route nobody watched). */
    function sweep() {
        if (!ws || root.dataset.wmBoot !== 'done' || ws.current === 'studio') return;
        for (const el of Array.from(document.body.children)) {
            if (candidate(el) && !byWin.has(el)) take(el);
        }
    }

    /**
     * Programs: start a desktop app (its Start menu action, under the wait cursor). Its window is
     * hosted as it opens; if none opens, the user is told so instead of waiting on nothing.
     */
    async function launch(l) {
        if (!l || typeof l.action !== 'function') return false;
        const key = l.launchId || l.text;
        const existing = hosts.get(PREFIX + key);
        if (existing && existing.stack.length) { ws.open(existing.id); return true; }
        const from = ws.current;
        pendingLaunch = { key, title: l.text, icon: l.imageIcon || '', at: Date.now() };
        const box = document.getElementById('toastContainer');
        const toastsBefore = box ? box.children.length : 0;
        lastTapAt = Date.now();
        try {
            await ws.busy(() => l.action(), { paint: true, timeout: 20000 });
        } catch (err) {
            console.warn('[wmHost] launch', key, err);
        }
        // the window may open a moment after the action returns (features load, data arrive)
        const started = Date.now();
        await ws.busy(new Promise((resolve) => {
            const tick = () => {
                sweep();
                const h = hosts.get(PREFIX + key);
                // done: its window is hosted, or the program opened a phone app of its own (IE for a
                // dsap: page, Studio ...), or nothing came
                const ownApp = ws.current !== from && !String(ws.current || '').startsWith(PREFIX);
                if ((h && h.stack.length) || ownApp || !pendingLaunch || Date.now() - started > 4000) { resolve(); return; }
                setTimeout(tick, 150);
            };
            tick();
        }), { delay: 0, timeout: 6000 });
        const h = hosts.get(PREFIX + key);
        if (h && h.stack.length) {
            if (ws.current !== h.id) ws.open(h.id);
            return true;
        }
        if (pendingLaunch && pendingLaunch.key === key) pendingLaunch = null;
        if (ws.current !== from && !String(ws.current || '').startsWith(PREFIX)) return true;
        // the program opened a WM app of its own (Studio, Director, Internet Explorer ...), or nothing
        // (unless the program told the user why itself: Access Denied, Desktop mode required ...)
        const boxNow = document.getElementById('toastContainer');
        const told = !!(boxNow && boxNow.children.length > toastsBefore);
        if (!told && (ws.current === 'programs' || ws.current === 'today')) {
            ws.notify({ title: l.text, icon: 'warning', text: `${l.text} could not be opened on this device.` });
        }
        return false;
    }

    /**
     * Did the user ask for the window now opening? A tap in the last 3 s, or a tap that started a
     * download of the desktop code the window needs (featureLoader.loadFeature: the image
     * Properties' bundle, Paint ...) and that download ended under 3 s ago. A slow first load on a
     * phone opened the window after the 3 s and it was taken for one opened by an agent ("Opened
     * in the background" for the Properties the user had just tapped).
     */
    let tapLoads = 0; // feature downloads a tap started, still running
    let tapLoadEnd = -1e9;
    function tapped() {
        const now = Date.now();
        return now - lastTapAt < 3000 || tapLoads > 0 || now - tapLoadEnd < 3000;
    }

    function watchTapLoads() {
        const fl = window.featureLoader;
        if (!fl || typeof fl.loadFeature !== 'function' || fl.loadFeature.wmhWrapped) return;
        const load = fl.loadFeature;
        const wrapped = function (...args) {
            const p = load.apply(this, args);
            if (Date.now() - lastTapAt >= 3000 && tapLoads === 0) return p;
            tapLoads++;
            let ended = false;
            const done = () => {
                if (ended) return;
                ended = true;
                clearTimeout(cap);
                tapLoads = Math.max(0, tapLoads - 1);
                tapLoadEnd = Date.now();
            };
            // at most 20 s: a download that never ends does not make every later window "asked for"
            const cap = setTimeout(done, 20000);
            Promise.resolve(p).then(done, done);
            return p;
        };
        wrapped.wmhWrapped = true;
        fl.loadFeature = wrapped;
    }

    function register() {
        ws = window.wmShell;
        // (featureLoader may come after this file: wrapped at the first tap, before its handlers run)
        document.addEventListener('click', (e) => { if (e.isTrusted) { lastTapAt = Date.now(); watchTapLoads(); } }, true);
        watchTapLoads();
        // not while the screen is off (#798: the ticks share the renderer with a DeX window); a pass at screen on
        setInterval(() => { if (document.documentElement.dataset.screenOff === undefined) sweep(); }, 1500);
        window.addEventListener('melatonscreen', (e) => { if (e.detail && e.detail.on) sweep(); });
        setInterval(() => { for (const w of behind.keys()) if (!isOpen(w) || !w.isConnected) unnotify(w); }, 2000);
    }

    window.wmHost = {
        take,
        launch,
        /** Whether an element is inside a hosted program's page (menus there are WM menus). */
        owns: (el) => {
            if (!el || !el.closest) return false;
            const page = el.closest('.wm-page.wm-host');
            return !!(page && ws && ws.current === page.dataset.app);
        },
        /** Give a desktop window its WM form, if it has one (wmStudio.js tool pages share it). */
        adapt: (win) => adaptWindow(win),
        /** Menu rows for an adapted window's command bar; press({ b }) presses a desktop button. */
        commandRows: (win, press) => commandRows(win, press),
        /** Whether a window is hosted here. */
        hosts: (win) => byWin.has(win),
        /** Hosted programs: [{ id, title, windows }]. */
        list: () => [...hosts.values()].filter((h) => h.stack.length).map((h) => ({ id: h.id, title: h.title, windows: h.stack.length }))
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
