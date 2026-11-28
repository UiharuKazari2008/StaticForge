/**
 * Rack Manager: the Replicas role (docs/rack-manager/replicas.md) - Dreamscape replica servers for development, one per
 * agent or task, built from the repo's own Dockerfile and reached through the host's nginx vhosts. Lists the replicas,
 * the built images and the data seeds; New Replica, Build Image, Take Seed; per replica Open, Start / Stop / Restart,
 * Update from Git (worktree mode), Logs, Login Key, Delete. Everything goes through rack_action (role replicas).
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R || !R.rolePage) return;
    const { esc, ITEMS } = R;
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const A = R.actions;
    const { rolePage, dataOf, doit, run } = R;
    const ICON16 = '/static_images/melaton/net-server-16.png';
    const STATE = { running: 'Running', exited: 'Stopped', created: 'Created', paused: 'Paused', restarting: 'Restarting', stopped: 'Stopped' };
    const list = (c, id, cols, rows, empty, extra) => c.listView(cols, rows, Object.assign({ sortId: id, empty, fit: true }, extra || {}));
    const repOf = (c, n) => arr(dataOf(n, 'replicas').replicas).find((x) => `rp:${x.name}` === c.sel);

    rolePage('replicas', (c, n, d) => {
        const reps = arr(d.replicas);
        const rl = list(c, 'rm-replicas', [
            { t: 'Name', w: 130, key: 'n', text: (x) => x.name },
            { t: 'State', w: 76, key: 's', text: (x) => STATE[x.state] || x.state || '' },
            { t: 'Health', w: 64, key: 'h', text: (x) => (x.health ? (x.health.ok ? 'OK' : `Error ${x.health.status || ''}`) : '') },
            { t: 'Owner', w: 110, key: 'o', text: (x) => x.owner || '' },
            { t: 'Ref', w: 110, key: 'r', text: (x) => String(x.ref || '').replace(/^refs\/(heads\/)?/, '') },
            { t: 'Mode', w: 70, key: 'm', text: (x) => (x.mode === 'worktree' ? 'Worktree' : 'Image') },
            { t: 'Address', w: 200, key: 'u', text: (x) => x.urlDirect || x.url || '' }
        ], reps.map((x) => ({ key: `rp:${x.name}`, icon: ICON16, data: x })), 'There are no replicas. Use New Replica to start one.');
        const x = repOf(c, n);
        const detail = x ? c.props([
            ['Purpose', esc(x.purpose || '')],
            ['Address', x.urlDirect ? `<a href="${esc(x.urlDirect)}" target="_blank" rel="noopener">${esc(x.urlDirect)}</a>` : ''],
            ['Name address', x.url ? esc(x.url) : ''],
            ['Commit', esc(String(x.commit || '').slice(0, 12))],
            ['Seed', esc(x.seed || '')],
            ['Image', esc(x.image || '')],
            ['Resources', esc(`${x.cpus || '?'} CPUs, ${x.memGB || '?'} GB`)],
            ['Created', esc(R.when(x.createdAt))],
            ['Allowed outside services', esc(arr(x.allow).join(', ') || 'None (replica mode)')]
        ]) : '<p class="mmc-hint">Select a replica to see its details.</p>';
        const il = list(c, 'rm-rp-images', [
            { t: 'Image', w: 200, key: 't', text: (y) => y.tag },
            { t: 'Ref', w: 130, key: 'r', text: (y) => String(y.ref || '').replace(/^refs\/(heads\/)?/, '') },
            { t: 'Size', w: 76, num: true, key: 's', value: (y) => y.sizeB, text: (y) => R.bytes(y.sizeB) },
            { t: 'Built', w: 130, key: 'b', value: (y) => y.builtAt, text: (y) => R.when(y.builtAt) }
        ], arr(d.images).map((y) => ({ key: `im:${y.tag}`, icon: `${ITEMS}/programs-and-features-16.png`, data: y })), 'No image is built yet. Use Build Image.');
        const sl = list(c, 'rm-rp-seeds', [
            { t: 'Seed', w: 160, key: 'i', text: (y) => y.id },
            { t: 'Taken', w: 130, key: 't', value: (y) => y.takenAt, text: (y) => R.when(y.takenAt) },
            { t: 'Size', w: 76, num: true, key: 's', value: (y) => y.sizeB, text: (y) => R.bytes(y.sizeB) },
            { t: 'Keys', w: 60, key: 'k', text: (y) => (y.keys ? 'Yes' : 'No') }
        ], arr(d.seeds).map((y) => ({ key: `sd:${y.id}`, icon: '/static_images/vista-devmgr/volumes-16.png', data: y })), 'No seed is taken yet. Use Take Seed.');
        const running = reps.filter((y) => y.state === 'running').length;
        return c.page('Replicas', `${running} of ${reps.length} running`, [
            { id: 'rp-list', title: 'Replicas', body: R.jobStrip(n) + rl },
            { id: 'rp-detail', title: x ? x.name : 'Details', body: detail },
            { id: 'rp-img', title: 'Images', body: il },
            { id: 'rp-seed', title: 'Seeds', body: sl }
        ]);
    });

    R.hooks.row.push((key, n, c) => { if (n.kind === 'role' && n.role === 'replicas') R.repaint(c); });

    R.commands['role:replicas'] = () => [
        { text: 'New Replica...', action: 'rp-new', icon: ICON16 },
        { text: 'Build Image...', action: 'rp-image' },
        { text: 'Take Seed...', action: 'rp-seed' }
    ];
    R.selCommands['role:replicas'] = (n, key, c) => {
        if (!String(key).startsWith('rp:')) return null;
        const x = repOf(c, n);
        if (!x) return null;
        const on = x.state === 'running';
        return {
            title: x.name,
            items: [
                { text: 'Open', action: 'rp-open', disabled: !on || !(x.urlDirect || x.url) },
                on ? { text: 'Stop', action: 'rp-op:stop' } : { text: 'Start', action: 'rp-op:start' },
                { text: 'Restart', action: 'rp-op:restart', disabled: !on },
                { text: 'Update from Git...', action: 'rp-pull', disabled: x.mode !== 'worktree' },
                { text: 'Logs...', action: 'rp-logs' },
                { text: 'Login Key...', action: 'rp-login' },
                { separator: true },
                { text: 'Delete...', action: 'rp-del' }
            ]
        };
    };

    A['rp-open'] = (c, p, n) => { const x = repOf(c, n); const u = x && (x.urlDirect || x.url); if (u) root.open(u, '_blank', 'noopener'); };
    A['rp-op'] = async (c, op, n) => { const x = repOf(c, n); if (x) await run(c, n, 'replicas', op, { name: x.name }); };
    A['rp-del'] = async (c, p, n) => {
        const x = repOf(c, n);
        if (!x) return;
        const a = await R.taskDialog(c, { instruction: `Delete the replica ${x.name}?`, text: 'Its container, its data folder, its address and its certificate are removed. Work that is not pushed is lost.', links: [{ id: 'go', text: 'Delete', danger: true }] });
        if (a === 'go') await run(c, n, 'replicas', 'delete', { name: x.name, confirm: true });
    };
    A['rp-pull'] = (c, p, n) => {
        const x = repOf(c, n);
        if (!x) return;
        R.dialog(c, {
            id: 'rppull', title: `Update ${x.name} from Git`, w: 400, h: 170,
            html: R.field('Branch or commit:', R.inp('ref', String(x.ref || 'main').replace(/^refs\/(heads\/)?/, '')), true),
            okText: 'Update',
            ok: async (ctx) => { const ref = (R.val(ctx, 'ref') || '').trim(); await doit(c, n, 'replicas', 'pull', Object.assign({ name: x.name }, ref ? { ref } : {})); return true; }
        });
    };
    A['rp-logs'] = async (c, p, n) => {
        const x = repOf(c, n);
        if (!x) return;
        const read = async () => { try { const r = await R.act(n.server, 'replicas', 'logs', { name: x.name, lines: 500 }); const y = r.result || r; return y.text || y.log || ''; } catch (e) { return `The log could not be read: ${(e && e.message) || e}`; } };
        const text = await read();
        R.dialog(c, {
            id: 'rplogs', title: `Logs: ${x.name}`, w: 680, h: 440, okText: 'Close', noCancel: true,
            html: `<pre class="rm-pre rm-console" data-rm-out data-mmc-scroll>${esc(text)}</pre><div class="rm-row"><button type="button" class="btn-standard" data-refresh>Refresh</button></div>`,
            init: (ctx) => { const out = ctx.content.querySelector('[data-rm-out]'); out.scrollTop = out.scrollHeight; ctx.content.querySelector('[data-refresh]').addEventListener('click', async () => { out.textContent = await read(); out.scrollTop = out.scrollHeight; }); }
        });
    };
    // the replica's own sign-in (its login key; never the live server's): shown masked until Reveal
    A['rp-login'] = async (c, p, n) => {
        const x = repOf(c, n);
        if (!x) return;
        let key = '';
        try { const r = await R.act(n.server, 'replicas', 'login', { name: x.name }); const y = r.result || r; key = y.loginKey || y.key || y.login || ''; } catch (e) { await R.box(c, (e && e.message) || String(e)); return; }
        R.dialog(c, {
            id: 'rplogin', title: `Login Key: ${x.name}`, w: 420, h: 190, okText: 'Close', noCancel: true,
            html: `<p>This key signs in to ${esc(x.name)} only.</p>${R.field('Login key:', `<input type="password" data-rm="key" value="${esc(key)}" readonly>`, true)}<div class="rm-row"><button type="button" class="btn-standard" data-reveal>Reveal</button><button type="button" class="btn-standard" data-copy>Copy</button></div>`,
            init: (ctx) => {
                const f = ctx.content.querySelector('[data-rm="key"]');
                const rv = ctx.content.querySelector('[data-reveal]');
                rv.addEventListener('click', () => { const show = f.type === 'password'; f.type = show ? 'text' : 'password'; rv.textContent = show ? 'Hide' : 'Reveal'; });
                ctx.content.querySelector('[data-copy]').addEventListener('click', () => { try { void root.navigator.clipboard.writeText(key); } catch (_) { /* no clipboard */ } });
            }
        });
    };
    A['rp-image'] = (c, p, n) => R.dialog(c, {
        id: 'rpimage', title: 'Build Image', w: 400, h: 170,
        html: R.field('Branch or commit to build:', R.inp('ref', 'main'), true),
        okText: 'Build',
        ok: async (ctx) => { const ref = (R.val(ctx, 'ref') || '').trim() || 'main'; await doit(c, n, 'replicas', 'image-build', { ref }); return true; }
    });
    A['rp-seed'] = (c, p, n) => R.dialog(c, {
        id: 'rpseed', title: 'Take Seed', w: 420, h: 220,
        html: `<p>A seed is a copy of the live server's data that new replicas start from. Secrets, phones, mail and messages are left out.</p>${R.field('Newest pictures to include:', R.inp('images', '25'), true)}`,
        okText: 'Take Seed',
        ok: async (ctx) => { const images = Math.max(0, Math.min(500, Number(R.val(ctx, 'images')) || 0)); await doit(c, n, 'replicas', 'seed-take', { images }); return true; }
    });
    A['rp-new'] = (c, p, n) => {
        const d = dataOf(n, 'replicas');
        const seeds = arr(d.seeds).map((y) => ({ value: y.id, text: `${y.id} (${R.when(y.takenAt)})` })).concat([{ value: 'empty', text: 'Empty (no data)' }]);
        R.dialog(c, {
            id: 'rpnew', title: 'New Replica', w: 440, h: 330,
            html: `${R.field('Name:', R.inp('name', '', 'placeholder="replica-feature-x"'), true)}${R.field('Branch or commit:', R.inp('ref', 'main'), true)}`
                + `${R.field('Mode:', R.sel('mode', [{ value: 'worktree', text: 'Worktree (editable checkout)' }, { value: 'image', text: 'Image (code built in)' }], 'worktree'), true)}`
                + `${R.field('Data:', R.sel('seed', seeds, seeds[0] && seeds[0].value), true)}${R.field('Purpose:', R.inp('purpose', ''), true)}`,
            okText: 'Create',
            ok: async (ctx) => {
                const name = (R.val(ctx, 'name') || '').trim();
                if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) { R.err(ctx, 'Use 2 to 31 lower-case letters, digits and dashes.'); return false; }
                const params = { name, ref: (R.val(ctx, 'ref') || '').trim() || 'main', mode: R.val(ctx, 'mode') || 'worktree', seed: R.val(ctx, 'seed') || 'empty' };
                const purpose = (R.val(ctx, 'purpose') || '').trim();
                if (purpose) params.purpose = purpose;
                await doit(c, n, 'replicas', 'create', params);
                return true;
            }
        });
    };
}(typeof window !== 'undefined' ? window : globalThis));
