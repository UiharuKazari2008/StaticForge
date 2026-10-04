'use strict';

/**
 * Replication changelog: no recording without replicas, ack/age pruning, no checkpoints.
 * Run: node scripts/test-replication-changelog-prune.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const changelog = require('../modules/replicationChangelog');

const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

// --- pure policy -----------------------------------------------------------------
assert.strictEqual(changelog.shouldRecordChanges({ role: 'standalone' }), false);
assert.strictEqual(changelog.shouldRecordChanges({ role: 'master' }), true);
assert.strictEqual(changelog.shouldRecordChanges({ role: 'child' }), true);
assert.strictEqual(changelog.shouldRecordChanges({ role: 'ephemeral' }), true);
process.env.REPLICATION_CHANGELOG_RECORD_STANDALONE = '1';
assert.strictEqual(changelog.shouldRecordChanges({ role: 'standalone' }), true);
delete process.env.REPLICATION_CHANGELOG_RECORD_STANDALONE;

const cut = (config) => changelog.computePruneCutoff(config, NOW, 7 * DAY);
assert.deepStrictEqual(cut({ role: 'standalone' }), { mode: 'standalone-age', createdBefore: NOW - 7 * DAY, maxLsn: null });
assert.deepStrictEqual(cut({ role: 'master', children: [] }), { mode: 'master-no-children-age', createdBefore: NOW - 7 * DAY, maxLsn: null });
assert.deepStrictEqual(
    cut({ role: 'master', children: [{ instanceId: 'a', lastSyncLsn: 40 }, { instanceId: 'b', lastSyncLsn: 25 }] }),
    { mode: 'master-acked', createdBefore: NOW - 7 * DAY, maxLsn: 25 }
);
assert.strictEqual(cut({ role: 'master', children: [{ instanceId: 'a', lastSyncLsn: 40 }, { instanceId: 'b' }] }), null,
    'a child that never synced blocks trimming');
assert.strictEqual(cut({ role: 'child' }), null);
assert.strictEqual(cut({ role: 'ephemeral' }), null);

// --- sqlite integration ----------------------------------------------------------
(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repl-changelog-'));
    const secure = { replication: { role: 'standalone', instanceId: 'test-instance' } };
    const globalResources = {
        getPath: (key) => (key === 'databases' ? root : root),
        getSecureConfig: () => secure
    };

    await changelog.initialize(globalResources);
    const db = changelog.getDb();
    assert.strictEqual(db.checkpointManager, null, 'changelog must not be checkpointed');
    const count = async () => (await db.get('SELECT COUNT(*) AS n FROM changes')).n;

    // Standalone: nothing recorded.
    assert.strictEqual(await changelog.recordChange({ databaseName: 'metadata.db', rowKey: 'a.png', operation: 'INSERT' }), null);
    assert.strictEqual(await changelog.recordConfigChange('favorites', { x: 1 }), null);
    assert.strictEqual(await count(), 0);

    // Master: recorded.
    secure.replication.role = 'master';
    assert.ok(await changelog.recordChange({ databaseName: 'metadata.db', rowKey: 'b.png', operation: 'INSERT' }));
    assert.strictEqual(await count(), 1);
    await db.run('DELETE FROM changes');

    // Seed lsn 1..10 old (30 days), 11..12 recent.
    const insert = (lsn, createdAt) => db.run(
        `INSERT INTO changes (lsn, instance_id, database_name, table_name, row_key, operation, payload_json, origin, created_at, synced_lsn)
         VALUES (?, 'test-instance', 'metadata.db', 'images', ?, 'INSERT', NULL, 'user', ?, NULL)`,
        [lsn, `r${lsn}`, createdAt]
    );
    for (let lsn = 1; lsn <= 10; lsn++) await insert(lsn, NOW - 30 * DAY);
    await insert(11, NOW - DAY);
    await insert(12, NOW - DAY);

    // Master with a child at lsn 6: only acked AND old rows go.
    secure.replication.children = [{ instanceId: 'c1', lastSyncLsn: 6 }];
    let r = await changelog.pruneChangelog({ nowSec: NOW, maxAgeSec: 7 * DAY });
    assert.strictEqual(r.mode, 'master-acked');
    assert.strictEqual(r.deleted, 6);
    assert.strictEqual(await count(), 6);

    // Child: never trimmed.
    secure.replication.role = 'child';
    r = await changelog.pruneChangelog({ nowSec: NOW, maxAgeSec: 7 * DAY });
    assert.strictEqual(r.mode, 'retain');
    assert.strictEqual(r.deleted, 0);

    // Standalone: age cap.
    secure.replication = { role: 'standalone', instanceId: 'test-instance' };
    r = await changelog.pruneChangelog({ nowSec: NOW, maxAgeSec: 7 * DAY });
    assert.strictEqual(r.mode, 'standalone-age');
    assert.strictEqual(r.deleted, 4);
    assert.deepStrictEqual((await db.all('SELECT lsn FROM changes ORDER BY lsn')).map((x) => x.lsn), [11, 12]);
    assert.strictEqual(r.vacuumed, false, 'tiny file: no VACUUM');

    assert.ok(!fs.existsSync(path.join(root, 'checkpoints', 'replication_changelog')) ||
        fs.readdirSync(path.join(root, 'checkpoints', 'replication_changelog')).length === 0);

    await db.close();
    console.log('test-replication-changelog-prune: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
