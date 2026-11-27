'use strict';

/**
 * Reload one server module (or a declared group) in the running Dreamscape process, without a restart (#1292).
 * Yukimi, 26.11.2026: "we need a high priority task to develop a way to separate and reload modules in the server
 * independently". The design note is docs/server/hot-reload.md; this file is the whole mechanism and is itself NOT
 * reloadable (it owns the reload socket and the record of what was reloaded).
 *
 * A module opts in by marking itself; an unmarked module is never reloaded (the reload says which file needs a restart):
 *
 *     module.exports = { start, stop, ... };
 *     require('./hotReload').mark(module, {
 *         dispose(ctx)  -> state     give up every long-lived thing (timers, intervals, fs watchers, listeners it added to
 *                                     other modules, servers it listens on) and return what the next version takes back
 *         accept(state, ctx)         take it back: re-arm timers, re-attach handed-over servers / listeners. state is null
 *                                     on a module's first arm-from-reload when dispose returned nothing. accept never
 *                                     mutates the objects in state (rollback hands the same state to the old version)
 *         group: ['./fleetDeps']     optional: files reloaded together with this one (same order every time)
 *         dependents: ['./ws/handlers/314-claudeDeskHandler.js']   optional: files whose uncommitted edits the light gate
 *                                     also asks about (they hold this module's exports; they are not reloaded)
 *     });
 *   or, for a module with no long-lived state: require('./hotReload').mark(module) / module.exports.hot = true.
 *
 * What makes callers safe (no stale references):
 *   - the exports object keeps its identity: a reload copies the new version's exports onto the SAME object, so
 *     `const sup = require('./agentSupervisor')` held at load time calls the new code after a reload;
 *   - never destructure functions out of a reloadable module at load time (`const { review } = require(...)` keeps the
 *     old function); call `sup.review()` or `require('./x').review()` at call time; scripts/check-hot-imports.js lists them;
 *   - a callback a reloadable module gives to longer-lived code (another module's onX(), a server's 'connection'
 *     listener, an EventEmitter) is late-bound: hot.late(module, 'fn') calls whatever module.exports.fn is now, or the
 *     listener is handed over in dispose() and swapped in accept().
 *
 * A reload, one module at a time and one reload at a time in the process:
 *   1. refuse the whole batch when a loaded file is not marked (or exports a function without hot.replaceExports),
 *   2. compile the new source first (a syntax error never disposes anything),
 *   3. old.hot.dispose() -> state, drop the old module from require's cache, require the file again,
 *   4. copy the new exports onto the old exports object, new.hot.accept(state), the loaders' afterAccept (the WS handler
 *      loader re-registers that file's packets),
 *   5. any throw (load, missing marker, accept, a loader) rolls back: the old exports come back, the old module goes back
 *      into the cache and old.hot.accept(state, { rollback: true }) re-arms it; earlier modules of the same batch roll back
 *      in reverse order. The server keeps running the old code and the answer says what failed.
 *
 * Entry points: the reload socket (serve(), one JSON line in / one out, mode 0600 beside the agent-coord DB:
 * ops plan / reload / list / history), used by scripts/reload-server-module.sh and agent-coord's server_reload_module.
 * No polling anywhere: nothing here runs unless a reload is asked for.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const vm = require('vm');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const MODULES_DIR = __dirname;
const DISPOSE_TIMEOUT_MS = 10000;
const ACCEPT_TIMEOUT_MS = 10000;
const HISTORY_MAX = 50;

const history = [];          // the last reloads: { at, by, why, files, ok, results }
const loaders = [];          // { name, match(abs), afterAccept(abs, exports, ctx), rollback(abs, exports, ctx) }
const reloadCount = new Map(); // abs -> reloads done
let busy = null;             // the reload in progress (one at a time)

// ---------------------------------------------------------------- marking and late binding

/** Marks a module reloadable. spec: { dispose, accept, group, dependents, replaceExports } or nothing (stateless). */
function mark(mod, spec) {
    if (!mod || typeof mod !== 'object' || !mod.exports) throw new Error('hotReload.mark(module, spec): pass the module object');
    const hot = spec && typeof spec === 'object' ? spec : {};
    Object.defineProperty(mod.exports, 'hot', { value: hot, enumerable: false, configurable: true, writable: true });
    return hot;
}

/** A function that always calls the current version's module.exports[name] (for callbacks given to longer-lived code). */
function late(mod, name) {
    return function lateBound(...args) {
        const fn = mod.exports && mod.exports[name];
        if (typeof fn !== 'function') throw new Error(`hotReload.late: ${path.basename(mod.filename || '?')} has no export ${name}`);
        return fn.apply(this, args);
    };
}

/** The current exports of a loaded module by repo-relative or modules-relative path (or its base name), or null. */
function get(name) {
    const abs = resolveFile(name);
    if (abs && require.cache[abs]) return require.cache[abs].exports;
    const base = String(name || '').replace(/\.js$/, '');
    const hit = Object.keys(require.cache).find((k) => k.startsWith(MODULES_DIR + path.sep) && path.basename(k, '.js') === base);
    return hit ? require.cache[hit].exports : null;
}

/** Registers a loader that re-wires reloaded files it owns (the WS handler loader). */
function addLoader(loader) {
    if (!loader || typeof loader.match !== 'function') throw new Error('hotReload.addLoader: needs match(abs)');
    const i = loaders.findIndex((l) => l.name && l.name === loader.name);
    if (i >= 0) loaders.splice(i, 1, loader); else loaders.push(loader);
}

function hotOf(exp) {
    if (!exp || (typeof exp !== 'object' && typeof exp !== 'function')) return null;
    const h = exp.hot;
    if (h === true) return {};
    return h && typeof h === 'object' ? h : null;
}

// ---------------------------------------------------------------- paths

/** Absolute path of a server module under modules/ (repo-relative 'modules/x.js', 'x.js', './x', or absolute), or ''. */
function resolveFile(p) {
    let s = String(p || '').trim();
    if (!s) return '';
    if (!path.isAbsolute(s)) {
        s = s.replace(/^\.\//, '');
        s = s.startsWith('modules/') ? path.join(ROOT, s) : path.join(MODULES_DIR, s);
    }
    if (!/\.js$/.test(s)) s += '.js';
    s = path.normalize(s);
    return s.startsWith(MODULES_DIR + path.sep) ? s : '';
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function relList(fromAbs, list) {
    return (Array.isArray(list) ? list : []).map((p) => {
        const s = String(p || '');
        if (!s) return '';
        if (s.startsWith('modules/')) return resolveFile(s);
        return resolveFile(path.join(path.dirname(fromAbs), s));
    }).filter(Boolean);
}

// ---------------------------------------------------------------- plan

/**
 * What a reload of these files would do, without doing it: each file's state (reload / not-loaded / not-reloadable /
 * missing / outside), the group members added, the declared dependents, and whether a restart is needed instead.
 */
function plan(files) {
    const want = [];
    const items = [];
    const seen = new Set();
    const add = (abs, why) => {
        if (seen.has(abs)) return;
        seen.add(abs);
        want.push({ abs, why });
    };
    (Array.isArray(files) ? files : [files]).forEach((f) => {
        const abs = resolveFile(f);
        if (!abs) { items.push({ file: String(f), state: 'outside', reason: 'only server modules under modules/ reload' }); return; }
        add(abs, 'asked');
    });
    // a declared group comes along (the loaded member's spec says who)
    for (let i = 0; i < want.length; i += 1) {
        const m = require.cache[want[i].abs];
        const h = m ? hotOf(m.exports) : null;
        if (h && h.group) relList(want[i].abs, h.group).forEach((g) => add(g, `group of ${rel(want[i].abs)}`));
    }
    const dependents = new Set();
    for (const w of want) {
        const it = { file: rel(w.abs), abs: w.abs, why: w.why };
        if (!fs.existsSync(w.abs)) { it.state = 'missing'; it.reason = 'no such file'; items.push(it); continue; }
        const m = require.cache[w.abs];
        if (!m) { it.state = 'not-loaded'; it.reason = 'not loaded in the server: its next require loads the new code'; items.push(it); continue; }
        const h = hotOf(m.exports);
        if (!h) { it.state = 'not-reloadable'; it.reason = 'not marked reloadable (no hot): needs a restart'; items.push(it); continue; }
        if (typeof m.exports === 'function' && !h.replaceExports) { it.state = 'not-reloadable'; it.reason = 'exports a function (callers keep the old one): needs a restart'; items.push(it); continue; }
        relList(w.abs, h.dependents).forEach((d) => dependents.add(rel(d)));
        it.state = 'reload';
        it.reloads = reloadCount.get(w.abs) || 0;
        items.push(it);
    }
    const blockers = items.filter((i) => ['outside', 'missing', 'not-reloadable'].includes(i.state));
    return {
        ok: !blockers.length,
        restartNeeded: blockers.some((b) => b.state === 'not-reloadable'),
        blockers: blockers.map((b) => ({ file: b.file, state: b.state, reason: b.reason })),
        files: items.map((i) => ({ file: i.file, state: i.state, why: i.why, reason: i.reason || '', reloads: i.reloads || 0 })),
        dependents: [...dependents].filter((d) => !items.some((i) => i.file === d))
    };
}

// ---------------------------------------------------------------- reload

function withTimeout(p, ms, what) {
    if (!p || typeof p.then !== 'function') return Promise.resolve(p);
    let t = null;
    return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} did not finish in ${Math.round(ms / 1000)} s`)), ms); })])
        .finally(() => clearTimeout(t));
}

/** Compiles the file's current source without running it (a syntax error is reported before anything is disposed). */
function compileCheck(abs) {
    const src = fs.readFileSync(abs, 'utf8').replace(/^#!.*/, '');
    new vm.Script(Module.wrap(src), { filename: abs }); // eslint-disable-line no-new
}

function setExports(target, from) {
    Reflect.ownKeys(target).forEach((k) => { try { delete target[k]; } catch (_) { /* not configurable */ } });
    Object.defineProperties(target, from);
}

/** Drops a module object from every parent's children list (else each reload keeps the old version alive). */
function unlinkChildren(old) {
    Object.values(require.cache).forEach((m) => {
        if (!m || !Array.isArray(m.children)) return;
        const i = m.children.indexOf(old);
        if (i >= 0) m.children.splice(i, 1);
    });
}

function errText(e) { return String((e && (e.stack || e.message)) || e).split('\n').slice(0, 3).join(' | ').slice(0, 600); }

/** Reloads one loaded, marked module. Returns { done, file, ms, undo() } or throws after restoring the old module. */
async function reloadOne(abs, ctx) {
    const t0 = Date.now();
    const old = require.cache[abs];
    const stable = old.exports;
    const oldHot = hotOf(stable);
    const snapshot = Object.getOwnPropertyDescriptors(stable);
    const myLoaders = loaders.filter((l) => { try { return l.match(abs); } catch (_) { return false; } });
    try { compileCheck(abs); } catch (e) { throw new Error(`the new source does not compile (nothing was touched): ${errText(e)}`); }

    let state = null;
    try {
        state = await withTimeout(oldHot.dispose ? oldHot.dispose(ctx) : null, DISPOSE_TIMEOUT_MS, 'dispose()');
    } catch (e) {
        // half stopped: arm it again from scratch so it keeps working
        try { if (oldHot.accept) await withTimeout(oldHot.accept(null, Object.assign({ rollback: true }, ctx)), ACCEPT_TIMEOUT_MS, 'accept()'); } catch (_) { /* reported below */ }
        throw new Error(`dispose() of the running version threw: ${errText(e)}`);
    }

    const restoreOld = async (why) => {
        setExports(stable, snapshot);
        if (require.cache[abs] && require.cache[abs] !== old) unlinkChildren(require.cache[abs]);
        require.cache[abs] = old;
        old.exports = stable;
        const notes = [];
        try { if (oldHot.accept) await withTimeout(oldHot.accept(state, Object.assign({ rollback: true }, ctx)), ACCEPT_TIMEOUT_MS, 'accept()'); } catch (e) { notes.push(`the old version's accept() also threw: ${errText(e)}`); }
        for (const l of myLoaders) { try { if (l.rollback) await l.rollback(abs, stable, ctx); } catch (e) { notes.push(`${l.name} rollback: ${errText(e)}`); } }
        return new Error(`${why}${notes.length ? `; ${notes.join('; ')}` : ''} - rolled back, the old version runs`);
    };

    delete require.cache[abs];
    let fresh = null;
    try {
        require(abs); // eslint-disable-line import/no-dynamic-require
        fresh = require.cache[abs];
    } catch (e) {
        delete require.cache[abs];
        throw await restoreOld(`loading the new version threw: ${errText(e)}`);
    }
    const newExports = fresh && fresh.exports;
    const newHot = hotOf(newExports);
    if (!newHot) {
        throw await restoreOld('the new version is not marked reloadable (it dropped hotReload.mark); restart instead');
    }
    if (typeof newExports === 'function' && !newHot.replaceExports) {
        throw await restoreOld('the new version exports a function: callers would keep the old one; restart instead');
    }

    // the same exports object, the new contents (holders of the old object call the new code)
    let newDesc = null;
    if (typeof newExports === 'object' && newExports !== stable) {
        newDesc = Object.getOwnPropertyDescriptors(newExports);
        setExports(stable, newDesc);
        fresh.exports = stable;
    }
    try {
        if (newHot.accept) await withTimeout(newHot.accept(state, ctx), ACCEPT_TIMEOUT_MS, 'accept()');
    } catch (e) {
        try { if (newHot.dispose) await withTimeout(newHot.dispose(Object.assign({ rollback: true }, ctx)), DISPOSE_TIMEOUT_MS, 'dispose()'); } catch (_) { /* best effort */ }
        throw await restoreOld(`accept() of the new version threw: ${errText(e)}`);
    }
    for (const l of myLoaders) {
        try {
            if (l.afterAccept) await l.afterAccept(abs, fresh.exports, ctx);
        } catch (e) {
            try { if (newHot.dispose) await withTimeout(newHot.dispose(Object.assign({ rollback: true }, ctx)), DISPOSE_TIMEOUT_MS, 'dispose()'); } catch (_) { /* best effort */ }
            throw await restoreOld(`${l.name} could not re-wire it: ${errText(e)}`);
        }
    }
    unlinkChildren(old);
    reloadCount.set(abs, (reloadCount.get(abs) || 0) + 1);
    return { file: rel(abs), ms: Date.now() - t0, reloads: reloadCount.get(abs) };
}

/**
 * Reloads files (repo-relative paths under modules/, or absolute) with their declared groups. Refuses the whole batch
 * when one is not reloadable (restartNeeded says a restart is the way). On a failure every module this batch already
 * reloaded is restored from memory (its old module object and exports, never re-read from disk), in reverse order.
 * Returns { ok, results, plan, error? }.
 */
async function reload(files, opts = {}) {
    while (busy) { try { await busy; } catch (_) { /* the other reload's result is its own */ } }
    let release = null;
    busy = new Promise((r) => { release = r; });
    const at = Date.now();
    const by = String(opts.by || 'unknown').slice(0, 120);
    const why = String(opts.why || '').slice(0, 300);
    const p = plan(files);
    const out = { ok: false, at, by, why, plan: p, results: [] };
    try {
        if (!p.ok) {
            out.error = p.restartNeeded
                ? `needs a restart: ${p.blockers.filter((b) => b.state === 'not-reloadable').map((b) => `${b.file} (${b.reason})`).join(', ')}`
                : `cannot reload: ${p.blockers.map((b) => `${b.file} (${b.reason})`).join(', ')}`;
            return out;
        }
        const todo = p.files.filter((f) => f.state === 'reload');
        const done = []; // { abs, old, stableSnapshot } for batch rollback
        const ctx = { by, why, files: todo.map((f) => f.file) };
        for (const f of todo) {
            const abs = resolveFile(f.file);
            const old = require.cache[abs];
            const before = { abs, old, desc: Object.getOwnPropertyDescriptors(old.exports) };
            try {
                const r = await reloadOne(abs, ctx);
                out.results.push(Object.assign({ ok: true }, r));
                done.push(before);
            } catch (e) {
                const msg = (e && e.message) || String(e);
                out.results.push({ ok: false, file: f.file, error: msg });
                // earlier members of this batch go back too (reverse order), from memory
                for (const d of done.reverse()) {
                    try { await revertTo(d, ctx); out.results.push({ ok: true, file: rel(d.abs), rolledBack: true }); } catch (e2) { out.results.push({ ok: false, file: rel(d.abs), rolledBack: false, error: `rollback failed: ${errText(e2)}` }); }
                }
                out.error = `${f.file}: ${msg}`;
                return out;
            }
        }
        out.ok = true;
        out.skipped = p.files.filter((f) => f.state === 'not-loaded').map((f) => f.file);
        return out;
    } finally {
        history.unshift({ at, by, why, files: p.files.map((f) => f.file), ok: out.ok, error: out.error || '', results: out.results });
        if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
        try { console.log(`[hotReload] ${out.ok ? 'reloaded' : 'NOT reloaded'} ${p.files.map((f) => f.file).join(', ')} by ${by}${why ? ` (${why})` : ''}${out.error ? `: ${out.error}` : ''}`); } catch (_) { /* log */ }
        busy = null;
        release();
    }
}

/** Puts a module this batch already reloaded back to the version it ran before (its module object and exports). */
async function revertTo(d, ctx) {
    const cur = require.cache[d.abs];
    const stable = cur.exports;
    const curHot = hotOf(stable);
    let state = null;
    if (curHot && curHot.dispose) state = await withTimeout(curHot.dispose(Object.assign({ rollback: true }, ctx)), DISPOSE_TIMEOUT_MS, 'dispose()');
    setExports(stable, d.desc);
    unlinkChildren(cur);
    require.cache[d.abs] = d.old;
    d.old.exports = stable;
    const oldHot = hotOf(stable);
    if (oldHot && oldHot.accept) await withTimeout(oldHot.accept(state, Object.assign({ rollback: true }, ctx)), ACCEPT_TIMEOUT_MS, 'accept()');
    for (const l of loaders) { if (l.match(d.abs) && l.rollback) await l.rollback(d.abs, stable, ctx); }
}

/** Every loaded module marked reloadable, with how often each was reloaded. */
function list() {
    return Object.keys(require.cache)
        .filter((k) => k.startsWith(MODULES_DIR + path.sep) && !k.includes(`${path.sep}node_modules${path.sep}`))
        .filter((k) => hotOf(require.cache[k].exports))
        .map((k) => ({ file: rel(k), reloads: reloadCount.get(k) || 0, group: (hotOf(require.cache[k].exports).group || []).length ? relList(k, hotOf(require.cache[k].exports).group).map(rel) : [] }))
        .sort((a, b) => a.file.localeCompare(b.file));
}

// ---------------------------------------------------------------- the reload socket

function socketPath() {
    if (process.env.HOT_RELOAD_SOCKET) return process.env.HOT_RELOAD_SOCKET;
    return path.join(path.dirname(require('./agentCoord/store').dbPath()), 'hot-reload.sock');
}

let server = null;

/** Listens on the reload socket (owner only). Idempotent. */
function serve() {
    if (server) return server;
    const file = socketPath();
    try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); } catch (_) { /* there */ }
    try { fs.unlinkSync(file); } catch (_) { /* none */ }
    server = net.createServer((sock) => {
        let buf = '';
        sock.setEncoding('utf8');
        sock.setTimeout(120000, () => sock.destroy());
        sock.on('error', () => {});
        sock.on('data', async (chunk) => {
            buf += chunk;
            if (buf.length > 65536) { sock.destroy(); return; }
            const i = buf.indexOf('\n');
            if (i < 0) return;
            let req = null;
            try { req = JSON.parse(buf.slice(0, i)); } catch (_) { req = null; }
            buf = '';
            let res;
            try {
                if (!req || typeof req.op !== 'string') throw new Error('send {"op": "plan" | "reload" | "list" | "history", ...}');
                if (req.op === 'plan') res = { ok: true, result: plan(req.files || []) };
                else if (req.op === 'reload') res = { ok: true, result: await reload(req.files || [], { by: req.by, why: req.why }) };
                else if (req.op === 'list') res = { ok: true, result: list() };
                else if (req.op === 'history') res = { ok: true, result: history.slice(0, Math.max(1, Math.min(HISTORY_MAX, Number(req.limit) || 20))) };
                else throw new Error(`unknown op ${req.op}`);
            } catch (e) { res = { ok: false, error: e.message }; }
            try { sock.end(`${JSON.stringify(res)}\n`); } catch (_) { /* gone */ }
        });
    });
    server.on('error', (e) => console.warn(`[hotReload] socket: ${e.message}`));
    server.listen(file, () => { try { fs.chmodSync(file, 0o600); } catch (_) { /* kept */ } });
    if (server.unref) server.unref();
    return server;
}

function close() {
    if (!server) return;
    try { server.close(); } catch (_) { /* closed */ }
    server = null;
}

module.exports = { mark, late, get, addLoader, plan, reload, list, history: () => history.slice(), serve, close, socketPath, resolveFile, _test: { hotOf, compileCheck, reloadCount } };
