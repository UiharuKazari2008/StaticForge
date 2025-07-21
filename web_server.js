const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const { NovelAI, Model, Action, Sampler, Noise, Resolution, calculateCost } = require('nekoai-js');
const config = require('./config.json');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const multer = require('multer');
const crypto = require('crypto');

// Import modules
const { authMiddleware } = require('./modules/auth');
const { loadPromptConfig, applyTextReplacements, getUsedReplacements } = require('./modules/textReplacements');
const { getPresetCacheKey, getCachedPreset, setCachedPreset, getCacheStatus } = require('./modules/cache');
const { queueMiddleware, getStatus: getQueueStatus } = require('./modules/queue');
const { 
    extractNovelAIMetadata, 
    readMetadata,
    updateMetadata, 
    stripPngTextChunks, 
    extractRelevantFields, 
    getModelDisplayName,
    getBaseName
} = require('./modules/pngMetadata');
const { 
    getImageDimensions, 
    getDimensionsFromResolution, 
    matchOriginalResolution, 
    processDynamicImage, 
    resizeMaskWithCanvas, 
    generateAndPadMask,
} = require('./modules/imageTools');
const { 
    initializeWorkspaces,
    getWorkspaces,
    getWorkspace,
    createWorkspace,
    renameWorkspace,
    updateWorkspaceColor,
    updateWorkspaceBackgroundColor,
    updateWorkspaceBackgroundImage,
    updateWorkspaceBackgroundOpacity,
    deleteWorkspace,
    dumpWorkspace,
    moveFilesToWorkspace,
    getActiveWorkspace,
    setActiveWorkspace,
    getActiveWorkspaceFiles,
    addToWorkspaceArray,
    removeFromWorkspaceArray,
    moveToWorkspaceArray,
    getActiveWorkspaceCacheFiles,
    removeFilesFromWorkspaces,
    getActiveWorkspaceScraps,
    syncWorkspaceFiles,
    getWorkspacesData,
    getActiveWorkspaceData
} = require('./modules/workspace');
const imageCounter = require('./modules/imageCounter');

console.log(config);

// Initialize NovelAI client
const client = new NovelAI({ 
    token: config.apiKey,
    timeout: 100000,
    verbose: true
 });

// Create Express app
const app = express();
app.use(express.json({limit: '100mb'}));
app.use(cookieParser());
app.use(session({
    secret: config.sessionSecret || 'staticforge-very-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Create cache directories
const cacheDir = path.resolve(__dirname, '.cache');
const uploadCacheDir = path.join(cacheDir, 'upload');
const previewCacheDir = path.join(cacheDir, 'preview');
const vibeCacheDir = path.join(cacheDir, 'vibe');
const vibeOrigCacheDir = path.join(cacheDir, 'vibe_orig');
const imagesDir = path.resolve(__dirname, 'images');
const previewsDir = path.resolve(__dirname, '.previews');

// Ensure cache directories exist
[uploadCacheDir, previewCacheDir, vibeCacheDir, vibeOrigCacheDir, imagesDir, previewsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const cacheFile = path.join(cacheDir, 'tag_cache.json');

// Initialize workspace system
initializeWorkspaces();

// Public routes (no authentication required)
app.get('/', (req, res) => {
    // Check if user is authenticated via session
    if (req.session && req.session.authenticated) {
        res.redirect('/app');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// App route (requires authentication)
app.get('/app', (req, res) => {
    if (req.session && req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'public', 'app.html'));
    } else {
        res.redirect('/');
    }
});

// Login endpoint
app.post('/login', express.json(), (req, res) => {
    const { pin } = req.body;
    if (!pin) {
        return res.status(400).json({ error: 'PIN code is required' });
    }
    if (pin === config.loginPin) {
        req.session.authenticated = true;
        res.json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({ error: 'Invalid PIN code' });
    }
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// Serve static files from public directory
app.use(express.static('public'));
app.use('/cache', express.static(cacheDir));


// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, imagesDir);
    },
    filename: function (req, file, cb) {
        // Generate a unique filename with timestamp
        const timestamp = Date.now();
        const randomSeed = Math.floor(Math.random() * 1000000000);
        const extension = path.extname(file.originalname);
        const filename = `${timestamp}_uploaded_${randomSeed}${extension}`;
        cb(null, filename);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Only allow image files
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 10MB limit
    }
});

// Multer for base image uploads (to memory)
const cacheUpload = multer({ storage: multer.memoryStorage() });

// Helper: get preview filename
function getPreviewFilename(baseName) {
    return `${baseName}.jpg`;
}

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

// On startup: generate missing previews and clean up orphans
async function syncPreviews() {
    const files = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
    const previews = fs.readdirSync(previewsDir).filter(f => f.endsWith('.jpg'));
    const baseMap = {};
    // Pair originals and upscales
    for (const file of files) {
        const base = getBaseName(file);
        if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null, pipeline: null, pipeline_upscaled: null };
        if (file.includes('_pipeline_upscaled')) baseMap[base].pipeline_upscaled = file;
        else if (file.includes('_pipeline')) baseMap[base].pipeline = file;
        else if (file.includes('_upscaled')) baseMap[base].upscaled = file;
        else baseMap[base].original = file;
    }
    // Generate missing previews
    for (const base in baseMap) {
        const previewFile = getPreviewFilename(base);
        const previewPath = path.join(previewsDir, previewFile);
        if (!fs.existsSync(previewPath)) {
            // Prefer pipeline_upscaled, then pipeline, then upscaled, then original
            const imgFile = baseMap[base].pipeline_upscaled || baseMap[base].pipeline || baseMap[base].upscaled || baseMap[base].original;
            if (imgFile) {
                const imgPath = path.join(imagesDir, imgFile);
                await generatePreview(imgPath, previewPath);
            }
        }
    }
    // Remove orphan previews
    for (const preview of previews) {
        const base = preview.replace(/\.jpg$/, '');
        if (!baseMap[base]) {
            fs.unlinkSync(path.join(previewsDir, preview));
        }
    }
}

// Call on startup
syncPreviews();

// Direct NovelAI vibe encoding function
async function encodeVibeDirect(imageBase64, informationExtracted, model) {
    const correlationId = crypto.randomBytes(3).toString('hex').toUpperCase();
    const body = {
        image: imageBase64,
        model: model || "nai-diffusion-4-5-curated",
        information_extracted: informationExtracted || 1
    };
    
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(body);
        
        const options = {
            hostname: 'image.novelai.net',
            port: 443,
            path: '/ai/encode-vibe',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
                'x-correlation-id': correlationId,
                'x-initiated-at': new Date().toISOString(),
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = https.request(options, (res) => {
            let data = [];
            
            res.on('data', chunk => data.push(chunk));
            
            res.on('end', () => {
                const buffer = Buffer.concat(data);
                
                if (res.statusCode === 200) {
                    // Return the buffer as base64 string
                    resolve(buffer.toString('base64'));
                } else {
                    try {
                        const errorResponse = JSON.parse(buffer.toString());
                        reject(new Error(`Error encoding vibe: ${errorResponse.statusCode || res.statusCode} ${errorResponse.message || 'Unknown error'}`));
                    } catch (e) {
                        reject(new Error(`Error encoding vibe: HTTP ${res.statusCode}`));
                    }
                }
            });
        });
        
        req.on('error', (error) => {
            error.correlationId = correlationId;
            console.error('Vibe encoding error:', error);
            reject(error);
        });
        
        req.write(postData);
        req.end();
    });
}

// Updated /images endpoint with workspace filtering
app.get('/images', async (req, res) => {
    try {
        // Check if scraps are requested
        const isScraps = req.query.scraps === 'true';
        
        let files;
        if (isScraps) {
            // Get scraps for active workspace (includes default + active workspace)
            files = getActiveWorkspaceScraps();
        } else {
            // Get files for active workspace (includes default + active workspace)
            const workspaceFiles = getActiveWorkspaceFiles();
            files = workspaceFiles;
        }
        
        const baseMap = {};
        for (const file of files) {
            const base = getBaseName(file);
            if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null, pipeline: null, pipeline_upscaled: null };
            if (file.includes('_pipeline_upscaled')) baseMap[base].pipeline_upscaled = file;
            else if (file.includes('_pipeline')) baseMap[base].pipeline = file;
            else if (file.includes('_upscaled')) baseMap[base].upscaled = file;
            else baseMap[base].original = file;
        }
        const gallery = [];
        for (const base in baseMap) {
            const { original, upscaled, pipeline, pipeline_upscaled } = baseMap[base];
            // Prefer pipeline_upscaled, then pipeline, then upscaled, then original
            const file = pipeline_upscaled || pipeline || upscaled || original;
            if (!file) continue;
            const filePath = path.join(imagesDir, file);
            // Check if file exists before trying to get stats
            try {
                const stats = fs.statSync(filePath);
                const preview = getPreviewFilename(base);
                gallery.push({
                    base,
                    original,
                    upscaled,
                    pipeline,
                    pipeline_upscaled,
                    preview,
                    mtime: stats.mtime,
                    size: stats.size
                });
            } catch (error) {
                // File doesn't exist, skip it (it will be cleaned up by syncWorkspaceFiles)
                console.warn(`Skipping non-existent file: ${file}`);
                continue;
            }
        }
        // Sort by newest first
        gallery.sort((a, b) => b.mtime - a.mtime);
        res.json(gallery);
    } catch (error) {
        console.error('Error reading images directory:', error);
        res.status(500).json({ error: 'Failed to load images' });
    }
});

// GET /images/all (get all images without workspace filtering)
app.get('/images/all', async (req, res) => {
    try {
        // Get all image files from the images directory
        const allFiles = fs.readdirSync(imagesDir)
            .filter(f => f.match(/\.(png|jpg|jpeg)$/i))
            .filter(f => !f.startsWith('.'));
        
        const baseMap = {};
        for (const file of allFiles) {
            const base = getBaseName(file);
            if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null, pipeline: null, pipeline_upscaled: null };
            if (file.includes('_pipeline_upscaled')) baseMap[base].pipeline_upscaled = file;
            else if (file.includes('_pipeline')) baseMap[base].pipeline = file;
            else if (file.includes('_upscaled')) baseMap[base].upscaled = file;
            else baseMap[base].original = file;
        }
        const gallery = [];
        for (const base in baseMap) {
            const { original, upscaled, pipeline, pipeline_upscaled } = baseMap[base];
            // Prefer pipeline_upscaled, then pipeline, then upscaled, then original
            const file = pipeline_upscaled || pipeline || upscaled || original;
            if (!file) continue;
            const filePath = path.join(imagesDir, file);
            const stats = fs.statSync(filePath);
            const preview = getPreviewFilename(base);
            gallery.push({
                base,
                original,
                upscaled,
                pipeline,
                pipeline_upscaled,
                preview,
                mtime: stats.mtime,
                size: stats.size
            });
        }
        // Sort by newest first
        gallery.sort((a, b) => b.mtime - a.mtime);
        res.json(gallery);
    } catch (error) {
        console.error('Error reading all images directory:', error);
        res.status(500).json({ error: 'Failed to load all images' });
    }
});

// DELETE /images/bulk (bulk delete multiple images)
app.delete('/images/bulk', authMiddleware, async (req, res) => {
    try {
        const { filenames } = req.body;

        if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
            return res.status(400).json({ error: 'Filenames array is required' });
        }

        const results = [];
        const errors = [];

        for (const filename of filenames) {
            try {
                const filePath = path.join(imagesDir, filename);

                if (!fs.existsSync(filePath)) {
                    errors.push({ filename, error: 'File not found' });
                    continue;
                }

                // Get the base name to find related files
                const baseName = getBaseName(filename);
                const previewFile = getPreviewFilename(baseName);
                const previewPath = path.join(previewsDir, previewFile);

                // Always delete both the base and upscaled version
                const filesToDelete = [];
                const filenamesToRemoveFromWorkspaces = [];

                // Determine base/original and upscaled filenames
                let originalFilename, upscaledFilename;
                if (filename.includes('_upscaled')) {
                    upscaledFilename = filename;
                    originalFilename = filename.replace('_upscaled.png', '.png');
                } else {
                    originalFilename = filename;
                    upscaledFilename = filename.replace('.png', '_upscaled.png');
                }

                // Add original file if exists
                const originalPath = path.join(imagesDir, originalFilename);
                if (fs.existsSync(originalPath)) {
                    filesToDelete.push({ path: originalPath, type: 'original' });
                    filenamesToRemoveFromWorkspaces.push(originalFilename);
                }

                // Add upscaled file if exists
                const upscaledPath = path.join(imagesDir, upscaledFilename);
                if (fs.existsSync(upscaledPath)) {
                    filesToDelete.push({ path: upscaledPath, type: 'upscaled' });
                    filenamesToRemoveFromWorkspaces.push(upscaledFilename);
                }

                // Also handle pipeline and pipeline_upscaled variants
                const pipelineFilename = baseName + '_pipeline.png';
                const pipelineUpscaledFilename = baseName + '_pipeline_upscaled.png';
                const pipelinePath = path.join(imagesDir, pipelineFilename);
                const pipelineUpscaledPath = path.join(imagesDir, pipelineUpscaledFilename);

                if (fs.existsSync(pipelinePath)) {
                    filesToDelete.push({ path: pipelinePath, type: 'pipeline' });
                    filenamesToRemoveFromWorkspaces.push(pipelineFilename);
                }
                if (fs.existsSync(pipelineUpscaledPath)) {
                    filesToDelete.push({ path: pipelineUpscaledPath, type: 'pipeline_upscaled' });
                    filenamesToRemoveFromWorkspaces.push(pipelineUpscaledFilename);
                }

                // Add the preview file
                if (fs.existsSync(previewPath)) {
                    filesToDelete.push({ path: previewPath, type: 'preview' });
                }

                // Remove files from workspaces first
                if (filenamesToRemoveFromWorkspaces.length > 0) {
                    removeFilesFromWorkspaces(filenamesToRemoveFromWorkspaces);
                }

                // Delete all related files
                const deletedFiles = [];
                for (const file of filesToDelete) {
                    try {
                        fs.unlinkSync(file.path);
                        deletedFiles.push(file.type);
                    } catch (error) {
                        console.error(`Failed to delete ${file.type}: ${path.basename(file.path)}`, error.message);
                    }
                }

                results.push({ filename, deletedFiles });
                console.log(`🗑️ Bulk deleted: ${filename} (${deletedFiles.join(', ')})`);

            } catch (error) {
                errors.push({ filename, error: error.message });
            }
        }

        // Sync workspace files to remove any remaining references to deleted files
        syncWorkspaceFiles();

        console.log(`✅ Bulk delete completed: ${results.length} successful, ${errors.length} failed`);
        res.json({
            success: true,
            message: `Bulk delete completed`,
            results: results,
            errors: errors,
            totalProcessed: filenames.length,
            successful: results.length,
            failed: errors.length
        });

    } catch (error) {
        console.error('Bulk delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /images/bulk/preset (bulk update preset names for multiple images)
app.put('/images/bulk/preset', authMiddleware, async (req, res) => {
    try {
        const { filenames, presetName } = req.body;

        if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
            return res.status(400).json({ error: 'Filenames array is required' });
        }

        const results = [];
        const errors = [];

        for (const filename of filenames) {
            try {
                const filePath = path.join(imagesDir, filename);

                if (!fs.existsSync(filePath)) {
                    errors.push({ filename, error: 'File not found' });
                    continue;
                }

                // Read the current image and extract metadata
                const imageBuffer = fs.readFileSync(filePath);
                const metadata = readMetadata(imageBuffer);

                if (!metadata) {
                    errors.push({ filename, error: 'Failed to read metadata' });
                    continue;
                }

                // Update the preset name in the metadata
                if (!metadata.forge_data) {
                    metadata.forge_data = {};
                }

                if (presetName === null || presetName === '') {
                    // Remove preset name
                    delete metadata.forge_data.preset_name;
                } else {
                    // Set new preset name
                    metadata.forge_data.preset_name = presetName;
                }

                // Update the image with new metadata
                const updatedImageBuffer = updateMetadata(imageBuffer, metadata.forge_data);

                // Write the updated image back to disk
                fs.writeFileSync(filePath, updatedImageBuffer);

                results.push({ filename, presetName: presetName || 'removed' });
                console.log(`✏️ Updated preset name for ${filename}: ${presetName || 'removed'}`);

            } catch (error) {
                errors.push({ filename, error: error.message });
                console.error(`Failed to update preset name for ${filename}:`, error);
            }
        }

        console.log(`✅ Bulk preset update completed: ${results.length} successful, ${errors.length} failed`);
        res.json({
            success: true,
            message: `Bulk preset update completed`,
            results: results,
            errors: errors,
            totalProcessed: filenames.length,
            updatedCount: results.length,
            failed: errors.length
        });

    } catch (error) {
        console.error('Bulk preset update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /images/send-to-sequenzia (move selected images to sequenzia folder)
app.post('/images/send-to-sequenzia', authMiddleware, async (req, res) => {
    try {
        const { filenames } = req.body;
        
        if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
            return res.status(400).json({ error: 'Filenames array is required' });
        }
        
        // Check if sequenzia folder is configured
        if (!config.sequenziaFolder) {
            return res.status(500).json({ error: 'Sequenzia folder not configured in config.json' });
        }
        
        // Create sequenzia folder if it doesn't exist
        if (!fs.existsSync(config.sequenziaFolder)) {
            try {
                fs.mkdirSync(config.sequenziaFolder, { recursive: true });
                console.log(`📁 Created sequenzia folder: ${config.sequenziaFolder}`);
            } catch (error) {
                return res.status(500).json({ error: `Failed to create sequenzia folder: ${error.message}` });
            }
        }
        
        const results = [];
        const errors = [];
        
        for (const filename of filenames) {
            try {
                const sourcePath = path.join(imagesDir, filename);
                
                if (!fs.existsSync(sourcePath)) {
                    errors.push({ filename, error: 'File not found' });
                    continue;
                }
                
                // Get the base name to find related files
                const baseName = getBaseName(filename);
                const previewFile = getPreviewFilename(baseName);
                const previewPath = path.join(previewsDir, previewFile);
                
                // Determine which files to move and which to delete
                const filesToMove = [];
                const filesToDelete = [];
                const filenamesToRemoveFromWorkspaces = [];
                
                // Check if there's an upscaled version - if so, only move that and delete the base
                if (filename.includes('_upscaled')) {
                    // This is an upscaled file, move it and delete the base
                    filesToMove.push({ source: sourcePath, type: 'upscaled' });
                    
                    // Find and delete the base version
                    const baseFilename = filename.replace('_upscaled.png', '.png');
                    const basePath = path.join(imagesDir, baseFilename);
                    if (fs.existsSync(basePath)) {
                        filesToDelete.push({ path: basePath, type: 'base' });
                        filenamesToRemoveFromWorkspaces.push(baseFilename);
                    }
                } else {
                    // This is a base file, check if there's an upscaled version
                    const upscaledFilename = filename.replace('.png', '_upscaled.png');
                    const upscaledPath = path.join(imagesDir, upscaledFilename);
                    
                    if (fs.existsSync(upscaledPath)) {
                        // Move the upscaled version instead of the base
                        filesToMove.push({ source: upscaledPath, type: 'upscaled' });
                        // Delete the base version
                        filesToDelete.push({ path: sourcePath, type: 'base' });
                        filenamesToRemoveFromWorkspaces.push(filename);
                    } else {
                        // No upscaled version, move the base
                        filesToMove.push({ source: sourcePath, type: 'base' });
                        filenamesToRemoveFromWorkspaces.push(filename);
                    }
                }
                
                // Add preview to delete list
                if (fs.existsSync(previewPath)) {
                    filesToDelete.push({ path: previewPath, type: 'preview' });
                }
                
                // Remove files from workspaces first
                if (filenamesToRemoveFromWorkspaces.length > 0) {
                    removeFilesFromWorkspaces(filenamesToRemoveFromWorkspaces);
                }
                
                // Move files to sequenzia folder
                const movedFiles = [];
                for (const file of filesToMove) {
                    try {
                        const destPath = path.join(config.sequenziaFolder, path.basename(file.source));
                        fs.copyFileSync(file.source, destPath);
                        movedFiles.push(file.type);
                        console.log(`📁 Moved to sequenzia: ${path.basename(file.source)}`);
                    } catch (error) {
                        console.error(`Failed to move ${file.type}: ${path.basename(file.source)}`, error.message);
                    }
                }
                
                // Delete files from original location
                const deletedFiles = [];
                for (const file of filesToDelete) {
                    try {
                        fs.unlinkSync(file.path);
                        deletedFiles.push(file.type);
                    } catch (error) {
                        console.error(`Failed to delete ${file.type}: ${path.basename(file.path)}`, error.message);
                    }
                }
                
                results.push({ filename, movedFiles, deletedFiles });
                console.log(`✅ Sent to sequenzia: ${filename} (moved: ${movedFiles.join(', ')}, deleted: ${deletedFiles.join(', ')})`);
                
            } catch (error) {
                errors.push({ filename, error: error.message });
            }
        }
        
        // Sync workspace files to remove any remaining references to deleted files
        syncWorkspaceFiles();
        
        console.log(`✅ Send to sequenzia completed: ${results.length} successful, ${errors.length} failed`);
        res.json({ 
            success: true, 
            message: `Images sent to sequenzia successfully`,
            results: results,
            errors: errors,
            totalProcessed: filenames.length,
            successful: results.length,
            failed: errors.length
        });
        
    } catch (error) {
        console.error('Send to sequenzia error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /previews/:preview (serve preview images)
app.get('/previews/:preview', (req, res) => {
    const previewFile = req.params.preview;
    const previewPath = path.join(previewsDir, previewFile);
    if (!fs.existsSync(previewPath)) {
        return res.status(404).json({ error: 'Preview not found' });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(previewFile, { root: previewsDir });
});

// POST /images/:filename/upscale (upscale an image)
app.post('/images/:filename/upscale', authMiddleware, async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(imagesDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Read the image
        const imageBuffer = fs.readFileSync(filePath);
        
        // Get image dimensions
        const { width, height } = await getImageDimensions(imageBuffer);
        
        // Upscale the image
        const upscaledBuffer = await upscaleImage(imageBuffer, 4, width, height);
        
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
        
        // Generate preview for the base image (if not exists)
        const baseName = getBaseName(filename);
        const previewFile = getPreviewFilename(baseName);
        const previewPath = path.join(previewsDir, previewFile);
        
        if (!fs.existsSync(previewPath)) {
            await generatePreview(upscaledPath, previewPath);
            console.log(`📸 Generated preview: ${previewFile}`);
        }
        
        // Return the upscaled image
        res.setHeader('Content-Type', 'image/png');
        res.send(updatedUpscaledBuffer);
        
    } catch (error) {
        console.error('Upscaling error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /images/:filename (serve individual image files)
app.get('/images/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(imagesDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Image not found' });
    }
    
    // Set appropriate headers
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') {
        contentType = 'image/jpeg';
    }
    
    res.setHeader('Content-Type', contentType);
    
    // Handle download request
    if (req.query.download === 'true') {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    
    // Send the file
    res.sendFile(filePath);
});

// POST /vibe/encode (encode image for vibe transfer)
app.post('/vibe/encode', authMiddleware, async (req, res) => {
    try {
        const { image, cacheFile, id, informationExtraction, model, workspace } = req.body;
        
        // Validate required parameters
        if (!informationExtraction || typeof informationExtraction !== 'number' || informationExtraction < 0 || informationExtraction > 1) {
            return res.status(400).json({ error: 'informationExtraction must be a number between 0 and 1' });
        }
        
        if (!model) {
            return res.status(400).json({ error: 'model is required' });
        }
        
        if (!image && !cacheFile && !id) {
            return res.status(400).json({ error: 'Either image (base64), cacheFile, or id must be provided' });
        }
        
        let imageBuffer;
        let imageHash = null;
        let originalSource = null;
        let originalBase64 = null;
        let existingVibeData = null;
        
        // Handle image input
        if (id) {
            // ID provided - load existing vibe data
            const jsonPath = path.join(vibeCacheDir, `${id}.json`);
            if (!fs.existsSync(jsonPath)) {
                return res.status(404).json({ error: 'Vibe file not found with provided id' });
            }
            
            existingVibeData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            
            // Get the original image data based on the vibe file type
            if (existingVibeData.type === 'base64' && existingVibeData.image) {
                // Reconstruct from base64
                imageBuffer = Buffer.from(existingVibeData.image, 'base64');
                imageHash = existingVibeData.preview;
                originalSource = 'base64';
                originalBase64 = existingVibeData.image;
            } else if (existingVibeData.type === 'cache' && existingVibeData.image) {
                // Load from cache file
                const cachePath = path.join(uploadCacheDir, existingVibeData.image);
                if (!fs.existsSync(cachePath)) {
                    return res.status(404).json({ error: 'Original cache file not found' });
                }
                imageBuffer = fs.readFileSync(cachePath);
                imageHash = existingVibeData.preview;
                originalSource = 'cache';
            } else {
                return res.status(400).json({ error: 'Invalid vibe file format' });
            }
            
            console.log(`🔄 Using existing vibe file with id: ${id}`);
        } else if (image) {
            // Extract base64 data
            imageBuffer = Buffer.from(image, 'base64');
            imageHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
            originalSource = 'base64';
            originalBase64 = image;

            // Generate preview for base64 image
            const previewPath = path.join(previewCacheDir, `${imageHash}.webp`);
            if (!fs.existsSync(previewPath)) {
                await sharp(imageBuffer)
                    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(previewPath);
                console.log(`📸 Generated preview for vibe image: ${imageHash}.webp`);
            }
        } else {
            // Cache file provided
            const cachePath = path.join(uploadCacheDir, cacheFile);
            if (!fs.existsSync(cachePath)) {
                return res.status(404).json({ error: 'Cache file not found' });
            }
            
            imageBuffer = fs.readFileSync(cachePath);
            originalSource = 'cache';
        }
        
        // Generate SHA256 hash for the JSON file
        const sha256Hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
        
        // Check if JSON file already exists or use existing vibe data
        const jsonFilename = `${sha256Hash}.json`;
        const jsonPath = path.join(vibeCacheDir, jsonFilename);
        
        let vibeData = null;
        if (existingVibeData) {
            // Use existing vibe data when ID is provided
            vibeData = existingVibeData;
            console.log(`✅ Using existing vibe data from id: ${id}`);
        } else if (fs.existsSync(jsonPath)) {
            // Load existing JSON data
            vibeData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            console.log(`✅ Using existing vibe data: ${jsonFilename}`);
        } else {
            // Create new vibe data structure
            vibeData = {
                version: 1,
                type: originalSource,
                preview: imageHash || cacheFile || null,
                image: originalBase64 || cacheFile || null,
                id: sha256Hash,
                encodings: {}
            };
        }
        
        // Check if encoding already exists for this model and extraction value
        const extractionValueStr = informationExtraction.toString();
        if (vibeData.encodings[model] && vibeData.encodings[model][extractionValueStr]) {
            console.log(`✅ Using existing encoding for model ${model} and extraction ${extractionValueStr}`);
            
            // Add to workspace if provided
            if (workspace) {
                addToWorkspaceArray('vibeImages', jsonFilename, workspace);
            }
            
            res.json({
                success: true,
                filename: jsonFilename,
                model: model,
                informationExtraction: informationExtraction
            });
            return;
        }
        
        // Encode the image using NovelAI API
        console.log(`🔄 Encoding image for vibe transfer: ${sha256Hash} with extraction ${informationExtraction} for model ${model}`);
        
        try {
            // Resize image to longest edge 1024 and convert to PNG
            const resizedImageBuffer = await sharp(imageBuffer)
                .resize(1024, 1024, { 
                    fit: 'inside', 
                    withoutEnlargement: true 
                })
                .png()
                .toBuffer();
            
            console.log(`📏 Resized image to longest edge 1024px and converted to PNG`);
            
            // Encode vibe using direct NovelAI API call
            const base64Image = resizedImageBuffer.toString('base64');
            const vibeToken = await encodeVibeDirect(base64Image, informationExtraction, Model[model.toUpperCase()]);
            
            // Initialize model encodings if it doesn't exist
            if (!vibeData.encodings[model]) {
                vibeData.encodings[model] = {};
            }
            
            // Store the encoding as base64 text
            vibeData.encodings[model][extractionValueStr] = vibeToken;
            
            // Save the JSON file (use existing filename if ID was provided)
            const saveFilename = existingVibeData ? `${id}.json` : jsonFilename;
            const savePath = path.join(vibeCacheDir, saveFilename);
            fs.writeFileSync(savePath, JSON.stringify(vibeData, null, 2));
            console.log(`💾 Saved vibe encoding: ${saveFilename}`);
            
            // Add to workspace if provided
            if (workspace) {
                addToWorkspaceArray('vibeImages', saveFilename, workspace);
            }
            
            res.json({
                success: true,
                filename: saveFilename,
                model: model,
                informationExtraction: informationExtraction
            });
            
        } catch (encodingError) {
            console.error('Vibe encoding API error:', encodingError);
            res.status(500).json({ error: `Vibe encoding failed: ${encodingError.message}` });
        }
        
    } catch (error) {
        console.error('Vibe transfer encoding error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /vibe/images (get vibe images for workspace)
app.get('/vibe/images', authMiddleware, async (req, res) => {
    try {
        const workspaceId = req.query.workspace || getActiveWorkspace();
        const workspace = getWorkspace(workspaceId);
        
        if (!workspace) {
            return res.status(404).json({ error: 'Workspace not found' });
        }
        
        const vibeImageDetails = [];
        
        // Get vibes from current workspace
        const currentWorkspaceVibes = workspace.vibeImages || [];
        for (const filename of currentWorkspaceVibes) {
            const filePath = path.join(vibeCacheDir, filename);
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                
                // Parse JSON file to get details
                try {
                    const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    const previewPath = path.join(previewCacheDir, `${vibeData.preview}.webp`);
                    
                    // Get all encodings for this file
                    const encodings = [];
                    for (const [model, modelEncodings] of Object.entries(vibeData.encodings || {})) {
                        for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                            encodings.push({
                                model,
                                informationExtraction: parseFloat(extractionValue),
                                encoding: encoding
                            });
                        }
                    }
                    
                    vibeImageDetails.push({
                        filename,
                        id: vibeData.id,
                        preview: fs.existsSync(previewPath) ? `${vibeData.preview}.webp` : null,
                        mtime: stats.mtime,
                        size: stats.size,
                        encodings: encodings,
                        type: vibeData.type === 'base64' ? 'base64' : 'cache',
                        source: vibeData.image,
                        workspaceId: workspaceId
                    });
                } catch (parseError) {
                    console.error(`Error parsing vibe file ${filename}:`, parseError);
                    // Skip this file if it can't be parsed
                    continue;
                }
            }
        }
        
        // Get vibes from default workspace (if current workspace is not default)
        if (workspaceId !== 'default' && !req.query?.workspace) {
            const defaultWorkspace = getWorkspace('default');
            if (defaultWorkspace) {
                const defaultWorkspaceVibes = defaultWorkspace.vibeImages || [];
                for (const filename of defaultWorkspaceVibes) {
                    const filePath = path.join(vibeCacheDir, filename);
                    if (fs.existsSync(filePath)) {
                        const stats = fs.statSync(filePath);
                        
                        // Parse JSON file to get details
                        try {
                            const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            const previewPath = path.join(previewCacheDir, `${vibeData.preview}.webp`);
                            
                            // Get all encodings for this file
                            const encodings = [];
                            for (const [model, modelEncodings] of Object.entries(vibeData.encodings || {})) {
                                for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                                    encodings.push({
                                        model,
                                        informationExtraction: parseFloat(extractionValue),
                                        encoding: encoding
                                    });
                                }
                            }
                            
                            vibeImageDetails.push({
                                filename,
                                id: vibeData.id,
                                preview: fs.existsSync(previewPath) ? `${vibeData.preview}.webp` : null,
                                mtime: stats.mtime,
                                size: stats.size,
                                encodings: encodings,
                                type: vibeData.type === 'base64' ? 'base64' : 'cache',
                                source: vibeData.image,
                                workspaceId: 'default'
                            });
                        } catch (parseError) {
                            console.error(`Error parsing vibe file ${filename}:`, parseError);
                            // Skip this file if it can't be parsed
                            continue;
                        }
                    }
                }
            }
        }
        
        // Sort by newest first
        vibeImageDetails.sort((a, b) => b.mtime - a.mtime);
        
        res.json(vibeImageDetails);
        
    } catch (error) {
        console.error('Error getting vibe images:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /vibe/images/:filename (serve individual vibe image data)
app.get('/vibe/images/:filename', authMiddleware, (req, res) => {
    try {
        const filename = req.params.filename + '.json';
        const filePath = path.join(vibeCacheDir, filename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Vibe image not found' });
        }
        
        // Parse and return JSON data
        const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Handle download request
        if (req.query.download === 'true') {
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        }
        
        res.json(vibeData);
        
    } catch (error) {
        console.error('Error serving vibe image:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /vibe/images/:id (delete vibe image by ID)
app.delete('/vibe/images/:id', authMiddleware, async (req, res) => {
    try {
        const vibeId = req.params.id;
        const workspaceId = req.query.workspace || getActiveWorkspace();
        
        // Find the vibe file by ID
        const workspace = getWorkspace(workspaceId);
        if (!workspace) {
            return res.status(404).json({ error: 'Workspace not found' });
        }
        
        const vibeFiles = workspace.vibeImages || [];
        let foundFilename = null;
        
        // Find the filename that contains this vibe ID
        for (const filename of vibeFiles) {
            const filePath = path.join(vibeCacheDir, filename);
            if (fs.existsSync(filePath)) {
                try {
                    const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (vibeData.id === vibeId) {
                        foundFilename = filename;
                        break;
                    }
                } catch (parseError) {
                    console.error(`Error parsing vibe file ${filename}:`, parseError);
                    continue;
                }
            }
        }
        
        if (!foundFilename) {
            return res.status(404).json({ error: 'Vibe image not found' });
        }
        
        const filePath = path.join(vibeCacheDir, foundFilename);
        
        // Remove from workspace
        removeFromWorkspaceArray('vibeImages', foundFilename, workspaceId);
        
        // Delete the file
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted vibe image: ${foundFilename} (ID: ${vibeId})`);
        
        res.json({ success: true, message: 'Vibe image deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting vibe image:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /vibe/images/:id/encodings (delete specific encodings from vibe image)
app.delete('/vibe/images/:id/encodings', authMiddleware, async (req, res) => {
    try {
        const vibeId = req.params.id;
        const workspaceId = req.query.workspace || getActiveWorkspace();
        const { encodings } = req.body;
        
        if (!encodings || !Array.isArray(encodings)) {
            return res.status(400).json({ error: 'encodings array is required' });
        }
        
        // Find the vibe file by ID
        const workspace = getWorkspace(workspaceId);
        if (!workspace) {
            return res.status(404).json({ error: 'Workspace not found' });
        }
        
        const vibeFiles = workspace.vibeImages || [];
        let foundFilename = null;
        
        // Find the filename that contains this vibe ID
        for (const filename of vibeFiles) {
            const filePath = path.join(vibeCacheDir, filename);
            if (fs.existsSync(filePath)) {
                try {
                    const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (vibeData.id === vibeId) {
                        foundFilename = filename;
                        break;
                    }
                } catch (parseError) {
                    console.error(`Error parsing vibe file ${filename}:`, parseError);
                    continue;
                }
            }
        }
        
        if (!foundFilename) {
            return res.status(404).json({ error: 'Vibe image not found' });
        }
        
        const filePath = path.join(vibeCacheDir, foundFilename);
        
        // Read the vibe data
        const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        if (!vibeData.encodings || !Array.isArray(vibeData.encodings)) {
            return res.status(400).json({ error: 'No encodings found in vibe image' });
        }
        
        // Remove specified encodings
        const originalCount = vibeData.encodings.length;
        vibeData.encodings = vibeData.encodings.filter(encoding => {
            return !encodings.some(toDelete => 
                toDelete.model === encoding.model && 
                toDelete.informationExtraction === encoding.informationExtraction
            );
        });
        
        const deletedCount = originalCount - vibeData.encodings.length;
        
        if (deletedCount === 0) {
            return res.status(400).json({ error: 'No matching encodings found to delete' });
        }
        
        // If no encodings left, delete the entire vibe image
        if (vibeData.encodings.length === 0) {
            removeFromWorkspaceArray('vibeImages', foundFilename, workspaceId);
            fs.unlinkSync(filePath);
            console.log(`🗑️ Deleted entire vibe image (no encodings left): ${foundFilename} (ID: ${vibeId})`);
            res.json({ success: true, message: 'Vibe image deleted (no encodings remaining)' });
        } else {
            // Update the file with remaining encodings
            fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
            console.log(`🗑️ Deleted ${deletedCount} encodings from vibe image: ${foundFilename} (ID: ${vibeId})`);
            res.json({ success: true, message: `${deletedCount} encodings deleted successfully` });
        }
        
    } catch (error) {
        console.error('Error deleting vibe encodings:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /vibe/images/bulk-delete (bulk delete vibe images and encodings)
app.post('/vibe/images/bulk-delete', authMiddleware, async (req, res) => {
    try {
        const workspaceId = req.body.workspace || getActiveWorkspace();
        const { vibesToDelete, encodingsToDelete } = req.body;
        
        if (!vibesToDelete && !encodingsToDelete) {
            return res.status(400).json({ error: 'Either vibesToDelete or encodingsToDelete is required' });
        }
        
        const results = {
            deletedVibes: [],
            deletedEncodings: [],
            errors: []
        };
        
        // Get workspace and vibe files
        const workspace = getWorkspace(workspaceId);
        if (!workspace) {
            return res.status(404).json({ error: 'Workspace not found' });
        }
        
        const vibeFiles = workspace.vibeImages || [];
        
        // Delete entire vibe images
        if (vibesToDelete && Array.isArray(vibesToDelete)) {
            for (const vibeId of vibesToDelete) {
                try {
                    // Find the filename that contains this vibe ID
                    let foundFilename = null;
                    for (const filename of vibeFiles) {
                        const filePath = path.join(vibeCacheDir, filename);
                        if (fs.existsSync(filePath)) {
                            try {
                                const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                                if (vibeData.id === vibeId) {
                                    foundFilename = filename;
                                    break;
                                }
                            } catch (parseError) {
                                console.error(`Error parsing vibe file ${filename}:`, parseError);
                                continue;
                            }
                        }
                    }
                    
                    if (foundFilename) {
                        const filePath = path.join(vibeCacheDir, foundFilename);
                        removeFromWorkspaceArray('vibeImages', foundFilename, workspaceId);
                        fs.unlinkSync(filePath);
                        results.deletedVibes.push(vibeId);
                        console.log(`🗑️ Bulk deleted vibe image: ${foundFilename} (ID: ${vibeId})`);
                    } else {
                        results.errors.push(`Vibe image not found: ${vibeId}`);
                    }
                } catch (error) {
                    results.errors.push(`Failed to delete vibe ${vibeId}: ${error.message}`);
                }
            }
        }
        
        // Delete specific encodings
        if (encodingsToDelete && Array.isArray(encodingsToDelete)) {
            // Group encodings by vibe image
            const encodingsByVibe = {};
            encodingsToDelete.forEach(encodingData => {
                // encodingData should be { vibeId, model, informationExtraction }
                if (encodingData.vibeId && encodingData.model && encodingData.informationExtraction !== undefined) {
                    if (!encodingsByVibe[encodingData.vibeId]) {
                        encodingsByVibe[encodingData.vibeId] = [];
                    }
                    encodingsByVibe[encodingData.vibeId].push(encodingData);
                }
            });
            
            // Process each vibe image
            for (const [vibeId, encodingsToRemove] of Object.entries(encodingsByVibe)) {
                try {
                    // Find the filename that contains this vibe ID
                    let foundFilename = null;
                    for (const filename of vibeFiles) {
                        const filePath = path.join(vibeCacheDir, filename);
                        if (fs.existsSync(filePath)) {
                            try {
                                const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                                if (vibeData.id === vibeId) {
                                    foundFilename = filename;
                                    break;
                                }
                            } catch (parseError) {
                                console.error(`Error parsing vibe file ${filename}:`, parseError);
                                continue;
                            }
                        }
                    }
                    
                    if (!foundFilename) {
                        results.errors.push(`Vibe image not found: ${vibeId}`);
                        continue;
                    }
                    
                    const filePath = path.join(vibeCacheDir, foundFilename);
                    
                    // Read the vibe data
                    const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    
                    if (!vibeData.encodings || !Array.isArray(vibeData.encodings)) {
                        results.errors.push(`No encodings found in vibe: ${vibeId}`);
                        continue;
                    }
                    
                    // Remove specified encodings
                    const originalCount = vibeData.encodings.length;
                    vibeData.encodings = vibeData.encodings.filter(encoding => {
                        return !encodingsToRemove.some(toDelete => 
                            toDelete.model === encoding.model && 
                            toDelete.informationExtraction === encoding.informationExtraction
                        );
                    });
                    
                    const deletedCount = originalCount - vibeData.encodings.length;
                    
                    if (deletedCount > 0) {
                        // If no encodings left, delete the entire vibe image
                        if (vibeData.encodings.length === 0) {
                            removeFromWorkspaceArray('vibeImages', foundFilename, workspaceId);
                            fs.unlinkSync(filePath);
                            results.deletedVibes.push(vibeId);
                            console.log(`🗑️ Bulk deleted entire vibe image (no encodings left): ${foundFilename} (ID: ${vibeId})`);
                        } else {
                            // Update the file with remaining encodings
                            fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
                            results.deletedEncodings.push(...encodingsToRemove);
                            console.log(`🗑️ Bulk deleted ${deletedCount} encodings from vibe: ${foundFilename} (ID: ${vibeId})`);
                        }
                    }
                    
                } catch (error) {
                    results.errors.push(`Failed to delete encodings from vibe ${vibeId}: ${error.message}`);
                }
            }
        }
        
        const success = results.deletedVibes.length > 0 || results.deletedEncodings.length > 0;
        const message = success ? 
            `Deleted ${results.deletedVibes.length} vibe(s) and ${results.deletedEncodings.length} encoding(s)` :
            'No items were deleted';
        
        res.json({
            success,
            message,
            ...results
        });
        
    } catch (error) {
        console.error('Error bulk deleting vibe items:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /vibe/images/:id/move (move vibe image to workspace)
app.put('/vibe/images/:id/move', authMiddleware, async (req, res) => {
    try {
        const vibeId = req.params.id;
        const { targetWorkspace } = req.body;
        const sourceWorkspace = req.query.workspace || getActiveWorkspace();
        
        if (!targetWorkspace) {
            return res.status(400).json({ error: 'targetWorkspace is required' });
        }
        
        // Find the vibe file by ID
        const workspace = getWorkspace(sourceWorkspace);
        if (!workspace) {
            return res.status(404).json({ error: 'Source workspace not found' });
        }
        
        const vibeFiles = workspace.vibeImages || [];
        let foundFilename = null;
        
        // Find the filename that contains this vibe ID
        for (const filename of vibeFiles) {
            const filePath = path.join(vibeCacheDir, filename);
            if (fs.existsSync(filePath)) {
                try {
                    const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (vibeData.id === vibeId) {
                        foundFilename = filename;
                        break;
                    }
                } catch (parseError) {
                    console.error(`Error parsing vibe file ${filename}:`, parseError);
                    continue;
                }
            }
        }
        
        if (!foundFilename) {
            return res.status(404).json({ error: 'Vibe image not found' });
        }
        
        // Move to target workspace
        moveToWorkspaceArray('vibeImages', foundFilename, targetWorkspace, sourceWorkspace);
        
        console.log(`📁 Moved vibe image ${foundFilename} (ID: ${vibeId}) from workspace ${sourceWorkspace} to ${targetWorkspace}`);
        
        res.json({ success: true, message: 'Vibe image moved successfully' });
        
    } catch (error) {
        console.error('Error moving vibe image:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /vibe/images/bulk-move (bulk move vibe images to workspace)
app.post('/vibe/images/bulk-move', authMiddleware, async (req, res) => {
    try {
        const { imageIds, targetWorkspace, sourceWorkspace } = req.body;
        const workspaceId = sourceWorkspace || getActiveWorkspace();
        
        if (!targetWorkspace) {
            return res.status(400).json({ error: 'targetWorkspace is required' });
        }
        
        if (!imageIds || !Array.isArray(imageIds)) {
            return res.status(400).json({ error: 'imageIds array is required' });
        }
        
        const results = {
            movedImages: [],
            errors: []
        };
        
        // Get source workspace and vibe files
        const workspace = getWorkspace(workspaceId);
        if (!workspace) {
            return res.status(404).json({ error: 'Source workspace not found' });
        }
        
        const vibeFiles = workspace.vibeImages || [];
        
        for (const imageId of imageIds) {
            try {
                // Find the filename that contains this vibe ID
                let foundFilename = null;
                for (const filename of vibeFiles) {
                    const filePath = path.join(vibeCacheDir, filename);
                    if (fs.existsSync(filePath)) {
                        try {
                            const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            if (vibeData.id === imageId) {
                                foundFilename = filename;
                                break;
                            }
                        } catch (parseError) {
                            console.error(`Error parsing vibe file ${filename}:`, parseError);
                            continue;
                        }
                    }
                }
                
                if (foundFilename) {
                    // Move to target workspace
                    moveToWorkspaceArray('vibeImages', foundFilename, targetWorkspace, workspaceId);
                    results.movedImages.push(imageId);
                    console.log(`📁 Bulk moved vibe image ${foundFilename} (ID: ${imageId}) from workspace ${workspaceId} to ${targetWorkspace}`);
                } else {
                    results.errors.push(`Vibe image not found: ${imageId}`);
                }
            } catch (error) {
                results.errors.push(`Failed to move vibe ${imageId}: ${error.message}`);
            }
        }
        
        const success = results.movedImages.length > 0;
        const message = success ? 
            `Moved ${results.movedImages.length} vibe image(s) successfully` :
            'No images were moved';
        
        res.json({
            success,
            message,
            ...results
        });
        
    } catch (error) {
        console.error('Error bulk moving vibe images:', error);
        res.status(500).json({ error: error.message });
    }
});

// OPTIONS /images/:filename (get metadata)
app.options('/images/:filename', authMiddleware, async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(imagesDir, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        const meta = extractNovelAIMetadata(filePath);
        if (!meta) {
            return res.status(404).json({ error: 'No NovelAI metadata found' });
        }
        
        // If upscaled, try to match preset using metadata dimensions
        let matchedPreset = null;
        const isUpscaled = meta.forge_data?.upscale_ratio !== null && meta.forge_data?.upscale_ratio !== undefined;
        if (isUpscaled) {
            const currentPromptConfig = loadPromptConfig();
            matchedPreset = matchOriginalResolution(meta, currentPromptConfig.resolutions || {});
        }
        
        const result = await extractRelevantFields(meta, filename);
        if (matchedPreset) result.matchedPreset = matchedPreset;
        
        // Debug: Log the metadata values
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /images/:filename (delete image and upscaled/base versions)
app.delete('/images/:filename', authMiddleware, async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(imagesDir, filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Get the base name to find related files
        const baseName = getBaseName(filename);
        const previewFile = getPreviewFilename(baseName);
        const previewPath = path.join(previewsDir, previewFile);

        // Always delete both the base and upscaled version
        const filesToDelete = [];
        const filenamesToRemoveFromWorkspaces = [];

        // Determine base/original and upscaled filenames
        let originalFilename, upscaledFilename;
        if (filename.includes('_upscaled')) {
            upscaledFilename = filename;
            originalFilename = filename.replace('_upscaled.png', '.png');
        } else {
            originalFilename = filename;
            upscaledFilename = filename.replace('.png', '_upscaled.png');
        }

        // Add original file if exists
        const originalPath = path.join(imagesDir, originalFilename);
        if (fs.existsSync(originalPath)) {
            filesToDelete.push({ path: originalPath, type: 'original' });
            filenamesToRemoveFromWorkspaces.push(originalFilename);
        }

        // Add upscaled file if exists
        const upscaledPath = path.join(imagesDir, upscaledFilename);
        if (fs.existsSync(upscaledPath)) {
            filesToDelete.push({ path: upscaledPath, type: 'upscaled' });
            filenamesToRemoveFromWorkspaces.push(upscaledFilename);
        }

        // Also handle pipeline and pipeline_upscaled variants
        const pipelineFilename = baseName + '_pipeline.png';
        const pipelineUpscaledFilename = baseName + '_pipeline_upscaled.png';
        const pipelinePath = path.join(imagesDir, pipelineFilename);
        const pipelineUpscaledPath = path.join(imagesDir, pipelineUpscaledFilename);

        if (fs.existsSync(pipelinePath)) {
            filesToDelete.push({ path: pipelinePath, type: 'pipeline' });
            filenamesToRemoveFromWorkspaces.push(pipelineFilename);
        }
        if (fs.existsSync(pipelineUpscaledPath)) {
            filesToDelete.push({ path: pipelineUpscaledPath, type: 'pipeline_upscaled' });
            filenamesToRemoveFromWorkspaces.push(pipelineUpscaledFilename);
        }

        // Add the preview file
        if (fs.existsSync(previewPath)) {
            filesToDelete.push({ path: previewPath, type: 'preview' });
        }

        // Remove files from workspaces first
        if (filenamesToRemoveFromWorkspaces.length > 0) {
            removeFilesFromWorkspaces(filenamesToRemoveFromWorkspaces);
        }

        // Delete all related files
        const deletedFiles = [];
        for (const file of filesToDelete) {
            try {
                fs.unlinkSync(file.path);
                deletedFiles.push(file.type);
                console.log(`🗑️ Deleted ${file.type}: ${path.basename(file.path)}`);
            } catch (error) {
                console.error(`Failed to delete ${file.type}: ${path.basename(file.path)}`, error.message);
            }
        }

        // Sync workspace files to remove any remaining references to deleted files
        syncWorkspaceFiles();

        console.log(`✅ Deleted image and related files: ${deletedFiles.join(', ')}`);
        res.json({
            success: true,
            message: `Image deleted successfully`,
            deletedFiles: deletedFiles
        });

    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Common request logging middleware
const requestLogger = (req, res, next) => {
    const startTime = Date.now();
    const timestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const realIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || req.connection.remoteAddress;
    const queryParams = { ...req.query };
    delete queryParams.auth;
    delete queryParams.loginKey;
    
    console.log(`\n📋 [${timestamp}] ${realIP} => ${req.method} ${req.path}`);
    if (Object.keys(queryParams).length > 0) {
        console.log(`   Query: ${JSON.stringify(queryParams)}`);
    }
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`   Body: ${JSON.stringify(req.body)}`);
    }
    
    let completionLogged = false;
    const originalEnd = res.end;
    res.end = function(...args) {
        if (!completionLogged) {
            const duration = Date.now() - startTime;
            console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s`);
            completionLogged = true;
        }
        originalEnd.apply(this, args);
    };
    
    const originalSend = res.send;
    res.send = function(...args) {
        if (!completionLogged) {
            const duration = Date.now() - startTime;
            console.log(`⏱️ Completed in ${(duration / 1000).toFixed(2)}s`);
            completionLogged = true;
        }
        originalSend.apply(this, args);
    };
    
    next();
};

app.use(requestLogger);

// Build options for image generation
const buildOptions = async (model, body, preset = null, queryParams = {}) => {
    const resolution = body.resolution || preset?.resolution;
    const allowPaid = body.allow_paid !== undefined ? body.allow_paid : preset?.allow_paid;
    
    let width, height;
    if (resolution && Resolution[resolution.toUpperCase()]) {
        if ((resolution.startsWith('LARGE_') || resolution.startsWith('WALLPAPER_'))) { 
            if (!allowPaid) {
                throw new Error(`Resolution "${resolution}" requires Opus credits. Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
            }
        }
    } else {
        width = body.width || preset?.width || 1024;
        height = body.height || preset?.height || 1024;
        if ((width > 1024 || height > 1024) && !allowPaid) {
                throw new Error(`Custom dimensions ${width}x${height} exceed maximum of 1024. Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
            }
    }

    const steps = body.steps || preset?.steps || 24;
    if (steps > 28 && !allowPaid) {
        throw new Error(`Steps value ${steps} exceeds maximum of 28. Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
    }
    
    const currentPromptConfig = loadPromptConfig();
    const presetName = preset ? Object.keys(currentPromptConfig.presets).find(key => currentPromptConfig.presets[key] === preset) : null;
    const rawPrompt = (body.prompt !== undefined && body.prompt !== null) ? body.prompt : preset?.prompt;
    const rawNegativePrompt = (body.uc !== undefined && body.uc !== null) ? body.uc : preset?.uc;
    
    // Handle upscale override from query parameters
    let upscaleValue = (body.upscale !== undefined && body.upscale !== null) ? body.upscale : preset?.upscale;
    if (queryParams.upscale !== undefined) {
        if (queryParams.upscale === 'true') {
            upscaleValue = true; // Default to 4x
    } else {
            const parsedUpscale = parseFloat(queryParams.upscale);
            if (!isNaN(parsedUpscale) && parsedUpscale > 0) {
                upscaleValue = parsedUpscale;
            } else {
                throw new Error('Invalid upscale value. Use ?upscale=true for default 4x or ?upscale=<number> for custom multiplier.');
            }
        }
    }
    
    try {
        let processedPrompt = applyTextReplacements(rawPrompt, presetName, model);
        let processedNegativePrompt = applyTextReplacements(rawNegativePrompt, presetName, model);
        
        // Process NSFW removal from negative prompt
        if (processedNegativePrompt && processedNegativePrompt.startsWith("nsfw")) {
            let j = processedNegativePrompt.slice(4);
            let A = "nsfw";
            if (j.startsWith(", ")) {
                j = j.slice(2);
                A += ", ";
            }
            
            // Remove NSFW from the beginning of the negative prompt
            processedNegativePrompt = j;
        }
        
        const usedPromptReplacements = getUsedReplacements(rawPrompt, model);
        const usedNegativeReplacements = getUsedReplacements(rawNegativePrompt, model);
        
        if (usedPromptReplacements.length > 0 || usedNegativeReplacements.length > 0) {
            console.log(`🔄 Text replacements: ${[...usedPromptReplacements, ...usedNegativeReplacements].join(', ')}`);
        }

        // Process character prompts with text replacements
        let processedCharacterPrompts = body.allCharacterPrompts || preset?.allCharacterPrompts || undefined;
        if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
            processedCharacterPrompts = processedCharacterPrompts.map(char => {
                // Apply text replacements to character prompt and UC
                const processedPrompt = applyTextReplacements(char.prompt, presetName, model);
                const processedUC = applyTextReplacements(char.uc, presetName, model);
                
                return {
                    ...char,
                    prompt: processedPrompt,
                    uc: processedUC
                };
            });
            
            // Log text replacements used in character prompts
            const usedCharacterReplacements = [];
            (body.allCharacterPrompts || preset?.allCharacterPrompts).forEach(char => {
                const promptReplacements = getUsedReplacements(char.prompt, model);
                const ucReplacements = getUsedReplacements(char.uc, model);
                if (promptReplacements.length > 0 || ucReplacements.length > 0) {
                    usedCharacterReplacements.push(...promptReplacements, ...ucReplacements);
                }
            });
            
            if (usedCharacterReplacements.length > 0) {
                console.log(`🔄 Character prompt text replacements: ${usedCharacterReplacements.join(', ')}`);
            }
        }

        // Handle dataset prepending (exclude for V3 models)
        const isV3Model = model === 'v3' || model === 'v3_furry';
        if (!isV3Model && body.dataset_config && body.dataset_config.include && Array.isArray(body.dataset_config.include) && body.dataset_config.include.length > 0) {
            const datasetMappings = {
                'anime': 'anime dataset',
                'furry': 'furry dataset', 
                'backgrounds': 'background dataset'
            };
            
            const datasetPrepends = [];
            
            body.dataset_config.include.forEach(dataset => {
                if (datasetMappings[dataset]) {
                    let datasetText = datasetMappings[dataset];
                    
                    // Add bias if > 1.0
                    if (body.dataset_config.bias && body.dataset_config.bias[dataset] && body.dataset_config.bias[dataset] > 1.0) {
                        datasetText = `${parseFloat(parseFloat(body.dataset_config.bias[dataset].toString()).toFixed(2)).toString()}::${dataset}::`;
                    }
                    
                    datasetPrepends.push(datasetText);
                    
                    // Add sub-toggle values for the dataset if enabled
                    if (body.dataset_config.settings && body.dataset_config.settings[dataset]) {
                        const datasetSettings = body.dataset_config.settings[dataset];
                        Object.keys(datasetSettings).forEach(settingId => {
                            const setting = datasetSettings[settingId];
                            if (setting.enabled && setting.value) {
                                // If no bias is set or bias is 1.0, just use the value
                                // If bias is set and > 1.0, apply the bias
                                const settingText = (setting.bias && setting.bias > 1.0) ? 
                                    `${setting.bias}::${setting.value}::` : setting.value;
                                datasetPrepends.push(settingText);
                            }
                        });
                    }
                }
            });
            
            if (datasetPrepends.length > 0) {
                const datasetString = datasetPrepends.join(', ');
                processedPrompt = datasetString + ', ' + processedPrompt;
                console.log(`🗂️ Applied dataset prepends: ${datasetString}`);
            }
        }

        // Handle enhanced preset selections
        let selectedQualityId = null;
        let selectedUcId = null;

        // Handle append_quality with enhanced preset selection
        if (body.append_quality && currentPromptConfig.quality_presets) {
            const modelKey = model.toLowerCase();
            const combinedPrompt = processedPrompt + (processedCharacterPrompts ? processedCharacterPrompts.map(c => c.prompt).join(', ') : '');
            const selectedQuality = selectPresetItem(currentPromptConfig.quality_presets, modelKey, combinedPrompt, body.append_quality_id);
            
            if (selectedQuality) {
                // Split prompt by "|", add quality to end of first group, then rejoin with " | "
                const groups = processedPrompt.split('|').map(group => group.trim());
                if (groups.length > 0) {
                    groups[0] = groups[0] + ', ' + selectedQuality.value;
                    processedPrompt = groups.join(' | ');
                } else {
                    processedPrompt = processedPrompt + ', ' + selectedQuality.value;
                }
                selectedQualityId = selectedQuality.id;
                console.log(`🎨 Applied quality preset for ${modelKey}: ${selectedQuality.value} (ID: ${selectedQuality.id})`);
            }
        }

        // Handle append_uc with enhanced preset selection
        if (body.append_uc !== undefined && body.append_uc > 0 && currentPromptConfig.uc_presets) {
            const modelKey = model.toLowerCase();
            const combinedPrompt = processedPrompt + (processedCharacterPrompts ? processedCharacterPrompts.map(c => c.prompt).join(', ') : '');
            const selectedUc = selectPresetItem(currentPromptConfig.uc_presets, modelKey, combinedPrompt, body.append_uc_id || body.append_uc);
            
            if (selectedUc) {
                // Add UC preset to the start of the UC and separate the original UC with ", "
                processedNegativePrompt = selectedUc.value + (processedNegativePrompt ? ', ' + processedNegativePrompt : '');
                selectedUcId = selectedUc.id;
                console.log(`🚫 Applied UC preset for ${modelKey}: ${selectedUc.value} (ID: ${selectedUc.id})`);
            }
        }

    // Check if this is an img2img request
    const baseOptions = {
        prompt: processedPrompt,
        negative_prompt: processedNegativePrompt,
        input_prompt: rawPrompt,
        input_uc: rawNegativePrompt,
        model: Model[model.toUpperCase() + ((body.mask || body.mask_compressed) && body.image && !model.toUpperCase().includes('_INP') ? '_INP' : '')],
        steps: parseInt(body.steps || preset?.steps || '24'),
        scale: parseFloat((body.guidance || preset?.guidance || '5.5').toString()),
        cfg_rescale: parseFloat((body.rescale || preset?.rescale || '0.0').toString()),
        skip_cfg_above_sigma: (body?.variety || preset?.variety || queryParams?.variety === 'true') ? 58 : undefined,
        sampler: body.sampler ? Sampler[body.sampler.toUpperCase()] : (preset?.sampler ? Sampler[preset.sampler.toUpperCase()] : Sampler.EULER_ANC),
        noise_schedule: body.noiseScheduler ? Noise[body.noiseScheduler.toUpperCase()] : (preset?.noiseScheduler ? Noise[preset.noiseScheduler.toUpperCase()] : Noise.KARRAS),
        no_save: body.no_save !== undefined ? body.no_save : preset?.no_save,
        qualityToggle: false,
        ucPreset: 4,
        dynamicThresholding: body.dynamicThresholding || preset?.dynamicThresholding,
        seed: parseInt((body.seed || preset?.seed || '0').toString()),
        upscale: upscaleValue,
        characterPrompts: body.characterPrompts || preset?.characterPrompts || undefined,
        allCharacterPrompts: processedCharacterPrompts || undefined,
        input_character_prompts: body.allCharacterPrompts || preset?.allCharacterPrompts || undefined,
        dataset_config: body.dataset_config || preset?.dataset_config || undefined,
        append_quality: body.append_quality !== undefined ? body.append_quality : preset?.append_quality,
        append_uc: body.append_uc !== undefined ? body.append_uc : preset?.append_uc,
        append_quality_id: selectedQualityId,
        append_uc_id: selectedUcId,
        vibe_transfer: body.vibe_transfer !== undefined ? body.vibe_transfer : (preset && preset.vibe_transfer ? preset.vibe_transfer : undefined),
        normalize_vibes: body.normalize_vibes !== undefined ? body.normalize_vibes : (preset && preset.normalize_vibes !== undefined ? preset.normalize_vibes : true),
    };

    if (baseOptions.upscale && baseOptions.upscale > 1 && !allowPaid) {
        throw new Error(`Upscaling with scale ${baseOptions.upscale} requires Opus credits. Set "allow_paid": true to confirm you accept using Opus credits for upscaling.`);
    }

    if (body.width && body.height) {
        baseOptions.width = parseInt(body.width.toString());
        baseOptions.height = parseInt(body.height.toString());
    } else if (resolution && Resolution[resolution.toUpperCase()]) {
        baseOptions.resPreset = Resolution[resolution.toUpperCase()];
    } else {
        baseOptions.resPreset = "NORMAL_SQUARE";
    }
    
    if (!!body.image) {
        if (!body.image.includes(":")) throw new Error(`No Image Format Passed`);

        let imageBuffer;
        let originalSource = body.image;
        const [imageType, imageIdentifier] = body.image.split(':', 2);

        switch (imageType) {
            case 'cache':
                const cachedImagePath = path.join(uploadCacheDir, imageIdentifier);
                if (!fs.existsSync(cachedImagePath)) throw new Error(`Cached image not found: ${imageIdentifier}`);
                imageBuffer = fs.readFileSync(cachedImagePath);
                break;
            case 'file':
                const filePath = path.join(imagesDir, imageIdentifier);
                if (!fs.existsSync(filePath)) throw new Error(`Image not found: ${imageIdentifier}`);
                imageBuffer = fs.readFileSync(filePath);
                break;
            case 'data': // For new uploads from client, not yet cached.
                imageBuffer = Buffer.from(imageIdentifier, 'base64');
                originalSource = 'data:base64'; // Don't store full base64 in metadata
                break;
            default:
                throw new Error(`Unsupported image type: ${imageType}`);
        }
        imageBuffer = stripPngTextChunks(imageBuffer);
        let targetDims = { width: baseOptions.width, height: baseOptions.height };
        if (!targetDims.width || !targetDims.height) {
            const dims = getDimensionsFromResolution(baseOptions.resPreset?.toLowerCase() || "");
            console.log('dims', dims);
            if (dims) {
                targetDims.width = dims.width;
                targetDims.height = dims.height;
            }
        }
        
        if (!targetDims.width || !targetDims.height) {
            console.error('Invalid target dimensions:', targetDims);
            throw new Error('Invalid target dimensions');
        }
        
        if (targetDims.width && targetDims.height) {
            imageBuffer = await processDynamicImage(imageBuffer, targetDims, body.image_bias);
            console.log(`📏 Resized base image to ${targetDims.width}x${targetDims.height} with bias ${body.image_bias}`);
        }

        baseOptions.action = (body.mask || body.mask_compressed) ? Action.INPAINT : Action.IMG2IMG;
        baseOptions.color_correct = false;
        if (body.mask_compressed && targetDims.width && targetDims.height) {
            try {
                // Process the compressed mask to target resolution
                const maskBuffer = Buffer.from(body.mask_compressed, 'base64');
                const processedMaskBuffer = await resizeMaskWithCanvas(maskBuffer, targetDims.width, targetDims.height);
                body.mask = processedMaskBuffer.toString('base64');
                baseOptions.mask_compressed = body.mask_compressed;
                console.log(`🎭 Processed compressed mask to ${targetDims.width}x${targetDims.height}`);
            } catch (error) {
                console.error('❌ Failed to process compressed mask:', error.message);
                // Continue without mask if processing fails
                body.mask_compressed = null;
            }
        }
        
        // Auto-convert standard mask to compressed mask if no compressed mask exists
        if (body.mask && !body.mask_compressed && targetDims.width && targetDims.height) {
            try {
                // Convert standard mask to compressed format (1/8 scale)
                const compressedWidth = Math.floor(targetDims.width / 8);
                const compressedHeight = Math.floor(targetDims.height / 8);
                
                // Create a temporary canvas to resize the mask
                const { createCanvas, loadImage } = require('canvas');
                const maskBuffer = Buffer.from(body.mask, 'base64');
                const maskImage = await loadImage(maskBuffer);
                
                const tempCanvas = createCanvas(compressedWidth, compressedHeight);
                const tempCtx = tempCanvas.getContext('2d');
                
                // Fill with black background
                tempCtx.fillStyle = 'black';
                tempCtx.fillRect(0, 0, compressedWidth, compressedHeight);
                
                // Disable image smoothing for nearest neighbor scaling
                tempCtx.imageSmoothingEnabled = false;
                
                // Draw the mask scaled down to compressed size
                tempCtx.drawImage(maskImage, 0, 0, compressedWidth, compressedHeight);
                
                // Binarize the image data to ensure crisp 1-bit mask
                const imageData = tempCtx.getImageData(0, 0, compressedWidth, compressedHeight);
                const data = imageData.data;
                
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    
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
                
                // Put the binarized image data back
                tempCtx.putImageData(imageData, 0, 0);
                
                // Convert to base64 and store as compressed mask
                const compressedMaskBase64 = tempCanvas.toBuffer('image/png').toString('base64');
                body.mask_compressed = compressedMaskBase64;
                baseOptions.mask_compressed = compressedMaskBase64;
                
                console.log(`🔄 Auto-converted standard mask to compressed format (${compressedWidth}x${compressedHeight})`);
            } catch (error) {
                console.error('❌ Failed to auto-convert standard mask to compressed:', error.message);
                // Continue with original mask if conversion fails
            }
        }
        
        if (body.mask) {
            // Process compressed mask if available, otherwise use regular mask
            baseOptions.mask = body.mask;
            baseOptions.strength = parseFloat((body.inpainting_strength || body.strength || "1").toString());
            baseOptions.noise = 0.0;
        } else {
            baseOptions.strength = parseFloat((body.strength || 0.8).toString());
            baseOptions.noise = parseFloat((body.noise || 0.1).toString());
        }

        baseOptions.image = imageBuffer.toString('base64');
        baseOptions.image_source = originalSource;
        baseOptions.image_bias = body.image_bias;
    }

    // Process vibe transfer data if present (disabled when mask is provided for inpainting)
    if (baseOptions.vibe_transfer && Array.isArray(baseOptions.vibe_transfer) && baseOptions.vibe_transfer.length > 0) {
        if (baseOptions.mask) {
            console.log(`⚠️ Vibe transfers disabled due to inpainting mask presence`);
        } else {
            try {
                // Load vibe references from the vibe cache directory
                const vibeCacheDir = path.join(cacheDir, 'vibe');
                const referenceImageMultiple = [];
                const referenceStrengthMultiple = [];
                
                if (fs.existsSync(vibeCacheDir)) {
                    for (const vibeTransfer of baseOptions.vibe_transfer) {
                        // Directly access the vibe file using the ID as filename
                        const vibeFilePath = path.join(vibeCacheDir, `${vibeTransfer.id}.json`);
                        
                        if (fs.existsSync(vibeFilePath)) {
                            try {
                                const vibeData = JSON.parse(fs.readFileSync(vibeFilePath, 'utf8'));
                                
                                // Get the encoding for the specific model and IE
                                if (vibeData.encodings && 
                                    vibeData.encodings[model] && 
                                    vibeData.encodings[model][vibeTransfer.ie.toString()]) {
                                    
                                    const encoding = vibeData.encodings[model][vibeTransfer.ie.toString()];
                                    referenceImageMultiple.push(encoding);
                                    referenceStrengthMultiple.push(vibeTransfer.strength);
                                    console.log(`🎨 Found encoding for vibe ${vibeTransfer.id} with IE ${vibeTransfer.ie} and strength ${vibeTransfer.strength}`);
                                } else {
                                    console.warn(`⚠️ No encoding found for vibe ${vibeTransfer.id} with IE ${vibeTransfer.ie} for model ${model}`);
                                }
                            } catch (parseError) {
                                console.warn(`⚠️ Failed to parse vibe file ${vibeTransfer.id}.json:`, parseError.message);
                            }
                        } else {
                            console.warn(`⚠️ Vibe file not found: ${vibeTransfer.id}.json`);
                        }
                    }
                }
                
                // Add to baseOptions if we found encodings
                if (referenceImageMultiple.length > 0) {
                    baseOptions.reference_image_multiple = referenceImageMultiple;
                    baseOptions.reference_strength_multiple = referenceStrengthMultiple;
                    baseOptions.normalize_reference_strength_multiple = baseOptions.normalize_vibes;
                    console.log(`🎨 Applied ${referenceImageMultiple.length} vibe transfers with normalize: ${baseOptions.normalize_vibes}`);
                } else {
                    console.warn(`⚠️ No valid encodings found for any vibe transfers`);
                }
            } catch (error) {
                console.error('❌ Failed to process vibe transfers:', error.message);
                // Continue without vibe transfers if processing fails
            }
        }
    }

    if (!allowPaid) {
        try {
            const cost_opus = calculateCost(baseOptions, true);
            if (cost_opus > 0) {
                throw new Error(`Request requires Opus credits (cost: ${cost_opus}). Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
            }
        } catch (error) {
                if (error.message.includes('requires Opus credits')) throw error;
        }
    }

    return baseOptions;
    } catch (error) {
        throw error;
}
};

async function handleGeneration(opts, returnImage = false, presetName = null, workspaceId = null) {
    const seed = opts.seed || Math.floor(0x100000000 * Math.random() - 1);
    const isPipeline = opts.isPipeline || false;
    const layer1Seed = opts.layer1Seed || null;
    
    opts.n_samples = 1;
    opts.seed = seed;
    if (opts.action === Action.INPAINT) {
        opts.add_original_image = false;
        opts.extra_noise_seed = seed;
    } else if (opts.action === Action.IMG2IMG) {
        opts.color_correct = false;
    }
    console.log(`🚀 Starting image generation (seed: ${seed})...`);
    
    let img;
    
    // Create a clean copy of opts for the API call, removing custom properties
    const apiOpts = { ...opts };
    delete apiOpts.upscale;
    delete apiOpts.no_save;
    delete apiOpts.isPipeline;
    delete apiOpts.layer1Seed;
    delete apiOpts.allCharacterPrompts;
    delete apiOpts.original_filename;
    delete apiOpts.image_bias;
    delete apiOpts.mask_bias;
    delete apiOpts.image_source;
    delete apiOpts.mask_compressed;
    delete apiOpts.dataset_config;
    delete apiOpts.append_quality;
    delete apiOpts.append_uc;
    delete apiOpts.input_prompt;
    delete apiOpts.input_uc;
    delete apiOpts.input_character_prompts;
    delete apiOpts.vibe_transfer;
    delete apiOpts.normalize_vibes;

    // Process character prompts: only enabled characters go to API, all characters go to forge_data
    if (opts.allCharacterPrompts && Array.isArray(opts.allCharacterPrompts)) {
        // Post-process character prompts: replace 1girl/1boy with girl/boy
        const processedCharacterPrompts = opts.allCharacterPrompts.map(char => ({
            ...char,
            prompt: char.prompt.replace(/1girl/g, "girl").replace(/1boy/g, "boy")
        }));
        
        // Filter enabled characters for API request
        const enabledCharacters = processedCharacterPrompts.filter(char => char.enabled);
        
        // Convert to API format: remove chara_name and use_coords from individual characters
        const apiCharacters = enabledCharacters.map(char => ({
            prompt: char.prompt,
            uc: char.uc,
            center: char.center,
            enabled: char.enabled
        }));
        
        if (apiCharacters.length > 0) {
            apiOpts.characterPrompts = apiCharacters;
        }
    }
    
    try {
        imageCounter.logGeneration();
        [img] = await client.generateImage(apiOpts, false, true, true);
        console.log('✅ Image generation completed');
    } catch (error) {
        throw new Error(`❌ Image generation failed: ${error.message}`);
    }
    
    const timestamp = Date.now().toString();
    let namePrefix = presetName || 'generated';
    
    // Generate filename based on whether it's a pipeline or standard generation
    let name;
    if (isPipeline && layer1Seed !== null) {
        name = `${timestamp}_${namePrefix}_${layer1Seed}_${seed}_pipeline.png`;
    } else {
        name = `${timestamp}_${namePrefix}_${seed}.png`;
    }
    
    const shouldSave = opts.no_save !== true;
    
    if (returnImage) {
        let buffer = Buffer.from(img.data);
        
        // Prepare forge metadata
        const forgeData = {
            date_generated: Date.now(),
            request_type: isPipeline ? 'pipeline' : 'preset',
            generation_type: 'regular',
            upscale_ratio: null,
            upscaled_at: null
        };
        
        // Add disabled characters and character names to forge metadata if present

        if (opts.input_character_prompts) {
            forgeData.allCharacters = opts.input_character_prompts;
            if (opts.use_coords !== undefined) {
                forgeData.use_coords = opts.use_coords;
            }
        } else if (opts.allCharacterPrompts && Array.isArray(opts.allCharacterPrompts) && opts.allCharacterPrompts.length > 0) {
            // Post-process character prompts for forge metadata: replace 1girl/1boy with girl/boy
            const processedCharacterPrompts = opts.allCharacterPrompts.map(char => ({
                ...char,
                prompt: char.prompt.replace(/1girl/g, "girl").replace(/1boy/g, "boy")
            }));
            
            const disabledCharacters = [];
            const characterNames = [];
            
            processedCharacterPrompts.forEach((char, index) => {
                characterNames.push(char.chara_name);
                if (!char.enabled) {
                    disabledCharacters.push({
                        index: index,
                        prompt: char.prompt,
                        uc: char.uc,
                        center: char.center,
                        chara_name: char.chara_name
                    });
                }
            });
            
            if (disabledCharacters.length > 0) {
                forgeData.disabledCharacters = disabledCharacters;
            }
            if (characterNames.length > 0) {
                forgeData.characterNames = characterNames;
            }
            
            // Save use_coords setting if present
            if (opts.use_coords !== undefined) {
                forgeData.use_coords = opts.use_coords;
            }
        }
        
        // Preserve existing preset_name if it exists, otherwise set new one
        if (presetName) {
            forgeData.preset_name = presetName;
        }
        
        if (layer1Seed !== null) {
            forgeData.layer1_seed = layer1Seed;
        }

        // Add image source info if applicable
        if ((opts.action === Action.IMG2IMG || opts.action === Action.INPAINT) && opts.image) {
            forgeData.generation_type = 'img2img';
            if (opts.image_source) {
                forgeData.image_source = opts.image_source;
            }
            if (opts.image_bias !== undefined) {
                forgeData.image_bias = opts.image_bias;
            }
            if (opts.mask_compressed !== undefined) {
                forgeData.mask_compressed = opts.mask_compressed;
            } else if (opts.mask !== undefined) {
                forgeData.mask = opts.mask;
            }
            if (opts.mask_bias !== undefined ) {
                forgeData.mask_bias = opts.mask_bias;
            }
            if (opts.strength !== undefined) {
                forgeData.img2img_strength = opts.strength;
            }
            if (opts.noise !== undefined) {
                forgeData.img2img_noise = opts.noise;
            }
        }
        
        // Save unprocessed input values
        if (opts.input_prompt !== undefined) {
            forgeData.input_prompt = opts.input_prompt;
        }
        if (opts.input_uc !== undefined) {
            forgeData.input_uc = opts.input_uc;
        }
        // Add new parameters to forge data
        if (opts.dataset_config !== undefined) {
            forgeData.dataset_config = opts.dataset_config;
        }
        if (opts.append_quality !== undefined) {
            forgeData.append_quality = opts.append_quality;
        }
        if (opts.append_uc !== undefined) {
            forgeData.append_uc = opts.append_uc;
        }
        
        // Add vibe transfer data to forge data
        if (opts.vibe_transfer !== undefined) {
            forgeData.vibe_transfer = opts.vibe_transfer;
        }
        if (opts.normalize_vibes !== undefined) {
            forgeData.normalize_vibes = opts.normalize_vibes;
        }
        
        // Update buffer with forge metadata
        buffer = updateMetadata(buffer, forgeData);
        
        if (shouldSave) {
            fs.writeFileSync(path.join(imagesDir, name), buffer);
            console.log(`💾 Saved: ${name}`);
            
            // Add file to workspace
            const targetWorkspaceId = workspaceId || getActiveWorkspace();
            addToWorkspaceArray('files', name, targetWorkspaceId);
            
            // Generate preview
            const baseName = getBaseName(name);
            const previewFile = getPreviewFilename(baseName);
            const previewPath = path.join(previewsDir, previewFile);
            await generatePreview(path.join(imagesDir, name), previewPath);
            console.log(`📸 Generated preview: ${previewFile}`);
        }
        
        if (opts.upscale !== undefined) {
            const scale = opts.upscale === true ? 4 : opts.upscale;
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const { width: upscaleWidth, height: upscaleHeight } = await getImageDimensions(buffer);
            const scaledBuffer = await upscaleImage(buffer, scale, upscaleWidth, upscaleHeight);
            
            // Update upscaled buffer with additional forge metadata
            const upscaledForgeData = {
                upscale_ratio: scale,
                upscaled_at: Date.now(),
                generation_type: 'upscaled'
            };
            const updatedScaledBuffer = updateMetadata(scaledBuffer, upscaledForgeData);
        
            if (shouldSave) {
                const upscaledName = name.replace('.png', '_upscaled.png');
                fs.writeFileSync(path.join(imagesDir, upscaledName), updatedScaledBuffer);
                console.log(`💾 Saved: ${upscaledName}`);
                
                // Add upscaled file to workspace
                const targetWorkspaceId = workspaceId || getActiveWorkspace();
                addToWorkspaceArray('files', upscaledName, targetWorkspaceId);
                
                // Update preview with upscaled version
                const baseName = getBaseName(name);
                const previewFile = getPreviewFilename(baseName);
                const previewPath = path.join(previewsDir, previewFile);
                await generatePreview(path.join(imagesDir, upscaledName), previewPath);
                console.log(`📸 Updated preview with upscaled version: ${previewFile}`);
            }
            
            // Return result with appropriate seed information
            const result = { buffer: updatedScaledBuffer, filename: name, saved: shouldSave, seed: seed };
            if (isPipeline && layer1Seed !== null) {
                result.layer1Seed = layer1Seed;
            }
            return result;
        }
        
        // Return result with appropriate seed information
        const finalResult = { buffer, filename: name, saved: shouldSave, seed: seed };
        if (isPipeline && layer1Seed !== null) {
            finalResult.layer1Seed = layer1Seed;
        }
        return finalResult;
    } else {
        // Save image and return filename only (legacy behavior)
        if (shouldSave) {
            const filePath = path.join(imagesDir, name);
            await img.save(filePath);
            console.log(`💾 Saved: ${name}`);
            
            // Generate preview
            const baseName = getBaseName(name);
            const previewFile = getPreviewFilename(baseName);
            const previewPath = path.join(previewsDir, previewFile);
            await generatePreview(path.join(imagesDir, name), previewPath);
            console.log(`📸 Generated preview: ${previewFile}`);
        }
        
        // Return result with appropriate seed information
        const result = { filename: name, saved: shouldSave, seed: seed };
        if (isPipeline && layer1Seed !== null) {
            result.layer1Seed = layer1Seed;
        }
        return result;
    }
}

const upscaleImage = async (imageBuffer, scale = 4, width, height) => {
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
                    Accept: "*/*",
                    "Accept-Language": "en-US,en;q=0.5",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Content-Type": "application/json",
                    Host: "api.novelai.net",
                    Origin: "https://novelai.net",
                    Referer: "https://novelai.net",
                    DNT: "1",
                    "Sec-GPC": "1",
                    Connection: "keep-alive",
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "same-site",
                    Priority: "u=0",
                    Pragma: "no-cache",
                    "Cache-Control": "no-cache",
                    TE: "trailers",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0",
                    'Content-Length': Buffer.byteLength(postData),
                    'Authorization': `Bearer ${config.apiKey}`
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
                    console.log('❌ Upscale API request error:', error.message);
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
        console.log('❌ Upscaling failed:', error.message);
        return imageBuffer;
    }
};

// Helper function for common endpoint logic
const handleImageRequest = async (req, res, opts, presetName = null) => {
    const workspaceId = req.body.workspace || req.query.workspace || null;
    const result = await handleGeneration(opts, true, presetName, workspaceId);
    
    // Check if optimization is requested
    const optimize = req.query.optimize === 'true';
    
    let finalBuffer = result.buffer;
    let contentType = 'image/png';
    
    if (optimize) {
        try {
            finalBuffer = await sharp(result.buffer)
                .jpeg({ quality: 75 })
                .toBuffer();
            contentType = 'image/jpeg';
        } catch (error) {
            console.log('❌ Image optimization failed:', error.message);
        }
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename, X-Seed');
    
    if (result && result.filename) {
        res.setHeader('X-Generated-Filename', result.filename);
    } else {
        console.log('❌ No filename available in result:', result);
    }
    
    // Add seed to response header
    if (result && result.seed !== undefined) {
        res.setHeader('X-Seed', result.seed.toString());
    }
    if (req.query.download === 'true') {
        const extension = optimize ? 'jpg' : 'png';
        const optimizedFilename = result.filename.replace('.png', `.${extension}`);
        res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
    }
    res.send(finalBuffer);
};


// Helper functions for cache management
function generateTagKey(tagName) {
    return tagName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function generateQueryHash(query, model) {
    return crypto.createHash('md5').update(`${query}_${model}`).digest('hex');
}

// Enhanced preset handling functions
function selectPresetItem(presetConfig, modelKey, combinedPrompt, providedId = null) {
    if (!presetConfig || !presetConfig[modelKey]) {
        return null;
    }
    
    const modelPresets = presetConfig[modelKey];
    
    // Handle simple string/array format (backward compatibility)
    if (typeof modelPresets === 'string' || (Array.isArray(modelPresets) && typeof modelPresets[0] === 'string')) {
        if (typeof modelPresets === 'string') {
            return { value: modelPresets, id: 'default' };
        } else {
            const index = Math.min(Math.max(providedId - 1, 0), modelPresets.length - 1) || 0;
            return { value: modelPresets[index], id: index + 1 };
        }
    }
    
    // Handle new enhanced format with sub-items
    if (Array.isArray(modelPresets) && modelPresets.length > 0 && typeof modelPresets[0] === 'object') {
        // If specific ID provided, find it
        if (providedId) {
            const foundItem = modelPresets.find(item => item.id === providedId);
            if (foundItem) {
                return { value: foundItem.value, id: foundItem.id, name: foundItem.name };
            }
        }
        
        // Automatic selection based on tag matching
        const lowerCombinedPrompt = combinedPrompt.toLowerCase();
        
        for (const item of modelPresets) {
            if (item.match && Array.isArray(item.match)) {
                for (const matchTag of item.match) {
                    if (lowerCombinedPrompt.includes(matchTag.toLowerCase())) {
                        return { value: item.value, id: item.id, name: item.name };
                    }
                }
            }
        }
        
        // Default to first item if no matches found
        const defaultItem = modelPresets[0];
        return { value: defaultItem.value, id: defaultItem.id, name: defaultItem.name };
    }
    
    return null;
}

// Auto-complete endpoint - search characters and tags
app.get('/search/prompt', authMiddleware, async (req, res) => {
    try {
        const query = req.query.q;
        const model = req.query.m;
        if (!query || query.trim().length < 2) {
            return res.json([]);
        }
        if (!model || model.trim().length < 2) {
            return res.json([]);
        }

        if (!Model[model.toUpperCase()]) {
            return res.json([]);
        }
        
        const searchTerm = query.trim().toLowerCase();
        const queryHash = generateQueryHash(searchTerm, model);
        
        // Initialize model in cache if not exists
        if (!tagSuggestionsCache.queries[model]) {
            tagSuggestionsCache.queries[model] = {};
        }
        
        // Check cache for this query
        let tagSuggestions = [];
        let cacheHit = false;
        
        if (tagSuggestionsCache.queries[model][queryHash]) {
            // Get tags from cache using stored objects (key, model, confidence)
            const tagObjs = tagSuggestionsCache.queries[model][queryHash];
            tagSuggestions = tagObjs.map(obj => {
                const tag = tagSuggestionsCache.tags[obj.key];
                if (tag) {
                    return {
                        ...tag,
                        model: obj.model,
                        confidence: obj.confidence
                    };
                }
                return null;
            }).filter(Boolean);
            cacheHit = true;
        } else {
            // Check for startsWith matches in queries
            const startsWithHashes = Object.keys(tagSuggestionsCache.queries[model]).filter(hash => {
                // We need to check if the original query starts with our search term
                // For now, we'll skip this optimization and rely on exact matches
                return false;
            });
            
            if (startsWithHashes.length > 0) {
                const allTagObjs = [];
                startsWithHashes.forEach(hash => {
                    tagSuggestionsCache.queries[model][hash].forEach(obj => allTagObjs.push(obj));
                });
                tagSuggestions = allTagObjs.map(obj => {
                    const tag = tagSuggestionsCache.tags[obj.key];
                    if (tag) {
                        return {
                            ...tag,
                            model: obj.model,
                            confidence: obj.confidence
                        };
                    }
                    return null;
                }).filter(Boolean);
                cacheHit = true;
            }
        }
        
        // If no cache hit, make API calls
        if (!cacheHit) {
            const makeTagRequest = async (apiModel) => {
                const url = `https://image.novelai.net/ai/generate-image/suggest-tags?model=${apiModel}&prompt=${encodeURIComponent(query)}`;
                
                const options = {
                    method: 'GET',
                    headers: {
                        'accept': '*/*',
                        'accept-language': 'en-US,en;q=0.9',
                        'authorization': `Bearer ${config.apiKey}`,
                        'cache-control': 'no-cache',
                        'content-type': 'application/json',
                        'pragma': 'no-cache',
                        'priority': 'u=1, i',
                        'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"Windows"',
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-site',
                        'Referer': 'https://novelai.net/'
                    }
                };
                
                return new Promise((resolve, reject) => {
                    const urlObj = new URL(url);
                    const req = https.request({
                        hostname: urlObj.hostname,
                        port: 443,
                        path: urlObj.pathname + urlObj.search,
                        method: 'GET',
                        headers: options.headers
                    }, (res) => {
                        let data = [];
                        res.on('data', chunk => data.push(chunk));
                        res.on('end', () => {
                            const buffer = Buffer.concat(data);
                            if (res.statusCode === 200) {
                                try {
                                    const response = JSON.parse(buffer.toString());
                                    resolve(response);
                                } catch (e) {
                                    reject(new Error('Invalid JSON response from NovelAI API'));
                                }
                            } else {
                                reject(new Error(`Tag suggestion API error: HTTP ${res.statusCode}`));
                            }
                        });
                    });
                    
                    req.on('error', error => {
                        reject(error);
                    });
                    
                    req.end();
                });
            };
            
            try {
                // Determine models to query
                const currentModel = Model[model.toUpperCase()] || 'nai-diffusion-4-5-full';
                const models = [currentModel];
                
                // Add furry model if not already included
                if (currentModel !== 'nai-diffusion-furry-3') {
                    models.push('nai-diffusion-furry-3');
                }
                
                // Make parallel API calls
                const apiResults = await Promise.all(models.map(m => makeTagRequest(m)));
                
                // Process and normalize tags
                const queryTagObjs = [];
                const allTags = [];
                
                apiResults.forEach((response, index) => {
                    const apiModel = models[index];
                    if (response && response.tags) {
                        response.tags.forEach(tag => {
                            const tagKey = generateTagKey(tag.tag);
                            
                            // Update or create tag in cache
                            if (!tagSuggestionsCache.tags[tagKey]) {
                                tagSuggestionsCache.tags[tagKey] = {
                                    tag: tag.tag,
                                    models: [],
                                    count: tag.count
                                };
                            }
                            
                            // Add model if not already present
                            if (!tagSuggestionsCache.tags[tagKey].models.some(m => m.model === apiModel)) {
                                tagSuggestionsCache.tags[tagKey].models.push({
                                    model: apiModel,
                                    count: tag.count,
                                    confidence: tag.confidence
                                });
                            }
                            
                            // Update count to highest
                            tagSuggestionsCache.tags[tagKey].count = Math.max(tagSuggestionsCache.tags[tagKey].count, tag.count);
                            
                            // Store object with key, model, and confidence
                            queryTagObjs.push({ key: tagKey, model: apiModel, confidence: tag.confidence });
                            allTags.push({
                                ...tag,
                                model: apiModel,
                                tagKey: tagKey
                            });
                        });
                    }
                });
                
                // Store query in cache as array of objects
                tagSuggestionsCache.queries[model][queryHash] = [...queryTagObjs];
                tagSuggestions = allTags;
                
                // Mark cache as dirty and schedule save
                cacheDirty = true;
                scheduleCacheSave();
                
                console.log(`💾 Cached tag suggestions for "${searchTerm}" with model "${model}"`);
                
            } catch (error) {
                console.log('❌ Tag suggestion API error:', error.message);
                // Continue without tag suggestions
            }
        }
        
        // Sort tag suggestions: by confidence (lower is higher), then by count (highest)
        tagSuggestions.sort((a, b) => {
            if (a.confidence !== b.confidence) {
                return a.confidence - b.confidence; // Lower confidence first
            }
            return b.count - a.count; // Higher count first
        });
        
        // Search through character data array directly
        const characterResults = [];
        characterDataArray.forEach((character) => {
            if (character.name && character.name.toLowerCase().includes(searchTerm)) {
                characterResults.push({
                    type: 'character',
                    name: character.name,
                    character: character, // Include full character data
                    count: 5000 // Characters get medium priority
                });
            }
        });
        
        // Convert tag suggestions to consistent format
        const tagResults = tagSuggestions.map(tag => ({
            type: 'tag',
            name: tag.tag,
            count: tag.count,
            confidence: tag.confidence,
            model: tag.model
        }));
        
        // Deduplicate tag names, prioritizing requested model over nai-diffusion-furry-3
        const dedupedTagMap = new Map();
        for (const tag of tagResults) {
            if (!dedupedTagMap.has(tag.name)) {
                dedupedTagMap.set(tag.name, tag);
            } else {
                // If duplicate, prefer the requested model over nai-diffusion-furry-3
                const existing = dedupedTagMap.get(tag.name);
                if (
                    tag.model === model ||
                    (existing.model === 'nai-diffusion-furry-3' && tag.model !== 'nai-diffusion-furry-3')
                ) {
                    dedupedTagMap.set(tag.name, tag);
                }
            }
        }
        const dedupedTagResults = Array.from(dedupedTagMap.values());
        
        // Combine results: high count tags (>5000) go to top, characters in middle, low count tags at bottom
        const highCountTags = dedupedTagResults.filter(item => item.count > 5000);
        const lowCountTags = dedupedTagResults.filter(item => item.count <= 5000);
        
        // Sort high count tags by confidence, then count
        highCountTags.sort((a, b) => {
            if (a.confidence !== b.confidence) {
                return a.confidence - b.confidence;
            }
            return b.count - a.count;
        });
        
        // Sort low count tags by confidence, then count
        lowCountTags.sort((a, b) => {
            if (a.confidence !== b.confidence) {
                return a.confidence - b.confidence;
            }
            return b.count - a.count;
        });
        
        // Final result order: high count tags, characters (limited), low count tags
        const finalResults = [...highCountTags, ...characterResults.slice(0, 25), ...lowCountTags];
        
        res.json(finalResults);
        
    } catch (error) {
        console.log('❌ Auto-complete search error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/preset/search', authMiddleware, async (req, res) => {
    try {
        const query = req.query.q;
        if (!query || query.trim().length < 2) {
            return res.json([]);
        }
        
        const searchTerm = query.trim().toLowerCase();
        const currentPromptConfig = loadPromptConfig();
        const results = [];
        
        // Search through presets
        Object.keys(currentPromptConfig.presets).forEach(presetName => {
            if (presetName.toLowerCase().includes(searchTerm)) {
                const preset = currentPromptConfig.presets[presetName];
                results.push({
                    name: presetName,
                    model: preset.model || 'v4_5',
                    resolution: preset.resolution || '',
                    upscale: preset.upscale || false,
                    allow_paid: preset.allow_paid || false,
                    variety: preset.variety || false,
                    character_prompts: preset.characterPrompts && preset.characterPrompts.length > 0,
                    base_image: preset.image || preset.image_source
                });
            }
        });
        
        // Limit results to 10 items
        const limitedResults = results.slice(0, 10);
        
        res.json(limitedResults);
        
    } catch (error) {
        console.log('❌ Preset auto-complete search error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/preset/:name', authMiddleware, async (req, res) => {
    try {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) {
        return res.status(404).json({ error: 'Preset not found' });
    }
    
    // Check if force generation is requested
    const forceGenerate = req.query.forceGenerate === 'true';
    
    if (!forceGenerate) {
        // Try to get cached image
        const cacheKey = getPresetCacheKey(req.params.name, req.query);
        const cached = getCachedPreset(cacheKey);
        
        if (cached) {
            console.log('📤 Returning cached image');
                
                // Read the cached file from disk
                const filePath = path.join(imagesDir, cached.filename);
                const fileBuffer = fs.readFileSync(filePath);
            
            // Check if optimization is requested
            const optimize = req.query.optimize === 'true';
                let finalBuffer = fileBuffer;
            let contentType = 'image/png';
            
            if (optimize) {
                try {
                        finalBuffer = await sharp(fileBuffer)
                        .jpeg({ quality: 75 })
                        .toBuffer();
                    contentType = 'image/jpeg';
                } catch (error) {
                    console.log('❌ Image optimization failed:', error.message);
                }
            }
            
            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
            if (cached && cached.filename) {
                res.setHeader('X-Generated-Filename', cached.filename);
            }
            if (req.query.download === 'true') {
                const extension = optimize ? 'jpg' : 'png';
                const optimizedFilename = cached.filename.replace('.png', `.${extension}`);
                res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
            }
            res.send(finalBuffer);
            return;
        }
    }
    
    // Build options for generation
    const opts = await buildOptions(p.model, {}, p, req.query);
    const workspaceId = req.body.workspace || req.query.workspace || null;
    let result = await handleGeneration(opts, true, req.params.name, workspaceId);
    // Cache the result if generation was successful
    if (!forceGenerate) {
        const cacheKey = getPresetCacheKey(req.params.name, req.query);
            setCachedPreset(cacheKey, result.filename);
    }
    // Check if optimization is requested
    const optimize = req.query.optimize === 'true';
    let finalBuffer = result.buffer;
    let contentType = 'image/png';
    if (optimize) {
        try {
            finalBuffer = await sharp(result.buffer)
                .jpeg({ quality: 75 })
                .toBuffer();
            contentType = 'image/jpeg';
        } catch (error) {
            console.log('❌ Image optimization failed:', error.message);
            // Fall back to original PNG if optimization fails
        }
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
    if (result && result.filename) {
        res.setHeader('X-Generated-Filename', result.filename);
    }
    if (req.query.download === 'true') {
        const extension = optimize ? 'jpg' : 'png';
        const optimizedFilename = result.filename.replace('.png', `.${extension}`);
        res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
    }
    res.send(finalBuffer);
    } catch(e) {
        console.log('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});

app.options('/preset/:name', authMiddleware, async (req, res) => {
    try {
        const currentPromptConfig = loadPromptConfig();
        const p = currentPromptConfig.presets[req.params.name];
        if (!p) {
            return res.status(404).json({ error: 'Preset not found' });
        }
        
        // Return the raw preset data without processing text replacements
        res.json({
            name: req.params.name,
            prompt: (p.prompt !== undefined ? p.prompt : ''),
            uc: (p.uc !== undefined ? p.uc : ''),
            model: (p.model !== undefined ? p.model : 'v4_5'),
            resolution: (p.resolution !== undefined ? p.resolution : 'normal_portrait'),
            steps: (p.steps !== undefined ? p.steps : 25),
            guidance: (p.guidance !== undefined ? p.guidance : 5.0),
            rescale: (p.rescale !== undefined ? p.rescale : 0.0),
            seed: p.seed || undefined,
            sampler: p.sampler || undefined,
            noiseScheduler: p.noiseScheduler || undefined,
            upscale: (p.upscale !== undefined ? p.upscale : false),
            allow_paid: (p.allow_paid !== undefined ? p.allow_paid : false),
            variety: (p.variety !== undefined ? p.variety : false),
            image: p.image || undefined,
            strength: (p.strength !== undefined ? p.strength : undefined),
            noise: (p.noise !== undefined ? p.noise : undefined),
            image_bias: (p.image_bias !== undefined ? p.image_bias : undefined),
            mask: p.mask || undefined,
            mask_compressed: p.mask_compressed || undefined,
            mask_bias: (p.mask_bias !== undefined ? p.mask_bias : undefined),
            characterPrompts: (p.characterPrompts !== undefined ? p.characterPrompts : []),
            allCharacterPrompts: (p.allCharacterPrompts !== undefined ? p.allCharacterPrompts : []),
            use_coords: p.use_coords || false,
            width: (p.width !== undefined ? p.width : undefined),
            height: (p.height !== undefined ? p.height : undefined),
            image_source: (p.image_source !== undefined ? p.image_source : undefined)
        });
    } catch(e) {
        console.log('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});

app.put('/preset/:name', authMiddleware, async (req, res) => {
    try {
        const presetName = req.params.name;
        const presetData = req.body;

        if (!presetName || !presetData.prompt || !presetData.model) {
            return res.status(400).json({ error: 'Preset name, prompt, and model are required' });
        }

        const currentPromptConfig = loadPromptConfig();

        // Only set default if value is missing (null or undefined)
        function withDefault(val, def) {
            return (val === undefined || val === null) ? def : val;
        }

        currentPromptConfig.presets[presetName] = {
            prompt: presetData.prompt,
            uc: withDefault(presetData.uc, ''),
            model: presetData.model,
            resolution: withDefault(presetData.resolution, ''),
            steps: withDefault(presetData.steps, 25),
            guidance: withDefault(presetData.guidance, 5.0),
            rescale: withDefault(presetData.rescale, 0.0),
            seed: withDefault(presetData.seed, undefined),
            sampler: withDefault(presetData.sampler, undefined),
            noiseScheduler: withDefault(presetData.noiseScheduler, undefined),
            upscale: withDefault(presetData.upscale, undefined),
            allow_paid: withDefault(presetData.allow_paid, false),
            variety: withDefault(presetData.variety, false),
            image: withDefault(presetData.image, undefined),
            strength: withDefault(presetData.strength, 0.8),
            noise: withDefault(presetData.noise, 0.1),
            image_bias: withDefault(presetData.image_bias, undefined),
            mask: withDefault(presetData.mask, undefined),
            mask_compressed: withDefault(presetData.mask_compressed, undefined),
            characterPrompts: withDefault(presetData.allCharacterPrompts, withDefault(presetData.characterPrompts, [])),
            use_coords: withDefault(presetData.use_coords, false),
            width: withDefault(presetData.width, undefined),
            height: withDefault(presetData.height, undefined),
            image_source: withDefault(presetData.image_source, undefined)
        };

        fs.writeFileSync('./prompt.config.json', JSON.stringify(currentPromptConfig, null, 2));

        console.log(`💾 Saved new preset: ${presetName}`);

        res.json({ success: true, message: `Preset "${presetName}" saved successfully` });

    } catch(e) {
        console.log('❌ Error occurred in preset save:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/preset/:name/:resolution', authMiddleware, async (req, res) => {
    try {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) {
        return res.status(404).json({ error: 'Preset not found' });
    }
    
    const resolution = req.params.resolution;
    if (!Resolution[resolution.toUpperCase()]) {
        return res.status(400).json({ error: 'Invalid resolution' });
    }
    
    // Check if force generation is requested
    const forceGenerate = req.query.forceGenerate === 'true';
    
    if (!forceGenerate) {
        // Try to get cached image
        const cacheKey = getPresetCacheKey(req.params.name, { ...req.query, resolution });
        const cached = getCachedPreset(cacheKey);
        
        if (cached) {
            console.log('📤 Returning cached image');
                
                // Read the cached file from disk
                const filePath = path.join(imagesDir, cached.filename);
                const fileBuffer = fs.readFileSync(filePath);
            
            // Check if optimization is requested
            const optimize = req.query.optimize === 'true';
                let finalBuffer = fileBuffer;
            let contentType = 'image/png';
            
            if (optimize) {
                try {
                        finalBuffer = await sharp(fileBuffer)
                        .jpeg({ quality: 75 })
                        .toBuffer();
                    contentType = 'image/jpeg';
                } catch (error) {
                    console.log('❌ Image optimization failed:', error.message);
                }
            }
            
            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
            if (cached && cached.filename) {
                res.setHeader('X-Generated-Filename', cached.filename);
            }
            if (req.query.download === 'true') {
                const extension = optimize ? 'jpg' : 'png';
                const optimizedFilename = cached.filename.replace('.png', `.${extension}`);
                res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
            }
            res.send(finalBuffer);
            return;
        }
    }
    
    const bodyOverrides = { resolution };
    // Build options for generation
    const opts = await buildOptions(p.model, bodyOverrides, p, req.query);
    const workspaceId = req.body.workspace || req.query.workspace || null;
    let result = await handleGeneration(opts, true, req.params.name, workspaceId);
    // Cache the result if generation was successful
    if (!forceGenerate) {
        const cacheKey = getPresetCacheKey(req.params.name, { ...req.query, resolution });
            setCachedPreset(cacheKey, result.filename);
    }
    // Check if optimization is requested
    const optimize = req.query.optimize === 'true';
    let finalBuffer = result.buffer;
    let contentType = 'image/png';
    if (optimize) {
        try {
            finalBuffer = await sharp(result.buffer)
                .jpeg({ quality: 75 })
                .toBuffer();
            contentType = 'image/jpeg';
        } catch (error) {
            console.log('❌ Image optimization failed:', error.message);
            // Fall back to original PNG if optimization fails
        }
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
    if (result && result.filename) {
        res.setHeader('X-Generated-Filename', result.filename);
    }
    if (req.query.download === 'true') {
        const extension = optimize ? 'jpg' : 'png';
        const optimizedFilename = result.filename.replace('.png', `.${extension}`);
        res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
    }
    res.send(finalBuffer);
    } catch(e) {
        console.log('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});

app.options('/', authMiddleware, (req, res) => {
    try {
        const currentPromptConfig = loadPromptConfig();
        const cacheStatus = getCacheStatus();
        
        // Filter out _INP models and use pretty names
        const modelEntries = Object.keys(Model)
            .filter(key => !key.endsWith('_INP'))
            .map(key => [key, getModelDisplayName(key)]);
        const modelEntriesShort = Object.keys(Model)
            .filter(key => !key.endsWith('_INP'))
            .map(key => [key, getModelDisplayName(key,true)]);

        // Helper to extract relevant preset info
        const extractPresetInfo = (name, preset) => ({
            name,
            model: preset.model || 'Default',
            upscale: preset.upscale || false,
            allow_paid: preset.allow_paid || false,
            variety: preset.variety || false,
            character_prompts: preset.character_prompts || false,
            base_image: preset.base_image || false,
            resolution: preset.resolution || 'Default',
            steps: preset.steps || 25,
            guidance: preset.guidance || 5.0,
            rescale: preset.rescale || 0.0,
            sampler: preset.sampler || null,
            noiseScheduler: preset.noiseScheduler || null
        });

        // Helper to resolve pipeline layer info (copied from OPTIONS /pipeline/:name)
        const resolveLayerInfo = (layer) => {
            if (typeof layer === 'string') {
                // It's a preset name, resolve the preset
                const preset = currentPromptConfig.presets[layer];
                if (preset) {
                    return {
                        type: 'preset',
                        name: layer,
                        model: preset.model || 'Default',
                        upscale: preset.upscale || false,
                        allow_paid: preset.allow_paid || false,
                        variety: preset.variety || false,
                        character_prompts: preset.character_prompts || false,
                        base_image: preset.base_image || false
                    };
                }
            } else if (typeof layer === 'object' && layer !== null) {
                // It's an inline preset
                return {
                    type: 'inline',
                    model: layer.model || 'Default',
                    upscale: layer.upscale || false,
                    allow_paid: layer.allow_paid || false,
                    variety: layer.variety || false,
                    character_prompts: layer.character_prompts || false,
                    base_image: layer.base_image || false
                };
            }
            return {
                type: 'unknown',
                model: 'Default',
                upscale: false,
                allow_paid: false,
                variety: false,
                character_prompts: false,
                base_image: false
            };
        };

        // Build detailed preset info
        const detailedPresets = Object.entries(currentPromptConfig.presets || {}).map(
            ([name, preset]) => extractPresetInfo(name, preset)
        );

        // Build detailed pipeline info
        const detailedPipelines = Object.entries(currentPromptConfig.pipelines || {}).map(
            ([name, pipeline]) => ({
                name,
                layer1: {
                    type: typeof pipeline.layer1 === 'string' ? 'preset' : 'inline',
                    value: typeof pipeline.layer1 === 'string' ? pipeline.layer1 : 'inline preset',
                    info: resolveLayerInfo(pipeline.layer1)
                },
                layer2: {
                    type: typeof pipeline.layer2 === 'string' ? 'preset' : 'inline',
                    value: typeof pipeline.layer2 === 'string' ? pipeline.layer2 : 'inline preset',
                    info: resolveLayerInfo(pipeline.layer2)
                },
                resolution: pipeline.resolution
            })
        );

        const options = {
            models: Object.fromEntries(modelEntries),
            modelsShort: Object.fromEntries(modelEntriesShort),
            actions: Object.fromEntries(Object.keys(Action).map(key => [key, Action[key]])),
            samplers: Object.fromEntries(Object.keys(Sampler).map(key => [key, Sampler[key]])),
            noiseSchedulers: Object.fromEntries(Object.keys(Noise).map(key => [key, Noise[key]])),
            resolutions: Object.fromEntries(Object.keys(Resolution).map(key => [key, Resolution[key]])),
            presets: detailedPresets,
            pipelines: detailedPipelines,
            textReplacements: currentPromptConfig.text_replacements || {},
            datasets: currentPromptConfig.datasets || [],
            quality_presets: currentPromptConfig.quality_presets || {},
            uc_presets: currentPromptConfig.uc_presets || {},
            cache: {
                enabled: true,
                ttl: "30 minutes",
                entries: cacheStatus.totalEntries,
                clearEndpoint: "/cache/clear"
            }
        }
        res.json(options);
    } catch(e) {
        console.log('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /balance (get balance information)
app.get('/balance', authMiddleware, async (req, res) => {
    try {
        const options = {
            hostname: 'api.novelai.net',
            port: 443,
            path: '/user/subscription',
            method: 'GET',
            headers: {
                Accept: "*/*",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "",
                "Content-Type": "application/json",
                Host: "api.novelai.net",
                Origin: "https://novelai.net",
                Referer: "https://novelai.net",
                DNT: "1",
                "Sec-GPC": "1",
                Connection: "keep-alive",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-site",
                Priority: "u=0",
                Pragma: "no-cache",
                "Cache-Control": "no-cache",
                TE: "trailers",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0",
                'Authorization': `Bearer ${config.apiKey}`
            }
        };
        
        const balanceData = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = [];
                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(data);
                    if (res.statusCode === 200) {
                        try {
                            const response = JSON.parse(buffer.toString());
                            resolve(response);
                        } catch (e) {
                            reject(new Error('Invalid JSON response from NovelAI API'));
                        }
                    } else {
                        try {
                            const errorResponse = JSON.parse(buffer.toString());
                            reject(new Error(`Balance API error: ${errorResponse.error || 'Unknown error'}`));
                        } catch (e) {
                            reject(new Error(`Balance API error: HTTP ${res.statusCode}`));
                        }
                    }
                });
            });
            
            req.on('error', error => {
                console.log('❌ Balance API request error:', error.message);
                reject(error);
            });
            
            req.end();
        });
        
        // Extract training steps information
        const fixedTrainingStepsLeft = balanceData?.trainingStepsLeft?.fixedTrainingStepsLeft || 0;
        const purchasedTrainingSteps = balanceData?.trainingStepsLeft?.purchasedTrainingSteps || 0;
        const totalCredits = fixedTrainingStepsLeft + purchasedTrainingSteps;
        
        res.json({
            fixedTrainingStepsLeft,
            purchasedTrainingSteps,
            totalCredits,
            subscription: balanceData
        });
        
    } catch (error) {
        console.error('Balance check error:', error);
        res.status(500).json({ error: error.message });
    }
});

async function executePipeline(pipelineName, queryParams = {}, customPipeline = null, providedLayer1Seed = null, workspaceId = null) {
    try {
        
        const currentPromptConfig = loadPromptConfig();
        const pipeline = customPipeline || currentPromptConfig.pipelines[pipelineName];
        
        
        if (!pipeline) {
            throw new Error(`Pipeline "${pipelineName}" not found`);
        }
        
        // Validate pipeline components
        if (!pipeline.layer1 || !pipeline.layer2 || !pipeline.resolution) {
            throw new Error('Pipeline must have layer1, layer2, and resolution defined');
        }
        
        
        // Helper function to get preset data (string = preset name, object = inline preset)
        const getPresetData = (layer) => {
            if (typeof layer === 'string') {
                // String: lookup preset by name
                const preset = currentPromptConfig.presets[layer];
                if (!preset) {
                    throw new Error(`Preset "${layer}" not found`);
                }
                return preset;
            } else if (typeof layer === 'object' && layer !== null) {
                // Object: inline preset
                if (!layer.prompt || !layer.model) {
                    throw new Error('Inline preset must have prompt and model defined');
                }
                return layer;
            } else {
                throw new Error('Layer must be either a preset name (string) or inline preset (object)');
            }
        };
        
        // Get preset data for layer2
        const preset2 = getPresetData(pipeline.layer2);
        
        // Ensure model name is properly formatted for validation
        const modelName = preset2.model.toUpperCase();
        const inpaintingModelName = modelName + "_INP";
        
        
        if (!Model[inpaintingModelName]) {
            throw new Error(`Pipeline layer2 model "${inpaintingModelName}" does not have an inpainting model`);
        }

        // Use resolution from query params if provided, otherwise use pipeline's resolution
        const resolution = queryParams.resolution || pipeline.resolution;
        
        console.log(`🚀 Starting pipeline: ${pipelineName}`);
        console.log(`   Layer 1: ${(pipeline.layer1_type && pipeline.layer1_type.startsWith('image_')) ? 'input image' : (typeof pipeline.layer1 === 'string' ? pipeline.layer1 : 'inline')} (${resolution})`);
        console.log(`   Layer 2: ${typeof pipeline.layer2 === 'string' ? pipeline.layer2 : 'inline'} (inpainting)`);
        
        let baseImage;
        let layer1Seed = null;
        
        // Step 1: Handle layer1 based on type
        if (pipeline.layer1_type === 'image_path') {
            // Load image from file path and process to match target resolution
            const imagePath = path.join(imagesDir, pipeline.layer1);
            if (!fs.existsSync(imagePath)) {
                throw new Error(`Image file not found: ${pipeline.layer1}`);
            }
            const imageBuffer = fs.readFileSync(imagePath);
            
            // Process image to match target resolution (crop center, then scale)
            const targetDims = getDimensionsFromResolution(resolution);
            if (!targetDims) {
                throw new Error(`Invalid resolution: ${resolution}`);
            }
            
            const processedBuffer = await processDynamicImage(imageBuffer, targetDims);
            baseImage = processedBuffer.toString('base64');
            console.log(`📸 Loaded and processed predefined image from file: ${pipeline.layer1} (${targetDims.width}x${targetDims.height})`);
        } else if (pipeline.layer1_type === 'image_base64') {
            // Process base64 image to match target resolution
            const imageBuffer = Buffer.from(pipeline.layer1, 'base64');
            
            // Process image to match target resolution (crop center, then scale)
            const targetDims = getDimensionsFromResolution(resolution);
            if (!targetDims) {
                throw new Error(`Invalid resolution: ${resolution}`);
            }
            
            const processedBuffer = await processDynamicImage(imageBuffer, targetDims);
            baseImage = processedBuffer.toString('base64');
            console.log(`📸 Processed predefined base64 image to target resolution (${targetDims.width}x${targetDims.height})`);
        } else {
            // Default: Generate base image using layer1 preset (prompt type)
            const preset1 = getPresetData(pipeline.layer1);
            
            // Build options for layer1
            const layer1Opts = await buildOptions(preset1.model, {}, preset1, queryParams);
            if (!layer1Opts.width && !layer1Opts.height) {
                layer1Opts.resPreset = Resolution[resolution.toUpperCase()];
            }
            layer1Opts.upscale = false; 
            layer1Opts.no_save = true; // Don't save the intermediate base image
            
            // Use provided seed if available (for rerolling)
            if (providedLayer1Seed !== null) {
                layer1Opts.seed = providedLayer1Seed;
                console.log(`🔢 Using provided layer1 seed: ${providedLayer1Seed}`);
            }
            
            if (preset1.image) {
                console.log(`📸 Generating layer1 img2img with ${typeof pipeline.layer1 === 'string' ? pipeline.layer1 : 'inline preset'} (strength: ${preset1.strength}, noise: ${preset1.noise})...`);
            } else {
                console.log(`📸 Generating base image with ${typeof pipeline.layer1 === 'string' ? pipeline.layer1 : 'inline preset'}...`);
            }
            
            const baseResult = await handleGeneration(layer1Opts, true, typeof pipeline.layer1 === 'string' ? pipeline.layer1 : 'inline', workspaceId);
            baseImage = (baseResult.buffer).toString('base64');
            layer1Seed = baseResult.seed;
        }
        
        // Step 2: Generate and pad mask in one operation
        let maskBias = (queryParams.mask_bias !== undefined) ? parseInt(queryParams.mask_bias) : 2; // default center
        let targetDims = getDimensionsFromResolution(resolution);
        if (!targetDims) {
            throw new Error(`Invalid resolution: ${resolution}`);
        }
        
        let mask;
        let pipelineMaskCompressed = null;
        
        if (pipeline.mask_compressed) {
            try {
                // Process compressed mask using the same logic as buildOptions
                const maskBuffer = Buffer.from(pipeline.mask_compressed, 'base64');
                const processedMaskBuffer = await resizeMaskWithCanvas(maskBuffer, targetDims.width, targetDims.height);
                mask = processedMaskBuffer.toString('base64');
                pipelineMaskCompressed = pipeline.mask_compressed;
                console.log(`🎭 Processed pipeline compressed mask to ${targetDims.width}x${targetDims.height}`);
            } catch (error) {
                console.error('❌ Failed to process pipeline compressed mask:', error.message);
                // Fallback to regular mask processing
                const maskResult = await generateAndPadMask(pipeline.mask, targetDims, maskBias);
                mask = typeof maskResult === 'string' ? maskResult : maskResult.toString('base64');
            }
        } else if (pipeline.mask) {
            // Auto-convert standard mask to compressed mask if no compressed mask exists
            try {
                // Convert standard mask to compressed format (1/8 scale)
                const compressedWidth = Math.floor(targetDims.width / 8);
                const compressedHeight = Math.floor(targetDims.height / 8);
                
                // Create a temporary canvas to resize the mask
                const { createCanvas, loadImage } = require('canvas');
                const maskBuffer = Buffer.from(pipeline.mask, 'base64');
                const maskImage = await loadImage(maskBuffer);
                
                const tempCanvas = createCanvas(compressedWidth, compressedHeight);
                const tempCtx = tempCanvas.getContext('2d');
                
                // Fill with black background
                tempCtx.fillStyle = 'black';
                tempCtx.fillRect(0, 0, compressedWidth, compressedHeight);
                
                // Disable image smoothing for nearest neighbor scaling
                tempCtx.imageSmoothingEnabled = false;
                
                // Draw the mask scaled down to compressed size
                tempCtx.drawImage(maskImage, 0, 0, compressedWidth, compressedHeight);
                
                // Binarize the image data to ensure crisp 1-bit mask
                const imageData = tempCtx.getImageData(0, 0, compressedWidth, compressedHeight);
                const data = imageData.data;
                
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    
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
                
                // Put the binarized image data back
                tempCtx.putImageData(imageData, 0, 0);
                
                // Convert to base64 and store as compressed mask
                const compressedMaskBase64 = tempCanvas.toBuffer('image/png').toString('base64');
                pipelineMaskCompressed = compressedMaskBase64;
                
                console.log(`🔄 Auto-converted pipeline standard mask to compressed format (${compressedWidth}x${compressedHeight})`);
            } catch (error) {
                console.error('❌ Failed to auto-convert pipeline standard mask to compressed:', error.message);
                // Continue with original mask if conversion fails
            }
            
            // Use regular mask processing
            const maskResult = await generateAndPadMask(pipeline.mask, targetDims, maskBias);
            mask = typeof maskResult === 'string' ? maskResult : maskResult.toString('base64');
        } else {
            // No mask provided
            mask = null;
        }
        
        // Step 3: Generate inpainting image using layer2 preset
        const layer2Opts = await buildOptions(preset2.model, {}, preset2, queryParams);
        layer2Opts.n_samples = 1;
        layer2Opts.inpaintImg2ImgStrength = pipeline.inpainting_strength || 1;
        layer2Opts.action = Action.INPAINT;
        layer2Opts.model = Model[inpaintingModelName];
        layer2Opts.image = baseImage;
        layer2Opts.mask = mask;
        if (pipelineMaskCompressed) {
            layer2Opts.mask_compressed = pipelineMaskCompressed;
        }
        if (!layer2Opts.height && !layer2Opts.width) {
            layer2Opts.resPreset = Resolution[resolution.toUpperCase()];
        }
        layer2Opts.strength = 1; // Default inpainting strength
        layer2Opts.noise = 0.1;
        
        // Pass layer1Seed and pipelineName as parameters
        layer2Opts.layer1Seed = layer1Seed;
        layer2Opts.pipelineName = pipelineName;
        layer2Opts.isPipeline = true;
        
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log(`🎨 Generating inpainting with ${typeof pipeline.layer2 === 'string' ? pipeline.layer2 : 'inline preset'}...`);
        const finalResult = await handleGeneration(layer2Opts, true, pipelineName, workspaceId);
        
        console.log(`✅ Pipeline completed: ${pipelineName}`);
        return finalResult;
        
    } catch (error) {
        console.error(`❌ Pipeline execution failed: ${error.message}`);
        throw error;
    }
}

// POST /pipeline/generate (manually run a custom pipeline)
app.post('/pipeline/generate', authMiddleware, async (req, res) => {
    try {
        
        const { layer1: layer1Input, layer1_type: layer1TypeInput, layer2: layer2Input, mask: maskInput, mask_compressed: maskCompressedInput, resolution: resolutionInput, preset, layer1_seed, layer2_seed, inpainting_strength, mask_bias } = req.body;
        
        // Convert seeds to integers if they are strings
        const layer1SeedInt = layer1_seed !== undefined ? parseInt(layer1_seed) : undefined;
        const layer2SeedInt = layer2_seed !== undefined ? parseInt(layer2_seed) : undefined;
        
        
        // If preset name is provided, load it and use body values as overrides
        let customPipeline; // Declare at function level
        
        if (preset) {
            const currentPromptConfig = loadPromptConfig();
            const existingPipeline = currentPromptConfig.pipelines[preset];
            
            
            if (!existingPipeline) {
                return res.status(404).json({ error: `Pipeline preset "${preset}" not found` });
            }
            
            // Start with existing pipeline values
            customPipeline = {
                ...existingPipeline
            };
            
            // Override with provided values (only if they exist)
            if (layer1Input !== undefined) {
                customPipeline.layer1 = layer1Input;
                if (layer1TypeInput !== undefined) {
                    customPipeline.layer1_type = layer1TypeInput;
                }
            }
            
            // Validate layer1_type
            const validLayer1Types = ['prompt', 'image_path', 'image_base64'];
            if (customPipeline.layer1_type && !validLayer1Types.includes(customPipeline.layer1_type)) {
                return res.status(400).json({ error: `Invalid layer1_type. Must be one of: ${validLayer1Types.join(', ')}` });
            }
            
            if (layer2Input !== undefined) {
                customPipeline.layer2 = layer2Input;
            }
            if (maskInput !== undefined) {
                customPipeline.mask = maskInput;
            }
            if (maskCompressedInput !== undefined) {
                customPipeline.mask_compressed = maskCompressedInput;
            }
            if (resolutionInput !== undefined) {
                customPipeline.resolution = resolutionInput;
            }
            if (inpainting_strength !== undefined) {
                customPipeline.inpainting_strength = inpainting_strength;
            }
            
            // Handle layer1 overrides (merge objects if both are objects)
            if (layer1Input !== undefined && typeof layer1Input === 'object' && layer1Input !== null) {
                if (typeof existingPipeline.layer1 === 'object' && existingPipeline.layer1 !== null) {
                    customPipeline.layer1 = {
                        ...existingPipeline.layer1,
                        ...layer1Input
                    };
                } else {
                    customPipeline.layer1 = layer1Input;
                }
            }
            
            // Handle layer2 overrides (merge objects if both are objects)
            if (layer2Input !== undefined && typeof layer2Input === 'object' && layer2Input !== null) {
                if (typeof existingPipeline.layer2 === 'object' && existingPipeline.layer2 !== null) {
                    customPipeline.layer2 = {
                        ...existingPipeline.layer2,
                        ...layer2Input
                    };
                } else {
                    customPipeline.layer2 = layer2Input;
                }
            }
            
            // Add seeds if provided
            if (layer1SeedInt !== undefined) {
                if (typeof customPipeline.layer1 === 'object' && (!customPipeline.layer1_type || customPipeline.layer1_type === 'prompt')) {
                    customPipeline.layer1.seed = layer1SeedInt;
                }
            }
            
            if (layer2SeedInt !== undefined) {
                if (typeof customPipeline.layer2 === 'object') {
                    customPipeline.layer2.seed = layer2SeedInt;
                }
            }
            
            // Validate the final pipeline
            if (!customPipeline.layer1 || !customPipeline.layer2 || !customPipeline.resolution) {
                return res.status(400).json({ error: 'Pipeline must have layer1, layer2, and resolution defined (either from preset or provided values)' });
            }
            
            // Validate resolution
            if (!Resolution[customPipeline.resolution.toUpperCase()]) {
                return res.status(400).json({ error: `Invalid resolution: ${customPipeline.resolution}` });
            }
        } else {
            // No preset provided - all required fields must be present
            if (!layer1Input || !layer2Input || !resolutionInput) {
                return res.status(400).json({ error: 'layer1, layer2, and resolution are required when no preset is provided' });
            }
            
            // Validate resolution
            if (!Resolution[resolutionInput.toUpperCase()]) {
                return res.status(400).json({ error: `Invalid resolution: ${resolutionInput}` });
            }
            
            // Validate layer1_type
            const validLayer1Types = ['prompt', 'image_path', 'image_base64'];
            if (layer1TypeInput && !validLayer1Types.includes(layer1TypeInput)) {
                return res.status(400).json({ error: `Invalid layer1_type. Must be one of: ${validLayer1Types.join(', ')}` });
            }
            
            // Create custom pipeline object
            customPipeline = {
                layer1: layer1Input,
                layer1_type: layer1TypeInput || 'prompt',
                layer2: layer2Input,
                mask: maskInput, // Default mask coordinates
                mask_compressed: maskCompressedInput,
                resolution: resolutionInput,
                inpainting_strength: inpainting_strength || 0.7
            };
            
            // Add seeds directly to layer objects if provided
            if (layer1SeedInt !== undefined && typeof layer1Input === 'object') {
                customPipeline.layer1 = { ...layer1Input, seed: layer1SeedInt };
            }
            
            if (layer2SeedInt !== undefined && typeof layer2Input === 'object') {
                customPipeline.layer2 = { ...layer2Input, seed: layer2SeedInt };
            }
        }
        
        // Use preset name if provided, otherwise default to 'generated'
        const pipelineName = preset || 'generated';
        
        console.log(`🚀 Starting custom pipeline generation: ${pipelineName}`);
        
        // Extract mask_bias from request body and add to query parameters
        const queryParams = { ...req.query };
        if (mask_bias !== undefined) {
            queryParams.mask_bias = mask_bias;
        }
        
        // Execute the custom pipeline
        const workspaceId = req.body.workspace || req.query.workspace || null;
        const result = await executePipeline(pipelineName, queryParams, customPipeline, layer1SeedInt, workspaceId);
        
        // Check if optimization is requested
        const optimize = req.query.optimize === 'true';
        let finalBuffer = result.buffer;
        let contentType = 'image/png';
        
        if (optimize) {
            try {
                finalBuffer = await sharp(result.buffer)
                    .jpeg({ quality: 75 })
                    .toBuffer();
                contentType = 'image/jpeg';
            } catch (error) {
                console.log('❌ Image optimization failed:', error.message);
            }
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
        if (result && result.filename) {
            res.setHeader('X-Generated-Filename', result.filename);
        }
        if (req.query.download === 'true') {
            const extension = optimize ? 'jpg' : 'png';
            const optimizedFilename = result.filename.replace('.png', `.${extension}`);
            res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
        }
        res.send(finalBuffer);
        
    } catch (error) {
        console.log('❌ Custom pipeline generation error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Pipeline endpoints
app.get('/pipeline/:name', authMiddleware, async (req, res) => {
    try {
        const pipelineName = req.params.name;
        const currentPromptConfig = loadPromptConfig();
        const pipeline = currentPromptConfig.pipelines[pipelineName];
        
        if (!pipeline) {
            return res.status(404).json({ error: 'Pipeline not found' });
        }
        
        // Check if force generation is requested
        const forceGenerate = req.query.forceGenerate === 'true';
        
        if (!forceGenerate) {
            // Try to get cached image
            const cacheKey = `pipeline_${pipelineName}_${JSON.stringify(req.query)}`;
            const cached = getCachedPreset(cacheKey);
            
            if (cached) {
                console.log('📤 Returning cached pipeline image');
                
                // Read the cached file from disk
                const filePath = path.join(imagesDir, cached.filename);
                const fileBuffer = fs.readFileSync(filePath);
                
                // Check if optimization is requested
                const optimize = req.query.optimize === 'true';
                let finalBuffer = fileBuffer;
                let contentType = 'image/png';
                
                if (optimize) {
                    try {
                        finalBuffer = await sharp(fileBuffer)
                            .jpeg({ quality: 75 })
                            .toBuffer();
                        contentType = 'image/jpeg';
                    } catch (error) {
                        console.log('❌ Image optimization failed:', error.message);
                    }
                }
                
                res.setHeader('Content-Type', contentType);
                res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
                if (cached && cached.filename) {
                    res.setHeader('X-Generated-Filename', cached.filename);
                }
                if (req.query.download === 'true') {
                    const extension = optimize ? 'jpg' : 'png';
                    const optimizedFilename = cached.filename.replace('.png', `.${extension}`);
                    res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
                }
                res.send(finalBuffer);
                return;
            }
        }
        
        // Execute the pipeline
        const layer1_seed = req.query.layer1_seed || null;
        const layer1SeedInt = layer1_seed ? parseInt(layer1_seed) : null;
        const workspaceId = req.body.workspace || req.query.workspace || null;
        const result = await executePipeline(pipelineName, req.query, null, layer1SeedInt, workspaceId);
        
        // Cache the result if generation was successful
        if (!forceGenerate) {
            const cacheKey = `pipeline_${pipelineName}_${JSON.stringify(req.query)}`;
            setCachedPreset(cacheKey, result.filename);
        }
        
        // Check if optimization is requested
        const optimize = req.query.optimize === 'true';
        let finalBuffer = result.buffer;
        let contentType = 'image/png';
        
        if (optimize) {
            try {
                finalBuffer = await sharp(result.buffer)
                    .jpeg({ quality: 75 })
                    .toBuffer();
                contentType = 'image/jpeg';
            } catch (error) {
                console.log('❌ Image optimization failed:', error.message);
            }
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
        if (result && result.filename) {
            res.setHeader('X-Generated-Filename', result.filename);
        }
        if (req.query.download === 'true') {
            const extension = optimize ? 'jpg' : 'png';
            const optimizedFilename = result.filename.replace('.png', `.${extension}`);
            res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
        }
        res.send(finalBuffer);
        
    } catch (error) {
        console.log('❌ Pipeline error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /pipelines (list all pipelines)
app.get('/pipelines', authMiddleware, async (req, res) => {
    try {
        const currentPromptConfig = loadPromptConfig();
        const pipelines = currentPromptConfig.pipelines || {};
        
        const pipelineList = Object.keys(pipelines).map(name => {
            const pipeline = pipelines[name];
            
            // Handle layer1 based on type
            let layer1Info;
            if (pipeline.layer1_type === 'image_path') {
                layer1Info = {
                    type: 'image_path',
                    value: pipeline.layer1
                };
            } else if (pipeline.layer1_type === 'image_base64') {
                layer1Info = {
                    type: 'image_base64',
                    value: 'base64 image data'
                };
            } else {
                // Default: prompt type
                layer1Info = {
                    type: typeof pipeline.layer1 === 'string' ? 'preset' : 'inline',
                    value: typeof pipeline.layer1 === 'string' ? pipeline.layer1 : 'inline preset'
                };
            }
            
            return {
                name,
                layer1: layer1Info,
                layer1_type: pipeline.layer1_type || 'prompt',
                layer2: {
                    type: typeof pipeline.layer2 === 'string' ? 'preset' : 'inline',
                    value: typeof pipeline.layer2 === 'string' ? pipeline.layer2 : 'inline preset'
                },
                resolution: pipeline.resolution
            };
        });
        
        res.json(pipelineList);
        
    } catch (error) {
        console.log('❌ Error occurred:', error);
        res.status(500).json({ error: error.message });
    }
});

// OPTIONS method for pipeline details
app.options('/pipeline/:name', authMiddleware, async (req, res) => {
    try {
        const currentPromptConfig = loadPromptConfig();
        const pipeline = currentPromptConfig.pipelines[req.params.name];
        if (!pipeline) {
            return res.status(404).json({ error: 'Pipeline not found' });
        }
        
        // Check if mask rendering is requested
        if (req.query.render_mask === 'true') {
            // Generate the mask at pipeline resolution
            const pipelineDims = getDimensionsFromResolution(pipeline.resolution);
            if (!pipelineDims) {
                return res.status(400).json({ error: `Invalid pipeline resolution: ${pipeline.resolution}` });
            }
            
            const maskBias = req.query.mask_bias !== undefined ? parseInt(req.query.mask_bias) : 2;
            const maskResult = await generateAndPadMask(pipeline.mask, pipelineDims, maskBias);
            const maskBuffer = typeof maskResult === 'string' ? Buffer.from(maskResult, 'base64') : maskResult;
            
            // Return the mask as base64 in the response
            const maskBase64 = maskBuffer.toString('base64');
            return res.json({
                type: 'pipeline_mask',
                name: req.params.name,
                mask: maskBase64,
                resolution: pipeline.resolution
            });
        }
        
        // Helper function to resolve layer info
        const resolveLayerInfo = (layer) => {
            if (typeof layer === 'string') {
                // It's a preset name, resolve the preset
                const preset = currentPromptConfig.presets[layer];
                if (preset) {
                    return {
                        type: 'preset',
                        name: layer,
                        model: preset.model || 'Default',
                        upscale: preset.upscale || false,
                        allow_paid: preset.allow_paid || false,
                        variety: preset.variety || false,
                        character_prompts: preset.character_prompts || false,
                        base_image: preset.base_image || false
                    };
                }
            } else if (typeof layer === 'object' && layer !== null) {
                // It's an inline preset
                return {
                    type: 'inline',
                    model: layer.model || 'Default',
                    upscale: layer.upscale || false,
                    allow_paid: layer.allow_paid || false,
                    variety: layer.variety || false,
                    character_prompts: layer.character_prompts || false,
                    base_image: layer.base_image || false
                };
            }
            return {
                type: 'unknown',
                model: 'Default',
                upscale: false,
                allow_paid: false,
                variety: false,
                character_prompts: false,
                base_image: false
            };
        };
        
        // Resolve layer information
        const layer1Info = resolveLayerInfo(pipeline.layer1);
        const layer2Info = resolveLayerInfo(pipeline.layer2);
        
        // Return pipeline details for the dropdown
        res.json({
            type: 'pipeline',
            name: req.params.name,
            data: pipeline,
            layer1Info: layer1Info,
            layer2Info: layer2Info
        });
    } catch(e) {
        console.log('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /pipeline/:name/mask (preview the mask as an image)
app.get('/pipeline/:name/mask', authMiddleware, async (req, res) => {
    try {
        const pipelineName = req.params.name;
        const currentPromptConfig = loadPromptConfig();
        const pipeline = currentPromptConfig.pipelines[pipelineName];
        
        if (!pipeline) {
            return res.status(404).json({ error: 'Pipeline not found' });
        }
        
        // Generate the mask at pipeline resolution
        const pipelineDims = getDimensionsFromResolution(pipeline.resolution);
        if (!pipelineDims) {
            return res.status(400).json({ error: `Invalid pipeline resolution: ${pipeline.resolution}` });
        }
        
        const maskResult = await generateAndPadMask(pipeline.mask, pipelineDims, 2); // Default center bias for preview
        const maskBuffer = typeof maskResult === 'string' ? Buffer.from(maskResult, 'base64') : maskResult;
        
        // Return the mask as an image
        res.setHeader('Content-Type', 'image/png');
        res.send(maskBuffer);
        
    } catch (error) {
        console.log('❌ Mask preview error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /pipeline/:name/raw (returns raw pipeline data without text replacement processing)
app.get('/pipeline/:name/raw', authMiddleware, async (req, res) => {
    try {
        const currentPromptConfig = loadPromptConfig();
        const p = currentPromptConfig.pipelines[req.params.name];
        if (!p) {
            return res.status(404).json({ error: 'Pipeline not found' });
        }
        
        // Helper function to get preset data for layers
        const getPresetData = (layer) => {
            if (typeof layer === 'string') {
                // String: lookup preset by name
                const preset = currentPromptConfig.presets[layer];
                if (!preset) {
                    return null;
                }
                return preset;
            } else if (typeof layer === 'object' && layer !== null) {
                // Object: inline preset
                return layer;
            }
            return null;
        };
        
        // Get layer data
        const layer1Data = getPresetData(p.layer1);
        const layer2Data = getPresetData(p.layer2);
        
        // Return the raw pipeline data without processing text replacements
        res.json({
            layer1: layer1Data,
            layer1_type: p.layer1_type || 'prompt',
            layer2: layer2Data,
            resolution: p.resolution || '',
            mask: p.mask || null,
            inpainting_strength: p.inpainting_strength || 0.7
        });
    } catch(e) {
        console.log('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /:model/prompt (direct model, body)
app.post('/:model/prompt', authMiddleware, async (req, res) => {
    try {
    const key = req.params.model.toLowerCase();
    const model = Model[key.toUpperCase()];
    if (!model) return res.status(400).json({ error: 'Invalid model' });
    const opts = await buildOptions(key, req.body, null, req.query);
    res.json({ prompt: opts.prompt, uc: opts.negative_prompt });
    } catch(e) {
        console.log('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST /:model/generate (direct model generation)
app.post('/:model/generate', authMiddleware, queueMiddleware, async (req, res) => {
    try {
        const key = req.params.model.toLowerCase();
        const model = Model[key.toUpperCase()];
        if (!model) {
            return res.status(400).json({ error: 'Invalid model' });
        }

        let body = req.body;
        let baseFilename = null;

        const opts = await buildOptions(key, body, null, req.query);
        // Add original filename for metadata tracking if this is img2img and not a frontend upload
        if (body.image && !body.is_frontend_upload) {
            opts.original_filename = baseFilename;
        }
        const presetName = req.body.preset || null;
        await handleImageRequest(req, res, opts, presetName);
    } catch(e) {
        console.log('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});

// Load character data for auto-complete
let characterDataArray = [];

// Tag suggestions cache management
let tagSuggestionsCache = { tags: {}, queries: {} };
let cacheDirty = false;
let saveTimer = null;

// Initialize cache at startup
function initializeCache() {
    try {
        const characterDataPath = path.join(__dirname, 'characters.json');
        if (fs.existsSync(characterDataPath)) {
            const data = JSON.parse(fs.readFileSync(characterDataPath, 'utf8'));
            characterDataArray = data.data || [];
            console.log(`✅ Loaded ${characterDataArray.length} characters for auto-complete`);
        } else {
            console.log('⚠️  Character data file not found, auto-complete disabled');
        }
    } catch (error) {
        console.error('❌ Error loading character data:', error.message);
    }

    try {
        if (fs.existsSync(cacheFile)) {
            const loadedCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            // Handle migration from old cache format
            if (loadedCache.tags && loadedCache.queries) {
                tagSuggestionsCache = loadedCache;
            } else {
                console.log('🔄 Migrating cache to new format...');
                tagSuggestionsCache = { tags: {}, queries: {} };
            }
            console.log(`✅ Loaded tag suggestions cache with ${Object.keys(tagSuggestionsCache.tags).length} tags`);
        } else {
            console.log('📝 Creating new tag suggestions cache');
        }
    } catch (error) {
        console.log('❌ Error loading tag suggestions cache:', error.message);
        tagSuggestionsCache = { tags: {}, queries: {} };
    }
}

// Delayed save function with atomic file operations
function scheduleCacheSave() {
    if (!cacheDirty) return;
    
    // Clear existing timer
    if (saveTimer) {
        clearTimeout(saveTimer);
    }
    
    // Schedule save in 5 minutes
    saveTimer = setTimeout(() => {
        saveCacheAtomic();
    }, 5 * 60 * 1000); // 5 minutes
}

function saveCacheAtomic() {
    if (!cacheDirty) return;
    
    const tempFile = `${cacheFile}.tmp`;
    
    try {
        // Write to temporary file first
        fs.writeFileSync(tempFile, JSON.stringify(tagSuggestionsCache, null, 2));
        
        // Delete old file if it exists
        if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile);
        }
        
        // Rename temp file to final name
        fs.renameSync(tempFile, cacheFile);
        
        cacheDirty = false;
        console.log(`💾 Tag suggestions cache saved atomically (${Object.keys(tagSuggestionsCache.tags).length} tags)`);
    } catch (error) {
        console.log('❌ Error saving tag suggestions cache:', error.message);
        
        // Clean up temp file if it exists
        if (fs.existsSync(tempFile)) {
            try {
                fs.unlinkSync(tempFile);
            } catch (cleanupError) {
                console.log('❌ Error cleaning up temp cache file:', cleanupError.message);
            }
        }
    }
}

// Initialize cache at startup
initializeCache();

// Test bias adjustment endpoint
app.post('/test-bias-adjustment', async (req, res) => {
    try {
        const { image_source, target_width, target_height, bias } = req.body;
        
        if (!image_source || !target_width || !target_height || !bias) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        
        // Load image from disk based on source
        let imagePath;
        if (image_source.startsWith('file:')) {
            imagePath = path.join(imagesDir, image_source.replace('file:', ''));
        } else if (image_source.startsWith('cache:')) {
            imagePath = path.join(uploadCacheDir, image_source.replace('cache:', ''));
        } else {
            return res.status(400).json({ error: 'Invalid image source format' });
        }
        
        // Check if file exists
        if (!fs.existsSync(imagePath)) {
            return res.status(404).json({ error: 'Image file not found' });
        }
        
        // Read image file
        const imageBuffer = fs.readFileSync(imagePath);
        
        // Process image with dynamic bias
        const processedBuffer = await processDynamicImage(
            imageBuffer, 
            { width: target_width, height: target_height }, 
            bias
        );
        
        // Return the processed image
        res.set('Content-Type', 'image/png');
        res.send(processedBuffer);
        
    } catch (error) {
        console.error('Bias adjustment test error:', error);
        res.status(500).json({ error: 'Failed to process bias adjustment' });
    }
});

// ==================== WORKSPACE API ENDPOINTS ====================


// GET /workspaces (get active workspace info)
app.get('/workspaces', authMiddleware, (req, res) => {
    try {
        const activeId = getActiveWorkspace();
        const workspace = getWorkspace(activeId);
        
        if (!workspace) {
            return res.status(404).json({ error: 'Active workspace not found' });
        }
        
        res.json({
            id: activeId,
            name: workspace.name,
            color: workspace.color || '#124', // Default color if missing
            backgroundColor: workspace.backgroundColor, // Can be null for auto-generation
            backgroundImage: workspace.backgroundImage, // Can be null for no background image
            backgroundOpacity: workspace.backgroundOpacity || 0.3, // Default opacity
            fileCount: workspace.files.length,
            presetCount: workspace.presets.length,
            pipelineCount: workspace.pipelines.length,
            cacheFileCount: workspace.cacheFiles.length
        });
    } catch (error) {
        console.log('❌ Error getting active workspace:', error);
        res.status(500).json({ error: error.message });
    }
});
// OPTIONS /workspaces (list all workspaces)
app.options('/workspaces', authMiddleware, (req, res) => {
    try {
        const workspaces = getWorkspaces();
        const activeWorkspaceId = getActiveWorkspace();
        
        // Transform to include workspace metadata
        const workspaceList = Object.entries(workspaces).map(([id, workspace]) => ({
            id,
            name: workspace.name,
            color: workspace.color || '#124', // Default color if missing
            backgroundColor: workspace.backgroundColor, // Can be null for auto-generation
            backgroundImage: workspace.backgroundImage, // Can be null for no background image
            backgroundOpacity: workspace.backgroundOpacity || 0.3, // Default opacity
            fileCount: workspace.files.length,
            presetCount: workspace.presets.length,
            pipelineCount: workspace.pipelines.length,
            cacheFileCount: workspace.cacheFiles.length,
            isActive: id === activeWorkspaceId,
            isDefault: id === 'default'
        }));
        
        res.json({
            workspaces: workspaceList,
            activeWorkspace: activeWorkspaceId
        });
    } catch (error) {
        console.log('❌ Error listing workspaces:', error);
        res.status(500).json({ error: error.message });
    }
});
// POST /workspaces (create new workspace)
app.post('/workspaces', authMiddleware, (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Workspace name is required' });
        }
        
        // Validate color format if provided
        if (color && color.trim()) {
            const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
            if (!colorRegex.test(color.trim())) {
                return res.status(400).json({ error: 'Invalid color format. Use hex format (e.g., #ff4500)' });
            }
        }
        
        const workspaceId = createWorkspace(name.trim(), color ? color.trim() : null);
        res.json({ success: true, id: workspaceId, name: name.trim() });
    } catch (error) {
        console.log('❌ Error creating workspace:', error);
        res.status(500).json({ error: error.message });
    }
});
// PUT /workspaces/:id (rename workspace)
app.put('/workspaces/:id', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'New name is required' });
        }
        
        renameWorkspace(id, name.trim());
        res.json({ success: true, message: `Workspace renamed to "${name.trim()}"` });
    } catch (error) {
        console.log('❌ Error renaming workspace:', error);
        res.status(500).json({ error: error.message });
    }
});
// DELETE /workspaces/:id (delete workspace)
app.delete('/workspaces/:id', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        deleteWorkspace(id);
        res.json({ success: true, message: 'Workspace deleted and items moved to default' });
    } catch (error) {
        console.log('❌ Error deleting workspace:', error);
        res.status(500).json({ error: error.message });
    }
});

// Upload endpoint
app.post('/workspaces/:id/images', authMiddleware, upload.array('images', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No image files provided' });
        }
        
        const results = [];
        const errors = [];
        
        for (const file of req.files) {
            try {
                const filename = file.filename;
                const filePath = path.join(imagesDir, filename);
                
                // Generate preview
                const baseName = getBaseName(filename);
                const previewFile = getPreviewFilename(baseName);
                const previewPath = path.join(previewsDir, previewFile);
                
                await generatePreview(filePath, previewPath);
                console.log(`📸 Generated preview: ${previewFile}`);
                
                // Add basic forge metadata for uploaded image
                const imageBuffer = fs.readFileSync(filePath);
                const forgeData = {
                    date_generated: Date.now(),
                    generation_type: 'uploaded',
                    request_type: 'upload'
                };
                const updatedBuffer = updateMetadata(imageBuffer, forgeData);
                fs.writeFileSync(filePath, updatedBuffer);
                
                console.log(`💾 Uploaded: ${filename}`);

                // Add to workspace
                addToWorkspaceArray('files', filename, req.params.id);
                
                results.push({
                    success: true,
                    filename: filename,
                    originalName: file.originalname
                });
                
            } catch (error) {
                console.log(`❌ Upload error for ${file.originalname}:`, error.message);
                errors.push({
                    filename: file.originalname,
                    error: error.message
                });
            }
        }
        
        const successCount = results.length;
        const errorCount = errors.length;
        
        res.json({ 
            success: true, 
            message: `Uploaded ${successCount} images${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
            results: results,
            errors: errors,
            totalUploaded: successCount,
            totalErrors: errorCount
        });
        
    } catch(e) {
        console.log('❌ Upload error:', e.message);
        res.status(500).json({ error: e.message });
    }
});
// PUT /workspaces/:id/activate (set active workspace)
app.put('/workspaces/:id/activate', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        setActiveWorkspace(id);
        res.json({ success: true, activeWorkspace: id });
    } catch (error) {
        console.log('❌ Error setting active workspace:', error);
        res.status(500).json({ error: error.message });
    }
});
// POST /workspaces/:sourceId/dump (dump workspace into another)
app.post('/workspaces/:sourceId/dump', authMiddleware, (req, res) => {
    try {
        const { sourceId } = req.params;
        const { targetId } = req.body;
        
        if (!targetId) {
            return res.status(400).json({ error: 'Target workspace ID is required' });
        }
        
        dumpWorkspace(sourceId, targetId);
        res.json({ success: true, message: 'Workspace dumped successfully' });
    } catch (error) {
        console.log('❌ Error dumping workspace:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /workspaces/:id/files (get workspace files)
app.get('/workspaces/:id/files', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const workspace = getWorkspace(id);
        
        if (!workspace) {
            return res.status(404).json({ error: 'Workspace not found' });
        }
        
        // Get workspace files (including default workspace files)
        const workspaceFiles = new Set();
        
        // Always include default workspace files
        const defaultWorkspace = getWorkspace('default');
        if (defaultWorkspace && defaultWorkspace.files) {
            defaultWorkspace.files.forEach(file => workspaceFiles.add(file));
        }
        
        // Include current workspace files if not default
        if (id !== 'default' && workspace.files) {
            workspace.files.forEach(file => workspaceFiles.add(file));
        }
        
        res.json({
            workspaceId: id,
            workspaceName: workspace.name,
            files: Array.from(workspaceFiles)
        });
    } catch (error) {
        console.log('❌ Error getting workspace files:', error);
        res.status(500).json({ error: error.message });
    }
});
// PUT /workspaces/:id/files (move files to workspace)
app.put('/workspaces/:id/files', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { filenames } = req.body;
        
        if (!Array.isArray(filenames) || filenames.length === 0) {
            return res.status(400).json({ error: 'Filenames array is required' });
        }
        
        const movedCount = moveFilesToWorkspace(filenames, id);
        res.json({ success: true, message: `Moved ${movedCount} files to workspace`, movedCount });
    } catch (error) {
        console.log('❌ Error moving files to workspace:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /workspaces/:id/scraps (get workspace scraps)
app.get('/workspaces/:id/scraps', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const workspace = getWorkspace(id);
        
        if (!workspace) {
            return res.status(404).json({ error: 'Workspace not found' });
        }
        
        // Get scraps for the requested workspace (scraps are shared across workspaces)
        const scraps = getActiveWorkspaceScraps();
        
        res.json({
            workspaceId: id,
            workspaceName: workspace.name,
            scraps: scraps
        });
    } catch (error) {
        console.log('❌ Error getting workspace scraps:', error);
        res.status(500).json({ error: error.message });
    }
});
// PUT /workspaces/:id/scraps (add file to scraps)
app.put('/workspaces/:id/scraps', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { filename } = req.body;
        
        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        
        addToWorkspaceArray('scraps', filename, id);
        res.json({ success: true, message: 'File added to scraps' });
    } catch (error) {
        console.log('❌ Error adding file to scraps:', error);
        res.status(500).json({ error: error.message });
    }
});
// DELETE /workspaces/:id/scraps (remove file from scraps)
app.delete('/workspaces/:id/scraps', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { filename } = req.body;
        
        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        
        removeFromWorkspaceArray('scraps', filename, id);
        res.json({ success: true, message: 'File removed from scraps' });
    } catch (error) {
        console.log('❌ Error removing file from scraps:', error);
        res.status(500).json({ error: error.message });
    }
});


// List cache files for browsing with workspace filtering
app.options('/references', authMiddleware, (req, res) => {
    try {
        // Get cache files for active workspace (includes default + active workspace)
        const workspaceCacheFiles = getActiveWorkspaceCacheFiles();
        
        // Get all files in cache directory
        const allFiles = fs.readdirSync(uploadCacheDir);
        
        // Filter to only include files that belong to the current workspace
        const files = allFiles.filter(file => workspaceCacheFiles.includes(file));
        
        const cacheFiles = [];
        
        for (const file of files) {
            const filePath = path.join(uploadCacheDir, file);
            const stats = fs.statSync(filePath);
            const previewPath = path.join(previewCacheDir, `${file}.webp`);
            
            // Determine which workspace this file belongs to
            const workspaces = getWorkspacesData();
            const activeWorkspace = getActiveWorkspaceData();
            let workspaceId = 'default';
            if (activeWorkspace !== 'default' && workspaces[activeWorkspace] && workspaces[activeWorkspace].cacheFiles.includes(file)) {
                workspaceId = activeWorkspace;
            }
            
            cacheFiles.push({
                hash: file,
                filename: file,
                mtime: stats.mtime,
                size: stats.size,
                hasPreview: fs.existsSync(previewPath),
                workspaceId: workspaceId
            });
        }
        
        // Sort by newest first
        cacheFiles.sort((a, b) => b.mtime - a.mtime);
        res.json(cacheFiles);
    } catch (error) {
        console.error('Error reading cache directory:', error);
        res.status(500).json({ error: 'Failed to load cache files' });
    }
});
// List cache files for browsing with workspace filtering
app.options('/workspaces/:id/references', authMiddleware, (req, res) => {
    try {
        // Get cache files for active workspace (includes default + active workspace)
        const workspaceCacheFiles = getActiveWorkspaceCacheFiles(req.params.id);
        
        // Get all files in cache directory
        const allFiles = fs.readdirSync(uploadCacheDir);
        
        // Filter to only include files that belong to the current workspace
        const files = allFiles.filter(file => workspaceCacheFiles.includes(file));
        
        const cacheFiles = [];
        
        for (const file of files) {
            const filePath = path.join(uploadCacheDir, file);
            const stats = fs.statSync(filePath);
            const previewPath = path.join(previewCacheDir, `${file}.webp`);
            
            cacheFiles.push({
                hash: file,
                filename: file,
                mtime: stats.mtime,
                size: stats.size,
                hasPreview: fs.existsSync(previewPath)
            });
        }
        
        // Sort by newest first
        cacheFiles.sort((a, b) => b.mtime - a.mtime);
        res.json(cacheFiles);
    } catch (error) {
        console.error('Error reading cache directory:', error);
        res.status(500).json({ error: 'Failed to load cache files' });
    }
});
// Delete cache file
app.delete('/workspaces/:id/references/:hash', authMiddleware, (req, res) => {
    try {
        const hash = req.params.hash;
        const filePath = path.join(uploadCacheDir, hash);
        const previewPath = path.join(previewCacheDir, `${hash}.webp`);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Cache file not found' });
        }
        
        // Delete main file
        fs.unlinkSync(filePath);
        
        // Delete preview if it exists
        if (fs.existsSync(previewPath)) {
            fs.unlinkSync(previewPath);
        }

        removeFromWorkspaceArray('cacheFiles', hash, req.params.id);
        
        res.json({ success: true });
        console.log(`✅ Cache file deleted: ${hash}\n`);
    } catch(e) {
        console.log('❌ Error occurred:', e);
        res.status(500).json({ error: e.message });
    }
});
// PUT /workspaces/:id/references (move cache files to workspace)
app.put('/workspaces/:id/references', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { hashes } = req.body;
        
        if (!Array.isArray(hashes) || hashes.length === 0) {
            return res.status(400).json({ error: 'Hashes array is required' });
        }
        
        const movedCount = moveToWorkspaceArray('cacheFiles', hashes, id);
        res.json({ success: true, message: `Moved ${movedCount} cache files to workspace`, movedCount });
    } catch (error) {
        console.log('❌ Error moving cache files to workspace:', error);
        res.status(500).json({ error: error.message });
    }
});
// POST /upload/:id/references (upload base image to cache)
app.post('/workspaces/:id/references', authMiddleware, cacheUpload.single('image'), async (req, res) => {
    const { id } = req.params;
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const imageBuffer = req.file.buffer;
        const hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
        const uploadPath = path.join(uploadCacheDir, hash);
        const previewPath = path.join(previewCacheDir, `${hash}.webp`);

        // Check if file already exists
        if (fs.existsSync(uploadPath) && fs.existsSync(previewPath)) {
            console.log(`✅ Cache hit for uploaded image: ${hash}`);
            return res.json({ success: true, hash: hash });
        }

        // Save original image to upload cache
        fs.writeFileSync(uploadPath, imageBuffer);
        console.log(`💾 Saved to upload cache: ${hash}`);

        // Add cache file to workspace
        addToWorkspaceArray('cacheFiles', hash, id);

        // Generate and save preview
        await sharp(imageBuffer)
            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(previewPath);
        console.log(`📸 Generated cached preview: ${hash}.webp`);
        
        res.json({ success: true, hash: hash });

    } catch (e) {
        console.log('❌ Base image upload error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// GET /workspaces/active/color (get active workspace color for bokeh)
app.get('/workspaces/active/color', authMiddleware, (req, res) => {
    try {
        const activeId = getActiveWorkspace();
        const workspace = getWorkspace(activeId);
        
        if (!workspace) {
            return res.status(404).json({ error: 'Active workspace not found' });
        }
        
        res.json({ 
            color: workspace.color || '#124', // Default color if missing
            backgroundColor: workspace.backgroundColor, // Can be null for auto-generation
            backgroundImage: workspace.backgroundImage, // Can be null for no background image
            backgroundOpacity: workspace.backgroundOpacity || 0.3, // Default opacity
            workspaceId: activeId,
            workspaceName: workspace.name
        });
    } catch (error) {
        console.log('❌ Error getting active workspace color:', error);
        res.status(500).json({ error: error.message });
    }
});
// PUT /workspaces/:id/color (update workspace color)
app.put('/workspaces/:id/color', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { color } = req.body;
        
        if (!color || !color.trim()) {
            return res.status(400).json({ error: 'Color is required' });
        }
        
        // Validate color format (simple hex validation)
        const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
        if (!colorRegex.test(color.trim())) {
            return res.status(400).json({ error: 'Invalid color format. Use hex format (e.g., #ff4500)' });
        }
        
        updateWorkspaceColor(id, color.trim());
        res.json({ success: true, message: `Workspace color updated to "${color.trim()}"` });
    } catch (error) {
        console.log('❌ Error updating workspace color:', error);
        res.status(500).json({ error: error.message });
    }
});
// PUT /workspaces/:id/background-color (update workspace background color)
app.put('/workspaces/:id/background-color', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { backgroundColor } = req.body;
        
        // Background color can be null for auto-generation
        if (backgroundColor !== null && backgroundColor !== undefined) {
            if (!backgroundColor.trim()) {
                return res.status(400).json({ error: 'Background color cannot be empty' });
            }
            
            // Validate color format (simple hex validation)
            const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
            if (!colorRegex.test(backgroundColor.trim())) {
                return res.status(400).json({ error: 'Invalid color format. Use hex format (e.g., #ff4500)' });
            }
        }
        
        updateWorkspaceBackgroundColor(id, backgroundColor ? backgroundColor.trim() : null);
        res.json({ success: true, message: `Workspace background color updated` });
    } catch (error) {
        console.log('❌ Error updating workspace background color:', error);
        res.status(500).json({ error: error.message });
    }
});
// PUT /workspaces/:id/background-image (update workspace background image)
app.put('/workspaces/:id/background-image', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { backgroundImage } = req.body;
        
        // Background image can be null for no background image
        if (backgroundImage !== null && backgroundImage !== undefined) {
            if (!backgroundImage.trim()) {
                return res.status(400).json({ error: 'Background image cannot be empty' });
            }
        }
        
        updateWorkspaceBackgroundImage(id, backgroundImage ? backgroundImage.trim() : null);
        res.json({ success: true, message: `Workspace background image updated` });
    } catch (error) {
        console.log('❌ Error updating workspace background image:', error);
        res.status(500).json({ error: error.message });
    }
});
// PUT /workspaces/:id/background-opacity (update workspace background opacity)
app.put('/workspaces/:id/background-opacity', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { backgroundOpacity } = req.body;
        
        if (backgroundOpacity === null || backgroundOpacity === undefined) {
            return res.status(400).json({ error: 'Background opacity is required' });
        }
        
        const opacity = parseFloat(backgroundOpacity);
        if (isNaN(opacity) || opacity < 0 || opacity > 1) {
            return res.status(400).json({ error: 'Background opacity must be a number between 0 and 1' });
        }
        
        updateWorkspaceBackgroundOpacity(id, opacity);
        res.json({ success: true, message: `Workspace background opacity updated` });
    } catch (error) {
        console.log('❌ Error updating workspace background opacity:', error);
        res.status(500).json({ error: error.message });
    }
});

// Graceful shutdown handling
function gracefulShutdown() {
    console.log('🛑 Graceful shutdown initiated...');
    
    // Save cache immediately if dirty
    if (cacheDirty) {
        console.log('💾 Saving cache before shutdown...');
        saveCacheAtomic();
    }
    
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

app.listen(config.port, () => console.log(`Server running on port ${config.port}`));

// --- Add endpoint for frontend to fetch counter ---
app.get('/image-counter', authMiddleware, (req, res) => {
    res.json({ count: imageCounter.getCount() });
});

// Add /queue-status endpoint
app.get('/queue-status', authMiddleware, (req, res) => {
    res.json(getQueueStatus());
});