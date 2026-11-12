/**
 * Browsing sessions, client half (Yozora #756; server: modules/browsingSessions.js).
 *
 * This page load is one client session on one device. The device id lives in localStorage
 * (dreamscape.deviceId), so it survives restarts; the session id is new on every load. The client
 * says hello on every connect and reports its Internet Explorer windows and tabs when they change:
 *   desktop  every full Grimoire window (tagWikiSearchModal.js grimoireAllWindows) and its tabs (grimoireTabs.js)
 *   phone    every Internet Explorer window (wmBrowser.js; a phone window is one tab)
 * Alchemy tabs are opened with an owner (device, IE window, tab), so the service knows whose page it is.
 *
 * window.browsingSessions:
 *   deviceId() / deviceName() / kind() / sessionId()
 *   owner(windowId, tabId)          the owner block for POST /api/grimoire-browser/sessions
 *   register(fn)                    fn() -> [{ id, title, tabs: [{ id, alchemyId, url, title, history, historyIndex, active }] }]
 *   changed()                       report soon (a window or tab changed)
 *   list() / restore(ids, pick) / discard(ids, keep) / take(sessionId, tabId) / takeBack(alchemyId)
 *   on('ready' | 'changed' | 'tabTaken', fn)
 *   state()                         { settings, restorable, online }
 */
(function (root) {
    'use strict';

    const DEVICE_KEY = 'dreamscape.deviceId';
    const REPORT_DELAY_MS = 800;
    const POLL_MS = 4000;

    const listeners = { ready: [], changed: [], tabTaken: [] };
    const providers = [];
    let sessionIdValue = '';
    let helloOk = false;
    let helloTimer = null;
    let helloTries = 0;
    let reportTimer = null;
    let lastReport = '';
    let st = { settings: null, restorable: 0, online: false };
    let firstReady = true;

    function hex(bytes) {
        const a = new Uint8Array(bytes);
        (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
        return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    function deviceId() {
        let id = '';
        try { id = String(root.localStorage.getItem(DEVICE_KEY) || ''); } catch (_) { /* private mode */ }
        if (!/^[a-f0-9]{16,32}$/.test(id)) {
            id = hex(8);
            try { root.localStorage.setItem(DEVICE_KEY, id); } catch (_) { /* private mode: one id per load */ }
        }
        return id;
    }

    function kind() {
        return root.uiShell === 'mobile' ? 'mobile' : 'desktop';
    }

    /** The name Other Devices shows: the computer name on the desktop (as Device Manager shows it), the phone's owner name on the phone. */
    function deviceName() {
        if (kind() === 'mobile') {
            let owner = '';
            try { owner = (root.wmOwnerInfo && root.wmOwnerInfo.name) || ''; } catch (_) { owner = ''; }
            const model = /Android/i.test(root.navigator.userAgent || '') ? 'Phone' : 'Mobile';
            return (owner ? owner + "'s " : '') + model;
        }
        const n = root.melatonNetworkDialogs && typeof root.melatonNetworkDialogs.connectionInfo === 'function' ? root.melatonNetworkDialogs.connectionInfo() : null;
        const host = (root.location && root.location.hostname) || 'melaton';
        const ua = root.navigator.userAgent || '';
        const os = /Windows/i.test(ua) ? 'PC' : /Mac/i.test(ua) ? 'MAC' : /Linux/i.test(ua) ? 'LINUX' : 'PC';
        // the same domain-HOST name as cplDeviceManager.js, with the machine kind so two computers differ
        return `${(n && n.domain) || 'DREAMSCAPE'}-${os}-${deviceId().slice(0, 4).toUpperCase()}`.slice(0, 24) || host;
    }

    function sessionId() {
        if (!sessionIdValue) sessionIdValue = hex(12);
        return sessionIdValue;
    }

    function owner(windowId, tabId) {
        return {
            deviceId: deviceId(),
            deviceName: deviceName(),
            deviceKind: kind(),
            clientSession: sessionId(),
            windowId: String(windowId || ''),
            tabId: String(tabId || '')
        };
    }

    function on(type, fn) {
        if (listeners[type] && typeof fn === 'function') listeners[type].push(fn);
    }

    function fire(type, data) {
        (listeners[type] || []).forEach((fn) => {
            try { fn(data); } catch (e) { console.warn('browsingSessions:', e); }
        });
    }

    function client() {
        return root.wsClient && typeof root.wsClient.sendMessage === 'function' ? root.wsClient : null;
    }

    function send(type, data) {
        const c = client();
        if (!c) return Promise.reject(new Error('Not connected.'));
        return c.sendMessage(type, data || {}, false).then((res) => {
            const out = res && res.data && typeof res.data === 'object' && res.success === undefined ? res.data : res;
            if (out && out.success === false) {
                const error = new Error(out.error || 'refused');
                error.code = out.code;
                throw error;
            }
            return out || {};
        });
    }

    // ---- reporting ----

    function register(fn) {
        if (typeof fn === 'function' && providers.indexOf(fn) < 0) providers.push(fn);
        changed();
    }

    function snapshot() {
        const windows = [];
        providers.forEach((fn) => {
            try {
                const list = fn();
                if (Array.isArray(list)) windows.push(...list);
            } catch (e) {
                console.warn('browsingSessions: a window list failed', e);
            }
        });
        return windows;
    }

    function report(force) {
        if (!helloOk) return;
        const windows = snapshot();
        const text = JSON.stringify(windows);
        if (!force && text === lastReport) return;
        lastReport = text;
        send('browsing_session_update', { sessionId: sessionId(), windows }).catch(() => { lastReport = ''; });
    }

    function changed() {
        clearTimeout(reportTimer);
        reportTimer = setTimeout(() => report(false), REPORT_DELAY_MS);
    }

    // ---- hello ----

    function scheduleHello(ms) {
        clearTimeout(helloTimer);
        helloTimer = setTimeout(sayHello, ms);
    }

    function sayHello() {
        if (!client()) { scheduleHello(1000); return; }
        send('browsing_session_hello', { sessionId: sessionId(), deviceId: deviceId(), deviceName: deviceName(), deviceKind: kind() }).then((res) => {
            helloOk = true;
            helloTries = 0;
            st.online = true;
            st.settings = res.settings || st.settings;
            st.restorable = Number(res.restorable) || 0;
            lastReport = '';
            report(true);
            fire('ready', { first: firstReady, restorable: st.restorable, settings: st.settings });
            firstReady = false;
        }).catch(() => {
            // not signed in yet, or the socket is still opening
            helloTries += 1;
            scheduleHello(Math.min(15000, 1000 * helloTries));
        });
    }

    function bind() {
        const c = client();
        if (!c || typeof c.on !== 'function') {
            setTimeout(bind, 500);
            return;
        }
        c.on('connected', () => { helloOk = false; helloTries = 0; scheduleHello(700); });
        c.on('disconnected', () => { helloOk = false; st.online = false; });
        c.on('browsing_sessions_changed', () => fire('changed'));
        c.on('browsing_session_tab_taken', (msg) => fire('tabTaken', (msg && (msg.data || msg)) || {}));
        scheduleHello(700);
        setInterval(() => report(false), POLL_MS);
    }

    // ---- requests ----

    function list() {
        return send('browsing_session_list', {}).then((res) => {
            st.settings = res.settings || st.settings;
            st.restorable = (res.restorable || []).length;
            return res;
        });
    }

    function frameSize() {
        const w = Math.max(320, Math.min(1920, Math.round((root.innerWidth || 1280) * 0.9)));
        const h = Math.max(240, Math.min(1440, Math.round((root.innerHeight || 800) * 0.8)));
        return { width: w, height: h };
    }

    function restore(ids, pick) {
        return send('browsing_session_restore', { ids, pick: pick || null, size: frameSize() });
    }

    function discard(ids, keep) {
        return send('browsing_session_discard', { ids, keep: !!keep });
    }

    function take(fromSessionId, tabId, opts) {
        const o = opts || {};
        return send('browsing_session_take', { sessionId: fromSessionId, tabId, windowId: o.windowId || '', newTabId: o.tabId || '', size: o.size || frameSize() });
    }

    function takeBack(alchemyId, opts) {
        const o = opts || {};
        return send('browsing_session_take_back', { alchemyId, windowId: o.windowId || '', newTabId: o.tabId || '', size: o.size || frameSize() });
    }

    // ---- desktop: Grimoire windows ----

    /** A Grimoire tab's address for another device: the address bar's, or its top web entry. */
    function grimoireAddress(shell) {
        const top = shell && shell.history && shell.history[shell.historyIndex];
        if (top && top.type === 'web' && top.url) return top.url;
        const addr = shell && shell._currentAddress;
        return (addr && (addr.fullUrl || addr.displayUrl)) || (top && top.url) || '';
    }

    function grimoireHistory(shell) {
        // web entries and Grimoire pages that carry an address; wiki pages keep only the current address
        return (shell && Array.isArray(shell.history) ? shell.history : []).map((entry) => ({
            type: entry && entry.type === 'web' ? 'web' : 'page',
            url: (entry && (entry.url || (entry.type === 'apocrypha' && entry.url))) || '',
            title: (entry && (entry.title || (entry.tag && (entry.tag.title || entry.tag.name)))) || ''
        }));
    }

    function grimoireWindowsSnapshot() {
        const all = typeof root.grimoireAllWindows === 'function' ? root.grimoireAllWindows() : [];
        const out = [];
        all.forEach((win, n) => {
            if (!win || !win.modal || win.modal.classList.contains('hidden') || win.modal.classList.contains('hidden-alt')) return;
            const winId = (win.modal.dataset && win.modal.dataset.windowIdentifier) || ('grimoire-' + n);
            const tabs = win.tabs ? win.tabs.list() : [{ id: 1, state: null }];
            const rows = [];
            tabs.forEach((tab) => {
                const active = !win.tabs || win.tabs.isActive(tab);
                const shell = active ? win : tab.state;
                // a tab whose page went to another device (grimoireRemoteBrowser.js grimoireShowTransferredPage) is not this client's
                if (!shell || (shell._browsingTransferred && shell.displayArea && shell.displayArea.querySelector(':scope > .grimoire-transferred'))) return;
                const history = grimoireHistory(shell);
                const top = shell.history && shell.history[shell.historyIndex];
                const url = grimoireAddress(shell);
                if (!url && !history.length) return;
                rows.push({
                    id: winId + ':' + tab.id,
                    alchemyId: shell._grimoireRemoteSessionId || '',
                    url,
                    title: shell._grimoireRemoteTitle || (top && top.title) || '',
                    history: history.filter((h) => h.url),
                    historyIndex: Math.max(0, Math.min(history.filter((h) => h.url).length - 1, shell.historyIndex)),
                    active
                });
            });
            if (rows.length) out.push({ id: winId, title: (win.modal.querySelector('.modal-title, .window-title') || {}).textContent || 'Internet Explorer', tabs: rows });
        });
        return out;
    }

    /** The owner of a Grimoire shell's next Alchemy page (grimoireRemoteBrowser.js grimoireOpenRemoteBrowser). */
    function ownerForShell(shell) {
        const win = typeof root.grimoireWindowOf === 'function' ? root.grimoireWindowOf(shell) : null;
        if (!win || !win.modal) return owner('', '');
        const winId = (win.modal.dataset && win.modal.dataset.windowIdentifier) || 'grimoire';
        let tabId = '1';
        if (win.tabs) {
            const bg = win.tabs.backgroundTabOf(shell);
            const tab = bg || win.tabs.active;
            tabId = String(tab && tab.id);
        }
        return owner(winId, winId + ':' + tabId);
    }

    root.browsingSessions = {
        deviceId,
        deviceName,
        kind,
        sessionId,
        owner,
        ownerForShell,
        register,
        changed,
        list,
        restore,
        discard,
        take,
        takeBack,
        on,
        state: () => Object.assign({}, st),
        snapshot,
        grimoireWindowsSnapshot
    };

    if (kind() === 'desktop') register(grimoireWindowsSnapshot);
    if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bind, { once: true });
    else bind();
})(window);
