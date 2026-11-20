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
        register('network', {
            id: 'dreamos', priority: 30,
            available: () => true,
            get: () => n.get(),
            subscribe: evt('dreamosnet', (d) => d),
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
            } : {})
        });
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
