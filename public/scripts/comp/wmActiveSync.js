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
    let view = 'main'; // 'main' | 'options' | 'status'
    let busy = 0;
    let logEntries = [];
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

    function optionsHtml(st) {
        return `<div class="wm-form-hdr">Options</div>
            <div class="was-form"><p>${esc(computerName(st))} may use:</p>
            ${PERMISSIONS.map(([id, label]) => `<label class="wm-check"><input type="checkbox" name="${id}"${st.permissions.includes(id) ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>`;
    }

    // Menu > Phone Data... (Yukimi, Nov 12, #777): the phone's own calendar and contacts in Calendar
    // and Contacts: shown on this phone only, or synchronized to Melaton (wmAndroidApps.js wmPhoneData)
    const PHONE_DATA_KEY = 'wmPhoneData';
    const PHONE_DATA = [['off', 'Off'], ['show', 'Show on this phone'], ['sync', 'Synchronize to Melaton']];
    const phoneData = () => window.wmPhoneData || null;
    function phoneDataHtml() {
        let cur = {};
        try { cur = JSON.parse(localStorage.getItem(PHONE_DATA_KEY) || '{}') || {}; } catch (_) { cur = {}; }
        const group = (kind, label) => `<p>${esc(label)}:</p>${PHONE_DATA.map(([v, l]) => `<label class="wm-check"><input type="radio" name="pd-${kind}" value="${v}"${(cur[kind] || 'off') === v ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}`;
        return `<div class="wm-form-hdr">Phone Data</div>
            <div class="was-form was-phonedata"><p>The phone's own calendar and contacts in Calendar and Contacts. Synchronize copies them to Melaton, so every computer and phone sees them (read-only there; this phone stays the source).</p>
            ${group('calendar', 'Calendar')}<div class="wm-form-gap"></div>${group('contacts', 'Contacts')}</div>`;
    }

    async function savePhoneData() {
        const pick = (kind) => { const r = page.querySelector(`input[name="pd-${kind}"]:checked`); return r ? r.value : 'off'; };
        const next = { calendar: pick('calendar'), contacts: pick('contacts') };
        let before = {};
        try { before = JSON.parse(localStorage.getItem(PHONE_DATA_KEY) || '{}') || {}; } catch (_) { before = {}; }
        try { localStorage.setItem(PHONE_DATA_KEY, JSON.stringify(next)); } catch (_) { /* this session only */ }
        view = 'main';
        render();
        ws.syncHistory();
        // Android asks for access the first time; the mirror is written at once in Synchronize
        if (before.calendar !== next.calendar || before.contacts !== next.contacts) {
            document.dispatchEvent(new CustomEvent('wmPhoneDataChange', { detail: Object.assign({}, next) }));
        }
    }

    function statusHtml() {
        return `<div class="wm-form-hdr">Status</div>
            <ul class="was-log">${logEntries.length ? logEntries.map((e) => `<li class="is-${esc(e.level)}"><time>${esc(when(e.at))}</time>${esc(e.text)}</li>`).join('') : '<li>No activity yet.</li>'}</ul>`;
    }

    function render() {
        if (!page) return;
        const st = as.state();
        if (view === 'options' && st.session !== 'partner') view = 'main';
        const html = view === 'options' ? optionsHtml(st) : view === 'phonedata' ? phoneDataHtml() : view === 'status' ? statusHtml() : mainHtml(st);
        if (page.dataset.html !== html) {
            page.dataset.html = html;
            page.innerHTML = html;
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

    async function saveOptions() {
        const picked = [...page.querySelectorAll('.was-form input[type="checkbox"]')].filter((c) => c.checked).map((c) => c.name);
        await run(() => as.update(as.state().id, { permissions: picked }));
        view = 'main';
        render();
        ws.syncHistory();
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
            { label: 'Options...', action: () => { view = 'options'; render(); ws.syncHistory(); }, disabled: st.session !== 'partner' },
            { label: 'Phone Data...', action: () => { view = 'phonedata'; render(); ws.syncHistory(); }, disabled: !(phoneData() && phoneData().available()) },
            { label: 'Status...', action: showStatus, disabled: !st.online },
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
            },
            show() { render(); },
            // Options is a form (ok saves); Status is a page over the main one
            titleKind() { return view === 'options' || view === 'phonedata' ? 'ok' : 'close'; },
            onTitleOk() {
                if (view === 'options') { void saveOptions(); return true; }
                if (view === 'phonedata') { void savePhoneData(); return true; }
                return false;
            },
            historyDepth() { return view === 'main' ? 0 : 1; },
            onBack() {
                if (view === 'main') return false;
                view = 'main';
                render();
                return true;
            },
            softKeys() {
                if (view === 'options') return { left: { label: 'Delete', action: endPartnership }, right: { label: 'Cancel', action: () => { view = 'main'; render(); ws.syncHistory(); } } };
                if (view === 'status') return { left: { label: 'Done', action: () => { view = 'main'; render(); ws.syncHistory(); } }, right: null };
                if (view === 'phonedata') return { left: null, right: { label: 'Cancel', action: () => { view = 'main'; render(); ws.syncHistory(); } } };
                return { left: { label: 'Sync', action: sync, disabled: busy > 0 }, right: { label: 'Menu', menu: menuItems } };
            }
        });
        as.on('state', render);
        // the picture turns while the computer is being served
        as.on('request', () => {
            activity += 1;
            render();
            clearTimeout(activityTimer);
            activityTimer = setTimeout(() => { activity = 0; render(); }, 1600);
        });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
