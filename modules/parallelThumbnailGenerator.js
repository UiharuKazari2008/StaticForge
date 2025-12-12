const { generateTinyThumbnailOnly } = require('./previewUtils');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// Worker thread code
if (!isMainThread) {
    const { imagePath, filename } = workerData;
    
    generateTinyThumbnailOnly(imagePath, filename)
        .then(thumbnail => {
            if (thumbnail) {
                parentPort.postMessage({ success: true, filename, thumbnail });
            } else {
                parentPort.postMessage({ success: false, filename, error: 'Failed to generate thumbnail' });
            }
        })
        .catch(error => {
            parentPort.postMessage({ success: false, filename, error: error.message });
        });
    return;
}

// Main thread code
class ParallelThumbnailGenerator {
    constructor(globalResources, options = {}) {
        this.globalResources = globalResources;
        this.metadataDatabase = globalResources.getMetadataDatabase();
        this.batchSize = options.batchSize || Math.min(os.cpus().length, 6); // Max 6 workers
        this.dbBatchSize = options.dbBatchSize || 250; // Database writes in batches of 250
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onError = options.onError || (() => {});
    }

    async generateThumbnailsForFiles(fileList, imagesDir) {
        console.log(`🔄 Starting parallel thumbnail generation with ${this.batchSize} workers...`);
        console.log(`📁 Processing ${fileList.length} images from ${imagesDir}`);
        
        let processed = 0;
        let errors = 0;
        const startTime = Date.now();
        
        // Buffer for batch database writes
        const thumbnailBuffer = [];
        
        // Process in batches
        for (let i = 0; i < fileList.length; i += this.batchSize) {
            const batch = fileList.slice(i, i + this.batchSize);
            
            const workers = batch.map(({ filename, filePath }) => {
                return new Promise((resolve) => {
                    const worker = new Worker(__filename, {
                        workerData: { imagePath: filePath, filename }
                    });
                    
                    worker.on('message', (message) => {
                        if (message.success) {
                            processed++;
                            // Store thumbnail data for batch write
                            thumbnailBuffer.push({
                                filename: message.filename,
                                thumbnail: message.thumbnail
                            });
                        } else {
                            errors++;
                            console.error(`❌ Failed: ${message.filename} - ${message.error}`);
                            this.onError(message.filename, message.error);
                        }
                        worker.terminate();
                        resolve();
                    });
                    
                    worker.on('error', (error) => {
                        errors++;
                        console.error(`❌ Worker error for ${filename}:`, error.message);
                        this.onError(filename, error.message);
                        worker.terminate();
                        resolve();
                    });
                });
            });
            
            // Wait for current batch to complete
            await Promise.all(workers);
            
            // Write to database in batches when buffer reaches threshold
            if (thumbnailBuffer.length >= this.dbBatchSize) {
                await this.flushThumbnailBuffer(thumbnailBuffer);
                thumbnailBuffer.length = 0; // Clear buffer
            }
            
            // Report progress
            const progress = Math.round((processed / fileList.length) * 100);
            this.onProgress(processed, fileList.length, progress);
            console.log(`📸 Progress: ${processed}/${fileList.length} (${progress}%)`);
        }
        
        // Flush remaining thumbnails
        if (thumbnailBuffer.length > 0) {
            await this.flushThumbnailBuffer(thumbnailBuffer);
        }
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        const results = {
            processed,
            errors,
            total: fileList.length,
            duration,
            imagesPerSecond: Math.round(fileList.length / duration)
        };
        
        console.log(`✅ Parallel thumbnail generation complete!`);
        console.log(`📊 Processed: ${processed} thumbnails`);
        console.log(`❌ Errors: ${errors} thumbnails`);
        console.log(`⏱️  Duration: ${duration.toFixed(2)}s`);
        console.log(`🚀 Speed: ${results.imagesPerSecond} thumbnails/second`);
        
        this.onComplete(results);
        return results;
    }

    async flushThumbnailBuffer(buffer) {
        if (buffer.length === 0) return;
        
        console.log(`💾 Writing ${buffer.length} thumbnails to database...`);
        const startTime = Date.now();
        
        try {
            // Use batch update function from metadata database
            if (this.metadataDatabase) {
                const result = await this.metadataDatabase.updateTinyThumbnailsBatch(buffer);
                const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                console.log(`✅ Wrote ${result.updated} thumbnails to database in ${duration}s${result.errors > 0 ? ` (${result.errors} errors)` : ''}`);
            } else {
                // Fallback to individual updates if batch function not available
                let updated = 0;
                let errors = 0;
                for (const { filename, thumbnail } of buffer) {
                    try {
                        await this.metadataDatabase.updateTinyThumbnail(filename, thumbnail);
                        updated++;
                    } catch (error) {
                        errors++;
                        console.error(`Error updating thumbnail for ${filename}:`, error.message);
                    }
                }
                const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                console.log(`✅ Wrote ${updated} thumbnails to database in ${duration}s${errors > 0 ? ` (${errors} errors)` : ''}`);
            }
        } catch (error) {
            console.error(`❌ Error writing thumbnails to database:`, error.message);
            throw error;
        }
    }
}

// Export for use in other modules
if (isMainThread) {
    module.exports = ParallelThumbnailGenerator;
}

