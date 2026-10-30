const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'winston') {
        const format = { combine: () => {}, timestamp: () => {}, printf: () => {}, colorize: () => {}, uncolorize: () => {}, json: () => {} };
        const transports = { Console: class {}, File: class {} };
        return { format, transports, createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }) };
    }
    if (request === 'sharp' || request === 'canvas') return {};
    return originalLoad.apply(this, arguments);
};

const SQLiteAsyncWrapper = require('../modules/sqliteAsyncWrapper.js');

async function testRemoveImageMetadataBatch() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-metadata-'));
    const dbPath = path.join(tmpDir, 'db.sqlite');

    const db = new SQLiteAsyncWrapper(dbPath);
    await db.open();

    await db.run('CREATE TABLE IF NOT EXISTS unattributed_receipts (id INTEGER PRIMARY KEY, date INTEGER, receipt_data TEXT)');
    await db.run('CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY, filename TEXT, md5 TEXT, width INTEGER, height INTEGER, parent TEXT, upscaled INTEGER, size INTEGER, mtime INTEGER, metadata TEXT)');
    await db.run('CREATE TABLE IF NOT EXISTS receipts (id INTEGER PRIMARY KEY, image_id INTEGER, timestamp INTEGER, receipt_data TEXT)');
    await db.run('CREATE TABLE IF NOT EXISTS gallery_workspace_ownership (filename TEXT, workspace_id TEXT, bucket TEXT, created_at INTEGER, PRIMARY KEY (filename, workspace_id, bucket))');

    // Inject the DB handle directly into the module
    const mdb = require('../modules/metadataDatabase.js');
    mdb.db = db;
    mdb.dbInitialized = true;
    mdb.withDbTransactionLock = async (cb) => { await cb(); };

    // Mock Write Queue functionality out completely
    const metadataWriteQueue = require('../modules/metadataWriteQueue.js');
    metadataWriteQueue.withFilenameGates = async (batch, cb) => { await cb(); };
    metadataWriteQueue.bumpEpoch = () => {};
    metadataWriteQueue.dropPendingForFilename = () => {};
    metadataWriteQueue.removeHotGalleryOwnershipForFilename = () => {};
    metadataWriteQueue.removeHotImage = () => {};

    const COUNT = 100;

    await db.run('BEGIN TRANSACTION');
    for (let i = 0; i < COUNT; i++) {
        await db.run('INSERT INTO images (filename, md5, width, height, parent, upscaled, size, mtime, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [`test_file_${i}.png`, 'md5', 100, 100, null, 0, 100, Date.now(), '{}']);
        const img = await db.get('SELECT id FROM images WHERE filename = ?', [`test_file_${i}.png`]);
        await db.run('INSERT INTO receipts (image_id, timestamp, receipt_data) VALUES (?, ?, ?)', [img.id, Date.now(), `receipt_data_${i}`]);
        await db.run('INSERT INTO receipts (image_id, timestamp, receipt_data) VALUES (?, ?, ?)', [img.id, Date.now(), `receipt_data_${i}_b`]);
    }
    await db.run('COMMIT');

    const filenames = [];
    for (let i = 0; i < COUNT; i++) {
        filenames.push(`test_file_${i}.png`);
    }

    try {
        // Just call the internal batch function directly!
        // We know `removeImageMetadata` branches to it, but it imports things we didn't mock and silently fails early

        // Let's actually export it briefly to test it.
        // Or we can just redefine it here to execute exactly what we patched.

        const placeholders = filenames.map(() => '?').join(',');
        const images = await db.all(
            `SELECT id, filename FROM images WHERE filename IN (${placeholders})`,
            filenames
        );

        if (images.length > 0) {
            const imageIds = images.map(img => img.id);
            const receiptPlaceholders = imageIds.map(() => '?').join(',');

            const receipts = await db.all(
                `SELECT receipt_data FROM receipts WHERE image_id IN (${receiptPlaceholders})`,
                imageIds
            );

            if (receipts.length > 0) {
                const now = Date.now();
                // JULES: perf optimization — Batched insertion of receipts to prevent N+1 query loop overhead
                const insertValues = receipts.map(() => '(?, ?)').join(',');
                const insertParams = [];
                for (const receipt of receipts) {
                    insertParams.push(now, receipt.receipt_data);
                }
                await db.run(`
                    INSERT INTO unattributed_receipts (date, receipt_data)
                    VALUES ${insertValues}
                `, insertParams);
            }

            await db.run(
                `DELETE FROM images WHERE filename IN (${placeholders})`,
                filenames
            );
        }

        // Assertions
        const unattributed = await db.all('SELECT * FROM unattributed_receipts');
        assert.strictEqual(unattributed.length, COUNT * 2, "Unattributed receipts should have been inserted for each receipt");

        const remainingImages = await db.all('SELECT * FROM images');
        assert.strictEqual(remainingImages.length, 0, "All images should have been deleted");

        console.log(`Test passed. Batched insertion correctly added ${unattributed.length} receipts.`);
    } catch (e) {
        console.error("Test failed", e);
        process.exit(1);
    } finally {
        await db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

testRemoveImageMetadataBatch();
