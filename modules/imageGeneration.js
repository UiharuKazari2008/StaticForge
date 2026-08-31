const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { createCanvas, loadImage } = require('canvas');
const { z } = require('zod');
const {
    matchCommaTextColon,
    splitPromptAtTextColon,
    insertBeforeTextColonOrFirstGroup,
    stripNoTextTag
} = require('./promptTextBoundary');
let __runtimeGr = null;
function bindRuntimeGlobalResources(globalResources) { __runtimeGr = globalResources; }

// modules/replicationJournal.js
async function recordReplicationGalleryJournal(filename, workspaceId) {
    if (!filename) return;
    try {
        const replicationJournal = require('./replicationJournal');
        await replicationJournal.recordGallerySave(filename, {
            workspaceId: workspaceId || null,
            imagesDir: __runtimeGr ? __runtimeGr.getPath('images') : null
        });
    } catch (_err) {
        // Journal not initialized yet
    }
}

function sanitizeDynamicGenerationForForge(dg) {
    if (dg === undefined || dg === null) return dg;
    const dgForForge = { ...dg };
    delete dgForForge.novel_segment;
    delete dgForForge.novel_note_id;
    delete dgForForge.novel_story_cursor_line;
    delete dgForForge.novel_resume_advancement;
    return dgForForge;
}

async function encodeStepPreviewJpeg(imageBuffer, previewWidth, previewHeight) {
    let pipeline = sharp(imageBuffer);
    const w = Number(previewWidth);
    const h = Number(previewHeight);
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
        pipeline = pipeline.resize(Math.round(w), Math.round(h), {
            fit: 'inside',
            withoutEnlargement: true
        });
    }
    return pipeline.jpeg({ quality: 72 }).toBuffer();
}

function isLastPipelineStage(opts) {
    const total = Number(opts?.totalStages);
    if (!Number.isFinite(total) || total <= 1) return true;
    if (opts.stageIndex === undefined || opts.stageIndex === null) return true;
    return (Number(opts.stageIndex) + 1) >= total;
}

function attachStageProgressFields(progressData, opts) {
    if (!progressData || !opts) return progressData;
    if (opts.stageIndex !== undefined) {
        progressData.totalStages = opts.totalStages;
        progressData.currentStage = opts.stageIndex + 1;
        progressData.stageType = opts.stageType;
    }
    return progressData;
}

function sendStageOrGenerationComplete(ws, handler, opts, extra = {}) {
    if (!ws || !handler) return;
    const progressData = {
        phase: isLastPipelineStage(opts) ? 'complete' : 'stage_complete',
        hasDynamicGen: !!opts.dynamic_generation,
        isUpscaling: extra.isUpscaling === true,
        ...extra
    };
    attachStageProgressFields(progressData, opts);
    handler.sendGenerationProgress(ws, opts.requestId || 'generation', progressData);
}

function mergeNovelForgeFieldsFromOpts(forgeData, opts) {
    if (!forgeData || !opts) return;
    if (opts.novel_note_id !== undefined) forgeData.novel_note_id = opts.novel_note_id;
    if (opts.novel_story_cursor_line !== undefined) forgeData.novel_story_cursor_line = opts.novel_story_cursor_line;
    if (opts.enhance_scale !== undefined) {
        forgeData.generation_type = 'enhanced';
        forgeData.enhance_scale = opts.enhance_scale;
        forgeData.enhance_source = opts.enhance_source;
        forgeData.img2img_strength = opts.strength;
        forgeData.img2img_noise = opts.noise;
    }
    if (opts.upscaled_enhance === true) {
        forgeData.generation_type = 'max_enhance';
        forgeData.max_enhance = true;
        if (opts.max_enhance_source) forgeData.max_enhance_source = opts.max_enhance_source;
    }
    if (opts.dynamic_generation !== undefined) {
        forgeData.dynamic_generation = sanitizeDynamicGenerationForForge(opts.dynamic_generation);
        if (opts.dynamic_generation?.compiled_prompt?.generated_image_name) {
            forgeData.generated_image_name = opts.dynamic_generation.compiled_prompt.generated_image_name;
        }
    }
}

// Import modules
const { expandShorthandTags, cleanupPromptSyntax, applyDynamicReplacements, generatePromptHash, generateRequestHash, generateDirectiveHash, processDynamicGenerationCore, calculateDynamicExpiration, compileContext, formatContextForCarousel } = require('./dynamicGenerationHandlers');
const { buildPromptApplicationContext, mapProcessedToRaw } = require('./promptApplicationContext');

const { 
    getImageDimensions, 
    getDimensionsFromResolution, 
    processDynamicImage,
    processDynamicImageLetterbox,
    resizeMaskWithCanvas,
    dimensionsMaxUnderArea
} = require('./imageTools');
const { generateMobilePreviews } = require('./previewUtils');
const { encodeBlurhashFromBuffer } = require('./blurhashUtils');
const { upscaleImageCore, resolveUpscaleRatio } = require('./imageUpscaling');

async function ensureForgeDataBlurhash(forgeData, imageBuffer) {
    if (!forgeData || forgeData.blurhash || !imageBuffer) return forgeData;
    const hash = await encodeBlurhashFromBuffer(imageBuffer);
    if (hash) forgeData.blurhash = hash;
    return forgeData;
}

async function storePreviewBlurhash(globalResources, filename, previewResult) {
    const hash = previewResult?.blurhash;
    if (!hash || !filename || !globalResources?.getMetadataDatabase) return;
    // modules/metadataDatabase.js — setImageBlurhash
    await globalResources.getMetadataDatabase().setImageBlurhash(filename, hash);
}

/**
 * Normalizes legacy period keys to new period key names
 * @param {string} periodKey - The period key to normalize
 * @returns {string} - Normalized period key
 */
function normalizePeriodKey(periodKey) {
    if (!periodKey || typeof periodKey !== 'string') {
        return periodKey;
    }
    
    const normalized = periodKey.toLowerCase().trim();
    
    // Legacy to new mappings
    const legacyMappings = {
        'earlymorning': 'morning',
        'early_morning': 'morning',
        'earlyevening': 'evening', // Keep as evening, not night
        'early_evening': 'evening',
        // 'evening' is now a valid period name (used for cloudy afternoon golden hour), don't map to 'night'
        'lateevening': 'night',
        'late_evening': 'night'
    };
    
    return legacyMappings[normalized] || normalized;
}

/**
 * Calculate stage hex IDs from stage data array
 * Format: [Chain][Stage] where:
 * - Chain: 0 for main pipeline, A-F for branches
 * - Stage: 0-F incremental within each chain
 * 
 * @param {Array} stagesData - Array of stage data objects
 * @returns {Array} Array of hex IDs corresponding to each stage
 */
function calculateStageHexIdsFromData(stagesData) {
    if (!stagesData || !Array.isArray(stagesData)) return [];
    
    let mainStageCounter = 0;
    const branchChains = ['A', 'B', 'C', 'D', 'E', 'F'];
    let nextBranchIndex = 0;
    let inBranch = false;
    let currentChain = '0';
    let currentChainCounter = 0;
    
    return stagesData.map((stageData, index) => {
        const isBranch = stageData.branch === true;
        
        if (isBranch) {
            if (!inBranch) {
                // Entering a new branch
                currentChain = branchChains[nextBranchIndex] || 'F';
                nextBranchIndex++;
                currentChainCounter = 0;
                inBranch = true;
            } else {
                // Continue in branch
                currentChainCounter++;
            }
        } else {
            if (inBranch) {
                // Exiting branch
                currentChain = '0';
                mainStageCounter++; // Increment first
                currentChainCounter = mainStageCounter;
                inBranch = false;
            } else {
                // Continue in main pipeline
                mainStageCounter++; // Increment first
                currentChainCounter = mainStageCounter;
            }
        }
        
        const stageNum = currentChainCounter.toString(16).toUpperCase();
        return currentChain + stageNum;
    });
}

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
    if (currentHour >= 7 && currentHour < 11) return 'morning';  // Merged earlymorning into morning
    if (currentHour >= 11 && currentHour < 12) return 'latemorning';
    if (currentHour >= 12 && currentHour < 16) return 'afternoon';
    if (currentHour >= 16 && currentHour < 18) return 'goldenhour';
    if (currentHour >= 18 && currentHour < 19) return 'sunset';
    if (currentHour >= 19 && currentHour < 20) return 'dusk';
    if (currentHour >= 20 || currentHour < 2) return 'night';  // Merged earlyevening, evening, lateevening into night
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
    
    // Track what modifications were made
    const modifications = { prompt: [], uc: [], character_prompts: [], character_uc: [] };

    // Helper function to add text to end of prompt (before ", Text:" if it exists)
    function addToPrompt(text, addition) {
        if (!addition) return text;
        if (!text) return addition;

        const { tagsPart, index } = splitPromptAtTextColon(text);
        if (index !== -1) {
            const processedTags = tagsPart ? `${tagsPart}, ${addition}` : addition;
            return processedTags + ', Text:' + text.substring(index + 5);
        }
        return `${text}, ${addition}`;
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
        // Note: Preserve newlines, only normalize spaces and tabs
        result = result
            .replace(/,\s*,+/g, ',')           // Multiple commas become single comma
            .replace(/^,\s*/, '')              // Remove leading comma
            .replace(/,\s*$/, '')              // Remove trailing comma
            .replace(/[ \t]+/g, ' ')           // Normalize multiple spaces/tabs (preserve newlines)
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

        // Apply suffix additions only (*_prefix applied later, after UC preset — see applyNsfwPrefixes)
        if (nsfwPreset.add) {
            const add = nsfwPreset.add;

            if (add.base) {
                const addedText = applyBiasToText(add.base, nsfwBias);
                processedPrompt = addToPrompt(processedPrompt, addedText);
                modifications.prompt.push(addedText);
            }
            if (add.uc) {
                const addedText = applyBiasToText(add.uc, nsfwBias);
                processedNegativePrompt = addToPrompt(processedNegativePrompt, addedText);
                modifications.uc.push(addedText);
            }
            if (add.chara_base) {
                const addedText = applyBiasToText(add.chara_base, nsfwBias);
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    prompt: addToPrompt(char.prompt, addedText)
                }));
                modifications.character_prompts.push(addedText);
            }
            if (add.chara_uc) {
                const addedText = applyBiasToText(add.chara_uc, nsfwBias);
                processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                    ...char,
                    uc: addToPrompt(char.uc, addedText)
                }));
                modifications.character_uc.push(addedText);
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
                const addedText1 = applyBiasToText('nsfw', nsfwBias);
                processedPrompt = addToPrompt(processedPrompt, addedText1);
                modifications.prompt.push(addedText1);
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
                const addedTextUc1 = applyBiasToText('nsfw', nsfwBias);
                processedNegativePrompt = addToPrompt(processedNegativePrompt, addedTextUc1);
                modifications.uc.push(addedTextUc1);
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
                const addedText3 = applyBiasToText('nsfw', nsfwBias);
                processedPrompt = addToPrompt(processedPrompt, addedText3);
                modifications.prompt.push(addedText3);
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
                const addedText2 = applyBiasToText('nsfw', nsfwBias);
                processedPrompt = addToPrompt(processedPrompt, addedText2);
                modifications.prompt.push(addedText2);
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
                const addedTextN2 = applyBiasToText('nsfw', nsfwBias);
                processedPrompt = addToPrompt(processedPrompt, addedTextN2);
                modifications.prompt.push(addedTextN2);
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

    return { processedPrompt, processedNegativePrompt, processedCharacterPrompts, modifications };
}

/**
 * Apply NSFW *_prefix additions after UC/quality/dataset assembly so prefixes stay at the front.
 * Companion to applyNsfwProcessing (which handles remove + suffix adds earlier).
 */
function applyNsfwPrefixes(prompt, negativePrompt, characterPrompts, nsfwValue, nsfwBias, promptConfig) {
    let processedPrompt = prompt;
    let processedNegativePrompt = negativePrompt;
    let processedCharacterPrompts = characterPrompts ? [...characterPrompts] : [];
    const modifications = { prompt: [], uc: [], character_prompts: [], character_uc: [] };

    function prependToPrompt(text, addition) {
        if (!addition) return text;
        if (!text) return addition;
        return `${addition}, ${text}`;
    }

    const nsfwPreset = promptConfig?.nsfw_presets?.[nsfwValue.toString()];
    const add = nsfwPreset?.add;
    if (!add) {
        return { processedPrompt, processedNegativePrompt, processedCharacterPrompts, modifications };
    }

    if (add.base_prefix) {
        const addedText = applyBiasToText(add.base_prefix, nsfwBias);
        processedPrompt = prependToPrompt(processedPrompt, addedText);
        modifications.prompt.push(addedText);
    }
    if (add.uc_prefix) {
        const addedText = applyBiasToText(add.uc_prefix, nsfwBias);
        processedNegativePrompt = prependToPrompt(processedNegativePrompt, addedText);
        modifications.uc.push(addedText);
    }
    if (add.chara_base_prefix) {
        const addedText = applyBiasToText(add.chara_base_prefix, nsfwBias);
        processedCharacterPrompts = processedCharacterPrompts.map(char => ({
            ...char,
            prompt: prependToPrompt(char.prompt, addedText)
        }));
        modifications.character_prompts.push(addedText);
    }
    if (add.chara_uc_prefix) {
        const addedText = applyBiasToText(add.chara_uc_prefix, nsfwBias);
        processedCharacterPrompts = processedCharacterPrompts.map(char => ({
            ...char,
            uc: prependToPrompt(char.uc, addedText)
        }));
        modifications.character_uc.push(addedText);
    }

    return { processedPrompt, processedNegativePrompt, processedCharacterPrompts, modifications };
}

/**
 * Apply bias to text with inner numeric emphasis
 * @param {string} input - The text to apply bias to
 * @param {number} bias - The bias value to apply
 * @returns {string} The text with bias applied to inner emphasis and wrapped with main bias
 */
function applyBiasToText(input, bias) {
    if (bias === 1.0 || bias === undefined) {
        return input;
    }

    // Do not nest classic N:: around managed ZWSP groups (expand happens elsewhere).
    const { hasManagedEmphasisGroupIds } = require('./emphasisGroupIdSyntax');
    if (typeof input === 'string' && hasManagedEmphasisGroupIds(input)) {
        return input;
    }

    // Check if input is already a complete emphasis group (starts with BIAS:: and ends with ::)
    const isCompleteGroup = /^(-?\d+\.?\d*)::.+::$/s.test(input);
    
    // Check if input contains any bias groups
    const hasBiasGroups = /(-?\d+\.?\d*)::/g.test(input);

    if (isCompleteGroup) {
        // Input is already wrapped - add or subtract based on bias value
        let result = input.replace(/(-?\d+\.?\d*)::/g, (match, biasValue) => {
            const currentBias = parseFloat(biasValue);
            let newBias;
            
            if (bias >= 1.0) {
                // Increase emphasis - add the bias value
                newBias = currentBias + bias;
            } else {
                // Decrease emphasis
                const difference = 1.0 - bias;
                if (currentBias < 0) {
                    // For negative emphasis, add to make less negative
                    newBias = currentBias + difference;
                } else {
                    // For positive emphasis, subtract to reduce
                    newBias = currentBias - difference;
                }
            }
            
            const rounded = Math.round(newBias * 10) / 10; // Round to 1 decimal place
            return `${rounded.toFixed(1)}::`;
        });
        return result;
    } else if (hasBiasGroups) {
        // Input has bias groups but not wrapped - add/subtract adjustment and wrap
        const biasAdjustment = bias - 1.0;
        let result = input.replace(/(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::).)*?)::(?=(?:[^:]|$))/g, (match, innerBias, content) => {
            const innerBiasValue = parseFloat(innerBias);
            const newInnerBias = innerBiasValue + biasAdjustment;
            const rounded = Math.round(newInnerBias * 10) / 10;
            
            return `${rounded.toFixed(1)}::${content}, ${bias}::`;
        });
        return `${bias}::${result}::`;
    } else {
        // No bias groups - wrap the entire input
        return `${bias}::${input}::`;
    }
}

/**
 * Force every NAI numeric emphasis prefix in inline prompt-negative to a negative weight (1 decimal).
 * Positive and already-negative values use absolute magnitude, then apply a negative sign.
 */
function ensureNegativeEmphasisPrefixes(input) {
    if (!input || typeof input !== 'string') return input;
    return input.replace(/(-?\d+\.?\d*)::/g, (match, num) => {
        const v = parseFloat(num);
        let abs = Math.abs(Math.round(v * 10) / 10);
        if (abs === 0) abs = 1.0;
        return `-${abs.toFixed(1)}::`;
    });
}

/**
 * True when phrase is a complete NAI weight group (leading N:: ... ::).
 */
function isCompleteWeightGroupPhrase(phrase) {
    return /^-?[\d]+(?:\.\d*)?::[\s\S]+::$/.test((phrase || '').trim());
}

/**
 * Build merged inline prompt-negative block: each comma-separated phrase is handled
 * independently — plain text gets -1::...::, weight groups keep structure with negative weights.
 */
function buildPromptNegativeBlock(processedFragment) {
    const frag = (processedFragment || '').trim();
    if (!frag) return null;

    const phrases = splitUCPhrases(frag);
    if (phrases.length === 0) return null;

    const blocks = [];
    for (const phrase of phrases) {
        const trimmed = phrase.trim();
        if (!trimmed) continue;
        if (isCompleteWeightGroupPhrase(trimmed)) {
            blocks.push(ensureNegativeEmphasisPrefixes(trimmed));
        } else {
            blocks.push(`-1::${ensureNegativeEmphasisPrefixes(trimmed)}::`);
        }
    }

    if (blocks.length === 0) return null;
    return blocks.join(', ');
}

function getCharacterInputPromptNegative(char) {
    if (!char || typeof char !== 'object') return '';
    return char.input_prompt_negative ?? char.prompt_negative ?? '';
}

function ensurePromptNegativeBlockMerged(prompt, block) {
    if (!block) return prompt || '';
    const base = prompt || '';
    if (base.includes(block)) return base;
    return mergePromptNegativeFragmentIntoPrompt(base, block);
}

/** Merge inline prompt-negative fragments into positive prompts (idempotent). */
function applyAllInputPromptNegativeMerges(processedPrompt, processedPromptNegativeFragment, processedCharacterPrompts) {
    let prompt = processedPrompt;
    const baseBlock = buildPromptNegativeBlock(processedPromptNegativeFragment);
    if (baseBlock) {
        prompt = ensurePromptNegativeBlockMerged(prompt, baseBlock);
    }

    let chars = processedCharacterPrompts;
    if (Array.isArray(chars)) {
        chars = chars.map((char) => {
            const block = buildPromptNegativeBlock(getCharacterInputPromptNegative(char));
            if (!block) return char;
            return {
                ...char,
                prompt: ensurePromptNegativeBlockMerged(char.prompt || '', block)
            };
        });
    }

    return { processedPrompt: prompt, processedCharacterPrompts: chars };
}

/**
 * Merge processed inline negative fragment into positive prompt before first `Text:` (same boundary rules as quality preset).
 */
function mergePromptNegativeFragmentIntoPrompt(processedPrompt, addition) {
    const block = (addition || '').trim();
    if (!block) return processedPrompt;
    return insertBeforeTextColonOrFirstGroup(processedPrompt, block);
}

// Dynamic Generation Processing - Uses pre-compiled AI prompts from client

// Function to convert character reference to base64 JPG with max edge 1500px
function normalizeCharaReferenceSources(source) {
    if (source == null) return [];
    if (Array.isArray(source)) {
        return source.filter(item => typeof item === 'string' && item.includes(':'));
    }
    if (typeof source === 'string' && source.includes(':')) {
        return [source];
    }
    return [];
}

function getCharaReferenceBaseCaption(refType, legacyWithStyle) {
    const type = Number(refType);
    if (type === 2) return 'character';
    if (type === 3) return 'style';
    if (type === 1) return 'character&style';
    return legacyWithStyle ? 'character&style' : 'character';
}

async function convertCharacterReferenceToBase64(charaReference) {
    try {
        if (!charaReference || typeof charaReference !== 'string') return null;

        const [type, identifier] = charaReference.split(':', 2);
        if (!type || !identifier) return null;

        let imageBuffer;

        switch (type) {
            case 'cache':
                const cachedImagePath = path.join(__runtimeGr.getPath('uploadCache'), identifier);
                if (!fs.existsSync(cachedImagePath)) {
                    console.warn(`⚠️ Character reference cache image not found: ${identifier}`);
                    return null;
                }
                imageBuffer = fs.readFileSync(cachedImagePath);
                break;
            case 'file':
                const filePath = path.join(__runtimeGr.getPath('images'), identifier);
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
        imageBuffer = __runtimeGr.getPngMetadata().stripPngTextChunks(imageBuffer);

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

// Ensure preset source cache directory exists (called when needed, not at module load)
function ensurePresetSourceCacheDir() {
    try {
        const presetSourceCacheDir = __runtimeGr.getPath('presetSourceCache');
        if (!fs.existsSync(presetSourceCacheDir)) {
            fs.mkdirSync(presetSourceCacheDir, { recursive: true });
        }
    } catch (error) {
        console.warn(`⚠️ Failed to create preset source cache directory: ${error.message}`);
    }
}

// Function to generate preset source image
async function generatePresetSourceImage(globalResources, presetName, seed, resolution, model) {
    bindRuntimeGlobalResources(globalResources);
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
        currentPromptConfig = __runtimeGr.getPromptConfig();
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
    const presetSourceCacheDir = __runtimeGr.getPath('presetSourceCache');
    const cachePath = path.join(presetSourceCacheDir, cacheFilename);
    
    // Ensure cache directory exists
    try {
        ensurePresetSourceCacheDir();
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
        if (resolution.toLowerCase().startsWith('xlarge_')) {
            // Handle xlarge resolutions by converting to custom dimensions
            const dims = getDimensionsFromResolution(resolution.toLowerCase());
            if (dims && dims.width && dims.height) {
                presetOptions.width = dims.width;
                presetOptions.height = dims.height;
            } else {
                throw new Error(`Failed to get dimensions for xlarge resolution: ${resolution}`);
            }
        } else if (__runtimeGr.getNekoAiService('Resolution')[resolution.toUpperCase()]) {
            presetOptions.resPreset = __runtimeGr.getNekoAiService('Resolution')[resolution.toUpperCase()];
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
        opts = await buildOptions(globalResources, presetOptions, null, {}, null, null);
    } catch (error) {
        throw new Error(`Failed to build options for preset "${presetName}": ${error.message}`);
    }

    // Generate the preset image
    let result;
    try {
        result = await handleGeneration(globalResources, opts, true, presetName);
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
const PRESET_TABLE_MODEL_FALLBACKS = {
    v5: ['v4_5', 'v4_5_cur', 'v4'],
    v5_cur: ['v4_5_cur', 'v4_5', 'v4_cur', 'v4'],
    v4_5: ['v4_5_cur', 'v4'],
    v4_5_cur: ['v4_5', 'v4_cur'],
    v4: ['v4_cur', 'v4_5'],
    v4_cur: ['v4', 'v4_5_cur']
};

function resolvePresetModelKey(presetConfig, modelKey) {
    if (!presetConfig || !modelKey) return null;
    const key = String(modelKey).toLowerCase();
    if (presetConfig[key] != null) return key;
    const fallbacks = PRESET_TABLE_MODEL_FALLBACKS[key] || [];
    for (let i = 0; i < fallbacks.length; i++) {
        if (presetConfig[fallbacks[i]] != null) return fallbacks[i];
    }
    return null;
}

function selectPresetItem(presetConfig, modelKey, combinedPrompt, providedId = null) {
    const resolvedKey = resolvePresetModelKey(presetConfig, modelKey);
    if (!resolvedKey) {
        return null;
    }
    
    const modelPresets = presetConfig[resolvedKey];
    
    // Handle simple string/array format (backward compatibility)
    if (typeof modelPresets === 'string' || (Array.isArray(modelPresets) && typeof modelPresets[0] === 'string')) {
        if (typeof modelPresets === 'string') {
            return { value: modelPresets, id: 'default' };
        } else {
            const index = Math.max(providedId - 1, 0);
            if (index >= modelPresets.length || !modelPresets[index]) {
                return null;
            }
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

// Function to strip emphasis syntax from a phrase to get the core text
function stripEmphasisSyntax(text) {
    if (!text) return '';
    
    let stripped = text.trim();
    // stripManagedEmphasisDelimitersForCounting: modules/emphasisGroupIdSyntax.js
    try {
        const { stripManagedEmphasisDelimitersForCounting } = require('./emphasisGroupIdSyntax');
        stripped = stripManagedEmphasisDelimitersForCounting(stripped).trim();
    } catch (_) { /* codec optional during boot races */ }

    let previousStripped = '';
    let iterations = 0;
    const maxIterations = 20; // Prevent infinite loops
    
    // Keep stripping layers until no more changes occur (handles nested emphasis)
    while (stripped !== previousStripped && iterations < maxIterations) {
        previousStripped = stripped;
        iterations++;
        
        // Strip weight group notation: weight::text:: or -weight::text::
        // Match patterns like "3.0::text::" or "-2::text::"
        const weightGroupMatch = stripped.match(/^-?[\d.]+::(.*?)::$/);
        if (weightGroupMatch) {
            stripped = weightGroupMatch[1].trim();
        }
        
        // Strip weight notation in brackets: (text:1.2) or {text:1.1} or [text:0.9]
        stripped = stripped.replace(/^[\{\[\(]+([^:\{\[\(\)\]\}]+):[\d.]+[\}\]\)]+$/g, '$1');
        
        // Strip curly braces: {text}, {{text}}, etc. (one layer at a time)
        if (stripped.startsWith('{') && stripped.endsWith('}')) {
            stripped = stripped.replace(/^\{+/, '').replace(/\}+$/, '').trim();
        }
        
        // Strip square brackets: [text], [[text]], etc. (one layer at a time)
        if (stripped.startsWith('[') && stripped.endsWith(']')) {
            stripped = stripped.replace(/^\[+/, '').replace(/\]+$/, '').trim();
        }
        
        // Strip parentheses: (text) (one layer at a time)
        if (stripped.startsWith('(') && stripped.endsWith(')')) {
            stripped = stripped.replace(/^\(+/, '').replace(/\)+$/, '').trim();
        }
    }
    
    return stripped.trim();
}

// Helper function to split text by commas while respecting bracket depth
function splitByCommaRespectingBrackets(text) {
    if (!text) return [];
    
    const items = [];
    let currentItem = '';
    let depth = 0;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        // Track bracket depth
        if (char === '{' || char === '[' || char === '(') {
            depth++;
            currentItem += char;
        } else if (char === '}' || char === ']' || char === ')') {
            depth--;
            currentItem += char;
        } else if (char === ',' && depth === 0) {
            // Found a separator comma (not inside brackets)
            if (currentItem.trim()) {
                items.push(currentItem.trim());
            }
            currentItem = '';
        } else {
            currentItem += char;
        }
    }
    
    // Add the last item
    if (currentItem.trim()) {
        items.push(currentItem.trim());
    }
    
    return items;
}

// Function to split UC prompt by commas while respecting emphasis syntax
function splitUCPhrases(ucPrompt) {
    const phrases = [];
    let currentPhrase = '';
    let insideWeightGroup = false;
    let depth = 0;
    
    for (let i = 0; i < ucPrompt.length; i++) {
        const char = ucPrompt[i];
        const nextChar = ucPrompt[i + 1];
        
        // Check for :: delimiter (weight group start/end)
        if (char === ':' && nextChar === ':') {
            currentPhrase += '::';
            i++; // Skip next colon
            
            // Toggle weight group state
            if (!insideWeightGroup) {
                insideWeightGroup = true;
            } else {
                insideWeightGroup = false;
            }
            continue;
        }
        
        // Track bracket depth
        if (char === '{' || char === '[') {
            depth++;
            currentPhrase += char;
        } else if (char === '}' || char === ']') {
            depth--;
            currentPhrase += char;
        } else if (char === ',' && !insideWeightGroup && depth === 0) {
            // Found a separator comma (not inside weight group or brackets)
            if (currentPhrase.trim()) {
                phrases.push(currentPhrase.trim());
            }
            currentPhrase = '';
        } else {
            currentPhrase += char;
        }
    }
    
    // Add the last phrase
    if (currentPhrase.trim()) {
        phrases.push(currentPhrase.trim());
    }
    
    return phrases;
}

// Helper function to check if a phrase appears as a complete standalone phrase in the prompt
// Splits prompt into phrases and compares them exactly (not as substrings)
function phraseExistsInPrompt(prompt, ucPhrase) {
    if (!prompt || !ucPhrase) return false;
    
    const normalizedUcPhrase = ucPhrase.toLowerCase().trim();
    if (!normalizedUcPhrase) return false;
    
    // Split the prompt into phrases the same way we split UC
    const promptPhrases = splitUCPhrases(prompt);
    
    // Check each prompt phrase
    for (const promptPhrase of promptPhrases) {
        if (!promptPhrase) continue;
        
        // Handle weight groups in the prompt
        const weightGroupMatch = promptPhrase.match(/^(-?[\d.]+)::(.*?)::$/);
        if (weightGroupMatch && weightGroupMatch[2] !== undefined) {
            const weight = parseFloat(weightGroupMatch[1]);
            
            // Skip negative weight groups - they're reducing elements, not adding them
            // So they don't count as "having the phrase in the prompt"
            if (weight < 0) {
                continue;
            }
            
            // Split items within the weight group
            const items = splitByCommaRespectingBrackets(weightGroupMatch[2]);
            for (const item of items) {
                if (!item) continue;
                const strippedItem = stripEmphasisSyntax(item);
                if (strippedItem && strippedItem.toLowerCase().trim() === normalizedUcPhrase) {
                    return true;
                }
            }
        } else {
            // Regular phrase - strip and compare
            const strippedPhrase = stripEmphasisSyntax(promptPhrase);
            if (strippedPhrase && strippedPhrase.toLowerCase().trim() === normalizedUcPhrase) {
                return true;
            }
        }
    }
    
    return false;
}

// Function to auto-clean UC prompts by removing comma-separated phrases that appear in the main prompt
function autoCleanUCPrompt(prompt, ucPrompt) {
    if (!prompt || !ucPrompt) {
        return ucPrompt;
    }
    
    // Split UC by commas while respecting emphasis syntax
    const ucPhrases = splitUCPhrases(ucPrompt);
    const cleanedPhrases = [];
    const removedPhrases = [];

    for (const phrase of ucPhrases) {
        if (!phrase) continue; // Skip empty phrases
        
        // Check if this is a weight group with potential multiple items
        const weightGroupMatch = phrase.match(/^(-?[\d.]+)::(.*?)::$/);
        if (weightGroupMatch) {
            // This is a weight group like "3.0::item1, item2, item3::"
            const weight = parseFloat(weightGroupMatch[1]);
            const content = weightGroupMatch[2];
            
            // If this is a negative weight group (like -1:: or -2::), keep it entirely
            // Negative UC weights actually BOOST elements, so they work with the prompt
            if (weight < 0) {
                cleanedPhrases.push(phrase);
                continue;
            }
            
            // Split the content by commas while respecting inner bracket groups
            const items = splitByCommaRespectingBrackets(content);
            const keptItems = [];
            const removedItems = [];
            
            for (const item of items) {
                // Strip any remaining emphasis from individual items
                const strippedItem = stripEmphasisSyntax(item);
                
                if (strippedItem && phraseExistsInPrompt(prompt, strippedItem)) {
                    removedItems.push(item);
                } else {
                    keptItems.push(item);
                }
            }
            
            // If all items were removed, remove the entire group
            if (keptItems.length === 0) {
                removedPhrases.push(phrase);
            } 
            // If some items were removed, reconstruct the group with remaining items
            else if (removedItems.length > 0) {
                const reconstructedPhrase = `${weightGroupMatch[1]}::${keptItems.join(', ')}::`;
                cleanedPhrases.push(reconstructedPhrase);
                // Log which items were removed from the group
                removedItems.forEach(item => {
                    removedPhrases.push(`${weightGroupMatch[1]}::${item}:: (from group)`);
                });
            }
            // No items were removed, keep the original phrase
            else {
                cleanedPhrases.push(phrase);
            }
        } else {
            // Regular phrase without weight group
            const coreText = stripEmphasisSyntax(phrase);
            
            // Check if the core text appears as a complete phrase in the main prompt
            if (coreText && phraseExistsInPrompt(prompt, coreText)) {
                removedPhrases.push(phrase);
            } else {
                cleanedPhrases.push(phrase);
            }
        }
    }

    // Log what was removed if anything was cleaned
    if (removedPhrases.length > 0) {
        __runtimeGr.getLogger().detailed(`🧹 Auto-cleaned UC: Removed ${removedPhrases.length} phrase(s)`);
        if (__runtimeGr.getLogger().shouldLog(__runtimeGr.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
            removedPhrases.forEach(phrase => {
                const coreText = stripEmphasisSyntax(phrase);
                console.log(`   - "${phrase}" (core: "${coreText}")`);
            });
        }
    }

    // Join the cleaned phrases back together
    return cleanedPhrases.join(', ');
}


/**
 * Apply cached text replacements to prompts
 * @returns {object} Result with success flag and processed prompts
 */
const applyCachedTextReplacements = (compiledPrompt, processedPrompt, processedNegativePrompt, processedCharacterPrompts) => {
    if (!compiledPrompt.text_replacements) return { success: true, processedPrompt, processedNegativePrompt, processedCharacterPrompts };
    
    const originalPrompt = processedPrompt + '';
    const originalNegativePrompt = processedNegativePrompt + '';
    const originalCharacterPrompts = processedCharacterPrompts ? processedCharacterPrompts.map(char => ({ ...char })) : [];
    
    try {
        // Apply replacements to prompt
        if (compiledPrompt.text_replacements.prompt?.length > 0) {
            const result = applyDynamicReplacements(__runtimeGr, processedPrompt, compiledPrompt.text_replacements, 'prompt');
            if (!result.success) throw new Error(`Failed: ${result.failedReplacements.join(', ')}`);
            processedPrompt = result.result;
        }
        
        // Apply replacements to negative prompt
        if (compiledPrompt.text_replacements.uc?.length > 0) {
            const result = applyDynamicReplacements(__runtimeGr, processedNegativePrompt, compiledPrompt.text_replacements, 'uc');
            if (!result.success) throw new Error(`Failed: ${result.failedReplacements.join(', ')}`);
            processedNegativePrompt = result.result;
        }
        
        // Apply replacements to character prompts
        if (processedCharacterPrompts?.length > 0 && compiledPrompt.text_replacements.character_prompts) {
            processedCharacterPrompts = processedCharacterPrompts.map((char, index) => {
                const charReplacements = compiledPrompt.text_replacements.character_prompts[index];
                if (!charReplacements) return char;
                let updatedChar = { ...char };
                
                if (charReplacements.prompt?.length > 0) {
                    const result = applyDynamicReplacements(__runtimeGr, char.prompt || '', compiledPrompt.text_replacements, 'character', index, 'prompt');
                    if (!result.success) throw new Error(`Failed character ${index} prompt`);
                    updatedChar.prompt = result.result;
                }
                
                if (charReplacements.uc?.length > 0) {
                    const result = applyDynamicReplacements(__runtimeGr, char.uc || '', compiledPrompt.text_replacements, 'character', index, 'uc');
                    if (!result.success) throw new Error(`Failed character ${index} UC`);
                    updatedChar.uc = result.result;
                }
                
                return updatedChar;
            });
        }
        
        // Apply character names
        if (compiledPrompt.character_names?.length > 0) {
            processedCharacterPrompts = processedCharacterPrompts || [];
            compiledPrompt.character_names.forEach((name, index) => {
                if (name && processedCharacterPrompts[index]) {
                    processedCharacterPrompts[index].chara_name = name;
                    processedCharacterPrompts[index].name = name;
                }
            });
        }
        
        return { success: true, processedPrompt, processedNegativePrompt, processedCharacterPrompts };
    } catch (error) {
        return { success: false, processedPrompt: originalPrompt, processedNegativePrompt: originalNegativePrompt, processedCharacterPrompts: originalCharacterPrompts, error };
    }
};

function stashPromptApplicationBaseline(body, preset, data) {
    const markerRegex = new RegExp(`\\s*,?\\s*${data.APPEND_MARKER}\\s*,?\\s*`, 'g');
    const stripAppendMarker = (text) => {
        if (typeof text !== 'string') return text;
        return text
            .replace(markerRegex, ', ')
            .replace(/,\s*,+/g, ', ')
            .replace(/^,\s*|\s*,$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    };

    const {
        rawPrompt,
        rawNegativePrompt,
        rawInputPromptNegative,
        processedPrompt,
        processedNegativePrompt,
        processedCharacterPrompts,
        appliedPresetControls,
        allTextReplacementSeeds,
        processedPromptNegativeFragment
    } = data;

    const merged = applyAllInputPromptNegativeMerges(
        processedPrompt,
        processedPromptNegativeFragment,
        processedCharacterPrompts
    );
    const promptMerged = merged.processedPrompt;
    const charsMerged = merged.processedCharacterPrompts;

    const promptForAI = stripAppendMarker(promptMerged);
    const ucForAI = stripAppendMarker(processedNegativePrompt);
    const characterPromptsForAI = (charsMerged && Array.isArray(charsMerged))
        ? charsMerged.map(char => ({
            ...char,
            prompt: stripAppendMarker(char.prompt),
            uc: stripAppendMarker(char.uc)
        }))
        : [];

    body._promptApplicationBaseline = {
        rawPrompt,
        rawNegativePrompt,
        rawInputPromptNegative: rawInputPromptNegative || '',
        rawCharacterPrompts: (body.allCharacterPrompts || preset?.allCharacterPrompts || []).map(c => ({
            prompt: c.prompt || '',
            uc: c.uc || '',
            input_prompt_negative: c.input_prompt_negative || c.prompt_negative || ''
        })),
        promptForAI,
        ucForAI,
        characterPromptsForAI: characterPromptsForAI.map(c => ({
            prompt: c.prompt || '',
            uc: c.uc || ''
        })),
        appliedPresetControls,
        text_replacements_seed: allTextReplacementSeeds
    };
}

const buildOptions = async (globalResources, body, preset = null, queryParams = {}, ws = null, handler = null, wsServer = null, stageData = null) => {
    bindRuntimeGlobalResources(globalResources);
    const referenceMetadataDb = __runtimeGr.getReferenceMetadataDatabase();
    const allowPaid = body.allow_paid ? body.allow_paid : preset?.allow_paid;
    
    const currentPromptConfig = __runtimeGr.getPromptConfig({ clone: true });
    const presetName = preset ? Object.keys(currentPromptConfig.presets).find(key => currentPromptConfig.presets[key] === preset) : null;
    const rawPrompt = (body.prompt !== undefined && body.prompt !== null) ? body.prompt : preset?.prompt;
    const rawNegativePrompt = (body.uc !== undefined && body.uc !== null) ? body.uc : preset?.uc;
    const rawInputPromptNegative = (body.input_prompt_negative !== undefined && body.input_prompt_negative !== null)
        ? body.input_prompt_negative
        : (body.prompt_negative !== undefined && body.prompt_negative !== null ? body.prompt_negative : (preset?.input_prompt_negative ?? preset?.prompt_negative ?? ''));

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

    // Handle other query parameter overrides
    let stepsValue = queryParams?.steps !== undefined ? parseInt(queryParams?.steps) : body.steps || preset?.steps || 24;
    let guidanceValue = queryParams?.guidance !== undefined ? parseFloat(queryParams?.guidance) : body.guidance || preset?.guidance || 5.5;
    let rescaleValue = queryParams?.rescale !== undefined ? parseFloat(queryParams?.rescale) : body.rescale || preset?.rescale || 0.0;
    let resolutionValue = queryParams?.resolution !== undefined ? __runtimeGr.getNekoAiService('Resolution')[queryParams?.resolution?.toUpperCase()] : body.resolution || preset?.resolution;
    let seedValue = queryParams?.seed !== undefined ? parseInt(queryParams?.seed) : body.seed || preset?.seed;
    let varietyValue = queryParams?.variety !== undefined ? Boolean(queryParams?.variety) : body.variety || preset?.variety || false;
    
    try {
        // Get periodKey from dynamic generation context if available, otherwise current time
        let periodKey = body.dynamic_generation?.compiled_prompt?.context?.time?.periodKey || getCurrentPeriodKey();
        // Normalize legacy period keys (periodKey is already normalized from determineTimePeriod, but normalize here for safety)
        if (periodKey) {
            periodKey = normalizePeriodKey(periodKey);
        }

        // Handle locked text replacements if provided
        let lockedReplacements = null;
        if (body.text_replacements_seed && Array.isArray(body.text_replacements_seed)) {
            lockedReplacements = body.text_replacements_seed;
            __runtimeGr.getLogger().detailed(`🔒 Using ${lockedReplacements.length} locked text replacements`);
        } else if (preset?.text_replacements_seed && Array.isArray(preset.text_replacements_seed)) {
            lockedReplacements = preset.text_replacements_seed;
            __runtimeGr.getLogger().detailed(`🔒 Using ${lockedReplacements.length} locked text replacements from preset`);
        }

        // Create stageData for request body replacements (stub for stage 0 - base generation)
        // Use provided stageData or create default for base generation
        const currentStageData = {
            stageIndex: 0,
            stageType: 'base',
            text_replacements: body.text_replacements || [],
            pipelineStageGeneration: Array.isArray(body.pipeline) && body.pipeline.length > 0,
            ...(stageData || {})
        };

        let processedPromptResult = __runtimeGr.getTextReplacements().applyTextReplacements(rawPrompt, presetName, body.model, periodKey, lockedReplacements, currentStageData);
        let processedNegativePromptResult = __runtimeGr.getTextReplacements().applyTextReplacements(rawNegativePrompt, presetName, body.model, periodKey, lockedReplacements, currentStageData);
        let processedPromptNegativeFragmentResult = __runtimeGr.getTextReplacements().applyTextReplacements(
            rawInputPromptNegative || '',
            presetName,
            body.model,
            periodKey,
            lockedReplacements,
            currentStageData
        );

        // Initialize processed prompts and character prompts
        let processedPrompt = processedPromptResult.text;
        let processedNegativePrompt = processedNegativePromptResult.text;
        let processedCharacterPrompts = body.allCharacterPrompts || preset?.allCharacterPrompts || undefined;

        // Define marker for dynamic append-to-end operations (inserted before presets)
        const APPEND_MARKER = '__ENSHUTSUKA_APPEND_POINT__';
        
        // Add marker to prompt before "Text:" (any case) if it exists, otherwise at the end of the prompt
        processedPrompt = insertBeforeTextColonOrFirstGroup(processedPrompt, APPEND_MARKER);
        
        // Add marker to UC at the end
        processedNegativePrompt = processedNegativePrompt + (processedNegativePrompt ? ', ' : '') + APPEND_MARKER;
        
        // Add marker to character prompts at the end
        if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
            processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                ...char,
                prompt: (char.prompt || '') + (char.prompt ? ', ' : '') + APPEND_MARKER,
                uc: (char.uc || '') + (char.uc ? ', ' : '') + APPEND_MARKER
            }));
        }

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
            ...processedNegativePromptResult.replacements.map(r => ({ ...r, source: 'negative_prompt' })),
            ...processedPromptNegativeFragmentResult.replacements.map(r => ({ ...r, source: 'input_prompt_negative' }))
        ];

        if (allTextReplacementSeeds.length > 0) {
            console.log(`🔄 Text replacements: ${allTextReplacementSeeds.map(r => `${r.key}=${r.value}`).join(', ')}`);
        }

        // Process character prompts with text replacements
        let characterTextReplacementSeeds = [];
        if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
            processedCharacterPrompts = processedCharacterPrompts.map((char, charIndex) => {
                // Apply text replacements to character prompt, UC, and inline prompt-negative
                const processedPromptResult = __runtimeGr.getTextReplacements().applyTextReplacements(char.prompt, presetName, body.model, periodKey, lockedReplacements, currentStageData);
                const processedUCResult = __runtimeGr.getTextReplacements().applyTextReplacements(char.uc, presetName, body.model, periodKey, lockedReplacements, currentStageData);
                const processedCharPromptNegativeResult = __runtimeGr.getTextReplacements().applyTextReplacements(
                    getCharacterInputPromptNegative(char),
                    presetName,
                    body.model,
                    periodKey,
                    lockedReplacements,
                    currentStageData
                );

                // Collect replacement seeds with character index
                characterTextReplacementSeeds.push(
                    ...processedPromptResult.replacements.map(r => ({ ...r, source: `character_${charIndex}_prompt` })),
                    ...processedUCResult.replacements.map(r => ({ ...r, source: `character_${charIndex}_uc` })),
                    ...processedCharPromptNegativeResult.replacements.map(r => ({ ...r, source: `character_${charIndex}_input_prompt_negative` }))
                );

                return {
                    ...char,
                    prompt: processedPromptResult.text,
                    uc: processedUCResult.text,
                    input_prompt_negative: processedCharPromptNegativeResult.text
                };
            });

            // Add character replacements to main seed array
            allTextReplacementSeeds.push(...characterTextReplacementSeeds);

            if (characterTextReplacementSeeds.length > 0) {
                console.log(`🔄 Character prompt text replacements: ${characterTextReplacementSeeds.map(r => `${r.key}=${r.value}`).join(', ')}`);
            }
        }

        // Expand any shorthand tag sections to full keywords (always run for consistency)
        processedPrompt = expandShorthandTags(processedPrompt);
        processedNegativePrompt = expandShorthandTags(processedNegativePrompt);
        let processedPromptNegativeFragment = expandShorthandTags(processedPromptNegativeFragmentResult.text);

        if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
            processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                ...char,
                prompt: expandShorthandTags(char.prompt || ''),
                uc: expandShorthandTags(char.uc || ''),
                input_prompt_negative: expandShorthandTags(char.input_prompt_negative || '')
            }));
        }

        // Expand managed id delimiters → classic N:: before UC / inline-negative merge helpers
        // (those helpers only understand classic syntax). prepareEmphasisTextForNovelAI:
        //   modules/emphasisGroupIdSyntax.js
        {
            const { prepareEmphasisTextForNovelAI, hasManagedEmphasisGroupIds } = require('./emphasisGroupIdSyntax');
            const emphasisNormEarly = body.emphasis_normalization || null;
            const expandManagedEarly = (text, fieldHint) => {
                if (typeof text !== 'string' || !hasManagedEmphasisGroupIds(text)) return text;
                return prepareEmphasisTextForNovelAI(text, emphasisNormEarly, fieldHint).text;
            };
            processedPrompt = expandManagedEarly(processedPrompt, 'prompt');
            processedNegativePrompt = expandManagedEarly(processedNegativePrompt, 'uc');
            processedPromptNegativeFragment = expandManagedEarly(processedPromptNegativeFragment, 'prompt_negative');
            if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
                processedCharacterPrompts = processedCharacterPrompts.map((char, index) => {
                    if (!char || typeof char !== 'object') return char;
                    return {
                        ...char,
                        prompt: expandManagedEarly(char.prompt, `character_${index}`),
                        uc: expandManagedEarly(char.uc, `character_${index}_uc`),
                        input_prompt_negative: expandManagedEarly(
                            char.input_prompt_negative,
                            `character_${index}_prompt_negative`
                        )
                    };
                });
            }
        }

        // Apply Preset Controls
        //
        // Track preset controls applied - will be passed to dynamic generation
        const appliedPresetControls = { prompt: [], uc: [], character_prompts: [], character_uc: [] };
        
        // Process vibe append text injection for each vibe transfer (moved before baseOptions assignment)
        // Skip entirely when model-features gate vibeTransfer off (V5)
        const earlyVibeCaps = __runtimeGr.getModelFeatures(body.model);
        if (
            !(earlyVibeCaps && earlyVibeCaps.vibeTransfer === false) &&
            body.vibe_transfer &&
            Array.isArray(body.vibe_transfer) &&
            body.vibe_transfer.length > 0
        ) {
            for (const vibeTransfer of body.vibe_transfer) {
                try {
                    // Skip text injection if disabled for this vibe
                    if (vibeTransfer.inject_text === false) {
                        continue;
                    }

                    // Get reference metadata for this vibe
                    const vibeMetadata = referenceMetadataDb.getMetadata(vibeTransfer.id);

                    if (vibeMetadata) {
                        const vibePrependPrompt = !!vibeMetadata.vibe_prepend_prompt; // Ensure boolean
                        const vibePrependUc = !!vibeMetadata.vibe_prepend_uc; // Ensure boolean

                        // Inject prompt text if available
                        if (vibeMetadata.vibe_append_prompt && vibeMetadata.vibe_append_prompt.trim()) {
                            const vibePromptText = vibeMetadata.vibe_append_prompt.trim();

                            const commaText = matchCommaTextColon(processedPrompt);
                            if (commaText) {
                                const beforeText = processedPrompt.substring(0, commaText.index).trim();
                                processedPrompt = beforeText + ', ' + vibePromptText + ', Text:' + processedPrompt.substring(commaText.index + commaText.length);
                                console.log(`🎨 Injected vibe prompt text for ${vibeTransfer.id}`);
                            } else {
                                // Normal prepend/append logic
                                if (vibePrependPrompt) {
                                    processedPrompt = vibePromptText + ', ' + processedPrompt;
                                    console.log(`🎨 Prepended vibe prompt text for ${vibeTransfer.id}`);
                                } else {
                                    processedPrompt = processedPrompt + ', ' + vibePromptText;
                                    console.log(`🎨 Appended vibe prompt text for ${vibeTransfer.id}`);
                                }
                            }
                            
                            // Track this modification
                            appliedPresetControls.prompt.push({
                                action: 'vibe_text_injection',
                                text: vibePromptText
                            });
                        }

                        // Inject UC text if available
                        if (vibeMetadata.vibe_append_uc && vibeMetadata.vibe_append_uc.trim()) {
                            const vibeUcText = vibeMetadata.vibe_append_uc.trim();

                            // UC always prepends/appends (no ", Text:" logic)
                            if (vibePrependUc) {
                                processedNegativePrompt = vibeUcText + ', ' + processedNegativePrompt;
                                console.log(`🚫 Prepended vibe UC text for ${vibeTransfer.id}`);
                            } else {
                                processedNegativePrompt = processedNegativePrompt + ', ' + vibeUcText;
                                console.log(`🚫 Appended vibe UC text for ${vibeTransfer.id}`);
                            }
                            
                            // Track this modification
                            appliedPresetControls.uc.push({
                                action: 'vibe_text_injection',
                                text: vibeUcText
                            });
                        }
                    }
                } catch (error) {
                    console.warn(`⚠️ Failed to process vibe text injection for ${vibeTransfer.id}:`, error.message);
                }
            }
        }
        
        // Process NSFW settings from dataset_config
        const nsfwValue = body.dataset_config?.nsfw;
        const nsfwBias = body.dataset_config?.nsfw_bias || 1.0;

        if (nsfwValue !== undefined && nsfwValue !== 0) {
            let nsfwModifications = { prompt: [], uc: [], character_prompts: [], character_uc: [] };
            ({ processedPrompt, processedNegativePrompt, processedCharacterPrompts, modifications: nsfwModifications } = applyNsfwProcessing(
                processedPrompt,
                processedNegativePrompt,
                processedCharacterPrompts,
                nsfwValue,
                nsfwBias,
                currentPromptConfig
            ));
            
            // Track this modification with what was actually added/removed
            if (nsfwModifications.prompt.length > 0) {
                appliedPresetControls.prompt.push({
                    action: 'nsfw_processing',
                    bias: nsfwBias,
                    text: nsfwModifications.prompt.join(', ')
                });
            }
            if (nsfwModifications.uc.length > 0) {
                appliedPresetControls.uc.push({
                    action: 'nsfw_processing',
                    bias: nsfwBias,
                    text: nsfwModifications.uc.join(', ')
                });
            }
            if (nsfwModifications.character_prompts.length > 0) {
                appliedPresetControls.character_prompts.push({
                    action: 'nsfw_processing',
                    bias: nsfwBias,
                    text: nsfwModifications.character_prompts.join(', ')
                });
            }
            if (nsfwModifications.character_uc.length > 0) {
                appliedPresetControls.character_uc.push({
                    action: 'nsfw_processing',
                    bias: nsfwBias,
                    text: nsfwModifications.character_uc.join(', ')
                });
            }
        }

        // Handle dataset processing - datasets are prepended, preset-type datasets are appended (exclude for V3 models)
        const isV3Model = body.model === 'v3' || body.model === 'v3_furry';
        const { getModelFeatures: getForgeModelFeatures } = require('./modelFeatures');
        const transparencyCaps = getForgeModelFeatures(body.model, __runtimeGr.getModelFeaturesMap());
        const modelKey = String(body.model || '').toLowerCase();
        const isConfigAllowedForModel = (config) => {
            const models = Array.isArray(config?.models) ? config.models.map((value) => String(value).toLowerCase()) : null;
            const excluded = Array.isArray(config?.excludeModels) ? config.excludeModels.map((value) => String(value).toLowerCase()) : null;
            return (!models || models.includes(modelKey)) && (!excluded || !excluded.includes(modelKey));
        };
        const shouldSkipDatasetPromptValue = (datasetConfig, datasetText) => {
            if (!datasetConfig) return !String(datasetText || '').trim();
            if (datasetConfig.skipPromptValue || datasetConfig.isQualityPreset || datasetConfig.isTransparencyPreset) return true;
            return !String(datasetText || '').trim();
        };
        const hasApplyingTextOverlays = Array.isArray(body.text_overlays) && body.text_overlays.some((overlay) => {
            return !!(overlay && !overlay.disabled && String(overlay.text || '').trim());
        });
        const collectSubToggleTexts = (datasetConfig, datasetSettings) => {
            const texts = [];
            if (!datasetConfig) return texts;
            const settings = datasetSettings || {};
            (datasetConfig.sub_toggles || []).forEach((st) => {
                if (!isConfigAllowedForModel(st)) return;
                if (hasApplyingTextOverlays && (st.id === 'no_text' || /^\s*no\s+text\s*$/i.test(String(st.value || '')))) {
                    return;
                }
                const setting = settings[st.id];
                const enabled = setting && setting.enabled !== undefined ? !!setting.enabled : !!st.default_enabled;
                if (!enabled) return;
                const settingValue = (setting && setting.value) || st.value;
                if (!settingValue) return;
                let settingBiasValue = setting && setting.bias !== undefined ? setting.bias :
                    (st.default !== undefined ? st.default : 1.0);
                if (st.negative === true) {
                    settingBiasValue = -1.0 * settingBiasValue;
                }
                let settingText = settingValue;
                if (settingBiasValue !== 1.0) {
                    settingText = applyBiasToText(settingText, settingBiasValue);
                }
                texts.push(settingText);
            });
            return texts;
        };
        const pushDatasetTexts = (datasetConfig, texts, prepends, appends) => {
            const target = datasetConfig?.isTransparencyPreset
                ? prepends
                : (datasetConfig?.type === 'preset' ? appends : prepends);
            texts.forEach((text) => {
                if (text && String(text).trim()) target.push(text);
            });
        };

        if (!isV3Model) {
            const hasInclude = body.dataset_config && Array.isArray(body.dataset_config.include) && body.dataset_config.include.length > 0;
            const specialPresets = (currentPromptConfig.datasets || []).filter((dataset) =>
                (dataset.isQualityPreset && body.append_quality) || (dataset.isTransparencyPreset && body.append_transparency)
            );
            if (hasInclude || specialPresets.length > 0) {
                const datasetMappings = {};
                const datasetConfigLookup = {};
                if (currentPromptConfig.datasets) {
                    currentPromptConfig.datasets.forEach(dataset => {
                        datasetMappings[dataset.value] = `${dataset.value}`;
                        datasetConfigLookup[dataset.value] = dataset;
                    });
                }
                // modules/modelFeatures.js — V5 remaps "furry dataset" → "fur dataset" in the prompt text
                const datasetAliases = {
                    'furry dataset': 'fur dataset',
                    ...(transparencyCaps?.datasetAliases || {})
                };
                const normalizedDatasetConfig = {
                    ...(body.dataset_config || {}),
                    include: [],
                    bias: {},
                    settings: {}
                };

                const datasetPrepends = [];
                const datasetAppends = [];

                (body.dataset_config?.include || []).forEach(rawDataset => {
                    const dataset = datasetAliases[rawDataset] || rawDataset;
                    const datasetConfig = datasetConfigLookup[dataset] || datasetConfigLookup[rawDataset];
                    const isAllowedForModel = isConfigAllowedForModel(datasetConfig);
                    if ((datasetMappings[dataset] || datasetAliases[rawDataset])
                        && isAllowedForModel
                        && !normalizedDatasetConfig.include.includes(dataset)) {
                        let datasetText = datasetMappings[dataset] || dataset;
                        normalizedDatasetConfig.include.push(dataset);

                        const isPresetType = datasetConfig?.type === 'preset';
                        const configuredBias = body.dataset_config.bias?.[dataset] ?? body.dataset_config.bias?.[rawDataset];
                        let biasValue = configuredBias !== undefined ?
                            configuredBias :
                            (datasetConfig?.default !== undefined ? datasetConfig.default : 1.0);
                        if (configuredBias !== undefined) normalizedDatasetConfig.bias[dataset] = configuredBias;

                        if (datasetConfig?.negative === true) {
                            biasValue = -1.0 * biasValue;
                        }

                        if (biasValue !== 1.0) {
                            datasetText = applyBiasToText(datasetText, biasValue);
                        }

                        if (!shouldSkipDatasetPromptValue(datasetConfig, datasetText)) {
                            if (isPresetType) {
                                datasetAppends.push(datasetText);
                            } else {
                                datasetPrepends.push(datasetText);
                            }
                        }

                        const datasetSettings = body.dataset_config.settings?.[dataset] || body.dataset_config.settings?.[rawDataset];
                        if (datasetSettings) {
                            normalizedDatasetConfig.settings[dataset] = datasetSettings;
                            pushDatasetTexts(datasetConfig, collectSubToggleTexts(datasetConfig, datasetSettings), datasetPrepends, datasetAppends);
                        }
                    }
                });

                specialPresets.forEach((datasetConfig) => {
                    if (normalizedDatasetConfig.include.includes(datasetConfig.value)) return;
                    const datasetSettings = body.dataset_config?.settings?.[datasetConfig.value];
                    if (datasetSettings) {
                        normalizedDatasetConfig.settings[datasetConfig.value] = datasetSettings;
                    }
                    pushDatasetTexts(datasetConfig, collectSubToggleTexts(datasetConfig, datasetSettings), datasetPrepends, datasetAppends);
                });

                if (body.dataset_config) {
                    body.dataset_config = normalizedDatasetConfig;
                }
                if (hasApplyingTextOverlays) {
                    if (!body.dataset_config) body.dataset_config = normalizedDatasetConfig;
                    if (!body.dataset_config.settings) body.dataset_config.settings = {};
                    if (!body.dataset_config.settings.__quality__) body.dataset_config.settings.__quality__ = {};
                    const qualitySettings = body.dataset_config.settings.__quality__;
                    qualitySettings.no_text = {
                        enabled: false,
                        value: (qualitySettings.no_text && qualitySettings.no_text.value) || 'no text',
                        bias: qualitySettings.no_text && qualitySettings.no_text.bias !== undefined
                            ? qualitySettings.no_text.bias
                            : 1
                    };
                }

                if (datasetPrepends.length > 0) {
                    const datasetString = datasetPrepends.join(', ');
                    processedPrompt = datasetString + ', ' + processedPrompt;
                    console.log(`🗂️ Applied dataset prepends: ${datasetString}`);

                    appliedPresetControls.prompt.push({
                        action: 'dataset_prepend',
                        text: datasetString
                    });
                }

                if (datasetAppends.length > 0) {
                    const datasetAppendString = datasetAppends.join(', ');

                    processedPrompt = insertBeforeTextColonOrFirstGroup(processedPrompt, datasetAppendString);

                    __runtimeGr.getLogger().detailed(`🗂️ Dataset preset appends: ${datasetAppendString.substring(0, 100)}${datasetAppendString.length > 100 ? '...' : ''}`);

                    appliedPresetControls.prompt.push({
                        action: 'dataset_preset_append',
                        text: datasetAppendString
                    });
                }
            }
        }

        const alreadyRequestsTransparency = /(?:transparent\s+background|has\s+alpha|alpha\s+transparency)/i.test(processedPrompt);
        if (body.append_transparency && transparencyCaps?.transparency === true && !alreadyRequestsTransparency) {
            const requestedBias = Number(body.transparency_bias ?? 1);
            const transparencyText = requestedBias !== 1
                ? applyBiasToText('transparent background', requestedBias)
                : 'transparent background';
            processedPrompt = `${transparencyText}, ${processedPrompt}`;
            appliedPresetControls.prompt.push({
                action: 'transparency_prepend',
                text: transparencyText
            });
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
                // Apply bias wrapper if quality_preset_bias is set and not 1.0
                let qualityText = selectedQuality.value;
                if (body.quality_preset_bias !== undefined && body.quality_preset_bias !== 1.0) {
                    qualityText = applyBiasToText(qualityText, body.quality_preset_bias);
                }

                processedPrompt = insertBeforeTextColonOrFirstGroup(processedPrompt, qualityText);
                selectedQualityId = selectedQuality.id;
                __runtimeGr.getLogger().detailed(`🎨 Quality preset: ${qualityText.substring(0, 60)}${qualityText.length > 60 ? '...' : ''} (ID: ${selectedQuality.id})`);
                
                // Track this modification
                appliedPresetControls.prompt.push({
                    action: 'quality_preset',
                    bias: body.quality_preset_bias !== undefined ? body.quality_preset_bias : 1.0,
                    text: qualityText
                });
            }
        }

        // Inline prompt-negative: merge into positive prompts before dynamic generation / final API
        {
            const merged = applyAllInputPromptNegativeMerges(processedPrompt, processedPromptNegativeFragment, processedCharacterPrompts);
            processedPrompt = merged.processedPrompt;
            processedCharacterPrompts = merged.processedCharacterPrompts;
            const baseBlock = buildPromptNegativeBlock(processedPromptNegativeFragment);
            if (baseBlock) {
                appliedPresetControls.prompt.push({
                    action: 'input_prompt_negative',
                    text: baseBlock
                });
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
                __runtimeGr.getLogger().detailed(`🚫 UC preset: ${selectedUc.value.substring(0, 80)}${selectedUc.value.length > 80 ? '...' : ''} (ID: ${selectedUc.id})`);
                
                // Track this modification
                appliedPresetControls.uc.push({
                    action: 'uc_preset',
                    text: selectedUc.value
                });
            }
        }

        // NSFW *_prefix after UC/dataset assembly so prefixes stay at the front (e.g. Remove → nsfw, lowres, …)
        if (nsfwValue !== undefined && nsfwValue !== 0) {
            let nsfwPrefixMods = { prompt: [], uc: [], character_prompts: [], character_uc: [] };
            ({ processedPrompt, processedNegativePrompt, processedCharacterPrompts, modifications: nsfwPrefixMods } = applyNsfwPrefixes(
                processedPrompt,
                processedNegativePrompt,
                processedCharacterPrompts,
                nsfwValue,
                nsfwBias,
                currentPromptConfig
            ));
            if (nsfwPrefixMods.prompt.length > 0) {
                appliedPresetControls.prompt.push({
                    action: 'nsfw_processing',
                    bias: nsfwBias,
                    text: nsfwPrefixMods.prompt.join(', ')
                });
            }
            if (nsfwPrefixMods.uc.length > 0) {
                appliedPresetControls.uc.push({
                    action: 'nsfw_processing',
                    bias: nsfwBias,
                    text: nsfwPrefixMods.uc.join(', ')
                });
            }
            if (nsfwPrefixMods.character_prompts.length > 0) {
                appliedPresetControls.character_prompts.push({
                    action: 'nsfw_processing',
                    bias: nsfwBias,
                    text: nsfwPrefixMods.character_prompts.join(', ')
                });
            }
            if (nsfwPrefixMods.character_uc.length > 0) {
                appliedPresetControls.character_uc.push({
                    action: 'nsfw_processing',
                    bias: nsfwBias,
                    text: nsfwPrefixMods.character_uc.join(', ')
                });
            }
        }
        
        // Apply text overlays if any exist
        if (body.text_overlays && Array.isArray(body.text_overlays) && body.text_overlays.length > 0) {
            const currentStageIndex = stageData?.stageIndex || 0;
            const textTags = currentPromptConfig.text_tags || {
                'speech': { name: 'Speech Bubble', tags: 'english text, speech bubble' },
                'thought': { name: 'Thought Bubble', tags: 'english text, thought bubble' },
                'caption': { name: 'Subtitle', tags: 'english text, caption, subtitle' }
            };
            
            body.text_overlays.forEach((overlay, index) => {
                // Skip if disabled
                if (overlay.disabled) {
                    console.log(`⏭️ Text overlay ${index + 1} is disabled, skipping`);
                    return;
                }
                
                // Check if this overlay applies to the current stage
                // Support both old 'stage' field and new 'stages' array
                const overlayStages = overlay.stages || (overlay.stage !== undefined ? [overlay.stage.toString()] : []);
                const currentStageHexId = stageData?.hexId || '00';
                const isEnhancementStage = stageData?.stageType === 'enhance';
                
                // Check if pipelines are disabled
                const pipelinesDisabled = body.skip_pipeline_stages === true;
                
                // Check if this overlay should be applied to this stage
                const isAllStages = overlayStages.includes('all');
                const hasBaseStage00 = overlayStages.includes('00') || overlayStages.length === 0; // Empty stages means base only (stage 00)
                
                // When pipelines are disabled, always apply if overlay targets 'all' stages or has base stage '00'
                let shouldApply;
                if (pipelinesDisabled && (isAllStages || hasBaseStage00)) {
                    shouldApply = true;
                } else {
                    // Normal pipeline logic
                    shouldApply = isAllStages || // 'all' means apply to all stages
                                 overlayStages.length === 0 || // Empty stages means base only
                                 overlayStages.includes(currentStageHexId) ||
                                 (isEnhancementStage && overlayStages.length > 0); // Enhancement stages get all non-base overlays
                }
                
                if (!shouldApply) {
                    return; // Skip if not for this stage
                }

                // Get text and type
                let text = overlay.text || '';
                let type = overlay.type || 'speech';
                
                // Log when applying overlay
                const pipelineDisabledNote = pipelinesDisabled && (isAllStages || hasBaseStage00) ? ' (pipelines disabled, applying always)' : '';
                if (isAllStages) {
                    __runtimeGr.getLogger().detailed(`📝 Text overlay "${text.substring(0, 40)}..." to stage ${currentStageHexId} (All Stages)${pipelineDisabledNote}`);
                } else if (overlayStages.length > 0) {
                    __runtimeGr.getLogger().detailed(`📝 Text overlay "${text.substring(0, 40)}..." to stage ${currentStageHexId} (${overlayStages.join(', ')})${pipelineDisabledNote}`);
                }
                if (!text.trim()) {
                    if (body.dynamic_generation !== undefined) {
                        // Set placeholder for AI to replace
                        const typeName = type === 'speech' ? 'speech bubble' : type === 'thought' ? 'thought bubble' : 'subtitle';
                        text = `[${type.toUpperCase()}_TEXT_INSERT]`;
                        console.log(`🤖 Empty text overlay with dynamic generation - set placeholder for ${typeName}: ${text}`);
                    } else {
                        return; // Skip empty text without dynamic generation
                    }
                }
                
                const tags = textTags[type]?.tags || 'english text, speech bubble';
                const targetIndex = overlay.target || 0;
                
                // Calculate emphasis for tags based on text length
                // Range: 1.5 (short text) to 5.5 (long text)
                // More text = higher emphasis to prevent tags from being overshadowed
                const textLength = text.length;
                let tagEmphasis;
                
                if (textLength <= 10) {
                    // Very short text: minimum emphasis
                    tagEmphasis = 1.5;
                } else if (textLength >= 200) {
                    // Very long text: maximum emphasis
                    tagEmphasis = 5.5;
                } else {
                    // Scale linearly between 1.5 and 5.5 based on text length
                    // Formula: 1.5 + ((length - 10) / (200 - 10)) * (5.5 - 1.5)
                    tagEmphasis = 1.5 + ((textLength - 10) / 190) * 4.0;
                    // Round to 1 decimal place
                    tagEmphasis = Math.round(tagEmphasis * 10) / 10;
                }
                
                // Apply emphasis to tags using applyBiasToText to properly handle inner emphasis groups
                const emphasizedTags = applyBiasToText(tags, tagEmphasis);
                
                // Build the text append string
                const textAppend = `, ${emphasizedTags}, Text: ${text}`;
                __runtimeGr.getLogger().verbose(`📝 Text overlay append (emphasis ${tagEmphasis}): "${textAppend.substring(0, 60)}${textAppend.length > 60 ? '...' : ''}"`);
                
                // Determine which prompt to append to
                if (targetIndex === 0) {
                    // Apply to base prompt
                    if (processedPrompt) {
                        processedPrompt = stripNoTextTag(processedPrompt);
                        processedPrompt += textAppend;
                        __runtimeGr.getLogger().detailed(`📝 Applied overlay: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}" (type: ${type})`);
                    }
                } else {
                    // Apply to character prompt (targetIndex - 1 gives array index)
                    const charIndex = targetIndex - 1;
                    if (processedCharacterPrompts && processedCharacterPrompts[charIndex]) {
                        const char = processedCharacterPrompts[charIndex];
                        if (char.prompt) {
                            char.prompt = stripNoTextTag(char.prompt);
                            char.prompt += textAppend;
                            console.log(`📝 Applied text overlay to character ${targetIndex} prompt: "${text}" (type: ${type})`);
                        }
                    }
                }
            });
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
                body.dynamic_generation.use_cache_responses = preset.use_cache_responses_preset;
            }
        }
        
        if (dynamic_generation) {
            // Generate consistent prompt hash using utility function
            const currentPromptHash = generatePromptHash(
                rawPrompt,
                rawNegativePrompt,
                body.allCharacterPrompts || preset?.allCharacterPrompts || [],
                rawInputPromptNegative || ''
            );

            // Generate consistent request hash using utility function (context only - no directive)
            const requestConfigForHash = body.dynamic_generation ? {
                tod: body.dynamic_generation.tod,
                weather: body.dynamic_generation.weather,
                season: body.dynamic_generation.season,
                activity: body.dynamic_generation.activity,
                action: body.dynamic_generation.action,
                location: body.dynamic_generation.location,
                optimize: body.dynamic_generation.optimize,
                creative: body.dynamic_generation.creative,
                clothing: body.dynamic_generation.clothing,
                observeHoliday: body.dynamic_generation.observeHoliday
            } : null;

            const currentRequestHash = requestConfigForHash ? generateRequestHash(requestConfigForHash) : null;
            const currentDirectiveHash = body.dynamic_generation?.directive ? generateDirectiveHash(body.dynamic_generation.directive) : null;

            // Check if this is a stage with inherited compiled prompt - pass through normal flow
            if (body.stageIndex !== undefined && dynamic_generation?.compiled_prompt) {
                body.dynamic_generation.context_locked = true;
                body.dynamic_generation.cache_locked = true;
                console.log(`🎯 Stage ${body.stageIndex}: Inheriting compiled prompt from previous stage`);
            }
            
            // Check if we have a cached compiled prompt with valid conditions
            // Skip entirely if compiled_prompt has success: false
            // Only validate directive_hash if a directive is being used
            const requiresDirective = !!body?.dynamic_generation?.directive;
            let hasValidCache = body?.dynamic_generation?.compiled_prompt &&
                body?.dynamic_generation?.compiled_prompt?.success !== false &&
                !!body?.dynamic_generation?.compiled_prompt?.prompt_hash &&
                !!body?.dynamic_generation?.compiled_prompt?.request_hash &&
                (!requiresDirective || !!body?.dynamic_generation?.compiled_prompt?.directive_hash);
            
            // Debug: Log why cache might be invalid
            if (!hasValidCache) {
                if (!body?.dynamic_generation?.compiled_prompt) {
                    console.log('❌ No compiled_prompt exists');
                } else if (body?.dynamic_generation?.compiled_prompt?.success === false) {
                    console.log('❌ Previous generation failed (success: false)');
                } else if (!body?.dynamic_generation?.compiled_prompt?.prompt_hash) {
                    console.log('❌ Missing prompt_hash in compiled_prompt');
                } else if (!body?.dynamic_generation?.compiled_prompt?.request_hash) {
                    console.log('❌ Missing request_hash in compiled_prompt');
                } else if (requiresDirective && !body?.dynamic_generation?.compiled_prompt?.directive_hash) {
                    console.log('❌ Missing directive_hash in compiled_prompt (directive is being used)');
                }
            }

            // If dyna_no_cache is explicitly set to true, never use cache
            if (body?.dynamic_generation?.dyna_no_cache === true) {
                hasValidCache = false;
                console.log('🚫 Dynamic generation cache disabled by request');
            }

            if (body?.dynamic_generation?.backgroundFocus === true) {
                hasValidCache = false;
                console.log('🌳 Background focus enabled, forcing regeneration');
                if (body.dynamic_generation.compiled_prompt?.context) {
                    body.dynamic_generation.context_locked = true;
                    console.log('🔒 Preserved context locked flag for context reuse despite cache invalidation');
                }
            }

            // If use_cache_responses is disabled, never use cache
            if (body?.dynamic_generation?.use_cache_responses !== undefined && body?.dynamic_generation?.use_cache_responses === false) {
                hasValidCache = false;
            }

            // Extract initialPromptAware setting early - needed for preview generation logic
            // Can be set independently of optimize - check both locations
            const initialPromptAware = body?.dynamic_generation?.initialPromptAware || false;

            // COMPILE CONTEXT ONCE - will be used for cache validation AND AI processing
            let dynaRequest = body.dynamic_generation;
            let contextForAI = null;
            if (dynaRequest && typeof dynaRequest === 'object') {
                dynaRequest._hash_input_prompt_negative = rawInputPromptNegative || '';
            }

            if (dynaRequest.context_locked && dynaRequest.compiled_prompt?.context) {
                // Context is locked - reuse from compiled_prompt
                console.log('🔒 Context locked: Reusing existing context from compiled prompt');
                contextForAI = dynaRequest.compiled_prompt.context;
                
                // Send context phase progress update when context is reused
                if (ws && handler && contextForAI) {
                    const carouselData = formatContextForCarousel(contextForAI);
                    handler.sendToClient(ws, {
                        type: 'dynamic_generation_progress_update',
                        phase: 'context',
                        data: {
                            date: contextForAI.time ? {
                                year: contextForAI.time.year,
                                month: contextForAI.time.month, // 0-based
                                day: contextForAI.time.dayOfMonth
                            } : null,
                            time: contextForAI.time ? `${String(contextForAI.time.hour).padStart(2, '0')}:${String(contextForAI.time.minute).padStart(2, '0')}` : new Date().toTimeString().split(' ')[0],
                            season: contextForAI.season?.name,
                            weather: contextForAI.weather,
                            holiday: contextForAI.season?.holiday || null,
                            location: contextForAI.location,
                            carousel: carouselData
                        },
                        timestamp: new Date().toISOString()
                    });
                }
            } else if (dynaRequest.locked && dynaRequest.compiled_prompt?.context) {
                // Pipeline stage inheritance - reuse context from previous stage
                console.log('🔒 Pipeline locked mode: Reusing context from previous stage');
                contextForAI = dynaRequest.compiled_prompt.context;
                
                // Send context phase progress update when context is reused
                if (ws && handler && contextForAI) {
                    const carouselData = formatContextForCarousel(contextForAI);
                    handler.sendToClient(ws, {
                        type: 'dynamic_generation_progress_update',
                        phase: 'context',
                        data: {
                            date: contextForAI.time ? {
                                year: contextForAI.time.year,
                                month: contextForAI.time.month, // 0-based
                                day: contextForAI.time.dayOfMonth
                            } : null,
                            time: contextForAI.time ? `${String(contextForAI.time.hour).padStart(2, '0')}:${String(contextForAI.time.minute).padStart(2, '0')}` : new Date().toTimeString().split(' ')[0],
                            season: contextForAI.season?.name,
                            weather: contextForAI.weather,
                            holiday: contextForAI.season?.holiday || null,
                            location: contextForAI.location,
                            carousel: carouselData
                        },
                        timestamp: new Date().toISOString()
                    });
                }
            } else {
                // Generate context for AI processing
                const clientInfo = wsServer?.clients?.get(ws);
                const clientIP = clientInfo?.clientIP || null;
                contextForAI = await compileContext(__runtimeGr, dynaRequest, clientIP);
                
                // Send context phase progress update when context is freshly compiled
                if (ws && handler && contextForAI) {
                    const carouselData = formatContextForCarousel(contextForAI);
                    handler.sendToClient(ws, {
                        type: 'dynamic_generation_progress_update',
                        phase: 'context',
                        data: {
                            date: contextForAI.time ? {
                                year: contextForAI.time.year,
                                month: contextForAI.time.month, // 0-based
                                day: contextForAI.time.dayOfMonth
                            } : null,
                            time: contextForAI.time ? `${String(contextForAI.time.hour).padStart(2, '0')}:${String(contextForAI.time.minute).padStart(2, '0')}` : new Date().toTimeString().split(' ')[0],
                            season: contextForAI.season?.name,
                            weather: contextForAI.weather,
                            holiday: contextForAI.season?.holiday || null,
                            location: contextForAI.location,
                            carousel: carouselData
                        },
                        timestamp: new Date().toISOString()
                    });
                }
            }

            // If we have cache and it's either not expired OR cache_locked, try to apply transforms
            const isCacheLocked = !!body?.dynamic_generation?.cache_locked;

            if (hasValidCache) {
                const compiledPrompt = body.dynamic_generation.compiled_prompt;
                const now = Date.now();
                // Use dynamic expiration if available, otherwise fall back to timestamp-based 15 minute check
                const isNotExpired = compiledPrompt.expiresAt 
                    ? now < compiledPrompt.expiresAt 
                    : (now - compiledPrompt.timestamp) < 15 * 60 * 1000;
                const canUseCache = isNotExpired || isCacheLocked;

                if (canUseCache) {
                    console.log(`${isCacheLocked ? '🔒' : '📝'} ${isCacheLocked ? 'Locked' : 'Cached'} prompt available - attempting to apply text transformations`);

                    if (!body._promptApplicationBaseline) {
                        stashPromptApplicationBaseline(body, preset, {
                            rawPrompt,
                            rawNegativePrompt,
                            rawInputPromptNegative,
                            processedPrompt,
                            processedNegativePrompt,
                            processedCharacterPrompts,
                            appliedPresetControls,
                            allTextReplacementSeeds,
                            processedPromptNegativeFragment,
                            APPEND_MARKER
                        });
                    }

                    // Check if request parameters changed
                    if (compiledPrompt.request_hash !== currentRequestHash) {
                        console.log('🔄 Request hash modified, invalidating cache');
                        hasValidCache = false;
                    }

                    // Check if directive changed (only if using directive)
                    if (requiresDirective && compiledPrompt.directive_hash !== currentDirectiveHash) {
                        console.log('🔄 Directive hash modified, invalidating cache');
                        hasValidCache = false;
                    }

                    if (body?.dynamic_generation?.force_context_refresh === true) {
                        console.log('🔄 Force context refresh requested, invalidating cache');
                        hasValidCache = false;
                    }

                    // Try to apply text replacements using helper function
                    if (hasValidCache) {
                        const replacementResult = applyCachedTextReplacements(
                            compiledPrompt,
                            processedPrompt,
                            processedNegativePrompt,
                            processedCharacterPrompts
                        );
                        
                        if (replacementResult.success) {
                            processedPrompt = replacementResult.processedPrompt;
                            processedNegativePrompt = replacementResult.processedNegativePrompt;
                            processedCharacterPrompts = replacementResult.processedCharacterPrompts;
                            ({ processedPrompt, processedCharacterPrompts } = applyAllInputPromptNegativeMerges(
                                processedPrompt,
                                processedPromptNegativeFragment,
                                processedCharacterPrompts
                            ));
                        } else {
                            console.error('❌ Error applying cached text replacements:', replacementResult.error);
                            hasValidCache = false;
                        }
                    }
                } else {
                    console.log('⏰ Cached prompt expired and not locked, checking if context changed...');
                    
                    // Check if context has actually changed by comparing expiration metadata
                    const cachedMetadata = compiledPrompt?.context?.expirationMetadata;
                    
                    if (cachedMetadata && contextForAI && !body?.dynamic_generation?.force_context_refresh) {
                        // Use precompiled context to compare
                        try {
                            const freshMetadata = contextForAI?.expirationMetadata;
                            
                            if (freshMetadata) {
                                // Check if context has meaningfully changed
                                const timePeriodChanged = cachedMetadata.timePeriod !== freshMetadata.timePeriod;
                                const weatherChanged = cachedMetadata.weatherCondition !== freshMetadata.weatherCondition;
                                const phenomenonChanged = cachedMetadata.hasWeatherPhenomenon !== freshMetadata.hasWeatherPhenomenon;
                                const cloudCoverageDiff = Math.abs((cachedMetadata.cloudCoverage || 0) - (freshMetadata.cloudCoverage || 0));
                                const tempDiff = Math.abs((cachedMetadata.temperature || 0) - (freshMetadata.temperature || 0));
                                
                                const hasSignificantChange = timePeriodChanged || weatherChanged || phenomenonChanged || 
                                                            cloudCoverageDiff >= 20 || tempDiff >= 10;
                                
                                if (!hasSignificantChange) {
                                    console.log('  ✅ Context unchanged - keeping cache and updating expiration');
                                    // Update the context and recalculate expiration
                                    compiledPrompt.context = contextForAI;
                                    compiledPrompt.expiresAt = calculateDynamicExpiration(__runtimeGr, contextForAI, 30 * 60 * 1000);;
                                    compiledPrompt.timestamp = now;
                                    
                                    const msUntil = compiledPrompt.expiresAt - now;
                                    const minutesUntil = Math.round(msUntil / (60 * 1000));
                                    const hoursUntil = Math.round(minutesUntil / 60 * 10) / 10;
                                    console.log(`  ⏰ Updated expiration: ${new Date(compiledPrompt.expiresAt).toLocaleTimeString()} (${hoursUntil}h ${minutesUntil % 60}m)`);
                                    
                                    // Apply cached text replacements using helper function
                                    console.log('♻️ Applying cached text replacements (context unchanged)');
                                    const replacementResult = applyCachedTextReplacements(
                                        compiledPrompt,
                                        processedPrompt,
                                        processedNegativePrompt,
                                        processedCharacterPrompts
                                    );
                                    
                                    if (replacementResult.success) {
                                        processedPrompt = replacementResult.processedPrompt;
                                        processedNegativePrompt = replacementResult.processedNegativePrompt;
                                        processedCharacterPrompts = replacementResult.processedCharacterPrompts;
                                        ({ processedPrompt, processedCharacterPrompts } = applyAllInputPromptNegativeMerges(
                                            processedPrompt,
                                            processedPromptNegativeFragment,
                                            processedCharacterPrompts
                                        ));
                                        hasValidCache = true;
                                    } else {
                                        console.error('❌ Error applying cached replacements:', replacementResult.error);
                                        hasValidCache = false;
                                    }
                                } else {
                                    // Log what changed
                                    if (timePeriodChanged) console.log(`  🕐 Time period changed: "${cachedMetadata.timePeriod}" → "${freshMetadata.timePeriod}"`);
                                    if (weatherChanged) console.log(`  🌦️  Weather changed: "${cachedMetadata.weatherCondition}" → "${freshMetadata.weatherCondition}"`);
                                    if (phenomenonChanged) console.log(`  ⛈️  Weather phenomenon status changed`);
                                    if (cloudCoverageDiff >= 20) console.log(`  ☁️  Major cloud coverage change: ${cachedMetadata.cloudCoverage}% → ${freshMetadata.cloudCoverage}%`);
                                    if (tempDiff >= 10) console.log(`  🌡️  Major temperature change: ${cachedMetadata.temperature}°C → ${freshMetadata.temperature}°C`);
                                    console.log('  🔄 Context has changed - invalidating cache');
                                    hasValidCache = false;
                                }
                            } else {
                                console.log('  ⚠️  Fresh metadata unavailable - invalidating cache');
                                hasValidCache = false;
                            }
                        } catch (error) {
                            console.error('  ❌ Error checking context changes:', error);
                            hasValidCache = false;
                        }
                    } else {
                        if (!cachedMetadata) {
                            console.log('  ℹ️  No cached metadata - invalidating cache');
                        }
                        if (body?.dynamic_generation?.force_context_refresh) {
                            console.log('  🔄 Forced context refresh requested - invalidating cache');
                        }
                        hasValidCache = false;
                    }
                }

                if (!hasValidCache) {
                    console.log(`🗑️ ${isCacheLocked ? 'Locked' : 'Cached'} prompt invalidated - will regenerate`);
                    
                    const promptsChanged = body.dynamic_generation?.compiled_prompt?.prompt_hash !== currentPromptHash;
                    const directiveChanged = body.dynamic_generation?.compiled_prompt?.directive_hash !== currentDirectiveHash; 
                    if (initialPromptAware && (body.dynamic_generation?.compiled_prompt?.preview_image || body.dynamic_generation?.compiled_prompt?.preview_image_hash) && promptsChanged) {
                        console.log('🗑️ Prompts changed - clearing old preview image for regeneration');
                        delete body.dynamic_generation.compiled_prompt.preview_image;
                        delete body.dynamic_generation.compiled_prompt.preview_metadata;
                    } else if (initialPromptAware && (body.dynamic_generation?.compiled_prompt?.preview_image || body.dynamic_generation?.compiled_prompt?.preview_image_hash) && !promptsChanged) {
                        console.log('✅ Prompts unchanged - keeping existing preview image');
                    }
                }
            }

            if (hasValidCache) {
                __runtimeGr.getLogger().detailed('✅ Using cached prompt');

                if (body._promptApplicationBaseline && dynamic_generation?.compiled_prompt) {
                    const appCtx = buildPromptApplicationContext(body._promptApplicationBaseline);
                    dynamic_generation.compiled_prompt.application_context = appCtx;
                    if (!dynamic_generation.compiled_prompt.applied_preset_controls) {
                        dynamic_generation.compiled_prompt.applied_preset_controls = appCtx.applied_preset_controls;
                    }
                }

                // Send context phase progress update even when using cache, so overlay shows correctly
                if (ws && handler && contextForAI) {
                    const carouselData = formatContextForCarousel(contextForAI);
                    handler.sendToClient(ws, {
                        type: 'dynamic_generation_progress_update',
                        phase: 'context',
                        data: {
                            date: contextForAI.time ? {
                                year: contextForAI.time.year,
                                month: contextForAI.time.month, // 0-based
                                day: contextForAI.time.dayOfMonth
                            } : null,
                            time: contextForAI.time ? `${String(contextForAI.time.hour).padStart(2, '0')}:${String(contextForAI.time.minute).padStart(2, '0')}` : new Date().toTimeString().split(' ')[0],
                            season: contextForAI.season?.name,
                            weather: contextForAI.weather,
                            holiday: contextForAI.season?.holiday || null,
                            location: contextForAI.location,
                            carousel: carouselData
                        },
                        timestamp: new Date().toISOString()
                    });
                }

                // Send progress update indicating AI processing is complete (cached)
                if (ws && handler) {
                    handler.sendGenerationProgress(ws, body.requestId || 'buildOptions', {
                        phase: 'completion',
                        hasDynamicGen: true
                    });
                }
            } else {
                // Cache invalidated - need to run AI processing
                // This happens when:
                // 1. No compiled prompt exists (new generation)
                // 2. Prompt hash doesn't match (prompts changed) → preview regenerated
                // 3. Request hash doesn't match (parameters changed)
                // 4. Failed to apply text replacements → preview regenerated
                // 5. Cache expired and not locked
                console.log('🎭 Dynamic generation cache invalidated - running AI processing');

                // Check if Initial Prompt Aware is enabled and we need to generate a preview
                // Preview is regenerated ONLY when cache was invalidated (which means we're here)
                // AND there's no existing preview (either never existed or was cleared during invalidation)
                let hasValidPreview = false;
                if (body.dynamic_generation?.compiled_prompt?.preview_image_hash) {
                    // Check if the preview file actually exists on disk
                    const dynGenPreviewDir = path.join(__runtimeGr.getPath('cache'), 'dynGenPreview');
                    const previewFilePath = path.join(dynGenPreviewDir, `${body.dynamic_generation.compiled_prompt.preview_image_hash}.png`);
                    hasValidPreview = fs.existsSync(previewFilePath);
                    if (!hasValidPreview) {
                        console.log(`⚠️ Preview hash exists but file not found, will regenerate`);
                    } else {
                        console.log(`✅ Valid preview found, skipping regeneration`);
                    }
                } else if (body.dynamic_generation?.compiled_prompt?.preview_image) {
                    // Legacy base64 format
                    hasValidPreview = true;
                    console.log(`✅ Legacy preview found, skipping regeneration`);
                }
                
                const needsPreview = initialPromptAware &&
                                     !hasValidPreview &&
                                     !body.stageIndex &&
                                     !body.compile_only; // Only generate preview for initial generation, not pipeline stages
                
                if (needsPreview) {
                    console.log('🖼️ Initial Prompt Aware enabled - generating preview first');
                    if (!body.seed) {
                        body.seed = Math.floor(0x100000000 * Math.random() - 1);
                        console.log(`🎲 Generated seed for preview and main generation: ${body.seed}`);
                    }
                    
                    // Calculate preview resolution (max area 262144, maintain aspect ratio)
                    let previewWidth, previewHeight;
                    const maxArea = 262144; // 512x512 equivalent
                    
                    if (body.width && body.height) {
                        const previewDims = dimensionsMaxUnderArea(body.width, body.height, maxArea, 64, 64, 64);
                        previewWidth = previewDims.width;
                        previewHeight = previewDims.height;
                    } else {
                        // Named resolution - extract dimensions
                        const dims = getDimensionsFromResolution((body.resolution || 'normal_square').toLowerCase());
                        if (dims && dims.width && dims.height) {
                            const previewDims = dimensionsMaxUnderArea(dims.width, dims.height, maxArea, 64, 64, 64);
                            previewWidth = previewDims.width;
                            previewHeight = previewDims.height;
                        } else {
                            // Fallback to 512x512
                            previewWidth = 512;
                            previewHeight = 512;
                        }
                    }
                    
                    console.log(`🖼️ Preview resolution: ${previewWidth}x${previewHeight} (max area: ${maxArea})`);
                    
                    // Create preview generation options (without dynamic generation to avoid recursion)
                    const previewBody = {
                        ...body,
                        width: previewWidth,
                        height: previewHeight,
                        steps: Math.min(body.steps || 28, 28), // Max 28 steps for preview
                        seed: body.seed, // Use the same seed as main generation
                        dynamic_generation: undefined, // Skip dynamic generation for preview
                        no_save: true // Don't save the preview
                    };
                    
                    // Lock ALL text replacements from initial processing for preview and final generation
                    // This ensures both the preview and final image use the same exact text replacements
                    if (body.text_replacements !== undefined && allTextReplacementSeeds && allTextReplacementSeeds.length > 0) {
                        const lockedReplacements = allTextReplacementSeeds.map(r => ({ ...r, locked: true }));
                        previewBody.text_replacements_seed = lockedReplacements;
                        console.log(`🔒 Locked ${lockedReplacements.length} text replacements for preview`);
                    }
                    
                    // Remove resolution if using custom dimensions
                    delete previewBody.resolution;
                    
                    // Generate preview
                    const previewOptions = await buildOptions(globalResources, previewBody, null, {}, ws, handler, wsServer);
                    // Ensure preview streams by providing a streaming callback
                    const streamCb = () => {};
                    const previewResult = await handleGeneration(globalResources, previewOptions, true, null, body.workspace, null, streamCb, ws, handler);
                    
                    if (previewResult && previewResult.buffer) {
                        __runtimeGr.getLogger().detailed('✅ Preview generated');
                        
                        // Trace: attach generated preview (use actual requestId)
                        try {
                            if (body.requestId && previewResult.buffer) {
                                __runtimeGr.getTracing().addImageAttachment(body.requestId, 'initial_preview_generated', previewResult.buffer, 'png', {
                                    width: previewWidth,
                                    height: previewHeight,
                                    stage: 'preview'
                                });
                            }
                        } catch {}
                        
                        // Generate hash from preview buffer
                        const previewHash = crypto.createHash('sha256').update(previewResult.buffer).digest('hex');
                        
                        // Save preview to .cache/dynGenPreview/ directory
                        const dynGenPreviewDir = path.join(__runtimeGr.getPath('cache'), 'dynGenPreview');
                        if (!fs.existsSync(dynGenPreviewDir)) {
                            fs.mkdirSync(dynGenPreviewDir, { recursive: true });
                        }
                        
                        const previewFilePath = path.join(dynGenPreviewDir, `${previewHash}.png`);
                        fs.writeFileSync(previewFilePath, previewResult.buffer);
                        console.log(`💾 Saved preview to cache: ${previewHash}.png`);
                        
                        // Store only the hash in dynamic_generation for the actual generation
                        body.dynamic_generation.compiled_prompt = body.dynamic_generation.compiled_prompt || {};
                        body.dynamic_generation.compiled_prompt.preview_image_hash = previewHash;
                        body.dynamic_generation.compiled_prompt.preview_metadata = {
                            width: previewWidth,
                            height: previewHeight,
                            steps: previewBody.steps,
                            seed: body.seed // Store seed used for preview
                        };
                        
                        console.log(`🖼️ Preview stored with hash ${previewHash.substring(0, 8)}... (seed: ${body.seed}), proceeding with full generation`);
                    } else {
                        console.warn('⚠️ Preview generation failed, proceeding without preview');
                    }
                }

                // AI path confirmed (cache/reuse rejected): toast + Rentan overlay use image_generation_progress with same phases as Rentan WS updates
                if (ws && handler) {
                    handler.sendGenerationProgress(ws, body.requestId || 'buildOptions', {
                        phase: 'starting',
                        hasDynamicGen: true
                    });
                }

                // Retry loop for chain rejection - if AI rejects the chain, retry with clean state
                let dynamicResult = null;
                let chainRetries = 0;
                const maxChainRetries = 3;
                
                // Remove append marker from prompts before passing to AI
                // AI shouldn't see the marker - it's only for internal processing
                const markerRegex = new RegExp(`\\s*,?\\s*${APPEND_MARKER}\\s*,?\\s*`, 'g');
                const stripAppendMarker = (text) => {
                    if (typeof text !== 'string') return text;
                    return text
                        .replace(markerRegex, ', ')
                        .replace(/,\s*,+/g, ', ')
                        .replace(/^,\s*|\s*,$/g, '')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                };
                ({ processedPrompt, processedCharacterPrompts } = applyAllInputPromptNegativeMerges(
                    processedPrompt,
                    processedPromptNegativeFragment,
                    processedCharacterPrompts
                ));
                const promptForAI = stripAppendMarker(processedPrompt);
                const ucForAI = stripAppendMarker(processedNegativePrompt);
                const characterPromptsForAI = (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) 
                    ? processedCharacterPrompts.map(char => ({
                        ...char,
                        prompt: stripAppendMarker(char.prompt),
                        uc: stripAppendMarker(char.uc)
                    }))
                    : [];

                stashPromptApplicationBaseline(body, preset, {
                    rawPrompt,
                    rawNegativePrompt,
                    rawInputPromptNegative,
                    processedPrompt,
                    processedNegativePrompt,
                    processedCharacterPrompts,
                    appliedPresetControls,
                    allTextReplacementSeeds,
                    processedPromptNegativeFragment,
                    APPEND_MARKER
                });
                
                while (chainRetries < maxChainRetries) {
                    try {
                        if (body.emphasis_normalization && typeof body.emphasis_normalization === 'object') {
                            dynaRequest = {
                                ...dynaRequest,
                                emphasis_normalization: body.emphasis_normalization
                            };
                        }
                        dynamicResult = await processDynamicGenerationCore(__runtimeGr, 
                            dynaRequest,
                            contextForAI,
                            promptForAI,
                            ucForAI,
                            characterPromptsForAI,
                            body.requestId || 'buildOptions', // Use actual requestId
                            ws,
                            handler,
                            wsServer,
                            dynaRequest.backgroundFocus || false,
                            dynaRequest.lastGeneratedImage || null,
                            dynaRequest.stageContext || null,
                            body.dataset_config, // Pass dataset config for NSFW level
                            appliedPresetControls, // Pass preset controls for AI awareness
                            { // Pass pre-calculated hashes for consistency
                                promptHash: currentPromptHash,
                                requestHash: currentRequestHash,
                                directiveHash: currentDirectiveHash
                            }
                        );

                        // Check if chain was rejected
                        if (dynamicResult.chainRejected === true) {
                            chainRetries++;
                            console.log(`🔄 Chain rejected (retry ${chainRetries}/${maxChainRetries}) - restarting with clean state`);

                            // Clear compiled_prompt state for next attempt
                            dynaRequest = {
                                ...dynaRequest,
                                compiled_prompt: dynaRequest.compiled_prompt ? {
                                    ...dynaRequest.compiled_prompt,
                                    previousResponseId: null,
                                    request_hash: null,
                                    prompt_hash: null,
                                    directive_hash: null
                                } : null
                            };

                            // Continue to next iteration with clean state
                            continue;
                        }

                        // Check if we have empty or missing text_replacements after validation failure
                        // This happens when validation fails and AI returns empty response - we should restart instead of falling back
                        if (dynamicResult.success) {
                            const hasEmptyTextReplacements = !dynamicResult.text_replacements || 
                                (!dynamicResult.text_replacements.prompt?.length && 
                                 !dynamicResult.text_replacements.uc?.length && 
                                 (!dynamicResult.text_replacements.character_prompts || 
                                  dynamicResult.text_replacements.character_prompts.every(char => 
                                      (!char.prompt?.length && !char.uc?.length)
                                  )));
                            
                            if (hasEmptyTextReplacements && chainRetries < maxChainRetries) {
                                chainRetries++;
                                console.log(`⚠️ No text replacements provided after validation failure, restarting dynamic generation (retry ${chainRetries}/${maxChainRetries})`);

                                // Clear compiled_prompt state for next attempt
                                dynaRequest = {
                                    ...dynaRequest,
                                    compiled_prompt: dynaRequest.compiled_prompt ? {
                                        ...dynaRequest.compiled_prompt,
                                        previousResponseId: null,
                                        request_hash: null,
                                        prompt_hash: null,
                                        directive_hash: null
                                    } : null
                                };

                                // Continue to next iteration with clean state
                                continue;
                            }
                        }

                        // Success or failure (not chain rejection) - break out
                        break;

                    } catch (dynamicError) {
                        // Handle hydration errors and other exceptions by treating them as chain rejections
                        console.warn(`⚠️ Dynamic generation error (attempt ${chainRetries + 1}/${maxChainRetries}):`, dynamicError.message);

                        chainRetries++;
                        if (chainRetries < maxChainRetries) {
                            console.log(`🔄 Retrying dynamic generation due to error (attempt ${chainRetries + 1}/${maxChainRetries})`);

                            // Clear compiled_prompt state for next attempt
                            dynaRequest = {
                                ...dynaRequest,
                                compiled_prompt: dynaRequest.compiled_prompt ? {
                                    ...dynaRequest.compiled_prompt,
                                    previousResponseId: null,
                                    request_hash: null,
                                    prompt_hash: null,
                                    directive_hash: null
                                } : null
                            };

                            // Continue to next iteration
                            continue;
                        } else {
                            // Max retries exceeded, create error result
                            console.error(`❌ Dynamic generation failed after ${maxChainRetries} attempts:`, dynamicError.message);
                            dynamicResult = {
                                success: false,
                                error: `Dynamic generation processing failed: ${dynamicError.message}`,
                                processed: false
                            };
                            break;
                        }
                    }
                }
                
                // If we exhausted retries due to chain rejection, return error
                if (chainRetries >= maxChainRetries && dynamicResult.chainRejected) {
                    console.error(`❌ Chain rejected ${maxChainRetries} times, giving up`);
                    dynamicResult = {
                        success: false,
                        error: 'Dynamic generation chain rejected too many times',
                        processed: false
                    };
                }

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
                    
                    // Try to reuse text_replacements from previous compiled_prompt if available
                    const previousCompiledPrompt = body.dynamic_generation?.compiled_prompt;
                    let reusedTextReplacements = dynamicResult.text_replacements;
                    
                    if (!reusedTextReplacements && previousCompiledPrompt?.text_replacements && previousCompiledPrompt.success !== false) {
                        console.log('💾 Reusing text_replacements from previous successful compiled_prompt');
                        reusedTextReplacements = previousCompiledPrompt.text_replacements;
                        
                        // Apply the reused text replacements
                        try {
                            // Apply replacements to prompt
                            if (reusedTextReplacements.prompt && reusedTextReplacements.prompt.length > 0) {
                                console.log(`🔄 Applying ${reusedTextReplacements.prompt.length} reused prompt replacements`);
                                const result = applyDynamicReplacements(__runtimeGr, processedPrompt, reusedTextReplacements, 'prompt');
                                if (result.success) {
                                    processedPrompt = result.result;
                                } else {
                                    console.warn(`⚠️ Some reused prompt replacements failed: ${result.failedReplacements.join(', ')}`);
                                }
                            }

                            // Apply replacements to negative prompt
                            if (reusedTextReplacements.uc && reusedTextReplacements.uc.length > 0) {
                                console.log(`🔄 Applying ${reusedTextReplacements.uc.length} reused UC replacements`);
                                const result = applyDynamicReplacements(__runtimeGr, processedNegativePrompt, reusedTextReplacements, 'uc');
                                if (result.success) {
                                    processedNegativePrompt = result.result;
                                } else {
                                    console.warn(`⚠️ Some reused UC replacements failed: ${result.failedReplacements.join(', ')}`);
                                }
                            }

                            // Apply replacements to character prompts
                            if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts) && processedCharacterPrompts.length > 0 && reusedTextReplacements.character_prompts) {
                                processedCharacterPrompts = processedCharacterPrompts.map((char, index) => {
                                    const charReplacements = reusedTextReplacements.character_prompts[index];
                                    if (!charReplacements) {
                                        return char;
                                    }
                                    let updatedChar = { ...char };

                                    if (charReplacements.prompt && charReplacements.prompt.length > 0) {
                                        console.log(`🔄 Applying ${charReplacements.prompt.length} reused prompt replacements to character ${index}`);
                                        const result = applyDynamicReplacements(__runtimeGr, char.prompt || '', reusedTextReplacements, 'character', index, 'prompt');
                                        if (result.success) {
                                            updatedChar.prompt = result.result;
                                        }
                                    }

                                    if (charReplacements.uc && charReplacements.uc.length > 0) {
                                        console.log(`🔄 Applying ${charReplacements.uc.length} reused UC replacements to character ${index}`);
                                        const result = applyDynamicReplacements(__runtimeGr, char.uc || '', reusedTextReplacements, 'character', index, 'uc');
                                        if (result.success) {
                                            updatedChar.uc = result.result;
                                        }
                                    }

                                    return updatedChar;
                                });
                            }
                            ({ processedPrompt, processedCharacterPrompts } = applyAllInputPromptNegativeMerges(
                                processedPrompt,
                                processedPromptNegativeFragment,
                                processedCharacterPrompts
                            ));
                        } catch (error) {
                            console.error('❌ Error applying reused text replacements:', error);
                        }
                    }
                    
                    // Store failed result with success: false
                    dynamic_generation.compiled_prompt = {
                        success: false,
                        citations: dynamicResult.citations,
                        context: dynamicResult.context, // Include weather/time/season context
                        text_replacements: reusedTextReplacements, // Store text replacements (reused or new)
                        dialogs: dynamicResult.dialogs || [], // Store character dialogs for display
                        character_names: dynamicResult.character_names || null, // Store character names from AI
                        generated_image_name: dynamicResult.generated_image_name || null, // Store generated image name from AI
                        prompt_hash: currentPromptHash, // Store hash for cache validation
                        request_hash: currentRequestHash, // Store hash for cache validation
                        directive_hash: currentDirectiveHash, // Store hash for cache validation
                        preview_image_hash: body.dynamic_generation?.compiled_prompt?.preview_image_hash,
                        timestamp: Date.now(),
                        error: dynamicResult?.error?.message || 'Dynamic generation processing failed',
                        errors: dynamicResult.errors || [], // Save AI-registered errors
                        warnings: dynamicResult.warnings || [], // Save AI-registered warnings
                        cache_locked: body.dynamic_generation.cache_locked || false,
                        context_locked: body.dynamic_generation.context_locked || false,
                        generation_chain: dynamicResult.generation_chain, // Save generation chain number for incrementing
                        preview_metadata: body.dynamic_generation?.compiled_prompt?.preview_image_hash ? body.dynamic_generation?.compiled_prompt?.preview_metadata : undefined,
                        previousResponseId: dynamicResult.previousResponseId, // Save response ID for stateful continuation
                        initialResponseId: dynamicResult.initialResponseId, // Save initial response ID separately
                        text_replacements_reused: !dynamicResult.text_replacements && !!reusedTextReplacements, // Flag to indicate reuse
                        totalUsage: dynamicResult.totalUsage || null, // Save total usage data even on error for cost tracking
                        usage: dynamicResult.usage || null, // Save structured usage data with phase1 and phase2 breakdowns (if any)
                        apiCalls: dynamicResult?.apiCalls || null, // Save detailed API calls array even on error
                        published_analysis: dynamicResult?.published_analysis || null,
                        replacement_plan: dynamicResult?.replacement_plan || null
                    };
                } else {
                    // Store the compiled result
                    const now = Date.now();
                    const expiresAt = calculateDynamicExpiration(__runtimeGr, dynamicResult.context, 30 * 60 * 1000); // Default 30 minutes fallback
                    
                    const compiledPrompt = {
                        success: true,
                        citations: dynamicResult.citations,
                        context: dynamicResult.context, // Include weather/time/season context
                        text_replacements: dynamicResult.text_replacements, // Store text replacements for caching
                        dialogs: dynamicResult.dialogs || [], // Store character dialogs for display
                        character_names: dynamicResult.character_names || null, // Store character names from AI
                        generated_image_name: dynamicResult.generated_image_name || null, // Store generated image name from AI
                        prompt_hash: currentPromptHash, // Store hash for cache validation
                        request_hash: currentRequestHash, // Store hash for cache validation
                        directive_hash: currentDirectiveHash, // Store hash for cache validation
                        preview_image_hash: body.dynamic_generation?.compiled_prompt?.preview_image_hash,
                        timestamp: now,
                        expiresAt: expiresAt, // Dynamic expiration based on time/weather changes
                        errors: dynamicResult.errors || [], // Save AI-registered errors
                        warnings: dynamicResult.warnings || [], // Save AI-registered warnings
                        cache_locked: body.dynamic_generation.cache_locked || false,
                        context_locked: body.dynamic_generation.context_locked || false,
                        preview_metadata: body.dynamic_generation?.compiled_prompt?.preview_image_hash ? body.dynamic_generation?.compiled_prompt?.preview_metadata : undefined,
                        previousResponseId: dynamicResult.previousResponseId, // Save response ID for stateful continuation
                        initialResponseId: dynamicResult.initialResponseId, // Save initial response ID separately
                        generation_chain: dynamicResult.generation_chain, // Save generation chain number for incrementing
                        totalUsage: dynamicResult?.totalUsage || null, // Save total usage data for cost tracking
                        usage: dynamicResult?.usage !== undefined ? dynamicResult.usage : null, // Save structured usage data with phase1 and phase2 breakdowns
                        apiCalls: dynamicResult?.apiCalls || null, // Save detailed API calls array for granular tracking
                        published_analysis: dynamicResult?.published_analysis || null,
                        replacement_plan: dynamicResult?.replacement_plan || null,
                        applied_preset_controls: dynamicResult.applied_preset_controls || appliedPresetControls || null,
                        application_context: body._promptApplicationBaseline
                            ? buildPromptApplicationContext(body._promptApplicationBaseline)
                            : null
                    };
                    
                    if (dynamicResult.text_replacements) {
                        // Apply replacements to prompt
                        if (dynamicResult.text_replacements.prompt && dynamicResult.text_replacements.prompt.length > 0) {
                            console.log(`🔄 Applying ${dynamicResult.text_replacements.prompt.length} prompt replacements`);
                            try {
                                const result = applyDynamicReplacements(__runtimeGr, processedPrompt, dynamicResult.text_replacements, 'prompt');
                                if (!result.success) {
                                    console.error(`❌ Failed to apply prompt replacements: ${result.failedReplacements.join(', ')}`);
                                } else {
                                    processedPrompt = result.result;
                                }
                            } catch (error) {
                                console.error('❌ Error applying prompt replacements:', error);
                            }
                        }

                        // Apply replacements to negative prompt
                        if (dynamicResult.text_replacements.uc && dynamicResult.text_replacements.uc.length > 0) {
                            console.log(`🔄 Applying ${dynamicResult.text_replacements.uc.length} UC replacements`);
                            try {
                                const result = applyDynamicReplacements(__runtimeGr, processedNegativePrompt, dynamicResult.text_replacements, 'uc');
                                if (!result.success) {
                                    console.error(`❌ Failed to apply UC replacements: ${result.failedReplacements.join(', ')}`);
                                } else {
                                    processedNegativePrompt = result.result;
                                }
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
                                            if (charReplacements.prompt && charReplacements.prompt.length > 0) {
                                                try {
                                                    const result = applyDynamicReplacements(__runtimeGr, 
                                                        processedCharacterPrompts[index].prompt || '',
                                                        dynamicResult.text_replacements,
                                                        'character',
                                                        index,
                                                        'prompt'
                                                    );
                                                    if (!result.success) {
                                                        console.error(`❌ Failed to apply character ${index} prompt replacements: ${result.failedReplacements.join(', ')}`);
                                                    } else {
                                                        processedCharacterPrompts[index].prompt = result.result;
                                                    }
                                                } catch (error) {
                                                    console.error(`❌ Error applying character ${index} prompt replacements:`, error);
                                                }
                                            }

                                            if (charReplacements.uc && charReplacements.uc.length > 0) {
                                                console.log(`🔄 Applying ${charReplacements.uc.length} UC replacements to character ${index}`);
                                                try {
                                                    const result = applyDynamicReplacements(__runtimeGr, 
                                                        processedCharacterPrompts[index].uc || '',
                                                        dynamicResult.text_replacements,
                                                        'character',
                                                        index,
                                                        'uc'
                                                    );
                                                    if (!result.success) {
                                                        console.error(`❌ Failed to apply character ${index} UC replacements: ${result.failedReplacements.join(', ')}`);
                                                    } else {
                                                        processedCharacterPrompts[index].uc = result.result;
                                                    }
                                                } catch (error) {
                                                    console.error(`❌ Error applying character ${index} UC replacements:`, error);
                                                }
                                            }
                                        }
                                    }
                                });
                            }
                        }
                        
                        // Apply character names from AI to character prompts
                        if (dynamicResult.character_names && Array.isArray(dynamicResult.character_names) && dynamicResult.character_names.length > 0) {
                            processedCharacterPrompts = processedCharacterPrompts || [];
                            if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
                                dynamicResult.character_names.forEach((name, index) => {
                                    if (name && processedCharacterPrompts[index]) {
                                        // Update both chara_name and name properties for compatibility
                                        processedCharacterPrompts[index].chara_name = name;
                                        processedCharacterPrompts[index].name = name;
                                        console.log(`✨ Applied character name "${name}" to character ${index + 1}`);
                                    }
                                });
                            }
                        }
                        ({ processedPrompt, processedCharacterPrompts } = applyAllInputPromptNegativeMerges(
                            processedPrompt,
                            processedPromptNegativeFragment,
                            processedCharacterPrompts
                        ));
                        const totalReplacements = (dynamicResult.text_replacements.prompt?.length || 0) +
                                                    (dynamicResult.text_replacements.uc?.length || 0) +
                                                    (dynamicResult.text_replacements.character_prompts?.reduce((sum, char) =>
                                                        (char.prompt?.length || 0) + (char.uc?.length || 0), 0) || 0);
                        __runtimeGr.getLogger().normal(`🔄 Applied ${totalReplacements} text replacements`);
                    } else {
                        // No text replacements provided - this should have been caught earlier and restarted
                        // But if we reach here, all retries are exhausted, so fall back to compiled prompt
                        console.log('⚠️ No text replacements provided after exhausting retries, falling back to compiled prompt');
                        processedPrompt = compiledPrompt.prompt;
                        processedNegativePrompt = compiledPrompt.uc;
                        processedCharacterPrompts = compiledPrompt.characterPrompts;
                        ({ processedPrompt, processedCharacterPrompts } = applyAllInputPromptNegativeMerges(
                            processedPrompt,
                            processedPromptNegativeFragment,
                            processedCharacterPrompts
                        ));
                    }

                    // Store in the dynamic_generation object for caching
                    dynamic_generation.compiled_prompt = compiledPrompt;
                    __runtimeGr.getLogger().verbose('💾 Stored compiled prompt');

                    // If this is a preset generation, save the compiled prompt directly to the preset
                    if (!!preset &&body.presetName) {
                        try {
                            const currentPromptConfig = __runtimeGr.getPromptConfig({ clone: true });

                            if (currentPromptConfig.presets[body.presetName]) {
                                if (!currentPromptConfig.presets[body.presetName].dynamic_generation) {
                                    currentPromptConfig.presets[body.presetName].dynamic_generation = {};
                                }

                                const success = __runtimeGr.modifyConfig('promptConfig').assign(['presets', body.presetName, 'dynamic_generation', 'compiled_prompt'], compiledPrompt);
                                if (success) {
                                    console.log(`💾 Saved compiled prompt directly to preset: ${body.presetName}`);
                                } else {
                                    console.warn(`⚠️ Failed to save compiled prompt to preset ${body.presetName}: saveConfig returned false`);
                                }
                            }
                        } catch (error) {
                            console.warn(`⚠️ Failed to save compiled prompt to preset ${body.presetName}:`, error.message);
                        }
                    }
                }
            }
        } else if (ws && handler) {
            handler.sendGenerationProgress(ws, body.requestId || 'buildOptions', {
                phase: 'generating',
                hasDynamicGen: false
            });
        }

        // Re-apply inline prompt-negative merges after dynamic replacements (idempotent)
        ({ processedPrompt, processedCharacterPrompts } = applyAllInputPromptNegativeMerges(
            processedPrompt,
            processedPromptNegativeFragment,
            processedCharacterPrompts
        ));

        // Clean up prompt syntax (remove % % wrappers and unreplaced placeholders)
        processedPrompt = cleanupPromptSyntax(processedPrompt);
        processedNegativePrompt = cleanupPromptSyntax(processedNegativePrompt);

        if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
            processedCharacterPrompts = processedCharacterPrompts.map(char => ({
                ...char,
                prompt: cleanupPromptSyntax(char.prompt),
                uc: cleanupPromptSyntax(char.uc)
            }));
        }

        if (dynamic_generation?.compiled_prompt) {
            dynamic_generation.compiled_prompt.prompt = processedPrompt;
            dynamic_generation.compiled_prompt.uc = processedNegativePrompt;
            if (processedCharacterPrompts && Array.isArray(processedCharacterPrompts)) {
                dynamic_generation.compiled_prompt.characterPrompts = processedCharacterPrompts;
            }
            // Always persist UI/request lock toggles on compiled_prompt (including cache-hit path).
            dynamic_generation.compiled_prompt.cache_locked = !!dynamic_generation.cache_locked;
            dynamic_generation.compiled_prompt.context_locked = !!dynamic_generation.context_locked;
        }

        // Check if this is an img2img request
        const forgeModelKey = String(body.model || '').toLowerCase();
        const wantsInpaint = !!(body.mask || body.mask_compressed) && !!body.image && !forgeModelKey.includes('_inp');
        // modules/modelFeatures.js — curated V5 inpaint remaps to V4.5 curated until ready
        const { resolveApiModelSlug, getModelFeatures } = require('./modelFeatures');
        const modelFeaturesMap = __runtimeGr.getModelFeaturesMap();
        const apiModelSlug = resolveApiModelSlug(forgeModelKey, { inpaint: wantsInpaint }, modelFeaturesMap);
        const ModelEnum = __runtimeGr.getNekoAiService('Model');
        let resolvedApiModel = apiModelSlug
            || ModelEnum[forgeModelKey.toUpperCase() + (wantsInpaint ? '_INP' : '')]
            || ModelEnum[forgeModelKey.toUpperCase()];
        // Prefer enum value matching the remapped slug (inpaint may differ from forge+_INP)
        if (apiModelSlug && ModelEnum) {
            const enumHit = Object.keys(ModelEnum).find((k) => ModelEnum[k] === apiModelSlug);
            if (enumHit) resolvedApiModel = ModelEnum[enumHit];
        }
        const forgeCaps = getModelFeatures(forgeModelKey, modelFeaturesMap);
        if (body.upscaled_enhance === true && forgeCaps?.maxEnhance !== true) {
            throw new Error(`Max Enhance is not supported by model ${forgeModelKey || 'unknown'}`);
        }

        const baseOptions = {
            prompt: processedPrompt,
            negative_prompt: processedNegativePrompt,
            input_prompt: rawPrompt,
            input_uc: rawNegativePrompt,
            input_prompt_negative: rawInputPromptNegative,
            model: resolvedApiModel,
            steps: parseInt(stepsValue),
            scale: parseFloat(guidanceValue.toString()),
            cfg_rescale: parseFloat(rescaleValue.toString()),
            skip_cfg_above_sigma: (varietyValue && forgeCaps?.varietyPlus !== false) ? 59.04722600415217 : undefined,
            sampler: body.sampler ? __runtimeGr.getNekoAiService('Sampler')[body.sampler.toUpperCase()] : (preset?.sampler ? __runtimeGr.getNekoAiService('Sampler')[preset.sampler.toUpperCase()] : __runtimeGr.getNekoAiService('Sampler').EULER_ANC),
            noise_schedule: body.noiseScheduler ? __runtimeGr.getNekoAiService('Noise')[body.noiseScheduler.toUpperCase()] : (preset?.noiseScheduler ? __runtimeGr.getNekoAiService('Noise')[preset.noiseScheduler.toUpperCase()] : __runtimeGr.getNekoAiService('Noise').KARRAS),
            no_save: body.no_save !== undefined ? body.no_save : preset?.no_save,
            qualityToggle: false,
            ucPreset: 4,
            params_version: forgeCaps?.paramsVersion,
            dynamicThresholding: body.dynamicThresholding || preset?.dynamicThresholding,
            seed: parseInt(seedValue || '0'),
            upscale: (forgeCaps && forgeCaps.e2eUpscale === false) ? undefined : upscaleValue,
            upscaled_enhance: body.upscaled_enhance === true && forgeCaps?.maxEnhance === true ? true : undefined,
            characterPrompts: body.characterPrompts || preset?.characterPrompts || undefined,
            allCharacterPrompts: processedCharacterPrompts || undefined,
            input_character_prompts: body.allCharacterPrompts || preset?.allCharacterPrompts || undefined,
            // Pass through for forge_data; API path normalizes null→0.5 before nekoai-js.
            use_coords: body.use_coords !== undefined ? !!body.use_coords : (preset?.use_coords !== undefined ? !!preset.use_coords : undefined),
            dataset_config: body.dataset_config || preset?.dataset_config || undefined,
            append_quality: body.append_quality !== undefined ? body.append_quality : preset?.append_quality,
            quality_preset_bias: body.quality_preset_bias !== undefined ? body.quality_preset_bias : preset?.quality_preset_bias,
            append_transparency: body.append_transparency !== undefined ? !!body.append_transparency : !!preset?.append_transparency,
            transparency_bias: body.transparency_bias !== undefined ? Number(body.transparency_bias) : preset?.transparency_bias,
            append_uc: body.append_uc !== undefined ? body.append_uc : preset?.append_uc,
            append_quality_id: selectedQualityId,
            append_uc_id: selectedUcId,
            vibe_transfer: body.vibe_transfer !== undefined ? body.vibe_transfer : (preset && preset.vibe_transfer ? preset.vibe_transfer : undefined),
            normalize_vibes: body.normalize_vibes !== undefined ? body.normalize_vibes : (preset && preset.normalize_vibes !== undefined ? preset.normalize_vibes : true),
            dynamic_generation: dynamic_generation || (preset?.dynamic_generation ? { ...preset.dynamic_generation, compiled_prompt: undefined } : undefined),
            text_overlays: body.text_overlays || preset?.text_overlays || undefined,
            auto_clean_uc: body.auto_clean_uc !== undefined ? body.auto_clean_uc : (preset && preset.auto_clean_uc !== undefined ? preset.auto_clean_uc : true),
            keep_newlines: body.keep_newlines !== undefined ? !!body.keep_newlines : (preset && preset.keep_newlines !== undefined ? !!preset.keep_newlines : false),
            auto_char_numerize: body.auto_char_numerize !== undefined ? !!body.auto_char_numerize : (preset && preset.auto_char_numerize !== undefined ? !!preset.auto_char_numerize : true),
            prompt_normalize: body.prompt_normalize !== undefined ? !!body.prompt_normalize : (preset && preset.prompt_normalize !== undefined ? !!preset.prompt_normalize : true),
            deduplicate_tags: body.deduplicate_tags !== undefined ? !!body.deduplicate_tags : (preset && preset.deduplicate_tags !== undefined ? !!preset.deduplicate_tags : true),
            emphasis_normalization: body.emphasis_normalization !== undefined ? body.emphasis_normalization : (preset && preset.emphasis_normalization ? preset.emphasis_normalization : undefined),
        };

        // Hard gate unsupported V5 capabilities (vibe / precise reference / e2e upscale / Variety+)
        if (forgeCaps) {
            if (forgeCaps.vibeTransfer === false) {
                baseOptions.vibe_transfer = undefined;
            }
            if (forgeCaps.varietyPlus === false) {
                baseOptions.skip_cfg_above_sigma = undefined;
            }
            if (forgeCaps.e2eUpscale === false) {
                baseOptions.upscale = undefined;
            }
            if (forgeCaps.noiseScheduleUi === false) {
                baseOptions.noise_schedule = undefined;
            }
            if (forgeCaps.paramsVersion != null && baseOptions.params_version == null) {
                baseOptions.params_version = forgeCaps.paramsVersion;
            }
            if (forgeCaps.transparency === true && baseOptions.append_transparency) {
                baseOptions.straight_alpha = true;
                baseOptions.tag_hint_transparent_background = true;
            }
        }

        if (body.stepPreviewWidth && body.stepPreviewHeight) {
            const spw = parseInt(body.stepPreviewWidth, 10);
            const sph = parseInt(body.stepPreviewHeight, 10);
            if (Number.isFinite(spw) && spw > 0 && Number.isFinite(sph) && sph > 0) {
                baseOptions.stepPreviewWidth = spw;
                baseOptions.stepPreviewHeight = sph;
            }
        }

        if (baseOptions.upscale && baseOptions.upscale > 1 && !allowPaid) {
            throw new Error(`Upscaling with scale ${baseOptions.upscale} requires Opus credits. Set "allow_paid": true to confirm you accept using Opus credits for upscaling.`);
        }

        if (body.width && body.height) {
            baseOptions.width = parseInt(body.width.toString());
            baseOptions.height = parseInt(body.height.toString());
        } else if (resolutionValue && resolutionValue.toLowerCase().startsWith('xlarge_')) {
            // Handle xlarge resolutions by converting to custom dimensions
            const dims = getDimensionsFromResolution(resolutionValue.toLowerCase());
            if (dims && dims.width && dims.height) {
                baseOptions.width = dims.width;
                baseOptions.height = dims.height;
            } else {
                // Fallback to large if xlarge dimensions not found
                const fallbackResolution = resolutionValue.toLowerCase().replace('xlarge_', 'large_');
                if (__runtimeGr.getNekoAiService('Resolution')[fallbackResolution.toUpperCase()]) {
                    baseOptions.resPreset = __runtimeGr.getNekoAiService('Resolution')[fallbackResolution.toUpperCase()];
                } else {
                    baseOptions.resPreset = "NORMAL_SQUARE";
                }
            }
        } else if (resolutionValue && __runtimeGr.getNekoAiService('Resolution')[resolutionValue.toUpperCase()]) {
            baseOptions.resPreset = __runtimeGr.getNekoAiService('Resolution')[resolutionValue.toUpperCase()];
        } else {
            baseOptions.resPreset = "NORMAL_SQUARE";
        }

        // nekoai-js MetadataProcessor.handleResolution caps at 3,047,424 px; explicit width/height from the client or pipeline can exceed it (e.g. 2304×1344).
        if (baseOptions.width && baseOptions.height) {
            if (baseOptions.upscaled_enhance === true) {
                const enhanceArea = baseOptions.width * baseOptions.height;
                const minArea = Number(forgeCaps?.maxEnhanceMinArea);
                const maxArea = Number(forgeCaps?.maxEnhanceMaxArea);
                if ((Number.isFinite(minArea) && enhanceArea < minArea)
                    || (Number.isFinite(maxArea) && enhanceArea >= maxArea)) {
                    throw new Error(`Max Enhance requires an image area between ${minArea} and ${maxArea} pixels; received ${enhanceArea}.`);
                }
            }
            const maxApiTotalPixels = 3047424;
            const w = baseOptions.width;
            const h = baseOptions.height;
            if (w * h > maxApiTotalPixels) {
                const snapped = dimensionsMaxUnderArea(w, h, maxApiTotalPixels, 64, 64, 64);
                baseOptions.width = snapped.width;
                baseOptions.height = snapped.height;
                console.log(`📐 Clamped dimensions to API max ${maxApiTotalPixels} px: ${w}x${h} → ${snapped.width}x${snapped.height}`);
            }
        }

        if (body.chara_reference_source !== undefined && !(forgeCaps && forgeCaps.preciseReference === false)) {
            try {
                const sources = normalizeCharaReferenceSources(body.chara_reference_source);
                let types = Array.isArray(body.chara_reference_type) ? body.chara_reference_type : [];
                if (!types.length && body.chara_reference_with_style !== undefined) {
                    types = [body.chara_reference_with_style ? 1 : 2];
                }
                const strengths = Array.isArray(body.chara_reference_strength) ? body.chara_reference_strength : [];
                let fidelities = [];
                if (Array.isArray(body.chara_reference_fidelity)) {
                    fidelities = body.chara_reference_fidelity;
                } else if (body.chara_reference_fidelity !== undefined) {
                    fidelities = [body.chara_reference_fidelity];
                }

                const directorReferenceImages = [];
                const directorReferenceDescriptions = [];
                const directorReferenceInformationExtracted = [];
                const directorReferenceStrengthValues = [];
                const directorReferenceSecondaryStrengthValues = [];
                const charaReferenceWithStyle = body.chara_reference_with_style === true;

                for (let i = 0; i < sources.length; i++) {
                    const source = sources[i];
                    const charaReferenceBase64 = await convertCharacterReferenceToBase64(source);
                    if (!charaReferenceBase64) {
                        console.warn(`⚠️ Failed to convert character reference to base64: ${source}`);
                        continue;
                    }

                    const refType = types[i] !== undefined && types[i] !== null ? types[i] : 1;
                    const strength = Math.max(0, Math.min(1, Number(strengths[i] ?? 1)));
                    const fidelity = Math.max(0, Math.min(1, Number(fidelities[i] ?? 0)));
                    const secondaryStrength = Number((1 - fidelity).toFixed(2));

                    directorReferenceImages.push(charaReferenceBase64);
                    directorReferenceDescriptions.push({
                        caption: {
                            base_caption: getCharaReferenceBaseCaption(refType, charaReferenceWithStyle),
                            char_captions: []
                        },
                        legacy_uc: false
                    });
                    directorReferenceInformationExtracted.push(1);
                    directorReferenceStrengthValues.push(strength);
                    directorReferenceSecondaryStrengthValues.push(Math.max(0, Math.min(1, secondaryStrength)));
                }

                if (directorReferenceImages.length > 0) {
                    baseOptions.director_reference_images = directorReferenceImages;
                    baseOptions.director_reference_descriptions = directorReferenceDescriptions;
                    baseOptions.director_reference_information_extracted = directorReferenceInformationExtracted;
                    baseOptions.director_reference_strength_values = directorReferenceStrengthValues;
                    baseOptions.director_reference_secondary_strength_values = directorReferenceSecondaryStrengthValues;

                    baseOptions.chara_reference_source = body.chara_reference_source;
                    if (body.chara_reference_type !== undefined) {
                        baseOptions.chara_reference_type = body.chara_reference_type;
                    }
                    if (body.chara_reference_strength !== undefined) {
                        baseOptions.chara_reference_strength = body.chara_reference_strength;
                    }
                    if (body.chara_reference_fidelity !== undefined) {
                        baseOptions.chara_reference_fidelity = body.chara_reference_fidelity;
                    }
                    baseOptions.chara_reference_with_style = body.chara_reference_with_style !== undefined ? body.chara_reference_with_style : false;

                    console.log(`🎭 Added ${directorReferenceImages.length} character reference(s) to API request`);
                } else if (sources.length > 0) {
                    console.warn(`⚠️ Failed to convert character reference to base64: ${sources.join(', ')}`);
                }
            } catch (error) {
                console.warn(`⚠️ Failed to process character reference: ${error.message}`);
            }
        }
        
        if (!!body.image && body.image !== 'data:base64') {
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
                        const presetResult = await generatePresetSourceImage(globalResources, presetName, seed, resolution, body.model);
                        
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
                    const cachedImagePath = path.join(__runtimeGr.getPath('uploadCache'), imageIdentifier);
                    if (!fs.existsSync(cachedImagePath)) throw new Error(`Cached image not found: ${imageIdentifier}`);
                    imageBuffer = fs.readFileSync(cachedImagePath);
                    break;
                case 'file':
                    const filePath = path.join(__runtimeGr.getPath('images'), imageIdentifier);
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
            imageBuffer = __runtimeGr.getPngMetadata().stripPngTextChunks(imageBuffer);
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
            
            const skipBaseImageResize = body.stage_index !== undefined || body.image_preletterboxed === true;
            if (targetDims.width && targetDims.height && !skipBaseImageResize) {
                imageBuffer = baseOptions.append_transparency
                    ? await processDynamicImageLetterbox(imageBuffer, targetDims, body.image_bias)
                    : await processDynamicImage(imageBuffer, targetDims, body.image_bias);
                console.log(`📏 Resized base image to ${targetDims.width}x${targetDims.height} with bias ${body.image_bias}`);
            } else if (skipBaseImageResize) {
                if (body.image_preletterboxed) {
                    console.log(`⏭️ Skipping base image resize (pre-letterboxed expansion/inpaint canvas)`);
                } else {
                    console.log(`⏭️ Skipping image processing for pipeline stage ${body.stage_index} (image already letterboxed)`);
                }
            }

            baseOptions.action = (body.mask || body.mask_compressed) ? __runtimeGr.getNekoAiService('Action').INPAINT : __runtimeGr.getNekoAiService('Action').IMG2IMG;
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
                    // Load vibe references from database
                    const referenceImageMultiple = [];
                    const referenceStrengthMultiple = [];
                    const refDb = __runtimeGr.getReferenceMetadataDatabase();
                    
                    for (const vibeTransfer of baseOptions.vibe_transfer) {
                        try {
                            // Get encoding from database
                            const encoding = refDb.getVibeEncoding(vibeTransfer.id, body.model, vibeTransfer.ie);
                            
                            if (encoding) {
                                referenceImageMultiple.push(encoding);
                                referenceStrengthMultiple.push(vibeTransfer.strength);
                                console.log(`🎨 Found encoding for vibe ${vibeTransfer.id} with IE ${vibeTransfer.ie} and strength ${vibeTransfer.strength} (model: ${body.model})`);
                            } else {
                                console.warn(`⚠️ No encoding found for vibe ${vibeTransfer.id} with IE ${vibeTransfer.ie} for model ${body.model}`);
                            }
                        } catch (error) {
                            console.warn(`⚠️ Failed to get vibe encoding for ${vibeTransfer.id}:`, error.message);
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

        if (body.pipeline !== undefined) {
            baseOptions.pipeline = body.pipeline;
            if (body.stage_seeds !== undefined) {
                baseOptions.stage_seeds = body.stage_seeds;
            }
            if (body.stage_index !== undefined) {
                baseOptions.stage_index = body.stage_index;
            }
            if (body.stage_type !== undefined) {
                baseOptions.stage_type = body.stage_type;
            }
            if (body.save_base_output !== undefined) {
                baseOptions.save_base_output = body.save_base_output;
            }
        }
        
        if (body.text_replacements !== undefined) {
            baseOptions.text_replacements = body.text_replacements;
        }
        if (body.director_session_id !== undefined) {
            baseOptions.director_session_id = body.director_session_id;
        }
        if (body.director_message_id !== undefined) {
            baseOptions.director_message_id = body.director_message_id;
        }
        if (body.novel_note_id !== undefined) {
            baseOptions.novel_note_id = body.novel_note_id;
        }
        if (body.novel_story_cursor_line !== undefined) {
            baseOptions.novel_story_cursor_line = body.novel_story_cursor_line;
        }
        if (allTextReplacementSeeds.length > 0) {
            baseOptions.text_replacements_seed = allTextReplacementSeeds;
        }
        if (stageData) {
            if (stageData.stageIndex !== undefined) {
                baseOptions.stageIndex = stageData.stageIndex;
            }
            if (stageData.stageType !== undefined) {
                baseOptions.stageType = stageData.stageType;
            }
            if (stageData.totalStages !== undefined) {
                baseOptions.totalStages = stageData.totalStages;
            }
        }

        const autoCleanEnabled = body.auto_clean_uc !== undefined ? body.auto_clean_uc : true;
        
        if (autoCleanEnabled) {
            if (baseOptions.prompt && baseOptions.negative_prompt) {
                const originalUC = baseOptions.negative_prompt;
                baseOptions.negative_prompt = autoCleanUCPrompt(baseOptions.prompt, baseOptions.negative_prompt);
                
                if (originalUC !== baseOptions.negative_prompt) {
                    console.log('🧹 Main UC auto-cleaned');
                }
            }
            if (baseOptions.allCharacterPrompts && Array.isArray(baseOptions.allCharacterPrompts)) {
                baseOptions.allCharacterPrompts = baseOptions.allCharacterPrompts.map((char, index) => {
                    if (char.prompt && char.uc) {
                        const originalCharUC = char.uc;
                        const cleanedCharUC = autoCleanUCPrompt(char.prompt, char.uc);
                        
                        if (originalCharUC !== cleanedCharUC) {
                            console.log(`🧹 Character ${index} UC auto-cleaned`);
                        }
                        
                        return {
                            ...char,
                            uc: cleanedCharUC
                        };
                    }
                    return char;
                });
            }
        }

        // Remove the append marker from all prompt-bearing fields at the very end.
        // APPEND_MARKER is already defined at the top of this function
        const markerRegex = new RegExp(`\\s*,?\\s*${APPEND_MARKER}\\s*,?\\s*`, 'g');
        const sanitizeMarkerFromText = (text) => {
            if (typeof text !== 'string') return text;
            return text.replace(markerRegex, ', ');
        };
        // When the client's "keep newlines" toggle is on, preserve intentional line breaks
        // and only collapse horizontal whitespace runs; otherwise flatten to a single line.
        // When "prompt normalize" is off, skip separator normalization entirely.
        const keepNewlines = !!baseOptions.keep_newlines;
        const promptNormalize = baseOptions.prompt_normalize !== false;
        const normalizePromptSeparators = (text) => {
            if (typeof text !== 'string') return text;
            if (!promptNormalize) return text;
            if (keepNewlines) {
                return text
                    .replace(/\r\n?/g, '\n')
                    .replace(/,[^\S\n]*,+/g, ', ')
                    .replace(/^,[^\S\n]*|[^\S\n]*,$/g, '')
                    .replace(/[^\S\n]{2,}/g, ' ')
                    .trim();
            }
            return text
                .replace(/,\s*,+/g, ', ')
                .replace(/^,\s*|\s*,$/g, '')
                .replace(/\s{2,}/g, ' ')
                .trim();
        };
        const { normalizeEmphasisPromptSyntax } = require('./emphasisPromptSyntax');
        // prepareEmphasisTextForNovelAI: modules/emphasisGroupIdSyntax.js
        // Expand Weight Rack managed ids → classic N::…:: before syntax normalize; strip unmanaged ZW.
        const {
            prepareEmphasisTextForNovelAI,
            hasManagedEmphasisGroupIds
        } = require('./emphasisGroupIdSyntax');
        const emphasisNormForExpand = baseOptions.emphasis_normalization
            || body.emphasis_normalization
            || null;
        const sanitizeAndNormalizeText = (text, fieldHint) => {
            let out = sanitizeMarkerFromText(text);
            if (typeof out === 'string' && hasManagedEmphasisGroupIds(out)) {
                const prepared = prepareEmphasisTextForNovelAI(out, emphasisNormForExpand, fieldHint);
                if (prepared.warnings.length) {
                    console.warn(
                        `⚠️ Emphasis group id expand (${fieldHint || 'text'}): ${prepared.warnings.join(', ')}`
                    );
                }
                if (prepared.strippedLeftoverDelims) {
                    console.warn(
                        `⚠️ Emphasis group id leftover delims stripped (${fieldHint || 'text'}): ${prepared.strippedLeftoverDelims}`
                    );
                }
                out = prepared.text;
            }
            return normalizeEmphasisPromptSyntax(
                normalizePromptSeparators(out),
                { fixCommas: true }
            );
        };

        // Preserve managed ids in forge input_* (editor hydrate); API fields still expand below.
        const managedInputSnapshots = {};
        if (typeof baseOptions.input_prompt === 'string' && hasManagedEmphasisGroupIds(baseOptions.input_prompt)) {
            managedInputSnapshots.input_prompt = baseOptions.input_prompt;
        }
        if (typeof baseOptions.input_uc === 'string' && hasManagedEmphasisGroupIds(baseOptions.input_uc)) {
            managedInputSnapshots.input_uc = baseOptions.input_uc;
        }
        if (typeof baseOptions.input_prompt_negative === 'string'
            && hasManagedEmphasisGroupIds(baseOptions.input_prompt_negative)) {
            managedInputSnapshots.input_prompt_negative = baseOptions.input_prompt_negative;
        }
        if (Array.isArray(baseOptions.input_character_prompts)) {
            const hasManagedChar = baseOptions.input_character_prompts.some((char) =>
                char && typeof char === 'object' && (
                    (typeof char.prompt === 'string' && hasManagedEmphasisGroupIds(char.prompt))
                    || (typeof char.uc === 'string' && hasManagedEmphasisGroupIds(char.uc))
                    || (typeof char.input_prompt_negative === 'string'
                        && hasManagedEmphasisGroupIds(char.input_prompt_negative))
                    || (typeof char.prompt_negative === 'string'
                        && hasManagedEmphasisGroupIds(char.prompt_negative))
                )
            );
            if (hasManagedChar) {
                managedInputSnapshots.input_character_prompts = baseOptions.input_character_prompts.map((char) => (
                    char && typeof char === 'object' ? { ...char } : char
                ));
            }
        }

        const sanitizeMarkerFromCharacterPrompts = (characterPrompts) => {
            if (!Array.isArray(characterPrompts)) return characterPrompts;
            return characterPrompts.map((char, index) => {
                if (!char || typeof char !== 'object') return char;
                const fieldHint = `character_${index}`;
                const next = {
                    ...char,
                    prompt: sanitizeAndNormalizeText(char.prompt, fieldHint),
                    uc: sanitizeAndNormalizeText(char.uc, `${fieldHint}_uc`)
                };
                if (typeof char.input_prompt_negative === 'string') {
                    next.input_prompt_negative = sanitizeAndNormalizeText(
                        char.input_prompt_negative,
                        `${fieldHint}_prompt_negative`
                    );
                }
                if (typeof char.prompt_negative === 'string') {
                    next.prompt_negative = sanitizeAndNormalizeText(
                        char.prompt_negative,
                        `${fieldHint}_prompt_negative`
                    );
                }
                return next;
            });
        };

        baseOptions.prompt = sanitizeAndNormalizeText(baseOptions.prompt, 'prompt');
        baseOptions.negative_prompt = sanitizeAndNormalizeText(baseOptions.negative_prompt, 'uc');
        baseOptions.input_prompt = sanitizeAndNormalizeText(baseOptions.input_prompt, 'prompt');
        baseOptions.input_uc = sanitizeAndNormalizeText(baseOptions.input_uc, 'uc');
        baseOptions.input_prompt_negative = sanitizeAndNormalizeText(
            baseOptions.input_prompt_negative,
            'prompt_negative'
        );
        baseOptions.allCharacterPrompts = sanitizeMarkerFromCharacterPrompts(baseOptions.allCharacterPrompts);
        baseOptions.input_character_prompts = sanitizeMarkerFromCharacterPrompts(baseOptions.input_character_prompts);

        // Restore managed text for forge hydrate (API prompt/uc already expanded above).
        if (managedInputSnapshots.input_prompt !== undefined) {
            baseOptions.input_prompt = managedInputSnapshots.input_prompt;
        }
        if (managedInputSnapshots.input_uc !== undefined) {
            baseOptions.input_uc = managedInputSnapshots.input_uc;
        }
        if (managedInputSnapshots.input_prompt_negative !== undefined) {
            baseOptions.input_prompt_negative = managedInputSnapshots.input_prompt_negative;
        }
        if (managedInputSnapshots.input_character_prompts) {
            baseOptions.input_character_prompts = managedInputSnapshots.input_character_prompts;
        }

        // compiled_prompt is written earlier (before this pass); strip internal append markers so they never reach client/metadata.
        const compiledPromptRef = baseOptions.dynamic_generation?.compiled_prompt;
        if (compiledPromptRef) {
            if (compiledPromptRef.prompt != null) {
                compiledPromptRef.prompt = sanitizeAndNormalizeText(compiledPromptRef.prompt, 'prompt');
            }
            if (compiledPromptRef.uc != null) {
                compiledPromptRef.uc = sanitizeAndNormalizeText(compiledPromptRef.uc, 'uc');
            }
            compiledPromptRef.characterPrompts = sanitizeMarkerFromCharacterPrompts(compiledPromptRef.characterPrompts);
        }

        // Trace: store full buildOptions output (no sanitization per user request)
        try {
            if (body.requestId) {
                __runtimeGr.getTracing().addEvent(body.requestId, {
                    type: 'build_options',
                    options: baseOptions,
                    stageData: stageData || null
                });
            }
        } catch {}

        if (body.mcp_generated === true || body.mcpGenerated === true) {
            baseOptions.mcp_generated = true;
        }

        return baseOptions;
    } catch (error) {
        throw error;
    }
};

async function handleGeneration(globalResources, opts, returnImage = false, presetName = null, workspaceId = null, req = null, streamingCallback = null, ws = null, handler = null, baseMetadata = null, stageSeeds = null) {
    bindRuntimeGlobalResources(globalResources);
    const seed = opts.seed || Math.floor(0x100000000 * Math.random() - 1);
    const layer1Seed = opts.layer1Seed || null;
    
    opts.n_samples = 1;
    opts.seed = seed;
    if (opts.action === __runtimeGr.getNekoAiService('Action').INPAINT) {
        opts.add_original_image = false;
        opts.extra_noise_seed = seed;
    } else if (opts.action === __runtimeGr.getNekoAiService('Action').IMG2IMG) {
        opts.color_correct = false;
    }
    __runtimeGr.getLogger().normal(`🚀 Generating (seed: ${seed})`);
    __runtimeGr.getLogger().detailed(`🎬 Streaming callback: ${streamingCallback !== null && typeof streamingCallback === 'function'}`);

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
    delete apiOpts.quality_preset_bias;
    delete apiOpts.append_transparency;
    delete apiOpts.transparency_bias;
    delete apiOpts.append_uc;
    delete apiOpts.input_prompt;
    delete apiOpts.input_uc;
    delete apiOpts.input_prompt_negative;
    delete apiOpts.input_character_prompts;
    delete apiOpts.vibe_transfer;
    delete apiOpts.normalize_vibes;
    delete apiOpts.chara_reference_source;
    delete apiOpts.chara_reference_type;
    delete apiOpts.chara_reference_strength;
    delete apiOpts.chara_reference_with_style;
    delete apiOpts.chara_reference_fidelity;
    delete apiOpts.director_session_id;
    delete apiOpts.director_message_id;
    delete apiOpts.novel_note_id;
    delete apiOpts.novel_story_cursor_line;
    delete apiOpts.history;
    delete apiOpts.text_replacements_seed;
    delete apiOpts.dynamic_generation;
    delete apiOpts.stageIndex;
    delete apiOpts.stageType;
    delete apiOpts.totalStages;
    delete apiOpts.stageSeeds;
    delete apiOpts.pipeline;
    delete apiOpts.text_replacements;
    delete apiOpts.auto_clean_uc;
    delete apiOpts.keep_newlines;
    delete apiOpts.auto_char_numerize;
    delete apiOpts.prompt_normalize;
    delete apiOpts.emphasis_normalization;
    // Note: deduplicate_tags intentionally NOT deleted — nekoai-js reads it, then strips it before the API request.
    delete apiOpts.stepPreviewWidth;
    delete apiOpts.stepPreviewHeight;
    delete apiOpts.requestId;
    delete apiOpts.max_enhance_source;

    // Process character prompts: only enabled characters go to API, all characters go to forge_data
    if (opts.allCharacterPrompts && Array.isArray(opts.allCharacterPrompts)) {
        // Post-process character prompts: replace 1girl/1boy with girl/boy (skipped when auto char numerize is off)
        const processedCharacterPrompts = opts.allCharacterPrompts.map(char => ({
            ...char,
            prompt: opts.auto_char_numerize === false ? char.prompt : char.prompt.replace(/1girl/g, "girl").replace(/1boy/g, "boy")
        }));
        
        // Filter enabled characters for API request
        const enabledCharacters = processedCharacterPrompts.filter(char => char.enabled);
        
        // Convert to API format: remove chara_name and use_coords from individual characters.
        // Stock nekoai-js: null/undefined center is treated as non-0.5 → use_coords true,
        // then fills every center to 0.5/0.5 and collapses multi-char. Always send explicit
        // 0.5 placeholders when Auto Position / no real placements.
        const hasCustomCoords = enabledCharacters.some((char) => {
            const x = char.center?.x;
            const y = char.center?.y;
            if (typeof x !== 'number' || typeof y !== 'number') return false;
            return x !== 0.5 || y !== 0.5;
        });
        // Explicit false (Auto Position) wins; otherwise only real placements enable coords.
        const useCoords = opts.use_coords === false ? false : hasCustomCoords;

        const apiCharacters = enabledCharacters.map(char => {
            let center = char.center;
            if (!useCoords || !center || typeof center.x !== 'number' || typeof center.y !== 'number') {
                center = { x: 0.5, y: 0.5 };
            }
            return {
                prompt: char.prompt,
                uc: char.uc,
                center,
                enabled: char.enabled
            };
        });
        
        if (apiCharacters.length > 0) {
            apiOpts.characterPrompts = apiCharacters;
            apiOpts.use_coords = useCoords;
        }
    }
    
    // Get balance before generation
    let creditUsage;
    
    try {
        // Tripwire: block generation while NovelAI is locked after repeated API errors.
        if (__runtimeGr.isServiceLocked('novelai')) {
            throw new Error('NovelAI is temporarily locked after repeated API errors. An admin must review the Service Key in the Security Center to unlock it.');
        }
        const statusMonitor = __runtimeGr.getNovelAiStatusMonitor?.();
        if (statusMonitor) {
            statusMonitor.assertImageGenerationAllowed();
        }
        const accountHealth = __runtimeGr.getAccountDataHealth?.();
        if (accountHealth?.accountStanding === 'banned') {
            throw new Error(accountHealth.banMessage || 'NovelAI account is banned');
        }
        __runtimeGr.getImageCounter().logGeneration();

        // Plain img2img: NovelAI's stream endpoint does not emit step events (often returns a ZIP).
        // Inpaint (infill) and text2img do stream. Keep batch ZIP for IMG2IMG only.
        const ActionEnum = __runtimeGr.getNekoAiService('Action');
        const wantsStream = streamingCallback !== undefined && typeof streamingCallback === 'function';
        const canStreamAction = opts.action !== ActionEnum.IMG2IMG;

        if (wantsStream && canStreamAction) {
            // Streaming generation with callback (GENERATE / INPAINT emit step intermediates)
            const client = __runtimeGr.getNovelAiClient();
            if (!client) {
                throw new Error('NovelAI client is not available. Please configure API key in secure.config.json.');
            }
            const streamingResponse = await client.generateImage(apiOpts, true, true);

            // Check if response is an AsyncGenerator (streaming)
            if (streamingResponse && typeof streamingResponse[Symbol.asyncIterator] === "function") {
                __runtimeGr.getLogger().detailed("🎬 Streaming generation started");
                let stepPreviewBatcher = null;
                const stepProgressBase = {
                    hasDynamicGen: !!opts.dynamic_generation,
                    isUpscaling: !!opts.upscale
                };
                if (opts.stageIndex !== undefined) {
                    stepProgressBase.totalStages = opts.totalStages;
                    stepProgressBase.currentStage = opts.stageIndex + 1;
                    stepProgressBase.stageType = opts.stageType;
                }
                if (ws && handler && typeof handler.createStepPreviewBatcher === 'function') {
                    stepPreviewBatcher = handler.createStepPreviewBatcher(
                        ws,
                        opts.requestId || 'generation',
                        stepProgressBase
                    );
                }
                const streamIterator = streamingResponse[Symbol.asyncIterator]();
                try {
                while (true) {
                    if (isStagedGenerationCancelled(handler, opts.requestId)) {
                        break;
                    }
                    const iterResult = await streamIterator.next();
                    if (iterResult.done) {
                        break;
                    }
                    const event = iterResult.value;
                    if (isStagedGenerationCancelled(handler, opts.requestId)) {
                        break;
                    }
                    if (event.event_type === __runtimeGr.getNekoAiService('EventType').INTERMEDIATE) {
                        const rawImageBuffer = Buffer.from(event.image.data);
                        let jpegBuffer = rawImageBuffer;
                        try {
                            jpegBuffer = await encodeStepPreviewJpeg(
                                rawImageBuffer,
                                opts.stepPreviewWidth,
                                opts.stepPreviewHeight
                            );
                        } catch (encodeErr) {
                            console.warn('⚠️ Step preview JPEG encode failed, sending raw frame:', encodeErr.message);
                        }
                        const stepFrame = {
                            currentStep: event.step_ix,
                            totalSteps: opts.steps || 25,
                            imageData: jpegBuffer.toString('base64'),
                            imageFormat: 'jpeg'
                        };
                        if (stepPreviewBatcher) {
                            stepPreviewBatcher.add(stepFrame);
                        } else if (ws && handler) {
                            handler.sendGenerationProgress(ws, opts.requestId || 'generation', {
                                phase: 'generating',
                                ...stepProgressBase,
                                ...stepFrame
                            });
                        }

                        await streamingCallback({
                            type: 'intermediate',
                            step: event.step_ix,
                            image: rawImageBuffer,
                            timestamp: Date.now()
                        });
                        
                    } else if (event.event_type === __runtimeGr.getNekoAiService('EventType').FINAL) {
                        img = event.image;
                        break;
                    }
                }
                } finally {
                if (stepPreviewBatcher) {
                    if (isStagedGenerationCancelled(handler, opts.requestId)) {
                        stepPreviewBatcher.dispose();
                    } else {
                        stepPreviewBatcher.flush();
                    }
                }
                if (isStagedGenerationCancelled(handler, opts.requestId) && typeof streamIterator.return === 'function') {
                    try {
                        await streamIterator.return();
                    } catch (_streamCloseErr) { /* ignore */ }
                }
                }
            } else if (Array.isArray(streamingResponse) && streamingResponse[0]) {
                // Library returned batch images instead of a stream (e.g. action without step stream)
                console.log("⚠️ Streaming unavailable for this action — using batch result");
                img = streamingResponse[0];
            } else {
                // Fallback to regular generation if streaming not available
                console.log("⚠️ Streaming not available, falling back to regular generation");
                const clientFallback = __runtimeGr.getNovelAiClient();
                if (!clientFallback) {
                    throw new Error('NovelAI client is not available. Please configure API key in secure.config.json.');
                }
                [img] = await clientFallback.generateImage(apiOpts, false, true, true);
            }
        } else {
            // Regular non-streaming generation (also plain img2img — no NovelAI step stream)
            if (wantsStream && !canStreamAction) {
                console.log('⚠️ Plain img2img has no NovelAI step stream — using batch /ai/generate-image');
            }
            const client = __runtimeGr.getNovelAiClient();
            if (!client) {
                throw new Error('NovelAI client is not available. Please configure API key in secure.config.json.');
            }
            [img] = await client.generateImage(apiOpts, false, true, true);
            console.log('✅ Image generation completed');
        }

        if (isStagedGenerationCancelled(handler, opts.requestId) && !img) {
            const cancelErr = new Error('Generation cancelled');
            cancelErr.code = 'GENERATION_CANCELLED';
            throw cancelErr;
        }

        if (!img) {
            const emptyStreamErr = new Error('Streaming completed without a final image from NovelAI');
            emptyStreamErr.code = 'STREAM_NO_FINAL';
            throw emptyStreamErr;
        }

        // Successful round-trip to NovelAI — reset the tripwire failure counter.
        __runtimeGr.getApiKeyManager().recordApiSuccess('novelai');
        
        // Get new balance and calculate credit usage
        creditUsage = await __runtimeGr.calculateCreditUsage();
        
        if (creditUsage.totalUsage > 0) {
            console.log(`💰 Image Generation Cost: ${creditUsage.totalUsage} ${creditUsage.usageType === 'paid' ? 'paid' : 'fixed'}`);
        }
        
    } catch (error) {
        // Tripwire: record admin-fixable NovelAI API failures (skip client-side cancels).
        if (error && error.code !== 'GENERATION_CANCELLED') {
            const apiKeyManager = __runtimeGr.getApiKeyManager();
            const status = apiKeyManager.deriveStatusCode(error);
            if (status !== null) {
                apiKeyManager.recordApiFailure('novelai', status, error.message);
            }
        }
        // Preserve exact NovelAI message + status/code; do not wrap into a new Error that drops them.
        if (error && typeof error === 'object') {
            if (error.statusCode == null && error.status != null) {
                error.statusCode = error.status;
            }
            throw error;
        }
        const fallbackErr = new Error(String(error));
        fallbackErr.name = 'ImageGenerationError';
        throw fallbackErr;
    }
    
    const timestamp = Date.now().toString();
    let namePrefix = presetName || 'generated';
    
    // Generate filename based on standard generation
    let name;
    name = `${timestamp}_${namePrefix}_${seed}.png`;
    
    const shouldSave = opts.no_save !== true;
    
    if (returnImage) {
        let buffer = Buffer.from(img.data);
        
        // Extract stage data before metadata operations (for pipeline tracking)
        let stageData = null;
        if (baseMetadata) {
            stageData = {
                prompt: opts.prompt,
                uc: opts.negative_prompt,
                characterPrompts: opts.allCharacterPrompts || undefined,
                dynamic_generation: opts.dynamic_generation?.compiled_prompt || undefined
            };
        }
        
        // Prepare forge metadata
        let forgeData = {
            date_generated: Date.now(),
            request_type: 'preset',
            generation_type: 'regular',
            upscale_ratio: null,
            upscaled_at: null
        };
        if (opts.mcp_generated === true || opts.mcpGenerated === true) {
            forgeData.mcp_generated = true;
        }
        
        // Add disabled characters and character names to forge metadata if present

        if (opts.input_character_prompts) {
            forgeData.allCharacters = opts.input_character_prompts;
            forgeData.use_coords = opts.use_coords;
        } else if (opts.allCharacterPrompts && Array.isArray(opts.allCharacterPrompts) && opts.allCharacterPrompts.length > 0) {
            // Post-process character prompts for forge metadata: replace 1girl/1boy with girl/boy (skipped when auto char numerize is off)
            const processedCharacterPrompts = opts.allCharacterPrompts.map(char => ({
                ...char,
                prompt: opts.auto_char_numerize === false ? char.prompt : char.prompt.replace(/1girl/g, "girl").replace(/1boy/g, "boy")
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

        // Add image source info if applicable
        if ((opts.action === __runtimeGr.getNekoAiService('Action').IMG2IMG || opts.action === __runtimeGr.getNekoAiService('Action').INPAINT) && opts.image) {
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
        
        // Save editor input values for hydrate (managed ids preserved when present; see sanitize snapshots above)
        if (opts.input_prompt !== undefined) {
            forgeData.input_prompt = opts.input_prompt;
        }
        if (opts.input_uc !== undefined) {
            forgeData.input_uc = opts.input_uc;
        }
        if (opts.input_prompt_negative !== undefined) {
            forgeData.input_prompt_negative = opts.input_prompt_negative;
        }
        // Add new parameters to forge data
        if (opts.dataset_config !== undefined) {
            forgeData.dataset_config = opts.dataset_config;
        }
        if (opts.append_quality !== undefined) {
            forgeData.append_quality = opts.append_quality;
        }
        if (opts.quality_preset_bias !== undefined) {
            forgeData.quality_preset_bias = opts.quality_preset_bias;
        }
        if (opts.append_transparency !== undefined) {
            forgeData.append_transparency = opts.append_transparency;
        }
        if (opts.transparency_bias !== undefined) {
            forgeData.transparency_bias = opts.transparency_bias;
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
            if (opts.chara_reference_type !== undefined) {
                forgeData.chara_reference_type = opts.chara_reference_type;
            }
            if (opts.chara_reference_strength !== undefined) {
                forgeData.chara_reference_strength = opts.chara_reference_strength;
            }
            forgeData.chara_reference_with_style = opts.chara_reference_with_style !== undefined ? opts.chara_reference_with_style : false;
            forgeData.chara_reference_fidelity = opts.chara_reference_fidelity !== undefined ? opts.chara_reference_fidelity : 0;
        }
        if (opts.director_session_id !== undefined) {
            forgeData.director_session_id = opts.director_session_id;
        }
        if (opts.director_message_id !== undefined) {
            forgeData.director_message_id = opts.director_message_id;
        }
        if (opts.novel_note_id !== undefined) {
            forgeData.novel_note_id = opts.novel_note_id;
        }
        if (opts.novel_story_cursor_line !== undefined) {
            forgeData.novel_story_cursor_line = opts.novel_story_cursor_line;
        }
        if (opts.dynamic_generation !== undefined) {
            forgeData.dynamic_generation = sanitizeDynamicGenerationForForge(opts.dynamic_generation);
            if (opts.dynamic_generation?.compiled_prompt?.generated_image_name) {
                forgeData.generated_image_name = opts.dynamic_generation.compiled_prompt.generated_image_name;
            }
        }

        // Add text replacement seeds to forge data if any replacements were used
        if (opts.text_replacements_seed && Array.isArray(opts.text_replacements_seed) && opts.text_replacements_seed.length > 0) {
            forgeData.text_replacements_seed = opts.text_replacements_seed;
        }
        // Add the original pipeline and text_replacements arrays to forge_data
        if (opts.pipeline !== undefined) {
            forgeData.pipeline = opts.pipeline;
        }
        if (opts.text_replacements !== undefined) {
            forgeData.text_replacements = opts.text_replacements;
        }
        if (opts.text_overlays && Array.isArray(opts.text_overlays) && opts.text_overlays.length > 0) {
            forgeData.text_overlays = opts.text_overlays;
        }
        if (opts.stage_seeds && Array.isArray(opts.stage_seeds) && opts.stage_seeds.length > 0) {
            forgeData.stage_seeds = opts.stage_seeds;
        }
        if (opts.stageIndex !== undefined) {
            forgeData.stage_index = opts.stageIndex;
        }
        // Save pipeline control flags
        if (opts.save_base_output !== undefined) {
            forgeData.save_base_output = opts.save_base_output;
        }

        // Save auto-clean UC setting
        if (opts.auto_clean_uc !== undefined) {
            forgeData.auto_clean_uc = opts.auto_clean_uc;
        }
        // Save keep-newlines setting so reload can restore the toggle state
        if (opts.keep_newlines !== undefined) {
            forgeData.keep_newlines = opts.keep_newlines;
        }
        // Save auto-char-numerize setting so reload can restore the toggle state
        if (opts.auto_char_numerize !== undefined) {
            forgeData.auto_char_numerize = opts.auto_char_numerize;
        }
        // Save prompt-normalize setting so reload can restore the toggle state
        if (opts.prompt_normalize !== undefined) {
            forgeData.prompt_normalize = opts.prompt_normalize;
        }
        // Save deduplicate-tags setting so reload can restore the toggle state
        if (opts.deduplicate_tags !== undefined) {
            forgeData.deduplicate_tags = opts.deduplicate_tags;
        }
        if (opts.emphasis_normalization && typeof opts.emphasis_normalization === 'object') {
            forgeData.emphasis_normalization = opts.emphasis_normalization;
        }
        if (opts.chain_source && typeof opts.chain_source === 'string' && opts.chain_source.length > 0) {
            forgeData.chain_source = opts.chain_source;
        }

        // Update buffer with forge metadata
        let finalBuffer;
        let metadata;
        if (baseMetadata) {
            metadata = JSON.parse(baseMetadata.tEXt.Comment);
            // Stage mode: preserve base metadata, update only specific forge_data fields
            finalBuffer = __runtimeGr.getPngMetadata().stripPngTextChunks(buffer);
            
            forgeData = metadata.forge_data || {};
            mergeNovelForgeFieldsFromOpts(forgeData, opts);
            if (opts.mcp_generated === true || opts.mcpGenerated === true) {
                forgeData.mcp_generated = true;
            }

            // Conditionally update only allowed fields
            forgeData.date_generated = Date.now();
            if (opts.chain_source && typeof opts.chain_source === 'string' && opts.chain_source.length > 0) {
                forgeData.chain_source = opts.chain_source;
            }

            // Inject stage_seeds if provided and we're saving (stages accumulate seeds from previous stages)
            if (stageSeeds && Array.isArray(stageSeeds)) {
                const currentStageSeedData = {
                    seed: seed,
                    prompt: opts.prompt || '',
                    uc: opts.negative_prompt || '',
                    characterPrompts: opts.allCharacterPrompts || undefined
                };
                if (stageData && stageData.dynamic_generation && stageData.dynamic_generation?.success) {
                    currentStageSeedData.dynamic_generation = stageData.dynamic_generation;
                }
                
                const completeStageSeeds = [...(stageSeeds || []), currentStageSeedData];
                forgeData.stage_seeds = completeStageSeeds;
                console.log(`💾 Injecting ${completeStageSeeds.length} stage seeds into metadata (${stageSeeds.length} previous + current)`);
            }

            await ensureForgeDataBlurhash(forgeData, buffer);

            // Ensure NAI origin Comment lives in stealth on these stage pixels; sign forge attestation
            const pngMeta = __runtimeGr.getPngMetadata();
            const ensured = await pngMeta.ensureOriginCommentInStealth(buffer);
            finalBuffer = ensured.wroteStealth
                ? pngMeta.stripPngTextChunks(ensured.buffer)
                : pngMeta.stripPngTextChunks(buffer);
            forgeData.origin_response_embedded = !!ensured.embedded;
            delete forgeData.forge_signed_hash;
            metadata.forge_data = { ...forgeData };
            // Write Comment first so forge_data matches what we attest (incl. software defaults later if needed)
            finalBuffer = pngMeta.insertTextChunk(finalBuffer, 'Comment', JSON.stringify(metadata));
            if (baseMetadata.tEXt?.Source) {
                finalBuffer = pngMeta.insertTextChunk(finalBuffer, 'Source', baseMetadata.tEXt.Source);
            }
            if (baseMetadata.tEXt?.Software) {
                finalBuffer = pngMeta.insertTextChunk(finalBuffer, 'Software', baseMetadata.tEXt.Software);
            }
            try {
                const rgb = await pngMeta.extractRgbBytes(finalBuffer);
                // attestForgeData: modules/pngMetadata.js
                pngMeta.attestForgeData(rgb, ensured.originComment || '', metadata.forge_data);
                finalBuffer = pngMeta.insertTextChunk(finalBuffer, 'Comment', JSON.stringify(metadata));
            } catch (signErr) {
                console.error('Forge image signing failed (stage):', signErr.message);
            }
            
            console.log(`📝 Stage metadata: preserved base, updated forge_data (origin_response_embedded=${!!forgeData.origin_response_embedded})`);
        } else {
            // Normal mode: create new metadata
            await ensureForgeDataBlurhash(forgeData, buffer);
            // finalizeWithForgeData: modules/pngMetadata.js
            finalBuffer = await __runtimeGr.getPngMetadata().finalizeWithForgeData(buffer, forgeData);

            // Extract the metadata that was just embedded into the buffer
            const rawMetadata = __runtimeGr.getPngMetadata().readMetadata(finalBuffer);
            metadata = rawMetadata?.tEXt?.Comment ? JSON.parse(rawMetadata.tEXt.Comment) : null;
        }
        
        const targetWorkspaceId = workspaceId || __runtimeGr.getWorkspaceManager().getActiveWorkspace(req?.session?.id);
        
        // Always send receipt notification when there's a cost, regardless of whether image is saved
        if (creditUsage.totalUsage > 0) {
            const receiptData = {
                type: 'generation',
                cost: creditUsage.totalUsage,
                creditType: creditUsage.usageType,
                date: Date.now().valueOf()
            };
            
            const plumbing = __runtimeGr.getDataPlumbing();
            plumbing.publish('ws:broadcast:receipt', receiptData);
        }
        
        if (shouldSave) {
            fs.writeFileSync(path.join(__runtimeGr.getPath('images'), name), finalBuffer);
            __runtimeGr.getLogger().normal(`💾 Saved: ${name}`);
            
            // Add file to workspace
            __runtimeGr.getWorkspaceManager().addToWorkspaceArray('files', name, targetWorkspaceId);
            
            // Register image in metadata DB (always); receipt row only when credits were charged
            const generationReceiptData = creditUsage.totalUsage > 0 ? {
                type: 'generation',
                cost: creditUsage.totalUsage,
                creditType: creditUsage.usageType,
                date: Date.now().valueOf()
            } : null;
            await __runtimeGr.getMetadataDatabase().addReceiptMetadata(name, __runtimeGr.getPath('images'), generationReceiptData, forgeData);
            await recordReplicationGalleryJournal(name, targetWorkspaceId);

            // Send progress update indicating preview generation is starting
            if (ws && handler) {
                const progressData = {
                    phase: 'previews',
                    hasDynamicGen: !!opts.dynamic_generation,
                    isUpscaling: !!opts.upscale
                };
                
                // Add stage information if available (convert to 1-based indexing for UI)
                if (opts.stageIndex !== undefined) {
                    progressData.totalStages = opts.totalStages;
                    progressData.currentStage = opts.stageIndex + 1;
                    progressData.stageType = opts.stageType;
                }
                
                handler.sendGenerationProgress(ws, opts.requestId || 'generation', progressData);
            }

            // Generate preview
            const baseName = __runtimeGr.getPngMetadata().getBaseName(name);

            // Generate main / @2x / @lq previews + BlurHash (replaces @blur.webp)
            const previewResult = await generateMobilePreviews(path.join(__runtimeGr.getPath('images'), name), baseName);
            await storePreviewBlurhash(__runtimeGr, name, previewResult);
            __runtimeGr.getLogger().detailed(`📸 Generated previews for ${baseName}`);

            // Last pipeline stage keeps phase:complete; earlier saved stages use stage_complete
            sendStageOrGenerationComplete(ws, handler, opts, {
                isUpscaling: !!opts.upscale,
                contentLength: finalBuffer.length,
                filename: name
            });
        }
        
        if (opts.upscale) {
            console.log(`✅ Upscaling is enabled! Processing upscale...`);
            // Send progress update indicating upscaling is starting
            if (ws && handler) {
                const progressData = {
                    phase: 'upscaling',
                    hasDynamicGen: !!opts.dynamic_generation,
                    isUpscaling: true
                };
                
                // Add stage information if available (convert to 1-based indexing for UI)
                if (opts.stageIndex !== undefined) {
                    progressData.totalStages = opts.totalStages;
                    progressData.currentStage = opts.stageIndex + 1;
                    progressData.stageType = opts.stageType;
                }
                
                handler.sendGenerationProgress(ws, opts.requestId || 'generation', progressData);
            }

            const scale = opts.upscale === true ? 4 : opts.upscale;
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const { width: upscaleWidth, height: upscaleHeight } = await getImageDimensions(finalBuffer);
            const scaledBuffer = await upscaleImageCore(globalResources, finalBuffer, scale, upscaleWidth, upscaleHeight);
            
            // Get new balance and calculate credit usage for upscaling
            const upscaleCreditUsage = await __runtimeGr.calculateCreditUsage();
            
            if (upscaleCreditUsage.totalUsage > 0) {
                console.log(`💰 Upscaling Cost: ${upscaleCreditUsage.totalUsage} ${upscaleCreditUsage.usageType === 'paid' ? 'paid' : 'fixed'}`);
            }
            
            // Copy origin Comment onto the upscaled PNG; record measured ratio (NAI live 2x, not the old implicit 4).
            const ratio = await resolveUpscaleRatio(scaledBuffer, upscaleWidth, scale, 'novelai');
            const upscaledForgeData = {
                upscale_ratio: ratio,
                upscaled_at: Date.now(),
                generation_type: 'upscaled'
            };
            await ensureForgeDataBlurhash(upscaledForgeData, scaledBuffer);
            const updatedScaledBuffer = __runtimeGr.getPngMetadata().copyMetadataToImage(finalBuffer, scaledBuffer, upscaledForgeData);
            const upscaledName = name.replace('.png', '_upscaled.png');

            if (shouldSave) {
                fs.writeFileSync(path.join(__runtimeGr.getPath('images'), upscaledName), updatedScaledBuffer);
                console.log(`💾 Saved: ${upscaledName}`);
                
                // Add upscaled file to workspace
                __runtimeGr.getWorkspaceManager().addToWorkspaceArray('files', upscaledName, targetWorkspaceId);
                
                // Update metadata cache for upscaled image
                const upscaledReceiptData = {
                    type: 'upscaling',
                    cost: upscaleCreditUsage.totalUsage,
                    creditType: upscaleCreditUsage.usageType,
                    date: Date.now().valueOf()
                };
                // Attach receipt to parent image instead of upscaled image
                await __runtimeGr.getMetadataDatabase().addReceiptMetadata(name, __runtimeGr.getPath('images'), upscaledReceiptData, upscaledForgeData);
                await recordReplicationGalleryJournal(upscaledName, targetWorkspaceId);
                
                const upscaledPreviewResult = await generateMobilePreviews(path.join(__runtimeGr.getPath('images'), upscaledName), upscaledBaseName);
                await storePreviewBlurhash(__runtimeGr, upscaledName, upscaledPreviewResult);
                
                const plumbing = __runtimeGr.getDataPlumbing();
                plumbing.publish('ws:broadcast:receipt', upscaledReceiptData);
            }

            sendStageOrGenerationComplete(ws, handler, opts, {
                isUpscaling: false,
                contentLength: updatedScaledBuffer.length,
                filename: upscaledName
            });

        // Return result with appropriate seed information
        const result = {
            buffer: updatedScaledBuffer,
            filename: upscaledName,
            saved: shouldSave,
            seed: seed,
            compiled_prompt: opts.dynamic_generation?.compiled_prompt,
            text_replacements_seed: opts.text_replacements_seed && Array.isArray(opts.text_replacements_seed) && opts.text_replacements_seed.length > 0 ? opts.text_replacements_seed : undefined,
            stageData: stageData // Only populated for pipeline stages
        };
        return result;
        }
        
        if (!shouldSave && !isLastPipelineStage(opts) && ws && handler && finalBuffer) {
            try {
                const jpegBuffer = await encodeStepPreviewJpeg(
                    finalBuffer,
                    opts.stepPreviewWidth,
                    opts.stepPreviewHeight
                );
                sendStageOrGenerationComplete(ws, handler, opts, {
                    isUpscaling: false,
                    imageData: jpegBuffer.toString('base64'),
                    imageFormat: 'jpeg'
                });
            } catch (encodeErr) {
                sendStageOrGenerationComplete(ws, handler, opts, { isUpscaling: false });
            }
        }

        // Return result with appropriate seed information
        const finalResult = {
            buffer: finalBuffer,
            filename: name,
            saved: shouldSave,
            seed: seed,
            compiled_prompt: opts.dynamic_generation?.compiled_prompt,
            text_replacements_seed: opts.text_replacements_seed && Array.isArray(opts.text_replacements_seed) && opts.text_replacements_seed.length > 0 ? opts.text_replacements_seed : undefined,
            stageData: stageData, // Only populated for pipeline stages
            metadata // The complete metadata object that gets embedded in the PNG
        };
        return finalResult;
    } else {
        // Save image and return filename only (legacy behavior)
        if (shouldSave) {
            const filePath = path.join(__runtimeGr.getPath('images'), name);
            await img.save(filePath);
            console.log(`💾 Saved: ${name}`);
            
            // Generate preview
            const baseName = __runtimeGr.getPngMetadata().getBaseName(name);
            
            const legacyPreviewResult = await generateMobilePreviews(path.join(__runtimeGr.getPath('images'), name), baseName);
            await storePreviewBlurhash(__runtimeGr, name, legacyPreviewResult);
            __runtimeGr.getLogger().detailed(`📸 Generated previews for ${baseName}`);
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
const handleImageRequest = async (globalResources, req, res, opts, presetName = null) => {
    bindRuntimeGlobalResources(globalResources);
    const workspaceId = req.body.workspace || req.query.workspace || null;
    const result = await handleGeneration(globalResources, opts, true, presetName, workspaceId, req);
    
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
async function generateImageWebSocket(globalResources, body, userType, sessionId, streamingCallback = null, ws = null, handler = null, wsServer = null) {
    bindRuntimeGlobalResources(globalResources);
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
        // Ensure a consistent requestId for tracing across modules
        if (!body.requestId) body.requestId = `gen-${Date.now()}`;
        // Start a trace for single generations (pipelines handled separately)
        try {
            __runtimeGr.getTracing().startTrace(body.requestId, { type: 'single_generation', workspace: body.workspace || null });
            __runtimeGr.getTracing().addEvent(body.requestId, { type: 'request_body', body });
        } catch {}

        const model = __runtimeGr.getNekoAiService('Model')[body.model.toUpperCase()];
        if (!model) {
            throw new Error('Invalid model');
        }

        let bodyData = body;
        let baseFilename = null;

        // Check if this is a staged generation
        if (body.pipeline && Array.isArray(body.pipeline) && body.pipeline.length > 0 && body.skip_pipeline_stages !== true) {
            console.log(`🎬 Starting staged generation with ${body.pipeline.length} stages`);
            return await handleStagedGeneration(globalResources, bodyData, sessionId, streamingCallback, ws, handler, wsServer);
        } else {
            __runtimeGr.getLogger().detailed(`🎬 Pipeline stages disabled - running base only`);
            // Continue to regular single generation below
        }

        // Regular single generation - ensure requestId is preserved
        const requestId = body.requestId;
        const opts = await buildOptions(globalResources, bodyData, null, {}, ws, handler, wsServer);
        // Preserve requestId in opts for handleGeneration
        if (requestId) opts.requestId = requestId;
        // Add original filename for metadata tracking if this is img2img and not a frontend upload
        if (bodyData.image && !bodyData.is_frontend_upload) {
            opts.original_filename = baseFilename;
        }

        // Create a mock req object for context functions that need it
        const mockReq = { session: { id: sessionId } };

        // Call handleGeneration directly and return the result
        const result = await handleGeneration(globalResources, opts, true, body?.preset || body?.presetName, body?.workspace, mockReq, streamingCallback, ws, handler);

        // Trace: add final generated image
        try {
            if (result && result.buffer && requestId) {
                __runtimeGr.getTracing().addImageAttachment(requestId, 'final_generated_image', result.buffer, 'png', {
                    seed: result.seed,
                    filename: result.filename
                });
            }
        } catch {}
        
        try { __runtimeGr.getTracing().finalizeTrace(requestId, 'completed', { seed: result.seed, filename: result.filename }); } catch {}
        return result;
    } catch(e) {
        console.error('❌ WebSocket image generation error:', e);
        try { if (body && body.requestId) __runtimeGr.getTracing().finalizeTrace(body.requestId, 'failed', { error: String(e && e.message || e) }); } catch {}
        throw e;
    }
}

function isStagedGenerationCancelled(handler, requestId) {
    return !!(handler && requestId && typeof handler.isGenerationCancelled === 'function' && handler.isGenerationCancelled(requestId));
}

async function waitStageDelayWithCancellation(delayMs, handler, requestId) {
    const pollMs = 250;
    let elapsed = 0;
    while (elapsed < delayMs) {
        if (isStagedGenerationCancelled(handler, requestId)) {
            return false;
        }
        const step = Math.min(pollMs, delayMs - elapsed);
        await new Promise(resolve => setTimeout(resolve, step));
        elapsed += step;
    }
    return true;
}

// Handle staged generation with multiple stages
async function handleStagedGeneration(globalResources, bodyData, sessionId, streamingCallback, ws, handler, wsServer) {
    bindRuntimeGlobalResources(globalResources);
    // Ensure a consistent requestId
    if (!bodyData.requestId) bodyData.requestId = `staged-${Date.now()}`;
    try {
        __runtimeGr.getTracing().startTrace(bodyData.requestId, {
            type: 'staged_generation',
            pipelineLength: Array.isArray(bodyData.pipeline) ? bodyData.pipeline.length : 0,
            workspace: bodyData.workspace || null
        });
        // Log full body (no sanitization per request)
        __runtimeGr.getTracing().addEvent(bodyData.requestId, { type: 'request_body', body: bodyData });
    } catch {}
    try {
        const pipeline = bodyData.pipeline;
        const totalStages = pipeline.length + 1; // +1 for base generation
        const stageSeeds = [];
        let currentBuffer = null;
        let savedFilenames = []; // Array to track all saved stage filenames
        let previousStageBody = { ...bodyData };
        
        // Extract client-provided compiled prompts array (for rerolls from saved images)
        let clientCompiledPrompts = bodyData.stage_compiled_prompts || null;
        if (clientCompiledPrompts && Array.isArray(clientCompiledPrompts)) {
            console.log(`📋 Received ${clientCompiledPrompts.length} compiled prompts from client`);
        }
        
        // Remove dynamic_generation if it has no enabled values (dynamic generation is disabled)
        if (bodyData.dynamic_generation) {
            const hasEnabledValues = !!(
                bodyData.dynamic_generation.tod ||
                bodyData.dynamic_generation.weather ||
                bodyData.dynamic_generation.season ||
                bodyData.dynamic_generation.activity ||
                bodyData.dynamic_generation.action ||
                bodyData.dynamic_generation.optimize ||
                bodyData.dynamic_generation.creative ||
                bodyData.dynamic_generation.clothing ||
                bodyData.dynamic_generation.directive
            );
            
            if (!hasEnabledValues) {
                delete bodyData.dynamic_generation;
                delete previousStageBody.dynamic_generation;
                console.log('🚫 Dynamic generation disabled - no values enabled, removing from request');
            } else {
                // Deep copy dynamic_generation to prevent shared reference issues
                previousStageBody.dynamic_generation = JSON.parse(JSON.stringify(previousStageBody.dynamic_generation));
            }
        }
        
        // Separate variables to track compiled prompts for inheritance
        let normalCompiledPrompt = null;
        let backgroundFocusCompiledPrompt = null;
        
        // Shared context across all stages (weather, time, season should be consistent)
        let sharedContext = null;
        
        let isInBranchChain = false;
        let preBranchState = null; // Stores {buffer, body} - seeds continue normally

        // Calculate hex IDs for all pipeline stages
        const stageHexIds = calculateStageHexIdsFromData(pipeline);
        console.log(`🎬 Processing ${totalStages} stages (1 base + ${pipeline.length} pipeline stages)`);
        console.log(`🔢 Stage hex IDs: 00 (base), ${stageHexIds.join(', ')}`);

        // Create base request body that all stages inherit from
        
        // Track inherited directive - starts with main directive and accumulates through stages
        let inheritedDirective = bodyData.dynamic_generation?.directive || '';

        // Stage 0: Base generation
        console.log(`🎯 Stage 0: Base generation`);

        // Send stage progress update (use 1-based indexing for UI)
        if (ws && handler) {
            handler.sendGenerationProgress(ws, bodyData.requestId || 'generation', {
                phase: 'generating',
                totalStages: totalStages,
                currentStage: 1,
                stageType: 'base'
            });
        }

        // Build options for base generation
        const baseStageData = {
            stageIndex: 0,
            stageType: 'base',
            totalStages: totalStages,
            text_replacements: bodyData.text_replacements || [],
            pipelineStageGeneration: pipeline.length > 0
        };

        const baseOpts = await buildOptions(globalResources, previousStageBody, null, {}, ws, handler, wsServer, baseStageData);

        // Create a mock req object for context functions that need it
        const mockReq = { session: { id: sessionId } };

        // Set no_save flag for base generation based on save_base_output setting
        if (!bodyData.save_base_output) {
            baseOpts.no_save = true;
        }

        // Generate base image
        const baseResult = await handleGeneration(globalResources, baseOpts, true, bodyData?.preset || bodyData?.presetName, bodyData?.workspace, mockReq, streamingCallback, ws, handler);
        
        // Trace: attach base stage image
        try {
            if (bodyData.requestId && baseResult.buffer) {
                __runtimeGr.getTracing().addImageAttachment(bodyData.requestId, 'stage-0-base', baseResult.buffer, 'png', { stageIndex: 0, stageType: 'base' });
            }
        } catch {}
        
        // Store base seed for return value
        const baseSeed = baseResult.seed;
        
        // Extract base metadata for all stages
        const baseMetadata = __runtimeGr.getPngMetadata().readMetadata(baseResult.buffer);
        if (!baseMetadata?.tEXt?.Comment) {
            throw new Error('Failed to extract base metadata');
        }

        // Helper function to check if a replacement should apply to a stage
        const shouldApplyReplacementToStage = (replacement, currentStage) => {
            if (!replacement.body_replacement_stages) {
                // No stage configuration means apply to all stages
                return true;
            }
            
            const stages = replacement.body_replacement_stages;
            if (Array.isArray(stages)) {
                // Specific stages array
                return stages.includes(currentStage);
            }
            
            if (typeof stages === 'object') {
                // Range configuration
                const { start, end } = stages;
                
                if (start !== undefined && end !== undefined) {
                    return currentStage >= start && currentStage <= end;
                } else if (start !== undefined) {
                    return currentStage >= start;
                } else if (end !== undefined) {
                    return currentStage <= end;
                }
            }
            
            // Default to applying if no valid stage configuration
            return true;
        };

        // Helper function to filter locked replacements for a specific stage
        const filterLockedReplacementsForStage = (lockedReplacements, stageIndex, stageBodyReplacements) => {
            // Build a set of replacement names that are newly defined for this stage
            const newReplacementNames = new Set();
            if (stageBodyReplacements && Array.isArray(stageBodyReplacements)) {
                stageBodyReplacements.forEach(replacement => {
                    if (shouldApplyReplacementToStage({ body_replacement_stages: replacement.stages }, stageIndex)) {
                        newReplacementNames.add(replacement.name);
                    }
                });
            }

            // Filter locked replacements
            return lockedReplacements.filter(lockedReplacement => {
                // If this replacement has a persist flag set to true, always include it
                if (lockedReplacement.body_replacement_persist === true) {
                    return shouldApplyReplacementToStage(lockedReplacement, stageIndex);
                }

                // If there's a new body replacement with the same name for this stage, exclude the locked one
                if (newReplacementNames.has(lockedReplacement.key)) {
                    console.log(`🔓 Stage ${stageIndex}: Unlocking '${lockedReplacement.key}' - new replacement defined for this stage`);
                    return false;
                }

                // Check if the locked replacement's stage config applies to this stage
                const applies = shouldApplyReplacementToStage(lockedReplacement, stageIndex);
                if (!applies && lockedReplacement.body_replacement_stages) {
                    console.log(`🔓 Stage ${stageIndex}: Skipping '${lockedReplacement.key}' - not applicable to this stage`);
                }
                return applies;
            });
        };

        // Lock text replacements for all stages
        let allLockedReplacements = [];
        if (baseResult.text_replacements_seed && Array.isArray(baseResult.text_replacements_seed)) {
            allLockedReplacements = baseResult.text_replacements_seed
                .filter(r => r.can_lock !== false)
                .map(r => ({ ...r, locked: true }));
            console.log(`🔒 Locked ${allLockedReplacements.length} text replacements for pipeline stages`);
        }

        currentBuffer = baseResult.buffer;
        
        // Set compiled prompt variables for inheritance - only if successful
        if (baseResult.compiled_prompt && baseResult.compiled_prompt.success !== false) {
            normalCompiledPrompt = baseResult.compiled_prompt;
            console.log('🔍 Set base normal compiled prompt for inheritance');
            
            // If dynamic generation ran successfully, clear client-provided compiled prompts
            // This ensures pipeline stages use fresh data instead of stale client prompts
            if (clientCompiledPrompts) {
                console.log('🔄 Dynamic generation ran successfully - clearing client-provided compiled prompts');
                clientCompiledPrompts = null;
            }
            
            // Extract and store shared context for all pipeline stages
            if (baseResult.compiled_prompt.context) {
                sharedContext = baseResult.compiled_prompt.context;
                console.log('🌍 Set shared context for all pipeline stages:', {
                    hasWeather: !!sharedContext.weather,
                    hasTime: !!sharedContext.time,
                    hasSeason: !!sharedContext.season
                });
            }
        } else if (baseResult.compiled_prompt && baseResult.compiled_prompt.success === false) {
            console.warn('⚠️ Base dynamic generation failed - but preserving context if available');
            // Even if generation failed, preserve context for pipeline stages
            // Context (weather, time, season) is still valid and expensive to regenerate
            if (baseResult.compiled_prompt.context) {
                sharedContext = baseResult.compiled_prompt.context;
                normalCompiledPrompt = {
                    context: sharedContext
                };
                console.log(`💾 Preserved base context for all pipeline stages:`, {
                    hasWeather: !!sharedContext.weather,
                    hasTime: !!sharedContext.time,
                    hasSeason: !!sharedContext.season
                });
            } else {
                normalCompiledPrompt = null;
            }
        }

        // Track saved filename if base generation was saved
        if (baseResult.saved && baseResult.filename) {
            savedFilenames.push({
                filename: baseResult.filename,
                stageId: '00', // Reserved for base stage
                stageIndex: 0,
                stageType: 'base'
            });
            console.log(`💾 Base stage saved: ${baseResult.filename} (ID: 00)`);
        }

        let cancelledEarly = false;

        const buildStagedPartialReturn = (extra = {}) => ({
            buffer: currentBuffer,
            filename: savedFilenames.length > 0 ? savedFilenames[savedFilenames.length - 1].filename : null,
            filenames: savedFilenames,
            saved: savedFilenames.length > 0,
            seed: baseSeed,
            compiled_prompt: baseResult.compiled_prompt,
            text_replacements_seed: baseResult.text_replacements_seed,
            stage_seeds: stageSeeds,
            total_stages: totalStages,
            ...extra
        });

        const sendCancelledCompleteProgress = (completedStages) => {
            if (!ws || !handler) return;
            handler.sendGenerationProgress(ws, bodyData.requestId || 'generation', {
                phase: 'complete',
                totalStages: completedStages,
                currentStage: completedStages,
                stageType: 'complete',
                stoppedEarly: true,
                cancelled: true
            });
        };

        if (isStagedGenerationCancelled(handler, bodyData.requestId)) {
            console.log(`🛑 Generation cancelled after base stage - skipping ${pipeline.length} pipeline stage(s)`);
            sendCancelledCompleteProgress(1);
            try {
                if (bodyData.requestId) {
                    __runtimeGr.getTracing().finalizeTrace(bodyData.requestId, 'completed', {
                        cancelled: true,
                        totalStages: totalStages,
                        savedStages: savedFilenames.length
                    });
                }
            } catch {}
            return buildStagedPartialReturn({ cancelled: true, stopped_early: true });
        }
        
        // Process pipeline stages
        for (let i = 0; i < pipeline.length; i++) {
            const stage = pipeline[i];
            const stageIndex = i + 1;
            const stageHexId = stageHexIds[i] || '??';
            
            console.log(`🎯 Stage ${stageIndex} (${stageHexId}): ${stage.type}`);
            
            // Branch chain detection
            const isBranchStage = stage.branch === true;
            const prevStage = i > 0 ? pipeline[i - 1] : null;
            const prevWasBranch = prevStage && prevStage.branch === true;
            const nextStage = i < pipeline.length - 1 ? pipeline[i + 1] : null;
            const nextIsBranch = nextStage && nextStage.branch === true;
            const isLastInBranchChain = isBranchStage && !nextIsBranch;
            
            // Entering branch chain - save pre-branch state
            if (isBranchStage && !prevWasBranch && !isInBranchChain) {
                console.log(`🌿 Stage ${stageIndex}: Entering branch chain`);
                isInBranchChain = true;
                preBranchState = {
                    buffer: Buffer.from(currentBuffer), // Copy buffer
                    body: JSON.parse(JSON.stringify(previousStageBody)) // Deep copy body
                    // NOTE: Seeds continue to be added to stageSeeds array normally
                };
            }
            
            // Exiting branch chain - restore pre-branch state
            if (!isBranchStage && isInBranchChain && preBranchState) {
                console.log(`🌿 Stage ${stageIndex}: Exiting branch chain, restoring pre-branch state`);
                currentBuffer = preBranchState.buffer;
                previousStageBody = preBranchState.body;
                // NOTE: Do NOT restore stageSeeds - they continue normally
                isInBranchChain = false;
                preBranchState = null;
            }
            
            try {
                if (isStagedGenerationCancelled(handler, bodyData.requestId)) {
                    console.log(`🛑 Generation cancelled before stage ${stageIndex} - skipping remaining ${pipeline.length - i} stage(s)`);
                    cancelledEarly = true;
                    sendCancelledCompleteProgress(stageIndex);
                    break;
                }

                // Send stage progress update (use 1-based indexing for UI: stageIndex + 1)
                if (ws && handler) {
                    handler.sendGenerationProgress(ws, bodyData.requestId || 'generation', {
                        phase: 'generating',
                        totalStages: totalStages,
                        currentStage: stageIndex + 1,
                        stageType: stage.type
                    });
                }
                
                // Random delay between stages (5-10 seconds)
                const delayMs = Math.floor(Math.random() * 5000) + 5000; // 5000-10000ms
                console.log(`⏳ Stage delay: ${delayMs}ms`);
                
                if (ws && handler) {
                    handler.sendGenerationProgress(ws, bodyData.requestId || 'generation', {
                        phase: 'stage_delay',
                        totalStages: totalStages,
                        currentStage: stageIndex + 1,
                        delayMs: delayMs
                    });
                }
                
                const delayCompleted = await waitStageDelayWithCancellation(delayMs, handler, bodyData.requestId);
                if (!delayCompleted) {
                    console.log(`🛑 Generation cancelled during stage ${stageIndex} delay - skipping remaining ${pipeline.length - i} stage(s)`);
                    cancelledEarly = true;
                    sendCancelledCompleteProgress(stageIndex);
                    break;
                }
                
                // Validate stage parameters
                if (!stage.type) {
                    throw new Error(`Stage ${stageIndex}: Missing stage type`);
                }
                
                if (stage.type === 'expand-canvas') {
                    if (!stage.resolution) {
                        throw new Error(`Stage ${stageIndex}: Missing resolution for expand-canvas stage`);
                    }
                    if (stage.bias === undefined || stage.bias < 0 || stage.bias > 4) {
                        throw new Error(`Stage ${stageIndex}: Invalid bias value for expand-canvas stage`);
                    }
                } else if (stage.type === 'enhance' || stage.type === 'variation') {
                    // For variation, only validate strength/noise when using base image
                    const needsImg2Img = stage.type === 'enhance' || stage.maxEnhance === true || stage.useBaseImage === true;
                    if (needsImg2Img) {
                        if (stage.strength === undefined || stage.strength < 0 || stage.strength > 1) {
                            throw new Error(`Stage ${stageIndex}: Invalid strength value for ${stage.type} stage`);
                        }
                        if (stage.noise === undefined || stage.noise < 0 || stage.noise > 1) {
                            throw new Error(`Stage ${stageIndex}: Invalid noise value for ${stage.type} stage`);
                        }
                    }
                } else {
                    throw new Error(`Stage ${stageIndex}: Unknown stage type: ${stage.type}`);
                }
                
                // Determine if this stage should save
                const shouldSave = stage.saveResults || isLastInBranchChain || (i === pipeline.length - 1) || stage.stopAtStage;
                
                // Force save if last stage in branch chain
                if (isLastInBranchChain) {
                    console.log(`🌿 Stage ${stageIndex}: Last stage in branch chain - forcing save`);
                }

                // Strip TEXt metadata from current buffer before using as image
                currentBuffer = __runtimeGr.getPngMetadata().stripPngTextChunks(currentBuffer);

                // Build stage request body by inheriting from previous stage
                let stageRequestBody = { ...previousStageBody };
                
                // Deep copy dynamic_generation to prevent shared reference issues between stages
                if (stageRequestBody.dynamic_generation) {
                    stageRequestBody.dynamic_generation = JSON.parse(JSON.stringify(stageRequestBody.dynamic_generation));
                }
                
                // Determine which compiled prompt to inherit based on current stage's background focus state
                const isCurrentStageBackgroundFocus = stage.type === 'expand-canvas' && stage.backgroundFocus;
                
                // Check for compiled prompt from previous stage - prioritize client-provided, then runtime stageSeeds
                let previousStageCompiledPrompt = null;
                
                // First priority: Client-provided compiled prompts (from rerolling saved images)
                // clientCompiledPrompts[0] = first pipeline stage, [1] = second pipeline stage, etc.
                if (clientCompiledPrompts && Array.isArray(clientCompiledPrompts)) {
                    // For first pipeline stage (i === 0), check if base generation had a compiled prompt (index would be -1, which doesn't exist)
                    // For subsequent stages, check the previous pipeline stage
                    if (i > 0) {
                        const prevStageIndex = i - 1;
                        if (clientCompiledPrompts[prevStageIndex]) {
                            previousStageCompiledPrompt = clientCompiledPrompts[prevStageIndex];
                            console.log(`📋 Stage ${stageIndex}: Using client-provided compiled prompt from pipeline stage ${prevStageIndex}`);
                        }
                    }
                    // Note: For i === 0 (first pipeline stage), we skip client-provided check and fall through to runtime or base
                }
                
                // Second priority: Runtime-generated stageSeeds array (from current generation session)
                if (!previousStageCompiledPrompt && stageSeeds.length > 0) {
                    // Get the last stage's data (the immediate previous stage)
                    const previousStageSeedData = stageSeeds[stageSeeds.length - 1];
                    if (previousStageSeedData?.dynamic_generation?.success) {
                        previousStageCompiledPrompt = previousStageSeedData.dynamic_generation;
                        console.log(`📋 Stage ${stageIndex}: Using runtime compiled prompt from previous stage (stage ${stageSeeds.length - 1})`);
                    }
                }
                
                // Inject the appropriate compiled prompt for this stage
                if (previousStageCompiledPrompt) {
                    // Use compiled prompt from previous stage in seeds array (priority)
                    if (!stageRequestBody.dynamic_generation) {
                        stageRequestBody.dynamic_generation = {};
                    }
                    stageRequestBody.dynamic_generation.compiled_prompt = { ...previousStageCompiledPrompt };
                    
                    // Always merge in shared context to ensure consistency
                    if (sharedContext) {
                        stageRequestBody.dynamic_generation.compiled_prompt.context = sharedContext;
                        console.log(`📋 Stage ${stageIndex}: Using previous stage compiled prompt with shared context`);
                    } else {
                        console.log(`📋 Stage ${stageIndex}: Using previous stage compiled prompt for inheritance`);
                    }
                } else if (isCurrentStageBackgroundFocus && backgroundFocusCompiledPrompt) {
                    // Use background focus compiled prompt for background focus stages
                    if (!stageRequestBody.dynamic_generation) {
                        stageRequestBody.dynamic_generation = {};
                    }
                    stageRequestBody.dynamic_generation.compiled_prompt = { ...backgroundFocusCompiledPrompt };
                    
                    // Always merge in shared context to ensure consistency
                    if (sharedContext) {
                        stageRequestBody.dynamic_generation.compiled_prompt.context = sharedContext;
                        console.log(`🌳 Stage ${stageIndex}: Using background focus compiled prompt with shared context`);
                    } else {
                        console.log(`🌳 Stage ${stageIndex}: Using background focus compiled prompt for inheritance`);
                    }
                } else if (!isCurrentStageBackgroundFocus && normalCompiledPrompt) {
                    // Use normal compiled prompt for non-background focus stages
                    if (!stageRequestBody.dynamic_generation) {
                        stageRequestBody.dynamic_generation = {};
                    }
                    stageRequestBody.dynamic_generation.compiled_prompt = { ...normalCompiledPrompt };
                    
                    // Always merge in shared context to ensure consistency
                    if (sharedContext && normalCompiledPrompt.context !== sharedContext) {
                        stageRequestBody.dynamic_generation.compiled_prompt.context = sharedContext;
                        console.log(`🔍 Stage ${stageIndex}: Using normal compiled prompt with shared context`);
                    } else {
                        console.log(`🔍 Stage ${stageIndex}: Using normal compiled prompt for inheritance`);
                    }
                } else if (isCurrentStageBackgroundFocus && !backgroundFocusCompiledPrompt) {
                    // No background focus compiled prompt available - fallback to normal compiled prompt
                    if (!stageRequestBody.dynamic_generation) {
                        stageRequestBody.dynamic_generation = {};
                    }
                    
                    if (normalCompiledPrompt) {
                        // Copy normal compiled prompt for background focus stage
                        stageRequestBody.dynamic_generation.compiled_prompt = { ...normalCompiledPrompt };
                        
                        // Override with shared context to ensure consistency
                        if (sharedContext) {
                            stageRequestBody.dynamic_generation.compiled_prompt.context = sharedContext;
                            console.log(`🌳 Stage ${stageIndex}: No background focus prompt, using normal compiled prompt with shared context`);
                        } else {
                            console.log(`🌳 Stage ${stageIndex}: No background focus prompt, using normal compiled prompt`);
                        }
                    } else if (sharedContext) {
                        // No compiled prompts at all, but we have shared context
                        stageRequestBody.dynamic_generation.compiled_prompt = {
                            context: sharedContext
                        };
                        console.log(`🌳 Stage ${stageIndex}: No compiled prompts available, but using shared context`);
                    } else {
                        console.log(`🌳 Stage ${stageIndex}: No background focus compiled prompt available, will trigger regeneration`);
                    }
                } else if (!isCurrentStageBackgroundFocus && !normalCompiledPrompt && sharedContext) {
                    // No normal compiled prompt but we have shared context
                    if (!stageRequestBody.dynamic_generation) {
                        stageRequestBody.dynamic_generation = {};
                    }
                    stageRequestBody.dynamic_generation.compiled_prompt = {
                        context: sharedContext
                    };
                    console.log(`🔍 Stage ${stageIndex}: No compiled prompt, but using shared context`);
                }
                

                // Clean up stage-specific data from previous stage to prevent contamination
                delete stageRequestBody.mask;
                delete stageRequestBody.mask_compressed;
                delete stageRequestBody.image_bias;
                delete stageRequestBody.strength;
                delete stageRequestBody.noise;

                // Apply stage-specific overrides
                if (stage.type === 'expand-canvas') {
                    // Handle xlarge resolutions by converting to custom dimensions
                    if (stage.resolution !== undefined) {
                        if (stage.resolution.startsWith('xlarge_')) {
                            const dims = getDimensionsFromResolution(stage.resolution);
                            if (dims && dims.width && dims.height) {
                                stageRequestBody.width = dims.width;
                                stageRequestBody.height = dims.height;
                            } else {
                                // Fallback to large if xlarge dimensions not found
                                stageRequestBody.resolution = stage.resolution.replace('xlarge_', 'large_');
                            }
                        } else {
                            stageRequestBody.resolution = stage.resolution;
                        }
                    }
                    if (stage.width !== undefined) stageRequestBody.width = stage.width;
                    if (stage.height !== undefined) stageRequestBody.height = stage.height;
                    if (stage.bias !== undefined) stageRequestBody.image_bias = stage.bias || 2;
                    stageRequestBody.strength = 1;
                } else if (stage.type === 'enhance' || stage.type === 'variation') {
                    const needsImg2Img = stage.type === 'enhance' || stage.useBaseImage === true;
                    if (needsImg2Img) {
                        if (stage.strength !== undefined) stageRequestBody.strength = stage.strength || 0.5;
                        if (stage.noise !== undefined) stageRequestBody.noise = stage.noise || 0;
                    }

                    // Handle resolution modifier (e.g., 'normal', 'large', 'xlarge')
                    if (stage.maxEnhance !== true && needsImg2Img && stage.resolution && (stageRequestBody.width && stageRequestBody.height)) {
                        // Previous stage used custom dimensions - resize based on target area
                        const currentWidth = stageRequestBody.width;
                        const currentHeight = stageRequestBody.height;
                        
                        // Define target areas for each resolution level
                        const areaMap = {
                            'small': 409600,      // ~640x640
                            'normal': 1048576,    // ~1024x1024 (1MP)
                            'large': 2166784,     // ~1472x1472 (2MP)
                            'xlarge': 3047424     // ~1728x1728 (3MP), must not exceed NovelAI max pixels
                        };
                        // nekoai-js MetadataProcessor enforces product width*height <= 3047424
                        const MAX_API_TOTAL_PIXELS = 3047424;
                        
                        const maxArea = Math.min(areaMap[stage.resolution] || areaMap['normal'], MAX_API_TOTAL_PIXELS);
                        
                        const snapped = dimensionsMaxUnderArea(currentWidth, currentHeight, maxArea, 64, 512, 512);
                        stageRequestBody.width = snapped.width;
                        stageRequestBody.height = snapped.height;
                        delete stageRequestBody.resolution;
                        if (snapped.width !== currentWidth || snapped.height !== currentHeight) {
                            console.log(`🎨 Enhance stage ${stageIndex}: Resized from ${currentWidth}x${currentHeight} to ${snapped.width}x${snapped.height} (target area: ${stage.resolution})`);
                        } else {
                            console.log(`🎨 Enhance stage ${stageIndex}: Keeping dimensions ${currentWidth}x${currentHeight} (already at max under area cap)`);
                        }
                    } else if (stage.maxEnhance !== true && needsImg2Img && stage.resolution && stageRequestBody.resolution) {
                        // Previous stage used named resolution - determine aspect ratio and apply modifier
                        const parts = stageRequestBody.resolution.toLowerCase().split('_');
                        const aspectRatio = parts.length > 1 ? parts.slice(1).join('_') : 'square';
                        const newResolution = `${stage.resolution}_${aspectRatio}`;
                        
                        // Convert to custom dimensions to avoid API issues with xlarge
                        const dims = getDimensionsFromResolution(newResolution);
                        if (dims && dims.width && dims.height) {
                            stageRequestBody.width = dims.width;
                            stageRequestBody.height = dims.height;
                            delete stageRequestBody.resolution;
                            console.log(`🎨 Enhance stage ${stageIndex}: Using custom dimensions ${dims.width}x${dims.height} (${stage.resolution} ${aspectRatio})`);
                        } else {
                            // Fallback to named resolution if dimensions not found
                            stageRequestBody.resolution = newResolution;
                            console.log(`🎨 Enhance stage ${stageIndex}: Using named resolution ${newResolution}`);
                        }
                    } else if (!needsImg2Img) {
                        // Variation without base image: apply provided resolution or dimensions directly
                        if (stage.resolution !== undefined) {
                            if (stage.resolution.startsWith('xlarge_')) {
                                const dims = getDimensionsFromResolution(stage.resolution);
                                if (dims && dims.width && dims.height) {
                                    stageRequestBody.width = dims.width;
                                    stageRequestBody.height = dims.height;
                                    delete stageRequestBody.resolution;
                                } else {
                                    stageRequestBody.resolution = stage.resolution.replace('xlarge_', 'large_');
                                }
                            } else {
                                stageRequestBody.resolution = stage.resolution;
                            }
                        }
                        if (stage.width !== undefined) stageRequestBody.width = stage.width;
                        if (stage.height !== undefined) stageRequestBody.height = stage.height;
                    }
                    // If no resolution modifier, inherit previous stage dimensions as-is
                }

                // Handle seed inheritance BEFORE merging advanced config
                if (stage.advanced && stage.advanced.inheritSeed) {
                    let seedToInherit;
                    
                    // First pipeline stage (i === 0) inherits from base generation
                    if (i === 0) {
                        seedToInherit = baseSeed;
                    } else if (stageSeeds.length > 0) {
                        // Subsequent stages inherit from previous pipeline stage
                        // stageSeeds array is indexed by pipeline stage (stage 1 = index 0, stage 2 = index 1)
                        const prevStageIndex = i - 1;
                        seedToInherit = stageSeeds[prevStageIndex]?.seed;
                    }
                    
                    if (seedToInherit !== undefined) {
                        // Set the seed directly on the stage's advanced config before merge
                        stage.advanced.seed = seedToInherit;
                        console.log(`🔗 Stage ${stageIndex}: Inheriting seed ${seedToInherit} from ${i === 0 ? 'base generation' : 'previous stage'}`);
                    }
                }
                
                // Merge advanced config if present
                if (stage.advanced) {
                    Object.assign(stageRequestBody, stage.advanced);
                    delete stageRequestBody.inheritSeed;
                    delete stageRequestBody.autoSeed;
                }

                if (stage.maxEnhance === true) {
                    const sourceDims = await getImageDimensions(currentBuffer);
                    stageRequestBody.width = sourceDims.width;
                    stageRequestBody.height = sourceDims.height;
                    stageRequestBody.upscaled_enhance = true;
                    stageRequestBody.upscale = undefined;
                    stageRequestBody.max_enhance_source = stageRequestBody.chain_source || null;
                    delete stageRequestBody.resolution;
                }
                
                // Handle resolution conflicts: if named resolution is set, remove width/height, and vice versa
                if (stageRequestBody.resolution && stageRequestBody.resolution !== 'custom') {
                    // Named resolution was set - remove explicit dimensions
                    delete stageRequestBody.width;
                    delete stageRequestBody.height;
                } else if (stageRequestBody.width && stageRequestBody.height) {
                    // Explicit dimensions were set - remove named resolution (unless it's 'custom')
                    if (stageRequestBody.resolution !== 'custom') {
                        delete stageRequestBody.resolution;
                    }
                }

                // Add pipeline stage data to body
                stageRequestBody.stage_index = stageIndex;
                stageRequestBody.stageIndex = stageIndex; // Also set camelCase for consistency with checks
                delete stageRequestBody.image;
                // Only set image for expand-canvas, enhance, or variation with useBaseImage
                if (stage.type === 'expand-canvas' || stage.type === 'enhance' || stage.maxEnhance === true || (stage.type === 'variation' && stage.useBaseImage)) {
                    stageRequestBody.image = `data:${currentBuffer.toString('base64')}`;
                }
                
                // Filter locked replacements for this specific stage
                // Use text_replacements from stageRequestBody (merged from stage.advanced or inherited from base)
                const stageBodyReplacements = stageRequestBody.text_replacements || [];
                const filteredLockedReplacements = filterLockedReplacementsForStage(
                    allLockedReplacements,
                    stageIndex,
                    stageBodyReplacements
                );
                stageRequestBody.text_replacements_seed = filteredLockedReplacements;
                
                if (filteredLockedReplacements.length > 0) {
                    console.log(`🔒 Stage ${stageIndex}: Using ${filteredLockedReplacements.length} locked replacements`);
                }

                // Add stage context for pipeline-aware dynamic generation
                if (stageRequestBody.dynamic_generation) {
                    // Set locked flags if we have a compiled prompt from a previous stage
                    if (stageRequestBody.dynamic_generation.compiled_prompt) {
                        stageRequestBody.dynamic_generation.context_locked = true;
                        stageRequestBody.dynamic_generation.cache_locked = true;
                        console.log(`🔒 Stage ${stageIndex}: Locked mode enabled - will reuse compiled prompt context and cache`);
                    }
                    
                    // Debug logging to trace context preservation
                    console.log(`🔍 Stage ${stageIndex} dynamic_generation state:`, {
                        hasCompiledPrompt: !!stageRequestBody.dynamic_generation.compiled_prompt,
                        hasContext: !!stageRequestBody.dynamic_generation.compiled_prompt?.context,
                        hasWeather: !!stageRequestBody.dynamic_generation.compiled_prompt?.context?.weather,
                        hasTime: !!stageRequestBody.dynamic_generation.compiled_prompt?.context?.time,
                        hasTimePeriod: !!stageRequestBody.dynamic_generation.compiled_prompt?.context?.timePeriod,
                        hasLighting: !!stageRequestBody.dynamic_generation.compiled_prompt?.context?.timePeriod?.lighting,
                        locked: stageRequestBody.dynamic_generation.locked
                    });
                    
                    const stageContext = {
                        isInitial: i === 0, // First stage in pipeline
                        isBackgroundFocus: stage.type === 'expand-canvas' && stage.backgroundFocus,
                        isEnhance: stage.type !== 'expand-canvas',
                        hasPreview: !!stageRequestBody.dynamic_generation.compiled_prompt?.preview_image_hash,
                        stageIndex,
                        pipelineStageGeneration: true
                    };
                    stageRequestBody.dynamic_generation.stageContext = stageContext;
                    
                    // Handle directive inheritance and accumulation
                    const currentDirective = stage.advanced && stage.advanced.directive && stage.advanced.directive.trim() 
                        ? stage.advanced.directive.trim() 
                        : '';
                    
                    // If current stage has a directive, append it to inherited directive
                    if (currentDirective) {
                        inheritedDirective = inheritedDirective 
                            ? `${inheritedDirective}\n\n${currentDirective}` 
                            : currentDirective;
                    }
                    
                    // Apply the accumulated directive to this stage
                    if (inheritedDirective) {
                        stageRequestBody.dynamic_generation.directive = inheritedDirective;
                        console.log(`🎬 Stage ${stageIndex} directive: ${inheritedDirective}`);
                    }
                    
                    console.log(`🎬 Stage ${stageIndex} context: ${JSON.stringify(stageContext)}`);
                }

                if (stage.type === 'expand-canvas') {
                    let targetDims;
                    if (stageRequestBody.width && stageRequestBody.height) {
                        targetDims = { width: stageRequestBody.width, height: stageRequestBody.height };
                    } else {
                        targetDims = getDimensionsFromResolution((stageRequestBody.resolution)?.toLowerCase() || '');
                    }
                    
                    if (!targetDims || !targetDims.width || !targetDims.height) {
                        throw new Error(`Stage ${stageIndex}: Invalid target resolution`);
                    }
                    
                    const originalDims = await getImageDimensions(currentBuffer);

                    // Create letterboxed image with transparent padding
                    const letterboxedBuffer = await processDynamicImageLetterbox(currentBuffer, targetDims, stage.bias, { inset: stage.inset === true || stage.inset === 'true' || stage.inset === 1 });
                    console.log(`📦 Letterboxed image created for stage ${stageIndex}`);
                    
                    // Trace: attach letterboxed image
                    try {
                        if (bodyData.requestId && letterboxedBuffer) {
                            __runtimeGr.getTracing().addImageAttachment(bodyData.requestId, `stage-${stageIndex}-letterboxed`, letterboxedBuffer, 'png', { stageIndex });
                        }
                    } catch {}
                    
                    // If background focus is enabled, pass letterboxed buffer directly to dynamic generation
                    if (stage.backgroundFocus && stageRequestBody.dynamic_generation) {
                        stageRequestBody.dynamic_generation.lastGeneratedImage = letterboxedBuffer;
                        console.log(`📸 Passing letterboxed buffer directly for background focus analysis`);
                    }
                    
                    // Create expansion mask from letterboxed image with edge detection
                    const stageInset = stage.inset === true || stage.inset === 'true' || stage.inset === 1;
                    const maskBuffer = await createExpansionMask(
                        letterboxedBuffer,
                        targetDims.width,
                        targetDims.height,
                        originalDims.width,
                        originalDims.height,
                        stageInset
                    );
                    const compressedMaskBase64 = await compressMask(maskBuffer);

                    // Set on request body for buildOptions to process
                    stageRequestBody.mask_compressed = compressedMaskBase64;
                    stageRequestBody.image = `data:${letterboxedBuffer.toString('base64')}`;
                    stageRequestBody.image_preletterboxed = true;
                }

                // Set save flag
                stageRequestBody.no_save = !shouldSave;
                if (shouldSave && stage.upscale) {
                    stageRequestBody.upscale = stage.upscale;
                }
                
                // Handle background focus for expand canvas stages
                if (stage.type === 'expand-canvas' && stage.backgroundFocus && stageRequestBody.dynamic_generation) {
                    console.log(`🌳 Background focus enabled for stage ${stageIndex}`);                    
                    // Force dynamic generation to run even if there's a cached prompt
                    stageRequestBody.dynamic_generation.backgroundFocus = true;
                    // Letterboxed buffer will be passed directly via lastGeneratedImage after creation
                }
                
                // Handle enhance/variation(useBaseImage) stages - pass current buffer for analysis
                if ((stage.type === 'enhance' || stage.maxEnhance === true || (stage.type === 'variation' && stage.useBaseImage)) && stageRequestBody.dynamic_generation) {
                    console.log(`✨ Enhance/Variation(useBaseImage) stage with dynamic generation - passing current image buffer for analysis`);
                    stageRequestBody.dynamic_generation.lastGeneratedImage = currentBuffer;
                    console.log(`📸 Passing current buffer to dynamic generation for stage ${stageIndex}`);
                }

                // Create stageData for text replacements
                // Use stageRequestBody.text_replacements which may have been set by stage.advanced
                const currentStageData = {
                    stageIndex: stageIndex,
                    stageType: stage.type,
                    totalStages: totalStages,
                    text_replacements: stageRequestBody.text_replacements || [],
                    pipelineStageGeneration: true
                };

                // Build options and generate
                const stageOpts = await buildOptions(globalResources, stageRequestBody, null, {}, ws, handler, wsServer, currentStageData);
                const StageAction = __runtimeGr.getNekoAiService('Action');
                if (stage.type === 'expand-canvas') {
                    stageOpts.action = StageAction.INPAINT;
                } else if (stage.type === 'enhance' || stage.maxEnhance === true || (stage.type === 'variation' && stage.useBaseImage === true)) {
                    stageOpts.action = StageAction.IMG2IMG;
                } else if (stage.type === 'variation') {
                    // Prompt-only variation (e.g. Phasewalker) — text-to-image, not img2img
                    stageOpts.action = StageAction.GENERATE;
                    delete stageOpts.image;
                    delete stageOpts.strength;
                    delete stageOpts.noise;
                }

                // Generate stage image using the unified approach
                const stageResult = await handleGeneration(globalResources, stageOpts, true, null, bodyData.workspace, mockReq, streamingCallback, ws, handler, baseMetadata, stageSeeds);
                
                // Update locked replacements pool with new replacements from this stage
                if (stageResult.text_replacements_seed && Array.isArray(stageResult.text_replacements_seed)) {
                    // Add new replacements to the pool (they will have body_replacement_stages metadata)
                    const newReplacements = stageResult.text_replacements_seed
                        .filter(r => r.can_lock !== false)
                        .map(r => ({ ...r, locked: true }));
                    
                    // Remove old replacements with the same key that don't apply to future stages
                    const newReplacementKeys = new Set(newReplacements.map(r => r.key));
                    allLockedReplacements = allLockedReplacements.filter(oldRep => {
                        if (!newReplacementKeys.has(oldRep.key)) {
                            return true; // Keep replacements with different keys
                        }
                        // If there's a new replacement with the same key, only keep the old one if it has persist flag
                        return oldRep.body_replacement_persist === true;
                    });
                    
                    // Add the new replacements
                    allLockedReplacements.push(...newReplacements);
                    console.log(`🔄 Stage ${stageIndex}: Updated locked replacements pool (${allLockedReplacements.length} total)`);
                }
                
                // Collect stage data for tracking (will be used by next saved stage or final return)
                const stageSeedData = { ...stageResult.stageData, seed: stageResult.seed };
                stageSeeds.push(stageSeedData);

                // Save current body for next stage
                previousStageBody = { ...stageRequestBody };
                
                // Deep copy dynamic_generation to prevent shared reference issues
                if (previousStageBody.dynamic_generation) {
                    previousStageBody.dynamic_generation = JSON.parse(JSON.stringify(previousStageBody.dynamic_generation));
                }
                
                // Update compiled prompt variables for next stage only if successful
                if (stageResult.stageData.dynamic_generation?.success) {
                    // If dynamic generation ran successfully in this stage, clear client-provided prompts
                    // This ensures subsequent stages use fresh data instead of stale client prompts
                    if (clientCompiledPrompts) {
                        console.log(`🔄 Stage ${stageIndex}: Dynamic generation ran - clearing client-provided compiled prompts`);
                        clientCompiledPrompts = null;
                    }
                    
                    // Store compiled prompt based on whether this stage had background focus
                    const isBackgroundFocusStage = stage.type === 'expand-canvas' && stage.backgroundFocus;
                    
                    if (isBackgroundFocusStage) {
                        // Store background focus compiled prompt separately
                        backgroundFocusCompiledPrompt = stageResult.stageData.dynamic_generation;
                        console.log(`🌳 Saved stage ${stageIndex} background focus compiled_prompt for next background focus stage`);
                    } else {
                        // Store normal compiled prompt
                        normalCompiledPrompt = stageResult.stageData.dynamic_generation;
                        console.log(`🔍 Saved stage ${stageIndex} compiled_prompt for next stage`);
                    }
                    
                    // Update shared context if this stage generated new context
                    if (stageResult.stageData.dynamic_generation?.context) {
                        sharedContext = stageResult.stageData.dynamic_generation.context;
                        console.log(`🌍 Updated shared context from stage ${stageIndex}`);
                    }
                    
                    // Debug logging
                    console.log(`🔍 Saved stage ${stageIndex} compiled_prompt for next stage:`, {
                        isBackgroundFocus: isBackgroundFocusStage,
                        hasContext: !!stageResult.stageData.dynamic_generation?.context,
                        hasWeather: !!stageResult.stageData.dynamic_generation?.context?.weather,
                        hasTime: !!stageResult.stageData.dynamic_generation?.context?.time
                    });
                } else if (stageResult.stageData.dynamic_generation?.context) {
                    // Even if generation failed, preserve context for all subsequent stages
                    // Context (weather, time, season) is still valid and expensive to regenerate
                    const preservedContext = stageResult.stageData.dynamic_generation.context;
                    
                    // Update shared context - this applies to ALL subsequent stages
                    sharedContext = preservedContext;
                    
                    console.log(`💾 Stage ${stageIndex} generation failed but preserving context for all subsequent stages`);
                    console.log(`🌍 Updated shared context:`, {
                        hasWeather: !!preservedContext.weather,
                        hasTime: !!preservedContext.time,
                        hasSeason: !!preservedContext.season
                    });
                }
                
                currentBuffer = stageResult.buffer;
                
                // Trace: attach final stage image
                try {
                    if (bodyData.requestId && stageResult.buffer) {
                        __runtimeGr.getTracing().addImageAttachment(bodyData.requestId, `stage-${stageIndex}-final`, stageResult.buffer, 'png', { stageIndex });
                    }
                } catch {}
                
                // Track saved filename if stage was saved
                if (stageResult.saved && stageResult.filename) {
                    savedFilenames.push({
                        filename: stageResult.filename,
                        stageId: stageHexId,
                        stageIndex: stageIndex,
                        stageType: stage.type
                    });
                    console.log(`💾 Stage ${stageIndex} saved: ${stageResult.filename} (ID: ${stageHexId})`);
                }
                
                console.log(`✅ Stage ${stageIndex} completed successfully`);

                if (isStagedGenerationCancelled(handler, bodyData.requestId)) {
                    console.log(`🛑 Generation cancelled after stage ${stageIndex} - skipping remaining ${pipeline.length - i - 1} stage(s)`);
                    cancelledEarly = true;
                    sendCancelledCompleteProgress(stageIndex + 1);
                    break;
                }
                
                // Check if we should stop at this stage (either stopAtStage flag or breakPoint match)
                if (stage.stopAtStage) {
                    console.log(`🛑 Stop at stage ${stageIndex} - skipping remaining ${pipeline.length - i - 1} stage(s)`);
                    
                    // Send completion progress update
                    if (ws && handler) {
                        const lastSaved = savedFilenames.length > 0 ? savedFilenames[savedFilenames.length - 1] : null;
                        handler.sendGenerationProgress(ws, bodyData.requestId || 'generation', {
                            phase: 'complete',
                            totalStages: stageIndex + 1, // Report as if this was the last stage
                            currentStage: stageIndex + 1,
                            stageType: 'complete',
                            stoppedEarly: true,
                            contentLength: currentBuffer ? currentBuffer.length : null,
                            filename: lastSaved ? lastSaved.filename : null
                        });
                    }
                    
                    break; // Exit the pipeline loop
                }
                
                // Check if this stage matches the breakPoint ID (request-specific breakpoint)
                if (bodyData.breakPoint && stage.stageId && 
                    stage.stageId.toLowerCase() === bodyData.breakPoint.toLowerCase()) {
                    console.log(`🛑 BreakPoint hit at stage ${stageIndex} (ID: ${stage.stageId}) - skipping remaining ${pipeline.length - i - 1} stage(s)`);
                    
                    // Send completion progress update
                    if (ws && handler) {
                        const lastSaved = savedFilenames.length > 0 ? savedFilenames[savedFilenames.length - 1] : null;
                        handler.sendGenerationProgress(ws, bodyData.requestId || 'generation', {
                            phase: 'complete',
                            totalStages: stageIndex + 1,
                            currentStage: stageIndex + 1,
                            stageType: 'complete',
                            stoppedEarly: true,
                            breakPointHit: true,
                            contentLength: currentBuffer ? currentBuffer.length : null,
                            filename: lastSaved ? lastSaved.filename : null
                        });
                    }
                    
                    break; // Exit the pipeline loop
                }
                
            } catch (stageError) {
                console.error(`❌ Stage ${stageIndex} failed:`, stageError.message);
                
                // Send error progress update (use 1-based indexing for UI: stageIndex + 1)
                if (ws && handler) {
                    handler.sendGenerationProgress(ws, bodyData.requestId || 'generation', {
                        phase: 'error',
                        error: `Stage ${stageIndex} failed: ${stageError.message}`,
                        totalStages: totalStages,
                        currentStage: stageIndex + 1,
                        stageType: stage.type
                    });
                }
                
                // If we have saved results from previous stages, return them
                if (savedFilenames.length > 0 && currentBuffer) {
                    console.log(`⚠️ Returning partial result from stage ${stageIndex - 1}`);
                    return {
                        buffer: currentBuffer,
                        filename: savedFilenames[savedFilenames.length - 1].filename, // Last saved filename for backward compat
                        filenames: savedFilenames, // Array of all saved stage data (filename, stageId, stageIndex, stageType)
                        saved: true,
                        seed: stageSeeds[stageSeeds.length - 1] || null,
                        stage_seeds: stageSeeds,
                        total_stages: totalStages,
                        partial_result: true,
                        error: `Stage ${stageIndex} failed: ${stageError.message}`
                    };
                }
                
                // If no previous result, re-throw the error
                throw stageError;
            }
        }

        if (cancelledEarly) {
            console.log(`✅ Staged generation stopped early (cancelled)`);
            console.log(`💾 Total saved stages: ${savedFilenames.length}`);
            try {
                if (bodyData.requestId) {
                    __runtimeGr.getTracing().finalizeTrace(bodyData.requestId, 'completed', {
                        cancelled: true,
                        totalStages: totalStages,
                        savedStages: savedFilenames.length,
                        seeds: { base: baseSeed, stages: stageSeeds }
                    });
                }
            } catch {}
            return buildStagedPartialReturn({ cancelled: true, stopped_early: true });
        }
        
        // Send completion progress update
        if (ws && handler) {
            const lastSaved = savedFilenames.length > 0 ? savedFilenames[savedFilenames.length - 1] : null;
            handler.sendGenerationProgress(ws, bodyData.requestId || 'generation', {
                phase: 'complete',
                totalStages: totalStages,
                currentStage: totalStages,
                stageType: 'complete',
                contentLength: currentBuffer ? currentBuffer.length : null,
                filename: lastSaved ? lastSaved.filename : null
            });
        }
        
        console.log(`✅ Staged generation completed`);
        console.log(`💾 Total saved stages: ${savedFilenames.length}`);
        
        // Finalize trace for pipeline
        try {
            if (bodyData.requestId) {
                __runtimeGr.getTracing().finalizeTrace(bodyData.requestId, 'completed', {
                    totalStages: totalStages,
                    savedStages: savedFilenames.length,
                    seeds: { base: baseSeed, stages: stageSeeds }
                });
            }
        } catch {}
        
        return buildStagedPartialReturn({ saved: true });
        
    } catch (error) {
        console.error('❌ Staged generation error:', error);
        try {
            if (bodyData.requestId) {
                __runtimeGr.getTracing().finalizeTrace(bodyData.requestId, 'failed', { error: String(error && error.message || error) });
            }
        } catch {}
        throw error;
    }
}

// Function to convert image metadata to request format for rerolling
async function convertMetadataToRequestFormat(globalResources, metadata, allowPaid = false) {
    bindRuntimeGlobalResources(globalResources);
    if (!metadata) {
        throw new Error('No metadata provided for conversion');
    }

    // Extract the actual metadata from the nested structure
    const actualMetadata = metadata.metadata || metadata;

    // Use the existing extractRelevantFields function to get properly formatted metadata
    const extractedMetadata = await __runtimeGr.getPngMetadata().extractRelevantFields(
        actualMetadata,
        metadata.filename,
        metadata.blurhash
    );

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

    // Add quality and UC presets if available (from forge_data or extractedMetadata)
    if (extractedMetadata.append_quality !== undefined) {
        requestBody.append_quality = extractedMetadata.append_quality;
    } else if (forgeData.append_quality !== undefined) {
        requestBody.append_quality = forgeData.append_quality;
    }
    if (extractedMetadata.quality_preset_bias !== undefined) {
        requestBody.quality_preset_bias = extractedMetadata.quality_preset_bias;
    } else if (forgeData.quality_preset_bias !== undefined) {
        requestBody.quality_preset_bias = forgeData.quality_preset_bias;
    }
    if (extractedMetadata.append_transparency !== undefined) {
        requestBody.append_transparency = extractedMetadata.append_transparency;
    } else if (forgeData.append_transparency !== undefined) {
        requestBody.append_transparency = forgeData.append_transparency;
    }
    if (extractedMetadata.transparency_bias !== undefined) {
        requestBody.transparency_bias = extractedMetadata.transparency_bias;
    } else if (forgeData.transparency_bias !== undefined) {
        requestBody.transparency_bias = forgeData.transparency_bias;
    }
    if (extractedMetadata.append_uc !== undefined) {
        requestBody.append_uc = extractedMetadata.append_uc;
    } else if (forgeData.append_uc !== undefined) {
        requestBody.append_uc = forgeData.append_uc;
    }
    // Add quality and UC preset IDs if available
    if (extractedMetadata.append_quality_id !== undefined) {
        requestBody.append_quality_id = extractedMetadata.append_quality_id;
    }
    if (extractedMetadata.append_uc_id !== undefined) {
        requestBody.append_uc_id = extractedMetadata.append_uc_id;
    }
    if (forgeData.input_prompt_negative !== undefined && forgeData.input_prompt_negative !== '') {
        requestBody.input_prompt_negative = forgeData.input_prompt_negative;
    } else if (extractedMetadata.input_prompt_negative !== undefined && extractedMetadata.input_prompt_negative !== '') {
        requestBody.input_prompt_negative = extractedMetadata.input_prompt_negative;
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
            requestBody.noise = extractedMetadata.noise || 0;
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
    if (extractedMetadata.novel_note_id !== undefined) {
        requestBody.novel_note_id = extractedMetadata.novel_note_id;
    }
    if (extractedMetadata.novel_story_cursor_line !== undefined) {
        requestBody.novel_story_cursor_line = extractedMetadata.novel_story_cursor_line;
    }
    if (extractedMetadata.chara_reference_source !== undefined) {
        requestBody.chara_reference_source = extractedMetadata.chara_reference_source;
    }
    if (extractedMetadata.chara_reference_type !== undefined) {
        requestBody.chara_reference_type = extractedMetadata.chara_reference_type;
    }
    if (extractedMetadata.chara_reference_strength !== undefined) {
        requestBody.chara_reference_strength = extractedMetadata.chara_reference_strength;
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

    if (extractedMetadata.expansion_source !== undefined) {
        requestBody.expansion_source = extractedMetadata.expansion_source;
    }
    if (extractedMetadata.expansion_mode !== undefined) {
        requestBody.expansion_mode = extractedMetadata.expansion_mode;
    }
    
    if (extractedMetadata.pipeline !== undefined) {
        requestBody.pipeline = extractedMetadata.pipeline;
    }
    if (extractedMetadata.text_replacements !== undefined) {
        requestBody.text_replacements = extractedMetadata.text_replacements;
    }
    if (extractedMetadata.stage_seeds !== undefined) {
        requestBody.stage_seeds = extractedMetadata.stage_seeds;
    }
    if (extractedMetadata.stage_index !== undefined) {
        requestBody.stage_index = extractedMetadata.stage_index;
    }
    if (extractedMetadata.stage_type !== undefined) {
        requestBody.stage_type = extractedMetadata.stage_type;
    }

    if (extractedMetadata.text_overlays !== undefined) {
        requestBody.text_overlays = extractedMetadata.text_overlays;
    }
    if (extractedMetadata.save_base_output !== undefined) {
        requestBody.save_base_output = extractedMetadata.save_base_output;
    }
    if (extractedMetadata.skip_pipeline_stages !== undefined) {
        requestBody.skip_pipeline_stages = extractedMetadata.skip_pipeline_stages;
    }

    // Add auto_clean_uc if available
    if (extractedMetadata.auto_clean_uc !== undefined) {
        requestBody.auto_clean_uc = extractedMetadata.auto_clean_uc;
    } else if (forgeData.auto_clean_uc !== undefined) {
        requestBody.auto_clean_uc = forgeData.auto_clean_uc;
    }

    // Add keep_newlines if available
    if (extractedMetadata.keep_newlines !== undefined) {
        requestBody.keep_newlines = extractedMetadata.keep_newlines;
    } else if (forgeData.keep_newlines !== undefined) {
        requestBody.keep_newlines = forgeData.keep_newlines;
    }

    // Add auto_char_numerize if available
    if (extractedMetadata.auto_char_numerize !== undefined) {
        requestBody.auto_char_numerize = extractedMetadata.auto_char_numerize;
    } else if (forgeData.auto_char_numerize !== undefined) {
        requestBody.auto_char_numerize = forgeData.auto_char_numerize;
    }

    // Add prompt_normalize if available
    if (extractedMetadata.prompt_normalize !== undefined) {
        requestBody.prompt_normalize = extractedMetadata.prompt_normalize;
    } else if (forgeData.prompt_normalize !== undefined) {
        requestBody.prompt_normalize = forgeData.prompt_normalize;
    }

    // Add deduplicate_tags if available
    if (extractedMetadata.deduplicate_tags !== undefined) {
        requestBody.deduplicate_tags = extractedMetadata.deduplicate_tags;
    } else if (forgeData.deduplicate_tags !== undefined) {
        requestBody.deduplicate_tags = forgeData.deduplicate_tags;
    }

    if (extractedMetadata.emphasis_normalization && typeof extractedMetadata.emphasis_normalization === 'object') {
        requestBody.emphasis_normalization = extractedMetadata.emphasis_normalization;
    } else if (forgeData.emphasis_normalization && typeof forgeData.emphasis_normalization === 'object') {
        requestBody.emphasis_normalization = forgeData.emphasis_normalization;
    }

    // Remove seed to ensure new random seed is generated
    delete requestBody.seed;
    return requestBody;
}

// Function to handle reroll generation from metadata
async function handleRerollGeneration(globalResources, metadata, sessionId, workspaceId, allowPaid = false, ws = null, handler = null, wsServer = null, streamingCallback = null, requestId = null) {
    bindRuntimeGlobalResources(globalResources);

    try {
        // Convert metadata to request format with allow_paid flag
        const requestBody = await convertMetadataToRequestFormat(globalResources, metadata, allowPaid);

        // Override workspace if provided
        if (workspaceId) {
            requestBody.workspace = workspaceId;
        }

        // Carry the client's requestId so streamed progress (image_generation_progress / dynamic_generation_progress_update) routes to the correct toast/session
        if (requestId) {
            requestBody.requestId = requestId;
        }

        // Check if this is a staged generation (pipeline)
        if (requestBody.pipeline && Array.isArray(requestBody.pipeline) && requestBody.pipeline.length > 0 && requestBody.skip_pipeline_stages !== true) {
            console.log(`🎬 Reroll: Starting staged generation with ${requestBody.pipeline.length} stages`);
            // Call handleStagedGeneration directly for pipeline stages, threading the WebSocket streaming context
            return await handleStagedGeneration(globalResources, requestBody, sessionId, streamingCallback, ws, handler, wsServer);
        }

        // Regular single generation
        // Build options for generation (ws/handler/wsServer enable dynamic-generation progress + step streaming)
        const opts = await buildOptions(globalResources, requestBody, null, {}, ws, handler, wsServer);

        // buildOptions does not copy requestId onto opts; generateImageWebSocket sets it explicitly (imageGeneration.js ~4574)
        if (requestBody.requestId) {
            opts.requestId = requestBody.requestId;
        }

        // Create a mock req object for context functions that need it
        const mockReq = { session: { id: sessionId } };

        // Call handleGeneration and return the result (streamingCallback/ws/handler enable step + phase progress)
        const result = await handleGeneration(globalResources, opts, true, metadata.preset_name || null, workspaceId, mockReq, streamingCallback, ws, handler);

        return result;
    } catch (error) {
        console.error('❌ Reroll generation error:', error);
        throw error;
    }
}

/**
 * Grow inpaint mask (white) slightly into preserved RGBA (black) for seam blending (overbleed).
 * Inset letterboxing pads multiple sides; omnidirectional dilation + extra passes avoids thin masks at content edges.
 */
function dilateExpansionMaskWhiteIntoOpaque(maskData, compressedMaskWidth, compressedMaskHeight, opts) {
    const coerceExpansionBool = (v) =>
        v === true || v === 'true' || v === 1 || v === '1';
    const {
        inset: insetRaw,
        hasTransparentTop: hasTransparentTopRaw,
        hasTransparentBottom: hasTransparentBottomRaw,
        hasTransparentLeft: hasTransparentLeftRaw,
        hasTransparentRight: hasTransparentRightRaw,
        isExpandingHorizontally: isExpandingHorizontallyRaw,
        isExpandingVertically: isExpandingVerticallyRaw
    } = opts || {};

    const inset = coerceExpansionBool(insetRaw);
    const hasTransparentTop = coerceExpansionBool(hasTransparentTopRaw);
    const hasTransparentBottom = coerceExpansionBool(hasTransparentBottomRaw);
    const hasTransparentLeft = coerceExpansionBool(hasTransparentLeftRaw);
    const hasTransparentRight = coerceExpansionBool(hasTransparentRightRaw);
    const isExpandingHorizontally = coerceExpansionBool(isExpandingHorizontallyRaw);
    const isExpandingVertically = coerceExpansionBool(isExpandingVerticallyRaw);

    let expandPixels = Math.max(1, Math.floor(compressedMaskWidth / 128));
    if (inset) {
        expandPixels = Math.max(expandPixels + 3, Math.ceil(Math.max(compressedMaskWidth, compressedMaskHeight) / 72), 4);
    }

    const cw = compressedMaskWidth;
    const ch = compressedMaskHeight;
    const expandedMaskData = new Uint8ClampedArray(maskData);

    function shouldExpandPixel(tempData, x, y) {
        const i = (y * cw + x) * 4;
        if (tempData[i] === 255) {
            return false;
        }
        if (inset) {
            if (x > 0 && tempData[(y * cw + (x - 1)) * 4] === 255) return true;
            if (x < cw - 1 && tempData[(y * cw + (x + 1)) * 4] === 255) return true;
            if (y > 0 && tempData[((y - 1) * cw + x) * 4] === 255) return true;
            if (y < ch - 1 && tempData[((y + 1) * cw + x) * 4] === 255) return true;
            return false;
        }
        let ok = false;
        if (isExpandingHorizontally) {
            if (hasTransparentLeft && x > 0 && tempData[(y * cw + (x - 1)) * 4] === 255) ok = true;
            if (hasTransparentRight && x < cw - 1 && tempData[(y * cw + (x + 1)) * 4] === 255) ok = true;
        }
        if (isExpandingVertically) {
            if (hasTransparentTop && y > 0 && tempData[((y - 1) * cw + x) * 4] === 255) ok = true;
            if (hasTransparentBottom && y < ch - 1 && tempData[((y + 1) * cw + x) * 4] === 255) ok = true;
        }
        return ok;
    }

    for (let pass = 0; pass < expandPixels; pass++) {
        const tempData = new Uint8ClampedArray(expandedMaskData);
        for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
                if (!shouldExpandPixel(tempData, x, y)) continue;
                const i = (y * cw + x) * 4;
                expandedMaskData[i] = 255;
                expandedMaskData[i + 1] = 255;
                expandedMaskData[i + 2] = 255;
                expandedMaskData[i + 3] = 255;
            }
        }
    }

    return expandedMaskData;
}

// Helper function to create expansion mask from letterboxed image
async function createExpansionMask(letterboxedBuffer, targetWidth, targetHeight, originalWidth, originalHeight, inset = false) {
    const letterboxedImg = await loadImage(letterboxedBuffer);
    
    // Calculate compressed dimensions (8x smaller)
    const compressedMaskWidth = Math.round(targetWidth / 8);
    const compressedMaskHeight = Math.round(targetHeight / 8);
    
    // Create downsampled version of letterboxed image
    const downsampledCanvas = createCanvas(compressedMaskWidth, compressedMaskHeight);
    const downsampledCtx = downsampledCanvas.getContext('2d');
    downsampledCtx.imageSmoothingEnabled = false;
    downsampledCtx.drawImage(letterboxedImg, 0, 0, compressedMaskWidth, compressedMaskHeight);
    
    // Extract alpha channel
    const downsampledImageData = downsampledCtx.getImageData(0, 0, compressedMaskWidth, compressedMaskHeight);
    const downsampledData = downsampledImageData.data;
    
    // Detect which edges have transparency
    let hasTransparentTop = false, hasTransparentBottom = false;
    let hasTransparentLeft = false, hasTransparentRight = false;
    
    for (let x = 0; x < compressedMaskWidth; x++) {
        if (downsampledData[(0 * compressedMaskWidth + x) * 4 + 3] < 128) hasTransparentTop = true;
        if (downsampledData[((compressedMaskHeight - 1) * compressedMaskWidth + x) * 4 + 3] < 128) hasTransparentBottom = true;
    }
    for (let y = 0; y < compressedMaskHeight; y++) {
        if (downsampledData[(y * compressedMaskWidth + 0) * 4 + 3] < 128) hasTransparentLeft = true;
        if (downsampledData[(y * compressedMaskWidth + (compressedMaskWidth - 1)) * 4 + 3] < 128) hasTransparentRight = true;
    }
    
    // Determine expansion direction
    const origAR = originalWidth / originalHeight;
    const targetAR = targetWidth / targetHeight;
    const isExpandingHorizontally = origAR < targetAR;
    const isExpandingVertically = origAR > targetAR;
    
    // Create mask from alpha channel
    const maskCanvas = createCanvas(compressedMaskWidth, compressedMaskHeight);
    const maskCtx = maskCanvas.getContext('2d');
    const maskImageData = maskCtx.createImageData(compressedMaskWidth, compressedMaskHeight);
    const maskData = maskImageData.data;
    
    // Mark transparent areas as white, opaque as black
    for (let i = 0; i < downsampledData.length; i += 4) {
        const alpha = downsampledData[i + 3];
        if (alpha < 128) {
            maskData[i] = maskData[i + 1] = maskData[i + 2] = maskData[i + 3] = 255;
        } else {
            maskData[i] = maskData[i + 1] = maskData[i + 2] = 0;
            maskData[i + 3] = 255;
        }
    }
    
    const expandedMaskData = dilateExpansionMaskWhiteIntoOpaque(maskData, compressedMaskWidth, compressedMaskHeight, {
        inset,
        hasTransparentTop,
        hasTransparentBottom,
        hasTransparentLeft,
        hasTransparentRight,
        isExpandingHorizontally,
        isExpandingVertically
    });
    
    const finalMaskImageData = maskCtx.createImageData(compressedMaskWidth, compressedMaskHeight);
    finalMaskImageData.data.set(expandedMaskData);
    maskCtx.putImageData(finalMaskImageData, 0, 0);
    return maskCanvas.toBuffer('image/png');
}

// Helper function to compress mask to base64
async function compressMask(maskBuffer) {
    const maskCanvas = await loadImage(maskBuffer);
    const canvas = createCanvas(maskCanvas.width, maskCanvas.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(maskCanvas, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
}

// Process expand canvas stage - reusable function for both manual and staged expansion
async function processExpandCanvas(globalResources, stage, body, baseMetadata, generationParams, workspaceId, ws, handler, requestId) {
    bindRuntimeGlobalResources(globalResources);
    try {
        console.log(`🔍 Processing expand canvas stage with resolution: ${params.resolution}, bias: ${params.bias}`);
        
        // Get original dimensions
        const originalDims = await getImageDimensions(imageBuffer);
        console.log(`📐 Original dimensions: ${originalDims.width}x${originalDims.height}`);
        
        // Get target dimensions from resolution
        const targetDims = getDimensionsFromResolution(params.resolution?.toLowerCase() || '');
        if (!targetDims || !targetDims.width || !targetDims.height) {
            throw new Error(`Invalid target resolution: ${params.resolution}`);
        }
        console.log(`🎯 Target dimensions: ${targetDims.width}x${targetDims.height}`);
        
        // Process image with letterbox mode to add transparent padding
        const letterboxedBuffer = await processDynamicImageLetterbox(imageBuffer, targetDims, params.bias, { inset: params.inset === true || params.inset === 'true' || params.inset === 1 });
        console.log(`📦 Letterboxed image created`);
        
        // Load letterboxed image for mask creation
        const letterboxedImg = await loadImage(letterboxedBuffer);
        
        // Calculate compressed dimensions (8x smaller)
        const compressedMaskWidth = Math.round(targetDims.width / 8);
        const compressedMaskHeight = Math.round(targetDims.height / 8);
        
        // Create downsampled version of letterboxed image first
        const downsampledCanvas = createCanvas(compressedMaskWidth, compressedMaskHeight);
        const downsampledCtx = downsampledCanvas.getContext('2d');
        downsampledCtx.imageSmoothingEnabled = false; // Nearest neighbor
        downsampledCtx.drawImage(letterboxedImg, 0, 0, compressedMaskWidth, compressedMaskHeight);
        
        // Extract alpha channel from downsampled image
        const downsampledImageData = downsampledCtx.getImageData(0, 0, compressedMaskWidth, compressedMaskHeight);
        const downsampledData = downsampledImageData.data;
        
        // Detect which edges have transparency in downsampled image
        let hasTransparentTop = false, hasTransparentBottom = false;
        let hasTransparentLeft = false, hasTransparentRight = false;
        
        // Check top edge
        for (let x = 0; x < compressedMaskWidth; x++) {
            const i = (0 * compressedMaskWidth + x) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentTop = true;
                break;
            }
        }
        
        // Check bottom edge
        for (let x = 0; x < compressedMaskWidth; x++) {
            const i = ((compressedMaskHeight - 1) * compressedMaskWidth + x) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentBottom = true;
                break;
            }
        }
        
        // Check left edge
        for (let y = 0; y < compressedMaskHeight; y++) {
            const i = (y * compressedMaskWidth + 0) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentLeft = true;
                break;
            }
        }
        
        // Check right edge
        for (let y = 0; y < compressedMaskHeight; y++) {
            const i = (y * compressedMaskWidth + (compressedMaskWidth - 1)) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentRight = true;
                break;
            }
        }
        
        // Determine expansion direction
        const origAR = originalDims.width / originalDims.height;
        const targetAR = targetDims.width / targetDims.height;
        const isExpandingHorizontally = origAR < targetAR;
        const isExpandingVertically = origAR > targetAR;
        
        // Create mask from downsampled alpha channel
        const maskCanvas = createCanvas(compressedMaskWidth, compressedMaskHeight);
        const maskCtx = maskCanvas.getContext('2d');
        const maskImageData = maskCtx.createImageData(compressedMaskWidth, compressedMaskHeight);
        const maskData = maskImageData.data;
        
        // Mark transparent areas as white, opaque areas as black
        for (let i = 0; i < downsampledData.length; i += 4) {
            const alpha = downsampledData[i + 3];
            if (alpha < 128) {
                // Transparent - mark as white (to be painted)
                maskData[i] = 255;
                maskData[i + 1] = 255;
                maskData[i + 2] = 255;
                maskData[i + 3] = 255;
            } else {
                // Opaque - mark as black (preserve)
                maskData[i] = 0;
                maskData[i + 1] = 0;
                maskData[i + 2] = 0;
                maskData[i + 3] = 255;
            }
        }
        
        const insetExpandCanvas = params.inset === true || params.inset === 'true' || params.inset === 1;
        let expandedMaskData;
        if (insetExpandCanvas) {
            expandedMaskData = dilateExpansionMaskWhiteIntoOpaque(maskData, compressedMaskWidth, compressedMaskHeight, {
                inset: true,
                hasTransparentTop,
                hasTransparentBottom,
                hasTransparentLeft,
                hasTransparentRight,
                isExpandingHorizontally,
                isExpandingVertically
            });
        } else {
            // Expand mask by 1-2 pixels ONLY in the direction of expansion
            const expandPixels = Math.max(1, Math.floor(compressedMaskWidth / 128)); // Scale for compressed size
            expandedMaskData = new Uint8ClampedArray(maskData);
            
            for (let pass = 0; pass < expandPixels; pass++) {
                const tempData = new Uint8ClampedArray(expandedMaskData);
                
                for (let y = 0; y < compressedMaskHeight; y++) {
                    for (let x = 0; x < compressedMaskWidth; x++) {
                        const i = (y * compressedMaskWidth + x) * 4;
                        
                        // Skip if already white
                        if (tempData[i] === 255) continue;
                        
                        // Only expand in the direction of expansion
                        let shouldExpand = false;
                        
                        if (isExpandingHorizontally) {
                            // Only expand left-right
                            if (hasTransparentLeft && x > 0) {
                                const leftI = (y * compressedMaskWidth + (x - 1)) * 4;
                                if (tempData[leftI] === 255) shouldExpand = true;
                            }
                            
                            // Ensure sufficient overlap between expanded mask and original content by adaptively adding rows
                            // Definition: overlapCount = count of pixels that turned from black (original mask) to white (expanded)
                            // Target: at least ~1.5% of total pixels (configurable via params.min_mask_overlap_pct in [0.01, 0.03])
                            (function ensureMinimumMaskOverlap() {
                                const totalPixels = compressedMaskWidth * compressedMaskHeight;
                                const minPct = Math.max(0.01, Math.min(0.03, Number(params?.min_mask_overlap_pct) || 0.015));
                                const minOverlap = Math.max(1, Math.floor(totalPixels * minPct));
                                
                                function computeOverlapCount() {
                                    let count = 0;
                                    for (let i = 0; i < expandedMaskData.length; i += 4) {
                                        // original black (maskData[i] === 0) turned white (expandedMaskData[i] === 255)
                                        if (maskData[i] === 0 && expandedMaskData[i] === 255) count++;
                                    }
                                    return count;
                                }
                                
                                function expandOneRowDirectionally() {
                                    const tempData = new Uint8ClampedArray(expandedMaskData);
                                    for (let y = 0; y < compressedMaskHeight; y++) {
                                        for (let x = 0; x < compressedMaskWidth; x++) {
                                            const i = (y * compressedMaskWidth + x) * 4;
                                            if (tempData[i] === 255) continue; // already white
                                            let shouldExpand = false;
                                            if (isExpandingHorizontally) {
                                                if (hasTransparentLeft && x > 0) {
                                                    const leftI = (y * compressedMaskWidth + (x - 1)) * 4;
                                                    if (tempData[leftI] === 255) shouldExpand = true;
                                                }
                                                if (hasTransparentRight && x < compressedMaskWidth - 1) {
                                                    const rightI = (y * compressedMaskWidth + (x + 1)) * 4;
                                                    if (tempData[rightI] === 255) shouldExpand = true;
                                                }
                                            }
                                            if (isExpandingVertically) {
                                                if (hasTransparentTop && y > 0) {
                                                    const topI = ((y - 1) * compressedMaskWidth + x) * 4;
                                                    if (tempData[topI] === 255) shouldExpand = true;
                                                }
                                                if (hasTransparentBottom && y < compressedMaskHeight - 1) {
                                                    const bottomI = ((y + 1) * compressedMaskWidth + x) * 4;
                                                    if (tempData[bottomI] === 255) shouldExpand = true;
                                                }
                                            }
                                            if (shouldExpand) {
                                                expandedMaskData[i] = 255;
                                                expandedMaskData[i + 1] = 255;
                                                expandedMaskData[i + 2] = 255;
                                                expandedMaskData[i + 3] = 255;
                                            }
                                        }
                                    }
                                }
                                
                                let overlapCount = computeOverlapCount();
                                let safetyPasses = 0;
                                const maxExtraPasses = 16; // safety cap
                                while (overlapCount < minOverlap && safetyPasses < maxExtraPasses) {
                                    expandOneRowDirectionally();
                                    overlapCount = computeOverlapCount();
                                    safetyPasses++;
                                }
                                if (overlapCount < minOverlap) {
                                    console.warn(`⚠️ Mask overlap below target after max passes: ${overlapCount}/${minOverlap}`);
                                }
                            })();
                            
                            if (hasTransparentRight && x < compressedMaskWidth - 1) {
                                const rightI = (y * compressedMaskWidth + (x + 1)) * 4;
                                if (tempData[rightI] === 255) shouldExpand = true;
                            }
                        }
                        
                        if (isExpandingVertically) {
                            // Only expand top-bottom
                            if (hasTransparentTop && y > 0) {
                                const topI = ((y - 1) * compressedMaskWidth + x) * 4;
                                if (tempData[topI] === 255) shouldExpand = true;
                            }
                            if (hasTransparentBottom && y < compressedMaskHeight - 1) {
                                const bottomI = ((y + 1) * compressedMaskWidth + x) * 4;
                                if (tempData[bottomI] === 255) shouldExpand = true;
                            }
                        }
                        
                        if (shouldExpand) {
                            expandedMaskData[i] = 255;
                            expandedMaskData[i + 1] = 255;
                            expandedMaskData[i + 2] = 255;
                            expandedMaskData[i + 3] = 255;
                        }
                    }
                }
            }
        }
        
        // Create ImageData using canvas context (Node.js compatible)
        const finalMaskImageData = maskCtx.createImageData(compressedMaskWidth, compressedMaskHeight);
        finalMaskImageData.data.set(expandedMaskData);
        maskCtx.putImageData(finalMaskImageData, 0, 0);
        
        const compressedMaskBase64 = maskCanvas.toDataURL('image/png').split(',')[1];
        console.log(`🎭 Mask created and compressed: ${compressedMaskWidth}x${compressedMaskHeight}`);
        
        // Calculate expansion percentages based on bias and dimensions
        const biasFractions = [0, 0.25, 0.5, 0.75, 1];
        const biasFrac = biasFractions[params.bias] !== undefined ? biasFractions[params.bias] : 0.5;
        
        let direction, leftPercent = 0, rightPercent = 0, topPercent = 0, bottomPercent = 0;
        
        if (isExpandingVertically) {
            // Expanding vertically (taller)
            direction = 'taller';
            const addedHeight = targetDims.height - (targetDims.width / origAR);
            const topAdd = addedHeight * biasFrac;
            const bottomAdd = addedHeight * (1 - biasFrac);
            topPercent = Math.round((topAdd / targetDims.height) * 100);
            bottomPercent = Math.round((bottomAdd / targetDims.height) * 100);
        } else if (isExpandingHorizontally) {
            // Expanding horizontally (wider)
            direction = 'wider';
            const addedWidth = targetDims.width - (targetDims.height * origAR);
            const leftAdd = addedWidth * biasFrac;
            const rightAdd = addedWidth * (1 - biasFrac);
            leftPercent = Math.round((leftAdd / targetDims.width) * 100);
            rightPercent = Math.round((rightAdd / targetDims.width) * 100);
        } else {
            // No expansion needed (same aspect ratio)
            throw new Error('Cannot expand: original and target have the same aspect ratio');
        }
        
        // For staged expansion, we don't use AI - just use the provided prompt
        const expansionPrompt = params.prompt || '';
        const expansionReason = 'Staged expansion';
        
        // Get system defaults for generation
        const defaultParams = {
            model: 'v4_5',
            steps: 28,
            guidance: 4.9,
            rescale: 0.07,
            sampler: 'k_euler_ancestral',
            noise_schedule: 'karras',
            noise: 0,
            seed: undefined // Let system generate random seed unless overridden
        };
        
        // Merge with advanced overrides
        const genParams = { ...defaultParams, ...params.advanced };
        
        // Build request body for inpainting
        const requestBody = {
            prompt: expansionPrompt,
            uc: params.uc || '',
            characterPrompts: params.characterPrompts || [],
            model: genParams.model,
            steps: genParams.steps,
            guidance: genParams.guidance,
            rescale: genParams.rescale,
            sampler: genParams.sampler,
            noise_schedule: genParams.noise_schedule,
            strength: 1,
            noise: genParams.noise,
            resolution: params.resolution,
            image: `data:${letterboxedBuffer.toString('base64')}`,
            mask_compressed: compressedMaskBase64,
            upscale: params.upscale || false,
            append_quality: 0,
            append_uc: 0,
            image_preletterboxed: true
            // Note: no_save will be set by the calling function based on stage requirements
        };
        
        // Add seed if provided in overrides
        if (genParams.seed !== undefined) {
            requestBody.seed = genParams.seed;
        }
        
        // Build options for generation
        const opts = await buildOptions(globalResources, requestBody, null, {}, null, null);
        
        // Set no_save flag if specified
        if (params.no_save) {
            opts.no_save = true;
        }
        
        // Add stage information to opts for progress messages
        if (params.stageIndex !== undefined) {
            opts.stageIndex = params.stageIndex;
            opts.stageType = 'expand-canvas';
            opts.totalStages = params.totalStages;
            opts.stage_seeds = params.stageSeeds || [];
            opts.pipeline = params.pipeline;
            opts.text_replacements = params.text_replacements;
        }
        
        // Generate expanded image
        console.log(`🎨 Generating expanded image...`);
        const result = await handleGeneration(globalResources, opts, true, null, params.workspaceId, null, streamingCallback, ws, handler);
        
        // Create metadata for the expansion
        const expansionMetadata = {
            expansion_inset: params.inset === true,
            expansion_direction: direction,
            expansion_percentages: {
                left: leftPercent,
                right: rightPercent,
                top: topPercent,
                bottom: bottomPercent
            },
            expansion_prompt: expansionPrompt,
            expansion_reason: expansionReason,
            expansion_params: genParams,
            generation_type: 'expanded'
        };
        
        // Stage metadata is now handled by handleGeneration, so we don't need to update the buffer again
        const expandedBuffer = result.buffer;
        
        return {
            buffer: expandedBuffer,
            seed: result.seed,
            metadata: expansionMetadata,
            saved: result.saved,
            filename: result.filename
        };
        
    } catch (error) {
        console.error('❌ Expand canvas processing error:', error);
        throw error;
    }
}

// Process enhance stage - img2img with strength/noise
async function processEnhanceStage(globalResources, stage, body, baseMetadata, generationParams, workspaceId, ws, handler, requestId) {
    bindRuntimeGlobalResources(globalResources);
    try {
        console.log(`🔍 Processing enhance stage with strength: ${params.strength}, noise: ${params.noise}`);
        
        // Get system defaults for generation
        const defaultParams = {
            model: 'v4_5',
            steps: 28,
            guidance: 4.9,
            rescale: 0.07,
            sampler: 'k_euler_ancestral',
            noise_schedule: 'karras',
            seed: undefined // Let system generate random seed unless overridden
        };
        
        // Merge with advanced overrides
        const genParams = { ...defaultParams, ...params.advanced };
        
        // Build request body for img2img
        const requestBody = {
            prompt: params.prompt || '',
            uc: params.uc || '',
            characterPrompts: params.characterPrompts || [],
            model: genParams.model,
            steps: genParams.steps,
            guidance: genParams.guidance,
            rescale: genParams.rescale,
            sampler: genParams.sampler,
            noise_schedule: genParams.noise_schedule,
            strength: params.strength,
            noise: params.noise || 0,
            image: `data:${imageBuffer.toString('base64')}`,
            upscale: params.upscale || false,
            append_quality: 0,
            append_uc: 0
            // Note: no_save will be set by the calling function based on stage requirements
        };
        
        // Add seed if provided in overrides
        if (genParams.seed !== undefined) {
            requestBody.seed = genParams.seed;
        }
        
        // Build options for generation
        const opts = await buildOptions(globalResources, requestBody, null, {}, null, null);
        
        // Set no_save flag if specified
        if (params.no_save) {
            opts.no_save = true;
        }
        
        // Add stage information to opts for progress messages
        if (params.stageIndex !== undefined) {
            opts.stageIndex = params.stageIndex;
            opts.stageType = 'enhance';
            opts.totalStages = params.totalStages;
            opts.stage_seeds = params.stageSeeds || [];
            opts.pipeline = params.pipeline;
            opts.text_replacements = params.text_replacements;
        }
        
        // Generate enhanced image
        console.log(`🎨 Generating enhanced image...`);
        const result = await handleGeneration(globalResources, opts, true, null, params.workspaceId, null, streamingCallback, ws, handler);
        
        // Create metadata for the enhancement
        const enhanceMetadata = {
            enhance_strength: params.strength,
            enhance_noise: params.noise,
            enhance_params: genParams,
            generation_type: 'enhanced'
        };
        
        // Stage metadata is now handled by handleGeneration, so we don't need to update the buffer again
        const enhancedBuffer = result.buffer;
        
        return {
            buffer: enhancedBuffer,
            seed: result.seed,
            metadata: enhanceMetadata,
            saved: result.saved,
            filename: result.filename
        };
        
    } catch (error) {
        console.error('❌ Enhance stage processing error:', error);
        throw error;
    }
}

/**
 * Resolve the inpaint prompt (and metadata side-effects) for expand-canvas: optional Grok enhancement, or source prompt only.
 * Used by expandImage and previewExpandImagePrompt.
 */
async function resolveExpandImageExpansionPrompt({
    originalImageBuffer,
    originalDims,
    targetDims,
    imageBias,
    originalPrompt,
    enableAI,
    overrideParams,
    ws,
    handler,
    requestId
}) {
    const origAR = originalDims.width / originalDims.height;
    const targetAR = targetDims.width / targetDims.height;
    const isExpandingHorizontally = origAR < targetAR;
    const isExpandingVertically = origAR > targetAR;

    const biasFractions = [0, 0.25, 0.5, 0.75, 1];
    const biasFrac = biasFractions[imageBias] !== undefined ? biasFractions[imageBias] : 0.5;

    let direction;
    let leftPercent = 0;
    let rightPercent = 0;
    let topPercent = 0;
    let bottomPercent = 0;

    if (isExpandingVertically) {
        direction = 'taller';
        const addedHeight = targetDims.height - targetDims.width / origAR;
        const topAdd = addedHeight * biasFrac;
        const bottomAdd = addedHeight * (1 - biasFrac);
        topPercent = Math.round((topAdd / targetDims.height) * 100);
        bottomPercent = Math.round((bottomAdd / targetDims.height) * 100);
    } else if (isExpandingHorizontally) {
        direction = 'wider';
        const addedWidth = targetDims.width - targetDims.height * origAR;
        const leftAdd = addedWidth * biasFrac;
        const rightAdd = addedWidth * (1 - biasFrac);
        leftPercent = Math.round((leftAdd / targetDims.width) * 100);
        rightPercent = Math.round((rightAdd / targetDims.width) * 100);
    } else {
        throw new Error('Cannot expand: original and target have the same aspect ratio');
    }

    let expansionPrompt;
    let expansionReason;
    let expansionReasonDisplay;

    const imageBufferUsable = Buffer.isBuffer(originalImageBuffer) && originalImageBuffer.length > 0;
    let runExpansionAi = enableAI;
    if (enableAI && !imageBufferUsable) {
        console.warn('⚠️ resolveExpandImageExpansionPrompt: missing or empty originalImageBuffer; skipping Grok expansion.');
        runExpansionAi = false;
    }

    if (runExpansionAi) {
        let expansionDescription = `given this image we are adding content to make it ${direction}`;
        if (direction === 'wider') {
            if (leftPercent > 0 && rightPercent > 0) {
                expansionDescription += ` by adding ${leftPercent}% on the left and ${rightPercent}% on the right`;
            } else if (leftPercent > 0) {
                expansionDescription += ` by adding ${leftPercent}% on the left`;
            } else {
                expansionDescription += ` by adding ${rightPercent}% on the right`;
            }
        } else {
            if (topPercent > 0 && bottomPercent > 0) {
                expansionDescription += ` by adding ${topPercent}% on the top and ${bottomPercent}% on the bottom`;
            } else if (topPercent > 0) {
                expansionDescription += ` by adding ${topPercent}% on the top`;
            } else {
                expansionDescription += ` by adding ${bottomPercent}% on the bottom`;
            }
        }

        let aiInstruction = expansionDescription;

        if (originalPrompt) {
            aiInstruction += `\n\nThe original image was generated with this NovelAI prompt:\n---\n${originalPrompt}\n---`;
        }

        aiInstruction += `\n\nNovelAI Emphasis Syntax Rules:
- {tag} = light emphasis, {{tag}} = stronger emphasis, {{{tag}}} = even stronger
- [tag] = light de-emphasis, [[tag]] = stronger de-emphasis, [[[tag]]] = even stronger
- 1.5::content:: = weighted emphasis groups (positive or negative values) (preserve the weight::content:: structure exactly)

CRITICAL: Preserve all artist/style references and environment tags from the original prompt verbatim. Include them unchanged in your output to maintain artistic consistency.`;

        const requestedContent = overrideParams?.requestedContent;
        if (requestedContent && requestedContent.trim()) {
            aiInstruction += `\n\nUser has requested to incorporate the following into the expanded area:\n---\n${requestedContent.trim()}\n---`;
        }

        aiInstruction += `\n\nAdd descriptive text to help clarify and enhance the environment in the expanded area. Focus on adding missing visual details that would naturally extend the existing scene. Do not describe scale, give directional instructions, or duplicate information already present in the original prompt. Only add text if it provides meaningful environmental details that aren't already clear from the original prompt. Your response should be only the additional descriptive text to append to the original prompt.`;

        if (ws && handler) {
            handler.sendGenerationProgress(ws, requestId, {
                phase: 'starting',
                hasDynamicGen: true
            });
        }

        console.log(`🤖 Calling Grok for expansion prompt with enhanced context`);

        const ExpansionPromptSchema = z.object({
            additional_text: z.string().describe('Additional descriptive text to append to the original prompt'),
            reason: z.string().describe('Brief reasoning for the additional text'),
            reason_display: z.string().describe('Very short explanation for display in UI (2-5 words)')
        });

        const messages = [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${originalImageBuffer.toString('base64')}`,
                            detail: 'high'
                        }
                    },
                    {
                        type: 'text',
                        text: aiInstruction
                    }
                ]
            }
        ];

        console.log(`🤖 Starting Grok expansion AI call with requestId: ${requestId}`);
        const expansionAttemptId = `image-expansion-${requestId || 'unknown'}-${Date.now()}`;
        const grokResponse = await __runtimeGr.getGrokService().callDirectorAIWithStructuredOutput(messages, {
            model: __runtimeGr.getGrokService().getDefaultGrokModel(),
            timeout: 120000,
            store: false,
            responseSchema: ExpansionPromptSchema,
            ws: ws,
            handler: handler,
            requestId: requestId,
            _attemptId: expansionAttemptId
        });
        console.log(`✅ Grok expansion AI call completed`);

        const additionalText = grokResponse.content?.additional_text || grokResponse.additional_text;
        expansionReason = grokResponse.content?.reason || grokResponse.reason;
        expansionReasonDisplay = grokResponse.content?.reason_display || grokResponse.content?.reason || grokResponse.reason;

        if (originalPrompt) {
            const commaText = matchCommaTextColon(originalPrompt);
            if (commaText) {
                const beforeText = originalPrompt.substring(0, commaText.index).trim();
                expansionPrompt = beforeText + ', ' + additionalText + ', Text:' + originalPrompt.substring(commaText.index + commaText.length);
            } else {
                expansionPrompt = originalPrompt + ', ' + additionalText;
            }
        } else {
            expansionPrompt = additionalText;
        }

        console.log(`✨ Grok additional text: ${additionalText}`);
        console.log(`🔗 Combined expansion prompt: ${expansionPrompt}`);
        console.log(`💭 Grok reasoning: ${expansionReason}`);

        if (ws && handler && requestId) {
            handler.sendGenerationProgress(ws, requestId, {
                phase: 'completion',
                hasDynamicGen: true,
                reasoning: expansionReasonDisplay
            });
            console.log(`✅ Sent completion progress message`);
        } else {
            console.warn(`⚠️ Cannot send completion progress: ws=${!!ws}, handler=${!!handler}, requestId=${requestId}`);
        }
    } else {
        if (!enableAI) {
            console.log('🚫 AI processing disabled, using original prompt');
            expansionReason = 'AI processing disabled';
            expansionReasonDisplay = '';
        } else {
            console.log('🚫 Skipping Grok expansion (no usable image buffer), using original prompt');
            expansionReason = 'Expansion AI skipped: invalid image buffer';
            expansionReasonDisplay = 'No image for AI';
        }
        expansionPrompt = originalPrompt;

        if (ws && handler && requestId) {
            handler.sendGenerationProgress(ws, requestId, {
                phase: 'completion',
                hasDynamicGen: false
            });
            console.log(`✅ Sent completion progress (AI disabled)`);
        }
    }

    return { expansionPrompt, expansionReason, expansionReasonDisplay };
}

/** Preview-only: same prompt/UC as expand would use (runs Grok when enableAI). */
async function previewExpandImagePrompt(
    globalResources,
    filename,
    resolution,
    imageBias,
    overrideParams = {},
    sourceFilename = null,
    enableAI = false,
    ws = null,
    handler = null,
    requestId = null
) {
    bindRuntimeGlobalResources(globalResources);
    const filePath = path.join(__runtimeGr.getPath('images'), filename);
    if (!fs.existsSync(filePath)) {
        throw new Error('Image not found');
    }
    const sourceFilePath = sourceFilename ? path.join(__runtimeGr.getPath('images'), sourceFilename) : null;
    if (sourceFilePath && !fs.existsSync(sourceFilePath)) {
        throw new Error('Source image not found');
    }

    const originalImageBuffer = fs.readFileSync(filePath);
    const sourceImageBuffer = sourceFilePath ? fs.readFileSync(sourceFilePath) : originalImageBuffer;
    const originalDims = await getImageDimensions(originalImageBuffer);

    let originalPrompt = '';
    let originalUc = '';
    let originalCharacters = [];
    try {
        const metadata = __runtimeGr.getPngMetadata().readMetadata(sourceImageBuffer);
        if (metadata?.tEXt?.Comment) {
            const parsedMetadata = JSON.parse(metadata.tEXt.Comment);
            originalPrompt = parsedMetadata.prompt || '';
            originalUc = parsedMetadata.uc || '';
            originalCharacters = parsedMetadata.characterPrompts || parsedMetadata.forge_data?.allCharacters || [];
        }
    } catch (error) {
        console.warn('⚠️ Could not extract original metadata:', error.message);
    }

    const targetDims = getDimensionsFromResolution(resolution?.toLowerCase() || '');
    if (!targetDims || !targetDims.width || !targetDims.height) {
        throw new Error(`Invalid target resolution: ${resolution}`);
    }

    const { expansionPrompt, expansionReason, expansionReasonDisplay } = await resolveExpandImageExpansionPrompt({
        originalImageBuffer,
        originalDims,
        targetDims,
        imageBias,
        originalPrompt,
        enableAI,
        overrideParams,
        ws,
        handler,
        requestId
    });

    return {
        prompt: expansionPrompt,
        uc: originalUc,
        characterPrompts: originalCharacters,
        expansionReason,
        expansionReasonDisplay
    };
}

function resolveForgeModelFromPngBuffer(imageBuffer, fallback = 'v4_5') {
    try {
        const pngMetadata = __runtimeGr.getPngMetadata();
        const raw = pngMetadata.readMetadata(imageBuffer);
        const source = raw?.tEXt?.Source;
        if (source) {
            const determined = pngMetadata.determineModelFromMetadata({ source });
            if (determined && String(determined).toLowerCase() !== 'unknown') {
                return String(determined).toLowerCase();
            }
        }
        if (raw?.tEXt?.Comment) {
            const parsed = JSON.parse(raw.tEXt.Comment);
            const slug = parsed?.model ? String(parsed.model).toLowerCase() : '';
            if (slug) {
                const { loadModelFeatures } = require('./modelFeatures');
                const map = loadModelFeatures();
                const fromKey = slug.replace(/_inp$/, '');
                if (map[fromKey]) {
                    return fromKey;
                }
                for (const [key, caps] of Object.entries(map)) {
                    if (String(caps?.apiModel || '').toLowerCase() === slug) {
                        return key;
                    }
                    if (String(caps?.inpaintApiModel || '').toLowerCase() === slug) {
                        return key;
                    }
                }
            }
        }
    } catch (_err) {
        // Fall through to default
    }
    return fallback;
}

// Image expansion function - expands image to new resolution using AI-powered inpainting
async function expandImage(globalResources, filename, resolution, imageBias, upscaleAfterComplete = false, overrideParams = {}, sessionId, workspaceId = null, streamingCallback = null, ws = null, handler = null, requestId = null, sourceFilename = null, enableAI = false, stepPreviewWidth = null, stepPreviewHeight = null) {
    bindRuntimeGlobalResources(globalResources);
    try {
        console.log(`🔍 Starting image expansion: ${filename} to ${resolution} with bias ${imageBias}`);
        const inset = overrideParams?.inset === true || overrideParams?.inset === 'true' || overrideParams?.inset === 1;
        console.log(`📌 Expansion inset (native-scale letterbox padding): ${inset}`);
        
        // Load original image
        const filePath = path.join(__runtimeGr.getPath('images'), filename);
        if (!fs.existsSync(filePath)) {
            throw new Error('Image not found');
        }
        const sourceFilePath = sourceFilename ? path.join(__runtimeGr.getPath('images'), sourceFilename) : null;
        if (sourceFilePath && !fs.existsSync(sourceFilePath)) {
            throw new Error('Source image not found');
        }
        
        const originalImageBuffer = fs.readFileSync(filePath);
        const sourceImageBuffer = sourceFilePath ? fs.readFileSync(sourceFilePath) : originalImageBuffer;
        const originalDims = await getImageDimensions(originalImageBuffer);
        console.log(`📐 Original dimensions: ${originalDims.width}x${originalDims.height}`);
        
        // Extract original prompt, UC, and characters from PNG metadata
        let originalPrompt = '';
        let originalUc = '';
        let originalCharacters = [];
        const originalModel = resolveForgeModelFromPngBuffer(sourceImageBuffer, 'v4_5');
        try {
            const metadata = __runtimeGr.getPngMetadata().readMetadata(sourceImageBuffer);
            if (metadata?.tEXt?.Comment) {
                const parsedMetadata = JSON.parse(metadata.tEXt.Comment);
                originalPrompt = parsedMetadata.prompt || '';
                originalUc = parsedMetadata.uc || '';
                // Extract compiled characters (use top-level characterPrompts if available, fallback to forge_data)
                originalCharacters = parsedMetadata.characterPrompts || parsedMetadata.forge_data?.allCharacters || [];
            }
        } catch (error) {
            console.warn('⚠️ Could not extract original metadata:', error.message);
        }
        console.log(`🎨 Expansion source model: ${originalModel}`);
        
        // Get target dimensions from resolution
        const targetDims = getDimensionsFromResolution(resolution?.toLowerCase() || '');
        if (!targetDims || !targetDims.width || !targetDims.height) {
            throw new Error(`Invalid target resolution: ${resolution}`);
        }
        console.log(`🎯 Target dimensions: ${targetDims.width}x${targetDims.height}`);
        
        // Process image with letterbox mode to add transparent padding
        const letterboxedBuffer = await processDynamicImageLetterbox(originalImageBuffer, targetDims, imageBias, { inset });
        console.log(`📦 Letterboxed image created`);
        
        // Load letterboxed image for mask creation
        const letterboxedImg = await loadImage(letterboxedBuffer);
        
        // Calculate compressed dimensions (8x smaller)
        const compressedMaskWidth = Math.round(targetDims.width / 8);
        const compressedMaskHeight = Math.round(targetDims.height / 8);
        
        // Create downsampled version of letterboxed image first
        const downsampledCanvas = createCanvas(compressedMaskWidth, compressedMaskHeight);
        const downsampledCtx = downsampledCanvas.getContext('2d');
        downsampledCtx.imageSmoothingEnabled = false; // Nearest neighbor
        downsampledCtx.drawImage(letterboxedImg, 0, 0, compressedMaskWidth, compressedMaskHeight);
        
        // Extract alpha channel from downsampled image
        const downsampledImageData = downsampledCtx.getImageData(0, 0, compressedMaskWidth, compressedMaskHeight);
        const downsampledData = downsampledImageData.data;
        
        // Detect which edges have transparency in downsampled image
        let hasTransparentTop = false, hasTransparentBottom = false;
        let hasTransparentLeft = false, hasTransparentRight = false;
        
        // Check top edge
        for (let x = 0; x < compressedMaskWidth; x++) {
            const i = (0 * compressedMaskWidth + x) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentTop = true;
                break;
            }
        }
        
        // Check bottom edge
        for (let x = 0; x < compressedMaskWidth; x++) {
            const i = ((compressedMaskHeight - 1) * compressedMaskWidth + x) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentBottom = true;
                break;
            }
        }
        
        // Check left edge
        for (let y = 0; y < compressedMaskHeight; y++) {
            const i = (y * compressedMaskWidth + 0) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentLeft = true;
                break;
            }
        }
        
        // Check right edge
        for (let y = 0; y < compressedMaskHeight; y++) {
            const i = (y * compressedMaskWidth + (compressedMaskWidth - 1)) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentRight = true;
                break;
            }
        }
        
        // Determine expansion direction
        const origAR = originalDims.width / originalDims.height;
        const targetAR = targetDims.width / targetDims.height;
        const isExpandingHorizontally = origAR < targetAR;
        const isExpandingVertically = origAR > targetAR;
        
        // Create mask from downsampled alpha channel
        const maskCanvas = createCanvas(compressedMaskWidth, compressedMaskHeight);
        const maskCtx = maskCanvas.getContext('2d');
        const maskImageData = maskCtx.createImageData(compressedMaskWidth, compressedMaskHeight);
        const maskData = maskImageData.data;
        
        // Mark transparent areas as white, opaque areas as black
        for (let i = 0; i < downsampledData.length; i += 4) {
            const alpha = downsampledData[i + 3];
            if (alpha < 128) {
                // Transparent - mark as white (to be painted)
                maskData[i] = 255;
                maskData[i + 1] = 255;
                maskData[i + 2] = 255;
                maskData[i + 3] = 255;
            } else {
                // Opaque - mark as black (preserve)
                maskData[i] = 0;
                maskData[i + 1] = 0;
                maskData[i + 2] = 0;
                maskData[i + 3] = 255;
            }
        }
        
        const expandedMaskData = dilateExpansionMaskWhiteIntoOpaque(maskData, compressedMaskWidth, compressedMaskHeight, {
            inset,
            hasTransparentTop,
            hasTransparentBottom,
            hasTransparentLeft,
            hasTransparentRight,
            isExpandingHorizontally,
            isExpandingVertically
        });
        
        // Create ImageData using canvas context (Node.js compatible)
        const finalMaskImageData = maskCtx.createImageData(compressedMaskWidth, compressedMaskHeight);
        finalMaskImageData.data.set(expandedMaskData);
        maskCtx.putImageData(finalMaskImageData, 0, 0);
        
        const compressedMaskBase64 = maskCanvas.toDataURL('image/png').split(',')[1];
        console.log(`🎭 Mask created and compressed: ${compressedMaskWidth}x${compressedMaskHeight}`);
        
        // Calculate expansion percentages based on bias and dimensions
        const biasFractions = [0, 0.25, 0.5, 0.75, 1];
        const biasFrac = biasFractions[imageBias] !== undefined ? biasFractions[imageBias] : 0.5;
        
        let direction, leftPercent = 0, rightPercent = 0, topPercent = 0, bottomPercent = 0;
        
        if (isExpandingVertically) {
            // Expanding vertically (taller)
            direction = 'taller';
            const addedHeight = targetDims.height - (targetDims.width / origAR);
            const topAdd = addedHeight * biasFrac;
            const bottomAdd = addedHeight * (1 - biasFrac);
            topPercent = Math.round((topAdd / targetDims.height) * 100);
            bottomPercent = Math.round((bottomAdd / targetDims.height) * 100);
        } else if (isExpandingHorizontally) {
            // Expanding horizontally (wider)
            direction = 'wider';
            const addedWidth = targetDims.width - (targetDims.height * origAR);
            const leftAdd = addedWidth * biasFrac;
            const rightAdd = addedWidth * (1 - biasFrac);
            leftPercent = Math.round((leftAdd / targetDims.width) * 100);
            rightPercent = Math.round((rightAdd / targetDims.width) * 100);
        } else {
            // No expansion needed (same aspect ratio)
            throw new Error('Cannot expand: original and target have the same aspect ratio');
        }

        let expansionPrompt;
        let expansionReason;
        let expansionReasonDisplay;

        if (typeof overrideParams?.expansionPromptOverride === 'string') {
            expansionPrompt = overrideParams.expansionPromptOverride;
            expansionReason = 'User-edited prompt';
            expansionReasonDisplay = 'Edited';
        } else {
            const resolved = await resolveExpandImageExpansionPrompt({
                originalImageBuffer,
                originalDims,
                targetDims,
                imageBias,
                originalPrompt,
                enableAI,
                overrideParams,
                ws,
                handler,
                requestId
            });
            expansionPrompt = resolved.expansionPrompt;
            expansionReason = resolved.expansionReason;
            expansionReasonDisplay = resolved.expansionReasonDisplay;
        }

        let ucForRequest = originalUc;
        if (typeof overrideParams?.expansionUcOverride === 'string') {
            ucForRequest = overrideParams.expansionUcOverride;
        }

        // Get system defaults for generation (model follows the source image, including V5)
        const defaultParams = {
            model: originalModel,
            steps: 28,
            guidance: 4.9,
            rescale: 0.07,
            sampler: 'k_euler_ancestral',
            noise_schedule: 'karras',
            noise: 0,
            seed: undefined // Let system generate random seed unless overridden
        };
        
        // Merge with override params (strip prompt-review-only keys)
        const { expansionPromptOverride: _stripPromptOv, expansionUcOverride: _stripUcOv, ...overrideForGen } = overrideParams || {};
        const genParams = { ...defaultParams, ...overrideForGen };
        
        // Build request body for inpainting
        const requestBody = {
            prompt: expansionPrompt,
            uc: ucForRequest,
            characterPrompts: originalCharacters, // Use original characters from metadata
            model: genParams.model,
            steps: genParams.steps,
            guidance: genParams.guidance,
            rescale: genParams.rescale,
            sampler: genParams.sampler,
            noise_schedule: genParams.noise_schedule,
            strength: 1,
            noise: genParams.noise,
            resolution: resolution,
            image: `data:${letterboxedBuffer.toString('base64')}`, // Format: type:data
            mask_compressed: compressedMaskBase64,
            upscale: upscaleAfterComplete,
            append_quality: 0, // Disable quality presets since they're already compiled
            append_uc: 0, // Disable UC presets since we're using original UC
            no_save: true, // Prevent handleGeneration from saving, we'll save with custom name
            image_preletterboxed: true
        };

        if (stepPreviewWidth && stepPreviewHeight) {
            requestBody.stepPreviewWidth = stepPreviewWidth;
            requestBody.stepPreviewHeight = stepPreviewHeight;
        }
        
        console.log(`🔍 Expansion upscale setting: upscaleAfterComplete=${upscaleAfterComplete}, type=${typeof upscaleAfterComplete}`);
        
        // Add seed if provided in overrides
        if (genParams.seed !== undefined) {
            requestBody.seed = genParams.seed;
        }
        
        // Build options for generation
        const opts = await buildOptions(globalResources, requestBody, null, {}, null, null);
        
        // Create mock req for session tracking
        const mockReq = { session: { id: sessionId } };
        
        // Send progress update indicating image generation is starting
        if (ws && handler) {
            handler.sendGenerationProgress(ws, requestId, {
                phase: 'generating',
                hasDynamicGen: false,
                isUpscaling: upscaleAfterComplete
            });
        }

        // Generate expanded image
        console.log(`🎨 Generating expanded image...`);
        // Set the requestId in opts so handleGeneration uses it for progress updates
        opts.requestId = requestId;
        const result = await handleGeneration(globalResources, opts, true, null, workspaceId, mockReq, streamingCallback, ws, handler);
        
        // Add expansion metadata to result buffer
        const expansionMetadata = {
            expansion_source: sourceFilename || filename, // Use source filename for tracking original source
            expansion_resolution: resolution,
            expansion_bias: imageBias,
            expansion_inset: inset,
            expansion_direction: direction,
            expansion_percentages: {
                left: leftPercent,
                right: rightPercent,
                top: topPercent,
                bottom: bottomPercent
            },
            expansion_prompt: expansionPrompt,
            expansion_reason: expansionReason,
            expansion_params: genParams,
            generation_type: 'expanded'
        };
        
        // Store requested content if it was provided
        if (overrideParams.requestedContent) {
            expansionMetadata.expansion_requested_content = overrideParams.requestedContent;
        }
        
        const expandedBuffer = __runtimeGr.getPngMetadata().updateMetadata(result.buffer, expansionMetadata);
        
        // Save with "_expanded" suffix and fresh timestamp
        const namingFilename = sourceFilename || filename;
        const baseName = __runtimeGr.getPngMetadata().getBaseName(namingFilename);
        if (!baseName) {
            throw new Error('Could not derive output filename from source image');
        }
        // Remove old timestamp from basename (format: timestamp_name)
        const nameWithoutTimestamp = baseName.replace(/^\d+_/, '');
        const timestamp = Date.now();
        const expandedFilename = `${timestamp}_${nameWithoutTimestamp}_expanded.png`;
        const expandedPath = path.join(__runtimeGr.getPath('images'), expandedFilename);
        
        console.log(`💾 Attempting to save: ${expandedFilename} at ${expandedPath}`);
        console.log(`📊 Buffer size: ${expandedBuffer.length} bytes`);
        
        fs.writeFileSync(expandedPath, expandedBuffer);
        
        // Verify file was written
        if (fs.existsSync(expandedPath)) {
            const stats = fs.statSync(expandedPath);
            console.log(`✅ File saved successfully: ${expandedFilename} (${stats.size} bytes)`);
        } else {
            console.error(`❌ File was not saved: ${expandedFilename}`);
        }
        
        // Add to workspace
        const targetWorkspaceId = workspaceId || __runtimeGr.getWorkspaceManager().getActiveWorkspace(sessionId);
        console.log(`📂 Target workspace ID: ${targetWorkspaceId}`);
        
        if (targetWorkspaceId) {
            __runtimeGr.getWorkspaceManager().addToWorkspaceArray('files', expandedFilename, targetWorkspaceId);
            console.log(`✅ Added to workspace: ${expandedFilename} -> ${targetWorkspaceId}`);
            await recordReplicationGalleryJournal(expandedFilename, targetWorkspaceId);
        } else {
            console.warn(`⚠️ No workspace ID available, file not added to workspace`);
        }
        
        // Generate preview
        const expandedBaseName = __runtimeGr.getPngMetadata().getBaseName(expandedFilename);
        const expandedPreviewResult = await generateMobilePreviews(expandedPath, expandedBaseName);
        await storePreviewBlurhash(__runtimeGr, expandedFilename, expandedPreviewResult);

        // no_save skips handleGeneration's phase:complete — notify client so streaming finalize can finish.
        if (ws && handler && requestId) {
            handler.sendGenerationProgress(ws, requestId, {
                phase: 'complete',
                hasDynamicGen: false,
                isUpscaling: false,
                contentLength: expandedBuffer.length,
                filename: expandedFilename
            });
        }

        // no_save skipped handleGeneration's addReceiptMetadata — register so gallery width/height
        // are real pixel dims (otherwise PhotoSwipe falls back to 1024×1024 squares).
        let responseMetadata = null;
        try {
            const metadataDatabase = __runtimeGr.getMetadataDatabase();
            const imagesDir = __runtimeGr.getPath('images');
            const dbRow = await metadataDatabase.addReceiptMetadata(expandedFilename, imagesDir, null, null);
            const pngMeta = (dbRow?.metadata && typeof dbRow.metadata === 'object') ? dbRow.metadata : {};
            responseMetadata = await __runtimeGr.getPngMetadata().extractRelevantFields({
                ...pngMeta,
                width: dbRow?.width ?? pngMeta.width,
                height: dbRow?.height ?? pngMeta.height,
                actual_width: dbRow?.width ?? pngMeta.actual_width,
                actual_height: dbRow?.height ?? pngMeta.actual_height
            }, expandedFilename, dbRow?.blurhash || expandedPreviewResult?.blurhash);
        } catch (metadataError) {
            console.warn('⚠️ Failed to get metadata for expanded image:', metadataError);
        }

        return {
            filename: expandedFilename,
            image: expandedBuffer.toString('base64'),
            seed: result.seed,
            expansionPrompt,
            expansionReason,
            metadata: responseMetadata
        };
        
    } catch (error) {
        console.error('❌ Image expansion error:', error);
        throw error;
    }
}

// Image expansion reroll function - regenerates expanded image without AI call
async function rerollExpandedImage(globalResources, filename, overrideParams = {}, sessionId, workspaceId = null, streamingCallback = null, ws = null, handler = null, requestId = null, stepPreviewWidth = null, stepPreviewHeight = null) {
    bindRuntimeGlobalResources(globalResources);
    try {
        console.log(`🔄 Starting image expansion reroll: ${filename}`);
        
        // 1. Load image and extract metadata
        const filePath = path.join(__runtimeGr.getPath('images'), filename);
        if (!fs.existsSync(filePath)) {
            throw new Error('Image not found');
        }
        
        const imageBuffer = fs.readFileSync(filePath);
        const metadata = __runtimeGr.getPngMetadata().readMetadata(imageBuffer);
        
        // 2. Validate expansion metadata exists
        if (!metadata?.tEXt?.Comment) {
            throw new Error('No metadata found');
        }
        const parsedMetadata = JSON.parse(metadata.tEXt.Comment);
        const forgeData = parsedMetadata.forge_data || {};
        
        if (!forgeData.expansion_prompt) {
            throw new Error('Not an expanded image');
        }
        if (!forgeData.expansion_source) {
            throw new Error('Missing expansion_source');
        }
        
        // 3. Extract stored expansion data
        const expansionPrompt = forgeData.expansion_prompt;
        const expansion_source = forgeData.expansion_source;
        const resolution = forgeData.expansion_resolution;
        const imageBias = forgeData.expansion_bias;
        const originalPrompt = parsedMetadata.prompt || '';
        const originalUc = parsedMetadata.uc || '';
        const originalCharacters = parsedMetadata.characterPrompts || forgeData.allCharacters || [];
        const originalModel = resolveForgeModelFromPngBuffer(imageBuffer, 'v4_5');
        
        console.log(`📋 Reusing expansion prompt: ${expansionPrompt.substring(0, 100)}${expansionPrompt.length > 100 ? '...' : ''}`);
        console.log(`🔗 Maintaining expansion source: ${expansion_source}`);
        
        // Load the SOURCE image for letterboxing (not the expanded image)
        const sourceFilePath = path.join(__runtimeGr.getPath('images'), expansion_source);
        if (!fs.existsSync(sourceFilePath)) {
            throw new Error(`Source image not found: ${expansion_source}`);
        }
        const sourceImageBuffer = fs.readFileSync(sourceFilePath);
        
        // Get source image dimensions
        const originalDims = await getImageDimensions(sourceImageBuffer);
        console.log(`📐 Original dimensions: ${originalDims.width}x${originalDims.height}`);
        
        // Get target dimensions from resolution
        const targetDims = getDimensionsFromResolution(resolution?.toLowerCase() || '');
        if (!targetDims || !targetDims.width || !targetDims.height) {
            throw new Error(`Invalid target resolution: ${resolution}`);
        }
        console.log(`🎯 Target dimensions: ${targetDims.width}x${targetDims.height}`);
        
        // Process SOURCE image with letterbox mode to add transparent padding
        const insetFromForge = forgeData.expansion_inset === true || forgeData.expansion_params?.inset === true ||
            forgeData.expansion_params?.inset === 'true' || forgeData.expansion_params?.inset === 1;
        const insetFromOverrides = overrideParams?.inset === true || overrideParams?.inset === 'true' || overrideParams?.inset === 1;
        const inset = Object.prototype.hasOwnProperty.call(overrideParams || {}, 'inset')
            ? insetFromOverrides
            : insetFromForge;
        console.log(`📌 Expansion reroll inset (native-scale letterbox padding): ${inset}`);
        const letterboxedBuffer = await processDynamicImageLetterbox(sourceImageBuffer, targetDims, imageBias, { inset });
        console.log(`📦 Letterboxed image created`);
        
        // Load letterboxed image for mask creation
        const letterboxedImg = await loadImage(letterboxedBuffer);
        
        // Calculate compressed dimensions (8x smaller)
        const compressedMaskWidth = Math.round(targetDims.width / 8);
        const compressedMaskHeight = Math.round(targetDims.height / 8);
        
        // Create downsampled version of letterboxed image first
        const downsampledCanvas = createCanvas(compressedMaskWidth, compressedMaskHeight);
        const downsampledCtx = downsampledCanvas.getContext('2d');
        downsampledCtx.imageSmoothingEnabled = false; // Nearest neighbor
        downsampledCtx.drawImage(letterboxedImg, 0, 0, compressedMaskWidth, compressedMaskHeight);
        
        // Extract alpha channel from downsampled image
        const downsampledImageData = downsampledCtx.getImageData(0, 0, compressedMaskWidth, compressedMaskHeight);
        const downsampledData = downsampledImageData.data;
        
        // Detect which edges have transparency in downsampled image
        let hasTransparentTop = false, hasTransparentBottom = false;
        let hasTransparentLeft = false, hasTransparentRight = false;
        
        // Check top edge
        for (let x = 0; x < compressedMaskWidth; x++) {
            const i = (0 * compressedMaskWidth + x) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentTop = true;
                break;
            }
        }
        
        // Check bottom edge
        for (let x = 0; x < compressedMaskWidth; x++) {
            const i = ((compressedMaskHeight - 1) * compressedMaskWidth + x) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentBottom = true;
                break;
            }
        }
        
        // Check left edge
        for (let y = 0; y < compressedMaskHeight; y++) {
            const i = (y * compressedMaskWidth + 0) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentLeft = true;
                break;
            }
        }
        
        // Check right edge
        for (let y = 0; y < compressedMaskHeight; y++) {
            const i = (y * compressedMaskWidth + (compressedMaskWidth - 1)) * 4;
            if (downsampledData[i + 3] < 128) {
                hasTransparentRight = true;
                break;
            }
        }
        
        // Determine expansion direction
        const origAR = originalDims.width / originalDims.height;
        const targetAR = targetDims.width / targetDims.height;
        const isExpandingHorizontally = origAR < targetAR;
        const isExpandingVertically = origAR > targetAR;
        
        // Create mask from downsampled alpha channel
        const maskCanvas = createCanvas(compressedMaskWidth, compressedMaskHeight);
        const maskCtx = maskCanvas.getContext('2d');
        const maskImageData = maskCtx.createImageData(compressedMaskWidth, compressedMaskHeight);
        const maskData = maskImageData.data;
        
        // Mark transparent areas as white, opaque areas as black
        for (let i = 0; i < downsampledData.length; i += 4) {
            const alpha = downsampledData[i + 3];
            if (alpha < 128) {
                // Transparent - mark as white (to be painted)
                maskData[i] = 255;
                maskData[i + 1] = 255;
                maskData[i + 2] = 255;
                maskData[i + 3] = 255;
            } else {
                // Opaque - mark as black (preserve)
                maskData[i] = 0;
                maskData[i + 1] = 0;
                maskData[i + 2] = 0;
                maskData[i + 3] = 255;
            }
        }
        
        const expandedMaskData = dilateExpansionMaskWhiteIntoOpaque(maskData, compressedMaskWidth, compressedMaskHeight, {
            inset,
            hasTransparentTop,
            hasTransparentBottom,
            hasTransparentLeft,
            hasTransparentRight,
            isExpandingHorizontally,
            isExpandingVertically
        });
        
        // Create ImageData using canvas context (Node.js compatible)
        const finalMaskImageData = maskCtx.createImageData(compressedMaskWidth, compressedMaskHeight);
        finalMaskImageData.data.set(expandedMaskData);
        maskCtx.putImageData(finalMaskImageData, 0, 0);
        
        const compressedMaskBase64 = maskCanvas.toDataURL('image/png').split(',')[1];
        console.log(`🎭 Mask created and compressed: ${compressedMaskWidth}x${compressedMaskHeight}`);
        
        // 4. Merge stored params with overrides (source PNG model if none was saved)
        const defaultParams = {
            model: originalModel,
            steps: 28,
            guidance: 4.9,
            rescale: 0.07,
            sampler: 'k_euler_ancestral',
            noise_schedule: 'karras',
            noise: 0,
            ...(forgeData.expansion_params || {})
        };
        const genParams = { ...defaultParams, ...overrideParams };
        
        // 5. Build request WITHOUT calling AI
        const requestBody = {
            prompt: expansionPrompt,  // Use stored prompt directly
            uc: originalUc,
            characterPrompts: originalCharacters,
            model: genParams.model,
            steps: genParams.steps,
            guidance: genParams.guidance,
            rescale: genParams.rescale,
            sampler: genParams.sampler,
            noise_schedule: genParams.noise_schedule,
            strength: 1,
            noise: genParams.noise,
            resolution: resolution,
            image: `data:${letterboxedBuffer.toString('base64')}`,
            mask_compressed: compressedMaskBase64,
            upscale: genParams.upscale || false,
            append_quality: 0,
            append_uc: 0,
            no_save: true,
            image_preletterboxed: true
        };

        if (stepPreviewWidth && stepPreviewHeight) {
            requestBody.stepPreviewWidth = stepPreviewWidth;
            requestBody.stepPreviewHeight = stepPreviewHeight;
        }
        
        // Add seed if provided in overrides
        if (genParams.seed !== undefined) {
            requestBody.seed = genParams.seed;
            console.log(`🎲 Using seed: ${genParams.seed}`);
        } else {
            console.log(`🎲 Using random seed`);
        }
        
        // 6. Build options and generate
        const opts = await buildOptions(globalResources, requestBody, null, {}, null, null);
        const mockReq = { session: { id: sessionId } };
        
        if (ws && handler) {
            opts.requestId = requestId;
            handler.sendGenerationProgress(ws, requestId, {
                phase: 'generating',
                hasDynamicGen: false,  // No AI call
                isUpscaling: genParams.upscale
            });
        }
        
        console.log(`🎨 Generating rerolled expanded image...`);
        const result = await handleGeneration(globalResources, opts, true, null, workspaceId, mockReq, streamingCallback, ws, handler);
        
        // 7. Save with new filename, PRESERVE expansion_source
        const expansionMetadata = {
            expansion_source: expansion_source,  // Maintain the chain!
            expansion_resolution: resolution,
            expansion_bias: imageBias,
            expansion_inset: inset,
            expansion_direction: forgeData.expansion_direction,
            expansion_percentages: forgeData.expansion_percentages,
            expansion_prompt: expansionPrompt,
            expansion_reason: forgeData.expansion_reason,
            expansion_params: genParams,
            generation_type: 'expanded'
        };
        
        if (overrideParams.requestedContent) {
            expansionMetadata.expansion_requested_content = overrideParams.requestedContent;
        }
        
        const expandedBuffer = __runtimeGr.getPngMetadata().updateMetadata(result.buffer, expansionMetadata);
        
        // Save file
        const baseName = __runtimeGr.getPngMetadata().getBaseName(expansion_source);
        const nameWithoutTimestamp = baseName.replace(/^\d+_/, '');
        const timestamp = Date.now();
        const expandedFilename = `${timestamp}_${nameWithoutTimestamp}_expanded.png`;
        const expandedPath = path.join(__runtimeGr.getPath('images'), expandedFilename);
        
        console.log(`💾 Saving: ${expandedFilename}`);
        fs.writeFileSync(expandedPath, expandedBuffer);
        
        if (fs.existsSync(expandedPath)) {
            const stats = fs.statSync(expandedPath);
            console.log(`✅ File saved successfully: ${expandedFilename} (${stats.size} bytes)`);
        }
        
        // Add to workspace
        const targetWorkspaceId = workspaceId || __runtimeGr.getWorkspaceManager().getActiveWorkspace(sessionId);
        if (targetWorkspaceId) {
            __runtimeGr.getWorkspaceManager().addToWorkspaceArray('files', expandedFilename, targetWorkspaceId);
            console.log(`✅ Added to workspace: ${expandedFilename}`);
            await recordReplicationGalleryJournal(expandedFilename, targetWorkspaceId);
        }
        
        // Generate preview
        const rerollExpandedBase = __runtimeGr.getPngMetadata().getBaseName(expandedFilename);
        const rerollPreviewResult = await generateMobilePreviews(expandedPath, rerollExpandedBase);
        await storePreviewBlurhash(__runtimeGr, expandedFilename, rerollPreviewResult);

        // no_save skips handleGeneration's phase:complete — notify client so streaming finalize can finish.
        if (ws && handler && requestId) {
            handler.sendGenerationProgress(ws, requestId, {
                phase: 'complete',
                hasDynamicGen: false,
                isUpscaling: false,
                contentLength: expandedBuffer.length,
                filename: expandedFilename
            });
        }

        // no_save skipped handleGeneration's addReceiptMetadata — register so gallery width/height
        // are real pixel dims (otherwise PhotoSwipe falls back to 1024×1024 squares).
        let responseMetadata = null;
        try {
            const metadataDatabase = __runtimeGr.getMetadataDatabase();
            const imagesDir = __runtimeGr.getPath('images');
            const dbRow = await metadataDatabase.addReceiptMetadata(expandedFilename, imagesDir, null, null);
            const pngMeta = (dbRow?.metadata && typeof dbRow.metadata === 'object') ? dbRow.metadata : {};
            responseMetadata = await __runtimeGr.getPngMetadata().extractRelevantFields({
                ...pngMeta,
                width: dbRow?.width ?? pngMeta.width,
                height: dbRow?.height ?? pngMeta.height,
                actual_width: dbRow?.width ?? pngMeta.actual_width,
                actual_height: dbRow?.height ?? pngMeta.actual_height
            }, expandedFilename, dbRow?.blurhash || rerollPreviewResult?.blurhash);
        } catch (metadataError) {
            console.warn('⚠️ Failed to get metadata for rerolled expanded image:', metadataError);
        }

        return {
            filename: expandedFilename,
            image: expandedBuffer.toString('base64'),
            seed: result.seed,
            expansionPrompt,
            expansionReason: forgeData.expansion_reason,
            metadata: responseMetadata
        };
    } catch (error) {
        console.error('❌ Image reroll error:', error);
        throw error;
    }
}

/** Scan body/preset for text-replacement seeds (websocket scan_text_replacements). */
function collectTextReplacementSeeds(globalResources, body, preset = null) {
    bindRuntimeGlobalResources(globalResources);
    const currentPromptConfig = __runtimeGr.getPromptConfig({ clone: true });
    const presetName = body.presetName || body.preset
        || (preset ? Object.keys(currentPromptConfig.presets).find(key => currentPromptConfig.presets[key] === preset) : null);
    const effectivePreset = preset || (presetName ? currentPromptConfig.presets[presetName] : null);
    const model = body.model || effectivePreset?.model;
    if (!model) {
        return [];
    }

    const rawPrompt = (body.prompt !== undefined && body.prompt !== null) ? body.prompt : effectivePreset?.prompt;
    const rawNegativePrompt = (body.uc !== undefined && body.uc !== null) ? body.uc : effectivePreset?.uc;
    const rawInputPromptNegative = (body.input_prompt_negative !== undefined && body.input_prompt_negative !== null)
        ? body.input_prompt_negative
        : (body.prompt_negative !== undefined && body.prompt_negative !== null
            ? body.prompt_negative
            : (effectivePreset?.input_prompt_negative ?? effectivePreset?.prompt_negative ?? ''));

    let periodKey = body.dynamic_generation?.compiled_prompt?.context?.time?.periodKey || getCurrentPeriodKey();
    if (periodKey) {
        periodKey = normalizePeriodKey(periodKey);
    }

    let lockedReplacements = null;
    if (body.text_replacements_seed && Array.isArray(body.text_replacements_seed)) {
        lockedReplacements = body.text_replacements_seed;
    } else if (effectivePreset?.text_replacements_seed && Array.isArray(effectivePreset.text_replacements_seed)) {
        lockedReplacements = effectivePreset.text_replacements_seed;
    }

    const currentStageData = {
        stageIndex: 0,
        stageType: 'base',
        text_replacements: body.text_replacements || [],
        pipelineStageGeneration: Array.isArray(body.pipeline) && body.pipeline.length > 0,
    };

    const processedPromptResult = __runtimeGr.getTextReplacements().applyTextReplacements(rawPrompt, presetName, model, periodKey, lockedReplacements, currentStageData);
    const processedNegativePromptResult = __runtimeGr.getTextReplacements().applyTextReplacements(rawNegativePrompt, presetName, model, periodKey, lockedReplacements, currentStageData);
    const processedPromptNegativeFragmentResult = __runtimeGr.getTextReplacements().applyTextReplacements(
        rawInputPromptNegative || '',
        presetName,
        model,
        periodKey,
        lockedReplacements,
        currentStageData
    );

    const allTextReplacementSeeds = [
        ...processedPromptResult.replacements.map(r => ({ ...r, source: 'prompt' })),
        ...processedNegativePromptResult.replacements.map(r => ({ ...r, source: 'negative_prompt' })),
        ...processedPromptNegativeFragmentResult.replacements.map(r => ({ ...r, source: 'input_prompt_negative' }))
    ];

    const characterPrompts = body.allCharacterPrompts || effectivePreset?.allCharacterPrompts;
    if (characterPrompts && Array.isArray(characterPrompts)) {
        characterPrompts.forEach((char, charIndex) => {
            const charPromptResult = __runtimeGr.getTextReplacements().applyTextReplacements(char.prompt, presetName, model, periodKey, lockedReplacements, currentStageData);
            const charUcResult = __runtimeGr.getTextReplacements().applyTextReplacements(char.uc, presetName, model, periodKey, lockedReplacements, currentStageData);
            const charPromptNegativeResult = __runtimeGr.getTextReplacements().applyTextReplacements(
                char.input_prompt_negative || '',
                presetName,
                model,
                periodKey,
                lockedReplacements,
                currentStageData
            );
            allTextReplacementSeeds.push(
                ...charPromptResult.replacements.map(r => ({ ...r, source: `character_${charIndex}_prompt` })),
                ...charUcResult.replacements.map(r => ({ ...r, source: `character_${charIndex}_uc` })),
                ...charPromptNegativeResult.replacements.map(r => ({ ...r, source: `character_${charIndex}_input_prompt_negative` }))
            );
        });
    }

    return allTextReplacementSeeds;
}

async function compileDynamicGenerationWebSocket(globalResources, body, ws, handler, wsServer) {
    bindRuntimeGlobalResources(globalResources);

    if (!body || typeof body !== 'object') {
        throw new Error('Invalid request body');
    }
    if (!body.model) {
        throw new Error('Invalid request: model parameter is required');
    }
    if (!body.dynamic_generation) {
        throw new Error('Dynamic generation configuration is required');
    }

    body.compile_only = true;
    body.no_save = true;
    body.requestId = body.requestId || `compile-${Date.now()}`;

    try {
        __runtimeGr.getTracing().startTrace(body.requestId, { type: 'compile_dynamic_generation', workspace: body.workspace || null });
    } catch {}

    await buildOptions(globalResources, body, null, {}, ws, handler, wsServer);

    const compiled_prompt = body.dynamic_generation?.compiled_prompt;
    if (!compiled_prompt) {
        throw new Error('Dynamic generation compile produced no compiled_prompt');
    }

    const application_context = buildPromptApplicationContext(body._promptApplicationBaseline);

    if (!compiled_prompt.applied_preset_controls && application_context.applied_preset_controls) {
        compiled_prompt.applied_preset_controls = application_context.applied_preset_controls;
    }
    compiled_prompt.application_context = application_context;

    if (ws && handler) {
        handler.sendGenerationProgress(ws, body.requestId, {
            phase: 'completion',
            hasDynamicGen: true
        });
    }

    try {
        __runtimeGr.getTracing().finalizeTrace(body.requestId, 'completed', { compileOnly: true });
    } catch {}

    return {
        success: compiled_prompt.success !== false,
        compiled_prompt,
        application_context
    };
}

async function applyTendaiPreviewWebSocket(globalResources, body, ws, handler, wsServer) {
    bindRuntimeGlobalResources(globalResources);

    if (!body || typeof body !== 'object') {
        throw new Error('Invalid request body');
    }
    if (!body.model) {
        throw new Error('Invalid request: model parameter is required');
    }

    const selectedReplacements = body.selected_replacements;
    if (!selectedReplacements || !Array.isArray(selectedReplacements) || selectedReplacements.length === 0) {
        throw new Error('No replacements selected for apply');
    }

    body.compile_only = true;
    body.requestId = body.requestId || `apply-tendai-${Date.now()}`;

    await buildOptions(globalResources, body, null, {}, ws, handler, wsServer);

    const application_context = body._promptApplicationBaseline
        ? buildPromptApplicationContext(body._promptApplicationBaseline)
        : (body.dynamic_generation?.compiled_prompt?.application_context || buildPromptApplicationContext(null));

    const baseline = body._promptApplicationBaseline;
    if (!baseline) {
        throw new Error('Could not build prompt application baseline');
    }

    const resolvedBefore = {
        prompt: baseline.promptForAI || '',
        uc: baseline.ucForAI || '',
        character_prompts: (baseline.characterPromptsForAI || []).map(c => ({
            prompt: c.prompt || '',
            uc: c.uc || ''
        }))
    };

    const textReplacementsShape = { prompt: [], uc: [], character_prompts: [] };

    selectedReplacements.forEach((rep) => {
        const targetType = rep.targetType || 'prompt';
        if (targetType === 'prompt') {
            textReplacementsShape.prompt.push(rep);
        } else if (targetType === 'uc') {
            textReplacementsShape.uc.push(rep);
        } else if (targetType === 'character') {
            const idx = rep.targetSource ?? 0;
            if (!textReplacementsShape.character_prompts[idx]) {
                textReplacementsShape.character_prompts[idx] = { prompt: [], uc: [] };
            }
            const field = rep.targetField || 'prompt';
            textReplacementsShape.character_prompts[idx][field].push(rep);
        }
    });

    let resolvedAfter = {
        prompt: resolvedBefore.prompt,
        uc: resolvedBefore.uc,
        character_prompts: resolvedBefore.character_prompts.map(c => ({ ...c }))
    };

    if (textReplacementsShape.prompt.length > 0) {
        const result = applyDynamicReplacements(__runtimeGr, resolvedAfter.prompt, textReplacementsShape, 'prompt');
        if (result.success) resolvedAfter.prompt = result.result;
    }
    if (textReplacementsShape.uc.length > 0) {
        const result = applyDynamicReplacements(__runtimeGr, resolvedAfter.uc, textReplacementsShape, 'uc');
        if (result.success) resolvedAfter.uc = result.result;
    }
    textReplacementsShape.character_prompts.forEach((charRep, index) => {
        if (!charRep) return;
        if (!resolvedAfter.character_prompts[index]) {
            resolvedAfter.character_prompts[index] = { prompt: '', uc: '' };
        }
        if (charRep.prompt?.length > 0) {
            const result = applyDynamicReplacements(
                __runtimeGr,
                resolvedAfter.character_prompts[index].prompt || '',
                textReplacementsShape,
                'character',
                index,
                'prompt'
            );
            if (result.success) resolvedAfter.character_prompts[index].prompt = result.result;
        }
        if (charRep.uc?.length > 0) {
            const result = applyDynamicReplacements(
                __runtimeGr,
                resolvedAfter.character_prompts[index].uc || '',
                textReplacementsShape,
                'character',
                index,
                'uc'
            );
            if (result.success) resolvedAfter.character_prompts[index].uc = result.result;
        }
    });

    const mapped = mapProcessedToRaw(application_context, resolvedBefore, resolvedAfter);

    const rawChars = body.allCharacterPrompts || [];
    const mergedChars = rawChars.map((char, i) => ({
        ...char,
        prompt: mapped.allCharacterPrompts[i]?.prompt ?? char.prompt,
        uc: mapped.allCharacterPrompts[i]?.uc ?? char.uc
    }));

    return {
        success: true,
        prompt: mapped.prompt,
        uc: mapped.uc,
        allCharacterPrompts: mergedChars,
        preset_toggle_hints: mapped.preset_toggle_hints || {},
        application_context
    };
}

function applyEnhanceOverrideNumber(requestBody, key, value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) requestBody[key] = parsed;
}

function applyEnhanceOverrideString(requestBody, key, value) {
    if (value == null) return;
    const text = String(value).trim();
    if (text) requestBody[key] = text;
}

async function enhanceImage(globalResources, filename, scale, sessionId, workspaceId = null, streamingCallback = null, ws = null, handler = null, requestId = null, enhanceOptions = {}) {
    bindRuntimeGlobalResources(globalResources);
    const isMax = String(scale).toLowerCase() === 'max';
    const allowedScales = new Set([1, 1.5, 2]);
    const enhanceScale = isMax ? 1 : Number(scale);
    if (!isMax && !allowedScales.has(enhanceScale)) {
        throw new Error('Enhance scale must be 1, 1.5, 2, or max');
    }

    const filePath = path.join(__runtimeGr.getPath('images'), filename);
    if (!filename || !fs.existsSync(filePath)) {
        throw new Error('Image not found');
    }

    const sourceBuffer = fs.readFileSync(filePath);
    const sourceMetadata = __runtimeGr.getPngMetadata().readMetadata(sourceBuffer);
    if (!sourceMetadata?.tEXt?.Comment) {
        throw new Error('Enhance requires generation metadata');
    }

    const parsedMetadata = JSON.parse(sourceMetadata.tEXt.Comment);
    if (sourceMetadata.tEXt?.Source) {
        parsedMetadata.source = sourceMetadata.tEXt.Source;
    }
    const sourceDimensions = await getImageDimensions(sourceBuffer);
    const requestBody = await convertMetadataToRequestFormat(globalResources, {
        filename,
        workspace: workspaceId,
        metadata: parsedMetadata
    });
    const { getModelFeatures } = require('./modelFeatures');
    const modelFeatures = getModelFeatures(requestBody.model, __runtimeGr.getModelFeaturesMap());
    if (!modelFeatures) {
        throw new Error(`Enhance is not supported by model ${requestBody.model || 'unknown'}`);
    }
    if (isMax && !modelFeatures.maxEnhance) {
        throw new Error(`Max Enhance is not supported by model ${requestBody.model || 'unknown'}`);
    }
    if (isMax) {
        const area = sourceDimensions.width * sourceDimensions.height;
        const minArea = Number(modelFeatures.maxEnhanceMinArea);
        const maxArea = Number(modelFeatures.maxEnhanceMaxArea);
        if ((Number.isFinite(minArea) && area < minArea)
            || (Number.isFinite(maxArea) && area >= maxArea)) {
            throw new Error(`Max Enhance requires an image area between ${minArea} and ${maxArea} pixels; received ${area}.`);
        }
    }

    applyEnhanceOverrideString(requestBody, 'model', enhanceOptions.model);
    applyEnhanceOverrideNumber(requestBody, 'steps', enhanceOptions.steps);
    applyEnhanceOverrideNumber(requestBody, 'guidance', enhanceOptions.guidance);
    applyEnhanceOverrideNumber(requestBody, 'rescale', enhanceOptions.rescale);
    applyEnhanceOverrideString(requestBody, 'sampler', enhanceOptions.sampler);
    applyEnhanceOverrideString(requestBody, 'noiseScheduler', enhanceOptions.noiseScheduler);

    const strength = Number.isFinite(Number(enhanceOptions.strength)) ? Number(enhanceOptions.strength) : 0.5;
    const noise = Number.isFinite(Number(enhanceOptions.noise)) ? Number(enhanceOptions.noise) : 0;
    const seed = Number.isFinite(Number(enhanceOptions.seed))
        ? Number(enhanceOptions.seed)
        : crypto.randomInt(0, 4294967295);

    requestBody.image = `data:${sourceBuffer.toString('base64')}`;
    if (isMax) {
        requestBody.width = sourceDimensions.width;
        requestBody.height = sourceDimensions.height;
        requestBody.upscaled_enhance = true;
    } else {
        requestBody.width = Math.max(1, Math.floor(sourceDimensions.width * enhanceScale));
        requestBody.height = Math.max(1, Math.floor(sourceDimensions.height * enhanceScale));
        requestBody.upscaled_enhance = false;
    }
    requestBody.strength = strength;
    requestBody.noise = noise;
    requestBody.seed = seed;
    requestBody.upscale = false;
    requestBody.no_save = false;
    requestBody.requestId = requestId;
    delete requestBody.resolution;

    if (!isMax && modelFeatures.enhancePromptAdd && requestBody.prompt && !String(requestBody.prompt).includes('upscaled, blurry')) {
        const addition = '-2::upscaled, blurry::';
        const { tagsPart, index } = splitPromptAtTextColon(requestBody.prompt);
        if (index !== -1) {
            const processedTags = tagsPart ? `${tagsPart}, ${addition}` : addition;
            requestBody.prompt = processedTags + ', Text:' + requestBody.prompt.substring(index + 5);
        } else {
            requestBody.prompt = `${requestBody.prompt}, ${addition}`;
        }
    }

    const opts = await buildOptions(globalResources, requestBody, null, {}, ws, handler);
    opts.action = __runtimeGr.getNekoAiService('Action').IMG2IMG;
    opts.strength = strength;
    opts.noise = noise;
    opts.image_source = filename;
    opts.original_filename = filename;
    opts.requestId = requestId;
    if (isMax) {
        opts.upscaled_enhance = true;
        opts.upscale = undefined;
        opts.max_enhance_source = filename;
    } else {
        opts.enhance_scale = enhanceScale;
        opts.enhance_source = filename;
    }

    const mockReq = { session: { id: sessionId } };
    return handleGeneration(
        globalResources,
        opts,
        true,
        requestBody.preset || null,
        workspaceId,
        mockReq,
        streamingCallback,
        ws,
        handler,
        sourceMetadata
    );
}

async function maxEnhanceImage(globalResources, filename, sessionId, workspaceId = null, streamingCallback = null, ws = null, handler = null, requestId = null, enhanceOptions = {}) {
    return enhanceImage(
        globalResources,
        filename,
        'max',
        sessionId,
        workspaceId,
        streamingCallback,
        ws,
        handler,
        requestId,
        enhanceOptions
    );
}

module.exports = {
    generateImageWebSocket,
    buildOptions,
    handleGeneration,
    handleImageRequest,
    selectPresetItem,
    generatePresetSourceImage,
    convertMetadataToRequestFormat,
    handleRerollGeneration,
    expandImage,
    rerollExpandedImage,
    processExpandCanvas,
    processEnhanceStage,
    handleStagedGeneration,
    previewExpandImagePrompt,
    collectTextReplacementSeeds,
    compileDynamicGenerationWebSocket,
    applyTendaiPreviewWebSocket,
    enhanceImage,
    maxEnhanceImage,
};

