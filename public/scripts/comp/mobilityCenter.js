/*
 * Melaton Mobility Center (#932, #910): Vista's Windows Mobility Center (mblctr.exe), 1:1 with the VM.
 *
 *   Window      a fixed sheet of frame glass (mblctr extends the frame over its whole client) holding a row of
 *               146 x 120 tiles, at most four to a row, and the help button at the bottom right. Centred in the
 *               work area, one instance (Vista raises the open one).
 *   Tiles       Vista's order: Display Brightness, Volume, Battery Status, Wireless Network, (Mobile Broadband,)
 *               External Display, Sync Center, Presentation Settings (Screen Orientation is a Tablet PC tile: not shown, as on the
 *               VM). Each tile: the icon button (opens the matching Control Panel page), the status, one
 *               control and the title. Words are mblctr.exe.mui's strings (90-97, 120-211, 500-510).
 *               As on the VM (a desktop with a battery), a desktop shows the tiles it has hardware for: Volume,
 *               Battery Status with a battery, Display Brightness with a backlight, Wireless Network with an
 *               adapter, External Display, Sync Center. A mobile PC (DreamOS, the Android app's desktop shell)
 *               always shows Display Brightness, Wireless Network and Presentation Settings, drawn unavailable
 *               when the hardware is missing (the icon dimmed, the control disabled, Vista's "... is
 *               unavailable" / "No ... found" wording).
 *   Sources     pushed, never polled (server-push-not-polling, phone-power-client):
 *                 brightness   DreamOS: window.DreamOSHardware get().backlight.percent, set('backlight', %),
 *                              'dreamoshw' events. Android (#945): AndroidDevice.getBrightness() / setBrightness(%)
 *                              / setAutoBrightness(on), pushed in 'dreamscape:radios' (detail.brightness). Moving
 *                              the slider never turns adaptive brightness off; the Automatic box does that.
 *                              Elsewhere unavailable.
 *                 volume       tabVolume.js (the volume tray provider when there is one, else the tab's own
 *                              level and mute; it coalesces a drag into one request at a time)
 *                 battery      trayPower.js's model and plans ('melaton-battery', 'melaton-power-plan')
 *                 wireless     the 'network' tray provider (melatonTray.onChange): radio(on) turns it off / on
 *                 display      window.screen.isExtended and the screen's 'change' event
 *                 mobile       Mobile Broadband (#945, not a Vista tile: Vista had no WWAN; Windows 7's mobile
 *                              broadband shows the same signal bars): the network provider's mobile part, else
 *                              AndroidDeviceStatus.cellular ('androiddevicestatus'); data on / off through the provider's
 *                              mobileData(on) or AndroidDevice.setRadio('data', on)
 *                 sync         the ActiveSync partnership (activeSync.state().devices, 'state' events): the
 *                              partner phone (in Continuity the phone this DeX window runs on), else Sync Center's
 *                              "No sync partnerships"
 *                 presentation unavailable: nothing in Melaton acts on a presenting state yet
 *   Art         public/static_images/vista-mblctr/ (mblctr.exe icons, the tile button faces and the volume
 *               wedge captured from the VM); the battery is batmeter.dll bitmap 301 (trayPower's flyout cells).
 *
 *   melatonMobilityCenter.open() / close()
 *   Control Panel item 'mobility-center' (Run: mblctr, Win+X: desktopHotkeys.js).
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const TITLE = 'Melaton Mobility Center';
    const ART = '/static_images/vista-mblctr';
    const ICON16 = `${ART}/mblctr-16.png`;
    const ICON32 = `${ART}/mblctr-32.png`;
    // mblctr.exe.mui 151-156: the wireless connection strength, by bars lit
    const STRENGTH = ['no signal', 'very poor', 'poor', 'medium', 'good', 'excellent'];

    let win = null;
    let offs = [];          // unsubscribe functions of the open window's sources
    let shown = '';         // the tile ids on screen, to rebuild only when the set changes
    let volSend = null;     // a volume level waiting for the next frame (a drag sends at most one per frame)
    let briSend = null;
    let stale = false;      // a push came while the page was hidden

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function call(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
    function setSrc(img, src) { if (img && img.getAttribute('src') !== src) img.setAttribute('src', src); }

    /**
     * A Control Panel page (doAction raises a window on it, or opens one) or an item that opens a dialog of its own
     * ('item:sound'). The control_panel feature is loaded already: this file is part of it.
     */
    function openCpl(target) {
        // Network Connections is registered by dreamosWifi.js when it first opens
        if (target === 'connections' && root.dreamosWifi && typeof root.dreamosWifi.openConnections === 'function') { void root.dreamosWifi.openConnections(); return; }
        const cp = root.melatonControlPanel;
        if (!cp) return;
        if (target === 'connections') { cp.doAction('page:network'); return; }
        if (target.startsWith('item:')) cp.openItem(target.slice(5));
        else cp.doAction(target);
    }

    // ---- the platform ---------------------------------------------------------------------------------------

    const power = () => root.trayPower || null;
    const battery = () => { const p = power(); try { return p && p.present() ? p.state() : null; } catch (_) { return null; } };
    const hw = () => root.DreamOSHardware && typeof root.DreamOSHardware.get === 'function' ? root.DreamOSHardware : null;
    const netProvider = () => (root.melatonTray && root.melatonTray.provider('network')) || null;

    /**
     * A mobile PC (Vista: the firmware's mobile power platform role, not just a battery: the VM has a battery and
     * is a desktop). DreamOS is a laptop OS; the Android app's desktop shell runs on a phone.
     */
    function mobilePc() {
        return !!hw() || !!root.AndroidHardware;
    }

    const pct = (v) => { const p = Number(v); return Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null; };
    const parse = (v) => { if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };
    const androidDevice = () => root.AndroidDevice && typeof root.AndroidDevice.getBrightness === 'function' ? root.AndroidDevice : null;
    // the Android app's last brightness push ('dreamscape:radios' detail.brightness); read once from the bridge
    // before the first push (a bridge call waits on the app's main thread, so never on every paint)
    let androidBri = null;
    function androidBrightness() {
        if (androidBri) return androidBri;
        const d = androidDevice();
        if (!d) return null;
        try { androidBri = parse(d.getBrightness()); } catch (_) { androidBri = null; }
        return androidBri;
    }

    /** { percent, auto (null: no adaptive mode), canSet } of the display, or null when it has no control. */
    function brightnessState() {
        const h = hw();
        if (h) {
            try {
                const p = pct(h.get().backlight && h.get().backlight.percent);
                if (p !== null) return { percent: p, auto: null, canSet: typeof h.set === 'function' };
            } catch (_) { /* no backlight */ }
        }
        const a = androidBrightness();
        const p = a && pct(a.percent);
        if (p === null || p === undefined) return null;
        return { percent: p, auto: typeof a.auto === 'boolean' ? a.auto : null, canSet: a.canSet !== false };
    }

    function backlight() {
        const b = brightnessState();
        return b ? b.percent : null;
    }

    function setBrightness(v) {
        const h = hw();
        if (h && typeof h.set === 'function') { try { Promise.resolve(h.set('backlight', v)).catch(() => { /* the host pushes its state anyway */ }); } catch (_) { /* host gone */ } return; }
        const d = androidDevice();
        // the app sets the level only: adaptive brightness stays as it is (Yukimi, #945)
        if (d && typeof d.setBrightness === 'function') { try { d.setBrightness(v); } catch (_) { /* old app */ } }
    }

    function setAutoBrightness(on) {
        const d = androidDevice();
        if (d && typeof d.setAutoBrightness === 'function') { try { d.setAutoBrightness(!!on); } catch (_) { /* old app */ } }
    }

    function netState() {
        const p = netProvider();
        try { const s = p && p.get(); return s && typeof s === 'object' ? s : null; } catch (_) { return null; }
    }

    // the phone's last cellular state when the network provider has no mobile part (an app build without
    // AndroidWifi): the 'androiddevicestatus' push, read once from the bridge before the first one
    let cellPushed = null;
    function cellular() {
        if (!cellPushed && root.AndroidDeviceStatus && typeof root.AndroidDeviceStatus.getState === 'function') {
            try { const s = parse(root.AndroidDeviceStatus.getState()); cellPushed = s && s.cellular ? s.cellular : null; } catch (_) { cellPushed = null; }
        }
        return cellPushed;
    }

    /**
     * The mobile broadband connection: { carrier, type, bars 0-5, on, connected, roaming, radioOn, sim } or null with no
     * SIM / modem. The network provider's mobile part first (what the tray shows), else the cellular state.
     */
    function mobileState() {
        const c = cellular();
        const s = netState();
        const m = s && s.mobile && s.mobile.present ? s.mobile : null;
        if (m) {
            return {
                carrier: m.carrier || (c && c.operator) || '',
                type: m.generation || (c && c.dataType) || '',
                bars: barsOf(m.signalPercent),
                on: m.on !== false,
                connected: !!m.connected,
                roaming: !!m.roaming,
                airplane: !!(c && c.airplane)
            };
        }
        if (!c || !c.present || c.simState === 'absent') return null;
        const level = Number.isFinite(Number(c.level5)) ? Number(c.level5) : Number(c.level);
        return {
            carrier: c.operator || '',
            type: c.dataType || '',
            bars: Number.isFinite(level) ? Math.max(0, Math.min(5, Math.round(level))) : 0,
            on: c.dataEnabled !== false && c.radioOn !== false && !c.airplane,
            connected: !!c.dataActive,
            roaming: !!c.roaming,
            airplane: !!c.airplane
        };
    }

    function setMobileData(on) {
        const p = netProvider();
        if (p && typeof p.mobileData === 'function') return Promise.resolve(p.mobileData(on)).catch(() => null);
        const d = root.AndroidDevice;
        if (d && typeof d.setRadio === 'function') { try { d.setRadio('data', !!on); } catch (_) { /* old app */ } }
        return Promise.resolve(null);
    }

    // ---- the sync partnership (ActiveSync) ---------------------------------------------------------------------

    const activeSync = () => (root.activeSync && typeof root.activeSync.state === 'function' ? root.activeSync : null);

    /** The phone this DeX window runs on (Continuity, #798): its Device ID, or ''. */
    function continuityId() {
        try {
            const H = root.AndroidHome;
            if (H && typeof H.getContinuity === 'function') {
                const c = parse(H.getContinuity());
                return c && c.hybrid && c.external && c.deviceId ? String(c.deviceId).toLowerCase() : '';
            }
        } catch (_) { /* older app */ }
        return '';
    }

    /** The partner shown: the Continuity phone first, then a connected partner, then any. Null with none. */
    function partner() {
        const a = activeSync();
        if (!a) return null;
        let list;
        try { list = (a.state().devices || []).filter((d) => d && d.partner); } catch (_) { return null; }
        if (!list.length) return null;
        const cid = continuityId();
        const dev = (cid && list.find((d) => String(d.deviceId).toLowerCase() === cid)) || list.find((d) => d.online) || list[0];
        return { dev, local: !!(cid && String(dev.deviceId).toLowerCase() === cid), count: list.length };
    }

    function shortTime(ms) {
        const d = new Date(ms);
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return d.toDateString() === new Date().toDateString() ? time : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    }

    function openDeviceCenter(deviceId) {
        const apps = root.melatonApps;
        if (apps && typeof apps.launch === 'function') { void apps.launch({ packageId: 'activesync', ...(deviceId ? { args: { deviceId } } : {}) }); return true; }
        return false;
    }

    function wifiPresent() {
        const s = netState();
        return !!(s && s.wifi && s.wifi.present);
    }

    // ---- tiles ----------------------------------------------------------------------------------------------

    /*
     * Each tile: id, title (mblctr.exe.mui 90-97 without the mnemonic), tip (500-510, the icon's tooltip),
     * show() whether it is on screen, html() its status and control, paint(el) the state, wire(el) once.
     */
    const TILES = [
        {
            id: 'brightness', title: 'Display Brightness', tip: 'Change display brightness settings for your power plan.',
            open: 'page:power-options:plan',
            show: () => backlight() !== null || mobilePc(),
            // the Automatic box (Android's adaptive brightness) sits where Volume has Mute
            html: () => `<div class="mbl-tile-status"><span data-f="status"></span><input type="checkbox" id="mblAutoBri" data-f="auto" hidden><label for="mblAutoBri" data-f="auto-label" hidden>Automatic</label></div>
                <div class="mbl-tile-control mbl-slider"><input type="range" class="vista-trackbar-top" min="0" max="100" step="1" data-f="range" aria-label="Brightness"></div>`,
            paint(el) {
                const b = brightnessState();
                const p = b ? b.percent : null;
                const range = el.querySelector('[data-f="range"]');
                const auto = el.querySelector('[data-f="auto"]');
                const hasAuto = !!(b && b.auto !== null);
                el.classList.toggle('is-unavailable', p === null);
                setSrc(el.querySelector('.mbl-tile-icon img'), `${ART}/brightness.png`);
                setText(el.querySelector('[data-f="status"]'), p === null ? 'Display brightness is unavailable' : '');
                auto.hidden = !hasAuto;
                el.querySelector('[data-f="auto-label"]').hidden = !hasAuto;
                if (hasAuto) auto.checked = !!b.auto;
                range.disabled = p === null || !b.canSet;
                auto.disabled = !b || !b.canSet;
                if (p !== null && briSend === null && !range.dataset.drag) range.value = String(p);
            },
            wire(el) {
                const range = el.querySelector('[data-f="range"]');
                range.addEventListener('input', () => {
                    const first = briSend === null;
                    briSend = Number(range.value);
                    if (!first) return;
                    root.requestAnimationFrame(() => {
                        const v = briSend;
                        briSend = null;
                        setBrightness(v);
                    });
                });
                el.querySelector('[data-f="auto"]').addEventListener('change', (ev) => setAutoBrightness(ev.target.checked));
            }
        },
        {
            id: 'volume', title: 'Volume', tip: 'Change audio settings.',
            open: 'item:sound',
            show: () => true,
            html: () => `<div class="mbl-tile-status"><input type="checkbox" id="mblMute" data-f="mute"><label for="mblMute">Mute</label></div>
                <div class="mbl-tile-control mbl-slider mbl-volume"><input type="range" class="vista-trackbar-top" min="0" max="100" step="1" data-f="range" aria-label="Volume"></div>`,
            paint(el) {
                const tv = root.tabVolume;
                const none = !tv;
                el.classList.toggle('is-unavailable', none);
                const muted = !none && tv.isMuted();
                setSrc(el.querySelector('.mbl-tile-icon img'), `${ART}/${muted ? 'volume-muted' : 'volume'}.png`);
                const mute = el.querySelector('[data-f="mute"]');
                const range = el.querySelector('[data-f="range"]');
                mute.disabled = none;
                range.disabled = none;
                if (none) return;
                mute.checked = muted;
                if (volSend === null && !range.dataset.drag) range.value = String(tv.getLevel());
            },
            wire(el) {
                const range = el.querySelector('[data-f="range"]');
                el.querySelector('[data-f="mute"]').addEventListener('change', (ev) => {
                    if (root.tabVolume) root.tabVolume.setMuted(ev.target.checked);
                });
                // tabVolume sends the newest level to a volume provider one request at a time; this keeps the
                // page work to one setLevel per frame while dragging
                range.addEventListener('input', () => {
                    const first = volSend === null;
                    volSend = Number(range.value);
                    if (!first) return;
                    root.requestAnimationFrame(() => {
                        const v = volSend;
                        volSend = null;
                        if (root.tabVolume) root.tabVolume.setLevel(v);
                    });
                });
            }
        },
        {
            id: 'battery', title: 'Battery Status', tip: 'Change power settings.',
            open: 'page:power-options',
            show: () => !!battery(),
            iconHtml: '<span class="power-flyout-battery mbl-battery" data-f="battery"></span>',
            html: () => `<div class="mbl-tile-status" data-f="status"></div>
                <div class="mbl-tile-control"><button type="button" class="custom-dropdown-btn vista-combo-list" data-f="plan" aria-label="Select a power plan"><span data-f="plan-name"></span></button></div>`,
            paint(el) {
                const p = power();
                const m = battery();
                if (!p) return;
                const f = typeof p.frames === 'function' ? p.frames(m) : { big: 26, bigMark: null };
                const icon = el.querySelector('[data-f="battery"]');
                icon.style.setProperty('--power-big', String(f.big));
                icon.style.setProperty('--power-big-mark', String(f.bigMark === null ? 0 : f.bigMark));
                if (f.bigMark === null) delete icon.dataset.mark; else icon.dataset.mark = '1';
                setText(el.querySelector('[data-f="status"]'), p.statusText());
                const active = typeof p.activePlan === 'function' ? p.activePlan() : '';
                const name = typeof p.planName === 'function' ? p.planName(active) : '';
                setText(el.querySelector('[data-f="plan-name"]'), name);
                const btn = el.querySelector('[data-f="plan"]');
                btn.setAttribute('aria-label', `Select a power plan. Your current selection is ${name}`);
            },
            wire(el) {
                const btn = el.querySelector('[data-f="plan"]');
                const cm = root.contextMenu;
                if (!cm || typeof cm.attachPickerMenu !== 'function') { btn.disabled = true; return; }
                cm.attachPickerMenu(btn, {
                    items: () => { const p = power(); return p && typeof p.plans === 'function' ? p.plans().map((x) => ({ value: x.id, text: x.name })) : []; },
                    value: () => { const p = power(); return p && typeof p.activePlan === 'function' ? p.activePlan() : ''; },
                    onSelect: (value) => { const p = power(); if (p && typeof p.setPlan === 'function') p.setPlan(String(value)); paintAll(); }
                });
            }
        },
        {
            id: 'wireless', title: 'Wireless Network', tip: 'Change wireless network settings.',
            open: 'page:network',
            show: () => wifiPresent() || mobilePc(),
            html: () => `<div class="mbl-tile-status" data-f="status"></div>
                <div class="mbl-tile-control"><button type="button" data-f="radio"></button></div>`,
            paint(el) {
                const s = netState();
                const wifi = s && s.wifi && s.wifi.present ? s.wifi : null;
                const p = netProvider();
                const img = el.querySelector('.mbl-tile-icon img');
                const btn = el.querySelector('[data-f="radio"]');
                el.classList.toggle('is-unavailable', !wifi);
                if (!wifi) {
                    setSrc(img, `${ART}/wireless-none.png`);
                    setText(el.querySelector('[data-f="status"]'), 'No wireless adapter found');
                    setText(btn, 'Turn wireless on');
                    btn.disabled = true;
                    return;
                }
                const off = wifi.radio === false || wifi.state === 'off';
                const connected = wifi.state === 'connected' && wifi.network;
                const bars = connected ? barsOf(wifi.network.signalPercent) : 0;
                setSrc(img, `${ART}/${off ? 'wireless-off' : `wireless-${bars}`}.png`);
                setText(el.querySelector('[data-f="status"]'), off ? 'Wireless off' : connected ? 'Connected' : 'Not connected');
                img.setAttribute('alt', off ? '' : `Current status is ${connected ? 'Connected' : 'Not connected'} and connection strength is ${STRENGTH[bars]}`);
                setText(btn, off ? 'Turn wireless on' : 'Turn wireless off');
                const can = p && typeof p.can === 'function' ? (() => { try { return p.can() || {}; } catch (_) { return {}; } })() : {};
                btn.disabled = !(p && typeof p.radio === 'function') || can.radio === false;
            },
            wire(el) {
                const btn = el.querySelector('[data-f="radio"]');
                btn.addEventListener('click', () => {
                    const p = netProvider();
                    const s = netState();
                    if (!p || typeof p.radio !== 'function' || !s || !s.wifi) return;
                    const off = s.wifi.radio === false || s.wifi.state === 'off';
                    btn.disabled = true;
                    Promise.resolve(p.radio(off)).catch(() => null).then(() => paintTile('wireless'));
                });
            }
        },
        {
            id: 'mobile', title: 'Mobile Broadband', tip: 'Change mobile broadband settings.',
            open: 'connections',
            show: () => !!mobileState(),
            html: () => `<div class="mbl-tile-status" data-f="status"></div>
                <div class="mbl-tile-control"><button type="button" data-f="data"></button></div>`,
            paint(el) {
                const m = mobileState();
                if (!m) return;
                const img = el.querySelector('.mbl-tile-icon img');
                const btn = el.querySelector('[data-f="data"]');
                const off = !m.on;
                // the carrier and the data class on the first line, the state on the second (Windows 7's
                // flyout names the provider; the phone's bar names the data class)
                const name = [m.carrier, m.type].filter(Boolean).join(' ') || 'Mobile broadband';
                const state = m.airplane ? 'Airplane mode' : off ? 'Mobile data off' : m.roaming ? 'Roaming' : m.connected ? 'Connected' : 'Not connected';
                setSrc(img, `${ART}/${off ? 'wireless-off' : `wireless-${m.bars}`}.png`);
                const st = el.querySelector('[data-f="status"]');
                const html = `<span>${esc(name)}<br>${esc(state)}</span>`;
                if (st.dataset.html !== html) { st.dataset.html = html; st.innerHTML = html; }
                img.setAttribute('alt', `Current status is ${state} and signal strength is ${STRENGTH[m.bars]}`);
                setText(btn, off ? 'Turn mobile data on' : 'Turn mobile data off');
                btn.disabled = m.airplane || !(netProvider() && typeof netProvider().mobileData === 'function') && !(root.AndroidDevice && typeof root.AndroidDevice.setRadio === 'function');
            },
            wire(el) {
                const btn = el.querySelector('[data-f="data"]');
                btn.addEventListener('click', () => {
                    const m = mobileState();
                    if (!m) return;
                    btn.disabled = true;
                    setMobileData(!m.on).then(() => paintTile('mobile'));
                });
            }
        },
        {
            id: 'display', title: 'External Display', tip: 'Change display settings.',
            open: 'page:personalization',
            show: () => true,
            html: () => `<div class="mbl-tile-status" data-f="status"></div>
                <div class="mbl-tile-control"><button type="button" data-f="connect" disabled>Connect display</button></div>`,
            paint(el) {
                // screen.isExtended: the browser knows whether another display is attached (no permission needed)
                const ext = !!(root.screen && root.screen.isExtended);
                setSrc(el.querySelector('.mbl-tile-icon img'), `${ART}/${ext ? 'display-one' : 'display-none'}.png`);
                setText(el.querySelector('[data-f="status"]'), ext ? 'Display connected' : 'No display connected');
            },
            wire() { /* Connect display: Melaton cannot drive a display (nothing to detect or extend to) */ }
        },
        {
            id: 'sync', title: 'Sync Center', tip: 'Change synchronization settings.',
            open: 'page:sync-center',
            show: () => true,
            html: () => `<div class="mbl-tile-status" data-f="status">No sync partnerships</div>
                <div class="mbl-tile-control"><button type="button" data-f="sync">Sync settings</button></div>`,
            paint(el) {
                setSrc(el.querySelector('.mbl-tile-icon img'), `${ART}/sync.png`);
                // the partnership Mobile Device Center shows; in Continuity the phone is this handheld (#798)
                const p = partner();
                const st = el.querySelector('[data-f="status"]');
                let html = 'No sync partnerships';
                if (p) {
                    const d = p.dev;
                    const second = p.local ? (d.lastSync ? `Synced ${shortTime(d.lastSync)}` : 'This handheld')
                        : !d.online ? 'Not connected'
                            : d.lastSync ? `Synced ${shortTime(d.lastSync)}` : 'Connected';
                    html = `<span>${esc(d.name || 'Mobile device')}<br>${esc(second)}</span>`;
                }
                if (st.dataset.html !== html) { st.dataset.html = html; st.innerHTML = html; }
                el.dataset.device = p ? p.dev.deviceId : '';
            },
            wire(el) {
                el.querySelector('[data-f="sync"]').addEventListener('click', () => {
                    // a partnership's settings are Mobile Device Center's; none: Sync Center
                    if (el.dataset.device && openDeviceCenter(el.dataset.device)) return;
                    openCpl('page:sync-center');
                });
            }
        },
        {
            id: 'presentation', title: 'Presentation Settings', tip: 'Change presentation settings.',
            open: null,
            show: () => mobilePc(),
            html: () => `<div class="mbl-tile-status">Not presenting</div>
                <div class="mbl-tile-control"><button type="button" disabled>Turn on</button></div>`,
            // nothing in Melaton acts on presenting yet (screen saver, notifications, wallpaper): unavailable
            paint(el) { el.classList.add('is-unavailable'); setSrc(el.querySelector('.mbl-tile-icon img'), `${ART}/presentation-off.png`); },
            wire() { /* nothing to turn on */ }
        }
    ];

    /** 0-5 bars from a 0-100 signal, as dreamosNetTray.js counts them. */
    function barsOf(percent) {
        const p = Number(percent);
        if (!Number.isFinite(p) || p <= 0) return 0;
        if (p >= 80) return 5;
        if (p >= 60) return 4;
        if (p >= 40) return 3;
        if (p >= 20) return 2;
        return 1;
    }

    /** A slider being dragged keeps its own value until it is let go (the host's echo may lag behind). */
    function holdWhileDragging(range) {
        range.addEventListener('pointerdown', () => { range.dataset.drag = '1'; });
        const end = () => { delete range.dataset.drag; };
        range.addEventListener('pointerup', end);
        range.addEventListener('pointercancel', end);
        range.addEventListener('change', end);
    }

    function tileHtml(t) {
        const icon = t.iconHtml || '<img src="" alt="" draggable="false">';
        return `<div class="mbl-tile" data-tile="${t.id}" role="group" aria-label="${esc(t.title)}">
            <button type="button" class="mbl-tile-icon" title="${esc(t.tip)}"${t.open ? '' : ' disabled'}>${icon}</button>
            ${t.html()}
            <div class="mbl-tile-rule"></div>
            <div class="mbl-tile-title">${esc(t.title)}</div>
        </div>`;
    }

    function tileEl(id) { return win ? win.querySelector(`.mbl-tile[data-tile="${id}"]`) : null; }

    function paintTile(id, force) {
        if (doc.hidden && force !== true) { stale = true; return; }
        const t = TILES.find((x) => x.id === id);
        const el = tileEl(id);
        if (t && el) { try { t.paint(el); } catch (e) { console.error('[mobilityCenter]', id, e); } }
    }

    /**
     * Builds the tiles again when the set changes (a battery comes or goes), else repaints them. A push while the
     * page is out of sight draws nothing; the page coming back draws it all (no off-screen redraws). Opening the
     * window always draws (force).
     */
    function paintAll(force) {
        if (!win) return;
        if (doc.hidden && force !== true) { stale = true; return; }
        stale = false;
        const list = TILES.filter((t) => { try { return t.show(); } catch (_) { return false; } });
        const ids = list.map((t) => t.id).join(',');
        const grid = win.querySelector('.mbl-tiles');
        if (ids !== shown) {
            shown = ids;
            grid.innerHTML = list.map(tileHtml).join('');
            win.style.setProperty('--mbl-cols', String(Math.max(1, Math.min(4, list.length))));
            win.style.setProperty('--mbl-rows', String(Math.max(1, Math.ceil(list.length / 4))));
            list.forEach((t) => {
                const el = tileEl(t.id);
                if (!el) return;
                t.wire(el);
                el.querySelectorAll('input[type="range"]').forEach(holdWhileDragging);
            });
        }
        list.forEach((t) => paintTile(t.id, true));
    }

    // ---- the window -----------------------------------------------------------------------------------------

    function build() {
        // desktopAppCreateWindow: public/scripts/comp/desktop-apps/desktopAppWindow.js (the shared builder)
        const w = root.desktopAppCreateWindow({
            id: 'mobilityCenterModal',
            identifier: 'mobilityCenter',
            title: TITLE,
            icon16: ICON16,
            taskbarIcon: ICON32,
            className: 'mbl-window',
            fixed: true,
            minimize: true
        });
        const m = w.modal;
        // Vista's mblctr has a maximize box, always disabled
        const min = m.querySelector('.modal-window-controls .minimize-btn');
        if (min) {
            const max = doc.createElement('button');
            max.type = 'button';
            max.className = 'btn-secondary btn-small mbl-max-btn';
            max.title = 'Maximize';
            max.disabled = true;
            max.innerHTML = '<i class="fa-regular fa-window-maximize"></i>';
            min.after(max);
        }
        w.content.classList.add('mbl-client');
        w.content.innerHTML = `<div class="mbl-tiles"></div>
            <button type="button" class="mbl-help" title="Help" aria-label="Help"><img src="${ART}/help-16.png" alt="" draggable="false"></button>`;
        w.close.addEventListener('click', close);
        m.addEventListener('click', (ev) => {
            const icon = ev.target.closest('.mbl-tile-icon');
            if (icon && !icon.disabled) {
                const t = TILES.find((x) => x.id === icon.closest('.mbl-tile').dataset.tile);
                if (t && t.open) openCpl(t.open);
                return;
            }
            if (ev.target.closest('.mbl-help')) call('openHelpAndSupport', 'mobility-center');
        });
        m.addEventListener('keydown', (ev) => {
            if (ev.key === 'F1') { ev.preventDefault(); call('openHelpAndSupport', 'mobility-center'); }
        });
        return m;
    }

    /** The sources, while the window is open (nothing runs while it is closed). */
    function subscribe() {
        const ac = new AbortController();
        const opt = { signal: ac.signal };
        offs.push(() => ac.abort());
        if (appScopeSignal) appScopeSignal.addEventListener('abort', () => ac.abort(), { once: true, signal: ac.signal });
        // the battery (it brings the Battery Status tile) and the plan
        root.addEventListener('melaton-battery', paintAll, opt);
        root.addEventListener('melaton-power-plan', () => paintTile('battery'), opt);
        // DreamOS's hardware push: the backlight
        root.addEventListener('dreamoshw', () => paintTile('brightness'), opt);
        // the Android app's radios push carries the brightness (#945)
        root.addEventListener('dreamscape:radios', (ev) => {
            const b = ev && ev.detail && parse(ev.detail.brightness);
            if (!b) return;
            androidBri = b;
            paintTile('brightness');
        }, opt);
        // the phone's cellular state (an app build whose network provider has no mobile part)
        // (the push also comes for battery and data-moving changes: only a change the tile draws repaints it)
        let cellKey = '';
        root.addEventListener('androiddevicestatus', (ev) => {
            const d = ev && parse(ev.detail);
            const c = d && d.cellular;
            if (!c) return;
            cellPushed = c;
            const key = [c.present, c.simState, c.operator, c.dataType, c.level5, c.level, c.dataEnabled, c.dataActive, c.radioOn, c.roaming, c.airplane].join('|');
            if (key === cellKey) return;
            cellKey = key;
            paintAll();
        }, opt);
        doc.addEventListener('visibilitychange', () => { if (!doc.hidden && stale) paintAll(); }, opt);
        // a second display attached or removed
        if (root.screen && typeof root.screen.addEventListener === 'function') root.screen.addEventListener('change', () => paintTile('display'), opt);
        if (root.melatonTray) {
            offs.push(root.melatonTray.onChange('network', paintAll));
        }
        const as = activeSync();
        if (as && typeof as.on === 'function') offs.push(as.on('state', () => paintTile('sync')));
        const tv = root.tabVolume;
        if (tv && typeof tv.onChange === 'function') {
            const off = tv.onChange(() => paintTile('volume'));
            if (typeof off === 'function') offs.push(off);
        }
    }

    function unsubscribe() {
        offs.forEach((off) => { try { off(); } catch (_) { /* gone */ } });
        offs = [];
    }

    function open() {
        if (!doc || typeof root.desktopAppCreateWindow !== 'function') return null;
        if (win && win.isConnected) {
            if (win.classList.contains('minimised')) call('restoreMinimizedModal', win, call('getOrCreateTaskbarItem', win) || null);
            call('bringModalToFront', win);
            paintAll(true);
            return win;
        }
        win = build();
        shown = '';
        // the bridge's state is read again for a new window (no pushes are heard while it is closed)
        androidBri = null;
        cellPushed = null;
        paintAll(true);
        subscribe();
        call('openModal', win);
        win.classList.remove('hidden');
        let placed = false;
        const place = () => {
            if (placed || !win) return;
            placed = true;
            const r = win.getBoundingClientRect();
            const taskbar = doc.getElementById('taskbar');
            const workH = root.innerHeight - (taskbar ? taskbar.getBoundingClientRect().height : 0);
            // Vista centres it in the work area
            call('setModalOffsetsFromViewportTopLeft', win, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((workH - r.height) / 2)));
        };
        root.requestAnimationFrame(() => {
            place();
            // Vista starts with the first tile's icon focused
            const first = win && win.querySelector('.mbl-tile-icon:not(:disabled)');
            if (first) first.focus({ preventScroll: true });
        });
        if (root.programFaults && root.programFaults.registerProgram) {
            root.programFaults.registerProgram(win.id, { name: TITLE, terminate: close, relaunch: open });
        }
        return win;
    }

    function close() {
        if (!win) return;
        const m = win;
        win = null;
        shown = '';
        unsubscribe();
        Promise.resolve(call('closeModal', m)).finally(() => setTimeout(() => m.remove(), 300));
    }

    if (appScopeSignal) appScopeSignal.addEventListener('abort', () => { unsubscribe(); if (win) { win.remove(); win = null; } }, { once: true });

    // Control Panel: Vista lists Mobility Center under Mobile PC (Melaton: Hardware and Sound, cplCatalog.js)
    if (root.melatonControlPanel && typeof root.melatonControlPanel.registerItem === 'function') {
        root.melatonControlPanel.registerItem({
            id: 'mobility-center',
            name: TITLE,
            image: `${ART}/mblctr-48.png`,
            description: 'Adjust display brightness, volume, power options, and other commonly used mobile PC settings.',
            open
        });
    }

    root.melatonMobilityCenter = { open, close, _test: { TILES, barsOf, mobilePc } };
})(typeof window !== 'undefined' ? window : globalThis);
