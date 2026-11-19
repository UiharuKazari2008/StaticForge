/**
 * VZAccess Manager 7.6 (Yozora #947): Verizon Wireless' connection manager of the 4G LTE launch (7.6.3.1, the
 * UML290 / USB551L era, Smith Micro's QuickLink Mobile), for a Melaton desktop on Verizon mobile broadband (a
 * phone's DeX / Continuity desktop). Laid out after the AnandTech captures of 7.6 on Windows 7 and the 7.x User
 * Guide (~/.cache/vzam-ref): the Verizon Wireless logo, the Networks / Statistics / TXT Messaging / Wi-Fi
 * Locations tabs, and the status area (Coverage Indicator, Connection Status with its timer, the device's mode,
 * model and number, Start VPN and Connect / Disconnect WWAN).
 *
 * The modem is the phone's:
 *   WWAN state    AndroidDeviceStatus.cellular ('androiddevicestatus' pushes: carrier, data class, bars, roaming,
 *                 data on / active / moving, number), read once when the window opens, then pushed
 *   Connect       mobile data on / off: the network provider's mobileData(on), else AndroidDevice.setRadio('data')
 *   Statistics    the network provider's stats('rmnet0'): the cellular link's byte counters and addresses
 *   Wi-Fi rows    the network provider's state and its last scan (networks(), onScan); a row opens Melaton's
 *                 Connect to a network
 *   Start VPN     the Nightshade Network (melatonControlPanel.connectionFacts / toggleConnection)
 *   TXT Messaging the Text Messaging accounts (textMessaging.js): its conversations, newest first
 *
 * Power (phone-power-client): nothing runs while the window is closed; while it is open and seen, one tick a
 * second draws the timer and, on Statistics, reads the counters for the graph. Seen again, it draws at once.
 *
 *   melatonApps.define('vzaccess', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const VERSION = '7.6.3.1 (2642d)';
    const A = '/melaton-apps/vzaccess/assets';
    const PREFS_KEY = 'vzaccess.prefs';
    const SESSION_KEY = 'vzaccess.session';
    const LOG_KEY = 'vzaccess.sessionLog';
    const GRAPH_POINTS = 120;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const parse = (v) => { if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };
    const pad = (n) => String(n).padStart(2, '0');
    const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
    const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } };
    const writeJson = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } };
    const num = (n, d = 2) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

    /** "415-693-8432", as 7.6 writes My #. */
    function phoneText(raw) {
        let d = String(raw || '').replace(/\D/g, '');
        if (d.length === 11 && d[0] === '1') d = d.slice(1);
        return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(raw || '');
    }

    function bytesText(n) {
        const b = Number(n) || 0;
        if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
        if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
        if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
        return `${b} B`;
    }

    /**
     * The Coverage Indicator for the phone's data class (VZAM's own wording: "Mobile Broadband (4G LTE)",
     * "Mobile Broadband (EV-RevA)", "NationalAccess (1xRTT)"); 5G, which 7.6 never knew, in the same form.
     */
    function coverageOf(type) {
        const t = String(type || '').toUpperCase();
        if (/5G\s*-?\s*(UW|A)|UWB/.test(t)) return { html: '<b>Mobile Broadband</b> (5G Ultra Wideband)', tech: '5G UW' };
        if (/5G|NR/.test(t)) return { html: '<b>Mobile Broadband</b> (5G)', tech: '5G' };
        if (/LTE/.test(t)) return { html: '<b>Mobile Broadband</b> (4G LTE)', tech: '4G' };
        if (/HSPA|3G|UMTS|EVDO|EHRPD/.test(t)) return { html: '<b>Mobile Broadband</b> (EV-RevA)', tech: '3G' };
        if (/EDGE|GPRS|1X|CDMA/.test(t)) return { html: '<span class="vz-national">National</span><b>Access</b> (1xRTT)', tech: '2G' };
        return { html: '<b>Mobile Broadband</b>', tech: '' };
    }

    /** VZAM's signal meter (its bracket and four bars, from the 7.6 capture): 0-4 bars lit. */
    function meterHtml(bars) {
        const n = Math.max(0, Math.min(4, Math.round(Number(bars) || 0)));
        return `<img class="vz-meter" src="${A}/meter-${n}.png" alt="" draggable="false">`;
    }

    const barsOfPercent = (p) => { const v = Number(p); return !Number.isFinite(v) || v <= 0 ? 0 : v >= 80 ? 4 : v >= 60 ? 3 : v >= 35 ? 2 : 1; };

    class Manager {
        constructor(app) {
            this.app = app;
            this.tab = 'networks';
            this.cell = null;
            this.pending = null; // 'connecting' | 'disconnecting', until the phone's state says it happened
            this.pendingTimer = 0;
            this.idleSince = 0; // no data moving since (Connected - Dormant)
            this.scan = [];
            this.known = [];
            this.chats = [];
            this.txtSel = '';
            this.netSel = 'wwan';
            this.stats = { last: null, rx: [], tx: [], maxRx: 0, maxTx: 0, base: null, rxRate: 0, txRate: 0 };
            this.offs = [];
            this.readCellular();
            this.build();
            this.subscribe();
            this.paint();
            void this.refreshLists();
        }

        // ---------------------------------------------------------------- the modem (the phone)

        provider() { return (root.melatonTray && root.melatonTray.provider('network')) || null; }

        readCellular() {
            const b = root.AndroidDeviceStatus;
            if (!b || typeof b.getState !== 'function') { this.cell = null; return; }
            try { const s = parse(b.getState()); this.cell = s && s.cellular ? s.cellular : null; } catch (_) { this.cell = null; }
        }

        /** The modem's state, as VZAM words it. */
        wwan() {
            const c = this.cell;
            const p = this.provider();
            const m = p && typeof p.get === 'function' ? ((p.get() || {}).mobile || null) : null;
            if (!c || c.present === false || c.simState === 'absent') return { present: false, connected: false, state: 'Device not detected' };
            const connected = !!(c.dataEnabled !== false && c.dataActive) || !!(m && m.connected);
            const name = typeof root.melatonCarrierName === 'function' ? root.melatonCarrierName(c.operator || 'Verizon') : (c.operator || 'Verizon Wireless');
            // the meter's four bars: Android's 0-4 level, else its five-step one scaled
            const level = Number.isFinite(Number(c.level)) ? Number(c.level) : Number(c.level5) * 4 / 5;
            const searching = !!c.searching || (!c.operator && !connected);
            let state = connected ? 'Connected' : 'Not Connected';
            if (this.pending === 'connecting' && !connected) state = 'Connecting';
            if (this.pending === 'disconnecting' && connected) state = 'Disconnecting';
            if (connected && !this.pending && !c.dataMoving && this.idleSince && Date.now() - this.idleSince > 20000) state = 'Connected - Dormant';
            return {
                present: true,
                connected,
                on: c.dataEnabled !== false && !c.airplane && c.radioOn !== false,
                airplane: !!c.airplane,
                state,
                carrier: name,
                type: c.dataType || '',
                bars: Number.isFinite(level) ? Math.max(0, Math.min(4, Math.round(level))) : 0,
                roaming: !!c.roaming,
                moving: !!c.dataMoving,
                searching,
                number: c.phoneNumber || '',
                sim: c.simState || ''
            };
        }

        hardware() {
            const id = root.melatonDeviceIdentity;
            try { return (id && typeof id.hardware === 'function' ? id.hardware() : null) || null; } catch (_) { return null; }
        }

        model() {
            const hw = this.hardware();
            const d = hw && hw.device;
            return (d && (d.model || d.marketName)) || '';
        }

        setData(on) {
            const p = this.provider();
            if (p && typeof p.mobileData === 'function') return Promise.resolve(p.mobileData(!!on)).catch(() => null);
            const d = root.AndroidDevice;
            if (d && typeof d.setRadio === 'function') { try { d.setRadio('data', !!on); } catch (_) { /* old app */ } }
            return Promise.resolve(null);
        }

        // ---------------------------------------------------------------- the session (Connection Timer, Statistics)

        session() { return readJson(SESSION_KEY, null); }

        /** The connection began or ended (as the phone reports it): the timer and the Session Log follow. */
        noteConnection(w) {
            const s = this.session();
            if (w.connected && !s) writeJson(SESSION_KEY, { start: Date.now() });
            if (!w.connected && s) {
                const log = readJson(LOG_KEY, []);
                const st = this.stats;
                log.unshift({ start: s.start, end: Date.now(), rx: st.base ? st.sessionRx || 0 : 0, tx: st.base ? st.sessionTx || 0 : 0, type: w.type || '' });
                writeJson(LOG_KEY, log.slice(0, 50));
                writeJson(SESSION_KEY, null);
            }
        }

        // ---------------------------------------------------------------- the window

        build() {
            const w = root.desktopAppCreateWindow({
                id: 'vzAccessManagerModal',
                identifier: 'vzAccessManager',
                title: 'VZAccess Manager',
                icon16: `${A}/vzaccess-16.png`,
                taskbarIcon: `${A}/vzaccess-32.png`,
                className: 'vz-window',
                fixed: true,
                minimize: true
            });
            const m = w.modal;
            // a custom program (ui-standard section 6): the frame is Melaton's, the client its own
            m.dataset.windowKind = 'custom';
            this.modal = m;
            w.content.classList.add('vz-client');
            w.content.innerHTML = `
                <div class="vz-root">
                    <div class="naxt-menubar" role="menubar" data-win32-menus>
                        <button type="button" class="naxt-menu-title" role="menuitem" data-vz-menu="file"><u>F</u>ile</button><button type="button" class="naxt-menu-title" role="menuitem" data-vz-menu="view"><u>V</u>iew</button><button type="button" class="naxt-menu-title" role="menuitem" data-vz-menu="tools"><u>T</u>ools</button><button type="button" class="naxt-menu-title" role="menuitem" data-vz-menu="options"><u>O</u>ptions</button><button type="button" class="naxt-menu-title" role="menuitem" data-vz-menu="help"><u>H</u>elp</button>
                    </div>
                    <img class="vz-logo" src="${A}/vzw-logo.png" alt="Verizon Wireless" draggable="false">
                    <menu role="tablist">
                        <button type="button" role="tab" data-tab="networks" aria-selected="true"><img src="${A}/tab-networks.png" alt="" draggable="false">Networks</button>
                        <button type="button" role="tab" data-tab="statistics" aria-selected="false"><img src="${A}/tab-statistics.png" alt="" draggable="false">Statistics</button>
                        <button type="button" role="tab" data-tab="txt" aria-selected="false"><img src="${A}/tab-txt.png" alt="" draggable="false">TXT Messaging</button>
                        <button type="button" role="tab" data-tab="wloc" aria-selected="false"><img src="${A}/tab-wifiloc.png" alt="" draggable="false">Wi-Fi Locations</button>
                    </menu>
                    <article role="tabpanel" class="vz-panel">
                        <div class="vz-page is-shown" data-page="networks">
                            <div class="vz-bar">
                                <button type="button" data-vz="usage"><u>U</u>sage</button>
                                <button type="button" data-vz="myverizon"><u>M</u>y Verizon</button>
                                <span class="vz-fill"></span>
                                <button type="button" data-vz="detect">De<u>t</u>ect Device</button>
                            </div>
                            <div class="vz-list vz-net" tabindex="0" role="listbox" aria-label="Available networks">
                                <div class="vz-head"><span>Available Network</span><span>Status</span><span>Signal</span><span></span></div>
                                <div class="vz-rows" data-f="netrows"></div>
                            </div>
                        </div>
                        <div class="vz-page" data-page="statistics">
                            <div class="vz-legend"><i></i><span>Transmit / Receive</span><i class="rx"></i></div>
                            <div class="vz-graph">
                                <div class="vz-axis"><span class="max" data-f="gmax">0</span><span class="unit" data-f="gunit">Kb</span><span class="zero">0</span></div>
                                <canvas data-f="graph" width="560" height="196"></canvas>
                            </div>
                            <div class="vz-fields">
                                <label>TX Rate (kbps):</label><output data-f="txr"></output>
                                <label>RX Rate (kbps):</label><output class="rx" data-f="rxr"></output>
                                <label>IPv4 Address:</label><output class="wide" data-f="ip4"></output>
                                <label>Max TX Rate (kbps):</label><output data-f="txm"></output>
                                <label>Max RX Rate (kbps):</label><output class="rx" data-f="rxm"></output>
                                <label>IPv6 Address:</label><output class="wide" data-f="ip6"></output>
                                <label>Total TX:</label><output data-f="txt"></output>
                                <label>Total RX:</label><output class="rx" data-f="rxt"></output>
                                <label>Duration:</label><span class="vz-durrow"><output class="wide" data-f="dur"></output><button type="button" class="vz-reset" data-vz="reset"><u>R</u>eset</button></span>
                            </div>
                            <a class="vz-notice" tabindex="0" data-vz="notice">* View Important Notice</a>
                        </div>
                        <div class="vz-page" data-page="txt">
                            <div class="vz-bar">
                                <button type="button" data-vz="compose">Compose</button>
                                <button type="button" data-vz="getnew">Get New</button>
                                <button type="button" data-vz="reply" disabled>Reply</button>
                                <button type="button" data-vz="forward" disabled>Forward</button>
                                <span class="vz-fill"></span>
                            </div>
                            <div class="vz-list vz-txt" tabindex="0" role="listbox" aria-label="Text messages">
                                <div class="vz-head"><span>To/From</span><span>Date &amp; Time</span><span>Message</span><span>Callback</span></div>
                                <div class="vz-rows" data-f="txtrows"></div>
                            </div>
                            <div class="vz-preview" data-f="txtpreview"></div>
                        </div>
                        <div class="vz-page" data-page="wloc">
                            <div class="vz-bar">
                                <button type="button" data-vz="wconnect">Connect to a network...</button>
                                <span class="vz-fill"></span>
                                <button type="button" data-vz="wrefresh">Refresh</button>
                            </div>
                            <div class="vz-list vz-wloc" tabindex="0" role="listbox" aria-label="Saved Wi-Fi locations">
                                <div class="vz-head"><span>Wi-Fi Location</span><span>Security</span><span>Connect</span></div>
                                <div class="vz-rows" data-f="wlocrows"></div>
                            </div>
                        </div>
                    </article>
                    <div class="vz-status">
                        <div class="vz-box vz-cover" data-f="cover"></div>
                        <div class="vz-box vz-device">
                            <img src="${A}/envelope.png" alt="" draggable="false" data-f="envelope"><span class="mode"><b>LAN</b><span data-f="model"></span></span>
                            <img src="${A}/phone.png" alt="" draggable="false"><span class="num" data-f="number">My #:</span>
                        </div>
                        <button type="button" class="vz-vpn" data-vz="vpn"></button>
                        <div class="vz-box vz-conn"><span data-f="state"></span><span class="vz-fill"></span><span data-f="timer">00:00:00</span><img data-f="arrows" src="${A}/arrows-off.png" alt="" draggable="false"></div>
                        <button type="button" class="vz-cmd" data-vz="wwan"></button>
                    </div>
                </div>`;
            const q = (s) => m.querySelector(s);
            this.f = (k) => m.querySelector(`[data-f="${k}"]`);
            const sig = { signal: this.app.signal };
            m.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-vz]');
                if (b && !b.disabled) { void this.command(b.dataset.vz); return; }
                const t = ev.target.closest('button[role="tab"]');
                if (t) { this.showTab(t.dataset.tab); return; }
                const row = ev.target.closest('.vz-row[data-key]');
                if (row) this.select(row);
            }, sig);
            m.addEventListener('dblclick', (ev) => {
                const row = ev.target.closest('.vz-row[data-key]');
                if (!row) return;
                if (row.dataset.key === 'wwan') void this.command('wwan');
                else if (row.dataset.key.startsWith('wifi:') || row.dataset.key.startsWith('known:')) void this.command('wconnect');
                else if (row.dataset.key.startsWith('txt:')) void this.command('open-txt');
            }, sig);
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && ev.target.closest('.vz-notice')) { ev.preventDefault(); void this.command('notice'); }
                if (ev.key === 'F1') { ev.preventDefault(); void this.command('help'); }
            }, sig);
            m.querySelectorAll('.naxt-menu-title').forEach((t) => {
                if (!root.contextMenu || typeof root.contextMenu.attachClickMenuToElement !== 'function') return;
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.command(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.vzMenu); } }]
                });
            });
            w.close.addEventListener('click', () => this.app.exit(), sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') this.app.exit();
            }, sig);
            this.q = q;
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
                root.programFaults.registerProgram(m.id, { name: 'VZAccess Manager', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'vzaccess' }) });
            }
            // the notification area: VZAM's antenna, red while connected (the User Guide's tray menu)
            this.trayIcon = this.app.tray({
                title: 'VZAccess Manager',
                icon: `${A}/tab-networks-off.png`,
                onClick: () => { call('bringModalToFront', m); },
                menu: {
                    sections: [{ type: 'list', initfn: (s) => {
                        s.items = [
                            { text: 'Show Application', action: 'show', default: true },
                            { separator: true },
                            { text: 'Networks', action: 'tab:networks' },
                            { text: 'Statistics', action: 'tab:statistics' },
                            { text: 'TXT Messaging', action: 'tab:txt' },
                            { separator: true },
                            { text: 'Preferences...', action: 'prefs' },
                            { text: 'About VZAccess Manager', action: 'about' },
                            { separator: true },
                            { text: 'Exit', action: 'exit' }
                        ];
                    } }],
                    onAction: (a) => {
                        if (a === 'show') { call('bringModalToFront', m); return; }
                        if (a.startsWith('tab:')) { call('bringModalToFront', m); this.showTab(a.slice(4)); return; }
                        void this.command(a);
                    }
                }
            });
        }

        destroy() {
            this.offs.forEach((off) => { try { off(); } catch (_) { /* gone */ } });
            this.offs = [];
            clearTimeout(this.pendingTimer);
            const m = this.modal;
            try { call('closeModal', m); } catch (_) { /* gone */ }
            setTimeout(() => m.remove(), 400);
        }

        // ---------------------------------------------------------------- pushes and the tick (only while open)

        subscribe() {
            const sig = { signal: this.app.signal };
            // the phone's state: carrier, data class, bars, data on / active / moving
            root.addEventListener('androiddevicestatus', (ev) => {
                const d = ev && parse(ev.detail);
                if (!d || !d.cellular) return;
                const was = this.cell;
                this.cell = d.cellular;
                if (!d.cellular.dataMoving && (!was || was.dataMoving || !this.idleSince)) this.idleSince = Date.now();
                if (d.cellular.dataMoving) this.idleSince = 0;
                this.paintSoon();
            }, sig);
            if (root.melatonTray && typeof root.melatonTray.onChange === 'function') {
                const off = root.melatonTray.onChange('network', () => this.paintSoon());
                if (typeof off === 'function') this.offs.push(off);
            }
            const p = this.provider();
            if (p && typeof p.onScan === 'function') {
                const off = p.onScan((r) => { this.scan = r && Array.isArray(r.networks) ? r.networks : []; this.paintSoon(); });
                if (typeof off === 'function') this.offs.push(off);
            }
            const tm = root.textMessaging;
            if (tm && typeof tm.on === 'function') {
                const fn = () => { if (this.tab === 'txt') void this.loadTexts(); };
                tm.on('message', fn);
                this.offs.push(() => { try { tm.off('message', fn); } catch (_) { /* gone */ } });
            }
            // one tick a second while the window is seen (the timer; on Statistics the counters too)
            let tick = null;
            const seen = () => !doc.hidden && doc.documentElement.dataset.screenOff === undefined && !this.app.signal.aborted && !this.modal.classList.contains('minimised');
            const sync = () => {
                if (seen() && !tick) {
                    this.tick();
                    tick = setInterval(() => {
                        if (doc.hidden || doc.documentElement.dataset.screenOff !== undefined || !seen()) { sync(); return; }
                        this.tick();
                    }, 1000);
                } else if (!seen() && tick) {
                    clearInterval(tick);
                    tick = null;
                }
            };
            sync();
            doc.addEventListener('visibilitychange', sync, sig);
            root.addEventListener('melatonscreen', sync, sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => { if (e && e.detail && e.detail.id === this.modal.id) setTimeout(sync, 0); }, sig);
            this.app.signal.addEventListener('abort', () => { clearInterval(tick); tick = null; });
        }

        paintSoon() {
            if (this.paintQueued) return;
            this.paintQueued = true;
            requestAnimationFrame(() => { this.paintQueued = false; if (!this.app.signal.aborted) this.paint(); });
        }

        tick() {
            const s = this.session();
            this.setText(this.f('timer'), s ? hms(Date.now() - s.start) : '00:00:00');
            if (this.tab === 'statistics') void this.sample();
            const w = this.wwan();
            // Connected - Dormant comes 20 s after the data stops moving
            if (w.connected && !w.moving && this.idleSince && Date.now() - this.idleSince > 20000) this.setText(this.f('state'), w.state);
        }

        setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
        setHtml(el, h) { if (el && el.dataset.html !== h) { el.dataset.html = h; el.innerHTML = h; } }

        // ---------------------------------------------------------------- painting

        paint() {
            const w = this.wwan();
            this.noteConnection(w);
            if (this.pending === 'connecting' && w.connected) this.endPending();
            if (this.pending === 'disconnecting' && !w.connected) this.endPending();
            // Coverage Indicator: the network, its technology label, roaming, the bars
            const cov = coverageOf(w.type);
            const tip = `Signal: ${w.bars || 0} of 4 bars`;
            this.setHtml(this.f('cover'), !w.present
                ? '<span>Device not detected</span>'
                : w.searching ? '<span>Searching for network...</span>'
                    : `<span>${cov.html}</span><span class="vz-fill"></span>${w.roaming ? '<span class="vz-roam" title="Extended Network"></span>' : ''}${cov.tech ? `<span class="vz-tech">${esc(cov.tech)}</span>` : ''}<span title="${esc(tip)}">${meterHtml(w.bars)}</span>`);
            // Connection Status, the timer, the data arrows
            this.setText(this.f('state'), w.state);
            const arrows = `${A}/${w.connected && w.moving ? 'arrows' : 'arrows-off'}.png`;
            if (this.f('arrows').getAttribute('src') !== arrows) this.f('arrows').setAttribute('src', arrows);
            // the device: mode, model, number
            this.setText(this.f('model'), w.present ? this.model() : '');
            this.setText(this.f('number'), `My #: ${w.present ? phoneText(w.number) : ''}`);
            // Start VPN and the command button
            const vpn = this.vpn();
            const vb = this.q('[data-vz="vpn"]');
            this.setHtml(vb, vpn && vpn.connected ? 'S<u>t</u>op VPN' : '<u>S</u>tart VPN');
            vb.disabled = !vpn || !w.connected;
            const cb = this.q('[data-vz="wwan"]');
            const disconnect = w.connected || this.pending === 'connecting';
            this.setHtml(cb, disconnect ? '<u>D</u>isconnect WWAN' : '<u>C</u>onnect WWAN');
            cb.classList.toggle('vz-red', disconnect);
            cb.disabled = !w.present || w.airplane || !!this.pending;
            // the tray: red antenna while connected
            if (this.trayIcon) {
                const img = this.trayIcon.querySelector('img');
                const src = `${A}/${w.connected ? 'tab-networks' : 'tab-networks-off'}.png`;
                if (img && img.getAttribute('src') !== src) img.setAttribute('src', src);
                this.trayIcon.title = w.present ? `VZAccess Manager\n${w.carrier} - VZAccess: ${w.state}` : 'VZAccess Manager\nDevice not detected';
            }
            this.paintNetworks(w);
        }

        endPending() {
            this.pending = null;
            clearTimeout(this.pendingTimer);
        }

        vpn() {
            const cp = root.melatonControlPanel;
            try { return cp && typeof cp.connectionFacts === 'function' ? cp.connectionFacts() : null; } catch (_) { return null; }
        }

        paintNetworks(w) {
            const p = this.provider();
            const st = p && typeof p.get === 'function' ? (p.get() || {}) : {};
            const wifi = st.wifi || {};
            const current = wifi.state === 'connected' && wifi.network ? wifi.network : null;
            const rows = [];
            if (w.present) {
                rows.push({
                    key: 'wwan',
                    icon: w.connected ? 'antenna' : 'antenna-off',
                    name: `${w.carrier} - VZAccess`,
                    status: w.state === 'Connected - Dormant' ? 'Connected' : w.state,
                    bars: w.bars,
                    on: w.connected
                });
            }
            const seen = new Set();
            const wifiRow = (n, connected) => {
                const name = String(n.name || n.ssid || '');
                if (!name || seen.has(name)) return;
                seen.add(name);
                rows.push({ key: `wifi:${name}`, icon: 'wifi', name, status: connected ? 'Connected' : '', bars: barsOfPercent(n.signalPercent), on: connected, secure: n.secured || n.security });
            };
            if (current) wifiRow(current, true);
            (this.scan || []).forEach((n) => wifiRow(n, false));
            const html = rows.length
                ? rows.map((r) => `<div class="vz-row${r.on ? ' is-on' : ''}${this.netSel === r.key ? ' is-selected' : ''}" role="option" data-key="${esc(r.key)}" title="${r.secure ? 'Secured network' : ''}">
                        <span><img src="${A}/${r.icon}.png" alt="" draggable="false"><span class="vz-name">${esc(r.name)}</span></span>
                        <span>${esc(r.status)}</span>
                        <span>${meterHtml(r.bars)}</span><span></span>
                    </div>`).join('')
                : '<div class="vz-empty">Device not detected</div>';
            this.setHtml(this.f('netrows'), html);
        }

        select(row) {
            const key = row.dataset.key;
            if (key.startsWith('txt:')) {
                this.txtSel = key;
                row.parentNode.querySelectorAll('.is-selected').forEach((r) => r.classList.remove('is-selected'));
                row.classList.add('is-selected');
                row.classList.remove('is-unread');
                const c = this.chats.find((x) => `txt:${x.accountId}|${x.guid}` === key);
                this.setText(this.f('txtpreview'), c ? (c.lastText || '') : '');
                this.q('[data-vz="reply"]').disabled = !c;
                this.q('[data-vz="forward"]').disabled = !c;
                return;
            }
            if (key.startsWith('known:')) {
                row.parentNode.querySelectorAll('.is-selected').forEach((r) => r.classList.remove('is-selected'));
                row.classList.add('is-selected');
                return;
            }
            this.netSel = key;
            this.paintNetworks(this.wwan());
        }

        showTab(tab) {
            this.tab = tab;
            this.modal.querySelectorAll('button[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
            this.modal.querySelectorAll('.vz-page').forEach((p) => p.classList.toggle('is-shown', p.dataset.page === tab));
            if (tab === 'statistics') { void this.sample(); this.drawGraph(); }
            if (tab === 'txt') void this.loadTexts();
            if (tab === 'wloc') void this.loadKnown();
        }

        async refreshLists() {
            const p = this.provider();
            if (p && typeof p.networks === 'function') {
                try { const r = await p.networks(); this.scan = r && Array.isArray(r.networks) ? r.networks : []; } catch (_) { this.scan = []; }
            }
            this.paintSoon();
        }

        // ---------------------------------------------------------------- Statistics

        async sample() {
            const p = this.provider();
            if (!p || typeof p.stats !== 'function') { this.paintStats(null); return; }
            let x = null;
            try { x = await p.stats('rmnet0'); } catch (_) { x = null; }
            // an older app answers with the Wi-Fi's figures: not the modem's
            if (!x || x.error || (x.kind && x.kind !== 'mobile')) { this.paintStats(null); return; }
            const st = this.stats;
            const now = Date.now();
            const rx = Number(x.rxBytes) || 0;
            const tx = Number(x.txBytes) || 0;
            // the counters run from the phone's start: this session's totals are what came since it began (or Reset)
            if (!st.base || rx < st.base.rx || tx < st.base.tx) st.base = { rx, tx };
            // two reads close together (a tab switch and the tick): too short an interval for a rate
            if (st.last && now - st.last.at < 500) return;
            if (st.last && now > st.last.at) {
                const dt = (now - st.last.at) / 1000;
                st.rxRate = Math.max(0, (rx - st.last.rx) * 8 / 1000 / dt);
                st.txRate = Math.max(0, (tx - st.last.tx) * 8 / 1000 / dt);
                st.maxRx = Math.max(st.maxRx, st.rxRate);
                st.maxTx = Math.max(st.maxTx, st.txRate);
                st.rx.push(st.rxRate);
                st.tx.push(st.txRate);
                if (st.rx.length > GRAPH_POINTS) { st.rx.shift(); st.tx.shift(); }
            }
            st.last = { at: now, rx, tx };
            st.sessionRx = rx - st.base.rx;
            st.sessionTx = tx - st.base.tx;
            this.paintStats(x);
        }

        paintStats(x) {
            const st = this.stats;
            const set = (k, v) => this.setText(this.f(k), v);
            set('txr', num(st.txRate));
            set('rxr', num(st.rxRate));
            set('txm', num(st.maxTx));
            set('rxm', num(st.maxRx));
            set('txt', bytesText(st.sessionTx || 0));
            set('rxt', bytesText(st.sessionRx || 0));
            const ip4 = x && Array.isArray(x.ip) && x.ip[0] ? String(x.ip[0]).split('/')[0] : '';
            const ip6 = x && Array.isArray(x.ip6) ? (x.ip6.map((v) => String(v).split('/')[0]).find((v) => !/^fe80:/i.test(v)) || '') : '';
            set('ip4', ip4);
            set('ip6', ip6);
            const s = this.session();
            set('dur', s ? hms(Date.now() - s.start) : '00:00:00');
            this.drawGraph();
        }

        drawGraph() {
            const cv = this.f('graph');
            if (!cv || this.tab !== 'statistics') return;
            const ctx = cv.getContext('2d');
            const cs = getComputedStyle(this.modal);
            const tok = (n) => cs.getPropertyValue(n).trim();
            const w = cv.width;
            const h = cv.height;
            ctx.clearRect(0, 0, w, h);
            const st = this.stats;
            const peak = Math.max(1, ...st.rx, ...st.tx);
            // the axis: Kb up to 1,000 kbps, then Mb
            const mb = peak >= 1000;
            this.setText(this.f('gunit'), mb ? 'Mb' : 'Kb');
            this.setText(this.f('gmax'), mb ? (peak / 1000).toFixed(1) : peak.toFixed(1));
            const line = (arr, colour) => {
                if (arr.length < 2) return;
                ctx.strokeStyle = colour;
                ctx.lineWidth = 1;
                ctx.beginPath();
                arr.forEach((v, i) => {
                    const px = w - (arr.length - 1 - i) * (w / (GRAPH_POINTS - 1));
                    const py = h - 2 - (v / peak) * (h - 6);
                    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                });
                ctx.stroke();
            };
            line(st.tx, tok('--vz-graph-tx'));
            line(st.rx, tok('--vz-graph-rx'));
        }

        // ---------------------------------------------------------------- TXT Messaging, Wi-Fi Locations

        async loadTexts() {
            const tm = root.textMessaging;
            const rows = this.f('txtrows');
            if (!tm || typeof tm.accounts !== 'function' || typeof tm.chats !== 'function') {
                this.setHtml(rows, '<div class="vz-empty">TXT Messaging is not available.</div>');
                return;
            }
            let list = [];
            try {
                const a = await tm.accounts();
                // TXT messages are the phone number's: its SMS / RCS account, else every Text Messaging account
                const all = ((a && a.accounts) || []).filter((x) => x && x.enabled !== false);
                const sms = all.filter((x) => x.kind === 'rcs');
                for (const acc of (sms.length ? sms : all).slice(0, 4)) {
                    const r = await tm.chats(acc.id, { folder: 'inbox', limit: 25 });
                    ((r && r.chats) || []).forEach((c) => {
                        const last = c.last || {};
                        const at = typeof last.date === 'number' ? last.date : Date.parse(last.date || '') || 0;
                        list.push({ accountId: acc.id, guid: c.guid, title: c.title || c.identifier || c.guid, at, lastText: last.text || (Array.isArray(last.attachments) && last.attachments.length ? '(Attachment)' : ''), unread: !!(c.unread || c.unreadCount), callback: c.isGroup ? '' : (c.identifier || '') });
                    });
                }
            } catch (_) { list = []; }
            list.sort((x, y) => y.at - x.at);
            this.chats = list.slice(0, 60);
            const fmt = (t) => (t ? new Date(t).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
            this.setHtml(rows, this.chats.length
                ? this.chats.map((c) => {
                    const key = `txt:${c.accountId}|${c.guid}`;
                    return `<div class="vz-row${c.unread ? ' is-unread' : ''}${this.txtSel === key ? ' is-selected' : ''}" role="option" data-key="${esc(key)}"><span><img src="${A}/envelope.png" alt="" draggable="false">${esc(c.title)}</span><span>${esc(fmt(c.at))}</span><span>${esc(c.lastText)}</span><span>${esc(c.callback)}</span></div>`;
                }).join('')
                : '<div class="vz-empty">No messages.</div>');
        }

        async loadKnown() {
            const p = this.provider();
            const rows = this.f('wlocrows');
            let list = [];
            if (p && typeof p.known === 'function') {
                try { const r = await p.known(); list = (r && r.networks) || []; } catch (_) { list = []; }
            }
            this.known = list;
            this.setHtml(rows, list.length
                ? list.map((n) => {
                    const name = String(n.name || n.ssid || '');
                    return `<div class="vz-row" role="option" data-key="known:${esc(name)}"><span><img src="${A}/wifi.png" alt="" draggable="false">${esc(name)}</span><span>${esc(n.security || (n.secured ? 'Secured' : 'Open'))}</span><span>${n.autoConnect === false ? 'Manually' : 'Automatically'}</span></div>`;
                }).join('')
                : '<div class="vz-empty">No saved Wi-Fi locations.</div>');
        }

        // ---------------------------------------------------------------- menus and commands

        menu(name) {
            const w = this.wwan();
            const vpn = this.vpn();
            switch (name) {
                case 'file': return [
                    w.connected ? { text: 'Disconnect WWAN', action: 'wwan', disabled: !!this.pending } : { text: 'Connect WWAN', action: 'wwan', disabled: !w.present || w.airplane || !!this.pending },
                    { text: 'Connect Wi-Fi...', action: 'wconnect' },
                    { separator: true },
                    { text: vpn && vpn.connected ? 'Stop VPN' : 'Start VPN', action: 'vpn', disabled: !vpn || !w.connected },
                    { separator: true },
                    { text: 'Exit', action: 'exit' }];
                case 'view': return [
                    { text: 'Networks', action: 'tab:networks', showIndicator: true, indicatorMark: 'radio', checked: this.tab === 'networks' },
                    { text: 'Statistics', action: 'tab:statistics', showIndicator: true, indicatorMark: 'radio', checked: this.tab === 'statistics' },
                    { text: 'TXT Messaging', action: 'tab:txt', showIndicator: true, indicatorMark: 'radio', checked: this.tab === 'txt' },
                    { text: 'Wi-Fi Locations', action: 'tab:wloc', showIndicator: true, indicatorMark: 'radio', checked: this.tab === 'wloc' },
                    { separator: true },
                    { text: 'Refresh', action: 'detect' }];
                case 'tools':
                    if (this.tab === 'statistics') return [{ text: 'Reset', action: 'reset' }];
                    if (this.tab === 'txt') return [{ text: 'Compose', action: 'compose' }, { text: 'Get New', action: 'getnew' }, { text: 'Reply', action: 'reply', disabled: !this.txtSel }];
                    return [{ text: 'Usage', action: 'usage' }, { text: 'My Verizon', action: 'myverizon' }];
                case 'options': return [
                    { text: 'Preferences...', action: 'prefs' },
                    { separator: true },
                    { text: 'Session Log...', action: 'log' },
                    { separator: true },
                    { text: 'Detect Device...', action: 'detect' },
                    { separator: true },
                    { text: 'Power Off WWAN Device', action: 'poweroff', disabled: !w.present || !w.on }];
                case 'help': return [
                    { text: 'Check for Updates', action: 'updates' },
                    { separator: true },
                    { text: 'About VZAccess Manager', action: 'about' },
                    { text: 'WWAN Device Info', action: 'devinfo', disabled: !w.present }];
                default: return [];
            }
        }

        async command(a) {
            if (a.startsWith('tab:')) { this.showTab(a.slice(4)); return; }
            switch (a) {
                case 'exit': this.app.exit(); return;
                case 'wwan': await this.toggleWwan(); return;
                case 'poweroff': if (this.wwan().on) await this.toggleWwan(true); return;
                case 'vpn': {
                    const cp = root.melatonControlPanel;
                    if (cp && typeof cp.toggleConnection === 'function') { try { cp.toggleConnection(); } catch (_) { /* nothing */ } }
                    setTimeout(() => this.paint(), 400);
                    return;
                }
                case 'detect': this.readCellular(); await this.refreshLists(); this.paint(); return;
                case 'usage': return this.usage();
                case 'myverizon': {
                    const url = 'https://www.verizon.com/';
                    if (typeof root.openGrimoireUrl === 'function') Promise.resolve().then(() => root.openGrimoireUrl(url)).catch(() => {});
                    return;
                }
                case 'reset': {
                    const st = this.stats;
                    this.stats = { last: st.last, rx: [], tx: [], maxRx: 0, maxTx: 0, base: st.last ? { rx: st.last.rx, tx: st.last.tx } : null, rxRate: 0, txRate: 0, sessionRx: 0, sessionTx: 0 };
                    this.paintStats(null);
                    return;
                }
                case 'notice': return this.message('Important Notice', 'The statistics shown are an estimate of the data sent and received by this computer over the Verizon Wireless network. They are not the data usage Verizon Wireless bills. To see the usage on your account, click Usage on the Networks tab or go to My Verizon.', 'info');
                case 'compose': case 'open-txt': case 'reply': case 'forward': return this.openTexts();
                case 'getnew': return this.loadTexts();
                case 'wconnect': {
                    const wf = root.dreamosWifi;
                    if (wf && typeof wf.openConnect === 'function') void wf.openConnect();
                    return;
                }
                case 'wrefresh': return this.loadKnown();
                case 'prefs': return this.prefs();
                case 'log': return this.sessionLog();
                case 'updates': return this.message('VZAccess Manager', 'VZAccess Manager is up to date.', 'info');
                case 'about': return this.about();
                case 'devinfo': return this.deviceInfo();
                case 'help': return undefined;
                default: return undefined;
            }
        }

        message(title, text, icon) {
            if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
            return root.showConfirmationDialog(esc(text).replace(/\n/g, '<br>'), [{ text: 'OK', value: true }], null, { title, icon: icon === 'warning' ? 'fas fa-exclamation-triangle' : 'fas fa-info-circle' });
        }

        /** Connect / Disconnect WWAN: mobile data on or off, with 7.x's charges warning before the first connect. */
        async toggleWwan(forceOff) {
            const w = this.wwan();
            if (!w.present || this.pending) return;
            const off = forceOff || w.connected;
            if (!off) {
                const prefs = readJson(PREFS_KEY, {});
                if (!prefs.noConnectWarning) {
                    const go = await this.connectWarning();
                    if (!go) return;
                }
            }
            this.pending = off ? 'disconnecting' : 'connecting';
            this.paint();
            // the phone's state settles within seconds; a request it did not carry out ends after 20 s
            this.pendingTimer = setTimeout(() => { this.pending = null; this.paint(); }, 20000);
            await this.setData(!off);
            this.paintSoon();
        }

        async connectWarning() {
            if (typeof root.showConfirmationDialog !== 'function') return true;
            let box = null;
            // the check box makes it a task dialog (no icon of the shell's): 7.x's warning triangle is drawn in the message
            const html = '<div class="vz-warn"><img src="/static_images/vista-icons/msgbox-warning-32.png" alt="" width="32" height="32" draggable="false"><div>ATTENTION<br><br>You are about to establish a Mobile Broadband or NationalAccess connection.  Charges apply in accordance with your subscription to Verizon Wireless\' NationalAccess/Mobile Broadband.<br><br>'
                + '<span class="win7"><input type="checkbox" id="vzNoWarn"><label for="vzNoWarn">Don\'t show this message again</label></span></div></div>';
            const r = await root.showConfirmationDialog(html, [{ text: 'Continue', value: true }, { text: 'Cancel', value: false }], null, {
                title: 'Warning!',
                icon: 'fas fa-exclamation-triangle',
                onDialogReady: () => { box = doc.getElementById('vzNoWarn'); }
            });
            if (r && box && box.checked) writeJson(PREFS_KEY, Object.assign(readJson(PREFS_KEY, {}), { noConnectWarning: true }));
            return !!r;
        }

        /** Usage: 7.6's estimate box. The phone keeps its mobile counters from its last start (not a billing month). */
        async usage() {
            const p = this.provider();
            let x = null;
            if (p && typeof p.stats === 'function') { try { x = await p.stats('rmnet0'); } catch (_) { x = null; } }
            if (!x || x.error || (x.kind && x.kind !== 'mobile')) return this.message('Usage', 'Usage information is not available.', 'info');
            const d = new Date();
            let h = d.getHours();
            const ap = h >= 12 ? 'PM' : 'AM';
            h = h % 12 || 12;
            const gb = ((Number(x.rxBytes) || 0) + (Number(x.txBytes) || 0)) / 1e9;
            return this.message('Usage', `Est as of ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(h)}:${pad(d.getMinutes())}${ap}: Data Usage: ${gb.toFixed(3)}GB.`, 'info');
        }

        /** Preferences > Application (the User Guide's page): kept for this program. */
        async prefs() {
            if (typeof root.showConfirmationDialog !== 'function') return;
            const p = readJson(PREFS_KEY, {});
            const box = (id, label, on) => `<div class="win7"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><label for="${id}">${label}</label></div>`;
            const html = `<b>Application</b><br><br>${box('vzPrefPopup', 'Show popup status windows by tray', p.popup !== false)}${box('vzPrefWarn', 'Show the charges warning before connecting', !p.noConnectWarning)}`;
            let dlg = null;
            const r = await root.showConfirmationDialog(html, [{ text: 'OK', value: true }, { text: 'Cancel', value: false }], null, { title: 'Preferences', icon: 'fas fa-info-circle', onDialogReady: () => { dlg = doc.getElementById('confirmationDialog'); } });
            if (!r || !dlg) return;
            const v = (id) => { const e = doc.getElementById(id); return !!(e && e.checked); };
            writeJson(PREFS_KEY, Object.assign(p, { popup: v('vzPrefPopup'), noConnectWarning: !v('vzPrefWarn') }));
        }

        sessionLog() {
            const log = readJson(LOG_KEY, []);
            if (!log.length) return this.message('Session Log', 'There are no sessions in the log.', 'info');
            const lines = log.slice(0, 15).map((s) => `${new Date(s.start).toLocaleString('en-US')}  ${hms(s.end - s.start)}  ${s.type || 'WWAN'}  Sent ${bytesText(s.tx)}  Received ${bytesText(s.rx)}`);
            return this.message('Session Log', lines.join('\n'), 'info');
        }

        openTexts() {
            // Melaton's own Text Messages program does the writing (Melaton Messenger on the desktop)
            const apps = root.melatonApps;
            if (apps && typeof apps.launch === 'function') { void apps.launch({ packageId: 'messenger' }).catch(() => {}); }
        }

        /** About VZAccess Manager: 7.6.3.1's box, with the modem's own facts under Hardware information. */
        about() {
            const w = this.wwan();
            const hw = this.hardware() || {};
            const d = hw.device || {};
            const rows = [
                ['Manufacturer', d.manufacturer || ''], ['Model', d.model || ''], ['Modem Name', d.marketName || d.model || ''],
                ['Phone Number', w.number ? `(${phoneText(w.number).slice(0, 3)}) ${phoneText(w.number).slice(4)}` : ''],
                ['Network', w.present ? w.carrier : ''], ['Technology', w.present ? (w.type || '') : ''],
                ['Signal', w.present ? `${w.bars} of 4 bars` : ''], ['Roaming', w.present ? (w.roaming ? 'Extended Network' : 'Home') : ''],
                ['SIM', w.sim === 'ready' ? 'Ready' : (w.sim || '')]
            ];
            this.infoWindow('vzAccessAboutModal', 'About VZAccess Manager', `
                <div class="vz-about">
                    <div class="vz-about-text">VZAccess Manager<br>Powered By QuickLink Mobile Technology<br><br>Copyright &copy; 2006-2011<br>Smith Micro Software, Inc.<br><br>Version ${esc(VERSION)}<br>Consumer Release</div>
                    <img class="vz-about-logo" src="${A}/smithmicro-logo.png" alt="Smith Micro Software" draggable="false">
                </div>
                <div class="vz-about-head">Hardware information:</div>
                ${this.propList(rows)}`);
        }

        deviceInfo() {
            const w = this.wwan();
            const hw = this.hardware() || {};
            const d = hw.device || {};
            this.infoWindow('vzAccessDeviceModal', 'WWAN Device Info', this.propList([
                ['Manufacturer', d.manufacturer || ''], ['Model', d.model || ''], ['Device', d.marketName || ''],
                ['Phone Number', phoneText(w.number)], ['Network', w.carrier || ''], ['Technology', w.type || ''],
                ['Signal', `${w.bars} of 4 bars`], ['Roaming', w.roaming ? 'Extended Network' : 'Home'], ['SIM', w.sim === 'ready' ? 'Ready' : (w.sim || '')]
            ]));
        }

        propList(rows) {
            return `<div class="vz-list vz-props"><div class="vz-rows">${rows.map(([k, v]) => `<div class="vz-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div></div>`;
        }

        /** A child window of the program (About, WWAN Device Info): its icon, an OK button. */
        infoWindow(id, title, html) {
            const old = doc.getElementById(id);
            if (old) { call('bringModalToFront', old); return; }
            const w = root.desktopAppCreateWindow({ id, identifier: id, title, icon16: `${A}/vzaccess-16.png`, taskbarIcon: `${A}/vzaccess-32.png`, className: 'vz-window vz-info-window', fixed: true });
            w.modal.dataset.windowKind = 'custom';
            w.content.classList.add('vz-client');
            w.content.innerHTML = `<div class="vz-root vz-info">${html}<div class="vista-dialog-footer"><button type="button" data-dialog-primary data-vz-ok>OK</button></div></div>`;
            const close = () => { try { call('closeModal', w.modal); } catch (_) { /* gone */ } setTimeout(() => w.modal.remove(), 400); };
            w.close.addEventListener('click', close, { signal: this.app.signal });
            w.content.querySelector('[data-vz-ok]').addEventListener('click', close, { signal: this.app.signal });
            this.app.signal.addEventListener('abort', () => { if (w.modal.isConnected) w.modal.remove(); }, { once: true });
            call('openModal', w.modal);
            w.modal.classList.remove('hidden');
            requestAnimationFrame(() => {
                const r = w.modal.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', w.modal, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            });
        }
    }

    /** The program's colours: the Vista theme's token block (css/themes/vista/vzaccess.css, ui-standard section 6). */
    function themeStyles() {
        if (doc.querySelector('link[data-vz-theme]')) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/css/themes/vista/vzaccess.css';
        link.dataset.vzTheme = '1';
        doc.head.appendChild(link);
    }

    let running = null;
    function start(app) {
        themeStyles();
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        if (typeof root.desktopAppCreateWindow !== 'function') { app.exit(); return; }
        const m = new Manager(app);
        running = m;
        app.onExit(() => { if (running === m) running = null; m.destroy(); });
    }

    root.melatonVZAccess = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('vzaccess', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
