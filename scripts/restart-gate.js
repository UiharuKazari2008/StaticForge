#!/usr/bin/env node
'use strict';

/**
 * Restart gate for the Dreamscape server (#1154, Yukimi Nov 24 2026: "change the rules and handling of
 * restarting the server so that it goes to a script that can check the status of agents and see if there
 * is any ongoing edits or work that would get interrupted by the restart and to return a "approved" /
 * "ask <agent>" / "wait for <agent or signal>" / "denied for <reason/failed validation>"").
 *
 *   node scripts/restart-gate.js [--json] [--notify] [--why "<reason for the restart>"]
 *
 * The first line of the answer is the verdict; each reason follows on its own line. Exit codes:
 *   0 approved   10 ask <agent>   20 wait for <agent or signal>   30 denied for <reason>
 * The worst finding wins: denied > wait > ask > approved.
 *
 * Checks:
 *   denied   the PM2 guard fails (scripts/host-deploy.sh --check-pm2); a changed server file does not pass
 *            `node --check` / JSON.parse (modules/, routes/, server.js, web_server.js, config JSON); the
 *            Director idle check cannot decide (exit 2)
 *   wait     the Director idle check is busy (a Director / Yozora / Wren turn, generation, MCP calls,
 *            local jobs, mail, HTTP): "wait for <what>"; a running agent-coord build gate in the repo; an
 *            open or running gate with target hold-restart (any agent's "do not restart now" signal)
 *   ask      a live Claude session (any account, not the one asking) holds uncommitted edits to server code
 *            it made, or claims on server paths: the restart would load them half done. --notify posts the
 *            question to its agent-coord inbox.
 *   approved none of the above (uncommitted server files nobody live holds are listed as notes)
 *
 * It never restarts anything itself: scripts/restart-dreamscape.sh runs it and restarts only on approved.
 *
 * --client: the same gate for a client update (service-worker notify; Yukimi, Nov 26 2026: "we have a restart wait
 * queue for server rebuilds, apparently we also need one for client rebuilds as well"). Client files are public/ and
 * the app packages' client / assets / manifest. The server-only checks (PM2, the Director idle check) are skipped -
 * a notify restarts nothing, clients reload on their own; validation, build gates (hold target hold-client-update),
 * the live sessions' uncommitted client edits and the Supervisor's stale-wait check are the same, with their own
 * wait list (client_gate_asks, Fleet's Client Update Waits). scripts/client-update.sh runs it and notifies only on approved.
 *
 * --reload <file,file,...>: the light gate for a server module reload without a restart (#1292, #1293; docs/server/hot-reload.md).
 * The files are repo-relative server files (modules/...); it may be combined with --why, --json and --notify.
 * A reload drops no connection and cuts no turn, so there is no PM2 guard and no Director idle check. Then:
 *   denied   one of exactly the listed files (committed or not) fails node --check / JSON.parse
 *   wait     a running agent-coord build with target dreamscape-restart (anyone's); a running module-reload build by
 *            someone else; an open or running gate with target hold-reload. hold-restart and hold-client-update do
 *            NOT hold a reload.
 *   ask      only the live sessions whose uncommitted edits (made after the file's last commit) are in the listed files,
 *            or whose claims cover a listed file that is uncommitted; nobody else, whatever else is dirty in the tree.
 *            --notify posts the question (from the agent 'reload-gate') to their agent-coord inbox; their own wait list
 *            is the table reload_gate_asks, so the restart wait lists are not touched.
 *   --by "<agent name> (<claude-xxxxxxxx>)" (reload mode): who asks when this does not run under that session itself
 *            (agent-coord's server_reload_module): that agent is not asked about its own edits, its own module-reload
 *            build does not hold the reload, and the ask rows record it as the asker.
 * scripts/reload-server-module.js runs it and reloads only on approved.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER_PATH_RE = /^(modules\/|routes\/|server\.js$|web_server\.js$|config\/[^/]+\.json$|[^/]+\.config\.json$|config\.json$|package\.json$)/;
const CLIENT_PATH_RE = /^(public\/|apps\/[^/]+\/(client|assets)\/|apps\/[^/]+\/manifest\.json$)/;
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const CLIENT = has('--client');
const RELOAD = has('--reload');
const PATH_RE = CLIENT ? CLIENT_PATH_RE : SERVER_PATH_RE;
const ASKS_TABLE = CLIENT ? 'client_gate_asks' : RELOAD ? 'reload_gate_asks' : 'gate_asks';
const HOLD_TARGET = CLIENT ? 'hold-client-update' : RELOAD ? 'hold-reload' : 'hold-restart';
const OWN_TARGET = CLIENT ? 'sw-notify' : RELOAD ? 'module-reload' : 'dreamscape-restart';
const WHAT = CLIENT ? 'client update' : RELOAD ? 'module reload' : 'restart';
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : ''; };

/** The --reload value as repo-relative, forward-slash paths (comma separated; './' and absolute paths inside the repo are normalised). */
function reloadFileList(value) {
    return String(value || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
        const abs = path.isAbsolute(x) ? x : path.join(ROOT, x);
        return path.relative(ROOT, abs).split(path.sep).join('/');
    }).filter((x, i, a) => a.indexOf(x) === i);
}
const RELOAD_FILES = RELOAD ? reloadFileList(valueOf('--reload')) : [];
let reloadDirty = []; // the listed files that are uncommitted (reload mode)
/** Reload mode: the agent id inside --by "<name> (<claude-xxxxxxxx>)", else ''. */
const BY_AGENT = RELOAD ? ((/\((claude-[0-9a-f]{8})\)\s*$/.exec(valueOf('--by') || '') || [])[1] || '') : '';

const findings = []; // { level: denied | wait | ask | note, text, agent? }
const add = (level, text, extra) => findings.push(Object.assign({ level, text }, extra || {}));

function run(cmd, argv, opts) {
    return spawnSync(cmd, argv, Object.assign({ cwd: ROOT, encoding: 'utf8', timeout: 60000 }, opts || {}));
}

// ---------------------------------------------------------------- denied: health and validation

function checkPm2() {
    const r = run('bash', ['scripts/host-deploy.sh', '--check-pm2']);
    if (r.status !== 0) add('denied', `PM2 guard failed: ${String(r.stdout || r.stderr || '').trim().split('\n').pop().slice(0, 200)}`);
}

function dirtyServerFiles() {
    let out = '';
    try { out = execFileSync('git', ['-C', ROOT, 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8', timeout: 10000 }); } catch (_) { return []; }
    return out.split('\n').filter(Boolean).map((l) => ({ status: l.slice(0, 2), path: l.slice(3).replace(/^.* -> /, '') }))
        .filter((f) => PATH_RE.test(f.path) && !f.status.includes('D'));
}

function validate(files) {
    for (const f of files) {
        const abs = path.join(ROOT, f.path);
        if (!fs.existsSync(abs)) continue;
        if (f.path.endsWith('.json')) {
            try { JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { add('denied', `${f.path} is not valid JSON: ${e.message.slice(0, 160)}`); }
        } else if (f.path.endsWith('.js')) {
            const r = run(process.execPath, ['--check', abs], { timeout: 20000 });
            if (r.status !== 0) add('denied', `${f.path} fails node --check: ${String(r.stderr || '').trim().split('\n').find((l) => /Error/.test(l)) || 'syntax error'}`.slice(0, 260));
        }
    }
}

// ---------------------------------------------------------------- wait: running work

/** A process outside the server's tree: its parent is not the server and it leads its own session (setsid / detached). */
function detachedFrom(pid, serverPid) {
    if (!Number.isInteger(Number(pid)) || !pid) return false;
    try {
        const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
        const ppid = Number(f[1]); const sid = Number(f[3]);
        return ppid !== Number(serverPid) && sid === Number(pid);
    } catch (_) { return false; }
}

function checkIdle() {
    const r = run(process.execPath, ['scripts/director-idle-check.js', '--json'], { timeout: 60000 });
    let o = null;
    try { o = JSON.parse(r.stdout); } catch (_) { o = null; }
    if (r.status === 2 || !o || o.decided === false) { add('denied', 'the Director idle check could not decide (server state unknown): look at scripts/director-idle-check.js output'); return; }
    if (r.status === 0) return;
    const ip = o.inProcess || {};
    (ip.director || []).forEach((d) => add('wait', `wait for the Director turn ${d.sessionId || d.id || ''} (${d.persona || 'Director'})`.trim()));
    // a Yozora (Xi) turn runs in its own session, outside Dreamscape's process tree (treekill off): a restart does not
    // cut it and the server reattaches by tailing its log, so it is a note, not a wait (Yukimi, Nov 26 2026: "is Xi
    // not separated like it should be, the same way you are"). Only a turn still inside the server's tree waits.
    const xiSeen = new Set();
    (ip.xi || []).concat(o.xi || []).forEach((x) => {
        const key = x.sessionId || x.chatId || x.id || x.pid;
        if (xiSeen.has(key)) return;
        xiSeen.add(key);
        if (detachedFrom(x.pid, o.serverPid)) add('note', `Yozora's turn ${x.sessionId || x.chatId || ''} runs detached: the restart does not cut it (it reattaches)`.trim());
        else add('wait', `wait for Yozora's turn ${x.sessionId || x.chatId || x.id || ''}`.trim());
    });
    (o.wren || []).forEach(() => add('wait', 'wait for a Wren (Yumiya / Chiyo) turn'));
    if (ip.generation && (ip.generation.processing || ip.generation.pending)) add('wait', `wait for image generation (${ip.generation.pending || 0} queued${ip.generation.running ? ', one running' : ''})`);
    (ip.localJobs || []).forEach((j) => add('wait', `wait for the local job ${j.kind || j.type || ''} ${j.id || ''}`.trim()));
    (ip.mcp || []).forEach((m) => add('wait', `wait for MCP call ${m.tool || ''} by ${m.key || m.actorName || 'a client'}`));
    (ip.smtp || []).forEach(() => add('wait', 'wait for an open mail (SMTP) session'));
    const http = (ip.http || []).filter((h) => h.path !== '/status/stream'); // clients waiting on a boot: not work
    if (http.length) add('wait', `wait for ${http.length} HTTP request${http.length === 1 ? '' : 's'} in flight (${http.slice(0, 3).map((h) => `${h.method} ${h.path}`).join(', ')})`);
    // the idle check's own reasons, less the detached Yozora turns handled above
    const rest = (o.reasons || []).filter((r) => !/^xi(-pid)?:/.test(String(r)) || ![...(ip.xi || []), ...(o.xi || [])].some((x) => String(r).includes(x.sessionId || x.chatId || String(x.pid)) && detachedFrom(x.pid, o.serverPid)));
    if (!findings.some((f) => f.level === 'wait') && rest.length) add('wait', `wait for: ${rest.join(', ')}`);
}

function coordStore() {
    try { return require('../modules/agentCoord/store'); } catch (_) { return null; }
}

function checkGates(store) {
    if (!store) return;
    let gates = [];
    try { gates = store.builds({ repo: 'staticforge' }).concat(store.builds({ repo: '' }).filter((g) => g.build.target === HOLD_TARGET)); } catch (_) { gates = []; }
    const seen = new Set();
    const self = selfSessionId();
    const mine = BY_AGENT || (self ? `claude-${self.slice(0, 8)}` : '');
    gates.forEach((g) => {
        const b = g.build;
        if (seen.has(b.id)) return;
        seen.add(b.id);
        const who = (store.getAgent(b.requestedBy) || {}).name || b.requestedBy;
        // the caller's own gate for this (opened and begun before the wrapper script, as agent-coord asks) never holds it
        if (b.state === 'running' && b.target === OWN_TARGET && mine && b.requestedBy === mine) return;
        if (RELOAD) {
            // a reload waits only for a restart under way, another reload, and a hold-reload; no other build or hold matters
            if (b.target === HOLD_TARGET && (b.state === 'open' || b.state === 'running')) add('wait', `wait for ${who}: ${HOLD_TARGET}${b.note ? ` (${b.note})` : ''}`, { agent: b.requestedBy });
            else if (b.state === 'running' && b.target === 'dreamscape-restart') add('wait', `wait for the restart (build ${b.id}) by ${who}`, { agent: b.requestedBy });
            else if (b.state === 'running' && b.target === 'module-reload') add('wait', `wait for the module reload (build ${b.id}) by ${who}`, { agent: b.requestedBy });
            return;
        }
        if (b.target === HOLD_TARGET && (b.state === 'open' || b.state === 'running')) add('wait', `wait for ${who}: ${HOLD_TARGET}${b.note ? ` (${b.note})` : ''}`, { agent: b.requestedBy });
        // the other kind's hold is not this one's business (a hold-restart does not stop a client update, nor the reverse)
        else if (b.target === 'hold-restart' || b.target === 'hold-client-update') return;
        else if (b.state === 'running') add('wait', `wait for build ${b.id} (${b.target}) by ${who}`, { agent: b.requestedBy });
    });
}

// ---------------------------------------------------------------- ask: live sessions with server edits

const commitMs = new Map();
function lastCommitMs(file) {
    if (commitMs.has(file)) return commitMs.get(file);
    let t = 0;
    try { t = Number(execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%ct', '--', file], { encoding: 'utf8', timeout: 5000 }).trim()) * 1000 || 0; } catch (_) { t = 0; }
    commitMs.set(file, t);
    return t;
}

/** The Claude session this script runs under (skipped: it is the one asking). */
function selfSessionId() {
    const dir = path.join(process.env.DREAMSCAPE_CLAUDE_HOME || require('os').homedir(), '.claude', 'sessions');
    let pid = process.ppid;
    for (let i = 0; i < 8 && pid > 1; i += 1) {
        try { const r = JSON.parse(fs.readFileSync(path.join(dir, `${pid}.json`), 'utf8')); if (r && r.sessionId) return r.sessionId; } catch (_) { /* up */ }
        try { pid = Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]) || 0; } catch (_) { break; }
    }
    return '';
}

/** Whether a claim path (a file, a folder, '.', or a glob with * / **) covers a repo-relative file. */
function claimCovers(claim, file) {
    const c = String(claim || '').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!c || c === '.') return true;
    if (/[*?]/.test(c)) {
        const re = new RegExp(`^${c.split('**').map((part) => part.split('*').map((x) => x.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('[^/]*')).join('.*')}$`);
        return re.test(file);
    }
    return file === c || file.startsWith(`${c}/`);
}

function checkAgents(store, dirty) {
    if (!store) return;
    const self = selfSessionId();
    let live = [];
    try { live = require('../modules/claudeSessions').liveSessions(); } catch (_) { live = []; }
    const dirtySet = new Set(dirty.map((f) => f.path));
    const owned = new Set();
    for (const s of live) {
        if (s.id === self) continue;
        const agentId = `claude-${s.id.slice(0, 8)}`;
        if (BY_AGENT && agentId === BY_AGENT) continue; // the asker (reload mode) is not asked about its own edits
        if (!store.getAgent(agentId)) store.upsertAgent({ id: agentId, kind: 'claude', name: s.givenName || s.name || s.id.slice(0, 8), sessionId: s.id, cwd: s.cwd, pid: s.pid });
        let r = null;
        try { r = store.inspect(agentId, { limit: 300 }); } catch (_) { r = null; }
        if (!r) continue;
        const { root } = store.repoOf(s.cwd);
        const inThisRepo = root && path.resolve(root) === path.resolve(ROOT);
        // its edit counts only when it came after that file's last commit (an older edit is in a commit already;
        // the file is dirty again from someone else)
        const serverEdits = inThisRepo ? r.edited.files.filter((f) => PATH_RE.test(f.path) && dirtySet.has(f.path) && (f.lastAt || 0) > lastCommitMs(f.path)) : [];
        // a claim holds the restart only while an uncommitted server file lies under it: a claim on files already committed
        // loads nothing half done (Nov 25 2026: the Manager Session's committed claims held a restart until it released them)
        const serverClaims = r.claims.filter((c) => (PATH_RE.test(c.path) || c.path === '.' || c.path === (CLIENT ? 'public' : 'modules') || (CLIENT && /^apps(\/[^/]+)?$/.test(c.path))) && dirty.some((f) => claimCovers(c.path, f.path)));
        serverEdits.forEach((f) => owned.add(f.path));
        if (serverEdits.length || serverClaims.length) {
            const name = r.agent.name || agentId;
            const what = serverEdits.length ? `uncommitted ${serverEdits.slice(0, 4).map((f) => f.path).join(', ')}${serverEdits.length > 4 ? ` (+${serverEdits.length - 4})` : ''}` : `claims on ${serverClaims.map((c) => c.path).slice(0, 4).join(', ')}`;
            // two sessions can carry the same derived name (two "staticforge-8e"): the link's end tells them apart
            const tail = s.link ? `, claude.ai …${s.link.slice(-10)}` : '';
            add('ask', `ask ${name} (${agentId}${tail}, ${s.status === 'busy' ? 'working now' : 'idle'}): ${what}`, { agent: agentId, busy: s.status === 'busy', files: serverEdits.length ? serverEdits.map((f) => f.path) : serverClaims.map((c) => c.path) });
        }
    }
    dirty.filter((f) => !owned.has(f.path)).slice(0, 8).forEach((f) => add('note', `uncommitted ${f.path} (no live session holds it: it ${CLIENT ? 'ships' : 'loads'} as it is)`));
}

// ---------------------------------------------------------------- ask: how long, and is it still a real wait

/**
 * Yukimi, Nov 24 2026: "the 'ask x' should have some max time before the supervisor is notified to verify
 * that it's actually a valid wait". An ask that has stood longer than agentSupervisor.maxAskMinutes
 * (default 15) is checked: its session idle and nothing new from it for 30 min -> a stale hold (a note,
 * no longer blocking); else a valid wait, said with how long it has been asked and when it was last active.
 * The first and last time each agent was asked live in the agent-coord DB (gate_asks).
 */
function maxAskMinutes() {
    try { const v = require('../config.json').agentSupervisor; return v && Number.isFinite(v.maxAskMinutes) ? v.maxAskMinutes : 15; } catch (_) { return 15; }
}
function verifyAsks(store) {
    if (!store) return;
    const d = store.open();
    d.exec(`CREATE TABLE IF NOT EXISTS ${ASKS_TABLE} (agent_id TEXT PRIMARY KEY, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, text TEXT NOT NULL DEFAULT '', stale INTEGER NOT NULL DEFAULT 0)`);
    // where a wait comes from (Fleet's wait lists show it): the restart / update it holds and the session that asked
    const cols = new Set(d.prepare(`PRAGMA table_info(${ASKS_TABLE})`).all().map((c) => c.name));
    if (!cols.has('why')) d.exec(`ALTER TABLE ${ASKS_TABLE} ADD COLUMN why TEXT NOT NULL DEFAULT ''`);
    if (!cols.has('asked_by')) d.exec(`ALTER TABLE ${ASKS_TABLE} ADD COLUMN asked_by TEXT NOT NULL DEFAULT ''`);
    if (!cols.has('files')) d.exec(`ALTER TABLE ${ASKS_TABLE} ADD COLUMN files TEXT NOT NULL DEFAULT ''`);
    const self = selfSessionId();
    const askedBy = RELOAD && valueOf('--by') ? valueOf('--by').slice(0, 120) : self ? `claude-${self.slice(0, 8)}` : (process.env.USER || '');
    const why = String(valueOf('--why') || '').slice(0, 300);
    const now = Date.now();
    const asked = findings.filter((f) => f.level === 'ask' && f.agent);
    const keep = new Set(asked.map((f) => f.agent));
    d.prepare(`SELECT agent_id FROM ${ASKS_TABLE}`).all().forEach((r) => { if (!keep.has(r.agent_id)) d.prepare(`DELETE FROM ${ASKS_TABLE} WHERE agent_id = ?`).run(r.agent_id); });
    let live = [];
    try { live = require('../modules/claudeSessions').liveSessions(); } catch (_) { live = []; }
    const limit = maxAskMinutes() * 60000;
    for (const f of asked) {
        d.prepare(`INSERT INTO ${ASKS_TABLE} (agent_id, first_at, last_at, text, why, asked_by, files) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET last_at = excluded.last_at, text = excluded.text, why = excluded.why, asked_by = excluded.asked_by, files = excluded.files`).run(f.agent, now, now, f.text, why, askedBy, (f.files || []).join(', ').slice(0, 1000));
        const row = d.prepare(`SELECT * FROM ${ASKS_TABLE} WHERE agent_id = ?`).get(f.agent);
        const askedMin = Math.round((now - row.first_at) / 60000);
        if (now - row.first_at < limit) continue;
        const a = store.getAgent(f.agent);
        const s = a && a.sessionId ? live.find((x) => x.id === a.sessionId) : null;
        let lastActive = s ? Number(s.updatedAt) || 0 : 0;
        try {
            const file = a && a.sessionId ? require('child_process').execFileSync('find', [path.join(require('os').homedir(), '.claude', 'projects'), '-maxdepth', '2', '-name', `${a.sessionId}.jsonl`], { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0] : '';
            if (file) lastActive = Math.max(lastActive, fs.statSync(file).mtimeMs);
        } catch (_) { /* unknown */ }
        const idleMin = lastActive ? Math.round((now - lastActive) / 60000) : null;
        if ((!s || s.status !== 'busy') && (idleMin === null || idleMin >= 30)) {
            f.level = 'note';
            f.text = `stale hold: ${f.text.replace(/^ask /, '')} - asked for ${askedMin} min, idle ${idleMin === null ? 'and gone' : `${idleMin} min`}: verified by the Supervisor, no longer blocking`;
            d.prepare(`UPDATE ${ASKS_TABLE} SET stale = 1 WHERE agent_id = ?`).run(f.agent);
        } else {
            f.text = `${f.text} - asked for ${askedMin} min; active ${idleMin === null ? 'now' : `${idleMin} min ago`}: a valid wait`;
        }
    }
}

// ---------------------------------------------------------------- verdict

function verdict() {
    const order = ['denied', 'wait', 'ask'];
    const worst = order.find((l) => findings.some((f) => f.level === l));
    if (!worst) return { verdict: 'approved', code: 0, line: 'approved' };
    const first = findings.find((f) => f.level === worst);
    if (worst === 'denied') return { verdict: 'denied', code: 30, line: `denied for ${first.text}` };
    if (worst === 'wait') return { verdict: 'wait', code: 20, line: first.text.startsWith('wait for') ? first.text : `wait for ${first.text}` };
    return { verdict: 'ask', code: 10, line: first.text.replace(/ \(.*$/, '') };
}

function notifyAsk(store) {
    if (!store || !has('--notify')) return 0;
    const why = valueOf('--why') || (CLIENT ? 'a client change' : RELOAD ? 'a module change' : 'a server change');
    let n = 0;
    try {
        const me = CLIENT
            ? store.upsertAgent({ id: 'client-update-gate', kind: 'other', name: 'Client update gate', task: 'Dreamscape client updates', pid: null })
            : RELOAD
                ? store.upsertAgent({ id: 'reload-gate', kind: 'other', name: 'Reload gate', task: 'Dreamscape module reloads', pid: null })
                : store.upsertAgent({ id: 'restart-gate', kind: 'other', name: 'Restart gate', task: 'Dreamscape restarts', pid: null });
        findings.filter((f) => f.level === 'ask' && f.agent).forEach((f) => {
            const mine = (f.files || []).filter((x) => RELOAD_FILES.includes(x));
            const named = (mine.length ? mine : reloadDirty).slice(0, 6).join(', ');
            const text = RELOAD
                ? `A Dreamscape module reload (not a server restart: no connection drops) is about to load your uncommitted edit of ${named} for ${why}. The running server would take it as it is now. Reply (coord_post to reload-gate, kind reply) "ok" when it is safe, or open a hold with coord_build_request target hold-reload until you are done - do not sit on it.`
                : CLIENT
                ? `A client update (service-worker notify) is about to go out for ${why}. Your uncommitted client edits / claims (public/, app packages) would ship to every device as they are now. Commit them (or say they are fine) and reply (coord_post to client-update-gate, kind reply) "ok", or open a hold with coord_build_request target hold-client-update until you are done - do not sit on it.`
                : `The Dreamscape server is about to restart for ${why}. Your uncommitted server edits / claims would load as they are now. Reply (coord_post to restart-gate, kind reply) "ok" when it is safe, or open a hold with coord_build_request target hold-restart until you are done.`;
            store.post(me.id, f.agent, text, { kind: 'question' });
            n += 1;
        });
    } catch (_) { /* inbox unavailable */ }
    return n;
}

function main() {
    if (RELOAD && CLIENT) { process.stderr.write('--reload and --client do not combine\n'); process.exit(2); }
    if (RELOAD && !RELOAD_FILES.length) { process.stderr.write('usage: node scripts/restart-gate.js --reload <file,file,...> [--why "<reason>"] [--json] [--notify]\n'); process.exit(2); }
    if (!CLIENT && !RELOAD) checkPm2();
    // reload mode looks at exactly the listed files (validated committed or not); everything else dirty in the tree is not its business
    const dirty = RELOAD ? dirtyServerFiles().filter((f) => RELOAD_FILES.includes(f.path)) : dirtyServerFiles();
    reloadDirty = RELOAD ? dirty.map((f) => f.path) : [];
    validate(RELOAD ? RELOAD_FILES.map((p) => ({ path: p })) : dirty);
    if (!CLIENT && !RELOAD) checkIdle();
    const store = coordStore();
    checkGates(store);
    checkAgents(store, dirty);
    try { verifyAsks(store); } catch (e) { add('note', `ask times not checked: ${e.message}`); }
    const v = verdict();
    const notified = notifyAsk(store);
    if (has('--json')) {
        process.stdout.write(`${JSON.stringify({ verdict: v.verdict, line: v.line, code: v.code, findings, notified }, null, 1)}\n`);
    } else {
        process.stdout.write(`${v.line}\n`);
        findings.forEach((f) => process.stdout.write(`  ${f.level}: ${f.text}\n`));
        if (notified) process.stdout.write(`  (asked ${notified} agent${notified === 1 ? '' : 's'} in their agent-coord inbox)\n`);
    }
    try { if (store) store.close(); } catch (_) { /* closed */ }
    process.exit(v.code);
}

if (require.main === module) main();

module.exports = { SERVER_PATH_RE, CLIENT_PATH_RE, selfSessionId, reloadFileList, claimCovers, _verdict: verdict, _findings: findings };
