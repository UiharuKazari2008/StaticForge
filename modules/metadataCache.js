const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { extractNovelAIMetadata } = require('./pngMetadata');
const { getGlobalWsServer } = require('./websocket');
const { isImageLarge } = require('./imageTools');

// Metadata cache structure
let metadataCache = {
    images: {},
    unattributed_receipts: []
};

// Cache file path
const metadataCacheFile = path.join(__dirname, '..', '.cache', 'metadata.json');

// Ensure cache directory exists
const cacheDir = path.dirname(metadataCacheFile);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

/**
 * Load metadata cache from file
 */
function loadMetadataCache() {
    try {
        if (fs.existsSync(metadataCacheFile)) {
            const data = fs.readFileSync(metadataCacheFile, 'utf8');
            metadataCache = JSON.parse(data);
            console.log(`✅ Loaded metadata cache with ${Object.keys(metadataCache.images).length} images`);
        } else {
            console.log('📝 Creating new metadata cache');
            metadataCache = { images: {}, unattributed_receipts: [] };
        }
    } catch (error) {
        console.error('❌ Error loading metadata cache:', error.message);
        metadataCache = { images: {}, unattributed_receipts: [] };
    }
}

/**
 * Save metadata cache to file atomically
 */
async function saveMetadataCache() {
    const tempFile = `${metadataCacheFile}.tmp`;
    
    try {
        // Write to temporary file first
        fs.writeFileSync(tempFile, JSON.stringify(metadataCache, null, 2));
        
        // Delete old file if it exists
        if (fs.existsSync(metadataCacheFile)) {
            fs.unlinkSync(metadataCacheFile);
        }
        
        // Rename temp file to final name
        fs.renameSync(tempFile, metadataCacheFile);
        
        console.log(`💾 Metadata cache saved atomically (${Object.keys(metadataCache.images).length} images)`);
    } catch (error) {
        console.error('❌ Error saving metadata cache:', error.message);
        
        // Clean up temp file if it exists
        if (fs.existsSync(tempFile)) {
            try {
                fs.unlinkSync(tempFile);
            } catch (cleanupError) {
                console.error('❌ Error cleaning up temp metadata cache file:', cleanupError.message);
            }
        }
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
    const filePath = path.join(imagesDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ File not found: ${filePath}`);
        return null;
    }
    
    // Check if we already have cached metadata
    if (metadataCache.images[filename]) {
        const cached = metadataCache.images[filename];
        
        // Verify the cached MD5 matches the current file
        const currentMD5 = generateMD5(filePath);
        if (currentMD5 === cached.md5) {
            return cached;
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
    const pngMetadata = extractNovelAIMetadata(filePath);
    
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
        receipt: [], // Will be populated by generation functions
        size: stats.size,
        mtime: stats.mtime.valueOf(),
        metadata: pngMetadata || {} // PNG embedded metadata (forge_data, prompts, etc.)
    };
    
    // Cache the metadata
    metadataCache.images[filename] = metadata;
    
    return metadata;
}

/**
 * Scan all images and update missing metadata
 */
async function scanAndUpdateMetadata(imagesDir) {
    try {
        console.log('🔍 Scanning images for missing metadata...');
        
        const names = Object.keys(metadataCache.images);
        const files = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i)).filter(f => !names.includes(f));
        let updatedCount = 0;
        let errorCount = 0;
        
        for (const filename of files) {
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
        
        // Save cache after scanning
        saveMetadataCache();
        
        return { updatedCount, errorCount, totalFiles: files.length };
    } catch (error) {
        console.error('❌ Error scanning metadata:', error.message);
        return { updatedCount: 0, errorCount: 1, totalFiles: 0 };
    }
}

/**
 * Add receipt data to image metadata
 */
async function addReceipt(filename, receiptData) {
    if (!metadataCache.images[filename]) {
        console.warn(`⚠️ No metadata found for ${filename}, cannot add receipt`);
        return false;
    }
    
    metadataCache.images[filename].receipt.push({
        timestamp: Date.now(),
        ...receiptData
    });
    
    return true;
}

/**
 * Remove metadata for deleted images and merge receipts
 */
async function removeImageMetadata(filenames) {
    let removedCount = 0;
    
    for (const filename of filenames) {
        if (metadataCache.images[filename]) {
            // Extract receipts before deletion
            const imageMetadata = metadataCache.images[filename];
            if (imageMetadata.receipt && imageMetadata.receipt.length > 0) {
                // Merge receipts into unattributed receipts
                for (const receipt of imageMetadata.receipt) {
                    metadataCache.unattributed_receipts.push(receipt);
                }
                console.log(`📝 Merged ${imageMetadata.receipt.length} receipts from deleted file: ${filename}`);
            }
            
            delete metadataCache.images[filename];
            removedCount++;
        }
    }
    
    if (removedCount > 0) {
        console.log(`🗑️ Removed metadata for ${removedCount} images`);
        saveMetadataCache();
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
    
    metadataCache.unattributed_receipts.push(receipt);
    
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
    return metadataCache.unattributed_receipts || [];
}

/**
 * Get metadata for a specific image
 */
function getCachedMetadata(filename) {
    return metadataCache.images[filename] || null;
}

/**
 * Get all cached metadata
 */
function getImagesMetadata() {
    return metadataCache.images || {};
}

/**
 * Get all cached metadata
 */
function getAllMetadata() {
    return metadataCache.images;
}

/**
 * Get metadata for multiple images
 */
function getMultipleMetadata(filenames) {
    const result = {};
    
    for (const filename of filenames) {
        if (metadataCache.images[filename]) {
            result[filename] = metadataCache.images[filename];
        }
    }
    
    return result;
}

/**
 * Update metadata for an image (e.g., after generation)
 */
async function addReceiptMetadata(filename, imagesDir, receiptData = null) {
    const metadata = await getImageMetadata(filename, imagesDir);
    
    if (metadata && receiptData) {
        addReceipt(filename, receiptData);
        saveMetadataCache();
    }
    
    return metadata;
}

(async () => {
    // Initialize metadata cache
    try {
        // Initialize cache on module load
        await loadMetadataCache();
        // Scan for missing metadata on startup
        const imagesDir = path.resolve(__dirname, '..', 'images');
        await scanAndUpdateMetadata(imagesDir);
    } catch (error) {
        console.error('❌ Error initializing metadata cache:', error.message);
        process.exit(1);
    }
})();


module.exports = {
    loadMetadataCache,
    saveMetadataCache,
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
    broadcastReceiptNotification
}; 