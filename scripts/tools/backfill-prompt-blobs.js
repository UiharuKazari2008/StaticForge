#!/usr/bin/env node
/**
 * Incremental prompt blob backfill (Phase 4 — image_prompt_text).
 *
 * Populates image_prompt_text from stored images.metadata JSON only — no full tag re-index.
 * Does NOT run on boot.
 *
 * Usage (from repo root, server may stay running):
 *
 *   node scripts/tools/backfill-prompt-blobs.js
 *
 * Options (env):
 *   WRITE_PROMPT_BLOBS=0          Kill switch — skip blob upserts (default: on)
 *   PROMPT_BLOB_BACKFILL_BATCH=500  Files per batch (default 500, min 50)
 *   BACKFILL_MAX_BATCHES=N        Stop after N batches (default: run until queue empty)
 *   STATICFORGE_CACHE=path        Override .cache dir (default: <repo>/.cache)
 *
 * Safe operation:
 *   - Batched transactions (500 files default)
 *   - Skips metadata JSON > 5 MB (MAX_METADATA_JSON_SIZE)
 *   - Strips forge_data.stage_seeds before indexing (OOM guard)
 *   - Single-pass queue: no image_prompt_text rows AND blob_extract_attempted = 0
 *   - blob_extract_attempted set even when all lanes are empty (prevents infinite re-queue)
 *
 * After backfill, blob LIKE search is enabled by default (USE_PROMPT_BLOB_SEARCH).
 *
 * Expected runtime (~53k images, server running): ~5–15 minutes depending on disk/WAL
 *
 * Examples:
 *   node scripts/tools/backfill-prompt-blobs.js
 *   PROMPT_BLOB_BACKFILL_BATCH=500 BACKFILL_MAX_BATCHES=5 node scripts/tools/backfill-prompt-blobs.js
 */

const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const cacheDir = process.env.STATICFORGE_CACHE || path.join(repoRoot, '.cache');

const {
    initializeDatabase,
    closeDatabase,
    backfillPromptBlobs
} = require('../../modules/metadataDatabase');

function parseMaxBatches() {
    const raw = process.env.BACKFILL_MAX_BATCHES;
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
    const writeDisabled = process.env.WRITE_PROMPT_BLOBS === '0'
        || process.env.WRITE_PROMPT_BLOBS === 'false';

    if (writeDisabled) {
        console.error('❌ WRITE_PROMPT_BLOBS=0 — nothing to do.');
        process.exit(1);
    }

    const batchSize = parseInt(process.env.PROMPT_BLOB_BACKFILL_BATCH || '500', 10) || 500;
    const maxBatches = parseMaxBatches();

    console.log(`📂 Database cache dir: ${cacheDir}`);
    console.log(`📦 Batch size: ${batchSize}${maxBatches != null ? `, max batches: ${maxBatches}` : ''}`);
    console.log('⚡ Mode: prompt_blobs_fast (metadata JSON only, no tag re-index)');

    await initializeDatabase(cacheDir);

    const started = Date.now();
    const result = await backfillPromptBlobs({
        batchSize,
        maxBatches,
        progressCallback(progress) {
            if (progress.filename) {
                console.log(
                    `  … batch ${progress.batch}: ${progress.updatedCount} ok, `
                    + `${progress.errorCount} err, ${progress.skippedCount} skipped — ${progress.filename}`
                );
            }
        }
    });

    await closeDatabase();

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log('\n✅ Prompt blob backfill finished');
    console.log(`   Mode:    ${result.mode || 'prompt_blobs_fast'}`);
    console.log(`   Updated: ${result.updatedCount}`);
    console.log(`   Errors:  ${result.errorCount}`);
    console.log(`   Skipped: ${result.skippedCount} (oversize metadata)`);
    console.log(`   Batches: ${result.batches}`);
    console.log(`   Elapsed: ${elapsed}s`);
    console.log('\nBlob LIKE search is on by default after backfill (set USE_PROMPT_BLOB_SEARCH=0 to disable).');

    if (result.errorCount > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('❌ Prompt blob backfill failed:', err);
    process.exit(1);
});
