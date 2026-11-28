/**
 * Rack Manager (docs/rack-manager/README.md): the MMC snap-in for the rack servers (Administrative Tools,
 * rackmgr.msc). Their iLO (console, hardware, power) and their roles (virtual machines, Android devices,
 * browser sandboxes, containers, builds, terminal, storage, networking, services, logs, updates).
 *
 *   Rack Manager                        every server at a glance
 *     <server>                          iLO + host summary, roles, live metrics
 *       Console / Hardware / Power      iLO (mmcRackManagerIlo.js)
 *       Roles                           what is installed; Add Roles...
 *         <role pages>                  (mmcRackManagerRoles.js, mmcRackManagerRoles2.js)
 *         Jobs                          running and finished jobs with their log, pushed
 *
 * Everything goes over WS packets rack_* (admin only). Nothing polls: the server pushes rack_event while this
 * window is subscribed (rack_subscribe), and a page reads its data when it is shown and when an event says it changed.
 * This file is the core (state, packets, dialog helpers, the tree, the overview pages, Jobs, Add Roles); the parts add
 * their pages to window.mmcRack.pages / commands / selCommands / actions before the console is opened.
 *
 *   window.openRackManager(node?) (the desktop's openRackManagerConsole, dsapManifests.js, loads this first)   node: 'root' | 's:<server>' | 's:<server>:console' ...
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const ID = 'rackManager';
    const TITLE = 'Rack Manager';
    const ITEMS = '/static_images/vista-cpl/items';
    const VI = '/static_images/vista-icons';
    const SRV16 = '/static_images/melaton/net-server-16.png';
    const SRV32 = '/static_images/melaton/net-server-32.png';
    // Jobs is Task Scheduler's job (calendar and clock); a job row shows its state with Vista Sync Center's state art
    const JOBS16 = `${ITEMS}/date-and-time-16.png`;
    const SYNC = '/static_images/vista-sync';
    const JOBPIC = { running: `${SYNC}/sync-progress-16.png`, done: `${SYNC}/status-done-16.png`, failed: `${SYNC}/status-error-16.png`, success: `${SYNC}/status-done-16.png`, passed: `${SYNC}/status-done-16.png`, cancelled: `${SYNC}/status-conflict-16.png`, queued: JOBS16 };
    const jobIcon = (st) => JOBPIC[st] || JOBPIC.queued;
    // the status lights: Vista's Network and Sharing Center lights (green on, gray off) and its small warning and error icons
    const LIGHT = { on: '/static_images/vista-file-sharing/nsc-on-16.png', off: '/static_images/vista-file-sharing/nsc-off-16.png', warn: `${VI}/warning-16.png`, bad: `${VI}/error-16.png` };
    const lightKind = (k) => (k === 'ok' || k === 'on' || k === 'is-ok' ? 'on' : k === 'warn' || k === 'wait' || k === 'is-warn' ? 'warn' : k === 'bad' || k === 'is-bad' ? 'bad' : 'off');
    const lightSrc = (k) => LIGHT[lightKind(k)];
    const light = (k, title) => `<img class="rm-lt" src="${lightSrc(k)}" alt=""${title ? ` title="${title.replace(/"/g, '&quot;')}"` : ''}>`;
    const SS = 0x50020000;
    const DEFPUSH = 0x50010001;
    const PUSH = 0x50010000;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const MC = () => root.mmcConsole;
    const bytes = (n) => (MC() ? MC().size(n) : String(n));
    const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
    const when = (t) => (MC() ? MC().when(t) : '');

    // the roles, in tree order: icon names are Vista's own art (control panel items, cmd, android runtime)
    const ROLES = [
        { id: 'vms', name: 'Virtual Machines', i16: `${ITEMS}/system-16.png`, i32: `${ITEMS}/system-32.png`, desc: 'Virtual machines (libvirt / KVM) on this server.' },
        { id: 'android', name: 'Virtual Android Devices', i16: '/static_images/vista-dlg/android-runtime-32.png', i32: '/static_images/vista-dlg/android-runtime-32.png', desc: 'Android virtual devices for tests, headless.' },
        { id: 'sandboxes', name: 'Sandboxes', i16: `${ITEMS}/internet-options-16.png`, i32: `${ITEMS}/internet-options-32.png`, desc: 'Browser environments for testing, each with its own profile and debugging port.' },
        { id: 'containers', name: 'Containers', i16: `${ITEMS}/programs-and-features-16.png`, i32: `${ITEMS}/programs-and-features-32.png`, desc: 'Docker containers, images and volumes.' },
        { id: 'builds', name: 'Builds', i16: `${VI}/generic-exe-16.png`, i32: `${VI}/generic-exe-32.png`, desc: 'Clean, tracked builds: pipelines, runs, logs and artifacts.' },
        { id: 'replicas', name: 'Replicas', i16: `${ITEMS}/sync-center-16.png`, i32: `${ITEMS}/sync-center-32.png`, desc: 'Dreamscape replica servers for development, one per agent or task.' },
        { id: 'terminal', name: 'Terminal', i16: '/static_images/vista-cmd/cmd-16.png', i32: '/static_images/vista-cmd/cmd-32.png', desc: 'A shell on the server, and its tmux sessions.' },
        { id: 'storage', name: 'Storage', i16: '/static_images/vista-devmgr/disk-drives-16.png', i32: '/static_images/vista-devmgr/disk-drives-32.png', desc: 'Disks, file systems, volumes and RAM disks.' },
        { id: 'networking', name: 'Networking', i16: `${ITEMS}/network-and-sharing-center-16.png`, i32: `${ITEMS}/network-and-sharing-center-32.png`, desc: 'Interfaces, routes, bridges and listening ports.' },
        { id: 'services', name: 'Services', i16: `${ITEMS}/administrative-tools-16.png`, i32: `${ITEMS}/administrative-tools-32.png`, desc: 'System services.' },
        { id: 'logs', name: 'Logs', i16: `${ITEMS}/problem-reports-and-solutions-16.png`, i32: `${ITEMS}/problem-reports-and-solutions-32.png`, desc: 'The system journal, like Event Viewer.' },
        { id: 'updates', name: 'Updates', i16: `${ITEMS}/update-16.png`, i32: `${ITEMS}/update-32.png`, desc: 'Software updates, like Windows Update.' }
    ];
    const roleOf = (id) => ROLES.find((r) => r.id === id) || null;

    // ---- state ----------------------------------------------------------------------------------------

    const S = {
        servers: [],      // rack_list's servers
        loaded: false,
        error: '',
        denied: false,
        srv: {},          // name -> { info, infoErr, infoLoading, roles: { role: { data, error, loading, at } }, jobs: [], metrics, ilo: {}, loading: {} }
        subscribed: null,
        feedWired: false,
        console: null     // the open Console object
    };

    const R = {
        S, esc, ROLES, roleOf, bytes, num, when, ITEMS, VI, SRV16, SRV32, light, lightSrc, jobIcon, JOBS16, panes: {}, statusX: {},
        pages: {}, commands: {}, selCommands: {}, actions: {}, hooks: { close: [], event: [], leave: [], open: [], ensure: [], row: [], refresh: [] }, inputs: {}
    };

    function ss(name) {
        if (!S.srv[name]) S.srv[name] = { info: null, infoErr: '', infoLoading: false, roles: {}, jobs: [], jobsLoaded: false, metrics: null, ilo: {}, loading: {} };
        return S.srv[name];
    }
    const meta = (name) => S.servers.find((s) => s.name === name) || null;
    R.ss = ss;
    R.meta = meta;

    // ---- the host's power state (power on demand: the host is off unless there is work) ----------------------------------
    const PSTATE = { off: 'Off', 'powering-on': 'Powering on', booting: 'Booting', up: 'Running', 'shutting-down': 'Shutting down' };
    /** The server's power object (rack_power answers { power }, rack_list rows and events carry it flat) in one shape: state, post, idle { busy }, deadline. */
    function normPower(r) {
        const x = r && typeof r === 'object' ? (r.power && typeof r.power === 'object' ? r.power : r) : {};
        const out = Object.assign({}, x);
        if (x.bootPct != null || x.stage) out.post = Object.assign({}, x.post, { pct: x.bootPct, stage: x.stage, eta: x.bootSeconds != null && x.bootPct != null ? Math.max(0, x.bootSeconds * (100 - x.bootPct) / Math.max(1, x.bootPct)) : undefined });
        if (x.busy || x.idle) out.idle = Object.assign({}, x.idle, { busy: x.busy || (x.idle && x.idle.busy) });
        if (x.idleShutdown && x.idleShutdown.at) out.deadline = x.idleShutdown.at;
        return out;
    }
    /** off | powering-on | booting | up | shutting-down, from the pushed state, else what rack_list says. */
    function powerState(server) {
        const p = ss(server).power;
        if (p && p.state && p.state !== 'unknown') return p.state;
        const m = meta(server) || {};
        if (m.power) { const x = typeof m.power === 'string' ? m.power : m.power.state; if (x && x !== 'unknown') return x; }
        const ip = m.ilo && m.ilo.power;
        const r = m.rackd && m.rackd.state;
        if ((ip === 'off' || ip === false) && r !== 'up') return 'off';
        return 'up';
    }
    /** The POST progress of a powering-on host (the iLO's: stage, percent, time left), either nested or flat. */
    function postOf(server) {
        const p = ss(server).power || {};
        const x = p.post || {};
        const pct = x.pct != null ? x.pct : p.postPct;
        return { stage: x.stage || p.postStage || '', pct: pct == null ? null : Number(pct), eta: x.eta != null ? x.eta : p.postEta, code: x.code || p.post || '' };
    }
    Object.assign(R, { powerState, postOf, PSTATE });

    // ---- packets ----------------------------------------------------------------------------------------

    /** The answer's body: a { success, data } wrapper is opened, a refusal throws. */
    function body(r) {
        let x = r;
        if (x && typeof x === 'object' && x.success === false) { const e = new Error(x.error || x.message || 'The server refused the request.'); e.code = x.code; throw e; }
        if (x && typeof x === 'object' && x.success === true && 'data' in x) x = x.data;
        if (x && typeof x === 'object' && typeof x.error === 'string' && x.error) throw new Error(x.error);
        return x;
    }

    /** One request; its error is this console's to show (no "Unhandled exception" box). */
    function wsSend(type, data) {
        const client = root.wsClient;
        if (!client || typeof client.sendMessage !== 'function') return Promise.reject(new Error('Melaton is not connected to the server.'));
        const go = () => client.sendMessage(type, data || {}, false);
        return typeof client.handlesErrors === 'function' ? client.handlesErrors(go) : go();
    }

    // CaféReady's certificate sign-in: the server asks for the administrator PIN once per sign-in (ADMIN_PIN_REQUIRED).
    // Every request refused meanwhile waits on the one dialog, then is sent again.
    let pinAsk = null;
    function askPin() {
        if (pinAsk) return pinAsk;
        const c = S.console;
        if (!c || !c.modal || !c.modal.isConnected) return Promise.resolve(false);
        pinAsk = new Promise((resolve) => {
            const end = (v) => { if (pinAsk) { pinAsk = null; resolve(v); } };
            const ctx = dialog(c, {
                id: 'adminPin',
                title: 'Rack Manager',
                w: 330,
                h: 150,
                html: `<p>Type the administrator PIN to manage the rack from this device.</p>${field('Administrator PIN:', '<input type="password" data-rm="pin" autocomplete="off" maxlength="64">')}`,
                ok: async (dctx) => {
                    const pin = val(dctx, 'pin') || '';
                    if (!pin) { err(dctx, 'Type the PIN.'); return false; }
                    await wsSend('admin_pin_confirm', { pin }); // a wrong PIN throws: shown in the dialog, which stays
                    end(true);
                    return true;
                },
                cancel: () => end(false)
            });
            if (!ctx) end(false);
        });
        return pinAsk;
    }

    async function send(type, data) {
        try {
            return body(await wsSend(type, data));
        } catch (e) {
            if (e && e.details === 'ADMIN_PIN_REQUIRED' && await askPin()) return body(await wsSend(type, data));
            throw e;
        }
    }
    R.send = send;

    const isAdmin = () => { try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; } };

    const getRole = async (server, role, query) => {
        const r = await send('rack_get', Object.assign({ server, role }, query ? { params: query } : {}));
        return r && typeof r === 'object' && 'data' in r && ('role' in r) ? r.data : r;
    };
    /** A write: { result } or { job } (a job is kept in the server's list at once). */
    const act = async (server, role, action, params) => {
        const r = await send('rack_action', { server, role, action, params: params || {} });
        if (r && r.job) noteJob(server, r.job);
        return r || {};
    };
    const ilo = async (server, what, params) => {
        const r = await send('rack_ilo', Object.assign({ server, what }, params ? { params } : {}));
        return r && typeof r === 'object' && 'data' in r ? r.data : r;
    };
    const iloAct = async (server, action, params) => {
        const r = await send('rack_ilo_action', { server, action, params: params || {} });
        return r && typeof r === 'object' && 'result' in r ? r.result : r;
    };
    Object.assign(R, { getRole, act, ilo, iloAct, isAdmin });

    // ---- dialogs (Vista's: owner-modal windows built from one-control templates) -----------------------------

    function templates(key, w, h, buttons) {
        const dw = Math.round(w / 1.5);
        const dh = Math.round(h / 1.625);
        const c = [[100, 'S', 0, 0, dw, buttons ? dh - 22 : dh, SS, '', 0]];
        buttons.forEach(([id, text, x, style]) => c.push([id, 'B', dw + x, dh - 17, 50, 14, style, text, 0]));
        const tpl = { t: '', w: dw, h: dh, f: ['MS Shell Dlg', 8], s: 0, c };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, { [key]: tpl });
        return tpl;
    }

    function vdt() {
        const api = root.vistaDialogTemplate;
        if (!api) throw new Error('The dialog could not be shown.');
        return api;
    }

    const err = (ctx, text) => {
        const e = ctx.content.querySelector('.rm-err');
        if (!e) return;
        e.innerHTML = text ? `<img src="${VI}/error-16.png" alt="">${esc(text)}` : '';
        e.hidden = !text;
    };
    const val = (ctx, name) => { const e = ctx.content.querySelector(`[data-rm="${name}"]`); return e ? (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value) : undefined; };
    const picked = (ctx, name) => { const e = ctx.content.querySelector(`input[data-rm="${name}"]:checked`); return e ? e.value : ''; };

    /**
     * A plain dialog: html in the page, OK / Cancel. ok(ctx) answers false to stay open (after err(ctx, text)).
     * opts { id, title, w, h, html, okText, noCancel, init(ctx), ok(ctx) }
     */
    function dialog(c, o) {
        const key = `rm:${o.id}`;
        const w = o.w || 380;
        const h = o.h || 220;
        const btn = o.noCancel ? [[1, o.okText || 'OK', -55, DEFPUSH]] : [[1, o.okText || 'OK', -110, DEFPUSH], [2, 'Cancel', -55, PUSH]];
        templates(key, w, h, btn);
        return vdt().openDialog({
            id: `rackDlg_${o.id}`,
            key,
            title: o.title,
            owner: c.modal,
            focusFirst: true,
            modeless: !!o.modeless,   // a window of its own (Device Connection), not modal to the console
            cancel: o.cancel,
            init: (ctx) => {
                ctx.html(100, `<div class="rm-form">${o.html}<div class="rm-err" hidden></div></div>`);
                if (typeof o.init === 'function') o.init(ctx);
            },
            ok: async (ctx) => {
                if (typeof o.ok !== 'function') return true;
                try { return (await o.ok(ctx)) === false ? false : true; } catch (e) { err(ctx, (e && e.message) || String(e)); return false; }
            }
        });
    }

    /**
     * An Aero wizard whose pages are forms: pages [{ key, instruction, html, show(ctx), next(ctx) -> key | false, finish }],
     * finish(ctx) -> false stays. The page's key is wizard-local.
     */
    function wizard(c, o) {
        const w = o.w || 460;
        const h = o.h || 300;
        const pages = o.pages.map((p) => {
            const key = `rm:${o.id}:${p.key}`;
            templates(key, w, h, []);
            return Object.assign({}, p, { key, local: p.key });
        });
        const k = (local) => `rm:${o.id}:${local}`;
        return vdt().openWizard({
            id: `rackWiz_${o.id}`,
            title: o.title,
            icon: o.icon,
            owner: c.modal,
            init: (ctx) => {
                pages.forEach((p) => ctx.html(100, `<div class="rm-form">${p.html}<div class="rm-err" hidden></div></div>`, p.key));
                if (typeof o.init === 'function') o.init(ctx);
            },
            pages: pages.map((p) => ({
                key: p.key,
                instruction: p.instruction,
                finish: p.finish,
                noBack: p.noBack,
                nextText: p.nextText,
                show: p.show ? (ctx) => p.show(ctx) : undefined,
                next: p.next ? async (ctx) => { const to = await p.next(ctx); return to ? (to === true ? null : k(to)) : false; } : undefined
            })),
            finish: o.finish
        });
    }

    /**
     * A Vista task dialog: the main instruction in blue, the text, command links (and Cancel). Resolves with the link's
     * id, or null.  opts { title, instruction, text, links: [{ id, text, sub?, danger? }], icon }
     */
    function taskDialog(c, o) {
        return new Promise((resolve) => {
            const key = `rm:task${Math.random().toString(36).slice(2, 7)}`;
            const w = o.w || 440;
            const nl = (o.links || []).length;
            const h = o.h || (110 + nl * 44 + (o.text ? 34 : 0));
            templates(key, w, h, [[2, o.cancelText || 'Cancel', -55, DEFPUSH]]);
            let answer = null;
            const links = (o.links || []).map((l) => `<button type="button" class="rm-cmdlink${l.danger ? ' is-danger' : ''}" data-link="${esc(l.id)}"><span class="rm-cmdarrow"></span><b>${esc(l.text)}</b>${l.sub ? `<i>${esc(l.sub)}</i>` : ''}</button>`).join('');
            vdt().openDialog({
                id: `rackTask_${key.replace(/\W/g, '_')}`,
                key,
                title: o.title || TITLE,
                owner: c.modal,
                init: (ctx) => {
                    ctx.html(100, `<div class="rm-task"><img src="${esc(o.icon || `${VI}/msgbox-warning-32.png`)}" alt=""><div><div class="rm-task-main">${esc(o.instruction)}</div>${o.text ? `<div class="rm-task-text">${o.text}</div>` : ''}<div class="rm-task-links">${links}</div></div></div>`);
                    ctx.content.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => { answer = b.dataset.link; ctx.close(); }));
                },
                cancel: () => { answer = null; }
            });
            const poll = new MutationObserver(() => {
                if (!doc.getElementById(`rackTask_${key.replace(/\W/g, '_')}`)) { poll.disconnect(); resolve(answer); }
            });
            poll.observe(doc.body, { childList: true });
        });
    }

    /** Message box over the console (errors of an action). */
    const box = (c, text, icon) => c.box(`<p>${esc(text)}</p>`, null, { icon: icon || 'error' });

    const field = (label, inner, wide) => `<label class="rm-field${wide ? ' is-wide' : ''}"><span>${esc(label)}</span>${inner}</label>`;
    const inp = (name, value, attrs) => `<input type="text" data-rm="${name}" value="${esc(value == null ? '' : value)}" autocomplete="off" spellcheck="false" ${attrs || ''}>`;
    const sel = (name, opts, value) => `<select class="vdt-select" data-rm="${name}">${opts.map((o) => { const v = typeof o === 'object' ? o.value : o; const t = typeof o === 'object' ? o.text : o; return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
    const chk = (name, text, on) => `<label class="rm-check"><input type="checkbox" data-rm="${name}"${on ? ' checked' : ''}> ${esc(text)}</label>`;
    const trackbar = (name, min, max, value, step, unit) => `<span class="rm-trackbar"><input type="range" data-rm="${name}" min="${min}" max="${max}" step="${step || 1}" value="${value}"><b data-rm-out="${name}">${esc(value)} ${esc(unit || '')}</b></span>`;
    /** Trackbar change shows its value next to it. */
    const wireTrackbars = (ctx, unit) => ctx.content.querySelectorAll('input[type="range"][data-rm]').forEach((r) => {
        const out = ctx.content.querySelector(`[data-rm-out="${r.dataset.rm}"]`);
        const upd = () => { if (out) out.textContent = `${r.value} ${unit || ''}`; };
        r.addEventListener('input', upd);
    });
    Object.assign(R, { dialog, wizard, taskDialog, box, err, val, picked, field, inp, sel, chk, trackbar, wireTrackbars });

    // ---- small renderers ------------------------------------------------------------------------------

    const bar = (pct0, cls) => { const pct = Math.max(0, Math.min(100, Number(pct0) || 0)); return `<div class="mmc-progress rm-bar"><div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"${cls ? ` class="${cls}"` : ''} style="--rm-pct:${pct}"><div></div></div><span>${Math.round(pct)}%</span></div>`; };
    const dur = (s) => {
        s = Math.max(0, Math.round(Number(s) || 0));
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        return d ? `${d} day${d === 1 ? '' : 's'}, ${h} h` : h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
    };
    const link = (act2, text, arg) => `<span class="mmc-link" data-act="${esc(act2)}"${arg != null ? ` data-arg="${esc(arg)}"` : ''}>${esc(text)}</span>`;
    const btnHtml = (act2, text, arg, extra) => `<button type="button" class="btn-standard" data-act="${esc(act2)}"${arg != null ? ` data-arg="${esc(arg)}"` : ''}${extra || ''}>${esc(text)}</button>`;
    const pre = (text) => `<pre class="rm-pre" data-mmc-scroll>${esc(text)}</pre>`;
    Object.assign(R, { bar, dur, link, btnHtml, pre });

    // ---- the tree and the selected node -----------------------------------------------------------------

    function nodes() {
        const kids = S.servers.map((s) => {
            const n = s.name;
            return {
                id: `s:${n}`,
                name: s.label,
                icon: SRV16,
                children: [
                    { id: `s:${n}:console`, name: 'Console', icon: `${VI}/remote-access-16.png` },
                    { id: `s:${n}:hardware`, name: 'Hardware', icon: `${ITEMS}/device-manager-16.png` },
                    { id: `s:${n}:power`, name: 'Power', icon: `${ITEMS}/power-options-16.png` },
                    {
                        id: `s:${n}:roles`,
                        name: 'Roles',
                        icon: `${ITEMS}/administrative-tools-16.png`,
                        children: ROLES.map((r) => ({ id: `s:${n}:r:${r.id}`, name: r.name, icon: r.i16 })).concat([{ id: `s:${n}:jobs`, name: 'Jobs', icon: JOBS16 }])
                    }
                ]
            };
        });
        return [{ id: 'root', name: TITLE, icon: SRV16, children: kids }];
    }

    /** 's:misaka:r:vms' -> { kind: 'role', server, role } */
    function parse(id) {
        const p = String(id || 'root').split(':');
        if (p[0] !== 's') return { kind: 'root' };
        const server = p[1];
        if (p.length === 2) return { kind: 'server', server };
        if (p[2] === 'r') return { kind: 'role', server, role: p[3] };
        return { kind: p[2], server };
    }
    const here = (c) => { const n = parse(c.node); return Object.assign(n, { meta: n.server ? meta(n.server) : null, ss: n.server ? ss(n.server) : null }); };
    R.parse = parse;
    R.here = here;

    // ---- loading ------------------------------------------------------------------------------------------

    const live = (c) => !!(c && c.modal && c.modal.isConnected);
    const repaint = (c) => { if (live(c)) c.refresh(); };

    async function loadList(c) {
        if (!isAdmin()) { S.denied = true; repaint(c); return; }
        S.denied = false;
        try {
            const r = await send('rack_list', {});
            S.servers = (r && r.servers) || [];
            S.error = '';
        } catch (e) { S.error = (e && e.message) || 'The server did not answer.'; }
        S.loaded = true;
        repaint(c);
    }

    async function loadInfo(c, server, force) {
        const st = ss(server);
        if (st.infoLoading || (st.info && !force) || powerState(server) !== 'up') return;
        const m = meta(server);
        if (m && m.rackd && (m.rackd.state === 'not-deployed' || m.rackd.state === 'down')) { st.info = null; st.infoErr = ''; return; }
        st.infoLoading = true;
        try { st.info = await getRole(server, 'info'); st.infoErr = ''; } catch (e) { st.infoErr = (e && e.message) || 'rackd did not answer.'; }
        st.infoLoading = false;
        repaint(c);
    }

    async function loadRole(c, server, role, force) {
        const st = ss(server);
        const rs = st.roles[role] || (st.roles[role] = { data: null, error: '', loading: false, at: 0 });
        if (rs.loading || (rs.data && !force) || powerState(server) !== 'up') return;
        const m = meta(server);
        if (m && m.rackd && (m.rackd.state === 'not-deployed' || m.rackd.state === 'down')) return;
        rs.loading = true;
        try { rs.data = await getRole(server, role, R.roleQuery && R.roleQuery[role] ? R.roleQuery[role](server) : null); rs.error = ''; rs.at = Date.now(); } catch (e) { rs.error = (e && e.message) || 'rackd did not answer.'; }
        rs.loading = false;
        repaint(c);
    }
    Object.assign(R, { loadInfo, loadRole, repaint, live });

    async function loadJobs(c, server, force) {
        const st = ss(server);
        if (st.jobsLoading || (st.jobsLoaded && !force) || powerState(server) !== 'up') return;
        const m = meta(server);
        if (m && m.rackd && m.rackd.state !== 'up') { st.jobsLoaded = true; return; }
        st.jobsLoading = true;
        try { const r = await getRole(server, 'jobs'); st.jobs = (r && (r.jobs || r)) || []; if (!Array.isArray(st.jobs)) st.jobs = []; st.jobsError = ''; } catch (e) { st.jobsError = (e && e.message) || 'rackd did not answer.'; }
        st.jobsLoaded = true;
        st.jobsLoading = false;
        repaint(c);
    }

    /** The host's power status (state, leases, idle, settings): reading it never wakes the host. */
    async function loadHostPower(c, server, force) {
        const st = ss(server);
        if (st.loading.hostPower || (st.power && st.power.read && !force)) return;
        st.loading.hostPower = true;
        try { st.power = Object.assign({}, st.power, normPower(await send('rack_power', { server, action: 'status' })), { read: true }); delete st.powerErr; } catch (e) { st.powerErr = (e && e.message) || 'The power status could not be read.'; st.power = Object.assign({}, st.power, { read: true }); }
        st.loading.hostPower = false;
        repaint(c);
    }
    R.loadHostPower = loadHostPower;

    function noteJob(server, job) {
        if (!job || !job.id) return;
        const st = ss(server);
        const i = st.jobs.findIndex((j) => j.id === job.id);
        if (i >= 0) st.jobs[i] = Object.assign({}, st.jobs[i], job); else st.jobs.unshift(job);
        st.jobsLoaded = true;
    }
    R.noteJob = noteJob;
    const runningJobs = (server, role) => ss(server).jobs.filter((j) => j.state === 'running' && (!role || j.role === role));
    R.runningJobs = runningJobs;

    /** What a node needs read when it is shown (once; events and Refresh read again). */
    function ensure(c, n) {
        if (S.denied) return;
        if (!S.loaded) return;
        if (n.server) {
            if (S.subscribed !== n.server) subscribe(c, n.server);
            void loadHostPower(c, n.server);
            void loadInfo(c, n.server);
            void loadJobs(c, n.server);
        }
        if (n.kind === 'root') S.servers.forEach((s) => { void loadIloPower(c, s.name); void loadInfo(c, s.name); });
        if (n.kind === 'role') void loadRole(c, n.server, n.role);
        R.hooks.ensure.forEach((fn) => fn(c, n));
    }

    async function loadIloPower(c, server) {
        const st = ss(server);
        if (st.loading.power || st.ilo.power || st.ilo.powerErr) return;
        st.loading.power = true;
        try { st.ilo.power = await ilo(server, 'power'); } catch (e) { st.ilo.powerErr = (e && e.message) || 'iLO did not answer.'; }
        st.loading.power = false;
        repaint(c);
    }
    R.loadIloPower = loadIloPower;

    // ---- the server's push feed ---------------------------------------------------------------------------------

    function wireFeed(c) {
        const ws = root.wsClient;
        if (S.feedWired || !ws || typeof ws.on !== 'function') return;
        S.feedWired = true;
        ws.on('rack_event', (msg) => onEvent(c, (msg && msg.data && msg.data.server ? msg.data : msg) || {}), { signal: appScopeSignal });
        // the server forgets a dropped socket's subscriptions
        ws.on('connected', () => { const s = S.subscribed; S.subscribed = null; if (s && live(c)) subscribe(c, s); void loadList(c); }, { signal: appScopeSignal });
    }

    async function subscribe(c, server) {
        const old = S.subscribed;
        S.subscribed = server;
        try {
            if (old && old !== server) await send('rack_unsubscribe', { server: old });
            await send('rack_subscribe', { server });
        } catch (e) { S.subscribed = null; }
    }

    const timers = new Map();
    function later(key, ms, fn) { clearTimeout(timers.get(key)); timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, ms)); }

    function onEvent(c, ev) {
        if (!live(c)) return;
        const server = ev.server;
        if (!server) return;
        const st = ss(server);
        const here0 = here(c);
        const mine = here0.server === server;
        if (R.hooks.event.some((fn) => fn(c, ev) === true)) return;
        if (ev.role === 'power' && ev.kind === 'state') {
            const prev = powerState(server);
            st.power = Object.assign({}, st.power, typeof ev.data === 'string' ? { state: ev.data } : normPower(ev.data));
            const now = powerState(server);
            if (now !== 'up' && prev === 'up') { st.info = null; st.roles = {}; st.jobs = []; st.jobsLoaded = false; st.metrics = null; }
            if (now === 'up' && prev !== 'up') { st.info = null; st.roles = {}; st.jobsLoaded = false; void loadList(c).then(() => { if (live(c)) { const n2 = here(c); if (n2.server === server) ensure(c, n2); } }); }
            if (mine || here0.kind === 'root') repaint(c);
            return;
        }
        if (ev.role === 'rackd' && ev.kind === 'state') {
            const m0 = meta(server);
            const d = typeof ev.data === 'string' ? { state: ev.data } : (ev.data || {});
            if (m0) m0.rackd = Object.assign({}, m0.rackd, d);
            if (d.state === 'up') { st.info = null; if (mine) ensure(c, here0); }
            if (mine || here0.kind === 'root') repaint(c);
            return;
        }
        if (ev.kind === 'metrics') { st.metrics = ev.data || null; if (mine && here0.kind === 'server') repaint(c); return; }
        if (ev.kind === 'job') {
            const j = ev.data && ev.data.id ? ev.data : (ev.id ? Object.assign({ id: ev.id }, ev.data || {}) : null);
            if (j) { noteJob(server, j); if (!j.log && j.state && j.state !== 'running') { void send('rack_job', { server, id: j.id }).then((r) => { noteJob(server, (r && r.job) || r); repaint(c); }).catch(() => {}); } }
            if (mine) repaint(c);
            // a finished job changed what its role shows
            if (j && j.state && j.state !== 'running' && j.role) { const rs = st.roles[j.role]; if (rs) rs.at = 0; if (here0.kind === 'role' && here0.role === j.role) later(`role:${server}:${j.role}`, 300, () => { void loadRole(c, server, j.role, true); }); }
            return;
        }
        if (ev.role === 'ilo') {
            if (ev.kind === 'power') st.ilo.power = Object.assign({}, st.ilo.power || {}, ev.data || {});
            if (ev.kind === 'health') st.ilo.health = ev.data;
            if (mine) repaint(c);
            return;
        }
        if (ev.kind === 'state' || ev.kind === 'added' || ev.kind === 'removed') {
            const rs = st.roles[ev.role];
            if (rs && rs.data) {
                // a pushed state of one thing is applied now; the list is read again right after
                later(`role:${server}:${ev.role}`, 400, () => { if (live(c)) void loadRole(c, server, ev.role, true); });
            }
            const info = st.info;
            if (info && ev.role) later(`info:${server}`, 1500, () => { if (live(c)) void loadInfo(c, server, true); });
        }
    }

    // ---- pages -------------------------------------------------------------------------------------------------

    const plain = (c, title, side, html) => c.page(title, side, [{ id: 'rm-main', title, body: html }]);
    R.plain = plain;

    function deniedPage(c) {
        return c.page(TITLE, '', [{ id: 'rm-denied', title: 'Access is denied', body: `<p>${c.state(false, 'Rack Manager needs the Administrator. Sign in as the Administrator to use it.')}</p>` }]);
    }

    const rackdText = (m) => {
        const r = m && m.rackd ? m.rackd : {};
        return r.state === 'up' ? 'Running' : r.state === 'down' ? 'Not answering' : r.state === 'not-deployed' ? 'Not deployed' : r.state === 'connecting' ? 'Connecting' : 'Unknown';
    };
    const powerText = (m, st) => {
        const p = st && st.ilo && st.ilo.power;
        if (m && m.ilo && m.ilo.power === 'on') return 'On';
        if (m && m.ilo && m.ilo.power === 'off') return 'Off';
        if (m && m.ilo && typeof m.ilo.power === 'boolean') return m.ilo.power ? 'On' : 'Off';
        return p ? 'On' : 'Unknown';
    };
    /** The host's state in words: the power state machine when known, else the iLO's On / Off. */
    const hostText = (m, st) => {
        if (m && ((st && st.power && st.power.state) || m.power || powerState(m.name) !== 'up')) return PSTATE[powerState(m.name)] || powerState(m.name);
        return powerText(m, st);
    };
    R.hostText = hostText;
    R.rackdText = rackdText;
    R.powerText = powerText;

    function rolesSummaryText(st) {
        const roles = st.info && st.info.roles;
        if (!roles) return '';
        const n = ROLES.filter((r) => roles[r.id] && roles[r.id].installed).length;
        return `${n} of ${ROLES.length} installed`;
    }

    function rootPage(c) {
        if (!S.loaded) return plain(c, TITLE, 'Reading data, please wait...', '<p>Reading data, please wait...</p>');
        if (S.error) return plain(c, TITLE, '', `<p>${c.state(false, `The server list could not be read. ${S.error}`)}</p><div class="mmc-buttons">${btnHtml('refresh', 'Try Again')}</div>`);
        const cols = [
            { t: 'Name', w: 96, key: 'name', text: (x) => x.s.label },
            { t: 'Power', w: 74, key: 'power', text: (x) => hostText(x.s, x.st) },
            { t: 'Watts', w: 52, num: true, key: 'watts', value: (x) => wattsOf(x.st) || 0, text: (x) => (wattsOf(x.st) ? `${wattsOf(x.st)} W` : '') },
            { t: 'rackd', w: 80, key: 'rackd', text: (x) => rackdText(x.s) },
            { t: 'Roles', w: 150, key: 'roles', text: (x) => rolesSummaryText(x.st) }
        ];
        const rows = S.servers.map((s) => ({ key: s.name, icon: SRV16, open: `nav:s:${s.name}`, data: { s, st: ss(s.name) } }));
        const list = c.listView(cols, rows, { sortId: 'rm-servers2', empty: 'No servers are configured.', fit: true });
        return c.page(TITLE, `${S.servers.length} server${S.servers.length === 1 ? '' : 's'}`, [
            { id: 'rm-intro', title: 'Overview', body: c.overview(SRV32, ['Rack Manager runs the rack servers: their iLO (console, hardware, power) and the roles Dreamscape moves onto them (virtual machines, Android devices, sandboxes, containers, builds and more).', 'Select a server in the console tree, or open one below.']) },
            { id: 'rm-servers', title: 'Servers', body: list }
        ]);
    }
    const wattsOf = (st) => { const p = st && st.ilo && st.ilo.power; return p && (p.present != null ? p.present : p.watts != null ? p.watts : null); };

    /** "At a Glance": one card per role with what runs and what is there. Counts come from rackd's info (roles[id].running
     *  when rackd sends it, else read from the role's summary line); a card opens its role. Pushed data only, nothing polled. */
    function glanceCards(c, n) {
        const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
        const st = n.ss;
        const roles = st.info && st.info.roles;
        if (!roles) return '<p class="mmc-hint">Reading data, please wait...</p>';
        const num = (re, txt) => { const m = re.exec(String(txt || '')); return m ? Number(m[1]) : null; };
        const pair = (re, txt) => { const m = re.exec(String(txt || '')); return m ? [Number(m[1]), Number(m[2])] : null; };
        const runOf = (x) => (typeof x.running === 'number' ? x.running : null);
        const jobs = runningJobs(n.server).length;
        const leases = arr((st.power || {}).leases).length;
        const card = (id, big, sub, warn) => {
            const r = ROLES.find((y) => y.id === id) || { name: id, i32: SRV32 };
            const x = roles[id] || {};
            if (!x.installed) return `<button type="button" class="rm-card is-off" data-act="nav:s:${esc(n.server)}:r:${esc(id)}"><img src="${esc(r.i32)}" alt=""><span class="rm-card-t">${esc(r.name)}</span><b class="rm-card-n">-</b><span class="rm-card-s">Not installed</span></button>`;
            return `<button type="button" class="rm-card${warn ? ' is-warn' : ''}" data-act="nav:s:${esc(n.server)}:r:${esc(id)}" title="${esc(x.summary || '')}"><img src="${esc(r.i32)}" alt=""><span class="rm-card-t">${esc(r.name)}</span><b class="rm-card-n">${esc(big)}</b><span class="rm-card-s">${esc(sub)}</span></button>`;
        };
        const R0 = (id) => roles[id] || {};
        const vmTotal = num(/(\d+) VM/, R0('vms').summary);
        const vmRun = runOf(R0('vms'));
        const av = pair(/(\d+) AVD\(s\), (\d+) running/, R0('android').summary);
        const sb = pair(/(\d+)\/(\d+) running/, R0('sandboxes').summary);
        const ct = pair(/(\d+)\/(\d+) running/, R0('containers').summary);
        const rp = num(/(\d+) replica/, R0('replicas').summary);
        const bp = pair(/(\d+) pipeline\(s\), (\d+) running/, R0('builds').summary);
        const tm = num(/(\d+) tmux/, R0('terminal').summary);
        const rd = num(/(\d+) RAM disk/, R0('storage').summary);
        const up = num(/(\d+) upgradable/, R0('updates').summary);
        const rs = num(/(\d+) rack service/, R0('services').summary);
        const unmanaged = arr(st.info.unmanaged);
        const cards = [
            card('vms', vmRun != null ? `${vmRun} running` : `${vmTotal == null ? '-' : vmTotal}`, vmRun != null ? `of ${vmTotal == null ? '?' : vmTotal} virtual machines` : 'virtual machines'),
            card('android', av ? `${av[1]} running` : '-', av ? `of ${av[0]} devices` : ''),
            card('sandboxes', sb ? `${sb[0]} running` : '-', sb ? `of ${sb[1]} browsers` : ''),
            card('containers', ct ? `${ct[0]} running` : '-', ct ? `of ${ct[1]} containers` : ''),
            card('replicas', rp == null ? '-' : String(rp), rp === 1 ? 'Dreamscape replica' : 'Dreamscape replicas'),
            card('builds', bp ? `${bp[1]} running` : '-', bp ? `${bp[0]} pipelines${jobs ? `, ${jobs} job${jobs === 1 ? '' : 's'}` : ''}` : ''),
            card('terminal', tm == null ? '-' : String(tm), tm === 1 ? 'tmux session' : 'tmux sessions'),
            card('storage', rd == null ? '-' : String(rd), rd === 1 ? 'RAM disk' : 'RAM disks'),
            card('services', rs == null ? '-' : String(rs), rs === 1 ? 'rack service' : 'rack services'),
            card('updates', up == null ? '-' : String(up), up === 1 ? 'update available' : 'updates available', up > 0)
        ].join('');
        const extra = `<p class="rm-card-foot">${leases ? `${leases} lease${leases === 1 ? '' : 's'} keep this server on. ` : ''}${unmanaged.length ? `${c.state(false, `${unmanaged.length} thing${unmanaged.length === 1 ? '' : 's'} running outside Rack Manager`, true)}` : ''}</p>`;
        return `<div class="rm-cards">${cards}</div>${leases || unmanaged.length ? extra : ''}`;
    }

    function serverPage(c, n) {
        const m = n.meta;
        if (!m) return plain(c, 'Server', '', '<p>This server is not in the list.</p>');
        const st = n.ss;
        const info = st.info;
        const rows = [
            ['Server', esc(`${m.label} (${m.model})`)],
            ['iLO', m.ilo && m.ilo.connected ? 'Console session open' : m.ilo && m.ilo.power != null ? 'Available' : c.state(false, 'Not answering', true)],
        ];
        let host = '';
        if (info) {
            const cpus = info.cpus || {};
            const mem = info.memory || {};
            host = c.props([
                ['Host name', esc(info.host)],
                ['Operating system', esc(`${info.os || ''} (kernel ${info.kernel || ''})`)],
                ['Uptime', esc(dur(info.uptimeS))],
                ['Processors', esc(`${cpus.count || ''} x ${cpus.model || ''}, ${cpus.threads || ''} threads`)],
                ['Memory', esc(`${bytes(mem.totalB)} total, ${bytes(mem.availB)} available`)],
                ['Load average', esc((info.load || []).map((x) => Number(x).toFixed(2)).join('  '))],
                ['rackd version', esc(info.rackd ? `${info.rackd.version} (started ${when(info.rackd.startedAt)})` : '')]
            ]);
        } else if (powerState(n.server) !== 'up') host = `<p>${c.state(false, `${m.label} is ${powerState(n.server) === 'off' ? 'turned off' : (PSTATE[powerState(n.server)] || '').toLowerCase()}. Host information and roles are available when it is running.`, true)}</p>`;
        else if (st.infoErr) host = `<p>${c.state(false, `The host could not be read. ${st.infoErr}`)}</p>`;
        else if (m.rackd && m.rackd.state === 'not-deployed') host = `<p>${c.state(false, `rackd is not deployed on ${m.label}. Host information and roles need it (scripts/rack/deploy-rackd.sh ${m.name}).`, true)}</p>`;
        else if (m.rackd && m.rackd.state === 'down') host = `<p>${c.state(false, `rackd is not answering on ${m.label}.`)}</p>`;
        else host = '<p>Reading data, please wait...</p>';
        const roles = info && info.roles ? ROLES.map((r) => {
            const x = info.roles[r.id] || {};
            return { key: r.id, icon: r.i16, open: `nav:s:${n.server}:r:${r.id}`, data: { r, x } };
        }) : [];
        const rolesList = info ? c.listView([
            { t: 'Role', w: 190, key: 'r', text: (d) => d.r.name },
            { t: 'Installed', w: 70, key: 'i', text: (d) => (d.x.installed ? 'Yes' : 'No') },
            { t: 'Status', w: 300, key: 's', text: (d) => (d.x.installed ? (d.x.summary || (d.x.ready ? 'Ready' : 'Not ready')) : (d.x.missing && d.x.missing.length ? `Needs ${d.x.missing.join(', ')}` : '')) }
        ], roles, { sortId: 'rm-sum-roles', fit: true }) : '';
        const jobs = runningJobs(n.server);
        const mt = st.metrics;
        let metrics = '<p class="mmc-hint">Waiting for the first metrics push from rackd...</p>';
        if (mt) {
            const memT = mt.mem && (mt.mem.totalB || (info && info.memory && info.memory.totalB));
            const memU = mt.mem && (mt.mem.usedB != null ? mt.mem.usedB : memT - (mt.mem.availB || 0));
            metrics = `<dl class="mmc-props"><dt>Processor:</dt><dd>${bar(Number(mt.cpu) || 0)}</dd><dt>Memory:</dt><dd>${memT ? bar((memU / memT) * 100) : ''}<span class="mmc-hint">${memT ? `${bytes(memU)} of ${bytes(memT)}` : ''}</span></dd>`
                + `<dt>Load average:</dt><dd>${esc((mt.load || []).map((x) => Number(x).toFixed(2)).join('  '))}</dd>`
                + (mt.net ? `<dt>Network:</dt><dd>${esc(`receive ${bytes(mt.net.rxBps != null ? mt.net.rxBps : mt.net.rx)}/s, send ${bytes(mt.net.txBps != null ? mt.net.txBps : mt.net.tx)}/s`)}</dd>` : '')
                + (mt.disk ? `<dt>Disk:</dt><dd>${esc(`read ${bytes(mt.disk.rBps != null ? mt.disk.rBps : mt.disk.read)}/s, write ${bytes(mt.disk.wBps != null ? mt.disk.wBps : mt.disk.write)}/s`)}</dd>` : '') + '</dl>';
        }
        return c.page(m.label, m.model, [
            { id: 'rm-srv', title: 'Server', body: c.props(rows) + `<div class="mmc-buttons">${btnHtml('nav-console', 'Open Console', n.server)}${btnHtml('nav-power', 'Power', n.server)}${btnHtml('nav-hardware', 'Hardware', n.server)}</div>` },
            info ? { id: 'rm-glance', title: 'At a Glance', body: glanceCards(c, n) } : null,
            R.hostBrief ? R.hostBrief(c, n) : null,
            R.unmanagedSection ? R.unmanagedSection(c, n) : null,
            R.loadSection ? R.loadSection(c, n) : null,
            { id: 'rm-host', title: 'Host', body: host },
            info ? { id: 'rm-roles', title: 'Roles Summary', body: rolesList + `<div class="mmc-buttons">${btnHtml('addroles', 'Add Roles...')}</div>` } : null,
            jobs.length ? { id: 'rm-jobs', title: 'Running Jobs', body: jobs.map((j) => `<p>${esc(j.title || j.id)} ${link('nav-jobs', 'View', n.server)}</p>`).join('') } : null,
            { id: 'rm-metrics', title: 'Live Metrics', body: metrics }
        ]);
    }

    // ---- the role gate: rackd down, role not installed, errors, reading ----------------------------------------------

    /** One clear state when the host is not up (no errors, no waking): off, powering on, booting, shutting down. */
    function hostPage(c, n, title) {
        const ps = powerState(n.server);
        if (ps === 'up') return null;
        const m = n.meta;
        let body;
        if (ps === 'off') body = `<p>${c.state(false, `${m.label} is turned off.`, true)}</p><p class="mmc-hint">Opening a page does not turn it on. Its roles are available when it is on; it turns on by itself when work needs it.</p><div class="mmc-buttons">${btnHtml('host-on', 'Power On')}</div>`;
        else if (ps === 'powering-on') { const po = postOf(n.server); body = `<p>${c.state(false, `${m.label} is powering on.`, true)}</p>${postBar(po)}`; }
        else if (ps === 'booting') body = `<p>${c.state(false, `${m.label} is starting its operating system.`, true)}</p>${bar(0, 'is-marquee')}<p class="mmc-hint">The roles are available as soon as rackd answers.</p>`;
        else body = `<p>${c.state(false, `${m.label} is shutting down.`, true)}</p>`;
        return plain(c, title, PSTATE[ps], body);
    }
    const postBar = (po) => `${bar(po.pct == null ? 0 : po.pct, po.pct == null ? 'is-marquee' : '')}<p class="mmc-hint">${esc(po.stage || 'Starting')}${po.code ? ` (${esc(po.code)})` : ''}${po.pct != null && po.eta != null ? ` - about ${esc(dur(po.eta))} left` : ''}</p>`;
    R.postBar = postBar;

    /** The page of a role that cannot show data, or null when it can. */
    function gate(c, n) {
        const m = n.meta;
        const st = n.ss;
        const role = roleOf(n.role);
        const title = role ? role.name : n.role;
        if (!m) return plain(c, title, '', '<p>This server is not in the list.</p>');
        const hp = hostPage(c, n, title);
        if (hp) return hp;
        const rk = (m.rackd && m.rackd.state) || '';
        if (rk === 'not-deployed') return plain(c, title, 'rackd is not deployed', `<p>${c.state(false, `rackd is not deployed on ${m.label}, so its roles cannot be used. There is no data to show.`, true)}</p><p class="mmc-hint">Deploy it with scripts/rack/deploy-rackd.sh ${esc(m.name)}.</p><div class="mmc-buttons">${btnHtml('refresh', 'Check Again')}</div>`);
        if (rk === 'down') return plain(c, title, 'rackd is not answering', `<p>${c.state(false, `rackd is not answering on ${m.label}${m.rackd.error ? `: ${m.rackd.error}` : '.'}`)}</p><div class="mmc-buttons">${btnHtml('refresh', 'Try Again')}</div>`);
        const x = st.info && st.info.roles && st.info.roles[n.role];
        if (x && !x.installed) {
            return plain(c, title, 'Not installed', `<p>${c.state(false, `The ${title} role is not installed on ${m.label}.${x.missing && x.missing.length ? ` It needs: ${x.missing.join(', ')}.` : ''}`, true)}</p><div class="mmc-buttons">${btnHtml('addroles', 'Add Role...', n.role)}</div>`);
        }
        const rs = st.roles[n.role];
        if (rs && rs.error && !rs.data) return plain(c, title, 'Error', `<p>${c.state(false, `${title} could not be read. ${rs.error}`)}</p><div class="mmc-buttons">${btnHtml('refresh', 'Try Again')}</div>`);
        if (!rs || !rs.data) return plain(c, title, 'Reading data, please wait...', '<p>Reading data, please wait...</p>');
        return null;
    }
    R.gate = gate;

    /** A strip with the running jobs of a role (their progress is pushed), for the top of a role page. */
    function jobStrip(n, role) {
        const js = runningJobs(n.server, role || n.role);
        if (!js.length) return '';
        return `<div class="rm-jobstrip">${js.map((j) => `<div><img src="${jobIcon(j.state)}" alt=""><span>${esc(j.title || j.id)}</span><div class="mmc-progress rm-bar"><div role="progressbar" class="is-marquee" aria-valuemin="0" aria-valuemax="100"><div></div></div></div>${link('nav-jobs', 'View', n.server)}</div>`).join('')}</div>`;
    }
    R.jobStrip = jobStrip;

    // ---- Roles and Jobs ----------------------------------------------------------------------------------------------

    function rolesPage(c, n) {
        const st = n.ss;
        const info = st.info;
        if (!info) {
            const g = gate(c, Object.assign({}, n, { role: 'vms' }));
            if (g && (n.meta && n.meta.rackd && n.meta.rackd.state !== 'up' && n.meta.rackd.state !== 'connecting')) return g.replace(/Virtual Machines/g, 'Roles');
            return plain(c, 'Roles', st.infoErr ? 'Error' : 'Reading data, please wait...', st.infoErr ? `<p>${c.state(false, `The roles could not be read. ${st.infoErr}`)}</p><div class="mmc-buttons">${btnHtml('refresh', 'Try Again')}</div>` : '<p>Reading data, please wait...</p>');
        }
        const rows = ROLES.map((r) => ({ key: r.id, icon: r.i16, open: `nav:s:${n.server}:r:${r.id}`, data: { r, x: info.roles[r.id] || {} } }));
        const list = c.listView([
            { t: 'Role', w: 190, key: 'r', text: (d) => d.r.name },
            { t: 'Installed', w: 70, key: 'i', text: (d) => (d.x.installed ? 'Yes' : 'No') },
            { t: 'Status', w: 220, key: 's', text: (d) => (d.x.installed ? (d.x.summary || (d.x.ready ? 'Ready' : 'Not ready')) : 'Not installed') },
            { t: 'Description', w: 340, key: 'd', text: (d) => d.r.desc }
        ], rows, { sortId: 'rm-roles', fit: true });
        const installed = ROLES.filter((r) => info.roles[r.id] && info.roles[r.id].installed).length;
        return c.page('Roles', `${installed} of ${ROLES.length} installed`, [
            { id: 'rm-roles-sum', title: 'Roles Summary', body: c.overview(`${ITEMS}/administrative-tools-32.png`, [`Roles are the work ${esc(n.meta.label)} does for Dreamscape. Add Roles installs what a role needs; a role page then shows its own state.`]) + `<div class="mmc-buttons">${btnHtml('addroles', 'Add Roles...')}</div>` },
            { id: 'rm-roles-list', title: 'Roles', body: list }
        ]);
    }

    const STATE_TEXT = { running: 'Running', done: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };
    function jobsPage(c, n) {
        const st = n.ss;
        const m = n.meta;
        if (m && m.rackd && m.rackd.state !== 'up' && m.rackd.state !== 'connecting') return plain(c, 'Jobs', rackdText(m), `<p>${c.state(false, `Jobs need rackd, which is ${rackdText(m).toLowerCase()} on ${m.label}.`, m.rackd.state === 'not-deployed')}</p>`);
        if (st.jobsError && !st.jobs.length) return plain(c, 'Jobs', 'Error', `<p>${c.state(false, `Jobs could not be read. ${st.jobsError}`)}</p><div class="mmc-buttons">${btnHtml('refresh', 'Try Again')}</div>`);
        if (!st.jobsLoaded) return plain(c, 'Jobs', 'Reading data, please wait...', '<p>Reading data, please wait...</p>');
        const rows = st.jobs.map((j) => ({ key: j.id, icon: jobIcon(j.state), data: j }));
        const list = c.listView([
            { t: 'Job', w: 230, key: 't', text: (j) => j.title || j.id },
            { t: 'Role', w: 100, key: 'r', text: (j) => (roleOf(j.role) ? roleOf(j.role).name : j.role || '') },
            { t: 'State', w: 80, key: 's', text: (j) => STATE_TEXT[j.state] || j.state || '' },
            { t: 'Started', w: 130, key: 'a', value: (j) => Number(j.startedAt) || 0, text: (j) => when(j.startedAt) },
            { t: 'Duration', w: 90, key: 'd', value: (j) => (Number(j.endedAt || Date.now()) - Number(j.startedAt || 0)), text: (j) => (j.startedAt ? dur(((j.endedAt || Date.now()) - j.startedAt) / 1000) : '') },
            { t: 'Exit', w: 40, num: true, key: 'e', text: (j) => (j.exitCode == null ? '' : String(j.exitCode)) }
        ], rows, { sortId: 'rm-jobs', sort: { key: 'a', dir: -1 }, empty: 'There are no jobs.', fit: true });
        const sel = st.jobs.find((j) => j.id === c.sel) || null;
        const logBody = sel ? (sel.log ? pre(Array.isArray(sel.log) ? sel.log.join('\n') : sel.log) : '<p class="mmc-hint">Reading the log...</p>') : '<p class="mmc-hint">Select a job to see the end of its log.</p>';
        return c.page('Jobs', `${runningJobs(n.server).length} running`, [
            { id: 'rm-jobs-list', title: 'Jobs', body: list },
            { id: 'rm-jobs-log', title: sel ? `Log: ${sel.title || sel.id}` : 'Log', body: logBody }
        ]);
    }

    async function readJob(c, server, id) {
        try { const r = await send('rack_job', { server, id }); noteJob(server, (r && r.job) || r); } catch (e) { noteJob(server, { id, log: `The log could not be read: ${(e && e.message) || e}` }); }
        repaint(c);
    }

    // ---- Add Roles ---------------------------------------------------------------------------------------------------

    function addRoles(c, preset) {
        const n = here(c);
        if (!n.server) return;
        const st = n.ss;
        const info = st.info && st.info.roles ? st.info.roles : {};
        const choices = ROLES.filter((r) => info[r.id] && !info[r.id].installed);
        const server = n.server;
        const m = n.meta;
        let jobId = null;
        const list = choices.length ? choices.map((r) => `<label class="rm-check rm-rolecheck"><input type="checkbox" data-rm="role:${r.id}"${preset === r.id ? ' checked' : ''}><img src="${r.i16}" alt=""><span><b>${esc(r.name)}</b><i>${esc(r.desc)}${info[r.id].missing && info[r.id].missing.length ? ` Installs ${esc(info[r.id].missing.join(', '))}.` : ''}</i></span></label>`).join('') : '<p>Every role is already installed on this server.</p>';
        wizard(c, {
            id: 'addroles',
            title: 'Add Roles Wizard',
            icon: `${ITEMS}/administrative-tools-32.png`,
            w: 520,
            h: 340,
            pages: [
                { key: 'intro', instruction: 'Before you begin', html: `<p>This wizard installs the software a role needs on ${esc(m.label)} (packages from the system's own repositories). Roles that are already installed are not listed.</p><p>The install runs as a job on the server; you can close this wizard and watch it under Jobs.</p>` },
                {
                    key: 'pick', instruction: 'Select one or more roles to install', html: `<div class="rm-rolelist">${list}</div>`, nextText: 'Install',
                    next: async (ctx) => {
                        const ids = choices.filter((r) => val(ctx, `role:${r.id}`)).map((r) => r.id);
                        if (!ids.length) { err(ctx, 'Select at least one role.'); return false; }
                        err(ctx, '');
                        ctx.store.ids = ids;
                        ctx.store.jobs = [];
                        try {
                            for (const id of ids) { const r = await act(server, 'roles', 'install', { role: id }); if (r.job) ctx.store.jobs.push(r.job.id); }
                        } catch (e) { err(ctx, (e && e.message) || 'The install could not be started.'); return false; }
                        jobId = ctx.store.jobs[0] || null;
                        return 'progress';
                    }
                },
                {
                    key: 'progress', instruction: 'Installation progress', finish: true, noBack: true,
                    html: '<div class="rm-wizlog"><div class="mmc-progress rm-bar"><div role="progressbar" class="is-marquee" data-rm-prog aria-valuemin="0" aria-valuemax="100"><div></div></div></div><pre class="rm-pre" data-rm-log data-mmc-scroll>Starting...</pre></div>',
                    show: (ctx) => {
                        const paint = () => {
                            const js = (ctx.store.jobs || []).map((id) => ss(server).jobs.find((j) => j.id === id)).filter(Boolean);
                            const logEl = ctx.content.querySelector('[data-rm-log]');
                            const barEl = ctx.content.querySelector('[data-rm-prog]');
                            if (!logEl || !js.length) return;
                            logEl.textContent = js.map((j) => `${j.title || j.id}: ${STATE_TEXT[j.state] || j.state}\n${Array.isArray(j.log) ? j.log.join('\n') : (j.log || '')}`).join('\n\n');
                            logEl.scrollTop = logEl.scrollHeight;
                            const done = js.every((j) => j.state && j.state !== 'running');
                            if (barEl) { barEl.classList.toggle('is-marquee', !done); barEl.classList.toggle('is-error', done && js.some((j) => j.state !== 'done')); barEl.setAttribute('aria-valuenow', done ? '100' : '0'); barEl.style.setProperty('--rm-pct', done ? 100 : 0); }
                        };
                        ctx.store.paint = paint;
                        R.hooks.event.push(ctx.store.hook = (cc, ev) => { if (ev.kind === 'job' && ev.server === server) setTimeout(paint, 0); return false; });
                        paint();
                        (ctx.store.jobs || []).forEach((id) => { void readJob(c, server, id).then(paint); });
                    }
                }
            ],
            finish: (ctx) => { const i = R.hooks.event.indexOf(ctx.store.hook); if (i >= 0) R.hooks.event.splice(i, 1); void loadInfo(c, server, true); (ctx.store.ids || []).forEach((id) => { const rs = ss(server).roles[id]; if (rs) { rs.data = null; rs.error = ''; } }); repaint(c); return true; },
            cancel: (ctx) => { const i = R.hooks.event.indexOf(ctx.store.hook); if (i >= 0) R.hooks.event.splice(i, 1); }
        });
        void jobId;
    }

    // ---- commands ------------------------------------------------------------------------------------------------------

    /** Shut Down: a task dialog that says what keeps the host busy; leases need the second link. */
    async function hostOff(c, n) {
        await loadHostPower(c, n.server, true);
        const p = ss(n.server).power || {};
        const leases = arr0(p.leases);
        const busy = arr0(p.idle && p.idle.busy);
        const why = busy.map((b) => `${b.kind}${b.id ? ` ${b.id}` : ''}: ${b.why || ''}`).concat(leases.map((l) => `lease: ${l.purpose}`)).slice(0, 8);
        const links = leases.length || busy.length
            ? [{ id: 'force', text: 'Shut down anyway', sub: 'Work in progress is stopped in an orderly way where it can be.', danger: true }]
            : [{ id: 'go', text: `Shut down ${n.meta.label}`, sub: 'Virtual machines and emulators are shut down first, RAM disks are synced.' }];
        const a = await taskDialog(c, { title: `Shut Down: ${n.meta.label}`, instruction: `Shut down ${n.meta.label}?`, text: why.length ? `It is not idle:<br>${why.map((x) => esc(x)).join('<br>')}` : 'It has no work now.', links, h: 150 + why.length * 16 });
        if (a) await send('rack_power', { server: n.server, action: 'off', reason: 'Rack Manager console', confirm: true, force: a === 'force' });
        await loadHostPower(c, n.server, true);
    }
    const arr0 = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    R.arr = arr0;

    function commands(node, c) {
        if (S.denied) return [];
        const n = here(c);
        const out = [];
        const part = R.commands[n.kind === 'role' ? `role:${n.role}` : n.kind];
        // a role whose host is not running has nothing to do but Power On
        const usable = !(n.kind === 'role' && n.server && powerState(n.server) !== 'up');
        if (typeof part === 'function' && usable) out.push(...(part(n, c) || []));
        if (n.server) { const ps = powerState(n.server); out.push(ps === 'off' ? { text: 'Power On', action: 'host-on', icon: `${ITEMS}/power-options-16.png` } : { text: 'Shut Down...', action: 'host-off', disabled: ps !== 'up' }); }
        if (n.kind === 'server') out.push({ text: 'Console', action: `nav-console`, icon: `${VI}/remote-access-16.png` }, { text: 'Power', action: 'nav-power', icon: `${ITEMS}/power-options-16.png` }, { text: 'Add Roles...', action: 'addroles' });
        if (n.kind === 'roles') out.push({ text: 'Add Roles...', action: 'addroles', icon: `${ITEMS}/administrative-tools-16.png` });
        if (n.kind === 'jobs') {
            const j = n.ss.jobs.find((x) => x.id === c.sel);
            out.push({ text: 'Cancel Job', action: 'job-cancel', disabled: !(j && j.state === 'running') });
        }
        return out;
    }

    function selCommands(node, key, c) {
        if (S.denied || key == null) return null;
        const n = here(c);
        if (n.kind === 'role' && n.server && powerState(n.server) !== 'up') return null;
        const part = R.selCommands[n.kind === 'role' ? `role:${n.role}` : n.kind];
        return typeof part === 'function' ? part(n, key, c) : null;
    }

    const goNode = (c, suffix) => { const n = here(c); if (n.server) c.select(`s:${n.server}${suffix}`, true); };

    async function action(a, c, arg) {
        const name = a.split(':')[0];
        const param = arg != null && arg !== '' ? arg : a.slice(name.length + 1);
        const n = here(c);
        switch (name) {
            case 'refresh': {
                if (n.kind === 'root') { S.servers.forEach((s) => { ss(s.name).ilo = {}; }); await loadList(c); return true; }
                if (n.server) {
                    const st = n.ss;
                    const m = meta(n.server);
                    await loadList(c);
                    st.info = null;
                    if (n.kind === 'role') { const rs = st.roles[n.role]; if (rs) { rs.data = null; rs.error = ''; } }
                    st.jobsLoaded = false;
                    if (R.hooks.refresh) R.hooks.refresh.forEach((fn) => fn(c, n));
                    ensure(c, n);
                    void m;
                }
                repaint(c);
                return true;
            }
            case 'nav-console': c.select(`s:${param || n.server}:console`, true); return true;
            case 'nav-power': c.select(`s:${param || n.server}:power`, true); return true;
            case 'nav-hardware': c.select(`s:${param || n.server}:hardware`, true); return true;
            case 'nav-jobs': c.select(`s:${param || n.server}:jobs`, true); return true;
            case 'addroles': addRoles(c, param || null); return true;
            case 'job-cancel': {
                const j = n.ss.jobs.find((x) => x.id === c.sel);
                if (!j) return true;
                await send('rack_job', { server: n.server, id: j.id, cancel: true });
                return true;
            }
            case 'host-on': await send('rack_power', { server: n.server, action: 'on', reason: 'Rack Manager console' }); await loadHostPower(c, n.server, true); return true;
            case 'host-off': await hostOff(c, n); return true;
            case 'help': return true;
            default: {
                const fn = R.actions[name];
                if (typeof fn === 'function') { await fn(c, param, n); return true; }
                return false;
            }
        }
    }

    function page(node, c) {
        if (S.denied || !isAdmin()) { S.denied = true; return deniedPage(c); }
        const n = here(c);
        // the node changed: what the old one held open (the terminal, a followed log) is let go
        if (S.shown !== c.node) { const old = parse(S.shown); S.shown = c.node; if (old.kind !== 'root' || S.shown) R.hooks.leave.forEach((fn) => { try { fn(c, old, n); } catch (_) { /* gone */ } }); }
        ensure(c, n);
        let out;
        if (n.kind === 'root') out = rootPage(c);
        else if (!n.meta) out = plain(c, TITLE, '', S.loaded ? '<p>This server is not in the list.</p>' : '<p>Reading data, please wait...</p>');
        else if (n.kind === 'server') out = serverPage(c, n);
        else if (n.kind === 'roles') out = rolesPage(c, n);
        else if (n.kind === 'jobs') out = jobsPage(c, n);
        else {
            const part = R.pages[n.kind === 'role' ? `role:${n.role}` : n.kind];
            out = typeof part === 'function' ? part(c, n) : plain(c, node.name, '', '<p>This page is not available.</p>');
        }
        return out;
    }

    function status(node, c) {
        if (S.denied) return 'Access is denied';
        if (!S.loaded) return 'Reading data, please wait...';
        const n = here(c);
        if (n.server && n.ss) { const j = runningJobs(n.server).length; if (j) return `${j} job${j === 1 ? '' : 's'} running`; }
        if (n.kind === 'root') return `${S.servers.length} servers`;
        return n.meta ? `${n.meta.label}: ${powerState(n.server) !== 'up' ? PSTATE[powerState(n.server)] : rackdText(n.meta)}` : '';
    }

    // ---- the status bar: panes with a light each (pushed data only: every repaint and row selection renders it again) ------

    const RUNRE = { vms: [/(\d+) VM/, null], android: [/(\d+) AVD\(s\), (\d+) running/, 'tr'], sandboxes: [/(\d+)\/(\d+) running/, 'rt'], containers: [/(\d+)\/(\d+) running/, 'rt'], builds: [/(\d+) pipeline\(s\), (\d+) running/, 'tr'] };
    /** "2 of 4 running" for a role, from rackd's info (running when sent, else the summary line). */
    function roleCount(st, role) {
        const x = (st.info && st.info.roles && st.info.roles[role]) || {};
        const re = RUNRE[role];
        const m = re ? re[0].exec(String(x.summary || '')) : null;
        let run = typeof x.running === 'number' ? x.running : null;
        let tot = null;
        if (m) { if (re[1] === 'tr') { tot = Number(m[1]); if (run == null) run = Number(m[2]); } else if (re[1] === 'rt') { run = Number(m[1]); tot = Number(m[2]); } else tot = Number(m[1]); }
        if (run != null && tot != null) return `${run} of ${tot} running`;
        if (run != null) return `${run} running`;
        return x.summary || '';
    }
    const stateKind = (x) => {
        const v = x && (typeof x.state === 'string' ? x.state : typeof x.status === 'string' ? x.status : x.running != null ? (x.running ? 'running' : 'stopped') : x.active != null ? String(x.active) : '');
        const t = String(v || '').toLowerCase();
        if (!t) return { kind: 'off', text: '' };
        const text = String(v).replace(/^./, (ch) => ch.toUpperCase());
        if (/^(running|up|active|ok|on|done|healthy|completed|ready)/.test(t)) return { kind: 'on', text };
        if (/fail|error|dead|crash|unhealthy/.test(t)) return { kind: 'bad', text };
        if (/stop|exit|off|inactive|shut|created|paused/.test(t)) return { kind: 'off', text };
        return { kind: 'warn', text };
    };
    /** The selected list row's item, found in the role's data by the row key (prefix:value). */
    function selItem(n, key) {
        if (key == null) return null;
        if (n.kind === 'jobs') { const j = n.ss.jobs.find((y) => y.id === key); return j ? { label: j.title || j.id, st: { kind: ({ running: 'warn', done: 'on', failed: 'bad', cancelled: 'warn' })[j.state] || 'off', text: STATE_TEXT[j.state] || j.state || '' }, icon: jobIcon(j.state) } : null; }
        const rs = n.kind === 'role' ? n.ss.roles[n.role] : null;
        if (!rs || !rs.data) return null;
        const v = String(key).replace(/^[a-z]{1,3}:/, '');
        let hit = null;
        const look = (a) => { if (!hit && Array.isArray(a)) hit = a.find((y) => y && typeof y === 'object' && [y.name, y.id, y.tag, y.unit, y.key].some((f) => f != null && (String(f) === String(key) || String(f) === v))) || null; };
        Object.values(rs.data).forEach(look);
        if (!hit) return null;
        return { label: String(hit.name || hit.title || hit.id || hit.unit || v), st: stateKind(hit) };
    }
    function statusPanes(node, c) {
        if (S.denied) return [{ icon: lightSrc('bad'), text: 'Access is denied' }];
        if (!S.loaded) return [{ text: 'Reading data, please wait...' }];
        const n = here(c);
        if (n.kind === 'root') {
            const up = S.servers.filter((s) => powerState(s.name) === 'up').length;
            return [{ text: `${S.servers.length} server${S.servers.length === 1 ? '' : 's'}` }, { icon: lightSrc(up ? 'on' : 'off'), text: `${up} running` }];
        }
        if (!n.meta) return [{ text: '' }];
        const m = n.meta;
        const st = n.ss;
        const ps = powerState(n.server);
        const out = [{ text: n.kind === 'server' ? m.label : n.kind === 'role' ? ((roleOf(n.role) || {}).name || '') : n.kind === 'jobs' ? 'Jobs' : m.label }];
        const hook = R.panes[n.kind === 'role' ? `role:${n.role}` : n.kind] || (n.kind === 'role' ? R.panes.role : null);
        let extra = [];
        if (typeof hook === 'function') { try { extra = hook(n, c) || []; } catch (_) { extra = []; } }
        if (n.kind === 'role' && ps === 'up') {
            const cnt = roleCount(st, n.role);
            if (cnt) out[0].text += `: ${cnt}`;
            const it = selItem(n, c.sel);
            if (it) extra.push({ icon: lightSrc(it.st.kind), text: `${it.label}${it.st.text ? `: ${it.st.text}` : ''}` });
        }
        if (n.kind === 'jobs') {
            const all = st.jobs.length;
            out[0].text = `${all} job${all === 1 ? '' : 's'}`;
            const it = selItem(n, c.sel);
            if (it) extra.push({ icon: it.icon, text: `${it.label}: ${it.st.text}` });
        }
        out.push(...extra);
        const pk = ps === 'up' ? 'on' : ps === 'off' ? 'off' : 'warn';
        if (n.kind !== 'console') out.push({ icon: lightSrc(pk), text: `Power: ${PSTATE[ps] || ps}`, title: `${m.label} power state` });
        const rk = (m.rackd && m.rackd.state) || '';
        out.push({ icon: lightSrc(rk === 'up' ? 'on' : rk === 'down' ? 'bad' : 'warn'), text: `rackd: ${rackdText(m)}`, title: m.rackd && m.rackd.error ? m.rackd.error : 'rackd, the agent on the server' });
        if (n.kind === 'server') {
            const ls = (st.power || {}).leases;
            const k = Array.isArray(ls) ? ls.length : 0;
            out.push({ icon: lightSrc(k ? 'warn' : 'off'), text: `${k} lease${k === 1 ? '' : 's'}`, title: 'Leases keep this server on' });
        }
        const jr = runningJobs(n.server).length;
        if (jr) out.push({ icon: JOBPIC.running, text: `${jr} job${jr === 1 ? '' : 's'} running` });
        return out;
    }

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: SRV16,
            icon32: SRV32,
            taskbarIcon: SRV32,
            width: 900,
            height: 640,
            treeWidth: 200,
            expanded: ['root'],
            nodes,
            page,
            commands,
            selCommands,
            toolbar: (node) => (node.id === 'root' ? [] : [{ id: 'refresh', i: 3, title: 'Refresh' }]),
            action,
            rowOpen: (key, node, c) => { const n = here(c); if (n.kind === 'jobs') void readJob(c, n.server, key); else if (n.kind === 'role' && n.role === 'vms' && R.vmConnect) void R.vmConnect(c, n.server, key); return false; },
            onSelectRow: (key, node, c) => {
                const n = here(c);
                if (n.kind === 'jobs') void readJob(c, n.server, key);
                const h = R.hooks.row; if (h) h.forEach((fn) => fn(key, n, c));
            },
            status,
            statusPanes,
            about: { version: '1.0.0', lines: ['Rack Manager runs the rack servers: iLO, virtual machines, Android devices, sandboxes, containers, builds and more.'] },
            onOpen: (c) => {
                S.console = c;
                // typed and changed fields on a page (data-rm-input): the page's own handler in R.inputs
                const resultEl = c.el('.mmc-result');
                const fire = (ev) => {
                    const el = ev.target.closest && ev.target.closest('[data-rm-input]');
                    if (!el || !resultEl.contains(el)) return;
                    const fn = R.inputs[el.dataset.rmInput];
                    if (fn) fn(el.type === 'checkbox' ? el.checked : el.value, el, c, ev);
                };
                resultEl.addEventListener('input', fire);
                resultEl.addEventListener('change', fire);
                R.hooks.open.forEach((fn) => fn(c));
                // the window keeps its opened size: a page with little in it (Reading data...) must not shrink it
                // the window manager may have settled a content-measured size (601x423 seen live) before this runs: set ours once per open
                const sizeIt = () => {
                    c.modal.style.width = `${Math.min(900, Math.max(480, root.innerWidth - 80))}px`;
                    c.modal.style.height = `${Math.min(640, Math.max(320, root.innerHeight - 90))}px`;
                };
                sizeIt();
                root.requestAnimationFrame(() => { if (parseInt(c.modal.style.width, 10) < 700 && root.innerWidth > 800) sizeIt(); });
                wireFeed(c);
                void loadList(c);
            },
            onClose: (c) => {
                R.hooks.close.forEach((fn) => { try { fn(c); } catch (_) { /* gone */ } });
                timers.forEach((t) => clearTimeout(t));
                timers.clear();
                const s = S.subscribed;
                S.subscribed = null;
                if (s) void send('rack_unsubscribe', { server: s }).catch(() => {});
                S.console = null;
                S.shown = null;
            }
        };
    }

    async function openRackManagerConsole(node) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        return root.mmcConsole.open(def(), node ? { node } : {});
    }

    R.def = def;
    root.mmcRack = R;
    root.openRackManager = openRackManagerConsole;
    root.mmcRackManager = { open: openRackManagerConsole, def };
})(typeof window !== 'undefined' ? window : globalThis);
