#!/usr/bin/env node
'use strict';

/**
 * #1236 part C: modules/agentSupervisor.js work-folder tracking and git no longer block the Dreamscape event loop.
 *
 *   (a) refreshArtifacts (async, du through spawnHelper) gives the same exists / size values as the old sync stat + execFileSync du
 *   (b) the loop stays free during a refresh of ~50 folders with many files (max setImmediate lag), and during walkEvidence
 *   (c) single-flight: a call while one runs joins it; a change emits { artifacts: true } once, no change emits nothing
 *   (d) artifactStatus: deep-equal with the old per-row implementation, on a read-only COPY of the real coord DB (sqlite3 .backup),
 *       time per call before / after (child process so it has its own AGENT_COORD_DB)
 *   (e) the lock sweep keeps a lock while git's answer is unknown (uncommitted: null), unit decision and sweepLocks with a stubbed inspect
 *   (f) cleanable takes the live cwds as an optional third argument and answers the same
 *
 *   node scripts/test-supervisor-artifacts-async.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const CHILD = process.argv.includes('--real-copy');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sup-art-async-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* leave it */ } });

if (CHILD) {
    process.env.AGENT_COORD_DB = process.argv[process.argv.indexOf('--real-copy') + 1];
} else {
    process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
    process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
    fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });
}
// a scratch inbox: a test must never touch the live one (its rows land on Yukimi's phone as notices, #1196)
process.env.NOTIFICATION_INBOX_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-supervisor-artifacts-async-')), 'notifications.db');
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'supervisor.sock');
process.env.AGENT_SUPERVISOR_NO_REVIVE = '1';

const sup = require('../modules/agentSupervisor');
const store = require('../modules/agentCoord/store');
const spawnHelper = require('../modules/spawnHelper');

// ------------------------------------------------------------ the old (sync) logic, copied as the reference
const HOME = os.homedir();
const expandRef = (p, cwd) => {
    let v = String(p || '');
    if (v.startsWith('~/')) v = path.join(HOME, v.slice(2));
    if (!path.isAbsolute(v)) v = cwd ? path.resolve(cwd, v) : '';
    return v ? path.normalize(v) : '';
};
function duBytesOld(full) {
    try {
        const out = execFileSync('du', ['-sb', full], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
        return Number(out.split(/\s/)[0]) || 0;
    } catch (_) { return null; }
}
function statOld(r) {
    const full = expandRef(r.path, r.cwd);
    let st = null;
    try { st = full ? fs.statSync(full) : null; } catch (_) { st = null; }
    return { exists: st ? 1 : 0, size: st ? (st.isDirectory() ? duBytesOld(full) : st.size) : null };
}
/** The old artifactStatus: cleanable asked per row without the live list (it lists the sessions itself every time). */
function artifactStatusOld() {
    const lockAgentId = (sid) => `claude-${String(sid).slice(0, 8)}`;
    const live = new Map();
    try { require('../modules/claudeSessions').liveSessions().forEach((x) => live.set(x.id, x)); } catch (_) { /* none */ }
    const rows = store.open().prepare('SELECT * FROM artifacts WHERE forgotten = 0 ORDER BY created_at DESC LIMIT 300').all();
    const names = new Map();
    return rows.map((r) => {
        const full = expandRef(r.path, r.cwd);
        if (!names.has(r.session_id)) { const a = store.getAgent(lockAgentId(r.session_id)); names.set(r.session_id, (a && a.name) || r.session_id.slice(0, 8)); }
        const exists = r.exists_now === null ? null : !!r.exists_now;
        const trashed = r.decision === 'trashed' && !!r.trash_path;
        const state = trashed ? 'trashed' : (exists === false ? 'gone' : (live.has(r.session_id) ? 'live' : 'orphan'));
        return {
            id: r.id, path: full || r.path, kind: r.kind, sessionId: r.session_id, agentName: names.get(r.session_id), createdAt: r.created_at, cmd: r.cmd,
            exists, sizeBytes: r.size_bytes, checkedAt: r.checked_at, ageHours: Math.round((Date.now() - r.created_at) / 3600000), state,
            cleanable: exists !== false && state !== 'live' && sup._test.cleanable(full, r.kind),
            decision: r.decision || '', decisionReason: r.decision_reason || '', decidedAt: r.decided_at || null, trashPath: r.trash_path || '', canRestore: trashed
        };
    });
}

// ------------------------------------------------------------ helpers
const T0 = (fn) => { const t = process.hrtime.bigint(); const r = fn(); return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 }; };
/** Runs fn() while measuring the largest gap between two turns of the event loop (setImmediate chain). */
async function withLoopLag(fn) {
    let max = 0;
    let stop = false;
    let last = process.hrtime.bigint();
    const tick = () => {
        const now = process.hrtime.bigint();
        max = Math.max(max, Number(now - last) / 1e6);
        last = now;
        if (!stop) setImmediate(tick);
    };
    setImmediate(tick);
    const t = process.hrtime.bigint();
    const value = await fn();
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    stop = true;
    await new Promise((r) => setImmediate(r));
    return { value, maxLagMs: max, ms };
}
let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${String(e.stack || e).split('\n').slice(0, 6).join('\n     ')}`); }
}
const insertRow = (sid, p, kind, extra = {}) => store.open().prepare('INSERT INTO artifacts (session_id, path, kind, created_at, cmd, cwd) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sid, p, kind, extra.createdAt || Date.now() - 3 * 3600000, extra.cmd || 'mkdir x', extra.cwd || '').lastInsertRowid;

// ------------------------------------------------------------ child: (d) on a copy of the real coord DB
async function childMain() {
    const rows = store.open().prepare('SELECT COUNT(*) n FROM artifacts WHERE forgotten = 0').get().n;
    // the live session list is cached between calls; warm it so the timing compares the per-row work, not the first parse
    sup.artifactStatus(); artifactStatusOld();
    const N = 5;
    const timeIt = (fn) => { let best = Infinity; let tot = 0; for (let i = 0; i < N; i += 1) { const { ms } = T0(fn); best = Math.min(best, ms); tot += ms; } return { best, avg: tot / N }; };
    const before = timeIt(artifactStatusOld);
    const after = timeIt(() => sup.artifactStatus());
    const a = JSON.parse(JSON.stringify(sup.artifactStatus()));
    const b = JSON.parse(JSON.stringify(artifactStatusOld()));
    a.forEach((x) => { delete x.ageHours; }); b.forEach((x) => { delete x.ageHours; }); // hour rounding may tick between the two calls
    assert.deepStrictEqual(a, b, 'artifactStatus output differs from the old implementation');
    console.log(JSON.stringify({ rows, shown: a.length, cleanable: a.filter((x) => x.cleanable).length, beforeMs: before, afterMs: after }));
}

// ------------------------------------------------------------ main
async function main() {
    spawnHelper.warm();
    await new Promise((r) => setTimeout(r, 300));

    // (a) same exists / size values as the old sync code
    const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
    const big = path.join(tmp, 'work');
    fs.mkdirSync(big, { recursive: true });
    const folders = [];
    for (let i = 0; i < 50; i += 1) {
        const d = path.join(big, `f${i}`);
        fs.mkdirSync(path.join(d, 'sub'), { recursive: true });
        const files = i % 10 === 0 ? 600 : (i % 3 === 0 ? 120 : 5);
        for (let j = 0; j < files; j += 1) fs.writeFileSync(path.join(d, j % 2 ? 'sub' : '', `n${j}.txt`), 'x'.repeat((i * 31 + j) % 700));
        folders.push(d);
    }
    const lone = path.join(big, 'one.bin'); fs.writeFileSync(lone, Buffer.alloc(12345));
    const rowsIn = [];
    folders.forEach((d) => rowsIn.push({ id: insertRow(SID, d, 'dir'), path: d, cwd: '' }));
    rowsIn.push({ id: insertRow(SID, lone, 'file'), path: lone, cwd: '' });
    rowsIn.push({ id: insertRow(SID, path.join(big, 'missing'), 'dir'), path: path.join(big, 'missing'), cwd: '' });
    rowsIn.push({ id: insertRow(SID, 'rel/dir', 'dir', { cwd: big }), path: 'rel/dir', cwd: big }); // relative to its cwd, absent
    rowsIn.push({ id: insertRow(SID, 'relf/a', 'file', { cwd: big }), path: 'relf/a', cwd: big });
    fs.mkdirSync(path.join(big, 'relf')); fs.writeFileSync(path.join(big, 'relf', 'a'), 'abc');
    rowsIn.push({ id: insertRow(SID, '', 'dir'), path: '', cwd: '' }); // no path at all

    const events = [];
    const off = sup.onReview((e) => events.push(e));
    let first = null;
    await test('(a) refreshArtifacts gives the same exists / size values as the old sync stat + du', async () => {
        const expected = new Map(rowsIn.map((r) => [r.id, statOld(r)]));
        const res = await withLoopLag(() => sup.refreshArtifacts({ budgetMs: 20000 }));
        first = res;
        const got = store.open().prepare('SELECT id, exists_now, size_bytes, checked_at FROM artifacts').all();
        assert.strictEqual(got.length, rowsIn.length);
        got.forEach((g) => {
            const e = expected.get(g.id);
            assert.strictEqual(g.exists_now, e.exists, `exists row ${g.id}`);
            assert.strictEqual(g.size_bytes, e.size, `size row ${g.id}`);
            assert.ok(g.checked_at > 0);
        });
        assert.strictEqual(res.value.checked, rowsIn.length);
        assert.ok(res.value.changed > 0);
        console.log(`     ${rowsIn.length} rows (${folders.length} folders, ~${folders.reduce((n, d) => n + fs.readdirSync(d).length, 0)} top entries) refreshed in ${res.ms.toFixed(0)} ms`);
        // the row selection is unchanged: a second pass right away finds nothing stale
        const again = await sup.refreshArtifacts({ budgetMs: 20000 });
        assert.strictEqual(again.checked, 0, 'rows checked in the last 10 minutes are not selected again');
    });

    await test('(b) the event loop is never blocked long during a refresh of ~50 folders', async () => {
        // make every row stale again, then refresh and measure the largest loop gap
        store.open().prepare('UPDATE artifacts SET checked_at = ?').run(Date.now() - 3600 * 1000);
        const sync = T0(() => rowsIn.forEach((r) => statOld(r)));
        const res = await withLoopLag(() => sup.refreshArtifacts({ budgetMs: 20000 }));
        console.log(`     async refresh: ${res.ms.toFixed(0)} ms total, max event loop lag ${res.maxLagMs.toFixed(1)} ms (the old sync loop would block ${sync.ms.toFixed(0)} ms)`);
        assert.strictEqual(res.value.checked, rowsIn.length);
        assert.ok(res.maxLagMs < 50, `max loop lag ${res.maxLagMs} ms`);
        // first refresh above, measured with the helper just warmed
        console.log(`     first refresh: max event loop lag ${first.maxLagMs.toFixed(1)} ms`);
        assert.ok(first.maxLagMs < 50, `first refresh lag ${first.maxLagMs} ms`);
    });

    await test('(b2) walkEvidence yields every ~500 entries (same evidence, no long sync burst)', async () => {
        const root = path.join(tmp, 'walk');
        for (let i = 0; i < 40; i += 1) { fs.mkdirSync(path.join(root, `d${i}`), { recursive: true }); for (let j = 0; j < 250; j += 1) fs.writeFileSync(path.join(root, `d${i}`, `f${j}`), 'y'); }
        fs.writeFileSync(path.join(root, 'd3', '.agent-claude-12345678'), 'x');
        fs.symlinkSync('/etc', path.join(root, 'd4', 'lnk'));
        const res = await withLoopLag(() => sup._test.walkEvidence(root));
        const ev = res.value;
        assert.strictEqual(ev.files, 40 * 250 + 1, JSON.stringify(ev));
        assert.strictEqual(ev.truncated, false);
        assert.strictEqual(ev.symlinks, 1);
        assert.deepStrictEqual(ev.locks.map((l) => path.relative(root, l)), ['d3/.agent-claude-12345678']);
        assert.ok(ev.newestMtimeMs > 0);
        console.log(`     walkEvidence of ${ev.files} files: ${res.ms.toFixed(0)} ms, max loop lag ${res.maxLagMs.toFixed(1)} ms`);
        assert.ok(res.maxLagMs < 100, `walk lag ${res.maxLagMs}`);
        const capped = await sup._test.walkEvidence(root, 1500, 300);
        assert.ok(capped.truncated && capped.files >= 300 && capped.files < 10001, 'the file cap still truncates');
    });

    await test('(c) single-flight: a call while one runs joins it; a changed row emits artifacts once, a quiet pass emits nothing', async () => {
        store.open().prepare('UPDATE artifacts SET checked_at = ?').run(Date.now() - 3600 * 1000);
        events.length = 0;
        const p1 = sup.refreshArtifacts({ budgetMs: 20000 });
        const p2 = sup.refreshArtifacts({ budgetMs: 1 });
        assert.strictEqual(p1, p2, 'the second call joins the running refresh');
        const other = sup.refreshArtifacts({ sessionId: SID });
        assert.notStrictEqual(other, p1, 'another scope (one session) runs on its own');
        await Promise.all([p1, other]);
        assert.strictEqual(events.filter((e) => e && e.artifacts).length, 0, 'nothing changed: no event');
        const p3 = sup.refreshArtifacts({ budgetMs: 20000 });
        assert.notStrictEqual(p3, p1, 'a finished refresh is not joined');
        await p3;
        // a folder that grew: one pass, one event
        fs.writeFileSync(path.join(folders[7], 'grown.bin'), Buffer.alloc(9999));
        store.open().prepare('UPDATE artifacts SET checked_at = ?').run(Date.now() - 3600 * 1000);
        events.length = 0;
        const r = await sup.refreshArtifacts({ budgetMs: 20000 });
        assert.strictEqual(r.changed, 1, JSON.stringify(r));
        assert.strictEqual(events.filter((e) => e && e.artifacts).length, 1, JSON.stringify(events));
        const row = store.open().prepare('SELECT size_bytes FROM artifacts WHERE path = ?').get(folders[7]);
        assert.strictEqual(row.size_bytes, duBytesOld(folders[7]));
        // the budget is honoured: a 0 ms budget checks (almost) nothing and still resolves
        store.open().prepare('UPDATE artifacts SET checked_at = ?').run(Date.now() - 3600 * 1000);
        const b = await sup.refreshArtifacts({ budgetMs: 1 });
        assert.ok(b.checked < rowsIn.length, `a 1 ms budget stops early (checked ${b.checked})`);
        // a row whose decision changed while it was measured is not overwritten (Clean wrote its own exists / size)
        store.open().prepare('UPDATE artifacts SET checked_at = NULL, exists_now = 0, size_bytes = NULL').run();
        const target = rowsIn[0].id;
        const pr = sup.refreshArtifacts({ budgetMs: 20000 });
        store.open().prepare("UPDATE artifacts SET decision = 'trashed', exists_now = 0 WHERE id = ?").run(target);
        await pr;
        assert.strictEqual(store.open().prepare('SELECT exists_now FROM artifacts WHERE id = ?').get(target).exists_now, 0, 'a row decided during the refresh keeps the decision\'s values');
        store.open().prepare("UPDATE artifacts SET decision = '' WHERE id = ?").run(target);
    });
    off();

    await test('(f) cleanable: the live cwds as an optional third argument change nothing', async () => {
        const live = require('../modules/claudeSessions').liveSessions().map((x) => x.cwd).filter(Boolean).map((c) => path.normalize(c));
        const probes = [
            [os.tmpdir() + '/zzz-a/b', 'dir'], ['/tmp/a', 'dir'], ['/tmp/x/y', 'dir'], ['/', 'dir'], [HOME, 'dir'], [path.join(HOME, '.cache', 'foo', 'bar'), 'dir'],
            [path.join(__dirname, '..'), 'dir'], [path.join(tmp, 'work', 'f1'), 'dir'], ['/var/tmp/q/w', 'worktree'], ['relative/path', 'dir'], ['', 'dir']
        ].concat(live.map((c) => [c, 'dir']), live.map((c) => [path.join(c, 'sub'), 'dir']), live.map((c) => [path.dirname(c), 'dir']));
        probes.forEach(([p, k]) => assert.strictEqual(sup._test.cleanable(p, k, live), sup._test.cleanable(p, k), `${p} ${k}`));
        // a live session under /tmp: a folder above it or equal to it is never cleanable; the passed list decides
        assert.strictEqual(sup._test.cleanable('/tmp/live-one/work', 'dir', ['/tmp/live-one/work/deep']), false);
        assert.strictEqual(sup._test.cleanable('/tmp/live-one/work', 'dir', ['/tmp/other/x']), true);
        assert.strictEqual(sup._test.cleanable('/tmp/live-one/work', 'dir', []), true, 'an empty list is a list (no live sessions), not "ask again"');
    });

    await test('(e) the lock sweep keeps a lock while git is unknown (uncommitted: null) and removes only on a known clean answer', async () => {
        const mk = (uncommitted, files, claims = []) => ({ agent: { cwd: '/x' }, claims, edited: { total: files.length, files }, uncommitted });
        const known = { count: 0, files: [] };
        assert.strictEqual(sup._test.lockRemovable(mk(null, [])), false, 'unknown, no files: keep');
        assert.strictEqual(sup._test.lockRemovable(mk(null, [{ path: 'a', via: 'tool', uncommitted: null }])), false, 'unknown, files unknown: keep');
        assert.strictEqual(sup._test.lockRemovable(mk(known, [{ path: 'a', via: 'tool', uncommitted: false }])), true, 'known clean: remove');
        assert.strictEqual(sup._test.lockRemovable(mk(known, [{ path: 'a', via: 'tool', uncommitted: true }])), false, 'known dirty: keep');
        assert.strictEqual(sup._test.lockRemovable(mk(known, [], [{ id: 1 }])), false, 'a claim keeps it');
        assert.strictEqual(sup._test.lockRemovable(null), false, 'no inspect answer: keep');
        assert.strictEqual(sup._test.lockRemovable({ agent: { cwd: '' }, claims: [], edited: { files: [] }, uncommitted: null }), true, 'an agent with no folder has nothing git could say (old behaviour)');
        assert.strictEqual(sup._test.hasUncommitted(mk(null, [{ path: 'a', via: 'tool', uncommitted: true }])), false, 'unknown plants nothing');
        assert.strictEqual(sup._test.hasUncommitted(mk(known, [{ path: 'a', via: 'tool', uncommitted: true }])), true);

        // sweepLocks end to end with a stubbed inspect: an idle session with a lock, git unknown then known
        const repo = path.join(tmp, 'lockrepo');
        fs.mkdirSync(repo, { recursive: true });
        execFileSync('git', ['init', '-q', repo]);
        const LS = 'bbbbbbbb-1111-2222-3333-444444444444';
        fs.writeFileSync(path.join(tmp, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: LS, status: 'idle', cwd: repo, updatedAt: Date.now() - 3 * 3600 * 1000 }));
        store.upsertAgent({ id: 'claude-bbbbbbbb', kind: 'claude', name: 'Idle', sessionId: LS, cwd: repo, repo: 'lockrepo', pid: process.pid });
        store.plantLock('claude-bbbbbbbb', repo, 'working');
        const lock = path.join(repo, '.agent-claude-bbbbbbbb');
        assert.ok(fs.existsSync(lock));
        const real = store.inspect;
        let answer = null;
        store.inspect = (ref, o) => { const r = real(ref, o); return answer ? Object.assign({}, r, answer) : r; };
        try {
            answer = { uncommitted: null, edited: { total: 0, files: [] }, claims: [] };
            assert.deepStrictEqual((await sup.sweepLocks(LS)).filter((c) => c.removed), [], 'unknown: the lock stays');
            assert.ok(fs.existsSync(lock));
            answer = { uncommitted: { count: 1, files: [] }, edited: { total: 1, files: [{ path: 'a.js', via: 'tool', uncommitted: true }] }, claims: [] };
            assert.deepStrictEqual((await sup.sweepLocks(LS)).filter((c) => c.removed), [], 'own file uncommitted: the lock stays');
            answer = { uncommitted: { count: 0, files: [] }, edited: { total: 1, files: [{ path: 'a.js', via: 'tool', uncommitted: false }] }, claims: [] };
            const done = await sup.sweepLocks(LS);
            assert.ok(done.some((c) => c.removed === '.agent-claude-bbbbbbbb'), JSON.stringify(done));
            assert.ok(!fs.existsSync(lock), 'known clean: removed');
            // plant branch: unknown plants nothing, known dirty plants
            answer = { uncommitted: null, edited: { total: 1, files: [{ path: 'a.js', via: 'tool', uncommitted: null }] }, claims: [] };
            assert.deepStrictEqual((await sup.sweepLocks(LS)).filter((c) => c.planted), [], 'unknown: nothing planted this round');
            assert.ok(!fs.existsSync(lock));
            answer = { uncommitted: { count: 1, files: [] }, edited: { total: 1, files: [{ path: 'a.js', via: 'tool', uncommitted: true }] }, claims: [] };
            assert.ok((await sup.sweepLocks(LS)).some((c) => c.planted === '.agent-claude-bbbbbbbb'), 'known dirty: planted');
        } finally { store.inspect = real; }
    });

    await test('(g) git evidence, lsof and the collision git calls run through the helper and keep their answers', async () => {
        const repo = path.join(tmp, 'gitrepo');
        fs.mkdirSync(repo, { recursive: true });
        execFileSync('git', ['init', '-q', repo]);
        assert.strictEqual(await sup._test.gitEvidence(path.join(tmp, 'work')), null, 'no .git: null');
        const ev = await sup._test.gitEvidence(repo);
        assert.ok(ev && ev.statusOk === true && Array.isArray(ev.dirty));
        fs.writeFileSync(path.join(repo, 'f.txt'), '1');
        assert.deepStrictEqual((await sup._test.gitEvidence(repo)).dirty, ['?? f.txt']);
        const users = await sup._test.openUsers(path.join(tmp, 'work', 'f1'));
        assert.ok(users === null || Array.isArray(users), 'lsof answers a list, or null when it is not installed / times out');
        const fd = fs.openSync(path.join(tmp, 'work', 'f2', 'n0.txt'), 'r');
        try {
            const u2 = await sup._test.openUsers(path.join(tmp, 'work', 'f2'));
            if (u2 !== null) assert.ok(u2.length === 0, 'our own pid is not counted'); // this process holds it: filtered
        } finally { fs.closeSync(fd); }
    });

    if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
}

if (CHILD) {
    childMain().then(() => process.exit(0), (e) => { console.error(e.stack || e); process.exit(1); });
} else {
    (async () => {
        await main();
        await test('(d) artifactStatus: deep-equal with the old implementation on a read-only copy of the real coord DB; time per call before / after', async () => {
            const real = path.join(os.homedir(), '.local', 'state', 'dreamscape-agents', 'coord.db');
            if (!fs.existsSync(real)) { console.log('     (no real coord DB here: skipped)'); return; }
            const copy = path.join(tmp, 'real-copy.db');
            execFileSync('sqlite3', [real, `.backup '${copy}'`], { timeout: 60000 });
            const env = Object.assign({}, process.env);
            delete env.DREAMSCAPE_CLAUDE_HOME; // the real live sessions
            const out = execFileSync(process.execPath, [__filename, '--real-copy', copy], { env, encoding: 'utf8', timeout: 120000 });
            const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
            const r = JSON.parse(line);
            console.log(`     real DB copy: ${r.rows} live rows, ${r.shown} shown, ${r.cleanable} cleanable; artifactStatus per call before ${r.beforeMs.avg.toFixed(1)} ms (best ${r.beforeMs.best.toFixed(1)}), after ${r.afterMs.avg.toFixed(1)} ms (best ${r.afterMs.best.toFixed(1)})`);
        });
        if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
        console.log('\nall passed');
        process.exit(0);
    })().catch((e) => { console.error(e.stack || e); process.exit(1); });
}
