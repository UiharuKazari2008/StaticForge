const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// Import modules
const { 
    updateMetadata, 
    getBaseName
} = require('./pngMetadata');
const { 
    getImageDimensions
} = require('./imageTools');
const { generatePreview, generateBlurredPreview } = require('./previewUtils');

// Context object for dependency injection
let context = {};

// Set context for dependency injection
function setContext(newContext) {
    context = { ...newContext };
}

const imagesDir = path.resolve(__dirname, '../images');
const previewsDir = path.resolve(__dirname, '../.previews');

const upscaleImageCore = async (imageBuffer, scale = 4, width, height) => {
    const actualScale = scale === true ? 4 : scale;
    if (actualScale <= 1) {
        console.log('📏 No upscaling needed (scale <= 1)');
        return imageBuffer;
    }
    
    
    // Simple delay for upscaling requests (1 second)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
        try {
            const payload = {
                height,
                image: imageBuffer.toString('base64'),
                scale: actualScale,
                width
            };
            
            const postData = JSON.stringify(payload);
            const options = {
                hostname: 'api.novelai.net',
                port: 443,
                path: '/ai/upscale',
                method: 'POST',
                headers: {
                    "accept": "*/*",
                    "accept-language": "en-US,en;q=0.9,en-GB;q=0.8",
                    "authorization": `Bearer ${context.config.apiKey}`,
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(postData),
                    "priority": "u=1, i",
                    "dnt": "1",
                    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Microsoft Edge\";v=\"138\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"macOS\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-site",
                    "x-correlation-id": crypto.randomBytes(3).toString('hex').toUpperCase(),
                    "x-initiated-at": new Date().toISOString(),
                    "referer": "https://novelai.net/",
                    "origin": "https://novelai.net",
                    "sec-gpc": "1",
                    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0"
                }
            };
            
            const zipBuffer = await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    let data = [];
                    res.on('data', chunk => data.push(chunk));
                    res.on('end', () => {
                        const buffer = Buffer.concat(data);
                        if (res.statusCode === 200) {
                            resolve(buffer);
                        } else {
                            try {
                                const errorResponse = JSON.parse(buffer.toString());
                                reject(new Error(`Upscale API error: ${errorResponse.error || 'Unknown error'}`));
                            } catch (e) {
                                reject(new Error(`Upscale API error: HTTP ${res.statusCode}`));
                            }
                        }
                    });
                });
                
                req.on('error', error => {
                    console.error('❌ Upscale API request error:', error.message);
                    reject(error);
                });
                
                req.write(postData);
                req.end();
            });
            
            // Extract the first file from the ZIP
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(zipBuffer);
            const zipEntries = zip.getEntries();
            
            if (zipEntries.length === 0) {
                throw new Error('ZIP file is empty');
        }
        
            // Get the first file (should be the upscaled PNG)
            const firstEntry = zipEntries[0];
            
            const upscaledBuffer = firstEntry.getData();
        return upscaledBuffer;
    } catch (error) {
        console.error('❌ Upscaling failed:', error.message);
        return imageBuffer;
    }
};

// Main upscaling function
async function upscaleImage(filename, workspaceId, req, res) {
    // Check if user is read-only
    if (req.userType === 'readonly') {
        return res.status(403).json({ error: 'Non-Administrator Login: This operation is not allowed for read-only users' });
    }
    try {
        const filePath = path.join(imagesDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Read the image
        const imageBuffer = fs.readFileSync(filePath);
        
        // Get image dimensions
        const { width, height } = await getImageDimensions(imageBuffer);
        
        // Upscale the image
        const upscaledBuffer = await upscaleImageCore(imageBuffer, 4, width, height);
        
        // Add forge metadata for upscaled image
        const upscaledForgeData = {
            upscale_ratio: 4,
            upscaled_at: Date.now(),
            generation_type: 'upscaled'
        };
        const updatedUpscaledBuffer = updateMetadata(upscaledBuffer, upscaledForgeData);
        
        // Save upscaled image
        const upscaledFilename = filename.replace('.png', '_upscaled.png');
        const upscaledPath = path.join(imagesDir, upscaledFilename);
        fs.writeFileSync(upscaledPath, updatedUpscaledBuffer);
        console.log(`💾 Saved upscaled: ${upscaledFilename}`);

        // Add upscaled file to workspace
        const targetWorkspaceId = workspaceId || context.getActiveWorkspace(req.session?.id);
        context.addToWorkspaceArray('files', upscaledFilename, targetWorkspaceId);
        
        // Generate preview for the base image (if not exists)
        const baseName = getBaseName(filename);
        const previewFile = `${baseName}.jpg`
        const previewPath = path.join(previewsDir, previewFile);
        const blurPreviewFile = `${baseName}_blur.jpg`;
        const blurPreviewPath = path.join(previewsDir, blurPreviewFile);
        
        if (!fs.existsSync(previewPath)) {
            await generatePreview(upscaledPath, previewPath);
            console.log(`📸 Generated preview: ${previewFile}`);
        }
        if (!fs.existsSync(blurPreviewPath)) {
            await generateBlurredPreview(upscaledPath, blurPreviewPath);
            console.log(`📸 Generated blurred preview: ${blurPreviewFile}`);
        }
        
        // Return the upscaled image
        res.setHeader('Content-Type', 'image/png');
        res.send(updatedUpscaledBuffer);
        
    } catch (error) {
        console.error('Upscaling error:', error);
        res.status(500).json({ error: error.message });
    }
}

// WebSocket-native upscaling function
async function upscaleImageWebSocket(filename, workspaceId, userType, sessionId) {
    // Check if user is read-only
    if (userType === 'readonly') {
        throw new Error('Non-Administrator Login: This operation is not allowed for read-only users');
    }
    
    try {
        const filePath = path.join(imagesDir, filename);
        
        if (!fs.existsSync(filePath)) {
            throw new Error('Image not found');
        }
        
        // Read the image
        const imageBuffer = fs.readFileSync(filePath);
        
        // Get image dimensions
        const { width, height } = await getImageDimensions(imageBuffer);
        
        // Upscale the image
        const upscaledBuffer = await upscaleImageCore(imageBuffer, 4, width, height);
        
        // Add forge metadata for upscaled image
        const upscaledForgeData = {
            upscale_ratio: 4,
            upscaled_at: Date.now(),
            generation_type: 'upscaled'
        };
        const updatedUpscaledBuffer = updateMetadata(upscaledBuffer, upscaledForgeData);
        
        // Save upscaled image
        const upscaledFilename = filename.replace('.png', '_upscaled.png');
        const upscaledPath = path.join(imagesDir, upscaledFilename);
        fs.writeFileSync(upscaledPath, updatedUpscaledBuffer);
        console.log(`💾 Saved upscaled: ${upscaledFilename}`);

        // Add upscaled file to workspace
        const targetWorkspaceId = workspaceId || context.getActiveWorkspace(sessionId);
        context.addToWorkspaceArray('files', upscaledFilename, targetWorkspaceId);
        
        // Generate preview for the base image (if not exists)
        const baseName = getBaseName(filename);
        const previewFile = `${baseName}.jpg`
        const previewPath = path.join(previewsDir, previewFile);
        const blurPreviewFile = `${baseName}_blur.jpg`;
        const blurPreviewPath = path.join(previewsDir, blurPreviewFile);
        
        if (!fs.existsSync(previewPath)) {
            await generatePreview(upscaledPath, previewPath);
            console.log(`📸 Generated preview: ${previewFile}`);
        }
        if (!fs.existsSync(blurPreviewPath)) {
            await generateBlurredPreview(upscaledPath, blurPreviewPath);
            console.log(`📸 Generated blurred preview: ${blurPreviewFile}`);
        }
        
        // Return the result object instead of sending HTTP response
        return {
            buffer: updatedUpscaledBuffer,
            filename: upscaledFilename,
            width: width * 4,
            height: height * 4
        };
        
    } catch (error) {
        console.error('WebSocket upscaling error:', error);
        throw error;
    }
}

module.exports = {
    upscaleImage,
    upscaleImageWebSocket,
    upscaleImageCore,
    setContext
};
