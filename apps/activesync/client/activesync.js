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
    const NAME = 'Melaton Mobile Device Center';
    const REG = 'HKCU\\Software\\Xyridian\\Melaton Mobile Device Center';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const as = () => root.activeSync || null;

    // tasks other files add to a tile: { id, text, icon, when(device) -> bool, run(device, center) }
    const extraTasks = { programs: [], media: [], files: [], settings: [] };
    // wmdc.exe.mui DIALOG 102 (Connection Settings), from the VM (~/.cache/vista-vm/wmdc-ref/res/pe); OK carries
    // BS_DEFPUSHBUTTON, the default the dialog manager gives IDOK
    const CONNECTION_SETTINGS_TPL = {"t":"Connection Settings","w":304,"h":159,"f":["MS Shell Dlg",8],"s":13116360,"c":[[1011,"S",5,4,8,8,1342177419,"Device status icon",0],[1002,"S",5,5,21,20,1342177411,"#2000",0],[1003,"S",31,4,255,10,1342308352,"Waiting for device to connect",0],[1014,"S",31,14,255,10,1073872896,"Some settings may be disabled by Group Policy",0],[-1,"S",5,30,294,1,1342177424,"",0],[1006,"B",5,39,281,9,1342252035,"Allow &USB connections",0],[1007,"B",5,52,281,9,1342251011,"Allow co&nnections to one of the following:",0],[1012,"S",17,60,8,8,1342177419,"Connection selection dropdown",0],[1008,"C",17,63,135,92,1344339971,"",0],[-1,"S",5,79,281,10,1342308352,"This computer is connected &to:",0],[1009,"C",5,89,147,92,1344339971,"",0],[1016,"B",6,107,280,11,1342242819,"Allow auto&matic device authentication",0],[1013,"B",6,120,280,11,1342242819,"Allow &data connections on device when connected to PC",0],[-1,"S",5,133,294,1,1342177424,"",0],[1,"B",194,141,50,14,1342242817,"OK",0],[2,"B",249,141,50,14,1342242816,"Cancel",0]]};
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

    function batteryArt(b) {
        if (!b || b.level == null) return 'battery-5';
        return `battery-${b.level < 10 ? 0 : b.level < 35 ? 1 : b.level < 60 ? 2 : b.level < 85 ? 3 : 4}`;
    }

    /*
     * Device Center's picture of the device (#818): a modern phone drawn in the style of Windows'
     * device icons (device-pda-256.png: brushed silver body, black bezel, glossy glass, a slight turn
     * that shows the right edge, a soft shadow below), with the device's own screen in it.
     *
     *   deviceArt({ form, screens, uid })  -> SVG markup for a 256 x 256 box
     *     form     'phone' | 'fold' (drawn open or closed, as screens.screen says: only its state now)
     *     screens  { inner, cover, external } image URLs (null: the glossy blue of an empty screen);
     *              plus screen: 'inner' | 'cover'; external draws DeX's laptop, the phone in front on its left
     *     uid      a prefix for the SVG ids (several pictures on one page)
     */
    function deviceArt({ form = 'phone', screens = {}, uid = 'da' } = {}) {
        const id = (n) => `${uid}-${n}`;
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const defs = [];
        const add = (s) => defs.push(s);
        // shared paints
        add(`<linearGradient id="${id('metal')}" x1="0" y1="0" x2="1" y2=".35">
                <stop offset="0" stop-color="#c9ced5"/><stop offset=".08" stop-color="#ffffff"/><stop offset=".22" stop-color="#e4e8ec"/>
                <stop offset=".6" stop-color="#bcc2ca"/><stop offset=".86" stop-color="#9aa1aa"/><stop offset="1" stop-color="#cfd4da"/></linearGradient>`);
        add(`<linearGradient id="${id('rays')}" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
        add(`<linearGradient id="${id('edge')}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#a7adb5"/><stop offset=".5" stop-color="#7d838b"/><stop offset="1" stop-color="#5e646c"/></linearGradient>`);
        add(`<linearGradient id="${id('bezel')}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#2a2e34"/><stop offset=".5" stop-color="#0c0e11"/><stop offset="1" stop-color="#1b1e22"/></linearGradient>`);
        add(`<linearGradient id="${id('blank')}" x1="0" y1="0" x2=".6" y2="1">
                <stop offset="0" stop-color="#6d9cf4"/><stop offset=".45" stop-color="#2a5fdc"/><stop offset="1" stop-color="#173f9e"/></linearGradient>`);
        add(`<linearGradient id="${id('gloss')}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".48" stop-color="#fff" stop-opacity=".08"/>
                <stop offset=".49" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
        add(`<radialGradient id="${id('shadow')}" cx=".5" cy=".5" r=".5">
                <stop offset="0" stop-color="#000" stop-opacity=".32"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`);
        add(`<linearGradient id="${id('crease')}" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".42" stop-color="#000" stop-opacity=".10"/>
                <stop offset=".5" stop-color="#fff" stop-opacity=".16"/><stop offset=".58" stop-color="#000" stop-opacity=".10"/>
                <stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`);

        /** A screen: the picture (or the empty glass), clipped to its rounded rectangle, gloss on top. */
        function glass(key, x, y, w, h, r, url, extra = '') {
            add(`<clipPath id="${id(`clip-${key}`)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>`);
            const pic = url
                ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/><image href="${esc(url)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
                : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id('blank')})"/>`
                  + `<path d="M${x + w * .5} ${y + h * 1.05} C${x + w * .2} ${y + h * .6} ${x + w * .25} ${y + h * .25} ${x + w * .42} ${y - 2} L${x + w * .55} ${y - 2} C${x + w * .42} ${y + h * .3} ${x + w * .45} ${y + h * .65} ${x + w * .62} ${y + h * 1.05} Z" fill="url(#${id('rays')})" opacity=".55"/>`
                  + `<path d="M${x + w * .62} ${y + h * 1.05} C${x + w * .55} ${y + h * .6} ${x + w * .62} ${y + h * .3} ${x + w * .78} ${y - 2} L${x + w * .86} ${y - 2} C${x + w * .72} ${y + h * .35} ${x + w * .7} ${y + h * .65} ${x + w * .74} ${y + h * 1.05} Z" fill="url(#${id('rays')})" opacity=".35"/>`;
            return `<g clip-path="url(#${id(`clip-${key}`)})">${pic}${extra}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id('gloss')})"/></g>`;
        }

        /** A slab of metal: right edge (thickness), body, bezel, screen; returns markup. */
        function slab(key, x, y, w, h, { r = 18, bezel = 4.5, depth = 5, url = null, camera = true, hinge = false } = {}) {
            const parts = [];
            // the right edge and the bottom lip, seen past the turn
            parts.push(`<rect x="${x + depth}" y="${y + depth * 0.55}" width="${w}" height="${h}" rx="${r}" fill="url(#${id('edge')})"/>`);
            // side keys on the visible edge
            parts.push(`<rect x="${x + w + depth - 1.6}" y="${y + h * 0.2}" width="1.4" height="${h * 0.11}" rx=".7" fill="#7d838b"/>`);
            parts.push(`<rect x="${x + w + depth - 1.6}" y="${y + h * 0.37}" width="1.4" height="${h * 0.06}" rx=".7" fill="#7d838b"/>`);
            // the body: brushed silver with a light rim
            parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${id('metal')})" stroke="#7b8189" stroke-width=".9"/>`);
            parts.push(`<rect x="${x + 1.2}" y="${y + 1.2}" width="${w - 2.4}" height="${h - 2.4}" rx="${r - 1.2}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1"/>`);
            // the black front
            const rim = Math.max(1.4, w * 0.014); const bx = x + rim; const by = y + rim; const bw = w - 2 * rim; const bh = h - 2 * rim; const br = Math.max(2, r - rim);
            parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${br}" fill="url(#${id('bezel')})"/>`);
            const sx = bx + bezel; const sy = by + bezel; const sw = bw - 2 * bezel; const sh = bh - 2 * bezel;
            const crease = hinge ? `<rect x="${sx + sw / 2 - 9}" y="${sy}" width="18" height="${sh}" fill="url(#${id('crease')})"/>` : '';
            parts.push(glass(key, sx, sy, sw, sh, Math.max(2, br - bezel), url, crease));
            if (camera) {
                const cx = hinge ? sx + sw * 0.78 : sx + sw / 2;
                parts.push(`<circle cx="${cx}" cy="${sy + 5.5}" r="2.3" fill="#05070a" stroke="#2c3138" stroke-width=".8"/><circle cx="${cx - .6}" cy="${sy + 4.9}" r=".6" fill="#5a7ab8" fill-opacity=".8"/>`);
            }
            if (hinge) parts.push(`<line x1="${x + w / 2}" y1="${y + .8}" x2="${x + w / 2}" y2="${y + 2.6}" stroke="#6f757d" stroke-width="1.2"/><line x1="${x + w / 2}" y1="${y + h - 2.6}" x2="${x + w / 2}" y2="${y + h - .8}" stroke="#6f757d" stroke-width="1.2"/>`);
            return parts.join('');
        }

        /**
         * DeX's laptop (Yukimi's sketch, Nov 13): the lid at the top right, its keyboard deck running
         * down to the left under the phone. A polygon helper keeps the deck's slant.
         */
        const poly = (pts) => pts.map((p) => p.join(' ')).join(' ');
        function laptop(url) {
            // a slim laptop behind the phone, seen a little from above: the lid (16:10, a hairline
            // aluminium edge, a narrow bezel) on a short base whose front edge comes towards us
            const L = 92; const R = 246; const T = 40; const B = 138;
            const parts = [];
            const base = [[L + 2, B], [R - 2, B], [R + 8, B + 20], [L - 8, B + 20]];
            parts.push(`<polygon points="${poly([[L - 8, B + 20], [R + 8, B + 20], [R + 7, B + 22.5], [L - 7, B + 22.5]])}" fill="url(#${id('edge')})"/>`);
            parts.push(`<polygon points="${poly(base)}" fill="url(#${id('metal')})" stroke="#8d939b" stroke-width=".6"/>`);
            const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            const at = (u, v) => lerp(lerp(base[0], base[1], u), lerp(base[3], base[2], u), v);
            parts.push(`<polygon points="${poly([at(.1, .12), at(.9, .12), at(.9, .52), at(.1, .52)])}" fill="#3a3f46"/>`);
            parts.push(`<polygon points="${poly([at(.39, .62), at(.61, .62), at(.61, .9), at(.39, .9)])}" fill="#cdd2d8" stroke="#a7adb5" stroke-width=".4"/>`);
            parts.push(`<rect x="${L}" y="${T}" width="${R - L}" height="${B - T}" rx="4" fill="#1a1d21" stroke="#a9afb7" stroke-width="1"/>`);
            parts.push(glass('external', L + 3, T + 3, R - L - 6, B - T - 7, 1.5, url));
            parts.push(`<rect x="${L + 1}" y="${B - 2.6}" width="${R - L - 2}" height="2" fill="#2a2e34"/>`);
            return parts.join('');
        }

        const body = [];
        const shadow = (cx, cy, rx, ry) => body.push(`<ellipse cx="${cx + rx * 0.18}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${id('shadow')})"/>`);
        // the turn: a slight shear, as the icon family looks a little from the right
        const turn = (inner, ox, oy) => `<g transform="translate(${ox} ${oy}) matrix(0.985 -0.035 0 1 0 0) translate(${-ox} ${-oy})">${inner}</g>`;
        // only the phone as it is now: a foldable open (its inner screen) or closed (its cover)
        const open = form === 'fold' && screens.screen !== 'cover';
        const url = form === 'fold' ? (open ? screens.inner : (screens.cover || screens.inner)) : (screens.inner || screens.cover);
        const ratio = open ? 0.9 : form === 'fold' ? 0.43 : 0.47;
        // slim: a hairline rim, a narrow black border, a shallow edge (Yukimi: not chunky)
        const opts = open ? { r: 8, bezel: 2, depth: 2.5, hinge: true } : { r: form === 'fold' ? 9 : 13, bezel: 2, depth: 2.5 };
        let box;
        if (screens.external) {
            shadow(172, 176, 84, 6);
            body.push(laptop(screens.external));
            // in front, on the left (the sketch): as tall as the space allows
            box = open ? { x: 10, w: 112, bottom: 206 } : { x: 18, w: Math.round(164 * ratio), bottom: 210 };
        } else {
            box = open ? { x: 26, w: 196, bottom: 236 } : { x: Math.round((256 - 222 * ratio) / 2), w: Math.round(222 * ratio), bottom: 238 };
        }
        const h = Math.round(box.w / ratio);
        const y = box.bottom - h;
        shadow(box.x + box.w / 2, box.bottom + 4, box.w * 0.62, 7);
        body.push(turn(slab('phone', box.x, y, box.w, h, { ...opts, url }), box.x + box.w / 2, y + h / 2));
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>${defs.join('')}</defs>${body.join('')}</svg>`;
    }

    class Center {
        constructor(app) {
            this.app = app;
            this.deviceId = (app.args && app.args.deviceId) || null;
            this.page = null;       // null (the home for the device's state) | 'setup' | 'working' | 'done' | 'info'
            this.open = null;       // the open tile
            this.busy = false;      // waiting for the phone's answer
            this.frame = 0;
            this.screens = { deviceId: null, form: 'phone', urls: {}, blobs: [], at: 0, loading: false, key: '' };
            this.build();
            // the device's screens in its picture: on opening, on a new device, then once a minute
            // while the window is up (no faster: #811 no client polling under 60 s)
            const shotTimer = setInterval(() => { if (!doc.hidden) this.loadScreens(true); }, 60000);
            this.app.signal.addEventListener('abort', () => { clearInterval(shotTimer); this.screens.blobs.forEach((u) => URL.revokeObjectURL(u)); });
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
                if (dev) out.push({ id: 'info', text: 'Device information', icon: 'item-32.png' });
                if (dev && dev.online) out.push({ id: 'screens', text: dev.adb && dev.adb.screenshots === false ? 'Show screenshots of your device' : "Show your device's wallpapers, not screenshots", icon: 'item-32.png' });
                if (dev && dev.partner && !local) out.push({ id: 'end', text: 'End a partnership', icon: 'end-partnership-32.png' });
            }
            if (tile === 'programs' && dev && dev.online && dev.permissions.includes('notify') && root.activeSyncNotifications) {
                const n = root.activeSyncNotifications.count(dev.deviceId);
                out.push({ id: 'notifications', text: n ? `View notifications on your device (${n})` : 'View notifications on your device', icon: 'item-32.png' });
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

        /** Not connected: the two phones; connected: the drawn phone with its screens in it. */
        paintDevice(dev, connected) {
            const box = this.el('.asdc-device');
            if (!connected) {
                if (box.dataset.mode !== 'none') { box.dataset.mode = 'none'; box.innerHTML = `<img src="${A}/devices-256.png" alt="" draggable="false">`; }
                return;
            }
            if (this.screens.deviceId !== dev.deviceId) {
                this.screens.blobs.forEach((u) => URL.revokeObjectURL(u));
                Object.assign(this.screens, { deviceId: dev.deviceId, urls: {}, blobs: [], at: 0, key: '' });
            }
            const sc = this.screens;
            // a foldable by its model (Galaxy Z Fold: SM-F9xx) or by a cover screen ADB reported
            const fold = /^SM-F9/i.test(dev.model || '') || sc.form === 'fold';
            const dex = !!(dev.link === 'usb' || isContinuityDevice(dev) || sc.urls.externalOn);
            const screens = { inner: sc.urls.inner || null, cover: sc.urls.cover || null, external: dex ? (sc.urls.external || sc.urls.inner || null) : null, screen: sc.urls.screen || 'inner' };
            const key = JSON.stringify([fold, screens]);
            if (box.dataset.mode !== 'device' || box.dataset.key !== key) {
                box.dataset.mode = 'device';
                box.dataset.key = key;
                box.innerHTML = deviceArt({ form: fold ? 'fold' : 'phone', screens, uid: 'asdc' });
            }
            if (!sc.at && !sc.loading) this.loadScreens(false);
        }

        /**
         * What the screens show: screenshots over ADB while the phone allows them (Android Bridge /
         * this window's Mobile Device Settings), else its wallpapers (status.wallpapers).
         */
        async loadScreens(again) {
            const dev = this.device();
            const sc = this.screens;
            if (!dev || !dev.online || sc.loading || (again && !sc.at)) return;
            sc.loading = true;
            const id = dev.deviceId;
            const urls = {};
            const blobs = [];
            try {
                const adb = dev.adb || {};
                if (adb.state === 'ready' && adb.screenshots !== false) {
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
                if (!urls.inner) {
                    const a = as();
                    const w = a ? await a.call(id, 'status.wallpapers', {}, { timeoutMs: 15000 }).catch(() => null) : null;
                    if (w) {
                        for (const k of ['inner', 'cover', 'external']) if (!urls[k] && typeof w[k] === 'string' && /^(\/[^/]|data:image\/)/.test(w[k])) urls[k] = w[k];
                        if (!urls.screen && (w.screen === 'cover' || w.screen === 'inner')) urls.screen = w.screen;
                    }
                }
            } finally {
                sc.loading = false;
            }
            if (this.app.signal.aborted || sc.deviceId !== id) { blobs.forEach((u) => URL.revokeObjectURL(u)); return; }
            sc.blobs.forEach((u) => URL.revokeObjectURL(u));
            sc.blobs = blobs;
            sc.urls = urls;
            sc.at = Date.now();
            this.render();
        }

        /** Mobile Device Settings: screenshots of the phone or its wallpapers in its picture. */
        async toggleScreenshots(dev) {
            const on = !(dev.adb && dev.adb.screenshots === false);
            const r = await fetch(`/api/activesync/adb/${dev.deviceId}/settings`, {
                method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screenshots: !on })
            }).then((x) => x.json()).catch(() => null);
            if (!r || !r.success) { await this.messageBox('The setting could not be changed.', null, 'error'); return; }
            if (dev.adb) dev.adb.screenshots = !on;
            this.screens.at = 0;
            const a = as();
            if (a) a.refresh().catch(() => {});
            this.loadScreens(false);
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
            if (this.status === 'connecting') {
                img.src = `${A}/status-connecting-${(this.frame % 8) + 1}.png`;
                text.textContent = 'Connecting';
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
            row('Device name:', esc(dev.name));
            row('Model:', esc(dev.model));
            row('Operating system:', esc(dev.os));
            row('Program:', esc(dev.app));
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
            if (dev.online && st.wifi && st.wifi.connected) row('Wi-Fi:', esc(`${st.wifi.ssid || 'Connected'}${st.wifi.level != null ? `, signal ${st.wifi.level} of 4` : ''}`));
            if (dev.online && st.cellular && st.cellular.present) {
                row('Cellular:', esc(st.cellular.airplane ? 'Flight mode' : [st.cellular.operator, st.cellular.dataType, st.cellular.roaming ? 'roaming' : ''].filter(Boolean).join(', ') || 'No service'));
            }
            for (const s of (dev.online && st.storage) || []) {
                if (s.total == null || s.free == null || !(s.total > 0)) continue;
                const used = Math.max(0, Math.min(1, 1 - s.free / s.total));
                row(`${s.name || 'Storage'}:`, `<span class="asdc-bar${used > 0.9 ? ' is-full' : ''}"><i style="width:${(used * 100).toFixed(1)}%"></i></span>${esc(`${bytes(s.free)} free of ${bytes(s.total)}`)}`);
            }
            // Localhost ADB (#818/#820): the port it runs on, from Android Bridge > Advanced Tools
            if (dev.adb) row('Localhost ADB:', esc(dev.adb.allow === false ? 'Off' : `Port ${dev.adb.port || 5555}`));
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
            if (cmd === 'screens' && dev) { await this.toggleScreenshots(dev); return; }
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
                            AllowDataConnections: ctx.get(1013) ? 1 : 0
                        });
                    }
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
