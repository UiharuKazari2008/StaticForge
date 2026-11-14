/**
 * Melaton Mobile: ActiveSync (WM 6.1 / 6.5 Professional's ActiveSync program), Yozora #747.
 *
 * The phone's side of public/scripts/comp/activeSyncAgent.js (window.activeSync, kind 'device'):
 * what the computer is, whether it is connected, and what it may do here. The desktop side is
 * Melaton Mobile Device Center (apps/activesync). Measured on the Device Emulator (WM 6.1 VGA
 * halved; ~/.cache/wm61/ref/activesync-*.png): a white page of 4 px margins, the status picture
 * (\Windows\Syncconnected.bmp / Syncnotconnect.bmp / Syncyellow.bmp, SyncAnimation.gif while
 * something is in flight), soft keys Sync | Menu (Options..., Status..., Send Clipboard,
 * Send Link...: activeSyncClipboard.js).
 *
 *   no computer yet    the device's own text for a device without a partnership
 *   waiting            a computer has to choose how to connect (its Device Center shows the choice)
 *   connected          the computer's name, "Connected", and what it was allowed
 *   Options...         what the computer may do: one check box per permission; soft key Delete ends
 *                      the partnership (as ActiveSync's Options deletes a source)
 *   Status...          the server's log for this device, newest first
 *   Received Items     (#803) what reached this phone while it was locked or away (links, files,
 *                      pictures, programs to install, clipboard text, notifications), newest first;
 *                      the selected one's action on the left soft key (Open / Install / View / Copy),
 *                      Menu: Remove, Clear All. Opened from the title bar's ActiveSync icon too.
 *
 * Only inside the Dreamscape app (activeSync.kind === 'device') and only on phones.
 * Styles: public/css/wm-activesync.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;
    const as = window.activeSync;
    if (!as || as.kind !== 'device') return;

    const APP_ID = 'activesync';
    // the permission names of modules/activeSync.js, as this program words them
    const PERMISSIONS = [
        ['files', 'Files on this device'],
        ['session', 'Studio session'],
        ['clipboard', 'Clipboard and links'],
        ['notify', 'Notifications'],
        ['control', 'Find this device'],
        ['screen', 'Screen'],
        ['sync', 'Synchronized items']
    ];
    let ws = null;
    let page = null;
    let view = 'main'; // 'main' | 'options' | 'optset' | 'status' | 'received'
    let busy = 0;
    let logEntries = [];
    let rxSel = 0;
    let activity = 0;     // requests being served: the picture turns while > 0
    let activityTimer = null;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function computerName(st) {
        return (st.computers[0] && st.computers[0].name) || 'Computer';
    }

    function when(ms) {
        const d = new Date(ms);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }

    function picture(st) {
        if (activity > 0 || busy > 0) return ['as-syncing', true];
        if (!st.online) return ['as-notconnected', false];
        if (st.session === 'pending') return ['as-attention', false];
        return ['as-connected', false];
    }

    function mainHtml(st) {
        const [pic, turning] = picture(st);
        const head = (name, line) => `
            <div class="was-head">
                <div class="was-pic${turning ? ' is-syncing' : ''}" style="background-image:${ws.art.srcset ? `image-set(url('${ws.art.url(pic)}') 1x, url('${ws.art.url2x(pic)}') 2x, url('${ws.art.url2x(pic).replace('@2x.png', '@4x.png')}') 4x)` : `url('${ws.art.url(pic)}')`}"></div>
                <div><div class="was-name">${esc(name)}</div><div class="was-line">${esc(line)}</div></div>
            </div>`;
        if (!st.online) {
            return `${head('ActiveSync', 'Not connected')}
                <div class="was-text"><p>This device is not connected to the Dreamscape server. It connects by itself when the connection is back.</p></div>`;
        }
        if (st.session === 'pending' || !st.session) {
            return `${head('ActiveSync', 'Waiting for the computer')}
                <div class="was-text"><p>To synchronize your device with a desktop computer, open Melaton Mobile Device Center on the computer and choose how to connect.</p>
                <p>This device then asks you to allow the connection.</p></div>`;
        }
        const allowed = PERMISSIONS.filter(([id]) => st.permissions.includes(id) && (id !== 'sync' || st.session === 'partner'));
        // the phone's own DeX window is linked by USB (#794), any other computer over the network
        const usb = (st.computers || []).some((c) => c.link === 'usb' && c.usbDevice === st.id);
        return `${head(computerName(st), `${st.session === 'partner' ? 'Connected' : 'Connected (guest)'}${usb ? ' via USB' : ''}`)}
            <ul class="was-rows">${allowed.map(([, label]) => `<li><span>${esc(label)}</span><span>Allowed</span></li>`).join('')}</ul>`;
    }

    // Menu > Phone Data... (Yukimi, Nov 12, #777): the phone's own calendar and contacts in Calendar
    // and Contacts: shown on this phone only, or synchronized to Melaton (wmAndroidApps.js wmPhoneData)
    const PHONE_DATA_KEY = 'wmPhoneData';
    const PHONE_DATA = [['off', 'Off'], ['show', 'Show on this phone'], ['sync', 'Synchronize to Melaton']];
    const phoneData = () => window.wmPhoneData || null;
    // the phone's own calendar and contacts (Menu > Options... > This phone): off, shown on this phone,
    // or synchronized to Melaton (wmAndroidApps.js wmPhoneData)
    // the Melaton Café Miniport (Options > Melaton Café Miniport); its link's Idle timeout is under
    // Settings > Connections > Network Cards
    const mc = () => window.melatonContinuity || null;
    const cafeAvailable = () => { const m = mc(); return !!(m && typeof m.miniport === 'function' && m.miniport().available); };
    // ---------------------------------------------------------------- Menu > Options... (#815)
    // ActiveSync's own Options (syncres.dll.0409.mui DIALOG 2603: "Choose the data you want to sync:",
    // a check-box tree, Delete and Settings... under it) holds what used to be three pages: what the
    // partnered computer may use, the Café Miniport's data, and the phone's own calendar and contacts.
    // Settings... is the selected item's page (DIALOG 1011's "Settings - <name>").
    let opts = null; // { perms: Set, cafe: { scope, datasets }, phone: { calendar, contacts }, sel, sub, subDraft }
    function optsBegin() {
        const st = as.state();
        const m = mc();
        let phone = {};
        try { phone = JSON.parse(localStorage.getItem(PHONE_DATA_KEY) || '{}') || {}; } catch (_) { phone = {}; }
        let cafe = null;
        if (cafeAvailable() && m) {
            const c = ((m.miniportConfig() || {}).config) || {};
            const ds = c.datasets || {};
            cafe = { scope: c.scope === 'all' ? 'all' : 'current', datasets: {} };
            m.cacheDatasets().forEach((d) => { const v = ds[d.id] || {}; cafe.datasets[d.id] = { cache: v.cache !== false, update: v.update !== false }; });
            m.requestMiniportConfig();
        }
        opts = {
            perms: new Set(st.permissions || []),
            cafe,
            phone: phoneData() && phoneData().available() ? { calendar: phone.calendar || 'off', contacts: phone.contacts || 'off' } : null,
            sel: st.session === 'partner' ? 'pc' : cafe ? 'cafe' : 'phone',
            sub: null,
            subDraft: null
        };
    }
    /** The Miniport's settings came after Options opened (nothing of the Café part edited yet). */
    function optsCafeFromConfig() {
        const m = mc();
        const c = ((m && m.miniportConfig()) || {}).config || {};
        const ds = c.datasets || {};
        opts.cafe.scope = c.scope === 'all' ? 'all' : 'current';
        m.cacheDatasets().forEach((d) => { const v = ds[d.id] || {}; opts.cafe.datasets[d.id] = { cache: v.cache !== false, update: v.update !== false }; });
    }
    const optsAvailable = (st) => st.session === 'partner' || cafeAvailable() || !!(phoneData() && phoneData().available());
    const PHONE_KINDS = [['calendar', 'Calendar'], ['contacts', 'Contacts']];

    function optsRoots(st) {
        const roots = [];
        if (st.session === 'partner') {
            roots.push({ key: 'pc', label: computerName(st), kids: PERMISSIONS.map(([id, label]) => ({ key: `perm:${id}`, label, on: opts.perms.has(id) })) });
        }
        if (opts.cafe) {
            const m = mc();
            roots.push({ key: 'cafe', label: 'Melaton Caf\u00e9 Miniport', kids: m.cacheDatasets().map((d) => ({ key: `cafe:${d.id}`, label: d.label, on: opts.cafe.datasets[d.id].cache })) });
        }
        if (opts.phone) {
            roots.push({ key: 'phone', label: 'This phone', kids: PHONE_KINDS.map(([k, label]) => ({ key: `phone:${k}`, label, on: opts.phone[k] !== 'off' })) });
        }
        return roots;
    }

    function optsHtml(st) {
        const roots = optsRoots(st);
        let rows = '';
        roots.forEach((r, ri) => {
            const lastRoot = ri === roots.length - 1;
            rows += `<div class="mt-row no-ico${opts.sel === r.key ? ' is-current' : ''}" role="treeitem" aria-expanded="true" data-key="${esc(r.key)}" style="--depth:0">`
                + `<i class="mt-c${ri === 0 ? ' is-first' : ''}${lastRoot ? ' is-last' : ''}" style="--d:0"></i><i class="mt-h" style="--d:0"></i>`
                + `<span class="mt-box is-open" style="--d:0"></span><span class="mt-label">${esc(r.label)}</span></div>`;
            r.kids.forEach((k, ki) => {
                rows += `<div class="mt-row has-check no-ico${opts.sel === k.key ? ' is-current' : ''}" role="treeitem" data-key="${esc(k.key)}" style="--depth:1">`
                    + `${lastRoot ? '' : '<i class="mt-v" style="--d:0"></i>'}<i class="mt-c${ki === r.kids.length - 1 ? ' is-last' : ''}" style="--d:1"></i><i class="mt-h" style="--d:1"></i>`
                    + `<input type="checkbox" class="mt-check" data-key="${esc(k.key)}" aria-label="${esc(k.label)}"${k.on ? ' checked' : ''}><span class="mt-label">${esc(k.label)}</span></div>`;
            });
        });
        const canSettings = /^(cafe|cafe:|phone:)/.test(opts.sel || '');
        return `<div class="wm-form-hdr">Options</div>
            <div class="was-opts"><p class="was-opts-lead">Choose the data you want to sync:</p>
            <div class="was-tree mt-tree" role="tree" aria-label="Data">${rows}</div>
            <div class="was-opts-btns"><button type="button" class="wm-button" data-act="delete"${opts.sel === 'pc' ? '' : ' disabled'}>Delete</button><button type="button" class="wm-button" data-act="settings"${canSettings ? '' : ' disabled'}>Settings...</button></div></div>`;
    }

    function wireOpts() {
        const tree = page.querySelector('.was-tree');
        if (!tree) return;
        tree.addEventListener('click', (e) => {
            const row = e.target.closest('.mt-row');
            if (!row) return;
            const key = row.dataset.key;
            const box = e.target.closest('.mt-check');
            if (box) {
                const on = box.checked;
                if (key.startsWith('perm:')) { if (on) opts.perms.add(key.slice(5)); else opts.perms.delete(key.slice(5)); }
                else if (key.startsWith('cafe:')) { const d = opts.cafe.datasets[key.slice(5)]; d.cache = on; if (!on) d.update = false; opts.cafeTouched = true; }
                else if (key.startsWith('phone:')) { const k = key.slice(6); opts.phone[k] = on ? (opts.phone[k] !== 'off' ? opts.phone[k] : 'show') : 'off'; }
            }
            opts.sel = key;
            render();
        });
        page.querySelector('[data-act="delete"]').addEventListener('click', () => { void endPartnership(); });
        page.querySelector('[data-act="settings"]').addEventListener('click', optsOpenSettings);
    }

    function optsOpenSettings() {
        const key = opts.sel || '';
        if (key === 'cafe') opts.subDraft = { scope: opts.cafe.scope };
        else if (key.startsWith('cafe:')) opts.subDraft = Object.assign({}, opts.cafe.datasets[key.slice(5)]);
        else if (key.startsWith('phone:')) opts.subDraft = { v: opts.phone[key.slice(6)] };
        else return;
        opts.sub = key;
        view = 'optset';
        render();
        ws.syncHistory();
    }

    function optsSubLabel(key) {
        if (key === 'cafe') return 'Melaton Caf\u00e9 Miniport';
        if (key.startsWith('cafe:')) { const d = mc().cacheDatasets().find((x) => x.id === key.slice(5)); return d ? d.label : key; }
        const k = PHONE_KINDS.find(([id]) => id === key.slice(6));
        return k ? k[1] : key;
    }

    function optsSettingsHtml() {
        const key = opts.sub;
        const d = opts.subDraft;
        let body = '';
        if (key === 'cafe') {
            const stats = ((mc().miniportConfig() || {}).stats) || {};
            body = `<p>Keep the data of:</p>
                <label class="wm-check"><input type="radio" name="os-scope" value="current"${d.scope === 'current' ? ' checked' : ''}><span>Current workspace only</span></label>
                <label class="wm-check"><input type="radio" name="os-scope" value="all"${d.scope === 'all' ? ' checked' : ''}><span>All workspaces used</span></label>
                <div class="wm-form-gap"></div><p class="was-cafe-stats">${esc(`${Number(stats.entries) || 0} replies kept, ${Number(stats.served) || 0} served from the cache`)}</p>
                <p class="was-cafe-stats">The link's Idle timeout is under Settings &gt; Connections &gt; Network Cards.</p>`;
        } else if (key.startsWith('cafe:')) {
            const ds = mc().cacheDatasets().find((x) => x.id === key.slice(5)) || {};
            const n = ((((mc().miniportConfig() || {}).stats) || {}).byDataset || {})[key.slice(5)];
            body = `<label class="wm-check"><input type="checkbox" name="os-cache"${d.cache ? ' checked' : ''}><span>Keep this data on the phone</span></label>
                <label class="wm-check"><input type="checkbox" name="os-update"${d.update ? ' checked' : ''}${d.cache ? '' : ' disabled'}><span>${ds.refreshes ? 'Keep it up to date' : 'Update it when the server changes it'}</span></label>
                ${n ? `<div class="wm-form-gap"></div><p class="was-cafe-stats">${esc(`${n} kept`)}</p>` : ''}`;
        } else {
            body = `<p>The phone's own ${esc(optsSubLabel(key).toLowerCase())} in Melaton Mobile:</p>
                ${PHONE_DATA.map(([v, l]) => `<label class="wm-check"><input type="radio" name="os-phone" value="${v}"${d.v === v ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}`;
        }
        return `<div class="wm-form-hdr">Settings - ${esc(optsSubLabel(key))}</div><div class="was-form was-optset">${body}</div>`;
    }

    function wireOptsSettings() {
        page.querySelectorAll('.was-optset input').forEach((inp) => inp.addEventListener('change', () => {
            const d = opts.subDraft;
            if (inp.name === 'os-scope') d.scope = inp.value;
            else if (inp.name === 'os-phone') d.v = inp.value;
            else if (inp.name === 'os-cache') { d.cache = inp.checked; if (!d.cache) d.update = false; render(); }
            else if (inp.name === 'os-update') d.update = inp.checked;
        }));
    }

    function optsSettingsDone(keep) {
        const key = opts.sub;
        const d = opts.subDraft;
        if (keep && d) {
            if (key === 'cafe' || key.startsWith('cafe:')) opts.cafeTouched = true;
            if (key === 'cafe') opts.cafe.scope = d.scope;
            else if (key.startsWith('cafe:')) opts.cafe.datasets[key.slice(5)] = { cache: !!d.cache, update: !!(d.cache && d.update) };
            else if (key.startsWith('phone:')) opts.phone[key.slice(6)] = d.v;
        }
        opts.sub = null;
        opts.subDraft = null;
        view = 'options';
        render();
        ws.syncHistory();
    }

    async function optsSave() {
        const st = as.state();
        const o = opts;
        opts = null;
        view = 'main';
        render();
        ws.syncHistory();
        if (o.cafe) { const m = mc(); if (m) m.setMiniportConfig({ scope: o.cafe.scope, datasets: o.cafe.datasets }); }
        if (o.phone) {
            let before = {};
            try { before = JSON.parse(localStorage.getItem(PHONE_DATA_KEY) || '{}') || {}; } catch (_) { before = {}; }
            try { localStorage.setItem(PHONE_DATA_KEY, JSON.stringify(o.phone)); } catch (_) { /* this session only */ }
            if (before.calendar !== o.phone.calendar || before.contacts !== o.phone.contacts) {
                document.dispatchEvent(new CustomEvent('wmPhoneDataChange', { detail: Object.assign({}, o.phone) }));
            }
        }
        if (st.session === 'partner') {
            const picked = PERMISSIONS.map(([id]) => id).filter((id) => o.perms.has(id));
            const was = PERMISSIONS.map(([id]) => id).filter((id) => (st.permissions || []).includes(id));
            if (picked.join() !== was.join()) await run(() => as.update(st.id, { permissions: picked }));
        }
    }

    // ---------------------------------------------------------------- Received Items (#803)
    const RX = {
        link: { icon: 'ie-page', word: 'Link', act: 'Open' },
        file: { icon: 'fe-file', word: 'File', act: 'Open' },
        picture: { icon: 'fe-file', word: 'Picture', act: 'View' },
        program: { icon: 'app-programs', word: 'Program', act: 'Install' },
        clipboard: { icon: 'msg-read', word: 'Clipboard', act: 'Copy' },
        note: { icon: 'msgbox-info', word: 'Notification', act: 'View' },
        studio: { icon: 'app-studio', word: 'Studio session', act: 'Open' }
    };
    const rxItems = () => (typeof as.receivedItems === 'function' ? as.receivedItems() : []);

    function receivedHtml() {
        const items = rxItems();
        if (rxSel >= items.length) rxSel = Math.max(0, items.length - 1);
        const row = (it, i) => {
            const k = RX[it.kind] || RX.file;
            const img = ws.art && ws.art.img ? ws.art.img(k.icon) : '';
            return `<li class="was-rx${i === rxSel ? ' is-selected' : ''}${it.seen ? '' : ' is-new'}" data-i="${i}">${img}<span class="was-rx-text"><b>${esc(it.title)}</b><small>${esc(k.word)}${it.from ? ` from ${esc(it.from)}` : ''}, ${esc(when(it.at))}</small></span></li>`;
        };
        return `<div class="wm-form-hdr">Received Items</div>
            <ul class="was-rxlist">${items.length ? items.map(row).join('') : '<li class="was-rx-none">Nothing was received while this device was away.</li>'}</ul>`;
    }

    function openReceived() {
        ws.open(APP_ID);
        view = 'received';
        rxSel = 0;
        render();
        ws.syncHistory();
        // seen once the list is on screen: the title bar's icon goes
        if (typeof as.received === 'function' && as.receivedUnseen() > 0) as.received('seen').then(render, () => {});
    }

    async function actOn(it) {
        if (!it) return;
        const d = it.detail || {};
        if (it.kind === 'link') {
            const B = window.wmBrowser;
            if (!(B && B.open(d.url))) await ws.messageBox({ title: 'ActiveSync', icon: 'warning', text: `This link cannot be opened here:\n${d.url || ''}` });
            return;
        }
        if (it.kind === 'picture' || it.kind === 'file') {
            const dir = String(d.path || '/').replace(/\/[^/]*$/, '') || '/';
            if (it.kind === 'picture' && window.wmPhoneGallery && d.root) { ws.open('gallery'); void window.wmPhoneGallery.open(d.root, dir); return; }
            const E = window.wmFileExplorer;
            if (E && typeof E.openFolder === 'function') { E.openFolder(`phone://${d.root}${dir}`, dir.split('/').pop() || d.root); return; }
            return;
        }
        if (it.kind === 'program') {
            // the app opens Android's installer (or installs through Shizuku): the same way a push installs
            const st = as.state();
            await run(async () => {
                const r = await fetch(`/api/activesync/install/${encodeURIComponent(st.id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: d.root, path: d.path }) });
                const j = await r.json().catch(() => ({}));
                if (!r.ok || j.success === false) throw new Error(j.error || 'The program could not be installed.');
            });
            return;
        }
        if (it.kind === 'clipboard') {
            try {
                const copy = typeof window.copyTextToClipboard === 'function' ? window.copyTextToClipboard : null;
                if (copy) await copy(d.text || ''); else await navigator.clipboard.writeText(d.text || '');
                ws.notify({ title: 'ActiveSync', icon: 'info', text: 'Copied to the clipboard.', timeout: 3000 });
            } catch (_) { await ws.messageBox({ title: 'ActiveSync', icon: 'warning', text: 'The clipboard could not be written.' }); }
            return;
        }
        if (it.kind === 'note') { await ws.messageBox({ title: it.title || 'Notification', icon: 'info', text: d.text || it.title }); return; }
        if (it.kind === 'studio') ws.open('studio');
    }

    async function removeReceived(all) {
        const it = rxItems()[rxSel];
        if (!all && !it) return;
        if (all) {
            const yes = await ws.messageBox({ title: 'ActiveSync', icon: 'question', modal: true, cancelValue: false, text: 'Remove every received item from the list?', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }] });
            if (yes !== true) return;
        }
        await run(() => as.received(all ? 'clear' : 'remove', all ? undefined : it.id));
    }

    function statusHtml() {
        return `<div class="wm-form-hdr">Status</div>
            <ul class="was-log">${logEntries.length ? logEntries.map((e) => `<li class="is-${esc(e.level)}"><time>${esc(when(e.at))}</time>${esc(e.text)}</li>`).join('') : '<li>No activity yet.</li>'}</ul>`;
    }

    function render() {
        if (!page) return;
        // ActiveSync behind another app, the page hidden or the screen off: show() draws it anew
        if (window.wmShell && window.wmShell.onScreen && !window.wmShell.onScreen(page)) return;
        const st = as.state();
        if ((view === 'options' || view === 'optset') && !opts) view = 'main';
        const html = view === 'options' ? optsHtml(st) : view === 'optset' ? optsSettingsHtml() : view === 'status' ? statusHtml() : view === 'received' ? receivedHtml() : mainHtml(st);
        if (page.dataset.html !== html) {
            page.dataset.html = html;
            page.innerHTML = html;
            if (view === 'options') wireOpts();
            if (view === 'optset') wireOptsSettings();
        }
        if (ws) { ws.refreshSoftKeys(); ws.refreshTitleAction(); }
    }

    async function run(work) {
        busy += 1;
        render();
        try {
            return await ws.busy(work);
        } catch (e) {
            await ws.messageBox({ title: 'ActiveSync', text: (e && e.message) || 'The request failed.', icon: 'warning' });
            return null;
        } finally {
            busy -= 1;
            render();
        }
    }

    async function endPartnership() {
        const st = as.state();
        const yes = await ws.messageBox({
            title: 'ActiveSync', icon: 'question', modal: true, cancelValue: false,
            text: `Delete the partnership with ${computerName(st)}? Items waiting for this device are removed.`,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }]
        });
        if (yes !== true) return;
        await run(() => as.endPartnership(st.id));
        view = 'main';
        render();
        ws.syncHistory();
    }

    async function showStatus() {
        const entries = await run(() => as.log(as.state().id, 60));
        if (!entries) return;
        logEntries = entries;
        view = 'status';
        render();
        ws.syncHistory();
    }

    /** Sync: say hello again (a dropped connection comes back, the list refreshes). */
    async function sync() {
        await run(() => as.hello());
    }

    const canSend = (st) => !!(window.activeSyncClipboard && st.online && (st.session === 'guest' || st.session === 'partner') && st.computers.length);

    function menuItems() {
        const st = as.state();
        return [
            // ActiveSync's menu order (syncres): Options... (the computer, the Café Miniport, the phone's data), Status...
            { label: 'Options...', action: () => { optsBegin(); view = 'options'; render(); ws.syncHistory(); }, disabled: !optsAvailable(st) },
            { label: 'Status...', action: showStatus, disabled: !st.online },
            { label: `Received Items${as.receivedUnseen && as.receivedUnseen() ? ` (${as.receivedUnseen()})` : ''}...`, action: openReceived },
            '-',
            // activeSyncClipboard.js: to the computer this phone is connected to
            { label: 'Send Clipboard', action: () => { const c = window.activeSyncClipboard; const t = c && c.targets()[0]; if (t) void c.sendClipboard(t.id); }, disabled: !canSend(st) },
            { label: 'Send Link...', action: () => { const c = window.activeSyncClipboard; const t = c && c.targets()[0]; if (t) void c.sendLink(t.id); }, disabled: !canSend(st) }
        ];
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: 'ActiveSync',
            icon: 'app-activesync',
            inStart: 'programs',
            mount(p) {
                page = p;
                p.classList.add('wm-activesync');
                // Received Items: a tap selects, a tap on the selected one does its action
                p.addEventListener('click', (e) => {
                    const li = view === 'received' && e.target.closest('.was-rx[data-i]');
                    if (!li) return;
                    const i = Number(li.dataset.i);
                    if (i === rxSel) { void actOn(rxItems()[i]); return; }
                    rxSel = i;
                    render();
                });
            },
            show() { render(); },
            // Options is a form (ok saves); Status is a page over the main one
            titleKind() { return view === 'options' || view === 'optset' ? 'ok' : 'close'; },
            onTitleOk() {
                if (view === 'options') { void optsSave(); return true; }
                if (view === 'optset') { optsSettingsDone(true); return true; }
                return false;
            },
            historyDepth() { return view === 'main' ? 0 : view === 'optset' ? 2 : 1; },
            onBack() {
                if (view === 'main') return false;
                // a Settings page goes back to Options with its changes (WM's back keeps a settings page)
                if (view === 'optset') { optsSettingsDone(true); return true; }
                if (view === 'options') opts = null;
                view = 'main';
                render();
                return true;
            },
            softKeys() {
                if (view === 'options') return { left: null, right: { label: 'Cancel', action: () => { opts = null; view = 'main'; render(); ws.syncHistory(); } } };
                if (view === 'optset') return { left: null, right: { label: 'Cancel', action: () => optsSettingsDone(false) } };
                if (view === 'status') return { left: { label: 'Done', action: () => { view = 'main'; render(); ws.syncHistory(); } }, right: null };
                if (view === 'received') {
                    const items = rxItems();
                    const it = items[rxSel];
                    return {
                        left: { label: it ? (RX[it.kind] || RX.file).act : 'Done', action: () => { if (it) void actOn(it); else { view = 'main'; render(); ws.syncHistory(); } } },
                        right: { label: 'Menu', menu: () => [
                            { label: it ? (RX[it.kind] || RX.file).act : 'Open', action: () => actOn(it), disabled: !it },
                            { label: 'Remove', action: () => removeReceived(false), disabled: !it },
                            { label: 'Clear All', action: () => removeReceived(true), disabled: !items.length }, '-',
                            { label: 'Done', action: () => { view = 'main'; render(); ws.syncHistory(); } }
                        ] }
                    };
                }
                return { left: { label: 'Sync', action: sync, disabled: busy > 0 }, right: { label: 'Menu', menu: menuItems } };
            }
        });
        as.on('state', render);
        as.on('received', () => { if (view === 'received' || view === 'main') render(); });
        // the Miniport's settings and figures came (Café Cache shows them; the draft keeps what was ticked)
        try { if (mc() && typeof mc().on === 'function') mc().on('miniport-config', () => { if (view === 'options' && opts && opts.cafe && !opts.cafeTouched) optsCafeFromConfig(); if (view === 'options' || view === 'optset') render(); }); } catch (_) { /* no Miniport */ }
        // the picture turns while the computer is being served
        as.on('request', () => {
            activity += 1;
            render();
            clearTimeout(activityTimer);
            activityTimer = setTimeout(() => { activity = 0; render(); }, 1600);
        });
    }

    // the title bar's ActiveSync icon opens the list (wmShell.js 'received' bubble)
    window.wmActiveSync = { openReceived: () => { if (ws) openReceived(); } };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
