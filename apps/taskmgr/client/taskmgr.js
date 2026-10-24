/**
 * Melaton Task Manager (Yozora #632), Vista's taskmgr.exe as a Melaton system package (apps/taskmgr).
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
    // "&End Task": the dialog templates' mnemonic markup
    const label = (t) => (root.vistaDialogTemplate ? root.vistaDialogTemplate.label(t) : esc(String(t).replace(/&/g, '')));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);

    const SPEEDS = { high: 500, normal: 1000, low: 4000, paused: 0 };
    const TABS = ['Applications', 'Processes', 'Services', 'Performance', 'Networking', 'Users'];
    // samples kept: 2 px each, enough to fill the widest graph a maximized window gives
    const HISTORY = 1200;

    // a Melaton window's program, as Vista would name it
    const IMAGES = [
        [/^explorerModal$|explorer/i, 'explorer.exe', 'Melaton Explorer'], [/paint/i, 'mspaint.exe', 'Paint'], [/notepad/i, 'notepad.exe', 'Notepad'],
        [/charmap/i, 'charmap.exe', 'Character Map'], [/calculator/i, 'calc.exe', 'Calculator'], [/dovecote/i, 'WinMail.exe', 'Dovecote'],
        [/snipping/i, 'SnippingTool.exe', 'Snipping Tool'], [/calendar/i, 'wincal.exe', 'Melaton Calendar'], [/contacts/i, 'wab.exe', 'Melaton Contacts'],
        [/soundrec/i, 'SoundRecorder.exe', 'Sound Recorder'], [/wordpad/i, 'wordpad.exe', 'WordPad'], [/taskmgr|taskmanager/i, 'taskmgr.exe', 'Melaton Task Manager'],
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
            this.ticks = 0;
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
            m.setAttribute('aria-label', 'Melaton Task Manager');
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span>Melaton Task Manager</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small wtm-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 tbp-client wtm-client">
                    <div class="naxt-menubar wtm-menubar" role="menubar" data-win32-menus>${['File', 'Options', 'View', 'Windows', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-wtm-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}</div>
                    <div class="wtm-etch"></div>
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
                root.programFaults.registerProgram(m.id, { name: 'Melaton Task Manager', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'taskmgr' }) });
            }
            this.applyOnTop();
            // a resize lays the page out again at once (Performance and Networking scale with the window)
            if (typeof ResizeObserver === 'function') {
                let raf = 0;
                this.resizer = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => this.render()); });
                this.resizer.observe(m.querySelector('.wtm-pane'));
            }
            this.showTab(this.tab);
        }

        menu(name) {
            switch (name) {
                case 'file': return [{ text: 'New Task (Run...)', action: 'new-task' }, { separator: true }, { text: 'Exit Task Manager', action: 'exit' }];
                case 'options': return [
                    { text: 'Always On Top', action: 'on-top', showIndicator: true, checked: reg('OnTop', true) !== false },
                    { text: 'Minimize On Use', action: 'min-on-use', showIndicator: true, checked: reg('MinOnUse', true) !== false },
                    { text: 'Hide When Minimized', action: 'hide-min', showIndicator: true, checked: reg('HideMin', false) === true },
                    // the Users tab's alone (the VM)
                    ...(this.tab === 5 ? [{ separator: true }, { text: 'Show Full Account Name', action: 'full-name', showIndicator: true, checked: reg('FullName', false) === true }] : [])
                ];
                case 'view': return [
                    { text: 'Refresh Now', action: 'refresh' },
                    { text: 'Update Speed', hasSubmenu: true, submenu: [['high', 'High'], ['normal', 'Normal'], ['low', 'Low'], ['paused', 'Paused']].map(([v, t]) => ({ text: t, action: `speed-${v}`, showIndicator: true, checked: this.speed === v })) },
                    ...(this.tab === 3 ? [{ separator: true }, { text: 'CPU History', hasSubmenu: true, submenu: [{ text: 'One Graph, All CPUs', action: 'cpu-one', showIndicator: true, checked: reg('OneGraph', false) === true }, { text: 'One Graph Per CPU', action: 'cpu-each', showIndicator: true, checked: reg('OneGraph', false) !== true }] }] : [])
                ];
                // the VM's order; Tile / Cascade arrange the selected task's window, or every task's
                case 'windows': return [
                    { text: 'Tile Horizontally', action: 'win-tile-h' },
                    { text: 'Tile Vertically', action: 'win-tile-v' },
                    { text: 'Minimize', action: 'win-min', disabled: !this.selApp },
                    { text: 'Maximize', action: 'win-max', disabled: !this.selApp },
                    { text: 'Cascade', action: 'win-cascade' },
                    { text: 'Bring To Front', action: 'win-front', disabled: !this.selApp }
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
                case 'hide-min': setReg({ HideMin: reg('HideMin', false) !== true }); return;
                case 'full-name': setReg({ FullName: reg('FullName', false) !== true }); this.render(); return;
                case 'win-tile-h': case 'win-tile-v': case 'win-cascade': {
                    const tb = root.taskbarSettings;
                    const list = win ? [win] : windows().filter((m) => m !== this.modal);
                    if (tb && tb.arrangeWindows) tb.arrangeWindows(a === 'win-cascade' ? 'cascade' : a === 'win-tile-h' ? 'stacked' : 'side', list);
                    return;
                }
                case 'win-front': if (win) this.switchTo(win); return;
                case 'win-min': if (win) call('minimizeModalProgrammatically', win); return;
                case 'win-max': if (win) { const b = win.querySelector('.maximize-btn'); if (b) b.click(); } return;
                case 'about': if (typeof root.openAboutMelatoninModal === 'function') root.openAboutMelatoninModal({ program: 'Melaton Task Manager' }); return;
                default:
            }
        }

        /**
         * Options > Always On Top: Vista's Task Manager sits over the other windows, but under the
         * Start menu (2700), its own menus and other menus (5000) and the lock screen. It was at
         * 2147482000, which put its File / Options / View menus under it.
         */
        applyOnTop() {
            const on = reg('OnTop', true) !== false;
            this.modal.classList.toggle('wtm-on-top', on);
            this.modal.style.zIndex = on ? '2690' : '';
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
                    this.ticks += 1;
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
            // the Windows menu is the Applications tab's alone (the VM's other tabs: File Options View Help)
            const wm = this.modal.querySelector('[data-wtm-menu="windows"]');
            if (wm) wm.hidden = this.tab !== 0;
            this.el('.wtm-pane').dataset.tab = String(this.tab);
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
            ['explorer.exe|Melaton Explorer', 'dwm.exe|Desktop Window Manager', 'taskmgr.exe|Melaton Task Manager'].forEach((x) => {
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
            // nothing picked yet: the first row is selected, as on the VM
            if (opts.onSel && opts.isSel && sorted.length && !sorted.some((r) => opts.isSel(r))) opts.onSel(opts.keyOf ? opts.keyOf(sorted[0]) : '');
                        // fixed column widths from the VM, an empty header item filling the rest
            const grid = `${cols.map((c) => c.w).join(' ')} minmax(0, 1fr)`;
            const align = (c) => (c.num ? ' is-num' : c.center ? ' is-center' : '');
            const head = cols.map((c) => `<button type="button" class="wtm-col${align(c)}${sort.key === c.key ? ` is-sorted ${sort.dir > 0 ? 'is-up' : 'is-down'}` : ''}" data-sort="${c.key}">${sort.key === c.key ? '<span class="wtm-arrow"></span>' : ''}${esc(c.t)}</button>`).join('') + '<span class="wtm-col wtm-col-rest"></span>';
            const body = sorted.map((r) => `<div class="wtm-row${opts.isSel && opts.isSel(r) ? ' is-sel' : ''}" data-k="${esc(opts.keyOf ? opts.keyOf(r) : '')}">${cols.map((c, i) => `<span class="${align(c).trim()}">${i === 0 && r.icon ? `<img src="${esc(r.icon)}" alt="">` : ''}${esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key])}</span>`).join('')}</div>`).join('');
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
            // the list stays the same element between polls: replacing it dropped the focus every second,
            // and the default push button's pulse follows the focus
            let list = host.querySelector('.wtm-list');
            if (!list) {
                host.innerHTML = '<div class="wtm-list" tabindex="0"><div class="wtm-head"></div><div class="wtm-body"></div></div>';
                list = host.querySelector('.wtm-list');
            }
            if (list.style.getPropertyValue('--cols') !== grid) list.style.setProperty('--cols', grid);
            const headEl = list.querySelector('.wtm-head');
            if (headEl.dataset.html !== head) { headEl.innerHTML = head; headEl.dataset.html = head; }
            const bodyEl = list.querySelector('.wtm-body');
            if (bodyEl.dataset.html !== body) { bodyEl.innerHTML = body; bodyEl.dataset.html = body; }
        }

        buttons(pane, list) {
            let bar = pane.querySelector('.wtm-buttons');
            if (!bar) {
                bar = doc.createElement('div');
                bar.className = 'wtm-buttons';
                pane.appendChild(bar);
                bar.addEventListener('click', (ev) => { const b = ev.target.closest('[data-b]'); if (b && !b.disabled) void this.button(b.dataset.b); });
            }
            // placed as the VM places them: from the page's right edge, 13 px up from its bottom
            const html = list.map((b) => (b.check ? `<label class="wtm-check"><input type="checkbox" data-c="${b.id}"${b.checked ? ' checked' : ''}${b.disabled ? ' disabled' : ''}><span>${esc(b.t)}</span></label>` : `<button type="button" class="tbp-ctl tbp-button wtm-btn" data-b="${b.id}" style="right:${b.r}px;width:${b.w}px"${b.disabled ? ' disabled' : ''}>${label(b.t)}</button>`)).join('');
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
            this.listView(pane, 'apps', [{ key: 'task', t: 'Task', w: '272px' }, { key: 'status', t: 'Status', w: '60px' }], list, {
                keyOf: (r) => r.key, isSel: (r) => r.key === this.selApp, onSel: (k) => { this.selApp = k; },
                onOpen: (k) => { const w = windows().find((x) => x.id === k); if (w) this.switchTo(w); }
            });
            const has = !!(this.selApp && list.some((r) => r.key === this.selApp));
            this.buttons(pane, [{ id: 'end-task', t: '&End Task', disabled: !has, r: 181, w: 78 }, { id: 'switch', t: '&Switch To', disabled: !has, r: 97, w: 78 }, { id: 'new-task', t: '&New Task...', r: 13, w: 78 }]);
        }

        renderProcs(pane) {
            const mine = this.melatonProcesses();
            const host = this.admin && this.snap && this.allUsers ? this.snap.processes.map((p) => ({ ...p, desc: p.command, host: true })) : [];
            const rows = mine.concat(host).map((p) => ({ ...p, key: p.melaton ? `m:${p.name}` : `h:${p.pid}` }));
            this.listView(pane, 'procs', [
                { key: 'name', t: 'Image Name', w: '91px' }, { key: 'user', t: 'User Name', w: '64px' }, { key: 'cpu', t: 'CPU', w: '33px', center: true, fmt: (v) => String(Math.round(v || 0)).padStart(2, '0') },
                { key: 'memKB', t: 'Memory (Private Working Set)', w: '70px', num: true, fmt: (v) => (v === null || v === undefined ? '' : kb(v)) }, { key: 'desc', t: 'Description', w: '74px' }
            ], rows, { keyOf: (r) => r.key, isSel: (r) => r.key === this.selPid, onSel: (k) => { this.selPid = k; } });
            const sel = rows.find((r) => r.key === this.selPid);
            const can = !!(sel && sel.melaton && !sel.system && sel.windows.length);
            this.buttons(pane, [
                { id: 'all', check: true, checked: this.allUsers && this.admin, disabled: !this.admin, t: 'Show processes from all users' },
                { id: 'end-proc', t: '&End Process', disabled: !can, r: 13, w: 97 }
            ]);
        }

        renderServices(pane) {
            const s = this.snap;
            const rows = s && s.services ? s.services.map((x) => ({ key: x.name, name: x.name, pid: x.pid || '', desc: x.script ? x.script.split('/').slice(-2).join('/') : '', status: x.status === 'online' ? 'Running' : x.status === 'stopped' ? 'Stopped' : x.status })) : [];
            this.listView(pane, 'svc', [{ key: 'name', t: 'Name', w: '80px' }, { key: 'pid', t: 'PID', w: '40px' }, { key: 'desc', t: 'Description', w: '80px' }, { key: 'status', t: 'Status', w: '53px' }, { key: 'group', t: 'Group', w: '79px' }], rows, {});
            this.buttons(pane, [{ id: 'services', t: '&Services...', disabled: true, r: 13, w: 97 }]);
            if (!this.admin) pane.querySelector('.wtm-list').insertAdjacentHTML('beforeend', '<div class="wtm-note">Only an administrator can see the server\'s services.</div>');
        }

        renderPerf(pane) {
            const s = this.snap;
            // the VM's page: group boxes, sunken meters and graphs, the figures on the dialog's rows.
            // Measured at 412x457 and 640x560: the history boxes run to 13 px from the right, the two
            // rows share the extra height, the figures keep their size under them.
            if (!pane.querySelector('.wtm-perf')) {
                const box = (r, title) => `<div class="wtm-box" data-r="${r}"><span class="wtm-box-title">${title}</span></div>`;
                pane.innerHTML = `<div class="wtm-perf">
                    ${box('cpu', 'CPU Usage')}${box('cpuh', 'CPU Usage History')}${box('mem', 'Memory')}${box('memh', 'Physical Memory Usage History')}
                    ${box('phys', 'Physical Memory (MB)')}${box('sys', 'System')}${box('kern', 'Kernel Memory (MB)')}
                    <canvas class="wtm-meter wtm-sunken" data-m="cpu" data-r="cpum"></canvas>
                    <canvas class="wtm-meter wtm-sunken" data-m="mem" data-r="memm"></canvas>
                    <div class="wtm-cores" data-r="cores"></div>
                    <canvas class="wtm-hist wtm-sunken" data-h="mem" data-r="memg"></canvas>
                    <div class="wtm-fig" data-f="phys" data-r="physf"></div>
                    <div class="wtm-fig" data-f="sys" data-r="sysf"></div>
                    <div class="wtm-fig" data-f="kern" data-r="kernf"></div>
                    <button type="button" class="tbp-ctl tbp-button wtm-btn wtm-resmon" data-r="resmon" disabled><u>R</u>esource Monitor...</button>
                </div>`;
            }
            this.layoutPerf(pane);
            const one = reg('OneGraph', false) === true;
            const cores = this.el('.wtm-cores');
            const n = one || !s ? 1 : s.cpu.cores.length;
            // one graph per CPU side by side, 6 px apart (the VM's two: 110 px each)
            if (cores.children.length !== n) cores.innerHTML = Array.from({ length: n }, (_, i) => `<canvas class="wtm-hist wtm-sunken" data-h="core" data-i="${i}"></canvas>`).join('');
            const cpu = s ? s.cpu.total : 0;
            const memPct = s ? ((s.memory.total - s.memory.available) / s.memory.total) * 100 : 0;
            this.drawMeter(pane.querySelector('[data-m="cpu"]'), cpu, `${Math.round(cpu)} %`);
            this.drawMeter(pane.querySelector('[data-m="mem"]'), memPct, s ? `${((s.memory.total - s.memory.available) / 1073741824).toFixed(2)} GB` : '');
            cores.querySelectorAll('canvas').forEach((c) => this.drawHist(c, one || !s ? [this.cpuHist] : [this.coreHist[Number(c.dataset.i)] || []]));
            this.drawHist(pane.querySelector('[data-h="mem"]'), [this.memHist], { color: '#0080ff' });
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

        /**
         * Networking, as the VM lays it out: a group box per adapter over the top (the VM's one is
         * 366x245) holding a sunken graph whose black left margin carries the yellow scale, the
         * adapter list under it (Adapter Name / Network Utilization / Link Speed / State).
         */
        /** Performance's places for the pane's size (pane coordinates; [left, top, right|width, height]). */
        layoutPerf(pane) {
            const dH = Math.max(0, pane.clientHeight - 345);
            const h = Math.floor(dH / 2);
            const L = {
                cpu: [15, 15, 'w90', 82 + h], cpuh: [120, 15, 'r13', 82 + h], mem: [15, 108 + h, 'w90', 82 + h], memh: [120, 108 + h, 'r13', 82 + h],
                phys: [15, 203 + dH, 'w170', 56], sys: [198, 203 + dH, 'w171', 89], kern: [15, 274 + dH, 'w170', 56],
                cpum: [23, 29, 'w72', 61 + h], memm: [24, 122 + h, 'w72', 61 + h], cores: [128, 29, 'r23', 60 + h], memg: [128, 122 + h, 'r22', 61 + h],
                physf: [24, 212 + dH, 'w151'], sysf: [207, 212 + dH, 'w151'], kernf: [24, 283 + dH, 'w151'], resmon: [199, 308 + dH, 'w168']
            };
            const page = pane.querySelector('.wtm-perf');
            const PW = pane.clientWidth;
            const key = `${dH}x${PW}`;
            if (!page || page.dataset.layout === key) return;
            page.dataset.layout = key;
            Object.entries(L).forEach(([r, [l, t, wr, ht]]) => {
                const el = pane.querySelector(`[data-r="${r}"]`);
                if (!el) return;
                el.style.left = `${l}px`;
                el.style.top = `${t}px`;
                // "r13": up to 13 px from the pane's right (a width, so canvases stretch too)
                el.style.width = `${wr[0] === 'w' ? Number(wr.slice(1)) : PW - l - Number(wr.slice(1))}px`;
                if (ht) el.style.height = `${ht}px`;
            });
            // the meters keep their drawing at the box's size (LED rows grow with it)
            pane.querySelectorAll('.wtm-meter').forEach((c) => { c.width = 68; c.height = 57 + h; });
        }

        renderNet(pane) {
            const s = this.snap;
            const nets = s ? s.network : [];
            const n = Math.max(1, nets.length);
            // the VM at 412x457 and 640x560: the graphs take three quarters of the extra height, the list
            // the rest; both run to 7 px from the right
            const dH = Math.max(0, pane.clientHeight - 345);
            const gH = 245 + Math.round(dH * 0.75);
            const lH = 78 + dH - Math.round(dH * 0.75);
            const lay = `${nets.length}:${dH}:${pane.clientWidth}`;
            if (!pane.querySelector('.wtm-net') || pane.querySelector('.wtm-net').dataset.n !== lay) {
                const gap = 6;
                const h = Math.floor((gH - (n - 1) * gap) / n);
                pane.innerHTML = `<div class="wtm-net" data-n="${lay}">${nets.map((a, i) => `
                    <div class="wtm-box" style="left:9px;top:${13 + i * (h + gap)}px;right:7px;height:${h}px"><span class="wtm-box-title">${esc(a.name)}</span></div>
                    <canvas class="wtm-hist wtm-sunken" data-net="${esc(a.name)}" style="left:15px;top:${27 + i * (h + gap)}px;width:${pane.clientWidth - 29}px;height:${h - 19}px"></canvas>`).join('')
                    || '<div class="wtm-note" style="left:9px;top:13px">Only an administrator can see the server\'s network adapters.</div>'}
                    <div class="wtm-net-table" style="top:${13 + gH + 7}px;height:${lH}px"></div></div>`;
            }
            pane.querySelectorAll('[data-net]').forEach((c) => this.drawNet(c, this.netHist[c.dataset.net] || []));
            const rows = nets.map((a) => ({ key: a.name, name: a.name, util: a.utilization, speed: a.speedMbps ? (a.speedMbps >= 1000 ? `${a.speedMbps / 1000} Gbps` : `${a.speedMbps} Mbps`) : '', state: a.state === 'up' ? 'Connected' : 'Disconnected' }));
            this.listView(pane.querySelector('.wtm-net-table'), 'net', [{ key: 'name', t: 'Adapter Name', w: '100px' }, { key: 'util', t: 'Network Utilization', w: '96px', num: true, fmt: (v) => `${Math.round(v || 0)} %` }, { key: 'speed', t: 'Link Speed', w: '60px', num: true }, { key: 'state', t: 'State', w: '90px', num: true }], rows, {});
        }

        /** An adapter's graph: the 42 px scale margin (1 % / 0.50 % / 0 %, scaled up as traffic grows), rows 31 px apart, columns 12 px. */
        drawNet(c, data) {
            const W = c.clientWidth - 2;
            const H = c.clientHeight - 2;
            if (W < 50 || H < 20) return;
            if (c.width !== W) c.width = W;
            if (c.height !== H) c.height = H;
            const x = c.getContext('2d');
            x.fillStyle = '#000';
            x.fillRect(0, 0, W, H);
            const peak = Math.max(0, ...data);
            const scale = [1, 5, 10, 25, 50, 100].find((v) => peak <= v) || 100;
            const L = 42;
            x.strokeStyle = '#008040';
            x.lineWidth = 1;
            x.beginPath();
            const shift = (this.ticks * 2) % 12;
            for (let gx = W - shift; gx > L; gx -= 12) { x.moveTo(Math.round(gx) + 0.5, 0); x.lineTo(Math.round(gx) + 0.5, H); }
            for (let gy = 4; gy < H; gy += 31) { x.moveTo(L, gy + 0.5); x.lineTo(W, gy + 0.5); }
            x.stroke();
            x.fillStyle = '#ffff00';
            // the scale's axis: a yellow line down the grid's left edge (the VM)
            x.fillRect(L, 0, 1, H);
            x.font = '11px Tahoma, sans-serif';
            x.textAlign = 'right';
            x.textBaseline = 'top';
            const pct = (v) => `${v < 1 ? v.toFixed(2) : v} %`;
            x.fillText(pct(scale), L - 1, 2);
            x.fillText(pct(scale / 2), L - 1, Math.round(H / 2) - 6);
            x.textBaseline = 'bottom';
            x.fillText('0 %', L - 1, H - 1);
            x.fillStyle = '#00ff00';
            let px0 = null;
            let py0 = null;
            for (let i = Math.max(0, data.length - Math.ceil((W - L) / 2) - 1); i < data.length; i += 1) {
                const px = W - 1 - (data.length - 1 - i) * 2;
                const py = Math.round(H - 1 - (Math.min(scale, data[i] || 0) / scale) * (H - 1));
                if (px0 !== null) {
                    const k = Math.max(Math.abs(px - px0), Math.abs(py - py0), 1);
                    for (let j = 0; j <= k; j += 1) x.fillRect(Math.round(px0 + ((px - px0) * j) / k), Math.round(py0 + ((py - py0) * j) / k), 1, 1);
                }
                px0 = px;
                py0 = py;
            }
        }

        renderUsers(pane) {
            const a = root.meletonAccounts;
            const short = (a && typeof a.name === 'function' && a.name()) || (root.localStorage && root.localStorage.getItem('username')) || 'User';
            // Options > Show Full Account Name: COMPUTER\user, as the VM shows it
            const name = reg('FullName', false) === true ? `${(this.snap && this.snap.host) || 'MELATON'}\\${short}` : short;
            // the console session has no client name (the VM)
            const host = '';
            this.listView(pane, 'users', [{ key: 'user', t: 'User', w: '81px' }, { key: 'id', t: 'ID', w: '35px', num: true }, { key: 'status', t: 'Status', w: '60px' }, { key: 'client', t: 'Client Name', w: '78px' }, { key: 'session', t: 'Session', w: '78px' }],
                [{ key: 'me', user: name, id: 1, status: 'Active', client: host, session: 'Console', icon: '/melaton-apps/taskmgr/assets/user.png' }], { isSel: () => true });
            this.buttons(pane, [{ id: 'disc', t: '&Disconnect', r: 204, w: 81 }, { id: 'logoff', t: '&Logoff', r: 119, w: 76 }, { id: 'msg', t: '&Send Message...', disabled: true, r: 13, w: 97 }]);
        }

        renderStatus() {
            const s = this.snap;
            const procs = this.melatonProcesses().length + (this.admin && s ? s.processes.length : 0);
            this.el('.wtm-st-procs').textContent = `Processes: ${procs}`;
            this.el('.wtm-st-cpu').textContent = `CPU Usage: ${s ? Math.round(s.cpu.total) : 0}%`;
            this.el('.wtm-st-mem').textContent = `Physical Memory: ${s ? Math.round(((s.memory.total - s.memory.available) / s.memory.total) * 100) : 0}%`;
        }

        // ---- drawing: Vista's green LED meter and the history grid ---------------------------------

        /**
         * The VM's LED meter (68x57): two 16 px columns at 17 and 34, dim dotted bars (#008000) on
         * the rows 6,7 9,10 ... 30,31, the lit share in solid #00ff00 pairs up from row 32, the figure
         * in green under them.
         */
        drawMeter(c, pct, label) {
            if (!c) return;
            const x = c.getContext('2d');
            const H = c.height;
            const bottom = H - 25;
            x.fillStyle = '#000';
            x.fillRect(0, 0, 68, H);
            const span = bottom - 5;
            const lit = Math.max(1, Math.round((Math.max(0, Math.min(100, pct)) / 100) * span));
            for (let y = 6; y <= bottom; y += 1) {
                const on = y >= bottom + 1 - lit && (bottom - y) % 3 !== 2;
                if (on) {
                    x.fillStyle = '#00ff00';
                    x.fillRect(17, y, 16, 1);
                    x.fillRect(34, y, 16, 1);
                } else if ((y - 6) % 3 !== 2 && y < bottom) {
                    x.fillStyle = '#008000';
                    for (let k = (y - 6) % 3; k < 16; k += 2) { x.fillRect(17 + k, y, 1, 1); x.fillRect(34 + k, y, 1, 1); }
                }
            }
            x.fillStyle = '#00ff00';
            x.font = '11px Tahoma, sans-serif';
            x.textAlign = 'center';
            x.textBaseline = 'alphabetic';
            x.fillText(label, 34, H - 6);
        }

        drawHist(c, series, opts = {}) {
            if (!c) return;
            // the drawing is the inside of the sunken frame (border and padding off)
            const sunk = c.classList.contains('wtm-sunken') ? 2 : 0;
            const r = c.getBoundingClientRect();
            const W = Math.max(10, Math.round((c.clientWidth || r.width || 100) - sunk));
            const H = Math.max(10, Math.round((c.clientHeight || r.height || 60) - sunk));
            if (c.width !== W) c.width = W;
            if (c.height !== H) c.height = H;
            const x = c.getContext('2d');
            x.imageSmoothingEnabled = false;
            x.fillStyle = '#000';
            x.fillRect(0, 0, W, H);
            // the grid scrolls left with the samples (Vista's)
            const shift = (this.ticks * 2) % 12;
            x.strokeStyle = '#008040';
            x.lineWidth = 1;
            x.beginPath();
            for (let gx = W - shift; gx > 0; gx -= 12) { x.moveTo(Math.round(gx) + 0.5, 0); x.lineTo(Math.round(gx) + 0.5, H); }
            // the VM's rows: 11 px down, then every 12
            for (let gy = 11; gy < H; gy += 12) { x.moveTo(0, gy + 0.5); x.lineTo(W, gy + 0.5); }
            x.stroke();
            let max = 100;
            if (opts.scale === 'auto') max = Math.max(1, ...series.flat().map((v) => Math.ceil(v)), 1) <= 1 ? 1 : 100;
            // GDI's aliased LineTo: whole pixels stepped along the longer axis, no antialiasing
            x.fillStyle = opts.color || '#00ff00';
            const plot = (x0, y0, x1, y1) => {
                const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
                for (let k = 0; k <= n; k += 1) x.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1);
            };
            series.forEach((data) => {
                if (!data || data.length < 2) return;
                const step = 2;
                const first = Math.max(0, data.length - 1 - Math.ceil(W / step));
                let px0 = null;
                let py0 = null;
                for (let i = first; i < data.length; i += 1) {
                    const px = W - 1 - (data.length - 1 - i) * step;
                    const py = Math.round((H - 1) - (Math.max(0, Math.min(max, data[i])) / max) * (H - 1));
                    if (px0 !== null) plot(px0, py0, px, py);
                    px0 = px;
                    py0 = py;
                }
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
                // the console session: Disconnect locks it, Logoff logs it off (taskmgr strings 3306-3311)
                case 'disc': {
                    const v = await call('showConfirmationDialog', '<p>Are you sure you want to disconnect the selected user(s)?</p>', [
                        { text: 'Disconnect user', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
                    ], null, { title: 'Melaton Task Manager', width: 400 });
                    if (v && root.desktopBoot && typeof root.desktopBoot.lockWorkstation === 'function') root.desktopBoot.lockWorkstation();
                    return;
                }
                case 'logoff': {
                    const v = await call('showConfirmationDialog', '<p>If you log off a user, their unsaved data might be lost.</p><p>Do you want to continue?</p>', [
                        { text: 'Log off user', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
                    ], null, { title: 'Melaton Task Manager', width: 400 });
                    if (v && typeof root.runWinlogonPower === 'function') void root.runWinlogonPower('logoff');
                    return;
                }
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
            ], null, { title: 'Melaton Task Manager', width: 420 });
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
            if (this.resizer) this.resizer.disconnect();
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
