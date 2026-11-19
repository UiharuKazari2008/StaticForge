'use strict';

/**
 * Program fault reports: every "<program> has stopped working" dialog the desktop shows
 * (public/scripts/comp/programFaults.js) is upserted here, so the fault can be fixed from the
 * report alone. One JSON file per fault signature under data/fault-reports/<id>.json:
 *
 *   id         fault_<12 hex>, from program + error type + message + the top frames of ours
 *   count      dialogs this fault has caused; repeats: faults counted into those dialogs
 *   latest     the newest occurrence in full (stack, source, client, open windows)
 *   recent     the last RECENT_KEPT occurrences, newest first, stack only when it differed
 *
 * The client posts { occurrenceId, ... } once when the dialog opens and again (same occurrenceId)
 * when more faults were counted into it: the second post updates that occurrence, it is not a
 * new one. The dialog's Copy Report reads the report back (GET) before it says "saved".
 *
 *   POST /api/fault-reports      -> { ok, id, count, file }   403 read-only, 413 too big, 429 too many
 *   GET  /api/fault-reports      -> { ok, reports }           newest first, from the in-memory index
 *   GET  /api/fault-reports/:id  -> { ok, report, file } | 404
 *
 * Not only dialogs (Yozora #833): every captured error lands here, from three surfaces -
 *   surface  desktop | mobile | server
 *   kind     dialog (a "has stopped working" dialog), uncaught, rejection, swallowed (a catch block
 *            handed it over), resource (one of our scripts/styles failed to load), route (an Express
 *            route threw), logged (logger.error / console.error with an Error of ours), crash
 *            (the server died of it; spooled synchronously, read back on the next start), animation
 *            (not an error: the page's animation watchdog found an animation that runs unseen or
 *            without end, public/scripts/utils/offscreenAnimationPause.js, #930; the finding is in
 *            the occurrence's `animation` field: type hidden | endless | restarts, name, target,
 *            reason, properties, runMs, shell, client, whether the page paused it, stylesheet)
 * public/scripts/comp/errorCapture.js posts the client ones, modules/serverFaultCapture.js the
 * server ones (in process, through upsert). modules/faultAutoFix.js listens for 'change' events
 * and records its runs on the report's `fix` field through patch().
 *
 *   store.events.on('change', ({ id, created, regressed, report }) => ...)  one per new occurrence
 *   store.patch(id, (report) => { ... })   serialized with the upserts of that report
 *   spoolSync(body)                        for a process about to exit; drained by load()
 *
 * Limits: posts over MAX_BODY_BYTES are refused; each session may post RATE_MAX times per
 * RATE_WINDOW_MS; at most MAX_REPORTS files are kept, and reports not seen for MAX_AGE_MS are
 * pruned (both checked after every new report and once at start). All file IO is async; writes
 * to one report run one after another so an update never loses another.
 *
 * Docs: docs/client-api/rest-api.md (Fault reports). Test: scripts/test-program-faults.js
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'fault-reports');
const REPO_ROOT = path.join(__dirname, '..');
const RECENT_KEPT = 10;
const MAX_STACK = 16000;
const MAX_RECENT_STACK = 4000;
const MAX_TEXT = 2000;
const MAX_LIST = 40;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_REPORTS = 500;
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const RATE_MAX = 30;
const RATE_WINDOW_MS = 60 * 1000;
const ID_RE = /^fault_[0-9a-f]{12}$/;
const SURFACES = new Set(['desktop', 'mobile', 'server']);
const KINDS = new Set(['dialog', 'uncaught', 'rejection', 'swallowed', 'resource', 'route', 'logged', 'crash', 'animation']);
const SPOOL_NAME = '.spool.ndjson';
const KIND_RANK = ['crash', 'uncaught', 'rejection', 'route', 'dialog', 'swallowed', 'resource', 'logged', 'animation'];

function clip(value, max = MAX_TEXT) {
    if (value == null) return '';
    const s = typeof value === 'string' ? value : String(value);
    return s.length > max ? s.slice(0, max) + '…' : s;
}

function clipList(list, max = MAX_LIST, each = 300) {
    return Array.isArray(list) ? list.slice(0, max).map((v) => clip(v, each)) : [];
}

/** Frames of our own scripts, without line:column (they move with every build). */
function frameKeys(stack) {
    const keys = [];
    for (const line of String(stack || '').split('\n')) {
        const m = line.match(/at\s+(?:(.*?)\s+\()?(?:https?:\/\/[^/\s)]+)?(\/[^\s):?]+)[^\s)]*:\d+:\d+\)?/)
            || line.match(/^\s*(?:([^@\s]*)@)(?:https?:\/\/[^/\s)]+)?(\/[^\s:?]+)[^\s]*:\d+:\d+/);
        if (!m) continue;
        const file = m[2].startsWith(REPO_ROOT + '/') ? m[2].slice(REPO_ROOT.length) : m[2];
        if (/\/node_modules\/|^\/?internal\//.test(file)) continue;
        keys.push(`${m[1] || '?'}@${file}`);
        if (keys.length >= 3) break;
    }
    return keys;
}

/** Numbers and quoted values vary between runs of one bug; the signature leaves them out. */
function messageKey(message) {
    return String(message || '').replace(/(["'`]).*?\1/g, '$1$1').replace(/\d+/g, '#').slice(0, 300);
}

function faultId(input) {
    const program = input.program || {};
    const basis = [program.key || program.name || '', input.errorName || '', messageKey(input.message), frameKeys(input.stack).join('|')].join('\n');
    return 'fault_' + crypto.createHash('sha1').update(basis).digest('hex').slice(0, 12);
}

function normalizeOccurrence(body, now) {
    const b = body && typeof body === 'object' ? body : {};
    const program = b.program && typeof b.program === 'object' ? b.program : {};
    const client = b.client && typeof b.client === 'object' ? b.client : {};
    const request = b.request && typeof b.request === 'object' ? b.request : null;
    const surface = SURFACES.has(b.surface) ? b.surface : 'desktop';
    const kind = KINDS.has(b.kind) ? b.kind : 'dialog';
    return {
        surface,
        kind,
        occurrenceId: clip(b.occurrenceId, 80) || crypto.randomBytes(6).toString('hex'),
        at: clip(b.at, 40) || now,
        receivedAt: now,
        program: {
            key: clip(program.key, 120),
            name: clip(program.name, 120),
            launchId: clip(program.launchId, 120) || null,
            game: clip(program.game, 80) || null,
            core: !!program.core,
            windowId: clip(program.windowId, 120) || null,
            windowTitle: clip(program.windowTitle, 200) || null
        },
        errorName: clip(b.errorName, 80),
        message: clip(b.message),
        stack: clip(b.stack, MAX_STACK),
        fileLine: clip(b.fileLine, 400),
        source: clip(b.source, 120),
        scripts: clipList(b.scripts, 20),
        page: clip(b.page, 40),
        action: clip(b.action, 40) || null,
        request: request ? {
            method: clip(request.method, 10),
            path: clip(request.path, 300),
            status: Number(request.status) || null
        } : null,
        server: b.server && typeof b.server === 'object' ? {
            pid: Number(b.server.pid) || null,
            uptimeS: Number(b.server.uptimeS) || null,
            node: clip(b.server.node, 40),
            commit: clip(b.server.commit, 60) || null
        } : null,
        animation: kind === 'animation' && b.animation && typeof b.animation === 'object' ? {
            type: clip(b.animation.type, 20),
            name: clip(b.animation.name, 120),
            kind: clip(b.animation.kind, 20),
            target: clip(b.animation.target, 300),
            window: clip(b.animation.window, 200),
            reason: clip(b.animation.reason, 80),
            properties: clip(b.animation.properties, 200),
            iterations: clip(b.animation.iterations, 20),
            durationMs: Number(b.animation.durationMs) || 0,
            runMs: Number(b.animation.runMs) || 0,
            targets: Number(b.animation.targets) || 1,
            paused: !!b.animation.paused,
            allowed: clip(b.animation.allowed, 200),
            source: clip(b.animation.source, 300),
            shell: clip(b.animation.shell, 20),
            client: clip(b.animation.client, 20)
        } : undefined,
        repeats: Math.max(1, Math.min(1e6, Number(b.repeats) || 1)),
        extraFaults: Array.isArray(b.extraFaults) ? b.extraFaults.slice(0, 3).map((f) => ({
            message: clip(f && f.message, 500),
            stack: clip(f && f.stack, 2000)
        })) : [],
        client: {
            url: clip(client.url, 400),
            userAgent: clip(client.userAgent, 400),
            viewport: clip(client.viewport, 40),
            uptimeMs: Number(client.uptimeMs) || null,
            desktopState: clip(client.desktopState, 40),
            build: clip(client.build, 120) || null,
            clientId: clip(client.clientId, 40) || null,
            shell: clip(client.shell, 40) || null,
            windows: clipList(client.windows, 30, 160)
        }
    };
}

function summary(r) {
    return {
        id: r.id,
        program: r.program && r.program.name,
        surface: r.surface || 'desktop',
        kind: r.kind || 'dialog',
        message: r.message,
        count: r.count,
        repeats: r.repeats,
        status: r.status,
        fix: r.fix ? { state: r.fix.state, attempts: r.fix.attempts || 0, issue: r.fix.issue || null, commit: r.fix.commit || null } : null,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen
    };
}

/**
 * For a process about to exit (uncaughtException): one line appended synchronously, so the fault is
 * on disk before process.exit. load() folds the spool into the store on the next start.
 */
function spoolSync(body, dir = DEFAULT_DIR) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        let line = JSON.stringify(Object.assign({}, body, { at: (body && body.at) || new Date().toISOString() }));
        if (Buffer.byteLength(line) > MAX_BODY_BYTES) line = JSON.stringify(Object.assign({}, body, { stack: clip(body && body.stack, 8000), extraFaults: [] }));
        fs.appendFileSync(path.join(dir, SPOOL_NAME), line + '\n', 'utf8');
        return true;
    } catch (_) {
        return false;
    }
}

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

function createStore(options = {}) {
    const dir = options.dir || DEFAULT_DIR;
    const maxReports = options.maxReports || MAX_REPORTS;
    const maxAgeMs = options.maxAgeMs || MAX_AGE_MS;
    const clock = options.now || (() => Date.now());
    const events = new EventEmitter();
    events.setMaxListeners(20);
    const index = new Map(); // id -> summary, every report on disk
    const chains = new Map(); // id -> the write in flight for that report
    let loaded = null;

    function fileFor(id) {
        return path.join(dir, id + '.json');
    }

    async function readFile(id) {
        try {
            return JSON.parse(await fsp.readFile(fileFor(id), 'utf8'));
        } catch (_) {
            return null;
        }
    }

    /** The index, read once from disk; old and surplus reports go on the way. */
    function load() {
        if (!loaded) {
            loaded = (async () => {
                let names = [];
                try {
                    names = (await fsp.readdir(dir)).filter((n) => /^fault_[0-9a-f]{12}\.json$/.test(n));
                } catch (_) {
                    return;
                }
                for (const n of names) {
                    const r = await readFile(n.slice(0, -5));
                    if (r && r.id) index.set(r.id, summary(r));
                }
                await prune();
            })().then(() => drainSpool());
        }
        return loaded;
    }

    /** Faults a dying process wrote with spoolSync, folded in once the index is up. */
    async function drainSpool() {
        const spool = path.join(dir, SPOOL_NAME);
        const taken = `${spool}.${process.pid}.${Date.now()}`;
        try {
            await fsp.rename(spool, taken);
        } catch (_) {
            return 0;
        }
        let n = 0;
        try {
            const lines = (await fsp.readFile(taken, 'utf8')).split('\n').filter(Boolean);
            for (const line of lines.slice(-200)) {
                let body = null;
                try { body = JSON.parse(line); } catch (_) { continue; }
                try {
                    await upsertLoaded(body);
                    n += 1;
                } catch (_) { /* a bad line is dropped */ }
            }
        } finally {
            await fsp.unlink(taken).catch(() => {});
        }
        return n;
    }

    async function prune() {
        const cutoff = clock() - maxAgeMs;
        const byAge = Array.from(index.values()).sort((a, b) => String(a.lastSeen).localeCompare(String(b.lastSeen)));
        const drop = byAge.filter((s) => Date.parse(s.lastSeen) < cutoff);
        const keep = byAge.length - drop.length;
        if (keep > maxReports) {
            const dropSet = new Set(drop);
            drop.push(...byAge.filter((s) => !dropSet.has(s)).slice(0, keep - maxReports));
        }
        for (const s of drop) {
            index.delete(s.id);
            await fsp.unlink(fileFor(s.id)).catch(() => {});
        }
        return drop.length;
    }

    async function read(id) {
        if (!ID_RE.test(String(id || ''))) return null;
        await load();
        if (chains.has(id)) await chains.get(id).catch(() => {});
        const r = await readFile(id);
        if (!r) index.delete(id);
        return r;
    }

    async function write(report) {
        await fsp.mkdir(dir, { recursive: true });
        const file = fileFor(report.id);
        const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(report, null, 2) + '\n', 'utf8');
        await fsp.rename(tmp, file);
        return file;
    }

    async function apply(occ, id, now) {
        const existing = await readFile(id);
        const report = existing || {
            id,
            program: occ.program,
            surface: occ.surface,
            kind: occ.kind,
            errorName: occ.errorName,
            message: occ.message,
            firstSeen: now,
            lastSeen: now,
            count: 0,
            repeats: 0,
            status: 'open',
            latest: null,
            recent: []
        };
        const prev = report.recent.find((o) => o.occurrenceId === occ.occurrenceId);
        let regressed = false;
        if (prev) {
            // the same dialog again: more faults counted into it, or the button that closed it
            report.repeats += Math.max(0, occ.repeats - (prev.repeats || 1));
            prev.repeats = Math.max(prev.repeats || 1, occ.repeats);
            if (occ.action) prev.action = occ.action;
            if (report.latest && report.latest.occurrenceId === occ.occurrenceId) {
                report.latest.repeats = prev.repeats;
                if (occ.action) report.latest.action = occ.action;
                if (occ.extraFaults.length) report.latest.extraFaults = occ.extraFaults;
            }
        } else {
            report.count += 1;
            report.repeats += occ.repeats;
            const stackSeen = report.recent.some((o) => o.stack === clip(occ.stack, MAX_RECENT_STACK)) || (report.latest && report.latest.stack === occ.stack);
            report.recent.unshift(Object.assign({}, occ, {
                stack: stackSeen ? undefined : clip(occ.stack, MAX_RECENT_STACK),
                extraFaults: undefined,
                client: undefined
            }));
            report.recent.length = Math.min(report.recent.length, RECENT_KEPT);
            report.latest = occ;
            // a fault that comes back after it was marked fixed is open again
            if (report.status === 'fixed') {
                report.status = 'regressed';
                regressed = true;
            }
        }
        report.lastSeen = now;
        report.program = occ.program;
        if (!report.surface) report.surface = occ.surface;
        // the report keeps its most serious kind: a fault first seen as a log line that later crashed is a crash
        if (!report.kind || KIND_RANK.indexOf(occ.kind) < KIND_RANK.indexOf(report.kind)) report.kind = occ.kind;
        const file = await write(report);
        index.set(id, summary(report));
        if (!existing && index.size > maxReports) await prune();
        const result = { id, count: report.count, repeats: report.repeats, file: path.relative(REPO_ROOT, file), report, created: !existing, regressed, update: !!prev };
        if (!prev) {
            try { events.emit('change', result); } catch (err) { console.error('Fault reports: change listener failed:', err && err.message); }
        }
        return result;
    }

    /** Change a stored report (the fixer's `fix` field, status); runs after that report's pending writes. */
    async function patch(id, mutate) {
        if (!ID_RE.test(String(id || ''))) return null;
        await load();
        const run = (chains.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
            const report = await readFile(id);
            if (!report) return null;
            const out = await mutate(report);
            if (out === false) return report;
            await write(report);
            index.set(id, summary(report));
            return report;
        });
        chains.set(id, run);
        try {
            return await run;
        } finally {
            if (chains.get(id) === run) chains.delete(id);
        }
    }

    /** Insert the fault, or fold this occurrence into its existing report. */
    async function upsert(body) {
        const now = new Date(clock()).toISOString();
        const occ = normalizeOccurrence(body, now);
        if (!occ.program.key && !occ.program.name) throw httpError(400, 'program is required');
        if (!occ.message && !occ.stack) throw httpError(400, 'message or stack is required');
        await load();
        return upsertOcc(occ, now);
    }

    /** The spool drain runs inside load(), so it must not wait for load() again. */
    async function upsertLoaded(body) {
        const now = new Date(clock()).toISOString();
        const occ = normalizeOccurrence(body, now);
        if ((!occ.program.key && !occ.program.name) || (!occ.message && !occ.stack)) return null;
        return upsertOcc(occ, now);
    }

    async function upsertOcc(occ, now) {
        const id = faultId(occ);
        const run = (chains.get(id) || Promise.resolve()).catch(() => {}).then(() => apply(occ, id, now));
        chains.set(id, run);
        try {
            return await run;
        } finally {
            if (chains.get(id) === run) chains.delete(id);
        }
    }

    async function list(limit = 50) {
        await load();
        return Array.from(index.values())
            .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
            .slice(0, limit);
    }

    return { dir, events, upsert, patch, read, list, prune, load, drainSpool, fileFor, size: () => index.size };
}

/** Posts per session in a sliding window (application keys and IPs stand in for sessions). */
function createRateLimiter(options = {}) {
    const max = options.max || RATE_MAX;
    const windowMs = options.windowMs || RATE_WINDOW_MS;
    const clock = options.now || (() => Date.now());
    const hits = new Map();
    return function allow(key) {
        const t = clock();
        const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
        if (list.length >= max) {
            hits.set(key, list);
            return false;
        }
        list.push(t);
        hits.set(key, list);
        if (hits.size > 5000) {
            for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] >= windowMs) hits.delete(k);
        }
        return true;
    };
}

function requesterKey(req) {
    if (req.sessionID) return 's:' + req.sessionID;
    if (req.applicationKeyId) return 'k:' + req.applicationKeyId;
    return 'ip:' + (req.ip || (req.socket && req.socket.remoteAddress) || '?');
}

let sharedStore = null;

/** The one store of this process (data/fault-reports): the routes, server capture and the fixer share it. */
function defaultStore() {
    if (!sharedStore) sharedStore = createStore();
    return sharedStore;
}

function mountProgramFaultReports(app, authMiddleware, options = {}) {
    const store = options.store || (options.dir ? createStore(options) : defaultStore());
    const allow = options.allow || createRateLimiter(options);
    const auth = authMiddleware || ((req, res, next) => next());
    store.load().catch((err) => console.error('Fault reports: index failed:', err.message));

    app.post('/api/fault-reports', auth, async (req, res) => {
        try {
            // modules/auth.js isReadOnlyUser: read-only logins report nothing here
            if (req.userType === 'readonly') throw httpError(403, 'Read-only sessions do not save fault reports');
            const declared = Number(req.headers['content-length']) || 0;
            const size = declared || Buffer.byteLength(JSON.stringify(req.body || {}));
            if (size > MAX_BODY_BYTES) throw httpError(413, `Fault report over ${MAX_BODY_BYTES} bytes`);
            if (!allow(requesterKey(req))) {
                res.setHeader('Retry-After', String(Math.ceil(RATE_WINDOW_MS / 1000)));
                throw httpError(429, 'Too many fault reports from this session');
            }
            const result = await store.upsert(req.body);
            res.json({ ok: true, id: result.id, count: result.count, repeats: result.repeats, file: result.file });
        } catch (err) {
            res.status(err.status || 500).json({ ok: false, error: err.message });
        }
    });
    app.get('/api/fault-reports', auth, async (req, res) => {
        try {
            res.json({ ok: true, reports: await store.list(Math.min(200, Number(req.query.limit) || 50)) });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    app.get('/api/fault-reports/:id', auth, async (req, res) => {
        try {
            const report = await store.read(req.params.id);
            if (!report) return res.status(404).json({ ok: false, error: 'No such fault report' });
            res.json({ ok: true, report, file: path.relative(REPO_ROOT, store.fileFor(report.id)) });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    return store;
}

module.exports = {
    createStore,
    defaultStore,
    spoolSync,
    createRateLimiter,
    mountProgramFaultReports,
    faultId,
    frameKeys,
    messageKey,
    DEFAULT_DIR,
    MAX_BODY_BYTES,
    SURFACES,
    KINDS,
    MAX_REPORTS,
    MAX_AGE_MS,
    RATE_MAX,
    RATE_WINDOW_MS
};
