const ReferenceMetadataDatabase = require('../modules/referenceMetadataDatabase.js');
const Database = require('better-sqlite3');
const fs = require('fs');

async function run() {
    console.log("Setting up test database...");
    if (fs.existsSync('test_batch.db')) fs.unlinkSync('test_batch.db');
    const db = new Database('test_batch.db');

    db.prepare('CREATE TABLE reference_metadata (hash TEXT PRIMARY KEY)').run();
    db.prepare('CREATE TABLE reference_file_cache (hash TEXT PRIMARY KEY)').run();
    db.prepare('CREATE TABLE reference_workspace_ownership (hash TEXT PRIMARY KEY, workspace_id TEXT)').run();
    db.prepare('CREATE TABLE IF NOT EXISTS reference_changelog (id INTEGER PRIMARY KEY, type TEXT, key TEXT, action TEXT, data TEXT, created_at INTEGER)').run();

    const refDb = Object.create(ReferenceMetadataDatabase.prototype);
    refDb._recordReferenceChangelog = () => { changelogsCount++ };
    refDb.db = db;
    let changelogsCount = 0;

    const BATCH_SIZE = 500;

    // Insert test data
    const insertMeta = db.prepare('INSERT INTO reference_metadata (hash) VALUES (?)');
    const insertCache = db.prepare('INSERT INTO reference_file_cache (hash) VALUES (?)');
    const insertWorkspace = db.prepare('INSERT INTO reference_workspace_ownership (hash, workspace_id) VALUES (?, ?)');

    db.transaction(() => {
        for(let i=0; i<BATCH_SIZE; i++) {
            insertMeta.run(i.toString());
            insertCache.run(i.toString());
            insertWorkspace.run(i.toString(), 'test-ws');
        }
    })();

    const hashes = [];
    for(let i=0; i<BATCH_SIZE; i++) hashes.push(i.toString());

    // Verify data exists
    let metaCount = db.prepare('SELECT COUNT(*) as c FROM reference_metadata').get().c;
    if (metaCount !== BATCH_SIZE) throw new Error("Data setup failed");

    console.log(`Starting batch deletion of ${BATCH_SIZE} items...`);
    const start = performance.now();

    const deletedCount = refDb.deleteMetadataBatch(hashes);

    const duration = performance.now() - start;
    console.log(`Batch deletion took ${duration.toFixed(2)}ms`);

    // Verify deletion for batch
    metaCount = db.prepare('SELECT COUNT(*) as c FROM reference_metadata').get().c;
    const cacheCount = db.prepare('SELECT COUNT(*) as c FROM reference_file_cache').get().c;
    const wsCount = db.prepare('SELECT COUNT(*) as c FROM reference_workspace_ownership').get().c;

    const batchLogs = changelogsCount;

    // --- Original Loop Deletion ---
    console.log("\nSetting up for Original Loop Deletion...");
    changelogsCount = 0;

    db.transaction(() => {
        for(let i=0; i<BATCH_SIZE; i++) {
            insertMeta.run(i.toString());
            insertCache.run(i.toString());
            insertWorkspace.run(i.toString(), 'test-ws');
        }
    })();

    const startOld = performance.now();
    let oldDeletedCount = 0;
    for (const h of hashes) {
        if (refDb.deleteMetadata(h)) {
            oldDeletedCount++;
        }
    }
    const durationOld = performance.now() - startOld;
    console.log(`Original deletion took ${durationOld.toFixed(2)}ms`);

    const oldMetaCount = db.prepare('SELECT COUNT(*) as c FROM reference_metadata').get().c;
    const oldCacheCount = db.prepare('SELECT COUNT(*) as c FROM reference_file_cache').get().c;
    const oldWsCount = db.prepare('SELECT COUNT(*) as c FROM reference_workspace_ownership').get().c;
    const oldLogs = changelogsCount;

    console.log("\nVerification:");
    console.log(`- Batch Deleted items returned: ${deletedCount} | Original: ${oldDeletedCount}`);
    console.log(`- Batch Metadata remaining: ${metaCount} | Original: ${oldMetaCount}`);
    console.log(`- Batch Cache remaining: ${cacheCount} | Original: ${oldCacheCount}`);
    console.log(`- Batch Workspace remaining: ${wsCount} | Original: ${oldWsCount}`);
    console.log(`- Batch Changelogs recorded: ${batchLogs} | Original: ${oldLogs}`);

    if (metaCount !== oldMetaCount || cacheCount !== oldCacheCount || wsCount !== oldWsCount || deletedCount !== oldDeletedCount || batchLogs !== oldLogs) {
        throw new Error("Results are not identical before/after!");
    }

    if (metaCount !== 0) {
        throw new Error("Not all items were deleted!");
    }

    console.log("✅ Success! Batch deletion works identically to loop, but much faster.");
}

run().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
})
.finally(() => {
    if (fs.existsSync('test_batch.db')) fs.unlinkSync('test_batch.db');
});
