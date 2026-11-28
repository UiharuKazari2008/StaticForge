/**
 * Rack Manager, virtual machine screens: the live thumbnails (rackd takes a frame of every running VM every 5 s while a
 * client holds the screens lease and pushes `vms/screen`; the picture is a file with an address, never a data: string)
 * and Virtual Machine Connection (VMConnect): one live console window per VM, noVNC on WS /rack/<server>/vms/<name>/console.
 * The socket is open only while the window is open and not minimised. Part of window.mmcRack (mmcRackManager.js).
 *
 *   R.vmThumbUrl(server, name, v)        the address of a VM's newest frame
 *   R.vmThumb(server, name, cls)         <img> HTML of it (kept current by the vms/screen feed, no repaint)
 *   R.vmScreensView(c, n, vms)           the grid of tiles (click selects, double click connects)
 *   R.vmScreensLease(c, server, on)      keeps rackd's frame feed running while a Screens view or preview is shown
 *   R.vmConnect(c, server, name)         the VMConnect window
 *   Needs from the VM page code: R.vmSettings(c, server, name)
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc, ITEMS } = R;
    const doc = root.document;
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);

    const FRAME = new Map();   // 'server\nname' -> the version (mtime) of the newest frame rackd pushed
    const WINS = new Map();    // 'server\nname' -> the open VMConnect window
    const wired = new WeakSet();
    const L = { server: null, timer: null };

    const VM_STATE = { running: 'Running', 'shut off': 'Off', shutoff: 'Off', paused: 'Paused', crashed: 'Crashed', pmsuspended: 'Suspended', 'in shutdown': 'Shutting down' };
    const stateText = (v) => (v ? (v.saved && v.state === 'shut off' ? 'Saved' : (VM_STATE[v.state] || v.state)) : '');
    const vmsOf = (server) => { const rs = R.ss(server).roles.vms; return arr(rs && rs.data && rs.data.vms); };
    const vmOf = (server, name) => vmsOf(server).find((v) => v.name === name) || null;

    // ---- thumbnails ---------------------------------------------------------------------------------------------

    const fileOf = (name) => `vmscr-${String(name).replace(/[^A-Za-z0-9._-]/g, '_')}.png`;
    R.vmThumbUrl = (server, name, v) => `/rack/${encodeURIComponent(server)}/files/shots/${fileOf(name)}?v=${v || 0}`;
    R.vmThumb = (server, name, cls) => {
        const v = FRAME.get(`${server}\n${name}`);
        return `<img class="rm-vmscr ${esc(cls || '')}" data-vmscr="${esc(name)}" data-server="${esc(server)}" alt="" src="${esc(R.vmThumbUrl(server, name, v))}">`;
    };

    /** Delegated wires of one console (once): a frame that cannot load shows the blank tile; tiles select and open. */
    function wire(c) {
        if (!c || !c.modal || wired.has(c.modal)) return;
        wired.add(c.modal);
        c.modal.addEventListener('error', (ev) => { const t = ev.target; if (t && t.classList && t.classList.contains('rm-vmscr')) t.classList.add('is-blank'); }, true);
        c.modal.addEventListener('load', (ev) => { const t = ev.target; if (t && t.classList && t.classList.contains('rm-vmscr')) t.classList.remove('is-blank'); }, true);
        c.modal.addEventListener('click', (ev) => {
            const tile = ev.target.closest && ev.target.closest('[data-vmtile]');
            if (tile && typeof c.selectRow === 'function') c.selectRow(tile.dataset.key);
        });
        c.modal.addEventListener('dblclick', (ev) => {
            const tile = ev.target.closest && ev.target.closest('[data-vmtile]');
            if (!tile) return;
            const n = c.find ? c.find(c.node) : null;
            if (n && n.server) void R.vmConnect(c, n.server, tile.dataset.vmtile);
        });
    }

    R.vmScreensView = (c, n, vms) => {
        wire(c);
        const tiles = arr(vms).map((v) => {
            const on = v.state === 'running' || v.state === 'paused';
            return `<div class="rm-vmtile${String(c.sel) === String(v.name) ? ' is-selected' : ''}" data-key="${esc(v.name)}" data-vmtile="${esc(v.name)}" title="${esc(v.name)}: double-click to connect">`
                + `<div class="rm-vmtile-pic">${on ? R.vmThumb(n.server, v.name) : ''}<span class="rm-vmtile-off">${esc(stateText(v))}</span></div>`
                + `<div class="rm-vmtile-cap"><b>${esc(v.name)}</b><i>${esc(stateText(v))}</i></div></div>`;
        }).join('');
        return `<div class="rm-vmscr-grid" data-mmc-scroll>${tiles || '<div class="mmc-empty">There are no virtual machines.</div>'}</div>`;
    };

    /** The lease of rackd's frame feed (45 s there, renewed every 25 s here): on while a thumbnail is on screen, off when it is not. */
    function leaseSend(server, on) { R.act(server, 'vms', 'screens', { watch: !!on }).catch(() => {}); }
    R.vmScreensLease = (c, server, on) => {
        wire(c);
        if (!on) {
            if (L.timer) { clearInterval(L.timer); L.timer = null; }
            if (L.server && (!server || server === L.server)) { const s = L.server; L.server = null; leaseSend(s, false); }
            return;
        }
        if (L.timer && L.server === server) return;
        if (L.timer) { clearInterval(L.timer); L.timer = null; if (L.server) leaseSend(L.server, false); }
        L.server = server;
        leaseSend(server, true);
        L.timer = setInterval(() => { if (L.server && !doc.hidden) leaseSend(L.server, true); }, 25000); // a hidden page lets the lease lapse (rackd stops the frames)
    };

    /** The pushed frames: every <img data-vmscr> of the VM gets the new address; nothing is repainted. */
    R.hooks.event.push((c, ev) => {
        if (!ev || ev.role !== 'vms') return false;
        wire(c);
        if (ev.kind === 'screen' && ev.data && ev.data.name) {
            const name = ev.data.name;
            FRAME.set(`${ev.server}\n${name}`, ev.data.v || Date.now());
            const url = R.vmThumbUrl(ev.server, name, ev.data.v || Date.now());
            c.modal.querySelectorAll('img[data-vmscr]').forEach((img) => { if (img.dataset.vmscr === name && img.dataset.server === ev.server) img.src = url; });
            return false;
        }
        WINS.forEach((w) => { if (w.server === ev.server) w.onEvent(ev); });
        return false;
    });
    R.hooks.open.push((c) => wire(c));

    // ---- Virtual Machine Connection -----------------------------------------------------------------------------

    const stamp = () => { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
    const fail = (c, e) => R.box(c, (e && e.message) || String(e || 'The request failed.'));

    R.vmConnect = async (c, server, name) => {
        const key = `${server}\n${name}`;
        const have = WINS.get(key);
        if (have) { have.front(); return have; }
        const w = build(c, server, name);
        WINS.set(key, w);
        return w;
    };

    function build(c, server, name) {
        const key = `${server}\n${name}`;
        const meta = R.meta(server) || {};
        const m = doc.createElement('div');
        m.className = 'modal hidden resizeable-window mmc-window rm-vmc-win';
        m.id = `vmc_${server}_${name}`.replace(/[^A-Za-z0-9_-]/g, '_');
        m.dataset.windowIdentifier = `vmc-${server}-${name}`;
        m.dataset.windowClient = 'light';
        m.dataset.taskbarIcon = `${ITEMS}/system-16.png`;
        m.dataset.windowDefaultWidth = '1040';
        m.dataset.windowDefaultHeight = '840';
        m.dataset.windowMinWidth = '480';
        m.dataset.windowMinHeight = '360';
        m.setAttribute('role', 'dialog');
        const title = `${name} on ${meta.label || server} - Virtual Machine Connection`;
        m.setAttribute('aria-label', title);
        const menus = ['File', 'Action', 'Media', 'Clipboard', 'View'];
        m.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ITEMS}/system-16.png" alt=""><span class="mmc-title">${esc(title)}</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small rm-vmc-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content win7 mmc-client rm-vmc">
                <div class="mmc-rebar">
                    <div class="naxt-menubar mmc-menubar" role="menubar">${menus.map((t) => `<button type="button" class="naxt-menu-title" data-vmc-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}</div>
                    <div class="mmc-toolbar rm-vmc-toolbar" role="toolbar"></div>
                </div>
                <div class="rm-vmc-screen" data-k="screen" tabindex="-1"><div class="rm-vmc-msg" data-k="msg">Connecting...</div></div>
                <div class="mmc-status rm-vmc-status"><span data-k="conn"></span><span data-k="vm"></span><span data-k="size"></span></div>
            </div>`;
        doc.body.appendChild(m);
        const $ = (k) => m.querySelector(`[data-k="${k}"]`);
        const screen = $('screen');

        const W = { server, name, modal: m };
        let rfb = null, wanted = true, tries = 0, retry = null, closed = false, loading = null, live = null, connected = false, watchCanvas = null, statsText = '', refreshT = null;

        const vm = () => vmOf(server, name);
        const stateNow = () => { if (live) return live; const v = vm(); return v ? v.state : ''; };
        const isRunning = () => { const s = stateNow(); return s === 'running' || s === 'paused'; };
        const msg = (t) => { $('msg').textContent = t || ''; $('msg').hidden = !t; };
        const conn = (t) => { $('conn').textContent = t; };
        const sizeText = () => { const cv = screen.querySelector('canvas'); $('size').textContent = connected && cv && cv.width ? `${cv.width} x ${cv.height}` : ''; };
        const vmText = () => { const v = vm(); const s = live ? (VM_STATE[live] || live) : stateText(v); $('vm').textContent = `${s}${statsText && s === 'Running' ? `, ${statsText}` : ''}`; };

        // ---- toolbar and menus
        const TB = [
            ['cad', 'Ctrl+Alt+Del', `${ITEMS}/keyboard-16.png`], ['start', 'Start'], ['off', 'Turn Off'], ['shutdown', 'Shut Down', `${ITEMS}/power-options-16.png`], ['reboot', 'Restart'], ['reset', 'Reset'], ['pause', 'Pause'], ['save', 'Save'],
            null, ['cp', 'Checkpoint', `${ITEMS}/backup-and-restore-center-16.png`], ['insert', 'Media', `${ITEMS}/autoplay-16.png`], ['settings', 'Settings', `${ITEMS}/system-16.png`]
        ];
        function enabled(id) {
            const s = stateNow(); const run = s === 'running'; const on = run || s === 'paused';
            switch (id) {
                case 'cad': return run && connected;
                case 'start': return !on && s !== 'in shutdown';
                case 'off': case 'shutdown': case 'reboot': case 'reset': case 'save': case 'cp': return run;
                case 'pause': return on;
                case 'revert': return !!s;
                case 'eject': return !!(vm() && arr(vm().cdroms).some((d) => d.source));
                case 'type': return run && connected;
                default: return true;
            }
        }
        function toolbar() {
            const paused = stateNow() === 'paused';
            const html = TB.map((t) => {
                if (!t) return '<span class="mmc-tb-sep"></span>';
                const id = t[0] === 'pause' && paused ? 'resume' : t[0];
                const text = t[0] === 'pause' && paused ? 'Resume' : t[1];
                return `<button type="button" class="mmc-tb rm-vmc-tb" data-vmc-tb="${id}" title="${esc(text)}"${enabled(t[0]) ? '' : ' disabled'}>${t[2] ? `<img class="rm-vmc-tbi" src="${esc(t[2])}" alt="">` : ''}<span>${esc(text)}</span></button>`;
            }).join('');
            const tb = m.querySelector('.rm-vmc-toolbar');
            if (tb.dataset.html !== html) { tb.innerHTML = html; tb.dataset.html = html; }
        }
        function menuItems(which) {
            const paused = stateNow() === 'paused';
            const it = (text, action, id) => ({ text, action, disabled: !enabled(id || action.split(':')[1]) });
            if (which === 'file') return [{ text: 'Settings...', action: 'settings' }, { separator: true }, { text: 'Exit', action: 'exit' }];
            if (which === 'action') return [it('Ctrl+Alt+Delete', 'a:cad', 'cad'), { separator: true }, it('Start', 'a:start', 'start'), it('Turn Off', 'a:off', 'off'), it('Shut Down', 'a:shutdown', 'shutdown'), it('Restart', 'a:reboot', 'reboot'), it('Reset', 'a:reset', 'reset'),
                paused ? it('Resume', 'a:resume', 'pause') : it('Pause', 'a:pause', 'pause'), it('Save', 'a:save', 'save'), { separator: true }, it('Checkpoint', 'a:cp', 'cp'), it('Revert...', 'a:revert', 'revert')];
            if (which === 'media') return [it('Insert Disk...', 'm:insert', 'insert'), it('Eject', 'm:eject', 'eject')];
            if (which === 'clipboard') return [it('Type Clipboard Text...', 'k:type', 'type')];
            return [{ text: 'Fit to Window', action: 'v:fit' }, { text: 'Actual Size', action: 'v:actual' }, { separator: true }, { text: 'Full Screen', action: 'v:full' }];
        }

        // ---- actions
        const refreshSoon = (ms) => { clearTimeout(refreshT); refreshT = setTimeout(() => { if (closed) return; void R.loadRole(c, server, 'vms', true).then(() => { live = null; W.update(); if (isRunning()) kick(); }); }, ms || 700); };
        async function doAct(op, params) {
            try { await R.act(server, 'vms', op, Object.assign({ name }, params || {})); refreshSoon(700); return true; } catch (e) { fail(c, e); return false; }
        }
        function insertDisk() {
            let isos = []; let pick = null; let cur = ''; let err = '';
            R.dialog(c, {
                id: 'vmcmedia', title: `Insert Disk: ${name}`, w: 460, h: 340, okText: 'Insert',
                html: '<div class="rm-field is-wide"><span>In the DVD drive now</span><b data-k="cur"></b></div><div class="rm-field is-wide"><span>ISO images on the server</span><div class="rm-isolist" data-k="isos"></div></div>',
                init: (ctx) => {
                    const q = (k) => ctx.content.querySelector(`[data-k="${k}"]`);
                    let loadingList = true;
                    const paint = () => {
                        q('cur').textContent = cur || 'Empty';
                        q('isos').innerHTML = isos.length ? isos.map((i) => `<div class="rm-isorow${i.path === pick ? ' is-selected' : ''}" data-p="${esc(i.path)}"><span>${esc(i.name)}</span><i>${esc(R.bytes(i.sizeB))}</i></div>`).join('') : `<div class="rm-hint">${esc(loadingList ? 'Reading data, please wait...' : err || 'There are no ISO images in the pool.')}</div>`;
                    };
                    const v = vm(); cur = v ? arr(v.cdroms).map((d) => d.source).filter(Boolean).map((s) => s.split('/').pop())[0] || '' : '';
                    paint();
                    R.act(server, 'vms', 'iso-list').then((r) => { const x = (r && r.result) || r || {}; isos = arr(x.isos); pick = isos[0] && isos[0].path; }, (e) => { err = (e && e.message) || ''; }).then(() => { loadingList = false; if (ctx.content.isConnected) paint(); });
                    ctx.content.addEventListener('click', (ev) => { const row = ev.target.closest('[data-p]'); if (row) { pick = row.dataset.p; paint(); } });
                },
                ok: async (ctx) => {
                    if (!pick) { R.err(ctx, 'Choose an ISO image.'); return false; }
                    try { await R.act(server, 'vms', 'cdrom', { name, iso: pick }); refreshSoon(500); return true; } catch (e) { R.err(ctx, (e && e.message) || 'The disk could not be inserted.'); return false; }
                }
            });
        }
        function revert() {
            let cps = []; let pick = null; let err = '';
            R.dialog(c, {
                id: 'vmcrevert', title: `Revert: ${name}`, w: 440, h: 320, okText: 'Revert',
                html: '<div class="rm-field is-wide"><span>Checkpoints</span><div class="rm-isolist" data-k="cps"></div></div><p class="rm-hint">The virtual machine returns to the chosen checkpoint. Changes made since then are lost.</p>',
                init: (ctx) => {
                    const q = ctx.content.querySelector('[data-k="cps"]');
                    let loadingList = true;
                    const paint = () => { q.innerHTML = cps.length ? cps.map((s) => `<div class="rm-isorow${s.name === pick ? ' is-selected' : ''}" data-s="${esc(s.name)}"><span>${esc(s.name)}</span><i>${esc(s.created ? R.when(s.created) : '')}</i></div>`).join('') : `<div class="rm-hint">${esc(loadingList ? 'Reading data, please wait...' : err || 'There are no checkpoints.')}</div>`; };
                    paint();
                    R.act(server, 'vms', 'checkpoints', { name }).then((r) => { const x = (r && r.result) || r || {}; cps = arr(x.checkpoints); pick = (cps.find((s) => s.current) || cps[0] || {}).name || null; }, (e) => { err = (e && e.message) || ''; }).then(() => { loadingList = false; if (ctx.content.isConnected) paint(); });
                    ctx.content.addEventListener('click', (ev) => { const row = ev.target.closest('[data-s]'); if (row) { pick = row.dataset.s; paint(); } });
                },
                ok: async (ctx) => {
                    const p = pick;
                    if (!p) { R.err(ctx, 'Choose a checkpoint.'); return false; }
                    const a = await R.taskDialog(c, { instruction: `Revert ${name} to ${p}?`, text: 'Changes made since the checkpoint are lost.', links: [{ id: 'go', text: 'Revert', danger: true }] });
                    if (a !== 'go') return false;
                    try { await R.act(server, 'vms', 'checkpoint', { name, op: 'apply', snap: p }); refreshSoon(800); return true; } catch (e) { R.err(ctx, (e && e.message) || 'The checkpoint could not be applied.'); return false; }
                }
            });
        }
        function typeText() {
            R.dialog(c, {
                id: 'vmctype', title: `Type Clipboard Text: ${name}`, w: 420, h: 280, okText: 'Type',
                html: '<p>The text is typed into the virtual machine as key presses, as if it came from the keyboard (up to 20000 characters).</p><textarea data-rm="text" class="rm-textarea" rows="6" spellcheck="false"></textarea><div class="rm-row"><button type="button" class="btn-standard" data-vmc-paste>Paste</button><span class="rm-hint" data-k="count">0 characters</span></div>',
                init: (ctx) => {
                    const t = ctx.content.querySelector('[data-rm="text"]'); const cnt = ctx.content.querySelector('[data-k="count"]');
                    const upd = () => { cnt.textContent = `${t.value.length} characters`; };
                    t.addEventListener('input', upd);
                    ctx.content.querySelector('[data-vmc-paste]').addEventListener('click', () => {
                        let p = null;
                        try { p = root.navigator.clipboard && root.navigator.clipboard.readText ? root.navigator.clipboard.readText() : null; } catch (_) { p = null; }
                        if (!p) { R.err(ctx, 'Paste with Ctrl+V into the box.'); return; }
                        p.then((s) => { t.value = String(s || '').slice(0, 20000); upd(); R.err(ctx, ''); }, () => R.err(ctx, 'The clipboard cannot be read here. Paste with Ctrl+V into the box.'));
                    });
                },
                ok: async (ctx) => {
                    const text = String(R.val(ctx, 'text') || '').slice(0, 20000);
                    if (!text) { R.err(ctx, 'Type some text first.'); return false; }
                    try { await R.act(server, 'vms', 'input', { name, events: [{ type: 'text', text }] }); if (rfb) rfb.focus(); return true; } catch (e) { R.err(ctx, (e && e.message) || 'The text could not be typed.'); return false; }
                }
            });
        }
        async function run(a) {
            switch (a) {
                case 'settings': if (typeof R.vmSettings === 'function') R.vmSettings(c, server, name); else await R.box(c, 'Settings are not available yet.'); return;
                case 'exit': W.close(); return;
                case 'a:cad': case 'cad': if (rfb) { rfb.sendCtrlAltDel(); rfb.focus(); } return;
                case 'a:start': case 'start': await doAct('start'); return;
                case 'a:off': case 'off': {
                    const a2 = await R.taskDialog(c, { instruction: `Turn off ${name}?`, text: 'The machine is switched off as if its power cord were pulled. Unsaved data in it is lost.', links: [{ id: 'go', text: 'Turn Off', danger: true }] });
                    if (a2 === 'go') await doAct('destroy');
                    return;
                }
                case 'a:shutdown': case 'shutdown': await doAct('shutdown'); return;
                case 'a:reboot': case 'reboot': await doAct('reboot'); return;
                case 'a:reset': case 'reset': await doAct('reset'); return;
                case 'a:pause': case 'pause': await doAct('suspend'); return;
                case 'a:resume': case 'resume': await doAct('resume'); return;
                case 'a:save': case 'save': await doAct('save'); return;
                case 'a:cp': case 'cp': await doAct('checkpoint', { op: 'create', snap: `checkpoint-${stamp()}` }); return;
                case 'a:revert': revert(); return;
                case 'm:insert': case 'insert': insertDisk(); return;
                case 'm:eject': await doAct('cdrom', { iso: null }); return;
                case 'k:type': typeText(); return;
                case 'v:fit': if (rfb) { rfb.scaleViewport = true; screen.classList.remove('is-actual'); } W.fit = true; return;
                case 'v:actual': if (rfb) { rfb.scaleViewport = false; screen.classList.add('is-actual'); } W.fit = false; return;
                case 'v:full': try { const p = screen.requestFullscreen && screen.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* not allowed */ } return;
                default:
            }
        }
        m.querySelectorAll('[data-vmc-menu]').forEach((t) => {
            if (!root.contextMenu) return;
            root.contextMenu.attachClickMenuToElement(t, { onAction: (a) => void run(a), sections: [{ type: 'list', initfn: (s) => { s.items = menuItems(t.dataset.vmcMenu); } }] });
        });
        m.querySelector('.rm-vmc-toolbar').addEventListener('click', (ev) => { const b = ev.target.closest('[data-vmc-tb]'); if (b && !b.disabled) void run(b.dataset.vmcTb); });
        m.querySelector('.rm-vmc-close').addEventListener('click', () => W.close());
        screen.addEventListener('mousedown', () => { if (rfb) rfb.focus(); });
        W.fit = true;

        // ---- the console
        async function connect() {
            clearTimeout(retry);
            if (rfb || closed || !wanted || loading) return;
            if (!isRunning()) { msg('The virtual machine is not running. Use Start.'); conn('Not running'); connected = false; sizeText(); return; }
            conn('Connecting'); msg('Connecting...');
            if (!root.RFB) {
                loading = (root.featureLoader ? root.featureLoader.loadFeature('rack_novnc') : Promise.reject(new Error('The console library is not available.')));
                try { await loading; } catch (e) { loading = null; msg((e && e.message) || 'The console library could not be loaded.'); conn('Unavailable'); return; }
                loading = null;
            }
            if (rfb || closed || !wanted || !isRunning()) { if (!rfb && !closed && wanted) void connect(); return; }
            const url = `${root.location.protocol === 'https:' ? 'wss' : 'ws'}://${root.location.host}/rack/${encodeURIComponent(server)}/vms/${encodeURIComponent(name)}/console`;
            let r;
            try { r = new root.RFB(screen, url, { shared: true, wsProtocols: ['binary'] }); } catch (e) { msg((e && e.message) || 'The console could not be opened.'); conn('Unavailable'); return; }
            rfb = r;
            r.scaleViewport = W.fit;
            r.resizeSession = false;
            r.clipViewport = false;
            r.background = '#000';
            r.focusOnClick = true;
            r.addEventListener('connect', () => {
                if (rfb !== r) return;
                tries = 0; connected = true; conn('Connected'); msg(''); toolbar();
                const cv = screen.querySelector('canvas');
                if (cv) { if (watchCanvas) watchCanvas.disconnect(); watchCanvas = new MutationObserver(sizeText); watchCanvas.observe(cv, { attributes: true, attributeFilter: ['width', 'height'] }); }
                sizeText(); r.focus();
            });
            r.addEventListener('credentialsrequired', () => { if (rfb !== r) return; msg('The virtual machine asks for a console password. Ask the server administrator.'); conn('Needs a password'); });
            r.addEventListener('securityfailure', () => { if (rfb === r) msg('The console security check failed.'); });
            r.addEventListener('disconnect', () => {
                if (rfb !== r) return;
                rfb = null; connected = false; if (watchCanvas) { watchCanvas.disconnect(); watchCanvas = null; }
                sizeText(); toolbar();
                if (closed || !wanted) return;
                if (!isRunning()) { conn('Not running'); msg('The virtual machine is not running. Use Start.'); return; }
                conn('Disconnected'); msg('The connection was lost. Trying again...');
                retry = setTimeout(() => { void connect(); }, Math.min(60000, 3000 * 2 ** Math.min(tries++, 4)));
            });
        }
        function kick() { if (!rfb && wanted && !closed) { tries = 0; void connect(); } }
        function drop() {
            clearTimeout(retry);
            const r = rfb; rfb = null; connected = false;
            if (watchCanvas) { watchCanvas.disconnect(); watchCanvas = null; }
            if (r) { try { r.disconnect(); } catch (_) { /* gone */ } }
        }
        W.shut = () => { wanted = false; drop(); conn('Closed'); msg('The console is closed while this window is minimised.'); sizeText(); };
        W.open = () => { wanted = true; msg(''); void connect(); };
        const away = () => m.classList.contains('minimised') || m.classList.contains('hidden') || m.classList.contains('minimising');
        const watch = new MutationObserver(() => { if (closed) return; if (away()) { if (wanted) W.shut(); } else if (!wanted) W.open(); });
        watch.observe(m, { attributes: true, attributeFilter: ['class'] });

        W.update = () => {
            if (closed) return;
            const v = vm();
            if (!v && vmsOf(server).length && !live) { msg('The virtual machine no longer exists.'); conn('Deleted'); drop(); wanted = false; }
            vmText(); toolbar();
            if (!isRunning() && !rfb) { conn('Not running'); msg('The virtual machine is not running. Use Start.'); }
            else if (!isRunning() && rfb) { /* the socket closes by itself when the guest stops */ }
        };
        W.onEvent = (ev) => {
            if (closed) return;
            if (ev.kind === 'stats') {
                const s = ev.data && ev.data.stats && ev.data.stats[name];
                statsText = s && s.cpu != null ? `CPU ${Math.round(s.cpu)}%` : '';
                vmText();
                return;
            }
            if (ev.kind === 'state' || ev.kind === 'added' || ev.kind === 'removed') {
                const nm = (ev.data && ev.data.name) || ev.id;
                if (nm && nm !== name) return;
                if (ev.kind === 'removed') { live = null; msg('The virtual machine was deleted.'); conn('Deleted'); drop(); wanted = false; return; }
                if (ev.data && typeof ev.data.state === 'string' && ev.data.state) { live = ev.data.state; W.update(); if (isRunning()) kick(); else if (rfb) { /* closes by itself */ } }
                refreshSoon(1200);
            }
        };
        W.front = () => { call('openModal', m); m.classList.remove('hidden'); if (rfb) rfb.focus(); };
        W.close = () => {
            if (closed) return;
            closed = true; WINS.delete(key);
            clearTimeout(refreshT); watch.disconnect(); drop();
            try { call('closeModal', m); } catch (_) { /* gone */ }
            setTimeout(() => { if (m.isConnected) m.remove(); }, 300);
        };

        call('openModal', m);
        m.classList.remove('hidden');
        W.update();
        void R.loadRole(c, server, 'vms').then(() => { W.update(); void connect(); });
        void connect();
        return W;
    }

    R.hooks.close.push(() => {
        Array.from(WINS.values()).forEach((w) => w.close());
        if (L.timer) { clearInterval(L.timer); L.timer = null; }
        if (L.server) { const s = L.server; L.server = null; leaseSend(s, false); }
    });
})(typeof window !== 'undefined' ? window : globalThis);
