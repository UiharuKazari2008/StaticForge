const express = require('express');
const fs = require('fs');
const path = require('path');
const { NovelAI, Model, Action, Sampler, Noise, Resolution, calculateCost } = require('nekoai-js');
const waifu2x = require('waifu2x-node');

// Dynamic config loading
let config = null;
let configLastModified = 0;

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

// Text replacement function
function applyTextReplacements(text, presetName, model = null) {
    if (!text || !config.text_replacements) {
        return text;
    }
    
    let result = text;
    
    // Replace <PRESET_NAME> with the actual preset name
    result = result.replace(/<PRESET_NAME>/g, presetName);
    
    // Handle PICK_<NAME> replacements first
    const pickPattern = /<PICK_([^>]+)>/g;
    result = result.replace(pickPattern, (match, name) => {
        const matchingKeys = Object.keys(config.text_replacements).filter(key => 
            key.startsWith(name) && key !== name
        );
        
        if (matchingKeys.length === 0) {
            throw new Error(`No text replacements found starting with: ${name}`);
        }
        
        const randomKey = matchingKeys[Math.floor(Math.random() * matchingKeys.length)];
        const replacementValue = getReplacementValue(config.text_replacements[randomKey]);
        return replacementValue;
    });
    
    // Find all unique base keys from the text (extract keys from <KEY> patterns, excluding PICK_)
    const keyPattern = /<([^>]+)>/g;
    const foundKeys = new Set();
    let match;
    while ((match = keyPattern.exec(text)) !== null) {
        // Skip PICK_ keys as they're handled above
        if (!match[1].startsWith('PICK_')) {
            foundKeys.add(match[1]);
        }
    }
    
    // Apply text replacements with model-specific priority
    for (const baseKey of foundKeys) {
        const pattern = new RegExp(`<${baseKey}>`, 'g');
        
        // Check for model-specific version first
        if (model) {
            const modelSpecificKey = `${baseKey}_${model.toUpperCase()}`;
            if (config.text_replacements[modelSpecificKey]) {
                const replacementValue = getReplacementValue(config.text_replacements[modelSpecificKey]);
                result = result.replace(pattern, replacementValue);
                continue; // Skip the base key check
            }
        }
        
        // Fall back to base key
        if (config.text_replacements[baseKey]) {
            const replacementValue = getReplacementValue(config.text_replacements[baseKey]);
            result = result.replace(pattern, replacementValue);
        }
    }
    
    // Check if there are any remaining unmatched replacements
    const remainingReplacements = result.match(/<[^>]+>/g);
    if (remainingReplacements && remainingReplacements.length > 0) {
        const invalidReplacements = remainingReplacements.join(', ');
        throw new Error(`Invalid text replacement: ${invalidReplacements}`);
    }
    
    return result;
}

// Helper function to get replacement value (handles arrays and strings)
function getReplacementValue(value) {
    if (Array.isArray(value)) {
        // Randomly select an item from the array
        const randomIndex = Math.floor(Math.random() * value.length);
        return value[randomIndex];
    }
    return value;
}

// Function to get list of used replacement keys
function getUsedReplacements(text, model = null) {
    if (!text || !config.text_replacements) {
        return [];
    }
    
    const usedKeys = [];
    
    // Check for <PRESET_NAME>
    if (text.includes('<PRESET_NAME>')) {
        usedKeys.push('PRESET_NAME');
    }
    
    // Check for PICK_<NAME> replacements
    const pickPattern = /<PICK_([^>]+)>/g;
    let pickMatch;
    while ((pickMatch = pickPattern.exec(text)) !== null) {
        const name = pickMatch[1];
        const matchingKeys = Object.keys(config.text_replacements).filter(key => 
            key.startsWith(name) && key !== name
        );
        
        if (matchingKeys.length > 0) {
            // Show the PICK_ replacement and how many options it has
            usedKeys.push(`PICK_${name} (${matchingKeys.length} options)`);
        }
    }
    
    // Find all unique base keys from the text (extract keys from <KEY> patterns, excluding PICK_)
    const keyPattern = /<([^>]+)>/g;
    const foundKeys = new Set();
    let match;
    while ((match = keyPattern.exec(text)) !== null) {
        // Skip PICK_ keys as they're handled above
        if (!match[1].startsWith('PICK_')) {
            foundKeys.add(match[1]);
        }
    }
    
    // Check each found key for model-specific or base versions
    for (const baseKey of foundKeys) {
        if (baseKey === 'PRESET_NAME') continue; // Skip as it's handled above
        
        // Check for model-specific version first
        if (model) {
            const modelSpecificKey = `${baseKey}_${model.toUpperCase()}`;
            if (config.text_replacements[modelSpecificKey]) {
                const value = config.text_replacements[modelSpecificKey];
                const suffix = Array.isArray(value) ? ` (${model.toUpperCase()}, random)` : ` (${model.toUpperCase()})`;
                usedKeys.push(`${baseKey}${suffix}`);
                continue; // Skip the base key check
            }
        }
        
        // Check for base key
        if (config.text_replacements[baseKey]) {
            const value = config.text_replacements[baseKey];
            const suffix = Array.isArray(value) ? ' (random)' : '';
            usedKeys.push(`${baseKey}${suffix}`);
        }
    }
    
    return usedKeys;
}

// Get current config
config = loadConfig();

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

const presets = Object.keys(config.presets);
const presetNames = presets.map(p => p).join(', ');
console.log(`Available presets: ${presetNames}`);

const app = express();
app.use(express.json());

const imagesDir = path.resolve(__dirname, 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);

const upscaledDir = path.resolve(__dirname, 'upscaled');
if (!fs.existsSync(upscaledDir)) fs.mkdirSync(upscaledDir);

const formatDate = () => {
    const d = new Date(); const pad = n => n.toString().padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
};

async function saveImage(img, filename) {
    const filePath = path.join(imagesDir, filename);
    await img.save(filePath);
    return filename;
}

// Common options handler function
function buildOptions(model, body, preset = null, isImg2Img = false) {
    // Reload config to get latest changes
    const currentConfig = loadConfig();
    
    console.log('🔧 Building options...');
    console.log('📥 Input request:', JSON.stringify(body, null, 2));
    if (preset) {
        console.log('⚙️ Using preset:', JSON.stringify(preset, null, 2));
    }
    
    // Check if resolution is provided (body takes priority over preset)
    const resolution = body.resolution || (preset ? preset.resolution : undefined);
    
    // Get allowPaid (body takes priority over preset)
    const allowPaid = body.allow_paid !== undefined ? body.allow_paid : (preset ? preset.allow_paid : undefined);

    // Veriety+ Enable
    const skip_cfg_above_sigma = (body.variety || (preset ? preset.variety : undefined)) ? 59.04722600415217 : undefined
    
    let width, height;
    if (resolution && Resolution[resolution.toUpperCase()]) {
        // Use resolution preset directly
        console.log(`📐 Using resolution preset: "${resolution}"`);
        
        // Precheck: Resolution requiring paid tier
        if (resolution.startsWith('LARGE_') || resolution.startsWith('WALLPAPER_')) {
            if (!allowPaid) {
                throw new Error(`Resolution "${resolution}" requires Opus credits. Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
            }
            console.log(`⚠️ Using ${resolution} resolution (Opus credits required)`);
        }
        
        // Don't set width/height when using resolution preset
        width = undefined;
        height = undefined;
    } else {
        // Fall back to individual width/height settings (body takes priority over preset)
        width = body.width || (preset ? preset.width : 1024) || 1024;
        height = body.height || (preset ? preset.height : 1024) || 1024;
        console.log(`📐 Using custom dimensions: ${width}x${height}`);
        
        // Precheck: Custom dimensions > 1024
        if (width > 1024 || height > 1024) {
            if (!allowPaid) {
                throw new Error(`Custom dimensions ${width}x${height} exceed maximum of 1024. Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
            }
            console.log(`⚠️ Using custom dimensions ${width}x${height} (Opus credits required)`);
        }
    }

    // Get steps (body takes priority over preset)
    const steps = body.steps || (preset ? preset.steps : 24) || 24;
    
    // Precheck: Steps > 28
    if (steps > 28 && !allowPaid) {
        throw new Error(`Steps value ${steps} exceeds maximum of 28. Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
    }
    
    if (steps > 28) {
        console.log(`⚠️ Using ${steps} steps (Opus credits required)`);
    } else {
        console.log(`✅ Using ${steps} steps`);
    }

    // Get preset name for text replacements
    const presetName = preset ? Object.keys(currentConfig.presets).find(key => currentConfig.presets[key] === preset) : null;
    
    // Apply text replacements to prompt and negative prompt (body takes priority over preset)
    const rawPrompt = body.prompt || (preset ? preset.prompt : undefined);
    const rawNegativePrompt = body.uc || (preset ? preset.uc : undefined);
    
    let processedPrompt, processedNegativePrompt;
    
    try {
        processedPrompt = applyTextReplacements(rawPrompt, presetName, model);
        processedNegativePrompt = applyTextReplacements(rawNegativePrompt, presetName, model);
        
        // Get list of used replacements for logging
        const usedPromptReplacements = getUsedReplacements(rawPrompt, model);
        const usedNegativeReplacements = getUsedReplacements(rawNegativePrompt, model);
        
        if (usedPromptReplacements.length > 0) {
            console.log(`🔄 Applied text replacements to prompt: [${usedPromptReplacements.join(', ')}]`);
        }
        if (usedNegativeReplacements.length > 0) {
            console.log(`🔄 Applied text replacements to negative prompt: [${usedNegativeReplacements.join(', ')}]`);
        }
    } catch (error) {
        console.log('❌ Text replacement error:', error.message);
        throw error; // Re-throw to be caught by endpoint handler
    }

    const baseOptions = {
        prompt: processedPrompt,
        negative_prompt: processedNegativePrompt,
        model: Model[model.toUpperCase()],
        steps: steps,
        scale: body.guidance || (preset ? preset.guidance : 5.5) || 5.5,
        cfg_rescale: body.rescale || (preset ? preset.rescale : 0.0) || 0.0,
        skip_cfg_above_sigma: skip_cfg_above_sigma,
        sampler: body.sampler ? Sampler[body.sampler.toUpperCase()] : (preset ? (preset.sampler ? Sampler[preset.sampler.toUpperCase()] : Sampler.EULER_ANC) : Sampler.EULER_ANC),
        noiseScheduler: body.noiseScheduler ? Noise[body.noiseScheduler.toUpperCase()] : (preset ? (preset.noiseScheduler ? Noise[preset.noiseScheduler.toUpperCase()] : Noise.KARRAS) : Noise.KARRAS),
        characterPrompts: body.characterPrompts || (preset ? preset.characterPrompts : undefined),
        no_save: body.no_save !== undefined ? body.no_save : (preset ? preset.no_save : undefined),
        qualityToggle: false,
        ucPreset: 100,
        dynamicThresholding: body.dynamicThresholding || (preset ? preset.dynamicThresholding : undefined),
        seed: body.seed || (preset ? preset.seed : undefined),
        upscale: body.upscale || (preset ? preset.upscale : undefined)
    };

    // Add resolution or width/height based on what's provided
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

    // Check if request requires paid tier using calculateCost
    if (!allowPaid) {
        try {
            const cost_opus = calculateCost(baseOptions, true);
            const cost_free = calculateCost(baseOptions, false);
            console.log(`💰 Calculated cost: ${cost_free}, ${cost_opus} (Opus Tier)`);
            
            // If cost > 0, it means the request requires paid tier
            if (cost_opus > 0) {
                throw new Error(`Request requires Opus credits (cost: ${cost_opus}). Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
            }
        } catch (error) {
            if (error.message.includes('requires Opus credits')) {
                throw error;
            }
            console.log('⚠️ Cost calculation failed, proceeding with request:', error.message);
        }
    } else {
        console.log('✅ Opus credits allowed, skipping cost validation');
    }

    console.log('📋 Final options:', JSON.stringify(baseOptions, null, 2));
    return baseOptions;
}

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
    console.log(`📝 Generated filename: ${name}`);
    
    // Check if we should save the image (default to true unless no_save is explicitly set)
    const shouldSave = opts.no_save !== true;
    console.log(`💾 Save image: ${shouldSave ? 'Yes' : 'No'}`);
    
    if (returnImage) {
        console.log('📦 Preparing image buffer...');
        // For returning image buffer, we need to save it temporarily to get the buffer
        const tempPath = path.join(imagesDir, `temp_${name}`);
        await img.save(tempPath);
        console.log('💾 Temporary file saved');
        
        // Read the file as buffer
        let buffer = fs.readFileSync(tempPath);
        console.log(`📊 Buffer size: ${buffer.length} bytes`);
        
        // Apply upscaling if requested
        if (opts.upscale && opts.upscale > 1) {
            console.log(`🔍 Upscaling requested with scale: ${opts.upscale}`);
            buffer = await upscaleImage(buffer, opts.upscale);
            console.log(`📊 Upscaled buffer size: ${buffer.length} bytes`);
        }
        
        // Save image permanently if shouldSave is true
        if (shouldSave) {
            const finalPath = path.join(imagesDir, name);
            fs.renameSync(tempPath, finalPath);
            console.log(`💾 Image saved permanently: ${name}`);
            
            // If upscaling was applied, also save the upscaled version
            if (opts.upscale && opts.upscale > 1) {
                const upscaledName = `upscaled_${name}`;
                const upscaledPath = path.join(upscaledDir, upscaledName);
                fs.writeFileSync(upscaledPath, buffer);
                console.log(`💾 Upscaled image saved: ${upscaledName}`);
            }
        } else {
            // Remove temporary file if we don't want to save
            fs.unlinkSync(tempPath);
            console.log('🗑️ Temporary file removed');
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

// Request queue and rate limiting system
let isProcessing = false;
let requestQueue = [];
let lastRequestTime = 0;
const RATE_LIMIT_DELAY = 5000; // 5 seconds in milliseconds

// Queue management function
function processQueue() {
    if (isProcessing || requestQueue.length === 0) {
        return;
    }

    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
        // Still in rate limit period, wait
        const waitTime = RATE_LIMIT_DELAY - timeSinceLastRequest;
        console.log(`⏰ Rate limit active, waiting ${waitTime}ms before next request`);
        setTimeout(processQueue, waitTime);
        return;
    }

    isProcessing = true;
    const { req, res, handler } = requestQueue.shift();
    
    console.log(`🔄 Processing request from queue (${requestQueue.length} remaining)`);
    
    // Execute the request handler
    handler(req, res).finally(() => {
        isProcessing = false;
        lastRequestTime = Date.now();
        console.log(`✅ Request completed, rate limit timer started`);
        
        // Process next request in queue
        setTimeout(processQueue, RATE_LIMIT_DELAY);
    });
}

// Wrapper function to add requests to queue
function queueRequest(req, res, handler) {
    return new Promise((resolve, reject) => {
        const queueItem = {
            req,
            res,
            handler: async (req, res) => {
                try {
                    await handler(req, res);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }
        };
        
        requestQueue.push(queueItem);
        console.log(`📋 Request added to queue (position: ${requestQueue.length})`);
        
        // Start processing if not already processing
        processQueue();
    });
}

app.post('/:model/generate', async (req, res) => {
    await queueRequest(req, res, async (req, res) => {
        console.log(`\n🎯 POST /${req.params.model}/generate`);
        console.log('👤 Client IP:', req.ip);
        console.log('📅 Timestamp:', new Date().toISOString());
        
        // Reload config on every request
        const currentConfig = loadConfig();
        
        try {
            const key = req.params.model.toLowerCase();
            const model = Model[key.toUpperCase()];
            if (!model) {
                console.log('❌ Invalid model requested:', req.params.model);
                return res.status(400).json({ error: 'Invalid model' });
            }
            console.log(`✅ Valid model: ${req.params.model}`);
            
            const opts = buildOptions(key, req.body);
            const result = await handleGeneration(opts, true);
            
            // Set content type for image
            res.setHeader('Content-Type', 'image/png');
            
            // Only set download headers if download query parameter is true
            if (req.query.download === 'true') {
                res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
                console.log('📥 Setting download headers');
            } else {
                console.log('🖼️ Returning image as content');
            }
            
            console.log('📤 Sending image to client');
            res.send(result.buffer);
            console.log('✅ Request completed successfully\n');
        } catch(e) {
            console.log('❌ Error occurred:', e.message);
            res.status(500).json({ error: e.message });
        }
    });
});

app.get('/preset/:name', async (req, res) => {
    await queueRequest(req, res, async (req, res) => {
        console.log(`\n🎯 GET /preset/${req.params.name}`);
        console.log('👤 Client IP:', req.ip);
        console.log('📅 Timestamp:', new Date().toISOString());
        
        // Reload config on every request
        const currentConfig = loadConfig();
        
        try {
            const p = currentConfig.presets[req.params.name];
            if (!p) {
                console.log('❌ Preset not found:', req.params.name);
                return res.status(404).json({ error: 'Preset not found' });
            }
            console.log(`✅ Preset found: ${req.params.name}`);
            
            const opts = buildOptions(p.model, {}, p);
            const result = await handleGeneration(opts, true);
            
            // Set content type for image
            res.setHeader('Content-Type', 'image/png');
            
            // Only set download headers if download query parameter is true
            if (req.query.download === 'true') {
                res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
                console.log('📥 Setting download headers');
            } else {
                console.log('🖼️ Returning image as content');
            }
            
            console.log('📤 Sending image to client');
            res.send(result.buffer);
            console.log('✅ Request completed successfully\n');
        } catch(e) {
            console.log('❌ Error occurred:', e.message);
            res.status(500).json({ error: e.message });
        }
    });
});

app.post('/preset/:name', async (req, res) => {
    await queueRequest(req, res, async (req, res) => {
        console.log(`\n🎯 POST /preset/${req.params.name}`);
        console.log('👤 Client IP:', req.ip);
        console.log('📅 Timestamp:', new Date().toISOString());
        
        // Reload config on every request
        const currentConfig = loadConfig();
        
        try {
            const p = currentConfig.presets[req.params.name];
            if (!p) {
                console.log('❌ Preset not found:', req.params.name);
                return res.status(404).json({ error: 'Preset not found' });
            }
            console.log(`✅ Preset found: ${req.params.name}`);
            
            // Handle body overrides for POST requests
            const bodyOverrides = { ...req.body };
            
            // Handle prompt override - append to preset prompt if provided
            if (bodyOverrides.prompt) {
                const originalPrompt = p.prompt || '';
                bodyOverrides.prompt = originalPrompt + ', ' + bodyOverrides.prompt;
                console.log(`🔄 Appending body prompt to preset: "${bodyOverrides.prompt}"`);
                delete bodyOverrides.uc; // Remove uc override as per requirements
            }
            
            const opts = buildOptions(p.model, bodyOverrides, p);
            const result = await handleGeneration(opts, true);
            
            // Set content type for image
            res.setHeader('Content-Type', 'image/png');
            
            // Only set download headers if download query parameter is true
            if (req.query.download === 'true') {
                res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
                console.log('📥 Setting download headers');
            } else {
                console.log('🖼️ Returning image as content');
            }
            
            console.log('📤 Sending image to client');
            res.send(result.buffer);
            console.log('✅ Request completed successfully\n');
        } catch(e) {
            console.log('❌ Error occurred:', e.message);
            res.status(500).json({ error: e.message });
        }
    });
});

app.get('/preset/:name/:resolution', async (req, res) => {
    await queueRequest(req, res, async (req, res) => {
        console.log(`\n🎯 GET /preset/${req.params.name}/${req.params.resolution}`);
        console.log('👤 Client IP:', req.ip);
        console.log('📅 Timestamp:', new Date().toISOString());
        
        // Reload config on every request
        const currentConfig = loadConfig();
        
        try {
            const p = currentConfig.presets[req.params.name];
            if (!p) {
                console.log('❌ Preset not found:', req.params.name);
                return res.status(404).json({ error: 'Preset not found' });
            }
            console.log(`✅ Preset found: ${req.params.name}`);
            
            // Validate resolution
            const resolution = req.params.resolution;
            if (!Resolution[resolution.toUpperCase()]) {
                console.log('❌ Invalid resolution:', resolution);
                return res.status(400).json({ error: 'Invalid resolution' });
            }
            console.log(`✅ Valid resolution: ${resolution}`);
            
            const bodyOverrides = { resolution };
            const opts = buildOptions(p.model, bodyOverrides, p);
            const result = await handleGeneration(opts, true);
            
            // Set content type for image
            res.setHeader('Content-Type', 'image/png');
            
            // Only set download headers if download query parameter is true
            if (req.query.download === 'true') {
                res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
                console.log('📥 Setting download headers');
            } else {
                console.log('🖼️ Returning image as content');
            }
            
            console.log('📤 Sending image to client');
            res.send(result.buffer);
            console.log('✅ Request completed successfully\n');
        } catch(e) {
            console.log('❌ Error occurred:', e.message);
            res.status(500).json({ error: e.message });
        }
    });
});

app.post('/preset/:name/:resolution', async (req, res) => {
    await queueRequest(req, res, async (req, res) => {
        console.log(`\n🎯 POST /preset/${req.params.name}/${req.params.resolution}`);
        console.log('👤 Client IP:', req.ip);
        console.log('📅 Timestamp:', new Date().toISOString());
        
        // Reload config on every request
        const currentConfig = loadConfig();
        
        try {
            const p = currentConfig.presets[req.params.name];
            if (!p) {
                console.log('❌ Preset not found:', req.params.name);
                return res.status(404).json({ error: 'Preset not found' });
            }
            console.log(`✅ Preset found: ${req.params.name}`);
            
            // Validate resolution
            const resolution = req.params.resolution;
            if (!Resolution[resolution.toUpperCase()]) {
                console.log('❌ Invalid resolution:', resolution);
                return res.status(400).json({ error: 'Invalid resolution' });
            }
            console.log(`✅ Valid resolution: ${resolution}`);
            
            // Handle body overrides for POST requests
            const bodyOverrides = { resolution, ...req.body };
            
            // Handle prompt override - append to preset prompt if provided
            if (bodyOverrides.prompt) {
                const originalPrompt = p.prompt || '';
                bodyOverrides.prompt = originalPrompt + ', ' + bodyOverrides.prompt;
                console.log(`🔄 Appending body prompt to preset: "${bodyOverrides.prompt}"`);
                delete bodyOverrides.uc; // Remove uc override as per requirements
            }
            
            const opts = buildOptions(p.model, bodyOverrides, p);
            const result = await handleGeneration(opts, true);
            
            // Set content type for image
            res.setHeader('Content-Type', 'image/png');
            
            // Only set download headers if download query parameter is true
            if (req.query.download === 'true') {
                res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
                console.log('📥 Setting download headers');
            } else {
                console.log('🖼️ Returning image as content');
            }
            
            console.log('📤 Sending image to client');
            res.send(result.buffer);
            console.log('✅ Request completed successfully\n');
        } catch(e) {
            console.log('❌ Error occurred:', e.message);
            res.status(500).json({ error: e.message });
        }
    });
});

app.post('/:model/img2img', async (req, res) => {
    await queueRequest(req, res, async (req, res) => {
        console.log(`\n🎯 POST /${req.params.model}/img2img`);
        console.log('👤 Client IP:', req.ip);
        console.log('📅 Timestamp:', new Date().toISOString());
        
        // Reload config on every request
        const currentConfig = loadConfig();
        
        try {
            const key = req.params.model.toLowerCase();
            const model = Model[key.toUpperCase()];
            if (!model) {
                console.log('❌ Invalid model requested:', req.params.model);
                return res.status(400).json({ error: 'Invalid model' });
            }
            console.log(`✅ Valid model: ${req.params.model}`);
            
            const opts = buildOptions(key, req.body, null, true);
            const result = await handleGeneration(opts, true);
            
            // Set content type for image
            res.setHeader('Content-Type', 'image/png');
            
            // Only set download headers if download query parameter is true
            if (req.query.download === 'true') {
                res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
                console.log('📥 Setting download headers');
            } else {
                console.log('🖼️ Returning image as content');
            }
            
            console.log('📤 Sending image to client');
            res.send(result.buffer);
            console.log('✅ Request completed successfully\n');
        } catch(e) {
            console.log('❌ Error occurred:', e.message);
            res.status(500).json({ error: e.message });
        }
    });
});

app.listen(config.port, () => console.log(`Server running on port ${config.port}`));

// Endpoint to return available options
app.get('/options', (req, res) => {
    console.log('\n🎯 GET /options');
    console.log('👤 Client IP:', req.ip);
    console.log('📅 Timestamp:', new Date().toISOString());
    
    // Reload config on every request
    const currentConfig = loadConfig();
    
    try {
        const options = {
            models: Object.keys(Model).reduce((acc, key) => {
                acc[key] = Model[key];
                return acc;
            }, {}),
            actions: Object.keys(Action).reduce((acc, key) => {
                acc[key] = Action[key];
                return acc;
            }, {}),
            samplers: Object.keys(Sampler).reduce((acc, key) => {
                acc[key] = Sampler[key];
                return acc;
            }, {}),
            noiseSchedulers: Object.keys(Noise).reduce((acc, key) => {
                acc[key] = Noise[key];
                return acc;
            }, {}),
            resolutions: Object.keys(Resolution).reduce((acc, key) => {
                acc[key] = Resolution[key];
                return acc;
            }, {}),
            presets: Object.keys(currentConfig.presets),
            textReplacements: currentConfig.text_replacements || {}
        };
        
        console.log('📤 Sending options to client');
        res.json(options);
        console.log('✅ Options request completed successfully\n');
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Upscaling function using waifu2x-node
async function upscaleImage(imageBuffer, scale = 2) {
    if (scale <= 1) {
        console.log('📏 No upscaling needed (scale <= 1)');
        return imageBuffer;
    }
    
    console.log(`🔍 Upscaling image with scale factor: ${scale}`);
    
    try {
        // Create temporary file for input
        const tempInputPath = path.join(imagesDir, `temp_input_${Date.now()}.png`);
        fs.writeFileSync(tempInputPath, imageBuffer);
        
        // Create temporary file for output
        const tempOutputPath = path.join(imagesDir, `temp_output_${Date.now()}.png`);
        
        // Use W2XCJS for upscaling
        const { W2XCJS, DEFAULT_MODELS_DIR } = waifu2x;
        const converter = new W2XCJS();
        
        // Load models
        const err = converter.loadModels(DEFAULT_MODELS_DIR);
        if (err) {
            throw new Error(`Failed to load models: ${err}`);
        }
        
        // Convert file (upscale)
        const conv_err = converter.convertFile(tempInputPath, tempOutputPath);
        if (conv_err) {
            throw new Error(`Failed to convert file: ${conv_err}`);
        }
        
        // Read the upscaled image
        const upscaledBuffer = fs.readFileSync(tempOutputPath);
        
        // Clean up temporary files
        fs.unlinkSync(tempInputPath);
        fs.unlinkSync(tempOutputPath);
        
        console.log(`✅ Image upscaled successfully (scale: ${scale})`);
        return upscaledBuffer;
    } catch (error) {
        console.log('❌ Upscaling failed:', error.message);
        // Return original buffer if upscaling fails
        return imageBuffer;
    }
}