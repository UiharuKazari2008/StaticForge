#!/usr/bin/env node
'use strict';

/**
 * Reload server modules in the running Dreamscape without a restart (#1292 / #1293, Yukimi Nov 26 2026: "we need a
 * high priority task to develop a way to separate and reload modules in the server independently").
 * Design: docs/server/hot-reload.md. The server side is modules/hotReload.js (its unix socket, one JSON line in / one out).
 *
 *   bash scripts/reload-server-module.sh <file...> --why "<reason>" [--by "<agent name> (<agent id>)"] [--notify] [--json] [--dry-run]
 *   node scripts/reload-server-module.js  <file...> --why "<reason>" [--by "<agent name> (<agent id>)"] [--notify] [--json] [--dry-run]
 *
 * --by names who asks (agent-coord's server_reload_module passes it: the MCP server is not the asking session); without it
 * the asker is derived from the Claude session this runs under (restart-gate.js selfSessionId), else $USER. The text goes
 * to the server as the reload's `by`, to the gate (it skips that agent and records it as the one who asked) and to the record.
 * --json: stdout carries exactly one JSON object ({ ok, code, files, plan, gate, result, lines, ... }) and nothing else;
 * progress lines go to stderr. Usage errors (exit 2) then also print the object.
 *
 * Steps: normalise the files to repo-relative paths -> node --check each -> ask the running server for the plan
 * (socket op plan) -> warn about destructured imports of the reloaded modules -> the light gate
 * (node scripts/restart-gate.js --reload <files + dependents>) -> [--dry-run stops here] -> record -> socket op reload.
 * It never polls and never retries; the socket client gives up after 60 s.
 *
 * Exit codes:
 *   0   reloaded (or, with --dry-run, the plan and the gate verdict are fine; or nothing of it is loaded in the server)
 *   2   usage (--why missing, no file, unknown option)
 *   10  the gate says ask <agent> (with --notify they were asked in their agent-coord inbox)
 *   20  the gate says wait for <agent or signal>
 *   30  denied: a file fails node --check (here or in the gate)
 *   50  needs a restart or another route: a file is not a server module under modules/ (scripts/restart-dreamscape.sh),
 *       a client file (scripts/client-update.sh), or a loaded module is not marked reloadable (restart)
 *   51  the plan has other blockers (missing file ...), or the reload failed and was rolled back (the server keeps
 *       running the old version), or the socket gave no usable answer within 60 s
 *   52  the running Dreamscape has no reload socket (it predates hot reload, or is down): one restart is needed
 *
 * Environment: HOT_RELOAD_SOCKET overrides the socket path (hotReload.socketPath()), AGENT_COORD_DB the coord database.
 * RELOAD_GATE_SKIP=1 is TEST-ONLY (scripts/test-reload-server-module.js): it skips the light gate step so the test does not
 * depend on the live agents. Never set it by hand: the gate is what keeps a reload from loading someone's half-done edit.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOCKET_TIMEOUT_MS = 60000;
const USAGE = 'usage: bash scripts/reload-server-module.sh <file...> --why "<reason>" [--by "<agent name> (<agent id>)"] [--notify] [--json] [--dry-run]';
const CLIENT_PATH_RE = /^(public\/|apps\/[^/]+\/(client|assets)\/|apps\/[^/]+\/manifest\.json$)/;

const opts = { files: [], why: '', by: '', notify: false, json: false, dryRun: false };
const lines = [];   // the text output (kept for --json)
const state = {};   // what --json prints besides the lines

function say(line) { lines.push(line); (opts.json ? process.stderr : process.stdout).write(`${line}\n`); }

function finish(code, extra) {
    if (opts.json) process.stdout.write(`${JSON.stringify(Object.assign({ ok: code === 0, code }, state, extra || {}, { lines }), null, 1)}\n`);
    process.exit(code);
}

function usage(msg) {
    process.stderr.write(`${msg ? `${msg}\n` : ''}${USAGE}\n`);
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok: false, code: 2, error: msg || USAGE, lines: [] }, null, 1)}\n`);
    process.exit(2);
}

function parseArgs(argv) {
    let bad = '';
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--why' || a === '--by') {
            const v = String(argv[i + 1] === undefined ? '' : argv[i + 1]);
            if (v.startsWith('--')) { if (a === '--why') opts.why = ''; } else { opts[a === '--why' ? 'why' : 'by'] = v.trim(); i += 1; }
        }
        else if (a === '--notify') opts.notify = true;
        else if (a === '--json') opts.json = true;
        else if (a === '--dry-run') opts.dryRun = true;
        else if (a.startsWith('--')) bad = bad || `unknown option ${a}`;
        else opts.files.push(a);
    }
    if (bad) usage(bad); // after the whole line is read, so --json anywhere makes the answer an object
    if (!opts.why.trim()) usage('say what the reload is for: --why "<reason>"');
    if (!opts.files.length) usage('name at least one server module to reload');
}

/** Repo-relative, forward-slash path of a file argument (relative ones: from the current folder when it holds the file, else from the repo). */
function normalize(f) {
    let abs = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
    if (!path.isAbsolute(f) && !(abs.startsWith(ROOT + path.sep) && fs.existsSync(abs))) abs = path.join(ROOT, f);
    return path.relative(ROOT, path.normalize(abs)).split(path.sep).join('/');
}

function firstErrorLine(text) {
    const l = String(text || '').trim().split('\n');
    return l.find((x) => /Error/.test(x)) || l[0] || 'syntax error';
}

// ---------------------------------------------------------------- the socket

/** One request, one answer. Rejects with { code: 'ENOENT' | 'ECONNREFUSED' | 'TIMEOUT' | ... }. Gives up after 60 s. */
function socketCall(req, file) {
    return new Promise((resolve, reject) => {
        let buf = '';
        let settled = false;
        const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
        const sock = net.connect(file);
        sock.setEncoding('utf8');
        sock.setTimeout(SOCKET_TIMEOUT_MS, () => { const e = new Error(`no answer from the reload socket within ${SOCKET_TIMEOUT_MS / 1000} s`); e.code = 'TIMEOUT'; done(reject, e); sock.destroy(); });
        sock.on('connect', () => sock.write(`${JSON.stringify(req)}\n`));
        sock.on('data', (c) => { buf += c; });
        sock.on('error', (e) => done(reject, e));
        sock.on('close', () => {
            const i = buf.indexOf('\n');
            const text = i >= 0 ? buf.slice(0, i) : buf;
            try { done(resolve, JSON.parse(text)); } catch (_) { const e = new Error(`the reload socket closed without an answer${text ? `: ${text.slice(0, 120)}` : ''}`); e.code = 'NOANSWER'; done(reject, e); }
        });
    });
}

function noSocket(file) {
    say(`no reload socket (${file}): the running Dreamscape has no reload socket (it predates hot reload, or is down): one restart through scripts/restart-dreamscape.sh is needed`);
    finish(52, { error: 'no reload socket' });
}

async function ask(req, file) {
    let res;
    try { res = await socketCall(req, file); } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') noSocket(file);
        say(`the reload socket failed (${e.code || 'error'}): ${e.message}`);
        finish(51, { error: e.message });
    }
    if (!res || !res.ok) { say(`the reload socket refused: ${(res && res.error) || 'no answer'}`); finish(51, { error: (res && res.error) || 'refused' }); }
    return res.result;
}

// ---------------------------------------------------------------- warnings

/** Destructured imports of a reloaded module keep its old functions (check-hot-imports.js lists them): a warning, never a block. */
function warnHotImports(files) {
    const script = path.join(ROOT, 'scripts', 'check-hot-imports.js');
    if (!fs.existsSync(script)) return;
    const r = spawnSync(process.execPath, [script, '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    let o = null;
    try { o = JSON.parse(r.stdout); } catch (_) { return; }
    const hits = Array.isArray(o) ? o : (o && (o.hits || o.imports || o.results || o.findings)) || [];
    if (!Array.isArray(hits)) return;
    const bases = files.map((f) => path.basename(f, '.js').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`[/'"](?:${bases.join('|')})(?:\\.js)?['"]`);
    const mine = hits.filter((h) => re.test(typeof h === 'string' ? h : JSON.stringify(h)));
    if (!mine.length) return;
    state.hotImportWarnings = mine;
    say(`warning: ${mine.length} destructured import${mine.length === 1 ? '' : 's'} of a reloaded module keep${mine.length === 1 ? 's' : ''} the old function after the reload (call it at call time instead):`);
    mine.slice(0, 12).forEach((h) => say(`  ${typeof h === 'string' ? h : [h.file, h.line, h.text || h.import || h.module || ''].filter((x) => x !== undefined && x !== '').join(':')}`));
}

// ---------------------------------------------------------------- the gate

function runGate(gateFiles) {
    if (process.env.RELOAD_GATE_SKIP === '1') { say('gate: skipped (RELOAD_GATE_SKIP=1, test only)'); state.gate = { skipped: true }; return; }
    const argv = [path.join(ROOT, 'scripts', 'restart-gate.js'), '--reload', gateFiles.join(','), '--why', opts.why];
    if (opts.notify) argv.push('--notify');
    if (opts.by) argv.push('--by', opts.by);
    const r = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    const text = `${r.stdout || ''}${r.stderr || ''}`.trimEnd();
    const code = r.status === null ? 30 : r.status;
    state.gate = { code, output: text };
    text.split('\n').filter(Boolean).forEach((l) => say(l.startsWith('  ') ? l : `gate: ${l}`));
    if (code !== 0) finish(code, { error: `the gate did not approve (exit ${code})` });
}

// ---------------------------------------------------------------- recording

/**
 * The reload as an agent-coord build with target module-reload (who, files, why, result), like builds: a 'running' row
 * while it runs (a restart gate and other reloads wait for it), 'done' with the result after. Written straight into the
 * builds table: a reload has no participants to ask (the light gate above already did), so no gate messages go out.
 * Returns the row id, or 0 when the coord DB is not there.
 */
function recordReloadStart({ agentId, by, files, why }) {
    const store = require('../modules/agentCoord/store');
    const d = store.open();
    const t = Date.now();
    const note = `${String(why || '').slice(0, 180)} | files: ${files.join(', ')}`.slice(0, 300);
    const r = d.prepare("INSERT INTO builds (target, repo, requested_by, note, state, created_at, expires_at, started_at) VALUES ('module-reload', 'staticforge', ?, ?, 'running', ?, ?, ?)")
        .run(agentId || 'reload-gate', note, t, t + 10 * 60000, t);
    if (!agentId) { try { store.upsertAgent({ id: 'reload-gate', kind: 'other', name: 'Reload gate', task: `module reload by ${String(by || '').slice(0, 80)}`, pid: null }); } catch (_) { /* named later */ } }
    return Number(r.lastInsertRowid) || 0;
}
function recordReloadEnd(id, result) {
    if (!id) return;
    const store = require('../modules/agentCoord/store');
    const ok = result && result.ok;
    const text = ok
        ? `ok: reloaded ${(result.results || []).filter((x) => x.ok && !x.rolledBack).map((x) => x.file).join(', ') || 'nothing'}`
        : `failed, rolled back: ${(result && result.error) || 'no answer'}`;
    store.open().prepare("UPDATE builds SET state = 'done', ended_at = ?, result = ? WHERE id = ?").run(Date.now(), text.slice(0, 300), id);
}

/** '<agent name> (<claude-xxxxxxxx>)' for the reload record; the login name when this is not a Claude session. */
function identity(sessionId) {
    if (opts.by) {
        const m = /\((claude-[0-9a-f]{8})\)\s*$/.exec(opts.by);
        return { agentId: m ? m[1] : '', by: opts.by.slice(0, 120) };
    }
    if (!sessionId) return { agentId: '', by: process.env.USER || 'unknown' };
    const agentId = `claude-${sessionId.slice(0, 8)}`;
    let name = '';
    try { const store = require('../modules/agentCoord/store'); name = (store.getAgent(agentId) || {}).name || ''; store.close(); } catch (_) { /* no coord */ }
    if (!name) { try { const s = require('../modules/claudeSessions').liveSessions().find((x) => x.id === sessionId); name = s ? (s.givenName || s.name || '') : ''; } catch (_) { /* none */ } }
    return { agentId, by: `${name || 'Claude session'} (${agentId})` };
}

// ---------------------------------------------------------------- main

async function main() {
    parseArgs(process.argv.slice(2));

    // a. which files can be reloaded at all
    const files = opts.files.map(normalize).filter((f, i, a) => a.indexOf(f) === i);
    state.files = files;
    const bad = [];
    for (const f of files) {
        if (f.startsWith('../') || path.isAbsolute(f)) bad.push(`needs a restart: ${f} is not a server module under modules/ (use scripts/restart-dreamscape.sh)`);
        else if (CLIENT_PATH_RE.test(f)) bad.push(`not a reload: ${f} is a client file (use scripts/client-update.sh)`);
        else if (!f.startsWith('modules/') || !f.endsWith('.js')) bad.push(`needs a restart: ${f} is not a server module under modules/ (use scripts/restart-dreamscape.sh)`);
    }
    if (bad.length) { bad.forEach(say); finish(50, { error: bad[0] }); }

    // b. node --check
    for (const f of files) {
        const abs = path.join(ROOT, f);
        if (!fs.existsSync(abs)) continue; // the plan reports a missing file
        const r = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8', timeout: 20000 });
        if (r.status !== 0) { say(`denied for ${f} fails node --check: ${firstErrorLine(r.stderr).slice(0, 220)}`); finish(30, { error: `${f} fails node --check` }); }
    }

    // c. the plan from the running server
    const hot = require('../modules/hotReload');
    const sockFile = hot.socketPath();
    const plan = await ask({ op: 'plan', files }, sockFile);
    state.plan = plan;
    if (!plan.ok) {
        const restart = plan.blockers.filter((b) => b.state === 'not-reloadable');
        if (restart.length) {
            restart.forEach((b) => say(`needs a restart: ${b.file} (${String(b.reason).replace(/ \(no hot\)/, '').replace(/: needs a restart$/, '')}) - use scripts/restart-dreamscape.sh`));
            plan.blockers.filter((b) => b.state !== 'not-reloadable').forEach((b) => say(`cannot reload: ${b.file} (${b.reason})`));
            finish(50, { error: 'needs a restart' });
        }
        plan.blockers.forEach((b) => say(`cannot reload: ${b.file} (${b.reason})`));
        finish(51, { error: 'the plan has blockers' });
    }
    plan.files.forEach((f) => say(`plan: ${f.file} ${f.state}${f.why && f.why !== 'asked' ? ` (${f.why})` : ''}${f.state === 'not-loaded' ? ` - ${f.reason}` : ''}`));
    (plan.dependents || []).forEach((d) => say(`plan: ${d} is a declared dependent (its editors are asked, it is not reloaded)`));
    if (!plan.files.some((f) => f.state === 'reload')) {
        say(`nothing to reload: ${plan.files.map((f) => f.file).join(', ')} not loaded in the running server (the next require loads the new code)`);
        finish(0, { reloaded: [] });
    }

    // d. warnings
    warnHotImports(plan.files.map((f) => f.file));

    // e. the light gate (the planned files and their dependents)
    const gateFiles = plan.files.map((f) => f.file).concat(plan.dependents || []).filter((f, i, a) => a.indexOf(f) === i);
    runGate(gateFiles);

    // f. --dry-run stops here
    if (opts.dryRun) { say(`dry run: would reload ${plan.files.filter((f) => f.state === 'reload').map((f) => f.file).join(', ')}`); finish(0, { dryRun: true }); }

    // g/h. record and reload
    const sessionId = opts.by ? '' : require('./restart-gate').selfSessionId();
    const who = identity(sessionId);
    let recordId = 0;
    try { recordId = recordReloadStart({ agentId: who.agentId, by: who.by, files, why: opts.why }); } catch (_) { recordId = 0; /* no coord DB: the reload still runs */ }
    let result;
    try {
        result = await ask({ op: 'reload', files, why: opts.why, by: who.by }, sockFile);
    } catch (e) {
        try { recordReloadEnd(recordId, { ok: false, error: e.message }); } catch (_) { /* recorded best effort */ }
        throw e;
    }
    state.result = result;
    state.record = recordId;
    try { recordReloadEnd(recordId, result); } catch (_) { /* a record failure never undoes a reload */ }
    (result.results || []).forEach((r) => {
        if (r.ok && r.rolledBack) say(`  ${r.file}: rolled back with the batch`);
        else if (r.ok) say(`  ${r.file}: reloaded in ${r.ms} ms`);
        else say(`  ${r.file}: rolled back: ${r.error}`);
    });
    (result.skipped || []).forEach((f) => say(`  ${f}: not loaded in the server (its next require loads the new code)`));
    if (result.ok) {
        const done = (result.results || []).filter((r) => r.ok && !r.rolledBack).map((r) => r.file);
        say(`reloaded ${done.join(', ') || 'nothing'}`);
        finish(0, { reloaded: done });
    }
    say(`NOT reloaded: ${result.error || 'unknown error'} (the server keeps running the old version)`);
    finish(51, { error: result.error || 'reload failed' });
}

main().catch((e) => { process.stderr.write(`reload-server-module: ${e && e.stack ? e.stack : e}\n`); process.exit(51); });
