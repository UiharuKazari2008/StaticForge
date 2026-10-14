'use strict';

const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');
const Database = require('better-sqlite3');

const ALLOWED = new Set(['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE']);

async function run() {
    const dbPath = workerData && workerData.dbPath;
    const destPath = workerData && workerData.destPath;
    const mode = workerData && workerData.walCheckpoint
        ? String(workerData.walCheckpoint).toUpperCase()
        : null;
    if (!dbPath || !destPath) {
        throw new Error('sqlite backup worker requires dbPath and destPath');
    }
    if (mode && !ALLOWED.has(mode)) {
        throw new Error(`Unsupported wal checkpoint mode: ${mode}`);
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
        try {
            fs.unlinkSync(destPath + suffix);
        } catch (err) {
            if (err && err.code !== 'ENOENT') throw err;
        }
    }

    const db = new Database(dbPath, { fileMustExist: true, timeout: 30000 });
    try {
        db.pragma('busy_timeout = 30000');
        if (mode) {
            try {
                db.pragma(`wal_checkpoint(${mode})`);
            } catch (walError) {
                // Backup API still copies a consistent snapshot when truncate cannot run.
            }
        }
        await db.backup(destPath);
    } finally {
        db.close();
    }
}

run().then(() => {
    parentPort.postMessage({ ok: true });
}).catch((err) => {
    const destPath = workerData && workerData.destPath;
    if (destPath) {
        for (const suffix of ['', '-wal', '-shm']) {
            try { fs.unlinkSync(destPath + suffix); } catch (_) { /* partial backup */ }
        }
    }
    parentPort.postMessage({
        ok: false,
        error: err && err.message ? err.message : String(err)
    });
});
