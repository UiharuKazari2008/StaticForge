const express = require('express');
const fs = require('fs');
const path = require('path');
const { NovelAI, Model, Action, Sampler, Noise, Resolution } = require('nekoai-js');

if (!fs.existsSync('./config.json')) {
    console.error('config.json not found');
    process.exit(1);
}
const config = require('./config.json');

if (!config.apiKey) {
    console.error('apiKey is not set in config.json');
    process.exit(1);
}

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
    console.log('🔧 Building options...');
    console.log('📥 Input request:', JSON.stringify(body, null, 2));
    if (preset) {
        console.log('⚙️ Using preset:', JSON.stringify(preset, null, 2));
    }
    
    // Check if resolution is provided (either in body or preset)
    const resolution = preset ? preset.resolution : body.resolution;
    
    let width, height;
    if (resolution && Resolution[resolution.toUpperCase()]) {
        // Use resolution preset directly
        console.log(`📐 Using resolution preset: "${resolution}"`);
        // Don't set width/height when using resolution preset
        width = undefined;
        height = undefined;
    } else {
        // Fall back to individual width/height settings
        width = preset ? (preset.width || 512) : (body.width || 512);
        height = preset ? (preset.height || 768) : (body.height || 768);
        console.log(`📐 Using custom dimensions: ${width}x${height}`);
    }

    // Validate steps
    const steps = preset ? (preset.steps || 28) : (body.steps || 28);
    const allowPaid = preset ? preset.allow_paid : body.allow_paid;
    
    if (steps > 28 && !allowPaid) {
        throw new Error(`Steps value ${steps} exceeds maximum of 28. Set "allow_paid": true to use higher step values.`);
    }
    
    if (steps > 28) {
        console.log(`⚠️ Using ${steps} steps (paid tier required)`);
    } else {
        console.log(`✅ Using ${steps} steps`);
    }

    const baseOptions = {
        prompt: preset ? preset.prompt : body.prompt,
        negative_prompt : preset ? preset.uc : body.uc,
        model: Model[model.toUpperCase()],
        steps: steps,
        scale: preset ? (preset.guidance || 7.5) : (body.guidance || 7.5),
        cfg_rescale: preset ? (preset.rescale || 0.0) : (body.rescale || 0.0),
        sampler: preset ? (preset.sampler || Sampler.EULER_ANC) : (body.sampler || Sampler.EULER_ANC),
        noiseScheduler: preset ? (preset.noiseScheduler || Noise.KARRAS) : (body.noiseScheduler || Noise.KARRAS),
        characterPrompts: preset ? preset.characterPrompts : body.characterPrompts,
        no_save: preset ? preset.no_save : body.no_save,
        qualityToggle: preset ? (preset.noQualityTags !== true) : (body.noQualityTags !== true),
        ucPreset: (preset ? preset.ucPreset : body.ucPreset) || 100,
        dynamicThresholding: preset ? preset.dynamicThresholding : body.dynamicThresholding,
        seed: preset ? preset.seed : body.seed || undefined
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
    const [img] = await client.generateImage(opts);
    console.log('✅ Image generation completed');
    
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
        const buffer = fs.readFileSync(tempPath);
        console.log(`📊 Buffer size: ${buffer.length} bytes`);
        
        // Save image permanently if shouldSave is true
        if (shouldSave) {
            const finalPath = path.join(imagesDir, name);
            fs.renameSync(tempPath, finalPath);
            console.log(`💾 Image saved permanently: ${name}`);
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
        
        try {
            const p = config.presets[req.params.name];
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

app.post('/:model/img2img', async (req, res) => {
    await queueRequest(req, res, async (req, res) => {
        console.log(`\n🎯 POST /${req.params.model}/img2img`);
        console.log('👤 Client IP:', req.ip);
        console.log('📅 Timestamp:', new Date().toISOString());
        
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
