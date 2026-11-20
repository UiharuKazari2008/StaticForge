/*
 * Tray providers (#932): the desktop tray's system icons (Power, Network, Volume, and Bluetooth when it comes) draw what
 * one provider per area says, so the same tray runs on DreamOS (the CaféReady host), the Android app's desktop shell
 * (DeX / Continuity PC: DSApp's bridges) and a plain browser. Contract: docs/client-api/tray-providers.md.
 *
 *   melatonTray.register(area, provider)   area: 'power' | 'network' | 'volume' | 'bluetooth'
 *   melatonTray.provider(area)             the provider in use: the highest priority whose available() is true
 *   melatonTray.onChange(area, fn)         fn(state) whenever the provider in use reports a change (or another
 *                                          provider takes over); returns an unsubscribe function
 *
 * A provider: { id, priority, available(), get(), subscribe(fn) -> unsubscribe, ...the area's actions }. Providers push
 * (subscribe); nothing here polls. Built in: DreamOS's three (priority 30) from window.DreamOSHardware /
 * DreamOSNetwork / DreamOSAudio; the browser's Battery Status API is trayPower.js's own fallback (priority 0).
 */
(function (root) {
    'use strict';
    const AREAS = ['power', 'network', 'volume', 'bluetooth'];
    const providers = {};
    const listeners = {};
    const current = {};
    const unsub = {};
    AREAS.forEach((a) => { providers[a] = []; listeners[a] = []; });

    function pick(area) {
        const list = providers[area] || [];
        return list.filter((p) => { try { return !p.available || p.available(); } catch (_) { return false; } })
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null;
    }

    function emit(area, state) {
        (listeners[area] || []).slice().forEach((fn) => { try { fn(state); } catch (e) { console.error('[melatonTray]', area, e); } });
    }

    /** Follows the provider in use (again after a register: a better one may have come). */
    function follow(area) {
        const p = pick(area);
        if (p === current[area]) return;
        if (unsub[area]) { try { unsub[area](); } catch (_) { /* gone */ } }
        unsub[area] = null;
        current[area] = p;
        if (p && typeof p.subscribe === 'function') unsub[area] = p.subscribe((st) => { if (current[area] === p) emit(area, st); });
        let st = null;
        try { st = p && p.get ? p.get() : null; } catch (_) { st = null; }
        emit(area, st);
    }

    function register(area, provider) {
        if (!AREAS.includes(area) || !provider || typeof provider.get !== 'function') throw new Error(`melatonTray.register: bad area or provider (${area})`);
        const list = providers[area];
        const i = list.findIndex((p) => p.id === provider.id);
        if (i >= 0) list.splice(i, 1, provider); else list.push(provider);
        follow(area);
    }

    function onChange(area, fn) {
        if (!listeners[area] || typeof fn !== 'function') return () => {};
        listeners[area].push(fn);
        return () => { const i = listeners[area].indexOf(fn); if (i >= 0) listeners[area].splice(i, 1); };
    }

    const api = { register, provider: (area) => current[area] || pick(area), onChange, areas: AREAS.slice() };
    root.melatonTray = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    // ---- DreamOS (the CaféReady host through the kiosk's shell extension) ---------------------------------------------
    const evt = (name, pick2) => (fn) => {
        const h = (e) => fn(pick2(e && e.detail));
        root.addEventListener(name, h);
        return () => root.removeEventListener(name, h);
    };

    if (root.DreamOSHardware && typeof root.DreamOSHardware.get === 'function') {
        // state: the host's hw snapshot { batteries: [{ percent, status }], ac, protect }; trayPower.js reads it
        // (and AndroidHardware.getBattery() for the time left)
        register('power', {
            id: 'dreamos', priority: 30, kind: 'dreamos-hw',
            available: () => true,
            get: () => root.DreamOSHardware.get(),
            subscribe: evt('dreamoshw', (d) => d)
        });
    }
    if (root.DreamOSNetwork && typeof root.DreamOSNetwork.get === 'function') {
        const n = root.DreamOSNetwork;
        // The page's reads of the host's network never take more than READS of its connections (#910, Nov 20 2026): with
        // the Mac's Wi-Fi firmware dead each read waited on iwd, every Refresh of Connect to a network added more, and
        // once the browser's six connections to the host were all waiting, the shell bridge's synchronous reads
        // (AndroidHardware, the secure store) stopped the whole page until one answered - clicks did nothing, then all
        // opened at once. A read already on its way is shared, not asked again; writes (connect, forget...) go at once.
        const READS = 2;
        let reading = 0;
        const waiting = [];
        const inFlight = new Map();
        const nextRead = () => {
            while (reading < READS && waiting.length) {
                const job = waiting.shift();
                reading += 1;
                Promise.resolve().then(job.fn).then(job.resolve, job.reject).then(() => { reading -= 1; nextRead(); });
            }
        };
        const read = (key, fn) => {
            if (inFlight.has(key)) return inFlight.get(key);
            const p = new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); nextRead(); });
            inFlight.set(key, p);
            const done = () => { if (inFlight.get(key) === p) inFlight.delete(key); };
            p.then(done, done);
            return p;
        };
        // A phone's hotspot as this computer's mobile broadband (#953; cafeready wwan.rs, docs/client-api/
        // phone-broadband.md): the host says when the Wi-Fi is a phone's hotspot (an Instant Hotspot session, or
        // Android's DHCP option in the lease) and the state gains `mobile` for it, as a mobile broadband card's: the
        // tray, Network Connections and VZAccess Manager show it so. The phone's battery and signal are the Instant
        // Hotspot link's, else the phone's own ActiveSync status (the server tells which partner phone it is:
        // modules/phoneTether.js, the device's `hotspot`). All pushed; nothing is read on a timer.
        const W = root.DreamOSWwan && typeof root.DreamOSWwan.get === 'function' ? root.DreamOSWwan : null;
        // the phone last found sharing its hotspot: its own status still shows while the computer is not on it (VZAccess
        // Manager keeps a card's signal while disconnected)
        let lastPhoneId = null;
        const wwanPhone = (w) => {
            const as = root.activeSync;
            const list = as && typeof as.state === 'function' ? ((as.state() || {}).devices || []) : [];
            const d = list.find((x) => x && x.hotspot && x.hotspot.ssid && x.hotspot.ssid === w.ssid)
                || (!w.connected && lastPhoneId ? list.find((x) => x && x.deviceId === lastPhoneId) : null) || null;
            if (d) lastPhoneId = d.deviceId;
            const st = (d && d.status) || {};
            const c = st.cellular || {};
            const ih = w.phone && typeof w.phone === 'object' ? w.phone : null;
            const bars = ih && Number.isFinite(Number(ih.bars)) ? Number(ih.bars) : (Number.isFinite(Number(c.level)) ? Number(c.level) : null);
            return {
                deviceId: d ? d.deviceId : null,
                name: (ih && ih.name) || (d && d.name) || '', model: (d && d.model) || '',
                battery: ih && ih.battery != null ? Number(ih.battery) : (st.battery && st.battery.level != null ? Number(st.battery.level) : null),
                charging: ih ? !!ih.charging : !!(st.battery && st.battery.charging),
                bars, dataType: (ih && ih.network) || c.dataType || '', operator: (ih && ih.operator) || c.operator || '',
                roaming: !!c.roaming, number: c.phoneNumber || ''
            };
        };
        const withMobile = (base) => {
            const w = W ? W.get() : null;
            if (!w || !w.present || !base || typeof base !== 'object') return base;
            const ph = wwanPhone(w);
            const carrier = typeof root.melatonCarrierName === 'function' && ph.operator ? root.melatonCarrierName(ph.operator) : (ph.operator || 'Verizon Wireless');
            return Object.assign({}, base, {
                mobile: {
                    present: true, connected: !!w.connected, on: true, state: w.state, via: w.via || (w.last && w.last.via) || null,
                    ssid: w.ssid || (w.last && w.last.ssid) || '', device: w.device || '', carrier,
                    signalPercent: ph.bars == null ? null : ph.bars * 25, bars: ph.bars, generation: ph.dataType, roaming: ph.roaming,
                    phone: ph, since: w.since || null, bytes: w.bytes || null, ip: w.ip || [], canConnect: !!w.canConnect
                }
            });
        };
        const netSubscribe = (fn) => {
            const again = () => fn(withMobile(n.get()));
            const offs = [evt('dreamosnet', () => null)(again)];
            if (W) offs.push(evt('dreamoswwan', () => null)(again));
            // the phone's own status (battery, signal) through ActiveSync, once its agent is up (it loads after this file)
            let asOff = null;
            const hookAs = () => { const as = root.activeSync; if (!asOff && as && typeof as.on === 'function') asOff = as.on('state', () => { if (W && W.get().present) again(); }) || (() => {}); };
            if (W) { hookAs(); if (!asOff && root.document) root.document.addEventListener('DOMContentLoaded', hookAs, { once: true }); }
            return () => { offs.forEach((off) => off()); if (typeof asOff === 'function') asOff(); };
        };
        register('network', {
            id: 'dreamos', priority: 30,
            available: () => true,
            get: () => withMobile(n.get()),
            subscribe: netSubscribe,
            onScan: evt('dreamosnetscan', (d) => d),
            networks: () => read('networks', () => n.networks()), scan: () => read('scan', () => n.scan()), connect: (s, p, o) => n.connect(s, p, o),
            disconnect: () => n.disconnect(), forget: (s) => n.forget(s), autoConnect: (s, on) => n.autoConnect(s, on),
            radio: (on) => n.radio(on),
            // Instant Hotspot (cafeready hotspot.rs, docs/client-api/instant-hotspot.md): a bonded phone's hotspot
            ...(root.DreamOSHotspot && typeof root.DreamOSHotspot.get === 'function' ? {
                hotspot: () => root.DreamOSHotspot.get(),
                onHotspot: evt('dreamoshotspot', (d) => d),
                hotspotConnect: () => root.DreamOSHotspot.connect(),
                hotspotDisconnect: () => root.DreamOSHotspot.disconnect()
            } : {}),
            // the phone's hotspot as mobile broadband (VZAccess Manager): leave it / join it again, and its bytes while
            // the program's window is seen (watch returns its release)
            ...(W ? {
                wwan: () => W.get(),
                wwanConnect: () => W.connect(),
                wwanDisconnect: () => W.disconnect(),
                wwanWatch: (fn) => (typeof W.watch === 'function' ? W.watch(fn) : () => {})
            } : {})
        });
        // VZAccess Manager in the notification area while the computer is on a phone's hotspot (7.x's Run at Startup,
        // Preferences > Application; as androidTrayProviders.js starts it on a Verizon phone), once the desktop is up
        if (W) {
            let vzOn = false;
            let tries = 0;
            let timer = 0;
            const go = () => {
                if (!vzOn) return;
                const reg = root.melatonRegistry;
                const atStartup = reg && typeof reg.get === 'function' ? reg.get('HKCU\\Software\\Smith Micro\\VZAM - Verizon Wireless', 'RunAtStartup', 1) : 1;
                if (Number(atStartup) === 0) return;
                const apps = root.melatonApps;
                const later = () => { if (vzOn && tries < 5) { clearTimeout(timer); timer = setTimeout(go, 5000 * 2 ** tries); tries += 1; } };
                if (!apps || typeof apps.launch !== 'function' || !(root.wsClient && root.wsClient.initializationCompleted)) { later(); return; }
                if (typeof apps.running === 'function' && apps.running().some((a) => a.packageId === 'vzaccess')) return;
                void Promise.resolve(apps.launch({ packageId: 'vzaccess', args: { tray: true } })).catch((err) => { if (!(err && err.melatonAppFault)) later(); });
            };
            const follow = () => {
                const on = !!W.get().connected;
                if (on === vzOn) return;
                vzOn = on;
                clearTimeout(timer);
                if (on) {
                    try { if (root.localStorage.getItem('melatonVzaccessSeen') !== '1') root.localStorage.setItem('melatonVzaccessSeen', '1'); } catch (_) { /* private mode */ }
                    tries = 0;
                    timer = setTimeout(go, 3000);
                }
            };
            evt('dreamoswwan', () => null)(follow);
            follow();
        }
    }
    if (root.DreamOSBluetooth && typeof root.DreamOSBluetooth.get === 'function') {
        // BlueZ through the CaféReady host (tray2): { present, on, devices: [...] }, pushed as 'dreamosbt'
        const b = root.DreamOSBluetooth;
        register('bluetooth', {
            id: 'dreamos', priority: 30,
            available: () => true,
            get: () => b.get(),
            subscribe: evt('dreamosbt', (d) => d),
            power: (on) => b.power(on), connect: (id) => b.connect(id), disconnect: (id) => b.disconnect(id)
        });
    }
    if (root.DreamOSAudio && typeof root.DreamOSAudio.get === 'function') {
        const a = root.DreamOSAudio;
        register('volume', {
            id: 'dreamos', priority: 30,
            available: () => true,
            get: () => a.get(),
            subscribe: evt('dreamosaudio', (d) => d),
            set: (patch) => a.set(patch)
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
