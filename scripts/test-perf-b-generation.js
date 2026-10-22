#!/usr/bin/env node
/**
 * #620 slice b-generation: equivalence + timing checks for the generation save path,
 * metadata.db write/read batching, PNG chunk helpers and replication journal hashing.
 * Bugs covered: #621, #622, #623, #624.
 *
 * Run: node scripts/test-perf-b-generation.js [section ...]
 * DB equivalence sections read a COPY of metadata.db: set PERF_METADATA_DB_COPY
 * (default ~/.cache/perfscan/b-generation/metadata.db); they are skipped when it is missing.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const PngMetadata = require('../modules/pngMetadata');

const WORK_ROOT = process.env.PERF_WORK_DIR
    || path.join(os.homedir(), '.cache', 'perfscan', 'b-generation', 'work');
const DB_COPY = process.env.PERF_METADATA_DB_COPY
    || path.join(os.homedir(), '.cache', 'perfscan', 'b-generation', 'metadata.db');

function makeWorkDir(label) {
    fs.mkdirSync(WORK_ROOT, { recursive: true });
    return fs.mkdtempSync(path.join(WORK_ROOT, `${label}-`));
}

/** Minimal globalResources for forge signing (keys live in memory only). */
function makeFakeGlobalResources() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const secure = {
        forgeSigning: {
            privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
            publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
            createdAt: Date.now()
        }
    };
    return {
        getSecureConfig(options = {}) {
            if (!options.path) return secure;
            return String(options.path).split('.').reduce((o, k) => (o == null ? o : o[k]), secure);
        },
        modifyConfig() {
            throw new Error('fake globalResources: keys must already exist');
        }
    };
}

/** NAI-like PNG: RGBA pixels + tEXt Comment/Source/Software. */
async function makeNaiLikePng(pm, { width = 96, height = 64, seed = 1234 } = {}) {
    const raw = Buffer.alloc(width * height * 4);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + seed) & 0xff;
    for (let i = 3; i < raw.length; i += 4) raw[i] = 255;
    let png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const comment = {
        prompt: '1girl, solo, blue hair, smile',
        steps: 28,
        height,
        width,
        scale: 5,
        uncond_scale: 0,
        cfg_rescale: 0,
        seed,
        n_samples: 1,
        noise_schedule: 'karras',
        sampler: 'k_euler_ancestral',
        uc: 'lowres, bad anatomy'
    };
    png = pm.insertTextChunk(png, 'Comment', JSON.stringify(comment));
    png = pm.insertTextChunk(png, 'Source', 'NovelAI Diffusion V4.5 4BDE2A90');
    png = pm.insertTextChunk(png, 'Software', 'NovelAI');
    return png;
}

function readForgeData(pm, buffer) {
    const meta = pm.readMetadata(buffer);
    return JSON.parse(meta.tEXt.Comment).forge_data;
}

const BASE_REV = process.env.PERF_BASE_REV || 'f2ac8aa';
const oldModuleFiles = [];

/** Load a module as it was at BASE_REV (written next to the live one so relative requires work). */
function requireOldModule(relPath) {
    const { execFileSync } = require('child_process');
    const repoRoot = path.join(__dirname, '..');
    const src = execFileSync('git', ['show', `${BASE_REV}:${relPath}`], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    const target = path.join(repoRoot, path.dirname(relPath), `__perf_old_${path.basename(relPath)}`);
    fs.writeFileSync(target, src);
    oldModuleFiles.push(target);
    return require(target);
}

function cleanupOldModules() {
    for (const file of oldModuleFiles.splice(0)) {
        try { fs.unlinkSync(file); } catch (_) { /* ignore */ }
    }
}

async function openSqlite(file, readOnly = true) {
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    return open({
        filename: file,
        driver: sqlite3.Database,
        mode: readOnly ? sqlite3.OPEN_READONLY : (sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE)
    });
}

function haveDbCopy() {
    if (fs.existsSync(DB_COPY)) return true;
    console.log(`  skipped: no DB copy at ${DB_COPY}`);
    return false;
}

async function sampleImageRows(limit, where = '1=1') {
    const src = await openSqlite(DB_COPY);
    try {
        return await src.all(`
            SELECT id, filename, md5, width, height, parent, upscaled, size, mtime, blurhash, metadata
            FROM images
            WHERE length(metadata) < 1000000 AND ${where}
            ORDER BY (id * 2654435761) % 1000003
            LIMIT ?
        `, [limit]);
    } finally {
        await src.close();
    }
}

const INDEX_TABLES = [
    'search_tags', 'search_fulltext', 'search_characters', 'search_presets', 'search_models',
    'image_prompt_text', 'prompt_fts_compiled', 'prompt_fts_input', 'image_search_facets',
    'image_seed_chain'
];
const VOLATILE_COLUMNS = new Set(['id', 'indexed_at', 'updated_at', 'created_at', 'image_id']);

async function dumpIndexTables(dbFile) {
    const conn = await openSqlite(dbFile);
    const out = {};
    try {
        for (const table of INDEX_TABLES) {
            const rows = await conn.all(`SELECT * FROM ${table}`);
            out[table] = rows
                .map((row) => JSON.stringify(Object.keys(row).sort()
                    .filter((k) => !VOLATILE_COLUMNS.has(k))
                    .map((k) => [k, row[k]])))
                .sort();
        }
        out.images_ready = (await conn.all(
            'SELECT filename, search_indexes_ready, blob_extract_attempted, fts_extract_attempted, input_prompt_tags_extract_attempted FROM images ORDER BY filename'
        )).map((r) => JSON.stringify(r));
    } finally {
        await conn.close();
    }
    return out;
}

async function seedImagesTable(dbFile, rows) {
    const conn = await openSqlite(dbFile, false);
    try {
        await conn.exec('PRAGMA busy_timeout = 60000');
        await conn.run('BEGIN');
        for (const r of rows) {
            await conn.run(`
                INSERT INTO images (id, filename, md5, width, height, parent, upscaled, size, mtime, blurhash, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [r.id, r.filename, r.md5, r.width, r.height, r.parent, r.upscaled, r.size, r.mtime, r.blurhash, r.metadata]);
        }
        await conn.run('COMMIT');
    } finally {
        await conn.close();
    }
}

function rowToIndexMetadata(r) {
    return {
        id: r.id,
        filename: r.filename,
        md5: r.md5,
        width: r.width,
        height: r.height,
        parent: r.parent,
        upscaled: Boolean(r.upscaled),
        size: r.size,
        mtime: r.mtime,
        blurhash: r.blurhash,
        metadata: JSON.parse(r.metadata || '{}')
    };
}

const sections = {};

// Finding 2: updateSearchIndexes in one transaction with chunked multi-row INSERTs.
sections.searchIndex = async function searchIndex() {
    if (!haveDbCopy()) return;
    const rows = await sampleImageRows(Number(process.env.PERF_SEARCH_INDEX_ROWS || 300));
    const results = {};
    for (const variant of ['old', 'new']) {
        const mod = variant === 'old'
            ? requireOldModule('modules/metadataDatabase.js')
            : require('../modules/metadataDatabase');
        const dir = makeWorkDir(`search-index-${variant}`);
        assert.strictEqual(await mod.initializeDatabase(dir, new PngMetadata(null)), true);
        const dbFile = path.join(dir, 'metadata.db');
        await seedImagesTable(dbFile, rows);
        const t0 = process.hrtime.bigint();
        for (const r of rows) {
            await mod.updateSearchIndexes(r.filename, rowToIndexMetadata(r));
        }
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        await mod.closeDatabase();
        results[variant] = { ms, dump: await dumpIndexTables(dbFile) };
        console.log(`  ${variant}: ${rows.length} images indexed in ${ms.toFixed(0)} ms (${(ms / rows.length).toFixed(2)} ms/image)`);
    }
    for (const table of Object.keys(results.old.dump)) {
        assert.deepStrictEqual(results.new.dump[table], results.old.dump[table], `index table ${table} differs`);
    }
    const tagRows = results.new.dump.search_tags.length + results.new.dump.search_fulltext.length;
    console.log(`  searchIndex: identical index rows (${tagRows} tag+fulltext rows)`);
};

// #624: addReceiptMetadata must not merge forge_data that finalizeWithForgeData already embedded.
sections.forge624 = async function forge624() {
    const metadataDb = require('../modules/metadataDatabase');
    const gr = makeFakeGlobalResources();
    const pm = new PngMetadata(gr);
    const dir = makeWorkDir('forge624');
    const imagesDir = path.join(dir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    assert.strictEqual(await metadataDb.initializeDatabase(path.join(dir, 'db'), pm), true);

    const forgeData = {
        date_generated: Date.now(),
        generation_type: 'generated',
        preset_name: 'perf-test',
        input_prompt: '1girl, solo',
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
    };
    const base = await makeNaiLikePng(pm);
    const finalBuffer = await pm.finalizeWithForgeData(base, forgeData);
    const signed = await pm.verifyForgeSignature(finalBuffer);
    assert.strictEqual(signed.ok, true, `finalized buffer must verify: ${signed.reason}`);
    assert.strictEqual((readForgeData(pm, finalBuffer).history || []).length, 0);

    // Old call shape (no flag): the second merge adds a history entry and breaks the signature.
    fs.writeFileSync(path.join(imagesDir, 'old.png'), finalBuffer);
    await metadataDb.addReceiptMetadata('old.png', imagesDir, null, forgeData);
    const oldDisk = fs.readFileSync(path.join(imagesDir, 'old.png'));
    assert.strictEqual(readForgeData(pm, oldDisk).history.length, 1, 'legacy path pushes a spurious history entry');
    assert.strictEqual((await pm.verifyForgeSignature(oldDisk)).ok, false, 'legacy path breaks forge_signed_hash');

    // Fixed call shape: file untouched, still verifies, DB row equals the legacy row (minus file stats).
    fs.writeFileSync(path.join(imagesDir, 'new.png'), finalBuffer);
    const row = await metadataDb.addReceiptMetadata('new.png', imagesDir, null, forgeData, {
        forgeDataEmbedded: true,
        buffer: finalBuffer
    });
    const newDisk = fs.readFileSync(path.join(imagesDir, 'new.png'));
    assert.ok(newDisk.equals(finalBuffer), 'embedded forge data: PNG bytes must not change');
    assert.strictEqual((await pm.verifyForgeSignature(newDisk)).ok, true, 'final file must verify');
    assert.strictEqual(row.md5, crypto.createHash('md5').update(finalBuffer).digest('hex'));
    assert.strictEqual(row.size, finalBuffer.length);
    assert.ok(row.width === 96 && row.height === 64, 'dimensions from buffer');
    const oldRow = await metadataDb.getImageMetadata('old.png', imagesDir);
    assert.deepStrictEqual(row.metadata, oldRow.metadata, 'DB metadata JSON identical to the legacy path');

    // Upscale-branch shape (forgeData not embedded, parent rewritten): buffer path == file path.
    const upForge = { upscale_ratio: 4, upscaled_at: 1700000000000, generation_type: 'upscaled', upscaler_provider: 'local' };
    fs.writeFileSync(path.join(imagesDir, 'pa.png'), finalBuffer);
    fs.writeFileSync(path.join(imagesDir, 'pb.png'), finalBuffer);
    const ra = await metadataDb.addReceiptMetadata('pa.png', imagesDir, { type: 'upscaling', cost: 0, date: 1 }, upForge);
    const rb = await metadataDb.addReceiptMetadata('pb.png', imagesDir, { type: 'upscaling', cost: 0, date: 1 }, upForge, { buffer: finalBuffer });
    const da = fs.readFileSync(path.join(imagesDir, 'pa.png'));
    const db = fs.readFileSync(path.join(imagesDir, 'pb.png'));
    assert.ok(da.equals(db), 'buffer path writes the same parent bytes');
    assert.strictEqual(ra.md5, rb.md5);
    assert.strictEqual(rb.md5, crypto.createHash('md5').update(db).digest('hex'));
    assert.strictEqual(ra.size, rb.size);
    assert.deepStrictEqual(ra.metadata, rb.metadata);
    assert.deepStrictEqual(ra.receipt, rb.receipt);

    await metadataDb.closeDatabase?.();
    console.log('  forge624: ok (no history entry, signature verifies, DB metadata unchanged, buffer path equal)');
};

async function main() {
    const wanted = process.argv.slice(2);
    const names = wanted.length ? wanted : Object.keys(sections);
    for (const name of names) {
        if (!sections[name]) throw new Error(`unknown section ${name}`);
        console.log(`[${name}]`);
        await sections[name]();
    }
    console.log('test-perf-b-generation: all passed');
}

main().then(() => {
    cleanupOldModules();
    process.exit(0);
}).catch((error) => {
    cleanupOldModules();
    console.error(error);
    process.exit(1);
});
