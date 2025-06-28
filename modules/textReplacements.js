const fs = require('fs');

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

// Utility function for random selection
const getReplacementValue = value => Array.isArray(value) ? value[Math.floor(Math.random() * value.length)] : value;

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

module.exports = {
    loadPromptConfig,
    getReplacementValue,
    applyTextReplacements,
    getUsedReplacements
}; 