/**
 * Rack Manager, part 5: role pages, second half. Terminal (xterm.js on WS /rack/<server>/terminal/ws and tmux sessions),
 * Storage (disks, file systems, LVM, RAM disks), Networking, Services (Vista's Services snap-in), Logs (Event Viewer for
 * the journal, Follow pushed as rack_event 'log') and Updates (Windows Update for apt). Part of window.mmcRack.
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc, ITEMS, VI } = R;
    const doc = root.document;
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const A = R.actions;
    const when = (t) => R.when(t);
    const { rolePage, dataOf, doit, run } = R;
    const list = (c, id, cols, rows, empty, extra) => c.listView(cols, rows, Object.assign({ sortId: id, empty, fit: true }, extra || {}));
    const GB = 1024 ** 3;
    const timers = new Set();
    const debounce = (fn, ms) => { let t = null; return () => { if (t) return; t = setTimeout(() => { t = null; timers.delete(t); fn(); }, ms); timers.add(t); }; };
    R.hooks.close.push(() => { timers.forEach((t) => clearTimeout(t)); timers.clear(); });

    // ---- Terminal -----------------------------------------------------------------------------------------------

    const T = { term: null, fit: null, ws: null, host: null, server: null, cmd: '', watch: null, ro: null, wanted: true, retry: null };
    const FONT = "Consolas, 'Lucida Console', 'DejaVu Sans Mono', 'Liberation Mono', monospace";

    function consoleTheme() {
        const cs = root.getComputedStyle(doc.documentElement);
        const theme = {};
        ['background', 'foreground', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'].forEach((k) => {
            const v = cs.getPropertyValue(`--console-term-${k.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`).trim();
            if (v) theme[k] = v;
        });
        theme.cursor = theme.foreground;
        return theme;
    }

    function termSocket() {
        if (!T.term) return;
        if (T.ws) { T.ws.onclose = null; T.ws.close(); T.ws = null; }
        if (!T.wanted) return;
        const q = `cols=${T.term.cols}&rows=${T.term.rows}${T.cmd ? `&cmd=${encodeURIComponent(T.cmd)}` : ''}`;
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rack/${encodeURIComponent(T.server)}/terminal/ws?${q}`);
        T.ws = ws;
        ws.onmessage = (e) => { if (typeof e.data === 'string') T.term.write(e.data); else T.term.write(new Uint8Array(e.data)); };
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => { T.term.focus(); };
        ws.onclose = () => { if (T.ws === ws) { T.ws = null; if (T.term) T.term.write('\r\n\x1b[90m[connection closed - choose New Terminal to start a shell]\x1b[0m\r\n'); } };
    }

    function termStop() {
        T.wanted = false;
        if (T.ws) { T.ws.onclose = null; T.ws.close(); T.ws = null; }
        if (T.watch) { T.watch.disconnect(); T.watch = null; }
        if (T.ro) { T.ro.disconnect(); T.ro = null; }
        if (T.term) { try { T.term.dispose(); } catch (_) { /* gone */ } }
        T.term = null; T.fit = null; T.host = null;
    }

    async function termStart(c, n, host) {
        if (T.term && T.host === host && host.isConnected && T.server === n.server) return;
        termStop();
        if (root.featureLoader) { try { await root.featureLoader.loadFeature('rack_xterm'); } catch (_) { /* reported below */ } }
        if (!host.isConnected) return;
        const Terminal = root.Terminal;
        const Fit = root.FitAddon && root.FitAddon.FitAddon;
        if (typeof Terminal !== 'function' || typeof Fit !== 'function') { host.textContent = 'The terminal component could not be loaded.'; return; }
        T.wanted = true; T.server = n.server; T.host = host;
        const term = new Terminal({ fontFamily: FONT, fontSize: 14, lineHeight: 1, cols: 100, rows: 24, scrollback: 5000, cursorStyle: 'underline', theme: consoleTheme(), allowProposedApi: false });
        const fit = new Fit();
        term.loadAddon(fit);
        term.open(host);
        T.term = term; T.fit = fit;
        const refit = () => { if (host.clientWidth && host.clientHeight) { try { fit.fit(); } catch (_) { /* hidden */ } } };
        refit();
        T.ro = new ResizeObserver(refit);
        T.ro.observe(host);
        term.onResize(({ cols, rows }) => { if (T.ws && T.ws.readyState === 1) T.ws.send(`\u0000${JSON.stringify({ t: 'resize', cols, rows })}`); });
        term.onData((d) => { if (T.ws && T.ws.readyState === 1) T.ws.send(d); });
        // minimised or hidden: the socket goes; back again: it opens
        T.watch = new MutationObserver(() => {
            const away = c.modal.classList.contains('minimised') || c.modal.classList.contains('hidden');
            if (away && T.ws) { T.wanted = false; T.ws.onclose = null; T.ws.close(); T.ws = null; } else if (!away && !T.ws && T.term) { T.wanted = true; termSocket(); }
        });
        T.watch.observe(c.modal, { attributes: true, attributeFilter: ['class'] });
        termSocket();
    }
    R.hooks.leave.push((c, from) => { if (from.kind === 'role' && from.role === 'terminal') termStop(); });
    R.hooks.close.push(termStop);

    const tmOf = (c, n) => arr(dataOf(n, 'terminal').tmux).find((t) => `t:${t.name}` === c.sel);
    R.pages['role:terminal'] = (c, n) => {
        const g = R.gate(c, n);
        if (g) { termStop(); return g; }
        const d = dataOf(n, 'terminal');
        const tm = arr(d.tmux);
        const tl = list(c, 'rm-tmux', [
            { t: 'Session', w: 160, key: 'n', text: (t) => t.name },
            { t: 'Created', w: 130, key: 'c', value: (t) => t.created, text: (t) => when(t.created) },
            { t: 'Windows', w: 60, num: true, key: 'w', text: (t) => t.windows },
            { t: 'Attached', w: 64, key: 'a', text: (t) => (t.attached ? 'Yes' : 'No') },
            { t: 'Command', w: 220, key: 'm', text: (t) => t.cmd || '' }
        ], tm.map((t) => ({ key: `t:${t.name}`, icon: '/static_images/vista-cmd/cmd-16.png', data: t })), 'There are no tmux sessions.');
        const html = `<div class="mmc-page-title"><b>Terminal</b><span>${esc(n.meta.label)}${T.cmd ? ` &middot; ${esc(T.cmd)}` : ''}</span></div>
            <div class="rm-termpage"><div class="rm-tmuxbar" data-mmc-scroll>${tl}</div><div class="rm-term-host" data-k="term"></div></div>`;
        return { html, mount: (pane) => { const host = pane.querySelector('[data-k="term"]'); if (host) void termStart(c, n, host); } };
    };
    R.commands['role:terminal'] = () => [{ text: 'New Terminal', action: 'tm-shell', icon: '/static_images/vista-cmd/cmd-16.png' }, { text: 'New tmux Session...', action: 'tm-new' }];
    R.selCommands['role:terminal'] = (n, key, c) => { const t = tmOf(c, n); return t ? { title: t.name, items: [{ text: 'Attach', action: 'tm-attach' }, { text: 'Kill Session...', action: 'tm-kill' }] } : null; };
    A['tm-shell'] = (c) => { T.cmd = ''; T.wanted = true; if (T.term) { T.term.reset(); termSocket(); } R.repaint(c); };
    A['tm-attach'] = (c, p, n) => { const t = tmOf(c, n); if (!t) return; T.cmd = `tmux attach -t ${t.name}`; T.wanted = true; if (T.term) { T.term.reset(); termSocket(); } R.repaint(c); };
    A['tm-kill'] = async (c, p, n) => { const t = tmOf(c, n); if (!t) return; const a = await R.taskDialog(c, { instruction: `Kill the tmux session ${t.name}?`, text: 'Everything running in it is ended.', links: [{ id: 'go', text: 'Kill Session', danger: true }] }); if (a === 'go') await run(c, n, 'terminal', 'tmux-kill', { name: t.name }); };
    A['tm-new'] = (c, p, n) => R.dialog(c, { id: 'tmnew', title: 'New tmux Session', w: 420, h: 220, html: `${R.field('Name:', R.inp('name', ''))}${R.field('Command (optional):', R.inp('cmd', ''), true)}${R.field('Folder (optional):', R.inp('cwd', ''), true)}`, okText: 'Create', ok: async (ctx) => { const name = (R.val(ctx, 'name') || '').trim(); if (!/^[A-Za-z0-9._-]+$/.test(name)) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores for the name.'); return false; } const cmd = (R.val(ctx, 'cmd') || '').trim(); const cwd = (R.val(ctx, 'cwd') || '').trim(); await doit(c, n, 'terminal', 'tmux-new', Object.assign({ name }, cmd ? { cmd } : {}, cwd ? { cwd } : {})); return true; } });

    // ---- Storage --------------------------------------------------------------------------------------------------

    const DEVMGR = '/static_images/vista-devmgr';
    const EXPL = '/static_images/vista-explorer';
    // Vista's own art: Device Manager's Disk drives / DVD/CD-ROM drives for disks, Explorer's drive icons for volumes
    const diskIcon = (d) => (d.type === 'rom' ? `${DEVMGR}/dvd-cdrom-16.png` : d.type === 'disk' ? `${DEVMGR}/disk-drives-16.png` : d.mountpoint === '/' ? `${EXPL}/drive-system-16.png` : `${DEVMGR}/volumes-16.png`);
    const fsIcon = (x) => (x.mount === '/' ? `${EXPL}/drive-system-16.png` : /^(nfs|cifs|smb|fuse\.sshfs)/.test(x.fstype || '') ? `${EXPL}/drive-network-16.png` : x.fstype === 'tmpfs' ? `${DEVMGR}/res-memory-16.png` : `${EXPL}/drive-fixed-16.png`);
    const flatDisks = (nodes, depth, out) => { arr(nodes).forEach((d) => { out.push({ d, depth }); flatDisks(d.children, depth + 1, out); }); return out; };
    const rdOf = (c, n) => arr(dataOf(n, 'storage').ramdisks).find((r) => `rd:${r.name}` === c.sel);
    const lvOf = (c, n) => arr(dataOf(n, 'storage').lvs).find((l) => `lv:${l.vg}/${l.name}` === c.sel);
    const vgOf = (c, n) => arr(dataOf(n, 'storage').vgs).find((v) => `vg:${v.name}` === c.sel);
    const pct = (u, t) => (t ? (u / t) * 100 : 0);
    const barCell = (u, t) => `${R.bar(pct(u, t), pct(u, t) > 90 ? 'is-error' : '')}`;

    rolePage('storage', (c, n, d) => {
        const disks = flatDisks(d.disks, 0, []);
        const dl = list(c, 'rm-disks', [
            { t: 'Name', w: 190, key: 'n', text: (x) => x.d.name, html: (x) => `<i style="padding-left:${x.depth * 14}px">${esc(x.d.name)}</i>` },
            { t: 'Size', w: 76, num: true, key: 's', value: (x) => Number(x.d.size) || 0, text: (x) => (Number.isFinite(Number(x.d.size)) && x.d.size !== null && x.d.size !== '' ? R.bytes(Number(x.d.size)) : String(x.d.size || '')) },
            { t: 'Type', w: 60, key: 't', text: (x) => x.d.type },
            { t: 'Model', w: 150, key: 'm', text: (x) => x.d.model || '' },
            { t: 'File System', w: 80, key: 'f', text: (x) => x.d.fstype || '' },
            { t: 'Mount Point', w: 160, key: 'p', text: (x) => x.d.mountpoint || '' }
        ], disks.map((x, i) => ({ key: `d:${i}`, icon: diskIcon(x.d), data: x })), 'No disks are reported.', { presorted: true, sortId: undefined });
        const fl = list(c, 'rm-fs', [
            { t: 'Mounted On', w: 190, key: 'm', text: (x) => x.mount },
            { t: 'Type', w: 60, key: 't', text: (x) => x.fstype },
            { t: 'Size', w: 76, num: true, key: 's', value: (x) => x.sizeB, text: (x) => R.bytes(x.sizeB) },
            { t: 'Used', w: 76, num: true, key: 'u', value: (x) => x.usedB, text: (x) => R.bytes(x.usedB) },
            { t: 'Free', w: 76, num: true, key: 'a', value: (x) => x.availB, text: (x) => R.bytes(x.availB) },
            { t: 'Usage', w: 170, key: 'p', value: (x) => pct(x.usedB, x.sizeB), text: (x) => `${Math.round(pct(x.usedB, x.sizeB))}%`, html: (x) => barCell(x.usedB, x.sizeB) }
        ], arr(d.filesystems).map((x) => ({ key: `fs:${x.mount}`, icon: fsIcon(x), data: x })), 'No file systems are reported.');
        const vl = list(c, 'rm-vgs', [
            { t: 'Volume Group', w: 150, key: 'n', text: (x) => x.name },
            { t: 'Size', w: 76, num: true, key: 's', value: (x) => x.sizeB, text: (x) => R.bytes(x.sizeB) },
            { t: 'Free', w: 76, num: true, key: 'f', value: (x) => x.freeB, text: (x) => R.bytes(x.freeB) },
            { t: 'Used', w: 170, key: 'u', text: (x) => `${Math.round(pct(x.sizeB - x.freeB, x.sizeB))}%`, html: (x) => barCell(x.sizeB - x.freeB, x.sizeB) },
            { t: 'Physical Volumes', w: 200, key: 'p', text: (x) => (typeof x.pvs === 'number' ? `${x.pvs} disk${x.pvs === 1 ? '' : 's'}` : arr(x.pvs).join(', ')) }
        ], arr(d.vgs).map((x) => ({ key: `vg:${x.name}`, icon: `${DEVMGR}/storage-controllers-16.png`, data: x })), 'No volume groups.');
        const ll = list(c, 'rm-lvs', [
            { t: 'Logical Volume', w: 150, key: 'n', text: (x) => `${x.vg}/${x.name}` },
            { t: 'Size', w: 76, num: true, key: 's', value: (x) => x.sizeB, text: (x) => R.bytes(x.sizeB) },
            { t: 'File System', w: 80, key: 'f', text: (x) => x.fstype || '' },
            { t: 'Mount Point', w: 160, key: 'm', text: (x) => x.mount || '' },
            { t: 'Used By', w: 200, key: 'u', text: (x) => (Array.isArray(x.usedBy) ? x.usedBy.join(', ') : x.usedBy || '') }
        ], arr(d.lvs).map((x) => ({ key: `lv:${x.vg}/${x.name}`, icon: x.mount === '/' ? `${EXPL}/drive-system-16.png` : `${DEVMGR}/volumes-16.png`, data: x })), 'No logical volumes.');
        const mem = d.memory || {};
        const budget = Math.max(0, (mem.totalB || 0) - 32 * GB);
        const rl = list(c, 'rm-ramd', [
            { t: 'Name', w: 120, key: 'n', text: (x) => x.name },
            { t: 'Kind', w: 56, key: 'k', text: (x) => x.kind },
            { t: 'Size', w: 70, num: true, key: 's', value: (x) => x.sizeB, text: (x) => R.bytes(x.sizeB) },
            { t: 'Used', w: 150, key: 'u', text: (x) => `${R.bytes(x.usedB)} of ${R.bytes(x.sizeB)}`, html: (x) => barCell(x.usedB, x.sizeB) },
            { t: 'Mounted On', w: 150, key: 'm', text: (x) => x.mount },
            { t: 'Backing Folder', w: 150, key: 'b', text: (x) => x.backing || '' },
            { t: 'Sync', w: 56, key: 'y', text: (x) => (x.syncMin ? `${x.syncMin} min` : '') },
            { t: 'Persist', w: 50, key: 'p', text: (x) => (x.persist ? 'Yes' : 'No') }
        ], arr(d.ramdisks).map((x) => ({ key: `rd:${x.name}`, icon: `${DEVMGR}/res-memory-16.png`, data: x })), 'There are no RAM disks. Use Create RAM Disk to make one.');
        return c.page('Storage', `${arr(d.ramdisks).length} RAM disks`, [
            { id: 'st-disks', title: 'Disks', body: dl },
            { id: 'st-fs', title: 'File Systems', body: fl },
            { id: 'st-vgs', title: 'Volume Groups', body: vl },
            { id: 'st-lvs', title: 'Logical Volumes', body: ll },
            { id: 'st-ram', title: 'RAM Disks', body: `<p>RAM disks may use all memory except 32 GB (${R.bytes(budget)} of ${R.bytes(mem.totalB)}). In use now: ${R.bytes(mem.ramdiskB || 0)}.</p>${R.bar(pct(mem.ramdiskB || 0, budget), pct(mem.ramdiskB || 0, budget) > 90 ? 'is-error' : '')}${rl}` }
        ]);
    });
    R.commands['role:storage'] = () => [{ text: 'Create Volume...', action: 'st-lvnew', icon: `${DEVMGR}/volumes-16.png` }, { text: 'Create RAM Disk...', action: 'st-rdnew' }];
    R.selCommands['role:storage'] = (n, key, c) => {
        const k = String(key);
        if (k.startsWith('rd:')) { const r = rdOf(c, n); return r ? { title: r.name, items: [{ text: 'Resize...', action: 'st-rdsize' }, { text: 'Sync Now', action: 'st-rdsync', disabled: !r.backing }, { text: 'Delete...', action: 'st-rddel' }] } : null; }
        if (k.startsWith('lv:')) { const l = lvOf(c, n); return l ? { title: `${l.vg}/${l.name}`, items: [{ text: 'Extend...', action: 'st-lvext' }, { text: 'Delete...', action: 'st-lvdel', disabled: !!l.mount || !!(l.usedBy && l.usedBy.length) }] } : null; }
        return null;
    };
    const trackPair = (name, min, max, value) => `<span class="rm-trackbar">${R.trackbar(name, min, max, value, 1, 'GB').replace('class', 'class')}</span><input type="text" class="rm-spin" data-rm="${name}-n" value="${value}" autocomplete="off"> GB`;
    /** a trackbar and a spin box that stay equal */
    const pairWire = (ctx, name, min, max) => {
        const r = ctx.content.querySelector(`input[type=range][data-rm="${name}"]`);
        const t = ctx.content.querySelector(`[data-rm="${name}-n"]`);
        const out = ctx.content.querySelector(`[data-rm-out="${name}"]`);
        if (out) out.remove();
        r.addEventListener('input', () => { t.value = r.value; });
        t.addEventListener('input', () => { const v = Math.max(min, Math.min(max, Number(t.value) || min)); r.value = String(v); });
    };
    const sizeOf = (ctx, name) => Number(R.val(ctx, `${name}-n`)) || Number(R.val(ctx, name));

    A['st-rdnew'] = (c, p, n) => {
        const d = dataOf(n, 'storage');
        const mem = d.memory || {};
        const budget = Math.max(0, (mem.totalB || 0) - 32 * GB - (mem.ramdiskB || 0));
        const max = Math.max(1, Math.floor(budget / GB));
        R.dialog(c, {
            id: 'rdnew', title: 'Create RAM Disk', w: 460, h: 400,
            html: `${R.field('Name:', R.inp('name', ''))}<div class="rm-field is-wide"><span>Size (up to ${max} GB of free RAM budget)</span><div class="rm-row">${trackPair('size', 1, max, Math.min(8, max))}</div></div>
                <div class="rm-field is-wide"><span>Kind</span><div class="rm-radios"><label class="rm-check"><input type="radio" name="rm-kind" value="tmpfs" data-rm="kind:tmpfs" checked> tmpfs (fast, pages may swap)</label><label class="rm-check"><input type="radio" name="rm-kind" value="zram" data-rm="kind:zram"> zram (compressed)</label></div></div>
                ${R.field('Backing folder (restored at start, synced back):', R.inp('backing', ''), true)}${R.field('Sync every (minutes):', R.inp('sync', 10))}${R.chk('persist', 'Recreate it when rackd starts', true)}`,
            okText: 'Create',
            init: (ctx) => pairWire(ctx, 'size', 1, max),
            ok: async (ctx) => {
                const name = (R.val(ctx, 'name') || '').trim();
                if (!/^[A-Za-z0-9._-]+$/.test(name)) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores for the name.'); return false; }
                const sizeGB = sizeOf(ctx, 'size');
                if (!(sizeGB >= 1) || sizeGB > max) { R.err(ctx, `The size must be between 1 and ${max} GB.`); return false; }
                const backing = (R.val(ctx, 'backing') || '').trim();
                await doit(c, n, 'storage', 'ramdisk-create', Object.assign({ name, sizeGB, kind: R.picked(ctx, 'kind') || 'tmpfs', persist: !!R.val(ctx, 'persist') }, backing ? { backing, syncMin: Number(R.val(ctx, 'sync')) || 10 } : {}));
                return true;
            }
        });
    };
    A['st-rdsize'] = (c, p, n) => {
        const r = rdOf(c, n);
        if (!r) return;
        const mem = dataOf(n, 'storage').memory || {};
        const max = Math.max(1, Math.floor(((mem.totalB || 0) - 32 * GB - (mem.ramdiskB || 0) + r.sizeB) / GB));
        const cur = Math.max(1, Math.round(r.sizeB / GB));
        R.dialog(c, { id: 'rdsize', title: `Resize ${r.name}`, w: 420, h: 200, html: `<div class="rm-field is-wide"><span>New size (1 to ${max} GB)</span><div class="rm-row">${trackPair('size', 1, max, Math.min(cur, max))}</div></div>`, okText: 'Resize', init: (ctx) => pairWire(ctx, 'size', 1, max), ok: async (ctx) => { const sizeGB = sizeOf(ctx, 'size'); if (!(sizeGB >= 1) || sizeGB > max) { R.err(ctx, `The size must be between 1 and ${max} GB.`); return false; } await doit(c, n, 'storage', 'ramdisk-resize', { name: r.name, sizeGB }); return true; } });
    };
    A['st-rdsync'] = async (c, p, n) => { const r = rdOf(c, n); if (r) await run(c, n, 'storage', 'ramdisk-sync', { name: r.name }); };
    A['st-rddel'] = async (c, p, n) => {
        const r = rdOf(c, n);
        if (!r) return;
        const links = (r.backing ? [{ id: 'sync', text: 'Sync to the backing folder, then delete', sub: r.backing, danger: true }] : []).concat([{ id: 'nosync', text: r.backing ? 'Delete without syncing' : 'Delete the RAM disk', sub: 'What is in it is lost.', danger: true }]);
        const a = await R.taskDialog(c, { instruction: `Delete the RAM disk ${r.name}?`, text: `${R.bytes(r.usedB)} in use.`, links });
        if (a) await run(c, n, 'storage', 'ramdisk-delete', { name: r.name, sync: a === 'sync' });
    };
    A['st-lvnew'] = (c, p, n) => {
        const d = dataOf(n, 'storage');
        const vgs = arr(d.vgs);
        if (!vgs.length) { void R.box(c, 'There is no volume group to make a volume in.'); return; }
        R.wizard(c, {
            id: 'lvnew', title: 'Create Volume Wizard', icon: `${DEVMGR}/volumes-32.png`, w: 480, h: 300,
            pages: [
                { key: 'where', instruction: 'Choose the volume group and a name', html: `${R.field('Volume group:', R.sel('vg', vgs.map((v) => ({ value: v.name, text: `${v.name} (${R.bytes(v.freeB)} free)` })), vgs[0].name))}${R.field('Name:', R.inp('name', ''))}${R.field('Size (GB):', R.inp('size', 50))}`, next: (ctx) => { const v = vgs.find((x) => x.name === R.val(ctx, 'vg')); const size = Number(R.val(ctx, 'size')); if (!/^[A-Za-z0-9._-]+$/.test((R.val(ctx, 'name') || '').trim())) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores for the name.'); return false; } if (!(size >= 1) || (v && size * GB > v.freeB)) { R.err(ctx, `The size must be 1 GB or more and fit in the ${v ? R.bytes(v.freeB) : ''} that is free.`); return false; } R.err(ctx, ''); return 'fs'; } },
                { key: 'fs', instruction: 'Format and mount', nextText: 'Create', finish: true, html: `${R.field('File system:', R.sel('fs', [{ value: 'ext4', text: 'ext4' }, { value: 'xfs', text: 'xfs' }, { value: '', text: 'None (unformatted)' }], 'ext4'))}${R.field('Mount on (optional):', R.inp('mount', ''), true)}<p class="rm-hint">A mounted volume gets a line in /etc/fstab.</p>` }
            ],
            finish: async (ctx) => {
                const fs = R.val(ctx, 'fs');
                const mount = (R.val(ctx, 'mount') || '').trim();
                try { await doit(c, n, 'storage', 'lv-create', Object.assign({ vg: R.val(ctx, 'vg'), name: R.val(ctx, 'name').trim(), sizeGB: Number(R.val(ctx, 'size')), fs: fs || null }, mount ? { mount } : {})); return true; } catch (e) { R.err(ctx, (e && e.message) || 'The volume could not be created.'); return false; }
            }
        });
    };
    A['st-lvext'] = (c, p, n) => {
        const l = lvOf(c, n);
        if (!l) return;
        const vg = arr(dataOf(n, 'storage').vgs).find((v) => v.name === l.vg) || {};
        const cur = Math.ceil(l.sizeB / GB);
        const max = Math.floor((l.sizeB + (vg.freeB || 0)) / GB);
        R.dialog(c, { id: 'lvext', title: `Extend ${l.vg}/${l.name}`, w: 400, h: 200, html: `<p>Now ${R.bytes(l.sizeB)}; the volume group has ${R.bytes(vg.freeB || 0)} free. Volumes can only grow.</p>${R.field('New size (GB):', R.inp('size', cur))}`, okText: 'Extend', ok: async (ctx) => { const sizeGB = Number(R.val(ctx, 'size')); if (!(sizeGB > cur) || sizeGB > max) { R.err(ctx, `Type a size between ${cur + 1} and ${max} GB.`); return false; } await doit(c, n, 'storage', 'lv-resize', { vg: l.vg, name: l.name, sizeGB }); return true; } });
    };
    A['st-lvdel'] = async (c, p, n) => { const l = lvOf(c, n); if (!l) return; const a = await R.taskDialog(c, { instruction: `Delete the volume ${l.vg}/${l.name}?`, text: 'Everything on it is destroyed. This cannot be undone.', links: [{ id: 'go', text: 'Delete the volume', danger: true }] }); if (a === 'go') await run(c, n, 'storage', 'lv-delete', { vg: l.vg, name: l.name, confirm: true }); };

    // ---- Networking -----------------------------------------------------------------------------------------------

    const gen = (x, ...keys) => { for (const k of keys) if (x && x[k] != null && x[k] !== '') return Array.isArray(x[k]) ? x[k].join(', ') : String(x[k]); return typeof x === 'string' ? x : ''; };
    const lnOf = (c, n) => arr(dataOf(n, 'networking').libvirt).find((x) => `ln:${x.name}` === c.sel);
    const brOf = (c, n) => arr(dataOf(n, 'networking').bridges).find((x) => `br:${typeof x === 'string' ? x : x.name}` === c.sel);
    rolePage('networking', (c, n, d) => {
        const il = list(c, 'rm-if', [
            { t: 'Name', w: 100, key: 'n', text: (x) => x.name },
            { t: 'State', w: 60, key: 's', text: (x) => (x.state || '').toUpperCase() },
            { t: 'Addresses', w: 220, key: 'a', text: (x) => arr(x.addrs).join(', ') },
            { t: 'MAC', w: 120, key: 'm', text: (x) => x.mac || '' },
            { t: 'MTU', w: 44, num: true, key: 'u', text: (x) => x.mtu },
            { t: 'Speed', w: 70, key: 'p', text: (x) => (x.speed ? `${x.speed} Mb/s` : '') },
            { t: 'Received', w: 76, num: true, key: 'r', value: (x) => x.rxB, text: (x) => R.bytes(x.rxB) },
            { t: 'Sent', w: 76, num: true, key: 't', value: (x) => x.txB, text: (x) => R.bytes(x.txB) }
        ], arr(d.interfaces).map((x) => ({ key: `if:${x.name}`, icon: `${ITEMS}/network-and-sharing-center-16.png`, data: x })), 'No interfaces.');
        const rl = list(c, 'rm-routes', [
            { t: 'Destination', w: 160, key: 'd', text: (x) => gen(x, 'dst', 'destination', 'to') },
            { t: 'Gateway', w: 130, key: 'g', text: (x) => gen(x, 'gateway', 'via') },
            { t: 'Interface', w: 90, key: 'i', text: (x) => gen(x, 'dev', 'interface') },
            { t: 'Metric', w: 56, num: true, key: 'm', text: (x) => gen(x, 'metric') },
            { t: 'Source', w: 120, key: 's', text: (x) => gen(x, 'prefsrc', 'src') }
        ], arr(d.routes).map((x, i) => ({ key: `rt:${i}`, data: x })), 'No routes.');
        const bl = list(c, 'rm-br', [
            { t: 'Bridge', w: 120, key: 'n', text: (x) => gen(x, 'name') },
            { t: 'Ports', w: 260, key: 'p', text: (x) => gen(x, 'ports', 'interfaces') },
            { t: 'State', w: 70, key: 's', text: (x) => gen(x, 'state') }
        ], arr(d.bridges).map((x) => ({ key: `br:${typeof x === 'string' ? x : x.name}`, icon: `${ITEMS}/network-and-sharing-center-16.png`, data: typeof x === 'string' ? { name: x } : x })), 'No bridges.');
        const pl = list(c, 'rm-listen', [
            { t: 'Protocol', w: 60, key: 'p', text: (x) => x.proto },
            { t: 'Address', w: 160, key: 'a', text: (x) => x.addr },
            { t: 'Port', w: 60, num: true, key: 'o', value: (x) => Number(x.port), text: (x) => x.port },
            { t: 'Process', w: 220, key: 'r', text: (x) => x.process || '' }
        ], arr(d.listening).map((x, i) => ({ key: `lp:${i}`, data: x })), 'Nothing is listening.');
        const ll = list(c, 'rm-vnets', [
            { t: 'Network', w: 130, key: 'n', text: (x) => x.name },
            { t: 'Active', w: 56, key: 'a', text: (x) => (x.active ? 'Yes' : 'No') },
            { t: 'Bridge', w: 90, key: 'b', text: (x) => x.bridge || '' },
            { t: 'Subnet', w: 140, key: 's', text: (x) => x.subnet || '' }
        ], arr(d.libvirt).map((x) => ({ key: `ln:${x.name}`, icon: `${ITEMS}/network-and-sharing-center-16.png`, data: x })), 'No virtual networks.');
        return c.page('Networking', `${arr(d.interfaces).length} interfaces`, [
            { id: 'nw-if', title: 'Network Connections', body: il },
            { id: 'nw-rt', title: 'Routes', body: rl },
            { id: 'nw-br', title: 'Bridges', body: bl },
            { id: 'nw-ln', title: 'Virtual Networks (libvirt)', body: ll },
            { id: 'nw-lp', title: 'Listening Ports', body: pl }
        ]);
    });
    R.commands['role:networking'] = () => [{ text: 'Ping...', action: 'nw-ping', icon: `${ITEMS}/network-and-sharing-center-16.png` }, { text: 'New Bridge...', action: 'nw-brnew' }];
    R.selCommands['role:networking'] = (n, key, c) => {
        const k = String(key);
        if (k.startsWith('ln:')) { const l = lnOf(c, n); return l ? { title: l.name, items: [l.active ? { text: 'Stop', action: 'nw-ln:stop' } : { text: 'Start', action: 'nw-ln:start' }, { text: 'Autostart', action: 'nw-ln:autostart' }] } : null; }
        if (k.startsWith('br:')) { const b = brOf(c, n); return b ? { title: typeof b === 'string' ? b : b.name, items: [{ text: 'Delete Bridge...', action: 'nw-brdel' }] } : null; }
        return null;
    };
    A['nw-ln'] = async (c, op, n) => { const l = lnOf(c, n); if (l) await run(c, n, 'networking', 'libvirt-net', { name: l.name, op }); };
    A['nw-brdel'] = async (c, p, n) => { const b = brOf(c, n); if (!b) return; const name = typeof b === 'string' ? b : b.name; const a = await R.taskDialog(c, { instruction: `Delete the bridge ${name}?`, text: 'Machines and networks using it lose their connection.', links: [{ id: 'go', text: 'Delete Bridge', danger: true }] }); if (a === 'go') await run(c, n, 'networking', 'bridge-delete', { name }); };
    A['nw-brnew'] = (c, p, n) => R.dialog(c, { id: 'brnew', title: 'New Bridge', w: 400, h: 200, html: `${R.field('Name:', R.inp('name', 'br1'))}${R.field('Ports (comma separated, optional):', R.inp('ports', ''), true)}`, okText: 'Create', ok: async (ctx) => { const name = (R.val(ctx, 'name') || '').trim(); if (!name) { R.err(ctx, 'Type a name.'); return false; } await doit(c, n, 'networking', 'bridge-create', { name, ports: (R.val(ctx, 'ports') || '').split(',').map((s) => s.trim()).filter(Boolean) }); return true; } });
    A['nw-ping'] = (c, p, n) => R.dialog(c, {
        id: 'ping', title: `Ping from ${n.meta.label}`, w: 520, h: 360, okText: 'Close', noCancel: true,
        html: '<div class="rm-row"><label>Host:&nbsp;<input type="text" data-rm="host" class="rm-grow" autocomplete="off" spellcheck="false"></label><button type="button" class="btn-standard" data-run>Ping</button></div><pre class="rm-pre rm-console" data-rm-out data-mmc-scroll></pre>',
        init: (ctx) => {
            const q = (s) => ctx.content.querySelector(s);
            const go = async () => { const host = (R.val(ctx, 'host') || '').trim(); if (!host) return; const out = q('[data-rm-out]'); out.textContent = `Pinging ${host}...\n`; try { const r = await R.act(n.server, 'networking', 'ping', { host, count: 4 }); const x = r.result || r; out.textContent = x.out || x.text || JSON.stringify(x, null, 1); } catch (e) { out.textContent = (e && e.message) || String(e); } };
            q('[data-run]').addEventListener('click', go);
            q('[data-rm="host"]').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); void go(); } });
        }
    });

    // ---- Services -------------------------------------------------------------------------------------------------

    const SV = { filter: '', view: 'running' };
    const svOf = (c, n) => { const u = String(c.sel || '').slice(2); return arr(dataOf(n, 'services').services).find((s) => s.unit === u) || arr(dataOf(n, 'services').rack).map((r) => ({ unit: r.unit })).find((s) => s.unit === u); };
    const startup = (s) => ({ enabled: 'Automatic', disabled: 'Disabled', static: 'Manual', masked: 'Disabled (masked)', indirect: 'Manual', 'enabled-runtime': 'Automatic' }[s.enabled] || s.enabled || '');
    const svStatus = (s) => (s.active === 'active' ? 'Started' : s.active === 'failed' ? 'Failed' : s.active === 'activating' ? 'Starting' : '');
    rolePage('services', (c, n, d) => {
        const rackUnits = new Set(arr(d.rack).map((r) => r.unit));
        const q = SV.filter.toLowerCase();
        const rows = arr(d.services).filter((s) => (SV.view === 'all' || (SV.view === 'running' ? s.active === 'active' || s.active === 'failed' : rackUnits.has(s.unit))) && (!q || `${s.unit} ${s.description}`.toLowerCase().includes(q)));
        const l = list(c, 'rm-svc', [
            { t: 'Name', w: 230, key: 'n', text: (s) => s.unit },
            { t: 'Description', w: 300, key: 'd', text: (s) => s.description || '' },
            { t: 'Status', w: 70, key: 's', text: svStatus },
            { t: 'Startup Type', w: 110, key: 't', text: startup }
        ], rows.map((s) => ({ key: `u:${s.unit}`, icon: `${ITEMS}/administrative-tools-16.png`, data: s })), 'There are no services to show.');
        const views = [['running', 'Started'], ['all', 'All'], ['rack', 'Rack services']].map(([id, t]) => (SV.view === id ? `<b>${t}</b>` : R.link('sv-view', t, id))).join(' | ');
        return c.page('Services', `${rows.length} of ${arr(d.services).length}`, [
            { id: 'sv-list', title: 'Services', body: `<div class="rm-filterbar"><span class="rm-switch">${views}</span><label>Filter: <input type="text" class="rm-filter" data-rm-input="sv-filter" value="${esc(SV.filter)}" autocomplete="off" spellcheck="false"></label></div>${R.jobStrip(n)}${l}` }
        ]);
    });
    R.inputs['sv-filter'] = (v, el, c) => { SV.filter = v; R.repaint(c); };
    A['sv-view'] = (c, v) => { SV.view = v; R.repaint(c); };
    R.commands['role:services'] = () => [{ text: 'Define Rack Service...', action: 'sv-def', icon: `${ITEMS}/administrative-tools-16.png` }];
    R.selCommands['role:services'] = (n, key, c) => {
        const s = svOf(c, n);
        if (!s) return null;
        const rack = arr(dataOf(n, 'services').rack).find((r) => r.unit === s.unit);
        const on = s.active === 'active';
        return { title: s.unit, items: [on ? { text: 'Stop', action: 'sv-op:stop' } : { text: 'Start', action: 'sv-op:start' }, { text: 'Restart', action: 'sv-op:restart' }, { text: 'Reload (Pause is not supported by systemd)', action: 'sv-op:reload', disabled: !on }, { separator: true }, { text: 'Startup: Automatic', action: 'sv-op:enable' }, { text: 'Startup: Disabled', action: 'sv-op:disable' }, { text: 'Properties...', action: 'sv-props' }, ...(rack ? [{ text: 'Remove Rack Service...', action: 'sv-undef' }] : [])] };
    };
    A['sv-op'] = async (c, op, n) => { const s = svOf(c, n); if (s) await run(c, n, 'services', op, { unit: s.unit }); };
    A['sv-undef'] = async (c, p, n) => { const s = svOf(c, n); const r = s && arr(dataOf(n, 'services').rack).find((x) => x.unit === s.unit); if (!r) return; const a = await R.taskDialog(c, { instruction: `Remove the rack service ${r.name}?`, text: 'Its unit file is deleted and the service stops.', links: [{ id: 'go', text: 'Remove', danger: true }] }); if (a === 'go') await run(c, n, 'services', 'undefine', { name: r.name }); };
    A['sv-props'] = async (c, p, n) => {
        const s = svOf(c, n);
        if (!s) return;
        let x = { props: {}, log: [] };
        try { const r = await R.act(n.server, 'services', 'status', { unit: s.unit }); x = r.result || r; } catch (e) { x = { props: {}, log: [`The status could not be read: ${(e && e.message) || e}`] }; }
        const props = Object.entries(x.props || {});
        R.dialog(c, { id: 'svprops', title: `${s.unit} Properties`, w: 560, h: 460, okText: 'Close', noCancel: true, html: `<table class="rm-table"><tbody>${props.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table><p><b>Recent log</b></p><pre class="rm-pre" data-mmc-scroll>${esc(arr(x.log).join('\n'))}</pre>` });
    };
    A['sv-def'] = (c, p, n) => R.dialog(c, {
        id: 'svdef', title: 'Define Rack Service', w: 460, h: 340,
        html: `<p>Makes a systemd service named rack-&lt;name&gt; that keeps a command running.</p>${R.field('Name:', R.inp('name', ''))}${R.field('Command:', R.inp('cmd', ''), true)}${R.field('Folder:', R.inp('cwd', ''), true)}${R.field('Run as:', R.sel('user', ['rack', 'root'], 'rack'))}${R.field('Restart:', R.sel('restart', ['on-failure', 'always', 'no'], 'on-failure'))}`,
        okText: 'Define',
        ok: async (ctx) => { const name = (R.val(ctx, 'name') || '').trim(); const cmd = (R.val(ctx, 'cmd') || '').trim(); if (!/^[A-Za-z0-9._-]+$/.test(name) || !cmd) { R.err(ctx, 'Type a name (letters, digits, dots, dashes) and a command.'); return false; } const cwd = (R.val(ctx, 'cwd') || '').trim(); await doit(c, n, 'services', 'define', Object.assign({ name, cmd, user: R.val(ctx, 'user'), restart: R.val(ctx, 'restart') }, cwd ? { cwd } : {})); return true; }
    });

    // ---- Logs ----------------------------------------------------------------------------------------------------------

    const LG = { unit: '', priority: '', range: '1h', grep: '', lines: '200', follow: null, live: [], followId: null, dmesg: null };
    const PRIO = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Information', 'Debug'];
    const RANGE_SEC = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, boot: 0 };
    R.roleQuery = R.roleQuery || {};
    R.roleQuery.logs = () => {
        const q = { lines: Number(LG.lines) || 200 };
        if (LG.unit) q.unit = LG.unit;
        if (LG.priority !== '') q.priority = LG.priority;
        if (LG.grep) q.grep = LG.grep;
        if (LG.range === 'boot') q.boot = '0'; else q.since = new Date(Date.now() - RANGE_SEC[LG.range] * 1000).toISOString();
        return q;
    };
    const paintLogs = debounce(() => { const c = R.S.console; if (R.live(c)) { const n = R.here(c); if (n.kind === 'role' && n.role === 'logs') R.repaint(c); } }, 250);
    R.hooks.event.push((c, ev) => {
        if (ev.role !== 'logs' || ev.kind !== 'log') return false;
        const e = typeof ev.data === 'string' ? { message: ev.data } : (ev.data || {});
        LG.live.push(e);
        if (LG.live.length > 2000) LG.live.splice(0, LG.live.length - 2000);
        paintLogs();
        return true;
    });
    async function stopFollow(c, n) {
        if (!LG.followId) { LG.follow = null; return; }
        const id = LG.followId;
        LG.followId = null; LG.follow = null;
        try { await R.act((n || R.here(c)).server, 'logs', 'unfollow', { followId: id }); } catch (_) { /* gone */ }
    }
    R.hooks.leave.push((c, from) => { if (from.kind === 'role' && from.role === 'logs' && LG.followId) void stopFollow(c, from); });
    R.hooks.close.push((c) => { if (LG.followId) void stopFollow(c, { server: (R.S.subscribed || '') }); });

    const logCols = (c) => [
        { t: 'Time', w: 150, key: 't', value: (e) => Date.parse(e.t) || 0, text: (e) => (e.t ? new Date(e.t).toLocaleString() : '') },
        { t: 'Level', w: 80, key: 'p', value: (e) => Number(e.priority), text: (e) => PRIO[Number(e.priority)] || '', html: (e) => `<i class="rm-sev ${Number(e.priority) <= 3 ? 'is-bad' : Number(e.priority) === 4 ? 'is-warn' : ''}">${esc(PRIO[Number(e.priority)] || '')}</i>` },
        { t: 'Unit', w: 150, key: 'u', text: (e) => e.unit || '' },
        { t: 'Message', w: 520, key: 'm', text: (e) => e.message || '' }
    ];
    rolePage('logs', (c, n, d) => {
        const entries = arr(d.entries);
        const rows = (LG.follow ? LG.live.slice(-500) : entries.slice().reverse()).map((e, i) => ({ key: `l:${i}`, data: e }));
        const l = list(c, 'rm-journal', logCols(c), rows, 'There are no entries for these filters.', LG.follow ? { presorted: true } : {});
        const bar = `<div class="rm-logfilter"><label>Unit: <input type="text" data-rm="lg-unit" value="${esc(LG.unit)}" autocomplete="off" spellcheck="false"></label>
            <label>Level: ${R.sel('lg-priority', [{ value: '', text: 'All' }].concat(PRIO.slice(0, 7).map((t, i) => ({ value: String(i), text: `${t} and worse` }))), LG.priority).replace('data-rm="lg-priority"', 'data-rm="lg-priority" data-rm-input="lg-apply"')}</label>
            <label>Time: ${R.sel('lg-range', [{ value: '1h', text: 'Last hour' }, { value: '6h', text: 'Last 6 hours' }, { value: '24h', text: 'Last 24 hours' }, { value: '7d', text: 'Last 7 days' }, { value: 'boot', text: 'This boot' }], LG.range).replace('data-rm="lg-range"', 'data-rm="lg-range" data-rm-input="lg-apply"')}</label>
            <label>Text: <input type="text" data-rm="lg-grep" value="${esc(LG.grep)}" autocomplete="off" spellcheck="false"></label>
            <label>Lines: ${R.sel('lg-lines', ['200', '500', '1000'], LG.lines).replace('data-rm="lg-lines"', 'data-rm="lg-lines" data-rm-input="lg-apply"')}</label></div>
            <div class="mmc-buttons">${R.btnHtml('lg-apply', 'Apply Filter')}${R.btnHtml('lg-follow', LG.follow ? 'Stop Following' : 'Follow')}${R.btnHtml('lg-dmesg', 'Kernel Messages (dmesg)...')}</div>`;
        return c.page('Logs', LG.follow ? `Following: ${LG.live.length} new lines` : `${entries.length} entries`, [{ id: 'lg-list', title: LG.follow ? 'System Journal (live)' : 'System Journal', body: bar + l }]);
    });
    R.inputs['lg-apply'] = (v, el, c) => { void A['lg-apply'](c, '', R.here(c)); };
    A['lg-apply'] = async (c, p, n) => {
        const pane = c.el('.mmc-result');
        const get = (k) => { const e = pane.querySelector(`[data-rm="${k}"]`); return e ? e.value : ''; };
        Object.assign(LG, { unit: get('lg-unit').trim(), priority: get('lg-priority'), range: get('lg-range') || '1h', grep: get('lg-grep').trim(), lines: get('lg-lines') || '200' });
        await stopFollow(c, n);
        LG.live = [];
        await R.loadRole(c, n.server, 'logs', true);
    };
    A['lg-follow'] = async (c, p, n) => {
        const pane = c.el('.mmc-result');
        const get = (k) => { const e = pane.querySelector(`[data-rm="${k}"]`); return e ? e.value : ''; };
        if (LG.follow) { await stopFollow(c, n); R.repaint(c); return; }
        Object.assign(LG, { unit: get('lg-unit').trim(), priority: get('lg-priority') });
        const r = await R.act(n.server, 'logs', 'follow', Object.assign({}, LG.unit ? { unit: LG.unit } : {}, LG.priority !== '' ? { priority: LG.priority } : {}));
        const x = r.result || r;
        LG.followId = x.followId; LG.follow = true; LG.live = [];
        R.repaint(c);
    };
    A['lg-dmesg'] = async (c, p, n) => {
        let text = '';
        try { const r = await R.act(n.server, 'logs', 'dmesg', { lines: 500 }); const x = r.result || r; text = x.text || arr(x.lines).join('\n') || ''; } catch (e) { text = `Kernel messages could not be read: ${(e && e.message) || e}`; }
        R.dialog(c, { id: 'dmesg', title: `Kernel messages: ${n.meta.label}`, w: 760, h: 460, okText: 'Close', noCancel: true, html: `<pre class="rm-pre rm-console" data-mmc-scroll>${esc(text)}</pre>`, init: (ctx) => { const p0 = ctx.content.querySelector('pre'); p0.scrollTop = p0.scrollHeight; } });
    };
    R.commands['role:logs'] = () => [{ text: 'Follow / Stop Following', action: 'lg-follow' }, { text: 'Kernel Messages (dmesg)...', action: 'lg-dmesg' }];

    // ---- Updates -------------------------------------------------------------------------------------------------------

    const UP = { pick: new Set() };
    rolePage('updates', (c, n, d) => {
        const ups = arr(d.upgradable);
        const sec = ups.filter((u) => u.security).length;
        const rows = ups.map((u) => `<tr><td><input type="checkbox" data-rm-input="up-pick" data-pkg="${esc(u.package)}"${UP.pick.has(u.package) ? ' checked' : ''}></td><td>${esc(u.package)}</td><td>${esc(u.from)}</td><td>${esc(u.to)}</td><td>${u.security ? `<img src="/static_images/vista-cpl/shield-uac-16.png" alt=""> Security` : 'Optional'}</td><td>${R.link('up-hold', 'Hold', u.package)}</td></tr>`).join('');
        const table = ups.length ? `<table class="rm-table rm-uptable"><thead><tr><th></th><th>Package</th><th>Installed</th><th>Available</th><th>Update type</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p>${c.state(true, 'Your server is up to date.')}</p>`;
        const hist = list(c, 'rm-uphist', [
            { t: 'Date', w: 140, key: 'd', value: (x) => Date.parse(x.start) || 0, text: (x) => (x.start ? new Date(x.start).toLocaleString() : '') },
            { t: 'Command', w: 220, key: 'c', text: (x) => x.command || '' },
            { t: 'Packages', w: 80, num: true, key: 'p', text: (x) => arr(x.upgraded).length },
            { t: 'Updated', w: 300, key: 'u', text: (x) => arr(x.upgraded).join(', ') }
        ], arr(d.history).map((x, i) => ({ key: `h:${i}`, data: x })), 'No update history.', { sort: { key: 'd', dir: -1 } });
        return c.page('Updates', ups.length ? `${ups.length} updates available` : 'Up to date', [
            d.rebootRequired ? { id: 'up-reboot', title: 'Restart Required', body: `<p>${c.state(false, `${n.meta.label} needs to restart to finish installing updates.`, true)}</p><div class="mmc-buttons">${R.btnHtml('nav-power', 'Power...')}</div>` } : null,
            { id: 'up-status', title: 'Windows Update', body: R.jobStrip(n) + c.overview(`${ITEMS}/update-32.png`, [ups.length ? `<b>${ups.length} update${ups.length === 1 ? '' : 's'} available${sec ? `, ${sec} important` : ''}.</b>` : '<b>Your server is up to date.</b>', `Last checked: ${d.lastCheck ? esc(when(d.lastCheck)) : 'never'}.`]) + `<div class="mmc-buttons">${R.btnHtml('up-check', 'Check for Updates')}${R.btnHtml('up-all', 'Install All Updates...', null, ups.length ? '' : ' disabled')}${R.btnHtml('up-sel', 'Install Selected...', null, UP.pick.size ? '' : ' disabled')}</div>` },
            { id: 'up-list', title: 'Available Updates', body: table },
            arr(d.held).length ? { id: 'up-held', title: 'Held Back', body: `<ul class="rm-arts">${arr(d.held).map((p) => `<li>${esc(p)} ${R.link('up-unhold', 'Release', p)}</li>`).join('')}</ul>` } : null,
            { id: 'up-hist', title: 'Update History', body: hist }
        ]);
    });
    R.inputs['up-pick'] = (v, el) => { if (v) UP.pick.add(el.dataset.pkg); else UP.pick.delete(el.dataset.pkg); const c = R.S.console; const b = c && c.el('[data-act="up-sel"]'); if (b) b.disabled = !UP.pick.size; };
    R.commands['role:updates'] = () => [{ text: 'Check for Updates', action: 'up-check', icon: `${ITEMS}/update-16.png` }, { text: 'Install All Updates...', action: 'up-all' }, { text: 'Remove Unused Packages', action: 'up-autoremove' }];
    A['up-check'] = (c, p, n) => run(c, n, 'updates', 'check', {});
    A['up-autoremove'] = (c, p, n) => run(c, n, 'updates', 'autoremove', {});
    A['up-hold'] = (c, p, n) => run(c, n, 'updates', 'hold', { package: p });
    A['up-unhold'] = (c, p, n) => run(c, n, 'updates', 'unhold', { package: p });
    const install = async (c, n, pkgs) => {
        const d = dataOf(n, 'updates');
        const count = pkgs ? pkgs.length : arr(d.upgradable).length;
        const a = await R.taskDialog(c, { icon: `${VI}/msgbox-question-32.png`, instruction: `Install ${count} update${count === 1 ? '' : 's'} on ${n.meta.label}?`, text: 'The install runs as a job. Some updates need a restart afterwards.', links: [{ id: 'go', text: 'Install Updates' }] });
        if (a === 'go') await run(c, n, 'updates', 'upgrade', pkgs ? { packages: pkgs } : {});
    };
    A['up-all'] = (c, p, n) => install(c, n, null);
    A['up-sel'] = (c, p, n) => { const pk = [...UP.pick]; if (pk.length) { UP.pick.clear(); return install(c, n, pk); } return undefined; };
})(typeof window !== 'undefined' ? window : globalThis);
