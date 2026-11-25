#!/usr/bin/env node
'use strict';

// Daily shrine job (#1149): the mechanical half of Yozora's morning tidy-up.
// Prints one JSON report on stdout; every step runs on its own, so a failing step
// shows up as { ok:false, error } and the rest still run.
//
//   node scripts/shrine-job.js [--root <repo>] [--apply] [--no-commit]
//
// Without --apply it only looks (dry run). With --apply it
//   * removes worktrees whose HEAD is fully in origin/main, that are clean and have no live agent lock;
//   * deletes partial downloads and old generation logs (see JUNK); tmp/ otherwise is only measured;
//   * commits and pushes ONLY when every dirty path is on the allow-list (data/shrine/own-paths.json,
//     an array of path prefixes Yozora owns) and the perf checks pass. Anything else is listed in the
//     report and left alone (no-stash-to-pretty-commit: other agents' files are never swept up).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(opt('root', path.join(__dirname, '..')));
const APPLY = flag('apply');
const DAY = 86400000;

function sh(cmd, argv, o = {}) {
    return execFileSync(cmd, argv, { cwd: o.cwd || ROOT, encoding: 'utf8', timeout: o.timeout || 60000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
const git = (argv, o) => sh('git', argv, o).trim();

async function step(name, fn) {
    try { return { step: name, ok: true, ...(await fn()) }; } catch (e) { return { step: name, ok: false, error: String(e.message || e).slice(0, 400) }; }
}

function worktrees() {
    const out = git(['worktree', 'list', '--porcelain']);
    const list = [];
    let cur = null;
    for (const line of out.split('\n')) {
        if (line.startsWith('worktree ')) { cur = { path: line.slice(9) }; list.push(cur); }
        else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5);
        else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
        else if (cur && line === 'detached') cur.detached = true;
        else if (cur && line.startsWith('locked')) cur.locked = true;
    }
    return list;
}

function liveLock(dir) {
    try {
        for (const f of fs.readdirSync(dir)) {
            if (!f.startsWith('.agent-')) continue;
            if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs < 2 * 3600 * 1000) return f;
        }
    } catch (_e) { /* none */ }
    return null;
}

// only agent scratch checkouts are ever removed; opt/ and anything else may be a deployed copy
const HOME = process.env.HOME || '';
const SCRATCH = [`${HOME}/wt/`, `${HOME}/worktrees/`, `${HOME}/.cache/claude-run/`];

function tidyWorktrees() {
    try { git(['fetch', '--quiet', 'origin', 'main'], { timeout: 90000 }); } catch (_e) { /* offline: use what we have */ }
    const removed = [], kept = [];
    for (const wt of worktrees().slice(1)) {
        const why = (() => {
            if (!SCRATCH.some((r) => wt.path.startsWith(r))) return 'not an agent scratch folder (left alone)';
            if (wt.locked) return 'locked';
            if (!wt.head) return 'no HEAD';
            try { git(['merge-base', '--is-ancestor', wt.head, 'origin/main']); } catch (_e) { return 'not in main yet'; }
            if (!fs.existsSync(wt.path)) return null; // dangling record: prune handles it
            if (git(['status', '--porcelain'], { cwd: wt.path })) return 'has uncommitted work';
            const lock = liveLock(wt.path);
            if (lock) return `live agent lock ${lock}`;
            return null;
        })();
        if (why) { kept.push({ path: wt.path, branch: wt.branch || 'detached', why }); continue; }
        if (APPLY) git(['worktree', 'remove', wt.path]); // never --force
        removed.push({ path: wt.path, branch: wt.branch || 'detached' });
    }
    if (APPLY) git(['worktree', 'prune']);
    return { applied: APPLY, removed, kept };
}

// "Trash on the server": temp and partial outputs, never anything under data/ that is user content.
const JUNK = [
    { dir: 'tmp', test: (f) => /\.(part|partial|tmp|crdownload)$/i.test(f) },
    { dir: 'data/tmp', test: (f) => /\.(part|partial|tmp|crdownload)$/i.test(f) },
    { dir: 'logs', test: (f) => /^generation-detailed-.*\.log$/.test(f), days: 14 },
];
function walkFiles(dir, depth = 0, acc = []) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return acc; }
    for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 4) walkFiles(p, depth + 1, acc);
        else if (e.isFile()) acc.push(p);
    }
    return acc;
}
function trash() {
        const hits = [];
    let bytes = 0;
    for (const j of JUNK) {
        const base = path.join(ROOT, j.dir);
        const files = walkFiles(base);
        for (const p of files) {
            let st; try { st = fs.statSync(p); } catch (_e) { continue; }
            if (st.mtimeMs > Date.now() - (j.days || 7) * DAY || !j.test(path.basename(p))) continue;
            hits.push(path.relative(ROOT, p));
            bytes += st.size;
            if (APPLY) { try { fs.unlinkSync(p); } catch (_e) { /* gone */ } }
        }
    }
    // stray downloads in the repo root (untracked archives): named, not deleted
    let strays = [];
    try {
        strays = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter((f) => f && !f.includes('/') && /\.(whl|tar\.gz|zip)$/.test(f));
    } catch (_e) { /* ignore */ }
    return { applied: APPLY, deleted: hits.length, bytes, sample: hits.slice(0, 10), tmpBytes: (() => { try { return Number(sh('du', ['-sB1', path.join(ROOT, 'tmp')]).split('\t')[0]); } catch (_e) { return null; } })(), strays };
}

function disk() {
    const df = sh('df', ['-B1', '--output=source,size,used,avail,pcent', ROOT]).trim().split('\n')[1].trim().split(/\s+/);
    const sizes = {};
    for (const d of ['data', 'logs', 'tmp', 'node_modules', '.git']) {
        try { sizes[d] = Number(sh('du', ['-sB1', path.join(ROOT, d)], { timeout: 120000 }).split('\t')[0]); } catch (_e) { /* missing */ }
    }
    const stateFile = path.join(ROOT, 'data', 'shrine', 'disk.json');
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_e) { /* first run */ }
    const grew = {};
    if (prev && prev.sizes) for (const k of Object.keys(sizes)) if (prev.sizes[k] != null) grew[k] = sizes[k] - prev.sizes[k];
    if (APPLY) {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({ at: new Date().toISOString(), sizes }, null, 1));
    }
    return { fs: { size: +df[1], used: +df[2], avail: +df[3], pct: df[4] }, sizes, grewSincePrevious: grew, previousAt: prev && prev.at };
}

function faults() {
    const dir = path.join(ROOT, 'data', 'fault-reports');
    const since = Date.now() - DAY;
    const rows = [];
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_e) { continue; }
        if (Date.parse(j.lastSeen) >= since) rows.push({ id: j.id, program: j.program && j.program.name, surface: j.surface, error: `${j.errorName}: ${String(j.message).slice(0, 140)}`, count: j.count, status: j.status, firstSeen: j.firstSeen, lastSeen: j.lastSeen });
    }
    rows.sort((a, b) => (b.count || 0) - (a.count || 0));
    return { activeLast24h: rows.length, top: rows.slice(0, 8), newToday: rows.filter((r) => Date.parse(r.firstSeen) >= since).length };
}

function ownPrefixes() {
    try { const a = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'shrine', 'own-paths.json'), 'utf8')); return Array.isArray(a) ? a.map(String) : []; } catch (_e) { return []; }
}

// The dangerous part, narrowed (#1149): commit only what is provably Yozora's, and only when green.
function handIn() {
    const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
    if (!dirty.length) return { dirty: 0, committed: false, note: 'nothing to hand in' };
    const own = ownPrefixes();
    const mine = dirty.filter((p) => own.some((o) => p === o || p.startsWith(o.endsWith('/') ? o : `${o}/`)));
    const foreign = dirty.filter((p) => !mine.includes(p));
    const out = { dirty: dirty.length, mine, foreign: foreign.slice(0, 40), foreignCount: foreign.length, committed: false };
    if (foreign.length) { out.note = 'other agents\' work is in the tree: nothing committed (their files are theirs to commit at the end of their turn)'; return out; }
    if (!own.length) { out.note = 'no allow-listed paths (data/shrine/own-paths.json): nothing committed'; return out; }
    try { sh('node', ['scripts/check-perf-rules.js'], { timeout: 120000 }); sh('node', ['scripts/check-app-scope.js'], { timeout: 120000 }); } catch (e) { out.note = `checks not green, nothing committed: ${String(e.stdout || e.message).slice(-300)}`; return out; }
    if (!APPLY || flag('no-commit')) { out.note = 'dry run: would commit the allow-listed files'; return out; }
    git(['add', '--', ...mine]);
    git(['commit', '-m', 'chore(shrine): daily tidy-up of Yozora-owned files (#1149)\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'], { timeout: 120000 });
    out.committed = true;
    out.commit = git(['rev-parse', '--short', 'HEAD']);
    out.note = 'committed locally; pushing is left to the usual publish path (push-checks: origin/main..HEAD)';
    return out;
}

(async () => {
    const report = { at: new Date().toISOString(), applied: APPLY, root: ROOT, steps: [] };
    report.steps.push(await step('worktrees', async () => tidyWorktrees()));
    report.steps.push(await step('trash', async () => trash()));
    report.steps.push(await step('disk', async () => disk()));
    report.steps.push(await step('faults', async () => faults()));
    report.steps.push(await step('handIn', async () => handIn()));
    report.missing = report.steps.filter((s) => !s.ok).map((s) => `${s.step}: ${s.error}`);
    process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);
})();
