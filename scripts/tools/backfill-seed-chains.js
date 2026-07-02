#!/usr/bin/env node
/**
 * Full seed-chain rebuild (Phase 7 — image_seed_chain + consecutive_seed_group_id).
 *
 * Precomputes consecutive same-seed runs (24h window) for the consecutiveSeeds filter.
 * Does NOT run on boot.
 *
 * Usage (from repo root, server may stay running):
 *
 *   node scripts/tools/backfill-seed-chains.js
 *
 * Options (env):
 *   STATICFORGE_CACHE=path   Override .cache dir (default: <repo>/.cache)
 *
 * Safe operation:
 *   - Single full-corpus pass ordered by mtime (deterministic group_id)
 *   - Wipes image_seed_chain then rebuilds (idempotent)
 *   - Sets image_search_facets.consecutive_seed_group_id for runs of 2+ files
 *
 * After backfill, consecutiveSeeds filter uses precomputed groups by default (USE_SEED_CHAIN_INDEX).
 *
 * Expected runtime (~53k images, server running): ~2–8 minutes depending on disk/WAL
 *
 * Examples:
 *   node scripts/tools/backfill-seed-chains.js
 */

const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const cacheDir = process.env.STATICFORGE_CACHE || path.join(repoRoot, '.cache');

const {
    initializeDatabase,
    closeDatabase,
    backfillSeedChains
} = require('../../modules/metadataDatabase');

async function main() {
    console.log(`📂 Database cache dir: ${cacheDir}`);
    console.log('⚡ Mode: seed_chains_full (single pass, mtime-ordered)');

    await initializeDatabase(cacheDir);

    const started = Date.now();
    const result = await backfillSeedChains({
        progressCallback(progress) {
            if (progress.filename) {
                console.log(
                    `  … ${progress.current}/${progress.total} files, `
                    + `${progress.groupsWritten} groups — ${progress.filename}`
                );
            }
        }
    });

    await closeDatabase();

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log('\n✅ Seed chain backfill finished');
    console.log(`   Mode:     ${result.mode || 'seed_chains_full'}`);
    console.log(`   Processed: ${result.processed}`);
    console.log(`   Groups:   ${result.groupsWritten}`);
    console.log(`   Elapsed:  ${elapsed}s`);
    console.log('\nConsecutiveSeeds filter is on by default after backfill (set USE_SEED_CHAIN_INDEX=0 to disable).');
}

main().catch((err) => {
    console.error('❌ Seed chain backfill failed:', err);
    process.exit(1);
});
