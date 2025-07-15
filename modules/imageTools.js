const sharp = require('sharp');
const { createCanvas, loadImage } = require('canvas');

const inverseDimensionsMap = {
    "small_portrait": "512x768",
    "small_landscape": "768x512", 
    "small_square": "640x640",
    "normal_portrait": "832x1216",
    "normal_landscape": "1216x832",
    "normal_square": "1024x1024",
    "large_portrait": "1024x1536",
    "large_landscape": "1536x1024",
    "large_square": "1472x1472",
    "wallpaper_portrait": "1088x1920",
    "wallpaper_landscape": "1920x1088"
};
// Dimensions mapping for resolution names
const dimensionsMap = {
    "512x768": "small_portrait",
    "768x512": "small_landscape", 
    "640x640": "small_square",
    "832x1216": "normal_portrait",
    "1216x832": "normal_landscape",
    "1024x1024": "normal_square",
    "1024x1536": "large_portrait",
    "1536x1024": "large_landscape",
    "1472x1472": "large_square",
    "1088x1920": "wallpaper_portrait",
    "1920x1088": "wallpaper_landscape"
};

// Utility functions
const getImageDimensions = async buffer => {
    try {
        const metadata = await sharp(buffer).metadata();
        return { width: metadata.width, height: metadata.height };
    } catch (error) {
        throw new Error('Failed to get image dimensions: ' + error.message);
    }
};

// Utility: Get image dimensions using Canvas (replaces Sharp metadata)
async function getImageDimensionsWithCanvas(imageBuffer) {
    try {
        if (!imageBuffer) {
            throw new Error('Image buffer is required');
        }
        
        const img = await loadImage(imageBuffer);
        
        if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
            throw new Error(`Invalid image dimensions: ${img.width}x${img.height}`);
        }
        
        return { width: img.width, height: img.height };
    } catch (error) {
        throw new Error(`Failed to get image dimensions: ${error.message}`);
    }
}

// Helper: Get resolution name from dimensions
function getResolutionFromDimensions(width, height) {
    const key = `${width}x${height}`;
    return dimensionsMap[key] || null;
}

// Helper: Get dimensions from resolution name
function getDimensionsFromResolution(resolution) {
    const [width, height] = inverseDimensionsMap[resolution]?.split('x').map(Number);
    if (width && height) {
        return { width, height };
    }
}

// Helper: For upscaled images, try to match original resolution
function matchOriginalResolution(meta, presets) {
    if (!meta || !meta.width || !meta.height) return null;
    // If upscaled, divide by 4
    const origWidth = Math.round(meta.width / 4);
    const origHeight = Math.round(meta.height / 4);
    // Try to match to a preset
    for (const [presetName, preset] of Object.entries(presets)) {
        if (preset.width === origWidth && preset.height === origHeight) {
            return presetName;
        }
    }
    return null;
}

// Enhanced processImageToResolutionWithBias to handle dynamic bias adjustments and legacy behavior
async function processDynamicImage(imageBuffer, targetDims, bias = 2) {
    if (!targetDims || !targetDims.width || !targetDims.height) {
        throw new Error('Target dimensions are required');
    }

    // Check if bias is a dynamic bias object
    if (typeof bias === 'object' && bias.x !== undefined) {
        // Use Canvas for dynamic bias processing (same as client-side)
        const origDims = await getImageDimensionsWithCanvas(imageBuffer);
        
        // Create canvas for processing
        const canvas = createCanvas(targetDims.width, targetDims.height);
        const ctx = canvas.getContext('2d');
        
        // Load the original image
        const img = await loadImage(imageBuffer);
        
        // Calculate how to fill the canvas while maintaining aspect ratio
        const imageAR = origDims.width / origDims.height;
        const targetAR = targetDims.width / targetDims.height;
        
        let drawWidth, drawHeight, drawX, drawY;
        
        if (imageAR > targetAR) {
            // Image is wider than target, scale to match target height
            drawHeight = targetDims.height;
            drawWidth = targetDims.height * imageAR;
            // Position at top-left corner, not centered
            drawX = 0;
            drawY = 0;
        } else {
            // Image is taller than target, scale to match target width
            drawWidth = targetDims.width;
            drawHeight = targetDims.width / imageAR;
            // Position at top-left corner, not centered
            drawX = 0;
            drawY = 0;
        }
        
        // Apply bias transformations - all referenced to top-left
        ctx.save();
        
        // Apply position offset (absolute pixels, not affected by scale)
        ctx.translate(bias.x, bias.y);
        
        // Apply rotation around top-left corner (0,0)
        ctx.rotate((bias.rotate * Math.PI) / 180);
        
        // Apply scale from top-left corner
        ctx.scale(bias.scale, bias.scale);
        
        // Draw the image to fill the canvas (like object-fit: cover)
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
        
        ctx.restore();
        
        return canvas.toBuffer('image/png');
    } else {
        // Legacy bias handling (0-4 integer) - use Sharp for better performance
        const metadata = await sharp(imageBuffer).metadata();
        const origDims = { width: metadata.width, height: metadata.height };
        const origAR = origDims.width / origDims.height;
        const targetAR = targetDims.width / targetDims.height;

        let sharpInstance = sharp(imageBuffer);

        if (Math.abs(origAR - targetAR) > 0.01) {
            // Aspect ratios don't match, crop is needed.
            let cropWidth, cropHeight;

            if (origAR > targetAR) {
                // Original is wider, crop width
                cropHeight = origDims.height;
                cropWidth = Math.round(origDims.height * targetAR);
            } else {
                // Original is taller, crop height
                cropWidth = origDims.width;
                cropHeight = Math.round(origDims.width / targetAR);
            }
            
            const biasFractions = [0, 0.25, 0.5, 0.75, 1];
            const biasFrac = biasFractions[bias] !== undefined ? biasFractions[bias] : 0.5;

            const cropLeft = Math.round((origDims.width - cropWidth) * (origAR > targetAR ? biasFrac : 0));
            const cropTop = Math.round((origDims.height - cropHeight) * (origAR > targetAR ? 0 : biasFrac));
            
            sharpInstance = sharpInstance.extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight });
        }

        return sharpInstance
            .resize(targetDims.width, targetDims.height, { fit: 'fill' })
            .png() // Ensure output is PNG
            .toBuffer();
    }
}

// Utility: Resize mask using Canvas (replaces Sharp operations)
async function resizeMaskWithCanvas(maskBuffer, targetWidth, targetHeight) {
    // Validate input parameters
    if (!maskBuffer || !targetWidth || !targetHeight) {
        throw new Error('Invalid parameters: maskBuffer, targetWidth, and targetHeight are required');
    }
    
    if (targetWidth <= 0 || targetHeight <= 0) {
        throw new Error(`Invalid target dimensions: ${targetWidth}x${targetHeight}`);
    }
    
    try {
        const img = await loadImage(maskBuffer);
        
        // Validate loaded image dimensions
        if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
            throw new Error(`Invalid image dimensions: ${img.width}x${img.height}`);
        }
        
        const canvas = createCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
    
    // Fill with black background
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    
    // Disable image smoothing for nearest neighbor scaling (same as client-side)
    ctx.imageSmoothingEnabled = false;
    
    // Draw the mask image, stretched to fit
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    
    // Binarize to ensure only black/white (same logic as client-side)
    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        
        // If pixel is not black (has been drawn on), make it pure white
        if (r > 0 || g > 0 || b > 0) {
            data[i] = 255;     // Red
            data[i + 1] = 255; // Green
            data[i + 2] = 255; // Blue
            data[i + 3] = 255; // Alpha
        } else {
            // Black pixels (background) stay pure black
            data[i] = 0;       // Red
            data[i + 1] = 0;   // Green
            data[i + 2] = 0;   // Blue
            data[i + 3] = 255; // Alpha
        }
    }
    ctx.putImageData(imageData, 0, 0);
    
    return canvas.toBuffer('image/png');
    } catch (error) {
        throw new Error(`Failed to resize mask: ${error.message}`);
    }
}

// Utility: Generate and pad mask in one operation
async function generateAndPadMask(maskInput, targetDims, maskBias = 2) {
    // targetDims: {width, height}, maskBias: 0-4 (left/top to right/bottom)
    if (!targetDims || !targetDims.width || !targetDims.height) {
        throw new Error('Target dimensions are required');
    }
    
    let maskBuffer;
    let origDims;
    
    if (Array.isArray(maskInput)) {
        // Coordinates array [x, y, width, height] - generate at target resolution directly
        const canvas = createCanvas(targetDims.width, targetDims.height);
        const ctx = canvas.getContext('2d');
        
        // Fill black background
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, targetDims.width, targetDims.height);
        
        // Draw white rectangle if coordinates provided
        if (maskInput && maskInput.length === 4) {
            const [x, y, w, h] = maskInput;
            ctx.fillStyle = 'white';
            ctx.fillRect(x, y, w, h);
        }
        
        maskBuffer = canvas.toBuffer('image/png');
        origDims = { width: targetDims.width, height: targetDims.height };
        
    } else if (typeof maskInput === 'string') {
        // Base64 encoded image
        try {
            maskBuffer = Buffer.from(maskInput, 'base64');
            origDims = await getImageDimensionsWithCanvas(maskBuffer);
            
            // Validate dimensions
            if (!origDims || !origDims.width || !origDims.height || origDims.width <= 0 || origDims.height <= 0) {
                throw new Error(`Invalid mask image dimensions: ${origDims?.width}x${origDims?.height}`);
            }
        } catch (error) {
            throw new Error(`Failed to process mask image: ${error.message}`);
        }
        
        // Check if dimensions already match target (with small tolerance for floating point)
        if (Math.abs(origDims.width - targetDims.width) < 1 && Math.abs(origDims.height - targetDims.height) < 1) {
            // Dimensions match exactly, return the original base64 string without processing
            return maskInput; // Return the original base64 string, not a buffer
        }
        
        // Load the mask image
        const img = await loadImage(maskBuffer);
        
        // Validate loaded image
        if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
            throw new Error(`Invalid loaded mask image dimensions: ${img.width}x${img.height}`);
        }
        
        // Calculate aspect ratios
        const origAR = origDims.width / origDims.height;
        const targetAR = targetDims.width / targetDims.height;
        
        // Create canvas at target dimensions
        const canvas = createCanvas(targetDims.width, targetDims.height);
        const ctx = canvas.getContext('2d');
        
        // Fill black background
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, targetDims.width, targetDims.height);
        
        // Disable image smoothing for nearest neighbor scaling (same as client-side)
        ctx.imageSmoothingEnabled = false;
        
        if (Math.abs(origAR - targetAR) < 0.01) {
            // Aspect ratios match, just resize
            ctx.drawImage(img, 0, 0, targetDims.width, targetDims.height);
        } else {
            // Aspect ratios don't match, need padding
            let padLeft = 0, padRight = 0, padTop = 0, padBottom = 0;
            
            if (origAR > targetAR) {
                // Pad top/bottom
                const newHeight = Math.round(origDims.width / targetAR);
                const padTotal = newHeight - origDims.height;
                const biasFrac = [0, 0.25, 0.5, 0.75, 1][maskBias] || 0.5;
                padTop = Math.floor(padTotal * biasFrac);
                padBottom = padTotal - padTop;
            } else {
                // Pad left/right
                const newWidth = Math.round(origDims.height * targetAR);
                const padTotal = newWidth - origDims.width;
                const biasFrac = [0, 0.25, 0.5, 0.75, 1][maskBias] || 0.5;
                padLeft = Math.floor(padTotal * biasFrac);
                padRight = padTotal - padLeft;
            }
            
            // Draw mask with padding
            ctx.drawImage(img, padLeft, padTop, origDims.width, origDims.height);
        }
        
        // Binarize to ensure only black/white (same logic as client-side)
        const imageData = ctx.getImageData(0, 0, targetDims.width, targetDims.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            
            // If pixel is not black (has been drawn on), make it pure white
            if (r > 0 || g > 0 || b > 0) {
                data[i] = 255;     // Red
                data[i + 1] = 255; // Green
                data[i + 2] = 255; // Blue
                data[i + 3] = 255; // Alpha
            } else {
                // Black pixels (background) stay pure black
                data[i] = 0;       // Red
                data[i + 1] = 0;   // Green
                data[i + 2] = 0;   // Blue
                data[i + 3] = 255; // Alpha
            }
        }
        ctx.putImageData(imageData, 0, 0);
        
        maskBuffer = canvas.toBuffer('image/png');
    } else {
        throw new Error('Mask must be either an array of coordinates or base64 encoded image');
    }
    
    return maskBuffer;
}

module.exports = {
    getImageDimensions,
    getResolutionFromDimensions,
    getDimensionsFromResolution,
    matchOriginalResolution,
    processDynamicImage,
    getImageDimensionsWithCanvas,
    resizeMaskWithCanvas,
    generateAndPadMask
};