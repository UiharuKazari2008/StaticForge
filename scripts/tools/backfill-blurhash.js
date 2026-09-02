#!/usr/bin/env node
/**
 * Offline / one-shot BlurHash backfill (DB only — no PNG rewrite).
 *
 * Prefer letting Dreamscape fill missing hashes on boot via syncPreviews.
 * Only use this CLI when the server is STOPPED — a second better-sqlite3
 * writer on metadata.db caused SQLITE_NOTADB / corrupt WAL handles.
 *
 * Usage (from repo root, with Dreamscape stopped):
 *   node scripts/tools/backfill-blurhash.js
 *
 * Env:
 *   BLURHASH_BATCH=200
 *   BLURHASH_CONCURRENCY=4
 *   BLURHASH_LIMIT=0
 *   BLURHASH_FORCE=1
 *   BLURHASH_ALLOW_LIVE=1   Skip the "server running" guard (unsafe)
 */

const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');

function dreamscapeLooksRunning() {
    try {
        const out = execSync('pm2 jlist', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const list = JSON.parse(out);
        const ds = list.find((p) => p.name === 'Dreamscape');
        return ds && ds.pm2_env && ds.pm2_env.status === 'online';
    } catch (_) {
        return false;
    }
}

async function main() {
    if (dreamscapeLooksRunning() && process.env.BLURHASH_ALLOW_LIVE !== '1') {
        console.error('❌ Dreamscape is online. Stop it first, or rely on boot syncPreviews.');
        console.error('   (A second SQLite writer on metadata.db can corrupt WAL handles.)');
        console.error('   Override only if you know what you are doing: BLURHASH_ALLOW_LIVE=1');
        process.exit(1);
    }

    const globalResources = require('../../modules/globalResources');
    const metadataDatabase = require('../../modules/metadataDatabase');
    const ReferenceMetadataDatabase = require('../../modules/referenceMetadataDatabase');

    const databasesPath = globalResources.getPath('databases') || path.join(repoRoot, '.cache');

    console.log('📂 Initializing metadata DB…');
    const ok = await metadataDatabase.initializeDatabase(databasesPath, globalResources.getPngMetadata());
    if (!ok) {
        throw new Error('Failed to initialize metadata database');
    }

    const options = {
        batchSize: process.env.BLURHASH_BATCH,
        concurrency: process.env.BLURHASH_CONCURRENCY,
        limit: process.env.BLURHASH_LIMIT,
        force: process.env.BLURHASH_FORCE === '1' || process.env.BLURHASH_FORCE === 'true',
        imagesDir: globalResources.getPath('images'),
        previewsDir: globalResources.getPath('previews'),
        previewCacheDir: globalResources.getPath('previewCache'),
        uploadCacheDir: globalResources.getPath('uploadCache')
    };

    console.log(
        `📦 Batch ${options.batchSize || 200} | concurrency ${options.concurrency || 4}` +
        `${options.force ? ' | FORCE' : ''}`
    );

    const imageStats = await metadataDatabase.backfillMissingBlurhashes(options);

    const refDb = new ReferenceMetadataDatabase(globalResources);
    const refStats = await refDb.backfillMissingBlurhashes(options);
    refDb.close();

    await metadataDatabase.closeDatabase();

    console.log('\n✅ BlurHash backfill complete (DB only — no PNG metadata rewritten)');
    console.log(JSON.stringify({ images: imageStats, references: refStats }, null, 2));
}

main().catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
});
