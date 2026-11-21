/*
 * The Android app's desktop shell (DeX / Continuity PC, #910, #798): the tray's providers (docs/client-api/tray-providers.md)
 * and the DPI Scaling dialog's display, from DSApp's own bridges. The phone's battery, Wi-Fi, mobile data, volume and
 * Bluetooth then drive the same Vista tray DreamOS shows, and Personalization's "Adjust font size (DPI)" sets the
 * density of the display the desktop is on.
 *
 *   power      AndroidDeviceStatus.battery ('androiddevicestatus') + AndroidHardware.getBattery() for the time left
 *              (read only when a push comes, never on a timer); a docked NexDock's own battery (AndroidHome.getDockStatus,
 *              myNexDock's provider, read with each push and on 'androiddock') is Battery #2 as in Vista's flyout for two
 *              packs, the phone Battery #1; watched beside it, never summed: the icon and time left are the phone's; plans Balanced / Power saver = Android's battery saver
 *              (AndroidDevice.setRadio('saver'))
 *   network    AndroidWifi ('androidwifi', 'androidwifiscan', results 'androidwifiresult') + AndroidDeviceStatus.cellular
 *              as Mobile broadband (mobileData(on) = AndroidDevice.setRadio('data')); joins, leaves, forget, the radio and
 *              auto-connect go through the app's own shell (Localhost ADB / Shizuku), the panels only without one
 *   volume     AndroidVolume media level / mute ('androidvolume'), set with setMedia
 *   bluetooth  AndroidBluetooth ('dreamscape:bluetooth'), power through AndroidDevice.setRadio('bluetooth')
 *   display    window.melatonDisplayScale = { get(), set(scale | null) } in DreamOSSettings.display's shape: the page's
 *              own scale per display (window.melatonPageScale, app.html: the viewport's page scale), never Android's
 *              display density (Yukimi, Nov 19); the HiDPI art follows melatonPageScale.effective() and
 *              'melaton-page-scale'
 *
 * Only on the app's desktop shell (AndroidDisplay.isDesktop(), not the phone shell, not DreamOS - which gives no
 * AndroidDisplay). Everything is pushed by the app; bridges are read once at start and again only on their push.
 * The app starts its listeners while the desktop window is seen and stops them when it is not (DSApp onStart /
 * onStop); a push that comes while the page is frozen is sent again when it thaws.
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const tray = root.melatonTray;
    /*
     * The RIL's operator names as Melaton shows them, on the phone and its desktop alike (#945): Android reports
     * today's short brand, Melaton the carrier's classic network name (Yukimi, Nov 13). Exact names, any case.
     * Defined before this file's desktop-only part: Melaton Mobile (wmShell.js) uses it too.
     */
    const CARRIER_NAMES = { verizon: 'Verizon Wireless' };
    root.melatonCarrierName = (name) => {
        if (typeof name !== 'string') return name;
        const t = name.trim();
        return CARRIER_NAMES[t.toLowerCase()] || t;
    };
    const isDesktop = (() => {
        try { return !!(root.AndroidDisplay && typeof root.AndroidDisplay.isDesktop === 'function' && root.AndroidDisplay.isDesktop()); } catch (_) { return false; }
    })();
    if (!doc || !isDesktop || root.uiShell === 'mobile') return;

    const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : (s && typeof s === 'object' ? s : null); } catch (_) { return null; } };
    const call = (bridge, fn, ...args) => {
        const b = root[bridge];
        if (!b || typeof b[fn] !== 'function') return undefined;
        try { return b[fn](...args); } catch (_) { return undefined; }
    };
    const listen = (type, fn) => root.addEventListener(type, (e) => fn(e && e.detail), { signal: appScopeSignal });

    /** A list of subscribers that gets each new state; subscribe returns its unsubscribe. */
    function hub() {
        const fns = [];
        return {
            emit(st) { fns.slice().forEach((fn) => { try { fn(st); } catch (e) { console.error('[androidTray]', e); } }); },
            subscribe(fn) { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; }
        };
    }

    // ---- requests answered by an event { id, result } ------------------------------------------------------------
    let seq = 0;
    const waiting = new Map();
    function ask(event, start, timeoutMs = 30000) {
        const id = `t${Date.now().toString(36)}${(++seq).toString(36)}`;
        return new Promise((resolve) => {
            const timer = setTimeout(() => { waiting.delete(id); resolve({ error: 'The phone did not answer.' }); }, timeoutMs);
            waiting.set(id, { event, resolve: (r) => { clearTimeout(timer); resolve(r || {}); } });
            try { start(id); } catch (err) { waiting.delete(id); clearTimeout(timer); resolve({ error: String((err && err.message) || err) }); }
        });
    }
    function answered(event) {
        listen(event, (d) => {
            const w = d && waiting.get(String(d.id));
            if (!w || w.event !== event) return;
            waiting.delete(String(d.id));
            w.resolve(d.result);
        });
    }
    answered('androidwifiresult');

    // ---- the phone's status (battery, cellular): one source for power and network ---------------------------------
    let status = parse(call('AndroidDeviceStatus', 'getState')) || null;
    const statusListeners = [];
    listen('androiddevicestatus', (d) => {
        if (!d || typeof d !== 'object') return;
        status = d;
        statusListeners.forEach((fn) => fn());
    });

    // ---- power ---------------------------------------------------------------------------------------------------
    if (tray && root.AndroidDeviceStatus) {
        const h = hub();
        let power = null;
        let powerKey = '';
        let saverOn = null;
        const PLANS = [{ id: 'balanced', name: 'Balanced' }, { id: 'saver', name: 'Power saver' }];
        const build = () => {
            const b = status && status.battery;
            if (!b || b.level === null || b.level === undefined) return null;
            const percent = Math.max(0, Math.min(100, Math.round(Number(b.level))));
            const plugged = !!b.plugged && b.plugged !== 'none' && b.plugged !== false;
            const full = b.status === 'full' || (plugged && percent >= 100);
            const charging = !full && (b.charging === true || b.status === 'charging');
            const m = { present: true, percent, plugged, charging, full, protect: false, minutesLeft: null, minutesToFull: null };
            // the time left: the live current and charge counter, read only now (a push), never on a timer
            const info = parse(call('AndroidHardware', 'getBattery')) || b;
            const cur = Math.abs(Number(info.currentAvgUa || info.currentUa) || 0);
            const charge = Number(info.chargeCounterUah) || 0;
            if (!plugged && cur > 1000 && charge > 0) m.minutesLeft = Math.round(charge / cur * 60);
            if (charging && Number(info.chargeTimeRemainingMs) > 0) m.minutesToFull = Math.round(Number(info.chargeTimeRemainingMs) / 60000);
            // the dock's battery (NexDock): a second battery that is watched, not part of the computer's own (Yukimi,
            // Nov 20: the NexDock is not a phone battery - never summed). The icon, the total and the time left stay the
            // phone's; the flyout lists the two as Battery #1 / #2 with no combined line
            const dock = dockBattery();
            if (dock) {
                m.packs = [
                    { percent, plugged, charging, full },
                    { percent: dock.level, plugged: dock.charging || dock.level >= 100 && plugged, charging: dock.charging && dock.level < 100, full: dock.level >= 100 && (dock.charging || plugged) }
                ];
                m.packsSeparate = true;
            }
            return m;
        };
        /** The dock's battery { level, charging } while one is connected and reports it, else null. */
        function dockBattery() {
            const row = parse(call('AndroidHome', 'getDockStatus'));
            const lv = row && Number(row.connected) === 1 ? Number(row.battery_percent) : NaN;
            if (!Number.isFinite(lv) || row.battery_percent === null || row.battery_percent === '') return null;
            return { level: Math.max(0, Math.min(100, Math.round(lv))), charging: String(row.charge_state || '') === 'charging' };
        }
        const update = () => {
            const saver = !!(status && status.battery && status.battery.saver);
            const b = status && status.battery;
            // what the icon and flyout draw: whole percent, plug, charge, saver (never the live current)
            const d = dockBattery();
            const key = b ? `${b.level}|${b.plugged}|${b.charging}|${b.status}|${saver}|${d ? `${d.level}${d.charging}` : ''}` : '';
            if (key === powerKey) return;
            powerKey = key;
            power = build();
            h.emit(power);
            if (saverOn !== null && saverOn !== saver) {
                try { root.dispatchEvent(new CustomEvent('melaton-power-plan', { detail: { plan: saver ? 'saver' : 'balanced' } })); } catch (_) { /* old engine */ }
            }
            saverOn = saver;
        };
        statusListeners.push(update);
        // the dock's changes (the phone window hears them; another window reads the dock with the phone's pushes)
        listen('androiddock', () => update());
        update();
        tray.register('power', {
            id: 'android', priority: 20, kind: 'android',
            available: () => !!root.AndroidDeviceStatus,
            get: () => power,
            subscribe: (fn) => h.subscribe(fn),
            plans: () => PLANS.slice(),
            activePlan: () => (saverOn ? 'saver' : 'balanced'),
            setPlan: (id) => { call('AndroidDevice', 'setRadio', 'saver', id === 'saver'); }
        });
    }

    // ---- VZAccess Manager (#947, #953): with a Verizon SIM in the phone the desktop has Verizon's connection manager
    // in the notification area (7.x ran at startup into the tray; its Preferences > Application "Run VZAccess Manager
    // at Startup", kept in the registry), and the Start menu lists it from then on (a local mark,
    // 'melatonVzaccessSeen'). A SIM that is not Verizon's ends a copy that is only in the tray.
    let vzOn = null;
    let vzTimer = 0;
    function onVerizon(on) {
        if (on === vzOn) return;
        vzOn = on;
        clearTimeout(vzTimer);
        if (!on) {
            const vz = root.melatonVZAccess;
            if (vz && typeof vz.leftVerizon === 'function') vz.leftVerizon();
            return;
        }
        try { if (root.localStorage.getItem('melatonVzaccessSeen') !== '1') root.localStorage.setItem('melatonVzaccessSeen', '1'); } catch (_) { /* private mode */ }
        // after the desktop is up (the package comes from the server or the cache, the registry from the profile). An
        // installed desktop is up before its server link (installed-boot-zero-wait): a launch that cannot reach the
        // server yet is tried again when the late boot steps end ('deferredInitDone') and a few times after, further
        // apart each time (5 s ... 80 s), never on a steady timer
        let tries = 0;
        const go = () => {
            if (!vzOn) return;
            const reg = root.melatonRegistry;
            const atStartup = reg && typeof reg.get === 'function' ? reg.get('HKCU\\Software\\Smith Micro\\VZAM - Verizon Wireless', 'RunAtStartup', 1) : 1;
            if (Number(atStartup) === 0) return;
            const apps = root.melatonApps;
            const ws = root.wsClient;
            const later = () => { if (vzOn && tries < 5) { clearTimeout(vzTimer); vzTimer = setTimeout(go, 5000 * 2 ** tries); tries += 1; } };
            if (!apps || typeof apps.launch !== 'function' || !ws || (typeof ws.isConnected === 'function' && !ws.isConnected())) { later(); return; }
            const running = typeof apps.running === 'function' && apps.running().some((a) => a.packageId === 'vzaccess');
            if (running) return;
            void Promise.resolve(apps.launch({ packageId: 'vzaccess', args: { tray: true } })).catch((err) => {
                // the program's own fault is reported by melatonApps; a server not reached yet is tried again
                if (!(err && err.melatonAppFault)) later();
            });
        };
        doc.addEventListener('deferredInitDone', () => { if (vzOn) setTimeout(go, 1000); }, { once: true, signal: appScopeSignal });
        const booted = () => !!(root.wsClient && root.wsClient.initializationCompleted && root.melatonApps);
        if (booted()) { vzTimer = setTimeout(go, 1500); return; }
        // the boot's end: its event, or (the DeX window can pass desktopBootDone before this first runs, and then it
        // never came - VZAccess Manager stayed out of the tray) one look 20 s on; whichever comes first starts it
        let started = false;
        const once = () => { if (started || !booted()) return; started = true; clearTimeout(vzTimer); vzTimer = setTimeout(go, 3000); };
        doc.addEventListener('desktopBootDone', () => setTimeout(once, 0), { once: true, signal: appScopeSignal });
        vzTimer = setTimeout(() => { once(); if (!started) vzTimer = setTimeout(once, 40000); }, 20000);
    }

    // ---- mobile broadband kept up beside Wi-Fi (#953, Yukimi): connecting mobile broadband while Wi-Fi (or another
    // link) is up turns on Android's "Mobile data always active" (Settings.Global mobile_data_always_on, through the
    // app's Shizuku path) so the cellular link really stays up; disconnecting turns it off again only if Melaton turned
    // it on (the mark in the registry, so it survives a restart). Read back by the app's radios push.
    const MB_KEY = 'HKCU\\Software\\Melaton\\Mobile Broadband';
    function setAlwaysOn(on, mark) {
        if (!root.AndroidDevice || typeof root.AndroidDevice.setMobileDataAlwaysOn !== 'function') return { ok: false, error: 'This app version cannot change it.' };
        const r = parse(call('AndroidDevice', 'setMobileDataAlwaysOn', !!on)) || { ok: false };
        const reg = root.melatonRegistry;
        if (r.ok && reg && typeof reg.set === 'function') void reg.set(MB_KEY, { AlwaysOnByMelaton: on && mark ? 1 : null });
        return r;
    }
    function keepMobileUp(on) {
        const dev = root.AndroidDevice;
        if (!dev || typeof dev.getMobileDataAlwaysOn !== 'function') return;
        const cur = parse(call('AndroidDevice', 'getMobileDataAlwaysOn'));
        const isOn = !!(cur && cur.on);
        const reg = root.melatonRegistry;
        const ours = !!(reg && typeof reg.get === 'function' && Number(reg.get(MB_KEY, 'AlwaysOnByMelaton', 0)));
        if (on) {
            const w = parse(call('AndroidWifi', 'get'));
            const otherUp = !!(w && w.state === 'connected') || !!(status && status.active === 'ethernet');
            if (otherUp && !isOn) setAlwaysOn(true, true);
        } else if (isOn && ours) {
            setAlwaysOn(false, false);
        }
    }

    // ---- network: Wi-Fi + mobile broadband ------------------------------------------------------------------------
    if (tray && root.AndroidWifi) {
        const h = hub();
        const scanHub = hub();
        let wifi = parse(call('AndroidWifi', 'get')) || null;
        let net = null;
        let netKey = '';
        const mobileOf = (s) => {
            const c = s && s.cellular;
            if (!c || !c.present || c.simState === 'absent') return null;
            const bars = Number.isFinite(Number(c.level5)) ? Number(c.level5) : Number(c.level);
            return {
                present: true,
                on: c.dataEnabled !== false && c.radioOn !== false && !c.airplane,
                connected: !!c.dataActive,
                carrier: root.melatonCarrierName(c.operator || ''),
                generation: c.dataType || '',
                // 0-5 bars to the tray's percent scale (bars() there: 20 % a bar)
                signalPercent: Number.isFinite(bars) ? Math.max(0, Math.min(100, bars * 20)) : 0,
                roaming: !!c.roaming
            };
        };
        const build = () => {
            const w = wifi || { present: false };
            const mobile = mobileOf(status);
            const out = {
                wifi: { present: !!w.present, device: w.device || 'wlan0', radio: w.radio !== false, state: w.state || 'off', scanning: !!w.scanning, network: w.network || null, ip: Array.isArray(w.ip) ? w.ip : [] },
                ethernet: [],
                online: (w.state === 'connected' && Array.isArray(w.ip) && w.ip.length > 0) || !!(mobile && mobile.connected) || (status && status.active === 'ethernet')
            };
            if (mobile) out.mobile = mobile;
            // a USB / dock Ethernet link (DeX on a dock): the wired icon
            if (status && status.active === 'ethernet') out.ethernet.push({ name: 'Local Area Connection', carrier: true, speedMbps: null, state: 'up', ip: ['0.0.0.0'] });
            return out;
        };
        const update = () => {
            const next = build();
            const key = JSON.stringify(next);
            if (key === netKey) return;
            netKey = key;
            net = next;
            h.emit(net);
            // a Verizon SIM in the phone (its data on or not: on Wi-Fi the SIM is still Verizon's, as 7.x ran at startup
            // whatever the connection), not only a live Verizon data link (#953)
            onVerizon(!!(next.mobile && /verizon/i.test(String(next.mobile.carrier || ''))));
        };
        listen('androidwifi', (d) => { if (d && typeof d === 'object') { wifi = d; update(); } });
        listen('androidwifiscan', (d) => scanHub.emit(d && Array.isArray(d.networks) ? d : { networks: [] }));
        statusListeners.push(update);
        update();
        const wifiAsk = (fn, ...args) => ask('androidwifiresult', (id) => call('AndroidWifi', fn, ...args, id));
        tray.register('network', {
            id: 'android', priority: 20, kind: 'android',
            available: () => !!root.AndroidWifi,
            get: () => net,
            subscribe: (fn) => h.subscribe(fn),
            onScan: (fn) => scanHub.subscribe(fn),
            networks: () => Promise.resolve(parse(call('AndroidWifi', 'networks')) || { networks: [] }),
            scan: () => Promise.resolve(parse(call('AndroidWifi', 'scan')) || { error: 'No Wi-Fi.' }),
            // Connect to a network > Manually connect with "Connect even if the network is not broadcasting" (#1005):
            // the app's hidden-network path (DSApp connectHidden), which an older app does not have
            connect: (ssid, pass, opts) => (opts && opts.hidden
                ? (typeof root.AndroidWifi.connectHidden === 'function'
                    ? wifiAsk('connectHidden', String(ssid), pass ? String(pass) : null)
                    : Promise.resolve({ error: 'This version of the Dreamscape app cannot connect to a network that is not broadcasting.' }))
                : wifiAsk('connect', String(ssid), pass ? String(pass) : null)),
            disconnect: () => wifiAsk('disconnect'),
            forget: (ssid) => wifiAsk('forget', String(ssid)),
            autoConnect: (ssid, on) => (typeof root.AndroidWifi.autoConnect === 'function' ? wifiAsk('autoConnect', String(ssid), !!on) : Promise.resolve({ error: 'This app version cannot change it.' })),
            radio: (on) => wifiAsk('radio', !!on),
            mobileData: (on) => { keepMobileUp(!!on); return Promise.resolve(parse(call('AndroidDevice', 'setRadio', 'data', !!on)) || { error: 'No mobile data.' }); },
            // Developer options > Mobile data always active (DSApp AndroidDevice.get/setMobileDataAlwaysOn): null on an
            // older app
            dataAlwaysOn: () => { const r = parse(call('AndroidDevice', 'getMobileDataAlwaysOn')); return r && typeof r.on === 'boolean' ? r.on : null; },
            setDataAlwaysOn: (on) => setAlwaysOn(!!on, false),
            // round 2 (docs/client-api/tray-providers.md): read when asked, never pushed
            known: () => Promise.resolve(parse(call('AndroidWifi', 'known')) || { networks: [] }),
            // stats(iface): the app answers per interface ({ iface, kind, ... }, #945); an older app answers every call
            // with the Wi-Fi adapter's figures and no kind, which the status sheet (dreamosWifi.js) does not take
            stats: (iface) => Promise.resolve(parse(iface ? call('AndroidWifi', 'stats', String(iface)) : call('AndroidWifi', 'stats')) || { error: 'No figures.' }),
            interfaces: () => Promise.resolve(parse(call('AndroidWifi', 'interfaces')) || { interfaces: [] }),
            enable: (iface, on) => (String(iface).startsWith('rmnet') || iface === 'mobile'
                ? Promise.resolve(parse(call('AndroidDevice', 'setRadio', 'data', !!on)) || { error: 'No mobile data.' })
                : wifiAsk('radio', !!on)),
            // older app builds have no shell path for these (their can() lacks the keys): greyed out
            can: () => Object.assign({ disconnect: false, autoConnect: false, order: false, ipConfig: false, enable: false }, (wifi && wifi.can) || {})
        });
    }

    // ---- volume ---------------------------------------------------------------------------------------------------
    if (tray && root.AndroidVolume && typeof root.AndroidVolume.setMedia === 'function') {
        const h = hub();
        let vol = null;
        const build = (v) => (v && v.mediaPct !== undefined ? { present: true, volume: Number(v.mediaPct) || 0, muted: !!v.mediaMuted, sink: v.output || 'Speakers' } : null);
        vol = build(parse(call('AndroidVolume', 'get')));
        listen('androidvolume', (d) => {
            const next = build(d);
            if (!next || JSON.stringify(next) === JSON.stringify(vol)) return;
            vol = next;
            h.emit(vol);
        });
        tray.register('volume', {
            id: 'android', priority: 20, kind: 'android',
            available: () => !!vol,
            get: () => vol,
            subscribe: (fn) => h.subscribe(fn),
            set: (patch) => {
                const p = patch || {};
                const pct = Number.isFinite(Number(p.volume)) ? Math.max(0, Math.min(100, Math.round(Number(p.volume)))) : -1;
                const mute = p.muted === undefined ? -1 : (p.muted ? 1 : 0);
                const st = build(parse(call('AndroidVolume', 'setMedia', pct, mute)));
                if (st) vol = st;
                return Promise.resolve(vol || { error: 'No volume.' });
            }
        });
    }

    // ---- Bluetooth --------------------------------------------------------------------------------------------------
    if (tray && root.AndroidBluetooth) {
        const h = hub();
        let bt = null;
        let btKey = '';
        const KIND = { audio: 'audio', peripheral: 'input', phone: 'phone' };
        const build = (s) => {
            if (!s || typeof s !== 'object') return null;
            return {
                present: !!s.present,
                on: !!s.on,
                access: s.access !== false,
                devices: (Array.isArray(s.devices) ? s.devices : []).map((d) => ({
                    id: String(d.address), name: d.name || d.address, kind: KIND[d.kind] || 'other',
                    connected: !!d.connected, battery: Number.isFinite(Number(d.battery)) && d.battery !== null ? Number(d.battery) : null
                }))
            };
        };
        const apply = (s) => {
            const next = build(s);
            const key = JSON.stringify(next);
            if (key === btKey) return;
            btKey = key;
            bt = next;
            h.emit(bt);
        };
        apply(parse(call('AndroidBluetooth', 'getState')));
        listen('dreamscape:bluetooth', (d) => apply(parse(d)));
        const r = (s) => parse(s) || {};
        tray.register('bluetooth', {
            id: 'android', priority: 20, kind: 'android',
            available: () => !!(bt && bt.present),
            get: () => bt,
            subscribe: (fn) => h.subscribe(fn),
            power: (on) => Promise.resolve(r(call('AndroidDevice', 'setRadio', 'bluetooth', !!on))),
            connect: (id) => Promise.resolve(r(call('AndroidBluetooth', 'connect', String(id)))),
            disconnect: (id) => Promise.resolve(r(call('AndroidBluetooth', 'disconnect', String(id)))),
            pair: () => { call('AndroidBluetooth', 'openSettings', null); return Promise.resolve({ via: 'settings' }); },
            requestAccess: () => Promise.resolve(!!call('AndroidBluetooth', 'requestAccess')),
            openSettings: () => { call('AndroidBluetooth', 'openSettings', null); return Promise.resolve({}); }
        });
    }

    // ---- the display: DPI Scaling - the page's own scale (app.html melatonPageScale), per display ---------------------
    const ps = root.melatonPageScale;
    if (ps && ps.available) {
        const state = () => ({ scale: ps.get(), default: 1, auto: ps.get() === 1, can: true, platform: 'android-page' });
        root.melatonDisplayScale = Object.freeze({
            platform: 'android-page',
            get: () => Promise.resolve(state()),
            set: (scale) => Promise.resolve(ps.set(scale) ? state() : { error: 'The page scale could not be changed.' })
        });
        // the window moved to another display (a different monitor size): that display's own scale
        let screenKey = ps.key();
        root.addEventListener('resize', () => {
            const k = ps.key();
            if (k === screenKey) return;
            screenKey = k;
            ps.follow();
        }, { signal: appScopeSignal });
    }
})(typeof window !== 'undefined' ? window : globalThis);
