#!/usr/bin/env node
/**
 * Incremental search facet + model_norm backfill (fast path by default).
 *
 * Default mode re-extracts image_search_facets, search_models, and search_presets
 * from stored images.metadata JSON only — no full prompt tag re-index (minutes for ~53k).
 *
 * Usage (from repo root, server may stay running; uses metadata.db directly):
 *
 *   node scripts/tools/backfill-search-facets.js
 *
 * Options (env):
 *   WRITE_SEARCH_FACETS=0       Kill switch — skip facet column upserts (default: on)
 *   FACET_BACKFILL_BATCH=500    Files per batch (default 500, min 50)
 *   BACKFILL_MAX_BATCHES=N      Stop after N batches (default: run until queue empty)
 *   BACKFILL_FULL_INDEX=1       Also backfill input_prompt search_tags (fast path — no full tag re-index)
 *   STATICFORGE_CACHE=path      Override .cache dir (default: <repo>/.cache)
 *
 * Safe operation:
 *   - Batched 500 files per transaction in fast mode
 *   - Keyset pagination + input_prompt_tags_extract_attempted flag (steady throughput)
 *   - WAL checkpoint every 10 batches (BACKFILL_WAL_CHECKPOINT_EVERY), TRUNCATE on interval + at end
 *   - Skips metadata JSON > 5 MB (MAX_METADATA_JSON_SIZE)
 *   - Strips forge_data.stage_seeds before indexing (OOM guard)
 *   - model_extract_attempted prevents infinite re-queue when model_norm cannot be derived
 *
 * Expected runtime (fast mode, ~53k images, server running):
 *   ~8–20 minutes depending on WAL contention and disk speed
 *
 * Examples:
 *   node scripts/tools/backfill-search-facets.js
 *   FACET_BACKFILL_BATCH=500 BACKFILL_MAX_BATCHES=5 node scripts/tools/backfill-search-facets.js
 *   BACKFILL_FULL_INDEX=1 node scripts/tools/backfill-search-facets.js
 *     (input_prompt_fast: facets + input_prompt tags only, ~10–25 min for ~53k)
 */

const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const cacheDir = process.env.STATICFORGE_CACHE || path.join(repoRoot, '.cache');

const {
    initializeDatabase,
    closeDatabase,
    backfillSearchExtraction
} = require('../../modules/metadataDatabase');

function parseMaxBatches() {
    const raw = process.env.BACKFILL_MAX_BATCHES;
    if (raw == null || raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
    if (process.env.WRITE_SEARCH_FACETS === '0' || process.env.WRITE_SEARCH_FACETS === 'false') {
        console.warn('⚠️  WRITE_SEARCH_FACETS=0 — facets will not be updated (search_models/presets still will).\n');
    }

    const fullIndex = process.env.BACKFILL_FULL_INDEX === '1' || process.env.BACKFILL_FULL_INDEX === 'true';
    const batchSize = parseInt(process.env.FACET_BACKFILL_BATCH || '500', 10) || 500;
    const maxBatches = parseMaxBatches();

    console.log(`📂 Database cache dir: ${cacheDir}`);
    console.log(`📦 Batch size: ${batchSize}${maxBatches != null ? `, max batches: ${maxBatches}` : ''}`);
    console.log(`⚡ Mode: ${fullIndex ? 'input_prompt_fast (facets + input_prompt tags)' : 'facets_fast (model_norm + facets only)'}`);
    console.log('🔌 Opening database…');

    await initializeDatabase(cacheDir);
    console.log('✅ Database ready — scanning backlog (first batch query may take ~10s)\n');

    const started = Date.now();
    const result = await backfillSearchExtraction({
        batchSize,
        maxBatches,
        fullIndex,
        progressCallback(progress) {
            if (progress.status === 'querying_batch') {
                console.log(`  … fetching batch ${progress.batch}…`);
                return;
            }
            if (progress.status === 'batch_fetched') {
                const queryNote = progress.queryMs != null ? `, query ${progress.queryMs}ms` : '';
                console.log(`  … batch ${progress.batch}: ${progress.batchSize} files queued${queryNote}`);
                return;
            }
            if (progress.status === 'batch_complete') {
                console.log(
                    `  ✓ batch ${progress.batch} done: ${progress.batchMs}ms total`
                    + ` (query ${progress.queryMs}ms, ${progress.filesPerSec} files/sec)`
                    + ` — ${progress.updatedCount} ok, ${progress.errorCount} err, ${progress.skippedCount} skipped`
                );
                return;
            }
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
    console.log('\n✅ Search extraction backfill finished');
    console.log(`   Mode:    ${result.mode || (fullIndex ? 'input_prompt_fast' : 'facets_fast')}`);
    console.log(`   Updated: ${result.updatedCount}`);
    console.log(`   Errors:  ${result.errorCount}`);
    console.log(`   Skipped: ${result.skippedCount} (oversize metadata)`);
    console.log(`   Batches: ${result.batches}`);
    console.log(`   Elapsed: ${elapsed}s`);

    if (result.errorCount > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
});
