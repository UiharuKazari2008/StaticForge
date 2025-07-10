const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const { NovelAI, Model, Action, Sampler, Noise, Resolution, calculateCost } = require('nekoai-js');
const config = require('./config.json');
const zlib = require('zlib');
const { createCanvas, loadImage } = require('canvas');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const multer = require('multer');

// Import modules
const { authMiddleware } = require('./modules/auth');
const { loadPromptConfig, applyTextReplacements, getUsedReplacements } = require('./modules/textReplacements');
const { getPresetCacheKey, getCachedPreset, setCachedPreset, clearPresetCache, getCacheStatus } = require('./modules/cache');
const { queueMiddleware } = require('./modules/queue');

console.log(config);

// Initialize NovelAI client
const client = new NovelAI({ 
    token: config.apiKey,
    timeout: 100000,
    verbose: false
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

const imagesDir = path.resolve(__dirname, 'images');
const previewsDir = path.resolve(__dirname, '.previews');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);
if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir);

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

// Inverse mapping: resolution name to dimensions
const inverseDimensionsMap = {
    "small_portrait": { width: 512, height: 768 },
    "small_landscape": { width: 768, height: 512 },
    "small_square": { width: 640, height: 640 },
    "normal_portrait": { width: 832, height: 1216 },
    "normal_landscape": { width: 1216, height: 832 },
    "normal_square": { width: 1024, height: 1024 },
    "large_portrait": { width: 1024, height: 1536 },
    "large_landscape": { width: 1536, height: 1024 },
    "large_square": { width: 1472, height: 1472 },
    "wallpaper_portrait": { width: 1088, height: 1920 },
    "wallpaper_landscape": { width: 1920, height: 1088 }
};

// Helper: Get resolution name from dimensions
function getResolutionFromDimensions(width, height) {
    const key = `${width}x${height}`;
    return dimensionsMap[key] || null;
}

// Helper: Get dimensions from resolution name
function getDimensionsFromResolution(resolution) {
    // Convert to lowercase for case-insensitive lookup
    const normalizedResolution = resolution.toLowerCase();
    return inverseDimensionsMap[normalizedResolution] || null;
}

// Helper: get base name for pairing
function getBaseName(filename) {
    return filename
        .replace(/_upscaled(?=\.)/, '')  // Remove _upscaled suffix
        .replace(/_pipeline(?=\.)/, '')  // Remove _pipeline suffix
        .replace(/_pipeline_upscaled(?=\.)/, '')  // Remove _pipeline_upscaled suffix
        .replace(/\.(png|jpg|jpeg)$/i, '');  // Remove file extension
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

// Updated /images endpoint
app.get('/images', async (req, res) => {
    try {
        const files = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
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
const buildOptions = async (model, body, preset = null, isImg2Img = false, queryParams = {}) => {
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

    // Check if this is a variation preset or img2img request
    const variationSettings = preset?.variation;
    const isVariationPreset = variationSettings && variationSettings.file;
    const baseOptions = {
        prompt: processedPrompt,
        negative_prompt: processedNegativePrompt,
        model: Model[model.toUpperCase() + (body.mask && body.image && !model.toUpperCase().includes('_INP') ? '_INP' : '')],
        steps,
        scale: body.guidance || preset?.guidance || 5.5,
        cfg_rescale: body.rescale || preset?.rescale || 0.0,
        skip_cfg_above_sigma: (body?.variety || preset?.variety || queryParams?.variety === 'true') ? 58 : undefined,
        sampler: body.sampler ? Sampler[body.sampler.toUpperCase()] : (preset?.sampler ? Sampler[preset.sampler.toUpperCase()] : Sampler.EULER_ANC),
        noise_schedule: body.noiseScheduler ? Noise[body.noiseScheduler.toUpperCase()] : (preset?.noiseScheduler ? Noise[preset.noiseScheduler.toUpperCase()] : Noise.KARRAS),
        no_save: body.no_save !== undefined ? body.no_save : preset?.no_save,
        qualityToggle: false,
        ucPreset: 4,
        dynamicThresholding: body.dynamicThresholding || preset?.dynamicThresholding,
        seed: body.seed || preset?.seed,
        upscale: upscaleValue,
        characterPrompts: body.characterPrompts || preset?.characterPrompts || undefined,
        allCharacterPrompts: processedCharacterPrompts || undefined,
        use_coords: body.use_coords || preset?.use_coords || undefined,
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
    
    if (!!body.image || isVariationPreset) {
        baseOptions.action = (body.mask) ? Action.INPAINT : Action.IMG2IMG;
        if (body.mask) {
            baseOptions.mask = body.mask;
            baseOptions.inpaintImg2ImgStrength = body.inpainting_strength || body.strength || 1;
            baseOptions.strength = 1;
            baseOptions.noise = 0.1;
            baseOptions.img2img = {
                strength: baseOptions.inpaintImg2ImgStrength,
                color_correct: true
            }
        } else {
            baseOptions.strength = body.strength || variationSettings?.strength || 0.8;
            baseOptions.noise = body.noise || variationSettings?.noise || 0.1;
        }
        
        if (isVariationPreset) {
            // Load the variation source image
            const variationFilePath = path.join(imagesDir, variationSettings.file);
            if (!fs.existsSync(variationFilePath)) {
                throw new Error(`Variation source image not found: ${variationSettings.file}`);
            }
            let imageBuffer = fs.readFileSync(variationFilePath);
            imageBuffer = stripPngTextChunks(imageBuffer); // Strip all PNG tEXt metadata
            
            // Resize image to match target resolution if specified
            if (resolution && Resolution[resolution.toUpperCase()]) {
                const targetDims = getDimensionsFromResolution(resolution);
                if (targetDims) {
                    imageBuffer = await processImageToResolution(imageBuffer, targetDims);
                    console.log(`📏 Resized variation source image to ${targetDims.width}x${targetDims.height}`);
                }
            }
            
            baseOptions.image = imageBuffer.toString('base64');
            baseOptions.original_filename = variationSettings.file; // Track original filename
        } else {
            // Regular img2img - handle both filename and base64 data
            if (body.image) {
                // Check if this is a frontend upload (base64) or existing image (filename)
                if (body.is_frontend_upload) {
                    // This is base64 data from frontend upload
                    let imageBuffer = Buffer.from(body.image, 'base64');
                    
                    // Resize image to match target resolution if specified
                    if (resolution && Resolution[resolution.toUpperCase()]) {
                        const targetDims = getDimensionsFromResolution(resolution);
                        if (targetDims) {
                            imageBuffer = await processImageToResolution(imageBuffer, targetDims);
                            console.log(`📏 Resized frontend upload image to ${targetDims.width}x${targetDims.height}`);
                        }
                    }
                    
                    baseOptions.image = imageBuffer.toString('base64');
                    baseOptions.is_frontend_upload = true;
                } else {
                    // This is a filename - load the image from disk
                    const filePath = path.join(imagesDir, body.image);
                    if (!fs.existsSync(filePath)) {
                        throw new Error(`Image not found: ${body.image}`);
                    }
                    let imageBuffer = fs.readFileSync(filePath);
                    imageBuffer = stripPngTextChunks(imageBuffer);
                    
                    // Resize image to match target resolution if specified
                    if (resolution && Resolution[resolution.toUpperCase()]) {
                        const targetDims = getDimensionsFromResolution(resolution);
                        if (targetDims) {
                            imageBuffer = await processImageToResolution(imageBuffer, targetDims);
                            console.log(`📏 Resized base image to ${targetDims.width}x${targetDims.height}`);
                        }
                    }
                    
                    baseOptions.image = imageBuffer.toString('base64');
                    baseOptions.original_filename = body.image;
                }
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

async function handleGeneration(opts, returnImage = false, presetName = null) {
    const seed = opts.seed || Math.floor(0x100000000 * Math.random() - 1);
    const isPipeline = opts.isPipeline || false;
    const layer1Seed = opts.layer1Seed || null;
    
    opts.n_samples = 1;
    opts.seed = seed;
    if (opts.action === Action.INPAINT) {
        opts.add_original_image = false;
        opts.extra_noise_seed = seed;
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
        if (opts.allCharacterPrompts && Array.isArray(opts.allCharacterPrompts) && opts.allCharacterPrompts.length > 0) {
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
        
        // Add mask bias if present
        if (opts.mask_bias !== undefined) {
            forgeData.mask_bias = opts.mask_bias;
        }
        if (opts.mask !== undefined) {
            forgeData.mask = opts.mask;
        }

        // Add variation info if applicable
        if (opts.action === Action.IMG2IMG && opts.image) {
            forgeData.generation_type = 'variation';
            forgeData.variation_source = opts.image;
            // Add original filename if available
            if (opts.original_filename) {
                forgeData.original_filename = opts.original_filename;
            }
        }
        
        // Update buffer with forge metadata
        buffer = updateMetadata(buffer, forgeData);
        
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
            await saveImage(img, name);
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
    res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename');
    
    if (result && result.filename) {
        res.setHeader('X-Generated-Filename', result.filename);
    } else {
        console.log('❌ No filename available in result:', result);
    }
    if (req.query.download === 'true') {
        const extension = optimize ? 'jpg' : 'png';
        const optimizedFilename = result.filename.replace('.png', `.${extension}`);
        res.setHeader('Content-Disposition', `attachment; filename="${optimizedFilename}"`);
    }
    res.send(finalBuffer);
};

// POST /preset/save (save a new preset) - MUST BE BEFORE /preset/:name
app.post('/preset/save', authMiddleware, async (req, res) => {
    try {
        const { name, ...presetData } = req.body;
        
        
        if (!name || !presetData.prompt || !presetData.model) {
            return res.status(400).json({ error: 'Preset name, prompt, and model are required' });
        }
        
        const currentPromptConfig = loadPromptConfig();
        
        // Add the new preset
        currentPromptConfig.presets[name] = {
            prompt: presetData.prompt,
            uc: presetData.uc || '',
            model: presetData.model,
            resolution: presetData.resolution || '',
            steps: presetData.steps || 25,
            guidance: presetData.guidance || 5.0,
            rescale: presetData.rescale || 0.0,
            seed: presetData.seed || undefined,
            sampler: presetData.sampler || undefined,
            noiseScheduler: presetData.noiseScheduler || undefined,
            upscale: presetData.upscale || undefined,
            allow_paid: presetData.allow_paid || false,
            variation: presetData.variation || undefined,
            characterPrompts: presetData.characterPrompts || []
        };
        
        // Save to file
        fs.writeFileSync('./prompt.config.json', JSON.stringify(currentPromptConfig, null, 2));
        
        console.log(`💾 Saved new preset: ${name}`);
        
        res.json({ success: true, message: `Preset "${name}" saved successfully` });
        
    } catch(e) {
        console.log('❌ Error occurred in preset save:', e.message);
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
    
    // Check if this is a variation preset
    const isVariationPreset = p.variation && p.variation.file;
    const opts = await buildOptions(p.model, {}, p, isVariationPreset, req.query);
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
    const opts = await buildOptions(p.model, body, p, false, req.query);
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
    // Check if this is a variation preset
    const isVariationPreset = p.variation && p.variation.file;
    const opts = await buildOptions(p.model, bodyOverrides, p, isVariationPreset, req.query);
    res.json({ prompt: opts.prompt, uc: opts.negative_prompt });
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// GET /preset/:name/raw (returns raw preset data without text replacement processing)
app.get('/preset/:name/raw', authMiddleware, async (req, res) => {
    try {
        const currentPromptConfig = loadPromptConfig();
        const p = currentPromptConfig.presets[req.params.name];
        if (!p) {
            return res.status(404).json({ error: 'Preset not found' });
        }
        
        // Return the raw preset data without processing text replacements
        res.json({
            prompt: p.prompt || '',
            uc: p.uc || '',
            model: p.model || '',
            resolution: p.resolution || '',
            steps: p.steps || 25,
            guidance: p.guidance || 5.0,
            rescale: p.rescale || 0.0,
            seed: p.seed || null,
            sampler: p.sampler || null,
            noiseScheduler: p.noiseScheduler || null,
            upscale: p.upscale || false,
            allow_paid: p.allow_paid || false,
            variation: p.variation || null,
            characterPrompts: p.characterPrompts || []
        });
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// OPTIONS method for preset details
app.options('/preset/:name', authMiddleware, async (req, res) => {
    try {
        const currentPromptConfig = loadPromptConfig();
        const p = currentPromptConfig.presets[req.params.name];
        if (!p) {
            return res.status(404).json({ error: 'Preset not found' });
        }
        
        // Return preset details for the dropdown
        res.json({
            type: 'preset',
            name: req.params.name,
            data: p
        });
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
    // Check if this is a variation preset
    const isVariationPreset = p.variation && p.variation.file;
    const opts = await buildOptions(p.model, bodyOverrides, p, isVariationPreset, req.query);
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
    
    // Check if this is a variation preset
    const isVariationPreset = p.variation && p.variation.file;
    const opts = await buildOptions(p.model, bodyOverrides, p, isVariationPreset, req.query);
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
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/options', authMiddleware, (req, res) => {
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

// Upload endpoint
app.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }
        
        const filename = req.file.filename;
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
        
        res.json({ 
            success: true, 
            message: 'Image uploaded successfully',
            filename: filename
        });
        
    } catch(e) {
        console.log('❌ Upload error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

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

// Balance endpoint
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

// Helper: Extract NovelAI metadata from PNG
function extractNovelAIMetadata(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        const metadata = readMetadata(buffer);
        
        if (metadata.tEXt && metadata.tEXt.Comment) {
            const _metadata = JSON.parse(metadata.tEXt.Comment);
            const result = {
                ..._metadata,
                source: metadata.tEXt.Source,
                software: metadata.tEXt.Software ? `${metadata.tEXt.Software} (${metadata.tEXt.Source})` : metadata.tEXt.Source
            };
            
            // Extract forge_data if it exists
            if (_metadata.forge_data) {
                result.forge_data = _metadata.forge_data;
            }
            
            return result;
        }
        return null;
    } catch (error) {
        console.error('Error extracting metadata:', error.message);
        return null;
    }
}

// Helper: Update PNG metadata with forge_data
function updateMetadata(imageBuffer, forgeData) {
    try {
        const metadata = readMetadata(imageBuffer);
        let existingMetadata = {};
        
        // Parse existing Comment metadata if it exists
        if (metadata.tEXt && metadata.tEXt.Comment) {
            try {
                existingMetadata = JSON.parse(metadata.tEXt.Comment);
            } catch (e) {
                console.error('Error parsing existing metadata:', e.message);
                existingMetadata = {};
            }
        }
        
        // Merge forge_data
        const hasExistingForgeData = !!existingMetadata.forge_data;
        if (!existingMetadata.forge_data) {
            existingMetadata.forge_data = {};
        }
        existingMetadata.forge_data.software = 'StaticForge v1.0';
        if (!existingMetadata.forge_data.history) {
            existingMetadata.forge_data.history = [];
        }
        // Preserve existing preset_name if it exists
        const existingPresetName = existingMetadata.forge_data.preset_name;
        
        if (hasExistingForgeData) {
            const currentSeed = existingMetadata.seed;
            const historyEntry = {
                generation_type: existingMetadata.forge_data.generation_type || 'unknown',
                date_generated: existingMetadata.forge_data.date_generated || Date.now(),
                seed: currentSeed,
                filename: existingMetadata.filename || 'unknown'
            };
            existingMetadata.forge_data.history.push(historyEntry);
        }
        
        // Merge new data into existing forge_data, excluding null values
        const cleanForgeData = {};
        for (const [key, value] of Object.entries(forgeData)) {
            if (value !== null) {
                cleanForgeData[key] = value;
            }
        }
        
        existingMetadata.forge_data = { ...existingMetadata.forge_data, ...cleanForgeData };
        
        // Restore existing preset_name if it was there
        if (existingPresetName && !forgeData.preset_name) {
            existingMetadata.forge_data.preset_name = existingPresetName;
        }
        
        // Create new PNG with updated metadata
        return insertTextChunk(imageBuffer, 'Comment', JSON.stringify(existingMetadata));
        
    } catch (error) {
        console.error('Error updating metadata:', error.message);
        return imageBuffer; // Return original buffer if update fails
    }
}

// Helper: Insert text chunk into PNG
function insertTextChunk(imageBuffer, keyword, text) {
    try {
        const data = new Uint8Array(imageBuffer);
        
        // Find existing Comment chunk and IEND chunk
        let commentStart = -1;
        let commentEnd = -1;
        let iendPos = -1;
        let idx = 8; // Skip PNG header
        
        while (idx < data.length - 4) {
            const length = readUint32(data, idx);
            const name = String.fromCharCode(...data.slice(idx + 4, idx + 8));
            
            if (name === 'tEXt') {
                // Check if this is a Comment chunk
                const chunkData = data.slice(idx + 8, idx + 8 + length);
                const keywordStart = chunkData.indexOf(0); // Find null byte separator
                if (keywordStart !== -1) {
                    const chunkKeyword = new TextDecoder().decode(chunkData.slice(0, keywordStart));
                    if (chunkKeyword === keyword) {
                        commentStart = idx;
                        commentEnd = idx + 4 + 4 + length + 4; // length + type + data + CRC
                    }
                }
            } else if (name === 'IEND') {
                iendPos = idx;
                break;
            }
            
            idx += 4 + 4 + length + 4; // length + type + data + CRC
        }
        
        if (iendPos === -1) {
            throw new Error('IEND chunk not found');
        }
        
        // Create the text chunk
        const keywordBytes = new TextEncoder().encode(keyword);
        const textBytes = new TextEncoder().encode(text);
        const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
        chunkData.set(keywordBytes, 0);
        chunkData[keywordBytes.length] = 0; // null byte separator
        chunkData.set(textBytes, keywordBytes.length + 1);
        
        // Create the full chunk with length, type, data, and CRC
        const typeBytes = new TextEncoder().encode('tEXt');
        const chunkLength = chunkData.length;
        const fullChunk = new Uint8Array(4 + 4 + chunkLength + 4);
        
        // Write length (big-endian)
        fullChunk[0] = (chunkLength >>> 24) & 0xFF;
        fullChunk[1] = (chunkLength >>> 16) & 0xFF;
        fullChunk[2] = (chunkLength >>> 8) & 0xFF;
        fullChunk[3] = chunkLength & 0xFF;
        
        // Write type
        fullChunk.set(typeBytes, 4);
        
        // Write data
        fullChunk.set(chunkData, 8);
        
        // Calculate and write CRC
        const crc = calculateCRC(fullChunk.slice(4, 8 + chunkLength));
        fullChunk[8 + chunkLength] = (crc >>> 24) & 0xFF;
        fullChunk[8 + chunkLength + 1] = (crc >>> 16) & 0xFF;
        fullChunk[8 + chunkLength + 2] = (crc >>> 8) & 0xFF;
        fullChunk[8 + chunkLength + 3] = crc & 0xFF;
        
        // Create new buffer
        let newBuffer;
        if (commentStart !== -1) {
            // Replace existing Comment chunk
            const beforeComment = data.slice(0, commentStart);
            const afterComment = data.slice(commentEnd);
            newBuffer = new Uint8Array(beforeComment.length + fullChunk.length + afterComment.length);
            newBuffer.set(beforeComment, 0);
            newBuffer.set(fullChunk, beforeComment.length);
            newBuffer.set(afterComment, beforeComment.length + fullChunk.length);
        } else {
            // Insert new Comment chunk before IEND
            const beforeIend = data.slice(0, iendPos);
            const afterIend = data.slice(iendPos);
            newBuffer = new Uint8Array(beforeIend.length + fullChunk.length + afterIend.length);
            newBuffer.set(beforeIend, 0);
            newBuffer.set(fullChunk, beforeIend.length);
            newBuffer.set(afterIend, beforeIend.length + fullChunk.length);
        }
        
        return Buffer.from(newBuffer);
        
    } catch (error) {
        console.error('Error inserting text chunk:', error.message);
        return imageBuffer; // Return original buffer if insertion fails
    }
}

// Helper: Calculate CRC32
function calculateCRC(data) {
    let crc = 0xFFFFFFFF;
    const table = [];
    
    // Generate CRC table
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[i] = c;
    }
    
    // Calculate CRC
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    
    return (crc ^ 0xFFFFFFFF) >>> 0;
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

function extractRelevantFields(meta, filename) {
    if (!meta) return null;
    
    const model = determineModelFromMetadata(meta);
    const modelDisplayName = getModelDisplayName(model);
    
    // Check if dimensions match a known resolution
    const resolution = getResolutionFromDimensions(meta.width, meta.height);
    
    // Extract metadata from forge_data only
    const forgeData = meta.forge_data || {};
    const upscaled = forgeData.upscale_ratio !== null && forgeData.upscale_ratio !== undefined;
    const hasBaseImage = forgeData.variation_source !== undefined;
    
    // Extract character prompts from forge_data (includes disabled characters and character names)
    let characterPrompts = [];
    
    // First, process v4_prompt character data if available
    let hasCharacterPrompts = false;
    if (meta.v4_prompt && meta.v4_prompt.caption.char_captions && Array.isArray(meta.v4_prompt.caption.char_captions) && meta.v4_prompt.caption.char_captions.length > 0) {
        hasCharacterPrompts = true;
        const positiveCaptions = meta.v4_prompt.caption.char_captions;
        const negativeCaptions = meta.v4_negative_prompt && meta.v4_negative_prompt.caption.char_captions ? meta.v4_negative_prompt.caption.char_captions : [];
        
        // Merge positive and negative captions by matching centers
        const captionMap = new Map();
        
        // Process positive captions
        positiveCaptions.forEach(caption => {
            if (caption.char_caption && caption.centers && Array.isArray(caption.centers) && caption.centers.length > 0) {
                const center = caption.centers[0]; // Use first center
                const key = `${center.x}_${center.y}`;
                captionMap.set(key, {
                    prompt: caption.char_caption,
                    uc: '',
                    center: { x: center.x, y: center.y },
                    enabled: true,
                    chara_name: ''
                });
            }
        });
        
        // Process negative captions and merge with positive ones
        negativeCaptions.forEach(caption => {
            if (caption.char_caption && caption.centers && Array.isArray(caption.centers) && caption.centers.length > 0) {
                const center = caption.centers[0]; // Use first center
                const key = `${center.x}_${center.y}`;
                
                if (captionMap.has(key)) {
                    captionMap.get(key).uc = caption.char_caption;
                }
            }
        });
        
        // Convert map to array
        characterPrompts = Array.from(captionMap.values());
        
        // Now handle disabled characters and names if forge data is available
        if (forgeData.disabledCharacters && Array.isArray(forgeData.disabledCharacters)) {
            // Insert disabled characters at their correct indices
            forgeData.disabledCharacters.forEach(disabledChar => {
                characterPrompts.splice(disabledChar.index, 0, {
                    prompt: disabledChar.prompt,
                    uc: disabledChar.uc,
                    center: disabledChar.center,
                    enabled: false,
                    chara_name: disabledChar.chara_name
                });
            });
        }
        
        // Apply character names if available (regardless of disabled characters)
        if (forgeData.characterNames && Array.isArray(forgeData.characterNames)) {
            characterPrompts.forEach((char, index) => {
                if (forgeData.characterNames[index]) {
                    char.chara_name = forgeData.characterNames[index];
                }
            });
        }
    } else if (forgeData.disabledCharacters && Array.isArray(forgeData.disabledCharacters)) {
        // Fallback: only forge data available (no API character data)
        characterPrompts = forgeData.disabledCharacters.map(disabledChar => ({
            prompt: disabledChar.prompt,
            uc: disabledChar.uc,
            center: disabledChar.center,
            enabled: false,
            chara_name: disabledChar.chara_name
        }));
        
        // Apply character names if available
        if (forgeData.characterNames && Array.isArray(forgeData.characterNames)) {
            characterPrompts.forEach((char, index) => {
                if (forgeData.characterNames[index]) {
                    char.chara_name = forgeData.characterNames[index];
                }
            });
        }
        
        // Apply use_coords setting to all characters if available
        if (forgeData.use_coords !== undefined) {
            characterPrompts.forEach((char) => {
                char.use_coords = forgeData.use_coords;
            });
        }
    }
    
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
        characterPrompts: characterPrompts,
        upscaled: upscaled,
        base_image: hasBaseImage,
        history: forgeData.history,
        request_type: forgeData.request_type,
        original_filename: forgeData.original_filename,
        preset_name: forgeData.preset_name,
        use_coords: hasCharacterPrompts ? meta.v4_prompt.use_coords : forgeData.use_coords || false,
        strength: meta.strength,
        noise: meta.noise
    };
    
    // Add frontend upload data if present
    if (forgeData.variation_source) {
        result.variation_source = forgeData.variation_source;
    }
    
    if (forgeData.layer1_seed !== undefined) {
        result.layer1Seed = forgeData.layer1_seed;
        result.layer2Seed = meta.seed;
    } else if (meta.seed !== undefined) {
        result.seed = meta.seed;
    }
    
    // Add mask bias if present in forge data
    if (forgeData.mask_bias !== undefined) {
        result.mask_bias = forgeData.mask_bias;
    }
    if (forgeData.mask !== undefined) {
        result.mask = forgeData.mask;
    }
    
    // Add resolution if it matches, otherwise add height and width
    if (resolution) {
        // Convert to uppercase to match the frontend expectations
        result.resolution = resolution.toUpperCase();
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
        const isUpscaled = meta.forge_data?.upscale_ratio !== null && meta.forge_data?.upscale_ratio !== undefined;
        if (isUpscaled) {
            const currentPromptConfig = loadPromptConfig();
            matchedPreset = matchOriginalResolution(meta, currentPromptConfig.resolutions || {});
        }
        
        const result = extractRelevantFields(meta, filename);
        if (matchedPreset) result.matchedPreset = matchedPreset;
        
        // Debug: Log the metadata values
        
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
                return "V4_5";
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
function getModelDisplayName(model, short = false) {
    const modelDisplayNames = {
        "V3": "NovelAI Diffusion v3 - Anime",
        "FURRY": "NovelAI Diffusion v3 - Furry",
        "V4": "NovelAI Diffusion v4 - Full",
        "V4_CUR": "NovelAI Diffusion v4 - Curated Preview",
        "V4_5": "NovelAI Diffusion v4.5 - Full",
        "V4_5_CUR": "NovelAI Diffusion v4.5 - Curated", 
        "unknown": "Unknown"
    };
    
    const modelDisplayNamesShort = {
        "V3": "v3 Anime",
        "FURRY": "v3 Furry",
        "V4": "v4 Full",
        "V4_CUR": "v4 Curated",
        "V4_5": "v4.5 Full",
        "V4_5_CUR": "v4.5 Curated", 
        "unknown": "Unknown"
    };
    
    return short ? modelDisplayNamesShort[model] : modelDisplayNames[model] || model;
}

// Three-way mapping for samplers
const SAMPLER_MAP = [
{ meta: 'k_euler_ancestral', display: 'Euler Ancestral', request: 'EULER_ANC' },
{ meta: 'k_dpmpp_sde', display: 'DPM++ SDE', request: 'DPMSDE' },
{ meta: 'k_dpmpp_2m', display: 'DPM++ 2M', request: 'DPM2M' },
{ meta: 'k_dpmpp_2m_sde', display: 'DPM++ 2M SDE', request: 'DPM2MSDE' },
{ meta: 'k_euler', display: 'Euler', request: 'EULER' },
{ meta: 'k_dpmpp_2s_ancestral', display: 'DPM++ 2S Ancestral', request: 'DPM2S_ANC' }
];

// Three-way mapping for noise schedulers
const NOISE_MAP = [
{ meta: 'karras', display: 'Kerras', request: 'KARRAS' },
{ meta: 'exponential', display: 'Exponential', request: 'EXPONENTIAL' },
{ meta: 'polyexponential', display: 'Polyexponental', request: 'POLYEXPONENTIAL' }
];

// Helper functions for sampler mapping
function getSamplerByMeta(meta) {
return SAMPLER_MAP.find(s => s.meta === meta);
}
function getSamplerByRequest(request) {
return SAMPLER_MAP.find(s => s.request === request);
}
function getSamplerByDisplay(display) {
return SAMPLER_MAP.find(s => s.display === display);
}

// Helper functions for noise mapping
function getNoiseByMeta(meta) {
return NOISE_MAP.find(n => n.meta === meta);
}
function getNoiseByRequest(request) {
return NOISE_MAP.find(n => n.request === request);
}
function getNoiseByDisplay(display) {
return NOISE_MAP.find(n => n.display === display);
}

// DELETE /images/:filename (delete image and related files)
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
        
        // Determine which files to delete
        const filesToDelete = [];
        
        // Add the requested file
        filesToDelete.push({ path: filePath, type: 'image' });
        
        // Find and add related files based on filename patterns
        if (filename.includes('_pipeline_upscaled')) {
            // If this is a pipeline_upscaled file, find and add the pipeline version
            const pipelineFilename = filename.replace('_upscaled.png', '.png');
            const pipelinePath = path.join(imagesDir, pipelineFilename);
            if (fs.existsSync(pipelinePath)) {
                filesToDelete.push({ path: pipelinePath, type: 'pipeline' });
            }
        } else if (filename.includes('_pipeline')) {
            // If this is a pipeline file, find and add the pipeline_upscaled version
            const pipelineUpscaledFilename = filename.replace('.png', '_upscaled.png');
            const pipelineUpscaledPath = path.join(imagesDir, pipelineUpscaledFilename);
            if (fs.existsSync(pipelineUpscaledPath)) {
                filesToDelete.push({ path: pipelineUpscaledPath, type: 'pipeline_upscaled' });
            }
        } else if (filename.includes('_upscaled')) {
            // If this is an upscaled file, find and add the original version
            const originalFilename = filename.replace('_upscaled.png', '.png');
            const originalPath = path.join(imagesDir, originalFilename);
            if (fs.existsSync(originalPath)) {
                filesToDelete.push({ path: originalPath, type: 'original' });
            }
        } else {
            // If this is an original file, find and add the upscaled version
            const upscaledFilename = filename.replace('.png', '_upscaled.png');
            const upscaledPath = path.join(imagesDir, upscaledFilename);
            if (fs.existsSync(upscaledPath)) {
                filesToDelete.push({ path: upscaledPath, type: 'upscaled' });
            }
        }
        
        // Add the preview file
        if (fs.existsSync(previewPath)) {
            filesToDelete.push({ path: previewPath, type: 'preview' });
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

// POST /images/bulk-delete (bulk delete multiple images)
app.post('/images/bulk-delete', authMiddleware, async (req, res) => {
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
                
                // Determine which files to delete
                const filesToDelete = [];
                
                // Add the requested file
                filesToDelete.push({ path: filePath, type: 'image' });
                
                // Find and add related files based on filename patterns
                if (filename.includes('_pipeline_upscaled')) {
                    // If this is a pipeline_upscaled file, find and add the pipeline version
                    const pipelineFilename = filename.replace('_upscaled.png', '.png');
                    const pipelinePath = path.join(imagesDir, pipelineFilename);
                    if (fs.existsSync(pipelinePath)) {
                        filesToDelete.push({ path: pipelinePath, type: 'pipeline' });
                    }
                } else if (filename.includes('_pipeline')) {
                    // If this is a pipeline file, find and add the pipeline_upscaled version
                    const pipelineUpscaledFilename = filename.replace('.png', '_upscaled.png');
                    const pipelineUpscaledPath = path.join(imagesDir, pipelineUpscaledFilename);
                    if (fs.existsSync(pipelineUpscaledPath)) {
                        filesToDelete.push({ path: pipelineUpscaledPath, type: 'pipeline_upscaled' });
                    }
                } else if (filename.includes('_upscaled')) {
                    // If this is an upscaled file, find and add the original version
                    const originalFilename = filename.replace('_upscaled.png', '.png');
                    const originalPath = path.join(imagesDir, originalFilename);
                    if (fs.existsSync(originalPath)) {
                        filesToDelete.push({ path: originalPath, type: 'original' });
                    }
                } else {
                    // If this is an original file, find and add the upscaled version
                    const upscaledFilename = filename.replace('.png', '_upscaled.png');
                    const upscaledPath = path.join(imagesDir, upscaledFilename);
                    if (fs.existsSync(upscaledPath)) {
                        filesToDelete.push({ path: upscaledPath, type: 'upscaled' });
                    }
                }
                
                // Add the preview file
                if (fs.existsSync(previewPath)) {
                    filesToDelete.push({ path: previewPath, type: 'preview' });
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
                
                // Check if there's an upscaled version - if so, only move that and delete the base
                if (filename.includes('_upscaled')) {
                    // This is an upscaled file, move it and delete the base
                    filesToMove.push({ source: sourcePath, type: 'upscaled' });
                    
                    // Find and delete the base version
                    const baseFilename = filename.replace('_upscaled.png', '.png');
                    const basePath = path.join(imagesDir, baseFilename);
                    if (fs.existsSync(basePath)) {
                        filesToDelete.push({ path: basePath, type: 'base' });
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
                    } else {
                        // No upscaled version, move the base
                        filesToMove.push({ source: sourcePath, type: 'base' });
                    }
                }
                
                // Add preview to delete list
                if (fs.existsSync(previewPath)) {
                    filesToDelete.push({ path: previewPath, type: 'preview' });
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

// Pipeline helper functions
async function generateMaskFromCoordinates(coordinates, resolution) {
    const dimensions = getDimensionsFromResolution(resolution);
    if (!dimensions) throw new Error(`Invalid resolution: ${resolution}`);
    const { width, height } = dimensions;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // Fill black
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);
    // Draw white rectangle if coordinates provided
    if (coordinates && Array.isArray(coordinates) && coordinates.length === 4) {
        const [x, y, w, h] = coordinates;
        ctx.fillStyle = 'white';
        ctx.fillRect(x, y, w, h);
    }
    return canvas.toBuffer('image/png');
}

async function generateMaskFromBase64(base64Data, resolution) {
    const buffer = Buffer.from(base64Data, 'base64');
    const dimensions = getDimensionsFromResolution(resolution);
    if (!dimensions) throw new Error(`Invalid resolution: ${resolution}`);
    const { width, height } = dimensions;
    const img = await loadImage(buffer);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // Draw the mask image, stretched to fit
    ctx.drawImage(img, 0, 0, width, height);
    // Binarize: set all non-white pixels to black, all white to white, alpha to 255
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const isWhite = data[i] > 127 && data[i+1] > 127 && data[i+2] > 127;
        if (isWhite) {
            data[i] = 255; data[i+1] = 255; data[i+2] = 255; data[i+3] = 255;
        } else {
            data[i] = 0; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toBuffer('image/png');
}

// Utility: Pad mask to match target aspect ratio with bias (0-4)
async function padMaskToAspectRatio(maskBuffer, original, target, bias = 2) {
    // original: {width, height}, target: {width, height}, bias: 0-4 (left/top to right/bottom)
    const origAR = original.width / original.height;
    const targetAR = target.width / target.height;
    let padLeft = 0, padRight = 0, padTop = 0, padBottom = 0;
    if (Math.abs(origAR - targetAR) < 0.01) {
        // Already matches
        return maskBuffer;
    }
    if (origAR > targetAR) {
        // Pad top/bottom
        const newHeight = Math.round(original.width / targetAR);
        const padTotal = newHeight - original.height;
        const biasFrac = [0, 0.25, 0.5, 0.75, 1][bias] || 0.5;
        padTop = Math.floor(padTotal * biasFrac);
        padBottom = padTotal - padTop;
    } else {
        // Pad left/right
        const newWidth = Math.round(original.height * targetAR);
        const padTotal = newWidth - original.width;
        const biasFrac = [0, 0.25, 0.5, 0.75, 1][bias] || 0.5;
        padLeft = Math.floor(padTotal * biasFrac);
        padRight = padTotal - padLeft;
    }
    // Load mask image
    const img = await loadImage(maskBuffer);
    const canvas = createCanvas(target.width, target.height);
    const ctx = canvas.getContext('2d');
    // Fill black
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, target.width, target.height);
    // Draw mask in center (with padding)
    ctx.drawImage(img, padLeft, padTop, original.width, original.height);
    // Binarize to ensure only black/white
    const imageData = ctx.getImageData(0, 0, target.width, target.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const isWhite = data[i] > 127 && data[i+1] > 127 && data[i+2] > 127;
        if (isWhite) {
            data[i] = 255; data[i+1] = 255; data[i+2] = 255; data[i+3] = 255;
        } else {
            data[i] = 0; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toBuffer('image/png');
}

// Utility: Process image to match target resolution (crop center, then scale)
async function processImageToResolution(imageBuffer, targetDims) {
    if (!targetDims || !targetDims.width || !targetDims.height) {
        throw new Error('Target dimensions are required');
    }
    
    // Get original image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const origDims = { width: metadata.width, height: metadata.height };
    
    // Calculate aspect ratios
    const origAR = origDims.width / origDims.height;
    const targetAR = targetDims.width / targetDims.height;
    
    let processedBuffer;
    
    if (Math.abs(origAR - targetAR) < 0.01) {
        // Aspect ratios match, just resize
        processedBuffer = await sharp(imageBuffer)
            .resize(targetDims.width, targetDims.height, { fit: 'fill' })
            .png()
            .toBuffer();
    } else {
        // Aspect ratios don't match, crop center then resize
        if (origAR > targetAR) {
            // Original is wider, crop left/right
            const cropWidth = Math.round(origDims.height * targetAR);
            const cropX = Math.round((origDims.width - cropWidth) / 2);
            processedBuffer = await sharp(imageBuffer)
                .extract({ left: cropX, top: 0, width: cropWidth, height: origDims.height })
                .resize(targetDims.width, targetDims.height, { fit: 'fill' })
                .png()
                .toBuffer();
        } else {
            // Original is taller, crop top/bottom
            const cropHeight = Math.round(origDims.width / targetAR);
            const cropY = Math.round((origDims.height - cropHeight) / 2);
            processedBuffer = await sharp(imageBuffer)
                .extract({ left: 0, top: cropY, width: origDims.width, height: cropHeight })
                .resize(targetDims.width, targetDims.height, { fit: 'fill' })
                .png()
                .toBuffer();
        }
    }
    
    return processedBuffer;
}

async function executePipeline(pipelineName, queryParams = {}, customPipeline = null, providedLayer1Seed = null) {
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
            
            const processedBuffer = await processImageToResolution(imageBuffer, targetDims);
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
            
            const processedBuffer = await processImageToResolution(imageBuffer, targetDims);
            baseImage = processedBuffer.toString('base64');
            console.log(`📸 Processed predefined base64 image to target resolution (${targetDims.width}x${targetDims.height})`);
        } else {
            // Default: Generate base image using layer1 preset (prompt type)
            const preset1 = getPresetData(pipeline.layer1);
            
            // Check if layer1 has variation settings
            const layer1Variation = preset1.variation;
            const isLayer1Variation = layer1Variation && layer1Variation.file;
            
            const layer1Opts = await buildOptions(preset1.model, {}, preset1, isLayer1Variation, queryParams);
            layer1Opts.resPreset = Resolution[resolution.toUpperCase()];
            layer1Opts.upscale = false; 
            layer1Opts.no_save = true; // Don't save the intermediate base image
            
            // Use provided seed if available (for rerolling)
            if (providedLayer1Seed !== null) {
                layer1Opts.seed = providedLayer1Seed;
                console.log(`🔢 Using provided layer1 seed: ${providedLayer1Seed}`);
            }
            
            if (isLayer1Variation) {
                console.log(`📸 Generating layer1 variation with ${typeof pipeline.layer1 === 'string' ? pipeline.layer1 : 'inline preset'} (strength: ${layer1Variation.strength}, noise: ${layer1Variation.noise})...`);
            } else {
                console.log(`📸 Generating base image with ${typeof pipeline.layer1 === 'string' ? pipeline.layer1 : 'inline preset'}...`);
            }
            
            const baseResult = await handleGeneration(layer1Opts, true, typeof pipeline.layer1 === 'string' ? pipeline.layer1 : 'inline');
            baseImage = (baseResult.buffer).toString('base64');
            layer1Seed = baseResult.seed;
        }
        
        // Step 2: Generate mask
        let mask;
        let maskBias = (queryParams.mask_bias !== undefined) ? parseInt(queryParams.mask_bias) : 2; // default center
        let presetResolution = pipeline.resolution;
        let presetDims = getDimensionsFromResolution(presetResolution);
        let targetDims = getDimensionsFromResolution(resolution);
        if (Array.isArray(pipeline.mask)) {
            // Coordinates array [x, y, width, height]
            mask = await generateMaskFromCoordinates(pipeline.mask, presetResolution); // generate at preset res
            // Pad if needed
            if (presetDims && targetDims && (presetDims.width !== targetDims.width || presetDims.height !== targetDims.height)) {
                mask = await padMaskToAspectRatio(mask, presetDims, targetDims, maskBias);
            }
            // Resize to target
            mask = await sharp(mask).resize(targetDims.width, targetDims.height, { fit: 'fill' }).png().toBuffer();
            mask = mask.toString('base64');
        } else if (typeof pipeline.mask === 'string') {
            // Base64 encoded image
            let maskBuffer = Buffer.from(pipeline.mask, 'base64');
            // Try to get original mask size
            let meta = await sharp(maskBuffer).metadata();
            let origDims = { width: meta.width, height: meta.height };
            // Pad if needed
            if (origDims && targetDims && (origDims.width !== targetDims.width || origDims.height !== targetDims.height)) {
                maskBuffer = await padMaskToAspectRatio(maskBuffer, origDims, targetDims, maskBias);
            }
            // Resize to target
            maskBuffer = await sharp(maskBuffer).resize(targetDims.width, targetDims.height, { fit: 'fill' }).png().toBuffer();
            mask = maskBuffer.toString('base64');
        } else {
            throw new Error('Mask must be either an array of coordinates or base64 encoded image');
        }
        
        // Step 3: Generate inpainting image using layer2 preset
        const layer2Opts = await buildOptions(preset2.model, {}, preset2, true, queryParams);
        layer2Opts.n_samples = 1;
        layer2Opts.inpaintImg2ImgStrength = pipeline.inpainting_strength || 0.7;
        layer2Opts.action = Action.INPAINT;
        layer2Opts.model = Model[inpaintingModelName];
        layer2Opts.image = baseImage;
        layer2Opts.mask = mask;
        layer2Opts.resPreset = Resolution[resolution.toUpperCase()];
        layer2Opts.strength = 1; // Default inpainting strength
        layer2Opts.noise = 0.1;
        
        // Pass layer1Seed and pipelineName as parameters
        layer2Opts.layer1Seed = layer1Seed;
        layer2Opts.pipelineName = pipelineName;
        layer2Opts.isPipeline = true;
        
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log(`🎨 Generating inpainting with ${typeof pipeline.layer2 === 'string' ? pipeline.layer2 : 'inline preset'}...`);
        const finalResult = await handleGeneration(layer2Opts, true, pipelineName);
        
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
        
        const { layer1: layer1Input, layer1_type: layer1TypeInput, layer2: layer2Input, mask: maskInput, resolution: resolutionInput, preset, layer1_seed, layer2_seed, inpainting_strength, mask_bias, layer1_variation } = req.body;
        
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
            
            // Add variation settings if provided
            if (layer1_variation !== undefined && typeof customPipeline.layer1 === 'object' && (!customPipeline.layer1_type || customPipeline.layer1_type === 'prompt')) {
                customPipeline.layer1.variation = layer1_variation;
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
                mask: maskInput || [100, 100, 300, 300], // Default mask coordinates
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
        const result = await executePipeline(pipelineName, queryParams, customPipeline, layer1SeedInt);
        
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
        const result = await executePipeline(pipelineName, req.query, null, layer1SeedInt);
        
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
        console.log('❌ Error occurred:', error.message);
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
        console.log('❌ Error occurred:', e.message);
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
        
        // Generate the mask
        let maskBuffer;
        if (Array.isArray(pipeline.mask)) {
            // Coordinates array [x, y, width, height]
            maskBuffer = await generateMaskFromCoordinates(pipeline.mask, pipeline.resolution);
        } else if (typeof pipeline.mask === 'string') {
            // Base64 encoded image
            maskBuffer = await generateMaskFromBase64(pipeline.mask, pipeline.resolution);
        } else {
            return res.status(400).json({ error: 'Invalid mask format' });
        }
        
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
    const opts = await buildOptions(key, req.body, null, false, req.query);
    res.json({ prompt: opts.prompt, uc: opts.negative_prompt });
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /:model/generate (direct model generation)
app.post('/:model/generate', authMiddleware, async (req, res) => {
    try {
        const key = req.params.model.toLowerCase();
        const model = Model[key.toUpperCase()];
        if (!model) {
            return res.status(400).json({ error: 'Invalid model' });
        }

        let body = req.body;
        let baseFilename = null;

        if (body?.image) {
            // Check if this is a frontend upload (base64) or existing image (filename)
            if (body.is_frontend_upload) {
                // This is a frontend upload with base64 data - use it directly
                // No need to set baseFilename since this is a new upload
            } else {
                // This is a filename - load the image from disk
                baseFilename = body.image;
                if (body.image.includes('_upscaled')) {
                    baseFilename = body.image.replace('_upscaled.png', '.png');
                }
                const filePath = path.join(imagesDir, baseFilename);
                
                if (!fs.existsSync(filePath)) {
                    return res.status(404).json({ error: 'Image not found' });
                }
            }
            
            if (!body.mask) {
                if (!body.strength) body.strength = 0.8;
                if (!body.noise) body.noise = 0.1;
            }
        }
        
        const opts = await buildOptions(key, body, null, (!!body?.image), req.query);
        // Add original filename for metadata tracking if this is img2img and not a frontend upload
        if (body.image && !body.is_frontend_upload) {
            opts.original_filename = baseFilename;
        }
        const presetName = req.body.preset || null;
        await handleImageRequest(req, res, opts, presetName);
    } catch(e) {
        console.log('❌ Error occurred:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Load character data for auto-complete
let characterIndex = [];
let characterDataArray = [];

// Load character data on startup
function loadCharacterData() {
    try {
        const characterDataPath = path.join(__dirname, 'characters.json');
        if (fs.existsSync(characterDataPath)) {
            const data = JSON.parse(fs.readFileSync(characterDataPath, 'utf8'));
            characterIndex = data.index || [];
            characterDataArray = data.data || [];
            console.log(`✅ Loaded ${characterIndex.length} characters for auto-complete`);
        } else {
            console.log('⚠️  Character data file not found, auto-complete disabled');
        }
    } catch (error) {
        console.error('❌ Error loading character data:', error.message);
    }
}

// Auto-complete endpoint - search characters
app.get('/auto-complete', authMiddleware, async (req, res) => {
    try {
        const query = req.query.q;
        if (!query || query.trim().length < 2) {
            return res.json([]);
        }
        
        const searchTerm = query.trim().toLowerCase();
        const results = [];
        
        // Search through the index array
        characterIndex.forEach((item, index) => {
            if (item.toLowerCase().includes(searchTerm)) {
                results.push({
                    index: index,
                    name: item
                });
            }
        });
        
        // Limit results to 10 items
        const limitedResults = results.slice(0, 30);
        
        res.json(limitedResults);
        
    } catch (error) {
        console.log('❌ Auto-complete search error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Auto-complete endpoint - get character data by index
app.get('/auto-complete/:index', authMiddleware, async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        
        if (isNaN(index) || index < 0 || index >= characterDataArray.length) {
            return res.status(404).json({ error: 'Character not found' });
        }
        
        const character = characterDataArray[index];
        res.json(character);
        
    } catch (error) {
        console.log('❌ Auto-complete character data error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Load character data on startup
loadCharacterData();

app.listen(config.port, () => console.log(`Server running on port ${config.port}`));

// GET variation endpoint - same as POST but with query parameters
app.get('/variation/:filename', authMiddleware, async (req, res) => {
    try {
        const filename = req.params.filename;
        const strength = req.query.strength || 0.8;
        const noise = req.query.noise || 0.1;
        const prompt = req.query.prompt;
        const uc = req.query.uc;
        
        // Find the non-upscaled version of the image
        let baseFilename = filename;
        if (filename.includes('_upscaled')) {
            baseFilename = filename.replace('_upscaled.png', '.png');
        }
        
        const filePath = path.join(imagesDir, baseFilename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Read the image and convert to base64
        const imageBuffer = fs.readFileSync(filePath);
        const base64Image = imageBuffer.toString('base64');
        
        // Get metadata from the original image
        const meta = extractNovelAIMetadata(filePath);
        if (!meta) {
            return res.status(404).json({ error: 'No NovelAI metadata found' });
        }
        // Extract relevant fields including proper resolution
        const relevantMeta = extractRelevantFields(meta, baseFilename);
        if (!relevantMeta) {
            return res.status(404).json({ error: 'Failed to extract metadata fields' });
        }
        
        // Build options for img2img
        const model = determineModelFromMetadata(meta);
        const modelName = model.toLowerCase();
        
        // Create request body with original settings
        const requestBody = {
            image: base64Image,
            strength: parseFloat(strength),
            noise: parseFloat(noise),
            prompt: prompt || relevantMeta.prompt || '',
            uc: uc || relevantMeta.uc || '',
            resolution: relevantMeta.resolution || '',
            steps: relevantMeta.steps || 25,
            guidance: relevantMeta.scale || 5.0,
            rescale: relevantMeta.cfg_rescale || 0.0,
            allow_paid: true
        };
        
        // Add optional fields if they have values
        if (relevantMeta.sampler) {
            const samplerObj = getSamplerByMeta(relevantMeta.sampler);
            requestBody.sampler = samplerObj ? samplerObj.request : relevantMeta.sampler;
        }
        
        if (relevantMeta.noise_schedule) {
            const noiseObj = getNoiseByMeta(relevantMeta.noise_schedule);
            requestBody.noiseScheduler = noiseObj ? noiseObj.request : relevantMeta.noise_schedule;
        }
        
        if (relevantMeta.skip_cfg_above_sigma) {
            requestBody.variety = true;
        }
        
        // Add character prompts if available
        if (relevantMeta.characterPrompts && Array.isArray(relevantMeta.characterPrompts) && relevantMeta.characterPrompts.length > 0) {
            requestBody.allCharacterPrompts = relevantMeta.characterPrompts;
            requestBody.use_coords = false;
            
            // Check for manual positions
            if (relevantMeta.characterPrompts.some(char => char.center && char.use_coords)) {
                requestBody.use_coords = true;
            }
        }
        
        // Build options and generate
        const opts = await buildOptions(modelName, requestBody, null, true, req.query);
        // Add original filename for metadata tracking
        opts.original_filename = baseFilename;
        await handleImageRequest(req, res, opts);
    } catch (error) {
        console.error('Variation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Utility: Strip all tEXt chunks from a PNG buffer
function stripPngTextChunks(buffer) {
    // PNG header is 8 bytes
    if (!buffer || buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) return buffer;
    const PNG_HEADER = buffer.slice(0, 8);
    let offset = 8;
    const outChunks = [PNG_HEADER];
    while (offset < buffer.length) {
        if (offset + 8 > buffer.length) break;
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const chunkStart = offset;
        const chunkEnd = offset + 12 + length;
        if (type !== 'tEXt') {
            outChunks.push(buffer.slice(chunkStart, chunkEnd));
        }
        offset = chunkEnd;
    }
    return Buffer.concat(outChunks);
}