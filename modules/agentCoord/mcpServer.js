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
 * Store: modules/agentCoord/store.js (one SQLite file for the host). No network.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const store = require('./store');

const SERVER_INFO = { name: 'agent-coord', version: '1.0.0' };
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CARRY_SOCKET = process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET || 'dreamscape-claude-carry';

const INSTRUCTIONS = [
    'agent-coord: other agents (Claude sessions on either account, Cursor) may be editing the same repos right now.',
    'Before editing files, coord_claim them (paths relative to the repo, folders and globs allowed); if a claim conflicts, do not edit those files: coord_post the holder or pick other work.',
    'Keep coord_set_task current. Release claims (coord_release) when you are done with them; they also lapse with their lease and when your process ends.',
    'When an answer says you have unread messages, call coord_inbox. Steering from Menma or Yukimi arrives as kind steer.'
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
    for (let i = 0; i < 4; i += 1) { p = parentOf(p); if (p > 1) chain.add(p); }
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
    { name: 'coord_inbox', description: 'Your unread messages (to you or to all), oldest first. Reading marks them read unless peek.', inputSchema: S({ peek: { type: 'boolean' } }) }
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
        return { you: ego.id, agents: store.listAgents({ all: a.all === true }).map((x) => Object.assign({}, x, { seenAt: fmtTime(x.seenAt), startedAt: fmtTime(x.startedAt) })) };
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
    default:
        throw new Error(`Unknown tool ${name}`);
    }
}

// ---------------------------------------------------------------- JSON-RPC over stdio

function write(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`); }

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
            let unread = 0;
            try { unread = me ? store.unreadCount(me.id) : 0; } catch (_) { unread = 0; }
            const textOut = JSON.stringify(out, null, 1) + (unread && name !== 'coord_inbox' ? `\n\nYou have ${unread} unread message${unread === 1 ? '' : 's'}: call coord_inbox.` : '');
            reply({ content: [{ type: 'text', text: textOut }], isError });
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
