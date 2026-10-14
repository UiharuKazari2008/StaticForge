'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const DEFAULT_JITTER = { minMs: 400, maxMs: 2200 };
let jitter = { minMs: DEFAULT_JITTER.minMs, maxMs: DEFAULT_JITTER.maxMs };
let chain = Promise.resolve();
let activeLabel = null;
let depth = 0;

function setSqliteMaintenanceJitter(next) {
    const minMs = Math.max(0, Number(next && next.minMs) || 0);
    const maxMs = Math.max(minMs, Number(next && next.maxMs) || 0);
    jitter = { minMs, maxMs };
}

function resetSqliteMaintenanceLaneForTests() {
    chain = Promise.resolve();
    activeLabel = null;
    depth = 0;
    jitter = { minMs: DEFAULT_JITTER.minMs, maxMs: DEFAULT_JITTER.maxMs };
}

function sqliteMaintenanceLaneState() {
    return { activeLabel, depth, jitter: { minMs: jitter.minMs, maxMs: jitter.maxMs } };
}

function rollJitterMs() {
    const span = jitter.maxMs - jitter.minMs;
    if (span <= 0) return jitter.minMs;
    return jitter.minMs + Math.floor(Math.random() * (span + 1));
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One SQLite checkpoint or backup at a time, with jitter before each job
 * so databases do not line up on the same tick.
 */
function enqueueSqliteMaintenance(label, work) {
    depth += 1;
    const run = chain.then(async () => {
        const wait = rollJitterMs();
        if (wait > 0) await delay(wait);
        activeLabel = label || 'sqlite';
        try {
            return await work();
        } finally {
            activeLabel = null;
            depth -= 1;
        }
    });
    chain = run.then(() => {}, () => {});
    return run;
}

function runBackupWorker(dbPath, destPath, walCheckpoint) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'sqliteBackupWorker.js'), {
            workerData: { dbPath, destPath, walCheckpoint },
            execArgv: []
        });
        let settled = false;
        const finish = (err, value) => {
            if (settled) return;
            settled = true;
            if (err) reject(err);
            else resolve(value);
        };
        worker.once('message', (msg) => {
            if (msg && msg.ok) finish(null, msg);
            else finish(new Error((msg && msg.error) || 'sqlite backup worker failed'));
        });
        worker.once('error', (err) => finish(err));
        worker.once('exit', (code) => {
            if (!settled && code !== 0) finish(new Error(`sqlite backup worker exited ${code}`));
        });
    });
}

/**
 * WAL checkpoint + SQLite backup on a worker thread, serialized across databases.
 * @param {string} dbPath
 * @param {string} destPath
 * @param {{ walCheckpoint?: string }} [options]
 */
function backupDatabaseOffThread(dbPath, destPath, options = {}) {
    const mode = options.walCheckpoint == null
        ? 'TRUNCATE'
        : String(options.walCheckpoint).toUpperCase();
    const allowed = new Set(['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE', 'NONE']);
    if (!allowed.has(mode)) {
        return Promise.reject(new Error(`Unsupported wal checkpoint mode: ${mode}`));
    }
    return enqueueSqliteMaintenance(path.basename(dbPath), () => {
        return runBackupWorker(dbPath, destPath, mode === 'NONE' ? null : mode);
    });
}

module.exports = {
    enqueueSqliteMaintenance,
    backupDatabaseOffThread,
    setSqliteMaintenanceJitter,
    resetSqliteMaintenanceLaneForTests,
    sqliteMaintenanceLaneState
};
