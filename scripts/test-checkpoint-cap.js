'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseCheckpointManager } = require('../modules/databaseCheckpoint');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-cap-test-'));
const dbPath = path.join(dir, 'test.db');
fs.writeFileSync(dbPath, 'x');

// Mock fake resources with grandfathering enabled and high retention so absoluteCap triggers
const gr = {
    getConfig: (opts) => {
        if (opts && opts.path === 'checkpoints') {
            return {
                enabled: true,
                grandfathering: { hour: { max: 100 }, day: { max: 100 }, month: { max: 0 } }
            };
        }
        return {};
    },
    getPath: () => dir
};

const cpManager = new DatabaseCheckpointManager(dbPath, 5, gr);

// Overwrite the checkpoint Dir for tests to be predictable
cpManager.checkpointDir = path.join(dir, 'checkpoints', 'test');
fs.mkdirSync(cpManager.checkpointDir, { recursive: true });
fs.mkdirSync(path.join(cpManager.checkpointDir, 'hour'), { recursive: true });

for (let i = 0; i < 55; i++) {
    // vary the day/hour in the name so they go to different buckets
    const h = String(i % 24).padStart(2, '0');
    const d = String(Math.floor(i / 24) + 1).padStart(2, '0');
    const cpPath = path.join(cpManager.checkpointDir, 'hour', `1970-01-${d}_${h}-00-00.000.db`);
    fs.writeFileSync(cpPath, 'x');
    fs.writeFileSync(cpPath + '-wal', 'x');
    fs.writeFileSync(cpPath + '-shm', 'x');

    // adjust mtime so they can be sorted properly
    const mtime = new Date(1000 + i * 1000);
    fs.utimesSync(cpPath, mtime, mtime);
}

const filesBefore = cpManager.getCheckpointFiles();
assert.strictEqual(filesBefore.length, 55, 'Should have 55 files initially');

// Run the absolute cap logic via cleanupOldCheckpoints
cpManager.cleanupOldCheckpoints();

// Expect strictly 50 left (the absolute cap for this tier)
const filesAfter = cpManager.getCheckpointFiles();
assert.strictEqual(filesAfter.length, 50, 'Absolute cap should delete down to 50');

// Verify that the sidecars were also cleaned up
const files = fs.readdirSync(path.join(cpManager.checkpointDir, 'hour'));
let walCount = 0;
let shmCount = 0;
files.forEach(f => {
    if (f.endsWith('-wal')) walCount++;
    if (f.endsWith('-shm')) shmCount++;
});
assert.strictEqual(walCount, 50, 'Wal sidecars should match cap');
assert.strictEqual(shmCount, 50, 'Shm sidecars should match cap');

console.log('test-checkpoint-cap: ok');
