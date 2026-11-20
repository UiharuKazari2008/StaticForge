/**
 * The domain controller's address on DreamOS (#910, Yukimi Nov 20 2026: "cache the server's IP address so that if there
 * is no DNS or limited DNS it has the last known server IP address ... Show options to see the last known values and
 * update manually in the application"). Loaded on demand (featureLoader 'dreamos_server_address'): a Server page on
 * the Nightshade adapter's own Properties (Network Connections > the adapter > Properties > Configure..., Device
 * Manager > Network adapters), the adapter driver's own tab as a Vista network driver adds one.
 *
 * The host keeps the addresses (CaféReady serveraddr.rs, window.DreamOSServerAddress from the shell bridge): it looks
 * the server's name up on every network change and every 90 s, verifies each new address by its certificate, and
 * when the name server fails or answers with another computer it puts the last known address in the hosts file. The
 * page only shows that state: it arrives with the window and then as 'dreamosserveraddr' events while the window is
 * open (no polling). Refresh asks for a check now; Change... takes an address, which the host verifies before it is
 * kept; Clear forgets the kept addresses.
 *
 *   window.dreamosServerAddress = { available(), page() -> { key, title, tpl }, wire(ctx, key) -> stop, open(owner) }
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ICON = '/static_images/vista-net/ncpa-lan-16.png';
    const ADAPTER = 'Xyridian Nightshade Virtual Ethernet Adapter';
    const SS = 1342308352;
    const SS_VALUE = 1342308480;
    const BS = 1342242816;

    // the Server page (a driver's own tab: MS Shell Dlg 8 on Vista's 227 x 215 property page)
    const PAGE = { t: 'Server', w: 227, h: 215, f: ['MS Shell Dlg', 8], s: 1086849096, c: [
        [1001, 'S', 7, 7, 213, 26, SS, 'Melaton reaches its domain controller by name. When the name server cannot find it, or answers with another computer, the last address this computer verified is used.', 0],
        [1010, 'S', 7, 40, 62, 8, SS, 'Server name:', 0], [1011, 'S', 72, 40, 148, 8, SS_VALUE, '', 0],
        [1012, 'S', 7, 52, 62, 8, SS, 'Address in use:', 0], [1013, 'S', 72, 52, 148, 8, SS_VALUE, '', 0],
        [1014, 'S', 7, 64, 62, 8, SS, 'Source:', 0], [1015, 'S', 72, 64, 148, 8, SS_VALUE, '', 0],
        [1016, 'S', 7, 76, 62, 8, SS, 'Name server:', 0], [1017, 'S', 72, 76, 148, 8, SS_VALUE, '', 0],
        [1020, 'S', 7, 92, 213, 8, SS, '&Last known addresses:', 0],
        // report view with a header (LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS | LVS_NOSORTHEADER)
        [1021, 'SysListView32', 7, 102, 213, 64, 1350664205, '', 0],
        [1022, 'S', 7, 170, 213, 18, SS_VALUE, '', 0],
        [1030, 'B', 7, 192, 55, 14, BS, '&Refresh', 0],
        [1031, 'B', 65, 192, 55, 14, BS, 'C&hange...', 0],
        [1032, 'B', 123, 192, 55, 14, BS, 'C&lear', 0]
    ] };
    const CHANGE = { t: 'Server Address', w: 220, h: 78, f: ['MS Shell Dlg', 8], s: 2160591040, c: [
        [1101, 'S', 7, 7, 206, 18, SS, '', 0],
        [1102, 'S', 7, 34, 44, 8, SS, '&Address:', 0],
        [1103, 'E', 54, 31, 159, 14, 1350631552, '', 0],
        [1, 'B', 109, 57, 50, 14, 1342373889, 'OK', 0],
        [2, 'B', 163, 57, 50, 14, BS, 'Cancel', 0]
    ] };

    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const host = () => root.DreamOSServerAddress || null;

    function kit() {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : Promise.resolve();
        return Promise.resolve(ready).then(() => {
            if (!root.vistaDialogTemplate) throw new Error('vistaDialogTemplate is not loaded');
            return root.vistaDialogTemplate;
        });
    }

    function message(text, title, icon) {
        return Promise.resolve(call('showConfirmationDialog', esc(text).replace(/\n/g, '<br>'),
            [{ text: 'OK', value: true, className: 'btn-standard primary' }], null,
            { title, icon: icon === 'error' ? 'fas fa-circle-xmark' : 'fas fa-exclamation-triangle', sound: true }));
    }

    function ask(text, title) {
        return Promise.resolve(call('showConfirmationDialog', esc(text).replace(/\n/g, '<br>'),
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], null,
            { title, icon: 'fas fa-question-circle', sound: true })).then((v) => v === true);
    }

    /** Vista's short date and time (11/20/2026 12:41 AM); '' for none. */
    function when(ms) {
        if (!ms) return '';
        const d = new Date(ms);
        const date = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `${date} ${time}`;
    }

    function sourceText(s) {
        const u = (s && s.inUse) || {};
        if (u.source === 'dns') return 'Name server (DNS)';
        if (u.source === 'cached') return u.manual ? 'Last known address (entered by hand)' : 'Last known address (the name server is not used)';
        return 'None';
    }

    function dnsText(s) {
        const d = (s && s.dns) || {};
        if (d.error) return `Not answering (${d.error})`;
        if (Array.isArray(d.addresses) && d.addresses.length) return d.addresses.join(', ');
        return s && s.online === false ? 'Not connected' : 'No answer yet';
    }

    function statusText(s) {
        const checked = s && s.lastCheck ? `Last checked ${when(s.lastCheck)}${s.network ? ` on ${s.network}` : ''}.` : 'Not checked yet: the computer is not connected to a network.';
        const why = s && s.inUse && s.inUse.source !== 'dns' && s.inUse.reason ? ` ${s.inUse.reason}` : '';
        return `${checked}${why}`;
    }

    const COLS = [['Address', 'dsa-col-addr'], ['Last verified', 'dsa-col-when'], ['Network', 'dsa-col-net']];

    function fillList(lv, s) {
        const head = lv.querySelector('.vdt-lv-header');
        const body = lv.querySelector('.vdt-lv-body');
        if (!body) return;
        if (head && !head.childElementCount) {
            COLS.forEach(([t, cls]) => {
                const col = doc.createElement('span');
                col.className = `vdt-lv-col ${cls}`;
                col.textContent = t;
                head.appendChild(col);
            });
        }
        const keep = (lv.querySelector('.vdt-lv-row.is-selected') || {}).dataset;
        const picked = keep ? keep.value : '';
        body.textContent = '';
        ((s && s.known) || []).forEach((k) => {
            const row = doc.createElement('div');
            row.className = `vdt-lv-row${k.address === picked ? ' is-selected' : ''}`;
            row.dataset.value = k.address;
            const cells = [
                k.address + (k.source === 'manual' ? ' (entered)' : ''),
                when(k.verifiedAt),
                k.network || ''
            ];
            cells.forEach((text, i) => {
                const c = doc.createElement('span');
                c.className = COLS[i][1];
                c.textContent = text;
                row.appendChild(c);
            });
            body.appendChild(row);
        });
    }

    function show(ctx, s, key) {
        ctx.text(1011, (s && s.host) || '', key);
        const used = (s && s.inUse && s.inUse.addresses) || [];
        ctx.text(1013, used.length ? used.join(', ') : 'None', key);
        ctx.text(1015, sourceText(s), key);
        ctx.text(1017, dnsText(s), key);
        ctx.text(1022, statusText(s), key);
        const lv = ctx.holder(1021, key);
        if (lv) fillList(lv, s);
        ctx.enable(1032, !!(s && s.known && s.known.length), key);
    }

    async function openChange(owner, s, onDone) {
        const V = await kit();
        const name = (s && s.host) || 'the server';
        V.openDialog({
            id: 'dreamosServerAddressChange',
            key: 'dsa:change',
            tpl: CHANGE,
            owner,
            icon: ICON,
            init(c) {
                c.text(1101, `Type the address of ${name}. Melaton checks that the computer there is ${name} before it uses the address.`);
                const cur = (s && s.inUse && s.inUse.source === 'cached' && s.inUse.addresses[0]) || ((s && s.known && s.known[0]) || {}).address || '';
                c.set(1103, cur);
                const e = c.el(1103);
                if (e) { e.focus(); e.select(); }
            },
            async ok(c) {
                const h = host();
                const v = String(c.get(1103) || '').trim();
                if (!h || !v) return false;
                const r = await Promise.resolve(h.set(v)).catch((err) => ({ error: String(err) }));
                if (r && r.error) {
                    await message(r.error, 'Server Address', 'error');
                    return false;
                }
                if (onDone) onDone(r);
                return true;
            }
        });
    }

    /**
     * Fills and wires the Server page in a sheet (Device Manager's adapter sheet, or open() below): the state now, then
     * the host's pushes while the sheet is open. Returns the clean-up (also done by itself once the sheet is gone).
     */
    function wire(ctx, K) {
        const h = host();
        if (!h) return () => {};
        ctx.content.classList.add('dsa-sheet');
        show(ctx, h.get(), K);
        // the host pushes the state when it changed (a check, a network change); nothing is polled
        const onPush = (ev) => {
            if (!ctx.content.isConnected) { stop(); return; }
            show(ctx, ev.detail || h.get(), K);
        };
        const stop = () => root.removeEventListener('dreamosserveraddr', onPush);
        root.addEventListener('dreamosserveraddr', onPush);
        const busy = (on) => [1030, 1031, 1032].forEach((id) => ctx.enable(id, !on, K));
        ctx.on(1030, 'click', async () => {
            busy(true);
            ctx.text(1022, 'Checking...', K);
            const r = await Promise.resolve(h.refresh()).catch((err) => ({ error: String(err) }));
            busy(false);
            show(ctx, r && !r.error ? r : h.get(), K);
            if (r && r.error) await message(r.error, 'Server Address', 'error');
        }, K);
        ctx.on(1031, 'click', () => { void openChange(ctx.modal, h.get(), (r) => show(ctx, r, K)); }, K);
        ctx.on(1032, 'click', async () => {
            const s = h.get();
            if (!(await ask(`Forget the last known addresses of ${s.host || 'the server'}? Melaton then reaches it only through the name server until it has verified an address again.`, 'Server Address'))) return;
            const r = await Promise.resolve(h.clear()).catch((err) => ({ error: String(err) }));
            show(ctx, r && !r.error ? r : h.get(), K);
        }, K);
        return stop;
    }

    /** The page for another sheet's pages list (Device Manager's Nightshade adapter): { key, title, tpl }. */
    const page = () => ({ key: 'dsa:server', title: 'Server', tpl: PAGE });

    /** The adapter's sheet with the Server page alone (where Device Manager's sheet is not at hand). */
    async function open(owner) {
        if (!host()) return;
        const V = await kit();
        const p = page();
        let stop = null;
        V.openSheet({
            id: 'dreamosServerAddressProps',
            title: `${ADAPTER} Properties`,
            icon: ICON,
            owner,
            noApply: true,
            pages: [p],
            init(ctx) { stop = wire(ctx, p.key); },
            close() { if (stop) stop(); }
        });
    }

    root.dreamosServerAddress = Object.freeze({
        available: () => !!host(),
        page,
        wire,
        open
    });
})(typeof window !== 'undefined' ? window : globalThis);
