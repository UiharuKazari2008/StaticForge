const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const { NovelAI, Model, Action, Sampler, Noise, Resolution, calculateCost } = require('nekoai-js');
const config = require('./config.json');
const zlib = require('zlib');

// Import modules
const { authMiddleware } = require('./modules/auth');
const { loadPromptConfig, applyTextReplacements, getUsedReplacements } = require('./modules/textReplacements');
const { getPresetCacheKey, getCachedPreset, setCachedPreset, clearPresetCache, getCacheStatus } = require('./modules/cache');
const { queueMiddleware } = require('./modules/queue');

console.log(config);

// Initialize NovelAI client
const client = new NovelAI({ token: config.apiKey });

// Create Express app
const app = express();
app.use(express.json());

// Serve static files from public directory
app.use(express.static('public'));

// Public routes (no authentication required)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const imagesDir = path.resolve(__dirname, 'images');
const previewsDir = path.resolve(__dirname, '.previews');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);
if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir);

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

// Helper: Get resolution name from dimensions
function getResolutionFromDimensions(width, height) {
    const key = `${width}x${height}`;
    return dimensionsMap[key] || null;
}

// Helper: get base name for pairing
function getBaseName(filename) {
    return filename.replace(/_upscaled(?=\.)/, '').replace(/\.(png|jpg|jpeg)$/i, '');
}

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
        if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
        if (file.includes('_upscaled')) baseMap[base].upscaled = file;
        else baseMap[base].original = file;
    }
    // Generate missing previews
    for (const base in baseMap) {
        const previewFile = getPreviewFilename(base);
        const previewPath = path.join(previewsDir, previewFile);
        if (!fs.existsSync(previewPath)) {
            // Prefer upscaled for preview, else original
            const imgFile = baseMap[base].upscaled || baseMap[base].original;
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

// Updated /images endpoint
app.get('/images', async (req, res) => {
    try {
        const files = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
        const baseMap = {};
        for (const file of files) {
            const base = getBaseName(file);
            if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
            if (file.includes('_upscaled')) baseMap[base].upscaled = file;
            else baseMap[base].original = file;
        }
        const gallery = [];
        for (const base in baseMap) {
            const { original, upscaled } = baseMap[base];
            const file = upscaled || original;
            if (!file) continue;
            const filePath = path.join(imagesDir, file);
            const stats = fs.statSync(filePath);
            const preview = getPreviewFilename(base);
            gallery.push({
                base,
                original,
                upscaled,
                preview,
                mtime: stats.mtime,
                size: stats.size
            });
        }
        // Sort by newest first
        gallery.sort((a, b) => b.mtime - a.mtime);
        res.json(gallery);
    } catch (error) {
        console.error('Error reading images directory:', error);
        res.status(500).json({ error: 'Failed to load images' });
    }
});

// Serve preview images
app.get('/previews/:preview', (req, res) => {
    const previewFile = req.params.preview;
    const previewPath = path.join(previewsDir, previewFile);
    if (!fs.existsSync(previewPath)) {
        return res.status(404).json({ error: 'Preview not found' });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(previewFile, { root: previewsDir });
});

// Serve individual image files
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

// Apply queue middleware (runs before logging)
app.use(queueMiddleware);

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

// Utility functions
const getImageDimensions = async buffer => {
    try {
        const metadata = await sharp(buffer).metadata();
        return { width: metadata.width, height: metadata.height };
    } catch (error) {
        throw new Error('Failed to get image dimensions: ' + error.message);
    }
};

async function saveImage(img, filename) {
    const filePath = path.join(imagesDir, filename);
    await img.save(filePath);
}

// Build options for image generation
const buildOptions = (model, body, preset = null, isImg2Img = false, queryParams = {}) => {
    const resolution = body.resolution || preset?.resolution;
    const allowPaid = body.allow_paid !== undefined ? body.allow_paid : preset?.allow_paid;
    const skip_cfg_above_sigma = (body.variety || preset?.variety) ? 59.04722600415217 : undefined;
    
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
    const rawPrompt = body.prompt || preset?.prompt;
    const rawNegativePrompt = body.uc || preset?.uc;
    
    // Handle upscale override from query parameters
    let upscaleValue = body.upscale || preset?.upscale;
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
        const processedPrompt = applyTextReplacements(rawPrompt, presetName, model);
        const processedNegativePrompt = applyTextReplacements(rawNegativePrompt, presetName, model);
        
        const usedPromptReplacements = getUsedReplacements(rawPrompt, model);
        const usedNegativeReplacements = getUsedReplacements(rawNegativePrompt, model);
        
        if (usedPromptReplacements.length > 0 || usedNegativeReplacements.length > 0) {
            console.log(`🔄 Text replacements: ${[...usedPromptReplacements, ...usedNegativeReplacements].join(', ')}`);
        }

    const baseOptions = {
        prompt: processedPrompt,
        negative_prompt: processedNegativePrompt,
        model: Model[model.toUpperCase()],
            steps,
            scale: body.guidance || preset?.guidance || 5.5,
            cfg_rescale: body.rescale || preset?.rescale || 0.0,
            skip_cfg_above_sigma,
            sampler: body.sampler ? Sampler[body.sampler.toUpperCase()] : (preset?.sampler ? Sampler[preset.sampler.toUpperCase()] : Sampler.EULER_ANC),
            noiseScheduler: body.noiseScheduler ? Noise[body.noiseScheduler.toUpperCase()] : (preset?.noiseScheduler ? Noise[preset.noiseScheduler.toUpperCase()] : Noise.KARRAS),
            characterPrompts: body.characterPrompts || preset?.characterPrompts,
            no_save: body.no_save !== undefined ? body.no_save : preset?.no_save,
        qualityToggle: false,
        ucPreset: 100,
            dynamicThresholding: body.dynamicThresholding || preset?.dynamicThresholding,
            seed: body.seed || preset?.seed,
            upscale: upscaleValue
        };

        if (baseOptions.upscale && baseOptions.upscale > 1 && !allowPaid) {
            throw new Error(`Upscaling with scale ${baseOptions.upscale} requires Opus credits. Set "allow_paid": true to confirm you accept using Opus credits for upscaling.`);
        }

    if (resolution && Resolution[resolution.toUpperCase()]) {
        baseOptions.resPreset = Resolution[resolution.toUpperCase()];
    } else {
        baseOptions.width = width;
        baseOptions.height = height;
    }

    if (isImg2Img) {
        baseOptions.action = Action.IMG2IMG;
        baseOptions.image = body.image;
        baseOptions.strength = body.strength || 0.5;
    }

    if (!allowPaid) {
        try {
            const cost_opus = calculateCost(baseOptions, true);
            const cost_free = calculateCost(baseOptions, false);
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

async function handleGeneration(opts, returnImage = false, presetName = null) {
    const seed = opts.seed || Math.floor(Math.random() * 1e9);
    
    opts.n_samples = 1;
    console.log(`🚀 Starting image generation (seed: ${seed})...`);
    
    let img;
    try {
        [img] = await client.generateImage(opts);
        console.log('✅ Image generation completed');
    } catch (error) {
        throw new Error(`❌ Image generation failed: ${error.message}`);
    }
    
    const timestamp = Date.now().toString();
    const namePrefix = presetName || 'generated';
    const name = `${timestamp}_${namePrefix}_${seed}.png`;
    const shouldSave = opts.no_save !== true;
    
    if (returnImage) {
        let buffer = Buffer.from(img.data);
        
        if (shouldSave) {
            fs.writeFileSync(path.join(imagesDir, name), buffer);
            console.log(`💾 Saved: ${name}`);
            
            // Generate preview
            const baseName = getBaseName(name);
            const previewFile = getPreviewFilename(baseName);
            const previewPath = path.join(previewsDir, previewFile);
            await generatePreview(path.join(imagesDir, name), previewPath);
            console.log(`📸 Generated preview: ${previewFile}`);
        }
        
        if (opts.upscale) {
            const scale = opts.upscale === true ? 4 : opts.upscale;
            console.log(`🔍 Starting upscaling (${scale}x)...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const { width: upscaleWidth, height: upscaleHeight } = await getImageDimensions(buffer);
            const scaledBuffer = await upscaleImage(buffer, scale, upscaleWidth, upscaleHeight);
        
        if (shouldSave) {
                const upscaledName = name.replace('.png', '_upscaled.png');
                fs.writeFileSync(path.join(imagesDir, upscaledName), scaledBuffer);
                console.log(`💾 Saved: ${upscaledName}`);
                
                // Update preview with upscaled version
                const previewPath = path.join(previewsDir, previewFile);
                await generatePreview(path.join(imagesDir, upscaledName), previewPath);
                console.log(`📸 Updated preview with upscaled version: ${previewFile}`);
            }
            
            return { buffer: scaledBuffer, filename: name, saved: shouldSave };
        }
        
        return { buffer, filename: name, saved: shouldSave };
    } else {
        // Save image and return filename only (legacy behavior)
        if (shouldSave) {
            await saveImage(img, name);
            console.log(`💾 Saved: ${name}`);
            
            // Generate preview
            const baseName = getBaseName(name);
            const previewFile = getPreviewFilename(baseName);
            const previewPath = path.join(previewsDir, previewFile);
            await generatePreview(path.join(imagesDir, name), previewPath);
            console.log(`📸 Generated preview: ${previewFile}`);
        }
        return { filename: name, saved: shouldSave };
    }
}

// Helper function for common endpoint logic
const handleImageRequest = async (req, res, opts, presetName = null) => {
    const result = await handleGeneration(opts, true, presetName);
    
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
    
    if (req.query.download === 'true') {
        const extension = optimize ? 'jpg' : 'png';
        const optimizedFilename = result.filename.replace('.png', `.${extension}`);
        res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
    }
    
    res.send(finalBuffer);
};

// Endpoint handlers
app.post('/:model/generate', authMiddleware, async (req, res) => {
    try {
            const key = req.params.model.toLowerCase();
            const model = Model[key.toUpperCase()];
            if (!model) {
                return res.status(400).json({ error: 'Invalid model' });
            }
            
    const opts = buildOptions(key, req.body, null, false, req.query);
    const presetName = req.body.preset || null;
    await handleImageRequest(req, res, opts, presetName);
        } catch(e) {
            console.log('❌ Error occurred:', e.message);
            res.status(500).json({ error: e.message });
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
            if (req.query.download === 'true') {
                const extension = optimize ? 'jpg' : 'png';
                const optimizedFilename = cached.filename.replace('.png', `.${extension}`);
                res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
            }
            res.send(finalBuffer);
            return;
        }
    }
    
    const opts = buildOptions(p.model, {}, p, false, req.query);
        let result = await handleGeneration(opts, true, req.params.name);
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
    if (req.query.download === 'true') {
        const extension = optimize ? 'jpg' : 'png';
        const optimizedFilename = result.filename.replace('.png', `.${extension}`);
        res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
    }
    res.send(finalBuffer);
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/preset/:name', authMiddleware, async (req, res) => {
    try {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) {
        return res.status(404).json({ error: 'Preset not found' });
    }
    
    const bodyOverrides = { ...req.body };
    if (bodyOverrides.prompt) {
        const originalPrompt = p.prompt || '';
        bodyOverrides.prompt = originalPrompt + ', ' + bodyOverrides.prompt;
        delete bodyOverrides.uc;
    }
    
    // Check if force generation is requested
    const forceGenerate = req.query.forceGenerate === 'true';
    
    if (!forceGenerate) {
        // Try to get cached image (POST requests with body overrides are not cached)
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
            if (req.query.download === 'true') {
                const extension = optimize ? 'jpg' : 'png';
                const optimizedFilename = cached.filename.replace('.png', `.${extension}`);
                res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
            }
            res.send(finalBuffer);
            return;
        }
    }
    
    const opts = buildOptions(p.model, bodyOverrides, p, false, req.query);
        let result = await handleGeneration(opts, true, req.params.name);
    // Cache the result if generation was successful and no body overrides
    if (!forceGenerate && Object.keys(bodyOverrides).length === 0) {
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
        }
    }
    res.setHeader('Content-Type', contentType);
    if (req.query.download === 'true') {
        const extension = optimize ? 'jpg' : 'png';
        const optimizedFilename = result.filename.replace('.png', `.${extension}`);
        res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
    }
    res.send(finalBuffer);
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});
            
// GET /preset/:name/prompt?resolution=... (no body, just preset)
app.get('/preset/:name/prompt', authMiddleware, async (req, res) => {
    try {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) return res.status(404).json({ error: 'Preset not found' });
    const resolution = req.query.resolution;
    const body = resolution ? { resolution } : {};
    const opts = buildOptions(p.model, body, p, false, req.query);
    res.json({ prompt: opts.prompt, uc: opts.negative_prompt });
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /preset/:name/prompt (body overrides)
app.post('/preset/:name/prompt', authMiddleware, async (req, res) => {
    try {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) return res.status(404).json({ error: 'Preset not found' });
    const bodyOverrides = { ...req.body };
    if (bodyOverrides.prompt) {
        const originalPrompt = p.prompt || '';
        bodyOverrides.prompt = originalPrompt + ', ' + bodyOverrides.prompt;
        delete bodyOverrides.uc;
    }
    const opts = buildOptions(p.model, bodyOverrides, p, false, req.query);
    res.json({ prompt: opts.prompt, uc: opts.negative_prompt });
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /:model/prompt (direct model, body)
app.post('/:model/prompt', authMiddleware, async (req, res) => {
    try {
    const key = req.params.model.toLowerCase();
    const model = Model[key.toUpperCase()];
    if (!model) return res.status(400).json({ error: 'Invalid model' });
    const opts = buildOptions(key, req.body, null, false, req.query);
    res.json({ prompt: opts.prompt, uc: opts.negative_prompt });
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
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
    const opts = buildOptions(p.model, bodyOverrides, p, false, req.query);
        let result = await handleGeneration(opts, true, req.params.name);
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
    if (req.query.download === 'true') {
        const extension = optimize ? 'jpg' : 'png';
        const optimizedFilename = result.filename.replace('.png', `.${extension}`);
        res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
    }
    res.send(finalBuffer);
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/preset/:name/:resolution', authMiddleware, async (req, res) => {
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
    
    const bodyOverrides = { resolution, ...req.body };
    if (bodyOverrides.prompt) {
        const originalPrompt = p.prompt || '';
        bodyOverrides.prompt = originalPrompt + ', ' + bodyOverrides.prompt;
        delete bodyOverrides.uc;
    }
    
    // Check if force generation is requested
    const forceGenerate = req.query.forceGenerate === 'true';
    
    if (!forceGenerate) {
        // Try to get cached image (POST requests with body overrides are not cached)
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
            if (req.query.download === 'true') {
                const extension = optimize ? 'jpg' : 'png';
                const optimizedFilename = cached.filename.replace('.png', `.${extension}`);
                res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
            }
            res.send(finalBuffer);
            return;
        }
    }
    
    const opts = buildOptions(p.model, bodyOverrides, p, false, req.query);
        let result = await handleGeneration(opts, true, req.params.name);
    // Cache the result if generation was successful and no body overrides (except resolution)
    if (!forceGenerate && Object.keys(req.body).length === 0) {
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
    if (req.query.download === 'true') {
        const extension = optimize ? 'jpg' : 'png';
        const optimizedFilename = result.filename.replace('.png', `.${extension}`);
        res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
    }
    res.send(finalBuffer);
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/:model/img2img', authMiddleware, async (req, res) => {
    try {
            const key = req.params.model.toLowerCase();
            const model = Model[key.toUpperCase()];
            if (!model) {
                return res.status(400).json({ error: 'Invalid model' });
            }
            
    const opts = buildOptions(key, req.body, null, true, req.query);
    await handleImageRequest(req, res, opts);
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/options', authMiddleware, (req, res) => {
    try {
        const currentPromptConfig = loadPromptConfig();
        const cacheStatus = getCacheStatus();
        const options = {
            models: Object.fromEntries(Object.keys(Model).map(key => [key, Model[key]])),
            actions: Object.fromEntries(Object.keys(Action).map(key => [key, Action[key]])),
            samplers: Object.fromEntries(Object.keys(Sampler).map(key => [key, Sampler[key]])),
            noiseSchedulers: Object.fromEntries(Object.keys(Noise).map(key => [key, Noise[key]])),
            resolutions: Object.fromEntries(Object.keys(Resolution).map(key => [key, Resolution[key]])),
            presets: Object.keys(currentPromptConfig.presets),
            textReplacements: currentPromptConfig.text_replacements || {},
            cache: {
                enabled: true,
                ttl: "30 minutes",
                entries: cacheStatus.totalEntries,
                clearEndpoint: "/cache/clear"
            }
        }
        res.json(options);
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/cache/clear', authMiddleware, (req, res) => {
    try {
        clearPresetCache();
        res.json({ 
            success: true, 
            message: 'Preset cache cleared successfully'
        });
        console.log('✅ Cache clear request completed successfully\n');
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/cache/status', authMiddleware, (req, res) => {
    try {
        const cacheStatus = getCacheStatus();
        res.json(cacheStatus);
        console.log('✅ Cache status request completed successfully\n');
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

const upscaleImage = async (imageBuffer, scale = 4, width, height) => {
    const actualScale = scale === true ? 4 : scale;
    if (actualScale <= 1) {
        console.log('📏 No upscaling needed (scale <= 1)');
        return imageBuffer;
    }
    
    console.log(`🔍 Upscaling image with NovelAI API (scale: ${actualScale}, dimensions: ${width}x${height})`);
    
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

// Upscale endpoint
app.post('/upscale/:filename', authMiddleware, async (req, res) => {
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
        console.log(`🔍 Starting upscaling for ${filename}...`);
        const upscaledBuffer = await upscaleImage(imageBuffer, 4, width, height);
        
        // Save upscaled image
        const upscaledFilename = filename.replace('.png', '_upscaled.png');
        const upscaledPath = path.join(imagesDir, upscaledFilename);
        fs.writeFileSync(upscaledPath, upscaledBuffer);
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
        res.send(upscaledBuffer);
        
    } catch (error) {
        console.error('Upscaling error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper: Extract NovelAI metadata from PNG
function extractNovelAIMetadata(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        const metadata = readMetadata(buffer);
        
        if (metadata.tEXt && metadata.tEXt.Comment) {
            const _metadata = JSON.parse(metadata.tEXt.Comment);
            return {
                ..._metadata,
                source: metadata.tEXt.Source,
                software: metadata.tEXt.Software ? `${metadata.tEXt.Software} (${metadata.tEXt.Source})` : metadata.tEXt.Source
            };
        }
        return null;
    } catch (error) {
        console.error('Error extracting metadata:', error.message);
        return null;
    }
}

// Helper: Read PNG metadata
function readMetadata(buffer) {
    const result = {};
    const chunks = extractChunks(buffer);
    
    chunks.forEach(chunk => {
        switch (chunk.name) {
            case 'tEXt':
                if (!result.tEXt) {
                    result.tEXt = {};
                }
                const textChunk = textDecode(chunk.data);
                result.tEXt[textChunk.keyword] = textChunk.text;
                break;
            case 'pHYs':
                result.pHYs = {
                    x: readUint32(chunk.data, 0),
                    y: readUint32(chunk.data, 4),
                    unit: chunk.data[8]
                };
                break;
            case 'iTXt':
                const textDecodeResult = textDecode(chunk.data);
                if (textDecodeResult.keyword === "Comment" || textDecodeResult.keyword === "Source" || textDecodeResult.keyword === "Software") {
                    try {
                        if (!result.tEXt) {
                            result.tEXt = {};
                        }
                        result.tEXt[textDecodeResult.keyword] = textDecodeResult.text.replaceAll("\x00", "");
                    } catch (e) {
                        console.error(e.message);
                    }
                }
                break;
            default:
                result[chunk.name] = true;
        }
    });
    
    return result;
}

// Helper: Extract PNG chunks
function extractChunks(buffer) {
    const data = new Uint8Array(buffer);
    if (!isValidPngHeader(data)) {
        throw new Error('Invalid .png file header');
    }

    let idx = 8;
    const chunks = [];

    while (idx < data.length) {
        const length = readUint32(data, idx) + 4;
        idx += 4;

        const name = String.fromCharCode(...data.slice(idx, idx + 4));
        idx += 4;

        if (name === 'IEND') {
            chunks.push({ name, data: new Uint8Array(0) });
            break;
        }

        const chunkData = data.slice(idx, idx + length - 4);
        idx += length;

        chunks.push({ name, data: chunkData });
    }

    return chunks;
}

// Helper: Decode text chunks
function textDecode(data) {
    let naming = true;
    let text = '';
    let name = '';

    for (let i = 0; i < data.length; i++) {
        if (naming) {
            if (data[i]) {
                name += String.fromCharCode(data[i]);
            } else {
                naming = false;
            }
        } else {
            const textDecoder = new TextDecoder("utf-8");
            text = textDecoder.decode(data.slice(i));
            break;
        }
    }

    return { keyword: name, text };
}

// Helper: Read 32-bit unsigned integer
function readUint32(data, offset) {
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

// Helper: Validate PNG header
function isValidPngHeader(data) {
    return (
        data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47 &&
        data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A
    );
}

// Helper: Extract relevant fields from metadata
function extractRelevantFields(meta) {
    if (!meta) return null;
    
    const model = determineModelFromMetadata(meta);
    const modelDisplayName = getModelDisplayName(model);
    
    // Check if dimensions match a known resolution
    const resolution = getResolutionFromDimensions(meta.width, meta.height);
    
    const result = {
        prompt: meta.prompt,
        uc: meta.uc,
        model: model,
        model_display_name: modelDisplayName,
        steps: meta.steps,
        scale: meta.scale,
        cfg_rescale: meta.cfg_rescale,
        skip_cfg_above_sigma: meta.skip_cfg_above_sigma,
        sampler: meta.sampler,
        noise_schedule: meta.noise_schedule,
        characterPrompts: meta.characterPrompts
    };
    
    // Add resolution if it matches, otherwise add height and width
    if (resolution) {
        result.resolution = resolution;
    } else {
        result.height = meta.height;
        result.width = meta.width;
    }
    
    return result;
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

// Metadata endpoint
app.get('/metadata/:filename', authMiddleware, async (req, res) => {
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
        if (filename.includes('_upscaled')) {
            const currentPromptConfig = loadPromptConfig();
            matchedPreset = matchOriginalResolution(meta, currentPromptConfig.resolutions || {});
        }
        
        const result = extractRelevantFields(meta);
        if (matchedPreset) result.matchedPreset = matchedPreset;
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper: Determine model from metadata using exact hash matching (from NovelAI inspect page)
function determineModelFromMetadata(meta) {
    if (!meta || !meta.source) {
        return "unknown";
    }
    
    const source = meta.source;
    
    // NovelAI Diffusion V4/V4.5 models
    if (source.includes("NovelAI Diffusion V4") || source.includes("NovelAI Diffusion V4.5")) {
        switch (source) {
            case "NovelAI Diffusion V4.5 4BDE2A90":
            case "NovelAI Diffusion V4.5 1229B44F":
            case "NovelAI Diffusion V4.5 B9F340FD":
            case "NovelAI Diffusion V4.5 F3D95188":
                return "V4_5";
            case "NovelAI Diffusion V4.5 C02D4F98":
            case "NovelAI Diffusion V4.5 5AB81C7C":
            case "NovelAI Diffusion V4.5 B5A2A797":
            case "NovelAI Diffusion V4 5AB81C7C":
            case "NovelAI Diffusion V4 B5A2A797":
                return "V4_5_CUR";
            case "NovelAI Diffusion V4 37442FCA":
            case "NovelAI Diffusion V4 4F49EC75":
            case "NovelAI Diffusion V4 CA4B7203":
            case "NovelAI Diffusion V4 79F47848":
            case "NovelAI Diffusion V4 F6302A9D":
                return "V4";
            case "NovelAI Diffusion V4 7ABFFA2A":
            case "NovelAI Diffusion V4 C1CCBA86":
            case "NovelAI Diffusion V4 770A9E12":
                return "V4_CUR";
            default:
                if (source.includes("V4.5")) {
                    return "V4_5_CUR";
                }
                return "V4_CUR";
        }
    }
    
    // Stable Diffusion models
    switch (source) {
        case "Stable Diffusion XL B0BDF6C1":
        case "Stable Diffusion XL C1E1DE52":
        case "Stable Diffusion XL 7BCCAA2C":
        case "Stable Diffusion XL 1120E6A9":
        case "Stable Diffusion XL 8BA2AF87":
            return "V3";
        case "Stable Diffusion XL 4BE8C60C":
        case "Stable Diffusion XL C8704949":
        case "Stable Diffusion XL 37C2B166":
        case "Stable Diffusion XL F306816B":
        case "Stable Diffusion XL 9CC2F394":
            return "FURRY";
        default:
            return "unknown";
    }
}

// Helper: Get model display name
function getModelDisplayName(model) {
    const modelDisplayNames = {
        "V4_5": "NovelAI Diffusion v4.5 - Full",
        "V4_5_CUR": "NovelAI Diffusion v4.5 - Curated", 
        "V4": "NovelAI Diffusion v4 - Full",
        "V4_CUR": "NovelAI Diffusion v4 - Curated Preview",
        "V3": "NovelAI Diffusion v3 - Anime",
        "FURRY": "NovelAI Diffusion v3 - Furry",
        "unknown": "Unknown"
    };
    
    return modelDisplayNames[model] || model;
}

app.listen(config.port, () => console.log(`Server running on port ${config.port}`));