'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { createStore } = require('../modules/programFaultReports');

async function testPrunePerf() {
    const tmpDir = path.join(os.tmpdir(), 'fault-reports-test-' + Date.now());
    await fsp.mkdir(tmpDir, { recursive: true });

    try {
        const store = createStore({
            dir: tmpDir,
            maxReports: 50,
            maxAgeMs: 1000
        });

        // Insert 100 reports
        for (let i = 0; i < 100; i++) {
            await store.upsert({
                program: { name: `App${i}` },
                message: `Error ${i}`
            });
        }

        // Prune should reduce store size to maxReports (50)
        const prunedCount = await store.prune();
        assert.strictEqual(store.size(), 50, 'Store size should be pruned down to maxReports (50)');
        console.log('test-program-faults-prune-perf: ok');
    } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

testPrunePerf().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
