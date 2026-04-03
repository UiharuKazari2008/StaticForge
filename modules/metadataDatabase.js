const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const logger = require('./logger');
// Note: globalResources is NOT required here to avoid circular dependency
// It will be accessed lazily when needed
const { isImageLarge } = require('./imageTools');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');
const { parsePromptSegments } = require('./promptSegments');

let db = null;
let dbPath = null;
let dbInitialized = false;
let _pngMetadata = null;
let indexingPaused = false; // Track if indexing is paused globally

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
        CREATE INDEX IF NOT EXISTS idx_search_fulltext_filename ON search_fulltext (filename);
        CREATE INDEX IF NOT EXISTS idx_search_fulltext_content ON search_fulltext (text_content);
        CREATE INDEX IF NOT EXISTS idx_search_fulltext_source ON search_fulltext (source);
        CREATE INDEX IF NOT EXISTS idx_search_characters_filename ON search_characters (filename);
        CREATE INDEX IF NOT EXISTS idx_search_characters_name ON search_characters (character_name);
        CREATE INDEX IF NOT EXISTS idx_search_presets_filename ON search_presets (filename);
        CREATE INDEX IF NOT EXISTS idx_search_presets_name ON search_presets (preset_name);
        CREATE INDEX IF NOT EXISTS idx_search_models_filename ON search_models (filename);
        CREATE INDEX IF NOT EXISTS idx_search_models_name ON search_models (model_name);
    `);

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

    logger.bootSubStep('Metadata database ready');
}

/**
 * Close database connection
 */
async function closeDatabase() {
    if (db) {
        await db.close();
        db = null;
        logger.info('Database connection closed');
    }
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
 * Determine if an image is upscaled and find its parent
 */
function determineImageRelationships(filename, allFiles) {
    const isUpscaled = filename.includes('_upscaled');
    let parent = null;
    
    if (isUpscaled) {
        // Find the original image
        const originalName = filename.replace('_upscaled.png', '.png');
        if (allFiles.includes(originalName)) {
            parent = originalName;
        }
    } else {
        // Check if this image has an upscaled version
        const upscaledName = filename.replace('.png', '_upscaled.png');
        if (allFiles.includes(upscaledName)) {
            // This image has an upscaled version
        }
    }
    
    return {
        isUpscaled,
        parent
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
                // Get receipts for this image
                const receipts = await db.all('SELECT receipt_data FROM receipts WHERE image_id = ? ORDER BY timestamp', [existing.id]);
                
                const result = {
                    ...existing,
                    receipt: receipts.map(r => JSON.parse(r.receipt_data)),
                    metadata: existing.metadata ? JSON.parse(existing.metadata) : {}
                };
                
                return result;
            }
            
            // MD5 changed, need to update metadata
            console.log(`🔄 MD5 changed for ${filename}, updating metadata`);
        }
        
        // Extract new metadata
        const stats = fs.statSync(filePath);
        const md5 = generateMD5(filePath);
        const imageMetadata = await extractImageMetadata(filePath);
        
        if (!imageMetadata) {
            console.error(`❌ Failed to extract metadata for ${filename}`);
            return null;
        }
        
        // Extract PNG embedded metadata
        let extractedMetadata = null;
        try {
            extractedMetadata = _pngMetadata.extractNovelAIMetadata(filePath);
        } catch (error) {
            console.error(`❌ Error extracting PNG metadata for ${filename}:`, error.message);
            extractedMetadata = {};
        }
        
        // Get all files to determine relationships
        const allFiles = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
        const relationships = determineImageRelationships(filename, allFiles);
        
        // Create metadata entry
        const metadata = {
            filename,
            md5,
            width: imageMetadata.width,
            height: imageMetadata.height,
            parent: relationships.parent,
            upscaled: relationships.isUpscaled,
            receipt: [],
            size: stats.size,
            mtime: stats.mtime.valueOf(),
            metadata: extractedMetadata || {}
        };
        
        // Insert or update in database using INSERT OR REPLACE to handle race conditions
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
        
        // Update search indexes for this file
        await updateSearchIndexes(filename, metadata);
        
        return metadata;
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
        const existingFiles = (await db.all('SELECT filename FROM images')).map(row => row.filename);
        
        // Get all image files from directory
        const allFiles = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
        const missingFiles = allFiles.filter(f => !existingFiles.includes(f));
        
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
                    extractedMetadata = _pngMetadata.extractNovelAIMetadata(filePath);
                } catch (error) {
                    console.error(`❌ Error extracting PNG metadata for ${filename}:`, error.message);
                    extractedMetadata = {};
                }
                
                // Get all files to determine relationships
                const relationships = determineImageRelationships(filename, allFiles);
                
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

/**
 * Remove metadata for deleted images and merge receipts
 */
async function removeImageMetadata(filenames) {
    if (!Array.isArray(filenames) || filenames.length === 0) {
        return 0;
    }
    
    // For large batches, use batch deletion
    if (filenames.length > 50) {
        return await removeImageMetadataBatch(filenames);
    }
    
    // For smaller batches, use individual deletion (preserves receipt handling)
    let removedCount = 0;
    
    for (const filename of filenames) {
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
            
            // Delete the image and its receipts (CASCADE will handle receipts)
            await db.run('DELETE FROM images WHERE filename = ?', [filename]);
            
            removedCount++;
        }
    }
    
    if (removedCount > 0) {
        console.log(`🗑️ Removed metadata for ${removedCount} images`);
    }
    
    return removedCount;
}

/**
 * Batch delete image metadata for files that don't exist
 * Optimized for large batches - extracts receipts in batch first, then deletes
 * @param {Array<string>} filenames - Array of filenames to delete
 * @param {number} batchSize - Number of deletions per transaction (default: 500)
 */
async function removeImageMetadataBatch(filenames, batchSize = 500) {
    try {
        if (!dbInitialized || !db) {
            throw new Error('Database not initialized');
        }
        
        if (!Array.isArray(filenames) || filenames.length === 0) {
            return 0;
        }
        
        let removedCount = 0;
        let receiptCount = 0;
        
        // Process in batches to avoid overwhelming the database
        for (let i = 0; i < filenames.length; i += batchSize) {
            const batch = filenames.slice(i, i + batchSize);
            
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
    const image = await db.get('SELECT * FROM images WHERE filename = ?', [filename]);
    
    if (!image) return null;
    
    const result = {
        ...image,
        metadata: image.metadata ? JSON.parse(image.metadata) : {},
        upscaled: Boolean(image.upscaled)
    };
    
    // Only load receipts if requested (for performance)
    if (includeReceipts) {
        const receipts = await db.all('SELECT receipt_data FROM receipts WHERE image_id = ? ORDER BY timestamp', [image.id]);
        result.receipt = receipts.map(r => JSON.parse(r.receipt_data));
    } else {
        result.receipt = [];
    }
    
    return result;
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
    
    const result = {};
    
    // Batch query: Get only essential fields for sorting
    const placeholders = filenames.map(() => '?').join(',');
    const images = await db.all(
        `SELECT filename, mtime, width, height, size, upscaled, parent FROM images WHERE filename IN (${placeholders})`,
        filenames
    );
    
    for (const image of images) {
        result[image.filename] = {
            filename: image.filename,
            mtime: image.mtime || Date.now(),
            width: image.width || null,
            height: image.height || null,
            size: image.size || 0,
            upscaled: Boolean(image.upscaled),
            parent: image.parent || null
        };
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
    
    const BATCH_SIZE = 500; // Process 500 at a time
    const MAX_JSON_SIZE = 5 * 1024 * 1024; // 5MB limit per JSON string
    const result = {};
    
    // Process in batches to prevent OOM with large filename lists
    for (let i = 0; i < filenames.length; i += BATCH_SIZE) {
        const batch = filenames.slice(i, i + BATCH_SIZE);
        
        // Batch query: Get images to save memory
        const placeholders = batch.map(() => '?').join(',');
        const images = await db.all(
            `SELECT id, filename, md5, width, height, parent, upscaled, size, mtime, metadata, created_at, updated_at 
             FROM images 
             WHERE filename IN (${placeholders})`,
            batch
        );
        
        if (images.length === 0) {
            continue;
        }
        
        // Parse metadata for this batch
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
        
        // Allow GC between batches
        if (i + BATCH_SIZE < filenames.length) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }
    
    return result;
}

/**
 * Update metadata for an image (e.g., after generation)
 */
async function addReceiptMetadata(filename, imagesDir, receiptData = null, forgeData = null) {
    const metadata = await getImageMetadata(filename, imagesDir);
    
    if (metadata && receiptData) {
        await addReceipt(filename, receiptData);
    }
    
    // If forge data is provided, also update the file and database metadata
    if (metadata && forgeData) {
        await updateFileMetadata(filename, imagesDir, forgeData);
    }
    
    return metadata;
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
        return rows.map(row => row.filename);
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
                await updateSearchIndexes(filename, metadataWithParsed);
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
        weight = baseWeight * (1.0 + (braceLevel * 0.1));
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
            weight = baseWeight * (1.0 - (bracketLevel * 0.1));
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
        if (tag.startsWith('Text:')) {
            const displayText = tag.substring(5).trim();
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

        if (!metadata || !metadata.metadata) {
            return; // No metadata to index
        }

        const pngMeta = metadata.metadata;
        const fileTags = [];
        const fileFullText = [];

        // Extract tags and full text from main prompt
        if (pngMeta.prompt) {
            const promptData = extractTagsFromText(pngMeta.prompt);
            fileTags.push(...promptData.tags.map(t => ({ ...t, source: 'prompt' })));
            fileFullText.push(...promptData.fullTextEntries.map(t => ({ ...t, source: 'prompt' })));
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

        // Index preset names
        if (pngMeta.preset_name) {
            await db.run(`
                INSERT INTO search_presets (filename, preset_name)
                VALUES (?, ?)
            `, [filename, pngMeta.preset_name]);
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

        // Index model names
        if (pngMeta.model) {
            await db.run(`
                INSERT INTO search_models (filename, model_name)
                VALUES (?, ?)
            `, [filename, pngMeta.model]);
        }

    } catch (error) {
        logger.error(`Error updating search indexes for ${filename}:`, error);
        // Don't throw - search index errors shouldn't break metadata saving
    }
}

/**
 * Query search indexes for matching filenames
 */
async function searchFilesInDatabase(query, filenamesFilter = null, viewType = 'images') {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    try {
        const searchTerms = query.toLowerCase().trim().split(',').map(term => term.trim()).filter(term => term.length > 0);
        
        if (searchTerms.length === 0) {
            return [];
        }

        // Build filename filter condition
        let filenameFilterClause = '';
        let filenameParams = [];
        if (filenamesFilter && filenamesFilter.length > 0) {
            const placeholders = filenamesFilter.map(() => '?').join(',');
            filenameFilterClause = ` AND filename IN (${placeholders})`;
            filenameParams = filenamesFilter;
        }

        // For each search term, find matching files
        // We use AND logic - files must match ALL terms
        const matchingFiles = new Map();

        for (let termIndex = 0; termIndex < searchTerms.length; termIndex++) {
            const searchTerm = searchTerms[termIndex];
            const termFiles = new Set();

            // Search in tags
            const tagMatches = await db.all(`
                SELECT DISTINCT filename FROM search_tags
                WHERE tag LIKE ? ${filenameFilterClause}
            `, [`%${searchTerm}%`, ...filenameParams]);

            // Search in full text
            const fullTextMatches = await db.all(`
                SELECT DISTINCT filename FROM search_fulltext
                WHERE text_content LIKE ? ${filenameFilterClause}
            `, [`%${searchTerm}%`, ...filenameParams]);

            // Search in characters
            const characterMatches = await db.all(`
                SELECT DISTINCT filename FROM search_characters
                WHERE character_name LIKE ? ${filenameFilterClause}
            `, [`%${searchTerm}%`, ...filenameParams]);

            // Search in presets
            const presetMatches = await db.all(`
                SELECT DISTINCT filename FROM search_presets
                WHERE preset_name LIKE ? ${filenameFilterClause}
            `, [`%${searchTerm}%`, ...filenameParams]);

            // Search in models
            const modelMatches = await db.all(`
                SELECT DISTINCT filename FROM search_models
                WHERE model_name LIKE ? ${filenameFilterClause}
            `, [`%${searchTerm}%`, ...filenameParams]);

            // Collect all unique filenames that match this term
            [tagMatches, fullTextMatches, characterMatches, presetMatches, modelMatches].forEach(matches => {
                matches.forEach(row => termFiles.add(row.filename));
            });

            // If this is the first term, initialize matching files
            if (termIndex === 0) {
                termFiles.forEach(filename => {
                    matchingFiles.set(filename, { filename, matchScore: 0 });
                });
            } else {
                // For subsequent terms, only keep files that match ALL terms (AND condition)
                const currentMatchingFiles = new Set(matchingFiles.keys());
                for (const filename of currentMatchingFiles) {
                    if (!termFiles.has(filename)) {
                        matchingFiles.delete(filename);
                    }
                }
            }
        }

        // Calculate match scores for remaining files
        for (const [filename, fileResult] of matchingFiles) {
            let score = 0;

            // Get scores from all search terms
            for (const searchTerm of searchTerms) {
                // Tag matches
                const tagMatches = await db.all(`
                    SELECT SUM(weight) as totalWeight, COUNT(*) as count
                    FROM search_tags
                    WHERE filename = ? AND tag LIKE ?
                `, [filename, `%${searchTerm}%`]);

                if (tagMatches[0] && tagMatches[0].totalWeight) {
                    score += Math.abs(tagMatches[0].totalWeight) * 10 + (tagMatches[0].count * 2);
                }

                // Full text matches
                const fullTextMatches = await db.all(`
                    SELECT SUM(weight) as totalWeight, COUNT(*) as count
                    FROM search_fulltext
                    WHERE filename = ? AND text_content LIKE ?
                `, [filename, `%${searchTerm}%`]);

                if (fullTextMatches[0] && fullTextMatches[0].totalWeight) {
                    score += Math.abs(fullTextMatches[0].totalWeight) * 8 + (fullTextMatches[0].count * 2);
                }

                // Character matches (higher weight)
                const characterMatches = await db.all(`
                    SELECT COUNT(*) as count
                    FROM search_characters
                    WHERE filename = ? AND character_name LIKE ?
                `, [filename, `%${searchTerm}%`]);

                if (characterMatches[0] && characterMatches[0].count > 0) {
                    score += 15 * characterMatches[0].count;
                }

                // Preset matches
                const presetMatches = await db.all(`
                    SELECT COUNT(*) as count
                    FROM search_presets
                    WHERE filename = ? AND preset_name LIKE ?
                `, [filename, `%${searchTerm}%`]);

                if (presetMatches[0] && presetMatches[0].count > 0) {
                    score += 7 * presetMatches[0].count;
                }

                // Model matches
                const modelMatches = await db.all(`
                    SELECT COUNT(*) as count
                    FROM search_models
                    WHERE filename = ? AND model_name LIKE ?
                `, [filename, `%${searchTerm}%`]);

                if (modelMatches[0] && modelMatches[0].count > 0) {
                    score += 5 * modelMatches[0].count;
                }

                // Bonus for matching each term
                score += 5;
            }

            fileResult.matchScore = score;
        }

        // Sort by score and return
        return Array.from(matchingFiles.values()).sort((a, b) => b.matchScore - a.matchScore);

    } catch (error) {
        logger.error('Error searching files in database:', error);
        throw error;
    }
}

/**
 * Get tag suggestions from database
 */
async function getTagSuggestionsFromDatabase(query, filenamesFilter = null, limit = 20) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }

    try {
        const searchTerm = query.toLowerCase().trim();
        
        // Build filename filter condition
        let filenameFilterClause = '';
        let filenameParams = [];
        if (filenamesFilter && filenamesFilter.length > 0) {
            const placeholders = filenamesFilter.map(() => '?').join(',');
            filenameFilterClause = ` AND filename IN (${placeholders})`;
            filenameParams = filenamesFilter;
        }

        const suggestions = [];

        // Get tag suggestions
        if (searchTerm.length === 0) {
            // Empty query - get most popular tags
            const tagResults = await db.all(`
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
                const fileSamples = await db.all(`
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
            const tagResults = await db.all(`
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
                const fileSamples = await db.all(`
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
            const fullTextResults = await db.all(`
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
            const characterResults = await db.all(`
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
            const presetResults = await db.all(`
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

        // Sort all suggestions by occurrence count and weight
        suggestions.sort((a, b) => {
            if (b.occurrenceCount !== a.occurrenceCount) {
                return b.occurrenceCount - a.occurrenceCount;
            }
            return Math.abs(b.totalWeight) - Math.abs(a.totalWeight);
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
async function syncSearchIndexes(progressCallback = null) {
    try {
        if (!dbInitialized || !db) {
            throw new Error('Database not initialized');
        }

        // Find files that don't have search indexes yet
        // A file has indexes if it has at least one entry in any search table
        const filesWithoutIndexes = await db.all(`
            SELECT DISTINCT i.filename
            FROM images i
            LEFT JOIN search_tags st ON i.filename = st.filename
            LEFT JOIN search_fulltext sf ON i.filename = sf.filename
            LEFT JOIN search_characters sc ON i.filename = sc.filename
            LEFT JOIN search_presets sp ON i.filename = sp.filename
            LEFT JOIN search_models sm ON i.filename = sm.filename
            WHERE st.filename IS NULL 
                AND sf.filename IS NULL 
                AND sc.filename IS NULL 
                AND sp.filename IS NULL 
                AND sm.filename IS NULL
        `);

        const totalFiles = filesWithoutIndexes.length;

        if (totalFiles === 0) {
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

        console.log(`🔄 Syncing search indexes for ${totalFiles} files...`);

        let updatedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < filesWithoutIndexes.length; i++) {
            const { filename } = filesWithoutIndexes[i];
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
    getMultipleMetadata,
    addReceiptMetadata,
    addUnattributedReceipt,
    getUnattributedReceipts,
    migrateFromJSON,
    getDatabaseStats,
    updateFileMetadata,
    getAllFilenames,
    
    // Search index functions
    updateSearchIndexes,
    searchFilesInDatabase,
    getTagSuggestionsFromDatabase,
    syncSearchIndexes,
    rebuildSearchIndexes,
    setIndexingPaused,
    isIndexingPaused,

    // Checkpoint management - access through wrapper
    getCheckpointManager
};
