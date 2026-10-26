const assert = require('assert');
const { createGenerationJobQueue } = require('../modules/generationJobQueue.js');

async function run() {
    const q = createGenerationJobQueue();
    const NUM_JOBS = 2000;

    // Add pending jobs
    for (let i = 0; i < NUM_JOBS; i++) {
        q.submit({ type: 'test_perf', run: () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 1000)) });
    }

    // Start pumping so that running is populated
    const firstList = q.listPublic();

    const t0 = process.hrtime.bigint();
    const result = q.listPublic();
    const t1 = process.hrtime.bigint();
    const elapsedMs = Number(t1 - t0) / 1000000;

    console.log(`listPublic for ${NUM_JOBS} jobs took ${elapsedMs.toFixed(2)} ms`);

    assert(result.length === NUM_JOBS, 'Queue should contain correct number of jobs');
    assert(result.every((job, i) => job.position === i), 'Positions must be correct');

    // An O(N^2) implementation for 2000 jobs would easily take >100ms in Node, while an O(N) should take <20ms
    assert(elapsedMs < 50, 'Queue list performance is too slow - possible O(N^2) regression detected');

    console.log('✅ Generation queue O(N) performance test passed.');
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
