const sharp = require('sharp');

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
            .blur(20) // Heavy blur effect
            .jpeg({ quality: 60 })
            .toFile(blurPreviewPath);
        return true;
    } catch (e) {
        console.error('Failed to generate blurred preview for', imagePath, e.message);
        return false;
    }
}

module.exports = {
    generatePreview,
    generateBlurredPreview
};
