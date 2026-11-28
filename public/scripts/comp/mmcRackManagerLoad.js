/**
 * Rack Manager, part 6: "Load History" on the server summary. Strips stacked on one shared time axis, the way Reliability
 * and Performance Monitor stacks its graphs: CPU %, memory used %, disk, network, temperatures (ambient, hottest CPU, hottest
 * memory), fans, power, and the counts of what runs as step lines. Host strips come from rack_get role 'metrics'
 * ({ from, to, step, samples[] }), the iLO strips from rack_ilo 'history'. One hover cursor runs across every strip and the tip
 * lists every value at that time. Read when the summary is shown, on Refresh and on a range change; a pushed `metrics` event
 * appends its live point (nothing polls). With the host off only the iLO strips show, the off periods shaded.
 * The SVG is sized in pixels to the pane (text is never scaled). Part of window.mmcRack (mmcRackManager.js).
 */
(function (root) {
    'use strict';

    const R = root.mmcRack;
    if (!R) return;
    const { esc } = R;
    const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const RANGES = ['3h', '6h', '24h', '7d'];
    const LD = { range: '3h', tip: null, lastW: 0 };
    const C = { cpu: '#1e5fc5', mem: '#7e57c2', r: '#2f9e44', w: '#d98a00', rx: '#00838f', tx: '#c2185b', amb: '#6d6d6d', hot: '#c8372d', memT: '#d98a00', fan: '#00838f', pwr: '#1e5fc5' };
    const COUNT = [['vms', 'VMs', '#1e5fc5'], ['avds', 'Android devices', '#2f9e44'], ['sandboxes', 'Sandboxes', '#d98a00'], ['containers', 'Containers', '#7e57c2'], ['replicas', 'Replicas', '#00838f'], ['builds', 'Builds / jobs', '#c8372d']];

    // ---- loading ------------------------------------------------------------------------------------------------

    const hostUp = (server) => R.powerState(server) === 'up';
    async function loadMetrics(c, server, force) {
        const st = R.ss(server);
        const ld = st.load || (st.load = {});
        if (ld.loading || (!force && ld[LD.range]) || !hostUp(server)) return;
        ld.loading = true;
        try { ld[LD.range] = await R.getRole(server, 'metrics', { range: LD.range, points: 360 }); delete ld.err; } catch (e) { ld.err = (e && e.message) || 'rackd did not answer.'; }
        ld.loading = false;
        R.repaint(c);
    }
    async function loadIloHist(c, server, force) {
        const st = R.ss(server);
        st.ilo.hist = st.ilo.hist || {};
        const k = LD.range;
        if (st.loading[`hist-${k}`] || (!force && (st.ilo.hist[k] || st.ilo.hist[`${k}Err`]))) return;
        st.loading[`hist-${k}`] = true;
        try { st.ilo.hist[k] = await R.ilo(server, 'history', { range: k }); delete st.ilo.hist[`${k}Err`]; } catch (e) { st.ilo.hist[`${k}Err`] = (e && e.message) || 'iLO did not answer.'; }
        st.loading[`hist-${k}`] = false;
        R.repaint(c);
    }
    R.hooks.ensure.push((c, n) => {
        if (n.kind !== 'server') return;
        void loadMetrics(c, n.server); void loadIloHist(c, n.server); void R.loadHealth(c, n.server); void R.loadIloMeta(c, n.server);
    });
    R.hooks.refresh.push((c, n) => { if (n.kind !== 'server') return; const st = R.ss(n.server); st.load = {}; st.ilo.hist = {}; });
    R.actions['ld-range'] = (c, v, n) => { LD.range = v; void loadMetrics(c, n.server); void loadIloHist(c, n.server); R.repaint(c); };

    // a pushed metrics event adds its point to the 3h data (no extra read)
    R.hooks.event.push((c, ev) => {
        if (ev.kind !== 'metrics' || !ev.data) return false;
        const ld = R.ss(ev.server).load;
        const d = ld && ld['3h'];
        if (!d || !Array.isArray(d.samples)) return false;
        const m = ev.data;
        const mem = m.mem || {};
        const total = mem.totalB || (d.samples.length ? d.samples[d.samples.length - 1].memTotalB : 0);
        const last = d.samples[d.samples.length - 1] || {};
        const t = Date.now();
        d.samples.push(Object.assign({}, last, { t, cpu: m.cpu, memUsedB: mem.usedB != null ? mem.usedB : total - (mem.availB || 0), memTotalB: total, diskRBps: m.disk && (m.disk.rBps != null ? m.disk.rBps : m.disk.read), diskWBps: m.disk && (m.disk.wBps != null ? m.disk.wBps : m.disk.write), netRxBps: m.net && (m.net.rxBps != null ? m.net.rxBps : m.net.rx), netTxBps: m.net && (m.net.txBps != null ? m.net.txBps : m.net.tx), load1: m.load && m.load[0] }));
        const cut = t - 3 * 3600e3;
        while (d.samples.length > 2 && d.samples[0].t < cut) d.samples.shift();
        d.to = t;
        return false;
    });

    // ---- the strips -------------------------------------------------------------------------------------------------

    /** per-timestamp aggregate of several [t, v] series (a hottest or an average line) */
    function agg(list, fn) {
        const m = new Map();
        list.forEach((pts) => arr(pts).forEach((p) => { if (!m.has(p[0])) m.set(p[0], []); m.get(p[0]).push(p[1]); }));
        return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, vs]) => [t, fn(vs)]);
    }
    const maxOf = (vs) => Math.max(...vs);
    const avgOf = (vs) => vs.reduce((a, b) => a + b, 0) / vs.length;

    /** the iLO's temperature labels in three groups: ambient, CPUs, memory (health locations, else Temp numbers of the DL580) */
    function tempGroups(st, labels) {
        const groups = { amb: [], cpu: [], mem: [] };
        const list = st.ilo.health ? arr((st.ilo.health.TEMPERATURE || {}).TEMP) : [];
        list.forEach((t) => {
            if (!labels.includes(t.LABEL)) return;
            const loc = String(t.LOCATION || '');
            if (/ambient|inlet/i.test(loc)) groups.amb.push(t.LABEL);
            else if (/cpu|processor/i.test(loc)) groups.cpu.push(t.LABEL);
            else if (/memory|dimm/i.test(loc)) groups.mem.push(t.LABEL);
        });
        if (!groups.amb.length && !groups.cpu.length && !groups.mem.length) {
            const num = (l) => parseInt(String(l).replace(/\D/g, ''), 10);
            labels.forEach((l) => { const x = num(l); if (x === 1) groups.amb.push(l); else if (x >= 2 && x <= 5) groups.cpu.push(l); else if (x >= 6 && x <= 13) groups.mem.push(l); });
        }
        return groups;
    }

    function buildStrips(n) {
        const st = n.ss;
        const up = hostUp(n.server);
        const m = st.load && st.load[LD.range];
        const h = st.ilo.hist && st.ilo.hist[LD.range];
        const strips = [];
        const S = arr(m && m.samples);
        if (up && S.length) {
            const col = (f) => S.filter((x) => x[f] != null).map((x) => [x.t, f === '_mem' ? 0 : x[f]]);
            strips.push({ id: 'cpu', title: 'CPU', unit: '%', max: 100, fmt: (v) => `${Math.round(v)}%`, series: [{ name: 'CPU', color: C.cpu, pts: col('cpu') }] });
            strips.push({ id: 'mem', title: 'Memory used', unit: '%', max: 100, fmt: (v) => `${Math.round(v)}%`, series: [{ name: 'Memory', color: C.mem, pts: S.filter((x) => x.memTotalB).map((x) => [x.t, (x.memUsedB / x.memTotalB) * 100]) }] });
            const bps = (v) => `${R.bytes(v)}/s`;
            strips.push({ id: 'disk', title: 'Disk (per second)', fmt: bps, series: [{ name: 'Read', color: C.r, pts: col('diskRBps') }, { name: 'Write', color: C.w, pts: col('diskWBps') }] });
            strips.push({ id: 'net', title: 'Network (per second)', fmt: bps, series: [{ name: 'Receive', color: C.rx, pts: col('netRxBps') }, { name: 'Send', color: C.tx, pts: col('netTxBps') }] });
        }
        if (h) {
            const tl = Object.keys(h.temp || {});
            const g = tempGroups(st, tl);
            const ts = [];
            if (g.amb.length) ts.push({ name: 'Ambient', color: C.amb, pts: agg(g.amb.map((l) => h.temp[l]), maxOf) });
            if (g.cpu.length) ts.push({ name: 'CPU (hottest)', color: C.hot, pts: agg(g.cpu.map((l) => h.temp[l]), maxOf) });
            if (g.mem.length) ts.push({ name: 'Memory (hottest)', color: C.memT, pts: agg(g.mem.map((l) => h.temp[l]), maxOf) });
            if (!ts.length && tl.length) ts.push({ name: 'Hottest', color: C.hot, pts: agg(tl.map((l) => h.temp[l]), maxOf) });
            if (ts.length) strips.push({ id: 'temp', title: 'Temperatures', fmt: (v) => `${Math.round(v)}°C`, series: ts });
            const fl = Object.keys(h.fan || {});
            if (fl.length) strips.push({ id: 'fan', title: 'Fans', unit: '%', max: 100, fmt: (v) => `${Math.round(v)}%`, series: [{ name: 'Fans (average)', color: C.fan, pts: agg(fl.map((l) => h.fan[l]), avgOf) }, { name: 'Fans (fastest)', color: C.tx, pts: agg(fl.map((l) => h.fan[l]), maxOf) }] });
            if (arr(h.power).length) strips.push({ id: 'pwr', title: 'Power', fmt: (v) => `${Math.round(v)} W`, series: [{ name: 'Power', color: C.pwr, pts: h.power.map((p) => [p[0], p[1]]), band: h.power.map((p) => [p[0], p[2], p[3]]) }] });
        }
        if (up && S.length) {
            strips.push({ id: 'count', title: 'Running', fmt: (v) => String(Math.round(v)), step: true, int: true, series: COUNT.map(([f, name, color]) => ({ name, color, pts: S.map((x) => [x.t, f === 'builds' ? (x.builds || 0) + (x.jobs || 0) : (x[f] || 0)]) })) });
        }
        return { strips, from: (m && m.from) || (h && h.from), to: (m && m.to) || (h && h.to), off: offSpans(h) };
    }

    /** [from, to] spans where the iLO says the host was off */
    function offSpans(h) {
        const on = arr(h && h.on);
        const out = [];
        let from = null;
        for (let i = 0; i < on.length; i++) {
            if (on[i][1] === 0 && from == null) from = on[i][0];
            if (on[i][1] !== 0 && from != null) { out.push([from, on[i][0]]); from = null; }
        }
        if (from != null) out.push([from, h.to]);
        return out;
    }

    // ---- the drawing ---------------------------------------------------------------------------------------------------

    function stack(d, W) {
        const padL = 46;
        const padR = 8;
        const padT = 4;
        const stripH = 58;
        const titleH = 14;
        const gap = 7;
        const axisH = 20;
        const rows = d.strips;
        const H = padT + rows.length * (titleH + stripH + gap) - gap + axisH;
        const span = d.to - d.from;
        const X = (t) => padL + ((t - d.from) / span) * (W - padL - padR);
        const out = [];
        const fmtT = (t) => (span > 2 * 86400e3 ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) : new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        const tickT = [0, 0.25, 0.5, 0.75, 1].map((f) => d.from + span * f);
        const tip = { strips: [], from: d.from, to: d.to, W, padL, padR, H, padT, axisH };
        rows.forEach((s, i) => {
            const y0 = padT + i * (titleH + stripH + gap) + titleH;
            const vals = s.series.flatMap((x) => x.pts.map((p) => p[1])).concat(s.series.flatMap((x) => arr(x.band).flatMap((b) => [b[1], b[2]]))).filter((v) => Number.isFinite(v) && (s.id === 'temp' || v >= 0));
            let hi = s.max != null ? s.max : (vals.length ? Math.max(...vals) : 1);
            let lo = 0;
            if (s.id === 'temp' || s.id === 'pwr') { lo = vals.length ? Math.min(...vals) : 0; const sp = Math.max(hi - lo, s.id === 'pwr' ? 40 : 6); lo = Math.max(0, lo - sp * 0.15); hi = hi + sp * 0.15; }
            else if (s.max == null) hi = Math.max(hi * 1.12, s.int ? 2 : 1);
            if (s.int) hi = Math.ceil(hi);
            // values are capped to the strip: a rate can come in below zero (a counter that reset) or above a fixed max (CPU over 100 %)
            const Y = (v) => y0 + stripH - ((Math.min(hi, Math.max(lo, Number(v) || 0)) - lo) / (hi - lo || 1)) * stripH;
            out.push(`<rect x="${padL}" y="${y0}" width="${W - padL - padR}" height="${stripH}" class="rm-cbg"/>`);
            d.off.forEach(([a, b]) => { const x1 = Math.max(padL, X(a)); const x2 = Math.min(W - padR, X(b)); if (x2 > x1) out.push(`<rect x="${x1.toFixed(1)}" y="${y0}" width="${(x2 - x1).toFixed(1)}" height="${stripH}" class="rm-coff"/>`); });
            [0, 0.5, 1].forEach((f) => { const yy = y0 + stripH - f * stripH; out.push(`<line x1="${padL}" x2="${W - padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="rm-cg"/>`); });
            tickT.forEach((t) => out.push(`<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${y0}" y2="${y0 + stripH}" class="rm-cg is-v"/>`));
            const lab = (v) => (v === 0 ? '0' : s.unit === '%' ? `${Math.round(v)}` : s.int ? String(Math.round(v)) : s.fmt(v).replace(/ ?(°C| W|\/s)$/, ''));
            out.push(`<text x="${padL - 4}" y="${y0 + 9}" text-anchor="end" class="rm-ct">${esc(lab(hi))}</text><text x="${padL - 4}" y="${y0 + stripH - 1}" text-anchor="end" class="rm-ct">${esc(lab(lo))}</text>`);
            out.push(`<text x="${padL}" y="${y0 - 4}" class="rm-ct rm-cs">${esc(s.title)}${s.unit && s.unit !== '%' ? ` (${esc(s.unit)})` : s.unit ? ' %' : ''}</text>`);
            const gapMs = Math.max(span / 90, 120000);
            const path = (pts) => {
                let dd = '';
                let prev = null;
                let py = 0;
                for (const p of pts) {
                    const x = X(p[0]).toFixed(1);
                    const y = Y(p[1]).toFixed(1);
                    if (prev == null || p[0] - prev > gapMs) dd += `M${x},${y}`; else dd += s.step ? `H${x}V${y}` : `L${x},${y}`;
                    prev = p[0]; py = y;
                }
                void py;
                return dd;
            };
            s.series.forEach((x) => {
                if (x.band && x.band.length) out.push(`<path d="${x.band.map((b, k) => `${k ? 'L' : 'M'}${X(b[0]).toFixed(1)},${Y(b[2]).toFixed(1)}`).join('')}${x.band.slice().reverse().map((b) => `L${X(b[0]).toFixed(1)},${Y(b[1]).toFixed(1)}`).join('')}Z" fill="${x.color}" opacity=".18"/>`);
                if (x.pts.length) out.push(`<path d="${path(x.pts)}" fill="none" stroke="${x.color}" stroke-width="1.4" class="rm-cl"/>`);
            });
            tip.strips.push({ title: s.title, fmt: s.fmt, series: s.series.map((x) => ({ name: x.name, color: x.color, pts: x.pts })) });
        });
        const ya = padT + rows.length * (titleH + stripH + gap) - gap;
        tickT.forEach((t, k) => out.push(`<text x="${X(t).toFixed(1)}" y="${ya + 14}" text-anchor="${k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}" class="rm-ct">${esc(fmtT(t))}</text>`));
        out.push(`<line class="rm-ccur" y1="${padT + titleH}" y2="${ya}" x1="0" x2="0" hidden/>`);
        LD.tip = tip;
        return `<svg class="rm-stack" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-rm-stack>${out.join('')}</svg>`;
    }

    const paneWidth = (c) => { const p = c.el && c.el('.mmc-result'); return Math.max(300, ((p && p.clientWidth) || 480) - 50); };

    R.loadSection = (c, n) => {
        const st = n.ss;
        const up = hostUp(n.server);
        const nav = `<p class="rm-switch">${RANGES.map((r) => (r === LD.range ? `<b>${r}</b>` : R.link('ld-range', r, r))).join(' | ')}</p>`;
        const ld = st.load || {};
        const h = st.ilo.hist && st.ilo.hist[LD.range];
        let note = '';
        if (!up) note = `<p class="mmc-hint">${esc(n.meta.label)} is ${esc((R.PSTATE[R.powerState(n.server)] || '').toLowerCase())}: the iLO strips show, the off periods are shaded.</p>`;
        else if (ld.err) note = `<p>${c.state(false, `The host strips could not be read. ${esc(ld.err)}`, true)}</p>`;
        const hErr = st.ilo.hist && st.ilo.hist[`${LD.range}Err`];
        if (hErr) note += `<p>${c.state(false, `The iLO strips could not be read. ${esc(hErr)}`, true)}</p>`;
        const data = buildStrips(n);
        let body;
        if (!data.strips.length || !data.from || !data.to) body = (ld.loading || (!h && !hErr) || (up && !ld[LD.range] && !ld.err)) ? '<p class="mmc-hint">Reading the load history...</p>' : '<p class="mmc-hint">There is no data for this range yet.</p>';
        else {
            LD.lastW = paneWidth(c);
            const legend = data.strips.flatMap((s) => s.series.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`)).filter((v, i, a) => a.indexOf(v) === i);
            body = `<div class="rm-chartwrap">${stack(data, LD.lastW)}<div class="rm-tip" hidden></div></div><div class="rm-legend2">${legend.join('')}</div><p class="mmc-hint">Move the pointer over the graph for every value at that time.</p>`;
        }
        return { id: 'rm-load', title: `Load History (last ${LD.range === '3h' ? '3 hours' : LD.range === '6h' ? '6 hours' : LD.range === '24h' ? '24 hours' : '7 days'})`, body: nav + note + body };
    };

    // ---- the hover: one cursor across every strip --------------------------------------------------------------------------
    R.hooks.open.push((c) => {
        const pane = c.el('.mmc-result');
        pane.addEventListener('mousemove', (ev) => {
            const svg = ev.target.closest && ev.target.closest('[data-rm-stack]');
            if (!svg || !LD.tip) return;
            const t0 = LD.tip;
            const wrap = svg.parentElement;
            const tipEl = wrap.querySelector('.rm-tip');
            const cur = svg.querySelector('.rm-ccur');
            const r = svg.getBoundingClientRect();
            const x = ev.clientX - r.left;
            const t = t0.from + ((x - t0.padL) / (t0.W - t0.padL - t0.padR)) * (t0.to - t0.from);
            if (t < t0.from || t > t0.to) { tipEl.hidden = true; cur.setAttribute('hidden', ''); return; }
            const near = (pts) => { let b = null; for (const p of pts) if (!b || Math.abs(p[0] - t) < Math.abs(b[0] - t)) b = p; return b && Math.abs(b[0] - t) <= (t0.to - t0.from) / 40 ? b : null; };
            const rows = t0.strips.map((s) => `<div class="rm-tip-h">${esc(s.title)}</div>${s.series.map((x) => { const p = near(x.pts); return `<div><i style="background:${x.color}"></i>${esc(x.name)} <b>${p ? esc(s.fmt(s.title === 'Temperatures' ? p[1] : Math.max(0, Number(p[1]) || 0))) : '-'}</b></div>`; }).join('')}`).join('');
            cur.removeAttribute('hidden');
            cur.setAttribute('x1', x); cur.setAttribute('x2', x);
            tipEl.innerHTML = `<div class="mmc-hint">${esc(new Date(t).toLocaleString())}</div>${rows}`;
            tipEl.hidden = false;
            const wr = wrap.getBoundingClientRect();
            const left = x + 14 + tipEl.offsetWidth > wr.width ? x - 14 - tipEl.offsetWidth : x + 14;
            tipEl.style.left = `${Math.max(2, left)}px`;
        });
        pane.addEventListener('mouseleave', () => { pane.querySelectorAll('.rm-stack ~ .rm-tip, .rm-chartwrap .rm-tip').forEach((e) => { e.hidden = true; }); pane.querySelectorAll('.rm-stack .rm-ccur').forEach((e) => e.setAttribute('hidden', '')); });
        // the pane resized: the strips are drawn again at the new width (text is never scaled)
        if (typeof ResizeObserver === 'function') {
            let t = null;
            const ro = new ResizeObserver(() => { if (t) return; t = setTimeout(() => { t = null; if (!R.live(c)) return; const n = R.here(c); if (n.kind === 'server' && Math.abs(paneWidth(c) - LD.lastW) > 12) R.repaint(c); }, 200); });
            ro.observe(pane);
            R.hooks.close.push(() => { ro.disconnect(); clearTimeout(t); });
        }
    });
})(typeof window !== 'undefined' ? window : globalThis);
