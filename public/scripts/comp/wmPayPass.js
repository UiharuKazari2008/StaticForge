/**
 * Melaton Mobile: PayPass, a phone version of PayPass Operator (apps/paypass, the openCreditIC front
 * desk, Toolbox launchId 'paypass'), Yozora #732 (parent #709). Not the desktop window re-hosted: the
 * same server packets the desktop client sends (paypass_overview / paypass_customer / paypass_action /
 * paypass_wait, modules/paypass.js through 299-paypassHandler.js, admins only) on WM 6.1 screens.
 *
 *   main         the PayPass band (arcade, ONLINE lamp), tabs at the bottom:
 *                Customers  "Enter a name, ID or card..." box, Contacts-style rows (name, balance,
 *                           ID / cards / Free Play / Locked / last play); tap opens, hold = menu
 *                Machines   each machine: lamp (played in the last hour), Free Play, the last player and
 *                           cost, today's players / plays / takings; tap = its page
 *                Arcade     server state, global free play, customers, total balance, the POS terminal
 *                           (combo; scans use it), readers with a pending command
 *                soft keys  Lookup / Menu (Register, Deposit, Lookup, Scan Card, Transfer, Free Play,
 *                           Refresh, About)
 *   customer     Contacts' card: name band, wallet, tabs Summary | Plays | Deposits | Cards; soft keys
 *                Deposit / Menu (Free Play, Edit, Lock, Add Card, Delete, Refresh); a card's tap = its menu
 *   forms        Deposit (credits or free play, to a scan / customer ID / card S/N), Register (tabs
 *                Customer | Card), Lookup, Edit Customer, Edit Card, Free Play config; full-screen WM
 *                forms with their own soft keys (no ok in the title bar)
 *   scan         "Scan card now!" while the POS reader waits; Cancel cancels the pending command
 *
 * Every write asks first (a Yes / No question box naming what will change and for whom), then runs
 * under the wait cursor; errors are message boxes (they answer the tap), the background refresh's
 * failure is a notification. X asks while a request or a scan is under way (closeQuestion).
 * Styles: public/css/wm-paypass.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'paypass-mobile';
    const TITLE = 'PayPass';
    const ICON = 'app-paypass';
    const A = '/melaton-apps/paypass/assets';
    const POS_KEY = 'wmPayPassPos';
    const REFRESH_MS = 60000;
    const pad = (n) => String(n).padStart(2, '0');
    const clock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const short = (t) => { if (!t) return '-'; const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${clock(t)}`; };
    const stamp = (t) => { if (!t) return '-'; const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${clock(t)}`; };
    const span = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
    const ico = (name) => `<img class="wpp-ico" src="${A}/icons/${name}.png" alt="" draggable="false">`;
    const decode = (s) => { try { return decodeURIComponent(String(s || '')); } catch (_) { return String(s || ''); } };

    let sh = null;
    let esc = (s) => String(s == null ? '' : s);
    let page = null;
    let data = null;
    let loadedAt = 0;
    let online = null;
    let tab = 'customers';
    let search = '';
    let selectedId = null;
    let pos = '';
    let layers = []; // { kind: 'customer' | 'machine' | 'form' | 'scan', ... }
    let working = 0;
    let scan = null; // { what, settle }
    let timer = null;
    let shown = false;

    const top = () => layers[layers.length - 1] || null;
    const isCurrent = () => !!sh && sh.current === APP_ID;

    // ---------------------------------------------------------------- server (the desktop client's calls)

    async function send(type, payload) {
        const ws = window.wsClient;
        if (!ws || typeof ws.sendMessage !== 'function' || (typeof ws.isConnected === 'function' && !ws.isConnected())) throw new Error('The server connection is down.');
        let r = await ws.sendMessage(type, payload || {}, false);
        if (r && r.data !== undefined) r = r.data;
        if (r && r.error) {
            const err = new Error(r.error.details || r.error.message || 'PayPass error');
            err.code = r.error.code;
            throw err;
        }
        return r;
    }

    async function load() {
        data = await send('paypass_overview', {});
        loadedAt = Date.now();
        online = true;
        try { pos = localStorage.getItem(POS_KEY) || pos; } catch (_) { /* private */ }
        if (!pos || !data.pos.some((p) => p.mac === pos)) pos = data.pos[0] ? data.pos[0].mac : '';
    }

    let offlineNoted = false; // a background refresh failed: noted once until the server answers again

    async function refresh(opts = {}) {
        try {
            if (opts.quiet) await load();
            else await sh.busy(load, { paint: true });
            offlineNoted = false;
        } catch (err) {
            online = false;
            const text = `The PayPass server could not be reached.\n\n${(err && err.message) || ''}`.trim();
            // a background refresh: one notification per outage, not one every few seconds
            if (opts.quiet) { if (!offlineNoted) { offlineNoted = true; sh.notify({ title: TITLE, icon: 'error', text, asNote: true }); } } else await box(text, 'error');
        }
        renderMain();
        const t = top();
        if (t && t.kind === 'machine') renderLayer();
    }

    /** Credits as the arcade shows them: yen when it has a currency rate, else credits (the desktop's rule). */
    function money(credits) {
        const c = data && data.currency;
        const n = Number(credits) || 0;
        if (c) return `${c.symbol}${Math.round(n * c.rate).toLocaleString('en-US')}`;
        return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} Cr`;
    }

    const creditsText = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} credit(s)${data && data.currency ? ` (${money(n)})` : ''}`;
    const termName = () => { const p = data && data.pos.find((x) => x.mac === pos); return p ? p.name : '(none)'; };
    const machineName = (mac) => { const m = data && data.machines.find((x) => x.mac === String(mac || '').toUpperCase()); return m ? m.name : String(mac || '-'); };
    const custName = (c) => decode(c && c.name) || '(no name)';

    // ---------------------------------------------------------------- boxes

    function box(text, kind) {
        return sh.messageBox({ title: TITLE, icon: kind || 'info', text, buttons: [{ text: 'ok', value: true }] });
    }

    async function ask(text, kind) {
        const v = await sh.messageBox({ title: TITLE, icon: kind || 'question', text, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        return v === true;
    }

    /**
     * Run an operation (paypass_action). Scan operations arm the POS reader and open the scan screen
     * until the card is read, the reader gives up, or Cancel. Resolves { ok, customer?, message? }.
     */
    async function op(fields, what) {
        let r;
        working++;
        try {
            r = await sh.busy(() => send('paypass_action', fields), { paint: true, timeout: 20000 });
        } catch (err) {
            working--;
            await box(`${what} failed.\n\n${(err && err.message) || ''}`.trim(), 'error');
            return { ok: false };
        }
        working--;
        if (!r || !r.ok) {
            await box(`${(r && r.message) || 'The PayPass server refused the request.'}${r && r.code ? `\n\n(HTTP ${r.code})` : ''}`, 'error');
            return { ok: false };
        }
        if (!r.scan) return { ok: true, message: r.message || '' };
        return scanWait(!!r.lookup, what);
    }

    // ---------------------------------------------------------------- the scan screen

    function scanWait(lookup, what) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (v) => { if (settled) return; settled = true; scan = null; resolve(v); };
            scan = {
                what,
                terminal: termName(),
                cancel: async () => {
                    if (settled) return;
                    finish({ ok: false, cancelled: true });
                    try { await send('paypass_action', { op: 'cancel', pos }); } catch (_) { /* the reader times out anyway */ }
                }
            };
            push({ kind: 'scan' });
            send('paypass_wait', { pos, lookup }).then((r) => {
                if (settled) return;
                finish(r && r.done ? { ok: true, customer: r.customer } : { ok: false });
                popKind('scan');
                if (!r || !r.done) void box((r && r.message) || 'No card was scanned.', 'warning');
            }).catch((err) => {
                if (settled) return;
                finish({ ok: false });
                popKind('scan');
                void box((err && err.message) || 'The scan failed.', 'error');
            });
        });
    }

    // ---------------------------------------------------------------- layers

    function push(layer) {
        layers.push(layer);
        renderLayer();
        sh.syncHistory();
    }

    function pop() {
        const l = layers.pop();
        if (l && l.kind === 'scan' && scan) void scan.cancel();
        renderLayer();
        return !!l;
    }

    /** Remove the top layer of a kind without a history step (the scan ending on its own). */
    function popKind(kind) {
        const t = top();
        if (!t || t.kind !== kind) return;
        layers.pop();
        renderLayer();
        sh.syncHistory();
    }

    function renderLayer() {
        if (!page) return;
        const t = top();
        page.querySelector('.wpp-main').hidden = !!t;
        const host = page.querySelector('.wpp-layer');
        host.hidden = !t;
        if (!t) host.innerHTML = '';
        else if (t.kind === 'customer') renderCustomer(t, host);
        else if (t.kind === 'machine') renderMachine(t, host);
        else if (t.kind === 'form') renderForm(t, host);
        else if (t.kind === 'scan') renderScan(host);
        if (isCurrent()) {
            sh.refreshSoftKeys();
            sh.refreshTitleAction();
        }
    }

    // ---------------------------------------------------------------- main

    function matches(u, q) {
        if (!q) return true;
        const s = q.toLowerCase();
        return [u.id, decode(u.name), u.contact, ...u.cards.map((c) => c.serial)].some((v) => String(v || '').toLowerCase().includes(s));
    }

    const visibleUsers = () => (data ? data.users.filter((u) => matches(u, search)).sort((a, b) => (b.lastPlay || 0) - (a.lastPlay || 0)) : []);

    function renderMain() {
        if (!page) return;
        const m = page.querySelector('.wpp-main');
        m.querySelector('.wpp-arcade').textContent = data ? data.arcade : (online === false ? 'Server not reachable' : 'Connecting...');
        const lamp = m.querySelector('.wpp-lamp');
        lamp.classList.toggle('is-on', online === true);
        lamp.textContent = online === true ? 'ONLINE' : 'OFFLINE';
        m.querySelectorAll('.wm-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
        m.querySelectorAll('.wpp-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
        if (tab === 'customers') renderCustomers();
        else if (tab === 'machines') renderMachines();
        else renderArcade();
        if (isCurrent() && !top()) sh.refreshSoftKeys();
    }

    function renderCustomers() {
        const users = visibleUsers();
        if (!users.some((u) => u.id && u.id === selectedId)) selectedId = (users.find((u) => u.id) || {}).id || null;
        const pane = page.querySelector('.wpp-pane[data-pane="customers"]');
        const nomatch = pane.querySelector('.wpp-nomatch');
        nomatch.hidden = !(search && !users.length && data && data.users.length);
        nomatch.textContent = `No matches: ${search}`;
        const note = pane.querySelector('.wpp-note');
        note.hidden = !!(data && data.users.length);
        note.textContent = data ? 'No customers. Register one from Menu > Register.' : (online === false ? 'The PayPass server could not be reached. Menu > Refresh tries again.' : '');
        pane.querySelector('.wpp-list').innerHTML = users.map((u) => {
            const sel = !!u.id && u.id === selectedId;
            const bits = [u.id || 'no card', `${u.cards.length} card${u.cards.length === 1 ? '' : 's'}`];
            if (u.lastPlay) bits.push(`played ${short(u.lastPlay)}`);
            return `<div class="wpp-row${sel ? ' is-selected' : ''}${u.id ? '' : ' is-orphan'}" role="option" aria-selected="${sel}"${u.id ? ` data-id="${esc(u.id)}"` : ''}>`
                + `<span class="wpp-row-ico">${ico('customer')}</span>`
                + `<span class="wpp-row-name">${esc(decode(u.name) || '(no name)')}</span>`
                + `<span class="wpp-row-right">${esc(money(u.credits))}</span>`
                + `<span class="wpp-row-sub">${u.freePlay ? '<span class="wpp-badge is-free">Free Play</span>' : ''}${u.locked ? '<span class="wpp-badge is-bad">Locked</span>' : ''}<span class="wpp-t">${esc(bits.join(', '))}</span></span></div>`;
        }).join('');
    }

    function machineSub(mc) {
        const l = mc.last;
        if (!l) return 'No plays yet';
        return `${l.userName || '-'}, ${l.freePlay ? 'Free Play' : money(l.cost)}${l.ok ? '' : ', refused'}, ${short(l.time)}`;
    }

    function renderMachines() {
        const pane = page.querySelector('.wpp-pane[data-pane="machines"]');
        const list = data ? data.machines : [];
        pane.querySelector('.wpp-machs').innerHTML = list.map((mc) => `<div class="wpp-row wpp-mrow" data-mac="${esc(mc.mac)}">`
            + `<span class="wpp-row-ico">${ico('machine')}</span>`
            + `<span class="wpp-row-name">${esc(mc.name)}</span>`
            + `<span class="wpp-row-right"><span class="wpp-led${mc.active ? ' is-on' : ''}" title="${mc.active ? 'Played in the last hour' : 'Idle'}"></span></span>`
            + `<span class="wpp-row-sub">${mc.freePlay ? '<span class="wpp-badge is-free">Free Play</span>' : ''}<span class="wpp-t">${esc(machineSub(mc))}</span></span>`
            + `<span class="wpp-row-sub2">Today: ${mc.day.users} player(s), ${mc.day.plays} play(s), ${esc(money(mc.day.earned))}</span></div>`).join('');
        const note = pane.querySelector('.wpp-note');
        note.hidden = !!list.length;
        note.textContent = data ? 'No machines have checked in.' : '';
    }

    function renderArcade() {
        const pane = page.querySelector('.wpp-pane[data-pane="arcade"] .wm-form');
        if (!data) { pane.innerHTML = `<p>${online === false ? 'The PayPass server could not be reached.' : 'Reading the PayPass server...'}</p>`; return; }
        const total = data.users.reduce((s, u) => s + u.credits, 0);
        const row = (l, v) => `<div class="wm-form-row is-wide"><span class="wm-form-label">${esc(l)}:</span><span class="wm-form-value">${v}</span></div>`;
        pane.innerHTML = row('Arcade', esc(data.arcade))
            + row('Server', online ? 'Online' : 'Offline')
            + row('Global Free Play', data.freePlay ? '<b>On</b>' : 'Off')
            + row('Customers', String(data.users.length))
            + row('Total balance', esc(money(total)))
            + row('Machines', String(data.machines.length))
            + row('Updated', esc(stamp(data.at)))
            + `<div class="wm-form-row is-wide"><label>POS terminal:</label><button type="button" class="wm-combo wpp-pos"${data.pos.length ? '' : ' disabled'}><span>${esc(data.pos.length ? termName() : '(no terminal)')}</span></button></div>`
            + `<p class="wpp-hint">Scans (Lookup, Scan Card, Deposit by scan, Register, Transfer) use this terminal's card reader.</p>`
            + (data.pending.length ? `<div class="wm-form-sub">Readers waiting for a card:</div>${data.pending.map((m) => `<p>${esc((data.pos.find((p) => p.mac === m) || {}).name || m)}</p>`).join('')}` : '')
            + '<div class="wm-buttons"><button type="button" class="wm-button" data-act="freeplay">Free Play...</button></div>';
    }

    function choosePos(anchor) {
        if (!data || !data.pos.length) return;
        sh.dropdown(anchor, data.pos.map((p) => ({
            label: p.name,
            radio: p.mac === pos,
            action: () => {
                pos = p.mac;
                try { localStorage.setItem(POS_KEY, pos); } catch (_) { /* private */ }
                renderMain();
            }
        })), 'left');
    }

    // ---------------------------------------------------------------- customer

    async function openCustomer(q, replace) {
        let c;
        try {
            c = await sh.busy(() => send('paypass_customer', q), { paint: true });
        } catch (err) {
            await box(`The customer could not be read.\n\n${(err && err.message) || ''}`.trim(), 'error');
            return;
        }
        showCustomer(c, replace);
    }

    function showCustomer(c, replace) {
        if (c && c.id) selectedId = c.id;
        const t = top();
        if (replace && t && t.kind === 'customer') { t.c = c; renderLayer(); return; }
        push({ kind: 'customer', c, tab: 'summary' });
    }

    async function reloadCustomer(id) {
        void refresh({ quiet: true });
        const t = layers.find((l) => l.kind === 'customer' && l.c.id === id);
        if (!t) return;
        try {
            t.c = await sh.busy(() => send('paypass_customer', { id }), { paint: true });
            if (top() === t) renderLayer();
        } catch (_) { /* the card stays as it was */ }
    }

    function renderCustomer(t, host) {
        const c = t.c;
        const left = c.freePlay && c.freePlayUntil ? Math.max(0, Math.round((c.freePlayUntil - Date.now()) / 60000)) : null;
        const row = (l, v) => (v === '' || v == null ? '' : `<div class="wpp-crow"><span class="wpp-clabel">${esc(l)}:</span><span class="wpp-cvalue">${v}</span></div>`);
        let body = '';
        if (t.tab === 'summary') {
            body = `<div class="wpp-wallet"><span>Wallet balance</span><b>${esc(money(c.credits))}</b><small>${esc(creditsText(c.credits))}</small></div>
                <div class="wpp-crows">${row('Customer ID', esc(c.id || '-'))}${row('Free Play', c.freePlay ? `On${left !== null ? ` (${left} min left)` : ' (no limit)'}` : 'Off')}${row('Status', c.locked ? '<span class="wpp-badge is-bad">Locked</span>' : 'Active')}${row('Contact', esc(c.contact))}${row('Cards', String(c.cards.length))}${row('Plays', String(c.history.length))}${row('Created', c.created ? esc(stamp(c.created)) : '')}</div>
                ${c.notes ? `<div class="wpp-csub">Notes:</div><div class="wpp-cnotes">${esc(c.notes)}</div>` : ''}`;
        } else if (t.tab === 'plays') {
            body = c.history.length ? c.history.map((e) => `<div class="wpp-row is-static"><span class="wpp-row-ico">${ico('machine')}</span><span class="wpp-row-name">${esc(machineName(e.machine))}</span><span class="wpp-row-right">${e.freePlay ? 'Free' : esc(money(e.cost))}</span><span class="wpp-row-sub">${e.ok ? '' : '<span class="wpp-badge is-bad">Refused</span>'}${e.discount ? '<span class="wpp-badge">Discount</span>' : ''}<span class="wpp-t">${esc(stamp(e.time))}, card ${esc(e.card || '-')}</span></span></div>`).join('') : '<p class="wpp-note">No plays.</p>';
        } else if (t.tab === 'deposits') {
            body = c.topups.length ? c.topups.map((e) => `<div class="wpp-row is-static"><span class="wpp-row-ico">${ico('deposit')}</span><span class="wpp-row-name">+${esc(money(e.credits))}</span><span class="wpp-row-right"></span><span class="wpp-row-sub"><span class="wpp-t">${esc(stamp(e.time))}, ${esc(e.card || 'account')}</span></span></div>`).join('') : '<p class="wpp-note">No deposits.</p>';
        } else {
            body = c.cards.length ? c.cards.map((k) => `<div class="wpp-row" data-card="${esc(k.serial)}"><span class="wpp-row-ico">${ico(k.locked ? 'lock' : 'register')}</span><span class="wpp-row-name">${esc(k.serial)}</span><span class="wpp-row-right"></span><span class="wpp-row-sub">${k.locked ? '<span class="wpp-badge is-bad">Locked</span>' : ''}<span class="wpp-t">${esc(k.name || '(no name)')}${k.contact ? `, ${esc(k.contact)}` : ''}</span></span></div>`).join('') : '<p class="wpp-note">No cards.</p>';
        }
        const tabs = [['summary', 'Summary'], ['plays', 'Plays'], ['deposits', 'Deposits'], ['cards', 'Cards']];
        host.innerHTML = `<div class="wpp-card">
            <div class="wpp-card-head">${ico('customer')}<span class="wpp-card-name">${esc(custName(c))}</span>${c.locked ? '<span class="wpp-badge is-bad">Locked</span>' : ''}${c.freePlay ? '<span class="wpp-badge is-free">Free Play</span>' : ''}</div>
            <div class="wpp-scroll wpp-card-body" data-tab="${t.tab}">${body}</div>
            <div class="wm-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" class="wm-tab" role="tab" data-ctab="${k}" aria-selected="${t.tab === k}">${l}</button>`).join('')}</div>
        </div>`;
    }

    function customerMenu(c) {
        if (!c) return [];
        return [
            { label: 'Deposit...', action: () => depositForm({ id: c.id, name: custName(c) }) },
            { label: 'Free Play...', action: () => depositForm({ id: c.id, name: custName(c), free: true }) },
            '-',
            { label: 'Edit...', action: () => editCustomerForm(c) },
            { label: c.locked ? 'Unlock' : 'Lock', action: () => lockCustomer(c) },
            { label: 'Add Card (scan)...', disabled: !pos, action: () => addCard(c) },
            '-',
            { label: 'Delete...', action: () => deleteCustomer(c) },
            '-',
            { label: 'Refresh', action: () => reloadCustomer(c.id) }
        ];
    }

    function cardMenu(c, serial) {
        const k = c.cards.find((x) => x.serial === serial);
        if (!k) return [];
        return [
            { label: 'Edit Card...', action: () => editCardForm(c, k) },
            { label: k.locked ? 'Unlock Card' : 'Lock Card', action: () => lockCard(c, k) },
            { label: 'Delete Card...', action: () => deleteCard(c, k) }
        ];
    }

    async function lockCustomer(c) {
        if (!await ask(`${c.locked ? 'Unlock' : 'Lock'} ${custName(c)} (${c.id})?${c.locked ? '' : '\n\nTheir cards stop working at every machine until unlocked.'}`, c.locked ? 'question' : 'warning')) return;
        const r = await op({ op: 'lockuser', id: c.id, lock: !c.locked }, c.locked ? 'Unlock customer' : 'Lock customer');
        if (r.ok) void reloadCustomer(c.id);
    }

    async function addCard(c) {
        if (!await ask(`Add a card to ${custName(c)}?\n\nTap the new card on ${termName()} when asked.`)) return;
        const r = await op({ op: 'addcard', id: c.id, pos }, `Add a card to ${custName(c)}`);
        if (r.ok) void reloadCustomer(c.id);
    }

    async function deleteCustomer(c) {
        if (!await ask(`Delete customer ${custName(c)} (${c.id})?\n\nTheir balance of ${money(c.credits)} and all of their cards are removed. This cannot be undone.`, 'warning')) return;
        const r = await op({ op: 'deleteuser', id: c.id }, 'Delete customer');
        if (!r.ok) return;
        layers = layers.filter((l) => !(l.kind === 'customer' && l.c.id === c.id));
        renderLayer();
        sh.syncHistory();
        void refresh({ quiet: true });
        await box(`Customer ${custName(c)} was deleted.`, 'info');
    }

    async function lockCard(c, k) {
        if (!await ask(`${k.locked ? 'Unlock' : 'Lock'} card ${k.serial}?`, k.locked ? 'question' : 'warning')) return;
        const r = await op({ op: 'lockcard', card: k.serial, lock: !k.locked }, `${k.locked ? 'Unlock' : 'Lock'} card ${k.serial}`);
        if (r.ok) void reloadCustomer(c.id);
    }

    async function deleteCard(c, k) {
        if (!await ask(`Delete card ${k.serial}?\n\nThe card stops working at every machine.`, 'warning')) return;
        const r = await op({ op: 'deletecard', card: k.serial }, `Delete card ${k.serial}`);
        if (r.ok) void reloadCustomer(c.id);
    }

    // ---------------------------------------------------------------- machine

    function renderMachine(t, host) {
        const mc = data && data.machines.find((x) => x.mac === t.mac);
        if (!mc) { host.innerHTML = '<p class="wpp-note">This machine is no longer listed.</p>'; return; }
        const l = mc.last;
        const s = mc.session;
        const row = (k, v) => `<div class="wpp-crow"><span class="wpp-clabel">${esc(k)}:</span><span class="wpp-cvalue">${v}</span></div>`;
        host.innerHTML = `<div class="wpp-card">
            <div class="wpp-card-head">${ico('machine')}<span class="wpp-card-name">${esc(mc.name)}</span>${mc.freePlay ? '<span class="wpp-badge is-free">Free Play</span>' : ''}</div>
            <div class="wpp-scroll wpp-card-body"><div class="wpp-crows">
                ${row('State', mc.active ? 'Played in the last hour' : 'Idle')}
                ${row('Free Play', mc.freePlay ? '<b>On</b>' : 'Off')}
                ${row('Last player', l ? esc(l.userName || '-') : '-')}
                ${row('Last play', l ? `${l.freePlay ? 'Free Play' : esc(money(l.cost))}${l.ok ? '' : ' <span class="wpp-badge is-bad">Refused</span>'}` : '-')}
                ${row('Time', l ? esc(stamp(l.time)) : '-')}
                ${row('Session', s && s.count > 1 ? `${s.count} plays in ${esc(span(s.end - s.start))}, ${esc(money(s.total))}` : '-')}
                ${row('Today', `${mc.day.users} player(s), ${mc.day.plays} play(s)`)}
                ${row('Taken today', esc(money(mc.day.earned)))}
                ${row('All plays', String(mc.plays))}
                ${row('Reader', esc(mc.mac))}
            </div></div>
        </div>`;
    }

    async function machineFreePlay(mc, on) {
        const hours = on ? await sh.messageBox({ title: TITLE, icon: 'question', text: `Turn free play ON for ${mc.name}?\n\nTime limit in hours (blank for no limit):`, input: { value: '', placeholder: 'No limit' }, buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }] }) : null;
        if (on && hours == null) return;
        if (!on && !await ask(`Turn free play OFF for ${mc.name}?`)) return;
        const r = await op({ op: 'machinefreeplay', mac: mc.mac, enable: on, hours: on && hours ? hours : undefined }, `Free play ${on ? 'on' : 'off'}: ${mc.name}`);
        if (r.ok) await refresh();
    }

    // ---------------------------------------------------------------- forms

    /**
     * A full-screen WM form: header (green, 23 px), fields, optional tabs at the bottom; soft keys are
     * the form's own (primary / Cancel), so the title bar has no ok.
     */
    function form(o) {
        push(Object.assign({ kind: 'form', tab: o.tabs ? o.tabs[0][0] : null, values: {} }, o));
    }

    function saveValues(t) {
        const host = page && page.querySelector('.wpp-layer');
        if (!host || !t) return;
        host.querySelectorAll('[data-f]').forEach((el) => {
            t.values[el.dataset.f] = el.type === 'checkbox' || el.type === 'radio' ? (el.type === 'radio' ? (el.checked ? el.value : t.values[el.dataset.f]) : el.checked) : el.value;
        });
    }

    function renderForm(t, host) {
        const body = t.render(t);
        host.innerHTML = `<div class="wpp-form">
            <div class="wm-form-hdr">${esc(t.head)}</div>
            <div class="wpp-scroll"><div class="wm-form">${body}</div></div>
            ${t.tabs ? `<div class="wm-tabs" role="tablist">${t.tabs.map(([k, l]) => `<button type="button" class="wm-tab" role="tab" data-ftab="${k}" aria-selected="${t.tab === k}">${esc(l)}</button>`).join('')}</div>` : ''}
        </div>`;
        if (t.init) t.init(t, host);
    }

    const edit = (t, f, label, opts = {}) => `<div class="wm-form-row${opts.wide ? ' is-wide' : ''}"><label for="wpp-${f}">${esc(label)}:</label><input id="wpp-${f}" class="wm-edit" data-f="${f}" type="${opts.type || 'text'}"${opts.type === 'number' ? ' inputmode="decimal" min="0" step="any"' : ''} autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(t.values[f] != null ? t.values[f] : (opts.value || ''))}" placeholder="${esc(opts.ph || '')}"></div>`;
    const area = (t, f, label) => `<div class="wpp-area-row"><label for="wpp-${f}">${esc(label)}:</label><textarea id="wpp-${f}" class="wm-edit wpp-area" data-f="${f}" rows="3">${esc(t.values[f] || '')}</textarea></div>`;
    const radio = (t, f, value, label, extra) => `<label class="wm-check"><input type="radio" name="wpp-${f}" data-f="${f}" value="${value}"${t.values[f] === value ? ' checked' : ''}><span>${label}</span></label>${extra || ''}`;
    const check = (t, f, label) => `<label class="wm-check"><input type="checkbox" data-f="${f}"${t.values[f] ? ' checked' : ''}><span>${esc(label)}</span></label>`;
    const val = (t, f) => String(t.values[f] == null ? '' : t.values[f]).trim();

    function depositForm(preset) {
        const p = preset || {};
        form({
            head: p.free ? 'Free Play' : 'Deposit Credits',
            values: { kind: p.free ? 'free' : 'credits', to: p.id ? 'user' : p.card ? 'card' : 'scan', id: p.id || '', card: p.card || '' },
            render: (t) => {
                const free = t.values.kind === 'free';
                return `<div class="wpp-seg">${radio(t, 'kind', 'credits', 'Credits')}${radio(t, 'kind', 'free', 'Free Play')}</div>
                    ${free ? edit(t, 'hours', 'Hours', { type: 'number', ph: 'No limit' }) : `${edit(t, 'credits', 'Credits', { type: 'number', ph: '0' })}<div class="wm-buttons wpp-presets">${[5, 10, 20, 50, 100].map((n) => `<button type="button" class="wm-button wpp-preset" data-n="${n}">+${n}</button>`).join('')}</div>`}
                    <div class="wm-form-sub">To:</div>
                    ${radio(t, 'to', 'scan', `Scan a card on ${esc(termName())}`)}
                    ${radio(t, 'to', 'user', 'Customer ID')}${t.values.to === 'user' ? edit(t, 'id', 'ID', { value: p.id }) : ''}
                    ${radio(t, 'to', 'card', 'Card serial')}${t.values.to === 'card' ? edit(t, 'card', 'S/N', { value: p.card }) : ''}
                    ${p.name && t.values.to === 'user' && val(t, 'id') === p.id ? `<p class="wpp-hint">Customer: ${esc(p.name)}</p>` : ''}`;
            },
            primary: 'Deposit',
            submit: async (t) => {
                const free = t.values.kind === 'free';
                const to = t.values.to;
                const who = to === 'user' ? `customer ${val(t, 'id')}${p.name && val(t, 'id') === p.id ? ` (${p.name})` : ''}` : to === 'card' ? `card ${val(t, 'card').toUpperCase()}` : `the card scanned on ${termName()}`;
                if (to === 'user' && !val(t, 'id')) { await box('Enter the customer ID.', 'warning'); return; }
                if (to === 'card' && !val(t, 'card')) { await box('Enter the card serial number.', 'warning'); return; }
                if (to === 'scan' && !pos) { await box('There is no POS terminal to scan on.', 'warning'); return; }
                const f = { op: free ? 'freeplay' : 'deposit', target: to, pos, id: val(t, 'id'), card: val(t, 'card') };
                if (free) {
                    f.hours = val(t, 'hours') || undefined;
                    if (!await ask(`Grant free play${f.hours ? ` for ${f.hours} hour(s)` : ' with no time limit'} to ${who}?`)) return;
                } else {
                    const n = Number(val(t, 'credits'));
                    if (!Number.isFinite(n) || n <= 0) { await box('Enter how many credits to deposit.', 'warning'); return; }
                    f.credits = String(n);
                    if (!await ask(`Deposit ${creditsText(n)} to ${who}?`)) return;
                }
                const r = await op(f, free ? 'Grant free play' : `Deposit ${f.credits} credit(s)`);
                if (!r.ok) return;
                popKind('form');
                if (r.customer) showCustomer(r.customer);
                const id = (r.customer && r.customer.id) || (to === 'user' ? f.id : null);
                if (id) void reloadCustomer(id); else void refresh({ quiet: true });
                await box(free ? 'Free play granted.' : `Deposit complete.${r.message ? `\n\n${r.message}` : ''}`, 'info');
            },
            init: (t, host) => {
                host.addEventListener('change', (e) => {
                    if (e.target.name === 'wpp-kind' || e.target.name === 'wpp-to') { saveValues(t); renderForm(t, host); }
                });
                host.addEventListener('click', (e) => {
                    const b = e.target.closest('.wpp-preset');
                    if (!b) return;
                    const i = host.querySelector('[data-f="credits"]');
                    i.value = String((Number(i.value) || 0) + Number(b.dataset.n));
                });
            }
        });
    }

    function registerForm() {
        form({
            head: 'Register Customer',
            tabs: [['customer', 'Customer'], ['card', 'Card']],
            render: (t) => (t.tab === 'card'
                ? `${edit(t, 'card', 'Serial', { ph: 'Blank: scan the card' })}${edit(t, 'cardName', 'Card name')}${edit(t, 'cardContact', 'Contact')}<p class="wpp-hint">Leave the serial blank to tap the new card on ${esc(termName())}.</p>`
                : `${edit(t, 'credits', 'Credits', { type: 'number', ph: '0' })}${edit(t, 'id', 'ID', { ph: 'Blank: random' })}${edit(t, 'name', 'Name')}${edit(t, 'contact', 'Contact')}${area(t, 'notes', 'Notes')}`),
            primary: 'Create',
            submit: async (t) => {
                const card = val(t, 'card');
                if (!card && !pos) { await box('Enter the card serial: there is no POS terminal to scan on.', 'warning'); return; }
                const credits = val(t, 'credits');
                const who = val(t, 'name') || val(t, 'id') || 'a new customer';
                if (!await ask(`Register ${who}${credits ? ` with ${creditsText(Number(credits) || 0)}` : ''}?\n\n${card ? `Card: ${card.toUpperCase()}` : `Tap the new card on ${termName()} when asked.`}`)) return;
                const r = await op({
                    op: 'register', pos, id: val(t, 'id') || undefined, credits: credits || undefined,
                    name: val(t, 'name'), contact: val(t, 'contact'), notes: val(t, 'notes'),
                    card: card || undefined, cardName: val(t, 'cardName'), cardContact: val(t, 'cardContact')
                }, 'Register customer');
                if (!r.ok) return;
                popKind('form');
                void refresh({ quiet: true });
                await box(`${who} is registered.`, 'info');
            }
        });
    }

    function lookupForm() {
        form({
            head: 'Lookup Customer',
            render: (t) => `${edit(t, 'id', 'Customer ID')}${edit(t, 'card', 'Card S/N')}<p class="wpp-hint">Leave both blank to tap the card on ${esc(termName())}.</p>`,
            primary: 'Lookup',
            submit: async (t) => {
                const id = val(t, 'id');
                const card = val(t, 'card');
                if (id || card) { popKind('form'); await openCustomer({ id: id || undefined, card: card || undefined }); return; }
                await scanLookup(true);
            }
        });
    }

    async function scanLookup(fromForm) {
        if (scan) return;
        if (!pos) { await box('There is no POS terminal to scan on.', 'warning'); return; }
        if (!await ask(`Tap the customer's card on ${termName()}?`)) return;
        const r = await op({ op: 'lookup', pos }, 'Lookup customer');
        if (!r.ok || !r.customer) return;
        if (fromForm) popKind('form');
        showCustomer(r.customer);
    }

    function editCustomerForm(c) {
        form({
            head: `Edit ${custName(c)}`,
            values: { name: decode(c.name), contact: c.contact, notes: c.notes, freePlay: c.freePlay },
            render: (t) => `${edit(t, 'name', 'Name')}${edit(t, 'contact', 'Contact')}${area(t, 'notes', 'Notes')}${check(t, 'freePlay', 'Free Play')}`,
            primary: 'Save',
            submit: async (t) => {
                if (!await ask(`Save the changes to ${custName(c)} (${c.id})?`)) return;
                const r = await op({ op: 'updateuser', id: c.id, name: val(t, 'name'), contact: val(t, 'contact'), notes: val(t, 'notes'), freePlay: !!t.values.freePlay }, 'Update customer');
                if (!r.ok) return;
                popKind('form');
                void reloadCustomer(c.id);
            }
        });
    }

    function editCardForm(c, k) {
        form({
            head: `Card ${k.serial}`,
            values: { name: k.name, contact: k.contact },
            render: (t) => `${edit(t, 'name', 'Card name')}${edit(t, 'contact', 'Contact')}`,
            primary: 'Save',
            submit: async (t) => {
                if (!await ask(`Save the changes to card ${k.serial}?`)) return;
                const r = await op({ op: 'updatecard', card: k.serial, name: val(t, 'name'), contact: val(t, 'contact') }, `Update card ${k.serial}`);
                if (!r.ok) return;
                popKind('form');
                void reloadCustomer(c.id);
            }
        });
    }

    function freePlayForm() {
        if (!data) return;
        form({
            head: 'Free Play',
            render: (t) => {
                const sw = (key, label, on) => `<button type="button" class="wm-listbox-row wpp-fprow" data-fp="${esc(key)}"><span class="wpp-fpname">${label}</span><span class="wpp-fpstate${on ? ' is-on' : ''}">${on ? 'ON' : 'OFF'}</span></button>`;
                return `<p>Tap a row to turn its free play on or off.</p>
                    <div class="wm-listbox wpp-fplist">${sw('global', '<b>Global (all machines)</b>', data.freePlay)}${data.machines.map((m) => sw(m.mac, esc(m.name), m.freePlay)).join('')}</div>
                    ${edit(t, 'hours', 'Hours', { type: 'number', ph: 'No limit', wide: true })}
                    <p class="wpp-hint">Hours limits free play turned on here; blank is no limit.</p>
                    <div class="wm-buttons"><button type="button" class="wm-button" data-act="revoke">Revoke All...</button></div>`;
            },
            primary: null,
            init: (t, host) => {
                host.addEventListener('click', async (e) => {
                    const row = e.target.closest('[data-fp]');
                    if (row) {
                        saveValues(t);
                        const key = row.dataset.fp;
                        const mc = key === 'global' ? null : data.machines.find((m) => m.mac === key);
                        const was = key === 'global' ? data.freePlay : !!(mc && mc.freePlay);
                        const on = !was;
                        const name = key === 'global' ? 'every machine (global)' : (mc ? mc.name : key);
                        const hours = on ? val(t, 'hours') : '';
                        if (!await ask(`Turn free play ${on ? 'ON' : 'OFF'} for ${name}${on ? (hours ? ` for ${hours} hour(s)` : ' with no time limit') : ''}?`)) return;
                        const f = key === 'global' ? { op: 'arcadefreeplay', enable: on } : { op: 'machinefreeplay', mac: key, enable: on };
                        f.hours = on && hours ? hours : undefined;
                        const r = await op(f, `Free play ${on ? 'on' : 'off'}: ${name}`);
                        if (r.ok) { await refresh(); if (top() === t) renderForm(t, host); }
                        return;
                    }
                    if (e.target.closest('[data-act="revoke"]')) await revokeAll();
                });
            }
        });
    }

    async function revokeAll() {
        if (!await ask('Revoke free play from every customer?', 'warning')) return;
        const r = await op({ op: 'revokefreeplay' }, 'Revoke all customer free play');
        if (r.ok) { void refresh({ quiet: true }); await box('Free play was revoked from every customer.', 'info'); }
    }

    async function transfer() {
        if (!pos) { await box('There is no POS terminal to scan on.', 'warning'); return; }
        if (!await ask(`Card Transfer\n\nTap the OLD card on ${termName()}, then the NEW card. The new card takes over the customer and the old card is removed.\n\nContinue?`)) return;
        const r = await op({ op: 'transfer', pos }, 'Card transfer (old card, then new card)');
        if (r.ok) { void refresh({ quiet: true }); await box('The card was transferred.', 'info'); }
    }

    function renderScan(host) {
        const s = scan || { what: '', terminal: termName() };
        host.innerHTML = `<div class="wpp-scan">
            <img class="wpp-scan-ico" src="${A}/icons/scan.png" alt="" draggable="false">
            <b>Scan card now!</b>
            <span>${esc(s.what)}</span>
            <span class="wpp-dim">Terminal: ${esc(s.terminal)}</span>
            <span class="wpp-scan-bar"><i></i></span>
        </div>`;
    }

    // ---------------------------------------------------------------- menus and soft keys

    function mainMenu() {
        return [
            { label: 'Register...', disabled: !data, action: registerForm },
            { label: 'Deposit...', disabled: !data, action: () => depositForm() },
            { label: 'Lookup...', disabled: !data, action: lookupForm },
            { label: 'Scan Card', disabled: !data || !pos, action: () => scanLookup(false) },
            { label: 'Transfer Card...', disabled: !data || !pos, action: transfer },
            { label: 'Free Play...', disabled: !data, action: freePlayForm },
            '-',
            { label: 'Refresh', action: () => refresh() },
            { label: 'About PayPass', action: about }
        ];
    }

    function about() {
        void sh.messageBox({ title: TITLE, icon: 'info', text: `PayPass Operator Mobile\nopenCreditIC front desk\nAmusementVISION 2024\n\nArcade: ${data ? data.arcade : '-'}\nTerminal: ${termName()}`, buttons: [{ text: 'ok', value: true }], modal: true });
    }

    function softKeys() {
        const t = top();
        if (!t) {
            const sel = data && selectedId && tab === 'customers' ? data.users.find((u) => u.id === selectedId) : null;
            if (sel) return { left: { label: 'Open', action: () => openCustomer({ id: sel.id }) }, right: { label: 'Menu', menu: mainMenu } };
            return { left: { label: 'Lookup', disabled: !data, action: lookupForm }, right: { label: 'Menu', menu: mainMenu } };
        }
        if (t.kind === 'customer') return { left: { label: 'Deposit', action: () => depositForm({ id: t.c.id, name: custName(t.c) }) }, right: { label: 'Menu', menu: () => customerMenu(t.c) } };
        if (t.kind === 'machine') {
            const mc = data && data.machines.find((x) => x.mac === t.mac);
            return {
                left: { label: mc && mc.freePlay ? 'Free Off' : 'Free Play', disabled: !mc, action: () => machineFreePlay(mc, !mc.freePlay) },
                right: { label: 'Menu', menu: () => [{ label: 'Last Player', disabled: !(mc && mc.last && mc.last.user), action: () => openCustomer({ id: mc.last.user }) }, '-', { label: 'Refresh', action: () => refresh() }] }
            };
        }
        if (t.kind === 'scan') return { left: null, right: { label: 'Cancel', action: () => { if (scan) void scan.cancel(); popKind('scan'); } } };
        if (t.kind === 'form') {
            const cancel = { label: 'Cancel', action: () => { pop(); sh.syncHistory(); } };
            if (!t.primary) return { left: { label: 'Done', action: () => { pop(); sh.syncHistory(); } }, right: { label: 'Menu', menu: () => [{ label: 'Revoke All Customers...', action: revokeAll }, { label: 'Refresh', action: async () => { await refresh(); if (top() === t) renderLayer(); } }] } };
            return {
                left: {
                    label: t.primary,
                    action: async () => {
                        if (t.running) return;
                        saveValues(t);
                        t.running = true;
                        try { await t.submit(t); } finally { t.running = false; }
                    }
                },
                right: cancel
            };
        }
        return { left: null, right: null };
    }

    function closeQuestion() {
        if (scan) return `A card scan is waiting on ${scan.terminal}. Cancel it and close PayPass?`;
        if (working > 0) return 'A request is still being sent to the PayPass server. Close PayPass?';
        return null;
    }

    // ---------------------------------------------------------------- page

    function onHold(el, selector, fn) {
        let t = null;
        let start = null;
        let held = false;
        const clear = () => { clearTimeout(t); t = null; };
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            held = false;
            const row = e.target.closest(selector);
            if (!row) return;
            start = { x: e.clientX, y: e.clientY };
            clear();
            t = setTimeout(() => { held = true; fn(row, start.x, start.y); }, ((window.wmShell && window.wmShell.holdMs) || 550));
        });
        el.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => el.addEventListener(n, clear));
        el.addEventListener('contextmenu', (e) => {
            const row = e.target.closest(selector);
            if (!row) return;
            e.preventDefault();
            if (held) return;
            held = true;
            clear();
            fn(row, e.clientX, e.clientY);
        });
        el.addEventListener('click', (e) => {
            if (!held) return;
            held = false;
            e.stopPropagation();
            e.preventDefault();
        }, true);
    }

    function selectRow(id) {
        selectedId = id;
        page.querySelectorAll('.wpp-pane[data-pane="customers"] .wpp-row').forEach((r) => {
            const on = r.dataset.id === id;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function mount(p) {
        page = p;
        data = null;
        online = null;
        layers = [];
        scan = null;
        working = 0;
        search = '';
        p.classList.add('wm-paypass');
        p.innerHTML = `
            <div class="wpp-main">
                <div class="wpp-band"><img class="wpp-band-ico" src="${A}/paypass-32.png" alt="" draggable="false"><span class="wpp-band-text"><b>PayPass</b><small class="wpp-arcade">Connecting...</small></span><span class="wpp-lamp">OFFLINE</span></div>
                <div class="wpp-pane" data-pane="customers">
                    <div class="wpp-searchbar"><input class="wpp-search" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Enter a name, ID or card..." aria-label="Find a customer"></div>
                    <div class="wpp-nomatch" hidden></div>
                    <div class="wpp-scroll"><div class="wpp-list" role="listbox" aria-label="Customers"></div><p class="wpp-note" hidden></p></div>
                </div>
                <div class="wpp-pane" data-pane="machines" hidden><div class="wpp-scroll"><div class="wpp-machs wpp-list"></div><p class="wpp-note" hidden></p></div></div>
                <div class="wpp-pane" data-pane="arcade" hidden><div class="wpp-scroll"><div class="wm-form"></div></div></div>
                <div class="wm-tabs" role="tablist">
                    <button type="button" class="wm-tab" role="tab" data-tab="customers" aria-selected="true">Customers</button>
                    <button type="button" class="wm-tab" role="tab" data-tab="machines">Machines</button>
                    <button type="button" class="wm-tab" role="tab" data-tab="arcade">Arcade</button>
                </div>
            </div>
            <div class="wpp-layer" hidden></div>`;
        const main = p.querySelector('.wpp-main');
        const searchEl = p.querySelector('.wpp-search');
        searchEl.addEventListener('input', () => { search = searchEl.value.trim(); renderCustomers(); if (isCurrent()) sh.refreshSoftKeys(); });
        searchEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            searchEl.blur();
            if (selectedId) void openCustomer({ id: selectedId });
        });
        main.querySelector('.wm-tabs').addEventListener('click', (e) => {
            const t = e.target.closest('.wm-tab');
            if (!t) return;
            tab = t.dataset.tab;
            renderMain();
        });
        const custList = p.querySelector('.wpp-pane[data-pane="customers"] .wpp-scroll');
        onHold(custList, '.wpp-row[data-id]', (row, x, y) => {
            selectRow(row.dataset.id);
            const u = data && data.users.find((x2) => x2.id === row.dataset.id);
            if (!u) return;
            sh.menuAt(x, y, [
                { label: 'Open', action: () => openCustomer({ id: u.id }) },
                { label: 'Deposit...', action: () => depositForm({ id: u.id, name: decode(u.name) }) },
                { label: 'Free Play...', action: () => depositForm({ id: u.id, name: decode(u.name), free: true }) }
            ]);
        });
        custList.addEventListener('click', (e) => {
            const row = e.target.closest('.wpp-row');
            if (!row) return;
            if (!row.dataset.id) { void box('This customer has no card, so the server cannot look them up by ID here. Use Lookup with their customer ID.', 'info'); return; }
            selectRow(row.dataset.id);
            void openCustomer({ id: row.dataset.id });
        });
        p.querySelector('.wpp-pane[data-pane="machines"]').addEventListener('click', (e) => {
            const row = e.target.closest('[data-mac]');
            if (row) push({ kind: 'machine', mac: row.dataset.mac });
        });
        p.querySelector('.wpp-pane[data-pane="arcade"]').addEventListener('click', (e) => {
            const c = e.target.closest('.wpp-pos');
            if (c && !c.disabled) { choosePos(c); return; }
            if (e.target.closest('[data-act="freeplay"]')) freePlayForm();
        });
        const host = p.querySelector('.wpp-layer');
        host.addEventListener('click', (e) => {
            const t = top();
            if (!t) return;
            const ct = e.target.closest('[data-ctab]');
            if (ct && t.kind === 'customer') { t.tab = ct.dataset.ctab; renderLayer(); return; }
            const ft = e.target.closest('[data-ftab]');
            if (ft && t.kind === 'form') { saveValues(t); t.tab = ft.dataset.ftab; renderForm(t, host); return; }
            const card = e.target.closest('[data-card]');
            if (card && t.kind === 'customer') {
                host.querySelectorAll('.wpp-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
                card.classList.add('is-selected');
                const r = card.getBoundingClientRect();
                sh.menuAt(r.left + r.width / 2, r.bottom, cardMenu(t.c, card.dataset.card));
            }
        });
        host.addEventListener('keydown', (e) => {
            const t = top();
            if (e.key === 'Enter' && t && t.kind === 'form' && t.primary && e.target.matches('input.wm-edit')) {
                e.preventDefault();
                const k = softKeys();
                if (k.left && k.left.action) k.left.action();
            }
        });
        renderMain();
    }

    function startTimer() {
        clearInterval(timer);
        timer = setInterval(() => {
            if (!shown || document.hidden || working || scan || (sh.isBusy && sh.isBusy())) return;
            if (Date.now() - loadedAt >= REFRESH_MS) void refresh({ quiet: true });
        }, 5000);
    }

    let firstLoading = false;
    async function firstLoad() {
        if (firstLoading) return;
        firstLoading = true;
        if (page) page.classList.add('is-loading');
        try {
            await sh.busy(load, { paint: true, timeout: 20000 });
        } catch (err) {
            firstLoading = false;
            online = false;
            await sh.messageBox({ title: TITLE, icon: 'error', modal: true, text: `PayPass Operator cannot start: the PayPass server could not be reached.\n\n${(err && err.message) || ''}`.trim() });
            if (typeof sh.endApp === 'function') sh.endApp(APP_ID); else sh.back();
            return;
        }
        firstLoading = false;
        if (page) page.classList.remove('is-loading');
        if (!shown) return;
        renderMain();
        renderLayer();
        startTimer();
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        esc = sh.escapeHtml || esc;
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
            startLabel: 'PayPass Operator',
            icon: ICON,
            inStart: 'programs',
            
            sip: true,
            mount,
            show() {
                shown = true;
                // the first open loads behind the wait cursor; no server: one dialog, then the app closes
                if (!data) { void firstLoad(); return; }
                renderLayer();
                if (Date.now() - loadedAt > 30000) void refresh({ quiet: true });
                startTimer();
            },
            hide() {
                shown = false;
                clearInterval(timer);
            },
            onEnd() {
                shown = false;
                clearInterval(timer);
                if (scan) void scan.cancel();
                page = null;
            },
            onTitleClose() { if (scan) void scan.cancel(); },
            closeQuestion,
            softKeys,
            // X on the main tabs (it closes the app), ok on a customer or machine page, nothing on a form
            // or the scan screen (their own soft keys answer them)
            titleKind: () => { const t = top(); if (!t) return 'close'; return t.kind === 'customer' || t.kind === 'machine' ? 'ok' : null; },
            historyDepth: () => layers.length,
            onBack() {
                if (!layers.length) return false;
                pop();
                return true;
            }
        });
    }

    // tests: state only, no writes
    window.wmPayPass = { get state() { return { tab, layers: layers.map((l) => l.kind), loaded: !!data, online, pos, working, scanning: !!scan, users: data ? data.users.length : 0, machines: data ? data.machines.length : 0 }; } };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
