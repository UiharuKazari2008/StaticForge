'use strict';
// Runs the real backfillGalleryOwnershipFromWorkspaces against a temp metadata.db.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-ownership-'));
    const mdb = require('../modules/metadataDatabase');
    try {
        await mdb.initializeDatabase(dir);
        const Database = require('better-sqlite3');
        const raw = new Database(path.join(dir, 'metadata.db'));
        raw.pragma("foreign_keys = OFF"); // the live wrapper (node sqlite3) runs with foreign keys off
        raw.prepare("INSERT INTO gallery_workspace_ownership (filename, workspace_id, bucket, created_at) VALUES ('a.png', 'w1', 'files', 1000)").run();
        raw.close();

        const files = Array.from({ length: 25 }, (_, i) => `f${i}.png`);
        const workspaces = {
            w1: { files: ['a.png', ...files], scraps: ['s.png'], pinned: ['a.png'] },
            w2: { files: ['a.png'] }
        };
        const result = await mdb.backfillGalleryOwnershipFromWorkspaces(workspaces);
        assert.deepStrictEqual(result, { upserted: 29, totalRows: 29 });

        await mdb.closeDatabase();
        const check = new Database(path.join(dir, 'metadata.db'), { readonly: true });
        const count = check.prepare('SELECT count(*) AS c FROM gallery_workspace_ownership').get().c;
        assert.strictEqual(count, 29, 'every (filename, workspace, bucket) row is present once');
        const kept = check.prepare("SELECT created_at FROM gallery_workspace_ownership WHERE filename = 'a.png' AND workspace_id = 'w1' AND bucket = 'files'").get();
        assert.strictEqual(kept.created_at, 1000, 'existing row keeps its created_at');
        check.close();
        console.log('test-gallery-ownership-backfill passed');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
