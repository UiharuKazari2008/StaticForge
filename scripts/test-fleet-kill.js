#!/usr/bin/env node
'use strict';

/**
 * modules/fleetKill.js: Stop on a work item. Process, tmux and Supervisor calls are injected (fake process table, fake clock), the
 * coordination store is a temp DB, git and node --check are real on a temp repo.
 *
 *   node scripts/test-fleet-kill.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-kill-'));
process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');
process.env.FLEET_CANCELLED_DIR = path.join(tmp, 'cancelled');
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* gone */ } });

const store = require('../modules/agentCoord/store');
const kill = require('../modules/fleetKill');

let failed = 0;
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 8).join('\n     ')}`); }
}
const run = (cmd, args, opts) => new Promise((res) => execFile(cmd, args, Object.assign({ maxBuffer: 8 * 1024 * 1024 }, opts || {}), (error, stdout, stderr) => res({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) })));

const S1 = 'aaaaaaaa-1111-2222-3333-444444444444';
const S2 = 'bbbbbbbb-1111-2222-3333-444444444444';

/** A fake Supervisor side that records what was done. */
function fakeSup(parts) {
    const log = { marks: [], holds: [], waits: [], reviews: [], enqueued: [], comments: [] };
    return {
        log,
        sup: () => ({
            parts: (id) => parts[id] || [],
            mark: (id, f) => log.marks.push([id, f]),
            endHolds: (sid) => { log.holds.push(sid); return 1; },
            endWaits: (wid, sid) => { log.waits.push([wid, sid]); return 1; },
            dropReviews: (sid) => { log.reviews.push(sid); return 2; },
            ownDirs: () => [],
            enqueue: (i) => { log.enqueued.push(i); return { id: 900 }; },
            comment: (w, t) => log.comments.push([w, t])
        })
    };
}

/** Fake processes: 1000 (claude S1) > 1001 > 1002 (ignores SIGTERM); 2000 (claude S2) > 2001. 5000 is the "server". */
function fakeProcs() {
    const alive = new Set([1000, 1001, 1002, 2000, 2001, 5000, 7000]);
    const kidsMap = new Map([[1000, [1001]], [1001, [1002]], [2000, [2001]], [5000, [5001]]]);
    const parent = new Map([[1001, 1000], [1002, 1001], [2001, 2000], [1000, 1], [2000, 1], [5000, 1], [7000, 1]]);
    const signals = [];
    let clock = 0;
    return {
        alive, signals,
        deps: {
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
            sessions: () => [{ id: S1, pid: 1000, cwd: '/x', tmuxSession: 'rc-aaaaaaaa' }, { id: S2, pid: 2000, cwd: '/x', tmuxSession: 'rc-bbbbbbbb' }],
            proc: async () => ({ parent, kids: kidsMap }),
            alive: (p) => alive.has(p),
            signal: (p, sig) => { signals.push([p, sig]); if (sig === 'SIGKILL' || p !== 1002) alive.delete(p); return true; },
            cwdOf: async () => '',
            cmdlineOf: async () => ''
        }
    };
}

(async () => {
    await test('a running item with a child part: both trees get SIGTERM then SIGKILL, tmux killed, everything released, item held (then hold)', async () => {
        const agent1 = `claude-${S1.slice(0, 8)}`;
        store.upsertAgent({ id: agent1, kind: 'claude', name: 'one', sessionId: S1, cwd: tmp });
        store.claim(agent1, 'repo', ['a.js']);
        const d = store.open();
        d.prepare("INSERT INTO builds (target, repo, requested_by, note, state, created_at, expires_at) VALUES ('app', 'repo', ?, '', 'open', ?, ?)").run(agent1, Date.now(), Date.now() + 60000);
        const gateId = d.prepare('SELECT id FROM builds').get().id;
        const procs = fakeProcs();
        const sup = fakeSup({ 7: [{ id: 8, session_id: S2, state: 'running', topology: 'direct' }, { id: 9, session_id: null, state: 'queued', topology: 'direct' }] });
        const tmuxCalls = [];
        const leases = [];
        const item = { id: 7, sessionId: S1, state: 'running', topology: 'surfaces', startedAt: 0, cwd: tmp };
        const r = await kill.killWork(item, {
            by: 'Fleet', then: 'hold',
            deps: Object.assign({}, procs.deps, sup, {
                tmux: async (args) => { tmuxCalls.push(args.join(' ')); return { code: 0 }; },
                deviceQueue: () => ({ releaseAgent: (a) => { leases.push(a); return 1; } })
            })
        });
        const termed = procs.signals.filter((s) => s[1] === 'SIGTERM').map((s) => s[0]).sort();
        assert.deepStrictEqual(termed, [1000, 1001, 1002, 2000, 2001], 'every process of both trees is TERMed');
        assert.deepStrictEqual(procs.signals.filter((s) => s[1] === 'SIGKILL').map((s) => s[0]), [1002], 'only the survivor is KILLed');
        assert.ok(procs.signals.findIndex((s) => s[1] === 'SIGKILL') > procs.signals.findIndex((s) => s[1] === 'SIGTERM'));
        assert.ok(!procs.signals.some((s) => s[0] === 5000 || s[0] === 5001 || s[0] === 7000), 'the server and other processes are never touched');
        assert.deepStrictEqual(r.killed.map((k) => k.sessionId).sort(), [S1, S2]);
        assert.ok(tmuxCalls.includes('kill-session -t =rc-aaaaaaaa') && tmuxCalls.includes('kill-session -t =rc-bbbbbbbb'), tmuxCalls.join('|'));
        assert.deepStrictEqual(r.stuck, []);
        assert.strictEqual(store.liveClaims({ agentId: agent1 }).length, 0, 'claims released');
        assert.ok(r.released.claims >= 1);
        assert.deepStrictEqual(leases.sort(), [agent1, `claude-${S2.slice(0, 8)}`].sort(), 'device leases released');
        assert.deepStrictEqual(r.released.gates, [gateId]);
        const g = d.prepare('SELECT state, result FROM builds WHERE id = ?').get(gateId);
        assert.strictEqual(g.state, 'cancelled');
        assert.strictEqual(g.result, 'cancelled: work item 7 was stopped');
        assert.deepStrictEqual(sup.log.holds.sort(), [S1, S2], 'holds ended');
        assert.strictEqual(sup.log.waits.length, 2, 'waits ended');
        assert.strictEqual(sup.log.reviews.length, 2, 'queued reviews dropped');
        const m = new Map(sup.log.marks);
        assert.strictEqual(m.get(7).state, 'held');
        assert.strictEqual(m.get(7).session_id, null);
        assert.match(m.get(7).message, /^Stopped by Fleet/);
        assert.strictEqual(m.get(8).state, 'cancelled', 'a derived part is cancelled');
        assert.strictEqual(m.get(9).state, 'cancelled');
    });

    await test('then delete: the item is cancelled for good with ended_at', async () => {
        const procs = fakeProcs();
        const sup = fakeSup({});
        await kill.killWork({ id: 11, sessionId: S1, state: 'running', cwd: tmp }, { by: 'Yukimi', then: 'delete', deps: Object.assign({}, procs.deps, sup, { tmux: async () => ({ code: 0 }), deviceQueue: () => ({ releaseAgent: () => 0 }) }) });
        const [id, f] = sup.log.marks[0];
        assert.strictEqual(id, 11);
        assert.strictEqual(f.state, 'cancelled');
        assert.ok(f.ended_at >= 0 && 'ended_at' in f);
        assert.strictEqual(f.message, 'Stopped by Yukimi');
    });

    // a temp repo for the damage check
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    const git = (...a) => run('git', ['-C', repo, ...a]);
    await git('init', '-q'); await git('config', 'user.email', 't@t'); await git('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'ok.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(repo, 'bad.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(repo, 'data.json'), '{"a":1}\n');
    await git('add', '.'); await git('commit', '-qm', 'init');
    const damageDeps = (sup) => Object.assign({ git: (root, args) => run('git', ['-C', root, ...args]), run }, sup);
    const result = (files) => ({ itemId: 21, then: 'delete', by: 'Fleet', killed: [{ sessionId: S1, pids: [1, 2], tmux: ['rc-aaaaaaaa'] }], stuck: [], released: { claims: 1, leases: 0, holds: 0, waits: 0, gates: [], reviews: 0 }, files: files.map((p) => ({ sessionId: S1, root: repo, path: p, lastAt: 1 })) });

    await test('damage check: a file failing node --check gets a patch saved and a repair item started; the issue is commented, never closed', async () => {
        fs.writeFileSync(path.join(repo, 'ok.js'), 'module.exports = 2;\n');
        fs.writeFileSync(path.join(repo, 'bad.js'), 'module.exports = {\n'); // half written
        const sup = fakeSup({});
        const r = await kill.damageCheck(result(['ok.js', 'bad.js']), { item: { id: 21, issue: { repo: 'o/r', number: 5 } }, deps: damageDeps(sup) });
        assert.ok(r.patch && fs.existsSync(r.patch), 'patch saved');
        assert.match(r.patch, /21-\d{8}-\d{6}\.patch$/);
        const body = fs.readFileSync(r.patch, 'utf8');
        assert.ok(body.includes('module.exports = 2;') && body.includes('module.exports = {'), 'patch holds both files');
        assert.deepStrictEqual(r.broken.map((b) => path.basename(b.file)), ['bad.js']);
        assert.strictEqual(sup.log.enqueued.length, 1, 'one repair item');
        const e = sup.log.enqueued[0];
        assert.strictEqual(e.startNow, true);
        assert.strictEqual(e.source, 'agent');
        assert.strictEqual(e.sourceRef, 'supervisor:repair:21');
        assert.ok(e.prompt.includes('bad.js') && e.prompt.includes(r.patch) && /ONLY the half-done edit/.test(e.prompt));
        assert.strictEqual(r.repair, 900);
        assert.strictEqual(sup.log.comments.length, 1, 'commented on the issue');
        assert.match(sup.log.comments[0][1], /The issue stays open/);
        assert.ok(!/close/i.test(sup.log.comments[0][1].replace(/The issue stays open/, '')), 'never says it closed anything');
        assert.strictEqual(fs.readFileSync(path.join(repo, 'bad.js'), 'utf8'), 'module.exports = {\n', 'the live tree is never reverted');
    });

    await test('damage check: everything checks out -> a patch, no repair item', async () => {
        fs.writeFileSync(path.join(repo, 'bad.js'), 'module.exports = 3;\n');
        fs.writeFileSync(path.join(repo, 'data.json'), '{"a":2}\n');
        const sup = fakeSup({});
        const r = await kill.damageCheck(result(['ok.js', 'bad.js', 'data.json']), { item: { id: 22 }, deps: damageDeps(sup) });
        assert.ok(r.patch && fs.existsSync(r.patch));
        assert.deepStrictEqual(r.broken, []);
        assert.strictEqual(sup.log.enqueued.length, 0, 'no repair item');
        assert.strictEqual(r.repair, null);
    });

    await test('damage check: invalid JSON and conflict markers are broken too', async () => {
        fs.writeFileSync(path.join(repo, 'data.json'), '{"a":\n');
        fs.writeFileSync(path.join(repo, 'ok.js'), '<<<<<<< HEAD\nmodule.exports = 1;\n=======\nmodule.exports = 2;\n>>>>>>> x\n');
        const sup = fakeSup({});
        const r = await kill.damageCheck(result(['ok.js', 'data.json']), { item: { id: 23 }, deps: damageDeps(sup) });
        assert.deepStrictEqual(r.broken.map((b) => path.basename(b.file)).sort(), ['data.json', 'ok.js']);
        assert.strictEqual(sup.log.enqueued.length, 1);
    });

    console.log(failed ? `\n${failed} failed` : '\nall passed');
    try { store.close(); } catch (_) { /* closed */ }
    process.exit(failed ? 1 : 0);
})();
