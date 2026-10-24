/**
 * Device Manager (Yozora #632): Vista's MMC snap-in window (menu bar, toolbar, the device tree under
 * the computer's name) over the hardware this browser can see:
 *
 *   Display adapters   the WebGL renderer (WEBGL_debug_renderer_info), else "Standard VGA Graphics Adapter"
 *   Processors         one entry per logical processor (navigator.hardwareConcurrency)
 *   Monitors           the screen (screen.width x height, the pixel ratio)
 *   Sound, video and game controllers / Audio inputs and outputs   navigator.mediaDevices
 *   Keyboards, Mice    the standard PS/2 and HID devices every computer reports
 *   Network adapters   Melaton's VPN connection (melatonNetworkDialogs.js), WAN Miniport (L-PPoP)
 *   Disk drives        the browser's storage quota as the server's disk
 *   Human Interface Devices   the gamepads the browser sees
 *
 * A device's Properties is Vista's own sheet (devmgr.dll.mui General / Driver / Details).
 *   openDeviceManager()
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ITEMS = '/static_images/vista-cpl/items';
    const CMD = '/static_images/vista-cmdbar';

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function gpuName() {
        try {
            const gl = doc.createElement('canvas').getContext('webgl');
            const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
            const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
            // "ANGLE (Intel, Intel(R) UHD Graphics 630 (0x3E92) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> the adapter
            const m = /ANGLE \([^,]*,\s*([^(]+?)(?:\s*\(0x|\s+Direct3D|,|\))/.exec(name || '');
            return (m ? m[1] : name || '').trim() || 'Standard VGA Graphics Adapter';
        } catch (_) {
            return 'Standard VGA Graphics Adapter';
        }
    }

    async function categories() {
        const n = (root.navigator && root.navigator.hardwareConcurrency) || 1;
        const s = root.screen || {};
        let media = [];
        try { media = root.navigator.mediaDevices ? await root.navigator.mediaDevices.enumerateDevices() : []; } catch (_) { media = []; }
        const label = (d, fallback, i) => d.label || `${fallback} ${i + 1}`;
        const audioOut = media.filter((d) => d.kind === 'audiooutput');
        const audioIn = media.filter((d) => d.kind === 'audioinput');
        const video = media.filter((d) => d.kind === 'videoinput');
        const pads = (root.navigator.getGamepads ? Array.from(root.navigator.getGamepads()) : []).filter(Boolean);
        const conn = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo() : { connectionName: 'VPN Connection', connectionType: 'WAN', device: 'L-PPoP' };
        let quota = 0;
        try { const e = root.navigator.storage && await root.navigator.storage.estimate(); quota = (e && e.quota) || 0; } catch (_) { /* none */ }
        const cats = [
            { name: 'Computer', icon: `${ITEMS}/system-16.png`, devices: ['ACPI x64-based PC'] },
            { name: 'Disk drives', icon: `${ITEMS}/administrative-tools-16.png`, devices: [`Dreamscape Virtual Disk${quota ? ` (${Math.round(quota / 1e9)} GB)` : ''}`] },
            { name: 'Display adapters', icon: `${ITEMS}/personalization-16.png`, devices: [gpuName()] },
            { name: 'Human Interface Devices', icon: `${ITEMS}/game-controllers-16.png`, devices: ['USB Input Device'].concat(pads.map((p) => p.id.replace(/\s*\(.*\)$/, ''))) },
            { name: 'IDE ATA/ATAPI controllers', icon: `${ITEMS}/administrative-tools-16.png`, devices: ['Standard Dual Channel PCI IDE Controller'] },
            { name: 'Keyboards', icon: `${ITEMS}/keyboard-16.png`, devices: ['Standard PS/2 Keyboard'] },
            { name: 'Mice and other pointing devices', icon: `${ITEMS}/mouse-16.png`, devices: ['HID-compliant mouse'].concat(root.matchMedia && root.matchMedia('(any-pointer: coarse)').matches ? ['HID-compliant touch screen'] : []) },
            { name: 'Monitors', icon: `${ITEMS}/personalization-16.png`, devices: [`Generic PnP Monitor (${s.width || 0} x ${s.height || 0})`] },
            { name: 'Network adapters', icon: `${ITEMS}/network-and-sharing-center-16.png`, devices: [`${conn.connectionType || 'WAN'} Miniport (${conn.device || 'L-PPoP'})`] },
            { name: 'Processors', icon: `${ITEMS}/system-16.png`, devices: Array.from({ length: n }, () => 'Melaton Virtual Processor') },
            { name: 'Sound, video and game controllers', icon: `${ITEMS}/sound-16.png`, devices: (audioOut.length ? audioOut.map((d, i) => label(d, 'High Definition Audio Device', i)) : ['High Definition Audio Device']).concat(video.map((d, i) => label(d, 'USB Video Device', i))) },
            { name: 'System devices', icon: `${ITEMS}/system-16.png`, devices: ['ACPI Fixed Feature Button', 'High precision event timer', 'Programmable interrupt controller', 'System CMOS/real time clock', 'System timer'] },
            { name: 'Universal Serial Bus controllers', icon: `${ITEMS}/device-manager-16.png`, devices: ['USB Root Hub', 'Standard Enhanced PCI to USB Host Controller'] }
        ];
        if (audioIn.length) cats.splice(1, 0, { name: 'Audio inputs and outputs', icon: `${ITEMS}/sound-16.png`, devices: audioIn.map((d, i) => label(d, 'Microphone', i)) });
        return cats;
    }

    let win = null;
    let tree = null;
    const expanded = new Set();

    function computerName() {
        const n = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo() : null;
        const host = (root.location && root.location.hostname) || 'melaton';
        return `${(n && n.domain) || 'DREAMSCAPE'}-${host.split('.')[0].toUpperCase()}`.slice(0, 15);
    }

    function render() {
        if (!win || !tree) return;
        const body = win.querySelector('.dm-tree');
        body.innerHTML = `<div class="dm-row is-root is-open" data-dm="root"><span class="dm-twisty"></span><img src="${ITEMS}/system-16.png" alt=""><span>${esc(computerName())}</span></div>
            ${tree.map((c, ci) => {
                const open = expanded.has(c.name);
                return `<div class="dm-row is-cat${open ? ' is-open' : ''}" data-dm="cat" data-cat="${ci}" tabindex="0"><span class="dm-twisty"></span><img src="${esc(c.icon)}" alt=""><span>${esc(c.name)}</span></div>
                    ${open ? c.devices.map((d, di) => `<div class="dm-row is-dev" data-dm="dev" data-cat="${ci}" data-dev="${di}" tabindex="0"><img src="${esc(c.icon)}" alt=""><span>${esc(d)}</span></div>`).join('') : ''}`;
            }).join('')}`;
    }

    function openProperties(ci, di) {
        const c = tree[ci];
        const name = c.devices[di];
        const V = root.vistaDialogTemplate;
        if (!V) return;
        const sheet = root.cplDialogs && root.cplDialogs.sheet;
        const open = sheet || ((def) => V.openSheet(def));
        open({
            windowId: 'dmDeviceProperties',
            title: `${name} Properties`,
            icon: c.icon,
            noApply: true,
            pages: [{ key: 'devmgr:103', overrides: { 218: { image: c.icon.replace('-16.png', '-32.png') } } }, { key: 'devmgr:106', overrides: { 226: { image: c.icon.replace('-16.png', '-32.png') } } }, { key: 'devmgr:372', overrides: { 373: { image: c.icon.replace('-16.png', '-32.png') } } }],
            init(ctx) {
                ['devmgr:103', 'devmgr:106', 'devmgr:372'].forEach((p) => ctx.text(p === 'devmgr:103' ? 219 : p === 'devmgr:106' ? 227 : 374, name, p));
                ctx.set(220, c.name, 'devmgr:103');
                ctx.set(221, /Melaton|Dreamscape/.test(name) ? 'Xyridian Corporation' : '(Standard system devices)', 'devmgr:103');
                ctx.set(357, 'PCI bus 0, device 1, function 0', 'devmgr:103');
                ctx.set(223, 'This device is working properly.', 'devmgr:103');
                ctx.set(385, 'Xyridian', 'devmgr:106');
                ctx.set(387, '6/21/2006', 'devmgr:106');
                ctx.set(389, '6.0.6002.18005', 'devmgr:106');
                ctx.set(393, 'Xyridian Melaton', 'devmgr:106');
                ['devmgr:103', 'devmgr:106', 'devmgr:372'].forEach((p) => {
                    ctx.content.querySelectorAll(`[data-vdt-page="${p}"] input.vdt-edit`).forEach((i) => { i.readOnly = true; });
                });
                const props = [['Device description', name], ['Hardware Ids', `ROOT\\${c.name.replace(/\W+/g, '').toUpperCase()}\\0000`], ['Class', c.name], ['Driver', 'Xyridian'], ['Manufacturer', ctx.get(221, 'devmgr:103')]];
                ctx.options(375, props.map((p, i) => ({ value: String(i), text: p[0] })), '0', 'devmgr:372');
                const lv = ctx.holder(376, 'devmgr:372');
                const showProp = () => { lv.querySelector('.vdt-lv-body').innerHTML = `<div class="vdt-lv-row is-selected"><span>${esc(props[Number(ctx.get(375, 'devmgr:372'))][1])}</span></div>`; };
                ctx.on(375, 'change', showProp, 'devmgr:372');
                showProp();
                ctx.enable(309, false, 'devmgr:103');
                ctx.enable(217, false, 'devmgr:103');
                [380, 394, 378, 382].forEach((id) => ctx.enable(id, false, 'devmgr:106'));
            }
        }, null, win);
    }

    function build() {
        win = doc.createElement('div');
        win.id = 'deviceManagerModal';
        win.className = 'modal hidden resizeable-window dm-window';
        win.dataset.windowIdentifier = 'deviceManager';
        win.dataset.windowClient = 'light';
        win.dataset.windowDefaultWidth = '640';
        win.dataset.windowDefaultHeight = '480';
        win.dataset.windowMinWidth = '320';
        win.dataset.windowMinHeight = '240';
        win.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ITEMS}/device-manager-16.png" alt=""><span>Device Manager</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small dm-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content win7 dm-client">
                <div class="naxt-menubar dm-menubar" role="menubar" data-win32-menus><button type="button" class="naxt-menu-title" data-dm-menu="file">File</button><button type="button" class="naxt-menu-title" data-dm-menu="action">Action</button><button type="button" class="naxt-menu-title" data-dm-menu="view">View</button><button type="button" class="naxt-menu-title" data-dm-menu="help">Help</button></div>
                <div class="dm-toolbar" role="toolbar">
                    <button type="button" data-dm-tool="back" title="Back" disabled><span class="dm-tb-icon" style="--i:0"></span></button>
                    <button type="button" data-dm-tool="forward" title="Forward" disabled><span class="dm-tb-icon" style="--i:1"></span></button>
                    <span class="dm-sep"></span>
                    <button type="button" data-dm-tool="properties" title="Properties"><span class="dm-tb-icon" style="--i:8"></span></button>
                    <button type="button" data-dm-tool="help" title="Help"><span class="dm-tb-icon" style="--i:15"></span></button>
                    <span class="dm-sep"></span>
                    <button type="button" data-dm-tool="scan" title="Scan for hardware changes"><img src="${CMD}/refresh.png" alt=""></button>
                </div>
                <div class="dm-tree" role="tree" tabindex="0"></div>
            </div>`;
        doc.body.appendChild(win);
        win.querySelector('.dm-close').addEventListener('click', () => callGlobal('closeModal', win));
        // attached up front: contextMenu opens them on click, and hovering another title
        // while one is open switches to it
        win.querySelectorAll('[data-dm-menu]').forEach(attachMenu);
        win.addEventListener('click', (ev) => {
            const row = ev.target.closest('.dm-row');
            if (row) {
                win.querySelectorAll('.dm-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
                row.classList.add('is-selected');
                if (row.dataset.dm === 'cat' && ev.target.closest('.dm-twisty')) toggle(row);
            }
            const tool = ev.target.closest('[data-dm-tool]');
            if (tool) {
                const t = tool.dataset.dmTool;
                if (t === 'scan') void refresh();
                else if (t === 'help') callGlobal('openHelpAndSupport', 'device-manager');
                else if (t === 'properties') {
                    const sel = win.querySelector('.dm-row.is-selected.is-dev');
                    if (sel) openProperties(Number(sel.dataset.cat), Number(sel.dataset.dev));
                }
            }
        });
        win.addEventListener('dblclick', (ev) => {
            const row = ev.target.closest('.dm-row');
            if (!row) return;
            if (row.dataset.dm === 'cat') toggle(row);
            else if (row.dataset.dm === 'dev') openProperties(Number(row.dataset.cat), Number(row.dataset.dev));
        });
        win.addEventListener('keydown', (ev) => {
            const row = ev.target.closest && ev.target.closest('.dm-row');
            if (!row) return;
            if (ev.key === 'Enter' && row.dataset.dm === 'dev') openProperties(Number(row.dataset.cat), Number(row.dataset.dev));
            if ((ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && row.dataset.dm === 'cat') {
                const name = tree[Number(row.dataset.cat)].name;
                if ((ev.key === 'ArrowRight') !== expanded.has(name)) toggle(row);
            }
        });
    }

    function toggle(row) {
        const c = tree[Number(row.dataset.cat)];
        if (expanded.has(c.name)) expanded.delete(c.name); else expanded.add(c.name);
        render();
    }

    function attachMenu(btn) {
        const cm = root.contextMenu;
        if (!cm) return;
        const items = {
            // devmgr's MMC menus (Vista): File, Action, View with its four views, Help
            file: [{ text: 'Options...', action: 'dm-none', disabled: true }, { separator: true }, { text: 'Exit', action: 'dm-exit' }],
            action: [{ text: 'Scan for hardware changes', action: 'dm-scan' }, { text: 'Add legacy hardware', action: 'dm-add-hw' }, { separator: true }, { text: 'Properties', action: 'dm-props' }, { separator: true }, { text: 'Help', action: 'dm-help' }],
            view: [
                { text: 'Devices by type', action: 'dm-none', checked: true, showIndicator: true, indicatorMark: 'radio' },
                { text: 'Devices by connection', action: 'dm-none', disabled: true },
                { text: 'Resources by type', action: 'dm-none', disabled: true },
                { text: 'Resources by connection', action: 'dm-none', disabled: true },
                { separator: true },
                { text: 'Show hidden devices', action: 'dm-none', disabled: true },
                { separator: true },
                { text: 'Customize...', action: 'dm-none', disabled: true }
            ],
            help: [{ text: 'Help Topics', action: 'dm-help' }, { separator: true }, { text: 'About Microsoft Management Console'.replace('Microsoft', 'Xyridian'), action: 'dm-about' }]
        }[btn.dataset.dmMenu];
        cm.attachClickMenuToElement(btn, {
            sections: [{ type: 'list', items }],
            onAction: (action) => {
                if (action === 'dm-exit') callGlobal('closeModal', win);
                else if (action === 'dm-scan') void refresh();
                // the Add Hardware wizard (hdwwiz), as Control Panel opens it
                else if (action === 'dm-add-hw') { const cp = root.melatonControlPanel; if (cp && cp.doAction) cp.doAction('dialog:add-hardware'); }
                else if (action === 'dm-help') callGlobal('openHelpAndSupport', 'device-manager');
                else if (action === 'dm-props') {
                    const sel = win.querySelector('.dm-row.is-selected.is-dev');
                    if (sel) openProperties(Number(sel.dataset.cat), Number(sel.dataset.dev));
                } else if (action === 'dm-about') callGlobal('openAboutMelatoninModal');
            }
        });
    }

    async function refresh() {
        tree = await categories();
        render();
    }

    async function openDeviceManager() {
        if (!doc) return;
        if (!win) build();
        callGlobal('openModal', win);
        win.classList.remove('hidden');
        await refresh();
    }

    root.openDeviceManager = openDeviceManager;
    root.melatonDeviceManager = { open: openDeviceManager, categories, gpuName };
})(typeof window !== 'undefined' ? window : globalThis);
