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

function coordSummary() {
    try {
        const agents = coord.listAgents().map((a) => ({ id: a.id, kind: a.kind, name: a.name, account: a.account, task: a.task, status: a.status, repo: a.repo, branch: a.branch, sessionId: a.sessionId, claims: a.claims }));
        const claims = coord.liveClaims().map((c) => ({ id: c.id, agentId: c.agentId, repo: c.repo, path: c.path, mode: c.mode, note: c.note, expiresAt: c.expiresAt }));
        const last = coord.recentMessages({ limit: 1 })[0];
        return { agents, claims, lastMessageId: last ? last.id : 0 };
    } catch (e) {
        return { agents: [], claims: [], lastMessageId: 0, error: e.message };
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
                coord: coordSummary()
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

// ---------------------------------------------------------------- transcript watches (one per socket)

const watches = new Map(); // ws -> { id, file, end, watcher, timer, send }

function unwatch(ws) {
    const w = watches.get(ws);
    if (!w) return;
    clearTimeout(w.timer);
    try { w.watcher.close(); } catch (_) { /* closed */ }
    watches.delete(ws);
}

async function watchTranscript(handlersCtx, ws, id, from) {
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
                const r = await transcript.readSince(file, w.end);
                if (r.end === w.end) break;
                w.end = r.end;
                if (r.messages.length && ws.readyState === 1) handlersCtx.sendToClient(ws, { type: APPEND_TYPE, data: { id, messages: r.messages, end: r.end }, timestamp: new Date().toISOString() });
            }
        } catch (_) { /* next change */ } finally { w.reading = false; }
    };
    w.watcher = fs.watch(file, { persistent: false }, () => { clearTimeout(w.timer); w.timer = setTimeout(flush, 400); });
    w.watcher.on('error', () => unwatch(ws));
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
    if (message.since !== undefined && message.since !== null) return Object.assign({ id: message.id }, await transcript.readSince(file, message.since));
    return Object.assign({ id: message.id }, await transcript.readPage(file, { before: message.before, limit: message.limit }));
});

const handleWatch = guard('claude_desk_watch', async (gr, message, ws, clientInfo, handlersCtx) => watchTranscript(handlersCtx, ws, String(message.id || ''), message.from));
const handleUnwatch = guard('claude_desk_unwatch', async (gr, message, ws) => { unwatch(ws); return { watching: false }; });

const handleSession = guard('claude_desk_session', async (gr, message) => {
    const action = String(message.action || '');
    const id = String(message.id || '');
    let result;
    if (action === 'start') {
        result = await launcher.start(gr, { cwd: message.cwd, prompt: message.prompt, title: message.title, account: message.account, mode: message.mode });
    } else if (action === 'resume') {
        result = await launcher.resume(gr, id, { account: message.account, mode: message.mode, title: message.title });
    } else if (action === 'steer') {
        result = await launcher.steer(id, message.text);
    } else if (action === 'interrupt') {
        result = await launcher.interrupt(id);
    } else if (action === 'screen') {
        result = await launcher.screen(id);
    } else if (action === 'disconnect') {
        result = await claudeSessions.disconnect(id);
    } else {
        throw new Error('action must be start, resume, steer, interrupt, screen or disconnect');
    }
    poke();
    return { result };
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
    throw new Error('action must be list, post or release');
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
}

module.exports = { registerPackets, _handlers: { handleSessions, handleTranscript, handleWatch, handleUnwatch, handleSession, handleCoord }, _sessionsPage: sessionsPage, _ownerOf: ownerOf };
