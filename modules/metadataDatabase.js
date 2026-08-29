const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const logger = require('./logger');
// Note: globalResources is NOT required here to avoid circular dependency
// It will be accessed lazily when needed
const { isImageLarge, getResolutionFromDimensions } = require('./imageTools');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');
const metadataWriteQueue = require('./metadataWriteQueue');
const { parsePromptSegments } = require('./promptSegments');
const { isTextColonPrefix, stripTextColonPrefix } = require('./promptTextBoundary');
const omegasearchFilters = require('./omegasearchFilters');

let db = null;
let readOnlyDb = null;
let readOnlyDbPath = null;
let metadataReadDb = null;
let metadataReadDbPath = null;
let dbPath = null;
let dbInitialized = false;
let _pngMetadata = null;
let indexingPaused = false; // Track if indexing is paused globally
let searchIndexSyncUpToDateUntil = 0;
const SEARCH_INDEX_SYNC_UP_TO_DATE_TTL_MS = 12 * 60 * 60 * 1000;
const SEARCH_INDEX_SYNC_BATCH_SIZE = 100;

/*
 * I Spy search indexing (docs/design/ispy-search-indexing-PLAN.md §5).
 * Phases 2–7 default ON. Set any flag to '0' or 'false' to disable (debug kill switch).
 * One-shot backfill CLIs: scripts/tools/backfill-*.js (BACKFILL_FULL_INDEX stays CLI-only opt-in).
 * BlurHash missing-row fill also runs on boot inside globalResources.syncPreviews (live DB only).
 */
const envOn = (name) => process.env[name] !== '0' && process.env[name] !== 'false';
const USE_FACET_FILTERS = envOn('USE_FACET_FILTERS');
const USE_WORKSPACE_MEMBERSHIP = envOn('USE_WORKSPACE_MEMBERSHIP');
const USE_PROMPT_BLOB_SEARCH = envOn('USE_PROMPT_BLOB_SEARCH');
const USE_FTS_PROMPT_SEARCH = envOn('USE_FTS_PROMPT_SEARCH');
const USE_AGGREGATED_SCORING = envOn('USE_AGGREGATED_SCORING');
const USE_SEED_CHAIN_INDEX = envOn('USE_SEED_CHAIN_INDEX');
const WRITE_SEARCH_FACETS = envOn('WRITE_SEARCH_FACETS');
const WRITE_PROMPT_BLOBS = envOn('WRITE_PROMPT_BLOBS');
const WRITE_PROMPT_FTS = envOn('WRITE_PROMPT_FTS');
const WRITE_SEED_CHAIN_INDEX = envOn('WRITE_SEED_CHAIN_INDEX');
const WRITE_WORKSPACE_MEMBERSHIP = envOn('WRITE_WORKSPACE_MEMBERSHIP');
const WRITE_GALLERY_OWNERSHIP = envOn('WRITE_GALLERY_OWNERSHIP') || WRITE_WORKSPACE_MEMBERSHIP;
const WRITE_GALLERY_ITEMS = envOn('WRITE_GALLERY_ITEMS') || WRITE_GALLERY_OWNERSHIP;
const GALLERY_OWNERSHIP_TABLE = 'gallery_workspace_ownership';
const GALLERY_ITEMS_TABLE = 'gallery_workspace_items';
const GALLERY_INDEX_META_TABLE = 'gallery_workspace_index_meta';
const GALLERY_PINS_TABLE = 'gallery_workspace_pins';
const GALLERY_BLOCK_META_TABLE = 'gallery_workspace_block_meta';
const GALLERY_BLOCK_SIZE = 750;
/** @type {Map<string, { start?: { sortMtime: number, base: string }, end?: { sortMtime: number, base: string } }>} */
const galleryBlockCursorMemory = new Map();
const FACET_BACKFILL_BATCH = Math.max(50, parseInt(process.env.FACET_BACKFILL_BATCH || '500', 10) || 500);
const PROMPT_BLOB_BACKFILL_BATCH = Math.max(50, parseInt(process.env.PROMPT_BLOB_BACKFILL_BATCH || '500', 10) || 500);
const PROMPT_FTS_BACKFILL_BATCH = Math.max(50, parseInt(process.env.PROMPT_FTS_BACKFILL_BATCH || '500', 10) || 500);
const SEED_CHAIN_BACKFILL_BATCH = Math.max(50, parseInt(process.env.SEED_CHAIN_BACKFILL_BATCH || '500', 10) || 500);
const CONSECUTIVE_SEED_MAX_GAP_MS = 86400000;
const BACKFILL_FULL_INDEX = process.env.BACKFILL_FULL_INDEX === '1' || process.env.BACKFILL_FULL_INDEX === 'true';
const BACKFILL_WAL_CHECKPOINT_EVERY = Math.max(1, parseInt(process.env.BACKFILL_WAL_CHECKPOINT_EVERY || '10', 10) || 10);
const MAX_METADATA_JSON_SIZE = 5 * 1024 * 1024;
/** images.mtime is ms; facet indexed_at / facet.mtime are unix seconds */
const SQL_IMAGE_MTIME_SECS = 'CASE WHEN i.mtime > 1000000000000 THEN i.mtime / 1000 ELSE i.mtime END';

/**
 * Initialize the SQLite database
 * @param {string} databasesPath - Path to databases directory (passed from globalResources to avoid circular dependency)
 * @param {Object} _pngMetadataInstance - _pngMetadata instance (passed from globalResources to avoid circular dependency)
 */
async function initializeDatabase(databasesPath = null, _pngMetadataInstance = null) {
    if (_pngMetadataInstance) {
        _pngMetadata = _pngMetadataInstance;
    }
    try {
        // Get database path - use provided path or fall back to globalResources (for backward compatibility)
        if (!databasesPath) {
            // Lazy access to avoid circular dependency issues
            const globalResources = require('./globalResources');
            databasesPath = globalResources.getPath('databases');
        }
        dbPath = path.join(databasesPath, 'metadata.db');
        
        // Ensure cache directory exists
        if (!fs.existsSync(databasesPath)) {
            fs.mkdirSync(databasesPath, { recursive: true });
        }
        
        // Initialize async wrapper (checkpoint manager is automatically connected)
        db = new SQLiteAsyncWrapper(dbPath, 'metadata', 30); // 30 minute idle timeout
        
        // Initialize database (opens connection and creates tables)
        await db.initialize();
        
        // Create tables if they don't exist
        await createTables();
        
        dbInitialized = true;
        // Defer readiness probe well past first-client connect. Never run heavy search-table
        // scans on the shared read-only handle used by gallery pagination.
        setTimeout(() => {
            backfillSearchIndexesReadyFlagIfComplete().catch((error) => {
                logger.warn('Search index readiness backfill failed:', error.message);
            });
        }, 120000);
        return true;
    } catch (error) {
        logger.error('Error initializing SQLite database:', error);
        console.error('Full error stack:', error.stack);
        return false;
    }
}

/**
 * Create database tables
 */
async function createTables() {
    // Images table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            md5 TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            parent TEXT,
            upscaled BOOLEAN DEFAULT 0,
            size INTEGER,
            mtime INTEGER,
            blurhash TEXT,
            metadata TEXT, -- JSON string for PNG metadata
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    
    
    // Receipts table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER,
            timestamp INTEGER,
            receipt_data TEXT, -- JSON string for receipt data
            FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE
        )
    `);
    
    // Unattributed receipts table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS unattributed_receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date INTEGER,
            receipt_data TEXT, -- JSON string for receipt data
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    
    // Search index tables for efficient searching
    await db.exec(`
        CREATE TABLE IF NOT EXISTS search_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            tag TEXT NOT NULL,
            original_tag TEXT NOT NULL,
            weight REAL NOT NULL DEFAULT 0,
            tag_type TEXT NOT NULL DEFAULT 'normal',
            source TEXT NOT NULL DEFAULT 'prompt',
            character TEXT,
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS search_fulltext (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            text_content TEXT NOT NULL,
            original_text TEXT NOT NULL,
            weight REAL NOT NULL DEFAULT 0,
            text_type TEXT NOT NULL DEFAULT 'full_text',
            source TEXT NOT NULL DEFAULT 'prompt',
            character TEXT,
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS search_characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            character_name TEXT NOT NULL,
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS search_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            preset_name TEXT NOT NULL,
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS search_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            model_name TEXT NOT NULL,
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);

    // Denormalized generation params for Omegasearch / I Spy filters (Phase 1 schema)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS image_search_facets (
            filename TEXT PRIMARY KEY,
            image_id INTEGER,
            model TEXT,
            model_norm TEXT,
            preset_name TEXT,
            parent TEXT,
            chain_source TEXT,
            seed TEXT,
            layer1_seed TEXT,
            steps INTEGER,
            guidance REAL,
            rescale REAL,
            sampler TEXT,
            sampler_norm TEXT,
            scheduler TEXT,
            scheduler_norm TEXT,
            width INTEGER,
            height INTEGER,
            resolution_tier TEXT,
            resolution_preset TEXT,
            upscaled INTEGER NOT NULL DEFAULT 0,
            quality_preset INTEGER,
            uc_level INTEGER,
            nsfw_level INTEGER,
            has_dynamic_replacements INTEGER NOT NULL DEFAULT 0,
            mtime INTEGER,
            date_generated_ms INTEGER,
            consecutive_seed_group_id TEXT,
            refine_group_id TEXT,
            indexed_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);

    // Workspace file membership mirror for SQL-side Omegasearch scoping (Phase 2 legacy — full wipe)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS image_workspace_membership (
            workspace_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            bucket TEXT NOT NULL DEFAULT 'files',
            PRIMARY KEY (workspace_id, filename, bucket),
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);

    // Incremental gallery ownership for SQL-side Omegasearch scoping (Phase 3 — reference_workspace_ownership pattern)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS gallery_workspace_ownership (
            filename TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            bucket TEXT NOT NULL DEFAULT 'files',
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (filename, workspace_id, bucket),
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);

    // Materialized paired gallery index — maintained on ownership writes only (no read-side rebuild).
    await db.exec(`
        CREATE TABLE IF NOT EXISTS gallery_workspace_items (
            workspace_id TEXT NOT NULL,
            bucket TEXT NOT NULL DEFAULT 'files',
            base TEXT NOT NULL,
            original TEXT,
            upscaled TEXT,
            sort_mtime INTEGER NOT NULL DEFAULT 0,
            width INTEGER,
            height INTEGER,
            size INTEGER NOT NULL DEFAULT 0,
            in_upscaled_view INTEGER NOT NULL DEFAULT 0,
            blurhash TEXT,
            PRIMARY KEY (workspace_id, bucket, base)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS gallery_workspace_index_meta (
            workspace_id TEXT NOT NULL,
            view_type TEXT NOT NULL,
            total_items INTEGER NOT NULL DEFAULT 0,
            head_seq INTEGER NOT NULL DEFAULT 0,
            body_rev INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER,
            PRIMARY KEY (workspace_id, view_type)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS gallery_workspace_pins (
            workspace_id TEXT NOT NULL,
            base TEXT NOT NULL,
            pinned_at INTEGER NOT NULL,
            pin_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (workspace_id, base)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS ${GALLERY_BLOCK_META_TABLE} (
            workspace_id TEXT NOT NULL,
            view_type TEXT NOT NULL,
            block_offset INTEGER NOT NULL,
            block_rev INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (workspace_id, view_type, block_offset)
        )
    `);

    // Per-image prompt blobs for substring/start/end/inner search (Phase 4)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS image_prompt_text (
            filename TEXT NOT NULL,
            lane TEXT NOT NULL,
            text_norm TEXT NOT NULL,
            PRIMARY KEY (filename, lane),
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);

    // FTS5 for word-mode prompt search (Phase 5)
    await db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS prompt_fts_compiled USING fts5(
            filename UNINDEXED,
            body,
            tokenize = 'unicode61 remove_diacritics 2'
        )
    `);
    await db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS prompt_fts_input USING fts5(
            filename UNINDEXED,
            body,
            tokenize = 'unicode61 remove_diacritics 2'
        )
    `);

    // Precomputed consecutive seed groups (Phase 7)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS image_seed_chain (
            group_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            seed TEXT NOT NULL,
            mtime INTEGER NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (group_id, filename),
            FOREIGN KEY (filename) REFERENCES images (filename) ON DELETE CASCADE
        )
    `);
    
    // Create indexes for better performance
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_images_filename ON images (filename);
        CREATE INDEX IF NOT EXISTS idx_images_md5 ON images (md5);
        CREATE INDEX IF NOT EXISTS idx_images_parent ON images (parent);
        CREATE INDEX IF NOT EXISTS idx_receipts_image_id ON receipts (image_id);
        CREATE INDEX IF NOT EXISTS idx_receipts_timestamp ON receipts (timestamp);
        CREATE INDEX IF NOT EXISTS idx_search_tags_filename ON search_tags (filename);
        CREATE INDEX IF NOT EXISTS idx_search_tags_tag ON search_tags (tag);
        CREATE INDEX IF NOT EXISTS idx_search_tags_source ON search_tags (source);
        CREATE INDEX IF NOT EXISTS idx_search_tags_filename_source ON search_tags (filename, source);
        CREATE INDEX IF NOT EXISTS idx_search_fulltext_filename ON search_fulltext (filename);
        CREATE INDEX IF NOT EXISTS idx_search_fulltext_content ON search_fulltext (text_content);
        CREATE INDEX IF NOT EXISTS idx_search_fulltext_source ON search_fulltext (source);
        CREATE INDEX IF NOT EXISTS idx_search_characters_filename ON search_characters (filename);
        CREATE INDEX IF NOT EXISTS idx_search_characters_name ON search_characters (character_name);
        CREATE INDEX IF NOT EXISTS idx_search_presets_filename ON search_presets (filename);
        CREATE INDEX IF NOT EXISTS idx_search_presets_name ON search_presets (preset_name);
        CREATE INDEX IF NOT EXISTS idx_search_models_filename ON search_models (filename);
        CREATE INDEX IF NOT EXISTS idx_search_models_name ON search_models (model_name);
        CREATE INDEX IF NOT EXISTS idx_facets_mtime ON image_search_facets (mtime);
        CREATE INDEX IF NOT EXISTS idx_facets_date_gen ON image_search_facets (date_generated_ms);
        CREATE INDEX IF NOT EXISTS idx_facets_model ON image_search_facets (model_norm);
        CREATE INDEX IF NOT EXISTS idx_facets_steps ON image_search_facets (steps);
        CREATE INDEX IF NOT EXISTS idx_facets_guidance ON image_search_facets (guidance);
        CREATE INDEX IF NOT EXISTS idx_facets_rescale ON image_search_facets (rescale);
        CREATE INDEX IF NOT EXISTS idx_facets_sampler ON image_search_facets (sampler_norm);
        CREATE INDEX IF NOT EXISTS idx_facets_scheduler ON image_search_facets (scheduler_norm);
        CREATE INDEX IF NOT EXISTS idx_facets_resolution ON image_search_facets (resolution_tier);
        CREATE INDEX IF NOT EXISTS idx_facets_upscaled ON image_search_facets (upscaled);
        CREATE INDEX IF NOT EXISTS idx_facets_quality ON image_search_facets (quality_preset);
        CREATE INDEX IF NOT EXISTS idx_facets_uc ON image_search_facets (uc_level);
        CREATE INDEX IF NOT EXISTS idx_facets_nsfw ON image_search_facets (nsfw_level);
        CREATE INDEX IF NOT EXISTS idx_facets_dynrepl ON image_search_facets (has_dynamic_replacements);
        CREATE INDEX IF NOT EXISTS idx_facets_seed ON image_search_facets (seed);
        CREATE INDEX IF NOT EXISTS idx_facets_chain ON image_search_facets (chain_source);
        CREATE INDEX IF NOT EXISTS idx_facets_consec_group ON image_search_facets (consecutive_seed_group_id);
        CREATE INDEX IF NOT EXISTS idx_facets_refine_group ON image_search_facets (refine_group_id);
        CREATE INDEX IF NOT EXISTS idx_facets_model_steps_mtime ON image_search_facets (model_norm, steps, mtime DESC);
        CREATE INDEX IF NOT EXISTS idx_iwm_workspace_bucket ON image_workspace_membership (workspace_id, bucket);
        CREATE INDEX IF NOT EXISTS idx_iwm_filename ON image_workspace_membership (filename);
        CREATE INDEX IF NOT EXISTS idx_gwo_workspace_bucket ON gallery_workspace_ownership (workspace_id, bucket);
        CREATE INDEX IF NOT EXISTS idx_gwo_filename ON gallery_workspace_ownership (filename);
        CREATE INDEX IF NOT EXISTS idx_gwi_workspace_bucket_sort ON gallery_workspace_items (workspace_id, bucket, sort_mtime DESC);
        CREATE INDEX IF NOT EXISTS idx_gwi_workspace_bucket_sort_base ON gallery_workspace_items (workspace_id, bucket, sort_mtime DESC, base DESC);
        CREATE INDEX IF NOT EXISTS idx_gwi_upscaled_view ON gallery_workspace_items (workspace_id, bucket, in_upscaled_view, sort_mtime DESC);
        CREATE INDEX IF NOT EXISTS idx_gwp_workspace ON gallery_workspace_pins (workspace_id, pin_order, pinned_at);
        CREATE INDEX IF NOT EXISTS idx_gwbm_workspace_view ON ${GALLERY_BLOCK_META_TABLE} (workspace_id, view_type, block_offset);
        CREATE INDEX IF NOT EXISTS idx_prompt_text_lane ON image_prompt_text (lane);
        CREATE INDEX IF NOT EXISTS idx_seed_chain_group ON image_seed_chain (group_id);
        CREATE INDEX IF NOT EXISTS idx_seed_chain_filename ON image_seed_chain (filename);
    `);

    // Migration: model_extract_attempted — skip re-queue when model_norm cannot be derived
    try {
        const facetCols = await db.all(`PRAGMA table_info(image_search_facets)`);
        if (!facetCols.some((col) => col.name === 'model_extract_attempted')) {
            await db.exec(`ALTER TABLE image_search_facets ADD COLUMN model_extract_attempted INTEGER NOT NULL DEFAULT 0`);
            logger.info('✅ Added model_extract_attempted column to image_search_facets');
        }
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.warn('Could not add model_extract_attempted column:', error.message);
        }
    }

    try {
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_facets_model_extract ON image_search_facets (model_extract_attempted)`);
    } catch (error) {
        if (!error.message.includes('no such column')) {
            logger.warn('Could not create idx_facets_model_extract:', error.message);
        }
    }

    // Migration: blob_extract_attempted — skip re-queue when all prompt lanes are empty
    let blobExtractColumnJustAdded = false;
    try {
        const imageCols = await db.all(`PRAGMA table_info(images)`);
        if (!imageCols.some((col) => col.name === 'blob_extract_attempted')) {
            await db.exec(`ALTER TABLE images ADD COLUMN blob_extract_attempted INTEGER NOT NULL DEFAULT 0`);
            blobExtractColumnJustAdded = true;
            logger.info('✅ Added blob_extract_attempted column to images');
        }
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.warn('Could not add blob_extract_attempted column:', error.message);
        }
    }

    try {
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_images_blob_extract ON images (blob_extract_attempted)`);
        if (blobExtractColumnJustAdded) {
            await db.exec(`
                UPDATE images SET blob_extract_attempted = 1
                WHERE blob_extract_attempted = 0
                  AND EXISTS (SELECT 1 FROM image_prompt_text p WHERE p.filename = images.filename)
            `);
        }
    } catch (error) {
        if (!error.message.includes('no such column')) {
            logger.warn('Could not create idx_images_blob_extract or backfill attempted flag:', error.message);
        }
    }

    // Migration: fts_extract_attempted — skip FTS re-queue after single-pass backfill
    let ftsExtractColumnJustAdded = false;
    try {
        const imageColsFts = await db.all(`PRAGMA table_info(images)`);
        if (!imageColsFts.some((col) => col.name === 'fts_extract_attempted')) {
            await db.exec(`ALTER TABLE images ADD COLUMN fts_extract_attempted INTEGER NOT NULL DEFAULT 0`);
            ftsExtractColumnJustAdded = true;
            logger.info('✅ Added fts_extract_attempted column to images');
        }
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.warn('Could not add fts_extract_attempted column:', error.message);
        }
    }

    try {
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_images_fts_extract ON images (fts_extract_attempted)`);
        if (ftsExtractColumnJustAdded) {
            await db.exec(`
                UPDATE images SET fts_extract_attempted = 1
                WHERE fts_extract_attempted = 0
                  AND (
                      EXISTS (SELECT 1 FROM prompt_fts_compiled c WHERE c.filename = images.filename)
                      OR EXISTS (SELECT 1 FROM prompt_fts_input inp WHERE inp.filename = images.filename)
                  )
            `);
        }
    } catch (error) {
        if (!error.message.includes('no such column') && !error.message.includes('no such table')) {
            logger.warn('Could not create idx_images_fts_extract or backfill attempted flag:', error.message);
        }
    }

    // Migration: input_prompt_tags_extract_attempted — single-pass input_prompt tag backfill queue
    let inputPromptTagsColumnJustAdded = false;
    try {
        const imageColsInputTags = await db.all(`PRAGMA table_info(images)`);
        if (!imageColsInputTags.some((col) => col.name === 'input_prompt_tags_extract_attempted')) {
            await db.exec(`ALTER TABLE images ADD COLUMN input_prompt_tags_extract_attempted INTEGER NOT NULL DEFAULT 0`);
            inputPromptTagsColumnJustAdded = true;
            logger.info('✅ Added input_prompt_tags_extract_attempted column to images');
        }
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.warn('Could not add input_prompt_tags_extract_attempted column:', error.message);
        }
    }

    try {
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_images_input_prompt_tags_extract ON images (input_prompt_tags_extract_attempted, filename)`);
        if (inputPromptTagsColumnJustAdded) {
            await db.exec(`
                UPDATE images SET input_prompt_tags_extract_attempted = 1
                WHERE input_prompt_tags_extract_attempted = 0
                  AND (
                      EXISTS (
                          SELECT 1 FROM search_tags st
                          WHERE st.filename = images.filename AND st.source = 'input_prompt'
                      )
                      OR NOT EXISTS (
                          SELECT 1 FROM image_prompt_text p
                          WHERE p.filename = images.filename AND p.lane = 'input' AND p.text_norm != ''
                      )
                  )
            `);
        }
    } catch (error) {
        if (!error.message.includes('no such column') && !error.message.includes('no such table')) {
            logger.warn('Could not create idx_images_input_prompt_tags_extract or backfill attempted flag:', error.message);
        }
    }

    // Migration: Drop thumbnail column if it exists (removed in favor of other preview systems)
    try {
        await db.exec(`ALTER TABLE images DROP COLUMN thumbnail`);
        logger.info('✅ Dropped thumbnail column from images table (migration complete)');
    } catch (error) {
        // Column may not exist or may have already been dropped, ignore error
        if (!error.message.includes('no such column') && !error.message.includes('duplicate column name')) {
            logger.warn('Could not drop thumbnail column:', error.message);
        }
    }

    // Migration: gallery index meta revision columns (gallery-cache-revision-system)
    try {
        const metaCols = await db.all(`PRAGMA table_info(${GALLERY_INDEX_META_TABLE})`);
        const colNames = new Set((metaCols || []).map((col) => col.name));
        if (!colNames.has('head_seq')) {
            await db.exec(`ALTER TABLE ${GALLERY_INDEX_META_TABLE} ADD COLUMN head_seq INTEGER NOT NULL DEFAULT 0`);
            logger.info('✅ Added head_seq column to gallery_workspace_index_meta');
        }
        if (!colNames.has('body_rev')) {
            await db.exec(`ALTER TABLE ${GALLERY_INDEX_META_TABLE} ADD COLUMN body_rev INTEGER NOT NULL DEFAULT 0`);
            logger.info('✅ Added body_rev column to gallery_workspace_index_meta');
        }
        if (colNames.has('gallery_hash')) {
            await db.exec(`ALTER TABLE ${GALLERY_INDEX_META_TABLE} DROP COLUMN gallery_hash`);
            logger.info('✅ Dropped legacy gallery_hash column from gallery_workspace_index_meta');
        }
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.warn('Could not add gallery index revision columns:', error.message);
        }
    }

    // Migration: block boundary cursors for keyset pagination (avoids OFFSET scans during block fetch)
    try {
        const blockCols = await db.all(`PRAGMA table_info(${GALLERY_BLOCK_META_TABLE})`);
        const blockColNames = new Set((blockCols || []).map((col) => col.name));
        if (!blockColNames.has('start_sort_mtime')) {
            await db.exec(`ALTER TABLE ${GALLERY_BLOCK_META_TABLE} ADD COLUMN start_sort_mtime INTEGER`);
            logger.info('✅ Added start_sort_mtime column to gallery_workspace_block_meta');
        }
        if (!blockColNames.has('start_base')) {
            await db.exec(`ALTER TABLE ${GALLERY_BLOCK_META_TABLE} ADD COLUMN start_base TEXT`);
            logger.info('✅ Added start_base column to gallery_workspace_block_meta');
        }
        if (!blockColNames.has('end_sort_mtime')) {
            await db.exec(`ALTER TABLE ${GALLERY_BLOCK_META_TABLE} ADD COLUMN end_sort_mtime INTEGER`);
            logger.info('✅ Added end_sort_mtime column to gallery_workspace_block_meta');
        }
        if (!blockColNames.has('end_base')) {
            await db.exec(`ALTER TABLE ${GALLERY_BLOCK_META_TABLE} ADD COLUMN end_base TEXT`);
            logger.info('✅ Added end_base column to gallery_workspace_block_meta');
        }
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.warn('Could not add gallery block boundary columns:', error.message);
        }
    }

    // Migration: per-image search index readiness (O(1) sync probe vs full-table LEFT JOIN scan)
    try {
        const imageCols = await db.all('PRAGMA table_info(images)');
        const imageColNames = new Set((imageCols || []).map((col) => col.name));
        if (!imageColNames.has('search_indexes_ready')) {
            await db.exec('ALTER TABLE images ADD COLUMN search_indexes_ready INTEGER NOT NULL DEFAULT 0');
            logger.info('✅ Added search_indexes_ready column to images');
        }
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_images_search_indexes_pending ON images (filename) WHERE search_indexes_ready = 0`);
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.warn('Could not add search_indexes_ready column:', error.message);
        }
    }

    // Migration: BlurHash on images + gallery_workspace_items (list path has no joins)
    try {
        const imageColsBh = await db.all('PRAGMA table_info(images)');
        if (!(imageColsBh || []).some((c) => c.name === 'blurhash')) {
            await db.exec('ALTER TABLE images ADD COLUMN blurhash TEXT');
            logger.info('✅ Added blurhash column to images');
        }
        const gwiCols = await db.all(`PRAGMA table_info(${GALLERY_ITEMS_TABLE})`);
        if (!(gwiCols || []).some((c) => c.name === 'blurhash')) {
            await db.exec(`ALTER TABLE ${GALLERY_ITEMS_TABLE} ADD COLUMN blurhash TEXT`);
            logger.info('✅ Added blurhash column to gallery_workspace_items');
        }
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.warn('Could not add blurhash columns:', error.message);
        }
    }

    logger.bootSubStep('Metadata database ready');
}

/**
 * Close database connection
 */
async function closeDatabase() {
    await metadataWriteQueue.drainAll();
    if (readOnlyDb) {
        try {
            await readOnlyDb.close();
        } catch (_error) {
            // Ignore close errors during shutdown.
        }
        readOnlyDb = null;
        readOnlyDbPath = null;
    }
    if (metadataReadDb) {
        try {
            await metadataReadDb.close();
        } catch (_error) {
            // Ignore close errors during shutdown.
        }
        metadataReadDb = null;
        metadataReadDbPath = null;
    }
    if (db) {
        await db.close();
        db = null;
        logger.info('Database connection closed');
    }
}

/**
 * Read-only SQLite handle for index meta probes (WAL allows concurrent reads during writes).
 */
async function getReadOnlyDatabase() {
    if (!dbPath || !dbInitialized) {
        return null;
    }
    if (readOnlyDb && readOnlyDbPath === dbPath) {
        return readOnlyDb;
    }
    if (readOnlyDb) {
        try {
            await readOnlyDb.close();
        } catch (_error) {
            // Ignore close errors when reopening on a new path.
        }
        readOnlyDb = null;
    }

    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    readOnlyDb = await open({
        filename: dbPath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY
    });
    await readOnlyDb.exec('PRAGMA journal_mode = WAL');
    await readOnlyDb.exec('PRAGMA busy_timeout = 60000');
    readOnlyDbPath = dbPath;
    return readOnlyDb;
}

/**
 * Separate read-only handle for single-row metadata lookups so they are not
 * serialized behind gallery block pagination on getReadOnlyDatabase().
 */
async function getMetadataReadDatabase() {
    if (!dbPath || !dbInitialized) {
        return null;
    }
    if (metadataReadDb && metadataReadDbPath === dbPath) {
        return metadataReadDb;
    }
    if (metadataReadDb) {
        try {
            await metadataReadDb.close();
        } catch (_error) {
            // Ignore close errors when reopening on a new path.
        }
        metadataReadDb = null;
    }

    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    metadataReadDb = await open({
        filename: dbPath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY
    });
    await metadataReadDb.exec('PRAGMA journal_mode = WAL');
    await metadataReadDb.exec('PRAGMA busy_timeout = 5000');
    metadataReadDbPath = dbPath;
    return metadataReadDb;
}

/**
 * Generate MD5 hash for a file
 */
function generateMD5(filePath) {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        return crypto.createHash('md5').update(fileBuffer).digest('hex');
    } catch (error) {
        console.error(`❌ Error generating MD5 for ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Extract image metadata using Sharp
 */
async function extractImageMetadata(filePath) {
    try {
        const metadata = await sharp(filePath).metadata();
        return {
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            space: metadata.space,
            channels: metadata.channels,
            depth: metadata.depth,
            density: metadata.density,
            hasProfile: metadata.hasProfile,
            hasAlpha: metadata.hasAlpha
        };
    } catch (error) {
        console.error(`❌ Error extracting metadata for ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Determine if an image is upscaled and find its parent (stat only — no directory scan).
 */
function determineImageRelationships(filename, imagesDir) {
    const isUpscaled = filename.includes('_upscaled');
    let parent = null;

    if (isUpscaled) {
        const originalName = filename.replace('_upscaled.png', '.png');
        if (fs.existsSync(path.join(imagesDir, originalName))) {
            parent = originalName;
        }
    }

    return {
        isUpscaled,
        parent
    };
}

/**
 * Format a database row into the standard metadata object shape.
 */
function formatDbImageRow(image, receipts = []) {
    return {
        ...image,
        receipt: receipts.map(r => JSON.parse(r.receipt_data)),
        metadata: image.metadata ? JSON.parse(image.metadata) : {},
        upscaled: Boolean(image.upscaled)
    };
}

/**
 * Merge forge data into an in-memory metadata object (no I/O).
 */
function applyForgeDataToMetadata(metadata, forgeData) {
    if (!metadata || !forgeData) return metadata;
    if (!metadata.metadata) metadata.metadata = {};
    if (!metadata.metadata.forge_data) metadata.metadata.forge_data = {};
    for (const [key, value] of Object.entries(forgeData)) {
        if (value !== null) {
            metadata.metadata.forge_data[key] = value;
        }
    }
    if (forgeData.blurhash) {
        metadata.blurhash = forgeData.blurhash;
    }
    return metadata;
}

/**
 * Persist BlurHash on images row and refresh denormalized gallery_workspace_items (DB only — no PNG rewrite).
 */
async function setImageBlurhash(filename, blurhash) {
    if (!filename || !blurhash || !dbInitialized || !db) {
        return false;
    }
    const hash = String(blurhash).trim();
    if (!hash) return false;

    await db.run(
        `UPDATE images SET blurhash = ?, updated_at = strftime('%s', 'now') WHERE filename = ?`,
        [hash, filename]
    );

    const hot = metadataWriteQueue.getHotImage(filename);
    if (hot) {
        hot.blurhash = hash;
        if (!hot.metadata) hot.metadata = {};
        if (!hot.metadata.forge_data) hot.metadata.forge_data = {};
        hot.metadata.forge_data.blurhash = hash;
    }

    if (WRITE_GALLERY_ITEMS) {
        await refreshGalleryWorkspaceItemsForFilename(filename);
    }
    return true;
}

/**
 * Copy images.blurhash onto gallery_workspace_items without joins at read time (bulk sync after backfill).
 */
async function syncGalleryItemBlurhashesFromImages() {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }
    const result = await db.run(`
        UPDATE ${GALLERY_ITEMS_TABLE}
        SET blurhash = (
            SELECT i.blurhash FROM images i
            WHERE i.filename = COALESCE(${GALLERY_ITEMS_TABLE}.upscaled, ${GALLERY_ITEMS_TABLE}.original)
              AND i.blurhash IS NOT NULL
            LIMIT 1
        )
        WHERE EXISTS (
            SELECT 1 FROM images i
            WHERE i.filename = COALESCE(${GALLERY_ITEMS_TABLE}.upscaled, ${GALLERY_ITEMS_TABLE}.original)
              AND i.blurhash IS NOT NULL
        )
    `);
    return { changes: result?.changes || 0 };
}

/**
 * Fill missing images.blurhash from .previews / images (DB only — no PNG rewrite).
 * Uses the live metadata connection (safe during boot / while server is up).
 * @param {Object} [options]
 * @param {string} [options.imagesDir]
 * @param {string} [options.previewsDir]
 * @param {number} [options.batchSize]
 * @param {number} [options.concurrency]
 * @param {number} [options.limit]
 * @param {boolean} [options.force]
 * @param {Function} [options.log]
 */
async function backfillMissingBlurhashes(options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const blurhashBackfill = require('./blurhashBackfill');
    const opts = blurhashBackfill.resolveOptions(options);
    const log = opts.log;

    let imagesDir = options.imagesDir;
    let previewsDir = options.previewsDir;
    if (!imagesDir || !previewsDir) {
        const globalResources = require('./globalResources');
        imagesDir = imagesDir || globalResources.getPath('images');
        previewsDir = previewsDir || globalResources.getPath('previews');
    }

    const where = opts.force ? '' : "WHERE blurhash IS NULL OR blurhash = ''";
    let rows = await db.all(`SELECT filename FROM images ${where} ORDER BY filename`);
    if (opts.limit > 0) rows = rows.slice(0, opts.limit);

    log(
        `🖼️  Gallery BlurHash backfill: ${rows.length} row(s)` +
        `${opts.force ? ' (force)' : ''} — chunk ${opts.batchSize}, concurrency ${opts.concurrency}`
    );

    const totals = await blurhashBackfill.processInChunks(rows, {
        batchSize: opts.batchSize,
        concurrency: opts.concurrency,
        label: 'images',
        log,
        encodeOne: async (row) => {
            const hash = await blurhashBackfill.encodeGalleryBlurhash(row.filename, {
                imagesDir,
                previewsDir
            });
            return hash ? [hash, row.filename] : null;
        },
        commitPairs: async (pairs) => {
            try {
                await db.run('BEGIN TRANSACTION');
            } catch (txError) {
                logger.warn('BlurHash backfill begin failed, continuing without transaction:', txError.message);
            }
            for (const [hash, filename] of pairs) {
                await db.run(
                    `UPDATE images SET blurhash = ?, updated_at = strftime('%s', 'now') WHERE filename = ?`,
                    [hash, filename]
                );
                const hot = metadataWriteQueue.getHotImage(filename);
                if (hot) {
                    hot.blurhash = hash;
                    if (hot.metadata?.forge_data) {
                        hot.metadata.forge_data.blurhash = hash;
                    }
                }
            }
            try {
                await db.run('COMMIT');
            } catch (txError) {
                try {
                    await db.run('ROLLBACK');
                } catch (_) { /* ignore */ }
                logger.error('BlurHash backfill commit failed:', txError);
                throw txError;
            }
        }
    });

    let gallerySynced = 0;
    if (totals.updated > 0 || rows.length > 0) {
        const sync = await syncGalleryItemBlurhashesFromImages();
        gallerySynced = sync.changes || 0;
        log(`📋 Synced gallery_workspace_items.blurhash (${gallerySynced} rows)`);
    }

    return {
        updated: totals.updated,
        failed: totals.failed,
        total: rows.length,
        gallerySynced
    };
}

/**
 * Build image metadata from disk without touching SQL.
 */
async function buildImageMetadataFromFile(filename, imagesDir, existingReceipts = []) {
    const filePath = path.join(imagesDir, filename);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    const stats = fs.statSync(filePath);
    const md5 = generateMD5(filePath);
    const imageMetadata = await extractImageMetadata(filePath);
    if (!imageMetadata) {
        return null;
    }

    let extractedMetadata = {};
    try {
        extractedMetadata = await _pngMetadata.extractNovelAIMetadata(filePath) || {};
    } catch (error) {
        console.error(`❌ Error extracting PNG metadata for ${filename}:`, error.message);
    }

    const relationships = determineImageRelationships(filename, imagesDir);

    return {
        filename,
        md5,
        width: imageMetadata.width,
        height: imageMetadata.height,
        parent: relationships.parent,
        upscaled: relationships.isUpscaled,
        receipt: Array.isArray(existingReceipts) ? [...existingReceipts] : [],
        size: stats.size,
        mtime: stats.mtime.valueOf(),
        metadata: extractedMetadata || {}
    };
}

/**
 * Persist one image row and refresh search indexes (SQL only — run via write queue).
 */
async function persistImageRowToDb(filename, metadata) {
    const pngMeta = metadata.metadata || {};
    const blurhash = metadata.blurhash
        || pngMeta?.forge_data?.blurhash
        || null;
    const insertResult = await db.run(`
        INSERT OR REPLACE INTO images (filename, md5, width, height, parent, upscaled, size, mtime, blurhash, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?,
            COALESCE(?, (SELECT blurhash FROM images WHERE filename = ?)),
            ?,
            COALESCE((SELECT created_at FROM images WHERE filename = ?), strftime('%s', 'now')),
            strftime('%s', 'now'))
    `, [
        filename,
        metadata.md5,
        metadata.width,
        metadata.height,
        metadata.parent,
        metadata.upscaled ? 1 : 0,
        metadata.size,
        metadata.mtime,
        blurhash,
        filename,
        JSON.stringify(pngMeta),
        filename
    ]);

    const metadataWithParsed = {
        id: insertResult.lastID || metadata.id || null,
        filename,
        md5: metadata.md5,
        width: metadata.width,
        height: metadata.height,
        parent: metadata.parent,
        upscaled: Boolean(metadata.upscaled),
        size: metadata.size,
        mtime: metadata.mtime,
        blurhash: blurhash || metadata.blurhash || null,
        metadata: pngMeta
    };
    scheduleSearchIndexUpdate(filename, metadataWithParsed, 'persist-image');
    return metadataWithParsed.id;
}

/**
 * Persist one receipt row (SQL only — run via write queue).
 */
async function persistReceiptToDb(filename, receiptData, imageId = null) {
    let resolvedId = imageId;
    if (!resolvedId) {
        const image = await db.get('SELECT id FROM images WHERE filename = ?', [filename]);
        resolvedId = image?.id;
    }
    if (!resolvedId) {
        console.warn(`⚠️ No metadata found for ${filename}, cannot add receipt`);
        return false;
    }

    await db.run(`
        INSERT INTO receipts (image_id, timestamp, receipt_data)
        VALUES (?, ?, ?)
    `, [resolvedId, receiptData.date || Date.now(), JSON.stringify(receiptData)]);

    return true;
}

/**
 * Queue image metadata persistence without blocking the caller on SQL.
 */
function queueImageMetadataPersist(filename, metadata, label = 'image') {
    metadataWriteQueue.stageImage(filename, metadata);
    metadataWriteQueue.enqueue(
        () => persistImageRowToDb(filename, metadata),
        `${label}:${filename}`,
        { onSuccess: () => metadataWriteQueue.markImagePersisted(filename) }
    );
    if (WRITE_GALLERY_ITEMS) {
        metadataWriteQueue.enqueue(async () => {
            await refreshGalleryWorkspaceItemsForFilename(filename);
        }, `gallery-item-refresh:${filename}`);
    }
}

/**
 * Defer heavy search index rebuilds so primary metadata SQL stays fast.
 */
function scheduleSearchIndexUpdate(filename, metadata, label = 'search-index') {
    if (!filename || !metadata) return;
    metadataWriteQueue.enqueueBackground(
        () => updateSearchIndexes(filename, metadata),
        `${label}:${filename}`
    );
}

/**
 * Project a hot-cache record to lightweight sort fields.
 */
function projectLightweightMetadata(hot) {
    return {
        filename: hot.filename,
        mtime: hot.mtime || Date.now(),
        width: hot.width || null,
        height: hot.height || null,
        size: hot.size || 0,
        upscaled: Boolean(hot.upscaled),
        parent: hot.parent || null,
        blurhash: hot.blurhash || hot.metadata?.forge_data?.blurhash || null
    };
}

/**
 * Get or create metadata for a single image
 */
async function getImageMetadata(filename, imagesDir) {
    try {
        if (!dbInitialized || !db) {
            throw new Error('Database not initialized');
        }

        const hot = metadataWriteQueue.getHotImage(filename);
        if (hot) {
            const filePath = path.join(imagesDir, filename);
            if (fs.existsSync(filePath)) {
                const currentMD5 = generateMD5(filePath);
                if (currentMD5 === hot.md5) {
                    return hot;
                }
            }
        }

        const filePath = path.join(imagesDir, filename);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️ File not found: ${filePath}`);
            return null;
        }

        // Check if we already have cached metadata
        const existing = await db.get('SELECT * FROM images WHERE filename = ?', [filename]);

        if (existing) {
            // Verify the cached MD5 matches the current file
            const currentMD5 = generateMD5(filePath);
            if (currentMD5 === existing.md5) {
                const receipts = await db.all('SELECT receipt_data FROM receipts WHERE image_id = ? ORDER BY timestamp', [existing.id]);
                return formatDbImageRow(existing, receipts);
            }

            console.log(`🔄 MD5 changed for ${filename}, updating metadata`);
        }

        const existingReceipts = hot?.receipt || [];
        const metadata = await buildImageMetadataFromFile(filename, imagesDir, existingReceipts);
        if (!metadata) {
            console.error(`❌ Failed to extract metadata for ${filename}`);
            return null;
        }

        queueImageMetadataPersist(filename, metadata, 'image');
        return metadataWriteQueue.getHotImage(filename) || metadata;
    } catch (error) {
        console.error(`❌ Error in getImageMetadata for ${filename}:`, error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}

/**
 * Scan all images and update missing metadata
 */
async function scanAndUpdateMetadata(imagesDir) {
    try {
        console.log('🔍 Scanning images for missing metadata...');
        
        // Get existing filenames from database
        const existingFilesSet = new Set((await db.all('SELECT filename FROM images')).map(row => row.filename));
        
        // Get all image files from directory
        const allFiles = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
        const missingFiles = allFiles.filter(f => !existingFilesSet.has(f));
        
        let updatedCount = 0;
        let errorCount = 0;
        
        for (const filename of missingFiles) {
            try {
                const metadata = await getImageMetadata(filename, imagesDir);
                if (metadata) {
                    updatedCount++;
                } else {
                    errorCount++;
                }
            } catch (error) {
                console.error(`❌ Error processing ${filename}:`, error.message);
                errorCount++;
            }
        }
        
        console.log(`✅ Metadata scan complete: ${updatedCount} updated, ${errorCount} errors`);
        
        return { updatedCount, errorCount, totalFiles: missingFiles.length };
    } catch (error) {
        console.error('❌ Error scanning metadata:', error.message);
        return { updatedCount: 0, errorCount: 1, totalFiles: 0 };
    }
}

/**
 * Force rebuild metadata cache for all images
 * This will re-extract PNG metadata from all files regardless of MD5
 */
async function rebuildMetadataCache(imagesDir, progressCallback = null) {
    try {
        console.log('🔄 Rebuilding metadata cache for all images...');
        
        if (!dbInitialized || !db) {
            throw new Error('Database not initialized');
        }
        
        // Get all image files from directory
        const allFiles = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
        
        let updatedCount = 0;
        let errorCount = 0;
        const totalFiles = allFiles.length;
        
        for (let i = 0; i < allFiles.length; i++) {
            const filename = allFiles[i];
            try {
                const filePath = path.join(imagesDir, filename);
                
                // Check if file exists
                if (!fs.existsSync(filePath)) {
                    console.warn(`⚠️ File not found: ${filePath}`);
                    errorCount++;
                    continue;
                }
                
                // Extract new metadata
                const stats = fs.statSync(filePath);
                const md5 = generateMD5(filePath);
                const imageMetadata = await extractImageMetadata(filePath);
                
                if (!imageMetadata) {
                    console.error(`❌ Failed to extract metadata for ${filename}`);
                    errorCount++;
                    continue;
                }
                
                // Extract PNG embedded metadata
                let extractedMetadata = null;
                try {
                    extractedMetadata = await _pngMetadata.extractNovelAIMetadata(filePath);
                } catch (error) {
                    console.error(`❌ Error extracting PNG metadata for ${filename}:`, error.message);
                    extractedMetadata = {};
                }
                
                // Get all files to determine relationships
                const relationships = determineImageRelationships(filename, imagesDir);
                
                // Update in database using INSERT OR REPLACE
                await db.run(`
                    INSERT OR REPLACE INTO images (filename, md5, width, height, parent, upscaled, size, mtime, metadata, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 
                        COALESCE((SELECT created_at FROM images WHERE filename = ?), strftime('%s', 'now')),
                        strftime('%s', 'now'))
                `, [
                    filename, md5, imageMetadata.width, imageMetadata.height,
                    relationships.parent, relationships.isUpscaled ? 1 : 0,
                    stats.size, stats.mtime.valueOf(), JSON.stringify(extractedMetadata || {}),
                    filename // For the COALESCE subquery
                ]);
                
                updatedCount++;
                
                // Send progress update if callback provided
                if (progressCallback) {
                    progressCallback({
                        current: i + 1,
                        total: totalFiles,
                        filename: filename,
                        updatedCount,
                        errorCount
                    });
                }
                
            } catch (error) {
                console.error(`❌ Error processing ${filename}:`, error.message);
                errorCount++;
            }
        }
        
        console.log(`✅ Metadata cache rebuild complete: ${updatedCount} updated, ${errorCount} errors`);
        
        return { updatedCount, errorCount, totalFiles };
    } catch (error) {
        console.error('❌ Error rebuilding metadata cache:', error.message);
        return { updatedCount: 0, errorCount: 1, totalFiles: 0 };
    }
}

/**
 * Add receipt data to image metadata
 */
async function addReceipt(filename, receiptData) {
    const image = await db.get('SELECT id FROM images WHERE filename = ?', [filename]);
    
    if (!image) {
        console.warn(`⚠️ No metadata found for ${filename}, cannot add receipt`);
        return false;
    }
    
    await db.run(`
        INSERT INTO receipts (image_id, timestamp, receipt_data)
        VALUES (?, ?, ?)
    `, [image.id, Date.now(), JSON.stringify(receiptData)]);
    
    return true;
}

async function removeGalleryPinsForBases(bases) {
    if (!WRITE_GALLERY_ITEMS || !dbInitialized || !db || !Array.isArray(bases) || bases.length === 0) {
        return 0;
    }

    const validBases = [...new Set(
        bases
            .map((entry) => (typeof entry === 'string' ? getGalleryBaseName(entry) : ''))
            .filter(Boolean)
    )];
    if (!validBases.length) {
        return 0;
    }

    const placeholders = validBases.map(() => '?').join(',');
    const workspaceRows = await db.all(
        `SELECT DISTINCT workspace_id FROM ${GALLERY_PINS_TABLE} WHERE base IN (${placeholders})`,
        validBases
    );
    const result = await db.run(
        `DELETE FROM ${GALLERY_PINS_TABLE} WHERE base IN (${placeholders})`,
        validBases
    );
    const removed = Number(result?.changes) || 0;
    if (removed > 0) {
        for (const row of workspaceRows || []) {
            if (row?.workspace_id) {
                await refreshGalleryWorkspaceIndexMeta(row.workspace_id, ['pinned']);
            }
        }
    }
    return removed;
}

/**
 * Remove metadata for deleted images and merge receipts
 */
async function removeImageMetadata(filenames, options = {}) {
    if (!Array.isArray(filenames) || filenames.length === 0) {
        return 0;
    }

    const valid = [...new Set(filenames.filter(f => typeof f === 'string' && f.length > 0))];
    if (!valid.length) {
        return 0;
    }

    if (options.keepPins !== true) {
        await removeGalleryPinsForBases(valid);
    }
    const basesToSync = await collectOwnershipBasesForFilenames(valid);

    // For large batches, use batch deletion
    if (valid.length > 50) {
        return await removeImageMetadataBatch(valid, 500, basesToSync);
    }

    // For smaller batches, use individual deletion (preserves receipt handling)
    let removedCount = 0;

    for (const filename of valid) {
        metadataWriteQueue.removeHotGalleryOwnershipForFilename(filename);
        metadataWriteQueue.removeHotImage(filename);

        const image = await db.get('SELECT id FROM images WHERE filename = ?', [filename]);
        
        if (image) {
            // Extract receipts before deletion
            const receipts = await db.all('SELECT receipt_data FROM receipts WHERE image_id = ?', [image.id]);
            
            if (receipts.length > 0) {
                // Merge receipts into unattributed receipts
                for (const receipt of receipts) {
                    await db.run(`
                        INSERT INTO unattributed_receipts (date, receipt_data)
                        VALUES (?, ?)
                    `, [Date.now(), receipt.receipt_data]);
                }
                console.log(`📝 Merged ${receipts.length} receipts from deleted file: ${filename}`);
            }
            
            // Delete the image and its receipts (CASCADE removes gallery_workspace_ownership)
            await db.run('DELETE FROM images WHERE filename = ?', [filename]);
            
            removedCount++;
        }
    }
    
    if (removedCount > 0) {
        console.log(`🗑️ Removed metadata for ${removedCount} images`);
        if (WRITE_GALLERY_ITEMS && basesToSync.size > 0) {
            await syncGalleryWorkspaceItemsForBaseKeys(basesToSync);
        }
    }

    return removedCount;
}

/**
 * Batch delete image metadata for files that don't exist
 * Optimized for large batches - extracts receipts in batch first, then deletes
 * @param {Array<string>} filenames - Array of filenames to delete
 * @param {number} batchSize - Number of deletions per transaction (default: 500)
 */
async function removeImageMetadataBatch(filenames, batchSize = 500, precomputedBasesToSync = null) {
    try {
        if (!dbInitialized || !db) {
            throw new Error('Database not initialized');
        }
        
        if (!Array.isArray(filenames) || filenames.length === 0) {
            return 0;
        }
        
        let removedCount = 0;
        let receiptCount = 0;
        const basesToSync = precomputedBasesToSync || await collectOwnershipBasesForFilenames(filenames);
        
        // Process in batches to avoid overwhelming the database
        for (let i = 0; i < filenames.length; i += batchSize) {
            const batch = filenames.slice(i, i + batchSize);
            for (const filename of batch) {
                metadataWriteQueue.removeHotGalleryOwnershipForFilename(filename);
                metadataWriteQueue.removeHotImage(filename);
            }
            
            try {
                // Use a transaction for each batch
                await db.run('BEGIN TRANSACTION');
                
                // First, extract all receipts for images in this batch
                const placeholders = batch.map(() => '?').join(',');
                const images = await db.all(
                    `SELECT id, filename FROM images WHERE filename IN (${placeholders})`,
                    batch
                );
                
                if (images.length > 0) {
                    const imageIds = images.map(img => img.id);
                    const receiptPlaceholders = imageIds.map(() => '?').join(',');
                    
                    // Get all receipts for these images
                    const receipts = await db.all(
                        `SELECT receipt_data FROM receipts WHERE image_id IN (${receiptPlaceholders})`,
                        imageIds
                    );
                    
                    // Merge receipts into unattributed receipts in batch
                    if (receipts.length > 0) {
                        const now = Date.now();
                        for (const receipt of receipts) {
                            await db.run(`
                                INSERT INTO unattributed_receipts (date, receipt_data)
                                VALUES (?, ?)
                            `, [now, receipt.receipt_data]);
                        }
                        receiptCount += receipts.length;
                    }
                    
                    // Delete images in batch (CASCADE will handle receipts)
                    await db.run(
                        `DELETE FROM images WHERE filename IN (${placeholders})`,
                        batch
                    );
                    
                    removedCount += images.length;
                }
                
                // Commit transaction
                await db.run('COMMIT');
            } catch (error) {
                try {
                    await db.run('ROLLBACK');
                } catch (rollbackError) {
                    logger.error(`Error rolling back transaction:`, rollbackError);
                }
                logger.error(`Error in batch metadata deletion:`, error);
                throw error;
            }
        }
        
        if (removedCount > 0) {
            console.log(`🗑️ Removed metadata for ${removedCount} images${receiptCount > 0 ? ` (merged ${receiptCount} receipts)` : ''}`);
            if (WRITE_GALLERY_ITEMS && basesToSync.size > 0) {
                await syncGalleryWorkspaceItemsForBaseKeys(basesToSync);
            }
        }
        
        return removedCount;
    } catch (error) {
        logger.error('Error in removeImageMetadataBatch:', error);
        return 0;
    }
}

/**
 * Add unattributed receipt
 */
async function addUnattributedReceipt(receiptData) {
    const receipt = {
        date: Date.now().valueOf(),
        ...receiptData
    };
    
    await db.run(`
        INSERT INTO unattributed_receipts (date, receipt_data)
        VALUES (?, ?)
    `, [receipt.date, JSON.stringify(receiptData)]);
    
    // Lazy access to globalResources to avoid circular dependency
    // Require it here instead of at module load time
    try {
        const globalResources = require('./globalResources');
        const plumbing = globalResources.getDataPlumbing();
        if (plumbing && typeof plumbing.publish === 'function') {
            plumbing.publish('ws:broadcast:receipt', receipt);
        }
    } catch (error) {
        // If getDataPlumbing is not available, log warning but don't fail
        console.warn('⚠️ Could not publish receipt via plumbing system:', error.message);
    }
    
    return receipt;
}

/**
 * Get all unattributed receipts
 */
async function getUnattributedReceipts() {
    const receipts = await db.all('SELECT * FROM unattributed_receipts ORDER BY date DESC');
    
    return receipts.map(r => ({
        ...JSON.parse(r.receipt_data),
        date: r.date,
        id: r.id
    }));
}

/**
 * Get metadata for a specific image
 * @param {string} filename - The image filename
 * @param {boolean} includeReceipts - Whether to include receipts (default: true)
 */
async function getCachedMetadata(filename, includeReceipts = false) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const hot = metadataWriteQueue.getHotImage(filename);
    if (hot) {
        if (!includeReceipts) {
            return { ...hot, receipt: [] };
        }
        return hot;
    }

    // Prefer dedicated metadata reader so lookups are not queued behind gallery block SELECTs
    const readDb = await getMetadataReadDatabase() || await getReadOnlyDatabase();
    const readHandle = readDb || db;
    const image = await readHandle.get(
        `SELECT id, filename, metadata, width, height, upscaled, parent, size, mtime, blurhash
         FROM images WHERE filename = ?`,
        [filename]
    );

    if (!image) return null;

    const parsedMetadata = image.metadata ? JSON.parse(image.metadata) : {};
    const result = {
        ...image,
        metadata: parsedMetadata,
        upscaled: Boolean(image.upscaled),
        blurhash: image.blurhash || parsedMetadata?.forge_data?.blurhash || null
    };

    // Only load receipts if requested (for performance)
    if (includeReceipts) {
        const receipts = await readHandle.all(
            'SELECT receipt_data FROM receipts WHERE image_id = ? ORDER BY timestamp',
            [image.id]
        );
        result.receipt = receipts.map(r => JSON.parse(r.receipt_data));
    } else {
        result.receipt = [];
    }

    return result;
}

function viewTypeToGalleryBucket(viewType) {
    switch (viewType) {
        case 'scraps':
            return 'scraps';
        case 'pinned':
            return 'pinned';
        default:
            return 'files';
    }
}

function isGalleryOwnershipRowRemoved(filename, workspaceId, bucket) {
    return metadataWriteQueue.isGalleryOwnershipRemoved(
        metadataWriteQueue.galleryKey(filename, workspaceId, bucket || 'files')
    );
}

/**
 * Gallery membership from gallery_workspace_ownership (+ pending write-queue rows).
 * This is the source of truth for which files belong to a workspace view.
 */
async function listWorkspaceGalleryFilenames(workspaceId, bucket = 'files') {
    if (!workspaceId) {
        return [];
    }
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const targetBucket = bucket || 'files';
    const rows = await db.all(
        `SELECT filename FROM ${GALLERY_OWNERSHIP_TABLE} WHERE workspace_id = ? AND bucket = ? ORDER BY filename`,
        [workspaceId, targetBucket]
    );

    const filenames = new Set();
    for (const row of rows || []) {
        if (!row.filename || isGalleryOwnershipRowRemoved(row.filename, workspaceId, targetBucket)) {
            continue;
        }
        filenames.add(row.filename);
    }

    for (const hot of metadataWriteQueue.getHotGalleryOwnershipForWorkspace(workspaceId, targetBucket)) {
        if (hot.filename && !isGalleryOwnershipRowRemoved(hot.filename, workspaceId, targetBucket)) {
            filenames.add(hot.filename);
        }
    }

    return Array.from(filenames);
}

/**
 * Fast membership count for gallery index cache validation (indexed COUNT).
 */
async function countWorkspaceGalleryFilenames(workspaceId, bucket = 'files') {
    if (!workspaceId) {
        return 0;
    }
    if (!dbInitialized || !db) {
        return 0;
    }

    const targetBucket = bucket || 'files';
    const row = await db.get(
        `SELECT COUNT(*) AS count FROM ${GALLERY_OWNERSHIP_TABLE} WHERE workspace_id = ? AND bucket = ?`,
        [workspaceId, targetBucket]
    );
    return Number(row?.count) || 0;
}

/**
 * Workspace gallery rows joined to images for sort/filter fields (single indexed query).
 */
async function listWorkspaceGalleryImageRows(workspaceId, bucket = 'files') {
    if (!workspaceId) {
        return [];
    }
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const targetBucket = bucket || 'files';
    const rows = await db.all(
        `SELECT o.filename, i.mtime, i.width, i.height, i.size, i.upscaled, i.parent
         FROM ${GALLERY_OWNERSHIP_TABLE} o
         LEFT JOIN images i ON i.filename = o.filename
         WHERE o.workspace_id = ? AND o.bucket = ?
         ORDER BY COALESCE(i.mtime, 0) DESC, o.filename ASC`,
        [workspaceId, targetBucket]
    );

    const byFilename = new Map();
    for (const row of rows || []) {
        if (!row.filename || isGalleryOwnershipRowRemoved(row.filename, workspaceId, targetBucket)) {
            continue;
        }
        byFilename.set(row.filename, {
            filename: row.filename,
            mtime: row.mtime || Date.now(),
            width: row.width || null,
            height: row.height || null,
            size: row.size || 0,
            upscaled: Boolean(row.upscaled),
            parent: row.parent || null
        });
    }

    for (const hot of metadataWriteQueue.getHotGalleryOwnershipForWorkspace(workspaceId, targetBucket)) {
        if (!hot.filename || isGalleryOwnershipRowRemoved(hot.filename, workspaceId, targetBucket)) {
            continue;
        }
        if (byFilename.has(hot.filename)) {
            continue;
        }
        const hotImage = metadataWriteQueue.getHotImagesBatch([hot.filename])[hot.filename];
        byFilename.set(hot.filename, {
            filename: hot.filename,
            mtime: hotImage?.mtime || Date.now(),
            width: hotImage?.width || null,
            height: hotImage?.height || null,
            size: hotImage?.size || 0,
            upscaled: Boolean(hotImage?.upscaled),
            parent: hotImage?.parent || null
        });
    }

    return Array.from(byFilename.values()).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

let galleryOwnershipEnsureChain = Promise.resolve();

/**
 * Boot + drift: keep gallery_workspace_ownership aligned with workspace config.
 */
async function ensureGalleryOwnershipFromWorkspaces(workspaces) {
    if (!WRITE_GALLERY_OWNERSHIP || !dbInitialized || !db) {
        return { reconciled: false };
    }

    const run = async () => {
        const row = await db.get(`SELECT COUNT(*) AS count FROM ${GALLERY_OWNERSHIP_TABLE}`);
        const dbCount = row?.count || 0;

        if (dbCount === 0) {
            const result = await backfillGalleryOwnershipFromWorkspaces(workspaces, { truncateFirst: false });
            console.log(`✓ Gallery workspace ownership seeded (${result.upserted || 0} rows)`);
            await ensureGalleryWorkspaceItemsFromOwnership();
            return { reconciled: true, seeded: true, upserted: result.upserted || 0 };
        }

        // DB is authoritative once seeded — refresh materialized items only (do not reconcile from workspace.json).
        await ensureGalleryWorkspaceItemsFromOwnership();
        return { reconciled: false, dbAuthoritative: true };
    };

    const wait = galleryOwnershipEnsureChain.then(run, run);
    galleryOwnershipEnsureChain = wait.then(() => undefined, () => undefined);
    return wait;
}

/**
 * Full upsert from workspace config + remove SQL rows that no longer exist in config.
 */
async function reconcileGalleryOwnershipFromWorkspaces(workspaces) {
    if (!WRITE_GALLERY_OWNERSHIP || !dbInitialized || !db) {
        return { reconciled: false };
    }

    const backfill = await backfillGalleryOwnershipFromWorkspaces(workspaces, { truncateFirst: false });

    const expectedKeys = new Set();
    for (const [workspaceId, workspace] of Object.entries(workspaces || {})) {
        for (const filename of workspace.files || []) {
            if (filename) expectedKeys.add(metadataWriteQueue.galleryKey(filename, workspaceId, 'files'));
        }
        for (const filename of workspace.scraps || []) {
            if (filename) expectedKeys.add(metadataWriteQueue.galleryKey(filename, workspaceId, 'scraps'));
        }
        for (const filename of workspace.pinned || []) {
            if (filename) expectedKeys.add(metadataWriteQueue.galleryKey(filename, workspaceId, 'pinned'));
        }
    }

    const dbRows = await db.all(
        `SELECT filename, workspace_id, bucket FROM ${GALLERY_OWNERSHIP_TABLE}`
    );

    const keysBefore = new Set();
    for (const dbRow of dbRows || []) {
        keysBefore.add(metadataWriteQueue.galleryKey(dbRow.filename, dbRow.workspace_id, dbRow.bucket));
    }

    let removed = 0;
    const basesToSync = new Set();
    for (const dbRow of dbRows || []) {
        const key = metadataWriteQueue.galleryKey(dbRow.filename, dbRow.workspace_id, dbRow.bucket);
        if (expectedKeys.has(key)) {
            metadataWriteQueue.stageGalleryOwnership(dbRow.filename, dbRow.workspace_id, dbRow.bucket);
            continue;
        }
        metadataWriteQueue.removeHotGalleryOwnership(dbRow.filename, dbRow.workspace_id, dbRow.bucket);
        await db.run(
            `DELETE FROM ${GALLERY_OWNERSHIP_TABLE} WHERE filename = ? AND workspace_id = ? AND bucket = ?`,
            [dbRow.filename, dbRow.workspace_id, dbRow.bucket]
        );
        removed += 1;
        const base = getGalleryBaseName(dbRow.filename);
        if (base) {
            basesToSync.add(`${dbRow.workspace_id}\0${dbRow.bucket || 'files'}\0${base}`);
        }
    }

    for (const key of expectedKeys) {
        if (keysBefore.has(key)) {
            continue;
        }
        const { filename, workspaceId, bucket } = parseGalleryOwnershipKey(key);
        const base = getGalleryBaseName(filename);
        if (base) {
            basesToSync.add(`${workspaceId}\0${bucket}\0${base}`);
        }
    }

    if (backfill.upserted || removed) {
        console.log(`✓ Gallery ownership reconciled (upserted ${backfill.upserted || 0}, removed ${removed} stale rows)`);
        if (WRITE_GALLERY_ITEMS && basesToSync.size > 0) {
            await syncGalleryWorkspaceItemsForBaseKeys(basesToSync);
        }
    }

    return {
        reconciled: true,
        upserted: backfill.upserted || 0,
        removed
    };
}

/**
 * Collect paired-row base keys for filenames from ownership SQL + hot cache.
 */
async function collectOwnershipBasesForFilenames(filenames) {
    const basesToSync = new Set();
    if (!dbInitialized || !db || !Array.isArray(filenames) || filenames.length === 0) {
        return basesToSync;
    }

    const valid = [...new Set(filenames.filter(f => typeof f === 'string' && f.length > 0))];
    if (!valid.length) {
        return basesToSync;
    }

    const BATCH_SIZE = 500;
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
        const batch = valid.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(',');
        const ownershipRows = await db.all(
            `SELECT workspace_id, bucket, filename FROM ${GALLERY_OWNERSHIP_TABLE} WHERE filename IN (${placeholders})`,
            batch
        );
        for (const row of ownershipRows || []) {
            const base = getGalleryBaseName(row.filename);
            if (base) {
                basesToSync.add(`${row.workspace_id}\0${row.bucket || 'files'}\0${base}`);
            }
        }
        for (const filename of batch) {
            for (const hotRow of metadataWriteQueue.getHotGalleryOwnershipRowsForFile(filename)) {
                const base = getGalleryBaseName(hotRow.filename);
                if (base) {
                    basesToSync.add(`${hotRow.workspaceId}\0${hotRow.bucket || 'files'}\0${base}`);
                }
            }
        }
    }

    return basesToSync;
}

/**
 * Remove all gallery_workspace_ownership rows for deleted filenames.
 */
async function removeGalleryOwnershipForFilenames(filenames) {
    if (!WRITE_GALLERY_OWNERSHIP || !dbInitialized || !db || !Array.isArray(filenames) || filenames.length === 0) {
        return 0;
    }

    const valid = [...new Set(filenames.filter(f => typeof f === 'string' && f.length > 0))];
    if (!valid.length) {
        return 0;
    }

    const basesToSync = await collectOwnershipBasesForFilenames(valid);
    let removed = 0;
    const BATCH_SIZE = 500;
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
        const batch = valid.slice(i, i + BATCH_SIZE);
        for (const filename of batch) {
            metadataWriteQueue.removeHotGalleryOwnershipForFilename(filename);
        }
        const placeholders = batch.map(() => '?').join(',');
        const result = await db.run(
            `DELETE FROM ${GALLERY_OWNERSHIP_TABLE} WHERE filename IN (${placeholders})`,
            batch
        );
        removed += result?.changes || 0;
    }

    if (WRITE_GALLERY_ITEMS && basesToSync.size > 0) {
        await syncGalleryWorkspaceItemsForBaseKeys(basesToSync);
    }

    return removed;
}

/**
 * Get lightweight metadata for sorting (filename, mtime, width, height only)
 * Much faster than full metadata for sorting operations
 */
async function getLightweightMetadata(filenames) {
    if (!filenames || filenames.length === 0) {
        return {};
    }
    
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const hotBatch = metadataWriteQueue.getHotImagesBatch(filenames);
    const result = {};
    for (const [filename, hot] of Object.entries(hotBatch)) {
        result[filename] = projectLightweightMetadata(hot);
    }

    const dbLookup = filenames.filter(filename => !hotBatch[filename]);

    if (dbLookup.length > 0) {
        const placeholders = dbLookup.map(() => '?').join(',');
        const images = await db.all(
            `SELECT filename, mtime, width, height, size, upscaled, parent, blurhash FROM images WHERE filename IN (${placeholders})`,
            dbLookup
        );

        for (const image of images) {
            result[image.filename] = {
                filename: image.filename,
                mtime: image.mtime || Date.now(),
                width: image.width || null,
                height: image.height || null,
                size: image.size || 0,
                upscaled: Boolean(image.upscaled),
                parent: image.parent || null,
                blurhash: image.blurhash || null
            };
        }
    }

    return result;
}

/**
 * Get metadata for multiple images (optimized with batch queries)
 * Note: Receipts are excluded for performance - use getCachedMetadata() for single image with receipts
 * Uses batching to prevent OOM when processing large lists
 */
async function getMultipleMetadata(filenames) {
    if (!filenames || filenames.length === 0) {
        return {};
    }
    
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }
    
    const BATCH_SIZE = 500;
    const MAX_JSON_SIZE = 5 * 1024 * 1024;
    const result = metadataWriteQueue.getHotImagesBatch(filenames);
    const dbLookup = filenames.filter(filename => !result[filename]);
    
    for (let i = 0; i < dbLookup.length; i += BATCH_SIZE) {
        const batch = dbLookup.slice(i, i + BATCH_SIZE);
        if (batch.length === 0) continue;

        const placeholders = batch.map(() => '?').join(',');
        const images = await db.all(
            `SELECT id, filename, md5, width, height, parent, upscaled, size, mtime, metadata, created_at, updated_at 
             FROM images 
             WHERE filename IN (${placeholders})`,
            batch
        );
        
        for (const image of images) {
            try {
                let parsedMetadata = {};
                if (image.metadata) {
                    if (image.metadata.length > MAX_JSON_SIZE) {
                        console.warn(`⚠️ Metadata too large for ${image.filename}: ${image.metadata.length} bytes, skipping parse`);
                        parsedMetadata = {};
                    } else {
                        try {
                            parsedMetadata = JSON.parse(image.metadata);
                        } catch (parseError) {
                            console.error(`❌ Error parsing metadata JSON for ${image.filename}:`, parseError.message);
                            parsedMetadata = {};
                        }
                    }
                }
                
                result[image.filename] = {
                    ...image,
                    metadata: parsedMetadata,
                    upscaled: Boolean(image.upscaled)
                };
            } catch (error) {
                console.error(`❌ Error processing metadata for ${image.filename}:`, error.message);
            }
        }
        
        if (i + BATCH_SIZE < dbLookup.length) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    return result;
}

/**
 * Update metadata for an image (e.g., after generation).
 * Stages data in the hot cache immediately; SQL writes go through the FIFO queue.
 */
async function addReceiptMetadata(filename, imagesDir, receiptData = null, forgeData = null) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    let metadata = metadataWriteQueue.getHotImage(filename);

    if (!metadata) {
        const filePath = path.join(imagesDir, filename);
        const existing = await db.get('SELECT * FROM images WHERE filename = ?', [filename]);
        if (existing && fs.existsSync(filePath) && generateMD5(filePath) === existing.md5) {
            const receipts = await db.all(
                'SELECT receipt_data FROM receipts WHERE image_id = ? ORDER BY timestamp',
                [existing.id]
            );
            metadata = formatDbImageRow(existing, receipts);
        }
    }

    if (!metadata) {
        metadata = await buildImageMetadataFromFile(filename, imagesDir, []);
    }

    if (!metadata) {
        return null;
    }

    if (forgeData) {
        const filePath = path.join(imagesDir, filename);
        if (fs.existsSync(filePath)) {
            const imageBuffer = fs.readFileSync(filePath);
            const updatedBuffer = _pngMetadata.updateMetadata(imageBuffer, forgeData);
            fs.writeFileSync(filePath, updatedBuffer);
            metadata.md5 = generateMD5(filePath);
            const stats = fs.statSync(filePath);
            metadata.mtime = stats.mtime.valueOf();
            metadata.size = stats.size;
        }
        applyForgeDataToMetadata(metadata, forgeData);
    }

    if (receiptData) {
        if (!metadata.receipt) metadata.receipt = [];
        metadata.receipt.push(receiptData);
    }

    metadataWriteQueue.stageImage(filename, metadata);
    if (WRITE_GALLERY_ITEMS) {
        metadataWriteQueue.enqueue(async () => {
            await refreshGalleryWorkspaceItemsForFilename(filename);
        }, `gallery-item-refresh:${filename}`);
    }
    metadataWriteQueue.enqueue(async () => {
        const imageId = await persistImageRowToDb(filename, metadata);
        if (receiptData) {
            await persistReceiptToDb(filename, receiptData, imageId);
        }
    }, `receipt:${filename}`, {
        onSuccess: () => metadataWriteQueue.markImagePersisted(filename)
    });

    return metadataWriteQueue.getHotImage(filename) || metadata;
}



/**
 * Get all filenames from the database
 */
async function getAllFilenames() {
    try {
        if (!dbInitialized || !db) {
            throw new Error('Database not initialized');
        }
        
        const rows = await db.all('SELECT filename FROM images');
        const filenames = new Set(rows.map(row => row.filename));
        for (const filename of metadataWriteQueue.getActiveHotFilenames()) {
            filenames.add(filename);
        }
        return Array.from(filenames);
    } catch (error) {
        logger.error('Error getting all filenames from database:', error);
        return [];
    }
}



/**
 * Update file's embedded metadata with new forge data
 */
async function updateFileMetadata(filename, imagesDir, forgeData) {
    try {
        if (!dbInitialized || !db) {
            throw new Error('Database not initialized');
        }
        
        const filePath = path.join(imagesDir, filename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️ File not found: ${filePath}`);
            return false;
        }
        
        // Read the file buffer
        const imageBuffer = fs.readFileSync(filePath);
        
        // Update the PNG metadata using the pngMetadata module
        const updatedBuffer = _pngMetadata.updateMetadata(imageBuffer, forgeData);
        
        // Write the updated buffer back to the file
        fs.writeFileSync(filePath, updatedBuffer);
        
        // Update the database metadata as well
        const image = await db.get('SELECT id FROM images WHERE filename = ?', [filename]);
        
        if (image) {
            // Get existing metadata from database
            const existingMetadata = await db.get('SELECT metadata FROM images WHERE filename = ?', [filename]);
            let currentMetadata = {};
            
            if (existingMetadata && existingMetadata.metadata) {
                try {
                    currentMetadata = JSON.parse(existingMetadata.metadata);
                } catch (e) {
                    console.warn(`⚠️ Error parsing existing metadata for ${filename}:`, e.message);
                }
            }
            
            // Merge the new forge data
            if (!currentMetadata.forge_data) {
                currentMetadata.forge_data = {};
            }
            
            // Merge new data, excluding null values
            for (const [key, value] of Object.entries(forgeData)) {
                if (value !== null) {
                    currentMetadata.forge_data[key] = value;
                }
            }
            
            // Update the database
            await db.run(`
                UPDATE images 
                SET metadata = ?, updated_at = (strftime('%s', 'now'))
                WHERE filename = ?
            `, [JSON.stringify(currentMetadata), filename]);
            
            // Update search indexes
            const imageRecord = await db.get('SELECT * FROM images WHERE filename = ?', [filename]);
            if (imageRecord) {
                const metadataWithParsed = {
                    ...imageRecord,
                    metadata: currentMetadata,
                    upscaled: Boolean(imageRecord.upscaled)
                };
                scheduleSearchIndexUpdate(filename, metadataWithParsed, 'update-file-metadata');
            }
            
            console.log(`✅ Updated file and database metadata for ${filename}`);
            return true;
        } else {
            console.warn(`⚠️ No database record found for ${filename}`);
            return false;
        }
        
    } catch (error) {
        console.error(`❌ Error updating file metadata for ${filename}:`, error.message);
        return false;
    }
}

/**
 * Migrate existing JSON metadata to SQLite
 */
async function migrateFromJSON(jsonFilePath) {
    try {
        if (!fs.existsSync(jsonFilePath)) {
            console.log('📝 No existing JSON metadata to migrate');
            return true;
        }
        
        console.log('🔄 Migrating existing JSON metadata to SQLite...');
        
        const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
        
        // Migrate images
        if (jsonData.images) {
            for (const [filename, imageData] of Object.entries(jsonData.images)) {
                await db.run(`
                    INSERT OR REPLACE INTO images (filename, md5, width, height, parent, upscaled, size, mtime, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    filename,
                    imageData.md5 || '',
                    imageData.width || 0,
                    imageData.height || 0,
                    imageData.parent || null,
                    imageData.upscaled ? 1 : 0,
                    imageData.size || 0,
                    imageData.mtime || 0,
                    JSON.stringify(imageData.metadata || {})
                ]);
                
                // Migrate receipts
                if (imageData.receipt && Array.isArray(imageData.receipt)) {
                    const imageId = (await db.get('SELECT id FROM images WHERE filename = ?', [filename])).id;
                    
                    for (const receipt of imageData.receipt) {
                        await db.run(`
                            INSERT INTO receipts (image_id, timestamp, receipt_data)
                            VALUES (?, ?, ?)
                        `, [
                            imageId,
                            receipt.timestamp || Date.now(),
                            JSON.stringify(receipt)
                        ]);
                    }
                }
            }
        }
        
        // Migrate unattributed receipts
        if (jsonData.unattributed_receipts && Array.isArray(jsonData.unattributed_receipts)) {
            for (const receipt of jsonData.unattributed_receipts) {
                await db.run(`
                    INSERT INTO unattributed_receipts (date, receipt_data)
                    VALUES (?, ?)
                `, [
                    receipt.date || Date.now(),
                    JSON.stringify(receipt)
                ]);
            }
        }
        
        console.log('✅ Migration completed successfully');
        
        // Backup the old JSON file
        const backupPath = jsonFilePath + '.backup';
        fs.renameSync(jsonFilePath, backupPath);
        console.log(`📁 Old metadata backed up to: ${backupPath}`);
        
        return true;
    } catch (error) {
        console.error('❌ Error migrating metadata:', error.message);
        return false;
    }
}

/**
 * Get database statistics
 */
async function getDatabaseStats() {
    try {
        const imageCount = (await db.get('SELECT COUNT(*) as count FROM images'))?.count;
        const receiptCount = (await db.get('SELECT COUNT(*) as count FROM receipts'))?.count;
        const unattributedCount = (await db.get('SELECT COUNT(*) as count FROM unattributed_receipts'))?.count;
        
        return {
            images: imageCount,
            receipts: receiptCount,
            unattributed_receipts: unattributedCount,
            database_size: fs.statSync(dbPath).size
        };
    } catch (error) {
        console.error('❌ Error getting database stats:', error.message);
        return null;
    }
}

/**
 * Extract tags from text with their weights using the well-tested promptSegments parser
 * The parsePromptSegments function already does all the heavy lifting - we just extract tags from the segments
 */
function extractTagsFromText(text) {
    if (!text || typeof text !== 'string') {
        return { tags: [], fullTextEntries: [] };
    }

    const tags = [];
    const fullTextEntries = [];
    
    // Split by newlines to handle multi-line prompts
    const lines = text.split('\n');

    for (const line of lines) {
        // Split by | to handle group separators (each | group is processed separately)
        const groups = line.split('|');

        for (const group of groups) {
            const trimmedGroup = group.trim();
            if (!trimmedGroup) continue;

            // Use the well-tested parsePromptSegments - it already handles all the parsing
            const segments = parsePromptSegments(trimmedGroup);
            
            for (const segment of segments) {
                // Get base weight from segment (segment.weight is already extracted)
                const baseWeight = segment.weight !== null && segment.weight !== undefined 
                    ? segment.weight 
                    : 1.0;
                
                // If segment has innerItems, process each inner item
                // Otherwise, process the segment.text directly
                const itemsToProcess = (segment.innerItems && segment.innerItems.length > 0) 
                    ? segment.innerItems 
                    : [segment.text];
                
                for (const itemText of itemsToProcess) {
                    if (!itemText || typeof itemText !== 'string') continue;
                    
                    // Clean the item text - remove weight:: prefix if still present
                    let cleanText = itemText.trim();
                    cleanText = cleanText.replace(/^-?\d+(?:\.\d+)?::/, '').replace(/::$/g, '').trim();
                    
                    if (!cleanText || cleanText.length < 2) continue;
                    
                    // Split by comma to handle comma-separated tags
                    // This handles cases where multiple tags are in a single segment/item
                    const commaSeparatedItems = cleanText.split(',').map(item => item.trim()).filter(item => item.length >= 2);
                    
                    for (const commaItem of commaSeparatedItems) {
                        if (!commaItem || commaItem.length < 2) continue;
                        
                        // Extract tag and handle emphasis (braces/brackets)
                        extractTagFromText(commaItem, baseWeight, tags, fullTextEntries);
                    }
                }
            }
        }
    }

    return { tags, fullTextEntries };
}

/**
 * Extract a tag from cleaned text, handling emphasis markers
 */
function extractTagFromText(text, baseWeight, tags, fullTextEntries) {
    let tag = text;
    let weight = baseWeight;
    let tagType = 'normal';

    // Check for brace emphasis {tag} - positive weight multiplier
    let braceLevel = 0;
    while (tag[braceLevel] === '{' && tag[tag.length - 1 - braceLevel] === '}') {
        braceLevel++;
    }
    if (braceLevel > 0) {
        // NovelAI official: each {} multiplies by 1.05
        weight = baseWeight * Math.pow(1.05, braceLevel);
        tag = tag.substring(braceLevel, tag.length - braceLevel).trim();
        tagType = 'brace';
    }
    // Check for bracket emphasis [tag] - negative weight multiplier
    else {
        let bracketLevel = 0;
        while (tag[bracketLevel] === '[' && tag[tag.length - 1 - bracketLevel] === ']') {
            bracketLevel++;
        }
        if (bracketLevel > 0) {
            // NovelAI official: each [] multiplies by 1/1.05
            weight = baseWeight * Math.pow(1 / 1.05, bracketLevel);
            tag = tag.substring(bracketLevel, tag.length - bracketLevel).trim();
            tagType = 'bracket';
        }
    }

    // Skip if tag is too short or contains invalid characters
    if (tag.length < 2 || /[<>]/.test(tag)) return;

    // Clean up the tag (remove extra spaces, etc.)
    tag = tag.replace(/\s+/g, ' ').trim();

    if (tag.length >= 2) {
        // Check if this is display text (starts with "Text:")
        if (isTextColonPrefix(tag)) {
            const displayText = stripTextColonPrefix(tag);
            if (displayText.length > 0) {
                fullTextEntries.push({
                    text: displayText.toLowerCase(),
                    originalText: displayText,
                    weight: weight,
                    type: 'display_text'
                });
            }
            return;
        }

        // Check if tag is longer than 5 words - treat as full text
        const wordCount = tag.split(/\s+/).length;
        if (wordCount > 5) {
            fullTextEntries.push({
                text: tag.toLowerCase(),
                originalText: tag,
                weight: weight,
                type: 'long_tag'
            });
            return;
        }

        // Regular tag
        tags.push({
            tag: tag.toLowerCase(),
            originalTag: tag,
            weight: weight,
            type: tagType
        });
    }
}

/**
 * Set indexing pause state
 */
function setIndexingPaused(paused) {
    indexingPaused = paused;
}

/**
 * Check if indexing is paused
 */
function isIndexingPaused() {
    return indexingPaused;
}

/** Forge UI / filter keys (modelGroups) → API slug for text search aliases */
const MODEL_FORGE_TO_NAI_SLUG = {
    v5: 'nai-diffusion-5-full',
    v5_cur: 'nai-diffusion-5-curated',
    v4_5: 'nai-diffusion-4-5-full',
    v4_5_cur: 'nai-diffusion-4-5-curated',
    v4: 'nai-diffusion-4-full',
    v4_cur: 'nai-diffusion-4-curated-preview',
    v3: 'nai-diffusion-3',
    v3_furry: 'nai-diffusion-furry-3'
};

/**
 * Remove indexing-hazard keys from parsed PNG metadata (in-place).
 * stage_seeds blobs can exceed 1 MB and are not used by search indexes.
 */
function sanitizePngMetaForIndexing(pngMeta) {
    if (!pngMeta?.forge_data || typeof pngMeta.forge_data !== 'object') {
        return pngMeta;
    }
    delete pngMeta.forge_data.stage_seeds;
    return pngMeta;
}

/** Lowercase + collapse whitespace for image_prompt_text.text_norm */
function normalizePromptBlobText(text) {
    if (text == null || text === '') return '';
    return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function collectV4CaptionTexts(v4Prompt) {
    const parts = [];
    const caption = v4Prompt?.caption;
    if (!caption) return parts;
    if (caption.base_caption) parts.push(caption.base_caption);
    if (Array.isArray(caption.char_captions)) {
        for (const entry of caption.char_captions) {
            if (entry?.char_caption) parts.push(entry.char_caption);
        }
    }
    return parts;
}

/**
 * Build four prompt blob lanes from PNG metadata (docs/design/ispy-search-indexing-PLAN.md §3.2).
 * @returns {{ compiled: string, input: string, compiled_uc: string, input_uc: string }}
 */
function extractPromptBlobLanes(pngMeta) {
    const compiledParts = [];
    const compiledUcParts = [];
    const forgeData = pngMeta?.forge_data && typeof pngMeta.forge_data === 'object' ? pngMeta.forge_data : {};

    if (pngMeta?.prompt) compiledParts.push(pngMeta.prompt);
    if (pngMeta?.uc) compiledUcParts.push(pngMeta.uc);
    compiledParts.push(...collectV4CaptionTexts(pngMeta?.v4_prompt));
    compiledUcParts.push(...collectV4CaptionTexts(pngMeta?.v4_negative_prompt));

    if (Array.isArray(forgeData.disabledCharacters)) {
        for (const charPrompt of forgeData.disabledCharacters) {
            if (charPrompt?.prompt) compiledParts.push(charPrompt.prompt);
        }
    }

    return {
        compiled: normalizePromptBlobText(compiledParts.join(' ')),
        input: normalizePromptBlobText(forgeData.input_prompt || ''),
        compiled_uc: normalizePromptBlobText(compiledUcParts.join(' ')),
        input_uc: normalizePromptBlobText(forgeData.input_uc || '')
    };
}

async function markBlobExtractAttempted(filename) {
    if (!dbInitialized || !db || !filename) return;

    await db.run(`
        UPDATE images SET blob_extract_attempted = 1, updated_at = strftime('%s', 'now')
        WHERE filename = ?
    `, [filename]);
}

async function markFtsExtractAttempted(filename) {
    if (!dbInitialized || !db || !filename) return;

    await db.run(`
        UPDATE images SET fts_extract_attempted = 1, updated_at = strftime('%s', 'now')
        WHERE filename = ?
    `, [filename]);
}

async function markInputPromptTagsExtractAttempted(filename) {
    if (!dbInitialized || !db || !filename) return;

    await db.run(`
        UPDATE images SET input_prompt_tags_extract_attempted = 1, updated_at = strftime('%s', 'now')
        WHERE filename = ?
    `, [filename]);
}

function buildPromptFtsBodiesFromLanes(lanes) {
    const compiledBody = [lanes.compiled, lanes.compiled_uc].filter(Boolean).join(' ').trim();
    const inputBody = [lanes.input, lanes.input_uc].filter(Boolean).join(' ').trim();
    return { compiledBody, inputBody };
}

function buildPromptFtsBodiesFromBlobRows(blobRows) {
    const lanes = { compiled: '', compiled_uc: '', input: '', input_uc: '' };
    for (const row of blobRows || []) {
        if (row.lane && row.text_norm) lanes[row.lane] = row.text_norm;
    }
    return buildPromptFtsBodiesFromLanes(lanes);
}

async function deletePromptFtsForFile(filename) {
    if (!dbInitialized || !db || !filename) return;

    await db.run('DELETE FROM prompt_fts_compiled WHERE filename = ?', [filename]);
    await db.run('DELETE FROM prompt_fts_input WHERE filename = ?', [filename]);
}

async function upsertPromptFts(filename, pngMeta) {
    if (!dbInitialized || !db || !filename) return;

    await deletePromptFtsForFile(filename);
    const { compiledBody, inputBody } = buildPromptFtsBodiesFromLanes(extractPromptBlobLanes(pngMeta));
    if (compiledBody) {
        await db.run(`
            INSERT INTO prompt_fts_compiled (filename, body)
            VALUES (?, ?)
        `, [filename, compiledBody]);
    }
    if (inputBody) {
        await db.run(`
            INSERT INTO prompt_fts_input (filename, body)
            VALUES (?, ?)
        `, [filename, inputBody]);
    }
    await markFtsExtractAttempted(filename);
}

async function upsertPromptFtsFromBlobRows(filename, blobRows) {
    if (!dbInitialized || !db || !filename) return;

    await deletePromptFtsForFile(filename);
    const { compiledBody, inputBody } = buildPromptFtsBodiesFromBlobRows(blobRows);
    if (compiledBody) {
        await db.run(`
            INSERT INTO prompt_fts_compiled (filename, body)
            VALUES (?, ?)
        `, [filename, compiledBody]);
    }
    if (inputBody) {
        await db.run(`
            INSERT INTO prompt_fts_input (filename, body)
            VALUES (?, ?)
        `, [filename, inputBody]);
    }
    await markFtsExtractAttempted(filename);
}

/** Escape a term for FTS5 unicode61 word match (quoted token). */
function buildFts5WordQuery(term) {
    const normalized = normalizePromptBlobText(term);
    if (!normalized) return null;
    const tokens = normalized.split(' ').filter(Boolean);
    if (!tokens.length) return null;
    return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' ');
}

function getPromptFtsTableForSearch(searchOptions = {}) {
    const promptSource = searchOptions.promptSource || searchOptions.filters?.promptSource || 'compiled';
    return promptSource === 'input' ? 'prompt_fts_input' : 'prompt_fts_compiled';
}

function usesFtsPromptSearch(matchMode) {
    return USE_FTS_PROMPT_SEARCH && matchMode === 'word';
}

async function upsertPromptBlobs(filename, pngMeta) {
    if (!dbInitialized || !db || !filename) return;

    await db.run('DELETE FROM image_prompt_text WHERE filename = ?', [filename]);
    const lanes = extractPromptBlobLanes(pngMeta);
    for (const [lane, textNorm] of Object.entries(lanes)) {
        if (!textNorm) continue;
        await db.run(`
            INSERT INTO image_prompt_text (filename, lane, text_norm)
            VALUES (?, ?, ?)
        `, [filename, lane, textNorm]);
    }
    await markBlobExtractAttempted(filename);
}

/** Compiled vs input lane filter for blob search (matches getPromptSourceFilter semantics). */
function getPromptBlobLanesForSearch(searchOptions = {}) {
    const promptSource = searchOptions.promptSource || searchOptions.filters?.promptSource || 'compiled';
    if (promptSource === 'input') return ['input'];
    return ['compiled'];
}

function usesPromptBlobSearch(matchMode) {
    return USE_PROMPT_BLOB_SEARCH && matchMode !== 'word';
}

/**
 * Fast input_prompt tag indexing from stored metadata (no full tag re-index).
 */
async function backfillInputPromptTagsForRow(row, pngMeta = null, options = {}) {
    const meta = pngMeta || sanitizePngMetaForIndexing(JSON.parse(row.metadata));
    const inputPrompt = meta?.forge_data?.input_prompt;
    const hasInputPrompt = Boolean(inputPrompt && String(inputPrompt).trim());

    await db.run(`DELETE FROM search_tags WHERE filename = ? AND source = 'input_prompt'`, [row.filename]);
    await db.run(`DELETE FROM search_fulltext WHERE filename = ? AND source = 'input_prompt'`, [row.filename]);

    if (hasInputPrompt) {
        const inputData = extractTagsFromText(inputPrompt);
        if (inputData.tags.length) {
            const tagPlaceholders = inputData.tags.map(() => '(?, ?, ?, ?, ?, ?, NULL)').join(', ');
            const tagParams = [];
            for (const tagData of inputData.tags) {
                tagParams.push(
                    row.filename,
                    tagData.tag,
                    tagData.originalTag,
                    tagData.weight || 0,
                    tagData.type || 'normal',
                    'input_prompt'
                );
            }
            await db.run(`
                INSERT INTO search_tags (filename, tag, original_tag, weight, tag_type, source, character)
                VALUES ${tagPlaceholders}
            `, tagParams);
        }
        if (inputData.fullTextEntries.length) {
            const textPlaceholders = inputData.fullTextEntries.map(() => '(?, ?, ?, ?, ?, ?, NULL)').join(', ');
            const textParams = [];
            for (const textData of inputData.fullTextEntries) {
                textParams.push(
                    row.filename,
                    textData.text,
                    textData.originalText,
                    textData.weight || 0,
                    textData.type || 'full_text',
                    'input_prompt'
                );
            }
            await db.run(`
                INSERT INTO search_fulltext (filename, text_content, original_text, weight, text_type, source, character)
                VALUES ${textPlaceholders}
            `, textParams);
        }
    }

    if (!options.deferAttemptedMark) {
        await markInputPromptTagsExtractAttempted(row.filename);
    }
    return hasInputPrompt;
}

function deriveSeedChainGroupId(seed, anchorMtime) {
    const digest = crypto.createHash('sha256')
        .update(`${seed}\0${anchorMtime}`)
        .digest('hex');
    return digest.slice(0, 16);
}

async function clearSeedChainGroup(groupId) {
    if (!groupId) return;
    const members = await db.all(
        `SELECT filename FROM image_seed_chain WHERE group_id = ?`,
        [groupId]
    );
    await db.run(`DELETE FROM image_seed_chain WHERE group_id = ?`, [groupId]);
    for (const member of members) {
        await db.run(`
            UPDATE image_search_facets
            SET consecutive_seed_group_id = NULL
            WHERE filename = ?
        `, [member.filename]);
    }
}

async function persistSeedChainRun(run) {
    if (!run || run.length < 2) {
        if (run && run.length === 1 && run[0].previousGroupId) {
            await clearSeedChainGroup(run[0].previousGroupId);
        }
        return null;
    }

    const groupId = deriveSeedChainGroupId(run[0].seed, run[0].mtime);
    if (run[0].previousGroupId && run[0].previousGroupId !== groupId) {
        await clearSeedChainGroup(run[0].previousGroupId);
    }

    await db.run(`DELETE FROM image_seed_chain WHERE group_id = ?`, [groupId]);
    for (let position = 0; position < run.length; position += 1) {
        const entry = run[position];
        await db.run(`
            INSERT INTO image_seed_chain (group_id, filename, seed, mtime, position)
            VALUES (?, ?, ?, ?, ?)
        `, [groupId, entry.filename, entry.seed, entry.mtime, position]);
        await db.run(`
            UPDATE image_search_facets
            SET consecutive_seed_group_id = ?
            WHERE filename = ?
        `, [groupId, entry.filename]);
    }
    return groupId;
}

/**
 * Recompute the consecutive-seed run containing filename (Phase 7 incremental writer).
 */
async function updateSeedChainForFilename(filename) {
    if (!dbInitialized || !db || !filename) return null;

    const row = await db.get(`
        SELECT i.filename, i.mtime,
               COALESCE(f.seed, json_extract(i.metadata, '$.seed')) AS seed,
               f.consecutive_seed_group_id AS previous_group_id
        FROM images i
        LEFT JOIN image_search_facets f ON f.filename = i.filename
        WHERE i.filename = ?
    `, [filename]);
    if (!row || row.seed == null) return null;

    const seed = String(row.seed);
    const mtimeMs = row.mtime > 1000000000000 ? row.mtime : row.mtime * 1000;
    const windowStart = mtimeMs - CONSECUTIVE_SEED_MAX_GAP_MS;
    const windowEnd = mtimeMs + CONSECUTIVE_SEED_MAX_GAP_MS;

    const neighbors = await db.all(`
        SELECT i.filename, i.mtime,
               COALESCE(f.seed, json_extract(i.metadata, '$.seed')) AS seed,
               f.consecutive_seed_group_id AS previous_group_id
        FROM images i
        LEFT JOIN image_search_facets f ON f.filename = i.filename
        WHERE COALESCE(f.seed, json_extract(i.metadata, '$.seed')) = ?
          AND i.mtime BETWEEN ? AND ?
        ORDER BY i.mtime ASC, i.filename ASC
    `, [seed, windowStart, windowEnd]);

    let run = [];
    const flushRun = async () => {
        if (run.some((entry) => entry.filename === filename)) {
            await persistSeedChainRun(run);
        } else if (run.length >= 2) {
            await persistSeedChainRun(run);
        } else if (run.length === 1 && run[0].previousGroupId) {
            await clearSeedChainGroup(run[0].previousGroupId);
        }
        run = [];
    };

    for (const neighbor of neighbors) {
        const neighborMtime = neighbor.mtime > 1000000000000 ? neighbor.mtime : neighbor.mtime * 1000;
        const entry = {
            filename: neighbor.filename,
            seed,
            mtime: neighborMtime,
            previousGroupId: neighbor.previous_group_id || null
        };
        const prev = run[run.length - 1];
        if (prev && neighborMtime - prev.mtime <= CONSECUTIVE_SEED_MAX_GAP_MS) {
            run.push(entry);
        } else {
            await flushRun();
            run = [entry];
        }
    }
    await flushRun();
    return null;
}

async function rebuildAllSeedChains(progressCallback = null) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    await db.run(`DELETE FROM image_seed_chain`);
    await db.run(`UPDATE image_search_facets SET consecutive_seed_group_id = NULL`);

    const rows = await db.all(`
        SELECT i.filename, i.mtime,
               COALESCE(f.seed, json_extract(i.metadata, '$.seed')) AS seed
        FROM images i
        LEFT JOIN image_search_facets f ON f.filename = i.filename
        WHERE json_extract(i.metadata, '$.seed') IS NOT NULL
           OR f.seed IS NOT NULL
        ORDER BY i.mtime ASC, i.filename ASC
    `);

    let run = [];
    let groupsWritten = 0;
    const flushRun = async () => {
        const groupId = await persistSeedChainRun(run);
        if (groupId) groupsWritten += 1;
        run = [];
    };

    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const seed = row.seed != null ? String(row.seed) : null;
        if (!seed) {
            await flushRun();
            continue;
        }
        const mtimeMs = row.mtime > 1000000000000 ? row.mtime : row.mtime * 1000;
        const entry = { filename: row.filename, seed, mtime: mtimeMs, previousGroupId: null };
        const prev = run[run.length - 1];
        if (prev && prev.seed === seed && mtimeMs - prev.mtime <= CONSECUTIVE_SEED_MAX_GAP_MS) {
            run.push(entry);
        } else {
            await flushRun();
            run = [entry];
        }

        if (progressCallback && (i % 500 === 0 || i === rows.length - 1)) {
            progressCallback({ current: i + 1, total: rows.length, groupsWritten, filename: row.filename });
        }
    }
    await flushRun();

    return { processed: rows.length, groupsWritten };
}

/**
 * Resolve NovelAI / SD model identity from metadata.source or metadata.software.
 * @returns {string|null} Raw source string (e.g. "NovelAI Diffusion V4.5 4BDE2A90")
 */
function parseModelSourceFromPngMeta(pngMeta) {
    if (!pngMeta || typeof pngMeta !== 'object') return null;

    if (pngMeta.source != null && String(pngMeta.source).trim()) {
        return String(pngMeta.source).trim();
    }

    const software = pngMeta.software;
    if (software != null && String(software).trim()) {
        const text = String(software).trim();
        const diffusionMatch = text.match(/(?:NovelAI|Stable) Diffusion[^\s)]*(?:\s+[0-9A-F]{8})?/i);
        if (diffusionMatch) return diffusionMatch[0].trim();
        const parenMatch = text.match(/\(([^)]+)\)/);
        if (parenMatch && parenMatch[1].trim()) return parenMatch[1].trim();
    }

    if (pngMeta.model != null && String(pngMeta.model).trim()) {
        return String(pngMeta.model).trim();
    }

    return null;
}

/**
 * Map metadata.source hash to internal forge model code (pngMetadata.js determineModelFromMetadata).
 * @returns {string} V5 | V5_CUR | V4_5 | V4_5_CUR | V4 | V4_CUR | V3 | FURRY | unknown
 */
function determineForgeModelCode(source) {
    if (!source) return 'unknown';

    if (source.includes('NovelAI Diffusion V5')) {
        switch (source) {
            case 'NovelAI Diffusion V5 0ADF9AB7':
            case 'NovelAI Diffusion V5 DB276663':
                return 'V5';
            default:
                if (source.includes('Curated') || source.includes('CUR')) return 'V5_CUR';
                return 'V5';
        }
    }

    if (source.includes('NovelAI Diffusion V4') || source.includes('NovelAI Diffusion V4.5')) {
        switch (source) {
            case 'NovelAI Diffusion V4.5 4BDE2A90':
            case 'NovelAI Diffusion V4.5 1229B44F':
            case 'NovelAI Diffusion V4.5 B9F340FD':
            case 'NovelAI Diffusion V4.5 F3D95188':
                return 'V4_5';
            case 'NovelAI Diffusion V4.5 C02D4F98':
            case 'NovelAI Diffusion V4.5 5AB81C7C':
            case 'NovelAI Diffusion V4.5 B5A2A797':
            case 'NovelAI Diffusion V4 5AB81C7C':
            case 'NovelAI Diffusion V4 B5A2A797':
                return 'V4_5_CUR';
            case 'NovelAI Diffusion V4 37442FCA':
            case 'NovelAI Diffusion V4 4F49EC75':
            case 'NovelAI Diffusion V4 CA4B7203':
            case 'NovelAI Diffusion V4 79F47848':
            case 'NovelAI Diffusion V4 F6302A9D':
                return 'V4';
            case 'NovelAI Diffusion V4 7ABFFA2A':
            case 'NovelAI Diffusion V4 C1CCBA86':
            case 'NovelAI Diffusion V4 770A9E12':
                return 'V4_CUR';
            default:
                return source.includes('V4.5') ? 'V4_5' : 'V4';
        }
    }

    switch (source) {
        case 'Stable Diffusion XL B0BDF6C1':
        case 'Stable Diffusion XL C1E1DE52':
        case 'Stable Diffusion XL 7BCCAA2C':
        case 'Stable Diffusion XL 1120E6A9':
        case 'Stable Diffusion XL 8BA2AF87':
            return 'V3';
        case 'Stable Diffusion XL 4BE8C60C':
        case 'Stable Diffusion XL C8704949':
        case 'Stable Diffusion XL 37C2B166':
        case 'Stable Diffusion XL F306816B':
        case 'Stable Diffusion XL 9CC2F394':
            return 'FURRY';
        default:
            return 'unknown';
    }
}

/**
 * Shared model + preset extraction for facets and search_models.
 * @returns {{ model: string|null, model_norm: string|null, searchModelNames: string[], presetName: string|null }}
 */
function extractSearchModelAndPresetFromPngMeta(pngMeta) {
    const source = parseModelSourceFromPngMeta(pngMeta);
    const forgeCode = source ? determineForgeModelCode(source) : 'unknown';
    const forgeKey = forgeCode !== 'unknown' ? forgeCode.toLowerCase() : null;
    const furryKey = forgeCode === 'FURRY' ? 'v3_furry' : null;
    const modelNorm = furryKey || forgeKey;

    const searchModelNames = [];
    if (modelNorm) searchModelNames.push(modelNorm);
    if (modelNorm && MODEL_FORGE_TO_NAI_SLUG[modelNorm]) {
        searchModelNames.push(MODEL_FORGE_TO_NAI_SLUG[modelNorm]);
    }
    if (source) searchModelNames.push(source);

    const forgeData = pngMeta?.forge_data && typeof pngMeta.forge_data === 'object' ? pngMeta.forge_data : {};
    const presetName = forgeData.preset_name != null && String(forgeData.preset_name).trim()
        ? String(forgeData.preset_name).trim()
        : null;

    return {
        model: source,
        model_norm: modelNorm,
        searchModelNames: [...new Set(searchModelNames.filter(Boolean))],
        presetName
    };
}

/**
 * Derive tri-state quality_preset from forge_data.append_quality.
 * @returns {number|null} 1=true, 0=false, null=unknown
 */
function deriveQualityPresetFlag(appendQuality) {
    if (appendQuality == null || appendQuality === '') return null;
    if (appendQuality === true || appendQuality === 1 || appendQuality === '1' || appendQuality === 'true') return 1;
    if (appendQuality === false || appendQuality === 0 || appendQuality === '0' || appendQuality === 'false') return 0;
    const asInt = parseInt(appendQuality, 10);
    if (Number.isFinite(asInt)) return asInt ? 1 : 0;
    return null;
}

/**
 * Match applyOmegasearchMetadataFilters dynamic-replacement detection.
 */
function deriveHasDynamicReplacements(pngMeta) {
    const forgeData = pngMeta?.forge_data;
    if (!forgeData || typeof forgeData !== 'object') return 0;

    const textReplType = (val) => {
        if (val == null) return false;
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === 'object') return Object.keys(val).length > 0;
        return String(val).length > 2;
    };

    if (textReplType(forgeData.text_replacements)) return 1;
    if (Array.isArray(forgeData.text_replacements_seed) && forgeData.text_replacements_seed.length > 0) return 1;
    if (forgeData.dynamic_generation && typeof forgeData.dynamic_generation === 'object') {
        const serialized = JSON.stringify(forgeData.dynamic_generation);
        if (serialized.includes('text_replacements')) return 1;
    }
    return 0;
}

/**
 * Build denormalized search facet row from PNG metadata + images row fields.
 */
function extractSearchFacetsFromMetadata(pngMeta, imageRow = {}) {
    if (!pngMeta || typeof pngMeta !== 'object') return null;

    sanitizePngMetaForIndexing(pngMeta);

    const forgeData = pngMeta.forge_data && typeof pngMeta.forge_data === 'object' ? pngMeta.forge_data : {};
    const { model, model_norm: modelNorm, presetName } = extractSearchModelAndPresetFromPngMeta(pngMeta);
    const width = imageRow.width ?? pngMeta.width ?? null;
    const height = imageRow.height ?? pngMeta.height ?? null;
    const sampler = pngMeta.sampler || null;
    const scheduler = pngMeta.noise_schedule || null;
    const resolutionPreset = (width && height) ? getResolutionFromDimensions(width, height) : null;
    const resolutionTier = omegasearchFilters.getResolutionTier(width, height);

    let nsfwLevel = null;
    if (forgeData.dataset_config && forgeData.dataset_config.nsfw != null && forgeData.dataset_config.nsfw !== '') {
        const parsed = parseInt(forgeData.dataset_config.nsfw, 10);
        if (Number.isFinite(parsed)) nsfwLevel = parsed;
    }

    let ucLevel = null;
    if (forgeData.append_uc != null && forgeData.append_uc !== '') {
        const parsed = parseInt(forgeData.append_uc, 10);
        if (Number.isFinite(parsed)) ucLevel = parsed;
    }

    const seed = pngMeta.seed != null ? String(pngMeta.seed) : null;
    const layer1Seed = forgeData.layer1_seed != null ? String(forgeData.layer1_seed) : null;

    let mtime = imageRow.mtime ?? null;
    if (mtime != null && mtime > 1e12) {
        mtime = Math.floor(mtime / 1000);
    }

    return {
        image_id: imageRow.id ?? null,
        model,
        model_norm: modelNorm,
        preset_name: presetName,
        parent: imageRow.parent ?? null,
        chain_source: forgeData.chain_source || null,
        seed,
        layer1_seed: layer1Seed,
        steps: pngMeta.steps != null ? parseInt(pngMeta.steps, 10) : null,
        guidance: pngMeta.scale != null ? parseFloat(pngMeta.scale) : null,
        rescale: pngMeta.cfg_rescale != null ? parseFloat(pngMeta.cfg_rescale) : null,
        sampler,
        sampler_norm: sampler ? String(sampler).toLowerCase() : null,
        scheduler,
        scheduler_norm: scheduler ? String(scheduler).toLowerCase() : null,
        width,
        height,
        resolution_tier: resolutionTier,
        resolution_preset: resolutionPreset,
        upscaled: imageRow.upscaled ? 1 : 0,
        quality_preset: deriveQualityPresetFlag(forgeData.append_quality),
        uc_level: ucLevel,
        nsfw_level: nsfwLevel,
        has_dynamic_replacements: deriveHasDynamicReplacements(pngMeta),
        mtime,
        date_generated_ms: forgeData.date_generated != null ? parseInt(forgeData.date_generated, 10) : null,
        consecutive_seed_group_id: null,
        refine_group_id: null
    };
}

async function upsertSearchFacets(filename, facets) {
    if (!dbInitialized || !db || !filename || !facets) return;

    const modelExtractAttempted = facets.model_extract_attempted != null ? facets.model_extract_attempted : 1;

    await db.run(`
        INSERT INTO image_search_facets (
            filename, image_id, model, model_norm, preset_name, parent, chain_source,
            seed, layer1_seed, steps, guidance, rescale, sampler, sampler_norm,
            scheduler, scheduler_norm, width, height, resolution_tier, resolution_preset,
            upscaled, quality_preset, uc_level, nsfw_level, has_dynamic_replacements,
            mtime, date_generated_ms, consecutive_seed_group_id, refine_group_id,
            model_extract_attempted, indexed_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            strftime('%s', 'now')
        )
        ON CONFLICT(filename) DO UPDATE SET
            image_id = excluded.image_id,
            model = excluded.model,
            model_norm = excluded.model_norm,
            preset_name = excluded.preset_name,
            parent = excluded.parent,
            chain_source = excluded.chain_source,
            seed = excluded.seed,
            layer1_seed = excluded.layer1_seed,
            steps = excluded.steps,
            guidance = excluded.guidance,
            rescale = excluded.rescale,
            sampler = excluded.sampler,
            sampler_norm = excluded.sampler_norm,
            scheduler = excluded.scheduler,
            scheduler_norm = excluded.scheduler_norm,
            width = excluded.width,
            height = excluded.height,
            resolution_tier = excluded.resolution_tier,
            resolution_preset = excluded.resolution_preset,
            upscaled = excluded.upscaled,
            quality_preset = excluded.quality_preset,
            uc_level = excluded.uc_level,
            nsfw_level = excluded.nsfw_level,
            has_dynamic_replacements = excluded.has_dynamic_replacements,
            mtime = excluded.mtime,
            date_generated_ms = excluded.date_generated_ms,
            consecutive_seed_group_id = excluded.consecutive_seed_group_id,
            refine_group_id = excluded.refine_group_id,
            model_extract_attempted = excluded.model_extract_attempted,
            indexed_at = strftime('%s', 'now')
    `, [
        filename,
        facets.image_id,
        facets.model,
        facets.model_norm,
        facets.preset_name,
        facets.parent,
        facets.chain_source,
        facets.seed,
        facets.layer1_seed,
        facets.steps,
        facets.guidance,
        facets.rescale,
        facets.sampler,
        facets.sampler_norm,
        facets.scheduler,
        facets.scheduler_norm,
        facets.width,
        facets.height,
        facets.resolution_tier,
        facets.resolution_preset,
        facets.upscaled,
        facets.quality_preset,
        facets.uc_level,
        facets.nsfw_level,
        facets.has_dynamic_replacements,
        facets.mtime,
        facets.date_generated_ms,
        facets.consecutive_seed_group_id,
        facets.refine_group_id,
        modelExtractAttempted
    ]);
}

async function markModelExtractAttempted(filename) {
    if (!dbInitialized || !db || !filename) return;

    await db.run(`
        INSERT INTO image_search_facets (filename, model_extract_attempted, indexed_at)
        VALUES (?, 1, strftime('%s', 'now'))
        ON CONFLICT(filename) DO UPDATE SET
            model_extract_attempted = 1,
            indexed_at = strftime('%s', 'now')
    `, [filename]);
}

async function upsertSearchModelsForFile(filename, searchModelNames) {
    if (!dbInitialized || !db || !filename) return;

    await db.run('DELETE FROM search_models WHERE filename = ?', [filename]);
    for (const modelName of searchModelNames) {
        if (!modelName) continue;
        await db.run(`
            INSERT INTO search_models (filename, model_name)
            VALUES (?, ?)
        `, [filename, modelName]);
    }
}

async function upsertSearchPresetForFile(filename, presetName) {
    if (!dbInitialized || !db || !filename) return;

    await db.run('DELETE FROM search_presets WHERE filename = ?', [filename]);
    if (presetName) {
        await db.run(`
            INSERT INTO search_presets (filename, preset_name)
            VALUES (?, ?)
        `, [filename, presetName]);
    }
}

/**
 * Fast facet + model_norm extraction from stored metadata (no full tag re-index).
 */
async function backfillSearchFacetsForRow(row, pngMeta = null) {
    const meta = pngMeta || sanitizePngMetaForIndexing(JSON.parse(row.metadata));
    const { searchModelNames, presetName } = extractSearchModelAndPresetFromPngMeta(meta);
    const facets = extractSearchFacetsFromMetadata(meta, row);

    if (facets) {
        facets.model_extract_attempted = 1;
        if (WRITE_SEARCH_FACETS) {
            await upsertSearchFacets(row.filename, facets);
        } else {
            await markModelExtractAttempted(row.filename);
        }
    } else {
        await markModelExtractAttempted(row.filename);
    }

    await upsertSearchModelsForFile(row.filename, searchModelNames);
    await upsertSearchPresetForFile(row.filename, presetName);
}

/** Facet/model/preset backlog only (no metadata JSON parse in SQL). */
function buildFacetBackfillQueueWhereClause() {
    return `
            f.filename IS NULL
            OR f.indexed_at < ${SQL_IMAGE_MTIME_SECS}
            OR COALESCE(f.model_extract_attempted, 0) = 0
            OR (
                NOT EXISTS (SELECT 1 FROM search_models sm WHERE sm.filename = i.filename)
                AND COALESCE(f.model_norm, '') != ''
            )
            OR (
                COALESCE(f.preset_name, '') != ''
                AND NOT EXISTS (SELECT 1 FROM search_presets sp WHERE sp.filename = i.filename)
            )`;
}

/** SQL WHERE fragment shared by backfill queue selectors */
function buildBackfillQueueWhereClause(fullIndex) {
    let clause = buildFacetBackfillQueueWhereClause();

    if (fullIndex) {
        clause += `
            OR (
                EXISTS (
                    SELECT 1 FROM image_prompt_text p
                    WHERE p.filename = i.filename AND p.lane = 'input' AND p.text_norm != ''
                )
                AND NOT EXISTS (
                    SELECT 1 FROM search_tags st
                    WHERE st.filename = i.filename AND st.source = 'input_prompt'
                )
            )`;
    }

    return clause;
}

/** input_prompt tag backlog — flag-based queue (avoids anti-join rescan as search_tags grows). */
function buildInputPromptTagsBackfillQueueClause() {
    return `
            COALESCE(i.input_prompt_tags_extract_attempted, 0) = 0
            AND EXISTS (
                SELECT 1 FROM image_prompt_text p
                WHERE p.filename = i.filename AND p.lane = 'input' AND p.text_norm != ''
            )`;
}

/** Fast filename-only batch selector (avoids json_extract + metadata blob scan). */
async function fetchSearchExtractionBatchFilenames(fullIndex, batchSize, afterFilename = '') {
    const facetWhere = buildFacetBackfillQueueWhereClause();
    const keysetClause = afterFilename ? 'AND i.filename > ?' : '';
    const keysetParams = afterFilename ? [afterFilename] : [];

    if (!fullIndex) {
        const rows = await db.all(`
            SELECT i.filename
            FROM images i
            LEFT JOIN image_search_facets f ON i.filename = f.filename
            WHERE i.metadata IS NOT NULL
              AND i.metadata != ''
              AND (${facetWhere})
              ${keysetClause}
            ORDER BY i.filename
            LIMIT ?
        `, [...keysetParams, batchSize]);
        return rows.map((row) => row.filename);
    }

    const rows = await db.all(`
        SELECT filename FROM (
            SELECT i.filename
            FROM images i
            LEFT JOIN image_search_facets f ON i.filename = f.filename
            WHERE i.metadata IS NOT NULL
              AND i.metadata != ''
              ${keysetClause}
              AND (${facetWhere})
            UNION
            SELECT i.filename
            FROM images i
            WHERE i.metadata IS NOT NULL
              AND i.metadata != ''
              ${keysetClause}
              AND (${buildInputPromptTagsBackfillQueueClause()})
        )
        ORDER BY filename
        LIMIT ?
    `, [...keysetParams, ...keysetParams, batchSize]);
    return rows.map((row) => row.filename);
}

/** Merge WAL pages into the main db file between backfill batches (CLI has no periodic checkpoint manager). */
async function checkpointWalAfterBackfillBatch(truncate = false) {
    if (!dbInitialized || !db) return;
    try {
        await db.run(truncate ? 'PRAGMA wal_checkpoint(TRUNCATE)' : 'PRAGMA wal_checkpoint(PASSIVE)');
    } catch (walError) {
        logger.warn('WAL checkpoint during search extraction backfill:', walError.message);
    }
}

async function fetchImageRowsForBackfill(filenames) {
    if (!filenames.length) {
        return [];
    }
    const placeholders = filenames.map(() => '?').join(',');
    return db.all(`
        SELECT i.id, i.filename, i.width, i.height, i.parent, i.upscaled, i.mtime,
               LENGTH(i.metadata) AS metadata_len, i.metadata
        FROM images i
        WHERE i.filename IN (${placeholders})
        ORDER BY i.filename
    `, filenames);
}

/**
 * Backfill facet rows from stored images.metadata JSON (no PNG disk read).
 * Processes in small batches so full metadata blobs are never all loaded at once.
 */
async function syncSearchFacetsFromStoredMetadata(progressCallback = null) {
    if (!WRITE_SEARCH_FACETS) {
        return { updatedCount: 0, errorCount: 0, totalFiles: 0 };
    }

    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const countRow = await db.get(`
        SELECT COUNT(*) AS cnt
        FROM images i
        LEFT JOIN image_search_facets f ON i.filename = f.filename
        WHERE i.metadata IS NOT NULL
          AND i.metadata != ''
          AND (
            f.filename IS NULL
            OR f.indexed_at < ${SQL_IMAGE_MTIME_SECS}
          )
    `);
    const totalFiles = countRow?.cnt || 0;

    if (totalFiles === 0) {
        return { updatedCount: 0, errorCount: 0, totalFiles: 0 };
    }

    let updatedCount = 0;
    let errorCount = 0;
    let processed = 0;

    while (processed < totalFiles) {
        const batch = await db.all(`
            SELECT i.id, i.filename, i.width, i.height, i.parent, i.upscaled, i.mtime, i.metadata
            FROM images i
            LEFT JOIN image_search_facets f ON i.filename = f.filename
            WHERE i.metadata IS NOT NULL
              AND i.metadata != ''
              AND (
                f.filename IS NULL
                OR f.indexed_at < ${SQL_IMAGE_MTIME_SECS}
              )
            ORDER BY i.filename
            LIMIT ?
        `, [FACET_BACKFILL_BATCH]);

        if (!batch.length) {
            break;
        }

        for (let i = 0; i < batch.length; i++) {
            const row = batch[i];
            try {
                if (row.metadata && row.metadata.length > MAX_METADATA_JSON_SIZE) {
                    console.warn(`⚠️ Skipping facet backfill for ${row.filename}: metadata ${row.metadata.length} bytes`);
                    errorCount++;
                    continue;
                }
                const pngMeta = sanitizePngMetaForIndexing(JSON.parse(row.metadata));
                const facets = extractSearchFacetsFromMetadata(pngMeta, row);
                if (facets) {
                    facets.model_extract_attempted = 1;
                    await upsertSearchFacets(row.filename, facets);
                    updatedCount++;
                }
            } catch (error) {
                logger.error(`Error backfilling search facets for ${row.filename}:`, error);
                errorCount++;
            }

            processed += 1;
            if (progressCallback && (processed % 50 === 0 || processed === totalFiles)) {
                progressCallback({
                    current: processed,
                    total: totalFiles,
                    filename: row.filename,
                    updatedCount,
                    errorCount,
                    status: 'facet_backfill'
                });
            }
        }
    }

    return { updatedCount, errorCount, totalFiles };
}

/**
 * Incremental backfill: re-index facets, search_models, search_presets, and (when BACKFILL_FULL_INDEX=1) input_prompt tags
 * for rows missing extraction or stale vs images.mtime.
 * @param {Object} [options]
 * @param {number} [options.batchSize] - Files per SQL batch (default FACET_BACKFILL_BATCH)
 * @param {number} [options.maxBatches] - Stop after N batches (default unlimited)
 * @param {Function} [options.progressCallback]
 */
async function backfillSearchExtraction(options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const fullIndex = options.fullIndex != null ? Boolean(options.fullIndex) : BACKFILL_FULL_INDEX;
    const batchSize = Math.max(50, parseInt(options.batchSize || FACET_BACKFILL_BATCH, 10) || FACET_BACKFILL_BATCH);
    const maxBatches = options.maxBatches != null ? Math.max(1, parseInt(options.maxBatches, 10) || 1) : null;
    const progressCallback = options.progressCallback || null;

    let updatedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let batchNum = 0;
    let afterFilename = '';

    while (maxBatches == null || batchNum < maxBatches) {
        const nextBatch = batchNum + 1;
        const batchStarted = Date.now();
        if (progressCallback) {
            progressCallback({
                batch: nextBatch,
                status: 'querying_batch',
                mode: fullIndex ? 'input_prompt_fast' : 'facets_fast'
            });
        }

        const queryStarted = Date.now();
        const filenames = await fetchSearchExtractionBatchFilenames(fullIndex, batchSize, afterFilename);
        const queryMs = Date.now() - queryStarted;
        if (!filenames.length) {
            break;
        }

        if (progressCallback) {
            progressCallback({
                batch: nextBatch,
                batchSize: filenames.length,
                queryMs,
                status: 'batch_fetched',
                mode: fullIndex ? 'input_prompt_fast' : 'facets_fast'
            });
        }

        const batch = await fetchImageRowsForBackfill(filenames);
        if (!batch.length) {
            break;
        }

        batchNum = nextBatch;

        const inputPromptAttemptedFilenames = [];

        try {
            await db.run('BEGIN TRANSACTION');
        } catch (txError) {
            logger.warn('Search extraction backfill batch transaction begin failed, continuing without transaction:', txError.message);
        }

        for (let i = 0; i < batch.length; i++) {
            const row = batch[i];
            const filename = row.filename;
            const metadataLen = row.metadata_len;
            try {
                if (metadataLen > MAX_METADATA_JSON_SIZE) {
                    console.warn(`⚠️ Skipping search extraction backfill for ${filename}: metadata ${metadataLen} bytes`);
                    skippedCount++;
                    continue;
                }

                const pngMeta = sanitizePngMetaForIndexing(JSON.parse(row.metadata));
                await backfillSearchFacetsForRow(row, pngMeta);
                if (fullIndex) {
                    await backfillInputPromptTagsForRow(row, pngMeta, { deferAttemptedMark: true });
                    inputPromptAttemptedFilenames.push(filename);
                }
                updatedCount++;
            } catch (error) {
                logger.error(`Error backfilling search extraction for ${filename}:`, error);
                errorCount++;
            }

            const processed = updatedCount + errorCount + skippedCount;
            if (progressCallback && (processed === 1 || processed % 50 === 0 || i === batch.length - 1)) {
                progressCallback({
                    current: processed,
                    batch: batchNum,
                    filename,
                    updatedCount,
                    errorCount,
                    skippedCount,
                    mode: fullIndex ? 'input_prompt_fast' : 'facets_fast',
                    status: 'search_extraction_backfill'
                });
            }
        }

        if (fullIndex && inputPromptAttemptedFilenames.length) {
            const attemptedPlaceholders = inputPromptAttemptedFilenames.map(() => '?').join(',');
            await db.run(`
                UPDATE images SET input_prompt_tags_extract_attempted = 1, updated_at = strftime('%s', 'now')
                WHERE filename IN (${attemptedPlaceholders})
            `, inputPromptAttemptedFilenames);
        }

        try {
            await db.run('COMMIT');
        } catch (txError) {
            try {
                await db.run('ROLLBACK');
            } catch (rollbackError) {
                logger.error('Error rolling back search extraction backfill batch:', rollbackError);
            }
            logger.error('Search extraction backfill batch commit failed:', txError);
        }

        afterFilename = filenames[filenames.length - 1];
        const truncateWal = batchNum % BACKFILL_WAL_CHECKPOINT_EVERY === 0;
        await checkpointWalAfterBackfillBatch(truncateWal);

        const batchMs = Date.now() - batchStarted;
        const batchFiles = batch.length;
        if (progressCallback) {
            progressCallback({
                batch: batchNum,
                batchMs,
                queryMs,
                batchFiles,
                filesPerSec: batchMs > 0 ? Math.round((batchFiles * 1000) / batchMs) : batchFiles,
                updatedCount,
                errorCount,
                skippedCount,
                status: 'batch_complete',
                mode: fullIndex ? 'input_prompt_fast' : 'facets_fast'
            });
        }
    }

    if (batchNum > 0) {
        await checkpointWalAfterBackfillBatch(true);
    }

    return {
        updatedCount,
        errorCount,
        skippedCount,
        batches: batchNum,
        mode: fullIndex ? 'input_prompt_fast' : 'facets_fast'
    };
}

/**
 * Incremental backfill for image_prompt_text from stored images.metadata JSON (CLI only — not boot).
 * @param {Object} [options]
 * @param {number} [options.batchSize]
 * @param {number} [options.maxBatches]
 * @param {Function} [options.progressCallback]
 */
async function backfillPromptBlobs(options = {}) {
    if (!WRITE_PROMPT_BLOBS) {
        return { updatedCount: 0, errorCount: 0, skippedCount: 0, batches: 0 };
    }

    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const batchSize = Math.max(50, parseInt(options.batchSize || PROMPT_BLOB_BACKFILL_BATCH, 10) || PROMPT_BLOB_BACKFILL_BATCH);
    const maxBatches = options.maxBatches != null ? Math.max(1, parseInt(options.maxBatches, 10) || 1) : null;
    const progressCallback = options.progressCallback || null;

    let updatedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let batchNum = 0;

    while (maxBatches == null || batchNum < maxBatches) {
        const batch = await db.all(`
            SELECT i.filename, LENGTH(i.metadata) AS metadata_len, i.metadata
            FROM images i
            WHERE i.metadata IS NOT NULL
              AND i.metadata != ''
              AND COALESCE(i.blob_extract_attempted, 0) = 0
              AND NOT EXISTS (
                  SELECT 1 FROM image_prompt_text p WHERE p.filename = i.filename
              )
            ORDER BY i.filename
            LIMIT ?
        `, [batchSize]);

        if (!batch.length) {
            break;
        }

        batchNum += 1;

        try {
            await db.run('BEGIN TRANSACTION');
        } catch (txError) {
            logger.warn('Prompt blob backfill batch transaction begin failed, continuing without transaction:', txError.message);
        }

        for (let i = 0; i < batch.length; i++) {
            const row = batch[i];
            const filename = row.filename;
            try {
                if (row.metadata_len > MAX_METADATA_JSON_SIZE) {
                    console.warn(`⚠️ Skipping prompt blob backfill for ${filename}: metadata ${row.metadata_len} bytes`);
                    await markBlobExtractAttempted(filename);
                    skippedCount++;
                    continue;
                }
                const pngMeta = sanitizePngMetaForIndexing(JSON.parse(row.metadata));
                await upsertPromptBlobs(filename, pngMeta);
                updatedCount++;
            } catch (error) {
                logger.error(`Error backfilling prompt blobs for ${filename}:`, error);
                await markBlobExtractAttempted(filename);
                errorCount++;
            }

            if (progressCallback && ((updatedCount + errorCount + skippedCount) % 50 === 0 || i === batch.length - 1)) {
                progressCallback({
                    current: updatedCount + errorCount + skippedCount,
                    batch: batchNum,
                    filename,
                    updatedCount,
                    errorCount,
                    skippedCount,
                    status: 'prompt_blob_backfill'
                });
            }
        }

        try {
            await db.run('COMMIT');
        } catch (txError) {
            try {
                await db.run('ROLLBACK');
            } catch (rollbackError) {
                logger.error('Error rolling back prompt blob backfill batch:', rollbackError);
            }
            logger.error('Prompt blob backfill batch commit failed:', txError);
        }
    }

    return { updatedCount, errorCount, skippedCount, batches: batchNum, mode: 'prompt_blobs_fast' };
}

/**
 * Incremental backfill for prompt_fts_* from image_prompt_text rows (CLI only — not boot).
 * @param {Object} [options]
 * @param {boolean} [options.includeDrift=false] — expensive; skip on connect / hot path
 * @param {boolean} [options.bypassCache=false]
 */
let promptIndexStatsCache = null;
const PROMPT_INDEX_STATS_CACHE_TTL_MS = 60000;

async function getPromptIndexStats(options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const includeDrift = options.includeDrift === true;
    const bypassCache = options.bypassCache === true;
    const now = Date.now();
    if (!bypassCache && promptIndexStatsCache
        && promptIndexStatsCache.includeDrift === includeDrift
        && (now - promptIndexStatsCache.at) < PROMPT_INDEX_STATS_CACHE_TTL_MS) {
        return promptIndexStatsCache.value;
    }

    const readDb = await getReadOnlyDatabase();
    const readHandle = readDb || db;

    const summary = await readHandle.get(`
        SELECT
            COUNT(*) AS totalImages,
            SUM(CASE WHEN COALESCE(fts_extract_attempted, 0) = 1 THEN 1 ELSE 0 END) AS ftsDone,
            SUM(CASE WHEN COALESCE(blob_extract_attempted, 0) = 0 THEN 1 ELSE 0 END) AS blobPending,
            SUM(CASE WHEN COALESCE(fts_extract_attempted, 0) = 0 AND COALESCE(blob_extract_attempted, 0) = 1 THEN 1 ELSE 0 END) AS ftsPending
        FROM images
    `);

    let ftsDrift = 0;
    if (includeDrift) {
        // Prefer FTS→images direction so we do not scan every unmarked image row.
        const driftRow = await readHandle.get(`
            SELECT COUNT(*) AS ftsDrift FROM (
                SELECT c.filename AS filename FROM prompt_fts_compiled c
                UNION
                SELECT inp.filename AS filename FROM prompt_fts_input inp
            ) f
            WHERE EXISTS (
                SELECT 1 FROM images i
                WHERE i.filename = f.filename
                  AND COALESCE(i.fts_extract_attempted, 0) = 0
            )
        `);
        ftsDrift = Number(driftRow?.ftsDrift) || 0;
    }

    const value = {
        totalImages: Number(summary?.totalImages) || 0,
        ftsDone: Number(summary?.ftsDone) || 0,
        blobPending: Number(summary?.blobPending) || 0,
        ftsPending: Number(summary?.ftsPending) || 0,
        ftsDrift
    };
    promptIndexStatsCache = { at: now, includeDrift, value };
    return value;
}

async function reconcilePromptFtsFlags() {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const result = await db.run(`
        UPDATE images SET fts_extract_attempted = 1, updated_at = strftime('%s', 'now')
        WHERE fts_extract_attempted = 0
          AND (
              EXISTS (SELECT 1 FROM prompt_fts_compiled c WHERE c.filename = images.filename)
              OR EXISTS (SELECT 1 FROM prompt_fts_input inp WHERE inp.filename = images.filename)
          )
    `);

    return { updated: result?.changes || 0 };
}

async function backfillPromptFts(options = {}) {
    if (!WRITE_PROMPT_FTS) {
        return { updatedCount: 0, errorCount: 0, skippedCount: 0, batches: 0 };
    }

    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const batchSize = Math.max(50, parseInt(options.batchSize || PROMPT_FTS_BACKFILL_BATCH, 10) || PROMPT_FTS_BACKFILL_BATCH);
    const maxBatches = options.maxBatches != null ? Math.max(1, parseInt(options.maxBatches, 10) || 1) : null;
    const progressCallback = options.progressCallback || null;
    const shouldAbort = options.shouldAbort || null;

    let updatedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let batchNum = 0;

    while (maxBatches == null || batchNum < maxBatches) {
        if (shouldAbort && shouldAbort()) {
            return { updatedCount, errorCount, skippedCount, batches: batchNum, aborted: true, mode: 'prompt_fts_fast' };
        }

        const batch = await db.all(`
            SELECT i.filename
            FROM images i
            WHERE COALESCE(i.fts_extract_attempted, 0) = 0
              AND COALESCE(i.blob_extract_attempted, 0) = 1
            ORDER BY i.filename
            LIMIT ?
        `, [batchSize]);

        if (!batch.length) {
            break;
        }

        batchNum += 1;

        try {
            await db.run('BEGIN TRANSACTION');
        } catch (txError) {
            logger.warn('Prompt FTS backfill batch transaction begin failed, continuing without transaction:', txError.message);
        }

        for (let i = 0; i < batch.length; i++) {
            if (shouldAbort && shouldAbort()) {
                try {
                    await db.run('ROLLBACK');
                } catch (rollbackError) {
                    logger.error('Error rolling back prompt FTS backfill batch on abort:', rollbackError);
                }
                return { updatedCount, errorCount, skippedCount, batches: batchNum, aborted: true, mode: 'prompt_fts_fast' };
            }

            const { filename } = batch[i];
            try {
                const blobRows = await db.all(`
                    SELECT lane, text_norm FROM image_prompt_text WHERE filename = ?
                `, [filename]);
                if (!blobRows.length) {
                    await markFtsExtractAttempted(filename);
                    skippedCount++;
                    continue;
                }
                await upsertPromptFtsFromBlobRows(filename, blobRows);
                updatedCount++;
            } catch (error) {
                logger.error(`Error backfilling prompt FTS for ${filename}:`, error);
                await markFtsExtractAttempted(filename);
                errorCount++;
            }

            if (progressCallback && ((updatedCount + errorCount + skippedCount) % 50 === 0 || i === batch.length - 1)) {
                progressCallback({
                    current: updatedCount + errorCount + skippedCount,
                    batch: batchNum,
                    filename,
                    updatedCount,
                    errorCount,
                    skippedCount,
                    status: 'prompt_fts_backfill'
                });
            }
        }

        try {
            await db.run('COMMIT');
        } catch (txError) {
            try {
                await db.run('ROLLBACK');
            } catch (rollbackError) {
                logger.error('Error rolling back prompt FTS backfill batch:', rollbackError);
            }
            logger.error('Prompt FTS backfill batch commit failed:', txError);
        }
    }

    return { updatedCount, errorCount, skippedCount, batches: batchNum, mode: 'prompt_fts_fast' };
}

/**
 * Full corpus seed-chain rebuild (CLI only — not boot).
 * @param {Object} [options]
 */
async function backfillSeedChains(options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const progressCallback = options.progressCallback || null;
    const result = await rebuildAllSeedChains(progressCallback);
    return { ...result, mode: 'seed_chains_full' };
}

/**
 * Mirror workspace config file lists into image_workspace_membership (Phase 2).
 * @param {Object} workspaces - workspaces config object keyed by workspace id
 */
async function syncWorkspaceMembership(workspaces) {
    if (!WRITE_WORKSPACE_MEMBERSHIP) {
        return { inserted: 0 };
    }

    if (!dbInitialized || !db) {
        return { inserted: 0 };
    }

    const rows = [];
    for (const [workspaceId, workspace] of Object.entries(workspaces || {})) {
        for (const filename of workspace.files || []) {
            if (filename) rows.push([workspaceId, filename, 'files']);
        }
        for (const filename of workspace.scraps || []) {
            if (filename) rows.push([workspaceId, filename, 'scraps']);
        }
        for (const filename of workspace.pinned || []) {
            if (filename) rows.push([workspaceId, filename, 'pinned']);
        }
    }

    await db.run('DELETE FROM image_workspace_membership');

    const INSERT_BATCH = 500;
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const batch = rows.slice(i, i + INSERT_BATCH);
        const valuePlaceholders = batch.map(() => '(?, ?, ?)').join(',');
        const params = batch.flat();
        await db.run(
            `INSERT OR IGNORE INTO image_workspace_membership (workspace_id, filename, bucket) VALUES ${valuePlaceholders}`,
            params
        );
    }

    return { inserted: rows.length };
}

/**
 * Build workspace scope SQL fragment (subquery on gallery_workspace_ownership when USE_WORKSPACE_MEMBERSHIP).
 * @param {Object} workspaceScope - { workspaceIds, bucket }
 * @returns {{ sql: string, params: Array }}
 */
function buildWorkspaceOwnershipScopeSql(workspaceScope) {
    const placeholders = workspaceScope.workspaceIds.map(() => '?').join(',');
    const table = USE_WORKSPACE_MEMBERSHIP ? GALLERY_OWNERSHIP_TABLE : 'image_workspace_membership';
    return {
        sql: `filename IN (SELECT filename FROM ${table} WHERE workspace_id IN (${placeholders}) AND bucket = ?)`,
        params: [...workspaceScope.workspaceIds, workspaceScope.bucket || 'files']
    };
}

/**
 * Count distinct filenames in a workspace scope (SQL membership path when files[] is not materialized).
 * @param {Object} workspaceScope - { workspaceIds, bucket }
 * @returns {Promise<number>}
 */
async function countWorkspaceCorpusFiles(workspaceScope) {
    if (!dbInitialized || !db || !workspaceScope?.workspaceIds?.length) {
        return 0;
    }
    const placeholders = workspaceScope.workspaceIds.map(() => '?').join(',');
    const table = USE_WORKSPACE_MEMBERSHIP ? GALLERY_OWNERSHIP_TABLE : 'image_workspace_membership';
    const bucket = workspaceScope.bucket || 'files';
    const row = await db.get(
        `SELECT COUNT(DISTINCT filename) AS count FROM ${table} WHERE workspace_id IN (${placeholders}) AND bucket = ?`,
        [...workspaceScope.workspaceIds, bucket]
    );
    return row?.count || 0;
}

function getGalleryBaseName(filename) {
    if (!filename || typeof filename !== 'string') {
        return '';
    }
    const base = filename.replace(/\.(png|jpg|jpeg)$/i, '');
    return base.replace(/_upscaled$/, '');
}

async function resolveGalleryItemLightweight(filename) {
    if (!filename) {
        return null;
    }

    const hot = metadataWriteQueue.getHotImage(filename);
    if (hot) {
        return projectLightweightMetadata(hot);
    }

    if (dbInitialized && db) {
        const image = await db.get(
            'SELECT filename, mtime, width, height, size, upscaled, parent, blurhash FROM images WHERE filename = ?',
            [filename]
        );
        if (image) {
            return {
                filename: image.filename,
                mtime: image.mtime || Date.now(),
                width: image.width || null,
                height: image.height || null,
                size: image.size || 0,
                upscaled: Boolean(image.upscaled),
                parent: image.parent || null,
                blurhash: image.blurhash || null
            };
        }
    }

    return {
        filename,
        mtime: Date.now(),
        width: null,
        height: null,
        size: 0,
        upscaled: filename.includes('_upscaled'),
        parent: null,
        blurhash: null
    };
}

async function computeGalleryWorkspaceItemFields(original, upscaled) {
    const displayFile = upscaled || original;
    const metaOriginal = original ? await resolveGalleryItemLightweight(original) : null;
    const metaUpscaled = upscaled ? await resolveGalleryItemLightweight(upscaled) : null;
    const metaDisplay = displayFile ? await resolveGalleryItemLightweight(displayFile) : null;

    const sortMtime = Math.max(metaOriginal?.mtime || 0, metaUpscaled?.mtime || 0);
    const width = metaDisplay?.width || null;
    const height = metaDisplay?.height || null;
    const size = metaDisplay?.size || 0;
    const blurhash = metaDisplay?.blurhash || metaOriginal?.blurhash || metaUpscaled?.blurhash || null;
    const inUpscaledView = upscaled
        ? 1
        : (width && height && isImageLarge(width, height) ? 1 : 0);

    return { sortMtime, width, height, size, inUpscaledView, blurhash };
}

function galleryFilenameCandidatesForBase(base) {
    if (!base) {
        return [];
    }
    const exts = ['.png', '.jpg', '.jpeg'];
    const candidates = [];
    for (const ext of exts) {
        candidates.push(`${base}${ext}`);
        candidates.push(`${base}_upscaled${ext}`);
    }
    return candidates;
}

/**
 * O(1) ownership lookup for one paired gallery base — never scan the whole workspace bucket.
 */
async function listGalleryOwnershipFilenamesForBase(workspaceId, bucket, base) {
    if (!workspaceId || !base || !dbInitialized || !db) {
        return [];
    }

    const targetBucket = bucket || 'files';
    const candidates = galleryFilenameCandidatesForBase(base);
    if (!candidates.length) {
        return [];
    }

    const placeholders = candidates.map(() => '?').join(',');
    const rows = await db.all(
        `SELECT filename FROM ${GALLERY_OWNERSHIP_TABLE}
         WHERE workspace_id = ? AND bucket = ? AND filename IN (${placeholders})`,
        [workspaceId, targetBucket, ...candidates]
    );

    const filenames = new Set();
    for (const row of rows || []) {
        if (!row.filename || isGalleryOwnershipRowRemoved(row.filename, workspaceId, targetBucket)) {
            continue;
        }
        filenames.add(row.filename);
    }

    for (const hot of metadataWriteQueue.getHotGalleryOwnershipForWorkspace(workspaceId, targetBucket)) {
        if (!hot.filename || isGalleryOwnershipRowRemoved(hot.filename, workspaceId, targetBucket)) {
            continue;
        }
        if (getGalleryBaseName(hot.filename) === base) {
            filenames.add(hot.filename);
        }
    }

    return Array.from(filenames);
}

/**
 * Rebuild one paired gallery row from current ownership membership.
 */
async function rebuildGalleryWorkspaceItem(workspaceId, bucket, base) {
    if (!WRITE_GALLERY_ITEMS || !dbInitialized || !db || !workspaceId || !bucket || !base) {
        return false;
    }

    const matching = await listGalleryOwnershipFilenamesForBase(workspaceId, bucket, base);

    if (matching.length === 0) {
        await db.run(
            `DELETE FROM ${GALLERY_ITEMS_TABLE} WHERE workspace_id = ? AND bucket = ? AND base = ?`,
            [workspaceId, bucket, base]
        );
        return 'deleted';
    }

    let original = null;
    let upscaled = null;
    for (const filename of matching) {
        if (filename.includes('_upscaled')) {
            upscaled = filename;
        } else {
            original = filename;
        }
    }

    const fields = await computeGalleryWorkspaceItemFields(original, upscaled);
    await db.run(`
        INSERT OR REPLACE INTO ${GALLERY_ITEMS_TABLE}
            (workspace_id, bucket, base, original, upscaled, sort_mtime, width, height, size, in_upscaled_view, blurhash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        workspaceId,
        bucket,
        base,
        original,
        upscaled,
        fields.sortMtime,
        fields.width,
        fields.height,
        fields.size,
        fields.inUpscaledView,
        fields.blurhash || null
    ]);

    return 'upserted';
}

async function syncGalleryWorkspaceItemOnOwnershipChange(filename, workspaceId, bucket = 'files') {
    if (!WRITE_GALLERY_ITEMS || !filename || !workspaceId) {
        return false;
    }

    const targetBucket = bucket || 'files';
    const base = getGalleryBaseName(filename);
    if (!base) {
        return false;
    }

    if (targetBucket === 'pinned') {
        const ownsPinned = await db.get(
            `SELECT 1 AS ok FROM ${GALLERY_OWNERSHIP_TABLE}
             WHERE filename = ? AND workspace_id = ? AND bucket = 'pinned' LIMIT 1`,
            [filename, workspaceId]
        );
        if (ownsPinned?.ok) {
            await syncGalleryPinFromOwnershipFilename(workspaceId, filename);
        } else {
            await removeGalleryWorkspacePin(workspaceId, filename);
        }
        await refreshGalleryWorkspaceIndexMeta(workspaceId, ['pinned']);
        return true;
    }

    await rebuildGalleryWorkspaceItem(workspaceId, targetBucket, base);
    clearGalleryBlockCursorMemoryFrom(workspaceId, targetBucket === 'scraps' ? 'scraps' : 'images', 0);
    if (targetBucket === 'scraps') {
        await refreshGalleryWorkspaceIndexMeta(workspaceId, ['scraps', 'images', 'upscaled']);
    } else {
        await refreshGalleryWorkspaceIndexMeta(workspaceId, ['images', 'upscaled']);
    }
    return true;
}

async function refreshGalleryWorkspaceItemsForFilename(filename) {
    if (!WRITE_GALLERY_ITEMS || !dbInitialized || !db || !filename) {
        return 0;
    }

    const rows = await db.all(
        `SELECT workspace_id, bucket, base FROM ${GALLERY_ITEMS_TABLE}
         WHERE original = ? OR upscaled = ?`,
        [filename, filename]
    );

    if (!rows || rows.length === 0) {
        let refreshed = 0;
        const ownershipRows = await db.all(
            `SELECT workspace_id, bucket FROM ${GALLERY_OWNERSHIP_TABLE} WHERE filename = ?`,
            [filename]
        );
        const seen = new Set();
        for (const row of ownershipRows || []) {
            const syncKey = `${row.workspace_id}\0${row.bucket || 'files'}`;
            if (seen.has(syncKey)) continue;
            seen.add(syncKey);
            await syncGalleryWorkspaceItemOnOwnershipChange(filename, row.workspace_id, row.bucket || 'files');
            refreshed += 1;
        }
        for (const hotRow of metadataWriteQueue.getHotGalleryOwnershipRowsForFile(filename)) {
            const syncKey = `${hotRow.workspaceId}\0${hotRow.bucket || 'files'}`;
            if (seen.has(syncKey)) continue;
            seen.add(syncKey);
            await syncGalleryWorkspaceItemOnOwnershipChange(filename, hotRow.workspaceId, hotRow.bucket || 'files');
            refreshed += 1;
        }
        return refreshed;
    }

    let refreshed = 0;
    const workspacesTouched = new Set();
    for (const row of rows) {
        await rebuildGalleryWorkspaceItem(row.workspace_id, row.bucket, row.base);
        workspacesTouched.add(row.workspace_id);
        refreshed += 1;
    }

    for (const workspaceId of workspacesTouched) {
        await refreshGalleryWorkspaceIndexMeta(workspaceId);
    }

    return refreshed;
}

async function refreshGalleryWorkspaceIndexMeta(workspaceId, viewTypes = null) {
    if (!WRITE_GALLERY_ITEMS || !dbInitialized || !db || !workspaceId) {
        return false;
    }

    const views = viewTypes || ['images', 'upscaled', 'scraps', 'pinned'];
    const now = Date.now();

    for (const viewType of views) {
        await syncGalleryIndexMetaCount(workspaceId, viewType, now);
    }

    return true;
}

async function syncGalleryIndexMetaCount(workspaceId, viewType, updatedAt = Date.now()) {
    if (!dbInitialized || !db || !workspaceId || !viewType) {
        return false;
    }

    let totalItems = await countGalleryWorkspaceItems(workspaceId, viewType);
    if (viewType === 'pinned') {
        totalItems = await countGalleryWorkspacePins(workspaceId);
    }

    // head_seq / body_rev columns remain for schema compatibility but are unused (always 0).
    await db.run(`
        INSERT INTO ${GALLERY_INDEX_META_TABLE}
            (workspace_id, view_type, total_items, head_seq, body_rev, updated_at)
        VALUES (?, ?, ?, 0, 0, ?)
        ON CONFLICT(workspace_id, view_type) DO UPDATE SET
            total_items = excluded.total_items,
            updated_at = excluded.updated_at
    `, [workspaceId, viewType, totalItems, updatedAt]);

    return true;
}

function galleryBlockOffsetForIndex(index) {
    const idx = Math.max(0, Number(index) || 0);
    return Math.floor(idx / GALLERY_BLOCK_SIZE) * GALLERY_BLOCK_SIZE;
}

function clearGalleryBlockCursorMemoryFrom(workspaceId, viewType, fromBlockOffset) {
    if (!workspaceId || !viewType) {
        return;
    }
    const minOffset = Math.max(0, Number(fromBlockOffset) || 0);
    for (const key of galleryBlockCursorMemory.keys()) {
        if (!key.startsWith(`${workspaceId}::${viewType}::`)) {
            continue;
        }
        const off = Number(key.split('::')[2]) || 0;
        if (off >= minOffset) {
            galleryBlockCursorMemory.delete(key);
        }
    }
}

/** Memory-only cursor invalidation — block_meta revision rows are no longer maintained. */
async function clearGalleryBlockBoundariesFrom(workspaceId, viewType, fromBlockOffset) {
    clearGalleryBlockCursorMemoryFrom(workspaceId, viewType, fromBlockOffset);
    return true;
}

function isGalleryBlockPage(offset, limit) {
    const off = Math.max(0, Number(offset) || 0);
    const lim = Math.max(0, Number(limit) || 0);
    return lim > 0 && lim <= GALLERY_BLOCK_SIZE && off % GALLERY_BLOCK_SIZE === 0;
}

function galleryBlockCursorMemoryKey(workspaceId, viewType, blockOffset) {
    return `${workspaceId}::${viewType}::${Math.max(0, Number(blockOffset) || 0)}`;
}

function getMemoryGalleryBlockCursors(workspaceId, viewType, blockOffset) {
    return galleryBlockCursorMemory.get(galleryBlockCursorMemoryKey(workspaceId, viewType, blockOffset)) || null;
}

function cacheGalleryBlockCursorsInMemory(workspaceId, viewType, blockOffset, cursors) {
    const key = galleryBlockCursorMemoryKey(workspaceId, viewType, blockOffset);
    const existing = galleryBlockCursorMemory.get(key) || {};
    galleryBlockCursorMemory.set(key, {
        start: cursors.start || existing.start || null,
        end: cursors.end || existing.end || null
    });
}

function getGalleryBlockEndCursor(workspaceId, viewType, blockOffset) {
    const memory = getMemoryGalleryBlockCursors(workspaceId, viewType, blockOffset);
    return memory?.end || null;
}

function getGalleryBlockBoundary(workspaceId, viewType, blockOffset) {
    const memory = getMemoryGalleryBlockCursors(workspaceId, viewType, blockOffset);
    return memory?.start || null;
}

function buildGalleryItemsSelectSql(workspaceId, bucket, viewType) {
    let sql = `SELECT base, original, upscaled, sort_mtime, width, height, size, in_upscaled_view, blurhash
               FROM ${GALLERY_ITEMS_TABLE}
               WHERE workspace_id = ? AND bucket = ?`;
    const params = [workspaceId, bucket];
    if (viewType === 'upscaled') {
        sql += ' AND in_upscaled_view = 1';
    }
    return { sql, params };
}

function mapGalleryMaterializedRow(row) {
    return {
        base: row.base,
        original: row.original,
        upscaled: row.upscaled,
        mtime: row.sort_mtime || 0,
        width: row.width || null,
        height: row.height || null,
        size: row.size || 0,
        inUpscaledView: Boolean(row.in_upscaled_view),
        blurhash: row.blurhash || null
    };
}

async function queryGalleryItemsKeysetStart(readHandle, workspaceId, bucket, viewType, startBoundary, limit) {
    const built = buildGalleryItemsSelectSql(workspaceId, bucket, viewType);
    let sql = built.sql;
    const params = built.params;
    if (startBoundary) {
        sql += ' AND (sort_mtime < ? OR (sort_mtime = ? AND base <= ?))';
        params.push(startBoundary.sortMtime, startBoundary.sortMtime, startBoundary.base);
    }
    sql += ' ORDER BY sort_mtime DESC, base DESC LIMIT ?';
    params.push(Math.max(1, Number(limit) || 1));
    const rows = await readHandle.all(sql, params);
    return (rows || []).map(mapGalleryMaterializedRow);
}

async function queryGalleryItemsKeysetAfter(readHandle, workspaceId, bucket, viewType, tailItem, limit) {
    const built = buildGalleryItemsSelectSql(workspaceId, bucket, viewType);
    let sql = built.sql;
    const params = built.params;
    if (tailItem) {
        const tailMtime = Number(tailItem.mtime ?? tailItem.sort_mtime) || 0;
        const tailBase = String(tailItem.base);
        sql += ' AND (sort_mtime < ? OR (sort_mtime = ? AND base < ?))';
        params.push(tailMtime, tailMtime, tailBase);
    }
    sql += ' ORDER BY sort_mtime DESC, base DESC LIMIT ?';
    params.push(Math.max(1, Number(limit) || 1));
    const rows = await readHandle.all(sql, params);
    return (rows || []).map(mapGalleryMaterializedRow);
}

async function queryGalleryItemsOffset(readHandle, workspaceId, bucket, viewType, offset, limit) {
    let sql = `SELECT base, original, upscaled, sort_mtime, width, height, size, in_upscaled_view, blurhash
               FROM ${GALLERY_ITEMS_TABLE}
               WHERE workspace_id = ? AND bucket = ?`;
    const params = [workspaceId, bucket];
    if (viewType === 'upscaled') {
        sql += ' AND in_upscaled_view = 1';
    }
    sql += ' ORDER BY sort_mtime DESC, base DESC LIMIT ? OFFSET ?';
    params.push(Math.max(1, Number(limit) || 1), Math.max(0, Number(offset) || 0));
    const rows = await readHandle.all(sql, params);
    return (rows || []).map(mapGalleryMaterializedRow);
}

function normalizeGalleryBlockAfterCursor(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const sortMtime = Number(raw.sortMtime ?? raw.sort_mtime ?? raw.mtime);
    const base = raw.base != null ? String(raw.base) : '';
    if (!Number.isFinite(sortMtime) || !base) {
        return null;
    }
    return { sortMtime, base };
}

/** Read-only paginated gallery block fetch — SELECT on gallery_workspace_items only (no DB writes). */
async function listWorkspaceGalleryBlockItems(workspaceId, viewType, offset, limit, totalItems, afterCursor = null) {
    const blockOffset = Math.max(0, Number(offset) || 0);
    const pageLimit = Math.max(1, Number(limit) || GALLERY_BLOCK_SIZE);
    const readDb = await getReadOnlyDatabase();
    const readHandle = readDb || db;
    const bucket = viewTypeToGalleryBucket(viewType);
    const clientAfter = normalizeGalleryBlockAfterCursor(afterCursor);

    let items = [];
    if (blockOffset === 0) {
        items = await queryGalleryItemsKeysetStart(readHandle, workspaceId, bucket, viewType, null, pageLimit);
    } else if (clientAfter) {
        items = await queryGalleryItemsKeysetAfter(
            readHandle,
            workspaceId,
            bucket,
            viewType,
            { mtime: clientAfter.sortMtime, base: clientAfter.base },
            pageLimit
        );
    } else {
        const prevEnd = getGalleryBlockEndCursor(workspaceId, viewType, blockOffset - GALLERY_BLOCK_SIZE);
        if (prevEnd) {
            items = await queryGalleryItemsKeysetAfter(
                readHandle,
                workspaceId,
                bucket,
                viewType,
                { mtime: prevEnd.sortMtime, base: prevEnd.base },
                pageLimit
            );
        }
        if (!items.length) {
            items = await queryGalleryItemsOffset(readHandle, workspaceId, bucket, viewType, blockOffset, pageLimit);
        }
    }

    if (items.length) {
        cacheGalleryBlockCursorsInMemory(workspaceId, viewType, blockOffset, {
            start: { sortMtime: items[0].mtime, base: items[0].base },
            end: { sortMtime: items[items.length - 1].mtime, base: items[items.length - 1].base }
        });
    }
    return items;
}

async function countGalleryWorkspacePins(workspaceId) {
    if (!workspaceId || !dbInitialized || !db) {
        return 0;
    }
    const row = await db.get(
        `SELECT COUNT(*) AS count FROM ${GALLERY_PINS_TABLE} WHERE workspace_id = ?`,
        [workspaceId]
    );
    return Number(row?.count) || 0;
}

async function listGalleryWorkspacePinBases(workspaceId) {
    if (!workspaceId || !dbInitialized || !db) {
        return [];
    }
    const rows = await db.all(
        `SELECT base FROM ${GALLERY_PINS_TABLE}
         WHERE workspace_id = ?
         ORDER BY pin_order ASC, pinned_at ASC, base ASC`,
        [workspaceId]
    );
    return (rows || []).map((row) => row.base).filter(Boolean);
}

async function listGalleryWorkspacePinIndexes(workspaceId) {
    if (!workspaceId || !dbInitialized || !db) {
        return [];
    }
    const rows = await db.all(
        `SELECT (
            SELECT COUNT(*) FROM ${GALLERY_ITEMS_TABLE} gi2
            WHERE gi2.workspace_id = gi.workspace_id
              AND gi2.bucket = 'files'
              AND gi2.sort_mtime > gi.sort_mtime
        ) AS idx
        FROM ${GALLERY_ITEMS_TABLE} gi
        INNER JOIN ${GALLERY_PINS_TABLE} p ON p.workspace_id = gi.workspace_id AND p.base = gi.base
        WHERE gi.workspace_id = ? AND gi.bucket = 'files'
        ORDER BY idx ASC`,
        [workspaceId]
    );
    return (rows || []).map((row) => Number(row.idx)).filter((n) => Number.isFinite(n));
}

async function listGalleryWorkspacePinFilenames(workspaceId) {
    if (!workspaceId || !dbInitialized || !db) {
        return [];
    }
    const rows = await db.all(
        `SELECT gi.original, gi.upscaled
         FROM ${GALLERY_PINS_TABLE} p
         INNER JOIN ${GALLERY_ITEMS_TABLE} gi
           ON gi.workspace_id = p.workspace_id AND gi.base = p.base AND gi.bucket = 'files'
         WHERE p.workspace_id = ?
         ORDER BY p.pin_order ASC, p.pinned_at ASC, p.base ASC`,
        [workspaceId]
    );
    const filenames = [];
    const seen = new Set();
    for (const row of rows || []) {
        const file = row.upscaled || row.original;
        if (file && !seen.has(file)) {
            seen.add(file);
            filenames.push(file);
        }
    }
    return filenames;
}

async function syncGalleryPinFromOwnershipFilename(workspaceId, filename) {
    if (!workspaceId || !filename || !dbInitialized || !db) {
        return false;
    }
    const base = getGalleryBaseName(filename);
    if (!base) {
        return false;
    }
    const now = Date.now();
    await db.run(`
        INSERT OR IGNORE INTO ${GALLERY_PINS_TABLE} (workspace_id, base, pinned_at, pin_order)
        VALUES (?, ?, ?, (SELECT COUNT(*) FROM ${GALLERY_PINS_TABLE} WHERE workspace_id = ?))
    `, [workspaceId, base, now, workspaceId]);
    return true;
}

async function addGalleryWorkspacePin(workspaceId, filename) {
    if (!WRITE_GALLERY_ITEMS || !workspaceId || !filename) {
        return false;
    }
    await syncGalleryPinFromOwnershipFilename(workspaceId, filename);
    await refreshGalleryWorkspaceIndexMeta(workspaceId, ['pinned']);
    return true;
}

async function removeGalleryWorkspacePin(workspaceId, filename) {
    if (!WRITE_GALLERY_ITEMS || !workspaceId || !filename || !dbInitialized || !db) {
        return false;
    }
    const base = getGalleryBaseName(filename);
    if (!base) {
        return false;
    }
    await db.run(
        `DELETE FROM ${GALLERY_PINS_TABLE} WHERE workspace_id = ? AND base = ?`,
        [workspaceId, base]
    );
    await refreshGalleryWorkspaceIndexMeta(workspaceId, ['pinned']);
    return true;
}

async function backfillGalleryPinsFromOwnership() {
    if (!WRITE_GALLERY_ITEMS || !dbInitialized || !db) {
        return { inserted: 0 };
    }

    const rows = await db.all(
        `SELECT DISTINCT workspace_id, filename FROM ${GALLERY_OWNERSHIP_TABLE} WHERE bucket = 'pinned'`
    );
    let inserted = 0;
    for (const row of rows || []) {
        if (!row.workspace_id || !row.filename) {
            continue;
        }
        const base = getGalleryBaseName(row.filename);
        if (!base) {
            continue;
        }
        const result = await db.run(`
            INSERT OR IGNORE INTO ${GALLERY_PINS_TABLE} (workspace_id, base, pinned_at, pin_order)
            VALUES (?, ?, ?, 0)
        `, [row.workspace_id, base, Date.now()]);
        if (result?.changes) {
            inserted += result.changes;
        }
    }
    if (inserted > 0) {
        logger.info(`✓ Backfilled ${inserted} gallery pin row(s) from ownership`);
    }
    return { inserted };
}

async function countGalleryWorkspaceItems(workspaceId, viewType = 'images') {
    if (!workspaceId || !dbInitialized || !db) {
        return 0;
    }

    const bucket = viewTypeToGalleryBucket(viewType);
    let sql = `SELECT COUNT(*) AS count FROM ${GALLERY_ITEMS_TABLE} WHERE workspace_id = ? AND bucket = ?`;
    const params = [workspaceId, bucket];

    if (viewType === 'upscaled') {
        sql += ' AND in_upscaled_view = 1';
    }

    const readDb = await getReadOnlyDatabase();
    const readHandle = readDb || db;
    const row = await readHandle.get(sql, params);
    return Number(row?.count) || 0;
}

async function listWorkspaceGalleryIndexItems(workspaceId, viewType = 'images') {
    if (!workspaceId) {
        return [];
    }
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const bucket = viewTypeToGalleryBucket(viewType);
    let sql = `SELECT base, original, upscaled, sort_mtime, width, height, size, in_upscaled_view, blurhash
               FROM ${GALLERY_ITEMS_TABLE}
               WHERE workspace_id = ? AND bucket = ?`;
    const params = [workspaceId, bucket];

    if (viewType === 'upscaled') {
        sql += ' AND in_upscaled_view = 1';
    }

    sql += ' ORDER BY sort_mtime DESC';
    const rows = await db.all(sql, params);

    return (rows || []).map((row) => ({
        base: row.base,
        original: row.original,
        upscaled: row.upscaled,
        mtime: row.sort_mtime || 0,
        width: row.width || null,
        height: row.height || null,
        size: row.size || 0,
        inUpscaledView: Boolean(row.in_upscaled_view),
        blurhash: row.blurhash || null
    }));
}

async function listWorkspaceGalleryItemsPaginated(workspaceId, viewType = 'images', offset = 0, limit = 100, paginationOptions = null) {
    if (!workspaceId) {
        return { items: [], totalItems: 0 };
    }
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const bucket = viewTypeToGalleryBucket(viewType);
    const meta = await getGalleryWorkspaceIndexMeta(workspaceId, viewType);
    let totalItems = meta ? Number(meta.totalItems) || 0 : 0;
    if (!totalItems) {
        totalItems = await countGalleryWorkspaceItems(workspaceId, viewType);
    }

    const pageOffset = Math.max(0, Number(offset) || 0);
    const pageLimit = Math.max(0, Number(limit) || 0);
    const afterCursor = paginationOptions && paginationOptions.afterCursor
        ? normalizeGalleryBlockAfterCursor(paginationOptions.afterCursor)
        : null;
    let items;

    if (isGalleryBlockPage(pageOffset, pageLimit)) {
        items = await listWorkspaceGalleryBlockItems(workspaceId, viewType, pageOffset, pageLimit, totalItems, afterCursor);
    } else {
        const readDb = await getReadOnlyDatabase();
        const readHandle = readDb || db;
        let sql = `SELECT base, original, upscaled, sort_mtime, width, height, size, in_upscaled_view, blurhash
                   FROM ${GALLERY_ITEMS_TABLE}
                   WHERE workspace_id = ? AND bucket = ?`;
        const params = [workspaceId, bucket];

        if (viewType === 'upscaled') {
            sql += ' AND in_upscaled_view = 1';
        }

        sql += ' ORDER BY sort_mtime DESC, base DESC LIMIT ? OFFSET ?';
        params.push(pageLimit, pageOffset);

        const rows = await readHandle.all(sql, params);
        items = (rows || []).map(mapGalleryMaterializedRow);
    }

    return { items, totalItems };
}

async function findGalleryWorkspaceItemIndex(workspaceId, viewType = 'images', filename) {
    if (!workspaceId || !filename || !dbInitialized || !db) {
        return -1;
    }

    const bucket = viewTypeToGalleryBucket(viewType);
    const base = getGalleryBaseName(filename);
    let locateSql = `SELECT sort_mtime FROM ${GALLERY_ITEMS_TABLE}
                     WHERE workspace_id = ? AND bucket = ?
                       AND (original = ? OR upscaled = ? OR base = ?)`;
    const locateParams = [workspaceId, bucket, filename, filename, base];
    if (viewType === 'upscaled') {
        locateSql += ' AND in_upscaled_view = 1';
    }
    locateSql += ' LIMIT 1';

    const row = await db.get(locateSql, locateParams);
    if (!row) {
        return -1;
    }

    let countSql = `SELECT COUNT(*) AS count FROM ${GALLERY_ITEMS_TABLE}
                    WHERE workspace_id = ? AND bucket = ? AND sort_mtime > ?`;
    const countParams = [workspaceId, bucket, row.sort_mtime || 0];
    if (viewType === 'upscaled') {
        countSql += ' AND in_upscaled_view = 1';
    }

    const countRow = await db.get(countSql, countParams);
    return Number(countRow?.count) || 0;
}

async function getGalleryWorkspaceImageCountsById(workspaceIds, viewType = 'images') {
    const counts = new Map();
    if (!Array.isArray(workspaceIds) || !workspaceIds.length || !dbInitialized || !db) {
        return counts;
    }

    const uniqueIds = [...new Set(workspaceIds.filter(Boolean))];
    if (!uniqueIds.length) {
        return counts;
    }

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const query = `SELECT workspace_id, total_items FROM ${GALLERY_INDEX_META_TABLE}
         WHERE view_type = ? AND workspace_id IN (${placeholders})`;
    const params = [viewType, ...uniqueIds];
    const readDb = await getReadOnlyDatabase();
    const rows = readDb
        ? await readDb.all(query, params)
        : await db.all(query, params);

    for (const row of rows || []) {
        if (row?.workspace_id) {
            counts.set(row.workspace_id, Number(row.total_items) || 0);
        }
    }

    return counts;
}

async function getGalleryWorkspaceStatsById(workspaceIds, viewType = 'images') {
    const stats = new Map();
    if (!Array.isArray(workspaceIds) || !workspaceIds.length || !dbInitialized || !db) {
        return stats;
    }

    const uniqueIds = [...new Set(workspaceIds.filter(Boolean))];
    if (!uniqueIds.length) {
        return stats;
    }

    const bucket = viewTypeToGalleryBucket(viewType);
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const query = `SELECT workspace_id,
                COUNT(*) AS items,
                COALESCE(SUM(size), 0) AS bytes
         FROM ${GALLERY_ITEMS_TABLE}
         WHERE bucket = ? AND workspace_id IN (${placeholders})
         GROUP BY workspace_id`;
    const params = [bucket, ...uniqueIds];
    const readDb = await getReadOnlyDatabase();
    const rows = readDb
        ? await readDb.all(query, params)
        : await db.all(query, params);

    for (const row of rows || []) {
        if (row?.workspace_id) {
            stats.set(row.workspace_id, {
                items: Number(row.items) || 0,
                bytes: Number(row.bytes) || 0
            });
        }
    }

    return stats;
}

async function getGalleryWorkspaceIndexMeta(workspaceId, viewType = 'images') {
    if (!workspaceId || !dbInitialized || !db) {
        return null;
    }

    const query = `SELECT total_items, updated_at FROM ${GALLERY_INDEX_META_TABLE}
         WHERE workspace_id = ? AND view_type = ?`;
    const params = [workspaceId, viewType];
    const readDb = await getReadOnlyDatabase();
    const row = readDb
        ? await readDb.get(query, params)
        : await db.get(query, params);

    if (!row) {
        return null;
    }

    return {
        totalItems: Number(row.total_items) || 0,
        updatedAt: row.updated_at || null
    };
}

async function getGalleryWorkspaceProbeMeta(workspaceId, viewType = 'images') {
    const meta = await getGalleryWorkspaceIndexMeta(workspaceId, viewType);

    let totalItems = meta ? Number(meta.totalItems) || 0 : 0;
    if (!totalItems) {
        totalItems = viewType === 'pinned'
            ? await countGalleryWorkspacePins(workspaceId)
            : await countGalleryWorkspaceItems(workspaceId, viewType);
    }

    return {
        totalItems,
        updatedAt: meta?.updatedAt || null
    };
}

async function collectGalleryOwnershipBaseKeys() {
    const keys = new Set();
    const workspaceIds = new Set();

    if (dbInitialized && db) {
        const rows = await db.all(
            `SELECT workspace_id, bucket, filename FROM ${GALLERY_OWNERSHIP_TABLE}`
        );
        for (const row of rows || []) {
            if (!row.filename || !row.workspace_id) {
                continue;
            }
            const bucket = row.bucket || 'files';
            const ownershipKey = metadataWriteQueue.galleryKey(row.filename, row.workspace_id, bucket);
            if (metadataWriteQueue.isGalleryOwnershipRemoved(ownershipKey)) {
                continue;
            }
            const base = getGalleryBaseName(row.filename);
            if (!base) {
                continue;
            }
            keys.add(`${row.workspace_id}\0${bucket}\0${base}`);
            workspaceIds.add(row.workspace_id);
        }
    }

    for (const [ownershipKey, entry] of metadataWriteQueue.hotGalleryOwnership.entries()) {
        metadataWriteQueue.evictExpiredGalleryOwnership(ownershipKey);
        if (!metadataWriteQueue.hotGalleryOwnership.has(ownershipKey)) {
            continue;
        }
        if (metadataWriteQueue.isGalleryOwnershipRemoved(ownershipKey)) {
            continue;
        }
        const row = entry.row;
        if (!row.filename || !row.workspaceId) {
            continue;
        }
        const bucket = row.bucket || 'files';
        const base = getGalleryBaseName(row.filename);
        if (!base) {
            continue;
        }
        keys.add(`${row.workspaceId}\0${bucket}\0${base}`);
        workspaceIds.add(row.workspaceId);
    }

    return { keys, workspaceIds };
}

async function collectGalleryItemsBaseKeys() {
    const keys = new Set();
    if (!dbInitialized || !db) {
        return keys;
    }

    const rows = await db.all(
        `SELECT workspace_id, bucket, base FROM ${GALLERY_ITEMS_TABLE}`
    );
    for (const row of rows || []) {
        if (!row.workspace_id || !row.bucket || !row.base) {
            continue;
        }
        keys.add(`${row.workspace_id}\0${row.bucket}\0${row.base}`);
    }
    return keys;
}

function parseGalleryOwnershipKey(key) {
    const parts = key.split('\0');
    return {
        filename: parts[0] || '',
        workspaceId: parts[1] || '',
        bucket: parts[2] || 'files'
    };
}

async function syncGalleryWorkspaceItemsForBaseKeys(baseKeys) {
    if (!WRITE_GALLERY_ITEMS || !baseKeys || baseKeys.size === 0) {
        return { rebuilt: 0, workspaces: 0 };
    }

    const workspacesTouched = new Set();
    let rebuilt = 0;

    for (const key of baseKeys) {
        const [workspaceId, bucket, base] = key.split('\0');
        if (!workspaceId || !bucket || !base) {
            continue;
        }
        await rebuildGalleryWorkspaceItem(workspaceId, bucket, base);
        workspacesTouched.add(workspaceId);
        rebuilt += 1;
    }

    for (const workspaceId of workspacesTouched) {
        await refreshGalleryWorkspaceIndexMeta(workspaceId);
    }

    return { rebuilt, workspaces: workspacesTouched.size };
}

/**
 * Incremental drift repair: rebuild only missing/changed bases, delete stale item rows.
 */
async function syncGalleryWorkspaceItemsDrift() {
    if (!WRITE_GALLERY_ITEMS || !dbInitialized || !db) {
        return { reconciled: false };
    }

    const { keys: ownershipKeys } = await collectGalleryOwnershipBaseKeys();
    const itemKeys = await collectGalleryItemsBaseKeys();
    const basesToRebuild = new Set();
    const workspacesTouched = new Set();
    let removed = 0;

    for (const key of ownershipKeys) {
        if (!itemKeys.has(key)) {
            basesToRebuild.add(key);
        }
    }

    for (const key of itemKeys) {
        if (!ownershipKeys.has(key)) {
            const [workspaceId, bucket, base] = key.split('\0');
            await db.run(
                `DELETE FROM ${GALLERY_ITEMS_TABLE} WHERE workspace_id = ? AND bucket = ? AND base = ?`,
                [workspaceId, bucket, base]
            );
            workspacesTouched.add(workspaceId);
            removed += 1;
        }
    }

    if (basesToRebuild.size === 0 && removed === 0) {
        return { reconciled: false };
    }

    let rebuiltCount = 0;
    for (const key of basesToRebuild) {
        const [workspaceId, bucket, base] = key.split('\0');
        await rebuildGalleryWorkspaceItem(workspaceId, bucket, base);
        workspacesTouched.add(workspaceId);
        rebuiltCount += 1;
        if (basesToRebuild.size > 500 && rebuiltCount % 250 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    for (const workspaceId of workspacesTouched) {
        await refreshGalleryWorkspaceIndexMeta(workspaceId);
    }

    return {
        reconciled: true,
        rebuilt: basesToRebuild.size,
        removed
    };
}

/**
 * Rebuild gallery_workspace_items from gallery_workspace_ownership (+ hot pending rows).
 */
async function backfillGalleryWorkspaceItemsFromOwnership(options = {}) {
    if (!WRITE_GALLERY_ITEMS || !dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const truncateFirst = options.truncateFirst === true;
    if (truncateFirst) {
        await db.run(`DELETE FROM ${GALLERY_ITEMS_TABLE}`);
        await db.run(`DELETE FROM ${GALLERY_INDEX_META_TABLE}`);
    }

    const { keys, workspaceIds } = await collectGalleryOwnershipBaseKeys();
    let rebuilt = 0;

    for (const key of keys) {
        const [workspaceId, bucket, base] = key.split('\0');
        await rebuildGalleryWorkspaceItem(workspaceId, bucket, base);
        rebuilt += 1;
        if (keys.size > 500 && rebuilt % 250 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    for (const workspaceId of workspaceIds) {
        await refreshGalleryWorkspaceIndexMeta(workspaceId);
    }

    return { rebuilt, workspaces: workspaceIds.size };
}

async function ensureGalleryWorkspaceItemsFromOwnership() {
    if (!WRITE_GALLERY_ITEMS || !dbInitialized || !db) {
        return { reconciled: false };
    }

    const itemsRow = await db.get(`SELECT COUNT(*) AS count FROM ${GALLERY_ITEMS_TABLE}`);
    const itemsCount = itemsRow?.count || 0;
    const { keys: ownershipBaseKeys } = await collectGalleryOwnershipBaseKeys();

    if (itemsCount === 0) {
        if (ownershipBaseKeys.size === 0) {
            return { reconciled: false };
        }
        const result = await backfillGalleryWorkspaceItemsFromOwnership({ truncateFirst: false });
        console.log(`✓ Gallery workspace items seeded from ownership (${result.rebuilt || 0} paired rows)`);
        return { reconciled: true, seeded: true, rebuilt: result.rebuilt || 0 };
    }

    const drift = await syncGalleryWorkspaceItemsDrift();
    if (drift.reconciled) {
        console.log(`✓ Gallery workspace items drift repaired (rebuilt ${drift.rebuilt || 0}, removed ${drift.removed || 0} stale rows)`);
    }

    await backfillGalleryPinsFromOwnership();
    return drift;
}

/**
 * Incremental upsert for gallery_workspace_ownership (Phase 3).
 * Preserves created_at on conflict — mirrors referenceMetadataDatabase.addReferenceToWorkspace.
 *
 * Call sites (modules/workspace.js):
 * - addToWorkspaceArray, removeFromWorkspaceArray (moveToWorkspaceArray via both)
 * - handlePinnedScrappedFilesOnMove, syncWorkspacePinnedScraps
 * - syncWorkspaceFiles, deleteWorkspace, dumpWorkspace, organizeOrphanedFiles
 * - bulkAddToWorkspaceArray, bulkRemoveFromWorkspaceArray
 * imageGeneration.js / 90-workspaceHandler.js route through workspace manager.
 */
async function upsertGalleryOwnership(filename, workspaceId, bucket = 'files') {
    if (!WRITE_GALLERY_OWNERSHIP || !dbInitialized || !db || !filename || !workspaceId) {
        return false;
    }

    if (bucket === 'pinned') {
        return addGalleryWorkspacePin(workspaceId, filename);
    }

    metadataWriteQueue.stageGalleryOwnership(filename, workspaceId, bucket);
    metadataWriteQueue.enqueue(async () => {
        await db.run(`
            INSERT OR REPLACE INTO gallery_workspace_ownership (filename, workspace_id, bucket, created_at)
            VALUES (?, ?, ?, COALESCE(
                (SELECT created_at FROM gallery_workspace_ownership WHERE filename = ? AND workspace_id = ? AND bucket = ?),
                strftime('%s', 'now')
            ))
        `, [filename, workspaceId, bucket, filename, workspaceId, bucket]);
        await syncGalleryWorkspaceItemOnOwnershipChange(filename, workspaceId, bucket);
    }, `ownership:upsert:${filename}`, {
        onSuccess: () => metadataWriteQueue.markGalleryOwnershipPersisted(filename, workspaceId, bucket)
    });

    return true;
}

/**
 * Remove one gallery ownership row (Phase 3).
 * @returns {boolean} True if a row was deleted
 */
async function removeGalleryOwnership(filename, workspaceId, bucket = 'files') {
    if (!WRITE_GALLERY_OWNERSHIP || !dbInitialized || !db || !filename || !workspaceId) {
        return false;
    }

    if (bucket === 'pinned') {
        return removeGalleryWorkspacePin(workspaceId, filename);
    }

    metadataWriteQueue.removeHotGalleryOwnership(filename, workspaceId, bucket);
    metadataWriteQueue.enqueue(async () => {
        await db.run(
            `DELETE FROM gallery_workspace_ownership WHERE filename = ? AND workspace_id = ? AND bucket = ?`,
            [filename, workspaceId, bucket]
        );
        await syncGalleryWorkspaceItemOnOwnershipChange(filename, workspaceId, bucket);
    }, `ownership:remove:${filename}`, {
        onFailure: () => metadataWriteQueue.unmarkGalleryOwnershipRemoved(filename, workspaceId, bucket)
    });

    return true;
}

/**
 * Resolve workspace ownership for one gallery filename (files bucket preferred).
 * @param {string} filename
 * @returns {Promise<{ workspaceId: string, bucket: string, workspaces: Array<{ workspaceId: string, bucket: string }> }|null>}
 */
async function getGalleryOwnershipForFilename(filename) {
    if (!dbInitialized || !db || !filename) {
        return null;
    }

    const table = USE_WORKSPACE_MEMBERSHIP ? GALLERY_OWNERSHIP_TABLE : 'image_workspace_membership';
    const orderBy = USE_WORKSPACE_MEMBERSHIP
        ? `ORDER BY CASE bucket WHEN 'files' THEN 0 WHEN 'pinned' THEN 1 WHEN 'scraps' THEN 2 ELSE 3 END, created_at ASC`
        : `ORDER BY CASE bucket WHEN 'files' THEN 0 WHEN 'pinned' THEN 1 WHEN 'scraps' THEN 2 ELSE 3 END, workspace_id ASC`;
    const readDb = await getMetadataReadDatabase() || await getReadOnlyDatabase();
    const readHandle = readDb || db;
    const rows = await readHandle.all(
        `SELECT workspace_id, bucket FROM ${table} WHERE filename = ? ${orderBy}`,
        [filename]
    );

    const merged = new Map();
    for (const row of rows || []) {
        const key = metadataWriteQueue.galleryKey(filename, row.workspace_id, row.bucket);
        if (metadataWriteQueue.isGalleryOwnershipRemoved(key)) continue;
        merged.set(key, {
            workspaceId: row.workspace_id,
            bucket: row.bucket || 'files'
        });
    }

    for (const hotRow of metadataWriteQueue.getHotGalleryOwnershipRowsForFile(filename)) {
        const key = metadataWriteQueue.galleryKey(hotRow.filename, hotRow.workspaceId, hotRow.bucket);
        merged.set(key, {
            workspaceId: hotRow.workspaceId,
            bucket: hotRow.bucket || 'files'
        });
    }

    if (merged.size === 0) {
        return null;
    }

    const workspaces = Array.from(merged.values());
    return {
        workspaceId: workspaces[0].workspaceId,
        bucket: workspaces[0].bucket,
        workspaces
    };
}

/**
 * Batch backfill gallery_workspace_ownership from workspace config (CLI only — not boot).
 * @param {Object} workspaces - workspaces config keyed by workspace id
 * @param {Object} [options]
 * @param {boolean} [options.truncateFirst=false] - DELETE all rows before insert (manual full rebuild)
 * @param {number} [options.batchSize=500]
 */
async function backfillGalleryOwnershipFromWorkspaces(workspaces, options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const batchSize = Math.max(50, options.batchSize || 500);
    const truncateFirst = options.truncateFirst === true;

    if (truncateFirst) {
        await db.run(`DELETE FROM ${GALLERY_OWNERSHIP_TABLE}`);
    }

    const rows = [];
    for (const [workspaceId, workspace] of Object.entries(workspaces || {})) {
        for (const filename of workspace.files || []) {
            if (filename) rows.push([filename, workspaceId, 'files']);
        }
        for (const filename of workspace.scraps || []) {
            if (filename) rows.push([filename, workspaceId, 'scraps']);
        }
        for (const filename of workspace.pinned || []) {
            if (filename) rows.push([filename, workspaceId, 'pinned']);
        }
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        for (const [filename, workspaceId, bucket] of batch) {
            await db.run(`
                INSERT OR REPLACE INTO gallery_workspace_ownership (filename, workspace_id, bucket, created_at)
                VALUES (?, ?, ?, COALESCE(
                    (SELECT created_at FROM gallery_workspace_ownership WHERE filename = ? AND workspace_id = ? AND bucket = ?),
                    strftime('%s', 'now')
                ))
            `, [filename, workspaceId, bucket, filename, workspaceId, bucket]);
            upserted += 1;
        }
    }

    return { upserted, totalRows: rows.length };
}

/**
 * Build filename scope SQL for search queries (workspace ownership subquery or IN list).
 */
function buildFilenameScopeClause(workspaceScope, filenamesFilter) {
    if (filenamesFilter && filenamesFilter.length > 0) {
        const placeholders = filenamesFilter.map(() => '?').join(',');
        return {
            clause: ` AND filename IN (${placeholders})`,
            params: [...filenamesFilter]
        };
    }
    if (workspaceScope && workspaceScope.workspaceIds && workspaceScope.workspaceIds.length > 0) {
        const scope = buildWorkspaceOwnershipScopeSql(workspaceScope);
        return {
            clause: ` AND ${scope.sql}`,
            params: scope.params
        };
    }
    return { clause: '', params: [] };
}

/**
 * Update search indexes for a filename based on its metadata
 */
async function updateSearchIndexes(filename, metadata) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    // Check if indexing is paused - skip index creation if paused
    if (indexingPaused) {
        return; // Silently skip when paused
    }

    try {
        // Delete existing search indexes for this filename
        await db.run('DELETE FROM search_tags WHERE filename = ?', [filename]);
        await db.run('DELETE FROM search_fulltext WHERE filename = ?', [filename]);
        await db.run('DELETE FROM search_characters WHERE filename = ?', [filename]);
        await db.run('DELETE FROM search_presets WHERE filename = ?', [filename]);
        await db.run('DELETE FROM search_models WHERE filename = ?', [filename]);
        if (WRITE_PROMPT_BLOBS) {
            await db.run('DELETE FROM image_prompt_text WHERE filename = ?', [filename]);
        }
        if (WRITE_PROMPT_FTS) {
            await deletePromptFtsForFile(filename);
        }

        if (!metadata || !metadata.metadata) {
            return; // No metadata to index
        }

        const pngMeta = sanitizePngMetaForIndexing(metadata.metadata);
        const { searchModelNames, presetName } = extractSearchModelAndPresetFromPngMeta(pngMeta);
        const fileTags = [];
        const fileFullText = [];

        // Extract tags and full text from main prompt (compiled/final)
        if (pngMeta.prompt) {
            const promptData = extractTagsFromText(pngMeta.prompt);
            fileTags.push(...promptData.tags.map(t => ({ ...t, source: 'prompt' })));
            fileFullText.push(...promptData.fullTextEntries.map(t => ({ ...t, source: 'prompt' })));
        }

        // Index user input prompt (pre server post-processing) when stored in forge_data
        if (pngMeta.forge_data && pngMeta.forge_data.input_prompt) {
            const inputData = extractTagsFromText(pngMeta.forge_data.input_prompt);
            fileTags.push(...inputData.tags.map(t => ({ ...t, source: 'input_prompt' })));
            fileFullText.push(...inputData.fullTextEntries.map(t => ({ ...t, source: 'input_prompt' })));
        }

        // Extract tags and full text from character prompts
        if (pngMeta.forge_data) {
            const forgeData = pngMeta.forge_data;

            if (forgeData.disabledCharacters && Array.isArray(forgeData.disabledCharacters)) {
                for (const charPrompt of forgeData.disabledCharacters) {
                    if (charPrompt.prompt) {
                        const charData = extractTagsFromText(charPrompt.prompt);
                        fileTags.push(...charData.tags.map(t => ({ ...t, source: 'character_prompt', character: charPrompt.chara_name })));
                        fileFullText.push(...charData.fullTextEntries.map(t => ({ ...t, source: 'character_prompt', character: charPrompt.chara_name })));
                    }
                }
            }
        }

        // Extract tags and full text from v4 prompts
        if (pngMeta.v4_prompt && pngMeta.v4_prompt.caption && pngMeta.v4_prompt.caption.char_captions) {
            for (const caption of pngMeta.v4_prompt.caption.char_captions) {
                if (caption.char_caption) {
                    const v4Data = extractTagsFromText(caption.char_caption);
                    fileTags.push(...v4Data.tags.map(t => ({ ...t, source: 'v4_character_caption', character: 'v4_character' })));
                    fileFullText.push(...v4Data.fullTextEntries.map(t => ({ ...t, source: 'v4_character_caption', character: 'v4_character' })));
                }
            }
        }

        // Insert tags
        for (const tagData of fileTags) {
            await db.run(`
                INSERT INTO search_tags (filename, tag, original_tag, weight, tag_type, source, character)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                filename,
                tagData.tag,
                tagData.originalTag,
                tagData.weight || 0,
                tagData.type || 'normal',
                tagData.source || 'prompt',
                tagData.character || null
            ]);
        }

        // Insert full text entries
        for (const textData of fileFullText) {
            await db.run(`
                INSERT INTO search_fulltext (filename, text_content, original_text, weight, text_type, source, character)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                filename,
                textData.text,
                textData.originalText,
                textData.weight || 0,
                textData.type || 'full_text',
                textData.source || 'prompt',
                textData.character || null
            ]);
        }

        // Index preset names (forge_data.preset_name is canonical in this corpus)
        if (presetName) {
            await db.run(`
                INSERT INTO search_presets (filename, preset_name)
                VALUES (?, ?)
            `, [filename, presetName]);
        }

        // Index character names
        if (pngMeta.forge_data && pngMeta.forge_data.characterNames && Array.isArray(pngMeta.forge_data.characterNames)) {
            for (const charName of pngMeta.forge_data.characterNames) {
                if (charName && charName.trim()) {
                    await db.run(`
                        INSERT INTO search_characters (filename, character_name)
                        VALUES (?, ?)
                    `, [filename, charName.trim()]);
                }
            }
        }

        // Index model names (source string + filter slug + API alias)
        for (const modelName of searchModelNames) {
            await db.run(`
                INSERT INTO search_models (filename, model_name)
                VALUES (?, ?)
            `, [filename, modelName]);
        }

        if (WRITE_SEARCH_FACETS) {
            const facets = extractSearchFacetsFromMetadata(pngMeta, {
                id: metadata.id,
                width: metadata.width,
                height: metadata.height,
                parent: metadata.parent,
                upscaled: metadata.upscaled,
                mtime: metadata.mtime
            });
            if (facets) {
                facets.model_extract_attempted = 1;
                await upsertSearchFacets(filename, facets);
            }
        }

        if (WRITE_PROMPT_BLOBS) {
            await upsertPromptBlobs(filename, pngMeta);
        }

        if (WRITE_PROMPT_FTS) {
            await upsertPromptFts(filename, pngMeta);
        }

        await markInputPromptTagsExtractAttempted(filename);

        if (WRITE_SEED_CHAIN_INDEX) {
            await updateSeedChainForFilename(filename);
        }

        await db.run('UPDATE images SET search_indexes_ready = 1 WHERE filename = ?', [filename]);

    } catch (error) {
        logger.error(`Error updating search indexes for ${filename}:`, error);
        // Don't throw - search index errors shouldn't break metadata saving
    }
}

/**
 * Query search indexes for matching filenames (legacy comma-string API).
 */
async function searchFilesInDatabase(query, filenamesFilter = null, viewType = 'images', options = {}) {
    const blocks = Array.isArray(query)
        ? query
        : omegasearchFilters.normalizeSearchBlocks(String(query || ''), options.blockOptions || {});
    return searchFilesWithBlocks(blocks, filenamesFilter, viewType, options);
}

function parseSearchBlockSegment(segment) {
    return omegasearchFilters.normalizeSearchBlocks(segment)[0] || null;
}

function normalizeSearchBlocks(blocks, options = {}) {
    return omegasearchFilters.normalizeSearchBlocks(blocks, options);
}

function flattenSearchBlockTerms(blocks) {
    const normalized = normalizeSearchBlocks(blocks);
    const terms = [];
    const seen = new Set();
    for (const block of normalized) {
        for (const term of block.terms || []) {
            if (!term || seen.has(term)) continue;
            seen.add(term);
            terms.push(term);
        }
    }
    return terms;
}

function getPromptSourceFilter(options = {}) {
    const promptSource = options.promptSource || options.filters?.promptSource || 'compiled';
    if (promptSource === 'input') {
        return ['input_prompt'];
    }
    return ['prompt', 'character_prompt', 'v4_character_caption'];
}

async function findFilesMatchingSearchTerm(searchTerm, filenameFilterClause, filenameParams, dbConn, searchOptions = {}) {
    const termFiles = new Set();
    const matchMode = searchOptions.matchMode || 'substring';
    const promptSources = getPromptSourceFilter(searchOptions);
    const sourcePlaceholders = promptSources.map(() => '?').join(',');
    const sourceClause = ` AND source IN (${sourcePlaceholders})`;
    const sourceParams = promptSources;
    const includeAuxIndexes = searchOptions.promptSource !== 'input'
        && searchOptions.filters?.promptSource !== 'input';

    const tagMatch = matchMode === 'word'
        ? omegasearchFilters.buildTermMatchSql('tag', searchTerm, 'word')
        : omegasearchFilters.buildTermMatchSql('tag', searchTerm, matchMode);
    const tagMatches = await dbConn.all(`
        SELECT DISTINCT filename FROM search_tags
        WHERE ${tagMatch.clause}${sourceClause}${filenameFilterClause}
    `, [...tagMatch.params, ...sourceParams, ...filenameParams]);
    tagMatches.forEach((row) => termFiles.add(row.filename));

    if (usesFtsPromptSearch(matchMode)) {
        const ftsTable = getPromptFtsTableForSearch(searchOptions);
        const ftsQuery = buildFts5WordQuery(searchTerm);
        if (ftsQuery) {
            try {
                const ftsMatches = await dbConn.all(`
                    SELECT DISTINCT filename FROM ${ftsTable}
                    WHERE ${ftsTable} MATCH ?${filenameFilterClause}
                `, [ftsQuery, ...filenameParams]);
                ftsMatches.forEach((row) => termFiles.add(row.filename));
            } catch (ftsError) {
                logger.warn(`FTS prompt search failed for term "${searchTerm}":`, ftsError.message);
            }
        }
    } else if (usesPromptBlobSearch(matchMode)) {
        const blobLanes = getPromptBlobLanesForSearch(searchOptions);
        const lanePlaceholders = blobLanes.map(() => '?').join(',');
        const blobMatch = omegasearchFilters.buildTermMatchSql('text_norm', searchTerm, matchMode);
        const blobMatches = await dbConn.all(`
            SELECT DISTINCT filename FROM image_prompt_text
            WHERE ${blobMatch.clause} AND lane IN (${lanePlaceholders})${filenameFilterClause}
        `, [...blobMatch.params, ...blobLanes, ...filenameParams]);
        blobMatches.forEach((row) => termFiles.add(row.filename));
    } else {
        const textMatch = matchMode === 'word'
            ? omegasearchFilters.buildFullTextWordMatchSql('text_content', searchTerm)
            : omegasearchFilters.buildTermMatchSql('text_content', searchTerm, matchMode);
        const fullTextMatches = await dbConn.all(`
            SELECT DISTINCT filename FROM search_fulltext
            WHERE ${textMatch.clause}${sourceClause}${filenameFilterClause}
        `, [...textMatch.params, ...sourceParams, ...filenameParams]);
        fullTextMatches.forEach((row) => termFiles.add(row.filename));
    }

    if (includeAuxIndexes) {
        const charMatch = omegasearchFilters.buildTermMatchSql('character_name', searchTerm, matchMode);
        const characterMatches = await dbConn.all(`
            SELECT DISTINCT filename FROM search_characters
            WHERE ${charMatch.clause}${filenameFilterClause}
        `, [...charMatch.params, ...filenameParams]);
        characterMatches.forEach((row) => termFiles.add(row.filename));

        const presetMatch = omegasearchFilters.buildTermMatchSql('preset_name', searchTerm, matchMode);
        const presetMatches = await dbConn.all(`
            SELECT DISTINCT filename FROM search_presets
            WHERE ${presetMatch.clause}${filenameFilterClause}
        `, [...presetMatch.params, ...filenameParams]);
        presetMatches.forEach((row) => termFiles.add(row.filename));

        const modelMatch = omegasearchFilters.buildTermMatchSql('model_name', searchTerm, matchMode);
        const modelMatches = await dbConn.all(`
            SELECT DISTINCT filename FROM search_models
            WHERE ${modelMatch.clause}${filenameFilterClause}
        `, [...modelMatch.params, ...filenameParams]);
        modelMatches.forEach((row) => termFiles.add(row.filename));
    }

    return termFiles;
}

async function applyOmegasearchMetadataFiltersViaFacets(filenamesFilter, filters, workspaceScope = null) {
    const clauses = [];
    const params = [];

    if (workspaceScope && workspaceScope.workspaceIds && workspaceScope.workspaceIds.length > 0) {
        const scope = buildWorkspaceOwnershipScopeSql(workspaceScope);
        clauses.push(`f.${scope.sql}`);
        params.push(...scope.params);
    } else if (filenamesFilter && filenamesFilter.length > 0) {
        const placeholders = filenamesFilter.map(() => '?').join(',');
        clauses.push(`f.filename IN (${placeholders})`);
        params.push(...filenamesFilter);
    }

    const beforeTs = omegasearchFilters.resolveDateBoundary(filters.dateBefore);
    if (beforeTs != null) {
        clauses.push('f.mtime <= ?');
        params.push(Math.floor(beforeTs / 1000));
    }

    const afterTs = omegasearchFilters.resolveDateBoundary(filters.dateAfter);
    if (afterTs != null) {
        clauses.push('f.mtime >= ?');
        params.push(Math.floor(afterTs / 1000));
    }

    if (filters.dateRange) {
        const startTs = omegasearchFilters.parseAbsoluteTimestamp(filters.dateRange.start);
        const endTs = omegasearchFilters.parseAbsoluteTimestamp(filters.dateRange.end);
        if (startTs != null) {
            clauses.push('f.mtime >= ?');
            params.push(Math.floor(startTs / 1000));
        }
        if (endTs != null) {
            clauses.push('f.mtime <= ?');
            params.push(Math.floor(endTs / 1000));
        }
    }

    if (filters.isUpscaled === true) {
        clauses.push('f.upscaled = 1');
    } else if (filters.isUpscaled === false) {
        clauses.push('f.upscaled = 0');
    }

    if (filters.stepsMin != null) {
        clauses.push('f.steps >= ?');
        params.push(filters.stepsMin);
    }
    if (filters.stepsMax != null) {
        clauses.push('f.steps <= ?');
        params.push(filters.stepsMax);
    }

    if (filters.guidanceMin != null) {
        clauses.push('f.guidance >= ?');
        params.push(filters.guidanceMin);
    }
    if (filters.guidanceMax != null) {
        clauses.push('f.guidance <= ?');
        params.push(filters.guidanceMax);
    }

    if (filters.rescaleMin != null) {
        clauses.push('f.rescale >= ?');
        params.push(filters.rescaleMin);
    }
    if (filters.rescaleMax != null) {
        clauses.push('f.rescale <= ?');
        params.push(filters.rescaleMax);
    }

    if (filters.sampler) {
        clauses.push('f.sampler_norm = LOWER(?)');
        params.push(filters.sampler);
    }
    if (filters.scheduler) {
        clauses.push('f.scheduler_norm = LOWER(?)');
        params.push(filters.scheduler);
    }

    if (filters.qualityPreset === true) {
        clauses.push('f.quality_preset = 1');
    } else if (filters.qualityPreset === false) {
        clauses.push('(f.quality_preset = 0 OR f.quality_preset IS NULL)');
    }

    if (filters.ucLevel != null) {
        clauses.push('f.uc_level = ?');
        params.push(filters.ucLevel);
    }

    if (filters.nsfwLevel != null) {
        clauses.push('f.nsfw_level = ?');
        params.push(filters.nsfwLevel);
    }

    if (filters.hasDynamicReplacements === true) {
        clauses.push('f.has_dynamic_replacements = 1');
    } else if (filters.hasDynamicReplacements === false) {
        clauses.push('f.has_dynamic_replacements = 0');
    }

    if (filters.models && filters.models.length > 0) {
        const modelNormSlugs = omegasearchFilters.resolveModelNormSlugs(filters.models);
        if (modelNormSlugs.length === 0) {
            return [];
        }
        const modelPlaceholders = modelNormSlugs.map(() => '?').join(',');
        clauses.push(`f.model_norm IN (${modelPlaceholders})`);
        params.push(...modelNormSlugs);
    }

    if (filters.resolutionPreset && filters.resolutionPreset.length > 0) {
        const tierPlaceholders = filters.resolutionPreset.map(() => '?').join(',');
        clauses.push(`f.resolution_tier IN (${tierPlaceholders})`);
        params.push(...filters.resolutionPreset);
    }

    let rows = await db.all(
        `SELECT f.filename, f.width, f.height FROM image_search_facets f WHERE ${clauses.length ? clauses.join(' AND ') : '1=1'}`,
        params
    );

    if (filters.consecutiveSeeds) {
        if (USE_SEED_CHAIN_INDEX) {
            clauses.push('f.consecutive_seed_group_id IS NOT NULL');
        } else {
            const chainRows = await filterOmegasearchConsecutiveSeeds(rows.map((row) => row.filename));
            const allowed = new Set(chainRows.map((row) => row.filename));
            rows = rows.filter((row) => allowed.has(row.filename));
        }
    }

    return rows.map((row) => row.filename);
}

async function applyOmegasearchMetadataFilters(filenamesFilter, filters, workspaceScope = null) {
    if (!filters || !omegasearchFilters.hasActiveMetadataFilters(filters)) {
        if (workspaceScope && workspaceScope.workspaceIds && workspaceScope.workspaceIds.length > 0) {
            const scope = buildFilenameScopeClause(workspaceScope, null);
            const rows = await db.all(
                `SELECT DISTINCT filename FROM images WHERE 1=1${scope.clause}`,
                scope.params
            );
            return rows.map((row) => row.filename);
        }
        if (filenamesFilter && filenamesFilter.length) {
            return [...new Set(filenamesFilter)];
        }
        return null;
    }

    if (USE_FACET_FILTERS) {
        return applyOmegasearchMetadataFiltersViaFacets(filenamesFilter, filters, workspaceScope);
    }

    const clauses = [];
    const params = [];

    if (workspaceScope && workspaceScope.workspaceIds && workspaceScope.workspaceIds.length > 0) {
        const scope = buildWorkspaceOwnershipScopeSql(workspaceScope);
        clauses.push(scope.sql);
        params.push(...scope.params);
    } else if (filenamesFilter && filenamesFilter.length > 0) {
        const placeholders = filenamesFilter.map(() => '?').join(',');
        clauses.push(`filename IN (${placeholders})`);
        params.push(...filenamesFilter);
    }

    const beforeTs = omegasearchFilters.resolveDateBoundary(filters.dateBefore);
    if (beforeTs != null) {
        clauses.push('mtime <= ?');
        params.push(Math.floor(beforeTs / 1000));
    }

    const afterTs = omegasearchFilters.resolveDateBoundary(filters.dateAfter);
    if (afterTs != null) {
        clauses.push('mtime >= ?');
        params.push(Math.floor(afterTs / 1000));
    }

    if (filters.dateRange) {
        const startTs = omegasearchFilters.parseAbsoluteTimestamp(filters.dateRange.start);
        const endTs = omegasearchFilters.parseAbsoluteTimestamp(filters.dateRange.end);
        if (startTs != null) {
            clauses.push('mtime >= ?');
            params.push(Math.floor(startTs / 1000));
        }
        if (endTs != null) {
            clauses.push('mtime <= ?');
            params.push(Math.floor(endTs / 1000));
        }
    }

    if (filters.isUpscaled === true) {
        clauses.push('upscaled = 1');
    } else if (filters.isUpscaled === false) {
        clauses.push('upscaled = 0');
    }

    if (filters.stepsMin != null) {
        clauses.push(`CAST(json_extract(metadata, '$.steps') AS INTEGER) >= ?`);
        params.push(filters.stepsMin);
    }
    if (filters.stepsMax != null) {
        clauses.push(`CAST(json_extract(metadata, '$.steps') AS INTEGER) <= ?`);
        params.push(filters.stepsMax);
    }

    if (filters.guidanceMin != null) {
        clauses.push(`CAST(json_extract(metadata, '$.scale') AS REAL) >= ?`);
        params.push(filters.guidanceMin);
    }
    if (filters.guidanceMax != null) {
        clauses.push(`CAST(json_extract(metadata, '$.scale') AS REAL) <= ?`);
        params.push(filters.guidanceMax);
    }

    if (filters.rescaleMin != null) {
        clauses.push(`CAST(json_extract(metadata, '$.cfg_rescale') AS REAL) >= ?`);
        params.push(filters.rescaleMin);
    }
    if (filters.rescaleMax != null) {
        clauses.push(`CAST(json_extract(metadata, '$.cfg_rescale') AS REAL) <= ?`);
        params.push(filters.rescaleMax);
    }

    if (filters.sampler) {
        clauses.push(`LOWER(json_extract(metadata, '$.sampler')) = LOWER(?)`);
        params.push(filters.sampler);
    }
    if (filters.scheduler) {
        clauses.push(`LOWER(json_extract(metadata, '$.noise_schedule')) = LOWER(?)`);
        params.push(filters.scheduler);
    }

    if (filters.qualityPreset === true) {
        clauses.push(`(
            json_extract(metadata, '$.forge_data.append_quality') IN (1, 'true', '1')
            OR CAST(json_extract(metadata, '$.forge_data.append_quality') AS INTEGER) = 1
        )`);
    } else if (filters.qualityPreset === false) {
        clauses.push(`(
            json_extract(metadata, '$.forge_data.append_quality') IS NULL
            OR json_extract(metadata, '$.forge_data.append_quality') IN (0, 'false', '0', '')
            OR CAST(json_extract(metadata, '$.forge_data.append_quality') AS INTEGER) = 0
        )`);
    }

    if (filters.ucLevel != null) {
        clauses.push(`CAST(json_extract(metadata, '$.forge_data.append_uc') AS INTEGER) = ?`);
        params.push(filters.ucLevel);
    }

    if (filters.nsfwLevel != null) {
        clauses.push(`CAST(json_extract(metadata, '$.forge_data.dataset_config') AS TEXT) LIKE ?`);
        params.push(`%"nsfw":${filters.nsfwLevel}%`);
    }

    if (filters.hasDynamicReplacements === true) {
        clauses.push(`(
            (
                json_type(json_extract(metadata, '$.forge_data.text_replacements')) IN ('array', 'object')
                AND length(COALESCE(json_extract(metadata, '$.forge_data.text_replacements'), '')) > 2
            )
            OR (
                json_type(json_extract(metadata, '$.forge_data.text_replacements_seed')) = 'array'
                AND json_array_length(json_extract(metadata, '$.forge_data.text_replacements_seed')) > 0
            )
            OR (
                json_type(json_extract(metadata, '$.forge_data.dynamic_generation')) = 'object'
                AND json_extract(metadata, '$.forge_data.dynamic_generation') LIKE '%text_replacements%'
            )
        )`);
    } else if (filters.hasDynamicReplacements === false) {
        clauses.push(`NOT (
            (
                json_type(json_extract(metadata, '$.forge_data.text_replacements')) IN ('array', 'object')
                AND length(COALESCE(json_extract(metadata, '$.forge_data.text_replacements'), '')) > 2
            )
            OR (
                json_type(json_extract(metadata, '$.forge_data.text_replacements_seed')) = 'array'
                AND json_array_length(json_extract(metadata, '$.forge_data.text_replacements_seed')) > 0
            )
            OR (
                json_type(json_extract(metadata, '$.forge_data.dynamic_generation')) = 'object'
                AND json_extract(metadata, '$.forge_data.dynamic_generation') LIKE '%text_replacements%'
            )
        )`);
    }

    let rows = await db.all(
        `SELECT filename, width, height FROM images WHERE ${clauses.length ? clauses.join(' AND ') : '1=1'}`,
        params
    );

    if (filters.models && filters.models.length > 0) {
        const modelPlaceholders = filters.models.map(() => '?').join(',');
        const modelParams = filters.models.map((model) => String(model).toLowerCase());
        const modelRows = await db.all(`
            SELECT DISTINCT sm.filename
            FROM search_models sm
            WHERE LOWER(sm.model_name) IN (${modelPlaceholders})
            ${rows.length ? `AND sm.filename IN (${rows.map(() => '?').join(',')})` : ''}
        `, [...modelParams, ...rows.map((row) => row.filename)]);
        const allowed = new Set(modelRows.map((row) => row.filename));
        rows = rows.filter((row) => allowed.has(row.filename));
    }

    if (filters.resolutionPreset && filters.resolutionPreset.length > 0) {
        const allowedTiers = new Set(filters.resolutionPreset);
        rows = rows.filter((row) => {
            const tier = omegasearchFilters.getResolutionTier(row.width, row.height);
            return tier && allowedTiers.has(tier);
        });
    }

    if (filters.consecutiveSeeds) {
        if (USE_SEED_CHAIN_INDEX) {
            const scopedFilenames = rows.map((row) => row.filename);
            if (scopedFilenames.length === 0) {
                return [];
            }
            const placeholders = scopedFilenames.map(() => '?').join(',');
            const chainRows = await db.all(`
                SELECT filename FROM image_search_facets
                WHERE consecutive_seed_group_id IS NOT NULL
                  AND filename IN (${placeholders})
            `, scopedFilenames);
            const allowed = new Set(chainRows.map((row) => row.filename));
            rows = rows.filter((row) => allowed.has(row.filename));
        } else {
            const chainRows = await filterOmegasearchConsecutiveSeeds(rows.map((row) => row.filename));
            const allowed = new Set(chainRows.map((row) => row.filename));
            rows = rows.filter((row) => allowed.has(row.filename));
        }
    }

    return rows.map((row) => row.filename);
}

async function filterOmegasearchConsecutiveSeeds(filenames, scoredRows = null) {
    if (!filenames || filenames.length === 0) {
        return scoredRows || [];
    }

    const placeholders = filenames.map(() => '?').join(',');
    const rows = await db.all(`
        SELECT filename, mtime, json_extract(metadata, '$.seed') AS seed
        FROM images
        WHERE filename IN (${placeholders})
          AND json_extract(metadata, '$.seed') IS NOT NULL
        ORDER BY mtime ASC, filename ASC
    `, filenames);

    const chainFilenames = new Set();
    let run = [];

    const flushRun = () => {
        if (run.length >= 2) {
            run.forEach((entry) => chainFilenames.add(entry.filename));
        }
        run = [];
    };

    for (const row of rows) {
        const seed = row.seed != null ? String(row.seed) : null;
        if (!seed) {
            flushRun();
            continue;
        }
        const prev = run[run.length - 1];
        if (prev && prev.seed === seed && row.mtime - prev.mtime <= 86400) {
            run.push({ filename: row.filename, seed, mtime: row.mtime });
        } else {
            flushRun();
            run = [{ filename: row.filename, seed, mtime: row.mtime }];
        }
    }
    flushRun();

    if (scoredRows) {
        return scoredRows.filter((row) => chainFilenames.has(row.filename));
    }
    return [...chainFilenames].map((filename) => ({ filename }));
}

function extractFullPromptFromUsageMetadata(cached, usage) {
    const metadata = cached?.metadata || {};
    const source = usage.source || 'prompt';
    const charName = usage.character;

    if (source === 'input_prompt') {
        return metadata.forge_data?.input_prompt || usage.displayText || '';
    }

    if (source === 'character_prompt' && charName) {
        const chars = metadata.forge_data?.disabledCharacters || [];
        const match = chars.find((c) => c.chara_name === charName) || chars[0];
        return match?.prompt || usage.displayText || '';
    }

    if (source === 'v4_character_caption') {
        const captions = metadata.v4_prompt?.caption?.char_captions || [];
        const match = captions.find((c) => c.char_caption) || captions[0];
        return match?.char_caption || usage.displayText || '';
    }

    return metadata.prompt || usage.displayText || '';
}

async function scoreMatchingFilesAggregated(matchingFiles, normalizedBlocks, options = {}) {
    const filenames = [...matchingFiles.keys()];
    if (!filenames.length) return;

    const chunkSize = 400;
    const promptSources = getPromptSourceFilter(options);
    const sourcePlaceholders = promptSources.map(() => '?').join(',');
    const sourceClause = ` AND source IN (${sourcePlaceholders})`;
    const sourceParams = promptSources;
    const includeAuxIndexes = options.promptSource !== 'input' && options.filters?.promptSource !== 'input';

    for (const block of normalizedBlocks) {
        const matchMode = block.matchMode || 'substring';
        for (const searchTerm of block.terms || []) {
            const tagMatch = matchMode === 'word'
                ? omegasearchFilters.buildTermMatchSql('tag', searchTerm, 'word')
                : omegasearchFilters.buildTermMatchSql('tag', searchTerm, matchMode);

            for (let chunkStart = 0; chunkStart < filenames.length; chunkStart += chunkSize) {
                const chunk = filenames.slice(chunkStart, chunkStart + chunkSize);
                const filePlaceholders = chunk.map(() => '?').join(',');

                const tagRows = await db.all(`
                    SELECT filename, SUM(ABS(weight)) AS totalWeight, COUNT(*) AS count
                    FROM search_tags
                    WHERE filename IN (${filePlaceholders})
                      AND ${tagMatch.clause}${sourceClause}
                    GROUP BY filename
                `, [...chunk, ...tagMatch.params, ...sourceParams]);
                for (const row of tagRows) {
                    const fileResult = matchingFiles.get(row.filename);
                    if (fileResult && row.totalWeight) {
                        fileResult.matchScore += Math.abs(row.totalWeight) * 10 + (row.count * 2);
                    }
                }

                if (usesFtsPromptSearch(matchMode)) {
                    const ftsTable = getPromptFtsTableForSearch(options);
                    const ftsQuery = buildFts5WordQuery(searchTerm);
                    if (ftsQuery) {
                        try {
                            const ftsRows = await db.all(`
                                SELECT filename, COUNT(*) AS count
                                FROM ${ftsTable}
                                WHERE ${ftsTable} MATCH ?
                                  AND filename IN (${filePlaceholders})
                                GROUP BY filename
                            `, [ftsQuery, ...chunk]);
                            for (const row of ftsRows) {
                                const fileResult = matchingFiles.get(row.filename);
                                if (fileResult && row.count > 0) {
                                    fileResult.matchScore += 8 * row.count;
                                }
                            }
                        } catch (ftsError) {
                            logger.warn(`Aggregated FTS scoring failed for "${searchTerm}":`, ftsError.message);
                        }
                    }
                } else if (usesPromptBlobSearch(matchMode)) {
                    const blobLanes = getPromptBlobLanesForSearch(options);
                    const lanePlaceholders = blobLanes.map(() => '?').join(',');
                    const blobMatch = omegasearchFilters.buildTermMatchSql('text_norm', searchTerm, matchMode);
                    const blobRows = await db.all(`
                        SELECT filename, COUNT(*) AS count
                        FROM image_prompt_text
                        WHERE filename IN (${filePlaceholders})
                          AND ${blobMatch.clause}
                          AND lane IN (${lanePlaceholders})
                        GROUP BY filename
                    `, [...chunk, ...blobMatch.params, ...blobLanes]);
                    for (const row of blobRows) {
                        const fileResult = matchingFiles.get(row.filename);
                        if (fileResult && row.count > 0) {
                            fileResult.matchScore += 8 * row.count;
                        }
                    }
                } else {
                    const textMatch = matchMode === 'word'
                        ? omegasearchFilters.buildFullTextWordMatchSql('text_content', searchTerm)
                        : omegasearchFilters.buildTermMatchSql('text_content', searchTerm, matchMode);
                    const fullTextRows = await db.all(`
                        SELECT filename, SUM(ABS(weight)) AS totalWeight, COUNT(*) AS count
                        FROM search_fulltext
                        WHERE filename IN (${filePlaceholders})
                          AND ${textMatch.clause}${sourceClause}
                        GROUP BY filename
                    `, [...chunk, ...textMatch.params, ...sourceParams]);
                    for (const row of fullTextRows) {
                        const fileResult = matchingFiles.get(row.filename);
                        if (fileResult && row.totalWeight) {
                            fileResult.matchScore += Math.abs(row.totalWeight) * 8 + (row.count * 2);
                        }
                    }
                }

                if (includeAuxIndexes) {
                    const charMatch = omegasearchFilters.buildTermMatchSql('character_name', searchTerm, matchMode);
                    const characterRows = await db.all(`
                        SELECT filename, COUNT(*) AS count
                        FROM search_characters
                        WHERE filename IN (${filePlaceholders})
                          AND ${charMatch.clause}
                        GROUP BY filename
                    `, [...chunk, ...charMatch.params]);
                    for (const row of characterRows) {
                        const fileResult = matchingFiles.get(row.filename);
                        if (fileResult && row.count > 0) {
                            fileResult.matchScore += 15 * row.count;
                        }
                    }

                    const presetMatch = omegasearchFilters.buildTermMatchSql('preset_name', searchTerm, matchMode);
                    const presetRows = await db.all(`
                        SELECT filename, COUNT(*) AS count
                        FROM search_presets
                        WHERE filename IN (${filePlaceholders})
                          AND ${presetMatch.clause}
                        GROUP BY filename
                    `, [...chunk, ...presetMatch.params]);
                    for (const row of presetRows) {
                        const fileResult = matchingFiles.get(row.filename);
                        if (fileResult && row.count > 0) {
                            fileResult.matchScore += 7 * row.count;
                        }
                    }

                    const modelMatch = omegasearchFilters.buildTermMatchSql('model_name', searchTerm, matchMode);
                    const modelRows = await db.all(`
                        SELECT filename, COUNT(*) AS count
                        FROM search_models
                        WHERE filename IN (${filePlaceholders})
                          AND ${modelMatch.clause}
                        GROUP BY filename
                    `, [...chunk, ...modelMatch.params]);
                    for (const row of modelRows) {
                        const fileResult = matchingFiles.get(row.filename);
                        if (fileResult && row.count > 0) {
                            fileResult.matchScore += 5 * row.count;
                        }
                    }
                }
            }

            for (const fileResult of matchingFiles.values()) {
                fileResult.matchScore += 5;
            }
        }
    }
}

async function searchFilesWithBlocks(blocks, filenamesFilter = null, viewType = 'images', options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const normalizedBlocks = normalizeSearchBlocks(blocks, options.blockOptions || {});
    if (normalizedBlocks.length === 0) {
        return [];
    }

    let candidateFiles = null;
    if (!options.workspaceScope) {
        candidateFiles = filenamesFilter && filenamesFilter.length > 0
            ? [...new Set(filenamesFilter)]
            : null;
    }

    if (omegasearchFilters.hasActiveMetadataFilters(options.filters)) {
        candidateFiles = await applyOmegasearchMetadataFilters(
            candidateFiles,
            options.filters,
            options.workspaceScope || null
        );
        if (Array.isArray(candidateFiles) && candidateFiles.length === 0) {
            return [];
        }
    }

    const filenameScope = buildFilenameScopeClause(options.workspaceScope || null, candidateFiles);
    let filenameFilterClause = filenameScope.clause;
    let filenameParams = filenameScope.params;

    const matchingFiles = new Map();

    for (let blockIndex = 0; blockIndex < normalizedBlocks.length; blockIndex += 1) {
        const block = normalizedBlocks[blockIndex];
        const blockFiles = new Set();
        const blockMode = block.mode || (block.orWithinBlock ? 'or' : 'and');
        const termSearchOptions = {
            matchMode: block.matchMode || 'substring',
            promptSource: options.promptSource,
            filters: options.filters
        };

        for (const searchTerm of block.terms || []) {
            const termFiles = await findFilesMatchingSearchTerm(
                searchTerm,
                filenameFilterClause,
                filenameParams,
                db,
                termSearchOptions
            );
            if (blockMode === 'or') {
                termFiles.forEach((filename) => blockFiles.add(filename));
            } else if (blockFiles.size === 0) {
                termFiles.forEach((filename) => blockFiles.add(filename));
            } else {
                for (const filename of blockFiles) {
                    if (!termFiles.has(filename)) blockFiles.delete(filename);
                }
            }
        }

        if (blockIndex === 0) {
            blockFiles.forEach((filename) => {
                matchingFiles.set(filename, { filename, matchScore: 0 });
            });
        } else {
            const currentMatchingFiles = new Set(matchingFiles.keys());
            for (const filename of currentMatchingFiles) {
                if (!blockFiles.has(filename)) {
                    matchingFiles.delete(filename);
                }
            }
        }
    }

    const promptSources = getPromptSourceFilter(options);
    const sourcePlaceholders = promptSources.map(() => '?').join(',');
    const sourceClause = ` AND source IN (${sourcePlaceholders})`;
    const sourceParams = promptSources;
    const includeAuxIndexes = options.promptSource !== 'input' && options.filters?.promptSource !== 'input';

    if (USE_AGGREGATED_SCORING && matchingFiles.size > 0) {
        await scoreMatchingFilesAggregated(matchingFiles, normalizedBlocks, options);
    } else {
        for (const [filename, fileResult] of matchingFiles) {
            let score = 0;
            for (const block of normalizedBlocks) {
                for (const searchTerm of block.terms || []) {
                    const matchMode = block.matchMode || 'substring';
                    const tagMatch = matchMode === 'word'
                        ? omegasearchFilters.buildTermMatchSql('tag', searchTerm, 'word')
                        : omegasearchFilters.buildTermMatchSql('tag', searchTerm, matchMode);
                    const tagMatches = await db.all(`
                        SELECT SUM(weight) as totalWeight, COUNT(*) as count
                        FROM search_tags
                        WHERE filename = ? AND ${tagMatch.clause}${sourceClause}
                    `, [filename, ...tagMatch.params, ...sourceParams]);
                    if (tagMatches[0] && tagMatches[0].totalWeight) {
                        score += Math.abs(tagMatches[0].totalWeight) * 10 + (tagMatches[0].count * 2);
                    }

                    if (usesFtsPromptSearch(matchMode)) {
                        const ftsTable = getPromptFtsTableForSearch(options);
                        const ftsQuery = buildFts5WordQuery(searchTerm);
                        if (ftsQuery) {
                            try {
                                const ftsMatches = await db.all(`
                                    SELECT COUNT(*) as count
                                    FROM ${ftsTable}
                                    WHERE filename = ? AND ${ftsTable} MATCH ?
                                `, [filename, ftsQuery]);
                                if (ftsMatches[0] && ftsMatches[0].count > 0) {
                                    score += 8 * ftsMatches[0].count;
                                }
                            } catch (ftsError) {
                                logger.warn(`FTS scoring failed for "${searchTerm}":`, ftsError.message);
                            }
                        }
                    } else if (usesPromptBlobSearch(matchMode)) {
                        const blobLanes = getPromptBlobLanesForSearch({ promptSource: options.promptSource, filters: options.filters });
                        const lanePlaceholders = blobLanes.map(() => '?').join(',');
                        const blobMatch = omegasearchFilters.buildTermMatchSql('text_norm', searchTerm, matchMode);
                        const blobMatches = await db.all(`
                            SELECT COUNT(*) as count
                            FROM image_prompt_text
                            WHERE filename = ? AND ${blobMatch.clause} AND lane IN (${lanePlaceholders})
                        `, [filename, ...blobMatch.params, ...blobLanes]);
                        if (blobMatches[0] && blobMatches[0].count > 0) {
                            score += 8 * blobMatches[0].count;
                        }
                    } else {
                        const textMatch = matchMode === 'word'
                            ? omegasearchFilters.buildFullTextWordMatchSql('text_content', searchTerm)
                            : omegasearchFilters.buildTermMatchSql('text_content', searchTerm, matchMode);
                        const fullTextMatches = await db.all(`
                            SELECT SUM(weight) as totalWeight, COUNT(*) as count
                            FROM search_fulltext
                            WHERE filename = ? AND ${textMatch.clause}${sourceClause}
                        `, [filename, ...textMatch.params, ...sourceParams]);
                        if (fullTextMatches[0] && fullTextMatches[0].totalWeight) {
                            score += Math.abs(fullTextMatches[0].totalWeight) * 8 + (fullTextMatches[0].count * 2);
                        }
                    }

                    if (includeAuxIndexes) {
                        const charMatch = omegasearchFilters.buildTermMatchSql('character_name', searchTerm, matchMode);
                        const characterMatches = await db.all(`
                            SELECT COUNT(*) as count
                            FROM search_characters
                            WHERE filename = ? AND ${charMatch.clause}
                        `, [filename, ...charMatch.params]);
                        if (characterMatches[0] && characterMatches[0].count > 0) {
                            score += 15 * characterMatches[0].count;
                        }

                        const presetMatch = omegasearchFilters.buildTermMatchSql('preset_name', searchTerm, matchMode);
                        const presetMatches = await db.all(`
                            SELECT COUNT(*) as count
                            FROM search_presets
                            WHERE filename = ? AND ${presetMatch.clause}
                        `, [filename, ...presetMatch.params]);
                        if (presetMatches[0] && presetMatches[0].count > 0) {
                            score += 7 * presetMatches[0].count;
                        }

                        const modelMatch = omegasearchFilters.buildTermMatchSql('model_name', searchTerm, matchMode);
                        const modelMatches = await db.all(`
                            SELECT COUNT(*) as count
                            FROM search_models
                            WHERE filename = ? AND ${modelMatch.clause}
                        `, [filename, ...modelMatch.params]);
                        if (modelMatches[0] && modelMatches[0].count > 0) {
                            score += 5 * modelMatches[0].count;
                        }
                    }

                    score += 5;
                }
            }
            fileResult.matchScore = score;
        }
    }

    let results = Array.from(matchingFiles.values()).sort((a, b) => b.matchScore - a.matchScore);
    return results;
}

/**
 * Distinct prompt/character usages for block terms within a filename set (Omegasearch).
 */
async function getBlockPromptUsages(blocks, filenamesFilter = null, options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const normalizedBlocks = normalizeSearchBlocks(blocks, options.blockOptions || {});
    const { limit = 120 } = options;
    const promptSources = getPromptSourceFilter(options);
    const sourcePlaceholders = promptSources.map(() => '?').join(',');
    const sourceClause = ` AND source IN (${sourcePlaceholders})`;
    const sourceParams = promptSources;

    if (normalizedBlocks.length === 0) {
        return [];
    }

    if (!filenamesFilter || filenamesFilter.length === 0) {
        return [];
    }

    const aggregate = new Map();
    const chunkSize = 400;

    const bumpUsage = (key, payload, fileCount) => {
        const existing = aggregate.get(key);
        if (!existing) {
            aggregate.set(key, { ...payload, fileCount });
            return;
        }
        existing.fileCount += fileCount;
        if (!existing.sampleFilename && payload.sampleFilename) {
            existing.sampleFilename = payload.sampleFilename;
        }
    };

    for (const block of normalizedBlocks) {
        const matchMode = block.matchMode || 'substring';
        const blockLabel = block.terms.join(block.mode === 'or' || block.orWithinBlock ? ' OR ' : ' ');
        for (const term of block.terms || []) {
            const tagMatch = matchMode === 'word'
                ? omegasearchFilters.buildTermMatchSql('tag', term, 'word')
                : omegasearchFilters.buildTermMatchSql('tag', term, matchMode);
            const textMatch = matchMode === 'word'
                ? omegasearchFilters.buildFullTextWordMatchSql('text_content', term)
                : omegasearchFilters.buildTermMatchSql('text_content', term, matchMode);

            for (let i = 0; i < filenamesFilter.length; i += chunkSize) {
                const chunk = filenamesFilter.slice(i, i + chunkSize);
                const filePlaceholders = chunk.map(() => '?').join(',');

                const tagRows = await db.all(`
                    SELECT
                        source,
                        character,
                        original_tag AS displayText,
                        COUNT(DISTINCT filename) AS fileCount,
                        MIN(filename) AS sampleFilename
                    FROM search_tags
                    WHERE filename IN (${filePlaceholders})
                      AND ${tagMatch.clause}${sourceClause}
                    GROUP BY source, character, original_tag
                `, [...chunk, ...tagMatch.params, ...sourceParams]);

                for (const row of tagRows) {
                    const displayText = row.displayText || term;
                    const key = `${blockLabel}\0${row.source || 'prompt'}\0${row.character || ''}\0tag\0${displayText.toLowerCase()}`;
                    bumpUsage(key, {
                        block: blockLabel,
                        kind: 'tag',
                        source: row.source || 'prompt',
                        character: row.character || null,
                        displayText,
                        sampleFilename: row.sampleFilename || null,
                        fileCount: row.fileCount || 0
                    }, row.fileCount || 0);
                }

                const textRows = await db.all(`
                    SELECT
                        source,
                        character,
                        original_text AS displayText,
                        text_type AS textType,
                        COUNT(DISTINCT filename) AS fileCount,
                        MIN(filename) AS sampleFilename
                    FROM search_fulltext
                    WHERE filename IN (${filePlaceholders})
                      AND ${textMatch.clause}${sourceClause}
                    GROUP BY source, character, original_text, text_type
                `, [...chunk, ...textMatch.params, ...sourceParams]);

                for (const row of textRows) {
                    const displayText = row.displayText || term;
                    const key = `${blockLabel}\0${row.source || 'prompt'}\0${row.character || ''}\0text\0${(row.textType || 'full_text')}\0${displayText.toLowerCase()}`;
                    bumpUsage(key, {
                        block: blockLabel,
                        kind: 'text',
                        textType: row.textType || 'full_text',
                        source: row.source || 'prompt',
                        character: row.character || null,
                        displayText,
                        sampleFilename: row.sampleFilename || null,
                        fileCount: row.fileCount || 0
                    }, row.fileCount || 0);
                }
            }
        }
    }

    const sorted = [...aggregate.values()]
        .sort((a, b) => {
            if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
            return String(a.displayText || '').localeCompare(String(b.displayText || ''));
        })
        .slice(0, limit);

    const metadataCache = new Map();
    for (const usage of sorted) {
        const sampleFilename = usage.sampleFilename;
        if (!sampleFilename) continue;
        let cached = metadataCache.get(sampleFilename);
        if (!cached) {
            cached = await getCachedMetadata(sampleFilename);
            metadataCache.set(sampleFilename, cached);
        }
        if (cached) {
            usage.fullPrompt = extractFullPromptFromUsageMetadata(cached, usage);
        }
    }

    return sorted;
}

/** Minimum indexed files before file-coverage overuse signals are trusted. */
const SUGGESTION_OVERUSE_MIN_CORPUS_FILES = 12;
/** Tags/presets appearing on this fraction of corpus files (workspace or index) are treated as boilerplate. */
const SUGGESTION_OVERUSE_FILE_COVERAGE = 0.7;

function isDynamicallyOverusedTag(suggestion, corpusFileCount) {
    if (!corpusFileCount || corpusFileCount < SUGGESTION_OVERUSE_MIN_CORPUS_FILES) return false;
    const type = suggestion.type || 'tag';
    if (type !== 'tag' && type !== 'preset') return false;
    const occ = suggestion.occurrenceCount || 0;
    if (occ <= 0) return false;
    return occ / corpusFileCount >= SUGGESTION_OVERUSE_FILE_COVERAGE;
}

/**
 * Ranking score for tag/search suggestions: sublinear popularity + IDF-style boost from corpus size,
 * with extra derank for presets and tags that appear on most files in the corpus (dynamic boilerplate).
 */
function computeTagSuggestionRankScore(suggestion, corpusFileCount) {
    const occ = suggestion.occurrenceCount || 0;
    const w = Math.abs(suggestion.totalWeight || 0);
    const pop = Math.sqrt(occ + 1) + Math.sqrt(w + 0.25);
    let idfBoost = 1;
    if (corpusFileCount > 0) {
        const idf = Math.log((corpusFileCount + 1) / (occ + 1));
        idfBoost = 1 + 0.55 * Math.max(0, idf);
    }
    let score = pop * idfBoost;
    const type = suggestion.type || 'tag';
    if (type === 'preset') {
        score *= 0.42;
    }
    if (isDynamicallyOverusedTag(suggestion, corpusFileCount)) {
        score *= 0.18;
    }
    return score;
}

/**
 * Get tag suggestions from database
 */
async function getTagSuggestionsFromDatabase(query, filenamesFilter = null, limit = 20, options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    try {
        const searchTerm = query.toLowerCase().trim();
        const workspaceScope = options.workspaceScope || null;
        // Giant IN lists (tens of thousands of binds) lock SQLite for minutes — prefer ownership scope.
        let fileList = Array.isArray(filenamesFilter) ? filenamesFilter : null;
        if (fileList && fileList.length > 2000 && !workspaceScope) {
            logger.warn(`Dropping oversized filename filter (${fileList.length}) for tag suggestions; use workspaceScope instead`);
            fileList = null;
        }
        const scope = buildFilenameScopeClause(workspaceScope, fileList);
        const filenameFilterClause = scope.clause;
        const filenameParams = scope.params;
        const readDb = await getReadOnlyDatabase();
        const readHandle = readDb || db;

        let rankingCorpusFileCount = fileList && fileList.length > 0 ? fileList.length : 0;
        if (rankingCorpusFileCount <= 0 && workspaceScope) {
            rankingCorpusFileCount = await countWorkspaceCorpusFiles(workspaceScope);
        }
        if (rankingCorpusFileCount <= 0) {
            const row = await readHandle.get(`
                SELECT COUNT(DISTINCT filename) AS c
                FROM search_tags
                WHERE 1=1 ${filenameFilterClause}
            `, filenameParams);
            rankingCorpusFileCount = row && row.c ? row.c : 0;
        }

        const suggestions = [];

        // Get tag suggestions
        if (searchTerm.length === 0) {
            // Empty query - get most popular tags
            const tagResults = await readHandle.all(`
                SELECT 
                    tag,
                    original_tag,
                    SUM(weight) as totalWeight,
                    COUNT(DISTINCT filename) as occurrenceCount
                FROM search_tags
                WHERE 1=1 ${filenameFilterClause}
                GROUP BY tag, original_tag
                ORDER BY occurrenceCount DESC, totalWeight DESC
                LIMIT ?
            `, [...filenameParams, limit]);
            
            for (const row of tagResults) {
                // Get sample files for this tag (for preview images)
                const fileSamples = await readHandle.all(`
                    SELECT DISTINCT filename, weight
                    FROM search_tags
                    WHERE tag = ? AND original_tag = ? ${filenameFilterClause}
                    ORDER BY ABS(weight) DESC
                    LIMIT 5
                `, [row.tag, row.original_tag, ...filenameParams]);
                
                const files = fileSamples.map(f => ({
                    filename: f.filename,
                    weight: f.weight,
                    metadata: null
                }));
                
                suggestions.push({
                    type: 'tag',
                    tag: row.tag,
                    originalTag: row.original_tag,
                    totalWeight: row.totalWeight || 0,
                    occurrenceCount: row.occurrenceCount || 0,
                    files: files
                });
            }
        } else {
            // Search for matching tags
            const tagResults = await readHandle.all(`
                SELECT 
                    tag,
                    original_tag,
                    SUM(weight) as totalWeight,
                    COUNT(DISTINCT filename) as occurrenceCount
                FROM search_tags
                WHERE tag LIKE ? ${filenameFilterClause}
                GROUP BY tag, original_tag
                ORDER BY occurrenceCount DESC, totalWeight DESC
                LIMIT ?
            `, [`%${searchTerm}%`, ...filenameParams, limit]);
            
            for (const row of tagResults) {
                // Get sample files for this tag (for preview images)
                const fileSamples = await readHandle.all(`
                    SELECT DISTINCT filename, weight
                    FROM search_tags
                    WHERE tag = ? AND original_tag = ? ${filenameFilterClause}
                    ORDER BY ABS(weight) DESC
                    LIMIT 5
                `, [row.tag, row.original_tag, ...filenameParams]);
                
                const files = fileSamples.map(f => ({
                    filename: f.filename,
                    weight: f.weight,
                    metadata: null
                }));
                
                suggestions.push({
                    type: 'tag',
                    tag: row.tag,
                    originalTag: row.original_tag,
                    totalWeight: row.totalWeight || 0,
                    occurrenceCount: row.occurrenceCount || 0,
                    files: files
                });
            }

            // Also search full text
            const fullTextResults = await readHandle.all(`
                SELECT 
                    text_content as text,
                    original_text,
                    text_type,
                    SUM(weight) as totalWeight,
                    COUNT(DISTINCT filename) as occurrenceCount
                FROM search_fulltext
                WHERE text_content LIKE ? ${filenameFilterClause}
                GROUP BY text_content, original_text, text_type
                ORDER BY occurrenceCount DESC, totalWeight DESC
                LIMIT ?
            `, [`%${searchTerm}%`, ...filenameParams, Math.floor(limit / 2)]);
            
            for (const row of fullTextResults) {
                suggestions.push({
                    type: 'full_text',
                    tag: row.text,
                    originalTag: row.original_text,
                    fullText: row.original_text,
                    totalWeight: row.totalWeight || 0,
                    occurrenceCount: row.occurrenceCount || 0
                });
            }

            // Search characters
            const characterResults = await readHandle.all(`
                SELECT 
                    character_name,
                    COUNT(DISTINCT filename) as occurrenceCount
                FROM search_characters
                WHERE character_name LIKE ? ${filenameFilterClause}
                GROUP BY character_name
                ORDER BY occurrenceCount DESC
                LIMIT ?
            `, [`%${searchTerm}%`, ...filenameParams, Math.floor(limit / 4)]);
            
            for (const row of characterResults) {
                suggestions.push({
                    type: 'character',
                    tag: row.character_name.toLowerCase(),
                    originalTag: row.character_name,
                    totalWeight: 0,
                    occurrenceCount: row.occurrenceCount || 0
                });
            }

            // Search presets
            const presetResults = await readHandle.all(`
                SELECT 
                    preset_name,
                    COUNT(DISTINCT filename) as occurrenceCount
                FROM search_presets
                WHERE preset_name LIKE ? ${filenameFilterClause}
                GROUP BY preset_name
                ORDER BY occurrenceCount DESC
                LIMIT ?
            `, [`%${searchTerm}%`, ...filenameParams, Math.floor(limit / 4)]);
            
            for (const row of presetResults) {
                suggestions.push({
                    type: 'preset',
                    tag: row.preset_name.toLowerCase(),
                    originalTag: row.preset_name,
                    totalWeight: 0,
                    occurrenceCount: row.occurrenceCount || 0
                });
            }
        }

        suggestions.sort((a, b) => {
            const scoreA = computeTagSuggestionRankScore(a, rankingCorpusFileCount);
            const scoreB = computeTagSuggestionRankScore(b, rankingCorpusFileCount);
            if (scoreB !== scoreA) return scoreB - scoreA;
            if (b.occurrenceCount !== a.occurrenceCount) {
                return b.occurrenceCount - a.occurrenceCount;
            }
            const wDiff = Math.abs(b.totalWeight || 0) - Math.abs(a.totalWeight || 0);
            if (wDiff !== 0) return wDiff;
            return (a.originalTag || a.tag || '').localeCompare(b.originalTag || b.tag || '');
        });

        return suggestions.slice(0, limit);

    } catch (error) {
        logger.error('Error getting tag suggestions from database:', error);
        throw error;
    }
}

/**
 * Sync search indexes - only index files that are missing indexes or have outdated indexes
 * This is more efficient than rebuilding everything
 */
function markSearchIndexSyncUpToDate() {
    searchIndexSyncUpToDateUntil = Date.now() + SEARCH_INDEX_SYNC_UP_TO_DATE_TTL_MS;
}

function invalidateSearchIndexSyncUpToDate() {
    searchIndexSyncUpToDateUntil = 0;
}

function isSearchIndexSyncCachedUpToDate() {
    return searchIndexSyncUpToDateUntil > Date.now();
}

async function countImagesPendingSearchIndex(readHandle) {
    const row = await readHandle.get('SELECT COUNT(*) AS count FROM images WHERE search_indexes_ready = 0');
    return Number(row?.count) || 0;
}

async function hasImagesPendingSearchIndex(readHandle) {
    const row = await readHandle.get('SELECT 1 AS ok FROM images WHERE search_indexes_ready = 0 LIMIT 1');
    return Boolean(row);
}

/**
 * Cheap readiness probe only — never UNION-scan search_* tables (that locked the shared
 * read-only connection used by gallery pagination for minutes after boot).
 * Pending flags are handled by delayed syncSearchIndexes.
 */
async function backfillSearchIndexesReadyFlagIfComplete() {
    if (!dbInitialized || !db) {
        return false;
    }
    const readDb = await getReadOnlyDatabase();
    const readHandle = readDb || db;
    if (!(await hasImagesPendingSearchIndex(readHandle))) {
        markSearchIndexSyncUpToDate();
        return true;
    }
    return false;
}

async function syncSearchIndexes(progressCallback = null) {
    try {
        if (!dbInitialized || !db) {
            throw new Error('Database not initialized');
        }

        if (isSearchIndexSyncCachedUpToDate()) {
            const readDb = await getReadOnlyDatabase();
            const readHandle = readDb || db;
            if (!(await hasImagesPendingSearchIndex(readHandle))) {
                if (progressCallback) {
                    progressCallback({
                        current: 0,
                        total: 0,
                        filename: null,
                        updatedCount: 0,
                        errorCount: 0,
                        status: 'up_to_date'
                    });
                }
                return { updatedCount: 0, errorCount: 0, totalFiles: 0, skipped: true };
            }
            invalidateSearchIndexSyncUpToDate();
        }

        const readDb = await getReadOnlyDatabase();
        const readHandle = readDb || db;

        if (!(await hasImagesPendingSearchIndex(readHandle))) {
            markSearchIndexSyncUpToDate();
            console.log('✅ All files already have search indexes');
            if (progressCallback) {
                progressCallback({
                    current: 0,
                    total: 0,
                    filename: null,
                    updatedCount: 0,
                    errorCount: 0,
                    status: 'up_to_date'
                });
            }
            return { updatedCount: 0, errorCount: 0, totalFiles: 0 };
        }

        const totalFiles = await countImagesPendingSearchIndex(readHandle);
        if (totalFiles <= 0) {
            markSearchIndexSyncUpToDate();
            console.log('✅ All files already have search indexes');
            if (progressCallback) {
                progressCallback({
                    current: 0,
                    total: 0,
                    filename: null,
                    updatedCount: 0,
                    errorCount: 0,
                    status: 'up_to_date'
                });
            }
            return { updatedCount: 0, errorCount: 0, totalFiles: 0 };
        }

        invalidateSearchIndexSyncUpToDate();
        console.log(`🔄 Syncing search indexes for ${totalFiles} files...`);

        let updatedCount = 0;
        let errorCount = 0;
        let processedCount = 0;

        while (processedCount < totalFiles) {
            const batch = await readHandle.all(
                `SELECT filename FROM images WHERE search_indexes_ready = 0 LIMIT ?`,
                [SEARCH_INDEX_SYNC_BATCH_SIZE]
            );
            if (!batch.length) {
                break;
            }

            for (let i = 0; i < batch.length; i++) {
                const { filename } = batch[i];
                processedCount += 1;
                try {
                    const metadata = await getCachedMetadata(filename);
                    if (metadata) {
                        await updateSearchIndexes(filename, metadata);
                        updatedCount += 1;
                    } else {
                        errorCount += 1;
                    }

                    if (progressCallback) {
                        progressCallback({
                            current: processedCount,
                            total: totalFiles,
                            filename,
                            updatedCount,
                            errorCount,
                            status: 'indexing'
                        });
                    }
                } catch (error) {
                    logger.error(`Error updating search indexes for ${filename}:`, error);
                    errorCount += 1;
                }

                if (i % 5 === 4) {
                    await new Promise((resolve) => { setImmediate(resolve); });
                }
            }
            // Yield between batches so WS gallery/metadata handlers can run.
            await new Promise((resolve) => { setTimeout(resolve, 0); });
        }

        if (!(await hasImagesPendingSearchIndex(readHandle))) {
            markSearchIndexSyncUpToDate();
        }

        console.log(`✅ Search index sync complete: ${updatedCount} updated, ${errorCount} errors`);

        if (progressCallback) {
            progressCallback({
                current: totalFiles,
                total: totalFiles,
                filename: null,
                updatedCount,
                errorCount,
                status: 'complete'
            });
        }

        return { updatedCount, errorCount, totalFiles };
    } catch (error) {
        logger.error('Error syncing search indexes:', error);
        if (progressCallback) {
            progressCallback({
                current: 0,
                total: 0,
                filename: null,
                updatedCount: 0,
                errorCount: 1,
                status: 'error',
                error: error.message
            });
        }
        return { updatedCount: 0, errorCount: 1, totalFiles: 0 };
    }
}

/**
 * Rebuild search indexes for all images (migration/rebuild function)
 */
async function rebuildSearchIndexes(imagesDir, progressCallback = null) {
    try {
        console.log('🔄 Rebuilding search indexes for all images...');
        
        if (!dbInitialized || !db) {
            throw new Error('Database not initialized');
        }

        // First, clear all existing search indexes
        console.log('🧹 Clearing all existing search indexes...');
        await db.run('DELETE FROM search_tags');
        await db.run('DELETE FROM search_fulltext');
        await db.run('DELETE FROM search_characters');
        await db.run('DELETE FROM search_presets');
        await db.run('DELETE FROM search_models');
        await db.run('UPDATE images SET search_indexes_ready = 0');
        invalidateSearchIndexSyncUpToDate();
        console.log('✅ All search indexes cleared');

        // Get all images from database
        const images = await db.all('SELECT filename FROM images');
        const totalFiles = images.length;

        let updatedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < images.length; i++) {
            const { filename } = images[i];
            try {
                // Get metadata for this file
                const metadata = await getCachedMetadata(filename);
                if (metadata) {
                    await updateSearchIndexes(filename, metadata);
                    updatedCount++;
                } else {
                    errorCount++;
                }

                // Send progress update if callback provided
                if (progressCallback) {
                    progressCallback({
                        current: i + 1,
                        total: totalFiles,
                        filename: filename,
                        updatedCount,
                        errorCount,
                        status: 'indexing'
                    });
                }
            } catch (error) {
                logger.error(`Error updating search indexes for ${filename}:`, error);
                errorCount++;
            }
        }

        console.log(`✅ Search index rebuild complete: ${updatedCount} updated, ${errorCount} errors`);

        // Send final completion callback
        if (progressCallback) {
            progressCallback({
                current: totalFiles,
                total: totalFiles,
                filename: null,
                updatedCount,
                errorCount,
                status: 'complete'
            });
        }

        return { updatedCount, errorCount, totalFiles };
    } catch (error) {
        logger.error('Error rebuilding search indexes:', error);
        return { updatedCount: 0, errorCount: 1, totalFiles: 0 };
    }
}

// Checkpoint management - access through wrapper
// The wrapper automatically handles checkpointing, but we expose getCheckpointManager
// for globalResources to register with the global checkpoint manager (legacy support during migration)
function getCheckpointManager() {
    return db ? db.getCheckpointManager() : null;
}

// Graceful shutdown
process.on('SIGINT', () => {
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeDatabase();
    process.exit(0);
});

/**
 * Top prompt/character tags for a set of filenames (for dynamic quip term extraction).
 */
async function getPromptTermStatsForFilenames(filenames, options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const {
        limit = 120,
        sources = ['prompt', 'character_prompt', 'v4_character_caption']
    } = options;

    if (!filenames || filenames.length === 0) {
        return [];
    }

    const sourcePlaceholders = sources.map(() => '?').join(',');
    const chunkSize = 400;
    const aggregate = new Map();

    for (let i = 0; i < filenames.length; i += chunkSize) {
        const chunk = filenames.slice(i, i + chunkSize);
        const filePlaceholders = chunk.map(() => '?').join(',');
        const rows = await db.all(`
            SELECT
                tag,
                original_tag,
                COUNT(DISTINCT filename) AS occurrenceCount,
                AVG(ABS(weight)) AS avgWeight
            FROM search_tags
            WHERE filename IN (${filePlaceholders})
              AND source IN (${sourcePlaceholders})
            GROUP BY tag, original_tag
        `, [...chunk, ...sources]);

        for (const row of rows) {
            const key = row.tag;
            const existing = aggregate.get(key);
            if (!existing || row.occurrenceCount > existing.occurrenceCount) {
                aggregate.set(key, {
                    tag: row.tag,
                    originalTag: row.original_tag,
                    occurrenceCount: row.occurrenceCount,
                    avgWeight: row.avgWeight || 0
                });
            }
        }
    }

    return [...aggregate.values()]
        .sort((a, b) => {
            if (b.occurrenceCount !== a.occurrenceCount) {
                return b.occurrenceCount - a.occurrenceCount;
            }
            return (b.avgWeight || 0) - (a.avgWeight || 0);
        })
        .slice(0, limit);
}

/**
 * Tag pairs that co-occur in the same file (for distinctive workspace combinations).
 */
async function getPromptTagPairStatsForFilenames(filenames, options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const {
        limit = 80,
        minCoCount = 4,
        sources = ['prompt', 'character_prompt', 'v4_character_caption']
    } = options;

    if (!filenames || filenames.length === 0) {
        return [];
    }

    const sourcePlaceholders = sources.map(() => '?').join(',');
    const chunkSize = 200;
    const aggregate = new Map();

    for (let i = 0; i < filenames.length; i += chunkSize) {
        const chunk = filenames.slice(i, i + chunkSize);
        const filePlaceholders = chunk.map(() => '?').join(',');
        const rows = await db.all(`
            SELECT
                t1.tag AS tag1,
                t2.tag AS tag2,
                MIN(t1.original_tag) AS originalTag1,
                MIN(t2.original_tag) AS originalTag2,
                COUNT(DISTINCT t1.filename) AS coOccurrenceCount,
                AVG((ABS(t1.weight) + ABS(t2.weight)) / 2.0) AS avgWeight
            FROM search_tags t1
            INNER JOIN search_tags t2
                ON t1.filename = t2.filename
               AND t1.tag < t2.tag
            WHERE t1.filename IN (${filePlaceholders})
              AND t1.source IN (${sourcePlaceholders})
              AND t2.source IN (${sourcePlaceholders})
            GROUP BY t1.tag, t2.tag
            HAVING COUNT(DISTINCT t1.filename) >= ?
        `, [...chunk, ...sources, ...sources, minCoCount]);

        for (const row of rows) {
            const key = `${row.tag1}\0${row.tag2}`;
            const existing = aggregate.get(key);
            if (!existing || row.coOccurrenceCount > existing.coOccurrenceCount) {
                aggregate.set(key, {
                    tag1: row.tag1,
                    tag2: row.tag2,
                    originalTag1: row.originalTag1,
                    originalTag2: row.originalTag2,
                    coOccurrenceCount: row.coOccurrenceCount,
                    avgWeight: row.avgWeight || 0
                });
            }
        }
    }

    return [...aggregate.values()]
        .sort((a, b) => {
            if (b.coOccurrenceCount !== a.coOccurrenceCount) {
                return b.coOccurrenceCount - a.coOccurrenceCount;
            }
            return (b.avgWeight || 0) - (a.avgWeight || 0);
        })
        .slice(0, limit);
}

/**
 * Character names indexed from forge metadata for a set of filenames.
 */
async function getCharacterStatsForFilenames(filenames, options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const { limit = 40 } = options;

    if (!filenames || filenames.length === 0) {
        return [];
    }

    const chunkSize = 400;
    const aggregate = new Map();

    for (let i = 0; i < filenames.length; i += chunkSize) {
        const chunk = filenames.slice(i, i + chunkSize);
        const filePlaceholders = chunk.map(() => '?').join(',');
        const rows = await db.all(`
            SELECT
                character_name AS characterName,
                COUNT(DISTINCT filename) AS occurrenceCount
            FROM search_characters
            WHERE filename IN (${filePlaceholders})
            GROUP BY character_name
        `, chunk);

        for (const row of rows) {
            const key = String(row.characterName || '').trim().toLowerCase();
            if (!key) continue;
            const existing = aggregate.get(key);
            if (!existing || row.occurrenceCount > existing.occurrenceCount) {
                aggregate.set(key, {
                    characterName: row.characterName,
                    occurrenceCount: row.occurrenceCount
                });
            }
        }
    }

    return [...aggregate.values()]
        .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
        .slice(0, limit);
}

/**
 * Find the most recently modified workspace image linked to a novel note via forge metadata.
 */
async function findLatestImageFilenameByNovelNoteId(noteId) {
    if (!dbInitialized || !db || !noteId) return null;
    try {
        const row = await db.get(`
            SELECT filename FROM images
            WHERE json_extract(metadata, '$.forge_data.novel_note_id') = ?
               OR json_extract(metadata, '$.novel_note_id') = ?
            ORDER BY mtime DESC, updated_at DESC
            LIMIT 1
        `, [noteId, noteId]);
        return row?.filename || null;
    } catch (error) {
        logger.error('Error finding novel-linked image in metadata DB:', error);
        return null;
    }
}

function similarImagePreviewUrl(filename) {
    const base = String(filename || '')
        .replace(/\.(png|jpg|jpeg)$/i, '')
        .replace(/_upscaled$/i, '');
    if (!base) return '';
    return `/previews/${encodeURIComponent(`${base}.webp`)}`;
}

function similarImageFullUrl(filename) {
    if (!filename) return '';
    return `/images/${encodeURIComponent(filename)}`;
}

function clampSimilarLimit(value, fallback, min, max) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/**
 * List consecutive-seed (and optional refine) similar-image groups for a workspace.
 * Uses indexed facet + ownership columns only — does not scan metadata JSON.
 * Groups with fewer than 2 members are omitted. Caps groups and items per group.
 */
async function listSimilarImageGroupsForWorkspace(workspaceId, options = {}) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    const wsId = workspaceId || 'default';
    const includeRefine = options.includeRefine !== false;
    const groupLimit = clampSimilarLimit(options.groupLimit, 50, 1, 100);
    const itemLimit = clampSimilarLimit(options.itemLimit, 24, 2, 48);

    const seedRows = await db.all(`
        SELECT f.consecutive_seed_group_id AS group_id,
               COUNT(*) AS item_count,
               MAX(COALESCE(f.mtime, 0)) AS latest_mtime,
               MIN(f.seed) AS seed
        FROM image_search_facets f
        INNER JOIN ${GALLERY_OWNERSHIP_TABLE} o
            ON o.filename = f.filename
        WHERE o.workspace_id = ?
          AND o.bucket = 'files'
          AND f.consecutive_seed_group_id IS NOT NULL
        GROUP BY f.consecutive_seed_group_id
        HAVING COUNT(*) >= 2
        ORDER BY latest_mtime DESC
        LIMIT ?
    `, [wsId, groupLimit]);

    const combined = (seedRows || []).map((row) => ({
        groupId: row.group_id,
        kind: 'consecutive_seed',
        seed: row.seed != null ? String(row.seed) : null,
        count: Number(row.item_count) || 0,
        latestMtime: Number(row.latest_mtime) || 0
    }));

    if (includeRefine && combined.length < groupLimit) {
        const remaining = groupLimit - combined.length;
        const refineRows = await db.all(`
            SELECT f.refine_group_id AS group_id,
                   COUNT(*) AS item_count,
                   MAX(COALESCE(f.mtime, 0)) AS latest_mtime,
                   MIN(f.seed) AS seed
            FROM image_search_facets f
            INNER JOIN ${GALLERY_OWNERSHIP_TABLE} o
                ON o.filename = f.filename
            WHERE o.workspace_id = ?
              AND o.bucket = 'files'
              AND f.refine_group_id IS NOT NULL
            GROUP BY f.refine_group_id
            HAVING COUNT(*) >= 2
            ORDER BY latest_mtime DESC
            LIMIT ?
        `, [wsId, remaining]);
        const seen = new Set(combined.map((row) => row.groupId));
        for (const row of refineRows || []) {
            if (!row.group_id || seen.has(row.group_id)) continue;
            seen.add(row.group_id);
            combined.push({
                groupId: row.group_id,
                kind: 'refine',
                seed: row.seed != null ? String(row.seed) : null,
                count: Number(row.item_count) || 0,
                latestMtime: Number(row.latest_mtime) || 0
            });
        }
    }

    const groups = [];
    for (const row of combined) {
        const items = row.kind === 'refine'
            ? await db.all(`
                SELECT f.filename, f.seed, f.mtime, f.width, f.height
                FROM image_search_facets f
                INNER JOIN ${GALLERY_OWNERSHIP_TABLE} o
                    ON o.filename = f.filename
                WHERE o.workspace_id = ?
                  AND o.bucket = 'files'
                  AND f.refine_group_id = ?
                ORDER BY COALESCE(f.mtime, 0) DESC, f.filename ASC
                LIMIT ?
            `, [wsId, row.groupId, itemLimit])
            : await db.all(`
                SELECT f.filename, f.seed, f.mtime, f.width, f.height
                FROM image_search_facets f
                INNER JOIN ${GALLERY_OWNERSHIP_TABLE} o
                    ON o.filename = f.filename
                WHERE o.workspace_id = ?
                  AND o.bucket = 'files'
                  AND f.consecutive_seed_group_id = ?
                ORDER BY COALESCE(f.mtime, 0) DESC, f.filename ASC
                LIMIT ?
            `, [wsId, row.groupId, itemLimit]);

        groups.push({
            groupId: row.groupId,
            kind: row.kind,
            seed: row.seed,
            count: row.count,
            latestMtime: row.latestMtime,
            truncated: row.count > (items || []).length,
            items: (items || []).map((item) => ({
                filename: item.filename,
                seed: item.seed != null ? String(item.seed) : null,
                previewUrl: similarImagePreviewUrl(item.filename),
                imageUrl: similarImageFullUrl(item.filename),
                mtime: item.mtime || 0,
                width: item.width || null,
                height: item.height || null
            }))
        });
    }

    const seedIndex = await db.get(`
        SELECT COUNT(*) AS n
        FROM image_search_facets
        WHERE consecutive_seed_group_id IS NOT NULL
    `);
    const refineIndex = await db.get(`
        SELECT COUNT(*) AS n
        FROM image_search_facets
        WHERE refine_group_id IS NOT NULL
    `);

    return {
        workspaceId: wsId,
        groups,
        groupCount: groups.length,
        capped: (seedRows || []).length >= groupLimit,
        indexImages: {
            consecutiveSeed: Number(seedIndex && seedIndex.n) || 0,
            refine: Number(refineIndex && refineIndex.n) || 0
        }
    };
}

/**
 * Filenames in one similar group that also belong to the workspace files bucket.
 */
async function listSimilarGroupMemberFilenames(workspaceId, groupId, kind = 'consecutive_seed') {
    if (!dbInitialized || !db || !groupId) {
        return [];
    }
    const wsId = workspaceId || 'default';
    const rows = kind === 'refine'
        ? await db.all(`
            SELECT f.filename
            FROM image_search_facets f
            INNER JOIN ${GALLERY_OWNERSHIP_TABLE} o
                ON o.filename = f.filename
            WHERE o.workspace_id = ?
              AND o.bucket = 'files'
              AND f.refine_group_id = ?
        `, [wsId, groupId])
        : await db.all(`
            SELECT f.filename
            FROM image_search_facets f
            INNER JOIN ${GALLERY_OWNERSHIP_TABLE} o
                ON o.filename = f.filename
            WHERE o.workspace_id = ?
              AND o.bucket = 'files'
              AND f.consecutive_seed_group_id = ?
        `, [wsId, groupId]);
    return (rows || []).map((row) => row.filename).filter(Boolean);
}

module.exports = {
    initializeDatabase,
    closeDatabase,
    getImageMetadata,
    scanAndUpdateMetadata,
    rebuildMetadataCache,
    addReceipt,
    removeImageMetadata,
    getCachedMetadata,
    getLightweightMetadata,
    viewTypeToGalleryBucket,
    listWorkspaceGalleryFilenames,
    countWorkspaceGalleryFilenames,
    listWorkspaceGalleryImageRows,
    countGalleryWorkspaceItems,
    listWorkspaceGalleryIndexItems,
    listWorkspaceGalleryItemsPaginated,
    findGalleryWorkspaceItemIndex,
    getGalleryWorkspaceIndexMeta,
    getGalleryWorkspaceImageCountsById,
    getGalleryWorkspaceStatsById,
    getGalleryWorkspaceProbeMeta,
    GALLERY_BLOCK_SIZE,
    listGalleryWorkspacePinBases,
    listGalleryWorkspacePinIndexes,
    listGalleryWorkspacePinFilenames,
    addGalleryWorkspacePin,
    removeGalleryWorkspacePin,
    ensureGalleryWorkspaceItemsFromOwnership,
    backfillGalleryWorkspaceItemsFromOwnership,
    ensureGalleryOwnershipFromWorkspaces,
    reconcileGalleryOwnershipFromWorkspaces,
    removeGalleryOwnershipForFilenames,
    getMultipleMetadata,
    addReceiptMetadata,
    setImageBlurhash,
    syncGalleryItemBlurhashesFromImages,
    backfillMissingBlurhashes,
    addUnattributedReceipt,
    getUnattributedReceipts,
    migrateFromJSON,
    getDatabaseStats,
    updateFileMetadata,
    getAllFilenames,
    findLatestImageFilenameByNovelNoteId,
    
    // Search index functions
    updateSearchIndexes,
    searchFilesInDatabase,
    searchFilesWithBlocks,
    normalizeSearchBlocks,
    flattenSearchBlockTerms,
    applyOmegasearchMetadataFilters,
    getBlockPromptUsages,
    getTagSuggestionsFromDatabase,
    getPromptTermStatsForFilenames,
    getPromptTagPairStatsForFilenames,
    getCharacterStatsForFilenames,
    computeTagSuggestionRankScore,
    syncSearchIndexes,
    syncSearchFacetsFromStoredMetadata,
    backfillSearchExtraction,
    backfillPromptBlobs,
    getPromptIndexStats,
    reconcilePromptFtsFlags,
    backfillPromptFts,
    backfillSeedChains,
    syncWorkspaceMembership,
    upsertGalleryOwnership,
    removeGalleryOwnership,
    getGalleryOwnershipForFilename,
    backfillGalleryOwnershipFromWorkspaces,
    buildFilenameScopeClause,
    listSimilarImageGroupsForWorkspace,
    listSimilarGroupMemberFilenames,
    countWorkspaceCorpusFiles,
    rebuildSearchIndexes,
    setIndexingPaused,
    isIndexingPaused,

    // Checkpoint management - access through wrapper
    getCheckpointManager
};
