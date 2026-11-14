/**
 * Melaton Mobile Device Center (Yozora #747): Windows Mobile Device Center 6.1 as Vista shows it,
 * for Android phones running the Dreamscape app. Layout, art and wording from the VM
 * (~/.cache/vista-vm/wmdc-ref: stage 786 x 534), Windows -> Melaton and Microsoft -> Xyridian. The
 * frame is Melaton's own: Back, the bread crumbs and Help sit in the shared title toolbar. The connection itself is public/scripts/comp/activeSyncAgent.js
 * (window.activeSync) and modules/activeSync.js.
 *
 *   no device connected   the two phones, "Not Connected", Mobile Device Settings
 *   a new device          the device, "Connected", and the choice: "Set up your device" (a
 *                         partnership: the device is named, the phone's user agrees) or "Connect
 *                         without setting up your device" (a guest, for this connection)
 *   connected             the tiles; a tile opens under the pointer and lists its tasks. Other files
 *                         add tasks with melatonActiveSync.addTask(tile, task)
 *   notifications         the device's own notifications (activeSyncNotifications.js), with Dismiss
 *   bread crumbs          Home > Quick Connect (a guest) or Home > the partnership's name; with
 *                         several devices the last crumb is a menu of them
 *
 *   melatonApps.define('activesync', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const A = '/melaton-apps/activesync/assets';
    const A_ASSETS = A;
    const NAME = 'Melaton Mobile Device Center';
    const REG = 'HKCU\\Software\\Xyridian\\Melaton Mobile Device Center';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const as = () => root.activeSync || null;

    // tasks other files add to a tile: { id, text, icon, when(device) -> bool, run(device, center) }
    const extraTasks = { programs: [], media: [], files: [], settings: [] };
    // wmdc.exe.mui DIALOG 102 (Connection Settings), from the VM (~/.cache/vista-vm/wmdc-ref/res/pe); OK carries
    // BS_DEFPUSHBUTTON, the default the dialog manager gives IDOK. Melaton's own row 1020 (#827, Yukimi):
    // the device's picture shows its wallpapers (the default) or ADB screenshots; the dialog grows 13 units for it
    const CONNECTION_SETTINGS_TPL = {"t":"Connection Settings","w":304,"h":172,"f":["MS Shell Dlg",8],"s":13116360,"c":[[1011,"S",5,4,8,8,1342177419,"Device status icon",0],[1002,"S",5,5,21,20,1342177411,"#2000",0],[1003,"S",31,4,255,10,1342308352,"Waiting for device to connect",0],[1014,"S",31,14,255,10,1073872896,"Some settings may be disabled by Group Policy",0],[-1,"S",5,30,294,1,1342177424,"",0],[1006,"B",5,39,281,9,1342252035,"Allow &USB connections",0],[1007,"B",5,52,281,9,1342251011,"Allow co&nnections to one of the following:",0],[1012,"S",17,60,8,8,1342177419,"Connection selection dropdown",0],[1008,"C",17,63,135,92,1344339971,"",0],[-1,"S",5,79,281,10,1342308352,"This computer is connected &to:",0],[1009,"C",5,89,147,92,1344339971,"",0],[1016,"B",6,107,280,11,1342242819,"Allow auto&matic device authentication",0],[1013,"B",6,120,280,11,1342242819,"Allow &data connections on device when connected to PC",0],[1020,"B",6,133,280,11,1342242819,"Show the device's &wallpaper, not screenshots",0],[-1,"S",5,146,294,1,1342177424,"",0],[1,"B",194,154,50,14,1342242817,"OK",0],[2,"B",249,154,50,14,1342242816,"Cancel",0]]};
    const TILES = [
        { id: 'programs', title: 'Programs and Services', icon: 'programs-64.png' },
        { id: 'media', title: 'Pictures, Music and Video', icon: 'media-64.png' },
        { id: 'files', title: 'File Management', icon: 'files-64.png' },
        { id: 'settings', title: 'Mobile Device Settings', icon: 'settings-64.png' }
    ];

    function bytes(n) {
        if (n == null || !Number.isFinite(Number(n))) return '';
        const u = ['bytes', 'KB', 'MB', 'GB', 'TB'];
        let v = Number(n);
        let i = 0;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
        return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${u[i]}`;
    }

    function when(ms) {
        if (!ms) return 'Never';
        const d = new Date(ms);
        const today = new Date();
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return d.toDateString() === today.toDateString() ? `Today at ${time}` : `${d.toLocaleDateString()} at ${time}`;
    }

    /** Classic / Standard / Professional / Enterprise (activeSync.edition); Continuity once used is kept by the server. */
    function editionOf(dev) {
        const st = (dev && dev.status) || {};
        const seen = !!(dev && dev.settings && dev.settings.continuitySeen);
        if (seen) return 'Enterprise';
        if (st.edition) return st.edition;
        const a = as();
        const D = art();
        const facts = { cellular: !!(st.cellular && st.cellular.present), foldable: !!(D && D.isFoldable(dev)), multiScreen: false, continuity: false };
        return a && typeof a.edition === 'function' ? a.edition(facts) : '';
    }

    /** WMDC's own sync line (ToastLastSyncTodayAtTime / ToastLastSyncDateAtTime); nothing before the first sync. */
    function lastSyncLine(ms) {
        if (!ms) return '';
        const d = new Date(ms);
        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return d.toDateString() === new Date().toDateString() ? `Last sync: Today at ${time}` : `Last sync: ${d.toLocaleDateString()} at ${time}`;
    }

    function batteryArt(b) {
        if (!b || b.level == null) return 'battery-5';
        return `battery-${b.level < 10 ? 0 : b.level < 35 ? 1 : b.level < 60 ? 2 : b.level < 85 ? 3 : 4}`;
    }

    /**
     * The device's picture (#818, #827): public/scripts/comp/activeSyncDeviceArt.js draws it (shared
     * with the Sidebar's Mobile Device gadgets), loaded as the feature 'activesync_device_art'.
     */
    const art = () => root.activeSyncDeviceArt || null;
    function loadArt() {
        if (art()) return Promise.resolve(art());
        const fl = root.featureLoader;
        if (!fl || typeof fl.loadFeature !== 'function') return Promise.resolve(null);
        return fl.loadFeature('activesync_device_art').then(() => art(), () => null);
    }

    /** Mobile Device Settings > Connection settings (#827): screenshots in the picture, else the wallpapers (the default). */
    function showScreenshots() {
        const reg = root.melatonRegistry;
        const v = reg ? reg.get(REG, 'ShowScreenshots', 0) : 0;
        return Number(v) === 1;
    }

    class Center {
        constructor(app) {
            this.app = app;
            this.deviceId = (app.args && app.args.deviceId) || null;
            this.page = null;       // null (the home for the device's state) | 'setup' | 'working' | 'done' | 'info'
            // the Sidebar's Mobile Device gadgets open a page of their own (#827)
            if (app.args && (app.args.page === 'info' || app.args.page === 'notifications')) this.page = app.args.page;
            this.open = null;       // the open tile
            this.busy = false;      // waiting for the phone's answer
            this.frame = 0;
            this.screens = { deviceId: null, form: 'phone', urls: {}, blobs: [], at: 0, loading: false, key: '', wallAt: 0, shots: false, waitFrom: 0 };
            this.arriveUntil = 0;
            this.build();
            // the picture's art loads with the window (a feature of its own, shared with the gadgets)
            loadArt().then(() => this.render());
            // screenshots in the picture: on opening, on a new device, then once a minute while the
            // window is up (no faster: #811 no client polling under 60 s). Wallpapers come from the
            // server (#827) and change only when the phone sends new ones (the device's wallpapersAt).
            const shotTimer = setInterval(() => { if (!doc.hidden && showScreenshots()) this.loadScreens(true); }, 60000);
            this.app.signal.addEventListener('abort', () => { clearInterval(shotTimer); clearTimeout(this.foldTimer); this.screens.blobs.forEach((u) => URL.revokeObjectURL(u)); });
            const a = as();
            if (a) {
                const off = a.on('state', () => this.render());
                app.signal.addEventListener('abort', off);
                a.refresh().catch(() => { /* a read-only logon lists nothing */ });
            }
            if (root.activeSyncNotifications) {
                const offN = root.activeSyncNotifications.on(() => this.render());
                app.signal.addEventListener('abort', offN);
            }
            this.render();
        }

        build() {
            const m = doc.createElement('div');
            // a window with a title toolbar, as every Melaton window that has one (Explorer, Calculator):
            // toolbar-visible + .modal-window-title-toolbar with plain shared buttons (modal-window-title-toolbar.css)
            m.className = 'modal toolbar-visible hidden asdc-window';
            m.dataset.windowIdentifier = 'melatonMobileDeviceCenter';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = `${A}/activesync-32.png`;
            // one size: a stored place is kept, a stored size never applies
            m.dataset.windowDefaultWidth = '800';
            m.dataset.windowDefaultHeight = '600';
            m.dataset.windowFixedSize = 'true';
            m.style.width = '800px';
            m.style.height = '600px'; // the VM's 800 x 600: caption and toolbar band to y=57, the 784 x 535 client, the 8 px frame
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', NAME);
            m.innerHTML = `
                <div class="modal-window-title">
                    <div class="modal-window-title-main"><i class="fas fa-mobile-screen icon-fa"></i><img class="icon-image" src="${A}/activesync-16.png" alt=""><span>${NAME}</span></div>
                    <div class="modal-window-title-toolbar">
                        <button type="button" class="btn-secondary asdc-back" data-asdc="back" title="Back" disabled><i class="fas fa-arrow-left"></i></button>
                        <div class="asdc-crumbs"></div>
                        <button type="button" class="btn-secondary asdc-help" title="Help"><i class="fas fa-circle-question"></i></button>
                    </div>
                </div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary maximize-btn btn-small" title="Maximize" disabled><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small asdc-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content asdc-client">
                    <div class="asdc-root">
                        <div class="asdc-stage">
                            <div class="asdc-logo"><img src="/static_images/wm61/boot-melaton.png" alt=""><b>Melaton</b><i>Mobile</i></div>
                            <div class="asdc-device" aria-hidden="true"></div>
                            <div class="asdc-status"><img alt=""><span></span></div>
                            <div class="asdc-sync"></div>
                            <div class="asdc-body"></div>
                        </div>
                    </div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            const sig = { signal: this.app.signal };
            const q = (s) => m.querySelector(s);
            this.el = q;
            m.addEventListener('click', (ev) => {
                const t = ev.target.closest('[data-asdc]');
                if (t && !t.disabled) void this.command(t.dataset.asdc, t);
            }, sig);
            // a tile opens under the pointer (and by keyboard focus) and closes when the pointer leaves the column
            q('.asdc-body').addEventListener('mouseover', (ev) => {
                const tile = ev.target.closest('.asdc-tile');
                if (tile) this.openTile(tile.dataset.tile);
            }, sig);
            q('.asdc-body').addEventListener('focusin', (ev) => {
                const tile = ev.target.closest('.asdc-tile');
                if (tile) this.openTile(tile.dataset.tile);
            }, sig);
            q('.asdc-stage').addEventListener('mouseleave', () => this.openTile(null), sig);
            q('.asdc-device').addEventListener('click', () => this.toggleFold(), sig);
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && ev.target.matches('.asdc-page input[type="text"]')) { ev.preventDefault(); void this.command('setup-go'); }
                if ((ev.key === 'Backspace' && !ev.target.matches('input')) || (ev.altKey && ev.key === 'ArrowLeft')) { if (this.page && !this.busy) { ev.preventDefault(); void this.command('back'); } }
            }, sig);
            if (root.contextMenu) {
                root.contextMenu.attachClickMenuToElement(q('.asdc-help'), {
                    onAction: (a) => void this.command(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = [{ text: `About ${NAME}`, action: 'about' }]; } }]
                });
            }
            // the Connecting picture steps about every 290 ms on the VM (rec5: 6877, 7171, 7464 ... ms)
            const tick = setInterval(() => this.tick(), 290);
            this.app.signal.addEventListener('abort', () => clearInterval(tick));
            q('.asdc-close').addEventListener('click', () => this.app.exit(), sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') this.app.exit();
            }, sig);
            m.id = 'melatonMobileDeviceCenterModal';
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed || m.hasAttribute('data-window-position-restored')) return;
                placed = true;
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: NAME, terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'activesync' }) });
            }
        }

        destroy() {
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 400);
        }

        // ---------------------------------------------------------------- state

        devices() {
            const a = as();
            return a ? a.state().devices : [];
        }

        /** The device this window shows: the chosen one, else the first connected, else none. */
        device() {
            const list = this.devices();
            const chosen = this.deviceId && list.find((d) => d.deviceId === this.deviceId);
            if (chosen && (chosen.online || chosen.partner)) return chosen;
            return list.find((d) => d.online) || null;
        }

        select(deviceId) {
            this.deviceId = deviceId;
            this.page = null;
            this.open = null;
            this.render();
        }

        tasks(tile, dev) {
            const out = [];
            // the phone this DeX window runs on, as a hybrid device (#798): no connection to set up or end
            const local = isContinuityDevice(dev);
            if (tile === 'settings') {
                if (dev && dev.online && !dev.partner && !local) out.push({ id: 'setup', text: 'Set up your device', icon: 'setup-32.png' });
                if (!local) out.push({ id: 'connection', text: 'Connection settings', icon: 'connection-32.png' });
                // Vista's System applet art: "View basic information about your computer" (#827)
                if (dev) out.push({ id: 'info', text: 'Device information', icon: '/static_images/vista-cpl/items/system-32.png' });
                if (dev && dev.partner && !local) out.push({ id: 'end', text: 'End a partnership', icon: 'end-partnership-32.png' });
            }
            if (tile === 'programs' && dev && dev.online && dev.permissions.includes('notify') && root.activeSyncNotifications) {
                const n = root.activeSyncNotifications.count(dev.deviceId);
                // Vista keeps the notification area's settings under Taskbar and Start Menu: its art (#827)
                out.push({ id: 'notifications', text: n ? `View notifications on your device (${n})` : 'View notifications on your device', icon: '/static_images/vista-cpl/items/taskbar-and-start-menu-32.png' });
            }
            for (const t of extraTasks[tile] || []) {
                if (!dev || (typeof t.when === 'function' && !t.when(dev))) continue;
                // the same phone needs no clipboard, link or screen sent over: it is this screen's own
                if (local && CONTINUITY_HIDDEN_TASKS.has(t.id)) continue;
                out.push({ id: `x:${tile}:${t.id}`, text: typeof t.text === 'function' ? t.text(dev) : t.text, icon: t.icon || 'item-32.png', extra: t });
            }
            return out;
        }

        // ---------------------------------------------------------------- the device's picture (#818)

        /**
         * Not connected: the two phones; connected: the drawn phone with its screens in it. A device
         * that appears (it connects, or Device Center opens on it) arrives at once: it turns in and its
         * screen lights up (activesync-device-art.css). Its wallpapers are already here (the tray
         * prefetches them, activeSyncDeviceArt.wallpapers); locked, the screens show the lock screen's.
         */
        paintDevice(dev, connected) {
            const box = this.el('.asdc-device');
            const A = art();
            if (!connected) {
                if (box.dataset.mode !== 'none') { box.dataset.mode = 'none'; box.dataset.key = ''; box.innerHTML = `<img src="${A_ASSETS}/devices-256.png" alt="" draggable="false">`; }
                return;
            }
            if (!A) { if (box.dataset.mode !== 'wait') { box.dataset.mode = 'wait'; box.innerHTML = ''; } return; }
            const sc = this.screens;
            if (sc.deviceId !== dev.deviceId) {
                sc.blobs.forEach((u) => URL.revokeObjectURL(u));
                Object.assign(sc, { deviceId: dev.deviceId, form: 'phone', urls: {}, blobs: [], at: 0, key: '', waitFrom: 0, asked: false });
            }
            const st = dev.status || {};
            const locked = st.locked === true;
            const shots = showScreenshots() && !locked;
            const live = A.screenOf(dev);
            // screenshots (Connection settings): ADB pictures, again when chosen or when the foldable turns
            if (shots && !sc.loading && !(sc.shotsFailed && Date.now() - sc.shotsFailed < 60000) && (!sc.at || !sc.shots || (live && sc.liveScreen && live !== sc.liveScreen))) this.loadScreens(false);
            sc.liveScreen = live;
            // wallpapers: the kept set, now; a short wait only when none was ever fetched for this phone
            const w = A.peekWallpapers(dev);
            if (!w) {
                A.wallpapers(dev).then(() => this.render());
                if (box.dataset.mode !== 'device') {
                    if (!sc.waitFrom) { sc.waitFrom = Date.now(); setTimeout(() => this.render(), 350); }
                    if (Date.now() - sc.waitFrom < 350) { if (box.dataset.mode !== 'wait') { box.dataset.mode = 'wait'; box.innerHTML = ''; } return; }
                }
            } else if (!w.inner && !w.androidInner && dev.online && !sc.asked) {
                // nothing kept yet (an app page from before #827): ask the phone itself once
                sc.asked = true;
                this.askWallpapers(dev);
            }
            const ww = w || {};
            const pick = (k) => (locked ? (ww[`${k}Lock`] || null) : null) || ww[k] || ww[`android${k[0].toUpperCase()}${k.slice(1)}`] || (sc.live && sc.live[k]) || null;
            const use = shots && sc.at ? sc.urls : { inner: pick('inner'), cover: pick('cover') || pick('inner'), external: pick('external') };
            const fold = A.isFoldable(dev) || sc.form === 'fold';
            const dex = !!(dev.link === 'usb' || isContinuityDevice(dev) || (shots && sc.urls.externalOn));
            // which screen is in use: ADB's display states with screenshots, else the phone's own word, else the wallpapers' guess
            const actual = (shots && sc.urls.screen) || live || ww.screen || 'inner';
            this.actualScreen = actual;
            // a click on a foldable shows its other screen for a while (foldPreview, toggleFold)
            const screen = fold && this.foldPreview ? this.foldPreview : actual;
            const screens = { inner: use.inner || null, cover: use.cover || null, external: dex ? (use.external || use.inner || null) : null, screen };
            // a foldable's state is not part of the picture: it folds and unfolds in place (animated)
            const key = JSON.stringify([fold, fold ? { ...screens, screen: null } : screens]);
            box.classList.toggle('is-foldable', fold);
            if (box.dataset.mode === 'device' && box.dataset.key === key) { A.setFold(box, screen === 'cover' ? 'closed' : 'open'); return; }
            const arrive = box.dataset.mode !== 'device';
            // an arrival plays to its end before the picture changes again
            if (!arrive && Date.now() < this.arriveUntil) {
                if (!this.arriveTimer) this.arriveTimer = setTimeout(() => { this.arriveTimer = null; this.render(); }, this.arriveUntil - Date.now() + 20);
                return;
            }
            box.dataset.mode = 'device';
            box.dataset.key = key;
            box.innerHTML = A.html({ form: fold ? 'fold' : 'phone', screens, uid: 'asdc', arrive });
            if (arrive) this.arriveUntil = Date.now() + 1300;
        }

        /**
         * A click on a foldable's picture (Yukimi, Nov 14): it folds or unfolds to its other screen and
         * shows that screen's wallpaper, then goes back to the phone's own state after 15 s.
         */
        toggleFold() {
            const box = this.el('.asdc-device');
            if (box.dataset.mode !== 'device' || !box.classList.contains('is-foldable')) return;
            const showing = this.foldPreview || this.actualScreen || 'inner';
            this.foldPreview = showing === 'cover' ? 'inner' : 'cover';
            clearTimeout(this.foldTimer);
            this.foldTimer = setTimeout(() => { this.foldPreview = null; this.render(); }, 15000);
            this.render();
        }

        /** An app page from before #827 keeps no wallpapers on the server: status.wallpapers, once. */
        async askWallpapers(dev) {
            const a = as();
            const w = a ? await a.call(dev.deviceId, 'status.wallpapers', {}, { timeoutMs: 15000 }).catch(() => null) : null;
            if (!w || this.app.signal.aborted || this.screens.deviceId !== dev.deviceId) return;
            const live = {};
            for (const k of ['inner', 'cover', 'external']) if (typeof w[k] === 'string' && /^(\/[^/]|data:image\/)/.test(w[k])) live[k] = w[k];
            this.screens.live = live;
            this.render();
        }

        /** Screenshots over ADB (Connection settings: wallpaper off), while the phone allows them. */
        async loadScreens(again) {
            const dev = this.device();
            const sc = this.screens;
            if (!dev || sc.loading || (again && !sc.at)) return;
            sc.loading = true;
            const id = dev.deviceId;
            const urls = {};
            const blobs = [];
            try {
                const adb = dev.adb || {};
                if (dev.online && adb.state === 'ready' && adb.screenshots !== false) {
                    const r = await fetch(`/api/activesync/adb/${id}/displays`, { credentials: 'same-origin' }).then((x) => x.json()).catch(() => null);
                    const list = (r && r.success && r.displays) || [];
                    if (list.some((d) => d.kind === 'cover')) sc.form = 'fold';
                    // closed: the cover is on and the inner screen off
                    const on = (k) => list.some((d) => d.kind === k && d.on !== false);
                    if (list.some((d) => d.kind === 'cover')) urls.screen = on('cover') && !on('inner') ? 'cover' : 'inner';
                    for (const d of list) {
                        if (d.on === false || !['inner', 'main', 'cover', 'external'].includes(d.kind)) continue;
                        const res = await fetch(`/api/activesync/screen/${id}/shot?display=${encodeURIComponent(d.id)}`, { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
                        if (!res || !res.ok) continue;
                        const u = URL.createObjectURL(await res.blob());
                        blobs.push(u);
                        urls[d.kind === 'main' ? 'inner' : d.kind] = u;
                        if (d.kind === 'external') urls.externalOn = true;
                    }
                }
            } finally {
                sc.loading = false;
            }
            if (this.app.signal.aborted || sc.deviceId !== id) { blobs.forEach((u) => URL.revokeObjectURL(u)); return; }
            sc.blobs.forEach((u) => URL.revokeObjectURL(u));
            sc.blobs = blobs;
            // no screenshot came: the wallpapers stay
            sc.urls = urls.inner || urls.cover ? urls : {};
            sc.at = urls.inner || urls.cover ? Date.now() : 0;
            sc.shots = true;
            if (!sc.at) sc.shotsFailed = Date.now();
            this.render();
        }

        // ---------------------------------------------------------------- drawing

        render() {
            if (this.app.signal.aborted) return;
            const dev = this.device();
            const connected = !!(dev && dev.online);
            const established = connected && (dev.session === 'guest' || dev.session === 'partner');
            // a page that needs the device ends when it goes
            if (this.page && this.page !== 'info' && this.page !== 'done' && !this.page.startsWith('more:') && !connected) { this.page = null; this.busy = false; }
            if (this.page === 'info' && !dev) this.page = null;
            if (this.page === 'notifications' && !(dev && dev.online)) this.page = null;
            if (this.page && this.page.startsWith('more:') && !this.tasks(this.page.slice(5), connected ? dev : null).length) this.page = null;

            // bread crumbs
            const crumbs = ['<span>Home</span>'];
            const others = this.devices().filter((d) => d.online || d.partner);
            if (established || (dev && dev.partner)) {
                const label = dev.partner ? dev.name : 'Quick Connect';
                crumbs.push(`<img src="${A}/breadcrumb-arrow.png" alt="">`, others.length > 1 ? `<span class="asdc-crumb-menu">${esc(label)}</span>` : `<span>${esc(label)}</span>`);
            } else if (others.length > 1) {
                crumbs.push(`<img src="${A}/breadcrumb-arrow.png" alt="">`, `<span class="asdc-crumb-menu">${esc(dev ? dev.name : 'Devices')}</span>`);
            }
            const crumbBox = this.el('.asdc-crumbs');
            if (crumbBox.dataset.html !== crumbs.join('')) {
                crumbBox.dataset.html = crumbs.join('');
                crumbBox.innerHTML = crumbs.join('');
                // with several devices the last crumb is a menu of them
                const menu = crumbBox.querySelector('.asdc-crumb-menu');
                if (menu && root.contextMenu) {
                    root.contextMenu.attachClickMenuToElement(menu, {
                        onAction: (action) => this.select(action),
                        sections: [{ type: 'list', initfn: (sec) => {
                            const cur = this.device();
                            sec.items = this.devices().filter((d) => d.online || d.partner).map((d) => ({ text: d.online ? d.name : `${d.name} (not connected)`, action: d.deviceId, checked: !!(cur && cur.deviceId === d.deviceId) }));
                        } }]
                    });
                }
            }
            this.el('.asdc-back').disabled = !this.page || this.busy;

            // the picture and the status line
            this.paintDevice(dev, connected);
            this.status = this.busy ? 'connecting' : connected ? 'connected' : 'notconnected';
            this.paintStatus();

            const body = this.el('.asdc-body');
            let html;
            if (this.page === 'setup') html = this.setupPage(dev);
            else if (this.page === 'working') html = `<div class="asdc-page"><h2>Setting up partnership...</h2><p>${esc(`Please wait while we set up your partnership with ${this.pendingName || dev.name} and save your settings.`)}</p><p>Answer the question on your device to continue.</p></div>`;
            else if (this.page === 'guest') html = `<div class="asdc-page"><h2>Connecting...</h2><p>Answer the question on your device to continue.</p></div>`;
            else if (this.page === 'done') html = `<div class="asdc-page"><h2>You have created a new Melaton Mobile partnership</h2><p>${esc(`${dev ? dev.name : 'Your device'} connects on its own from now on, whenever the Dreamscape app is running on it.`)}</p><div class="asdc-page-buttons"><button type="button" class="btn-standard primary" data-asdc="back">Done</button></div></div>`;
            else if (this.page === 'info') html = this.infoPage(dev);
            else if (this.page === 'notifications') html = this.notificationsPage(dev);
            else if (this.page && this.page.startsWith('more:')) html = this.morePage(dev, connected);
            else if (connected && !established) html = this.choicePage();
            else html = this.tilesPage(dev, connected);
            if (body.dataset.html !== html) {
                // keep what is being typed when a status report redraws nothing new
                body.dataset.html = html;
                body.innerHTML = html;
                const field = body.querySelector('.asdc-page input[type="text"]');
                if (field) { field.focus({ preventScroll: true }); field.select(); }
            }
            this.applyOpen();
        }

        paintStatus() {
            const img = this.el('.asdc-status img');
            const text = this.el('.asdc-status span');
            // this handheld in continuity: being connected to itself is not news (#798)
            this.el('.asdc-status').hidden = isContinuityDevice(this.device());
            this.el('.asdc-status').dataset.status = this.status;
            const dev = this.device();
            // the lock screen is up on the phone (the app's service, #827): imageres' Aero padlock
            const locked = this.status === 'connected' && !!(dev && dev.status && dev.status.locked === true);
            this.el('.asdc-status').classList.toggle('is-locked', locked);
            // WMDC's status area (UpdateDeviceStatusArea): under the device status, a partnership's sync line
            const sync = this.el('.asdc-sync');
            const syncText = this.status === 'connected' && dev && dev.partner && !isContinuityDevice(dev) ? lastSyncLine(dev.lastSync) : '';
            if (sync.textContent !== syncText) sync.textContent = syncText;
            sync.hidden = !syncText;
            if (this.status === 'connecting') {
                img.src = `${A}/status-connecting-${(this.frame % 8) + 1}.png`;
                text.textContent = 'Connecting';
            } else if (locked) {
                img.src = '/static_images/activesync/status-locked.png';
                text.textContent = 'Connected (Locked)';
            } else {
                img.src = `${A}/status-${this.status}.png`;
                text.textContent = this.status === 'connected' ? 'Connected' : 'Not Connected';
            }
        }

        tick() {
            if (this.status !== 'connecting') return;
            this.frame += 1;
            this.paintStatus();
        }

        choicePage() {
            return `<div class="asdc-choice">
                <button type="button" class="asdc-panel asdc-panel--setup" data-asdc="setup"><img src="${A}/settings-64.png" alt=""><h3>Set up your device</h3><p>Keep a partnership with this device, so it connects on its own and items sent to it wait while it is away.</p></button>
                <button type="button" class="asdc-panel asdc-panel--quick" data-asdc="guest"><img src="${A}/quick-connect-64.png" alt=""><h3>Connect without setting up your device</h3></button>
            </div>`;
        }

        tilesPage(dev, connected) {
            const tiles = TILES.map((t) => ({ t, tasks: this.tasks(t.id, connected ? dev : null) })).filter((x) => x.tasks.length);
            return `<div class="asdc-tiles">${tiles.map(({ t, tasks }) => `
                <div class="asdc-tile" data-tile="${t.id}">
                    <img src="${A}/${t.icon}" alt="">
                    <h3>${esc(t.title)}</h3>
                    <div class="asdc-tile-body">${tasks.slice(0, 3).map((k) => `<button type="button" class="asdc-item" data-asdc="task" data-task="${esc(k.id)}"><img src="${k.icon.includes('/') ? esc(k.icon) : `${A}/${k.icon}`}" alt=""><span>${esc(k.text)}</span></button>`).join('')}
                    ${tasks.length > 3 ? '<button type="button" class="asdc-more" data-asdc="more">more»</button>' : ''}</div>
                </div>`).join('')}</div>`;
        }

        /** "more»" on a tile: every task of it on a page of its own (a tile shows three). */
        morePage(dev, connected) {
            const id = this.page.slice(5);
            const tile = TILES.find((t) => t.id === id);
            const tasks = tile ? this.tasks(id, connected ? dev : null) : [];
            return `<div class="asdc-page asdc-more-page"><h2>${esc(tile ? tile.title : '')}</h2>
                <div class="asdc-more-list">${tasks.map((k) => `<button type="button" class="asdc-item" data-asdc="task" data-task="${esc(k.id)}"><img src="${k.icon.includes('/') ? esc(k.icon) : `${A}/${k.icon}`}" alt=""><span>${esc(k.text)}</span></button>`).join('')}</div></div>`;
        }

        setupPage(dev) {
            return `<div class="asdc-page">
                <h2>Ready to set up the Melaton Mobile partnership</h2>
                <p>Your device will be asked to agree. A partner connects on its own, and items sent to it wait while it is away.</p>
                <label for="asdcDeviceName">Device name:</label>
                <input type="text" id="asdcDeviceName" maxlength="40" value="${esc(this.pendingName || (dev && dev.name) || '')}" spellcheck="false" autocomplete="off">
                <div class="asdc-error">${esc(this.setupError || '')}</div>
                <div class="asdc-page-buttons"><button type="button" class="btn-standard primary" data-asdc="setup-go">Set Up</button><button type="button" class="btn-standard" data-asdc="back">Cancel</button></div>
            </div>`;
        }

        infoPage(dev) {
            const st = (dev && dev.status) || {};
            const rows = [];
            const row = (k, v) => { if (v) rows.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`); };
            const D = art();
            row('Device name:', esc(dev.name));
            // the maker and the model (#827): "Samsung Galaxy Z Fold7 (SM-F966U)"
            row('Model:', esc(D ? D.makeModel(dev.model) : dev.model));
            // Melaton Mobile's edition (#827): the phone's own word, else worked out from what is known here
            row('Edition:', esc(editionOf(dev)));
            // Melaton Mobile's version and Android's: "Melaton Mobile 6.5 (Android 16)"
            row('Operating system:', esc(D ? D.osText(dev) : dev.os));
            // the program in front: a Melaton Mobile program or an Android app Melaton started
            if (st.program && st.program.name) row('Program:', esc(st.program.kind === 'android' ? `${st.program.name} (Android)` : st.program.name));
            else if (dev.online) row('Program:', esc(st.foreground === false ? 'Melaton Mobile (in the background)' : 'Melaton Mobile'));
            if (isContinuityDevice(dev)) {
                // the phone this DeX window runs on (#798): one device, no status to report
                row('Connection:', esc('This Handheld (Continuity)'));
            } else {
                row('Status:', esc(!dev.online ? 'Not Connected' : dev.session === 'partner' ? 'Connected (partnership)' : dev.session === 'guest' ? 'Connected (guest)' : 'Connected'));
                // the phone's own DeX window (#794): its link is USB, as a cradle's
                if (dev.online) row('Connection:', esc(dev.link === 'usb' ? 'USB' : 'Network'));
            }
            if (dev.online && st.battery && st.battery.level != null) {
                row('Battery:', `<img src="${A}/${batteryArt(st.battery)}-16.png" alt="">${Math.round(st.battery.level)}%${st.battery.charging ? ', charging' : ''}${st.battery.saver ? ', battery saver on' : ''}`);
            }
            // signal meters at the phone's own (vendor) level, 0-4 (#827), and the network's name
            const meter = (level, kind) => (D && level != null ? D.bars(level, kind) : '');
            if (dev.online && st.wifi) {
                if (st.wifi.connected) row('Wi-Fi:', `${meter(st.wifi.level, 'wifi')}${esc(st.wifi.ssid || 'Connected')}`);
                else row('Wi-Fi:', esc(st.wifi.enabled === false ? 'Off' : 'Not connected'));
            }
            if (dev.online && st.cellular && st.cellular.present) {
                const c = st.cellular;
                row('Cellular:', c.airplane ? esc('Flight mode') : `${meter(c.level, 'cell')}${esc([c.operator, c.dataType, c.roaming ? 'roaming' : ''].filter(Boolean).join(', ') || 'No service')}`);
            }
            for (const s of (dev.online && st.storage) || []) {
                if (s.total == null || s.free == null || !(s.total > 0)) continue;
                const used = Math.max(0, Math.min(1, 1 - s.free / s.total));
                row(`${s.name || 'Storage'}:`, `<span class="asdc-bar${used > 0.9 ? ' is-full' : ''}"><i style="width:${(used * 100).toFixed(1)}%"></i></span>${esc(`${bytes(s.free)} free of ${bytes(s.total)}`)}`);
            }
            // Developer Bridge (#827, was Localhost ADB #818/#820): the phone's own ADB and its port
            if (dev.adb) row('Developer Bridge:', esc(dev.adb.allow === false || dev.adb.state === 'off' ? 'Disabled' : `Enabled (Port: ${dev.adb.port || 5555})`));
            if (dev.partner) row('Last sync:', esc(when(dev.lastSync)));
            if (dev.queued) row('Waiting for device:', esc(`${dev.queued} item${dev.queued === 1 ? '' : 's'}`));
            if (!dev.online) row('Last connected:', esc(when(dev.lastSeen)));
            return `<div class="asdc-page" style="top:70px"><h2>Device information</h2><dl class="asdc-info">${rows.join('')}</dl><div class="asdc-page-buttons"><button type="button" class="btn-standard primary" data-asdc="back">Close</button></div></div>`;
        }

        notificationsPage(dev) {
            const list = root.activeSyncNotifications ? root.activeSyncNotifications.list(dev.deviceId) : [];
            const rows = list.map((n) => `
                <li>
                    <img src="${n.icon ? esc(n.icon) : `${A}/item-32.png`}" alt="" width="32" height="32">
                    <div><b>${esc(n.title || n.app)}</b><span>${esc(n.text)}</span><small>${esc(n.title ? `${n.app} \u2022 ${when(n.time)}` : when(n.time))}</small></div>
                    <button type="button" class="btn-standard" data-asdc="notif-dismiss" data-key="${esc(n.key)}">Dismiss</button>
                </li>`).join('');
            return `<div class="asdc-page asdc-page--wide" style="top:60px"><h2>Notifications on ${esc(dev.name)}</h2>
                ${list.length ? `<ul class="asdc-notes">${rows}</ul>` : '<p>There are no notifications on your device.</p>'}
                <div class="asdc-page-buttons"><button type="button" class="btn-standard primary" data-asdc="back">Close</button></div></div>`;
        }

        openTile(id) {
            if (this.open === id) return;
            this.open = id;
            this.applyOpen();
        }

        applyOpen() {
            this.modal.querySelectorAll('.asdc-tile').forEach((t) => t.classList.toggle('is-open', t.dataset.tile === this.open));
        }

        // ---------------------------------------------------------------- commands

        async messageBox(text, buttons, kind) {
            return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, {
                title: NAME,
                icon: kind === 'error' ? 'fas fa-circle-xmark' : kind === 'question' ? 'fas fa-circle-question' : 'fas fa-triangle-exclamation',
                width: 400
            });
        }

        async command(cmd, el) {
            const a = as();
            const dev = this.device();
            if (cmd === 'back') { this.page = null; this.setupError = ''; this.render(); return; }
            if (cmd === 'about') { await this.about(); return; }
            if (cmd === 'more') { this.page = `more:${el.closest('.asdc-tile').dataset.tile}`; this.render(); return; }
            if (cmd === 'task') {
                const id = el.dataset.task;
                if (id.startsWith('x:')) {
                    const [, tile, tid] = id.split(':');
                    const t = (extraTasks[tile] || []).find((k) => k.id === tid);
                    if (t && dev) {
                        try { await t.run(dev, this); } catch (e) { await this.messageBox((e && e.message) || 'The task could not be completed.', null, 'error'); }
                    }
                    return;
                }
                cmd = id;
            }
            if (!a) return;
            if (cmd === 'setup') { this.page = 'setup'; this.setupError = ''; this.pendingName = ''; this.render(); return; }
            if (cmd === 'info') { this.page = 'info'; this.render(); return; }
            if (cmd === 'notifications') { this.page = 'notifications'; this.render(); return; }
            if (cmd === 'notif-dismiss' && dev && root.activeSyncNotifications) {
                try { await root.activeSyncNotifications.dismiss(dev.deviceId, el.dataset.key); } catch (e) { await this.messageBox((e && e.message) || 'The notification could not be dismissed.', null, 'error'); }
                return;
            }
            if (cmd === 'connection') { await this.connectionSettings(); return; }
            if (cmd === 'guest' && dev) {
                this.page = 'guest';
                await this.propose(dev, 'guest', {});
                return;
            }
            if (cmd === 'setup-go' && dev) {
                const field = this.el('#asdcDeviceName');
                const name = String((field && field.value) || '').trim();
                // Device Center's own three refusals (NPWDeviceNameError*)
                if (!name) this.setupError = 'Please enter a name for your device.';
                else if (/[^\p{L}\p{N} _-]/u.test(name)) this.setupError = 'Device names cannot include punctuation or symbols. Please choose a different name.';
                else this.setupError = '';
                this.pendingName = name;
                if (this.setupError) { this.el('.asdc-body').dataset.html = ''; this.render(); return; }
                this.page = 'working';
                await this.propose(dev, 'partner', { name });
                return;
            }
            if (cmd === 'end' && dev) {
                const yes = await this.messageBox(`Are you sure you want to end the partnership with ${dev.name}?\n\nEnding a partnership removes any Device Center information associated with that device from this computer.`, [
                    { text: 'End partnership', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
                ], 'question');
                if (yes !== true) return;
                try { await a.endPartnership(dev.deviceId); } catch (e) { await this.messageBox(e.message || 'Could not save Partnership Settings', null, 'error'); }
                this.render();
            }
        }

        async propose(dev, mode, opts) {
            const a = as();
            this.busy = true;
            this.render();
            let res = null;
            let failure = null;
            try { res = await a.propose(dev.deviceId, mode, opts); } catch (e) { failure = e; }
            if (this.app.signal.aborted) return;
            this.busy = false;
            if (failure) {
                if (failure.code === 'NAME_IN_USE') { this.page = 'setup'; this.setupError = failure.message; this.el('.asdc-body').dataset.html = ''; this.render(); return; }
                this.page = mode === 'partner' ? 'setup' : null;
                this.render();
                await this.messageBox(failure.code === 'TIMEOUT' || failure.code === 'OFFLINE' || failure.code === 'DISCONNECTED'
                    ? 'There is a problem with your connection.  Please disconnect and reconnect your device and try again.'
                    : (failure.message || 'There is a problem with your connection.'), null, 'error');
                return;
            }
            if (!res.accepted) {
                this.page = mode === 'partner' ? 'setup' : null;
                this.render();
                await this.messageBox(mode === 'partner' ? 'The partnership was not set up: it was refused on the device.' : 'The connection was refused on the device.', null, 'warning');
                return;
            }
            this.page = mode === 'partner' ? 'done' : null;
            this.render();
        }

        /**
         * Connection Settings: WMDC's own dialog (wmdc.exe.mui DIALOG 102, drawn by vistaDialogTemplate),
         * its strings from the string table (3000-3007). The status line is bold, as WMDC sets it; the
         * picture is the program's icon 2000. The device's own link is the "USB" connection here; the
         * values are kept under HKCU\Software\Xyridian\Melaton Mobile Device Center (the tray's
         * OpenOnConnect / NotifyOnConnect sit there too, with no page of their own, as in WMDC).
         */
        async connectionSettings() {
            const reg = root.melatonRegistry;
            if (root.featureLoader && !root.vistaDialogTemplate) { try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* no dialog */ } }
            if (!root.vistaDialogTemplate) return;
            const get = (n, d) => { const v = reg ? reg.get(REG, n, d) : d; return v == null ? d : v; };
            const PORTS = ['Bluetooth', 'Infrared (IR)'];
            const NETWORKS = ['Automatic', 'The Internet', 'Work Network'];
            const statusText = (ctx) => {
                if (!ctx.get(1006) && !ctx.get(1007)) return 'Connection disabled';
                return this.device() && this.device().online ? 'Device connected' : 'Waiting for device to connect';
            };
            root.vistaDialogTemplate.openDialog({
                id: 'asdcConnectionSettings',
                owner: this.modal,
                icon: `${A}/activesync-16.png`,
                captionIcon: true,
                help: true,
                tpl: CONNECTION_SETTINGS_TPL,
                overrides: { 1011: { skip: true }, 1012: { skip: true }, 1002: { image: `${A}/activesync-32.png` } },
                init: (ctx) => {
                    ctx.el(1003).style.fontWeight = 'bold';
                    ctx.set(1006, get('AllowUSB', 1) !== 0);
                    ctx.set(1007, get('AllowOther', 1) !== 0);
                    ctx.options(1008, PORTS, PORTS.includes(get('OtherPort', 'Bluetooth')) ? get('OtherPort', 'Bluetooth') : 'Bluetooth');
                    ctx.options(1009, NETWORKS, NETWORKS.includes(get('ConnectedTo', 'Automatic')) ? get('ConnectedTo', 'Automatic') : 'Automatic');
                    ctx.set(1016, get('AutoAuthenticate', 1) !== 0);
                    ctx.set(1013, get('AllowDataConnections', 0) !== 0);
                    ctx.set(1020, Number(get('ShowScreenshots', 0)) !== 1);
                    const sync = () => {
                        ctx.el(1008).disabled = !ctx.get(1007);
                        ctx.text(1003, statusText(ctx));
                    };
                    ctx.on(1006, 'change', sync);
                    ctx.on(1007, 'change', sync);
                    sync();
                    // the line follows a device coming and going while the dialog is open
                    const a = as();
                    if (a) {
                        const off = a.on('state', () => { if (!ctx.modal.isConnected) { off(); return; } ctx.text(1003, statusText(ctx)); });
                        ctx.store.off = off;
                    }
                },
                ok: (ctx) => {
                    if (reg) {
                        void reg.set(REG, {
                            AllowUSB: ctx.get(1006) ? 1 : 0,
                            AllowOther: ctx.get(1007) ? 1 : 0,
                            OtherPort: String(ctx.get(1008) || 'Bluetooth'),
                            ConnectedTo: String(ctx.get(1009) || 'Automatic'),
                            AutoAuthenticate: ctx.get(1016) ? 1 : 0,
                            AllowDataConnections: ctx.get(1013) ? 1 : 0,
                            ShowScreenshots: ctx.get(1020) ? 0 : 1
                        });
                    }
                    // the picture follows the choice at once (the registry keeps it locally right away)
                    setTimeout(() => this.render(), 0);
                    return true;
                },
                close: (ctx) => { if (ctx.store.off) ctx.store.off(); }
            });
        }

        /**
         * Help > About: WMDC 6.1's own About box (About Windows Mobile Device Center on the Vista VM,
         * ~/.cache/vista-vm/about/about-wmdc.png): 436 x 300, its green field (assets/about-background.png),
         * the logo at the top right, the name / version / product ID / copyright in white, the notice
         * in a framed scrolling box, OK.
         */
        async about() {
            const V = root.vistaDialogTemplate;
            if (!V || typeof V.openDialog !== 'function') {
                await call('showConfirmationDialog', `<p><b>${NAME}</b><br>Version: 6.1.6965</p><p>Copyright © 2007 Xyridian Corporation. All rights reserved.</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: `About ${NAME}`, width: 380 });
                return;
            }
            // 420 x 264 client in MS Shell Dlg 8 units (x 1.5 px, y 1.625 px)
            const tpl = { t: `About ${NAME}`, w: 280, h: 162, f: ['MS Shell Dlg', 8], s: 0x80C800C0, c: [
                [900, 'S', 0, 0, 280, 162, 0x50000000, '', 0],
                [1, 'B', 223, 139, 48, 14, 0x50010001, 'OK', 0]
            ] };
            const html = `<div class="asdc-about">
                <div class="asdc-about-logo"><img src="/static_images/wm61/boot-melaton.png" alt=""><b>Melaton</b><i>Mobile</i></div>
                <div class="asdc-about-facts"><b>${NAME}</b><br>Version: 6.1.6965<br>Product ID: 75436-457-3586175-04226<br>Copyright © 2007 Xyridian Corporation. All rights reserved.</div>
                <div class="asdc-about-notice">This product contains security information licensed from RSA Data Security, Inc.<br>Warning: This computer program is protected by copyright law and international treaties. Unauthorized reproduction or distribution of this program, or any portion of it, may result in severe civil and criminal penalties, and will be prosecuted to the maximum extent possible under the law.</div>
            </div>`;
            V.openDialog({ id: 'asdcAboutDialog', tpl, title: tpl.t, owner: this.modal, overrides: { 900: { html, cls: 'asdc-about-host' } } });
        }
    }

    let running = null;

    function start(app) {
        if (running) {
            if (app.args && app.args.deviceId) running.select(app.args.deviceId);
            if (app.args && (app.args.page === 'info' || app.args.page === 'notifications')) { running.page = app.args.page; running.render(); }
            call('bringModalToFront', running.modal);
            app.exit();
            return;
        }
        const c = new Center(app);
        running = c;
        app.onExit(() => { if (running === c) running = null; c.destroy(); });
    }

    // ---- Continuity (#798): in the DeX window of a hybrid phone (DeX opened once, Dreamscape as home),
    // the phone is this handheld, not a device across a link (AndroidHome.getContinuity, DSApp 4dac430)
    const CONTINUITY_HIDDEN_TASKS = new Set(['clipboard-send', 'link-send', 'screen-view']);
    function continuity() {
        try {
            const H = root.AndroidHome;
            if (H && typeof H.getContinuity === 'function') {
                const c = JSON.parse(H.getContinuity());
                return c && c.hybrid && c.external ? c : null;
            }
            // an app build before DSApp 4dac430 has no getContinuity: this window on the DeX display (so DeX
            // has been opened) on a phone whose home screen is Dreamscape is hybrid too
            if (H && typeof H.isExternalDisplay === 'function' && H.isExternalDisplay() && typeof H.isHome === 'function' && H.isHome()) {
                const A = root.AndroidActiveSync;
                const id = A && typeof A.getDeviceId === 'function' ? A.getDeviceId() : '';
                return id ? { hybrid: true, dexSeen: true, home: true, external: true, deviceId: id } : null;
            }
            return null;
        } catch (_) { return null; }
    }
    function isContinuityDevice(dev) {
        const c = dev && continuity();
        return !!(c && c.deviceId && String(c.deviceId).toLowerCase() === String(dev.deviceId).toLowerCase());
    }

    /** A task in a tile ('programs' | 'media' | 'files' | 'settings'): { id, text, icon, when(device), run(device, center) }. */
    function addTask(tile, task) {
        if (!extraTasks[tile] || !task || !task.id || typeof task.run !== 'function') return;
        const at = extraTasks[tile].findIndex((t) => t.id === task.id);
        if (at >= 0) extraTasks[tile][at] = task; else extraTasks[tile].push(task);
        if (running) running.render();
    }

    root.melatonActiveSync = Object.assign(root.melatonActiveSync || {}, { start, addTask, _running: () => running, _tasks: extraTasks });
    // tasks registered before this file loaded (other features queue them on melatonActiveSync.pending)
    (root.melatonActiveSync.pending || []).splice(0).forEach(([tile, task]) => addTask(tile, task));
    if (typeof melatonApps !== 'undefined') melatonApps.define('activesync', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
