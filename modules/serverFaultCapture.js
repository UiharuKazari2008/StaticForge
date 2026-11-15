'use strict';

/**
 * Server fault capture (Yozora #833): the server's own errors go into the same fault store as the
 * desktop's and phone's (modules/programFaultReports.js), so modules/faultAutoFix.js can act on them.
 *
 *   crash(error)                    uncaughtException: spooled synchronously (the process exits next)
 *   capture(error, kind, extra)     rejection | route | logged | swallowed: upserted in the background
 *   routeErrorMiddleware()          for the final Express error handler (web_server.js)
 *   hookLogger(logger)              logger.error(...) and console.error(...) calls that carry an Error
 *                                   whose top frame of ours is in this repo (not node_modules)
 *
 * The same fault firing again inside THROTTLE_MS is counted, not written: one upsert per signature per
 * window, carrying the count as `repeats`. A capture that fails, or an error raised while capturing,
 * never reaches the capture again (reentrancy guard) and never throws to the caller.
 *
 * Test: scripts/test-error-capture.js
 */

const path = require('path');
const { execFileSync } = require('child_process');
const reports = require('./programFaultReports');

const REPO_ROOT = path.join(__dirname, '..');
const THROTTLE_MS = 30 * 1000;
const MAX_PENDING = 200;

let store = null;
let commit = null;
let capturing = false;
let installed = false;
const pending = new Map(); // throttle key -> { body, repeats, timer }

function repoCommit() {
    if (commit !== null) return commit;
    try {
        commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 3000 }).trim();
    } catch (_) {
        commit = '';
    }
    return commit;
}

/** The first frame in this repo outside node_modules: "modules/x.js:12" (null when there is none). */
function topOwnFrame(stack) {
    for (const line of String(stack || '').split('\n')) {
        const m = line.match(/\(?((?:\/[^\s():]+)+\.(?:js|cjs|mjs)):(\d+):\d+\)?\s*$/);
        if (!m) continue;
        const file = m[1];
        if (!file.startsWith(REPO_ROOT + path.sep)) continue;
        const rel = path.relative(REPO_ROOT, file);
        if (rel.startsWith('node_modules' + path.sep) || rel.includes(path.sep + 'node_modules' + path.sep)) continue;
        return { file: rel, line: Number(m[2]) };
    }
    return null;
}

function asError(value) {
    if (value instanceof Error) return value;
    if (value && typeof value === 'object' && (value.stack || value.message)) return value;
    const err = new Error(typeof value === 'string' ? value : (() => { try { return JSON.stringify(value); } catch (_) { return String(value); } })());
    err.name = 'NonErrorRejection';
    return err;
}

function buildBody(error, kind, extra = {}) {
    const err = asError(error);
    const stack = String(err.stack || '');
    const top = topOwnFrame(stack);
    const file = top ? top.file : 'web_server.js';
    const body = {
        surface: 'server',
        kind,
        program: { key: 'server:' + file, name: `Dreamscape server (${file})`, core: true },
        errorName: err.name || (err.constructor && err.constructor.name) || 'Error',
        message: String(err.message || err.code || 'Error'),
        stack,
        fileLine: top ? `${top.file}:${top.line}` : '',
        source: extra.source || '',
        page: 'server',
        at: new Date().toISOString(),
        server: {
            pid: process.pid,
            uptimeS: Math.round(process.uptime()),
            node: process.version,
            commit: repoCommit()
        }
    };
    if (err.code && !String(body.message).includes(String(err.code))) body.message += ` (${err.code})`;
    if (extra.request) body.request = extra.request;
    if (extra.note) body.extraFaults = [{ message: String(extra.note).slice(0, 500), stack: '' }];
    return body;
}

function throttleKey(body) {
    return [body.program.key, body.errorName, String(body.message).replace(/\d+/g, '#').slice(0, 200), body.fileLine.replace(/:\d+$/, '')].join('|');
}

function flush(key) {
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    if (entry.repeats <= 0) return;
    write(Object.assign({}, entry.body, { repeats: entry.repeats }));
}

function write(body) {
    const s = store || reports.defaultStore();
    capturing = true;
    let p;
    try {
        p = s.upsert(body);
    } catch (_) {
        p = null;
    } finally {
        capturing = false;
    }
    if (p && p.catch) p.catch(() => { /* the store said no (bad body, disk): nothing to do */ });
}

/**
 * Background capture. The first occurrence of a fault is written at once; the same fault again
 * inside THROTTLE_MS is counted and written once when the window ends.
 */
function capture(error, kind = 'logged', extra = {}) {
    if (capturing) return false;
    capturing = true;
    try {
        const body = buildBody(error, kind, extra);
        if (kind === 'logged' && !topOwnFrame(body.stack)) return false;
        const key = throttleKey(body);
        const entry = pending.get(key);
        if (entry) {
            entry.repeats += 1;
            return true;
        }
        if (pending.size >= MAX_PENDING) return false;
        const timer = setTimeout(() => flush(key), THROTTLE_MS);
        if (timer.unref) timer.unref();
        pending.set(key, { body, repeats: 0, timer });
        capturing = false;
        write(body);
        return true;
    } catch (_) {
        return false;
    } finally {
        capturing = false;
    }
}

/** uncaughtException: the process exits right after, so the fault goes to the spool synchronously. */
function crash(error) {
    try {
        const body = buildBody(error, 'crash', { source: 'uncaughtException' });
        return reports.spoolSync(body, (store && store.dir) || reports.DEFAULT_DIR);
    } catch (_) {
        return false;
    }
}

/** Throttled faults still waiting for their window: written to the spool on a graceful shutdown. */
function flushPendingSync() {
    for (const [key, entry] of pending) {
        clearTimeout(entry.timer);
        if (entry.repeats > 0) reports.spoolSync(Object.assign({}, entry.body, { repeats: entry.repeats }), (store && store.dir) || reports.DEFAULT_DIR);
        pending.delete(key);
    }
}

function requestInfo(req, status) {
    if (!req) return null;
    return {
        method: req.method,
        path: String(req.originalUrl || req.url || '').split('?')[0].slice(0, 300),
        status: status || 500
    };
}

/** Express route errors (500s) from the final error handler. */
function captureRoute(err, req) {
    return capture(err, 'route', { request: requestInfo(req, 500), source: 'express' });
}

function routeErrorMiddleware() {
    return function serverFaultRouteCapture(err, req, res, next) {
        const missing = err && (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.status === 404 || err.statusCode === 404);
        const clientError = err && Number(err.status || err.statusCode) >= 400 && Number(err.status || err.statusCode) < 500;
        if (err && !missing && !clientError) captureRoute(err, req);
        next(err);
    };
}

function firstError(args) {
    for (const a of args) if (a instanceof Error) return a;
    return null;
}

function noteFrom(args, err) {
    return args.filter((a) => a !== err && typeof a === 'string').join(' ').slice(0, 500);
}

/** logger.error / console.error with an Error of ours: kind 'logged' (not auto-fixed by default). */
function hookLogger(logger) {
    if (logger && typeof logger.error === 'function' && !logger.error.__faultCapture) {
        const orig = logger.error.bind(logger);
        const wrapped = function (...args) {
            const err = firstError(args);
            if (err) capture(err, 'logged', { source: 'logger.error', note: noteFrom(args, err) });
            return orig(...args);
        };
        wrapped.__faultCapture = true;
        logger.error = wrapped;
    }
    if (!console.error.__faultCapture) {
        const origConsole = console.error.bind(console);
        const wrappedConsole = function (...args) {
            const err = firstError(args);
            if (err) capture(err, 'logged', { source: 'console.error', note: noteFrom(args, err) });
            return origConsole(...args);
        };
        wrappedConsole.__faultCapture = true;
        console.error = wrappedConsole;
    }
}

/** Once at boot. options.store: the fault store (defaults to the shared one). */
function install(options = {}) {
    if (options.store) store = options.store;
    if (installed) return;
    installed = true;
    if (options.logger) hookLogger(options.logger);
    repoCommit();
}

module.exports = {
    install,
    capture,
    captureRoute,
    crash,
    flushPendingSync,
    hookLogger,
    routeErrorMiddleware,
    topOwnFrame,
    buildBody,
    THROTTLE_MS,
    _reset() {
        for (const entry of pending.values()) clearTimeout(entry.timer);
        pending.clear();
        store = null;
        installed = false;
        capturing = false;
    }
};
