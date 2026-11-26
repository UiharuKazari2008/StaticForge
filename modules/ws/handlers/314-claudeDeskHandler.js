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
 *   claude_desk_agent_watch { id, agentId, from?, show? } / claude_desk_agent_unwatch   one background agent's new messages as
 *                                                      claude_desk_agent_append { id, agentId, messages, end }; the list of every running
 *                                                      session's agents is the statusHub feed claude_desk_agents (see below)
 *   claude_desk_session   { action: start | resume | steer | attach | phone_shot | interrupt | screen | disconnect, ... }
 *   claude_desk_coord     { action: list | post | release | device_release, ... }
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
const insight = require('../../claudeInsight');
const runtime = require('../../claudeAccountRuntime');
const coord = require('../../agentCoord/store');
const deviceQueue = require('../../agentCoord/deviceQueue');
const fleetPhoneFeed = require('../../fleetPhoneFeed');

const ADMIN_DESTRUCTIVE = { destructive: true };
const APPEND_TYPE = 'claude_desk_transcript_append';
const TASKS_TYPE = 'claude_desk_tasks';

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
    // a conversation Claude Code handed on to another session id (`continued-in`: sent to the background, a fork)
    // is followed, so a chat open on the old id keeps showing it (claudeSessions.findTranscript)
    const t = claudeSessions._findTranscript(String((row && row.id) || ''));
    return t ? t.file : null;
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

let deskFeed = null;
let phoneFeed = null;
let sessionsWatcher = null;
let pokeTimer = null;

const watchers = () => ((deskFeed && deskFeed.size) || (phoneFeed && phoneFeed.size) || 0);

function armSessionsWatch() {
    if (sessionsWatcher) return;
    const dir = path.join(process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(), '.claude', 'sessions');
    try {
        sessionsWatcher = fs.watch(dir, { persistent: false }, () => {
            if (!watchers()) { try { sessionsWatcher.close(); } catch (_) { /* closed */ } sessionsWatcher = null; return; }
            clearTimeout(pokeTimer);
            pokeTimer = setTimeout(() => { if (deskFeed) deskFeed.poke(); if (phoneFeed && phoneFeed.size) phoneFeed.poke(); if (agentsFeed) agentsFeed.poke(); }, 1200);
        });
        sessionsWatcher.on('error', () => { sessionsWatcher = null; });
    } catch (_) { sessionsWatcher = null; }
}

function titleFor(id) { try { return require('../../sessionTasks').titleFor(id); } catch (_) { return ''; } }

function liveSummary() {
    return claudeSessions.liveSessions().map((s) => ({
        id: s.id, pid: s.pid, name: s.name, title: titleFor(s.id), status: s.status, origin: s.origin, tmuxSession: s.tmuxSession,
        remoteControl: s.remoteControl, link: s.link, cwd: s.cwd, startedAt: s.startedAt,
        // its conversation goes on under another session id: the window shows that one's state (working / idle) for it
        continuedIn: (() => { try { return claudeSessions.continuedInOfSession(s.id) || undefined; } catch (_) { return undefined; } })()
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

// a waiter granted a device from the server side (Release in the window, a session that ended) is told in its terminal
deviceQueue.setNotifier((agent, body) => {
    if (!agent || !agent.sessionId) return '';
    launcher.steer(agent.sessionId, `[steering from agent-coord] ${body}`).catch(() => { /* its inbox holds the message */ });
    return 'tmux';
});

/** The shared test devices (holders, queues; expiry is settled when this is read, on the window's own feed tick). */
function devicesSummary() {
    try { return deviceQueue.status(); } catch (e) { return { devices: [], waiting: 0, holding: 0, error: e.message }; }
}

function coordSummary() {
    try {
        const agents = coord.listAgents().map((a) => ({ id: a.id, kind: a.kind, name: a.name, account: a.account, task: a.task, status: a.status, repo: a.repo, branch: a.branch, sessionId: a.sessionId, claims: a.claims, model: a.model, effort: a.effort, dispatchedBy: a.dispatchedBy, live: a.status !== 'gone' ? ((coord.liveRecord(a) || {}).status || '') : '' }));
        const claims = coord.liveClaims().map((c) => ({ id: c.id, agentId: c.agentId, repo: c.repo, path: c.path, mode: c.mode, note: c.note, expiresAt: c.expiresAt }));
        const last = coord.recentMessages({ limit: 1 })[0];
        const builds = coord.builds({ recent: true }).map(briefBuild);
        return { agents, claims, builds, devices: devicesSummary(), lastMessageId: last ? last.id : 0 };
    } catch (e) {
        return { agents: [], claims: [], builds: [], devices: { devices: [], waiting: 0, holding: 0 }, lastMessageId: 0, error: e.message };
    }
}

let fluxFeed = null;

function defineFeeds() {
    if (deskFeed) return;
    deskFeed = statusHub.define({
        name: 'claude_desk',
        pushType: 'claude_desk_status',
        intervalMs: 30000,
        allow: isAdmin,
        sample: async () => {
            armSessionsWatch();
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
    // a new session title (the Supervisor's or a Fleet-side name) reaches the window through the live list
    try {
        const T = require('../../agentSupervisor').sessionTasks();
        const shown = new Map();
        let phoneTaskPoke = null;
        T.onChange((sid) => {
            const t = T.titleFor(sid);
            if (shown.get(sid) !== t) { shown.set(sid, t); if (deskFeed && deskFeed.size) deskFeed.poke(); }
            // the phone's rows say where each workflow is (the session's current task): any task change, batched
            if (phoneFeed && phoneFeed.size && !phoneTaskPoke) phoneTaskPoke = setTimeout(() => { phoneTaskPoke = null; if (phoneFeed && phoneFeed.size) phoneFeed.poke(); }, 1500);
        });
    } catch (_) { /* no store yet */ }
    // the phone Fleet app's Work Queue page (#1198, modules/fleetPhoneFeed.js)
    phoneFeed = statusHub.define({
        name: 'claude_fleet_phone',
        pushType: 'claude_fleet_phone_status',
        intervalMs: 120000,
        allow: isAdmin,
        sample: () => { armSessionsWatch(); return fleetPhoneFeed.snapshot(gResources, { live: liveSummary() }); }
    });
    fluxFeed = statusHub.define({
        name: 'claude_desk_flux',
        pushType: 'claude_desk_flux',
        intervalMs: 2000,
        allow: isAdmin,
        sample: async () => ({ rc: claudeHost.publicStatus(), login: claudeLogin.status(gResources) })
    });
}

const poke = () => { if (deskFeed) deskFeed.poke(); if (phoneFeed && phoneFeed.size) phoneFeed.poke(); };

// ---------------------------------------------------------------- Supervisor (#1154, modules/agentSupervisor.js)

const supervisor = require('../../agentSupervisor');
const maintenance = require('../../fleetMaintenance');
const usageAudit = require('../../claudeUsageAudit');

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
        // #1236: the refresh (stat + du per folder) runs in the background, single-flight, and is not awaited: the status answers at once with
        // the stored values; when the refresh changed rows it emits { artifacts: true } (onReview -> poke) and the window refetches by itself
        try { supervisor.refreshArtifacts({ budgetMs: 2500 }); artifacts = supervisor.artifactStatus(); } catch (e) { console.warn(`[claudeDesk] artifacts: ${e.message}`); }
    }
    const stats = Object.assign(supervisor.summary(), { artifactBytes: artifacts.filter((a) => a.exists !== false).reduce((n, a) => n + (a.sizeBytes || 0), 0) });
    let gateAsks = [];
    try { gateAsks = coord.open().prepare('SELECT * FROM gate_asks ORDER BY first_at').all().map((r) => ({ agentId: r.agent_id, firstAt: r.first_at, lastAt: r.last_at, text: r.text, stale: !!r.stale, why: r.why || '', askedBy: r.asked_by || '', files: r.files || '' })); } catch (_) { gateAsks = []; }
    // the client update gate's own wait list (scripts/restart-gate.js --client, scripts/client-update.sh): Client Update Waits
    let clientGateAsks = [];
    try { clientGateAsks = coord.open().prepare('SELECT * FROM client_gate_asks ORDER BY first_at').all().map((r) => ({ agentId: r.agent_id, firstAt: r.first_at, lastAt: r.last_at, text: r.text, stale: !!r.stale, why: r.why || '', askedBy: r.asked_by || '', files: r.files || '' })); } catch (_) { clientGateAsks = []; }
    let spend = null;
    try { spend = await Promise.race([supervisor.spend(gr), new Promise((r) => setTimeout(() => r(null), 4000))]); } catch (_) { spend = null; }
    let rules = null;
    try { rules = supervisor.rulesState(); } catch (e) { console.warn(`[claudeDesk] rules: ${e.message}`); }
    let maint = null;
    try { maint = maintenance.state(gr); } catch (e) { console.warn(`[claudeDesk] maintenance: ${e.message}`); }
    return { maintenance: maint, usage: (() => { try { return usageAudit.summary(); } catch (_) { return null; } })(), rules, spend, settings: set, engines: supEnginesWithModels(gr), reviews: supervisor.listReviews({ limit: 80 }), work: supervisor.listWork({ limit: 100 }), holds: supervisor.listHolds(), gateAsks, clientGateAsks, topologies: supervisor.TOPOLOGIES, locks, artifacts, stats };
}

/** Fleet > Usage: the tree for 1 or 7 days; a first read of a big window that takes over 9 s answers "scanning" and finishes in the background. */
async function usageTreeFor(gr, message) {
    const days = Number(message.days) === 7 ? 7 : 1;
    const p = usageAudit.tree({ gr, days });
    let timer = null;
    const r = await Promise.race([p, new Promise((res) => { timer = setTimeout(() => res(null), 9000); })]);
    clearTimeout(timer);
    if (!r) { p.catch(() => {}); return { usage: { rows: [], days, scanning: true } }; }
    return { usage: r, flags: usageAudit.flagsList({ all: true, days: 30 }), summary: usageAudit.summary() };
}

const handleSupervisor = guard('claude_desk_supervisor', async (gr, message) => {
    const action = String(message.action || 'status');
    if (action === 'status') return supervisorStatus(gr);
    if (action === 'save') { await supervisor.saveSettings(gr, message.settings || {}); return supervisorStatus(gr); }
    if (action === 'recheck') return { review: await supervisor.review(String(message.sessionId || ''), 'recheck', { gr }) };
    if (action === 'send') return { review: await supervisor.send(message.reviewId) };
    if (action === 'dismiss') { supervisor.dismiss(message.reviewId); return supervisorStatus(gr); }
    if (action === 'spend') return { spend: await supervisor.spend(gr) };
    if (action === 'usage_tree') return usageTreeFor(gr, message);
    if (action === 'usage_detail') return { detail: await usageAudit.detail(String(message.kind || 'session'), String(message.id || ''), { gr, days: Number(message.days) || 7 }) };
    if (action === 'usage_flags') return { flags: usageAudit.flagsList({ all: message.all === true, days: Number(message.days) || 7 }), summary: usageAudit.summary() };
    if (action === 'usage_ack_all') { usageAudit.ackAll(); poke(); return { flags: usageAudit.flagsList({ all: false, days: 30 }), summary: usageAudit.summary() }; }
    if (action === 'usage_ack') { usageAudit.ack(message.id, message.on); poke(); return { flags: usageAudit.flagsList({ all: false, days: 30 }), summary: usageAudit.summary() }; }
    if (action === 'usage_history') return { history: require('../../claudeUsageHistory').history(message.days) };
    if (action === 'pause') { await supervisor.pauseSession(String(message.sessionId || ''), { mode: message.mode, reason: message.reason, by: 'Fleet' }); return supervisorStatus(gr); }
    if (action === 'resume') { await supervisor.resumeSession(String(message.sessionId || ''), { note: message.note }); return supervisorStatus(gr); }
    if (action === 'enqueue') {
        supervisor.enqueue({ title: message.title, prompt: message.prompt, cwd: message.cwd, account: message.account === 'auto' ? null : message.account, model: message.model, effort: message.effort, engine: message.engine, topology: message.topology, stages: message.stages, issue: message.issue, issues: message.issues, remoteControl: message.remoteControl === true, startNow: message.startNow === true, source: 'fleet' }, { gr });
        return supervisorStatus(gr);
    }
    // work_start / work_hold take one id or ids (several picked in the list); work_start now:false waits for a slot
    const workIds = () => (Array.isArray(message.ids) ? message.ids : [message.id]).filter((x) => x != null).slice(0, 200);
    if (action === 'work_start') { const errs = []; workIds().forEach((i) => { try { supervisor.startWork(i, { now: message.now !== false }); } catch (e) { errs.push(`#${i}: ${e.message}`); } }); return Object.assign(await supervisorStatus(gr), errs.length ? { errors: errs } : {}); }
    if (action === 'manager_set') { await supervisor.saveSettings(gr, { managerSessionId: String(message.sessionId || '') }); return supervisorStatus(gr); }
    if (action === 'work_hold') { const errs = []; workIds().forEach((i) => { try { supervisor.holdWork(i); } catch (e) { errs.push(`#${i}: ${e.message}`); } }); return Object.assign(await supervisorStatus(gr), errs.length ? { errors: errs } : {}); }
    if (action === 'work_update') {
        const f = { prompt: message.prompt };
        if (typeof message.remoteControl === 'boolean') f.remoteControl = message.remoteControl;
        if (message.issues !== undefined) f.issues = message.issues;
        supervisor.updateWork(message.id, f, { by: 'Yukimi (Fleet)' });
        return supervisorStatus(gr);
    }
    // "Queue as one run": the picked requests become one item (answers { work, joined }; the list follows through the status push)
    if (action === 'work_merge') {
        const r = supervisor.mergeWork(workIds(), { title: message.title, remoteControl: message.remoteControl === true, startNow: message.startNow !== false, gr });
        poke();
        return r;
    }
    // the issue picker: open issues of a watched repo (one request, newest first) with the item that carries each
    if (action === 'issues_open') return supervisor.issuesOpen(gr, { repo: message.repo, q: message.q });
    if (action === 'work_cancel') { supervisor.cancelWork(message.id); return supervisorStatus(gr); }
    // Yukimi's answers to an Input Required item: one text per question (empty = keep the Supervisor's proposed answer); the item runs again
    // "Send Back to Work": a done or failed item gets Yukimi's note and runs again
    if (action === 'work_reopen') { await supervisor.reopenWork(message.id, { note: message.note }); poke(); return supervisorStatus(gr); }
    if (action === 'work_answer') { await supervisor.answerWork(message.id, { answers: (Array.isArray(message.answers) ? message.answers : []).slice(0, 12).map((x) => String(x || '')), note: message.note }); poke(); return supervisorStatus(gr); }
    // the global Workflow page (modules/fleetDeps.js): every open job, what runs in parallel, what is in series, what waits on what
    if (action === 'work_graph' || action === 'work_priority' || action === 'work_dep_add' || action === 'work_dep_remove') {
        const deps = require('../../fleetDeps');
        const text = (v) => String(v == null ? '' : v).slice(0, 80);
        if (action === 'work_priority') {
            const p = Math.max(-2, Math.min(2, Math.round(Number(message.priority))));
            if (!Number.isFinite(p)) throw new Error('priority must be a number from -2 to 2');
            deps.setPriority(text(message.id), p);
        } else if (action === 'work_dep_add') {
            if (!message.id || !message.on || String(message.id) === String(message.on)) throw new Error('pick another job to wait for');
            deps.addDep(text(message.id), text(message.on), 'explicit: set in Fleet');
        } else if (action === 'work_dep_remove') {
            deps.removeDep(text(message.id), text(message.on));
        }
        if (action !== 'work_graph') poke();
        return { graph: deps.graph(supervisor.listWork) };
    }
    if (action === 'work_map') return { map: await workMap(gr, { id: message.id, sessionId: message.sessionId }) };
    if (action === 'lock_remove') { supervisor.removeLockFile(String(message.root || ''), String(message.file || '')); poke(); return supervisorStatus(gr); }
    // Clean is a Supervisor review (evidence, engine verdict, trash): it answers at once and the result arrives through the status push
    if (action === 'artifact_clean') {
        const id = message.id;
        supervisor.cleanArtifact(id, { gr }).catch((e) => { console.warn(`[claudeDesk] artifact_clean: ${e.message}`); }).finally(() => poke());
        return { started: true, id };
    }
    if (action === 'artifact_restore') { const r = supervisor.restoreArtifact(message.id); poke(); return Object.assign(await supervisorStatus(gr), { restored: r }); }
    if (action === 'artifact_forget') { supervisor.forgetArtifact(message.id); return supervisorStatus(gr); }
    // Rules > Rules Review: the review runs in the background; its result reaches the console through the status push
    if (action === 'rules_list') return { rules: supervisor.rulesState() };
    if (action === 'rules_text') return { rule: supervisor.ruleText(message.name) };
    if (action === 'rules_review') { supervisor.startRulesReview(gr); return { rules: supervisor.rulesState() }; }
    if (action === 'rules_dismiss') { supervisor.dismissRuleFinding(message.findingId); return { rules: supervisor.rulesState() }; }
    if (action === 'rules_explain') { const proposal = await supervisor.explainRuleIssue(gr, message.text); return { proposal, rules: supervisor.rulesState() }; }
    if (action === 'rules_proposal_accept') { const proposal = await supervisor.acceptRuleProposal(gr, message.id, { text: message.text }); poke(); return { proposal, rules: supervisor.rulesState() }; }
    if (action === 'rules_proposal_reject') { const proposal = supervisor.rejectRuleProposal(message.id, message.reason); return { proposal, rules: supervisor.rulesState() }; }
    if (action === 'rules_finding_accept') { const proposal = await supervisor.acceptRuleFinding(gr, message.findingId, { text: message.text }); poke(); return { proposal, rules: supervisor.rulesState() }; }
    // Fleet > Supervisor > Maintenance: the daily run's report, history, settings; Run Now answers at once, the result arrives through the status push
    if (action === 'maintenance_status') return { maintenance: maintenance.state(gr), report: message.runId ? maintenance.getRun(message.runId) : undefined };
    if (action === 'maintenance_run') { const r = maintenance.runNow({ trigger: 'manual', gr, dryRun: message.dryRun === true ? true : undefined }); return { maintenance: maintenance.state(gr), started: r.started }; }
    if (action === 'maintenance_save') { await maintenance.saveSettings(gr, message.settings || {}); return { maintenance: maintenance.state(gr) }; }
    throw new Error('action must be status, save, maintenance_status, maintenance_run, maintenance_save, recheck, send, dismiss, rules_list, rules_text, rules_review, rules_dismiss, rules_explain, rules_proposal_accept, rules_proposal_reject, rules_finding_accept, pause, resume, enqueue, work_start, work_hold, work_update, work_cancel, work_merge, work_map, work_graph, work_priority, work_dep_add, work_dep_remove, issues_open, lock_remove, artifact_clean, artifact_restore or artifact_forget');
});

// ---------------------------------------------------------------- transcript watches (one per socket)

const watches = new Map(); // ws -> { id, file, end, watcher, timer, send }

function unwatch(ws) {
    const w = watches.get(ws);
    if (!w) return;
    clearTimeout(w.timer);
    try { w.watcher.close(); } catch (_) { /* closed */ }
    if (w.tasksOff) w.tasksOff();
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
                if (ws.readyState !== 1) continue;
                // the insight summary (model, effort, context, turn ...) rides along: the file grew, so it changed
                let ins = null;
                try {
                    const lv = claudeSessions.liveSessions().find((x) => x.id === id);
                    ins = await insight.insightOf(file, { busy: !!(lv && lv.status === 'busy') });
                    if (ins && lv && lv.status === 'busy') ins.agentsNow = await agentsNow(id).catch(() => []);
                } catch (_) { ins = null; }
                if (r.messages.length || ins) handlersCtx.sendToClient(ws, { type: APPEND_TYPE, data: { id, messages: r.messages, end: r.end, insight: ins }, timestamp: new Date().toISOString() });
                // new messages may hold new asks of the user's (read shortly, one model call per batch); the list arrives as claude_desk_tasks
                if (r.messages.length) { try { supervisor.sessionTasks().poke(id); } catch (_) { /* later */ } }
            }
        } catch (_) { /* next change */ } finally { w.reading = false; }
        // the conversation was handed on to another session id (`continued-in`, its last line here): the open chat
        // follows it to the new transcript from its current end
        try {
            const now = await launcher.findFile(id);
            if (now && now !== file && watches.get(ws) === w) {
                const at = (await fs.promises.stat(now)).size;
                await watchTranscript(handlersCtx, ws, id, at, w.view);
            }
        } catch (_) { /* stays on the old file */ }
    };
    w.watcher = fs.watch(file, { persistent: false }, () => { clearTimeout(w.timer); w.timer = setTimeout(flush, 400); });
    w.watcher.on('error', () => unwatch(ws));
    w.view = view || null;
    // the session's task lists and title are pushed to this socket whenever they change (no polling)
    try {
        const T = supervisor.sessionTasks();
        w.tasksOff = T.onChange((sid) => { if (sid === id && ws.readyState === 1) handlersCtx.sendToClient(ws, { type: TASKS_TYPE, data: T.list(id), timestamp: new Date().toISOString() }); });
        T.poke(id, 300);
    } catch (_) { w.tasksOff = null; }
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

// claude_desk_tasks { action: list | add | update | remove | rename, id (session), taskId?, text?, done? }: the two lists of a
// session (modules/sessionTasks.js); the changes come back as the push claude_desk_tasks to the window watching the session
const handleTasks = guard('claude_desk_tasks', async (gr, message) => {
    const T = supervisor.sessionTasks();
    const action = String(message.action || 'list');
    const sid = String(message.id || '');
    const mine = () => { const r = T.list(sid).asks.concat(T.list(sid).tasks).find((x) => x.id === Number(message.taskId)); if (!r) throw new Error('No such task in this session'); return r; };
    if (action === 'add') T.add(sid, message.owner === 'agent' ? 'agent' : 'user', message.text, { by: 'user' });
    else if (action === 'update') { const r = mine(); T.update(r.id, { text: message.text, done: message.done === undefined ? undefined : message.done === true }, 'user'); }
    else if (action === 'remove') T.remove(mine().id);
    else if (action === 'rename') T.setName(sid, message.title);
    else if (action !== 'list') throw new Error('action must be list, add, update, remove or rename');
    if (action === 'list') T.poke(sid, 200);
    return T.list(sid);
});

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
            cwd: message.cwd || path.join(__dirname, '..', '..', '..'), prompt, title: message.title, account, remoteControl: message.remoteControl === true,
            mode: message.mode || defaults.defaultMode, engine: message.engine && message.engine !== 'claude' ? message.engine : undefined,
            model: message.model || (message.engine && message.engine !== 'claude' ? undefined : defaults.defaultModel) || undefined, effort: message.effort || defaults.defaultEffort || undefined
        });
        if (supervised && result && result.id) supervisor.markSupervised(result.id);
        result = Object.assign({ supervised }, result);
    } else if (action === 'resume') {
        result = await launcher.resume(gr, id, { account: message.account, mode: message.mode, title: message.title, model: message.model || undefined, effort: message.effort || undefined });
    } else if (action === 'steer') {
        // a session that is not running (its claude ended) is started again (on an account with room) first, then the message
        // goes in - Fleet and Director never stop at "resume it first" (agentSupervisor.steerResumed)
        try {
            result = await launcher.steer(id, message.text);
        } catch (e) {
            if (!e || e.code !== 'NOT_RUNNING') throw e;
            await supervisor.steerResumed({ session_id: id }, message.text);
            result = { id, sent: true, resumed: true };
        }
    } else if (action === 'attach') {
        // a file the composer attaches (Attach..., paste, drop, a snip): saved per session, the path goes in the steer text
        const att = require('../../claudeDeskAttachments');
        const b64 = String(message.base64 || '');
        if (b64.length > Math.ceil(att.MAX_BYTES * 4 / 3) + 8) throw new Error('The attachment is too large');
        result = att.save(id, { name: message.name, mimeType: message.mimeType, bytes: Buffer.from(b64, 'base64') });
    } else if (action === 'phone_shot') {
        const r = await require('../../claudeDeskAttachments').phoneShot(gr, id, { device: message.device, display: message.display });
        result = r.devices ? { devices: r.devices } : Object.assign({}, r.attachment, r.thumb ? { thumbBase64: r.thumb.toString('base64') } : {});
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
        throw new Error('action must be start, resume, takeover, steer, attach, phone_shot, interrupt, screen, disconnect, detail, agent_page, task_output or command');
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

/** The background agents running now (their meta says unfinished, their file moved in the last 3 minutes): what each is on. */
async function agentsNow(id) {
    const d = await sessionDirs(id);
    const dir = path.join(d.own, 'subagents');
    let names = [];
    try { names = (await fs.promises.readdir(dir)).filter((n) => /^agent-a[0-9a-f]+\.meta\.json$/.test(n)); } catch (_) { return []; }
    const out = [];
    for (const n of names.slice(-40)) {
        const agentId = n.slice('agent-'.length, -'.meta.json'.length);
        try {
            const meta = JSON.parse(await fs.promises.readFile(path.join(dir, n), 'utf8'));
            if (meta.finished === true) continue;
            const file = path.join(dir, `agent-${agentId}.jsonl`);
            const st = await fs.promises.stat(file);
            if (Date.now() - st.mtimeMs > 180000) continue;
            const want = Math.min(st.size, 32 * 1024);
            const fh = await fs.promises.open(file, 'r');
            let tail = '';
            try { const buf = Buffer.alloc(want); await fh.read(buf, 0, want, st.size - want); tail = buf.toString('utf8'); } finally { await fh.close(); }
            let doingText = 'Thinking...';
            const lines = tail.split('\n').reverse();
            for (const l of lines) {
                if (!l.includes('"type":"assistant"') || !l.includes('"tool_use"')) continue;
                try {
                    const o = JSON.parse(l);
                    const b = (o.message.content || []).filter((x) => x && x.type === 'tool_use').pop();
                    if (b) { doingText = insight.doing(b.name, b.input); break; }
                } catch (_) { /* a cut line */ }
            }
            out.push({ agentId, description: String(meta.description || agentId).slice(0, 120), doing: doingText });
        } catch (_) { /* gone */ }
    }
    return out;
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
    // through the spawn helper: a sync git here (and the fork of the whole server for it) blocked the loop (#1236)
    if (!branch && cwd) { try { branch = (await require('../../spawnHelper').execFileText('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 3000 })).trim(); } catch (_) { branch = ''; } }
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
    let ins = null;
    try { ins = await insight.insightOf(d.file, { busy: !!(live && live.status === 'busy') }); } catch (_) { ins = null; }
    if (ins && live && live.status === 'busy') ins.agentsNow = await agentsNow(id).catch(() => []);
    if (ins && !ins.effort && agentRow && agentRow.effort) ins.effort = agentRow.effort;
    return {
        id,
        insight: ins,
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
/** An engine's model ids from its catalog (TokenRouter's pricing list, a provider's /models; both cached), [] when it can't be read in 6 s. */
async function engineModels(gr, e) {
    const within = (p) => Promise.race([p, new Promise((res) => setTimeout(() => res([]), 6000))]).catch(() => []);
    const ids = (list) => (Array.isArray(list) ? list : []).map((m) => (typeof m === 'string' ? m : (m && (m.id || m.model)) || '')).filter(Boolean).slice(0, 300);
    if (!e.ready) return [];
    if (e.id === 'tokenrouter') {
        return ids(await within(require('../../tokenRouterBridge').listModels({ cacheFile: require('path').join(require('os').homedir(), '.local', 'state', 'dreamscape-agents', 'tokenrouter-models.json') })));
    }
    return ids(await within(require('../../customModelProviders').listModels(gr, e.id)));
}

// the Supervisor page's engines with their model lists: read in the background (cached 10 min) so a status never waits on a catalog
const supModelCache = new Map();
function supEnginesWithModels(gr) {
    return supervisor.engines(gr).map((e) => {
        const hit = supModelCache.get(e.id);
        if (e.ready && (!hit || (Date.now() - hit.at > 600000 && !hit.busy))) {
            const slot = hit || { at: 0, models: [] };
            slot.busy = true;
            supModelCache.set(e.id, slot);
            engineModels(gr, e).then((models) => { supModelCache.set(e.id, { at: Date.now(), models }); if (models.length && models.join() !== slot.models.join()) poke(); }).catch(() => { slot.busy = false; });
        }
        return Object.assign({}, e, { models: (hit && hit.models) || [], efforts: supervisor.SUP_EFFORTS });
    });
}

const handleEngines = guard('claude_fleet_engines', async (gr) => {
    const rows = supervisor.engines(gr);
    const lists = await Promise.all(rows.map((e) => engineModels(gr, e)));
    return {
        efforts: supervisor.SUP_EFFORTS,
        engines: [{ id: 'claude', name: 'Claude (the account\'s plan)', defaultModel: 'sonnet', models: ['sonnet', 'opus', 'haiku', 'fable'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], ready: true }]
            .concat(rows.map((e, i) => ({ id: e.id === 'tokenrouter' ? 'tokenrouter' : (String(e.id).startsWith('custom:') ? e.id : `custom:${e.id}`), name: e.name, defaultModel: e.defaultModel, models: lists[i], efforts: supervisor.SUP_EFFORTS, ready: e.ready })))
    };
});

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
    if (action === 'device_release') {
        // an admin frees a device a stuck agent holds; the next in line is granted and told
        const me = deskAgent(clientInfo);
        const freed = deviceQueue.forceRelease(String(message.device || ''), me.name || me.id);
        poke();
        return Object.assign(coordSummary(), { freed });
    }
    if (action === 'build_end') {
        // an admin cancels / ends a gate someone left open (everyone is told)
        const me = deskAgent(clientInfo);
        const ended = coord.adminEndBuild(Number(message.buildId), me.id, message.reason || 'ended from Claude Accounts');
        poke();
        return Object.assign(coordSummary(), { ended });
    }
    throw new Error('action must be list, post, release, inspect, locks, device_release or build_end');
});

// ---------------------------------------------------------------- background agents of the running sessions (live list, one agent's watch)
//
// Every Agent-tool subagent writes <project>/<sessionId>/subagents/agent-<agentId>.jsonl with agent-<agentId>.meta.json
// beside it. Feed claude_desk_agents (statusHub; items keyed `a:<sessionId>:<agentId>`) is read again only when
// fs.watch on a running session's subagents folder fires (debounced) or a session starts / ends (the desk feed's
// live set); its own timer is a slow safety net that runs only while a window is subscribed. The watches are
// closed on the first event after the last window left. claude_desk_agent_watch pushes one agent's new messages
// as claude_desk_agent_append { id, agentId, messages, end } (the same view options as a session chat).

const AGENT_RUN_IDLE_MS = 20 * 60 * 1000; // unfinished and quiet for this long: Idle, not Running
const AGENT_KEEP_DONE_MS = 24 * 3600 * 1000; // finished agents stay in the list this long
const AGENT_MAX_ROWS = 300;
const AGENT_APPEND_TYPE = 'claude_desk_agent_append';
const AGENT_FILE_RE = /^agent-(a[0-9a-f]{8,40})\.meta\.json$/;

const lineCache = new Map(); // file -> { size, lines }
const doneRows = new Map(); // meta path -> row without the session fields (a finished agent never changes)
const modelCache = new Map(); // jsonl path -> model
const ownDirs = new Map(); // session id -> own folder

/** Lines of a transcript, counting only what was appended since the last count. */
async function countLinesSince(file, size) {
    let c = lineCache.get(file);
    if (!c || size < c.size) c = { size: 0, lines: 0 };
    if (size > c.size) {
        const fh = await fs.promises.open(file, 'r');
        try {
            const buf = Buffer.alloc(1024 * 1024);
            let pos = c.size;
            while (pos < size) {
                const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - pos), pos);
                if (!bytesRead) break;
                for (let i = 0; i < bytesRead; i += 1) if (buf[i] === 10) c.lines += 1;
                pos += bytesRead;
            }
            c.size = pos;
        } finally { await fh.close(); }
    }
    lineCache.set(file, c);
    if (lineCache.size > 3000) lineCache.delete(lineCache.keys().next().value);
    return c.lines;
}

/** The model of an agent's last answer (the tail of its transcript), when the meta has none. */
async function modelFromTail(file, size) {
    if (modelCache.has(file)) return modelCache.get(file);
    let model = '';
    try {
        const fh = await fs.promises.open(file, 'r');
        try {
            const len = Math.min(size, 64 * 1024);
            const buf = Buffer.alloc(len);
            await fh.read(buf, 0, len, size - len);
            const all = buf.toString('utf8').match(/"model":"([^"]{1,80})"/g);
            if (all && all.length) model = /"model":"([^"]+)"/.exec(all[all.length - 1])[1];
        } finally { await fh.close(); }
    } catch (_) { model = ''; }
    if (model) { modelCache.set(file, model); if (modelCache.size > 3000) modelCache.delete(modelCache.keys().next().value); }
    return model;
}

/**
 * The background agents of the given sessions ([{ id, title, own }], own = the session's folder beside its transcript)
 * as list rows: running first, then the newest. now / idleMs / keepMs are for tests.
 */
async function buildAgentsList(sessions, opts = {}) {
    const now = opts.now || Date.now();
    const idleMs = opts.idleMs || AGENT_RUN_IDLE_MS;
    const keepMs = opts.keepMs || AGENT_KEEP_DONE_MS;
    const rows = [];
    for (const s of sessions) {
        const dir = path.join(s.own, 'subagents');
        let names = [];
        try { names = (await fs.promises.readdir(dir)).filter((n) => AGENT_FILE_RE.test(n)); } catch (_) { continue; }
        for (const n of names) {
            const metaFile = path.join(dir, n);
            let base = doneRows.get(metaFile);
            if (!base) {
                const agentId = AGENT_FILE_RE.exec(n)[1];
                const jsonl = path.join(dir, `agent-${agentId}.jsonl`);
                let meta = {};
                try { meta = JSON.parse(await fs.promises.readFile(metaFile, 'utf8')); } catch (_) { meta = {}; }
                let js = null;
                try { js = await fs.promises.stat(jsonl); } catch (_) { js = null; }
                base = {
                    agentId,
                    description: String(meta.description || '').replace(/\s+/g, ' ').slice(0, 200) || agentId,
                    type: String(meta.agentType || ''),
                    model: String(meta.model || meta.pickedEffortModel || '') || (js ? await modelFromTail(jsonl, js.size) : ''),
                    finished: meta.finished === true,
                    background: meta.requestShape === 'background',
                    lastActivity: js ? Math.round(js.mtimeMs) : null,
                    messages: js ? await countLinesSince(jsonl, js.size) : 0
                };
                if (base.finished) doneRows.set(metaFile, base);
                if (doneRows.size > 3000) doneRows.delete(doneRows.keys().next().value);
            }
            const last = base.lastActivity || 0;
            if (base.finished && now - last > keepMs) continue;
            const state = supervisor.agentRunState(base.finished, last, now, idleMs); // one rule with the Supervisor's in-flight check
            rows.push(Object.assign({ key: `a:${s.id}:${base.agentId}`, sessionId: s.id, sessionTitle: s.title }, base, { state }));
        }
    }
    const rank = (r) => (r.state === 'running' ? 0 : (r.state === 'idle' ? 1 : 2));
    rows.sort((a, b) => rank(a) - rank(b) || (b.lastActivity || 0) - (a.lastActivity || 0));
    return rows.slice(0, AGENT_MAX_ROWS);
}

async function ownDirOf(id) {
    let own = ownDirs.get(id);
    if (own) return own;
    const file = await launcher.findFile(id);
    if (!file) return null;
    own = path.join(path.dirname(file), id);
    ownDirs.set(id, own);
    if (ownDirs.size > 500) ownDirs.delete(ownDirs.keys().next().value);
    return own;
}

/** The running sessions with their folders (what the agents list covers). */
async function liveSessionFolders() {
    const out = [];
    for (const l of claudeSessions.liveSessions()) {
        const own = await ownDirOf(l.id);
        if (own) out.push({ id: l.id, title: l.givenName || l.name || l.id.slice(0, 8), own });
    }
    return out;
}

let agentsFeed = null;
let agentsPoke = null;
const agentDirWatchers = new Map(); // folder -> fs.FSWatcher

/** fs.watch on the subagents folder (or the session's own folder until that exists) of each running session; closed when no window listens. */
function syncAgentWatches(sessions) {
    const want = new Map(); // folder -> session id
    sessions.forEach((s) => {
        const sub = path.join(s.own, 'subagents');
        want.set(fs.existsSync(sub) ? sub : (fs.existsSync(s.own) ? s.own : ''), s.id);
    });
    want.delete('');
    for (const [dir, w] of agentDirWatchers) if (!want.has(dir)) { try { w.close(); } catch (_) { /* closed */ } agentDirWatchers.delete(dir); }
    want.forEach((sid, dir) => {
        if (agentDirWatchers.has(dir)) return;
        try {
            const w = fs.watch(dir, { persistent: false }, () => {
                supervisor.settleSoon(sid); // a held work item ends when its background agents do
                if (!agentsFeed || !agentsFeed.size) { closeAgentWatches(); return; }
                clearTimeout(agentsPoke);
                agentsPoke = setTimeout(() => { if (agentsFeed) agentsFeed.poke(); }, 700);
            });
            w.on('error', () => { try { w.close(); } catch (_) { /* closed */ } agentDirWatchers.delete(dir); });
            agentDirWatchers.set(dir, w);
        } catch (_) { /* gone */ }
    });
}

function closeAgentWatches() {
    clearTimeout(agentsPoke);
    for (const w of agentDirWatchers.values()) { try { w.close(); } catch (_) { /* closed */ } }
    agentDirWatchers.clear();
}

function defineAgentsFeed() {
    if (agentsFeed) return;
    agentsFeed = statusHub.define({
        name: 'claude_desk_agents',
        pushType: 'claude_desk_agents_status',
        intervalMs: 120000, // a safety net only: changes arrive through fs.watch and the desk feed's live set
        allow: isAdmin,
        sample: async () => {
            const sessions = await liveSessionFolders();
            syncAgentWatches(sessions);
            const rows = await buildAgentsList(sessions);
            const items = {};
            rows.forEach((r) => { items[r.key] = r; });
            return items;
        }
    });
}

// one agent's transcript pushed to the socket that opened it (separate from the session watch: both can be open)
const agentWatches = new Map(); // ws -> { id, agentId, file, end, watcher, timer, reading, view }

function agentUnwatch(ws) {
    const w = agentWatches.get(ws);
    if (!w) return;
    clearTimeout(w.timer);
    try { w.watcher.close(); } catch (_) { /* closed */ }
    agentWatches.delete(ws);
}

async function watchAgent(handlersCtx, ws, id, agentId, from, view) {
    agentUnwatch(ws);
    const file = await subagentFile(id, agentId);
    const st = await fs.promises.stat(file);
    const w = { id, agentId, file, end: Number.isFinite(Number(from)) ? Number(from) : st.size, watcher: null, timer: null, reading: false, view: view || null };
    const flush = async () => {
        if (w.reading || agentWatches.get(ws) !== w) return;
        w.reading = true;
        try {
            for (let i = 0; i < 8; i += 1) {
                const r = await transcript.readSince(file, w.end, { view: w.view });
                if (r.end === w.end) break;
                w.end = r.end;
                if (r.messages.length && ws.readyState === 1) handlersCtx.sendToClient(ws, { type: AGENT_APPEND_TYPE, data: { id, agentId, messages: r.messages, end: r.end }, timestamp: new Date().toISOString() });
            }
        } catch (_) { /* next change */ } finally { w.reading = false; }
    };
    w.watcher = fs.watch(file, { persistent: false }, () => { clearTimeout(w.timer); w.timer = setTimeout(flush, 400); });
    w.watcher.on('error', () => agentUnwatch(ws));
    agentWatches.set(ws, w);
    if (typeof ws.once === 'function') ws.once('close', () => agentUnwatch(ws));
    void flush();
    return { id, agentId, watching: true, end: w.end };
}

// ---------------------------------------------------------------- workflow map (a work item's page and a supervised session's chat)
//
// claude_desk_supervisor work_map { id | sessionId } answers the whole tree in one place: Supervisor -> the sessions of the
// item (and of its surface parts) -> their background agents -> those agents' background tasks (Bash run_in_background, nested
// agents; read from the transcripts by claudeInsight). Nothing is pushed on its own: the client asks again when a push it
// already gets changes something (the work list, the agents feed, a transcript append). The answer is cached ~1.5 s per
// request and every transcript is read incrementally by claudeInsight.

const WM_TTL_MS = 1500;
const WM_AGENT_INSIGHTS = 24;
const wmCache = new Map(); // key -> { at, p }

const wmTokens = (ins) => (ins && ins.tokens ? ins.tokens.input + ins.tokens.output + ins.tokens.cacheWrite : null);
const wmMs = (t) => { const n = Date.parse(t || ''); return Number.isFinite(n) ? n : null; };
const WM_ITEM_STATE = { done: 'done', failed: 'failed', cancelled: 'failed', waiting: 'idle', held: 'idle', queued: 'idle', starting: 'working', running: 'working' };

async function buildWorkMap(gr, ref) {
    const tree = supervisor.workTree(ref);
    const items = tree ? tree.items : [];
    if (!tree && ref.sessionId) items.push({ id: null, title: '', state: 'running', sessionId: String(ref.sessionId), topology: '', message: '' });
    if (!items.length) return { rootId: null, nodes: [] };
    const live = new Map(claudeSessions.liveSessions().map((l) => [l.id, l]));
    let set = {};
    try { set = supervisor.settings(gr) || {}; } catch (_) { set = {}; }
    const nodes = [];
    const sup = { key: 'sup', col: 0, kind: 'supervisor', label: 'Supervisor', model: String(set.model || ''), effort: '', state: 'idle', parent: null };
    nodes.push(sup);
    const sessions = [];
    for (const it of items) {
        const sid = it.sessionId || '';
        const lv = sid ? live.get(sid) : null;
        let ins = null;
        let file = null;
        if (sid) {
            file = await launcher.findFile(sid).catch(() => null);
            if (file) ins = await insight.insightOf(file, { busy: !!(lv && lv.status === 'busy') }).catch(() => null);
        }
        const planning = it.topology === 'auto' && ['starting', 'running'].includes(it.state);
        let state = WM_ITEM_STATE[it.state] || 'idle';
        if (sid && state === 'working' && lv && lv.status !== 'busy') state = 'idle';
        // the session itself is the truth while it runs: a Sent Back item whose session took the notes up is working
        if (sid && lv && lv.status === 'busy' && state !== 'done' && state !== 'failed') state = 'working';
        const startedAt = it.startedAt || wmMs(ins && ins.firstAt);
        const top = items[0] === it;
        nodes.push({
            key: sid ? `s:${sid}` : `i:${it.id}`, col: 1, kind: sid ? 'session' : 'item', label: it.title || (lv && (lv.givenName || lv.name)) || sid.slice(0, 8) || `Item ${it.id}`,
            note: planning ? 'Planning' : [it.topology && it.topology !== 'direct' && top ? `Shape: ${it.topology}` : '', it.parentId ? 'Part' : ''].filter(Boolean).join(' - '),
            model: (ins && ins.model) || it.model || (it.stages && it.stages.planner && it.topology !== 'direct' ? it.stages.planner.model : '') || '', effort: (ins && ins.effort) || it.effort || '',
            state, startedAt, endedAt: state === 'done' || state === 'failed' ? (it.endedAt || wmMs(ins && ins.lastAt)) : null,
            messages: ins ? ins.tokens.messages : 0, tokens: wmTokens(ins), sessionId: sid || null, workId: it.id, parent: 'sup'
        });
        if (sid && file) sessions.push({ id: sid, title: it.title || sid.slice(0, 8), own: path.join(path.dirname(file), sid), key: `s:${sid}`, ins });
    }
    // the sessions' own background Bash commands sit beside their agents
    for (const s of sessions) {
        ((s.ins && s.ins.tasks) || []).filter((t) => t.kind === 'bash').slice(-8).forEach((t) => {
            nodes.push({ key: `t:${s.id}:${t.id}`, col: 2, kind: 'task', label: t.label, state: t.state === 'running' ? 'working' : t.state, startedAt: wmMs(t.startAt), endedAt: wmMs(t.endAt), messages: 0, tokens: null, model: '', effort: '', sessionId: s.id, parent: s.key });
        });
    }
    const rows = await buildAgentsList(sessions);
    let nIns = 0;
    for (const r of rows) {
        const file = path.join(sessions.find((x) => x.id === r.sessionId).own, 'subagents', `agent-${r.agentId}.jsonl`);
        let ins = null;
        if (nIns < WM_AGENT_INSIGHTS) { nIns += 1; ins = await insight.insightOf(file, { sidechain: true, busy: r.state === 'running' }).catch(() => null); }
        const state = r.state === 'running' ? 'working' : (r.state === 'finished' ? 'done' : 'idle');
        const key = `a:${r.sessionId}:${r.agentId}`;
        nodes.push({
            key, col: 2, kind: 'agent', label: r.description, note: r.type, model: r.model || (ins && ins.model) || '', effort: (ins && ins.effort) || '', state,
            startedAt: wmMs(ins && ins.firstAt), endedAt: state === 'done' ? r.lastActivity : null, messages: r.messages, tokens: wmTokens(ins),
            sessionId: r.sessionId, agentId: r.agentId, parent: `s:${r.sessionId}`
        });
        ((ins && ins.tasks) || []).slice(-6).forEach((t) => {
            nodes.push({ key: `t:${r.agentId}:${t.id}`, col: 3, kind: 'task', label: t.label, note: t.kind === 'agent' ? 'Agent' : 'Command', state: t.state === 'running' ? 'working' : t.state, startedAt: wmMs(t.startAt), endedAt: wmMs(t.endAt), messages: 0, tokens: null, model: '', effort: '', sessionId: r.sessionId, parent: key });
        });
    }
    // the Supervisor is working while anything under it is
    if (nodes.some((n) => n.state === 'working' && n.kind !== 'supervisor')) sup.state = 'working';
    else if (items.every((i) => i.state === 'done')) sup.state = 'done';
    return { rootId: tree ? tree.root.id : null, nodes, at: Date.now() };
}

/** work_map with a short cache: one build at a time per request, shared by everyone asking in the same moment. */
function workMap(gr, ref) {
    const key = ref.id != null && ref.id !== '' ? `i:${ref.id}` : `s:${ref.sessionId}`;
    const hit = wmCache.get(key);
    if (hit && Date.now() - hit.at < WM_TTL_MS) return hit.p;
    const p = buildWorkMap(gr, ref);
    wmCache.set(key, { at: Date.now(), p });
    if (wmCache.size > 40) wmCache.delete(wmCache.keys().next().value);
    p.catch(() => wmCache.delete(key));
    return p;
}

const handleAgentWatch = guard('claude_desk_agent_watch', async (gr, message, ws, clientInfo, handlersCtx) => watchAgent(handlersCtx, ws, String(message.id || ''), String(message.agentId || ''), message.from, message.show ? transcript.viewFrom(message.show) : null));
const handleAgentUnwatch = guard('claude_desk_agent_unwatch', async (gr, message, ws) => { agentUnwatch(ws); return { watching: false }; });

function registerPackets(handlersCtx) {
    if (!handlersCtx) return;
    gResources = handlersCtx.globalResources;
    defineFeeds();
    defineAgentsFeed();
    runtime.bind(gResources);
    // config dirs of accounts with parallel sessions: copy rotated logins back; the carry tmux server in its own scope
    setTimeout(() => {
        runtime.armAll(gResources).catch((e) => console.warn(`[claudeDesk] account runtimes: ${e.message}`));
        if (process.env.DREAMSCAPE_CLAUDE_RC_READONLY !== '1') launcher.ensureServer().catch((e) => console.warn(`[claudeDesk] carry tmux server: ${e.message}`));
        // the Supervisor watches every session's turns end (fs.watch on ~/.claude/sessions) and serves agent-coord's check
        if (process.env.DREAMSCAPE_CLAUDE_RC_READONLY !== '1') {
            try { supervisor.start(gResources); supervisor.onReview(() => poke()); usageAudit.start(gResources, supervisor); maintenance.start(gResources); maintenance.onChange(() => { supervisor.emitChange(); poke(); }); } catch (e) { console.warn(`[claudeDesk] supervisor: ${e.message}`); }
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
    reg('claude_desk_agent_watch', handleAgentWatch);
    reg('claude_desk_agent_unwatch', handleAgentUnwatch);
    reg('claude_desk_tasks', handleTasks, ADMIN_DESTRUCTIVE);
    reg('claude_desk_session', handleSession, ADMIN_DESTRUCTIVE);
    reg('claude_desk_coord', handleCoord, ADMIN_DESTRUCTIVE);
    reg('claude_desk_supervisor', handleSupervisor, ADMIN_DESTRUCTIVE);
    reg('claude_fleet_plaud', handlePlaud, ADMIN_DESTRUCTIVE);
    reg('claude_fleet_engines', handleEngines);
}

module.exports = { registerPackets, _handlers: { handleSessions, handleTranscript, handleWatch, handleUnwatch, handleSession, handleCoord, handleSupervisor, handleTasks }, _sessionsPage: sessionsPage, _ownerOf: ownerOf, _buildAgentsList: buildAgentsList, _workMap: buildWorkMap };
