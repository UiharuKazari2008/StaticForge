'use strict';

/**
 * Where the usage goes (Yukimi, Nov 24 2026: "a good way to show each work item + session + turn + agents usage to help
 * identify model efficiency, as well as auto flag when an agent or session has been burning a lot of usage"):
 *
 *   scan(opts)           reads every Claude Code transcript touched in the window (the host's ~/.claude and every account's
 *                        config dir), sessions and their background agents (<session>/subagents/agent-*.jsonl), once and then
 *                        only the bytes appended (cached by path and size, in memory; a restart reads the window again)
 *   tree(opts)           work items -> sessions -> turns -> agents with tokens, model, effort, duration, tool calls, files
 *                        edited and the efficiency figures, for Fleet > Usage
 *   detail(kind, id)     one row's breakdown (models, tools, notes)
 *   flags: evaluate(sessionId) on a turn end (the Supervisor emits { turnEnd } when a session's turn has settled: no timer
 *                        of ours), evaluateAll() for the maintenance check; stored in coord.db usage_flags
 *   checkUsage(ctx)      the maintenance check "Usage review" (fleetMaintenance)
 *
 * A turn is a human message up to the answers before the next human message; its figures are the session's own
 * messages (background agents are separate transcripts and are attached to the turn they started in).
 * Tokens: "fresh" = input + output + cache writes (what a turn adds), "cache read" = re-read context. A cost-equivalent is
 * shown only for models whose prices were typed into agentSupervisor.usageFlags.prices ($ per million tokens: { opus:
 * { in, out, cacheRead, cacheWrite } }, keyed by family or model id); there is no built-in price table (never invented).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CHUNK = 4 * 1024 * 1024;
const DAY = 86400000;
const HOUR = 3600000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const WRAPPER_RE = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|user-prompt-submit-hook|bash-input|bash-stdout|bash-stderr|task-notification)/i;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT_FILE_RE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;
const BIG_RESULT = 60000; // a tool result line this long (characters) pulled a lot into the context
const MAX_FILES = 600;
const REASONS = {
    turn_tokens: 'Heavy turn', burn_rate: 'High burn rate', agent_tokens: 'Heavy agent', cache_ratio: 'Poor cache reuse', model_over: 'Model above the policy'
};
const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'];

const coord = () => require('./agentCoord/store');
const sup = () => require('./agentSupervisor');

let gResources = null;
let supMod = null;

// ---------------------------------------------------------------- settings

const DEFAULTS = {
    enabled: true,
    turnTokens: 1000000, // fresh tokens (input + output + cache writes) of one turn with its agents
    tokensPerHour: 2500000, // fresh tokens of a session and its agents in the last hour
    agentTokens: 600000, // fresh tokens of one agent
    cacheRatioMin: 0.8, // cache reads / (cache reads + fresh input) under this on a long session
    cacheRatioMinCalls: 60,
    modelOverPolicy: true,
    notify: true,
    fileWorkItem: false, // the maintenance check files a held work item for its findings
    prices: {}
};

function settings(gr) {
    let c = {};
    try { const g = gr || gResources; c = ((g && g.getConfig && g.getConfig().agentSupervisor) || {}).usageFlags || {}; } catch (_) { c = {}; }
    const num = (v, d, lo) => (Number.isFinite(Number(v)) && Number(v) >= lo ? Number(v) : d);
    return {
        enabled: c.enabled !== false,
        turnTokens: num(c.turnTokens, DEFAULTS.turnTokens, 1),
        tokensPerHour: num(c.tokensPerHour, DEFAULTS.tokensPerHour, 1),
        agentTokens: num(c.agentTokens, DEFAULTS.agentTokens, 1),
        cacheRatioMin: Math.min(1, num(c.cacheRatioMin, DEFAULTS.cacheRatioMin, 0)),
        cacheRatioMinCalls: num(c.cacheRatioMinCalls, DEFAULTS.cacheRatioMinCalls, 1),
        modelOverPolicy: c.modelOverPolicy !== false,
        notify: c.notify !== false,
        fileWorkItem: c.fileWorkItem === true,
        prices: c.prices && typeof c.prices === 'object' ? c.prices : {}
    };
}

// ---------------------------------------------------------------- the transcript parser (pure)

const zero = () => ({ i: 0, o: 0, cw: 0, cr: 0 });

function newUnit(n, text, at) {
    return {
        n, text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140), startAt: at || null, endAt: at || null,
        byModel: {}, calls: 0, tools: 0, toolNames: {}, files: [], efforts: {}, ctxSum: 0, ctxMax: 0, big: 0, images: 0, maxRepeat: 0, repeats: new Map(), stop: ''
    };
}

function createState(opts = {}) {
    return { agent: opts.agent === true, offset: 0, cwd: '', firstAt: null, lastAt: null, firstText: '', turns: [], cur: null, whole: newUnit(0, '', null), recent: new Map(), version: 0 };
}

function blockText(c) {
    if (typeof c === 'string') return c;
    if (!Array.isArray(c)) return '';
    return c.map((b) => (b && b.type === 'text' ? b.text || '' : '')).join('\n');
}

function addUsage(unit, model, d, first, ctx) {
    const m = unit.byModel[model] || (unit.byModel[model] = Object.assign(zero(), { calls: 0 }));
    m.i += d.i; m.o += d.o; m.cw += d.cw; m.cr += d.cr;
    if (first) { m.calls += 1; unit.calls += 1; unit.ctxSum += ctx; if (ctx > unit.ctxMax) unit.ctxMax = ctx; }
}

function feed(s, line) {
    if (!line || line.length < 20) return;
    const isAssistant = line.includes('"type":"assistant"');
    // tool results: only their size and pictures are counted (no parse; they are the big lines)
    if (!isAssistant && line.includes('"tool_result"')) {
        const u = s.agent ? s.whole : s.cur;
        if (u) {
            if (line.length > BIG_RESULT) { u.big += 1; s.whole.big += s.agent ? 0 : 1; }
            const im = line.split('"type":"image"').length - 1;
            if (im) { u.images += im; if (!s.agent) s.whole.images += im; }
        }
        return;
    }
    const isUser = !isAssistant && line.includes('"type":"user"');
    if (!isAssistant && !isUser) return;
    let o;
    try { o = JSON.parse(line); } catch (_) { return; }
    const at = o.timestamp || null;
    if (at) { s.lastAt = at; if (!s.firstAt) s.firstAt = at; }
    if (o.cwd) s.cwd = o.cwd;
    if (isUser) {
        if (s.agent || o.isMeta || o.isSidechain) return;
        const kind = o.origin && o.origin.kind;
        if (kind && kind !== 'human') return;
        const t = blockText(o.message && o.message.content);
        if (!t.trim() || WRAPPER_RE.test(t)) return;
        if (!s.firstText) s.firstText = t.replace(/\s+/g, ' ').trim().slice(0, 140);
        s.cur = newUnit(s.turns.length + 1, t, at);
        s.turns.push(s.cur);
        s.recent.clear();
        return;
    }
    if (o.isSidechain && !s.agent) return;
    const m = o.message || {};
    if (!s.agent && !s.cur) { s.cur = newUnit(s.turns.length + 1, '(continued)', at); s.turns.push(s.cur); }
    const unit = s.agent ? s.whole : s.cur;
    const model = m.model && m.model !== '<synthetic>' ? String(m.model) : '';
    const eff = o.perTurnEffort || o.effort;
    if (eff && typeof eff === 'string') { unit.efforts[eff] = (unit.efforts[eff] || 0) + 1; if (unit !== s.whole) s.whole.efforts[eff] = (s.whole.efforts[eff] || 0) + 1; }
    const u = m.usage;
    if (u && typeof u === 'object' && model) {
        const cur = { i: Number(u.input_tokens) || 0, o: Number(u.output_tokens) || 0, cw: Number(u.cache_creation_input_tokens) || 0, cr: Number(u.cache_read_input_tokens) || 0 };
        const id = m.id || o.uuid || '';
        const prev = id && s.recent.get(id);
        const d = { i: cur.i - (prev ? prev.i : 0), o: cur.o - (prev ? prev.o : 0), cw: cur.cw - (prev ? prev.cw : 0), cr: cur.cr - (prev ? prev.cr : 0) };
        const first = !prev;
        const ctx = cur.i + cur.cw + cur.cr;
        addUsage(unit, model, d, first, ctx);
        if (unit !== s.whole) addUsage(s.whole, model, d, first, ctx);
        if (id) { s.recent.set(id, cur); if (s.recent.size > 64) s.recent.delete(s.recent.keys().next().value); }
    }
    if (at) { unit.endAt = at; if (!unit.startAt) unit.startAt = at; if (unit !== s.whole) { s.whole.endAt = at; if (!s.whole.startAt) s.whole.startAt = at; } }
    if (m.stop_reason) unit.stop = m.stop_reason;
    (Array.isArray(m.content) ? m.content : []).forEach((b) => {
        if (!b || b.type !== 'tool_use') return;
        const both = unit === s.whole ? [unit] : [unit, s.whole];
        const key = `${b.name}:${JSON.stringify(b.input || {}).slice(0, 160)}`;
        both.forEach((x) => {
            x.tools += 1;
            x.toolNames[b.name] = (x.toolNames[b.name] || 0) + 1;
            const n = (x.repeats.get(key) || 0) + 1;
            x.repeats.set(key, n);
            if (x.repeats.size > 300) x.repeats.delete(x.repeats.keys().next().value);
            if (n > x.maxRepeat) x.maxRepeat = n;
            if (EDIT_TOOLS.has(b.name)) {
                const f = (b.input && (b.input.file_path || b.input.notebook_path)) || '';
                if (f && !x.files.includes(f) && x.files.length < 400) x.files.push(f);
            }
        });
    });
}

// ---------------------------------------------------------------- the cached file reader

const files = new Map(); // path -> { state, size, mtimeMs, pending }

async function advance(ent, file, size) {
    if (size < ent.state.offset) ent.state = createState({ agent: ent.state.agent });
    const st = ent.state;
    let len = CHUNK;
    const fh = await fs.promises.open(file, 'r');
    try {
        while (st.offset < size) {
            const from = st.offset;
            const want = Math.min(len, size - from);
            const buf = Buffer.alloc(want);
            await fh.read(buf, 0, want, from);
            const last = buf.lastIndexOf(0x0a);
            if (last < 0) {
                if (from + want >= size) break; // a line still being written
                if (len >= 256 * 1024 * 1024) { st.offset = from + want; continue; }
                len *= 2;
                continue;
            }
            const lines = buf.subarray(0, last + 1).toString('utf8').split('\n');
            for (let i = 0; i < lines.length; i += 1) feed(st, lines[i]);
            st.offset = from + last + 1;
            await new Promise((r) => setImmediate(r)); // the server keeps answering during a big first read
        }
    } finally { await fh.close(); }
}

async function readFile(file, st, agent) {
    let ent = files.get(file);
    if (!ent) {
        if (files.size >= MAX_FILES) files.delete(files.keys().next().value);
        ent = { state: createState({ agent }), size: -1, mtimeMs: 0, pending: null };
        files.set(file, ent);
    }
    if (ent.size === st.size && !ent.pending) return ent.state;
    if (!ent.pending) ent.pending = advance(ent, file, st.size).then(() => { ent.size = st.size; ent.mtimeMs = st.mtimeMs; }).finally(() => { ent.pending = null; });
    await ent.pending;
    return ent.state;
}

// ---------------------------------------------------------------- finding transcripts

function claudeHome() { return process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(); }

/** Every config dir that holds transcripts: the host's and each account's own folder. */
function configDirs(opts = {}) {
    if (Array.isArray(opts.dirs)) return opts.dirs.map((d) => ({ dir: d, account: '' }));
    const out = [{ dir: path.join(claudeHome(), '.claude'), account: 'host' }];
    const root = process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR || path.join(__dirname, '..', '.cache', 'secrets', 'claude-accounts');
    let ids = [];
    try { ids = fs.readdirSync(root); } catch (_) { ids = []; }
    ids.forEach((id) => { const d = path.join(root, id, 'config'); try { if (fs.statSync(d).isDirectory()) out.push({ dir: d, account: id }); } catch (_) { /* none */ } });
    return out;
}

function accountNames(gr) {
    const names = new Map();
    try { require('./claudeAccountHost').listAccounts(gr || gResources).forEach((a) => names.set(a.id, a.name || a.id)); } catch (_) { /* no accounts */ }
    return names;
}

async function listTranscripts(opts, cutoff) {
    const out = [];
    for (const { dir, account } of configDirs(opts)) {
        const proj = path.join(dir, 'projects');
        let ds = [];
        try { ds = await fs.promises.readdir(proj); } catch (_) { continue; }
        for (const d of ds) {
            let names = [];
            try { names = await fs.promises.readdir(path.join(proj, d)); } catch (_) { continue; }
            for (const f of names) {
                const id = f.replace(/\.jsonl$/, '');
                if (f === id || !SESSION_ID_RE.test(id)) continue;
                const file = path.join(proj, d, f);
                let st;
                try { st = await fs.promises.stat(file); } catch (_) { continue; }
                // a session counts when its transcript or any agent file moved inside the window
                let touched = st.mtimeMs;
                const own = path.join(proj, d, id, 'subagents');
                let agentFiles = [];
                try { agentFiles = (await fs.promises.readdir(own)).filter((n) => AGENT_FILE_RE.test(n)); } catch (_) { agentFiles = []; }
                const agents = [];
                for (const n of agentFiles) {
                    let ast; try { ast = await fs.promises.stat(path.join(own, n)); } catch (_) { continue; }
                    if (ast.mtimeMs > touched) touched = ast.mtimeMs;
                    agents.push({ file: path.join(own, n), id: AGENT_FILE_RE.exec(n)[1], st: ast, own });
                }
                if (touched < cutoff) continue;
                out.push({ id, file, st, project: d, account, agents, touched });
            }
        }
    }
    return out;
}

async function readMeta(own, agentId) {
    try { return JSON.parse(await fs.promises.readFile(path.join(own, `agent-${agentId}.meta.json`), 'utf8')); } catch (_) { return {}; }
}

let scanning = null;

/** Reads every session touched in the last opts.days days (default 1). Resolves { sessions, at }. */
async function scan(opts = {}) {
    const now = opts.now || Date.now();
    const cutoff = now - (Number(opts.days) > 0 ? Number(opts.days) : 1) * DAY;
    const run = async () => {
        const list = await listTranscripts(opts, cutoff);
        const bySession = new Map();
        for (const t of list) { const prev = bySession.get(t.id); if (!prev || t.touched > prev.touched) bySession.set(t.id, t); }
        const sessions = [];
        for (const t of bySession.values()) {
            const s = await sessionOf(t);
            if (s) sessions.push(s);
        }
        return { sessions, at: Date.now(), cutoff };
    };
    if (opts.only) {
        const list = (await listTranscripts(opts, 0)).filter((t) => t.id === opts.only);
        const s = list.length ? await sessionOf(list[0]) : null;
        return { sessions: s ? [s] : [], at: Date.now(), cutoff: 0 };
    }
    if (!scanning) scanning = run().finally(() => { scanning = null; });
    const mine = scanning;
    return mine;
}

async function sessionOf(t) {
    const st = await readFile(t.file, t.st, false).catch(() => null);
    if (!st) return null;
    const agents = [];
    for (const a of t.agents) {
        const ast = await readFile(a.file, a.st, true).catch(() => null);
        if (!ast || !ast.whole.calls) continue;
        const meta = await readMeta(a.own, a.id);
        agents.push({ id: a.id, description: String(meta.description || '').replace(/\s+/g, ' ').slice(0, 160) || a.id, type: String(meta.agentType || ''), metaModel: String(meta.model || ''), pickedModel: String(meta.pickedEffortModel || ''), finished: meta.finished === true, background: meta.requestShape === 'background', firstAt: ast.firstAt, lastAt: ast.lastAt, mtimeMs: a.st.mtimeMs, unit: ast.whole });
    }
    return { id: t.id, file: t.file, project: t.project, account: t.account, cwd: st.cwd, firstAt: st.firstAt, lastAt: st.lastAt, mtimeMs: t.st.mtimeMs, firstText: st.firstText, turns: st.turns, whole: st.whole, agents };
}

// ---------------------------------------------------------------- figures

const fresh = (tok) => tok.i + tok.o + tok.cw;
function sum(unit) {
    const t = zero();
    Object.values(unit.byModel).forEach((m) => { t.i += m.i; t.o += m.o; t.cw += m.cw; t.cr += m.cr; });
    return t;
}
const ms = (a) => { const n = Date.parse(a || ''); return Number.isFinite(n) ? n : null; };
const familyOf = (model) => { const m = String(model || '').toLowerCase(); if (/mythos/.test(m)) return 'fable'; return FAMILIES.find((f) => m.includes(f)) || ''; };

function priceFor(model, prices) {
    const p = prices && (prices[model] || prices[familyOf(model)]);
    return p && Number.isFinite(Number(p.in)) && Number.isFinite(Number(p.out)) ? p : null;
}
/** Dollars from typed prices, or null when any model used has no price (never a guess). */
function costOf(byModel, prices) {
    let usd = 0;
    for (const [model, t] of Object.entries(byModel)) {
        const p = priceFor(model, prices);
        if (!p) return null;
        const cr = Number.isFinite(Number(p.cacheRead)) ? Number(p.cacheRead) : Number(p.in) * 0.1;
        const cw = Number.isFinite(Number(p.cacheWrite)) ? Number(p.cacheWrite) : Number(p.in) * 1.25;
        usd += (t.i * Number(p.in) + t.o * Number(p.out) + t.cr * cr + t.cw * cw) / 1e6;
    }
    return Math.round(usd * 1e4) / 1e4;
}

const dominant = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k]) => k);

/** A unit (turn, agent or whole session) as the row figures; extra units (agents) add their tokens, tools and files. */
function figures(unit, extras, prices) {
    const tok = sum(unit);
    const byModel = {};
    const merge = (u) => Object.entries(u.byModel).forEach(([k, v]) => { const m = byModel[k] || (byModel[k] = Object.assign(zero(), { calls: 0 })); m.i += v.i; m.o += v.o; m.cw += v.cw; m.cr += v.cr; m.calls += v.calls; });
    merge(unit);
    const all = zero();
    let calls = unit.calls; let tools = unit.tools; let big = unit.big; let images = unit.images;
    const fl = new Set(unit.files);
    Object.assign(all, tok);
    (extras || []).forEach((x) => {
        const t = sum(x); all.i += t.i; all.o += t.o; all.cw += t.cw; all.cr += t.cr; merge(x);
        calls += x.calls; tools += x.tools; big += x.big; images += x.images; x.files.forEach((f) => fl.add(f));
    });
    const freshN = fresh(all);
    const readN = all.cr;
    const startMs = ms(unit.startAt);
    const endMs = Math.max(ms(unit.endAt) || 0, ...(extras || []).map((x) => ms(x.endAt) || 0));
    return {
        tokens: { input: all.i, output: all.o, cacheWrite: all.cw, cacheRead: all.cr, fresh: freshN },
        models: dominant(Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, v.calls]))),
        byModel,
        efforts: dominant(unit.efforts),
        durationMs: startMs && endMs ? Math.max(0, endMs - startMs) : null,
        calls, tools, files: fl.size, big, images, maxRepeat: unit.maxRepeat,
        eff: {
            cacheRatio: all.i + all.cw + all.cr ? readN / (all.i + all.cw + all.cr) : null,
            outPerTool: tools ? Math.round(all.o / tools) : null,
            tokPerFile: fl.size ? Math.round(freshN / fl.size) : null,
            heavyCtx: calls ? Math.round(((unit.ctxSum || 0) + (extras || []).reduce((a, x) => a + x.ctxSum, 0)) / calls) : null
        },
        costUsd: costOf(byModel, prices)
    };
}

// ---------------------------------------------------------------- the tree

function workIndex() {
    const out = { bySession: new Map(), items: new Map() };
    try {
        const list = sup().listWork({ limit: 300 });
        list.forEach((w) => { out.items.set(w.id, w); });
        list.forEach((w) => { if (w.sessionId) out.bySession.set(w.sessionId, w); });
    } catch (_) { /* no supervisor */ }
    return out;
}
function rootOf(w, items) {
    let r = w;
    for (let i = 0; i < 5 && r && r.parentId && items.get(r.parentId); i += 1) r = items.get(r.parentId);
    return r;
}

function titleOfSession(s, w) {
    return (w && w.title) || s.firstText || path.basename(s.cwd || '') || s.id.slice(0, 8);
}

function inWindow(unit, cutoff) { const e = ms(unit.endAt || unit.startAt); return e != null && e >= cutoff; }

/** Rows for the window: a flat list in tree order, each with key, parent, depth, kind and figures. */
async function tree(opts = {}) {
    const days = Number(opts.days) > 0 ? Number(opts.days) : 1;
    const gr = opts.gr || gResources;
    const prices = settings(gr).prices;
    const now = opts.now || Date.now();
    const cutoff = now - days * DAY;
    const sc = opts.scanned || await scan({ days, dirs: opts.dirs, now });
    const wi = opts.work || workIndex();
    const flagRows = flagsList({ all: true });
    const flagBy = new Map();
    flagRows.forEach((f) => { const k = `${f.kind}:${f.sessionId}:${f.ref || ''}`; (flagBy.get(k) || flagBy.set(k, []).get(k)).push(f); });
    const flagOf = (kind, sid, ref) => (flagBy.get(`${kind}:${sid}:${ref || ''}`) || []).filter((f) => !f.ackAt);
    const names = accountNames(gr);

    const sessions = [];
    for (const s of sc.sessions) {
        const turns = s.turns.filter((t) => inWindow(t, cutoff));
        const agents = s.agents.filter((a) => (a.mtimeMs || 0) >= cutoff || (ms(a.lastAt) || 0) >= cutoff);
        if (!turns.length && !agents.length) continue;
        const w = wi.bySession.get(s.id) || null;
        const rows = [];
        const ag = agents.map((a) => ({ a, fig: figures(a.unit, [], prices), start: ms(a.firstAt) || 0 }));
        const turnRows = turns.map((t, i) => {
            const startMs = ms(t.startAt) || 0;
            const nextStart = i + 1 < turns.length ? (ms(turns[i + 1].startAt) || Infinity) : Infinity;
            const mine = ag.filter((x) => x.start >= startMs && x.start < nextStart);
            const fig = figures(t, mine.map((x) => x.a.unit), prices);
            return { t, fig, mine };
        });
        const sessionUnits = turns;
        const allAgents = ag.map((x) => x.a.unit);
        const whole = newUnit(0, '', null);
        sessionUnits.forEach((u) => { Object.entries(u.byModel).forEach(([k, v]) => { const m = whole.byModel[k] || (whole.byModel[k] = Object.assign(zero(), { calls: 0 })); m.i += v.i; m.o += v.o; m.cw += v.cw; m.cr += v.cr; m.calls += v.calls; }); whole.calls += u.calls; whole.tools += u.tools; whole.ctxSum += u.ctxSum; whole.big += u.big; whole.images += u.images; whole.maxRepeat = Math.max(whole.maxRepeat, u.maxRepeat); u.files.forEach((f) => { if (!whole.files.includes(f)) whole.files.push(f); }); Object.entries(u.efforts).forEach(([k, v]) => { whole.efforts[k] = (whole.efforts[k] || 0) + v; }); });
        whole.startAt = turns.length ? turns[0].startAt : (agents[0] && agents[0].firstAt) || null;
        whole.endAt = turns.length ? turns[turns.length - 1].endAt : null;
        const fig = figures(whole, allAgents, prices);
        const rowsOut = [];
        const skey = `s:${s.id}`;
        const sflags = flagOf('session', s.id, '');
        rowsOut.push({ key: skey, kind: 'session', id: s.id, name: titleOfSession(s, w), sub: names.get(s.account) || s.account || '', cwd: s.cwd, workId: w ? w.id : null, flags: sflags, fig, at: s.lastAt });
        turnRows.slice().sort((a, b) => b.fig.tokens.fresh - a.fig.tokens.fresh).slice(0, 40).forEach((r) => {
            const tkey = `t:${s.id}:${r.t.n}`;
            rowsOut.push({ key: tkey, parent: skey, kind: 'turn', id: `${s.id}:${r.t.n}`, name: `Turn ${r.t.n}: ${r.t.text || ''}`, flags: flagOf('turn', s.id, String(r.t.n)), fig: r.fig, at: r.t.endAt });
            r.mine.slice().sort((a, b) => b.fig.tokens.fresh - a.fig.tokens.fresh).forEach((x) => {
                rowsOut.push({ key: `a:${s.id}:${x.a.id}`, parent: tkey, kind: 'agent', id: `${s.id}:${x.a.id}`, name: x.a.description, sub: x.a.type, flags: flagOf('agent', s.id, x.a.id), fig: Object.assign(x.fig, { share: fig.tokens.fresh ? x.fig.tokens.fresh / fig.tokens.fresh : null }), at: x.a.lastAt, background: x.a.background });
            });
        });
        // agents that started before the first turn of the window
        ag.filter((x) => !turnRows.some((r) => r.mine.includes(x))).forEach((x) => {
            rowsOut.push({ key: `a:${s.id}:${x.a.id}`, parent: skey, kind: 'agent', id: `${s.id}:${x.a.id}`, name: x.a.description, sub: x.a.type, flags: flagOf('agent', s.id, x.a.id), fig: Object.assign(x.fig, { share: null }), at: x.a.lastAt, background: x.a.background });
        });
        rows.push(...rowsOut);
        sessions.push({ s, w, rows, fresh: fig.tokens.fresh, fig });
    }
    // work items on top
    const groups = new Map();
    sessions.forEach((x) => {
        const root = x.w ? rootOf(x.w, wi.items) : null;
        const k = root ? `w:${root.id}` : 'w:none';
        (groups.get(k) || groups.set(k, { root, list: [] }).get(k)).list.push(x);
    });
    const out = [];
    [...groups.entries()].map(([key, g]) => {
        const sumTok = zero(); const byModel = {}; let calls = 0; let tools = 0;
        g.list.forEach((x) => { const f = x.fig; sumTok.i += f.tokens.input; sumTok.o += f.tokens.output; sumTok.cw += f.tokens.cacheWrite; sumTok.cr += f.tokens.cacheRead; calls += f.calls; tools += f.tools; Object.entries(f.byModel).forEach(([m, v]) => { const b = byModel[m] || (byModel[m] = Object.assign(zero(), { calls: 0 })); b.i += v.i; b.o += v.o; b.cw += v.cw; b.cr += v.cr; b.calls += v.calls; }); });
        return { key, g, sumTok, byModel, calls, tools };
    }).sort((a, b) => fresh(b.sumTok) - fresh(a.sumTok)).forEach(({ key, g, sumTok, byModel, calls, tools }) => {
        const root = g.root;
        const dur = g.list.reduce((a, x) => a + (x.fig.durationMs || 0), 0);
        const files = g.list.reduce((a, x) => a + x.fig.files, 0);
        const fig = {
            tokens: { input: sumTok.i, output: sumTok.o, cacheWrite: sumTok.cw, cacheRead: sumTok.cr, fresh: fresh(sumTok) },
            models: dominant(Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, v.calls]))), byModel, efforts: [], durationMs: dur || null, calls, tools, files, big: 0, images: 0, maxRepeat: 0,
            eff: { cacheRatio: sumTok.i + sumTok.cw + sumTok.cr ? sumTok.cr / (sumTok.i + sumTok.cw + sumTok.cr) : null, outPerTool: tools ? Math.round(sumTok.o / tools) : null, tokPerFile: files ? Math.round(fresh(sumTok) / files) : null, heavyCtx: null },
            costUsd: costOf(byModel, prices)
        };
        out.push({ key, kind: 'work', id: root ? String(root.id) : '', name: root ? `#${root.id} ${root.title}` : 'Sessions without a work item', sub: root ? root.state : '', flags: [], fig, at: null });
        g.list.sort((a, b) => b.fresh - a.fresh).forEach((x) => {
            const rows = x.rows.map((r) => (r.kind === 'session' ? Object.assign({}, r, { parent: key }) : r));
            out.push(...rows);
        });
    });
    // depth and a flag level per row (a parent shows the worst flag below it)
    const byKey = new Map(out.map((r) => [r.key, r]));
    out.forEach((r) => { let d = 0; let p = r.parent && byKey.get(r.parent); while (p && d < 6) { d += 1; p = p.parent && byKey.get(p.parent); } r.depth = d; r.flagCount = r.flags.length; });
    out.slice().reverse().forEach((r) => { const p = r.parent && byKey.get(r.parent); if (p) p.below = (p.below || 0) + r.flagCount + (r.below || 0); });
    out.forEach((r) => { r.below = r.below || 0; r.flags = r.flags.map((f) => ({ id: f.id, reason: f.reason, text: f.text })); });
    return { rows: out, days, at: sc.at, pricesSet: Object.keys(settings(gr).prices || {}).length > 0, scanning: false };
}

/** Details of one row: model breakdown, tools and notes. kind session|turn|agent, id as the row's id. */
async function detail(kind, id, opts = {}) {
    const days = Number(opts.days) > 0 ? Number(opts.days) : 7;
    const gr = opts.gr || gResources;
    const prices = settings(gr).prices;
    const sid = String(id || '').split(':')[0];
    const sc = await scan({ days: Math.max(days, 30), only: sid, dirs: opts.dirs });
    const s = sc.sessions[0];
    if (!s) throw new Error('No transcript for that session');
    let unit; let extras = []; let title = '';
    if (kind === 'agent') {
        const aid = String(id).split(':')[1];
        const a = s.agents.find((x) => x.id === aid);
        if (!a) throw new Error('No such agent');
        unit = a.unit; title = a.description;
    } else if (kind === 'turn') {
        const n = Number(String(id).split(':')[1]);
        const idx = s.turns.findIndex((t) => t.n === n);
        if (idx < 0) throw new Error('No such turn');
        unit = s.turns[idx]; title = `Turn ${n}`;
        const a0 = ms(unit.startAt) || 0; const a1 = idx + 1 < s.turns.length ? (ms(s.turns[idx + 1].startAt) || Infinity) : Infinity;
        extras = s.agents.filter((a) => (ms(a.firstAt) || 0) >= a0 && (ms(a.firstAt) || 0) < a1).map((a) => a.unit);
    } else {
        unit = s.whole; extras = s.agents.map((a) => a.unit); title = titleOfSession(s, workIndex().bySession.get(s.id));
    }
    const fig = figures(unit, extras, prices);
    const toolNames = {};
    [unit].concat(extras).forEach((u) => Object.entries(u.toolNames).forEach(([k, v]) => { toolNames[k] = (toolNames[k] || 0) + v; }));
    const notes = [];
    if (fig.eff.cacheRatio != null && fig.eff.cacheRatio < 0.8 && fig.calls >= 30) notes.push(`Only ${Math.round(fig.eff.cacheRatio * 100)}% of the context came from the cache.`);
    if (fig.big) notes.push(`${fig.big} tool result(s) over ${Math.round(BIG_RESULT / 1000)}k characters were pulled into the context.`);
    if (fig.images) notes.push(`${fig.images} picture(s) were read into the context.`);
    if (unit.maxRepeat >= 5) notes.push(`The same tool call was made ${unit.maxRepeat} times (a loop or retries).`);
    return {
        kind, id: String(id), title, fig, models: Object.entries(fig.byModel).map(([model, t]) => ({ model, calls: t.calls, input: t.i, output: t.o, cacheWrite: t.cw, cacheRead: t.cr })),
        tools: Object.entries(toolNames).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, n]) => ({ name, n })), efforts: dominant(unit.efforts), notes, startAt: unit.startAt, endAt: unit.endAt
    };
}

// ---------------------------------------------------------------- flags (coord.db usage_flags)

let initFor = null;
function db() {
    const d = coord().open();
    const key = coord().dbPath ? coord().dbPath() : 'db';
    if (initFor !== key) {
        d.exec(`CREATE TABLE IF NOT EXISTS usage_flags (
            id INTEGER PRIMARY KEY AUTOINCREMENT, fkey TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, session_id TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL,
            title TEXT, text TEXT, numbers TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, ack_at INTEGER)`);
        initFor = key;
    }
    return d;
}

function rowFlag(r) {
    let numbers = {};
    try { numbers = JSON.parse(r.numbers || '{}'); } catch (_) { numbers = {}; }
    return { id: r.id, key: r.fkey, kind: r.kind, sessionId: r.session_id, ref: r.ref, reason: r.reason, reasonText: REASONS[r.reason] || r.reason, title: r.title || '', text: r.text || '', numbers, firstSeen: r.first_seen, lastSeen: r.last_seen, ackAt: r.ack_at || null };
}

/** Stored flags, newest first; { all: true } includes acknowledged ones, { days } limits by last seen. */
function flagsList(opts = {}) {
    try {
        // a flag clears itself once it is stale: not seen again for a day (its session moved on or ended)
        db().prepare('UPDATE usage_flags SET ack_at = ? WHERE ack_at IS NULL AND last_seen < ?').run(Date.now(), Date.now() - DAY);
        const since = opts.days ? Date.now() - Number(opts.days) * DAY : 0;
        const rows = db().prepare(`SELECT * FROM usage_flags WHERE last_seen >= ? ${opts.all ? '' : 'AND ack_at IS NULL'} ORDER BY last_seen DESC LIMIT 300`).all(since);
        return rows.map(rowFlag);
    } catch (e) { console.warn(`[usage] flags: ${e.message}`); return []; }
}

/** Every open flag acknowledged at once (Fleet's Acknowledge All). */
function ackAll() {
    const r = db().prepare('UPDATE usage_flags SET ack_at = ? WHERE ack_at IS NULL').run(Date.now());
    changed();
    return r.changes;
}

function ack(id, on) {
    const r = db().prepare('UPDATE usage_flags SET ack_at = ? WHERE id = ?').run(on === false ? null : Date.now(), Number(id));
    changed();
    return r.changes > 0;
}

/** What Fleet's status carries: the open count (dashboard tile), the newest few and the sessions with a flag. */
function summary() {
    const open = flagsList({ days: 7 });
    const sessions = {};
    open.forEach((f) => { sessions[f.sessionId] = (sessions[f.sessionId] || 0) + 1; });
    return { open: open.length, items: open.slice(0, 8).map((f) => ({ id: f.id, title: f.title, reason: f.reasonText, text: f.text, sessionId: f.sessionId, at: f.lastSeen })), sessions };
}

function changed() { try { (supMod || sup()).emitChange(); } catch (_) { /* no listeners */ } }

const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n || 0)));

function modelRank(model) { const f = familyOf(model); return f ? FAMILIES.indexOf(f) : -1; }

/** The policy job a session or agent does (agentSupervisor's modelPolicy), or '' when nobody asked for it. */
function jobOf(kind, w) {
    if (kind === 'agent') return 'part';
    if (!w) return '';
    if (w.topology === 'planner' || w.topology === 'auto' || w.stages && w.stages.planner && !w.parentId) return w.effort === 'max' ? 'max' : w.effort === 'xhigh' ? 'large' : 'plan';
    return 'part';
}

/** The flags one session's figures raise (pure: { flags: [{ fkey, kind, ref, reason, text, numbers }] }). */
function judge(s, cfg, ctx = {}) {
    const out = [];
    const now = ctx.now || Date.now();
    const prices = cfg.prices;
    const w = ctx.work || null;
    const ag = s.agents.map((a) => ({ a, fig: figures(a.unit, [], prices), start: ms(a.firstAt) || 0 }));
    const add = (kind, ref, reason, text, numbers) => out.push({ fkey: `${kind}:${s.id}:${ref}:${reason}${numbers && numbers.model ? `:${numbers.model}` : ''}`, kind, ref: String(ref), reason, text, numbers: numbers || {} });
    const cutoff = ctx.since || 0;
    s.turns.forEach((t, i) => {
        if (cutoff && !inWindow(t, cutoff)) return;
        const startMs = ms(t.startAt) || 0;
        const next = i + 1 < s.turns.length ? (ms(s.turns[i + 1].startAt) || Infinity) : Infinity;
        const mine = ag.filter((x) => x.start >= startMs && x.start < next).map((x) => x.a.unit);
        const f = figures(t, mine, prices);
        if (f.tokens.fresh > cfg.turnTokens) add('turn', t.n, 'turn_tokens', `Turn ${t.n} used ${fmtTok(f.tokens.fresh)} tokens (limit ${fmtTok(cfg.turnTokens)}; ${fmtTok(f.tokens.cacheRead)} more re-read from the cache): ${t.text.slice(0, 80)}`, { fresh: f.tokens.fresh, cacheRead: f.tokens.cacheRead, limit: cfg.turnTokens, turn: t.n });
    });
    // the burn rate: fresh tokens of the turns and agents that ended in the last hour
    const hourAgo = now - HOUR;
    let hour = 0;
    s.turns.forEach((t) => { if ((ms(t.endAt) || 0) >= hourAgo) hour += fresh(sum(t)); });
    ag.forEach((x) => { if ((ms(x.a.lastAt) || 0) >= hourAgo) hour += fresh(sum(x.a.unit)); });
    if (hour > cfg.tokensPerHour) add('session', '', 'burn_rate', `${fmtTok(hour)} tokens in the last hour (limit ${fmtTok(cfg.tokensPerHour)} an hour)`, { perHour: hour, limit: cfg.tokensPerHour });
    ag.forEach((x) => {
        if (cutoff && (ms(x.a.lastAt) || 0) < cutoff) return;
        if (x.fig.tokens.fresh > cfg.agentTokens) add('agent', x.a.id, 'agent_tokens', `Agent "${x.a.description.slice(0, 70)}" used ${fmtTok(x.fig.tokens.fresh)} tokens (limit ${fmtTok(cfg.agentTokens)})`, { fresh: x.fig.tokens.fresh, limit: cfg.agentTokens });
    });
    const wf = figures(s.whole, [], prices);
    const readable = wf.tokens.input + wf.tokens.cacheWrite + wf.tokens.cacheRead;
    if (wf.calls >= cfg.cacheRatioMinCalls && readable && wf.tokens.cacheRead / readable < cfg.cacheRatioMin && (!cutoff || (ms(s.lastAt) || 0) >= cutoff)) {
        add('session', '', 'cache_ratio', `Only ${Math.round(100 * wf.tokens.cacheRead / readable)}% of the context came from the cache over ${wf.calls} calls (minimum ${Math.round(cfg.cacheRatioMin * 100)}%)`, { ratio: wf.tokens.cacheRead / readable, calls: wf.calls, limit: cfg.cacheRatioMin });
    }
    if (cfg.modelOverPolicy) {
        let policy = null;
        try { policy = (supMod || sup()).settings(gResources).modelPolicy; } catch (_) { policy = null; }
        const maxOf = (job) => { const p = policy && policy[job]; return p ? FAMILIES.indexOf(p.maxModel) : -1; };
        const checkUnit = (kind, ref, unit, job, label) => {
            const mx = maxOf(job);
            if (mx < 0) return;
            Object.entries(unit.byModel).forEach(([model, t]) => {
                const r = modelRank(model);
                if (r > mx && t.calls >= 3) add(kind, ref, 'model_over', `${label} ran on ${model} (${t.calls} calls, ${fmtTok(t.i + t.o + t.cw)} tokens), above the policy's maximum for "${job}" (${FAMILIES[mx]})`, { model: familyOf(model), job, max: FAMILIES[mx], calls: t.calls });
            });
        };
        ag.forEach((x) => { if (!cutoff || (ms(x.a.lastAt) || 0) >= cutoff) checkUnit('agent', x.a.id, x.a.unit, 'part', `Agent "${x.a.description.slice(0, 60)}"`); });
        const job = jobOf('session', w);
        if (job) checkUnit('session', '', s.whole, job, 'The session');
    }
    return out;
}

/** Stores a judge() result; a new key posts one notification, an old one only moves its numbers and last seen. Returns the new flags. */
function record(s, found, cfg, title) {
    const d = db();
    const now = Date.now();
    const fresh = [];
    const ins = d.prepare('INSERT INTO usage_flags (fkey, kind, session_id, ref, reason, title, text, numbers, first_seen, last_seen) VALUES (@fkey, @kind, @sid, @ref, @reason, @title, @text, @numbers, @now, @now)');
    const upd = d.prepare('UPDATE usage_flags SET last_seen = @now, text = @text, numbers = @numbers, title = @title WHERE fkey = @fkey');
    found.forEach((f) => {
        const row = { fkey: f.fkey, kind: f.kind, sid: s.id, ref: f.ref, reason: f.reason, title, text: f.text, numbers: JSON.stringify(f.numbers), now };
        const had = d.prepare('SELECT id FROM usage_flags WHERE fkey = ?').get(f.fkey);
        if (had) upd.run(row); else { ins.run(row); fresh.push(f); }
    });
    if (fresh.length) {
        if (cfg.notify) fresh.forEach((f) => notifyFlag(s, f, title));
        changed();
    }
    return fresh;
}

function notifyFlag(s, f, title) {
    try {
        require('./notificationInbox').publish({
            user: 'admin', app: 'claudedesk', id: `usage-flag:${f.fkey}`.slice(0, 160), cls: 'maintenance',
            title: `${REASONS[f.reason] || 'Heavy usage'}: ${String(title || s.id.slice(0, 8)).slice(0, 60)}`, text: f.text.slice(0, 300),
            data: { app: 'claudedesk', kind: 'usage-flag', sessionId: s.id, reason: f.reason }, ttlMs: 3 * DAY
        });
    } catch (e) { console.warn(`[usage] notice: ${e.message}`); }
}

/** After a session's turn: reads the bytes appended and judges that session (the Supervisor's turn-end settle calls it). */
async function evaluate(sessionId, opts = {}) {
    const cfg = settings(opts.gr);
    if (!cfg.enabled) return [];
    const sc = await scan({ only: String(sessionId), dirs: opts.dirs });
    const s = sc.sessions[0];
    if (!s) return [];
    let w = null;
    try { w = workIndex().bySession.get(s.id) || null; } catch (_) { w = null; }
    return record(s, judge(s, cfg, { work: w, now: opts.now, since: (opts.now || Date.now()) - 2 * DAY }), cfg, titleOfSession(s, w));
}

/** Every session of the window (the maintenance check). */
async function evaluateAll(opts = {}) {
    const cfg = settings(opts.gr);
    const days = Number(opts.days) > 0 ? Number(opts.days) : 1;
    const now = opts.now || Date.now();
    const sc = opts.scanned || await scan({ days, dirs: opts.dirs, now });
    const wi = opts.work || workIndex();
    const fresh = [];
    sc.sessions.forEach((s) => {
        const w = wi.bySession.get(s.id) || null;
        record(s, judge(s, cfg, { work: w, now, since: now - days * DAY }), cfg, titleOfSession(s, w)).forEach((f) => fresh.push(Object.assign({ sessionId: s.id }, f)));
    });
    return fresh;
}

let started = false;
/** Hooks the Supervisor's turn-end emit ({ turnEnd: sessionId }); nothing runs on a timer. */
function start(gr, supervisor) {
    if (gr) gResources = gr;
    supMod = supervisor || sup();
    if (started) return module.exports;
    started = true;
    supMod.onReview((r) => {
        if (r && r.turnEnd) evaluate(r.turnEnd).catch((e) => console.warn(`[usage] ${String(r.turnEnd).slice(0, 8)}: ${e.message}`));
    });
    return module.exports;
}

// ---------------------------------------------------------------- the maintenance check (fleetMaintenance 'usage')

const USAGE_SYSTEM = 'You review how a team of Claude Code agents spent its usage in the last 24 hours. You get the top consumers (tokens, models, effort, cache reuse, average context per call, tool mix, big tool results, pictures read, repeated identical calls, files edited, the session\'s job and the Supervisor\'s model policy) and the flags already raised. Name concrete inefficiencies with evidence from the numbers given, for example: Opus or Fable on mechanical work (renames, greps, test runs) where the policy says Sonnet; a huge context re-read on every call; screenshots or big files pulled into the context; loops or retries (the same call repeated); agents started on the parent\'s model instead of Sonnet; many tokens for few edited files. For each give a suggestion that can be acted on (a model, a settings change, a prompt habit). Judge only from the evidence, never invent numbers. Answer ONLY {"findings":[{"subject":"session or agent name","issue":"what is wasteful, with the numbers","suggestion":"what to change","severity":"info|warn"}]} with at most 8 findings, or {"findings":[]} when the usage looks fine.';

function digest(sc, cfg, wi, now, top) {
    const rows = [];
    sc.sessions.forEach((s) => {
        const w = wi.bySession.get(s.id) || null;
        const cutoff = sc.cutoff;
        const turns = s.turns.filter((t) => inWindow(t, cutoff));
        const agents = s.agents.filter((a) => (ms(a.lastAt) || 0) >= cutoff);
        if (!turns.length && !agents.length) return;
        const whole = newUnit(0, '', null);
        turns.forEach((u) => { Object.entries(u.byModel).forEach(([k, v]) => { const m = whole.byModel[k] || (whole.byModel[k] = Object.assign(zero(), { calls: 0 })); m.i += v.i; m.o += v.o; m.cw += v.cw; m.cr += v.cr; m.calls += v.calls; }); whole.calls += u.calls; whole.tools += u.tools; whole.ctxSum += u.ctxSum; whole.big += u.big; whole.images += u.images; whole.maxRepeat = Math.max(whole.maxRepeat, u.maxRepeat); u.files.forEach((f) => { if (!whole.files.includes(f)) whole.files.push(f); }); Object.entries(u.toolNames).forEach(([k, v]) => { whole.toolNames[k] = (whole.toolNames[k] || 0) + v; }); Object.entries(u.efforts).forEach(([k, v]) => { whole.efforts[k] = (whole.efforts[k] || 0) + v; }); });
        const f = figures(whole, agents.map((a) => a.unit), cfg.prices);
        rows.push({ s, w, f, whole, agents, turns });
    });
    rows.sort((a, b) => b.f.tokens.fresh - a.f.tokens.fresh);
    return rows.slice(0, top).map((r) => ({
        session: titleOfSession(r.s, r.w).slice(0, 90), job: jobOf('session', r.w) || 'unlinked', workItem: r.w ? `#${r.w.id}` : null,
        freshTokens: r.f.tokens.fresh, cacheReadTokens: r.f.tokens.cacheRead, models: r.f.models, efforts: dominant(r.whole.efforts), cacheRatio: r.f.eff.cacheRatio == null ? null : Math.round(r.f.eff.cacheRatio * 100) / 100,
        avgContextPerCall: r.f.eff.heavyCtx, calls: r.f.calls, toolCalls: r.f.tools, filesEdited: r.f.files, bigToolResults: r.f.big, picturesRead: r.f.images, mostRepeatedCall: Math.max(r.whole.maxRepeat, ...r.agents.map((x) => x.unit.maxRepeat)),
        topTools: Object.entries(r.whole.toolNames).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`),
        agents: r.agents.map((a) => ({ name: a.description.slice(0, 60), model: familyOf(Object.keys(a.unit.byModel)[0] || a.metaModel) || a.metaModel, fresh: fresh(sum(a.unit)) })).sort((a, b) => b.fresh - a.fresh).slice(0, 5)
    }));
}

async function checkUsage(ctx) {
    const mk = (state, summary, actions, findings, extra) => ({ id: 'usage', title: 'Usage review', state, summary, actions: actions || [], findings: findings || [] , ...(extra || {}) });
    const F = (text, level) => ({ level: level || 'info', text });
    const gr = ctx.gr;
    const cfg = settings(gr);
    if (!cfg.enabled) return mk('skipped', 'Usage flags are turned off (agentSupervisor.usageFlags.enabled)');
    const now = ctx.now || Date.now();
    const sc = ctx.scanned || await scan({ days: 1, dirs: ctx.usageDirs, now });
    const wi = ctx.work || workIndex();
    const newFlags = ctx.dryRun ? [] : await evaluateAll({ gr, days: 1, now, scanned: sc, work: wi, dirs: ctx.usageDirs });
    const open = flagsList({ days: 1 });
    const top = digest(sc, cfg, wi, now, 8);
    const findings = [];
    const actions = [];
    top.slice(0, 5).forEach((t) => findings.push(F(`${t.session}: ${fmtTok(t.freshTokens)} tokens (${t.models.join(', ') || '?'}${t.efforts.length ? `, ${t.efforts[0]}` : ''}), cache ${t.cacheRatio == null ? '?' : `${Math.round(t.cacheRatio * 100)}%`}, ${t.toolCalls} tool calls, ${t.filesEdited} files edited`)));
    open.forEach((f) => findings.push(F(`Flag: ${f.title}: ${f.text}`, 'warn')));
    let asked = 0;
    let advice = [];
    if (top.length && (ctx.askJson || ctx.sup || sup)) {
        let policy = null;
        try { policy = (ctx.sup || sup()).settings(gr).modelPolicy; } catch (_) { policy = null; }
        const ask = ctx.askJson || ((sys, user) => (ctx.sup || sup()).askJson(gr, sys, user, 'maintenance-usage', { maxTokens: 900 }));
        try {
            const out = await ask(USAGE_SYSTEM, JSON.stringify({ top, flags: open.slice(0, 12).map((f) => ({ session: f.title, reason: f.reasonText, text: f.text })), modelPolicy: policy, prices: Object.keys(cfg.prices).length ? 'typed' : 'not set (tokens only)' }));
            asked = 1;
            advice = (out && Array.isArray(out.findings) ? out.findings : []).slice(0, 8).filter((x) => x && x.issue);
            advice.forEach((x) => findings.push(F(`${x.subject ? `${String(x.subject).slice(0, 80)}: ` : ''}${String(x.issue).slice(0, 400)}${x.suggestion ? ` Suggestion: ${String(x.suggestion).slice(0, 300)}` : ''}`, x.severity === 'warn' ? 'warn' : 'info')));
        } catch (e) { findings.push(F(`The Supervisor's engine could not review the usage (${e.message}); the figures above are from the transcripts`, 'warn')); }
    }
    if (cfg.fileWorkItem && !ctx.dryRun && advice.length) {
        try {
            const sp = ctx.sup || sup();
            sp.enqueue({ title: `Usage findings ${new Date(now).toISOString().slice(0, 10)}`, prompt: `The daily usage review found:\n\n${advice.map((x) => `- ${x.subject || 'Usage'}: ${x.issue}\n  Suggestion: ${x.suggestion || ''}`).join('\n')}\n\nLook at each, fix what is in reach (settings, briefs, model picks) and report.`, source: 'fleet', startNow: false }, { gr });
            actions.push('Filed a held work item for the usage findings');
        } catch (e) { findings.push(F(`The work item could not be filed: ${e.message}`, 'warn')); }
    }
    const warn = open.length > 0;
    return mk(warn ? 'warn' : 'ok', `${sc.sessions.length} session(s) in the last 24 h; top: ${top[0] ? `${top[0].session.slice(0, 40)} ${fmtTok(top[0].freshTokens)}` : 'none'}; ${open.length} open flag(s), ${newFlags.length} new${asked ? `, ${advice.length} inefficienc${advice.length === 1 ? 'y' : 'ies'} named` : ''}${ctx.dryRun ? ' (dry run: no flags stored)' : ''}`, actions, findings, { top: top.slice(0, 5) });
}

module.exports = {
    ackAll,
    start, settings, scan, tree, detail, flagsList, ack, summary, evaluate, evaluateAll, checkUsage, judge, figures, createState, feed, fmtTok, REASONS, DEFAULTS,
    _test: { files, judge, digest, costOf }
};
