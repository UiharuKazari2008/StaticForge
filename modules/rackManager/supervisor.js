'use strict';

/**
 * The lean process supervisor behind modules/rackManager (Rack Manager). Like modules/spawnHelperChild.js it has no
 * app requires: Dreamscape forks it once (cheap while the heap is small), and every long-lived child (the ssh
 * tunnels to rackd, the iLO service) is spawned from here, so the 800 MB server never forks per child and
 * nothing heavy (the iLO service decodes console video) runs in its event loop.
 *
 * IPC in : { op: 'start', id, cmd, args, env?, cwd?, minMs?, maxMs? }   (re)starts that child; restarts it with backoff
 *          { op: 'stop', id }                                            stops it and does not restart it
 *          { op: 'stopAll' }
 * IPC out: { ev: 'spawn', id, pid, restarts } | { ev: 'exit', id, code, signal, nextMs, tail }
 * Backoff: minMs (default 2 s) doubling to maxMs (default 60 s); a child that lived 30 s starts again at minMs.
 * Exits when the parent goes away (IPC disconnect).
 */

const { spawn } = require('child_process');

const kids = new Map(); // id -> { spec, proc, timer, backoff, startedAt, restarts, tail, stopped }
const STABLE_MS = 30000;
const TAIL_BYTES = 2000;

function send(msg) {
    try { process.send(msg); } catch (_) { process.exit(0); }
}

function launch(k) {
    k.timer = null;
    k.stopped = false;
    k.tail = '';
    const s = k.spec;
    let proc;
    try {
        proc = spawn(s.cmd, (s.args || []).map(String), { stdio: ['ignore', 'pipe', 'pipe'], env: s.env ? Object.assign({}, process.env, s.env) : process.env, cwd: s.cwd || undefined });
    } catch (e) {
        k.tail = String(e.message || e);
        return scheduleRestart(k, null, null);
    }
    k.proc = proc;
    k.startedAt = Date.now();
    const keep = (d) => { k.tail = (k.tail + d.toString()).slice(-TAIL_BYTES); };
    proc.stdout.on('data', keep);
    proc.stderr.on('data', keep);
    proc.on('error', (e) => { keep(String(e.message || e)); });
    proc.on('close', (code, signal) => {
        if (k.proc !== proc) return;
        k.proc = null;
        scheduleRestart(k, code, signal);
    });
    send({ ev: 'spawn', id: s.id, pid: proc.pid, restarts: k.restarts });
}

function scheduleRestart(k, code, signal) {
    const s = k.spec;
    if (Date.now() - (k.startedAt || 0) > STABLE_MS) k.backoff = s.minMs;
    const wait = k.stopped ? 0 : k.backoff;
    send({ ev: 'exit', id: s.id, code, signal, nextMs: k.stopped ? null : wait, tail: k.tail });
    if (k.stopped) { kids.delete(s.id); return; }
    k.backoff = Math.min(s.maxMs, k.backoff * 2);
    k.restarts += 1;
    k.timer = setTimeout(() => launch(k), wait);
}

function start(m) {
    if (typeof m.id !== 'string' || typeof m.cmd !== 'string' || !m.cmd) return;
    stop(m.id);
    const spec = { id: m.id, cmd: m.cmd, args: Array.isArray(m.args) ? m.args : [], env: m.env, cwd: m.cwd, minMs: m.minMs > 0 ? m.minMs : 2000, maxMs: m.maxMs > 0 ? m.maxMs : 60000 };
    const k = { spec, proc: null, timer: null, backoff: spec.minMs, startedAt: 0, restarts: 0, tail: '', stopped: false };
    kids.set(spec.id, k);
    launch(k);
}

function stop(id) {
    const k = kids.get(id);
    if (!k) return;
    k.stopped = true;
    if (k.timer) { clearTimeout(k.timer); k.timer = null; }
    if (k.proc) {
        try { k.proc.kill('SIGTERM'); } catch (_) { /* gone */ }
        const proc = k.proc;
        const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) { /* gone */ } }, 3000);
        if (t.unref) t.unref();
    } else kids.delete(id);
}

process.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.op === 'start') start(m);
    else if (m.op === 'stop') stop(String(m.id));
    else if (m.op === 'stopAll') [...kids.keys()].forEach(stop);
});
process.on('disconnect', () => {
    kids.forEach((k) => { k.stopped = true; if (k.timer) clearTimeout(k.timer); if (k.proc) { try { k.proc.kill('SIGTERM'); } catch (_) { /* gone */ } } });
    setTimeout(() => process.exit(0), 200);
});
