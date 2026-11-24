'use strict';

/**
 * Supervisor (#1154, Yukimi Nov 24 2026: "a separate runner as DeepSeek 4.1 flash (by default unless it's
 * changed to another engine or model) that is used to watch over all sessions and when a turn ends or a
 * session calls it via MCP can double check that the last request + any steering matches what was
 * requested and no work was forgotten along the way or was not addressed").
 *
 * Watches every Claude session on the host (one shared ~/.claude/sessions for every account): when a
 * session's record goes busy -> idle, the turn just ended. The turn is read from its transcript (from the
 * byte offset the last review stopped at, so a transcript is never read again from the start): Yukimi's
 * request, any steering typed while it worked, what it did (tool calls: edits, commands, files) and its
 * final answer. One call to the Supervisor's engine compares them and answers { verdict: ok | gaps |
 * unclear, summary, missed: [{ item, evidence }] }.
 *
 *   engine     config agentSupervisor.engine: 'tokenrouter' (default; its key in Security Center) or a
 *              custom model provider id (customModelProviders.js); model default deepseek/deepseek-v4.1-flash
 *              on TokenRouter, else the provider's own default
 *   delivery   'inbox' (default): a gap is posted to the agent's agent-coord inbox (the unread note on its
 *              next coord call); 'steer': also typed into the session as its next prompt when it runs in
 *              tmux (at most 2 automatic steers in a row per session, so it never loops); 'off': recorded only
 *   MCP        a session asks itself (agent-coord coord_supervisor_check) over a unix socket in the
 *              agent-coord state dir (0600): the same review, answered in the call
 *   store      reviews in the agent-coord DB (supervisor_reviews / supervisor_state), shown in Fleet >
 *              Coordination > Supervisor (claude_desk_supervisor); onReview(fn) tells the console's feed
 *
 * Busy locks (settings.manageLocks, default on; Yukimi Nov 24: "the supervisor also can help by deleting or
 * creating locks for agents if they forget to do so"): after every review, a live session that edited a
 * repo with no .agent-* lock of its own there gets one (.agent-claude-<id8>, planted_by supervisor); a lock
 * whose session is gone, or idle for 30 min with its edits committed and no claims, is removed. A lock no
 * session can be tied to is listed as orphan (removed only from Fleet). Owners come from the agent-coord
 * locks table and from the sessions' own commands that wrote the lock (lock_owners).
 *
 * Work folders and temp files (settings.trackArtifacts, default on): the transcript scan records what
 * commands made (mkdir, git worktree add, writes to /tmp, ~/.cache, other paths outside the repo); after a
 * review the session's are stat'ed (size by du, 2 s cap each); Fleet lists them (live / orphan / gone, total
 * size) and cleans one on request: only under /tmp, /var/tmp, ~/.cache or a git worktree, never a repo, a
 * home dir or ~/.claude. Nothing is deleted on its own.
 *
 * Work queue (Yukimi Nov 24: requests go through the Supervisor - "the director is more of a pretty interface
 * to ask for things to get done and fleet is the down and dirty interface"): a work item (from Fleet's New
 * Session wizard, a Plaud recording, Yozora's claude_dispatch, or an agent's coord_request_work) waits in
 * supervisor_work until there is a slot (settings.maxConcurrent supervised sessions at once, default 3) and
 * an account free to take work (claudeFleetMcp.pickForStart: preferred while free, else most headroom);
 * then it runs as a supervised Fleet session (tmux, Remote Control on, steerable from Fleet). Its state
 * follows the session's reviews: running -> done (a turn ended with nothing missed) / waiting (gaps sent
 * back to it) / failed (it ended with gaps or did not start). autoStart off keeps items queued until Start
 * Now. The queue moves on enqueue, after every review and on every usage read (no timer).
 * Plaud recordings: the Supervisor fetches the notes and the whole transcript (plaudClient; its tools are
 * Yozora's key only) into ~/.local/state/dreamscape-agents/plaud/<id>.md (0600) and the session works
 * from that file.
 *
 * Supervised sessions (Fleet's New Session wizard): gaps are typed into the session whatever the delivery
 * setting (still at most 2 automatic steers in a row).
 *
 * Costs: the sessions dir is watched (fs.watch, 500 ms debounce), never polled; one model call per ended
 * turn that had a request, at most 2 at once, input capped at ~24k characters. Nothing here returns or
 * logs a key.
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const DEFAULT_ENGINE = 'tokenrouter';
const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
const DELIVERIES = ['inbox', 'steer', 'off'];
const MAX_INPUT = 24000;
const MAX_PARALLEL = 2;
const MAX_AUTO_STEERS = 2;
const CALL_TIMEOUT_MS = 90 * 1000;
const STEER_PREFIX = '[Supervisor]';
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function claudeHome() { return process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(); }
const sessionsDir = () => path.join(claudeHome(), '.claude', 'sessions');
function stateDir() { return path.dirname(require('./agentCoord/store').dbPath()); }
function socketPath() { return process.env.AGENT_SUPERVISOR_SOCKET || path.join(stateDir(), 'supervisor.sock'); }
const coord = () => require('./agentCoord/store');

let gResources = null;
const listeners = new Set();
function onReview(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let version = 0; // moves on every change the console shows (reviews, work, locks)
function emit(review) { version += 1; listeners.forEach((fn) => { try { fn(review); } catch (_) { /* a listener */ } }); }

// ---------------------------------------------------------------- settings + engines

function settings(gr) {
    const g = gr || gResources;
    let cfg = {};
    try { cfg = (g && g.getConfig && g.getConfig().agentSupervisor) || {}; } catch (_) { cfg = {}; }
    return {
        enabled: cfg.enabled !== false,
        engine: String(cfg.engine || DEFAULT_ENGINE),
        model: String(cfg.model || ''),
        delivery: DELIVERIES.includes(cfg.delivery) ? cfg.delivery : 'inbox',
        manageLocks: cfg.manageLocks !== false,
        trackArtifacts: cfg.trackArtifacts !== false,
        maxConcurrent: Number.isInteger(cfg.maxConcurrent) && cfg.maxConcurrent >= 1 && cfg.maxConcurrent <= 12 ? cfg.maxConcurrent : 3,
        autoStart: cfg.autoStart !== false
    };
}

async function saveSettings(gr, next) {
    const cur = settings(gr);
    const s = {
        enabled: next.enabled === undefined ? cur.enabled : next.enabled === true,
        engine: next.engine ? String(next.engine).slice(0, 60) : cur.engine,
        model: next.model !== undefined ? String(next.model || '').trim().slice(0, 120) : cur.model,
        delivery: DELIVERIES.includes(next.delivery) ? next.delivery : cur.delivery,
        manageLocks: next.manageLocks === undefined ? cur.manageLocks : next.manageLocks === true,
        trackArtifacts: next.trackArtifacts === undefined ? cur.trackArtifacts : next.trackArtifacts === true,
        maxConcurrent: next.maxConcurrent === undefined ? cur.maxConcurrent : Math.max(1, Math.min(12, Math.round(Number(next.maxConcurrent)) || cur.maxConcurrent)),
        autoStart: next.autoStart === undefined ? cur.autoStart : next.autoStart === true
    };
    if (!engines(gr).some((e) => e.id === s.engine)) throw new Error(`Unknown engine ${s.engine}`);
    await gr.modifyConfig('config').assign(['agentSupervisor'], s);
    return settings(gr);
}

function tokenRouterBase() {
    return String(process.env.TOKENROUTER_BASE_URL || 'https://api.tokenrouter.com').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** TokenRouter plus every custom model provider: { id, name, defaultModel, ready }. */
function engines(gr) {
    const g = gr || gResources;
    const out = [];
    let trKey = '';
    try { trKey = g.getApiKeyManager().getActiveApiKey('tokenrouter') || ''; } catch (_) { trKey = ''; }
    out.push({ id: 'tokenrouter', name: 'TokenRouter', defaultModel: DEFAULT_MODEL, ready: !!trKey });
    try {
        const cmp = require('./customModelProviders');
        cmp.publicList(g).forEach((p) => {
            const row = cmp.lookup(g, p.id);
            out.push({ id: p.id, name: p.name, defaultModel: cmp.preferredModel(row) || '', ready: !!(row && row.apiKey) });
        });
    } catch (_) { /* no providers */ }
    return out;
}

/** { url, key, model, name } for the configured engine (throws when it has no key). */
function endpoint(gr, s) {
    if (s.engine === 'tokenrouter') {
        const key = gr.getApiKeyManager().getActiveApiKey('tokenrouter');
        if (!key) throw new Error('TokenRouter has no API key (Security Center > API keys)');
        return { url: `${tokenRouterBase()}/v1/chat/completions`, key, model: s.model || DEFAULT_MODEL, name: 'TokenRouter' };
    }
    const cmp = require('./customModelProviders');
    const row = cmp.requireReady(gr, s.engine);
    const model = s.model || cmp.preferredModel(row);
    if (!model) throw new Error(`${row.name} has no default model: set one for the Supervisor`);
    return { url: row.chatUrl, key: row.apiKey, model, name: row.name };
}

// ---------------------------------------------------------------- the turn

/** The turn's request, steering, actions and final answer, from transcript messages (claudeTranscript). */
function turnOf(messages) {
    const users = [];
    const actions = [];
    let final = '';
    let lastAssistantText = '';
    messages.forEach((m) => {
        if (m.sidechain) return;
        if (m.role === 'user' && m.kind === 'text' && String(m.text || '').trim()) users.push(String(m.text).trim());
        else if (m.role === 'assistant' && m.kind === 'tool_use') actions.push(`${m.tool || 'tool'}: ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 220)}`);
        else if (m.role === 'assistant' && m.kind === 'text' && String(m.text || '').trim()) lastAssistantText = String(m.text).trim();
    });
    final = lastAssistantText;
    const fromSupervisor = users.length > 0 && users.every((u) => u.startsWith(STEER_PREFIX));
    return { request: users[0] || '', steering: users.slice(1), actions, final, fromSupervisor };
}

function capTurn(t) {
    const cut = (s, n) => (s.length > n ? `${s.slice(0, n)} [...cut]` : s);
    const request = cut(t.request, 8000);
    const steering = t.steering.map((s) => cut(s, 1500)).slice(0, 12);
    let actions = t.actions.slice(-120);
    const final = cut(t.final, 6000);
    let size = request.length + steering.join('').length + final.length;
    const kept = [];
    for (let i = actions.length - 1; i >= 0; i -= 1) {
        if (size + actions[i].length > MAX_INPUT) break;
        size += actions[i].length;
        kept.unshift(actions[i]);
    }
    actions = kept;
    return { request, steering, actions, final, droppedActions: t.actions.length - actions.length };
}

const SYSTEM = [
    'You are the Supervisor for coding agents (Claude Code sessions) working for Yukimi. After a turn you check, from the transcript summary given, whether the agent did EVERYTHING the user asked in the request and in every steering message sent while it worked.',
    'List each concrete thing asked (including small asides, questions to answer, files or checks named, "also ..." items, and changes of direction from steering). For each, decide from the actions and the final answer whether it was done, answered, or explicitly deferred with a reason. A later steering message that cancels or replaces an earlier ask overrides it.',
    'Only report real gaps: an ask that was not done, not answered, or done differently than asked without saying so. Do not report style, quality opinions, or things nobody asked for. Work the agent said it filed as a follow-up issue counts as addressed. If the turn ended with the agent waiting on the user (a question, an approval) that is not a gap.',
    'Answer ONLY a JSON object: {"verdict":"ok"|"gaps"|"unclear","summary":"one sentence","missed":[{"item":"what was asked and not addressed","evidence":"why you think so, quoting the request"}]}. verdict ok means nothing missed; unclear means the summary is not enough to tell.'
].join('\n');

function promptFor(t, meta) {
    return [
        `Session: ${meta.title || meta.sessionId} (account ${meta.account || 'host'})${meta.partial ? ' [the start of this turn was before the Supervisor saw it]' : ''}`,
        '',
        '## Request',
        t.request || '(no request text in this turn)',
        '',
        `## Steering sent while it worked (${t.steering.length})`,
        t.steering.length ? t.steering.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(none)',
        '',
        `## What it did (${t.actions.length} tool calls${t.droppedActions ? `, ${t.droppedActions} earlier ones left out` : ''})`,
        t.actions.join('\n') || '(no tool calls)',
        '',
        '## Its final answer',
        t.final || '(no final text)'
    ].join('\n');
}

let fetchFn = (...a) => fetch(...a);
function _setFetch(fn) { fetchFn = typeof fn === 'function' ? fn : (...a) => fetch(...a); }

async function askModel(gr, s, userText) {
    const ep = endpoint(gr, s);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
    try {
        const res = await fetchFn(ep.url, {
            method: 'POST',
            signal: ctl.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key}` },
            body: JSON.stringify({ model: ep.model, temperature: 0, max_tokens: 6000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userText }] })
        });
        const body = await res.text();
        if (!res.ok) throw new Error(`${ep.name} ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
        const choice = (JSON.parse(body).choices || [])[0] || {};
        const content = (choice.message || {}).content || '';
        const out = Object.assign(parseVerdict(content), { model: ep.model, engine: ep.name });
        if (out.unparsed) {
            // kept for the console: why the answer was not a verdict (cut off, prose, empty)
            out.error = `finish ${choice.finish_reason || '?'}, ${String(content).length} chars: ${String(content).replace(/\s+/g, ' ').slice(0, 300)}`;
            delete out.unparsed;
        }
        return out;
    } finally { clearTimeout(timer); }
}

function parseVerdict(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    let o = null;
    try { o = JSON.parse(raw); } catch (_) {
        const m = /\{[\s\S]*\}/.exec(raw);
        try { o = m ? JSON.parse(m[0]) : null; } catch (__) { o = null; }
    }
    if (!o || typeof o !== 'object') return { verdict: 'unclear', summary: 'The Supervisor\'s answer was not JSON', missed: [], unparsed: true };
    // items as { item, evidence } or plain strings (models do both)
    const missed = (Array.isArray(o.missed) ? o.missed : []).map((x) => (typeof x === 'string' ? { item: x.slice(0, 400), evidence: '' } : { item: String((x && x.item) || '').slice(0, 400), evidence: String((x && x.evidence) || '').slice(0, 600) })).filter((x) => x.item).slice(0, 20);
    let verdict = ['ok', 'gaps', 'unclear'].includes(o.verdict) ? o.verdict : (missed.length ? 'gaps' : 'unclear');
    if (verdict === 'ok' && missed.length) verdict = 'gaps';
    return { verdict, summary: String(o.summary || '').slice(0, 400), missed };
}

// ---------------------------------------------------------------- store (agent-coord DB)

function db() {
    const d = coord().open();
    if (!db.ready || db.ready !== d) {
        d.exec(`
            CREATE TABLE IF NOT EXISTS supervisor_state (
                session_id TEXT PRIMARY KEY, file TEXT, offset INTEGER NOT NULL DEFAULT 0, status TEXT,
                auto_steers INTEGER NOT NULL DEFAULT 0, updated_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS supervisor_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, agent_id TEXT, title TEXT, account TEXT,
                at INTEGER NOT NULL, trigger TEXT NOT NULL, verdict TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                request TEXT NOT NULL DEFAULT '', steering TEXT NOT NULL DEFAULT '[]', missed TEXT NOT NULL DEFAULT '[]',
                model TEXT NOT NULL DEFAULT '', delivered TEXT NOT NULL DEFAULT '', dismissed INTEGER NOT NULL DEFAULT 0, error TEXT
            );
            CREATE INDEX IF NOT EXISTS supervisor_reviews_at ON supervisor_reviews (at);
            CREATE TABLE IF NOT EXISTS supervisor_work (
                id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, prompt TEXT NOT NULL, cwd TEXT, account TEXT,
                model TEXT, effort TEXT, source TEXT NOT NULL DEFAULT 'fleet', source_ref TEXT, state TEXT NOT NULL DEFAULT 'queued',
                session_id TEXT, link TEXT, message TEXT NOT NULL DEFAULT '', start_now INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS supervisor_work_state ON supervisor_work (state);
        `);
        const cols = new Set(d.prepare('PRAGMA table_info(supervisor_state)').all().map((c) => c.name));
        if (!cols.has('supervised')) d.exec('ALTER TABLE supervisor_state ADD COLUMN supervised INTEGER NOT NULL DEFAULT 0');
        db.ready = d;
    }
    return d;
}

function rowReview(r) {
    if (!r) return null;
    const j = (s, d) => { try { return JSON.parse(s); } catch (_) { return d; } };
    return {
        id: r.id, sessionId: r.session_id, agentId: r.agent_id || '', title: r.title || '', account: r.account || '', at: r.at,
        trigger: r.trigger, verdict: r.verdict, summary: r.summary, request: r.request, steering: j(r.steering, []),
        missed: j(r.missed, []), model: r.model, delivered: r.delivered || '', dismissed: !!r.dismissed, error: r.error || ''
    };
}

function listReviews(opts = {}) {
    const lim = Math.max(1, Math.min(200, Number(opts.limit) || 60));
    return db().prepare('SELECT * FROM supervisor_reviews ORDER BY id DESC LIMIT ?').all(lim).map(rowReview);
}
const getReview = (id) => rowReview(db().prepare('SELECT * FROM supervisor_reviews WHERE id = ?').get(Number(id)));

function summary() {
    const d = db();
    const last = d.prepare('SELECT id, at FROM supervisor_reviews ORDER BY id DESC LIMIT 1').get();
    const open = d.prepare("SELECT COUNT(*) n FROM supervisor_reviews WHERE verdict = 'gaps' AND dismissed = 0 AND delivered != 'steer'").get().n;
    const reviewed = d.prepare('SELECT COUNT(*) n FROM supervisor_reviews').get().n;
    const gaps = d.prepare("SELECT COUNT(*) n FROM supervisor_reviews WHERE verdict = 'gaps'").get().n;
    const active = d.prepare("SELECT COUNT(*) n FROM supervisor_work WHERE state IN ('starting','running','waiting')").get().n;
    const queued = d.prepare("SELECT COUNT(*) n FROM supervisor_work WHERE state = 'queued'").get().n;
    return { lastReviewId: last ? last.id : 0, version, open, reviewed, gaps, lastAt: last ? last.at : null, workActive: active, workQueued: queued };
}

function dismiss(id) {
    db().prepare('UPDATE supervisor_reviews SET dismissed = 1 WHERE id = ?').run(Number(id));
    const r = getReview(id);
    emit(r);
    return r;
}

// ---------------------------------------------------------------- reviewing

function liveRecord(sessionId) {
    let names = [];
    try { names = fs.readdirSync(sessionsDir()).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return null; }
    for (const n of names) {
        try {
            const r = JSON.parse(fs.readFileSync(path.join(sessionsDir(), n), 'utf8'));
            if (r && r.sessionId === sessionId) return r;
        } catch (_) { /* next */ }
    }
    return null;
}

function metaFor(sessionId) {
    let agent = null;
    try { agent = coord().resolveAgent(`claude-${sessionId.slice(0, 8)}`); } catch (_) { agent = null; }
    const rec = liveRecord(sessionId);
    let account = agent && agent.account ? agent.account : '';
    if (!account && rec && rec.pid) {
        try {
            const hit = fs.readFileSync(`/proc/${rec.pid}/environ`, 'latin1').split('\0').find((kv) => kv.startsWith('CLAUDE_CONFIG_DIR='));
            if (hit) {
                const dir = path.dirname(hit.slice('CLAUDE_CONFIG_DIR='.length));
                try { account = JSON.parse(fs.readFileSync(path.join(dir, 'fleet.json'), 'utf8')).name || ''; } catch (_) { account = path.basename(dir); }
            } else account = 'host';
        } catch (_) { /* gone */ }
    }
    const title = (agent && agent.name) || (rec && rec.name) || sessionId.slice(0, 8);
    return { sessionId, agentId: agent ? agent.id : `claude-${sessionId.slice(0, 8)}`, title, account, rec };
}

async function transcriptFile(sessionId) {
    return require('./claudeSessionLauncher').findFile(sessionId);
}

/**
 * Reviews a session's latest turn: from the stored offset (or, on a first look, the last 80 messages
 * back to the last request) to the end. trigger: turn-end | mcp | recheck. Answers the stored review.
 */
async function review(sessionId, trigger, opts = {}) {
    if (!SESSION_ID_RE.test(String(sessionId || ''))) throw new Error('A session id');
    const gr = opts.gr || gResources;
    const s = settings(gr);
    const file = await transcriptFile(sessionId);
    if (!file) throw new Error('No transcript for that session');
    const d = db();
    const st = d.prepare('SELECT * FROM supervisor_state WHERE session_id = ?').get(sessionId);
    const transcript = require('./claudeTranscript');
    let messages = [];
    let partial = false;
    let end = 0;
    if (st && st.file === file && st.offset > 0 && trigger !== 'recheck') {
        const r = await transcript.readSince(file, st.offset);
        messages = r.messages || [];
        end = r.end;
        partial = st.status === 'partial';
        // nothing new since the last review (a session that went idle twice): the last turn again
        if (!messages.some((m) => m.role === 'user' && m.kind === 'text')) messages = [];
    }
    if (!messages.length) {
        const page = await transcript.readPage(file, { limit: 120 });
        const all = page.messages || [];
        end = page.end;
        // back to the last request: a user text right after an assistant text answer (or the page start)
        let start = 0;
        for (let i = all.length - 1; i > 0; i -= 1) {
            if (all[i].role === 'user' && all[i].kind === 'text' && !String(all[i].text || '').startsWith(STEER_PREFIX)) {
                const prev = all.slice(0, i).reverse().find((m) => m.role === 'assistant' || (m.role === 'user' && m.kind === 'text'));
                if (!prev || (prev.role === 'assistant' && prev.kind === 'text')) { start = i; break; }
            }
        }
        messages = all.slice(start);
        partial = start === 0 && all.length >= 120;
    }
    const meta = metaFor(sessionId);
    const turn = turnOf(messages);
    const base = { session_id: sessionId, agent_id: meta.agentId, title: meta.title, account: meta.account, at: Date.now(), trigger, request: turn.request.slice(0, 4000), steering: JSON.stringify(turn.steering.map((x) => x.slice(0, 1500)).slice(0, 12)) };
    d.prepare(`INSERT INTO supervisor_state (session_id, file, offset, status, updated_at) VALUES (?, ?, ?, 'seen', ?)
        ON CONFLICT(session_id) DO UPDATE SET file = excluded.file, offset = excluded.offset, status = 'seen', updated_at = excluded.updated_at`).run(sessionId, file, end || 0, Date.now());
    let result;
    if (!turn.request) result = { verdict: 'unclear', summary: 'No request in this turn', missed: [], model: '', skipped: true };
    else {
        try { result = await askModel(gr, s, promptFor(capTurn(turn), Object.assign({ partial }, meta))); } catch (e) { result = { verdict: 'error', summary: e.message.slice(0, 300), missed: [], model: '', error: e.message }; }
    }
    if (result.skipped && trigger === 'turn-end') return null; // nothing asked: no row
    const ins = d.prepare(`INSERT INTO supervisor_reviews (session_id, agent_id, title, account, at, trigger, verdict, summary, request, steering, missed, model, error)
        VALUES (@session_id, @agent_id, @title, @account, @at, @trigger, @verdict, @summary, @request, @steering, @missed, @model, @error)`)
        .run(Object.assign(base, { verdict: result.verdict, summary: result.summary || '', missed: JSON.stringify(result.missed || []), model: result.model || '', error: result.error || null }));
    let rv = getReview(ins.lastInsertRowid);
    if (rv.verdict === 'gaps' && trigger !== 'mcp') rv = await deliver(rv, s, { auto: true, fromSupervisor: turn.fromSupervisor }).catch(() => rv);
    afterTurn(sessionId, s).catch((e) => console.warn(`[supervisor] upkeep ${sessionId.slice(0, 8)}: ${e.message}`));
    try { workAfterReview(rv); } catch (e) { console.warn(`[supervisor] work state: ${e.message}`); }
    emit(rv);
    return rv;
}

function gapText(rv) {
    return `${STEER_PREFIX} Your last turn may have left these unaddressed: ${rv.missed.map((m, i) => `(${i + 1}) ${m.item}`).join(' ')} Please do them now, or say why not.`;
}

/** Sends a gap review to its session: inbox note, and typed in when delivery is steer (or force). */
async function deliver(rv, s, opts = {}) {
    if (!rv || rv.verdict !== 'gaps' || !rv.missed.length) return rv;
    const set = s || settings();
    if (!opts.force && set.delivery === 'off') return rv;
    const d = db();
    let how = '';
    try {
        const me = coord().upsertAgent({ id: 'supervisor', kind: 'other', name: 'Supervisor', task: 'Checks that every turn did what was asked', pid: null });
        // a session that never called agent-coord has no row yet: make it, so the note waits in its inbox
        if (!coord().getAgent(rv.agentId)) coord().upsertAgent({ id: rv.agentId, kind: 'claude', name: rv.title || rv.agentId, sessionId: rv.sessionId, account: rv.account || undefined });
        coord().post(me.id, rv.agentId, gapText(rv).slice(STEER_PREFIX.length + 1), { kind: 'question' });
        how = 'inbox';
    } catch (_) { how = ''; }
    const st = d.prepare('SELECT auto_steers FROM supervisor_state WHERE session_id = ?').get(rv.sessionId) || { auto_steers: 0 };
    const autoSteers = opts.fromSupervisor ? st.auto_steers : 0;
    const supervisedSession = isSupervised(rv.sessionId);
    const wantSteer = opts.force || ((set.delivery === 'steer' || supervisedSession) && autoSteers < MAX_AUTO_STEERS);
    if (wantSteer) {
        try {
            await require('./claudeSessionLauncher').steer(rv.sessionId, gapText(rv));
            how = 'steer';
            if (opts.auto) d.prepare('UPDATE supervisor_state SET auto_steers = ? WHERE session_id = ?').run(autoSteers + 1, rv.sessionId);
        } catch (_) { /* not in tmux (Remote Control's own): the inbox note stands */ }
    } else if (opts.auto && !opts.fromSupervisor) d.prepare('UPDATE supervisor_state SET auto_steers = 0 WHERE session_id = ?').run(rv.sessionId);
    if (how) d.prepare('UPDATE supervisor_reviews SET delivered = ? WHERE id = ?').run(how, rv.id);
    return getReview(rv.id);
}

async function send(id) {
    const rv = getReview(id);
    if (!rv) throw new Error('No such review');
    if (rv.verdict !== 'gaps') throw new Error('Only a review with gaps can be sent');
    const out = await deliver(rv, settings(), { force: true });
    emit(out);
    return out;
}

function markSupervised(sessionId) {
    if (!SESSION_ID_RE.test(String(sessionId || ''))) return;
    db().prepare(`INSERT INTO supervisor_state (session_id, status, supervised, updated_at) VALUES (?, 'seen', 1, ?)
        ON CONFLICT(session_id) DO UPDATE SET supervised = 1`).run(sessionId, Date.now());
}
function isSupervised(sessionId) {
    try { const r = db().prepare('SELECT supervised FROM supervisor_state WHERE session_id = ?').get(String(sessionId)); return !!(r && r.supervised); } catch (_) { return false; }
}

// ---------------------------------------------------------------- work queue

const WORK_STATES = ['queued', 'starting', 'running', 'waiting', 'done', 'failed', 'cancelled'];
const ACTIVE = ['starting', 'running', 'waiting'];

function rowWork(r) {
    if (!r) return null;
    return {
        id: r.id, title: r.title, source: r.source, sourceRef: r.source_ref || '', state: r.state, account: r.account || '', model: r.model || '', effort: r.effort || '',
        cwd: r.cwd || '', sessionId: r.session_id || '', link: r.link || '', message: r.message || '', startNow: !!r.start_now,
        createdAt: r.created_at, startedAt: r.started_at, endedAt: r.ended_at, prompt: String(r.prompt || '').slice(0, 2000)
    };
}
function listWork(opts = {}) {
    const lim = Math.max(1, Math.min(300, Number(opts.limit) || 100));
    return db().prepare("SELECT * FROM supervisor_work ORDER BY CASE WHEN state IN ('queued','starting','running','waiting') THEN 0 ELSE 1 END, id DESC LIMIT ?").all(lim).map(rowWork);
}
const getWork = (id) => rowWork(db().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(Number(id)));
function setWork(id, fields) {
    const keys = Object.keys(fields);
    db().prepare(`UPDATE supervisor_work SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(Object.assign({ id: Number(id) }, fields));
}

const SUPERVISED_NOTE = 'You are a supervised Fleet session: claim files with agent-coord before editing (coord_claim), commit your own work at the end of every turn, open a build gate before any build / restart, and before you say a multi-part request is done call coord_supervisor_check and address what it finds. Work you find that should be done by another session: coord_request_work (startNow when it should start now).';

/** Adds a work item and moves the queue. item: { title, prompt, cwd?, account?, model?, effort?, startNow?, source?, sourceRef? } */
function enqueue(item, opts = {}) {
    const prompt = String(item.prompt || '').trim();
    if (!prompt) throw new Error('A work item needs a prompt');
    if (prompt.length > 60000) throw new Error('That request is too long (60,000 characters at most): put the detail in a file and point to it');
    const src = ['fleet', 'plaud', 'director', 'agent'].includes(item.source) ? item.source : 'fleet';
    if (item.sourceRef) {
        const dup = db().prepare("SELECT id FROM supervisor_work WHERE source_ref = ? AND state NOT IN ('failed','cancelled')").get(String(item.sourceRef));
        if (dup) return Object.assign(getWork(dup.id), { reused: true });
    }
    const title = String(item.title || prompt.split('\n')[0]).replace(/\s+/g, ' ').trim().slice(0, 120) || 'Work';
    const r = db().prepare(`INSERT INTO supervisor_work (title, prompt, cwd, account, model, effort, source, source_ref, state, start_now, created_at, message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, 'Waiting for a slot')`).run(title, prompt, item.cwd || null, item.account !== undefined && item.account !== null ? String(item.account) : null, item.model || null, item.effort || null, src, item.sourceRef || null, item.startNow ? 1 : 0, Date.now());
    const w = getWork(r.lastInsertRowid);
    emit({ work: w });
    pumpWork(opts.gr).catch((e) => console.warn(`[supervisor] queue: ${e.message}`));
    return w;
}

function activeCount() {
    const live = liveSessionsById();
    let n = 0;
    db().prepare(`SELECT id, session_id, state FROM supervisor_work WHERE state IN (${ACTIVE.map(() => '?').join(',')})`).all(...ACTIVE).forEach((w) => {
        if (w.state === 'starting' || (w.session_id && live.has(w.session_id))) n += 1;
        else if (w.session_id) setWork(w.id, { state: 'done', ended_at: Date.now(), message: 'Its session ended' });
    });
    return n;
}

let pumping = null;
/** Starts queued items while there are slots and accounts with room. One pump at a time. */
function pumpWork(gr) {
    if (pumping) return pumping;
    pumping = (async () => {
        const g = gr || gResources;
        if (!g) return 0;
        const set = settings(g);
        let started = 0;
        const queued = db().prepare("SELECT * FROM supervisor_work WHERE state = 'queued' ORDER BY start_now DESC, id").all();
        for (const w of queued) {
            const forced = !!w.start_now;
            if (!set.autoStart && !forced) continue;
            if (!forced && activeCount() >= set.maxConcurrent) { setWork(w.id, { message: `Waiting for a slot (${set.maxConcurrent} supervised sessions at once)` }); continue; }
            let pick;
            try { pick = await require('./claudeFleetMcp').pickForStart(g, w.account || 'auto'); } catch (e) { setWork(w.id, { message: `Waiting for an account with room: ${e.message.slice(0, 160)}` }); continue; }
            setWork(w.id, { state: 'starting', message: `Starting on ${pick.name}`, account: pick.name });
            emit({ work: getWork(w.id) });
            try {
                const st = pick.settings || {};
                const r = await require('./claudeSessionLauncher').start(g, {
                    cwd: w.cwd || path.join(__dirname, '..'), prompt: `${w.prompt}\n\n${SUPERVISED_NOTE}`, title: w.title, account: pick.index,
                    mode: st.defaultMode, model: w.model || st.defaultModel || 'sonnet', effort: w.effort || st.defaultEffort || undefined, dispatchedBy: `Supervisor (${w.source})`
                });
                if (r.state === 'failed') { setWork(w.id, { state: 'failed', ended_at: Date.now(), message: r.message || 'It did not start', session_id: r.id || null }); }
                else {
                    markSupervised(r.id);
                    setWork(w.id, { state: 'running', session_id: r.id, link: r.link || '', started_at: Date.now(), message: `Running on ${pick.name}` });
                    started += 1;
                }
            } catch (e) {
                setWork(w.id, { state: 'failed', ended_at: Date.now(), message: e.message.slice(0, 300) });
            }
            emit({ work: getWork(w.id) });
        }
        return started;
    })().finally(() => { pumping = null; });
    return pumping;
}

/** A work item's session ended a turn: done when nothing was missed, waiting while gaps go back to it. */
function workAfterReview(rv) {
    if (!rv || !rv.sessionId) return;
    const w = db().prepare(`SELECT * FROM supervisor_work WHERE session_id = ? AND state IN (${ACTIVE.map(() => '?').join(',')})`).get(rv.sessionId, ...ACTIVE);
    if (!w) { pumpWork().catch(() => {}); return; }
    if (rv.verdict === 'ok') setWork(w.id, { state: 'done', ended_at: Date.now(), message: rv.summary || 'Done' });
    else if (rv.verdict === 'gaps') setWork(w.id, { state: 'waiting', message: `Gaps sent back: ${rv.missed.map((m) => m.item).join('; ').slice(0, 240)}` });
    else setWork(w.id, { state: 'running', message: rv.summary || 'Turn ended' });
    emit({ work: getWork(w.id) });
    pumpWork().catch(() => {});
}

function startWork(id) {
    const w = getWork(id);
    if (!w) throw new Error('No such work item');
    if (w.state !== 'queued') throw new Error(`It is ${w.state}`);
    setWork(w.id, { start_now: 1 });
    pumpWork().catch(() => {});
    return getWork(w.id);
}

function cancelWork(id) {
    const w = getWork(id);
    if (!w) throw new Error('No such work item');
    if (w.state !== 'queued' && w.state !== 'failed') throw new Error('Only a queued item is cancelled here: end a running one from its session');
    setWork(w.id, { state: 'cancelled', ended_at: Date.now(), message: 'Cancelled' });
    emit({ work: getWork(w.id) });
    return getWork(w.id);
}

// ---------------------------------------------------------------- Plaud recordings into the queue

function plaudDir() { return path.join(stateDir(), 'plaud'); }

/** Notes + the whole transcript of a recording in a private file a session can read. */
async function plaudFile(recordingId) {
    const plaud = require('./plaudClient');
    const rec = await plaud.getRecording(recordingId);
    const parts = [`# ${rec.name || recordingId}`, '', `source plaud:${rec.id || recordingId} · ${rec.startAt ? new Date(rec.startAt).toISOString() : ''} · ${rec.durationMs ? Math.round(rec.durationMs / 60000) : '?'} min`, '', '## Notes', '', typeof rec.notes === 'string' ? rec.notes : JSON.stringify(rec.notes || [], null, 1), '', '## Transcript', ''];
    let offset = 0;
    for (let i = 0; i < 200; i += 1) {
        const t = await plaud.getTranscript(recordingId, { offset });
        parts.push(t.text || '');
        if (t.nextOffset === null || t.nextOffset === undefined) break;
        offset = t.nextOffset;
    }
    fs.mkdirSync(plaudDir(), { recursive: true, mode: 0o700 });
    const file = path.join(plaudDir(), `${String(recordingId).replace(/[^\w-]/g, '_')}.md`);
    fs.writeFileSync(file, parts.join('\n'), { mode: 0o600 });
    return { file, name: rec.name || '', id: String(rec.id || recordingId) };
}

/** One work item per recording; started now when there is room. */
async function intakePlaud(gr, recordingIds) {
    const { plaudActionsPrompt } = require('./plaudActionsPrompt');
    const out = [];
    for (const recId of recordingIds) {
        const dup = db().prepare("SELECT id FROM supervisor_work WHERE source_ref = ? AND state NOT IN ('failed','cancelled')").get(`plaud:${recId}`);
        if (dup) { out.push(Object.assign(getWork(dup.id), { recordingId: recId, reused: true })); continue; }
        const f = await plaudFile(recId);
        const prompt = [
            `Plaud Actions for recording plaud:${f.id}${f.name ? ` (${f.name})` : ''}, from Fleet.`,
            `The recording's notes and its whole transcript are in ${f.file} (read all of it; you do not have the plaud_* tools, this file replaces them).`,
            'Use calendar_list_items / calendar_add_items (Dreamscape MCP) for events and tasks, the Yozora API as `claude` (CLAUDE.md) for issues on every project\'s repo.',
            'Code work that should start now (Yukimi said so, or it blocks something): coord_request_work with startNow true and a complete brief; other code work: an issue (and coord_request_work without startNow only when it is ready to build as written).',
            '',
            plaudActionsPrompt({ id: f.id, name: f.name })
        ].join('\n');
        const w = enqueue({ title: `Plaud: ${f.name || f.id}`, prompt, source: 'plaud', sourceRef: `plaud:${f.id}`, startNow: true }, { gr });
        out.push(Object.assign(w, { recordingId: recId }));
    }
    return out;
}

// ---------------------------------------------------------------- busy locks

const IDLE_UNLOCK_MS = 30 * 60 * 1000;
const lockAgentId = (sessionId) => `claude-${String(sessionId).slice(0, 8)}`;

function liveSessionsById() {
    const m = new Map();
    try { require('./claudeSessions').liveSessions().forEach((x) => m.set(x.id, x)); } catch (_) { /* none */ }
    return m;
}

/** The repo roots worth looking at: every known agent's, plus the Dreamscape repo. */
function repoRoots() {
    const roots = new Set([path.join(__dirname, '..')]);
    try { coord().listAgents({ all: false }).forEach((a) => { const r = coord().repoOf(a.cwd).root; if (r) roots.add(r); }); } catch (_) { /* none */ }
    return [...roots];
}

/** Who a lock file belongs to: the session that planted it (locks table) or wrote / named it (lock_owners). */
function lockOwnerSession(name, root) {
    const d = coord().open();
    const planted = d.prepare('SELECT agent_id, planted_by FROM locks WHERE root = ? AND file = ?').get(root, path.join(root, name));
    if (planted) {
        const a = coord().getAgent(planted.agent_id);
        return { sessionId: a && a.sessionId ? a.sessionId : '', agentId: planted.agent_id, plantedBy: planted.planted_by || 'agent' };
    }
    const row = d.prepare('SELECT session_id FROM lock_owners WHERE name = ? ORDER BY seen_at DESC LIMIT 1').get(name);
    if (row) return { sessionId: row.session_id, agentId: lockAgentId(row.session_id), plantedBy: 'agent' };
    const m = /^\.agent-claude-([0-9a-f]{8})$/.exec(name);
    if (m) return { sessionId: '', agentId: `claude-${m[1]}`, plantedBy: 'unknown' };
    return { sessionId: '', agentId: name.slice('.agent-'.length), plantedBy: 'unknown' };
}

/** Every .agent-* lock in the known repo roots with its owner and state (live / idle / orphan). */
function lockStatus() {
    const live = liveSessionsById();
    const out = [];
    repoRoots().forEach((root) => {
        coord().lockFiles(root).forEach((l) => {
            const o = lockOwnerSession(l.file, root);
            let sess = o.sessionId ? live.get(o.sessionId) : null;
            if (!sess && !o.sessionId) {
                const a = coord().getAgent(o.agentId);
                if (a && a.sessionId) sess = live.get(a.sessionId) || null;
            }
            const agent = coord().getAgent(o.agentId);
            const state = sess ? (sess.status === 'busy' ? 'live' : 'idle') : 'orphan';
            out.push({ file: l.file, root, agentId: o.agentId, agentName: (agent && agent.name) || (sess && sess.name) || o.agentId, sessionId: o.sessionId || (agent && agent.sessionId) || '', state, plantedBy: o.plantedBy, ageMinutes: l.ageMinutes, intent: l.intent, stale: l.stale });
        });
    });
    return out;
}

function removeLockFile(root, file) {
    if (!/^\.agent-[A-Za-z0-9_.-]+$/.test(String(file || ''))) throw new Error('Not a busy lock file');
    if (!repoRoots().includes(root)) throw new Error('Not a repo the Supervisor knows');
    const full = path.join(root, file);
    fs.rmSync(full, { force: true });
    try { coord().open().prepare('DELETE FROM locks WHERE root = ? AND file = ?').run(root, full); } catch (_) { /* none */ }
    return true;
}

/**
 * After a session's turn: plant its lock where it edited without one; remove locks of sessions that are
 * gone, or idle 30 min with their edits committed and no claims.
 */
async function sweepLocks(sessionId) {
    const live = liveSessionsById();
    const store = coord();
    const changed = [];
    // 1. this session: edits in a repo but no lock of its own there
    const sess = live.get(sessionId);
    if (sess && sess.cwd) {
        const { root } = store.repoOf(sess.cwd);
        if (root) {
            let r = null;
            try { r = store.inspect(lockAgentId(sessionId), { limit: 300 }); } catch (_) {
                store.upsertAgent({ id: lockAgentId(sessionId), kind: 'claude', name: sess.givenName || sess.name || sessionId.slice(0, 8), sessionId, cwd: sess.cwd, pid: sess.pid, repo: store.repoOf(sess.cwd).repo });
                try { r = store.inspect(lockAgentId(sessionId), { limit: 300 }); } catch (_) { r = null; }
            }
            const working = r && r.edited.files.some((f) => f.uncommitted);
            const mine = lockStatus().filter((l) => l.root === root && (l.sessionId === sessionId || l.agentId === lockAgentId(sessionId)));
            if (working && !mine.length) {
                const file = store.plantLock(lockAgentId(sessionId), root, (r.agent && r.agent.task) || 'editing (lock planted by the Supervisor: it had none)');
                store.open().prepare("UPDATE locks SET planted_by = 'supervisor' WHERE agent_id = ? AND root = ?").run(lockAgentId(sessionId), root);
                changed.push({ planted: path.basename(file), root });
            }
        }
    }
    // 2. every lock: its session gone, or idle with nothing uncommitted of its own and no claims
    for (const l of lockStatus()) {
        if (!l.sessionId) continue; // not tied to a session: listed as orphan, removed only from Fleet
        const s = live.get(l.sessionId);
        let remove = !s;
        if (s && s.status !== 'busy' && Date.now() - (Number(s.updatedAt) || 0) > IDLE_UNLOCK_MS) {
            let r = null;
            try { r = store.inspect(lockAgentId(l.sessionId), { limit: 300 }); } catch (_) { r = null; }
            remove = !!r && !r.claims.length && !r.edited.files.some((f) => f.uncommitted);
        }
        if (remove) { removeLockFile(l.root, l.file); changed.push({ removed: l.file, root: l.root }); }
    }
    return changed;
}

// ---------------------------------------------------------------- work folders and temp files

const HOME = os.homedir();
const expand = (p, cwd) => {
    let v = String(p || '');
    if (v.startsWith('~/')) v = path.join(HOME, v.slice(2));
    if (!path.isAbsolute(v)) v = cwd ? path.resolve(cwd, v) : '';
    return v ? path.normalize(v) : '';
};
const CLEAN_ROOTS = () => [os.tmpdir(), '/tmp', '/var/tmp', path.join(HOME, '.cache')].map((x) => path.normalize(x) + path.sep);
const NEVER = () => [HOME, path.join(HOME, '.claude'), path.join(HOME, '.secrets'), path.join(HOME, '.config'), path.join(__dirname, '..'), '/', '/tmp', '/var/tmp', path.join(HOME, '.cache')].map((x) => path.normalize(x));

function cleanable(full, kind) {
    if (!full || NEVER().includes(full)) return false;
    if (kind === 'worktree') return true;
    return CLEAN_ROOTS().some((r) => full.startsWith(r) && full.length > r.length + 1) && !full.includes(`${path.sep}.claude${path.sep}`);
}

function duBytes(full) {
    try {
        const out = require('child_process').execFileSync('du', ['-sb', full], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
        return Number(out.split(/\s/)[0]) || 0;
    } catch (_) { return null; }
}

/** Stats a session's artifacts (or the stalest ones), within a time budget. */
function refreshArtifacts(opts = {}) {
    const d = coord().open();
    const rows = opts.sessionId
        ? d.prepare('SELECT * FROM artifacts WHERE session_id = ? AND forgotten = 0').all(opts.sessionId)
        : d.prepare('SELECT * FROM artifacts WHERE forgotten = 0 AND (checked_at IS NULL OR checked_at < ?) ORDER BY COALESCE(checked_at, 0) LIMIT 100').all(Date.now() - 10 * 60 * 1000);
    const until = Date.now() + (opts.budgetMs || 6000);
    const up = d.prepare('UPDATE artifacts SET exists_now = ?, size_bytes = ?, checked_at = ? WHERE id = ?');
    for (const r of rows) {
        if (Date.now() > until) break;
        const full = expand(r.path, r.cwd);
        let st = null;
        try { st = full ? fs.statSync(full) : null; } catch (_) { st = null; }
        up.run(st ? 1 : 0, st ? (st.isDirectory() ? duBytes(full) : st.size) : null, Date.now(), r.id);
    }
}

function artifactStatus() {
    const live = liveSessionsById();
    const d = coord().open();
    const rows = d.prepare('SELECT * FROM artifacts WHERE forgotten = 0 ORDER BY created_at DESC LIMIT 300').all();
    const names = new Map();
    return rows.map((r) => {
        const full = expand(r.path, r.cwd);
        if (!names.has(r.session_id)) { const a = coord().getAgent(lockAgentId(r.session_id)); names.set(r.session_id, (a && a.name) || r.session_id.slice(0, 8)); }
        const exists = r.exists_now === null ? null : !!r.exists_now;
        const state = exists === false ? 'gone' : (live.has(r.session_id) ? 'live' : 'orphan');
        return {
            id: r.id, path: full || r.path, kind: r.kind, sessionId: r.session_id, agentName: names.get(r.session_id), createdAt: r.created_at, cmd: r.cmd,
            exists, sizeBytes: r.size_bytes, checkedAt: r.checked_at, ageHours: Math.round((Date.now() - r.created_at) / 3600000), state,
            cleanable: exists !== false && state !== 'live' && cleanable(full, r.kind)
        };
    });
}

function cleanArtifact(id) {
    const d = coord().open();
    const r = d.prepare('SELECT * FROM artifacts WHERE id = ?').get(Number(id));
    if (!r) throw new Error('No such entry');
    const a = artifactStatus().find((x) => x.id === r.id);
    if (!a || !a.cleanable) throw new Error(a && a.state === 'live' ? 'Its session is still running: let it clean up, or stop it first' : 'Only work folders and temp files under /tmp, /var/tmp, ~/.cache or a git worktree are cleaned from here');
    if (r.kind === 'worktree') {
        const cp = require('child_process');
        try { cp.execFileSync('git', ['-C', a.path, 'worktree', 'remove', '--force', a.path], { timeout: 20000, stdio: 'ignore' }); } catch (e) { throw new Error(`git worktree remove failed: ${e.message.slice(0, 160)}`); }
    } else {
        fs.rmSync(a.path, { recursive: true, force: true });
    }
    d.prepare('UPDATE artifacts SET exists_now = 0, size_bytes = NULL, checked_at = ? WHERE id = ?').run(Date.now(), r.id);
    return { cleaned: a.path, freedBytes: a.sizeBytes || 0 };
}

function forgetArtifact(id) {
    coord().open().prepare('UPDATE artifacts SET forgotten = 1 WHERE id = ?').run(Number(id));
    return true;
}

/** Upkeep after a session's turn: its locks and its work folders. */
async function afterTurn(sessionId, s) {
    const set = s || settings();
    let changed = [];
    if (set.manageLocks) changed = await sweepLocks(sessionId);
    if (set.trackArtifacts) refreshArtifacts({ sessionId, budgetMs: 4000 });
    if (changed.length) emit({ locks: changed });
    return changed;
}

// ---------------------------------------------------------------- watching turns end

const statusBySession = new Map(); // session id -> last status
const queue = [];
let running = 0;
let watcher = null;
let debounce = null;

function pump() {
    while (running < MAX_PARALLEL && queue.length) {
        const job = queue.shift();
        running += 1;
        review(job.sessionId, job.trigger)
            .catch((e) => console.warn(`[supervisor] ${job.sessionId.slice(0, 8)}: ${e.message}`))
            .finally(() => { running -= 1; pump(); });
    }
}

function queueReview(sessionId, trigger) {
    if (queue.some((j) => j.sessionId === sessionId)) return;
    if (queue.length > 50) return;
    queue.push({ sessionId, trigger });
    pump();
}

/** Reads the session records and queues a review for every session that went busy -> idle. */
function scan(first) {
    let names = [];
    try { names = fs.readdirSync(sessionsDir()).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return; }
    const seen = new Set();
    names.forEach((n) => {
        let r = null;
        try { r = JSON.parse(fs.readFileSync(path.join(sessionsDir(), n), 'utf8')); } catch (_) { return; }
        if (!r || !SESSION_ID_RE.test(String(r.sessionId || ''))) return;
        seen.add(r.sessionId);
        const prev = statusBySession.get(r.sessionId);
        const now = String(r.status || '');
        statusBySession.set(r.sessionId, now);
        if (!first && prev === 'busy' && now !== 'busy' && settings().enabled) queueReview(r.sessionId, 'turn-end');
        if (!first && prev === undefined && now === 'busy') markPartial(r.sessionId);
    });
    [...statusBySession.keys()].forEach((id) => { if (!seen.has(id)) statusBySession.delete(id); });
}

/** A session first seen mid-turn: its turn starts before what the Supervisor read. */
function markPartial(sessionId) {
    try { db().prepare("INSERT OR IGNORE INTO supervisor_state (session_id, status, updated_at) VALUES (?, 'partial', ?)").run(sessionId, Date.now()); } catch (_) { /* later */ }
}

// ---------------------------------------------------------------- MCP: a session asks (unix socket)

let sockServer = null;
function serveSocket() {
    const file = socketPath();
    try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); } catch (_) { /* there */ }
    try { fs.unlinkSync(file); } catch (_) { /* none */ }
    sockServer = net.createServer((sock) => {
        let buf = '';
        sock.setEncoding('utf8');
        sock.setTimeout(CALL_TIMEOUT_MS + 15000, () => sock.destroy());
        sock.on('data', async (chunk) => {
            buf += chunk;
            const i = buf.indexOf('\n');
            if (i < 0) { if (buf.length > 4096) sock.destroy(); return; }
            let req = null;
            try { req = JSON.parse(buf.slice(0, i)); } catch (_) { req = null; }
            buf = '';
            let out;
            try {
                if (!req || (req.op !== 'check' && req.op !== 'enqueue')) throw new Error('op must be check or enqueue');
                if (req.op === 'enqueue') {
                    const w = enqueue({ title: req.title, prompt: req.prompt, cwd: req.cwd, model: req.model, effort: req.effort, startNow: req.startNow === true, source: 'agent', sourceRef: req.sourceRef || null });
                    out = { ok: true, work: w };
                } else {
                    if (!settings().enabled) throw new Error('The Supervisor is off (Fleet > Coordination > Supervisor)');
                    out = { ok: true, review: await review(String(req.sessionId || ''), 'mcp') };
                }
            } catch (e) { out = { ok: false, error: e.message }; }
            try { sock.end(`${JSON.stringify(out)}\n`); } catch (_) { /* gone */ }
        });
        sock.on('error', () => {});
    });
    sockServer.on('error', (e) => console.warn(`[supervisor] socket: ${e.message}`));
    sockServer.listen(file, () => { try { fs.chmodSync(file, 0o600); } catch (_) { /* kept */ } });
}

let usageHooked = false;
function bind(gr) {
    if (gr) gResources = gr;
    // queued work starts when an account gets room again
    if (!usageHooked && gResources) { usageHooked = true; try { require('./claudeUsage').onRead(() => { pumpWork().catch(() => {}); }); } catch (_) { usageHooked = false; } }
}

function start(gr) {
    bind(gr);
    if (watcher || process.env.AGENT_SUPERVISOR_DISABLED === '1') return;
    scan(true);
    try {
        watcher = fs.watch(sessionsDir(), { persistent: false }, () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => scan(false), 500);
        });
        watcher.on('error', () => { try { watcher.close(); } catch (_) { /* closed */ } watcher = null; });
    } catch (e) {
        console.warn(`[supervisor] cannot watch ${sessionsDir()}: ${e.message}`);
    }
    serveSocket();
    pumpWork().catch(() => {});
}

function stop() {
    if (watcher) { try { watcher.close(); } catch (_) { /* closed */ } watcher = null; }
    clearTimeout(debounce);
    if (sockServer) { try { sockServer.close(); } catch (_) { /* closed */ } sockServer = null; }
}

module.exports = {
    start, stop, bind, settings, enqueue, pumpWork, listWork, getWork, startWork, cancelWork, intakePlaud, workAfterReview, markSupervised, isSupervised, lockStatus, removeLockFile, sweepLocks, artifactStatus, refreshArtifacts, cleanArtifact, forgetArtifact, afterTurn, saveSettings, engines, review, send, dismiss, listReviews, getReview, summary, onReview, socketPath,
    DEFAULT_ENGINE, DEFAULT_MODEL, STEER_PREFIX,
    _test: { turnOf, capTurn, parseVerdict, promptFor, scan, statusBySession, setFetch: _setFetch, queueReview, queue }
};
