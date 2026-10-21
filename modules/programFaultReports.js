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
 *   POST /api/fault-reports      -> { ok, id, count, file }
 *   GET  /api/fault-reports/:id  -> { ok, report } | 404
 *
 * Test: scripts/test-program-faults.js (server part)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'fault-reports');
const RECENT_KEPT = 10;
const MAX_STACK = 16000;
const MAX_TEXT = 2000;
const MAX_LIST = 40;
const ID_RE = /^fault_[0-9a-f]{12}$/;

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
        keys.push(`${m[1] || '?'}@${m[2]}`);
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
    return {
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
        repeats: Math.max(1, Math.min(1e6, Number(b.repeats) || 1)),
        extraFaults: Array.isArray(b.extraFaults) ? b.extraFaults.slice(0, 5).map((f) => ({
            message: clip(f && f.message),
            stack: clip(f && f.stack, 4000)
        })) : [],
        client: {
            url: clip(client.url, 400),
            userAgent: clip(client.userAgent, 400),
            viewport: clip(client.viewport, 40),
            uptimeMs: Number(client.uptimeMs) || null,
            desktopState: clip(client.desktopState, 40),
            build: clip(client.build, 120) || null,
            windows: clipList(client.windows, 30, 160)
        }
    };
}

function createStore(options = {}) {
    const dir = options.dir || DEFAULT_DIR;

    function fileFor(id) {
        return path.join(dir, id + '.json');
    }

    function read(id) {
        if (!ID_RE.test(String(id || ''))) return null;
        try {
            return JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
        } catch (_) {
            return null;
        }
    }

    function write(report) {
        fs.mkdirSync(dir, { recursive: true });
        const file = fileFor(report.id);
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, file);
        return file;
    }

    /** Insert the fault, or fold this occurrence into its existing report. */
    function upsert(body) {
        const now = new Date().toISOString();
        const occ = normalizeOccurrence(body, now);
        if (!occ.program.key && !occ.program.name) throw Object.assign(new Error('program is required'), { status: 400 });
        if (!occ.message && !occ.stack) throw Object.assign(new Error('message or stack is required'), { status: 400 });
        const id = faultId(occ);
        const report = read(id) || {
            id,
            program: occ.program,
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
        if (prev) {
            // the same dialog again: more faults counted into it, or the button that closed it
            report.repeats += Math.max(0, occ.repeats - (prev.repeats || 1));
            prev.repeats = Math.max(prev.repeats || 1, occ.repeats);
            if (occ.action) prev.action = occ.action;
            if (occ.extraFaults.length) prev.extraFaults = occ.extraFaults;
            if (report.latest && report.latest.occurrenceId === occ.occurrenceId) {
                report.latest.repeats = prev.repeats;
                if (occ.action) report.latest.action = occ.action;
                if (occ.extraFaults.length) report.latest.extraFaults = occ.extraFaults;
            }
        } else {
            report.count += 1;
            report.repeats += occ.repeats;
            const stackSeen = report.recent.some((o) => o.stack === occ.stack) || (report.latest && report.latest.stack === occ.stack);
            report.recent.unshift(Object.assign({}, occ, { stack: stackSeen ? undefined : occ.stack, client: undefined }));
            report.recent.length = Math.min(report.recent.length, RECENT_KEPT);
            report.latest = occ;
            // a fault that comes back after it was marked fixed is open again
            if (report.status === 'fixed') report.status = 'regressed';
        }
        report.lastSeen = now;
        report.program = occ.program;
        const file = write(report);
        return { id, count: report.count, repeats: report.repeats, file: path.relative(path.join(__dirname, '..'), file), report };
    }

    function list(limit = 50) {
        let names = [];
        try {
            names = fs.readdirSync(dir).filter((n) => /^fault_[0-9a-f]{12}\.json$/.test(n));
        } catch (_) {
            return [];
        }
        return names.map((n) => read(n.slice(0, -5))).filter(Boolean)
            .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
            .slice(0, limit)
            .map((r) => ({ id: r.id, program: r.program && r.program.name, message: r.message, count: r.count, repeats: r.repeats, status: r.status, firstSeen: r.firstSeen, lastSeen: r.lastSeen }));
    }

    return { dir, upsert, read, list, fileFor };
}

function mountProgramFaultReports(app, authMiddleware, options = {}) {
    const store = options.store || createStore(options);
    const auth = authMiddleware || ((req, res, next) => next());
    app.post('/api/fault-reports', auth, (req, res) => {
        try {
            const result = store.upsert(req.body);
            res.json({ ok: true, id: result.id, count: result.count, repeats: result.repeats, file: result.file });
        } catch (err) {
            res.status(err.status || 500).json({ ok: false, error: err.message });
        }
    });
    app.get('/api/fault-reports', auth, (req, res) => {
        res.json({ ok: true, reports: store.list(Math.min(200, Number(req.query.limit) || 50)) });
    });
    app.get('/api/fault-reports/:id', auth, (req, res) => {
        const report = store.read(req.params.id);
        if (!report) return res.status(404).json({ ok: false, error: 'No such fault report' });
        res.json({ ok: true, report, file: path.relative(path.join(__dirname, '..'), store.fileFor(report.id)) });
    });
    return store;
}

module.exports = {
    createStore,
    mountProgramFaultReports,
    faultId,
    frameKeys,
    messageKey,
    DEFAULT_DIR
};
