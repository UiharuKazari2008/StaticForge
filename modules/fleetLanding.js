'use strict';

/**
 * Fleet landing check (Yukimi, Nov 25 2026: "the supervisor should also ensure that every single work item has committed their
 * work and it's merged to main with its conflicts resolved and does not delete another's work").
 *
 * checkLanding(item, opts) -> { ok, problems: [{ kind, text, files?, commits? }],
 *     commits: [{ sha, subject, how, landed?, landedAs? }], held: [{ file, holder, why }], notes: [] }
 *   item: { id, sessionId, startedAt (ms), cwd, agentId? }
 *   kinds: 'uncommitted', 'not-landed', 'conflict', 'removed-others'
 *   opts.deps (all optional, injectable for tests): git(args, {cwd, timeout, input}) -> {code, stdout, stderr},
 *     edited(item, root) -> [{ path (repo relative), lastAt }],
 *     transcript(item) -> { commits: [{ sha, subject }], pushed: [sha], subjects: [message paragraph] },
 *     claims(paths, item, root) -> [{ file, agentId, path (as claimed) }] (live claims of other agents over those files),
 *     editors(path, item, root) -> [{ agentId, lastAt }] (other sessions that edited the path), now()
 *
 * Origin/main is what counts (#1391): sessions land straight onto it from their own worktrees and the live tree is never
 * pulled, so its local HEAD is far behind and says little.
 *   uncommitted  a file the item wrote that is dirty against HEAD AND does not hold what origin/main holds, or held at some
 *                point since the item started (landed, then origin moved on). Without an origin/main: HEAD alone.
 *   not its own  an uncommitted or conflicted file that another live agent claims, or that another session edited after this
 *                item's last write to it, is never blamed on the item: it is listed in `held` with its holder and nobody is
 *                told to land it.
 *   commits      what git printed, plus the subjects in the item's own commit commands (`git commit -q` prints no sha) looked
 *                up on local main and origin/main; a subject under 30 characters counts only when the commit holds nothing but
 *                files the item wrote. `landed` ('ancestor' | 'patch-id' | 'subject') and `landedAs` (the sha on origin/main)
 *                say where each is; 'content' (no landedAs) is a commit with no copy there whose every file origin/main holds
 *                as the commit left it, now or at some point since the commit (squashed or re-committed under other words); a local commit and its copy on origin are one entry, and removed lines are judged on the
 *                origin copy.
 *   gone files   a path origin/main ever had is judged on origin/main alone; only one it never had is judged on local HEAD.
 *
 * gate(hooks, work, summary) is the Supervisor's done decision: { done, note }. It holds the item in Running with the first
 * problem, steers the live session once per distinct problem set, and hands the landing to a new started work item when the
 * session is gone or did not fix it. Never Input Required; every outcome is one line on the item's issue.
 *
 * Power / event loop: no timer, runs only when the Supervisor already decides an item's state; every git call is async through
 * the spawn helper (modules/spawnHelper.js), with timeouts, and the work is capped (20 commits analysed out of at most 60 shas,
 * 2000 removed lines, ~400 origin commits by patch-id, 500 hits per subject search). The coord edit index is refreshed at most
 * once a check, only when a file needs a holder, yielding between sessions.
 */

const fs = require('fs');
const path = require('path');

const ORIGIN = 'refs/remotes/origin/main';
const FETCH_CACHE_MS = 60 * 1000;
const GIT_TIMEOUT = 20000;
const MAX_COMMITS = 20;
const MAX_REMOVED = 2000;
const MAX_ORIGIN = 400;
const OTHERS_MS = 7 * 24 * 3600 * 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MIN_SUBJECT = 30;          // a shorter subject proves nothing by itself
const MAX_SUBJECTS = 80;         // subjects looked up per check
const MAX_HITS = 500;            // commits one subject search may answer
const MAX_GREP = 300;            // characters of a subject line given to --grep (a prefix finds it too)
const MAX_SCANS = 250;           // sessions whose edit index one check refreshes
const SCAN_BUDGET_MS = 20000;
const MAX_CMD = 200 * 1024;      // characters of one shell command that are read
const MAX_SUB_DEPTH = 6;

const fetchedAt = new Map(); // repo root -> { at, p }

function realGit(args, o = {}) {
    return require('./spawnHelper').run('git', args, { cwd: o.cwd, timeout: o.timeout || GIT_TIMEOUT, maxBuffer: 64 * 1024 * 1024, input: o.input });
}

const ok0 = (r) => r && r.code === 0;
const lines = (s) => String(s || '').split('\n').filter(Boolean);
const sinceArgs = (ms) => (ms >= 1000 ? [`--since=@${Math.floor(ms / 1000)}`] : []); // no limit rather than a date git misreads
const short = (s) => String(s || '').slice(0, 8);

// ---------------------------------------------------------------- transcript (the session's own git output)

// "[main 1a2b3c4] subject", "[main (root-commit) 1a2b3c4] subject", "[detached HEAD 1a2b3c4] subject" (a worktree)
const COMMIT_OUT = /\[(?:detached HEAD|[\w./-]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.*)/;
const PUSH_OUT = /[0-9a-f]{7,40}\.\.([0-9a-f]{7,40})\s+\S+\s+->\s+\S+/;

function toolResultText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
    return '';
}

// ---------------------------------------------------------------- the commit commands themselves

/**
 * The simple commands of a shell command line, quotes decoded: [{ words, stdin (its heredoc or here-string), from (the command
 * piped into it) }]. $( ) and backticks are read into commands of their own; the text of a heredoc is never read as commands
 * (a document that quotes "git commit" is not a commit).
 */
function shellCommands(source) {
    const s = String(source || '').slice(0, MAX_CMD);
    const out = [];
    const heredocs = []; // opened on this line, their text starts on the next: { tag, tabs, cmd }
    let i = 0;
    const readHeredocs = (inParens) => {
        while (heredocs.length) {
            const h = heredocs.shift();
            const body = [];
            while (i < s.length) {
                let end = s.indexOf('\n', i);
                if (end < 0) end = s.length;
                const raw = s.slice(i, end);
                const line = h.tabs ? raw.replace(/^\t+/, '') : raw;
                if (line === h.tag) { i = end + 1; break; }
                if (inParens && line.startsWith(`${h.tag})`)) { i += raw.length - line.length + h.tag.length; break; }
                body.push(line);
                i = end + 1;
            }
            h.cmd.stdin = body.join('\n');
        }
    };
    const skipArithmetic = () => { const end = s.indexOf('))', i); i = end < 0 ? s.length : end + 2; return '$(())'; };
    // the value of $( ... ): the text for $(cat <<'EOF' ...), otherwise a placeholder that matches no subject
    const substitution = (close, depth) => {
        if (depth >= MAX_SUB_DEPTH) { i = s.length; return '$()'; }
        const outer = heredocs.splice(0);
        const first = out.length;
        read(close, depth + 1);
        heredocs.splice(0, heredocs.length, ...outer);
        const inner = out.slice(first);
        const c = inner.length === 1 ? inner[0] : null;
        return c && c.words[0] === 'cat' && c.words.slice(1).every((w) => w === '-') && c.stdin !== null ? c.stdin.replace(/\n+$/, '') : '$()';
    };
    const doubleQuoted = (depth) => {
        let v = '';
        while (i < s.length) {
            const c = s[i];
            if (c === '"') { i += 1; return v; }
            if (c === '\\' && '"\\$`\n'.includes(s[i + 1] || ' ')) { if (s[i + 1] !== '\n') v += s[i + 1]; i += 2; }
            else if (c === '$' && s[i + 1] === '(') { if (s[i + 2] === '(') v += skipArithmetic(); else { i += 2; v += substitution(')', depth); } }
            else if (c === '`') { i += 1; v += substitution('`', depth); }
            else { v += c; i += 1; }
        }
        return v;
    };
    function read(close, depth) {
        let cmd = { words: [], stdin: null, from: null };
        let word = null;   // null: no word is open
        let next = '';     // 'drop': the next word is a redirect's file; 'here': a here-string
        let parens = 0;
        const add = (t) => { word = (word === null ? '' : word) + t; };
        const endWord = () => {
            if (word === null) return;
            if (next === 'here') cmd.stdin = word; else if (next !== 'drop') cmd.words.push(word);
            next = '';
            word = null;
        };
        const endCmd = (piped) => {
            endWord();
            next = '';
            const done = cmd;
            if (done.words.length) out.push(done);
            cmd = { words: [], stdin: null, from: piped ? done : (done.words.length ? null : done.from) };
        };
        while (i < s.length) {
            const c = s[i];
            if (c === close && !(c === ')' && parens > 0)) { i += 1; endCmd(); return; }
            if (c === '\\') { if (s[i + 1] !== '\n') add(s[i + 1] || ''); i += 2; }
            else if (c === "'") { const e = s.indexOf("'", i + 1); const stop = e < 0 ? s.length : e; add(s.slice(i + 1, stop)); i = stop + 1; }
            else if (c === '"') { i += 1; add(doubleQuoted(depth)); }
            else if (c === '$' && s[i + 1] === "'") {
                const m = /^\$'((?:[^'\\]|\\[\s\S])*)'/.exec(s.slice(i));
                if (!m) { add(c); i += 1; continue; }
                add(m[1].replace(/\\([\s\S])/g, (x, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch)));
                i += m[0].length;
            } else if (c === '$' && s[i + 1] === '(') { if (s[i + 2] === '(') add(skipArithmetic()); else { i += 2; add(substitution(')', depth)); } }
            else if (c === '`') { i += 1; add(substitution('`', depth)); }
            else if (c === ' ' || c === '\t' || c === '\r') { endWord(); i += 1; }
            else if (c === '#' && word === null) { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; }
            else if (c === '\n') { i += 1; endCmd(); readHeredocs(close === ')'); }
            else if (c === '<' || c === '>' || (c === '&' && s[i + 1] === '>')) {
                if (word !== null && /^\d+$/.test(word)) word = null; else endWord(); // "2>" names a descriptor
                if (s.startsWith('<<<', i)) { i += 3; next = 'here'; }
                else if (s.startsWith('<<', i)) {
                    const m = /^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|([^\s;&|<>()]+))/.exec(s.slice(i, i + 200));
                    if (!m) { i += 2; continue; }
                    heredocs.push({ tag: m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4].replace(/\\/g, ''), tabs: m[1] === '-', cmd });
                    i += m[0].length;
                } else if (c !== '&' && s[i + 1] === '(') { i += 2; substitution(')', depth); }
                else { i += /^(?:&>>|&>|>>|>&|>\||<&|<>|<|>)/.exec(s.slice(i, i + 3))[0].length; next = 'drop'; }
            } else if (c === ';' || c === '&' || c === '|') {
                const two = s[i + 1] === c || (c === '|' && s[i + 1] === '&');
                const piped = c === '|' && s[i + 1] !== '|';
                i += two ? 2 : 1;
                endCmd(piped);
            } else if (c === '(' && s[i + 1] === '(' && word === null) skipArithmetic(); // its "<<" is a shift, not a heredoc
            else if (c === '(' || c === ')') { parens = Math.max(0, parens + (c === '(' ? 1 : -1)); endCmd(); i += 1; }
            else { add(c); i += 1; }
        }
        endCmd();
    }
    read('', 0);
    return out;
}

const WRAPPERS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', 'time', 'env', 'nice', 'nohup', 'command', 'sudo', 'exec', 'stdbuf', 'timeout']);
const GIT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const COMMIT_VALUE = new Set(['-C', '-c', '-t', '--author', '--date', '--template', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--trailer', '--cleanup', '--pathspec-from-file']);

/** A message's first paragraph, its line breaks kept (git's subject is these lines joined by a space). */
function firstParagraph(message) {
    const all = String(message || '').split('\n').map((l) => l.trimEnd());
    const a = all.findIndex((l) => l.trim());
    if (a < 0) return '';
    let b = a;
    while (b < all.length && all[b].trim()) b += 1;
    return all.slice(a, b).join('\n').trimStart();
}

/** The subject one simple command gives a commit (git commit / commit-tree with -m, or its message on stdin); '' otherwise. */
function commandSubject(cmd) {
    const w = cmd.words;
    let k = 0;
    while (k < w.length) {
        if (/^[A-Za-z_]\w*\+?=/.test(w[k])) { k += 1; continue; }
        if (!WRAPPERS.has(w[k])) break;
        k += 1;
        while (k < w.length && (w[k].startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(w[k]))) k += 1; // its options and time limit
    }
    if (path.basename(w[k] || '') !== 'git') return '';
    k += 1;
    while (k < w.length && w[k].startsWith('-')) k += GIT_VALUE.has(w[k]) ? 2 : 1;
    const verb = w[k];
    if (verb !== 'commit' && verb !== 'commit-tree') return '';
    const tree = verb === 'commit-tree';
    let message = null;
    let file = null;
    for (k += 1; k < w.length && w[k] !== '--'; k += 1) {
        const a = w[k];
        const long = /^--(message|file)(?:=([\s\S]*))?$/.exec(a);
        const letters = /^-[aqvsneiopz]*([mF])([\s\S]*)$/.exec(a); // -m x, -qm x, -am"x", -F -, -F-
        if (long || letters) {
            const isMessage = long ? long[1] === 'message' : letters[1] === 'm';
            let v = long ? long[2] : (letters[2] || undefined);
            if (v === undefined) { k += 1; v = w[k]; }
            if (isMessage) { if (message === null) message = v || ''; } else file = v || '';
        } else if (COMMIT_VALUE.has(a) || (tree && a === '-p')) k += 1;
    }
    if (message === null && (file === '-' || (tree && file === null))) {
        message = cmd.stdin !== null ? cmd.stdin : (cmd.from && cmd.from.words[0] === 'cat' ? cmd.from.stdin : null);
    }
    return firstParagraph(message);
}

const commitSubjects = (command) => (/commit/.test(command) ? shellCommands(command).map(commandSubject).filter(Boolean) : []);

/** True when a commit's %s is the subject a command gave it; a paragraph of several lines may also match by its first line. */
function subjectMatches(subject, wanted) {
    const parts = String(wanted).split('\n');
    if (subject === parts.join(' ')) return true;
    return parts.length > 1 && parts[0].length >= MIN_SUBJECT && subject.startsWith(`${parts[0]} `);
}

/**
 * Reads one transcript file (jsonl) after sinceMs: what `git commit` and `git push` printed (commits, pushed), and the subjects
 * written in its commit commands (`git commit -q` prints nothing): subjects from commands that succeeded, unsure from commands
 * that failed (`git commit -q && git push` with a refused push made the commit all the same).
 */
async function readTranscript(file, sinceMs) {
    const out = { commits: [], pushed: [], subjects: [], unsure: [] };
    if (!file) return out;
    const pending = new Map(); // tool_use id of a Bash command that commits or pushes -> the subjects it commits
    const rl = require('readline').createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line.includes('git') && !pending.size) continue;
        let o;
        try {
            if (line.includes('"tool_use"') && line.includes('git') && /commit|push|cherry-pick/.test(line)) o = JSON.parse(line);
            else if (pending.size && line.includes('"tool_result"')) o = JSON.parse(line);
            else continue;
        } catch (_) { continue; }
        const at = Date.parse(o.timestamp || '') || 0;
        if (at && at < sinceMs) continue;
        const parts = (o.message && Array.isArray(o.message.content)) ? o.message.content : [];
        parts.forEach((c) => {
            if (!c) return;
            if (c.type === 'tool_use' && c.name === 'Bash' && c.id) {
                const command = String((c.input && c.input.command) || '');
                const subjects = commitSubjects(command);
                if (subjects.length || /git[^\n]{0,80}(commit|push|cherry-pick)/.test(command)) pending.set(c.id, subjects);
            } else if (c.type === 'tool_result' && pending.has(c.tool_use_id)) {
                const into = c.is_error === true ? out.unsure : out.subjects;
                pending.get(c.tool_use_id).forEach((s) => { if (!into.includes(s)) into.push(s); });
                pending.delete(c.tool_use_id);
                lines(toolResultText(c.content)).forEach((l) => {
                    let m = COMMIT_OUT.exec(l);
                    if (m && !/^(Auto-merging|error)/.test(l)) out.commits.push({ sha: m[1], subject: m[2].trim() });
                    m = PUSH_OUT.exec(l);
                    if (m) out.pushed.push(m[1]);
                });
            }
        });
    }
    return out;
}

async function defaultTranscript(item) {
    const file = await require('./claudeSessionLauncher').findFile(item.sessionId);
    const out = await readTranscript(file, item.startedAt || 0);
    // its background agents commit too: their transcripts sit in <session>/subagents/agent-*.jsonl
    try {
        const dir = path.join(path.dirname(file), item.sessionId, 'subagents');
        for (const n of (await fs.promises.readdir(dir)).filter((x) => /^agent-.*\.jsonl$/.test(x)).slice(0, 40)) {
            const r = await readTranscript(path.join(dir, n), item.startedAt || 0).catch(() => null);
            if (r) { out.commits.push(...r.commits); out.pushed.push(...r.pushed); out.subjects.push(...r.subjects); out.unsure.push(...r.unsure); }
        }
    } catch (_) { /* no subagents */ }
    return out;
}

/** The issue numbers a work item carries (#1012, #761 ...): a commit naming one of them is this item's own work. */
function itemIssueNumbers(item) {
    const out = new Set();
    if (item.issue && item.issue.number) out.add(Number(item.issue.number));
    (Array.isArray(item.issues) ? item.issues : []).forEach((i) => { if (i && i.number) out.add(Number(i.number)); });
    if (item.issue_number) out.add(Number(item.issue_number));
    return out;
}
const isLandingItem = (item) => /^supervisor:landing:/.test(String(item.sourceRef || item.source_ref || '')) || /^Land\b/.test(String(item.title || ''));

/** The files the session wrote (edit tools, clear shell writes): repo relative, with the last write time. */
async function defaultEdited(item, root) {
    const out = new Map();
    const rel = (p) => {
        let r = String(p || '');
        if (path.isAbsolute(r)) { if (!(r === root || r.startsWith(`${root}/`))) return ''; r = path.relative(root, r); }
        return r.startsWith('..') ? '' : r;
    };
    const add = (p, at) => { const r = rel(p); if (r) out.set(r, Math.max(out.get(r) || 0, at || 0)); };
    try {
        const store = require('./agentCoord/store');
        const ins = store.inspect(item.agentId || `claude-${String(item.sessionId).slice(0, 8)}`, { limit: 300, git: false });
        ((ins.edited && ins.edited.files) || []).forEach((f) => { if ((f.lastAt || 0) >= (item.startedAt || 0)) add(f.path, f.lastAt); });
    } catch (_) { /* no coord record */ }
    try {
        const sw = require('./agentCoord/activityIndex').sessionShellWrites(item.sessionId, item.startedAt || 0);
        sw.forEach((v, p) => add(p, v.last));
    } catch (_) { /* no index */ }
    return [...out].map(([p, lastAt]) => ({ path: p, lastAt }));
}

// ---------------------------------------------------------------- who else holds a file

const agentIdOf = (item) => item.agentId || `claude-${String(item.sessionId).slice(0, 8)}`;

/** The name claims are kept under (worktrees share it): store.repoOf's rule, asked without a blocking spawn. */
async function repoName(g, root) {
    const r = await g(['rev-parse', '--git-common-dir']);
    if (!ok0(r) || !r.stdout.trim()) return '';
    const common = path.resolve(root, r.stdout.trim());
    return path.basename(path.basename(common) === '.git' ? path.dirname(common) : common);
}

/** The live claims of other agents over these files: [{ file, agentId, path (as claimed) }]. */
async function defaultClaims(paths, item, root, g) {
    const store = require('./agentCoord/store');
    const repo = await repoName(g, root);
    if (!repo) return [];
    const me = agentIdOf(item);
    const others = store.liveClaims({ repo }).filter((c) => c.agentId !== me && (store.getAgent(c.agentId) || {}).sessionId !== item.sessionId);
    const out = [];
    paths.forEach((file) => {
        const c = others.find((x) => store.overlaps(file, x.path));
        if (c) out.push({ file, agentId: c.agentId, path: c.path });
    });
    return out;
}

/** Brings the edit index up to date for the other sessions seen this week, once, yielding between them. */
async function loadEditors(item, nowMs, notes) {
    const store = require('./agentCoord/store');
    const bySession = new Map(); // session id -> { agentId, repo, seenAt }
    store.open().prepare("SELECT id, session_id, repo, seen_at FROM agents WHERE session_id IS NOT NULL AND session_id != '' ORDER BY seen_at DESC").all().forEach((r) => {
        if (!bySession.has(r.session_id)) bySession.set(r.session_id, { agentId: r.id, repo: r.repo || '', seenAt: r.seen_at });
    });
    const stop = Date.now() + SCAN_BUDGET_MS;
    let n = 0;
    for (const [sid, a] of bySession) {
        if (sid === item.sessionId || nowMs - a.seenAt > OTHERS_MS) continue;
        if (n >= MAX_SCANS || Date.now() > stop) { notes.push('edit index: not every recent session was refreshed'); break; }
        store.scanSession(sid);
        n += 1;
        await new Promise((r) => setImmediate(r));
    }
    return { store, bySession };
}

/**
 * Other sessions that edited this very file, newest first: [{ agentId, lastAt }]. Only a row of exactly <root>/<path>, or of
 * <path> alone from an agent not known to work in another repo, counts (a worktree's copy and another repo's file of the same
 * name are other files). ctx: { git, now, notes } of one check; the index is refreshed once for all its files.
 */
async function defaultEditors(p, item, root, ctx) {
    if (!ctx.loaded) ctx.loaded = Promise.all([loadEditors(item, ctx.now, ctx.notes), repoName(ctx.git, root)]);
    const [{ store, bySession }, repo] = await ctx.loaded;
    const abs = path.join(root, p);
    const me = agentIdOf(item);
    const out = new Map();
    store.open().prepare('SELECT session_id, path, last_at FROM edits WHERE path = ? OR path = ?').all(abs, p).forEach((r) => {
        if (r.session_id === item.sessionId) return;
        const a = bySession.get(r.session_id) || { agentId: `claude-${String(r.session_id).slice(0, 8)}`, repo: '' };
        if (a.agentId === me || (r.path !== abs && a.repo && repo && a.repo !== repo)) return;
        const have = out.get(a.agentId);
        if (!have || (r.last_at || 0) > have.lastAt) out.set(a.agentId, { agentId: a.agentId, lastAt: r.last_at || 0 });
    });
    return [...out.values()].sort((x, y) => y.lastAt - x.lastAt);
}

// ---------------------------------------------------------------- what origin/main holds

/** The tree entries of these paths in a commit: Map path -> { mode, sha }, or null when git could not say. */
async function treeEntries(g, rev, paths) {
    const r = await g(['--literal-pathspecs', 'ls-tree', '-z', rev, '--', ...paths]);
    if (!ok0(r)) return null;
    const out = new Map();
    String(r.stdout).split('\0').filter(Boolean).forEach((e) => {
        const m = /^(\d{6}) \w+ ([0-9a-f]{40,64})\t([\s\S]+)$/.exec(e);
        if (m) out.set(m[3], { mode: m[1], sha: m[2] });
    });
    return out;
}

/** The working tree's files as git would store them: Map path -> { type: 'file' | 'link' | 'missing' | 'other', sha?, mode? }. */
async function workingBlobs(g, root, paths) {
    const out = new Map();
    const files = [];
    for (const p of paths) {
        const abs = path.join(root, p);
        try {
            const st = await fs.promises.lstat(abs);
            if (st.isSymbolicLink()) {
                const h = await g(['hash-object', '--no-filters', '--stdin'], { input: await fs.promises.readlink(abs) });
                out.set(p, ok0(h) ? { type: 'link', mode: '120000', sha: h.stdout.trim() } : { type: 'other' });
            } else if (st.isFile()) { out.set(p, { type: 'file', mode: st.mode & 0o100 ? '100755' : '100644' }); files.push(p); }
            else out.set(p, { type: 'other' });
        } catch (e) { out.set(p, { type: e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'missing' : 'other' }); }
    }
    if (files.length) { // hash-object with the path applies the same filters and attributes a commit would
        const all = await g(['hash-object', '--', ...files]);
        let shas = ok0(all) ? lines(all.stdout) : [];
        if (shas.length !== files.length) {
            shas = [];
            for (const p of files) { const one = await g(['hash-object', '--', p]); shas.push(ok0(one) ? one.stdout.trim() : ''); }
        }
        files.forEach((p, n) => { out.get(p).sha = shas[n]; });
    }
    return out;
}

const sameKind = (mode, w) => (w.type === 'link' ? mode === '120000' : w.type === 'file' && String(mode).startsWith('100'));

/**
 * The dirty files whose content is not on origin/main: not what it holds now, and not what it held at some point since the item
 * started (it landed, then origin moved on). A file missing here and there is landed too.
 */
async function notOnOrigin(g, root, paths, started, notes) {
    const now = await treeEntries(g, ORIGIN, paths);
    if (!now) { notes.push('origin/main could not be listed: compared with HEAD only'); return paths; }
    const work = await workingBlobs(g, root, paths);
    let head = null;
    let rest = [];
    const same = [];
    for (const p of paths) {
        const w = work.get(p);
        const o = now.get(p);
        let equal = w.type === 'missing' ? !o : !!(o && w.sha && o.sha === w.sha && sameKind(o.mode, w));
        if (equal && o && o.mode !== w.mode) { // a mode change that neither HEAD nor origin has is not committed
            if (!head) head = (await treeEntries(g, 'HEAD', paths)) || new Map();
            const h = head.get(p);
            equal = !h || h.mode === w.mode;
        }
        (equal ? same : rest).push(p);
    }
    const earlier = [];
    // only other content than origin holds now: a file refused for its mode alone has its content in that history too
    const changed = rest.filter((p) => work.get(p).sha && work.get(p).sha !== (now.get(p) || {}).sha);
    if (sinceArgs(started).length && changed.length) { // with no start time, any old version would count: skip
        const r = await g(['--literal-pathspecs', 'log', ORIGIN, ...sinceArgs(started), '--full-history', '--diff-merges=first-parent', '--no-renames', '--raw', '-z', '--no-abbrev', '--format=', '--', ...changed], { timeout: 30000 });
        if (ok0(r)) {
            const tok = String(r.stdout).split('\0');
            for (let n = 0; n < tok.length - 1; n += 1) {
                const m = /^\s*:\d{6} (\d{6}) [0-9a-f]+ ([0-9a-f]+) \w+$/.exec(tok[n]);
                if (!m) continue;
                n += 1;
                const w = work.get(tok[n]);
                if (w && w.sha === m[2] && sameKind(m[1], w) && !earlier.includes(tok[n])) earlier.push(tok[n]);
            }
            rest = rest.filter((p) => !earlier.includes(p));
        }
    }
    const list = (a) => `${a.slice(0, 6).join(', ')}${a.length > 6 ? ', ...' : ''}`;
    if (same.length) notes.push(`differs from the local HEAD only, same as origin/main: ${list(same)}`);
    if (earlier.length) notes.push(`holds what origin/main had since the item started (origin moved on): ${list(earlier)}`);
    return rest;
}

// ---------------------------------------------------------------- finding and placing commits

/** Commits of a ref since a time whose message holds one of these lines: [{ sha, subject, files }], newest first. */
async function searchSubjects(g, ref, sinceMs, subjectLines) {
    const greps = [...new Set(subjectLines.map((l) => String(l).slice(0, MAX_GREP)).filter(Boolean))].map((l) => `--grep=${l}`);
    if (!greps.length) return [];
    const r = await g(['-c', 'core.quotePath=false', 'log', ref, ...sinceArgs(sinceMs), '--no-merges', '--fixed-strings', ...greps, '-n', String(MAX_HITS), '--format=%x01%H%x09%s', '--name-only'], { timeout: 30000 });
    if (!ok0(r)) return [];
    return String(r.stdout).split('\x01').filter(Boolean).map((blk) => {
        const [first, ...files] = blk.split('\n');
        const [sha, ...subject] = first.split('\t');
        return { sha, subject: subject.join('\t'), files: files.filter(Boolean) };
    });
}

/** The patch ids of the commits `git log <args>` lists: [[patch id, sha]], in log order. */
async function patchIds(g, args) {
    const lp = await g(['log', '-p', '--no-color', '--no-ext-diff', '--format=commit %H', ...args], { timeout: 60000 });
    if (!ok0(lp) || !lp.stdout.trim()) return [];
    const r = await g(['patch-id', '--stable'], { input: lp.stdout, timeout: 60000 });
    return lines(r.stdout).map((l) => l.split(' ')).filter((x) => x[0] && x[1]);
}

/**
 * True when origin/main holds every file this commit changed as the commit left it (a deletion: the file is gone there), now or
 * in a version it got since the commit was made. Its work is there although no commit there is its copy.
 */
async function contentOnOrigin(g, sha) {
    const d = await g(['diff-tree', '-r', '-z', '--root', '--no-renames', '--no-commit-id', '--no-abbrev', sha]);
    if (!ok0(d)) return false;
    const tok = String(d.stdout).split('\0');
    const wanted = new Map(); // path -> { mode, sha }, or null for a deletion
    for (let n = 0; n < tok.length - 1; n += 2) {
        const m = /^:\d{6} (\d{6}) [0-9a-f]+ ([0-9a-f]+) (\w)/.exec(tok[n]);
        if (!m) return false;
        wanted.set(tok[n + 1], m[3] === 'D' ? null : { mode: m[1], sha: m[2] });
    }
    if (!wanted.size || wanted.size > 300) return false; // a merge or an empty commit proves nothing
    const tip = await treeEntries(g, ORIGIN, [...wanted.keys()]);
    if (!tip) return false;
    const open = new Set([...wanted.keys()].filter((p) => {
        const w = wanted.get(p);
        const o = tip.get(p);
        return w ? !(o && o.sha === w.sha && o.mode === w.mode) : !!o;
    }));
    if (!open.size) return true;
    if ([...open].some((p) => !wanted.get(p))) return false;
    const at = await g(['log', '-1', '--format=%ct', sha]);
    const since = ok0(at) ? Number(at.stdout.trim()) * 1000 : 0;
    if (!sinceArgs(since).length) return false;
    const r = await g(['--literal-pathspecs', 'log', ORIGIN, ...sinceArgs(since), '--full-history', '--diff-merges=first-parent', '--no-renames', '--raw', '-z', '--no-abbrev', '--format=', '--', ...open], { timeout: 30000 });
    if (!ok0(r)) return false;
    const held = String(r.stdout).split('\0');
    for (let n = 0; n < held.length - 1; n += 1) {
        const m = /^\s*:\d{6} (\d{6}) [0-9a-f]+ ([0-9a-f]+) \w+$/.exec(held[n]);
        if (!m) continue;
        n += 1;
        const w = wanted.get(held[n]);
        if (w && w.sha === m[2] && w.mode === m[1]) open.delete(held[n]);
    }
    return !open.size;
}

/**
 * Where each candidate commit is on origin/main: sets landed ('ancestor' | 'patch-id' | 'subject') and landedAs (the sha there),
 * or landed 'content' alone (contentOnOrigin),
 * and pid (its patch id) on those that are not simply ancestors.
 */
async function placeOnOrigin(g, cands, started) {
    const rest = [];
    for (const c of cands) {
        const anc = await g(['merge-base', '--is-ancestor', c.sha, ORIGIN]);
        if (anc.code === 0) { c.landed = 'ancestor'; c.landedAs = c.sha; } else rest.push(c);
    }
    if (!rest.length) return;
    const since = started - 3600 * 1000;
    const mineIds = new Map((await patchIds(g, ['--no-walk=unsorted', ...rest.map((c) => c.sha)])).map(([id, sha]) => [sha, id]));
    rest.forEach((c) => { c.pid = mineIds.get(c.sha) || ''; });
    const place = (c, how, sha) => { c.landed = how; c.landedAs = sha; };
    const byPatch = (ids) => { rest.forEach((c) => { if (!c.landed && c.pid && ids.has(c.pid)) place(c, 'patch-id', ids.get(c.pid)); }); };
    byPatch(new Map(await patchIds(g, ['--no-merges', '-n', String(MAX_ORIGIN), ...sinceArgs(since), ORIGIN])));
    if (rest.every((c) => c.landed)) return;
    // past the window, or landed with another patch (conflicts resolved): search origin for these subjects
    const open = rest.filter((c) => !c.landed);
    const hits = await searchSubjects(g, ORIGIN, since, open.map((c) => c.line));
    const wanted = new Set(open.map((c) => c.subject));
    const same = hits.filter((h) => wanted.has(h.subject));
    if (same.length) byPatch(new Map(await patchIds(g, ['--no-walk=unsorted', ...same.slice(0, MAX_COMMITS * 5).map((h) => h.sha)])));
    const claimed = new Set(cands.map((c) => c.landedAs).filter(Boolean));
    for (const c of open.filter((x) => !x.landed)) {
        const shown = await g(['-c', 'core.quotePath=false', 'show', '--no-color', '--format=', '--name-only', c.sha]);
        const files = new Set(ok0(shown) ? lines(shown.stdout) : []);
        const shares = (h) => h.files.some((f) => files.has(f));
        // a short subject says little: the commit there must at least touch one of the same files
        const m = same.filter((h) => h.subject === c.subject && (c.subject.length >= MIN_SUBJECT || shares(h)));
        const pick = m.find((h) => !claimed.has(h.sha) && shares(h)) || m.find(shares) || m.find((h) => !claimed.has(h.sha)) || m[0];
        if (pick) { place(c, 'subject', pick.sha); claimed.add(pick.sha); }
    }
    for (const c of open.filter((x) => !x.landed).slice(0, MAX_COMMITS)) { if (await contentOnOrigin(g, c.sha)) c.landed = 'content'; }
}

/**
 * Each piece of work once: a commit and its copies (the same place on origin/main, or the same patch while not there) are one
 * entry, shown by the local main commit when there is one: { sha, subject, how, landed?, landedAs? }.
 */
function pieces(cands) {
    const groups = new Map();
    cands.forEach((c) => {
        const key = c.landedAs ? `on ${c.landedAs}` : c.pid ? `patch ${c.pid}` : `sha ${c.sha}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    });
    const rank = (c) => (c.sha === c.landedAs ? 0 : c.onLocal ? 2 : 1);
    return [...groups.values()].map((list) => {
        const c = list.reduce((best, x) => (rank(x) > rank(best) ? x : best));
        const out = { sha: c.sha, subject: c.subject, how: c.how };
        if (c.landed) out.landed = c.landed;
        if (c.landedAs) out.landedAs = c.landedAs;
        return out;
    });
}

// ---------------------------------------------------------------- diff parsing

/**
 * The lines a commit removed, from `git show -U0`: [{ file, line (old number), text }], minus pure moves (the same text added
 * anywhere in the commit), whitespace-only changes and trivial lines ("}", "").
 */
function removedLines(diff) {
    const removed = [];
    const added = new Set();
    let oldFile = '';
    let oldNo = 0;
    const norm = (s) => s.replace(/\s+/g, '');
    for (const l of String(diff || '').split('\n')) {
        if (l.startsWith('--- ')) { oldFile = l === '--- /dev/null' ? '' : l.replace(/^--- (a\/)?/, ''); continue; }
        if (l.startsWith('+++ ') || l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('@@@')) continue;
        const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
        if (h) { oldNo = Number(h[1]); continue; }
        if (l.startsWith('-')) { removed.push({ file: oldFile, line: oldNo, text: l.slice(1) }); oldNo += 1; }
        else if (l.startsWith('+')) added.add(norm(l.slice(1)));
    }
    return removed.filter((r) => { const n = norm(r.text); return n.length > 2 && !added.has(n); });
}

function hasConflictMarkers(text) {
    return /^<<<<<<< /m.test(text) && /^=======$/m.test(text) && /^>>>>>>> /m.test(text);
}

// ---------------------------------------------------------------- the check

async function checkLanding(item, opts = {}) {
    const deps = opts.deps || {};
    const git = deps.git || realGit;
    const nowMs = (deps.now || Date.now)();
    const problems = [];
    const notes = [];
    const cwd = item.cwd || opts.repo || process.cwd();
    const started = Number(item.startedAt) || 0;

    const top = await git(['rev-parse', '--show-toplevel'], { cwd });
    if (!ok0(top)) return { ok: true, problems, commits: [], held: [], notes: ['not a git folder: nothing to land'], skipped: true };
    const root = top.stdout.trim();
    const g = (args, o = {}) => git(args, Object.assign({ cwd: root }, o));

    // origin, fetched once per 60 s per repo (async, never fails the check)
    if (deps.fetch !== false) {
        let f = fetchedAt.get(root);
        if (!f || nowMs - f.at > FETCH_CACHE_MS) {
            f = { at: nowMs, p: g(['fetch', '--quiet', 'origin', `+refs/heads/main:${ORIGIN}`], { timeout: 45000 }) };
            fetchedAt.set(root, f);
        }
        const r = await f.p;
        if (!ok0(r)) notes.push(`fetch origin failed (${String(r && r.stderr).trim().slice(0, 120)}): used the last known origin/main`);
    }
    const hasOrigin = ok0(await g(['rev-parse', '--verify', '-q', ORIGIN]));
    const local = ok0(await g(['rev-parse', '--verify', '-q', 'refs/heads/main'])) ? 'refs/heads/main' : 'HEAD';

    // what the session wrote
    const edited = (await (deps.edited || defaultEdited)(item, root)).filter((e) => e && e.path && (e.lastAt || 0) >= started);
    const editedPaths = edited.map((e) => e.path);
    const editedSet = new Set(editedPaths);

    // 1. committed
    const lastWrite = new Map(edited.map((e) => [e.path, e.lastAt || 0]));
    const uncommitted = [];
    if (editedPaths.length) {
        const st = await g(['--no-optional-locks', '--literal-pathspecs', 'status', '--porcelain', '-z', '--untracked-files=all', '--', ...editedPaths.slice(0, 300)]);
        const dirty = new Set();
        if (ok0(st)) {
            const entries = String(st.stdout).split('\0');
            for (let n = 0; n < entries.length; n += 1) {
                if (!entries[n]) continue;
                const names = [entries[n].slice(3)];
                if (/[RC]/.test(entries[n].slice(0, 2))) { n += 1; names.push(entries[n]); } // a rename's old name follows
                names.forEach((p) => { if (editedSet.has(p)) dirty.add(p); });
            }
        }
        const differs = hasOrigin && dirty.size ? await notOnOrigin(g, root, [...dirty], started, notes) : [...dirty];
        for (const p of differs) {
            const lc = await g(['--literal-pathspecs', 'log', '-1', '--format=%ct', 'HEAD', '--', p]);
            const committedAt = ok0(lc) && lc.stdout.trim() ? Number(lc.stdout.trim()) * 1000 : 0;
            if ((lastWrite.get(p) || 0) > committedAt) uncommitted.push(p);
        }
    }

    // 2. its commits
    const cands = new Map(); // full sha -> candidate
    let capped = false;
    const addCommit = async (sha, how, onLocal) => {
        const r = await g(['log', '-1', '--format=%H%x00%s%x00%B', `${sha}^{commit}`]);
        if (!ok0(r) || !r.stdout.trim()) return;
        const [full, subject, body] = r.stdout.split('\0');
        if (cands.has(full)) { if (onLocal) cands.get(full).onLocal = true; return; }
        if (cands.size >= MAX_COMMITS * 3) { capped = true; return; }
        cands.set(full, { sha: full, subject, line: String(body || '').split('\n').find((l) => l.trim()) || subject, how, onLocal: !!onLocal });
    };
    const tr = await (deps.transcript || defaultTranscript)(item).catch(() => ({ commits: [], pushed: [], subjects: [] }));
    for (const c of (tr.commits || [])) await addCommit(c.sha, 'printed by its git commit');
    for (const sha of (tr.pushed || [])) await addCommit(sha, 'printed by its git push');
    const named = [...new Set((tr.subjects || []).filter(Boolean))];       // from its commit commands
    const unsure = [...new Set((tr.unsure || []).filter(Boolean))];         // from commit commands that failed
    const printed = [...new Set((tr.commits || []).map((c) => c.subject).filter(Boolean))];
    const looking = [...new Set([...named, ...printed, ...unsure])];
    if (looking.length > MAX_SUBJECTS) notes.push(`${looking.length} commit subjects: only ${MAX_SUBJECTS} are looked up`);
    if (started && looking.length) {
        const wanted = looking.slice(0, MAX_SUBJECTS).map((x) => x.split('\n')[0]);
        const refs = [[local, 'local main', true]].concat(hasOrigin ? [[ORIGIN, 'origin/main', false]] : []);
        for (const [ref, label, isLocal] of refs) {
            for (const h of await searchSubjects(g, ref, started, wanted)) {
                if (!h.files.length) continue;
                const byCommand = named.some((x) => subjectMatches(h.subject, x));
                if (byCommand && h.subject.length >= MIN_SUBJECT) await addCommit(h.sha, `${label}, same subject`, isLocal);
                else if ((byCommand || printed.includes(h.subject)) && h.files.every((f) => editedSet.has(f))) await addCommit(h.sha, `${label}, same subject and only files it wrote`, isLocal);
                // a failed command may have made no commit at all: a commit with its subject must also hold a file the item wrote
                else if (h.subject.length >= MIN_SUBJECT && unsure.some((x) => subjectMatches(h.subject, x)) && h.files.some((f) => editedSet.has(f))) await addCommit(h.sha, `${label}, same subject as a failed command and a file it wrote`, isLocal);
            }
        }
    }
    if (capped) notes.push(`more than ${MAX_COMMITS * 3} commit shas: the rest are not checked`);

    // 3. on origin/main
    const all = [...cands.values()];
    if (hasOrigin && all.length) await placeOnOrigin(g, all, started);
    else if (!hasOrigin) notes.push(`no ${ORIGIN}: landing not checked`);
    const commits = pieces(all);
    const notLanded = !hasOrigin ? [] : commits.filter((c) => !c.landed)
        .map((c) => ({ kind: 'not-landed', text: `commit ${short(c.sha)} "${c.subject.slice(0, 100)}" is not on origin/main`, commits: [c.sha] }));
    const mine = new Set(all.flatMap((c) => [c.sha, c.landedAs]).filter(Boolean));
    const mySubjects = new Set(all.map((c) => c.subject));
    // a commit that names one of this item's issues is its own work (its background agents' commits, its own landed copies)
    const myIssues = itemIssueNumbers(item);
    const namesMyIssue = (subject) => [...String(subject || '').matchAll(/#(\d{2,6})\b/g)].some((m) => myIssues.has(Number(m[1])));
    // the copy on origin/main is judged where there is one: the stale local history credits lines to the wrong commits
    const judged = (c) => c.landedAs || c.sha;

    // files to look at for the rest: what it wrote and what its commits touched
    const files = new Set(editedPaths);
    for (const c of commits.slice(0, MAX_COMMITS)) {
        const r = await g(['-c', 'core.quotePath=false', 'show', '--no-color', '--format=', '--name-only', judged(c)]);
        if (ok0(r)) lines(r.stdout).forEach((f) => files.add(f));
    }

    // 4. conflicts
    const conflicted = [];
    const un = await g(['ls-files', '-u', '--', ...[...files].slice(0, 300)]);
    if (ok0(un)) lines(un.stdout).forEach((l) => { const p = l.split('\t')[1]; if (p && !conflicted.includes(p)) conflicted.push(p); });
    for (const f of files) {
        if (conflicted.includes(f)) continue;
        try {
            const abs = path.join(root, f);
            const st = await fs.promises.stat(abs);
            if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
            if (hasConflictMarkers(await fs.promises.readFile(abs, 'utf8'))) conflicted.push(f);
        } catch (_) { /* deleted or unreadable */ }
    }

    // whose are they? a file another agent holds, or edited after this item did, is not this item's to land
    const editorCtx = { git: g, now: nowMs, notes };
    const editorsFor = async (f) => {
        try {
            return (await (deps.editors ? deps.editors(f, item, root) : defaultEditors(f, item, root, editorCtx))) || [];
        } catch (e) {
            const why = `other sessions' edits could not be read (${String(e.message).slice(0, 80)})`;
            if (!notes.includes(why)) notes.push(why);
            return [];
        }
    };
    const held = [];
    const suspects = [...new Set([...uncommitted, ...conflicted])];
    if (suspects.length) {
        const me = agentIdOf(item);
        let claims = [];
        try { claims = (await (deps.claims ? deps.claims(suspects, item, root) : defaultClaims(suspects, item, root, g))) || []; }
        catch (e) { notes.push(`claims could not be read (${String(e.message).slice(0, 80)})`); }
        for (const f of suspects) {
            const claim = claims.find((c) => c && c.file === f && c.agentId && c.agentId !== me);
            if (claim) { held.push({ file: f, holder: claim.agentId, why: `it holds a live claim on ${claim.path || f}` }); continue; }
            const since = lastWrite.get(f) || started; // a file only its commits touched: edits since it started
            const later = (await editorsFor(f)).filter((x) => x && x.agentId !== me && (x.lastAt || 0) > since).sort((a, b) => b.lastAt - a.lastAt)[0];
            if (later) held.push({ file: f, holder: later.agentId, why: `it edited the file after this item did, ${new Date(later.lastAt).toISOString().slice(0, 16)}Z` });
        }
        held.forEach((h) => notes.push(`not this item's: ${h.file}, held by ${h.holder} (${h.why})`));
    }
    const heldFiles = new Set(held.map((h) => h.file));
    const own = uncommitted.filter((f) => !heldFiles.has(f));
    const ownConflicts = conflicted.filter((f) => !heldFiles.has(f));
    if (own.length) problems.push({ kind: 'uncommitted', text: `${own.length} file${own.length === 1 ? '' : 's'} it wrote differ${own.length === 1 ? 's' : ''} from ${hasOrigin ? 'origin/main' : 'HEAD'} and are not committed: ${own.slice(0, 6).join(', ')}${own.length > 6 ? ', ...' : ''}`, files: own });
    problems.push(...notLanded);
    if (ownConflicts.length) problems.push({ kind: 'conflict', text: `unresolved merge conflict in ${ownConflicts.slice(0, 6).join(', ')}`, files: ownConflicts });

    // 5. did not delete another's work (not for an item whose job is landing other sessions' commits: applying them changes their lines by design)
    let budget = isLandingItem(item) ? 0 : MAX_REMOVED;
    const byOther = new Map(); // other sha -> { subject, n, files:Set, by: [my shas] }
    for (const c of commits.slice(0, MAX_COMMITS)) {
        if (budget <= 0) break;
        const sh = await g(['show', '--no-color', '-U0', '--no-ext-diff', '-M', '--format=', judged(c)], { timeout: 30000 });
        if (!ok0(sh)) continue;
        const rem = removedLines(sh.stdout).slice(0, budget);
        budget -= rem.length;
        const perFile = new Map();
        rem.forEach((r) => { if (!r.file) return; if (!perFile.has(r.file)) perFile.set(r.file, []); perFile.get(r.file).push(r.line); });
        for (const [file, nums] of perFile) {
            const ranges = [...new Set(nums)].sort((a, b) => a - b).slice(0, 400).map((n) => `-L${n},${n}`);
            const bl = await g(['blame', '--porcelain', ...ranges, `${judged(c)}^`, '--', file], { timeout: 30000 });
            if (!ok0(bl)) continue;
            const info = new Map(); // sha -> { time, summary }
            let cur = '';
            let n = 0;
            const perSha = new Map();
            for (const l of String(bl.stdout).split('\n')) {
                const m = /^([0-9a-f]{40}) \d+ \d+/.exec(l);
                if (m) { cur = m[1]; n += 1; perSha.set(cur, (perSha.get(cur) || 0) + 1); if (!info.has(cur)) info.set(cur, {}); continue; }
                if (l.startsWith('committer-time ') && cur) info.get(cur).time = Number(l.slice(15)) * 1000;
                else if (l.startsWith('summary ') && cur) info.get(cur).summary = l.slice(8);
            }
            for (const [sha, cnt] of perSha) {
                const i = info.get(sha) || {};
                if (mine.has(sha) || mySubjects.has(i.summary) || namesMyIssue(i.summary)) continue;
                if (!i.time || nowMs - i.time > OTHERS_MS || /^0+$/.test(sha)) continue;
                const e = byOther.get(sha) || { subject: i.summary || '', n: 0, files: new Set(), by: new Set() };
                e.n += cnt; e.files.add(file); e.by.add(c.sha);
                byOther.set(sha, e);
            }
        }
    }
    for (const [sha, e] of byOther) {
        problems.push({ kind: 'removed-others', text: `it removed ${e.n} line${e.n === 1 ? '' : 's'} from ${[...e.files].slice(0, 4).join(', ')} that commit ${short(sha)} "${e.subject.slice(0, 80)}" (another session, under 7 days old) wrote`, files: [...e.files], commits: [sha, ...e.by] });
    }
    // a file of its own that is gone while another session edited it recently. A path origin/main ever had is judged there alone
    // (local HEAD is behind); only one it never had is judged on local HEAD
    const gone = [];
    const looked = [...files].slice(0, 200);
    const onOrigin = hasOrigin && looked.length ? await treeEntries(g, ORIGIN, looked) : null;
    const has = async (args) => { const r = await g(['--literal-pathspecs', 'log', '-1', '--format=%H', ...args]); return ok0(r) && !!r.stdout.trim(); };
    for (const f of looked) {
        if (onOrigin && onOrigin.has(f)) continue;
        let missing = '';
        if (hasOrigin && await has([ORIGIN, '--', f])) {
            if ((await g(['cat-file', '-e', `${ORIGIN}:${f}`])).code !== 0) missing = 'origin/main';
        } else if (await has(['--all', '--', f])) {
            if ((await g(['cat-file', '-e', `HEAD:${f}`])).code !== 0) missing = 'local HEAD';
        }
        if (!missing) continue;
        const others = (await editorsFor(f)).filter((x) => x && nowMs - (x.lastAt || 0) < OTHERS_MS);
        if (others.length) gone.push({ f, missing, who: others[0].agentId });
    }
    if (gone.length) problems.push({ kind: 'removed-others', text: `${gone.slice(0, 4).map((x) => `${x.f} is deleted on ${x.missing} but ${x.who} edited it recently`).join('; ')}`, files: gone.map((x) => x.f) });

    return { ok: problems.length === 0, problems, commits, held, notes, root };
}

// ---------------------------------------------------------------- the Supervisor's gate

const state = new Map(); // work id -> { sig, steers }
const problemSig = (ps) => ps.map((p) => `${p.kind}:${(p.commits || []).concat(p.files || []).sort().join(',')}`).sort().join('|');
const problemList = (ps) => ps.map((p, i) => `(${i + 1}) ${p.text}`).join(' ');

const heldLine = (h) => `not this item's: ${h.file}, held by ${h.holder} (${h.why})`;
/** The held files as lines under an issue comment. */
const heldNotes = (held) => held.slice(0, 20).map((h) => `\n- ${heldLine(h)}`).join('') + (held.length > 20 ? `\n- and ${held.length - 20} more such files` : '');
/** What an agent told to land is told about files that are somebody else's. */
const leaveAlone = (held) => (held.length ? ` Leave these files alone, they are not this item's (do not commit, restore or delete them): ${held.slice(0, 20).map((h) => `${h.file} (held by ${h.holder})`).join(', ')}${held.length > 20 ? ` and ${held.length - 20} more held by others` : ''}.` : '');

/** A landing item's "Commits:" line: each commit and where it is. */
function commitList(commits) {
    const order = commits.filter((c) => !c.landed).concat(commits.filter((c) => c.landed)); // the cap never hides what to land
    const all = [...new Set(order.map((c) => `${short(c.sha)} (${!c.landed ? 'not on origin/main' : c.landed === 'content' ? 'its content is on origin/main' : `on origin/main as ${short(c.landedAs || c.sha)}`})`))];
    return all.length > MAX_COMMITS ? `${all.slice(0, MAX_COMMITS).join(', ')}, and ${all.length - MAX_COMMITS} more` : all.join(', ');
}

function steerText(ps, held = []) {
    return `[Supervisor] Before this item is done: ${problemList(ps)} Commit what is uncommitted, land every commit on origin/main (cherry-pick onto refs/remotes/origin/main in your own worktree or with a temporary index; never pull/rebase/merge in the live tree), resolve conflicts keeping both sides' work, and if you removed lines another session wrote, restore them unless removing them was the point of your task (then say so).${leaveAlone(held)} Then say what you did.`;
}

/**
 * hooks: { setWork(id, fields), emit(id), comment(w, text), enqueue(item), steer(sid, text), isLive(sid), checkLanding? (tests) }
 * work: the raw supervisor_work row. Returns { done, note }.
 */
async function gate(hooks, w, summary) {
    let refs = [];
    try { refs = JSON.parse(w.issue_refs || '[]') || []; } catch (_) { refs = []; }
    const item = { id: w.id, sessionId: w.session_id, startedAt: w.started_at || 0, cwd: w.cwd || '', title: w.title || '', sourceRef: w.source_ref || '', issue_number: w.issue_number || null, issues: Array.isArray(refs) ? refs : [] };
    if (!item.sessionId) return { done: true, note: '' };
    let res;
    try {
        res = await Promise.race([
            (hooks.checkLanding || checkLanding)(item, {}),
            new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('landing check timed out')), 150000); if (t.unref) t.unref(); })
        ]);
    } catch (e) {
        hooks.comment(w, `**Fleet / Supervisor:** landing check could not run (${e.message}); the item is done without it.`);
        return { done: true, note: '' };
    }
    const held = res.held || [];
    if (res.ok) {
        state.delete(w.id);
        const n = res.commits.length;
        const note = n ? ` - landed: ${n} commit${n === 1 ? '' : 's'} on origin/main` : '';
        hooks.comment(w, `**Fleet / Supervisor:** landing check passed${n ? `: ${n} commit${n === 1 ? '' : 's'} on origin/main (${res.commits.slice(0, 5).map((c) => `${short(c.sha)} ${c.landed || ''}`.trim()).join(', ')})` : ': no commits of its own to land'}.${heldNotes(held)}`);
        return { done: true, note };
    }
    const ps = res.problems;
    const sig = problemSig(ps);
    const st = state.get(w.id) || { sig: '', steers: 0 };
    // removed lines of other commits are a question, not a block: once the agent was asked (or its session is gone) the
    // item is done with the finding on its issue - a rework of a feature removes old lines by design
    const hard = ps.filter((p) => p.kind !== 'removed-others');
    if (!hard.length && (st.steers >= 1 || !hooks.isLive(item.sessionId))) {
        state.delete(w.id);
        hooks.comment(w, `**Fleet / Supervisor:** landed; it removed lines other commits wrote${st.steers ? ' and was asked to restore them unless removing them was its task (its answer is in the session)' : ''}:\n${ps.map((p) => `- ${p.text}`).join('\n')}${heldNotes(held)}`);
        return { done: true, note: ' - landed (removed lines of other commits: see the issue)' };
    }
    const followUp = String(w.source_ref || '').startsWith('supervisor:landing:');
    hooks.setWork(w.id, { state: 'running', message: `Landing: ${ps[0].text}`.slice(0, 240) });
    hooks.emit(w.id);
    const live = !!hooks.isLive(item.sessionId);
    if (live && st.steers < 2 && sig !== st.sig) {
        let sent = true;
        try { await hooks.steer(item.sessionId, steerText(ps, held)); } catch (_) { sent = false; }
        if (sent) {
            state.set(w.id, { sig, steers: st.steers + 1 });
            hooks.comment(w, `**Fleet / Supervisor:** landing check found ${ps.length} problem${ps.length === 1 ? '' : 's'} (${ps.map((p) => p.kind).join(', ')}); told the agent to fix them:\n${ps.map((p) => `- ${p.text}`).join('\n')}${heldNotes(held)}`);
            return { done: false };
        }
    }
    // nothing to land: a question that could not be put to the session never becomes a landing session (#1391)
    if (!hard.length) {
        state.delete(w.id);
        hooks.comment(w, `**Fleet / Supervisor:** landed; it removed lines other commits wrote and the session could not be asked:\n${ps.map((p) => `- ${p.text}`).join('\n')}${heldNotes(held)}`);
        return { done: true, note: ' - landed (removed lines of other commits: see the issue)' };
    }
    // the session is gone, did not answer, or fixed nothing: a new started item lands it (a landing item itself is not handed on again)
    if (followUp) {
        state.delete(w.id);
        hooks.comment(w, `**Fleet / Supervisor:** landing is still incomplete after this landing item: ${problemList(ps)}${heldNotes(held)}`);
        return { done: true, note: ` - landing incomplete: ${ps[0].text}`.slice(0, 200) };
    }
    const shas = commitList(res.commits);
    const heldFiles = new Set(held.map((h) => h.file));
    const files = [...new Set(ps.flatMap((p) => p.files || []))].filter((f) => !heldFiles.has(f)).slice(0, 30).join(', ');
    let kid = null;
    try {
        kid = hooks.enqueue({
            title: `Land work item ${w.id}'s commits on origin/main`,
            prompt: `Land work item ${w.id}'s commits on origin/main without losing anyone's work: ${problemList(ps)}\nCommits: ${shas || '(none found)'}\nFiles: ${files || '(none)'}\nWork item ${w.id} was: ${String(w.title || '').slice(0, 200)}. Put its commits onto refs/remotes/origin/main (cherry-pick in your own worktree or with a temporary index and commit-tree, then push); never pull, rebase, merge, reset, checkout or stash in the live tree. Resolve conflicts keeping both sides' work; restore lines another session wrote that the commits removed unless removing them was the point of that task. Commit anything uncommitted that belongs to item ${w.id}.${leaveAlone(held)} Do not ask Yukimi: decide, do it, and report what landed.`,
            startNow: true, source: 'agent', sourceRef: `supervisor:landing:${w.id}`, cwd: w.cwd || undefined
        });
    } catch (e) { hooks.comment(w, `**Fleet / Supervisor:** could not start a landing item (${e.message}); problems: ${problemList(ps)}${heldNotes(held)}`); }
    state.delete(w.id);
    if (!kid) return { done: true, note: ` - landing incomplete: ${ps[0].text}`.slice(0, 200) };
    hooks.comment(w, `**Fleet / Supervisor:** landing handed to item ${kid.id}: ${problemList(ps)}${heldNotes(held)}`);
    return { done: true, note: ` - landing handed to item ${kid.id}` };
}

module.exports = { checkLanding, gate, removedLines, hasConflictMarkers, readTranscript, steerText, _state: state, _fetchedAt: fetchedAt, ORIGIN };

// Reload without a restart (#1292): the fetch cache and the per-item steer state move to the new version's own Maps.
require('./hotReload').mark(module, {
    dispose() { return { state: new Map(state), fetchedAt: new Map(fetchedAt) }; },
    accept(st) {
        if (!st) return;
        state.clear(); fetchedAt.clear();
        if (st.state) st.state.forEach((v, k) => state.set(k, v));
        if (st.fetchedAt) st.fetchedAt.forEach((v, k) => fetchedAt.set(k, v));
    }
});
