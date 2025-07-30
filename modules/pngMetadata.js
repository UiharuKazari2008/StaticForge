const fs = require('fs');
const path = require('path');
const { getImageDimensions, getResolutionFromDimensions } = require('./imageTools');

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

// Helper: Insert text chunk into PNG
function insertTextChunk(imageBuffer, keyword, text) {
    try {
        const data = new Uint8Array(imageBuffer);
        let commentStart = -1;
        let commentEnd = -1;
        let iendPos = -1;
        let idx = 8;
        while (idx < data.length - 4) {
            const length = readUint32(data, idx);
            const name = String.fromCharCode(...data.slice(idx + 4, idx + 8));
            if (name === 'tEXt') {
                const chunkData = data.slice(idx + 8, idx + 8 + length);
                const keywordStart = chunkData.indexOf(0);
                if (keywordStart !== -1) {
                    const chunkKeyword = new TextDecoder().decode(chunkData.slice(0, keywordStart));
                    if (chunkKeyword === keyword) {
                        commentStart = idx;
                        commentEnd = idx + 4 + 4 + length + 4;
                    }
                }
            } else if (name === 'IEND') {
                iendPos = idx;
                break;
            }
            idx += 4 + 4 + length + 4;
        }
        if (iendPos === -1) {
            throw new Error('IEND chunk not found');
        }
        const keywordBytes = new TextEncoder().encode(keyword);
        const textBytes = new TextEncoder().encode(text);
        const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
        chunkData.set(keywordBytes, 0);
        chunkData[keywordBytes.length] = 0;
        chunkData.set(textBytes, keywordBytes.length + 1);
        const typeBytes = new TextEncoder().encode('tEXt');
        const chunkLength = chunkData.length;
        const fullChunk = new Uint8Array(4 + 4 + chunkLength + 4);
        fullChunk[0] = (chunkLength >>> 24) & 0xFF;
        fullChunk[1] = (chunkLength >>> 16) & 0xFF;
        fullChunk[2] = (chunkLength >>> 8) & 0xFF;
        fullChunk[3] = chunkLength & 0xFF;
        fullChunk.set(typeBytes, 4);
        fullChunk.set(chunkData, 8);
        const crc = calculateCRC(fullChunk.slice(4, 8 + chunkLength));
        fullChunk[8 + chunkLength] = (crc >>> 24) & 0xFF;
        fullChunk[8 + chunkLength + 1] = (crc >>> 16) & 0xFF;
        fullChunk[8 + chunkLength + 2] = (crc >>> 8) & 0xFF;
        fullChunk[8 + chunkLength + 3] = crc & 0xFF;
        let newBuffer;
        if (commentStart !== -1) {
            const beforeComment = data.slice(0, commentStart);
            const afterComment = data.slice(commentEnd);
            newBuffer = new Uint8Array(beforeComment.length + fullChunk.length + afterComment.length);
            newBuffer.set(beforeComment, 0);
            newBuffer.set(fullChunk, beforeComment.length);
            newBuffer.set(afterComment, beforeComment.length + fullChunk.length);
        } else {
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
        return imageBuffer;
    }
}

// Helper: Calculate CRC32
function calculateCRC(data) {
    let crc = 0xFFFFFFFF;
    const table = [];
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[i] = c;
    }
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

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
            
            // Extract forge_data if it exists, filtering to known fields
            if (_metadata.forge_data) {
                const knownForgeDataFields = [
                    'date_generated',
                    'request_type',
                    'generation_type',
                    'upscale_ratio',
                    'upscaled_at',
                    'preset_name',
                    'layer1_seed',
                    'image_source',
                    'image_bias',
                    'mask_compressed',
                    'mask_bias',
                    'img2img_strength',
                    'img2img_noise',
                    'input_prompt',
                    'input_uc',
                    'dataset_config',
                    'append_quality',
                    'append_uc',
                    'vibe_transfer',
                    'normalize_vibes',
                    'allCharacters',
                    'use_coords',
                    'disabledCharacters',
                    'characterNames',
                    'software',
                    'history'
                ];
                
                const filteredForgeData = {};
                for (const [key, value] of Object.entries(_metadata.forge_data)) {
                    if (knownForgeDataFields.includes(key)) {
                        filteredForgeData[key] = value;
                    }
                }
                result.forge_data = filteredForgeData;
            }

            delete result.reference_image_multiple;
            
            return result;
        }
        return null;
    } catch (error) {
        console.error('Error extracting metadata:', error.message);
        return null;
    }
}

// Dynamic prompt config loading
let promptConfig = null;
let promptConfigLastModified = 0;

function loadPromptConfig() {
    const promptConfigPath = './prompt.config.json';
    
    if (!fs.existsSync(promptConfigPath)) {
        console.error('prompt.config.json not found');
        process.exit(1);
    }
    
    const stats = fs.statSync(promptConfigPath);
    if (stats.mtime.getTime() > promptConfigLastModified) {
        try {
            const configData = fs.readFileSync(promptConfigPath, 'utf8');
            promptConfig = JSON.parse(configData);
            promptConfigLastModified = stats.mtime.getTime();
        } catch (error) {
            console.error('❌ Error reloading prompt config:', error.message);
            if (!promptConfig) {
                process.exit(1);
            }
        }
    }
    
    return promptConfig;
}

// Helper: Extract relevant fields from metadata
async function extractRelevantFields(meta, filename) {
    if (!meta) return null;
    
    const model = determineModelFromMetadata(meta);
    const modelDisplayName = getModelDisplayName(model);
    
    // Check if dimensions match a known resolution
    const resolution = getResolutionFromDimensions(meta.width, meta.height);
    
    // Extract metadata from forge_data only
    const forgeData = meta.forge_data || {};
    const upscaled = forgeData.upscale_ratio !== null && forgeData.upscale_ratio !== undefined;
    const hasBaseImage = forgeData.image_source !== undefined;
    
    // Extract character prompts from forge_data (includes disabled characters and character names)
    let characterPrompts = [];
    
    // First, process v4_prompt character data if available
    let hasCharacterPrompts = false;
    if (forgeData.allCharacters) {
        characterPrompts = forgeData.allCharacters;
    } else if (meta.v4_prompt && meta.v4_prompt.caption.char_captions && Array.isArray(meta.v4_prompt.caption.char_captions) && meta.v4_prompt.caption.char_captions.length > 0) {
        hasCharacterPrompts = true;
        if (forgeData.allCharacters) {
            characterPrompts = forgeData.allCharacters;
        } else {
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
            characterPrompts = Array.from(captionMap.values());
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
            if (forgeData.characterNames && Array.isArray(forgeData.characterNames)) {
                characterPrompts.forEach((char, index) => {
                    if (forgeData.characterNames[index]) {
                        char.chara_name = forgeData.characterNames[index];
                    }
                });
            }
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
    
    // Use saved input values if available, otherwise use extracted values
    const resultPrompt = forgeData.input_prompt !== undefined ? forgeData.input_prompt : meta.prompt;
    const resultUc = forgeData.input_prompt !== undefined ? forgeData.input_uc : meta.uc;

    const result = {
        prompt: resultPrompt,
        uc: resultUc,
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
        image_source: forgeData.image_source,
        image_bias: forgeData.image_bias,
        preset_name: forgeData.preset_name,
        use_coords: hasCharacterPrompts ? meta.v4_prompt.use_coords : forgeData.use_coords || false,
        strength: meta.strength || forgeData.img2img_strength,
        noise: meta.noise || forgeData.img2img_noise
    };

    // If image_source is present, get width and height from the file and add to result
    if (result.image_source) {
        try {
            const imagePath = result.image_source.startsWith('file:')
                ? path.join(imagesDir, result.image_source.replace('file:', ''))
                : result.image_source.startsWith('cache:')
                    ? path.join(uploadCacheDir, result.image_source.replace('cache:', ''))
                    : null;
            if (imagePath && fs.existsSync(imagePath)) {
                const { width, height } = await getImageDimensions(fs.readFileSync(imagePath));
                result.image_source_width = width;
                result.image_source_height = height;
            }
        } catch (e) {
            // Ignore errors, do not set width/height
        }
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
    if (forgeData.mask_compressed !== undefined) {
        result.mask_compressed = forgeData.mask_compressed;
    } else if (forgeData.mask !== undefined) {
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
    
    // Handle detection and removal of append_quality and append_uc
    // Only apply this logic if we're using extracted values, not saved input values
    const currentPromptConfig = loadPromptConfig();
    let detectedAppendQuality = false;
    let detectedAppendUc = 0;
    
    // If we have saved values in forge data, use those append flags directly
    if (forgeData.append_quality !== undefined) {
        detectedAppendQuality = forgeData.append_quality;
    } else {
        // Detect and remove quality preset from prompt (only for extracted values)
        if (result.prompt && currentPromptConfig.quality_presets) {
            const modelKey = model.toLowerCase();
            const qualityValue = currentPromptConfig.quality_presets[modelKey];
            if (qualityValue && result.prompt.includes(qualityValue)) {
                // Split by "|" and check if quality is at the end of the first group
                const groups = result.prompt.split('|').map(group => group.trim());
                if (groups.length > 0) {
                    const qualityPattern = ', ' + qualityValue;
                    if (groups[0].endsWith(qualityPattern)) {
                        groups[0] = groups[0].slice(0, -qualityPattern.length);
                        result.prompt = groups.join(' | ');
                        detectedAppendQuality = true;
                    }
                } else {
                    // Fallback for single group
                    const qualityPattern = ', ' + qualityValue;
                    if (result.prompt.endsWith(qualityPattern)) {
                        result.prompt = result.prompt.slice(0, -qualityPattern.length);
                        detectedAppendQuality = true;
                    }
                }
            }
        }
    }
    
    if (forgeData.append_uc !== undefined) {
        detectedAppendUc = forgeData.append_uc;
    } else {
        // Detect and remove UC preset from negative prompt (only for extracted values)
        if (result.uc && currentPromptConfig.uc_presets) {
            const modelKey = model.toLowerCase();
            const ucPresets = currentPromptConfig.uc_presets[modelKey];
            if (ucPresets && Array.isArray(ucPresets)) {
                for (let i = 0; i < ucPresets.length; i++) {
                    const ucValue = ucPresets[i];
                    if (result.uc.startsWith(ucValue)) {
                        // Check if it's at the start with ", " separator
                        const ucPattern = ucValue + ', ';
                        if (result.uc.startsWith(ucPattern)) {
                            result.uc = result.uc.slice(ucPattern.length);
                            detectedAppendUc = i + 1; // 1-based index
                            break;
                        } else if (result.uc === ucValue) {
                            // UC preset is the entire UC
                            result.uc = '';
                            detectedAppendUc = i + 1;
                            break;
                        }
                    }
                }
            }
        }
    }

    if (forgeData.vibe_transfer !== undefined) {
        result.vibe_transfer = forgeData.vibe_transfer;
    }
    if (forgeData.normalize_vibes !== undefined) {
        result.normalize_vibes = forgeData.normalize_vibes;
    }
    
    // Add new metadata fields
    result.append_quality = detectedAppendQuality;
    result.append_uc = detectedAppendUc;
    result.append_quality_id = forgeData.append_quality_id || null;
    result.append_uc_id = forgeData.append_uc_id || null;
    result.dataset_config = forgeData.dataset_config || { include: [] }; // Default to empty array
    
    return result;
}


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
function getModelDisplayName(model) {
    return model === "V4_5" ? "V4.5" : model === "V4_5_CUR" ? "V4.5 (Curated)" : model === "V4" ? "V4" : model === "V4_CUR" ? "V4 (Curated)" : model === "V3" ? "V3" : "Unknown";
}


// Helper: get base name for pairing
function getBaseName(filename) {
    return filename
        .replace(/_upscaled(?=\.)/, '')  // Remove _upscaled suffix
        .replace(/_pipeline(?=\.)/, '')  // Remove _pipeline suffix
        .replace(/_pipeline_upscaled(?=\.)/, '')  // Remove _pipeline_upscaled suffix
        .replace(/\.(png|jpg|jpeg)$/i, '');  // Remove file extension
}

module.exports = {
    readMetadata,
    updateMetadata,
    stripPngTextChunks,
    extractNovelAIMetadata,
    extractRelevantFields,
    getModelDisplayName,
    determineModelFromMetadata,
    getBaseName
}; 