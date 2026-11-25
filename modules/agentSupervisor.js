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
        // reasoning effort sent to the engine ('' = the engine's own default)
        effort: SUP_EFFORTS.includes(cfg.effort) ? cfg.effort : '',
        delivery: DELIVERIES.includes(cfg.delivery) ? cfg.delivery : 'inbox',
        manageLocks: cfg.manageLocks !== false,
        trackArtifacts: cfg.trackArtifacts !== false,
        maxConcurrent: Number.isInteger(cfg.maxConcurrent) && cfg.maxConcurrent >= 1 && cfg.maxConcurrent <= 12 ? cfg.maxConcurrent : 3,
        autoStart: cfg.autoStart !== false,
        // which sessions it reviews on its own: only supervised ones (work items, sessions started as supervised), or
        // every session (Yukimi, Nov 24 2026: "this is an unsupervised session, why is the Supervisor watching it?")
        reviewScope: cfg.reviewScope === 'all' ? 'all' : 'supervised',
        fallbackEngines: Array.isArray(cfg.fallbackEngines) ? cfg.fallbackEngines.filter((e) => e && e.engine).map((e) => ({ engine: String(e.engine), model: String(e.model || '') })) : [],
        autoPauseOnCollision: cfg.autoPauseOnCollision !== false,
        maxAskMinutes: Number.isFinite(cfg.maxAskMinutes) && cfg.maxAskMinutes >= 1 ? Math.min(240, cfg.maxAskMinutes) : 15,
        yozoraRepos: Array.isArray(cfg.yozoraRepos) ? cfg.yozoraRepos.filter((r) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)) : ['DreamScape/StaticForge']
    };
}

async function saveSettings(gr, next) {
    const cur = settings(gr);
    const s = {
        enabled: next.enabled === undefined ? cur.enabled : next.enabled === true,
        engine: next.engine ? String(next.engine).slice(0, 60) : cur.engine,
        model: next.model !== undefined ? String(next.model || '').trim().slice(0, 120) : cur.model,
        effort: next.effort === undefined ? cur.effort : (SUP_EFFORTS.includes(next.effort) ? next.effort : ''),
        delivery: DELIVERIES.includes(next.delivery) ? next.delivery : cur.delivery,
        manageLocks: next.manageLocks === undefined ? cur.manageLocks : next.manageLocks === true,
        trackArtifacts: next.trackArtifacts === undefined ? cur.trackArtifacts : next.trackArtifacts === true,
        maxConcurrent: next.maxConcurrent === undefined ? cur.maxConcurrent : Math.max(1, Math.min(12, Math.round(Number(next.maxConcurrent)) || cur.maxConcurrent)),
        autoStart: next.autoStart === undefined ? cur.autoStart : next.autoStart === true,
        reviewScope: next.reviewScope === undefined ? cur.reviewScope : (next.reviewScope === 'all' ? 'all' : 'supervised'),
        fallbackEngines: Array.isArray(next.fallbackEngines) ? next.fallbackEngines.filter((e) => e && e.engine).slice(0, 6).map((e) => ({ engine: String(e.engine).slice(0, 60), model: String(e.model || '').slice(0, 120) })) : cur.fallbackEngines,
        autoPauseOnCollision: next.autoPauseOnCollision === undefined ? cur.autoPauseOnCollision : next.autoPauseOnCollision === true,
        maxAskMinutes: next.maxAskMinutes === undefined ? cur.maxAskMinutes : Math.max(1, Math.min(240, Math.round(Number(next.maxAskMinutes)) || cur.maxAskMinutes)),
        yozoraRepos: Array.isArray(next.yozoraRepos) ? next.yozoraRepos.map(String).filter((r) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r)).slice(0, 20) : cur.yozoraRepos
    };
    if (!engines(gr).some((e) => e.id === s.engine)) throw new Error(`Unknown engine ${s.engine}`);
    // the maintenance settings live under the same key (modules/fleetMaintenance.js): assign() replaces the whole object
    try { const m = (gr.getConfig().agentSupervisor || {}).maintenance; if (m) s.maintenance = m; } catch (_) { /* none */ }
    await gr.modifyConfig('config').assign(['agentSupervisor'], s);
    return settings(gr);
}

function tokenRouterBase() {
    return String(process.env.TOKENROUTER_BASE_URL || 'https://api.tokenrouter.com').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** TokenRouter plus every custom model provider: { id, name, defaultModel, ready }. */
const SUP_EFFORTS = ['none', 'low', 'medium', 'high'];

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
        return { url: `${tokenRouterBase()}/v1/chat/completions`, key, model: s.model || DEFAULT_MODEL, name: 'TokenRouter', effort: s.effort || '' };
    }
    const cmp = require('./customModelProviders');
    const row = cmp.requireReady(gr, s.engine);
    const model = s.model || cmp.preferredModel(row);
    if (!model) throw new Error(`${row.name} has no default model: set one for the Supervisor`);
    return { url: row.chatUrl, key: row.apiKey, model, name: row.name, effort: s.effort || '' };
}

// ---------------------------------------------------------------- the turn

/** The turn's request, steering, actions and final answer, from transcript messages (claudeTranscript). */
function turnOf(messages) {
    const users = [];
    const actions = [];
    let final = '';
    let lastAssistantText = '';
    const said = []; // every answer the agent wrote in the turn, not only the last one (it answers steering as it goes)
    messages.forEach((m) => {
        if (m.sidechain) return;
        if (m.role === 'user' && m.kind === 'text' && String(m.text || '').trim()) users.push(String(m.text).trim());
        else if (m.role === 'assistant' && m.kind === 'tool_use') actions.push(`${m.tool || 'tool'}: ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 220)}`);
        else if (m.role === 'assistant' && m.kind === 'text' && String(m.text || '').trim()) { lastAssistantText = String(m.text).trim(); said.push(lastAssistantText); }
    });
    final = lastAssistantText;
    const fromSupervisor = users.length > 0 && users.every((u) => u.startsWith(STEER_PREFIX));
    // the Supervisor's own notes are not asks of the user's: they are checked against the asks they name, not added to them
    const human = users.filter((u) => !u.startsWith(STEER_PREFIX));
    // a turn that only answers the Supervisor's own note is checked against that note (a supervised work item needs it)
    const asks = human.length ? human : users;
    return { request: asks[0] || '', steering: asks.slice(1), actions, final, said: said.slice(0, -1), fromSupervisor };
}

function capTurn(t) {
    const cut = (s, n) => (s.length > n ? `${s.slice(0, n)} [...cut]` : s);
    const request = cut(t.request, 8000);
    const steering = t.steering.map((s) => cut(s, 1500)).slice(0, 12);
    let actions = t.actions.slice(-120);
    const final = cut(t.final, 6000);
    const said = (t.said || []).map((x) => cut(x, 800)).slice(-12);
    let size = request.length + steering.join('').length + final.length;
    const kept = [];
    for (let i = actions.length - 1; i >= 0; i -= 1) {
        if (size + actions[i].length > MAX_INPUT) break;
        size += actions[i].length;
        kept.unshift(actions[i]);
    }
    actions = kept;
    return { request, steering, actions, final, said, droppedActions: t.actions.length - actions.length };
}

const SYSTEM = [
    'You are the Supervisor for coding agents (Claude Code sessions) working for Yukimi. After a turn you check, from the transcript summary given, whether the agent did EVERYTHING the user asked in the request and in every steering message sent while it worked.',
    'List each concrete thing asked (including small asides, questions to answer, files or checks named, "also ..." items, and changes of direction from steering). For each, decide from the actions and the final answer whether it was done, answered, or explicitly deferred with a reason. A later steering message that cancels or replaces an earlier ask overrides it.',
    'Only report real gaps: an ask that was not done, not answered, or done differently than asked without saying so. Do not report style, quality opinions, or things nobody asked for. Work the agent said it filed as a follow-up issue counts as addressed. If the turn ended with the agent waiting on the user (a question, an approval) that is not a gap.',
    'When the request is to build, change or fix something, it is only done with evidence it works: the agent ran tests, a build, the program, or looked at the result, and says what it saw. A build / fix turn that ends without any such evidence is a gap ("not shown to be tested").',
    'Work the agent handed to a background agent or subagent that is still running, and said so (what it does, that it reports back), is in progress, not a gap: the turn ending while it runs is expected. Only report it if the agent never started it or never said so.',
    'Answers along the way count as much as the final one: an ask answered or reported done in any of them is addressed. An agent that says an item was already done earlier (naming the commit, the check or what it saw) has addressed it: do not ask for it again.',
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
        `## What it told the user along the way (${(t.said || []).length})`,
        (t.said || []).length ? t.said.map((x, i) => `${i + 1}. ${x}`).join('\n') : '(nothing before the final answer)',
        '',
        '## Its final answer',
        t.final || '(no final text)'
    ].join('\n');
}

let fetchFn = (...a) => fetch(...a);
function _setFetch(fn) { fetchFn = typeof fn === 'function' ? fn : (...a) => fetch(...a); }

// ---------------------------------------------------------------- one call to the Supervisor's engine
//
// Yukimi, Nov 24 2026: "in plan usage we should also show the supervisor account usage, that being how much money
// it has cost doing its work and account balances, as well as if it has failed over to another account due to no
// longer having funds to keep working". Every call is recorded (supervisor_usage: kind, engine, model, tokens,
// cost when the provider says it); an engine that refuses for money (402, or "insufficient / credit / balance /
// quota" in its answer) hands the call to the next engine with a key (the configured one, then TokenRouter, then
// the ready custom providers), and the failover is recorded with its reason.

const FUNDS_RE = /insufficient|credit|balance|quota|payment|billing|top.?up|exceeded your/i;

function engineChain(gr, s) {
    const chain = [{ engine: s.engine, model: s.model }];
    (Array.isArray(s.fallbackEngines) ? s.fallbackEngines : []).forEach((e) => { if (e && e.engine) chain.push({ engine: e.engine, model: e.model || '' }); });
    engines(gr).filter((e) => e.ready).forEach((e) => chain.push({ engine: e.id, model: '' }));
    const seen = new Set();
    return chain.filter((c) => { const k = `${c.engine}|${c.model || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// TokenRouter's reply carries no cost, so a call is priced from the gateway's catalog (USD per million tokens, the
// same list the model picker shows; saved in tokenrouter-models.json, so no request is made here).
let priceCache = { at: 0, byId: null };
const resetPrices = () => { priceCache = { at: 0, byId: null }; };
function catalogPrice(model) {
    if (!priceCache.byId || Date.now() - priceCache.at > 600000) {
        const byId = new Map();
        try {
            const j = JSON.parse(fs.readFileSync(process.env.DREAMSCAPE_TOKENROUTER_CATALOG || path.join(os.homedir(), '.local', 'state', 'dreamscape-agents', 'tokenrouter-models.json'), 'utf8'));
            (j.families || []).forEach((f) => { if (f && f.id && Number.isFinite(f.input) && Number.isFinite(f.output)) byId.set(f.id, f); });
        } catch (_) { /* no catalog saved yet: nothing to price with */ }
        priceCache = { at: Date.now(), byId };
    }
    return priceCache.byId.get(model) || null;
}
/** USD for one call from the catalog price, or null when the engine/model has none. */
function priceCall(engine, model, promptTokens, completionTokens) {
    if (engine !== 'tokenrouter' || !(promptTokens || completionTokens)) return null;
    const p = catalogPrice(model);
    return p ? ((Number(promptTokens) || 0) * p.input + (Number(completionTokens) || 0) * p.output) / 1e6 : null;
}

function recordUsage(row) {
    try {
        db().prepare(`INSERT INTO supervisor_usage (at, kind, engine, model, prompt_tokens, completion_tokens, cost, ok, error, failover_from)
            VALUES (@at, @kind, @engine, @model, @prompt_tokens, @completion_tokens, @cost, @ok, @error, @failover_from)`).run(Object.assign({ at: Date.now(), prompt_tokens: null, completion_tokens: null, cost: null, error: null, failover_from: null }, row));
    } catch (e) { console.warn(`[supervisor] usage not recorded: ${e.message}`); }
}

/** messages -> { content, finish, engine, model }; records usage; fails over on a money refusal. */
async function callEngine(gr, messages, opts = {}) {
    const s = settings(gr);
    const chain = engineChain(gr, s);
    let lastErr = null;
    let from = null;
    for (const link of chain) {
        let ep;
        try { ep = endpoint(gr, Object.assign({}, s, link)); } catch (e) { lastErr = e; continue; }
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
        try {
            const res = await fetchFn(ep.url, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key}` }, body: JSON.stringify(Object.assign({ model: ep.model, temperature: 0, max_tokens: opts.maxTokens || 6000, response_format: { type: 'json_object' }, messages }, ep.effort ? { reasoning_effort: ep.effort } : {})) });
            const body = await res.text();
            if (!res.ok) {
                const msg = `${ep.name} ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`;
                const funds = res.status === 402 || (res.status >= 400 && FUNDS_RE.test(body));
                recordUsage({ kind: opts.kind || 'call', engine: link.engine, model: ep.model, ok: 0, error: msg.slice(0, 300), failover_from: from });
                lastErr = new Error(msg);
                if (funds) { from = link.engine; continue; }   // out of money: the next engine
                throw lastErr;
            }
            const j = JSON.parse(body);
            const u = j.usage || {};
            const cost = Number.isFinite(Number(u.cost)) ? Number(u.cost) : (Number.isFinite(Number(u.total_cost)) ? Number(u.total_cost) : null);
            recordUsage({ kind: opts.kind || 'call', engine: link.engine, model: ep.model, prompt_tokens: u.prompt_tokens || null, completion_tokens: u.completion_tokens || null, cost: cost !== null ? cost : priceCall(link.engine, ep.model, u.prompt_tokens, u.completion_tokens), ok: 1, failover_from: from });
            const choice = (j.choices || [])[0] || {};
            return { content: (choice.message || {}).content || '', finish: choice.finish_reason, engine: ep.name, model: ep.model, failedOverFrom: from };
        } finally { clearTimeout(timer); }
    }
    throw lastErr || new Error('No Supervisor engine has a key');
}

/** What the Supervisor spent and what its engines hold (Fleet's Plan Usage). */
async function spend(gr) {
    const d = db();
    const now = Date.now();
    const windows = { today: now - (now % 86400000), week: now - 7 * 86400000, month: now - 30 * 86400000 };
    const out = {};
    try {   // calls recorded before the catalog price was used: price them now
        const upd = d.prepare('UPDATE supervisor_usage SET cost = ? WHERE id = ?');
        d.prepare("SELECT id, engine, model, prompt_tokens, completion_tokens FROM supervisor_usage WHERE ok = 1 AND cost IS NULL AND engine = 'tokenrouter' AND (prompt_tokens > 0 OR completion_tokens > 0)").all()
            .forEach((r) => { const c = priceCall(r.engine, r.model, r.prompt_tokens, r.completion_tokens); if (c !== null) upd.run(c, r.id); });
    } catch (e) { console.warn(`[supervisor] backfill prices: ${e.message}`); }
    for (const [k, since] of Object.entries(windows)) {
        out[k] = d.prepare(`SELECT engine, COUNT(*) calls, SUM(ok) ok, SUM(COALESCE(prompt_tokens,0)) prompt, SUM(COALESCE(completion_tokens,0)) completion,
            SUM(cost) cost, SUM(CASE WHEN ok = 1 AND cost IS NULL THEN 1 ELSE 0 END) unpriced FROM supervisor_usage WHERE at >= ? GROUP BY engine ORDER BY calls DESC`).all(since);
    }
    const unpricedWhy = d.prepare('SELECT engine, model, COUNT(*) calls FROM supervisor_usage WHERE ok = 1 AND cost IS NULL AND at >= ? GROUP BY engine, model ORDER BY calls DESC LIMIT 5').all(windows.month);
    const lastOk = d.prepare('SELECT engine, model, at FROM supervisor_usage WHERE ok = 1 ORDER BY id DESC LIMIT 1').get();
    const failovers = d.prepare('SELECT at, failover_from AS fromEngine, engine AS toEngine, kind FROM supervisor_usage WHERE failover_from IS NOT NULL AND ok = 1 ORDER BY id DESC LIMIT 10').all();
    const lastRefusal = d.prepare('SELECT at, engine, error FROM supervisor_usage WHERE ok = 0 ORDER BY id DESC LIMIT 1').get();
    let balances = [];
    try {
        const w = await require('./walletStatus').getWalletStatus(gr, {});
        const rows = [];
        if (w && w.tokenrouter) rows.push(Object.assign({ engine: 'tokenrouter', name: 'TokenRouter' }, pickBalance(w.tokenrouter)));
        (w && Array.isArray(w.custom) ? w.custom : []).forEach((c) => rows.push(Object.assign({ engine: c.engine || `custom:${c.id}`, name: c.name || c.id }, pickBalance(c))));
        const mine = new Set(engineChain(gr, settings(gr)).map((c) => c.engine));
        balances = rows.filter((r) => mine.has(r.engine) || mine.has(r.engine.replace(/^custom:/, '')));
    } catch (e) { balances = [{ engine: '', name: 'Balances', error: e.message }]; }
    const s = settings(gr);
    return { configured: { engine: s.engine, model: s.model || '' }, active: lastOk || null, failedOver: !!(lastOk && failovers[0] && failovers[0].at === lastOk.at) || (lastOk && lastOk.engine !== s.engine), failovers, lastRefusal: lastRefusal || null, windows: out, unpricedWhy, balances };
}
function pickBalance(x) {
    return { balance: x.balance !== undefined ? x.balance : (x.remaining !== undefined ? x.remaining : null), balanceText: x.balanceText || x.text || '', currency: x.currency || '', state: x.state || '', title: x.title || '' };
}

async function askModel(gr, s, userText) {
    {
        const r = await callEngine(gr, [{ role: 'system', content: SYSTEM }, { role: 'user', content: userText }], { kind: 'review' });
        const ep = { name: r.engine, model: r.model };
        const choice = { finish_reason: r.finish };
        const content = r.content;
        const out = Object.assign(parseVerdict(content), { model: ep.model, engine: ep.name, failedOverFrom: r.failedOverFrom || undefined });
        if (out.unparsed) {
            // kept for the console: why the answer was not a verdict (cut off, prose, empty)
            out.error = `finish ${choice.finish_reason || '?'}, ${String(content).length} chars: ${String(content).replace(/\s+/g, ' ').slice(0, 300)}`;
            delete out.unparsed;
        }
        return out;
    }
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
            CREATE TABLE IF NOT EXISTS supervisor_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, engine TEXT NOT NULL, model TEXT,
                prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL, ok INTEGER NOT NULL, error TEXT, failover_from TEXT
            );
            CREATE INDEX IF NOT EXISTS supervisor_usage_at ON supervisor_usage (at);
            CREATE TABLE IF NOT EXISTS supervisor_holds (
                id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, mode TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
                by_who TEXT NOT NULL DEFAULT '', pids TEXT NOT NULL DEFAULT '[]', at INTEGER NOT NULL, ended_at INTEGER, kind TEXT NOT NULL DEFAULT 'manual', paths TEXT NOT NULL DEFAULT '[]'
            );
        `);
        const wcols = new Set(d.prepare('PRAGMA table_info(supervisor_work)').all().map((c) => c.name));
        if (!wcols.has('engine')) d.exec("ALTER TABLE supervisor_work ADD COLUMN engine TEXT NOT NULL DEFAULT 'claude'");
        [['issue_repo', 'TEXT'], ['issue_number', 'INTEGER'], ['issue_id', 'INTEGER'], ['issue_note', 'TEXT'], ['topology', 'TEXT'], ['stages', 'TEXT'], ['parent_id', 'INTEGER'], ['check_json', 'TEXT']].forEach(([c, t]) => { if (!wcols.has(c)) d.exec(`ALTER TABLE supervisor_work ADD COLUMN ${c} ${t}`); });
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
    // an unsupervised session is reviewed only when it asks (coord_supervisor_check) or someone re-checks it
    if (trigger === 'turn-end' && s.reviewScope !== 'all' && !isSupervised(sessionId)) return null;
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
    // the session went on working while it was reviewed (a new message, a queued one): its turn is not over, so the
    // gaps are not sent; its next turn end is reviewed again (Nov 24 2026: notes typed into a session mid-turn)
    if (!opts.force) { const live = liveSessionsById().get(rv.sessionId); if (live && live.status === 'busy') return rv; }
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
    const wantSteer = opts.force || (supervisedSession && (set.delivery === 'steer' || set.delivery === 'inbox') && autoSteers < MAX_AUTO_STEERS);
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

// held: waiting for Yukimi to pick it (the default for new and imported items, Nov 24 2026); queued: start when a slot is free
const WORK_STATES = ['held', 'queued', 'starting', 'running', 'waiting', 'done', 'failed', 'cancelled'];
const ACTIVE = ['starting', 'running', 'waiting'];

function rowWork(r) {
    if (!r) return null;
    return {
        id: r.id, title: r.title, engine: r.engine || 'claude', source: r.source, sourceRef: r.source_ref || '', state: r.state, account: r.account || '', model: r.model || '', effort: r.effort || '',
        cwd: r.cwd || '', sessionId: r.session_id || '', link: r.link || '', message: r.message || '', startNow: !!r.start_now,
        createdAt: r.created_at, startedAt: r.started_at, endedAt: r.ended_at, prompt: String(r.prompt || '').slice(0, 2000),
        topology: r.topology || 'planner', stages: (() => { try { return JSON.parse(r.stages || '{}'); } catch (_) { return {}; } })(), parentId: r.parent_id || null,
        issue: r.issue_repo && r.issue_number ? { repo: r.issue_repo, number: r.issue_number, url: yz().issueUrl(r.issue_repo, r.issue_number) } : null,
        issueNote: r.issue_note || '',
        check: (() => { try { return r.check_json ? JSON.parse(r.check_json) : null; } catch (_) { return null; } })()
    };
}
function listWork(opts = {}) {
    const lim = Math.max(1, Math.min(300, Number(opts.limit) || 100));
    return db().prepare("SELECT * FROM supervisor_work ORDER BY CASE WHEN state IN ('held','queued','starting','running','waiting') THEN 0 ELSE 1 END, id DESC LIMIT ?").all(lim).map(rowWork);
}
const getWork = (id) => rowWork(db().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(Number(id)));
const yz = () => require('./fleetYozora');
/** The item's whole brief (rowWork cuts it at 2000 characters for lists). */
function workPrompt(id) { const r = db().prepare('SELECT prompt FROM supervisor_work WHERE id = ?').get(Number(id)); return r ? String(r.prompt || '') : ''; }

function setWork(id, fields) {
    const before = fields.state ? db().prepare('SELECT state FROM supervisor_work WHERE id = ?').get(Number(id)) : null;
    const keys = Object.keys(fields);
    db().prepare(`UPDATE supervisor_work SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(Object.assign({ id: Number(id) }, fields));
    if (before && before.state !== fields.state) syncIssue(Number(id), before.state).catch((e) => noteIssue(Number(id), e.message));
}

function noteIssue(id, text) {
    try { db().prepare('UPDATE supervisor_work SET issue_note = ? WHERE id = ?').run(String(text || '').slice(0, 300), id); } catch (_) { /* gone */ }
}

// ---------------------------------------------------------------- Yozora tracking (modules/fleetYozora.js)

/** The item's issue: linked (item.issue / a pulled issue) or made now. Best effort: the queue never waits on Yozora for long. */
async function ensureIssue(id) {
    const r = db().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(Number(id));
    if (!r || (r.issue_repo && r.issue_number)) return r;
    try {
        const w = rowWork(r);
        const made = await yz().createIssue(Object.assign({}, w, { prompt: r.prompt }));
        db().prepare('UPDATE supervisor_work SET issue_repo = ?, issue_number = ?, issue_id = ?, issue_note = NULL WHERE id = ?').run(made.repo, made.number, made.id, r.id);
    } catch (e) { noteIssue(r.id, `No issue yet: ${e.message}`); }
    return db().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(Number(id));
}

const mins = (ms) => `${Math.max(1, Math.round(ms / 60000))} min`;

/** A state change, as a comment, status labels, the board card and (when it ends) tracked time. */
async function syncIssue(id, prevState) {
    let r = db().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(id);
    if (!r) return;
    if (!r.issue_number && ['starting', 'running'].includes(r.state)) r = await ensureIssue(id);
    if (!r.issue_repo || !r.issue_number) return;
    const Y = yz();
    const where = `${r.issue_repo}#${r.issue_number}`;
    const ran = r.started_at ? (r.ended_at || Date.now()) - r.started_at : 0;
    const session = r.link ? ` Session: ${r.link}` : (r.session_id ? ` Session ${r.session_id.slice(0, 8)} (Fleet).` : '');
    let text = '';
    if (r.state === 'running' && prevState !== 'waiting') text = `**Fleet:** started as a supervised session on ${r.account || 'an account'} (${r.engine && r.engine !== 'claude' ? `${r.engine} ` : ''}${r.model || 'default model'}).${session} The Supervisor checks each turn against this issue.`;
    else if (r.state === 'running' && prevState === 'waiting') text = '**Fleet:** working again after the Supervisor\'s notes.';
    else if (r.state === 'waiting') text = `**Fleet / Supervisor:** after its last turn these look unaddressed, sent back to the session:\n${String(r.message || '').replace(/^Gaps sent back: /, '').split('; ').map((x) => `- ${x}`).join('\n')}`;
    else if (r.state === 'done') text = `**Fleet / Supervisor:** done - the Supervisor checked the last turn against this issue (and its definition of done) and found nothing missed, with evidence it was tested. ${r.message || ''}\n\nRan ${mins(ran)} (added as tracked time).${session} Closing as done.`;
    else if (r.state === 'failed') text = `**Fleet:** did not finish: ${r.message || 'unknown'}${ran ? `\n\nRan ${mins(ran)} (added as tracked time).` : ''}`;
    else if (r.state === 'cancelled') text = '**Fleet:** cancelled in Fleet.';
    if (r.parent_id) {
        // a part of a split item: its own line on the parent's issue, no labels / closing (the parent has those)
        if (text) await Y.comment(r.issue_repo, r.issue_number, text.replace('**Fleet', `**Fleet (part: ${r.title})`));
        if (['done', 'failed'].includes(r.state) && ran) await Y.addTime(r.issue_repo, r.issue_number, ran / 1000).catch(() => {});
        return;
    }
    if (text) await Y.comment(r.issue_repo, r.issue_number, text);
    if (['running', 'waiting', 'done', 'failed'].includes(r.state)) await Y.setStatus(r.issue_repo, r.issue_number, r.issue_id, r.state).catch(() => {});
    if (['done', 'failed'].includes(r.state) && ran) await Y.addTime(r.issue_repo, r.issue_number, ran / 1000).catch(() => {});
    // done only ever comes from a Supervisor review that said ok (workAfterReview / settleParent): close it
    if (r.state === 'done' && /found nothing missed|All \d+ parts done/.test(text + (r.message || ''))) await Y.close(r.issue_repo, r.issue_number).catch(() => {});
    if (r.state === 'cancelled' && String(r.source) !== 'yozora') await Y.close(r.issue_repo, r.issue_number).catch(() => {});
    noteIssue(id, `Synced ${new Date().toISOString().slice(11, 16)} (${where})`);
}

let lastPull = 0;
/** Open `fleet` issues become queued items; an item whose issue closed ends. At most every 2 min unless forced. */
async function pullIssues(gr, opts = {}) {
    if (!opts.force && Date.now() - lastPull < 2 * 60 * 1000) return { skipped: true };
    lastPull = Date.now();
    const g = gr || gResources;
    let cfgRepos = [];
    try { cfgRepos = ((g && g.getConfig && g.getConfig().agentSupervisor) || {}).yozoraRepos || []; } catch (_) { cfgRepos = []; }
    const repos = new Set([yz().DEFAULT_REPO].concat(Array.isArray(cfgRepos) ? cfgRepos : []));
    db().prepare('SELECT DISTINCT issue_repo FROM supervisor_work WHERE issue_repo IS NOT NULL').all().forEach((x) => repos.add(x.issue_repo));
    let added = 0;
    let ended = 0;
    for (const repo of repos) {
        let open = [];
        try { open = await yz().openFleetIssues(repo); } catch (e) { continue; }
        for (const i of open) {
            const have = db().prepare('SELECT id FROM supervisor_work WHERE issue_repo = ? AND issue_number = ?').get(repo, i.number)
                || (i.marker ? db().prepare('SELECT id FROM supervisor_work WHERE id = ?').get(Number(i.marker)) : null);
            if (have) continue;
            const prompt = `Yozora issue ${repo}#${i.number}: ${i.title}\n${i.url}\n\n${String(i.body || '').slice(0, 20000)}`;
            enqueue({ title: i.title, prompt, source: 'yozora', sourceRef: `issue:${repo}#${i.number}`, startNow: i.now, issueFields: { repo, number: i.number, id: i.id } }, { gr: g });
            added += 1;
        }
    }
    // items whose issue was closed on Yozora
    const active = db().prepare("SELECT * FROM supervisor_work WHERE issue_number IS NOT NULL AND state IN ('held','queued','starting','running','waiting')").all();
    for (const r of active) {
        let st = null;
        try { st = await yz().issueState(r.issue_repo, r.issue_number); } catch (_) { st = null; }
        if (st !== 'closed') continue;
        db().prepare('UPDATE supervisor_work SET state = ?, ended_at = ?, message = ? WHERE id = ?').run(r.state === 'queued' || r.state === 'held' ? 'cancelled' : 'done', Date.now(), 'Its issue was closed on Yozora', r.id);
        ended += 1;
    }
    if (added || ended) emit({ work: true });
    return { added, ended, repos: [...repos] };
}

const SUPERVISED_NOTE = 'On Yozora you are Yozora (director.yozora), not claude: every Yozora API call uses the token in the file named by $YOZORA_TOKEN_FILE, and git pushes to Yozora with a plain `git push` (this session\'s git already signs in as director.yozora); never use ~/.secrets/yozora-claude.token or the claude credential helper from CLAUDE.md. You are a supervised Fleet session: claim files with agent-coord before editing (coord_claim), commit your own work at the end of every turn, open a build gate before any build / restart, and before you say a multi-part request is done call coord_supervisor_check and address what it finds. Work you find that should be done by another session: coord_request_work (startNow when it should start now).';

/** Adds a work item and moves the queue. item: { title, prompt, cwd?, account?, model?, effort?, startNow?, source?, sourceRef? } */
function enqueue(item, opts = {}) {
    const prompt = String(item.prompt || '').trim();
    if (!prompt) throw new Error('A work item needs a prompt');
    if (prompt.length > 60000) throw new Error('That request is too long (60,000 characters at most): put the detail in a file and point to it');
    const src = ['fleet', 'plaud', 'director', 'agent', 'yozora'].includes(item.source) ? item.source : 'fleet';
    if (item.sourceRef) {
        const dup = db().prepare("SELECT id FROM supervisor_work WHERE source_ref = ? AND state NOT IN ('failed','cancelled')").get(String(item.sourceRef));
        if (dup) return Object.assign(getWork(dup.id), { reused: true });
    }
    const title = String(item.title || prompt.split('\n')[0]).replace(/\s+/g, ' ').trim().slice(0, 120) || 'Work';
    const engine = item.engine && item.engine !== 'claude' ? String(item.engine).slice(0, 60) : 'claude';
    const topology = TOPOLOGIES.includes(item.topology) ? item.topology : 'planner';
    const stages = JSON.stringify(cleanStages(item.stages));
    // new items wait for Yukimi to pick them (held) unless they start now or are a part of a split item
    const held = !item.startNow && !item.parentId && item.hold !== false;
    const r = db().prepare(`INSERT INTO supervisor_work (title, prompt, cwd, account, model, effort, source, source_ref, state, start_now, created_at, message, engine)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(title, prompt, item.cwd || null, item.account !== undefined && item.account !== null ? String(item.account) : null, item.model || null, item.effort || null, src, item.sourceRef || null, held ? 'held' : 'queued', item.startNow ? 1 : 0, Date.now(), held ? 'Waiting to be started' : 'Waiting for a slot', engine);
    db().prepare('UPDATE supervisor_work SET topology = ?, stages = ?, parent_id = ? WHERE id = ?').run(topology, stages, item.parentId || null, r.lastInsertRowid);
    if (item.issueFields && item.issueFields.repo && item.issueFields.number) {
        db().prepare('UPDATE supervisor_work SET issue_repo = ?, issue_number = ?, issue_id = ? WHERE id = ?').run(item.issueFields.repo, item.issueFields.number, item.issueFields.id || null, r.lastInsertRowid);
    }
    const w = getWork(r.lastInsertRowid);
    // its Yozora issue: the one it names (item.issue: "owner/repo#N" / URL), else made in the background
    if (item.issue) {
        yz().linkIssue(item.issue).then((iss) => {
            db().prepare('UPDATE supervisor_work SET issue_repo = ?, issue_number = ?, issue_id = ? WHERE id = ?').run(iss.repo, iss.number, iss.id, w.id);
            emit({ work: getWork(w.id) });
        }).catch((e) => noteIssue(w.id, `Issue not linked: ${e.message}`));
    } else if (src !== 'yozora') {
        ensureIssue(w.id).then(() => emit({ work: getWork(w.id) })).catch(() => {});
    }
    emit({ work: w });
    pumpWork(opts.gr).catch((e) => console.warn(`[supervisor] queue: ${e.message}`));
    return w;
}

/** A session runs while its claude process does (its record can be missing: never decide "ended" from that alone). */
function sessionRunning(sessionId, live) {
    if (live.has(sessionId)) return true;
    try {
        return fs.readdirSync('/proc').some((n) => {
            if (!/^\d+$/.test(n)) return false;
            try { const c = fs.readFileSync(`/proc/${n}/cmdline`, 'utf8'); return c.includes(sessionId) && /claude/.test(c); } catch (_) { return false; }
        });
    } catch (_) { return true; }
}

function activeCount() {
    const live = liveSessionsById();
    let n = 0;
    db().prepare(`SELECT id, session_id, state FROM supervisor_work WHERE state IN (${ACTIVE.map(() => '?').join(',')})`).all(...ACTIVE).forEach((w) => {
        if (w.state === 'starting' || (w.session_id && sessionRunning(w.session_id, live))) n += 1;
        else if (w.session_id && w.state !== 'waiting') {
            // its session ended: never "done" without the Supervisor's own check of what it did (Yukimi, Nov 24 2026)
            setWork(w.id, { state: 'waiting', message: 'Its session ended: the Supervisor is checking its last turn' });
            queueReview(w.session_id, 'turn-end');
        }
    });
    return n;
}

// ---------------------------------------------------------------- fan-out shapes (#1154)
//
// Yukimi, Nov 24 2026: "when you start a new supervisor session you can select the fan-out topology:
// Supervisor -> Claude Agent; Supervisor -> Claude Agent(s) (subdivide by surfaces); (default) Supervisor ->
// Claude Planner -> Background Agent(s); Let supervisor decide ... You can then select each stage's preferred
// model and effort ... the supervisor is there to help ensure what was asked for was completed and has been
// tested with evidence, and give me updates on the progress or holdups."
//   direct    one supervised session (the workers stage's engine / model / effort)
//   surfaces  the Supervisor's model splits the request by surface into parts (max 6), each its own direct
//             work item (child of this one, commenting on the same issue); the parent ends when they all do
//   planner   one planner session (planner stage) that researches and plans, then runs the work through
//             background agents on the workers stage, verifies their results with evidence and reports
//   auto      the Supervisor's model picks one of the three for the request

const TOPOLOGIES = ['direct', 'surfaces', 'planner', 'auto'];
function cleanStages(st) {
    const one = (x) => {
        const o = x && typeof x === 'object' ? x : {};
        return {
            engine: o.engine && o.engine !== 'claude' ? String(o.engine).slice(0, 60) : 'claude',
            model: o.model ? String(o.model).slice(0, 80) : '',
            effort: ['', 'low', 'medium', 'high', 'xhigh', 'max'].includes(o.effort || '') ? (o.effort || '') : ''
        };
    };
    const v = st && typeof st === 'object' ? st : {};
    return { planner: Object.assign({ model: 'opus', effort: 'high' }, Object.fromEntries(Object.entries(one(v.planner)).filter(([, x]) => x))), workers: Object.assign({ model: 'sonnet', effort: 'medium' }, Object.fromEntries(Object.entries(one(v.workers)).filter(([, x]) => x))) };
}

/** One JSON answer from the Supervisor's engine (the same engine / model as its reviews). */
async function askJson(gr, system, user, kind, opts = {}) {
    const r = await callEngine(gr, [{ role: 'system', content: system }, { role: 'user', content: user }], { kind: kind || 'json', maxTokens: opts.maxTokens });
    const raw = String(r.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(raw); } catch (_) { const m = /\{[\s\S]*\}/.exec(raw); return m ? JSON.parse(m[0]) : null; }
}

async function decideTopology(gr, w) {
    try {
        const o = await askJson(gr, 'You route coding requests for a team of Claude Code agents. Pick the shape: "direct" (one agent: a small or single-area change, a question, a quick fix), "surfaces" (several agents in parallel, one per independent surface such as server / desktop UI / phone UI / docs, when the parts barely depend on each other), or "planner" (one planner that researches and plans, then runs background agents: anything with open design questions, research, or ordered steps). Answer ONLY {"topology":"direct"|"surfaces"|"planner","reason":"one sentence"}.', String(w.prompt).slice(0, 12000));
        if (o && ['direct', 'surfaces', 'planner'].includes(o.topology)) return { topology: o.topology, reason: String(o.reason || '').slice(0, 200) };
    } catch (_) { /* default */ }
    return { topology: 'planner', reason: 'the Supervisor could not decide: the default' };
}

async function splitSurfaces(gr, w) {
    const o = await askJson(gr, 'Split this coding request into independent parts by surface (server / desktop UI / phone UI / docs / scripts / another project), each one a complete brief another agent can do alone: the goal for that surface, the files or folders it owns (no two parts own the same file), what it must not touch, and how to verify it with evidence. 2 to 6 parts; one part when it does not split. Answer ONLY {"parts":[{"title":"short","surface":"server","paths":["modules/..."],"brief":"the whole brief"}]}.', String(w.prompt).slice(0, 20000));
    const parts = (o && Array.isArray(o.parts) ? o.parts : []).filter((p) => p && p.brief).slice(0, 6);
    if (!parts.length) throw new Error('The Supervisor could not split it');
    return parts.map((p) => ({ title: String(p.title || p.surface || 'Part').slice(0, 100), surface: String(p.surface || '').slice(0, 40), paths: (Array.isArray(p.paths) ? p.paths : []).map(String).slice(0, 20), brief: String(p.brief).slice(0, 20000) }));
}

const plannerNote = (st) => `You are the PLANNER for this request (Supervisor -> Planner -> background agents). First research and plan (read the code, decide the approach, split it into parts with clear file ownership). Then do the work through background agents (the Agent tool, run_in_background), each with a complete brief (goal, files it owns, what it must not touch, how to verify with evidence) and model "${st.workers.model || 'sonnet'}"${st.workers.effort ? ` and effort "${st.workers.effort}"` : ''}; do trivial edits yourself only. Verify every agent's result with evidence (tests you ran, command output, screenshots you read) before you call a part done, integrate, commit, and report progress and holdups on the tracked issue as you go.`;

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
            const tracked = await Promise.race([ensureIssue(w.id), new Promise((res) => setTimeout(() => res(null), 15000))]);
            const track = tracked && tracked.issue_number
                ? `\n\nThis work is tracked in Yozora ${tracked.issue_repo}#${tracked.issue_number} (${yz().issueUrl(tracked.issue_repo, tracked.issue_number)}, label fleet). Comment your progress there as you go and end with the Done comment the rules ask for; the Supervisor comments when it starts, sends gaps back and ends, and adds the time this session runs (do not start a stopwatch). Check its Definition of done.`
                : '';
            try {
                const st = pick.settings || {};
                const stages = cleanStages((() => { try { return JSON.parse(w.stages || '{}'); } catch (_) { return {}; } })());
                let topology = TOPOLOGIES.includes(w.topology) ? w.topology : 'planner';
                if (topology === 'auto') {
                    const d = await decideTopology(g, w);
                    topology = d.topology;
                    setWork(w.id, { topology, message: `The Supervisor picked ${topology}: ${d.reason}` });
                }
                if (topology === 'surfaces' && !w.parent_id) {
                    const parts = await splitSurfaces(g, w);
                    parts.forEach((p) => enqueue({
                        title: `${w.title}: ${p.title}`, prompt: `Part of "${w.title}" (Fleet item ${w.id}), surface ${p.surface || p.title}. You own ${p.paths.join(', ') || 'only what this brief names'}; other parts run in parallel on the other surfaces: do not edit their files.\n\n${p.brief}`,
                        cwd: w.cwd, account: w.account, topology: 'direct', stages, startNow: !!w.start_now, source: w.source, parentId: w.id,
                        issueFields: w.issue_repo ? { repo: w.issue_repo, number: w.issue_number, id: w.issue_id } : null
                    }, { gr: g }));
                    setWork(w.id, { state: 'running', started_at: Date.now(), message: `Split into ${parts.length} parts by surface` });
                    if (w.issue_repo) yz().comment(w.issue_repo, w.issue_number, `**Fleet / Supervisor:** split into ${parts.length} parts by surface, each its own supervised session:\n${parts.map((p) => `- ${p.title} (${p.paths.slice(0, 4).join(', ') || p.surface})`).join('\n')}`).catch(() => {});
                    started += 1;
                    emit({ work: getWork(w.id) });
                    continue;
                }
                const stage = topology === 'planner' ? stages.planner : stages.workers;
                const engine = (w.engine && w.engine !== 'claude') ? w.engine : (stage.engine !== 'claude' ? stage.engine : undefined);
                const r = await require('./claudeSessionLauncher').start(g, {
                    cwd: w.cwd || path.join(__dirname, '..'), prompt: `${w.prompt}${track}${topology === 'planner' ? `\n\n${plannerNote(stages)}` : ''}\n\n${SUPERVISED_NOTE}`, title: w.title, account: pick.index,
                    mode: st.defaultMode, engine,
                    model: w.model || stage.model || (engine ? undefined : (st.defaultModel || 'sonnet')), effort: w.effort || stage.effort || st.defaultEffort || undefined, dispatchedBy: `Supervisor (${w.source}, ${topology})`
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
    if (rv.verdict === 'ok') { setWork(w.id, { state: 'done', ended_at: Date.now(), message: rv.summary || 'Done' }); settleParent(w.parent_id); }
    else if (rv.verdict === 'gaps') setWork(w.id, { state: 'waiting', message: `Gaps sent back: ${rv.missed.map((m) => m.item).join('; ').slice(0, 240)}` });
    else setWork(w.id, { state: 'running', message: rv.summary || 'Turn ended' });
    emit({ work: getWork(w.id) });
    pumpWork().catch(() => {});
}

/** A surfaces parent ends when all its parts have: done when they all are, else failed. */
function settleParent(parentId) {
    if (!parentId) return;
    const kids = db().prepare('SELECT state FROM supervisor_work WHERE parent_id = ?').all(parentId);
    if (!kids.length || kids.some((k) => !['done', 'failed', 'cancelled'].includes(k.state))) return;
    const ok = kids.every((k) => k.state === 'done');
    setWork(parentId, { state: ok ? 'done' : 'failed', ended_at: Date.now(), message: ok ? `All ${kids.length} parts done` : `${kids.filter((k) => k.state !== 'done').length} of ${kids.length} parts did not finish` });
}

/** Start: a waiting (held) item joins the queue and starts when a slot is free; now = past the slot limit too.
 *  A failed or cancelled item starts again from scratch. */
function startWork(id, opts = {}) {
    const w = getWork(id);
    if (!w) throw new Error('No such work item');
    const now = opts.now !== false;
    if (w.state === 'queued') setWork(w.id, { start_now: now ? 1 : 0 });
    else if (['held', 'failed', 'cancelled'].includes(w.state)) {
        setWork(w.id, { state: 'queued', start_now: now ? 1 : 0, session_id: null, link: '', started_at: null, ended_at: null, message: 'Waiting for a slot' });
    } else throw new Error(`It is ${w.state}`);
    emit({ work: getWork(w.id) });
    pumpWork().catch(() => {});
    return getWork(w.id);
}

const EDITABLE = ['held', 'queued', 'failed', 'cancelled'];
/**
 * Edits an item that is not running (held, queued, failed, cancelled), validated as enqueue is. fields: { title, prompt,
 * appendNote (added to the end of the brief), topology, stages ({planner,workers} merged over the item's), account
 * (index / name / 'auto'), model, effort, engine }. A changed brief clears the Supervisor's maintenance check (it was about
 * the old one) and is commented on the item's Yozora issue ("Brief updated by <opts.by || 'Yozora'>: ...").
 */
function updateWork(id, fields, opts = {}) {
    const w = getWork(id);
    if (!w) throw new Error('No such work item');
    if (!EDITABLE.includes(w.state)) throw new Error(`It is ${w.state}: only a waiting, queued, failed or cancelled item is edited here (steer a running one through its session)`);
    const f = fields && typeof fields === 'object' ? fields : {};
    const set = {};
    let prompt = f.prompt !== undefined ? String(f.prompt || '').trim() : workPrompt(w.id);
    if (!prompt) throw new Error('A work item needs a prompt');
    if (f.appendNote !== undefined && String(f.appendNote).trim()) prompt = `${prompt}\n\n${String(f.appendNote).trim()}`;
    if (prompt.length > 60000) throw new Error('That request is too long (60,000 characters at most): put the detail in a file and point to it');
    const briefChanged = prompt !== workPrompt(w.id);
    if (briefChanged) { set.prompt = prompt; set.check_json = null; }
    if (f.title !== undefined) {
        const t = String(f.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!t) throw new Error('A work item needs a title');
        set.title = t;
    }
    if (f.topology !== undefined) {
        if (!TOPOLOGIES.includes(f.topology)) throw new Error(`topology is one of ${TOPOLOGIES.join(', ')}`);
        set.topology = f.topology;
    }
    if (f.stages !== undefined) {
        const cur = w.stages || {};
        const g = f.stages && typeof f.stages === 'object' ? f.stages : {};
        set.stages = JSON.stringify(cleanStages({ planner: Object.assign({}, cur.planner, g.planner), workers: Object.assign({}, cur.workers, g.workers) }));
    }
    if (f.account !== undefined) set.account = f.account === null || String(f.account).trim() === '' || String(f.account).toLowerCase() === 'auto' ? null : String(f.account);
    if (f.model !== undefined) set.model = String(f.model || '').slice(0, 80) || null;
    if (f.effort !== undefined) {
        if (f.effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(f.effort)) throw new Error('effort is low, medium, high, xhigh or max');
        set.effort = f.effort || null;
    }
    if (f.engine !== undefined) set.engine = f.engine && f.engine !== 'claude' ? String(f.engine).slice(0, 60) : 'claude';
    if (!Object.keys(set).length) return w;
    setWork(w.id, set);
    if (briefChanged && w.issue) {
        const note = f.appendNote && String(f.appendNote).trim() ? `Note added: ${String(f.appendNote).trim()}` : prompt;
        yz().comment(w.issue.repo, w.issue.number, `**Fleet:** Brief updated by ${opts.by || 'Yozora'}: ${note.length > 1500 ? `${note.slice(0, 1500)}...` : note}`).catch((e) => noteIssue(w.id, `Brief comment failed: ${e.message}`));
    }
    emit({ work: getWork(w.id) });
    return getWork(w.id);
}

/** Back to waiting (held): a queued, failed or cancelled item stops waiting for a slot until it is started. */
function holdWork(id) {
    const w = getWork(id);
    if (!w) throw new Error('No such work item');
    if (!['queued', 'failed', 'cancelled', 'held'].includes(w.state)) throw new Error(`It is ${w.state}: end its session first`);
    setWork(w.id, { state: 'held', start_now: 0, session_id: null, link: '', started_at: null, ended_at: null, message: 'Waiting to be started' });
    emit({ work: getWork(w.id) });
    return getWork(w.id);
}

function cancelWork(id) {
    const w = getWork(id);
    if (!w) throw new Error('No such work item');
    if (!['held', 'queued', 'failed'].includes(w.state)) throw new Error('Only a waiting or queued item is cancelled here: end a running one from its session');
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

// ---------------------------------------------------------------- pause / resume (holds)
//
// Yukimi, Nov 24 2026: "allow the supervisor to halt / pause an agent when it needs to interject or take
// momentary control of the process (a collision has occurred, or it needs to merge things and does not want
// an agent to damage the process)".
//   hold    its current turn is stopped (Esc) and it is told to wait for RESUME (typed in when it runs in
//           tmux, and in its agent-coord inbox); it can still answer, it must not edit
//   freeze  the session's claude process and every process under it get SIGSTOP (its own tree only, never a
//           process group a Remote Control server shares); resume sends SIGCONT. Fleet / the Supervisor
//           only, never an agent's tool. An API stream cut while frozen is retried by the CLI.
// Collisions (settings.autoPauseOnCollision, default on): after a turn, a file this session changed and has
// not committed that another live session has also changed and not committed pauses that other session
// (hold) and tells both; the hold ends by itself once the two no longer overlap.

function descendants(pid) {
    const kids = new Map();
    try {
        fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).forEach((n) => {
            try {
                const st = fs.readFileSync(`/proc/${n}/stat`, 'utf8');
                const pp = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
                if (!kids.has(pp)) kids.set(pp, []);
                kids.get(pp).push(Number(n));
            } catch (_) { /* gone */ }
        });
    } catch (_) { return [pid]; }
    const out = [pid];
    for (let i = 0; i < out.length && out.length < 500; i += 1) (kids.get(out[i]) || []).forEach((c) => out.push(c));
    return out;
}

function activeHold(sessionId) {
    return db().prepare('SELECT * FROM supervisor_holds WHERE session_id = ? AND ended_at IS NULL ORDER BY id DESC').get(String(sessionId));
}
function listHolds() {
    return db().prepare('SELECT * FROM supervisor_holds WHERE ended_at IS NULL ORDER BY id DESC').all().map((h) => ({ id: h.id, sessionId: h.session_id, mode: h.mode, reason: h.reason, by: h.by_who, at: h.at, kind: h.kind, paths: JSON.parse(h.paths || '[]') }));
}

async function pauseSession(sessionId, opts = {}) {
    const mode = opts.mode === 'freeze' ? 'freeze' : 'hold';
    const live = liveSessionsById().get(sessionId);
    if (!live) throw new Error('It is not running');
    if (activeHold(sessionId)) throw new Error('It is paused already');
    const reason = String(opts.reason || 'The Supervisor needs a moment').slice(0, 300);
    const by = String(opts.by || 'Fleet').slice(0, 80);
    let pids = [];
    const launcher = require('./claudeSessionLauncher');
    if (mode === 'freeze') {
        pids = descendants(live.pid);
        pids.forEach((p) => { try { process.kill(p, 'SIGSTOP'); } catch (_) { /* gone */ } });
    } else {
        try { await launcher.interrupt(sessionId); } catch (_) { /* not in tmux: the inbox note stands */ }
        const text = `${STEER_PREFIX} PAUSE (${by}): ${reason}. Stop where you are, do not edit files or run builds, and wait until you are told RESUME. You may answer questions.`;
        try { await launcher.steer(sessionId, text); } catch (_) { /* not typeable */ }
    }
    try {
        if (!coord().getAgent(lockAgentId(sessionId))) coord().upsertAgent({ id: lockAgentId(sessionId), kind: 'claude', name: live.givenName || live.name || sessionId.slice(0, 8), sessionId });
        coord().post('supervisor', lockAgentId(sessionId), `PAUSE (${by}, ${mode}): ${reason}. Do not edit files or run builds until RESUME.`, { kind: 'steer' });
    } catch (_) { /* inbox unavailable */ }
    db().prepare('INSERT INTO supervisor_holds (session_id, mode, reason, by_who, pids, at, kind, paths) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(sessionId, mode, reason, by, JSON.stringify(pids), Date.now(), opts.kind || 'manual', JSON.stringify(opts.paths || []));
    emit({ hold: sessionId });
    return activeHold(sessionId);
}

async function resumeSession(sessionId, opts = {}) {
    const h = activeHold(sessionId);
    if (!h) throw new Error('It is not paused');
    if (h.mode === 'freeze') {
        JSON.parse(h.pids || '[]').forEach((p) => { try { process.kill(p, 'SIGCONT'); } catch (_) { /* gone */ } });
    } else {
        const text = `${STEER_PREFIX} RESUME${opts.note ? `: ${String(opts.note).slice(0, 300)}` : ''}. You may continue your work.`;
        try { await require('./claudeSessionLauncher').steer(sessionId, text); } catch (_) { /* inbox */ }
        try { coord().post('supervisor', lockAgentId(sessionId), `RESUME: you may continue.${opts.note ? ` ${opts.note}` : ''}`, { kind: 'steer' }); } catch (_) { /* none */ }
    }
    db().prepare('UPDATE supervisor_holds SET ended_at = ? WHERE id = ?').run(Date.now(), h.id);
    emit({ hold: sessionId });
    return { sessionId, resumed: true };
}

/** After a turn: files this session and another live one both changed and did not commit. */
async function checkCollisions(sessionId, s) {
    const live = liveSessionsById();
    const me = live.get(sessionId);
    if (!me || !me.cwd) return [];
    const store = coord();
    const mineRow = (() => { try { return store.inspect(lockAgentId(sessionId), { limit: 300 }); } catch (_) { return null; } })();
    if (!mineRow) return [];
    const { root } = store.repoOf(me.cwd);
    const mine = new Set(mineRow.edited.files.filter((f) => f.uncommitted).map((f) => f.path));
    const found = [];
    for (const [id, other] of live) {
        if (id === sessionId || !other.cwd || store.repoOf(other.cwd).root !== root) continue;
        let r = null;
        try { r = store.inspect(lockAgentId(id), { limit: 300, git: true }); } catch (_) { r = null; }
        if (!r) continue;
        const both = r.edited.files.filter((f) => f.uncommitted && mine.has(f.path)).map((f) => f.path);
        if (both.length) found.push({ sessionId: id, name: r.agent.name || id.slice(0, 8), paths: both, busy: other.status === 'busy' });
    }
    for (const c of found) {
        const text = `Collision: ${(mineRow.agent && mineRow.agent.name) || sessionId.slice(0, 8)} and ${c.name} both changed ${c.paths.slice(0, 5).join(', ')} without committing.`;
        try { store.post('supervisor', null, `${text} The Supervisor ${s.autoPauseOnCollision ? `paused ${c.name} until they no longer overlap` : 'left both running'}: commit your own hunks, coordinate with coord_post.`, { kind: 'note' }); } catch (_) { /* none */ }
        if (s.autoPauseOnCollision && !activeHold(c.sessionId)) {
            await pauseSession(c.sessionId, { mode: 'hold', reason: `${text} Wait while the other session commits`, by: 'Supervisor', kind: 'collision', paths: c.paths }).catch(() => {});
        }
    }
    // collision holds whose overlap is gone end by themselves
    for (const h of listHolds().filter((x) => x.kind === 'collision')) {
        let r = null;
        try { r = store.inspect(lockAgentId(h.sessionId), { limit: 300, git: true }); } catch (_) { r = null; }
        const still = r && r.edited.files.some((f) => f.uncommitted && h.paths.includes(f.path) && [...live.keys()].some((id) => id !== h.sessionId && (() => { try { return store.inspect(lockAgentId(id), { limit: 300, git: false }).edited.files.some((g) => g.path === f.path); } catch (_) { return false; } })()));
        if (!still) await resumeSession(h.sessionId, { note: 'the overlap is gone' }).catch(() => {});
    }
    return found;
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

/**
 * Hard safety for Clean (Nov 24 2026: the tracker had read "/", the repo itself and the word "and" as work folders).
 * Never: a protected folder or any folder above one (/, /home, ~, the repo), a path less than two levels deep (three for a worktree),
 * a folder holding a .git directory (a real repository), a live session's folder or one above it, a "worktree" that
 * is not a linked worktree (its .git must be a file pointing at another repository). Everything else must be under
 * /tmp, /var/tmp or ~/.cache.
 */
function cleanable(fullIn, kind) {
    if (!fullIn || !path.isAbsolute(fullIn)) return false;
    const full = path.normalize(fullIn).replace(/\/+$/, '') || '/';
    const never = NEVER();
    if (never.some((n) => n === full || n.startsWith(`${full}${path.sep}`))) return false;
    if (full.includes(`${path.sep}.fleet-trash`)) return false;
    const depth = full.split(path.sep).filter(Boolean).length;
    if (depth < 2 || (kind === 'worktree' && depth < 3)) return false;
    if (full.includes(`${path.sep}.claude${path.sep}`) || full.includes(`${path.sep}.secrets`)) return false;
    try {
        const live = require('./claudeSessions').liveSessions().map((x) => x.cwd).filter(Boolean).map((c) => path.normalize(c));
        if (live.some((c) => c === full || c.startsWith(`${full}${path.sep}`))) return false;
    } catch (_) { return false; }
    let gitStat = null;
    try { gitStat = fs.lstatSync(path.join(full, '.git')); } catch (_) { gitStat = null; }
    if (kind === 'worktree') return !!(gitStat && gitStat.isFile());
    if (gitStat && gitStat.isDirectory()) return false;
    return CLEAN_ROOTS().some((r) => full.startsWith(r) && full.length > r.length + 1);
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
        const trashed = r.decision === 'trashed' && !!r.trash_path;
        const state = trashed ? 'trashed' : (exists === false ? 'gone' : (live.has(r.session_id) ? 'live' : 'orphan'));
        return {
            id: r.id, path: full || r.path, kind: r.kind, sessionId: r.session_id, agentName: names.get(r.session_id), createdAt: r.created_at, cmd: r.cmd,
            exists, sizeBytes: r.size_bytes, checkedAt: r.checked_at, ageHours: Math.round((Date.now() - r.created_at) / 3600000), state,
            cleanable: exists !== false && state !== 'live' && cleanable(full, r.kind),
            decision: r.decision || '', decisionReason: r.decision_reason || '', decidedAt: r.decided_at || null, trashPath: r.trash_path || '', canRestore: trashed
        };
    });
}

function cleanArtifactGuardMessage(a) {
    return a && a.state === 'live' ? 'Its session is still running: let it clean up, or stop it first' : 'Only work folders and temp files under /tmp, /var/tmp, ~/.cache or a git worktree are cleaned from here';
}

/** Cheap walk with a budget: size, file count (capped), newest mtime, .agent-* locks, symlinks. Never follows links. */
function walkEvidence(root, budgetMs = 1500, fileCap = 20000) {
    const until = Date.now() + budgetMs;
    const ev = { files: 0, truncated: false, newestMtimeMs: 0, locks: [], symlinks: 0 };
    const stack = [root];
    while (stack.length) {
        if (Date.now() > until || ev.files >= fileCap) { ev.truncated = true; break; }
        const dir = stack.pop();
        let st = null;
        try { st = fs.lstatSync(dir); } catch (_) { continue; }
        ev.newestMtimeMs = Math.max(ev.newestMtimeMs, st.mtimeMs);
        if (st.isSymbolicLink()) { ev.symlinks += 1; continue; }
        if (!st.isDirectory()) { ev.files += 1; if (/^\.agent-/.test(path.basename(dir))) ev.locks.push(dir); continue; }
        let names = [];
        try { names = fs.readdirSync(dir); } catch (_) { continue; }
        names.forEach((n) => stack.push(path.join(dir, n)));
    }
    return ev;
}

function gitEvidence(full) {
    const cp = require('child_process');
    const run = (args) => { try { return { ok: true, out: cp.execFileSync('git', ['-C', full, ...args], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }) }; } catch (_) { return { ok: false, out: '' }; } };
    if (!fs.existsSync(path.join(full, '.git'))) return null;
    const st = run(['status', '--porcelain']);
    const un = run(['log', 'HEAD', '--not', '--remotes', '--oneline', '-n', '20']);
    return { statusOk: st.ok, dirty: st.out.split('\n').filter(Boolean).slice(0, 20), unpushedOk: un.ok, unpushed: un.out.split('\n').filter(Boolean) };
}

function openUsers(full) {
    try {
        const out = require('child_process').execFileSync('lsof', ['-t', '+D', full], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
        return out.split('\n').map((x) => Number(x)).filter((n) => n > 1 && n !== process.pid);
    } catch (e) {
        if (e && e.status === 1) return []; // lsof: nothing open
        return null; // not installed / timed out: unknown
    }
}

const RECENT_MS = 2 * 3600 * 1000;
const TRASH_DAYS = 7;
const cleaning = new Set();

function recordDecision(id, decision, reason, extra = {}) {
    coord().open().prepare('UPDATE artifacts SET decision = ?, decision_reason = ?, decided_at = ?, trash_path = COALESCE(?, trash_path), exists_now = COALESCE(?, exists_now), size_bytes = CASE WHEN ? = 0 THEN NULL ELSE size_bytes END, checked_at = ? WHERE id = ?')
        .run(decision, String(reason || '').slice(0, 400), Date.now(), extra.trashPath === undefined ? null : extra.trashPath, extra.exists === undefined ? null : extra.exists, extra.exists === undefined ? 1 : extra.exists, Date.now(), id);
    emit({ artifacts: true });
}

/** Everything the review looks at (pure reading; nothing is changed). */
function artifactEvidence(r, a) {
    const ev = { path: a.path, kind: r.kind, command: r.cmd || '', session: a.agentName || r.session_id.slice(0, 8), sessionState: a.state, createdHoursAgo: a.ageHours };
    let real = a.path;
    try { real = fs.realpathSync(a.path); } catch (_) { real = a.path; }
    ev.realPath = real;
    ev.symlinkRedirect = real !== a.path && real !== path.normalize(a.path);
    ev.sizeBytes = a.sizeBytes != null ? a.sizeBytes : duBytes(a.path);
    const w = walkEvidence(a.path);
    ev.fileCount = w.files; ev.truncatedWalk = w.truncated; ev.symlinksInside = w.symlinks;
    ev.newestMtime = w.newestMtimeMs ? new Date(w.newestMtimeMs).toISOString() : null;
    ev.newestMtimeMs = w.newestMtimeMs;
    ev.busyLocks = w.locks.map((l) => path.relative(a.path, l));
    ev.git = gitEvidence(a.path);
    ev.openByPids = openUsers(a.path);
    return ev;
}

/** Automatic refusals (no engine call): returns a reason or ''. */
function autoRefusal(ev) {
    if (ev.symlinkRedirect && !cleanable(ev.realPath, ev.kind)) return `It is a link to ${ev.realPath}, which is not a place cleaned from here`;
    if (ev.newestMtimeMs && Date.now() - ev.newestMtimeMs < RECENT_MS) return `Something inside changed in the last 2 hours (${ev.newestMtime})`;
    if (ev.busyLocks.length) return `It holds a busy lock (${ev.busyLocks[0]}): an agent works in it`;
    if (ev.openByPids && ev.openByPids.length) return `A running process uses it (pid ${ev.openByPids.slice(0, 3).join(', ')})`;
    if (ev.git) {
        if (!ev.git.statusOk || !ev.git.unpushedOk) return 'Git could not say whether it holds unsaved work';
        if (ev.git.dirty.length) return `It has ${ev.git.dirty.length} uncommitted change(s)`;
        if (ev.git.unpushed.length) return `It has ${ev.git.unpushed.length} commit(s) that are not pushed anywhere`;
    }
    return '';
}

const REVIEW_SYSTEM = 'You are the safety reviewer of an agent Supervisor. A coding agent created a work folder or temp file; the user pressed Clean. You get the evidence (path, size, file count, newest modification, git state, the command that made it, which session made it). Decide if moving it to a 7-day trash is safe. It is UNSAFE when the path looks like it holds something important or personal (a repository with real history, databases, backups, photos, documents, credentials, a user data folder), when it is not obviously scratch output, or when the evidence is thin or odd. It is SAFE for build output, test scratch folders, downloaded temp files, logs, and clones the agent made for a job that is over. Answer ONLY {"verdict":"safe"|"unsafe","reason":"one sentence"}.';

/**
 * Supervised Clean: hard guard -> evidence -> automatic refusals -> the engine's verdict -> trash (a git worktree is removed
 * without --force, only when clean). Every decision is stored on the row. opts: { gr, budget: { calls, max } }.
 * Returns { id, decision: refused|unsafe|trashed|removed|deferred, reason, cleaned?, freedBytes?, trash? }.
 */
async function cleanArtifact(id, opts = {}) {
    const d = coord().open();
    const r = d.prepare('SELECT * FROM artifacts WHERE id = ?').get(Number(id));
    if (!r) throw new Error('No such entry');
    if (cleaning.has(r.id)) return { id: r.id, decision: 'refused', reason: 'It is already being checked' };
    cleaning.add(r.id);
    try {
        const refuse = (reason, decision = 'refused') => { recordDecision(r.id, decision, reason); return { id: r.id, decision, reason }; };
        const a = artifactStatus().find((x) => x.id === r.id);
        if (!a || !a.cleanable) return refuse(cleanArtifactGuardMessage(a));
        const ev = artifactEvidence(r, a);
        const auto = autoRefusal(ev);
        if (auto) return refuse(auto);
        // the engine decides last; with no way to ask, nothing is deleted
        if (opts.budget) { if (opts.budget.calls >= opts.budget.max) return { id: r.id, decision: 'deferred', reason: 'Too many reviews in one run: left for the next' }; opts.budget.calls += 1; }
        let v = null;
        try {
            const brief = Object.assign({}, ev, { openByPids: undefined, newestMtimeMs: undefined, git: ev.git && { dirtyCount: ev.git.dirty.length, unpushedCount: ev.git.unpushed.length } });
            v = await askJson(opts.gr, REVIEW_SYSTEM, JSON.stringify(brief), 'artifact-clean', { maxTokens: 300 });
        } catch (e) { return refuse(`The Supervisor could not review it (${String(e.message).slice(0, 120)}): nothing was removed`); }
        if (!v || v.verdict !== 'safe') return refuse(`The Supervisor judged it unsafe: ${String((v && v.reason) || 'no reason given').slice(0, 250)}`, 'unsafe');
        // re-check right before acting: the world may have moved while the engine thought
        const a2 = artifactStatus().find((x) => x.id === r.id);
        if (!a2 || !a2.cleanable) return refuse(cleanArtifactGuardMessage(a2));
        const auto2 = autoRefusal(artifactEvidence(r, a2));
        if (auto2) return refuse(auto2);
        const why = String(v.reason || 'safe').slice(0, 200);
        if (r.kind === 'worktree') {
            try { require('child_process').execFileSync('git', ['-C', a.path, 'worktree', 'remove', a.path], { timeout: 20000, stdio: 'ignore' }); } catch (e) { return refuse(`git worktree remove refused it (no --force): ${String(e.message).slice(0, 120)}`); }
            recordDecision(r.id, 'removed', `Clean worktree removed (no uncommitted or unpushed work). ${why}`, { exists: 0 });
            return { id: r.id, decision: 'removed', reason: why, cleaned: a.path, freedBytes: ev.sizeBytes || 0 };
        }
        const root = CLEAN_ROOTS().find((x) => a.path.startsWith(x));
        if (!root) return refuse('It is not under a cleaned folder');
        const trashDir = path.join(root, '.fleet-trash');
        const trash = path.join(trashDir, `${Date.now()}-${path.basename(a.path)}`);
        try { fs.mkdirSync(trashDir, { recursive: true, mode: 0o700 }); fs.renameSync(a.path, trash); } catch (e) { return refuse(`It could not be moved to the trash (${String(e.code || e.message).slice(0, 80)}): nothing was removed`); }
        recordDecision(r.id, 'trashed', `Moved to the trash for ${TRASH_DAYS} days. ${why}`, { trashPath: trash, exists: 0 });
        return { id: r.id, decision: 'trashed', reason: why, cleaned: a.path, freedBytes: ev.sizeBytes || 0, trash };
    } finally { cleaning.delete(r.id); }
}

function restoreArtifact(id) {
    const d = coord().open();
    const r = d.prepare('SELECT * FROM artifacts WHERE id = ?').get(Number(id));
    if (!r || r.decision !== 'trashed' || !r.trash_path) throw new Error('Only a folder in the trash can be restored');
    const full = expand(r.path, r.cwd);
    if (!full || !r.trash_path.includes(`${path.sep}.fleet-trash${path.sep}`)) throw new Error('The trash location is not valid');
    if (!fs.existsSync(r.trash_path)) { recordDecision(r.id, 'purged', 'The trash copy is gone'); throw new Error('The trash copy is gone'); }
    if (fs.existsSync(full)) throw new Error('Something already exists at the original path');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.renameSync(r.trash_path, full);
    recordDecision(r.id, 'restored', 'Restored from the trash', { trashPath: '', exists: 1 });
    return { id: r.id, restored: full };
}

/** Deletes trash older than 7 days (the only place anything is really removed). */
function purgeTrash(opts = {}) {
    const days = opts.days == null ? TRASH_DAYS : opts.days;
    const rows = coord().open().prepare("SELECT * FROM artifacts WHERE decision = 'trashed' AND trash_path != '' AND decided_at < ?").all(Date.now() - days * 86400000);
    const out = [];
    rows.forEach((r) => {
        if (!r.trash_path.includes(`${path.sep}.fleet-trash${path.sep}`)) return;
        try { fs.rmSync(r.trash_path, { recursive: true, force: true }); } catch (_) { return; }
        recordDecision(r.id, 'purged', `Deleted from the trash after ${days} days`, { trashPath: '' });
        out.push(r.trash_path);
    });
    return out;
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
    await checkCollisions(sessionId, set).catch((e) => console.warn(`[supervisor] collisions: ${e.message}`));
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

const SETTLE_MS = Number(process.env.AGENT_SUPERVISOR_SETTLE_MS) >= 0 && process.env.AGENT_SUPERVISOR_SETTLE_MS !== undefined ? Number(process.env.AGENT_SUPERVISOR_SETTLE_MS) : 20000;
const settling = new Map();
function settleThenReview(sessionId) {
    clearTimeout(settling.get(sessionId));
    settling.set(sessionId, setTimeout(() => {
        settling.delete(sessionId);
        if (statusBySession.get(sessionId) === 'busy') return;
        const live = liveSessionsById().get(sessionId);
        if (live && live.status === 'busy') return;
        queueReview(sessionId, 'turn-end');
    }, SETTLE_MS));
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
        // a turn ended: reviewed once it stays ended for a while (a session that is idle for a moment between a message
        // and the next, or while a queued message lands, is still in its turn)
        if (!first && prev === 'busy' && now !== 'busy' && settings().enabled) settleThenReview(r.sessionId);
        if (!first && prev === undefined && now === 'busy') markPartial(r.sessionId);
    });
    [...statusBySession.keys()].forEach((id) => { if (!seen.has(id)) statusBySession.delete(id); });
}

/** A session first seen mid-turn: its turn starts before what the Supervisor read. */
function markPartial(sessionId) {
    try { db().prepare("INSERT OR IGNORE INTO supervisor_state (session_id, status, updated_at) VALUES (?, 'partial', ?)").run(sessionId, Date.now()); } catch (_) { /* later */ }
}

// ---------------------------------------------------------------- MCP: a session asks (unix socket)

// A Claude Code session's AskUserQuestion (scripts/claude-ask-hook.js): the questions become a request form on every
// client (and the phone's notification inbox); the answers go back to the hook, which fills the tool in with them.
const ASK_WAIT_MS = 10 * 60 * 1000;
function accountNameOf(configDir) {
    try {
        const m = /claude-accounts\/([0-9a-f]+)\/config\/?$/.exec(String(configDir || ''));
        if (!m) return configDir ? '' : 'host';
        const a = require('./claudeAccountHost').listAccounts(gResources).find((x) => x.id === m[1]);
        return (a && (a.name || a.email)) || '';
    } catch (_) { return ''; }
}
function askFields(questions) {
    const fields = [];
    questions.slice(0, 4).forEach((q, i) => {
        const text = String((q && q.question) || '').replace(/\s+/g, ' ').trim();
        const head = String((q && q.header) || '').trim();
        const opts = (Array.isArray(q && q.options) ? q.options : []).slice(0, 8);
        const optLabel = (o) => `${String((o && o.label) || o || '')}${o && o.description ? ` - ${o.description}` : ''}`.slice(0, 120);
        if (q && q.multiSelect === true) {
            opts.forEach((o, j) => fields.push({ id: `q${i}_o${j}`, label: `${head ? `${head}: ` : ''}${String((o && o.label) || o || '')}`.slice(0, 80), type: 'bool', sub: j === 0 ? text : String((o && o.description) || '') }));
        } else {
            fields.push({ id: `q${i}`, label: (head || `Question ${i + 1}`).slice(0, 80), type: 'select', sub: text, data: { options: opts.map((o) => ({ value: String((o && o.label) || o || ''), label: optLabel(o) })).concat([{ value: '__other__', label: 'Other... (type below)' }]), default: opts.length ? String((opts[0] && opts[0].label) || opts[0]) : '' } });
        }
        fields.push({ id: `q${i}_other`, label: `${head || `Question ${i + 1}`}: other`.slice(0, 80), type: 'text', sub: 'Typed here, it replaces the choice above', data: { placeholder: 'Other...' } });
    });
    return fields;
}
async function askUser(req, onId) {
    const questions = (Array.isArray(req.questions) ? req.questions : []).filter((q) => q && q.question).slice(0, 4);
    if (!questions.length) throw new Error('no questions');
    const rf = require('./requestForm');
    let live = null;
    try { live = require('./claudeSessions').liveSessions().find((x) => x.id === req.sessionId); } catch (_) { /* unknown */ }
    const title = String((live && live.name) || path.basename(String(req.cwd || '')) || String(req.sessionId || 'A Claude session').slice(0, 8)).slice(0, 40);
    const account = accountNameOf(req.configDir);
    const form = rf.normalizeRequestForm({ title: `${title} asks`, submitLabel: 'Answer', fields: askFields(questions) });
    form.fields.unshift({ id: 'session', label: `Session: ${title}${account ? ` (${account})` : ''}`.slice(0, 80), type: 'text', sub: 'Read only: the Claude session that asks', data: { default: String(req.sessionId || '').slice(0, 8), placeholder: '', options: [], required: false, min: null, max: null, step: null } });
    const id = rf.askRequestForm(gResources, { title: form.title, submitLabel: form.submitLabel, fields: form.fields, chatId: null, claude: { sessionId: String(req.sessionId || ''), question: String(questions[0].question).slice(0, 200), count: questions.length } });
    onId(id);
    const deadline = Date.now() + ASK_WAIT_MS;
    let ans = null;
    while (Date.now() < deadline) {
        ans = await rf.awaitRequestForm(id);
        if (!ans.pending) break;
        ans = null;
    }
    if (!ans) { rf.submitRequestForm({ id, cancelled: true }); return { ok: true, timeout: true }; }
    if (ans.cancelled || !ans.values) return { ok: true, timeout: true };
    const answers = {};
    questions.forEach((q, i) => {
        const v = ans.values;
        const other = String(v[`q${i}_other`] || '').trim();
        let a;
        if (other) a = other;
        else if (q.multiSelect === true) a = (q.options || []).filter((o, j) => v[`q${i}_o${j}`] === true).map((o) => String((o && o.label) || o)).join(', ');
        else a = String(v[`q${i}`] || '').replace(/^__other__$/, '');
        answers[q.question] = a;
    });
    return { ok: true, answers };
}

// Fleet tools for every agent (agent-coord fleet_*): read-only views, plus update / hold / cancel of the items the
// caller itself queued (source 'agent', sourceRef 'agent:<its id>#<n>'). Starting is Yukimi's: there is no start op.
const FLEET_OPS = ['fleet_status', 'fleet_work_list', 'fleet_work_get', 'fleet_work_update', 'fleet_work_hold', 'fleet_work_cancel', 'fleet_session_read', 'fleet_maintenance_report'];
function ownsWork(w, by) { return !!by && w.source === 'agent' && String(w.sourceRef || '').startsWith(`agent:${by}#`); }
async function fleetOp(req) {
    const fm = require('./claudeFleetMcp');
    const op = req.op;
    if (op === 'fleet_status') return fm.overview(gResources);
    if (op === 'fleet_work_list' || op === 'fleet_work_get') return fm.workDispatch(module.exports, op, { id: req.id, state: req.state, search: req.search, limit: req.limit });
    if (op === 'fleet_session_read') return fm.sessionBrief(gResources, req.session);
    if (op === 'fleet_maintenance_report') return fm.maintenanceBrief();
    // update / hold / cancel: only the caller's own items
    const by = String(req.by || '').slice(0, 80);
    const w = getWork(req.id);
    if (!w) throw new Error(`No work item ${req.id}`);
    if (!ownsWork(w, by)) throw new Error(`Work item ${w.id} was not queued by you (${w.source}): only Yukimi or its creator changes it. Ask her, or coord_post the Supervisor's note`);
    if (op === 'fleet_work_update') {
        const f = {};
        ['title', 'prompt', 'appendNote', 'model', 'effort'].forEach((k) => { if (req[k] !== undefined) f[k] = req[k]; });
        const u = updateWork(w.id, f, { by });
        return { item: fm.workRow(u), changed: Object.keys(f) };
    }
    const u = op === 'fleet_work_hold' ? holdWork(w.id) : cancelWork(w.id);
    if (op === 'fleet_work_cancel' && req.reason) setWork(w.id, { message: `Cancelled by ${by}: ${String(req.reason).slice(0, 300)}` });
    return { item: fm.workRow(getWork(u.id)) };
}

let sockServer = null;
function serveSocket() {
    const file = socketPath();
    try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); } catch (_) { /* there */ }
    try { fs.unlinkSync(file); } catch (_) { /* none */ }
    sockServer = net.createServer((sock) => {
        let buf = '';
        sock.setEncoding('utf8');
        sock.setTimeout(CALL_TIMEOUT_MS + 15000, () => sock.destroy());
        let asking = null; // ask_user: the request form id while the hook waits
        sock.on('close', () => { if (asking) { try { require('./requestForm').submitRequestForm({ id: asking, cancelled: true }); } catch (_) { /* gone */ } } });
        sock.on('data', async (chunk) => {
            buf += chunk;
            const i = buf.indexOf('\n');
            if (i < 0) { if (buf.length > (/^\{"op":"(ask_user|enqueue|fleet_work_update)"/.test(buf) ? 262144 : 4096)) sock.destroy(); return; }
            let req = null;
            try { req = JSON.parse(buf.slice(0, i)); } catch (_) { req = null; }
            buf = '';
            let out;
            try {
                if (!req || !['check', 'enqueue', 'pause', 'resume', 'ask_user'].concat(FLEET_OPS).includes(req.op)) throw new Error('op must be check, enqueue, pause, resume, ask_user or a fleet_* op');
                if (FLEET_OPS.includes(req.op)) {
                    out = { ok: true, result: await fleetOp(req) };
                } else if (req.op === 'ask_user') {
                    sock.setTimeout(0); // a person answers: the hook's own timeout bounds the wait
                    out = await askUser(req, (id) => { asking = id; });
                    asking = null;
                } else if (req.op === 'pause' || req.op === 'resume') {
                    // an agent asks: hold only (freeze is Fleet's)
                    const r = req.op === 'pause'
                        ? await pauseSession(String(req.sessionId || ''), { mode: 'hold', reason: String(req.reason || '').slice(0, 300), by: String(req.by || 'an agent').slice(0, 80), kind: 'agent' })
                        : await resumeSession(String(req.sessionId || ''), { note: `by ${String(req.by || 'an agent').slice(0, 80)}` });
                    out = { ok: true, result: r };
                } else if (req.op === 'enqueue') {
                    const w = enqueue({ title: req.title, prompt: req.prompt, cwd: req.cwd, model: req.model, effort: req.effort, engine: req.engine, startNow: req.startNow === true, source: 'agent', sourceRef: req.sourceRef || null });
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
    // fleet issues filed on Yozora come in, closed ones end their item (server side, every 10 min; Fleet's own reads pull too)
    pullIssues(gr, { force: true }).catch(() => {});
    if (!pullTimer) { pullTimer = setInterval(() => pullIssues(null, { force: true }).catch(() => {}), 10 * 60 * 1000); if (pullTimer.unref) pullTimer.unref(); }
}
let pullTimer = null;

function stop() {
    if (watcher) { try { watcher.close(); } catch (_) { /* closed */ } watcher = null; }
    clearTimeout(debounce);
    if (sockServer) { try { sockServer.close(); } catch (_) { /* closed */ } sockServer = null; }
    if (pullTimer) { clearInterval(pullTimer); pullTimer = null; }
}

// ---------------------------------------------------------------- rules review (Fleet > Rules > Rules Review)
// The agent rules (.cursor/rules/*.mdc, imported by CLAUDE.md or indexed in its Rules on demand table). Cheap file checks run first (rules missing from both,
// named files that no longer exist, non-English text); the Supervisor's engine then reads the rules in a few
// chunks for contradictions, overlap and unclear wording. The result is kept in the coord DB; clients see it
// through the status push (emit), never by polling.

const RULES_REPO = path.join(__dirname, '..');
const RULES_CHUNK_CHARS = 36000;   // one engine call's rule text (a DeepSeek Flash context holds far more)
const RULES_MAX_CALLS = 4;         // the short budget
const RULES_EXCERPT = 900;         // chars of each rule shown to the cross-rule pass
let rulesRun = null;               // { startedAt, done, total, step }

function rulesDb() {
    const d = db();
    d.exec(`CREATE TABLE IF NOT EXISTS supervisor_rules_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, engine TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
        rule_count INTEGER NOT NULL DEFAULT 0, findings TEXT NOT NULL DEFAULT '[]', error TEXT NOT NULL DEFAULT ''
    )`);
    return d;
}

function rulesPaths(opts = {}) {
    const repo = opts.repo || RULES_REPO;
    return { repo, dir: opts.dir || path.join(repo, '.cursor', 'rules'), claudeMd: opts.claudeMd || path.join(repo, 'CLAUDE.md') };
}

function frontmatterOf(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    const fm = {};
    if (m) m[1].split(/\r?\n/).forEach((l) => { const k = /^(\w[\w-]*):\s*(.*)$/.exec(l); if (k) fm[k[1]] = k[2].replace(/^["']|["']$/g, ''); });
    return { fm, body: m ? text.slice(m[0].length) : text };
}

/** Every rule file with its metadata (text only when withText). */
function listRules(opts = {}) {
    const { dir } = rulesPaths(opts);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /\.mdc$/.test(n)).sort(); } catch (_) { names = []; }
    return names.map((file) => {
        const p = path.join(dir, file);
        let st = null; let text = '';
        try { st = fs.statSync(p); text = fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
        const { fm, body } = frontmatterOf(text);
        const r = { name: file.replace(/\.mdc?$/, ''), file, description: fm.description || '', alwaysApply: fm.alwaysApply === 'true', size: st.size, mtime: st.mtimeMs };
        if (opts.withText) { r.text = text; r.body = body; }
        return r;
    }).filter(Boolean);
}

function ruleText(name, opts = {}) {
    const r = listRules(Object.assign({}, opts, { withText: true })).find((x) => x.name === String(name));
    if (!r) throw new Error('No such rule');
    return { name: r.name, file: r.file, text: r.text };
}

/** Checks that need no model. Findings: { rules, kind, severity, text, suggestion }. */
function staticRuleFindings(rules, opts = {}) {
    const { repo, claudeMd } = rulesPaths(opts);
    const out = [];
    let md = '';
    try { md = fs.readFileSync(claudeMd, 'utf8'); } catch (_) { /* none */ }
    const listed = new Set();
    (md.match(/^@\S+$/gm) || []).forEach((l) => { const m = /\.cursor\/rules\/([^/\s]+?)\.mdc?$/.exec(l); if (m) { listed.add(m[1]); } });
    // rules indexed on demand: a table row of CLAUDE.md that starts with the rule's path in backticks counts as listed too
    (md.match(/^\|\s*`\.cursor\/rules\/[^`|\s]+?\.mdc?`/gm) || []).forEach((l) => { const m = /\.cursor\/rules\/([^/`\s]+?)\.mdc?`/.exec(l); if (m) { listed.add(m[1]); } });
    const have = new Set(rules.map((r) => r.name));
    if (md) {
        rules.forEach((r) => { if (!listed.has(r.name)) out.push({ rules: [r.name], kind: 'missing-import', severity: 'medium', text: `${r.file} is neither in the @ list nor in the Rules on demand table of CLAUDE.md, so Claude Code never learns of it.`, suggestion: `Add @.cursor/rules/${r.file} to CLAUDE.md (rules every session needs), or a row to its Rules on demand table, or delete the rule if it is retired.` }); });
        listed.forEach((n) => { if (!have.has(n)) out.push({ rules: ['CLAUDE.md'], kind: 'missing-file', severity: 'high', text: `CLAUDE.md lists ${n}.mdc (import or Rules on demand row) but that rule file does not exist.`, suggestion: 'Remove the line or restore the rule.' }); });
    }
    const exists = (p) => {
        const clean = p.replace(/[:#]\d+(-\d+)?$/, '').replace(/^~\//, `${os.homedir()}/`);
        if (/[*<>{}$]/.test(clean) || /^https?:/.test(clean)) return true;
        return [path.resolve(repo, clean), path.resolve(repo, '.cursor', 'rules', clean), path.isAbsolute(clean) ? clean : ''].some((x) => x && fs.existsSync(x));
    };
    rules.forEach((r) => {
        const seen = new Set();
        (r.body.match(/`[^`\n]{3,120}`/g) || []).map((t) => t.slice(1, -1).trim()).forEach((t) => {
            const toks = /^node\s+(\S+)/.exec(t) ? [/^node\s+(\S+)/.exec(t)[1]] : [t];
            toks.forEach((p) => {
                // only paths with a folder: a bare file name may live in another repo (the app, the docs) where this check cannot look
                if (seen.has(p) || /\s/.test(p) || !/^(~\/|\.\/)?(scripts|modules|apps|docs|public|\.cursor|\.githooks|config)\/[\w./-]+\.\w+(?::\d+)?$/.test(p)) return;
                seen.add(p);
                if (!exists(p)) out.push({ rules: [r.name], kind: 'outdated-reference', severity: 'medium', text: `${r.file} names \`${p}\`, which does not exist.`, suggestion: 'Update the path or remove the reference if it was renamed or deleted.' });
            });
        });
        const cjk = (r.text.match(/[぀-ヿ㐀-鿿가-힯Ѐ-ӿ]/g) || []).length;
        if (cjk > 20) out.push({ rules: [r.name], kind: 'not-english', severity: 'medium', text: `${r.file} has ${cjk} characters that are not English or Latin script.`, suggestion: 'Rules are written in English only; translate the text.' });
        if (!r.description) out.push({ rules: [r.name], kind: 'unclear', severity: 'low', text: `${r.file} has no description in its front matter, so nobody can tell when it applies.`, suggestion: 'Add a one-sentence description.' });
    });
    return out;
}

const RULES_SYSTEM = 'You audit the written rules that steer a team of coding agents. You get the full text of some rules and a short list of every rule (name and description) for cross-checking. Find REAL problems only, no style nitpicks: "contradiction" (two rules demand incompatible things), "duplicate" (rules that say the same thing and should be merged), "unclear" (wording an agent cannot act on or check), "unenforceable" (asks for something no agent or script can verify), "outdated" (names a thing that the other rules show was replaced). Quote the rule names exactly as given. At most 12 findings; none is a valid answer. Answer ONLY {"findings":[{"rules":["name"],"kind":"contradiction|duplicate|unclear|unenforceable|outdated","severity":"high|medium|low","text":"the problem in one or two sentences","suggestion":"the concrete fix"}]}.';
const RULE_KINDS = ['contradiction', 'duplicate', 'unclear', 'unenforceable', 'outdated', 'not-english', 'missing-import', 'missing-file', 'outdated-reference'];

function cleanFinding(f, names, idx) {
    const o = f && typeof f === 'object' ? f : {};
    const rs = (Array.isArray(o.rules) ? o.rules : [o.rule]).map((x) => String(x || '').replace(/\.mdc?$/, '').slice(0, 80)).filter(Boolean).slice(0, 6);
    const text = String(o.text || '').trim().slice(0, 700);
    if (!text) return null;
    return { id: String(idx), rules: rs.filter((x) => names.has(x) || x === 'CLAUDE.md'), kind: RULE_KINDS.includes(o.kind) ? o.kind : 'unclear', severity: ['high', 'medium', 'low'].includes(o.severity) ? o.severity : 'medium', text, suggestion: String(o.suggestion || '').trim().slice(0, 500), dismissed: false };
}

function rulesReviewRow(r) {
    if (!r) return null;
    let findings = [];
    try { findings = JSON.parse(r.findings); } catch (_) { findings = []; }
    return { id: r.id, at: r.at, engine: r.engine, model: r.model, ruleCount: r.rule_count, findings, error: r.error || '' };
}

function lastRulesReview() {
    return rulesReviewRow(rulesDb().prepare('SELECT * FROM supervisor_rules_reviews ORDER BY id DESC LIMIT 1').get());
}

/** What the console shows: the rules, the last review and whether one is running. */
function rulesState(opts = {}) {
    return { rules: listRules(opts), last: lastRulesReview(), running: rulesRun ? Object.assign({}, rulesRun) : null };
}

/**
 * Runs a rules review (one at a time) and stores it. Pushes a status change at the start, after each engine call
 * and at the end. Answers the stored review.
 */
async function reviewRules(gr, opts = {}) {
    if (rulesRun) throw new Error('A rules review is already running');
    const rules = listRules(Object.assign({}, opts, { withText: true }));
    if (!rules.length) throw new Error('No rules were found');
    const names = new Set(rules.map((r) => r.name));
    const g = gr || gResources;
    const findings = staticRuleFindings(rules, opts);
    // the cross-rule pass: each chunk holds full rule texts; every chunk also sees the one-line list of all rules
    const index = rules.map((r) => `- ${r.name}: ${r.description.slice(0, 220)}`).join('\n');
    const chunks = [];
    let cur = []; let size = 0;
    rules.forEach((r) => {
        const body = `=== ${r.name} ===\n${r.body.slice(0, 7000)}`;
        if (cur.length && size + body.length > RULES_CHUNK_CHARS) { chunks.push(cur); cur = []; size = 0; }
        cur.push(body); size += body.length;
    });
    if (cur.length) chunks.push(cur);
    const calls = chunks.slice(0, RULES_MAX_CALLS);
    const hints = findings.filter((f) => f.kind === 'outdated-reference').map((f) => f.text).join('\n');
    rulesRun = { startedAt: Date.now(), done: 0, total: calls.length, step: 'Checking the files' };
    emit({ rules: true });
    let engine = ''; let model = ''; let error = '';
    try {
        for (let i = 0; i < calls.length; i += 1) {
            rulesRun.step = `Reading rules, part ${i + 1} of ${calls.length}`;
            emit({ rules: true });
            const user = `All rules (name: description):\n${index}\n\nFile checks already found:\n${hints || '(none)'}\n\nRules to audit in this part:\n\n${calls[i].join('\n\n')}`;
            try {
                const o = await askJson(g, RULES_SYSTEM, user, 'rules');
                const arr = o && Array.isArray(o.findings) ? o.findings : [];
                arr.forEach((f) => { const c = cleanFinding(f, names, 0); if (c && !['not-english', 'missing-import', 'missing-file', 'outdated-reference'].includes(c.kind)) findings.push(c); });
            } catch (e) { error = e.message.slice(0, 300); break; }
            rulesRun.done = i + 1;
        }
        try { const s = settings(g); engine = s.engine || ''; model = s.model || DEFAULT_MODEL || ''; } catch (_) { /* unknown */ }
        // later calls may have failed over: the usage table knows the last model that answered
        try { const u = db().prepare("SELECT engine, model FROM supervisor_usage WHERE kind = 'rules' AND ok = 1 ORDER BY id DESC LIMIT 1").get(); if (u) { engine = u.engine; model = u.model || model; } } catch (_) { /* none */ }
    } finally {
        rulesRun = null;
    }
    const final = findings.map((f, i) => Object.assign({}, f, { id: String(i), dismissed: false }));
    const ins = rulesDb().prepare('INSERT INTO supervisor_rules_reviews (at, engine, model, rule_count, findings, error) VALUES (?, ?, ?, ?, ?, ?)').run(Date.now(), engine, model, rules.length, JSON.stringify(final), error);
    const rv = rulesReviewRow(rulesDb().prepare('SELECT * FROM supervisor_rules_reviews WHERE id = ?').get(ins.lastInsertRowid));
    emit({ rules: true });
    return rv;
}

/** Start in the background: answers at once; the result arrives through the status push. */
function startRulesReview(gr, opts = {}) {
    if (rulesRun) throw new Error('A rules review is already running');
    reviewRules(gr, opts).catch((e) => { console.warn(`[supervisor] rules review: ${e.message}`); emit({ rules: true }); });
    return { running: true };
}

function dismissRuleFinding(findingId) {
    const r = lastRulesReview();
    if (!r) throw new Error('No rules review yet');
    const f = r.findings.find((x) => String(x.id) === String(findingId));
    if (!f) throw new Error('No such finding');
    f.dismissed = true;
    rulesDb().prepare('UPDATE supervisor_rules_reviews SET findings = ? WHERE id = ?').run(JSON.stringify(r.findings), r.id);
    emit({ rules: true });
    return lastRulesReview();
}

module.exports = {
    listRules, ruleText, rulesState, reviewRules, startRulesReview, dismissRuleFinding, staticRuleFindings,
    start, stop, bind, settings, askJson, callEngine, spend, priceCall, engineChain, TOPOLOGIES, cleanStages, decideTopology, splitSurfaces, settleParent, pauseSession, resumeSession, listHolds, activeHold, checkCollisions, pullIssues, ensureIssue, syncIssue, enqueue, pumpWork, listWork, getWork, setWork, workPrompt, updateWork, startWork, holdWork, SUP_EFFORTS, cancelWork, intakePlaud, workAfterReview, markSupervised, isSupervised, lockStatus, removeLockFile, sweepLocks, artifactStatus, refreshArtifacts, cleanArtifact, restoreArtifact, purgeTrash, forgetArtifact, afterTurn, saveSettings, engines, review, send, dismiss, listReviews, getReview, summary, onReview, socketPath, repoRoots, emitChange: () => emit({ maintenance: true }),
    DEFAULT_ENGINE, DEFAULT_MODEL, STEER_PREFIX,
    _test: { turnOf, capTurn, parseVerdict, promptFor, scan, statusBySession, setFetch: _setFetch, resetPrices, queueReview, queue, cleanable }
};
