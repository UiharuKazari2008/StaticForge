/**
 * Rack Manager, virtual machines: the Settings window (Hyper-V's settings dialog: hardware and management pages on the left, the page on
 * the right). Firmware (boot order, Secure Boot), Security (TPM), Memory (startup, dynamic), Processor, drives (hard drives, DVD drive,
 * add / expand / remove), Network Adapter, Integration (guest agent), Name, Automatic Start / Stop. OK applies what changed through the
 * rackd vms actions (set, firmware, nic, cdrom, disk-attach, disk-resize, disk-detach); settings that need the machine off are disabled while it
 * runs and say so. Part of window.mmcRack: R.vmSettings(c, server, name, { page }).
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc, ITEMS, VI } = R;
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const res = (r) => (r && r.result !== undefined ? r.result : r) || {};
    const CPUS = ['host-passthrough', 'host-model', 'Westmere', 'Nehalem', 'SandyBridge', 'IvyBridge', 'Haswell', 'Broadwell', 'Skylake-Client', 'Cascadelake-Server', 'EPYC'];
    const BUS_NAME = { virtio: 'VirtIO', scsi: 'SCSI', sata: 'SATA' };
    const BOOT_NAME = { disk: 'Hard Drive', cdrom: 'DVD Drive', network: 'Network Adapter' };
    const GB = (b) => `${(Number(b) / 2 ** 30).toFixed(Number(b) / 2 ** 30 >= 10 ? 0 : 1)} GB`;
    const OFFHINT = '<p class="rm-hint rm-offhint">The virtual machine must be turned off to change these settings.</p>';

    const dis = (html, on) => (on ? html.replace(/<(input|select)\b/g, '<$1 disabled') : html);
    const radio = (name, value, text, on, off) => `<label class="rm-check"><input type="radio" name="rm-${name}" data-rm="${name}" value="${value}"${on ? ' checked' : ''}${off ? ' disabled' : ''}> ${text}</label>`;

    R.vmSettings = async function vmSettings(c, server, name, opts) {
        try { await R.loadRole(c, server, 'vms', true); } catch (_) { /* the cached data is used */ }
        const d = (R.ss(server).roles.vms && R.ss(server).roles.vms.data) || {};
        const v = arr(d.vms).find((x) => x.name === name);
        if (!v) { await R.box(c, 'That virtual machine is gone.'); return null; }
        const run = v.state !== 'shut off';
        const uefi = !!(v.firmware && v.firmware.uefi);
        const nets = arr(d.networks).map((x) => x.name || x);
        if (!nets.includes('br0')) nets.unshift('br0');
        let isos = [];
        try { isos = arr(res(await R.act(server, 'vms', 'iso-list')).isos); } catch (_) { /* no list: the DVD page says so */ }
        const disks = arr(v.disks);
        const cds = arr(v.cdroms);
        const nics = arr(v.nics);
        const present = (k) => (k === 'disk' ? disks.length : k === 'cdrom' ? cds.length : nics.length);
        const boot = arr(v.firmware && v.firmware.boot).filter(present).filter((k, i, a) => a.indexOf(k) === i);
        ['disk', 'cdrom', 'network'].forEach((k) => { if (present(k) && !boot.includes(k)) boot.push(k); });
        const cpuModels = CPUS.includes(v.cpuModel) || !v.cpuModel ? CPUS : [v.cpuModel].concat(CPUS);
        const buses = ['virtio', 'scsi', 'sata'].filter((b) => disks.some((x) => x.bus === b) || cds.some((x) => x.bus === b));

        const pages = [];
        const page = (id, group, title, icon, html) => pages.push({ id, group, title, icon, html });
        page('add', 'Hardware', 'Add Hardware', `${ITEMS}/add-hardware-16.png`, `<p>Add a device to <b>${esc(v.name)}</b>.</p><div class="rm-row">${R.btnHtml('set-add', 'Hard Drive...', 'hd')}${R.btnHtml('set-add', 'DVD Drive', 'dvd')}${R.btnHtml('set-add', 'Network Adapter', 'nic')}</div><p class="rm-hint">A SATA drive or a DVD drive can only be added while the machine is off; VirtIO and SCSI drives and network adapters are added to a stopped machine here.</p>`);
        page('firmware', 'Hardware', 'Firmware', `${ITEMS}/system-16.png`, `${run ? OFFHINT : ''}<p>Generation <b>${uefi ? '2 (UEFI)' : '1 (BIOS)'}</b>.</p><div class="rm-field is-wide"><span>Startup order:</span><div class="rm-boot" data-rm-boot>${boot.map((k) => `<div class="rm-bootrow" data-boot="${k}"><span>${BOOT_NAME[k]}</span></div>`).join('')}</div></div><div class="rm-row">${R.btnHtml('set-boot', 'Move Up', 'up', run ? ' disabled' : '')}${R.btnHtml('set-boot', 'Move Down', 'down', run ? ' disabled' : '')}</div>${dis(R.chk('sb', 'Enable Secure Boot', !!(v.firmware && v.firmware.secureBoot)), run || !uefi)}${uefi ? '<p class="rm-hint">Changing Secure Boot resets the firmware variables of the machine.</p>' : '<p class="rm-hint">Secure Boot needs a generation 2 machine.</p>'}`);
        page('security', 'Hardware', 'Security', `${VI}/cardspace-16.png`, `${run ? OFFHINT : ''}${dis(R.chk('tpm', 'Enable Trusted Platform Module (a virtual TPM 2.0)', !!(v.firmware && v.firmware.tpm)), run || !uefi)}${uefi ? '' : '<p class="rm-hint">A TPM needs a generation 2 machine.</p>'}`);
        page('memory', 'Hardware', 'Memory', `${ITEMS}/system-16.png`, `${run ? OFFHINT : ''}${R.field('Startup RAM (MB):', dis(R.inp('mem', v.memMB), run))}${dis(R.chk('dyn', 'Enable dynamic memory', !!v.dynamicMemory), run)}${R.field('Maximum RAM (MB):', dis(R.inp('memmax', v.memMaxMB || v.memMB), run))}<p class="rm-hint">With dynamic memory the guest starts with the startup RAM and its balloon driver can grow up to the maximum.</p>`);
        page('cpu', 'Hardware', 'Processor', `${ITEMS}/system-16.png`, `${run ? OFFHINT : ''}${R.field('Number of virtual processors:', dis(R.inp('vcpus', v.vcpus), run))}${R.field('Processor model:', dis(R.sel('cpumodel', cpuModels, v.cpuModel || 'host-passthrough'), run))}<p class="rm-hint">host-passthrough gives the guest the host's processor features; a named model hides newer ones.</p>`);
        buses.forEach((b) => page(`bus-${b}`, 'Hardware', `${BUS_NAME[b]} Controller`, `${ITEMS}/system-16.png`, `<p>Drives on this controller:</p><div class="rm-isolist">${disks.filter((x) => x.bus === b).map((x) => `<div class="rm-isorow"><span>Hard Drive ${esc(x.target)}</span><i>${x.sizeB ? esc(GB(x.sizeB)) : ''}</i></div>`).concat(cds.filter((x) => x.bus === b).map((x) => `<div class="rm-isorow"><span>DVD Drive ${esc(x.target)}</span><i>${esc((x.source || 'empty').split('/').pop())}</i></div>`)).join('') || '<div class="rm-hint">No drives.</div>'}</div><div class="rm-row">${R.btnHtml('set-add', 'Add Hard Drive...', 'hd')}</div>`));
        disks.forEach((x, i) => page(`hd-${i}`, 'Hardware', `Hard Drive (${x.target})`, `${ITEMS}/system-16.png`, `${R.field('Controller:', `<b>${esc(BUS_NAME[x.bus] || x.bus || '')} (${esc(x.target)})</b>`)}${R.field('File:', `<b class="rm-wrap">${esc(x.source || '')}</b>`)}${R.field('Format:', `<b>${esc(x.format || '')}</b>`)}${R.field('Size:', `<b>${x.sizeB ? esc(GB(x.sizeB)) : 'unknown'}</b>`)}${R.field('Expand to (GB):', R.inp(`grow-${x.target}`, x.sizeB ? Math.ceil(x.sizeB / 2 ** 30) + 1 : ''))}<div class="rm-row">${R.btnHtml('set-grow', 'Expand', x.target)}${R.btnHtml('set-rmdisk', 'Remove...', x.target)}</div><p class="rm-hint">A disk can only grow. The file system inside the guest has to be extended afterwards.</p>`));
        cds.forEach((x, i) => page(`dvd-${i}`, 'Hardware', `DVD Drive (${x.target})`, `${ITEMS}/autoplay-16.png`, `<p>Media:</p>${radio(`dvd${i}`, 'none', 'None', !x.source)}${radio(`dvd${i}`, 'iso', 'Image file from the server\'s ISO pool:', !!x.source)}${R.sel(`dviso${i}`, [{ value: '', text: '(none)' }].concat(isos.map((o) => ({ value: o.path, text: o.name }))), x.source || '')}<p class="rm-hint">${esc(x.source ? `Now: ${x.source}` : 'The drive is empty.')} Images are added with ISO Images... in the Action pane.</p>`));
        nics.forEach((x, i) => page(`nic-${i}`, 'Hardware', `Network Adapter${nics.length > 1 ? ` ${i + 1}` : ''}`, `${VI}/net-internet-16.png`, `${run ? OFFHINT : ''}${R.field('Connection:', dis(R.sel(`net${i}`, nets, x.network || 'br0'), run))}${R.field('MAC address:', dis(R.inp(`mac${i}`, x.mac), run))}${R.field('Adapter model:', dis(R.sel(`nicmodel${i}`, ['virtio', 'e1000e', 'e1000', 'rtl8139'], x.model || 'virtio'), run))}<div class="rm-row">${R.btnHtml('set-link', 'Disconnect Cable', `${i}:down`, run ? '' : ' disabled')}${R.btnHtml('set-link', 'Connect Cable', `${i}:up`, run ? '' : ' disabled')}${R.btnHtml('set-rmnic', 'Remove...', String(i), run ? ' disabled' : '')}</div>${R.field('Address:', `<b>${esc(x.ip || (run ? 'not reported' : ''))}</b>`)}`));
        page('name', 'Management', 'Name', `${ITEMS}/system-16.png`, `${run ? OFFHINT : ''}${R.field('Name:', dis(R.inp('newname', v.name), run))}`);
        const missing = arr(v.manageable && v.manageable.missing);
        page('integ', 'Management', 'Integration Services', `${ITEMS}/administrative-tools-16.png`, `${R.field('Guest system:', R.sel('guest', [{ value: '', text: '(not set)' }, { value: 'linux', text: 'Linux' }, { value: 'windows', text: 'Windows' }, { value: 'other', text: 'Other' }], (v.tags && v.tags.guest) || ''))}${dis(R.chk('agent', 'QEMU guest agent channel (shutdown, address, files, commands without the network)', !!v.agentChannel), v.agentChannel || run)}<dl class="mmc-props"><dt>Guest agent:</dt><dd>${esc(!v.agentChannel ? 'No channel' : run ? (missing.includes('guest-agent') ? 'Not answering (install and start qemu-guest-agent in the guest)' : 'Answering') : 'The machine is off')}</dd><dt>In-guest agent:</dt><dd>${esc(v.vmAgent ? 'Registered' : 'Not registered')}</dd><dt>Managed:</dt><dd>${esc(v.manageable && v.manageable.ok ? 'Yes, fully' : (v.manageable && v.manageable.managed ? 'Needs attention' : 'No (adopt it)'))}</dd></dl>`);
        page('start', 'Management', 'Automatic Start Action', `${ITEMS}/power-options-16.png`, `${R.chk('auto', 'Start this machine when the server starts', !!v.autostart)}`);
        page('stop', 'Management', 'Automatic Stop Action', `${ITEMS}/power-options-16.png`, `<p>When the server shuts down:</p>${radio('stop', 'save', 'Save the virtual machine state', v.stopAction === 'save')}${radio('stop', 'off', 'Turn off the virtual machine', v.stopAction === 'off')}${radio('stop', 'shutdown', 'Shut down the guest operating system', !v.stopAction || v.stopAction === 'shutdown')}`);

        const nav = ['Hardware', 'Management'].map((g) => `<div class="rm-set-grp">${g}</div>${pages.filter((p) => p.group === g).map((p) => `<div class="rm-set-item" data-pg="${p.id}"><img src="${p.icon}" alt="">${esc(p.title)}</div>`).join('')}`).join('');
        const first = (opts && opts.page && pages.some((p) => p.id === opts.page)) ? opts.page : 'firmware';
        return R.dialog(c, {
            id: `vmset-${name}`, title: `Settings for ${name}`, w: 720, h: 520, okText: 'OK',
            html: `<div class="rm-set"><div class="rm-set-nav">${nav}</div><div class="rm-set-body">${pages.map((p) => `<div class="rm-set-page" data-page="${p.id}" hidden><div class="rm-set-title">${esc(p.title)}</div>${p.html}</div>`).join('')}</div></div>`,
            init: (ctx) => {
                const q = (s) => ctx.content.querySelector(s);
                const show = (id) => { ctx.content.querySelectorAll('.rm-set-page').forEach((p) => { p.hidden = p.dataset.page !== id; }); ctx.content.querySelectorAll('.rm-set-item').forEach((i) => i.classList.toggle('is-on', i.dataset.pg === id)); };
                show(first);
                // an immediate change (add / remove / expand): the window is made again from the new data, on the same page
                const again = async (pg) => { ctx.close(); try { await R.loadRole(c, server, 'vms', true); } catch (_) { /* cached */ } void vmSettings(c, server, name, { page: pg }); };
                const imm = async (fn, pg) => { R.err(ctx, ''); try { await fn(); } catch (e) { R.err(ctx, (e && e.message) || 'The change failed.'); return; } await again(pg); };
                const cur = () => (q('.rm-set-page:not([hidden])') || {}).dataset.page;
                ctx.content.addEventListener('click', async (ev) => {
                    const item = ev.target.closest('[data-pg]');
                    if (item) { show(item.dataset.pg); return; }
                    const bt = ev.target.closest('[data-act]');
                    if (!bt) return;
                    ev.stopPropagation();
                    const a = bt.dataset.act;
                    const arg = bt.dataset.arg;
                    if (a === 'set-boot') {
                        const list = q('[data-rm-boot]');
                        const sel = list.querySelector('.is-selected') || list.firstElementChild;
                        if (!sel) return;
                        if (arg === 'up' && sel.previousElementSibling) list.insertBefore(sel, sel.previousElementSibling);
                        if (arg === 'down' && sel.nextElementSibling) list.insertBefore(sel.nextElementSibling, sel);
                        sel.classList.add('is-selected');
                    } else if (a === 'set-add') {
                        if (arg === 'dvd') await imm(() => R.act(server, 'vms', 'cdrom', { name, add: true }), 'add');
                        else if (arg === 'nic') await imm(() => R.act(server, 'vms', 'nic', { name, op: 'add' }), 'add');
                        else addDisk();
                    } else if (a === 'set-grow') {
                        const gb = Number(R.val(ctx, `grow-${arg}`));
                        if (!(gb > 0)) { R.err(ctx, 'Type the new size in GB.'); return; }
                        await imm(() => R.act(server, 'vms', 'disk-resize', { name, target: arg, sizeGB: gb }), cur());
                    } else if (a === 'set-rmdisk') {
                        const r = await R.taskDialog(c, { instruction: `Remove the hard drive ${arg}?`, text: 'The drive is detached from the machine. Its file stays on the server unless you delete it too.', links: [{ id: 'del', text: 'Remove the drive and delete its file', danger: true }, { id: 'keep', text: 'Remove the drive, keep the file' }] });
                        if (r) await imm(() => R.act(server, 'vms', 'disk-detach', { name, target: arg, delete: r === 'del' }), 'add');
                    } else if (a === 'set-rmnic') {
                        const r = await R.taskDialog(c, { instruction: 'Remove this network adapter?', links: [{ id: 'go', text: 'Remove', danger: true }] });
                        if (r === 'go') await imm(() => R.act(server, 'vms', 'nic', { name, op: 'remove', index: Number(arg) }), 'add');
                    } else if (a === 'set-link') {
                        const [i, st] = String(arg).split(':');
                        await imm(() => R.act(server, 'vms', 'nic', { name, index: Number(i), link: st }), cur());
                    }
                });
                q('[data-rm-boot]').addEventListener('click', (ev) => { const r = ev.target.closest('.rm-bootrow'); if (!r) return; q('[data-rm-boot]').querySelectorAll('.rm-bootrow').forEach((x) => x.classList.toggle('is-selected', x === r)); });
                const addDisk = () => {
                    R.dialog(c, {
                        id: 'vmadddisk', title: 'Add Hard Drive', w: 440, h: 330,
                        html: `${radio('adm', 'new', 'Create a new virtual hard disk', true)}${R.field('Size (GB):', R.inp('gb', 20))}${radio('adm', 'existing', 'Use an existing disk file on the server', false)}${R.field('Path:', R.inp('vol', '', 'placeholder="/srv/rack/vmfiles/disk.qcow2"'))}${R.field('Controller:', R.sel('bus', [{ value: 'virtio', text: 'VirtIO' }, { value: 'scsi', text: 'SCSI (virtio-scsi)' }, { value: 'sata', text: 'SATA (machine off)' }], 'virtio'))}`,
                        okText: 'Add',
                        ok: async (c2) => {
                            const p = { name, bus: R.val(c2, 'bus') };
                            if (R.picked(c2, 'adm') === 'existing') { p.volume = (R.val(c2, 'vol') || '').trim(); if (!p.volume.startsWith('/')) { R.err(c2, 'Type the absolute path of the disk.'); return false; } } else { p.newGB = Number(R.val(c2, 'gb')); if (!(p.newGB > 0)) { R.err(c2, 'Type the size in GB.'); return false; } }
                            await R.act(server, 'vms', 'disk-attach', p);
                            setTimeout(() => { void again('add'); }, 0);
                            return true;
                        }
                    });
                };
            },
            ok: async (ctx) => {
                const g = (k) => R.val(ctx, k);
                const calls = [];
                const set = {};
                if (!run) {
                    const order = Array.from(ctx.content.querySelectorAll('[data-rm-boot] .rm-bootrow')).map((r) => r.dataset.boot);
                    if (order.length && order.join() !== boot.join()) calls.push(['firmware', { bootOrder: order }]);
                    if (uefi && !!g('sb') !== !!(v.firmware && v.firmware.secureBoot)) calls.push(['firmware', { secureBoot: !!g('sb') }]);
                    if (uefi && !!g('tpm') !== !!(v.firmware && v.firmware.tpm)) calls.push(['firmware', { tpm: !!g('tpm') }]);
                    const mem = Number(g('mem'));
                    const dyn = !!g('dyn');
                    const mx = dyn ? Number(g('memmax')) : mem;
                    if (!(mem >= 64) || !(mx >= mem)) { R.err(ctx, 'Type the startup RAM in MB; the maximum cannot be below it.'); return false; }
                    if (mem !== v.memMB || mx !== (v.memMaxMB || v.memMB)) { set.memMB = mem; set.memMaxMB = mx; }
                    const vc = Number(g('vcpus'));
                    if (!(vc >= 1)) { R.err(ctx, 'Type the number of processors.'); return false; }
                    if (vc !== v.vcpus) set.vcpus = vc;
                    if (g('cpumodel') && g('cpumodel') !== (v.cpuModel || 'host-passthrough')) set.cpuModel = g('cpumodel');
                    nics.forEach((x, i) => {
                        const p = { name, index: i };
                        if (g(`net${i}`) !== (x.network || 'br0')) p.network = g(`net${i}`);
                        const mac = (g(`mac${i}`) || '').trim().toLowerCase();
                        if (mac && mac !== String(x.mac || '').toLowerCase()) p.mac = mac;
                        if (g(`nicmodel${i}`) !== (x.model || 'virtio')) p.model = g(`nicmodel${i}`);
                        if (Object.keys(p).length > 2) calls.push(['nic', p]);
                    });
                    const nn = (g('newname') || '').trim();
                    if (nn && nn !== v.name) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(nn)) { R.err(ctx, 'Use letters, digits, dots, dashes and underscores only.'); return false; } set.newName = nn; }
                    if (!v.agentChannel && g('agent')) set.agent = true;
                }
                cds.forEach((x, i) => {
                    const want = R.picked(ctx, `dvd${i}`) === 'iso' ? (g(`dviso${i}`) || '') : '';
                    if (want !== (x.source || '')) calls.push(['cdrom', { name, target: x.target, iso: want || null }]);
                });
                const guest = g('guest') || '';
                if (guest !== ((v.tags && v.tags.guest) || '')) set.guest = guest || null;
                if (!!g('auto') !== !!v.autostart) set.autostart = !!g('auto');
                const stop = R.picked(ctx, 'stop');
                if (stop && stop !== (v.stopAction || 'shutdown')) set.stopAction = stop;
                if (Object.keys(set).length) calls.unshift(['set', Object.assign({ name }, set)]);
                if (set.newName) calls.forEach((cl) => { if (cl[0] !== 'set') cl[1].name = name; }); // the rename runs last
                const ordered = set.newName ? calls.filter((cl) => cl[0] !== 'set').concat(calls.filter((cl) => cl[0] === 'set')) : calls;
                for (const [act, params] of ordered) {
                    try { await R.act(server, 'vms', act, params); } catch (e) { R.err(ctx, (e && e.message) || 'A change failed.'); R.stale(c, { server }, 'vms'); return false; }
                }
                R.stale(c, { server }, 'vms');
                return true;
            }
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
