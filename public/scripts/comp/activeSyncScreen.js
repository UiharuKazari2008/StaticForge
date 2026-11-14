/**
 * ActiveSync remote viewer: a phone's screen in a desktop window (Yozora #747). View only.
 *
 * On the phone (the Android app, window.AndroidScreen):
 *   screen.start   asks Android for the screen; its own prompt asks the user every time.
 *                  -> { started: true } once frames are on their way; DENIED when the user says no
 *   screen.stop    ends it
 *   event screen.state { state: 'stopped', reason }   it ended on the phone (the user, a lock)
 * Frames do not pass through ActiveSync: the app posts them to the server and this window reads
 * /api/activesync/screen/<device>/stream (modules/activeSyncScreen.js). The phone stops by itself
 * when nobody reads it.
 *
 * On the desktop: Device Center > Programs and Services > "View your device's screen", or
 *   activeSyncScreen.open(deviceId)
 */
(function (root) {
    'use strict';

    const as = root.activeSync;
    if (!as || !as.kind) return;
    const err = (code, message) => ({ code, message });

    if (as.kind === 'device') {
        const bridge = root.AndroidScreen;
        const usable = !!(bridge && typeof bridge.start === 'function');
        let waiting = null; // { resolve, reject, timer } of a screen.start in flight

        root.addEventListener('androidscreen', (ev) => {
            const d = (ev && ev.detail) || {};
            const w = waiting;
            if (d.state === 'started') {
                if (w) { waiting = null; clearTimeout(w.timer); w.resolve({ started: true }); }
            } else {
                if (w) {
                    waiting = null;
                    clearTimeout(w.timer);
                    w.reject(d.state === 'denied' ? err('DENIED', 'Viewing the screen was not allowed on the device.') : err('FAILED', 'The device could not share its screen.'));
                } else if (d.state === 'stopped') {
                    as.emit('screen.state', { state: 'stopped', reason: String(d.reason || '') });
                }
            }
        });

        /*
         * status.wallpapers (#818): what each screen shows behind the shell, for Device Center's
         * picture of the phone when screenshots are off: { inner, cover, external } (null = none).
         * The phone's screens draw Today's picture (its own, the workspace's or Android's), the DeX
         * window the workspace's desktop wallpaper. A same-site path goes as it is; anything the
         * desktop cannot load (Android's wallpaper, a data or blob URL) goes as a JPEG data URL at
         * most 720 px on the long side.
         */
        const wallCache = new Map(); // url -> data URL
        function shrink(url) {
            if (!url) return Promise.resolve(null);
            if (/^\/[^/]/.test(url)) return Promise.resolve(url);
            if (wallCache.has(url)) return Promise.resolve(wallCache.get(url));
            return new Promise((resolve) => {
                const im = new Image();
                im.crossOrigin = 'anonymous';
                im.onload = () => {
                    try {
                        const k = Math.min(1, 720 / Math.max(im.naturalWidth, im.naturalHeight));
                        const c = document.createElement('canvas');
                        c.width = Math.max(1, Math.round(im.naturalWidth * k));
                        c.height = Math.max(1, Math.round(im.naturalHeight * k));
                        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
                        const data = c.toDataURL('image/jpeg', 0.8);
                        wallCache.set(url, data);
                        resolve(data);
                    } catch (_) { resolve(null); }
                };
                im.onerror = () => resolve(null);
                im.src = url;
            });
        }
        const sources = () => {
            const w = root.wmShell && root.wmShell.wallpaper;
            return { today: w && typeof w.picture === 'function' ? w.picture() : null, desk: w && typeof w.desktop === 'function' ? w.desktop() : null };
        };
        async function wallpapers() {
            const { today, desk } = sources();
            const [phone, dex] = await Promise.all([shrink(today), shrink(desk)]);
            // the cover and the inner screen run the same Today (one picture for both)
            // which screen is on: a foldable's cover is narrow (about 9:21), its inner screen near square
            const vw = root.innerWidth || 0; const vh = root.innerHeight || 0;
            const screen = vw && vh && Math.min(vw, vh) / Math.max(vw, vh) < 0.56 && /^SM-F9/i.test((root.AndroidActiveSync && typeof root.AndroidActiveSync.getModel === 'function' && root.AndroidActiveSync.getModel()) || navigator.userAgent) ? 'cover' : 'inner';
            return { inner: phone, cover: phone, external: dex || phone, screen };
        }
        as.registerOp('status.wallpapers', wallpapers);

        /*
         * The server keeps the wallpapers for Device Center (#827, modules/activeSyncWallpapers.js):
         * sent once per connection and again when a wallpaper changes (Settings, a workspace switch,
         * Android's own wallpaper), never on a timer.
         */
        let sentKey = '';
        let sendTimer = null;
        let sending = false;
        async function sendWallpapers(force) {
            const st = as.state();
            if (!st.online || !st.id || !st.session || st.session === 'pending' || sending) return;
            const src = sources();
            const vw = root.innerWidth || 0; const vh = root.innerHeight || 0;
            const key = JSON.stringify([src.today, src.desk, vw > vh]);
            if (!force && key === sentKey) return;
            sending = true;
            try {
                const body = await wallpapers();
                if (!body.inner && !body.external) return;
                const r = await fetch(`/api/activesync/wallpapers/${encodeURIComponent(st.id)}`, {
                    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
                });
                if (r.ok) sentKey = key;
            } catch (_) { /* the next change tries again */ } finally { sending = false; }
        }
        const soon = (force) => { clearTimeout(sendTimer); sendTimer = setTimeout(() => { void sendWallpapers(force); }, 2500); };
        let wasOnline = false;
        as.on('state', () => {
            const st = as.state();
            const now = !!(st.online && st.session && st.session !== 'pending');
            if (now && !wasOnline) soon(true);
            wasOnline = now;
        });
        document.addEventListener('wmSettingsChange', () => soon(false));
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(false); });
        root.addEventListener('androidwallpaper', () => soon(false));
        ['workspaceSwitchComplete', 'workspaceUpdated'].forEach((n) => { document.addEventListener(n, () => soon(false)); root.addEventListener(n, () => soon(false)); });

        as.registerOp('screen.start', () => {
            if (!usable) throw err('UNSUPPORTED', 'This device cannot share its screen.');
            if (bridge.isRunning()) return { started: true };
            if (waiting) throw err('BUSY', 'The device is already being asked.');
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => { if (waiting) { waiting = null; reject(err('TIMEOUT', 'Nobody answered on the device.')); } }, 80000);
                waiting = { resolve, reject, timer };
                if (bridge.start() !== true) { waiting = null; clearTimeout(timer); reject(err('FAILED', 'The device could not ask for its screen.')); }
            });
        });
        as.registerOp('screen.stop', () => { if (usable) bridge.stop(); return true; });
        return;
    }

    // ---------------------------------------------------------------- desktop
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ICONS = '/melaton-apps/activesync/assets'; // the Device Center package's art: a child window carries its parent's icon
    const open = new Map(); // deviceId -> viewer

    function view(deviceId) {
        const had = open.get(deviceId);
        if (had) { call('openModal', had.modal); return had; }
        const dev = as.device(deviceId);
        const name = (dev && dev.name) || 'Device';
        const m = document.createElement('div');
        m.className = 'modal hidden as-screen-window';
        m.id = `activeSyncScreen-${deviceId.slice(0, 8)}`;
        m.dataset.windowIdentifier = 'activeSyncScreen';
        m.dataset.windowClient = 'dark';
        m.dataset.taskbarIcon = `${ICONS}/activesync-32.png`;
        m.dataset.windowDefaultWidth = '380';
        m.dataset.windowDefaultHeight = '760';
        m.style.width = '380px';
        m.style.height = '760px';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-label', `${name} - Screen`);
        m.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main"><i class="fas fa-mobile-screen icon-fa"></i><img class="icon-image" src="${ICONS}/activesync-16.png" alt=""><span>${esc(name)} - Screen</span></div>
            </div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-secondary maximize-btn btn-small" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content" style="padding:0;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative">
                <img class="as-screen-img" alt="" draggable="false" style="max-width:100%;max-height:100%;object-fit:contain;display:none">
                <div class="as-screen-note" style="position:absolute;left:16px;right:16px;text-align:center;color:#fff;font:12px 'Segoe UI',Tahoma,sans-serif"></div>
            </div>`;
        document.body.appendChild(m);
        const img = m.querySelector('.as-screen-img');
        const note = m.querySelector('.as-screen-note');
        const v = { modal: m, closed: false, sized: false };
        open.set(deviceId, v);
        const say = (text) => { note.textContent = text || ''; note.style.display = text ? '' : 'none'; };
        const blank = (text) => { img.removeAttribute('src'); img.style.display = 'none'; say(text); };

        // the first frame gives the window the phone's shape (as tall as the desktop allows)
        img.addEventListener('load', () => {
            say('');
            img.style.display = '';
            if (v.sized || !img.naturalWidth) return;
            v.sized = true;
            if (m.hasAttribute('data-window-size-restored')) return;
            const chromeH = m.getBoundingClientRect().height - m.querySelector('.modal-content').getBoundingClientRect().height;
            const chromeW = m.getBoundingClientRect().width - m.querySelector('.modal-content').getBoundingClientRect().width;
            const maxH = Math.max(240, root.innerHeight - 120 - chromeH);
            const maxW = Math.max(240, root.innerWidth - 80 - chromeW);
            const k = Math.min(1, maxH / img.naturalHeight, maxW / img.naturalWidth);
            m.style.width = `${Math.round(img.naturalWidth * k + chromeW)}px`;
            m.style.height = `${Math.round(img.naturalHeight * k + chromeH)}px`;
            if (!m.hasAttribute('data-window-position-restored')) {
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            }
        });
        img.addEventListener('error', () => { if (!v.closed && img.hasAttribute('src')) blank('The screen is no longer being sent.'); });

        const close = () => {
            if (v.closed) return;
            v.closed = true;
            open.delete(deviceId);
            off();
            img.removeAttribute('src');
            as.call(deviceId, 'screen.stop', {}).catch(() => {});
            try { call('closeModal', m); } catch (_) { /* gone */ }
            setTimeout(() => m.remove(), 400);
        };
        v.close = close;
        m.querySelector('.close-btn').addEventListener('click', close);
        const onLife = (e) => { if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') close(); };
        document.addEventListener('staticforge:modal-lifecycle', onLife);
        const offEvent = as.on('event', (e) => {
            if (!e || !e.from || e.from.id !== deviceId || e.event !== 'screen.state' || v.closed) return;
            if (e.detail && e.detail.state === 'stopped') blank(`${name} stopped sharing its screen.`);
        });
        const offState = as.on('state', () => {
            const d = as.device(deviceId);
            if (!v.closed && (!d || !d.online)) blank(`${name} is not connected.`);
        });
        const off = () => {
            document.removeEventListener('staticforge:modal-lifecycle', onLife);
            if (typeof offEvent === 'function') offEvent();
            if (typeof offState === 'function') offState();
        };

        call('openModal', m);
        m.classList.remove('hidden');
        say(`Waiting for ${name}. Allow the screen to be viewed on the device.`);
        as.call(deviceId, 'screen.start', {}, { timeoutMs: 90000 }).then(() => {
            if (v.closed) { as.call(deviceId, 'screen.stop', {}).catch(() => {}); return; }
            say(`Connecting to ${name}...`);
            img.src = `/api/activesync/screen/${deviceId}/stream?t=${Date.now()}`;
        }, (e) => {
            if (!v.closed) blank((e && e.message) || 'The screen could not be viewed.');
        });
        return v;
    }

    root.activeSyncScreen = { open: view, close: (deviceId) => { const v = open.get(deviceId); if (v) v.close(); } };

    const mas = (root.melatonActiveSync = root.melatonActiveSync || {});
    const add = (tile, task) => (typeof mas.addTask === 'function' ? mas.addTask(tile, task) : (mas.pending = mas.pending || []).push([tile, task]));
    add('programs', {
        id: 'screen-view', text: "View your device's screen", icon: 'camera-32.png',
        when: (d) => d.online && d.permissions.includes('screen'),
        run: (d) => { view(d.deviceId); }
    });
})(typeof window !== 'undefined' ? window : globalThis);
