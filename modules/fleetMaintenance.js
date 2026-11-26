'use strict';

/**
 * Fleet maintenance (Yukimi, Nov 24 2026: "a manual and automatic maintenance task that runs daily to handle work
 * folder cleanup, cleanup worktrees, delete unneeded branches, merge or queue PRs, ingest errors from the server and
 * automatic problem reporting, check disk usage, thermals, etc. We want a real self-sufficient system.")
 *
 * One run = a list of checks; each answers { id, title, state: ok|warn|fail|skipped, summary, actions: [what it did],
 * findings: [{ text, level }] }. A run is safe to run twice. Runs once a day (ONE setTimeout to the next run time, config
 * agentSupervisor.maintenance.time, default 04:30 server-local; no polling) and on demand (Fleet > Supervisor >
 * Maintenance, claude_desk_supervisor maintenance_run). Every report is stored in coord.db (maintenance_runs, 30 days).
 *
 * Checks (settings agentSupervisor.maintenance.checks.<id> turns one off; dryRun reports without changing anything):
 *   workfolders  tracked work folders / temp files whose session is gone and older than 3 days are cleaned
 *   worktrees    prune dead ones; remove a clean one that is merged / fully pushed, with no live session or busy lock in it
 *   branches     local branches merged into origin/main are deleted (never unmerged work); merged remote ones are listed
 *   prs          open Yozora PRs that merge cleanly become held work items ("Merge PR #n"); never merged by itself
 *   errors       Dreamscape's PM2 error log since the last run, grouped; a repeating new group becomes a Yozora issue + work item
 *   disk         df of /, /home, /tmp and the biggest directories of /tmp and ~/.cache
 *   thermals     thermal zones, sensors, load, memory, swap, failed user units, PM2 restarts
 *   sessions     idle Fleet tmux sessions without a work item (reported), stale agent-coord agents (marked gone)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const REPO = path.join(__dirname, '..');
const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const KEEP_DAYS = 30;
const CHECK_IDS = ['workfolders', 'worktrees', 'branches', 'prs', 'errors', 'disk', 'thermals', 'sessions', 'waiting', 'usage', 'cleanup'];
const CHECK_TITLES = {
    workfolders: 'Work folders and temp files', worktrees: 'Git worktrees', branches: 'Branches', prs: 'Pull requests',
    errors: 'Server errors', disk: 'Disk usage', thermals: 'Thermals and health', sessions: 'Sessions and agents', waiting: 'Waiting work', usage: 'Usage review', cleanup: 'Fleet cleanup'
};
const DEFAULTS = {
    enabled: true, time: '04:30', dryRun: false, catchUp: false,
    checks: {},
    errorThreshold: 3, maxIssuesPerRun: 5, errorIgnore: ['DeprecationWarning', '--trace-deprecation', 'MaxListenersExceededWarning'],
    deleteRemoteBranches: false, remoteBranchDays: 14,
    worktreeMinAgeDays: 3, artifactMinAgeDays: 3, branchMinAgeHours: 24,
    protectPaths: ['~/opt'], protectBranches: ['main', 'master', 'develop', 'build/*'],
    diskWarn: 85, diskFail: 95, tempWarn: 85, thermalWarn: 85, idleSessionHours: 24
};

let gResources = null;
let timer = null;
let running = null; // { startedAt, current, done: [ids], total, trigger, dryRun }
const listeners = new Set();
function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() { listeners.forEach((fn) => { try { fn(); } catch (_) { /* a listener */ } }); }

const sup = () => require('./agentSupervisor');
const coord = () => require('./agentCoord/store');
const yzMod = () => require('./fleetYozora');

// ---------------------------------------------------------------- settings

function rawSettings(gr) {
    const g = gr || gResources;
    try { return ((g && g.getConfig && g.getConfig().agentSupervisor) || {}).maintenance || {}; } catch (_) { return {}; }
}

function clampInt(v, lo, hi, d) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }

/** Resolved settings: the config merged over the defaults (bad values fall back). */
function settings(gr, over) {
    const c = Object.assign({}, rawSettings(gr), over || {});
    const s = Object.assign({}, DEFAULTS);
    s.enabled = c.enabled !== false;
    s.time = /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(c.time || '')) ? String(c.time) : DEFAULTS.time;
    s.dryRun = c.dryRun === true;
    s.catchUp = c.catchUp === true;
    s.checks = {};
    CHECK_IDS.forEach((id) => { s.checks[id] = !(c.checks && c.checks[id] === false); });
    s.errorThreshold = clampInt(c.errorThreshold, 1, 1000, DEFAULTS.errorThreshold);
    s.maxIssuesPerRun = clampInt(c.maxIssuesPerRun, 0, 50, DEFAULTS.maxIssuesPerRun);
    s.errorIgnore = Array.isArray(c.errorIgnore) ? c.errorIgnore.map(String).slice(0, 40) : DEFAULTS.errorIgnore;
    s.deleteRemoteBranches = c.deleteRemoteBranches === true;
    s.remoteBranchDays = clampInt(c.remoteBranchDays, 0, 3650, DEFAULTS.remoteBranchDays);
    s.worktreeMinAgeDays = clampInt(c.worktreeMinAgeDays, 0, 3650, DEFAULTS.worktreeMinAgeDays);
    s.artifactMinAgeDays = clampInt(c.artifactMinAgeDays, 0, 3650, DEFAULTS.artifactMinAgeDays);
    s.branchMinAgeHours = clampInt(c.branchMinAgeHours, 0, 100000, DEFAULTS.branchMinAgeHours);
    s.protectPaths = Array.isArray(c.protectPaths) ? c.protectPaths.map(String).slice(0, 40) : DEFAULTS.protectPaths;
    s.protectBranches = Array.isArray(c.protectBranches) ? c.protectBranches.map(String).slice(0, 40) : DEFAULTS.protectBranches;
    s.diskWarn = clampInt(c.diskWarn, 1, 100, DEFAULTS.diskWarn);
    s.diskFail = clampInt(c.diskFail, 1, 100, DEFAULTS.diskFail);
    s.tempWarn = clampInt(c.tempWarn, 1, 100, DEFAULTS.tempWarn);
    s.thermalWarn = clampInt(c.thermalWarn, 20, 150, DEFAULTS.thermalWarn);
    s.idleSessionHours = clampInt(c.idleSessionHours, 1, 24 * 365, DEFAULTS.idleSessionHours);
    return s;
}

/** Saves the user-editable part (enabled, time, dryRun, checks, deleteRemoteBranches) and re-arms the timer. */
async function saveSettings(gr, next) {
    const g = gr || gResources;
    const cur = rawSettings(g);
    const n = next || {};
    const m = Object.assign({}, cur);
    if (n.enabled !== undefined) m.enabled = n.enabled === true;
    if (n.time !== undefined) { if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(n.time))) throw new Error('The time must be HH:MM'); m.time = String(n.time); }
    if (n.dryRun !== undefined) m.dryRun = n.dryRun === true;
    if (n.deleteRemoteBranches !== undefined) m.deleteRemoteBranches = n.deleteRemoteBranches === true;
    if (n.errorThreshold !== undefined) m.errorThreshold = clampInt(n.errorThreshold, 1, 1000, DEFAULTS.errorThreshold);
    if (n.checks && typeof n.checks === 'object') {
        m.checks = Object.assign({}, cur.checks || {});
        CHECK_IDS.forEach((id) => { if (n.checks[id] !== undefined) m.checks[id] = n.checks[id] !== false; });
    }
    await g.modifyConfig('config').assign(['agentSupervisor', 'maintenance'], m);
    arm();
    changed();
    return settings(g);
}

// ---------------------------------------------------------------- storage (coord.db)

let initFor = null;
function db() {
    const d = coord().open();
    const key = coord().dbPath ? coord().dbPath() : 'db';
    if (initFor !== key) {
        d.exec(`
            CREATE TABLE IF NOT EXISTS maintenance_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL, ended_at INTEGER, trigger TEXT, dry_run INTEGER DEFAULT 0, state TEXT, summary TEXT, report TEXT
            );
            CREATE TABLE IF NOT EXISTS maintenance_state (k TEXT PRIMARY KEY, v TEXT);
            CREATE TABLE IF NOT EXISTS maintenance_errors (
                fp TEXT PRIMARY KEY, title TEXT, first_seen INTEGER, last_seen INTEGER, total INTEGER DEFAULT 0, issue_repo TEXT, issue_number INTEGER, work_id INTEGER
            );`);
        initFor = key;
    }
    return d;
}
function getState(k) { try { const r = db().prepare('SELECT v FROM maintenance_state WHERE k = ?').get(k); return r ? JSON.parse(r.v) : null; } catch (_) { return null; } }
function setState(k, v) { db().prepare('INSERT INTO maintenance_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v)); }

function storeRun(report) {
    const d = db();
    const r = d.prepare('INSERT INTO maintenance_runs (started_at, ended_at, trigger, dry_run, state, summary, report) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(report.startedAt, report.endedAt, report.trigger, report.dryRun ? 1 : 0, report.state, report.summary, JSON.stringify(report));
    report.id = Number(r.lastInsertRowid);
    d.prepare('UPDATE maintenance_runs SET report = ? WHERE id = ?').run(JSON.stringify(report), report.id);
    d.prepare('DELETE FROM maintenance_runs WHERE started_at < ?').run(Date.now() - KEEP_DAYS * DAY);
    d.prepare('DELETE FROM maintenance_errors WHERE last_seen < ? AND issue_number IS NULL').run(Date.now() - 90 * DAY);
    return report;
}
function getRun(id) {
    const r = db().prepare('SELECT report FROM maintenance_runs WHERE id = ?').get(Number(id));
    try { return r ? JSON.parse(r.report) : null; } catch (_) { return null; }
}
function lastRun() {
    const r = db().prepare('SELECT report FROM maintenance_runs ORDER BY id DESC LIMIT 1').get();
    try { return r ? JSON.parse(r.report) : null; } catch (_) { return null; }
}
function history(limit = 60) {
    return db().prepare('SELECT id, started_at, ended_at, trigger, dry_run, state, summary FROM maintenance_runs ORDER BY id DESC LIMIT ?').all(limit)
        .map((r) => ({ id: r.id, startedAt: r.started_at, endedAt: r.ended_at, trigger: r.trigger, dryRun: !!r.dry_run, state: r.state, summary: r.summary }));
}

// ---------------------------------------------------------------- helpers

/** execFile with a timeout, never throwing: { ok, code, timedOut, out, err }. */
function sh(cmd, args, o = {}) {
    return new Promise((resolve) => {
        try {
            execFile(cmd, args, {
                cwd: o.cwd, timeout: o.timeout || 20000, maxBuffer: 16 * 1024 * 1024,
                env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' })
            }, (err, stdout, stderr) => {
                resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, timedOut: !!(err && err.killed), out: String(stdout || ''), err: String(stderr || '') });
            });
        } catch (e) { resolve({ ok: false, code: 1, timedOut: false, out: '', err: e.message }); }
    });
}
const git = (root, args, o) => sh('git', ['-C', root].concat(args), o);
const F = (text, level = 'info') => ({ text: String(text), level });
const expandHome = (p) => (String(p).startsWith('~') ? path.join(os.homedir(), String(p).slice(1)) : String(p));
const bytes = (n) => (n == null ? '?' : (n < 1024 ? `${n} B` : (n < 1048576 ? `${Math.round(n / 1024)} KB` : (n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`))));
function globMatch(pat, name) { return new RegExp(`^${String(pat).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(name); }
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`);

function makeCheck(id, state, summary, actions, findings, extra) {
    return Object.assign({ id, title: CHECK_TITLES[id] || id, state, summary, actions: actions || [], findings: findings || [] }, extra || {});
}

// ---------------------------------------------------------------- repos and worktrees

function parseWorktrees(text) {
    const out = [];
    let cur = null;
    String(text || '').split('\n').forEach((line) => {
        if (line.startsWith('worktree ')) { cur = { path: line.slice(9), head: '', branch: '', detached: false, bare: false, locked: false, prunable: false }; out.push(cur); return; }
        if (!cur) return;
        if (line.startsWith('HEAD ')) cur.head = line.slice(5);
        else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
        else if (line === 'detached') cur.detached = true;
        else if (line === 'bare') cur.bare = true;
        else if (line.startsWith('locked')) cur.locked = true;
        else if (line.startsWith('prunable')) cur.prunable = true;
    });
    return out;
}

/** The main repos the Fleet knows (deduplicated by git common dir): ctx.repos, else the Supervisor's roots plus ~/wt/* and ~/worktrees/*. */
async function knownRepos(ctx) {
    let roots = ctx.repos;
    if (!roots) {
        roots = [REPO];
        try { if (sup().repoRoots) roots.push(...sup().repoRoots()); } catch (_) { /* none */ }
        ['wt', 'worktrees'].forEach((d) => {
            try { fs.readdirSync(path.join(os.homedir(), d), { withFileTypes: true }).forEach((e) => { if (e.isDirectory() && fs.existsSync(path.join(os.homedir(), d, e.name, '.git'))) roots.push(path.join(os.homedir(), d, e.name)); }); } catch (_) { /* none */ }
        });
    }
    const seen = new Map();
    for (const root of roots) {
        const r = await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 10000 });
        if (!r.ok) continue;
        const common = r.out.trim();
        if (!common || seen.has(common)) continue;
        seen.set(common, path.basename(common) === '.git' ? path.dirname(common) : common);
    }
    return [...seen.values()];
}

function liveCwds(ctx) {
    if (ctx.liveCwds) return ctx.liveCwds;
    try { return require('./claudeSessions').liveSessions().map((s) => s.cwd).filter(Boolean); } catch (_) { return []; }
}

async function baseRef(root) {
    for (const ref of ['origin/main', 'origin/master']) {
        if ((await git(root, ['rev-parse', '--verify', '--quiet', ref], { timeout: 10000 })).ok) return ref;
    }
    return null;
}
async function isMerged(root, ref, base) { return (await git(root, ['merge-base', '--is-ancestor', ref, base], { timeout: 15000 })).ok; }

async function fetchRepo(root, ctx, notes) {
    if (ctx.fetch === false) return;
    const has = await git(root, ['remote', 'get-url', 'origin'], { timeout: 5000 });
    if (!has.ok) return;
    const r = await git(root, ['fetch', 'origin', '--prune', '--quiet'], { timeout: 60000 });
    if (!r.ok) notes.push(F(`${root}: fetch failed (${(r.timedOut ? 'timed out' : r.err.trim().split('\n')[0] || 'error').slice(0, 120)}); merged-ness uses the last fetched origin`, 'warn'));
}

/** Why a worktree must stay, or null when it may go. */
async function worktreeKeepReason(root, w, base, ctx, s) {
    const prot = s.protectPaths.map(expandHome);
    if (prot.some((p) => inside(w.path, p))) return 'in a protected folder';
    if (w.locked) return 'locked';
    if (liveCwds(ctx).some((c) => inside(c, w.path))) return 'a live session works in it';
    try { if (fs.readdirSync(w.path).some((n) => /^\.agent-/.test(n))) return 'a busy lock (.agent-*) is in it'; } catch (_) { return 'unreadable'; }
    let newest = 0;
    try { newest = Math.max(fs.statSync(w.path).mtimeMs, fs.statSync(path.join(w.path, '.git')).mtimeMs); } catch (_) { /* keep 0 */ }
    if (newest && Date.now() - newest < s.worktreeMinAgeDays * DAY) return `touched less than ${s.worktreeMinAgeDays} days ago`;
    const st = await git(w.path, ['status', '--porcelain', '--untracked-files=all'], { timeout: 30000 });
    if (!st.ok) return 'its status could not be read';
    if (st.out.trim()) return 'has uncommitted or untracked changes';
    if (!base) return 'no origin/main to compare with';
    if (w.detached || !w.branch) return (await isMerged(root, w.head || 'HEAD', base)) ? null : 'detached HEAD not merged into origin/main';
    if (await isMerged(root, w.branch, base)) return null;
    const up = await git(root, ['rev-parse', '--abbrev-ref', `${w.branch}@{upstream}`], { timeout: 10000 });
    let remote = up.ok ? up.out.trim() : '';
    if (!remote && (await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${w.branch}`], { timeout: 10000 })).ok) remote = `origin/${w.branch}`;
    if (!remote) return 'branch not merged and not pushed';
    const ahead = await git(root, ['rev-list', '--count', `${remote}..${w.branch}`], { timeout: 15000 });
    if (!ahead.ok || ahead.out.trim() !== '0') return 'branch has unpushed commits';
    return null;
}

async function checkWorktrees(ctx) {
    const s = ctx.settings;
    const actions = [];
    const findings = [];
    let removed = 0; let kept = 0; let pruned = 0;
    const repos = await knownRepos(ctx);
    for (const root of repos) {
        await fetchRepo(root, ctx, findings);
        const base = await baseRef(root);
        let list = await git(root, ['worktree', 'list', '--porcelain'], { timeout: 15000 });
        if (!list.ok) { findings.push(F(`${root}: git worktree list failed`, 'warn')); continue; }
        let wts = parseWorktrees(list.out);
        const dead = wts.slice(1).filter((w) => w.prunable || !fs.existsSync(w.path));
        if (dead.length) {
            if (ctx.dryRun) actions.push(`Would prune ${dead.length} dead worktree record(s) in ${root}`);
            else {
                const p = await git(root, ['worktree', 'prune'], { timeout: 20000 });
                if (p.ok) { pruned += dead.length; actions.push(`Pruned ${dead.length} dead worktree record(s) in ${root}`); } else findings.push(F(`${root}: worktree prune failed`, 'warn'));
                list = await git(root, ['worktree', 'list', '--porcelain'], { timeout: 15000 });
                wts = parseWorktrees(list.out);
            }
        }
        for (const w of wts.slice(1)) {
            if (w.bare || !fs.existsSync(w.path)) continue;
            const why = await worktreeKeepReason(root, w, base, ctx, s);
            const name = `${w.path} (${w.branch || 'detached'})`;
            if (why) { kept += 1; findings.push(F(`Kept ${name}: ${why}`)); continue; }
            if (ctx.dryRun) { actions.push(`Would remove worktree ${name}`); continue; }
            const r = await git(root, ['worktree', 'remove', w.path], { timeout: 60000 });
            if (r.ok) { removed += 1; actions.push(`Removed worktree ${name}`); } else { kept += 1; findings.push(F(`Could not remove ${name}: ${r.err.trim().split('\n')[0].slice(0, 160)}`, 'warn')); }
        }
    }
    const warn = findings.some((f) => f.level === 'warn');
    return makeCheck('worktrees', warn ? 'warn' : 'ok', `${repos.length} repo(s): ${removed} removed, ${pruned} pruned, ${kept} kept${ctx.dryRun ? ' (dry run)' : ''}`, actions, findings);
}

async function checkBranches(ctx) {
    const s = ctx.settings;
    const actions = [];
    const findings = [];
    let deleted = 0; let remoteListed = 0;
    const repos = await knownRepos(ctx);
    const inYozora = new Set((ctx.yozoraRepos || []));
    for (const root of repos) {
        const base = await baseRef(root);
        if (!base) { findings.push(F(`${root}: no origin/main, branches not checked`)); continue; }
        const wts = parseWorktrees((await git(root, ['worktree', 'list', '--porcelain'], { timeout: 15000 })).out);
        const checkedOut = new Set(wts.map((w) => w.branch).filter(Boolean));
        const cwds = liveCwds(ctx);
        const locals = (await git(root, ['for-each-ref', '--format=%(refname:short)%09%(committerdate:unix)', 'refs/heads'], { timeout: 15000 })).out.split('\n').filter(Boolean);
        for (const line of locals) {
            const [name, ts] = line.split('\t');
            if (checkedOut.has(name) || s.protectBranches.some((p) => globMatch(p, name))) continue;
            if (cwds.some((c) => wts.some((w) => w.branch === name && inside(c, w.path)))) continue;
            if (!(await isMerged(root, `refs/heads/${name}`, base))) continue;
            // a branch just made at main's tip is "merged" too: only branches older than the minimum age go
            const rl = await git(root, ['reflog', 'show', '--format=%ct', `refs/heads/${name}`], { timeout: 10000 });
            const born = rl.ok && rl.out.trim() ? Number(rl.out.trim().split('\n').pop()) * 1000 : Number(ts) * 1000;
            if (Date.now() - born < s.branchMinAgeHours * HOUR) continue;
            if (ctx.dryRun) { actions.push(`Would delete merged branch ${name} in ${root}`); continue; }
            const r = await git(root, ['branch', '-D', name], { timeout: 15000 });
            if (r.ok) { deleted += 1; actions.push(`Deleted merged branch ${name} in ${root}`); } else findings.push(F(`Could not delete ${name}: ${r.err.trim().split('\n')[0].slice(0, 160)}`, 'warn'));
        }
        const remotes = (await git(root, ['for-each-ref', '--format=%(refname:short)%09%(committerdate:unix)', 'refs/remotes/origin'], { timeout: 15000 })).out.split('\n').filter(Boolean);
        const old = [];
        for (const line of remotes) {
            const [ref, ts] = line.split('\t');
            const name = ref.replace(/^origin\//, '');
            if (name === 'HEAD' || ref === 'origin' || s.protectBranches.some((p) => globMatch(p, name))) continue;
            if (Date.now() - Number(ts) * 1000 < s.remoteBranchDays * DAY) continue;
            if (await isMerged(root, `refs/remotes/${ref}`, base)) old.push(name);
        }
        if (old.length) {
            remoteListed += old.length;
            findings.push(F(`${root}: ${old.length} merged remote branch(es) older than ${s.remoteBranchDays} days: ${old.slice(0, 12).join(', ')}${old.length > 12 ? ', ...' : ''}`));
            if (s.deleteRemoteBranches && !ctx.dryRun && ctx.yz) {
                const repo = ctx.yz.repoForCwd(root);
                if (repo && (!inYozora.size || inYozora.has(repo))) {
                    for (const name of old.slice(0, 50)) {
                        try { await ctx.yz.call('DELETE', `/repos/${repo}/branches/${encodeURIComponent(name)}`); actions.push(`Deleted remote branch ${name} on ${repo}`); } catch (e) { findings.push(F(`Remote branch ${name}: ${e.message}`, 'warn')); }
                    }
                }
            }
        }
    }
    const warn = findings.some((f) => f.level === 'warn');
    return makeCheck('branches', warn ? 'warn' : 'ok', `${deleted} local branch(es) deleted, ${remoteListed} merged remote branch(es) listed${ctx.dryRun ? ' (dry run)' : ''}`, actions, findings);
}

// ---------------------------------------------------------------- work folders

async function checkWorkfolders(ctx) {
    const s = ctx.settings;
    const sp = ctx.sup || sup();
    const actions = [];
    const findings = [];
    try { if (sp.refreshArtifacts) await sp.refreshArtifacts({ budgetMs: 4000 }); } catch (_) { /* stale sizes */ }
    const list = sp.artifactStatus();
    let freed = 0; let cleaned = 0; let keptYoung = 0; let wtN = 0; let deferred = 0;
    const budget = { calls: 0, max: 10 };
    for (const a of list) {
        if (!a.cleanable || a.exists === false || a.decision === 'unsafe' || a.decision === 'refused') continue;
        if (a.kind === 'worktree') { wtN += 1; continue; } // worktrees go through the worktree check (safe criteria), never a forced remove
        if (a.state === 'live') continue;
        if (a.ageHours < s.artifactMinAgeDays * 24) { keptYoung += 1; continue; }
        if (ctx.dryRun) { actions.push(`Would clean ${a.path} (${bytes(a.sizeBytes)})`); freed += a.sizeBytes || 0; continue; }
        // the same supervised path as the Clean button (guard, evidence, engine verdict, trash); at most 10 engine calls per run
        try {
            const r = await sp.cleanArtifact(a.id, { gr: ctx.gr, budget });
            if (r.decision === 'trashed' || r.decision === 'removed') { freed += r.freedBytes || 0; cleaned += 1; actions.push(`${r.decision === 'trashed' ? 'Moved to the trash' : 'Removed'} ${r.cleaned} (${bytes(r.freedBytes)})`); }
            else if (r.decision === 'deferred') deferred += 1;
            else findings.push(F(`${a.path}: ${r.decision === 'unsafe' ? 'kept, ' : ''}${r.reason}`));
        } catch (e) { findings.push(F(`${a.path}: ${e.message}`, 'warn')); }
    }
    if (deferred) findings.push(F(`${deferred} folder(s) wait for the next run (at most ${budget.max} reviews per run)`));
    if (!ctx.dryRun && sp.purgeTrash) { try { const gone = sp.purgeTrash(); if (gone.length) actions.push(`Deleted ${gone.length} item(s) from the trash after 7 days`); } catch (e) { findings.push(F(`Trash purge: ${e.message}`, 'warn')); } }
    if (keptYoung) findings.push(F(`${keptYoung} cleanable folder(s) are younger than ${s.artifactMinAgeDays} days and were left`));
    if (wtN) findings.push(F(`${wtN} tracked worktree(s) are handled by the worktree check`));
    const warn = findings.some((f) => f.level === 'warn');
    return makeCheck('workfolders', warn ? 'warn' : 'ok', `${ctx.dryRun ? 'Would free' : 'Freed'} ${bytes(freed)} from ${cleaned || actions.length} work folder(s) and temp file(s)`, actions, findings);
}

// ---------------------------------------------------------------- pull requests

async function checkPrs(ctx) {
    const s = ctx.settings;
    const yz = ctx.yz;
    const sp = ctx.sup || sup();
    const repos = ctx.yozoraRepos || [];
    const actions = [];
    const findings = [];
    let open = 0; let queued = 0;
    if (!repos.length) return makeCheck('prs', 'skipped', 'No Yozora repositories are set (agentSupervisor.yozoraRepos)', [], []);
    for (const repo of repos) {
        let prs;
        try { prs = (await yz.call('GET', `/repos/${repo}/pulls?state=open&limit=50`)) || []; } catch (e) { findings.push(F(`${repo}: pull requests could not be read (${e.message})`, 'warn')); continue; }
        for (const pr of prs) {
            open += 1;
            const n = pr.number;
            let full = pr;
            if (pr.mergeable === undefined) { try { full = await yz.call('GET', `/repos/${repo}/pulls/${n}`); } catch (_) { full = pr; } }
            const upToDate = !full.merge_base || !full.base || !full.base.sha || full.merge_base === full.base.sha;
            const label = `${repo}#${n} ${String(pr.title || '').slice(0, 80)}`;
            if (full.mergeable !== true) { findings.push(F(`${label}: not mergeable (conflicts or checks pending); left alone`, 'warn')); continue; }
            if (!upToDate) { findings.push(F(`${label}: its branch is behind ${(full.base && full.base.ref) || 'main'}; left alone`)); continue; }
            const ref = `pr:${repo}#${n}`;
            if (ctx.dryRun) { actions.push(`Would queue "Merge PR #${n}: ${pr.title}"`); queued += 1; continue; }
            let cwd = REPO;
            try { for (const r of await knownRepos(ctx)) { if (yz.repoForCwd(r) === repo) { cwd = r; break; } } } catch (_) { /* default */ }
            try {
                const w = sp.enqueue({
                    title: `Merge PR #${n}: ${pr.title}`.slice(0, 120), source: 'yozora', sourceRef: ref, cwd,
                    prompt: [
                        `Yozora pull request ${repo}#${n}: "${pr.title}" (${(pr.head && pr.head.ref) || 'branch'} -> ${(full.base && full.base.ref) || 'main'}), by ${(pr.user && pr.user.login) || 'unknown'}.`,
                        `URL: ${pr.html_url || `${repo} pull request ${n}`}`,
                        '',
                        'Yukimi\'s rule: work merges to main, no waiting PRs. Maintenance found this PR mergeable and up to date.',
                        'Verify it: read the diff, run the node --check / project checks the touched files need, make sure it does not break any rule in CLAUDE.md. If it is good, merge it into main (and push main as the rules say), close the PR, and delete its branch. If it is not good, comment on the PR what is wrong and report back. Never leave it half done.'
                    ].join('\n')
                });
                if (w && w.reused) continue; // already queued: nothing new
                queued += 1;
                actions.push(`Queued work item #${w.id} "Merge PR #${n}: ${pr.title}" (held: pick it in the Work Queue)`);
            } catch (e) { findings.push(F(`${label}: could not queue (${e.message})`, 'warn')); }
        }
    }
    const warn = findings.some((f) => f.level === 'warn');
    return makeCheck('prs', warn ? 'warn' : 'ok', `${open} open PR(s), ${queued} queued for a merge${ctx.dryRun ? ' (dry run)' : ''}`, actions, findings);
}

// ---------------------------------------------------------------- server errors

function normaliseLine(t) {
    return String(t)
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
        .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
        .replace(/:\d+:\d+\)?/g, ')')
        .replace(/\b\d+(\.\d+)?\b/g, 'N')
        .replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** Groups a PM2 error log text by normalised message + top stack frame. Lines carry "YYYY-MM-DDTHH:MM:SS: " prefixes. */
function groupErrors(text, opts = {}) {
    const since = opts.since || 0;
    const ignore = (opts.ignore || []).map((x) => { try { return new RegExp(x); } catch (_) { return null; } }).filter(Boolean);
    const entries = [];
    let cur = null;
    String(text || '').split('\n').forEach((raw) => {
        if (!raw.trim()) return;
        const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)(?:Z|[+-]\d\d:\d\d)?: ?(.*)$/.exec(raw);
        const at = m ? Date.parse(m[1]) : 0;
        const body = m ? m[2] : raw;
        if (cur && (/^\s+\S/.test(body) || /^at /.test(body) || /^[}\])]+[,;]?$/.test(body.trim()))) { cur.lines.push(body); return; }
        cur = { at, lines: [body] };
        entries.push(cur);
    });
    const groups = new Map();
    entries.forEach((e) => {
        if (e.at && e.at < since) return;
        const head = e.lines[0];
        const whole = e.lines.join('\n');
        if (ignore.some((r) => r.test(whole))) return;
        const frame = e.lines.slice(1).find((l) => /^\s*at /.test(l)) || '';
        const norm = normaliseLine(head);
        const topFrame = normaliseLine(frame);
        const fp = crypto.createHash('sha1').update(`${norm}|${topFrame}`).digest('hex').slice(0, 12);
        let g = groups.get(fp);
        if (!g) { g = { fp, message: head.trim().slice(0, 300), norm, topFrame, count: 0, firstAt: e.at, lastAt: e.at, sample: e.lines.slice(0, 14).join('\n') }; groups.set(fp, g); }
        g.count += 1;
        if (e.at) { g.firstAt = Math.min(g.firstAt || e.at, e.at); g.lastAt = Math.max(g.lastAt, e.at); }
    });
    return [...groups.values()].sort((a, b) => b.count - a.count);
}

async function errorLogPath(ctx) {
    if (ctx.errorLog) return ctx.errorLog;
    const r = await sh('pm2', ['jlist'], { timeout: 20000 });
    if (r.ok) {
        try {
            const i = r.out.indexOf('[');
            const list = JSON.parse(r.out.slice(i));
            const p = list.find((x) => x.name === 'Dreamscape');
            if (p && p.pm2_env && p.pm2_env.pm_err_log_path) return p.pm2_env.pm_err_log_path;
        } catch (_) { /* fall back */ }
    }
    const guess = path.join(os.homedir(), '.pm2', 'logs', 'Dreamscape-error.log');
    return fs.existsSync(guess) ? guess : null;
}

/** Reads the log from the saved offset (the first run: the last day, at most the last 4 MB). */
function readLogSince(file, key) {
    const st = fs.statSync(file);
    const prev = getState(key);
    let start;
    if (prev && prev.ino === st.ino && prev.size <= st.size) start = prev.size;
    else if (prev) start = 0; // truncated or rotated: all of the new file
    else start = Math.max(0, st.size - 4 * 1024 * 1024);
    start = Math.max(start, st.size - 8 * 1024 * 1024);
    const len = st.size - start;
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, start);
        return { text: buf.toString('utf8'), size: st.size, ino: st.ino, first: !prev };
    } finally { fs.closeSync(fd); }
}

function errorIssueBody(g, repoNote) {
    return [
        `Maintenance found a server error that keeps repeating in Dreamscape's PM2 error log (${repoNote}).`,
        '',
        `- **Message:** \`${g.message.replace(/`/g, "'").slice(0, 200)}\``,
        `- **Count in the latest window:** ${g.count} (total since first seen: ${g.total})`,
        `- **First seen:** ${new Date(g.firstSeen || g.firstAt || Date.now()).toISOString()}`,
        `- **Last seen:** ${new Date(g.lastAt || Date.now()).toISOString()}`,
        '',
        '```',
        g.sample,
        '```',
        '',
        'Filed by the Fleet maintenance run (Fleet > Supervisor > Maintenance). Later runs comment here with the new count.',
        '',
        `<!-- fleet-maint-error:${g.fp} -->`
    ].join('\n');
}

async function checkErrors(ctx) {
    const s = ctx.settings;
    const yz = ctx.yz;
    const sp = ctx.sup || sup();
    const actions = [];
    const findings = [];
    const file = await errorLogPath(ctx);
    if (!file || !fs.existsSync(file)) return makeCheck('errors', 'skipped', 'No Dreamscape error log was found', [], []);
    const key = `errlog:${file}`;
    let read;
    try { read = readLogSince(file, key); } catch (e) { return makeCheck('errors', 'warn', `The error log could not be read (${e.message})`, [], []); }
    const since = read.first ? Date.now() - DAY : 0;
    const groups = groupErrors(read.text, { since, ignore: s.errorIgnore });
    const d = db();
    const now = Date.now();
    let filed = 0; let commented = 0; let fresh = 0;
    const repo = ctx.errorRepo || (yz ? yz.DEFAULT_REPO : 'DreamScape/StaticForge');
    for (const g of groups) {
        const row = d.prepare('SELECT * FROM maintenance_errors WHERE fp = ?').get(g.fp);
        const total = (row ? row.total : 0) + g.count;
        g.total = total;
        g.firstSeen = row ? row.first_seen : (g.firstAt || now);
        if (!ctx.dryRun) {
            d.prepare(`INSERT INTO maintenance_errors (fp, title, first_seen, last_seen, total) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(fp) DO UPDATE SET last_seen = excluded.last_seen, total = excluded.total, title = excluded.title`).run(g.fp, g.message.slice(0, 200), g.firstSeen, now, total);
        }
        const issued = row && row.issue_number;
        if (!issued && total >= s.errorThreshold) fresh += 1;
        findings.push(F(`${g.count}x ${g.message.slice(0, 160)}${issued ? ` (issue ${row.issue_repo}#${row.issue_number})` : ''}`, !issued && total >= s.errorThreshold ? 'warn' : 'info'));
        if (!yz) continue;
        if (issued) {
            if (!ctx.dryRun && g.count > 0) {
                try { await yz.call('POST', `/repos/${row.issue_repo}/issues/${row.issue_number}/comments`, { body: `Seen ${g.count} more time(s) since the last maintenance run (${total} in all). Last seen ${new Date(g.lastAt || now).toISOString()}.\n\n<!-- fleet-maint-error:${g.fp} -->` }); commented += 1; } catch (e) { findings.push(F(`Comment on ${row.issue_repo}#${row.issue_number}: ${e.message}`, 'warn')); }
            }
            continue;
        }
        if (total < s.errorThreshold || filed >= s.maxIssuesPerRun) continue;
        if (ctx.dryRun) { actions.push(`Would file a Yozora issue for "${g.message.slice(0, 100)}" (${g.count}x)`); continue; }
        try {
            const marker = `fleet-maint-error:${g.fp}`;
            let issue = null;
            try {
                const found = (await yz.call('GET', `/repos/${repo}/issues?state=open&type=issues&q=${encodeURIComponent(marker)}&limit=10`)) || [];
                issue = found.find((i) => String(i.body || '').includes(marker)) || null;
            } catch (_) { /* create anyway */ }
            if (!issue) {
                const by = await yz.labels(repo).catch(() => new Map());
                const ids = ['bug', 'fleet'].map((n) => by.get(n)).filter(Boolean);
                issue = await yz.call('POST', `/repos/${repo}/issues`, { title: `Server error: ${g.message.slice(0, 110)}`, body: errorIssueBody(g, os.hostname()), labels: ids });
                actions.push(`Filed Yozora issue ${repo}#${issue.number} for "${g.message.slice(0, 80)}" (${g.count}x)`);
            } else {
                await yz.call('POST', `/repos/${repo}/issues/${issue.number}/comments`, { body: `Seen again: ${g.count} time(s) in the latest maintenance window.\n\n<!-- ${marker} -->` }).catch(() => {});
                actions.push(`Linked the existing issue ${repo}#${issue.number} for "${g.message.slice(0, 80)}"`);
            }
            filed += 1;
            let workId = null;
            try {
                const w = sp.enqueue({
                    title: `Fix server error: ${g.message.slice(0, 90)}`, source: 'yozora', sourceRef: `maint-error:${g.fp}`, cwd: REPO, issue: `${repo}#${issue.number}`,
                    prompt: [`Dreamscape's PM2 error log shows a repeating error (${g.count}x in the latest window, ${total} in all).`, '', `Message: ${g.message}`, '', 'Sample:', g.sample, '', `Yozora issue: ${repo}#${issue.number}. Find the cause in the code, fix it properly (no workaround that hides the log line), test it, commit and push to main as the rules say, then comment the fix on the issue and close it.`].join('\n')
                });
                workId = w && w.id;
            } catch (e) { findings.push(F(`Work item for ${g.fp}: ${e.message}`, 'warn')); }
            d.prepare('UPDATE maintenance_errors SET issue_repo = ?, issue_number = ?, work_id = ? WHERE fp = ?').run(repo, issue.number, workId, g.fp);
        } catch (e) { findings.push(F(`Issue for ${g.fp}: ${e.message}`, 'warn')); }
    }
    if (!ctx.dryRun) setState(key, { size: read.size, ino: read.ino, at: now });
    const total = groups.reduce((n, g) => n + g.count, 0);
    const state = fresh ? 'warn' : 'ok';
    return makeCheck('errors', state, groups.length ? `${total} error line(s) in ${groups.length} group(s); ${filed} issue(s) filed, ${commented} comment(s)${ctx.dryRun ? ' (dry run)' : ''}` : 'No new errors in the log', actions, findings);
}

// ---------------------------------------------------------------- disk, thermals, health

/** `df -P -k` text -> [{ fs, sizeK, usedK, availK, pct, mount }]. */
function parseDf(text) {
    return String(text || '').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 6)
        .map((p) => ({ fs: p[0], sizeK: Number(p[1]), usedK: Number(p[2]), availK: Number(p[3]), pct: Number(String(p[4]).replace('%', '')), mount: p.slice(5).join(' ') }));
}
/** `du -x -d1 -B1` text -> biggest entries first, without the total line. */
function parseDu(text, top = 6) {
    const rows = String(text || '').split('\n').map((l) => /^(\d+)\s+(.+)$/.exec(l)).filter(Boolean).map((m) => ({ bytes: Number(m[1]), path: m[2] }));
    const total = rows.reduce((a, r) => (r.bytes > a ? r.bytes : a), 0);
    return rows.filter((r) => r.bytes !== total || rows.length === 1).sort((a, b) => b.bytes - a.bytes).slice(0, top);
}

async function checkDisk(ctx) {
    const s = ctx.settings;
    const findings = [];
    let worst = 'ok';
    const mounts = new Map();
    for (const p of (ctx.diskPaths || ['/', '/home', '/tmp'])) {
        const r = await sh('df', ['-P', '-k', p], { timeout: 10000 });
        if (!r.ok) { findings.push(F(`df ${p} failed`, 'warn')); worst = worst === 'fail' ? worst : 'warn'; continue; }
        parseDf(r.out).forEach((m) => mounts.set(m.mount, m));
    }
    for (const m of mounts.values()) {
        const warnAt = m.mount === '/tmp' || /tmpfs/.test(m.fs) ? s.tempWarn : s.diskWarn;
        const st = m.pct > s.diskFail ? 'fail' : (m.pct > warnAt ? 'warn' : 'ok');
        if (st === 'fail' || (st === 'warn' && worst !== 'fail')) worst = st;
        findings.push(F(`${m.mount}: ${m.pct}% used (${bytes(m.usedK * 1024)} of ${bytes(m.sizeK * 1024)}, ${bytes(m.availK * 1024)} free)`, st === 'ok' ? 'info' : st));
    }
    for (const dir of (ctx.duPaths || ['/tmp', path.join(os.homedir(), '.cache')])) {
        const r = await sh('du', ['-x', '-d1', '-B1', dir], { timeout: 25000 });
        const top = parseDu(r.out, 5); // partial output after a timeout still counts
        if (top.length) findings.push(F(`Biggest in ${dir}: ${top.map((t) => `${path.basename(t.path) || t.path} ${bytes(t.bytes)}`).join(', ')}${r.timedOut ? ' (partial: du timed out)' : ''}`));
    }
    return makeCheck('disk', worst, [...mounts.values()].map((m) => `${m.mount} ${m.pct}%`).join(', ') || 'No disk could be read', [], findings);
}

/** Thermal zone readings [{ name, milli }] -> [{ label, c }] sorted hottest first. */
function parseThermal(zones) { return zones.map((z) => ({ label: z.name, c: Math.round(Number(z.milli) / 100) / 10 })).filter((z) => Number.isFinite(z.c) && z.c > -50 && z.c < 250).sort((a, b) => b.c - a.c); }
/** `sensors -j` object -> [{ label, c }] (every temp*_input). */
function parseSensors(obj) {
    const out = [];
    Object.keys(obj || {}).forEach((chip) => {
        const c = obj[chip];
        if (!c || typeof c !== 'object') return;
        Object.keys(c).forEach((feat) => {
            const f = c[feat];
            if (!f || typeof f !== 'object') return;
            Object.keys(f).forEach((k) => { if (/^temp\d+_input$/.test(k) && Number.isFinite(Number(f[k]))) out.push({ label: `${chip} ${feat}`, c: Number(f[k]) }); });
        });
    });
    return out.sort((a, b) => b.c - a.c);
}
function parseMeminfo(text) {
    const v = {};
    String(text || '').split('\n').forEach((l) => { const m = /^(\w+):\s+(\d+)/.exec(l); if (m) v[m[1]] = Number(m[2]); });
    return { totalKb: v.MemTotal || 0, availKb: v.MemAvailable != null ? v.MemAvailable : (v.MemFree || 0), swapTotalKb: v.SwapTotal || 0, swapFreeKb: v.SwapFree || 0 };
}
function parseFailedUnits(text) { return String(text || '').split('\n').map((l) => l.replace(/^[\s●*×]+/, '').trim()).filter((l) => /\.(service|socket|timer|mount|target|path)\b/.test(l)).map((l) => l.split(/\s+/)[0]); }

async function checkThermals(ctx) {
    const s = ctx.settings;
    const findings = [];
    let state = 'ok';
    const bump = (st) => { if (st === 'fail' || (st === 'warn' && state !== 'fail')) state = st; };
    const zones = [];
    const zdir = ctx.thermalDir || '/sys/class/thermal';
    try {
        for (const n of fs.readdirSync(zdir).filter((x) => /^thermal_zone\d+$/.test(x))) {
            try {
                const milli = Number(fs.readFileSync(path.join(zdir, n, 'temp'), 'utf8').trim());
                let type = n; try { type = fs.readFileSync(path.join(zdir, n, 'type'), 'utf8').trim(); } catch (_) { /* name only */ }
                zones.push({ name: `${n} ${type}`, milli });
            } catch (_) { /* unreadable zone */ }
        }
    } catch (_) { /* none */ }
    // hwmon (temp*_input in millidegrees) where no thermal zone exists
    if (!parseThermal(zones).length && !ctx.thermalDir) {
        try {
            for (const h of fs.readdirSync('/sys/class/hwmon')) {
                let chip = h; try { chip = fs.readFileSync(path.join('/sys/class/hwmon', h, 'name'), 'utf8').trim(); } catch (_) { /* id only */ }
                for (const f of fs.readdirSync(path.join('/sys/class/hwmon', h)).filter((x) => /^temp\d+_input$/.test(x))) {
                    try { zones.push({ name: `${chip} ${f.replace('_input', '')}`, milli: Number(fs.readFileSync(path.join('/sys/class/hwmon', h, f), 'utf8').trim()) }); } catch (_) { /* unreadable */ }
                }
            }
        } catch (_) { /* none */ }
    }
    let temps = parseThermal(zones);
    const sj = await sh('sensors', ['-j'], { timeout: 10000 });
    if (sj.ok) { try { temps = temps.concat(parseSensors(JSON.parse(sj.out))).sort((a, b) => b.c - a.c); } catch (_) { /* odd output */ } }
    if (temps.length) {
        const hot = temps.filter((t) => t.c > s.thermalWarn);
        if (hot.length) bump('warn');
        findings.push(F(`Hottest: ${temps[0].label} ${temps[0].c} C${hot.length ? ` (${hot.length} above ${s.thermalWarn} C)` : ''}`, hot.length ? 'warn' : 'info'));
        hot.slice(0, 5).forEach((t) => findings.push(F(`${t.label}: ${t.c} C`, 'warn')));
    } else findings.push(F('No temperature sensor could be read'));
    const load = os.loadavg();
    const cpus = os.cpus().length || 1;
    if (load[0] > cpus * 2) { bump('warn'); findings.push(F(`Load ${load[0].toFixed(1)} on ${cpus} CPUs (over twice the CPU count)`, 'warn')); } else findings.push(F(`Load ${load.map((x) => x.toFixed(2)).join(' / ')} on ${cpus} CPUs`));
    let mem = null;
    try { mem = parseMeminfo(ctx.meminfo != null ? ctx.meminfo : fs.readFileSync('/proc/meminfo', 'utf8')); } catch (_) { /* none */ }
    if (mem && mem.totalKb) {
        const freePct = Math.round((mem.availKb / mem.totalKb) * 100);
        const swapUsed = mem.swapTotalKb ? Math.round(((mem.swapTotalKb - mem.swapFreeKb) / mem.swapTotalKb) * 100) : 0;
        if (freePct < 8) bump('warn');
        if (swapUsed > 60) bump('warn');
        findings.push(F(`Memory ${bytes(mem.availKb * 1024)} available of ${bytes(mem.totalKb * 1024)} (${freePct}%)`, freePct < 8 ? 'warn' : 'info'));
        if (mem.swapTotalKb) findings.push(F(`Swap ${swapUsed}% used of ${bytes(mem.swapTotalKb * 1024)}`, swapUsed > 60 ? 'warn' : 'info'));
    }
    const fu = await sh('systemctl', ['--user', '--failed', '--no-legend', '--plain'], { timeout: 10000 });
    if (fu.ok || fu.out) {
        const failed = parseFailedUnits(fu.out);
        if (failed.length) { bump('warn'); failed.slice(0, 10).forEach((u) => findings.push(F(`Failed user unit: ${u}`, 'warn'))); } else findings.push(F('No failed systemd user units'));
    }
    const pm = await sh('pm2', ['jlist'], { timeout: 20000 });
    if (pm.ok) {
        try {
            const list = JSON.parse(pm.out.slice(pm.out.indexOf('[')));
            const prev = getState('pm2-restarts') || {};
            const next = {};
            list.forEach((p) => {
                const r = p.pm2_env ? Number(p.pm2_env.restart_time) || 0 : 0;
                next[p.name] = r;
                const up = p.pm2_env && p.pm2_env.status;
                const grew = prev[p.name] != null && r > prev[p.name];
                if (up && up !== 'online' && up !== 'stopped') { bump('warn'); findings.push(F(`PM2 ${p.name}: ${up}`, 'warn')); }
                if (grew) { bump('warn'); findings.push(F(`PM2 ${p.name} restarted ${r - prev[p.name]} time(s) since the last run (${r} in all)`, 'warn')); }
            });
            if (!ctx.dryRun) setState('pm2-restarts', next);
            findings.push(F(`PM2: ${list.length} process(es), restarts ${Object.keys(next).filter((k) => next[k]).map((k) => `${k} ${next[k]}`).join(', ') || 'none'}`));
        } catch (_) { findings.push(F('pm2 jlist was unreadable')); }
    }
    return makeCheck('thermals', state, findings.filter((f) => f.level === 'warn').length ? `${findings.filter((f) => f.level === 'warn').length} warning(s)` : 'Temperatures, load, memory and services are fine', [], findings);
}

// ---------------------------------------------------------------- sessions and agents

async function checkSessions(ctx) {
    const s = ctx.settings;
    const sp = ctx.sup || sup();
    const actions = [];
    const findings = [];
    let live = ctx.liveSessions;
    if (!live) { try { live = require('./claudeSessions').liveSessions(); } catch (_) { live = []; } }
    let work = [];
    try { work = sp.listWork({ limit: 300 }); } catch (_) { /* none */ }
    const withWork = new Set(work.filter((w) => w.sessionId && ['starting', 'running', 'waiting', 'queued', 'held'].includes(w.state)).map((w) => w.sessionId));
    let idle = 0;
    live.forEach((x) => {
        if (!x.tmuxSession || x.status === 'busy') return;
        const last = Number(x.updatedAt) || 0;
        if (!last || Date.now() - last < s.idleSessionHours * HOUR) return;
        if (withWork.has(x.id)) return;
        idle += 1;
        findings.push(F(`Idle ${Math.round((Date.now() - last) / HOUR)} h with no work item: ${x.name || x.id.slice(0, 8)} (tmux ${x.tmuxSession}) in ${x.cwd || '?'}`));
    });
    // agent-coord agents nobody has heard from: the store derives "gone"; the row is made to say it (releases their claims and locks)
    let marked = 0;
    try {
        const c = ctx.coord || coord();
        const raw = new Map(c.open().prepare('SELECT id, status FROM agents').all().map((r) => [r.id, r.status]));
        for (const a of c.listAgents({ all: true })) {
            if (a.status === 'gone' && raw.get(a.id) && raw.get(a.id) !== 'gone') {
                if (ctx.dryRun) actions.push(`Would mark agent ${a.name || a.id} gone`);
                else { c.setStatus(a.id, 'gone'); marked += 1; actions.push(`Marked agent ${a.name || a.id} gone (nobody heard from it)`); }
            }
        }
    } catch (e) { findings.push(F(`Agents could not be checked: ${e.message}`, 'warn')); }
    return makeCheck('sessions', findings.some((f) => f.level === 'warn') ? 'warn' : 'ok', `${idle} idle Fleet session(s) without work, ${marked} stale agent(s) marked gone${ctx.dryRun ? ' (dry run)' : ''}`, actions, findings);
}

// ---------------------------------------------------------------- Waiting work

const WAIT_VERDICTS = ['valid', 'done', 'outdated', 'duplicate', 'unclear'];
const WAIT_CAP = 25;
const WAIT_BATCH = 4;
const WAIT_RECHECK = 3 * DAY;
const WAIT_SYSTEM = 'You check queued coding requests ("Waiting work") of a Dreamscape / StaticForge team before anyone starts them. For each item you get its brief, its Yozora issue (state, labels, last comments), recent git commits that mention the issue, which of the files its brief names still exist, and the other waiting items. Verdict per item: "valid" (still to do as written), "done" (the evidence shows it was already done: name the commits or comments), "outdated" (the code or plan moved on so the brief needs changing: give "suggestedBrief", the complete corrected brief), "duplicate" (another item or issue covers it: give "duplicateOf" as "#<item id>" or the issue ref), "unclear" (cannot tell). Judge only from the evidence given, never invent. Answer ONLY {"verdicts":[{"id":<item id>,"verdict":"valid|done|outdated|duplicate|unclear","evidence":"one or two sentences","suggestedBrief":"only for outdated","duplicateOf":"only for duplicate"}]}.';

/** File-looking paths a brief names (folder/name.ext), at most 12. */
function briefPaths(text) {
    const out = new Set();
    const re = /(?:^|[\s`'"(\[])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6})(?=[\s`'")\]:,;.]|$)/g;
    let m;
    while ((m = re.exec(String(text || ''))) && out.size < 12) { if (!/^https?:|\/\//.test(m[1]) && !m[1].startsWith('/')) out.add(m[1]); }
    return [...out];
}

/** Held items are checked against their issue, git history and the files they name; the Supervisor's engine gives a verdict per item (stored on the item, never applied). */
async function checkWaiting(ctx) {
    const sp = ctx.sup || sup();
    const yz = ctx.yz;
    const g = ctx.gr || gResources;
    const ask = ctx.askJson || ((sys, user) => sp.askJson(g, sys, user, 'maintenance-waiting'));
    const actions = [];
    const findings = [];
    const held = sp.listWork({ limit: 300 }).filter((w) => w.state === 'held');
    if (!held.length) return makeCheck('waiting', 'ok', 'Nothing is waiting', [], [], { counts: {} });
    // oldest checked first (never checked before checked), the parts of split items are not checked on their own
    held.sort((a, b) => ((a.check && a.check.at) || 0) - ((b.check && b.check.at) || 0) || a.id - b.id);
    const picked = [];
    let fetched = 0;
    let skipped = 0;
    let closed = 0;
    for (const w of held) {
        if (picked.length >= WAIT_CAP || fetched >= 80) break;
        if (w.parentId) continue;
        let issue = null; let comments = [];
        if (w.issue && yz) {
            fetched += 1;
            try {
                issue = await yz.call('GET', `/repos/${w.issue.repo}/issues/${w.issue.number}`);
                if (issue && issue.state === 'closed') {
                    closed += 1;
                    if (ctx.dryRun) actions.push(`Would cancel #${w.id} "${w.title}": its issue ${w.issue.repo}#${w.issue.number} is closed`);
                    else { try { sp.cancelWork(w.id); sp.setWork(w.id, { message: 'Its issue was closed on Yozora' }); actions.push(`Cancelled #${w.id} "${w.title}": its issue is closed`); } catch (e) { findings.push(F(`#${w.id}: ${e.message}`, 'warn')); } }
                    continue;
                }
                const prev = w.check || null;
                if (prev && prev.at && Date.now() - prev.at < WAIT_RECHECK && (!issue || prev.issueUpdatedAt === issue.updated_at)) { skipped += 1; continue; }
                comments = ((await yz.call('GET', `/repos/${w.issue.repo}/issues/${w.issue.number}/comments`).catch(() => [])) || []).slice(-3);
            } catch (e) { findings.push(F(`#${w.id}: its issue could not be read (${e.message})`)); }
        } else if (w.check && w.check.at && Date.now() - w.check.at < WAIT_RECHECK) { skipped += 1; continue; }
        picked.push({ w, issue, comments });
    }
    const evidence = [];
    for (const p of picked) {
        const w = p.w;
        const root = w.cwd && fs.existsSync(w.cwd) ? w.cwd : REPO;
        let commits = [];
        if (w.issue) {
            const r = await git(root, ['log', '--oneline', '-n', '5', '-E', '--grep', `#${w.issue.number}([^0-9]|$)`], { timeout: 15000 });
            if (r.ok) commits = r.out.split('\n').map((l) => l.trim()).filter(Boolean);
        }
        const paths = briefPaths(sp.workPrompt(w.id));
        const missing = paths.filter((x) => !fs.existsSync(path.join(root, x)));
        p.ev = {
            id: w.id, title: w.title, created: new Date(w.createdAt).toISOString().slice(0, 10), brief: sp.workPrompt(w.id).slice(0, 3000),
            issue: w.issue ? { ref: `${w.issue.repo}#${w.issue.number}`, state: p.issue ? p.issue.state : 'unknown', labels: p.issue ? (p.issue.labels || []).map((l) => l.name) : [], lastComments: p.comments.map((c) => `${(c.user && c.user.login) || '?'}: ${String(c.body || '').slice(0, 400)}`) } : null,
            commitsMentioningIssue: commits, filesNamed: paths.length, filesMissing: missing
        };
        p.commits = commits; p.missing = missing;
    }
    const others = held.slice(0, 60).map((w) => `#${w.id} ${w.title}${w.issue ? ` (${w.issue.repo}#${w.issue.number})` : ''}`);
    const counts = {};
    let asked = 0; let failedBatches = 0;
    for (let i = 0; i < picked.length; i += WAIT_BATCH) {
        const batch = picked.slice(i, i + WAIT_BATCH);
        let out = null;
        try { out = await ask(WAIT_SYSTEM, JSON.stringify({ items: batch.map((p) => p.ev), allWaitingItems: others })); asked += 1; } catch (e) { failedBatches += 1; findings.push(F(`The Supervisor's engine could not check #${batch.map((p) => p.w.id).join(', #')} (${e.message}); they are checked next run`, 'warn')); continue; }
        const byId = new Map(((out && Array.isArray(out.verdicts)) ? out.verdicts : []).map((v) => [Number(v && v.id), v]));
        for (const p of batch) {
            const v = byId.get(p.w.id);
            if (!v) { findings.push(F(`#${p.w.id}: the Supervisor gave no verdict; checked next run`)); continue; }
            const verdict = WAIT_VERDICTS.includes(v.verdict) ? v.verdict : 'unclear';
            const check = {
                verdict, evidence: String(v.evidence || '').slice(0, 600), at: Date.now(), issueUpdatedAt: p.issue ? p.issue.updated_at || null : null,
                suggestedBrief: verdict === 'outdated' ? String(v.suggestedBrief || '').slice(0, 20000) : '', duplicateOf: verdict === 'duplicate' ? String(v.duplicateOf || '').slice(0, 80) : '',
                commits: p.commits, filesMissing: p.missing
            };
            counts[verdict] = (counts[verdict] || 0) + 1;
            if (!ctx.dryRun) { try { sp.setWork(p.w.id, { check_json: JSON.stringify(check), message: `Check: ${verdict}${check.evidence ? ` - ${check.evidence.slice(0, 120)}` : ''}` }); } catch (e) { findings.push(F(`#${p.w.id}: the verdict could not be stored (${e.message})`, 'warn')); } }
            if (verdict !== 'valid') findings.push(F(`#${p.w.id} "${p.w.title}": ${verdict}${check.duplicateOf ? ` of ${check.duplicateOf}` : ''} - ${check.evidence}`));
            // done is done (Yukimi, Nov 26 2026): a waiting item the evidence shows finished closes with its issue, a duplicate
            // closes pointing at the item that covers it; outdated and unclear stay for the queue
            if (!ctx.dryRun && (verdict === 'done' || verdict === 'duplicate') && typeof sp.closeWorkAsDone === 'function') {
                const why = verdict === 'done' ? `already done - ${check.evidence}` : `duplicate of ${check.duplicateOf} - ${check.evidence}`;
                try { await sp.closeWorkAsDone(p.w.id, { evidence: why, by: 'maintenance check' }); counts.closed = (counts.closed || 0) + 1; } catch (e) { findings.push(F(`#${p.w.id}: could not close (${e.message})`, 'warn')); }
            }
        }
    }
    if (!ctx.dryRun && picked.length && !failedBatches) { try { sp.emitChange(); } catch (_) { /* no listeners */ } }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const parts = WAIT_VERDICTS.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`);
    return makeCheck('waiting', failedBatches ? 'warn' : 'ok', `${held.length} waiting; ${total} checked${parts.length ? ` (${parts.join(', ')})` : ''}, ${skipped} checked recently${closed ? `, ${closed} with a closed issue` : ''}${ctx.dryRun ? ' (dry run: nothing written)' : ''}`, actions, findings, { counts });
}

// ---------------------------------------------------------------- the run

/**
 * Fleet's own records (Yukimi, Nov 24 2026: "also do cleanout in maintenance"): Supervisor reviews over 30 days (dismissed
 * and resolved ones over 15), acknowledged usage flags over 30 days and any over 60, activity rows over 30 days, the
 * Supervisor's call log over 90 days, task lists of sessions quiet for 30 days. Counts only in a dry run.
 */
async function checkCleanup(ctx) {
    const d = (ctx.db || require('./agentCoord/store').open)();
    const now = ctx.now || Date.now();
    const has = (t) => !!d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    const cols = (t) => new Set(d.prepare(`PRAGMA table_info(${t})`).all().map((x) => x.name));
    const jobs = [
        ['old reviews', 'supervisor_reviews', 'at < ?', [now - 30 * DAY]],
        ['settled reviews', 'supervisor_reviews', 'dismissed = 1 AND at < ?', [now - 15 * DAY]],
        ['acknowledged usage flags', 'usage_flags', 'ack_at IS NOT NULL AND last_seen < ?', [now - 30 * DAY]],
        ['old usage flags', 'usage_flags', 'last_seen < ?', [now - 60 * DAY]],
        ['activity rows', 'activity', 'ts < ?', [now - 30 * DAY]],
        ['Supervisor call log rows', 'supervisor_usage', 'at < ?', [now - 90 * DAY]],
        ['task list items of quiet sessions', 'session_tasks', 'updated_at < ?', [now - 30 * DAY]]
    ];
    const actions = [];
    let total = 0;
    for (const [label, table, where, args] of jobs) {
        if (!has(table)) continue;
        const need = where.match(/[a-z_]+(?= [<=I])/g) || [];
        if (need.some((c) => !cols(table).has(c))) continue;
        const n = d.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get(...args).n;
        if (!n) continue;
        if (!ctx.dryRun) d.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...args);
        actions.push(`${ctx.dryRun ? 'Would remove' : 'Removed'} ${n} ${label}`);
        total += n;
    }
    return makeCheck('cleanup', 'ok', total ? `${total} old record(s) ${ctx.dryRun ? 'to remove' : 'removed'}` : 'Nothing old to remove', actions, []);
}

const RUNNERS = { workfolders: checkWorkfolders, worktrees: checkWorktrees, branches: checkBranches, prs: checkPrs, errors: checkErrors, disk: checkDisk, thermals: checkThermals, sessions: checkSessions, waiting: checkWaiting, usage: (ctx) => require('./claudeUsageAudit').checkUsage(ctx), cleanup: checkCleanup };
const RANK = { ok: 0, skipped: 0, warn: 1, fail: 2 };

function overall(checks) { return checks.reduce((w, c) => (RANK[c.state] > RANK[w] ? c.state : w), 'ok'); }

/** One full run. opts: { trigger, dryRun, ctx (test overrides: repos, yz, sup, errorLog, liveCwds, ...), gr } */
async function execute(opts = {}) {
    const g = opts.gr || gResources;
    const s = opts.settings || settings(g);
    const ctx = Object.assign({ gr: g, settings: s, dryRun: opts.dryRun !== undefined ? opts.dryRun === true : s.dryRun }, opts.ctx || {});
    if (!ctx.yozoraRepos) { try { ctx.yozoraRepos = sup().settings(g).yozoraRepos || []; } catch (_) { ctx.yozoraRepos = []; } }
    if (ctx.yz === undefined) { try { ctx.yz = yzMod(); } catch (_) { ctx.yz = null; } }
    const startedAt = Date.now();
    const ids = CHECK_IDS.filter((id) => (opts.only ? opts.only.includes(id) : true));
    const checks = [];
    const prog = running; // set by runNow; a direct call (tests, scripts) has no progress to push
    if (prog) { Object.assign(prog, { startedAt, current: '', done: [], total: ids.length, trigger: opts.trigger || 'manual', dryRun: ctx.dryRun }); changed(); }
    for (const id of ids) {
        if (!s.checks[id]) { checks.push(makeCheck(id, 'skipped', 'Turned off in the settings')); if (prog) prog.done.push(id); continue; }
        if (prog) { prog.current = id; changed(); }
        const t0 = Date.now();
        try {
            const r = await Promise.race([RUNNERS[id](ctx), new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('timed out after 10 minutes')), 10 * 60 * 1000); if (t.unref) t.unref(); })]);
            r.ms = Date.now() - t0;
            checks.push(r);
        } catch (e) {
            checks.push(makeCheck(id, 'fail', `The check failed: ${e.message}`, [], [F(String(e.stack || e.message).split('\n').slice(0, 4).join(' | '), 'warn')], { ms: Date.now() - t0 }));
        }
        if (prog) { prog.done.push(id); changed(); }
    }
    const state = overall(checks);
    const bad = checks.filter((c) => c.state === 'warn' || c.state === 'fail');
    const report = {
        id: null, startedAt, endedAt: Date.now(), trigger: opts.trigger || 'manual', dryRun: ctx.dryRun, state, checks,
        summary: bad.length ? `${bad.length} of ${checks.length} checks need a look: ${bad.map((c) => c.title).join(', ')}` : `All ${checks.filter((c) => c.state === 'ok').length} checks are fine${ctx.dryRun ? ' (dry run)' : ''}`
    };
    if (opts.store !== false) storeRun(report);
    return report;
}

function notify(report) {
    if (report.state !== 'warn' && report.state !== 'fail') return;
    try {
        const bad = report.checks.filter((c) => c.state === 'warn' || c.state === 'fail');
        // routine: the Supervisor first; the phone only when "maintenance" is switched on in Fleet Manager (#1196)
        require('./fleetNotices').routine('maintenance', {
            id: `fleet-maintenance:${new Date(report.startedAt).toISOString().slice(0, 10)}`,
            title: report.state === 'fail' ? 'Fleet maintenance: something failed' : 'Fleet maintenance: needs a look',
            text: bad.map((c) => `${c.title}: ${c.summary}`).join('\n').slice(0, 600),
            data: { app: 'claudedesk', kind: 'maintenance', runId: report.id }, ttlMs: 2 * DAY
        });
    } catch (e) { console.warn(`[maintenance] notice: ${e.message}`); }
}

/** Starts a run in the background; answers at once. The result arrives through the status push (onChange). */
function runNow(opts = {}) {
    if (running) return { started: false, running: true };
    running = { startedAt: Date.now(), current: '', done: [], total: CHECK_IDS.length, trigger: opts.trigger || 'manual', dryRun: false };
    const promise = execute(opts).then((report) => { running = null; notify(report); changed(); return report; }).catch((e) => { console.warn(`[maintenance] run: ${e.message}`); running = null; changed(); return null; });
    return { started: true, running: true, promise };
}

// ---------------------------------------------------------------- the daily timer

function nextRunAt(from = Date.now(), time) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || settings().time));
    const d = new Date(from);
    d.setHours(m ? +m[1] : 4, m ? +m[2] : 30, 0, 0);
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    return d.getTime();
}

function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (process.env.FLEET_MAINTENANCE_OFF) return;
    const s = settings();
    if (!s.enabled) return;
    timer = setTimeout(() => {
        timer = null;
        const r = runNow({ trigger: 'daily' });
        // the next day is armed when the run ends (no polling)
        if (r.started) r.promise.finally(arm); else arm();
    }, Math.max(1000, Math.min(nextRunAt() - Date.now(), 2147000000)));
    if (timer.unref) timer.unref();
}

function bind(gr) { if (gr) gResources = gr; }

function start(gr) {
    bind(gr);
    if (process.env.FLEET_MAINTENANCE_OFF) return module.exports;
    arm();
    if (settings().catchUp) {
        const last = lastRun();
        if (!last || Date.now() - last.startedAt > 26 * HOUR) { const t = setTimeout(() => runNow({ trigger: 'catch-up' }), 2 * 60 * 1000); if (t.unref) t.unref(); }
    }
    return module.exports;
}
function stop() { if (timer) clearTimeout(timer); timer = null; }

/** What the console shows: the last report, the history, the settings, the next run and the progress of a running one. */
function state(gr) {
    const s = settings(gr);
    let last = null; let hist = [];
    try { last = lastRun(); hist = history(); } catch (e) { console.warn(`[maintenance] state: ${e.message}`); }
    return {
        settings: s, checks: CHECK_IDS.map((id) => ({ id, title: CHECK_TITLES[id] })), nextAt: s.enabled ? nextRunAt(Date.now(), s.time) : null,
        running: running ? Object.assign({}, running, { done: running.done.slice() }) : null, last, history: hist
    };
}

module.exports = {
    start, stop, bind, arm, settings, saveSettings, state, runNow, execute, getRun, history, lastRun, onChange, nextRunAt, CHECK_IDS, DEFAULTS,
    _test: { parseWorktrees, groupErrors, normaliseLine, parseDf, parseDu, parseThermal, parseSensors, parseMeminfo, parseFailedUnits, checkWorktrees, checkBranches, checkErrors, checkPrs, checkWorkfolders, checkDisk, checkThermals, checkSessions, checkWaiting, notify, storeRun, sh }
};
