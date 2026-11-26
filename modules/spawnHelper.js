'use strict';

/**
 * Runs child commands through one long-lived small helper process (#1236 part A, Yukimi Nov 2026: the
 * Dreamscape server blocked its event loop on every spawn).
 *
 * Why: Linux forks the whole parent to spawn a child. The server is ~800 MB, partly swapped, so one
 * child_process.execFile blocks its event loop 90-480 ms (measured: 26 spawns in 60 s = 2.7 s blocked).
 * The helper (modules/spawnHelperChild.js, no app requires, --max-old-space-size=48) is forked once, then a
 * spawn is an IPC message and the fork happens in that tiny process.
 *
 * API
 *   run(cmd, args, opts)          -> Promise<{ code, stdout, stderr }>  (never rejects; code = the exit status
 *                                    or 1 on any error: the shape the claude* modules' defaultRunner returned)
 *   execFileText(cmd, args, opts) -> Promise<string> stdout; rejects (err.code, err.stderr) on a non-zero exit
 *   opts: { env, cwd, timeout, maxBuffer, encoding, input }; env is sent only when the caller gave one.
 *   warm()                        start the helper now (call it early at boot while the heap is still small:
 *                                 the one fork the helper costs is then cheap)
 *
 * Behaviour
 *   - Started lazily on the first call. timeout / maxBuffer are enforced in the helper (execFile options);
 *     the parent adds an unref'd safety timer per pending request only (nothing runs while idle).
 *   - The parent is never kept alive: the helper and its channel are unref'd, the channel is re-ref'd only
 *     while requests are pending. The helper exits on IPC disconnect (parent died): no orphan.
 *   - If the helper dies, its pending requests resolve as errors (not retried: a systemctl stop may have run).
 *     The next call respawns it, at most once per 5 s (calls in between run direct). 3 deaths in a minute:
 *     direct child_process.execFile for 5 minutes, one warning logged.
 */

const { fork, execFile } = require('child_process');
const path = require('path');

const CHILD = path.join(__dirname, 'spawnHelperChild.js');
let RESPAWN_MIN_MS = 5000;
const FAIL_WINDOW_MS = 60 * 1000;
const FAIL_LIMIT = 3;
const DIRECT_MS = 5 * 60 * 1000;
const SAFETY_MS = 5000;
const DEFAULT_TIMEOUT = 30000;

let child = null;
let seq = 0;
const pending = new Map();   // id -> { resolve, timer }
let lastSpawnAt = 0;
let failures = [];           // death times inside the window
let directUntil = 0;
let spawnedTotal = 0;

const now = () => Date.now();

function refChannel(on) {
    try {
        if (!child || !child.channel) return;
        if (on) child.channel.ref(); else child.channel.unref();
    } catch (_) { /* closed */ }
}

function failAll(message) {
    const list = [...pending.values()];
    pending.clear();
    list.forEach((p) => { if (p.timer) clearTimeout(p.timer); p.resolve({ code: null, signal: null, stdout: '', stderr: '', error: { message, code: 'EHELPER' } }); });
}

function onDeath(proc, why) {
    if (child !== proc) return;
    child = null;
    const t = now();
    failures = failures.filter((x) => t - x < FAIL_WINDOW_MS);
    failures.push(t);
    if (failures.length >= FAIL_LIMIT && t >= directUntil) {
        directUntil = t + DIRECT_MS;
        failures = [];
        console.warn(`[spawnHelper] helper died ${FAIL_LIMIT} times in a minute (${why}): running commands directly for 5 minutes`);
    }
    failAll(`spawn helper ended (${why})`);
}

function start() {
    const t = now();
    if (t < directUntil) return null;
    if (child) return child;
    if (lastSpawnAt && t - lastSpawnAt < RESPAWN_MIN_MS) return null;
    lastSpawnAt = t;
    let proc;
    try {
        proc = fork(CHILD, [], { execArgv: ['--max-old-space-size=48'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    } catch (e) {
        failures.push(t);
        return null;
    }
    spawnedTotal += 1;
    child = proc;
    proc.on('message', (m) => {
        if (!m || m.id == null) return;
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (p.timer) clearTimeout(p.timer);
        if (!pending.size) refChannel(false);
        p.resolve(m);
    });
    proc.on('exit', (code, signal) => onDeath(proc, `exit ${signal || code}`));
    proc.on('disconnect', () => onDeath(proc, 'disconnected'));
    proc.on('error', (e) => onDeath(proc, e.message));
    try { proc.unref(); } catch (_) { /* fine */ }
    refChannel(false);
    return proc;
}

function direct(cmd, args, opts) {
    return new Promise((resolve) => {
        const eo = { encoding: 'utf8', timeout: opts.timeout || DEFAULT_TIMEOUT, maxBuffer: opts.maxBuffer || 1024 * 1024 };
        if (opts.env) eo.env = opts.env;
        if (opts.cwd) eo.cwd = opts.cwd;
        const c = execFile(cmd, args, eo, (error, stdout, stderr) => {
            resolve({ code: error ? error.code : 0, signal: error && error.signal || null, stdout: String(stdout || ''), stderr: String(stderr || ''), error: error ? { message: error.message, code: error.code } : null });
        });
        if (opts.input != null) { try { c.stdin.on('error', () => {}); c.stdin.end(String(opts.input)); } catch (_) { /* none */ } }
    });
}

function viaHelper(proc, cmd, args, opts) {
    return new Promise((resolve) => {
        const id = ++seq;
        const timeout = opts.timeout || DEFAULT_TIMEOUT;
        const timer = setTimeout(() => {
            if (!pending.has(id)) return;
            pending.delete(id);
            if (!pending.size) refChannel(false);
            resolve({ code: null, signal: null, stdout: '', stderr: '', error: { message: 'spawn helper did not answer', code: 'EHELPER' } });
        }, timeout + SAFETY_MS);
        if (timer.unref) timer.unref();
        pending.set(id, { resolve, timer });
        refChannel(true);
        const req = { id, cmd, args, opts: { timeout, maxBuffer: opts.maxBuffer, encoding: opts.encoding, cwd: opts.cwd, input: opts.input } };
        if (opts.env) req.opts.env = opts.env;
        try {
            proc.send(req, (err) => {
                if (!err || !pending.has(id)) return;
                const p = pending.get(id);
                pending.delete(id);
                clearTimeout(p.timer);
                if (!pending.size) refChannel(false);
                resolve({ code: null, signal: null, stdout: '', stderr: '', error: { message: `spawn helper send failed: ${err.message}`, code: 'EHELPER' } });
            });
        } catch (e) {
            clearTimeout(timer);
            pending.delete(id);
            if (!pending.size) refChannel(false);
            resolve({ code: null, signal: null, stdout: '', stderr: '', error: { message: `spawn helper send failed: ${e.message}`, code: 'EHELPER' } });
        }
    });
}

function request(cmd, args, opts) {
    const o = opts || {};
    const a = Array.isArray(args) ? args.map(String) : [];
    const proc = start();
    return proc ? viaHelper(proc, String(cmd), a, o) : direct(String(cmd), a, o);
}

/** { code, stdout, stderr } like the old execFile-based runners: code is the exit status, 1 on any error. */
async function run(cmd, args, opts) {
    const r = await request(cmd, args, opts);
    return { code: r.error ? (typeof r.error.code === 'number' ? r.error.code : 1) : 0, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

/** stdout as text; rejects when the command fails (error.code, error.stderr, error.stdout). */
async function execFileText(cmd, args, opts) {
    const r = await request(cmd, args, opts);
    if (r.error) {
        const e = new Error(`${cmd} ${(args || []).slice(0, 3).join(' ')}: ${r.error.message}`);
        e.code = r.error.code;
        e.stdout = String(r.stdout || '');
        e.stderr = String(r.stderr || '');
        throw e;
    }
    return String(r.stdout || '');
}

function warm() { start(); return !!child; }

module.exports = {
    run,
    execFileText,
    warm,
    // tests
    _config: (o) => { if (o && o.respawnMs != null) RESPAWN_MIN_MS = o.respawnMs; },
    _state: () => ({ pid: child ? child.pid : null, pending: pending.size, spawned: spawnedTotal, directUntil, failures: failures.length }),
    _kill: (sig) => { if (child) { try { child.kill(sig || 'SIGKILL'); } catch (_) { /* gone */ } } },
    _reset: () => { if (child) { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } } child = null; failAll('reset'); lastSpawnAt = 0; failures = []; directUntil = 0; }
};
