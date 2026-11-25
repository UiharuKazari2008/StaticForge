'use strict';

/**
 * What a Claude session is doing, read from its transcript (Claude Accounts on the desktop, apps/claudedesk):
 * the model (and each switch), effort, permission mode, context used, token totals for the session and the
 * current turn, turn count and duration, tool calls, files edited this turn, background agents still open,
 * and Claude Code's own cost figure (the `cost-state` line it writes; no price table of ours).
 *
 *   insightOf(file)     the summary; the file is read once, then only the bytes appended since (cached by path)
 *   createState() / feed(state, line)   the pure builder (scripts/test-claude-desk.js feeds it a fixture)
 *   summarize(state, now)               the plain object sent to the client
 *
 * Lines are pre-filtered by text before JSON.parse (tool results and attachments are the big ones), the file
 * is read in 4 MB chunks, and everything is async (no fs.*Sync: the socket handler calls it).
 */

const fs = require('fs');

const CHUNK = 4 * 1024 * 1024;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const WRAPPER_RE = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|user-prompt-submit-hook|bash-input|bash-stdout|bash-stderr|task-notification)/i;
const MAX_SWITCHES = 20;

function createState(opts = {}) {
    return {
        sidechain: opts.sidechain === true, firstAt: null, tasks: new Map(),
        offset: 0, model: '', models: [], effort: '', mode: '', cwd: '', branch: '', version: '',
        totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 },
        last: { id: '', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ctx: 0, ctxPeak: 0, costUsd: null, modelUsage: null,
        turns: 0, turnAt: null, turnEndAt: null, turnTools: 0, turnFiles: [], turnTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        lastTool: '', lastToolAt: null, lastAt: null, bg: new Set(), stopReason: '', pending: new Map()
    };
}

function blockText(c) {
    if (typeof c === 'string') return c;
    if (!Array.isArray(c)) return '';
    return c.map((b) => (b && b.type === 'text' ? b.text || '' : '')).join('\n');
}

/** Feed one transcript line (text) to the state. */
/** A tool call as a short "doing" line: Running Bash: npm test / Editing claudedesk.js / Reading a.js ... */
function doing(name, i) {
    const x = i && typeof i === 'object' ? i : {};
    const base = (f) => String(f || '').split(/[\\/]/).filter(Boolean).pop() || '';
    const cut = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}...` : t; };
    if (name === 'Bash') return `Running Bash${x.command || x.description ? `: ${cut(x.description || x.command, 80)}` : ''}`;
    if (EDIT_TOOLS.has(name)) return `${name === 'Write' ? 'Writing' : 'Editing'} ${base(x.file_path || x.notebook_path) || 'a file'}`;
    if (name === 'Read') return `Reading ${base(x.file_path) || 'a file'}`;
    if (name === 'Grep' || name === 'Glob') return `Searching: ${cut(x.pattern, 60)}`;
    if (AGENT_TOOLS.has(name)) return `Running agent${x.description ? `: ${cut(x.description, 60)}` : ''}`;
    if (name === 'WebFetch' || name === 'WebSearch') return `Looking up: ${cut(x.url || x.query, 60)}`;
    return `Running ${String(name || 'a tool').replace(/^mcp__/, '').replace(/__/g, ' ')}`;
}

function feed(s, line) {
    if (!line || line.length < 10) return;
    if (s.pending.size && line.includes('"tool_result"')) {
        for (const id of Array.from(s.pending.keys())) if (line.includes(id)) s.pending.delete(id);
    }
    const isAssistant = line.includes('"type":"assistant"');
    const isUser = !isAssistant && line.includes('"type":"user"') && !line.includes('"type":"tool_result"');
    const isCost = !isAssistant && !isUser && line.includes('"type":"cost-state"');
    const isQueued = !isAssistant && !isUser && !isCost && line.includes('"task-notification"') && line.includes('queued_command');
    if (!isAssistant && !isUser && !isCost && !isQueued) return;
    let o;
    try { o = JSON.parse(line); } catch (_) { return; }
    if (o.timestamp) { s.lastAt = o.timestamp; if (!s.firstAt) s.firstAt = o.timestamp; }
    if (o.cwd) s.cwd = o.cwd;
    if (o.gitBranch) s.branch = o.gitBranch;
    if (o.version) s.version = o.version;
    if (isCost) {
        const n = Number(o.totalCostUSD);
        if (Number.isFinite(n)) s.costUsd = n;
        if (o.modelUsage && typeof o.modelUsage === 'object') s.modelUsage = o.modelUsage;
        return;
    }
    if (isQueued) {
        // a finished background agent: its notification names the tool call that started it
        const a = o.attachment || {};
        const m = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(String(a.prompt || ''));
        if (m) {
            s.bg.delete(m[1]);
            const t = s.tasks.get(m[1]);
            if (t) { const st = /<status>([^<]+)<\/status>/.exec(String(a.prompt || '')); t.state = st && /fail|error|kill/i.test(st[1]) ? 'failed' : 'done'; t.endAt = o.timestamp || s.lastAt; }
        }
        return;
    }
    if (isUser) {
        if (o.isMeta || (o.isSidechain && !s.sidechain)) return;
        if (o.permissionMode) s.mode = o.permissionMode;
        const kind = o.origin && o.origin.kind;
        if (kind && kind !== 'human') return;
        const c = o.message && o.message.content;
        const t = blockText(c);
        if (!t.trim() || WRAPPER_RE.test(t)) return;
        s.turns += 1;
        s.turnAt = o.timestamp || s.lastAt;
        s.turnEndAt = null;
        s.turnTools = 0;
        s.turnFiles = [];
        s.turnTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        s.stopReason = '';
        s.pending.clear();
        return;
    }
    // assistant
    const m = o.message || {};
    if (o.isSidechain && !s.sidechain) return;
    if (m.model && m.model !== '<synthetic>') {
        if (m.model !== s.model) {
            s.model = m.model;
            s.models.push({ model: m.model, at: o.timestamp || null });
            if (s.models.length > MAX_SWITCHES) s.models.shift();
        }
    }
    const eff = o.perTurnEffort || o.effort;
    if (eff && typeof eff === 'string') s.effort = eff;
    const u = m.usage;
    if (u && typeof u === 'object') {
        const cur = { id: m.id || o.uuid || '', input: Number(u.input_tokens) || 0, output: Number(u.output_tokens) || 0, cacheRead: Number(u.cache_read_input_tokens) || 0, cacheWrite: Number(u.cache_creation_input_tokens) || 0 };
        // one reply is written as one line per content block with the same usage: count it once
        const same = cur.id && cur.id === s.last.id;
        const prev = same ? s.last : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        s.totals.input += cur.input - prev.input;
        s.totals.output += cur.output - prev.output;
        s.totals.cacheRead += cur.cacheRead - prev.cacheRead;
        s.totals.cacheWrite += cur.cacheWrite - prev.cacheWrite;
        s.turnTokens.input += cur.input - prev.input;
        s.turnTokens.output += cur.output - prev.output;
        s.turnTokens.cacheRead += cur.cacheRead - prev.cacheRead;
        s.turnTokens.cacheWrite += cur.cacheWrite - prev.cacheWrite;
        if (!same) s.totals.messages += 1;
        s.last = cur;
        s.ctx = cur.input + cur.cacheRead + cur.cacheWrite;
        if (s.ctx > s.ctxPeak) s.ctxPeak = s.ctx;
    }
    if (m.stop_reason) {
        s.stopReason = m.stop_reason;
        if (m.stop_reason === 'end_turn') { s.turnEndAt = o.timestamp || s.lastAt; s.pending.clear(); }
    }
    (Array.isArray(m.content) ? m.content : []).forEach((b) => {
        if (!b || b.type !== 'tool_use') return;
        s.turnTools += 1;
        if (b.id) s.pending.set(b.id, doing(b.name, b.input));
        s.lastTool = String(b.name || 'tool');
        s.lastToolAt = o.timestamp || null;
        const i = b.input || {};
        if (EDIT_TOOLS.has(b.name)) {
            const f = i.file_path || i.notebook_path || '';
            if (f && !s.turnFiles.includes(f)) s.turnFiles.push(f);
        }
        if (AGENT_TOOLS.has(b.name) && i.run_in_background === true && b.id) s.bg.add(b.id);
        // background work this session started: an agent or a Bash command run_in_background (its notification ends it)
        if (b.id && i.run_in_background === true && (b.name === 'Bash' || AGENT_TOOLS.has(b.name)) && !s.tasks.has(b.id)) {
            s.tasks.set(b.id, { id: b.id, kind: b.name === 'Bash' ? 'bash' : 'agent', label: String(i.description || i.command || b.name).replace(/\s+/g, ' ').slice(0, 120), startAt: o.timestamp || null, endAt: null, state: 'running' });
            if (s.tasks.size > 60) s.tasks.delete(s.tasks.keys().next().value);
        }
    });
}

/** The state as the plain object the client gets. `busy` says the turn is still running (its duration counts to now). */
function summarize(s, now, busy) {
    const turnStart = s.turnAt ? Date.parse(s.turnAt) : NaN;
    const turnEnd = busy ? (now || Date.now()) : Date.parse(s.turnEndAt || s.lastAt || '');
    // the window is not in the transcript: past 200k used it must be the 1M one (an estimate, said so)
    const window = s.ctxPeak > 200000 || /\[1m\]/i.test(s.model) ? 1000000 : 200000;
    return {
        model: s.model, models: s.models.slice(), effort: s.effort, mode: s.mode, cwd: s.cwd, branch: s.branch, version: s.version,
        context: { used: s.ctx, window, windowGuess: true, percent: s.ctx ? Math.min(100, Math.round(s.ctx * 100 / window)) : 0 },
        tokens: Object.assign({}, s.totals), turnTokens: Object.assign({}, s.turnTokens),
        costUsd: s.costUsd, modelUsage: s.modelUsage,
        turns: s.turns, turnStartedAt: s.turnAt, turnMs: Number.isFinite(turnStart) && Number.isFinite(turnEnd) ? Math.max(0, turnEnd - turnStart) : null,
        turnTools: s.turnTools, turnFiles: s.turnFiles.slice(0, 40), turnFileCount: s.turnFiles.length,
        now: busy ? (s.pending.size ? Array.from(s.pending.values()).pop() : 'Thinking...') : '',
        lastTool: s.lastTool, lastToolAt: s.lastToolAt, lastAt: s.lastAt, bgAgents: s.bg.size, stopReason: s.stopReason,
        firstAt: s.firstAt, tasks: Array.from(s.tasks.values())
    };
}

// ---------------------------------------------------------------- the cached file reader

const cache = new Map(); // file -> { state, pending }
const MAX_CACHED = 120; // a session, plus its background agents when a workflow map reads them

async function advance(file, ent) {
    const st = await fs.promises.stat(file);
    if (st.size < ent.state.offset) { ent.state = createState({ sidechain: ent.state.sidechain }); } // the file was replaced
    let len = CHUNK;
    const fh = await fs.promises.open(file, 'r');
    try {
        while (ent.state.offset < st.size) {
            const from = ent.state.offset;
            const want = Math.min(len, st.size - from);
            const buf = Buffer.alloc(want);
            await fh.read(buf, 0, want, from);
            const last = buf.lastIndexOf(0x0a);
            if (last < 0) {
                if (from + want >= st.size) break; // a line still being written
                if (len >= 256 * 1024 * 1024) { ent.state.offset = from + want; continue; }
                len *= 2;
                continue;
            }
            buf.subarray(0, last + 1).toString('utf8').split('\n').forEach((l) => feed(ent.state, l));
            ent.state.offset = from + last + 1;
        }
    } finally { await fh.close(); }
}

/** The session's insight summary; only the bytes appended since the last call are read. */
async function insightOf(file, opts = {}) {
    let ent = cache.get(file);
    if (!ent) {
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
        ent = { state: createState({ sidechain: opts.sidechain === true }), pending: null };
        cache.set(file, ent);
    }
    if (!ent.pending) ent.pending = advance(file, ent).finally(() => { ent.pending = null; });
    await ent.pending;
    return summarize(ent.state, Date.now(), opts.busy === true);
}

module.exports = { insightOf, createState, feed, summarize, doing };
