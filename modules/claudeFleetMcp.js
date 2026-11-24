/**
 * Claude fleet MCP module (scope sfapp_claude_fleet): Yozora (Xi) sends work to every Claude account
 * (#1154, Yukimi Nov 24 2026: "a way for the director yozora to send work to each as a specific model and
 * effort, as well as know their usage").
 *
 *   claude_fleet_status     each account: plan usage (5-hour / weekly percent and resets), its Remote
 *                           Control (own folder or the host's), the sessions running on it (busy / idle,
 *                           model, folder, link), and the coordination picture (agents, claims, build gates)
 *   claude_dispatch         a new session on an account ("auto" = the most headroom) with a model and an
 *                           effort, a folder and a first prompt; Remote Control on (claude.ai/code link),
 *                           agent-coord registered, dispatchedBy Yozora in the coordination store
 *   claude_session_read     a session's latest messages, busy / idle, and what it edited (agent-coord inspect)
 *   claude_session_send     a follow-up or steering message into a running session (resume: true starts a
 *                           stopped one again on its account first)
 *   claude_session_stop     Esc in its terminal (ends the current turn; the session stays)
 *
 * Gates, as Plaud's (modules/plaudMcp.js): the key names sfapp_claude_fleet itself ('universal' does not
 * count) and is Xi's own (application name "Xi"); directorAppKeyScopes widens only the Xi key. Nothing here
 * returns a token.
 */

'use strict';

const path = require('path');

const SCOPE = 'sfapp_claude_fleet';
const ROLE = 'claude_fleet';
const OWNER_APP = 'xi';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const FULL_PCT = 95; // an account at or past this in any window is not picked by "auto"

const str = (description) => ({ type: 'string', description });

function tool(name, description, properties, required) {
    return {
        name,
        core: true,
        role: ROLE,
        scope: SCOPE,
        description: `Claude fleet (Yozora only). ${description}`,
        inputSchema: { type: 'object', additionalProperties: false, required: required || [], properties: properties || {} }
    };
}

const TOOLS = [
    tool('claude_fleet_status', 'Every Claude account: plan usage (current session / 5-hour and weekly percent used, resets), Remote Control (connected / stopped / error; own folder or the host\'s login), the sessions running on it (busy / idle, title, folder, link), and the coordination picture (agents, claims, open build gates). Read this before claude_dispatch.', {
        refresh: { type: 'boolean', description: 'Read usage now instead of the cached read (at most every 20 s)' }
    }),
    tool('claude_dispatch', 'Start a Claude Code session on an account with a model and effort, in a folder, with a first prompt. It runs in Remote Control (Yukimi sees it on claude.ai/code) with the agent-coord MCP (claims, busy locks, build gates). Answers its session id, account and link. Give the prompt the whole task: the Yozora issue, the files, the acceptance check, and that it must coord_claim before editing and coord_build_request before any build.', {
        prompt: str('The task, complete (it starts with nothing else)'),
        account: str('Account name or index from claude_fleet_status, or "auto" (default): the account with the most headroom'),
        model: str('Model alias (sonnet, opus, haiku, fable) or a full model id. Default sonnet (subagents-sonnet rule): pick another only for a named reason (undecided design, a bug Sonnet already failed on, a security review, Yukimi asked) and say it in modelReason'),
        modelReason: str('Why not Sonnet, when model is not sonnet'),
        effort: { type: 'string', enum: EFFORTS, description: 'Reasoning effort (default: the CLI default)' },
        cwd: str('Absolute folder on the host (default: the Dreamscape repo)'),
        title: str('Session title shown in claude.ai/code (default: the prompt\'s first line)'),
        mode: { type: 'string', enum: ['bypassPermissions', 'acceptEdits', 'auto', 'default', 'plan'], description: 'Permission mode (default bypassPermissions, as Remote Control\'s)' },
        allowFull: { type: 'boolean', description: 'Allow an account at 95% or more of a limit' }
    }, ['prompt']),
    tool('claude_session_read', 'A Claude session: busy / idle, account, model, its latest messages, the files it edited and its claims (from agent-coord).', {
        session: str('Session id (or its first 8 characters)'),
        messages: { type: 'number', description: 'How many of the newest messages (default 12, max 60)' }
    }, ['session']),
    tool('claude_session_send', 'Send a message into a running session: its next prompt when idle, steering when busy. resume: true starts a stopped session again on its account first.', {
        session: str('Session id (or its first 8 characters)'),
        text: str('The message'),
        resume: { type: 'boolean', description: 'Start it again first when it is not running' },
        account: str('With resume: the account to run it on (default: auto)')
    }, ['session', 'text']),
    tool('claude_session_stop', 'Stop a session\'s current turn (Esc in its terminal). The session stays and can be sent more.', {
        session: str('Session id (or its first 8 characters)')
    }, ['session'])
];
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

function mcpTextResult(obj, isError) {
    return { content: [{ type: 'text', text: JSON.stringify(obj) }], isError: isError === true };
}

function isFleetTool(name) { return TOOL_NAMES.has(name); }
function scopesHaveFleet(scopes) { return Array.isArray(scopes) && scopes.includes(SCOPE); }
function isFleetOwner(appName) { return String(appName || '').trim().toLowerCase() === OWNER_APP; }
function appNameOf(req) {
    try { return require('./agentClientBridge').resolveActorName(req); } catch (_) { return null; }
}
function requestScopes(req) {
    const auth = req && req.applicationAuth;
    if (auth && Array.isArray(auth.applicationScopes)) return auth.applicationScopes;
    try { return require('./agentClientBridge').resolveAgentAuthScopes(req); } catch (_) { return []; }
}

// lazy: the facade loads this at start, these load the Claude modules only when a tool runs
const host = () => require('./claudeAccountHost');
const fleet = () => require('./claudeRemoteFleet');
const usage = () => require('./claudeUsage');
const launcher = () => require('./claudeSessionLauncher');
const sessions = () => require('./claudeSessions');
const coord = () => require('./agentCoord/store');

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

function usageBrief(row) {
    if (!row) return null;
    const limits = (row.limits || []).map((l) => ({ kind: l.kind, label: l.label, percent: l.percent, resetsAt: iso(l.resetsAt), severity: l.severity }));
    const worst = limits.reduce((m, l) => (Number.isFinite(l.percent) ? Math.max(m, l.percent) : m), -1);
    return { plan: row.plan || '', limits, worstPercent: worst >= 0 ? worst : null, readAt: iso(row.at), note: row.error || '' };
}

async function snapshot(gr, opts = {}) {
    const [rc, use] = await Promise.all([fleet().status(gr), usage().read(gr, { force: opts.refresh === true }).catch(() => ({ accounts: [] }))]);
    const byIndex = new Map((use.accounts || []).map((u) => [u.index, u]));
    const accounts = rc.accounts.map((a) => ({
        index: a.index,
        name: a.name,
        engineDefault: a.active,
        ownFolder: a.moved,
        onHostLogin: a.onHost,
        remoteControl: { state: a.state, statusLine: a.statusLine, message: a.message },
        canRun: a.hasLogin && (a.moved || a.onHost),
        usage: usageBrief(byIndex.get(a.index)),
        sessions: a.sessions
    }));
    let coordination = null;
    try {
        const s = coord();
        const agents = s.listAgents();
        coordination = {
            agents: agents.map((x) => ({ id: x.id, name: x.name, account: x.account, task: x.task, status: x.status, claims: x.claims, model: x.model, dispatchedBy: x.dispatchedBy })),
            claims: s.liveClaims().map((c) => ({ agentId: c.agentId, repo: c.repo, path: c.path, mode: c.mode })),
            builds: s.builds().map((b) => ({ id: b.build.id, target: b.build.target, repo: b.build.repo, state: b.build.state, by: b.build.requestedBy, waitingOn: (b.waitingOn || []).map((w) => w.name || w.agentId) }))
        };
    } catch (e) { coordination = { error: e.message }; }
    return { at: new Date().toISOString(), accounts, coordination };
}

/** The account for a dispatch: a named / numbered one, or the runnable one with the most headroom. */
function pickAccount(snap, want, allowFull) {
    const runnable = snap.accounts.filter((a) => a.canRun);
    if (want !== undefined && want !== null && String(want).trim() !== '' && String(want).toLowerCase() !== 'auto') {
        const w = String(want).trim().toLowerCase();
        const acc = snap.accounts.find((a) => String(a.index) === w || a.name.toLowerCase() === w) || snap.accounts.find((a) => a.name.toLowerCase().includes(w));
        if (!acc) throw new Error(`No Claude account ${want} (claude_fleet_status lists them)`);
        if (!acc.canRun) throw new Error(`${acc.name} cannot run sessions yet: ${acc.remoteControl.message || 'it needs a linked login and its own folder'}`);
        const worst = acc.usage && acc.usage.worstPercent;
        if (!allowFull && Number.isFinite(worst) && worst >= FULL_PCT) throw new Error(`${acc.name} is at ${worst}% of a limit: pick another, or pass allowFull`);
        return acc;
    }
    const scored = runnable.map((a) => ({ a, worst: a.usage && Number.isFinite(a.usage.worstPercent) ? a.usage.worstPercent : 50 }))
        .filter((x) => allowFull || x.worst < FULL_PCT)
        .sort((x, y) => x.worst - y.worst || x.a.sessions.length - y.a.sessions.length);
    if (!scored.length) throw new Error('No Claude account has room (every runnable account is at 95% of a limit or cannot run): wait for a reset or pass allowFull');
    return scored[0].a;
}

function resolveSession(ref) {
    const r = String(ref || '').trim().toLowerCase();
    if (!r) throw new Error('Which session?');
    const live = sessions().liveSessions();
    const hit = live.find((s) => s.id === r) || live.find((s) => s.id.startsWith(r));
    if (hit) return { id: hit.id, live: hit };
    if (/^[0-9a-f-]{36}$/.test(r)) return { id: r, live: null };
    // a stopped session by prefix: the coordination store knows the ones it has seen
    try {
        const a = coord().resolveAgent(`claude-${r.slice(0, 8)}`);
        if (a && a.sessionId) return { id: a.sessionId, live: null };
    } catch (_) { /* none */ }
    throw new Error(`No session ${ref}: pass its full id`);
}

async function dispatch(gr, name, input) {
    if (name === 'claude_fleet_status') return snapshot(gr, { refresh: input.refresh === true });
    if (name === 'claude_dispatch') {
        const prompt = String(input.prompt || '').trim();
        if (!prompt) throw new Error('A dispatch needs a prompt');
        const snap = await snapshot(gr);
        const acc = pickAccount(snap, input.account, input.allowFull === true);
        const cwd = input.cwd ? String(input.cwd) : path.join(__dirname, '..');
        // subagents-sonnet (Yukimi, Nov 24 2026): Sonnet unless a reason is named
        const model = input.model ? String(input.model) : 'sonnet';
        if (!/sonnet/i.test(model) && !String(input.modelReason || '').trim()) {
            throw new Error(`Dispatches start on Sonnet: pass modelReason to use ${model} (undecided design, a bug Sonnet already failed on, a security review, or Yukimi asked)`);
        }
        const r = await launcher().start(gr, {
            cwd, prompt, title: input.title, account: acc.index, mode: input.mode,
            model, effort: input.effort, dispatchedBy: 'Yozora'
        });
        return {
            session: r.id, account: { index: acc.index, name: acc.name }, model: r.model, effort: r.effort,
            state: r.state, link: r.link || '', message: r.message, tmux: r.tmuxSession,
            modelReason: input.modelReason ? String(input.modelReason).slice(0, 300) : undefined,
            usageBefore: acc.usage ? acc.usage.limits : []
        };
    }
    if (name === 'claude_session_read') {
        const { id, live } = resolveSession(input.session);
        const file = await launcher().findFile(id);
        const out = { session: id, running: !!live, status: live ? live.status : 'stopped', link: live ? live.link : '', folder: live && live.cwd ? path.basename(live.cwd) : '' };
        if (live) {
            const acc = (await fleet().status(gr)).accounts.find((a) => a.sessions.some((s) => s.id === id));
            out.account = acc ? acc.name : (live.configDir ? path.basename(path.dirname(live.configDir)) : 'host');
        }
        if (file) {
            const page = await require('./claudeTranscript').readPage(file, { limit: Math.max(1, Math.min(60, Number(input.messages) || 12)) });
            out.messages = (page.messages || []).filter((m) => m.role !== 'tool').map((m) => ({ role: m.role, kind: m.kind, time: m.time, text: m.text, tool: m.tool || undefined }));
        }
        try {
            const r = coord().inspect(`claude-${id.slice(0, 8)}`, { limit: 60, git: false });
            out.model = r.agent.model || '';
            out.task = r.agent.task;
            out.edited = r.edited;
            out.claims = r.claims.map((c) => c.path);
        } catch (_) { /* not in the store yet */ }
        return out;
    }
    if (name === 'claude_session_send') {
        let { id, live } = resolveSession(input.session);
        if (!live) {
            if (input.resume !== true) throw new Error('It is not running: pass resume: true to start it again first');
            const snap = await snapshot(gr);
            const acc = pickAccount(snap, input.account, false);
            const r = await launcher().resume(gr, id, { account: acc.index });
            if (r.state === 'failed') throw new Error(r.message || 'It did not start again');
            live = true;
        }
        return Object.assign({ session: id }, await launcher().steer(id, String(input.text || '')));
    }
    if (name === 'claude_session_stop') {
        const { id } = resolveSession(input.session);
        return launcher().interrupt(id);
    }
    throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'UNKNOWN_TOOL' });
}

async function handleFleetTool(gr, req, name, args) {
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const app = appNameOf(req);
    if (!isFleetOwner(app)) {
        console.warn(`[claudeFleet] ${name} refused for ${app || 'an unnamed key'}: Yozora only`);
        return mcpTextResult({ success: false, error: 'The Claude fleet is for Yozora only', code: 'FORBIDDEN' }, true);
    }
    if (!scopesHaveFleet(requestScopes(req))) {
        return mcpTextResult({ success: false, error: `Application key does not have ${SCOPE}`, code: 'INSUFFICIENT_SCOPE' }, true);
    }
    try {
        const out = await dispatch(gr, name, input);
        return mcpTextResult(Object.assign({ success: true }, out));
    } catch (error) {
        return mcpTextResult({ success: false, error: (error && error.message) || 'Failed', code: (error && error.code) || 'ERROR' }, true);
    }
}

module.exports = {
    SCOPE, ROLE, TOOLS, isFleetTool, isFleetOwner, scopesHaveFleet, handleFleetTool,
    _test: { pickAccount, snapshot }
};
