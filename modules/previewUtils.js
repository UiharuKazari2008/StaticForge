const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Generate a preview for an image
async function generatePreview(imagePath, previewPath) {
    try {
        await sharp(imagePath)
            .resize(256, 256, { fit: 'cover' })
            .jpeg({ quality: 70 })
            .toFile(previewPath);
        return true;
    } catch (e) {
        console.error('Failed to generate preview for', imagePath, e.message);
        return false;
    }
}

// Generate a blurred background preview for an image
async function generateBlurredPreview(imagePath, blurPreviewPath) {
    try {
        await sharp(imagePath)
            .resize(128, 128, { fit: 'cover' })
            .blur(10) // Heavy blur effect
            .jpeg({ quality: 60 })
            .toFile(blurPreviewPath);
        return true;
    } catch (e) {
        console.error('Failed to generate blurred preview for', imagePath, e.message);
        return false;
    }
}

// Generate both main and @2x previews for mobile devices
async function generateMobilePreviews(imagePath, basename) {
    // Input validation
    if (!imagePath || !basename) {
        console.error('generateMobilePreviews: Missing required parameters');
        return false;
    }

    // Check if source image exists
    if (!fs.existsSync(imagePath)) {
        console.error('generateMobilePreviews: Source image does not exist:', imagePath);
        return false;
    }

    try {
        // Use consistent path resolution with web_server.js
        const previewsDir = path.resolve(__dirname, '../.previews');

        const mainPreviewPath = path.join(previewsDir, `${basename}.webp`);
        const retinaPreviewPath = path.join(previewsDir, `${basename}@2x.webp`);
        const lowQualityPreviewPath = path.join(previewsDir, `${basename}@lq.webp`);
        const blurPreviewPath = path.join(previewsDir, `${basename}@blur.webp`);
        
        // Get image metadata to determine aspect ratio
        const metadata = await sharp(imagePath).metadata();
        const { width, height } = metadata;
        
        if (!width || !height) {
            console.error('generateMobilePreviews: Invalid image metadata for', imagePath);
            return false;
        }
        
        // Calculate dimensions for 128px max while maintaining aspect ratio
        let newWidth, newHeight;
        // Landscape: width is the limiting factor
        // Portrait or square: height is the limiting factor
        if (width > height) {
            newWidth = 128;
            newHeight = Math.round((height * 128) / width);
        } else {
            newHeight = 128;
            newWidth = Math.round((width * 128) / height);
        }
        
        // Create a single Sharp instance with optimized settings
        const image = sharp(imagePath, {
            failOnError: false,
            unlimited: true,
            sequentialRead: true,
            density: 72
        });
        
        // Define quality settings centrally - optimized for speed
        const qualitySettings = {
            high: { quality: 70, effort: 4 },    // Reduced from 80/6
            medium: { quality: 50, effort: 3 },  // Reduced from 60/4
            low: { quality: 40, effort: 2 }      // Reduced from 50/4
        };
        
        const commonWebPOptions = {
            smartSubsample: true,
            reductionEffort: 3  // Reduced from 6 for faster processing
        };
        
        const commonResizeOptions = {
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3,
            fastShrinkOnLoad: true
        };
        
        // Process all 4 previews with optimized pipelines
        // Use sequential processing to reduce memory usage instead of cloning
        const previewPromises = [
            // @2x preview (512px max) - high-DPI displays with aspect ratio preserved
            image.clone()
                .resize(512, 512, { 
                    fit: 'cover', 
                    ...commonResizeOptions
                })
                .webp({ 
                    ...qualitySettings.high,
                    ...commonWebPOptions
                })
                .toFile(retinaPreviewPath),

            // Main preview (256px max) - square for gallery thumbnails
            image.clone()
                .resize(256, 256, { 
                    fit: 'cover', 
                    ...commonResizeOptions
                })
                .webp({ 
                    ...qualitySettings.high,
                    ...commonWebPOptions
                })
                .toFile(mainPreviewPath),
            
            // @lq preview - correct aspect ratio for PhotoSwipe placeholders
            image.clone()
                .resize(newWidth, newHeight, { 
                    fit: 'inside', 
                    ...commonResizeOptions
                })
                .webp({ 
                    ...qualitySettings.low,
                    ...commonWebPOptions
                })
                .toFile(lowQualityPreviewPath),
            
            // @blur preview - blurred background
            image.clone()
                .resize(128, 128, { 
                    fit: 'cover', 
                    ...commonResizeOptions
                })
                .blur(10)
                .webp({ 
                    ...qualitySettings.medium,
                    ...commonWebPOptions
                })
                .toFile(blurPreviewPath)
        ];
        
        // Wait for all previews to complete in parallel with error handling
        const results = await Promise.allSettled(previewPromises);
        
        // Check for any failures and log them
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length > 0) {
            console.error(`Failed to generate ${failures.length} previews for ${basename}:`, 
                failures.map(f => f.reason?.message || 'Unknown error').join(', '));
            return false;
        }

        return true;
    } catch (e) {
        console.error('Failed to generate mobile previews for', imagePath, ':', e.message);
        return false;
    }
}



module.exports = {
    generatePreview,
    generateBlurredPreview,
    generateMobilePreviews
};
