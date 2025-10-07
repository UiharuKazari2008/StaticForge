const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NovelAI, Model, Action, Sampler, Noise, Resolution, calculateCost, EventType } = require('nekoai-js');
const sharp = require('sharp');

// Import modules
const { loadPromptConfig, applyTextReplacements } = require('./textReplacements');

/**
 * Get the current time period key based on current time
 * Simplified version for image generation context
 * @returns {string} Current period key (dawn, sunrise, morning, etc.)
 */
function getCurrentPeriodKey() {
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60; // Decimal hour (0-24)

    // Simplified time period calculation based on hour of day
    // This is a rough approximation - could be enhanced with location-based sunrise/sunset
    if (currentHour >= 5 && currentHour < 6) return 'dawn';
    if (currentHour >= 6 && currentHour < 7) return 'sunrise';
    if (currentHour >= 7 && currentHour < 9) return 'early_morning';
    if (currentHour >= 9 && currentHour < 11) return 'morning';
    if (currentHour >= 11 && currentHour < 12) return 'late_morning';
    if (currentHour >= 12 && currentHour < 16) return 'afternoon';
    if (currentHour >= 16 && currentHour < 18) return 'golden_hour';
    if (currentHour >= 18 && currentHour < 19) return 'sunset';
    if (currentHour >= 19 && currentHour < 20) return 'dusk';
    if (currentHour >= 20 && currentHour < 21) return 'early_evening';
    if (currentHour >= 21 && currentHour < 23) return 'evening';
    if (currentHour >= 23 || currentHour < 2) return 'late_evening';
    // Late night/early morning before dawn
    return 'midnight';
}

/**
 * Apply NSFW processing based on nsfw value
 * @param {string} prompt - The processed prompt
 * @param {string} negativePrompt - The processed negative prompt
 * @param {Array} characterPrompts - Array of character prompts to process
 * @param {number} nsfwValue - NSFW value (-2, -1, 0, 1, 2, 3)
 * @param {number} nsfwBias - NSFW bias multiplier (default 1.0)
 * @param {object} promptConfig - Current prompt configuration
 * @returns {object} Object with processedPrompt, processedNegativePrompt, and processedCharacterPrompts
 */
function applyNsfwProcessing(prompt, negativePrompt, characterPrompts, nsfwValue, nsfwBias, promptConfig) {
    console.log(`🔞 Applying NSFW processing: value=${nsfwValue}, bias=${nsfwBias}`);

    let processedPrompt = prompt;
    let processedNegativePrompt = negativePrompt;
    let processedCharacterPrompts = characterPrompts ? [...characterPrompts] : [];

    // Helper function to apply bias to text (e.g., "1.5::nsfw")
    function applyBias(text, bias = 1.0) {
        if (!text || bias === 1.0) return text;
        return `${bias.toFixed(1)}::${text}`;
    }

    // Helper function to add text to end of prompt (before ", Text:" if it exists)
    function addToPrompt(text, addition) {
        if (!addition) return text;
        if (!text) return addition;

        // Split by ", Text:" to separate tags from text description
        const textParts = text.split(', Text:');
        if (textParts.length > 1) {
            // Add to the end of tags part
            const tagsPart = textParts[0];
            const textPart = textParts.slice(1).join(', Text:');

            const processedTags = tagsPart ? `${tagsPart}, ${addition}` : addition;
            return processedTags + ', Text:' + textPart;
        } else {
            // No ", Text:" separator, add to end
            return `${text}, ${addition}`;
        }
    }

    // Helper function to remove strings from text
    function removeFromText(text, toRemove) {
        if (!text || !toRemove) return text;

        let result = text;
        const itemsToRemove = Array.isArray(toRemove) ? toRemove : [toRemove];
        
        itemsToRemove.forEach(item => {
            if (!item || typeof item !== 'string') return;
            
            // Escape special regex characters
            const escapedItem = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Create comprehensive regex patterns to handle various positions and formats
            const patterns = [
                // Pattern 1: Item with commas on both sides (middle position)
                new RegExp(`\\s*,\\s*${escapedItem}\\s*,\\s*`, 'gi'),
                // Pattern 2: Item at the beginning with comma after
                new RegExp(`^\\s*${escapedItem}\\s*,\\s*`, 'gi'),
                // Pattern 3: Item at the end with comma before
                new RegExp(`\\s*,\\s*${escapedItem}\\s*$`, 'gi'),
                // Pattern 4: Item as the entire text (standalone)
                new RegExp(`^\\s*${escapedItem}\\s*$`, 'gi'),
                // Pattern 5: Item with bias notation (e.g., "1.5::nsfw")
                new RegExp(`\\s*,\\s*\\d+\\.\\d*::${escapedItem}\\s*,\\s*`, 'gi'),
                new RegExp(`^\\s*\\d+\\.\\d*::${escapedItem}\\s*,\\s*`, 'gi'),
                new RegExp(`\\s*,\\s*\\d+\\.\\d*::${escapedItem}\\s*$`, 'gi'),
                new RegExp(`^\\s*\\d+\\.\\d*::${escapedItem}\\s*$`, 'gi')
            ];
            
            // Apply all patterns
            patterns.forEach(pattern => {
                result = result.replace(pattern, ', ');
            });
        });

        // Clean up extra commas and spaces more thoroughly
        result = result
            .replace(/,\s*,+/g, ',')           // Multiple commas become single comma
            .replace(/^,\s*/, '')              // Remove leading comma
            .replace(/,\s*$/, '')              // Remove trailing comma
            .replace(/\s+/g, ' ')              // Normalize multiple spaces
            .trim();
            
        return result;
    }

    // Check if nsfw_presets exists in prompt config
    const nsfwPreset = promptConfig?.nsfw_presets?.[nsfwValue.toString()];
    if (nsfwPreset) {
        // Use predefined NSFW preset configuration
        console.log(`🔞 Using NSFW preset configuration for value ${nsfwValue}`);

        // Apply removals
        if (nsfwPreset.remove) {
            if (Array.isArray(nsfwPreset.remove)) {
                // Remove from all prompts and UCs
                processedPrompt = removeFromText(processedPrompt, nsfwPreset.remove);
                processedNegativePrompt = removeFromText(processedNegativePrompt, nsfwPreset.remove);
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    prompt: removeFromText(char.prompt, nsfwPreset.remove),
                    uc: removeFromText(char.uc, nsfwPreset.remove)
                }));
            } else if (typeof nsfwPreset.remove === 'object') {
                // Remove from specific targets
                if (nsfwPreset.remove.base) {
                    processedPrompt = removeFromText(processedPrompt, nsfwPreset.remove.base);
                }
                if (nsfwPreset.remove.uc) {
                    processedNegativePrompt = removeFromText(processedNegativePrompt, nsfwPreset.remove.uc);
                }
                if (nsfwPreset.remove.chara_base) {
                    processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                        ...char,
                        prompt: removeFromText(char.prompt, nsfwPreset.remove.chara_base)
                    }));
                }
                if (nsfwPreset.remove.chara_uc) {
                    processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                        ...char,
                        uc: removeFromText(char.uc, nsfwPreset.remove.chara_uc)
                    }));
                }
            }
        }

        // Apply additions
        if (nsfwPreset.add) {
            if (nsfwPreset.add.base) {
                processedPrompt = addToPrompt(processedPrompt, applyBias(nsfwPreset.add.base, nsfwBias));
            }
            if (nsfwPreset.add.uc) {
                processedNegativePrompt = addToPrompt(processedNegativePrompt, applyBias(nsfwPreset.add.uc, nsfwBias));
            }
            if (nsfwPreset.add.chara_base) {
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    prompt: addToPrompt(char.prompt, applyBias(nsfwPreset.add.chara_base, nsfwBias))
                }));
            }
            if (nsfwPreset.add.chara_uc) {
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    uc: addToPrompt(char.uc, applyBias(nsfwPreset.add.chara_uc, nsfwBias))
                }));
            }
        }
    } else {
        // Fallback to old hardcoded logic
        console.log(`🔞 Using fallback NSFW logic for value ${nsfwValue}`);

        switch (nsfwValue) {
            case 1: // Allow: remove from all first, then add "nsfw" to base prompt
                // STEP 1: Remove from all prompts and UCs first
                processedPrompt = removeFromText(processedPrompt, ['nsfw']);
                processedNegativePrompt = removeFromText(processedNegativePrompt, ['nsfw']);
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    prompt: removeFromText(char.prompt, ['nsfw']),
                    uc: removeFromText(char.uc, ['nsfw'])
                }));
                // STEP 2: Then add to base prompt
                processedPrompt = addToPrompt(processedPrompt, applyBias('nsfw', nsfwBias));
                break;

            case -1: // Remove: remove from all prompts and UCs first, then add nsfw to the base UC
                // STEP 1: Remove from all prompts and UCs first
                processedPrompt = removeFromText(processedPrompt, ['nsfw']);
                processedNegativePrompt = removeFromText(processedNegativePrompt, ['nsfw']);
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    prompt: removeFromText(char.prompt, ['nsfw']),
                    uc: removeFromText(char.uc, ['nsfw'])
                }));
                // STEP 2: Then add to base UC
                processedNegativePrompt = addToPrompt(processedNegativePrompt, applyBias('nsfw', nsfwBias));
                break;

            case 3: // Nude: remove from all first, then add values to base prompt
                // STEP 1: Remove from all prompts and UCs first
                processedPrompt = removeFromText(processedPrompt, ['nsfw']);
                processedNegativePrompt = removeFromText(processedNegativePrompt, ['nsfw']);
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    prompt: removeFromText(char.prompt, ['nsfw']),
                    uc: removeFromText(char.uc, ['nsfw'])
                }));
                // STEP 2: Then add to base prompt
                processedPrompt = addToPrompt(processedPrompt, applyBias('nsfw', nsfwBias));
                break;

            case 2: // Skimpy: remove from all first, then add values to base prompt
                // STEP 1: Remove from all prompts and UCs first
                processedPrompt = removeFromText(processedPrompt, ['nsfw']);
                processedNegativePrompt = removeFromText(processedNegativePrompt, ['nsfw']);
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    prompt: removeFromText(char.prompt, ['nsfw']),
                    uc: removeFromText(char.uc, ['nsfw'])
                }));
                // STEP 2: Then add to base prompt
                processedPrompt = addToPrompt(processedPrompt, applyBias('nsfw', nsfwBias));
                break;

            case -2: // Clense: remove from all first, then add values to base prompt
                // STEP 1: Remove from all prompts and UCs first
                processedPrompt = removeFromText(processedPrompt, ['nsfw']);
                processedNegativePrompt = removeFromText(processedNegativePrompt, ['nsfw']);
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    prompt: removeFromText(char.prompt, ['nsfw']),
                    uc: removeFromText(char.uc, ['nsfw'])
                }));
                // STEP 2: Then add to base prompt
                processedPrompt = addToPrompt(processedPrompt, applyBias('nsfw', nsfwBias));
                break;

            default:
                // For any other values, just remove nsfw tags from all prompts
                processedPrompt = removeFromText(processedPrompt, ['nsfw']);
                processedNegativePrompt = removeFromText(processedNegativePrompt, ['nsfw']);
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    prompt: removeFromText(char.prompt, ['nsfw']),
                    uc: removeFromText(char.uc, ['nsfw'])
                }));
                break;
        }
    }

    return { processedPrompt, processedNegativePrompt, processedCharacterPrompts };
}

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
const { generateMobilePreviews } = require('./previewUtils');
const imageCounter = require('./imageCounter');
const { upscaleImageCore } = require('./imageUpscaling');

let context = {};
function setContext(newContext) { context = { ...newContext }; }

// Dynamic Generation Processing - Uses pre-compiled AI prompts from client
const cacheDir = path.resolve(__dirname, '../.cache');
const uploadCacheDir = path.join(cacheDir, 'upload');
const presetSourceCacheDir = path.join(cacheDir, 'preset_source');
const imagesDir = path.resolve(__dirname, '../images');
const previewsDir = path.resolve(__dirname, '../.previews');

// Function to convert character reference to base64 JPG with max edge 1500px
async function convertCharacterReferenceToBase64(charaReference) {
    try {
        if (!charaReference) return null;

        const [type, identifier] = charaReference.split(':', 2);
        if (!type || !identifier) return null;

        let imageBuffer;

        switch (type) {
            case 'cache':
                const cachedImagePath = path.join(uploadCacheDir, identifier);
                if (!fs.existsSync(cachedImagePath)) {
                    console.warn(`⚠️ Character reference cache image not found: ${identifier}`);
                    return null;
                }
                imageBuffer = fs.readFileSync(cachedImagePath);
                break;
            case 'file':
                const filePath = path.join(imagesDir, identifier);
                if (!fs.existsSync(filePath)) {
                    console.warn(`⚠️ Character reference file not found: ${identifier}`);
                    return null;
                }
                imageBuffer = fs.readFileSync(filePath);
                break;
            default:
                console.warn(`⚠️ Unsupported character reference type: ${type}`);
                return null;
        }

        if (!imageBuffer) return null;

        // Strip PNG text chunks to avoid issues
        imageBuffer = stripPngTextChunks(imageBuffer);

        // Get image metadata to calculate aspect ratio
        const metadata = await sharp(imageBuffer).metadata();
        const imgWidth = metadata.width;
        const imgHeight = metadata.height;

        // Exact resolution presets from chunks (matching original ns function)
        const resolutionPresets = [
            [1024, 1536],  // Portrait
            [1536, 1024],  // Landscape
            [1472, 1472]   // Square
        ];

        // Calculate aspect ratio (matching chunks: e = n.width / n.height)
        const imgAspectRatio = imgWidth / imgHeight;

        // Find best matching preset based on aspect ratio (matching chunks logic)
        let bestPreset = resolutionPresets[0]; // Default to first preset
        for (let preset of resolutionPresets) {
            const presetAspectRatio = preset[0] / preset[1];
            const currentBestAspectRatio = bestPreset[0] / bestPreset[1];
            if (Math.abs(presetAspectRatio - imgAspectRatio) < Math.abs(currentBestAspectRatio - imgAspectRatio)) {
                bestPreset = preset;
            }
        }

        // Set target dimensions from best matching preset
        const targetWidth = bestPreset[0];
        const targetHeight = bestPreset[1];

        // Calculate scaled dimensions (matching chunks: e > a ? (o = i.width, s = Math.round(i.width / e)) : (s = i.height, o = Math.round(i.height * e)))
        const targetAspectRatio = targetWidth / targetHeight;
        let drawWidth = imgWidth;
        let drawHeight = imgHeight;

        if (imgAspectRatio > targetAspectRatio) {
            // Image is wider than target aspect ratio - fit to width (matching chunks)
            drawWidth = targetWidth;
            drawHeight = Math.round(targetWidth / imgAspectRatio);
        } else {
            // Image is taller than target aspect ratio - fit to height (matching chunks)
            drawHeight = targetHeight;
            drawWidth = Math.round(targetHeight * imgAspectRatio);
        }

        // Create a black background canvas using Sharp
        const background = sharp({
            create: {
                width: targetWidth,
                height: targetHeight,
                channels: 4, // RGBA
                background: { r: 0, g: 0, b: 0, alpha: 1 } // Black background
            }
        });

        // Resize the input image to calculated dimensions
        const resizedImage = await sharp(imageBuffer)
            .resize(drawWidth, drawHeight, {
                fit: 'fill', // Don't maintain aspect ratio for this resize
                withoutEnlargement: false // Allow enlargement to match target size
            })
            .png()
            .toBuffer();

        // Composite the resized image onto the black background, centered
        const offsetX = Math.round((targetWidth - drawWidth) / 2);
        const offsetY = Math.round((targetHeight - drawHeight) / 2);

        const finalImage = await background
            .composite([{
                input: resizedImage,
                top: offsetY,
                left: offsetX
            }])
            .png()
            .toBuffer();

        // Convert to base64
        const processedBase64 = finalImage.toString('base64');

        console.log(`🎨 Character reference processed (Sharp): ${imgWidth}x${imgHeight} → ${targetWidth}x${targetHeight} (${processedBase64.length} chars)`);
        return processedBase64;

    } catch (error) {
        console.error('❌ Failed to convert character reference to base64:', error.message);
        return null;
    }
}

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
        opts = await buildOptions(presetOptions, null, {}, null, null);
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
    } catch (error) {
        console.warn(`⚠️ Failed to cache preset source image ${cacheFilename}: ${error.message}`);
        // Continue without caching - this is not critical
    }
    
    // Add random delay between 5 and 15 seconds
    const delaySeconds = Math.floor(Math.random() * 11) + 5; // Random between 5-15 seconds
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
// Function to deduplicate tags in prompts and remove empty groups
function deduplicateTagsInOptions(options) {
    if (!options) return options;

    // Create a copy to avoid modifying the original
    const deduplicatedOptions = { ...options };

    // Deduplicate main prompt and negative prompt
    if (deduplicatedOptions.prompt) {
        deduplicatedOptions.prompt = deduplicateTagsInText(deduplicatedOptions.prompt);
    }
    if (deduplicatedOptions.negative_prompt) {
        deduplicatedOptions.negative_prompt = deduplicateTagsInText(deduplicatedOptions.negative_prompt);
    }

    // Deduplicate character prompts if they exist
    if (deduplicatedOptions.allCharacterPrompts && Array.isArray(deduplicatedOptions.allCharacterPrompts)) {
        deduplicatedOptions.allCharacterPrompts = deduplicatedOptions.allCharacterPrompts.map(char => ({
            ...char,
            prompt: char.prompt ? deduplicateTagsInText(char.prompt) : char.prompt,
            uc: char.uc ? deduplicateTagsInText(char.uc) : char.uc
        }));
    }

    return deduplicatedOptions;
}

// Function to deduplicate tags in a single text string
function deduplicateTagsInText(text) {
    if (!text || typeof text !== 'string') return text;

    // Split by common delimiters while preserving emphasis groups
    const tokens = splitTextIntoTokens(text);
    
    // Track seen tags (case-insensitive)
    const seenTags = new Set();
    const deduplicatedTokens = [];

    for (const token of tokens) {
        const normalizedTag = normalizeTag(token);
        
        // Skip empty or whitespace-only tokens
        if (!normalizedTag || normalizedTag.trim() === '') {
            continue;
        }
        
        // Check for empty groups and skip them
        if (isEmptyGroup(token)) {
            continue;
        }
        
        if (!seenTags.has(normalizedTag)) {
            seenTags.add(normalizedTag);
            deduplicatedTokens.push(token);
        }
    }

    // Join tokens back together with appropriate separators
    return deduplicatedTokens.join(', ');
}

// Function to split text into tokens while preserving emphasis groups
function splitTextIntoTokens(text) {
    const tokens = [];
    let currentToken = '';
    let braceLevel = 0;
    let bracketLevel = 0;
    let inEmphasisGroup = false;
    let emphasisGroupContent = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        // Handle emphasis groups (#.#::text::)
        if (char === ':' && nextChar === ':' && !inEmphasisGroup) {
            // Check if this is the start of an emphasis group
            const beforeColons = text.substring(0, i).trim();
            const emphasisMatch = beforeColons.match(/(-?\d+(?:\.\d+)?)$/);
            
            if (emphasisMatch) {
                // This is an emphasis group
                if (currentToken.trim()) {
                    tokens.push(currentToken.trim());
                    currentToken = '';
                }
                
                inEmphasisGroup = true;
                emphasisGroupContent = emphasisMatch[1] + '::';
                continue;
            }
        }

        if (inEmphasisGroup) {
            emphasisGroupContent += char;
            
            // Check for end of emphasis group
            if (char === ':' && nextChar === ':') {
                inEmphasisGroup = false;
                tokens.push(emphasisGroupContent + ':');
                i++; // Skip the next colon
                continue;
            }
            continue;
        }

        // Handle curly braces
        if (char === '{') {
            braceLevel++;
        } else if (char === '}') {
            braceLevel--;
        }
        
        // Handle square brackets
        if (char === '[') {
            bracketLevel++;
        } else if (char === ']') {
            bracketLevel--;
        }

        // Split on commas and pipes when not inside braces/brackets
        if ((char === ',' || char === '|') && braceLevel === 0 && bracketLevel === 0) {
            if (currentToken.trim()) {
                tokens.push(currentToken.trim());
                currentToken = '';
            }
            continue;
        }

        currentToken += char;
    }

    // Add the last token
    if (currentToken.trim()) {
        tokens.push(currentToken.trim());
    }

    return tokens;
}

// Function to normalize a tag for comparison
function normalizeTag(token) {
    if (!token || typeof token !== 'string') return '';

    let normalized = token.trim().toLowerCase();

    // Remove emphasis formatting but keep the content
    // Handle #.#::text:: format
    const emphasisMatch = normalized.match(/^(-?\d+(?:\.\d+)?)::(.+)::$/);
    if (emphasisMatch) {
        normalized = emphasisMatch[2];
    }

    // Handle curly braces {text} - extract inner content
    const braceMatch = normalized.match(/^\{+\s*(.+?)\s*\}+$/);
    if (braceMatch) {
        normalized = braceMatch[1];
    }

    // Handle square brackets [text] - extract inner content
    const bracketMatch = normalized.match(/^\[+\s*(.+?)\s*\]+$/);
    if (bracketMatch) {
        normalized = bracketMatch[1];
    }

    return normalized;
}

// Function to check if a token represents an empty group
function isEmptyGroup(token) {
    if (!token || typeof token !== 'string') return false;
    
    const trimmed = token.trim();
    
    // Check for empty curly braces: {}, {{}}, etc.
    if (/^\{\s*\}+$/.test(trimmed)) {
        return true;
    }
    
    // Check for empty square brackets: [], [[]], etc.
    if (/^\[\s*\]+\s*$/.test(trimmed)) {
        return true;
    }
    
    // Check for empty emphasis groups: #.#::::, etc.
    if (/^-?\d+(?:\.\d+)?::\s*::$/.test(trimmed)) {
        return true;
    }
    
    // Check for groups with only whitespace or commas
    const contentOnly = trimmed.replace(/^[-+]?\d+(?:\.\d+)?::/, '').replace(/::$/, '');
    const contentOnly2 = contentOnly.replace(/^\{+\s*/, '').replace(/\s*\}+$/, '');
    const contentOnly3 = contentOnly2.replace(/^\[+\s*/, '').replace(/\s*\]+$/, '');
    
    if (contentOnly3.trim() === '' || /^[\s,]*$/.test(contentOnly3.trim())) {
        return true;
    }
    
    return false;
}

const buildOptions = async (body, preset = null, queryParams = {}, ws = null, handler = null, wsServer = null) => {
    const resolution = body.resolution || preset?.resolution;
    const allowPaid = body.allow_paid ? body.allow_paid : preset?.allow_paid;
    
    let width, height;
    /* if (resolution && Resolution[resolution.toUpperCase()]) {
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
    } */
    
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
        // Get periodKey from dynamic generation context if available, otherwise current time
        const periodKey = body.dynamic_generation?.compiled_prompt?.context?.time?.periodKey || getCurrentPeriodKey();

        // Handle locked text replacements if provided
        let lockedReplacements = null;
        if (body.text_replacements_seed && Array.isArray(body.text_replacements_seed)) {
            lockedReplacements = body.text_replacements_seed;
            console.log(`🔒 Using ${lockedReplacements.length} locked text replacements`);
        } else if (preset?.text_replacements_seed && Array.isArray(preset.text_replacements_seed)) {
            lockedReplacements = preset.text_replacements_seed;
            console.log(`🔒 Using ${lockedReplacements.length} locked text replacements from preset`);
        }

        let processedPromptResult = applyTextReplacements(rawPrompt, presetName, body.model, periodKey, lockedReplacements);
        let processedNegativePromptResult = applyTextReplacements(rawNegativePrompt, presetName, body.model, periodKey, lockedReplacements);

        let processedPrompt = processedPromptResult.text;
        let processedNegativePrompt = processedNegativePromptResult.text;

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

        // Collect all text replacement seeds
        const allTextReplacementSeeds = [
            ...processedPromptResult.replacements.map(r => ({ ...r, source: 'prompt' })),
            ...processedNegativePromptResult.replacements.map(r => ({ ...r, source: 'negative_prompt' }))
        ];

        if (allTextReplacementSeeds.length > 0) {
            console.log(`🔄 Text replacements: ${allTextReplacementSeeds.map(r => `${r.key}=${r.value}`).join(', ')}`);
        }

        // Process character prompts with text replacements
        let processedCharacterPrompts = body.allCharacterPrompts || preset?.allCharacterPrompts || undefined;
        let characterTextReplacementSeeds = [];
        if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
            processedCharacterPrompts = processedCharacterPrompts.map((char, charIndex) => {
                // Apply text replacements to character prompt and UC
                const processedPromptResult = applyTextReplacements(char.prompt, presetName, body.model, periodKey, lockedReplacements);
                const processedUCResult = applyTextReplacements(char.uc, presetName, body.model, periodKey, lockedReplacements);

                // Collect replacement seeds with character index
                characterTextReplacementSeeds.push(
                    ...processedPromptResult.replacements.map(r => ({ ...r, source: `character_${charIndex}_prompt` })),
                    ...processedUCResult.replacements.map(r => ({ ...r, source: `character_${charIndex}_uc` }))
                );

                return {
                    ...char,
                    prompt: processedPromptResult.text,
                    uc: processedUCResult.text
                };
            });

            // Add character replacements to main seed array
            allTextReplacementSeeds.push(...characterTextReplacementSeeds);

            if (characterTextReplacementSeeds.length > 0) {
                console.log(`🔄 Character prompt text replacements: ${characterTextReplacementSeeds.map(r => `${r.key}=${r.value}`).join(', ')}`);
            }
        }

        // Process NSFW settings from dataset_config
        const nsfwValue = body.dataset_config?.nsfw;
        const nsfwBias = body.dataset_config?.nsfw_bias || 1.0;

        if (nsfwValue !== undefined && nsfwValue !== 0) {
            ({ processedPrompt, processedNegativePrompt, processedCharacterPrompts } = applyNsfwProcessing(
                processedPrompt,
                processedNegativePrompt,
                processedCharacterPrompts,
                nsfwValue,
                nsfwBias,
                currentPromptConfig
            ));
        }

        // Handle dynamic generation processing
        let dynamic_generation = body.dynamic_generation || undefined;

        // If no body dynamic_generation provided, check preset for dynamic_generation and use_cache_responses_preset
        if (!body.dynamic_generation && preset) {
            console.log(`🔄 Preset generation detected, checking for dynamic_generation on preset ${preset.name || 'unnamed'}`);
            if (preset.dynamic_generation) {
                console.log(`📝 Using preset dynamic_generation settings`);
                dynamic_generation = { ...preset.dynamic_generation };
                body.dynamic_generation = dynamic_generation; // Set on body so it can be returned
            }
            // Handle preset-specific cache responses setting
            if (preset.use_cache_responses_preset !== undefined) {
                console.log(`📝 Using preset use_cache_responses_preset: ${preset.use_cache_responses_preset}`);
                dynamic_generation = dynamic_generation || {};
                dynamic_generation.use_cache_responses = preset.use_cache_responses_preset;
                body.dynamic_generation = dynamic_generation; // Set on body so it can be returned
            }
        }

        if (dynamic_generation) {
            const { applyDynamicReplacements } = require('./dynamicGenerationHandlers');

            // Create MD5 hash of current prompts for cache validation
            const crypto = require('crypto');
            const currentPromptHash = crypto.createHash('md5')
                .update(JSON.stringify({
                    prompt: rawPrompt,
                    uc: rawNegativePrompt,
                    characterPrompts: body.allCharacterPrompts || preset?.allCharacterPrompts || []
                }))
                .digest('hex');
            const currentRequestHash = crypto.createHash('md5')
                .update(JSON.stringify({
                    dynamic_generation: body.dynamic_generation ? {
                        tod: body.dynamic_generation.tod,
                        weather: body.dynamic_generation.weather,
                        season: body.dynamic_generation.season,
                        activity: body.dynamic_generation.activity,
                        action: body.dynamic_generation.action,
                        location: body.dynamic_generation.location,
                        optimize: body.dynamic_generation.optimize,
                        creative: body.dynamic_generation.creative,
                    } : null
                }))
                .digest('hex');

            // Check if we have a cached compiled prompt with valid conditions
            let hasValidCache = body?.dynamic_generation?.compiled_prompt &&
                !!body?.dynamic_generation?.compiled_prompt?.prompt_hash &&
                !!body?.dynamic_generation?.compiled_prompt?.request_hash;

            // If use_cache_responses is disabled, never use cache
            if (body?.dynamic_generation?.use_cache_responses !== undefined && body?.dynamic_generation?.use_cache_responses === false) {
                hasValidCache = false;
            }

            // If we have cache and it's either not expired OR locked, try to apply transforms
            const isLocked = !!body?.dynamic_generation?.locked;

            if (hasValidCache) {
                const compiledPrompt = body.dynamic_generation.compiled_prompt;
                const now = Date.now();
                const isNotExpired = (now - compiledPrompt.timestamp) < 15 * 60 * 1000;
                const canUseCache = isNotExpired || isLocked;

                if (canUseCache) {
                    console.log(`${isLocked ? '🔒' : '📝'} ${isLocked ? 'Locked' : 'Cached'} prompt available - attempting to apply text transformations`);

                    // Check if request parameters changed
                    if (compiledPrompt.request_hash !== currentRequestHash) {
                        console.log('🔄 Request hash modified, invalidating cache');
                        hasValidCache = false;
                    }

                    // Try to apply text replacements - create backups first
                    if (hasValidCache && compiledPrompt.text_replacements) {
                        // Create backups of original prompts
                        const originalPrompt = processedPrompt + '';
                        const originalNegativePrompt = processedNegativePrompt + '';
                        const originalCharacterPrompts = processedCharacterPrompts ? processedCharacterPrompts.map(char => ({ ...char })) : [];

                        try {
                            // Apply replacements to prompt
                            if (compiledPrompt.text_replacements.prompt && compiledPrompt.text_replacements.prompt.length > 0) {
                                console.log(`🔄 Applying ${compiledPrompt.text_replacements.prompt.length} cached prompt replacements`);
                                processedPrompt = applyDynamicReplacements(processedPrompt, compiledPrompt.text_replacements, 'prompt');
                            }

                            // Apply replacements to negative prompt
                            if (compiledPrompt.text_replacements.uc && compiledPrompt.text_replacements.uc.length > 0) {
                                console.log(`🔄 Applying ${compiledPrompt.text_replacements.uc.length} cached UC replacements`);
                                processedNegativePrompt = applyDynamicReplacements(processedNegativePrompt, compiledPrompt.text_replacements, 'uc');
                            }

                            // Apply replacements to character prompts
                            if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts) && processedCharacterPrompts.length > 0 && compiledPrompt.text_replacements.character_prompts) {
                                processedCharacterPrompts = processedCharacterPrompts.map((char, index) => {
                                    const charReplacements = compiledPrompt.text_replacements.character_prompts[index];
                                    if (!charReplacements) {
                                        return char;
                                    }
                                    let updatedChar = { ...char };

                                    if (charReplacements.input && charReplacements.input.length > 0) {
                                        console.log(`🔄 Applying ${charReplacements.input.length} cached input replacements to character ${index}`);
                                        updatedChar.input = applyDynamicReplacements(char.input || '', compiledPrompt.text_replacements, 'character', index, 'input');
                                    }

                                    if (charReplacements.uc && charReplacements.uc.length > 0) {
                                        console.log(`🔄 Applying ${charReplacements.uc.length} cached UC replacements to character ${index}`);
                                        updatedChar.uc = applyDynamicReplacements(char.uc || '', compiledPrompt.text_replacements, 'character', index, 'uc');
                                    }

                                    return updatedChar;
                                });
                            }
                        } catch (error) {
                            console.error('❌ Error applying cached text replacements:', error);
                            hasValidCache = false;
                        }

                        if (!hasValidCache) {
                            console.log('🔄 Text transformations failed, restoring originals and regenerating');
                            // Restore from backups
                            processedPrompt = originalPrompt;
                            processedNegativePrompt = originalNegativePrompt;
                            processedCharacterPrompts = originalCharacterPrompts;
                            hasValidCache = false;
                        }
                    } else if (hasValidCache && body.dynamic_generation.compiled_prompt.prompt_hash !== currentPromptHash) {
                        console.log('🔄 Text replacement sources modified, invalidating cache');
                        hasValidCache = false;
                    }
                } else {
                    console.log('⏰ Cached prompt expired and not locked, invalidating cache');
                    hasValidCache = false;
                }

                if (!hasValidCache) {
                    console.log(`🗑️ ${isLocked ? 'Locked' : 'Cached'} prompt invalidated - will regenerate`);
                }
            }

            if (hasValidCache) {
                console.log('✅ Using successfully transformed cached prompt');
            } else {
                // Has configured values but no compiled prompt - run actual AI processing like the client does
                console.log('🎭 Dynamic generation configured but no compiled prompt - running AI processing');

                // Import the core AI processing function
                const { processDynamicGenerationCore } = require('./dynamicGenerationHandlers');

                // Call the actual AI processing (same as client WebSocket handler)
                let dynaRequest = body.dynamic_generation
                
                if (body.dynamic_generation.compiled_prompt) {
                    dynaRequest.compiled_prompt_data = body.dynamic_generation.compiled_prompt;
                }


                const dynamicResult = await processDynamicGenerationCore(
                    dynaRequest,
                    processedPrompt,
                    processedNegativePrompt,
                    processedCharacterPrompts,
                    'buildOptions',
                    ws,
                    handler,
                    wsServer
                );

                // Check if processing was successful
                if (!dynamicResult.success) {
                    console.warn('⚠️ Dynamic generation processing failed:', dynamicResult.error);

                    // Send error update to client if we have websocket context
                    if (ws && handler) {
                        handler.sendToClient(ws, {
                            type: 'dynamic_generation_progress_update',
                            phase: 'error',
                            data: {
                                error: dynamicResult.error || 'Dynamic generation processing failed'
                            },
                            timestamp: new Date().toISOString()
                        });
                    }
                } else {
                    // Store the compiled result
                    const compiledPrompt = {
                        prompt: dynamicResult.prompt,
                        uc: dynamicResult.uc,
                        characterPrompts: dynamicResult.characterPrompts,
                        modifications_made: dynamicResult.modifications_made,
                        reasoning: dynamicResult.reasoning,
                        citations: dynamicResult.citations,
                        context: dynamicResult.context, // Include weather/time/season context
                        text_replacements: dynamicResult.text_replacements, // Store text replacements for caching
                        prompt_hash: currentPromptHash, // Store hash for cache validation
                        request_hash: currentRequestHash, // Store hash for cache validation
                        timestamp: Date.now(),
                        ai_processed: true // Mark as real AI processing
                    };
                    
                    if (dynamicResult.text_replacements) {
                        // Apply replacements to prompt
                        if (dynamicResult.text_replacements.prompt && dynamicResult.text_replacements.prompt.length > 0) {
                            console.log(`🔄 Applying ${dynamicResult.text_replacements.prompt.length} prompt replacements`);
                            try {
                                processedPrompt = applyDynamicReplacements(processedPrompt, dynamicResult.text_replacements, 'prompt');
                            } catch (error) {
                                console.error('❌ Error applying prompt replacements:', error);
                            }
                        }

                        // Apply replacements to negative prompt
                        if (dynamicResult.text_replacements.uc && dynamicResult.text_replacements.uc.length > 0) {
                            console.log(`🔄 Applying ${dynamicResult.text_replacements.uc.length} UC replacements`);
                            try {
                                processedNegativePrompt = applyDynamicReplacements(processedNegativePrompt, dynamicResult.text_replacements, 'uc');
                            } catch (error) {
                                console.error('❌ Error applying UC replacements:', error);
                            }
                        }

                        // Apply replacements to character prompts
                        if (dynamicResult.text_replacements.character_prompts) {
                            processedCharacterPrompts = processedCharacterPrompts || [];
                            if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts) && processedCharacterPrompts.length > 0) {
                                dynamicResult.text_replacements.character_prompts.forEach((charReplacements, index) => {
                                    if (charReplacements) {
                                        if (processedCharacterPrompts[index]) {
                                            if (charReplacements.input && charReplacements.input.length > 0) {
                                                try {
                                                    processedCharacterPrompts[index].input = applyDynamicReplacements(
                                                        processedCharacterPrompts[index].input || '',
                                                        dynamicResult.text_replacements,
                                                        'character',
                                                        index,
                                                        'input'
                                                    );
                                                } catch (error) {
                                                    console.error(`❌ Error applying character ${index} input replacements:`, error);
                                                }
                                            }

                                            if (charReplacements.uc && charReplacements.uc.length > 0) {
                                                console.log(`🔄 Applying ${charReplacements.uc.length} UC replacements to character ${index}`);
                                                try {
                                                    processedCharacterPrompts[index].uc = applyDynamicReplacements(
                                                        processedCharacterPrompts[index].uc || '',
                                                        dynamicResult.text_replacements,
                                                        'character',
                                                        index,
                                                        'uc'
                                                    );
                                                } catch (error) {
                                                    console.error(`❌ Error applying character ${index} UC replacements:`, error);
                                                }
                                            }
                                        }
                                    }
                                });
                            }
                        }
                        const totalReplacements = (dynamicResult.text_replacements.prompt?.length || 0) +
                                                    (dynamicResult.text_replacements.uc?.length || 0) +
                                                    (dynamicResult.text_replacements.character_prompts?.reduce((sum, char) =>
                                                        (char.input?.length || 0) + (char.uc?.length || 0), 0) || 0);
                        console.log(`🔄 Applied ${totalReplacements} text replacements (primary method)`);
                    } else {
                        console.log('⚠️ No text replacements provided, falling back to compiled prompt');
                        processedPrompt = compiledPrompt.prompt;
                        processedNegativePrompt = compiledPrompt.uc;
                        processedCharacterPrompts = compiledPrompt.characterPrompts;
                    }

                    // Store in the dynamic_generation object for caching
                    dynamic_generation.compiled_prompt = compiledPrompt;
                    console.log('💾 Created and stored compiled prompt in dynamic_generation');

                    // If this is a preset generation, save the compiled prompt directly to the preset
                    if (!!preset &&body.presetName) {
                        try {
                            const { savePromptConfig, loadPromptConfig } = require('./textReplacements');
                            const currentPromptConfig = loadPromptConfig();

                            if (currentPromptConfig.presets[body.presetName]) {
                                if (!currentPromptConfig.presets[body.presetName].dynamic_generation) {
                                    currentPromptConfig.presets[body.presetName].dynamic_generation = {};
                                }

                                currentPromptConfig.presets[body.presetName].dynamic_generation.compiled_prompt = compiledPrompt;

                                const success = savePromptConfig(currentPromptConfig);
                                if (success) {
                                    console.log(`💾 Saved compiled prompt directly to preset: ${body.presetName}`);
                                } else {
                                    console.warn(`⚠️ Failed to save compiled prompt to preset ${body.presetName}: savePromptConfig returned false`);
                                }
                            }
                        } catch (error) {
                            console.warn(`⚠️ Failed to save compiled prompt to preset ${body.presetName}:`, error.message);
                        }
                    }
                }
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
            dynamic_generation: dynamic_generation || (preset?.dynamic_generation ? { ...preset.dynamic_generation, compiled_prompt: undefined } : undefined),
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

        if (body.director_session_id !== undefined) {
            baseOptions.director_session_id = body.director_session_id;
        }
        if (body.director_message_id !== undefined) {
            baseOptions.director_message_id = body.director_message_id;
        }

        if (body.chara_reference_source !== undefined) {
            try {
                // Convert character reference to base64 PNG image (following chunk pattern)
                const charaReferenceBase64 = await convertCharacterReferenceToBase64(body.chara_reference_source);
                if (charaReferenceBase64) {
                    // Add to API options following chunk pattern exactly
                    baseOptions.director_reference_images = [charaReferenceBase64];
                    baseOptions.director_reference_descriptions = [{
                        caption: {
                            base_caption: body.chara_reference_fidelity ? "character&style" : "character",
                            char_captions: []
                        },
                        legacy_uc: false
                    }];
                    baseOptions.director_reference_information_extracted = [1];
                    baseOptions.director_reference_strength_values = [1];
                    const fidelity = Number((body.chara_reference_fidelity || 0).toFixed(2));
                    const secondaryStrength = Number((1 - fidelity).toFixed(2));
                    baseOptions.director_reference_secondary_strength_values = [Math.max(0, Math.min(1, secondaryStrength))];

                    // Add to returned options for forgeData storage
                    baseOptions.chara_reference_source = body.chara_reference_source;
                    baseOptions.chara_reference_with_style = body.chara_reference_with_style !== undefined ? body.chara_reference_with_style : false;

                    console.log(`🎭 Added character reference to API request (${charaReferenceBase64.length} chars, style: ${body.chara_reference_with_style})`);
                } else {
                    console.warn(`⚠️ Failed to convert character reference to base64: ${body.chara_reference_source}`);
                }
            } catch (error) {
                console.warn(`⚠️ Failed to process character reference: ${error.message}`);
            }
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
        if (baseOptions.vibe_transfer && Array.isArray(baseOptions.vibe_transfer) && baseOptions.vibe_transfer.length > 0 && 
        !(baseOptions.director_reference_images && baseOptions.director_reference_images.length > 0)) {
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

        /* if (!allowPaid) {
            try {
                const cost_opus = calculateCost(baseOptions, true);
                if (cost_opus > 0) {
                    throw new Error(`Request requires Opus credits (cost: ${cost_opus}). Set "allow_paid": true to confirm you accept using Opus credits for this request.`);
                }
            } catch (error) {
                    if (error.message.includes('requires Opus credits')) throw error;
            }
        } */

        // Add text replacement seeds to options for client-side storage
        if (allTextReplacementSeeds.length > 0) {
            baseOptions.text_replacements_seed = allTextReplacementSeeds;
        }

        // Deduplicate tags in all prompt fields before returning
        /* const originalPrompt = baseOptions.prompt;
        const originalUC = baseOptions.negative_prompt;
        baseOptions = deduplicateTagsInOptions(baseOptions);
        
        // Log deduplication results if changes were made
        if (originalPrompt !== baseOptions.prompt) {
            console.log('🔄 Deduplicated prompt tags');
            console.log('  Before:', originalPrompt);
            console.log('  After: ', baseOptions.prompt);
        }
        if (originalUC !== baseOptions.negative_prompt) {
            console.log('🔄 Deduplicated negative prompt tags');
            console.log('  Before:', originalUC);
            console.log('  After: ', baseOptions.negative_prompt);
        }
        
        // Log character prompt deduplication if applicable
        if (baseOptions.allCharacterPrompts && Array.isArray(baseOptions.allCharacterPrompts)) {
            baseOptions.allCharacterPrompts.forEach((char, index) => {
                if (char.prompt && char.uc) {
                    console.log(`🔄 Processed character ${index} prompts for deduplication`);
                }
            });
        } */

        return baseOptions;
    } catch (error) {
        throw error;
    }
};

async function handleGeneration(opts, returnImage = false, presetName = null, workspaceId = null, req = null, streamingCallback = null) {
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
    console.log(`🎬 Streaming callback provided: ${streamingCallback !== null && typeof streamingCallback === 'function'}`);

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
    delete apiOpts.chara_reference_source;
    delete apiOpts.chara_reference_with_style;
    delete apiOpts.chara_reference_fidelity;
    delete apiOpts.director_session_id;
    delete apiOpts.director_message_id;
    delete apiOpts.history;
    delete apiOpts.text_replacements_seed;
    delete apiOpts.dynamic_generation;

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

        if (streamingCallback !== undefined && typeof streamingCallback === 'function' && opts.action !== Action.IMG2IMG) {
            // Streaming generation with callback
            const streamingResponse = await context.client.generateImage(apiOpts, true, true);

            // Check if response is an AsyncGenerator (streaming)
            if (streamingResponse && typeof streamingResponse[Symbol.asyncIterator] === "function") {
                console.log("🎬 Streaming generation started...");

                for await (const event of streamingResponse) {
                    if (event.event_type === EventType.INTERMEDIATE) {
                        
                        await streamingCallback({
                            type: 'intermediate',
                            step: event.step_ix,
                            image: Buffer.from(event.image.data),
                            timestamp: Date.now()
                        });
                    } else if (event.event_type === EventType.FINAL) {
                        console.log("✅ Final image received");
                        img = event.image;
                        break
                    }
                }
            } else {
                // Fallback to regular generation if streaming not available
                console.log("⚠️ Streaming not available, falling back to regular generation");
                [img] = await context.client.generateImage(apiOpts, false, true, true);
            }
        } else {
            // Regular non-streaming generation
            [img] = await context.client.generateImage(apiOpts, false, true, true);
            console.log('✅ Image generation completed');
        }
        
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
        if (opts.vibe_transfer !== undefined) {
            forgeData.vibe_transfer = opts.vibe_transfer;
        }
        if (opts.normalize_vibes !== undefined) {
            forgeData.normalize_vibes = opts.normalize_vibes;
        }
        if (opts.chara_reference_source !== undefined) {
            forgeData.chara_reference_source = opts.chara_reference_source;
            forgeData.chara_reference_with_style = opts.chara_reference_with_style !== undefined ? opts.chara_reference_with_style : false;
            forgeData.chara_reference_fidelity = opts.chara_reference_fidelity !== undefined ? opts.chara_reference_fidelity : 0;
        }
        if (opts.director_session_id !== undefined) {
            forgeData.director_session_id = opts.director_session_id;
        }
        if (opts.director_message_id !== undefined) {
            forgeData.director_message_id = opts.director_message_id;
        }
        if (opts.dynamic_generation !== undefined) {
            forgeData.dynamic_generation = opts.dynamic_generation;
        }

        // Add text replacement seeds to forge data if any replacements were used
        if (opts.text_replacements_seed && Array.isArray(opts.text_replacements_seed) && opts.text_replacements_seed.length > 0) {
            forgeData.text_replacements_seed = opts.text_replacements_seed;
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
            
            // Generate both main and @2x previews for mobile devices
            await generateMobilePreviews(path.join(imagesDir, name), baseName);
            console.log(`📸 Generated previews for ${baseName}`);
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
            const result = {
                buffer: updatedScaledBuffer,
                filename: name,
                saved: shouldSave,
                seed: seed,
                compiled_prompt: opts.dynamic_generation?.compiled_prompt
            };
            return result;
        }
        
        // Return result with appropriate seed information
        const finalResult = {
            buffer,
            filename: name,
            saved: shouldSave,
            seed: seed,
            compiled_prompt: opts.dynamic_generation?.compiled_prompt,
            text_replacements_seed: opts.text_replacements_seed && Array.isArray(opts.text_replacements_seed) && opts.text_replacements_seed.length > 0 ? opts.text_replacements_seed : undefined
        };
        return finalResult;
    } else {
        // Save image and return filename only (legacy behavior)
        if (shouldSave) {
            const filePath = path.join(imagesDir, name);
            await img.save(filePath);
            console.log(`💾 Saved: ${name}`);
            
            // Generate preview
            const baseName = getBaseName(name);
            
            // Generate both main and @2x previews for mobile devices
            await generateMobilePreviews(path.join(imagesDir, name), baseName);
            console.log(`📸 Generated previews for ${baseName}`);
        }
        
        // Return result with appropriate seed information
        const result = {
            filename: name,
            saved: shouldSave,
            seed: seed,
            compiled_prompt: opts.dynamic_generation?.compiled_prompt
        };
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
async function generateImageWebSocket(body, userType, sessionId, streamingCallback = null, ws = null, handler = null, wsServer = null) {
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

        const opts = await buildOptions(bodyData, null, {}, ws, handler, wsServer);
        // Add original filename for metadata tracking if this is img2img and not a frontend upload
        if (bodyData.image && !bodyData.is_frontend_upload) {
            opts.original_filename = baseFilename;
        }

        // Create a mock req object for context functions that need it
        const mockReq = { session: { id: sessionId } };

        // Call handleGeneration directly and return the result
        const result = await handleGeneration(opts, true, body?.preset || body?.presetName, body?.workspace, mockReq, streamingCallback);

        return result;
    } catch(e) {
        console.error('❌ WebSocket image generation error:', e);
        throw e;
    }
}

// Function to convert image metadata to request format for rerolling
async function convertMetadataToRequestFormat(metadata, allowPaid = false) {
    if (!metadata) {
        throw new Error('No metadata provided for conversion');
    }

    // Import the extractRelevantFields function to properly extract metadata
    const { extractRelevantFields } = require('./pngMetadata');

    // Extract the actual metadata from the nested structure
    const actualMetadata = metadata.metadata || metadata;

    // Use the existing extractRelevantFields function to get properly formatted metadata
    const extractedMetadata = await extractRelevantFields(actualMetadata, metadata.filename);

    if (!extractedMetadata) {
        throw new Error('Failed to extract relevant metadata fields');
    }

    const requestBody = {
        workspace: metadata.workspace || 'default',
        model: extractedMetadata.model || 'v4_5',
        prompt: extractedMetadata.prompt || '',
        uc: extractedMetadata.uc || '',
        resolution: extractedMetadata.resolution || (extractedMetadata.width && extractedMetadata.height ? `${extractedMetadata.width}x${extractedMetadata.height}` : ''),
        steps: extractedMetadata.steps || 25,
        guidance: extractedMetadata.scale || 5.0,
        rescale: extractedMetadata.cfg_rescale || 0.0,
        sampler: extractedMetadata.sampler || undefined,
        noiseScheduler: extractedMetadata.noise_schedule || undefined,
        variety: !!(extractedMetadata.skip_cfg_above_sigma),
        upscale: !!(extractedMetadata.upscaled),
        allow_paid: allowPaid, // Use the passed allowPaid flag
        preset: extractedMetadata.preset_name || undefined,
        dynamic_generation: extractedMetadata.dynamic_generation !== undefined ? extractedMetadata.dynamic_generation : null
    };

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
        if (extractedMetadata.image_source_seed !== undefined) {
            requestBody.image_source_seed = extractedMetadata.image_source_seed;
        }

        // Add mask data if it exists
        if (extractedMetadata.mask_compressed) {
            requestBody.mask_compressed = extractedMetadata.mask_compressed;
        } else if (extractedMetadata.mask) {
            requestBody.mask = extractedMetadata.mask;
        }
        if (extractedMetadata.mask_bias !== undefined) {
            requestBody.mask_bias = extractedMetadata.mask_bias;
        }
    }

    // Add Director-related parameters if available
    if (extractedMetadata.director_session_id !== undefined) {
        requestBody.director_session_id = extractedMetadata.director_session_id;
    }
    if (extractedMetadata.director_message_id !== undefined) {
        requestBody.director_message_id = extractedMetadata.director_message_id;
    }
    if (extractedMetadata.chara_reference_source !== undefined) {
        requestBody.chara_reference_source = extractedMetadata.chara_reference_source;
    }
    if (extractedMetadata.chara_reference_with_style !== undefined) {
        requestBody.chara_reference_with_style = extractedMetadata.chara_reference_with_style;
    }
    if (extractedMetadata.chara_reference_fidelity !== undefined) {
        requestBody.chara_reference_fidelity = extractedMetadata.chara_reference_fidelity;
    }

    // Add text replacement seeds if available
    if (extractedMetadata.text_replacements_seed !== undefined) {
        requestBody.text_replacements_seed = extractedMetadata.text_replacements_seed;
    }

    // Remove seed to ensure new random seed is generated
    delete requestBody.seed;

    console.log('🔄 Converted request body:', requestBody);
    return requestBody;
}

// Function to handle reroll generation from metadata
async function handleRerollGeneration(metadata, userType, sessionId, workspaceId = null, allowPaid = false) {
    // Check if user is read-only
    if (userType === 'readonly') {
        throw new Error('Non-Administrator Login: This operation is not allowed for read-only users');
    }

    try {
        // Convert metadata to request format with allow_paid flag
        const requestBody = await convertMetadataToRequestFormat(metadata, allowPaid);

        // Build options for generation
        const opts = await buildOptions(requestBody, null, {}, null, null);

        // Create a mock req object for context functions that need it
        const mockReq = { session: { id: sessionId } };

        // Call handleGeneration and return the result
        const result = await handleGeneration(opts, true, metadata.preset_name || null, workspaceId, mockReq);

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
    handleRerollGeneration,
};

