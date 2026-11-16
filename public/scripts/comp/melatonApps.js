/**
 * Melaton apps, client side (Yozora #638): runs a .msaz from the VFS, or the installed app a VFS
 * file opens with (opens[], e.g. SoraTan.exe), next to its server half (modules/melatonApps/).
 *
 *   melatonApps.launch({ fileId } | { archiveFileId, entryPath } | { packageId }) -> app context
 *   melatonApps.define(id, start)   called by the app's client entry script; start(app) runs per launch
 *   melatonApps.running()           the apps running in this tab
 *   melatonApps.applyPackageUpdate(packageId, { treeHash })   segment swap (#872, below)
 *
 * The client entry is a same-origin script from /melaton-apps/<id or run sha>/ (as the Melaton package
 * plan #179 has it: apps use the desktop's own window shell and kit). start(app) gets:
 *   app.instanceId, app.packageId, app.title, app.version, app.publisher, app.icon, app.launchFile
 *   app.url(rel)                       a file of the package (client/, assets)
 *   app.signal                         aborts when the app ends (listeners, fetches, timers)
 *   app.server.send(data) / app.server.onMessage(fn)   its server half (JSON-safe data)
 *   app.openWindow({ title, width, height, minWidth, resizable }) -> { modal, body, setTitle, close }
 *   app.overlay()                      a chromeless layer on the desktop (SoraTan); the app calls exit
 *   app.tray({ title, icon, onClick, menu })            a notification-area icon
 *   app.onExit(fn) / app.exit()        fn(reason): 'closed', 'exit', 'fault', 'update', ...
 *   app.onBeforeUpdate(fn)             fn() returns a reason (string) to put a live update off until the
 *                                      app ends (recording, unsaved work), or nothing to let it go ahead
 *   app.secureStore                    the phone's encrypted store, namespace app.<id>: get / put / remove
 *                                      text (#874; available false outside the Android app)
 * The app ends when its last window closes (unless it has an overlay or tray icon, which keep it until
 * exit()), on exit(), or when its server half ends. Ending removes its windows, overlay and tray icon,
 * aborts app.signal and sends app_terminate, so the server half stops with it (a service keeps
 * running for its next launch). A server half that crashed or hung, or client code that threw in
 * start(), shows "<app> has stopped working" (programFaults.presentApp).
 *
 * Live updates (Yozora #872): a package's client code runs as a Melaton segment (melatonSegments.js),
 * in a function scope of its own, so it can be unloaded without restarting the page. When the server
 * says a package changed (app_package_updated, or a launch that reports a newer tree), the package is
 * swapped: running instances may put it off (onBeforeUpdate); otherwise their launch specs are kept,
 * they end (onExit 'update', server halves told), the segment is unloaded (its globals, timers,
 * listeners, socket handlers and DOM go; its variables die with its scope), the new code loads and the
 * kept launches start again. A package loaded only for its window-less entry points (ensureLoaded) is
 * loaded again. 'melaton:app-updated' { packageId } is dispatched on document afterwards, so code that
 * kept a reference to a package's global (window.melatonCalendar) drops it.
 *
 * Depends on: melatonSegments.js, websocket.js (wsClient), modalUtils.js (openModal, closeModal, bringModalToFront),
 * contextMenu.js, trayIndicators.js (revealTrayIconElement), programFaults.js
 */
(function (root) {
    'use strict';

    const factories = new Map(); // package base -> start(app)
    const loading = new Map(); // package base -> Promise
    const instances = new Map(); // instanceId -> app
    const loadedPkgs = new Map(); // package base -> { id, treeHash, version, preloaded }
    const pendingSwaps = new Map(); // package base -> { treeHash, reason } (an instance put it off)
    const swapping = new Map(); // package base -> Promise (a swap in progress)

    const segmentKey = (base) => `app:${base}`;

    function wsReady() {
        return root.wsClient && typeof root.wsClient.sendMessage === 'function';
    }

    function errorCode(err) {
        return (err && (err.code || err.details)) || '';
    }

    /** The package root of the script calling define(): /melaton-apps/<root>/ */
    function scriptBase() {
        const src = document.currentScript && document.currentScript.src;
        const m = src && /^(?:https?:\/\/[^/]+)?(\/melaton-apps\/[^/]+\/)/.exec(src);
        return m ? m[1] : null;
    }

    function define(id, start) {
        // a segment (#872) runs from fetched text, without a currentScript: the segment knows its package
        const seg = root.melatonSegments && root.melatonSegments.current();
        const base = (seg && seg.data && seg.data.base) || scriptBase();
        if (!base || typeof start !== 'function') {
            console.error('melatonApps.define: call it from the package client entry with start(app)');
            return;
        }
        factories.set(base, start);
    }

    function loadClient(pkg) {
        if (factories.has(pkg.base)) return Promise.resolve(factories.get(pkg.base));
        if (loading.has(pkg.base)) return loading.get(pkg.base);
        if (root.melatonSegments) return loadSegment(pkg);
        // a system package may ship its own stylesheets (#642); add them once, before the client runs
        for (const href of pkg.styles || []) {
            if (document.querySelector(`link[data-melaton-app-style="${href}"]`)) continue;
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.dataset.melatonAppStyle = href;
            document.head.appendChild(link);
        }
        const p = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = pkg.clientEntry;
            s.async = true;
            s.dataset.melatonApp = pkg.id;
            s.onload = () => {
                const start = factories.get(pkg.base);
                if (start) resolve(start);
                else reject(new Error(`${pkg.title}: the client entry did not call melatonApps.define`));
            };
            s.onerror = () => { s.remove(); reject(new Error(`${pkg.title}: the client entry did not load`)); };
            document.head.appendChild(s);
        });
        loading.set(pkg.base, p);
        p.catch(() => loading.delete(pkg.base));
        return p;
    }

    /** The package's client code as an unloadable segment (#872): styles, then the entry, in its own scope. */
    function loadSegment(pkg) {
        const p = root.melatonSegments.load({
            key: segmentKey(pkg.base),
            label: pkg.title,
            styles: pkg.styles || [],
            scripts: [pkg.clientEntry],
            // any file of the package folder is the package's code (stack attribution)
            urlPrefixes: [pkg.base],
            owns: pkg.owns || [],
            data: { base: pkg.base, id: pkg.id }
        }).then(() => {
            const start = factories.get(pkg.base);
            if (!start) {
                root.melatonSegments.unload(segmentKey(pkg.base), 'no-define');
                throw new Error(`${pkg.title}: the client entry did not call melatonApps.define`);
            }
            loadedPkgs.set(pkg.base, { id: pkg.id, treeHash: pkg.treeHash || '', version: pkg.version || '', preloaded: false });
            return start;
        });
        loading.set(pkg.base, p);
        p.then(() => loading.delete(pkg.base), () => loading.delete(pkg.base));
        return p;
    }

    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    function instancesOf(base) {
        return Array.from(instances.values()).filter((a) => a._base === base);
    }

    /**
     * Swap one loaded package for the server's current tree (#872). Resolves with what happened:
     * { notLoaded } | { deferred: reason } | { swapped, relaunched, released }.
     */
    function swapPackage(base, opts) {
        if (swapping.has(base)) return swapping.get(base);
        const p = (async () => {
            await null; // p is assigned before the body runs (it compares itself with swapping)
            const o = opts || {};
            const info = loadedPkgs.get(base);
            if (!info && !loading.has(base)) {
                factories.delete(base);
                return { notLoaded: true };
            }
            if (loading.has(base)) { try { await loading.get(base); } catch (_) { /* swapped below anyway */ } }
            const running = instancesOf(base);
            if (!o.force) {
                for (const app of running) {
                    for (const fn of app._beforeUpdate) {
                        let why = null;
                        try { why = await fn(); } catch (err) { why = (err && err.message) || 'busy'; }
                        if (why) {
                            pendingSwaps.set(base, { treeHash: o.treeHash || '', reason: o.reason || 'update' });
                            console.info(`[melaton apps] ${app.title}: update waits until it closes (${why})`);
                            return { deferred: String(why) };
                        }
                    }
                }
            }
            pendingSwaps.delete(base);
            const specs = running.map((a) => a._spec);
            // the package's windows on screen: the swap waits for each one's 'closed' (closeModal reports
            // it after its animation). A singleton window (Calculator's desktopCalculatorModal) has the
            // same id in the new version, whose instance would take the old window's late 'closed' as
            // its own and exit.
            const open = root.melatonSegments ? root.melatonSegments.windowsOf(segmentKey(base)).map((m) => m.id).filter(Boolean) : [];
            const closing = open.length ? new Promise((resolve) => {
                const left = new Set(open);
                const ctl = new AbortController();
                const done = () => { ctl.abort(); resolve(); };
                document.addEventListener('staticforge:modal-lifecycle', (e) => {
                    const d = e.detail || {};
                    if (d.type === 'closed' && left.delete(d.id) && !left.size) done();
                }, { signal: ctl.signal });
                setTimeout(done, 1500);
            }) : null;
            for (const app of running) app._endFor('update');
            if (closing) {
                await closing;
                await delay(30);
            }
            const released = root.melatonSegments ? root.melatonSegments.unload(segmentKey(base), o.reason || 'update') : null;
            factories.delete(base);
            loading.delete(base);
            loadedPkgs.delete(base);
            const id = info ? info.id : null;
            // launches from here on load the new code (and must not wait for this swap)
            if (swapping.get(base) === p) swapping.delete(base);
            let relaunched = 0;
            for (const spec of specs) {
                try {
                    await launch(spec);
                    relaunched++;
                } catch (err) {
                    console.error(`[melaton apps] relaunch after update failed`, err);
                }
            }
            if (!specs.length && info && info.preloaded && id) {
                try { await ensureLoaded(id); } catch (err) { console.error(`[melaton apps] ${id} could not load again`, err); }
            }
            try {
                document.dispatchEvent(new CustomEvent('melaton:app-updated', { detail: { packageId: id, base, treeHash: o.treeHash || '' } }));
            } catch (_) { /* no listeners */ }
            return { swapped: true, relaunched, released };
        })();
        swapping.set(base, p);
        const settle = () => { if (swapping.get(base) === p) swapping.delete(base); };
        p.then(settle, settle);
        return p;
    }

    /**
     * app.secureStore (#874): the Android app's encrypted on-phone store (window.AndroidSecureStore,
     * Android Keystore AES-256-GCM, never sent to the server or backed up), under the namespace
     * app.<package id>. available is false outside the Android app (desktop, DeX without it): keep
     * such data in memory then, never in localStorage. get() -> the stored text, null when nothing is
     * stored; throws 'locked' while the phone is locked, else an Error when it cannot be read.
     */
    function secureStoreFor(packageId) {
        const ns = `app.${String(packageId || '').toLowerCase().replace(/[^a-z0-9._-]/g, '-')}`.slice(0, 64);
        const bridge = () => root.AndroidSecureStore || null;
        return {
            namespace: ns,
            get available() { return !!bridge(); },
            get() {
                const b = bridge();
                if (!b) return null;
                const t = String(b.get(ns) || '');
                if (t === '!locked') throw new Error('locked');
                if (t.startsWith('!error')) throw new Error(t.slice(1));
                return t || null;
            },
            put: (text) => { const b = bridge(); return !!(b && b.put(ns, String(text))); },
            remove: () => { const b = bridge(); return !!(b && b.remove(ns)); }
        };
    }

    /** The server changed an installed package (app_package_updated): swap it if this tab runs it. */
    function applyPackageUpdate(packageId, detail) {
        const d = detail || {};
        const base = `/melaton-apps/${packageId}/`;
        const info = loadedPkgs.get(base);
        if (!info && !loading.has(base)) {
            factories.delete(base);
            return Promise.resolve({ notLoaded: true });
        }
        if (info && d.treeHash && info.treeHash && d.treeHash.slice(0, 12) === info.treeHash.slice(0, 12)) {
            return Promise.resolve({ current: true });
        }
        return swapPackage(base, { treeHash: d.treeHash || '', reason: 'update', force: d.force === true });
    }

    /** A launch or describe reported a tree this tab does not run: swap before using it. */
    async function ensureCurrent(pkg) {
        // a launch during a swap's quiesce waits for the new code instead of starting on the old
        if (swapping.has(pkg.base)) { try { await swapping.get(pkg.base); } catch (_) { /* launches anyway */ } }
        const info = loadedPkgs.get(pkg.base);
        if (!info || !pkg.treeHash || !info.treeHash || info.treeHash === pkg.treeHash) return;
        await swapPackage(pkg.base, { treeHash: pkg.treeHash, reason: 'update' });
    }

    function captionButton(className, title, icon) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = className;
        b.title = title;
        const i = document.createElement('i');
        i.className = icon;
        i.setAttribute('aria-hidden', 'true');
        b.appendChild(i);
        return b;
    }

    function createApp(res, spec) {
        const pkg = res.package;
        const ctl = new AbortController();
        const exitFns = [];
        const beforeUpdateFns = [];
        const messageFns = [];
        const windows = new Set();
        let overlay = null;
        let trayIcon = null;
        let ended = false;
        let winSeq = 0;

        const app = {
            instanceId: res.instanceId,
            packageId: pkg.id,
            title: pkg.title,
            version: pkg.version,
            publisher: pkg.publisher,
            icon: pkg.icon || '',
            launchFile: spec.entryPath ? spec.entryPath.split('/').pop() : null,
            // launch-time arguments (not sent to the server): e.g. which mode a built-in app opens in
            args: (spec && spec.args) || {},
            signal: ctl.signal,
            url: (rel) => pkg.base + String(rel || '').replace(/^\/+/, ''),
            server: {
                available: !!res.server,
                send: (data) => {
                    if (!res.server) return Promise.reject(new Error(`${pkg.title} has no server part`));
                    return root.wsClient.sendMessage('app_message', { instanceId: res.instanceId, data }, false);
                },
                onMessage: (fn) => { if (typeof fn === 'function') messageFns.push(fn); }
            },
            // the phone's encrypted store, this package's namespace only (#874; docs/client-api/melaton-apps.md)
            secureStore: secureStoreFor(pkg.id),
            onExit: (fn) => { if (typeof fn === 'function') exitFns.push(fn); },
            onBeforeUpdate: (fn) => { if (typeof fn === 'function') beforeUpdateFns.push(fn); },
            exit: () => end(true),

            openWindow(opts) {
                const o = opts || {};
                const modal = document.createElement('div');
                modal.id = `melatonApp-${res.instanceId}-${++winSeq}`;
                modal.className = `modal${o.resizable === false ? '' : ' resizeable-window'} melaton-app-window hidden`;
                modal.dataset.windowIdentifier = `melatonApp-${pkg.id}`;
                modal.dataset.melatonApp = pkg.id;
                modal.dataset.melatonSegment = segmentKey(pkg.base);
                if (o.width) modal.dataset.windowDefaultWidth = String(o.width);
                if (o.minWidth) modal.dataset.windowMinWidth = String(o.minWidth);
                const title = document.createElement('div');
                title.className = 'modal-window-title';
                const main = document.createElement('div');
                main.className = 'modal-window-title-main';
                // every window carries an image icon (the package's), never a bare glyph
                const img = document.createElement('img');
                img.className = 'icon-image';
                img.alt = '';
                img.src = o.icon || app.icon || '/static_images/vista-icons/application-48.png';
                const text = document.createElement('span');
                text.textContent = o.title || pkg.title;
                main.append(img, text);
                title.appendChild(main);
                const controls = document.createElement('div');
                controls.className = 'modal-window-controls';
                const min = captionButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize');
                const close = captionButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
                controls.append(min, close);
                const content = document.createElement('div');
                content.className = 'modal-content modal-padding';
                const body = document.createElement('div');
                body.className = 'modal-body';
                if (o.height) body.style.height = `${o.height}px`;
                content.appendChild(body);
                const focus = document.createElement('div');
                focus.className = 'modal-focus-overlay';
                modal.append(title, focus, controls, content);
                document.body.appendChild(modal);
                const closeWin = () => { if (typeof root.closeModal === 'function') root.closeModal(modal); };
                close.addEventListener('click', closeWin, { signal: ctl.signal });
                windows.add(modal);
                if (root.programFaults) {
                    root.programFaults.registerProgram(modal.id, {
                        name: pkg.title,
                        terminate: () => end(true),
                        relaunch: () => launch(spec)
                    });
                }
                if (typeof root.openModal === 'function') root.openModal(modal);
                else modal.classList.remove('hidden');
                if (typeof root.bringModalToFront === 'function') root.bringModalToFront(modal);
                return { modal, body, setTitle: (t) => { text.textContent = t; }, close: closeWin };
            },

            overlay() {
                if (overlay) return overlay;
                overlay = document.createElement('div');
                overlay.className = 'melaton-app-overlay';
                overlay.dataset.melatonApp = pkg.id;
                overlay.dataset.melatonSegment = segmentKey(pkg.base);
                const icons = document.getElementById('desktopIcons');
                if (icons && icons.parentNode) icons.parentNode.appendChild(overlay);
                else document.body.appendChild(overlay);
                return overlay;
            },

            tray(opts) {
                const o = opts || {};
                if (trayIcon) return trayIcon;
                const host = document.querySelector('.taskbar-tray-icons');
                if (!host) return null;
                trayIcon = document.createElement('div');
                trayIcon.className = 'taskbar-tray-icon melaton-app-tray-icon hidden';
                trayIcon.dataset.melatonApp = pkg.id;
                trayIcon.dataset.melatonSegment = segmentKey(pkg.base);
                trayIcon.title = o.title || pkg.title;
                const img = document.createElement('img');
                img.src = o.icon || app.icon || '/static_images/vista-icons/application-16.png';
                img.alt = '';
                img.width = 16;
                img.height = 16;
                trayIcon.appendChild(img);
                host.insertBefore(trayIcon, host.firstChild);
                if (typeof o.onClick === 'function') trayIcon.addEventListener('click', o.onClick, { signal: ctl.signal });
                if (o.menu && root.contextMenu) root.contextMenu.attachToElement(trayIcon, o.menu);
                // revealTrayIconElement: public/scripts/comp/trayIndicators.js
                if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(trayIcon);
                else trayIcon.classList.remove('hidden');
                return trayIcon;
            }
        };

        function end(tellServer, why) {
            if (ended) return;
            ended = true;
            instances.delete(res.instanceId);
            for (const fn of exitFns.splice(0)) {
                try { fn(why || 'exit'); } catch (err) { console.error(`${pkg.title}: onExit failed`, err); }
            }
            ctl.abort();
            for (const modal of windows) {
                if (!modal.classList.contains('hidden') && typeof root.closeModal === 'function') root.closeModal(modal);
                setTimeout(() => modal.remove(), 600);
                if (root.programFaults && typeof root.programFaults.unregisterProgram === 'function') root.programFaults.unregisterProgram(modal.id);
            }
            windows.clear();
            if (overlay) overlay.remove();
            if (trayIcon) {
                if (root.contextMenu && root.contextMenu.detachFromElement) root.contextMenu.detachFromElement(trayIcon);
                trayIcon.remove();
                if (typeof root.traySyncOverflow === 'function') root.traySyncOverflow();
            }
            if (tellServer && wsReady()) {
                root.wsClient.sendMessage('app_terminate', { instanceId: res.instanceId }, false).catch(() => {});
            }
            // an update this instance put off runs once the package's last instance has ended (#872)
            if (why !== 'update' && pendingSwaps.has(pkg.base) && !instancesOf(pkg.base).length) {
                const pending = pendingSwaps.get(pkg.base);
                setTimeout(() => { void swapPackage(pkg.base, Object.assign({}, pending, { force: true })); }, 0);
            }
        }

        // the last window closed ends the app, unless an overlay or tray icon keeps it
        document.addEventListener('staticforge:modal-lifecycle', (e) => {
            const d = e.detail || {};
            if (d.type !== 'closed') return;
            const modal = Array.from(windows).find((w) => w.id === d.id);
            if (!modal) return;
            windows.delete(modal);
            setTimeout(() => modal.remove(), 600);
            if (root.programFaults && typeof root.programFaults.unregisterProgram === 'function') root.programFaults.unregisterProgram(modal.id);
            if (!windows.size && !overlay && !trayIcon) end(true, 'closed');
        }, { signal: ctl.signal });

        app._deliver = (data) => {
            for (const fn of messageFns) {
                try { fn(data); } catch (err) { fault(err); }
            }
        };
        app._ended = (detail) => {
            end(false, detail.reason || 'exited');
            if (detail.fault) {
                fault(Object.assign(new Error(`${pkg.title}: the server part ${detail.reason === 'not-responding' ? 'stopped responding' : `exited (${detail.signal || detail.code})`}`), {
                    serverLog: detail.log || []
                }));
            }
        };

        function fault(err) {
            console.error(`${pkg.title} stopped:`, err);
            end(true, 'fault');
            if (root.programFaults && root.programFaults.presentApp) {
                root.programFaults.presentApp({
                    key: pkg.id,
                    name: pkg.title,
                    terminate: () => {},
                    relaunch: () => launch(spec)
                }, {
                    message: err.message || String(err),
                    reason: err.message || String(err),
                    stack: [err.stack || '', ...(err.serverLog || [])].join('\n')
                });
            }
        }
        app._fault = fault;
        app._base = pkg.base;
        app._spec = spec;
        app._beforeUpdate = beforeUpdateFns;
        app._windowCount = () => windows.size;
        app._endFor = (why) => end(true, why);
        return app;
    }

    /** Start an app; resolves with its context once its start(app) ran. */
    async function launch(spec) {
        if (!wsReady()) throw new Error('Not connected');
        const res = await root.wsClient.sendMessage('app_launch', spec || {}, false);
        // the server runs a newer tree of this package than the tab has loaded: swap first (#872)
        await ensureCurrent(res.package);
        const app = createApp(res, spec || {});
        instances.set(res.instanceId, app);
        try {
            const start = await loadClient(res.package);
            await start(app);
        } catch (err) {
            app._fault(err);
            if (err && typeof err === 'object') err.melatonAppFault = true;
            throw err;
        }
        return app;
    }

    /**
     * Load a system package's client code (and its styles) without starting an instance, so its
     * window-less entry points are available (e.g. the Calculator agent get/set, #642). Idempotent.
     */
    async function ensureLoaded(packageId) {
        if (!wsReady()) throw new Error('Not connected');
        const res = await root.wsClient.sendMessage('app_describe', { packageId }, false);
        if (!res || !res.package) throw new Error(`${packageId} is not installed`);
        await ensureCurrent(res.package);
        await loadClient(res.package);
        const info = loadedPkgs.get(res.package.base);
        if (info && !instancesOf(res.package.base).length) info.preloaded = true;
        return res.package;
    }

    /** The installed app that opens a VFS file by its name and size (opens[]), or null. */
    async function openerFor(name, size) {
        if (!wsReady()) return null;
        try {
            const r = await root.wsClient.sendMessage('app_opener', { name, size }, false);
            return r && r.package ? r.package : null;
        } catch (_) {
            return null;
        }
    }

    function running() {
        return Array.from(instances.values()).map((a) => ({ instanceId: a.instanceId, packageId: a.packageId, title: a.title }));
    }

    function wire() {
        if (!root.wsClient || typeof root.wsClient.on !== 'function' || wire.done) return;
        wire.done = true;
        root.wsClient.on('app_message', (msg) => {
            const d = (msg && msg.data) || {};
            const app = instances.get(d.instanceId);
            if (app) app._deliver(d.data);
        });
        // a package changed on the server (#872): swap it if this tab runs it
        root.wsClient.on('app_package_updated', (msg) => {
            const d = (msg && msg.data) || {};
            if (d.packageId) void applyPackageUpdate(String(d.packageId), d);
        });
        root.wsClient.on('app_exited', (msg) => {
            const d = (msg && msg.data) || {};
            const app = instances.get(d.instanceId);
            if (app) app._ended(d);
        });
    }
    wire();
    if (!wire.done) {
        document.addEventListener('DOMContentLoaded', wire, { once: true });
        setTimeout(wire, 0);
    }

    root.melatonApps = {
        launch,
        define,
        ensureLoaded,
        openerFor,
        running,
        errorCode,
        applyPackageUpdate,
        /**
         * The package's own AbortSignal, for package-level code outside start(app) (a listener or a
         * fetch that lives as long as the package, not one launch): aborted when the package is
         * unloaded for an update. Call it while the package's code is being evaluated (top level).
         */
        packageSignal: () => {
            const seg = root.melatonSegments && root.melatonSegments.current();
            return seg ? seg.ctl.signal : new AbortController().signal;
        },
        loadedPackages: () => Array.from(loadedPkgs.entries()).map(([base, i]) => Object.assign({ base }, i)),
        pendingUpdates: () => Array.from(pendingSwaps.keys())
    };
})(window);
