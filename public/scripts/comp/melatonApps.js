/**
 * Melaton apps, client side (Yozora #638): runs a .msaz from the VFS, or the installed app a VFS
 * file opens with (opens[], e.g. SoraTan.exe), next to its server half (modules/melatonApps/).
 *
 *   melatonApps.launch({ fileId } | { archiveFileId, entryPath } | { packageId }) -> app context
 *   melatonApps.define(id, start)   called by the app's client entry script; start(app) runs per launch
 *   melatonApps.running()           the apps running in this tab
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
 *   app.onExit(fn) / app.exit()
 * The app ends when its last window closes (unless it has an overlay or tray icon, which keep it until
 * exit()), on exit(), or when its server half ends. Ending removes its windows, overlay and tray icon,
 * aborts app.signal and sends app_terminate, so the server half stops with it (a service keeps
 * running for its next launch). A server half that crashed or hung, or client code that threw in
 * start(), shows "<app> has stopped working" (programFaults.presentApp).
 *
 * Depends on: websocket.js (wsClient), modalUtils.js (openModal, closeModal, bringModalToFront),
 * contextMenu.js, trayIndicators.js (revealTrayIconElement), programFaults.js
 */
(function (root) {
    'use strict';

    const factories = new Map(); // package base -> start(app)
    const loading = new Map(); // package base -> Promise
    const instances = new Map(); // instanceId -> app

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
        const base = scriptBase();
        if (!base || typeof start !== 'function') {
            console.error('melatonApps.define: call it from the package client entry with start(app)');
            return;
        }
        factories.set(base, start);
    }

    function loadClient(pkg) {
        if (factories.has(pkg.base)) return Promise.resolve(factories.get(pkg.base));
        if (loading.has(pkg.base)) return loading.get(pkg.base);
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
            onExit: (fn) => { if (typeof fn === 'function') exitFns.push(fn); },
            exit: () => end(true),

            openWindow(opts) {
                const o = opts || {};
                const modal = document.createElement('div');
                modal.id = `melatonApp-${res.instanceId}-${++winSeq}`;
                modal.className = `modal${o.resizable === false ? '' : ' resizeable-window'} melaton-app-window hidden`;
                modal.dataset.windowIdentifier = `melatonApp-${pkg.id}`;
                modal.dataset.melatonApp = pkg.id;
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
        }

        // the last window closed ends the app, unless an overlay or tray icon keeps it
        document.addEventListener('staticforge:modal-lifecycle', (e) => {
            const d = e.detail || {};
            if (d.type !== 'closed') return;
            const modal = Array.from(windows).find((w) => w.id === d.id);
            if (!modal) return;
            windows.delete(modal);
            setTimeout(() => modal.remove(), 600);
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
        return app;
    }

    /** Start an app; resolves with its context once its start(app) ran. */
    async function launch(spec) {
        if (!wsReady()) throw new Error('Not connected');
        const res = await root.wsClient.sendMessage('app_launch', spec || {}, false);
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

    root.melatonApps = { launch, define, openerFor, running, errorCode };
})(window);
