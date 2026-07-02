#!/usr/bin/env node
/**
 * Incremental prompt FTS backfill (Phase 5 — prompt_fts_compiled / prompt_fts_input).
 *
 * Builds FTS5 rows from existing image_prompt_text lanes — no metadata re-parse.
 * Does NOT run on boot. Requires prompt blob backfill first (blob_extract_attempted = 1).
 *
 * Usage (from repo root, server may stay running):
 *
 *   node scripts/tools/backfill-prompt-fts.js
 *
 * Options (env):
 *   WRITE_PROMPT_FTS=0              Kill switch — skip FTS upserts (default: on)
 *   PROMPT_FTS_BACKFILL_BATCH=500   Files per batch (default 500, min 50)
 *   BACKFILL_MAX_BATCHES=N          Stop after N batches (default: run until queue empty)
 *   STATICFORGE_CACHE=path          Override .cache dir (default: <repo>/.cache)
 *
 * Safe operation:
 *   - Batched transactions (500 files default)
 *   - Single-pass queue: fts_extract_attempted = 0 AND blob_extract_attempted = 1
 *   - fts_extract_attempted set even when all lanes are empty (prevents infinite re-queue)
 *
 * After backfill, FTS word-mode search is enabled by default (USE_FTS_PROMPT_SEARCH).
 *
 * Expected runtime (~53k images, server running): ~3–10 minutes depending on disk/WAL
 *
 * Examples:
 *   node scripts/tools/backfill-prompt-fts.js
 *   PROMPT_FTS_BACKFILL_BATCH=500 BACKFILL_MAX_BATCHES=5 node scripts/tools/backfill-prompt-fts.js
 */

const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const cacheDir = process.env.STATICFORGE_CACHE || path.join(repoRoot, '.cache');

const {
    initializeDatabase,
    closeDatabase,
    backfillPromptFts
} = require('../../modules/metadataDatabase');

function parseMaxBatches() {
    const raw = process.env.BACKFILL_MAX_BATCHES;
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
    const writeDisabled = process.env.WRITE_PROMPT_FTS === '0'
        || process.env.WRITE_PROMPT_FTS === 'false';

    if (writeDisabled) {
        console.error('❌ WRITE_PROMPT_FTS=0 — nothing to do.');
        process.exit(1);
    }

    const batchSize = parseInt(process.env.PROMPT_FTS_BACKFILL_BATCH || '500', 10) || 500;
    const maxBatches = parseMaxBatches();

    console.log(`📂 Database cache dir: ${cacheDir}`);
    console.log(`📦 Batch size: ${batchSize}${maxBatches != null ? `, max batches: ${maxBatches}` : ''}`);
    console.log('⚡ Mode: prompt_fts_fast (from image_prompt_text, no metadata parse)');

    await initializeDatabase(cacheDir);

    const started = Date.now();
    const result = await backfillPromptFts({
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
    console.log('\n✅ Prompt FTS backfill finished');
    console.log(`   Mode:    ${result.mode || 'prompt_fts_fast'}`);
    console.log(`   Updated: ${result.updatedCount}`);
    console.log(`   Errors:  ${result.errorCount}`);
    console.log(`   Skipped: ${result.skippedCount} (empty lanes)`);
    console.log(`   Batches: ${result.batches}`);
    console.log(`   Elapsed: ${elapsed}s`);
    console.log('\nFTS word-mode search is on by default after backfill (set USE_FTS_PROMPT_SEARCH=0 to disable).');

    if (result.errorCount > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('❌ Prompt FTS backfill failed:', err);
    process.exit(1);
});
