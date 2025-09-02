const sharp = require('sharp');
const path = require('path');

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
    try {
        const mainPreviewPath = path.join(path.dirname(imagePath), '..', '.previews', `${basename}.jpg`);
        const retinaPreviewPath = path.join(path.dirname(imagePath), '..', '.previews', `${basename}@2x.jpg`);
        
        // Generate main preview (256x256)
        await sharp(imagePath)
            .resize(256, 256, { fit: 'cover' })
            .jpeg({ quality: 70 })
            .toFile(mainPreviewPath);
        
        // Generate @2x preview (512x512) for high-DPI displays
        await sharp(imagePath)
            .resize(512, 512, { fit: 'cover' })
            .jpeg({ quality: 70 })
            .toFile(retinaPreviewPath);
        
        return true;
    } catch (e) {
        console.error('Failed to generate mobile previews for', imagePath, e.message);
        return false;
    }
}

module.exports = {
    generatePreview,
    generateBlurredPreview,
    generateMobilePreviews
};
