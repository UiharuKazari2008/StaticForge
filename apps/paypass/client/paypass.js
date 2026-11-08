/**
 * PayPass Operator (Yozora #721): the front-desk program for openCreditIC, the arcade's IC card and
 * credit system ("payPass"). A port of its Sequenzia interface ("payPass Manager": home-seqapp.pug +
 * sideloader.js), built as the back-office software that would have shipped with a POS card reader:
 * a blue title band with the POS terminal, a function-key strip, and plain grids.
 *
 *   Dashboard   the machine cards: last player, back-to-back session, last cost or Free Play, last play,
 *               customers and earnings over 24 h (yen when the arcade has a currency rate)
 *   Customers   every customer with balance, cards, free play, lock, plays
 *   F1 Register   new customer + card (serial, or scan on the POS terminal)
 *   F2 Deposit    credits or free play, by scan, customer ID or card serial
 *   F3 Lookup     customer by ID, card serial or scan -> Customer window (edit, lock, delete, cards, history)
 *   F4 Transfer   tap the old card, then the new one
 *   F6 Free Play  arcade-wide and per-machine free play, revoke all customers' free play
 *   F5 Refresh
 *
 * Every request goes through the server (paypass_* packets, modules/paypass.js), which holds the
 * openCreditIC key. Scans arm the POS reader and wait for the card ("Scan card now!", Cancel).
 *
 *   melatonApps.define('paypass', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const A = '/melaton-apps/paypass/assets';
    const VERSION = '2.4.0310';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
    const stamp = (t) => { if (!t) return '-'; const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${clock(t)}`; };
    const short = (t) => { if (!t) return '-'; const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${clock(t)}`; };
    const span = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
    // the function-key strip: key -> [command, label]
    const FKEYS = { F1: ['register', 'Register customer'], F2: ['deposit', 'Deposit credits'], F3: ['lookup', 'Lookup customer'], F4: ['transfer', 'Card transfer'], F5: ['refresh', 'Refresh'], F6: ['freeplay', 'Free play config'] };
    const ico = (name, size = 16) => `<img class="pp-ico" src="${A}/icons/${name}.png" alt="" width="${size}" height="${size}">`;

    class PayPass {
        constructor(app) {
            this.app = app;
            this.data = null;
            this.view = 'dashboard';
            this.filter = '';
            this.children = new Set();
            this.winSeq = 0;
            this.busy = 0;
            this.build();
            void this.refresh();
        }

        // ---------------------------------------------------------------- the main window

        /** Built like the other system packages' windows (stable id before openModal, sizes, taskbar image, programFaults). */
        build() {
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window pp-window';
            m.dataset.windowIdentifier = 'melatonPayPass';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = `${A}/paypass-32.png`;
            m.dataset.windowDefaultWidth = '980';
            m.dataset.windowDefaultHeight = '680';
            m.dataset.windowMinWidth = '860';
            m.dataset.windowMinHeight = '480';
            m.style.width = '980px';
            m.style.height = `${Math.min(680, root.innerHeight - 60)}px`;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'PayPass Operator');
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${A}/paypass-16.png" alt=""><span>PayPass Operator</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small pp-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content pp-client"><div class="pp-root">
                    <div class="pp-menubar"><span data-pp-menu="file"><u>F</u>ile</span><span data-pp-menu="customers"><u>C</u>ustomers</span><span data-pp-menu="arcade"><u>A</u>rcade</span><span data-pp-menu="help"><u>H</u>elp</span></div>
                    <div class="pp-band">
                        <span class="pp-band-title"><img class="pp-wordmark" src="${A}/paypass-wordmark.png" alt="PayPass" width="156" height="36"><span class="pp-band-sub"><b>Manager</b><small class="pp-arcade">Connecting...</small></span></span>
                        <span class="pp-band-fill"></span>
                        <label class="pp-term"><span>POS Terminal</span><select class="pp-pos"></select></label>
                        <span class="pp-online"><span class="pp-lamp"></span><span class="pp-online-text">OFFLINE</span></span>
                    </div>
                    <div class="pp-tabs">
                        <button type="button" class="pp-tab is-on" data-pp-view="dashboard">${ico('machine')}Machines</button>
                        <button type="button" class="pp-tab" data-pp-view="customers">${ico('customer')}Customers</button>
                        <span class="pp-tabs-fill"></span>
                        <label class="pp-find">Find: <input type="text" class="pp-filter" placeholder="Name, ID or card S/N"></label>
                    </div>
                    <div class="pp-view"></div>
                    <div class="pp-fkeys">
                        <button type="button" class="pp-fk is-green" data-pp="register"><kbd>F1</kbd>${ico('register', 20)}Register</button>
                        <button type="button" class="pp-fk is-green" data-pp="deposit"><kbd>F2</kbd>${ico('deposit', 20)}Deposit</button>
                        <button type="button" class="pp-fk is-blue" data-pp="lookup"><kbd>F3</kbd>${ico('lookup', 20)}Lookup</button>
                        <button type="button" class="pp-fk is-blue" data-pp="transfer"><kbd>F4</kbd>${ico('transfer', 20)}Transfer</button>
                        <button type="button" class="pp-fk is-amber" data-pp="freeplay"><kbd>F6</kbd>${ico('freeplay', 20)}Free Play</button>
                        <span class="pp-fk-fill"></span>
                        <button type="button" class="pp-fk" data-pp="refresh"><kbd>F5</kbd>Refresh</button>
                    </div>
                    <div class="pp-status"><span class="pp-st-main">Ready</span><span class="pp-st-cust">0 customers</span><span class="pp-st-bal">Balance: -</span><span class="pp-st-time">-</span></div>
                </div></div>`;
            doc.body.appendChild(m);
            this.modal = m;
            const q = (s) => m.querySelector(s);
            this.el = q;
            const sig = { signal: this.app.signal };
            m.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-pp]');
                if (b && !b.disabled && m.contains(b)) void this.command(b.dataset.pp, b);
                const t = ev.target.closest('[data-pp-view]');
                if (t) this.show(t.dataset.ppView);
            }, sig);
            q('.pp-view').addEventListener('dblclick', (ev) => {
                const r = ev.target.closest('[data-cust]');
                if (r) void this.openCustomer({ id: r.dataset.cust });
            }, sig);
            q('.pp-view').addEventListener('click', (ev) => {
                const r = ev.target.closest('tr[data-cust]');
                if (!r) return;
                q('.pp-view').querySelectorAll('tr.is-sel').forEach((x) => x.classList.remove('is-sel'));
                r.classList.add('is-sel');
            }, sig);
            q('.pp-filter').addEventListener('input', (ev) => { this.filter = ev.target.value.trim().toLowerCase(); if (this.view === 'customers') this.render(); }, sig);
            q('.pp-pos').addEventListener('change', (ev) => { this.pos = ev.target.value; }, sig);
            m.querySelectorAll('[data-pp-menu]').forEach((t) => {
                if (!root.contextMenu) return;
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.command(a),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.ppMenu); } }]
                });
            });
            q('.pp-close').addEventListener('click', () => this.app.exit(), sig);
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') this.app.exit();
            }, sig);
            const tick = setInterval(() => { this.el('.pp-st-time').textContent = clock(Date.now()); }, 1000);
            this.app.signal.addEventListener('abort', () => clearInterval(tick));
            // before openModal: an id-less window restores the shared 'unknown' geometry
            m.id = 'melatonPayPassModal';
            this.registerKeys();
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
                root.programFaults.registerProgram(m.id, { name: 'PayPass Operator', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'paypass' }) });
            }
        }

        /**
         * The function-key strip's keys, through the desktop's keyboard registry (modalKeyboardRegistry.js)
         * while the main window has the focus: the registry sees them before the browser does (F5 would
         * reload the page, F1 opens help, F3 find), and lists them in the shortcut overlay.
         */
        registerKeys() {
            if (typeof root.registerKeyboardListener !== 'function') return;
            const id = this.modal.id;
            root.registerKeyboardListener({
                id: `${id}.fkeys`,
                type: 'whenFocused',
                modalId: id,
                priority: 80,
                showInOverlay: false,
                handler: (e) => {
                    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
                    const k = FKEYS[e.key];
                    if (!k) return false;
                    e.preventDefault();
                    e.stopPropagation();
                    if (!e.repeat) void this.command(k[0]);
                    return true;
                }
            });
            Object.entries(FKEYS).forEach(([key, [, label]]) => {
                root.registerKeyboardListener({ id: `${id}.overlay.${key}`, type: 'whenFocused', modalId: id, overlayOnly: true, label, keys: key, icon: 'fas fa-keyboard' });
            });
        }

        destroy() {
            if (typeof root.unregisterKeyboardListener === 'function') {
                root.unregisterKeyboardListener(`${this.modal.id}.fkeys`);
                Object.keys(FKEYS).forEach((key) => root.unregisterKeyboardListener(`${this.modal.id}.overlay.${key}`));
            }
            this.children.forEach((c) => c.close());
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 400);
        }

        menu(name) {
            switch (name) {
                case 'file': return [{ text: 'Refresh', subtext: 'F5', action: 'refresh' }, { separator: true }, { text: 'Exit', action: 'exit' }];
                case 'customers': return [
                    { text: 'Register Customer...', subtext: 'F1', action: 'register' },
                    { text: 'Deposit Credits...', subtext: 'F2', action: 'deposit' },
                    { text: 'Lookup Customer...', subtext: 'F3', action: 'lookup' },
                    { text: 'Card Transfer...', subtext: 'F4', action: 'transfer' }];
                case 'arcade': return [
                    { text: 'Free Play Config...', subtext: 'F6', action: 'freeplay' },
                    { text: 'Bookkeeping', action: 'none', disabled: true }];
                case 'help': return [{ text: 'About PayPass Operator...', action: 'about' }];
                default: return [];
            }
        }

        async command(a) {
            switch (a) {
                case 'exit': this.app.exit(); break;
                case 'refresh': await this.refresh(); break;
                case 'register': this.registerWin(); break;
                case 'deposit': this.depositWin(); break;
                case 'lookup': this.lookupWin(); break;
                case 'transfer': await this.transfer(); break;
                case 'freeplay': this.freePlayWin(); break;
                case 'about': this.about(); break;
                default: break;
            }
        }

        // ---------------------------------------------------------------- server

        async send(type, data) {
            let r = await root.wsClient.sendMessage(type, data || {}, false);
            if (r && r.data !== undefined) r = r.data;
            if (r && r.error) {
                const err = new Error(r.error.details || r.error.message || 'PayPass error');
                err.code = r.error.code;
                throw err;
            }
            return r;
        }

        setBusy(on, text) {
            this.busy = Math.max(0, this.busy + (on ? 1 : -1));
            this.modal.classList.toggle('pp-busy', this.busy > 0);
            this.el('.pp-st-main').textContent = this.busy > 0 ? (text || 'Communicating with the PayPass server...') : 'Ready';
        }

        flash(t) {
            const s = this.el('.pp-st-main');
            s.textContent = t;
            clearTimeout(this.flashT);
            this.flashT = setTimeout(() => { if (!this.busy) s.textContent = 'Ready'; }, 5000);
        }

        async refresh() {
            this.setBusy(true, 'Reading the PayPass server...');
            try {
                this.data = await this.send('paypass_overview', {});
                this.online(true);
            } catch (err) {
                this.online(false);
                if (!this.data) this.el('.pp-view').innerHTML = `<div class="pp-empty">${ico('scan', 48)}<p>The PayPass server could not be reached.</p><p class="pp-dim">${esc(err.message)}</p></div>`;
                this.setBusy(false);
                return;
            }
            this.setBusy(false);
            const d = this.data;
            this.el('.pp-arcade').textContent = d.arcade;
            const sel = this.el('.pp-pos');
            if (!this.pos || !d.pos.some((p) => p.mac === this.pos)) this.pos = d.pos[0] ? d.pos[0].mac : '';
            sel.innerHTML = d.pos.length ? d.pos.map((p) => `<option value="${esc(p.mac)}"${p.mac === this.pos ? ' selected' : ''}>${esc(p.name)}</option>`).join('') : '<option value="">(no terminal)</option>';
            this.el('.pp-st-cust').textContent = `${d.users.length} customers`;
            this.el('.pp-st-bal').textContent = `Balance: ${this.money(d.users.reduce((s, u) => s + u.credits, 0), true)}`;
            this.render();
        }

        online(up) {
            this.modal.classList.toggle('pp-is-online', up);
            this.el('.pp-online-text').textContent = up ? 'ONLINE' : 'OFFLINE';
        }

        /** Credits as the arcade shows them: yen when it has a currency rate, else credits. */
        money(credits, plain) {
            const c = this.data && this.data.currency;
            const n = Number(credits) || 0;
            if (c) {
                const v = `${c.symbol}${Math.round(n * c.rate).toLocaleString('en-US')}`;
                return plain ? v : `<span class="pp-money">${esc(v)}</span>`;
            }
            const v = `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} Cr`;
            return plain ? v : `<span class="pp-money">${esc(v)}</span>`;
        }

        // ---------------------------------------------------------------- views

        show(view) {
            this.view = view;
            this.modal.querySelectorAll('[data-pp-view]').forEach((t) => t.classList.toggle('is-on', t.dataset.ppView === view));
            this.render();
        }

        render() {
            if (!this.data) return;
            const box = this.el('.pp-view');
            box.innerHTML = this.view === 'customers' ? this.customersHtml() : this.dashboardHtml();
        }

        dashboardHtml() {
            const d = this.data;
            const tiles = d.machines.map((m) => {
                const l = m.last;
                const s = m.session;
                return `<div class="pp-mach${m.active ? ' is-active' : ''}">
                    <div class="pp-mach-head">${ico('machine')}<b>${esc(m.name)}</b>${m.freePlay ? '<span class="pp-badge is-free">FREE PLAY</span>' : ''}<span class="pp-mach-lamp" title="${m.active ? 'Played in the last hour' : 'Idle'}"></span></div>
                    <table class="pp-mach-body">
                        <tr><th>Player</th><td>${l ? esc(l.userName) : '-'}</td></tr>
                        <tr><th>Session</th><td>${s && s.count > 1 ? `${s.count}x (${span(s.end - s.start)}) = ${this.money(s.total)}` : '-'}</td></tr>
                        <tr><th>Last Play</th><td>${l ? (l.freePlay ? '<span class="pp-badge is-free">Free Play</span>' : this.money(l.cost)) : '-'}${l && !l.ok ? ' <span class="pp-badge is-bad">Refused</span>' : ''}</td></tr>
                        <tr><th>Time</th><td>${l ? short(l.time) : '-'}</td></tr>
                    </table>
                    <div class="pp-mach-foot"><span>${ico('customer')}${m.day.users} today</span><span>${m.day.plays} plays</span><span>${this.money(m.day.earned)}</span></div>
                </div>`;
            }).join('');
            return `<div class="pp-dash">
                <div class="pp-dash-head"><span>${esc(d.arcade)}</span><span class="pp-dim">Global Free Play: <b class="${d.freePlay ? 'is-on' : ''}">${d.freePlay ? 'ON' : 'OFF'}</b> &nbsp; Updated ${clock(d.at)}</span></div>
                <div class="pp-machs">${tiles || '<div class="pp-empty">No machines have checked in.</div>'}</div>
            </div>`;
        }

        customersHtml() {
            const f = this.filter;
            const rows = this.data.users
                .filter((u) => !f || [u.id, u.name, u.contact, ...u.cards.map((c) => c.serial)].some((v) => String(v || '').toLowerCase().includes(f)))
                .sort((a, b) => (b.lastPlay || 0) - (a.lastPlay || 0))
                .map((u) => `<tr${u.id ? ` data-cust="${esc(u.id)}"` : ' class="is-orphan" title="No card: open it with Lookup by customer ID"'}>
                    <td>${ico('customer')}${esc(decodeURIComponent(u.name) || '(no name)')}</td>
                    <td class="pp-mono">${esc(u.id || '-')}</td>
                    <td class="pp-mono">${u.cards.map((c) => `<span class="${c.locked ? 'is-locked' : ''}">${esc(c.serial)}</span>`).join(', ') || '-'}</td>
                    <td class="pp-num">${this.money(u.credits)}</td>
                    <td>${u.freePlay ? '<span class="pp-badge is-free">Free Play</span>' : ''}${u.locked ? '<span class="pp-badge is-bad">Locked</span>' : ''}</td>
                    <td class="pp-num">${u.plays.toLocaleString('en-US')}</td>
                    <td class="pp-mono">${short(u.lastPlay)}</td>
                </tr>`).join('');
            return `<div class="pp-grid-wrap"><table class="pp-grid">
                <thead><tr><th>Customer</th><th>ID</th><th>Cards</th><th class="pp-num">Balance</th><th>Status</th><th class="pp-num">Plays</th><th>Last Play</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="7" class="pp-dim">No customers.</td></tr>'}</tbody></table></div>`;
        }

        // ---------------------------------------------------------------- windows

        /**
         * A window the program owns (forms, the customer, the scan box): a real desktop window, its caption
         * the program's icon, centred on the main window. o.onButton(value, w) returns true to close.
         */
        openWin(o) {
            const id = `melatonPayPassWin-${++this.winSeq}`;
            const m = doc.createElement('div');
            m.className = `modal hidden on-top pp-window pp-child ${o.cls || ''}`;
            m.id = id;
            m.dataset.windowIdentifier = `melatonPayPass-${o.kind}`;
            m.dataset.windowRestorePosition = 'false';
            m.dataset.windowRestoreSize = 'false';
            m.dataset.windowFixedSize = 'true';
            m.dataset.windowClient = 'light';
            m.dataset.iconOwnerId = this.modal.id;
            m.dataset.parentModalId = this.modal.id;
            m.dataset.taskbarIcon = `${A}/paypass-32.png`;
            if (o.width) m.style.width = `${o.width}px`;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', o.title);
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${A}/paypass-16.png" alt=""><span>${esc(o.title)}</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls"><button type="button" class="btn-danger close-btn btn-small pp-x" title="Close"><i class="fa-regular fa-xmark-large"></i></button></div>
                <div class="modal-content pp-client"><div class="pp-root pp-form">
                    ${o.head ? `<div class="pp-form-head pp-tone-${o.tone || 'blue'}">${o.icon ? ico(o.icon, 32) : ''}<span>${o.head}</span></div>` : ''}
                    <div class="pp-form-body">${o.body}</div>
                    <div class="pp-form-btns">${(o.buttons || []).map((b) => `<button type="button" class="pp-btn${b.def ? ' is-def' : ''}${b.cls ? ` ${b.cls}` : ''}" data-v="${esc(b.value)}">${esc(b.text)}</button>`).join('')}</div>
                </div></div>`;
            doc.body.appendChild(m);
            const ctl = new AbortController();
            let closed = false;
            const w = {
                modal: m,
                q: (s) => m.querySelector(s),
                val: (s) => { const e = m.querySelector(s); return e ? e.value.trim() : ''; },
                close: () => {
                    if (closed) return;
                    closed = true;
                    ctl.abort();
                    this.children.delete(w);
                    try { call('closeModal', m); } catch (_) { /* gone */ }
                    setTimeout(() => m.remove(), 400);
                    if (o.onClose) o.onClose();
                },
                busy: (on) => { m.querySelectorAll('.pp-form-btns button').forEach((b) => { b.disabled = on; }); }
            };
            this.children.add(w);
            m.addEventListener('click', async (ev) => {
                if (ev.target.closest('.pp-x')) { w.close(); return; }
                const b = ev.target.closest('[data-v]');
                if (!b || b.disabled) return;
                if (b.dataset.v === 'cancel') { w.close(); return; }
                if (o.onButton && await o.onButton(b.dataset.v, w, b)) w.close();
            }, { signal: ctl.signal });
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') { ev.stopPropagation(); w.close(); }
                if (ev.key === 'Enter' && ev.target.matches('input')) { const d = m.querySelector('.pp-form-btns .is-def'); if (d) { ev.preventDefault(); d.click(); } }
            }, { signal: ctl.signal });
            doc.addEventListener('staticforge:modal-lifecycle', (e) => {
                if (e && e.detail && e.detail.id === id && e.detail.type === 'closed') w.close();
            }, { signal: ctl.signal });
            call('openModal', m);
            m.classList.remove('hidden');
            requestAnimationFrame(() => {
                const r = m.getBoundingClientRect();
                const p = this.modal.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round(p.left + (p.width - r.width) / 2)), Math.max(0, Math.round(p.top + (p.height - r.height) / 2)));
                const f = m.querySelector('input:not([readonly]), textarea, select');
                if (f) f.focus({ preventScroll: true });
            });
            if (o.init) o.init(w);
            return w;
        }

        /** Melaton's message box, titled with the program (warning / error / info icon). */
        async box(text, kind, buttons) {
            const icon = kind === 'error' ? 'fas fa-circle-xmark' : kind === 'warning' ? 'fas fa-triangle-exclamation' : kind === 'question' ? 'fas fa-circle-question' : 'fas fa-circle-info';
            return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'PayPass Operator', icon, width: 400 });
        }

        async ask(text) {
            const v = await this.box(text, 'warning', [{ text: 'Yes', value: 'yes', className: 'btn-standard' }, { text: 'No', value: null, className: 'btn-standard primary' }]);
            return v === 'yes';
        }

        field(label, cls, opts = {}) {
            const tag = opts.area ? `<textarea class="${cls}" rows="3"${opts.ro ? ' readonly' : ''} placeholder="${esc(opts.ph || '')}">${esc(opts.value || '')}</textarea>`
                : `<input type="${opts.type || 'text'}" class="${cls}" value="${esc(opts.value == null ? '' : opts.value)}"${opts.ro ? ' readonly' : ''} placeholder="${esc(opts.ph || '')}"${opts.type === 'number' ? ' min="0" step="any"' : ''}>`;
            return `<label class="pp-field"><span>${label}</span>${tag}</label>`;
        }

        termName() {
            const p = this.data && this.data.pos.find((x) => x.mac === this.pos);
            return p ? p.name : '(none)';
        }

        /**
         * Run an operation. Scan operations arm the POS reader and show "Scan card now!" until the card
         * is read, the reader gives up, or Cancel. Resolves { ok, customer? }.
         */
        async op(fields, what) {
            this.setBusy(true, `${what || fields.op}...`);
            let r;
            try {
                r = await this.send('paypass_action', fields);
            } catch (err) {
                this.setBusy(false);
                await this.box(err.message, 'error');
                return { ok: false };
            }
            this.setBusy(false);
            if (!r.ok) {
                await this.box(`${r.message || 'The PayPass server refused the request.'}${r.code ? `\n\n(HTTP ${r.code})` : ''}`, 'error');
                return { ok: false };
            }
            if (!r.scan) {
                this.flash(r.message ? `${what}: ${r.message}` : `${what}: done`);
                return { ok: true, message: r.message };
            }
            return this.scanWait(!!r.lookup, what);
        }

        scanWait(lookup, what) {
            return new Promise((resolve) => {
                let settled = false;
                const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
                const w = this.openWin({
                    kind: 'scan',
                    title: 'PayPass Operator',
                    cls: 'pp-scanwin',
                    width: 360,
                    body: `<div class="pp-scan">${ico('scan', 64)}<b>Scan card now!</b><span>${esc(what || '')}</span><span class="pp-dim">Terminal: ${esc(this.termName())}</span><span class="pp-scan-bar"><i></i></span></div>`,
                    buttons: [{ text: 'Cancel', value: 'stop', def: true }],
                    onButton: async (v) => {
                        if (v !== 'stop') return false;
                        try { await this.send('paypass_action', { op: 'cancel', pos: this.pos }); } catch (_) { /* the reader times out anyway */ }
                        finish({ ok: false, cancelled: true });
                        return true;
                    },
                    onClose: () => finish({ ok: false, cancelled: true })
                });
                this.send('paypass_wait', { pos: this.pos, lookup }).then((r) => {
                    if (settled) return;
                    w.close();
                    if (r.done) { finish({ ok: true, customer: r.customer }); this.flash(`${what}: card read`); } else { finish({ ok: false }); void this.box(r.message || 'No card was scanned.', 'warning'); }
                }).catch((err) => { if (!settled) { w.close(); finish({ ok: false }); void this.box(err.message, 'error'); } });
            });
        }

        // ---------------------------------------------------------------- F1 Register

        registerWin() {
            this.openWin({
                kind: 'register', title: 'Register Customer', width: 440, head: 'Register Customer', tone: 'green', icon: 'register',
                body: `${this.field('Initial Balance (credits)', 'pp-credits', { type: 'number', ph: '0' })}
                    <fieldset class="pp-group"><legend>Customer Info</legend>
                        ${this.field('Customer ID', 'pp-id', { ph: 'Leave blank for random' })}
                        ${this.field('Customer Name', 'pp-name')}
                        ${this.field('Contact Info', 'pp-contact', { ph: 'Name, phone number, etc.' })}
                        ${this.field('Notes', 'pp-notes', { area: true })}
                    </fieldset>
                    <fieldset class="pp-group"><legend>Card Info</legend>
                        ${this.field('Serial Number', 'pp-serial', { ph: 'Leave blank to scan' })}
                        ${this.field('Card Name', 'pp-cardname', { ph: 'Friendly name for card' })}
                        ${this.field('Contact Info', 'pp-cardcontact')}
                    </fieldset>`,
                buttons: [{ text: 'Create', value: 'ok', def: true, cls: 'is-green' }, { text: 'Cancel', value: 'cancel' }],
                onButton: async (v, w) => {
                    const card = w.val('.pp-serial');
                    w.busy(true);
                    const r = await this.op({
                        op: 'register', pos: this.pos, id: w.val('.pp-id') || undefined, credits: w.val('.pp-credits') || undefined,
                        name: w.val('.pp-name'), contact: w.val('.pp-contact'), notes: w.val('.pp-notes'),
                        card: card || undefined, cardName: w.val('.pp-cardname'), cardContact: w.val('.pp-cardcontact')
                    }, card ? 'Register customer' : 'Register customer (scan the new card)');
                    w.busy(false);
                    if (r.ok) void this.refresh();
                    return r.ok;
                }
            });
        }

        // ---------------------------------------------------------------- F2 Deposit

        depositWin(preset) {
            const p = preset || {};
            this.openWin({
                kind: 'deposit', title: 'Deposit Credits', width: 420, head: 'Deposit Credits', tone: 'green', icon: 'deposit',
                body: `<div class="pp-seg"><label><input type="radio" name="pp-kind" value="credits" checked> Credit(s)</label><label><input type="radio" name="pp-kind" value="free"> Free Play</label></div>
                    <div class="pp-kind-credits">${this.field('Credits', 'pp-credits', { type: 'number', ph: '0' })}<div class="pp-presets">${[5, 10, 20, 50, 100].map((n) => `<button type="button" class="pp-btn pp-preset" data-n="${n}">+${n}</button>`).join('')}</div></div>
                    <div class="pp-kind-free" hidden>${this.field('Time Limit (hours)', 'pp-hours', { type: 'number', ph: 'Blank is unlimited' })}</div>
                    <fieldset class="pp-group"><legend>To</legend>
                        <label class="pp-radio"><input type="radio" name="pp-to" value="scan"${p.id || p.card ? '' : ' checked'}> Scan card on ${esc(this.termName())}</label>
                        <label class="pp-radio"><input type="radio" name="pp-to" value="user"${p.id ? ' checked' : ''}> Customer ID <input type="text" class="pp-to-id" value="${esc(p.id || '')}"></label>
                        <label class="pp-radio"><input type="radio" name="pp-to" value="card"${p.card ? ' checked' : ''}> Card S/N <input type="text" class="pp-to-card" value="${esc(p.card || '')}"></label>
                    </fieldset>`,
                buttons: [{ text: 'Deposit', value: 'ok', def: true, cls: 'is-green' }, { text: 'Cancel', value: 'cancel' }],
                init: (w) => {
                    w.modal.addEventListener('change', (ev) => {
                        if (ev.target.name !== 'pp-kind') return;
                        const free = ev.target.value === 'free';
                        w.q('.pp-kind-credits').hidden = free;
                        w.q('.pp-kind-free').hidden = !free;
                    });
                    w.modal.addEventListener('click', (ev) => {
                        const b = ev.target.closest('.pp-preset');
                        if (b) { const i = w.q('.pp-credits'); i.value = String((Number(i.value) || 0) + Number(b.dataset.n)); }
                    });
                    w.modal.addEventListener('focusin', (ev) => {
                        if (ev.target.matches('.pp-to-id')) w.q('input[name="pp-to"][value="user"]').checked = true;
                        if (ev.target.matches('.pp-to-card')) w.q('input[name="pp-to"][value="card"]').checked = true;
                    });
                },
                onButton: async (v, w) => {
                    const free = w.q('input[name="pp-kind"]:checked').value === 'free';
                    const target = w.q('input[name="pp-to"]:checked').value;
                    const f = { op: free ? 'freeplay' : 'deposit', target, pos: this.pos, id: w.val('.pp-to-id'), card: w.val('.pp-to-card') };
                    if (free) f.hours = w.val('.pp-hours') || undefined;
                    else f.credits = w.val('.pp-credits');
                    w.busy(true);
                    const r = await this.op(f, free ? 'Grant free play' : `Deposit ${f.credits} credit(s)`);
                    w.busy(false);
                    if (r.ok) { void this.refresh(); if (r.message && !free) void this.box(`Deposit complete.\n\n${r.message}`, 'info'); }
                    return r.ok;
                }
            });
        }

        // ---------------------------------------------------------------- F3 Lookup + the customer

        lookupWin() {
            this.openWin({
                kind: 'lookup', title: 'Select Customer', width: 380, head: 'Select Customer', tone: 'blue', icon: 'lookup',
                body: `${this.field('Customer ID', 'pp-id', { ph: 'Leave blank to scan card' })}${this.field('Card Serial Number', 'pp-serial', { ph: 'Leave blank to scan card' })}`,
                buttons: [{ text: 'Lookup / Scan Card', value: 'ok', def: true }, { text: 'Cancel', value: 'cancel' }],
                onButton: async (v, w) => {
                    const id = w.val('.pp-id');
                    const card = w.val('.pp-serial');
                    if (id || card) { w.close(); void this.openCustomer({ id: id || undefined, card: card || undefined }); return false; }
                    w.busy(true);
                    const r = await this.op({ op: 'lookup', pos: this.pos }, 'Lookup customer');
                    w.busy(false);
                    if (r.ok && r.customer) { this.customerWin(r.customer); return true; }
                    return false;
                }
            });
        }

        async openCustomer(q) {
            this.setBusy(true, 'Reading customer...');
            try {
                const c = await this.send('paypass_customer', q);
                this.setBusy(false);
                this.customerWin(c);
            } catch (err) {
                this.setBusy(false);
                await this.box(err.message, 'error');
            }
        }

        customerWin(c) {
            const name = (() => { try { return decodeURIComponent(c.name); } catch (_) { return c.name; } })();
            const left = c.freePlay && c.freePlayUntil ? Math.max(0, Math.round((c.freePlayUntil - Date.now()) / 60000)) : null;
            const cards = c.cards.map((k) => `<fieldset class="pp-group pp-card" data-card="${esc(k.serial)}"><legend>${ico('register')}Card ${esc(k.serial)}${k.locked ? ' <span class="pp-badge is-bad">Locked</span>' : ''}</legend>
                    ${this.field('Card Name', 'pp-cname', { value: k.name })}${this.field('Contact Info', 'pp-ccontact', { value: k.contact })}
                    <div class="pp-row-btns"><button type="button" class="pp-btn" data-card-op="update">Update Card</button><button type="button" class="pp-btn" data-card-op="${k.locked ? 'unlock' : 'lock'}">${k.locked ? 'Unlock' : 'Lock'}</button><button type="button" class="pp-btn is-red" data-card-op="delete">Delete</button></div>
                </fieldset>`).join('');
            const plays = c.history.slice(0, 60).map((e) => `<tr><td class="pp-mono">${short(e.time)}</td><td>${esc(this.machineName(e.machine))}</td><td class="pp-mono">${esc(e.card)}</td><td class="pp-num">${e.freePlay ? 'Free' : this.money(e.cost)}</td><td>${e.ok ? '' : '<span class="pp-badge is-bad">Refused</span>'}</td></tr>`).join('');
            const tops = c.topups.slice(0, 40).map((e) => `<tr><td class="pp-mono">${short(e.time)}</td><td class="pp-mono">${esc(e.card || '(account)')}</td><td class="pp-num">+${this.money(e.credits)}</td></tr>`).join('');
            this.openWin({
                kind: 'customer', title: `Customer Info - ${name || c.id}`, width: 700, cls: 'pp-custwin', head: `${esc(name || '(no name)')} <small>${esc(c.id || '')}</small>`, tone: 'blue', icon: 'customer',
                body: `<div class="pp-cust">
                    <div class="pp-cust-left">
                        <div class="pp-wallet"><span>Wallet Balance</span><b>${this.money(c.credits)}</b><small>${c.credits} credit(s)</small></div>
                        <label class="pp-check"><input type="checkbox" class="pp-fp"${c.freePlay ? ' checked' : ''}> Free Play${left !== null ? ` <span class="pp-dim">(${left} minute(s) left)</span>` : ''}</label>
                        ${this.field('Customer ID', 'pp-id', { value: c.id, ro: true })}
                        ${this.field('Customer Name', 'pp-name', { value: name })}
                        ${this.field('Contact Info', 'pp-contact', { value: c.contact })}
                        ${this.field('Notes', 'pp-notes', { area: true, value: c.notes })}
                        <div class="pp-row-btns"><button type="button" class="pp-btn is-green" data-v="deposit">Deposit...</button><button type="button" class="pp-btn" data-v="addcard">+ Card</button></div>
                        <div class="pp-cards">${cards || '<p class="pp-dim">No cards.</p>'}</div>
                    </div>
                    <div class="pp-cust-right">
                        <div class="pp-sub">Plays <span class="pp-dim">(${c.history.length})</span></div>
                        <div class="pp-mini"><table class="pp-grid"><thead><tr><th>Time</th><th>Machine</th><th>Card</th><th class="pp-num">Cost</th><th></th></tr></thead><tbody>${plays || '<tr><td colspan="5" class="pp-dim">None</td></tr>'}</tbody></table></div>
                        <div class="pp-sub">Deposits <span class="pp-dim">(${c.topups.length})</span></div>
                        <div class="pp-mini pp-mini-short"><table class="pp-grid"><thead><tr><th>Time</th><th>Card</th><th class="pp-num">Amount</th></tr></thead><tbody>${tops || '<tr><td colspan="3" class="pp-dim">None</td></tr>'}</tbody></table></div>
                    </div>
                </div>`,
                buttons: [
                    { text: 'Update', value: 'update', def: true },
                    { text: c.locked ? 'Unlock' : 'Lock', value: 'lock' },
                    { text: 'Delete', value: 'delete', cls: 'is-red' },
                    { text: 'Close', value: 'cancel' }],
                init: (w) => {
                    w.modal.addEventListener('click', async (ev) => {
                        const b = ev.target.closest('[data-card-op]');
                        if (!b) return;
                        const serial = b.closest('[data-card]').dataset.card;
                        const box = b.closest('[data-card]');
                        const o = b.dataset.cardOp;
                        let r;
                        if (o === 'update') r = await this.op({ op: 'updatecard', card: serial, name: box.querySelector('.pp-cname').value, contact: box.querySelector('.pp-ccontact').value }, `Update card ${serial}`);
                        else if (o === 'lock' || o === 'unlock') r = await this.op({ op: 'lockcard', card: serial, lock: o === 'lock' }, `${o === 'lock' ? 'Lock' : 'Unlock'} card ${serial}`);
                        else if (o === 'delete') {
                            if (!await this.ask(`Delete card ${serial}?\n\nThe card stops working at every machine.`)) return;
                            r = await this.op({ op: 'deletecard', card: serial }, `Delete card ${serial}`);
                        }
                        if (r && r.ok) { w.close(); void this.refresh(); void this.openCustomer({ id: c.id }); }
                    });
                },
                onButton: async (v, w) => {
                    if (v === 'deposit') { this.depositWin({ id: c.id }); return false; }
                    let r;
                    if (v === 'update') r = await this.op({ op: 'updateuser', id: c.id, name: w.val('.pp-name'), contact: w.val('.pp-contact'), notes: w.val('.pp-notes'), freePlay: w.q('.pp-fp').checked }, 'Update customer');
                    else if (v === 'lock') r = await this.op({ op: 'lockuser', id: c.id, lock: !c.locked }, c.locked ? 'Unlock customer' : 'Lock customer');
                    else if (v === 'addcard') r = await this.op({ op: 'addcard', id: c.id, pos: this.pos }, `Add a card to ${name || c.id} (scan the new card)`);
                    else if (v === 'delete') {
                        if (!await this.ask(`Delete customer ${name || c.id}?\n\nTheir balance of ${this.money(c.credits, true)} and all of their cards are removed.`)) return false;
                        r = await this.op({ op: 'deleteuser', id: c.id }, 'Delete customer');
                        if (r.ok) { void this.refresh(); return true; }
                        return false;
                    }
                    if (r && r.ok) { w.close(); void this.refresh(); void this.openCustomer({ id: c.id }); }
                    return false;
                }
            });
        }

        machineName(mac) {
            const m = this.data && this.data.machines.find((x) => x.mac === String(mac || '').toUpperCase());
            return m ? m.name : mac;
        }

        // ---------------------------------------------------------------- F4 Transfer, F6 Free Play

        async transfer() {
            if (!await this.ask('Card Transfer\n\nTap the OLD card on the POS terminal, then the NEW card. The new card takes over the customer and the old card is removed.\n\nContinue?')) return;
            const r = await this.op({ op: 'transfer', pos: this.pos }, 'Card transfer (old card, then new card)');
            if (r.ok) void this.refresh();
        }

        freePlayWin() {
            const d = this.data;
            if (!d) return;
            const sw = (key, label, on) => `<div class="pp-fprow" data-fp="${esc(key)}"><span>${label}</span><span class="pp-fpsw${on ? ' is-on' : ''}"><button type="button" class="pp-fpb" data-fpv="1">ON</button><button type="button" class="pp-fpb" data-fpv="0">OFF</button></span></div>`;
            this.openWin({
                kind: 'freeplay', title: 'Free Play Config', width: 400, head: 'Free Play Config', tone: 'amber', icon: 'freeplay',
                body: `${sw('global', '<b>Global</b>', d.freePlay)}${d.machines.map((m) => sw(m.mac, esc(m.name), m.freePlay)).join('')}
                    ${this.field('Time limit for ON (hours)', 'pp-hours', { type: 'number', ph: 'Blank is unlimited' })}`,
                buttons: [{ text: 'Revoke All Customer(s) Free Play', value: 'revoke', cls: 'is-red' }, { text: 'Close', value: 'cancel', def: true }],
                init: (w) => {
                    w.modal.addEventListener('click', async (ev) => {
                        const b = ev.target.closest('[data-fpv]');
                        if (!b) return;
                        const row = b.closest('[data-fp]');
                        const on = b.dataset.fpv === '1';
                        const key = row.dataset.fp;
                        const f = key === 'global' ? { op: 'arcadefreeplay', enable: on } : { op: 'machinefreeplay', mac: key, enable: on };
                        f.hours = on ? (w.val('.pp-hours') || undefined) : undefined;
                        const r = await this.op(f, `Free play ${on ? 'on' : 'off'}: ${key === 'global' ? 'Global' : this.machineName(key)}`);
                        if (r.ok) { row.querySelector('.pp-fpsw').classList.toggle('is-on', on); void this.refresh(); }
                    });
                },
                onButton: async (v) => {
                    if (v !== 'revoke') return false;
                    if (!await this.ask('Revoke free play from every customer?')) return false;
                    const r = await this.op({ op: 'revokefreeplay' }, 'Revoke all customer free play');
                    if (r.ok) void this.refresh();
                    return false;
                }
            });
        }

        about() {
            this.openWin({
                kind: 'about', title: 'About PayPass Operator', width: 380, cls: 'pp-aboutwin',
                body: `<div class="pp-about-band"><img src="${A}/paypass-wordmark.png" alt="PayPass" width="195" height="45"></div><div class="pp-about"><img src="${A}/paypass-48.png" alt="" width="48" height="48"><div><b>PayPass Operator</b><br>openCreditIC front desk console<br>Version ${VERSION}<br>AmusementVISION 2024<br><br>Server: ${esc(this.data ? this.data.arcade : '-')}<br>Terminal: ${esc(this.termName())}</div></div>`,
                buttons: [{ text: 'OK', value: 'cancel', def: true }]
            });
        }
    }

    let running = null;

    function start(app) {
        if (running) { call('bringModalToFront', running.modal); app.exit(); return; }
        const p = new PayPass(app);
        running = p;
        app.onExit(() => { if (running === p) running = null; p.destroy(); });
    }

    root.melatonPayPass = { start, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('paypass', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
