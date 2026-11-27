'use strict';

/**
 * Fleet "Stop" on a work item (Yukimi, Nov 26 2026: "Cancel on a work item is a nuclear stop: everything it was doing is stopped, no
 * question, I do not care about anything").
 *
 *   killWork(item, { by, then })   every session of the item (its own and its parts', recursively): the claude process and its whole tree
 *                                  (background agents, background Bash, workflows, child processes) get SIGTERM, whatever is left
 *                                  after 3 s gets SIGKILL, the tmux session goes; then everything it held is released (agent-coord
 *                                  claims and busy locks, device-queue leases, Supervisor holds and waits, its open build gates, its
 *                                  queued reviews) and the item and its parts are marked (then 'hold': Waiting with its brief, ready
 *                                  to start again; 'delete': cancelled for good). The row is written straight (no Yozora sync): a stop
 *                                  never closes the item's issue.
 *   damageCheck(result, { item })  right after, async: backs up the stopped sessions' uncommitted work as a patch, syntax-checks what they
 *                                  edited, looks for conflict markers and half-written files, starts a repair work item when something
 *                                  is broken, and reports on the item's Yozora issue and as an agent-coord note. It never reverts,
 *                                  checks out or discards anything: other sessions may have hunks in the same files.
 *
 * Never touched: the Dreamscape server (this process, its parents and everything under it), other sessions, Yozora, Xi.
 * Every outside call is in `deps` (tests inject them). Process listing and git run off the event loop.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const GRACE_MS = 3000;
const POLL_MS = 100;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPEN_STATES = ['held', 'queued', 'starting', 'running', 'waiting', 'input'];
const CLIENT_PATH_RE = /(^|\/)(public|client)\//;
const ESM_ONLY_RE = /Cannot use import statement|Unexpected token 'export'|Cannot use 'import\.meta'/;

const agentOf = (sessionId) => `claude-${String(sessionId).slice(0, 8)}`;
const carrySocket = () => process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET || 'dreamscape-claude-carry';
const cacheDir = () => process.env.FLEET_CANCELLED_DIR || path.join(os.homedir(), '.cache', 'fleet-cancelled');

// ---------------------------------------------------------------- real dependencies

/** pid -> ppid and ppid -> pids of every process, read off the loop. */
async function procTable() {
    const parent = new Map();
    const kids = new Map();
    let names = [];
    try { names = (await fs.promises.readdir('/proc')).filter((n) => /^\d+$/.test(n)); } catch (_) { return { parent, kids }; }
    await Promise.all(names.map(async (n) => {
        try {
            const st = await fs.promises.readFile(`/proc/${n}/stat`, 'utf8');
            const pp = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
            parent.set(Number(n), pp);
            if (!kids.has(pp)) kids.set(pp, []);
            kids.get(pp).push(Number(n));
        } catch (_) { /* gone */ }
    }));
    return { parent, kids };
}

function realDeps() {
    const spawnHelper = require('./spawnHelper');
    return {
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        sessions: () => require('./claudeSessions').liveSessions(),
        proc: procTable,
        alive: (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } },
        signal: (pid, sig) => { try { process.kill(pid, sig); return true; } catch (_) { return false; } },
        cwdOf: async (pid) => { try { return await fs.promises.readlink(`/proc/${pid}/cwd`); } catch (_) { return ''; } },
        cmdlineOf: async (pid) => { try { return (await fs.promises.readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/g, ' '); } catch (_) { return ''; } },
        tmux: (args) => spawnHelper.run('tmux', ['-L', carrySocket(), ...args], { timeout: 5000 }),
        git: (root, args) => spawnHelper.run('git', ['-C', root, ...args], { timeout: 20000 }),
        run: (cmd, args) => spawnHelper.run(cmd, args, { timeout: 30000 }),
        coord: () => require('./agentCoord/store'),
        deviceQueue: () => require('./agentCoord/deviceQueue'),
        shellWrites: (sessionId, since) => { try { return require('./agentCoord/activityIndex').sessionShellWrites(sessionId, since); } catch (_) { return new Map(); } },
        hasConflictMarkers: (t) => require('./fleetLanding').hasConflictMarkers(t),
        fsp: fs.promises,
        patchDir: cacheDir,
        sup: () => require('./agentSupervisor').killDeps()
    };
}

const depsOf = (o) => Object.assign(realDeps(), (o && o.deps) || {});

// ---------------------------------------------------------------- the kill

/** The item's sessions: its own and its parts', recursively, each with the item it belongs to. */
function sessionsOfItem(item, sup) {
    const out = [];
    const seen = new Set();
    const walk = (it, depth) => {
        if (!it || seen.has(it.id) || depth > 6) return;
        seen.add(it.id);
        if (it.sessionId) out.push({ sessionId: it.sessionId, itemId: it.id });
        (sup.parts(it.id) || []).forEach((p) => walk({ id: p.id, sessionId: p.sessionId || p.session_id || '', state: p.state, topology: p.topology }, depth + 1));
    };
    walk(item, 0);
    const itemIds = [...seen];
    return { sessions: out.filter((s, i) => out.findIndex((x) => x.sessionId === s.sessionId) === i), itemIds };
}

/** Folders the item made that processes may sit in: its session's own folder and its worktree. */
function ownFolders(item, sessionId, sup) {
    const dirs = new Set();
    try { (sup.ownDirs(sessionId) || []).forEach((d) => d && dirs.add(path.resolve(d))); } catch (_) { /* none */ }
    const m = /^(.*\/\.claude\/worktrees\/[^/]+)/.exec(String(item.cwd || ''));
    if (m) dirs.add(m[1]);
    return [...dirs].filter((d) => d.length > 5 && d !== path.resolve(os.homedir()) && d !== '/');
}

/** The files each session wrote (repo relative, with the last write): read before the kill, checked after it. */
async function editedFiles(sessions, item, d) {
    const store = d.coord();
    const out = new Map();
    for (const s of sessions) {
        const agent = agentOf(s.sessionId);
        let cwd = '';
        try { const a = store.getAgent(agent); cwd = (a && a.cwd) || ''; } catch (_) { /* none */ }
        cwd = s.cwd || cwd || item.cwd || '';
        let root = '';
        try { root = (store.repoOf(cwd) || {}).root || ''; } catch (_) { /* none */ }
        if (!root) continue;
        const since = item.startedAt || 0;
        const add = (p, at) => {
            let r = String(p || '');
            if (path.isAbsolute(r)) { if (!(r === root || r.startsWith(`${root}/`))) return; r = path.relative(root, r); }
            if (!r || r.startsWith('..')) return;
            const k = `${root}\0${r}`;
            const cur = out.get(k);
            if (!cur) out.set(k, { sessionId: s.sessionId, root, path: r, lastAt: at || 0 });
            else cur.lastAt = Math.max(cur.lastAt, at || 0);
        };
        try {
            const ins = store.inspect(agent, { limit: 300, git: false });
            ((ins.edited && ins.edited.files) || []).forEach((f) => { if ((f.lastAt || 0) >= since) add(f.path, f.lastAt); });
        } catch (_) { /* no coord record */ }
        try { const w = d.shellWrites(s.sessionId, since); if (w && w.forEach) w.forEach((v, p) => add(p, v.last)); } catch (_) { /* no index */ }
    }
    return [...out.values()];
}

/**
 * Stops the item. opts: { by, then: 'hold' | 'delete', deps }. Resolves
 * { itemId, then, by, killed: [{ sessionId, pids, tmux }], stuck: [pid], released: { claims, leases, holds, waits, gates: [id], reviews }, files: [{ sessionId, root, path, lastAt }], items: [id] }.
 */
async function killWork(item, opts = {}) {
    if (!item || !item.id) throw new Error('No work item to stop');
    const d = depsOf(opts);
    const sup = d.sup();
    const by = String(opts.by || 'Fleet').slice(0, 80);
    const then = opts.then === 'hold' ? 'hold' : 'delete';
    const { sessions, itemIds } = sessionsOfItem(item, sup);

    // 1. what to kill, collected BEFORE any signal (a killed parent hands its children to init)
    const table = await d.proc();
    const protect = new Set([0, 1, process.pid, process.ppid]);
    for (let p = process.pid, i = 0; p && i < 64; i += 1) { protect.add(p); p = table.parent.get(p); }
    const live = new Map();
    try { (d.sessions() || []).forEach((l) => live.set(l.id, l)); } catch (_) { /* none */ }
    sessions.forEach((s) => { const l = live.get(s.sessionId); if (l) s.cwd = l.cwd || ''; });
    const files = await editedFiles(sessions, item, d);

    const treeOf = (root) => {
        const out = [];
        const seen = new Set();
        const stack = [root];
        while (stack.length && out.length < 600) {
            const p = stack.pop();
            if (seen.has(p) || protect.has(p)) continue;
            seen.add(p);
            out.push(p);
            (table.kids.get(p) || []).forEach((c) => stack.push(c));
        }
        return out;
    };
    const claimed = new Set();
    const killed = [];
    for (const s of sessions) {
        const l = live.get(s.sessionId);
        let pids = [];
        if (l && Number.isInteger(l.pid)) pids = treeOf(l.pid);
        else {
            // no live record: a claude process that carries its session id on its command line
            for (const [pid] of table.parent) {
                if (protect.has(pid)) continue;
                const c = await d.cmdlineOf(pid);
                if (c.includes(s.sessionId) && /claude/.test(c)) treeOf(pid).forEach((x) => pids.push(x));
            }
        }
        // processes that left the tree (setsid, reparented) but sit in a folder this item made
        const folders = ownFolders(item, s.sessionId, sup);
        if (folders.length) {
            for (const [pid] of table.parent) {
                if (protect.has(pid) || pids.includes(pid)) continue;
                const cwd = await d.cwdOf(pid);
                if (cwd && folders.some((f) => cwd === f || cwd.startsWith(`${f}/`))) treeOf(pid).forEach((x) => pids.push(x));
            }
        }
        pids = [...new Set(pids)].filter((p) => !claimed.has(p));
        pids.forEach((p) => claimed.add(p));
        const names = new Set();
        if (l && l.tmuxSession) names.add(l.tmuxSession);
        if (SESSION_ID_RE.test(s.sessionId)) names.add(`rc-${s.sessionId.slice(0, 8)}`);
        killed.push({ sessionId: s.sessionId, itemId: s.itemId, pids, tmux: [...names] });
    }

    // 2. SIGTERM all, SIGKILL what is left after the grace period
    const all = [...claimed];
    all.forEach((p) => d.signal(p, 'SIGTERM'));
    const waitDead = async (ms) => {
        const until = d.now() + ms;
        let left = all.filter((p) => d.alive(p));
        while (left.length && d.now() < until) { await d.sleep(POLL_MS); left = left.filter((p) => d.alive(p)); }
        return left;
    };
    let left = await waitDead(GRACE_MS);
    left.forEach((p) => d.signal(p, 'SIGKILL'));
    if (left.length) left = await waitDead(1000);
    const stuck = left;

    // 3. its tmux sessions (own socket)
    for (const k of killed) {
        const gone = [];
        for (const name of k.tmux) {
            try { const r = await d.tmux(['kill-session', '-t', `=${name}`]); if (r && r.code === 0) gone.push(name); } catch (_) { /* no such session */ }
        }
        k.tmux = gone;
    }

    // 4. release what the sessions held
    const store = d.coord();
    const released = { claims: 0, leases: 0, holds: 0, waits: 0, gates: [], reviews: 0 };
    const reason = `cancelled: work item ${item.id} was stopped`;
    for (const k of killed) {
        const agent = agentOf(k.sessionId);
        try { released.claims += Number(store.releaseAll(agent)) || 0; } catch (_) { /* none */ }
        try { released.leases += Number(d.deviceQueue().releaseAgent(agent)) || 0; } catch (_) { /* none */ }
        try { store.setStatus(agent, 'gone'); } catch (_) { /* no agent row */ }
        try {
            const db = store.open();
            const gates = db.prepare("SELECT id, target, repo FROM builds WHERE requested_by = ? AND state IN ('open', 'running')").all(agent);
            gates.forEach((g) => {
                db.prepare("UPDATE builds SET state = 'cancelled', ended_at = ?, result = ? WHERE id = ?").run(d.now(), reason, g.id);
                released.gates.push(g.id);
                try { store.post('supervisor', null, `Build gate ${g.id} (${g.target} in ${g.repo}) was cancelled: work item ${item.id} was stopped by ${by}.`, { kind: 'done' }); } catch (_) { /* no inbox */ }
            });
        } catch (_) { /* no builds table yet */ }
        try { released.holds += Number(sup.endHolds(k.sessionId, `work item ${item.id} was stopped`)) || 0; } catch (_) { /* none */ }
        try { released.waits += Number(sup.endWaits(k.itemId, k.sessionId, `work item ${item.id} was stopped`)) || 0; } catch (_) { /* none */ }
        try { released.reviews += Number(sup.dropReviews(k.sessionId)) || 0; } catch (_) { /* none */ }
    }

    // 5. the item and its parts: written straight to the row (no Yozora sync: a stop never closes an issue)
    const t = d.now();
    const msgHold = `Stopped by ${by}: waiting to be started again`;
    const msgGone = `Stopped by ${by}`;
    const groups = item.topology === 'groups';
    const mark = (id, as) => {
        if (as === 'hold') sup.mark(id, { state: 'held', start_now: 0, session_id: null, link: '', started_at: null, ended_at: null, joined_into: null, message: msgHold });
        else sup.mark(id, { state: 'cancelled', ended_at: t, message: msgGone });
    };
    mark(item.id, then);
    const parts = [];
    const collect = (id, depth) => {
        if (depth > 6) return;
        (sup.parts(id) || []).forEach((p) => { if (!parts.includes(p.id)) { parts.push(p.id); if (OPEN_STATES.includes(p.state) || p.state === 'failed') mark(p.id, then === 'hold' && groups ? 'hold' : 'delete'); collect(p.id, depth + 1); } });
    };
    collect(item.id, 0);

    return { itemId: item.id, then, by, killed: killed.map(({ sessionId, pids, tmux }) => ({ sessionId, pids, tmux })), stuck, released, files, items: itemIds };
}

// ---------------------------------------------------------------- the damage check

function stamp(ms) {
    const x = new Date(ms);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}-${p(x.getHours())}${p(x.getMinutes())}${p(x.getSeconds())}`;
}

/** { path -> 'M' | '?' | 'D' } of the given files that differ from HEAD (porcelain -z). */
async function dirtyOf(d, root, paths) {
    const out = new Map();
    for (let i = 0; i < paths.length; i += 200) {
        const r = await d.git(root, ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...paths.slice(i, i + 200)]);
        if (!r || r.code !== 0) continue;
        const parts = String(r.stdout || '').split('\0').filter(Boolean);
        for (let j = 0; j < parts.length; j += 1) {
            const xy = parts[j].slice(0, 2);
            const p = parts[j].slice(3);
            if (/[RC]/.test(xy)) j += 1; // the rename's old name follows
            out.set(p, xy === '??' ? '?' : (xy.includes('D') ? 'D' : 'M'));
        }
    }
    return out;
}

/** What is wrong with one file, or '' when it checks out. */
async function problemOf(d, root, rel) {
    const abs = path.join(root, rel);
    let text;
    try { text = await d.fsp.readFile(abs, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? '' : `unreadable: ${e.message}`; }
    if (!text.length) return 'empty file (half-written?)';
    if (d.hasConflictMarkers(text)) return 'has merge conflict markers';
    if (/\.json$/.test(rel)) { try { JSON.parse(text); } catch (e) { return `invalid JSON: ${e.message.slice(0, 120)}`; } }
    else if (/\.(c|m)?js$/.test(rel)) {
        const r = await d.run('node', ['--check', abs]);
        if (r && r.code !== 0) {
            const why = String(r.stderr || r.stdout || '').trim();
            if (CLIENT_PATH_RE.test(rel) && ESM_ONLY_RE.test(why)) return '';
            return `syntax error: ${why.split('\n').filter((l) => /Error/.test(l)).slice(0, 1).join('').slice(0, 160) || 'node --check failed'}`;
        }
    }
    return '';
}

/**
 * The Supervisor's check after a stop. result: killWork's answer. Resolves { patch, checked, broken: [{ file, why }], repair, text }.
 * Never throws for a failed step: what could not be done is said in `text`.
 */
async function damageCheck(result, opts = {}) {
    const d = depsOf(opts);
    const sup = d.sup();
    const item = opts.item || { id: result.itemId };
    const by = result.by || 'Fleet';
    const byRoot = new Map();
    (result.files || []).forEach((f) => { if (!byRoot.has(f.root)) byRoot.set(f.root, new Set()); byRoot.get(f.root).add(f.path); });

    // 1. the files of its that still differ from HEAD, then the backup patch BEFORE anything else
    const dirty = []; // { root, path, kind }
    for (const [root, set] of byRoot) {
        try { (await dirtyOf(d, root, [...set])).forEach((kind, p) => { if (set.has(p)) dirty.push({ root, path: p, kind }); }); } catch (_) { /* git failed */ }
    }
    let patch = '';
    let patchNote = '';
    if (dirty.length) {
        let body = '';
        for (const root of byRoot.keys()) {
            const mine = dirty.filter((x) => x.root === root);
            const tracked = mine.filter((x) => x.kind !== '?').map((x) => x.path);
            try {
                if (tracked.length) { const r = await d.git(root, ['diff', 'HEAD', '--binary', '--', ...tracked]); if (r && r.stdout) body += `# ${root}\n${r.stdout}`; }
                for (const x of mine.filter((y) => y.kind === '?').slice(0, 60)) {
                    const r = await d.git(root, ['diff', '--no-index', '--binary', '--', '/dev/null', path.join(root, x.path)]); // exit 1 = differs
                    if (r && r.stdout) body += r.stdout;
                }
            } catch (e) { patchNote = `diff failed: ${e.message}`; }
        }
        if (body) {
            try {
                const dir = d.patchDir();
                await d.fsp.mkdir(dir, { recursive: true });
                patch = path.join(dir, `${item.id}-${stamp(d.now())}.patch`);
                await d.fsp.writeFile(patch, body);
            } catch (e) { patch = ''; patchNote = `patch not saved: ${e.message}`; }
        }
    }

    // 2. checks on every file of its that exists
    const broken = [];
    let checked = 0;
    for (const [root, set] of byRoot) {
        for (const p of set) {
            checked += 1;
            let why = '';
            try { why = await problemOf(d, root, p); } catch (e) { why = `check failed: ${e.message}`; }
            if (why) broken.push({ file: path.join(root, p), why });
        }
    }

    // 3. a repair item at once when something is broken: not a question for Yukimi
    let repair = null;
    if (broken.length) {
        const root = [...byRoot.keys()][0] || item.cwd || undefined;
        const prompt = `Work item ${item.id} was stopped mid-edit. These files are broken:\n${broken.map((b) => `- ${b.file}: ${b.why}`).join('\n')}\n\nThe stopped session's uncommitted diff is saved at ${patch || '(no patch could be saved)'}. Make the tree build again without losing anyone's work: finish or back out ONLY the half-done edit, keep every other change; test; commit.`;
        try {
            const w = sup.enqueue({ title: `Repair: work item ${item.id} was stopped mid-edit`, prompt, cwd: root, startNow: true, source: 'agent', sourceRef: `supervisor:repair:${item.id}` });
            repair = w && w.id;
        } catch (e) { patchNote = `${patchNote} repair item not started: ${e.message}`.trim(); }
    }

    // 4. the report: Yozora issue comment and an agent-coord note
    const rel = result.released || {};
    const killedText = (result.killed || []).length
        ? (result.killed || []).map((k) => `${k.sessionId.slice(0, 8)} (${k.pids.length} process${k.pids.length === 1 ? '' : 'es'}${k.tmux.length ? `, tmux ${k.tmux.join(', ')}` : ''})`).join('; ')
        : 'no running session found';
    const released = `${rel.claims || 0} claim${rel.claims === 1 ? '' : 's'}, ${rel.leases || 0} device lease${rel.leases === 1 ? '' : 's'}, ${rel.holds || 0} hold${rel.holds === 1 ? '' : 's'}, ${rel.waits || 0} wait${rel.waits === 1 ? '' : 's'}, ${(rel.gates || []).length} build gate${(rel.gates || []).length === 1 ? '' : 's'}, ${rel.reviews || 0} queued review${rel.reviews === 1 ? '' : 's'}`;
    const text = `**Fleet:** work item ${item.id} was stopped by ${by} (${result.then === 'hold' ? 'back to Waiting' : 'cancelled'}). The issue stays open.\n\n`
        + `- Killed: ${killedText}${(result.stuck || []).length ? `; still alive after SIGKILL: ${result.stuck.join(', ')}` : ''}\n`
        + `- Released: ${released}\n`
        + `- Uncommitted work saved: ${patch || (dirty.length ? `not saved ${patchNote}` : 'none (nothing of its differs from HEAD)')}\n`
        + `- Checked ${checked} edited file${checked === 1 ? '' : 's'}: ${broken.length ? `BROKEN ${broken.map((b) => `${path.basename(b.file)} (${b.why})`).join('; ')}` : 'all fine'}\n`
        + `${repair ? `- Repair work item ${repair} started.` : ''}`.trimEnd();
    try { sup.comment(item, text); } catch (_) { /* no issue */ }
    try { d.coord().post('supervisor', null, text.replace(/\*\*/g, ''), { kind: 'note' }); } catch (_) { /* no inbox */ }
    return { patch, checked, broken, repair, text };
}

module.exports = { killWork, damageCheck, agentOf, GRACE_MS, _test: { sessionsOfItem, dirtyOf, problemOf, procTable } };

// Stateless (every timer lives inside one call): reloadable as is (#1292).
require('./hotReload').mark(module);
