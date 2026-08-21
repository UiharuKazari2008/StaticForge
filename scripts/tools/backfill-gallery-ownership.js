#!/usr/bin/env node
/**
 * Manual backfill for gallery_workspace_ownership (Phase 3 — Ownership JOIN).
 *
 * Populates gallery_workspace_ownership from workspace.json.
 * Run once after migration or to rebuild; day-to-day updates go through workspace.js upsert/remove.
 * Boot also calls ensureGalleryOwnershipFromWorkspaces when the table is empty or counts drift.
 *
 * Usage (from repo root, server may stay running):
 *
 *   node scripts/tools/backfill-gallery-ownership.js
 *
 * Options (env):
 *   WRITE_GALLERY_OWNERSHIP=0   Kill switch — skip upserts (default: on)
 *   STATICFORGE_CACHE=path      Override .cache dir (default: <repo>/.cache)
 *   GALLERY_OWNERSHIP_TRUNCATE=1  DELETE all ownership rows before upsert (full rebuild)
 *   GALLERY_OWNERSHIP_BATCH=500   Rows per progress log batch (default 500)
 *
 * After backfill, SQL workspace scope is enabled by default (USE_WORKSPACE_MEMBERSHIP).
 *
 * Deferred incremental writers (wired in workspace.js):
 *   addToWorkspaceArray / removeFromWorkspaceArray / moveToWorkspaceArray / handlePinnedScrappedFilesOnMove
 *   syncWorkspaceFiles / deleteWorkspace / dumpWorkspace / organizeOrphanedFiles
 *   bulkAddToWorkspaceArray / bulkRemoveFromWorkspaceArray
 *   imageGeneration.js — post-generation addToWorkspaceArray
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const cacheDir = process.env.STATICFORGE_CACHE || path.join(repoRoot, '.cache');
const workspaceFile = path.join(cacheDir, 'workspace.json');

const {
    initializeDatabase,
    closeDatabase,
    backfillGalleryOwnershipFromWorkspaces
} = require('../../modules/metadataDatabase');

function loadWorkspaces() {
    if (!fs.existsSync(workspaceFile)) {
        throw new Error(`workspace.json not found: ${workspaceFile}`);
    }
    const raw = fs.readFileSync(workspaceFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.workspaces && typeof parsed.workspaces === 'object') {
        return parsed.workspaces;
    }
    return parsed;
}

async function main() {
    const writeDisabled = process.env.WRITE_GALLERY_OWNERSHIP === '0'
        || process.env.WRITE_GALLERY_OWNERSHIP === 'false'
        || process.env.WRITE_WORKSPACE_MEMBERSHIP === '0'
        || process.env.WRITE_WORKSPACE_MEMBERSHIP === 'false';

    if (writeDisabled) {
        console.error('❌ WRITE_GALLERY_OWNERSHIP=0 (or WRITE_WORKSPACE_MEMBERSHIP=0) — nothing to do.');
        process.exit(1);
    }

    const truncateFirst = process.env.GALLERY_OWNERSHIP_TRUNCATE === '1'
        || process.env.GALLERY_OWNERSHIP_TRUNCATE === 'true';
    const batchSize = parseInt(process.env.GALLERY_OWNERSHIP_BATCH || '500', 10) || 500;

    console.log(`📂 Database cache dir: ${cacheDir}`);
    console.log(`📄 Workspace config: ${workspaceFile}`);
    if (truncateFirst) {
        console.log('⚠️  GALLERY_OWNERSHIP_TRUNCATE=1 — full table wipe before upsert');
    }

    const workspaces = loadWorkspaces();
    const workspaceCount = Object.keys(workspaces).length;
    console.log(`🗂️  Workspaces: ${workspaceCount}`);

    await initializeDatabase(cacheDir);

    const started = Date.now();
    const result = await backfillGalleryOwnershipFromWorkspaces(workspaces, {
        truncateFirst,
        batchSize
    });
    await closeDatabase();

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log('\n✅ Gallery ownership backfill finished');
    console.log(`   Upserted: ${result.upserted} / ${result.totalRows} rows`);
    console.log(`   Elapsed: ${elapsed}s`);
    console.log('\nSQL workspace scope is on by default after backfill (set USE_WORKSPACE_MEMBERSHIP=0 to disable).');
}

main().catch((err) => {
    console.error('❌ Gallery ownership backfill failed:', err);
    process.exit(1);
});
