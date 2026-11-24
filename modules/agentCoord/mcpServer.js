#!/usr/bin/env node
'use strict';

/**
 * agent-coord: an MCP server (stdio) so agents working at the same time see each other, claim the files
 * they edit, and pass notes and steering. Claude Accounts (desktop) registers it for every session it
 * launches (--mcp-config); any MCP client can run it:
 *
 *   { "mcpServers": { "agent-coord": { "command": "node",
 *       "args": ["/home/kanmi/staticforge/modules/agentCoord/mcpServer.js"],
 *       "env": { "AGENT_COORD_KIND": "cursor", "AGENT_COORD_NAME": "Cursor - my task" } } } }
 *
 * Who am I: a Claude Code session is found from the process tree (~/.claude/sessions/<pid>.json of the
 * claude that started this server: session id, folder, tmux pane, name); otherwise AGENT_COORD_ID /
 * AGENT_COORD_NAME / AGENT_COORD_KIND, or coord_hello. The id of a Claude session is claude-<first 8 of
 * its session id>.
 *
 * Every answer ends with the caller's unread count, so a waiting message is seen on the next call.
 * A 'steer' message to a Claude session that runs in tmux is also typed into its pane (Claude Code takes
 * typed input while it works as steering for its current turn), unless deliver is false.
 *
 * v2 (#1154): registered at user scope in every account's config dir and the host's, so every Claude
 * session on the host has it. coord_claim plants the agent-busy-lock .agent-<id> file in the repo root
 * (and releasing everything there removes it); coord_locks lists every .agent-* lock, coord-made or not.
 * coord_inspect shows what another agent is doing (files it edited, by tool or by shell, its recent
 * commands, its last words, its claims, the tree's uncommitted files); coord_editors says who edited a
 * path. Builds go through a gate: coord_build_request asks every live agent in the repo, each answers
 * coord_build_ready, coord_build_begin starts only when nobody is pending, coord_build_end tells everyone.
 * The account a session runs on comes from its CLAUDE_CONFIG_DIR (<account dir>/fleet.json's name).
 *
 * Store: modules/agentCoord/store.js (one SQLite file for the host). No network.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('./store');

const SERVER_INFO = { name: 'agent-coord', version: '2.0.0' };
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CARRY_SOCKET = process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET || 'dreamscape-claude-carry';

const INSTRUCTIONS = [
    'agent-coord: other agents (Claude sessions on every Claude account, Yozora, Cursor) may be working in the same repos right now. Full cooperation is the rule.',
    'Before editing files, coord_claim them (paths relative to the repo, folders and globs allowed); the claim also plants your .agent-<id> busy lock. If a claim conflicts, do not edit those files: coord_inspect or coord_post the holder, or pick other work.',
    'Before touching a file you did not claim, coord_check it (claims) and coord_editors it (who changed it lately).',
    'Before ANY build, install, deploy, service-worker notify or server restart: coord_build_request a gate for it, wait until coord_build_status says canBegin (everyone ready), then coord_build_begin, and coord_build_end when it is over. Never build past a pending or not-ready agent without force and a reason.',
    'When a build gate asks you (a question naming coord_build_ready), answer it as soon as your files are in a state that builds, or say why not.',
    'Keep coord_set_task current. Release claims (coord_release) when you are done; they also lapse with their lease and when your process ends.',
    'When an answer says you have unread messages, call coord_inbox. Steering from Yozora, Menma or Yukimi arrives as kind steer.'
].join(' ');

// ---------------------------------------------------------------- who am I

function claudeHome() { return process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(); }

function parentOf(pid) {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return Number(after[1]) || 0;
    } catch (_) { return 0; }
}

/** The ~/.claude/sessions record of the claude process that started this server (up to 5 levels up). */
function claudeRecord() {
    const dir = path.join(claudeHome(), '.claude', 'sessions');
    let pid = process.ppid;
    for (let i = 0; i < 5 && pid > 1; i += 1) {
        try {
            const r = JSON.parse(fs.readFileSync(path.join(dir, `${pid}.json`), 'utf8'));
            if (r && SESSION_ID_RE.test(String(r.sessionId || ''))) return r;
        } catch (_) { /* not this one */ }
        pid = parentOf(pid);
    }
    return null;
}

function gitBranch(dir) {
    try { return execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return ''; }
}

/** The account a session runs on: its config dir's fleet.json (an account moved to its own folder), else host. */
function accountFromConfigDir() {
    const dir = process.env.CLAUDE_CONFIG_DIR;
    if (!dir) return 'host';
    try {
        const f = JSON.parse(fs.readFileSync(path.join(path.dirname(dir), 'fleet.json'), 'utf8'));
        if (f && f.name) return String(f.name);
    } catch (_) { /* not one of ours */ }
    return path.basename(path.dirname(dir));
}

let me = null; // { id, root }
let lastRecordCheck = 0;

/** Registers (or refreshes) this agent; cheap after the first call. */
function self(force) {
    const t = Date.now();
    if (me && !force && t - lastRecordCheck < 30000) {
        store.upsertAgent({ id: me.id });
        return me;
    }
    lastRecordCheck = t;
    const rec = claudeRecord();
    const envId = process.env.AGENT_COORD_ID;
    const kind = process.env.AGENT_COORD_KIND || (rec ? 'claude' : 'other');
    const cwd = (rec && rec.cwd) || process.env.AGENT_COORD_CWD || process.cwd();
    const { repo, root } = store.repoOf(cwd);
    const id = envId || (rec ? `claude-${rec.sessionId.slice(0, 8)}` : (me && me.id) || `${kind}-${os.hostname()}-${process.ppid}`);
    const a = {
        id,
        kind,
        cwd,
        repo,
        branch: gitBranch(cwd),
        pid: rec ? rec.pid : process.ppid,
        tmux: rec && rec.tmux ? String(rec.tmux) : '',
        sessionId: rec ? rec.sessionId : undefined
    };
    if (process.env.AGENT_COORD_ACCOUNT) a.account = process.env.AGENT_COORD_ACCOUNT;
    else {
        const acc = accountFromConfigDir();
        if (acc) a.account = acc;
    }
    if (process.env.CLAUDE_CONFIG_DIR) a.configDir = process.env.CLAUDE_CONFIG_DIR;
    const known = store.getAgent(id);
    const name = process.env.AGENT_COORD_NAME || (rec && rec.name && rec.nameSource !== 'derived' ? rec.name : '');
    if (name || !known || !known.name) a.name = name || (rec && rec.name) || id;
    store.upsertAgent(a);
    me = { id, root };
    return me;
}

// ---------------------------------------------------------------- steering into a tmux pane

function tmuxPanes(socketArgs) {
    try {
        return execFileSync('tmux', [...socketArgs, 'list-panes', '-a', '-F', '#{pane_id} #{pane_pid}'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
            .trim().split('\n').filter(Boolean).map((l) => { const [pane, pid] = l.split(' '); return { pane, pid: Number(pid) }; });
    } catch (_) { return []; }
}

/** The tmux pane (socket + pane id) whose shell is the agent's claude process or its parent. */
function paneOf(pid) {
    if (!pid) return null;
    const chain = new Set([pid]);
    let p = pid;
    for (let i = 0; i < 4; i += 1) {
        p = parentOf(p);
        if (p <= 1) break;
        // above it sits Remote Control's server: its pane is the server's terminal, never typed into (#1154)
        let cmd = '';
        try { cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch (_) { cmd = ''; }
        if (/\bremote-control\b/.test(cmd) && !/--remote-control\b/.test(cmd)) break; // its pane is the server's: the climb stops
        chain.add(p);
    }
    for (const sock of [[], ['-L', CARRY_SOCKET]]) {
        const hit = tmuxPanes(sock).find((x) => chain.has(x.pid));
        if (hit) return { sock, pane: hit.pane };
    }
    return null;
}

/** Types a steering message into a live Claude session's terminal. */
function typeInto(agent, from, body) {
    if (!agent || agent.kind !== 'claude' || !agent.pid || agent.status === 'gone') return '';
    const where = paneOf(agent.pid);
    if (!where) return '';
    const line = `[steering from ${from}] ${body}`.replace(/[\r\n]+/g, ' ').slice(0, 4000);
    try {
        execFileSync('tmux', [...where.sock, 'send-keys', '-t', where.pane, '-l', line], { timeout: 3000, stdio: 'ignore' });
        execFileSync('tmux', [...where.sock, 'send-keys', '-t', where.pane, 'Enter'], { timeout: 3000, stdio: 'ignore' });
        return 'tmux';
    } catch (_) { return ''; }
}

// ---------------------------------------------------------------- tools

const S = (props, required) => ({ type: 'object', properties: props, required: required || [], additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const strs = (description) => ({ type: 'array', items: { type: 'string' }, description });

const TOOLS = [
    { name: 'coord_hello', description: 'Register or update yourself: a name others see and what you are working on. Optional: you are registered on your first call anyway.', inputSchema: S({ name: str('Short name others see'), task: str('What you are working on, one line'), account: str('The Claude account you run on, if known') }) },
    { name: 'coord_agents', description: 'The agents working now: id, kind, name, account, task, folder, branch, claims held, last seen.', inputSchema: S({ all: { type: 'boolean', description: 'Also list agents that are gone' } }) },
    { name: 'coord_set_task', description: 'Set your current task line (and status: active, idle, blocked, done). done releases your claims.', inputSchema: S({ task: str('One line'), status: str('active | idle | blocked | done') }) },
    { name: 'coord_claim', description: 'Claim files or folders (relative to the repo; globs like public/css/*.css allowed) before editing them. Conflicting paths are not granted: the answer names who holds them. Claiming again renews the lease.', inputSchema: S({ paths: strs('Paths to claim'), mode: str('exclusive (default) or shared'), lease_minutes: { type: 'number', description: 'Lease length (default 45, max 480)' }, note: str('Why, one line'), repo: str('Repo name when not working inside it') }, ['paths']) },
    { name: 'coord_release', description: 'Release claims: the paths given, or all of yours when none are given.', inputSchema: S({ paths: strs('Paths to release (omit for all)'), repo: str('Repo name') }) },
    { name: 'coord_check', description: 'Who holds claims overlapping these paths (before you edit something you did not claim).', inputSchema: S({ paths: strs('Paths to check'), repo: str('Repo name') }, ['paths']) },
    { name: 'coord_claims', description: 'Every claim in force (optionally for one repo).', inputSchema: S({ repo: str('Repo name') }) },
    { name: 'coord_post', description: 'Send a message to one agent (its id from coord_agents, or its name) or to all. kind: note (default), question, reply, steer (asks the recipient to change course; a Claude session in tmux also gets it typed into its terminal), done.', inputSchema: S({ to: str('Agent id / name, or "all"'), body: str('The message'), kind: str('note | question | reply | steer | done'), deliver: { type: 'boolean', description: 'For steer: also type it into the recipient\'s terminal (default true)' } }, ['to', 'body']) },
    { name: 'coord_inbox', description: 'Your unread messages (to you or to all), oldest first. Reading marks them read unless peek.', inputSchema: S({ peek: { type: 'boolean' } }) },
    { name: 'coord_inspect', description: 'What another agent is doing: busy / idle, task, model, account, claims, the files it edited (by edit tool, or by shell while still uncommitted), its recent shell commands, its last message, and the uncommitted files in its folder.', inputSchema: S({ agent: str('Agent id, name or session id (coord_agents)'), limit: { type: 'number', description: 'Files to list (default 100)' }, git: { type: 'boolean', description: 'Include git status of its folder (default true)' } }, ['agent']) },
    { name: 'coord_editors', description: 'Which agents edited these paths (repo-relative), from their transcripts. Use before changing a file you did not claim.', inputSchema: S({ paths: strs('Paths'), all: { type: 'boolean', description: 'Also agents that are gone' } }, ['paths']) },
    { name: 'coord_locks', description: 'Every .agent-* busy lock in the repo root: made by agent-coord (with the agent\'s state) or by an agent outside it (with its age; stale = older than 3 h: report it, never delete someone else\'s).', inputSchema: S({ repo_root: str('Absolute repo root (default: yours)') }) },
    { name: 'coord_build_request', description: 'Open a build gate before any build, install, deploy, SW notify or restart: every live agent in the repo is asked whether its work is ready to build (agents that are idle and hold no claim there count as ready). Joins an open gate for the same target. Answers the gate and who it waits on.', inputSchema: S({ target: str('What gets built, e.g. dsapp-apk, sw-notify, dreamscape-restart'), note: str('Why / what it ships'), repo: str('Repo name (default: yours)'), wait_minutes: { type: 'number', description: 'How long the gate stays open (default 120)' }, deliver: { type: 'boolean', description: 'Also type the question into busy agents\' terminals (default true)' } }, ['target']) },
    { name: 'coord_build_ready', description: 'Answer a build gate: ready true when your files there are in a state that builds (nothing half-edited), false with why.', inputSchema: S({ build: { type: 'number', description: 'Gate id' }, ready: { type: 'boolean' }, note: str('Why not / what to wait for') }, ['build', 'ready']) },
    { name: 'coord_build_status', description: 'A build gate: participants (ready, not-ready, auto, pending), who it waits on, whether another build of the target runs, canBegin.', inputSchema: S({ build: { type: 'number' } }, ['build']) },
    { name: 'coord_build_begin', description: 'Start your gated build: refused while anyone is pending or not ready or another build of the target runs (the answer says who). force with a reason starts anyway and tells everyone.', inputSchema: S({ build: { type: 'number' }, force: { type: 'boolean' }, reason: str('Required with force') }, ['build']) },
    { name: 'coord_build_end', description: 'End your build (or cancel a gate you opened); everyone is told the result.', inputSchema: S({ build: { type: 'number' }, result: str('One line: ok / failed and why') }, ['build']) },
    { name: 'coord_supervisor_check', description: 'Ask the Supervisor (a separate model) to check your current turn: does what you did cover everything in the request and every steering message? Answers verdict ok / gaps / unclear and the missed items. Call it before you say you are done with a multi-part request.', inputSchema: S({}) },
    { name: 'coord_request_work', description: 'Hand a piece of work to the Supervisor: it becomes a work item that starts as its own supervised Fleet session (startNow: as soon as there is a slot and an account with room; else it waits in the queue for Yukimi or the Supervisor). Give a complete brief: goal, files, acceptance check. Use it for work outside your task, or work that should run beside yours.', inputSchema: S({ title: str('Short title'), prompt: str('The whole brief'), start_now: { type: 'boolean', description: 'Start it now when there is room (default false: queued)' }, cwd: str('Absolute folder (default the Dreamscape repo)'), model: str('Model (default sonnet)'), effort: str('low | medium | high | xhigh | max') }, ['title', 'prompt']) },
    { name: 'coord_pause_agent', description: 'Ask the Supervisor to PAUSE another agent (hold: its turn is stopped and it waits for RESUME) while you need momentary control: a collision on the same files, a merge, a migration it would damage. Say why. coord_resume_agent when you are done. (Freezing a process is Fleet-only.)', inputSchema: S({ agent: str('Agent id / name / session id (coord_agents)'), reason: str('Why, one line') }, ['agent', 'reason']) },
    { name: 'coord_resume_agent', description: 'Let an agent you paused continue.', inputSchema: S({ agent: str('Agent id / name / session id') }, ['agent']) },
    { name: 'coord_builds', description: 'Open and running build gates (recent: also the ones that ended in the last day).', inputSchema: S({ repo: str('Repo name'), recent: { type: 'boolean' } }) }
];

function fmtTime(ms) { return ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : ''; }

function run(name, args) {
    const a = args || {};
    const ego = self(name === 'coord_hello');
    const repoArg = a.repo ? String(a.repo) : '';
    const repo = repoArg || (store.getAgent(ego.id) || {}).repo || '';
    const root = repoArg ? '' : ego.root;
    switch (name) {
    case 'coord_hello': {
        const u = { id: ego.id };
        if (a.name) u.name = a.name;
        if (a.task) u.task = a.task;
        if (a.account) u.account = a.account;
        return { you: store.upsertAgent(u), others: store.listAgents().filter((x) => x.id !== ego.id) };
    }
    case 'coord_agents':
        return {
            you: ego.id,
            agents: store.listAgents({ all: a.all === true }).map((x) => {
                const rec = x.status !== 'gone' ? store.liveRecord(x) : null;
                return Object.assign({}, x, { live: rec ? rec.status || '' : '', seenAt: fmtTime(x.seenAt), startedAt: fmtTime(x.startedAt) });
            }),
            builds: store.builds().map((b) => ({ id: b.build.id, target: b.build.target, repo: b.build.repo, state: b.build.state, by: b.build.requestedBy, waitingOn: (b.waitingOn || []).map((w) => w.name || w.agentId) }))
        };
    case 'coord_set_task':
        return { you: store.setStatus(ego.id, a.status || 'active', a.task) };
    case 'coord_claim':
        return store.claim(ego.id, repo, a.paths, { mode: a.mode, leaseMinutes: a.lease_minutes, note: a.note, root });
    case 'coord_release':
        return store.release(ego.id, repo || null, a.paths, { root });
    case 'coord_check':
        return { repo, paths: store.check(repo, a.paths, { root }) };
    case 'coord_claims':
        return { claims: store.liveClaims(repo ? { repo } : {}).map((c) => Object.assign({}, c, { expiresAt: fmtTime(c.expiresAt) })) };
    case 'coord_post': {
        const msg = store.post(ego.id, a.to, a.body, { kind: a.kind });
        if (msg.kind === 'steer' && msg.to !== 'all' && a.deliver !== false) {
            const how = typeInto(store.getAgent(msg.to), (store.getAgent(ego.id) || {}).name || ego.id, msg.body);
            if (how) { store.markDelivered(msg.id, how); msg.delivered = how; }
        }
        return { sent: msg };
    }
    case 'coord_inbox':
        return { messages: store.inbox(ego.id, { peek: a.peek === true }).map((m) => Object.assign({}, m, { createdAt: fmtTime(m.createdAt) })) };
    case 'coord_inspect': {
        const r = store.inspect(a.agent, { limit: a.limit, git: a.git !== false });
        r.edited.files = r.edited.files.map((f) => Object.assign({}, f, { lastAt: fmtTime(f.lastAt) }));
        r.commands = r.commands.map((c) => Object.assign({}, c, { at: fmtTime(c.at) }));
        if (r.lastMessage) r.lastMessage.at = fmtTime(r.lastMessage.at);
        return r;
    }
    case 'coord_editors':
        return { paths: store.editorsOf(a.paths, { all: a.all === true }).map((p) => Object.assign({}, p, { editedBy: p.editedBy.map((e) => Object.assign({}, e, { lastAt: fmtTime(e.lastAt) })) })) };
    case 'coord_locks':
        return { root: a.repo_root || ego.root, locks: store.lockFiles(a.repo_root || ego.root) };
    case 'coord_build_request': {
        const from = (store.getAgent(ego.id) || {}).name || ego.id;
        const notify = a.deliver === false ? null : (agent, msg) => {
            if (!agent || !store.isBusy(agent)) return '';
            const how = typeInto(agent, from, `${msg.body} (agent-coord build gate)`);
            if (how) store.markDelivered(msg.id, how);
            return how;
        };
        return store.buildRequest(ego.id, { target: a.target, note: a.note, repo: repoArg || repo, waitMinutes: a.wait_minutes, notify });
    }
    case 'coord_build_ready':
        return store.buildReady(ego.id, a.build, a.ready === true, a.note);
    case 'coord_build_status':
        return store.gateState(store.open().prepare('SELECT * FROM builds WHERE id = ?').get(Number(a.build)) || (() => { throw new Error(`No build gate ${a.build}`); })());
    case 'coord_build_begin':
        return store.buildBegin(ego.id, a.build, { force: a.force === true, reason: a.reason });
    case 'coord_build_end':
        return store.buildEnd(ego.id, a.build, a.result);
    case 'coord_supervisor_check':
        return supervisorCheck();
    case 'coord_pause_agent':
    case 'coord_resume_agent': {
        const target = store.resolveAgent(a.agent);
        if (!target || !target.sessionId) throw new Error(`No Claude session for ${a.agent} (coord_agents lists them)`);
        const by = (store.getAgent(ego.id) || {}).name || ego.id;
        return supervisorAsk({ op: name === 'coord_pause_agent' ? 'pause' : 'resume', sessionId: target.sessionId, reason: a.reason, by }, 30000).then((out) => out.result);
    }
    case 'coord_request_work':
        return supervisorAsk({ op: 'enqueue', title: a.title, prompt: a.prompt, startNow: a.start_now === true, cwd: a.cwd, model: a.model, effort: a.effort }, 20000).then((out) => ({ work: out.work }));
    case 'coord_builds':
        return { builds: store.builds({ repo: a.repo, recent: a.recent === true }) };
    default:
        throw new Error(`Unknown tool ${name}`);
    }
}

// ---------------------------------------------------------------- Supervisor (modules/agentSupervisor.js, in the Dreamscape server)

/** Asks the Supervisor over its unix socket to review this session's current turn (up to ~2 min). */
function supervisorCheck() {
    const rec = claudeRecord();
    if (!rec) return Promise.reject(new Error('The Supervisor checks Claude Code sessions: this one has no session record'));
    return supervisorAsk({ op: 'check', sessionId: rec.sessionId }, 120000).then((out) => {
        const r = out.review || {};
        return { verdict: r.verdict, summary: r.summary, missed: r.missed || [], model: r.model, request: (r.request || '').slice(0, 300), steering: r.steering || [] };
    });
}

/** One request to the Supervisor's socket: { ok, ... } or a rejection with its error. */
function supervisorAsk(req, timeoutMs) {
    const net = require('net');
    const file = process.env.AGENT_SUPERVISOR_SOCKET || path.join(path.dirname(store.dbPath()), 'supervisor.sock');
    return new Promise((resolve, reject) => {
        let buf = '';
        const sock = net.createConnection(file, () => sock.write(`${JSON.stringify(req)}\n`));
        sock.setEncoding('utf8');
        sock.setTimeout(timeoutMs, () => { sock.destroy(); reject(new Error('The Supervisor did not answer in time')); });
        sock.on('data', (c) => { buf += c; });
        sock.on('end', () => {
            let out = null;
            try { out = JSON.parse(buf.trim()); } catch (e) { return reject(new Error('The Supervisor answered something unreadable')); }
            if (!out.ok) return reject(new Error(out.error || 'The Supervisor failed'));
            return resolve(out);
        });
        sock.on('error', (e) => reject(new Error(e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? 'The Supervisor is not running (it runs inside the Dreamscape server)' : e.message)));
    });
}

// ---------------------------------------------------------------- JSON-RPC over stdio

function write(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`); }

/** A tools/call answer (sync or after a promise), with the caller's unread count. */
function finishCall(id, name, out, isError) {
    if (id === undefined || id === null) return;
    let unread = 0;
    try { unread = me ? store.unreadCount(me.id) : 0; } catch (_) { unread = 0; }
    const textOut = JSON.stringify(out, null, 1) + (unread && name !== 'coord_inbox' ? `\n\nYou have ${unread} unread message${unread === 1 ? '' : 's'}: call coord_inbox.` : '');
    write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: textOut }], isError } });
}

function handle(msg) {
    const { id, method, params } = msg || {};
    const reply = (result) => { if (id !== undefined && id !== null) write({ jsonrpc: '2.0', id, result }); };
    const fail = (code, message) => { if (id !== undefined && id !== null) write({ jsonrpc: '2.0', id, error: { code, message } }); };
    try {
        if (method === 'initialize') {
            const v = params && params.protocolVersion ? String(params.protocolVersion) : '2025-06-18';
            reply({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
            try { self(true); } catch (e) { process.stderr.write(`agent-coord: register failed: ${e.message}\n`); }
            return;
        }
        if (method === 'ping') { reply({}); return; }
        if (method === 'tools/list') { reply({ tools: TOOLS }); return; }
        if (method === 'tools/call') {
            const name = params && params.name;
            let out;
            let isError = false;
            try { out = run(name, params && params.arguments); } catch (e) { out = { error: e.message }; isError = true; }
            if (out && typeof out.then === 'function') {
                out.then((v) => finishCall(id, name, v, false), (e) => finishCall(id, name, { error: e.message }, true));
                return;
            }
            finishCall(id, name, out, isError);
            return;
        }
        if (typeof method === 'string' && method.startsWith('notifications/')) return;
        if (method === 'resources/list') { reply({ resources: [] }); return; }
        if (method === 'prompts/list') { reply({ prompts: [] }); return; }
        fail(-32601, `Method not found: ${method}`);
    } catch (e) {
        fail(-32603, e.message);
    }
}

function main() {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            let msg;
            try { msg = JSON.parse(line); } catch (_) { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
            if (Array.isArray(msg)) msg.forEach(handle); else handle(msg);
        }
    });
    process.stdin.on('end', () => {
        // the client went away: this agent's claims lapse when its claude process is gone (store checks the pid)
        try { store.close(); } catch (_) { /* closed */ }
        process.exit(0);
    });
    try { store.prune(); } catch (_) { /* later */ }
}

if (require.main === module) main();

module.exports = { handle, run, TOOLS, _self: self, _paneOf: paneOf };
