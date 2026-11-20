/**
 * VZAccess Manager 7.6 (Yozora #947): Verizon Wireless' connection manager of the 4G LTE launch (7.6.3.1, the
 * UML290 / USB551L era, Smith Micro's QuickLink Mobile), for a Melaton desktop on Verizon mobile broadband (a
 * phone's DeX / Continuity desktop). Laid out after the AnandTech captures of 7.6 on Windows 7 and the 7.x User
 * Guide (~/.cache/vzam-ref): the Verizon Wireless logo, the Networks / Statistics / TXT Messaging / Wi-Fi
 * Locations tabs, and the status area (Coverage Indicator, Connection Status with its timer, the device's mode,
 * model and number, Start VPN and Connect / Disconnect WWAN).
 *
 * #953: checked against the real 7.6.3.1 (2642f) installed on the Vista VM (~/.cache/vzam-ref/vm shots, its
 * VZAMres.dll dumped to ~/.cache/vzam-ref/res and the help CHM to ~/.cache/vzam-ref/chm): the art is the program's
 * own (VZAMres PNG / bitmap resources, the exe's icons), the menus are its RT_MENU 100 and 537 (tray), and Session
 * Log, Session Log Filter, About, Usage and Warning! are its own dialog templates (5_428, 5_540, 5_101, 5_498,
 * 5_465) drawn by Melaton's dialog kit. View > Minimum is 7.6's compact window. The tray icon is the program's
 * (green edge connected, red idle); one click opens the tray menu, a double click the window (the help's own words).
 *   Cell details  AndroidCellular.getCellInfo() (DSApp claude/cell-metrics): read when WWAN Device Info opens or
 *                 the meter is pointed at (at most every 10 s), never on a timer
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
    const VERSION = '7.6.3.1 (2642f)';
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

    /**
     * VZAccess Manager's own dialog templates (VZAMres.dll RT_DIALOG, ~/.cache/vzam-ref/tools/tpl.py): Session Log 428,
     * Session Log Filter 540, About 101, Usage 498 (its WebBrowser control is a plain pane here), Warning! 465.
     * Drawn by Melaton's dialog kit (vistaDialogTemplate.js) as the VM draws them.
     */
    const TPL = {"vzam:428":{"t":"Session Log","w":380,"h":162,"f":["MS Shell Dlg 2",8],"s":2160861248,"c":[[415,"SysListView32",7,8,366,110,1350633472,"",0],[1212,"B",7,121,366,16,1342177287,"",0],[1113,"S",10,125,260,8,1342325504,"",0],[1213,"S",286,125,85,8,1342374402,"* View Important Notice",0],[503,"B",7,142,42,14,1342242816,"&Export",0],[504,"B",51,142,42,14,1342242816,"&Clear",0],[505,"B",95,142,42,14,1342242816,"&Filter",0],[1,"B",324,142,50,14,1342242817,"Close",0]]},"vzam:540":{"t":"Session Log Filter","w":268,"h":127,"f":["MS Shell Dlg 2",8],"s":2160599232,"c":[[1232,"S",15,7,246,14,1342308352,"Use the following items to filter through the session log.",0],[1020,"B",17,25,68,10,1342242819,"&Connection:",0],[1065,"C",91,25,170,78,1344339971,"",0],[1021,"B",17,49,67,10,1342242819,"De&vice:",0],[1067,"C",91,49,170,79,1344339971,"",0],[1022,"B",17,72,39,10,1342242819,"&Date",0],[-1,"S",65,73,21,8,1342308352,"&From:",0],[1069,"SysDateTimePick32",91,72,70,15,1342242848,"",0],[-1,"S",175,72,14,8,1342308352,"&To:",0],[1071,"SysDateTimePick32",192,72,70,15,1342242848,"",0],[1,"B",157,107,50,14,1342242817,"OK",0],[2,"B",211,107,50,14,1342242816,"Cancel",0]]},"vzam:101":{"t":"About VZAccess Manager","w":257,"h":242,"f":["MS Shell Dlg 2",8],"s":2160855104,"c":[[1,"B",200,221,50,14,1342242817,"OK",0],[-1,"S",7,7,144,17,1342308352,"VZAccess Manager\r\nPowered By QuickLink Mobile Technology",0],[-1,"S",7,30,95,21,1342308352,"Copyright © 2006-2011\r\nSmith Micro Software, Inc.",0],[425,"S",7,52,204,26,1342308352,"Version 7.0.0 ( Alpha build)\r\nConsumer Release",0],[386,"SysListView32",7,91,243,125,1350633472,"",0],[-1,"S",7,82,91,8,1342308352,"Hardware information:",0],[387,"S",129,30,110,26,1342308352,"Static",0]]},"vzam:498":{"t":"Usage","w":226,"h":159,"f":["MS Shell Dlg 2",8],"s":2429296708,"c":[[1,"B",169,138,50,14,1342242817,"Close",0],[499,"{8856F961-340A-11D0-A96B-00C04FD705A2}",7,7,212,125,1342177280,"",0],[511,"E",7,7,212,125,1084233732,"",0],[497,"B",7,135,149,18,1073815555,"&Do not show my Usage information on connection",0]]},"vzam:465":{"t":"Warning!","w":231,"h":148,"f":["MS Shell Dlg 2",8],"s":2160591040,"c":[[1,"B",120,127,50,14,1342242817,"&Continue",0],[2,"B",174,127,50,14,1342242816,"Cancel",0],[466,"B",35,109,161,10,1342242819,"&Don't show this message again",0],[464,"S",7,7,21,20,1342177294,"",0],[1009,"RICHEDIT50W",35,7,190,98,1342179332,"",0]]}};

    /** The dialog kit (loaded on demand) with the templates above. */
    function kit() {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : Promise.resolve();
        return Promise.resolve(ready).then(() => {
            if (!root.vistaDialogTemplate) throw new Error('vistaDialogTemplate is not loaded');
            root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, TPL);
            return root.vistaDialogTemplate;
        });
    }

    /** "3,284 KB", as the Session Log counts bytes (whole kilobytes, grouped). */
    const kbText = (n) => `${Math.round((Number(n) || 0) / 1024).toLocaleString('en-US')} KB`;
    /** "11/19/2026 6:47 PM" */
    const whenText = (t) => new Date(t).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', '');
    /** "0:05:12" (a session's Duration); "0:05" (the log's total, h:mm) */
    const hmsShort = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
    const hmShort = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}`; };
    /** Session Log's columns (their widths, the VM's, are vzaccess.css .vz-c0 ... .vz-c5) and right-aligned ones */
    const LOG_COLS = [['Connection', false], ['Date/Time', false], ['Duration', true], ['Bytes Received', true], ['Bytes Sent', true], ['Total Bytes', true]];
    const dbm = (v, unit = 'dBm') => (v == null || !Number.isFinite(Number(v)) ? '' : `${v} ${unit}`);

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
     * The Coverage Indicator for the phone's data class, in VZAM's own form ("<H2>Mobile Broadband<H3> (4G LTE)",
     * string 1363; "(EV-RevA)", "NationalAccess (1xRTT)"). The radio's own names in the brackets (Yukimi, #953): LTE,
     * LTE Advanced (LTE+ / carrier aggregation), NR, NR Advanced (5G-A), NR mmWave (5G UW mmWave, or any NR cell in FR2
     * as the cell details say). The marks by the bars are Verizon's (Yukimi's artwork; 7.6.3 has no 4G LTE badge of its
     * own: its "4G" is drawn text).
     */
    function coverageOf(type, fr) {
        const t = String(type || '').toUpperCase();
        const nr = /5G|NR/.test(t);
        if ((nr && fr === 'FR2') || /5G\s*-?\s*UW|UWB|MMWAVE/.test(t)) return { html: '<b>Mobile Broadband</b> (NR mmWave)', tech: '5G UW', mark: '5guw' };
        if (/5G\s*-?\s*A|NR\s*-?\s*A/.test(t)) return { html: '<b>Mobile Broadband</b> (NR Advanced)', tech: '5G UW', mark: '5guw' };
        if (nr) return { html: '<b>Mobile Broadband</b> (NR)', tech: '5G', mark: '5g' };
        if (/LTE\s*\+|LTE-?A/.test(t)) return { html: '<b>Mobile Broadband</b> (LTE Advanced)', tech: '4G LTE', mark: '4glte' };
        if (/LTE/.test(t)) return { html: '<b>Mobile Broadband</b> (LTE)', tech: '4G LTE', mark: '4glte' };
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
            // started by the desktop on a Verizon connection (androidTrayProviders.js, #947): in the notification
            // area only, as 7.x's "Run VZAccess Manager at Startup" left it; the tray icon opens the window
            this.trayOnly = !!(app.args && app.args.tray);
            this.shown = false;
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
            this.mini = !!readJson(PREFS_KEY, {}).minimum; // View > Minimum (7.6 opens in the view it closed in)
            this.cellInfo = null; // AndroidCellular.getCellInfo(), read when asked
            this.cellAt = 0;
            this.dialogs = new Map(); // the kit's dialogs open now (id -> ctx), closed with the program
            this.readCellular();
            this.build();
            this.subscribe();
            this.paint();
            void this.refreshLists();
        }

        // ---------------------------------------------------------------- the modem (the phone)

        provider() { return (root.melatonTray && root.melatonTray.provider('network')) || null; }

        /**
         * The modem's radio details (DSApp CellularBridge, window.AndroidCellular): read when WWAN Device Info opens or
         * the signal meter is pointed at, at most every 10 s unless forced; never on a timer. null on an older app.
         */
        readCellInfo(force) {
            const b = root.AndroidCellular;
            if (!b || typeof b.getCellInfo !== 'function') return null;
            if (!force && this.cellInfo && Date.now() - this.cellAt < 10000) return this.cellInfo;
            try { this.cellInfo = parse(b.getCellInfo()); } catch (_) { this.cellInfo = null; }
            this.cellAt = Date.now();
            return this.cellInfo;
        }

        /** The meter's tooltip: the bars, and the signal's own figures when the modem gave them. */
        signalTip(w) {
            const ci = this.cellInfo;
            const parts = [`Signal: ${w.bars || 0} of 4 bars`];
            if (ci && ci.lte && ci.lte.rsrp != null) parts.push(`LTE RSRP ${ci.lte.rsrp} dBm${ci.lte.rssnr != null ? `, SINR ${ci.lte.rssnr} dB` : ''}`);
            if (ci && ci.nr && ci.nr.ssRsrp != null) parts.push(`NR SS-RSRP ${ci.nr.ssRsrp} dBm${ci.nr.ssSinr != null ? `, SS-SINR ${ci.nr.ssSinr} dB` : ''}`);
            return parts.join('\n');
        }

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
            // no modem: 7.6's "Not Connected" and "Device not available" (strings 209)
            if (!c || c.present === false || c.simState === 'absent') return { present: false, connected: false, state: 'Not Connected', bars: 0, type: '' };
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

        /** One read of the modem link's byte counters (the provider's stats('rmnet0')), or null. */
        async linkBytes() {
            const p = this.provider();
            if (!p || typeof p.stats !== 'function') return null;
            let x = null;
            try { x = await p.stats('rmnet0'); } catch (_) { x = null; }
            if (!x || x.error || (x.kind && x.kind !== 'mobile')) return null;
            return { rx: Number(x.rxBytes) || 0, tx: Number(x.txBytes) || 0 };
        }

        /**
         * The connection began or ended (as the phone reports it): the timer and the Session Log follow. A session
         * is recorded from the transitions VZAccess Manager sees while it runs (in the window or the tray): its start,
         * the link's counters then, and at the end the bytes since. One that ended while the program was closed ends
         * when the program was last running (as 7.x logged only what it saw).
         */
        noteConnection(w) {
            const s = this.session();
            const first = !this.sawStart;
            this.sawStart = true;
            if (w.connected && !s) {
                const ses = { start: Date.now(), carrier: w.carrier || 'Verizon Wireless', tech: coverageOf(w.type).tech, device: this.model() };
                writeJson(SESSION_KEY, ses);
                // the counters at the start (one read, as the connection begins)
                void this.linkBytes().then((b) => {
                    const cur = this.session();
                    if (b && cur && cur.start === ses.start && cur.rx0 == null) writeJson(SESSION_KEY, Object.assign(cur, { rx0: b.rx, tx0: b.tx }));
                });
                return;
            }
            if (!w.connected && s && !this.ending) {
                this.ending = true;
                const end = s.seen && first ? s.seen : Date.now();
                // the last counters seen (Statistics, the tray) if the link has gone by now
                const last = this.stats.last;
                void this.linkBytes().then((b) => {
                    const now = b || (last ? { rx: last.rx, tx: last.tx } : null);
                    const rx = now && s.rx0 != null && now.rx >= s.rx0 ? now.rx - s.rx0 : 0;
                    const tx = now && s.tx0 != null && now.tx >= s.tx0 ? now.tx - s.tx0 : 0;
                    const log = readJson(LOG_KEY, []);
                    log.unshift({ start: s.start, end, rx, tx, type: 'WWAN', connection: `${s.carrier || 'Verizon Wireless'} - VZAccess`, tech: s.tech || '', device: s.device || '' });
                    writeJson(LOG_KEY, log.slice(0, 200));
                    writeJson(SESSION_KEY, null);
                    this.ending = false;
                    if (this.logCtx) this.fillLog(this.logCtx);
                });
            }
        }

        /** The program is closing: an open session remembers when it was last seen. */
        noteExit() {
            const s = this.session();
            if (s) writeJson(SESSION_KEY, Object.assign(s, { seen: Date.now() }));
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
                        <button type="button" role="tab" data-tab="networks" aria-selected="true"><img src="${A}/tab-networks.png" data-on="tab-networks" data-off="tab-networks-off" alt="" draggable="false">Networks</button>
                        <button type="button" role="tab" data-tab="statistics" aria-selected="false"><img src="${A}/tab-statistics-off.png" data-on="tab-statistics" data-off="tab-statistics-off" alt="" draggable="false">Statistics</button>
                        <button type="button" role="tab" data-tab="txt" aria-selected="false"><img src="${A}/tab-txt-off.png" data-on="tab-txt" data-off="tab-txt-off" alt="" draggable="false">TXT Messaging</button>
                        <button type="button" role="tab" data-tab="wloc" aria-selected="false"><img src="${A}/tab-wifiloc.png" data-on="tab-wifiloc" data-off="tab-wifiloc" alt="" draggable="false">Wi-Fi Locations</button>
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
                        <div class="vz-box vz-device" data-f="device"></div>
                        <button type="button" class="vz-vpn" data-vz="vpn"></button>
                        <div class="vz-box vz-conn"><span data-f="state"></span><span class="vz-fill"></span><span data-f="timer">00:00:00</span><img data-f="arrows" src="${A}/arrows-off.png" alt="" draggable="false"></div>
                        <button type="button" class="vz-cmd" data-vz="wwan"></button>
                    </div>
                    <div class="vz-mini">
                        <div class="vz-box vz-mcover">
                            <div class="vz-mline" data-f="mcover"></div>
                            <div class="vz-mline vz-mconn"><span class="vz-mtech" data-f="mtech"></span><span class="vz-fill"></span><span data-f="mtimer">00:00:00</span><img data-f="marrows" src="${A}/arrows-off.png" alt="" draggable="false"></div>
                        </div>
                        <div class="vz-box vz-mdevice" data-f="mdevice"></div>
                        <div class="vz-mbtns"><button type="button" data-vz="usage" data-f="musage"><u>U</u>sage</button><button type="button" class="vz-vpn" data-vz="vpn"></button></div>
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
            // the menu's accelerators (VZAMres menu 100): F4 Connect, F5 Refresh, Ctrl+K Diagnostics, Ctrl+N Detect Device
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && ev.target.closest('.vz-notice')) { ev.preventDefault(); void this.command('notice'); return; }
                const k = ev.ctrlKey && !ev.altKey && !ev.shiftKey ? `^${ev.key.toLowerCase()}` : (!ev.ctrlKey && !ev.altKey ? ev.key : '');
                const a = { F4: 'wwan', F5: 'detect', '^k': 'devinfo', '^n': 'detect' }[k];
                if (a) { ev.preventDefault(); void this.command(a); }
            }, sig);
            // the device box: a double click shows its details (WWAN Device Info)
            m.addEventListener('dblclick', (ev) => { if (ev.target.closest('.vz-device, .vz-mdevice')) void this.command('devinfo'); }, sig);
            // the meter: its tooltip reads the modem's figures when pointed at (not on a timer)
            m.addEventListener('pointerover', (ev) => {
                const meter = ev.target.closest('.vz-cover .vz-sig, .vz-mconn .vz-sig');
                if (!meter || !root.AndroidCellular) return;
                this.readCellInfo();
                const t = this.signalTip(this.wwan());
                if (meter.title !== t) meter.title = t;
            }, sig);
            m.querySelectorAll('.naxt-menu-title').forEach((t) => {
                if (!root.contextMenu || typeof root.contextMenu.attachClickMenuToElement !== 'function') return;
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.command(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.vzMenu); } }]
                });
            });
            // the window's close button puts it back in the notification area while it runs from there (on Verizon);
            // Exit in the File and tray menus quits
            w.close.addEventListener('click', (ev) => {
                if (!this.trayOnly) { this.app.exit(); return; }
                ev.stopImmediatePropagation();
                this.hide();
            }, Object.assign({ capture: true }, sig));
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed' && !this.hiding) this.app.exit();
            }, sig);
            this.q = q;
            this.m = m;
            this.root = m.querySelector('.vz-root');
            this.setMini(this.mini, true);
            if (!this.trayOnly) this.show();
            this.makeTray();
        }

        /** The window on screen (from the tray, the Start menu or a second launch). */
        show() {
            const m = this.m;
            if (!m) return;
            if (this.shown && m.isConnected && !m.classList.contains('hidden')) { call('bringModalToFront', m); return; }
            this.shown = true;
            call('openModal', m);
            m.classList.remove('hidden');
            this.paintSoon();
            this.place(m);
        }

        /**
         * View > Minimum: 7.6's compact window (the coverage box with the bars, timer and data arrows, the device box,
         * Usage / Start VPN and Connect WWAN under the menu); chosen again, the Full view. Remembered.
         */
        setMini(on, quiet) {
            this.mini = !!on;
            this.modal.classList.toggle('vz-min', this.mini);
            if (!quiet) {
                writeJson(PREFS_KEY, Object.assign(readJson(PREFS_KEY, {}), { minimum: this.mini }));
                if (this.mini && this.tab === 'statistics') this.drawGraph();
                this.paintSoon();
            }
        }

        /** Back to the notification area (the window closes; the program keeps running in the tray). */
        hide() {
            const m = this.m;
            if (!m || !this.shown) return;
            this.shown = false;
            this.hiding = true;
            Promise.resolve(call('closeModal', m)).finally(() => { this.hiding = false; });
        }

        place(m) {
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
        }

        makeTray() {
            // the notification area: the program's icon, its edge green while connected and red while not (the help's
            // "Using the System Tray Icon"). A click opens the Minimum View (Yukimi, #953); a double click the window in
            // its last view, as 7.6; the right button VZAMres menu 537
            const menu = {
                sections: [{ type: 'list', initfn: (s) => { s.items = this.trayMenu(); } }],
                onAction: (a) => {
                    if (a === 'show') { this.show(); return; }
                    if (a.startsWith('tab:')) { this.setMini(false); this.show(); this.showTab(a.slice(4)); return; }
                    void this.command(a);
                }
            };
            this.trayIcon = this.app.tray({
                title: 'VZAccess Manager',
                icon: `${A}/tray-idle.png`,
                onClick: () => {
                    if (this.trayClickTimer) return;
                    // wait out a double click's second press
                    this.trayClickTimer = setTimeout(() => { this.trayClickTimer = 0; if (!this.mini) this.setMini(true); this.show(); }, 250);
                },
                menu
            });
            if (this.trayIcon) {
                this.trayIcon.addEventListener('dblclick', () => {
                    clearTimeout(this.trayClickTimer);
                    this.trayClickTimer = 0;
                    this.show();
                }, { signal: this.app.signal });
            }
        }

        /** VZAMres menu 537 (the tray's), as 7.6.3.1 shows it: TXT Messaging and Power Device only with a device. */
        trayMenu() {
            const w = this.wwan();
            return [
                { text: 'Show Application', action: 'show', default: true },
                { separator: true },
                { text: 'Networks', action: 'tab:networks' },
                { text: 'Statistics', action: 'tab:statistics' },
                ...(w.present ? [{ text: 'TXT Messaging', action: 'tab:txt' }] : []),
                { text: 'Wi-Fi Locations', action: 'tab:wloc' },
                { separator: true },
                { text: 'Preferences...', action: 'prefs' },
                ...(w.present ? [{ text: 'Power Device', action: 'power', showIndicator: true, checked: !!w.on }] : []),
                { separator: true },
                { text: 'Check for Updates...', action: 'updates' },
                { text: 'About VZAccess Manager...', action: 'about' },
                { separator: true },
                { text: 'Exit', action: 'exit' }
            ];
        }

        destroy() {
            this.offs.forEach((off) => { try { off(); } catch (_) { /* gone */ } });
            this.offs = [];
            clearTimeout(this.pendingTimer);
            clearTimeout(this.trayClickTimer);
            this.dialogs.forEach((ctx) => { try { ctx.close(); } catch (_) { /* gone */ } });
            this.dialogs.clear();
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
            // (in the tray only, nothing ticks: the pushes keep the tray icon right)
            const seen = () => this.shown && !doc.hidden && doc.documentElement.dataset.screenOff === undefined && !this.app.signal.aborted && !this.modal.classList.contains('minimised');
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
            const t = s ? hms(Date.now() - s.start) : '00:00:00';
            this.setText(this.f('timer'), t);
            this.setText(this.f('mtimer'), t);
            if (this.tab === 'statistics' && !this.mini) void this.sample();
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
            // the FR2 (mmWave) answer comes from the cell details, if they were read
            const ci = this.cellInfo;
            const cov = coverageOf(w.type, ci && ci.frequencyRange);
            const ext = w.roaming ? ' Extended Network' : '';
            // the Coverage Indicator: the network and its radio (strings 1363, 3061), roaming, the mark and the bars
            const mark = cov.mark ? `<img class="vz-tech-mark" src="${A}/tech-${cov.mark}-15.png" srcset="${A}/tech-${cov.mark}-30.png 2x" alt="${esc(cov.tech)}" draggable="false">` : cov.tech ? `<span class="vz-tech">${esc(cov.tech)}</span>` : '';
            const roam = w.roaming ? `<img class="vz-roam" src="${A}/roam-extended.png" alt="" title="Extended Network" draggable="false">` : '';
            const meter = `<span class="vz-sig" title="${esc(this.signalTip(w))}">${meterHtml(w.bars)}</span>`;
            const covText = !w.present ? '' : w.searching ? '<span>Searching for network</span>' : `<span title="${esc(`Coverage - ${cov.html.replace(/<[^>]+>/g, '')}${ext}`)}">${cov.html}</span>`;
            const live = w.present && !w.searching;
            this.setHtml(this.f('cover'), live ? `${covText}<span class="vz-fill"></span>${roam}${mark}${meter}` : covText);
            this.setHtml(this.f('mcover'), covText);
            this.setHtml(this.f('mtech'), live ? `${mark}${meter}${roam}` : '');
            // Connection Status, the timer, the data arrows (up, down or both as the data moves)
            this.setText(this.f('state'), w.state);
            const arrows = `${A}/${w.connected && w.moving ? 'arrows' : 'arrows-off'}.png`;
            ['arrows', 'marrows'].forEach((k) => { const el = this.f(k); if (el && el.getAttribute('src') !== arrows) el.setAttribute('src', arrows); });
            // the device: 7.6's box (TXT envelope, LAN, the model; the device's state icon, My #), else "Device not available"
            const unread = !!(this.cell && this.cell.unreadTexts);
            const envelope = `<img src="${A}/${unread ? 'envelope-new' : 'envelope'}.png" alt="" draggable="false">`;
            const devIcon = !w.present ? 'device-na' : /lock|pin|puk/i.test(w.sim || '') ? 'device-locked' : 'phone';
            const number = `My #: ${w.present ? phoneText(w.number) : ''}`;
            this.setHtml(this.f('device'), w.present
                ? `${envelope}<span class="mode"><b>LAN</b><span>${esc(this.model())}</span></span><img src="${A}/${devIcon}.png" alt="" draggable="false"><span class="num">${esc(number)}</span>`
                : `<img class="vz-na" src="${A}/device-na.png" alt="" draggable="false"><span class="vz-na-text">Device not available</span>`);
            this.setHtml(this.f('mdevice'), w.present
                ? `<img src="${A}/${devIcon}.png" alt="" draggable="false"><span class="num">${esc(number)}</span>${envelope}<b class="vz-lan">LAN</b>`
                : `<img src="${A}/device-na.png" alt="" draggable="false"><span>Device not available</span>`);
            // TXT Messaging is a device's (7.6 shows its tab only with one)
            const txtTab = this.q('button[data-tab="txt"]');
            if (txtTab) txtTab.hidden = !w.present;
            if (!w.present && this.tab === 'txt') this.showTab('networks');
            // Start VPN and the command button (Connect WWAN / Disconnect WWAN, strings 769-770; "Connect" with no device)
            const vpn = this.vpn();
            this.m.querySelectorAll('[data-vz="vpn"]').forEach((vb) => {
                this.setHtml(vb, vpn && vpn.connected ? 'S<u>t</u>op VPN' : '<u>S</u>tart VPN');
                vb.disabled = !vpn || !w.connected;
            });
            const mu = this.f('musage');
            if (mu) { mu.hidden = !w.present; mu.disabled = !w.connected; }
            this.m.classList.toggle('vz-nodev', !w.present);
            const disconnect = w.connected || this.pending === 'connecting';
            this.m.querySelectorAll('[data-vz="wwan"]').forEach((cb) => {
                this.setHtml(cb, !w.present ? 'Connect' : disconnect ? '<u>D</u>isconnect WWAN' : '<u>C</u>onnect WWAN');
                cb.classList.toggle('vz-red', disconnect);
                cb.disabled = !w.present || w.airplane || !!this.pending;
            });
            // the tray: the program's icon, its edge green while connected; the tooltip names the link, its radio and bars
            if (this.trayIcon) {
                const img = this.trayIcon.querySelector('img');
                const src = `${A}/${w.connected ? 'tray-connected' : 'tray-idle'}.png`;
                if (img && img.getAttribute('src') !== src) img.setAttribute('src', src);
                const tip = !w.present ? 'VZAccess Manager\nDevice not available'
                    : `VZAccess Manager\n${w.carrier} - VZAccess: ${w.state}${live ? `\n${cov.tech || w.type || ''} ${w.bars} of 4 bars${ext}` : ''}`;
                if (this.trayIcon.title !== tip) this.trayIcon.title = tip;
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
            // the Wi-Fi radio off: no Wi-Fi networks (the last scan is not what is around now)
            const wifiOff = wifi.radio === false || wifi.state === 'off' || wifi.present === false;
            const current = !wifiOff && wifi.state === 'connected' && wifi.network ? wifi.network : null;
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
                rows.push({ key: `wifi:${name}`, icon: connected ? 'wifi-on' : 'wifi', name, status: connected ? 'Connected' : '', bars: barsOfPercent(n.signalPercent), on: connected, secure: n.secured || n.security });
            };
            if (current) wifiRow(current, true);
            if (!wifiOff) (this.scan || []).forEach((n) => wifiRow(n, false));
            const html = rows.length
                ? rows.map((r) => `<div class="vz-row${r.on ? ' is-on' : ''}${this.netSel === r.key ? ' is-selected' : ''}" role="option" data-key="${esc(r.key)}" title="${r.secure ? 'Secured network' : ''}">
                        <span><img src="${A}/${r.icon}.png" alt="" draggable="false"><span class="vz-name">${esc(r.name)}</span></span>
                        <span>${esc(r.status)}</span>
                        <span>${meterHtml(r.bars)}</span><span></span>
                    </div>`).join('')
                : '';
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
            this.modal.querySelectorAll('button[role="tab"]').forEach((t) => {
                const on = t.dataset.tab === tab;
                t.setAttribute('aria-selected', String(on));
                // 7.6's tab art: the selected tab's in colour, the others' grey (VZAMres PNG 1178-1185)
                const img = t.querySelector('img');
                const src = `${A}/${on ? img.dataset.on : img.dataset.off}.png`;
                if (img.getAttribute('src') !== src) img.setAttribute('src', src);
            });
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

        /** VZAMres menu 100, as 7.6.3.1 shows it: Tools follows the tab; device items only with a device. */
        menu(name) {
            const w = this.wwan();
            const tab = (t, text) => ({ text, action: `tab:${t}`, showIndicator: true, indicatorMark: 'radio', checked: !this.mini && this.tab === t });
            switch (name) {
                case 'file': return [
                    { text: w.connected ? 'Disconnect' : 'Connect', subtext: 'F4', action: 'wwan', disabled: !w.present || w.airplane || !!this.pending },
                    { separator: true },
                    { text: 'Exit', action: 'exit' }];
                case 'view': return [
                    tab('networks', 'Networks'),
                    tab('statistics', 'Statistics'),
                    ...(w.present ? [tab('txt', 'TXT Messaging')] : []),
                    tab('wloc', 'Wi-Fi Locations'),
                    { separator: true },
                    { text: 'Refresh', subtext: 'F5', action: 'detect' },
                    { separator: true },
                    { text: 'Minimum', action: 'minimum', showIndicator: true, checked: this.mini }];
                case 'tools':
                    if (!this.mini && this.tab === 'statistics') return [{ text: 'Reset', action: 'reset' }];
                    if (!this.mini && this.tab === 'txt') {
                        return [
                            { text: 'Compose...', action: 'compose' },
                            { text: 'Get New...', action: 'getnew' },
                            { text: 'Reply...', action: 'reply', disabled: !this.txtSel },
                            { text: 'Forward...', action: 'forward', disabled: !this.txtSel }];
                    }
                    if (!this.mini && this.tab === 'wloc') return [{ text: 'Update Locations...', action: 'wrefresh' }];
                    return [
                        ...(w.present ? [{ text: 'Usage...', action: 'usage' }] : []),
                        { text: 'My Verizon...', action: 'myverizon' }];
                case 'options': return [
                    { text: 'Preferences...', action: 'prefs' },
                    { separator: true },
                    { text: 'Diagnostics...', subtext: 'Ctrl-K', action: 'devinfo', disabled: !w.present },
                    { text: 'Session Log...', action: 'log' },
                    { separator: true },
                    { text: 'Detect Device...', subtext: 'Ctrl-N', action: 'detect' },
                    ...(w.present ? [{ separator: true }, { text: 'Power Device', action: 'power', showIndicator: true, checked: !!w.on }] : [])];
                case 'help': return [
                    { text: 'Check for Updates...', action: 'updates' },
                    { separator: true },
                    { text: 'Support...', action: 'support' },
                    { text: 'About VZAccess Manager...', action: 'about' }];
                default: return [];
            }
        }

        async command(a) {
            if (a.startsWith('tab:')) { if (this.mini) this.setMini(false); this.showTab(a.slice(4)); return; }
            switch (a) {
                case 'exit': this.app.exit(); return;
                case 'wwan': await this.toggleWwan(); return;
                case 'minimum': this.setMini(!this.mini); return;
                // Power Device: the modem's data on or off (no warning when turning it on: 7.6 asks only on Connect)
                case 'power': {
                    const w = this.wwan();
                    if (!w.present || this.pending) return;
                    if (w.on) { await this.toggleWwan(true); return; }
                    await this.setData(true);
                    this.paintSoon();
                    return;
                }
                case 'support': {
                    const url = 'https://www.verizon.com/support/';
                    if (typeof root.openGrimoireUrl === 'function') Promise.resolve().then(() => root.openGrimoireUrl(url)).catch(() => {});
                    return;
                }
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
                // strings 726-729: Statistics' Important Notice
                case 'notice': return this.message('Important Notice', 'The Session Logs should not be used to estimate or monitor data usage during your billing cycle as the bytes depicted on the "Session Log" are not representative of actual billable data usage when data is transmitted and received on the Verizon Wireless Network.\n\nPlease use the "My Verizon" button to view billed data usage.', 'info');
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

        /**
         * The kit's dialog for one of the program's templates, owned by its window and closed with the program; a
         * second open of the same one brings it forward.
         */
        async dialog(id, opts) {
            const open = this.dialogs.get(id);
            if (open && open.modal && open.modal.isConnected) { call('bringModalToFront', open.modal); return open; }
            let k = null;
            try { k = await kit(); } catch (_) { return null; }
            if (this.app.signal.aborted) return null;
            const close = opts.close;
            const ctx = k.openDialog(Object.assign({ id, owner: this.m && !this.m.classList.contains('hidden') ? this.m : null, icon: `${A}/vzaccess-16.png`, bareCaption: true }, opts, {
                close: (c) => { this.dialogs.delete(id); if (typeof close === 'function') close(c); }
            }));
            if (!ctx) return null;
            ctx.modal.classList.add('vz-dlg');
            this.dialogs.set(id, ctx);
            return ctx;
        }

        /** Warning! (VZAMres dialog 465): before a connection, unless "Don't show this message again" was ticked. */
        connectWarning() {
            return new Promise((resolve) => {
                let answer = false;
                void this.dialog('vzAccessWarning', {
                    key: 'vzam:465',
                    overrides: { 464: { image: '/static_images/vista-icons/msgbox-warning-32.png' } },
                    init: (ctx) => {
                        ctx.html(1009, '<p>ATTENTION</p><p>You are about to establish a Mobile Broadband or NationalAccess connection.&nbsp; Charges apply in accordance with your subscription to Verizon Wireless\' NationalAccess/Mobile Broadband.</p>'
                            + '<p>To see our current pricing for Mobile Broadband, please visit <a class="vz-dlg-url" tabindex="0">http://www.verizonwireless.com/b2c/mobileoptions</a></p>');
                        const a = ctx.holder(1009).querySelector('.vz-dlg-url');
                        a.addEventListener('click', () => { if (typeof root.openGrimoireUrl === 'function') Promise.resolve().then(() => root.openGrimoireUrl('https://www.verizon.com/plans/')).catch(() => {}); });
                    },
                    ok: (ctx) => {
                        answer = true;
                        if (ctx.get(466)) writeJson(PREFS_KEY, Object.assign(readJson(PREFS_KEY, {}), { noConnectWarning: true }));
                    },
                    close: () => resolve(answer)
                }).then((ctx) => { if (!ctx) resolve(true); });
            });
        }

        /**
         * Usage (VZAMres dialog 498): 7.6 showed Verizon's page in it; here the estimate from the phone's own mobile
         * counters (kept from its last start, not a billing month), in 7.6's words. Strings 307, 311 when it cannot.
         */
        async usage() {
            const w = this.wwan();
            let text = '';
            if (!w.present) text = 'Device not available. A device is required to retrieve your usage information.';
            else if (!w.connected) text = 'This option is only available when you are connected to the Verizon network. Please click Connect and then try again.';
            else {
                const b = await this.linkBytes();
                if (!b) text = 'There was an error while attempting to retrieve your usage information.';
                else {
                    const d = new Date();
                    let h = d.getHours();
                    const ap = h >= 12 ? 'PM' : 'AM';
                    h = h % 12 || 12;
                    text = `Est as of ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(h)}:${pad(d.getMinutes())}${ap}: Data Usage: ${((b.rx + b.tx) / 1e9).toFixed(3)}GB.`;
                }
            }
            await this.dialog('vzAccessUsage', {
                key: 'vzam:498',
                init: (ctx) => { ctx.html(499, `<div class="vz-usage">${esc(text)}</div>`); }
            });
        }

        /** Preferences > Application (the User Guide's page): kept for this program. */
        async prefs() {
            if (typeof root.showConfirmationDialog !== 'function') return;
            const p = readJson(PREFS_KEY, {});
            const box = (id, label, on) => `<div class="win7"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><label for="${id}">${label}</label></div>`;
            const html = `<b>Application</b><br><br>${box('vzPrefStart', 'Run VZAccess Manager at Startup', p.runAtStartup !== false)}${box('vzPrefPopup', 'Show popup status windows by tray', p.popup !== false)}${box('vzPrefWarn', 'Show the charges warning before connecting', !p.noConnectWarning)}`;
            let dlg = null;
            const r = await root.showConfirmationDialog(html, [{ text: 'OK', value: true }, { text: 'Cancel', value: false }], null, { title: 'Preferences', icon: 'fas fa-info-circle', onDialogReady: () => { dlg = doc.getElementById('confirmationDialog'); } });
            if (!r || !dlg) return;
            const v = (id) => { const e = doc.getElementById(id); return !!(e && e.checked); };
            // runAtStartup: the desktop puts VZAccess Manager in the tray on a Verizon connection (androidTrayProviders.js)
            writeJson(PREFS_KEY, Object.assign(p, { runAtStartup: v('vzPrefStart'), popup: v('vzPrefPopup'), noConnectWarning: !v('vzPrefWarn') }));
        }

        /** The log's sessions that pass Session Log Filter. */
        logRows() {
            const f = this.logFilter || {};
            return readJson(LOG_KEY, []).filter((r) => r && (!f.connection || r.connection === f.connection)
                && (!f.device || (r.device || '') === f.device)
                && (!f.from || r.start >= f.from) && (!f.to || r.start < f.to + 86400000));
        }

        /** Session Log (VZAMres dialog 428): the sessions, their totals, Export, Clear, Filter. */
        async sessionLog() {
            const ctx = await this.dialog('vzAccessSessionLog', {
                key: 'vzam:428',
                buttons: {
                    503: () => void this.exportLog(),
                    504: (c) => void this.clearLog(c),
                    505: () => void this.logFilterDialog()
                },
                close: () => { this.logCtx = null; },
                init: (c) => {
                    const lv = c.holder(415);
                    const head = lv.querySelector('.vdt-lv-header');
                    head.innerHTML = LOG_COLS.map(([t, right], i) => `<span class="vdt-lv-col vz-c${i}${right ? ' vz-r' : ''}">${esc(t)}</span>`).join('');
                    // the list's selection (one row, as the list view's)
                    lv.addEventListener('click', (ev) => {
                        const row = ev.target.closest('.vdt-lv-row');
                        lv.querySelectorAll('.vdt-lv-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
                        if (row) row.classList.add('is-selected');
                    });
                    const note = c.holder(1213);
                    note.classList.add('vz-dlg-link');
                    note.tabIndex = 0;
                    const notice = () => void this.message('Important Notice', [
                        'The Session Logs should not be used to estimate or monitor data usage during your billing cycle. Please use the Usage button in the Network Tab to view estimated data usage for your current billing cycle.',
                        "The Session Log displays the 'Bytes Sent' and 'Bytes Received' from either the Mobile Broadband device or your computer\u2019s operating system and will differ from the information displayed from the 'Usage ' button. The bytes depicted on the 'Session Log' are not representative of actual billable data usage when data is transmitted and received on the Verizon Wireless Network. Additionally, the Session Log may contain information for multiple Mobile Broadband devices or may not include data usage in certain scenarios such as when the Mobile Broadband device is used on a different computer or VZAccess Manager is not used to enable the Mobile Broadband network connection (for example LAN mode or when an alternative interface/application is used)."
                    ].join('\n\n'), 'info');
                    note.addEventListener('click', notice);
                    note.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); notice(); } });
                }
            });
            if (!ctx) return;
            this.logCtx = ctx;
            this.fillLog(ctx);
        }

        fillLog(ctx) {
            const lv = ctx.holder(415);
            if (!lv) return;
            const rows = this.logRows();
            const all = readJson(LOG_KEY, []);
            const body = lv.querySelector('.vdt-lv-body');
            body.innerHTML = rows.map((r) => {
                const cells = [r.connection || 'Verizon Wireless - VZAccess', whenText(r.start), hmsShort(r.end - r.start), kbText(r.rx), kbText(r.tx), kbText((r.rx || 0) + (r.tx || 0))];
                return `<div class="vdt-lv-row" role="option">${cells.map((v, i) => `<span class="vz-c${i}${LOG_COLS[i][1] ? ' vz-r' : ''}">${esc(v)}</span>`).join('')}</div>`;
            }).join('');
            const bytes = rows.reduce((n, r) => n + (r.rx || 0) + (r.tx || 0), 0);
            const ms = rows.reduce((n, r) => n + Math.max(0, r.end - r.start), 0);
            // string 'X sessions, X KB, duration: X' with 7.6's trailing " *" (the Important Notice)
            ctx.text(1113, `${rows.length} sessions, ${kbText(bytes)}, duration: ${hmShort(ms)} *`);
            ctx.enable(503, rows.length > 0);
            ctx.enable(504, all.length > 0);
            ctx.enable(505, all.length > 0);
        }

        async clearLog(ctx) {
            if (typeof root.showConfirmationDialog !== 'function') return;
            const yes = await root.showConfirmationDialog('Are you sure you want to clear the entire session log?', [{ text: 'Yes', value: true }, { text: 'No', value: false }], null, { title: 'VZAccess Manager', icon: 'fas fa-question-circle' });
            if (!yes) return;
            writeJson(LOG_KEY, []);
            this.logFilter = null;
            this.fillLog(ctx);
        }

        /** Export: the log (as filtered) to a .csv in Melaton's file system, through Save As. */
        async exportLog() {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            const rows = this.logRows();
            const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
            const csv = [LOG_COLS.map((c) => q(c[0])).join(',')].concat(rows.map((r) => [r.connection || '', whenText(r.start), hmsShort(r.end - r.start), r.rx || 0, r.tx || 0, (r.rx || 0) + (r.tx || 0)].map(q).join(','))).join('\r\n');
            const vfs = root.vfsClient;
            await root.studioOpenFolderDialog('save', {
                startPath: '/',
                host: {
                    title: 'Export',
                    typeLabel: 'CSV (Comma delimited) (*.csv)',
                    acceptType: 'user-file',
                    suggestName: () => 'SessionLog.csv',
                    onSave: async (info) => {
                        let name = String(info.name || '').trim();
                        if (!name || !vfs || typeof vfs.uploadFile !== 'function') return false;
                        if (!/\.csv$/i.test(name)) name += '.csv';
                        const bytes = new TextEncoder().encode(csv);
                        let bin = '';
                        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                        try { await vfs.uploadFile(info.path || '/', btoa(bin), name, 'text/csv'); return true; } catch (err) {
                            await this.message('VZAccess Manager', `Cannot save ${name}.\n${(err && err.message) || ''}`, 'warning');
                            return false;
                        }
                    }
                }
            });
        }

        /** Session Log Filter (VZAMres dialog 540): by connection, device and date. */
        async logFilterDialog() {
            const all = readJson(LOG_KEY, []);
            const uniq = (k) => Array.from(new Set(all.map((r) => r[k] || '').filter(Boolean)));
            const f = this.logFilter || {};
            await this.dialog('vzAccessLogFilter', {
                key: 'vzam:540',
                owner: this.logCtx ? this.logCtx.modal : null,
                init: (ctx) => {
                    const conns = uniq('connection');
                    const devs = uniq('device');
                    ctx.options(1065, conns, f.connection || conns[0] || '');
                    ctx.options(1067, devs, f.device || devs[0] || '');
                    ctx.set(1020, !!f.connection);
                    ctx.set(1021, !!f.device);
                    ctx.set(1022, !!(f.from || f.to));
                    const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
                    const first = all.length ? Math.min(...all.map((r) => r.start)) : Date.now();
                    ctx.set(1069, day(f.from || first));
                    ctx.set(1071, day(f.to || Date.now()));
                    const sync = () => {
                        ctx.enable(1065, !!ctx.get(1020) && conns.length > 0);
                        ctx.enable(1067, !!ctx.get(1021) && devs.length > 0);
                        ctx.enable(1069, !!ctx.get(1022));
                        ctx.enable(1071, !!ctx.get(1022));
                    };
                    [1020, 1021, 1022].forEach((id) => ctx.on(id, 'change', sync));
                    sync();
                },
                ok: (ctx) => {
                    const d = (id) => { const v = ctx.get(id); return v instanceof Date ? v.getTime() : 0; };
                    this.logFilter = {
                        connection: ctx.get(1020) ? ctx.get(1065) || '' : '',
                        device: ctx.get(1021) ? ctx.get(1067) || '' : '',
                        from: ctx.get(1022) ? d(1069) : 0,
                        to: ctx.get(1022) ? d(1071) : 0
                    };
                    if (this.logCtx) this.fillLog(this.logCtx);
                }
            });
        }

        openTexts() {
            // Melaton's own Text Messages program does the writing (Melaton Messenger on the desktop)
            const apps = root.melatonApps;
            if (apps && typeof apps.launch === 'function') { void apps.launch({ packageId: 'messenger' }).catch(() => {}); }
        }

        /** The modem's facts (About's Hardware information, WWAN Device Info's first rows). */
        hardwareRows() {
            const w = this.wwan();
            const d = (this.hardware() || {}).device || {};
            if (!w.present) return [];
            return [
                ['Manufacturer', d.manufacturer || ''], ['Model', d.model || ''], ['Device', d.marketName || ''],
                ['Phone Number', phoneText(w.number)], ['Network', w.carrier || ''], ['Technology', w.type || ''],
                ['Signal', `${w.bars} of 4 bars`], ['Roaming', w.roaming ? 'Extended Network' : 'Home'],
                ['SIM', w.sim === 'ready' ? 'Ready' : (w.sim || '')]
            ];
        }

        /** About VZAccess Manager (VZAMres dialog 101): the version, Smith Micro's logo, the hardware information. */
        async about() {
            await this.dialog('vzAccessAbout', {
                key: 'vzam:101',
                overrides: { 425: { text: `Version ${VERSION}\r\nConsumer Release` } },
                init: (ctx) => {
                    ctx.html(387, `<img class="vz-about-logo" src="${A}/smithmicro-logo.png" alt="Smith Micro Software" draggable="false">`);
                    const lv = ctx.holder(386);
                    lv.classList.add('no-header');
                    const rows = this.hardwareRows().filter(([, v]) => v);
                    lv.querySelector('.vdt-lv-body').innerHTML = (rows.length ? rows.map(([k, v]) => `${k}: ${v}`) : ['Device not available'])
                        .map((t) => `<div class="vdt-lv-row" role="option"><span>${esc(t)}</span></div>`).join('');
                }
            });
        }

        /**
         * WWAN Device Info (Options > Diagnostics, or a double click on the device box): the modem, then its radio as
         * AndroidCellular reads it when this opens (DSApp claude/cell-metrics): network type and NR mode, carrier
         * aggregation, the LTE and NR signal figures, and the serving cells' band, channel and identities.
         */
        deviceInfo() {
            const ci = this.readCellInfo(true);
            const rows = this.hardwareRows();
            if (ci) {
                const lte = ci.lte || {};
                const nr = ci.nr || {};
                const cells = Array.isArray(ci.cells) ? ci.cells : [];
                const served = cells.filter((c) => c.registered);
                const list = (k) => served.map((c) => c[k]).filter((v) => v != null && v !== '');
                const bands = served.map((c) => (Array.isArray(c.bands) ? c.bands.map((b) => `${c.type === 'NR' ? 'n' : 'B'}${b}`).join('/') : '')).filter(Boolean);
                const bw = Array.isArray(ci.bandwidthsKhz) ? ci.bandwidthsKhz.map((k) => `${k / 1000} MHz`).join(' + ') : '';
                const add = (k, v) => { if (v != null && v !== '') rows.push([k, String(v)]); };
                add('Network Type', `${ci.rat || ''}${ci.nrMode ? ` (NR ${ci.nrMode === 'SA' ? 'Standalone' : 'Non-Standalone'})` : ''}`);
                add('Carrier Aggregation', ci.carrierAggregation == null ? '' : ci.carrierAggregation ? `Yes${bw ? ` (${bw})` : ''}` : `No${bw ? ` (${bw})` : ''}`);
                add('Frequency Range', ci.frequencyRange === 'FR2' ? 'FR2 (mmWave)' : ci.frequencyRange === 'FR1' ? 'FR1 (Sub-6 GHz)' : '');
                add('MCC-MNC', ci.mcc ? `${ci.mcc}-${ci.mnc || ''}` : '');
                add('LTE RSRP', dbm(lte.rsrp));
                add('LTE RSRQ', dbm(lte.rsrq, 'dB'));
                add('LTE SINR', dbm(lte.rssnr, 'dB'));
                add('LTE RSSI', dbm(lte.rssi));
                add('LTE CQI', lte.cqi);
                add('NR SS-RSRP', dbm(nr.ssRsrp));
                add('NR SS-RSRQ', dbm(nr.ssRsrq, 'dB'));
                add('NR SS-SINR', dbm(nr.ssSinr, 'dB'));
                add('NR CSI-RSRP', dbm(nr.csiRsrp));
                add('NR CSI-SINR', dbm(nr.csiSinr, 'dB'));
                if (ci.other) add(`${ci.other.type} Signal`, dbm(ci.other.dbm));
                add('Band', bands.join(', '));
                add('EARFCN', served.filter((c) => c.type === 'LTE').map((c) => c.earfcn).filter((v) => v != null).join(', '));
                add('NR-ARFCN', served.filter((c) => c.type === 'NR').map((c) => c.nrarfcn).filter((v) => v != null).join(', '));
                add('PCI', list('pci').join(', '));
                add('TAC', list('tac').join(', '));
                add('Cell ID', served.map((c) => c.ci != null ? c.ci : c.nci).filter((v) => v != null).join(', '));
                const miss = Array.isArray(ci.missing) ? ci.missing : [];
                if (miss.includes('location')) add('Cell Details', 'Not available (Dreamscape needs Location, and Location turned on)');
                if (miss.includes('phone')) add('Network Details', 'Not available (Dreamscape needs the Phone permission)');
            }
            if (!rows.length) rows.push(['Device', 'Device not available']);
            const old = doc.getElementById('vzAccessDeviceModal');
            if (old) {
                // open already: the new reading replaces the old
                const body = old.querySelector('.vz-props');
                if (body) body.outerHTML = this.propList(rows);
                call('bringModalToFront', old);
                return;
            }
            this.infoWindow('vzAccessDeviceModal', 'WWAN Device Info', this.propList(rows));
            this.paintSoon();
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
        if (running) {
            // a second start: the desktop's own tray start is a no-op, anything else shows the window
            if (!(app.args && app.args.tray)) running.show();
            app.exit();
            return;
        }
        if (typeof root.desktopAppCreateWindow !== 'function') { app.exit(); return; }
        const m = new Manager(app);
        running = m;
        app.onExit(() => { if (running === m) running = null; m.noteExit(); m.destroy(); });
    }

    /** The desktop left Verizon (androidTrayProviders.js): a copy only in the tray goes; an open window stays. */
    function leftVerizon() {
        if (running && running.trayOnly && !running.shown) running.app.exit();
    }

    root.melatonVZAccess = { start, leftVerizon, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('vzaccess', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
