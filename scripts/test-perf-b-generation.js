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
async function makeNaiLikePng(pm, { width = 96, height = 64, seed = 1234, noise = false } = {}) {
    const raw = Buffer.alloc(width * height * 4);
    if (noise) crypto.randomFillSync(raw);
    else for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + seed) & 0xff;
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

// Finding 3: getImageMetadata validates with size+mtime first, hashes (streamed) only on mismatch.
sections.imageMetadataStat = async function imageMetadataStat() {
    const gr = makeFakeGlobalResources();
    const pm = new PngMetadata(gr);
    const timings = {};
    for (const variant of ['old', 'new']) {
        const mod = variant === 'old'
            ? requireOldModule('modules/metadataDatabase.js')
            : require('../modules/metadataDatabase');
        const dir = makeWorkDir(`image-meta-${variant}`);
        const imagesDir = path.join(dir, 'images');
        fs.mkdirSync(imagesDir, { recursive: true });
        assert.strictEqual(await mod.initializeDatabase(path.join(dir, 'db'), pm), true);
        const png = await makeNaiLikePng(pm, { width: 1024, height: 1024, noise: true });
        const file = path.join(imagesDir, 'a.png');
        fs.writeFileSync(file, png);
        const first = await mod.getImageMetadata('a.png', imagesDir);
        assert.ok(first && first.width === 1024);
        const N = 200;
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < N; i++) {
            const again = await mod.getImageMetadata('a.png', imagesDir);
            assert.strictEqual(again.md5, first.md5);
        }
        timings[variant] = Number(process.hrtime.bigint() - t0) / 1e6 / N;

        // Touch only: same bytes, new mtime -> still the cached row (MD5 fallback).
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(file, later, later);
        assert.strictEqual((await mod.getImageMetadata('a.png', imagesDir)).md5, first.md5);
        // Different bytes, same size, new mtime -> rebuilt.
        const changed = Buffer.from(png);
        changed[changed.length - 20] ^= 0xff;
        fs.writeFileSync(file, changed);
        const rebuilt = await mod.getImageMetadata('a.png', imagesDir);
        assert.strictEqual(rebuilt.md5, crypto.createHash('md5').update(changed).digest('hex'));
        // Missing file -> null.
        fs.unlinkSync(file);
        assert.strictEqual(await mod.getImageMetadata('a.png', imagesDir), null);
        await mod.closeDatabase();
    }
    console.log(`  getImageMetadata hot hit (1024x1024 PNG): old ${timings.old.toFixed(3)} ms/call, new ${timings.new.toFixed(3)} ms/call`);
};

// Finding 4 + #623: indexed locate in findGalleryWorkspaceItemIndex; tie-aware rank.
sections.galleryLocate = async function galleryLocate() {
    if (!haveDbCopy()) return;
    const src = await openSqlite(DB_COPY);
    const items = await src.all(`
        SELECT workspace_id, bucket, base, original, upscaled, sort_mtime, in_upscaled_view
        FROM gallery_workspace_items WHERE bucket IN ('files', 'scraps')
        ORDER BY workspace_id, bucket, sort_mtime DESC, base DESC
    `);
    await src.close();
    // Ground truth: position in the paginated listing order (sort_mtime DESC, base DESC).
    const rank = new Map();
    const counters = new Map();
    const upCounters = new Map();
    for (const it of items) {
        const k = `${it.workspace_id}\0${it.bucket}`;
        const n = counters.get(k) || 0;
        counters.set(k, n + 1);
        rank.set(`${k}\0images\0${it.base}`, n);
        if (it.in_upscaled_view) {
            const u = upCounters.get(k) || 0;
            upCounters.set(k, u + 1);
            rank.set(`${k}\0upscaled\0${it.base}`, u);
        }
    }
    // Every 97th row plus every row that shares sort_mtime with a neighbour (the #623 case).
    const sample = items.filter((it, i) => i % 97 === 0
        || (i > 0 && items[i - 1].sort_mtime === it.sort_mtime && items[i - 1].workspace_id === it.workspace_id && items[i - 1].bucket === it.bucket)
        || (i + 1 < items.length && items[i + 1].sort_mtime === it.sort_mtime && items[i + 1].workspace_id === it.workspace_id && items[i + 1].bucket === it.bucket));
    const probes = [];
    for (const it of sample) {
        const viewType = it.bucket === 'scraps' ? 'scraps' : 'images';
        const name = it.original || it.upscaled || `${it.base}.png`;
        probes.push({ ws: it.workspace_id, viewType, name, key: `${it.workspace_id}\0${it.bucket}\0images\0${it.base}` });
        if (it.upscaled && it.bucket === 'files' && it.in_upscaled_view) {
            probes.push({ ws: it.workspace_id, viewType: 'upscaled', name: it.upscaled, key: `${it.workspace_id}\0${it.bucket}\0upscaled\0${it.base}` });
        }
    }
    probes.push({ ws: items[0].workspace_id, viewType: 'images', name: 'does-not-exist.png', key: null });

    const mod = require('../modules/metadataDatabase');
    assert.strictEqual(await mod.initializeDatabase(path.dirname(DB_COPY), new PngMetadata(null)), true);
    const old = requireOldModule('modules/metadataDatabase.js');
    assert.strictEqual(await old.initializeDatabase(path.dirname(DB_COPY), new PngMetadata(null)), true);
    let tOld = 0;
    let tNew = 0;
    let sameAsOld = 0;
    let tieFixed = 0;
    for (const p of probes) {
        let t0 = process.hrtime.bigint();
        const a = await old.findGalleryWorkspaceItemIndex(p.ws, p.viewType, p.name);
        tOld += Number(process.hrtime.bigint() - t0) / 1e6;
        t0 = process.hrtime.bigint();
        const b = await mod.findGalleryWorkspaceItemIndex(p.ws, p.viewType, p.name);
        tNew += Number(process.hrtime.bigint() - t0) / 1e6;
        const truth = p.key == null ? -1 : rank.get(p.key);
        assert.strictEqual(b, truth, `rank for ${p.name} (${p.viewType}) must match listing order`);
        if (a === b) sameAsOld += 1;
        else {
            // Only allowed difference: old ignored rows tied on sort_mtime (#623).
            assert.ok(a < b, `old rank ${a} vs new ${b}: old must only undercount ties`);
            tieFixed += 1;
        }
    }
    await old.closeDatabase();
    await mod.closeDatabase();
    console.log(`  galleryLocate: ${probes.length} probes, ${sameAsOld} same as old, ${tieFixed} tie ranks fixed (#623); ` +
        `old ${(tOld / probes.length).toFixed(2)} ms, new ${(tNew / probes.length).toFixed(2)} ms per call`);
};

// Finding 5: bulk delete / Sequenzia preview_image_hash from one batched DB lookup.
sections.previewHash = async function previewHash() {
    if (!haveDbCopy()) return;
    const liveImages = process.env.PERF_IMAGES_DIR || '/home/kanmi/staticforge/images';
    if (!fs.existsSync(liveImages)) {
        console.log(`  skipped: no images dir ${liveImages}`);
        return;
    }
    const pick = async (where) => (await sampleImageRows(150, `filename NOT LIKE '%_upscaled.png' AND ${where}`))
        .map((r) => r.filename)
        .filter((f) => fs.existsSync(path.join(liveImages, f)));
    const withHash = await pick(`json_extract(metadata, '$.forge_data.dynamic_generation.compiled_prompt.preview_image_hash') IS NOT NULL`);
    const dgNoHash = await pick(`json_type(metadata, '$.forge_data.dynamic_generation') = 'object' AND json_extract(metadata, '$.forge_data.dynamic_generation.compiled_prompt.preview_image_hash') IS NULL`);
    const noDg = await pick(`json_extract(metadata, '$.forge_data.dynamic_generation') IS NULL`);
    const names = [...withHash, ...dgNoHash, ...noDg];

    const mod = require('../modules/metadataDatabase');
    const pm = new PngMetadata(null);
    assert.strictEqual(await mod.initializeDatabase(path.dirname(DB_COPY), pm), true);
    const cacheDir = makeWorkDir('preview-cache');
    fs.mkdirSync(path.join(cacheDir, 'dynGenPreview'));
    const handlers = {
        globalResources: {
            getPath: (key) => (key === 'cache' ? cacheDir : liveImages),
            getMetadataDatabase: () => mod,
            getPngMetadata: () => pm
        }
    };
    const { createDynGenPreviewHashResolver } = require('../modules/ws/handlers/120-galleryHandler');

    const fromFile = async (file) => {
        const buf = await fs.promises.readFile(path.join(liveImages, file));
        const meta = pm.readMetadata(buf);
        if (!meta?.tEXt?.Comment) return null;
        return JSON.parse(meta.tEXt.Comment)?.forge_data?.dynamic_generation?.compiled_prompt?.preview_image_hash || null;
    };
    let t0 = process.hrtime.bigint();
    const expected = [];
    for (const f of names) expected.push(await fromFile(f));
    const oldMs = Number(process.hrtime.bigint() - t0) / 1e6;

    t0 = process.hrtime.bigint();
    const resolve = await createDynGenPreviewHashResolver(handlers, names);
    const actual = [];
    for (const f of names) actual.push(await resolve(f, path.join(liveImages, f)));
    const newMs = Number(process.hrtime.bigint() - t0) / 1e6;

    let mismatches = 0;
    for (let i = 0; i < names.length; i++) {
        if (actual[i] !== expected[i]) {
            mismatches += 1;
            console.log(`  mismatch ${names[i]}: file=${expected[i]} resolver=${actual[i]}`);
        }
    }
    assert.strictEqual(mismatches, 0, 'resolver must return the PNG hash for every file');

    // No dynGenPreview folder: no lookup at all.
    fs.rmdirSync(path.join(cacheDir, 'dynGenPreview'));
    const none = await createDynGenPreviewHashResolver(handlers, names);
    assert.strictEqual(await none(names[0], path.join(liveImages, names[0])), null);
    await mod.closeDatabase();
    console.log(`  previewHash: ${names.length} files (${withHash.length} hash, ${dgNoHash.length} dg w/o hash, ${noDg.length} no dg) ` +
        `match; PNG reads ${oldMs.toFixed(0)} ms -> resolver ${newMs.toFixed(0)} ms`);
};

// #622: bulk "remove preset name" must remove forge_data.preset_name; set keeps working.
sections.preset622 = async function preset622() {
    const pm = new PngMetadata(null);
    const dir = makeWorkDir('preset622');
    const base = await makeNaiLikePng(pm);
    const withPreset = pm.updateMetadata(base, { generation_type: 'generated', preset_name: 'Old Preset' });
    fs.writeFileSync(path.join(dir, 'a.png'), withPreset);
    fs.writeFileSync(path.join(dir, 'b.png'), withPreset);
    fs.writeFileSync(path.join(dir, 'c.png'), base);
    const sent = [];
    const handlers = {
        sendToClient: (_ws, msg) => sent.push(msg),
        sendError: (_ws, msg) => { throw new Error(msg); },
        globalResources: { getPath: () => dir, getPngMetadata: () => pm }
    };
    const galleryHandler = require('../modules/ws/handlers/120-galleryHandler');
    const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');
    galleryHandler.registerPackets(handlers);
    const handle = wsPacketRegistry.getWsPacketHandler('update_image_preset_bulk');
    const run = (message) => handle({ handlers, ws: {}, message, clientInfo: {}, wsServer: { broadcast() {} } });

    await run({ type: 'update_image_preset_bulk', requestId: 'r1', filenames: ['a.png', 'c.png'], presetName: '' });
    const a = readForgeData(pm, fs.readFileSync(path.join(dir, 'a.png')));
    assert.ok(!('preset_name' in a), 'remove must drop preset_name');
    assert.strictEqual(a.generation_type, 'generated', 'other forge_data kept');
    assert.ok(fs.readFileSync(path.join(dir, 'c.png')).equals(base), 'no preset to remove: file unchanged');
    assert.strictEqual(sent[0].data.updatedCount, 2);

    await run({ type: 'update_image_preset_bulk', requestId: 'r2', filenames: ['b.png'], presetName: 'New Preset' });
    assert.strictEqual(readForgeData(pm, fs.readFileSync(path.join(dir, 'b.png'))).preset_name, 'New Preset');
    console.log('  preset622: ok (remove drops preset_name, set still sets it)');
};

// Finding 7: PNG chunk helpers use views + a hoisted CRC table; output must be byte-identical.
sections.pngChunks = async function pngChunks() {
    const OldPng = requireOldModule('modules/pngMetadata.js');
    const oldPm = new OldPng(null);
    const newPm = new PngMetadata(null);
    const buffers = [];
    buffers.push(await makeNaiLikePng(newPm));
    buffers.push(await makeNaiLikePng(newPm, { width: 1024, height: 1024, noise: true }));
    const liveImages = process.env.PERF_IMAGES_DIR || '/home/kanmi/staticforge/images';
    if (fs.existsSync(liveImages)) {
        const names = fs.readdirSync(liveImages).filter((f) => f.endsWith('.png'));
        for (let i = 0; i < names.length && buffers.length < 42; i += Math.max(1, Math.floor(names.length / 40))) {
            buffers.push(fs.readFileSync(path.join(liveImages, names[i])));
        }
    }
    // A Buffer that is a slice of a larger allocation (byteOffset != 0).
    const padded = Buffer.alloc(buffers[0].length + 7);
    buffers[0].copy(padded, 7);
    buffers.push(padded.subarray(7));

    const forge = { generation_type: 'generated', date_generated: 1700000000000, preset_name: 'x', input_prompt: 'a, b' };
    for (const buf of buffers) {
        assert.deepStrictEqual(newPm.readMetadata(buf), oldPm.readMetadata(buf), 'readMetadata');
        for (const [kw, text] of [['Comment', '{"prompt":"p é ☃"}'], ['Source', 'NovelAI'], ['Zeta', 'new keyword']]) {
            const a = oldPm.insertTextChunk(buf, kw, text);
            const b = newPm.insertTextChunk(buf, kw, text);
            assert.ok(Buffer.isBuffer(b) && a.equals(b), `insertTextChunk ${kw} byte-identical`);
        }
        assert.ok(oldPm.updateMetadata(buf, forge).equals(newPm.updateMetadata(buf, forge)), 'updateMetadata byte-identical');
        assert.ok(oldPm.stripPngTextChunks(buf).equals(newPm.stripPngTextChunks(buf)), 'strip byte-identical');
    }
    for (let i = 0; i < 50; i++) {
        const data = crypto.randomBytes(1 + (i * 977) % 70000);
        assert.strictEqual(newPm.calculateCRC(data), oldPm.calculateCRC(data), 'CRC');
    }
    assert.strictEqual(newPm.calculateCRC(Buffer.from('IEND')), 0xAE426082, 'IEND CRC');

    const big = buffers[1];
    const bench = (pm) => {
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < 30; i++) {
            pm.readMetadata(big);
            pm.insertTextChunk(big, 'Comment', '{"prompt":"bench"}');
        }
        return Number(process.hrtime.bigint() - t0) / 1e6 / 30;
    };
    const oldMs = bench(oldPm);
    const newMs = bench(newPm);
    console.log(`  pngChunks: ${buffers.length} PNGs byte-identical; readMetadata+insertTextChunk(Comment) on ${(big.length / 1e6).toFixed(1)} MB: ` +
        `old ${oldMs.toFixed(2)} ms, new ${newMs.toFixed(2)} ms`);
};

/**
 * Pull one method out of modules/globalResources.js (requiring the singleton boots far too much
 * for a unit test) and bind it to a stub `this`.
 */
function loadGlobalResourcesMethod(name, source = null) {
    const src = source || fs.readFileSync(path.join(__dirname, '..', 'modules', 'globalResources.js'), 'utf8');
    const re = new RegExp(`\\n    (async )?${name}\\(`);
    const m = re.exec(src);
    assert.ok(m, `method ${name} not found`);
    const start = m.index + 5;
    const bodyStart = src.indexOf('{', src.indexOf(')', start));
    let depth = 0;
    let end = bodyStart;
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    const text = src.slice(start, end + 1);
    const asFn = text.startsWith('async ') ? `async function ${text.slice(6)}` : `function ${text}`;
    // eslint-disable-next-line no-new-func
    return new Function('require', 'path', `return ${asFn};`)(require, path);
}

// Finding 9: login sprite pick, in-flight guard, async known-bad-paths save.
sections.globalResources = async function globalResourcesSection() {
    const dir = makeWorkDir('gr');
    const imagesDir = path.join(dir, 'images');
    fs.mkdirSync(imagesDir);
    for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(imagesDir, `img${i}.${i % 3 === 0 ? 'jpg' : 'png'}`), '');
    fs.writeFileSync(path.join(imagesDir, 'notes.txt'), '');
    const stub = { getPath: (k) => (k === 'images' ? imagesDir : path.join(dir, 'known_bad_paths.json')) };

    const pick = loadGlobalResourcesMethod('getRandomWorkspaceImages').bind(stub);
    const twenty = await pick(20);
    assert.strictEqual(twenty.length, 20);
    assert.strictEqual(new Set(twenty.map((x) => x.filename)).size, 20, 'no duplicates');
    assert.ok(twenty.every((x) => /\.(png|jpg)$/.test(x.filename) && x.path === path.join(imagesDir, x.filename)));
    assert.strictEqual((await pick()).length, 300, 'no limit: all images');
    // Uniformity: each image's chance to be in a pick of 20 is 20/300.
    const hits = new Map();
    const rounds = 3000;
    for (let r = 0; r < rounds; r++) for (const x of await pick(20)) hits.set(x.filename, (hits.get(x.filename) || 0) + 1);
    const expected = rounds * 20 / 300;
    const worst = Math.max(...[...hits.values()].map((v) => Math.abs(v - expected) / expected));
    assert.ok(worst < 0.35, `pick should be near uniform (worst deviation ${worst.toFixed(2)})`);
    const missing = loadGlobalResourcesMethod('getRandomWorkspaceImages').bind({ getPath: () => path.join(dir, 'nope') });
    assert.deepStrictEqual(await missing(20), []);

    // In-flight guard: concurrent calls share one generation.
    let runs = 0;
    const guardStub = {
        _generateLoginSpriteSheet: async () => { runs++; await new Promise((r) => setTimeout(r, 50)); }
    };
    const gen = loadGlobalResourcesMethod('generateLoginSpriteSheet').bind(guardStub);
    await Promise.all([gen(), gen(), gen()]);
    assert.strictEqual(runs, 1, 'one sprite generation in flight');
    await gen();
    assert.strictEqual(runs, 2, 'guard released after completion');

    // saveKnownBadPaths: async writes land in call order; sync flush still works.
    const badStub = { getPath: stub.getPath, knownBadPaths: new Map() };
    const save = loadGlobalResourcesMethod('saveKnownBadPaths').bind(badStub);
    const writes = [];
    for (let i = 0; i < 5; i++) {
        badStub.knownBadPaths.set(`/probe${i}`, { firstSeen: i, lastSeen: i, hits: 1 });
        writes.push(save());
    }
    await Promise.all(writes);
    const file = path.join(dir, 'known_bad_paths.json');
    assert.strictEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).paths).length, 5, 'newest snapshot on disk');
    badStub.knownBadPaths.set('/probe5', { firstSeen: 5, lastSeen: 5, hits: 1 });
    save(50000, { sync: true });
    assert.strictEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).paths).length, 6, 'sync flush');
    badStub.knownBadPaths.set('/probe6', { firstSeen: 6, lastSeen: 6, hits: 1 });
    await save(3);
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).paths).sort(), ['/probe4', '/probe5', '/probe6'], 'maxPaths keeps newest');
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no temp files left');
    console.log('  globalResources: uniform pick of 20, one sprite generation in flight, ordered async saves');
};

async function timed(fn) {
    const t0 = process.hrtime.bigint();
    const value = await fn();
    return { value, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

// Finding 6: batched omegasearch usages, suggestion scoring/samples, similar groups.
sections.batchedQueries = async function batchedQueries() {
    if (!haveDbCopy()) return;
    const src = await openSqlite(DB_COPY);
    const wsRows = await src.all(`
        SELECT workspace_id, COUNT(*) AS n FROM gallery_workspace_ownership
        WHERE bucket = 'files' GROUP BY workspace_id ORDER BY n DESC
    `);
    const bigWs = wsRows[0].workspace_id;
    const midWs = wsRows[Math.min(3, wsRows.length - 1)].workspace_id;
    const bigFiles = (await src.all(
        `SELECT filename FROM gallery_workspace_ownership WHERE workspace_id = ? AND bucket = 'files' ORDER BY rowid`, [bigWs]
    )).map((r) => r.filename);
    await src.close();

    const mod = require('../modules/metadataDatabase');
    assert.strictEqual(await mod.initializeDatabase(path.dirname(DB_COPY), new PngMetadata(null)), true);
    const old = requireOldModule('modules/metadataDatabase.js');
    assert.strictEqual(await old.initializeDatabase(path.dirname(DB_COPY), new PngMetadata(null)), true);

    // Old/new comparisons use a 3000-file slice (8 chunks): the old usage queries need minutes
    // on the full workspace (~183 s for two substring terms over 19k files).
    const someFiles = bigFiles.slice(0, Number(process.env.PERF_USAGE_FILES || 3000));
    const cases = [
        ['getBlockPromptUsages substring', (m) => m.getBlockPromptUsages(['blue hair', 'smile'], someFiles)],
        ['getBlockPromptUsages word', (m) => m.getBlockPromptUsages([{ terms: ['1girl', 'solo'], matchMode: 'word' }], someFiles)],
        ['getBlockPromptUsages word rare', (m) => m.getBlockPromptUsages([{ terms: ['lighthouse'], matchMode: 'word' }], someFiles)],
        ['getBlockPromptUsages input', (m) => m.getBlockPromptUsages(['hair'], someFiles, { promptSource: 'input' })],
        ['getTagSuggestions hair', (m) => m.getTagSuggestionsFromDatabase('hair', null, 20, { workspaceScope: { workspaceIds: [bigWs] } })],
        ['getTagSuggestions empty', (m) => m.getTagSuggestionsFromDatabase('', null, 20, { workspaceScope: { workspaceIds: [midWs] } })],
        ['listSimilarImageGroups big', (m) => m.listSimilarImageGroupsForWorkspace(bigWs, { groupLimit: 100, itemLimit: 24 })],
        ['listSimilarImageGroups mid', (m) => m.listSimilarImageGroupsForWorkspace(midWs, {})]
    ];
    for (const [label, run] of cases) {
        const a = await timed(() => run(old));
        const b = await timed(() => run(mod));
        assert.deepStrictEqual(b.value, a.value, `${label}: result differs`);
        const size = Array.isArray(b.value) ? b.value.length : (b.value.groups || []).length;
        console.log(`  ${label}: equal (${size} rows); old ${a.ms.toFixed(0)} ms, new ${b.ms.toFixed(0)} ms`);
    }
    for (const [label, blocks] of [['substring', ['blue hair', 'smile']], ['word', [{ terms: ['1girl', 'solo'], matchMode: 'word' }]]]) {
        const b = await timed(() => mod.getBlockPromptUsages(blocks, bigFiles));
        console.log(`  getBlockPromptUsages ${label} over ${bigFiles.length} files (new only): ${b.ms.toFixed(0)} ms`);
    }
    await old.closeDatabase();
    await mod.closeDatabase();
};

// Finding 6 (suggestions): batched sample-file query must pick the same 5 files per tag.
sections.suggestSamples = async function suggestSamples() {
    if (!haveDbCopy()) return;
    const src = await openSqlite(DB_COPY);
    const wsIds = (await src.all(`
        SELECT workspace_id FROM gallery_workspace_ownership WHERE bucket = 'files'
        GROUP BY workspace_id ORDER BY COUNT(*) DESC LIMIT 4
    `)).map((r) => r.workspace_id);
    const someFiles = (await src.all(`SELECT filename FROM images ORDER BY id DESC LIMIT 1500`)).map((r) => r.filename);
    await src.close();
    const mod = require('../modules/metadataDatabase');
    assert.strictEqual(await mod.initializeDatabase(path.dirname(DB_COPY), new PngMetadata(null)), true);
    const old = requireOldModule('modules/metadataDatabase.js');
    assert.strictEqual(await old.initializeDatabase(path.dirname(DB_COPY), new PngMetadata(null)), true);
    let tOld = 0;
    let tNew = 0;
    let n = 0;
    let sampled = 0;
    const queries = ['hair', 'eyes', 'smile', 'dress', 'girl', 'breasts', 'looking', ''];
    for (const ws of wsIds) {
        for (const q of queries) {
            const opts = { workspaceScope: { workspaceIds: [ws] } };
            const a = await timed(() => old.getTagSuggestionsFromDatabase(q, null, 20, opts));
            const b = await timed(() => mod.getTagSuggestionsFromDatabase(q, null, 20, opts));
            assert.deepStrictEqual(b.value, a.value, `suggestions '${q}' in ${ws}`);
            tOld += a.ms;
            tNew += b.ms;
            n += 1;
            sampled += b.value.filter((s) => s.type === 'tag').length;
        }
    }
    for (const q of ['hair', '']) {
        const a = await old.getTagSuggestionsFromDatabase(q, someFiles, 20, {});
        const b = await mod.getTagSuggestionsFromDatabase(q, someFiles, 20, {});
        assert.deepStrictEqual(b, a, `suggestions '${q}' with filename list`);
    }
    await old.closeDatabase();
    await mod.closeDatabase();
    console.log(`  suggestSamples: ${n} workspace queries + 2 list queries equal (${sampled} tag sample sets); ` +
        `old ${(tOld / n).toFixed(0)} ms, new ${(tNew / n).toFixed(0)} ms per query`);
};

// #621: getPromptTermStatsForFilenames sums across 400-file chunks.
sections.termStats621 = async function termStats621() {
    if (!haveDbCopy()) return;
    const src = await openSqlite(DB_COPY);
    const ws = (await src.get(`
        SELECT workspace_id FROM gallery_workspace_ownership WHERE bucket = 'files'
        GROUP BY workspace_id ORDER BY COUNT(*) DESC LIMIT 1
    `)).workspace_id;
    const files = (await src.all(
        `SELECT filename FROM gallery_workspace_ownership WHERE workspace_id = ? AND bucket = 'files' ORDER BY rowid LIMIT 3000`, [ws]
    )).map((r) => r.filename);
    const sources = ['prompt', 'character_prompt', 'v4_character_caption'];
    // Ground truth: one unchunked aggregate over every file.
    const truthRows = await src.all(`
        SELECT t.tag, t.original_tag, COUNT(DISTINCT t.filename) AS n, AVG(ABS(t.weight)) AS w
        FROM json_each(?) j INNER JOIN search_tags t ON t.filename = j.value
        WHERE t.source IN (?, ?, ?)
        GROUP BY t.tag, t.original_tag
    `, [JSON.stringify(files), ...sources]);
    await src.close();
    const truth = new Map();
    for (const r of truthRows) {
        const cur = truth.get(r.tag);
        if (!cur || r.n > cur.n) truth.set(r.tag, r);
    }

    const mod = require('../modules/metadataDatabase');
    assert.strictEqual(await mod.initializeDatabase(path.dirname(DB_COPY), new PngMetadata(null)), true);
    const old = requireOldModule('modules/metadataDatabase.js');
    assert.strictEqual(await old.initializeDatabase(path.dirname(DB_COPY), new PngMetadata(null)), true);

    // <= 400 files (one chunk): identical to the old result.
    const small = files.slice(0, 350);
    assert.deepStrictEqual(await mod.getPromptTermStatsForFilenames(small, { limit: 500 }),
        await old.getPromptTermStatsForFilenames(small, { limit: 500 }), 'single chunk unchanged');

    const fixed = await mod.getPromptTermStatsForFilenames(files, { limit: 100000 });
    const before = await old.getPromptTermStatsForFilenames(files, { limit: 100000 });
    assert.strictEqual(fixed.length, truth.size);
    for (const row of fixed) {
        const t = truth.get(row.tag);
        assert.ok(t, `tag ${row.tag}`);
        assert.strictEqual(row.occurrenceCount, t.n, `count for ${row.tag}`);
        assert.ok(Math.abs(row.avgWeight - (t.w || 0)) < 1e-9, `avgWeight for ${row.tag}`);
    }
    const top = fixed[0];
    const oldTop = before.find((r) => r.tag === top.tag);
    await old.closeDatabase();
    await mod.closeDatabase();
    console.log(`  termStats621: ${files.length} files, ${fixed.length} tags match the unchunked counts; ` +
        `top tag '${top.tag}' ${top.occurrenceCount} files (old said ${oldTop ? oldTop.occurrenceCount : 'n/a'})`);
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
