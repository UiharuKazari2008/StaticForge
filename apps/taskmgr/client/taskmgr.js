/**
 * Windows Task Manager (Yozora #632), Vista's taskmgr.exe as a Melaton system package (apps/taskmgr).
 *
 *   Applications  the desktop's windows: End Task (their own close, so they may ask to save), Switch To,
 *                 New Task... (Run)
 *   Processes     Melaton's programs (one per window kind, image names as Vista's) and, for an
 *                 administrator, the host's real processes (taskmgr_snapshot: ps); End Process only
 *                 ends a Melaton program, never a host process
 *   Services      the server's pm2 processes (read-only)
 *   Performance   CPU Usage / CPU Usage History (per core), Memory / Physical Memory Usage History, and
 *                 Physical Memory, Kernel Memory, System figures from /proc (taskmgr_snapshot)
 *   Networking    each adapter's utilisation graph and table
 *   Users         the person signed in to this desktop
 *   the status bar  Processes, CPU Usage, Physical Memory; View > Update Speed (High 0.5 s, Normal 1 s,
 *                 Low 4 s, Paused)
 *
 *   melatonApps.define('taskmgr', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\TaskManager';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const ICON16 = '/static_images/app_icons/16/vista-task-manager.webp';
    const ICON24 = '/static_images/app_icons/24/vista-task-manager.webp';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);

    const SPEEDS = { high: 500, normal: 1000, low: 4000, paused: 0 };
    const TABS = ['Applications', 'Processes', 'Services', 'Performance', 'Networking', 'Users'];
    const HISTORY = 120;

    // a Melaton window's program, as Vista would name it
    const IMAGES = [
        [/^explorerModal$|explorer/i, 'explorer.exe', 'Melaton Explorer'], [/paint/i, 'mspaint.exe', 'Paint'], [/notepad/i, 'notepad.exe', 'Notepad'],
        [/charmap/i, 'charmap.exe', 'Character Map'], [/calculator/i, 'calc.exe', 'Calculator'], [/dovecote/i, 'WinMail.exe', 'Dovecote'],
        [/snipping/i, 'SnippingTool.exe', 'Snipping Tool'], [/calendar/i, 'wincal.exe', 'Windows Calendar'], [/contacts/i, 'wab.exe', 'Windows Contacts'],
        [/soundrec/i, 'SoundRecorder.exe', 'Sound Recorder'], [/wordpad/i, 'wordpad.exe', 'WordPad'], [/taskmgr|taskmanager/i, 'taskmgr.exe', 'Windows Task Manager'],
        [/controlpanel|cpl/i, 'control.exe', 'Control Panel'], [/media/i, 'wmplayer.exe', 'Windows Media Player'], [/studio/i, 'studio.exe', 'Studio'],
        [/gallery/i, 'WindowsPhotoGallery.exe', 'Photo Gallery'], [/ledge/i, 'ledge.exe', 'Ledge'], [/alarm/i, 'alarm.exe', 'Alarm Clock'],
        [/welcome/i, 'oobe.exe', 'Welcome Center'], [/regedit|config/i, 'regedit.exe', 'Registry Editor'], [/games/i, 'games.exe', 'Games']
    ];

    function imageOf(m) {
        const id = `${m.dataset.windowIdentifier || ''} ${m.id || ''} ${m.dataset.melatonApp || ''}`;
        const hit = IMAGES.find(([re]) => re.test(id));
        if (hit) return { image: hit[1], desc: hit[2] };
        const t = titleOf(m);
        const base = (m.dataset.melatonApp || m.dataset.windowIdentifier || m.id || 'program').replace(/^melatonApp-/, '').replace(/Modal.*$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'program';
        return { image: `${base}.exe`, desc: t };
    }

    const titleOf = (m) => ((m.querySelector('.modal-window-title-main span, .modal-window-title span') || {}).textContent || m.getAttribute('aria-label') || '').trim();

    /** The desktop's windows (Vista's Applications: top-level windows with a caption). */
    function windows() {
        return Array.from(doc.querySelectorAll('body > .modal')).filter((m) => !m.classList.contains('hidden') && !m.classList.contains('closing')
            && !m.classList.contains('vdt-window') && m.querySelector('.modal-window-title') && titleOf(m) && !m.classList.contains('snip-overlay'));
    }

    const kb = (n) => `${Math.round(n).toLocaleString('en-US')} K`;
    const mb = (b) => Math.round(b / 1048576).toLocaleString('en-US');
    function upTime(sec) {
        const d = Math.floor(sec / 86400);
        const h = Math.floor(sec / 3600) % 24;
        const m = Math.floor(sec / 60) % 60;
        const s = sec % 60;
        return `${d}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    class TaskManager {
        constructor(app) {
            this.app = app;
            this.tab = reg('Tab', 0);
            this.speed = reg('Speed', 'normal');
            this.allUsers = reg('AllUsers', false) === true;
            this.snap = null;
            this.cpuHist = [];
            this.coreHist = [];
            this.memHist = [];
            this.netHist = {};
            this.sort = { procs: { key: 'name', dir: 1 }, apps: { key: 'task', dir: 1 }, svc: { key: 'name', dir: 1 } };
            this.selPid = null;
            this.selApp = null;
            this.admin = (root.localStorage && root.localStorage.getItem('userType') === 'admin') || false;
            this.build();
            this.schedule();
            void this.poll();
        }

        build() {
            const m = doc.createElement('div');
            // a dialog-faced window: the property sheet's tabs and push buttons (taskbar-properties.css)
            m.className = 'modal hidden resizeable-window tbp-window wtm-window';
            m.dataset.vistaDialog = 'form';
            m.dataset.windowIdentifier = 'melatonTaskManager';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = ICON24;
            m.dataset.windowDefaultWidth = '420';
            m.dataset.windowDefaultHeight = '520';
            m.dataset.windowMinWidth = '380';
            m.dataset.windowMinHeight = '440';
            m.style.width = '420px';
            m.style.height = '520px';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'Windows Task Manager');
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span>Windows Task Manager</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small wtm-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 tbp-client wtm-client">
                    <div class="naxt-menubar wtm-menubar" role="menubar">${['File', 'Options', 'View', 'Windows', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-wtm-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}</div>
                    <div class="wtm-sheet">
                        <div class="tbp-tabs wtm-tabs" role="tablist">${TABS.map((t, i) => `<button type="button" class="tbp-tab" role="tab" data-tab="${i}">${t}</button>`).join('')}</div>
                        <div class="wtm-pane"></div>
                    </div>
                    <div class="wtm-status"><span class="wtm-st-procs"></span><span class="wtm-st-cpu"></span><span class="wtm-st-mem"></span></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.el = (q) => m.querySelector(q);
            m.querySelector('.wtm-close').addEventListener('click', () => this.app.exit());
            m.querySelector('.wtm-tabs').addEventListener('click', (ev) => { const t = ev.target.closest('[data-tab]'); if (t) this.showTab(Number(t.dataset.tab)); });
            m.querySelectorAll('[data-wtm-menu]').forEach((t) => {
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.wtmMenu); } }]
                });
            });
            m.addEventListener('keydown', (ev) => { if (ev.key === 'F5') { ev.preventDefault(); void this.poll(); } else if (ev.key === 'Delete' && this.tab === 1) { ev.preventDefault(); void this.endProcess(); } });
            // before openModal: an id-less window restores the shared 'unknown' geometry
            m.id = 'melatonTaskManagerModal';
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed) return;
                placed = true;
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: 'Windows Task Manager', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'taskmgr' }) });
            }
            this.applyOnTop();
            this.showTab(this.tab);
        }

        menu(name) {
            switch (name) {
                case 'file': return [{ text: 'New Task (Run...)', action: 'new-task' }, { separator: true }, { text: 'Exit Task Manager', action: 'exit' }];
                case 'options': return [
                    { text: 'Always On Top', action: 'on-top', showIndicator: true, checked: reg('OnTop', true) !== false },
                    { text: 'Minimize On Use', action: 'min-on-use', showIndicator: true, checked: reg('MinOnUse', true) !== false },
                    { text: 'Hide When Minimized', action: 'none', disabled: true },
                    { separator: true },
                    { text: 'Show Full Account Name', action: 'none', disabled: true }
                ];
                case 'view': return [
                    { text: 'Refresh Now', subtext: 'F5', action: 'refresh' },
                    { text: 'Update Speed', hasSubmenu: true, submenu: [['high', 'High'], ['normal', 'Normal'], ['low', 'Low'], ['paused', 'Paused']].map(([v, t]) => ({ text: t, action: `speed-${v}`, showIndicator: true, checked: this.speed === v })) },
                    ...(this.tab === 3 ? [{ separator: true }, { text: 'CPU History', hasSubmenu: true, submenu: [{ text: 'One Graph, All CPUs', action: 'cpu-one', showIndicator: true, checked: reg('OneGraph', false) === true }, { text: 'One Graph Per CPU', action: 'cpu-each', showIndicator: true, checked: reg('OneGraph', false) !== true }] }] : [])
                ];
                case 'windows': return [
                    { text: 'Bring To Front', action: 'win-front', disabled: !this.selApp },
                    { text: 'Minimize', action: 'win-min', disabled: !this.selApp },
                    { text: 'Maximize', action: 'win-max', disabled: !this.selApp }
                ];
                case 'help': return [{ text: 'About Task Manager', action: 'about' }];
                default: return [];
            }
        }

        async action(a) {
            if (a.startsWith('speed-')) { this.speed = a.slice(6); setReg({ Speed: this.speed }); this.schedule(); return; }
            const win = this.selApp && windows().find((x) => x.id === this.selApp);
            switch (a) {
                case 'new-task': if (root.featureLoader) await root.featureLoader.loadFeature('run'); if (root.runApplet) root.runApplet.open(); return;
                case 'exit': this.app.exit(); return;
                case 'on-top': setReg({ OnTop: reg('OnTop', true) === false }); this.applyOnTop(); return;
                case 'min-on-use': setReg({ MinOnUse: reg('MinOnUse', true) === false }); return;
                case 'refresh': await this.poll(); return;
                case 'cpu-one': setReg({ OneGraph: true }); this.render(); return;
                case 'cpu-each': setReg({ OneGraph: false }); this.render(); return;
                case 'win-front': if (win) this.switchTo(win); return;
                case 'win-min': if (win) call('minimizeModalProgrammatically', win); return;
                case 'win-max': if (win) { const b = win.querySelector('.maximize-btn'); if (b) b.click(); } return;
                case 'about': if (typeof root.openAboutMelatoninModal === 'function') root.openAboutMelatoninModal({ program: 'Windows Task Manager' }); return;
                default:
            }
        }

        /** Options > Always On Top: Vista's Task Manager sits over the other windows. */
        applyOnTop() {
            const on = reg('OnTop', true) !== false;
            this.modal.classList.toggle('wtm-on-top', on);
            this.modal.style.zIndex = on ? '2147482000' : '';
            if (!on) call('bringModalToFront', this.modal);
        }

        schedule() {
            clearInterval(this.timer);
            const ms = SPEEDS[this.speed];
            if (ms) this.timer = setInterval(() => void this.poll(), ms);
        }

        async poll() {
            if (this.polling) return;
            this.polling = true;
            try {
                if (this.admin && root.wsClient) {
                    try {
                        this.snap = await root.wsClient.sendMessage('taskmgr_snapshot', { services: this.tab === 2 || !this.snap }, false);
                        if (this.snap && this.snap.data) this.snap = this.snap.data;
                    } catch (err) {
                        // not an administrator after all, or the server is busy: Melaton's own view only
                        if (/admin/i.test(String(err && err.message))) this.admin = false;
                    }
                }
                const s = this.snap;
                if (s && s.cpu) {
                    this.cpuHist.push(s.cpu.total);
                    s.cpu.cores.forEach((v, i) => { (this.coreHist[i] = this.coreHist[i] || []).push(v); if (this.coreHist[i].length > HISTORY) this.coreHist[i].shift(); });
                    this.memHist.push(((s.memory.total - s.memory.available) / s.memory.total) * 100);
                    s.network.forEach((n) => { (this.netHist[n.name] = this.netHist[n.name] || []).push(n.utilization); if (this.netHist[n.name].length > HISTORY) this.netHist[n.name].shift(); });
                    if (this.cpuHist.length > HISTORY) this.cpuHist.shift();
                    if (this.memHist.length > HISTORY) this.memHist.shift();
                }
                this.render();
            } finally {
                this.polling = false;
            }
        }

        showTab(i) {
            this.tab = Math.max(0, Math.min(TABS.length - 1, i));
            setReg({ Tab: this.tab });
            this.modal.querySelectorAll('.wtm-tabs .tbp-tab').forEach((t, k) => t.classList.toggle('is-selected', k === this.tab));
            this.el('.wtm-pane').innerHTML = '';
            this.render();
        }

        // ---- the tabs ---------------------------------------------------------------------------

        render() {
            const pane = this.el('.wtm-pane');
            if (!pane) return;
            [this.renderApps, this.renderProcs, this.renderServices, this.renderPerf, this.renderNet, this.renderUsers][this.tab].call(this, pane);
            this.renderStatus();
        }

        melatonProcesses() {
            const byImage = new Map();
            windows().forEach((m) => {
                const { image, desc } = imageOf(m);
                const e = byImage.get(image) || { name: image, user: 'Melaton', cpu: 0, memKB: null, desc, windows: [], melaton: true };
                e.windows.push(m);
                byImage.set(image, e);
            });
            // the shell and the desktop window manager are always there
            ['explorer.exe|Melaton Explorer', 'dwm.exe|Desktop Window Manager', 'taskmgr.exe|Windows Task Manager'].forEach((x) => {
                const [n, d] = x.split('|');
                if (!byImage.has(n)) byImage.set(n, { name: n, user: 'Melaton', cpu: 0, memKB: null, desc: d, windows: [], melaton: true, system: true });
            });
            const heap = performance && performance.memory ? performance.memory.usedJSHeapSize : null;
            const dwm = byImage.get('dwm.exe');
            if (dwm && heap) dwm.memKB = heap / 1024;
            return [...byImage.values()];
        }

        listView(pane, key, cols, rows, opts = {}) {
            const sort = this.sort[key] || (this.sort[key] = { key: cols[0].key, dir: 1 });
            const sorted = rows.slice().sort((a, b) => {
                const va = a[sort.key];
                const vb = b[sort.key];
                if (typeof va === 'number' || typeof vb === 'number') return ((va || 0) - (vb || 0)) * sort.dir;
                return String(va || '').localeCompare(String(vb || '')) * sort.dir;
            });
            const old = pane.querySelector('.wtm-list');
            const scroll = old ? old.scrollTop : 0;
            const grid = cols.map((c) => c.w).join(' ');
            const html = `<div class="wtm-list" style="--cols:${grid}" tabindex="0">
                <div class="wtm-head">${cols.map((c) => `<button type="button" class="wtm-col${c.num ? ' is-num' : ''}${sort.key === c.key ? (sort.dir > 0 ? ' is-up' : ' is-down') : ''}" data-sort="${c.key}">${esc(c.t)}</button>`).join('')}</div>
                ${sorted.map((r) => `<div class="wtm-row${opts.isSel && opts.isSel(r) ? ' is-sel' : ''}" data-k="${esc(opts.keyOf ? opts.keyOf(r) : '')}">${cols.map((c, i) => `<span class="${c.num ? 'is-num' : ''}">${i === 0 && r.icon ? `<img src="${esc(r.icon)}" alt="">` : ''}${esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key])}</span>`).join('')}</div>`).join('')}
            </div>`;
            let host = pane.querySelector('.wtm-list-host');
            if (!host) {
                host = doc.createElement('div');
                host.className = 'wtm-list-host';
                pane.prepend(host);
                host.addEventListener('click', (ev) => {
                    const h = ev.target.closest('[data-sort]');
                    if (h) { const k = h.dataset.sort; this.sort[key] = { key: k, dir: this.sort[key].key === k ? -this.sort[key].dir : 1 }; this.render(); return; }
                    const row = ev.target.closest('.wtm-row');
                    if (row && opts.onSel) { opts.onSel(row.dataset.k); this.render(); }
                });
                host.addEventListener('dblclick', (ev) => { const row = ev.target.closest('.wtm-row'); if (row && opts.onOpen) opts.onOpen(row.dataset.k); });
            }
            host.innerHTML = html;
            host.querySelector('.wtm-list').scrollTop = scroll;
        }

        buttons(pane, list) {
            let bar = pane.querySelector('.wtm-buttons');
            if (!bar) {
                bar = doc.createElement('div');
                bar.className = 'wtm-buttons';
                pane.appendChild(bar);
                bar.addEventListener('click', (ev) => { const b = ev.target.closest('[data-b]'); if (b && !b.disabled) void this.button(b.dataset.b); });
            }
            const html = list.map((b) => (b.check ? `<label class="wtm-check"><input type="checkbox" data-c="${b.id}"${b.checked ? ' checked' : ''}> ${esc(b.t)}</label>` : `<button type="button" class="tbp-ctl tbp-button wtm-btn" data-b="${b.id}"${b.disabled ? ' disabled' : ''}>${esc(b.t)}</button>`)).join('');
            if (bar.dataset.html !== html) {
                bar.innerHTML = html;
                bar.dataset.html = html;
                const c = bar.querySelector('[data-c="all"]');
                if (c) c.addEventListener('change', () => { this.allUsers = c.checked; setReg({ AllUsers: this.allUsers }); this.render(); });
            }
        }

        renderApps(pane) {
            const list = windows().filter((m) => m !== this.modal).map((m) => ({
                key: m.id || (m.id = `wtmWin_${Math.random().toString(36).slice(2, 8)}`), task: titleOf(m), status: m.classList.contains('program-faulted') || m.classList.contains('not-responding') ? 'Not Responding' : 'Running',
                icon: (m.querySelector('.modal-window-title img') || {}).src || ''
            }));
            this.listView(pane, 'apps', [{ key: 'task', t: 'Task', w: 'minmax(0, 1fr)' }, { key: 'status', t: 'Status', w: '96px' }], list, {
                keyOf: (r) => r.key, isSel: (r) => r.key === this.selApp, onSel: (k) => { this.selApp = k; },
                onOpen: (k) => { const w = windows().find((x) => x.id === k); if (w) this.switchTo(w); }
            });
            const has = !!(this.selApp && list.some((r) => r.key === this.selApp));
            this.buttons(pane, [{ id: 'end-task', t: 'End Task', disabled: !has }, { id: 'switch', t: 'Switch To', disabled: !has }, { id: 'new-task', t: 'New Task...' }]);
        }

        renderProcs(pane) {
            const mine = this.melatonProcesses();
            const host = this.admin && this.snap && this.allUsers ? this.snap.processes.map((p) => ({ ...p, desc: p.command, host: true })) : [];
            const rows = mine.concat(host).map((p) => ({ ...p, key: p.melaton ? `m:${p.name}` : `h:${p.pid}` }));
            this.listView(pane, 'procs', [
                { key: 'name', t: 'Image Name', w: 'minmax(110px, 1.1fr)' }, { key: 'user', t: 'User Name', w: '72px' }, { key: 'cpu', t: 'CPU', w: '36px', num: true, fmt: (v) => String(Math.round(v || 0)).padStart(2, '0') },
                { key: 'memKB', t: 'Memory (...', w: '80px', num: true, fmt: (v) => (v === null || v === undefined ? '' : kb(v)) }, { key: 'desc', t: 'Description', w: 'minmax(80px, 1fr)' }
            ], rows, { keyOf: (r) => r.key, isSel: (r) => r.key === this.selPid, onSel: (k) => { this.selPid = k; } });
            const sel = rows.find((r) => r.key === this.selPid);
            const can = !!(sel && sel.melaton && !sel.system && sel.windows.length);
            this.buttons(pane, [
                { id: 'all', check: true, checked: this.allUsers && this.admin, t: this.admin ? 'Show processes from all users' : 'Show processes from all users (administrators)' },
                { id: 'end-proc', t: 'End Process', disabled: !can }
            ]);
            const c = pane.querySelector('[data-c="all"]');
            if (c) c.disabled = !this.admin;
        }

        renderServices(pane) {
            const s = this.snap;
            const rows = s && s.services ? s.services.map((x) => ({ key: x.name, name: x.name, pid: x.pid || '', desc: x.script ? x.script.split('/').slice(-2).join('/') : '', status: x.status === 'online' ? 'Running' : x.status === 'stopped' ? 'Stopped' : x.status })) : [];
            this.listView(pane, 'svc', [{ key: 'name', t: 'Name', w: 'minmax(90px, 1fr)' }, { key: 'pid', t: 'PID', w: '54px', num: true }, { key: 'desc', t: 'Description', w: 'minmax(90px, 1.2fr)' }, { key: 'status', t: 'Status', w: '70px' }], rows, {});
            this.buttons(pane, [{ id: 'services', t: 'Services...', disabled: true }]);
            if (!this.admin) pane.querySelector('.wtm-list').insertAdjacentHTML('beforeend', '<div class="wtm-note">Only an administrator can see the server\'s services.</div>');
        }

        renderPerf(pane) {
            const s = this.snap;
            if (!pane.querySelector('.wtm-perf')) {
                pane.innerHTML = `<div class="wtm-perf">
                    <fieldset class="wtm-box wtm-meter-box"><legend>CPU Usage</legend><canvas class="wtm-meter" data-m="cpu" width="72" height="88"></canvas></fieldset>
                    <fieldset class="wtm-box wtm-hist-box"><legend>CPU Usage History</legend><div class="wtm-cores"></div></fieldset>
                    <fieldset class="wtm-box wtm-meter-box"><legend>Memory</legend><canvas class="wtm-meter" data-m="mem" width="72" height="88"></canvas></fieldset>
                    <fieldset class="wtm-box wtm-hist-box"><legend>Physical Memory Usage History</legend><canvas class="wtm-hist" data-h="mem"></canvas></fieldset>
                    <div class="wtm-figs">
                        <fieldset class="wtm-box"><legend>Physical Memory (MB)</legend><div class="wtm-fig" data-f="phys"></div></fieldset>
                        <fieldset class="wtm-box"><legend>System</legend><div class="wtm-fig" data-f="sys"></div></fieldset>
                        <fieldset class="wtm-box"><legend>Kernel Memory (MB)</legend><div class="wtm-fig" data-f="kern"></div></fieldset>
                        <button type="button" class="tbp-ctl tbp-button wtm-btn wtm-resmon" disabled>Resource Monitor...</button>
                    </div>
                </div>`;
            }
            const one = reg('OneGraph', false) === true;
            const cores = this.el('.wtm-cores');
            const n = one || !s ? 1 : s.cpu.cores.length;
            if (cores.children.length !== n) cores.innerHTML = Array.from({ length: n }, (_, i) => `<canvas class="wtm-hist" data-h="core" data-i="${i}"></canvas>`).join('');
            const cpu = s ? s.cpu.total : 0;
            const memPct = s ? ((s.memory.total - s.memory.available) / s.memory.total) * 100 : 0;
            this.drawMeter(pane.querySelector('[data-m="cpu"]'), cpu, `${Math.round(cpu)} %`);
            this.drawMeter(pane.querySelector('[data-m="mem"]'), memPct, s ? `${((s.memory.total - s.memory.available) / 1073741824).toFixed(2)} GB` : '');
            cores.querySelectorAll('canvas').forEach((c) => this.drawHist(c, one || !s ? [this.cpuHist] : [this.coreHist[Number(c.dataset.i)] || []]));
            this.drawHist(pane.querySelector('[data-h="mem"]'), [this.memHist]);
            const fig = (f, rows) => { const e = pane.querySelector(`[data-f="${f}"]`); if (e) e.innerHTML = rows.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join(''); };
            if (s) {
                const mm = s.memory;
                fig('phys', [['Total', mb(mm.total)], ['Cached', mb(mm.cached)], ['Free', mb(mm.free)]]);
                fig('kern', [['Total', mb(mm.paged + mm.nonpaged)], ['Paged', mb(mm.paged)], ['Nonpaged', mb(mm.nonpaged)]]);
                fig('sys', [['Handles', mm.handles.toLocaleString('en-US')], ['Threads', s.threads.toLocaleString('en-US')], ['Processes', String(s.processes.length)], ['Up Time', upTime(s.uptimeSec)], ['Page File', `${mb(mm.swapTotal - mm.swapFree)}M / ${mb(mm.swapTotal)}M`]]);
            } else {
                const heap = performance && performance.memory;
                fig('phys', [['Total', heap ? mb(heap.jsHeapSizeLimit) : '-'], ['Cached', '-'], ['Free', heap ? mb(heap.jsHeapSizeLimit - heap.usedJSHeapSize) : '-']]);
                fig('kern', [['Total', '-'], ['Paged', '-'], ['Nonpaged', '-']]);
                fig('sys', [['Handles', '-'], ['Threads', '-'], ['Processes', String(this.melatonProcesses().length)], ['Up Time', upTime(Math.floor(performance.now() / 1000))], ['Page File', '-']]);
            }
        }

        renderNet(pane) {
            const s = this.snap;
            const nets = s ? s.network : [];
            if (!pane.querySelector('.wtm-net') || pane.querySelector('.wtm-net').dataset.n !== String(nets.length)) {
                pane.innerHTML = `<div class="wtm-net" data-n="${nets.length}">${nets.map((n) => `<fieldset class="wtm-box wtm-net-box"><legend>${esc(n.name)}</legend><canvas class="wtm-hist" data-net="${esc(n.name)}"></canvas><span class="wtm-net-scale">${n.speedMbps ? '100 %' : ''}</span></fieldset>`).join('') || '<div class="wtm-note">Only an administrator can see the server\'s network adapters.</div>'}</div>`;
            }
            pane.querySelectorAll('[data-net]').forEach((c) => this.drawHist(c, [this.netHist[c.dataset.net] || []], { scale: 'auto' }));
            const rows = nets.map((n) => ({ key: n.name, name: n.name, util: n.utilization, speed: n.speedMbps ? (n.speedMbps >= 1000 ? `${n.speedMbps / 1000} Gbps` : `${n.speedMbps} Mbps`) : '', state: n.state === 'up' ? 'Connected' : 'Disconnected' }));
            let tbl = pane.querySelector('.wtm-net-table');
            if (!tbl) { tbl = doc.createElement('div'); tbl.className = 'wtm-net-table'; pane.appendChild(tbl); }
            this.listView(tbl, 'net', [{ key: 'name', t: 'Adapter Name', w: 'minmax(0, 1fr)' }, { key: 'util', t: 'Network Utilization', w: '110px', num: true, fmt: (v) => `${(v || 0).toFixed(2)} %` }, { key: 'speed', t: 'Link Speed', w: '76px', num: true }, { key: 'state', t: 'State', w: '80px' }], rows, {});
        }

        renderUsers(pane) {
            const a = root.meletonAccounts;
            const name = (a && typeof a.name === 'function' && a.name()) || (root.localStorage && root.localStorage.getItem('username')) || 'User';
            const host = this.snap ? this.snap.host : (root.location && root.location.hostname) || 'Melaton';
            this.listView(pane, 'users', [{ key: 'user', t: 'User', w: 'minmax(0, 1fr)' }, { key: 'id', t: 'ID', w: '30px', num: true }, { key: 'status', t: 'Status', w: '60px' }, { key: 'client', t: 'Client Name', w: '96px' }, { key: 'session', t: 'Session', w: '64px' }],
                [{ key: 'me', user: name, id: 1, status: 'Active', client: host, session: 'Console', icon: '/static_images/app_icons/16/vista-user-accounts.webp' }], { isSel: () => true });
            this.buttons(pane, [{ id: 'disc', t: 'Disconnect', disabled: true }, { id: 'logoff', t: 'Logoff', disabled: true }, { id: 'msg', t: 'Send Message...', disabled: true }]);
        }

        renderStatus() {
            const s = this.snap;
            const procs = this.melatonProcesses().length + (this.admin && s ? s.processes.length : 0);
            this.el('.wtm-st-procs').textContent = `Processes: ${procs}`;
            this.el('.wtm-st-cpu').textContent = `CPU Usage: ${s ? Math.round(s.cpu.total) : 0}%`;
            this.el('.wtm-st-mem').textContent = `Physical Memory: ${s ? Math.round(((s.memory.total - s.memory.available) / s.memory.total) * 100) : 0}%`;
        }

        // ---- drawing: Vista's green LED meter and the history grid ---------------------------------

        drawMeter(c, pct, label) {
            if (!c) return;
            const x = c.getContext('2d');
            const W = c.width;
            const H = c.height;
            x.fillStyle = '#000';
            x.fillRect(0, 0, W, H);
            const rows = 22;
            const lit = Math.round((Math.max(0, Math.min(100, pct)) / 100) * rows);
            for (let r = 0; r < rows; r += 1) {
                const y = H - 18 - (r + 1) * 3;
                const on = r < lit;
                x.fillStyle = on ? '#00ff00' : '#006000';
                x.fillRect(W / 2 - 15, y, 13, 2);
                x.fillRect(W / 2 + 2, y, 13, 2);
            }
            x.fillStyle = '#00ff00';
            x.font = '11px Tahoma, sans-serif';
            x.textAlign = 'center';
            x.fillText(label, W / 2, H - 4);
        }

        drawHist(c, series, opts = {}) {
            if (!c) return;
            const r = c.getBoundingClientRect();
            const W = Math.max(10, Math.round(r.width || 100));
            const H = Math.max(10, Math.round(r.height || 60));
            if (c.width !== W) c.width = W;
            if (c.height !== H) c.height = H;
            const x = c.getContext('2d');
            x.fillStyle = '#000';
            x.fillRect(0, 0, W, H);
            // the grid scrolls left with the samples (Vista's)
            const shift = (this.cpuHist.length * 2) % 12;
            x.strokeStyle = '#008040';
            x.lineWidth = 1;
            x.beginPath();
            for (let gx = W - shift; gx > 0; gx -= 12) { x.moveTo(Math.round(gx) + 0.5, 0); x.lineTo(Math.round(gx) + 0.5, H); }
            for (let gy = H; gy > 0; gy -= 12) { x.moveTo(0, Math.round(gy) + 0.5); x.lineTo(W, Math.round(gy) + 0.5); }
            x.stroke();
            let max = 100;
            if (opts.scale === 'auto') max = Math.max(1, ...series.flat().map((v) => Math.ceil(v)), 1) <= 1 ? 1 : 100;
            series.forEach((data) => {
                if (!data || data.length < 2) return;
                x.strokeStyle = '#00ff00';
                x.beginPath();
                const step = 2;
                data.forEach((v, i) => {
                    const px = W - (data.length - 1 - i) * step;
                    const py = H - (Math.max(0, Math.min(max, v)) / max) * (H - 1) - 0.5;
                    if (i) x.lineTo(px, py); else x.moveTo(px, py);
                });
                x.stroke();
            });
        }

        // ---- the buttons ---------------------------------------------------------------------------

        async button(id) {
            const win = this.selApp && windows().find((x) => x.id === this.selApp);
            switch (id) {
                case 'end-task': if (win) this.endTask(win); return;
                case 'switch': if (win) this.switchTo(win); return;
                case 'new-task': await this.action('new-task'); return;
                case 'end-proc': await this.endProcess(); return;
                default:
            }
        }

        switchTo(win) {
            if (win.classList.contains('minimised')) call('restoreMinimizedModal', win);
            call('bringModalToFront', win);
            if (reg('MinOnUse', true) !== false) call('minimizeModalProgrammatically', this.modal);
        }

        /** End Task: the window's own close (it may ask to save), as Vista's WM_CLOSE. */
        endTask(win) {
            const close = win.querySelector('.modal-window-controls .close-btn, .modal-window-controls [title="Close"]');
            if (close) close.click();
            else call('closeModal', win);
            setTimeout(() => this.render(), 400);
        }

        /** End Process: Vista's warning, then every window of that Melaton program ends. */
        async endProcess() {
            const rows = this.melatonProcesses();
            const p = rows.find((r) => `m:${r.name}` === this.selPid);
            if (!p || p.system || !p.windows.length) return;
            const v = await call('showConfirmationDialog', `<p><b>Do you want to end "${esc(p.name)}"?</b></p><p>If an open program is associated with this process, it will close and you will lose any unsaved data.</p>`, [
                { text: 'End process', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
            ], null, { title: 'Windows Task Manager', width: 420 });
            if (!v) return;
            p.windows.forEach((w) => {
                // a program with a fault handler ends the program; otherwise the window goes, unsaved
                const reg2 = root.programFaults && root.programFaults.terminate;
                if (typeof reg2 === 'function' && reg2(w.id)) return;
                try { call('closeModal', w); } catch (_) { /* gone */ }
                setTimeout(() => w.remove(), 300);
            });
            this.selPid = null;
            setTimeout(() => this.render(), 400);
        }

        destroy() {
            clearInterval(this.timer);
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 300);
        }
    }

    let running = null;

    async function start(app) {
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        // the property sheet's tabs and push buttons (taskbar-properties.css) ride on the dialog templates
        if (root.featureLoader && !root.vistaDialogTemplate) { try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* unstyled sheet */ } }
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        const t = new TaskManager(app);
        running = t;
        app.onExit(() => { running = null; t.destroy(); });
    }

    root.melatonTaskManager = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('taskmgr', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
