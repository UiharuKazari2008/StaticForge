// Jules GH #393: listPublic() precomputes queue positions; each row must match snapshot(job) exactly.
const assert = require('assert');
const { createGenerationJobQueue } = require('../modules/generationJobQueue.js');

const tick = () => new Promise((r) => setImmediate(r));

async function run() {
    const q = createGenerationJobQueue({ delayMinMs: 100, delayMaxMs: 300, now: () => 1000000 });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const first = q.submit({ type: 'first', run: () => Promise.resolve({ success: true }) });
    await first.promise;
    for (let i = 0; i < 5; i++) {
        q.submit({ type: 'held', run: () => gate.then(() => ({ success: true })) });
    }
    await tick();
    const list = q.listPublic();
    assert.strictEqual(list.length, 6);
    for (const row of list) {
        const one = q.snapshot(q.get(row.jobId));
        assert.strictEqual(row.position, one.position, `position ${row.jobId}`);
        assert.strictEqual(row.delayMs, one.delayMs, `delayMs ${row.jobId}`);
    }
    const live = list.filter((r) => r.jobId !== first.id);
    assert.ok(live.some((r) => r.status === 'running' || r.status === 'delayed'), 'one held job has started');
    assert.deepStrictEqual(live.map((r) => r.position).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
    const done = list.find((r) => r.jobId === first.id);
    assert.strictEqual(done.position, 0);
    assert.strictEqual(done.delayMs, 0);
    release();
    console.log('ok generation queue listPublic positions match snapshot');
    process.exit(0);
}
run().catch((err) => { console.error(err); process.exit(1); });
