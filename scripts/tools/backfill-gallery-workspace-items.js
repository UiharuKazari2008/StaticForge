#!/usr/bin/env node
/**
 * Manual backfill for gallery_workspace_items (materialized paired gallery index).
 *
 * Builds paired rows + revision meta from gallery_workspace_ownership only.
 * Day-to-day updates go through upsertGalleryOwnership / removeGalleryOwnership hooks.
 * Boot calls ensureGalleryWorkspaceItemsFromOwnership after ownership is settled.
 *
 * Usage (from repo root, server may stay running):
 *
 *   node scripts/tools/backfill-gallery-workspace-items.js
 *
 * Options (env):
 *   WRITE_GALLERY_ITEMS=0     Kill switch — skip rebuild (default: on)
 *   STATICFORGE_CACHE=path    Override .cache dir (default: <repo>/.cache)
 *   GALLERY_ITEMS_TRUNCATE=1  DELETE all item/meta rows before rebuild
 */

const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const cacheDir = process.env.STATICFORGE_CACHE || path.join(repoRoot, '.cache');

const {
    initializeDatabase,
    closeDatabase,
    backfillGalleryWorkspaceItemsFromOwnership
} = require('../../modules/metadataDatabase');

async function main() {
    const writeDisabled = process.env.WRITE_GALLERY_ITEMS === '0'
        || process.env.WRITE_GALLERY_ITEMS === 'false'
        || process.env.WRITE_GALLERY_OWNERSHIP === '0'
        || process.env.WRITE_GALLERY_OWNERSHIP === 'false';

    if (writeDisabled) {
        console.error('❌ WRITE_GALLERY_ITEMS=0 — nothing to do.');
        process.exit(1);
    }

    const truncateFirst = process.env.GALLERY_ITEMS_TRUNCATE === '1'
        || process.env.GALLERY_ITEMS_TRUNCATE === 'true';

    console.log(`📂 Database cache dir: ${cacheDir}`);
    if (truncateFirst) {
        console.log('⚠️  GALLERY_ITEMS_TRUNCATE=1 — full table wipe before rebuild');
    }

    await initializeDatabase(cacheDir);

    const started = Date.now();
    const result = await backfillGalleryWorkspaceItemsFromOwnership({ truncateFirst });
    await closeDatabase();

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log('\n✅ Gallery workspace items backfill finished');
    console.log(`   Rebuilt: ${result.rebuilt} paired rows across ${result.workspaces} workspaces`);
    console.log(`   Elapsed: ${elapsed}s`);
}

main().catch((err) => {
    console.error('❌ Gallery workspace items backfill failed:', err);
    process.exit(1);
});
