/**
 * Control Panel > Firmware (DreamOS, #910; Yukimi Nov 19 2026: "a firmware control panel to see the state of the
 * system agent"). Read-only: what CaféReady (the system agent, DreamOS cafeready firmware.rs) reports when the page
 * opens - its version and build, its components, the OS base and its A/B slots (running, next start, tries left,
 * the recovery copy), the update channel and signing keys, the last check and install, the health of its Miniport
 * link, task host and page bridge, the hardware packs, and the machine's own firmware (SMBIOS / EFI). Laid out as
 * Vista's System page (cpl-system.css) with Control Panel's tables (cpl-vtable).
 *
 * Tasks: Check for firmware updates (Melaton Update's firmware box shows it), Restart to recovery options (the
 * recovery entry starts once at the next start: a volatile LoaderEntryOneShot, then the normal Restart), Refresh.
 * The report is asked once when the page opens or is refreshed; the update section follows the host's pushes
 * ('dreamosupdates'). Registered only where the shell bridge gives window.DreamOSFirmware.
 */
(function (root) {
    'use strict';

    const ICON = '/static_images/vista-devmgr/processors-32.png';
    let registered = false;
    let main = null;
    let info = null;
    let error = '';
    let loading = null;
    let watch = null;

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const cpl = () => root.melatonControlPanel;
    const host = () => root.DreamOSFirmware || null;
    const fw = () => root.melatonFirmware || null;

    const mb = (b) => {
        const n = Math.max(0, Number(b) || 0);
        return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(1)} MB`;
    };

    function when(sec) {
        const n = Number(sec);
        if (!Number.isFinite(n) || n <= 0) return 'Never';
        const d = new Date(n * 1000);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }

    function section(title, inner) {
        return `<section class="cpl-sys-section"><h2 class="cpl-sys-head"><span>${esc(title)}</span></h2>${inner}</section>`;
    }

    function rows(list) {
        return `<div class="cpl-sys-rows">${list.filter(Boolean).map(([label, value]) => `<div class="cpl-sys-row"><span class="cpl-sys-label">${esc(label)}</span><span class="cpl-sys-value">${value == null || value === '' ? '<span class="cpl-sys-na">Not available</span>' : esc(value)}</span></div>`).join('')}</div>`;
    }

    function table(head, body, empty) {
        return `<table class="cpl-vtable cpl-fw-table"><tr class="is-head">${head.map((h) => `<td>${esc(h)}</td>`).join('')}</tr>${body.length
            ? body.map((r) => `<tr>${r.map((c) => `<td title="${esc(c)}">${esc(c)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${head.length}">${esc(empty)}</td></tr>`}</table>`;
    }

    function slotStatus(slot, boot) {
        const words = [];
        if (slot.running) words.push('Running');
        const entry = (boot.entries || []).find((e) => (slot.recovery ? e.recovery : e.version && e.version === slot.version && !e.recovery));
        if (entry && entry.next) words.push('Next start');
        if (slot.recovery) words.push('Recovery copy');
        if (slot.empty) words.push('Empty');
        if (!words.length) words.push(entry ? 'Previous version' : 'Not bootable');
        return { status: words.join(', '), tries: entry && entry.counting ? `${entry.triesLeft} left${entry.triesDone ? `, ${entry.triesDone} used` : ''}` : (entry ? 'Confirmed' : '') };
    }

    /** What systemd-boot starts next, by name: a one-shot (the recovery options), else the default or newest. */
    function nextStart(boot) {
        const e = (boot.entries || []).find((x) => x.next);
        const name = e ? (e.recovery ? 'Recovery options' : `DreamOS ${e.version}`) : (boot.next || '');
        return boot.oneShot ? `${name} (once, then Melaton as usual)` : name;
    }

    function body() {
        if (!host()) return '<div class="cpl-sys-page"><h1 class="cpl-sys-title">Firmware</h1><p>This computer has no system agent.</p></div>';
        if (!info) {
            return `<div class="cpl-sys-page"><h1 class="cpl-sys-title">View information about this computer's firmware</h1><p>${error ? esc(`CaféReady did not answer: ${error}`) : 'Asking CaféReady...'}</p></div>`;
        }
        const a = info.agent || {};
        const b = info.base || {};
        const boot = info.boot || {};
        const up = info.update || {};
        const m = info.firmware || {};
        const h = info.health || {};
        const link = h.link || {};
        const tasks = (h.tasks && h.tasks.info) || {};
        const slots = (info.slots && info.slots.slots) || [];
        const comps = Array.isArray(info.components) ? info.components : [];
        const packs = (info.packs && info.packs.packs) || [];
        const keys = Array.isArray(info.keys) ? info.keys : [];
        const staged = Array.isArray(up.staged) ? up.staged : [];
        const f = fw();
        const busy = up.busy && up.progress && up.progress.state === 'running';
        return `<div class="cpl-sys-page cpl-fw-page">
            <h1 class="cpl-sys-title">View information about this computer's firmware</h1>
            ${section('System agent', rows([
                ['Name:', a.name || 'CaféReady'],
                ['Version:', a.version],
                ['Build:', a.build ? `${a.build}${a.built ? ` (${when(a.built)})` : ''}` : ''],
                ['Delivered as:', a.delivered ? a.delivered.charAt(0).toUpperCase() + a.delivered.slice(1) : ''],
                ['Host interface:', a.hostApi != null ? `Level ${a.hostApi}` : ''],
                ['Running since:', when(a.since)]
            ]))}
            ${section('Components', table(['Component', 'Version', 'Status', 'Kept'], comps.map((c) => [
                c.name || c.id, `${String(c.version || '').replace(/ built on .*$/, '')}${c.fromImage ? ' (base image)' : ''}`,
                c.state === 'active' ? 'Running' : (c.state || 'Unknown'),
                [...(c.kept || []).filter((v) => v !== c.version), ...(c.refused || []).map((v) => `${v} (refused)`)].join(', ') || 'None'
            ]), 'No components are installed.'))}
            ${section('Operating system', rows([
                ['Version:', b.version ? `DreamOS ${b.version}${b.recoveryMode ? ' (recovery mode)' : ''}` : ''],
                ['Based on:', b.debian ? `Debian ${b.debian}` : ''],
                ['Kernel:', b.kernel],
                ['Interface level:', b.api ? `Level ${b.api}` : '']
            ]))}
            ${section('Boot slots', `${info.slots && info.slots.error ? `<p>${esc(info.slots.error)}</p>` : table(['Slot', 'Version', 'Status', 'Boot tries', 'Size'], slots.map((s) => {
                const st = slotStatus(s, boot);
                return [s.recovery ? 'Recovery' : `Slot ${s.slot}`, s.version || (s.empty ? 'Empty' : 'Unknown'), st.status, st.tries, mb(s.size)];
            }), 'No slots were found.')}${rows([
                ['Next start:', nextStart(boot)],
                ['Boot loader:', boot.loader]
            ])}`)}
            ${section('Updates', rows([
                ['Update channel:', up.channel],
                ['Signing keys:', keys.map((k) => `${k.id} (${k.algorithm}, ${k.fingerprint})`).join('; ')],
                ['Most recent check:', when(up.lastCheck)],
                ['Last installed:', when(up.lastInstall)],
                ['Status:', busy ? (up.progress.message || 'Working...') : staged.length
                    ? `Ready to install: ${staged.map((u) => (f ? f.label(u) : u.id)).join(', ')}`
                    : (up.nextBoot && up.nextBoot !== up.running ? `DreamOS ${up.nextBoot} starts at the next restart` : (up.lastError ? up.lastError : 'Up to date'))]
            ]))}
            ${section('Health', rows([
                ['Melaton Café Miniport:', link.error ? link.error : `${link.status || 'Unknown'}${link.server ? ` (${String(link.server).replace(/^https?:\/\//, '')})` : ''}`],
                ['Signed in:', link.error ? '' : (link.certificate ? 'Yes, with a client certificate' : (link.signedIn ? 'Yes, with this computer\'s session' : 'No'))],
                ['Task host:', Array.isArray(tasks.tasks) ? `${tasks.tasks.length} tasks (${tasks.tasks.join(', ')})${tasks.fromServer ? ', from the server' : ', from the base image'}` : ''],
                ['Page bridge:', h.bridge ? `Listening, ${h.bridge.pages} ${h.bridge.pages === 1 ? 'page' : 'pages'} connected` : '']
            ]))}
            ${section('Hardware packs', table(['Pack', 'Holds', 'For base', 'Size', 'Loaded'], packs.map((p) => [p.name, p.kind, p.base || '', mb(p.size), p.merged ? 'Yes' : 'No']), 'No hardware packs are installed.'))}
            ${section('Computer firmware', rows([
                ['Manufacturer:', m.system && m.system.vendor],
                ['Model:', m.system ? `${m.system.product || ''}${m.system.family ? ` (${m.system.family})` : ''}` : ''],
                ['Firmware version:', m.version ? `${m.vendor ? `${m.vendor} ` : ''}${m.version}` : ''],
                ['Firmware date:', m.date],
                ['Board:', m.board ? [m.board.vendor, m.board.name].filter(Boolean).join(' ') : ''],
                ['Firmware interface:', m.efi ? `${m.efiRevision || 'UEFI'}${m.efiFirmware ? `, ${m.efiFirmware}` : ''}${m.efiBits ? `, ${m.efiBits}-bit` : ''}` : 'Legacy BIOS'],
                ['Secure Boot:', m.secureBoot == null ? 'Not supported' : (m.secureBoot ? 'On' : 'Off')]
            ]))}
        </div>`;
    }

    function paint() {
        if (!main || !main.isConnected) return;
        main.innerHTML = body();
    }

    function load() {
        const h = host();
        if (!h) return Promise.resolve();
        if (loading) return loading;
        loading = Promise.resolve().then(() => h.info()).then((r) => {
            if (r && !r.error) { info = r; error = ''; } else error = (r && r.error) || 'no answer';
        }, (err) => { error = (err && err.message) || 'no answer'; }).finally(() => { loading = null; paint(); });
        return loading;
    }

    async function recovery() {
        const ask = typeof root.showConfirmationDialog === 'function'
            ? root.showConfirmationDialog('<p>The computer restarts into its recovery options: the recovery copy of DreamOS, which can repair this installation or reset its data. Melaton starts normally the time after.</p><p>Save your work and close your programs first.</p>',
                [{ text: 'Restart', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], null, { title: 'Recovery options' })
            : Promise.resolve(false);
        if (!(await ask)) return;
        const r = await Promise.resolve().then(() => host().recovery(true)).catch((err) => ({ error: err && err.message }));
        if (!r || r.error) {
            if (typeof root.showConfirmationDialog === 'function') root.showConfirmationDialog(esc((r && r.error) || 'CaféReady did not answer.'), [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Recovery options' });
            return;
        }
        // the normal restart (updates waiting install on the way down); a cancelled restart takes the one-shot back
        const done = typeof root.runWinlogonPower === 'function' ? await root.runWinlogonPower('restart') : false;
        if (done === false) void host().recovery(false);
    }

    function act(what) {
        if (what === 'refresh') { void load(); return; }
        if (what === 'check') {
            const f = fw();
            if (f) void f.check();
            if (cpl()) cpl().open('update');
            return;
        }
        if (what === 'recovery') void recovery();
    }

    function mount(el) {
        main = el;
        paint();
        void load();
        if (watch) watch.abort();
        watch = typeof AbortController !== 'undefined' ? new AbortController() : null;
        // the update section follows the host; a finished job may have changed the slots, components or packs
        let was = '';
        if (fw()) fw().onChange((s) => {
            const st = (s && s.progress && s.progress.state) || '';
            if (info) info.update = s;
            if (was === 'running' && st !== 'running') void load();
            else paint();
            was = st;
        }, watch ? watch.signal : null);
        const modal = el.closest('.modal');
        if (modal && !modal.dataset.cplFwWired) {
            modal.dataset.cplFwWired = '1';
            modal.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-cpl-fw]');
                if (b) act(b.dataset.cplFw);
            });
        }
    }

    function unmount() {
        if (watch) { watch.abort(); watch = null; }
        main = null;
    }

    function link(label, what) {
        return `<li><button type="button" class="cpl-link" data-cpl-fw="${what}">${esc(label)}</button></li>`;
    }

    function register() {
        if (registered) return true;
        const c = cpl();
        if (!c || typeof c.registerPage !== 'function') return false;
        // a DreamOS machine only: its shell bridge gives the system agent's report
        if (!host()) return false;
        registered = true;
        c.registerItem({
            id: 'firmware',
            name: 'Firmware',
            image: ICON,
            cats: ['system', 'additional'],
            description: 'View the system agent, the operating system\'s slots and the computer\'s firmware, and check for firmware updates.',
            open: () => c.open('firmware')
        });
        c.registerPage('firmware', {
            title: () => 'Firmware',
            tasks: () => `
                <div class="cpl-task-group">
                    <h3 class="cpl-task-heading">Tasks</h3>
                    <ul class="cpl-task-list">
                        ${link('Check for firmware updates', 'check')}
                        ${link('Restart to recovery options', 'recovery')}
                        ${link('Refresh', 'refresh')}
                    </ul>
                </div>
                <div class="cpl-task-group cpl-task-group--see-also">
                    <h3 class="cpl-task-heading">See also</h3>
                    <ul class="cpl-task-list">
                        ${c.taskLinkHtml('Melaton Update', 'nav', 'update')}
                        ${c.taskLinkHtml('System', 'item', 'system')}
                        ${c.taskLinkHtml('Device Manager', 'item', 'device-manager')}
                    </ul>
                </div>`,
            body: () => '<div class="cpl-fw-host"></div>',
            mount: (el) => mount(el.querySelector('.cpl-fw-host') || el),
            unmount
        });
        return true;
    }

    root.cplFirmware = { register, open: () => register() && cpl().open('firmware'), _test: { body: (i) => { info = i; return body(); } } };
    // loaded with Control Panel (featureLoader.js control_panel), after the page is up
    if (typeof document !== 'undefined') register();
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplFirmware;
})(typeof window !== 'undefined' ? window : globalThis);
