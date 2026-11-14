/**
 * MMC console shell (Yozora #828): the Vista MMC 3.0 window the management snap-ins share (Workspace
 * Management, Front Gate, Dynamic Quips, Enshutsuka, Autofill Ranking), so each one only describes its
 * tree, pages and commands. The frame is Messaging Bridge's (apps/msgbridge, #779), measured on the
 * Vista VM's Computer Management at 800x600: menu band (File, Action, View, Help), toolbar (mmc.exe
 * bitmap 202), console tree, result pane, Action pane, status bar. Look: public/css/mmc-console.css.
 *
 *   const c = mmcConsole.open(def)      one window per def.id; a second open brings it forward
 *                                       (and selects def.node / opts.node when given)
 *   def = {
 *     id, title, icon16, icon32, taskbarIcon,   window id mmcConsole_<id>, registry key MMC\<title>
 *     width?, height?                            800x600 by default (Computer Management's)
 *     nodes(c)          [{ id, name, icon, desc?, children? }]; the first is the console root
 *     page(node, c)     the result pane: an HTML string, or { html, list?, mount?(pane, c) }
 *     commands(node, c) [{ text, action, icon?, disabled?, separator? }]: Action menu, Action pane,
 *                       right-click; Refresh / Help are added by the shell unless noRefresh
 *     selCommands(node, key, c)   the selected list row's group: { title, items } or null
 *     toolbar(node, c)  the node's own buttons [{ id, i, title, disabled? }] (i = mmc.exe 202 index)
 *     action(a, c, arg) a command the shell does not know; return false when unhandled
 *     rowOpen(key, node, c)       a row double-clicked / Enter (rows without data-open)
 *     status(node, c)   the status bar's first pane
 *     viewMenu(node, c) extra View items before Customize...
 *     about             { version, lines: [] } for Help > About
 *     help(node, c)     Help Topics (default: Help and Support)
 *     onOpen(c), onClose(c)
 *   }
 *   c.node / c.sel      the selected node id / list row key
 *   c.select(id, record = true), c.render(), c.refresh(), c.renderActions(), c.note(text)
 *   c.page(title, side, sections), c.overview(img, paras), c.props(rows), c.state(ok, text, warn),
 *   c.listView(cols, rows, { sortId, sort, sortable, empty, fit }), c.sorted(rows, cols, sortId),
 *   c.box(html, buttons, opts), c.reg(name, def), c.setReg(values), c.close(), c.data (snap-in state)
 *
 * Shell commands: exit, back, forward, up, tree, actions, refresh (F5), customize, help, about,
 * nav:<node id> (a link in a page: <span class="mmc-link" data-act="nav:<id>">).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const MMC = '/static_images/vista-mmc';
    const VI = '/static_images/vista-icons';
    const consoles = new Map();

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

    /** Explorer's sizes: bytes, then KB / MB / GB / TB to three significant figures. */
    function size(b) {
        const n = Number(b) || 0;
        if (n < 1024) return `${n} bytes`;
        const u = ['KB', 'MB', 'GB', 'TB'];
        let v = n / 1024;
        let i = 0;
        while (v >= 1000 && i < u.length - 1) { v /= 1024; i += 1; }
        return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
    }

    /** Vista's short date and time: 11/13/2026 2:24 AM. */
    function when(t) {
        if (t === null || t === undefined || t === '' || t === 0) return '';
        const d = new Date(typeof t === 'string' && /^\d+$/.test(t) ? Number(t) : t);
        if (Number.isNaN(d.getTime())) return '';
        const h = d.getHours();
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${(h % 12) || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    }

    class Console {
        constructor(def) {
            this.def = def;
            this.key = `HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\MMC\\${def.title}`;
            this.data = {};
            this.node = null;
            this.sel = null;
            this.history = [];
            this.future = [];
            this.notes = '';
            this.open = new Set(this.reg('Expanded', null) || (def.expanded || []));
            this.collapsed = new Set(this.reg('CollapsedSections', []));
            this.actCollapsed = new Set();
            this.sorts = Object.assign({}, this.reg('Sorts', {}));
            this.build();
            const first = this.nodes()[0];
            if (first) this.open.add(first.id);
            this.select(def.node || (first && first.id), false);
            if (typeof def.onOpen === 'function') {
                try { def.onOpen(this); } catch (err) { console.error(`${def.title}: onOpen`, err); }
            }
        }

        reg(name, d) { return root.melatonRegistry ? root.melatonRegistry.get(this.key, name, d) : d; }
        setReg(values) { if (root.melatonRegistry) void root.melatonRegistry.set(this.key, values); }

        // ---- the window ---------------------------------------------------------------------------

        build() {
            const def = this.def;
            const m = doc.createElement('div');
            const w = def.width || 800;
            const h = def.height || 600;
            m.className = 'modal hidden resizeable-window mmc-window has-actions';
            m.id = `mmcConsole_${def.id}`;
            m.dataset.windowIdentifier = `mmc-${def.id}`;
            m.dataset.windowClient = 'light';
            if (def.taskbarIcon || def.icon16) m.dataset.taskbarIcon = def.taskbarIcon || def.icon16;
            m.dataset.windowDefaultWidth = String(w);
            m.dataset.windowDefaultHeight = String(h);
            m.dataset.windowMinWidth = '480';
            m.dataset.windowMinHeight = '320';
            m.dataset.mmcSnapin = def.id;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', def.title);
            if (!this.reg('ConsoleTree', true)) m.classList.add('no-tree');
            if (!this.reg('ActionPane', true)) m.classList.remove('has-actions');
            if (!this.reg('StatusBar', true)) m.classList.add('no-status');
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${esc(def.icon16 || '')}" alt=""><span class="mmc-title">${esc(def.title)}</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small mmc-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 mmc-client">
                    <div class="mmc-rebar">
                        <div class="naxt-menubar mmc-menubar" role="menubar" data-win32-menus>
                            ${['File', 'Action', 'View', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-mmc-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}
                        </div>
                        <div class="mmc-toolbar" role="toolbar"></div>
                    </div>
                    <div class="mmc-body">
                        <div class="mmc-tree" tabindex="0" role="tree"></div>
                        <div class="mmc-split"></div>
                        <div class="mmc-result"></div>
                        <div class="mmc-actions"></div>
                    </div>
                    <div class="mmc-status"><span></span><span></span><span></span></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.el = (q) => m.querySelector(q);
            const treeWidth = Number(this.reg('TreeWidth', def.treeWidth || 190)) || 190;
            this.el('.mmc-tree').style.width = `${Math.max(120, Math.min(400, treeWidth))}px`;
            m.querySelector('.mmc-close').addEventListener('click', () => this.close());
            m.querySelectorAll('[data-mmc-menu]').forEach((t) => {
                if (!root.contextMenu) return;
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.mmcMenu); } }]
                });
            });
            const tree = this.el('.mmc-tree');
            tree.addEventListener('click', (ev) => {
                const row = ev.target.closest('[data-node]');
                if (!row) return;
                if (ev.target.closest('.mmc-twisty')) { this.toggle(row.dataset.node); return; }
                this.select(row.dataset.node, true);
            });
            tree.addEventListener('dblclick', (ev) => { const row = ev.target.closest('[data-node]'); if (row && !ev.target.closest('.mmc-twisty')) this.toggle(row.dataset.node); });
            tree.addEventListener('mousedown', (ev) => { if (ev.button !== 2) return; const row = ev.target.closest('[data-node]'); if (row) this.select(row.dataset.node, true); });
            tree.addEventListener('keydown', (ev) => this.treeKey(ev));
            if (root.contextMenu) {
                root.contextMenu.attachToElement(tree, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu('node'); } }]
                });
                root.contextMenu.attachToElement(this.el('.mmc-result'), {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu('result'); } }]
                });
            }
            this.el('.mmc-toolbar').addEventListener('click', (ev) => { const b = ev.target.closest('[data-tb]'); if (b && !b.disabled) void this.action(b.dataset.tb); });
            this.el('.mmc-actions').addEventListener('click', (ev) => {
                const g = ev.target.closest('.mmc-act-group');
                if (g) {
                    const k = g.dataset.group;
                    if (this.actCollapsed.has(k)) this.actCollapsed.delete(k); else this.actCollapsed.add(k);
                    this.renderActions();
                    return;
                }
                const a = ev.target.closest('.mmc-act');
                if (a && !a.classList.contains('is-disabled')) void this.action(a.dataset.act);
            });
            const pane = this.el('.mmc-result');
            pane.addEventListener('mousedown', (ev) => { if (ev.button === 2) this.resultClick(ev, true); });
            pane.addEventListener('click', (ev) => this.resultClick(ev));
            pane.addEventListener('dblclick', (ev) => this.resultDblClick(ev));
            pane.addEventListener('keydown', (ev) => this.listKey(ev));
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'F5') { ev.preventDefault(); void this.action('refresh'); }
                else if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); void this.action('back'); }
                else if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); void this.action('forward'); }
            });
            this.wireSplit();
            call('openModal', m);
            m.classList.remove('hidden');
        }

        /** The splitter between the console tree and the result pane. */
        wireSplit() {
            const split = this.el('.mmc-split');
            const tree = this.el('.mmc-tree');
            split.addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                split.setPointerCapture(ev.pointerId);
                const x0 = ev.clientX;
                const w0 = tree.getBoundingClientRect().width;
                const move = (e) => { tree.style.width = `${Math.max(120, Math.min(400, Math.round(w0 + e.clientX - x0)))}px`; };
                const up = () => {
                    split.removeEventListener('pointermove', move);
                    split.removeEventListener('pointerup', up);
                    this.setReg({ TreeWidth: Math.round(tree.getBoundingClientRect().width) });
                };
                split.addEventListener('pointermove', move);
                split.addEventListener('pointerup', up);
            });
        }

        // ---- the console tree ---------------------------------------------------------------------

        nodes() {
            try { return this.def.nodes(this) || []; } catch (err) { console.error(`${this.def.title}: nodes`, err); return []; }
        }

        find(id, list = this.nodes()) {
            for (const n of list) {
                if (n.id === id) return n;
                const ch = n.children && this.find(id, n.children);
                if (ch) return ch;
            }
            return null;
        }

        parentOf(id, list = this.nodes(), parent = null) {
            for (const n of list) {
                if (n.id === id) return parent;
                const p = n.children && this.parentOf(id, n.children, n);
                if (p) return p;
            }
            return null;
        }

        visible() {
            const out = [];
            const walk = (list, depth) => list.forEach((n) => {
                out.push({ n, depth });
                if (n.children && n.children.length && this.open.has(n.id)) walk(n.children, depth + 1);
            });
            walk(this.nodes(), 0);
            return out;
        }

        renderTree() {
            const rows = this.visible().map(({ n, depth }) => {
                const kids = n.children && n.children.length;
                const open = this.open.has(n.id);
                // the console root has no twisty (MMC's); every level below indents 19 px
                return `<div class="mmc-node${n.id === this.node ? ' is-selected' : ''}" data-node="${esc(n.id)}" role="treeitem" style="padding-left:${4 + depth * 19}px">
                    ${depth ? `<span class="mmc-twisty${kids ? (open ? ' is-open' : ' is-closed') : ''}"></span>` : ''}<img src="${esc(n.icon || '')}" alt=""><span class="mmc-node-name">${esc(n.name)}</span></div>`;
            });
            const html = rows.join('');
            const tree = this.el('.mmc-tree');
            if (tree.dataset.html !== html) { tree.innerHTML = html; tree.dataset.html = html; }
        }

        toggle(id) {
            const n = this.find(id);
            if (!n || !n.children || !n.children.length) return;
            if (this.open.has(id)) this.open.delete(id); else this.open.add(id);
            this.setReg({ Expanded: [...this.open] });
            this.renderTree();
        }

        treeKey(ev) {
            const rows = this.visible();
            const i = rows.findIndex((r) => r.n.id === this.node);
            if (i < 0) return;
            const n = rows[i].n;
            const kids = n.children && n.children.length;
            let go = null;
            if (ev.key === 'ArrowDown') go = rows[Math.min(rows.length - 1, i + 1)].n.id;
            else if (ev.key === 'ArrowUp') go = rows[Math.max(0, i - 1)].n.id;
            else if (ev.key === 'Home') go = rows[0].n.id;
            else if (ev.key === 'End') go = rows[rows.length - 1].n.id;
            else if (ev.key === 'ArrowRight') { if (kids && !this.open.has(n.id)) this.toggle(n.id); else if (kids) go = n.children[0].id; }
            else if (ev.key === 'ArrowLeft') { if (kids && this.open.has(n.id) && rows[i].depth) this.toggle(n.id); else { const p = this.parentOf(n.id); if (p) go = p.id; } }
            else if (ev.key === 'Enter') { if (kids) this.toggle(n.id); }
            else return;
            ev.preventDefault();
            if (go && go !== this.node) this.select(go, true);
        }

        select(id, record = true) {
            if (!id) return;
            if (!this.find(id)) { const first = this.nodes()[0]; id = first ? first.id : id; }
            if (record && this.node && id !== this.node) { this.history.push(this.node); this.future = []; }
            if (id !== this.node) { this.sel = null; this.notes = ''; }
            this.node = id;
            // the path to the node opens (Back / Forward, links in the result pane)
            for (let p = this.parentOf(id); p; p = this.parentOf(p.id)) this.open.add(p.id);
            this.renderTree();
            this.renderToolbar();
            this.renderActions();
            const pane = this.el('.mmc-result');
            this.unmountPage();
            pane.innerHTML = '';
            delete pane.dataset.html;
            this.render();
        }

        // ---- menus, toolbar, Action pane ------------------------------------------------------------

        commands() {
            const n = this.find(this.node);
            let list = [];
            try { list = (n && typeof this.def.commands === 'function' ? this.def.commands(n, this) : []) || []; } catch (err) { console.error(`${this.def.title}: commands`, err); }
            const out = list.slice();
            if (!this.def.noRefresh && !out.some((x) => x.action === 'refresh')) {
                if (out.length && !out[out.length - 1].separator) out.push({ separator: true });
                out.push({ text: 'Refresh', action: 'refresh', icon: 3 });
            }
            if (!out.some((x) => x.action === 'help')) out.push({ separator: true }, { text: 'Help', action: 'help', icon: 15 });
            return out;
        }

        selCommands() {
            if (!this.sel || typeof this.def.selCommands !== 'function') return null;
            const n = this.find(this.node);
            try { return n ? this.def.selCommands(n, this.sel, this) : null; } catch (err) { console.error(`${this.def.title}: selCommands`, err); return null; }
        }

        menu(name) {
            const strip = (list) => list.map((ch) => (ch.separator ? { separator: true } : { text: ch.text, action: ch.action, disabled: !!ch.disabled }));
            switch (name) {
                case 'file': return [{ text: 'Exit', action: 'exit' }];
                case 'node': return strip(this.commands());
                case 'result':
                case 'action': {
                    const s = this.selCommands();
                    if (name === 'result' && s) return strip(s.items);
                    return strip(s ? s.items.concat([{ separator: true }], this.commands()) : this.commands());
                }
                case 'view': {
                    const n = this.find(this.node);
                    let extra = [];
                    try { extra = (n && typeof this.def.viewMenu === 'function' ? this.def.viewMenu(n, this) : []) || []; } catch (_) { extra = []; }
                    return extra.concat(extra.length ? [{ separator: true }] : [], [{ text: 'Customize...', action: 'customize' }]);
                }
                case 'help': return [{ text: 'Help Topics', action: 'help' }, { separator: true }, { text: `About ${this.def.title}...`, action: 'about' }];
                default: return [];
            }
        }

        /**
         * Computer Management's toolbar: Back, Forward | Up One Level, Show/Hide Console Tree | the node's
         * own | Help, Show/Hide Action Pane (mmc.exe bitmap 202: 0 back, 1 forward, 3 refresh,
         * 8 properties, 9 up, 10 tree, 15 help, 16 export list, 17 action pane).
         */
        renderToolbar() {
            const b = (id, i, title, opts = {}) => `<button type="button" class="mmc-tb${opts.pressed ? ' is-pressed' : ''}" data-tb="${esc(id)}" title="${esc(title)}"${opts.disabled ? ' disabled' : ''}><span class="mmc-tb-icon" style="--i:${Number(i) || 0}"></span></button>`;
            const sep = '<span class="mmc-tb-sep"></span>';
            const n = this.find(this.node);
            const rootNode = this.nodes()[0];
            let own = [];
            try { own = (n && typeof this.def.toolbar === 'function' ? this.def.toolbar(n, this) : null) || []; } catch (_) { own = []; }
            if (!own.length && n && rootNode && n.id !== rootNode.id && !this.def.noRefresh) own = [{ id: 'refresh', i: 3, title: 'Refresh' }];
            const ownHtml = own.map((t) => b(t.id, t.i, t.title, t)).join('');
            const html = b('back', 0, 'Back', { disabled: !this.history.length }) + b('forward', 1, 'Forward', { disabled: !this.future.length }) + sep
                + (n && rootNode && n.id !== rootNode.id ? b('up', 9, 'Up One Level') : '') + b('tree', 10, 'Show/Hide Console Tree', { pressed: !this.modal.classList.contains('no-tree') }) + sep
                + (ownHtml ? ownHtml + sep : '')
                + b('help', 15, 'Help') + b('actions', 17, 'Show/Hide Action Pane', { pressed: this.modal.classList.contains('has-actions') });
            const tb = this.el('.mmc-toolbar');
            if (tb.dataset.html !== html) { tb.innerHTML = html; tb.dataset.html = html; }
        }

        /** MMC's Action pane: "Actions", the node's group, the selected row's group. */
        renderActions() {
            const pane = this.el('.mmc-actions');
            if (!pane) return;
            const n = this.find(this.node);
            const items = (list) => list.map((ch) => (ch.separator ? '<div class="mmc-act-sep"></div>'
                : `<div class="mmc-act${ch.disabled ? ' is-disabled' : ''}" data-act="${esc(ch.action)}">${ch.icon !== undefined ? `<span class="mmc-act-icon"${typeof ch.icon === 'string' ? ` style="background:url('${esc(ch.icon)}') 0 0 / 16px 16px no-repeat"` : ` style="--i:${ch.icon}"`}></span>` : ''}${esc(ch.text)}</div>`)).join('');
            const group = (key, title, list) => `<div class="mmc-act-group${this.actCollapsed.has(key) ? ' is-collapsed' : ''}" data-group="${esc(key)}" title="${esc(title)}">${esc(title)}</div><div class="mmc-act-items">${items(list)}</div>`;
            const s = this.selCommands();
            const html = `<div class="mmc-act-head">Actions</div>${group('node', n ? n.name : '', this.commands())}${s ? group('sel', s.title, s.items) : ''}`;
            if (pane.dataset.html !== html) { pane.innerHTML = html; pane.dataset.html = html; }
        }

        async action(a, arg) {
            if (!a) return;
            switch (a) {
                case 'exit': this.close(); return;
                case 'back': { const n = this.history.pop(); if (n) { this.future.push(this.node); this.select(n, false); } return; }
                case 'forward': { const n = this.future.pop(); if (n) { this.history.push(this.node); this.select(n, false); } return; }
                case 'up': { const p = this.parentOf(this.node); if (p) this.select(p.id, true); return; }
                case 'tree': this.modal.classList.toggle('no-tree'); this.setReg({ ConsoleTree: !this.modal.classList.contains('no-tree') }); this.renderToolbar(); return;
                case 'actions': this.modal.classList.toggle('has-actions'); this.setReg({ ActionPane: this.modal.classList.contains('has-actions') }); this.renderToolbar(); return;
                case 'customize': await this.customize(); return;
                case 'about': await this.about(); return;
                default:
            }
            if (a.startsWith('nav:')) { this.select(a.slice(4), true); return; }
            let handled = false;
            if (typeof this.def.action === 'function') {
                try { handled = (await this.def.action(a, this, arg)) !== false; } catch (err) {
                    console.error(`${this.def.title}: ${a}`, err);
                    handled = true;
                    await this.box(`<p>${esc(err && err.message ? err.message : String(err))}</p>`, null, { icon: 'error' });
                }
            }
            if (handled) return;
            if (a === 'refresh') { this.refresh(); return; }
            if (a === 'help') {
                const n = this.find(this.node);
                if (typeof this.def.help === 'function') this.def.help(n, this);
                else call('openHelpAndSupport', this.def.id);
            }
        }

        async customize() {
            const parts = [['ConsoleTree', 'Console tree', !this.modal.classList.contains('no-tree')], ['ActionPane', 'Action pane', this.modal.classList.contains('has-actions')], ['StatusBar', 'Status bar', !this.modal.classList.contains('no-status')]];
            let boxes = null;
            const html = `<p>Select or clear the check boxes to show or hide items in the console window.</p><div class="mmc-dialog-checks">${parts.map(([k, t, on]) => `<label><input type="checkbox" data-mmc-part="${k}"${on ? ' checked' : ''}> ${t}</label>`).join('')}</div>`;
            const ok = await call('showConfirmationDialog', html, [{ text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, {
                title: 'Customize View',
                icon: 'fas fa-circle-info',
                width: 360,
                onDialogReady: () => { boxes = Array.from(doc.querySelectorAll('#confirmationDialog [data-mmc-part]')); }
            });
            if (ok !== true) return;
            if (!boxes || !boxes.length) boxes = Array.from(doc.querySelectorAll('#confirmationDialog [data-mmc-part]'));
            const v = {};
            boxes.forEach((b) => { v[b.dataset.mmcPart] = b.checked; });
            if ('ConsoleTree' in v) this.modal.classList.toggle('no-tree', !v.ConsoleTree);
            if ('ActionPane' in v) this.modal.classList.toggle('has-actions', v.ActionPane);
            if ('StatusBar' in v) this.modal.classList.toggle('no-status', !v.StatusBar);
            this.setReg(v);
            this.renderToolbar();
        }

        async about() {
            const ab = this.def.about || {};
            const lines = (ab.lines || []).map((l) => `<p>${l}</p>`).join('');
            await call('showConfirmationDialog', `<div class="mmc-about"><img src="${esc(this.def.icon32 || this.def.icon16 || '')}" alt="" width="32" height="32"><div><p><b>${esc(this.def.title)}</b><br>Xyridian Management Console snap-in<br>Version ${esc(ab.version || '1.0.0')}</p><p>Copyright &copy; 2007 Xyridian Corporation. All rights reserved.</p>${lines}</div></div>`,
                [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: `About ${this.def.title}`, width: 400 });
        }

        /** A message box over the console (Vista's): icon 'info' | 'warning' | 'error' | 'question'. */
        async box(html, buttons, opts = {}) {
            // the confirmation dialog's own icon classes (confirmationDialog.js defaults to fa-question-circle)
            const icons = { info: 'fas fa-circle-info', warning: 'fas fa-triangle-exclamation', error: 'fas fa-circle-xmark', question: 'fas fa-question-circle' };
            const btns = buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }];
            const icon = icons[opts.icon || 'info'] || opts.icon;
            return call('showConfirmationDialog', html, btns, null, Object.assign({ title: this.def.title, width: 400 }, opts, { icon }));
        }

        // ---- the result pane --------------------------------------------------------------------------

        unmountPage() {
            const m = this.mounted;
            this.mounted = null;
            if (m && typeof m.unmount === 'function') {
                try { m.unmount(); } catch (err) { console.error(`${this.def.title}: unmount`, err); }
            }
        }

        render() {
            const pane = this.el('.mmc-result');
            if (!pane) return;
            const n = this.find(this.node);
            let out = '';
            try { out = n ? this.def.page(n, this) : ''; } catch (err) {
                console.error(`${this.def.title}: page`, err);
                out = this.page(n ? n.name : this.def.title, '', [{ id: 'error', title: 'Error', body: `<p>${esc(err && err.message ? err.message : String(err))}</p>` }]);
            }
            const spec = typeof out === 'string' ? { html: out } : (out || { html: '' });
            pane.classList.toggle('is-list', !!spec.list);
            pane.classList.toggle('is-split', !!spec.split);
            if (pane.dataset.html !== spec.html) {
                // a redraw keeps the scroll position of the page or list and the focus
                const scrollers = Array.from(pane.querySelectorAll('.mmc-page-body, .mmc-list, [data-mmc-scroll]'));
                const pos = scrollers.map((s) => [s.scrollTop, s.scrollLeft]);
                const focused = pane.contains(doc.activeElement) ? doc.activeElement : null;
                const focusKey = focused && (focused.id || focused.dataset.field || focused.getAttribute('name'));
                this.unmountPage();
                pane.innerHTML = spec.html;
                pane.dataset.html = spec.html;
                Array.from(pane.querySelectorAll('.mmc-page-body, .mmc-list, [data-mmc-scroll]')).forEach((s, i) => {
                    if (pos[i]) { s.scrollTop = pos[i][0]; s.scrollLeft = pos[i][1]; }
                });
                if (typeof spec.mount === 'function') {
                    this.mounted = spec;
                    try { spec.mount(pane, this); } catch (err) { console.error(`${this.def.title}: mount`, err); }
                }
                if (focused) {
                    const again = focusKey && (pane.querySelector(`#${CSS.escape(focusKey)}`) || pane.querySelector(`[data-field="${CSS.escape(focusKey)}"], [name="${CSS.escape(focusKey)}"]`));
                    const target = again || pane.querySelector('.mmc-list');
                    if (target) target.focus({ preventScroll: true });
                }
            }
            this.renderStatus();
        }

        /** Tree, toolbar, Action pane and page again (after the snap-in's data changed). */
        refresh() {
            if (!this.modal || !this.modal.isConnected) return;
            if (!this.find(this.node)) { const first = this.nodes()[0]; if (first) { this.select(first.id, false); return; } }
            this.renderTree();
            this.renderToolbar();
            this.renderActions();
            this.render();
        }

        note(text) {
            this.notes = text || '';
            this.renderStatus();
        }

        renderStatus() {
            const spans = this.modal.querySelectorAll('.mmc-status span');
            if (!spans.length) return;
            let text = this.notes;
            if (!text && typeof this.def.status === 'function') {
                const n = this.find(this.node);
                try { text = n ? this.def.status(n, this) : ''; } catch (_) { text = ''; }
            }
            spans[0].textContent = text || '';
        }

        // ---- page builders ------------------------------------------------------------------------------

        page(title, side, sections) {
            const sec = (s) => `<div class="mmc-sec${this.collapsed.has(s.id) ? ' is-collapsed' : ''}" data-sec="${esc(s.id)}"><div class="mmc-sec-head">${esc(s.title)}</div><div class="mmc-sec-body">${s.body}</div></div>`;
            return `<div class="mmc-page-title"><b>${esc(title)}</b><span>${esc(side || '')}</span></div><div class="mmc-page-body">${sections.filter(Boolean).map(sec).join('')}</div>`;
        }

        overview(img, paras) {
            return `<div class="mmc-overview">${img ? `<img src="${esc(img)}" alt="">` : ''}<div>${paras.map((p) => `<p>${p}</p>`).join('')}</div></div>`;
        }

        props(rows) {
            return `<dl class="mmc-props">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}:</dt><dd>${v}</dd>`).join('')}</dl>`;
        }

        /** A state: plain when it is good, with Vista's warning or error icon when it is not. */
        state(ok, text, warn) {
            if (ok) return `<span class="mmc-state">${esc(text)}</span>`;
            return `<span class="mmc-state"><img src="${warn ? `${VI}/warning-16.png` : `${VI}/error-16.png`}" alt="">${esc(text)}</span>`;
        }

        sortOf(sortId, def0) {
            return this.sorts[sortId] || def0 || { key: '', dir: 1 };
        }

        /** rows ([{ data }]) sorted by the list's column (cols[i].key, cols[i].value(data) or text(data)). */
        sorted(rows, cols, sortId, def0) {
            const s = this.sortOf(sortId, def0);
            const col = cols.find((x) => x.key === s.key);
            if (!col) return rows;
            const val = (r) => (col.value ? col.value(r.data) : col.text(r.data));
            return rows.slice().sort((a, b) => {
                const x = val(a);
                const y = val(b);
                const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
                return c * s.dir;
            });
        }

        /**
         * A report list view: cols [{ t, w, num, key, text(data), html?(data) }], rows [{ key, data, icon,
         * open, cls }]; sortable when opts.sortId is given (the shell keeps the order per list).
         */
        listView(cols, rows, opts = {}) {
            const tpl = opts.fit ? cols.map((col) => `minmax(${Math.min(col.w, col.min || 56)}px, ${col.w}fr)`).join(' ') + ' 0px'
                : cols.map((col) => `${col.w}px`).join(' ') + ' minmax(0, 1fr)';
            const sort = opts.sortId ? this.sortOf(opts.sortId, opts.sort) : null;
            const head = cols.map((col) => {
                const sorted = sort && sort.key === col.key;
                return `<span class="mmc-col${col.num ? ' is-num' : ''}${sorted ? ' is-sorted' : ''}"${sort && col.key ? ` data-sort="${esc(col.key)}" data-sort-id="${esc(opts.sortId)}"` : ''}>${sorted ? `<span class="mmc-arrow${sort.dir < 0 ? ' is-down' : ''}"></span>` : ''}${esc(col.t)}</span>`;
            }).join('') + '<span class="mmc-col mmc-col-rest"></span>';
            const list = sort ? this.sorted(rows, cols, opts.sortId, opts.sort) : rows;
            const cell = (col, r, i) => {
                const inner = col.html ? col.html(r.data) : `<i>${esc(col.text(r.data))}</i>`;
                return `<span${col.num ? ' class="is-num"' : ''}>${i === 0 && r.icon ? `<img class="mmc-row-icon" src="${esc(r.icon)}" alt="">` : ''}${inner}</span>`;
            };
            const body = list.length ? list.map((r) => `<div class="mmc-row${r.cls ? ` ${r.cls}` : ''}${r.key != null && String(r.key) === String(this.sel) ? ' is-selected' : ''}"${r.key != null ? ` data-key="${esc(r.key)}"` : ''}${r.open ? ` data-open="${esc(r.open)}"` : ''}>${cols.map((col, i) => cell(col, r, i)).join('')}<span></span></div>`).join('')
                : `<div class="mmc-empty">${esc(opts.empty || 'There are no items to show in this view.')}</div>`;
            return `<div class="mmc-list${opts.fit ? ' is-fit' : ''}" tabindex="0" style="--cols:${tpl}"><div class="mmc-lhead">${head}</div><div class="mmc-lbody">${body}</div></div>`;
        }

        // ---- result pane events -----------------------------------------------------------------------

        selectRow(key) {
            this.sel = key;
            const pane = this.el('.mmc-result');
            pane.querySelectorAll('.mmc-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
            const row = key != null ? pane.querySelector(`.mmc-row[data-key="${CSS.escape(String(key))}"]`) : null;
            if (row) { row.classList.add('is-selected'); row.scrollIntoView({ block: 'nearest' }); }
            delete pane.dataset.html;
            this.renderActions();
            this.renderStatus();
            if (typeof this.def.onSelectRow === 'function') {
                try { this.def.onSelectRow(key, this.find(this.node), this); } catch (err) { console.error(err); }
            }
        }

        resultClick(ev, right) {
            if (!right) {
                const head = ev.target.closest('.mmc-sec-head');
                if (head) {
                    const id = head.parentElement.dataset.sec;
                    if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
                    this.setReg({ CollapsedSections: [...this.collapsed] });
                    head.parentElement.classList.toggle('is-collapsed', this.collapsed.has(id));
                    delete this.el('.mmc-result').dataset.html;
                    return;
                }
                const link = ev.target.closest('[data-act]');
                if (link && this.el('.mmc-result').contains(link) && !link.disabled) {
                    ev.preventDefault();
                    void this.action(link.dataset.act, link.dataset.arg);
                    return;
                }
                const col = ev.target.closest('[data-sort]');
                if (col) {
                    const id = col.dataset.sortId;
                    const k = col.dataset.sort;
                    const cur = this.sortOf(id);
                    this.sorts[id] = cur.key === k ? { key: k, dir: -cur.dir } : { key: k, dir: 1 };
                    this.setReg({ Sorts: this.sorts });
                    this.render();
                    return;
                }
            }
            const row = ev.target.closest('.mmc-row[data-key]');
            if (row) this.selectRow(row.dataset.key);
        }

        resultDblClick(ev) {
            const row = ev.target.closest('.mmc-row');
            if (!row) return;
            if (row.dataset.open) { this.select(row.dataset.open, true); return; }
            if (row.dataset.key != null && typeof this.def.rowOpen === 'function') this.def.rowOpen(row.dataset.key, this.find(this.node), this);
        }

        listKey(ev) {
            if (!ev.target.classList || !ev.target.classList.contains('mmc-list')) return;
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Delete'].includes(ev.key)) return;
            const rows = Array.from(ev.target.querySelectorAll('.mmc-row[data-key], .mmc-row[data-open]'));
            if (!rows.length) return;
            ev.preventDefault();
            let i = rows.findIndex((r) => r.classList.contains('is-selected'));
            if (ev.key === 'Enter') {
                const r = rows[i];
                if (!r) return;
                if (r.dataset.open) this.select(r.dataset.open, true);
                else if (typeof this.def.rowOpen === 'function') this.def.rowOpen(r.dataset.key, this.find(this.node), this);
                return;
            }
            if (ev.key === 'Delete') { if (this.sel != null) void this.action('delete'); return; }
            if (ev.key === 'ArrowDown') i = Math.min(rows.length - 1, i + 1);
            else if (ev.key === 'ArrowUp') i = Math.max(0, i - 1);
            else if (ev.key === 'Home') i = 0;
            else i = rows.length - 1;
            const r = rows[i];
            if (r.dataset.key != null) this.selectRow(r.dataset.key);
            else { rows.forEach((x) => x.classList.remove('is-selected')); r.classList.add('is-selected'); }
        }

        close() {
            this.unmountPage();
            if (typeof this.def.onClose === 'function') {
                try { this.def.onClose(this); } catch (err) { console.error(`${this.def.title}: onClose`, err); }
            }
            consoles.delete(this.def.id);
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => { if (m.isConnected && !consoles.has(this.def.id)) m.remove(); }, 300);
        }
    }

    function open(def, opts = {}) {
        if (!doc || !def || !def.id) return null;
        const have = consoles.get(def.id);
        if (have && have.modal.isConnected) {
            if (have.modal.classList.contains('minimised')) call('restoreMinimizedModal', have.modal);
            call('openModal', have.modal);
            call('bringModalToFront', have.modal);
            if (opts.node && have.find(opts.node)) have.select(opts.node, true);
            return have;
        }
        // a window still fading out from close() (removed after 300 ms) has the same id: drop it now,
        // or the new window loses its taskbar button
        const stale = doc.getElementById(`mmcConsole_${def.id}`);
        if (stale) stale.remove();
        const c = new Console(Object.assign({}, def, opts.node ? { node: opts.node } : {}));
        consoles.set(def.id, c);
        return c;
    }

    root.mmcConsole = {
        open,
        get: (id) => consoles.get(id) || null,
        esc,
        size,
        when,
        num,
        MMC
    };
})(typeof window !== 'undefined' ? window : globalThis);
