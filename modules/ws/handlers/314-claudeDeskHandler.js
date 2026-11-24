'use strict';

/**
 * Claude Accounts on the desktop (apps/claudedesk): sessions, transcripts, steering and the agents'
 * coordination. Account and host management use 313-claudeAccountsHandler's packets unchanged
 * (get_claude_accounts, switch_claude_account, link / unlink_claude_account_login, claude_remote_control,
 * claude_account_login); the session list is claudeSessions.listAll (the phone's Sessions tab), with the
 * account each session runs on added here. Admin only. docs/client-api/ws/account.md#claude-accounts-desktop
 *
 *   claude_desk_sessions  { offset, limit }            claudeSessions.listAll + account per session
 *   claude_desk_transcript { id, before?, limit? }     a page of the chat (claudeTranscript.readPage)
 *   claude_desk_watch     { id } / claude_desk_unwatch the open transcript's new messages are pushed to this
 *                                                      socket as claude_desk_transcript_append { id, messages, end }
 *   claude_desk_session   { action: start | resume | steer | interrupt | screen | disconnect, ... }
 *   claude_desk_coord     { action: list | post | release, ... }
 *
 * Status (rule server-push-not-polling): two statusHub feeds the window subscribes to while it is open:
 *   claude_desk        (30 s, and at once when ~/.claude/sessions changes or an action ran) host status,
 *                      the running sessions, the agents and claims; pushed as claude_desk_status
 *   claude_desk_flux   (2 s, memory only: no IO) Remote Control's reconnect state and the Add Account
 *                      sign-in's state, while the window shows them; pushed as claude_desk_flux
 * Both reach only the subscribed socket (no broadcast).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const wsPacketRegistry = require('../wsPacketRegistry');
const statusHub = require('../statusHub');
const claudeHost = require('../../claudeAccountHost');
const claudeLogin = require('../../claudeAccountLogin');
const claudeSessions = require('../../claudeSessions');
const launcher = require('../../claudeSessionLauncher');
const transcript = require('../../claudeTranscript');
const runtime = require('../../claudeAccountRuntime');
const coord = require('../../agentCoord/store');

const ADMIN_DESTRUCTIVE = { destructive: true };
const APPEND_TYPE = 'claude_desk_transcript_append';

const isAdmin = (clientInfo) => !!(clientInfo && clientInfo.userType === 'admin');
let gResources = null;

function reply(handlersCtx, ws, message, type, data) {
    handlersCtx.sendToClient(ws, { type, requestId: message.requestId, data: Object.assign({ success: true }, data), timestamp: new Date().toISOString() });
}

function guard(type, fn) {
    return async (handlersCtx, ws, message, clientInfo) => {
        if (!isAdmin(clientInfo)) {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            const data = await fn(handlersCtx.globalResources, message || {}, ws, clientInfo, handlersCtx);
            reply(handlersCtx, ws, message, `${type}_response`, data);
        } catch (error) {
            console.warn(`[claudeDesk] ${type}: ${error.message}`);
            handlersCtx.sendError(ws, error.message, 'CLAUDE_DESK_FAILED', message.requestId);
        }
    };
}

// ---------------------------------------------------------------- which account a session is on

const projectsDir = () => path.join(process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(), '.claude', 'projects');
const ownerCache = new Map(); // file -> { size, uuid }

/** The claude.ai account uuid a transcript was last written under (its newest session-owner line). */
async function ownerOf(file, sizeBytes) {
    const c = ownerCache.get(file);
    if (c && c.size === sizeBytes) return c.uuid;
    let uuid = '';
    try {
        const fh = await fs.promises.open(file, 'r');
        try {
            const len = Math.min(sizeBytes, 128 * 1024);
            const buf = Buffer.alloc(len);
            await fh.read(buf, 0, len, sizeBytes - len);
            const all = buf.toString('utf8').match(/"type":"session-owner","accountUuid":"([0-9a-f-]{36})"/g);
            if (all && all.length) uuid = /"accountUuid":"([0-9a-f-]{36})"/.exec(all[all.length - 1])[1];
        } finally { await fh.close(); }
    } catch (_) { uuid = ''; }
    ownerCache.set(file, { size: sizeBytes, uuid });
    if (ownerCache.size > 2000) ownerCache.delete(ownerCache.keys().next().value);
    return uuid;
}

async function fileOf(row) {
    const dirs = await fs.promises.readdir(projectsDir()).catch(() => []);
    for (const d of dirs) {
        const f = path.join(projectsDir(), d, `${row.id}.jsonl`);
        try { await fs.promises.access(f); return f; } catch (_) { /* next */ }
    }
    return null;
}

async function sessionsPage(gr, message) {
    const page = await claudeSessions.listAll({ offset: message.offset, limit: message.limit });
    const accounts = claudeHost.listAccounts(gr);
    const byUuid = new Map(accounts.filter((a) => a.remoteLogin && a.remoteLogin.accountUuid).map((a) => [a.remoteLogin.accountUuid, a]));
    const agents = new Map();
    try { coord.listAgents({ all: true }).forEach((a) => { if (a.sessionId) agents.set(a.sessionId, a); }); } catch (_) { /* no store yet */ }
    for (const row of page.sessions) {
        const file = await fileOf(row);
        const uuid = file ? await ownerOf(file, row.sizeBytes) : '';
        const acc = byUuid.get(uuid);
        const ag = agents.get(row.id);
        row.account = acc ? { index: acc.index, name: acc.name } : (ag && ag.account && ag.account !== 'host' ? { index: null, name: ag.account } : null);
        row.agentId = ag ? ag.id : '';
        row.task = ag ? ag.task : '';
    }
    return page;
}

// ---------------------------------------------------------------- feeds

let sessionsWatcher = null;
let pokeTimer = null;

function armSessionsWatch(feed) {
    if (sessionsWatcher) return;
    const dir = path.join(process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(), '.claude', 'sessions');
    try {
        sessionsWatcher = fs.watch(dir, { persistent: false }, () => {
            if (!feed.size) { try { sessionsWatcher.close(); } catch (_) { /* closed */ } sessionsWatcher = null; return; }
            clearTimeout(pokeTimer);
            pokeTimer = setTimeout(() => feed.poke(), 1200);
        });
        sessionsWatcher.on('error', () => { sessionsWatcher = null; });
    } catch (_) { sessionsWatcher = null; }
}

function liveSummary() {
    return claudeSessions.liveSessions().map((s) => ({
        id: s.id, pid: s.pid, name: s.name, status: s.status, origin: s.origin, tmuxSession: s.tmuxSession,
        remoteControl: s.remoteControl, link: s.link, cwd: s.cwd, startedAt: s.startedAt
    })).sort((a, b) => a.id.localeCompare(b.id));
}

/** A build gate as the console lists it (#1154): state, who asked, who it waits on. */
function briefBuild(g) {
    const b = g.build;
    return {
        id: b.id, target: b.target, repo: b.repo, state: b.state, requestedBy: b.requestedBy, note: b.note, createdAt: b.createdAt,
        startedAt: b.startedAt, endedAt: b.endedAt, result: b.result, forced: b.forced, canBegin: !!g.canBegin,
        participants: (g.participants || []).map((p) => ({ agentId: p.agentId, name: p.name, state: p.state, note: p.note, busy: p.busy })),
        waitingOn: (g.waitingOn || []).map((w) => w.name || w.agentId)
    };
}

function coordSummary() {
    try {
        const agents = coord.listAgents().map((a) => ({ id: a.id, kind: a.kind, name: a.name, account: a.account, task: a.task, status: a.status, repo: a.repo, branch: a.branch, sessionId: a.sessionId, claims: a.claims, model: a.model, effort: a.effort, dispatchedBy: a.dispatchedBy, live: a.status !== 'gone' ? ((coord.liveRecord(a) || {}).status || '') : '' }));
        const claims = coord.liveClaims().map((c) => ({ id: c.id, agentId: c.agentId, repo: c.repo, path: c.path, mode: c.mode, note: c.note, expiresAt: c.expiresAt }));
        const last = coord.recentMessages({ limit: 1 })[0];
        const builds = coord.builds({ recent: true }).map(briefBuild);
        return { agents, claims, builds, lastMessageId: last ? last.id : 0 };
    } catch (e) {
        return { agents: [], claims: [], builds: [], lastMessageId: 0, error: e.message };
    }
}

let deskFeed = null;
let fluxFeed = null;

function defineFeeds() {
    if (deskFeed) return;
    deskFeed = statusHub.define({
        name: 'claude_desk',
        pushType: 'claude_desk_status',
        intervalMs: 30000,
        allow: isAdmin,
        sample: async () => {
            armSessionsWatch(deskFeed);
            const host = gResources ? await claudeHost.hostStatus(gResources) : null;
            if (host && host.remoteControl && host.remoteControl.pane) delete host.remoteControl.pane.tail; // the pane's last lines change on every redraw
            return {
                host,
                accounts: gResources ? claudeHost.listAccounts(gResources) : [],
                live: liveSummary(),
                coord: coordSummary(),
                supervisor: supervisorSummary()
            };
        }
    });
    fluxFeed = statusHub.define({
        name: 'claude_desk_flux',
        pushType: 'claude_desk_flux',
        intervalMs: 2000,
        allow: isAdmin,
        sample: async () => ({ rc: claudeHost.publicStatus(), login: claudeLogin.status(gResources) })
    });
}

const poke = () => { if (deskFeed) deskFeed.poke(); };

// ---------------------------------------------------------------- Supervisor (#1154, modules/agentSupervisor.js)

const supervisor = require('../../agentSupervisor');

/** The console refetches the review list only when lastReviewId moves (no polling). */
function supervisorSummary() {
    try { const x = supervisor.summary(); return { lastReviewId: x.lastReviewId, version: x.version, open: x.open, workActive: x.workActive, workQueued: x.workQueued }; } catch (_) { return { lastReviewId: 0, version: 0, open: 0 }; }
}

async function supervisorStatus(gr) {
    const set = supervisor.settings(gr);
    // fleet-labelled issues filed on Yozora come into the queue (at most every 2 min; never waits long)
    await Promise.race([supervisor.pullIssues(gr).catch(() => null), new Promise((r) => setTimeout(r, 4000))]);
    let locks = [];
    let artifacts = [];
    try { locks = supervisor.lockStatus(); } catch (e) { console.warn(`[claudeDesk] locks: ${e.message}`); }
    if (set.trackArtifacts) {
        try { supervisor.refreshArtifacts({ budgetMs: 2500 }); artifacts = supervisor.artifactStatus(); } catch (e) { console.warn(`[claudeDesk] artifacts: ${e.message}`); }
    }
    const stats = Object.assign(supervisor.summary(), { artifactBytes: artifacts.filter((a) => a.exists !== false).reduce((n, a) => n + (a.sizeBytes || 0), 0) });
    return { settings: set, engines: supervisor.engines(gr), reviews: supervisor.listReviews({ limit: 80 }), work: supervisor.listWork({ limit: 100 }), locks, artifacts, stats };
}

const handleSupervisor = guard('claude_desk_supervisor', async (gr, message) => {
    const action = String(message.action || 'status');
    if (action === 'status') return supervisorStatus(gr);
    if (action === 'save') { await supervisor.saveSettings(gr, message.settings || {}); return supervisorStatus(gr); }
    if (action === 'recheck') return { review: await supervisor.review(String(message.sessionId || ''), 'recheck', { gr }) };
    if (action === 'send') return { review: await supervisor.send(message.reviewId) };
    if (action === 'dismiss') { supervisor.dismiss(message.reviewId); return supervisorStatus(gr); }
    if (action === 'enqueue') {
        supervisor.enqueue({ title: message.title, prompt: message.prompt, cwd: message.cwd, account: message.account === 'auto' ? null : message.account, model: message.model, effort: message.effort, engine: message.engine, startNow: message.startNow === true, source: 'fleet' }, { gr });
        return supervisorStatus(gr);
    }
    if (action === 'work_start') { supervisor.startWork(message.id); return supervisorStatus(gr); }
    if (action === 'work_cancel') { supervisor.cancelWork(message.id); return supervisorStatus(gr); }
    if (action === 'lock_remove') { supervisor.removeLockFile(String(message.root || ''), String(message.file || '')); poke(); return supervisorStatus(gr); }
    if (action === 'artifact_clean') { const r = supervisor.cleanArtifact(message.id); return Object.assign(await supervisorStatus(gr), { cleaned: r }); }
    if (action === 'artifact_forget') { supervisor.forgetArtifact(message.id); return supervisorStatus(gr); }
    throw new Error('action must be status, save, recheck, send, dismiss, enqueue, work_start, work_cancel, lock_remove, artifact_clean or artifact_forget');
});

// ---------------------------------------------------------------- transcript watches (one per socket)

const watches = new Map(); // ws -> { id, file, end, watcher, timer, send }

function unwatch(ws) {
    const w = watches.get(ws);
    if (!w) return;
    clearTimeout(w.timer);
    try { w.watcher.close(); } catch (_) { /* closed */ }
    watches.delete(ws);
}

async function watchTranscript(handlersCtx, ws, id, from, view) {
    unwatch(ws);
    const file = await launcher.findFile(id);
    if (!file) throw new Error('No such Claude session');
    const st = await fs.promises.stat(file);
    const w = { id, file, end: Number.isFinite(Number(from)) ? Number(from) : st.size, watcher: null, timer: null, reading: false };
    const flush = async () => {
        if (w.reading || watches.get(ws) !== w) return;
        w.reading = true;
        try {
            for (let i = 0; i < 8; i += 1) {
                const r = await transcript.readSince(file, w.end, { view: w.view });
                if (r.end === w.end) break;
                w.end = r.end;
                if (r.messages.length && ws.readyState === 1) handlersCtx.sendToClient(ws, { type: APPEND_TYPE, data: { id, messages: r.messages, end: r.end }, timestamp: new Date().toISOString() });
            }
        } catch (_) { /* next change */ } finally { w.reading = false; }
    };
    w.watcher = fs.watch(file, { persistent: false }, () => { clearTimeout(w.timer); w.timer = setTimeout(flush, 400); });
    w.watcher.on('error', () => unwatch(ws));
    w.view = view || null;
    watches.set(ws, w);
    if (typeof ws.once === 'function') ws.once('close', () => unwatch(ws));
    void flush();
    return { id, watching: true, end: w.end };
}

// ---------------------------------------------------------------- handlers

const handleSessions = guard('claude_desk_sessions', (gr, message) => sessionsPage(gr, message));

const handleTranscript = guard('claude_desk_transcript', async (gr, message) => {
    const file = await launcher.findFile(String(message.id || ''));
    if (!file) throw new Error('No such Claude session');
    // #1154: show { thinking, edits, tools, results } picks what is sent (Fleet sends it; without it the old
    // full output); item { at, part } answers one folded thinking / edit in full
    const view = message.show ? transcript.viewFrom(message.show) : undefined;
    if (message.item) return { id: message.id, item: await transcript.readItem(file, message.item.at, message.item.part) };
    if (message.since !== undefined && message.since !== null) return Object.assign({ id: message.id }, await transcript.readSince(file, message.since, { view }));
    return Object.assign({ id: message.id }, await transcript.readPage(file, { before: message.before, limit: message.limit, view }));
});

const handleWatch = guard('claude_desk_watch', async (gr, message, ws, clientInfo, handlersCtx) => watchTranscript(handlersCtx, ws, String(message.id || ''), message.from, message.show ? transcript.viewFrom(message.show) : null));
const handleUnwatch = guard('claude_desk_unwatch', async (gr, message, ws) => { unwatch(ws); return { watching: false }; });

const handleSession = guard('claude_desk_session', async (gr, message) => {
    const action = String(message.action || '');
    const id = String(message.id || '');
    let result;
    if (action === 'start') {
        // account 'auto': the preferred account while it is free, else the most headroom (claudeFleetMcp.pickForStart);
        // model / effort / mode fall back to the account's own defaults (Fleet account settings)
        let account = message.account;
        let defaults = {};
        if (account === 'auto' || account === '' || account === undefined || account === null) {
            const pick = await require('../../claudeFleetMcp').pickForStart(gr, 'auto');
            account = pick.index;
            defaults = pick.settings || {};
        } else {
            const acc = claudeHost.listAccounts(gr).find((a) => a.index === Number(account));
            if (acc) defaults = require('../../claudeFleetSettings').get(gr, acc.id);
        }
        const supervised = message.supervised === true;
        const prompt = message.prompt && supervised
            ? `${message.prompt}\n\n(This session is supervised: before you say a multi-part request is done, call coord_supervisor_check and address what it finds.)`
            : message.prompt;
        result = await launcher.start(gr, {
            cwd: message.cwd || path.join(__dirname, '..', '..', '..'), prompt, title: message.title, account,
            mode: message.mode || defaults.defaultMode, engine: message.engine && message.engine !== 'claude' ? message.engine : undefined,
            model: message.model || (message.engine && message.engine !== 'claude' ? undefined : defaults.defaultModel) || undefined, effort: message.effort || defaults.defaultEffort || undefined
        });
        if (supervised && result && result.id) supervisor.markSupervised(result.id);
        result = Object.assign({ supervised }, result);
    } else if (action === 'resume') {
        result = await launcher.resume(gr, id, { account: message.account, mode: message.mode, title: message.title, model: message.model || undefined, effort: message.effort || undefined });
    } else if (action === 'steer') {
        result = await launcher.steer(id, message.text);
    } else if (action === 'interrupt') {
        result = await launcher.interrupt(id);
    } else if (action === 'screen') {
        result = await launcher.screen(id);
    } else if (action === 'disconnect') {
        result = await claudeSessions.disconnect(id);
    } else if (action === 'takeover') {
        result = await launcher.takeover(gr, id);
    } else if (action === 'detail') {
        return { detail: await sessionDetail(gr, id) };
    } else if (action === 'agent_page') {
        const file = await subagentFile(id, message.agentId);
        if (message.item) return { id, agentId: String(message.agentId), item: await transcript.readItem(file, message.item.at, message.item.part) };
        return Object.assign({ id, agentId: String(message.agentId) }, await transcript.readPage(file, { before: message.before, limit: message.limit, view: message.show ? transcript.viewFrom(message.show) : undefined }));
    } else if (action === 'task_output') {
        return taskOutput(id, message.taskId);
    } else if (action === 'command') {
        result = await sessionCommand(id, message.command, message.value);
    } else {
        throw new Error('action must be start, resume, takeover, steer, interrupt, screen, disconnect, detail, agent_page, task_output or command');
    }
    poke();
    return { result };
});

// ---------------------------------------------------------------- one session in depth (#1154)

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT_ID_RE = /^a[0-9a-f]{8,40}$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

/** The session's own folder beside its transcript (subagents/, tool-results/) and its background task dir. */
async function sessionDirs(id) {
    if (!SESSION_ID_RE.test(String(id || ''))) throw new Error('A session id');
    const file = await launcher.findFile(id);
    if (!file) throw new Error('No such Claude session');
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    return {
        file,
        own: path.join(path.dirname(file), id),
        tasks: path.join(require('os').tmpdir(), `claude-${uid}`, path.basename(path.dirname(file)), id, 'tasks')
    };
}

async function subagentFile(id, agentId) {
    if (!AGENT_ID_RE.test(String(agentId || ''))) throw new Error('An agent id');
    const d = await sessionDirs(id);
    const file = path.join(d.own, 'subagents', `agent-${agentId}.jsonl`);
    await fs.promises.access(file);
    return file;
}

async function countLines(file, size) {
    if (size > 8 * 1024 * 1024) return null; // not worth reading for a count
    const buf = await fs.promises.readFile(file);
    let n = 0;
    for (let i = 0; i < buf.length; i += 1) if (buf[i] === 10) n += 1;
    return n;
}

async function sessionDetail(gr, id) {
    const d = await sessionDirs(id);
    const live = claudeSessions.liveSessions().find((x) => x.id === id) || null;
    const st = await fs.promises.stat(d.file);
    let inspect = null;
    try { inspect = coord.inspect(`claude-${id.slice(0, 8)}`, { limit: 100 }); } catch (_) { inspect = null; }
    const agentRow = inspect ? inspect.agent : null;
    // the model of its last answer (the transcript's own record)
    let model = agentRow && agentRow.model ? agentRow.model : '';
    if (!model) {
        try {
            const page = await transcript.readPage(d.file, { limit: 20 });
            const last = (page.messages || []).slice().reverse().find((m) => m.role === 'assistant' && m.model);
            model = last ? last.model : '';
        } catch (_) { model = ''; }
    }
    let account = agentRow && agentRow.account ? agentRow.account : '';
    if (!account && live) {
        if (!live.configDir) account = 'host';
        else { try { account = JSON.parse(fs.readFileSync(path.join(path.dirname(live.configDir), 'fleet.json'), 'utf8')).name || ''; } catch (_) { account = ''; } }
    }
    const cwd = (live && live.cwd) || (agentRow && agentRow.cwd) || '';
    let branch = (agentRow && agentRow.branch) || '';
    if (!branch && cwd) { try { branch = require('child_process').execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { branch = ''; } }
    const agents = [];
    let metas = [];
    try { metas = (await fs.promises.readdir(path.join(d.own, 'subagents'))).filter((n) => /^agent-a[0-9a-f]+\.meta\.json$/.test(n)); } catch (_) { metas = []; }
    for (const n of metas) {
        const agentId = n.slice('agent-'.length, -'.meta.json'.length);
        let meta = {};
        try { meta = JSON.parse(await fs.promises.readFile(path.join(d.own, 'subagents', n), 'utf8')); } catch (_) { meta = {}; }
        let js = null;
        try { js = await fs.promises.stat(path.join(d.own, 'subagents', `agent-${agentId}.jsonl`)); } catch (_) { js = null; }
        agents.push({
            agentId, description: String(meta.description || '').slice(0, 200), type: meta.agentType || '', model: meta.model || meta.pickedEffortModel || '',
            finished: meta.finished === true, background: meta.requestShape === 'background', lastActivity: js ? Math.round(js.mtimeMs) : null,
            messages: js ? await countLines(path.join(d.own, 'subagents', `agent-${agentId}.jsonl`), js.size) : 0
        });
    }
    agents.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
    const tasks = [];
    let names = [];
    try { names = (await fs.promises.readdir(d.tasks)).filter((n) => n.endsWith('.output')); } catch (_) { names = []; }
    for (const n of names) {
        const taskId = n.slice(0, -'.output'.length);
        let lst = null;
        let tst = null;
        try { lst = await fs.promises.lstat(path.join(d.tasks, n)); tst = await fs.promises.stat(path.join(d.tasks, n)); } catch (_) { continue; }
        const kind = lst.isSymbolicLink() ? 'agent' : 'shell';
        tasks.push({ taskId, kind, sizeBytes: tst.size, modifiedAt: Math.round(tst.mtimeMs), running: Date.now() - tst.mtimeMs < 30000 && kind !== 'agent' });
    }
    tasks.sort((a, b) => b.modifiedAt - a.modifiedAt);
    let reviews = [];
    try { reviews = supervisor.listReviews({ limit: 200 }).filter((r) => r.sessionId === id).slice(0, 20).map((r) => ({ id: r.id, verdict: r.verdict, summary: r.summary, at: r.at, missed: r.missed })); } catch (_) { reviews = []; }
    return {
        id,
        title: (live && live.givenName) || (agentRow && agentRow.name) || (live && live.name) || id.slice(0, 8),
        status: live ? (live.status || 'idle') : 'stopped',
        live: !!live,
        account,
        model,
        effort: (agentRow && agentRow.effort) || '',
        cwd,
        branch,
        link: live ? live.link : '',
        remoteControl: !!(live && live.remoteControl),
        origin: live ? live.origin : '',
        startedAt: live && live.startedAt ? live.startedAt : null,
        lastActivity: Math.round(st.mtimeMs),
        transcriptBytes: st.size,
        claims: inspect ? inspect.claims.map((c) => c.path) : [],
        edited: inspect ? inspect.edited : { total: 0, files: [] },
        uncommitted: inspect && inspect.uncommitted ? inspect.uncommitted.count : null,
        reviews,
        supervised: supervisor.isSupervised(id),
        agents,
        tasks
    };
}

async function taskOutput(id, taskId) {
    if (!TASK_ID_RE.test(String(taskId || ''))) throw new Error('A task id');
    const d = await sessionDirs(id);
    const file = path.join(d.tasks, `${taskId}.output`);
    const lst = await fs.promises.lstat(file);
    if (lst.isSymbolicLink()) throw new Error('That task is a background agent: open it in Background agents');
    const st = await fs.promises.stat(file);
    const want = Math.min(st.size, 16 * 1024);
    const fh = await fs.promises.open(file, 'r');
    let text = '';
    try {
        const buf = Buffer.alloc(want);
        await fh.read(buf, 0, want, st.size - want);
        text = buf.toString('utf8');
    } finally { await fh.close(); }
    if (st.size > want) text = text.slice(text.indexOf('\n') + 1);
    text = text.split('\n').map((l) => transcript.mask(l)).join('\n');
    return { id, taskId, text, sizeBytes: st.size, modifiedAt: Math.round(st.mtimeMs), truncated: st.size > want };
}

/** A slash command typed into the session (only these; the session must run in tmux). */
async function sessionCommand(id, command, value) {
    const v = String(value || '').trim();
    let line;
    if (command === 'compact') line = '/compact';
    else if (command === 'cost') line = '/cost';
    else if (command === 'context') line = '/context';
    else if (command === 'model') {
        if (!/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/.test(v)) throw new Error('A model name (opus, sonnet, haiku, fable or a full id)');
        line = `/model ${v}`;
    } else if (command === 'effort') {
        if (!launcher.EFFORTS.has(v)) throw new Error('effort is low, medium, high, xhigh or max');
        line = `/effort ${v}`;
    } else throw new Error('command is compact, model, effort, cost or context');
    const r = await launcher.steer(id, line);
    if (command === 'model' || command === 'effort') {
        try { coord.upsertAgent({ id: `claude-${id.slice(0, 8)}`, [command]: v }); } catch (_) { /* not registered */ }
    }
    return Object.assign({ command: line }, r);
}

// the engines a session or work item can run on: Claude (the account's login) or another model through the bridge
const handleEngines = guard('claude_fleet_engines', async (gr) => ({
    engines: [{ id: 'claude', name: 'Claude (the account\'s plan)', defaultModel: 'sonnet', models: ['sonnet', 'opus', 'haiku', 'fable'], ready: true }]
        .concat(supervisor.engines(gr).map((e) => ({ id: e.id === 'tokenrouter' ? 'tokenrouter' : (String(e.id).startsWith('custom:') ? e.id : `custom:${e.id}`), name: e.name, defaultModel: e.defaultModel, models: [], ready: e.ready })))
}));

// ---------------------------------------------------------------- Plaud into the Supervisor's queue (New Session wizard)

const handlePlaud = guard('claude_fleet_plaud', async (gr, message) => {
    const action = String(message.action || 'list');
    const plaud = require('../../plaudClient');
    if (action === 'list') {
        const r = await plaud.listRecordings({ limit: Math.max(5, Math.min(50, Number(message.limit) || 20)) });
        const items = (r && (r.recordings || r.items)) || [];
        return { recordings: items.map((x) => ({ id: x.id, name: x.name || x.title || '', startAt: x.startAt || x.createdAt || null, durationMs: x.durationMs || null })) };
    }
    if (action === 'start') {
        let picks = Array.isArray(message.recordingIds) ? message.recordingIds.map(String).filter((x) => /^[A-Za-z0-9_-]{4,80}$/.test(x)).slice(0, 20) : [];
        let named = new Map();
        const r = await plaud.listRecordings({ limit: 50 });
        ((r && (r.recordings || r.items)) || []).forEach((x) => named.set(String(x.id), x.name || x.title || ''));
        if (message.all === true) picks = [...named.keys()].slice(0, 20);
        if (!picks.length) throw new Error('Pick a recording');
        // the Supervisor takes them (#1154, Yukimi: "you don't have to start a new director session, you can have
        // the supervisor handle it so they can also handle if the work needs to be started now")
        const work = await supervisor.intakePlaud(gr, picks);
        return { work: work.map((w) => ({ id: w.id, title: w.title, state: w.state, sessionId: w.sessionId, link: w.link, recordingId: w.recordingId, reused: !!w.reused, message: w.message })) };
    }
    throw new Error('action must be list or start');
});

/** The person at the desktop, as an agent in the coordination store (so agents can answer them). */
function deskAgent(clientInfo) {
    const who = String((clientInfo && (clientInfo.username || clientInfo.userName)) || 'admin').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'admin';
    return coord.upsertAgent({ id: `desk-${who}`, kind: 'person', name: `${who} (Claude Accounts)`, task: 'Watching the agents', pid: null });
}

const handleCoord = guard('claude_desk_coord', async (gr, message, ws, clientInfo) => {
    const action = String(message.action || 'list');
    if (action === 'list') {
        return Object.assign(coordSummary(), { messages: coord.recentMessages({ limit: Number(message.limit) || 100, agentId: message.agentId || undefined }) });
    }
    if (action === 'post') {
        const me = deskAgent(clientInfo);
        const msg = coord.post(me.id, message.to || 'all', message.body, { kind: message.kind });
        // a steer to a Claude session that runs in tmux is typed in (as the MCP server does)
        if (msg.kind === 'steer' && msg.to !== 'all' && message.deliver !== false) {
            const ag = coord.getAgent(msg.to);
            if (ag && ag.sessionId && ag.status !== 'gone') {
                try { await launcher.steer(ag.sessionId, `[steering from ${me.name}] ${msg.body}`); coord.markDelivered(msg.id, 'tmux'); msg.delivered = 'tmux'; } catch (_) { /* inbox only */ }
            }
        }
        poke();
        return { sent: msg };
    }
    if (action === 'release') {
        // an admin frees a claim an agent left behind
        const claim = coord.liveClaims().find((c) => c.id === Number(message.claimId));
        if (!claim) throw new Error('No such claim (it may have lapsed)');
        coord.release(claim.agentId, claim.repo, [claim.path]);
        poke();
        return Object.assign(coordSummary(), { released: claim.id });
    }
    if (action === 'inspect') {
        // #1154: what an agent is doing (files edited, commands, last words, claims, uncommitted files)
        return { inspect: coord.inspect(String(message.agentId || ''), { limit: Number(message.limit) || 100 }) };
    }
    if (action === 'locks') {
        const root = path.join(__dirname, '..', '..', '..');
        return { root, locks: coord.lockFiles(root) };
    }
    if (action === 'build_end') {
        // an admin cancels / ends a gate someone left open (everyone is told)
        const me = deskAgent(clientInfo);
        const ended = coord.adminEndBuild(Number(message.buildId), me.id, message.reason || 'ended from Claude Accounts');
        poke();
        return Object.assign(coordSummary(), { ended });
    }
    throw new Error('action must be list, post, release, inspect, locks or build_end');
});

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    gResources = handlersCtx.globalResources;
    defineFeeds();
    runtime.bind(gResources);
    // config dirs of accounts with parallel sessions: copy rotated logins back; the carry tmux server in its own scope
    setTimeout(() => {
        runtime.armAll(gResources).catch((e) => console.warn(`[claudeDesk] account runtimes: ${e.message}`));
        if (process.env.DREAMSCAPE_CLAUDE_RC_READONLY !== '1') launcher.ensureServer().catch((e) => console.warn(`[claudeDesk] carry tmux server: ${e.message}`));
        // the Supervisor watches every session's turns end (fs.watch on ~/.claude/sessions) and serves agent-coord's check
        if (process.env.DREAMSCAPE_CLAUDE_RC_READONLY !== '1') {
            try { supervisor.start(gResources); supervisor.onReview(() => poke()); } catch (e) { console.warn(`[claudeDesk] supervisor: ${e.message}`); }
        }
    }, 5000).unref();
    const reg = (type, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'claudeDesk', ...meta });
    };
    reg('claude_desk_sessions', handleSessions);
    reg('claude_desk_transcript', handleTranscript);
    reg('claude_desk_watch', handleWatch);
    reg('claude_desk_unwatch', handleUnwatch);
    reg('claude_desk_session', handleSession, ADMIN_DESTRUCTIVE);
    reg('claude_desk_coord', handleCoord, ADMIN_DESTRUCTIVE);
    reg('claude_desk_supervisor', handleSupervisor, ADMIN_DESTRUCTIVE);
    reg('claude_fleet_plaud', handlePlaud, ADMIN_DESTRUCTIVE);
    reg('claude_fleet_engines', handleEngines);
}

module.exports = { registerPackets, _handlers: { handleSessions, handleTranscript, handleWatch, handleUnwatch, handleSession, handleCoord, handleSupervisor }, _sessionsPage: sessionsPage, _ownerOf: ownerOf };
