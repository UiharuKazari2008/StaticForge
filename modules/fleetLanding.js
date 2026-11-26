'use strict';

/**
 * Fleet landing check (Yukimi, Nov 25 2026: "the supervisor should also ensure that every single work item has committed their
 * work and it's merged to main with its conflicts resolved and does not delete another's work").
 *
 * checkLanding(item, opts) -> { ok, problems: [{ kind, text, files?, commits? }], commits: [{ sha, subject, how }], notes: [] }
 *   item: { id, sessionId, startedAt (ms), cwd, agentId? }
 *   kinds: 'uncommitted', 'not-landed', 'conflict', 'removed-others'
 *   opts.deps (all optional, injectable for tests): git(args, {cwd, timeout, input}) -> {code, stdout, stderr},
 *     edited(item, root) -> [{ path (repo relative), lastAt }], transcript(item) -> { commits: [{ sha, subject }], pushed: [sha] },
 *     editors(path, item) -> [{ agentId, lastAt }] (other sessions that edited the path), now()
 *
 * gate(hooks, work, summary) is the Supervisor's done decision: { done, note }. It holds the item in Running with the first
 * problem, steers the live session once per distinct problem set, and hands the landing to a new started work item when the
 * session is gone or did not fix it. Never Input Required; every outcome is one line on the item's issue.
 *
 * Power / event loop: no timer, runs only when the Supervisor already decides an item's state; every git call is async through
 * the spawn helper (modules/spawnHelper.js), with timeouts, and the work is capped (20 commits, 2000 removed lines, ~400 origin commits).
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

const fetchedAt = new Map(); // repo root -> { at, p }

function realGit(args, o = {}) {
    return require('./spawnHelper').run('git', args, { cwd: o.cwd, timeout: o.timeout || GIT_TIMEOUT, maxBuffer: 64 * 1024 * 1024, input: o.input });
}

const ok0 = (r) => r && r.code === 0;
const lines = (s) => String(s || '').split('\n').filter(Boolean);
const short = (s) => String(s || '').slice(0, 8);

// ---------------------------------------------------------------- transcript (the session's own git output)

const COMMIT_OUT = /\[([\w./-]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.*)/;
const PUSH_OUT = /[0-9a-f]{7,40}\.\.([0-9a-f]{7,40})\s+\S+\s+->\s+\S+/;

function toolResultText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
    return '';
}

/** Reads one transcript file (jsonl), keeping only what `git commit` and `git push` printed after sinceMs. */
async function readTranscript(file, sinceMs) {
    const out = { commits: [], pushed: [] };
    if (!file) return out;
    const pending = new Set(); // tool_use ids of Bash commands that commit or push
    const rl = require('readline').createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line.includes('git ') && !pending.size) continue;
        let o;
        try {
            if (line.includes('"tool_use"') && /git[^"]{0,80}(commit|push|cherry-pick)/.test(line)) o = JSON.parse(line);
            else if (pending.size && line.includes('"tool_result"')) o = JSON.parse(line);
            else continue;
        } catch (_) { continue; }
        const at = Date.parse(o.timestamp || '') || 0;
        if (at && at < sinceMs) continue;
        const parts = (o.message && Array.isArray(o.message.content)) ? o.message.content : [];
        parts.forEach((c) => {
            if (!c) return;
            if (c.type === 'tool_use' && c.name === 'Bash' && c.id && /git[^\n]{0,80}(commit|push|cherry-pick)/.test(String((c.input && c.input.command) || ''))) pending.add(c.id);
            else if (c.type === 'tool_result' && pending.has(c.tool_use_id)) {
                pending.delete(c.tool_use_id);
                lines(toolResultText(c.content)).forEach((l) => {
                    let m = COMMIT_OUT.exec(l);
                    if (m && !/^(Auto-merging|error)/.test(l)) out.commits.push({ sha: m[2], subject: m[3].trim() });
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
            if (r) { out.commits.push(...r.commits); out.pushed.push(...r.pushed); }
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

async function defaultEditors(p, item) {
    try {
        const store = require('./agentCoord/store');
        const me = item.agentId || `claude-${String(item.sessionId).slice(0, 8)}`;
        const r = store.editorsOf([p], { all: true })[0];
        return ((r && r.editedBy) || []).filter((e) => e.agentId !== me).map((e) => ({ agentId: e.agentId, lastAt: e.lastAt }));
    } catch (_) { return []; }
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
    if (!ok0(top)) return { ok: true, problems, commits: [], notes: ['not a git folder: nothing to land'], skipped: true };
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
    if (editedPaths.length) {
        const st = await g(['status', '--porcelain', '-z', '--untracked-files=all', '--', ...editedPaths.slice(0, 300)]);
        const dirty = new Set();
        if (ok0(st)) {
            String(st.stdout).split('\0').filter(Boolean).forEach((e) => { const p = e.slice(3); if (editedSet.has(p)) dirty.add(p); });
        }
        const stale = [];
        for (const p of dirty) {
            const lc = await g(['log', '-1', '--format=%ct', 'HEAD', '--', p]);
            const committedAt = ok0(lc) && lc.stdout.trim() ? Number(lc.stdout.trim()) * 1000 : 0;
            const at = (edited.find((e) => e.path === p) || {}).lastAt || 0;
            if (at > committedAt) stale.push(p);
        }
        if (stale.length) problems.push({ kind: 'uncommitted', text: `${stale.length} file${stale.length === 1 ? '' : 's'} it wrote differ${stale.length === 1 ? 's' : ''} from HEAD and are not committed: ${stale.slice(0, 6).join(', ')}${stale.length > 6 ? ', ...' : ''}`, files: stale });
    }

    // 2. its commits
    const commits = [];
    const seen = new Set();
    const addCommit = async (sha, how, subjectHint) => {
        if (seen.size >= MAX_COMMITS * 3) return;
        const r = await g(['log', '-1', '--format=%H%x09%s', `${sha}^{commit}`]);
        if (!ok0(r) || !r.stdout.trim()) return;
        const [full, ...rest] = r.stdout.trim().split('\t');
        if (seen.has(full)) return;
        seen.add(full);
        commits.push({ sha: full, subject: rest.join('\t') || subjectHint || '', how });
    };
    const tr = await (deps.transcript || defaultTranscript)(item).catch(() => ({ commits: [], pushed: [] }));
    for (const c of (tr.commits || [])) await addCommit(c.sha, 'printed by its git commit', c.subject);
    for (const sha of (tr.pushed || [])) await addCommit(sha, 'printed by its git push');
    const printedSubjects = new Set((tr.commits || []).map((c) => c.subject));
    if (started) {
        const lg = await g(['log', local, `--since=@${Math.floor(started / 1000)}`, '--no-merges', '-n', '200', '--format=%x01%H%x09%s', '--name-only']);
        if (ok0(lg)) {
            for (const blk of String(lg.stdout).split('\x01').filter(Boolean)) {
                const [head, ...files] = blk.split('\n');
                const [sha, ...sub] = head.split('\t');
                const subject = sub.join('\t');
                const fl = files.filter(Boolean);
                if (seen.has(sha) || !fl.length) continue;
                if (printedSubjects.has(subject) && fl.every((f) => editedSet.has(f))) await addCommit(sha, 'local main, same subject and only files it wrote');
            }
        }
    }

    // 3. on origin/main
    const mine = new Set(commits.map((c) => c.sha));
    const mySubjects = new Set(commits.map((c) => c.subject));
    // a commit that names one of this item's issues is its own work (its background agents' commits, its own landed copies)
    const myIssues = itemIssueNumbers(item);
    const namesMyIssue = (subject) => [...String(subject || '').matchAll(/#(\d{2,6})\b/g)].some((m) => myIssues.has(Number(m[1])));
    if (hasOrigin && commits.length) {
        const since = started ? `--since=@${Math.floor(started / 1000) - 3600}` : '--since=@0';
        const originIds = new Map(); // patch-id -> sha
        const lp = await g(['log', '-p', '--no-merges', '-n', String(MAX_ORIGIN), since, ORIGIN, '--format=commit %H'], { timeout: 60000 });
        if (ok0(lp) && lp.stdout.trim()) {
            const pid = await g(['patch-id', '--stable'], { input: lp.stdout, timeout: 60000 });
            lines(pid.stdout).forEach((l) => { const [p, c] = l.split(' '); if (p && c) originIds.set(p, c); });
        }
        const sl = await g(['log', '--no-merges', '-n', String(MAX_ORIGIN), since, ORIGIN, '--format=%s']);
        const originSubjects = new Set(lines(sl.stdout));
        for (const c of commits) {
            const anc = await g(['merge-base', '--is-ancestor', c.sha, ORIGIN]);
            if (anc.code === 0) { c.landed = 'ancestor'; continue; }
            const sh = await g(['show', '--no-color', '--format=', c.sha]);
            let landed = '';
            if (ok0(sh) && sh.stdout.trim()) {
                const p = await g(['patch-id', '--stable'], { input: sh.stdout });
                const id = lines(p.stdout)[0] ? lines(p.stdout)[0].split(' ')[0] : '';
                if (id && originIds.has(id)) landed = 'patch-id';
            }
            if (!landed && originSubjects.has(c.subject)) landed = 'subject';
            if (landed) c.landed = landed; else problems.push({ kind: 'not-landed', text: `commit ${short(c.sha)} "${c.subject.slice(0, 100)}" is not on origin/main`, commits: [c.sha] });
        }
    } else if (!hasOrigin) notes.push(`no ${ORIGIN}: landing not checked`);

    // files to look at for the rest: what it wrote and what its commits touched
    const files = new Set(editedPaths);
    for (const c of commits.slice(0, MAX_COMMITS)) {
        const r = await g(['show', '--no-color', '--format=', '--name-only', c.sha]);
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
    if (conflicted.length) problems.push({ kind: 'conflict', text: `unresolved merge conflict in ${conflicted.slice(0, 6).join(', ')}`, files: conflicted });

    // 5. did not delete another's work (not for an item whose job is landing other sessions' commits: applying them changes their lines by design)
    let budget = isLandingItem(item) ? 0 : MAX_REMOVED;
    const byOther = new Map(); // other sha -> { subject, n, files:Set, by: [my shas] }
    for (const c of commits.slice(0, MAX_COMMITS)) {
        if (budget <= 0) break;
        const sh = await g(['show', '--no-color', '-U0', '--no-ext-diff', '-M', '--format=', c.sha], { timeout: 30000 });
        if (!ok0(sh)) continue;
        const rem = removedLines(sh.stdout).slice(0, budget);
        budget -= rem.length;
        const perFile = new Map();
        rem.forEach((r) => { if (!r.file) return; if (!perFile.has(r.file)) perFile.set(r.file, []); perFile.get(r.file).push(r.line); });
        for (const [file, nums] of perFile) {
            const ranges = [...new Set(nums)].sort((a, b) => a - b).slice(0, 400).map((n) => `-L${n},${n}`);
            const bl = await g(['blame', '--porcelain', ...ranges, `${c.sha}^`, '--', file], { timeout: 30000 });
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
    // a file of its own that is gone from origin/main or local HEAD while another session edited it recently
    const gone = [];
    for (const f of [...files].slice(0, 200)) {
        const ever = await g(['log', '-1', '--format=%H', '--all', '--', f]);
        if (!ok0(ever) || !ever.stdout.trim()) continue;
        const missing = [];
        const inHead = await g(['cat-file', '-e', `HEAD:${f}`]);
        if (inHead.code !== 0) missing.push('local HEAD');
        if (hasOrigin) { const inOrigin = await g(['cat-file', '-e', `${ORIGIN}:${f}`]); if (inOrigin.code !== 0) missing.push('origin/main'); }
        if (!missing.length) continue;
        const others = (await (deps.editors || defaultEditors)(f, item).catch(() => [])).filter((x) => x && nowMs - (x.lastAt || 0) < OTHERS_MS);
        if (others.length) gone.push({ f, missing, who: others[0].agentId });
    }
    if (gone.length) problems.push({ kind: 'removed-others', text: `${gone.slice(0, 4).map((x) => `${x.f} is deleted on ${x.missing.join(' and ')} but ${x.who} edited it recently`).join('; ')}`, files: gone.map((x) => x.f) });

    return { ok: problems.length === 0, problems, commits, notes, root };
}

// ---------------------------------------------------------------- the Supervisor's gate

const state = new Map(); // work id -> { sig, steers }
const problemSig = (ps) => ps.map((p) => `${p.kind}:${(p.commits || []).concat(p.files || []).sort().join(',')}`).sort().join('|');
const problemList = (ps) => ps.map((p, i) => `(${i + 1}) ${p.text}`).join(' ');

function steerText(ps) {
    return `[Supervisor] Before this item is done: ${problemList(ps)} Commit what is uncommitted, land every commit on origin/main (cherry-pick onto refs/remotes/origin/main in your own worktree or with a temporary index; never pull/rebase/merge in the live tree), resolve conflicts keeping both sides' work, and if you removed lines another session wrote, restore them unless removing them was the point of your task (then say so). Then say what you did.`;
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
    if (res.ok) {
        state.delete(w.id);
        const n = res.commits.length;
        const note = n ? ` - landed: ${n} commit${n === 1 ? '' : 's'} on origin/main` : '';
        hooks.comment(w, `**Fleet / Supervisor:** landing check passed${n ? `: ${n} commit${n === 1 ? '' : 's'} on origin/main (${res.commits.slice(0, 5).map((c) => `${short(c.sha)} ${c.landed || ''}`.trim()).join(', ')})` : ': no commits of its own to land'}.`);
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
        hooks.comment(w, `**Fleet / Supervisor:** landed; it removed lines other commits wrote${st.steers ? ' and was asked to restore them unless removing them was its task (its answer is in the session)' : ''}:\n${ps.map((p) => `- ${p.text}`).join('\n')}`);
        return { done: true, note: ' - landed (removed lines of other commits: see the issue)' };
    }
    const followUp = String(w.source_ref || '').startsWith('supervisor:landing:');
    hooks.setWork(w.id, { state: 'running', message: `Landing: ${ps[0].text}`.slice(0, 240) });
    hooks.emit(w.id);
    const live = !!hooks.isLive(item.sessionId);
    if (live && st.steers < 2 && sig !== st.sig) {
        let sent = true;
        try { await hooks.steer(item.sessionId, steerText(ps)); } catch (_) { sent = false; }
        if (sent) {
            state.set(w.id, { sig, steers: st.steers + 1 });
            hooks.comment(w, `**Fleet / Supervisor:** landing check found ${ps.length} problem${ps.length === 1 ? '' : 's'} (${ps.map((p) => p.kind).join(', ')}); told the agent to fix them:\n${ps.map((p) => `- ${p.text}`).join('\n')}`);
            return { done: false };
        }
    }
    // the session is gone, did not answer, or fixed nothing: a new started item lands it (a landing item itself is not handed on again)
    if (followUp) {
        state.delete(w.id);
        hooks.comment(w, `**Fleet / Supervisor:** landing is still incomplete after this landing item: ${problemList(ps)}`);
        return { done: true, note: ` - landing incomplete: ${ps[0].text}`.slice(0, 200) };
    }
    const shas = [...new Set(res.commits.map((c) => short(c.sha)))].join(', ');
    const files = [...new Set(ps.flatMap((p) => p.files || []))].slice(0, 30).join(', ');
    let kid = null;
    try {
        kid = hooks.enqueue({
            title: `Land work item ${w.id}'s commits on origin/main`,
            prompt: `Land work item ${w.id}'s commits on origin/main without losing anyone's work: ${problemList(ps)}\nCommits: ${shas || '(none found)'}\nFiles: ${files || '(none)'}\nWork item ${w.id} was: ${String(w.title || '').slice(0, 200)}. Put its commits onto refs/remotes/origin/main (cherry-pick in your own worktree or with a temporary index and commit-tree, then push); never pull, rebase, merge, reset, checkout or stash in the live tree. Resolve conflicts keeping both sides' work; restore lines another session wrote that the commits removed unless removing them was the point of that task. Commit anything uncommitted that belongs to item ${w.id}. Do not ask Yukimi: decide, do it, and report what landed.`,
            startNow: true, source: 'agent', sourceRef: `supervisor:landing:${w.id}`, cwd: w.cwd || undefined
        });
    } catch (e) { hooks.comment(w, `**Fleet / Supervisor:** could not start a landing item (${e.message}); problems: ${problemList(ps)}`); }
    state.delete(w.id);
    if (!kid) return { done: true, note: ` - landing incomplete: ${ps[0].text}`.slice(0, 200) };
    hooks.comment(w, `**Fleet / Supervisor:** landing handed to item ${kid.id}: ${problemList(ps)}`);
    return { done: true, note: ` - landing handed to item ${kid.id}` };
}

module.exports = { checkLanding, gate, removedLines, hasConflictMarkers, readTranscript, steerText, _state: state, _fetchedAt: fetchedAt, ORIGIN };
