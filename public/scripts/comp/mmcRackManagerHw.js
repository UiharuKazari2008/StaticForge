/**
 * Rack Manager, part 2: the Hardware node. Health (temperatures with the server's sensor names, fans, power supplies,
 * drives in their front-panel layout, DIMM map), the iLO event log and the Integrated Management Log, and the iLO's settings
 * and users (add, modify, delete through Vista dialogs; dream_admin is protected). Data is ilo-console's, over rack_ilo.
 * Part of window.mmcRack (mmcRackManager.js).
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc, ITEMS, VI } = R;
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const val = (v) => (v == null ? '' : typeof v === 'object' ? `${v.value == null ? '' : v.value}${v.unit ? ` ${({ Celsius: '°C', Percentage: '%', Watts: 'W' }[v.unit] || v.unit)}` : ''}` : String(v));
    const numOf = (v) => Number(String(val(v)).replace(/[^\d.]/g, '')) || 0;

    const HW = { view: 'health', which: 'server', filter: '', important: false };

    const dotCls = (s) => { s = String(s || '').toLowerCase(); return /^(ok|good|redundant|green)/.test(s) ? 'is-ok' : /not installed|n\/a|absent|unknown|^$/.test(s) ? '' : /degraded|warn|caution/.test(s) ? 'is-warn' : 'is-bad'; };
    const dot = (s) => `<span class="rm-dot ${dotCls(s)}"></span>`;

    // ---- loading ---------------------------------------------------------------------------------------------

    async function once(c, server, key, fn, force) {
        const st = R.ss(server);
        if (st.loading[key] || (!force && (st.ilo[key] !== undefined || st.ilo[`${key}Err`]))) return;
        st.loading[key] = true;
        delete st.ilo[`${key}Err`];
        try { st.ilo[key] = await fn(); } catch (e) { st.ilo[`${key}Err`] = (e && e.message) || 'iLO did not answer.'; }
        st.loading[key] = false;
        R.repaint(c);
    }
    const loadMeta = (c, server) => once(c, server, 'meta', async () => { const l = arr(await R.ilo(server, 'servers')); return l.find((x) => x.name === server || x.name === (R.meta(server) || {}).ilo) || {}; });
    const loadHealth = (c, server, force) => once(c, server, 'health', () => R.ilo(server, 'health', force ? { fresh: true } : undefined), force);
    const loadMemory = (c, server, force) => once(c, server, 'memory', () => R.ilo(server, 'memory'), force);
    const loadLogs = (c, server, which, force) => once(c, server, `logs-${which}`, async () => arr(await R.ilo(server, 'logs', Object.assign({ which }, force ? { fresh: true } : {}))), force);
    const loadUsers = (c, server, force) => once(c, server, 'users', async () => arr(await R.ilo(server, 'users')), force);
    const loadSettings = (c, server, force) => once(c, server, 'settings', () => R.ilo(server, 'settings'), force);
    R.loadHealth = loadHealth;
    R.loadIloMeta = loadMeta;

    R.hooks.ensure.push((c, n) => {
        if (n.kind === 'power') { void loadMeta(c, n.server); void loadHealth(c, n.server); }
        if (n.kind !== 'hardware') return;
        void loadMeta(c, n.server);
        if (HW.view === 'health') { void loadHealth(c, n.server); void loadMemory(c, n.server); }
        else if (HW.view === 'logs') void loadLogs(c, n.server, HW.which);
        else { void loadUsers(c, n.server); void loadSettings(c, n.server); }
    });
    R.hooks.refresh.push((c, n) => {
        if (n.kind !== 'hardware' && n.kind !== 'power') return;
        const st = R.ss(n.server);
        ['health', 'memory', 'users', 'settings', 'logs-server', 'logs-ilo'].forEach((k) => { delete st.ilo[k]; delete st.ilo[`${k}Err`]; });
    });

    // ---- the health view -------------------------------------------------------------------------------------

    const table = (head, rows) => `<table class="rm-table"><thead><tr>${head.map((h) => `<th${h[1] ? ' class="is-num"' : ''}>${esc(h[0])}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((cell, i) => `<td${head[i][1] ? ' class="is-num"' : ''}>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    function cpuHtml(h, meta) {
        const cpus = arr((h.PROCESSORS || {}).PROCESSOR);
        const allT = arr((h.TEMPERATURE || {}).TEMP).filter((t) => /cpu|processor/i.test(t.LOCATION || '') && !/not installed/i.test(t.STATUS || ''));
        const n = Math.max(cpus.length, ...allT.map((t) => parseInt((String(t.LOCATION).match(/(\d+)/) || [])[1], 10) || 0));
        const used = { temps: new Set(), fans: new Set(), html: '' };
        if (!n) return used;
        const perCpu = Array.from({ length: n }, () => []);
        const numbered = allT.filter((t) => /\d/.test(t.LOCATION));
        if (numbered.length) numbered.forEach((t) => { const i = parseInt(t.LOCATION.match(/(\d+)/)[1], 10) - 1; if (perCpu[i]) perCpu[i].push(t); });
        else if (allT.length === n) allT.forEach((t, i) => perCpu[i].push(t));
        perCpu.flat().forEach((t) => used.temps.add(t.LABEL));
        const allFans = arr((h.FANS || {}).FAN);
        let cpuFans = allFans.filter((f) => /cpu|processor/i.test(f.ZONE || ''));
        if (!cpuFans.length && allFans.length && allFans.length % n === 0) cpuFans = allFans;
        const perFan = cpuFans.length && cpuFans.length % n === 0 ? cpuFans.length / n : 0;
        cpuFans.forEach((f) => used.fans.add(f.LABEL));
        const tcls = (cur, caut) => (cur >= caut ? 'is-bad' : cur >= caut - 15 ? 'is-warn' : 'is-ok');
        let html = `<div class="rm-memgrid" style="grid-template-columns:auto repeat(${n}, minmax(0, 1fr))"><div></div>`;
        for (let i = 0; i < n; i++) html += `<div class="rm-memhead">${esc((cpus[i] && cpus[i].LABEL) || `Proc ${i + 1}`)}</div>`;
        html += '<div class="rm-memrowlab">&deg;C</div>';
        for (let i = 0; i < n; i++) {
            html += `<div class="rm-cell">${perCpu[i].length ? perCpu[i].map((t) => { const cur = numOf(t.CURRENTREADING); const caut = numOf(t.CAUTION); return `<span class="rm-chip ${tcls(cur, caut)}" title="${esc(t.LABEL)}, caution at ${caut} &deg;C">${cur}&deg;</span>`; }).join('') : '<span class="rm-hint">-</span>'}</div>`;
        }
        const pill = (f) => `<span class="rm-pill" title="${esc(f.LABEL)} (${esc(f.ZONE)}): ${esc(f.STATUS)}">${dot(f.STATUS)} ${esc(String(f.LABEL).replace(/^Fan\s*/i, ''))} <b>${esc(val(f.SPEED))}</b></span>`;
        if (perFan) {
            html += '<div class="rm-memrowlab">fan</div>';
            for (let i = 0; i < n; i++) html += `<div class="rm-cell">${cpuFans.slice(i * perFan, (i + 1) * perFan).map(pill).join('')}</div>`;
        } else if (cpuFans.length) html += `<div class="rm-memrowlab">fan</div><div class="rm-cell" style="grid-column:span ${n}">${cpuFans.map(pill).join('')}</div>`;
        html += '<div class="rm-memrowlab">spec</div>';
        for (let i = 0; i < n; i++) {
            const cp = cpus[i];
            html += cp ? `<div class="rm-cell rm-spec"><b>${esc(cp.SPEED || '')}</b><br>${esc(String(cp.EXECUTION_TECHNOLOGY || '').replace(/;\s*/, ' / '))}${cp.INTERNAL_L3_CACHE ? `<br>L3 ${esc(cp.INTERNAL_L3_CACHE)}` : ''}</div>` : '<div class="rm-cell rm-hint">no data</div>';
        }
        used.html = `${html}</div>`;
        void meta;
        return used;
    }

    function memoryHtml(mm) {
        const G = (mm && mm.groups) || [];
        if (!G.length) return '<p class="mmc-hint">The server reports no memory modules.</p>';
        const all = G.flatMap((g) => g.slots);
        const inst = all.filter((s) => s.present);
        const total = inst.reduce((a, s) => a + s.mb, 0);
        const rows = Math.max(...G.map((g) => g.slots.length));
        const gb = (mb) => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)}GB` : `${mb}MB`);
        const short = (name) => name.replace(/^Memory\s*/i, '').replace(/^Board\s*/i, 'B').replace(/^Processor\s*/i, 'CPU ');
        const tcls = (t) => (!t ? '' : t.c >= t.caution ? 'is-bad' : t.c >= t.caution - 10 ? 'is-warn' : 'is-ok');
        let html = `<p>${gb(total)} in ${inst.length} of ${all.length} slots <span class="rm-legend"><i class="is-ok"></i>good <i class="is-absent"></i>empty <i class="is-issue"></i>issue <i class="is-fault"></i>fault</span></p>`;
        html += `<div class="rm-memgrid" style="grid-template-columns:auto repeat(${G.length}, minmax(38px, 1fr))"><div></div>${G.map((g) => `<div class="rm-memhead">${esc(short(g.name))}</div>`).join('')}`;
        if (G.some((g) => g.temp)) html += `<div class="rm-memrowlab">&deg;C</div>${G.map((g) => (g.temp ? `<div class="rm-chip ${tcls(g.temp)}">${g.temp.c}&deg;</div>` : '<div></div>')).join('')}`;
        for (let r = 0; r < rows; r++) {
            const lab = G.map((g) => g.slots[r] && g.slots[r].slot).find(Boolean) || '';
            html += `<div class="rm-memrowlab">${esc(String(lab).replace(/[A-Z]$/i, ''))}</div>`;
            for (const g of G) {
                const s = g.slots[r];
                if (!s) { html += '<div></div>'; continue; }
                const tip = [s.loc, s.present ? `${gb(s.mb)} @ ${s.speed}` : 'Not installed', s.status === 'ok' ? 'Status: good' : s.status === 'absent' ? '' : `Status: ${s.status}`, ...arr(s.events).map((e) => `${e.severity} ${e.when}: ${e.text}`)].filter(Boolean).join('\n');
                html += `<div class="rm-dimm is-${esc(s.status)}" title="${esc(tip)}"><b>${s.present ? gb(s.mb) : ''}</b><span>${esc(s.slot)}</span></div>`;
            }
        }
        return `${html}</div>`;
    }

    function drivesHtml(h, meta) {
        const bays = {};
        for (const b of arr((h.DRIVES || {}).BACKPLANE)) {
            const ids = arr(b.DRIVE_BAY);
            const pid = arr(b.PRODUCT_ID);
            const stt = arr(b.STATUS);
            ids.forEach((id, i) => { bays[String(id)] = { model: String(pid[i] || '').trim(), status: stt[i] || '', encl: b.ENCLOSURE_ADDR }; });
        }
        const ids = Object.keys(bays);
        if (!ids.length) return '<p class="mmc-hint">The server reports no drive bays.</p>';
        const cfg = meta.driveLayout || [ids.sort((a, b) => a - b)];
        const cols = Math.max(...cfg.map((r) => r.reduce((a, cc) => a + (Number(String(cc).split(':')[1]) || 1), 0)));
        const cls = (s) => { s = String(s).toLowerCase(); return !s || /not installed|absent/.test(s) ? 'is-absent' : /^ok/.test(s) ? 'is-ok' : /fail|crit/.test(s) ? 'is-fault' : 'is-issue'; };
        const dt = meta.driveTemp && arr((h.TEMPERATURE || {}).TEMP).find((t) => t.LABEL === meta.driveTemp);
        const dtc = dt ? numOf(dt.CURRENTREADING) : null;
        const dtcau = dt ? numOf(dt.CAUTION) : 0;
        let html = `<p>Front view${dt ? ` <span class="rm-chip ${dtc >= dtcau ? 'is-bad' : dtc >= dtcau - 10 ? 'is-warn' : 'is-ok'}" title="Drive bay sensor, caution at ${dtcau} &deg;C">${dtc}&deg;C</span>` : ''}</p><div class="rm-bays" style="grid-template-columns:repeat(${cols}, minmax(0, 1fr))">`;
        for (const row of cfg) {
            for (const cc of row) {
                const [id, span] = String(cc).split(':');
                const sp = Number(span) || 1;
                if (/^dvd$/i.test(id)) { html += `<div class="rm-bay is-dvd" style="grid-column:span ${sp}">DVD</div>`; continue; }
                const d = bays[id];
                const tip = d ? `Bay ${id}${d.encl ? ` (enclosure ${d.encl})` : ''}\n${d.model || 'unknown model'}\nStatus: ${d.status}` : `Bay ${id}: empty`;
                html += `<div class="rm-bay ${d ? cls(d.status) : 'is-absent'}" style="grid-column:span ${sp}" title="${esc(tip)}"><b>${esc(id)}</b><span>${d ? esc(d.model || '') : 'empty'}</span></div>`;
            }
        }
        return `${html}</div>`;
    }

    function healthView(c, n) {
        const st = n.ss;
        const h = st.ilo.health;
        if (!h) return st.ilo.healthErr ? `<p>${c.state(false, `The hardware health could not be read. ${st.ilo.healthErr}`)}</p>` : '<p>Reading data, please wait... (the iLO can take up to 30 seconds)</p>';
        const meta = st.ilo.meta || {};
        const names = meta.sensorNames || {};
        const g = h.HEALTH_AT_A_GLANCE || {};
        const glance = Object.entries(g).map(([k, v]) => {
            const stt = arr(v).map((x) => x.STATUS).filter(Boolean)[0] || '';
            const red = arr(v).map((x) => x.REDUNDANCY).filter(Boolean)[0];
            return [k.replace(/_/g, ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase()), `${dot(stt)} ${esc(stt)}${red ? ` <span class="mmc-hint">(${esc(red)})</span>` : ''}`];
        });
        const cpu = cpuHtml(h, meta);
        const used = new Set(cpu.temps);
        const memLoaded = st.ilo.memory;
        if (memLoaded && memLoaded.groups) memLoaded.groups.forEach((gr) => { if (gr.temp && gr.temp.label) used.add(gr.temp.label); });
        if (meta.driveTemp) used.add(meta.driveTemp);
        const temps = arr((h.TEMPERATURE || {}).TEMP).filter((t) => !/not installed/i.test(t.STATUS) && !used.has(t.LABEL));
        const fans = arr((h.FANS || {}).FAN).filter((f) => !cpu.fans.has(f.LABEL));
        const ps = h.POWER_SUPPLIES || {};
        const sum = ps.POWER_SUPPLY_SUMMARY || {};
        const fw = Object.values(h.FIRMWARE_INFORMATION || {});
        const nics = arr((h.NIC_INFOMATION || h.NIC_INFORMATION || {}).NIC).concat(arr((h.NIC_INFOMATION || {}).iLO));
        const sec = (id, title, body) => ({ id: `hw-${id}`, title, body });
        const out = [sec('glance', 'Health at a Glance', c.props(glance))];
        if (cpu.html) out.push(sec('cpu', 'Processors', cpu.html));
        out.push(sec('mem', 'Memory', memLoaded ? memoryHtml(memLoaded) : st.ilo.memoryErr ? `<p>${c.state(false, `Memory could not be read. ${esc(st.ilo.memoryErr)}`)}</p>` : '<p>Reading data, please wait...</p>'));
        if (temps.length) out.push(sec('temps', 'Temperatures', table([['Sensor'], ['Location'], ['Now', 1], ['Caution', 1]], temps.map((t) => [`${dot(t.STATUS)} ${esc(t.LABEL)}`, esc(names[t.LABEL] || t.LOCATION), esc(val(t.CURRENTREADING)), esc(val(t.CAUTION))]))));
        if (fans.length) out.push(sec('fans', 'Fans', table([['Fan'], ['Zone'], ['Status'], ['Speed', 1]], fans.map((f) => [esc(f.LABEL), esc(f.ZONE), `${dot(f.STATUS)} ${esc(f.STATUS)}`, esc(val(f.SPEED))]))));
        if (arr(ps.SUPPLY).length) out.push(sec('psu', `Power Supplies${sum.PRESENT_POWER_READING ? ` (${esc(sum.PRESENT_POWER_READING)})` : ''}`, table([['Supply'], ['Status']], arr(ps.SUPPLY).map((s) => [esc(s.LABEL), `${dot(s.STATUS)} ${esc(s.STATUS)}`]))));
        out.push(sec('drives', 'Drives', drivesHtml(h, meta)));
        if (nics.length) out.push(sec('nics', 'Network', table([['Port'], ['MAC']], nics.map((x) => [esc(x.NETWORK_PORT), `<code>${esc(x.MAC_ADDRESS)}</code>`]))));
        if (fw.length) out.push(sec('fw', 'Firmware', table([['Component'], ['Version']], fw.map((f) => [esc(f.FIRMWARE_NAME), esc(f.FIRMWARE_VERSION)]))));
        return out;
    }

    // ---- logs ------------------------------------------------------------------------------------------------

    const sevCls = (s) => (/crit|fail/i.test(s) ? 'is-bad' : /caution|warn/i.test(s) ? 'is-warn' : /repaired/i.test(s) ? 'is-ok' : '');
    function logsView(c, n) {
        const st = n.ss;
        const key = `logs-${HW.which}`;
        const rows0 = st.ilo[key];
        const head = `<p class="rm-switch">${R.link('hw-which', 'Integrated Management Log', 'server')} | ${R.link('hw-which', 'iLO Event Log', 'ilo')}</p>`;
        const tools = `<div class="rm-filterbar"><label>Filter: <input type="text" class="rm-filter" data-rm-input="hw-filter" value="${esc(HW.filter)}" autocomplete="off" spellcheck="false"></label><label class="rm-check"><input type="checkbox" data-rm-input="hw-important"${HW.important ? ' checked' : ''}> Warnings and errors only</label></div>`;
        if (!rows0) return [{ id: 'hw-logs', title: HW.which === 'server' ? 'Integrated Management Log' : 'iLO Event Log', body: head + (st.ilo[`${key}Err`] ? `<p>${c.state(false, `The log could not be read. ${st.ilo[`${key}Err`]}`)}</p>` : '<p>Reading data, please wait...</p>') }];
        const q = HW.filter.toLowerCase();
        const rows = rows0.filter((r) => (!HW.important || /caution|crit|fail/i.test(r.severity)) && (!q || JSON.stringify(r).toLowerCase().includes(q))).slice().reverse();
        const list = c.listView([
            { t: 'Severity', w: 100, key: 'sev', text: (r) => r.severity, html: (r) => `<span class="rm-sev ${sevCls(r.severity)}">${esc(r.severity)}</span>` },
            { t: 'Class', w: 90, key: 'cls', text: (r) => r.class },
            { t: 'Last Update', w: 130, key: 'last', text: (r) => r.last_update },
            { t: 'First', w: 130, key: 'first', text: (r) => r.initial },
            { t: 'Count', w: 46, num: true, key: 'cnt', text: (r) => r.count },
            { t: 'Description', w: 420, key: 'desc', text: (r) => r.description }
        ], rows.slice(0, 500).map((r, i) => ({ key: `log:${i}`, data: r })), { sortId: 'rm-hwlog', empty: 'There are no entries to show.', fit: true });
        return [{ id: 'hw-logs', title: HW.which === 'server' ? 'Integrated Management Log' : 'iLO Event Log', body: `${head}${tools}<p class="mmc-hint">${rows.length} of ${rows0.length} entries${rows.length > 500 ? ' (the newest 500 are shown)' : ''}</p>${list}` }];
    }

    // ---- iLO settings and users ---------------------------------------------------------------------------------

    const PRIVS = [['ADMIN_PRIV', 'Administer user accounts'], ['CONFIG_ILO_PRIV', 'Configure iLO settings'], ['REMOTE_CONS_PRIV', 'Remote console'], ['RESET_SERVER_PRIV', 'Power and reset'], ['VIRTUAL_MEDIA_PRIV', 'Virtual media']];
    const PRIV_SHORT = { ADMIN_PRIV: 'Admin', CONFIG_ILO_PRIV: 'Config', REMOTE_CONS_PRIV: 'Console', RESET_SERVER_PRIV: 'Power', VIRTUAL_MEDIA_PRIV: 'Media' };
    const has = (u, p) => /^y/i.test(u[p] || '');

    function iloView(c, n) {
        const st = n.ss;
        const users = st.ilo.users;
        const set = st.ilo.settings;
        const ulist = users ? c.listView([
            { t: 'Login', w: 150, key: 'login', text: (u) => u.USER_LOGIN },
            { t: 'Name', w: 150, key: 'name', text: (u) => u.USER_NAME || '' }
        ].concat(PRIVS.map(([p]) => ({ t: PRIV_SHORT[p], w: 70, key: p, text: (u) => (has(u, p) ? 'Yes' : 'No') }))), users.map((u) => ({ key: `user:${u.USER_LOGIN}`, icon: `${ITEMS}/user-accounts-16.png`, data: u })), { sortId: 'rm-iloUsers', empty: 'There are no user accounts.', fit: true })
            : (st.ilo.usersErr ? `<p>${c.state(false, `The users could not be read. ${st.ilo.usersErr}`)}</p>` : '<p>Reading data, please wait...</p>');
        const kv = (o) => c.props(Object.entries(o || {}).map(([k, v]) => [k.replace(/_/g, ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase()), esc(typeof v === 'object' ? JSON.stringify(v) : v)]));
        return [
            { id: 'hw-users', title: 'iLO Users', body: `${ulist}<div class="mmc-buttons">${R.btnHtml('ilo-user-add', 'Add User...')}</div>` },
            { id: 'hw-net', title: 'iLO Network Settings', body: set ? kv(set.network) : (st.ilo.settingsErr ? `<p>${c.state(false, `The settings could not be read. ${st.ilo.settingsErr}`)}</p>` : '<p>Reading data, please wait...</p>') },
            set ? { id: 'hw-global', title: 'iLO Global Settings', body: kv(set.global) } : null
        ];
    }

    // ---- the page --------------------------------------------------------------------------------------------

    R.pages.hardware = (c, n) => {
        const nav = `<p class="rm-switch">${['health:Health', 'logs:Event Logs', 'ilo:iLO Settings and Users'].map((x) => { const [id, t] = x.split(':'); return id === HW.view ? `<b>${t}</b>` : R.link('hw-view', t, id); }).join(' | ')}</p>`;
        let secs;
        if (HW.view === 'health') secs = healthView(c, n);
        else if (HW.view === 'logs') secs = logsView(c, n);
        else secs = iloView(c, n);
        if (typeof secs === 'string') secs = [{ id: 'hw-x', title: 'Health', body: secs }];
        return c.page('Hardware', n.meta.label, [{ id: 'hw-nav', title: 'View', body: nav }].concat(secs));
    };

    R.commands.hardware = () => [
        { text: 'Health', action: 'hw-view:health', icon: `${ITEMS}/device-manager-16.png` },
        { text: 'Event Logs', action: 'hw-view:logs', icon: `${ITEMS}/problem-reports-and-solutions-16.png` },
        { text: 'iLO Settings and Users', action: 'hw-view:ilo' },
        ...(HW.view === 'ilo' ? [{ separator: true }, { text: 'Add User...', action: 'ilo-user-add' }] : [])
    ];
    R.selCommands.hardware = (n, key) => {
        if (HW.view !== 'ilo' || !String(key).startsWith('user:')) return null;
        const login = key.slice(5);
        const prot = login === 'dream_admin';
        return { title: login, items: [{ text: 'Modify Rights...', action: 'ilo-user-rights' }, { text: 'Set Password...', action: 'ilo-user-pass' }, { text: 'Delete', action: 'ilo-user-del', disabled: prot }] };
    };

    R.inputs['hw-filter'] = (v, el, c) => { HW.filter = v; R.repaint(c); };
    R.inputs['hw-important'] = (v, el, c) => { HW.important = !!v; R.repaint(c); };

    const A = R.actions;
    A['hw-view'] = (c, v, n) => { HW.view = v; R.hooks.ensure.forEach((fn) => fn(c, n)); R.repaint(c); };
    A['hw-which'] = (c, v, n) => { HW.which = v; R.hooks.ensure.forEach((fn) => fn(c, n)); R.repaint(c); };

    // ---- user dialogs ---------------------------------------------------------------------------------------------

    const privBoxes = (u) => `<div class="rm-checks">${PRIVS.map(([p, t]) => R.chk(`p:${p}`, t, u ? has(u, p) : p === 'REMOTE_CONS_PRIV')).join('')}</div>`;
    const privsOf = (ctx) => PRIVS.filter(([p]) => R.val(ctx, `p:${p}`)).map(([p]) => p);
    async function userWrite(c, n, params) {
        const r = await R.iloAct(n.server, 'users', params);
        const st = n.ss;
        if (Array.isArray(r)) st.ilo.users = r; else { delete st.ilo.users; void loadUsers(c, n.server, true); }
        R.repaint(c);
    }
    const selUser = (c, n) => arr(n.ss.ilo.users).find((u) => `user:${u.USER_LOGIN}` === c.sel);

    A['ilo-user-add'] = (c, p, n) => R.dialog(c, {
        id: 'iloadd', title: 'Add iLO User', w: 400, h: 340,
        html: `${R.field('Login name:', R.inp('login', ''))}${R.field('Password:', '<input type="password" data-rm="pw" autocomplete="new-password">')}${R.field('Confirm password:', '<input type="password" data-rm="pw2" autocomplete="new-password">')}<div class="rm-field is-wide"><span>Rights</span>${privBoxes(null)}</div>`,
        okText: 'Add',
        ok: async (ctx) => {
            const login = (R.val(ctx, 'login') || '').trim();
            const pw = R.val(ctx, 'pw') || '';
            if (!login) { R.err(ctx, 'Type a login name.'); return false; }
            if (pw.length < 8) { R.err(ctx, 'The password must have 8 or more characters.'); return false; }
            if (pw !== R.val(ctx, 'pw2')) { R.err(ctx, 'The passwords do not match.'); return false; }
            await userWrite(c, n, { action: 'add', login, password: pw, privs: privsOf(ctx) });
            return true;
        }
    });
    A['ilo-user-rights'] = (c, p, n) => {
        const u = selUser(c, n);
        if (!u) return;
        R.dialog(c, {
            id: 'ilorights', title: `Rights of ${u.USER_LOGIN}`, w: 360, h: 250,
            html: `<div class="rm-field is-wide"><span>${esc(u.USER_LOGIN)} may</span>${privBoxes(u)}</div>`,
            okText: 'Save',
            ok: async (ctx) => { await userWrite(c, n, { action: 'modify', login: u.USER_LOGIN, privs: privsOf(ctx) }); return true; }
        });
    };
    A['ilo-user-pass'] = (c, p, n) => {
        const u = selUser(c, n);
        if (!u) return;
        R.dialog(c, {
            id: 'ilopass', title: `Set Password: ${u.USER_LOGIN}`, w: 380, h: 220,
            html: `${R.field('New password:', '<input type="password" data-rm="pw" autocomplete="new-password">')}${R.field('Confirm password:', '<input type="password" data-rm="pw2" autocomplete="new-password">')}`,
            okText: 'Set',
            ok: async (ctx) => {
                const pw = R.val(ctx, 'pw') || '';
                if (pw.length < 8) { R.err(ctx, 'The password must have 8 or more characters.'); return false; }
                if (pw !== R.val(ctx, 'pw2')) { R.err(ctx, 'The passwords do not match.'); return false; }
                await userWrite(c, n, { action: 'modify', login: u.USER_LOGIN, password: pw });
                return true;
            }
        });
    };
    A['ilo-user-del'] = async (c, p, n) => {
        const u = selUser(c, n);
        if (!u || u.USER_LOGIN === 'dream_admin') return;
        const a = await R.taskDialog(c, { instruction: `Delete the iLO user ${u.USER_LOGIN}?`, text: 'The account can no longer sign in to the iLO.', links: [{ id: 'del', text: 'Delete the user', danger: true }] });
        if (a === 'del') await userWrite(c, n, { action: 'delete', login: u.USER_LOGIN });
    };
})(typeof window !== 'undefined' ? window : globalThis);
