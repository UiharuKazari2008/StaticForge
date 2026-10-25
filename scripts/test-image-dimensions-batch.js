#!/usr/bin/env node
// getImageDimensionsBatch (#649): width/height/upscaled/size/mtime for many files without
// loading the metadata JSON; hot (staged, unflushed) rows win over the table.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const metadataDb = require('../modules/metadataDatabase');
const metadataWriteQueue = require('../modules/metadataWriteQueue');

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dims-batch-649-'));
    try {
        // Create the schema, then seed rows on a plain handle (same library, node-sqlite3) while the
        // module's handles are closed, then open the module again on the seeded file.
        assert.strictEqual(await metadataDb.initializeDatabase(dir), true, 'temp metadata db should initialize');
        await metadataDb.closeDatabase();
        const raw = await open({ filename: path.join(dir, 'metadata.db'), driver: sqlite3.Database });
        const bigMeta = JSON.stringify({ forge_data: { prompt: 'x'.repeat(20000) } });
        const rows = [];
        for (let i = 0; i < 1203; i++) {
            rows.push([`img_${i}.png`, `md5${i}`, 832 + (i % 3), 1216, i % 7 === 0 ? 1 : 0, 1000 + i, 1700000000 + i, bigMeta]);
        }
        await raw.exec('BEGIN');
        for (const r of rows) {
            await raw.run(
                'INSERT INTO images (filename, md5, width, height, upscaled, size, mtime, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                r
            );
        }
        await raw.exec('COMMIT');
        await raw.close();
        assert.strictEqual(await metadataDb.initializeDatabase(dir), true, 'seeded metadata db should initialize');

        const want = rows.map((r) => r[0]).concat(['missing.png']);
        const t0 = process.hrtime.bigint();
        const dims = await metadataDb.getImageDimensionsBatch(want);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;

        assert.strictEqual(Object.keys(dims).length, rows.length, 'every stored file resolves, the missing one does not');
        assert.strictEqual(dims['missing.png'], undefined);
        assert.deepStrictEqual(dims['img_7.png'], { width: 833, height: 1216, upscaled: true, size: 1007, mtime: 1700000007 });
        assert.deepStrictEqual(dims['img_1.png'], { width: 833, height: 1216, upscaled: false, size: 1001, mtime: 1700000001 });
        for (const v of Object.values(dims)) {
            assert.strictEqual(v.metadata, undefined, 'no metadata JSON is carried');
            assert.strictEqual(typeof v.upscaled, 'boolean');
        }

        // A staged (not yet flushed) record beats the table row.
        metadataWriteQueue.stageImage('img_2.png', { filename: 'img_2.png', width: 64, height: 64, upscaled: 0, size: 5, mtime: 42, metadata: {} });
        const hot = await metadataDb.getImageDimensionsBatch(['img_2.png', 'img_3.png']);
        assert.deepStrictEqual(hot['img_2.png'], { width: 64, height: 64, upscaled: false, size: 5, mtime: 42 });
        assert.strictEqual(hot['img_3.png'].width, 832);
        metadataWriteQueue.removeHotImage('img_2.png');

        assert.deepStrictEqual(await metadataDb.getImageDimensionsBatch([]), {});
        assert.deepStrictEqual(await metadataDb.getImageDimensionsBatch(null), {});

        // Same five fields as the old path, for a handful of files
        const full = await metadataDb.getMultipleMetadata(['img_5.png', 'img_14.png']);
        for (const f of ['img_5.png', 'img_14.png']) {
            const a = dims[f];
            const b = full[f];
            assert.deepStrictEqual(a, { width: b.width, height: b.height, upscaled: b.upscaled, size: b.size, mtime: b.mtime }, `${f} fields match getMultipleMetadata`);
        }

        console.log(`test-image-dimensions-batch: ok (${rows.length} files in ${ms.toFixed(1)} ms)`);
    } finally {
        try { await metadataDb.closeDatabase(); } catch (_) {}
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// initializeDatabase leaves maintenance timers behind; exit explicitly like the other DB tests.
main().then(() => process.exit(0)).catch((err) => {
    console.error('test-image-dimensions-batch: FAIL', err);
    process.exit(1);
});
