/**
 * ActiveSync peer (Yozora #747): this tab's end of modules/activeSync.js. Protocol:
 * docs/activesync-protocol.md.
 *
 * A tab inside the Dreamscape app for Android is a "device"; a desktop tab is a "computer"; a phone
 * browser without the app, and an agent tab, are neither (activeSync.kind === null, everything is a
 * no-op). The peer says as_hello on every connect, answers the other side's requests through the
 * operations registered here, and keeps the list of devices and computers.
 *
 *   activeSync.kind                    'device' | 'computer' | null
 *   activeSync.state()                 { kind, id, name, online, session, permissions, devices, computers }
 *   activeSync.on(event, fn)           'state' (anything in state() changed), 'event' ({ from, event, detail }),
 *                                      'request' ({ from, op }) ; returns an off()
 *   activeSync.registerOp(name, fn)    fn(args, from) -> result (or a promise); throw { code, message }
 *   activeSync.call(to, op, args, { timeoutMs, queue })   the other side's result; rejects { code, message }
 *   activeSync.emit(event, detail)     news for the other kind (as_event)
 *   activeSync.propose(deviceId, mode, { name, syncItems })   'partner' | 'guest'; { accepted, device }
 *   activeSync.update(deviceId, changes) / endPartnership(deviceId) / forget(deviceId) / log(deviceId)
 *   activeSync.device(id)              a device from the list
 *
 * Device side: reports its status (battery, Wi-Fi, cellular, storage) on change, asks the user when a
 * computer proposes a connection or a partnership, and serves status.*, storage.* (the app's
 * phone storage bridge), clipboard.set and device.ring. Other files add their own operations
 * (Studio's session, streams).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ID_KEY = 'activeSyncPeerId';
    const HELLO_RETRY_MS = [2000, 5000, 15000, 30000];
    const STATUS_MIN_MS = 5000;
    const STATUS_BEAT_MS = 120000;

    function inAndroidApp() {
        return !!(root.AndroidNotification || root.AndroidCaption || root.AndroidDeviceStatus || root.AndroidPhoneStorage);
    }

    function detectKind() {
        if (root.__activeSyncKind === 'device' || root.__activeSyncKind === 'computer') return root.__activeSyncKind; // tests
        if (inAndroidApp()) return 'device';
        let agentTab = false;
        try { agentTab = new URLSearchParams(root.location.search).get('agent') === '1'; } catch (_) { /* no location */ }
        if (agentTab || root.uiShell === 'mobile') return null;
        return 'computer';
    }

    function peerId() {
        let id = '';
        try { id = root.localStorage.getItem(ID_KEY) || ''; } catch (_) { /* private mode */ }
        if (!/^[0-9a-f]{32}$/.test(id)) {
            const bytes = new Uint8Array(16);
            root.crypto.getRandomValues(bytes);
            id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
            try { root.localStorage.setItem(ID_KEY, id); } catch (_) { /* this session only */ }
        }
        return id;
    }

    const kind = detectKind();
    const st = { kind, id: kind ? peerId() : '', name: '', online: false, session: null, permissions: [], devices: [], computers: [] };
    const listeners = new Map();
    const ops = new Map();
    let helloTimer = null;
    let helloTries = 0;
    let helloAgain = false;
    let wired = false;

    function err(code, message) {
        return { code: code || 'FAILED', message: message || 'The request failed.' };
    }

    function on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(fn);
        return () => {
            const l = listeners.get(event) || [];
            const i = l.indexOf(fn);
            if (i >= 0) l.splice(i, 1);
        };
    }

    function fire(event, data) {
        (listeners.get(event) || []).slice().forEach((fn) => {
            try { fn(data); } catch (e) { console.warn('[activeSync] listener failed:', e); }
        });
    }

    function client() {
        return root.wsClient && typeof root.wsClient.sendMessage === 'function' ? root.wsClient : null;
    }

    function send(type, data) {
        const c = client();
        if (!c) return Promise.reject(err('OFFLINE', 'Not connected.'));
        return c.sendMessage(type, data || {}, false).then((res) => {
            if (res && res.success === false) throw err(res.code, res.error);
            return res || {};
        }, (e) => { throw err(e && e.code ? e.code : 'OFFLINE', (e && e.message) || 'Not connected.'); });
    }

    function takeLists(res) {
        if (Array.isArray(res.devices)) st.devices = res.devices;
        if (Array.isArray(res.computers)) st.computers = res.computers;
        if (kind === 'device') {
            const me = st.devices.find((d) => d.deviceId === st.id);
            if (me) {
                st.session = me.session;
                st.permissions = me.permissions || [];
                st.name = me.name;
            }
        }
    }

    // ---------------------------------------------------------------- device facts

    function deviceFacts() {
        const ua = String((root.navigator && root.navigator.userAgent) || '');
        const m = /Android ([\d.]+);\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/.exec(ua);
        const app = /\b(Dreamscape|DSApp)\/([\w.]+)/.exec(ua);
        return {
            os: m ? `Android ${m[1]}` : 'Android',
            model: m ? m[2].trim() : '',
            app: app ? `${app[1]}/${app[2]}` : 'Dreamscape'
        };
    }

    let storageRoots = null; // [{ id, name, total, free }] from the app's storage bridge, when shared

    function refreshStorageRoots() {
        const ps = root.phoneStorage;
        if (!ps || !ps.available || typeof ps.hello !== 'function') return Promise.resolve();
        return ps.hello().then((h) => {
            const roots = h && Array.isArray(h.roots) ? h.roots : [];
            storageRoots = roots.map((r) => ({ id: r.id, name: r.name || r.label || r.id, total: r.total == null ? r.totalBytes : r.total, free: r.free == null ? r.freeBytes : r.free }));
        }, () => { storageRoots = null; });
    }

    /** The phone's status as the server keeps it; unknown fields stay out (never guessed). */
    function deviceStatus() {
        const out = { foreground: !doc || doc.visibilityState === 'visible' };
        let s = null;
        const b = root.AndroidDeviceStatus;
        if (b && typeof b.getState === 'function') {
            try { s = JSON.parse(b.getState()); } catch (_) { s = null; }
        }
        if (s) {
            if (s.battery) out.battery = s.battery;
            if (s.wifi) out.wifi = s.wifi;
            if (s.cellular) out.cellular = s.cellular;
            if (s.active != null) out.active = s.active;
        } else if (webBattery) {
            out.battery = { level: Math.round(webBattery.level * 100), charging: !!webBattery.charging };
        }
        if (storageRoots) out.storage = storageRoots;
        return out;
    }

    let webBattery = null;
    let statusTimer = null;
    let lastStatusAt = 0;

    function pushStatus() {
        if (kind !== 'device' || !st.online) return;
        const wait = STATUS_MIN_MS - (Date.now() - lastStatusAt);
        if (wait > 0) {
            if (!statusTimer) statusTimer = setTimeout(() => { statusTimer = null; pushStatus(); }, wait);
            return;
        }
        lastStatusAt = Date.now();
        const c = client();
        // fire-and-forget: no reply packet exists for it
        if (c && c.ws && c.ws.readyState === 1) {
            try { c.ws.send(JSON.stringify({ type: 'as_status', status: deviceStatus() })); } catch (_) { /* closing */ }
        }
    }

    // ---------------------------------------------------------------- hello

    function scheduleHello(delay) {
        if (helloTimer) clearTimeout(helloTimer);
        helloTimer = setTimeout(() => { helloTimer = null; void hello(); }, delay);
    }

    async function hello() {
        if (!kind || !client()) return;
        helloAgain = false;
        const data = { kind, id: st.id, ops: [...ops.keys()], speaker: 'webview' };
        if (kind === 'device') {
            await refreshStorageRoots();
            const f = deviceFacts();
            let name = '';
            try { name = root.localStorage.getItem('activeSyncDeviceName') || ''; } catch (_) { /* none */ }
            Object.assign(data, f, { name: name || f.model || 'Mobile Device', status: deviceStatus() });
        }
        try {
            const res = await send('as_hello', data);
            helloTries = 0;
            st.online = true;
            st.name = res.name || st.name;
            if (kind === 'device') { st.session = res.session || null; st.permissions = res.permissions || []; }
            takeLists(res);
            lastStatusAt = Date.now();
            fire('state', state());
            if (helloAgain) scheduleHello(200);
        } catch (e) {
            st.online = false;
            fire('state', state());
            // not signed in yet, or the socket is still settling: try again, slower each time
            scheduleHello(HELLO_RETRY_MS[Math.min(helloTries, HELLO_RETRY_MS.length - 1)]);
            helloTries += 1;
        }
    }

    function state() {
        return { kind: st.kind, id: st.id, name: st.name, online: st.online, session: st.session, permissions: st.permissions.slice(), devices: st.devices.slice(), computers: st.computers.slice() };
    }

    // ---------------------------------------------------------------- requests

    function registerOp(name, fn) {
        if (!/^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(String(name)) || typeof fn !== 'function') return;
        const fresh = !ops.has(name);
        ops.set(name, fn);
        // the server routes by the op list of the hello: say hello again when it grew
        if (fresh && st.online) { helloAgain = true; scheduleHello(300); }
    }

    // what a computer may ask of this device, by the permissions its user granted (the server checks
    // the same; the phone has the last word)
    const GROUP_NEEDS = { storage: 'files', stream: 'files', studio: 'session', clipboard: 'clipboard', open: 'clipboard', device: 'control', notify: 'notify', screen: 'screen', sync: 'sync' };

    function permitted(op, from) {
        if (kind !== 'device' || !from || from.kind === 'server') return true;
        const group = op.split('.')[0];
        if (group === 'partnership' || group === 'status') return true;
        if (st.session !== 'guest' && st.session !== 'partner') return false;
        const need = GROUP_NEEDS[group];
        return !need || st.permissions.includes(need);
    }

    async function onRequest(msg) {
        const d = (msg && msg.data) || {};
        const c = client();
        if (!d.callId || !c) return;
        const answer = (ok, payload) => {
            try { c.ws.send(JSON.stringify(Object.assign({ type: 'as_reply', callId: d.callId, ok }, ok ? { result: payload } : { error: payload }))); } catch (_) { /* closing */ }
        };
        const fn = ops.get(d.op);
        if (!fn) { answer(false, err('UNSUPPORTED', 'This is not supported here.')); return; }
        if (!permitted(d.op, d.from)) { answer(false, err('NOT_PERMITTED', 'The device does not allow this.')); return; }
        fire('request', { from: d.from, op: d.op });
        try {
            const result = await fn(d.args || {}, d.from || {});
            answer(true, result == null ? null : result);
        } catch (e) {
            answer(false, err(e && e.code, e && e.message));
        }
    }

    function onEvent(msg) {
        const d = (msg && msg.data) || {};
        if (!d.event) return;
        if (kind === 'device' && d.from && d.from.kind === 'server' && d.event === 'partnership.changed' && d.detail) {
            st.session = d.detail.session || 'pending';
            st.permissions = Array.isArray(d.detail.permissions) ? d.detail.permissions : [];
            if (d.detail.name) st.name = d.detail.name;
            fire('state', state());
        }
        fire('event', { from: d.from || {}, event: d.event, detail: d.detail == null ? null : d.detail });
    }

    function call(to, op, args, opts) {
        const o = opts || {};
        return send('as_call', { to, op, args: args || {}, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}), ...(o.queue ? { queue: true } : {}) })
            .then((res) => (res.queued ? { queued: true } : res.result));
    }

    function emit(event, detail) {
        const c = client();
        if (!kind || !st.online || !c || !c.ws || c.ws.readyState !== 1) return;
        try { c.ws.send(JSON.stringify({ type: 'as_event', event, detail: detail == null ? null : detail })); } catch (_) { /* closing */ }
    }

    const partnershipCall = (data) => send('as_partnership', data).then((res) => { if (res.device) mergeDevice(res.device); return res; });

    function mergeDevice(dev) {
        const i = st.devices.findIndex((d) => d.deviceId === dev.deviceId);
        if (i >= 0) st.devices[i] = dev; else st.devices.push(dev);
        if (kind === 'device' && dev.deviceId === st.id) { st.session = dev.session; st.permissions = dev.permissions || []; st.name = dev.name; }
        fire('state', state());
    }

    // ---------------------------------------------------------------- device operations

    function confirmOnPhone(title, text) {
        const sh = root.wmShell;
        if (sh && typeof sh.messageBox === 'function') {
            return sh.messageBox({ title, text, icon: 'question', modal: true, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }], cancelValue: false });
        }
        if (typeof root.showConfirmationDialog === 'function') {
            return Promise.resolve(root.showConfirmationDialog(text, [{ text: 'Yes', value: true }, { text: 'No', value: false }])).then((v) => v === true);
        }
        return Promise.resolve(false);
    }

    function registerDeviceOps() {
        registerOp('status.get', () => deviceStatus());

        // the computer's user chose how to connect; this device's user agrees or not
        registerOp('partnership.propose', async (args, from) => {
            const computer = String((args && args.computer) || (from && from.name) || 'A computer').slice(0, 64);
            const partner = args && args.mode === 'partner';
            const text = partner
                ? `Set up a partnership with ${computer}?\n\n${computer} will be able to browse this device, exchange information with it and keep the selected items up to date.`
                : `Allow ${computer} to connect to this device?\n\n${computer} will be able to browse this device and exchange information with it until it is disconnected.`;
            const accept = await confirmOnPhone('ActiveSync', text);
            return { accept: accept === true };
        });

        // phone storage: the app's bridge, the same operations File Explorer uses on the phone itself
        const STORAGE_OPS = ['hello', 'list', 'stat', 'mkdir', 'rename', 'delete', 'trash', 'trashList', 'restore'];
        STORAGE_OPS.forEach((op) => {
            registerOp(`storage.${op}`, async (args) => {
                const ps = root.phoneStorage;
                if (!ps || !ps.available) throw err('disabled', 'Phone storage is not shared.');
                const res = await ps.call(op, args || {});
                // the app's local file URLs carry a per-launch token and mean nothing off the phone
                if (op === 'hello' && res && typeof res === 'object') { const copy = Object.assign({}, res); delete copy.baseUrl; return copy; }
                return res;
            });
        });

        registerOp('clipboard.set', async (args, from) => {
            const text = String((args && args.text) || '');
            if (!text) throw err('EMPTY', 'Nothing to copy.');
            await root.navigator.clipboard.writeText(text);
            if (root.wmShell && root.wmShell.notify) root.wmShell.notify({ title: 'ActiveSync', text: `Text from ${(from && from.name) || 'the computer'} is on the clipboard.`, icon: 'info', timeout: 5000 });
            return true;
        });

        registerOp('device.ring', async () => {
            if (root.navigator && typeof root.navigator.vibrate === 'function') root.navigator.vibrate([400, 200, 400, 200, 400, 200, 800]);
            const sh = root.wmShell;
            if (sh && sh.sounds && typeof sh.sounds.play === 'function') {
                for (let i = 0; i < 4; i += 1) setTimeout(() => sh.sounds.play('Notification', { force: true }), i * 1500);
            }
            return true;
        });

        const b = root.AndroidDeviceStatus;
        if (b) root.addEventListener('androiddevicestatus', pushStatus);
        else if (root.navigator && typeof root.navigator.getBattery === 'function') {
            root.navigator.getBattery().then((bat) => {
                webBattery = bat;
                bat.addEventListener('levelchange', pushStatus);
                bat.addEventListener('chargingchange', pushStatus);
                pushStatus();
            }, () => { /* no battery API */ });
        }
        if (doc) doc.addEventListener('visibilitychange', pushStatus);
        const ps = root.phoneStorage;
        if (ps && typeof ps.on === 'function') ps.on('config', () => { refreshStorageRoots().then(pushStatus); });
        setInterval(() => { refreshStorageRoots().then(pushStatus); }, STATUS_BEAT_MS);
    }

    // ---------------------------------------------------------------- wiring

    function wire() {
        const c = client();
        if (wired || !c || typeof c.on !== 'function') return false;
        wired = true;
        c.on('connected', () => { helloTries = 0; scheduleHello(500); });
        c.on('disconnected', () => { st.online = false; if (kind === 'device') st.session = null; fire('state', state()); });
        c.on('as_request', onRequest);
        c.on('as_event', onEvent);
        c.on('as_peers_updated', (msg) => { takeLists((msg && msg.data) || {}); fire('state', state()); });
        if (typeof c.isConnected === 'function' ? c.isConnected() : true) scheduleHello(500);
        return true;
    }

    root.activeSync = {
        kind,
        state,
        on,
        registerOp,
        call,
        emit,
        device: (id) => st.devices.find((d) => d.deviceId === id) || null,
        refresh: () => send('as_list', {}).then((res) => { takeLists(res); fire('state', state()); return state(); }),
        propose: (deviceId, mode, opts) => partnershipCall(Object.assign({ action: 'propose', deviceId, mode }, opts || {})),
        update: (deviceId, changes) => partnershipCall(Object.assign({ action: 'update', deviceId }, changes || {})),
        endPartnership: (deviceId) => partnershipCall({ action: 'end', deviceId }),
        forget: (deviceId) => send('as_forget', { deviceId }).then((res) => { st.devices = st.devices.filter((d) => d.deviceId !== deviceId); fire('state', state()); return res; }),
        log: (deviceId, limit) => send('as_log', { deviceId, limit }).then((res) => res.entries || []),
        synced: (deviceId, summary) => send('as_synced', { deviceId, summary }),
        hello,
        deviceStatus,
        _fire: fire
    };

    if (!kind) return;
    if (kind === 'device') registerDeviceOps();
    if (!wire()) {
        // wsClient is created later in the boot: wait for it
        let tries = 0;
        const t = setInterval(() => { tries += 1; if (wire() || tries > 240) clearInterval(t); }, 500);
    }
})(typeof window !== 'undefined' ? window : globalThis);
