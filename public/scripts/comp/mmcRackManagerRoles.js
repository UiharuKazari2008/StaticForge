/**
 * Rack Manager, part 4: role pages, first half. Virtual Machines, Virtual Android Devices, Sandboxes, Containers and Builds.
 * Every page shows what rackd answers (errors and "not installed" come from mmcRackManager.js's gate). Part of window.mmcRack.
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc, ITEMS, VI } = R;
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const A = R.actions;
    const when = (t) => R.when(t);
    const shotUrl = (server, file) => `/rack/${encodeURIComponent(server)}/files/shots/${encodeURIComponent(file)}`;
    const SHOTS = new Map(); // 'server:role:id' -> url (a screenshot rackd made: a file with an address)

    /** A role page: the gate (error, not installed, reading) or build(c, n, data). */
    const rolePage = (id, build) => { R.pages[`role:${id}`] = (c, n) => R.gate(c, n) || build(c, n, n.ss.roles[id].data || {}); };
    const dataOf = (n, id) => (n.ss.roles[id] && n.ss.roles[id].data) || {};
    const stale = (c, n, role) => { const rs = n.ss.roles[role]; if (rs) rs.at = 0; void R.loadRole(c, n.server, role, true); };
    /** The write that throws (a dialog shows the message inline). */
    const doit = async (c, n, role, action, params) => { const r = await R.act(n.server, role, action, params); stale(c, n, role); return r; };
    /** The write that shows an error in a message box. */
    const run = async (c, n, role, action, params) => { try { return await doit(c, n, role, action, params); } catch (e) { await R.box(c, (e && e.message) || String(e)); return null; } };
    Object.assign(R, { rolePage, dataOf, doit, run, stale, shotUrl, SHOTS });

    const list = (c, id, cols, rows, empty, extra) => c.listView(cols, rows, Object.assign({ sortId: id, empty, fit: true }, extra || {}));
    const preview = (n, role, id, label) => {
        const url = SHOTS.get(`${n.server}:${role}:${id}`);
        return url ? `<div class="rm-preview"><img src="${esc(url)}" alt="Screenshot of ${esc(label)}"></div>` : `<p class="mmc-hint">${id ? `No screenshot of ${esc(label)} yet. Use Take Screenshot.` : 'Select an item to see its screen.'}</p>`;
    };
    async function shot(c, n, role, id, label) {
        const r = await run(c, n, role, 'screenshot', role === 'vms' || role === 'android' ? { name: id } : { id });
        const f = r && (r.file || (r.result && r.result.file));
        if (f) { SHOTS.set(`${n.server}:${role}:${id}`, `${shotUrl(n.server, f)}`); R.repaint(c); }
        void label;
    }
    const GB = (mb) => `${(Number(mb) / 1024).toFixed(Number(mb) % 1024 ? 1 : 0)} GB`;
    const stateIcon = { running: `${VI}/check-16.png` };
    void stateIcon;

    // ---- Virtual Machines --------------------------------------------------------------------------------------

    const VM_STATE = { running: 'Running', 'shut off': 'Off', shutoff: 'Off', paused: 'Paused', crashed: 'Crashed', pmsuspended: 'Suspended', 'in shutdown': 'Shutting down' };
    const vmOf = (c, n) => arr(dataOf(n, 'vms').vms).find((v) => v.name === c.sel);

    rolePage('vms', (c, n, d) => {
        const rows = arr(d.vms).map((v) => ({ key: v.name, icon: `${ITEMS}/system-16.png`, data: v }));
        const l = list(c, 'rm-vms', [
            { t: 'Name', w: 190, key: 'n', text: (v) => v.name },
            { t: 'State', w: 80, min: 72, key: 's', text: (v) => VM_STATE[v.state] || v.state },
            { t: 'CPUs', w: 46, num: true, key: 'c', value: (v) => v.vcpus, text: (v) => v.vcpus },
            { t: 'Memory', w: 70, min: 62, num: true, key: 'm', value: (v) => v.memMB, text: (v) => GB(v.memMB) },
            { t: 'IP Address', w: 120, min: 104, key: 'i', text: (v) => arr(v.nics).map((x) => x.ip).filter(Boolean)[0] || '' },
            { t: 'Purpose', w: 150, key: 'p', text: (v) => (v.tags && (v.tags.purpose || '')) || '' }
        ], rows, 'There are no virtual machines. Use New Virtual Machine to make one.');
        const v = vmOf(c, n);
        return c.page('Virtual Machines', `${rows.length} virtual machine${rows.length === 1 ? '' : 's'}`, [
            { id: 'vm-list', title: 'Virtual Machines', body: R.jobStrip(n) + l },
            { id: 'vm-prev', title: v ? `Preview: ${v.name}` : 'Preview', body: preview(n, 'vms', v && v.name, v ? v.name : '') }
        ]);
    });

    R.commands['role:vms'] = () => [
        { text: 'New Virtual Machine...', action: 'vm-new', icon: `${ITEMS}/system-16.png` },
        { text: 'Clone Dreamscape Server...', action: 'vm-dsclone' }
    ];
    R.selCommands['role:vms'] = (n, key, c) => {
        const v = vmOf(c, n);
        if (!v) return null;
        const st = v.state;
        const on = st === 'running';
        const items = [];
        if (!on && st !== 'paused') items.push({ text: 'Start', action: 'vm-op:start' });
        if (on) items.push({ text: 'Shut Down', action: 'vm-op:shutdown' }, { text: 'Restart', action: 'vm-op:reboot' }, { text: 'Pause', action: 'vm-op:suspend' });
        if (st === 'paused') items.push({ text: 'Resume', action: 'vm-op:resume' });
        if (on || st === 'paused') items.push({ text: 'Turn Off', action: 'vm-op:destroy' }, { text: 'Take Screenshot', action: 'vm-shot' });
        items.push({ separator: true }, { text: 'Snapshots...', action: 'vm-snaps' }, { text: 'Settings...', action: 'vm-set' }, { text: 'Clone...', action: 'vm-clone' }, { text: 'Delete...', action: 'vm-del' });
        return { title: v.name, items };
    };
    R.hooks.row.push((key, n, c) => { if (n.kind === 'role' && n.role === 'vms') R.repaint(c); });

    A['vm-op'] = async (c, op, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        if (op === 'destroy') {
            const a = await R.taskDialog(c, { instruction: `Turn off ${v.name}?`, text: 'The machine is switched off as if its power cord were pulled. Unsaved data in it is lost.', links: [{ id: 'go', text: 'Turn Off', danger: true }] });
            if (a !== 'go') return;
        }
        await run(c, n, 'vms', op, { name: v.name });
    };
    A['vm-shot'] = async (c, p, n) => { const v = vmOf(c, n); if (v) await shot(c, n, 'vms', v.name, v.name); };
    A['vm-del'] = async (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        const a = await R.taskDialog(c, { instruction: `Delete ${v.name}?`, text: 'The machine is removed. This cannot be undone.', links: [{ id: 'all', text: 'Delete the machine and its disks', sub: arr(v.disks).map((x) => R.bytes(x.sizeB)).join(', '), danger: true }, { id: 'keep', text: 'Delete the machine, keep its disks' }] });
        if (a) await run(c, n, 'vms', 'delete', { name: v.name, storage: a === 'all' });
    };
    A['vm-set'] = (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        R.dialog(c, {
            id: 'vmset', title: `Settings: ${v.name}`, w: 360, h: 230,
            html: `${R.field('Processors:', R.inp('vcpus', v.vcpus))}${R.field('Memory (MB):', R.inp('mem', v.memMB))}${R.chk('auto', 'Start with the server', v.autostart)}<p class="rm-hint">Processor and memory changes apply the next time the machine starts.</p>`,
            okText: 'Save',
            ok: async (ctx) => {
                const vcpus = Number(R.val(ctx, 'vcpus'));
                const memMB = Number(R.val(ctx, 'mem'));
                if (!(vcpus > 0) || !(memMB >= 64)) { R.err(ctx, 'Type a processor count and a memory size in MB.'); return false; }
                await doit(c, n, 'vms', 'set', { name: v.name, vcpus, memMB, autostart: !!R.val(ctx, 'auto') });
                return true;
            }
        });
    };
    A['vm-clone'] = (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        R.dialog(c, {
            id: 'vmclone', title: 'Clone Virtual Machine', w: 380, h: 190,
            html: `<p>Make a copy of <b>${esc(v.name)}</b> (its disks are copied; the job runs on the server).</p>${R.field('Name of the clone:', R.inp('name', `${v.name}-clone`))}`,
            okText: 'Clone',
            ok: async (ctx) => { const name = (R.val(ctx, 'name') || '').trim(); if (!name) { R.err(ctx, 'Type a name.'); return false; } await doit(c, n, 'vms', 'clone', { source: v.name, name }); return true; }
        });
    };
    A['vm-dsclone'] = (c, p, n) => {
        const d = dataOf(n, 'vms');
        const tpl = arr(d.vms).find((v) => v.tags && v.tags.template === 'dreamscape');
        R.dialog(c, {
            id: 'vmds', title: 'Clone Dreamscape Server', w: 400, h: 250,
            html: `<p>Clones the Dreamscape template machine${tpl ? ` (<b>${esc(tpl.name)}</b>)` : ''}, starts it and checks a branch out in it.</p>${R.field('Name:', R.inp('name', ''))}${R.field('Branch:', R.inp('branch', 'main'))}`,
            okText: 'Clone',
            ok: async (ctx) => {
                const name = (R.val(ctx, 'name') || '').trim();
                if (!name) { R.err(ctx, 'Type a name for the new server.'); return false; }
                await doit(c, n, 'vms', 'dsclone', { name, branch: (R.val(ctx, 'branch') || 'main').trim() });
                return true;
            }
        });
    };
    A['vm-snaps'] = async (c, p, n) => {
        const v = vmOf(c, n);
        if (!v) return;
        let snaps = [];
        let readErr = '';
        const read = async () => { try { const r = await R.act(n.server, 'vms', 'snapshots', { name: v.name }); const x = r.result || r; snaps = arr(x.snapshots || x); readErr = ''; } catch (e) { readErr = (e && e.message) || 'The snapshots could not be read.'; } };
        await read();
        let pick = snaps[0] && (snaps[0].name || snaps[0]);
        R.dialog(c, {
            id: 'vmsnaps', title: `Snapshots: ${v.name}`, w: 460, h: 340, okText: 'Close', noCancel: true,
            html: '<div class="rm-isolist" data-rm-snaps></div><div class="rm-row"><button type="button" class="btn-standard" data-snap="create">Create...</button><button type="button" class="btn-standard" data-snap="revert">Revert</button><button type="button" class="btn-standard" data-snap="delete">Delete</button></div>',
            init: (ctx) => {
                const q = (s) => ctx.content.querySelector(s);
                const paint = () => { q('[data-rm-snaps]').innerHTML = snaps.length ? snaps.map((s) => { const nm = s.name || s; return `<div class="rm-isorow${nm === pick ? ' is-selected' : ''}" data-s="${esc(nm)}"><span>${esc(nm)}</span><i>${esc(s.created ? when(s.created) : s.state || '')}</i></div>`; }).join('') : `<div class="rm-hint">${esc(readErr || 'There are no snapshots.')}</div>`; };
                paint();
                ctx.content.addEventListener('click', async (ev) => {
                    const row = ev.target.closest('[data-s]');
                    if (row) { pick = row.dataset.s; paint(); return; }
                    const b = ev.target.closest('[data-snap]');
                    if (!b) return;
                    R.err(ctx, '');
                    try {
                        if (b.dataset.snap === 'create') {
                            const name = `snap-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
                            await R.act(n.server, 'vms', 'snapshot', { name: v.name, snap: name, op: 'create' });
                        } else if (pick) {
                            if (b.dataset.snap === 'delete') { const a = await R.taskDialog(c, { instruction: `Delete the snapshot ${pick}?`, links: [{ id: 'go', text: 'Delete', danger: true }] }); if (a !== 'go') return; }
                            if (b.dataset.snap === 'revert') { const a = await R.taskDialog(c, { instruction: `Revert ${v.name} to ${pick}?`, text: 'Changes made since the snapshot are lost.', links: [{ id: 'go', text: 'Revert', danger: true }] }); if (a !== 'go') return; }
                            await R.act(n.server, 'vms', 'snapshot', { name: v.name, snap: pick, op: b.dataset.snap });
                        }
                        await read(); paint();
                    } catch (e) { R.err(ctx, (e && e.message) || 'The request failed.'); }
                });
            }
        });
    };
    A['vm-new'] = (c, p, n) => {
        const d = dataOf(n, 'vms');
        const nets = arr(d.networks).map((x) => x.name || x);
        R.wizard(c, {
            id: 'vmnew', title: 'New Virtual Machine Wizard', icon: `${ITEMS}/system-32.png`, w: 480, h: 300,
            pages: [
                { key: 'name', instruction: 'Name the virtual machine', html: `${R.field('Name:', R.inp('name', ''))}${R.field('Purpose (optional):', R.inp('purpose', ''))}`, next: (ctx) => { const nm = (R.val(ctx, 'name') || '').trim(); if (!/^[A-Za-z0-9._-]+$/.test(nm)) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores only.'); return false; } R.err(ctx, ''); return 'hw'; } },
                { key: 'hw', instruction: 'Assign memory and disk', html: `${R.field('Processors:', R.inp('vcpus', 4))}${R.field('Memory (MB):', R.inp('mem', 8192))}${R.field('Disk size (GB):', R.inp('disk', 40))}${nets.length ? R.field('Network:', R.sel('net', nets, nets.includes('br0') ? 'br0' : nets[0])) : ''}`, next: (ctx) => { if (!(Number(R.val(ctx, 'vcpus')) > 0 && Number(R.val(ctx, 'mem')) >= 256 && Number(R.val(ctx, 'disk')) > 0)) { R.err(ctx, 'Type whole numbers for processors, memory and disk.'); return false; } R.err(ctx, ''); return 'iso'; } },
                { key: 'iso', instruction: 'Installation options', nextText: 'Create', html: `${R.field('ISO image (path on the server):', R.inp('iso', ''), true)}<p class="rm-hint">Leave empty to make a machine without an installation disc. ISO images live in /var/lib/libvirt/images/iso.</p>`, finish: true }
            ],
            finish: async (ctx) => {
                const params = { name: R.val(ctx, 'name').trim(), vcpus: Number(R.val(ctx, 'vcpus')), memMB: Number(R.val(ctx, 'mem')), diskGB: Number(R.val(ctx, 'disk')) };
                const iso = (R.val(ctx, 'iso') || '').trim();
                if (iso) params.iso = iso;
                const net = R.val(ctx, 'net');
                if (net) params.network = net;
                try { await doit(c, n, 'vms', 'create', params); return true; } catch (e) { R.err(ctx, (e && e.message) || 'The machine could not be created.'); return false; }
            }
        });
    };

    // ---- Virtual Android Devices ------------------------------------------------------------------------------------

    const BOOT = { off: 'Off', booting: 'Starting', ready: 'Ready' };
    const avdOf = (c, n) => arr(dataOf(n, 'android').avds).find((a) => a.name === c.sel);

    rolePage('android', (c, n, d) => {
        const rows = arr(d.avds).map((a) => ({ key: a.name, icon: '/static_images/vista-dlg/android-runtime-32.png', data: a }));
        const l = list(c, 'rm-avds', [
            { t: 'Name', w: 170, key: 'n', text: (a) => a.name },
            { t: 'API', w: 40, num: true, key: 'a', text: (a) => a.api },
            { t: 'ABI', w: 70, key: 'b', text: (a) => a.abi },
            { t: 'Device', w: 100, key: 'd', text: (a) => a.device },
            { t: 'State', w: 70, key: 's', text: (a) => BOOT[a.boot] || a.boot },
            { t: 'Backend', w: 90, key: 'be', text: (a) => a.backend || '' },
            { t: 'Serial', w: 110, key: 'se', text: (a) => a.serial || '' }
        ], rows, 'There are no virtual Android devices. Use Create AVD to make one.');
        const sdk = d.sdk || {};
        const a = avdOf(c, n);
        return c.page('Virtual Android Devices', `${rows.length} device${rows.length === 1 ? '' : 's'}`, [
            { id: 'av-list', title: 'Virtual Android Devices', body: R.jobStrip(n) + l },
            { id: 'av-sdk', title: 'Android SDK', body: c.props([['Location', esc(sdk.path || '')], ['Emulator', sdk.emulator ? esc(String(sdk.emulator)) : c.state(false, 'Not installed', true)], ['Platform tools', sdk.platformTools ? esc(String(sdk.platformTools)) : c.state(false, 'Not installed', true)], ['Hardware virtualisation (KVM)', d.kvm ? 'Available' : c.state(false, 'Not available', true)], ['System images', esc(arr(d.images).filter((x) => x.installed).length + ' installed')]]) },
            { id: 'av-prev', title: a ? `Screen: ${a.name}` : 'Screen', body: preview(n, 'android', a && a.name, a ? a.name : '') }
        ]);
    });
    R.commands['role:android'] = () => [{ text: 'Create AVD...', action: 'av-new', icon: '/static_images/vista-dlg/android-runtime-32.png' }, { text: 'Install System Image...', action: 'av-sdk' }];
    R.selCommands['role:android'] = (n, key, c) => {
        const a = avdOf(c, n);
        if (!a) return null;
        const run0 = a.running || a.boot !== 'off';
        return { title: a.name, items: [run0 ? { text: 'Stop', action: 'av-stop' } : { text: 'Start...', action: 'av-start' }, { text: 'Install APK...', action: 'av-apk', disabled: a.boot !== 'ready' }, { text: 'Shell...', action: 'av-shell', disabled: a.boot !== 'ready' }, { text: 'Take Screenshot', action: 'av-shot', disabled: a.boot !== 'ready' }, { separator: true }, { text: 'Wipe Data...', action: 'av-wipe', disabled: run0 }, { text: 'Delete...', action: 'av-del', disabled: run0 }] };
    };
    A['av-shot'] = async (c, p, n) => { const a = avdOf(c, n); if (a) await shot(c, n, 'android', a.name, a.name); };
    A['av-stop'] = async (c, p, n) => { const a = avdOf(c, n); if (a) await run(c, n, 'android', 'stop', { name: a.name }); };
    A['av-start'] = (c, p, n) => {
        const a = avdOf(c, n);
        if (!a) return;
        R.dialog(c, {
            id: 'avstart', title: `Start ${a.name}`, w: 380, h: 220,
            html: `<p>The device starts without a window (headless). Look at its screen with Take Screenshot.</p>${R.chk('ramdisk', 'Keep its writable files on a RAM disk while it runs (faster)', false)}${R.chk('wipe', 'Wipe its data first (cold boot)', false)}`,
            okText: 'Start',
            ok: async (ctx) => { await doit(c, n, 'android', 'start', { name: a.name, headless: true, ramdisk: !!R.val(ctx, 'ramdisk'), wipe: !!R.val(ctx, 'wipe') }); return true; }
        });
    };
    const confirmAv = async (c, n, a, action, instruction, text, label) => {
        const x = await R.taskDialog(c, { instruction, text, links: [{ id: 'go', text: label, danger: true }] });
        if (x === 'go') await run(c, n, 'android', action, { name: a.name });
    };
    A['av-wipe'] = (c, p, n) => { const a = avdOf(c, n); if (a) return confirmAv(c, n, a, 'wipe', `Wipe the data of ${a.name}?`, 'Everything installed or saved on the device is erased. The device is reset to its first-boot state.', 'Wipe Data'); };
    A['av-del'] = (c, p, n) => { const a = avdOf(c, n); if (a) return confirmAv(c, n, a, 'delete', `Delete ${a.name}?`, 'The device and its disk are removed. This cannot be undone.', 'Delete'); };
    A['av-apk'] = (c, p, n) => {
        const a = avdOf(c, n);
        if (!a) return;
        R.dialog(c, {
            id: 'avapk', title: `Install APK on ${a.name}`, w: 420, h: 240,
            html: `${R.field('APK file on the server:', R.inp('apk', '', 'placeholder="/srv/rack/artifacts/..."'), true)}${R.field('or a URL:', R.inp('url', '', 'placeholder="https://..."'), true)}<p class="rm-hint">The install runs as a job; see Jobs for its result.</p>`,
            okText: 'Install',
            ok: async (ctx) => {
                const apk = (R.val(ctx, 'apk') || '').trim();
                const url = (R.val(ctx, 'url') || '').trim();
                if (!apk && !url) { R.err(ctx, 'Type a path or a URL.'); return false; }
                await doit(c, n, 'android', 'install', apk ? { name: a.name, apk } : { name: a.name, url });
                return true;
            }
        });
    };
    A['av-shell'] = (c, p, n) => {
        const a = avdOf(c, n);
        if (!a) return;
        R.dialog(c, {
            id: 'avshell', title: `Shell: ${a.name}`, w: 620, h: 420, okText: 'Close', noCancel: true,
            html: `<pre class="rm-pre rm-console" data-rm-out data-mmc-scroll>Type a command and press Enter. It runs as: adb shell &lt;command&gt;\n</pre><div class="rm-row"><input type="text" class="rm-grow" data-rm="cmd" autocomplete="off" spellcheck="false" placeholder="getprop ro.build.version.release"><button type="button" class="btn-standard" data-run>Run</button></div>`,
            init: (ctx) => {
                const q = (s) => ctx.content.querySelector(s);
                const go = async () => {
                    const cmd = (R.val(ctx, 'cmd') || '').trim();
                    if (!cmd) return;
                    q('[data-rm="cmd"]').value = '';
                    const out = q('[data-rm-out]');
                    out.textContent += `\n$ ${cmd}\n`;
                    try { const r = await R.act(n.server, 'android', 'shell', { name: a.name, cmd }); const x = r.result || r; out.textContent += `${x.out || ''}${x.code ? `\n[exit ${x.code}]` : ''}\n`; } catch (e) { out.textContent += `${(e && e.message) || e}\n`; }
                    out.scrollTop = out.scrollHeight;
                };
                q('[data-run]').addEventListener('click', go);
                q('[data-rm="cmd"]').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); void go(); } });
            }
        });
    };
    A['av-sdk'] = (c, p, n) => {
        const d = dataOf(n, 'android');
        const imgs = arr(d.images);
        R.dialog(c, {
            id: 'avsdk', title: 'Install System Image', w: 460, h: 300,
            html: `<p>Choose a system image to download with the SDK manager (a job).</p>${R.field('System image:', R.sel('pkg', imgs.filter((x) => !x.installed).map((x) => x.package)), true)}${imgs.every((x) => x.installed) ? '<p class="rm-hint">Every listed image is installed.</p>' : ''}`,
            okText: 'Install',
            ok: async (ctx) => { const pkg = R.val(ctx, 'pkg'); if (!pkg) { R.err(ctx, 'No image to install.'); return false; } await doit(c, n, 'android', 'sdk', { packages: [pkg] }); return true; }
        });
    };
    /** Runs fn when the job ends well (a pushed job event), once. */
    function afterJob(server, jobId, fn) {
        const hook = (cc, ev) => {
            if (ev.kind !== 'job' || ev.server !== server) return false;
            const j = ev.data && ev.data.id ? ev.data : null;
            if (!j || j.id !== jobId || !j.state || j.state === 'running') return false;
            const i = R.hooks.event.indexOf(hook);
            if (i >= 0) R.hooks.event.splice(i, 1);
            if (j.state === 'done') void fn();
            return false;
        };
        R.hooks.event.push(hook);
    }
    A['av-new'] = (c, p, n) => {
        const d = dataOf(n, 'android');
        const imgs = arr(d.images);
        const devs = ['pixel_fold', 'pixel_7', 'pixel_6a', 'pixel_5', 'medium_phone'];
        R.wizard(c, {
            id: 'avnew', title: 'Create AVD Wizard', icon: '/static_images/vista-dlg/android-runtime-32.png', w: 500, h: 340,
            pages: [
                { key: 'name', instruction: 'Name the device', html: `${R.field('Name:', R.inp('name', ''))}${R.field('Device profile:', R.sel('device', devs, 'pixel_fold'))}${R.field('Memory (MB):', R.inp('ram', 4096))}${R.field('Storage (GB):', R.inp('disk', 16))}`, next: (ctx) => { if (!/^[A-Za-z0-9._-]+$/.test((R.val(ctx, 'name') || '').trim())) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores only.'); return false; } R.err(ctx, ''); return 'img'; } },
                { key: 'img', instruction: 'Choose a system image', nextText: 'Create', finish: true, html: `<div class="rm-isolist rm-tall" data-rm-imgs>${imgs.map((x) => `<label class="rm-isorow"><input type="radio" name="rm-img" value="${esc(x.package)}" data-rm="img:${esc(x.package)}"><span>${esc(x.package)}</span><i>${x.installed ? 'Installed' : 'Will be downloaded first'}</i></label>`).join('') || '<div class="rm-hint">rackd lists no system images.</div>'}</div>` }
            ],
            finish: async (ctx) => {
                const pkg = R.picked(ctx, 'img');
                if (!pkg) { R.err(ctx, 'Choose a system image.'); return false; }
                const params = { name: R.val(ctx, 'name').trim(), image: pkg, device: R.val(ctx, 'device'), ramMB: Number(R.val(ctx, 'ram')), diskGB: Number(R.val(ctx, 'disk')) };
                try {
                    const img = imgs.find((x) => x.package === pkg);
                    if (img && !img.installed) { const r = await doit(c, n, 'android', 'sdk', { packages: [pkg] }); if (r.job) afterJob(n.server, r.job.id, () => doit(c, n, 'android', 'create', params)); } else await doit(c, n, 'android', 'create', params);
                    return true;
                } catch (e) { R.err(ctx, (e && e.message) || 'The device could not be created.'); return false; }
            }
        });
    };

    // ---- Sandboxes ---------------------------------------------------------------------------------------------------

    const PRESETS = { phone: { w: 390, h: 844, dpr: 3, mobile: true, text: 'Phone (390 x 844, 3x)' }, tablet: { w: 820, h: 1180, dpr: 2, mobile: true, text: 'Tablet (820 x 1180, 2x)' }, desktop: { w: 1366, h: 768, dpr: 1, mobile: false, text: 'Desktop (1366 x 768)' } };
    const sbOf = (c, n) => arr(dataOf(n, 'sandboxes').sandboxes).find((s) => s.id === c.sel || s.name === c.sel);
    rolePage('sandboxes', (c, n, d) => {
        const rows = arr(d.sandboxes).map((s) => ({ key: s.id, icon: `${ITEMS}/internet-options-16.png`, data: s }));
        const l = list(c, 'rm-sbx', [
            { t: 'Name', w: 150, key: 'n', text: (s) => s.name },
            { t: 'State', w: 70, key: 's', text: (s) => ({ running: 'Running', stopped: 'Stopped' }[s.state] || s.state) },
            { t: 'URL', w: 230, key: 'u', text: (s) => s.url || '' },
            { t: 'Viewport', w: 120, key: 'v', text: (s) => (s.viewport ? `${s.viewport.w} x ${s.viewport.h}${s.viewport.dpr > 1 ? ` @${s.viewport.dpr}x` : ''}${s.viewport.mobile ? ' mobile' : ''}` : '') },
            { t: 'CDP Port', w: 66, num: true, key: 'p', text: (s) => s.cdpPort || '' },
            { t: 'RAM Disk', w: 66, key: 'r', text: (s) => (s.ramdisk ? 'Yes' : 'No') }
        ], rows, 'There are no sandboxes. Use New Sandbox to make one.');
        const s = sbOf(c, n);
        const b = d.browser || {};
        return c.page('Sandboxes', `${rows.length} sandbox${rows.length === 1 ? '' : 'es'}`, [
            { id: 'sb-list', title: 'Sandboxes', body: R.jobStrip(n) + l },
            { id: 'sb-info', title: 'Browser', body: c.props([['Browser', esc(b.path || 'not found')], ['Version', esc(b.version || '')]]) },
            { id: 'sb-prev', title: s ? `Page: ${s.name}` : 'Page', body: preview(n, 'sandboxes', s && s.id, s ? s.name : '') }
        ]);
    });
    R.commands['role:sandboxes'] = () => [{ text: 'New Sandbox...', action: 'sb-new', icon: `${ITEMS}/internet-options-16.png` }];
    R.selCommands['role:sandboxes'] = (n, key, c) => {
        const s = sbOf(c, n);
        if (!s) return null;
        const on = s.state === 'running';
        return { title: s.name, items: [on ? { text: 'Stop', action: 'sb-op:stop' } : { text: 'Start', action: 'sb-op:start' }, { text: 'Navigate...', action: 'sb-nav', disabled: !on }, { text: 'Take Screenshot', action: 'sb-shot', disabled: !on }, { text: 'Copy CDP Address...', action: 'sb-cdp', disabled: !on }, { separator: true }, { text: 'Delete...', action: 'sb-del' }] };
    };
    A['sb-op'] = async (c, op, n) => { const s = sbOf(c, n); if (s) await run(c, n, 'sandboxes', op, { id: s.id }); };
    A['sb-shot'] = async (c, p, n) => { const s = sbOf(c, n); if (s) await shot(c, n, 'sandboxes', s.id, s.name); };
    A['sb-del'] = async (c, p, n) => {
        const s = sbOf(c, n);
        if (!s) return;
        const a = await R.taskDialog(c, { instruction: `Delete the sandbox ${s.name}?`, text: 'Its profile and everything saved in it are removed.', links: [{ id: 'go', text: 'Delete', danger: true }] });
        if (a === 'go') await run(c, n, 'sandboxes', 'delete', { id: s.id });
    };
    A['sb-nav'] = (c, p, n) => {
        const s = sbOf(c, n);
        if (!s) return;
        R.dialog(c, { id: 'sbnav', title: `Navigate: ${s.name}`, w: 420, h: 170, html: R.field('Address:', R.inp('url', s.url || 'https://'), true), okText: 'Go', ok: async (ctx) => { const url = (R.val(ctx, 'url') || '').trim(); if (!url) { R.err(ctx, 'Type an address.'); return false; } await doit(c, n, 'sandboxes', 'navigate', { id: s.id, url }); return true; } });
    };
    A['sb-cdp'] = async (c, p, n) => {
        const s = sbOf(c, n);
        if (!s) return;
        let r;
        try { r = await R.act(n.server, 'sandboxes', 'cdp', { id: s.id }); } catch (e) { await R.box(c, e.message); return; }
        const x = r.result || r;
        const addr = `ws://127.0.0.1:${x.port}${x.wsPath || ''}`;
        R.dialog(c, {
            id: 'sbcdp', title: `CDP address: ${s.name}`, w: 460, h: 200, okText: 'Close', noCancel: true,
            html: `<p>Dreamscape forwards this port, so tools on the Dreamscape server (Playwright, agents) connect to:</p><div class="rm-row"><input type="text" class="rm-grow" readonly data-rm="addr" value="${esc(addr)}"><button type="button" class="btn-standard" data-copy>Copy</button></div>`,
            init: (ctx) => { const inp0 = ctx.content.querySelector('[data-rm="addr"]'); ctx.content.querySelector('[data-copy]').addEventListener('click', () => { inp0.select(); try { void navigator.clipboard.writeText(addr); } catch (_) { /* selected: Ctrl+C */ } }); }
        });
    };
    A['sb-new'] = (c, p, n) => {
        R.dialog(c, {
            id: 'sbnew', title: 'New Sandbox', w: 440, h: 360,
            html: `${R.field('Name:', R.inp('name', ''))}${R.field('Start address:', R.inp('url', 'about:blank'))}<div class="rm-field is-wide"><span>Viewport</span><div class="rm-radios">${Object.entries(PRESETS).map(([k, v]) => `<label class="rm-check"><input type="radio" name="rm-vp" value="${k}" data-rm="vp:${k}"${k === 'phone' ? ' checked' : ''}> ${esc(v.text)}</label>`).join('')}</div></div>${R.chk('ram', 'Keep the profile on a RAM disk (fast, lost when the server restarts)', true)}`,
            okText: 'Create',
            ok: async (ctx) => {
                const name = (R.val(ctx, 'name') || '').trim();
                if (!name) { R.err(ctx, 'Type a name.'); return false; }
                const vp = PRESETS[R.picked(ctx, 'vp') || 'phone'];
                await doit(c, n, 'sandboxes', 'create', { name, url: (R.val(ctx, 'url') || '').trim() || 'about:blank', viewport: { w: vp.w, h: vp.h, dpr: vp.dpr, mobile: vp.mobile }, ramdisk: !!R.val(ctx, 'ram'), headless: true });
                return true;
            }
        });
    };

    // ---- Containers -------------------------------------------------------------------------------------------------

    const ctOf = (c, n) => arr(dataOf(n, 'containers').containers).find((x) => `c:${x.id}` === c.sel);
    const imOf = (c, n) => arr(dataOf(n, 'containers').images).find((x) => `i:${x.id}` === c.sel);
    const vlOf = (c, n) => arr(dataOf(n, 'containers').volumes).find((x) => `v:${x.name}` === c.sel);
    rolePage('containers', (c, n, d) => {
        const eng = d.engine || {};
        const cl = list(c, 'rm-cts', [
            { t: 'Name', w: 150, key: 'n', text: (x) => x.name },
            { t: 'Image', w: 170, key: 'i', text: (x) => x.image },
            { t: 'State', w: 70, key: 's', text: (x) => (x.state ? x.state[0].toUpperCase() + x.state.slice(1) : '') },
            { t: 'Status', w: 140, key: 'st', text: (x) => x.status || '' },
            { t: 'Ports', w: 160, key: 'p', text: (x) => (Array.isArray(x.ports) ? x.ports.join(', ') : x.ports || '') }
        ], arr(d.containers).map((x) => ({ key: `c:${x.id}`, icon: `${ITEMS}/programs-and-features-16.png`, data: x })), 'There are no containers. Use Run Container to start one.');
        const il = list(c, 'rm-imgs', [
            { t: 'Image', w: 280, key: 't', text: (x) => arr(x.tags).join(', ') || '<none>' },
            { t: 'Size', w: 80, num: true, key: 's', value: (x) => x.sizeB, text: (x) => R.bytes(x.sizeB) },
            { t: 'Created', w: 140, key: 'c', value: (x) => x.createdAt, text: (x) => when(x.createdAt) }
        ], arr(d.images).map((x) => ({ key: `i:${x.id}`, icon: `${ITEMS}/programs-and-features-16.png`, data: x })), 'There are no images.');
        const vl = list(c, 'rm-vols', [
            { t: 'Volume', w: 280, key: 'n', text: (x) => x.name },
            { t: 'Size', w: 80, num: true, key: 's', value: (x) => x.sizeB, text: (x) => (x.sizeB ? R.bytes(x.sizeB) : '') },
            { t: 'Used By', w: 200, key: 'u', text: (x) => arr(x.usedBy).join(', ') }
        ], arr(d.volumes).map((x) => ({ key: `v:${x.name}`, icon: '/static_images/vista-devmgr/volumes-16.png', data: x })), 'There are no volumes.');
        return c.page('Containers', eng.running === false ? 'Docker is not running' : `Docker ${eng.version || ''}`, [
            eng.running === false ? { id: 'ct-warn', title: 'Docker', body: `<p>${c.state(false, 'The Docker engine is not running on this server.', true)}</p>` } : null,
            { id: 'ct-list', title: 'Containers', body: R.jobStrip(n) + cl },
            { id: 'ct-img', title: 'Images', body: il },
            { id: 'ct-vol', title: 'Volumes', body: vl },
            { id: 'ct-eng', title: 'Engine', body: c.props([['Version', esc(eng.version || '')], ['Data root', esc(eng.dataRoot || '')]]) }
        ]);
    });
    R.commands['role:containers'] = () => [{ text: 'Run Container...', action: 'ct-run', icon: `${ITEMS}/programs-and-features-16.png` }, { text: 'Pull Image...', action: 'ct-pull' }, { text: 'Build Image...', action: 'ct-build' }, { text: 'Prune...', action: 'ct-prune' }];
    R.selCommands['role:containers'] = (n, key, c) => {
        const k = String(key);
        if (k.startsWith('c:')) {
            const x = ctOf(c, n);
            if (!x) return null;
            const on = x.state === 'running';
            return { title: x.name, items: [on ? { text: 'Stop', action: 'ct-op:stop' } : { text: 'Start', action: 'ct-op:start' }, { text: 'Restart', action: 'ct-op:restart', disabled: !on }, { text: 'Kill', action: 'ct-op:kill', disabled: !on }, { text: 'Logs...', action: 'ct-logs' }, { text: 'Exec...', action: 'ct-exec', disabled: !on }, { separator: true }, { text: 'Remove...', action: 'ct-rm' }] };
        }
        if (k.startsWith('i:')) { const x = imOf(c, n); return x ? { title: arr(x.tags)[0] || x.id, items: [{ text: 'Remove Image...', action: 'ct-imrm' }] } : null; }
        if (k.startsWith('v:')) { const x = vlOf(c, n); return x ? { title: x.name, items: [{ text: 'Remove Volume...', action: 'ct-vlrm', disabled: arr(x.usedBy).length > 0 }] } : null; }
        return null;
    };
    A['ct-op'] = async (c, op, n) => { const x = ctOf(c, n); if (!x) return; if (op === 'kill') { const a = await R.taskDialog(c, { instruction: `Kill ${x.name}?`, text: 'The container is stopped at once, without a clean shutdown.', links: [{ id: 'go', text: 'Kill', danger: true }] }); if (a !== 'go') return; } await run(c, n, 'containers', op, { id: x.id }); };
    A['ct-rm'] = async (c, p, n) => { const x = ctOf(c, n); if (!x) return; const a = await R.taskDialog(c, { instruction: `Remove the container ${x.name}?`, text: 'The container and its writable layer are deleted.', links: [{ id: 'go', text: 'Remove', danger: true }] }); if (a === 'go') await run(c, n, 'containers', 'remove', { id: x.id }); };
    A['ct-imrm'] = async (c, p, n) => { const x = imOf(c, n); if (!x) return; const a = await R.taskDialog(c, { instruction: `Remove the image ${arr(x.tags)[0] || x.id}?`, links: [{ id: 'go', text: 'Remove', danger: true }] }); if (a === 'go') await run(c, n, 'containers', 'image-remove', { id: x.id }); };
    A['ct-vlrm'] = async (c, p, n) => { const x = vlOf(c, n); if (!x) return; const a = await R.taskDialog(c, { instruction: `Remove the volume ${x.name}?`, text: 'Its data is deleted.', links: [{ id: 'go', text: 'Remove', danger: true }] }); if (a === 'go') await run(c, n, 'containers', 'volume-remove', { name: x.name }); };
    A['ct-logs'] = async (c, p, n) => {
        const x = ctOf(c, n);
        if (!x) return;
        const read = async () => { try { const r = await R.act(n.server, 'containers', 'logs', { id: x.id, lines: 500 }); return (r.result || r).text || ''; } catch (e) { return `The log could not be read: ${(e && e.message) || e}`; } };
        const text = await read();
        R.dialog(c, {
            id: 'ctlogs', title: `Logs: ${x.name}`, w: 680, h: 440, okText: 'Close', noCancel: true,
            html: `<pre class="rm-pre rm-console" data-rm-out data-mmc-scroll>${esc(text)}</pre><div class="rm-row"><button type="button" class="btn-standard" data-refresh>Refresh</button></div>`,
            init: (ctx) => { const out = ctx.content.querySelector('[data-rm-out]'); out.scrollTop = out.scrollHeight; ctx.content.querySelector('[data-refresh]').addEventListener('click', async () => { out.textContent = await read(); out.scrollTop = out.scrollHeight; }); }
        });
    };
    A['ct-exec'] = (c, p, n) => {
        const x = ctOf(c, n);
        if (!x) return;
        R.dialog(c, {
            id: 'ctexec', title: `Exec: ${x.name}`, w: 620, h: 400, okText: 'Close', noCancel: true,
            html: '<pre class="rm-pre rm-console" data-rm-out data-mmc-scroll>Type a command and press Enter.\n</pre><div class="rm-row"><input type="text" class="rm-grow" data-rm="cmd" autocomplete="off" spellcheck="false"><button type="button" class="btn-standard" data-run>Run</button></div>',
            init: (ctx) => {
                const q = (s) => ctx.content.querySelector(s);
                const go = async () => { const cmd = (R.val(ctx, 'cmd') || '').trim(); if (!cmd) return; q('[data-rm="cmd"]').value = ''; const out = q('[data-rm-out]'); out.textContent += `\n$ ${cmd}\n`; try { const r = await R.act(n.server, 'containers', 'exec', { id: x.id, cmd }); const y = r.result || r; out.textContent += `${y.out || ''}${y.code ? `\n[exit ${y.code}]` : ''}\n`; } catch (e) { out.textContent += `${(e && e.message) || e}\n`; } out.scrollTop = out.scrollHeight; };
                q('[data-run]').addEventListener('click', go);
                q('[data-rm="cmd"]').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); void go(); } });
            }
        });
    };
    A['ct-pull'] = (c, p, n) => R.dialog(c, { id: 'ctpull', title: 'Pull Image', w: 400, h: 170, html: R.field('Image:', R.inp('image', '', 'placeholder="debian:13"'), true), okText: 'Pull', ok: async (ctx) => { const image = (R.val(ctx, 'image') || '').trim(); if (!image) { R.err(ctx, 'Type an image name.'); return false; } await doit(c, n, 'containers', 'pull', { image }); return true; } });
    A['ct-build'] = (c, p, n) => R.dialog(c, {
        id: 'ctbuild', title: 'Build Image', w: 440, h: 270,
        html: `${R.field('Tag:', R.inp('tag', '', 'placeholder="myimage:latest"'), true)}${R.field('Build context (folder on the server):', R.inp('context', ''), true)}${R.field('Dockerfile (optional):', R.inp('dockerfile', ''), true)}`,
        okText: 'Build',
        ok: async (ctx) => { const tag = (R.val(ctx, 'tag') || '').trim(); const context = (R.val(ctx, 'context') || '').trim(); if (!tag || !context) { R.err(ctx, 'Type a tag and a build context.'); return false; } const df = (R.val(ctx, 'dockerfile') || '').trim(); await doit(c, n, 'containers', 'build', Object.assign({ tag, context }, df ? { dockerfile: df } : {})); return true; }
    });
    A['ct-prune'] = async (c, p, n) => {
        const a = await R.taskDialog(c, { instruction: 'What do you want to prune?', text: 'Pruning permanently deletes what it finds. It cannot be undone.', h: 300, links: [{ id: 'containers', text: 'Stopped containers', danger: true }, { id: 'images', text: 'Unused images', danger: true }, { id: 'volumes', text: 'Unused volumes', sub: 'Their data is lost.', danger: true }, { id: 'builder', text: 'Build cache', danger: true }] });
        if (a) await run(c, n, 'containers', 'prune', { what: a, confirm: true });
    };
    A['ct-run'] = (c, p, n) => {
        const imgs = arr(dataOf(n, 'containers').images).flatMap((x) => arr(x.tags));
        R.wizard(c, {
            id: 'ctrun', title: 'Run Container Wizard', icon: `${ITEMS}/programs-and-features-32.png`, w: 500, h: 330,
            pages: [
                { key: 'what', instruction: 'Choose an image', html: `${R.field('Name:', R.inp('name', ''))}${R.field('Image:', imgs.length ? R.sel('image', imgs, imgs[0]) : R.inp('image', ''))}${R.field('Command (optional):', R.inp('cmd', ''), true)}${imgs.length ? '' : '<p class="rm-hint">There are no images yet: use Pull Image first, or type a name to pull when it runs.</p>'}`, next: (ctx) => { if (!(R.val(ctx, 'image') || '').trim()) { R.err(ctx, 'Type an image.'); return false; } R.err(ctx, ''); return 'opts'; } },
                { key: 'opts', instruction: 'Ports, folders and limits', nextText: 'Run', finish: true, html: `${R.field('Ports (host:container, comma separated):', R.inp('ports', ''), true)}${R.field('Folders (host:container, comma separated):', R.inp('mounts', ''), true)}${R.field('Environment (NAME=value, comma separated):', R.inp('env', ''), true)}${R.field('Processors:', R.inp('cpus', ''))}${R.field('Memory (GB):', R.inp('memGB', ''))}` }
            ],
            finish: async (ctx) => {
                const split = (k) => (R.val(ctx, k) || '').split(',').map((s) => s.trim()).filter(Boolean);
                const params = { name: (R.val(ctx, 'name') || '').trim() || undefined, image: R.val(ctx, 'image').trim() };
                const cmd = (R.val(ctx, 'cmd') || '').trim();
                if (cmd) params.cmd = cmd;
                if (split('ports').length) params.ports = split('ports');
                if (split('mounts').length) params.mounts = split('mounts');
                if (split('env').length) params.env = Object.fromEntries(split('env').map((e) => { const i = e.indexOf('='); return i < 0 ? [e, ''] : [e.slice(0, i), e.slice(i + 1)]; }));
                if (Number(R.val(ctx, 'cpus')) > 0) params.cpus = Number(R.val(ctx, 'cpus'));
                if (Number(R.val(ctx, 'memGB')) > 0) params.memGB = Number(R.val(ctx, 'memGB'));
                try { await doit(c, n, 'containers', 'run', params); return true; } catch (e) { R.err(ctx, (e && e.message) || 'The container could not be started.'); return false; }
            }
        });
    };

    // ---- Builds ----------------------------------------------------------------------------------------------------------

    const RUN_STATE = { running: 'Running', done: 'Succeeded', success: 'Succeeded', passed: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled', queued: 'Queued' };
    const pipeOf = (c, n) => arr(dataOf(n, 'builds').pipelines).find((p) => `p:${p.id}` === c.sel);
    const runOf = (c, n) => arr(dataOf(n, 'builds').runs).find((r) => `r:${r.id}` === c.sel);
    const RUNLOG = new Map(); // 'server:runId' -> { text, error }
    async function readRun(c, n, id) {
        try { const r = await R.act(n.server, 'builds', 'run-get', { run: id, tail: 300 }); const x = r.result || r; RUNLOG.set(`${n.server}:${id}`, { text: Array.isArray(x.log) ? x.log.join('\n') : (x.log || ''), rec: x }); } catch (e) { RUNLOG.set(`${n.server}:${id}`, { text: '', error: (e && e.message) || 'The log could not be read.' }); }
        R.repaint(c);
    }
    R.hooks.row.push((key, n, c) => { if (n.kind === 'role' && n.role === 'builds' && String(key).startsWith('r:')) void readRun(c, n, String(key).slice(2)); else if (n.kind === 'role' && n.role === 'builds') R.repaint(c); });
    // a build's log is pushed as job events (the job id is the run id)
    R.hooks.event.push((c, ev) => {
        if (ev.kind !== 'job') return false;
        const n = R.here(c);
        if (n.kind !== 'role' || n.role !== 'builds' || n.server !== ev.server) return false;
        const j = ev.data && ev.data.id ? ev.data : null;
        if (j && c.sel === `r:${j.id}`) { if (j.log) RUNLOG.set(`${ev.server}:${j.id}`, { text: Array.isArray(j.log) ? j.log.join('\n') : j.log }); R.repaint(c); }
        return false;
    });
    const runDur = (r) => (r.startedAt ? R.dur(((r.endedAt || Date.now()) - r.startedAt) / 1000) : '');

    rolePage('builds', (c, n, d) => {
        const pl = list(c, 'rm-pipes', [
            { t: 'Name', w: 160, key: 'n', text: (p) => p.name || p.id },
            { t: 'Repository', w: 200, key: 'r', text: (p) => p.repo || '' },
            { t: 'Ref', w: 90, key: 'f', text: (p) => p.ref || '' },
            { t: 'Last Run', w: 130, key: 'l', text: (p) => (p.lastRun ? `${RUN_STATE[p.lastRun.state] || p.lastRun.state} ${when(p.lastRun.startedAt)}` : 'Never') }
        ], arr(d.pipelines).map((p) => ({ key: `p:${p.id}`, icon: `${ITEMS}/backup-and-restore-center-16.png`, data: p })), 'There are no pipelines. Use New Pipeline to define one.');
        const runs = arr(d.runs);
        const rl = list(c, 'rm-runs', [
            { t: 'Run', w: 130, key: 'i', text: (r) => r.id },
            { t: 'Pipeline', w: 110, key: 'p', text: (r) => r.pipeline },
            { t: 'Ref', w: 80, key: 'f', text: (r) => r.ref || '' },
            { t: 'Commit', w: 66, key: 'c', text: (r) => String(r.commit || '').slice(0, 8) },
            { t: 'State', w: 76, key: 's', text: (r) => RUN_STATE[r.state] || r.state },
            { t: 'Started', w: 130, key: 'a', value: (r) => r.startedAt, text: (r) => when(r.startedAt) },
            { t: 'Duration', w: 80, key: 'd', text: runDur },
            { t: 'By', w: 70, key: 'b', text: (r) => r.by || '' },
            { t: 'Artifacts', w: 56, num: true, key: 'x', text: (r) => arr(r.artifacts).length || '' }
        ], runs.map((r) => ({ key: `r:${r.id}`, icon: `${ITEMS}/sync-center-16.png`, data: r })), 'There are no runs yet. Select a pipeline and choose Run.', { sort: { key: 'a', dir: -1 } });
        const r = runOf(c, n);
        let detail = '<p class="mmc-hint">Select a run to see its log and artifacts.</p>';
        if (r) {
            const lg = RUNLOG.get(`${n.server}:${r.id}`);
            const jobLog = n.ss.jobs.find((j) => j.id === r.id);
            const text = (jobLog && jobLog.log ? (Array.isArray(jobLog.log) ? jobLog.log.join('\n') : jobLog.log) : '') || (lg && lg.text) || '';
            const arts = arr(r.artifacts);
            detail = c.props([['State', esc(RUN_STATE[r.state] || r.state)], ['Commit', esc(r.commit || '')], ['Exit code', r.exitCode == null ? '' : String(r.exitCode)]])
                + (arts.length ? `<p><b>Artifacts</b></p><ul class="rm-arts">${arts.map((a) => `<li><a href="/rack/${encodeURIComponent(n.server)}/files/artifacts/${encodeURIComponent(r.id)}/${encodeURIComponent(a.name)}" download="${esc(a.name)}">${esc(a.name)}</a> <span class="mmc-hint">${R.bytes(a.sizeB)}</span></li>`).join('')}</ul>` : '')
                + (lg && lg.error && !text ? `<p>${c.state(false, lg.error)}</p>` : R.pre(text || (r.state === 'running' ? 'Waiting for output...' : 'The log is empty.')));
        }
        return c.page('Builds', `${arr(d.pipelines).length} pipelines, ${runs.length} runs`, [
            { id: 'bd-pipes', title: 'Pipelines', body: R.jobStrip(n) + pl },
            { id: 'bd-runs', title: 'Runs', body: rl },
            { id: 'bd-log', title: r ? `Run ${r.id}` : 'Log and Artifacts', body: detail }
        ]);
    });
    R.commands['role:builds'] = () => [{ text: 'New Pipeline...', action: 'bd-new', icon: `${ITEMS}/backup-and-restore-center-16.png` }];
    R.selCommands['role:builds'] = (n, key, c) => {
        const k = String(key);
        if (k.startsWith('p:')) { const p = pipeOf(c, n); return p ? { title: p.name || p.id, items: [{ text: 'Run...', action: 'bd-run' }, { text: 'Edit Pipeline...', action: 'bd-edit' }, { text: 'Delete Pipeline...', action: 'bd-del' }] } : null; }
        if (k.startsWith('r:')) { const r = runOf(c, n); return r ? { title: r.id, items: [{ text: 'Cancel Run', action: 'bd-cancel', disabled: r.state !== 'running' }, { text: 'Delete Artifacts...', action: 'bd-artrm', disabled: !arr(r.artifacts).length }] } : null; }
        return null;
    };
    A['bd-run'] = (c, p, n) => {
        const pl = pipeOf(c, n);
        if (!pl) return;
        R.dialog(c, { id: 'bdrun', title: `Run ${pl.name || pl.id}`, w: 400, h: 190, html: `${R.field('Branch, tag or commit:', R.inp('ref', pl.ref || 'main'), true)}<p class="rm-hint">The source is fetched and cleaned, then built in a fresh container.</p>`, okText: 'Run', ok: async (ctx) => { await doit(c, n, 'builds', 'run', { pipeline: pl.id, ref: (R.val(ctx, 'ref') || '').trim() || undefined, by: 'rack-manager' }); return true; } });
    };
    A['bd-cancel'] = async (c, p, n) => { const r = runOf(c, n); if (r) await run(c, n, 'builds', 'cancel', { run: r.id }); };
    A['bd-artrm'] = async (c, p, n) => { const r = runOf(c, n); if (!r) return; const a = await R.taskDialog(c, { instruction: `Delete the artifacts of run ${r.id}?`, text: 'The built files are removed from the server. The run record and its log stay.', links: [{ id: 'go', text: 'Delete Artifacts', danger: true }] }); if (a === 'go') await run(c, n, 'builds', 'artifact-remove', { run: r.id }); };
    A['bd-del'] = async (c, p, n) => { const pl = pipeOf(c, n); if (!pl) return; const a = await R.taskDialog(c, { instruction: `Delete the pipeline ${pl.name || pl.id}?`, text: 'The definition is removed. Earlier runs and artifacts stay.', links: [{ id: 'go', text: 'Delete Pipeline', danger: true }] }); if (a === 'go') await run(c, n, 'builds', 'pipeline-delete', { id: pl.id }); };
    A['bd-new'] = (c, p, n) => pipelineWizard(c, n, null);
    A['bd-edit'] = (c, p, n) => { const pl = pipeOf(c, n); if (pl) pipelineWizard(c, n, pl); };
    function pipelineWizard(c, n, p0) {
        const v = (k, d) => (p0 && p0[k] != null ? p0[k] : d);
        R.wizard(c, {
            id: 'bdpipe', title: p0 ? 'Edit Pipeline Wizard' : 'New Pipeline Wizard', icon: `${ITEMS}/backup-and-restore-center-32.png`, w: 520, h: 340,
            pages: [
                { key: 'src', instruction: 'Name the pipeline and its source', html: `${R.field('Id:', R.inp('id', v('id', ''), p0 ? 'readonly' : ''))}${R.field('Name:', R.inp('name', v('name', '')))}${R.field('Repository (git URL):', R.inp('repo', v('repo', '')), true)}${R.field('Default ref:', R.inp('ref', v('ref', 'main')))}`, next: (ctx) => { if (!/^[a-z0-9][a-z0-9-]*$/.test((R.val(ctx, 'id') || '').trim()) || !(R.val(ctx, 'repo') || '').trim()) { R.err(ctx, 'Type an id (lower case letters, digits, dashes) and a repository.'); return false; } R.err(ctx, ''); return 'env'; } },
                { key: 'env', instruction: 'The build environment', html: `${R.field('Image (existing):', R.inp('image', v('image', 'debian:13')), true)}${R.field('Processors:', R.inp('cpus', v('cpus', '')))}${R.field('Memory (GB):', R.inp('memGB', v('memGB', '')))}${R.field('Cache on a RAM disk (GB, 0 = off):', R.inp('cacheRam', v('cacheRamdisk', 0)))}${R.field('Time limit (minutes):', R.inp('timeout', v('timeoutMin', '')))}`, next: () => 'script' },
                { key: 'script', instruction: 'What the build runs', nextText: 'Save', finish: true, html: `<label class="rm-field is-wide"><span>Script (shell, runs in the source folder):</span><textarea data-rm="script" class="rm-textarea" rows="5" spellcheck="false">${esc(v('script', './gradlew assembleDebug'))}</textarea></label>${R.field('Artifacts (globs, comma separated):', R.inp('arts', arr(v('artifacts', [])).join(', ')), true)}` }
            ],
            finish: async (ctx) => {
                const num = (k) => (Number(R.val(ctx, k)) > 0 ? Number(R.val(ctx, k)) : undefined);
                const params = { id: R.val(ctx, 'id').trim(), name: (R.val(ctx, 'name') || '').trim() || R.val(ctx, 'id').trim(), repo: R.val(ctx, 'repo').trim(), ref: (R.val(ctx, 'ref') || 'main').trim(), image: (R.val(ctx, 'image') || '').trim(), script: R.val(ctx, 'script'), artifacts: (R.val(ctx, 'arts') || '').split(',').map((s) => s.trim()).filter(Boolean), cpus: num('cpus'), memGB: num('memGB'), cacheRamdisk: num('cacheRam'), timeoutMin: num('timeout') };
                if (!params.script.trim()) { R.err(ctx, 'Type the script the build runs.'); return false; }
                try { await doit(c, n, 'builds', 'pipeline-define', params); return true; } catch (e) { R.err(ctx, (e && e.message) || 'The pipeline could not be saved.'); return false; }
            }
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
