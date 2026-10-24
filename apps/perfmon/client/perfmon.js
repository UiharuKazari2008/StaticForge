/**
 * Reliability and Performance Monitor (Yozora #632): Vista's perfmon.msc, an MMC console, over the
 * server Melaton runs on (perfmon_snapshot, administrators; modules/perfmonSnapshot.js).
 *
 *   the frame          MMC's rebar (menu bar with the console child's caption buttons, toolbar from
 *                      mmc.exe bitmap 202), the console tree (wdc.dll bitmap 120 icons), the status bar
 *   Reliability and Performance   the Resource View (wdc.dll's DirectUI page): Resource Overview's four
 *                      graphs (CPU, Disk, Network, Memory over 60 s), the CPU / Disk / Network / Memory
 *                      sections with their level squares and process lists, Learn More
 *   Performance Monitor           counters over time (% Processor Time to start)
 *   Reliability Monitor           the stability chart from Melaton's own events
 *   Data Collector Sets / Reports the folders, as on a fresh Vista
 *
 *   melatonApps.define('perfmon', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Reliability and Performance';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const ICON16 = '/static_images/app_icons/16/vista-reliability-performance.webp';
    const ICON24 = '/static_images/app_icons/24/vista-reliability-performance.webp';
    const A = '/melaton-apps/perfmon/assets';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const fmt = (n) => Math.round(n || 0).toLocaleString('en-US');
    const shortDay = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    const dayOf = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

    /**
     * The records by day, from the first day records began to today, with each day's System Stability
     * Index: failures weigh on it (application 1, Melaton and hardware 2, miscellaneous 1.5) and their
     * weight fades by a tenth a day, so the index climbs back toward 10 on quiet days.
     */
    function relDays(data) {
        const first = dayOf(data.first);
        const last = dayOf(Date.now());
        const days = [];
        for (let d = new Date(first); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push({ date: d, events: [], index: 10 });
        data.events.forEach((e) => {
            const i = Math.round((dayOf(e.t) - first) / 864e5);
            if (days[i]) days[i].events.push(e);
        });
        const W = { app: 1, hardware: 2, windows: 2, misc: 1.5 };
        let s = 0;
        days.forEach((d) => {
            s = s * 0.9 + d.events.reduce((t, e) => t + (W[e.cat] || 0), 0);
            d.index = 10 / (1 + 0.05 * s);
        });
        return days;
    }

    // relmon.dll's chart icons (group 202 error, 203 information, 204 warning), loaded once
    const relIcons = {};
    function relIcon(name, onload) {
        if (!relIcons[name]) {
            const img = new Image();
            img.src = `${A}/rel-${name}.png`;
            relIcons[name] = img;
        }
        const img = relIcons[name];
        if (!img.complete) img.addEventListener('load', onload, { once: true });
        return img;
    }

    // the console tree (wdc.dll string 201, 213, 205, Reliability Monitor, 209, 206; bitmap 120 icons)
    const TREE = [
        { id: 'root', name: 'Reliability and Performance', icon: 0, open: true, children: [
            { id: 'tools', name: 'Monitoring Tools', icon: 2, open: true, children: [
                { id: 'perf', name: 'Performance Monitor', icon: 1 },
                { id: 'rel', name: 'Reliability Monitor', icon: 18 }] },
            { id: 'dcs', name: 'Data Collector Sets', icon: 3, children: [
                { id: 'dcs-user', name: 'User Defined', icon: 4 }, { id: 'dcs-system', name: 'System', icon: 5 },
                { id: 'dcs-ets', name: 'Event Trace Sessions', icon: 6 }, { id: 'dcs-sets', name: 'Startup Event Trace Sessions', icon: 6 }] },
            { id: 'reports', name: 'Reports', icon: 10, children: [
                { id: 'rep-user', name: 'User Defined', icon: 8 }, { id: 'rep-system', name: 'System', icon: 9 }] }] }
    ];

    // Resource View's graphs: 60 one-second samples each
    const SAMPLES = 60;

    class PerfMon {
        constructor(app) {
            this.app = app;
            this.admin = (root.localStorage && root.localStorage.getItem('userType') === 'admin') || false;
            this.node = 'root';
            this.history = [];
            this.future = [];
            this.open = new Set(['root', 'tools']);
            this.expanded = new Set(reg('Expanded', ['overview']));
            this.running = true;
            this.snap = null;
            this.hist = { cpu: [], freq: [], disk: [], diskActive: [], net: [], netUtil: [], faults: [], mem: [] };
            this.sort = {};
            this.build();
            this.select('root', false);
            this.timer = setInterval(() => { if (this.running) void this.poll(); }, 1000);
            void this.poll();
        }

        build() {
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window pfm-window';
            m.dataset.windowIdentifier = 'melatonPerfmon';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = ICON24;
            m.dataset.windowDefaultWidth = '800';
            m.dataset.windowDefaultHeight = '600';
            m.dataset.windowMinWidth = '420';
            m.dataset.windowMinHeight = '300';
            m.style.width = '800px';
            m.style.height = '600px';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'Reliability and Performance Monitor');
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span>Reliability and Performance Monitor</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary maximize-btn btn-small" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small pfm-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 pfm-client">
                    <div class="pfm-rebar">
                        <div class="naxt-menubar pfm-menubar" role="menubar">
                            <span class="pfm-sysmenu"></span>
                            ${['File', 'Action', 'View', 'Favorites', 'Window', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-pfm-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}
                            <span class="pfm-mdi"><button type="button" class="pfm-mdi-min" title="Minimize"></button><button type="button" class="pfm-mdi-restore" title="Restore Down"></button><button type="button" class="pfm-mdi-close" title="Close"></button></span>
                        </div>
                        <div class="pfm-toolbar" role="toolbar"></div>
                    </div>
                    <div class="pfm-body">
                        <div class="pfm-tree" tabindex="0" role="tree"></div>
                        <div class="pfm-split"></div>
                        <div class="pfm-result"></div>
                    </div>
                    <div class="pfm-status"><span></span><span></span><span></span></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.el = (q) => m.querySelector(q);
            m.querySelector('.pfm-close').addEventListener('click', () => this.app.exit());
            m.querySelector('.pfm-mdi-close').addEventListener('click', () => this.app.exit());
            m.querySelector('.pfm-mdi-min').addEventListener('click', () => call('minimizeModalProgrammatically', m));
            m.querySelectorAll('[data-pfm-menu]').forEach((t) => {
                if (!root.contextMenu) return;
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.pfmMenu); } }]
                });
            });
            this.el('.pfm-tree').addEventListener('click', (ev) => {
                const tw = ev.target.closest('.pfm-twisty');
                const row = ev.target.closest('[data-node]');
                if (!row) return;
                if (tw) { this.toggle(row.dataset.node); return; }
                this.select(row.dataset.node, true);
            });
            this.el('.pfm-tree').addEventListener('dblclick', (ev) => { const row = ev.target.closest('[data-node]'); if (row) this.toggle(row.dataset.node); });
            this.el('.pfm-toolbar').addEventListener('click', (ev) => { const b = ev.target.closest('[data-tb]'); if (b && !b.disabled) void this.action(b.dataset.tb); });
            m.id = 'melatonPerfmonModal';
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
        }

        // ---- menus and the toolbar --------------------------------------------------------------

        menu(name) {
            switch (name) {
                case 'file': return [{ text: 'Exit', action: 'exit' }];
                case 'action': return [{ text: 'Refresh', action: 'refresh' }, { separator: true }, { text: 'Help', action: 'help' }];
                case 'view': return [
                    { text: 'Console Tree', action: 'tree', showIndicator: true, checked: !this.modal.classList.contains('no-tree') },
                    { separator: true }, { text: 'Refresh', subtext: 'F5', action: 'refresh' }];
                case 'favorites': return [{ text: 'Add to Favorites...', action: 'none', disabled: true }, { text: 'Organize Favorites...', action: 'none', disabled: true }];
                case 'window': return [{ text: '1 Reliability and Performance', action: 'none', showIndicator: true, checked: true }];
                case 'help': return [{ text: 'Help Topics', action: 'help' }, { separator: true }, { text: 'About Microsoft Management Console...'.replace('Microsoft', 'Xyridian'), action: 'about' }];
                default: return [];
            }
        }

        /**
         * The toolbar, per node as the VM's (mmc.exe bitmap 202: 0 back, 1 forward, 8 properties, 9 up
         * one level, 10 show/hide console tree, 12 print, 15 help, 16 export list, 17 show/hide action
         * pane; wdc.dll 122: 0 start, 1 stop).
         */
        renderToolbar() {
            const b = (id, strip, i, title, opts = {}) => `<button type="button" class="pfm-tb${opts.pressed ? ' is-pressed' : ''}" data-tb="${id}" title="${title}"${opts.disabled ? ' disabled' : ''}><span class="pfm-tb-icon is-${strip}" style="--i:${i}"></span></button>`;
            const sep = '<span class="pfm-tb-sep"></span>';
            const tree = b('tree', 'mmc', 10, 'Show/Hide Console Tree', { pressed: !this.modal.classList.contains('no-tree') });
            const tail = b('help', 'mmc', 15, 'Help') + b('actions', 'mmc', 17, 'Show/Hide Action Pane', { pressed: this.modal.classList.contains('has-actions') });
            let mid = '';
            if (this.node === 'root') mid = tree + sep + tail + sep + b('start', 'wdc', 0, 'Start', { disabled: this.running }) + b('stop', 'wdc', 1, 'Stop', { disabled: !this.running });
            else if (this.node === 'perf') mid = b('up', 'mmc', 9, 'Up One Level') + tree + sep + b('properties', 'mmc', 8, 'Properties') + b('print', 'mmc', 12, 'Print') + sep + tail;
            else if (this.node === 'rel') mid = b('up', 'mmc', 9, 'Up One Level') + tree + sep + tail;
            else mid = b('up', 'mmc', 9, 'Up One Level') + tree + sep + b('export', 'mmc', 16, 'Export List...') + sep + tail;
            const html = b('back', 'mmc', 0, 'Back', { disabled: !this.history.length }) + b('forward', 'mmc', 1, 'Forward', { disabled: !this.future.length }) + sep + mid;
            const tb = this.el('.pfm-toolbar');
            if (tb.dataset.html !== html) { tb.innerHTML = html; tb.dataset.html = html; }
        }

        /** The node above this one (Up One Level). */
        parentOf(id, list = TREE, parent = null) {
            for (const n of list) {
                if (n.id === id) return parent;
                const p = n.children && this.parentOf(id, n.children, n);
                if (p) return p;
            }
            return null;
        }

        async action(a) {
            switch (a) {
                case 'exit': this.app.exit(); return;
                case 'back': { const n = this.history.pop(); if (n) { this.future.push(this.node); this.select(n, false); } return; }
                case 'forward': { const n = this.future.pop(); if (n) { this.history.push(this.node); this.select(n, false); } return; }
                case 'tree': this.modal.classList.toggle('no-tree'); this.renderToolbar(); return;
                case 'actions': this.modal.classList.toggle('has-actions'); this.renderActions(); this.renderToolbar(); return;
                case 'up': { const p = this.parentOf(this.node); if (p) this.select(p.id, true); return; }
                case 'print': {
                    // the graph as it stands, on its own page (the browser's print dialog)
                    const c = this.el('.pfm-pm-canvas');
                    if (!c) return;
                    const f = doc.createElement('iframe');
                    f.style.cssText = 'position:fixed;width:0;height:0;border:0';
                    doc.body.appendChild(f);
                    f.contentDocument.write(`<img src="${c.toDataURL()}" style="max-width:100%">`);
                    f.contentDocument.close();
                    setTimeout(() => { try { f.contentWindow.print(); } catch (_) { /* no printing */ } setTimeout(() => f.remove(), 2000); }, 200);
                    return;
                }
                case 'export': {
                    // Export List...: the result pane's rows as tab-separated text, as MMC writes them
                    const n = this.find(this.node);
                    const rows = ['Name'].concat(((n && n.children) || []).map((k) => k.name));
                    const blob = new Blob([`${rows.join('\r\n')}\r\n`], { type: 'text/plain' });
                    const a2 = doc.createElement('a');
                    a2.href = URL.createObjectURL(blob);
                    a2.download = `${n ? n.name : 'list'}.txt`;
                    a2.click();
                    setTimeout(() => URL.revokeObjectURL(a2.href), 1000);
                    return;
                }
                case 'properties': {
                    const lg = this.el('.pfm-pm-legend');
                    if (lg) lg.focus();
                    return;
                }
                case 'refresh': await this.poll(); return;
                case 'start': this.running = true; this.renderToolbar(); return;
                case 'stop': this.running = false; this.renderToolbar(); return;
                case 'help': if (root.melatonApps) root.melatonApps.launch({ packageId: 'help', args: { topic: 'perfmon' } }); return;
                case 'about': if (typeof root.openAboutMelatoninModal === 'function') root.openAboutMelatoninModal({ program: 'Reliability and Performance Monitor' }); return;
                default:
            }
        }

        /** MMC's Action pane: the node's name over Refresh and Help (Show/Hide Action Pane). */
        renderActions() {
            let pane = this.el('.pfm-actions');
            if (!this.modal.classList.contains('has-actions')) { if (pane) pane.remove(); return; }
            if (!pane) {
                pane = doc.createElement('div');
                pane.className = 'pfm-actions';
                this.el('.pfm-body').appendChild(pane);
                pane.addEventListener('click', (ev) => { const a = ev.target.closest('[data-act]'); if (a) void this.action(a.dataset.act); });
            }
            const n = this.find(this.node);
            pane.innerHTML = `<div class="pfm-act-head">Actions</div><div class="pfm-act-group">${esc(n ? n.name : '')}</div>
                <div class="pfm-act" data-act="refresh">Refresh</div><div class="pfm-act" data-act="help">Help</div>`;
        }

        // ---- the console tree -------------------------------------------------------------------

        find(id, list = TREE) {
            for (const n of list) {
                if (n.id === id) return n;
                const c = n.children && this.find(id, n.children);
                if (c) return c;
            }
            return null;
        }

        renderTree() {
            const rows = [];
            const walk = (list, depth) => list.forEach((n) => {
                const kids = n.children && n.children.length;
                const open = this.open.has(n.id);
                // the console root has no twisty (MMC's); every level below indents 19 px
                rows.push(`<div class="pfm-node${n.id === this.node ? ' is-selected' : ''}" data-node="${n.id}" role="treeitem" style="padding-left:${4 + depth * 19}px">
                    ${depth ? `<span class="pfm-twisty${kids ? (open ? ' is-open' : ' is-closed') : ''}"></span>` : ''}<span class="pfm-node-icon" style="--i:${n.icon}"></span><span class="pfm-node-name">${esc(n.name)}</span></div>`);
                if (kids && open) walk(n.children, depth + 1);
            });
            walk(TREE, 0);
            this.el('.pfm-tree').innerHTML = rows.join('');
        }

        toggle(id) {
            if (this.open.has(id)) this.open.delete(id); else this.open.add(id);
            this.renderTree();
        }

        select(id, record) {
            if (record && id !== this.node) { this.history.push(this.node); this.future = []; }
            this.node = id;
            this.closeRelPop();
            this.renderTree();
            this.renderToolbar();
            this.renderActions();
            this.el('.pfm-result').innerHTML = '';
            this.render();
        }

        // ---- data -------------------------------------------------------------------------------

        async poll() {
            if (this.polling) return;
            this.polling = true;
            try {
                if (this.admin && root.wsClient) {
                    try {
                        let s = await root.wsClient.sendMessage('perfmon_snapshot', {}, false);
                        if (s && s.data) s = s.data;
                        this.snap = s;
                    } catch (err) {
                        if (/admin/i.test(String(err && err.message))) this.admin = false;
                    }
                }
                const s = this.snap;
                if (s) {
                    const used = ((s.memory.total - s.memory.available) / s.memory.total) * 100;
                    const bps = (s.adapters || []).reduce((t, a) => t + (a.bitsPerSecond || 0), 0);
                    const util = (s.adapters || []).reduce((t, a) => Math.max(t, a.utilization || 0), 0);
                    this.push('cpu', s.cpu.total); this.push('freq', 100);
                    this.push('disk', s.disk.bytesPerSec); this.push('diskActive', s.disk.activeTime);
                    this.push('net', bps); this.push('netUtil', util);
                    this.push('faults', s.hardFaults); this.push('mem', used);
                }
                this.render();
            } finally {
                this.polling = false;
            }
        }

        push(k, v) {
            const h = this.hist[k];
            h.push(v);
            if (h.length > SAMPLES) h.shift();
        }

        // ---- the result pane -----------------------------------------------------------------------

        render() {
            const pane = this.el('.pfm-result');
            if (!pane) return;
            if (this.node === 'root') this.renderResourceView(pane);
            else if (this.node === 'perf') this.renderPerfMonitor(pane);
            else if (this.node === 'rel') this.renderReliability(pane);
            else this.renderFolder(pane);
            this.renderStatus();
        }

        renderStatus() {
            const spans = this.modal.querySelectorAll('.pfm-status span');
            spans.forEach((s) => { s.textContent = ''; });
        }

        /**
         * Resource View (wdc.dll UIFILE 1000): Resource Overview's graphs, then CPU / Disk / Network /
         * Memory bars with their green and blue level squares (bitmaps 10100-10110, 10200-10210), each
         * opening onto its process list, and Learn More.
         */
        renderResourceView(pane) {
            const s = this.snap;
            if (!pane.querySelector('.pfm-rv')) {
                const bar = (id, title, extra = '') => `<div class="pfm-bar${this.expanded.has(id) ? ' is-open' : ''}" data-sec="${id}"><span class="pfm-bar-title">${title}</span>${extra}<button type="button" class="pfm-bar-btn" aria-label="Expand"></button></div>`;
                const levels = (id) => `<span class="pfm-level" data-lv="${id}-a"></span><span class="pfm-bar-value" data-v="${id}-a"></span><span class="pfm-level is-blue" data-lv="${id}-b"></span><span class="pfm-bar-value is-wide" data-v="${id}-b"></span>`;
                const graph = (id, title, max, bottomRight) => `<div class="pfm-graphbox" data-g="${id}">
                        <div class="pfm-gtop"><span>${title}</span><span data-gmax="${id}">${max}</span></div>
                        <div class="pfm-gwrap"><canvas class="pfm-graph" width="108" height="100"></canvas><span class="pfm-gscale"></span></div>
                        <div class="pfm-gbottom"><span>${id === 'cpu' ? '60 Seconds' : ''}</span><span>${bottomRight}</span></div>
                    </div>`;
                const list = (id) => `<div class="pfm-sec-body" data-body="${id}"><div class="pfm-list" data-list="${id}"><div class="pfm-lhead"></div><div class="pfm-lbody"></div></div></div>`;
                pane.innerHTML = `<div class="pfm-rv">
                    ${bar('overview', 'Resource Overview')}
                    <div class="pfm-sec-body pfm-graphs" data-body="overview">${graph('cpu', 'CPU', '100%', '0%')}${graph('disk', 'Disk', '10 KB/sec', '0')}${graph('net', 'Network', '10 Mbps', '0')}${graph('mem', 'Memory', '100 Hard Faults/sec', '0')}</div>
                    ${bar('cpu', 'CPU', levels('cpu'))}${list('cpu')}
                    ${bar('disk', 'Disk', levels('disk'))}${list('disk')}
                    ${bar('net', 'Network', levels('net'))}${list('net')}
                    ${bar('mem', 'Memory', levels('mem'))}${list('mem')}
                    ${bar('links', 'Learn More')}
                    <div class="pfm-sec-body pfm-links" data-body="links">
                        <span data-link="rv">&bull;&nbsp;&nbsp;Resource View Help</span><span data-link="dc">&bull;&nbsp;&nbsp;Create a Data Collector Set and Diagnosis Report</span>
                        <span data-link="pm">&bull;&nbsp;&nbsp;Performance Monitor Help</span><span data-link="ms">&bull;&nbsp;&nbsp;Monitor System Activity with Performance Monitor</span>
                        <span data-link="dh">&bull;&nbsp;&nbsp;Data Collection Help</span><span data-link="sm">&bull;&nbsp;&nbsp;Schedule and Manage Data</span>
                    </div>
                </div>`;
                if (!this.expanded.has('links')) this.expanded.add('links');
                pane.addEventListener('click', (ev) => {
                    const b = ev.target.closest('.pfm-bar');
                    if (b) {
                        const id = b.dataset.sec;
                        if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
                        setReg({ Expanded: [...this.expanded] });
                        this.renderResourceView(pane);
                        return;
                    }
                    const h = ev.target.closest('[data-sort]');
                    if (h) {
                        const [list, key] = h.dataset.sort.split(':');
                        const was = this.sort[list];
                        this.sort[list] = { key, dir: was && was.key === key ? -was.dir : -1 };
                        this.renderResourceView(pane);
                        return;
                    }
                    if (ev.target.closest('[data-link]')) void this.action('help');
                });
            }
            pane.querySelectorAll('.pfm-bar').forEach((b) => b.classList.toggle('is-open', this.expanded.has(b.dataset.sec)));
            pane.querySelectorAll('[data-body]').forEach((b) => { b.hidden = !this.expanded.has(b.dataset.body); });

            // the bars' figures: wdc.dll strings 1116-1124, 1132, 1133
            const lv = (id, pct) => { const e = pane.querySelector(`[data-lv="${id}"]`); if (e) e.style.setProperty('--lv', String(Math.max(0, Math.min(10, Math.round((pct || 0) / 10))))); };
            const val = (id, t) => { const e = pane.querySelector(`[data-v="${id}"]`); if (e && e.textContent !== t) e.textContent = t; };
            const H = this.hist;
            const last = (k) => (H[k].length ? H[k][H[k].length - 1] : 0);
            const cpu = last('cpu');
            const diskKB = last('disk') / 1024;
            const netKbps = last('net') / 1000;
            const faults = last('faults');
            const mem = last('mem');
            lv('cpu-a', cpu); val('cpu-a', `${Math.round(cpu)}%`); lv('cpu-b', 100); val('cpu-b', '100% Maximum Frequency');
            lv('disk-a', Math.min(100, diskKB / 10)); val('disk-a', `${fmt(diskKB)} KB/sec`); lv('disk-b', last('diskActive')); val('disk-b', `${Math.round(last('diskActive'))}% Highest Active Time`);
            lv('net-a', Math.min(100, netKbps / 100)); val('net-a', netKbps >= 1000 ? `${fmt(netKbps / 1000)} Mbps` : `${fmt(netKbps)} Kbps`); lv('net-b', last('netUtil')); val('net-b', `${Math.round(last('netUtil'))}% Network Utilization`);
            lv('mem-a', Math.min(100, faults)); val('mem-a', `${fmt(faults)} Hard Faults/sec`); lv('mem-b', mem); val('mem-b', `${Math.round(mem)}% Used Physical Memory`);

            // the graphs: each auto-scales its top figure as the VM's do
            if (this.expanded.has('overview')) {
                const scaleOf = (arr, steps) => steps.find((v) => Math.max(0, ...arr) <= v) || steps[steps.length - 1];
                const diskMax = scaleOf(H.disk.map((v) => v / 1024), [10, 100, 1000, 10000, 100000, 1000000]);
                const netMax = scaleOf(H.net.map((v) => v / 1000), [10, 100, 1000, 10000, 100000, 1000000]);
                const memMax = scaleOf(H.faults, [100, 1000, 10000, 100000]);
                const kb = (v) => (v >= 1000000 ? `${v / 1000000} GB/sec` : v >= 1000 ? `${v / 1000} MB/sec` : `${v} KB/sec`);
                const kbps = (v) => (v >= 1000000 ? `${v / 1000000} Gbps` : v >= 1000 ? `${v / 1000} Mbps` : `${v} Kbps`);
                const setMax = (id, t) => { const e = pane.querySelector(`[data-gmax="${id}"]`); if (e && e.textContent !== t) e.textContent = t; };
                setMax('disk', kb(diskMax)); setMax('net', kbps(netMax)); setMax('mem', `${memMax} Hard Faults/sec`);
                this.drawGraph(pane.querySelector('[data-g="cpu"] canvas'), [{ data: H.cpu, max: 100, color: '#00ff00', fill: true }, { data: H.freq, max: 100, color: '#3066ff' }]);
                this.drawGraph(pane.querySelector('[data-g="disk"] canvas'), [{ data: H.disk.map((v) => v / 1024), max: diskMax, color: '#00ff00', fill: true }, { data: H.diskActive, max: 100, color: '#3066ff' }]);
                this.drawGraph(pane.querySelector('[data-g="net"] canvas'), [{ data: H.net.map((v) => v / 1000), max: netMax, color: '#00ff00', fill: true }, { data: H.netUtil, max: 100, color: '#3066ff' }]);
                this.drawGraph(pane.querySelector('[data-g="mem"] canvas'), [{ data: H.faults, max: memMax, color: '#00ff00', fill: true }, { data: H.mem, max: 100, color: '#3066ff' }]);
            }

            // the process lists (wdc.dll strings 2300-2321)
            if (!s) return;
            const procs = s.processes || [];
            // Linux has no file description: a script's name for an interpreter (node web_server.js), else the program's
            const desc = (p) => {
                const parts = (p.command || '').split(/\s+/).filter(Boolean);
                const script = parts.slice(1).find((x) => !x.startsWith('-') && /\.(js|mjs|cjs|py|sh|rb|pl)$/.test(x));
                return (script || parts[0] || p.name).split('/').pop();
            };
            if (this.expanded.has('cpu')) {
                this.list(pane, 'cpu', [['name', 'Image', 144], ['pid', 'PID', 46], ['desc', 'Description', 137], ['threads', 'Threads', 72, true], ['cpu', 'CPU', 72, true], ['avgCpu', 'Average CPU', 72, true]],
                    procs.filter((p) => p.cpu > 0 || p.avgCpu > 0).map((p) => ({ ...p, desc: desc(p), cpu: Math.round(p.cpu), avgCpu: p.avgCpu.toFixed(2) })), 'avgCpu');
            }
            if (this.expanded.has('disk')) {
                this.list(pane, 'disk', [['name', 'Image', 144], ['pid', 'PID', 46], ['file', 'File', 65], ['read', 'Read (B/min)', 72, true], ['write', 'Write (B/min)', 72, true], ['prio', 'IO Priority', 72, true], ['rt', 'Response Time (ms)', 72, true]],
                    procs.filter((p) => p.read || p.write).map((p) => ({ ...p, file: p.file || '', prio: 'Normal', rt: 0, read: fmt(p.read), write: fmt(p.write), _read: p.read, _write: p.write })), 'write');
            }
            if (this.expanded.has('net')) {
                this.list(pane, 'net', [['image', 'Image', 144], ['pid', 'PID', 46], ['address', 'Address', 137], ['send', 'Send (B/min)', 72, true], ['recv', 'Receive (B/min)', 72, true], ['total', 'Total (B/min)', 72, true]],
                    (s.connections || []).filter((c) => c.total > 0).map((c) => ({ ...c, _send: c.send, _recv: c.recv, _total: c.total, send: fmt(c.send), recv: fmt(c.recv), total: fmt(c.total) })), 'total');
            }
            if (this.expanded.has('mem')) {
                this.list(pane, 'mem', [['name', 'Image', 144], ['pid', 'PID', 46], ['hardFaults', 'Hard Faults/min', 65, true], ['commitKB', 'Commit (KB)', 72, true], ['workingKB', 'Working Set (KB)', 72, true], ['shareKB', 'Shareable (KB)', 72, true], ['privateKB', 'Private (KB)', 72, true]],
                    procs.filter((p) => p.workingKB).map((p) => ({ ...p, _commitKB: p.commitKB, _workingKB: p.workingKB, _shareKB: p.shareKB, _privateKB: p.privateKB, commitKB: fmt(p.commitKB), workingKB: fmt(p.workingKB), shareKB: fmt(p.shareKB), privateKB: fmt(p.privateKB) })), 'privateKB');
            }
        }

        /** A Resource View list (a report list view, Segoe 8 pt, 185 px high). */
        list(pane, id, cols, rows, defaultKey) {
            const host = pane.querySelector(`[data-list="${id}"]`);
            if (!host) return;
            const sort = this.sort[id] || (this.sort[id] = { key: defaultKey, dir: -1 });
            const v = (r, k) => (r[`_${k}`] !== undefined ? r[`_${k}`] : r[k]);
            rows.sort((a, b) => {
                const x = v(a, sort.key);
                const y = v(b, sort.key);
                const n = (typeof x === 'number' || !Number.isNaN(Number(x))) && (typeof y === 'number' || !Number.isNaN(Number(y)));
                return (n ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * sort.dir;
            });
            const grid = `${cols.map((c) => `${c[2]}px`).join(' ')} minmax(0, 1fr)`;
            host.style.setProperty('--cols', grid);
            // Resource View's headers show no sort mark (the VM's)
            const head = cols.map(([k, t, , num]) => `<button type="button" class="pfm-col${num ? ' is-num' : ''}" data-sort="${id}:${k}">${esc(t)}</button>`).join('') + '<span class="pfm-col pfm-col-rest"></span>';
            const body = rows.slice(0, 200).map((r) => `<div class="pfm-row">${cols.map(([k, , , num]) => `<span class="${num ? 'is-num' : ''}">${esc(r[k])}</span>`).join('')}</div>`).join('');
            const h = host.querySelector('.pfm-lhead');
            const b = host.querySelector('.pfm-lbody');
            if (h.dataset.html !== head) { h.innerHTML = head; h.dataset.html = head; }
            if (b.dataset.html !== body) { b.innerHTML = body; b.dataset.html = body; }
        }

        /** A Resource Overview graph: 108x100 black, a 10 px #088010 grid, lines filled dark under the green one. */
        drawGraph(c, series) {
            if (!c) return;
            const x = c.getContext('2d');
            const W = c.width;
            const H = c.height;
            x.fillStyle = '#000';
            x.fillRect(0, 0, W, H);
            x.fillStyle = '#088010';
            for (let gx = 0; gx < W; gx += 10) x.fillRect(gx, 0, 1, H);
            for (let gy = 10; gy < H; gy += 10) x.fillRect(0, gy, W, 1);
            const step = W / (SAMPLES - 1);
            series.forEach((sr) => {
                const d = sr.data;
                if (!d.length) return;
                const pts = d.map((v, i) => [Math.round(W - 1 - (d.length - 1 - i) * step), Math.round(H - 1 - (Math.max(0, Math.min(sr.max, v)) / sr.max) * (H - 1))]);
                if (sr.fill) {
                    x.fillStyle = '#006200';
                    for (let i = 1; i < pts.length; i += 1) {
                        const [x0, y0] = pts[i - 1];
                        const [x1, y1] = pts[i];
                        for (let px = x0; px <= x1; px += 1) {
                            const py = Math.round(y0 + ((y1 - y0) * (px - x0)) / Math.max(1, x1 - x0));
                            if (py < H - 1) x.fillRect(px, py + 1, 1, H - 1 - py);
                        }
                    }
                }
                x.fillStyle = sr.color;
                for (let i = 1; i < pts.length; i += 1) {
                    const [x0, y0] = pts[i - 1];
                    const [x1, y1] = pts[i];
                    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
                    for (let k = 0; k <= n; k += 1) x.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1);
                }
            });
        }

        // ---- the other nodes --------------------------------------------------------------------

        /**
         * Performance Monitor (sysmon.ocx), placed as the VM shows it: its toolbar (bitmap 2), the graph
         * drawn left to right and wrapping, a red bar at the newest sample, the hatched band above 100,
         * 0-100 down the left, four times along the bottom, the Last / Average / Minimum / Maximum /
         * Duration boxes and the legend (Show, Color, Scale, Counter, Instance, Parent, Object, Computer).
         * 100 samples a second apart, as the VM's 1:40.
         */
        renderPerfMonitor(pane) {
            if (!this.pm) this.pm = { data: new Array(100).fill(null), pos: 0, times: new Array(100).fill(null), frozen: false };
            if (!pane.querySelector('.pfm-pm')) {
                // sysmon.ocx bitmap 2: 0 graph, 1 log data, 2 change graph type, 3 add, 4 delete, 5 highlight,
                // 6 copy properties, 7 paste counter list, 8 properties, 9 zoom, 10 freeze, 11 update, 12 help
                const tb = [[0, 1, 'View Current Activity'], [1, 0, 'View Log Data'], [2, 0, 'Change graph type', true], 'sep', [3, 0, 'Add'], [4, 0, 'Delete'], [5, 0, 'Highlight'], 'sep',
                    [6, 0, 'Copy Properties'], [7, 0, 'Paste Counter List'], [8, 0, 'Properties'], [9, 0, 'Zoom'], 'sep', [10, 0, 'Freeze Display'], [11, 0, 'Update Data'], 'sep', [12, 0, 'Help']]
                    .map((b) => (b === 'sep' ? '<span class="pfm-pm-sep"></span>' : `<button type="button" class="pfm-pm-tb${b[1] ? ' is-pressed' : ''}${b[3] ? ' has-drop' : ''}" data-pm="${b[0]}" title="${b[2]}"><span style="--i:${b[0]}"></span></button>`)).join('');
                pane.innerHTML = `<div class="pfm-pm">
                    <div class="pfm-pm-toolbar">${tb}</div>
                    <canvas class="pfm-pm-canvas"></canvas>
                    <div class="pfm-pm-values">
                        <label style="right:433px;top:0">Last</label><span class="pfm-pm-box" data-pv="last" style="right:330px;top:0"></span>
                        <label style="right:278px;top:0">Average</label><span class="pfm-pm-box" data-pv="avg" style="right:175px;top:0"></span>
                        <label style="right:113px;top:0">Minimum</label><span class="pfm-pm-box" data-pv="min" style="right:10px;top:0"></span>
                        <label style="right:271px;top:21px">Maximum</label><span class="pfm-pm-box" data-pv="max" style="right:168px;top:21px"></span>
                        <label style="right:113px;top:21px">Duration</label><span class="pfm-pm-box" data-pv="dur" style="right:10px;top:21px"></span>
                    </div>
                    <div class="pfm-pm-legend"><div class="pfm-pm-lhead">${['Show', 'Color', 'Scale', 'Counter', 'Instance', 'Parent', 'Object', 'Computer'].map((t) => `<span>${t}</span>`).join('')}</div><div class="pfm-pm-lbody"></div></div>
                </div>`;
                pane.querySelector('.pfm-pm-toolbar').addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-pm]');
                    if (!b) return;
                    if (b.dataset.pm === '10') { this.pm.frozen = !this.pm.frozen; b.classList.toggle('is-pressed', this.pm.frozen); }
                    if (b.dataset.pm === '11' && this.pm.frozen) this.pmSample(true);
                    if (b.dataset.pm === '12') void this.action('help');
                });
            }
            this.pmSample(false);
            const pm = this.pm;
            const vals = pm.data.filter((v) => v !== null);
            const put = (k, t) => { const e = pane.querySelector(`[data-pv="${k}"]`); if (e && e.textContent !== t) e.textContent = t; };
            const lastV = pm.data[(pm.pos + 99) % 100];
            put('last', (lastV || 0).toFixed(3));
            put('avg', (vals.reduce((a, b) => a + b, 0) / (vals.length || 1)).toFixed(3));
            put('min', (vals.length ? Math.min(...vals) : 0).toFixed(3));
            put('max', (vals.length ? Math.max(...vals) : 0).toFixed(3));
            put('dur', `${Math.floor(vals.length / 60)}:${String(vals.length % 60).padStart(2, '0')}`);
            const host = `\\\\${esc(((this.snap && this.snap.host) || 'MELATON').toUpperCase())}`;
            const row = `<div class="pfm-pm-row is-sel"><span><i class="pfm-pm-check"></i></span><span><i class="pfm-swatch"></i></span><span>1.0</span><span>% Processor Time</span><span>_Total</span><span>---</span><span>Processor</span><span>${host}</span></div>`;
            const lb = pane.querySelector('.pfm-pm-lbody');
            if (lb.dataset.html !== row) { lb.innerHTML = row; lb.dataset.html = row; }
            this.drawPerfMonitor(pane.querySelector('.pfm-pm-canvas'));
        }

        /** One Performance Monitor sample a second: % Processor Time from the snapshot. */
        pmSample(force) {
            const pm = this.pm;
            const now = Date.now();
            if (!force && (pm.frozen || (pm.at && now - pm.at < 900))) return;
            pm.at = now;
            pm.data[pm.pos] = this.snap ? this.snap.cpu.total : 0;
            pm.times[pm.pos] = now;
            pm.pos = (pm.pos + 1) % 100;
        }

        drawPerfMonitor(c) {
            if (!c) return;
            const r = c.getBoundingClientRect();
            const W = Math.max(100, Math.round(r.width));
            const H = Math.max(100, Math.round(r.height));
            if (c.width !== W) c.width = W;
            if (c.height !== H) c.height = H;
            const x = c.getContext('2d');
            x.fillStyle = '#f0f0f0';
            x.fillRect(0, 0, W, H);
            // the plot: 47 px in from the left and right, 50 px down (the hatched band, the 100 line 5 px
            // under it), its axis 157 px above the pane's foot (the canvas runs to the value boxes)
            const L = 48;
            const R = W - 49;
            const T = 26;
            const B = H - 32;
            x.fillStyle = '#fff';
            x.fillRect(L, T - 5, R - L, B - T + 5);
            x.fillStyle = '#000';
            x.fillRect(L, T - 5, R - L + 1, 1);
            // the band above 100: gray diagonals 8 px apart
            x.fillStyle = '#7f7f7f';
            for (let hx = L; hx < R; hx += 8) [7, 6, 5, 4].forEach((d, k) => { if (hx + d < R) x.fillRect(hx + d, T - 4 + k, 1, 1); });
            x.fillStyle = '#000';
            x.fillRect(L, T, R - L + 1, 1);
            x.fillRect(L, T - 5, 1, B - T + 6);
            x.fillRect(R, T - 5, 1, B - T + 6);
            x.fillRect(L, B, R - L + 1, 1);
            x.font = '12px "Segoe UI", Tahoma, sans-serif';
            x.textAlign = 'right';
            x.textBaseline = 'middle';
            for (let v = 0; v <= 100; v += 20) {
                const y = Math.round(B - ((B - T) * v) / 100);
                x.fillRect(L - 4, y, 4, 1);
                x.fillText(String(v), L - 7, y + 1);
            }
            // four times along the bottom: the oldest sample, two between, the newest
            const pm = this.pm;
            const at = (i) => pm.times[(pm.pos + i) % 100];
            const fmtT = (t) => (t ? new Date(t).toLocaleTimeString('en-US') : '');
            const oldest = [...Array(100).keys()].find((i) => at(i)) || 0;
            x.textAlign = 'center';
            x.textBaseline = 'top';
            [[0, oldest], [0.3, 30], [0.6, 60], [1, 99]].forEach(([f, i]) => {
                const tx = Math.round(L + (R - L) * f);
                x.fillRect(tx, B, 1, 4);
                x.fillText(fmtT(at(i) || Date.now()), tx, B + 10);
            });
            // the line: sample k at its slot, wrapping; the red bar at the newest
            x.fillStyle = '#ff0000';
            const sx = (k) => Math.round(L + ((R - L) * k) / 99);
            const sy = (v) => Math.round(B - ((B - T) * Math.max(0, Math.min(100, v))) / 100);
            for (let k = 1; k < 100; k += 1) {
                const a = pm.data[k - 1];
                const b = pm.data[k];
                if (a === null || b === null || k === pm.pos) continue;
                const x0 = sx(k - 1);
                const x1 = sx(k);
                const y0 = sy(a);
                const y1 = sy(b);
                const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
                for (let j = 0; j <= n; j += 1) x.fillRect(Math.round(x0 + ((x1 - x0) * j) / n), Math.round(y0 + ((y1 - y0) * j) / n), 1, 1);
            }
            const bar = sx((pm.pos + 99) % 100);
            x.fillRect(bar, T, 1, B - T);
        }

        // ---- Reliability Monitor (relmon.dll) -------------------------------------------------------

        /** The records (modules/reliabilityRecords.js), once a minute while the view is shown. */
        async loadReliability() {
            if (!this.admin || !root.wsClient || this.relLoading) return;
            this.relLoading = true;
            this.relAt = Date.now();
            try {
                let r = await root.wsClient.sendMessage('perfmon_reliability', {}, false);
                if (r && r.data) r = r.data;
                if (r && Array.isArray(r.events)) this.relDays = relDays(r);
            } catch (err) {
                if (/admin/i.test(String(err && err.message))) this.admin = false;
            } finally {
                this.relLoading = false;
            }
            const pane = this.el('.pfm-result');
            if (this.node === 'rel' && pane) this.renderReliability(pane, true);
        }

        /**
         * Reliability Monitor as the VM's relmon.dll draws it: the snap-in band (clipped), "System Stability
         * Chart Last updated:", the date combo, a day a column (the index line over 0-10, then Software
         * (Un)Installs and the four failure rows), and the System Stability Report below (relmon.dll's HTML
         * templates 600-667).
         */
        renderReliability(pane, force) {
            let rel = pane.querySelector('.pfm-rel');
            if (!rel) {
                pane.innerHTML = `<div class="pfm-rel">
                    <div class="pfm-rel-band"><span>Reliability Monitor</span></div>
                    <div class="pfm-rel-head"><b>System Stability Chart</b> Last updated: <span class="pfm-rel-upd"></span></div>
                    <canvas class="pfm-rel-chart"></canvas>
                    <button type="button" class="pfm-rel-combo"><span class="pfm-rel-combo-text"></span><span class="pfm-rel-combo-btn"></span></button>
                    <div class="pfm-rel-report"></div>
                </div>`;
                rel = pane.querySelector('.pfm-rel');
                this.wireReliability(rel);
                force = true;
            }
            if (!this.relLoading && Date.now() - (this.relAt || 0) > 60000) void this.loadReliability();
            const w = rel.clientWidth;
            if (!force && w === this.relW) return;
            this.relW = w;
            const days = this.relDays || [];
            if (this.relSel === undefined || this.relSel === null || this.relSel >= days.length) this.relSel = days.length ? days.length - 1 : null;
            rel.querySelector('.pfm-rel-upd').textContent = days.length ? shortDay(days[days.length - 1].date) : '';
            rel.querySelector('.pfm-rel-combo-text').textContent = this.relSel === 'all' ? 'Select all' : (days[this.relSel] ? shortDay(days[this.relSel].date) : '');
            this.drawRelChart(rel);
            if (force) this.renderRelReport(rel);
        }

        wireReliability(rel) {
            const canvas = rel.querySelector('.pfm-rel-chart');
            canvas.addEventListener('mousedown', (ev) => {
                const r = canvas.getBoundingClientRect();
                const x = ev.clientX - r.left;
                const y = ev.clientY - r.top;
                const g = this.relGeom;
                if (!g || y < g.T || y > g.B || x <= g.L || x >= g.R) return;
                const col = g.cols.findIndex((c) => x >= c.x && x < c.x + c.w);
                const i = col - g.offset;
                if (col < 0 || !this.relDays || !this.relDays[i]) return;
                this.relSel = i;
                this.renderReliability(this.el('.pfm-result'), true);
            });
            const combo = rel.querySelector('.pfm-rel-combo');
            combo.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                combo.focus();
                if (this.relPop) { this.closeRelPop(); return; }
                this.openRelList(combo);
            });
            combo.addEventListener('keydown', (ev) => {
                const days = this.relDays || [];
                if (ev.key === 'Escape' && this.relPop) { this.closeRelPop(); return; }
                if ((ev.key === 'F4' || (ev.altKey && ev.key === 'ArrowDown')) && !this.relPop) { ev.preventDefault(); this.openRelList(combo); return; }
                if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && typeof this.relSel === 'number') {
                    const n = this.relSel + (ev.key === 'ArrowLeft' ? -1 : 1);
                    if (days[n]) { this.relSel = n; this.renderReliability(this.el('.pfm-result'), true); }
                }
            });
            rel.querySelector('.pfm-rel-report').addEventListener('click', (ev) => {
                const t = ev.target.closest('[data-sec]');
                if (!t) return;
                const body = rel.querySelector(`[data-secbody="${t.dataset.sec}"]`);
                const open = body.style.display === 'none';
                body.style.display = open ? '' : 'none';
                t.src = `${A}/rel-${open ? 'collapse' : 'expand'}.gif`;
                t.alt = open ? 'Collapse' : 'Expand';
            });
        }

        closeRelPop() {
            if (this.relPop) { this.relPop.remove(); this.relPop = null; }
            if (this.relPopOff) { this.relPopOff(); this.relPopOff = null; }
            const t = this.modal.querySelector('.pfm-rel-combo-text');
            const days = this.relDays || [];
            if (t) t.textContent = this.relSel === 'all' ? 'Select all' : (days[this.relSel] ? shortDay(days[this.relSel].date) : '');
        }

        /** The combo's list: Select all, Select a date... (relmon.dll strings 556, 642). */
        openRelList(combo) {
            this.closeRelPop();
            const r = combo.getBoundingClientRect();
            const pop = doc.createElement('div');
            pop.className = 'pfm-rel-list';
            pop.innerHTML = '<div data-pick="all">Select all</div><div data-pick="date">Select a date...</div>';
            this.placeRelPop(pop, r.left, r.bottom - 1);
            pop.addEventListener('mouseover', (ev) => { const it = ev.target.closest('[data-pick]'); pop.querySelectorAll('[data-pick]').forEach((d) => d.classList.toggle('is-hot', d === it)); });
            pop.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const it = ev.target.closest('[data-pick]');
                if (!it) return;
                if (it.dataset.pick === 'all') {
                    this.closeRelPop();
                    this.relSel = 'all';
                    this.renderReliability(this.el('.pfm-result'), true);
                    return;
                }
                this.openRelCalendar(combo);
            });
        }

        placeRelPop(pop, left, top) {
            const z = (Number.parseInt(root.getComputedStyle(this.modal).zIndex, 10) || 1000) + 10;
            pop.style.zIndex = String(z);
            pop.style.left = `${Math.round(left)}px`;
            pop.style.top = `${Math.round(top)}px`;
            doc.body.appendChild(pop);
            this.relPop = pop;
            const off = (ev) => { if (!pop.contains(ev.target) && !ev.target.closest('.pfm-rel-combo')) this.closeRelPop(); };
            setTimeout(() => doc.addEventListener('mousedown', off, true), 0);
            this.relPopOff = () => doc.removeEventListener('mousedown', off, true);
        }

        /**
         * Select a date...: the month calendar under the combo, its right edge on the combo's; only days with
         * records are shown, the ones with events bold.
         */
        openRelCalendar(combo) {
            this.closeRelPop();
            const days = this.relDays || [];
            if (!days.length) return;
            const r = combo.getBoundingClientRect();
            const pop = doc.createElement('div');
            pop.className = 'pfm-rel-cal';
            const sel = typeof this.relSel === 'number' ? days[this.relSel] : days[days.length - 1];
            let view = new Date(sel.date.getFullYear(), sel.date.getMonth(), 1);
            const byKey = new Map(days.map((d, i) => [d.date.getTime(), i]));
            const draw = () => {
                const start = new Date(view.getFullYear(), view.getMonth(), 1 - view.getDay());
                let cells = '';
                for (let i = 0; i < 42; i += 1) {
                    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
                    const k = byKey.get(d.getTime());
                    if (k === undefined || d.getMonth() !== view.getMonth()) continue;
                    const cls = `pfm-rel-cal-day${days[k].events.length ? ' is-bold' : ''}${k === this.relSel ? ' is-selected' : ''}`;
                    cells += `<span class="${cls}" data-k="${k}" style="left:${3 + (i % 7) * 24}px;top:${49 + Math.floor(i / 7) * 15}px">${d.getDate()}</span>`;
                }
                pop.innerHTML = `<span class="pfm-rel-cal-prev"></span><span class="pfm-rel-cal-title">${view.toLocaleDateString('en-US', { month: 'long' })}, ${view.getFullYear()}</span><span class="pfm-rel-cal-next"></span>
                    ${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((n, i) => `<span class="pfm-rel-cal-dow" style="left:${3 + i * 24}px">${n}</span>`).join('')}
                    <span class="pfm-rel-cal-rule"></span>${cells}`;
            };
            draw();
            combo.querySelector('.pfm-rel-combo-text').textContent = 'Select a date...';
            this.placeRelPop(pop, r.right + 1 - 176, r.bottom + 1);
            pop.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (ev.target.closest('.pfm-rel-cal-prev')) { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); draw(); return; }
                if (ev.target.closest('.pfm-rel-cal-next')) { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); draw(); return; }
                const day = ev.target.closest('[data-k]');
                if (!day) return;
                this.closeRelPop();
                this.relSel = Number(day.dataset.k);
                this.renderReliability(this.el('.pfm-result'), true);
            });
        }

        /** The chart, on a canvas from 40 px down: relmon.dll's geometry as measured on the VM at 800x600. */
        drawRelChart(rel) {
            const c = rel.querySelector('.pfm-rel-chart');
            const W = rel.clientWidth;
            const H = 238;
            if (c.width !== W) c.width = W;
            if (c.height !== H) c.height = H;
            c.style.width = `${W}px`;
            const x = c.getContext('2d');
            x.clearRect(0, 0, W, H);
            const days = this.relDays || [];
            // the frame: index 0-10 above a double line, five rows of 17 under it
            const L = 25;
            const R = Math.max(L + 120, W - 131);
            const T = 2;
            const Z = 99;
            const B = 186;
            const cols = [];
            for (let cx = L, i = 0; cx < R; i += 1) { const w = Math.min(i < 14 ? 15 : 14, R - cx); cols.push({ x: cx, w }); cx += w; }
            const offset = Math.max(0, days.length - cols.length);
            this.relGeom = { L, R, T, B, cols, offset };
            cols.forEach((col, i) => { x.fillStyle = i % 2 ? '#fff' : '#f0f0f0'; x.fillRect(col.x, T, col.w, B - T); });
            x.fillStyle = '#a0a0a0';
            x.fillRect(L, T, R - L + 1, 1);
            x.fillRect(L, T, 1, B - T + 1);
            x.fillRect(R, T, 1, B - T + 1);
            [Z, Z + 2, Z + 19, Z + 36, Z + 53, Z + 70, B].forEach((y) => x.fillRect(L, y, R - L + 1, 1));
            const center = (i) => cols[i].x + 7;
            const yOf = (v) => Math.round(Z - 9 * v);
            // the selected day: a blue column with a notch at the top and an arrow up to the line
            const sel = this.relSel === 'all' ? -1 : (this.relSel === null ? -1 : this.relSel + offset);
            if (sel >= 0 && cols[sel]) {
                const sx = cols[sel].x;
                x.fillStyle = '#3399ff';
                [[0, 14], [2, 11], [3, 9], [5, 5], [6, 3], [7, 1]].forEach(([o, w], k) => x.fillRect(sx + o, T + k, w, 1));
                x.fillRect(sx + 7, T + 6, 1, Z - 9 - T - 6 + 4);
                [[7, 1], [7, 1], [7, 1], [7, 1], [6, 3], [5, 5], [4, 7], [3, 9], [2, 11]].forEach(([o, w], k) => x.fillRect(sx + o, Z - 9 + k, w, 1));
                x.fillRect(sx, Z, 14, B - Z);
            }
            // the index line: 4 px squares, dashes 3 on 1 off between them (from the frame to the first)
            x.fillStyle = '#000';
            const dash = (x0, y0, x1, y1) => {
                const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
                for (let j = 0; j <= n; j += 1) if (j % 4 !== 3) x.fillRect(Math.round(x0 + ((x1 - x0) * j) / (n || 1)), Math.round(y0 + ((y1 - y0) * j) / (n || 1)), 1, 1);
            };
            let prev = null;
            days.forEach((d, k) => {
                const i = k + offset;
                if (i < 0 || i >= cols.length) return;
                const px = center(i);
                const py = yOf(d.index);
                if (prev) dash(prev[0] + 2, prev[1], px - 2, py); else dash(L + 1, py, px - 2, py);
                prev = [px, py];
            });
            days.forEach((d, k) => { const i = k + offset; if (i >= 0 && i < cols.length) x.fillRect(center(i) - 2, yOf(d.index) - 2, 4, 4); });
            // the event icons, a row per kind
            const ROWS = ['software', 'app', 'hardware', 'windows', 'misc'];
            days.forEach((d, k) => {
                const i = k + offset;
                if (i < 0 || i >= cols.length) return;
                ROWS.forEach((cat, r) => {
                    const evs = d.events.filter((e) => e.cat === cat);
                    if (!evs.length) return;
                    const icon = cat === 'software' ? (evs.some((e) => e.status === 'Failure') ? 'warning' : 'info') : 'error';
                    const img = relIcon(icon, () => this.drawRelChart(rel));
                    if (img.complete && img.naturalWidth) x.drawImage(img, center(i) - 8, Z + 3 + 17 * r);
                });
            });
            // ticks under the days that have records, every other date slanted under them
            x.font = '12px "Segoe UI", Tahoma, sans-serif';
            days.forEach((d, k) => {
                const i = k + offset;
                if (i < 0 || i >= cols.length) return;
                x.fillStyle = '#000';
                x.fillRect(center(i), B - 1, 1, 4);
                if (k % 2) return;
                x.save();
                x.translate(center(i) - 4, B + 4);
                x.rotate(Math.PI / 6);
                x.textBaseline = 'top';
                x.textAlign = 'left';
                x.fillText(shortDay(d.date), 0, 0);
                x.restore();
            });
            // 10 / 5 / 0, the rows' names, the selected day's index
            x.fillStyle = '#000';
            x.textAlign = 'right';
            x.textBaseline = 'middle';
            [10, 5, 0].forEach((v) => x.fillText(String(v), L - 7, yOf(v) + 1));
            x.textAlign = 'left';
            ['Software (Un)Installs', 'Application Failures', 'Hardware Failures', 'Melaton Failures', 'Miscellaneous Failures']
                .forEach((t, r) => x.fillText(t, R + 4, Z + 11 + 17 * r));
            if (sel >= 0 && days[this.relSel]) {
                x.font = 'bold 12px "Segoe UI", Tahoma, sans-serif';
                x.textBaseline = 'alphabetic';
                x.fillText(`Index: ${days[this.relSel].index.toFixed(2)}`, R + 3, 53 - 40 + 0);
            }
        }

        /** The System Stability Report for the selected day (or every day): relmon.dll's tables. */
        renderRelReport(rel) {
            const days = this.relDays || [];
            const host = rel.querySelector('.pfm-rel-report');
            if (!days.length) { host.innerHTML = ''; return; }
            const all = this.relSel === 'all';
            const picked = all ? days : [days[this.relSel]].filter(Boolean);
            const events = picked.reduce((a, d) => a.concat(d.events), []);
            const when = all ? `${shortDay(days[0].date)} - ${shortDay(days[days.length - 1].date)}` : (picked[0] ? shortDay(picked[0].date) : '');
            const date = (e) => shortDay(new Date(e.t));
            const SECTIONS = [
                ['software', 'Software (Un)Installs', [['Software', 40], ['Version', 15], ['Activity', 15], ['Activity Status', 15], ['Date', 15]], (e) => [e.name, e.version, e.activity, e.status, date(e)]],
                ['app', 'Application Failures', [['Application', 40], ['Version', 15], ['Failure Type', 30], ['Date', 15]], (e) => [e.name, e.version, e.type, date(e)]],
                ['hardware', 'Hardware Failures', [['Component Type', 40], ['Device', 15], ['Failure Type', 30], ['Date', 15]], (e) => [e.component, e.device, e.type, date(e)]],
                ['windows', 'Melaton Failures', [['Failure Type', 40], ['Version', 15], ['Failure Detail', 30], ['Date', 15]], (e) => [e.type, e.version, e.detail, date(e)]],
                ['misc', 'Miscellaneous Failures', [['Failure Type', 40], ['Version', 15], ['Failure Detail', 30], ['Date', 15]], (e) => [e.type, e.version, e.detail, date(e)]]
            ];
            const rows = SECTIONS.map(([cat, title, cols, cells]) => {
                const list = events.filter((e) => e.cat === cat);
                const open = list.length > 0;
                const head = `<tr class="pfm-rr-thead">${cols.map(([t, w]) => `<td style="width:${w}%"><b>${esc(t)}</b></td>`).join('')}</tr>`;
                const body = list.length
                    ? list.map((e) => `<tr class="pfm-rr-row">${cells(e).map((v, i) => `<td style="width:${cols[i][1]}%">${esc(v)}</td>`).join('')}</tr>`).join('')
                    : `<tr class="pfm-rr-row"><td colspan="${cols.length}">No events of the selected type are available for this time period. If you selected the complete date range, no events of the selected type are available.</td></tr>`;
                return `<tr><td class="pfm-rr-tog"><img src="${A}/rel-${open ? 'collapse' : 'expand'}.gif" data-sec="${cat}" alt="${open ? 'Collapse' : 'Expand'}"></td><td class="pfm-rr-sec"><div>${esc(title)} for ${esc(when)}</div></td></tr>
                    <tr><td class="pfm-rr-gut"></td><td class="pfm-rr-secbody"><div data-secbody="${cat}"${open ? '' : ' style="display:none"'}><table class="pfm-rr-table">${head}${body}</table></div></td></tr>`;
            }).join('');
            const top = host.scrollTop;
            host.innerHTML = `<table class="pfm-rr-master"><tr><td colspan="2" class="pfm-rr-title">System Stability Report</td></tr>${rows}</table>`;
            host.scrollTop = this.relKeepScroll ? top : 0;
        }

        /** A folder node: its children by Name (Data Collector Sets, Reports). */
        renderFolder(pane) {
            const n = this.find(this.node);
            if (!n) return;
            const kids = n.children || [];
            pane.innerHTML = `<div class="pfm-folder"><div class="pfm-lhead"><span class="pfm-col">Name</span><span class="pfm-col pfm-col-rest"></span></div>
                <div class="pfm-lbody">${kids.map((k) => `<div class="pfm-frow" data-open="${k.id}"><span class="pfm-node-icon" style="--i:${k.icon}"></span>${esc(k.name)}</div>`).join('')}</div></div>`;
            pane.querySelectorAll('[data-open]').forEach((r) => r.addEventListener('dblclick', () => { this.open.add(this.node); this.select(r.dataset.open, true); }));
        }

        destroy() {
            clearInterval(this.timer);
            this.closeRelPop();
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 300);
        }
    }

    let running = null;

    async function start(app) {
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        const p = new PerfMon(app);
        running = p;
        app.onExit(() => { running = null; p.destroy(); });
    }

    root.melatonPerfmon = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('perfmon', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
