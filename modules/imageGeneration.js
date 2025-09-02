const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NovelAI, Model, Action, Sampler, Noise, Resolution, calculateCost } = require('nekoai-js');
const sharp = require('sharp');

// Import modules
const { loadPromptConfig, applyTextReplacements, getUsedReplacements } = require('./textReplacements');
const { 
    updateMetadata, 
    stripPngTextChunks, 
    getBaseName,
    getModelDisplayName
} = require('./pngMetadata');
const { 
    getImageDimensions, 
    getDimensionsFromResolution, 
    processDynamicImage, 
    resizeMaskWithCanvas
} = require('./imageTools');
const { generatePreview, generateBlurredPreview, generateMobilePreviews } = require('./previewUtils');
const imageCounter = require('./imageCounter');
const { upscaleImageCore } = require('./imageUpscaling');

let context = {};
function setContext(newContext) { context = { ...newContext }; }

const cacheDir = path.resolve(__dirname, '../.cache');
const uploadCacheDir = path.join(cacheDir, 'upload');
const presetSourceCacheDir = path.join(cacheDir, 'preset_source');
const imagesDir = path.resolve(__dirname, '../images');
const previewsDir = path.resolve(__dirname, '../.previews');

// Ensure preset source cache directory exists
try {
    if (!fs.existsSync(presetSourceCacheDir)) {
        fs.mkdirSync(presetSourceCacheDir, { recursive: true });
    }
} catch (error) {
    console.warn(`⚠️ Failed to create preset source cache directory: ${error.message}`);
}

// Function to generate preset source image
async function generatePresetSourceImage(presetName, seed, resolution, model) {
    // Validate input parameters
    if (!presetName || typeof presetName !== 'string') {
        throw new Error('Preset name must be a non-empty string');
    }
    
    if (typeof seed !== 'number' || seed < 0 || seed > 0xFFFFFFFF) {
        throw new Error(`Invalid seed: ${seed}. Must be a number between 0 and 4294967295`);
    }
    
    if (model && typeof model !== 'string') {
        throw new Error('Model must be a string');
    }
    let currentPromptConfig;
    try {
        currentPromptConfig = loadPromptConfig();
    } catch (error) {
        throw new Error(`Failed to load prompt configuration: ${error.message}`);
    }
    
    // Check if preset exists
    if (!currentPromptConfig.presets || !currentPromptConfig.presets[presetName]) {
        throw new Error(`Preset "${presetName}" not found`);
    }
    
    // Get preset configuration
    const preset = currentPromptConfig.presets[presetName];
    
    // Check for recursion - if preset has image source, throw error
    if (preset.image && preset.image.startsWith('preset:')) {
        throw new Error(`Recursive presets are not allowed. Preset "${presetName}" references "${preset.image}" as image source.`);
    }
    
    // Create cache filename
    const presetHash = crypto.createHash('md5').update(presetName).digest('hex');
    const cacheFilename = `${presetHash}_${seed}.png`;
    const cachePath = path.join(presetSourceCacheDir, cacheFilename);
    
    // Ensure cache directory exists
    try {
        if (!fs.existsSync(presetSourceCacheDir)) {
            fs.mkdirSync(presetSourceCacheDir, { recursive: true });
        }
    } catch (error) {
        console.warn(`⚠️ Failed to create cache directory: ${error.message}`);
        // Continue without caching if directory creation fails
    }
    
    // Check if cached image exists
    if (fs.existsSync(cachePath)) {
        try {
            console.log(`📋 Using cached preset source image: ${cacheFilename}`);
            const cachedBuffer = fs.readFileSync(cachePath);
            return {
                buffer: cachedBuffer,
                seed: seed,
                cached: true
            };
        } catch (error) {
            console.warn(`⚠️ Failed to read cached image ${cacheFilename}, will regenerate: ${error.message}`);
            // Continue to regenerate if cache read fails
        }
    }
    
    console.log(`🎨 Generating preset source image for "${presetName}" with seed ${seed}...`);
    
    // Build options for preset generation
    const presetOptions = {
        ...preset,
        seed: seed,
        no_save: true
    };
    
    // Override resolution if provided
    if (resolution) {
        if (Resolution[resolution.toUpperCase()]) {
            presetOptions.resPreset = Resolution[resolution.toUpperCase()];
        } else {
            // Parse custom dimensions
            try {
                const dims = resolution.split('x');
                if (dims.length === 2) {
                    const width = parseInt(dims[0]);
                    const height = parseInt(dims[1]);
                    
                    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
                        throw new Error(`Invalid resolution format: ${resolution}. Expected format: "widthxheight" (e.g., "1024x1024")`);
                    }
                    
                    presetOptions.width = width;
                    presetOptions.height = height;
                } else {
                    throw new Error(`Invalid resolution format: ${resolution}. Expected format: "widthxheight" (e.g., "1024x1024")`);
                }
            } catch (error) {
                throw new Error(`Failed to parse resolution "${resolution}": ${error.message}`);
            }
        }
    }
    
    // Generate Request Options
    let opts;
    try {
        opts = await buildOptions(presetOptions, null, {});
    } catch (error) {
        throw new Error(`Failed to build options for preset "${presetName}": ${error.message}`);
    }

    // Generate the preset image
    let result;
    try {
        result = await handleGeneration(opts, true, presetName);
    } catch (error) {
        throw new Error(`Failed to generate preset image for "${presetName}": ${error.message}`);
    }
    
    // Save to cache without metadata
    try {
        fs.writeFileSync(cachePath, result.buffer);
        console.log(`💾 Cached preset source image: ${cacheFilename}`);
    } catch (error) {
        console.warn(`⚠️ Failed to cache preset source image ${cacheFilename}: ${error.message}`);
        // Continue without caching - this is not critical
    }
    
    // Add random delay between 5 and 15 seconds
    const delaySeconds = Math.floor(Math.random() * 11) + 5; // Random between 5-15 seconds
    console.log(`⏳ Waiting ${delaySeconds} seconds before continuing...`);
    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
    
    return {
        buffer: result.buffer,
        seed: result.seed,
        cached: false
    };
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

// Build options for image generation
const buildOptions = async (body, preset = null, queryParams = {}) => {
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
        let processedPrompt = applyTextReplacements(rawPrompt, presetName, body.model);
        let processedNegativePrompt = applyTextReplacements(rawNegativePrompt, presetName, body.model);
        
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
        
        const usedPromptReplacements = getUsedReplacements(rawPrompt, body.model);
        const usedNegativeReplacements = getUsedReplacements(rawNegativePrompt, body.model);
        
        if (usedPromptReplacements.length > 0 || usedNegativeReplacements.length > 0) {
            console.log(`🔄 Text replacements: ${[...usedPromptReplacements, ...usedNegativeReplacements].join(', ')}`);
        }

        // Process character prompts with text replacements
        let processedCharacterPrompts = body.allCharacterPrompts || preset?.allCharacterPrompts || undefined;
        if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
            processedCharacterPrompts = processedCharacterPrompts.map(char => {
                // Apply text replacements to character prompt and UC
                const processedPrompt = applyTextReplacements(char.prompt, presetName, body.model);
                const processedUC = applyTextReplacements(char.uc, presetName, body.model);
                
                return {
                    ...char,
                    prompt: processedPrompt,
                    uc: processedUC
                };
            });
            
            // Log text replacements used in character prompts
            const usedCharacterReplacements = [];
            (body.allCharacterPrompts || preset?.allCharacterPrompts).forEach(char => {
                const promptReplacements = getUsedReplacements(char.prompt, body.model);
                const ucReplacements = getUsedReplacements(char.uc, body.model);
                if (promptReplacements.length > 0 || ucReplacements.length > 0) {
                    usedCharacterReplacements.push(...promptReplacements, ...ucReplacements);
                }
            });
            
            if (usedCharacterReplacements.length > 0) {
                console.log(`🔄 Character prompt text replacements: ${usedCharacterReplacements.join(', ')}`);
            }
        }

        // Handle dataset prepending (exclude for V3 models)
        const isV3Model = body.model === 'v3' || body.model === 'v3_furry';
        if (!isV3Model && body.dataset_config && body.dataset_config.include && Array.isArray(body.dataset_config.include) && body.dataset_config.include.length > 0) {
            // Build dataset mappings dynamically from config
            const datasetMappings = {};
            if (currentPromptConfig.datasets) {
                currentPromptConfig.datasets.forEach(dataset => {
                    datasetMappings[dataset.value] = `${dataset.value} dataset`;
                });
            }
            
            const datasetPrepends = [];
            
            body.dataset_config.include.forEach(dataset => {
                if (datasetMappings[dataset]) {
                    let datasetText = datasetMappings[dataset];
                    
                    // Add bias if > 1.0
                    if (body.dataset_config.bias && body.dataset_config.bias[dataset] !== undefined) {
                        datasetText = `${parseFloat(parseFloat(body.dataset_config.bias[dataset].toString()).toFixed(2)).toString()}::${dataset} dataset::`;
                    }
                    
                    datasetPrepends.push(datasetText);
                    
                    // Add sub-toggle values for the dataset if enabled
                    if (body.dataset_config.settings && body.dataset_config.settings[dataset]) {
                        const datasetSettings = body.dataset_config.settings[dataset];
                        Object.keys(datasetSettings).forEach(settingId => {
                            const setting = datasetSettings[settingId];
                            if (setting.enabled && setting.value) {
                                const settingText = (setting.bias && setting.bias !== undefined) ? 
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
            const modelKey = body.model.toLowerCase();
            const combinedPrompt = processedPrompt + (processedCharacterPrompts ? processedCharacterPrompts.map(c => c.prompt).join(', ') : '');
            const selectedQuality = selectPresetItem(currentPromptConfig.quality_presets, modelKey, combinedPrompt, body.append_quality_id);
            
            if (selectedQuality) {
                // Check if prompt contains "Text:" and handle accordingly
                if (processedPrompt.includes('Text:')) {
                    // Find the first instance of "Text:" and insert quality before it
                    const textIndex = processedPrompt.indexOf('Text:');
                    const beforeText = processedPrompt.substring(0, textIndex).trim();
                    const afterText = processedPrompt.substring(textIndex);
                    
                    if (beforeText) {
                        // If there's content before "Text:", add quality with ", " separator
                        processedPrompt = beforeText + ', ' + selectedQuality.value + ' ' + afterText;
                    } else {
                        // If "Text:" is at the beginning, just add quality before it
                        processedPrompt = selectedQuality.value + ' ' + afterText;
                    }
                } else {
                    // Original logic for prompts without "Text:"
                    // Split prompt by "|", add quality to end of first group, then rejoin with " | "
                    const groups = processedPrompt.split('|').map(group => group.trim());
                    if (groups.length > 0) {
                        groups[0] = groups[0] + ', ' + selectedQuality.value;
                        processedPrompt = groups.join(' | ');
                    } else {
                        processedPrompt = processedPrompt + ', ' + selectedQuality.value;
                    }
                }
                selectedQualityId = selectedQuality.id;
                console.log(`🎨 Applied quality preset for ${modelKey}: ${selectedQuality.value} (ID: ${selectedQuality.id})`);
            }
        }

        // Handle append_uc with enhanced preset selection
        if (body.append_uc !== undefined && body.append_uc > 0 && currentPromptConfig.uc_presets) {
            const modelKey = body.model.toLowerCase();
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
        model: Model[body.model.toUpperCase() + ((body.mask || body.mask_compressed) && body.image && !body.model.toUpperCase().includes('_INP') ? '_INP' : '')],
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
        let imageSourceSeed = null;
        const [imageType, imageIdentifier] = body.image.split(':', 2);

        switch (imageType) {
            case 'preset':
                // Handle preset as image source
                const presetName = imageIdentifier;
                if (!presetName || presetName.trim() === '') {
                    throw new Error('Preset name cannot be empty');
                }
                let seed = body.image_source_seed;
                if (seed !== undefined) {
                    // Validate provided seed
                    const parsedSeed = parseInt(seed);
                    if (isNaN(parsedSeed) || parsedSeed < 0 || parsedSeed > 0xFFFFFFFF) {
                        throw new Error(`Invalid image_source_seed: ${seed}. Must be a number between 0 and 4294967295`);
                    }
                    seed = parsedSeed;
                } else {
                    // Generate random seed
                    seed = Math.floor(0x100000000 * Math.random() - 1);
                }
                let resolution = body.resolution;
                if (!resolution && body.width && body.height) {
                    resolution = `${body.width}x${body.height}`;
                }
                
                try {
                    const presetResult = await generatePresetSourceImage(presetName, seed, resolution, body.model);
                    
                    // Validate the generated image buffer
                    if (!presetResult.buffer || !Buffer.isBuffer(presetResult.buffer)) {
                        throw new Error('Generated preset image is invalid or empty');
                    }
                    
                    if (presetResult.buffer.length === 0) {
                        throw new Error('Generated preset image buffer is empty');
                    }
                    
                    imageBuffer = presetResult.buffer;
                    imageSourceSeed = presetResult.seed;
                    originalSource = `preset:${presetName}`;
                    console.log(`🎨 Generated preset source image with seed: ${imageSourceSeed}`);
                } catch (error) {
                    console.error(`❌ Preset source generation failed:`, error);
                    throw new Error(`Failed to generate preset source image: ${error.message}`);
                }
                break;
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
        baseOptions.image_source_seed = imageSourceSeed;
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
                                
                                // Get the encoding for the specific model and IE (case-insensitive lookup)
                                const modelKey = Object.keys(vibeData.encodings || {}).find(key => key.toUpperCase() === body.model.toUpperCase());
                                if (vibeData.encodings && 
                                    modelKey && 
                                    vibeData.encodings[modelKey] && 
                                    vibeData.encodings[modelKey][vibeTransfer.ie.toString()]) {
                                    
                                    const encoding = vibeData.encodings[modelKey][vibeTransfer.ie.toString()];
                                    referenceImageMultiple.push(encoding);
                                    referenceStrengthMultiple.push(vibeTransfer.strength);
                                    console.log(`🎨 Found encoding for vibe ${vibeTransfer.id} with IE ${vibeTransfer.ie} and strength ${vibeTransfer.strength} (model: ${body.model})`);
                                } else {
                                    console.warn(`⚠️ No encoding found for vibe ${vibeTransfer.id} with IE ${vibeTransfer.ie} for model ${body.model}`);
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

async function handleGeneration(opts, returnImage = false, presetName = null, workspaceId = null, req = null) {
    const seed = opts.seed || Math.floor(0x100000000 * Math.random() - 1);
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
    delete apiOpts.layer1Seed;
    delete apiOpts.allCharacterPrompts;
    delete apiOpts.original_filename;
    delete apiOpts.image_bias;
    delete apiOpts.mask_bias;
    delete apiOpts.image_source;
    delete apiOpts.image_source_seed;
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
    
    // Get balance before generation
    let creditUsage;
    
    try {
        imageCounter.logGeneration();
        [img] = await context.client.generateImage(apiOpts, false, true, true);
        console.log('✅ Image generation completed');
        
        // Get new balance and calculate credit usage
        creditUsage = await context.calculateCreditUsage();
        
        if (creditUsage.totalUsage > 0) {
            console.log(`💰 Image Generation Cost: ${creditUsage.totalUsage} ${creditUsage.usageType === 'paid' ? 'paid' : 'fixed'}`);
        }
        
    } catch (error) {
        throw new Error(`❌ Image generation failed: ${error.message}`);
    }
    
    const timestamp = Date.now().toString();
    let namePrefix = presetName || 'generated';
    
    // Generate filename based on standard generation
    let name;
    name = `${timestamp}_${namePrefix}_${seed}.png`;
    
    const shouldSave = opts.no_save !== true;
    
    if (returnImage) {
        let buffer = Buffer.from(img.data);
        
        // Prepare forge metadata
        const forgeData = {
            date_generated: Date.now(),
            request_type: 'preset',
            generation_type: 'regular',
            upscale_ratio: null,
            upscaled_at: null
        };
        
        // Add disabled characters and character names to forge metadata if present

        if (opts.input_character_prompts) {
            forgeData.allCharacters = opts.input_character_prompts;
            forgeData.use_coords = opts.use_coords;
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
            
            forgeData.use_coords = opts.use_coords;
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
            if (opts.image_source_seed !== undefined) {
                forgeData.image_source_seed = opts.image_source_seed;
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
        const targetWorkspaceId = workspaceId || context.getActiveWorkspace(req?.session?.id);
        
        if (shouldSave) {
            fs.writeFileSync(path.join(imagesDir, name), buffer);
            console.log(`💾 Saved: ${name}`);
            
            // Add file to workspace
            context.addToWorkspaceArray('files', name, targetWorkspaceId);
            
            // Update metadata cache
            const receiptData = {
                type: 'generation',
                cost: creditUsage.totalUsage,
                creditType: creditUsage.usageType,
                date: Date.now().valueOf()
            };
            await context.addReceiptMetadata(name, imagesDir, receiptData, forgeData);
            
            // Broadcast receipt notification
            context.broadcastReceiptNotification(receiptData);
            
            // Generate preview
            const baseName = getBaseName(name);
            const previewFile = `${baseName}.jpg`;
            const blurPreviewFile = `${baseName}_blur.jpg`;
            const previewPath = path.join(previewsDir, previewFile);
            const blurPreviewPath = path.join(previewsDir, blurPreviewFile);
            
            // Generate both main and @2x previews for mobile devices
            await generateMobilePreviews(path.join(imagesDir, name), baseName);
            console.log(`📸 Generated mobile previews: ${previewFile} and ${baseName}@2x.jpg`);
            
            // Generate blurred background preview
            await generateBlurredPreview(path.join(imagesDir, name), blurPreviewPath);
            console.log(`📸 Generated blurred preview: ${blurPreviewFile}`);
        }
        
        if (opts.upscale !== undefined && opts.upscale === true) {
            const scale = opts.upscale === true ? 4 : opts.upscale;
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const { width: upscaleWidth, height: upscaleHeight } = await getImageDimensions(buffer);
            const scaledBuffer = await upscaleImageCore(buffer, scale, upscaleWidth, upscaleHeight);
            
            // Get new balance and calculate credit usage for upscaling
            const upscaleCreditUsage = await context.calculateCreditUsage();
            
            if (upscaleCreditUsage.totalUsage > 0) {
                console.log(`💰 Upscaling Cost: ${upscaleCreditUsage.totalUsage} ${upscaleCreditUsage.usageType === 'paid' ? 'paid' : 'fixed'}`);
            }
            
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
                context.addToWorkspaceArray('files', upscaledName, targetWorkspaceId);
                
                // Update metadata cache for upscaled image
                const upscaledReceiptData = {
                    type: 'upscaling',
                    cost: upscaleCreditUsage.totalUsage,
                    creditType: upscaleCreditUsage.usageType,
                    date: Date.now().valueOf()
                };
                // Attach receipt to parent image instead of upscaled image
                await context.addReceiptMetadata(name, imagesDir, upscaledReceiptData, upscaledForgeData);
                
                // Broadcast receipt notification
                context.broadcastReceiptNotification(upscaledReceiptData);
            }
            
            // Return result with appropriate seed information
            const result = { buffer: updatedScaledBuffer, filename: name, saved: shouldSave, seed: seed };
            return result;
        }
        
        // Return result with appropriate seed information
        const finalResult = { buffer, filename: name, saved: shouldSave, seed: seed };
        return finalResult;
    } else {
        // Save image and return filename only (legacy behavior)
        if (shouldSave) {
            const filePath = path.join(imagesDir, name);
            await img.save(filePath);
            console.log(`💾 Saved: ${name}`);
            
            // Generate preview
            const baseName = getBaseName(name);
            const previewFile = `${baseName}.jpg`;
            const previewPath = path.join(previewsDir, previewFile);
            
            // Generate both main and @2x previews for mobile devices
            await generateMobilePreviews(path.join(imagesDir, name), baseName);
            console.log(`📸 Generated mobile previews: ${previewFile} and ${baseName}@2x.jpg`);
        }
        
        // Return result with appropriate seed information
        const result = { filename: name, saved: shouldSave, seed: seed };
        return result;
    }
}

// Helper function for common endpoint logic
const handleImageRequest = async (req, res, opts, presetName = null) => {
    const workspaceId = req.body.workspace || req.query.workspace || null;
    const result = await handleGeneration(opts, true, presetName, workspaceId, req);
    
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
            console.error('❌ Image optimization failed:', error.message);
        }
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Expose-Headers', 'X-Generated-Filename, X-Seed');
    
    if (result && result.filename) {
        res.setHeader('X-Generated-Filename', result.filename);
    } else {
        console.error('❌ No filename available in result:', result);
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

// WebSocket-native image generation function
async function generateImageWebSocket(body, userType, sessionId) {
    // Check if user is read-only
    if (userType === 'readonly') {
        throw new Error('Non-Administrator Login: This operation is not allowed for read-only users');
    }
    
    // Validate body parameter
    if (!body || typeof body !== 'object') {
        throw new Error('Invalid request body: body parameter is missing or not an object');
    }
    
    if (!body.model) {
        throw new Error('Invalid request body: model parameter is missing');
    }
    
    try {
        const model = Model[body.model.toUpperCase()];
        if (!model) {
            throw new Error('Invalid model');
        }

        let bodyData = body;
        let baseFilename = null;

        const opts = await buildOptions(bodyData, null, {});
        // Add original filename for metadata tracking if this is img2img and not a frontend upload
        if (bodyData.image && !bodyData.is_frontend_upload) {
            opts.original_filename = baseFilename;
        }
        
        // Create a mock req object for context functions that need it
        const mockReq = { session: { id: sessionId } };
        
        // Call handleGeneration directly and return the result
        const result = await handleGeneration(opts, true, body?.presetName, body?.workspace, mockReq);
        
        return result;
    } catch(e) {
        console.error('❌ WebSocket image generation error:', e);
        throw e;
    }
}

// Function to convert image metadata to request format for rerolling
async function convertMetadataToRequestFormat(metadata) {
    if (!metadata) {
        throw new Error('No metadata provided for conversion');
    }

    console.log('🔄 Converting metadata to request format:', metadata);

    // Import the extractRelevantFields function to properly extract metadata
    const { extractRelevantFields } = require('./pngMetadata');
    
    // Extract the actual metadata from the nested structure
    const actualMetadata = metadata.metadata || metadata;
    
    // Use the existing extractRelevantFields function to get properly formatted metadata
    const extractedMetadata = await extractRelevantFields(actualMetadata, metadata.filename);
    
    if (!extractedMetadata) {
        throw new Error('Failed to extract relevant metadata fields');
    }

    console.log('🔄 Extracted metadata:', extractedMetadata);

    const requestBody = {
        model: extractedMetadata.model || 'v4_5',
        prompt: extractedMetadata.prompt || '',
        uc: extractedMetadata.uc || '',
        resolution: extractedMetadata.resolution || (extractedMetadata.width && extractedMetadata.height ? `${extractedMetadata.width}x${extractedMetadata.height}` : ''),
        steps: extractedMetadata.steps || 25,
        guidance: extractedMetadata.scale || 5.0,
        rescale: extractedMetadata.cfg_rescale || 0.0,
        allow_paid: false, // Default to false for safety
        workspace: metadata.workspace || 'default'
    };

    // Add optional fields if they have values
    if (extractedMetadata.sampler) {
        requestBody.sampler = extractedMetadata.sampler;
    }

    if (extractedMetadata.noise_schedule) {
        requestBody.noiseScheduler = extractedMetadata.noise_schedule;
    }

    if (extractedMetadata.skip_cfg_above_sigma) {
        requestBody.variety = true;
    }

    // Add upscale if it was used in original generation
    if (extractedMetadata.upscaled) {
        requestBody.upscale = true;
    }

    // Add preset if available
    if (extractedMetadata.preset_name) {
        requestBody.preset = extractedMetadata.preset_name;
    }

    // Add character prompts if available
    if (extractedMetadata.characterPrompts && Array.isArray(extractedMetadata.characterPrompts) && extractedMetadata.characterPrompts.length > 0) {
        requestBody.allCharacterPrompts = extractedMetadata.characterPrompts;
        requestBody.use_coords = !!extractedMetadata.use_coords;
    }

    // Add dataset config if available (from forge_data)
    const forgeData = actualMetadata.forge_data || {};
    if (forgeData.dataset_config) {
        requestBody.dataset_config = forgeData.dataset_config;
    }

    // Add quality and UC presets if available (from forge_data)
    if (forgeData.append_quality !== undefined) {
        requestBody.append_quality = forgeData.append_quality;
    }
    if (forgeData.append_uc !== undefined) {
        requestBody.append_uc = forgeData.append_uc;
    }

    // Add vibe transfer data if available (from forge_data)
    if (forgeData.vibe_transfer && Array.isArray(forgeData.vibe_transfer) && forgeData.vibe_transfer.length > 0) {
        requestBody.vibe_transfer = forgeData.vibe_transfer;
        requestBody.normalize_vibes = forgeData.normalize_vibes !== undefined ? forgeData.normalize_vibes : true;
    }

    // Handle img2img specific fields
    if (extractedMetadata.base_image && extractedMetadata.image_source) {
        // Convert image source back to proper format
        if (extractedMetadata.image_source.startsWith('preset:')) {
            requestBody.image = extractedMetadata.image_source;
            // Note: image_source_seed would need to be extracted from forge_data if available
        } else if (extractedMetadata.image_source.startsWith('file:')) {
            requestBody.image = extractedMetadata.image_source;
        } else if (extractedMetadata.image_source.startsWith('cache:')) {
            requestBody.image = extractedMetadata.image_source;
        } else if (extractedMetadata.image_source === 'data:base64') {
            // For base64 data, we can't reroll directly - throw error
            throw new Error('Cannot reroll images with base64 data source. Please use the original file or preset source.');
        }

        // Add img2img specific parameters
        if (extractedMetadata.strength !== undefined) {
            requestBody.strength = extractedMetadata.strength;
        }
        if (extractedMetadata.noise !== undefined) {
            requestBody.noise = extractedMetadata.noise;
        }
        if (extractedMetadata.image_bias !== undefined) {
            requestBody.image_bias = extractedMetadata.image_bias;
        }

        // Add mask data if it exists
        if (extractedMetadata.mask_compressed) {
            requestBody.mask_compressed = extractedMetadata.mask_compressed;
        } else if (extractedMetadata.mask) {
            requestBody.mask = extractedMetadata.mask;
        }
    }

    // Remove seed to ensure new random seed is generated
    delete requestBody.seed;

    console.log('🔄 Converted request body:', requestBody);
    return requestBody;
}

// Function to handle reroll generation from metadata
async function handleRerollGeneration(metadata, userType, sessionId, workspaceId = null) {
    // Check if user is read-only
    if (userType === 'readonly') {
        throw new Error('Non-Administrator Login: This operation is not allowed for read-only users');
    }

    try {
        console.log('🎲 Starting reroll generation for metadata:', metadata);
        
        // Convert metadata to request format (now async)
        const requestBody = await convertMetadataToRequestFormat(metadata);
        console.log('🎲 Request body created:', requestBody);
        
        // Build options for generation
        console.log('🎲 Calling buildOptions with:', requestBody);
        const opts = await buildOptions(requestBody, null, {});
        console.log('🎲 BuildOptions result:', opts);
        
        // Create a mock req object for context functions that need it
        const mockReq = { session: { id: sessionId } };
        
        // Call handleGeneration and return the result
        console.log('🎲 Calling handleGeneration with opts:', opts);
        const result = await handleGeneration(opts, true, metadata.preset_name || null, workspaceId, mockReq);
        console.log('🎲 HandleGeneration result:', result);
        
        return result;
    } catch (error) {
        console.error('❌ Reroll generation error:', error);
        throw error;
    }
}

module.exports = {
    generateImageWebSocket,
    buildOptions,
    handleGeneration,
    handleImageRequest,
    selectPresetItem,
    setContext,
    generatePresetSourceImage,
    convertMetadataToRequestFormat,
    handleRerollGeneration
};

