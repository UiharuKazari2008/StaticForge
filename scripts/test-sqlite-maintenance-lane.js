/**
 * SQLite checkpoint lane: one backup at a time, jitter, worker backup.
 * Run: NODE_PATH=/home/kanmi/staticforge/node_modules node scripts/test-sqlite-maintenance-lane.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
    enqueueSqliteMaintenance,
    backupDatabaseOffThread,
    setSqliteMaintenanceJitter,
    resetSqliteMaintenanceLaneForTests
} = require('../modules/sqliteMaintenanceLane');
const SQLiteAsyncWrapper = require('../modules/sqliteAsyncWrapper');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testSerialLane() {
    resetSqliteMaintenanceLaneForTests();
    setSqliteMaintenanceJitter({ minMs: 0, maxMs: 0 });
    let active = 0;
    let maxActive = 0;
    const work = async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(40);
        active -= 1;
    };
    await Promise.all([
        enqueueSqliteMaintenance('a', work),
        enqueueSqliteMaintenance('b', work)
    ]);
    assert.strictEqual(maxActive, 1, 'two sqlite jobs overlapped');
}

async function testJitter() {
    resetSqliteMaintenanceLaneForTests();
    setSqliteMaintenanceJitter({ minMs: 60, maxMs: 60 });
    const started = Date.now();
    await enqueueSqliteMaintenance('jitter', async () => {});
    assert.ok(Date.now() - started >= 50, 'jitter did not delay the job');
}

async function testWorkerBackup() {
    resetSqliteMaintenanceLaneForTests();
    setSqliteMaintenanceJitter({ minMs: 0, maxMs: 0 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sqlite-lane-'));
    try {
        const dbPath = path.join(dir, 'tag_wiki.db');
        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
        db.prepare('INSERT INTO t (v) VALUES (?)').run('idle-unload');
        db.close();

        const dest = path.join(dir, 'snap.db');
        await backupDatabaseOffThread(dbPath, dest, { walCheckpoint: 'TRUNCATE' });
        const snap = new Database(dest, { readonly: true, fileMustExist: true });
        const row = snap.prepare('SELECT v FROM t').get();
        snap.close();
        assert.strictEqual(row.v, 'idle-unload');

        const livePath = path.join(dir, 'live.db');
        const wrapper = new SQLiteAsyncWrapper(livePath, 'live', 60);
        await wrapper.run('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
        await wrapper.run('INSERT INTO t (v) VALUES (?)', ['wiki']);
        assert.strictEqual(wrapper.isDirtyState(), true);
        const created = await wrapper.createCheckpointIfDirty();
        assert.strictEqual(created, true);
        assert.strictEqual(wrapper.isDirtyState(), false);

        // #523: the checkpoint must not unlink the live sidecars under the open
        // node-sqlite3 handle (better-sqlite3 in the worker did, causing SQLITE_IOERR).
        assert.ok(fs.existsSync(livePath + '-wal'), 'checkpoint deleted live -wal');
        assert.ok(fs.existsSync(livePath + '-shm'), 'checkpoint deleted live -shm');
        if (fs.existsSync('/proc/self/fd')) {
            const deletedSidecars = fs.readdirSync('/proc/self/fd')
                .map((fd) => { try { return fs.readlinkSync(path.join('/proc/self/fd', fd)); } catch (_) { return ''; } })
                .filter((target) => target.startsWith(livePath) && target.endsWith('(deleted)'));
            assert.deepStrictEqual(deletedSidecars, [], 'live sidecars unlinked under an open handle');
        }
        await wrapper.run('INSERT INTO t (v) VALUES (?)', ['after-checkpoint']);

        const checkpointRoot = path.join(dir, 'checkpoints', 'live');
        const found = [];
        const walk = (folder) => {
            for (const name of fs.readdirSync(folder)) {
                const full = path.join(folder, name);
                if (fs.statSync(full).isDirectory()) walk(full);
                else if (name.endsWith('.db')) found.push(full);
            }
        };
        walk(checkpointRoot);
        assert.ok(found.length >= 1, 'idle checkpoint file missing');
        const check = new Database(found[0], { readonly: true, fileMustExist: true });
        const saved = check.prepare('SELECT v FROM t').get();
        check.close();
        assert.strictEqual(saved.v, 'wiki');
        await wrapper.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        resetSqliteMaintenanceLaneForTests();
    }
}

(async () => {
    await testSerialLane();
    await testJitter();
    await testWorkerBackup();
    console.log('test-sqlite-maintenance-lane: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
