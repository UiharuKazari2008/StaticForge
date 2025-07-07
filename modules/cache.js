const fs = require('fs');
const path = require('path');

// Preset cache system - stores filenames instead of buffers to reduce memory usage
const presetCache = new Map();

// Cache management functions
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
        presetCache.delete(cacheKey);
        return null;
    }
    
    // Check if the file still exists
    const filePath = path.join('./images', cached.filename);
    if (!fs.existsSync(filePath)) {
        presetCache.delete(cacheKey);
        return null;
    }
    
    return cached;
};

const setCachedPreset = (cacheKey, filename) => {
    const now = Date.now();
    presetCache.set(cacheKey, {
        filename,
        timestamp: now
    });
};

const clearPresetCache = () => {
    const beforeSize = presetCache.size;
    presetCache.clear();
};

const getCacheStatus = () => {
    const now = Date.now();
    const cacheEntries = [];
    
    for (const [key, value] of presetCache.entries()) {
        const ageSeconds = Math.round((now - value.timestamp) / 1000);
        const ageMinutes = Math.round(ageSeconds / 60);
        const expiresIn = Math.max(0, 30 * 60 - ageSeconds);
        
        // Check if file exists and get its size
        const filePath = path.join('./images', value.filename);
        let fileSize = 0;
        if (fs.existsSync(filePath)) {
            try {
                const stats = fs.statSync(filePath);
                fileSize = stats.size;
            } catch (error) {
                fileSize = 0;
            }
        }
        
        cacheEntries.push({
            key,
            filename: value.filename,
            age: `${ageMinutes}m ${ageSeconds % 60}s`,
            expiresIn: `${Math.floor(expiresIn / 60)}m ${expiresIn % 60}s`,
            size: fileSize,
            exists: fs.existsSync(filePath)
        });
    }
    
    return {
        totalEntries: presetCache.size,
        entries: cacheEntries,
        ttl: "30 minutes"
    };
};

module.exports = {
    presetCache,
    getPresetCacheKey,
    getCachedPreset,
    setCachedPreset,
    clearPresetCache,
    getCacheStatus
}; 