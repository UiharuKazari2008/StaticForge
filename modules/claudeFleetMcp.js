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
 *   fleet_work_list / fleet_work_get / fleet_work_update / fleet_work_start / fleet_work_hold / fleet_work_cancel
 *                           the Supervisor's work queue (Fleet's Work Queue): read it, edit a not-running item's
 *                           brief, start (Waiting -> queued), hold, cancel
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

const WORK_FILTERS = ['held', 'queued', 'running', 'sent_back', 'input', 'done', 'failed', 'cancelled', 'open', 'all'];
const STATE_LABEL = { held: 'Waiting', queued: 'Queued', starting: 'Starting', running: 'Running', waiting: 'Sent Back', input: 'Input Required', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
const FILTER_STATES = { held: ['held'], queued: ['queued'], running: ['starting', 'running'], sent_back: ['waiting'], input: ['input'], done: ['done'], failed: ['failed'], cancelled: ['cancelled'], open: ['held', 'queued', 'starting', 'running', 'waiting', 'input'] };

const TOOLS = [
    tool('claude_fleet_status', 'Every Claude account: plan usage (current session / 5-hour and weekly percent used, resets), Remote Control (connected / stopped / error; own folder or the host\'s login), the sessions running on it (busy / idle, title, folder, link), and the coordination picture (agents, claims, open build gates). Read this before claude_dispatch.', {
        refresh: { type: 'boolean', description: 'Read usage now instead of the cached read (at most every 20 s)' }
    }),
    tool('claude_dispatch', 'Hand work to the Supervisor: it becomes a work item that starts as a supervised Fleet session (Waiting until started; with startNow it starts when there is a slot and an account with room) on an account with a model and effort, in a folder, with a first prompt. The Supervisor checks each of its turns against the request. It runs in a Fleet terminal (steerable from Fleet) WITHOUT Remote Control unless you pass remoteControl: true (then Yukimi also sees it on claude.ai/code and can take it over from the phone); it always has the agent-coord MCP (claims, busy locks, build gates). Several related Yozora issues can be one run: pass them all in issues. Answers its session id, account and link. Give the prompt the whole task: the Yozora issue, the files, the acceptance check, and that it must coord_claim before editing and coord_build_request before any build.', {
        prompt: str('The task, complete (it starts with nothing else)'),
        account: str('Account name or index from claude_fleet_status, or "auto" (default): the account with the most headroom'),
        model: str('Model alias (sonnet, opus, haiku, fable) or a full model id. Default sonnet (subagents-sonnet rule): pick another only for a named reason (undecided design, a bug Sonnet already failed on, a security review, Yukimi asked) and say it in modelReason. A planner (topology planner) is sized by the Supervisor when its stages are left unset: opus / high, opus / xhigh for large requests, fable / xhigh for very large or hard ones'),
        modelReason: str('Why not Sonnet, when model is not sonnet'),
        effort: { type: 'string', enum: EFFORTS, description: 'Reasoning effort (default: the CLI default)' },
        cwd: str('Absolute folder on the host (default: the Dreamscape repo)'),
        title: str('Session title shown in Fleet (and in claude.ai/code with remoteControl) (default: the prompt\'s first line)'),
        remoteControl: { type: 'boolean', description: 'Start the session in Remote Control (claude.ai/code, takeover from the phone). Default false: it runs in a Fleet terminal only' },
        issues: { type: 'array', items: { type: 'string' }, description: 'Yozora issues this one run covers, as "owner/repo#N" or issue URLs (the first is the primary; the others are named in the brief and get their own comments; the run closes only those whose own ask is done). Leave out and an issue is made for the request' },
        mode: { type: 'string', enum: ['bypassPermissions', 'acceptEdits', 'auto', 'default', 'plan'], description: 'Permission mode (default bypassPermissions, as Remote Control\'s)' },
        allowFull: { type: 'boolean', description: 'Allow an account at 95% or more of a limit' },
        host: { type: 'string', enum: ['misaka', 'dreamscape', 'auto'], description: 'Where the session runs: misaka (Fat Misaka, in its own replica worktree: it commits and pushes instead of editing the live tree; the host is woken and kept on for its life), dreamscape, or auto / unset (Fleet setting sessionHost, Dreamscape unless changed; Misaka falls back to Dreamscape when it cannot be used). Misaka takes StaticForge work with the default cwd only' },
        startNow: { type: 'boolean', description: 'Start it now when there is room. Default false: the item lands in Waiting (held) until Yukimi starts it, or you do with fleet_work_start when she asked or agreed' },
        engine: str('claude (default: the account\'s plan), tokenrouter (DeepSeek V4.1 Flash unless model names another), or custom:<provider id> (custom:sloproxy, custom:deepinfra, custom:deepseek): another model runs the same Claude Code session through the Director\'s bridge')
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
    tool('fleet_work_list', 'Fleet\'s work queue, compact rows: id, title, state (Waiting = held, Queued, Running, Sent Back, Input Required, Done, Failed, Cancelled; Input Required (needs a person) when the Supervisor gave up on a long Sent Back), sentBackFor (age text, on a Sent Back item), sessionGone (true when its session is not running), source, account, model / effort, its Yozora issue (ref + url), created, note and the Supervisor\'s maintenance verdict on a Waiting item. Use fleet_work_get for one item in full.', {
        state: { type: 'string', enum: [...WORK_FILTERS], description: 'held (Waiting), queued, running, sent_back, input (Input Required), done, failed, cancelled, open (everything not ended) or all. Default open' },
        search: str('Words that must appear in the title, brief or issue ref'),
        limit: { type: 'number', description: 'Most rows (default 40, max 200)' }
    }),
    tool('fleet_work_get', 'One work item in full: the whole brief, stages, shape, issue, session id and link, its parts, the Supervisor\'s latest review of its session, and the maintenance check (verdict, evidence, suggested brief).', {
        id: { type: 'number', description: 'The work item id' }
    }, ['id']),
    tool('fleet_work_update', 'Edit a Waiting, Queued, Failed or Cancelled work item (a running one: claude_session_send). A changed brief is commented on its Yozora issue. Does not start it.', {
        id: { type: 'number', description: 'The work item id' },
        title: str('New title'),
        prompt: str('The whole new brief (replaces the old)'),
        appendNote: str('Text added to the end of the brief'),
        topology: { type: 'string', enum: ['direct', 'surfaces', 'planner', 'auto'], description: 'How it runs' },
        stages: { type: 'object', description: '{ planner?: {engine?, model?, effort?}, workers?: {engine?, model?, effort?} }, merged over the item\'s' },
        account: str('Account name or index, or "auto"'),
        model: str('Model alias or id (Sonnet unless a named reason)'),
        effort: { type: 'string', enum: EFFORTS, description: 'Reasoning effort' },
        remoteControl: { type: 'boolean', description: 'Whether the session starts in Remote Control (default off)' },
        host: { type: 'string', enum: ['misaka', 'dreamscape', 'auto'], description: 'Where the session runs (see claude_dispatch); auto clears it' },
        issues: { type: 'array', items: { type: 'string' }, description: 'The Yozora issues this run covers ("owner/repo#N" or URLs; the first is the primary). Replaces the item\'s issues; an empty list drops all but the primary' }
    }, ['id']),
    tool('fleet_work_start', 'Start Waiting (or failed / cancelled) items: they join the queue and start when a slot and an account with room are free (now: true, the default, ignores the slot limit). Start only what Yukimi asked for or clearly agreed to.', {
        ids: { type: 'array', items: { type: 'number' }, description: 'Work item ids' },
        now: { type: 'boolean', description: 'Past the slot limit too (default true); false waits for a slot' }
    }, ['ids']),
    tool('fleet_work_hold', 'Put queued, failed or cancelled items back to Waiting (held).', {
        ids: { type: 'array', items: { type: 'number' }, description: 'Work item ids' }
    }, ['ids']),
    tool('fleet_work_cancel', 'Cancel Waiting, queued or failed items (a running one is ended from its session). Closes the item\'s Yozora issue, so cancel only what Yukimi asked for or what is clearly done / outdated.', {
        ids: { type: 'array', items: { type: 'number' }, description: 'Work item ids' },
        reason: str('Why (added to the item\'s note and its issue)')
    }, ['ids']),
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
    return { plan: row.plan || '', limits, worstPercent: worst >= 0 ? worst : null, extraUsage: !!row.extraEnabled, readAt: iso(row.at), note: row.error || '' };
}

async function snapshot(gr, opts = {}) {
    const [rc, use] = await Promise.all([fleet().status(gr), usage().read(gr, { force: opts.refresh === true }).catch(() => ({ accounts: [] }))]);
    const byIndex = new Map((use.accounts || []).map((u) => [u.index, u]));
    const accounts = rc.accounts.map((a) => ({
        index: a.index,
        id: a.id,
        name: a.name,
        engineDefault: a.active,
        ownFolder: a.moved,
        onHostLogin: a.onHost,
        remoteControl: { state: a.state, statusLine: a.statusLine, message: a.message },
        canRun: a.hasLogin && (a.moved || a.onHost),
        preferred: !!(a.settings && a.settings.preferred),
        settings: a.settings || null,
        availability: a.availability || null,
        pace: (a.availability && a.availability.pace) || null,
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

/**
 * The account for a dispatch: a named / numbered one, or "auto": among runnable accounts that are free to
 * take work (claudeFleetSettings availability: not exhausted, not past its own max), the preferred one,
 * else the most headroom. allowFull takes a full / capped account anyway.
 */
function pickAccount(snap, want, allowFull) {
    const usable = (a) => !a.availability || a.availability.schedulable !== false;
    const sessionOf = (a) => { const l = a.usage && (a.usage.limits || []).find((x) => x.kind === 'session'); return l && Number.isFinite(l.percent) ? l.percent : (a.usage && Number.isFinite(a.usage.worstPercent) ? a.usage.worstPercent : 50); };
    const worstOf = (a) => (a.usage && Number.isFinite(a.usage.worstPercent) ? a.usage.worstPercent : 50);
    if (want !== undefined && want !== null && String(want).trim() !== '' && String(want).toLowerCase() !== 'auto') {
        const w = String(want).trim().toLowerCase();
        const acc = snap.accounts.find((a) => String(a.index) === w || a.name.toLowerCase() === w) || snap.accounts.find((a) => a.name.toLowerCase().includes(w));
        if (!acc) throw new Error(`No Claude account ${want} (claude_fleet_status lists them)`);
        if (!acc.canRun) throw new Error(`${acc.name} cannot run sessions yet: ${acc.remoteControl.message || 'it needs a linked login and its own folder'}`);
        const worst = acc.usage && acc.usage.worstPercent;
        // an expired login is refused even with allowFull: no session can start on it
        if (acc.availability && acc.availability.state === 'login') throw new Error(`${acc.name}: ${acc.availability.message}. Pick another account`);
        if (!allowFull && !usable(acc)) throw new Error(`${acc.name}: ${acc.availability.message}. Pick another, or pass allowFull`);
        if (!allowFull && Number.isFinite(worst) && worst >= FULL_PCT) throw new Error(`${acc.name} is at ${worst}% of a limit: pick another, or pass allowFull`);
        return acc;
    }
    const runnable = snap.accounts.filter((a) => a.canRun && !(a.availability && a.availability.state === 'login') && (allowFull || (usable(a) && worstOf(a) < FULL_PCT)));
    if (!runnable.length) throw new Error('No Claude account has room (every runnable account is at its limit, past its own max, has an expired login, or cannot run): wait for a reset or pass allowFull');
    // pace (Yukimi Nov 25): an account that used today's share of its week ranks after every one that did not; ahead of pace after ok
    const paceOf = (a) => (a.availability && a.availability.pace) || null;
    const paceState = (a) => { const p = paceOf(a); return p && p.state ? p.state : 'ok'; };
    const paceTier = (a) => ({ over: 2, ahead: 1 }[paceState(a)] || 0);
    const ratio = (a) => { const p = paceOf(a); return p && Number.isFinite(p.ratio) ? p.ratio : 0; };
    const preferred = runnable.find((a) => a.preferred && paceState(a) === 'ok' && (!a.availability || a.availability.state !== 'near'));
    if (preferred) return preferred;
    // an over-share account sits behind all others; within a group: priority (high, normal, low), ahead after ok, the most weekly headroom against its pace, 5-hour %, fewest sessions
    const rank = (a) => ({ high: 0, normal: 1, low: 2 }[(a.settings && a.settings.priority) || 'normal']);
    const group = (a) => (paceState(a) === 'over' ? 1 : 0);
    return runnable.slice().sort((x, y) => group(x) - group(y) || rank(x) - rank(y) || paceTier(x) - paceTier(y) || ratio(x) - ratio(y) || sessionOf(x) - sessionOf(y) || x.sessions.length - y.sessions.length)[0];
}

/** For Fleet's New Session "Auto" and an account's defaults: { index, name, settings }. */
async function pickForStart(gr, want, opts = {}) {
    // a NEW session start (opts.admit, the supervisor's pump) waits while the host is short of memory or swap (#1240);
    // it first removes the scratch of ended sessions, which lives in RAM-backed /tmp, and asks again
    if (opts.admit) {
        const fm = require('./fleetMemory');
        // ended sessions' scratch goes at every start attempt (at most once in 5 min), not only when memory is short
        if (Date.now() - (pickForStart.sweptAt || 0) > 5 * 60000) { pickForStart.sweptAt = Date.now(); try { fm.sweepScratch(); } catch (_) { /* best effort */ } }
        const a = fm.admission();
        if (!a.ok) throw new Error(a.reason);
    }
    const snap = await snapshot(gr);
    const acc = pickAccount(snap, want, false);
    return { index: acc.index, name: acc.name, settings: acc.settings || {} };
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

const issueRef = (w) => (w.issue ? `${w.issue.repo}#${w.issue.number}` : null);
const checkBrief = (c) => (c ? { verdict: c.verdict, at: iso(c.at), note: c.note || '' } : null);

/** "45 min", "2 h 10 min", "2 d 4 h" since a ms timestamp ('' when there is none). */
function ageText(sinceMs, nowMs) {
    const t = Number(sinceMs);
    if (!Number.isFinite(t) || t <= 0) return '';
    const m = Math.max(0, Math.floor(((nowMs || Date.now()) - t) / 60000));
    if (m < 1) return 'under 1 min';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
    return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`;
}
/** The row's state text: parked Input Required reads "(needs a person)". */
const stateText = (w) => (w.state === 'input' && w.parked ? 'Input Required (needs a person)' : STATE_LABEL[w.state] || w.state);
/** Only the extra fields of a Sent Back / session-gone / parked item; nothing for an ordinary row. */
function awaitingFields(w, nowMs) {
    const out = {};
    if (w.state === 'waiting' && w.sentBackAt) { const a = ageText(w.sentBackAt, nowMs); if (a) out.sentBackFor = a; }
    if (w.sessionGone) out.sessionGone = true;
    if (w.state === 'input' && w.parked && w.parkedAt) { const a = ageText(w.parkedAt, nowMs); if (a) out.parkedFor = a; }
    return out;
}

function workRow(w) {
    return Object.assign({
        id: w.id, title: w.title, state: stateText(w), source: w.source, account: w.account || 'auto',
        model: [w.engine && w.engine !== 'claude' ? w.engine : '', w.model, w.effort].filter(Boolean).join(' / '),
        issue: issueRef(w), issueUrl: w.issue ? w.issue.url : null, issues: w.issues && w.issues.length > 1 ? w.issues.map((i) => `${i.repo}#${i.number}`) : undefined, remoteControl: !!w.remoteControl, host: w.host || undefined, parent: w.parentId || undefined, created: iso(w.createdAt),
        note: String(w.message || '').slice(0, 200), check: checkBrief(w.check)
    }, awaitingFields(w));
}

function workDispatch(sup, name, input) {
    if (name === 'fleet_work_list') {
        const want = input.state ? String(input.state) : 'open';
        if (!WORK_FILTERS.includes(want)) throw new Error(`state is one of ${WORK_FILTERS.join(', ')}`);
        const q = String(input.search || '').trim().toLowerCase();
        const lim = Math.max(1, Math.min(200, Number(input.limit) || 40));
        let rows = sup.listWork({ limit: 300 });
        if (want !== 'all') rows = rows.filter((w) => FILTER_STATES[want].includes(w.state));
        if (q) rows = rows.filter((w) => `${w.title}\n${w.prompt}\n${issueRef(w) || ''}\n${w.message}`.toLowerCase().includes(q));
        return { count: rows.length, work: rows.slice(0, lim).map(workRow) };
    }
    if (name === 'fleet_work_get') {
        const w = sup.getWork(input.id);
        if (!w) throw new Error(`No work item ${input.id}`);
        const out = Object.assign(workRow(w), {
            brief: sup.workPrompt(w.id), shape: w.topology, stages: w.stages, engine: w.engine, folder: w.cwd, sessionId: w.sessionId || null, link: w.link || null,
            startedAt: iso(w.startedAt), endedAt: iso(w.endedAt), issueNote: w.issueNote,
            parts: sup.listWork({ limit: 300 }).filter((x) => x.parentId === w.id).map((x) => ({ id: x.id, title: x.title, state: STATE_LABEL[x.state] || x.state, note: String(x.message || '').slice(0, 160) })),
            check: w.check || null
        });
        if (w.sessionId) {
            const rv = sup.listReviews({ limit: 200 }).find((r) => r.sessionId === w.sessionId);
            out.lastReview = rv ? { at: iso(rv.at), verdict: rv.verdict, summary: rv.summary, missed: rv.missed } : null;
        }
        return out;
    }
    if (name === 'fleet_work_update') {
        const f = {};
        ['title', 'prompt', 'appendNote', 'topology', 'stages', 'account', 'model', 'effort', 'remoteControl', 'host', 'issues'].forEach((k) => { if (input[k] !== undefined) f[k] = input[k]; });
        const w = sup.updateWork(input.id, f, { by: 'Yozora' });
        return { item: workRow(w), changed: Object.keys(f) };
    }
    const ids = (Array.isArray(input.ids) ? input.ids : [input.ids]).map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 50);
    if (!ids.length) throw new Error('Which work items? Pass ids');
    const results = ids.map((id) => {
        try {
            let w;
            if (name === 'fleet_work_start') w = sup.startWork(id, { now: input.now !== false });
            else if (name === 'fleet_work_hold') w = sup.holdWork(id);
            else {
                w = sup.cancelWork(id);
                if (input.reason && String(input.reason).trim()) {
                    const why = String(input.reason).trim().slice(0, 300);
                    sup.setWork(id, { message: `Cancelled: ${why}` });
                    if (w.issue) require('./fleetYozora').comment(w.issue.repo, w.issue.number, `**Fleet:** cancelled by Yozora: ${why}`).catch(() => {});
                }
            }
            return { id, ok: true, state: STATE_LABEL[w.state] || w.state };
        } catch (e) { return { id, ok: false, error: e.message }; }
    });
    return { results };
}

/** agent-coord's fleet_status: accounts (usage, Remote Control, sessions), the Supervisor's settings, the queue counts. Compact. */
async function overview(gr) {
    const snap = await snapshot(gr);
    const sup = require('./agentSupervisor');
    const st = sup.settings(gr);
    const counts = {};
    sup.listWork({ limit: 300 }).forEach((w) => { const k = STATE_LABEL[w.state] || w.state; counts[k] = (counts[k] || 0) + 1; });
    return {
        at: snap.at,
        accounts: snap.accounts.map((a) => ({
            name: a.name, plan: a.usage ? a.usage.plan : '', canRun: a.canRun, preferred: a.preferred || undefined,
            usage: a.usage ? a.usage.limits.map((l) => ({ limit: l.label, percent: l.percent, resetsAt: l.resetsAt })) : [],
            extraUsage: a.usage ? a.usage.extraUsage : false, usageNote: a.usage && a.usage.note ? a.usage.note : undefined,
            remoteControl: a.remoteControl.state, rcNote: a.remoteControl.message || undefined,
            sessions: (a.sessions || []).map((s) => ({ id: s.id.slice(0, 8), title: s.title, status: s.status, folder: s.folder }))
        })),
        supervisor: { enabled: st.enabled, engine: st.engine, model: st.model || undefined, delivery: st.delivery, autoStart: st.autoStart, maxConcurrent: st.maxConcurrent },
        queue: counts
    };
}

/** agent-coord's fleet_session_read: state, model / effort / context, the last answer, files edited, claims. Compact. */
async function sessionBrief(gr, ref) {
    const r = await dispatch(gr, 'claude_session_read', { session: ref, messages: 6 });
    const out = { session: r.session, running: r.running, status: r.status, account: r.account, folder: r.folder, task: r.task, model: r.model, edited: r.edited, claims: r.claims };
    const last = (r.messages || []).filter((m) => m.role === 'assistant').pop();
    out.lastAnswer = last ? String(last.text || '').slice(0, 1200) : '';
    try {
        const file = await launcher().findFile(r.session);
        if (file) {
            const i = await require('./claudeInsight').insightOf(file, { busy: r.status === 'busy' });
            out.insight = { model: i.model, effort: i.effort, context: `${i.context.percent}% of ${i.context.window / 1000}k${i.context.windowGuess ? ' (window estimated)' : ''}`, turns: i.turns, now: i.now || undefined, lastTool: i.lastTool, branch: i.branch };
        }
    } catch (_) { /* no transcript yet */ }
    return out;
}

/** agent-coord's fleet_maintenance_report: the last run, one line per check. */
function maintenanceBrief() {
    const last = require('./fleetMaintenance').lastRun();
    if (!last) return { run: null, note: 'No maintenance run yet' };
    return {
        run: last.id, at: iso(last.startedAt), trigger: last.trigger, dryRun: !!last.dryRun, state: last.state, summary: last.summary,
        checks: (last.checks || []).map((c) => ({ id: c.id, state: c.state, summary: String(c.summary || '').slice(0, 240), actions: (c.actions || []).slice(0, 5).map((x) => String(x).slice(0, 160)), findings: (c.findings || []).slice(0, 4).map((f) => String((f && (f.text || f.message)) || f).slice(0, 160)) }))
    };
}

async function dispatch(gr, name, input) {
    if (/^fleet_work_/.test(name)) return workDispatch(require('./agentSupervisor'), name, input);
    if (name === 'claude_fleet_status') return snapshot(gr, { refresh: input.refresh === true });
    if (name === 'claude_dispatch') {
        const prompt = String(input.prompt || '').trim();
        if (!prompt) throw new Error('A dispatch needs a prompt');
        const snap = await snapshot(gr);
        const acc = pickAccount(snap, input.account, input.allowFull === true);
        const cwd = input.cwd ? String(input.cwd) : path.join(__dirname, '..');
        // subagents-sonnet (Yukimi, Nov 24 2026): Sonnet unless a reason is named; an account's own default
        // model (Fleet settings, set by Yukimi) counts as her reason
        const model = input.model ? String(input.model) : ((acc.settings && acc.settings.defaultModel) || 'sonnet');
        if (input.model && !/sonnet/i.test(model) && !String(input.modelReason || '').trim()) {
            throw new Error(`Dispatches start on Sonnet: pass modelReason to use ${model} (undecided design, a bug Sonnet already failed on, a security review, or Yukimi asked)`);
        }
        // Director requests are Supervisor work (Yukimi, Nov 24 2026): queued and started as a supervised Fleet
        // session (steerable from Fleet), now when there is a slot and an account with room
        const sup = require('./agentSupervisor');
        let w = sup.enqueue({
            title: input.title, prompt, cwd, account: input.account && String(input.account).toLowerCase() !== 'auto' ? acc.index : null,
            model: input.engine && input.engine !== 'claude' ? (input.model || undefined) : model, engine: input.engine, effort: input.effort || (acc.settings && acc.settings.defaultEffort) || undefined, startNow: input.startNow === true, source: 'director',
            remoteControl: input.remoteControl === true, issues: input.issues, host: input.host
        }, { gr });
        await sup.pumpWork(gr);
        w = sup.getWork(w.id);
        return {
            work: w.id, state: w.state, session: w.sessionId || null, account: w.account || acc.name, model, effort: w.effort || null,
            link: w.link || '', message: w.message, remoteControl: !!w.remoteControl, issues: w.issues && w.issues.length ? w.issues.map((i) => `${i.repo}#${i.number}`) : undefined,
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
        const { id, live } = resolveSession(input.session);
        const text = String(input.text || '');
        const notRunning = () => Object.assign(new Error('It is not running: pass resume: true to start it again first'), { code: 'NOT_RUNNING' });
        const resumeIt = async () => {
            const snap = await snapshot(gr);
            const acc = pickAccount(snap, input.account, false);
            const r = await launcher().resume(gr, id, { account: acc.index });
            if (r.state === 'failed') throw new Error(r.message || 'It did not start again');
        };
        if (!live) {
            if (input.resume !== true) throw notRunning();
            await resumeIt();
        }
        let resumed = !live;
        let sent;
        try { sent = await launcher().steer(id, text); } catch (e) {
            // a record that says running while its pane holds no claude (#1256): never a quiet "sent"
            if (!(e && e.code === 'NOT_RUNNING')) throw e;
            if (resumed) throw Object.assign(new Error('It was started again but is not ready for a message yet: send again in a moment'), { code: 'NOT_RUNNING' });
            if (input.resume !== true) throw notRunning();
            await resumeIt();
            resumed = true;
            sent = await launcher().steer(id, text);
        }
        return Object.assign({ session: id }, sent);
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
    SCOPE, ROLE, TOOLS, isFleetTool, isFleetOwner, scopesHaveFleet, handleFleetTool, pickForStart,
    overview, sessionBrief, maintenanceBrief, workDispatch, workRow,
    _test: { pickAccount, snapshot, dispatch, workRow, ageText }
};
