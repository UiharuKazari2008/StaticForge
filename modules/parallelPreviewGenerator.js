const { generateMobilePreviews } = require('./previewUtils');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// Worker thread code
if (!isMainThread) {
    const { imagePath, basename, skipExisting } = workerData;
    
    // Check if previews already exist and skip if requested
    if (skipExisting) {
        const previewsDir = path.resolve(__dirname, '../.previews');
        const previewTypes = ['.webp', '@2x.webp', '@lq.webp', '@blur.webp'];
        const allExist = previewTypes.every(type => {
            const previewPath = path.join(previewsDir, `${basename}${type}`);
            return fs.existsSync(previewPath);
        });
        
        if (allExist) {
            parentPort.postMessage({ success: true, basename, skipped: true });
            return;
        }
    }
    
    generateMobilePreviews(imagePath, basename)
        .then(result => {
            parentPort.postMessage({ success: true, basename, result });
        })
        .catch(error => {
            parentPort.postMessage({ success: false, basename, error: error.message });
        });
    return;
}

// Main thread code
class ParallelPreviewGenerator {
    constructor(globalResources, options = {}) {
        this.globalResources = globalResources;
        this.batchSize = options.batchSize || Math.min(os.cpus().length, 6); // Max 6 workers
        this.skipExisting = options.skipExisting || false;
        this.forceRegenerate = options.forceRegenerate || false;
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onError = options.onError || (() => {});
    }

    async generatePreviewsForImages(imageFiles, imagesDir, previewsDir) {
        console.log(`🔄 Starting parallel preview generation with ${this.batchSize} workers...`);
        console.log(`📁 Processing ${imageFiles.length} images from ${imagesDir}`);
        
        let processed = 0;
        let skipped = 0;
        let errors = 0;
        const startTime = Date.now();
        
        // Process in batches
        for (let i = 0; i < imageFiles.length; i += this.batchSize) {
            const batch = imageFiles.slice(i, i + this.batchSize);
            
            const workers = batch.map(imageFile => {
                const imagePath = path.join(imagesDir, imageFile);
                const basename = this.globalResources.getPngMetadata().getBaseName(imageFile);
                
                // Remove existing previews if force regenerate
                if (this.forceRegenerate) {
                    const previewTypes = ['.webp', '@2x.webp', '@lq.webp', '@blur.webp'];
                    for (const type of previewTypes) {
                        const previewPath = path.join(previewsDir, `${basename}${type}`);
                        if (fs.existsSync(previewPath)) {
                            fs.unlinkSync(previewPath);
                        }
                    }
                }
                
                return new Promise((resolve) => {
                    const worker = new Worker(__filename, {
                        workerData: { imagePath, basename, skipExisting: this.skipExisting }
                    });
                    
                    worker.on('message', (message) => {
                        if (message.success) {
                            if (message.skipped) {
                                skipped++;
                                console.log(`⏭️  Skipped: ${message.basename} (already exists)`);
                            } else {
                                processed++;
                                console.log(`✅ Processed: ${message.basename} (${processed + skipped}/${imageFiles.length})`);
                            }
                        } else {
                            errors++;
                            console.error(`❌ Failed: ${message.basename} - ${message.error}`);
                            this.onError(message.basename, message.error);
                        }
                        worker.terminate();
                        resolve();
                    });
                    
                    worker.on('error', (error) => {
                        errors++;
                        console.error(`❌ Worker error for ${basename}:`, error.message);
                        this.onError(basename, error.message);
                        worker.terminate();
                        resolve();
                    });
                });
            });
            
            // Wait for current batch to complete
            await Promise.all(workers);
            
            // Report progress
            const totalProcessed = processed + skipped;
            const progress = Math.round((totalProcessed / imageFiles.length) * 100);
            this.onProgress(totalProcessed, imageFiles.length, progress);
            console.log(`📸 Progress: ${totalProcessed}/${imageFiles.length} (${progress}%)`);
        }
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        const results = {
            processed,
            skipped,
            errors,
            total: imageFiles.length,
            duration,
            imagesPerSecond: Math.round(imageFiles.length / duration)
        };
        
        console.log(`✅ Parallel preview generation complete!`);
        console.log(`📊 Processed: ${processed} images`);
        console.log(`⏭️  Skipped: ${skipped} images`);
        console.log(`❌ Errors: ${errors} images`);
        console.log(`⏱️  Duration: ${duration.toFixed(2)}s`);
        console.log(`🚀 Speed: ${results.imagesPerSecond} images/second`);
        
        this.onComplete(results);
        return results;
    }

    async generateAllPreviews(options = {}) {
        const imagesDir = path.resolve('./images');
        const previewsDir = path.resolve('./.previews');
        
        // Ensure previews directory exists
        if (!fs.existsSync(previewsDir)) {
            fs.mkdirSync(previewsDir, { recursive: true });
        }
        
        // Get all image files
        const imageFiles = fs.readdirSync(imagesDir).filter(file => 
            /\.(png|jpg|jpeg|webp)$/i.test(file) && !file.includes('_upscaled')
        );
        
        if (imageFiles.length === 0) {
            console.log('No images found to process');
            return { processed: 0, skipped: 0, errors: 0, total: 0, duration: 0, imagesPerSecond: 0 };
        }
        
        return await this.generatePreviewsForImages(imageFiles, imagesDir, previewsDir);
    }

    async generatePreviewsForNewImages() {
        const imagesDir = path.resolve('./images');
        const previewsDir = path.resolve('./.previews');
        
        // Get all image files
        const imageFiles = fs.readdirSync(imagesDir).filter(file => 
            /\.(png|jpg|jpeg|webp)$/i.test(file) && !file.includes('_upscaled')
        );
        
        // Filter to only images without previews
        const imagesNeedingPreviews = imageFiles.filter(imageFile => {
            const basename = this.globalResources.getPngMetadata().getBaseName(imageFile);
            const previewTypes = ['.webp', '@2x.webp', '@lq.webp', '@blur.webp'];
            return !previewTypes.every(type => {
                const previewPath = path.join(previewsDir, `${basename}${type}`);
                return fs.existsSync(previewPath);
            });
        });
        
        if (imagesNeedingPreviews.length === 0) {
            console.log('All images already have previews');
            return { processed: 0, skipped: 0, errors: 0, total: 0, duration: 0, imagesPerSecond: 0 };
        }
        
        console.log(`Found ${imagesNeedingPreviews.length} images needing previews`);
        return await this.generatePreviewsForImages(imagesNeedingPreviews, imagesDir, previewsDir);
    }
}

// Export for use in other modules
if (isMainThread) {
    module.exports = ParallelPreviewGenerator;
    
    // CLI usage
    if (require.main === module) {
        const args = process.argv.slice(2);
        const options = {
            batchSize: parseInt(args.find(arg => arg.startsWith('--workers='))?.split('=')[1]) || Math.min(os.cpus().length, 6),
            skipExisting: args.includes('--skip-existing'),
            forceRegenerate: args.includes('--force')
        };
        
        const generator = new ParallelPreviewGenerator(options);
        
        if (args.includes('--new-only')) {
            generator.generatePreviewsForNewImages().catch(console.error);
        } else {
            generator.generateAllPreviews().catch(console.error);
        }
    }
}
