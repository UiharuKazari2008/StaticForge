'use strict';

/**
 * Fleet work dependencies (Yukimi: "a better way to see the job order and the priority as jobs wait for other jobs ...
 * jobs that have dependencies should be detected and automatically launched first in order").
 *
 * Edges live in the agent-coord DB (supervisor_work_deps: work_id waits for depends_on) next to a per-item priority
 * (supervisor_work_meta). detect() finds edges from the briefs (cheap, deterministic, no model); detectWithModel() is an
 * optional one-shot pass the caller runs when items arrive in bulk. Nothing here owns a timer: the supervisor calls it
 * on enqueue / pump / list, and every call is a few indexed queries over a small table.
 *
 * Edge kinds: 'explicit' (the brief says "after item N", or Yukimi added it), 'issue' (the brief names another open item's
 * issue as a blocker), 'files' (two open items name the same repo files: the later waits), 'model'. A "follow-up of N"
 * link (explicit, reason starting "follow-up of") is display only and never blocks.
 */

const store = require('./agentCoord/store');

const OPEN = ['held', 'queued', 'starting', 'running', 'waiting', 'input'];
const GONE = ['done', 'cancelled'];
const COMMON = new Set(['claude.md', 'package.json', 'web_server.js', 'readme.md', 'package-lock.json', 'agentsupervisor.js']);
const SHARED_LIMIT = 5; // a path named by more items than this is background, not a conflict
const FOLLOW = /^follow-up of /;
const DAY = 24 * 3600 * 1000;

let ready = null;
function db() {
    const d = store.open();
    if (ready !== d) {
        d.exec(`
            CREATE TABLE IF NOT EXISTS supervisor_work_deps (
                work_id INTEGER NOT NULL, depends_on INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'explicit',
                reason TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, UNIQUE (work_id, depends_on)
            );
            CREATE INDEX IF NOT EXISTS supervisor_work_deps_on ON supervisor_work_deps (depends_on);
            CREATE TABLE IF NOT EXISTS supervisor_work_meta (work_id INTEGER PRIMARY KEY, priority INTEGER NOT NULL DEFAULT 0);
            -- a dependency Yukimi removed is not detected again (detection runs on every enqueue)
            CREATE TABLE IF NOT EXISTS supervisor_work_deps_removed (work_id INTEGER NOT NULL, depends_on INTEGER NOT NULL, at INTEGER NOT NULL, UNIQUE (work_id, depends_on));
        `);
        ready = d;
    }
    return d;
}

const isBlocking = (e) => !(e.kind === 'explicit' && FOLLOW.test(e.reason || ''));
const isOpen = (s) => !GONE.includes(s);
// A shared file or issue only means "not at the same time": it holds an item back while the other one is on its way (queued,
// starting, running, Sent Back, Input Required), never while the other sits in Waiting unstarted (Yukimi, Nov 26 2026: queued
// items sat for hours behind held items that nobody started). Explicit dependencies hold always (the prerequisite is started first).
// Once the other one runs, a shared FILE holds back only while that item (or one of its parts) holds a claim on one of the shared
// files - the claim is what says it is editing them (Yukimi, Nov 26 2026: "why are we waiting on so many jobs" - items sat behind a
// running item that was itself only waiting for an emulator and touched none of the files).
const ACTIVE_STATES = ['starting', 'running', 'waiting', 'input'];
function holdsBack(e, s) {
    if (!isOpen(s)) return false;
    if ((e.kind === 'files' || e.kind === 'issue') && s === 'held') return false;
    if (e.kind === 'files' && ACTIVE_STATES.includes(s)) return claimsShared(e.depends_on, sharedFiles(e.reason));
    return true;
}
/** "both name a.js, b/c.js" -> ['a.js', 'b/c.js']. */
function sharedFiles(reason) {
    const m = /both name (.+)$/.exec(String(reason || ''));
    return m ? m[1].replace(/\s+and \d+ more$/, '').split(/,\s*/).map((x) => x.trim()).filter(Boolean) : [];
}
/** Does work item id (or one of its parts) hold a live coord claim over any of these repo files? Unknown -> true (hold). */
function claimsShared(id, files) {
    if (!files.length) return true;
    try {
        const coord = require('./agentCoord/store');
        const sids = db().prepare('SELECT session_id FROM supervisor_work WHERE (id = ? OR parent_id = ?) AND session_id IS NOT NULL').all(Number(id), Number(id)).map((r) => String(r.session_id));
        if (!sids.length) return false;
        const agents = new Set(sids.map((sid) => `claude-${sid.slice(0, 8)}`));
        try { coord.listAgents().forEach((a) => { if (a.sessionId && sids.includes(a.sessionId)) agents.add(a.id); }); } catch (_) { /* the ids above */ }
        const claims = coord.liveClaims({}).filter((c) => agents.has(c.agentId));
        return claims.some((c) => files.some((f) => coord.overlaps(c.path, f)));
    } catch (_) { return true; }
}

function states() {
    const m = new Map();
    try { db().prepare('SELECT id, state FROM supervisor_work').all().forEach((r) => m.set(r.id, r.state)); } catch (_) { /* no work table */ }
    return m;
}
const allEdges = () => db().prepare('SELECT work_id, depends_on, kind, reason FROM supervisor_work_deps ORDER BY depends_on, work_id').all();

function depsOf(id) {
    return db().prepare('SELECT depends_on AS "on", kind, reason, at FROM supervisor_work_deps WHERE work_id = ? ORDER BY depends_on').all(Number(id));
}

/** True when `from` already reaches `target` through blocking edges (adding target -> ... would close a cycle). */
function reaches(from, target, edges) {
    const by = new Map();
    edges.filter(isBlocking).forEach((e) => { if (!by.has(e.work_id)) by.set(e.work_id, []); by.get(e.work_id).push(e.depends_on); });
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
        const n = stack.pop();
        if (n === target) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        (by.get(n) || []).forEach((x) => stack.push(x));
    }
    return false;
}

/** Adds one edge unless it is a self edge, exists, or closes a cycle (the older edge stays). Returns true when added. */
function addDep(id, on, reason, kind = 'explicit') {
    id = Number(id); on = Number(on);
    if (!id || !on || id === on) return false;
    const d = db();
    if (d.prepare('SELECT 1 FROM supervisor_work_deps WHERE work_id = ? AND depends_on = ?').get(id, on)) return false;
    // a removed dependency stays removed for detection; setting it by hand (explicit, not a follow-up link) brings it back
    if (kind !== 'explicit' && d.prepare('SELECT 1 FROM supervisor_work_deps_removed WHERE work_id = ? AND depends_on = ?').get(id, on)) return false;
    if (kind === 'explicit') d.prepare('DELETE FROM supervisor_work_deps_removed WHERE work_id = ? AND depends_on = ?').run(id, on);
    const link = kind === 'explicit' && FOLLOW.test(reason || '');
    if (!link && reaches(on, id, allEdges())) return false;
    d.prepare('INSERT OR IGNORE INTO supervisor_work_deps (work_id, depends_on, kind, reason, at) VALUES (?, ?, ?, ?, ?)').run(id, on, kind, String(reason || '').slice(0, 300), Date.now());
    return true;
}
function removeDep(id, on) {
    const d = db();
    d.prepare('INSERT OR IGNORE INTO supervisor_work_deps_removed (work_id, depends_on, at) VALUES (?, ?, ?)').run(Number(id), Number(on), Date.now());
    return d.prepare('DELETE FROM supervisor_work_deps WHERE work_id = ? AND depends_on = ?').run(Number(id), Number(on)).changes > 0;
}

function setPriority(id, p) {
    const v = Math.max(-2, Math.min(2, Math.round(Number(p) || 0)));
    db().prepare('INSERT INTO supervisor_work_meta (work_id, priority) VALUES (?, ?) ON CONFLICT(work_id) DO UPDATE SET priority = excluded.priority').run(Number(id), v);
    return v;
}
function priorities() {
    const m = new Map();
    db().prepare('SELECT work_id, priority FROM supervisor_work_meta').all().forEach((r) => m.set(r.work_id, r.priority));
    return m;
}

// ---- detection ----------------------------------------------------------------------------------------------------

const textOf = (it) => `${it.title || ''}\n${it.prompt || ''}`;
const EXPLICIT = /\b(?:after|depends? on|dependent on|once|following|blocked by|waits? (?:for|on)|needs?)\s+(?:work\s+)?item\s+#?(\d+)\b/gi;
const ISSUE_REF = /\b(?:blocked by|after|depends? on|needs|follow-?up to|waits? (?:for|on))\s+((?:[\w.-]+\/[\w.-]+)?#\d+)/gi;

function issuesOf(it) {
    const list = [];
    (Array.isArray(it.issues) ? it.issues : []).forEach((i) => { if (i && i.number) list.push({ repo: i.repo || '', number: Number(i.number) }); });
    if (!list.length && it.issue && it.issue.number) list.push({ repo: it.issue.repo || '', number: Number(it.issue.number) });
    return list;
}
const tail = (repo) => String(repo || '').split('/').pop().toLowerCase();

function pathsOf(text) {
    const out = new Set();
    const add = (p) => {
        p = String(p).replace(/^\.?\//, '').replace(/[.,;:)\]'"]+$/, '');
        if (!/\.\w+$/.test(p) || /^https?:/.test(p)) return;
        if (COMMON.has(p.split('/').pop().toLowerCase())) return;
        out.add(p);
    };
    for (const m of text.matchAll(/`([^`\s]+\/[^`\s]+)`/g)) add(m[1]);
    for (const m of text.matchAll(/(?:^|[\s("'\[])((?:modules|public|apps|scripts|docs|services)\/[\w./@-]+)/g)) add(m[1]);
    return out;
}

/** Finds edges among the open items (rows as listWork returns them) and stores them. Returns the edges added. */
function detect(items) {
    const open = (items || []).filter((it) => it && OPEN.includes(it.state));
    const byId = new Map(open.map((it) => [it.id, it]));
    const added = [];
    const put = (id, on, kind, reason) => { if (addDep(id, on, reason, kind)) added.push({ from: on, to: id, kind, reason }); };
    const sorted = open.slice().sort((a, b) => a.id - b.id);

    for (const it of sorted) {
        const text = textOf(it);
        // 1. explicit: "after item N"
        for (const m of text.matchAll(EXPLICIT)) {
            const n = Number(m[1]);
            if (n !== it.id && byId.has(n) && byId.get(n).parentId !== it.id && it.parentId !== n) put(it.id, n, 'explicit', `brief says item ${n} comes first`);
        }
        // 2. issue: "blocked by #N" where #N is another open item's issue
        const ownRepo = (issuesOf(it)[0] || {}).repo || '';
        for (const m of text.matchAll(ISSUE_REF)) {
            const ref = m[1];
            const num = Number(ref.split('#')[1]);
            const repo = ref.includes('/') ? ref.split('#')[0].toLowerCase() : '';
            for (const o of sorted) {
                if (o.id === it.id) continue;
                const hit = issuesOf(o).some((i) => i.number === num && (repo ? (String(i.repo).toLowerCase() === repo || tail(i.repo) === tail(repo)) : (!ownRepo || !i.repo || i.repo === ownRepo)));
                if (hit && o.parentId !== it.id && it.parentId !== o.id) put(it.id, o.id, 'issue', `brief says it waits for #${num}`);
            }
        }
        // follow-up / landing / gaps hand-offs: shown linked to their origin, never blocked
        const fm = /^supervisor:(?:landing|gaps|followup):(\d+)/.exec(String(it.sourceRef || ''));
        if (fm && Number(fm[1]) !== it.id) addDep(it.id, Number(fm[1]), `follow-up of ${fm[1]}`, 'explicit');
    }

    // 3. files: the later item waits for the earlier one that names the same repo files
    const paths = new Map(sorted.map((it) => [it.id, pathsOf(textOf(it))]));
    const count = new Map();
    paths.forEach((set) => set.forEach((p) => count.set(p, (count.get(p) || 0) + 1)));
    for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
            const a = sorted[i]; const b = sorted[j];
            if (!['held', 'queued'].includes(b.state)) continue;
            if (a.parentId === b.id || b.parentId === a.id || (a.parentId && a.parentId === b.parentId)) continue;
            const shared = [...paths.get(a.id)].filter((p) => paths.get(b.id).has(p) && count.get(p) <= SHARED_LIMIT);
            if (shared.length) put(b.id, a.id, 'files', `both name ${shared.slice(0, 3).join(', ')}`);
        }
    }
    return added;
}

/**
 * Optional model pass for the items that still wait on nothing. askJson(system, user, kind, opts) is the Supervisor's.
 * Not wired to a timer: the caller runs it when items arrive in bulk. Returns the edges added.
 */
async function detectWithModel(askJson, items) {
    const open = (items || []).filter((it) => it && ['held', 'queued'].includes(it.state));
    if (open.length < 2 || typeof askJson !== 'function') return [];
    const list = open.map((it) => `#${it.id} ${String(it.title || '').slice(0, 100)}\n${String(it.prompt || '').slice(0, 500)}`).join('\n---\n');
    let o;
    try {
        o = await askJson('You order coding work items for a team of agents. Say which items must wait for which because one needs the result, files or decision of the other. Only real dependencies, not mere similarity. Answer ONLY {"deps":[{"item":<id>,"after":<id>,"reason":"short"}]}.', list.slice(0, 14000), 'deps', { maxTokens: 800 });
    } catch (_) { return []; }
    const ids = new Set(open.map((it) => it.id));
    const added = [];
    ((o && Array.isArray(o.deps)) ? o.deps : []).forEach((x) => {
        const item = Number(x && x.item); const after = Number(x && x.after);
        if (ids.has(item) && ids.has(after) && addDep(item, after, String((x && x.reason) || 'model').slice(0, 200), 'model')) added.push({ from: after, to: item, kind: 'model', reason: x.reason || 'model' });
    });
    return added;
}

// ---- scheduling ---------------------------------------------------------------------------------------------------

/** Open prerequisite ids of an item (not done / cancelled; a failed one still blocks). */
function blockedBy(id, st) {
    st = st || states();
    return db().prepare('SELECT depends_on, kind, reason FROM supervisor_work_deps WHERE work_id = ?').all(Number(id))
        .filter((e) => isBlocking(e) && st.has(e.depends_on) && holdsBack(e, st.get(e.depends_on))).map((e) => e.depends_on);
}

/**
 * The queued rows in start order: dependency order first, then priority (high first), start_now, id.
 * A row with an open prerequisite comes out with blocked: [ids] and blockedReason ("Waiting for item N (reason)");
 * a row with none has no blocked key. Rows may be raw DB rows or listWork rows.
 */
function orderQueued(rows) {
    const st = states();
    const pri = priorities();
    const edges = allEdges().filter(isBlocking);
    const list = (rows || []).slice();
    const queued = new Set(list.map((r) => r.id));
    const prereq = new Map();
    edges.forEach((e) => { if (!prereq.has(e.work_id)) prereq.set(e.work_id, []); prereq.get(e.work_id).push(e); });
    const cmp = (a, b) => ((pri.get(b.id) || 0) - (pri.get(a.id) || 0)) || ((b.start_now ?? (b.startNow ? 1 : 0)) - (a.start_now ?? (a.startNow ? 1 : 0))) || (a.id - b.id);
    const placed = new Set();
    const out = [];
    let left = list.slice();
    while (left.length) {
        let avail = left.filter((r) => (prereq.get(r.id) || []).every((e) => !queued.has(e.depends_on) || placed.has(e.depends_on)));
        if (!avail.length) avail = left; // a cycle that slipped in: plain order
        avail.sort(cmp);
        const pick = avail[0];
        placed.add(pick.id); out.push(pick);
        left = left.filter((r) => r !== pick);
    }
    return out.map((r) => {
        const open = (prereq.get(r.id) || []).filter((e) => st.has(e.depends_on) && holdsBack(e, st.get(e.depends_on)));
        if (!open.length) return r;
        const first = open[0];
        const why = first.reason ? ` (${first.reason})` : '';
        return Object.assign({}, r, { blocked: open.map((e) => e.depends_on), blockedReason: `Waiting for item ${first.depends_on}${why}${open.length > 1 ? ` and ${open.length - 1} more` : ''}` });
    });
}

/** All open prerequisites of an item, transitively, in the order they must start (deepest first, then by id). */
function prerequisites(id) {
    const st = states();
    const edges = allEdges().filter(isBlocking);
    const by = new Map();
    edges.forEach((e) => { if (!by.has(e.work_id)) by.set(e.work_id, []); by.get(e.work_id).push(e); });
    const out = []; const seen = new Set([Number(id)]);
    const visit = (n) => {
        (by.get(n) || []).slice().sort((a, b) => a.depends_on - b.depends_on).forEach((e) => {
            const p = e.depends_on;
            if (seen.has(p) || !st.has(p) || !holdsBack(e, st.get(p))) return;
            seen.add(p); visit(p); out.push(p);
        });
    };
    visit(Number(id));
    return out;
}

// ---- graph for the Fleet page -------------------------------------------------------------------------------------

function graph(listWork) {
    const rows = typeof listWork === 'function' ? listWork({ limit: 300 }) : (listWork || []);
    const now = Date.now();
    const st = new Map(rows.map((r) => [r.id, r.state]));
    const edgesAll = allEdges();
    const pri = priorities();
    const blockingFor = (r) => edgesAll.filter((e) => e.work_id === r.id && isBlocking(e));
    const openRows = rows.filter((r) => OPEN.includes(r.state));
    const keep = new Set(openRows.map((r) => r.id));
    // a finished or failed prerequisite shows while an open item still hangs on it
    openRows.forEach((r) => blockingFor(r).forEach((e) => {
        const s = st.get(e.depends_on);
        const o = rows.find((x) => x.id === e.depends_on);
        if (o && (s === 'failed' || (s === 'done' && now - (o.endedAt || 0) < DAY))) keep.add(o.id);
    }));
    const nodesRows = rows.filter((r) => keep.has(r.id));
    const edges = edgesAll.filter((e) => keep.has(e.work_id) && keep.has(e.depends_on))
        .map((e) => ({ from: e.depends_on, to: e.work_id, kind: e.kind, reason: e.reason }));

    const queueRows = orderQueued(rows.filter((r) => r.state === 'queued'));
    const queue = queueRows.map((r) => r.id);
    const lane = new Map();
    const depth = (id, trail = new Set()) => {
        if (lane.has(id)) return lane.get(id);
        if (trail.has(id)) return 0;
        trail.add(id);
        let d = 0;
        edgesAll.filter((e) => e.work_id === id && isBlocking(e) && keep.has(e.depends_on) && holdsBack(e, st.get(e.depends_on) || 'done')).forEach((e) => { d = Math.max(d, depth(e.depends_on, trail) + 1); });
        trail.delete(id);
        lane.set(id, d);
        return d;
    };
    const stAll = new Map(rows.map((r) => [r.id, r.state]));
    const nodes = nodesRows.map((r) => ({
        id: r.id, title: r.title, state: r.state, account: r.account || '', model: r.model || '', priority: pri.get(r.id) || 0,
        order: queue.indexOf(r.id) >= 0 ? queue.indexOf(r.id) + 1 : null, lane: isOpen(r.state) ? depth(r.id) : 0,
        startedAt: r.startedAt || null, endedAt: r.endedAt || null, issue: r.issue || null, parentId: r.parentId || null,
        blocked: edgesAll.filter((e) => e.work_id === r.id && isBlocking(e) && holdsBack(e, stAll.get(e.depends_on) || 'done')).map((e) => e.depends_on)
    }));
    return {
        nodes, edges, queue,
        running: nodesRows.filter((r) => ['starting', 'running', 'waiting', 'input'].includes(r.state)).map((r) => r.id),
        waiting: nodesRows.filter((r) => r.state === 'held').map((r) => r.id),
        done: nodesRows.filter((r) => !OPEN.includes(r.state)).map((r) => r.id)
    };
}

module.exports = { detect, detectWithModel, blockedBy, orderQueued, prerequisites, graph, setPriority, addDep, removeDep, depsOf, priorities };

// Reload without a restart (#1292, docs/server/hot-reload.md): the one runtime value is the DB handle its tables were
// made on; the next version takes it so it does not run the CREATE TABLEs again.
require('./hotReload').mark(module, {
    dispose() { return { ready }; },
    accept(st) { if (st && st.ready) ready = st.ready; }
});
