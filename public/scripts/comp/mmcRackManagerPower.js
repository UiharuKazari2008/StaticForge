/**
 * Rack Manager, part 3: the Power node. State and the power buttons (a danger task dialog confirms each), the readings,
 * the power regulator, the power cap (a Vista trackbar) and the history graph (1h to 90d; power with its minimum and
 * maximum band, temperatures, fans) drawn in SVG in Vista's Reliability / Performance Monitor style.
 * Part of window.mmcRack (mmcRackManager.js).
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc, ITEMS, VI } = R;
    const PAGES = '/static_images/vista-cpl/pages';
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

    const PW = { range: '24h', series: 'power', cap: null, reg: null, tip: null };
    const RANGES = ['1h', '6h', '24h', '7d', '30d', '90d'];
    const REG = { MAX: 'Static High Performance', AUTO: 'Dynamic Power Savings', MIN: 'Static Low Power', OS: 'OS Control' };
    const REGV = { OS: 1, MIN: 2, AUTO: 3, MAX: 4 };
    const PALETTE = ['#1e5fc5', '#2f9e44', '#d98a00', '#c8372d', '#7e57c2', '#00838f', '#c2185b', '#6d6d6d', '#4a90d9', '#5cb85c', '#e0a800', '#e57368', '#9575cd', '#26a69a', '#ef8f3c', '#455a64'];

    // ---- loading ---------------------------------------------------------------------------------------------

    async function loadPower(c, server, force) {
        const st = R.ss(server);
        if (st.loading.powerPage || (!force && st.ilo.power && st.ilo.powerFull)) return;
        st.loading.powerPage = true;
        try { st.ilo.power = await R.ilo(server, 'power'); st.ilo.powerFull = true; delete st.ilo.powerErr; } catch (e) { st.ilo.powerErr = (e && e.message) || 'iLO did not answer.'; st.ilo.powerFull = true; }
        st.loading.powerPage = false;
        R.repaint(c);
    }
    async function loadHistory(c, server, range, force) {
        const st = R.ss(server);
        st.ilo.hist = st.ilo.hist || {};
        const key = `hist-${range}`;
        if (st.loading[key] || (!force && (st.ilo.hist[range] || st.ilo.hist[`${range}Err`]))) return;
        st.loading[key] = true;
        try { st.ilo.hist[range] = await R.ilo(server, 'history', { range }); delete st.ilo.hist[`${range}Err`]; } catch (e) { st.ilo.hist[`${range}Err`] = (e && e.message) || 'iLO did not answer.'; }
        st.loading[key] = false;
        R.repaint(c);
    }
    R.hooks.ensure.push((c, n) => { if (n.kind !== 'power') return; void loadPower(c, n.server); void loadHistory(c, n.server, PW.range); });
    R.hooks.refresh.push((c, n) => { if (n.kind !== 'power') return; const st = R.ss(n.server); delete st.ilo.power; delete st.ilo.powerFull; st.ilo.hist = {}; });

    // ---- the graph ---------------------------------------------------------------------------------------------

    /** series [{ name, color, pts: [[t, v]], band?: [[t, lo, hi]] }] -> an SVG string; PW.tip keeps what the hover needs. */
    function chart(series, o) {
        const W = o.w || 760;
        const H = o.h || 220;
        const padL = 40;
        const padR = 10;
        const padT = 8;
        const padB = 22;
        const live = series.filter((s) => s.pts.length);
        if (!live.length) return `<svg class="rm-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="rm-ct">No data for this range yet</text></svg>`;
        const vals = live.flatMap((s) => s.pts.map((p) => p[1])).concat(o.cap ? [o.cap] : []).concat(live.flatMap((s) => (s.band || []).flatMap((b) => [b[1], b[2]])));
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        const sp = Math.max(hi - lo, o.minSpan || 10);
        lo = Math.max(0, lo - sp * 0.12);
        hi += sp * 0.12;
        const X = (t) => padL + ((t - o.from) / (o.to - o.from)) * (W - padL - padR);
        const Y = (v) => H - padB - ((v - lo) / (hi - lo)) * (H - padT - padB);
        const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = lo + (hi - lo) * f; return `<line x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="rm-cg"/><text x="${padL - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" class="rm-ct">${Math.round(v)}</text>`; }).join('');
        const span = o.to - o.from;
        const fmt = (t) => (span > 2 * 86400e3 ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) : new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => { const t = o.from + span * f; return `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${padT}" y2="${H - padB}" class="rm-cg is-v"/><text x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}" class="rm-ct">${fmt(t)}</text>`; }).join('');
        const cap = o.cap ? `<line x1="${padL}" x2="${W - padR}" y1="${Y(o.cap).toFixed(1)}" y2="${Y(o.cap).toFixed(1)}" class="rm-capline"/><text x="${W - padR - 4}" y="${(Y(o.cap) - 3).toFixed(1)}" text-anchor="end" class="rm-ct is-cap">cap ${o.cap} ${o.unit.trim()}</text>` : '';
        const path = (pts) => { let d = ''; let prev = null; const gap = Math.max(span / 120, 90000); for (const p of pts) { d += `${prev != null && p[0] - prev > gap ? 'M' : d ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`; prev = p[0]; } return d; };
        const bands = live.filter((s) => s.band).map((s) => `<path d="${s.band.map((b, i) => `${i ? 'L' : 'M'}${X(b[0]).toFixed(1)},${Y(b[2]).toFixed(1)}`).join('')}${s.band.slice().reverse().map((b) => `L${X(b[0]).toFixed(1)},${Y(b[1]).toFixed(1)}`).join('')}Z" fill="${s.color}" opacity=".18"/>`).join('');
        PW.tip = { series: live, from: o.from, to: o.to, unit: o.unit, W, padL, padR };
        return `<svg class="rm-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-rm-chart><rect x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" class="rm-cbg"/>${grid}${ticks}${cap}${bands}${live.map((s) => `<path d="${path(s.pts)}" fill="none" stroke="${s.color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`).join('')}<line class="rm-ccur" y1="${padT}" y2="${H - padB}" x1="0" x2="0" hidden/></svg>`;
    }

    function historyHtml(c, n, power) {
        const st = n.ss;
        const hist = st.ilo.hist && st.ilo.hist[PW.range];
        const nav = `<p class="rm-switch">${RANGES.map((r) => (r === PW.range ? `<b>${r}</b>` : R.link('pw-range', r, r))).join(' | ')} &nbsp;&middot;&nbsp; ${[['power', 'Power'], ['temp', 'Temperatures'], ['fan', 'Fans']].map(([id, t]) => (id === PW.series ? `<b>${t}</b>` : R.link('pw-series', t, id))).join(' | ')}</p>`;
        if (!hist) return nav + (st.ilo.hist && st.ilo.hist[`${PW.range}Err`] ? `<p>${c.state(false, `The history could not be read. ${st.ilo.hist[`${PW.range}Err`]}`)}</p>` : '<p>Reading data, please wait...</p>');
        const meta = st.ilo.meta || {};
        const names = meta.sensorNames || {};
        let series;
        let o;
        if (PW.series === 'power') {
            series = [{ name: 'Power', color: PALETTE[0], pts: arr(hist.power).map((p) => [p[0], p[1]]), band: arr(hist.power).map((p) => [p[0], p[2], p[3]]) }];
            o = { from: hist.from, to: hist.to, unit: ' W', cap: Number(power && power.cap) || 0, minSpan: 40 };
        } else if (PW.series === 'temp') {
            const labels = Object.keys(hist.temp || {}).sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));
            series = labels.map((l, i) => ({ name: `${l}${names[l] ? ` (${names[l].replace(/\s*\(.*\)/, '')})` : ''}`, color: PALETTE[i % PALETTE.length], pts: hist.temp[l] }));
            o = { from: hist.from, to: hist.to, unit: ' °C' };
        } else {
            const labels = Object.keys(hist.fan || {}).sort();
            series = labels.map((l, i) => ({ name: l, color: PALETTE[i % PALETTE.length], pts: hist.fan[l] }));
            o = { from: hist.from, to: hist.to, unit: ' %' };
        }
        const legend = series.length > 1 ? `<div class="rm-legend2">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
        return `${nav}<div class="rm-chartwrap">${chart(series, o)}<div class="rm-tip" hidden></div></div>${legend}<p class="mmc-hint">${hist.samples != null ? `${num(hist.samples)} samples, ${Math.round((hist.step || 0) / 1000)} s per point. ` : ''}Move the pointer over the graph for the values.</p>`;
    }
    const num = (v) => R.num(v);

    // ---- the host's power state machine, automatic power, leases (power on demand) ------------------------------------------------

    const HP = { draft: null }; // the Automatic power sheet's unsaved values
    const left = (ms) => (ms > 0 ? R.dur(ms / 1000) : 'now');
    function stateBlock(c, n, after) {
        const ps = R.powerState(n.server);
        const p = n.ss.power || {};
        const po = R.postOf(n.server);
        const info = n.ss.info;
        const boot = ps === 'up' && info && info.uptimeS ? Date.now() - info.uptimeS * 1000 : p.since;
        const since = boot ? ` since ${esc(R.when(boot))}` : '';
        let line;
        if (ps === 'powering-on') line = `<p><b>Powering on</b></p>${R.postBar(po)}`;
        else if (ps === 'booting') line = `<p><b>Booting</b> (the operating system is starting)</p>${R.bar(0, 'is-marquee')}`;
        else if (ps === 'shutting-down') line = '<p><b>Shutting down</b></p>';
        else line = `<p><b>${ps === 'up' ? 'Running' : 'Off'}</b>${since}</p>`;
        const btn = ps === 'off' ? R.btnHtml('host-on', 'Power On') : R.btnHtml('host-off', 'Shut Down...', null, ps === 'up' ? '' : ' disabled');
        return `<div class="rm-powerstate"><img src="${PAGES}/power-plugged-32.png" alt=""><div>${line}</div></div>${after || ''}<div class="mmc-buttons">${btn}</div>`;
    }
    function leasesBlock(c, n) {
        const p = n.ss.power || {};
        const idle = p.idle || {};
        const lease = R.arr(p.leases);
        const busy = R.arr(idle.busy);
        const dl = Number(p.deadline) || (p.idleLeftS != null ? Date.now() + p.idleLeftS * 1000 : 0);
        const ps = R.powerState(n.server);
        let idleTxt;
        if (ps !== 'up') idleTxt = 'The host is not running.';
        else if (!(p.settings && p.settings.auto)) idleTxt = 'Automatic shutdown is off.';
        else if (lease.length || busy.length) idleTxt = 'Not idle: it stays on while the work below runs.';
        else if (dl) idleTxt = `Idle. It shuts down at ${esc(new Date(dl).toLocaleTimeString())} (in ${esc(left(dl - Date.now()))}) unless work arrives.`;
        else idleTxt = idle.idle ? 'Idle.' : 'Reading...';
        const ll = lease.length ? c.listView([
            { t: 'Purpose', w: 200, key: 'p', text: (l) => l.purpose || '' },
            { t: 'Who', w: 110, key: 'w', text: (l) => l.who || '' },
            { t: 'Since', w: 130, key: 's', value: (l) => l.since, text: (l) => R.when(l.since) },
            { t: 'Ends', w: 130, key: 'e', value: (l) => l.ends, text: (l) => R.when(l.ends) }
        ], lease.map((l, i) => ({ key: `lease:${l.id || i}`, icon: `${ITEMS}/sync-center-16.png`, data: l })), { sortId: 'rm-leases', fit: true }) : '<p class="mmc-hint">No leases are open.</p>';
        const bl = busy.length ? `<p><b>What keeps it busy</b></p><ul class="rm-arts">${busy.map((b) => `<li>${esc(b.kind || '')}${b.id ? ` ${esc(b.id)}` : ''}${b.why ? `: ${esc(b.why)}` : ''}</li>`).join('')}</ul>` : '';
        return `<p>${idleTxt}</p>${ll}${bl}`;
    }
    function autoBlock(c, n) {
        const p = n.ss.power || {};
        const cur = p.settings || {};
        const d = HP.draft && HP.draft.server === n.server ? HP.draft : (HP.draft = { server: n.server, auto: cur.auto !== false, hours: Math.max(1, Math.min(24, Math.round((cur.idleShutdownMin || 180) / 60))), wake: cur.wakeOnDemand !== false });
        const changed = d.auto !== (cur.auto !== false) || d.hours !== Math.max(1, Math.min(24, Math.round((cur.idleShutdownMin || 180) / 60))) || d.wake !== (cur.wakeOnDemand !== false);
        return `<fieldset class="rm-sheet">
            <label class="rm-check"><input type="checkbox" data-rm-input="ap-auto"${d.auto ? ' checked' : ''}> Shut down this server when it has had no work for</label>
            <div class="rm-caprow"><span class="rm-trackbar"><input type="range" data-rm-input="ap-hours" min="1" max="24" step="1" value="${d.hours}"${d.auto ? '' : ' disabled'} aria-label="Hours without work before shutdown"><b data-rm-hours>${d.hours} hour${d.hours === 1 ? '' : 's'}</b></span></div>
            <label class="rm-check"><input type="checkbox" data-rm-input="ap-wake"${d.wake ? ' checked' : ''}> Turn on automatically when work needs it</label></fieldset>
            <div class="mmc-buttons">${R.btnHtml('ap-apply', 'Apply', null, changed ? '' : ' disabled')}</div>`;
    }
    /** The server summary's Host Power: the state and the iLO's power readings (the graph is Load History, mmcRackManagerLoad.js). */
    function briefReadings(c, n) {
        const st = n.ss;
        const p = st.ilo.power;
        if (!p) return st.ilo.powerErr ? `<p>${c.state(false, `The power readings could not be read. ${esc(st.ilo.powerErr)}`)}</p>` : '<p class="mmc-hint">Reading the power readings...</p>';
        const w = (v) => (v == null ? '-' : `${v} W`);
        return c.props([['Present', w(p.present)], ['Average', w(p.average)], ['Minimum', w(p.min)], ['Maximum', w(p.max)], ['Power cap', p.cap ? `${p.cap} W` : 'None']]);
    }
    R.hostBrief = (c, n) => ({ id: 'rm-hostpower', title: 'Host Power', body: stateBlock(c, n, briefReadings(c, n)) });
    R.hooks.ensure.push((c, n) => { if (n.kind !== 'server') return; void loadPower(c, n.server); });
    const touch = (c) => { const b = c.el('[data-act="ap-apply"]'); if (b) b.disabled = false; };
    R.inputs['ap-auto'] = (v, el, c) => { if (HP.draft) HP.draft.auto = !!v; const r = c.el('input[data-rm-input="ap-hours"]'); if (r) r.disabled = !v; touch(c); };
    R.inputs['ap-wake'] = (v, el, c) => { if (HP.draft) HP.draft.wake = !!v; touch(c); };
    R.inputs['ap-hours'] = (v, el, c) => { if (HP.draft) HP.draft.hours = Number(v); const o = c.el('[data-rm-hours]'); if (o) o.textContent = `${v} hour${Number(v) === 1 ? '' : 's'}`; touch(c); };
    R.actions['ap-apply'] = async (c, p, n) => {
        const d = HP.draft;
        if (!d) return;
        await R.send('rack_power_settings', { server: n.server, settings: { auto: d.auto, idleShutdownMin: d.hours * 60, wakeOnDemand: d.wake } });
        HP.draft = null;
        await R.loadHostPower(c, n.server, true);
    };

    // ---- the page ----------------------------------------------------------------------------------------------------


    R.pages.power = (c, n) => {
        const st = n.ss;
        const m = n.meta;
        const p = st.ilo.power;
        const health = st.ilo.health;
        const on = R.powerText(m, st) === 'On' || (p && p.present > 0);
        const glance = health && health.HEALTH_AT_A_GLANCE ? Object.values(health.HEALTH_AT_A_GLANCE).flatMap(arr).map((x) => String(x.STATUS || '')).filter(Boolean) : [];
        const healthTxt = !glance.length ? '' : glance.every((x) => /^ok$/i.test(x)) ? 'Good' : glance.some((x) => /fail|crit/i.test(x)) ? 'Failed' : 'Degraded';
        const stateBody = `<div class="rm-powerstate"><img src="${PAGES}/power-button-32.png" alt=""><div><b class="rm-bigstate ${on ? 'is-on' : 'is-off'}">${on ? 'On' : R.powerText(m, st) === 'Off' ? 'Off' : 'Unknown'}</b>${healthTxt ? `<span class="mmc-hint">Hardware health: ${healthTxt}</span>` : ''}</div></div>`
            + `<div class="mmc-buttons">${[['press', 'Momentary Press...'], ['hold', 'Press and Hold...'], ['reset', 'Reset...'], ['cold', 'Cold Boot...']].map(([id, t]) => R.btnHtml('pw-op', t, id)).join('')}</div>`;
        let readings;
        let capBody;
        let regBody;
        if (!p) {
            const e = st.ilo.powerErr ? `<p>${c.state(false, `The power readings could not be read. ${st.ilo.powerErr}`)}</p>` : '<p>Reading data, please wait...</p>';
            readings = e; capBody = e; regBody = e;
        } else {
            const w = (v) => (v == null ? '-' : `${v} W`);
            readings = c.props([['Present', w(p.present)], ['Average', w(p.average)], ['Minimum', w(p.min)], ['Maximum', w(p.max)], ['Updated', p.t ? esc(new Date(p.t).toLocaleTimeString()) : '']]);
            const cmin = Number(p.capMin) || 300;
            const cmax = Number(p.capMax) || 1600;
            const cur = PW.cap != null ? PW.cap : (p.cap || cmax);
            PW.cap = Math.max(cmin, Math.min(cmax, cur));
            capBody = `<p>${p.cap ? `The server is capped at <b>${p.cap} W</b>.` : 'The server has no power cap.'}</p><div class="rm-caprow"><span class="rm-trackbar"><input type="range" data-rm-input="pw-cap" min="${cmin}" max="${cmax}" step="10" value="${PW.cap}" aria-label="Power cap in watts"><b data-rm-capout>${PW.cap} W</b></span></div><div class="mmc-buttons">${R.btnHtml('pw-setcap', 'Set Cap...')}${R.btnHtml('pw-nocap', 'Remove Cap', null, p.cap ? '' : ' disabled')}</div>`;
            const cur2 = PW.reg || p.regulator;
            regBody = `<p>The power regulator sets how the server trades speed for power.</p><div class="rm-radios">${Object.keys(REGV).sort((a, b) => REGV[b] - REGV[a]).map((k) => `<label class="rm-check"><input type="radio" name="rm-reg" value="${k}" data-rm-input="pw-reg"${k === cur2 ? ' checked' : ''}> ${esc(REG[k])}${k === p.regulator ? ' <span class="mmc-hint">(current)</span>' : ''}</label>`).join('')}</div><div class="mmc-buttons">${R.btnHtml('pw-setreg', 'Apply Regulator Mode...', null, cur2 === p.regulator ? ' disabled' : '')}</div>`;
        }
        return c.page('Power', m.label, [
            { id: 'pw-host', title: 'Host Power', body: stateBlock(c, n) },
            { id: 'pw-auto', title: 'Automatic Power', body: autoBlock(c, n) },
            { id: 'pw-leases', title: 'Leases and Idle Shutdown', body: leasesBlock(c, n) },
            { id: 'pw-state', title: 'iLO Power Button', body: stateBody },
            { id: 'pw-read', title: 'Power Readings', body: readings },
            { id: 'pw-reg', title: 'Power Regulator', body: regBody },
            { id: 'pw-cap', title: 'Power Cap', body: capBody },
            { id: 'pw-hist', title: 'History', body: historyHtml(c, n, p) }
        ]);
    };

    R.commands.power = () => [
        { text: 'Momentary Press...', action: 'pw-op:press' },
        { text: 'Press and Hold...', action: 'pw-op:hold' },
        { text: 'Reset...', action: 'pw-op:reset' },
        { text: 'Cold Boot...', action: 'pw-op:cold' }
    ];

    R.inputs['pw-cap'] = (v, el, c) => { PW.cap = Number(v); const out = c.el('[data-rm-capout]'); if (out) out.textContent = `${PW.cap} W`; };
    R.inputs['pw-reg'] = (v, el, c) => { PW.reg = v; const b = c.el('[data-act="pw-setreg"]'); const p = R.ss(R.here(c).server).ilo.power; if (b && p) b.disabled = v === p.regulator; };

    const A = R.actions;
    A['pw-range'] = (c, v, n) => { PW.range = v; void loadHistory(c, n.server, v); R.repaint(c); };
    A['pw-series'] = (c, v) => { PW.series = v; R.repaint(c); };

    const OPS = {
        press: { text: 'Momentary Press', op: 'press', danger: false, instruction: (on) => (on ? 'Send a momentary press of the power button?' : 'Turn the server on?'), body: (on) => (on ? 'A running operating system is asked to shut down in an orderly way.' : 'The server starts and goes through its start-up checks.') },
        hold: { text: 'Press and Hold', op: 'hold', danger: true, instruction: () => 'Press and hold the power button?', body: () => 'The server turns off at once, without shutting the operating system down. Unsaved data and running jobs are lost.' },
        reset: { text: 'Reset', op: 'reset', danger: true, instruction: () => 'Reset the server?', body: () => 'The server restarts at once, without shutting the operating system down. Unsaved data and running jobs are lost.' },
        cold: { text: 'Cold Boot', op: 'cold', danger: true, instruction: () => 'Cold boot the server?', body: () => 'The power is cut and restored. The operating system is not shut down. Unsaved data and running jobs are lost.' }
    };
    A['pw-op'] = async (c, which, n) => {
        const o = OPS[which];
        if (!o) return;
        const on = R.powerText(n.meta, n.ss) === 'On';
        const a = await R.taskDialog(c, { title: `${o.text}: ${n.meta.label}`, instruction: o.instruction(on), text: esc(o.body(on)), icon: o.danger ? `${VI}/msgbox-warning-32.png` : `${VI}/msgbox-question-32.png`, links: [{ id: 'go', text: o.text, sub: n.meta.label, danger: o.danger }] });
        if (a !== 'go') return;
        await R.iloAct(n.server, 'power', { op: o.op });
        const st = n.ss;
        delete st.ilo.power; delete st.ilo.powerFull;
        void loadPower(c, n.server, true);
    };
    A['pw-setcap'] = async (c, p, n) => {
        const w = PW.cap;
        const a = await R.taskDialog(c, { title: 'Power Cap', instruction: `Cap ${n.meta.label} at ${w} W?`, text: 'The server slows down to stay under the cap when it would use more.', icon: `${VI}/msgbox-question-32.png`, links: [{ id: 'go', text: `Set the cap to ${w} W` }] });
        if (a !== 'go') return;
        n.ss.ilo.power = await R.iloAct(n.server, 'powercap', { watts: w });
        R.repaint(c);
    };
    A['pw-nocap'] = async (c, p, n) => {
        n.ss.ilo.power = await R.iloAct(n.server, 'powercap', { watts: 0 });
        PW.cap = null;
        R.repaint(c);
    };
    A['pw-setreg'] = async (c, p, n) => {
        const k = PW.reg;
        if (!k || !REGV[k]) return;
        const a = await R.taskDialog(c, { title: 'Power Regulator', instruction: `Set the power regulator to "${REG[k]}"?`, icon: `${VI}/msgbox-question-32.png`, links: [{ id: 'go', text: 'Apply the mode' }] });
        if (a !== 'go') return;
        n.ss.ilo.power = await R.iloAct(n.server, 'powersaver', { mode: REGV[k] });
        PW.reg = null;
        R.repaint(c);
    };

    // the graph's pointer: values at the pointer (one listener on the result pane)
    R.hooks.open.push((c) => {
        const pane = c.el('.mmc-result');
        pane.addEventListener('mousemove', (ev) => {
            const svg = ev.target.closest && ev.target.closest('[data-rm-chart]');
            const wrap = svg && svg.parentElement;
            const tipEl = wrap && wrap.querySelector('.rm-tip');
            const cur = svg && svg.querySelector('.rm-ccur');
            if (!svg || !PW.tip) return;
            const t0 = PW.tip;
            const r = svg.getBoundingClientRect();
            const x = ((ev.clientX - r.left) / r.width) * t0.W;
            const t = t0.from + ((x - t0.padL) / (t0.W - t0.padL - t0.padR)) * (t0.to - t0.from);
            if (t < t0.from || t > t0.to) { tipEl.hidden = true; cur.setAttribute('hidden', ''); return; }
            const near = (pts) => { let b = null; for (const p of pts) if (!b || Math.abs(p[0] - t) < Math.abs(b[0] - t)) b = p; return b; };
            const rows = t0.series.map((s) => { const p = near(s.pts); return p ? `<div><i style="background:${s.color}"></i>${esc(s.name)} <b>${p[1]}${esc(t0.unit)}</b></div>` : ''; }).join('');
            cur.removeAttribute('hidden');
            cur.setAttribute('x1', x); cur.setAttribute('x2', x);
            tipEl.innerHTML = `<div class="mmc-hint">${esc(new Date(t).toLocaleString())}</div>${rows}`;
            tipEl.hidden = false;
            const wr = wrap.getBoundingClientRect();
            tipEl.style.left = `${Math.max(2, Math.min(ev.clientX - wr.left + 14, wr.width - tipEl.offsetWidth - 4))}px`;
        });
        pane.addEventListener('mouseleave', () => { pane.querySelectorAll('.rm-tip').forEach((e) => { e.hidden = true; }); pane.querySelectorAll('.rm-ccur').forEach((e) => e.setAttribute('hidden', '')); });
    });
})(typeof window !== 'undefined' ? window : globalThis);
