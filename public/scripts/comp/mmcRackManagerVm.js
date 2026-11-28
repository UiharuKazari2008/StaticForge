/**
 * Rack Manager, virtual machines: Hyper-V Manager's page for the libvirt machines of a server. The list (Name, State, CPU Usage,
 * Assigned Memory, Uptime, Status), the Screens view, the checkpoint tree, the selected machine's summary with its live thumbnail,
 * New Virtual Machine / Import / Export / Move wizards and the Action pane. The Settings window is mmcRackManagerVmSet.js, the live
 * console (VMConnect) and the thumbnails are mmcRackManagerVmc.js. CPU, memory and uptime are pushed by rackd (vms/stats, every 10 s
 * while this console listens); nothing here polls. Part of window.mmcRack.
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc, ITEMS, VI } = R;
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const A = R.actions;
    const when = (t) => R.when(t);

    const V = { view: 'list', cps: new Map(), cpSel: new Map(), statT: null };
    const VM_STATE = { running: 'Running', 'shut off': 'Off', shutoff: 'Off', paused: 'Paused', crashed: 'Crashed', pmsuspended: 'Suspended', 'in shutdown': 'Shutting down' };
    const stateText = (v) => (v.saved && v.state === 'shut off' ? 'Saved' : (VM_STATE[v.state] || v.state));
    const MISSING = { vnc: 'no VNC display on 127.0.0.1', 'guest-agent-channel': 'no guest agent channel', 'serial-log': 'no serial console log', tablet: 'no tablet pointer', 'guest-agent': 'the guest agent does not answer', 'vm-agent': 'no in-guest agent' };
    const GBtext = (b) => `${(Number(b) / 2 ** 30).toFixed(Number(b) / 2 ** 30 >= 10 ? 0 : 1)} GB`;
    const MB = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} GB` : `${mb} MB`);
    const clock = (s) => { s = Math.max(0, Math.round(Number(s) || 0)); const d = Math.floor(s / 86400); const p = (n) => String(n).padStart(2, '0'); return `${d ? `${d}.` : ''}${p(Math.floor((s % 86400) / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`; };
    const vmsOf = (n) => arr(R.dataOf(n, 'vms').vms);
    const vmOf = (c, n) => vmsOf(n).find((v) => v.name === c.sel);
    const key = (server, name) => `${server}\n${name}`;
    const stamp = () => { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
    const res = (r) => (r && r.result !== undefined ? r.result : r) || {};

    // ---- checkpoints ----------------------------------------------------------------------------------------------

    async function loadCps(c, n, name) {
        const k = key(n.server, name);
        const cur = V.cps.get(k) || { list: [], current: null, err: '', loading: false };
        V.cps.set(k, cur);
        if (cur.loading) return;
        cur.loading = true;
        try { const x = res(await R.act(n.server, 'vms', 'checkpoints', { name })); cur.list = arr(x.checkpoints); cur.current = x.current || null; cur.err = ''; } catch (e) { cur.err = (e && e.message) || 'The checkpoints could not be read.'; }
        cur.loading = false;
        R.repaint(c);
    }
    const cpOf = (c, n, name) => V.cps.get(key(n.server, name)) || { list: [], current: null, err: '' };
    const depth = (list, cp) => { let d = 0; let p = cp.parent; while (p && d < 30) { d += 1; p = (list.find((x) => x.name === p) || {}).parent; } return d; };
    /** Hyper-V's tree: the checkpoints in order of creation under their parents, then Now under the one the machine runs from. */
    function cpTree(c, n, v) {
        const cur = cpOf(c, n, v.name);
        if (cur.err) return `<p class="mmc-hint">${esc(cur.err)}</p>`;
        const sel = V.cpSel.get(key(n.server, v.name));
        const byParent = (p) => cur.list.filter((x) => (x.parent || null) === p).sort((a, b) => String(a.created).localeCompare(String(b.created)));
        const rows = [];
        const walk = (p, d) => byParent(p).forEach((x) => {
            rows.push(`<div class="rm-cprow${x.name === sel ? ' is-selected' : ''}" data-cp="${esc(x.name)}" style="--d:${d}"><img src="${ITEMS}/backup-and-restore-center-16.png" alt=""><b>${esc(x.name)}</b><i>${esc(when(x.created))}${x.memory ? ' (with memory)' : ''}${x.description ? ` - ${esc(x.description)}` : ''}</i></div>`);
            if (x.name === cur.current && !byParent(x.name).length) rows.push(`<div class="rm-cprow is-now" style="--d:${d + 1}"><img src="${ITEMS}/system-16.png" alt=""><b>Now</b></div>`);
            walk(x.name, d + 1);
        });
        walk(null, 0);
        if (!cur.current || !cur.list.length) rows.push(`<div class="rm-cprow is-now" style="--d:0"><img src="${ITEMS}/system-16.png" alt=""><b>Now</b></div>`);
        return cur.list.length ? `<div class="rm-cptree" data-mmc-scroll>${rows.join('')}</div>` : `<p class="mmc-hint">${cur.loading ? 'Reading data, please wait...' : 'This virtual machine has no checkpoints. Use Checkpoint to make one.'}</p>`;
    }

    // ---- the page ---------------------------------------------------------------------------------------------------

    const statusHtml = (v) => {
        const m = v.manageable || {};
        if (m.ok) return esc('Operating normally');
        const why = !m.managed ? 'Not managed by rackd (adopt it)' : `Needs attention: ${arr(m.missing).map((x) => MISSING[x] || x).join(', ')}`;
        return `<img class="mmc-row-icon" src="${VI}/warning-16.png" alt=""><i>${esc(why)}</i>`;
    };
    const statusText = (v) => { const m = v.manageable || {}; return m.ok ? 'Operating normally' : !m.managed ? 'Not managed by rackd (adopt it)' : `Needs attention: ${arr(m.missing).map((x) => MISSING[x] || x).join(', ')}`; };

    R.rolePage('vms', (c, n, d) => {
        const vms = arr(d.vms);
        const rows = vms.map((v) => ({ key: v.name, icon: `${ITEMS}/system-16.png`, data: v }));
        const list = c.listView([
            { t: 'Name', w: 170, key: 'n', text: (v) => v.name },
            { t: 'State', w: 78, min: 66, key: 's', text: (v) => stateText(v) },
            { t: 'CPU Usage', w: 74, min: 60, num: true, key: 'c', value: (v) => (v.state === 'running' ? (v.cpu || 0) : -1), text: (v) => (v.state === 'running' ? `${Math.round(v.cpu || 0)}%` : '') },
            { t: 'Assigned Memory', w: 104, min: 84, num: true, key: 'm', value: (v) => (v.state === 'running' ? (v.assignedMB || v.memMB || 0) : 0), text: (v) => (v.state === 'running' ? MB(v.assignedMB || v.memMB || 0) : '') },
            { t: 'Uptime', w: 86, min: 70, key: 'u', value: (v) => (v.state === 'running' ? (v.uptimeS || 0) : -1), text: (v) => (v.state === 'running' && v.uptimeS != null ? clock(v.uptimeS) : '') },
            { t: 'Status', w: 230, key: 'x', text: (v) => statusText(v), html: (v) => statusHtml(v) }
        ], rows, { sortId: 'rm-vms', fit: true, empty: 'There are no virtual machines. Use New Virtual Machine to make one.' });
        const sel = vmOf(c, n);
        const bad = vms.filter((v) => !(v.manageable && v.manageable.ok));
        const warn = bad.length ? `<div class="rm-vmwarn"><img src="${VI}/warning-16.png" alt=""><span>${bad.length === 1 ? 'One virtual machine is' : `${bad.length} virtual machines are`} not fully manageable, so agents and this console cannot see or control ${bad.length === 1 ? 'it' : 'them'} reliably: ${bad.map((v) => `<b>${esc(v.name)}</b> (${esc(!v.manageable.managed ? 'not adopted' : arr(v.manageable.missing).map((x) => MISSING[x] || x).join(', '))})`).join('; ')}. A machine that is not managed is also invisible to the idle shutdown check.</span></div>` : '';
        const bar = `<div class="rm-vmbar">${R.btnHtml('vm-view', 'List', 'list', V.view === 'list' ? ' disabled' : '')}${R.btnHtml('vm-view', 'Screens', 'screens', V.view === 'screens' ? ' disabled' : '')}</div>`;
        const main = V.view === 'screens' ? R.vmScreensView(c, n, vms) : list;
        const sections = [{ id: 'vm-list', title: 'Virtual Machines', body: R.jobStrip(n) + warn + bar + main }];
        if (sel) {
            sections.push({ id: 'vm-cps', title: 'Checkpoints', body: cpTree(c, n, sel) });
            const dsk = arr(sel.disks).map((x) => `${esc(x.target)} ${x.sizeB ? esc(GBtext(x.sizeB)) : ''} (${esc(x.bus || '')})`).join(', ') || 'none';
            const ips = arr(sel.nics).map((x) => x.ip).filter(Boolean).join(', ');
            const thumb = sel.state === 'running' ? R.vmThumb(n.server, sel.name, 'rm-vmpv') : `<div class="rm-vmpv rm-vmoff">${esc(stateText(sel))}</div>`;
            const props = c.props([
                ['Generation', sel.firmware && sel.firmware.uefi ? '2 (UEFI)' : '1 (BIOS)'],
                ['Processors', esc(`${sel.vcpus} (${sel.cpuModel || 'default'})`)],
                ['Memory', esc(sel.dynamicMemory ? `${MB(sel.memMB)} to ${MB(sel.memMaxMB)} (dynamic)` : MB(sel.memMB))],
                ['Hard drives', dsk],
                ['Network', esc(arr(sel.nics).map((x) => `${x.network || '?'} ${x.mac || ''}`).join(', ') || 'none')],
                ['IP addresses', esc(ips || (sel.state === 'running' ? 'not reported yet' : ''))],
                ['Guest agent', c.state(sel.state !== 'running' || !arr(sel.manageable && sel.manageable.missing).includes('guest-agent'), sel.state === 'running' ? (arr(sel.manageable.missing).includes('guest-agent') ? 'No contact' : 'OK') : 'Off', true)],
                ['Status', statusHtml(sel)],
                ['Automatic stop', esc({ shutdown: 'Shut down', save: 'Save', off: 'Turn off' }[sel.stopAction] || 'Shut down')],
                sel.tags && sel.tags.purpose ? ['Purpose', esc(sel.tags.purpose)] : null
            ]);
            sections.push({ id: 'vm-sum', title: sel.name, body: `<div class="rm-vmdetail"><div class="rm-vmthumb" data-vmtile="${esc(sel.name)}" data-key="${esc(sel.name)}" title="Double-click to connect">${thumb}</div><div class="rm-vmsummary">${props}</div></div>` });
        }
        return c.page('Virtual Machines', `${vms.length} virtual machine${vms.length === 1 ? '' : 's'}`, sections);
    });

    // ---- the Action pane --------------------------------------------------------------------------------------------

    R.commands['role:vms'] = () => [
        { text: 'New Virtual Machine...', action: 'vm-new', icon: `${ITEMS}/system-16.png` },
        { text: 'Import Virtual Machine...', action: 'vm-import' },
        { text: 'Clone Dreamscape Server...', action: 'vm-dsclone' },
        { text: 'ISO Images...', action: 'vm-iso' },
        { separator: true },
        { text: V.view === 'screens' ? 'Show the List' : 'Show the Screens', action: `vm-view:${V.view === 'screens' ? 'list' : 'screens'}` }
    ];
    R.selCommands['role:vms'] = (n, k, c) => {
        const v = vmOf(c, n);
        if (!v) return null;
        const st = v.state;
        const on = st === 'running';
        const items = [];
        items.push({ text: 'Connect...', action: 'vm-connect', icon: `${ITEMS}/system-16.png` }, { text: 'Settings...', action: 'vm-set' }, { separator: true });
        if (!on && st !== 'paused') items.push({ text: v.saved ? 'Start (resume the saved state)' : 'Start', action: 'vm-op:start' });
        if (on) items.push({ text: 'Shut Down', action: 'vm-op:shutdown' }, { text: 'Save', action: 'vm-op:save' }, { text: 'Pause', action: 'vm-op:suspend' });
        if (st === 'paused') items.push({ text: 'Resume', action: 'vm-op:resume' });
        if (on || st === 'paused') items.push({ text: 'Reset', action: 'vm-op:reset' }, { text: 'Turn Off', action: 'vm-op:destroy' });
        items.push({ separator: true }, { text: 'Checkpoint...', action: 'vm-cp' });
        const cp = V.cpSel.get(key(n.server, v.name));
        if (cp) items.push({ text: `Apply Checkpoint ${cp}...`, action: 'vm-cp-apply' }, { text: 'Rename Checkpoint...', action: 'vm-cp-rename' }, { text: 'Delete Checkpoint...', action: 'vm-cp-del:one' }, { text: 'Delete Checkpoint Subtree...', action: 'vm-cp-del:tree' });
        items.push({ separator: true }, { text: 'Move...', action: 'vm-move' }, { text: 'Export...', action: 'vm-export' }, { text: 'Clone...', action: 'vm-clone' });
        if (!(v.manageable && v.manageable.managed)) items.push({ text: 'Adopt (make manageable)...', action: 'vm-adopt' });
        items.push({ separator: true }, { text: 'Delete...', action: 'vm-del' });
        return { title: v.name, items };
    };
    R.hooks.row.push((k, n, c) => {
        if (n.kind !== 'role' || n.role !== 'vms') return;
        void loadCps(c, n, k);
        R.repaint(c);
    });

    // checkpoint rows select; thumbnails and rows open the console
    R.hooks.open.push((c) => {
        c.modal.addEventListener('click', (ev) => {
            const row = ev.target.closest && ev.target.closest('[data-cp]');
            if (!row) return;
            const n = R.here(c);
            if (n.kind !== 'role' || n.role !== 'vms' || !c.sel) return;
            V.cpSel.set(key(n.server, c.sel), row.dataset.cp);
            R.repaint(c);
            c.renderActions();
        });
    });
    // pushed numbers: CPU, memory, uptime of the running machines (no read, no wait)
    R.hooks.event.push((c, ev) => {
        if (ev.role !== 'vms') return false;
        const n = R.here(c);
        if (ev.kind === 'stats') {
            const rs = R.ss(ev.server).roles.vms;
            const stats = (ev.data && ev.data.stats) || {};
            if (rs && rs.data) {
                arr(rs.data.vms).forEach((v) => { const s = stats[v.name]; if (s && v.state === 'running') { v.cpu = s.cpu; v.uptimeS = s.uptimeS; if (s.memMB) v.assignedMB = s.memMB; } });
                if (n.kind === 'role' && n.role === 'vms' && n.server === ev.server && !V.statT) V.statT = setTimeout(() => { V.statT = null; R.repaint(c); }, 250);
            }
            return false;
        }
        if (ev.kind === 'state' && n.kind === 'role' && n.role === 'vms' && n.server === ev.server && c.sel && (ev.id === c.sel || (ev.data && ev.data.name === c.sel))) setTimeout(() => { void loadCps(c, n, c.sel); }, 600);
        return false;
    });

    // the screens feed runs while a machine page is shown (the thumbnails need it)
    R.hooks.ensure.push((c, n) => { if (n.kind === 'role' && n.role === 'vms' && n.server && R.vmScreensLease) R.vmScreensLease(c, n.server, true); });
    R.hooks.leave.push((c, from) => { if (from.kind === 'role' && from.role === 'vms' && from.server && R.vmScreensLease) R.vmScreensLease(c, from.server, false); });

    A['vm-view'] = (c, v) => { V.view = v === 'screens' ? 'screens' : 'list'; R.repaint(c); c.renderActions(); };
    A['vm-connect'] = (c, p, n) => { const v = vmOf(c, n); if (v) void R.vmConnect(c, n.server, v.name); };
    A['vm-set'] = (c, p, n) => { const v = vmOf(c, n); if (v) void R.vmSettings(c, n.server, v.name); };

    A['vm-op'] = async (c, op, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        if (op === 'destroy') {
            const a = await R.taskDialog(c, { instruction: `Turn off ${v.name}?`, text: 'The machine is switched off as if its power cord were pulled. Unsaved data in it is lost.', links: [{ id: 'go', text: 'Turn Off', danger: true }] });
            if (a !== 'go') return;
        }
        await R.run(c, n, 'vms', op, { name: v.name });
    };
    A['vm-del'] = async (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        const a = await R.taskDialog(c, { instruction: `Delete ${v.name}?`, text: 'The machine is removed. This cannot be undone.', links: [{ id: 'all', text: 'Delete the machine and its disks', sub: arr(v.disks).map((x) => R.bytes(x.sizeB)).join(', '), danger: true }, { id: 'keep', text: 'Delete the machine, keep its disks' }] });
        if (a) await R.run(c, n, 'vms', 'delete', { name: v.name, storage: a === 'all', force: v.state !== 'shut off' });
    };
    A['vm-clone'] = (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        R.dialog(c, {
            id: 'vmclone', title: 'Clone Virtual Machine', w: 380, h: 190,
            html: `<p>Make a copy of <b>${esc(v.name)}</b> (its disks are copied; the job runs on the server).</p>${R.field('Name of the clone:', R.inp('name', `${v.name}-clone`))}`,
            okText: 'Clone',
            ok: async (ctx) => { const name = (R.val(ctx, 'name') || '').trim(); if (!name) { R.err(ctx, 'Type a name.'); return false; } await R.doit(c, n, 'vms', 'clone', { source: v.name, name }); return true; }
        });
    };
    A['vm-dsclone'] = (c, p, n) => {
        const tpl = vmsOf(n).find((v) => v.tags && v.tags.template === 'dreamscape');
        R.dialog(c, {
            id: 'vmds', title: 'Clone Dreamscape Server', w: 400, h: 250,
            html: `<p>Clones the Dreamscape template machine${tpl ? ` (<b>${esc(tpl.name)}</b>)` : ''}, starts it and checks a branch out in it.</p>${R.field('Name:', R.inp('name', ''))}${R.field('Branch:', R.inp('branch', 'main'))}`,
            okText: 'Clone',
            ok: async (ctx) => {
                const name = (R.val(ctx, 'name') || '').trim();
                if (!name) { R.err(ctx, 'Type a name for the new server.'); return false; }
                await R.doit(c, n, 'vms', 'dsclone', { name, branch: (R.val(ctx, 'branch') || 'main').trim() });
                return true;
            }
        });
    };
    A['vm-adopt'] = (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        const miss = arr(v.manageable && v.manageable.missing).filter((x) => x !== 'guest-agent' && x !== 'vm-agent').map((x) => MISSING[x] || x);
        R.dialog(c, {
            id: 'vmadopt', title: 'Adopt Virtual Machine', w: 440, h: 270,
            html: `<p>Adopting makes <b>${esc(v.name)}</b> manageable: rackd adds ${miss.length ? esc(miss.join(', ')) : 'nothing missing'} to its definition (the machine must be off), and tags it as managed. The guest agent itself has to run inside the guest (qemu-guest-agent on Linux, the QEMU guest tools on Windows).</p>${R.field('Guest system:', R.sel('guest', [{ value: 'linux', text: 'Linux' }, { value: 'windows', text: 'Windows' }, { value: 'other', text: 'Other' }], (v.tags && v.tags.guest) || 'linux'))}${v.state !== 'shut off' ? '<p class="rm-hint">Turn the machine off first.</p>' : ''}`,
            okText: 'Adopt',
            ok: async (ctx) => { await R.doit(c, n, 'vms', 'adopt', { name: v.name, guest: R.val(ctx, 'guest') }); return true; }
        });
    };
    A['vm-iso'] = async (c, p, n) => {
        let isos = [];
        try { isos = arr(res(await R.act(n.server, 'vms', 'iso-list')).isos); } catch (e) { await R.box(c, (e && e.message) || 'The ISO pool could not be read.'); return; }
        R.dialog(c, {
            id: 'vmiso', title: 'ISO Images', w: 520, h: 360,
            html: `<div class="rm-isolist">${isos.map((i) => `<div class="rm-isorow"><span>${esc(i.name)}</span><i>${esc(R.bytes(i.sizeB))}</i></div>`).join('') || '<div class="rm-hint">The ISO pool is empty.</div>'}</div>${R.field('Download from a URL:', R.inp('url', '', 'placeholder="https://..."'), true)}${R.field('File name (ends in .iso):', R.inp('fname', ''), true)}<p class="rm-hint">The server downloads the image into its ISO pool as a job.</p>`,
            okText: 'Download',
            ok: async (ctx) => {
                const url = (R.val(ctx, 'url') || '').trim();
                let fname = (R.val(ctx, 'fname') || '').trim() || url.split('/').pop().split('?')[0];
                if (!url) return true;
                if (!/\.(iso|img)$/i.test(fname)) { R.err(ctx, 'The file name must end in .iso or .img.'); return false; }
                fname = fname.replace(/[^A-Za-z0-9._-]/g, '_');
                await R.doit(c, n, 'vms', 'iso-fetch', { url, name: fname });
                return true;
            }
        });
    };

    // ---- checkpoint actions -------------------------------------------------------------------------------------------

    const cpName = (c, n) => V.cpSel.get(key(n.server, c.sel));
    A['vm-cp'] = (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        R.dialog(c, {
            id: 'vmcp', title: 'Checkpoint', w: 400, h: 230,
            html: `${R.field('Name:', R.inp('name', `checkpoint-${stamp()}`))}${R.field('Note (optional):', R.inp('desc', ''))}<p class="rm-hint">${v.state === 'running' ? 'The checkpoint keeps the running state (memory included).' : 'The checkpoint keeps the disks as they are now.'}</p>`,
            okText: 'Create',
            ok: async (ctx) => {
                const name = (R.val(ctx, 'name') || '').trim();
                if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name)) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores only.'); return false; }
                await R.act(n.server, 'vms', 'checkpoint', { name: v.name, op: 'create', snap: name, description: (R.val(ctx, 'desc') || '').trim() });
                V.cpSel.set(key(n.server, v.name), name);
                void loadCps(c, n, v.name);
                return true;
            }
        });
    };
    A['vm-cp-apply'] = async (c, p, n) => {
        const v = vmOf(c, n);
        const cp = v && cpName(c, n);
        if (!cp) return;
        const a = await R.taskDialog(c, { instruction: `Apply the checkpoint ${cp}?`, text: `${esc(v.name)} goes back to the state of the checkpoint. Changes made since then are lost unless you make a checkpoint first.`, links: [{ id: 'new', text: 'Create Checkpoint and Apply' }, { id: 'go', text: 'Apply', danger: true }] });
        if (!a) return;
        try {
            if (a === 'new') await R.act(n.server, 'vms', 'checkpoint', { name: v.name, op: 'create', snap: `before-${cp}-${stamp()}`.slice(0, 63) });
            await R.act(n.server, 'vms', 'checkpoint', { name: v.name, op: 'apply', snap: cp });
        } catch (e) { await R.box(c, (e && e.message) || 'The checkpoint could not be applied.'); }
        R.stale(c, n, 'vms');
        void loadCps(c, n, v.name);
    };
    A['vm-cp-rename'] = (c, p, n) => {
        const v = vmOf(c, n);
        const cp = v && cpName(c, n);
        if (!cp) return;
        R.dialog(c, {
            id: 'vmcprn', title: 'Rename Checkpoint', w: 380, h: 170,
            html: R.field('New name:', R.inp('name', cp)),
            okText: 'Rename',
            ok: async (ctx) => {
                const nn = (R.val(ctx, 'name') || '').trim();
                if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(nn)) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores only.'); return false; }
                await R.act(n.server, 'vms', 'checkpoint', { name: v.name, op: 'rename', snap: cp, newName: nn });
                V.cpSel.set(key(n.server, v.name), nn);
                void loadCps(c, n, v.name);
                return true;
            }
        });
    };
    A['vm-cp-del'] = async (c, mode, n) => {
        const v = vmOf(c, n);
        const cp = v && cpName(c, n);
        if (!cp) return;
        const tree = mode === 'tree';
        const a = await R.taskDialog(c, { instruction: tree ? `Delete ${cp} and the checkpoints under it?` : `Delete the checkpoint ${cp}?`, text: 'The saved state is removed; the machine keeps its current state.', links: [{ id: 'go', text: tree ? 'Delete Subtree' : 'Delete', danger: true }] });
        if (a !== 'go') return;
        try { await R.act(n.server, 'vms', 'checkpoint', { name: v.name, op: 'delete', snap: cp, subtree: tree }); V.cpSel.delete(key(n.server, v.name)); } catch (e) { await R.box(c, (e && e.message) || 'The checkpoint could not be deleted.'); }
        void loadCps(c, n, v.name);
    };

    // ---- export, move ---------------------------------------------------------------------------------------------------

    A['vm-export'] = (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        R.dialog(c, {
            id: 'vmexp', title: 'Export Virtual Machine', w: 420, h: 220,
            html: `<p>Exports <b>${esc(v.name)}</b> (disks, firmware variables, TPM state, definition) to a folder under /srv/rack/vm-exports on the server. The machine must be off.</p>${R.field('Folder name:', R.inp('folder', v.name))}`,
            okText: 'Export',
            ok: async (ctx) => {
                const folder = (R.val(ctx, 'folder') || '').trim();
                if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(folder)) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores only.'); return false; }
                await R.doit(c, n, 'vms', 'export', { name: v.name, folder });
                return true;
            }
        });
    };
    A['vm-move'] = (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        const pools = arr(R.dataOf(n, 'vms').pools).map((x) => x.name);
        R.dialog(c, {
            id: 'vmmove', title: 'Move Virtual Machine', w: 420, h: 230,
            html: `<p>Moves the disk files of <b>${esc(v.name)}</b> to another storage pool (a directory pool). The machine must be off and have no checkpoints.</p>${R.field('Pool:', R.sel('pool', pools.filter((x) => x !== 'iso'), pools.includes('vmfiles') ? 'vmfiles' : pools[0]))}`,
            okText: 'Move',
            ok: async (ctx) => { await R.doit(c, n, 'vms', 'move', { name: v.name, pool: R.val(ctx, 'pool') }); return true; }
        });
    };
    A['vm-import'] = async (c, p, n) => {
        let list = [];
        try { list = arr(res(await R.act(n.server, 'vms', 'exports')).exports); } catch (e) { await R.box(c, (e && e.message) || 'The exports could not be read.'); return; }
        if (!list.length) { await R.box(c, 'There is nothing to import: /srv/rack/vm-exports has no exported machine. Export one first.', 'info'); return; }
        R.dialog(c, {
            id: 'vmimp', title: 'Import Virtual Machine', w: 460, h: 330,
            html: `<div class="rm-isolist" data-rm-exps>${list.map((x, i) => `<div class="rm-isorow${i === 0 ? ' is-selected' : ''}" data-exp="${esc(x.folder)}"><span>${esc(x.name)} (${esc(x.folder)})</span><i>${esc(when(x.exportedAt))}</i></div>`).join('')}</div>${R.field('Name of the new machine:', R.inp('name', `${list[0].name}-import`))}<div class="rm-row">${R.btnHtml('vm-exp-del', 'Delete Export')}</div>`,
            okText: 'Import',
            init: (ctx) => {
                ctx.store = { pick: list[0].folder };
                ctx.content.addEventListener('click', async (ev) => {
                    const row = ev.target.closest('[data-exp]');
                    if (row) {
                        ctx.store.pick = row.dataset.exp;
                        ctx.content.querySelectorAll('[data-exp]').forEach((r) => r.classList.toggle('is-selected', r === row));
                        const x = list.find((e) => e.folder === ctx.store.pick);
                        const nm = ctx.content.querySelector('[data-rm="name"]');
                        if (x && nm) nm.value = `${x.name}-import`;
                        return;
                    }
                    if (ev.target.closest('[data-act="vm-exp-del"]')) {
                        ev.stopPropagation();
                        const a = await R.taskDialog(c, { instruction: `Delete the export ${ctx.store.pick}?`, text: 'Its files are removed from the server.', links: [{ id: 'go', text: 'Delete', danger: true }] });
                        if (a !== 'go') return;
                        try { await R.act(n.server, 'vms', 'export-delete', { folder: ctx.store.pick }); const r = ctx.content.querySelector(`[data-exp="${CSS.escape(ctx.store.pick)}"]`); if (r) r.remove(); } catch (e) { R.err(ctx, (e && e.message) || 'The export could not be deleted.'); }
                    }
                });
            },
            ok: async (ctx) => {
                const name = (R.val(ctx, 'name') || '').trim();
                if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name)) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores only.'); return false; }
                if (!ctx.store || !ctx.store.pick) { R.err(ctx, 'Select an export.'); return false; }
                await R.doit(c, n, 'vms', 'import', { folder: ctx.store.pick, name });
                return true;
            }
        });
    };

    // ---- New Virtual Machine wizard -------------------------------------------------------------------------------------

    A['vm-new'] = async (c, p, n) => {
        const d = R.dataOf(n, 'vms');
        const nets = arr(d.networks).map((x) => x.name || x);
        const pools = arr(d.pools).map((x) => x.name);
        let isos = [];
        try { isos = arr(res(await R.act(n.server, 'vms', 'iso-list')).isos); } catch (_) { /* the page still works without the list */ }
        const radio = (name, value, text, on) => `<label class="rm-check"><input type="radio" name="rm-${name}" data-rm="${name}" value="${value}"${on ? ' checked' : ''}> ${text}</label>`;
        const num = (ctx, k) => Number(R.val(ctx, k));
        R.wizard(c, {
            id: 'vmnew', title: 'New Virtual Machine Wizard', icon: `${ITEMS}/system-32.png`, w: 520, h: 340,
            pages: [
                { key: 'name', instruction: 'Name the virtual machine', html: `${R.field('Name:', R.inp('name', ''))}${R.field('Guest system:', R.sel('guest', [{ value: 'linux', text: 'Linux' }, { value: 'windows', text: 'Windows' }, { value: 'other', text: 'Other' }], 'linux'))}${R.field('Purpose (optional):', R.inp('purpose', ''))}`, next: (ctx) => { const nm = (R.val(ctx, 'name') || '').trim(); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(nm)) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores only.'); return false; } if (vmsOf(n).some((v) => v.name === nm)) { R.err(ctx, 'A virtual machine with that name exists.'); return false; } R.err(ctx, ''); return 'gen'; } },
                { key: 'gen', instruction: 'Choose the generation', html: `${radio('gen', '1', 'Generation 1: BIOS firmware, the widest guest support', false)}${radio('gen', '2', 'Generation 2: UEFI firmware (needed for Windows 11; supports Secure Boot and a TPM)', true)}${R.chk('sb', 'Enable Secure Boot (generation 2)', false)}${R.chk('tpm', 'Add a virtual TPM (generation 2)', false)}<p class="rm-hint">The generation cannot be changed after the machine is made.</p>`, next: () => 'mem' },
                { key: 'mem', instruction: 'Assign memory', html: `${R.field('Startup memory (MB):', R.inp('mem', 4096))}${R.chk('dyn', 'Use dynamic memory for this virtual machine', false)}${R.field('Maximum memory (MB):', R.inp('memmax', 8192))}${R.field('Processors:', R.inp('vcpus', 2))}`, next: (ctx) => { if (!(num(ctx, 'mem') >= 64 && num(ctx, 'vcpus') >= 1)) { R.err(ctx, 'Type whole numbers for memory and processors.'); return false; } if (R.val(ctx, 'dyn') && num(ctx, 'memmax') < num(ctx, 'mem')) { R.err(ctx, 'The maximum memory cannot be below the startup memory.'); return false; } R.err(ctx, ''); return 'net'; } },
                { key: 'net', instruction: 'Configure networking', html: `${R.field('Connection:', R.sel('net', [{ value: 'none', text: 'Not connected' }].concat(nets.map((x) => ({ value: x, text: x }))), nets.includes('br0') ? 'br0' : (nets[0] || 'none')))}<p class="rm-hint">br0 puts the machine on the server's network.</p>`, next: () => 'disk' },
                { key: 'disk', instruction: 'Connect a virtual hard disk', html: `${radio('disk', 'new', 'Create a virtual hard disk', true)}${R.field('Size (GB):', R.inp('gb', 40))}${R.field('Controller:', R.sel('bus', [{ value: 'virtio', text: 'VirtIO (fastest; Windows needs the virtio driver)' }, { value: 'scsi', text: 'SCSI (virtio-scsi)' }, { value: 'sata', text: 'SATA (works everywhere)' }], 'virtio'))}${radio('disk', 'existing', 'Use an existing virtual hard disk', false)}${R.field('Path on the server:', R.inp('volume', '', 'placeholder="/srv/rack/vmfiles/disk.qcow2"'))}${radio('disk', 'none', 'Attach a virtual hard disk later', false)}`, next: (ctx) => { const m = R.picked(ctx, 'disk'); if (m === 'new' && !(num(ctx, 'gb') > 0)) { R.err(ctx, 'Type the size in GB.'); return false; } if (m === 'existing' && !(R.val(ctx, 'volume') || '').trim().startsWith('/')) { R.err(ctx, 'Type the absolute path of the disk.'); return false; } R.err(ctx, ''); return 'os'; } },
                { key: 'os', instruction: 'Installation options', html: `${radio('os', 'later', 'Install an operating system later', false)}${radio('os', 'iso', 'Install from an image file (ISO) in the server\'s pool', isos.length > 0)}${R.field('Image:', R.sel('iso', isos.map((i) => ({ value: i.path, text: `${i.name} (${R.bytes(i.sizeB)})` })).concat(isos.length ? [] : [{ value: '', text: '(no images: use ISO Images...)' }]), isos[0] ? isos[0].path : ''))}${R.chk('start', 'Start the virtual machine after it is created', true)}`, next: (ctx) => { if (R.picked(ctx, 'os') === 'iso' && !R.val(ctx, 'iso')) { R.err(ctx, 'Select an image.'); return false; } R.err(ctx, ''); return 'sum'; } },
                { key: 'sum', instruction: 'Completing the New Virtual Machine Wizard', nextText: 'Finish', html: '<div data-rm-sum></div>', finish: true, show: (ctx) => {
                    const g = R.picked(ctx, 'gen') === '2';
                    const rows = [['Name', R.val(ctx, 'name')], ['Generation', g ? '2 (UEFI)' : '1 (BIOS)'], ['Memory', R.val(ctx, 'dyn') ? `${R.val(ctx, 'mem')} MB to ${R.val(ctx, 'memmax')} MB (dynamic)` : `${R.val(ctx, 'mem')} MB`], ['Processors', R.val(ctx, 'vcpus')], ['Network', R.val(ctx, 'net')], ['Hard disk', { new: `New, ${R.val(ctx, 'gb')} GB (${R.val(ctx, 'bus')})`, existing: R.val(ctx, 'volume'), none: 'None' }[R.picked(ctx, 'disk')]], ['Installation', R.picked(ctx, 'os') === 'iso' ? (R.val(ctx, 'iso') || '').split('/').pop() : 'Later']];
                    const el = ctx.content.querySelector('[data-rm-sum]');
                    if (el) el.innerHTML = `<dl class="mmc-props">${rows.map(([k, v]) => `<dt>${esc(k)}:</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
                } }
            ],
            finish: async (ctx) => {
                const g2 = R.picked(ctx, 'gen') === '2';
                const dm = R.picked(ctx, 'disk');
                const params = { name: R.val(ctx, 'name').trim(), guest: R.val(ctx, 'guest'), generation: g2 ? 2 : 1, vcpus: num(ctx, 'vcpus'), memMB: num(ctx, 'mem'), diskMode: dm, bus: R.val(ctx, 'bus') || 'virtio', network: R.val(ctx, 'net') === 'none' ? null : R.val(ctx, 'net'), start: !!R.val(ctx, 'start') };
                if (g2) { params.secureBoot = !!R.val(ctx, 'sb'); params.tpm = !!R.val(ctx, 'tpm'); }
                if (R.val(ctx, 'dyn')) params.memMaxMB = num(ctx, 'memmax');
                if (dm === 'new') params.diskGB = num(ctx, 'gb');
                if (dm === 'existing') params.volume = R.val(ctx, 'volume').trim();
                if (R.picked(ctx, 'os') === 'iso') params.iso = R.val(ctx, 'iso');
                const purpose = (R.val(ctx, 'purpose') || '').trim();
                if (purpose) params.purpose = purpose;
                try { await R.doit(c, n, 'vms', 'create', params); return true; } catch (e) { R.err(ctx, (e && e.message) || 'The machine could not be created.'); return false; }
            }
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
