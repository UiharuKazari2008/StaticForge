const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const Bottleneck = require('bottleneck');
const { NovelAI, Model, Action, Sampler, Noise, Resolution, calculateCost } = require('nekoai-js');

// Dynamic config loading
let config = null;
let configLastModified = 0;
let promptConfig = null;
let promptConfigLastModified = 0;

// Preset cache system
const presetCache = new Map();

function loadConfig() {
    const configPath = './config.json';
    
    if (!fs.existsSync(configPath)) {
        console.error('config.json not found');
        process.exit(1);
    }
    
    const stats = fs.statSync(configPath);
    if (stats.mtime.getTime() > configLastModified) {
        console.log('🔄 Reloading config.json...');
        
        try {
            const configData = fs.readFileSync(configPath, 'utf8');
            config = JSON.parse(configData);
            configLastModified = stats.mtime.getTime();

            if (!config.apiKey) {
                console.error('apiKey is not set in config.json');
                process.exit(1);
            }
                    
            console.log('✅ Config reloaded successfully');
        } catch (error) {
            console.error('❌ Error reloading config:', error.message);
            // Keep using the old config if there's an error
            if (!config) {
                process.exit(1);
            }
        }
    }
    
    return config;
}

function loadPromptConfig() {
    const promptConfigPath = './prompt.config.json';
    
    if (!fs.existsSync(promptConfigPath)) {
        console.error('prompt.config.json not found');
        process.exit(1);
    }
    
    const stats = fs.statSync(promptConfigPath);
    if (stats.mtime.getTime() > promptConfigLastModified) {
        console.log('🔄 Reloading prompt.config.json...');
        
        try {
            const configData = fs.readFileSync(promptConfigPath, 'utf8');
            promptConfig = JSON.parse(configData);
            promptConfigLastModified = stats.mtime.getTime();
                    
            console.log('✅ Prompt config reloaded successfully');
        } catch (error) {
            console.error('❌ Error reloading prompt config:', error.message);
            // Keep using the old config if there's an error
            if (!promptConfig) {
                process.exit(1);
            }
        }
    }
    
    return promptConfig;
}

// Preset cache management functions
const getPresetCacheKey = (presetName, queryParams = {}) => {
    // Create a cache key based on preset name and relevant query parameters
    const relevantParams = {
        upscale: queryParams.upscale,
        resolution: queryParams.resolution
    };
    return `${presetName}_${JSON.stringify(relevantParams)}`;
};

const getCachedPreset = (cacheKey) => {
    const cached = presetCache.get(cacheKey);
    if (!cached) return null;
    
    const now = Date.now();
    const thirtyMinutes = 30 * 60 * 1000; // 30 minutes in milliseconds
    
    if (now - cached.timestamp > thirtyMinutes) {
        console.log(`⏰ Cache expired for preset: ${cacheKey}`);
        presetCache.delete(cacheKey);
        return null;
    }
    
    console.log(`📋 Using cached image for preset: ${cacheKey} (${Math.round((now - cached.timestamp) / 1000)}s old)`);
    return cached;
};

const setCachedPreset = (cacheKey, buffer, filename) => {
    const now = Date.now();
    presetCache.set(cacheKey, {
        buffer,
        filename,
        timestamp: now
    });
    console.log(`💾 Cached image for preset: ${cacheKey}`);
};

const clearPresetCache = () => {
    const beforeSize = presetCache.size;
    presetCache.clear();
    console.log(`🗑️ Cleared preset cache (${beforeSize} entries)`);
};

// Text replacement functions
const applyTextReplacements = (text, presetName, model = null) => {
    const currentPromptConfig = loadPromptConfig();
    if (!text || !currentPromptConfig.text_replacements) return text;
    
    let result = text.replace(/<PRESET_NAME>/g, presetName);
    
    // Handle PICK_<NAME> replacements
    result = result.replace(/<PICK_([^>]+)>/g, (match, name) => {
        const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(key => 
            key.startsWith(name) && key !== name
        );
        if (matchingKeys.length === 0) throw new Error(`No text replacements found starting with: ${name}`);
        return getReplacementValue(currentPromptConfig.text_replacements[matchingKeys[Math.floor(Math.random() * matchingKeys.length)]]);
    });
    
    // Handle regular replacements
    const foundKeys = new Set();
    let match;
    const keyPattern = /<([^>]+)>/g;
    while ((match = keyPattern.exec(text)) !== null) {
        if (!match[1].startsWith('PICK_')) foundKeys.add(match[1]);
    }
    
    for (const baseKey of foundKeys) {
        const pattern = new RegExp(`<${baseKey}>`, 'g');
        if (model && currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`]) {
            result = result.replace(pattern, getReplacementValue(currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`]));
        } else if (currentPromptConfig.text_replacements[baseKey]) {
            result = result.replace(pattern, getReplacementValue(currentPromptConfig.text_replacements[baseKey]));
        }
    }
    
    const remainingReplacements = result.match(/<[^>]+>/g);
    if (remainingReplacements?.length > 0) {
        throw new Error(`Invalid text replacement: ${remainingReplacements.join(', ')}`);
    }
    
    return result;
};

const getUsedReplacements = (text, model = null) => {
    const currentPromptConfig = loadPromptConfig();
    if (!text || !currentPromptConfig.text_replacements) return [];
    
    const usedKeys = [];
    if (text.includes('<PRESET_NAME>')) usedKeys.push('PRESET_NAME');
    
    // PICK_ replacements
    let pickMatch;
    const pickPattern = /<PICK_([^>]+)>/g;
    while ((pickMatch = pickPattern.exec(text)) !== null) {
        const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(key => 
            key.startsWith(pickMatch[1]) && key !== pickMatch[1]
        );
        if (matchingKeys.length > 0) usedKeys.push(`PICK_${pickMatch[1]} (${matchingKeys.length} options)`);
    }
    
    // Regular replacements
    const foundKeys = new Set();
    let match;
    const keyPattern = /<([^>]+)>/g;
    while ((match = keyPattern.exec(text)) !== null) {
        if (!match[1].startsWith('PICK_')) foundKeys.add(match[1]);
    }
    
    for (const baseKey of foundKeys) {
        if (baseKey === 'PRESET_NAME') continue;
        if (model && currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`]) {
            const value = currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`];
            usedKeys.push(`${baseKey}${Array.isArray(value) ? ` (${model.toUpperCase()}, random)` : ` (${model.toUpperCase()})`}`);
        } else if (currentPromptConfig.text_replacements[baseKey]) {
            const value = currentPromptConfig.text_replacements[baseKey];
            usedKeys.push(`${baseKey}${Array.isArray(value) ? ' (random)' : ''}`);
        }
    }
    
    return usedKeys;
};

// Get current config
config = loadConfig();
promptConfig = loadPromptConfig();

const client = new NovelAI({ token: config.apiKey });

const models = Object.keys(Model);
const modelNames = models.map(m => m).join(', ');
console.log(`Available models: ${modelNames}`);

const samplers = Object.keys(Sampler);
const samplerNames = samplers.map(s => s).join(', ');
console.log(`Available samplers: ${samplerNames}`);

const noiseSchedulers = Object.keys(Noise);
const noiseSchedulerNames = noiseSchedulers.map(n => n).join(', ');
console.log(`Available noise schedulers: ${noiseSchedulerNames}`);

const resolutions = Object.keys(Resolution);
const resolutionNames = resolutions.map(r => r).join(', ');
console.log(`Available resolutions: ${resolutionNames}`);

const presets = Object.keys(promptConfig.presets);
const presetNames = presets.map(p => p).join(', ');
console.log(`Available presets: ${presetNames}`);

const app = express();
app.use(express.json());

// Authentication middleware
const authMiddleware = (req, res, next) => {
    const currentConfig = loadConfig();
    
    // If no loginKey is configured, skip authentication
    if (!currentConfig.loginKey) {
        return next();
    }
    
    const providedAuth = req.query.auth;
    
    if (!providedAuth) {
        console.log('❌ Authentication required but no auth parameter provided');
        return res.status(401).json({ error: 'Authentication required. Add ?auth=<loginKey> to your request.' });
    }
    
    if (providedAuth !== currentConfig.loginKey) {
        console.log('❌ Invalid authentication key provided');
        return res.status(401).json({ error: 'Invalid authentication key' });
    }
    
    console.log('✅ Authentication successful');
    next();
};

// Apply authentication to all routes
app.use(authMiddleware);

const imagesDir = path.resolve(__dirname, 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);

const upscaledDir = path.resolve(__dirname, 'upscaled');
if (!fs.existsSync(upscaledDir)) fs.mkdirSync(upscaledDir);

// Utility functions
const formatDate = () => {
    const d = new Date();
    const pad = n => n.toString().padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
};

const getReplacementValue = value => Array.isArray(value) ? value[Math.floor(Math.random() * value.length)] : value;

const getImageDimensions = async buffer => {
    try {
        const metadata = await sharp(buffer).metadata();
        return { width: metadata.width, height: metadata.height };
    } catch (error) {
        console.log('⚠️ Sharp failed, using fallback:', error.message);
        return getImageDimensionsFallback(buffer);
    }
};

const getImageDimensionsFallback = buffer => {
    if (buffer.length < 24) throw new Error('Invalid PNG file: too short');
    const signature = buffer.slice(0, 8);
    const expectedSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    if (!signature.equals(expectedSignature)) throw new Error('Invalid PNG file: wrong signature');
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

async function saveImage(img, filename) {
    const filePath = path.join(imagesDir, filename);
    await img.save(filePath);
    return filename;
}

// Build options for image generation
const buildOptions = (model, body, preset = null, isImg2Img = false, queryParams = {}) => {
    const currentConfig = loadConfig();
    console.log('🔧 Building options...', preset ? 'Using preset' : '');
    
    const resolution = body.resolution || preset?.resolution;
    const allowPaid = body.allow_paid !== undefined ? body.allow_paid : preset?.allow_paid;
    const skip_cfg_above_sigma = (body.variety || preset?.variety) ? 59.04722600415217 : undefined;
    
    let width, height;
    if (resolution && Resolution[resolution.toUpperCase()]) {
        console.log(`📐 Using resolution preset: "${resolution}"`);
        if ((resolution.startsWith('LARGE_') || resolution.startsWith('WALLPAPER_'))) { 
            if (!allowPaid) {
                throw new Error(`Resolution "${resolution}" requires Opus credits. Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
            }
            console.log(`⚠️ Using ${resolution} resolution (Opus credits required)`);
        }
    } else {
        width = body.width || preset?.width || 1024;
        height = body.height || preset?.height || 1024;
        console.log(`📐 Using custom dimensions: ${width}x${height}`);
        if ((width > 1024 || height > 1024) && !allowPaid) {
                throw new Error(`Custom dimensions ${width}x${height} exceed maximum of 1024. Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
            }
    }

    const steps = body.steps || preset?.steps || 24;
    console.log(`✅ Using ${steps} steps`);
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
        console.log(`🔍 Upscale override from query parameter: ${upscaleValue}`);
    }
    
    try {
        const processedPrompt = applyTextReplacements(rawPrompt, presetName, model);
        const processedNegativePrompt = applyTextReplacements(rawNegativePrompt, presetName, model);
        
        const usedPromptReplacements = getUsedReplacements(rawPrompt, model);
        const usedNegativeReplacements = getUsedReplacements(rawNegativePrompt, model);
        
        if (usedPromptReplacements.length > 0) console.log(`🔄 Applied text replacements to prompt: [${usedPromptReplacements.join(', ')}]`);
        if (usedNegativeReplacements.length > 0) console.log(`🔄 Applied text replacements to negative prompt: [${usedNegativeReplacements.join(', ')}]`);

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
        console.log('🖼️ Image-to-image mode enabled');
    }

    if (!allowPaid) {
        try {
            const cost_opus = calculateCost(baseOptions, true);
            const cost_free = calculateCost(baseOptions, false);
            console.log(`💰 Calculated cost: ${cost_free}, ${cost_opus} (Opus Tier)`);
            if (cost_opus > 0) {
                throw new Error(`Request requires Opus credits (cost: ${cost_opus}). Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
            }
        } catch (error) {
                if (error.message.includes('requires Opus credits')) throw error;
            console.log('⚠️ Cost calculation failed, proceeding with request:', error.message);
        }
    } else {
        console.log('✅ Opus credits allowed, skipping cost validation');
    }

    console.log('📋 Final options:', JSON.stringify(baseOptions, null, 2));
    return baseOptions;
    } catch (error) {
        console.log('❌ Text replacement error:', error.message);
        throw error;
}
};

async function handleGeneration(opts, returnImage = false) {
    console.log('🎲 Processing seed...');
    // Use provided seed or generate random one if not defined
    const seed = opts.seed || Math.floor(Math.random() * 1e9);
    if (opts.seed) {
        console.log(`🎲 Using provided seed: ${seed}`);
    } else {
        console.log(`🎲 Generated random seed: ${seed}`);
    }
    
    opts.n_samples = 1;
    console.log('🚀 Starting image generation...');
    
    let img;
    try {
        [img] = await client.generateImage(opts);
        console.log('✅ Image generation completed');
    } catch (error) {
        console.log('❌ Image generation failed:', error.message);
        throw new Error(`Image generation failed: ${error.message}`);
    }
    
    const name = `${formatDate()}_${seed}.png`;
    const shouldSave = opts.no_save !== true;
    
    if (returnImage) {
        console.log('📦 Preparing image buffer...');
        // Get buffer data directly from the generated image
        let buffer = Buffer.from(img.data);
        console.log(`📊 Buffer size: ${buffer.length} bytes`);
        
        // Apply upscaling if requested
        if (opts.upscale) {
            const scale = opts.upscale === true ? 4 : opts.upscale; // Default to 4x if true
            console.log(`🔍 Upscaling requested with scale: ${scale}`);
            console.log('⏰ Waiting 4 seconds before upscaling...');
            await new Promise(resolve => setTimeout(resolve, 4000));
            
            // Extract actual dimensions from the generated image using Sharp
            const { width: upscaleWidth, height: upscaleHeight } = await getImageDimensions(buffer);
            console.log(`📐 Extracted image dimensions: ${upscaleWidth}x${upscaleHeight}`);
            
            const scaledBuffer = await upscaleImage(buffer, scale, upscaleWidth, upscaleHeight);
            console.log(`📊 Upscaled buffer size: ${scaledBuffer.length} bytes`);
        
        // Save image permanently if shouldSave is true
        if (shouldSave) {
            const finalPath = path.join(imagesDir, name);
                fs.writeFileSync(finalPath, buffer);
            console.log(`💾 Image saved permanently: ${name}`);
            
            // If upscaling was applied, also save the upscaled version
                const upscaledName = `upscaled_${name}`;
                const upscaledPath = path.join(upscaledDir, upscaledName);
                fs.writeFileSync(upscaledPath, scaledBuffer);
                console.log(`💾 Upscaled image saved: ${upscaledName}`);
            }
            
            console.log('📤 Returning image buffer to client');
            return { buffer: scaledBuffer, filename: name, saved: shouldSave };
        }
        
        // Save image permanently if shouldSave is true (no upscaling)
        if (shouldSave) {
            const finalPath = path.join(imagesDir, name);
            fs.writeFileSync(finalPath, buffer);
            console.log(`💾 Image saved permanently: ${name}`);
        }
        
        console.log('📤 Returning image buffer to client');
        return { buffer, filename: name, saved: shouldSave };
    } else {
        // Save image and return filename only (legacy behavior)
        if (shouldSave) {
            await saveImage(img, name);
            console.log(`💾 Image saved: ${name}`);
        }
        console.log('📤 Returning filename to client');
        return { filename: name, saved: shouldSave };
    }
}

// Helper function for common endpoint logic
const handleImageRequest = async (req, res, opts) => {
    const result = await handleGeneration(opts, true);
    
    // Check if optimization is requested
    const optimize = req.query.optimize === 'true';
    
    let finalBuffer = result.buffer;
    let contentType = 'image/png';
    
    if (optimize) {
        console.log('🔧 Optimizing image to JPEG at 75% quality...');
        try {
            finalBuffer = await sharp(result.buffer)
                .jpeg({ quality: 75 })
                .toBuffer();
            contentType = 'image/jpeg';
            console.log(`✅ Image optimized: ${result.buffer.length} bytes → ${finalBuffer.length} bytes (${Math.round((1 - finalBuffer.length / result.buffer.length) * 100)}% reduction)`);
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
        console.log('📥 Setting download headers');
    } else {
        console.log('🖼️ Returning image as content');
    }
    
    console.log('📤 Sending image to client');
    res.send(finalBuffer);
    console.log('✅ Request completed successfully\n');
};

// Rate limiting system using Bottleneck
// Configure rate limiters for different request types
const generateLimiter = new Bottleneck({
    // First 3 requests: 5 second minimum delay
    minTime: 5000,
    maxConcurrent: 1,
    // Reservoir: 3 requests per 10 minutes
    reservoir: 3,
    reservoirRefreshAmount: 3,
    reservoirRefreshInterval: 2 * 60 * 1000, // 2 minutes
    // Queue requests instead of rejecting them
    trackDoneStatus: true
});

// Separate limiter for upscaling to avoid deadlock
const upscaleLimiter = new Bottleneck({
    minTime: 1000, // 1 second between upscale requests
    maxConcurrent: 1,
    trackDoneStatus: true
});
    
// Event listeners for monitoring
generateLimiter.on('failed', (error, jobInfo) => {
    console.log(`❌ Generate request failed: ${error.message} (Job ID: ${jobInfo.id})`);
});

generateLimiter.on('done', (result, jobInfo) => {
    console.log(`✅ Generate request completed (Job ID: ${jobInfo.id})`);
});

upscaleLimiter.on('failed', (error, jobInfo) => {
    console.log(`❌ Upscale request failed: ${error.message} (Job ID: ${jobInfo.id})`);
});

upscaleLimiter.on('done', (result, jobInfo) => {
    console.log(`✅ Upscale request completed (Job ID: ${jobInfo.id})`);
    });

// Wrapper function to add requests to rate limiter
function rateLimitedRequest(req, res, handler, limiter = generateLimiter) {
    return new Promise((resolve, reject) => {
        const jobId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`📋 Adding request to rate limiter (Job ID: ${jobId})`);
        
        limiter.schedule(async () => {
                try {
                console.log(`🔄 Processing request (Job ID: ${jobId})`);
                    await handler(req, res);
                    resolve();
                } catch (error) {
                console.log(`❌ Request failed (Job ID: ${jobId}): ${error.message}`);
                    reject(error);
                }
        }, jobId);
    });
}

// Generic endpoint handler
const createEndpointHandler = (handler) => async (req, res) => {
    await rateLimitedRequest(req, res, async (req, res) => {
        console.log(`\n🎯 ${req.method} ${req.path}`);
        console.log('👤 Client IP:', req.ip);
        console.log('📅 Timestamp:', new Date().toISOString());
        
        try {
            await handler(req, res);
        } catch(e) {
            console.log('❌ Error occurred:', e.message);
            res.status(500).json({ error: e.message });
        }
    });
};

// Endpoint handlers
app.post('/:model/generate', createEndpointHandler(async (req, res) => {
            const key = req.params.model.toLowerCase();
            const model = Model[key.toUpperCase()];
            if (!model) {
                console.log('❌ Invalid model requested:', req.params.model);
                return res.status(400).json({ error: 'Invalid model' });
            }
            console.log(`✅ Valid model: ${req.params.model}`);
            
    const opts = buildOptions(key, req.body, null, false, req.query);
    await handleImageRequest(req, res, opts);
}));

app.get('/preset/:name', createEndpointHandler(async (req, res) => {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) {
        console.log('❌ Preset not found:', req.params.name);
        return res.status(404).json({ error: 'Preset not found' });
    }
    console.log(`✅ Preset found: ${req.params.name}`);
    
    // Check if force generation is requested
    const forceGenerate = req.query.forceGenerate === 'true';
    
    if (!forceGenerate) {
        // Try to get cached image
        const cacheKey = getPresetCacheKey(req.params.name, req.query);
        const cached = getCachedPreset(cacheKey);
        
        if (cached) {
            console.log('📤 Returning cached image');
            
            // Check if optimization is requested
            const optimize = req.query.optimize === 'true';
            let finalBuffer = cached.buffer;
            let contentType = 'image/png';
            
            if (optimize) {
                console.log('🔧 Optimizing cached image to JPEG at 75% quality...');
                try {
                    finalBuffer = await sharp(cached.buffer)
                        .jpeg({ quality: 75 })
                        .toBuffer();
                    contentType = 'image/jpeg';
                    console.log(`✅ Cached image optimized: ${cached.buffer.length} bytes → ${finalBuffer.length} bytes (${Math.round((1 - finalBuffer.length / cached.buffer.length) * 100)}% reduction)`);
                } catch (error) {
                    console.log('❌ Image optimization failed:', error.message);
                    // Fall back to original PNG if optimization fails
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
    } else {
        console.log('🔄 Force generation requested, bypassing cache');
    }
    
    const opts = buildOptions(p.model, {}, p, false, req.query);
    const result = await handleGeneration(opts, true);
    
    // Cache the result if generation was successful
    if (!forceGenerate) {
        const cacheKey = getPresetCacheKey(req.params.name, req.query);
        setCachedPreset(cacheKey, result.buffer, result.filename);
    }
    
    // Check if optimization is requested
    const optimize = req.query.optimize === 'true';
    let finalBuffer = result.buffer;
    let contentType = 'image/png';
    
    if (optimize) {
        console.log('🔧 Optimizing generated image to JPEG at 75% quality...');
        try {
            finalBuffer = await sharp(result.buffer)
                .jpeg({ quality: 75 })
                .toBuffer();
            contentType = 'image/jpeg';
            console.log(`✅ Generated image optimized: ${result.buffer.length} bytes → ${finalBuffer.length} bytes (${Math.round((1 - finalBuffer.length / result.buffer.length) * 100)}% reduction)`);
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
}));

app.post('/preset/:name', createEndpointHandler(async (req, res) => {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) {
        console.log('❌ Preset not found:', req.params.name);
        return res.status(404).json({ error: 'Preset not found' });
    }
    console.log(`✅ Preset found: ${req.params.name}`);
    
    const bodyOverrides = { ...req.body };
    if (bodyOverrides.prompt) {
        const originalPrompt = p.prompt || '';
        bodyOverrides.prompt = originalPrompt + ', ' + bodyOverrides.prompt;
        console.log(`🔄 Appending body prompt to preset: "${bodyOverrides.prompt}"`);
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
            
            // Check if optimization is requested
            const optimize = req.query.optimize === 'true';
            let finalBuffer = cached.buffer;
            let contentType = 'image/png';
            
            if (optimize) {
                console.log('🔧 Optimizing cached image to JPEG at 75% quality...');
                try {
                    finalBuffer = await sharp(cached.buffer)
                        .jpeg({ quality: 75 })
                        .toBuffer();
                    contentType = 'image/jpeg';
                    console.log(`✅ Cached image optimized: ${cached.buffer.length} bytes → ${finalBuffer.length} bytes (${Math.round((1 - finalBuffer.length / cached.buffer.length) * 100)}% reduction)`);
                } catch (error) {
                    console.log('❌ Image optimization failed:', error.message);
                    // Fall back to original PNG if optimization fails
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
    } else {
        console.log('🔄 Force generation requested, bypassing cache');
    }
    
    const opts = buildOptions(p.model, bodyOverrides, p, false, req.query);
    const result = await handleGeneration(opts, true);
    
    // Cache the result if generation was successful and no body overrides
    if (!forceGenerate && Object.keys(bodyOverrides).length === 0) {
        const cacheKey = getPresetCacheKey(req.params.name, req.query);
        setCachedPreset(cacheKey, result.buffer, result.filename);
    }
    
    // Check if optimization is requested
    const optimize = req.query.optimize === 'true';
    let finalBuffer = result.buffer;
    let contentType = 'image/png';
    
    if (optimize) {
        console.log('🔧 Optimizing generated image to JPEG at 75% quality...');
        try {
            finalBuffer = await sharp(result.buffer)
                .jpeg({ quality: 75 })
                .toBuffer();
            contentType = 'image/jpeg';
            console.log(`✅ Generated image optimized: ${result.buffer.length} bytes → ${finalBuffer.length} bytes (${Math.round((1 - finalBuffer.length / result.buffer.length) * 100)}% reduction)`);
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
}));
            
// GET /preset/:name/prompt?resolution=... (no body, just preset)
app.get('/preset/:name/prompt', createEndpointHandler(async (req, res) => {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) return res.status(404).json({ error: 'Preset not found' });
    const resolution = req.query.resolution;
    const body = resolution ? { resolution } : {};
    const opts = buildOptions(p.model, body, p, false, req.query);
    res.json({ prompt: opts.prompt, uc: opts.negative_prompt });
}));

// POST /preset/:name/prompt (body overrides)
app.post('/preset/:name/prompt', createEndpointHandler(async (req, res) => {
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
}));

// POST /:model/prompt (direct model, body)
app.post('/:model/prompt', createEndpointHandler(async (req, res) => {
    const key = req.params.model.toLowerCase();
    const model = Model[key.toUpperCase()];
    if (!model) return res.status(400).json({ error: 'Invalid model' });
    const opts = buildOptions(key, req.body, null, false, req.query);
    res.json({ prompt: opts.prompt, uc: opts.negative_prompt });
}));

app.get('/preset/:name/:resolution', createEndpointHandler(async (req, res) => {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) {
        console.log('❌ Preset not found:', req.params.name);
        return res.status(404).json({ error: 'Preset not found' });
    }
    console.log(`✅ Preset found: ${req.params.name}`);
    
    const resolution = req.params.resolution;
    if (!Resolution[resolution.toUpperCase()]) {
        console.log('❌ Invalid resolution:', resolution);
        return res.status(400).json({ error: 'Invalid resolution' });
    }
    console.log(`✅ Valid resolution: ${resolution}`);
    
    // Check if force generation is requested
    const forceGenerate = req.query.forceGenerate === 'true';
    
    if (!forceGenerate) {
        // Try to get cached image
        const cacheKey = getPresetCacheKey(req.params.name, { ...req.query, resolution });
        const cached = getCachedPreset(cacheKey);
        
        if (cached) {
            console.log('📤 Returning cached image');
            
            // Check if optimization is requested
            const optimize = req.query.optimize === 'true';
            let finalBuffer = cached.buffer;
            let contentType = 'image/png';
            
            if (optimize) {
                console.log('🔧 Optimizing cached image to JPEG at 75% quality...');
                try {
                    finalBuffer = await sharp(cached.buffer)
                        .jpeg({ quality: 75 })
                        .toBuffer();
                    contentType = 'image/jpeg';
                    console.log(`✅ Cached image optimized: ${cached.buffer.length} bytes → ${finalBuffer.length} bytes (${Math.round((1 - finalBuffer.length / cached.buffer.length) * 100)}% reduction)`);
                } catch (error) {
                    console.log('❌ Image optimization failed:', error.message);
                    // Fall back to original PNG if optimization fails
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
    } else {
        console.log('🔄 Force generation requested, bypassing cache');
    }
    
    const bodyOverrides = { resolution };
    const opts = buildOptions(p.model, bodyOverrides, p, false, req.query);
    const result = await handleGeneration(opts, true);
    
    // Cache the result if generation was successful
    if (!forceGenerate) {
        const cacheKey = getPresetCacheKey(req.params.name, { ...req.query, resolution });
        setCachedPreset(cacheKey, result.buffer, result.filename);
    }
    
    // Check if optimization is requested
    const optimize = req.query.optimize === 'true';
    let finalBuffer = result.buffer;
    let contentType = 'image/png';
    
    if (optimize) {
        console.log('🔧 Optimizing generated image to JPEG at 75% quality...');
        try {
            finalBuffer = await sharp(result.buffer)
                .jpeg({ quality: 75 })
                .toBuffer();
            contentType = 'image/jpeg';
            console.log(`✅ Generated image optimized: ${result.buffer.length} bytes → ${finalBuffer.length} bytes (${Math.round((1 - finalBuffer.length / result.buffer.length) * 100)}% reduction)`);
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
}));

app.post('/preset/:name/:resolution', createEndpointHandler(async (req, res) => {
    const currentPromptConfig = loadPromptConfig();
    const p = currentPromptConfig.presets[req.params.name];
    if (!p) {
        console.log('❌ Preset not found:', req.params.name);
        return res.status(404).json({ error: 'Preset not found' });
    }
    console.log(`✅ Preset found: ${req.params.name}`);
    
    const resolution = req.params.resolution;
    if (!Resolution[resolution.toUpperCase()]) {
        console.log('❌ Invalid resolution:', resolution);
        return res.status(400).json({ error: 'Invalid resolution' });
    }
    console.log(`✅ Valid resolution: ${resolution}`);
    
    const bodyOverrides = { resolution, ...req.body };
    if (bodyOverrides.prompt) {
        const originalPrompt = p.prompt || '';
        bodyOverrides.prompt = originalPrompt + ', ' + bodyOverrides.prompt;
        console.log(`🔄 Appending body prompt to preset: "${bodyOverrides.prompt}"`);
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
            
            // Check if optimization is requested
            const optimize = req.query.optimize === 'true';
            let finalBuffer = cached.buffer;
            let contentType = 'image/png';
            
            if (optimize) {
                console.log('🔧 Optimizing cached image to JPEG at 75% quality...');
                try {
                    finalBuffer = await sharp(cached.buffer)
                        .jpeg({ quality: 75 })
                        .toBuffer();
                    contentType = 'image/jpeg';
                    console.log(`✅ Cached image optimized: ${cached.buffer.length} bytes → ${finalBuffer.length} bytes (${Math.round((1 - finalBuffer.length / cached.buffer.length) * 100)}% reduction)`);
                } catch (error) {
                    console.log('❌ Image optimization failed:', error.message);
                    // Fall back to original PNG if optimization fails
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
    } else {
        console.log('🔄 Force generation requested, bypassing cache');
    }
    
    const opts = buildOptions(p.model, bodyOverrides, p, false, req.query);
    const result = await handleGeneration(opts, true);
    
    // Cache the result if generation was successful and no body overrides (except resolution)
    if (!forceGenerate && Object.keys(req.body).length === 0) {
        const cacheKey = getPresetCacheKey(req.params.name, { ...req.query, resolution });
        setCachedPreset(cacheKey, result.buffer, result.filename);
    }
    
    // Check if optimization is requested
    const optimize = req.query.optimize === 'true';
    let finalBuffer = result.buffer;
    let contentType = 'image/png';
    
    if (optimize) {
        console.log('🔧 Optimizing generated image to JPEG at 75% quality...');
        try {
            finalBuffer = await sharp(result.buffer)
                .jpeg({ quality: 75 })
                .toBuffer();
            contentType = 'image/jpeg';
            console.log(`✅ Generated image optimized: ${result.buffer.length} bytes → ${finalBuffer.length} bytes (${Math.round((1 - finalBuffer.length / result.buffer.length) * 100)}% reduction)`);
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
}));

app.post('/:model/img2img', createEndpointHandler(async (req, res) => {
            const key = req.params.model.toLowerCase();
            const model = Model[key.toUpperCase()];
            if (!model) {
                console.log('❌ Invalid model requested:', req.params.model);
                return res.status(400).json({ error: 'Invalid model' });
            }
            console.log(`✅ Valid model: ${req.params.model}`);
            
    const opts = buildOptions(key, req.body, null, true, req.query);
    await handleImageRequest(req, res, opts);
}));

app.get('/options', (req, res) => {
    console.log('\n🎯 GET /options');
    console.log('👤 Client IP:', req.ip);
    console.log('📅 Timestamp:', new Date().toISOString());
    
    try {
        const currentConfig = loadConfig();
        const currentPromptConfig = loadPromptConfig();
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
                entries: presetCache.size,
                clearEndpoint: "/cache/clear"
            }
        };
        
        console.log('📤 Sending options to client');
        res.json(options);
        console.log('✅ Options request completed successfully\n');
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Cache management endpoint
app.post('/cache/clear', (req, res) => {
    console.log('\n🎯 POST /cache/clear');
    console.log('👤 Client IP:', req.ip);
    console.log('📅 Timestamp:', new Date().toISOString());
    
    try {
        clearPresetCache();
        res.json({ 
            success: true, 
            message: 'Preset cache cleared successfully',
            clearedEntries: 0 // Will be logged by clearPresetCache
        });
        console.log('✅ Cache clear request completed successfully\n');
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Cache status endpoint
app.get('/cache/status', (req, res) => {
    console.log('\n🎯 GET /cache/status');
    console.log('👤 Client IP:', req.ip);
    console.log('📅 Timestamp:', new Date().toISOString());
    
    try {
        const now = Date.now();
        const cacheEntries = [];
        
        for (const [key, value] of presetCache.entries()) {
            const ageSeconds = Math.round((now - value.timestamp) / 1000);
            const ageMinutes = Math.round(ageSeconds / 60);
            const expiresIn = Math.max(0, 30 * 60 - ageSeconds);
            
            cacheEntries.push({
                key,
                filename: value.filename,
                age: `${ageMinutes}m ${ageSeconds % 60}s`,
                expiresIn: `${Math.floor(expiresIn / 60)}m ${expiresIn % 60}s`,
                size: value.buffer.length
            });
        }
        
        res.json({
            totalEntries: presetCache.size,
            entries: cacheEntries,
            ttl: "30 minutes"
        });
        console.log('✅ Cache status request completed successfully\n');
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

const upscaleImage = async (imageBuffer, scale = 4, width, height) => {
    const actualScale = scale === true ? 4 : scale; // Default to 4x if true
    if (actualScale <= 1) {
        console.log('📏 No upscaling needed (scale <= 1)');
        return imageBuffer;
    }
    
    console.log(`🔍 Upscaling image with NovelAI API (scale: ${actualScale}, dimensions: ${width}x${height})`);
    
    return upscaleLimiter.schedule(async () => {
        try {
            const payload = {
                height,
                image: imageBuffer.toString('base64'),
                scale: actualScale,
                width
            };
            
            console.log('📤 Sending upscale request to NovelAI API...');
            
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
                    console.log(`📡 Upscale API response status: ${res.statusCode}`);
                    let data = [];
                    res.on('data', chunk => data.push(chunk));
                    res.on('end', () => {
                        const buffer = Buffer.concat(data);
                        if (res.statusCode === 200) {
                            console.log('✅ Upscale API request successful');
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
            console.log('📦 Extracting PNG from ZIP response...');
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(zipBuffer);
            const zipEntries = zip.getEntries();
            
            if (zipEntries.length === 0) {
                throw new Error('ZIP file is empty');
        }
        
            // Get the first file (should be the upscaled PNG)
            const firstEntry = zipEntries[0];
            console.log(`📄 Extracted file: ${firstEntry.entryName} (${firstEntry.header.size} bytes)`);
            
            const upscaledBuffer = firstEntry.getData();
            console.log(`✅ Image upscaled successfully (scale: ${actualScale})`);
        return upscaledBuffer;
    } catch (error) {
        console.log('❌ Upscaling failed:', error.message);
        return imageBuffer;
    }
    }, `upscale-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
};

app.listen(config.port, () => console.log(`Server running on port ${config.port}`));