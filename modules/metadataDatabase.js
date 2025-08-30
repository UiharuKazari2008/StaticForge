const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { extractNovelAIMetadata, updateMetadata } = require('./pngMetadata');
const { getGlobalWsServer } = require('./websocket');
const { isImageLarge } = require('./imageTools');

// Database file path
const dbPath = path.join(__dirname, '..', '.cache', 'metadata.db');

// Ensure cache directory exists
const cacheDir = path.dirname(dbPath);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

let db = null;

/**
 * Initialize the SQLite database
 */
function initializeDatabase() {
    try {
        // Open database (creates if doesn't exist)
        db = new Database(dbPath);
        
        // Enable WAL mode for better concurrency
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = 10000');
        db.pragma('temp_store = MEMORY');
        
        // Create tables if they don't exist
        createTables();
        
        console.log('✅ SQLite metadata database initialized');
        return true;
    } catch (error) {
        console.error('❌ Error initializing SQLite database:', error.message);
        return false;
    }
}

/**
 * Create database tables
 */
function createTables() {
    // Images table
    db.exec(`
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
    db.exec(`
        CREATE TABLE IF NOT EXISTS receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER,
            timestamp INTEGER,
            receipt_data TEXT, -- JSON string for receipt data
            FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE
        )
    `);
    
    // Unattributed receipts table
    db.exec(`
        CREATE TABLE IF NOT EXISTS unattributed_receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date INTEGER,
            receipt_data TEXT, -- JSON string for receipt data
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);
    
    // Create indexes for better performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_images_filename ON images (filename);
        CREATE INDEX IF NOT EXISTS idx_images_md5 ON images (md5);
        CREATE INDEX IF NOT EXISTS idx_images_parent ON images (parent);
        CREATE INDEX IF NOT EXISTS idx_receipts_image_id ON receipts (image_id);
        CREATE INDEX IF NOT EXISTS idx_receipts_timestamp ON receipts (timestamp);
    `);
    
    console.log('✅ Database tables created/verified');
}

/**
 * Close database connection
 */
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        console.log('✅ Database connection closed');
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
        const stmt = db.prepare('SELECT * FROM images WHERE filename = ?');
        const existing = stmt.get(filename);
        
        if (existing) {
            // Verify the cached MD5 matches the current file
            const currentMD5 = generateMD5(filePath);
            if (currentMD5 === existing.md5) {
                // Get receipts for this image
                const receiptStmt = db.prepare('SELECT receipt_data FROM receipts WHERE image_id = ? ORDER BY timestamp');
                const receipts = receiptStmt.all(existing.id);
                
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
        let pngMetadata = null;
        try {
            pngMetadata = extractNovelAIMetadata(filePath);
        } catch (error) {
            console.error(`❌ Error extracting PNG metadata for ${filename}:`, error.message);
            pngMetadata = {};
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
            metadata: pngMetadata || {}
        };
        
        // Insert or update in database
        if (existing) {
            const updateStmt = db.prepare(`
                UPDATE images 
                SET md5 = ?, width = ?, height = ?, parent = ?, upscaled = ?, 
                    size = ?, mtime = ?, metadata = ?, updated_at = (strftime('%s', 'now'))
                WHERE filename = ?
            `);
            updateStmt.run(
                md5, imageMetadata.width, imageMetadata.height, 
                relationships.parent, relationships.isUpscaled ? 1 : 0,
                stats.size, stats.mtime.valueOf(), 
                JSON.stringify(pngMetadata || {}), filename
            );
        } else {
            const insertStmt = db.prepare(`
                INSERT INTO images (filename, md5, width, height, parent, upscaled, size, mtime, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            insertStmt.run(
                filename, md5, imageMetadata.width, imageMetadata.height,
                relationships.parent, relationships.isUpscaled ? 1 : 0,
                stats.size, stats.mtime.valueOf(), JSON.stringify(pngMetadata || {})
            );
        }
        
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
        const stmt = db.prepare('SELECT filename FROM images');
        const existingFiles = stmt.all().map(row => row.filename);
        
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
 * Add receipt data to image metadata
 */
async function addReceipt(filename, receiptData) {
    const stmt = db.prepare('SELECT id FROM images WHERE filename = ?');
    const image = stmt.get(filename);
    
    if (!image) {
        console.warn(`⚠️ No metadata found for ${filename}, cannot add receipt`);
        return false;
    }
    
    const receiptStmt = db.prepare(`
        INSERT INTO receipts (image_id, timestamp, receipt_data)
        VALUES (?, ?, ?)
    `);
    
    receiptStmt.run(image.id, Date.now(), JSON.stringify(receiptData));
    
    return true;
}

/**
 * Remove metadata for deleted images and merge receipts
 */
async function removeImageMetadata(filenames) {
    let removedCount = 0;
    
    for (const filename of filenames) {
        const stmt = db.prepare('SELECT id FROM images WHERE filename = ?');
        const image = stmt.get(filename);
        
        if (image) {
            // Extract receipts before deletion
            const receiptStmt = db.prepare('SELECT receipt_data FROM receipts WHERE image_id = ?');
            const receipts = receiptStmt.all(image.id);
            
            if (receipts.length > 0) {
                // Merge receipts into unattributed receipts
                const unattributedStmt = db.prepare(`
                    INSERT INTO unattributed_receipts (date, receipt_data)
                    VALUES (?, ?)
                `);
                
                for (const receipt of receipts) {
                    unattributedStmt.run(Date.now(), receipt.receipt_data);
                }
                console.log(`📝 Merged ${receipts.length} receipts from deleted file: ${filename}`);
            }
            
            // Delete the image and its receipts (CASCADE will handle receipts)
            const deleteStmt = db.prepare('DELETE FROM images WHERE filename = ?');
            deleteStmt.run(filename);
            
            removedCount++;
        }
    }
    
    if (removedCount > 0) {
        console.log(`🗑️ Removed metadata for ${removedCount} images`);
    }
    
    return removedCount;
}

/**
 * Add unattributed receipt
 */
async function addUnattributedReceipt(receiptData) {
    const receipt = {
        date: Date.now().valueOf(),
        ...receiptData
    };
    
    const stmt = db.prepare(`
        INSERT INTO unattributed_receipts (date, receipt_data)
        VALUES (?, ?)
    `);
    
    stmt.run(receipt.date, JSON.stringify(receiptData));
    
    // Broadcast receipt notification
    broadcastReceiptNotification(receipt);
    
    return receipt;
}

/**
 * Broadcast receipt notification via WebSocket
 */
async function broadcastReceiptNotification(receipt) {
    try {
        const wsServer = getGlobalWsServer();
        if (wsServer) {
            const message = {
                type: 'receipt_notification',
                receipt: receipt
            };
            wsServer.broadcast(message);
        }
    } catch (error) {
        console.error('❌ Error broadcasting receipt notification:', error.message);
    }
}

/**
 * Get all unattributed receipts
 */
function getUnattributedReceipts() {
    const stmt = db.prepare('SELECT * FROM unattributed_receipts ORDER BY date DESC');
    const receipts = stmt.all();
    
    return receipts.map(r => ({
        ...JSON.parse(r.receipt_data),
        date: r.date,
        id: r.id
    }));
}

/**
 * Get metadata for a specific image
 */
function getCachedMetadata(filename) {
    if (!dbInitialized || !db) {
        throw new Error('Database not initialized');
    }
    const stmt = db.prepare('SELECT * FROM images WHERE filename = ?');
    const image = stmt.get(filename);
    
    if (!image) return null;
    
    // Get receipts for this image
    const receiptStmt = db.prepare('SELECT receipt_data FROM receipts WHERE image_id = ? ORDER BY timestamp');
    const receipts = receiptStmt.all(image.id);
    
    return {
        ...image,
        receipt: receipts.map(r => JSON.parse(r.receipt_data)),
        metadata: image.metadata ? JSON.parse(image.metadata) : {},
        upscaled: Boolean(image.upscaled)
    };
}

/**
 * Get all cached metadata
 */
function getImagesMetadata() {
    const stmt = db.prepare('SELECT * FROM images ORDER BY filename');
    const images = stmt.all();
    
    const result = {};
    for (const image of images) {
        // Get receipts for this image
        const receiptStmt = db.prepare('SELECT receipt_data FROM receipts WHERE image_id = ? ORDER BY timestamp');
        const receipts = receiptStmt.all(image.id);
        
        result[image.filename] = {
            ...image,
            receipt: receipts.map(r => JSON.parse(r.receipt_data)),
            metadata: image.metadata ? JSON.parse(image.metadata) : {},
            upscaled: Boolean(image.upscaled)
        };
    }
    
    return result;
}

/**
 * Get all cached metadata
 */
function getAllMetadata() {
    return getImagesMetadata();
}

/**
 * Get metadata for multiple images
 */
function getMultipleMetadata(filenames) {
    const result = {};
    
    for (const filename of filenames) {
        const metadata = getCachedMetadata(filename);
        if (metadata) {
            result[filename] = metadata;
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
        addReceipt(filename, receiptData);
    }
    
    // If forge data is provided, also update the file and database metadata
    if (metadata && forgeData) {
        await updateFileMetadata(filename, imagesDir, forgeData);
    }
    
    return metadata;
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
        const updatedBuffer = updateMetadata(imageBuffer, forgeData);
        
        // Write the updated buffer back to the file
        fs.writeFileSync(filePath, updatedBuffer);
        
        // Update the database metadata as well
        const stmt = db.prepare('SELECT id FROM images WHERE filename = ?');
        const image = stmt.get(filename);
        
        if (image) {
            // Get existing metadata from database
            const existingMetadata = db.prepare('SELECT metadata FROM images WHERE filename = ?').get(filename);
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
            const updateStmt = db.prepare(`
                UPDATE images 
                SET metadata = ?, updated_at = (strftime('%s', 'now'))
                WHERE filename = ?
            `);
            updateStmt.run(JSON.stringify(currentMetadata), filename);
            
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
        
        // Begin transaction
        const transaction = db.transaction(() => {
            // Migrate images
            if (jsonData.images) {
                const insertImageStmt = db.prepare(`
                    INSERT OR REPLACE INTO images (filename, md5, width, height, parent, upscaled, size, mtime, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                for (const [filename, imageData] of Object.entries(jsonData.images)) {
                    insertImageStmt.run(
                        filename,
                        imageData.md5 || '',
                        imageData.width || 0,
                        imageData.height || 0,
                        imageData.parent || null,
                        imageData.upscaled ? 1 : 0,
                        imageData.size || 0,
                        imageData.mtime || 0,
                        JSON.stringify(imageData.metadata || {})
                    );
                    
                    // Migrate receipts
                    if (imageData.receipt && Array.isArray(imageData.receipt)) {
                        const imageId = db.prepare('SELECT id FROM images WHERE filename = ?').get(filename).id;
                        const insertReceiptStmt = db.prepare(`
                            INSERT INTO receipts (image_id, timestamp, receipt_data)
                            VALUES (?, ?, ?)
                        `);
                        
                        for (const receipt of imageData.receipt) {
                            insertReceiptStmt.run(
                                imageId,
                                receipt.timestamp || Date.now(),
                                JSON.stringify(receipt)
                            );
                        }
                    }
                }
            }
            
            // Migrate unattributed receipts
            if (jsonData.unattributed_receipts && Array.isArray(jsonData.unattributed_receipts)) {
                const insertUnattributedStmt = db.prepare(`
                    INSERT INTO unattributed_receipts (date, receipt_data)
                    VALUES (?, ?)
                `);
                
                for (const receipt of jsonData.unattributed_receipts) {
                    insertUnattributedStmt.run(
                        receipt.date || Date.now(),
                        JSON.stringify(receipt)
                    );
                }
            }
        });
        
        transaction();
        
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
function getDatabaseStats() {
    try {
        const imageCount = db.prepare('SELECT COUNT(*) as count FROM images').get().count;
        const receiptCount = db.prepare('SELECT COUNT(*) as count FROM receipts').get().count;
        const unattributedCount = db.prepare('SELECT COUNT(*) as count FROM unattributed_receipts').get().count;
        
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

// Initialize database on module load
let dbInitialized = false;
try {
    dbInitialized = initializeDatabase();
    if (!dbInitialized) {
        throw new Error('Failed to initialize database');
    }
    console.log('✅ Metadata database module ready');
} catch (error) {
    console.error('❌ Failed to initialize metadata database:', error.message);
    process.exit(1);
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
    addReceipt,
    removeImageMetadata,
    getCachedMetadata,
    getAllMetadata,
    getImagesMetadata,
    getMultipleMetadata,
    addReceiptMetadata,
    addUnattributedReceipt,
    getUnattributedReceipts,
    broadcastReceiptNotification,
    migrateFromJSON,
    getDatabaseStats,
    updateFileMetadata
};
