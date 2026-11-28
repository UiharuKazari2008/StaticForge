'use strict';

// #1449: a Fat Misaka session's replica server runs the code of the worktree the session is given. The container starts on the
// image's commit; when the checkout moves the commit, syncReplicaServer restarts the replica and waits for a new startedAt and
// a healthy answer. Same commit: no restart. The preamble names the commit. Sandboxed: a fake Rack Manager, no sleeps.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const misaka = require('../modules/misakaSessions');
const T = misaka._test;

const OLD = '4cace0fd0dbe78d7ca44a18407c24cc04c0d0765';
const NEW = '4dc7cdca9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fake({ jobs = false, neverHealthy = false } = {}) {
    const f = { calls: [], startedAt: 'T1', polls: 0 };
    f.rack = async (req) => {
        f.calls.push(req.action || req.op);
        if (req.op === 'job') return { job: { id: 'j1', state: 'done' } };
        if (req.action === 'restart') { f.restartedWith = req.params; f.pending = 2; return jobs ? { job: { id: 'j1' } } : { ok: true }; }
        // the listing: the old process answers healthy for a poll or two with the old startedAt, then the new one
        if (f.pending !== undefined) { f.pending -= 1; if (f.pending <= 0 && !neverHealthy) f.startedAt = 'T2'; }
        return { data: { replicas: [{ name: 'fleet-x', commit: OLD, state: 'running', startedAt: f.startedAt, health: { ok: true } }] } };
    };
    f.sleep = async () => {};
    return f;
}

(async () => {
    // 1. commitMoved: full vs short, same, moved, unknown start
    assert.strictEqual(T.commitMoved(OLD, OLD.slice(0, 9)), false, 'short hash of the same commit is not a move');
    assert.strictEqual(T.commitMoved(OLD, NEW), true);
    assert.strictEqual(T.commitMoved('', NEW), true, 'unknown start commit: restart');
    assert.strictEqual(T.commitMoved(OLD, ''), false);
    console.log('ok 1 commitMoved');

    // 2. the checkout moved the commit: restart asked for, and the answer comes only once the new process is healthy
    let f = fake();
    let r = await T.syncReplicaServer('fleet-x', OLD, NEW, { rack: f.rack, sleep: f.sleep });
    assert.strictEqual(r.restarted, true);
    assert.deepStrictEqual(f.restartedWith, { name: 'fleet-x' });
    assert.strictEqual(r.startedAt, 'T2', 'waited for the new startedAt, not the old healthy answer');
    console.log('ok 2 moved commit restarts and waits');

    // 3. same commit: no restart call at all
    f = fake();
    r = await T.syncReplicaServer('fleet-x', OLD, OLD.slice(0, 7), { rack: f.rack, sleep: f.sleep });
    assert.strictEqual(r.restarted, false);
    assert.ok(!f.calls.includes('restart'), 'no restart for the same commit');
    console.log('ok 3 same commit: no restart');

    // 4. restart as a job: the job is waited for
    f = fake({ jobs: true });
    r = await T.syncReplicaServer('fleet-x', OLD, NEW, { rack: f.rack, sleep: f.sleep });
    assert.strictEqual(r.restarted, true);
    assert.ok(f.calls.includes('job'));
    console.log('ok 4 restart job');

    // 5. it never comes back: the launch fails instead of handing out a stale or dead server
    f = fake({ neverHealthy: true });
    let t = 0;
    const realNow = Date.now;
    Date.now = () => (t += 60000);
    try { await T.syncReplicaServer('fleet-x', OLD, NEW, { rack: f.rack, sleep: f.sleep, waitMs: 120000 }); assert.fail('should throw'); }
    catch (e) { assert.ok(/did not come back healthy|took too long/.test(e.message), e.message); }
    finally { Date.now = realNow; }
    console.log('ok 5 never healthy throws');

    // 6. the preamble names the commit; without it, it says to restart
    const note = T.MISAKA_NOTE({ cwd: '/w', replica: 'fleet-x', replicaUrl: 'u', id: 'i', serverCommit: '4dc7cdca9', restarted: true });
    assert.ok(/replica server runs commit 4dc7cdca9/.test(note) && /restarted onto it/.test(note));
    assert.ok(/not known: restart it/.test(T.MISAKA_NOTE({ cwd: '/w', replica: 'fleet-x', replicaUrl: 'u', id: 'i' })));
    console.log('ok 6 preamble');

    // 7. launch order: the sync runs after the checkout and before the tmux session starts
    const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'misakaSessions.js'), 'utf8');
    const i = (s) => src.indexOf(s);
    assert.ok(i('git checkout -q -B') > 0 && i('git checkout -q -B') < i('await syncReplicaServer(replica') && i('await syncReplicaServer(replica') < i("'new-session', '-d', '-s', name"));
    console.log('ok 7 launch order');
})().catch((e) => { console.error(e); process.exit(1); });
