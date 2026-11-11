/**
 * Melaton Mobile: Remote Desktop Mobile (Yozora #732, parent #709). Yukimi, Nov 10: no lazy ports of
 * desktop apps; the desktop's two Guacamole apps, Remote Desktop Manager (guacRemote.js) and Remote
 * Desktop Connection (remoteDesktopConnection.js), are one phone app here, WM 6.1 Professional's
 * Remote Desktop Mobile (wpctsc.exe).
 *
 * Connect screen: "Status:" line, Computer (an editable combo: the computers typed before, as
 * Remote Desktop Connection keeps them, then Remote Desktop Manager's saved connections), User
 * name, Password, Domain, Save password; soft keys Connect | Menu (Options..., About). Options:
 * Display (Colors, Fit remote desktop to screen) and Resources (Sound, storage card) tabs at the
 * bottom. Only Fit is live (the remote desktop's size: this screen, or 1024 x 768 to pan round);
 * the rest is drawn as WM draws it, greyed (Guacamole's quick connect cannot honour it).
 *
 * Data and connections are the desktop's: GET /api/desktop-guac/connections (the manager's list),
 * GET /api/desktop-guac/session/:id (a saved connection), POST /api/desktop-guac/quick/status +
 * /api/desktop-guac/quick (a typed computer; Remote Desktop Connection's checks, codes and mstsc
 * strings through remoteDesktopConnection.shared). The session is Guacamole's own web client in a
 * same-origin frame, as on the desktop: guacFrameMirror.js inside it reports the status through
 * parent.mirrorDesktopGuacFrame, which this file wraps for its own frame (the desktop windows'
 * frames still go to guacRemote.js). Ends are the desktop's: a lost session retries (Reconnecting,
 * "Connection attempt n of 20"), any other end tells mstsc's words for the status code.
 *
 * Session view: the remote screen fitted to the phone under a touch layer: drag pans, pinch zooms,
 * tap = left click, tap-and-hold = right click (WM's ring of dots), double tap = double click; the
 * SIP button (or Menu > Keyboard) opens the phone keyboard, whose keys go to the session. Soft keys
 * Full Screen | Menu (Fit to Screen, Ctrl+Alt+Del, Keyboard, Special Keys, Paste, Refresh Screen,
 * Disconnect). Full Screen hides the title bar and soft keys; the back key or the corner tab brings
 * them back. Back on the session asks before disconnecting; X leaves it running (Smart Minimize).
 * Rotation refits live (with Fit, the remote desktop takes the new screen size).
 *
 * Every desktop route (Start menu / Run / desktop shortcuts: openDesktopGuac, openDesktopGuacSession,
 * openDesktopGuacHome, remoteDesktopConnection.open / connectTo) opens this app on the phone, so the
 * desktop windows never open here. Only on phones. Styles: public/css/wm-remote-desktop.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'remote-desktop-mobile';
    const TITLE = 'Remote Desktop Mobile';
    const ICON = '/static_images/app_icons/vista-remote-desktop.png';
    const OPT_KEY = 'wmRemoteDesktopOptions';
    const DOMAIN_KEY = 'wmRemoteDesktopDomain';
    const LAST_KEY = 'wmRemoteDesktopComputer';
    const SAVE_PW_KEY = 'wmRemoteDesktopSavePassword';
    // Fit off: the remote desktop is a 1024 x 768 one to pan round (a desktop's size, like the
    // desktop Remote Desktop Connection's middle Display stop)
    const FULL_SIZE = [1024, 768];
    const HOLD_MS = 600;
    const MOVE_SLOP = 10;
    const MAX_ZOOM = 4;
    const SENTINEL = '​';
    const CONNECTING_STATES = new Set(['IDLE', 'CONNECTING', 'WAITING']);
    const COLORS = [['8', '256 Colors'], ['16', 'High Color (16 Bit)']];
    const SOUNDS = [['device', 'Play on this device'], ['remote', 'Play on remote computer'], ['none', 'Do not play']];

    // X11 keysyms Guacamole sends (Guacamole.Keyboard's table)
    const KEYSYM = {
        Backspace: 0xFF08, Tab: 0xFF09, Enter: 0xFF0D, Escape: 0xFF1B, Delete: 0xFFFF, Insert: 0xFF63,
        Home: 0xFF50, End: 0xFF57, PageUp: 0xFF55, PageDown: 0xFF56,
        ArrowLeft: 0xFF51, ArrowUp: 0xFF52, ArrowRight: 0xFF53, ArrowDown: 0xFF54,
        Shift: 0xFFE1, Control: 0xFFE3, Alt: 0xFFE9, Meta: 0xFFEB, Win: 0xFFEB,
        F1: 0xFFBE, F2: 0xFFBF, F3: 0xFFC0, F4: 0xFFC1, F5: 0xFFC2, F6: 0xFFC3,
        F7: 0xFFC4, F8: 0xFFC5, F9: 0xFFC6, F10: 0xFFC7, F11: 0xFFC8, F12: 0xFFC9
    };
    const SPECIAL_KEYS = [
        ['Esc', ['Escape']], ['Tab', ['Tab']], ['Windows', ['Win']], ['Alt+Tab', ['Alt', 'Tab']],
        ['Alt+F4', ['Alt', 'F4']], ['Ctrl+Esc', ['Control', 'Escape']], ['Ctrl+Shift+Esc', ['Control', 'Shift', 'Escape']],
        ['Print Screen', [0xFF61]], '-', ['F1', ['F1']], ['F2', ['F2']], ['F5', ['F5']], ['F11', ['F11']]
    ];

    let ws = null;
    let page = null;
    let els = null;
    let shown = false;
    let view = 'form'; // form | options | session
    let optTab = 'display';
    let options = readOptions();
    let conns = []; // the manager's saved connections [{ id, name, protocol, groupName }]
    let listState = { loaded: false, loading: false, error: '' };
    let status = 'Not connected';
    const passwords = new Map(); // computer (lower case) -> password, this page's life only
    let session = null;
    let full = false;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isCurrent = () => !!ws && ws.current === APP_ID;

    function readJson(key, fallback) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || 'null');
            return v == null ? fallback : v;
        } catch (_) { return fallback; }
    }

    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private window: not kept */ }
    }

    function readOptions() {
        const o = readJson(OPT_KEY, {});
        return {
            colors: o.colors === '8' ? '8' : '16',
            fit: o.fit !== false,
            sound: SOUNDS.some(([v]) => v === o.sound) ? o.sound : 'device',
            storage: !!o.storage
        };
    }

    // ---------------------------------------------------------------- desktop modules

    /** Remote Desktop Connection (and the manager it depends on): strings, parser, history. */
    async function loadRdc() {
        if (!window.remoteDesktopConnection || !window.mirrorDesktopGuacFrame) {
            if (!window.featureLoader) throw new Error('featureLoader missing');
            await window.featureLoader.loadFeature('remote_desktop_connection');
        }
        patchDesktop();
        return window.remoteDesktopConnection;
    }

    const shared = () => (window.remoteDesktopConnection && window.remoteDesktopConnection.shared) || null;

    function sharedText(key, fallback) {
        const s = shared();
        return (s && s.text && s.text[key]) || fallback;
    }

    // ---------------------------------------------------------------- connection list

    async function loadList() {
        if (listState.loading) return;
        listState.loading = true;
        let response = null;
        let payload = null;
        try {
            response = await fetch('/api/desktop-guac/connections', { credentials: 'same-origin' });
            payload = await response.json().catch(() => null);
        } catch (_) {
            response = null;
        }
        listState.loading = false;
        listState.loaded = true;
        if (!response) {
            listState.error = 'Could not reach Dreamscape for the Komaki connection list.';
        } else if (!response.ok || !payload || payload.ok !== true) {
            // a Guest / PIN session: "Remote Desktop needs a full sign-in" (guacRemoteBridge.js)
            listState.error = (payload && payload.ok === false && payload.error) || 'Komaki connection list is unavailable.';
        } else {
            listState.error = '';
            conns = (Array.isArray(payload.connections) ? payload.connections : [])
                .filter((c) => c && c.id)
                .map((c) => ({ id: String(c.id), name: String(c.name || c.id), protocol: String(c.protocol || ''), groupName: String(c.groupName || '') }));
        }
        if (!session) status = listState.error || 'Not connected';
        if (!els) return;
        if (!readComputer() && !session) fillLast();
        paintForm();
    }

    function history() {
        const s = shared();
        try { return s ? s.readHistory() : readJson('remoteDesktopConnectionHistory', []).filter((v) => typeof v === 'string'); } catch (_) { return []; }
    }

    function findSaved(text) {
        const t = String(text || '').trim().toLowerCase();
        if (!t) return null;
        return conns.find((c) => c.name.toLowerCase() === t) || null;
    }

    // ---------------------------------------------------------------- build

    function build() {
        page.innerHTML = `
            <div class="wrd-layer wrd-form" data-layer="form">
                <div class="wrd-scroll">
                    <div class="wm-form wrd-connect">
                        <div class="wrd-status" aria-live="polite"><b>Status:</b><span></span></div>
                        <div class="wm-form-row"><label for="wrdComputer">Computer:</label><div class="wm-combo-edit"><input id="wrdComputer" class="wm-edit" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><button type="button" class="wm-combo" data-act="computers" aria-label="Recent computers"></button></div></div>
                        <div class="wm-form-row"><label for="wrdUser">User name:</label><input id="wrdUser" class="wm-edit" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
                        <div class="wm-form-row"><label for="wrdPass">Password:</label><input id="wrdPass" class="wm-edit" type="password" autocomplete="off"></div>
                        <div class="wm-form-row"><label for="wrdDomain">Domain:</label><input id="wrdDomain" class="wm-edit" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
                        <div class="wrd-save"><label class="wm-check"><input type="checkbox" id="wrdSavePw"><span>Save password</span></label></div>
                    </div>
                </div>
            </div>
            <div class="wrd-layer wrd-options" data-layer="options" hidden>
                <div class="wrd-scroll"><div class="wm-form wrd-optform"></div></div>
                <div class="wm-tabs" role="tablist">
                    <button type="button" class="wm-tab" role="tab" data-tab="display">Display</button>
                    <button type="button" class="wm-tab" role="tab" data-tab="resources">Resources</button>
                </div>
            </div>
            <div class="wrd-layer wrd-session" data-layer="session" hidden>
                <div class="wrd-viewport"><div class="wrd-touch"></div></div>
                <div class="wrd-banner" role="status" aria-live="polite" hidden></div>
                <textarea class="wrd-ime" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Keyboard input"></textarea>
                <button type="button" class="wrd-restore" aria-label="Exit full screen" hidden></button>
            </div>`;
        els = {
            form: page.querySelector('[data-layer="form"]'),
            options: page.querySelector('[data-layer="options"]'),
            optForm: page.querySelector('.wrd-optform'),
            sess: page.querySelector('[data-layer="session"]'),
            viewport: page.querySelector('.wrd-viewport'),
            touch: page.querySelector('.wrd-touch'),
            banner: page.querySelector('.wrd-banner'),
            ime: page.querySelector('.wrd-ime'),
            restore: page.querySelector('.wrd-restore'),
            status: page.querySelector('.wrd-status span'),
            computer: page.querySelector('#wrdComputer'),
            combo: page.querySelector('[data-act="computers"]'),
            user: page.querySelector('#wrdUser'),
            pass: page.querySelector('#wrdPass'),
            domain: page.querySelector('#wrdDomain'),
            savePw: page.querySelector('#wrdSavePw')
        };
        els.combo.addEventListener('click', (e) => { e.stopPropagation(); openComputerList(); });
        els.computer.addEventListener('input', () => { fillCredentials(); paintForm(); });
        els.computer.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); openComputerList(); }
        });
        page.querySelectorAll('.wrd-connect .wm-edit').forEach((input) => {
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                connect();
            });
        });
        els.savePw.addEventListener('change', () => writeJson(SAVE_PW_KEY, els.savePw.checked));
        page.querySelectorAll('.wm-tab').forEach((t) => t.addEventListener('click', () => { optTab = t.dataset.tab; paintOptions(); }));
        els.restore.addEventListener('click', () => setFull(false));
        bindTouch();
        els.ime.addEventListener('input', onImeInput);
        els.ime.addEventListener('keydown', onImeKey);
        if (typeof ResizeObserver === 'function') {
            let t = 0;
            new ResizeObserver(() => { clearTimeout(t); t = setTimeout(refit, 60); }).observe(els.viewport);
        }
        els.user.value = (shared() && shared().userName()) || '';
        els.domain.value = readJson(DOMAIN_KEY, '') || '';
        els.savePw.checked = !!readJson(SAVE_PW_KEY, false);
        fillLast();
    }

    function readComputer() {
        return els ? els.computer.value.trim() : '';
    }

    function fillLast() {
        const last = readJson(LAST_KEY, '');
        const value = (typeof last === 'string' && last) || history()[0] || (conns[0] && conns[0].name) || '';
        els.computer.value = value;
        fillCredentials();
    }

    function fillCredentials() {
        const pw = passwords.get(readComputer().toLowerCase());
        els.pass.value = pw || '';
    }

    // ---------------------------------------------------------------- paint

    function layer() {
        return view;
    }

    function paint() {
        if (!els) return;
        els.form.hidden = view !== 'form';
        els.options.hidden = view !== 'options';
        // the session layer keeps its layout while connecting (visibility, not display)
        els.sess.hidden = !(view === 'session' || (session && !session.shownOnce));
        els.sess.classList.toggle('is-pending', !!session && view !== 'session');
        if (view === 'form' && session && !session.shownOnce) {
            // the pending session sits behind the form, sized like the session view
            els.sess.style.position = 'absolute';
            els.sess.style.inset = '0';
            els.sess.style.zIndex = '-1';
        } else {
            els.sess.style.position = '';
            els.sess.style.inset = '';
            els.sess.style.zIndex = '';
        }
        paintForm();
        if (view === 'options') paintOptions();
        paintSession();
        if (ws) ws.setTitle(TITLE);
    }

    function paintForm() {
        if (!els) return;
        els.status.textContent = status;
        const saved = findSaved(readComputer());
        const busyConnecting = !!session;
        // a saved connection carries its own credentials in Guacamole: the boxes grey out
        [['wrdUser', els.user], ['wrdPass', els.pass], ['wrdDomain', els.domain]].forEach(([id, input]) => {
            const off = !!saved || busyConnecting;
            input.disabled = off;
            const label = page.querySelector(`label[for="${id}"]`);
            if (label) label.classList.toggle('is-disabled', off);
        });
        els.savePw.disabled = !!saved || busyConnecting;
        els.computer.disabled = busyConnecting;
        els.combo.disabled = busyConnecting;
    }

    function paintOptions() {
        page.querySelectorAll('.wm-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === optTab)));
        const o = options;
        const label = (list, v) => (list.find(([k]) => k === v) || list[0])[1];
        if (optTab === 'display') {
            els.optForm.innerHTML = `
                <div class="wm-form-row"><span class="wm-form-label">Colors:</span><button type="button" class="wm-combo" data-opt="colors" disabled><span>${esc(label(COLORS, o.colors))}</span></button></div>
                <label class="wm-check"><input type="checkbox" data-opt="fit"${o.fit ? ' checked' : ''}><span>Fit remote desktop to screen</span></label>`;
        } else {
            els.optForm.innerHTML = `
                <div class="wm-form-row"><span class="wm-form-label">Sound:</span><button type="button" class="wm-combo" data-opt="sound" disabled><span>${esc(label(SOUNDS, o.sound))}</span></button></div>
                <label class="wm-check"><input type="checkbox" data-opt="storage" disabled${o.storage ? ' checked' : ''}><span>Remote mobile device storage card</span></label>`;
        }
        const fit = els.optForm.querySelector('[data-opt="fit"]');
        if (fit) fit.addEventListener('change', () => { options.fit = fit.checked; });
    }

    function setView(next) {
        if (view === next) return;
        if (view === 'session' && next !== 'session') setFull(false);
        view = next;
        paint();
        if (ws && isCurrent()) {
            ws.syncHistory();
            ws.refreshSoftKeys();
        }
    }

    // ---------------------------------------------------------------- computer list (combo)

    function openComputerList() {
        if (!els || els.combo.disabled) return;
        const cur = readComputer().toLowerCase();
        const pick = (value) => {
            els.computer.value = value;
            fillCredentials();
            paintForm();
        };
        const items = [];
        const recent = history();
        recent.forEach((h) => items.push({ label: h, radio: h.toLowerCase() === cur, action: () => pick(h) }));
        const saved = conns.slice().sort((a, b) => a.name.localeCompare(b.name));
        if (recent.length && saved.length) items.push('-');
        saved.forEach((c) => items.push({ label: c.name, radio: c.name.toLowerCase() === cur, action: () => pick(c.name) }));
        if (!items.length) {
            // the reason (a Guest session ...) is on the Status line; the list stays the box's width
            items.push({ label: '(No computers)', disabled: true });
        }
        ws.dropdown(els.computer.closest('.wm-combo-edit'), items, 'left');
    }

    // ---------------------------------------------------------------- connect

    async function postJson(url, body) {
        const response = await fetch(url, {
            method: body ? 'POST' : 'GET',
            credentials: 'same-origin',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
        const payload = await response.json().catch(() => null);
        return { response, payload: payload || {} };
    }

    function fail(text) {
        status = listState.error || 'Not connected';
        paintForm();
        ws.notify({ title: TITLE, icon: 'error', text });
    }

    async function connect() {
        if (session) return;
        try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (_) { /* fine */ }
        const typed = readComputer();
        let rdc;
        try {
            rdc = await ws.busy(() => loadRdc(), { paint: true });
        } catch (_) {
            fail('Remote Desktop could not be loaded. Try again.');
            return;
        }
        const s = rdc.shared;
        if (!typed) { fail(s.text.blank); els.computer.focus(); return; }
        writeJson(LAST_KEY, typed);
        const saved = findSaved(typed);
        if (saved) { await connectSaved(saved); return; }
        const target = s.parseComputer(typed);
        if (target.error) { fail(target.error); return; }
        // Remote Desktop Mobile is RDP; a typed scheme or port (ssh://, :5900) picks the rest, as the
        // desktop's Computer box does, else the computer's last protocol
        target.protocol = target.protocol || s.readProtocols()[typed.toLowerCase()] || 'rdp';
        const username = els.user.value.trim();
        const domain = els.domain.value.trim();
        const password = els.pass.value;
        s.setUserName(username);
        writeJson(DOMAIN_KEY, domain);
        if (els.savePw.checked && password) passwords.set(typed.toLowerCase(), password);
        else passwords.delete(typed.toLowerCase());
        status = 'Connecting...';
        paintForm();
        const result = await ws.busy(async () => {
            let st;
            try { st = await postJson('/api/desktop-guac/quick/status'); } catch (_) { st = null; }
            if (st && st.response.status === 403) return { error: s.text.denied };
            if (!st || st.response.status === 404 || (st.payload.ok && !st.payload.available)) return { error: s.text.unavailable };
            if (!st.payload.ok) return { error: s.text.noServer };
            let r;
            try {
                r = await postJson('/api/desktop-guac/quick', {
                    host: target.host,
                    port: target.port || undefined,
                    protocol: target.protocol,
                    username,
                    password,
                    domain: target.protocol === 'rdp' ? domain : undefined
                });
            } catch (_) { return { error: s.text.noServer }; }
            const p = r.payload;
            if (!r.response.ok || !p.ok || !p.url) {
                const code = p.code || (r.response.status === 403 ? 'denied' : '');
                const known = ['unavailable', 'blank', 'invalid', 'refused', 'blocked', 'denied', 'busy'];
                return { error: known.includes(code) ? s.text[code] : code === 'gateway' ? s.text.noServer : s.text.generic };
            }
            return { url: p.url, name: p.name || target.host };
        }, { paint: true, timeout: 40000 }).catch(() => ({ error: s.text.noServer }));
        if (result.error) { fail(result.error); return; }
        openSession({ url: result.url, name: result.name, protocol: target.protocol, quick: { typed, protocol: target.protocol } });
    }

    async function connectSaved(conn) {
        status = 'Connecting...';
        paintForm();
        const result = await ws.busy(async () => {
            let r;
            try { r = await postJson('/api/desktop-guac/session/' + encodeURIComponent(conn.id)); } catch (_) { return { error: 'Could not reach Dreamscape for the Komaki session.' }; }
            if (!r.response.ok || !r.payload.url) return { error: r.payload.error || 'Komaki session is unavailable.' };
            return { url: r.payload.url };
        }, { paint: true, timeout: 40000 }).catch(() => ({ error: 'Could not reach Dreamscape for the Komaki session.' }));
        if (result.error) { fail(result.error); return; }
        openSession({ url: result.url, name: conn.name, protocol: conn.protocol, connectionId: conn.id });
    }

    // ---------------------------------------------------------------- session

    function frameSize() {
        if (options.fit && els) {
            const r = els.viewport.getBoundingClientRect();
            return [Math.max(160, Math.round(r.width)), Math.max(160, Math.round(r.height))];
        }
        return FULL_SIZE.slice();
    }

    /**
     * The remote desktop's size is the frame's (Guacamole asks for its client area times the pixel
     * ratio): the frame's pixel ratio is held at 1 so Fit gives a desktop the size of this screen in
     * CSS pixels (as Remote Desktop Mobile gave the device's screen) and Fit off a 1024 x 768 one.
     */
    function holdPixelRatio(frame) {
        const pin = () => {
            const w = frame.contentWindow;
            if (!w) return false;
            try {
                if (w.location.href === 'about:blank') return false;
                Object.defineProperty(w, 'devicePixelRatio', { configurable: true, get: () => 1 });
                return true;
            } catch (_) { return true; }
        };
        let tries = 0;
        const tick = () => {
            if (!frame.isConnected || pin() || ++tries > 3000) return;
            setTimeout(tick, 4);
        };
        tick();
        frame.addEventListener('load', pin);
    }

    function openSession(opts) {
        const frame = document.createElement('iframe');
        frame.className = 'wrd-frame';
        frame.title = opts.name;
        if (opts.protocol) frame.dataset.protocol = opts.protocol;
        frame.setAttribute('allow', 'clipboard-read; clipboard-write');
        session = {
            frame, name: opts.name, protocol: opts.protocol || '', quick: opts.quick || null, connectionId: opts.connectionId || null,
            fw: 0, fh: 0, scale: 1, tx: 0, ty: 0, fitted: true, connected: false, shownOnce: false, state: 'CONNECTING',
            attempts: 0, started: Date.now(), timer: 0, lastId: null, ended: false, reconnecting: false, sizeTimer: 0, passthrough: false
        };
        status = 'Connecting...';
        // the (unseen) session layer is laid out first: the frame takes its size
        paint();
        const [fw, fh] = frameSize();
        session.fw = fw;
        session.fh = fh;
        frame.style.width = `${fw}px`;
        frame.style.height = `${fh}px`;
        els.viewport.insertBefore(frame, els.touch);
        holdPixelRatio(frame);
        frame.src = opts.url;
        ws.refreshSoftKeys();
        // Guacamole's own page in the frame (a connection that asks for credentials) needs the screen
        session.pageTimer = setInterval(watchFramePage, 500);
    }

    function guac() {
        const w = session && session.frame && session.frame.contentWindow;
        if (!w || !w.angular || !w.Guacamole) return null;
        try {
            const el = w.document.querySelector('.client-view');
            let scope = el && w.angular.element(el).scope();
            while (scope && !scope.menu) scope = scope.$parent;
            const managed = scope && scope.focusedClient;
            const client = managed && managed.client;
            if (!client) return null;
            return { w, scope, managed, client, display: client.getDisplay() };
        } catch (_) { return null; }
    }

    /** Guacamole's credentials form (parameters-required) stays in the frame: show it and let taps through. */
    function watchFramePage() {
        if (!session || session.connected) return;
        let asking = false;
        try {
            const doc = session.frame.contentDocument;
            asking = !!(doc && doc.querySelector('.client-status-modal.shown, guac-modal .notification'));
        } catch (_) { asking = false; }
        if (asking && view !== 'session') {
            session.passthrough = true;
            session.shownOnce = true;
            status = 'Connecting...';
            setView('session');
        }
        if (els) els.sess.classList.toggle('is-passthrough', !!session.passthrough);
    }

    function statusCode(key) {
        const m = /ERROR_(?:CLIENT|TUNNEL)_([0-9A-F]+)$/.exec(key || '');
        return m ? parseInt(m[1], 16) : null;
    }

    /** guacFrameMirror.js's reports for this app's frame (kind: client | global | page). */
    function onMirror(kind, payload) {
        if (!session || session.ended) return;
        if (kind === 'client') { onClientStatus(payload); return; }
        if (!payload.id) return;
        const actions = Array.isArray(payload.actions) ? payload.actions : [];
        const text = [payload.title, payload.text, payload.countdown].filter(Boolean).join('\n');
        if (kind === 'page') {
            // logged out / fatal page: the session cannot go on
            endSession(text || sharedText('generic', 'This computer can\'t connect to the remote computer.'));
            return;
        }
        if (actions.length >= 2) {
            ws.messageBox({
                title: TITLE,
                icon: payload.className === 'error' ? 'error' : 'info',
                text,
                buttons: actions.map((a, i) => ({ text: a.label, value: i, default: i === 0 })),
                cancelValue: -1
            }).then((i) => {
                if (Number.isInteger(i) && actions[i]) actions[i].run();
                else if (payload.dismiss) payload.dismiss();
            });
            return;
        }
        ws.notify({
            title: TITLE,
            icon: payload.className === 'error' ? 'error' : 'info',
            text,
            buttons: actions.length ? [{ text: actions[0].label, onClick: () => actions[0].run() }] : null
        });
    }

    function onClientStatus(payload) {
        const s = session;
        s.state = payload.state || s.state;
        if (payload.state === 'CONNECTED') {
            const first = !s.connected;
            s.connected = true;
            s.attempts = 0;
            s.passthrough = false;
            clearTimeout(s.timer);
            setReconnecting(false);
            status = `Connected to ${s.name}`;
            if (first) {
                s.shownOnce = true;
                const sh = shared();
                if (s.quick && sh) sh.remember(s.quick.typed, s.quick.protocol);
                startSizeWatch();
                fitView(true);
                setView('session');
            }
            paint();
            if (isCurrent()) ws.refreshSoftKeys();
            return;
        }
        if (!s.connected && CONNECTING_STATES.has(payload.state)) {
            status = (payload.className === 'connecting' && payload.text) || 'Connecting...';
            paintForm();
        }
        if (!payload.id || payload.id === s.lastId || payload.className === 'connecting') return;
        s.lastId = payload.id;
        if (payload.className !== 'error') {
            if (payload.state === 'DISCONNECTED') endSession(null);
            return;
        }
        const code = statusCode(payload.key);
        const actions = Array.isArray(payload.actions) ? payload.actions : [];
        const reconnect = actions.find((a) => /\breconnect\b/.test(a.className || ''));
        const rdc = window.remoteDesktopConnection;
        if (reconnect && s.connected && rdc && rdc.reconnectable(code) && s.attempts < rdc.reconnectMax) {
            s.attempts++;
            setReconnecting(true);
            // each attempt at least 5 s after the one before (as the desktop's session windows)
            clearTimeout(s.timer);
            s.timer = setTimeout(() => {
                if (session !== s || s.ended) return;
                s.started = Date.now();
                reconnect.run();
            }, Math.max(0, s.started + 5000 - Date.now()));
            return;
        }
        const sh = shared();
        endSession(sh ? sh.sessionEndText(code, s.connected) : (payload.text || 'Your Remote Desktop session has ended.'));
    }

    function setReconnecting(on) {
        if (!session || !els) return;
        session.reconnecting = on;
        els.sess.classList.toggle('is-dimmed', on);
        els.banner.hidden = !on;
        if (on) {
            const st = (shared() && shared().sessionText) || {};
            const max = (window.remoteDesktopConnection && window.remoteDesktopConnection.reconnectMax) || 20;
            els.banner.innerHTML = `<b>${esc(st.reconnecting || 'Reconnecting')}</b>${esc(st.reconnectText || 'The connection has been lost. Attempting to reconnect to your session...')}<br><br>${esc(st.attempt ? st.attempt(session.attempts, max) : `Connection attempt: ${session.attempts} of ${max}`)}`;
            status = 'Reconnecting...';
        }
        if (isCurrent()) ws.refreshSoftKeys();
    }

    /** The session is over: the frame goes, the connect screen comes back, an error is told. */
    function endSession(text) {
        const s = session;
        if (!s || s.ended) return;
        s.ended = true;
        clearTimeout(s.timer);
        clearTimeout(s.discTimer);
        clearInterval(s.pageTimer);
        clearInterval(s.sizeTimer);
        session = null;
        try { s.frame.src = 'about:blank'; } catch (_) { /* gone */ }
        s.frame.remove();
        if (els) {
            els.banner.hidden = true;
            els.sess.classList.remove('is-dimmed', 'is-passthrough', 'is-pending');
            try { els.ime.blur(); } catch (_) { /* fine */ }
        }
        setFull(false);
        status = listState.error || 'Not connected';
        view = 'form';
        paint();
        if (isCurrent()) {
            ws.syncHistory({ noPush: true });
            ws.refreshSoftKeys();
        }
        if (text) ws.notify({ title: TITLE, icon: 'error', text });
    }

    /** Menu > Disconnect / Cancel: Guacamole's own disconnect (its DISCONNECTED ends the view). */
    function disconnect() {
        const s = session;
        if (!s) return;
        let api = null;
        try { api = s.frame.contentWindow && s.frame.contentWindow.dreamscapeGuac; } catch (_) { api = null; }
        if (!s.connected || !api || !api.disconnect()) { endSession(null); return; }
        status = 'Disconnecting...';
        paintForm();
        // a dead tunnel never answers
        s.discTimer = setTimeout(() => { if (session === s) endSession(null); }, 3000);
    }

    async function askDisconnect() {
        if (!session) return;
        const name = session.name;
        const yes = await ws.messageBox({
            title: TITLE,
            icon: 'question',
            text: `Disconnect from ${name}?`,
            buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }],
            cancelValue: false
        });
        if (yes) disconnect();
    }

    // ---------------------------------------------------------------- view: fit, zoom, pan

    function viewportSize() {
        const r = els.viewport.getBoundingClientRect();
        return { w: Math.max(1, r.width), h: Math.max(1, r.height), left: r.left, top: r.top };
    }

    function fitScale() {
        const { w, h } = viewportSize();
        return Math.min(w / session.fw, h / session.fh);
    }

    function applyTransform() {
        if (!session) return;
        const s = session;
        const { w, h } = viewportSize();
        const cw = s.fw * s.scale;
        const ch = s.fh * s.scale;
        s.tx = cw <= w ? (w - cw) / 2 : Math.min(0, Math.max(w - cw, s.tx));
        s.ty = ch <= h ? (h - ch) / 2 : Math.min(0, Math.max(h - ch, s.ty));
        s.frame.style.transform = `translate(${s.tx.toFixed(1)}px, ${s.ty.toFixed(1)}px) scale(${s.scale.toFixed(4)})`;
    }

    function fitView(on) {
        if (!session) return;
        session.fitted = on;
        session.scale = on ? fitScale() : 1;
        if (!on) {
            // actual size: keep the middle of what was showing in the middle
            const { w, h } = viewportSize();
            session.tx = (w - session.fw) / 2;
            session.ty = (h - session.fh) / 2;
        }
        applyTransform();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    /** Rotation / a new screen size: with Fit the remote desktop takes the new size; the view refits. */
    function refit() {
        if (!session || !els) return;
        const { w, h } = viewportSize();
        if (w < 40 || h < 40) return;
        if (options.fit && !session.followDisplay) {
            const fw = Math.round(w);
            const fh = Math.round(h);
            if (fw !== session.fw || fh !== session.fh) {
                session.fw = fw;
                session.fh = fh;
                session.frame.style.width = `${fw}px`;
                session.frame.style.height = `${fh}px`;
            }
        }
        if (session.fitted) session.scale = fitScale();
        applyTransform();
    }

    /**
     * A remote desktop that cannot take the asked size (VNC, an old RDP server) is shown at its own
     * size: the frame follows the display so 100 % is one remote pixel per CSS pixel.
     */
    function startSizeWatch() {
        const s = session;
        clearInterval(s.sizeTimer);
        s.sizeTimer = setInterval(() => {
            if (session !== s) return;
            const g = guac();
            if (!g || !g.display) return;
            const dw = g.display.getWidth();
            const dh = g.display.getHeight();
            if (!dw || !dh || (dw === s.fw && dh === s.fh)) return;
            // the pixel ratio pin did not hold: Guacamole asked for the frame times the ratio and
            // following it would grow the frame without end; Guacamole fits it in the frame itself
            let ratio = 1;
            try { ratio = Number(g.w.devicePixelRatio) || 1; } catch (_) { ratio = 1; }
            if (ratio !== 1) return;
            // Fit asked for this screen: a different answer means the remote keeps its own size
            s.followDisplay = true;
            s.fw = dw;
            s.fh = dh;
            s.frame.style.width = `${dw}px`;
            s.frame.style.height = `${dh}px`;
            if (s.fitted) s.scale = fitScale();
            applyTransform();
        }, 1000);
    }

    function zoomAt(scale, cx, cy) {
        const s = session;
        const min = Math.min(1, fitScale());
        const next = Math.max(min, Math.min(MAX_ZOOM, scale));
        const { left, top } = viewportSize();
        const px = cx - left;
        const py = cy - top;
        // the remote point under the fingers stays under them
        const rx = (px - s.tx) / s.scale;
        const ry = (py - s.ty) / s.scale;
        s.scale = next;
        s.tx = px - rx * next;
        s.ty = py - ry * next;
        s.fitted = Math.abs(next - fitScale()) < 0.002;
        applyTransform();
    }

    // ---------------------------------------------------------------- input: mouse

    /** A point on the phone -> remote display pixels (null off the remote screen). */
    function remotePoint(clientX, clientY) {
        const s = session;
        const g = guac();
        if (!s || !g || !g.display) return null;
        const { left, top } = viewportSize();
        const fx = (clientX - left - s.tx) / s.scale;
        const fy = (clientY - top - s.ty) / s.scale;
        let dx = 0;
        let dy = 0;
        try {
            const de = g.display.getElement().getBoundingClientRect();
            dx = de.left;
            dy = de.top;
        } catch (_) { /* top-left */ }
        const ds = (typeof g.display.getScale === 'function' && g.display.getScale()) || 1;
        const w = g.display.getWidth();
        const h = g.display.getHeight();
        const x = Math.round((fx - dx) / ds);
        const y = Math.round((fy - dy) / ds);
        if (!w || !h) return null;
        return { g, x: Math.max(0, Math.min(w - 1, x)), y: Math.max(0, Math.min(h - 1, y)) };
    }

    function sendMouse(p, left, right, up, down) {
        try {
            const State = p.g.w.Guacamole.Mouse.State;
            p.g.client.sendMouseState(new State(p.x, p.y, !!left, false, !!right, !!up, !!down));
            if (typeof p.g.display.moveCursor === 'function') p.g.display.moveCursor(p.x, p.y);
        } catch (_) { /* session gone */ }
    }

    function click(clientX, clientY, button) {
        const p = remotePoint(clientX, clientY);
        if (!p) return;
        sendMouse(p);
        if (button === 'right') sendMouse(p, false, true);
        else sendMouse(p, true, false);
        setTimeout(() => sendMouse(p), 40);
    }

    function wheel(clientX, clientY, upward) {
        const p = remotePoint(clientX, clientY);
        if (!p) return;
        sendMouse(p, false, false, upward, !upward);
        sendMouse(p);
    }

    const pointers = new Map();
    let gesture = null; // { kind: 'tap' | 'pan' | 'pinch' | 'held', x, y, t, tx, ty, d0, s0, holdTimer, holdEl }

    function bindTouch() {
        const t = els.touch;
        t.addEventListener('pointerdown', onDown);
        t.addEventListener('pointermove', onMove);
        t.addEventListener('pointerup', onUp);
        t.addEventListener('pointercancel', onCancel);
        t.addEventListener('contextmenu', (e) => e.preventDefault());
        t.addEventListener('wheel', (e) => {
            if (!session) return;
            e.preventDefault();
            if (e.ctrlKey) zoomAt(session.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
            else wheel(e.clientX, e.clientY, e.deltaY < 0);
        }, { passive: false });
    }

    function clearHold() {
        if (!gesture) return;
        clearTimeout(gesture.holdTimer);
        if (gesture.holdEl) gesture.holdEl.remove();
        gesture.holdEl = null;
    }

    function onDown(e) {
        if (!session || !session.connected) return;
        if (e.pointerType === 'mouse' && e.button === 2) { e.preventDefault(); click(e.clientX, e.clientY, 'right'); return; }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        try { els.touch.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
            gesture = { kind: 'tap', x: e.clientX, y: e.clientY, t: performance.now(), tx: session.tx, ty: session.ty };
            // WM's tap-and-hold: the ring of dots, then the right click
            const ring = document.createElement('div');
            ring.className = 'wrd-hold';
            const { left, top } = viewportSize();
            ring.style.left = `${e.clientX - left}px`;
            ring.style.top = `${e.clientY - top}px`;
            ring.style.setProperty('--wrd-hold-ms', `${HOLD_MS}ms`);
            gesture.holdTimer = setTimeout(() => {
                if (!gesture || gesture.kind !== 'tap') return;
                els.viewport.appendChild(ring);
                gesture.holdEl = ring;
                ring.classList.add('is-running');
                gesture.holdTimer = setTimeout(() => {
                    if (!gesture || gesture.kind !== 'tap') return;
                    clearHold();
                    gesture.kind = 'held';
                    click(gesture.x, gesture.y, 'right');
                }, HOLD_MS);
            }, 120);
        } else if (pointers.size === 2) {
            clearHold();
            const [a, b] = [...pointers.values()];
            gesture = {
                kind: 'pinch',
                d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                s0: session.scale,
                mx: (a.x + b.x) / 2,
                my: (a.y + b.y) / 2
            };
        }
    }

    function onMove(e) {
        if (!session || !pointers.has(e.pointerId) || !gesture) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (gesture.kind === 'pinch' && pointers.size >= 2) {
            const [a, b] = [...pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            // two fingers move the view too
            session.tx += mx - gesture.mx;
            session.ty += my - gesture.my;
            gesture.mx = mx;
            gesture.my = my;
            zoomAt(gesture.s0 * (d / gesture.d0), mx, my);
            return;
        }
        if (gesture.kind === 'tap' && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > MOVE_SLOP) {
            clearHold();
            gesture.kind = 'pan';
        }
        if (gesture.kind === 'pan') {
            session.tx = gesture.tx + (e.clientX - gesture.x);
            session.ty = gesture.ty + (e.clientY - gesture.y);
            applyTransform();
        }
    }

    function onUp(e) {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (!gesture) return;
        const g = gesture;
        if (g.kind === 'pinch') {
            // the finger left on the screen pans from here
            if (pointers.size === 1) {
                const [p] = [...pointers.values()];
                gesture = { kind: 'pan', x: p.x, y: p.y, tx: session ? session.tx : 0, ty: session ? session.ty : 0 };
            } else gesture = null;
            if (isCurrent()) ws.refreshSoftKeys();
            return;
        }
        clearHold();
        gesture = null;
        if (g.kind !== 'tap' || !session) return;
        // a double tap is two clicks close together: the remote side reads it as a double click
        click(g.x, g.y, 'left');
    }

    function onCancel(e) {
        pointers.delete(e.pointerId);
        clearHold();
        if (!pointers.size) gesture = null;
    }

    // ---------------------------------------------------------------- input: keys

    function keysymOf(ch) {
        const c = ch.codePointAt(0);
        if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) return c;
        if (c === 0x0a || c === 0x0d) return KEYSYM.Enter;
        return 0x01000000 | c;
    }

    function sendKeysyms(list) {
        const g = guac();
        if (!g) return false;
        const syms = list.map((k) => (typeof k === 'number' ? k : KEYSYM[k])).filter(Boolean);
        try {
            syms.forEach((k) => g.client.sendKeyEvent(1, k));
            syms.slice().reverse().forEach((k) => g.client.sendKeyEvent(0, k));
        } catch (_) { return false; }
        return true;
    }

    function sendText(text) {
        for (const ch of text) sendKeysyms([keysymOf(ch)]);
    }

    function resetIme() {
        els.ime.value = SENTINEL;
        try { els.ime.setSelectionRange(1, 1); } catch (_) { /* not focused */ }
        imePrev = SENTINEL;
    }

    let imePrev = SENTINEL;

    function toggleKeyboard() {
        if (!session || !els) return;
        if (document.activeElement === els.ime) { els.ime.blur(); return; }
        resetIme();
        els.ime.focus({ preventScroll: true });
    }

    function onImeInput() {
        const cur = els.ime.value;
        let p = 0;
        while (p < cur.length && p < imePrev.length && cur[p] === imePrev[p]) p++;
        const removed = imePrev.length - p;
        const added = cur.slice(p).replace(new RegExp(SENTINEL, 'g'), '');
        for (let i = 0; i < removed; i++) sendKeysyms(['Backspace']);
        if (added) {
            added.split('\n').forEach((part, i) => {
                if (i) sendKeysyms(['Enter']);
                if (part) sendText(part);
            });
        }
        imePrev = cur;
        if (!cur.startsWith(SENTINEL) || cur.includes('\n') || cur.length > 400) resetIme();
    }

    function onImeKey(e) {
        const keys = ['Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Delete', 'PageUp', 'PageDown'];
        if (keys.includes(e.key) || (e.key === 'Backspace' && els.ime.value === SENTINEL)) {
            e.preventDefault();
            sendKeysyms([e.key]);
            if (e.key === 'Enter' || e.key === 'Tab') resetIme();
            return;
        }
        // hardware keyboards: Ctrl / Alt shortcuts go to the session
        if ((e.ctrlKey || e.altKey || e.metaKey) && e.key.length === 1) {
            e.preventDefault();
            const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.metaKey && 'Win', e.shiftKey && 'Shift'].filter(Boolean);
            sendKeysyms(mods.concat([keysymOf(e.key.toLowerCase())]));
        } else if (/^F\d{1,2}$/.test(e.key)) {
            e.preventDefault();
            sendKeysyms([e.key]);
        }
    }

    /** A hardware keyboard while the session shows and nothing else has the focus. */
    function onDocKey(e) {
        if (!isCurrent() || view !== 'session' || !session || !session.connected || e.defaultPrevented) return;
        if (e.key === 'Escape' || document.activeElement === els.ime) return;
        const t = e.target;
        if (t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
        if (document.documentElement.hasAttribute('data-wm-dialog') || (ws.isBusy && ws.isBusy())) return;
        const box = document.querySelector('#wmShell .wm-msgbox-layer');
        if (box && !box.hidden) return;
        const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.metaKey && 'Win'].filter(Boolean);
        if (e.key.length === 1) {
            e.preventDefault();
            sendKeysyms(mods.concat([keysymOf(mods.length ? e.key.toLowerCase() : e.key)]));
        } else if (KEYSYM[e.key] && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
            e.preventDefault();
            sendKeysyms(mods.concat([e.key]));
        }
    }

    // ---------------------------------------------------------------- full screen

    function setFull(on) {
        full = !!on && !!session && view === 'session';
        document.documentElement.classList.toggle('wrd-full', full);
        if (els) els.restore.hidden = !full;
        if (ws && isCurrent()) {
            ws.syncHistory(full ? undefined : { noPush: true });
            ws.refreshSoftKeys();
        }
        // the viewport grows or shrinks: the ResizeObserver refits
    }

    // ---------------------------------------------------------------- session menu

    function frameApi() {
        try { return session && session.frame.contentWindow && session.frame.contentWindow.dreamscapeGuac; } catch (_) { return null; }
    }

    function notReady() {
        ws.notify({ title: TITLE, icon: 'warning', text: 'The remote session is not ready.' });
    }

    function sessionMenu() {
        const up = !!(session && session.connected && !session.reconnecting);
        return [
            { label: 'Fit to Screen', check: !!(session && session.fitted), disabled: !up, action: () => fitView(!session.fitted) },
            { label: 'Full Screen', check: full, disabled: !up, action: () => setFull(!full) },
            '-',
            { label: 'Ctrl+Alt+Del', disabled: !up, action: () => { if (!sendKeysyms(['Control', 'Alt', 'Delete'])) notReady(); } },
            { label: 'Keyboard', disabled: !up, action: toggleKeyboard },
            {
                label: 'Special Keys',
                disabled: !up,
                submenu: () => SPECIAL_KEYS.map((k) => (k === '-' ? '-' : { label: k[0], action: () => { if (!sendKeysyms(k[1])) notReady(); } }))
            },
            {
                label: 'Paste',
                disabled: !up,
                action: () => {
                    const api = frameApi();
                    if (!navigator.clipboard || !navigator.clipboard.readText) { ws.notify({ title: TITLE, icon: 'warning', text: 'The clipboard is not available.' }); return; }
                    navigator.clipboard.readText().then((text) => {
                        if (!api || !api.paste(text)) notReady();
                    }).catch(() => ws.notify({ title: TITLE, icon: 'warning', text: 'The clipboard is not available.' }));
                }
            },
            { label: 'Refresh Screen', disabled: !up, action: () => { const api = frameApi(); if (!api || !api.refresh()) notReady(); } },
            '-',
            { label: 'Disconnect', action: disconnect }
        ];
    }

    function formMenu() {
        return [
            { label: 'Options...', disabled: !!session, action: openOptions },
            '-',
            { label: 'About', action: about }
        ];
    }

    function about() {
        ws.messageBox({
            title: TITLE,
            icon: 'info',
            text: 'Remote Desktop Mobile\nMelaton Mobile\n\nConnects to the computers in Remote Desktop Manager and to any computer you type, through the Remote Desktop Gateway.'
        });
    }

    function openOptions() {
        options = readOptions();
        optTab = 'display';
        setView('options');
    }

    function closeOptions() {
        writeJson(OPT_KEY, options);
        setView('form');
        return true;
    }

    // ---------------------------------------------------------------- desktop routes on the phone

    let patched = false;

    function openApp(prefill, autoConnect) {
        if (!ws) return;
        ws.open(APP_ID);
        if (!els || session) return;
        if (prefill) {
            els.computer.value = prefill;
            fillCredentials();
            paintForm();
        }
        if (autoConnect) {
            // a desktop shortcut connects at once, as on the desktop (a typed computer still needs its password)
            const run = () => connect();
            if (findSaved(prefill) || listState.loaded) run();
            else loadList().then(run);
        }
    }

    function quickName(saved) {
        const host = String(saved && saved.host || '');
        const port = Number(saved && saved.port) || 0;
        const hostPart = host.indexOf(':') !== -1 ? `[${host}]` : host;
        const name = port ? `${hostPart}:${port}` : hostPart;
        const proto = saved && saved.protocol;
        // the desktop shortcut's protocol, written as the Computer box takes it (rdp is the default)
        return proto && proto !== 'rdp' ? `${proto}://${name}` : name;
    }

    /** The desktop's Remote Desktop routes open this app on the phone (wrapped once the features load). */
    function patchDesktop() {
        if (typeof window.mirrorDesktopGuacFrame === 'function' && !window.mirrorDesktopGuacFrame.wrdWrapped) {
            const orig = window.mirrorDesktopGuacFrame;
            const wrapped = function (frame, kind, payload) {
                if (session && frame === session.frame) { onMirror(kind, payload || {}); return undefined; }
                return orig.apply(this, arguments);
            };
            wrapped.wrdWrapped = true;
            window.mirrorDesktopGuacFrame = wrapped;
        }
        if (typeof window.openDesktopGuac === 'function' && !window.openDesktopGuac.wrdWrapped) {
            const f = function () { openApp(); };
            f.wrdWrapped = true;
            window.openDesktopGuac = f;
        }
        if (typeof window.openDesktopGuacHome === 'function' && !window.openDesktopGuacHome.wrdWrapped) {
            const f = function () { openApp(); };
            f.wrdWrapped = true;
            window.openDesktopGuacHome = f;
        }
        if (typeof window.openDesktopGuacSession === 'function' && !window.openDesktopGuacSession.wrdWrapped) {
            const f = function (conn) {
                const name = String((conn && (conn.name || conn.id)) || '');
                const known = conn && conn.id && conns.find((c) => c.id === String(conn.id));
                if (conn && conn.id && !known) conns.push({ id: String(conn.id), name: name || String(conn.id), protocol: String(conn.protocol || ''), groupName: '' });
                openApp(known ? known.name : name, true);
            };
            f.wrdWrapped = true;
            window.openDesktopGuacSession = f;
        }
        if (typeof window.openDesktopGuacFrame === 'function' && !window.openDesktopGuacFrame.wrdWrapped) {
            // any other caller of the manager's session window: this app instead
            const f = function () { openApp(); };
            f.wrdWrapped = true;
            window.openDesktopGuacFrame = f;
        }
        const rdc = window.remoteDesktopConnection;
        if (rdc && !rdc.wrdWrapped) {
            rdc.wrdWrapped = true;
            rdc.open = function () { openApp(); };
            rdc.connectTo = function (saved) { openApp(quickName(saved), false); return Promise.resolve(false); };
            rdc.isOpen = () => false;
        }
        patched = !!(window.openDesktopGuac && window.openDesktopGuac.wrdWrapped);
    }

    function hookFeatureLoader() {
        const fl = window.featureLoader;
        if (!fl || typeof fl.loadFeature !== 'function' || fl.loadFeature.wrdWrapped) return;
        const orig = fl.loadFeature;
        const wrapped = function (name) {
            const r = orig.apply(this, arguments);
            if (name === 'remote_desktop' || name === 'remote_desktop_connection') {
                return Promise.resolve(r).then((v) => { patchDesktop(); return v; });
            }
            return r;
        };
        wrapped.wrdWrapped = true;
        fl.loadFeature = wrapped;
    }

    // ---------------------------------------------------------------- app

    function paintSession() {
        if (!els) return;
        els.restore.hidden = !full;
        if (session) els.sess.classList.toggle('is-passthrough', !!session.passthrough);
    }

    function softKeys() {
        if (view === 'options') return { left: null, right: null };
        if (view === 'session') {
            if (session && session.reconnecting) return { left: { label: 'Cancel', action: disconnect }, right: null };
            if (session && !session.connected) return { left: { label: 'Cancel', action: disconnect }, right: { label: 'Menu', menu: sessionMenu } };
            return {
                left: { label: 'Full Screen', disabled: !session, action: () => setFull(true) },
                right: { label: 'Menu', menu: sessionMenu }
            };
        }
        if (session) return { left: { label: 'Cancel', action: disconnect }, right: { label: 'Menu', menu: formMenu } };
        return {
            left: { label: 'Connect', action: () => connect() },
            right: { label: 'Menu', menu: formMenu }
        };
    }

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
        hookFeatureLoader();
        patchDesktop();
        document.addEventListener('keydown', onDocKey);
        // the SIP button: the phone keyboard into the session, or the focused field on the connect screen
        document.addEventListener('click', (e) => {
            if (!isCurrent() || !e.target.closest || !e.target.closest('#wmShell .wm-sip')) return;
            e.stopImmediatePropagation();
            if (view === 'session' && session && session.connected) { toggleKeyboard(); return; }
            if (view !== 'form' || !els) return;
            const active = document.activeElement;
            if (active && active.closest && active.closest('.wrd-connect') && active.matches('input.wm-edit')) { active.blur(); return; }
            const first = [els.computer, els.user, els.pass, els.domain].find((i) => !i.disabled && !i.value) || els.computer;
            if (!first.disabled) first.focus();
        }, true);
        addEventListener('pagehide', () => { if (session) endSession(null); });
        ws.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: 'app-remote-desktop-mobile',
            inStart: 'programs',
            sip: true,
            mount(p) {
                page = p;
                p.classList.add('wm-rdm');
                build();
            },
            show() {
                shown = true;
                paint();
                if (!listState.loaded && !listState.loading) {
                    // the manager's list fills the Computer combo (the WM wait cursor while it loads)
                    ws.busy(() => Promise.all([loadList(), loadRdc().catch(() => null)]).then(() => { if (els && !session && !readComputer()) fillLast(); paintForm(); }), { paint: true, timeout: 15000 });
                }
            },
            hide() {
                shown = false;
                setFull(false);
                if (gesture) clearHold();
                gesture = null;
                pointers.clear();
                try { if (els && document.activeElement === els.ime) els.ime.blur(); } catch (_) { /* fine */ }
            },
            softKeys,
            // WM: X on the connect screen and the session (Smart Minimize: the session keeps running),
            // ok on Options
            titleKind: () => (view === 'options' ? 'ok' : 'close'),
            // X with a session up asks (Minimize keeps it connected); Close disconnects
            closeQuestion: () => (session && session.connected ? `Disconnect from ${session.name}?` : null),
            onTitleClose() { if (session) disconnect(); },
            onTitleOk: () => (view === 'options' ? closeOptions() : false),
            historyDepth: () => (view === 'options' ? 1 : view === 'session' ? 1 + (full ? 1 : 0) : 0),
            onBack() {
                if (view === 'options') return closeOptions();
                if (view === 'session') {
                    if (full) { setFull(false); return true; }
                    // the back key on the session asks before the connection goes
                    askDisconnect();
                    return true;
                }
                return false;
            }
        });
    }

    // tests: a session view on any same-origin page (a stub Guacamole), and the internals
    window.wmRemoteDesktop = {
        get state() { return { view, status, full, session: session ? { name: session.name, connected: session.connected, state: session.state, fw: session.fw, fh: session.fh, scale: session.scale, tx: session.tx, ty: session.ty, fitted: session.fitted, attempts: session.attempts } : null, conns: conns.length, listError: listState.error, patched }; },
        _test: { openSession, onMirror: (k, p) => onMirror(k, p), endSession, layer }
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
