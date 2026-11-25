'use strict';

/**
 * agent-coord v2 (#1154): busy-lock files, session inspection and build gates, on store.js's database.
 * store.js mixes these in (require('./storeV2')(core)); see its header for what each table is for.
 *
 * Costs: a transcript is scanned from the byte offset the last scan stopped at (scans.offset), at most
 * SCAN_CAP bytes per call, and only lines that hold a tool call or assistant text are parsed; git status
 * runs with a 3 s timeout and a 60-line cap. Nothing here polls: everything runs inside a tool call.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCAN_CAP = 48 * 1024 * 1024;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const STALE_LOCK_MS = 3 * 60 * 60 * 1000;         // agent-busy-lock: older than ~3 h may be leftover
const GATE_OPEN_MS = 2 * 60 * 60 * 1000;          // a build request nobody began lapses after 2 h
const GATE_RUN_MS = 3 * 60 * 60 * 1000;           // a build nobody ended lapses after 3 h
// a shell command that writes files (sed -i, redirects, heredoc scripts that open(..., 'w'), tee, mv / cp,
// patch, perl -i, git checkout / restore): the paths it names count as edited "via shell"
const SHELL_WRITE_RE = /\bsed\s+-i|\bperl\s+-[a-z]*i|(?:^|[^>&0-9])>{1,2}\s*[^\s&|>]|\btee\b|\bmv\s|\bcp\s|\bpatch\b|\bgit\s+(?:checkout|restore|apply)\b|open\([^)]*['"][wa]\+?['"]|writeFileSync|\.write\(|\brm\s/;
const PATH_TOKEN_RE = /(?:^|[\s'"=(:,])((?:\.{0,2}\/)?(?:[\w@.+-]+\/)+[\w@.+-]+\.[A-Za-z0-9]{1,8}|[\w@+-]+\.(?:js|mjs|cjs|ts|tsx|jsx|json|css|scss|html|md|mdc|py|sh|kt|kts|xml|yml|yaml|toml|txt|svg))(?=$|[\s'"),;:])/g;
function shellPaths(cmd) {
    const c = String(cmd || '');
    if (!SHELL_WRITE_RE.test(c)) return [];
    const out = new Set();
    let m;
    PATH_TOKEN_RE.lastIndex = 0;
    while ((m = PATH_TOKEN_RE.exec(c)) && out.size < 40) {
        const p = m[1].replace(/^\.\//, '');
        if (/^(?:\/tmp|\/dev|\/proc)\//.test(p) || /node_modules\//.test(p)) continue;
        out.add(p);
    }
    return [...out];
}
// work folders and temp files a command makes (#1154 Supervisor: "detect the creation of working directories
// and temp files that can get lost and forgotten and will waste space"): mkdir, git worktree add, and writes
// (redirects, tee, -o / --output, cp / mv targets, Write) to paths outside the repo
const ARTIFACT_ROOT_RE = /^(?:\/tmp\/|\/var\/tmp\/|~\/|\/home\/[^/]+\/)/;
/**
 * The one gate for what the tracker records (Nov 24 2026: it had read "/", the repo, the word "and" and a relative path).
 * Only an absolute or ~/ path, resolved; never "/", a path less than two levels deep, a protected folder or a folder
 * above one (HOME, the repo, ~/.claude, ~/.secrets, ~/.config, /tmp, /var/tmp, ~/.cache). Returns the resolved path or ''.
 */
function acceptArtifactPath(p) {
    let v = String(p || '').trim();
    if (!v || v.length > 400 || /[\0*?$`]/.test(v)) return '';
    const home = os.homedir();
    if (v === '~') return '';
    if (v.startsWith('~/')) v = path.join(home, v.slice(2));
    if (!path.isAbsolute(v)) return '';
    v = path.normalize(v).replace(/\/+$/, '');
    if (!v || v === '/' || v.split(path.sep).filter(Boolean).length < 2) return '';
    const protectedPaths = [home, path.join(__dirname, '..', '..'), path.join(home, '.claude'), path.join(home, '.secrets'), path.join(home, '.config'), '/tmp', '/var/tmp', path.join(home, '.cache'), '/']
        .map((x) => path.normalize(x).replace(/\/+$/, '') || '/');
    if (protectedPaths.some((n) => n === v || n.startsWith(`${v}${path.sep}`))) return '';
    return v;
}
function shellArtifacts(cmd) {
    const c = String(cmd || '');
    const out = [];
    const add = (p, kind) => { const v = acceptArtifactPath(String(p || '').replace(/^["']|["']$/g, '').replace(/[;,)]+$/, '')); if (v) out.push({ path: v, kind }); };
    let m;
    const mk = /\bmkdir\s+(?:-[a-zA-Z]+\s+)*((?:"[^"]+"|'[^']+'|[^\s;&|]+)(?:\s+(?:"[^"]+"|'[^']+'|[^\s;&|-][^\s;&|]*))*)/g;
    while ((m = mk.exec(c))) m[1].split(/\s+/).forEach((p) => add(p, 'dir'));
    const wt = /\bgit\s+(?:-C\s+\S+\s+)?worktree\s+add\s+(?:-[a-zA-Z]+\s+(?:\S+\s+)?)*([^\s;&|]+)/g;
    while ((m = wt.exec(c))) add(m[1], 'worktree');
    const wr = /(?:(?:^|[^>&0-9])>{1,2}|\btee\s+(?:-a\s+)?|\s-o\s+|--output[= ]|--out-dir[= ])\s*([^\s;&|>]+)/g;
    while ((m = wr.exec(c))) add(m[1], 'file');
    return out.filter((a) => a.kind === 'worktree' || a.kind === 'dir' || ARTIFACT_ROOT_RE.test(a.path));
}
// a busy lock a session made itself (echo / printf ... > .agent-x, touch .agent-x; Write is matched on its path):
// naming one (ls, cat, rm) does not make it the session's
const LOCK_NAME_RE = /(?:>{1,2}\s*|\btouch\s+(?:-\S+\s+)*)(?:\S*\/)?(\.agent-[A-Za-z0-9_.-]+)/g;
function lockMentions(cmd) {
    const c = String(cmd || '');
    const out = new Set();
    let m;
    LOCK_NAME_RE.lastIndex = 0;
    while ((m = LOCK_NAME_RE.exec(c))) out.add(m[1]);
    return [...out];
}
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function claudeHome() { return process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(); }
const lockName = (agentId) => `.agent-${String(agentId).replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 60)}`;

module.exports = function storeV2(core) {
    const { open, now, text, getAgent, resolveAgent, listAgents, liveClaims, post, repoOf, pidAlive } = core;

    // ------------------------------------------------------------ busy locks (.agent-<id>)

    /** Plants the agent's .agent-<id> in a repo root (once per root; touched when it is there). */
    function plantLock(agentId, root, intent) {
        if (!root || !path.isAbsolute(root)) return '';
        const d = open();
        const file = path.join(root, lockName(agentId));
        const have = d.prepare('SELECT * FROM locks WHERE agent_id = ? AND root = ?').get(String(agentId), root);
        const body = `agent: ${agentId}\nstarted: ${new Date(have ? have.created_at : now()).toISOString()}\nintent: ${text(intent || 'agent-coord claim', 200).replace(/\n/g, ' ')}\nby: agent-coord (removed when the claims are released or the agent ends)\n`;
        if (have && fs.existsSync(file)) {
            const t = new Date();
            try { fs.utimesSync(file, t, t); } catch (_) { /* kept */ }
            return file;
        }
        fs.writeFileSync(file, body, { mode: 0o664 });
        d.prepare('INSERT OR REPLACE INTO locks (agent_id, root, file, created_at) VALUES (?, ?, ?, ?)').run(String(agentId), root, file, have ? have.created_at : now());
        return file;
    }

    /** Removes the lock files this store planted for an agent (in one repo, or everywhere). */
    function removeLocks(agentId, repo) {
        const d = open();
        const rows = d.prepare('SELECT * FROM locks WHERE agent_id = ?').all(String(agentId));
        let n = 0;
        rows.forEach((r) => {
            if (repo && repoOf(r.root).repo !== repo) return;
            try { fs.rmSync(r.file, { force: true }); } catch (_) { /* gone */ }
            d.prepare('DELETE FROM locks WHERE agent_id = ? AND root = ?').run(r.agent_id, r.root);
            n += 1;
        });
        return n;
    }

    /**
     * Every .agent-* in a repo root: ours (an agent-coord agent, with its live state) or another agent's
     * (Cursor, an older session) with its age; stale = older than ~3 h (agent-busy-lock: report, never delete).
     */
    function lockFiles(root) {
        if (!root) return [];
        let names = [];
        try { names = fs.readdirSync(root).filter((n) => /^\.agent-[A-Za-z0-9_.-]+$/.test(n)); } catch (_) { return []; }
        const d = open();
        const ours = new Map(d.prepare('SELECT * FROM locks WHERE root = ?').all(root).map((r) => [path.basename(r.file), r]));
        return names.map((n) => {
            const file = path.join(root, n);
            let st = null;
            try { st = fs.statSync(file); } catch (_) { st = null; }
            let head = '';
            try { head = fs.readFileSync(file, 'utf8').slice(0, 400); } catch (_) { head = ''; }
            const intent = (/^intent:\s*(.+)$/m.exec(head) || [])[1] || '';
            const mine = ours.get(n);
            const agent = mine ? getAgent(mine.agent_id) : null;
            const age = st ? now() - st.mtimeMs : null;
            return {
                file: n,
                agentId: mine ? mine.agent_id : n.slice('.agent-'.length),
                viaCoord: !!mine,
                status: agent ? agent.status : '',
                intent: text(intent, 200),
                modifiedAt: st ? Math.round(st.mtimeMs) : null,
                ageMinutes: age == null ? null : Math.round(age / 60000),
                stale: !mine && age != null && age > STALE_LOCK_MS
            };
        });
    }

    // ------------------------------------------------------------ live session facts (~/.claude/sessions)

    /** The CLI's own record of a live session: busy / idle, its link, its pid. */
    function liveRecord(agent) {
        if (!agent || !agent.pid || !pidAlive(agent.pid)) return null;
        try {
            const r = JSON.parse(fs.readFileSync(path.join(claudeHome(), '.claude', 'sessions', `${agent.pid}.json`), 'utf8'));
            return r && r.sessionId ? r : null;
        } catch (_) { return null; }
    }
    const isBusy = (agent) => { const r = liveRecord(agent); return !!(r && r.status === 'busy'); };

    // ------------------------------------------------------------ transcripts -> files edited

    /** The session's transcript and its subagents' (one shared projects dir for every account). */
    function transcriptsOf(sessionId) {
        if (!SESSION_ID_RE.test(String(sessionId || ''))) return [];
        const base = path.join(claudeHome(), '.claude', 'projects');
        let dirs = [];
        try { dirs = fs.readdirSync(base); } catch (_) { return []; }
        for (const d of dirs) {
            const file = path.join(base, d, `${sessionId}.jsonl`);
            if (!fs.existsSync(file)) continue;
            const out = [{ key: sessionId, file }];
            const sub = path.join(base, d, sessionId, 'subagents');
            try {
                fs.readdirSync(sub).filter((n) => n.endsWith('.jsonl')).forEach((n) => out.push({ key: `${sessionId}/${n}`, file: path.join(sub, n) }));
            } catch (_) { /* no subagents */ }
            return out;
        }
        return [];
    }

    function scanOne(sessionId, key, file) {
        const d = open();
        let st = null;
        try { st = fs.statSync(file); } catch (_) { return; }
        let row = d.prepare('SELECT * FROM scans WHERE key = ?').get(key);
        if (row && row.file !== file) row = null;
        let offset = row ? row.offset : 0;
        if (offset > st.size) offset = 0; // rewritten
        if (offset === st.size) return;
        const len = Math.min(st.size - offset, SCAN_CAP);
        const buf = Buffer.alloc(len);
        const fd = fs.openSync(file, 'r');
        try { fs.readSync(fd, buf, 0, len, offset); } finally { fs.closeSync(fd); }
        const lastNl = buf.lastIndexOf(10);
        if (lastNl < 0) return; // half a line: next time
        const chunk = buf.toString('utf8', 0, lastNl);
        let commands = [];
        try { commands = JSON.parse(row ? row.commands : '[]'); } catch (_) { commands = []; }
        let lastText = row ? row.last_text : '';
        let lastAt = row ? row.last_at : null;
        let tools = row ? row.tools : 0;
        const edits = new Map();
        const artifacts = [];
        const locksSeen = new Set();
        let cwdSeen = '';
        chunk.split('\n').forEach((line) => {
            if (!cwdSeen) { const cm = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line); if (cm) { try { cwdSeen = JSON.parse(`"${cm[1]}"`); } catch (_) { cwdSeen = ''; } } }
            if (!line || (line.indexOf('"tool_use"') < 0 && line.indexOf('"assistant"') < 0)) return;
            let o;
            try { o = JSON.parse(line); } catch (_) { return; }
            if (!o || o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) return;
            const at = Date.parse(o.timestamp || '') || null;
            o.message.content.forEach((c) => {
                if (!c) return;
                if (c.type === 'text' && c.text && c.text.trim()) { lastText = text(c.text, 600); lastAt = at || lastAt; return; }
                if (c.type !== 'tool_use') return;
                tools += 1;
                lastAt = at || lastAt;
                const inp = c.input || {};
                if (EDIT_TOOLS.has(c.name)) {
                    const p = inp.file_path || inp.notebook_path;
                    if (!p) return;
                    if (c.name === 'Write' && /\/\.agent-[A-Za-z0-9_.-]+$/.test(p)) locksSeen.add(path.basename(p));
                    if (c.name === 'Write' && ARTIFACT_ROOT_RE.test(p) && acceptArtifactPath(p)) artifacts.push({ path: acceptArtifactPath(p), kind: 'file', at, cmd: `Write ${p}` });
                    const e = edits.get(p) || { tool: c.name, n: 0, first: at, last: at };
                    e.n += 1; e.tool = c.name; e.last = at || e.last; if (!e.first) e.first = at;
                    edits.set(p, e);
                } else if (c.name === 'Bash' && inp.command) {
                    shellArtifacts(inp.command).forEach((a) => artifacts.push(Object.assign(a, { at, cmd: text(String(inp.command).split('\n')[0], 200) })));
                    lockMentions(inp.command).forEach((n) => locksSeen.add(n));
                    // only what the command really writes (Nov 25 2026: read-only commands, URLs and git ranges were counted as
                    // edits and caused false collision pauses)
                    require('./activityIndex').shellWritePaths(inp.command).forEach((p) => {
                        if (edits.has(p) && edits.get(p).tool !== 'Bash') return;
                        const e = edits.get(p) || { tool: 'Bash', n: 0, first: at, last: at };
                        e.n += 1; e.last = at || e.last; if (!e.first) e.first = at;
                        edits.set(p, e);
                    });
                    commands.push({ at, command: text(String(inp.command).split('\n')[0], 200), description: text(inp.description || '', 120) });
                    if (commands.length > 15) commands = commands.slice(-15);
                }
            });
        });
        d.transaction(() => {
            // an edit tool's record wins over a shell mention of the same path
            const up = d.prepare(`INSERT INTO edits (session_id, path, tool, n, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, path) DO UPDATE SET tool = CASE WHEN excluded.tool = 'Bash' AND tool != 'Bash' THEN tool ELSE excluded.tool END,
                n = n + excluded.n, last_at = COALESCE(excluded.last_at, last_at)`);
            edits.forEach((e, p) => up.run(sessionId, text(p, 500), e.tool, e.n, e.first, e.last));
            const ins = d.prepare('INSERT OR IGNORE INTO artifacts (session_id, path, kind, created_at, cmd, cwd) VALUES (?, ?, ?, ?, ?, ?)');
            artifacts.forEach((a) => ins.run(sessionId, text(a.path, 400), a.kind, a.at || now(), a.cmd || '', cwdSeen || ''));
            const lo = d.prepare('INSERT OR IGNORE INTO lock_owners (session_id, name, seen_at) VALUES (?, ?, ?)');
            locksSeen.forEach((n) => lo.run(sessionId, text(n, 120), now()));
            d.prepare(`INSERT INTO scans (key, session_id, file, offset, commands, last_text, last_at, tools) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET file = excluded.file, offset = excluded.offset, commands = excluded.commands,
                last_text = excluded.last_text, last_at = excluded.last_at, tools = excluded.tools`)
                .run(key, sessionId, file, offset + lastNl + 1, JSON.stringify(commands), lastText, lastAt, tools);
        })();
    }

    /** Brings a session's edit list up to date (from where the last scan stopped). */
    function scanSession(sessionId) {
        transcriptsOf(sessionId).forEach((t) => {
            try { scanOne(sessionId, t.key, t.file); } catch (e) { process.stderr.write(`agent-coord: scan ${t.key}: ${e.message}\n`); }
        });
    }

    function gitDirty(cwd) {
        if (!cwd) return null;
        try {
            // -uall: a new folder's files one by one (normal collapses them to "dir/", which no edit matches)
            const out = execFileSync('git', ['-C', cwd, 'status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024 });
            const all = out.split('\n').filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }));
            return { count: all.length, files: all.slice(0, 60), paths: new Set(all.map((f) => f.path)) };
        } catch (_) { return null; }
    }

    /**
     * What an agent is doing: its row, live state (busy / idle), claims, the files it edited (newest first,
     * relative to its repo where they are inside it), recent shell commands, its last words, and the
     * uncommitted files in its folder (which may include other agents' work in the same tree).
     */
    function inspect(ref, opts = {}) {
        const agent = resolveAgent(ref);
        if (!agent) throw new Error(`No agent ${ref} (coord_agents lists them; pass its id, name or session id)`);
        const d = open();
        if (agent.sessionId) scanSession(agent.sessionId);
        const rec = liveRecord(agent);
        const { root } = repoOf(agent.cwd);
        const rel = (p) => { if (root && p.startsWith(`${root}/`)) return p.slice(root.length + 1); return p; };
        const edits = agent.sessionId ? d.prepare('SELECT * FROM edits WHERE session_id = ? ORDER BY COALESCE(last_at, 0) DESC LIMIT ?').all(agent.sessionId, Math.max(1, Math.min(300, Number(opts.limit) || 100))) : [];
        const totalEdited = agent.sessionId ? d.prepare('SELECT COUNT(*) n FROM edits WHERE session_id = ?').get(agent.sessionId).n : 0;
        const scans = agent.sessionId ? d.prepare('SELECT * FROM scans WHERE session_id = ?').all(agent.sessionId) : [];
        const main = scans.find((x) => x.key === agent.sessionId) || null;
        let commands = [];
        scans.forEach((x) => { try { commands = commands.concat(JSON.parse(x.commands)); } catch (_) { /* none */ } });
        commands.sort((a, b) => (a.at || 0) - (b.at || 0));
        const uncommitted = opts.git === false ? null : gitDirty(agent.cwd);
        const dirty = uncommitted ? uncommitted.paths : new Set();
        const merged = new Map(); // one row per repo-relative path (a tool's absolute path and a shell's relative one)
        edits.forEach((e) => {
            const p = rel(e.path);
            const via = e.tool === 'Bash' ? 'shell' : 'tool';
            const cur = merged.get(p);
            if (!cur) { merged.set(p, { path: p, tool: e.tool, via, edits: e.n, lastAt: e.last_at, uncommitted: uncommitted ? dirty.has(p) : null }); return; }
            cur.edits += e.n;
            cur.lastAt = Math.max(cur.lastAt || 0, e.last_at || 0) || null;
            if (via === 'tool') { cur.via = 'tool'; cur.tool = e.tool; }
        });
        // a shell mention only counts while that file is changed
        const files = [...merged.values()].filter((f) => f.via === 'tool' || f.uncommitted !== false).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
        return {
            agent: Object.assign({}, agent, { live: rec ? { status: rec.status || '', remoteControl: !!rec.bridgeSessionId, link: rec.bridgeSessionId ? `https://claude.ai/code/${rec.bridgeSessionId}` : '' } : null }),
            claims: liveClaims({ agentId: agent.id }),
            edited: { total: totalEdited, files },
            commands: commands.slice(-(Number(opts.commands) || 10)),
            lastMessage: main ? { text: main.last_text, at: main.last_at } : null,
            toolCalls: scans.reduce((n, x) => n + x.tools, 0),
            uncommitted: uncommitted ? { count: uncommitted.count, files: uncommitted.files } : null
        };
    }

    /** Which agents edited a path (for "who touched this" before editing). */
    function editorsOf(paths, opts = {}) {
        const d = open();
        const agents = listAgents({ all: opts.all === true }).filter((a) => a.sessionId);
        agents.forEach((a) => { try { scanSession(a.sessionId); } catch (_) { /* skipped */ } });
        const bySession = new Map(agents.map((a) => [a.sessionId, a]));
        return (Array.isArray(paths) ? paths : [paths]).filter(Boolean).map((p) => {
            const want = String(p).replace(/^\.\/+/, '');
            const rows = d.prepare('SELECT * FROM edits WHERE path = ? OR path LIKE ?').all(want, `%/${want.replace(/[%_]/g, '')}`);
            return {
                path: want,
                editedBy: rows.filter((r) => bySession.has(r.session_id)).map((r) => {
                    const a = bySession.get(r.session_id);
                    return { agentId: a.id, name: a.name, status: a.status, edits: r.n, lastAt: r.last_at };
                })
            };
        });
    }

    // ------------------------------------------------------------ build gates

    function expireBuilds() {
        const d = open();
        const t = now();
        d.prepare("UPDATE builds SET state = 'expired', ended_at = ? WHERE state = 'open' AND expires_at < ?").run(t, t);
        d.prepare("UPDATE builds SET state = 'expired', ended_at = ?, result = 'lapsed: nobody ended it' WHERE state = 'running' AND started_at < ?").run(t, t - GATE_RUN_MS);
        // a running build whose builder is gone lapses too
        d.prepare("SELECT id, requested_by FROM builds WHERE state = 'running'").all().forEach((b) => {
            const a = getAgent(b.requested_by);
            if (!a || a.status === 'gone') d.prepare("UPDATE builds SET state = 'expired', ended_at = ?, result = 'lapsed: the builder is gone' WHERE id = ?").run(t, b.id);
        });
    }

    function rowBuild(b) {
        return { id: b.id, target: b.target, repo: b.repo, requestedBy: b.requested_by, note: b.note, state: b.state, createdAt: b.created_at, expiresAt: b.expires_at, startedAt: b.started_at, endedAt: b.ended_at, result: b.result, forced: b.forced };
    }

    /**
     * Does this agent have uncommitted work of its own? (files git shows as changed in its folder that its own session
     * edited). An agent without any is not asked by a build gate: nothing of its can be half done (Yukimi, Nov 24 2026:
     * asking idle or finished sessions wastes their usage). Cached 15 s per agent.
     */
    const dirtyCache = new Map();
    function ownDirty(a) {
        if (!a || !a.sessionId || !a.cwd) return true; // unknown: ask
        const hit = dirtyCache.get(a.id);
        if (hit && now() - hit.at < 15000) return hit.dirty;
        let dirty = true;
        try {
            const out = require('child_process').execFileSync('git', ['-C', a.cwd, 'status', '--porcelain', '-uall'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
            const changed = out.split('\n').map((l) => l.slice(3).trim().replace(/^"|"$/g, '').split(' -> ').pop()).filter(Boolean);
            if (!changed.length) dirty = false;
            else {
                try { scanSession(a.sessionId); } catch (_) { /* older rows only */ }
                const mine = open().prepare('SELECT path FROM edits WHERE session_id = ?').all(a.sessionId).map((r) => String(r.path));
                dirty = changed.some((c) => mine.some((m) => m === c || m.endsWith(`/${c}`) || c.endsWith(`/${m}`)));
            }
        } catch (_) { dirty = true; }
        dirtyCache.set(a.id, { at: now(), dirty });
        return dirty;
    }

    /**
     * Everyone a gate waits on: every live agent in the repo but the builder. ready (answered yes), not-ready
     * (answered no, with why), auto (not busy and holding no claim in the repo: nothing of theirs is half
     * done), pending (busy or holding claims, not answered yet).
     */
    function gateState(b) {
        const d = open();
        const votes = new Map(d.prepare('SELECT * FROM build_votes WHERE build_id = ?').all(b.id).map((v) => [v.agent_id, v]));
        const claims = liveClaims({ repo: b.repo });
        const others = listAgents().filter((a) => a.id !== b.requested_by && a.repo === b.repo);
        const participants = others.map((a) => {
            const v = votes.get(a.id);
            const held = claims.filter((c) => c.agentId === a.id);
            const busy = isBusy(a);
            let state = 'pending';
            if (v) state = v.ready ? 'ready' : 'not-ready';
            else if (!held.length && (!busy || !ownDirty(a))) state = 'auto';
            return { agentId: a.id, name: a.name, kind: a.kind, task: a.task, busy, claims: held.map((c) => c.path), state, note: v ? v.note : '', answeredAt: v ? v.at : null };
        });
        const running = d.prepare("SELECT * FROM builds WHERE state = 'running' AND repo = ? AND target = ? AND id != ?").get(b.repo, b.target, b.id);
        const waitingOn = participants.filter((p) => p.state === 'pending' || p.state === 'not-ready');
        return {
            build: rowBuild(b),
            participants,
            waitingOn: waitingOn.map((p) => ({ agentId: p.agentId, name: p.name, state: p.state, note: p.note })),
            otherBuildRunning: running ? rowBuild(running) : null,
            canBegin: b.state === 'open' && !waitingOn.length && !running
        };
    }

    function getBuild(id) {
        expireBuilds();
        const b = open().prepare('SELECT * FROM builds WHERE id = ?').get(Number(id));
        if (!b) throw new Error(`No build gate ${id} (coord_builds lists them)`);
        return b;
    }

    /**
     * Asks every live agent in the repo whether it is ready for a build of target. An open or running gate
     * for the same target is joined instead of making a second one. Returns the gate, who it waits on and
     * the agents it notified (a message each; notify(agent) may also type it into a busy session).
     */
    function buildRequest(agentId, o = {}) {
        expireBuilds();
        const d = open();
        const me = getAgent(agentId);
        if (!me) throw new Error('Unknown agent: call coord_hello first');
        const repo = text(o.repo || me.repo || '', 120);
        if (!repo) throw new Error('Which repo? Pass repo or work from inside one');
        const target = text(o.target || 'build', 80).trim() || 'build';
        const have = d.prepare("SELECT * FROM builds WHERE repo = ? AND target = ? AND state IN ('open', 'running') ORDER BY id DESC").get(repo, target);
        if (have) return Object.assign({ joined: true, notified: [] }, gateState(have));
        const t = now();
        const minutes = Math.max(5, Math.min(240, Number(o.waitMinutes) || GATE_OPEN_MS / 60000));
        const r = d.prepare('INSERT INTO builds (target, repo, requested_by, note, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(target, repo, agentId, text(o.note, 300), 'open', t, t + minutes * 60000);
        const b = d.prepare('SELECT * FROM builds WHERE id = ?').get(r.lastInsertRowid);
        const st = gateState(b);
        const notified = [];
        st.participants.filter((p) => p.state === 'pending').forEach((p) => {
            const body = `Build gate ${b.id}: ${me.name || me.id} wants to build ${target} in ${repo}${b.note ? ` (${b.note})` : ''}. When your work there is in a state that builds (saved, nothing half-edited), call coord_build_ready with build ${b.id} and ready true; if it is not, ready false and why. The build waits for you.`;
            const msg = post(agentId, p.agentId, body, { kind: 'question' });
            let how = '';
            if (typeof o.notify === 'function') { try { how = o.notify(getAgent(p.agentId), msg) || ''; } catch (_) { how = ''; } }
            notified.push({ agentId: p.agentId, name: p.name, messageId: msg.id, delivered: how || 'inbox' });
        });
        return Object.assign({ joined: false, notified }, st);
    }

    function buildReady(agentId, id, ready, note) {
        const b = getBuild(id);
        if (b.state !== 'open' && b.state !== 'running') throw new Error(`Build gate ${b.id} is ${b.state}`);
        open().prepare('INSERT OR REPLACE INTO build_votes (build_id, agent_id, ready, note, at) VALUES (?, ?, ?, ?, ?)').run(b.id, String(agentId), ready ? 1 : 0, text(note, 300), now());
        const st = gateState(b);
        if (st.canBegin) post(agentId, b.requested_by, `Build gate ${b.id} (${b.target}): everyone is ready. coord_build_begin ${b.id} to start.`, { kind: 'reply' });
        else if (!ready) post(agentId, b.requested_by, `Build gate ${b.id} (${b.target}): not ready${note ? `: ${text(note, 300)}` : ''}`, { kind: 'reply' });
        return st;
    }

    /**
     * Starts the build: only when nobody is pending or not ready and no other build of the target runs.
     * force (with a reason) starts it anyway; everyone is told it was forced.
     */
    function buildBegin(agentId, id, o = {}) {
        const b = getBuild(id);
        if (b.requested_by !== String(agentId)) throw new Error(`Build gate ${b.id} is ${b.requested_by}'s: request your own (coord_build_request joins an open one)`);
        if (b.state === 'running') return Object.assign({ began: true, already: true }, gateState(b));
        if (b.state !== 'open') throw new Error(`Build gate ${b.id} is ${b.state}: request a new one`);
        const st = gateState(b);
        if (!st.canBegin && !o.force) return Object.assign({ began: false, why: st.otherBuildRunning ? `Build ${st.otherBuildRunning.id} of ${b.target} is running` : `Waiting on ${st.waitingOn.map((w) => `${w.name || w.agentId} (${w.state})`).join(', ')}` }, st);
        if (o.force && !String(o.reason || '').trim()) throw new Error('force needs a reason (everyone is told)');
        const forced = !st.canBegin && o.force ? text(o.reason, 300) : '';
        open().prepare("UPDATE builds SET state = 'running', started_at = ?, forced = ? WHERE id = ?").run(now(), forced, b.id);
        const me = getAgent(agentId);
        post(agentId, null, `Build ${b.id}: ${me ? me.name || me.id : agentId} started building ${b.target} in ${b.repo}${forced ? ` (FORCED: ${forced}; waiting on ${st.waitingOn.map((w) => w.name || w.agentId).join(', ')})` : ''}. Leave the files it builds alone until it ends.`, { kind: 'note' });
        return Object.assign({ began: true }, gateState(getBuild(b.id)));
    }

    function buildEnd(agentId, id, result) {
        const b = getBuild(id);
        if (b.requested_by !== String(agentId)) throw new Error(`Build gate ${b.id} is ${b.requested_by}'s`);
        if (b.state !== 'running' && b.state !== 'open') throw new Error(`Build gate ${b.id} is ${b.state}`);
        const done = b.state === 'running' ? 'done' : 'cancelled';
        open().prepare('UPDATE builds SET state = ?, ended_at = ?, result = ? WHERE id = ?').run(done, now(), text(result, 300), b.id);
        post(agentId, null, `Build ${b.id} (${b.target} in ${b.repo}) ${done === 'done' ? 'ended' : 'was cancelled'}${result ? `: ${text(result, 300)}` : ''}.`, { kind: 'done' });
        return rowBuild(getBuild(b.id));
    }

    /** A person (Claude Accounts) ends or cancels anyone's gate; everyone is told who and why. */
    function adminEndBuild(id, byAgentId, reason) {
        const b = getBuild(id);
        if (b.state !== 'running' && b.state !== 'open') throw new Error(`Build gate ${b.id} is ${b.state}`);
        const state = b.state === 'running' ? 'done' : 'cancelled';
        open().prepare('UPDATE builds SET state = ?, ended_at = ?, result = ? WHERE id = ?').run(state, now(), text(`${reason} (by ${byAgentId})`, 300), b.id);
        post(byAgentId, null, `Build gate ${b.id} (${b.target} in ${b.repo}) was ${state === 'done' ? 'ended' : 'cancelled'} by ${byAgentId}: ${text(reason, 200)}.`, { kind: 'done' });
        return rowBuild(getBuild(b.id));
    }

    /** Open and running gates (and, with recent, the ones that ended in the last day). */
    function builds(o = {}) {
        expireBuilds();
        const d = open();
        const rows = o.recent
            ? d.prepare("SELECT * FROM builds WHERE state IN ('open', 'running') OR COALESCE(ended_at, 0) > ? ORDER BY id DESC LIMIT 50").all(now() - 86400000)
            : d.prepare("SELECT * FROM builds WHERE state IN ('open', 'running') ORDER BY id DESC").all();
        return rows.filter((b) => !o.repo || b.repo === o.repo).map((b) => (b.state === 'open' ? gateState(b) : { build: rowBuild(b) }));
    }

    return {
        shellArtifacts, acceptArtifactPath, lockMentions,
        plantLock, removeLocks, lockFiles, liveRecord, isBusy,
        scanSession, inspect, editorsOf, gitDirty,
        buildRequest, buildReady, buildBegin, buildEnd, adminEndBuild, builds, gateState
    };
};
