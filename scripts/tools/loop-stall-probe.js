#!/usr/bin/env node
'use strict';

/**
 * Finds what blocks the live Dreamscape event loop without restarting it (#1236).
 *
 *   node scripts/tools/loop-stall-probe.js poll [seconds=600] [url]
 *       Requests a trivial route every 100 ms and prints every answer slower than 150 ms, then a summary
 *       ({ n, max, over150, over300 }). A 404 is fine: it still goes through the loop.
 *   node scripts/tools/loop-stall-probe.js profile [seconds=60] [out.cpuprofile]
 *       Opens the inspector on the running server (SIGUSR1 to the pm2 'Dreamscape' pid, 127.0.0.1:9229 only),
 *       takes a CPU profile while polling, closes the inspector again, and prints the busy runs over 100 ms
 *       with their top functions, plus totals by self time and by app entry point.
 *
 * Opening the inspector does not restart or pause the server; it stays open only while the profile runs.
 * Never leave it open: the closing evaluate runs even when the profile fails.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_URL = 'http://127.0.0.1:9220/api/loop-probe';

function poll(seconds, url, quiet) {
    return new Promise((resolve) => {
        const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
        const end = Date.now() + seconds * 1000;
        const stalls = [];
        let n = 0;
        let max = 0;
        const one = () => {
            if (Date.now() > end) {
                agent.destroy();
                resolve({ n, max, over150: stalls.length, over300: stalls.filter((s) => s.ms > 300).length, stalls });
                return;
            }
            const t0 = Date.now();
            const done = (code) => {
                const ms = Date.now() - t0;
                n += 1;
                if (ms > max) max = ms;
                if (ms > 150) {
                    const s = { at: new Date(t0).toISOString(), ms, code };
                    stalls.push(s);
                    if (!quiet) console.log(JSON.stringify(s));
                }
                setTimeout(one, Math.max(0, 100 - ms));
            };
            const req = http.get(url, { agent }, (res) => { res.resume(); res.on('end', () => done(res.statusCode)); });
            req.on('error', (e) => done(`ERR ${e.code}`));
        };
        one();
    });
}

function dreamscapePid() {
    const list = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    const p = list.find((x) => x.name === 'Dreamscape');
    if (!p || !p.pid) throw new Error('pm2 has no running Dreamscape');
    return p.pid;
}

async function inspectorSession() {
    let list = null;
    for (let i = 0; i < 20 && !list; i += 1) {
        try { list = await (await fetch('http://127.0.0.1:9229/json/list')).json(); } catch (_) { await new Promise((r) => setTimeout(r, 250)); }
    }
    if (!list || !list[0]) throw new Error('The inspector did not open on 127.0.0.1:9229');
    const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
    const ws = new WebSocket(list[0].webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const send = (method, params = {}) => new Promise((r) => { id += 1; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const close = async () => {
        try { await send('Runtime.evaluate', { expression: "process.mainModule.require('inspector').close()" }); } catch (_) { /* gone */ }
        try { ws.close(); } catch (_) { /* gone */ }
    };
    return { send, close };
}

function analyze(p) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    p.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
    const name = (n) => { const c = n.callFrame; return `${c.functionName || '(anon)'} ${c.url.replace(`file://${ROOT}/`, '')}:${c.lineNumber + 1}`; };
    const isApp = (n) => n.callFrame.url.includes(ROOT) && !n.callFrame.url.includes('node_modules');
    const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
    const top = (m, k, total) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k)
        .map(([key, v]) => `  ${(v / 1000).toFixed(0).padStart(6)} ms${total ? ` ${(100 * v / total).toFixed(1).padStart(5)}%` : ''}  ${key}`).join('\n');
    const self = new Map();
    const entry = new Map();
    const runs = [];
    let cur = null;
    let t = p.startTime;
    let total = 0;
    for (let i = 0; i < p.samples.length; i += 1) {
        t += p.timeDeltas[i];
        const dt = p.timeDeltas[i + 1] || 0;
        total += dt;
        const n = byId.get(p.samples[i]);
        const fn = n.callFrame.functionName;
        add(self, name(n), dt);
        if (fn === '(idle)') { if (cur && t - cur.end > 2000) { runs.push(cur); cur = null; } continue; }
        if (!cur) cur = { start: t, end: t, self: new Map(), app: new Map() };
        cur.end = t;
        add(cur.self, name(n), dt);
        const stack = [];
        for (let x = p.samples[i]; x; x = parent.get(x)) stack.push(byId.get(x));
        const app = stack.filter(isApp);
        new Set(app.map(name)).forEach((k) => add(cur.app, k, dt));
        if (fn !== '(garbage collector)' && fn !== '(program)') {
            add(entry, app.length ? name(app[app.length - 1]) + (app.length > 1 ? ` > ${name(app[app.length - 2])}` : '') : `(non-app) ${name(n)}`, dt);
        }
    }
    if (cur) runs.push(cur);
    const long = runs.filter((r) => r.end - r.start > 100000).sort((a, b) => (b.end - b.start) - (a.end - a.start));
    console.log(`\nBusy runs over 100 ms: ${long.length} (longest first, top 12)`);
    long.slice(0, 12).forEach((r) => {
        console.log(`\n== +${((r.start - p.startTime) / 1e6).toFixed(1)} s, ${((r.end - r.start) / 1000).toFixed(0)} ms\n self:\n${top(r.self, 6)}\n app (inclusive):\n${top(r.app, 6)}`);
    });
    console.log(`\nSelf time over ${(total / 1e6).toFixed(1)} s:\n${top(self, 15, total)}`);
    console.log(`\nApp entry points (JS time, GC excluded):\n${top(entry, 20)}`);
}

async function profile(seconds, out) {
    const pid = dreamscapePid();
    process.kill(pid, 'SIGUSR1');
    const s = await inspectorSession();
    let prof = null;
    let polled = null;
    try {
        await s.send('Profiler.enable');
        await s.send('Profiler.setSamplingInterval', { interval: 500 });
        await s.send('Profiler.start');
        console.log(`profiling pid ${pid} for ${seconds} s (inspector open until it ends)`);
        polled = await poll(seconds, DEFAULT_URL, true);
        prof = (await s.send('Profiler.stop')).result.profile;
    } finally {
        await s.close();
    }
    fs.writeFileSync(out, JSON.stringify(prof));
    console.log(`saved ${out}; poll during the profile: ${JSON.stringify({ n: polled.n, max: polled.max, over150: polled.over150, over300: polled.over300 })}`);
    analyze(prof);
}

(async () => {
    const [mode, a, b] = process.argv.slice(2);
    if (mode === 'poll') {
        const r = await poll(Number(a) || 600, b || DEFAULT_URL, false);
        console.log(JSON.stringify({ n: r.n, max: r.max, over150: r.over150, over300: r.over300 }));
    } else if (mode === 'profile') {
        await profile(Number(a) || 60, b || path.join(require('os').tmpdir(), `dreamscape-${Date.now()}.cpuprofile`));
    } else if (mode === 'analyze' && a) {
        analyze(JSON.parse(fs.readFileSync(a, 'utf8')));
    } else {
        console.log('usage: loop-stall-probe.js poll [seconds] [url] | profile [seconds] [out] | analyze <file.cpuprofile>');
        process.exitCode = 2;
    }
})().catch((e) => { console.error(e.message); process.exit(1); });
