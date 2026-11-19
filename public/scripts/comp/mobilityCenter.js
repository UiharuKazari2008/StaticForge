/*
 * Melaton Mobility Center (#932, #910): Vista's Windows Mobility Center (mblctr.exe), 1:1 with the VM.
 *
 *   Window      a fixed sheet of frame glass (mblctr extends the frame over its whole client) holding a row of
 *               146 x 120 tiles, at most four to a row, and the help button at the bottom right. Centred in the
 *               work area, one instance (Vista raises the open one).
 *   Tiles       Vista's order: Display Brightness, Volume, Battery Status, Wireless Network, External Display,
 *               Sync Center, Presentation Settings (Screen Orientation is a Tablet PC tile: not shown, as on the
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
 *                              'dreamoshw' events. Elsewhere unavailable.
 *                 volume       tabVolume.js (the volume tray provider when there is one, else the tab's own
 *                              level and mute; it coalesces a drag into one request at a time)
 *                 battery      trayPower.js's model and plans ('melaton-battery', 'melaton-power-plan')
 *                 wireless     the 'network' tray provider (melatonTray.onChange): radio(on) turns it off / on
 *                 display      window.screen.isExtended and the screen's 'change' event
 *                 sync         Sync Center (cplPages2.js): no partnerships, as on the VM
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
        const cp = root.melatonControlPanel;
        if (!cp) return;
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

    function backlight() {
        const h = hw();
        if (!h) return null;
        try {
            const b = h.get().backlight;
            const p = b && Number(b.percent);
            return Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null;
        } catch (_) { return null; }
    }

    function netState() {
        const p = netProvider();
        try { const s = p && p.get(); return s && typeof s === 'object' ? s : null; } catch (_) { return null; }
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
            html: () => `<div class="mbl-tile-status"></div>
                <div class="mbl-tile-control mbl-slider"><input type="range" class="vista-trackbar-top" min="0" max="100" step="1" data-f="range" aria-label="Brightness"></div>`,
            paint(el) {
                const p = backlight();
                const range = el.querySelector('[data-f="range"]');
                el.classList.toggle('is-unavailable', p === null);
                setSrc(el.querySelector('.mbl-tile-icon img'), `${ART}/brightness.png`);
                setText(el.querySelector('.mbl-tile-status'), p === null ? 'Display brightness is unavailable' : '');
                range.disabled = p === null;
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
                        const h = hw();
                        if (h && typeof h.set === 'function') { try { Promise.resolve(h.set('backlight', v)).catch(() => { /* the host pushes its state anyway */ }); } catch (_) { /* host gone */ } }
                    });
                });
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
            html: () => `<div class="mbl-tile-status">No sync partnerships</div>
                <div class="mbl-tile-control"><button type="button" data-f="sync">Sync settings</button></div>`,
            paint(el) { setSrc(el.querySelector('.mbl-tile-icon img'), `${ART}/sync.png`); },
            wire(el) { el.querySelector('[data-f="sync"]').addEventListener('click', () => openCpl('page:sync-center')); }
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
        doc.addEventListener('visibilitychange', () => { if (!doc.hidden && stale) paintAll(); }, opt);
        // a second display attached or removed
        if (root.screen && typeof root.screen.addEventListener === 'function') root.screen.addEventListener('change', () => paintTile('display'), opt);
        if (root.melatonTray) {
            offs.push(root.melatonTray.onChange('network', paintAll));
        }
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
