const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const { NovelAI, Model, Action, Sampler, Noise, Resolution, calculateCost } = require('nekoai-js');
const config = require('./config.json');

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

// Apply authentication to all routes
app.use(authMiddleware);

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

const imagesDir = path.resolve(__dirname, 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);

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
            }
            
            return { buffer: scaledBuffer, filename: name, saved: shouldSave };
        }
        
        return { buffer, filename: name, saved: shouldSave };
    } else {
        // Save image and return filename only (legacy behavior)
        if (shouldSave) {
            await saveImage(img, name);
            console.log(`💾 Saved: ${name}`);
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
app.post('/:model/generate', async (req, res) => {
    try {
        const key = req.params.model.toLowerCase();
        const model = Model[key.toUpperCase()];
        if (!model) {
            return res.status(400).json({ error: 'Invalid model' });
        }
        
        const opts = buildOptions(key, req.body, null, false, req.query);
        await handleImageRequest(req, res, opts);
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/preset/:name', async (req, res) => {
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

app.post('/preset/:name', async (req, res) => {
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
app.get('/preset/:name/prompt', async (req, res) => {
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
app.post('/preset/:name/prompt', async (req, res) => {
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
app.post('/:model/prompt', async (req, res) => {
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

app.get('/preset/:name/:resolution', async (req, res) => {
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

app.post('/preset/:name/:resolution', async (req, res) => {
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

app.post('/:model/img2img', async (req, res) => {
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

app.get('/options', (req, res) => {
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

app.post('/cache/clear', (req, res) => {
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

app.get('/cache/status', (req, res) => {
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
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Authorization': `Bearer ${config.apiKey}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
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

app.listen(config.port, () => console.log(`Server running on port ${config.port}`));