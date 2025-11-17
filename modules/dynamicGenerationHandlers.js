// Dynamic Generation Handler Functions
// Handles intelligent prompt modification based on real-world context (time, weather, etc.)

// Load secure configuration
let secureConfig = require('../secure.config.json');
const config = require('../config.json');

const https = require('https');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const tzLookup = require('tz-lookup');
const geo2city = require('geo2city');

const cacheDir = path.resolve(__dirname, '../.cache');
const { determineTimePeriod, getSunriseSunset } = require('./dynamicGenerationHandlers.timeCalc');
const { callDirectorAIWithStructuredOutput, getAllToolDefinitions } = require('./aiServices/grokService');
const { getTagGroupsInfo } = require('./tag-lookup');

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
        'earlyevening': 'night',
        'early_evening': 'night',
        'evening': 'night',
        'lateevening': 'night',
        'late_evening': 'night'
    };
    
    return legacyMappings[normalized] || normalized;
}
const globalResources = require('./globalResources');
const localPromptOptimizer = require('./localPromptOptimizer');
const { createDynamicGenerationResponseSchema, getZodSchemaKeyCount } = require('./dynamicGenerationSchema');
const ClothingDatabase = require('./clothingDatabase');
const logger = require('./logger');

/**
 * Filter tools for fast mode - only allows memory tools, verification tools, and complete tooling
 * @param {Array} tools - Array of all available tools
 * @returns {Array} Filtered array of tools allowed in fast mode
 */
function filterToolsForFastMode(tools) {
    const allowedToolNames = [
        'retrieveKnowledgeMemory',
        'searchKnowledgeMemories',
        'validateTextReplacement',
        'completeTooling'
    ];
    
    return tools.filter(tool => allowedToolNames.includes(tool.name));
}

/**
 * Generate a consistent prompt hash for cache validation
 * @param {string} prompt - The main prompt
 * @param {string} uc - The negative prompt
 * @param {Array} characterPrompts - Character prompts array
 * @returns {string} MD5 hash of the prompts
 */
function generatePromptHash(prompt, uc, characterPrompts) {
    return crypto.createHash('md5')
        .update(JSON.stringify({
            prompt: prompt,
            uc: uc,
            characterPrompts: characterPrompts || []
        }))
        .digest('hex');
}

/**
 * Generate a consistent request hash for dynamic generation context parameters
 * Used for cache validation and context locking validation
 * NOTE: Does NOT include directive - directive has its own hash
 * @param {Object} dynamicConfig - The dynamic generation configuration
 * @param {Object} datasetConfig - The dataset configuration (optional)
 * @returns {string} MD5 hash of the context parameters
 */
function generateRequestHash(dynamicConfig, datasetConfig = null) {
    return crypto.createHash('md5')
        .update(JSON.stringify({
            tod: dynamicConfig.tod,
            weather: dynamicConfig.weather,
            season: dynamicConfig.season,
            activity: dynamicConfig.activity,
            action: dynamicConfig.action,
            location: dynamicConfig.location,
            optimize: dynamicConfig.optimize,
            creative: dynamicConfig.creative,
            clothing: dynamicConfig.clothing,
            observeHoliday: dynamicConfig.observeHoliday,
            nsfw_level: datasetConfig?.nsfw
        }))
        .digest('hex');
}

/**
 * Generate a consistent directive hash
 * @param {string} directive - The directive text
 * @returns {string} MD5 hash of the directive
 */
function generateDirectiveHash(directive) {
    return crypto.createHash('md5')
        .update(directive || '')
        .digest('hex');
}

// Weather provider - Open-Meteo API (free, no API key required)
// Weather data cache with size limits and LRU eviction
class LRUCache {
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
        this.cache = new Map();
        this.accessOrder = new Map(); // For LRU tracking
        this.accessCounter = 0;
    }

    get(key) {
        if (this.cache.has(key)) {
            // Update access time for LRU
            this.accessOrder.set(key, ++this.accessCounter);
            return this.cache.get(key);
        }
        return undefined;
    }

    set(key, value) {
        // Update access time
        this.accessOrder.set(key, ++this.accessCounter);

        // If key exists, just update value
        if (this.cache.has(key)) {
            this.cache.set(key, value);
            return;
        }

        // If at capacity after adding this item, remove least recently used item
        if (this.cache.size >= this.maxSize) {
            let oldestKey = null;
            let oldestAccess = Infinity;

            // Find the key with the smallest (oldest) access time
            for (const [k, accessTime] of this.accessOrder) {
                if (accessTime < oldestAccess) {
                    oldestAccess = accessTime;
                    oldestKey = k;
                }
            }

            if (oldestKey !== null) {
                this.cache.delete(oldestKey);
                this.accessOrder.delete(oldestKey);
                console.log(`🗑️ Cache eviction: removed ${oldestKey} due to LRU (access time: ${oldestAccess})`);
            }
        }

        this.cache.set(key, value);
    }

    clear() {
        this.cache.clear();
        this.accessOrder.clear();
        this.accessCounter = 0;
    }

    size() {
        return this.cache.size;
    }

    // Periodic cleanup of expired entries
    cleanupExpired(maxAge) {
        const now = Date.now();
        const keysToDelete = [];

        for (const [key, value] of this.cache) {
            if (value.timestamp && (now - value.timestamp) > maxAge) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => {
            this.cache.delete(key);
            this.accessOrder.delete(key);
        });

        if (keysToDelete.length > 0) {
            console.log(`🧹 Cache cleanup: removed ${keysToDelete.length} expired entries`);
        }
    }
}

const weatherCache = new LRUCache(config?.lruCache?.weatherSize || 500); // Max 500 weather cache entries
const locationCache = new LRUCache(config?.lruCache?.locationSize || 50); // Max 50 location cache entries
const WEATHER_CACHE_DURATION = config?.lruCache?.weatherDuration || 3 * 60 * 1000; // 3 minutes in milliseconds
const LOCATION_CACHE_DURATION = config?.lruCache?.locationDuration || 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const WEATHER_FAILURE_CACHE_DURATION = config?.lruCache?.weatherFailureDuration || 15 * 60 * 1000; // 15 minutes for failed requests

// Periodic cache cleanup to prevent memory leaks from expired entries
setInterval(() => {
    try {
        weatherCache.cleanupExpired(WEATHER_FAILURE_CACHE_DURATION);
        locationCache.cleanupExpired(LOCATION_CACHE_DURATION);
        console.log(`🧹 Periodic cache cleanup: weather=${weatherCache.size()}, location=${locationCache.size()}`);
    } catch (error) {
        console.warn('⚠️ Cache cleanup error:', error.message);
    }
}, 30 * 60 * 1000); // Run every 30 minutes

// Enhanced weather cache for Open-Meteo data
const ENHANCED_WEATHER_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes for enhanced data

/**
 * Calculate vector average for circular quantities like wind direction
 * @param {number[]} directions - Array of directions in degrees (0-360)
 * @returns {number} Average direction in degrees (0-360)
 */
function calculateVectorAverage(directions) {
    if (!directions || directions.length === 0) return null;

    // Convert degrees to radians and calculate vector components
    let sumX = 0;
    let sumY = 0;

    for (const direction of directions) {
        const rad = (direction * Math.PI) / 180;
        sumX += Math.cos(rad);
        sumY += Math.sin(rad);
    }

    // Calculate average direction
    const avgRad = Math.atan2(sumY, sumX);
    const avgDeg = (avgRad * 180) / Math.PI;

    // Normalize to 0-360 range
    return (avgDeg + 360) % 360;
}

/**
 * Get timezone by latitude and longitude using offline lookup
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {string} IANA timezone identifier (e.g., 'America/New_York')
 */
function getTimezoneByCoordinates(latitude, longitude) {
    try {
        // Validate coordinates
        if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            console.warn(`⚠️ Invalid coordinates for timezone lookup: lat=${latitude}, lon=${longitude}`);
            return 'UTC';
        }

        // Use tz-lookup to get IANA timezone identifier
        const timezone = tzLookup(latitude, longitude);
        return timezone;
    } catch (error) {
        console.warn(`⚠️ Timezone lookup failed for coordinates (${latitude}, ${longitude}):`, error.message);
        return 'UTC'; // Fallback to UTC
    }
}

/**
 * Weather condition code mapping for Open-Meteo (WMO Weather interpretation codes)
 * @param {number} code - WMO weather code
 * @returns {string} Descriptive condition name
 */
function mapOpenMeteoCondition(code) {
    const conditions = {
        0: 'clear sky',
        1: 'mainly clear',
        2: 'partly cloudy',
        3: 'overcast',
        45: 'fog',
        48: 'depositing rime fog',
        51: 'light drizzle',
        53: 'moderate drizzle',
        55: 'dense drizzle',
        56: 'light freezing drizzle',
        57: 'dense freezing drizzle',
        61: 'slight rain',
        63: 'moderate rain',
        65: 'heavy rain',
        66: 'light freezing rain',
        67: 'heavy freezing rain',
        71: 'slight snow fall',
        73: 'moderate snow fall',
        75: 'heavy snow fall',
        77: 'snow grains',
        80: 'slight rain showers',
        81: 'moderate rain showers',
        82: 'violent rain showers',
        85: 'slight snow showers',
        86: 'heavy snow showers',
        95: 'thunderstorm',
        96: 'thunderstorm with slight hail',
        99: 'thunderstorm with heavy hail'
    };
    return conditions[code] || 'unknown';
}

/**
 * Reconcile weather condition with cloud coverage to avoid conflicting descriptions
 * Prioritizes cloud coverage for cloud-based conditions but preserves weather phenomena
 * @param {string} condition - Weather condition from weather code
 * @param {number|null} cloudCover - Cloud coverage percentage (0-100)
 * @returns {string} Accurate condition based on cloud coverage and weather code
 */
function reconcileConditionWithCloudCover(condition, cloudCover) {
    // Conditions that are inherently weather phenomena (rain, snow, fog) should NOT be overridden by cloud coverage
    const weatherPhenomenaConditions = [
        'fog', 'depositing rime fog', 'light drizzle', 'moderate drizzle', 'dense drizzle',
        'light freezing drizzle', 'dense freezing drizzle', 'slight rain', 'moderate rain',
        'heavy rain', 'light freezing rain', 'heavy freezing rain', 'slight snow fall',
        'moderate snow fall', 'heavy snow fall', 'snow grains', 'slight rain showers',
        'moderate rain showers', 'violent rain showers', 'slight snow showers',
        'heavy snow showers', 'thunderstorm', 'thunderstorm with slight hail',
        'thunderstorm with heavy hail'
    ];

    // If it's a weather phenomenon, preserve it regardless of cloud coverage
    if (weatherPhenomenaConditions.includes(condition)) {
        return condition;
    }

    // For cloud-based conditions, use cloud coverage when available
    if (cloudCover !== null && cloudCover !== undefined) {
        if (cloudCover >= 90) return 'overcast';
        if (cloudCover >= 80) return 'mostly cloudy sky';
        if (cloudCover >= 60) return 'partly cloudy sky';
        if (cloudCover >= 30) return 'mostly clear sky';
        if (cloudCover >= 10) return 'few clouds';
        return 'clear sky';
    }

    // Fall back to original condition when cloud coverage is unavailable
    return condition;
}

/**
 * Icon mapping for Open-Meteo weather codes (compatible with OpenWeather icon format)
 * @param {number} code - WMO weather code
 * @param {boolean} isDay - Whether it's daytime (default: true)
 * @returns {string} Icon code (e.g., '01d', '10n')
 */
function mapOpenMeteoIcon(code, isDay = true) {
    const dayNight = isDay ? 'd' : 'n';

    // Map WMO codes to OpenWeather-style icon codes
    const iconMap = {
        // Clear sky
        0: `01${dayNight}`, // clear sky

        // Partly cloudy
        1: `02${dayNight}`, // mainly clear
        2: `03${dayNight}`, // partly cloudy

        // Overcast/cloudy
        3: `04${dayNight}`, // overcast

        // Fog
        45: `50${dayNight}`, // fog
        48: `50${dayNight}`, // depositing rime fog

        // Drizzle
        51: `09${dayNight}`, // light drizzle
        53: `09${dayNight}`, // moderate drizzle
        55: `09${dayNight}`, // dense drizzle
        56: `09${dayNight}`, // light freezing drizzle
        57: `09${dayNight}`, // dense freezing drizzle

        // Rain
        61: `10${dayNight}`, // slight rain
        63: `10${dayNight}`, // moderate rain
        65: `10${dayNight}`, // heavy rain
        66: `10${dayNight}`, // light freezing rain
        67: `10${dayNight}`, // heavy freezing rain

        // Snow
        71: `13${dayNight}`, // slight snow fall
        73: `13${dayNight}`, // moderate snow fall
        75: `13${dayNight}`, // heavy snow fall
        77: `13${dayNight}`, // snow grains

        // Rain showers
        80: `09${dayNight}`, // slight rain showers
        81: `09${dayNight}`, // moderate rain showers
        82: `09${dayNight}`, // violent rain showers

        // Snow showers
        85: `13${dayNight}`, // slight snow showers
        86: `13${dayNight}`, // heavy snow showers

        // Thunderstorm
        95: `11${dayNight}`, // thunderstorm
        96: `11${dayNight}`, // thunderstorm with slight hail
        99: `11${dayNight}`  // thunderstorm with heavy hail
    };

    return iconMap[code] || `01${dayNight}`; // Default to clear sky
}

/**
 * Analyze precipitation composition and determine primary type
 * @param {number} rain - Rain amount
 * @param {number} showers - Shower amount
 * @param {number} snowfall - Snowfall amount
 * @param {number} temperature - Current temperature
 * @param {number} code - Weather code
 * @returns {object} Precipitation analysis
 */
function analyzePrecipitationType(rain, showers, snowfall, temperature, code) {
    const totalPrecipitation = rain + showers + snowfall;

    if (totalPrecipitation === 0) {
        return {
            type: 'none',
            intensity: 'none',
            description: 'no precipitation',
            composition: { rain: 0, showers: 0, snow: 0 }
        };
    }

    // Determine primary precipitation type
    let primaryType = 'mixed';
    let intensity = 'light';

    // Priority 1: Thunderstorm (overrides all other types)
    if (code >= 95) {
        primaryType = 'thunderstorm';
        intensity = 'heavy';
    }
    // Priority 2: Snow (when snow is the only precipitation)
    else if (snowfall > 0 && rain === 0 && showers === 0) {
        primaryType = 'snow';
    }
    // Priority 3: Mixed precipitation with freezing temperatures = Sleet
    else if (temperature <= 0 && rain > 0 && snowfall > 0) {
        primaryType = 'sleet';
    }
    // Priority 4: Freezing rain (rain/showers with freezing temperatures)
    else if (temperature <= 0 && (rain > 0 || showers > 0)) {
        primaryType = 'freezing_rain';
    }
    // Priority 5: Mixed precipitation (rain + snow when temp > 0)
    else if (rain > 0 && snowfall > 0) {
        primaryType = 'mixed';
    }
    // Priority 6: Rain (steady rain, not showers)
    else if (rain > 0 && showers === 0) {
        primaryType = 'rain';
    }
    // Priority 7: Showers (intermittent precipitation)
    else if (showers > 0) {
        primaryType = 'showers';
    }

    // Determine intensity based on total precipitation and weather code
    // Thunderstorms are always considered heavy regardless of amount
    if (code >= 95) {
        intensity = 'very heavy';
    } else if (totalPrecipitation > 10) {
        intensity = 'heavy';
    } else if (totalPrecipitation > 2.5) {
        intensity = 'moderate';
    } else if (totalPrecipitation > 0.1) {
        intensity = 'light';
    }

    // Create description
    let description = '';
    switch (primaryType) {
        case 'rain':
            description = `${intensity} rain`;
            break;
        case 'showers':
            description = `${intensity} showers`;
            break;
        case 'snow':
            description = `${intensity} snow`;
            break;
        case 'sleet':
            description = `${intensity} sleet`;
            break;
        case 'freezing_rain':
            description = `${intensity} freezing rain`;
            break;
        case 'thunderstorm':
            description = `thunderstorm with ${intensity} rain`;
            break;
        case 'mixed':
            description = `${intensity} mixed precipitation`;
            break;
        default:
            description = `${intensity} precipitation`;
    }

    return {
        type: primaryType,
        intensity,
        description,
        composition: {
            rain: rain || 0,
            showers: showers || 0,
            snow: snowfall || 0,
            total: totalPrecipitation
        }
    };
}

/**
 * Get weather data from Open-Meteo API
 * @param {Object} location - Location object with lat/lon
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Weather data from Open-Meteo
 */
async function getWeatherFromBestProvider(location, options = {}) {
    const {
        includeCurrent = true,
        pastHours = 2, // Past hours to retrieve (in 30min intervals)
        forecastHours = 1, // Future hours to forecast (in 30min intervals)
        includeWeekly = false, // Include weekly forecast
        startDate = null, // Start date for historical data range (YYYY-MM-DD)
        endDate = null, // End date for historical data range (YYYY-MM-DD)
        customDate = null, // Specific date for historical data (YYYY-MM-DD)
        customTimeOffset = null, // Time offset for custom scenarios (hours from now)
        timezone = null // Timezone for date calculations
    } = options;

    const cacheKey = `enhanced_${location.lat}_${location.lon}_${JSON.stringify(options)}`;

    return getCachedWeatherData(cacheKey, async () => {
        const params = new URLSearchParams({
            latitude: location.lat,
            longitude: location.lon,
            hourly: [
                'temperature_2m',
                'relative_humidity_2m',
                'dewpoint_2m',
                'apparent_temperature',
                'precipitation',
                'rain',
                'showers',
                'snowfall',
                'snow_depth',
                'weather_code',
                'pressure_msl',
                'surface_pressure',
                'cloud_cover',
                'cloud_cover_low',
                'cloud_cover_mid',
                'cloud_cover_high',
                'visibility',
                'evapotranspiration',
                'et0_fao_evapotranspiration',
                'vapour_pressure_deficit',
                'wind_speed_10m',
                'wind_direction_10m',
                'wind_gusts_10m',
                'soil_temperature_0cm',
                'soil_moisture_0_to_1cm'
            ].join(',')
        });

        // Add minutely data only for short-term forecasting (next 1-2 hours)
        if (forecastHours > 0 && forecastHours <= 2) {
            params.set('minutely_15', [
                'temperature_2m',
                'relative_humidity_2m',
                'apparent_temperature',
                'precipitation',
                'weather_code',
                'wind_speed_10m',
                'wind_direction_10m'
            ].join(','));
        }

        // Handle different data scenarios
        if (startDate && endDate) {
            // Historical data range
            params.set('start_date', startDate);
            params.set('end_date', endDate);
            params.set('daily', [
                'weather_code',
                'temperature_2m_max',
                'temperature_2m_min',
                'apparent_temperature_max',
                'apparent_temperature_min',
                'apparent_temperature_mean',
                'sunrise',
                'sunset',
                'sunshine_duration',
                'daylight_duration',
                'uv_index_max',
                'uv_index_clear_sky_max',
                'precipitation_sum',
                'rain_sum',
                'showers_sum',
                'snowfall_sum',
                'precipitation_hours',
                'precipitation_probability_max',
                'precipitation_probability_mean',
                'precipitation_probability_min',
                'wind_speed_10m_max',
                'wind_gusts_10m_max',
                'wind_direction_10m_dominant',
                'shortwave_radiation_sum',
                'et0_fao_evapotranspiration'
            ].join(','));
            params.set('hourly', [
                'temperature_2m',
                'relative_humidity_2m',
                'dewpoint_2m',
                'apparent_temperature',
                'precipitation',
                'rain',
                'showers',
                'snowfall',
                'snow_depth',
                'weather_code',
                'pressure_msl',
                'surface_pressure',
                'cloud_cover',
                'cloud_cover_low',
                'cloud_cover_mid',
                'cloud_cover_high',
                'visibility',
                'evapotranspiration',
                'et0_fao_evapotranspiration',
                'vapour_pressure_deficit',
                'wind_speed_10m',
                'wind_direction_10m',
                'wind_gusts_10m',
                'soil_temperature_0cm',
                'soil_moisture_0_to_1cm'
            ].join(','));

            // Use archive endpoint for historical data older than 3 months
            const useArchive = new Date(startDate) < new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            const baseUrl = useArchive ? 'https://archive-api.open-meteo.com/v1' : 'https://api.open-meteo.com/v1';
            const endpoint = useArchive ? 'archive' : 'forecast';
            const url = `${baseUrl}/${endpoint}?${params.toString()}`;

            try {
                const data = await makeHttpsRequest(url);
                // Transform historical data
                const result = {
                    timestamp: Date.now(),
                    dataSource: 'Open-Meteo Historical API',
                    location: {
                        latitude: data.latitude,
                        longitude: data.longitude,
                        timezone: data.timezone
                    },
                    dateRange: {
                        start: startDate,
                        end: endDate
                    },
                    daily: [],
                    statistics: {}
                };

                if (data.hourly && data.hourly.time) {
                    // Group by day and calculate daily statistics
                    const dailyGroups = {};
                    const times = data.hourly.time;

                    for (let i = 0; i < times.length; i++) {
                        const date = times[i].split('T')[0];
                        if (!dailyGroups[date]) {
                            dailyGroups[date] = {
                                date,
                                temperatures: [],
                                humidities: [],
                                dewPoints: [],
                                apparentTemperatures: [],
                                pressures: [],
                                surfacePressures: [],
                                cloudCovers: [],
                                cloudCoverLows: [],
                                cloudCoverMids: [],
                                cloudCoverHighs: [],
                                visibilities: [],
                                evaporations: [],
                                et0s: [],
                                vapourDeficits: [],
                                windDirections: [],
                                windGusts: [],
                                precipitations: [],
                                rains: [],
                                showers: [],
                                snowfalls: [],
                                snowDepths: [],
                                windSpeeds: [],
                                soilTemperatures: [],
                                soilMoistures: [],
                                conditions: [],
                                weatherCodes: []
                            };
                        }

                        dailyGroups[date].temperatures.push(data.hourly.temperature_2m[i]);
                        dailyGroups[date].humidities.push(data.hourly.relative_humidity_2m[i]);
                        if (data.hourly.dewpoint_2m) dailyGroups[date].dewPoints.push(data.hourly.dewpoint_2m[i]);
                        if (data.hourly.apparent_temperature) dailyGroups[date].apparentTemperatures.push(data.hourly.apparent_temperature[i]);
                        if (data.hourly.pressure_msl) dailyGroups[date].pressures.push(data.hourly.pressure_msl[i]);
                        if (data.hourly.surface_pressure) dailyGroups[date].surfacePressures.push(data.hourly.surface_pressure[i]);
                        if (data.hourly.cloud_cover) dailyGroups[date].cloudCovers.push(data.hourly.cloud_cover[i]);
                        if (data.hourly.cloud_cover_low) dailyGroups[date].cloudCoverLows.push(data.hourly.cloud_cover_low[i]);
                        if (data.hourly.cloud_cover_mid) dailyGroups[date].cloudCoverMids.push(data.hourly.cloud_cover_mid[i]);
                        if (data.hourly.cloud_cover_high) dailyGroups[date].cloudCoverHighs.push(data.hourly.cloud_cover_high[i]);
                        if (data.hourly.visibility) dailyGroups[date].visibilities.push(data.hourly.visibility[i]);
                        if (data.hourly.evapotranspiration) dailyGroups[date].evaporations.push(data.hourly.evapotranspiration[i]);
                        if (data.hourly.et0_fao_evapotranspiration) dailyGroups[date].et0s.push(data.hourly.et0_fao_evapotranspiration[i]);
                        if (data.hourly.vapour_pressure_deficit) dailyGroups[date].vapourDeficits.push(data.hourly.vapour_pressure_deficit[i]);
                        if (data.hourly.wind_direction_10m) dailyGroups[date].windDirections.push(data.hourly.wind_direction_10m[i]);
                        if (data.hourly.wind_gusts_10m) dailyGroups[date].windGusts.push(data.hourly.wind_gusts_10m[i]);
                        dailyGroups[date].precipitations.push(data.hourly.precipitation[i]);
                        if (data.hourly.rain) dailyGroups[date].rains.push(data.hourly.rain[i] || 0);
                        if (data.hourly.showers) dailyGroups[date].showers.push(data.hourly.showers[i] || 0);
                        if (data.hourly.snowfall) dailyGroups[date].snowfalls.push(data.hourly.snowfall[i] || 0);
                        if (data.hourly.snow_depth) dailyGroups[date].snowDepths.push(data.hourly.snow_depth[i] || 0);
                        dailyGroups[date].windSpeeds.push(data.hourly.wind_speed_10m[i]);
                        if (data.hourly.soil_temperature_0cm) dailyGroups[date].soilTemperatures.push(data.hourly.soil_temperature_0cm[i]);
                        if (data.hourly.soil_moisture_0_to_1cm) dailyGroups[date].soilMoistures.push(data.hourly.soil_moisture_0_to_1cm[i]);
                        dailyGroups[date].conditions.push(mapOpenMeteoCondition(data.hourly.weather_code[i]));
                        dailyGroups[date].weatherCodes.push(data.hourly.weather_code[i]);
                    }

                    // Calculate daily statistics
                    result.daily = Object.values(dailyGroups).map((day, index) => ({
                        date: day.date,
                        temperature: {
                            min: Math.min(...day.temperatures),
                            max: Math.max(...day.temperatures),
                            avg: day.temperatures.reduce((a, b) => a + b, 0) / day.temperatures.length
                        },
                        humidity: {
                            min: Math.min(...day.humidities),
                            max: Math.max(...day.humidities),
                            avg: day.humidities.reduce((a, b) => a + b, 0) / day.humidities.length
                        },
                        dewPoint: day.dewPoints.length > 0 ? {
                            min: Math.min(...day.dewPoints),
                            max: Math.max(...day.dewPoints),
                            avg: day.dewPoints.reduce((a, b) => a + b, 0) / day.dewPoints.length
                        } : null,
                        apparentTemperature: day.apparentTemperatures.length > 0 ? {
                            min: Math.min(...day.apparentTemperatures),
                            max: Math.max(...day.apparentTemperatures),
                            avg: day.apparentTemperatures.reduce((a, b) => a + b, 0) / day.apparentTemperatures.length
                        } : null,
                        pressure: day.pressures.length > 0 ? {
                            min: Math.min(...day.pressures),
                            max: Math.max(...day.pressures),
                            avg: day.pressures.reduce((a, b) => a + b, 0) / day.pressures.length
                        } : null,
                        surfacePressure: day.surfacePressures.length > 0 ? {
                            min: Math.min(...day.surfacePressures),
                            max: Math.max(...day.surfacePressures),
                            avg: day.surfacePressures.reduce((a, b) => a + b, 0) / day.surfacePressures.length
                        } : null,
                        cloudCover: day.cloudCovers.length > 0 ? {
                            min: Math.min(...day.cloudCovers),
                            max: Math.max(...day.cloudCovers),
                            avg: day.cloudCovers.reduce((a, b) => a + b, 0) / day.cloudCovers.length
                        } : null,
                        cloudCoverage: day.cloudCovers.length > 0 ? day.cloudCovers.reduce((a, b) => a + b, 0) / day.cloudCovers.length : 0,
                        cloudCoverLow: day.cloudCoverLows.length > 0 ? day.cloudCoverLows.reduce((a, b) => a + b, 0) / day.cloudCoverLows.length : null,
                        cloudCoverMid: day.cloudCoverMids.length > 0 ? day.cloudCoverMids.reduce((a, b) => a + b, 0) / day.cloudCoverMids.length : null,
                        cloudCoverHigh: day.cloudCoverHighs.length > 0 ? day.cloudCoverHighs.reduce((a, b) => a + b, 0) / day.cloudCoverHighs.length : null,
                        visibility: day.visibilities.length > 0 ? {
                            min: Math.min(...day.visibilities),
                            max: Math.max(...day.visibilities),
                            avg: day.visibilities.reduce((a, b) => a + b, 0) / day.visibilities.length
                        } : null,
                        evapotranspiration: day.evaporations.length > 0 ? day.evaporations.reduce((a, b) => a + b, 0) / day.evaporations.length : null,
                        et0: day.et0s.length > 0 ? day.et0s.reduce((a, b) => a + b, 0) / day.et0s.length : null,
                        vapourPressureDeficit: day.vapourDeficits.length > 0 ? day.vapourDeficits.reduce((a, b) => a + b, 0) / day.vapourDeficits.length : null,
                        windDirection: day.windDirections.length > 0 ? {
                            avg: Math.round(calculateVectorAverage(day.windDirections) * 10) / 10
                        } : null,
                        windGust: day.windGusts.length > 0 ? {
                            max: Math.max(...day.windGusts) / 3.6, // Convert km/h to m/s
                            avg: (day.windGusts.reduce((a, b) => a + b, 0) / day.windGusts.length) / 3.6 // Convert km/h to m/s
                        } : null,
                        precipitation: {
                            total: day.precipitations.reduce((a, b) => a + b, 0),
                            max: Math.max(...day.precipitations),
                            rain: day.rains.length > 0 ? day.rains.reduce((a, b) => a + b, 0) : 0,
                            showers: day.showers.length > 0 ? day.showers.reduce((a, b) => a + b, 0) : 0,
                            snow: day.snowfalls.length > 0 ? day.snowfalls.reduce((a, b) => a + b, 0) : 0
                        },
                        snowDepth: day.snowDepths.length > 0 ? {
                            max: Math.max(...day.snowDepths),
                            avg: day.snowDepths.reduce((a, b) => a + b, 0) / day.snowDepths.length
                        } : null,
                        windSpeed: {
                            max: Math.max(...day.windSpeeds) / 3.6, // Convert km/h to m/s
                            avg: (day.windSpeeds.reduce((a, b) => a + b, 0) / day.windSpeeds.length) / 3.6 // Convert km/h to m/s
                        },
                        soilTemperature: day.soilTemperatures.length > 0 ? day.soilTemperatures.reduce((a, b) => a + b, 0) / day.soilTemperatures.length : null,
                        soilMoisture: day.soilMoistures.length > 0 ? day.soilMoistures.reduce((a, b) => a + b, 0) / day.soilMoistures.length : null,
                        // Use daily weather code from API if available, otherwise median of hourly
                        dominantCondition: data.daily?.weather_code?.[index] ? mapOpenMeteoCondition(data.daily.weather_code[index]) : day.conditions[Math.floor(day.conditions.length / 2)],
                        dominantWeatherCode: data.daily?.weather_code?.[index] || day.weatherCodes[Math.floor(day.weatherCodes.length / 2)],
                        rawConditionId: data.daily?.weather_code?.[index] || day.weatherCodes[Math.floor(day.weatherCodes.length / 2)],
                        conditions: [...new Set(day.conditions)], // Unique conditions for the day
                        weatherCodes: [...new Set(day.weatherCodes)] // Unique weather codes for the day
                    }));

                    // Calculate overall statistics
                    result.statistics = calculateHistoricalStatistics(result.daily);
                }

                return result;

            } catch (error) {
                console.error('Open-Meteo historical API error:', error);
                return {
                    timestamp: Date.now(),
                    dataSource: 'Open-Meteo Historical API (error)',
                    location,
                    dateRange: { start: startDate, end: endDate },
                    daily: [],
                    statistics: {},
                    error: error.message
                };
            }
        } else {
            // Default case: Current weather with past/future data
            params.set('hourly', [
                'temperature_2m',
                'relative_humidity_2m',
                'dewpoint_2m',
                'apparent_temperature',
                'precipitation',
                'rain',
                'showers',
                'snowfall',
                'snow_depth',
                'weather_code',
                'pressure_msl',
                'surface_pressure',
                'cloud_cover',
                'cloud_cover_low',
                'cloud_cover_mid',
                'cloud_cover_high',
                'visibility',
                'evapotranspiration',
                'et0_fao_evapotranspiration',
                'vapour_pressure_deficit',
                'wind_speed_10m',
                'wind_direction_10m',
                'wind_gusts_10m',
                'soil_temperature_0cm',
                'soil_moisture_0_to_1cm'
            ].join(','));

            // Add minutely data only for short-term forecasting (next 1-2 hours)
            if (forecastHours > 0 && forecastHours <= 2) {
                params.set('minutely_15', [
                    'temperature_2m',
                    'relative_humidity_2m',
                    'apparent_temperature',
                    'precipitation',
                    'weather_code',
                    'wind_speed_10m',
                    'wind_direction_10m'
                ].join(','));
            }

            // Add daily weather data for sunrise/sunset
            params.set('daily', [
                'weather_code',
                'temperature_2m_max',
                'temperature_2m_min',
                'apparent_temperature_max',
                'apparent_temperature_min',
                'apparent_temperature_mean',
                'sunrise',
                'sunset',
                'sunshine_duration',
                'daylight_duration',
                'uv_index_max',
                'uv_index_clear_sky_max',
                'precipitation_sum',
                'rain_sum',
                'showers_sum',
                'snowfall_sum',
                'precipitation_hours',
                'precipitation_probability_max',
                'precipitation_probability_mean',
                'precipitation_probability_min',
                'wind_speed_10m_max',
                'wind_gusts_10m_max',
                'wind_direction_10m_dominant',
                'shortwave_radiation_sum',
                'et0_fao_evapotranspiration'
            ].join(','));

            // Add current weather if requested
            if (includeCurrent) {
                params.set('current', [
                    'temperature_2m',
                    'relative_humidity_2m',
                    'dewpoint_2m',
                    'apparent_temperature',
                    'precipitation',
                    'rain',
                    'snowfall',
                    'weather_code',
                    'pressure_msl',
                    'cloud_cover',
                    'wind_speed_10m',
                    'wind_direction_10m',
                    'wind_gusts_10m',
                    'visibility'
                ].join(','));
            }

            // Past hours - request enough historical data (Open-Meteo past_days gives hourly data for past days)
            const pastDays = Math.max(2, Math.ceil(pastHours / 12)); // Request at least 2 days for better historical coverage
            if (pastHours > 0) {
                params.set('past_days', pastDays);
            }

            // Forecast hours
            if (forecastHours > 0) {
                params.set('forecast_hours', forecastHours);
            }

            // Add timezone - use auto detection if not specified
            if (timezone) {
                params.set('timezone', timezone);
            } else {
                // Use auto timezone detection based on coordinates
                params.set('timezone', 'auto');
            }

            const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

            try {
                const data = await makeHttpsRequest(url);

                // Transform and enhance the data
                return transformOpenMeteoData(data, options);

            } catch (error) {
                console.error('Open-Meteo API error:', error);
                // Return reasonable fallback weather data instead of null
                return createFallbackWeatherData(location, options, error);
            }
        }
    }, ENHANCED_WEATHER_CACHE_DURATION);
}

/**
 * Calculate historical weather statistics from daily weather data
 * @param {Array} dailyData - Array of daily weather data objects
 * @returns {Object} Historical statistics
 */
function calculateHistoricalStatistics(dailyData) {
    if (!dailyData || dailyData.length === 0) {
        return {};
    }

    const stats = {
        temperature: {
            averageMin: 0,
            averageMax: 0,
            absoluteMin: Infinity,
            absoluteMax: -Infinity,
            average: 0
        },
        precipitation: {
            averageDaily: 0,
            rainyDays: 0,
            totalPrecipitation: 0
        },
        conditionFrequency: {}
    };

    // Calculate temperature statistics
    let totalMinTemp = 0;
    let totalMaxTemp = 0;
    let totalAvgTemp = 0;

    // Calculate precipitation and condition statistics
    let totalPrecipitation = 0;
    let rainyDays = 0;
    const conditionCounts = {};

    for (const day of dailyData) {
        // Temperature statistics
        if (day.temperature) {
            if (day.temperature.min !== undefined) {
                totalMinTemp += day.temperature.min;
                stats.temperature.absoluteMin = Math.min(stats.temperature.absoluteMin, day.temperature.min);
            }
            if (day.temperature.max !== undefined) {
                totalMaxTemp += day.temperature.max;
                stats.temperature.absoluteMax = Math.max(stats.temperature.absoluteMax, day.temperature.max);
            }
            if (day.temperature.avg !== undefined) {
                totalAvgTemp += day.temperature.avg;
            }
        }

        // Precipitation statistics
        if (day.precipitation) {
            const dailyPrecip = day.precipitation.total || 0;
            totalPrecipitation += dailyPrecip;
            if (dailyPrecip > 0) {
                rainyDays++;
            }
        }

        // Condition frequency
        if (day.dominantCondition) {
            conditionCounts[day.dominantCondition] = (conditionCounts[day.dominantCondition] || 0) + 1;
        }
    }

    const numDays = dailyData.length;

    // Calculate averages
    if (numDays > 0) {
        stats.temperature.averageMin = totalMinTemp / numDays;
        stats.temperature.averageMax = totalMaxTemp / numDays;
        stats.temperature.average = totalAvgTemp / numDays;
        stats.precipitation.averageDaily = totalPrecipitation / numDays;
    }

    stats.precipitation.rainyDays = rainyDays;
    stats.precipitation.totalPrecipitation = totalPrecipitation;

    // Calculate condition frequency percentages
    for (const [condition, count] of Object.entries(conditionCounts)) {
        stats.conditionFrequency[condition] = {
            count: count,
            percentage: Math.round((count / numDays) * 100)
        };
    }

    return stats;
}

/**
 * Retrieve comprehensive weather data using the best available provider
 * Uses Open-Meteo API for weather data
 * Supports current, historical, and forecast data with flexible time ranges
 * @param {Object} location - Location object with lat/lon
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Enhanced weather data
 */
async function getEnhancedWeatherData(location, options = {}) {
    const cacheKey = `enhanced_${location.lat}_${location.lon}_${JSON.stringify(options)}`;

    return getCachedWeatherData(cacheKey, async () => {
        return getWeatherFromBestProvider(location, options);
    }, ENHANCED_WEATHER_CACHE_DURATION);
}

/**
 * Estimate UV index based on time of day, date, and cloud cover
 * @param {Date} dateTime - Current date and time
 * @param {number} cloudCover - Cloud cover percentage (0-100)
 * @returns {number|null} Estimated UV index
 */
function estimateUVIndex(dateTime, cloudCover, latitude = 40) {
    try {
        const hour = dateTime.getHours() + dateTime.getMinutes() / 60;
        const dayOfYear = Math.floor((dateTime - new Date(dateTime.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));

        // Solar declination in radians
        const solarDeclination = (23.45 * Math.PI / 180) * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365);

        // Latitude in radians
        const latRad = latitude * Math.PI / 180;

        // Hour angle in radians (negative west of meridian)
        const hourAngle = (hour - 12) * 15 * Math.PI / 180;

        // Solar elevation angle calculation
        const sinElevation = Math.sin(solarDeclination) * Math.sin(latRad) +
                           Math.cos(solarDeclination) * Math.cos(latRad) * Math.cos(hourAngle);

        const solarElevation = Math.max(0, Math.asin(sinElevation) * 180 / Math.PI);

        // Base UV index based on solar elevation (more accurate relationship)
        let baseUV = 0;
        if (solarElevation > 0) {
            // UV index peaks around 11-12 at solar noon in clear skies
            // Relationship is approximately UV = (solarElevation / 90) * 12, but capped at 11
            baseUV = Math.min(11, (solarElevation / 90) * 12);
        }

        // Adjust for cloud cover (clouds reduce UV by 70-90%)
        const cloudFactor = 1 - (cloudCover / 100) * 0.85;
        const estimatedUV = baseUV * cloudFactor;

        return Math.max(0, Math.round(estimatedUV * 10) / 10); // Round to 1 decimal place
    } catch (error) {
        console.warn('UV index estimation failed:', error.message);
        return null;
    }
}

/**
 * Create fallback weather data when API calls fail
 * @param {Object} location - Location object
 * @param {Object} options - Request options
 * @param {Error} error - The error that occurred
 * @returns {Object} Fallback weather data
 */
function createFallbackWeatherData(location, options, error) {
    const now = Date.now();
    const baseTemp = 20; // Moderate default temperature
    const baseHumidity = 60; // Moderate default humidity

    // Create basic current weather
    const currentWeather = {
        temperature: baseTemp,
        humidity: baseHumidity,
        dewPoint: baseTemp - 5,
        feelsLike: baseTemp,
        condition: 'partly cloudy',
        description: 'Unable to retrieve live weather data',
        precipitation: 0,
        precipitationRate: 0,
        rain: 0,
        showers: 0,
        snowfall: 0,
        precipitationType: 'none',
        pressure: 1013,
        cloudCoverage: 0,
        windSpeed: 5,
        windDirection: 180,
        windGust: null,
        visibility: 10000,
        uvIndex: 5,
        rawConditionId: 803,
        timestamp: now,
        dataSource: 'Fallback Data (API unavailable)',
        weatherQuality: {
            comfortLevel: 'moderate'
        },
        error: error.message
    };

    // Create basic temporal data structure
    const result = {
        timestamp: now,
        dataSource: 'Fallback Data (API unavailable)',
        location: {
            latitude: location.lat,
            longitude: location.lon,
            timezone: 'UTC'
        },
        current: currentWeather,
        error: error.message,
        isFallback: true
    };

    // Add temporal data if requested
    if (options.pastHours > 0 || options.forecastHours > 0) {
        result.temporal = {
            pastPeriod: [],
            nextPeriod: [],
            current: currentWeather
        };

        // Generate past period data
        for (let i = options.pastHours; i > 0; i--) {
            const pastTime = now - (i * 60 * 60 * 1000);
            result.temporal.pastPeriod.push({
                ...currentWeather,
                timestamp: pastTime,
                temperature: baseTemp + Math.sin(i / 4) * 2, // Slight variation
                humidity: baseHumidity + Math.cos(i / 4) * 10
            });
        }

        // Generate forecast data
        for (let i = 1; i <= options.forecastHours; i++) {
            const futureTime = now + (i * 60 * 60 * 1000);
            result.temporal.nextPeriod.push({
                ...currentWeather,
                timestamp: futureTime,
                temperature: baseTemp + Math.sin(i / 4) * 2, // Slight variation
                humidity: baseHumidity + Math.cos(i / 4) * 10
            });
        }
    }

    return result;
}

/**
 * Transform raw Open-Meteo data into enhanced weather analysis
 * @param {Object} rawData - Raw API response
 * @param {Object} options - Request options
 * @returns {Object} Transformed weather data
 */
function transformOpenMeteoData(rawData, options) {
    const {
        pastHours = 2,
        forecastHours = 1,
        customDate = null,
        customTimeOffset = null
    } = options;

    // Validate input data
    if (!rawData || typeof rawData !== 'object') {
        console.error('Invalid rawData provided');
        return false;
    }

    // Validate required location data
    if (typeof rawData.latitude !== 'number' || typeof rawData.longitude !== 'number' ||
        rawData.latitude < -90 || rawData.latitude > 90 ||
        rawData.longitude < -180 || rawData.longitude > 180) {
        console.error('Invalid or missing location data in API response');
        return false;
    }

    // Determine timezone: prefer offline lookup, fallback to Open-Meteo API data
    let timezoneSource = 'tz-lookup';
    let finalTimezone = getTimezoneByCoordinates(rawData.latitude, rawData.longitude);

    // Validate tz-lookup result - if it's invalid, fall back to Open-Meteo data
    if (!finalTimezone || finalTimezone === 'UTC' || !finalTimezone.includes('/')) {
        finalTimezone = rawData.timezone || 'UTC';
        timezoneSource = 'open-meteo-fallback';
        console.log(`⚠️ tz-lookup returned invalid timezone, using Open-Meteo fallback`);
    }

    const result = {
        timestamp: Date.now(),
        dataSource: 'Open-Meteo API',
        location: {
            latitude: rawData.latitude,
            longitude: rawData.longitude,
            timezone: finalTimezone,
            timezoneAbbreviation: rawData.timezone_abbreviation || 'UTC',
            utcOffsetSeconds: rawData.utc_offset_seconds || 0
        }
    };

    // Log timezone information for debugging
    logger.verbose(`🌍 Weather timezone (${timezoneSource}): ${result.location.timezone}, coords: (${rawData.latitude.toFixed(4)}, ${rawData.longitude.toFixed(4)})`);

    // Process current weather if available
    if (rawData.current) {
        const currentTemp = Math.round(rawData.current.temperature_2m * 10) / 10;
        const currentRain = rawData.current.rain || 0;
        const currentShowers = rawData.current.showers || 0;
        const currentSnowfall = rawData.current.snowfall || 0;

        const precipitationAnalysis = analyzePrecipitationType(
            currentRain,
            currentShowers,
            currentSnowfall,
            currentTemp,
            rawData.current.weather_code
        );

        // Estimate UV index for solar radiation calculation
        const estimatedUVIndex = estimateUVIndex(new Date(), rawData.current.cloud_cover || 0, rawData.latitude);

        // Handle cloud cover - fall back to hourly data if current is missing
        let cloudCover = rawData.current.cloud_cover;
        if (cloudCover === undefined && rawData.hourly && rawData.hourly.cloud_cover && rawData.hourly.cloud_cover.length > 0) {
            // Use the most recent hourly cloud cover as fallback
            cloudCover = rawData.hourly.cloud_cover[0];
            console.log(`🌤️ Using hourly cloud cover (${cloudCover}%) as fallback for missing current cloud cover`);
        }

        const baseCondition = mapOpenMeteoCondition(rawData.current.weather_code);
        const reconciledCondition = reconcileConditionWithCloudCover(baseCondition, cloudCover);

        // Calculate enhanced weather metrics
        const currentHumidity = rawData.current.relative_humidity_2m;
        const currentWindSpeed = Math.round((rawData.current.wind_speed_10m / 3.6) * 10) / 10; // Convert km/h to m/s
        const comfortLevel = getComfortLevel(currentTemp, currentHumidity, currentWindSpeed);

        // Calculate heat index and wind chill
        const heatIndex = calculateHeatIndex(currentTemp, currentHumidity);
        const windChill = calculateWindChill(currentTemp, currentWindSpeed);

        // Get UV warnings and protection advice
        const uvWarnings = getUVWarnings(estimatedUVIndex);

        result.current = {
            temperature: currentTemp,
            humidity: currentHumidity,
            dewPoint: Math.round(rawData.current.dewpoint_2m * 10) / 10,
            feelsLike: Math.round(rawData.current.apparent_temperature * 10) / 10,
            condition: reconciledCondition,
            precipitation: rawData.current.precipitation || 0,
            precipitationRate: rawData.current.precipitation || 0,
            rain: currentRain,
            showers: currentShowers,
            snowfall: currentSnowfall,
            precipitationType: precipitationAnalysis,
            pressure: Math.round(rawData.current.pressure_msl),
            surfacePressure: Math.round(rawData.current.surface_pressure || rawData.current.pressure_msl),
            cloudCoverage: cloudCover,
            windSpeed: currentWindSpeed,
            windDirection: rawData.current.wind_direction_10m,
            windGust: rawData.current.wind_gusts_10m ? Math.round((rawData.current.wind_gusts_10m / 3.6) * 10) / 10 : null, // Convert km/h to m/s
            visibility: rawData.current.visibility || 10000,
            uvIndex: estimatedUVIndex,
            solarRadiation: estimatedUVIndex ? Math.round(estimatedUVIndex * 100) : 0,
            rawConditionId: rawData.current.weather_code,
            dataSource: result.dataSource,
            weatherQuality: {
                comfortLevel: comfortLevel,
                heatIndex: heatIndex,
                windChill: windChill,
                uvWarnings: uvWarnings
            }
        };
    }

    // Process hourly data
    if (rawData.hourly && rawData.hourly.time && Array.isArray(rawData.hourly.time)) {
        const hourlyData = [];
        const times = rawData.hourly.time;

        // Validate that we have the required arrays and they have the same length
        const requiredArrays = ['temperature_2m', 'relative_humidity_2m', 'dewpoint_2m', 'apparent_temperature'];
        const arrayLength = times.length;

        for (const arrayName of requiredArrays) {
            if (!rawData.hourly[arrayName] || !Array.isArray(rawData.hourly[arrayName]) ||
                rawData.hourly[arrayName].length !== arrayLength) {
                console.error(`Missing or invalid ${arrayName} array in hourly data`);
                return false;
            }
        }

        for (let i = 0; i < times.length; i++) {
            const timestamp = new Date(times[i]).getTime();
            const hourlyTemp = Math.round(rawData.hourly.temperature_2m[i] * 10) / 10;
            const hourlyRain = rawData.hourly.rain[i] || 0;
            const hourlyShowers = rawData.hourly.showers ? rawData.hourly.showers[i] || 0 : 0;
            const hourlySnowfall = rawData.hourly.snowfall[i] || 0;

            const precipitationAnalysis = analyzePrecipitationType(
                hourlyRain,
                hourlyShowers,
                hourlySnowfall,
                hourlyTemp,
                rawData.hourly.weather_code[i]
            );

            const hourlyBaseCondition = mapOpenMeteoCondition(rawData.hourly.weather_code[i]);
            const hourlyReconciledCondition = reconcileConditionWithCloudCover(hourlyBaseCondition, rawData.hourly.cloud_cover[i]);

            hourlyData.push({
                timestamp,
                temperature: hourlyTemp,
                humidity: rawData.hourly.relative_humidity_2m[i],
                dewPoint: Math.round(rawData.hourly.dewpoint_2m[i] * 10) / 10,
                feelsLike: Math.round(rawData.hourly.apparent_temperature[i] * 10) / 10,
                condition: hourlyReconciledCondition,
                precipitation: rawData.hourly.precipitation[i] || 0,
                precipitationRate: rawData.hourly.precipitation[i] || 0,
                rain: hourlyRain,
                showers: hourlyShowers,
                snowfall: hourlySnowfall,
                precipitationType: precipitationAnalysis,
                snowDepth: rawData.hourly.snow_depth ? rawData.hourly.snow_depth[i] || 0 : 0,
                pressure: Math.round(rawData.hourly.pressure_msl[i]),
                surfacePressure: Math.round(rawData.hourly.surface_pressure[i]),
                cloudCoverage: rawData.hourly.cloud_cover[i],
                cloudCoverLow: rawData.hourly.cloud_cover_low ? rawData.hourly.cloud_cover_low[i] : null,
                cloudCoverMid: rawData.hourly.cloud_cover_mid ? rawData.hourly.cloud_cover_mid[i] : null,
                cloudCoverHigh: rawData.hourly.cloud_cover_high ? rawData.hourly.cloud_cover_high[i] : null,
                visibility: rawData.hourly.visibility ? rawData.hourly.visibility[i] : 10000,
                evapotranspiration: rawData.hourly.evapotranspiration ? rawData.hourly.evapotranspiration[i] : null,
                et0: rawData.hourly.et0_fao_evapotranspiration ? rawData.hourly.et0_fao_evapotranspiration[i] : null,
                vapourPressureDeficit: rawData.hourly.vapour_pressure_deficit ? rawData.hourly.vapour_pressure_deficit[i] : null,
                windSpeed: Math.round((rawData.hourly.wind_speed_10m[i] / 3.6) * 10) / 10, // Convert km/h to m/s
                windDirection: rawData.hourly.wind_direction_10m[i],
                windGust: rawData.hourly.wind_gusts_10m ? Math.round((rawData.hourly.wind_gusts_10m[i] / 3.6) * 10) / 10 : null, // Convert km/h to m/s
                soilTemperature: rawData.hourly.soil_temperature_0cm ? Math.round(rawData.hourly.soil_temperature_0cm[i] * 10) / 10 : null,
                soilMoisture: rawData.hourly.soil_moisture_0_to_1cm ? rawData.hourly.soil_moisture_0_to_1cm[i] : null,
                rawConditionId: rawData.hourly.weather_code[i],
                uvIndex: estimateUVIndex(new Date(timestamp), rawData.hourly.cloud_cover[i], rawData.latitude),
                solarRadiation: (() => {
                    const uv = estimateUVIndex(new Date(timestamp), rawData.hourly.cloud_cover[i], rawData.latitude);
                    return uv ? Math.round(uv * 100) : 0;
                })(),
                weatherQuality: {
                    comfortLevel: getComfortLevel(hourlyTemp, rawData.hourly.relative_humidity_2m[i], Math.round((rawData.hourly.wind_speed_10m[i] / 3.6) * 10) / 10)
                }
            });
        }

        result.hourly = hourlyData;

        // Process minutely data for more granular next-hour forecasting (only if available and appropriate)
        // Skip minutely data for long future forecasts (customTimeOffset > 2 hours)
        const shouldProcessMinutely = rawData.minutely_15 && rawData.minutely_15.time && Array.isArray(rawData.minutely_15.time) &&
                                     !(customTimeOffset !== null && customTimeOffset > 2);

        if (shouldProcessMinutely) {
            try {
                const minutelyData = [];
                const minutelyTimes = rawData.minutely_15.time;

                // Validate that we have at least the basic required data
                if (minutelyTimes.length > 0) {
                    for (let i = 0; i < minutelyTimes.length; i++) {
                        const timestamp = new Date(minutelyTimes[i]).getTime();
                        const minutelyTemp = rawData.minutely_15.temperature_2m ? Math.round(rawData.minutely_15.temperature_2m[i] * 10) / 10 : null;
                        const minutelyHumidity = rawData.minutely_15.relative_humidity_2m ? rawData.minutely_15.relative_humidity_2m[i] : null;

                        minutelyData.push({
                            timestamp,
                            temperature: minutelyTemp,
                            humidity: minutelyHumidity,
                            feelsLike: rawData.minutely_15.apparent_temperature ? Math.round(rawData.minutely_15.apparent_temperature[i] * 10) / 10 : null,
                            precipitation: rawData.minutely_15.precipitation ? rawData.minutely_15.precipitation[i] : 0,
                            precipitationRate: rawData.minutely_15.precipitation ? rawData.minutely_15.precipitation[i] : 0,
                            condition: rawData.minutely_15.weather_code ? mapOpenMeteoCondition(rawData.minutely_15.weather_code[i]) : null,
                            windSpeed: rawData.minutely_15.wind_speed_10m ? Math.round((rawData.minutely_15.wind_speed_10m[i] / 3.6) * 10) / 10 : null, // Convert km/h to m/s
                            windDirection: rawData.minutely_15.wind_direction_10m ? rawData.minutely_15.wind_direction_10m[i] : null,
                            rawConditionId: rawData.minutely_15.weather_code ? rawData.minutely_15.weather_code[i] : null
                        });
                    }

                    // Only include minutely data if we successfully processed some points
                    if (minutelyData.length > 0) {
                        result.minutely = minutelyData;
                    }
                }
            } catch (error) {
                console.warn('Failed to process minutely data:', error.message);
                // Continue without minutely data - it's optional
            }
        }

        // Extract specific time periods
        const now = Date.now();

        // Past hours - use actual API data points (no interpolation)
        const pastData = hourlyData
            .filter(h => h.timestamp <= now)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, Math.min(pastHours + 1, hourlyData.length)); // Include past hours + current hour for context

        // Future hours - handle customTimeOffset scenarios differently
        let futureData = [];
        const targetTime = customTimeOffset !== null ? now + (customTimeOffset * 60 * 60 * 1000) : now;

        // For customTimeOffset scenarios, skip minutely data and use hourly data directly
        if (customTimeOffset !== null) {
            futureData = hourlyData
                .filter(h => h.timestamp >= targetTime)
                .sort((a, b) => a.timestamp - b.timestamp)
                .slice(0, Math.min(forecastHours, hourlyData.length));
        } else {
            // Standard scenario - try minutely data first, then hourly
        // First try to get minutely data for the immediate next hour (more granular)
        if (result.minutely && result.minutely.length > 0) {
            const minutelyFuture = result.minutely
                .filter(m => m.timestamp > now)
                .sort((a, b) => a.timestamp - b.timestamp);

            // Only use minutely data if we have at least 2 points (30+ minutes of data)
            if (minutelyFuture.length >= 2) {
                futureData = minutelyFuture.slice(0, Math.min(4, minutelyFuture.length)); // Up to 1 hour at 15-min intervals
            }
        }

        // Fall back to hourly data if minutely data is insufficient or unavailable
        if (futureData.length === 0) {
            futureData = hourlyData
            .filter(h => h.timestamp > now)
            .sort((a, b) => a.timestamp - b.timestamp)
                .slice(0, forecastHours);
            }
        }

        if (pastData.length > 0) {
            result.pastPeriod = pastData.reverse(); // Chronological order
        }

        if (futureData.length > 0) {
            result.nextPeriod = futureData;
        }
    }

    // Add temporal analysis
    result.analysis = analyzeWeatherPatterns(result);

    return result;
}

/**
 * Analyze weather patterns across time periods for enhanced descriptions
 * @param {Object} weatherData - Transformed weather data
 * @returns {Object} Pattern analysis
 */
function analyzeWeatherPatterns(weatherData) {
    const analysis = {
        trend: 'stable',
        precipitation: {
            recent: false,
            upcoming: false,
            intensity: 'none'
        },
        temperature: {
            trend: 'stable',
            volatility: 'low'
        },
        wind: {
            increasing: false,
            direction: null
        },
        environmental: {
            description: '',
            characterImpact: '',
            environmentalChanges: []
        }
    };

    if (!weatherData.pastPeriod || !weatherData.nextPeriod) {
        return analysis;
    }

    const past = weatherData.pastPeriod;
    const future = weatherData.nextPeriod;

    // Analyze precipitation patterns
    const pastPrecipitation = past.reduce((sum, h) => sum + h.precipitation, 0);
    const futurePrecipitation = future.reduce((sum, h) => sum + h.precipitation, 0);

    analysis.precipitation.recent = pastPrecipitation > 0.1;
    analysis.precipitation.upcoming = futurePrecipitation > 0.1;

    if (futurePrecipitation > 5) {
        analysis.precipitation.intensity = 'heavy';
    } else if (futurePrecipitation > 1) {
        analysis.precipitation.intensity = 'moderate';
    } else if (futurePrecipitation > 0.1) {
        analysis.precipitation.intensity = 'light';
    }

    // Analyze precipitation types - handle both hourly and minutely data structures
    const getPrecipitationType = (dataPoint) => {
        // For hourly data with precipitationType structure
        if (dataPoint.precipitationType && dataPoint.precipitationType.type) {
            return dataPoint.precipitationType.type;
        }
        // For minutely data or direct precipitation
        if (dataPoint.precipitation > 0) {
            // Determine type based on other fields if available
            if (dataPoint.weather_code) {
                const code = dataPoint.weather_code;
                if (code >= 51 && code <= 67) return 'rain'; // Drizzle/light rain codes
                if (code >= 71 && code <= 77) return 'snow'; // Snow codes
                if (code >= 80 && code <= 82) return 'rain'; // Rain shower codes
                if (code >= 85 && code <= 86) return 'snow'; // Snow shower codes
            }
            // Fallback to rain if we have precipitation but no specific type
            return 'rain';
        }
        return 'none';
    };

    const pastPrecipTypes = past
        .filter(h => getPrecipitationType(h) !== 'none')
        .map(h => getPrecipitationType(h));

    const futurePrecipTypes = future
        .filter(h => getPrecipitationType(h) !== 'none')
        .map(h => getPrecipitationType(h));

    // Determine dominant precipitation types
    analysis.precipitation.recentTypes = [...new Set(pastPrecipTypes)];
    analysis.precipitation.upcomingTypes = [...new Set(futurePrecipTypes)];

    // Get most common precipitation type in future
    if (futurePrecipTypes.length > 0) {
        const typeCounts = futurePrecipTypes.reduce((acc, type) => {
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});
        analysis.precipitation.dominantType = Object.entries(typeCounts)
            .sort(([,a], [,b]) => b - a)[0][0];
    }

    // Analyze temperature trends
    const pastTemps = past.map(h => h.temperature);
    const futureTemps = future.map(h => h.temperature);
    const pastAvg = pastTemps.reduce((a, b) => a + b, 0) / pastTemps.length;
    const futureAvg = futureTemps.reduce((a, b) => a + b, 0) / futureTemps.length;

    const tempDiff = futureAvg - pastAvg;
    if (tempDiff > 2) {
        analysis.temperature.trend = 'warming';
    } else if (tempDiff < -2) {
        analysis.temperature.trend = 'cooling';
    }

    // Calculate temperature volatility
    const allTemps = [...pastTemps, ...futureTemps];
    const tempVariance = allTemps.reduce((sum, temp) => sum + Math.pow(temp - (pastAvg + futureAvg) / 2, 2), 0) / allTemps.length;
    if (tempVariance > 4) {
        analysis.temperature.volatility = 'high';
    } else if (tempVariance > 1) {
        analysis.temperature.volatility = 'moderate';
    }

    // Analyze wind patterns
    const pastWind = past.map(h => h.windSpeed);
    const futureWind = future.map(h => h.windSpeed);
    const pastWindAvg = pastWind.reduce((a, b) => a + b, 0) / pastWind.length;
    const futureWindAvg = futureWind.reduce((a, b) => a + b, 0) / futureWind.length;

    analysis.wind.increasing = futureWindAvg > pastWindAvg + 2;

    // Determine predominant wind direction
    const windDirections = future.map(h => h.windDirection).filter(d => d !== null);
    if (windDirections.length > 0) {
        analysis.wind.direction = windDirections[Math.floor(windDirections.length / 2)]; // Median direction
    }

    // Generate environmental descriptions
    analysis.environmental = generateEnvironmentalDescription(analysis, weatherData);

    return analysis;
}

/**
 * Generate detailed environmental descriptions based on weather patterns
 * @param {Object} analysis - Weather pattern analysis
 * @param {Object} weatherData - Full weather data
 * @returns {Object} Environmental descriptions
 */
function generateEnvironmentalDescription(analysis, weatherData) {
    const descriptions = {
        description: '',
        characterImpact: '',
        environmentalChanges: []
    };

    // Base description from current conditions
    if (weatherData.current) {
        const current = weatherData.current;
        descriptions.description = `${current.condition} with temperatures around ${current.temperature}°C`;

        if (current.windSpeed > 12) {
            descriptions.description += ` and ${getWindConditionDescription(current.windSpeed)}`;
        }
    }

    // Add temporal context with precipitation type details
    if (analysis.precipitation.recent && !analysis.precipitation.upcoming) {
        const recentTypesText = analysis.precipitation.recentTypes.length > 0
            ? ` (${analysis.precipitation.recentTypes.join(', ')})`
            : '';
        descriptions.environmentalChanges.push(`environment recovering from recent precipitation${recentTypesText}`);

        // Specific recovery descriptions based on precipitation type
        if (analysis.precipitation.recentTypes.includes('snow')) {
            descriptions.description += '. Fresh snow covers the ground, creating a crisp, clean atmosphere';
            descriptions.characterImpact += 'Characters may notice fresh snow underfoot, crisp air, and wintery stillness';
        } else if (analysis.precipitation.recentTypes.includes('thunderstorm')) {
            descriptions.description += '. The air feels charged after recent thunderstorms';
            descriptions.characterImpact += 'Characters may notice lingering ozone scent and occasional distant thunder';
        } else {
            descriptions.description += '. The air feels fresher and more humid after recent rain';
            descriptions.characterImpact += 'Characters may notice damp surfaces, puddles, and that refreshing post-rain scent';
        }
    }

    if (!analysis.precipitation.recent && analysis.precipitation.upcoming) {
        const dominantType = analysis.precipitation.dominantType || 'precipitation';

        if (analysis.precipitation.intensity === 'heavy') {
            if (dominantType === 'snow') {
                descriptions.environmentalChanges.push('heavy snow expected soon');
                descriptions.description += '. Heavy snow is approaching with darkening skies';
                descriptions.characterImpact += 'Characters might feel the dropping temperatures and see swirling snowflakes';
            } else if (dominantType === 'thunderstorm') {
                descriptions.environmentalChanges.push('thunderstorm approaching');
                descriptions.description += '. Dark clouds are gathering with approaching thunderstorms';
                descriptions.characterImpact += 'Characters might feel the building tension in the air, with distant rumbles and cooling temperatures';
            } else {
                descriptions.environmentalChanges.push('heavy rain expected soon');
                descriptions.description += '. Dark clouds are gathering, indicating approaching heavy rain';
                descriptions.characterImpact += 'Characters might feel the building tension in the air, with distant rumbles and cooling temperatures';
            }
        } else {
            const typeDescription = dominantType === 'snow' ? 'snow' :
                                  dominantType === 'thunderstorm' ? 'thunderstorms' :
                                  dominantType === 'freezing_rain' ? 'freezing rain' :
                                  dominantType === 'sleet' ? 'sleet' : 'precipitation';
            descriptions.environmentalChanges.push(`light ${typeDescription} expected soon`);
            descriptions.description += `. Light ${typeDescription} is approaching`;
            descriptions.characterImpact += 'Characters may notice a slight cooling and the earthy scent that precedes precipitation';
        }
    }

    if (analysis.precipitation.recent && analysis.precipitation.upcoming) {
        const currentTypesText = analysis.precipitation.recentTypes.join(', ');
        const upcomingTypesText = analysis.precipitation.upcomingTypes.join(', ');
        descriptions.environmentalChanges.push(`continuous ${currentTypesText} transitioning to ${upcomingTypesText}`);
        descriptions.description += '. Precipitation continues with changing patterns';
        descriptions.characterImpact += 'Characters are accustomed to the wet conditions, with appropriate clothing and behavior';
    }

    // Temperature trends
    if (analysis.temperature.trend === 'warming') {
        descriptions.environmentalChanges.push('temperatures gradually increasing');
        descriptions.description += '. Temperatures are trending upward';
        descriptions.characterImpact += 'Characters may feel increasingly warm and seek shade or ventilation';
    } else if (analysis.temperature.trend === 'cooling') {
        descriptions.environmentalChanges.push('temperatures gradually decreasing');
        descriptions.description += '. A cooling trend is developing';
        descriptions.characterImpact += 'Characters might notice the cooling air and adjust clothing accordingly';
    }

    // Wind changes
    if (analysis.wind.increasing) {
        descriptions.environmentalChanges.push('winds strengthening');
        descriptions.description += '. Wind speeds are increasing';
        descriptions.characterImpact += 'Characters may need to adjust posture, secure loose items, and protect against wind-blown debris';
    }

    // Combine descriptions
    if (descriptions.environmentalChanges.length === 0) {
        descriptions.environmentalChanges.push('stable weather conditions');
        descriptions.description += '. Weather conditions remain stable';
        descriptions.characterImpact += 'Characters can expect consistent environmental conditions';
    }

    return descriptions;
}


/**
 * Retrieve weekly weather forecast (this week + next week)
 * @param {Object} location - Location object with lat/lon
 * @returns {Promise<Object>} Weekly forecast data
 */
async function getWeeklyWeatherForecast(location) {
    const cacheKey = `weekly_${location.lat}_${location.lon}`;

    return getCachedWeatherData(cacheKey, async () => {
        // Get 14 days of forecast
        const params = new URLSearchParams({
            latitude: location.lat,
            longitude: location.lon,
            forecast_days: 14,
            timezone: 'auto',
            daily: [
                'temperature_2m_max',
                'temperature_2m_min',
                'temperature_2m_mean',
                'apparent_temperature_max',
                'apparent_temperature_min',
                'apparent_temperature_mean',
                'precipitation_sum',
                'rain_sum',
                'showers_sum',
                'snowfall_sum',
                'precipitation_hours',
                'precipitation_probability_max',
                'precipitation_probability_mean',
                'precipitation_probability_min',
                'weather_code',
                'sunrise',
                'sunset',
                'sunshine_duration',
                'daylight_duration',
                'wind_speed_10m_max',
                'wind_gusts_10m_max',
                'wind_direction_10m_dominant',
                'shortwave_radiation_sum',
                'et0_fao_evapotranspiration',
                'uv_index_max',
                'uv_index_clear_sky_max',
                'relative_humidity_2m_mean',
                'cloud_cover_mean'
            ].join(','),
            hourly: [
                'temperature_2m',
                'relative_humidity_2m',
                'dewpoint_2m',
                'pressure_msl',
                'surface_pressure',
                'visibility'
            ].join(',')
        });

        const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

        try {
            const data = await makeHttpsRequest(url);

            const result = {
                timestamp: Date.now(),
                dataSource: 'Open-Meteo Weekly Forecast',
                location: {
                    latitude: data.latitude,
                    longitude: data.longitude,
                    timezone: data.timezone
                },
                weekly: []
            };

            // Aggregate hourly data by day for missing daily fields
            const hourlyAggregates = {};
            if (data.hourly && data.hourly.time) {
                data.hourly.time.forEach((timestamp, index) => {
                    const date = timestamp.split('T')[0];
                    if (!hourlyAggregates[date]) {
                        hourlyAggregates[date] = {
                            dewPoints: [],
                            pressures: [],
                            visibilities: []
                        };
                    }
                    if (data.hourly.dewpoint_2m && data.hourly.dewpoint_2m[index] !== null) {
                        hourlyAggregates[date].dewPoints.push(data.hourly.dewpoint_2m[index]);
                    }
                    if (data.hourly.pressure_msl && data.hourly.pressure_msl[index] !== null) {
                        hourlyAggregates[date].pressures.push(data.hourly.pressure_msl[index]);
                    }
                    if (data.hourly.visibility && data.hourly.visibility[index] !== null) {
                        hourlyAggregates[date].visibilities.push(data.hourly.visibility[index]);
                    }
                });

                // Calculate daily averages
                Object.keys(hourlyAggregates).forEach(date => {
                    const dayData = hourlyAggregates[date];
                    hourlyAggregates[date] = {
                        dewPoint: dayData.dewPoints.length > 0 ? dayData.dewPoints.reduce((a, b) => a + b, 0) / dayData.dewPoints.length : null,
                        pressure: dayData.pressures.length > 0 ? dayData.pressures.reduce((a, b) => a + b, 0) / dayData.pressures.length : null,
                        visibility: dayData.visibilities.length > 0 ?
                            dayData.visibilities.filter(v => v > 0).length > 0 ?
                                dayData.visibilities.filter(v => v > 0).reduce((a, b) => a + b, 0) / dayData.visibilities.filter(v => v > 0).length
                                : null
                            : null
                    };
                });
            }

            if (data.daily && data.daily.time) {
                result.weekly = data.daily.time.map((date, index) => ({
                    date,
                    temperature: {
                        min: Math.round(data.daily.temperature_2m_min[index] * 10) / 10,
                        max: Math.round(data.daily.temperature_2m_max[index] * 10) / 10,
                        avg: data.daily.temperature_2m_mean ? Math.round(data.daily.temperature_2m_mean[index] * 10) / 10 : (data.daily.temperature_2m_min[index] + data.daily.temperature_2m_max[index]) / 2
                    },
                    feelsLike: {
                        min: Math.round(data.daily.apparent_temperature_min[index] * 10) / 10,
                        max: Math.round(data.daily.apparent_temperature_max[index] * 10) / 10,
                        avg: data.daily.apparent_temperature_mean ? Math.round(data.daily.apparent_temperature_mean[index] * 10) / 10 : null
                    },
                    precipitation: {
                        total: Math.round(data.daily.precipitation_sum[index] * 100) / 100,
                        rain: Math.round(data.daily.rain_sum[index] * 100) / 100,
                        showers: Math.round(data.daily.showers_sum[index] * 100) / 100,
                        snowfall: Math.round(data.daily.snowfall_sum[index] * 100) / 100,
                        hours: data.daily.precipitation_hours[index],
                        probability: data.daily.precipitation_probability_max[index],
                        probabilityMean: data.daily.precipitation_probability_mean ? data.daily.precipitation_probability_mean[index] : null,
                        probabilityMin: data.daily.precipitation_probability_min ? data.daily.precipitation_probability_min[index] : null
                    },
                    humidity: Math.round(data.daily.relative_humidity_2m_mean[index]),
                    cloudCoverage: Math.round(data.daily.cloud_cover_mean[index]),
                    condition: mapOpenMeteoCondition(data.daily.weather_code[index]),
                    wind: {
                        maxSpeed: Math.round((data.daily.wind_speed_10m_max[index] / 3.6) * 10) / 10, // Convert km/h to m/s
                        maxGust: Math.round((data.daily.wind_gusts_10m_max[index] / 3.6) * 10) / 10, // Convert km/h to m/s
                        dominantDirection: data.daily.wind_direction_10m_dominant[index]
                    },
                    sunrise: data.daily.sunrise[index],
                    sunset: data.daily.sunset[index],
                    sunshineDuration: data.daily.sunshine_duration ? Math.round(data.daily.sunshine_duration[index]) : null,
                    daylightDuration: data.daily.daylight_duration ? Math.round(data.daily.daylight_duration[index]) : null,
                    solarRadiation: data.daily.shortwave_radiation_sum ? Math.round(data.daily.shortwave_radiation_sum[index] * 10) / 10 : null,
                    evapotranspiration: data.daily.et0_fao_evapotranspiration ? Math.round(data.daily.et0_fao_evapotranspiration[index] * 100) / 100 : null,
                    uvIndex: data.daily.uv_index_max ? Math.round(data.daily.uv_index_max[index] * 10) / 10 : null,
                    uvIndexClearSky: data.daily.uv_index_clear_sky_max ? Math.round(data.daily.uv_index_clear_sky_max[index] * 10) / 10 : null,
                    // Add aggregated hourly data
                    dewPoint: hourlyAggregates[date]?.dewPoint ? Math.round(hourlyAggregates[date].dewPoint * 10) / 10 : null,
                    pressure: hourlyAggregates[date]?.pressure ? Math.round(hourlyAggregates[date].pressure * 10) / 10 : null,
                    visibility: hourlyAggregates[date]?.visibility ? Math.round(hourlyAggregates[date].visibility) : null,
                    rawConditionId: data.daily.weather_code[index]
                }));
            }

            return result;

        } catch (error) {
            console.error('Weekly forecast API error:', error);
            return null;
        }
    }, ENHANCED_WEATHER_CACHE_DURATION);
}

/**
 * Master function for comprehensive weather analysis
 * Retrieves and analyzes weather data for AI model enhancement
 * @param {Object} location - Location object with lat/lon
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Complete weather analysis
 */
async function getComprehensiveWeatherAnalysis(location, options = {}) {
    const {
        includeHistorical = false,
        customDate = null,
        customTimeOffset = null,
        timezone = null,
        includeWeekly = true,
        forecastHours = 1,
        pastHours = 2
    } = options;

    logger.detailed('🌤️ Retrieving weather analysis...');

    const results = {
        timestamp: Date.now(),
        location,
        current: null,
        temporal: null,
        weekly: null,
        historical: null,
        analysis: {
            environmental: {},
            patterns: {},
            recommendations: {}
        }
    };

    try {
        // 1. Get current weather with temporal context
        if (!customDate && customTimeOffset === null) {
            logger.verbose(`📊 Getting current weather with ${pastHours}hr past + ${forecastHours}hr future...`);
            results.temporal = await getEnhancedWeatherData(location, {
                pastHours: pastHours,
                forecastHours: forecastHours,
                includeCurrent: true,
                timezone
            });
            results.current = results.temporal.current;
        } else if (customDate) {
            console.log(`📅 Getting weather for custom date: ${customDate}`);
            results.temporal = await getEnhancedWeatherData(location, {
                customDate,
                timezone
            });
        } else if (customTimeOffset !== null) {
            console.log(`⏰ Getting weather for time offset: ${customTimeOffset} hours`);
            results.temporal = await getEnhancedWeatherData(location, {
                customTimeOffset,
                timezone
            });
        }

        // 2. Get weekly forecast if requested
        if (includeWeekly && !customDate && customTimeOffset === null) {
            console.log('📅 Getting weekly forecast...');
            results.weekly = await getWeeklyWeatherForecast(location);
        }

        // 3. Get historical data if requested
        if (includeHistorical && !customDate && customTimeOffset === null) {
            console.log('📚 Getting past year historical data...');
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            results.historical = await getWeatherFromBestProvider(location, {
                startDate,
                endDate
            });
        }

        // 4. Generate comprehensive analysis
        logger.verbose('🔍 Generating comprehensive weather analysis...');
        results.analysis = generateComprehensiveAnalysis(results);

        logger.verbose('✅ Weather analysis complete');
        return results;

    } catch (error) {
        console.error('❌ Error in comprehensive weather analysis:', error);
        // Return null instead of simulated data
        return null;
    }
}

/**
 * Generate comprehensive weather analysis from all data sources
 * @param {Object} weatherData - All weather data sources
 * @returns {Object} Comprehensive analysis
 */
function generateComprehensiveAnalysis(weatherData) {
    // Handle null/undefined weather data gracefully
    if (!weatherData) {
        return false;
    }

    const analysis = {
        environmental: {
            currentDescription: '',
            temporalChanges: [],
            characterImplications: [],
            settingEnhancements: []
        },
        patterns: {
            seasonal: {},
            trends: {},
            anomalies: []
        },
        recommendations: {
            aiPrompting: [],
            environmentalDetails: [],
            narrativeSuggestions: []
        }
    };

    // Current environmental description
    if (weatherData?.temporal?.analysis?.environmental) {
        analysis.environmental.currentDescription = weatherData.temporal.analysis.environmental.description;
        analysis.environmental.temporalChanges = weatherData.temporal.analysis.environmental.environmentalChanges;
        analysis.environmental.characterImplications = [
            weatherData.temporal.analysis.environmental.characterImpact
        ].filter(Boolean);
    }

    // Weekly patterns
    if (weatherData?.weekly?.weekly) {
        const weeklyData = weatherData.weekly.weekly;

        // Temperature trends
        const tempTrend = analyzeWeeklyTemperatureTrend(weeklyData);
        analysis.patterns.trends.temperature = tempTrend;

        // Precipitation patterns
        const precipPattern = analyzeWeeklyPrecipitationPattern(weeklyData);
        analysis.patterns.trends.precipitation = precipPattern;

        // Wind patterns
        const windPattern = analyzeWeeklyWindPattern(weeklyData);
        analysis.patterns.trends.wind = windPattern;

        // Add to environmental changes
        if (tempTrend.significant) {
            analysis.environmental.temporalChanges.push(`Temperature trending ${tempTrend.direction} over the coming week`);
        }

        if (precipPattern.expected) {
            analysis.environmental.temporalChanges.push(`Precipitation expected: ${precipPattern.description}`);
        }

        if (windPattern.significant) {
            analysis.environmental.temporalChanges.push(`Wind conditions: ${windPattern.description}`);
        }
    }

    // Historical context
    if (weatherData.historical && weatherData.historical.statistics) {
        const hist = weatherData.historical.statistics;

        analysis.patterns.seasonal = {
            temperature: {
                normalRange: `${hist.temperature.averageMin.toFixed(1)}°C to ${hist.temperature.averageMax.toFixed(1)}°C`,
                extremes: `${hist.temperature.absoluteMin.toFixed(1)}°C to ${hist.temperature.absoluteMax.toFixed(1)}°C`
            },
            precipitation: {
                averageDaily: hist.precipitation.averageDaily.toFixed(1),
                rainyDays: hist.precipitation.rainyDays
            },
            commonConditions: Object.entries(hist.conditionFrequency || {})
                .sort(([,a], [,b]) => b.percentage - a.percentage)
                .slice(0, 3)
                .map(([condition, data]) => `${condition} (${data.percentage}%)`)
        };

        // Anomalies compared to historical
        if (weatherData.current) {
            const currentTemp = weatherData.current.temperature;
            const avgTemp = hist.temperature.average;

            if (Math.abs(currentTemp - avgTemp) > 5) {
                const direction = currentTemp > avgTemp ? 'warmer' : 'cooler';
                analysis.patterns.anomalies.push(`Current temperature is unusually ${direction} than seasonal average`);
            }
        }
    }

    // Generate AI prompting recommendations
    analysis.recommendations.aiPrompting = generateAIPromptingRecommendations(analysis, weatherData);

    // Environmental details for scene setting
    analysis.recommendations.environmentalDetails = generateEnvironmentalDetailRecommendations(analysis, weatherData);

    // Narrative suggestions
    analysis.recommendations.narrativeSuggestions = generateNarrativeSuggestions(analysis, weatherData);

    return analysis;
}

/**
 * Analyze weekly temperature trends
 * @param {Array} weeklyData - Weekly forecast data
 * @returns {Object} Temperature trend analysis
 */
function analyzeWeeklyTemperatureTrend(weeklyData) {
    if (!weeklyData || weeklyData.length < 3) {
        return { significant: false, direction: 'stable' };
    }

    const temps = weeklyData.map(d => (d.temperature.min + d.temperature.max) / 2);
    const firstHalf = temps.slice(0, Math.floor(temps.length / 2));
    const secondHalf = temps.slice(Math.floor(temps.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;

    return {
        significant: Math.abs(diff) > 3,
        direction: diff > 3 ? 'warming' : diff < -3 ? 'cooling' : 'stable',
        change: Math.round(diff * 10) / 10
    };
}

/**
 * Analyze weekly precipitation patterns
 * @param {Array} weeklyData - Weekly forecast data
 * @returns {Object} Precipitation pattern analysis
 */
function analyzeWeeklyPrecipitationPattern(weeklyData) {
    const rainyDays = weeklyData.filter(d => d.precipitation.total > 0.1);
    const totalPrecip = weeklyData.reduce((sum, d) => sum + d.precipitation.total, 0);

    let description = '';
    let expected = false;
    let dominantType = 'none';
    let precipTypes = [];

    if (rainyDays.length > 0) {
        expected = true;

        // Analyze precipitation types across the week
        precipTypes = [];
        weeklyData.forEach(day => {
            if (day.precipitation.total > 0.1) {
                // Determine dominant type for the day based on amounts
                if (day.precipitation.snowfall > day.precipitation.rain + day.precipitation.showers) {
                    precipTypes.push('snow');
                } else if (day.precipitation.rain > day.precipitation.showers) {
                    precipTypes.push('rain');
                } else if (day.precipitation.showers > 0) {
                    precipTypes.push('showers');
                } else {
                    precipTypes.push('precipitation');
                }
            }
        });

        // Find most common type
        const typeCounts = precipTypes.reduce((acc, type) => {
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});
        dominantType = Object.entries(typeCounts).sort(([,a], [,b]) => b - a)[0]?.[0] || 'precipitation';

        // Create description based on intensity and type
        let intensityDesc = '';
        if (totalPrecip > 50) {
            intensityDesc = 'heavy';
        } else if (totalPrecip > 20) {
            intensityDesc = 'moderate';
        } else {
            intensityDesc = 'light';
        }

        const typeDesc = dominantType === 'snow' ? 'snow' :
                        dominantType === 'rain' ? 'rain' :
                        dominantType === 'showers' ? 'showers' : 'precipitation';

        description = `${intensityDesc} ${typeDesc} expected over ${rainyDays.length} days`;
    } else {
        description = 'dry conditions expected';
    }

    return {
        expected,
        description,
        totalPrecipitation: Math.round(totalPrecip * 10) / 10,
        rainyDays: rainyDays.length,
        dominantType,
        precipitationTypes: [...new Set(precipTypes)]
    };
}

/**
 * Analyze weekly wind patterns
 * @param {Array} weeklyData - Weekly forecast data
 * @returns {Object} Wind pattern analysis
 */
function analyzeWeeklyWindPattern(weeklyData) {
    const windSpeeds = weeklyData.map(d => d.wind.maxSpeed);
    const avgWind = windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length;
    const maxWind = Math.max(...windSpeeds);

    let significant = false;
    let description = '';

    if (maxWind > 20) {
        significant = true;
        description = 'strong winds expected, potential for gusty conditions';
    } else if (avgWind > 10) {
        significant = true;
        description = 'moderate to breezy conditions expected';
    } else {
        description = 'calm to light wind conditions';
    }

    return {
        significant,
        description,
        averageSpeed: Math.round(avgWind * 10) / 10,
        maxSpeed: Math.round(maxWind * 10) / 10
    };
}

/**
 * Generate AI prompting recommendations
 * @param {Object} analysis - Weather analysis
 * @param {Object} weatherData - Raw weather data
 * @returns {Array} AI prompting recommendations
 */
function generateAIPromptingRecommendations(analysis, weatherData) {
    const recommendations = [];

    // Current weather context
    if (analysis.environmental.currentDescription) {
        recommendations.push(`Environmental context: ${analysis.environmental.currentDescription}`);
    }

    // Temporal changes
    if (analysis.environmental.temporalChanges.length > 0) {
        recommendations.push(`Temporal weather dynamics: ${analysis.environmental.temporalChanges.join(', ')}`);
    }

    // Character implications
    if (analysis.environmental.characterImplications.length > 0) {
        recommendations.push(`Character environmental interactions: ${analysis.environmental.characterImplications.join(' ')}`);
    }

    // Historical context
    if (analysis.patterns.seasonal.temperature) {
        recommendations.push(`Seasonal temperature norms: ${analysis.patterns.seasonal.temperature.normalRange} (extremes: ${analysis.patterns.seasonal.temperature.extremes})`);
    }

    // Anomalies
    if (analysis.patterns.anomalies.length > 0) {
        recommendations.push(`Weather anomalies: ${analysis.patterns.anomalies.join(', ')}`);
    }

    return recommendations;
}

/**
 * Generate environmental detail recommendations
 * @param {Object} analysis - Weather analysis
 * @param {Object} weatherData - Raw weather data
 * @returns {Array} Environmental detail recommendations
 */
function generateEnvironmentalDetailRecommendations(analysis, weatherData) {
    const recommendations = [];

    if (weatherData.current) {
        const current = weatherData.current;

        if (current.windSpeed > 20) {
            recommendations.push('Include wind effects: moving leaves, loose clothing, hair movement, potential for debris');
        }

        if (current.humidity > 80 && current.temperature > 25) {
            recommendations.push('High humidity effects: muggy atmosphere, potential fog, damp surfaces, condensation');
        }

        if (current.cloudCover > 70) {
            recommendations.push('Overcast conditions: diffused lighting, muted colors, potential for rain, lower visibility');
        }

        if (current.precipitation > 0 && current.precipitationType) {
            const precipType = current.precipitationType.type;
            if (precipType === 'snow') {
                recommendations.push('Active snowfall: accumulating snow, crunching underfoot, wintery silence, slippery surfaces');
            } else if (precipType === 'thunderstorm') {
                recommendations.push('Thunderstorm activity: lightning flashes, thunder claps, heavy rain, potential wind gusts');
            } else if (precipType === 'freezing_rain' || precipType === 'sleet') {
                recommendations.push('Icy precipitation: slippery surfaces, freezing rain/sleet, dangerous walking conditions');
            } else {
                recommendations.push('Active precipitation: wet surfaces, reflective puddles, sound of rain, protective behaviors');
            }
        }
    }

    return recommendations;
}

/**
 * Generate narrative suggestions based on weather
 * @param {Object} analysis - Weather analysis
 * @param {Object} weatherData - Raw weather data
 * @returns {Array} Narrative suggestions
 */
function generateNarrativeSuggestions(analysis, weatherData) {
    const suggestions = [];

    // Weather-driven plot elements with precipitation type specificity
    if (analysis.environmental.temporalChanges.some(change => change.includes('precipitation') || change.includes('rain') || change.includes('snow'))) {
        const dominantPrecipType = analysis.precipitation?.dominantType;
        if (dominantPrecipType === 'snow') {
            suggestions.push('Snowfall could create winter wonderland atmosphere, isolation themes, or transformation motifs');
            suggestions.push('Consider snow accumulation effects, winter survival challenges, or seasonal symbolism');
        } else if (dominantPrecipType === 'thunderstorm') {
            suggestions.push('Thunderstorms could create dramatic tension, power themes, or cathartic release scenes');
            suggestions.push('Consider lightning as visual metaphor, thunder as emotional punctuation, or storm intensity mirroring character conflict');
        } else if (dominantPrecipType === 'freezing_rain' || dominantPrecipType === 'sleet') {
            suggestions.push('Icy conditions could create danger themes, cautionary tales, or environmental hazard narratives');
            suggestions.push('Consider slippery surfaces as physical metaphors, freezing temperatures as emotional coldness');
        } else {
            suggestions.push('Precipitation could create tension, urgency, or emotional release scenes');
            suggestions.push('Consider shelter-seeking behavior, clothing management, or environmental hazards');
        }
    }

    if (analysis.patterns.trends.wind && analysis.patterns.trends.wind.significant) {
        suggestions.push('Wind conditions could affect movement, communication, or create dramatic atmospheric tension');
    }

    if (analysis.patterns.anomalies.length > 0) {
        suggestions.push('Weather anomalies could drive plot points or symbolize character emotional states');
    }

    // Seasonal context
    if (analysis.patterns.seasonal.precipitation) {
        const rainyDays = analysis.patterns.seasonal.precipitation.rainyDays;
        if (rainyDays > 100) {
            suggestions.push('High precipitation region - frequent rain could be a recurring environmental challenge');
        } else if (rainyDays < 50) {
            suggestions.push('Dry climate - water availability, dust, or drought could be relevant themes');
        }
    }

    return suggestions;
}

/**
 * Helper function to check if a date is within buffer period of target date
 * @param {number} targetMonth - Target month (0-11)
 * @param {number} targetDay - Target day
 * @param {number} bufferDays - Number of days buffer
 * @param {number} currentMonth - Current month (0-11)
 * @param {number} currentDay - Current day
 * @param {number} year - Current year
 * @returns {boolean} Whether within buffer
 */
function isWithinBuffer(targetMonth, targetDay, bufferDays, currentMonth, currentDay, year) {
    if (currentMonth === undefined || currentDay === undefined || year === undefined) {
        // Use current date if not provided
        const now = new Date();
        currentMonth = now.getMonth();
        currentDay = now.getDate();
        year = now.getFullYear();
    }

    const targetDate = new Date(year, targetMonth, targetDay);
    const currentDate = new Date(year, currentMonth, currentDay);
    const diffTime = Math.abs(currentDate.getTime() - targetDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= bufferDays;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

// Constants for holiday intensity calculation
const HOLIDAY_INTENSITY_LEVELS = {
    MINIMAL: { level: 'minimal', description: 'subtle hints only', multiplier: 0.1 },
    EARLY: { level: 'early', description: 'gentle introduction', multiplier: 0.3 },
    BUILDING: { level: 'building', description: 'increasing presence', multiplier: 0.5 },
    STRONG: { level: 'strong', description: 'prominent elements', multiplier: 0.75 },
    PEAK: { level: 'peak', description: 'full immersion', multiplier: 1.0 },
    EXTENDED: { level: 'extended', description: 'sustained celebration', multiplier: 0.8 },
    FADING: { level: 'fading', description: 'residual elements', multiplier: 0.2 }
};

const HOLIDAY_BUFFER_THRESHOLDS = {
    EARLY_PHASE: 0.75,      // First 25% of buffer
    BUILDING_PHASE: 0.5,    // 25-50% through buffer
    STRONG_PHASE: 0.25,     // 50-75% through buffer
    PEAK_PHASE: -3,         // Last 25% before + 3 days after
    EXTENDED_PHASE: -7      // 4-7 days after
};

// Centralized holiday names mapping (prevents duplication)
const HOLIDAY_NAMES = {
    10: 'Christmas/Holiday Season',
    11: 'New Year\'s Celebration',
    12: 'Halloween',
    13: 'Thanksgiving',
    14: 'Independence Day',
    15: 'Valentine\'s Day',
    16: 'Easter/Spring Holiday',
    17: 'St. Patrick\'s Day',
    18: 'Memorial Day',
    19: 'Labor Day',
    20: 'Veterans Day',
    21: 'Japanese New Year (Oshogatsu)',
    22: 'Cherry Blossom Season (Hanami)',
    23: 'Star Festival (Tanabata)',
    24: 'Golden Week (Shukujitsu)',
    25: 'Children\'s Day (Kodomo no Hi)',
    26: 'Autumn Moon Festival (Tsukimi)',
    27: 'Obon Festival (Bon Odori)'
};

/**
 * Centralized holiday data for consistent maintenance and usage
 * Contains all holiday information including dates, buffers, and visual elements
 */
const HOLIDAY_DATA = {
    // US Holidays
    10: { // Christmas
        name: 'Christmas/Holiday Season',
        region: 'US',
        priority: 5,
        bufferDays: 21,
        dateLogic: (month, dayOfMonth) => {
            // Christmas biased buffer: ~75% before (16 days), ~25% after (5 days)
            // Dec 25 - 16 days = Dec 9, Dec 25 + 5 days = Dec 30
            if (month === 11 && dayOfMonth >= 9 && dayOfMonth <= 30) return true; // Dec 9-30
            return false;
        },
        targetMonth: 11,
        targetDay: 25,
        decorations: 'christmas trees, holiday lights, wreaths, ornaments, stockings, mistletoe, snowflakes, candles, garlands, bells',
        atmosphere: 'festive, warm, magical, cozy winter wonderland, joyful, merry',
        colors: 'red, green, gold, white, silver, deep blue accents',
        activities: 'gift giving, family gatherings, holiday meals, caroling, festive celebrations, winter activities'
    },
    11: { // New Year's
        name: 'New Year\'s Celebration',
        region: 'US',
        priority: 3,
        bufferDays: 14,
        dateLogic: (month, dayOfMonth) => {
            // New Year's special buffer: 6 days before, 8 days after (>7 days after as requested)
            // Jan 1 - 6 days = Dec 26, Jan 1 + 8 days = Jan 9
            if (month === 11 && dayOfMonth >= 26) return true;    // Dec 26-31
            if (month === 0 && dayOfMonth <= 9) return true;      // Jan 1-9
            return false;
        },
        targetMonth: 0,
        targetDay: 1,
        decorations: 'fireworks, champagne, party hats, streamers, countdown clocks, confetti, balloons, resolutions banners',
        atmosphere: 'celebratory, fresh start, hopeful, energetic, optimistic, renewal',
        colors: 'gold, silver, white, black, metallic accents',
        activities: 'celebrations, resolutions, parties, fireworks, countdowns, fresh beginnings'
    },
    12: { // Halloween
        name: 'Halloween',
        region: 'US',
        priority: 5,
        bufferDays: 14,
        dateLogic: (month, dayOfMonth) => {
            // Halloween biased buffer: ~75% before (11 days), ~25% after (3 days)
            // Oct 31 - 11 days = Oct 20, Oct 31 + 3 days = Nov 3
            if (month === 9 && dayOfMonth >= 20) return true;   // Oct 20-31
            if (month === 10 && dayOfMonth <= 3) return true;   // Nov 1-3
            return false;
        },
        targetMonth: 9,
        targetDay: 31,
        decorations: 'pumpkins, jack-o\'-lanterns, ghosts, witches, bats, cobwebs, spooky elements, pumpkins, haunted houses',
        atmosphere: 'mysterious, spooky, playful fright, autumn evening, thrilling, eerie, halloween',
        colors: 'orange, black, purple, green, white accents, orange and black',
        activities: 'trick-or-treating, costume parties, cosplay, haunted houses, pumpkin carving, spooky events'
    },
    13: { // Thanksgiving
        name: 'Thanksgiving',
        region: 'US',
        priority: 4,
        bufferDays: 10,
        dateLogic: (month, dayOfMonth) => {
            // Thanksgiving biased buffer: ~75% before (8 days), ~25% after (2 days)
            // Nov 23 - 8 days = Nov 15, Nov 23 + 2 days = Nov 25
            if (month === 10 && dayOfMonth >= 15 && dayOfMonth <= 25) return true; // Nov 15-25
            return false;
        },
        targetMonth: 10,
        targetDay: 23,
        decorations: 'autumn leaves, pumpkins, cornucopias, harvest displays, turkeys, pies, fall wreaths',
        atmosphere: 'warm, thankful, harvest celebration, family gathering, grateful, cozy',
        colors: 'orange, brown, yellow, gold, deep reds, earth tones',
        activities: 'feasting, gratitude, family time, harvest celebration, football, parades'
    },
    14: { // Independence Day
        name: 'Independence Day',
        region: 'US',
        priority: 4,
        bufferDays: 7,
        dateLogic: (month, dayOfMonth) => {
            // Independence Day biased buffer: ~75% before (5 days), ~25% after (2 days)
            // July 4 - 5 days = June 29, July 4 + 2 days = July 6
            if (month === 5 && dayOfMonth >= 29) return true;    // June 29-30
            if (month === 6 && dayOfMonth <= 6) return true;     // July 1-6
            return false;
        },
        targetMonth: 6,
        targetDay: 4,
        decorations: 'flags, fireworks, patriotic colors, barbecues, eagle symbols, red white blue streamers',
        atmosphere: 'patriotic, celebratory, freedom, summer fun, community spirit',
        colors: 'red, white, blue, stars, stripes, gold accents',
        activities: 'fireworks, barbecues, celebrations'
    },
    15: { // Valentine's Day
        name: 'Valentine\'s Day',
        region: 'US',
        priority: 4,
        bufferDays: 7,
        dateLogic: (month, dayOfMonth) => {
            // Valentine's Day biased buffer: ~75% before (5 days), ~25% after (2 days)
            // Feb 14 - 5 days = Feb 9, Feb 14 + 2 days = Feb 16
            if (month === 1 && dayOfMonth >= 9 && dayOfMonth <= 16) return true; // Feb 9-16
            return false;
        },
        targetMonth: 1,
        targetDay: 14,
        decorations: 'hearts, roses, chocolates, cupids, romantic candles, lace, pink ribbons, love letters',
        atmosphere: 'romantic, loving, warm, affectionate, sweet, intimate',
        colors: 'red, pink, white, gold, silver accents',
        activities: 'romantic dinners, gift giving, love celebrations, date nights, affection displays'
    },
    16: { // Easter
        name: 'Easter/Spring Holiday',
        region: 'US',
        priority: 4,
        bufferDays: 14,
        dateLogic: (month, dayOfMonth) => (month === 2 && dayOfMonth >= 15) || (month === 3 && dayOfMonth <= 25),
        targetMonth: 3,
        targetDay: 12, // Approximate
        decorations: 'eggs, bunnies, flowers, pastels, baskets, chicks, spring blossoms, easter lilies',
        atmosphere: 'renewal, rebirth, fresh, hopeful, joyful, spring awakening',
        colors: 'pastels, yellow, white, green, lavender, pink',
        activities: 'egg hunts, spring celebrations, renewal rituals, family gatherings, spring festivals'
    },
    17: { // St. Patrick's Day
        name: 'St. Patrick\'s Day',
        region: 'US',
        priority: 3,
        bufferDays: 7,
        dateLogic: (month, dayOfMonth) => {
            // St. Patrick's Day biased buffer: ~75% before (5 days), ~25% after (2 days)
            // March 17 - 5 days = March 12, March 17 + 2 days = March 19
            if (month === 2 && dayOfMonth >= 12 && dayOfMonth <= 19) return true; // Mar 12-19
            return false;
        },
        targetMonth: 2,
        targetDay: 17,
        decorations: 'shamrocks, leprechauns, pots of gold, green ribbons, irish flags, clovers, green hats',
        atmosphere: 'festive, lucky, celebratory, cultural, spirited, merry',
        colors: 'green, gold, white, black accents',
        activities: 'parades, parties, irish culture celebrations, green beer, luck traditions'
    },
    18: { // Memorial Day
        name: 'Memorial Day',
        region: 'US',
        priority: 3,
        bufferDays: 5,
        dateLogic: (month, dayOfMonth, year) => {
            const memorialDay = new Date(year, 4, 31);
            memorialDay.setDate(memorialDay.getDate() - memorialDay.getDay());
            return isWithinBuffer(memorialDay.getMonth(), memorialDay.getDate(), 5);
        },
        targetMonth: 4, // Last Monday in May - calculated dynamically
        targetDay: null, // Calculated dynamically
        decorations: 'american flags, wreaths, military honors, red white blue bunting, remembrance ribbons',
        atmosphere: 'respectful, patriotic, reflective, commemorative',
        colors: 'red, white, blue, gold accents',
        activities: 'parade, ceremonies, family gathering, barbecues'
    },
    19: { // Labor Day
        name: 'Labor Day',
        region: 'US',
        priority: 2,
        bufferDays: 5,
        dateLogic: (month, dayOfMonth, year) => {
            const laborDay = new Date(year, 8, 1);
            laborDay.setDate(laborDay.getDate() + (7 - laborDay.getDay()));
            return isWithinBuffer(laborDay.getMonth(), laborDay.getDate(), 5);
        },
        targetMonth: 8, // First Monday in September - calculated dynamically
        targetDay: null, // Calculated dynamically
        decorations: 'american flags, labor symbols, worker imagery, back to school elements, end of summer motifs',
        atmosphere: 'relaxed, celebratory, community-focused, end-of-summer, appreciative',
        colors: 'red, white, blue, gold, earth tones',
        activities: 'parades, barbecues, family gatherings, back to school events, relaxation'
    },
    20: { // Veterans Day
        name: 'Veterans Day',
        region: 'US',
        priority: 2,
        bufferDays: 3,
        dateLogic: (month, dayOfMonth) => isWithinBuffer(10, 11, 3) || (month === 10 && dayOfMonth >= 8 && dayOfMonth <= 14),
        targetMonth: 10,
        targetDay: 11,
        decorations: 'american flags, wreaths, military honors, remembrance ribbons, veteran symbols',
        atmosphere: 'respectful, grateful, patriotic, commemorative, solemn',
        colors: 'red, white, blue, gold, black accents',
        activities: 'ceremonies, remembrance, veteran appreciation, patriotic displays'
    },

    // Japanese Holidays
    21: { // Japanese New Year
        name: 'Japanese New Year (Oshogatsu)',
        region: 'Japan',
        priority: 4,
        bufferDays: 2,
        dateLogic: (month, dayOfMonth) => isWithinBuffer(0, 1, 2) || (month === 0 && dayOfMonth <= 3),
        targetMonth: 0,
        targetDay: 1,
        decorations: 'kadomatsu, kagami mochi, shimekazari, bamboo decorations, pine branches, traditional new year motifs',
        atmosphere: 'traditional, solemn, hopeful, family-oriented, reflective, auspicious',
        colors: 'red, white, gold, black, natural wood tones',
        activities: 'temple visits, family gatherings, traditional foods, hatsumode, new year rituals'
    },
    22: { // Cherry Blossom
        name: 'Cherry Blossom Season (Hanami)',
        region: 'Japan',
        priority: 4,
        bufferDays: 10,
        dateLogic: (month, dayOfMonth) => (month === 2 && dayOfMonth >= 20) || (month === 3 && dayOfMonth <= 20),
        targetMonth: 3,
        targetDay: 15, // Approximate
        decorations: 'cherry blossoms, pink petals, traditional picnic setups, lanterns, floral arrangements',
        atmosphere: 'serene, beautiful, ephemeral, celebratory, peaceful, contemplative',
        colors: 'pink, white, soft pastels, light green, natural earth tones',
        activities: 'hanami picnics, cherry blossom viewing, photography, festivals, nature appreciation'
    },
    23: { // Tanabata
        name: 'Star Festival (Tanabata)',
        region: 'Japan',
        priority: 3,
        bufferDays: 3,
        dateLogic: (month, dayOfMonth) => isWithinBuffer(6, 7, 3) || (month === 6 && dayOfMonth >= 4 && dayOfMonth <= 10),
        targetMonth: 6,
        targetDay: 7,
        decorations: 'colorful paper strips, bamboo branches, stars, wishes, lanterns, summer motifs',
        atmosphere: 'romantic, hopeful, magical, celebratory, wish-making, summer evening',
        colors: 'blue, gold, red, white, starry night colors',
        activities: 'wish writing, lantern displays, festivals, romance celebrations, summer events'
    },
    24: { // Golden Week
        name: 'Golden Week (Shukujitsu)',
        region: 'Japan',
        priority: 4,
        bufferDays: 7,
        dateLogic: (month, dayOfMonth) => (month === 3 && dayOfMonth >= 29) || (month === 4 && dayOfMonth <= 5),
        targetMonth: 4,
        targetDay: 29,
        decorations: 'traditional banners, family crests, seasonal flowers, festive displays, travel motifs',
        atmosphere: 'celebratory, relaxed, family-oriented, travel-focused, joyful, restful',
        colors: 'red, white, gold, green, spring colors',
        activities: 'travel, family visits, festivals, relaxation, cherry blossom viewing, shrine visits'
    },
    25: { // Children's Day
        name: 'Children\'s Day (Kodomo no Hi)',
        region: 'Japan',
        priority: 3,
        bufferDays: 7,
        dateLogic: (month, dayOfMonth) => {
            // Children's Day biased buffer: ~75% before (5 days), ~25% after (2 days)
            // May 5 - 5 days = April 30, May 5 + 2 days = May 7
            if (month === 3 && dayOfMonth >= 30) return true;    // April 30
            if (month === 4 && dayOfMonth <= 7) return true;     // May 1-7
            return false;
        },
        targetMonth: 4,
        targetDay: 5,
        decorations: 'koinobori carp streamers, samurai dolls, iris flowers, traditional toys, warrior imagery',
        atmosphere: 'celebratory, hopeful, protective, family-oriented, proud, traditional',
        colors: 'blue, white, red, gold, natural tones',
        activities: 'family celebrations, carp streamer displays, traditional foods, child-focused events'
    },
    26: { // Tsukimi
        name: 'Autumn Moon Festival (Tsukimi)',
        region: 'Japan',
        priority: 2,
        bufferDays: 5,
        dateLogic: (month, dayOfMonth) => month === 8 && dayOfMonth >= 10 && dayOfMonth <= 20,
        targetMonth: 8,
        targetDay: 15, // Approximate
        decorations: 'moon motifs, pampas grass, traditional offerings, harvest displays, autumn leaves',
        atmosphere: 'serene, appreciative, harvest-focused, reflective, natural beauty',
        colors: 'white, silver, gold, autumn colors, moonlit tones',
        activities: 'moon viewing, harvest celebrations, traditional foods, nature appreciation'
    },
    27: { // Obon
        name: 'Obon Festival (Bon Odori)',
        region: 'Japan',
        priority: 3,
        bufferDays: 5,
        dateLogic: (month, dayOfMonth) => month === 7 && dayOfMonth >= 10 && dayOfMonth <= 20,
        targetMonth: 7,
        targetDay: 15, // Approximate
        decorations: 'lanterns, ancestor altars, white flowers, memorial displays, traditional motifs',
        atmosphere: 'respectful, spiritual, celebratory, ancestral, reflective, community-oriented',
        colors: 'white, gold, red, purple, traditional colors',
        activities: 'bon odori dancing, ancestor remembrance, lantern displays, family gatherings, memorial services'
    }
};

/**
 * Get days until a target date
 * @param {number} targetMonth - Target month (0-11)
 * @param {number} targetDay - Target day
 * @param {number} currentMonth - Current month (0-11)
 * @param {number} currentDay - Current day
 * @param {number} year - Current year
 * @returns {number} Days until target date
 */
function getDaysUntil(targetMonth, targetDay, currentMonth, currentDay, year) {
    if (currentMonth === undefined || currentDay === undefined || year === undefined) {
        // Use current date if not provided
        const now = new Date();
        currentMonth = now.getMonth();
        currentDay = now.getDate();
        year = now.getFullYear();
    }

    const targetDate = new Date(year, targetMonth, targetDay);
    const currentDate = new Date(year, currentMonth, currentDay);
    const diffTime = targetDate.getTime() - currentDate.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get vivid weather description for common weather conditions
 * @param {string} condition - Weather condition name
 * @param {number} windDirection - Wind direction in degrees (optional)
 * @returns {string} Vivid description with visual elements
 */
function getVividWeatherDescription(condition, windDirection = null) {
    const directions = [
        'north', 'north-northeast', 'northeast', 'east-northeast',
        'east', 'east-southeast', 'southeast', 'south-southeast',
        'south', 'south-southwest', 'southwest', 'west-southwest',
        'west', 'west-northwest', 'northwest', 'north-northwest'
    ];

    // Create descriptions with wind direction if provided
    const windDesc = windDirection !== null ? ` ${directions[(Math.round((((windDirection % 360) + 360) % 360) / 22.5) % 16)]} wind` : '';

    const conditionMap = {
        'thunderstorm': `dark ominous clouds, heavy rain falling in sheets, lightning flashes illuminating the sky, hurricane-force${windDesc} bending trees nearly horizontal, wet pavement with rushing water, dramatic stormy atmosphere with deafening thunder`,
        'severe thunderstorm': `torrential rain pouring down violently, frequent lightning bolts cracking across dark clouds, destructive${windDesc} whipping through the air like weapons, flooded streets with raging water, intense stormy drama and chaos with apocalyptic fury`,
        'light rain': `gentle rain falling softly, light mist hanging in the air, slightly wet surfaces glistening, soft pattering sound, overcast but not dark atmosphere`,
        'moderate rain': `steady rain falling continuously, water pooling on surfaces, damp atmosphere, moderate cloud cover, consistent precipitation pattern`,
        'heavy rain': `heavy rain falling in sheets, water streaming down surfaces, strong downpour, saturated ground, intense precipitation`,
        'drizzle': `fine mist-like rain falling lightly, barely perceptible precipitation, slightly damp surfaces, very light cloud cover`,
        'snow': `white snowflakes falling gently${windDesc}, snow-covered ground and surfaces, cold misty breath visible, soft fluffy snow accumulation, winter atmosphere`,
        'light snow': `few snowflakes falling sparsely${windDesc}, thin layer of snow on ground, cold crisp air, light winter precipitation`,
        'heavy snow': `thick snow falling heavily${windDesc}, snow piling up quickly, blizzard-like conditions, poor visibility, deep snow accumulation`,
        'fog': `thick fog obscuring distant objects, misty atmosphere reducing visibility, damp air, mysterious hazy environment, soft diffused lighting`,
        'mist': `light fog hanging in the air, slightly reduced visibility, moist atmosphere, gentle haze, soft atmospheric diffusion`,
        'haze': `dry haze in the air, slightly obscured visibility, warm dry atmosphere, diffused light, atmospheric particles`,
        'clear sky': `clear blue sky, bright sunlight, harsh shadows, warm atmosphere, excellent visibility to horizon`,
        'few clouds': `mostly clear sky with scattered clouds, bright sunlight with some shade, pleasant atmosphere, good visibility`,
        'scattered clouds': `partially cloudy sky, mix of sun and cloud shade, variable lighting, moderate visibility`,
        'broken clouds': `mostly cloudy sky with breaks, diffused sunlight, soft shadows, moderate atmospheric cover`,
        'overcast': `completely overcast sky, diffused lighting, soft shadows, no direct sunlight, uniform cloud cover`,
        'windy': `howling${windDesc} raging violently, trees bent nearly horizontal, debris missiles flying lethally, faces battered by wind pressure, hair ripped like whips, clothes torn at seams, apocalyptic fury with deafening roar`,
        'calm': `gentle light breeze, minimal air movement, still atmosphere, peaceful conditions, stable air`,
        'sunny': `bright sunlight streaming down, clear sky, warm golden lighting, harsh defined shadows, clear visibility`,
        'cloudy': `overcast sky with clouds, diffused lighting, soft shadows, cooler atmosphere, no direct sunlight`,
        'showers': `intermittent rain showers falling sporadically, brief periods of heavy rain alternating with lighter drizzle, puddles forming and disappearing on surfaces, variable cloud cover with breaks of sunlight`,
        'sleet': `icy sleet pellets falling steadily, small ice particles bouncing off surfaces, slick icy coating forming on roads and sidewalks, cold wet atmosphere with freezing mist`,
        'hail': `large hailstones crashing down violently, ice balls accumulating on ground, dents in car roofs and broken windows, thunderous impacts echoing, baseball to golf ball sized hail`,
        'freezing rain': `supercooled rain freezing instantly on contact, trees and power lines encased in clear ice, sidewalks becoming dangerously slippery, delicate ice formations hanging from surfaces`,
        'blizzard': `ferocious blizzard raging with near whiteout conditions, heavy snow driven horizontally by hurricane force winds, visibility reduced to mere feet, dangerously cold wind chill`,
        'hurricane': `massive hurricane with catastrophic winds, torrential rains flooding everything, violent storm surge, palm trees bent nearly horizontal, apocalyptic destruction and chaos`,
        'tornado': `furious tornado touching down with devastating force, houses ripped apart and hurled through air, debris cloud swirling violently, path of total destruction left in wake`,
        'dust storm': `massive dust storm engulfing everything in choking brown clouds, visibility reduced to zero, fine dust particles infiltrating everything, arid desert winds carrying soil high into sky`,
        'sandstorm': `intense sandstorm blasting sand horizontally, abrasive particles scouring surfaces, visibility near zero in swirling tan clouds, dangerous respiratory hazard`,
        'ice storm': `ice storm coating everything in thick glaze ice, tree branches cracking under weight of ice, power lines sagging dangerously, beautiful but deadly ice crystal formations`,
        'squall': `sudden violent squall with explosive wind increase, sheets of rain driven nearly horizontal, umbrellas inverting instantly, brief but intense burst of weather fury`,
        'heat_wave': `extreme heat wave with scorching temperatures, sweat pouring down in rivers from overheated bodies, labored breathing and heat exhaustion setting in quickly, flushed red skin glowing, wilting vegetation everywhere, shimmering heat haze distorting the horizon, oppressive stagnant air with minimal${windDesc}`,
        'clear_sky': `clear blue sky, bright sunlight, harsh shadows, warm atmosphere, excellent visibility to horizon`,
        'few_clouds': `mostly clear sky with scattered clouds, bright sunlight with some shade, pleasant atmosphere, good visibility`,
        'partly_cloudy': `partially cloudy sky, mix of sun and cloud shade, variable lighting, moderate visibility`,
        'fair': `pleasant fair weather with mild temperatures, comfortable atmosphere, light breezes, clear skies with occasional clouds`,
        'scattered_clouds': `scattered clouds across the sky, patches of sunlight and shade, moderate visibility, comfortable atmosphere`,
        'broken_clouds': `broken cloud cover creating a patchwork of light and shadow, variable visibility, moderate atmospheric conditions`,
        'overcast': `completely overcast sky, diffused lighting, soft shadows, no direct sunlight, uniform cloud cover`,
        'mostly_cloudy': `mostly cloudy sky with breaks of sunlight, diffused lighting patterns, moderate visibility, comfortable atmosphere`,
        'dense_fog': `extremely thick fog obscuring everything, near zero visibility, damp penetrating mist, mysterious and disorienting atmosphere, soft diffused lighting`,
        'dust': `dusty haze filling the air, reduced visibility from suspended particles, dry atmosphere, hazy sunlight, arid conditions`,
        'volcanic_ash': `volcanic ash cloud darkening the sky, fine ash particles falling like dirty snow, acrid smell, extremely poor visibility, dangerous respiratory hazard`,
        'sand': `sandstorm with swirling tan clouds, abrasive sand particles scouring surfaces, visibility near zero, desert wind carrying soil high into atmosphere`,
        'squalls': `sudden violent squall with explosive wind increase, sheets of rain driven nearly horizontal, umbrellas inverting instantly, brief but intense burst of weather fury`,
        'rainbow': `beautiful rainbow arching across the sky after recent rain, colorful spectrum of light, sun breaking through clouds, magical atmospheric phenomenon, fresh clean air`,
        'high_surf': `massive ocean waves crashing violently, high surf with enormous breakers, powerful undertow, spray flying high into air, dramatic coastal weather`,
        'cold_wave': `extreme cold wave with bitter freezing temperatures, numbing wind chill, frost forming on everything, dangerously low temperatures, polar air mass invasion`
    };

    const normalizedCondition = condition.toLowerCase().replace(/[^a-z_\s]/g, '');
    return conditionMap[normalizedCondition] || `${condition} weather conditions`;
}

/**
 * Generate SYNTHETIC/FAKE weather conditions for artistic/creative purposes only
 * WARNING: This creates fictional weather data based on typical meteorological patterns - NOT real weather observations
 * For real weather data, use actual weather APIs. This is only for image generation and creative applications.
 * @param {string} condition - Weather condition name (e.g., 'thunderstorm', 'snowing', 'foggy')
 * @param {Object} baseWeather - Optional base weather data to modify
 * @returns {Object} Synthetic weather data with typical ranges for the given condition
 */
function generateAccurateWeatherConditions(condition, baseWeather = {}) {
    const normalizedCondition = condition.toLowerCase().replace(/[^a-z_\s]/g, '');

    // SYNTHETIC weather data ranges based on TYPICAL meteorological patterns (not real-time data)
    const weatherRanges = {
        // Thunderstorm conditions - based on actual thunderstorm weather patterns
        'thunderstorm': {
            temperature: { min: 15, max: 30, typical: 22 }, // Warm, unstable air
            humidity: { min: 70, max: 95, typical: 85 }, // High humidity for storm development
            windSpeed: { min: 8, max: 25, typical: 15 }, // Strong winds common
            windDirection: { min: 180, max: 270, typical: 225 }, // South-southwest common for storms
            cloudCoverage: { min: 85, max: 100, typical: 95 }, // Nearly complete cloud cover
            precipitationRate: { min: 5, max: 50, typical: 15 }, // Moderate to heavy rain
            visibility: { min: 1, max: 8, typical: 5 }, // Reduced visibility from rain
            pressure: { min: 995, max: 1010, typical: 1002 }, // Low pressure system
            uvIndex: { min: 1, max: 4, typical: 2 }, // Low UV due to clouds
            dewPoint: { min: 15, max: 25, typical: 20 } // High dew point for storm
        },

        // Severe thunderstorm - more extreme conditions
        'severe thunderstorm': {
            temperature: { min: 20, max: 35, typical: 28 }, // Very warm air
            humidity: { min: 75, max: 100, typical: 90 }, // Extremely high humidity
            windSpeed: { min: 20, max: 45, typical: 30 }, // Very strong winds
            windDirection: { min: 200, max: 280, typical: 240 }, // Southwest common for severe storms
            cloudCoverage: { min: 90, max: 100, typical: 98 }, // Complete cloud cover
            precipitationRate: { min: 25, max: 100, typical: 40 }, // Very heavy rain
            visibility: { min: 0.5, max: 3, typical: 1.5 }, // Poor visibility
            pressure: { min: 985, max: 1000, typical: 990 }, // Very low pressure
            uvIndex: { min: 0, max: 2, typical: 1 }, // Minimal UV
            dewPoint: { min: 18, max: 28, typical: 24 } // Very high dew point
        },

        // Light rain conditions
        'light rain': {
            temperature: { min: 5, max: 25, typical: 15 }, // Moderate temperatures
            humidity: { min: 75, max: 95, typical: 85 }, // High humidity
            windSpeed: { min: 3, max: 15, typical: 8 }, // Light to moderate winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable, often southerly
            cloudCoverage: { min: 70, max: 95, typical: 80 }, // Mostly cloudy
            precipitationRate: { min: 0.5, max: 5, typical: 2 }, // Light precipitation
            visibility: { min: 5, max: 15, typical: 10 }, // Good visibility
            pressure: { min: 1005, max: 1020, typical: 1012 }, // Normal to low pressure
            uvIndex: { min: 2, max: 6, typical: 3 }, // Moderate UV
            dewPoint: { min: 5, max: 20, typical: 12 } // Moderate dew point
        },

        // Snow conditions - based on actual winter weather patterns
        'snow': {
            temperature: { min: -15, max: 2, typical: -3 }, // Cold temperatures
            humidity: { min: 60, max: 90, typical: 75 }, // Moderate to high humidity
            windSpeed: { min: 2, max: 20, typical: 8 }, // Variable winds
            windDirection: { min: 270, max: 90, typical: 0 }, // Often northerly or variable
            cloudCoverage: { min: 80, max: 100, typical: 90 }, // Heavy cloud cover
            precipitationRate: { min: 1, max: 10, typical: 3 }, // Light to moderate snow
            visibility: { min: 0.5, max: 5, typical: 2 }, // Reduced visibility
            pressure: { min: 1000, max: 1025, typical: 1015 }, // High pressure often brings snow
            uvIndex: { min: 1, max: 3, typical: 2 }, // Low UV in winter
            dewPoint: { min: -20, max: -2, typical: -8 } // Low dew point
        },

        // Heavy snow conditions
        'heavy snow': {
            temperature: { min: -20, max: -5, typical: -10 }, // Very cold
            humidity: { min: 70, max: 95, typical: 85 }, // High humidity
            windSpeed: { min: 10, max: 35, typical: 20 }, // Strong winds
            windDirection: { min: 315, max: 45, typical: 0 }, // Often north-northwest for blizzards
            cloudCoverage: { min: 95, max: 100, typical: 98 }, // Near complete cover
            precipitationRate: { min: 5, max: 25, typical: 12 }, // Heavy snow
            visibility: { min: 0.1, max: 1, typical: 0.3 }, // Very poor visibility
            pressure: { min: 995, max: 1015, typical: 1005 }, // Low pressure
            uvIndex: { min: 0, max: 2, typical: 1 }, // Minimal UV
            dewPoint: { min: -25, max: -8, typical: -15 } // Very low dew point
        },

        // Fog conditions - based on actual fog formation patterns
        'fog': {
            temperature: { min: 0, max: 15, typical: 8 }, // Cool temperatures
            humidity: { min: 85, max: 100, typical: 95 }, // Near saturation
            windSpeed: { min: 0, max: 5, typical: 2 }, // Very light winds (fog needs calm air)
            windDirection: { min: 0, max: 360, typical: 90 }, // Variable, often offshore flow
            cloudCoverage: { min: 90, max: 100, typical: 95 }, // Heavy cloud/fog cover
            precipitationRate: { min: 0, max: 1, typical: 0 }, // Minimal precipitation
            visibility: { min: 0.05, max: 1, typical: 0.3 }, // Very poor visibility
            pressure: { min: 1010, max: 1030, typical: 1020 }, // High pressure systems
            uvIndex: { min: 0, max: 3, typical: 1 }, // Low UV due to fog
            dewPoint: { min: 0, max: 12, typical: 7 } // Near air temperature
        },

        // Clear sky conditions
        'clear sky': {
            temperature: { min: -5, max: 35, typical: 20 }, // Wide temperature range
            humidity: { min: 20, max: 60, typical: 40 }, // Low to moderate humidity
            windSpeed: { min: 0, max: 10, typical: 3 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable, often prevailing direction
            cloudCoverage: { min: 0, max: 20, typical: 5 }, // Minimal clouds
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 15, max: 50, typical: 25 }, // Excellent visibility
            pressure: { min: 1015, max: 1035, typical: 1025 }, // High pressure
            uvIndex: { min: 5, max: 11, typical: 8 }, // High UV index
            dewPoint: { min: -10, max: 15, typical: 5 } // Low dew point
        },

        // Sunny conditions
        'sunny': {
            temperature: { min: 15, max: 40, typical: 25 }, // Warm temperatures
            humidity: { min: 15, max: 50, typical: 30 }, // Low humidity
            windSpeed: { min: 0, max: 8, typical: 4 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 135 }, // Often southeast in fair weather
            cloudCoverage: { min: 0, max: 10, typical: 2 }, // Clear skies
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 20, max: 50, typical: 30 }, // Perfect visibility
            pressure: { min: 1020, max: 1040, typical: 1030 }, // High pressure
            uvIndex: { min: 7, max: 12, typical: 9 }, // Very high UV
            dewPoint: { min: 0, max: 20, typical: 8 } // Moderate dew point
        },

        // Windy conditions
        'windy': {
            temperature: { min: 5, max: 25, typical: 15 }, // Moderate temperatures
            humidity: { min: 30, max: 70, typical: 45 }, // Moderate humidity
            windSpeed: { min: 15, max: 40, typical: 25 }, // Strong winds
            windDirection: { min: 270, max: 90, typical: 315 }, // Often westerly or northwesterly
            cloudCoverage: { min: 20, max: 80, typical: 40 }, // Variable clouds
            precipitationRate: { min: 0, max: 2, typical: 0 }, // Minimal precipitation
            visibility: { min: 5, max: 25, typical: 15 }, // Good visibility
            pressure: { min: 1000, max: 1020, typical: 1010 }, // Variable pressure
            uvIndex: { min: 3, max: 8, typical: 5 }, // Moderate UV
            dewPoint: { min: 0, max: 15, typical: 7 } // Moderate dew point
        },

        // Overcast/cloudy conditions
        'cloudy': {
            temperature: { min: 5, max: 20, typical: 12 }, // Cool temperatures
            humidity: { min: 60, max: 85, typical: 72 }, // Moderate to high humidity
            windSpeed: { min: 2, max: 12, typical: 6 }, // Light to moderate winds
            windDirection: { min: 0, max: 360, typical: 225 }, // Often southwest for cloudy conditions
            cloudCoverage: { min: 70, max: 100, typical: 85 }, // Heavy cloud cover
            precipitationRate: { min: 0, max: 1, typical: 0 }, // Minimal precipitation
            visibility: { min: 8, max: 20, typical: 12 }, // Good visibility
            pressure: { min: 1005, max: 1025, typical: 1015 }, // Normal pressure
            uvIndex: { min: 1, max: 4, typical: 2 }, // Low UV
            dewPoint: { min: 2, max: 12, typical: 8 } // Moderate dew point
        },

        // Hot conditions
        'hot': {
            temperature: { min: 35, max: 50, typical: 35 }, // Very hot
            humidity: { min: 20, max: 60, typical: 35 }, // Low to moderate humidity
            windSpeed: { min: 2, max: 8, typical: 4 }, // Light winds
            windDirection: { min: 90, max: 270, typical: 180 }, // Often southerly for hot conditions
            cloudCoverage: { min: 5, max: 30, typical: 15 }, // Mostly clear
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 15, max: 30, typical: 20 }, // Good visibility
            pressure: { min: 1010, max: 1030, typical: 1020 }, // High pressure
            uvIndex: { min: 8, max: 12, typical: 10 }, // Extreme UV
            dewPoint: { min: 15, max: 25, typical: 18 } // Moderate to high dew point
        },

        // Clear & Fair Weather conditions
        'clear_sky': {
            temperature: { min: 10, max: 35, typical: 22 }, // Variable temperatures
            humidity: { min: 30, max: 70, typical: 45 }, // Moderate humidity
            windSpeed: { min: 1, max: 10, typical: 4 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 0, max: 10, typical: 2 }, // Clear skies
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 20, max: 50, typical: 35 }, // Excellent visibility
            pressure: { min: 1010, max: 1030, typical: 1020 }, // Normal to high pressure
            uvIndex: { min: 6, max: 11, typical: 8 }, // High UV
            dewPoint: { min: 5, max: 20, typical: 12 } // Moderate dew point
        },

        'few_clouds': {
            temperature: { min: 8, max: 32, typical: 20 }, // Pleasant temperatures
            humidity: { min: 35, max: 75, typical: 50 }, // Moderate humidity
            windSpeed: { min: 1, max: 12, typical: 5 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 10, max: 25, typical: 15 }, // Few clouds
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 15, max: 40, typical: 30 }, // Good visibility
            pressure: { min: 1005, max: 1025, typical: 1015 }, // Normal pressure
            uvIndex: { min: 5, max: 10, typical: 7 }, // Moderate to high UV
            dewPoint: { min: 5, max: 18, typical: 11 } // Moderate dew point
        },

        'partly_cloudy': {
            temperature: { min: 8, max: 30, typical: 18 }, // Mild temperatures
            humidity: { min: 40, max: 80, typical: 55 }, // Moderate humidity
            windSpeed: { min: 2, max: 15, typical: 6 }, // Light to moderate winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 30, max: 60, typical: 45 }, // Partly cloudy
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 10, max: 35, typical: 25 }, // Good visibility
            pressure: { min: 1000, max: 1020, typical: 1010 }, // Normal pressure
            uvIndex: { min: 4, max: 9, typical: 6 }, // Moderate UV
            dewPoint: { min: 6, max: 20, typical: 13 } // Moderate dew point
        },

        'fair': {
            temperature: { min: 12, max: 28, typical: 20 }, // Pleasant temperatures
            humidity: { min: 35, max: 65, typical: 45 }, // Moderate humidity
            windSpeed: { min: 2, max: 12, typical: 5 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 10, max: 40, typical: 20 }, // Light cloud coverage
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 15, max: 40, typical: 30 }, // Good visibility
            pressure: { min: 1010, max: 1025, typical: 1018 }, // Normal to high pressure
            uvIndex: { min: 5, max: 10, typical: 7 }, // Moderate to high UV
            dewPoint: { min: 5, max: 18, typical: 12 } // Moderate dew point
        },
        'heat_wave': {
            temperature: { min: 38, max: 50, typical: 42 }, // Extremely hot, prolonged heat
            humidity: { min: 10, max: 40, typical: 20 }, // Very dry air
            windSpeed: { min: 0, max: 5, typical: 2 }, // Very light winds, stagnant air
            windDirection: { min: 90, max: 270, typical: 180 }, // Southerly flow common
            cloudCoverage: { min: 0, max: 15, typical: 5 }, // Clear skies
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No rain, drought conditions
            visibility: { min: 20, max: 40, typical: 30 }, // Excellent visibility, haze possible
            pressure: { min: 1015, max: 1035, typical: 1025 }, // High pressure systems
            uvIndex: { min: 10, max: 13, typical: 11 }, // Extreme UV radiation
            dewPoint: { min: 5, max: 20, typical: 10 } // Very low dew point, dry air
        },

        // Cold conditions
        'cold': {
            temperature: { min: -20, max: 0, typical: -5 }, // Very cold
            humidity: { min: 40, max: 80, typical: 60 }, // Moderate humidity
            windSpeed: { min: 2, max: 15, typical: 6 }, // Light to moderate winds
            windDirection: { min: 315, max: 45, typical: 0 }, // Often northerly for cold snaps
            cloudCoverage: { min: 30, max: 80, typical: 50 }, // Variable clouds
            precipitationRate: { min: 0, max: 3, typical: 0 }, // Minimal precipitation
            visibility: { min: 10, max: 30, typical: 18 }, // Good visibility
            pressure: { min: 1020, max: 1040, typical: 1030 }, // High pressure
            uvIndex: { min: 1, max: 4, typical: 2 }, // Low UV
            dewPoint: { min: -30, max: -5, typical: -12 } // Very low dew point
        },

        // Cloudy conditions
        'scattered_clouds': {
            temperature: { min: 5, max: 25, typical: 15 }, // Mild temperatures
            humidity: { min: 50, max: 85, typical: 65 }, // Moderate to high humidity
            windSpeed: { min: 2, max: 12, typical: 5 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 30, max: 50, typical: 40 }, // Scattered clouds
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 10, max: 30, typical: 20 }, // Good visibility
            pressure: { min: 1005, max: 1020, typical: 1012 }, // Normal pressure
            uvIndex: { min: 3, max: 8, typical: 5 }, // Moderate UV
            dewPoint: { min: 5, max: 18, typical: 11 } // Moderate dew point
        },

        'broken_clouds': {
            temperature: { min: 3, max: 22, typical: 13 }, // Cool temperatures
            humidity: { min: 55, max: 90, typical: 70 }, // High humidity
            windSpeed: { min: 3, max: 15, typical: 7 }, // Light to moderate winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 50, max: 80, typical: 65 }, // Broken cloud coverage
            precipitationRate: { min: 0, max: 2, typical: 0.5 }, // Light precipitation possible
            visibility: { min: 8, max: 25, typical: 18 }, // Moderate visibility
            pressure: { min: 1000, max: 1015, typical: 1008 }, // Low to normal pressure
            uvIndex: { min: 2, max: 7, typical: 4 }, // Low to moderate UV
            dewPoint: { min: 5, max: 16, typical: 10 } // Moderate dew point
        },

        'overcast': {
            temperature: { min: 0, max: 20, typical: 10 }, // Cool temperatures
            humidity: { min: 70, max: 100, typical: 85 }, // High humidity
            windSpeed: { min: 2, max: 12, typical: 5 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 80, max: 100, typical: 95 }, // Overcast skies
            precipitationRate: { min: 0, max: 5, typical: 1 }, // Light precipitation possible
            visibility: { min: 5, max: 20, typical: 12 }, // Reduced visibility
            pressure: { min: 995, max: 1010, typical: 1002 }, // Low pressure
            uvIndex: { min: 1, max: 5, typical: 2 }, // Low UV
            dewPoint: { min: 5, max: 15, typical: 10 } // Moderate dew point
        },

        'mostly_cloudy': {
            temperature: { min: 2, max: 18, typical: 11 }, // Cool temperatures
            humidity: { min: 65, max: 95, typical: 78 }, // High humidity
            windSpeed: { min: 3, max: 14, typical: 6 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 60, max: 90, typical: 75 }, // Mostly cloudy
            precipitationRate: { min: 0, max: 3, typical: 0.8 }, // Light precipitation possible
            visibility: { min: 8, max: 22, typical: 15 }, // Moderate visibility
            pressure: { min: 1000, max: 1015, typical: 1008 }, // Normal pressure
            uvIndex: { min: 2, max: 6, typical: 3 }, // Low to moderate UV
            dewPoint: { min: 4, max: 14, typical: 9 } // Moderate dew point
        },

        // Precipitation conditions
        'light_rain': {
            temperature: { min: 5, max: 25, typical: 15 }, // Moderate temperatures
            humidity: { min: 75, max: 95, typical: 85 }, // High humidity
            windSpeed: { min: 3, max: 15, typical: 8 }, // Light to moderate winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable, often southerly
            cloudCoverage: { min: 70, max: 95, typical: 80 }, // Mostly cloudy
            precipitationRate: { min: 0.5, max: 5, typical: 2 }, // Light precipitation
            visibility: { min: 5, max: 15, typical: 10 }, // Good visibility
            pressure: { min: 1005, max: 1020, typical: 1012 }, // Normal to low pressure
            uvIndex: { min: 2, max: 6, typical: 3 }, // Moderate UV
            dewPoint: { min: 5, max: 20, typical: 12 } // Moderate dew point
        },

        'moderate_rain': {
            temperature: { min: 3, max: 20, typical: 12 }, // Cool temperatures
            humidity: { min: 80, max: 100, typical: 90 }, // Very high humidity
            windSpeed: { min: 5, max: 20, typical: 12 }, // Moderate winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 80, max: 100, typical: 90 }, // Heavy cloud cover
            precipitationRate: { min: 3, max: 15, typical: 7 }, // Moderate precipitation
            visibility: { min: 3, max: 10, typical: 6 }, // Reduced visibility
            pressure: { min: 1000, max: 1015, typical: 1007 }, // Low pressure
            uvIndex: { min: 1, max: 4, typical: 2 }, // Low UV
            dewPoint: { min: 5, max: 18, typical: 11 } // Moderate dew point
        },

        'heavy_rain': {
            temperature: { min: 2, max: 18, typical: 10 }, // Cool temperatures
            humidity: { min: 85, max: 100, typical: 95 }, // Extremely high humidity
            windSpeed: { min: 8, max: 25, typical: 15 }, // Strong winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 90, max: 100, typical: 98 }, // Complete cloud cover
            precipitationRate: { min: 10, max: 50, typical: 25 }, // Heavy precipitation
            visibility: { min: 1, max: 5, typical: 2 }, // Poor visibility
            pressure: { min: 990, max: 1010, typical: 1000 }, // Low pressure
            uvIndex: { min: 0, max: 3, typical: 1 }, // Minimal UV
            dewPoint: { min: 5, max: 16, typical: 10 } // Moderate dew point
        },

        'light_snow': {
            temperature: { min: -5, max: 3, typical: -1 }, // Near freezing
            humidity: { min: 75, max: 95, typical: 85 }, // High humidity
            windSpeed: { min: 2, max: 12, typical: 5 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 70, max: 95, typical: 80 }, // Mostly cloudy
            precipitationRate: { min: 0.1, max: 2, typical: 0.5 }, // Light snow
            visibility: { min: 5, max: 15, typical: 10 }, // Moderate visibility
            pressure: { min: 1005, max: 1020, typical: 1012 }, // Normal pressure
            uvIndex: { min: 2, max: 6, typical: 3 }, // Low UV
            dewPoint: { min: -10, max: 1, typical: -4 } // Low dew point
        },

        'moderate_snow': {
            temperature: { min: -8, max: 1, typical: -3 }, // Cold temperatures
            humidity: { min: 80, max: 100, typical: 90 }, // Very high humidity
            windSpeed: { min: 3, max: 15, typical: 8 }, // Light to moderate winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 80, max: 100, typical: 90 }, // Heavy cloud cover
            precipitationRate: { min: 1, max: 8, typical: 3 }, // Moderate snow
            visibility: { min: 2, max: 8, typical: 4 }, // Poor visibility
            pressure: { min: 1000, max: 1015, typical: 1008 }, // Low pressure
            uvIndex: { min: 1, max: 4, typical: 2 }, // Very low UV
            dewPoint: { min: -12, max: -1, typical: -6 } // Very low dew point
        },

        'heavy_snow': {
            temperature: { min: -15, max: -2, typical: -8 }, // Very cold
            humidity: { min: 85, max: 100, typical: 95 }, // Extremely high humidity
            windSpeed: { min: 5, max: 20, typical: 12 }, // Moderate to strong winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 90, max: 100, typical: 98 }, // Complete cloud cover
            precipitationRate: { min: 5, max: 20, typical: 10 }, // Heavy snow
            visibility: { min: 0.5, max: 3, typical: 1.5 }, // Very poor visibility
            pressure: { min: 990, max: 1010, typical: 1000 }, // Low pressure
            uvIndex: { min: 0, max: 3, typical: 1 }, // Minimal UV
            dewPoint: { min: -20, max: -5, typical: -12 } // Very low dew point
        },

        'freezing_rain': {
            temperature: { min: -5, max: 3, typical: 1 }, // Near freezing
            humidity: { min: 90, max: 100, typical: 98 }, // Extremely high humidity
            windSpeed: { min: 3, max: 15, typical: 7 }, // Light to moderate winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 85, max: 100, typical: 95 }, // Heavy cloud cover
            precipitationRate: { min: 0.5, max: 8, typical: 2 }, // Light to moderate freezing rain
            visibility: { min: 2, max: 10, typical: 5 }, // Poor visibility
            pressure: { min: 995, max: 1015, typical: 1005 }, // Low pressure
            uvIndex: { min: 1, max: 4, typical: 2 }, // Low UV
            dewPoint: { min: -2, max: 2, typical: 0 } // Near freezing dew point
        },

        // Showers - intermittent rain
        'showers': {
            temperature: { min: 8, max: 22, typical: 15 }, // Mild temperatures
            humidity: { min: 65, max: 90, typical: 78 }, // Moderately high humidity
            windSpeed: { min: 5, max: 20, typical: 12 }, // Moderate winds
            windDirection: { min: 0, max: 360, typical: 200 }, // Variable, often from weather systems
            cloudCoverage: { min: 60, max: 90, typical: 75 }, // Significant cloud cover
            precipitationRate: { min: 2, max: 15, typical: 6 }, // Moderate intermittent rain
            visibility: { min: 3, max: 12, typical: 8 }, // Moderate visibility
            pressure: { min: 1000, max: 1015, typical: 1008 }, // Low to normal pressure
            uvIndex: { min: 1, max: 5, typical: 2 }, // Low to moderate UV
            dewPoint: { min: 5, max: 15, typical: 10 } // Moderate dew point
        },

        // Sleet - ice pellets
        'sleet': {
            temperature: { min: -5, max: 5, typical: 1 }, // Near freezing temperatures
            humidity: { min: 70, max: 95, typical: 85 }, // High humidity
            windSpeed: { min: 5, max: 25, typical: 12 }, // Moderate to strong winds
            windDirection: { min: 270, max: 90, typical: 315 }, // Often cold fronts
            cloudCoverage: { min: 80, max: 100, typical: 90 }, // Heavy cloud cover
            precipitationRate: { min: 1, max: 8, typical: 3 }, // Light to moderate sleet
            visibility: { min: 0.5, max: 4, typical: 1.5 }, // Poor visibility
            pressure: { min: 995, max: 1015, typical: 1005 }, // Low pressure systems
            uvIndex: { min: 1, max: 3, typical: 1 }, // Low UV
            dewPoint: { min: -8, max: 2, typical: -2 } // Near freezing dew point
        },

        // Hail - ice balls from thunderstorms
        'hail': {
            temperature: { min: 5, max: 25, typical: 15 }, // Cool to warm temperatures
            humidity: { min: 60, max: 95, typical: 80 }, // High humidity
            windSpeed: { min: 15, max: 35, typical: 22 }, // Strong winds
            windDirection: { min: 180, max: 270, typical: 225 }, // Storm-driven winds
            cloudCoverage: { min: 85, max: 100, typical: 95 }, // Severe storm clouds
            precipitationRate: { min: 10, max: 30, typical: 18 }, // Heavy precipitation with hail
            visibility: { min: 0.2, max: 2, typical: 0.8 }, // Very poor visibility
            pressure: { min: 985, max: 1005, typical: 995 }, // Very low pressure
            uvIndex: { min: 0, max: 2, typical: 1 }, // Minimal UV
            dewPoint: { min: 5, max: 18, typical: 12 } // Moderate to high dew point
        },

        // Freezing rain - rain that freezes on contact
        'freezing rain': {
            temperature: { min: -5, max: 3, typical: 0 }, // Below freezing at surface
            humidity: { min: 80, max: 100, typical: 92 }, // Very high humidity
            windSpeed: { min: 5, max: 20, typical: 10 }, // Moderate winds
            windDirection: { min: 270, max: 90, typical: 315 }, // Cold air masses
            cloudCoverage: { min: 80, max: 100, typical: 90 }, // Thick cloud layers
            precipitationRate: { min: 0.5, max: 8, typical: 2 }, // Light to moderate freezing rain
            visibility: { min: 0.5, max: 3, typical: 1.2 }, // Poor visibility from ice
            pressure: { min: 995, max: 1015, typical: 1005 }, // Low pressure systems
            uvIndex: { min: 1, max: 3, typical: 1 }, // Low UV
            dewPoint: { min: -8, max: 1, typical: -2 } // Below freezing dew point
        },

        // Blizzard - severe snowstorm
        'blizzard': {
            temperature: { min: -25, max: -10, typical: -18 }, // Extremely cold
            humidity: { min: 75, max: 95, typical: 85 }, // High humidity
            windSpeed: { min: 25, max: 50, typical: 35 }, // Very strong winds
            windDirection: { min: 315, max: 45, typical: 0 }, // Northerly winds
            cloudCoverage: { min: 95, max: 100, typical: 98 }, // Complete cloud cover
            precipitationRate: { min: 8, max: 20, typical: 12 }, // Heavy snow
            visibility: { min: 0.05, max: 0.5, typical: 0.15 }, // Near zero visibility
            pressure: { min: 980, max: 1000, typical: 990 }, // Very low pressure
            uvIndex: { min: 0, max: 1, typical: 0 }, // No UV
            dewPoint: { min: -35, max: -15, typical: -25 } // Extremely low dew point
        },

        // Hurricane/Typhoon - tropical cyclone
        'hurricane': {
            temperature: { min: 20, max: 32, typical: 26 }, // Warm tropical temperatures
            humidity: { min: 80, max: 100, typical: 95 }, // Extremely high humidity
            windSpeed: { min: 33, max: 85, typical: 50 }, // Hurricane-force winds (119+ km/h)
            windDirection: { min: 0, max: 360, typical: 90 }, // Circular/cyclonic pattern
            cloudCoverage: { min: 90, max: 100, typical: 98 }, // Complete cloud cover
            precipitationRate: { min: 25, max: 150, typical: 75 }, // Torrential rain
            visibility: { min: 0.1, max: 2, typical: 0.5 }, // Very poor visibility
            pressure: { min: 920, max: 980, typical: 950 }, // Extremely low pressure
            uvIndex: { min: 0, max: 1, typical: 0 }, // No UV
            dewPoint: { min: 20, max: 30, typical: 25 } // Very high dew point
        },

        // Tornado - violently rotating column of air
        'tornado': {
            temperature: { min: 15, max: 35, typical: 24 }, // Warm, unstable air
            humidity: { min: 70, max: 95, typical: 85 }, // High humidity
            windSpeed: { min: 40, max: 120, typical: 65 }, // Extremely strong winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Complex rotational pattern
            cloudCoverage: { min: 85, max: 100, typical: 95 }, // Severe storm clouds
            precipitationRate: { min: 5, max: 50, typical: 20 }, // Heavy rain/hail
            visibility: { min: 0.05, max: 0.5, typical: 0.2 }, // Near zero visibility
            pressure: { min: 950, max: 990, typical: 970 }, // Very low pressure
            uvIndex: { min: 0, max: 1, typical: 0 }, // No UV
            dewPoint: { min: 15, max: 28, typical: 22 } // High dew point
        },

        // Severe thunderstorm - more extreme conditions
        'severe_thunderstorm': {
            temperature: { min: 20, max: 35, typical: 28 }, // Very warm air
            humidity: { min: 75, max: 100, typical: 90 }, // Extremely high humidity
            windSpeed: { min: 20, max: 45, typical: 30 }, // Very strong winds
            windDirection: { min: 200, max: 280, typical: 240 }, // Southwest common for severe storms
            cloudCoverage: { min: 90, max: 100, typical: 98 }, // Complete cloud cover
            precipitationRate: { min: 25, max: 100, typical: 40 }, // Very heavy rain
            visibility: { min: 0.5, max: 3, typical: 1.5 }, // Poor visibility
            pressure: { min: 985, max: 1000, typical: 990 }, // Very low pressure
            uvIndex: { min: 0, max: 2, typical: 1 }, // Minimal UV
            dewPoint: { min: 18, max: 28, typical: 24 } // Very high dew point
        },

        // Tropical storm - weaker tropical system
        'tropical_storm': {
            temperature: { min: 22, max: 30, typical: 26 }, // Warm tropical temperatures
            humidity: { min: 75, max: 95, typical: 88 }, // Very high humidity
            windSpeed: { min: 17, max: 32, typical: 25 }, // Tropical storm force winds (63-118 km/h)
            windDirection: { min: 0, max: 360, typical: 90 }, // Circular/cyclonic pattern
            cloudCoverage: { min: 80, max: 100, typical: 92 }, // Heavy cloud cover
            precipitationRate: { min: 15, max: 75, typical: 35 }, // Heavy rain
            visibility: { min: 1, max: 5, typical: 2.5 }, // Poor visibility
            pressure: { min: 980, max: 1000, typical: 990 }, // Low pressure
            uvIndex: { min: 0, max: 2, typical: 1 }, // Minimal UV
            dewPoint: { min: 20, max: 28, typical: 24 } // High dew point
        },

        // Dust storm - strong winds carrying dust
        'dust storm': {
            temperature: { min: 20, max: 45, typical: 30 }, // Hot, dry conditions
            humidity: { min: 5, max: 25, typical: 12 }, // Very low humidity
            windSpeed: { min: 15, max: 35, typical: 25 }, // Strong winds
            windDirection: { min: 135, max: 315, typical: 225 }, // Often from dry regions
            cloudCoverage: { min: 10, max: 50, typical: 20 }, // Minimal clouds
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 0.1, max: 1, typical: 0.3 }, // Very poor visibility
            pressure: { min: 1005, max: 1025, typical: 1015 }, // Normal to high pressure
            uvIndex: { min: 6, max: 12, typical: 9 }, // High UV despite dust
            dewPoint: { min: -10, max: 10, typical: 0 } // Very low dew point
        },

        // Sandstorm - strong winds carrying sand
        'sandstorm': {
            temperature: { min: 25, max: 50, typical: 35 }, // Very hot, desert conditions
            humidity: { min: 5, max: 20, typical: 10 }, // Extremely low humidity
            windSpeed: { min: 20, max: 45, typical: 30 }, // Strong winds
            windDirection: { min: 90, max: 270, typical: 180 }, // Desert wind patterns
            cloudCoverage: { min: 5, max: 30, typical: 10 }, // Clear skies
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 0.01, max: 0.5, typical: 0.1 }, // Extremely poor visibility
            pressure: { min: 1000, max: 1020, typical: 1010 }, // Normal pressure
            uvIndex: { min: 8, max: 13, typical: 10 }, // Very high UV
            dewPoint: { min: -5, max: 15, typical: 5 } // Low dew point
        },

        // Ice storm - ice accumulation on surfaces
        'ice storm': {
            temperature: { min: -10, max: 5, typical: -2 }, // Below freezing
            humidity: { min: 85, max: 100, typical: 95 }, // Very high humidity
            windSpeed: { min: 5, max: 20, typical: 10 }, // Moderate winds
            windDirection: { min: 270, max: 90, typical: 315 }, // Cold air masses
            cloudCoverage: { min: 80, max: 100, typical: 90 }, // Thick clouds
            precipitationRate: { min: 0.5, max: 5, typical: 1.5 }, // Light freezing precipitation
            visibility: { min: 0.5, max: 3, typical: 1.5 }, // Poor visibility
            pressure: { min: 990, max: 1010, typical: 1000 }, // Low pressure
            uvIndex: { min: 1, max: 3, typical: 1 }, // Low UV
            dewPoint: { min: -12, max: 2, typical: -4 } // Below freezing dew point
        },

        // Squall - sudden, sharp increase in wind speed
        'squall': {
            temperature: { min: 10, max: 25, typical: 18 }, // Moderate temperatures
            humidity: { min: 70, max: 95, typical: 82 }, // High humidity
            windSpeed: { min: 20, max: 45, typical: 30 }, // Sudden strong winds
            windDirection: { min: 0, max: 360, typical: 225 }, // Variable, gust front
            cloudCoverage: { min: 60, max: 95, typical: 80 }, // Significant clouds
            precipitationRate: { min: 2, max: 25, typical: 8 }, // Moderate to heavy rain
            visibility: { min: 1, max: 8, typical: 4 }, // Reduced visibility
            pressure: { min: 995, max: 1015, typical: 1005 }, // Low pressure
            uvIndex: { min: 1, max: 4, typical: 2 }, // Low UV
            dewPoint: { min: 8, max: 18, typical: 13 } // Moderate to high dew point
        },

        // Dense fog - extremely poor visibility
        'dense_fog': {
            temperature: { min: 0, max: 15, typical: 8 }, // Cool temperatures
            humidity: { min: 95, max: 100, typical: 98 }, // Extremely high humidity
            windSpeed: { min: 0, max: 5, typical: 2 }, // Very light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 90, max: 100, typical: 95 }, // Heavy fog/cloud cover
            precipitationRate: { min: 0, max: 1, typical: 0.1 }, // Light mist possible
            visibility: { min: 0.05, max: 0.5, typical: 0.2 }, // Extremely poor visibility
            pressure: { min: 1005, max: 1025, typical: 1015 }, // Normal to high pressure
            uvIndex: { min: 0, max: 1, typical: 0 }, // No UV
            dewPoint: { min: 0, max: 14, typical: 7 } // High dew point
        },

        // Dust - dusty conditions
        'dust': {
            temperature: { min: 15, max: 35, typical: 25 }, // Warm temperatures
            humidity: { min: 10, max: 40, typical: 20 }, // Low humidity
            windSpeed: { min: 8, max: 25, typical: 15 }, // Moderate winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 20, max: 60, typical: 35 }, // Moderate cloud/dust cover
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 1, max: 8, typical: 4 }, // Reduced visibility from dust
            pressure: { min: 1005, max: 1025, typical: 1015 }, // Normal pressure
            uvIndex: { min: 4, max: 9, typical: 6 }, // Moderate UV
            dewPoint: { min: 0, max: 15, typical: 8 } // Low dew point
        },

        // Volcanic ash - ash from volcanic activity
        'volcanic_ash': {
            temperature: { min: 5, max: 25, typical: 15 }, // Cool temperatures
            humidity: { min: 40, max: 80, typical: 55 }, // Moderate humidity
            windSpeed: { min: 5, max: 20, typical: 12 }, // Moderate winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable, plume direction
            cloudCoverage: { min: 60, max: 100, typical: 85 }, // Heavy ash/cloud cover
            precipitationRate: { min: 0, max: 2, typical: 0.5 }, // Light precipitation possible
            visibility: { min: 0.01, max: 1, typical: 0.2 }, // Very poor visibility
            pressure: { min: 995, max: 1015, typical: 1005 }, // Low pressure
            uvIndex: { min: 0, max: 2, typical: 1 }, // Minimal UV
            dewPoint: { min: 2, max: 18, typical: 10 } // Moderate dew point
        },

        // Sand - sandy conditions
        'sand': {
            temperature: { min: 20, max: 45, typical: 32 }, // Hot temperatures
            humidity: { min: 5, max: 30, typical: 15 }, // Very low humidity
            windSpeed: { min: 10, max: 30, typical: 18 }, // Strong winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 10, max: 40, typical: 20 }, // Light cloud cover
            precipitationRate: { min: 0, max: 0, typical: 0 }, // No precipitation
            visibility: { min: 0.5, max: 5, typical: 2 }, // Reduced visibility from sand
            pressure: { min: 1005, max: 1025, typical: 1015 }, // Normal pressure
            uvIndex: { min: 6, max: 12, typical: 9 }, // High UV
            dewPoint: { min: -5, max: 10, typical: 5 } // Very low dew point
        },

        // Squalls - sudden, strong winds
        'squalls': {
            temperature: { min: 8, max: 25, typical: 16 }, // Variable temperatures
            humidity: { min: 70, max: 95, typical: 82 }, // High humidity
            windSpeed: { min: 20, max: 45, typical: 30 }, // Sudden strong winds
            windDirection: { min: 0, max: 360, typical: 225 }, // Variable, gust front
            cloudCoverage: { min: 60, max: 95, typical: 80 }, // Significant clouds
            precipitationRate: { min: 2, max: 25, typical: 8 }, // Moderate to heavy rain
            visibility: { min: 1, max: 8, typical: 4 }, // Reduced visibility
            pressure: { min: 995, max: 1015, typical: 1005 }, // Low pressure
            uvIndex: { min: 1, max: 4, typical: 2 }, // Low UV
            dewPoint: { min: 8, max: 18, typical: 13 } // Moderate to high dew point
        },

        // Special conditions
        // Rainbow - after rain with sun
        'rainbow': {
            temperature: { min: 10, max: 25, typical: 18 }, // Mild temperatures
            humidity: { min: 60, max: 90, typical: 75 }, // High humidity
            windSpeed: { min: 2, max: 12, typical: 6 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 20, max: 60, typical: 35 }, // Partial cloud cover
            precipitationRate: { min: 0, max: 2, typical: 0.5 }, // Light rain just ended
            visibility: { min: 5, max: 15, typical: 10 }, // Good visibility
            pressure: { min: 1005, max: 1020, typical: 1012 }, // Normal pressure
            uvIndex: { min: 4, max: 9, typical: 6 }, // Moderate to high UV
            dewPoint: { min: 8, max: 18, typical: 13 } // Moderate dew point
        },

        // High surf - large ocean waves
        'high_surf': {
            temperature: { min: 15, max: 28, typical: 22 }, // Warm temperatures
            humidity: { min: 65, max: 90, typical: 78 }, // High humidity
            windSpeed: { min: 15, max: 35, typical: 25 }, // Strong onshore winds
            windDirection: { min: 90, max: 270, typical: 180 }, // Onshore winds
            cloudCoverage: { min: 30, max: 70, typical: 45 }, // Moderate cloud cover
            precipitationRate: { min: 0, max: 5, typical: 1 }, // Light precipitation possible
            visibility: { min: 8, max: 20, typical: 14 }, // Good visibility
            pressure: { min: 995, max: 1015, typical: 1005 }, // Low pressure
            uvIndex: { min: 4, max: 9, typical: 6 }, // Moderate UV
            dewPoint: { min: 12, max: 22, typical: 17 } // Moderate to high dew point
        },

        // Cold wave - extremely cold conditions
        'cold_wave': {
            temperature: { min: -30, max: -10, typical: -20 }, // Extremely cold
            humidity: { min: 50, max: 85, typical: 65 }, // Moderate humidity
            windSpeed: { min: 5, max: 25, typical: 15 }, // Moderate winds
            windDirection: { min: 315, max: 45, typical: 0 }, // Polar winds
            cloudCoverage: { min: 40, max: 80, typical: 55 }, // Moderate cloud cover
            precipitationRate: { min: 0, max: 5, typical: 1 }, // Light snow possible
            visibility: { min: 3, max: 15, typical: 8 }, // Moderate visibility
            pressure: { min: 1015, max: 1035, typical: 1025 }, // High pressure
            uvIndex: { min: 1, max: 4, typical: 2 }, // Low UV
            dewPoint: { min: -40, max: -15, typical: -28 } // Extremely low dew point
        }
    };

    const ranges = weatherRanges[normalizedCondition];
    if (!ranges) {
        // Fallback for unknown conditions
        return {
            temperature: baseWeather.temperature || 20,
            humidity: baseWeather.humidity || 60,
            windSpeed: baseWeather.windSpeed || 5,
            windDirection: baseWeather.windDirection || 180,
            cloudCoverage: baseWeather.cloudCoverage || 50,
            precipitationRate: baseWeather.precipitationRate || 0,
            visibility: baseWeather.visibility || 10,
            pressure: baseWeather.pressure || 1013,
            uvIndex: baseWeather.uvIndex || 5,
            dewPoint: baseWeather.dewPoint || 12,
            description: getVividWeatherDescription(condition, baseWeather.windDirection || 180),
            condition: condition,
            dataSource: 'Fallback weather data for ' + condition
        };
    }

    // Generate realistic values within the ranges, with some randomization
    const randomizeInRange = (range, variation = 0.1) => {
        const baseValue = range.typical;
        const rangeSize = range.max - range.min;
        const variationAmount = rangeSize * variation;
        const minVal = Math.max(range.min, baseValue - variationAmount);
        const maxVal = Math.min(range.max, baseValue + variationAmount);
        return Math.round((Math.random() * (maxVal - minVal) + minVal) * 10) / 10;
    };

    return {
        temperature: randomizeInRange(ranges.temperature),
        humidity: Math.round(randomizeInRange(ranges.humidity)),
        windSpeed: randomizeInRange(ranges.windSpeed),
        windDirection: Math.round(randomizeInRange(ranges.windDirection)),
        cloudCoverage: Math.round(randomizeInRange(ranges.cloudCoverage)),
        precipitationRate: randomizeInRange(ranges.precipitationRate, 0.3), // More variation for precipitation
        visibility: randomizeInRange(ranges.visibility, 0.2),
        pressure: Math.round(randomizeInRange(ranges.pressure)),
        uvIndex: Math.round(randomizeInRange(ranges.uvIndex)),
        dewPoint: randomizeInRange(ranges.dewPoint),
        description: getVividWeatherDescription(condition, randomizeInRange(ranges.windDirection)),
        condition: condition,
        dataSource: 'Accurate meteorological ranges for ' + condition
    };
}

/**
 * Clean up prompts by removing protected text wrappers and handling tag sections
 * Always removes leftover wrappers and keeps the contents inside
 * @param {string} content - The content to clean up
 * @returns {string} Cleaned content
 */
function cleanupPromptSyntax(content) {
    if (!content || typeof content !== 'string') {
        return content;
    }

    let cleanedContent = content;

    // Remove protected block wrappers !%content%
    const protectedRegex = /!%([^%]+)%/g;
    cleanedContent = cleanedContent.replace(protectedRegex, '$1');

    // Handle tag sections (e.g., CLOTHING%content%) - always remove wrappers but keep content
    const tagSectionRegex = /\b(TIME|WEATHER|SEASON|CLOTHING|ACTION|ENV|T|W|C|A|E)%([^%]+)%/g;
    cleanedContent = cleanedContent.replace(tagSectionRegex, '$2');

    // Replace <br> with newlines
    cleanedContent = cleanedContent.replaceAll('<br>', '\n');

    return cleanedContent;
}

/**
 * Expand shorthand tag sections to full keyword forms for AI processing
 * @param {string} content - The content to expand
 * @returns {string} Content with expanded shorthand forms
 */
function expandShorthandTags(content) {
    if (!content || typeof content !== 'string') {
        return content;
    }

    let expandedContent = content;

    // Expand shorthand tag sections to full keyword forms
    const shorthandMap = {
        'T': 'TIME',
        'W': 'WEATHER',
        'C': 'CLOTHING',
        'A': 'ACTION',
        'E': 'ENV'
    };

    // Replace shorthand prefixes in tag sections (e.g., T%content% → TIME%content%)
    Object.entries(shorthandMap).forEach(([shorthand, full]) => {
        const regex = new RegExp(`\\b${shorthand}%([^%]+)%`, 'g');
        expandedContent = expandedContent.replace(regex, `${full}%$1%`);
    });

    return expandedContent;
}

/**
 * Try to reconstruct what a select_text would look like after applying replacement history
 * This handles cases where select_text spans multiple segments that have been replaced
 * @param {string} selectText - The select_text that wasn't found in current content
 * @param {Map} replacementHistory - Map of original text -> replacement text
 * @param {string} originalContent - The original unmodified content
 * @returns {Object} { found: boolean, reconstructedText: string|null, index: number }
 */
function tryReconstructSelectText(selectText, replacementHistory, originalContent) {
    // Check if the select_text exists in the original content
    if (!originalContent.includes(selectText)) {
        return { found: false, reconstructedText: null, index: -1 };
    }
    
    // Try to reconstruct by applying replacement history to the select_text
    let reconstructed = selectText;
    let madeChanges = false;
    
    // Sort replacements by position in select_text to apply them in order
    const applicableReplacements = [];
    for (const [original, replacement] of replacementHistory.entries()) {
        const index = selectText.indexOf(original);
        if (index !== -1) {
            applicableReplacements.push({ original, replacement, index });
        }
    }
    
    // Sort by index (leftmost first) to apply replacements in order
    applicableReplacements.sort((a, b) => a.index - b.index);
    
    // Apply replacements from right to left to maintain indices
    for (let i = applicableReplacements.length - 1; i >= 0; i--) {
        const { original, replacement, index } = applicableReplacements[i];
        reconstructed = reconstructed.substring(0, index) + 
                       replacement + 
                       reconstructed.substring(index + original.length);
        madeChanges = true;
    }
    
    return {
        found: madeChanges,
        reconstructedText: reconstructed,
        index: -1 // Will be set by caller when searching in working content
    };
}

/**
 * Detect and deconflict overlapping replacements
 * When a replacement fails because it spans already-replaced segments, try to:
 * 1. Reconstruct what the select_text would look like now
 * 2. Find it in the current working content
 * 3. Apply the replacement to the reconstructed version
 * @param {string} selectText - The original select_text from AI
 * @param {string} workingContent - Current state of content after previous replacements
 * @param {Map} replacementHistory - Map tracking what has been replaced
 * @param {string} originalContent - The original unmodified content
 * @returns {Object} { found: boolean, textToReplace: string, index: number, usedDeconfliction: boolean }
 */
function deconflictOverlappingReplacement(selectText, workingContent, replacementHistory, originalContent) {
    // First, try to find the text directly
    let index = workingContent.indexOf(selectText);
    if (index !== -1) {
        return {
            found: true,
            textToReplace: selectText,
            index: index,
            usedDeconfliction: false
        };
    }
    
    // Not found directly - try to reconstruct it
    const reconstruction = tryReconstructSelectText(selectText, replacementHistory, originalContent);
    if (reconstruction.found && reconstruction.reconstructedText) {
        // Try to find the reconstructed text in working content
        index = workingContent.indexOf(reconstruction.reconstructedText);
        if (index !== -1) {
            console.log(`🔧 DECONFLICTION: Reconstructed "${selectText}" → "${reconstruction.reconstructedText}"`);
            return {
                found: true,
                textToReplace: reconstruction.reconstructedText,
                index: index,
                usedDeconfliction: true
            };
        }
    }
    
    // Still not found - check if any part of the select_text was replaced
    // and try to find a partial match
    for (const [original, replacement] of replacementHistory.entries()) {
        if (selectText.includes(original)) {
            // This select_text includes a segment that was already replaced
            // Try a simpler single replacement
            const partialReconstruction = selectText.replace(original, replacement);
            index = workingContent.indexOf(partialReconstruction);
            if (index !== -1) {
                console.log(`🔧 DECONFLICTION (partial): Reconstructed "${selectText}" → "${partialReconstruction}" (replaced "${original}" with "${replacement}")`);
                return {
                    found: true,
                    textToReplace: partialReconstruction,
                    index: index,
                    usedDeconfliction: true
                };
            }
        }
    }
    
    return {
        found: false,
        textToReplace: null,
        index: -1,
        usedDeconfliction: false
    };
}

function applyDynamicReplacements(originalContent, replacements, targetType = 'prompt', characterIndex = null, characterField = null) {
    let result = originalContent || '';
    
    // Define the append marker constant (must match imageGeneration.js)
    const APPEND_MARKER = '__ENSHUTSUKA_APPEND_POINT__';

    // Get the appropriate replacements array
    let targetReplacements = [];

    if (targetType === 'prompt') {
        targetReplacements = replacements.prompt || [];
    } else if (targetType === 'uc') {
        targetReplacements = replacements.uc || [];
    } else if (targetType === 'character' && characterIndex !== null && characterField) {
        const charReplacements = replacements.character_prompts?.[characterIndex];
        if (charReplacements) {
            // characterField can be 'prompt' or 'uc'
            targetReplacements = charReplacements[characterField] || [];
        }
    }

    // All replacements are now processed in order (no separate append phase)
    const allReplacements = targetReplacements.map(replacement => ({
        ...replacement,
        action: replacement.action || 'replace' // Default to replace for backward compatibility
    }));

    // Apply all replacements in order, allowing chaining but preventing exact duplicate applications
    const appliedReplacements = new Set();
    const failedReplacements = [];
    const replacementHistory = new Map(); // Track what was replaced with what
    const replacementMetadata = []; // Track which fallbacks were used

    for (const replacement of allReplacements) {
        let { select_text, replace_text, action: rawAction = 'replace', count, is_critical = true, fallback_select_text, alternative_text, replacement_category } = replacement;
        // Normalize action to lowercase for consistency
        const action = typeof rawAction === 'string' ? rawAction.toLowerCase() : rawAction;
        
        // 🎨 NEWLINE TRANSLATION: Convert <br> to \n
        // AI uses <br> for readability anywhere newlines are needed, server translates to actual newlines
        if (replace_text) {
            replace_text = replace_text.replace(/<br\s*\/?>/gi, '\n');
        }
        
        // Initialize metadata for this replacement
        const metadata = {
            original_select_text: select_text,
            used_fallback: false,
            used_alternative: false,
            actual_text_used: null,
            application_method: 'direct' // Track how it was applied: 'direct', 'fallback', or 'alternative'
        };
        const trimmedSelectText = select_text ? select_text.trim() : '';
        const replacementKey = `${action}|||${select_text || ''}|||${replace_text || ''}|||${count || 'all'}`;

        // Skip if we've already applied this exact replacement
        if (appliedReplacements.has(replacementKey)) {
            continue;
        }

        // ⚠️ VALIDATION: Check for incorrect append-to-end syntax
        if (action === 'append' && select_text) {
            const incorrectAppendPatterns = ['::append to end::', '::append::', '::end::'];
            if (incorrectAppendPatterns.includes(trimmedSelectText)) {
                console.warn(`⚠️  INCORRECT APPEND SYNTAX: Found "${trimmedSelectText}" for append action.`);
                console.warn(`    For append-to-end, OMIT the select_text field entirely.`);
                console.warn(`    Auto-correcting: treating as append-to-end`);
                // Auto-fix by clearing select_text to make it append-to-end
                replacement.select_text = undefined;
                // Re-set trimmedSelectText to empty for the rest of the processing
                const trimmedSelectText_fixed = '';
            }
        }

        // ⚠️ VALIDATION: Check for append with empty replace_text
        if (action === 'append' && (!replace_text || replace_text.trim() === '')) {
            console.warn(`⚠️  INVALID APPEND: Append action requires replace_text to be specified. Skipping.`);
            continue;
        }

        // 🚨 CRITICAL PROTECTION: NEVER allow replacements that would affect "artist:" tags
        // Check if select_text contains "artist:" (case-insensitive)
        if (trimmedSelectText && trimmedSelectText.toLowerCase().includes('artist:')) {
            console.warn(`🚫 BLOCKED REPLACEMENT: Attempted to ${action} text containing "artist:" - "${trimmedSelectText}". This is FORBIDDEN.`);
            continue; // Skip this replacement entirely
        }

        // 🛡️ PROTECTED BLOCK PROTECTION: NEVER allow replacements that would affect protected blocks
        // Check if select_text contains or overlaps with !% ... % blocks
        if (trimmedSelectText) {
            // Extract all protected blocks from the current result
            const protectedBlocks = [];
            const protectedRegex = /!%([^%]+)%/g;
            let protectedMatch;
            while ((protectedMatch = protectedRegex.exec(result)) !== null) {
                protectedBlocks.push({
                    fullMatch: protectedMatch[0],
                    content: protectedMatch[1].trim(),
                    start: protectedMatch.index,
                    end: protectedMatch.index + protectedMatch[0].length
                });
            }

            // Check if select_text overlaps with any protected block
            for (const block of protectedBlocks) {
                const selectStart = result.indexOf(trimmedSelectText);
                if (selectStart !== -1) {
                    const selectEnd = selectStart + trimmedSelectText.length;
                    // Check for overlap with protected block
                    if ((selectStart < block.end && selectEnd > block.start) ||
                        block.fullMatch.includes(trimmedSelectText) ||
                        trimmedSelectText.includes(block.fullMatch)) {
                        console.warn(`🛡️ BLOCKED REPLACEMENT: Attempted to ${action} text that overlaps with protected block "${block.fullMatch}" - "${trimmedSelectText}". Protected blocks cannot be modified.`);
                        continue; // Skip this replacement entirely
                    }
                }
            }
        }

        // 📍 INSERTION POINT PROTECTION: Be careful with ALL CAPS insertion markers and tag sections
        // Only allow replacements that preserve or enhance insertion points
        const insertionKeywords = ['TIME', 'WEATHER', 'SEASON', 'CLOTHING', 'ACTION', 'ENV'];
        if (trimmedSelectText && insertionKeywords.some(keyword => trimmedSelectText.includes(keyword))) {
            console.warn(`📍 CAUTION: Attempting to modify text containing insertion point "${trimmedSelectText}". Ensure this preserves the insertion marker.`);
        }

        // 🎯 TEXT BOUNDARY PROTECTION: Respect ", Text:" separator for overlay text
        // Only "Spelling" and "Text Overlay" categories can modify text after ", Text:"
        // All other replacements must stay BEFORE the ", Text:" boundary
        const canModifyAfterTextBoundary = replacement_category === 'Spelling' || replacement_category === 'Text Overlay';
        const textBoundaryIndex = result.indexOf(', Text:');
        
        // If there's a ", Text:" boundary and this replacement can't modify after it,
        // we need to restrict the search/replacement to only the text before the boundary
        let workingContent = result;
        let contentAfterBoundary = '';
        let hasBoundary = false;
        
        if (textBoundaryIndex !== -1 && !canModifyAfterTextBoundary) {
            // Split content at the boundary
            workingContent = result.substring(0, textBoundaryIndex);
            contentAfterBoundary = result.substring(textBoundaryIndex);
            hasBoundary = true;
        }

        // Additional check: if this is a delete or replace action, check if the text being removed contains artist tags
        if ((action === 'delete' || action === 'replace') && trimmedSelectText) {
            // Find where this text appears in the working content
            const index = workingContent.indexOf(trimmedSelectText);
            if (index !== -1) {
                // Check if there's an "artist:" tag within the text being removed
                const textToRemove = workingContent.substring(index, index + trimmedSelectText.length);
                if (textToRemove.toLowerCase().includes('artist:')) {
                    console.warn(`🚫 BLOCKED REPLACEMENT: Attempted to ${action} text segment containing "artist:" tag - "${textToRemove}". This is FORBIDDEN.`);
                    continue; // Skip this replacement entirely
                }
            }
        }

        // Handle legacy EOF support for backward compatibility
        if (select_text === 'EOF' && !replacement.action) {
            // Legacy EOF behavior - append to end (or before ", Text:" boundary)
            console.log(`📎 Applying legacy EOF append: adding "${replace_text}" to end`);
            if (!replace_text || replace_text.trim() === '') continue; // Skip empty appends

            // Legacy EOF always respects ", Text:" boundary (appends before it)
            const trimmedWorkingContent = workingContent.trimEnd();
            const needsComma = trimmedWorkingContent && (!trimmedWorkingContent.endsWith(',') || trimmedWorkingContent.endsWith('::'));
            workingContent = trimmedWorkingContent + (needsComma ? ', ' : ' ') + replace_text;
            
            // Reconstruct result with boundary protection
            result = hasBoundary ? workingContent + contentAfterBoundary : workingContent;
            
            appliedReplacements.add(replacementKey);
            continue;
        }

        if (action === 'delete') {
            // Check if this deletion was already successfully applied
            const deleteKey = `delete:${trimmedSelectText}`;
            if (appliedReplacements.has(deleteKey)) {
                console.log(`⏭️  Text "${trimmedSelectText}" was already deleted in a previous replacement, skipping`);
                continue;
            }

            console.log(`🗑️ Attempting deletion: "${trimmedSelectText}"${count ? ` (${count} occurrence(s))` : ' (all occurrences)'}`);

            let deleteCount = 0;
            let tempResult = workingContent;
            let startIndex = 0;
            let textToDelete = trimmedSelectText;
            let usedFallback = false;

            // Try primary select_text first
            while (true) {
                const index = tempResult.indexOf(textToDelete, startIndex);
                if (index === -1) break;

                // If count is specified, only delete that many occurrences
                if (count !== undefined && deleteCount >= count) break;

                tempResult = tempResult.substring(0, index) + tempResult.substring(index + textToDelete.length);
                deleteCount++;

                // Continue searching from the same position (in case of overlapping matches)
                startIndex = index;
            }

            // If primary failed and fallback exists, try fallback
            if (deleteCount === 0 && fallback_select_text) {
                const trimmedFallback = fallback_select_text.trim();
                console.log(`⚠️ Primary text not found, trying fallback: "${trimmedFallback}"`);
                textToDelete = trimmedFallback;
                tempResult = workingContent;
                startIndex = 0;
                usedFallback = true;

                while (true) {
                    const index = tempResult.indexOf(textToDelete, startIndex);
                    if (index === -1) break;

                    if (count !== undefined && deleteCount >= count) break;

                    tempResult = tempResult.substring(0, index) + tempResult.substring(index + textToDelete.length);
                    deleteCount++;
                    startIndex = index;
                }
            }
            
            // If both primary and fallback failed, try deconfliction
            if (deleteCount === 0) {
                console.log(`⚠️ Primary and fallback not found for deletion, attempting deconfliction...`);
                const deconflict = deconflictOverlappingReplacement(
                    trimmedSelectText,
                    workingContent,
                    replacementHistory,
                    originalContent
                );
                
                if (deconflict.found) {
                    console.log(`✅ Deconfliction successful for deletion, deleting "${deconflict.textToReplace}"`);
                    textToDelete = deconflict.textToReplace;
                    tempResult = workingContent;
                    startIndex = 0;
                    
                    while (true) {
                        const index = tempResult.indexOf(textToDelete, startIndex);
                        if (index === -1) break;
                        
                        if (count !== undefined && deleteCount >= count) break;
                        
                        tempResult = tempResult.substring(0, index) + tempResult.substring(index + textToDelete.length);
                        deleteCount++;
                        startIndex = index;
                    }
                    
                    if (deleteCount > 0) {
                        // Record metadata for deconfliction
                        metadata.used_fallback = false;
                        metadata.actual_text_used = textToDelete;
                        metadata.application_method = 'deconfliction';
                        replacement.used_deconfliction = true;
                        replacement.deconflicted_text = textToDelete;
                        replacement.application_method = 'deconfliction';
                    }
                }
            }

            if (deleteCount > 0) {
                // Reconstruct result with boundary protection
                result = hasBoundary ? tempResult + contentAfterBoundary : tempResult;
                // Update workingContent for next iteration
                workingContent = tempResult;
                console.log(`✅ Deleted "${textToDelete}" ${deleteCount} time(s)${usedFallback ? ' (using fallback)' : ''}`);
                
                // Mark this deletion as successfully applied (using special delete key)
                appliedReplacements.add(deleteKey);
                appliedReplacements.add(replacementKey);
                
                // Record metadata
                if (usedFallback) {
                    metadata.used_fallback = true;
                    metadata.actual_text_used = textToDelete;
                    metadata.application_method = 'fallback';
                    replacement.used_fallback = true;
                    replacement.actual_select_text = textToDelete;
                    replacement.application_method = 'fallback';
                } else {
                    replacement.application_method = 'direct';
                }
            } else {
                // If exact text not found for delete, only track if critical
                if (is_critical) {
                    console.error(`❌ CRITICAL: Could not find exact text "${select_text}" to delete in current result`);
                    failedReplacements.push(select_text);
                } else {
                    console.warn(`⚠️ OPTIONAL: Could not find text "${select_text}" to delete, skipping`);
                }
            }
        } else if (action === 'replace') {
            logger.verbose(`🔄 Attempting replacement: "${trimmedSelectText}" → "${replace_text}"`);

            let index = -1;
            let textToReplace = trimmedSelectText;
            let usedFallback = false;
            let replacementApplied = false;

            // 🎯 TAG SECTION HANDLING: If select_text is a keyword, look for tag section pattern
            const tagKeywords = ['TIME', 'WEATHER', 'SEASON', 'CLOTHING', 'ACTION', 'ENV'];

            if (tagKeywords.includes(trimmedSelectText)) {
                // Look for tag section pattern: KEYWORD%content%
                const tagRegex = new RegExp(`\\b${trimmedSelectText}%([^%]+)%`, 'g');
                const tagMatch = tagRegex.exec(workingContent);

                if (tagMatch) {
                    // Found tag section, replace the entire block
                    index = tagMatch.index;
                    textToReplace = tagMatch[0]; // The full "KEYWORD%content%" block
                    console.log(`🏷️ Found tag section "${textToReplace}" for keyword "${trimmedSelectText}", replacing entire block`);
                } else {
                    // No tag section found, fall back to replacing just the keyword
                    console.log(`🏷️ No tag section found for "${trimmedSelectText}", replacing standalone keyword`);
                    index = workingContent.indexOf(trimmedSelectText);
                }
            } else {
                // Normal replacement logic
                index = workingContent.indexOf(trimmedSelectText);
            }
            
            // If not found, check if this text was previously replaced
            if (index === -1 && replacementHistory.has(trimmedSelectText)) {
                const newText = replacementHistory.get(trimmedSelectText);
                console.log(`⚠️ Text "${trimmedSelectText}" was already replaced with "${newText}". Trying to find new text...`);
                index = workingContent.indexOf(newText);
                textToReplace = newText;
                
                if (index !== -1) {
                    console.log(`✅ Found the replaced version, applying replacement to it instead`);
                    workingContent = workingContent.substring(0, index) +
                            (replace_text || '') +
                            workingContent.substring(index + newText.length);
                    
                    // Update replacement history: the original maps to the final result
                    replacementHistory.set(trimmedSelectText, replace_text || '');
                    appliedReplacements.add(replacementKey);
                    replacementApplied = true;
                    // Reconstruct result with boundary protection
                    result = hasBoundary ? workingContent + contentAfterBoundary : workingContent;
                }
            } else if (index !== -1) {
                // Normal replacement
                workingContent = workingContent.substring(0, index) +
                        (replace_text || '') +  // Handle empty replace_text gracefully
                        workingContent.substring(index + trimmedSelectText.length);

                // Track this replacement
                replacementHistory.set(trimmedSelectText, replace_text || '');
                appliedReplacements.add(replacementKey);
                replacementApplied = true;
                // Reconstruct result with boundary protection
                result = hasBoundary ? workingContent + contentAfterBoundary : workingContent;
            }
            
            // If primary failed, try fallback
            if (!replacementApplied && fallback_select_text) {
                const trimmedFallback = fallback_select_text.trim();
                console.log(`⚠️ Primary text not found, trying fallback: "${trimmedFallback}"`);
                index = workingContent.indexOf(trimmedFallback);
                
                if (index !== -1) {
                    console.log(`✅ Found fallback text, applying replacement`);
                    workingContent = workingContent.substring(0, index) +
                            (replace_text || '') +
                            workingContent.substring(index + trimmedFallback.length);
                    
                    replacementHistory.set(trimmedFallback, replace_text || '');
                    appliedReplacements.add(replacementKey);
                    replacementApplied = true;
                    usedFallback = true;
                    // Reconstruct result with boundary protection
                    result = hasBoundary ? workingContent + contentAfterBoundary : workingContent;
                    
                    // Record metadata
                    metadata.used_fallback = true;
                    metadata.actual_text_used = trimmedFallback;
                    metadata.application_method = 'fallback';
                    replacement.used_fallback = true;
                    replacement.actual_select_text = trimmedFallback;
                    replacement.application_method = 'fallback';
                }
            }
            
            // If both primary and fallback failed, try deconfliction
            if (!replacementApplied) {
                console.log(`⚠️ Primary and fallback not found, attempting deconfliction...`);
                const deconflict = deconflictOverlappingReplacement(
                    trimmedSelectText,
                    workingContent,
                    replacementHistory,
                    originalContent
                );
                
                if (deconflict.found) {
                    console.log(`✅ Deconfliction successful, applying replacement to "${deconflict.textToReplace}"`);
                    workingContent = workingContent.substring(0, deconflict.index) +
                            (replace_text || '') +
                            workingContent.substring(deconflict.index + deconflict.textToReplace.length);
                    
                    // Track this replacement - map the ORIGINAL select_text to the final replacement
                    replacementHistory.set(trimmedSelectText, replace_text || '');
                    appliedReplacements.add(replacementKey);
                    replacementApplied = true;
                    // Reconstruct result with boundary protection
                    result = hasBoundary ? workingContent + contentAfterBoundary : workingContent;
                    
                    // Record metadata
                    metadata.used_fallback = false; // Not a fallback, it's deconfliction
                    metadata.actual_text_used = deconflict.textToReplace;
                    metadata.application_method = 'deconfliction';
                    replacement.used_deconfliction = true;
                    replacement.deconflicted_text = deconflict.textToReplace;
                    replacement.application_method = 'deconfliction';
                }
            }
            
            // If all attempts failed, check if optional with alternative
            if (!replacementApplied) {
                if (!is_critical && alternative_text) {
                    // Optional replacement failed, append alternative text instead
                    console.log(`⚠️ Optional replacement failed, appending alternative text: "${alternative_text}"`);
                    const trimmedWorkingContent = workingContent.trimEnd();
                    const needsComma = trimmedWorkingContent && !trimmedWorkingContent.endsWith(',') && !trimmedWorkingContent.endsWith('::');
                    workingContent = trimmedWorkingContent + (needsComma ? ', ' : ' ') + alternative_text;
                    // Reconstruct result with boundary protection
                    result = hasBoundary ? workingContent + contentAfterBoundary : workingContent;
                    appliedReplacements.add(replacementKey);
                    logger.verbose(`✅ Appended alternative text instead of replacing`);
                    // Record metadata
                    metadata.used_alternative = true;
                    metadata.actual_text_used = alternative_text;
                    metadata.application_method = 'alternative';
                    replacement.used_alternative = true;
                    replacement.alternative_text_used = alternative_text;
                    replacement.application_method = 'alternative';
                } else if (is_critical) {
                    // Critical replacement failed
                    console.error(`❌ CRITICAL: Could not find exact text "${select_text}" in current result`);
                    failedReplacements.push(select_text);
                } else {
                    // Optional replacement failed with no alternative
                    console.warn(`⚠️ OPTIONAL: Could not find text "${select_text}" to replace, skipping`);
                }
            } else if (usedFallback) {
                console.log(`✅ Replacement successful using fallback text`);
            } else {
                // Direct replacement successful
                replacement.application_method = 'direct';
            }
        } else if (action === 'append') {
            logger.verbose(`📎 Attempting append: insert "${replace_text.substring(0, 50)}${replace_text.length > 50 ? '...' : ''}"${select_text ? ` after "${trimmedSelectText.substring(0, 30)}${trimmedSelectText.length > 30 ? '...' : ''}"` : ' at end'}`);

            let insertPosition;
            let usedFallback = false;
            let positionFound = false;
            let textToAppend = replace_text;
            
            if (select_text && select_text.trim()) {
                // If select_text is provided, try to find it and insert after it
                let index = workingContent.indexOf(trimmedSelectText);
                
                // If not found, check if this text was previously replaced
                if (index === -1 && replacementHistory.has(trimmedSelectText)) {
                    const newText = replacementHistory.get(trimmedSelectText);
                    console.log(`⚠️ Text "${trimmedSelectText}" was already replaced with "${newText}". Looking for new text...`);
                    index = workingContent.indexOf(newText);
                    
                    if (index !== -1) {
                        insertPosition = index + newText.length;
                        console.log(`✅ Found the replaced version, appending after it`);
                        positionFound = true;
                    }
                } else if (index !== -1) {
                    insertPosition = index + trimmedSelectText.length;
                    console.log(`✅ Found "${trimmedSelectText}", appending after it`);
                    positionFound = true;
                }
                
                // If primary failed, try fallback
                if (!positionFound && fallback_select_text) {
                    const trimmedFallback = fallback_select_text.trim();
                    console.log(`⚠️ Primary text not found, trying fallback: "${trimmedFallback}"`);
                    index = workingContent.indexOf(trimmedFallback);
                    
                    if (index !== -1) {
                        insertPosition = index + trimmedFallback.length;
                        console.log(`✅ Found fallback text, appending after it`);
                        positionFound = true;
                        usedFallback = true;
                        
                        // Record metadata
                        metadata.used_fallback = true;
                        metadata.actual_text_used = trimmedFallback;
                        metadata.application_method = 'fallback';
                        replacement.used_fallback = true;
                        replacement.actual_select_text = trimmedFallback;
                        replacement.application_method = 'fallback';
                    }
                }
                
                // If both primary and fallback failed, try deconfliction
                if (!positionFound) {
                    console.log(`⚠️ Primary and fallback not found for append, attempting deconfliction...`);
                    const deconflict = deconflictOverlappingReplacement(
                        trimmedSelectText,
                        workingContent,
                        replacementHistory,
                        originalContent
                    );
                    
                    if (deconflict.found) {
                        console.log(`✅ Deconfliction successful for append, inserting after "${deconflict.textToReplace}"`);
                        insertPosition = deconflict.index + deconflict.textToReplace.length;
                        positionFound = true;
                        
                        // Record metadata
                        metadata.used_fallback = false;
                        metadata.actual_text_used = deconflict.textToReplace;
                        metadata.application_method = 'deconfliction';
                        replacement.used_deconfliction = true;
                        replacement.deconflicted_text = deconflict.textToReplace;
                        replacement.application_method = 'deconfliction';
                    }
                }
                
                // If all attempts failed, fall back to end and use alternative if available
                if (!positionFound) {
                    console.log(`⚠️ Could not find "${trimmedSelectText}"${fallback_select_text ? ' or fallback' : ''}, falling back to end of prompt`);
                    insertPosition = workingContent.length;
                    
                    // Use alternative_text if provided for optional replacements
                    if (!is_critical && alternative_text) {
                        console.log(`⚠️ Using alternative text for optional append: "${alternative_text}"`);
                        textToAppend = alternative_text;
                        
                        // Record metadata
                        metadata.used_alternative = true;
                        metadata.actual_text_used = alternative_text;
                        metadata.application_method = 'alternative';
                        replacement.used_alternative = true;
                        replacement.alternative_text_used = alternative_text;
                        replacement.application_method = 'alternative';
                    }
                }
            } else {
                // No select_text provided, append to end
                // Look for the append marker to insert before presets
                const markerIndex = workingContent.indexOf(APPEND_MARKER);
                if (markerIndex !== -1) {
                    // Found marker, insert before it
                    insertPosition = markerIndex;
                    // Check if there's a comma before the marker that we should remove
                    if (insertPosition > 2 && workingContent.substring(insertPosition - 2, insertPosition) === ', ') {
                        insertPosition -= 2; // Remove the comma and space before marker
                    }
                    logger.verbose(`📍 Found append marker, inserting before presets`);
                } else {
                    // No marker found, append to end (fallback)
                    insertPosition = workingContent.length;
                }
            }

            // Insert at the determined position
            const needsComma = insertPosition > 0 && workingContent[insertPosition - 1] !== ',' && workingContent[insertPosition - 1] !== ' ';
            const separator = needsComma && insertPosition > 0 ? ', ' : '';
            workingContent = workingContent.substring(0, insertPosition) +
                    separator + (textToAppend || '') +
                    workingContent.substring(insertPosition);

            // Reconstruct result with boundary protection
            result = hasBoundary ? workingContent + contentAfterBoundary : workingContent;

            appliedReplacements.add(replacementKey);
            logger.verbose(`✅ Appended "${textToAppend.substring(0, 50)}${textToAppend.length > 50 ? '...' : ''}"${select_text ? (positionFound ? (usedFallback ? ' after fallback' : ` after "${trimmedSelectText.substring(0, 30)}..."`) : ' at end (fallback)') : ' at end'}`);
            
            // Set application_method if not already set
            if (!replacement.application_method) {
                replacement.application_method = 'direct';
            }
        }
        
        // Add metadata to tracking array
        replacementMetadata.push(metadata);
    }

    // Return success object instead of throwing error
    // This allows the caller to handle failures (e.g., retry with correction)
    if (failedReplacements.length > 0) {
        console.error(`❌ Text replacement validation FAILED: Could not find ${failedReplacements.length} target text(s): ${failedReplacements.join(', ')}`);
        return {
            success: false,
            result: result,
            failedReplacements: failedReplacements
        };
    }

    return {
        success: true,
        result: result,
        failedReplacements: []
    };
}

/**
 * Calculate holiday intensity based on proximity to the holiday date
 * @param {number} daysUntil - Days until the holiday (negative = past, positive = future)
 * @param {number} bufferDays - Total buffer period for the holiday
 * @returns {Object} Intensity information with level and description
 */
function calculateHolidayIntensity(daysUntil, bufferDays) {
    const absDays = Math.abs(daysUntil);

    // Define intensity levels based on position within the buffer period
    let intensityConfig;

    if (daysUntil > bufferDays) {
        // Far before the buffer period starts
        intensityConfig = HOLIDAY_INTENSITY_LEVELS.MINIMAL;
    } else if (daysUntil > Math.floor(bufferDays * HOLIDAY_BUFFER_THRESHOLDS.EARLY_PHASE)) {
        // Early in buffer period (first 25%)
        intensityConfig = HOLIDAY_INTENSITY_LEVELS.EARLY;
    } else if (daysUntil > Math.floor(bufferDays * HOLIDAY_BUFFER_THRESHOLDS.BUILDING_PHASE)) {
        // Middle of buffer period (25-50%)
        intensityConfig = HOLIDAY_INTENSITY_LEVELS.BUILDING;
    } else if (daysUntil > Math.floor(bufferDays * HOLIDAY_BUFFER_THRESHOLDS.STRONG_PHASE)) {
        // Later in buffer period (50-75%)
        intensityConfig = HOLIDAY_INTENSITY_LEVELS.STRONG;
    } else if (daysUntil >= HOLIDAY_BUFFER_THRESHOLDS.PEAK_PHASE) {
        // Peak period (last 25% before + 3 days after)
        intensityConfig = HOLIDAY_INTENSITY_LEVELS.PEAK;
    } else if (daysUntil >= HOLIDAY_BUFFER_THRESHOLDS.EXTENDED_PHASE) {
        // Extended after period (4-7 days after)
        intensityConfig = HOLIDAY_INTENSITY_LEVELS.EXTENDED;
    } else {
        // Far after (more than 1 week past)
        intensityConfig = HOLIDAY_INTENSITY_LEVELS.FADING;
    }

    return {
        level: intensityConfig.level,
        description: intensityConfig.description,
        elementMultiplier: intensityConfig.multiplier,
        daysUntil: daysUntil,
        position: daysUntil > 0 ? 'before' : 'after'
    };
}

/**
 * Maps a date from one season to its equivalent position in another season
 * @param {Object} time - Current time information {month, dayOfMonth, year}
 * @param {string} targetSeason - Target season ('spring', 'summer', 'autumn', 'winter')
 * @returns {Object} Mapped time information {month, dayOfMonth, year}
 */
function mapDateToSeason(time, targetSeason) {
    const { month, dayOfMonth, year } = time;

    // Define season boundaries (approximate astronomical seasons)
    const seasonBoundaries = {
        spring: { start: { month: 2, day: 20 }, end: { month: 5, day: 20 } }, // Mar 20 - Jun 20
        summer: { start: { month: 5, day: 21 }, end: { month: 8, day: 22 } }, // Jun 21 - Sep 22
        autumn: { start: { month: 8, day: 23 }, end: { month: 11, day: 20 } }, // Sep 23 - Dec 20
        winter: { start: { month: 11, day: 21 }, end: { month: 2, day: 19 } }  // Dec 21 - Mar 19
    };

    // Get current season boundaries
    const currentSeason = getCurrentSeason(month, 0); // latitude doesn't matter for date mapping
    const currentBounds = seasonBoundaries[currentSeason];
    const targetBounds = seasonBoundaries[targetSeason];

    if (!currentBounds || !targetBounds) {
        console.warn(`⚠️ Invalid season mapping: current=${currentSeason}, target=${targetSeason}`);
        return time; // Return original time if mapping fails
    }

    // Calculate day of year for current date
    const currentDate = new Date(year, month, dayOfMonth);
    const yearStart = new Date(year, 0, 1);
    const currentDayOfYear = Math.floor((currentDate - yearStart) / (1000 * 60 * 60 * 24)) + 1;

    // Calculate day of year for season start/end
    const seasonStartDate = new Date(year, currentBounds.start.month, currentBounds.start.day);
    const seasonEndDate = new Date(year, currentBounds.end.month, currentBounds.end.day);

    // Handle winter spanning year boundary
    if (currentSeason === 'winter' && month <= 2) {
        seasonStartDate.setFullYear(year - 1);
    }
    if (currentSeason === 'winter' && month <= 2) {
        seasonEndDate.setFullYear(year);
    }

    const seasonStartDay = Math.floor((seasonStartDate - yearStart) / (1000 * 60 * 60 * 24)) + 1;
    let seasonEndDay = Math.floor((seasonEndDate - yearStart) / (1000 * 60 * 60 * 24)) + 1;

    // Handle year boundary for winter
    if (seasonEndDay < seasonStartDay) {
        seasonEndDay += 365 + (year % 4 === 0 ? 1 : 0); // Add days in year
    }

    const seasonLength = seasonEndDay - seasonStartDay;
    const positionInSeason = currentDayOfYear - seasonStartDay;

    // Calculate position ratio (0.0 to 1.0)
    const positionRatio = Math.max(0, Math.min(1, positionInSeason / seasonLength));

    // Map to target season
    const targetStartDate = new Date(year, targetBounds.start.month, targetBounds.start.day);
    const targetEndDate = new Date(year, targetBounds.end.month, targetBounds.end.day);

    // Handle winter spanning year boundary for target
    if (targetSeason === 'winter' && targetBounds.end.month <= 2) {
        targetEndDate.setFullYear(year + 1);
    }

    const targetStartDay = Math.floor((targetStartDate - yearStart) / (1000 * 60 * 60 * 24)) + 1;
    let targetEndDay = Math.floor((targetEndDate - yearStart) / (1000 * 60 * 60 * 24)) + 1;

    // Handle year boundary for winter target
    if (targetEndDay < targetStartDay) {
        targetEndDay += 365 + (year % 4 === 0 ? 1 : 0);
    }

    const targetDayOfYear = Math.round(targetStartDay + (positionRatio * (targetEndDay - targetStartDay)));

    // Convert back to month/day
    const mappedDate = new Date(year, 0, targetDayOfYear);
    const mappedMonth = mappedDate.getMonth();
    const mappedDayOfMonth = mappedDate.getDate();

    console.log(`🌸 Season Date Mapping: ${currentSeason} ${month + 1}/${dayOfMonth} (day ${currentDayOfYear}) → ${targetSeason} ${mappedMonth + 1}/${mappedDayOfMonth} (ratio: ${(positionRatio * 100).toFixed(1)}%)`);

    return {
        ...time,
        month: mappedMonth,
        dayOfMonth: mappedDayOfMonth
    };
}

/**
 * Process seasonal configuration and return standardized seasonal settings
 * @param {boolean|number|string} seasonal - Seasonal mode configuration
 * @param {Object} time - Current time information
 * @returns {Object} Processed seasonal configuration
 */
// Simplified seasonal configuration - returns just the essential info
function getSeasonalConfig(seasonal, time) {
    // Default: no seasonal modifications
    if (!seasonal || seasonal === false || seasonal === 'false') {
        return { enabled: false };
    }

    // Boolean true or string "true": enable current season detection
    if (seasonal === true || seasonal === 'true') {
        return { enabled: true, type: 'current' };
    }

    // Numeric values
    if (typeof seasonal === 'number') {
        if (seasonal >= 1 && seasonal <= 4) {
            // Specific season override (1=Spring, 2=Summer, 3=Autumn, 4=Winter)
            const seasons = ['spring', 'summer', 'autumn', 'winter'];
            return { enabled: true, type: 'season', value: seasons[seasonal - 1] };
        }
        // Holiday indices 10-27 removed - holidays now handled through TOD system
    }

    // Fallback: disabled
    return { enabled: false };
}

// Helper function to find closest holiday
function findClosestHoliday(time) {
    const { month, dayOfMonth, year } = time;
    let closest = null;
    let minDistance = Infinity;

    Object.entries(HOLIDAY_DATA).forEach(([id, holiday]) => {
        let daysUntil = 0;

        if (typeof holiday.dateLogic === 'function') {
            // Handle dynamic dates (Memorial Day, Labor Day, etc.)
            if (holiday.dateLogic === HOLIDAY_DATA[18].dateLogic) { // Memorial Day
                const memorialDay = new Date(year, 4, 31);
                memorialDay.setDate(memorialDay.getDate() - memorialDay.getDay());
                daysUntil = getDaysUntil(memorialDay.getMonth(), memorialDay.getDate(), month, dayOfMonth, year);
            } else if (holiday.dateLogic === HOLIDAY_DATA[19].dateLogic) { // Labor Day
                const laborDay = new Date(year, 8, 1);
                laborDay.setDate(laborDay.getDate() + (7 - laborDay.getDay()));
                daysUntil = getDaysUntil(laborDay.getMonth(), laborDay.getDate(), month, dayOfMonth, year);
            } else {
                // Standard date logic
                daysUntil = holiday.targetDay ? getDaysUntil(holiday.targetMonth, holiday.targetDay, month, dayOfMonth, year) : 0;
            }
        }

        // Skip holidays that are more than 7 days in the past
        if (daysUntil < -7) {
            return; // Skip this holiday
        }

        const distance = Math.abs(daysUntil);
        if (distance < minDistance) {
            minDistance = distance;
            closest = { id: parseInt(id), name: HOLIDAY_NAMES[id], daysUntil };
        }
    });

    return closest;
}

/**
 * Get the date for a specific holiday name
 * @param {string} holidayName - Name of the holiday
 * @returns {Date|null} Date object for the holiday, or null if not found
 */
function getHolidayDate(holidayName) {
    const now = new Date();
    const year = now.getFullYear();

    // Find the holiday by name
    const holidayEntry = Object.entries(HOLIDAY_DATA).find(([id, holiday]) => holiday.name === holidayName);
    if (!holidayEntry) return null;

    const [id, holiday] = holidayEntry;
    let holidayDate;

    if (typeof holiday.dateLogic === 'function') {
        // Handle dynamic dates (Memorial Day, Labor Day, etc.)
        if (holiday.dateLogic === HOLIDAY_DATA[18].dateLogic) { // Memorial Day
            const memorialDay = new Date(year, 4, 31);
            memorialDay.setDate(memorialDay.getDate() - memorialDay.getDay());
            holidayDate = memorialDay;
        } else if (holiday.dateLogic === HOLIDAY_DATA[19].dateLogic) { // Labor Day
            const laborDay = new Date(year, 8, 1);
            laborDay.setDate(laborDay.getDate() + (7 - laborDay.getDay()));
            holidayDate = laborDay;
        } else {
            // Standard fixed date
            if (holiday.targetMonth !== undefined && holiday.targetDay !== undefined) {
                holidayDate = new Date(year, holiday.targetMonth, holiday.targetDay);
            }
        }
    } else {
        // Standard fixed date
        if (holiday.targetMonth !== undefined && holiday.targetDay !== undefined) {
            holidayDate = new Date(year, holiday.targetMonth, holiday.targetDay);
        }
    }

    if (!holidayDate) return null;

    // Handle future dates: if holiday hasn't occurred this year yet, use last year's date
    // Exception: if we're within 7 days of the holiday, use this year's date
    const daysUntilHoliday = Math.ceil((holidayDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilHoliday > 7) {
        // Holiday is more than 7 days away - use last year's date for historical weather
        holidayDate = new Date(holidayDate.getFullYear() - 1, holidayDate.getMonth(), holidayDate.getDate());
    }
    // If within 7 days or already passed, use the current year date

    return holidayDate;
}

/**
 * Validate holiday data structure for consistency
 * @param {Object} holidayData - Holiday data to validate
 * @returns {boolean} Whether the data structure is valid
 */
function validateHolidayData(holidayData) {
    const requiredFields = ['name', 'region', 'priority', 'bufferDays', 'dateLogic', 'decorations', 'atmosphere', 'colors', 'activities'];

    for (const field of requiredFields) {
        if (!(field in holidayData)) {
            console.warn(`⚠️ Holiday data missing required field: ${field}`);
            return false;
        }
    }

    if (typeof holidayData.dateLogic !== 'function') {
        console.warn(`⚠️ Holiday dateLogic must be a function`);
        return false;
    }

    if (typeof holidayData.bufferDays !== 'number' || holidayData.bufferDays < 0) {
        console.warn(`⚠️ Holiday bufferDays must be a non-negative number`);
        return false;
    }

    return true;
}

/**
 * Initialize and validate holiday data
 */
function initializeHolidayData() {
    let validHolidays = 0;
    let invalidHolidays = 0;

    Object.entries(HOLIDAY_DATA).forEach(([id, data]) => {
        if (validateHolidayData(data)) {
            validHolidays++;
        } else {
            console.error(`❌ Invalid holiday data for ID ${id}: ${data.name || 'Unknown'}`);
            invalidHolidays++;
        }
    });

    if (invalidHolidays > 0) {
        logger.warn(`Holiday data validation: ${validHolidays} valid, ${invalidHolidays} invalid`);
    }
    return invalidHolidays === 0;
}

// Validate holiday data on module load
const holidayDataValid = initializeHolidayData();
if (!holidayDataValid) {
    console.warn('⚠️ Some holiday data is invalid. System may not work correctly for those holidays.');
}

/**
 * Make HTTPS request with promise and retry logic
 * @param {string} url - Request URL
 * @param {Object} options - Additional request options
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} baseDelay - Base delay in milliseconds for exponential backoff (default: 1000)
 * @returns {Promise<Object>} Parsed JSON response
 */
async function makeHttpsRequest(url, options = {}, maxRetries = 3, baseDelay = 1000) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await new Promise((resolve, reject) => {
                const requestOptions = {
                    headers: {
                        'User-Agent': config?.userAgent || 'StaticForge/1.1a (https://staticforge.app)',
                        ...options.headers
                    },
                    timeout: 5000 // 10 second timeout
                };

                const req = https.get(url, requestOptions, (res) => {
                    let data = '';

                    res.on('data', (chunk) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        try {
                            if (res.statusCode === 200) {
                                resolve(JSON.parse(data));
                            } else if (res.statusCode >= 500 && attempt < maxRetries) {
                                // Server errors - retry
                                reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                            } else {
                                // Client errors or final attempt - don't retry
                                reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                            }
                        } catch (e) {
                            reject(new Error(`Failed to parse response: ${e.message}`));
                        }
                    });
                });

                req.on('error', (err) => {
                    reject(err);
                });

                // Handle timeout
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Request timeout'));
                });
            });

            return result;

        } catch (error) {
            lastError = error;

            // Don't retry on client errors (4xx) or if this is the last attempt
            if (error.message.includes('HTTP 4') || attempt === maxRetries) {
                break;
            }

            // Calculate exponential backoff delay with jitter
            const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
            console.warn(`🌐 API request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}. Retrying in ${Math.round(delay)}ms...`);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // All retries exhausted
    console.error(`❌ API request failed after ${maxRetries + 1} attempts:`, lastError.message);
    throw lastError;
}

/**
 * Get cached location data or fetch new data
 * @param {Function} fetchFunction - Function to fetch new location data
 * @returns {Promise<Object>} Location data
 */
async function getCachedLocation(fetchFunction) {
    const cacheKey = 'user_location';
    const cached = locationCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < LOCATION_CACHE_DURATION) {
        console.log('📍 Using cached location data');
        return cached.data;
    }

    console.log('📍 Fetching fresh location data');
    const data = await fetchFunction();
    locationCache.set(cacheKey, {
        data,
        timestamp: Date.now()
    });

    return data;
}

/**
 * Get cached weather data or fetch new data
 * @param {string} cacheKey - Cache key for the weather data
 * @param {Function} fetchFunction - Function to fetch new data if cache is stale
 * @returns {Promise<Object>} Weather data
 */
async function getCachedWeatherData(cacheKey, fetchFunction) {
    const cached = weatherCache.get(cacheKey);

    if (cached) {
        const cacheAge = Date.now() - cached.timestamp;

        // If we have valid cached data, return it
        if (cached.data !== null && cacheAge < WEATHER_CACHE_DURATION) {
            console.log(`🌤️ Using cached weather data for ${cacheKey}`);
            return cached.data;
        }

        // If this is a failure cache and it's still within the failure cache duration, don't retry
        if (cached.data === null && cacheAge < WEATHER_FAILURE_CACHE_DURATION) {
            console.log(`⚠️ Skipping weather API call for ${cacheKey} - previous failure cached (${Math.round((WEATHER_FAILURE_CACHE_DURATION - cacheAge) / 60000)} min remaining)`);
            return null;
        }
    }

    console.log(`🌤️ Fetching fresh weather data for ${cacheKey}`);
    const data = await fetchFunction();

    // Cache the result - use longer duration for failures to prevent rapid retries
    weatherCache.set(cacheKey, {
        data,
        timestamp: Date.now(),
        isFailure: data === null
    });

    if (data === null) {
        console.log(`❌ Weather API call failed for ${cacheKey} - will not retry for ${Math.round(WEATHER_FAILURE_CACHE_DURATION / 60000)} minutes`);
    }

    return data;
}

/**
 * Get current location based on IP address or configured coordinates
 * @returns {Promise<Object>} Location data with lat, lon, city, country
 */
async function getCurrentLocation() {
    // Check for configured latitude/longitude first
    try {
        const secureConfig = require('../secure.config.json');
        if (secureConfig.location && secureConfig.location.latitude !== null && secureConfig.location.longitude !== null) {
            const lat = parseFloat(secureConfig.location.latitude);
            const lon = parseFloat(secureConfig.location.longitude);
            const accurateTimezone = getTimezoneByCoordinates(lat, lon);
            console.log('📍 Using configured coordinates from secure.config.json');
            return {
                lat: lat,
                lon: lon,
                city: 'Configured Location',
                country: 'Configured',
                timezone: accurateTimezone,
                configured: true
            };
        }
    } catch (error) {
        console.warn('⚠️ Could not load secure config for location, falling back to IP detection:', error.message);
    }

    return getCachedLocation(async () => {
        // Try multiple location services with fallbacks
        const services = [
            {
                name: 'ipinfo.io',
                url: 'https://ipinfo.io/json',
                parse: (response) => {
                    const [lat, lon] = response.loc ? response.loc.split(',') : [null, null];
                    return {
                        lat: parseFloat(lat),
                        lon: parseFloat(lon),
                        city: response.city,
                        country: response.country,
                        timezone: response.timezone
                    };
                }
            },
            {
                name: 'ip-api.com',
                url: 'http://ip-api.com/json/',
                parse: (response) => ({
                    lat: response.lat,
                    lon: response.lon,
                    city: response.city,
                    country: response.country,
                    timezone: response.timezone
                })
            },
            {
                name: 'ipapi.co',
                url: 'https://ipapi.co/json/',
                parse: (response) => ({
                    lat: response.latitude,
                    lon: response.longitude,
                    city: response.city,
                    country: response.country_name,
                    timezone: response.timezone
                })
            }
        ];

        for (const service of services) {
            try {
                console.log(`🌍 Trying location service: ${service.name}`);
                const response = await makeHttpsRequest(service.url);

                // Check if response is valid
                if (response && typeof response === 'object') {
                    const location = service.parse(response);
                    if (location && location.lat && location.lon) {
                        // Use offline timezone lookup for accurate timezone determination
                        const accurateTimezone = getTimezoneByCoordinates(location.lat, location.lon);
                        location.timezone = accurateTimezone;
                        console.log(`✅ Got location from ${service.name}: ${location.city}, ${location.country} (timezone: ${accurateTimezone})`);
                        return location;
                    }
                }
            } catch (error) {
                console.warn(`⚠️ ${service.name} failed:`, error.message);
                continue;
            }
        }

        console.warn('⚠️ All location services failed, using fallback location');
        // Fallback to a default location
        const fallbackLat = 40.7128;
        const fallbackLon = -74.0060;
        const accurateTimezone = getTimezoneByCoordinates(fallbackLat, fallbackLon);
        return {
            lat: fallbackLat,
            lon: fallbackLon,
            city: 'New York',
            country: 'United States',
            timezone: accurateTimezone
        };
    });
}

/**
 * Get descriptive wind condition based on wind speed
 * @param {number} windSpeedMs - Wind speed in meters per second
 * @returns {string} Descriptive wind condition
 */
function getWindConditionDescription(windSpeedMs) {
    // Convert m/s to mph for US weather standards
    const windSpeedMph = windSpeedMs * 2.237;

    if (windSpeedMph >= 65) {
        return 'dangerous winds - high wind warning conditions';
    } else if (windSpeedMph >= 50) {
        return 'very strong winds - high wind warning';
    } else if (windSpeedMph >= 40) {
        return 'strong winds - potential blizzard conditions';
    } else if (windSpeedMph >= 35) {
        return 'moderate to strong winds - wind advisory';
    } else if (windSpeedMph >= 30) {
        return 'fresh winds - breezy conditions';
    } else if (windSpeedMph >= 25) {
        return 'moderate winds - noticeable breeze';
    } else if (windSpeedMph >= 15) {
        return 'light winds - gentle breeze';
    } else {
        return 'calm winds - minimal air movement';
    }
}

/**
 * Detect seasonal holidays and events based on date with buffer periods
 * @param {Object} time - Time object with month, day, year
 * @param {string} season - Current season
 * @returns {Object} Holiday detection results with buffer handling
 */
function detectSeasonalHolidays(time) {
    const { month, dayOfMonth, monthName, dayOfWeekName, year } = time;
    const holidays = [];

    // Check each holiday in the centralized data
    Object.entries(HOLIDAY_DATA).forEach(([holidayId, holidayData]) => {
        let isActive = false;
        let daysUntil = 0;

        // Handle dynamic date calculations (like Memorial Day, Labor Day)
        if (typeof holidayData.dateLogic === 'function') {
            if (holidayData.dateLogic === HOLIDAY_DATA[18].dateLogic) { // Memorial Day
                const memorialDay = new Date(year, 4, 31);
                memorialDay.setDate(memorialDay.getDate() - memorialDay.getDay());
                isActive = isWithinBuffer(memorialDay.getMonth(), memorialDay.getDate(), holidayData.bufferDays, month, dayOfMonth, year);
                daysUntil = getDaysUntil(memorialDay.getMonth(), memorialDay.getDate(), month, dayOfMonth, year);
            } else if (holidayData.dateLogic === HOLIDAY_DATA[19].dateLogic) { // Labor Day
                const laborDay = new Date(year, 8, 1);
                laborDay.setDate(laborDay.getDate() + (7 - laborDay.getDay()));
                isActive = isWithinBuffer(laborDay.getMonth(), laborDay.getDate(), holidayData.bufferDays, month, dayOfMonth, year);
                daysUntil = getDaysUntil(laborDay.getMonth(), laborDay.getDate(), month, dayOfMonth, year);
            } else {
                // Standard date logic
                isActive = holidayData.dateLogic(month, dayOfMonth, year);
                daysUntil = holidayData.targetDay ? getDaysUntil(holidayData.targetMonth, holidayData.targetDay, month, dayOfMonth, year) : 0;
            }
        }

        if (isActive) {
            // Calculate holiday intensity based on proximity
            const intensity = calculateHolidayIntensity(daysUntil, holidayData.bufferDays);

            holidays.push({
                name: holidayData.name,
                decorations: holidayData.decorations,
                atmosphere: holidayData.atmosphere,
                colors: holidayData.colors,
                activities: holidayData.activities,
                priority: holidayData.priority,
                daysUntil: daysUntil,
                region: holidayData.region,
                id: parseInt(holidayId),
                intensity: intensity,
                bufferDays: holidayData.bufferDays
            });
        }
    });

    // Handle overlapping holidays - select the closest one
    const sortedHolidays = holidays
        .sort((a, b) => Math.abs(a.daysUntil) - Math.abs(b.daysUntil))
        .slice(0, 2); // Keep top 2 closest holidays

    const primaryHoliday = sortedHolidays[0] || null;
    const secondaryHoliday = sortedHolidays[1] || null;

    return {
        holidays: sortedHolidays,
        isHolidayPeriod: sortedHolidays.length > 0,
        primaryHoliday: primaryHoliday,
        secondaryHoliday: secondaryHoliday,
        holidayDecorations: sortedHolidays.flatMap(h => h.decorations.split(', ')),
        holidayAtmosphere: sortedHolidays.flatMap(h => h.atmosphere.split(', ')),
        holidayColors: sortedHolidays.flatMap(h => h.colors.split(', ')),
        region: primaryHoliday?.region || 'Universal',
        // Progressive holiday elements based on intensity
        progressiveElements: primaryHoliday ? generateProgressiveHolidayElements(primaryHoliday) : null
    };
}

/**
 * Generate progressive holiday elements based on intensity level
 * @param {Object} holiday - Holiday object with intensity information
 * @returns {Object} Progressive holiday elements for AI consumption
 */
function generateProgressiveHolidayElements(holiday) {
    const { intensity, decorations, atmosphere, colors, activities } = holiday;
    const { level, elementMultiplier, description, daysUntil } = intensity;

    // Split elements into arrays
    const allDecorations = decorations.split(', ');
    const allAtmosphere = atmosphere.split(', ');
    const allColors = colors.split(', ');
    const allActivities = activities ? activities.split(', ') : [];

    // Calculate how many elements to include based on intensity
    const numDecorations = Math.max(1, Math.ceil(allDecorations.length * elementMultiplier));
    const numAtmosphere = Math.max(1, Math.ceil(allAtmosphere.length * elementMultiplier));
    const numColors = Math.max(1, Math.ceil(allColors.length * elementMultiplier));
    const numActivities = Math.max(1, Math.ceil(allActivities.length * elementMultiplier));

    // Select elements based on intensity level
    const selectedDecorations = allDecorations.slice(0, numDecorations);
    const selectedAtmosphere = allAtmosphere.slice(0, numAtmosphere);
    const selectedColors = allColors.slice(0, numColors);
    const selectedActivities = allActivities.slice(0, numActivities);

    // Generate intensity-specific guidance
    let guidanceText;
    switch (level) {
        case 'minimal':
            guidanceText = `Very subtle ${description} - include only 1-2 holiday hints that blend naturally with the scene`;
            break;
        case 'early':
            guidanceText = `Early ${description} - add gentle holiday touches that create anticipation`;
            break;
        case 'building':
            guidanceText = `Building ${description} - incorporate moderate holiday elements to build excitement`;
            break;
        case 'strong':
            guidanceText = `Strong ${description} - prominently feature holiday elements while maintaining scene coherence`;
            break;
        case 'peak':
            guidanceText = `Peak holiday immersion - fully integrate all holiday elements for maximum festive impact`;
            break;
        case 'extended':
            guidanceText = `Extended celebration - sustain holiday elements with slightly reduced intensity`;
            break;
        case 'fading':
            guidanceText = `Fading ${description} - include residual holiday elements that are winding down`;
            break;
        default:
            guidanceText = `Holiday elements with ${description}`;
    }

    return {
        level: level,
        description: description,
        elementMultiplier: elementMultiplier,
        daysUntil: daysUntil,
        guidance: guidanceText,
        decorations: selectedDecorations,
        atmosphere: selectedAtmosphere,
        colors: selectedColors,
        activities: selectedActivities,
        // Summary for AI consumption
        elementSummary: `Holiday intensity: ${level} (${description}). Include ${numDecorations} decorations, ${numAtmosphere} atmosphere elements, ${numColors} colors.`
    };
}

/**
 * Generate seasonal environmental modifications
 * @param {Object} time - Time object
 * @param {string} season - Current season
 * @param {boolean} seasonalEnabled - Whether seasonal modifications are enabled
 * @param {string} forcedHoliday - Specific holiday to force (optional)
 * @param {Object} weather - Weather data (optional)
 * @param {boolean} disableHoliday - Whether to disable holiday observation (optional)
 * @returns {Object} Seasonal modification guidelines
 */
function generateSeasonalGuidelines(time, season, seasonalEnabled, forcedHoliday = null, weather = null, disableHoliday = false) {
    // Check for time-based conflicts that would make seasonal elements inappropriate
    const isNightTime = time && (time.hour >= 22 || time.hour <= 4); // Late night/early morning
    const isMidnight = time && time.hour >= 0 && time.hour <= 3; // True midnight hours
    const hasConflictingTime = isNightTime || (time && time.period && (
        time.period.includes('night') ||
        time.period.includes('midnight') ||
        time.period.includes('dawn')
    ));

    // Autumn elements don't make sense at midnight
    const seasonalTimeConflict = (season === 'autumn' || season === 'fall') && hasConflictingTime;
    let holidayInfo;

    // Skip holiday detection if disableHoliday is true
    if (disableHoliday) {
        logger.verbose('🚫 Holiday observation disabled in seasonal guidelines');
        holidayInfo = null;
    } else if (forcedHoliday) {
        // If a specific holiday is forced, look it up in the centralized data
        const holidayData = Object.values(HOLIDAY_DATA).find(h => h.name === forcedHoliday);

        if (holidayData) {
            holidayInfo = {
                holidays: [{
                    name: holidayData.name,
                    decorations: holidayData.decorations,
                    atmosphere: holidayData.atmosphere,
                    colors: holidayData.colors,
                    priority: holidayData.priority,
                    daysUntil: 0,
                    region: holidayData.region,
                    bufferDays: holidayData.bufferDays
                }],
                isHolidayPeriod: true,
                primaryHoliday: {
                    name: holidayData.name,
                    decorations: holidayData.decorations,
                    atmosphere: holidayData.atmosphere,
                    colors: holidayData.colors,
                    daysUntil: 0,
                    bufferDays: holidayData.bufferDays
                },
                holidayDecorations: holidayData.decorations.split(', '),
                holidayAtmosphere: holidayData.atmosphere.split(', '),
                holidayColors: holidayData.colors.split(', ')
            };
        } else {
            // Fallback for unknown holiday
            holidayInfo = {
                holidays: [{
                    name: forcedHoliday,
                    decorations: 'festive decorations',
                    atmosphere: 'celebratory',
                    colors: 'vibrant colors',
                    priority: 5,
                    daysUntil: 0,
                    bufferDays: 7
                }],
                isHolidayPeriod: true,
                primaryHoliday: {
                    name: forcedHoliday,
                    decorations: 'festive decorations',
                    atmosphere: 'celebratory',
                    daysUntil: 0,
                    bufferDays: 7,
                    colors: 'vibrant colors'
                },
                holidayDecorations: ['festive decorations'],
                holidayAtmosphere: ['celebratory'],
                holidayColors: ['vibrant colors']
            };
        }
    } else {
        holidayInfo = detectSeasonalHolidays(time);
    }

    if (!seasonalEnabled) {
        return {
            mode: 'disabled',
            season: null,
            guidelines: [
                'Seasonal modifications are completely disabled',
                'Do not reference or use any seasonal information',
                'Treat the scene as timeless and non-seasonal',
                'Focus only on weather and time-of-day elements'
            ],
            holidayInfo: null,
            modifications: []
        };
    }

    const modifications = [];

    // Weather-aware seasonal environmental modifications
    if (season === 'winter') {
        const winterMods = ['Consider indoor vs outdoor preferences - winter encourages indoor scenes with warm lighting'];

        // Weather-compliant winter modifications
        if (weather) {
            if (weather.temperature > 10) {
                winterMods.push('Despite winter season, warm weather may reduce traditional winter elements - focus on seasonal colors and indoor coziness');
            } else if (weather.temperature <= 0) {
                winterMods.push('Add winter atmospheric elements: frost on windows, snow accumulation, cold weather attire');
            }

            if (weather.condition.toLowerCase().includes('snow')) {
                winterMods.push('Snow conditions align perfectly with winter season - emphasize snow-covered landscapes and winter activities');
            } else if (weather.condition.toLowerCase().includes('rain')) {
                winterMods.push('Winter rain creates slushy, muddy conditions - focus on indoor winter warmth and holiday lighting');
            }
        } else {
            winterMods.push('Add winter atmospheric elements: frost on windows, snow accumulation, cold weather attire');
        }

        winterMods.push('Use cool blue-white lighting, warm indoor contrasts, winter mood');
        modifications.push(...winterMods);

    } else if (season === 'spring') {
        const springMods = ['Spring encourages outdoor scenes with fresh air and blooming elements'];

        // Weather-compliant spring modifications
        if (weather) {
            if (weather.temperature < 10) {
                springMods.push('Cool spring weather may delay blooming - focus on early buds, fresh green shoots, and transitional elements');
            } else if (weather.temperature > 20) {
                springMods.push('Warm spring weather accelerates blooming - emphasize vibrant flowers and lush greenery');
            }

            if (weather.windSpeed > 5) {
                springMods.push('Windy spring conditions may scatter petals and leaves - show dynamic, breezy floral movement');
            }
        }

        springMods.push('Add renewal themes: fresh flowers, green leaves, lighter clothing');
        springMods.push('Use bright, warm lighting, fresh atmosphere, growth symbolism');
        modifications.push(...springMods);

    } else if (season === 'summer') {
        const summerMods = ['Summer favors outdoor activities and bright, warm environments'];

        // Weather-compliant summer modifications
        if (weather) {
            if (weather.temperature > 30) {
                summerMods.push('Intense summer heat aligns with season - emphasize heat shimmer, bright sunlight, and cooling activities');
            } else if (weather.temperature < 20) {
                summerMods.push('Cool summer weather may feel atypical - focus on seasonal colors and summer attire despite milder temperatures');
            }

            if (weather.humidity > 70 && weather.temperature > 25) {
                summerMods.push('Humid summer conditions enhance tropical, lush summer atmosphere');
            }

            if (weather.uvIndex >= 8) {
                summerMods.push('High UV summer conditions - emphasize sun protection, bright shadows, and intense lighting');
            }
        }

        summerMods.push('Add summer elements: bright sunlight, heat effects, casual summer attire');
        summerMods.push('Use intense lighting, warm atmosphere, vibrant energy');
        modifications.push(...summerMods);

    } else if (season === 'autumn') {
        const autumnMods = ['Autumn creates cozy, transitional environments with warm colors'];

        // Skip specific autumn elements if they conflict with night time (no autumn leaves at midnight)
        if (!seasonalTimeConflict) {
            // Weather-compliant autumn modifications
            if (weather) {
                if (weather.windSpeed > 8) {
                    autumnMods.push('Windy autumn conditions accelerate leaf fall - show swirling leaves, bare branches, and dynamic seasonal change');
                }

                if (weather.temperature < 5) {
                    autumnMods.push('Cool autumn weather enhances crisp fall atmosphere - emphasize layered clothing and harvest coziness');
                }

                if ((weather.cloudCoverage || 0) >= 60) {
                    autumnMods.push(`Heavy cloud cover${weather.condition.toLowerCase().includes('fog') ? ' and fog' : ''} creates moody fall atmosphere - enhance with mist-shrouded trees and earthy tones`);
                }
            }

            autumnMods.push('Add fall elements: colored leaves, harvest themes, layered clothing');
        } else {
            // Time-conflicting autumn - use generic seasonal elements only
            autumnMods.push('Use warm earth tones and cozy transitional atmosphere (avoid specific autumn elements that conflict with night time)');
        }

        autumnMods.push('Use golden hour lighting in the morning and evening, warm earth tones, nostalgic atmosphere');
        modifications.push(...autumnMods);
    }

    // Holiday modifications with progressive intensity
    if (holidayInfo && holidayInfo.isHolidayPeriod && holidayInfo.progressiveElements) {
        const prog = holidayInfo.progressiveElements;
        const holidayMods = [
            `🎉 HOLIDAY DETECTED: ${holidayInfo.primaryHoliday.name} (${prog.daysUntil} days, ${prog.level} intensity)`,
            prog.guidance,
            `Selected decorations (${prog.decorations.length}): ${prog.decorations.join(', ')}`,
            `Atmospheric elements (${prog.atmosphere.length}): ${prog.atmosphere.join(', ')}`,
            `Color palette (${prog.colors.length}): ${prog.colors.join(', ')}`,
            prog.activities.length > 0 ? `Activity suggestions: ${prog.activities.join(', ')}` : null,
            'Integrate holiday elements progressively based on current intensity level'
        ].filter(Boolean); // Remove null entries

        modifications.push(...holidayMods);
    } else if (holidayInfo && holidayInfo.isHolidayPeriod) {
        // Fallback for holidays without progressive elements
        modifications.push(
            `🎉 HOLIDAY DETECTED: ${holidayInfo.primaryHoliday.name}`,
            'Add appropriate holiday decorations and atmosphere to the environment',
            `Decorations to consider: ${holidayInfo.holidayDecorations.slice(0, 5).join(', ')}`,
            `Atmosphere: ${holidayInfo.primaryHoliday.atmosphere}`,
            `Color palette: ${holidayInfo.primaryHoliday.colors}`,
            'Integrate holiday elements naturally into indoor and outdoor spaces'
        );
    }

    // Determine final season - use holiday season if detected, otherwise use passed season parameter
    let finalSeason = season;
    if (holidayInfo && holidayInfo.isHolidayPeriod && holidayInfo.primaryHoliday) {
        // Get season from holiday's target month if not already set
        if (!holidayInfo.primaryHoliday.season) {
            // Calculate season from holiday's target month
            const holidayData = Object.values(HOLIDAY_DATA).find(h => h.name === holidayInfo.primaryHoliday.name);
            if (holidayData && holidayData.targetMonth !== undefined) {
                holidayInfo.primaryHoliday.season = getCurrentSeason(holidayData.targetMonth, 0); // Use 0 lat for default hemisphere
            } else {
                // Fallback: use time's month to determine season
                holidayInfo.primaryHoliday.season = getCurrentSeason(time.month, 0);
            }
        }
        finalSeason = holidayInfo.primaryHoliday.season;
    }

    return {
        mode: 'comprehensive',
        season: finalSeason,
        guidelines: [
            'Actively modify environment to match seasonal characteristics',
            'Adjust indoor/outdoor balance based on seasonal preferences',
            'Add seasonal decorations, lighting, and atmospheric elements',
            'Modify character attire and activities to suit the season',
            'Create cohesive seasonal scenes that enhance the original prompt'
        ],
        holidayInfo: holidayInfo,
        modifications: modifications
    };
}

/**
 * Calculate comfort level based on temperature, humidity, and wind
 * @param {number} temperature - Temperature in Celsius
 * @param {number} humidity - Relative humidity percentage
 * @param {number} windSpeed - Wind speed in m/s
 * @returns {string} Comfort level description
 */
function getComfortLevel(temperature, humidity, windSpeed) {
    // Convert wind speed from m/s to mph for wind chill calculation
    const windSpeedMph = windSpeed * 2.237;

    // Calculate heat index for hot conditions (temperature in Celsius)
    if (temperature >= 27) { // 80°F - NOAA standard threshold
        // Convert to Fahrenheit for heat index calculation
        const tempF = (temperature * 9/5) + 32;
        const humidityPercent = Math.max(0, Math.min(100, humidity)); // Ensure valid range

        // NOAA Heat Index Formula (Rothfusz regression)
        let heatIndexF = -42.379 + (2.04901523 * tempF) + (10.14333127 * humidityPercent) -
                        (0.22475541 * tempF * humidityPercent) - (0.00683783 * tempF * tempF) -
                        (0.05481717 * humidityPercent * humidityPercent) +
                        (0.00122874 * tempF * tempF * humidityPercent) +
                        (0.00085282 * tempF * humidityPercent * humidityPercent) -
                        (0.00000199 * tempF * tempF * humidityPercent * humidityPercent);

        // Adjustments for low humidity (RH < 13% and 80°F ≤ T ≤ 112°F)
        if (humidityPercent < 13 && tempF >= 80 && tempF <= 112) {
            const adjustment = ((13 - humidityPercent) / 4) * Math.sqrt((17 - Math.abs(tempF - 95)) / 17);
            heatIndexF -= adjustment;
        }

        // Adjustments for high humidity (RH > 85% and 80°F ≤ T ≤ 87°F)
        if (humidityPercent > 85 && tempF >= 80 && tempF <= 87) {
            const adjustment = ((humidityPercent - 85) / 10) * ((87 - tempF) / 5);
            heatIndexF += adjustment;
        }

        // For conditions that don't warrant heat index, use simpler formula
        if (heatIndexF < 80) {
            heatIndexF = 0.5 * (tempF + 61.0 + ((tempF - 68.0) * 1.2) + (humidityPercent * 0.094));
            // Average with temperature for consistency
            heatIndexF = (heatIndexF + tempF) / 2;
        }

        const heatIndexC = (heatIndexF - 32) * 5/9; // Convert back to Celsius

        // NOAA heat index categories
        if (heatIndexC >= 54) return 'extremely hot - dangerous heat index'; // 130°F+
        if (heatIndexC >= 41) return 'very hot - high heat index'; // 105°F+
        if (heatIndexC >= 32) return 'hot - moderate heat index'; // 90°F+
        if (heatIndexC >= 27) return 'warm - low heat index'; // 80°F+
    }

    // Calculate wind chill for cold conditions (temperature in Celsius, wind in mph)
    if (temperature <= 10 && windSpeedMph >= 10) { // 50°F and wind >= 3 mph
        // Convert to Fahrenheit for wind chill calculation
        const tempF = (temperature * 9/5) + 32;

        // NOAA Wind Chill Formula (2001)
        let windChillF;
        if (tempF <= 50 && windSpeedMph >= 15) {
            windChillF = 35.74 + (0.6215 * tempF) - (35.75 * Math.pow(windSpeedMph, 0.16)) +
                        (0.4275 * tempF * Math.pow(windSpeedMph, 0.16));
        } else {
            windChillF = tempF; // No wind chill adjustment
        }

        const windChillC = (windChillF - 32) * 5/9; // Convert back to Celsius

        if (windChillC <= -51) return 'extremely cold - dangerous wind chill'; // ~-60°F
        if (windChillC <= -40) return 'very cold - severe wind chill'; // ~-40°F
        if (windChillC <= -29) return 'cold - moderate wind chill'; // ~-20°F
        if (windChillC <= -18) return 'cool - light wind chill'; // ~0°F
    }

    // Comfortable range (based on common comfort standards)
    if (temperature >= 18 && temperature <= 24 && humidity >= 40 && humidity <= 60) {
        return 'comfortable - ideal conditions';
    }

    // Additional comfort assessments
    if (temperature < 0) return 'very cold - freezing temperatures';
    if (temperature > 40) return 'very hot - extreme heat';
    if (humidity > 80 && temperature > 25) return 'humid - high moisture content';
    if (humidity < 20 && temperature > 25) return 'dry - low humidity';
    if (windSpeedMph > 35) return 'windy - strong wind conditions';

    return 'moderate - acceptable conditions';
}

/**
 * Calculate heat index using NOAA formula
 * @param {number} temperature - Temperature in Celsius
 * @param {number} humidity - Relative humidity percentage
 * @returns {number} Heat index in Celsius, or temperature if conditions don't warrant heat index
 */
function calculateHeatIndex(temperature, humidity) {
    // For conditions that don't warrant heat index calculation, return the actual temperature
    if (temperature < 27 || humidity < 40) return Math.round(temperature * 10) / 10;

    // Convert to Fahrenheit for calculation
    const tempF = (temperature * 9/5) + 32;
    const humidityPercent = Math.max(0, Math.min(100, humidity));

    // NOAA Heat Index Formula (Rothfusz regression)
    let heatIndexF = -42.379 + (2.04901523 * tempF) + (10.14333127 * humidityPercent) -
                    (0.22475541 * tempF * humidityPercent) - (0.00683783 * tempF * tempF) -
                    (0.05481717 * humidityPercent * humidityPercent) +
                    (0.00122874 * tempF * tempF * humidityPercent) +
                    (0.00085282 * tempF * humidityPercent * humidityPercent);

    // Adjustments for low humidity (RH < 13% and 80°F ≤ T ≤ 112°F)
    if (humidityPercent < 13 && tempF >= 80 && tempF <= 112) {
        const adjustment = ((13 - humidityPercent) / 4) * Math.sqrt((17 - Math.abs(tempF - 95)) / 17);
        heatIndexF -= adjustment;
    }

    // Adjustments for high humidity (RH > 85% and 80°F ≤ T ≤ 87°F)
    if (humidityPercent > 85 && tempF >= 80 && tempF <= 87) {
        const adjustment = ((humidityPercent - 85) / 10) * ((87 - tempF) / 5);
        heatIndexF += adjustment;
    }

    // For conditions that don't warrant heat index, use simpler formula
    if (heatIndexF < 80) {
        heatIndexF = 0.5 * (tempF + 61.0 + ((tempF - 68.0) * 1.2) + (humidityPercent * 0.094));
        // Average with temperature for consistency
        heatIndexF = (heatIndexF + tempF) / 2;
    }

    // Convert back to Celsius
    const heatIndexC = (heatIndexF - 32) * 5/9;
    return Math.round(heatIndexC * 10) / 10;
}

/**
 * Calculate wind chill using NOAA formula
 * @param {number} temperature - Temperature in Celsius
 * @param {number} windSpeed - Wind speed in m/s
 * @returns {number|null} Wind chill in Celsius, or null if not applicable
 */
function calculateWindChill(temperature, windSpeed) {
    if (temperature > 10 || windSpeed < 0.447) return null; // Wind chill only applies to cold, windy conditions

    // Convert to mph and Fahrenheit for calculation
    const tempF = (temperature * 9/5) + 32;
    const windSpeedMph = windSpeed * 2.237;

    // NOAA Wind Chill Formula (2001)
    const windChillF = 35.74 + (0.6215 * tempF) - (35.75 * Math.pow(windSpeedMph, 0.16)) +
                      (0.4275 * tempF * Math.pow(windSpeedMph, 0.16));

    // Convert back to Celsius
    const windChillC = (windChillF - 32) * 5/9;
    return Math.round(windChillC * 10) / 10;
}

/**
 * Get UV index warnings and protection recommendations
 * @param {number} uvIndex - UV index value
 * @returns {Object} UV warnings and recommendations
 */
function getUVWarnings(uvIndex) {
    if (uvIndex === null || uvIndex === undefined) return null;

    let category, risk, protection;

    if (uvIndex <= 2) {
        category = 'Low';
        risk = 'Minimal';
        protection = 'No protection needed';
    } else if (uvIndex <= 5) {
        category = 'Moderate';
        risk = 'Low to moderate';
        protection = 'Some protection recommended';
    } else if (uvIndex <= 7) {
        category = 'High';
        risk = 'Moderate to high';
        protection = 'Protection essential';
    } else if (uvIndex <= 10) {
        category = 'Very High';
        risk = 'Very high';
        protection = 'Extra protection required';
    } else {
        category = 'Extreme';
        risk = 'Extreme';
        protection = 'Avoid sun exposure';
    }

    return {
        category: category,
        risk: risk,
        protection: protection,
        index: uvIndex,
        warning: uvIndex >= 6 ? `UV Index ${uvIndex} - ${category} risk` : null
    };
}

/**
 * Get current time with timezone support, or create time object for specific hour/minute
 * @param {string} timezone - Timezone string (optional)
 * @param {number} customHour - Custom hour (0-23) to override current time
 * @param {number} customMinute - Custom minute (0-59) to override current time
 * @param {Date} customDate - Custom Date object to use instead of current date
 * @returns {Object} Time information
 */
function getCurrentTime(timezone = null, customHour = null, customMinute = null, customDate = null) {
    const now = timezone ? new Date(new Date().toLocaleString("en-US", {timeZone: timezone})) : new Date();
    const baseDate = customDate || now;

    // If custom time is specified, create time object for that specific time
    if (customHour !== null && customMinute !== null) {
        const customDateTime = new Date(baseDate);
        customDateTime.setHours(customHour, customMinute, 0, 0);

        return {
            hour: customHour,
            am_pm: customHour < 12 ? 'AM' : 'PM',
            minute: customMinute,
            second: 0,
            dayOfWeek: customDateTime.getDay(),
            dayOfWeekName: DAY_NAMES[customDateTime.getDay()],
            dayOfMonth: customDateTime.getDate(),
            month: customDateTime.getMonth(),
            monthName: MONTH_NAMES[customDateTime.getMonth()],
            year: customDateTime.getFullYear(),
            timestamp: customDateTime.getTime(),
            timezone: timezone,
            isoString: customDateTime.toISOString()
        };
    }

    // Default behavior - return current time
    return {
        hour: now.getHours(),
        am_pm: now.getHours() < 12 ? 'AM' : 'PM',
        minute: now.getMinutes(),
        second: now.getSeconds(),
        dayOfWeek: now.getDay(),
        dayOfWeekName: DAY_NAMES[now.getDay()],
        dayOfMonth: now.getDate(),
        month: now.getMonth(),
        monthName: MONTH_NAMES[now.getMonth()],
        year: now.getFullYear(),
        timestamp: now.getTime(),
        timezone: timezone,
        isoString: now.toISOString()
    };
}

/**
 * Determine the current season based on month and hemisphere
 * @param {number} month - Month (0-11)
 * @param {number} lat - Latitude (affects northern vs southern hemisphere)
 * @returns {string} Season name
 */
function getCurrentSeason(month, lat = 0) {
    // Validate month parameter
    if (typeof month !== 'number' || month < 0 || month > 11 || !Number.isInteger(month)) {
        console.warn(`⚠️ Invalid month for season detection: ${month} (type: ${typeof month})`);
        return 'unknown';
    }

    // Northern hemisphere seasons (default)
    let seasons = {
        0: 'winter', 1: 'winter', 2: 'spring',
        3: 'spring', 4: 'spring', 5: 'summer',
        6: 'summer', 7: 'summer', 8: 'autumn',
        9: 'autumn', 10: 'autumn', 11: 'winter'
    };

    // Southern hemisphere (flip seasons if latitude is negative)
    if (lat < 0) {
        seasons = {
            0: 'summer', 1: 'summer', 2: 'autumn',
            3: 'autumn', 4: 'autumn', 5: 'winter',
            6: 'winter', 7: 'winter', 8: 'spring',
            9: 'spring', 10: 'spring', 11: 'summer'
        };
    }

    return seasons[month] || 'unknown';
}

/**
 * Generate contextually-aware UC (Undesired Content) guidelines based on current weather and season
 * @param {Object} weather - Current weather data
 * @param {string} currentSeason - Current season
 * @param {Object} timePeriodInfo - Time period information
 * @returns {Array} Array of UC guideline strings
 */
function generateContextualUCGuidelines(weather, currentSeason, timePeriodInfo) {
    const ucGuidelines = [];

    // Time-Based Conflict Prevention (always applicable if time data is available)
    if (timePeriodInfo && timePeriodInfo.period) {
        ucGuidelines.push('### Time-Based Conflict Prevention');
        const period = timePeriodInfo.period || '';
        if (period.includes('night') || period.includes('evening') || period.includes('dusk')) {
            ucGuidelines.push('• **Current Scene (Night/Evening)**: UC daylight, sunlight, bright daylight, daytime, morning light, afternoon sun');
        } else if (period.includes('morning')) {
            ucGuidelines.push('• **Current Scene (Morning)**: UC evening, night, darkness, sunset, moon, stars');
        } else if (period.includes('afternoon') || period.includes('day')) {
            ucGuidelines.push('• **Current Scene (Daytime)**: UC darkness, night, nighttime, moon, stars, artificial lights (if natural daylight is intended)');
        }
        ucGuidelines.push('');
    }

    // Weather-Based Conflict Prevention (contextual based on current conditions)
    ucGuidelines.push('### Weather-Based Conflict Prevention');
    ucGuidelines.push('**CONTEXT-AWARE UC**: UC weather elements that are NOT present but could conflict with current conditions.');
    ucGuidelines.push('**CRITICAL**: UC the OPPOSITE of current weather to block impossible/conflicting elements.');
    ucGuidelines.push('**DO NOT UC what IS present** - Only UC what should NOT appear given current context.');
    ucGuidelines.push('');

    if (!weather) {
        ucGuidelines.push('• **No Weather Data**: Use general UC guidelines only when weather conflicts are obvious in the prompt');
        ucGuidelines.push('');
    } else {
        const condition = weather.condition?.toLowerCase() || '';
        const temp = weather.temperature;
        const hasSnow = condition.includes('snow');
        const hasRain = condition.includes('rain') || condition.includes('drizzle') || condition.includes('shower');
        const hasPrecipitation = hasSnow || hasRain || (weather.precipitation && weather.precipitation > 0);
        const isCloudy = weather.cloudCoverage > 60;
        const isClear = weather.cloudCoverage < 30;
        const isFoggy = condition.includes('fog') || condition.includes('mist');
        const hasThunderstorm = condition.includes('thunderstorm') || condition.includes('thunder');
        const hasHail = condition.includes('hail');
        const hasFreezingRain = condition.includes('freezing');
        const hasDust = condition.includes('dust');
        const hasSand = condition.includes('sand');
        const hasSnowOnGround = weather.snowDepth && weather.snowDepth > 0;
        const windSpeedMph = (weather.windSpeed || 0) * 2.237; // Convert m/s to mph
        const isWindy = windSpeedMph >= 25; // 25+ mph = windy
        const isSevereWind = windSpeedMph >= 40; // 40+ mph = severe
        const poorVisibility = weather.visibility !== undefined && weather.visibility < 1;

        // CURRENT ACTIVE WEATHER
        ucGuidelines.push(`**Current Conditions**: ${weather.condition} (${temp}°C, ${weather.cloudCoverage}% cloud cover)`);
        if (hasSnowOnGround) {
            ucGuidelines.push(`**Snow on Ground**: ${weather.snowDepth}cm accumulated snow present`);
        }
        if (isWindy) {
            ucGuidelines.push(`**Wind**: ${Math.round(windSpeedMph)} mph winds${isSevereWind ? ' (SEVERE)' : ''}`);
        }
        if (poorVisibility) {
            ucGuidelines.push(`**Visibility**: Poor (${weather.visibility} km)`);
        }
        ucGuidelines.push('');

        // Thunderstorm Scenes (highest priority - severe weather)
        if (hasThunderstorm) {
            ucGuidelines.push('• **Active Thunderstorm**: UC clear sky, sunny, calm weather, bright sunlight, peaceful conditions, quiet atmosphere');
        }
        // Hail Scenes
        else if (hasHail) {
            ucGuidelines.push('• **Active Hail**: UC clear sky, sunny, calm weather, gentle rain, peaceful conditions, clear ground');
        }
        // Freezing Rain/Ice Scenes
        else if (hasFreezingRain) {
            ucGuidelines.push('• **Freezing Rain/Ice**: UC warm rain, dry conditions, clear sky, warm weather, no ice, thawed conditions');
        }
        // Dust Storm Scenes
        else if (hasDust) {
            ucGuidelines.push('• **Dust Storm**: UC clear air, clean atmosphere, good visibility, clear skies, fresh air');
        }
        // Sand Storm Scenes
        else if (hasSand) {
            ucGuidelines.push('• **Sand Storm**: UC clear air, clean atmosphere, good visibility, clear skies, vegetation, greenery');
        }
        // Rain/Precipitation Scenes
        else if (hasRain) {
            ucGuidelines.push('• **Active Rain Scene**: UC clear sky, sunny, bright sunlight, dry conditions, no clouds, cloudless');
        }
        // Snow Scenes
        else if (hasSnow) {
            ucGuidelines.push('• **Active Snow Scene**: UC rain, showers, warm weather, green leaves, summer elements, melting conditions, heat');
        }
        // Snow on Ground (but not currently snowing)
        else if (hasSnowOnGround && !hasSnow) {
            ucGuidelines.push('• **Snow on Ground (Past Snow)**: UC bare ground, no snow, green grass, summer vegetation, warm ground, melted conditions');
            ucGuidelines.push('  **Note**: Snow is present from past snowfall - UC elements that would conflict with snow-covered environment');
        }
        // Clear/Sunny Scenes
        else if (isClear && !hasPrecipitation) {
            ucGuidelines.push('• **Clear/Sunny Scene**: UC cloudy, overcast, rain, showers, drizzle, precipitation, storms, dark clouds, gloomy, wet conditions, puddles');
            ucGuidelines.push('  **MANDATORY PRECIPITATION UC**: Include comprehensive precipitation terms: rain, showers, drizzle, downpour, storms, thunder, lightning, wet, damp, puddles, hail, sleet');
        }
        // Cloudy/Overcast Scenes (no precipitation)
        else if (isCloudy && !hasPrecipitation) {
            ucGuidelines.push('• **Cloudy/Overcast Scene (Dry)**: UC bright sunlight, clear sky, sunny, intense shadows, harsh light');
            ucGuidelines.push('  **Also UC Precipitation**: rain, showers, drizzle, precipitation, storms, wet conditions, puddles (clouds present but no rain)');
        }
        // Foggy/Misty Scenes
        else if (isFoggy) {
            ucGuidelines.push('• **Foggy/Misty Scene**: UC clear visibility, bright sunlight, sharp details, dry air, clear sky');
        }
        // Poor Visibility (dust, haze, smoke)
        else if (poorVisibility && !isFoggy) {
            ucGuidelines.push('• **Poor Visibility (Dust/Haze)**: UC clear air, sharp visibility, clear skies, crisp details');
        }
        // Humid (but not raining) - important distinction
        else if (weather.humidity >= 70 && !hasPrecipitation && weather.temperature > 25) {
            ucGuidelines.push('• **Humid Scene (No Precipitation)**: UC rain, showers, drizzle, precipitation, storms, thunder, lightning, wet, damp, puddles, flooding, hail, sleet');
            ucGuidelines.push('  **CRITICAL**: Humidity ≠ Precipitation. UC all precipitation terms to prevent confusion.');
        }

        // Wind-specific UC (if windy/severe)
        if (isSevereWind) {
            ucGuidelines.push('• **Severe Wind Conditions**: UC calm air, still conditions, motionless objects, peaceful atmosphere');
        } else if (isWindy) {
            ucGuidelines.push('• **Windy Conditions**: UC completely still air, motionless leaves/hair, calm conditions');
        }

        // Extreme temperature UC
        const feelsLike = weather.feelsLike || weather.heatIndex || temp;
        if (feelsLike >= 35) {
            ucGuidelines.push('• **Extreme Heat**: UC cool weather, cold conditions, winter elements, comfortable temperatures, mild weather');
        } else if (feelsLike <= -10) {
            ucGuidelines.push('• **Extreme Cold**: UC warm weather, hot conditions, summer elements, comfortable temperatures, mild weather');
        }

        // UV Index considerations (for clear sunny days)
        if (weather.uvIndex !== undefined && isClear) {
            if (weather.uvIndex >= 8) {
                ucGuidelines.push('• **High UV Index**: UC shade, overcast, cloudy, dim lighting, indoor lighting (intense sun exposure)');
            }
        }

        ucGuidelines.push('');
    }

    // Seasonal Conflict Prevention (contextual based on current season and weather)
    ucGuidelines.push('### Seasonal Conflict Prevention');
    ucGuidelines.push('**SMART SEASONAL UC**: Consider current season AND current weather conditions.');
    ucGuidelines.push('');

    if (currentSeason) {
        const condition = weather?.condition?.toLowerCase() || '';
        const temp = weather?.temperature;
        const hasSnow = condition.includes('snow');
        const isWarm = temp !== undefined && temp > 20;
        const isCold = temp !== undefined && temp < 5;

        switch (currentSeason.toLowerCase()) {
            case 'winter':
                if (hasSnow) {
                    // Active snow in winter - UC summer/warm elements
                    ucGuidelines.push(`• **Winter with Snow**: UC green leaves, flowers, summer warmth, bright vibrant colors, lush vegetation, tropical elements`);
                } else if (isWarm) {
                    // Warm winter - don't UC snow aggressively, it might not be present
                    ucGuidelines.push(`• **Warm Winter (${temp}°C)**: UC summer heat, tropical elements, heavy snow (mild winter, limited UC)`);
                    ucGuidelines.push('  **Note**: Current temperature is warm for winter - avoid over-UCing cold elements');
                } else {
                    // Normal cold winter
                    ucGuidelines.push(`• **Winter Scene**: UC green leaves, flowers, summer warmth, bright colors, lush vegetation`);
                }
                break;

            case 'summer':
                if (isCold) {
                    // Cold summer - unusual
                    ucGuidelines.push(`• **Cool Summer (${temp}°C)**: UC intense heat, scorching sun (cooler summer day)`);
                } else {
                    // Normal warm summer
                    ucGuidelines.push(`• **Summer Scene**: UC snow, frost, winter cold, bare trees, ice, frozen elements`);
                    if (!hasSnow) {
                        ucGuidelines.push('  **No Snow Present**: Strongly UC all snow/winter precipitation elements');
                    }
                }
                break;

            case 'spring':
                ucGuidelines.push(`• **Spring Scene**: UC heavy snow, deep winter cold, summer heat extremes (depending on temperature)`);
                if (temp !== undefined) {
                    if (temp < 10) {
                        ucGuidelines.push('  **Early/Cool Spring**: UC summer heat, tropical warmth');
                    } else if (temp > 20) {
                        ucGuidelines.push('  **Late/Warm Spring**: UC heavy snow, deep frost, winter extremes');
                    }
                }
                break;

            case 'autumn':
                ucGuidelines.push(`• **Autumn Scene**: UC summer greenery, spring flowers, winter deep snow (depending on progression)`);
                if (temp !== undefined) {
                    if (temp < 10) {
                        ucGuidelines.push('  **Late Autumn**: UC summer heat, lush greenery, flowers');
                    } else if (temp > 20) {
                        ucGuidelines.push('  **Early Autumn**: UC winter snow, heavy frost');
                    }
                }
                break;
        }
    } else {
        ucGuidelines.push('• **No Season Data**: Only UC seasonal elements when they obviously conflict with the prompt or weather');
    }

    ucGuidelines.push('');

    // UC Application Rules
    ucGuidelines.push('### UC Application Rules');
    ucGuidelines.push('• **UC the OPPOSITE**: Always UC elements that are NOT currently present but could conflict (rain when sunny, snow when warm, etc.)');
    ucGuidelines.push('• **Block Impossible Weather**: UC weather that cannot occur given current conditions (snow in 30°C heat, rain in clear skies)');
    ucGuidelines.push('• **Season + Weather Combo**: Consider both - warm winter day needs different UC than snowy winter');
    ucGuidelines.push('• **Contextual Intelligence**: Focus UC on preventing conflicting elements that the AI might otherwise add');
    ucGuidelines.push('• **Balanced Approach**: Add UC strategically without over-constraining the AI');
    ucGuidelines.push('• **APPEND USAGE**: Use `action: "append"` in UC replacements to add conflicting elements to the negative prompt');
    ucGuidelines.push('• **CONSOLIDATE UC**: Always combine all UC additions into a SINGLE text replacement using `action: "append"`');
    ucGuidelines.push('');

    return ucGuidelines;
}

/**
 * Analyze weather patterns and trends for enhanced believability
 * @param {Object} weatherData - Current weather data
 * @param {Object} historicalData - Historical weather data for comparison
 * @returns {Object} Pattern analysis results
 */
function analyzeWeatherPatterns(weatherData, historicalData = null) {
    const patterns = {
        stability: 'stable',
        trends: [],
        anomalies: [],
        believability: 85
    };

    // Analyze temperature trends
    if (historicalData?.daily && historicalData.daily.length > 0) {
        const recentDays = historicalData.daily.slice(-3); // Last 3 days
        const avgRecentTemp = recentDays.reduce((sum, day) => sum + day.temperature.avg, 0) / recentDays.length;
        const tempDiff = weatherData.temperature - avgRecentTemp;

        if (Math.abs(tempDiff) > 10) {
            patterns.anomalies.push(`Temperature ${tempDiff > 0 ? 'spike' : 'drop'} of ${Math.abs(tempDiff).toFixed(1)}°C from recent average`);
            patterns.believability -= 15;
        } else if (Math.abs(tempDiff) > 5) {
            patterns.trends.push(`Temperature ${tempDiff > 0 ? 'warming' : 'cooling'} trend`);
        } else {
            patterns.stability = 'very stable';
        }
    }

    // Analyze precipitation patterns
    if (weatherData.precipitation > 0) {
        if (weatherData.precipitationProbability > 70) {
            patterns.trends.push('High probability precipitation expected');
        } else if (weatherData.precipitationProbability < 30) {
            patterns.anomalies.push('Precipitation occurring despite low probability');
            patterns.believability -= 10;
        }
    }

    // Analyze wind patterns
    if (weatherData.windGust && weatherData.windGust > weatherData.windSpeed * 1.5) {
        patterns.trends.push('Gust fronts suggest changing weather patterns');
    }

    // Seasonal consistency check
    const currentMonth = new Date().getMonth();
    const expectedTempRange = getSeasonalTemperatureExpectations(currentMonth, weatherData.location);
    if (weatherData.temperature < expectedTempRange.min || weatherData.temperature > expectedTempRange.max) {
        patterns.anomalies.push(`Temperature ${weatherData.temperature}°C is unusual for this season and location`);
        patterns.believability -= 10;
    }

    return patterns;
}

/**
 * Get expected temperature ranges for different seasons based on location
 * @param {number} month - Month (0-11)
 * @param {Object} location - Location object with latitude/longitude
 * @returns {Object} Temperature range expectations
 */
function getSeasonalTemperatureExpectations(month, location = null) {
    // Base expectations for temperate climates (latitude 40-50°N)
    const baseExpectations = [
        { min: -5, max: 10 },   // January
        { min: -2, max: 12 },   // February
        { min: 0, max: 15 },    // March
        { min: 5, max: 20 },    // April
        { min: 10, max: 25 },   // May
        { min: 15, max: 30 },   // June
        { min: 18, max: 32 },   // July
        { min: 17, max: 31 },   // August
        { min: 12, max: 26 },   // September
        { min: 5, max: 18 },    // October
        { min: 0, max: 12 },    // November
        { min: -3, max: 8 }     // December
    ];

    if (!location?.latitude) {
        return baseExpectations[month] || { min: 0, max: 25 };
    }

    const latitude = Math.abs(location.latitude); // Use absolute value for hemisphere-independent logic

    // Adjust expectations based on latitude
    let adjustment = 0;

    if (latitude < 20) {
        // Tropical regions - warmer year-round
        adjustment = 15;
    } else if (latitude < 35) {
        // Subtropical regions - moderate warming
        adjustment = 8;
    } else if (latitude < 50) {
        // Temperate regions - base expectations
        adjustment = 0;
    } else if (latitude < 65) {
        // Subarctic regions - cooler
        adjustment = -8;
    } else {
        // Arctic regions - very cold
        adjustment = -15;
    }

    // Apply seasonal inversion for Southern Hemisphere (month + 6)
    const effectiveMonth = location.latitude < 0 ? (month + 6) % 12 : month;

    const baseRange = baseExpectations[effectiveMonth] || { min: 0, max: 25 };

    return {
        min: Math.round(baseRange.min + adjustment),
        max: Math.round(baseRange.max + adjustment)
    };
}

/**
 * Validate weather data for reasonableness and consistency
 * @param {Object} weatherData - Weather data object to validate
 * @returns {Object} Validation result with issues and confidence score
 */
function validateWeatherData(weatherData) {
    const issues = [];
    let confidenceScore = 100;

    // Temperature validation
    if (weatherData.temperature < -50 || weatherData.temperature > 60) {
        issues.push(`Temperature ${weatherData.temperature}°C is outside reasonable bounds`);
        confidenceScore -= 20;
    }

    // Feels like temperature should be close to actual temperature (within 10°C unless extreme conditions)
    if (Math.abs(weatherData.feelsLike - weatherData.temperature) > 15) {
        issues.push(`Feels-like temperature difference too large: ${weatherData.temperature}°C vs ${weatherData.feelsLike}°C`);
        confidenceScore -= 10;
    }

    // Humidity validation
    if (weatherData.humidity !== undefined && (weatherData.humidity < 0 || weatherData.humidity > 100)) {
        issues.push(`Humidity ${weatherData.humidity}% is outside valid range 0-100%`);
        confidenceScore -= 15;
    }

    // Cloud coverage validation
    if (weatherData.cloudCoverage !== undefined && (weatherData.cloudCoverage < 0 || weatherData.cloudCoverage > 100)) {
        issues.push(`Cloud coverage ${weatherData.cloudCoverage}% is outside valid range 0-100%`);
        confidenceScore -= 15;
    }

    // Wind speed validation
    if (weatherData.windSpeed < 0 || weatherData.windSpeed > 150) {
        issues.push(`Wind speed ${weatherData.windSpeed} m/s is outside reasonable bounds`);
        confidenceScore -= 10;
    }

    // Precipitation validation
    if (weatherData.precipitation < 0) {
        issues.push(`Precipitation ${weatherData.precipitation}mm cannot be negative`);
        confidenceScore -= 10;
    }

    // UV index validation
    if (weatherData.uvIndex !== undefined && (weatherData.uvIndex < 0 || weatherData.uvIndex > 15)) {
        issues.push(`UV index ${weatherData.uvIndex} is outside valid range 0-15`);
        confidenceScore -= 5;
    }

    // Cross-validation: Hot temperatures should have higher UV if clear skies
    if (weatherData.temperature > 30 && weatherData.uvIndex !== undefined && weatherData.uvIndex < 3 && weatherData.cloudCoverage < 50) {
        issues.push(`High temperature ${weatherData.temperature}°C with low UV ${weatherData.uvIndex} suggests possible data inconsistency`);
        confidenceScore -= 10;
    }

    // Data freshness check (if timestamp is available)
    if (weatherData.timestamp) {
        const ageMinutes = (Date.now() - weatherData.timestamp) / (1000 * 60);
        if (ageMinutes > 60) { // Data older than 1 hour
            issues.push(`Weather data is ${Math.round(ageMinutes)} minutes old`);
            confidenceScore -= Math.min(20, Math.round(ageMinutes / 60) * 5);
        }
    }

    return {
        isValid: issues.length === 0,
        confidenceScore: Math.max(0, confidenceScore),
        issues: issues,
        dataQuality: confidenceScore >= 80 ? 'High' : confidenceScore >= 60 ? 'Medium' : 'Low'
    };
}

/**
 * Generate dynamic clothing context for intelligent clothing adaptation
 * @param {Object} context - Current context (time, weather, season, etc.)
 * @returns {Object} Dynamic clothing context with recommendations
 */
function generateDynamicClothingContext(context) {
    const clothingDB = new ClothingDatabase();
    
    // Extract relevant context for clothing selection
    const clothingContext = {
        temperature: context.weather?.temperature,
        weather: context.weather,
        season: context.season?.season,
        holidayInfo: context.season?.holidayInfo || null,
        timeOfDay: context.timePeriod?.timeOfDay || 'daytime',
        activity: context.activity,
        location: context.location
    };

    // Enhanced holiday awareness for clothing adaptation
    if (clothingContext.holidayInfo) {
        // Map holiday names to clothing database keys
        const holidayMapping = {
            'Christmas/Holiday Season': 'christmas',
            'New Year\'s Celebration': 'christmas', // Use Christmas styling for New Year's
            'Halloween': 'halloween',
            'Thanksgiving': 'christmas', // Use Christmas styling for Thanksgiving
            'Independence Day': 'independence',
            'Valentine\'s Day': 'valentines',
            'Easter/Spring Holiday': 'easter',
            'St. Patrick\'s Day': 'independence', // Use patriotic styling
            'Memorial Day': 'independence',
            'Labor Day': 'independence',
            'Veterans Day': 'independence',
            'Japanese New Year (Oshogatsu)': 'christmas',
            'Cherry Blossom Season (Hanami)': 'easter',
            'Star Festival (Tanabata)': 'valentines',
            'Golden Week (Shukujitsu)': 'independence',
            'Children\'s Day (Kodomo no Hi)': 'easter',
            'Autumn Moon Festival (Tsukimi)': 'christmas',
            'Obon Festival (Bon Odori)': 'easter'
        };
        
        // Update holiday context with mapped key for better clothing selection
        const mappedHoliday = holidayMapping[clothingContext.holidayInfo?.name] || clothingContext.holidayInfo?.name.toLowerCase();
        clothingContext.holidayInfo = mappedHoliday;
    }

    // Get clothing options and recommendations
    const clothingOptions = clothingDB.getClothingOptions(clothingContext);
    const clothingRecommendations = clothingDB.getClothingRecommendations(clothingContext);
    const clothingSuggestions = clothingDB.generateClothingSuggestions(clothingContext);
    const clothingExamples = clothingDB.generateContextualExamples(clothingContext);
    const clothingCombinations = clothingDB.getIntelligentCombinations(clothingContext);

    return {
        options: clothingOptions,
        recommendations: clothingRecommendations,
        suggestions: clothingSuggestions,
        examples: clothingExamples,
        combinations: clothingCombinations,
        context: clothingContext
    };
}

// ========================================
// LCD DISPLAY FORMATTING FUNCTIONS
// ========================================

/**
 * Create sun position bar from raw time data
 * @param {Object} timeData - Raw time data from determineTimePeriod()
 * @returns {string} Formatted bar graph showing sun position
 */
function createSunPositionBar(timeData) {
    const barLength = 8;
    const separator = '│';
    const emptyChar = '░';
    const filledChar = '█';
    
    // Handle pre-dawn and post-dusk
    if (timeData.sunPhase === 'pre-dawn' || timeData.sunPhase === 'post-dusk' || timeData.sunPhase === 'unknown') {
        return emptyChar.repeat(barLength) + separator + emptyChar.repeat(barLength);
    }
    
    // Handle polar conditions
    if (timeData.sunPhase === 'polar_day') {
        return filledChar.repeat(barLength) + separator + filledChar.repeat(barLength);
    }
    if (timeData.sunPhase === 'polar_night') {
        return emptyChar.repeat(barLength) + separator + emptyChar.repeat(barLength);
    }
    
    // Rising phase - fill left side
    if (timeData.sunPhase === 'rising') {
        const filled = Math.round(timeData.sunProgressRaw * barLength);
        const leftBar = filledChar.repeat(filled) + emptyChar.repeat(barLength - filled);
        const rightBar = emptyChar.repeat(barLength);
        return leftBar + separator + rightBar;
    }
    
    // Setting phase - empty right side from left to right
    if (timeData.sunPhase === 'setting') {
        const emptyFromLeft = Math.round(timeData.sunProgressRaw * barLength);
        const remainingFilled = barLength - emptyFromLeft;
        const leftBar = emptyChar.repeat(barLength);
        const rightBar = emptyChar.repeat(emptyFromLeft) + filledChar.repeat(remainingFilled);
        return leftBar + separator + rightBar;
    }
    
    return emptyChar.repeat(barLength) + separator + emptyChar.repeat(barLength);
}

/**
 * Create light level bar from raw time data
 * @param {Object} timeData - Raw time data from determineTimePeriod()
 * @returns {string} Formatted bar graph showing outdoor light level (0-10 scale)
 */
function createLightLevelBar(timeData) {
    const barLength = 10;
    const emptyChar = '░';
    const filledChar = '█';
    
    const filled = Math.round(timeData.lightLevelRaw || 0);
    return filledChar.repeat(filled) + emptyChar.repeat(barLength - filled);
}

/**
 * Create precipitation bar with logarithmic perceptual scale
 * @param {number} mmPerHour - Precipitation rate in mm/hr
 * @returns {string} Formatted bar graph (0-30mm/hr max, 15 bars)
 */
function createPrecipitationBar(mmPerHour) {
    const barLength = 15;
    const emptyChar = '░';
    const filledChar = '█';
    
    if (mmPerHour === 0 || !mmPerHour) return emptyChar.repeat(barLength);
    
    // Logarithmic perceptual scale for precipitation
    // 0-1mm = drizzle (0-3 bars)
    // 1-5mm = light rain (3-8 bars)
    // 5-15mm = moderate rain (8-12 bars)
    // 15-30mm = heavy rain (12-15 bars)
    let filled = 0;
    if (mmPerHour <= 1) {
        filled = Math.round((mmPerHour / 1) * 3);
    } else if (mmPerHour <= 5) {
        filled = 3 + Math.round(((mmPerHour - 1) / 4) * 5);
    } else if (mmPerHour <= 15) {
        filled = 8 + Math.round(((mmPerHour - 5) / 10) * 4);
    } else {
        filled = 12 + Math.round(Math.min((mmPerHour - 15) / 15, 1) * 3);
    }
    
    filled = Math.min(barLength, filled);
    return filledChar.repeat(filled) + emptyChar.repeat(barLength - filled);
}

/**
 * Create generic bar graph
 * @param {number} value - Current value
 * @param {number} max - Maximum value
 * @param {number} length - Bar length
 * @returns {string} Formatted bar graph
 */
function createBarGraph(value, max = 100, length = 10) {
    const emptyChar = '░';
    const filledChar = '█';
    const filled = Math.round((value / max) * length);
    const empty = length - filled;
    return filledChar.repeat(Math.max(0, filled)) + emptyChar.repeat(Math.max(0, empty));
}

/**
 * Get season icon emoji
 * @param {string} season - Season name
 * @returns {string} Season emoji
 */
function getSeasonIcon(season) {
    const icons = {
        'spring': '🌸',
        'summer': '☀️',
        'autumn': '🍂',
        'fall': '🍂',
        'winter': '❄️'
    };
    return icons[season?.toLowerCase()] || '🌿';
}

/**
 * Capitalize first letter of string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Get next season
 * @param {string} currentSeason - Current season name
 * @returns {string} Next season name
 */
function getNextSeason(currentSeason) {
    const seasons = ['winter', 'spring', 'summer', 'autumn'];
    const index = seasons.indexOf(currentSeason?.toLowerCase());
    if (index === -1) return 'spring';
    return seasons[(index + 1) % 4];
}

/**
 * Get previous season
 * @param {string} currentSeason - Current season name
 * @returns {string} Previous season name
 */
function getPreviousSeason(currentSeason) {
    const seasons = ['winter', 'spring', 'summer', 'autumn'];
    const index = seasons.indexOf(currentSeason?.toLowerCase());
    if (index === -1) return 'winter';
    return seasons[(index - 1 + 4) % 4];
}

/**
 * Calculate seasonal progression (0-100%)
 * @param {Object} time - Time object with month and dayOfMonth
 * @param {string} season - Current season
 * @returns {number} Progress percentage through the season (0-100)
 */
function calculateSeasonalProgression(time, season) {
    if (!time || !season) return 50; // Default to middle
    
    const seasonBounds = {
        spring: { start: { month: 2, day: 20 }, end: { month: 5, day: 20 } },  // Mar 20 - Jun 20
        summer: { start: { month: 5, day: 21 }, end: { month: 8, day: 22 } },  // Jun 21 - Sep 22
        autumn: { start: { month: 8, day: 23 }, end: { month: 11, day: 20 } }, // Sep 23 - Dec 20
        winter: { start: { month: 11, day: 21 }, end: { month: 2, day: 19 } }  // Dec 21 - Mar 19
    };
    
    const bounds = seasonBounds[season.toLowerCase()];
    if (!bounds) return 50;
    
    const currentMonth = time.month;
    const currentDay = time.dayOfMonth;
    
    // Calculate day of year for current date
    const currentDayOfYear = getDayOfYear(currentMonth, currentDay);
    
    // Calculate start and end day of year for season
    let startDayOfYear = getDayOfYear(bounds.start.month, bounds.start.day);
    let endDayOfYear = getDayOfYear(bounds.end.month, bounds.end.day);
    
    // Handle winter wrapping around year boundary
    if (season.toLowerCase() === 'winter') {
        if (currentMonth < 3) {
            // We're in Jan-Feb, treat as continuation from Dec
            const adjustedCurrent = currentDayOfYear;
            const adjustedEnd = getDayOfYear(2, 19); // Feb 19
            const seasonLength = adjustedEnd + (365 - getDayOfYear(11, 21)); // Days from Dec 21 to end of year + Jan-Feb
            const daysSinceStart = (currentMonth < 3) ? (365 - getDayOfYear(11, 21) + currentDayOfYear) : (currentDayOfYear - startDayOfYear);
            return Math.round((daysSinceStart / seasonLength) * 100);
        } else {
            // We're in Dec
            const seasonLength = (365 - startDayOfYear) + getDayOfYear(2, 19);
            const daysSinceStart = currentDayOfYear - startDayOfYear;
            return Math.round((daysSinceStart / seasonLength) * 100);
        }
    }
    
    // For other seasons
    const seasonLength = endDayOfYear - startDayOfYear;
    const daysSinceStart = currentDayOfYear - startDayOfYear;
    const progress = (daysSinceStart / seasonLength) * 100;
    
    return Math.max(0, Math.min(100, Math.round(progress)));
}

/**
 * Helper: Get day of year (0-365)
 */
function getDayOfYear(month, day) {
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let dayOfYear = day;
    for (let i = 0; i < month; i++) {
        dayOfYear += daysInMonth[i];
    }
    return dayOfYear;
}

/**
 * Create seasonal progression bar
 * @param {Object} time - Time object
 * @param {string} currentSeason - Current season
 * @returns {string} Formatted progression bar with seasons
 */
function createSeasonalProgressionBar(time, currentSeason) {
    if (!time || !currentSeason) return '';
    
    const progress = calculateSeasonalProgression(time, currentSeason);
    const prevSeason = getPreviousSeason(currentSeason);
    const nextSeason = getNextSeason(currentSeason);
    
    const barLength = 10;
    const position = Math.round((progress / 100) * barLength);
    
    const bar = '░'.repeat(position) + '█' + '░'.repeat(Math.max(0, barLength - position - 1));
    
    // Always show current season on left, next season on right
    // Progress bar indicates how far through the current season we are
    const leftSeason = capitalize(currentSeason);
    const rightSeason = capitalize(nextSeason);
    
    return `${leftSeason} [${bar}] ${rightSeason}`;
}

/**
 * Compile historical weather report data for AI context
 * @param {Object} enhancedWeatherData - Enhanced weather data with temporal and yesterday info
 * @param {Object} weather - Current weather data
 * @param {Object} time - Current time data
 * @param {Object} location - Location data
 * @returns {Object} Compiled weather history report sections
 */
function compileWeatherHistoryReport(enhancedWeatherData, weather, time, location) {
    if (!enhancedWeatherData?.temporal?.hourly) {
        return null;
    }
    
    const hourlyData = enhancedWeatherData.temporal.hourly;
    const now = Date.now();
    
    // Get temporal window: past 4 hours + next 2 hours
    const temporalWindow = hourlyData.filter(hour => {
        const hourTime = new Date(hour.timestamp).getTime();
        const hoursAgo = (now - hourTime) / (1000 * 60 * 60);
        return hoursAgo >= -2 && hoursAgo <= 4;
    }).slice(0, 7);
    
    if (temporalWindow.length < 2) {
        return null; // Need at least 2 data points
    }
    
    // Separate past and future
    const pastHours = temporalWindow.filter(h => h.timestamp <= now);
    const futureHours = temporalWindow.filter(h => h.timestamp > now);
    
    // Compile timeline entries
    const timelineEntries = [...pastHours, ...futureHours].map(hour => {
        const hourDate = new Date(hour.timestamp);
        const timeStr = `${hourDate.getHours().toString().padStart(2, '0')}:${hourDate.getMinutes().toString().padStart(2, '0')}`;
        const hoursFromNow = (hour.timestamp - now) / (1000 * 60 * 60);
        
        let label;
        if (Math.abs(hoursFromNow) < 0.1) {
            label = '🕐 NOW';
        } else if (hoursFromNow < 0) {
            label = `⏰ ${Math.round(Math.abs(hoursFromNow))}h ago`;
        } else {
            label = `🔮 +${Math.round(hoursFromNow)}h`;
        }
        
        const precipType = hour.precipitationType?.description || hour.precipitationType?.type || 'unknown';
        
        return {
            label,
            timeStr,
            temperature: hour.temperature,
            feelsLike: hour.feelsLike,
            condition: hour.condition,
            cloudCoverage: hour.cloudCoverage,
            precipitation: hour.precipitation,
            precipitationType: precipType,
            humidity: hour.humidity,
            windSpeed: hour.windSpeed,
            windDirection: hour.windDirection,
            visibility: hour.visibility
        };
    });
    
    // Compile trend analysis (only if we have past data)
    let trendAnalysis = null;
    if (pastHours.length >= 2) {
        const oldest = pastHours[pastHours.length - 1];
        const newest = pastHours[0];
        
        const tempChange = newest.temperature - oldest.temperature;
        const cloudChange = newest.cloudCoverage - oldest.cloudCoverage;
        const humidityChange = newest.humidity - oldest.humidity;
        const windChange = newest.windSpeed - oldest.windSpeed;
        
        const hasCurrentPrecip = newest.precipitation > 0;
        const hadRecentPrecip = pastHours.slice(0, 2).some(h => h.precipitation > 0);
        const hadEarlierPrecip = pastHours.slice(2).some(h => h.precipitation > 0);
        
        trendAnalysis = {
            temperature: {
                change: tempChange,
                rate: tempChange / pastHours.length,
                status: Math.abs(tempChange) < 1 ? 'stable' : tempChange > 0 ? 'rising' : 'falling'
            },
            precipitation: {
                hasCurrentPrecip,
                hadRecentPrecip,
                hadEarlierPrecip,
                lastPrecip: pastHours.find(h => h.precipitation > 0)
            },
            cloud: {
                change: cloudChange,
                status: Math.abs(cloudChange) < 10 ? 'stable' : cloudChange > 0 ? 'increasing' : 'decreasing'
            },
            humidity: {
                change: humidityChange,
                status: Math.abs(humidityChange) < 10 ? 'stable' : humidityChange > 0 ? 'rising' : 'falling'
            },
            wind: {
                change: windChange,
                status: Math.abs(windChange) < 2 ? 'stable' : windChange > 0 ? 'strengthening' : 'calming'
            },
            stability: {
                isStable: Math.abs(tempChange) < 2 && Math.abs(cloudChange) < 15 && !hadRecentPrecip
            }
        };
    }
    
    // Compile yesterday's data
    let yesterdayData = null;
    if (enhancedWeatherData.yesterday) {
        const yesterday = enhancedWeatherData.yesterday;
        yesterdayData = {
            date: yesterday.date,
            dominantCondition: yesterday.dominantCondition,
            temperatureMin: Math.round(yesterday.temperature.min),
            temperatureMax: Math.round(yesterday.temperature.max),
            temperatureAvg: Math.round(yesterday.temperature.avg),
            precipitationTotal: Math.round(yesterday.precipitation.total * 100) / 100,
            precipitationSnow: yesterday.precipitation.snow,
            cloudCoverAvg: Math.round(yesterday.cloudCover?.avg || 0),
            windSpeedAvg: Math.round(yesterday.windSpeed.avg),
            windGustMax: Math.round(yesterday.windGust?.max || yesterday.windSpeed.max),
            tempDiffFromToday: weather.temperature - yesterday.temperature.avg
        };
    }
    
    return {
        reportGenerated: time ? `${time.monthName} ${time.dayOfMonth}, ${time.year} at ${time.hour}:${time.minute.toString().padStart(2, '0')} ${time.am_pm}` : 'Current Date/Time',
        location: location?.city || 'Current Location',
        timezone: location?.timezone || 'UTC',
        yesterday: yesterdayData,
        timelineEntries,
        trendAnalysis,
        hasPastData: pastHours.length >= 2
    };
}

/**
 * Generate system message for dynamic generation AI (MODULAR VERSION)
 * 
 * This is the new reorganized version using the modular systemMessageBuilder.
 * The system message is organized into 10 logical cognitive flow phases.
 * 
 * Benefits over original:
 * - 49% smaller (2,900 lines vs 5,650 lines)
 * - Logical cognitive flow organization
 * - Single source of truth for all concepts
 * - No redundancy or scattered information
 * - Easy to maintain and extend
 * 
 * @param {Object} context - Current context (time, weather, etc.)
 * @param {Object} seasonalConfig - Seasonal configuration object
 * @param {boolean} backgroundFocus - Whether this is a background focus stage
 * @param {boolean} pipelineAware - Whether pipeline canvas awareness is enabled
 * @param {Object} stageContext - Stage context information
 * @param {string} directive - User directive for creative modifications
 * @param {Object} dynamicConfig - Dynamic configuration object including locked_replacements
 * @param {number} nsfw_level - NSFW level
 * @param {*} compiled_prompt - Compiled prompt from previous attempt (for adaptation mode)
 * @param {string} prompt - Current prompt text
 * @param {string} uc - Current UC text
 * @returns {Object} Object containing systemMessage, userContentSections, directiveContentSections
 */

/**
 * Score memory relevance based on prompt and context
 * @param {Object} memory - Memory object with name, description, category, etc.
 * @param {string} prompt - Current prompt text
 * @param {string} uc - Negative prompt text
 * @param {string} directive - User directive
 * @param {Object} context - Context object with weather, time, season, etc.
 * @returns {number} Relevance score (higher = more relevant)
 */
function scoreMemoryRelevance(memory, prompt = '', uc = '', directive = '', context = {}) {
    let score = 0;
    
    // Combine all text sources for keyword extraction
    const allText = [
        prompt || '',
        uc || '',
        directive || '',
        context.weather?.condition || '',
        context.timePeriod || '',
        (typeof context.season === 'string' ? context.season : context.season?.season) || ''
    ].join(' ').toLowerCase();
    
    // Extract meaningful keywords (2+ chars, filter common words)
    const commonWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can']);
    const words = allText
        .split(/\s+/)
        .map(w => w.replace(/[^\w]/g, ''))
        .filter(w => w.length >= 2 && !commonWords.has(w));
    
    const memoryName = (memory.name || '').toLowerCase();
    const memoryDesc = (memory.description || '').toLowerCase();
    const memoryCategory = (memory.category || '').toLowerCase();
    
    // Score based on keyword matches in memory name (high weight)
    words.forEach(word => {
        if (memoryName.includes(word)) {
            score += 15; // Strong match in name
        } else if (memoryDesc.includes(word)) {
            score += 8; // Match in description
        }
    });
    
    // Category relevance scoring based on context
    if (context.weather && (memoryCategory.includes('weather') || memoryCategory.includes('environment') || memoryDesc.includes('weather') || memoryDesc.includes('rain') || memoryDesc.includes('snow') || memoryDesc.includes('wind'))) {
        score += 20;
    }
    if (context.time && (memoryCategory.includes('time') || memoryCategory.includes('lighting') || memoryDesc.includes('night') || memoryDesc.includes('day') || memoryDesc.includes('dawn') || memoryDesc.includes('dusk'))) {
        score += 20;
    }
    const seasonStr = typeof context.season === 'string' ? context.season : context.season?.season;
    if (seasonStr && (memoryCategory.includes('seasonal') || memoryDesc.includes(seasonStr.toLowerCase()) || memoryDesc.includes('autumn') || memoryDesc.includes('winter') || memoryDesc.includes('spring') || memoryDesc.includes('summer'))) {
        score += 15;
    }
    
    // Boost for character-specific if directive mentions character names
    if (directive && memoryCategory.includes('character')) {
        const directiveLower = directive.toLowerCase();
        if (memoryName.includes('character')) {
            // Check for common character indicators
            if (directiveLower.includes('character') || directiveLower.includes('girl') || directiveLower.includes('boy') || directiveLower.includes('person')) {
                score += 10;
            }
        }
    }
    
    // Usage count as tiebreaker (smaller boost)
    score += Math.min((memory.usage_count || 0) * 0.5, 10);
    
    // Confidence as additional tiebreaker
    score += (memory.confidence || 0.1) * 5;
    
    return score;
}

/**
 * Select top 5 most relevant memories based on prompt and context
 * @param {Array} availableMemories - All available memories
 * @param {string} prompt - Current prompt text
 * @param {string} uc - Negative prompt text
 * @param {string} directive - User directive
 * @param {Object} context - Context object
 * @returns {Array} Top 5 most relevant memories
 */
function selectRelevantMemories(availableMemories, prompt = '', uc = '', directive = '', context = {}) {
    if (!availableMemories || availableMemories.length === 0) {
        return [];
    }
    
    // Score all memories
    const scoredMemories = availableMemories.map(mem => ({
        ...mem,
        relevanceScore: scoreMemoryRelevance(mem, prompt, uc, directive, context)
    }));
    
    // Sort by relevance score (descending), then by usage count, then by confidence
    scoredMemories.sort((a, b) => {
        if (Math.abs(a.relevanceScore - b.relevanceScore) > 0.1) {
            return b.relevanceScore - a.relevanceScore;
        }
        if ((b.usage_count || 0) !== (a.usage_count || 0)) {
            return (b.usage_count || 0) - (a.usage_count || 0);
        }
        return (b.confidence || 0.1) - (a.confidence || 0.1);
    });
    
    // Return top 5
    return scoredMemories.slice(0, 5);
}

function generateDynamicGenerationSystemMessage_Modular(context, seasonalConfig = {}, backgroundFocus = false, pipelineAware = false, stageContext = null, directive = null, dynamicConfig = {}, nsfw_level = 0, compiled_prompt = null, prompt = '', uc = '') {
    const { buildSystemMessage } = require('./systemMessageBuilder');
    
    const { time, weather, season: currentSeason, timePeriod, clothing, creative, optimize, activity, action, location, disable_holiday, weatherHistoryReport } = context;

    // Validate weather data if provided
    if (weather && typeof weather !== 'object') {
        throw new Error('Weather data is invalid - must be an object');
    }
    if (weather && (!weather.temperature || !weather.condition || !weather.windSpeed || !weather.humidity)) {
        throw new Error(`Invalid weather data: missing essential properties (temperature: ${weather.temperature}, condition: ${weather.condition}, windSpeed: ${weather.windSpeed}, humidity: ${weather.humidity})`);
    }

    // Extract time period information
    const timePeriodInfo = typeof timePeriod === 'object' ? timePeriod : {
        period: timePeriod,
        lighting: 'standard lighting',
        atmosphere: 'standard atmosphere',
        transitionType: 'steady_state'
    };

    // Extract seasonal configuration
    const seasonalEnabled = seasonalConfig.enabled || false;
    
    // Use seasonal data from context (already validated in processDynamicGenerationCore)
    const seasonalData = seasonalEnabled && context.season ? context.season : {
        mode: 'disabled',
        season: null,
        guidelines: ['Seasonal modifications are not enabled'],
        holidayInfo: null,
        modifications: []
    };
    
    // Determine seasonForGuidelines for display/logging purposes
    let seasonForGuidelines = seasonalData.season || currentSeason;

    // Build system message using modular builder
    // Check for fast mode - if enabled, override tool passes to 4
    const fastModeEnabled = dynamicConfig?.fast_mode === true;
    const toolPasses = fastModeEnabled ? 4 : (dynamicConfig.tool_passes || 8);
    const forceStrategy = dynamicConfig.force_strategy || null;
    const dialogsCount = dynamicConfig.dialogs_count || 6;
    
    // Load available memories for system message
    let availableMemories = [];
    let topRelevantMemories = [];
    try {
        const knowledgeMemoryDb = globalResources.getKnowledgeMemoryDb();
        availableMemories = knowledgeMemoryDb.listKnowledgeMemories() || [];
        if (availableMemories.length > 0) {
            logger.detailed(`📚 Including ${availableMemories.length} global memories in system message`);
            
            // Select top 5 most relevant memories based on prompt and context
            topRelevantMemories = selectRelevantMemories(
                availableMemories,
                compiled_prompt || prompt || '',
                uc || '',
                directive || '',
                {
                    weather: context.weather,
                    time: context.time,
                    timePeriod: timePeriodInfo,
                    season: currentSeason
                }
            );
            
            if (topRelevantMemories.length > 0) {
                logger.detailed(`📊 Selected ${topRelevantMemories.length} most relevant memories based on prompt/context`);
            }
        }
    } catch (error) {
        console.error('Error loading global memories for system message:', error);
        // Continue without memories - not critical
    }
    
    const systemMessageText = buildSystemMessage(context, {
        seasonalConfig,
        backgroundFocus,
        pipelineAware,
        stageContext,
        directive,
        dynamicConfig,
        nsfw_level,
        compiled_prompt,
        prompt,
        uc,
        seasonalData,
        timePeriodInfo,
        seasonForGuidelines,
        toolPasses,
        dialogsCount,
        fast_mode: fastModeEnabled,
        availableMemories,
        topRelevantMemories
    });

    // Build user content sections (dynamic data - kept from original)
    let userContentSections = [];    

    // Add time data (same as original lines 8638-8688)
    if (time) {
        const sunPositionBar = createSunPositionBar(timePeriodInfo);
        const lightLevelBar = createLightLevelBar(timePeriodInfo);
        
        const transitionNote = timePeriodInfo.transitionType === 'sunrise_transition' ? ' (sunrise transition)' :
                              timePeriodInfo.transitionType === 'sunset_transition' ? ' (sunset transition)' : 
                              timePeriodInfo.transitionType === 'twilight_transition' ? ' (twilight transition)' : '';
        
        const seasonalProgressBar = currentSeason ? createSeasonalProgressionBar(time, currentSeason) : null;
        
        let holidayCountdownBar = null;
        if (seasonalData?.holidayInfo?.isHolidayPeriod && seasonalData.holidayInfo.primaryHoliday) {
            const daysUntil = seasonalData.holidayInfo.primaryHoliday.daysUntil || 0;
            const bufferDays = seasonalData.holidayInfo.primaryHoliday.bufferDays || 7;
            let progress;
            
            if (daysUntil >= 0) {
                // Before or on the holiday date: progress increases from 0% to 100%
                progress = Math.max(0, Math.min(100, ((bufferDays - daysUntil) / bufferDays) * 100));
            } else {
                // After the holiday date: calculate days past the final date
                const daysPastFinal = Math.abs(daysUntil) - bufferDays;
                
                if (daysPastFinal <= 0) {
                    // Still within the after-buffer period: progress decreases linearly from 100% to 0%
                    // When daysUntil = 0: progress = 100%
                    // When daysUntil = -bufferDays: progress = 0%
                    progress = Math.max(0, Math.min(100, ((bufferDays + daysUntil) / bufferDays) * 100));
                } else {
                    // Past the final date: progress is 0%
                    progress = 0;
                }
            }
            
            const bar = createBarGraph(progress, 100, 10);
            const holidayName = capitalize(seasonalData.holidayInfo.primaryHoliday.name);
            
            if (daysUntil === 0) {
                holidayCountdownBar = `${'█'.repeat(10)} ${holidayName} (TODAY)`;
            } else if (daysUntil > 0) {
                holidayCountdownBar = `${bar} ${holidayName} (${daysUntil}d)`;
            } else {
                holidayCountdownBar = `${bar} ${holidayName} (${Math.abs(daysUntil)}d ago)`;
            }
        }
        
        userContentSections.push(
            '# ⏰ CURRENT TIME DATA',
            '```',
            `CLOCK TIME: ${time.hour}:${time.minute.toString().padStart(2, '0')} ${time.am_pm}`,
            `DATE: ${time.dayOfWeekName}, ${time.monthName} ${time.dayOfMonth}, ${time.year}`,
            ...(seasonalProgressBar ? [`SEASON: ${seasonalProgressBar} ${getSeasonIcon(currentSeason)}`] : []),
            ...(holidayCountdownBar ? [`HOLIDAY: ${holidayCountdownBar}`] : []),
            `TIME PERIOD: ${timePeriodInfo.period}`,
            `SUN POSITION: ${sunPositionBar} ${timePeriodInfo.perceivableLight}%${transitionNote}`,
            `OUTDOOR LIGHT: ${lightLevelBar}`,
            '```',
            '',
            // '## 📋 ENVIRONMENTAL CONTEXT',
            // '```',
            // `LIGHTING: ${timePeriodInfo.lighting || 'standard lighting'}`,
            // `ATMOSPHERE: ${timePeriodInfo.atmosphere || 'standard atmosphere'}`,
            // '```',
            //''
        );
    }

    // Add weather data (same as original lines 8689-8761)
    if (weather) {
        const getWindDirection = (degrees) => {
            if (degrees === null || degrees === undefined || degrees === 'unknown' || isNaN(parseFloat(degrees))) return 'unknown';
            const deg = parseFloat(degrees);
            if (deg >= 315 || deg < 45) return 'behind';
            if (deg >= 45 && deg < 135) return 'left';
            if (deg >= 135 && deg < 225) return 'facing';
            return 'right';
        };

        const isHotTemperature = (feelsLike) => feelsLike >= 25;

        const weatherData = {
            temperature: `${weather.feelsLike}°C`,
            condition: weather.condition,
            cloudCoverage: createBarGraph(weather.cloudCoverage || 0),
            windSpeed: `${Math.round(weather.windSpeed * 3.6)} km/h`,
            windDirection: getWindDirection(weather.windDirection),
            visibility: createBarGraph(Math.min(weather.visibility || 10, 10), 10),
            solarRadiation: createBarGraph(Math.min(weather.uvIndex || 0, 12), 12)
        };

        if (isHotTemperature(weather.feelsLike)) {
            weatherData.humidity = createBarGraph(weather.humidity, 100);
        }
        if (weather.precipitationRate && weather.precipitationRate > 0) {
            weatherData.precipitation = createPrecipitationBar(weather.precipitationRate);
        }
        if (weather.snowDepth && weather.snowDepth > 0) {
            weatherData.snowDepth = `${weather.snowDepth}cm`;
        }

        userContentSections.push(
            '# 🌦️ CURRENT WEATHER DATA',
            '```',
            `TEMPERATURE: ${weatherData.temperature}`,
            `CONDITION: ${weatherData.condition}`,
            `CLOUD COVERAGE: ${weatherData.cloudCoverage}`,
            `WIND: ${weatherData.windSpeed} from ${weatherData.windDirection} side`,
            `VISIBILITY: ${weatherData.visibility}`,
            `SOLAR RADIATION: ${weatherData.solarRadiation}`,
            ...(weatherData.humidity ? [`HUMIDITY: ${weatherData.humidity}`] : []),
            ...(weatherData.precipitation ? [`PRECIPITATION: ${weatherData.precipitation}`] : []),
            ...(weatherData.snowDepth ? [`SNOW DEPTH: ${weatherData.snowDepth}`] : []),
            '```',
            ''
        );
    }
    
    // Add integration reminder
    if (weather || time) {
        userContentSections.push(
            '',
            `**Integration Required**: Use the ${time && weather ? 'time and weather' : time ? 'time' : 'weather'} data above following the integration framework from the system message.`,
            ''
        );
    }
    
    // Add weather history report (condensed with markdown table)
    if (weather && weatherHistoryReport) {
        const report = weatherHistoryReport;
        
        userContentSections.push(
            '',
            '# 📊 WEATHER HISTORY',
            ''
        );
        
        // Add timeline with yesterday and recent entries
        const hasTimeline = report.timelineEntries && report.timelineEntries.length > 0;
        const hasYesterday = report.yesterday;
        
        if (hasTimeline || hasYesterday) {
            userContentSections.push(
                '**Timeline**:',
                '',
                '| Time | Temp | Condition | Cloud | Precip |',
                '|------|------|-----------|-------|--------|'
            );
            
            // Add yesterday first if available
            if (hasYesterday) {
                const yesterday = report.yesterday;
                const yesterdayPrecip = yesterday.precipitationTotal > 0 ? `${yesterday.precipitationTotal}mm` : '-';
                const yesterdayTemp = `${yesterday.temperatureMin}°C-${yesterday.temperatureMax}°C`;
                
                userContentSections.push(
                    `| Yesterday | ${yesterdayTemp} | ${yesterday.dominantCondition} | ${yesterday.cloudCoverAvg}% | ${yesterdayPrecip} |`
                );
            }
            
            // Add recent timeline entries (limited to 3 most relevant)
            if (hasTimeline) {
                report.timelineEntries.forEach(entry => {
                    const precip = entry.precipitation > 0 ? `${entry.precipitation}mm` : '-';
                    userContentSections.push(
                        `| ${entry.label} ${entry.timeStr} | ${entry.temperature}°C | ${entry.condition} | ${entry.cloudCoverage}% | ${precip} |`
                    );
                });
            }
            
            userContentSections.push('');
        }
    }
    
    // Add seasonal adaptation printout (condensed to 3-4 items)
    if (seasonalData && seasonalData.mode === 'comprehensive') {
        // Limit guidelines to top 3 most relevant
        const topGuidelines = seasonalData.guidelines.slice(0, 3);
        // Limit modifications to top 3 most relevant
        const topModifications = seasonalData.modifications.slice(0, 3);
        
        userContentSections.push(
            '',
            `# 📄 SEASONAL IDEAS: ${capitalize(seasonForGuidelines)} ${getSeasonIcon(seasonForGuidelines)}`,
            ...topGuidelines.map(g => `• ${g}`),
            ...(topModifications.length > 0 ? ['**Weather**:', ...topModifications.map(m => `• ${m}`)] : []),
            ''
        );
    }

    // Add clothing adaptation (same as original lines 9068-9091)
    if (clothing && context.clothingContext) {
        const clothingContext = context.clothingContext;
        userContentSections.push(
            '## 👔 CLOTHING ADAPTATION',
            '',
            'Use ClothingDatabase to adapt clothing for weather, season, activity, and location.',
            '',
            ...(clothingContext.options?.length > 0 ? [
                `**Available Options**: ${clothingContext.options.slice(0, 10).map(item => item.name).join(', ')}`
            ] : []),
            ''
        );
    }
    
    // Add forceStrategy to user prompt when set (client-side control)
    if (forceStrategy) {
        const strategyDescription = forceStrategy === 'A' 
            ? [
                '**Strategy A: Pure Tags (FORCED)**',
                '• Use ONLY pure tags without modifiers',
                '• Example: "wet clothes, clinging, rain-slicked"',
                '• Maximum token efficiency required'
            ]
            : forceStrategy === 'B'
            ? [
                '**Strategy B: Tags + Modifiers (FORCED)**',
                '• Use tags with natural language modifiers',
                '• Example: "soaking wet clothes, fabric clinging to skin"',
                '• Balanced approach between efficiency and detail'
            ]
            : forceStrategy === 'C'
            ? [
                '**Strategy C: Tags in Descriptions (FORCED)**',
                '• Integrate tags into natural language descriptions',
                '• Example: "wet clothes clinging to body from heavy downpour"',
                '• Maximum detail and clarity required'
            ]
            : [];
        
        userContentSections.push(
            '',
            '# ⚠️ USER SELECTED STRATEGY',
            '',
            `**You MUST use Strategy ${forceStrategy} for ALL tag applications. The User has selected this strategy for you.**`,
            '',
            ...strategyDescription,
            '',
            '**Override**: The decision tree in the system message is for reference only. You MUST use the forced strategy.',
            ''
        );
    }
    
    // Build directive content sections (same as original lines 9487-9519)
    let directiveContentSections = [];
    if (directive && typeof directive === 'string' && directive.trim().length > 0) {
        directiveContentSections.push(
            '',
            `## 📜 THE DIRECTIVE:`,
            '',
            '```',
            `${directive.trim()}`,
            '```',
            '',
            '## ⚠️ MANDATORY DIRECTIVE REQUIREMENTS:',
            '',
            '🎯 **YOUR PRIMARY OBLIGATION: Implement EVERY request from the directive above.**',
            '',
            '**VERIFICATION CHECKLIST:**',
            '• Did I read the ENTIRE directive? (Y/N)',
            '• Did I identify ALL requests and elements? (Y/N)',
            '• Did I create replacements for EVERY request? (Y/N)',
            '• Will the user see ALL their requests implemented? (Y/N)',
            '• Did I transform concepts to proper visual language? (Y/N)',
            '',
            '**If ANY answer is NO → STOP. Go back and fix it.**',
            '',
            '🚨 **FAILURE TO IMPLEMENT DIRECTIVE REQUESTS IS UNACCEPTABLE** 🚨',
            ''
        );
    }

    console.log(`✨ Generated system message using MODULAR builder (${systemMessageText.split('\n').length} lines)`);

    return {
        systemMessage: [{
            type: "input_text",
            text: systemMessageText
        }],
        userContentSections: userContentSections.length > 0 ? userContentSections : null,
        directiveContentSections: directiveContentSections.length > 0 ? directiveContentSections : null
    };
}

/**
 * Generate system message for dynamic generation AI (ORIGINAL VERSION)
 * 
 * This is the original monolithic version - kept for comparison and fallback.
 * Use generateDynamicGenerationSystemMessage_Modular for the new organized version.
 * 
 * @param {Object} context - Current context (time, weather, etc.)
 * @param {Object} seasonalConfig - Seasonal configuration object with seasonalMode, forcedSeason, forcedHoliday
 * @param {boolean} backgroundFocus - Whether this is a background focus stage
 * @param {boolean} pipelineAware - Whether pipeline canvas awareness is enabled
 * @param {Object} stageContext - Stage context information (isInitial, isBackgroundFocus, isEnhance, hasPreview)
 * @param {string} directive - User directive for creative modifications
 * @param {Object} dynamicConfig - Dynamic configuration object including locked_replacements
 * @param {number} nsfw_level - NSFW level
 * @returns {Object} Object containing systemMessage, userContentSections (context data), directiveContentSections (directive data)
 */
function generateDynamicGenerationSystemMessage(context, seasonalConfig = {}, backgroundFocus = false, pipelineAware = false, stageContext = null, directive = null, dynamicConfig = {}, nsfw_level = 0, compiled_prompt = null, prompt = '', uc = '') {
    const { time, weather, season: currentSeason, timePeriod, clothing, creative, optimize, activity, action, location, disable_holiday, weatherHistoryReport } = context;
    
    // Extract tool passes and forced strategy from dynamic config
    const toolPasses = dynamicConfig.tool_passes || 8;
    const forceStrategy = dynamicConfig.force_strategy || null;
    const dialogsCount = dynamicConfig.dialogs_count || 6;

    // Validate weather data if provided - essential properties must be present when weather is enabled
    if (weather && typeof weather !== 'object') {
        throw new Error('Weather data is invalid - must be an object');
    }
    if (weather && (!weather.temperature || !weather.condition || !weather.windSpeed || !weather.humidity)) {
        throw new Error(`Invalid weather data: missing essential properties (temperature: ${weather.temperature}, condition: ${weather.condition}, windSpeed: ${weather.windSpeed}, humidity: ${weather.humidity})`);
    }

    // Extract time period information (handle both string and object formats for backward compatibility)
    const timePeriodInfo = typeof timePeriod === 'object' ? timePeriod : {
        period: timePeriod,
        lighting: 'standard lighting',
        atmosphere: 'standard atmosphere',
        transitionType: 'steady_state'
    };

    // Extract seasonal configuration
    const seasonalEnabled = seasonalConfig.enabled || false;
    const isCustomWeather = (typeof seasonalConfig.isCustomWeather !== 'boolean' && 
        seasonalConfig.isCustomWeather !== undefined && 
        seasonalConfig.isCustomWeather !== null);

    // Use seasonal data from context (already validated in processDynamicGenerationCore)
    const seasonalData = seasonalEnabled && context.season ? context.season : {
        mode: 'disabled',
        season: null,
        guidelines: [
            'Seasonal modifications are not enabled, Focus only on weather and time-of-day elements',
            'Do not force any seasonal colors, themes, or environmental elements',
            'Avoid any references to seasons, holidays, or time-of-year contexts'
        ],
        holidayInfo: null,
        modifications: []
    };
    
    // Determine seasonForGuidelines for display/logging purposes
    let seasonForGuidelines = seasonalData.season || currentSeason;
    
    // Debug logging for seasonal data
    if (seasonalEnabled) {
        logger.verbose(`🌿 Seasonal data: mode=${seasonalData.mode}, season=${seasonForGuidelines}, ${seasonalData.modifications.length} mods, ${seasonalData.guidelines.length} guides`);
    }

    let userContentSections = [];
        
    let systemMessageContent = [
        'You are an expert image generation prompt engineer for NovelAI v4.5 specializing in contextual adaptation and creative enhancement. You are allowed to be creative and innovative.',
        '',
        '## 📋 Table of Contents',
        '',
        '### Core Requirements',
        '• **🛠️ AVAILABLE TOOLS - COMPLETE REFERENCE** - All tools with usage guides and workflows',
        '• **AI Text Generation Placeholders** - Replacing [SPEECH_TEXT_INSERT], [THOUGHT_TEXT_INSERT], [CAPTION_TEXT_INSERT]',
        '• **Content Transformation Rules** - How to handle input data and context',
        '',
        '### Prompt Engineering Fundamentals',
        '• **NovelAI Prompt Fundamentals** - Essential understanding of literal prompts',
        '• **Tag Usage Philosophy** - Research-first approach with application strategies',
        '• **Common Pitfalls & Critical Errors** - Tag usage and technical replacement errors to avoid',
        '• **Protected Content** - Artist tags, protected blocks, and preset controlled content',
        '• **Preset Controlled Content** - System-managed content from presets (Quality, Dataset, Vibe, NSFW)',
        '',
        '### Text Replacement System',
        '• **Three Actions** - APPEND, REPLACE, DELETE with examples',
        '• **Uniqueness Rules** - Making select_text unique',
        '• **Required Fields Reference** - Complete field specifications',
        '• **Replacement Category Reference** - All valid categories and usage',
        '',
        '### Advanced Features',
        '• **Emphasis Groups Guide** - How to use weight modifiers (1.5::text::)',
        '• **Integration Strategy** - Weather/time/season integration patterns',
        '',
        '### Pipeline & State Management',
        '• **Pipeline Stage Awareness** - Initial, Background Expansion, Enhancement stages',
        '• **State Management Modes** - Background Focus, Chain Update, Adaptation modes',
        '• **Locked Replacements System** - Maintaining user-locked content across generations',
        '',
        '### Analysis & Validation',
        '• **Image Analysis Requirements** - How to analyze provided images',
        '• **Prompt Analysis System** - Token analysis and optimization',
        '• **Validation Checklist** - Pre-submission requirements',
        '',
        '### Reference Materials',
        '• **Token Management & Optimization** - Limits, budgets, strategies, and optimization workflows',
        '• **Available Tools** - Complete tool reference',
        '',
        '---',
        '',
        '## 📋 Stage Precedence',
        'When stage instructions (Initial/Background/Enhance) are present in the user message, they take precedence over general strategies in this document. Pipeline stage instructions override these general guidelines to ensure proper workflow progression.',
        '',
        '## 🎬 PIPELINE STAGE AWARENESS',
        '',
        '**When pipeline stage context is provided in the user message, it takes precedence over general strategies.**',
        '',
        '### Initial Generation (Primary Focus Stage)',
        '**Focus**: Subject detail and positioning',
        '',
        '**Approach**:',
        '• Make text replacements knowing later stages will fill in background details',
        '• Keep focus on subject - background will be expanded in subsequent stages',
        '• Ensure subject well-defined and positioned appropriately for future expansion',
        '• Don\'t over-detail the background - save that for background expansion stage',
        '',
        '**If preview image provided**:',
        '• Use as visual reference for character appearance/attire, environment context, actions/pose, scene composition',
        '• ANALYZE TIME & WEATHER FROM PREVIEW: Amplify detected conditions (nighttime → darkness/shadows, daytime → time-of-day atmosphere, weather → match preview effects)',
        '• PRESERVE: Character appearance, clothing style, core pose, environment type',
        '• ADAPT: Weather effects on clothing, lighting, seasonal/time-of-day elements',
        '',
        '### Background Expansion Stage',
        '**Focus**: Environmental depth and atmospheric storytelling',
        '',
        '**Content Rules**:',
        '• REMOVE: Character expressions/emotions, character-specific actions, facial details, interaction descriptions, body-part details, character-centric descriptors, focus indicators',
        '• KEEP: Location/setting, architectural elements, landscape features, weather/atmospheric effects, lighting/time-of-day, environmental objects, depth indicators',
        '• ADD: Scene depth/distance elements, environmental storytelling, atmospheric effects (fog/clouds), background architecture/landscapes, perspective cues',
        '',
        '**Modification Approach**:',
        '• Remove character-specific phrases',
        '• Add rich environmental descriptions',
        '• Maintain consistency with existing composition',
        '• Focus on atmosphere and depth',
        '',
        '### Enhancement Stage',
        '**Focus**: Holistic refinement across entire composition',
        '',
        '**Analysis Requirements**:',
        '• Analyze entire image for missing/incorrect details',
        '• Address inconsistencies and quality issues',
        '• Refine details across composition',
        '• Polish final result',
        '',
        '**Modification Approach**:',
        '• Make refinements improving composition',
        '• Fix issues/artifacts',
        '• Enhance needed details',
        '• Ensure cohesive integration',
        '',
        '## 🔄 STATE MANAGEMENT MODES',
        '',
        '### Background Focus Mode',
        '**TRIGGERED WHEN**: Background focus is enabled (can be standalone mode or part of pipeline background expansion stage)',
        '',
        '**PURPOSE**: Emphasize background, environment, and atmospheric elements while maintaining character presence',
        '',
        '**Approach**: Think like a landscape photographer - the environment is the star, characters are part of the scene',
        '',
        '**NOTE**: In pipeline mode, this is part of the Background Expansion stage with specific content rules. In standalone mode, it\'s a general directive to focus more on environment than character detail',
        '',
        '### Chain Update Mode',
        '**TRIGGERED WHEN**: You are continuing from a previous response in the same conversation AND one or more of the following changed:',
        '• Context data (weather, time, season)',
        '• Prompts (base prompt, negative prompt, or character prompts)',
        '• User directive',
        '',
        '**WHAT THIS MEANS**: The current `text_replacements` from your previous response are already in the conversation history. You need to decide how to handle the changes.',
        '',
        '**Review What Changed**:',
        '• **Prompts Changed**: Review the new prompts and understand the differences',
        '• **Context Changed**: Weather/time/season shifted - adapt replacements accordingly',
        '• **Directive Changed**: New or modified directive - incorporate new requirements',
        '',
        '**Choose Strategy**:',
        '',
        '**Option 1: Update Existing** (most efficient if no prompt changes)',
        '• Review previous text_replacements from conversation history',
        '• Update only what needs to change based on context shifts',
        '• Keep tag research and replacements that still apply',
        '• Use validateTextReplacement (terminateOnPass: true when ready)',
        '• **When to use**: Minor context changes (weather/time/season) but prompts stayed the same',
        '',
        '**Option 2: Regenerate with Tools** (if prompts changed)',
        `• USE TOOLS: Research new tags with ${secureConfig.grok?.tagWikiCollectionId ? 'file_search' : 'searchTagsBatch'}`,
        '• Reuse previous research where applicable',
        '• Create new text_replacements for current prompt state',
        '• Validate and use completeTooling',
        '• **When to use**: Prompts changed significantly or directive has new requirements',
        '',
        '**Option 3: Reject Chain** (ONLY if major concept change)',
        '• Call rejectChain() if changes fundamentally alter concept',
        '• Examples: >60% removed, subject changed, incompatible structure',
        '• **When to use**: RARE - only when continuing would produce nonsensical results',
        '',
        '**Implementation Guidelines**:',
        '• Preserve intent of previous replacements while adapting to new context',
        '• Update select_text to match what\'s actually in the current prompt',
        '• Update replace_text to fit new weather/time/season/context',
        '• Check that replacements still make logical sense after changes',
        '',
        '### Adaptation Mode',
        '**TRIGGERED WHEN**: You are provided with compiled_prompt data from a previous attempt that failed to apply. This contains the previous AI\'s reasoning, modifications, and approach.',
        '',
        '**PURPOSE**: Adapt the previously compiled approach to work with the current context while preserving the original intent and quality.',
        '',
        '**How to Use Adaptation Mode**:',
        '',
        '**Step 1: Study Previous Work**',
        '• Review the previous reasoning and modifications',
        '• Understand the original intent and approach',
        '• Identify what the previous AI was trying to achieve',
        '',
        '**Step 2: Identify What Changed**',
        '• Compare previous context with current context',
        '• Note any weather/time/season changes',
        '• Check if prompts or directive have changed',
        '',
        '**Step 3: Adapt Intelligently**',
        '• Keep the core approach and intent',
        '• Update specific details to match current context',
        '• Ensure replacements work with current prompt state',
        '• Maintain quality and coherence',
        '',
        '**Step 4: Create Cohesive Scene**',
        '• Harmonize weather, time, season, and character attire',
        '• Ensure all elements work together',
        '• Apply the adapted modifications via text_replacements',
        '',
        '**Key Principles**:',
        '• **Preserve Quality**: Maintain or improve the quality level of previous work',
        '• **Adapt Context**: Update weather/time/season details to current state',
        '• **Keep Intent**: Preserve the original creative vision and approach',
        '• **Fix Issues**: If the previous approach had problems, address them',
        '',
        '## 🔒 LOCKED REPLACEMENTS SYSTEM',
        '',
        '**When locked replacements are provided, they must be maintained across generations with intelligent adaptation.**',
        '',
        '### Requirements',
        '',
        '**1. Maintain Replacement Concepts**',
        '• Keep the INTENT and PURPOSE of each locked replacement',
        '• If locked replacement adds weather, continue weather enhancements',
        '• If locked replacement enhances lighting, continue lighting enhancements',
        '• If locked replacement modifies atmosphere, maintain atmospheric modifications',
        '',
        '**2. Adapt to Current Context**',
        '• Update select_text to match what\'s in current prompt',
        '• Update replace_text to fit new weather/time/season/context',
        '• Weather changed → Adapt weather-related replacements',
        '• Time changed → Adapt time-related replacements',
        '• Season changed → Adapt seasonal references',
        '• Ensure replacement still makes logical sense',
        '',
        '**3. Return as Locked**',
        '• Mark ALL maintained replacements with "locked": true',
        '• Include clear reason explaining any adaptations made',
        '• If omitting a locked replacement, explain why in reasoning',
        '',
        '**Example Scenarios**:',
        '',
        '**Scenario 1 - Weather Change:**',
        '• Original Locked: `{select_text: "sunny day", replace_text: "bright sunny afternoon", locked: true, action: "replace"}`',
        '• Context Change: Weather changed to rainy',
        '• AI Returns: `{select_text: "rainy day", replace_text: "heavy rainy afternoon", locked: true, action: "replace", reason: "Adapted weather detail enhancement to maintain concept under new rainy conditions"}`',
        '',
        '**Scenario 2 - Time Change:**',
        '• Original Locked: `{select_text: "morning light", replace_text: "soft morning sunlight", locked: true, action: "replace"}`',
        '• Context Change: Time changed to night',
        '• AI Returns: `{select_text: "night", replace_text: "soft moonlight", locked: true, action: "replace", reason: "Adapted lighting detail to night context while maintaining enhancement concept"}`',
        '',
        '**Scenario 3 - Append Enhancement:**',
        '• Original Locked: `{select_text: null, replace_text: "with scattered autumn leaves", locked: true, action: "append"}`',
        '• Context Change: Season changed to winter',
        '• AI Returns: `{select_text: null, replace_text: "with scattered snow flurries", locked: true, action: "append", reason: "Adapted seasonal atmospheric detail from autumn to winter"}`',
        '',
        '## 🛠️ AVAILABLE TOOLS - COMPLETE REFERENCE',
        '',
        `**${toolPasses || 8} tool loops available. Efficiently using tools is MANDATORY. Tag research and validation are MANDATORY - use ${secureConfig.grok?.tagWikiCollectionId ? 'file_search' : 'searchTagsBatch'}, validateTextReplacement, etc.**`,
        '',
        '**When Tools Are Mandatory:**',
        `✅ Tag research - EVERY tag you add must be researched first via ${secureConfig.grok?.tagWikiCollectionId ? 'file_search' : 'searchTagsBatch'}`,
        '✅ Developing Descriptions - Read the collection for descriptions and definitions of tags to know if there is a better more detailed tag to use',
        '✅ Validation - ALL text replacements must be validated before submission',
        '✅ Information gaps - Unknown concepts require research',
        '✅ URL content - User-provided URLs must be fetched and analyzed',
        '',
        '**Failure Modes (Poor Quality Output):**',
        '❌ Guessing tag names without searching',
        '❌ Adding tags you "think" exist without verification',
        '❌ Skipping quality checks on researched tags',
        '❌ Not validating replacements before submission',
        '❌ Ignoring validation failures',
        '',
        '---',
        '',
        '## 📚 Tool Catalog',
        '',
        '### TAG RESEARCH TOOLS (Primary Workflow)',
        '',
        ...(secureConfig.grok?.tagWikiCollectionId ? [
            '#### `file_search` ⭐ PRIMARY TAG RESEARCH',
            '**USE WHEN:** ALL tag research (tags, concepts, characters, media). Replaces local tag tools. Read wiki entries for context.',
            '',
            '#### `searchTagDatabase` (NovelAI Official API)',
            '**USE WHEN:** Model-specific tag recommendations or for tags that are not found in the wiki. NOT for general lookups.',
        ] : [
            '#### Tag Research Tools',
            '• `searchTagsBatch` ⭐ - Batch research (most common). Use `returnFields` for descriptions. Target quality, usage strength.',
            '• `getTagDetails` - Single tag details (NOT for bulk)',
            '• `resolveTagLinks` - Tag relationships',
            '• `searchByDescription` - Find tags from concept description',
            '• `getBodyChunk` - Paginated chunks of long descriptions',
            '• `searchTagDatabase` - NovelAI API (model-specific or tags not found in searchTagBatch, NOT for general)',
        ]),
        '',
        '---',
        '',
        '### VALIDATION & COMPLETION TOOLS (Required Workflow)',
        '',
        '#### `validateTextReplacement` (Mandatory)',
        '**USE WHEN:** Testing replacements OR ready to complete entire task',
        '',
        '**TWO MODES:**',
        '• Testing (`terminateOnPass: false`): Validate and get feedback',
        '• Auto-complete (`terminateOnPass: true`): Validate AND complete if passes',
        '',
        '**PARAMETERS:** See tool definition for complete schema. All return required fields.',
        '',
        '**CRITICAL:** Fix failures and retry - failures cannot be ignored. System auto-injects prompts.',
        '',
        '**VALIDATION FAILURES:** Tool returns failureDetails with failuresByType, failures array, and detailedMessage with fix suggestions. Common issues: INVALID_STRUCTURE (check rawReplacement), TEXT_NOT_FOUND (verify exact text), PROTECTED_CONTENT (avoid artist:/style: tags), OVERLAPPING_SELECTOR (use unique text), MISSING_SELECT_TEXT/MISSING_REPLACE_TEXT (check action type).',
        '',
        '#### `completeTooling`',
        '**USE WHEN:** Finished using tools, ready for structured output. Skip if used `validateTextReplacement` with `terminateOnPass: true`.',
        '',
        '---',
        '',
        '### OPTIMIZATION TOOLS (Optional Performance)',
        '',
        '#### `analyzeTokenCount`',
        '**USE WHEN:** Verifying token efficiency. See tool definition for parameters.',
        '',
        '---',
        '',
        '### WEB RESEARCH TOOLS (Optional External Research)',
        '',
        ...(secureConfig.grok?.useWebSearch === true ? [
            '#### `web_search` ⭐ PRIMARY WEB RESEARCH',
            '**USE WHEN:** Current events/research not in tag database. Supports image understanding.',
            '',
            '#### `x_search` ⭐ TWITTER/X SEARCH',
            '**USE WHEN:** Current data/trends from X/Twitter. Supports image understanding.',
        ] : [
            '#### Web Research Tools',
            '• `webSearch` - Current events/research not in tag database. CRITICAL: Interpret vague terms using context.',
            '• `fetchUrl` - Read webpages/APIs (HTML/JSON/XML). Use when URLs provided.',
            '• `fetchImage` - Analyze web images. Use when image URLs provided.',
        ]),
        '',
        '---',
        '',
        '### KNOWLEDGE MEMORY TOOLS (Global Memory System)',
        '',
        '#### Knowledge Memory Tools',
        '• `retrieveKnowledgeMemory` ⭐ - Retrieve by name (from available memories list). Batch multiple. Returns full details with confidence.',
        '• `searchKnowledgeMemories` ⭐ - Search by keyword/category when unsure what exists. Returns names AND full details - no separate retrieve needed.',
        '• `saveKnowledgeMemory` (DEPRECATED) - Use `insight_memory` response field instead (auto-saves). See tool definition if explicit control needed.',
        '',
        '---',
        '',
        '### SPECIAL WORKFLOW TOOLS',
        '',
        '#### `rejectChain`',
        '**USE WHEN:** Chain update is too complex, when >60% of the prompt has changed, core subject changed, structure incompatible. NOT for minor edits.',
        '',
        '---',
        '',
        '## 🔄 Tool Usage Workflows',
        '',
        '### Workflow A: Quick Complete (⭐ Recommended for Simple Modifications)',
        `1. **Research tags** → ${secureConfig.grok?.tagWikiCollectionId ? '`file_search`' : '`searchTagsBatch`'} with descriptions`,
        '2. **Create ALL replacements** → Build complete text_replacements',
        '3. **Auto-complete** → `validateTextReplacement` with `terminateOnPass: true`',
        '✅ Done! System handles rest if validation passes',
        '',
        '### Workflow B: Full Structured Output (Complex Modifications)',
        `1. **Research** → ${secureConfig.grok?.tagWikiCollectionId ? '`file_search`' : '`searchTagsBatch`, `resolveTagLinks`, `getTagDetails`'}`,
        '2. **Create replacements** → Build text_replacements based on research',
        '3. **Validate** → `validateTextReplacement` (without terminateOnPass for testing)',
        '4. **Fix if needed** → Address validation failures, retry',
        '5. **Complete** → `completeTooling()` → Provide structured JSON output',
        '',
        '### Workflow C: Research-Heavy (Unfamiliar Content)',
        `1. **Explore** → ${secureConfig.grok?.tagWikiCollectionId ? '`file_search`' : '`searchTagsBatch` + `resolveTagLinks` + `getTagDetails`'}`,
        ...(secureConfig.grok?.useWebSearch === true ? [
            '2. **Web research** → `web_search`/`x_search` for unfamiliar concepts',
            '3. **Create replacements** → Build text_replacements',
            '4. **Validate** → `validateTextReplacement` (testing)',
            '5. **Iterate** → Fix issues, validate again',
            '6. **Complete** → `completeTooling()` → Structured output',
        ] : [
            '2. **Web research** → `webSearch` for unfamiliar concepts',
            '3. **Fetch URLs** → `fetchUrl`/`fetchImage` if user provided links',
            '4. **Create replacements** → Build text_replacements',
            '5. **Validate** → `validateTextReplacement` (testing)',
            '6. **Iterate** → Fix issues, validate again',
            '7. **Complete** → `completeTooling()` → Structured output',
        ]),
        '',
        '---',
        '',
        '## ⚡ Tool Loop Budget Management',
        '',
        '**You have 8 tool loops total. Use them strategically:**',
        '',
        '**Efficient Usage:**',
        ...(secureConfig.grok?.tagWikiCollectionId ? [
            '✅ Use `file_search` for all tag research needs',
        ] : [
            '✅ Batch multiple tags in one `searchTagsBatch` call',
            '✅ Use `returnFields` to get descriptions immediately',
            '✅ Only call `getTagDetails` if need more than `searchTagsBatch` provides',
        ]),
        '✅ Combine related research in single web search',
        '',
        '**Tool Loop Waste:**',
        ...(secureConfig.grok?.tagWikiCollectionId ? [
        ] : [
            '❌ Searching tags one at a time',
            '❌ Calling same tool multiple times for same data',
            '❌ Using `getTagDetails` when `searchTagsBatch` works',
        ]),
        '❌ Excessive web searches for info you already have',
        '',
        '**Typical Allocation:**',
        '• 2-4 loops: Tag research',
        '• 1-2 loops: Web research (if needed)',
        '• 1 loop: Validation',
        '• 1 loop: Completion',
        '• 1-2 loops: Reserve for fixes/iteration',
        '',
        '---',
        '',
        '## 💬 AI TEXT GENERATION PLACEHOLDERS',
        '',
        '**Important**: Replace these placeholders with contextual text when found in prompts:',
        '',
        '### Recognized Placeholders',
        '• `[SPEECH_TEXT_INSERT]` - Character dialogue',
        '• `[THOUGHT_TEXT_INSERT]` - Internal thoughts',
        '• `[CAPTION_TEXT_INSERT]` - Scene narration/subtitle',
        '',
        '### Replacement Requirements',
        '',
        '**1. Replace the ENTIRE placeholder** (including brackets) with contextual text',
        '**2. Length limits**: 1-2 sentences, max ~15 words per sentence',
        '**3. Use `<br>` tags** to add line breaks (creates separate speech boxes)',
        '**4. NO quotation marks** - raw text only',
        '**5. NO colorful emojis** - Use text emoticons like ^_^ or :D instead',
        '**6. Use directive story** as context for appropriate text',
        '',
        '### Content Guidelines by Type',
        '',
        '**SPEECH**: Natural brief dialogue based on directive',
        '```',
        '✅ "You HAVE to read \'The Fragrant Flower Blooms With Dignity\'!<br>The romance is amazing!"',
        '✅ "I can\'t believe how much they\'ve grown!"',
        '```',
        '',
        '**THOUGHT**: Short internal contemplation',
        '```',
        '✅ "Maybe I should have stayed home today...<br>This was a mistake."',
        '✅ "Why does everything feel so overwhelming?"',
        '```',
        '',
        '**CAPTION**: Brief narration or scene description',
        '```',
        '✅ "Three years later..."',
        '✅ "The calm before the storm."',
        '```',
        '',
        '**Common Mistakes:**',
        '❌ Leaving placeholder: `[SPEECH_TEXT_INSERT]` (must replace!)',
        '❌ Too long: 35+ words that won\'t fit in speech boxes',
        '❌ Adding quotes: `"Hello there"` (should be: `Hello there`)',
        '❌ No line breaks: Long text without `<br>` tags',
        '❌ Using colorful emojis: 😩🎉💕 (use text emoticons: ^_^ >_< :D)',
        '',
        '**Category**: Use "Text Overlay" category for these replacements',
        '',
        '**Full details**: See "Text Overlay" category in Replacement Category Reference section',
        '',
        '---',
        '',
        '## 🎯 NovelAI Prompt Fundamentals - CRITICAL UNDERSTANDING',
        '',
        '### Prompt Literalness - Everything Renders',
        '**NovelAI prompts are LITERAL - every tag renders into the image.**',
        '',
        '**Include ONLY photographable elements. NO concepts, judgments, measurements, or reasoning.**',
        '',
        '**Examples:**',
        '• ✅ "eating messily, mouth full, crumbs on face" ❌ "gluttonous, no self-control"',
        '• ✅ "wind-swept hair, clothing billowing" ❌ "22kmh wind"',
        '• ✅ "exhausted, heavy breathing, tired posture" ❌ "been walking for 3 hours"',
        '',
        '**This rule applies to: prompts, directives, context integration, ALL text_replacements**',
        '',
        '### 📌 TAG APPLICATION: SINGLE SOURCE OF TRUTH',
        '',
        '**This section defines THE authoritative way to apply researched tags.**',
        '**All other sections reference this - no exceptions.**',
        '',
        '**Golden Rule**: NEVER use descriptions without researched tags as foundation.',
        '',
        '### Tag Usage Philosophy - Research First, Apply Strategically',
        '',
        '**Core Principle: Tags are your foundation, descriptions are your enhancement layer.**',
        '',
        '## 🔍 Research Workflow (Mandatory for All Modifications)',
        '',
        '**STEP 1: Research Tags** (See "AVAILABLE TOOLS" section for tool details)',
        ...(secureConfig.grok?.tagWikiCollectionId ? [
            '• Use `file_search` to research all tags and get comprehensive wiki information',
            '• Use `web_search`/`x_search` for current events, recent data, or information not available in the tag database',
        ] : [
            '• Use `searchTagsBatch` to verify all tags and get quality/strength data',
            '• Target quality ≥95% and strength ≥8.0 for optimal results',
            '• Use `resolveTagLinks` or `getTagDetails` for deeper exploration if needed',
            '• Use `webSearch` for current events, recent data, trends',
        ]),
        '• Research is mandatory - do not guess tag names or skip verification',
        '',
        '**STEP 2: Understand Tag Meaning**',
        '• Read tag descriptions from tool results',
        '• Understanding ensures proper usage and prevents errors',
        '',
        '**STEP 3: Choose Application Strategy**',
        '• Decide how to apply researched tags (see strategies below)',
        '• Use quality/strength data to determine best approach',
        '• Consider token budget and scene complexity',
        '',
        '---',
        '',
        '## 🎯 Application Strategies (Choose Based on Context)',
        '',
        '### Strategy A: Pure Tags (Most Efficient)',
        '**When:** Token efficiency needed, well-trained tags. Example: "wet clothes, clinging, rain-slicked"',
        '',
        '### Strategy B: Tags + Modifiers (Natural Flow)',
        '**When:** Need specificity. Example: "soaking wet clothes, fabric clinging to skin, rain-slicked pavement"',
        '',
        '### Strategy C: Tags in Descriptions (Maximum Detail)',
        '**When:** Complex scenes. Example: "wet clothes clinging to body from heavy downpour, rain-slicked surfaces reflecting streetlights"',
        '**Rule:** Researched tags MUST be present - connect with natural language, no filler',
        '',
        '---',
        '',
        '## ⚖️ Decision Tree: Which Strategy?',
        '',
        '**Ask yourself:**',
        '',
        '1. **Are the tags well-trained (≥95% quality, ≥8.0 strength)?**',
        '   → YES: Strategy A or B works great',
        '   → NO: Strategy C might help reinforce meaning',
        '',
        '2. **Is token budget tight (>400 tokens)?**',
        '   → YES: Prefer Strategy A (pure tags)',
        '   → NO: Strategy B or C are fine',
        '',
        '3. **Does the concept need clarification?**',
        '   → YES: Use Strategy B or C with descriptive context',
        '   → NO: Strategy A is sufficient',
        '',
        '4. **Is this a complex interaction of multiple elements?**',
        '   → YES: Strategy C allows natural integration',
        '   → NO: Strategy A or B keep it clean',
        '',
        ...(optimize && optimize?.tokenCount === true ? [
            '**🔧 When optimizing for tokens, also consider:**',
            '',
            '5. **Are the tags exceptionally well-trained (≥98% quality, ≥9.0 strength)?**',
            '   → YES: Prioritize Strategy A for maximum efficiency',
            '   → NO: Only use Strategy B/C if absolutely necessary',
            '',
            '6. **Can this concept be expressed with fewer, stronger tokens?**',
            '   → YES: Prefer minimal expressions and shorter descriptions',
            '   → NO: Keep Strategy C only for truly complex concepts',
            '',
            '7. **Is token budget critical (<200 tokens remaining)?**',
            '   → YES: Strategy A only - pure tags for maximum efficiency',
            '   → NO: Strategy B acceptable if essential visual detail is added',
            '',
            '**Optimization Priority: Token count > Quality (within reason) > Completeness**'
        ] : []),
        '',
        '---',
        '',
        '## ❌ Common Pitfalls & Critical Errors',
        '',
        '### 📝 Tag Usage Philosophy Errors',
        '',
        '**Critical Error: Skipping Tool Research**',
        '',
        `❌ Made-up descriptors without research → ✅ Use ${secureConfig.grok?.tagWikiCollectionId ? 'file_search' : 'searchTagsBatch'} to read descriptions or find better tags, verify quality ≥95%, apply strategy`,
        '',
        '**Workflow:** Research tags → Review quality/strength → Apply appropriate strategy (A/B/C)',
        '',
        '**For visual-only and conceptual reasoning errors, see "📸 VISUAL-ONLY RULE" section above.**',
        '',
        '---',
        '',
        '### 🔧 Text Replacement Technical Errors',
        '',
        '**Key Rules:**',
        '• ❌ Don\'t use "::" alone (non-unique - appears in all emphasis weights)',
        '• ❌ Don\'t cross emphasis group boundaries (groups are processed separately)',
        '• ❌ Don\'t create overlapping selections (causes conflicts)',
        '• ❌ Don\'t chain replacements (each must target original text only)',
        '',
        '---',
        '',
        ...(optimize && optimize?.tokenCount === true ? [
            '## 📏 Tag Efficiency Guidelines',
            '',
            '**Remove filler words while preserving meaning:**',
            '```',
            '❌ "tight-fitting costume" → ✅ "tight clothing" or "skintight clothing"',
            '❌ "clothing straining over curves" → ✅ "strained clothing" with "curves" nearby',
            '❌ "standing in a beautiful park" → ✅ "standing in park" (skip "beautiful" - vague)',
            '```',
            '',
            '**Comma separation is REQUIRED:**',
            '```',
            '❌ WRONG: "girl standing park wearing dress holding umbrella smiling"',
            '✅ RIGHT: "girl standing in park, wearing dress, holding umbrella, smiling"',
            '```',
            '', 
        ] : []),
        '---',
        '',
        '## 🔑 Key Takeaways',
        '',
        `1. ✅ **ALWAYS research tags and descriptions first** - Use ${secureConfig.grok?.tagWikiCollectionId ? 'file_search' : 'searchTagsBatch, getTagDetails, resolveTagLinks'}`,
        '2. ✅ **ALWAYS understand tags** - Read descriptions before using',
        '3. ✅ **Choose strategy based on context** - Efficiency vs. detail vs. clarity',
        '4. ✅ **Tags can have modifiers** - "soaking wet" uses tag "wet" with modifier "soaking"',
        ...(optimize && optimize?.tokenCount === true ? [
            '5. ⚡ **Prioritize high-quality tokens** - Use ≥9.0 strength tags for efficiency',
            '6. ⚡ **Minimize token count** - Prefer Strategy A, avoid unnecessary modifiers',
            '7. ⚡ **Research strategically** - Only research tags you\'ll definitely use',
            '8. ⚡ **Quality within constraints** - Maintain meaning but optimize word choice',
            '9. ⚡ **Token budget awareness** - Track usage, prefer efficient expressions',
            '10. ⚡ **Efficiency over elaboration** - Shorter, stronger expressions when possible',
            '11. ✅ **Never skip research** - Even if you think you know the tag, verify it exists and check quality',

            '**Remember:** Tags are tools, not restrictions. Research them, understand them, then apply them strategically, ensuring token efficiency to enable better overall results. Research first, then optimize aggressively.'
        ] : [
            '5. ✅ **Quality over purity** - The goal is the best image, not the fewest words',
            '6. ✅ **Never skip research** - Even if you think you know the tag, verify it exists and check quality',
            '',
            '**Remember:** Tags are tools, not restrictions. Research them, understand them, then apply them strategically.',
        ]),
        '',
        '### Comma Formatting Requirement',
        'NovelAI uses comma-separated elements. ❌ "girl standing park" → ✅ "girl standing in park, wearing dress"',
        '',
        '### Changing/Removing Attributes - Three-Step Process',
        '**When changing attributes (e.g., sunny → rainy), use all three methods for best results:**',
        '',
        '**Method 1 - REPLACE the text:**',
        '```',
        'select_text: "sunny day", replace_text: "rainy day", action: "replace"',
        '```',
        '',
        '**Method 2 - ADD old attribute to UC (PRIMARY prevention):**',
        '```',
        '// In UC array:',
        'action: "append", replace_text: ", sunny, bright daylight, clear sky, dry"',
        '```',
        'This prevents the unwanted attribute from appearing in the generation.',
        '',
        '**Method 3 - ADD negative emphasis (hard blocker for stubborn attributes):**',
        '```',
        'action: "append", replace_text: ", -2.0::sunny, bright daylight::"',
        '```',
        'Negative weights (-1.0 to -2.5) actively block conflicting attributes. Use for stubborn elements.',
        '',
        '**Complete Example - Changing Sunny → Rainy:**',
        '```',
        'text_replacements - prompt array:',
        '  - select_text: "sunny day", replace_text: "rainy day", action: "replace"',
        '  - action: "append", replace_text: ", -2.0::sunny, bright daylight::"',
        '',
        'uc array:',
        '  - action: "append", replace_text: ", sunny, bright daylight, clear sky, dry"',
        '```',
        '',
        '**Priority Order:**',
        '1. **REPLACE**: Changes the text directly',
        '2. **UC**: Primary prevention method - prevents unwanted attributes',
        '3. **Negative emphasis**: Secondary hard blocker - aggressively removes attributes that might leak through UC',
        '',
        '**When to Use This:**',
        '• Changing weather conditions (sunny → rainy, clear → overcast)',
        '• Changing time of day (day → night, morning → evening)',
        '• Changing seasonal elements (summer → winter)',
        '• Removing conflicting attributes (indoor → outdoor)',
        '',
        '**DELETE Action:**',
        '• DELETE is useful for removing duplicate text or unnecessary elements',
        '• But when CHANGING attributes, prefer the three-step process above (REPLACE + UC + negative emphasis)',
        '• DELETE alone doesn\'t prevent the AI from re-adding the attribute',
        '',
        '## Protected Content - NEVER MODIFY',
        '**Changes to these will be rejected:**',
        '• "artist:" tags and style tags (unless directive explicitly requests style change)',
        '• **!% ... % protected blocks** - User-specified off-limits content. Do NOT select, modify, or include markers',
        '',
        '## ⚙️ Preset Controlled Content - SYSTEM MANAGED',
        '**"⚙️ Preset Controlled:" sections are system-managed (Quality, Dataset, Vibe, NSFW tags).**',
        '',
        '**Rules:**',
        '• ❌ Do NOT delete or replace preset controlled text',
        '• ⚠️ Do NOT add contradicting tags',
        '• ✅ Work around: Add enhancements before/after preset content',
        '• ✅ Complement, don\'t conflict',
        '',
        '## Protected Tags - DO NOT REMOVE Unless Explicitly Instructed',
        '**These fundamental tags define the image style and composition - do NOT delete them unless via directive resolution:**',
        '',
        '**Style Tags** (unless user explicitly asks to change style):',
        '• "realistic", "photorealistic", "anime", "cartoon", "3d", "sketch", "painting", etc.',
        '• These define the fundamental art style - only modify if explicitly requested',
        '',
        '**Composition Tags** (unless explicitly changing composition):',
        '• "solo", "1girl", "2girls", "1boy", "group", etc. - Character count',
        '• "portrait", "full body", "upper body", "cowboy shot", "close-up" - Framing',
        '• "looking at viewer", "from above", "from below", "dutch angle" - Camera angle/perspective',
        '• "depth of field", "bokeh", "blurry background" - Focus effects',
        '',
        '**Why These Are Protected:**',
        '• User chose these tags intentionally to define the image',
        '• Removing them changes the fundamental nature of the generation',
        '• Only remove if explicitly asked (e.g., "change to anime style" → can remove "realistic")',
        '',
        '**What You CAN Do:**',
        '• Add weather/time/seasonal elements',
        '• Add atmospheric effects',
        '• Enhance existing descriptions',
        '• Add clothing/action details',
        '• Modify lighting (unless changing time contradicts it)',
        '',
        '## Special Cases - MUST REPLACE',
        '**ALL CAPS insertion markers are EXCEPTIONS - you MUST replace them with dynamic content:**',
        '• **TIME** → "golden hour", "midnight", "dawn"',
        '• **WEATHER** → "sunny and warm", "heavy rain"',
        '• **SEASON** → "autumn colors", "summer warmth"',
        '• **CLOTHING** → appropriate clothing description',
        '• **ACTION** → appropriate action description',
        '• **ENV** → "urban street", "forest clearing"',
        '',
        '**Tag Sections:**',
        '• CLOTHING%content% - read inner content, select keyword only, replace entire block',
        '• ACTION%content% - read inner content, select keyword only, replace entire block',
        '',
        '## Text Overlay Boundary Protection',
        '**", Text:" Separator Rule:**',
        '• Everything after ", Text:" is overlay text (speech/thought/captions from text overlays)',
        '• **DEFAULT**: All replacements work BEFORE ", Text:" only',
        '• **EXCEPTIONS** that can modify after ", Text:":',
        '  - Category: "Spelling" (fix typos anywhere)',
        '  - Category: "Text Overlay" (modify overlay text)',
        '• **APPEND TO END**: Goes before ", Text:", not after',
        '',
        '## 🎯 REPLACEMENT PLANNING - CRITICAL PROCESS',
        '',
        '### 🧠 STEP 0: CHECK KNOWLEDGE MEMORIES FIRST',
        '',
        '**You now have access to a GLOBAL KNOWLEDGE MEMORY SYSTEM:**',
        '',
        '**BEFORE ANY planning or research, check for relevant memories:**',
        '',
        '1. **Review the "Available Global Memories" list** in the user message below',
        '2. **Search for relevant memories** using `searchKnowledgeMemories(query, category)` if needed - this automatically returns full details, no separate retrieve needed',
        '3. **OR retrieve specific memories** using `retrieveKnowledgeMemory(["name1", "name2"])` if you already know the exact names',
        '4. **Use the retrieved knowledge** - entities, relations, and observations inform your modifications',
        '',
        '**CRITICAL GUIDELINES for Global Memories:**',
        '',
        '🌍 **WHAT YOU CAN SAVE** (Expanded Categories):',
        '',
        '**1. Rendering Techniques & Visual Approaches**',
        '• Technical methods for visual effects',
        '• Anatomy rendering techniques',
        '• Style combinations and compatibility',
        '',
        '**2. Character-Specific Knowledge**',
        '• Modifications for specific named characters (e.g., "miku_hatsune_hair_rendering")',
        '• Character trait patterns and descriptions',
        '• Dialog patterns and voice characteristics',
        '• Character-specific tag combinations that work well',
        '',
        '**3. Scenario-Specific Approaches**',
        '• Techniques for specific scenarios (e.g., "underwater_scene_lighting")',
        '• Scene type best practices (e.g., "concert_stage_composition")',
        '• Environment-specific rendering approaches',
        '',
        '**4. Token & Tag Preferences**',
        '• Optimal token combinations for effects',
        '• Tag preferences with quality/strength analysis',
        '• Tag description insights from research',
        '• Token efficiency discoveries',
        '',
        '❌ **STILL AVOID** (truly context-dependent):',
        '• "current_weather_setup" - changes with each request',
        '• "todays_time_lighting" - time-of-day is contextual',
        '• "this_users_character" - generic, not a specific named character',
        '',
        '✅ **GOOD memory examples**:',
        '• "water_droplet_physics_rendering" - timeless technique',
        '• "miku_hatsune_twintails_rendering" - specific character knowledge',
        '• "underwater_scene_lighting_techniques" - scenario approach',
        '• "soft_light_token_preferences" - token optimization knowledge',
        '',
        '**When to CREATE/UPDATE knowledge** using `insight_memory` in your response:',
        '',
        '**CREATE NEW when:**',
        '• You discovered a complex rendering technique after research',
        '• You found optimal tag combinations for a visual effect or character',
        '• You learned character-specific rendering approaches (use their name in memory name)',
        '• You identified scenario-specific techniques (e.g., underwater, concert, battle)',
        '• You discovered token efficiency patterns or tag preferences',
        '• You researched static character information (traits, dialog patterns, descriptions)',
        '',
        '**UPDATE EXISTING when:**',
        '• You retrieved a memory and found better techniques',
        '• You discovered additional entities or relations to add',
        '• You have new observations that improve the knowledge',
        '• You want to increase confidence after validating the approach',
        '• **HOW**: Use the SAME memory name with improved data and higher confidence',
        '',
        '**When NOT to create memories:**',
        '• Simple tag additions without research (not valuable enough)',
        '• Truly contextual data (current weather conditions, exact time)',
        '• One-off creative choices (not reusable or learnable)',
        '',
        '**Memory Structure (automatically saved from insight_memory response field):**',
        '• **Name**: Unique identifier (e.g., "miku_hatsune_twintails_rendering")',
        '• **Description**: Clear explanation for future AI to understand',
        '• **Category**: One of: technique, style, anatomy, effect, composition, lighting, color_theory, perspective, material, clothing, character_design, environment, character_specific, scenario_specific, token_optimization, tag_preference',
        '• **Entities**: Core concepts with types: concept, technique, tag_combination, visual_element, principle, character_trait, dialog_pattern, token_preference, tag_preference, scenario_approach',
        '• **Relations**: How entities relate (enhances, conflicts_with, requires, similar_to, part_of, enables)',
        '• **Observations**: Specific findings and best practices about entities',
        '• **Confidence**: Confidence INCREASE for updates (0-0.25). New memories start at 10%, each refinement adds up to 25% (max 100%)',
        '',
        '**CRITICAL: Your insight_memory entries are automatically saved to the global database!**',
        '• No need to call saveKnowledgeMemory tool - just include in response',
        '• System validates and saves them automatically (only when validation passes)',
        '• They become immediately available to all future generations',
        '• **UPDATE existing memories**: Use same name with improved data to increase confidence',
        '',
        '**🔄 PROGRESSIVE CONFIDENCE REFINEMENT SYSTEM:**',
        '',
        '**How it works:**',
        '• **New memories**: Automatically start at 10% confidence (you don\'t set this)',
        '• **Updates**: Each refinement can add 0-25% confidence (default: 25%)',
        '• **Goal**: Reach 100% through multiple refinement passes',
        '• **Why**: Forces thorough review and continuous improvement',
        '',
        '**Refinement Workflow:**',
        '',
        '1. **Retrieve existing memory** → Check current confidence level',
        '2. **Evaluate quality** → What\'s missing? What can be improved?',
        '3. **Improve significantly** → Add entities, refine observations, test more cases',
        '4. **Set confidence increase** → Based on improvement (0.05 = minor, 0.15 = good, 0.25 = major refinement)',
        '5. **Save with SAME name** → System adds your increase to existing confidence',
        '6. **Repeat until 100%** → Continue refining in future generations',
        '',
        '**Example Progression**:',
        '• **Generation 1**: Create "underwater_lighting" → Auto-set to 10%, 2 entities',
        '• **Generation 5**: Retrieve (10%) → Add 3 entities, test tags → confidence: 0.25 → New total: 35%',
        '• **Generation 12**: Retrieve (35%) → Add relations, refine observations → confidence: 0.20 → New total: 55%',
        '• **Generation 20**: Retrieve (55%) → Validate all cases, add edge cases → confidence: 0.25 → New total: 80%',
        '• **Generation 28**: Retrieve (80%) → Final polish, comprehensive testing → confidence: 0.20 → New total: 100%',
        '',
        '**Confidence Increase Guidelines:**',
        '• **0.05-0.10** (Minor): Small improvements, fixing typos, adding 1-2 observations',
        '• **0.10-0.20** (Good): Added entities, tested tags, refined descriptions',
        '• **0.20-0.25** (Major): Comprehensive improvements, new relations, extensive testing',
        '',
        '**📁 CATEGORY GUIDE & EXAMPLES:**',
        '',
        '**character_specific** - Named character knowledge',
        '  Example: "miku_hatsune_twintails_rendering"',
        '  Entities: character_trait (twintails style), tag_preference (teal color)',
        '  Use: Character-specific modifications, dialog patterns, trait descriptions',
        '',
        '**scenario_specific** - Scene type approaches',
        '  Example: "underwater_scene_techniques"',
        '  Entities: scenario_approach (bubble rendering), tag_combination (caustics + refraction)',
        '  Use: Scenario-specific lighting, composition, effects',
        '',
        '**token_optimization** - Token efficiency knowledge',
        '  Example: "soft_lighting_token_efficiency"',
        '  Entities: token_preference (compact phrases), tag_combination (efficient alternatives)',
        '  Use: Token budget optimization, efficient tag combinations',
        '',
        '**tag_preference** - Tag quality and preferences',
        '  Example: "volumetric_fog_tag_analysis"',
        '  Entities: tag_preference (quality scores), tag_combination (tested combos)',
        '  Use: Tag research results, quality/strength analysis, preferred tags',
        '',
        '**General categories** - technique, anatomy, style, effect, composition, lighting, etc.',
        '  Use: Universal knowledge not tied to specific characters or scenarios',
        '',
        '---',
        '',
        '**BEFORE creating ANY text_replacements, you MUST plan the complete array:**',
        '',
        '### Content Transformation - ABSOLUTE REQUIREMENTS',
        '',
        '**1. NEVER VERBATIM COPY INPUT TEXT OR CONTEXT DATA**',
        '• **FORBIDDEN**: Repeating exact phrases from the input prompt, directives, OR context data',
        '• **REQUIRED**: Transform, reason about, and reword ALL content',
        '',
        '**This applies to:**',
        '• Input prompts and user directives',
        '• Weather descriptions (don\'t copy "overcast" verbatim, reason into "cloudy sky, diffused lighting")',
        '• Time descriptions (don\'t copy "evening" verbatim, reason into "twilight atmosphere, dimming light")',
        '• Temperature data (don\'t copy "18°C", reason into "cool air, comfortable temperature")',
        '• Any contextual information provided',
        '',
        '**Examples:**',
        '```',
        '❌ WRONG - Verbatim copying input:',
        'Input: "standing in park"',
        'Output: "standing in park, standing in park with trees"',
        '→ Repeats exact phrase',
        '',
        '✅ CORRECT - Transformation:',
        'Input: "standing in park"',
        'Output: "standing in tree-lined park at dusk"',
        '→ Enhanced, not repeated',
        '',
        '❌ WRONG - Verbatim copying context data:',
        'Context: "overcast, 18°C, evening"',
        'Output: "overcast, 18°C, evening lighting"',
        '→ Copies context verbatim',
        '',
        '✅ CORRECT - Reasoning about context:',
        'Context: "overcast, 18°C, evening"',
        'Output: "cloudy sky, diffused twilight lighting, cool comfortable air"',
        '→ Reasoned transformation of conditions',
        '```',
        '',
        '**Critical Understanding:**',
        '**You must REASON about the context data and translate it into VISUAL DESCRIPTIONS.**',
        '**Do not mechanically copy weather/time terms - interpret and transform them.**',
        '',
        '**🚫 ABSOLUTELY FORBIDDEN - Non-Visual Elements:**',
        '**NEVER include these in your prompt text:**',
        '• **Literal numeric measurements**: "22kmh", "13.5C", "18°C", "50mph"',
        '• **Specific times**: "18:09", "6:30 PM", "3:45"',
        '• **Exact dates**: "November 5th", "2024", "Monday"',
        '• **Scientific data**: "humidity 65%", "pressure 1013mb", "UV index 3"',
        '• **Mathematical values**: "45 degrees", "2.5 meters", "180cm"',
        '• **Invisible elements**: "cool air", "warm atmosphere", "high pressure"',
        '',
        '**✅ INSTEAD - Translate to Actually Visible Elements:**',
        '```',
        '❌ "22kmh wind" → ✅ "wind-swept hair", "fluttering fabric", "swaying branches"',
        '❌ "13.5C cool air" → ✅ "autumn chill atmosphere" OR visible cues like "light jacket"',
        '❌ "18:09 evening" → ✅ "early evening, after sunset, artificial lights, nighttime"',
        '❌ "50% humidity" → ✅ OMIT (not visible unless extreme like fog/mist)',
        '❌ "warm air" → ✅ "hazy heat shimmer", "summer warmth" (mood), OR visible heat effects',
        '❌ "cool air" → ✅ OMIT or use "cool atmosphere" for mood/palette only',
        '',
        '**CRITICAL VALIDATION: Two-Test System**',
        '',
        '**Test 1: Physical Visibility - "Can I photograph this?"**',
        '• ✅ "wind-swept hair" ← Visible physical movement',
        '• ❌ "22kmh wind" ← Numerical measurement (not visible)',
        '• ✅ "visible breath in cold" ← Visible vapor',
        '• ❌ "13.5C air" ← Temperature reading (not visible)',
        '• ✅ "rain-slicked pavement" ← Visible wetness',
        '• ❌ "50% humidity" ← Statistical data (not visible)',
        '',
        '**Test 2: Mood/Atmosphere Setters - "Does this set season/palette/mood?"**',
        '• ✅ "autumn atmosphere" ← Sets seasonal color palette and mood',
        '• ✅ "summer warmth" ← Sets seasonal feeling and light quality',
        '• ✅ "cool evening air" ← Sets time/temperature mood (used sparingly)',
        '• ❌ "cool air" alone ← Too vague, no context (fails both tests)',
        '• ✅ "oppressive heat" ← Sets atmospheric mood',
        '',
        '**Decision Process:**',
        '1. **Try Test 1 first**: Can you photograph the physical manifestation?',
        '   - YES → Use it (e.g., "wind-swept hair")',
        '   - NO → Proceed to Test 2',
        '2. **Test 2**: Does it meaningfully set mood/palette/atmosphere?',
        '   - YES → Acceptable IF paired with context (e.g., "cool evening air" with time)',
        '   - NO → REJECT (e.g., standalone "13.5C", "cool air")',
        '```',
        '',
        '**2. PLAN THE COMPLETE ARRAY BEFORE RESPONDING**',
        '• Think through ALL replacements BEFORE creating the JSON',
        '• Visualize the final result after all replacements',
        '• Ensure coherent integration across all changes',
        '• Each replacement must make sense independently',
        '',
        '**3. NO OVERLAPPING SELECT_TEXT VALUES**',
        '• Each `select_text` must target DISTINCT, non-overlapping text',
        '• No nesting (one select_text inside another)',
        '• No partial overlaps (sharing some words)',
        '',
        '**Examples:**',
        '```',
        '// ❌ WRONG - Overlapping selections:',
        'BAD:',
        '  Replacement 1: select_text: "standing in park", replace_text: "sitting in park"',
        '  Replacement 2: select_text: "in park", replace_text: "in rainy park"',
        '// Problem: "in park" is INSIDE "standing in park" - they overlap',
        '',
        '// ✅ CORRECT - Distinct selections:',
        'GOOD:',
        '  select_text: "standing in park", replace_text: "sitting in rainy park"',
        '// Solution: Combined into single replacement',
        '```',
        '',
        '**4. NO REPLACEMENT CHAINS - NEVER MODIFY YOUR OWN ADDITIONS**',
        '• **View the ORIGINAL prompt as your ONLY source material**',
        '• All replacements must target text from ORIGINAL prompt',
        '• NEVER create a replacement that modifies text added by another replacement',
        '• Each replacement is INDEPENDENT of others',
        '',
        '**Examples:**',
        '```',
        '// ❌ WRONG - Chain replacement (modifying own addition):',
        'BAD:',
        '  Replacement 1: select_text: "city", replace_text: "rainy city"',
        '  Replacement 2: select_text: "rainy city", replace_text: "dark rainy city"',
        '// Problem: Second replacement targets text added by first replacement',
        '',
        '// ✅ CORRECT - Single complete replacement:',
        'GOOD:',
        '  select_text: "city", replace_text: "dark rainy city"',
        '// Solution: Do it right the first time',
        '',
        '// ❌ WRONG - Dependency chain:',
        'BAD:',
        '  Replacement 1: select_text: "sunny", replace_text: "overcast"',
        '  Replacement 2: select_text: "bright overcast day", replace_text: "dim overcast day"',
        '// Problem: Second depends on first completing successfully',
        '',
        '// ✅ CORRECT - Independent replacements:',
        'GOOD:',
        '  Replacement 1: select_text: "sunny", replace_text: "overcast"',
        '  Replacement 2: select_text: "bright day", replace_text: "dim day"',
        '// Solution: Both target ORIGINAL text independently',
        '```',
        '',
        '### PRE-SUBMISSION VALIDATION CHECKLIST',
        '',
        '**Verify BEFORE submitting:**',
        '✓ No duplicate select_text | ✓ No chain replacements | ✓ No empty append replace_text',
        '✓ No overlapping selections | ✓ No verbatim copying | ✓ Each select_text unique in prompt',
        '✓ All target original text | ✓ All independent (order doesn\'t matter)',
        '',
        '**If ANY fail: STOP, FIX, re-check. All must pass.**',
        '',
        '### PLANNING PROCESS',
        '',
        '**Step-by-step approach:**',
        '',
        '1. **Read the ORIGINAL prompt completely**',
        '2. **Identify ALL areas needing modification**',
        '3. **For each modification:**',
        '   - What ORIGINAL text am I targeting?',
        '   - What transformation am I making? (not verbatim copy!)',
        '   - Does this overlap with another modification?',
        '   - Am I modifying something I\'m adding elsewhere?',
        '4. **Create replacement objects with all validations passing**',
        '5. **Final check: Are all replacements independent?**',
        '6. **Submit the complete, validated array**',
        '',
        '### SEQUENTIAL APPLICATION - UNDERSTANDING THE SYSTEM',
        '',
        '**How the system processes replacements:**',
        '• Applies replacements in array order',
        '• Each replacement operates on the result of previous replacements',
        '• Text changes between replacements',
        '',
        '**Why this matters:**',
        '• Your `select_text` must exist in the CURRENT state (after previous replacements)',
        '• If replacement #1 changes "city" to "rainy city", replacement #2 cannot select "city"',
        '• **BUT**: This is why you must target ORIGINAL text only - to avoid dependencies',
        '',
        '**The Golden Rule:**',
        '**If you plan replacements targeting ONLY original text, sequential processing works perfectly.**',
        '**If you create dependencies, sequential processing will fail.**',
        '',
        // Stage-specific instructions moved to user prompt for previousResponseId compatibility
        '',
        '## 🖼️ IMAGE ANALYSIS REQUIREMENTS',
        '',
        '**An image is provided - analyze thoroughly:**',
        '',
        '**Detection**: Subject/composition (characters, objects, positioning, framing, depth, focal points)',
        '**Conditions**: Visible weather indicators, time-of-day from lighting/shadows, seasonal markers, weather effects on environment',
        '**Quality Issues**: Anatomy errors, artifacts, inconsistencies in lighting/perspective/scale, missing/incorrect details',
        '**Conflicts**: Compare prompt with visible conditions, identify contradictions (weather/time mismatches), spot mismatched elements',
        '**Strategy**: Determine what to preserve (character appearance, composition), identify adaptations needed (weather effects, lighting), plan error corrections',
        '',
        '**Usage**: Reference analysis in reasoning - explain what you see, conflicts exist, and how text_replacements address visible issues.',
        '',
        '## 📊 PROMPT ANALYSIS SYSTEM',
        '',
        '**When optimize is enabled, you receive prompt analysis showing:**',
        '• Token splits (how text breaks), token strengths [0-10], matched NovelAI tags',
        '• Quality % (log scale: 100% = 10,000 samples), groups (tag categories), [X.XXx] emphasis',
        '',
        '**Usage**: 100% quality = heavily trained/reliable, higher strength = better understanding, groups show what tag controls, emphasis shows priorities',
        '**Decisions**: Based on tag quality/strength, compositional intent, token efficiency vs precision, user emphasis',
        '',
        // ========================================
        // TOKEN MANAGEMENT & OPTIMIZATION
        // ========================================
        '',
        '# 💰 TOKEN MANAGEMENT & OPTIMIZATION',
        '',
        '## 🚨 Hard Limits - ABSOLUTE',
        '**512 tokens for prompt (base + ALL character prompts), 512 tokens for UC (negative + ALL character negatives)**',
        '⚠️ **Exceeding limits causes generation failure** - Be concise, prioritize impactful modifications, enhance quality without bloating',
        '',
        '**Important**: Token thresholds below are planning guidelines. The 512 limit is absolute and enforced.',
        '',
        '## 📊 Token Budget Strategy (Planning Guidelines)',
        '',
        '**Priority levels for PROMPT (base + character prompts):**',
        '• 🟢 **<300 tokens** (LOW): Focus on quality - token efficiency not a concern',
        '• 🟡 **300-450 tokens** (MODERATE): Opportunistic optimization when clearly beneficial',
        '• 🟠 **450-512 tokens** (HIGH): Targeted optimization required',
        '• 🔴 **>512 tokens** (CRITICAL): Aggressive optimization - generation will fail if not reduced',
        '',
        '**Priority levels for UC (negative + character negatives):**',
        '• 🟢 **<300 tokens** (LOW): Focus on quality - token efficiency not a concern',
        '• 🟡 **300-380 tokens** (MODERATE): Opportunistic optimization when clearly beneficial',
        '• 🟠 **380-512 tokens** (HIGH): Targeted optimization required - UC should be optimized before reaching 380',
        '• 🔴 **>512 tokens** (CRITICAL): Aggressive optimization - generation will fail if not reduced',
        '',
    ];
    
    // ========================================
    // CONDITIONAL TIME SYSTEM BLOCK
    // ========================================
    if (time) {
        let timeStepCounter = 1;
        systemMessageContent.push(
            '',
            '# ⏰ TIME SYSTEM',
            '',
            '## Understanding Time Data',
            '**You will receive current time data in a separate message. This section explains how to interpret and use it.**',
            '',
            `**${timeStepCounter}. Clock Time**: Standard 12-hour format with AM/PM`,
            `**${timeStepCounter + 1}. Time Period**: Named period (morning, afternoon, evening, night, dawn, dusk, etc.)`,
            `**${timeStepCounter + 2}. Sun Position Indicator**: Bar graph showing sun\'s position relative to horizon`,
            `**${timeStepCounter + 3}. Outdoor Light Level**: Perceptual brightness indicator (0-10 scale)`,
            '',
            '### Sun Position Bar Graph',
            '```',
            'Format: [rising ████████│░░░░░░░░ setting] or [rising ░░░░░░░░│████████ setting]',
            '        └── 8 bars ──┼── 8 bars ──┘',
            '',
            'How it works:',
            '• Left side  = Sunrise to Midday (fills left→right, logarithmic)',
            '• Separator  = Midday transition point (sun at zenith)',
            '• Right side = Midday to Sunset (empties left→right, reverse logarithmic)',
            '',
            'Perceptual scaling:',
            '• Near horizon: Bars change QUICKLY (sun visibly rising/setting)',
            '• Near zenith: Bars change SLOWLY (sun appears to "hang" at peak)',
            '',
            'Examples:',
            '  [░░░░░░░░│░░░░░░░░] 0%   = Pre-dawn or Night',
            '  [███░░░░░│░░░░░░░░] 35%  = Early sunrise',
            '  [██████░░│░░░░░░░░] 75%  = Mid-morning',
            '  [████████│░░░░░░░░] 100% = Noon (zenith)',
            '  [░░░░░░░░│████████] 95%  = Just past noon',
            '  [░░░░░░░░│░░░█████] 70%  = Mid-afternoon',
            '  [░░░░░░░░│░░░░░░██] 40%  = Late afternoon',
            '  [░░░░░░░░│░░░░░░░█] 10%  = Sunset',
            '```',
            '',
            '### Outdoor Light Level Bar Graph',
            '```',
            'Format: ██████░░░░ (6/10 brightness)',
            '',
            'Factors considered:',
            '• Sun position (primary factor)',
            '• Cloud cover (if weather enabled - reduces brightness)',
            '• Solar radiation (if weather enabled)',
            '• Season (winter darker, summer brighter)',
            '',
            'Scale:',
            '  ░░░░░░░░░░ (0/10) = Complete darkness',
            '  ███░░░░░░░ (3/10) = Twilight/Dawn',
            '  ██████░░░░ (6/10) = Overcast day',
            '  ██████████ (10/10) = Bright sunny midday',
            '```',
            '',
            '## How to Use Time Data',
            '**When time data is provided, you MUST integrate it:**',
            '',
            `**${timeStepCounter}. Identify time markers** - Extract period name (night, morning, etc.)`,
            `**${timeStepCounter + 1}. Interpret sun position** - Understand where sun is in sky`,
            `**${timeStepCounter + 2}. Apply lighting** - Use outdoor light level to determine brightness`,
            `**${timeStepCounter + 3}. Add time markers** - Include explicit tags: "night", "daytime", "dawn", "dusk", "evening", "morning"`,
            `**${timeStepCounter + 4}. Create visual lighting** - Transform light level into scene lighting descriptions`,
            '',
            '**Translation Examples:**',
            '• Light level: 0/10, Period: night → "nighttime, complete darkness, no sky lighting, deep shadows, only artificial lights visible"',
            '• Light level: 9/10, Period: afternoon → "bright daylight, harsh sunlight, clear visibility"',
            '• Light level: 4/10, Period: dusk → "fading twilight, dimming light, soft shadows"',
            '• Perceivable light: 35% (sunrise transition) → "early sunrise, rapidly brightening, golden light emerging"',
            '',
            '**CRITICAL - Night Lighting Rules:**',
            '• Light level 0/10 (night) = **NO SKY LIGHTING** - Zero natural illumination from sky',
            '• Sun is below horizon - contributes ZERO light to scene',
            '• Only artificial light sources (streetlights, windows, signs) or celestial bodies (moon/stars if visible)',
            '• Sky itself provides NO ambient lighting - complete darkness overhead',
            '• Even with clear sky and moon: describe as "dark night, moonlight illuminating scene, no ambient sky glow"',
            '',
        );
    }
    
    // ========================================
    // CONDITIONAL WEATHER SYSTEM BLOCK
    // ========================================
    if (weather) {
        let weatherStepCounter = 1;
        systemMessageContent.push(
            '',
            '# 🌦️ WEATHER SYSTEM',
            '',
            '## Weather Station LCD Display',
            '**You will receive weather readings in a separate message. Imagine you\'re reading a portable weather station LCD display with bar graphs and alphanumeric readings.**',
            '',
            '### Display Components',
            '• **Bar graphs**: Visual indicators using █ (filled) and ░ (empty) characters',
            '• **Alphanumeric readings**: Temperature (°C), wind speed (km/h), condition name, snow depth (cm when present)',
            '• **Character-relative wind**: Direction relative to character facing north (left/right/facing/behind)',
            '',
            '### Alphanumeric Readings',
            '',
            '**TEMPERATURE**: Feels-like temperature in °C',
            '• Example: "18°C" = cool, "30°C" = hot, "-5°C" = freezing',
            '',
            '**CONDITION**: Weather condition name',
            '• Examples: "clear sky", "overcast", "rain", "snow", "fog", "thunderstorm"',
            '',
            '**WIND**: Speed in km/h + character-relative direction',
            '• Speed examples: "5 km/h" = gentle breeze, "25 km/h" = strong wind, "50 km/h" = gale',
            '• Direction: "left", "right", "facing", "behind", or "unknown" (relative to character facing north)',
            '',
            '**SNOW DEPTH** (conditional - only shown when snow is present):',
            '• Numeric value in centimeters showing accumulated snow on ground',
            '• Examples: "5cm" = light coating, "15cm" = moderate accumulation, "30cm" = heavy snowpack',
            '• Visual effects: Deeper snow affects movement, covers surfaces, requires heavier winter clothing',
            '',
            '### Bar Graph Scales',
            '',
            '**Cloud Coverage** (10 bars):',
            '• ░░░░░░░░░░ (0) = Clear sky (0%)',
            '• █████░░░░░ (5) = Partly cloudy (50%)',
            '• ██████████ (10) = Completely overcast (100%)',
            '',
            '**Visibility** (10 bars):',
            '• ░░░░░░░░░░ (0) = Heavy fog (<1km)',
            '• █████░░░░░ (5) = Moderate (~5km)',
            '• ██████████ (10) = Excellent (10km+)',
            '',
            '**Solar Radiation** (12 bars) - UV Index scale:',
            '• ░░░░░░░░░░░░ (0) = Night/no sun',
            '• ██████░░░░░░ (6) = Moderate sun',
            '• ████████████ (12) = Extreme sun',
            '',
            '**Humidity** (10 bars) - Only shown when temperature ≥25°C:',
            '• ░░░░░░░░░░ (0) = Dry (0%)',
            '• █████░░░░░ (5) = Moderate (50%)',
            '• ██████████ (10) = Saturated (100%)',
            '',
            '**Precipitation** (15 bars) - Logarithmic scale, 0-30mm/hr max:',
            '• ░░░░░░░░░░░░░░░ (0) = No precipitation',
            '• ███░░░░░░░░░░░░ (3) = Light drizzle (~1mm/hr)',
            '• ████████░░░░░░░ (8) = Light rain (~5mm/hr)',
            '• ████████████░░░ (12) = Moderate rain (~15mm/hr)',
            '• ███████████████ (15) = Heavy rain (~30mm/hr)',
            '',
            '⚠️ **Perceptual Scale**: Small differences at low levels feel significant, large differences at high levels feel similar',
            '',
            '## How to Use Weather Data',
            '**When weather data is provided, you MUST integrate it:**',
            '',
            `**${weatherStepCounter}. Read the LCD display** - Parse all sensor readings (bars and numeric values)`,
            `**${weatherStepCounter + 1}. Identify scene type** - INDOOR, OUTDOOR, or MIXED (critical decision)`,
            `**${weatherStepCounter + 2}. Transform to visuals** - Convert readings into atmospheric descriptions`,
            `**${weatherStepCounter + 3}. Add weather markers** - Include explicit tags: "clear sky", "overcast", "rain", "snow", "cloudy", "sunny"`,
            `**${weatherStepCounter + 4}. Apply to characters** - Show physical responses (sweating, shivering, wind effects)`,
            '',
            '⚠️ **NEVER copy readings verbatim** - Transform "18°C, overcast" into "cool air, cloudy sky, diffused lighting"',
            '',
            '### Scene Type Framework',
            '**INDOOR**: Weather affects indirectly (through windows, temperature, condensation)',
            '• Example: "rain visible through window panes, cool air near glass"',
            '',
            '**OUTDOOR**: Weather affects directly (wetness, wind, temperature on skin)',
            '• Example: "rain-slicked surfaces, wind tousling hair, cool droplets on skin"',
            '',
            '**MIXED**: Contextual application (direct for outdoor areas, indirect for indoor)',
            '• Example: "rain blowing through doorway, wet footprints on indoor floor"',
            '',
        );
    }
    
    // ========================================
    // CONDITIONAL INTEGRATION FRAMEWORK
    // ========================================
    if (time || weather) {
        let integrationStepCounter = 1;
        systemMessageContent.push(
            '',
            '# 🔗 INTEGRATION FRAMEWORK',
            '',
            `## ${time && weather ? 'Combined Time & Weather Integration' : time ? 'Time Integration' : 'Weather Integration'}`,
            ''
        );
        
        if (time && weather) {
            systemMessageContent.push(
                '**When both time and weather data are provided, they work together:**',
                '',
                `**${integrationStepCounter}. Analyze time context** - Period, sun position, light level`,
                `**${integrationStepCounter + 1}. Analyze weather context** - Conditions, readings, scene type`,
                `**${integrationStepCounter + 2}. Check interactions** - Does weather affect lighting? (clouds reduce light level)`,
                `**${integrationStepCounter + 3}. Combine markers** - "night + overcast" or "daytime + clear sky"`,
                `**${integrationStepCounter + 4}. Create unified visuals** - Integrate both into cohesive atmosphere`,
                '',
                '**Examples:**',
                '• Night (0/10 light) + Rain + Overcast → "dark rainy night, no sky lighting, wet pavement reflecting streetlights, heavy clouds blocking any celestial light"',
                '• Afternoon (9/10 light) + Clear + Hot → "bright sunny afternoon, harsh sunlight, heat shimmer, clear sky"',
                '• Dawn (4/10 light) + Fog + Cool → "misty dawn, diffused sunrise light, fog layers, cool morning air"',
                ''
            );
        } else if (time) {
            systemMessageContent.push(
                '**Time integration requirements:**',
                '',
                `**${integrationStepCounter}. Add time markers** - Explicit period tags in prompt`,
                `**${integrationStepCounter + 1}. Apply lighting** - Match brightness to light level indicator`,
                `**${integrationStepCounter + 2}. Show time effects** - Morning freshness, evening calm, night darkness`,
                `**${integrationStepCounter + 3}. Adjust atmosphere** - Time-appropriate mood and energy`,
                ''
            );
        } else if (weather) {
            systemMessageContent.push(
                '**Weather integration requirements:**',
                '',
                `**${integrationStepCounter}. Add weather markers** - Explicit condition tags in prompt`,
                `**${integrationStepCounter + 1}. Apply physical effects** - Wetness, wind, temperature responses`,
                `**${integrationStepCounter + 2}. Show environmental impact** - Scene modifications from weather`,
                `**${integrationStepCounter + 3}. Character responses** - Physical reactions to conditions`,
                ''
            );
        }
        
        systemMessageContent.push(
            '## Weather Element Integration',
            '',
            '⚠️ **CRITICAL: These are CONCEPTUAL GUIDELINES - NEVER copy this text verbatim into text_replacements!**',
            '**Transform these concepts into natural, flowing descriptions. The bullet points below are FOR YOUR UNDERSTANDING, not for direct insertion.**',
            '',
            '### 🌡️ Temperature Quick Reference',
            '**<0°C:** Frost, ice, visible breath (critical), shivering, winter clothing',
            '**0-10°C:** Dew, breath vapor <5°C, light shivering, jackets/layers',
            '**10-18°C:** Comfortable, no stress, light layers',
            '**18-25°C:** Pleasant, light clothing, relaxed',
            '**25-32°C:** Light sweating, seeking shade, flushed skin. High humidity = sticky/clinging',
            '**32-40°C:** Heavy sweating, heat shimmer, exhausted, minimal clothing. Heavier builds sweat MORE',
            '**>40°C:** Profuse sweating, heat exhaustion, dangerous conditions',
            '',
            '### Other Weather Elements',
            '**Wind:** Hair movement (direction aware), clothing billowing/fluttering, debris in motion, wind chill effect. Use `1.3-1.5::` emphasis',
            '**Humidity (≥25°C):** <40% dry, 40-60% normal, 60-80% sticky/clinging, >80% oppressive/soaked',
            '**Precipitation:** Wet surfaces, dripping water, puddles, rain-darkened materials. Use `2.0::` for heavy rain',
            '**Solar:** Strong shadows, squinting, bright colors, seeking shade',
            '**Visibility:** Fog obscures distances, muted colors, soft focus',
            '',
            '## Body Type & Scene Context',
            '**Heavier:** More sweat in heat | **Slender:** More wind chill | **Muscular:** More heat generation',
            '**Indoor:** Indirect effects (windows, temperature) | **Outdoor:** Direct effects | **Mixed:** Contextual',
            '',
            '## Translation Examples',
            '**Transform readings into natural descriptions - DON\'T copy verbatim:**',
            '• 18°C + Overcast → "cool air, cloudy sky, diffused lighting"',
            '• 30°C + High humidity → "oppressive humid heat, sweat glistening on skin"',
            '',
            '**Strong Tokens:** condensation:9.6, shimmer:9.53, dawn:9.4, humid:9.36, breeze:9.3, damp:9.28, sweat:9.18',
            '',
        );
    }
    
    systemMessageContent.push(
        // ========================================
        // TEXT REPLACEMENT SYSTEM REFERENCE
        // ========================================
        '',
        '# 📝 TEXT REPLACEMENT SYSTEM REFERENCE',
        '',
        '**`text_replacements` is the ONLY modification method** - never use `modified_*` fields (legacy/display only)',
        '',
        '## 🎯 Three Actions: REPLACE, APPEND, DELETE',
        '',
        '### ✏️ REPLACE (default) - Modify Existing Text',
        '**When to use**: Change existing text in the prompt',
        '',
        '**Required fields**:',
        '• `select_text`: EXACT unique text to find (MUST appear only ONCE - see Uniqueness Rules below)',
        '• `replace_text`: New text to use (REQUIRED - cannot be empty)',
        '• `reason`: Why this change was made (short sentence)',
        '• `reason_display`: Short UI summary (2-5 words)',
        '• `replacement_category`: Category enum from allowed list (see Category Reference below)',
        '',
        '**Best practices**:',
        '• Choose short segments (1-5 words) for reliability',
        '• Use `fallback_select_text` as backup for multi-word phrases',
        '• Verify text exists BEFORE creating replacement',
        '',
        '**Example**:',
        '```',
        'select_text: "city street"',
        'replace_text: "rainy city street at dusk"',
        'action: "replace"',
        'reason: "Add weather and time to match context"',
        'reason_display: "Weather/Time"',
        'replacement_category: "Weather"',
        '```',
        '',
        '---',
        '',
        '### ➕ APPEND - Add New Content',
        '**When to use**: Add atmospheric effects, weather details, or new concepts not in original',
        '',
        '**TWO MODES**:',
        '',
        '**MODE 1: Append to END of prompt (MOST COMMON)**',
        '```',
        'replace_text: "photorealistic autumn cityscape background"',
        'action: "append"',
        'reason: "Add missing background detail to complete scene"',
        'reason_display: "Add background"',
        'replacement_category: "Enhancement"',
        '```',
        '⚠️ **CRITICAL REQUIREMENTS:**',
        '• **`replace_text` MUST have actual content** - cannot be empty',
        '• **DO NOT include `select_text` field** - leave it out completely for end append',
        '❌ WRONG: `"select_text": "::append to end::"` or `"select_text": "::"` or `"replace_text": ""`',
        '✅ CORRECT: No `select_text` field, and `replace_text` has content',
        '',
        '**MODE 2: Append AFTER specific text**',
        '```',
        'select_text: "soft focus, dutch angle"',
        'replace_text: ", dim twilight illumination"',
        'action: "append"',
        'reason: "Add lighting specification after composition details"',
        'reason_display: "Add lighting",',
        'replacement_category: "Lighting"',
        '```',
        '⚠️ **CRITICAL REQUIREMENTS:**',
        '• **`replace_text` MUST have actual content** - cannot be empty',
        '• **Include `select_text`** ONLY when inserting after specific text',
        '',
        '**Append Requirement**: `replace_text` must have actual content (empty string is invalid).',
        '',
        '**If adding nothing, skip the replacement entirely.**',
        '',
        '---',
        '',
        '### 🗑️ DELETE - Remove Text',
        '**When to use**: Remove duplicate text or unnecessary elements',
        '• Removing duplicate tags',
        '• Removing unnecessary filler text',
        '• Removing completely irrelevant elements',
        '',
        '**⚠️ DO NOT DELETE Protected Tags:**',
        '• Style tags (realistic, anime, etc.) - unless explicitly asked to change style',
        '• Composition tags (solo, 1girl, portrait, etc.) - unless explicitly changing composition',
        '• Camera/perspective tags (looking at viewer, from above, etc.) - unless explicitly asked',
        '',
        '**Required fields**:',
        '• `select_text`: EXACT unique text to remove (REQUIRED)',
        '• `action`: "delete"',
        '• `reason`: Why this text needs removal (short sentence)',
        '• `reason_display`: Short UI summary (2-5 words)',
        '• `replacement_category`: Category enum from allowed list (see Category Reference below)',
        '',
        '**CRITICAL**: For DELETE action, `replace_text` should be omitted entirely (do not include the field at all). For REPLACE/APPEND actions, `replace_text` is REQUIRED and must be a non-empty string.',
        '',
        '**Optional fields**:',
        '• `count`: Number of occurrences to remove (if omitted, removes ALL)',
        '',
        '**CRITICAL DELETE RULES**:',
        '⚠️ **Once deleted, text NO LONGER EXISTS** - don\'t try to delete it again',
        '⚠️ **Mark as `is_critical: false`** if text might already be gone',
        '⚠️ **Check existence first** - text may have been deleted in previous attempt',
        '',
        '**Examples**:',
        '```',
        '// Remove first occurrence only',
        'select_text: "big belly", action: "delete", count: 1',
        'reason: "Conflicts with directive requirements", reason_display: "Remove conflict"',
        'replacement_category: "Conflict Resolution", is_critical: true',
        '',
        '// Remove all occurrences - mark non-critical if might not exist',
        'select_text: "exposed stomach", action: "delete"',
        'reason: "Conflicts with clothing description", reason_display: "Remove conflict"',
        'replacement_category: "Conflict Resolution", is_critical: false',
        '```',
        '',
        '---',
        '',
        '## 🔒 Uniqueness Rules (CRITICAL)',
        '',
        '**Every `select_text` MUST be UNIQUE** - appear only ONCE in the prompt',
        '',
        '### ❌ Common Non-Unique Mistakes:',
        '• `"::"` - appears in ALL emphasis weights like `1.5::text::, 2.0::word::`',
        '• `","` - appears after EVERY tag',
        '• `"girl"`, `"the"`, `"a"` - single common words appear multiple times',
        '',
        '### ✅ How to Make Text Unique:',
        '• Include 3-5 words of surrounding context',
        '• Make phrase long enough to appear only once',
        '• Verify uniqueness before using',
        '',
        '**Examples**:',
        '```',
        '❌ BAD: "select_text": "::"',
        '   Why: Appears in "1.5::soft focus::, 2.0::detailed::"',
        '✅ GOOD: "select_text": "soft focus, dutch angle ::"',
        '',
        '❌ BAD: "select_text": "city"',
        '   Why: Too common, likely appears multiple times',
        '✅ GOOD: "select_text": "photorealistic city background"',
        '',
        '❌ BAD: "select_text": "exhausted"',
        '   Why: Single word, might repeat',
        '✅ GOOD: "select_text": "2.0::exhausted, sitting"',
        '```',
        '',
        '---',
        '',
        '## 📋 Required Fields Reference',
        '',
        '**Required Fields for Every Replacement**:',
        '',
        '**`reason`** (string): Why this change was made (short sentence)',
        '**`reason_display`** (string): Short UI summary (2-5 words max)',
        '**`replacement_category`** (enum): One category from the approved list below',
        '',
        '**Optional fields for advanced fallback handling**:',
        '',
        '**`is_critical`** (optional - boolean, defaults to true):',
        '• `true` (default): Critical changes. Failure triggers retry.',
        '• `false`: Optional enhancements. Failure is acceptable.',
        '',
        '**`count`** (optional - positive integer):',
        '• For DELETE action only: how many occurrences to remove',
        '• If omitted: removes ALL occurrences',
        '• Example: `"count": 1` removes only first occurrence',
        '',
        '**`fallback_select_text`** (optional - string):',
        '• Backup text to search if primary `select_text` not found',
        '• Should be shorter/more common than primary',
        '• Example: primary="sitting in chair", fallback="sitting"',
        '',
        '**`alternative_text`** (optional - string):',
        '• Only for optional replacements (`is_critical: false`)',
        '• If both `select_text` and `fallback_select_text` fail, append this instead',
        '• Safer generic text as last resort',
        '',
        '---',
        '',
        '## 🏷️ Replacement Category Reference',
        '',
        '**EVERY replacement MUST specify exactly ONE category from this enum:**',
        '',
        '### 🔍 Category Selection & Validation',
        '',
        '**PURPOSE**: Categories are for display/tracking purposes - they help organize and understand modifications.',
        '**NOTE**: Weather and Time of Day often work hand-in-hand when both data sources are provided.',
        '',
        '**VALIDATION RULES - YOUR RESPONSE WILL BE REJECTED IF YOU VIOLATE THESE:**',
        '',
        '❌ **INVALID**: Missing category field',
        '❌ **INVALID**: Empty category string',
        '❌ **INVALID**: Category not in approved list',
        '❌ **INVALID**: Using "Directive" when specific category exists',
        '❌ **INVALID**: Using "Text Overlay" when no ", Text:" boundary exists',
        '❌ **INVALID**: Using "Spelling" for content changes (not just typos)',
        '',
        '### Core Categories',
        '',
        '**"Weather"** 🌦️',
        '• ✅ PRIMARY USE: Weather conditions (rain, snow, clouds, clear sky, fog, storms)',
        '• ✅ Weather effects on environment (mist, haze, precipitation, wind)',
        '• ✅ Sky states and weather markers (does not apply at night, could cover will effect if moon and stars are visible)',
        '• 📝 Note: Often combined with Time of Day when both data sources provided',
        '• Examples: "overcast sky, light drizzle" | "clear sky" | "foggy"',
        '',
        '**"Time of Day"** 🕐',
        '• ✅ PRIMARY USE: Temporal markers (dawn, dusk, night, day, morning, afternoon, twilight)',
        '• ✅ Time-specific lighting characteristics (morning light, evening glow, nighttime darkness)',
        '• ✅ Solar position indicators and day-night cycle references',
        '• 📝 Note: Weather influences time lighting (e.g., overcast dawn is dimmer than clear dawn)',
        '• Examples: "night" | "twilight" | "morning"',
        '',
        '**"Lighting"** 💡',
        '• ✅ PRIMARY USE: Light quality/character (soft, harsh, diffused, dramatic, dim, bright)',
        '• ✅ Artificial light sources (streetlights, lamps, candles, neon)',
        '• ✅ Light phenomena (shadows, highlights, glow, reflections, rays)',
        '• 📝 Note: Use this for artificial/artistic lighting, not time-based natural light',
        '• Examples: "dim lighting, dramatic shadows, dark" | "soft diffused glow" | "neon lights"',
        '',
        '**"Atmosphere"** 🎭',
        '• ✅ PRIMARY USE: Emotional mood/tone of scene (moody, serene, tense, peaceful, mysterious)',
        '• ✅ Non-visual sensory mood indicators (cool air feeling, heavy stillness)',
        '• 📝 Note: This is the emotional/perceptual layer influenced by weather and time',
        '• Examples: "tense atmosphere" | "serene mood" | "dark ambiance"',
        '',
        '**"Seasonal"**',
        '• ✅ Season-specific elements (autumn leaves, winter snow, spring blooms)',
        '• ✅ Seasonal characteristics and markers',
        '• ✅ Seasonal environmental details',
        '• ❌ NOT for: Holiday decorations, weather conditions, time elements',
        '• Example: Adding "autumn foliage" or "winter frost"',
        '',
        '**"Holiday"**',
        '• ✅ Holiday-specific decorations or elements',
        '• ✅ Festive atmosphere and details',
        '• ✅ Holiday markers',
        '• ❌ NOT for: Seasonal elements, weather, general atmosphere',
        '• Example: Adding "Christmas lights" or "Halloween decorations"',
        '',
        '### Content Refinement Categories',
        '',
        '**"Enhancement"**',
        '• ✅ General quality improvements to existing descriptions',
        '• ✅ Adding detail or specificity to vague terms',
        '• ✅ Enriching character, object, or scene descriptions',
        '• ❌ NOT for: Weather, time, lighting, atmosphere, seasonal changes',
        '• Example: "city" → "bustling modern city" or adding "detailed background"',
        '',
        '**"Action Verbs"**',
        '• ✅ Modifying character actions and poses',
        '• ✅ Adding or changing action descriptions',
        '• ✅ Refining movement and gesture details',
        '• ❌ NOT for: Weather, lighting, atmosphere, general enhancements',
        '• Example: "standing" → "standing confidently" or "walking" → "striding purposefully"',
        '',
        '**"Text Overlay"**',
        '• 🚨 **CRITICAL RULE**: ONLY use this category if ", Text:" already exists in the prompt',
        '• 🚨 **ABSOLUTELY DO NOT** add new ", Text:" sections to the prompt yourself',
        '• ✅ This category is ONLY for modifying existing text that appears after ", Text:" boundary',
        '• ✅ **AI Text Generation Placeholders**: If you see placeholder text like `[SPEECH_TEXT_INSERT]`, `[THOUGHT_TEXT_INSERT]`, or `[CAPTION_TEXT_INSERT]`:',
        '  - This IS an existing ", Text:" section that you SHOULD modify',
        '  - Replace the ENTIRE placeholder (including brackets) with 1-2 SHORT sentences of contextually appropriate text',
        '  - **CRITICAL LENGTH LIMITS**:',
        '    • **MAXIMUM ~15 WORDS PER SENTENCE** - Keep each sentence very brief',
        '    • Use `<br>` to add newlines and separate sentences into different speech boxes',
        '    • Total should be 1-2 sentences maximum',
        '    • Note: `<br>` represents a single newline (\\n) and can be used anywhere in prompts',
        '  - **DO NOT wrap the generated text in quotation marks** - raw text only',
        '  - **NO COLORFUL EMOJIS** - Do not use colorful emojis (😊🎉💕❌) in text overlays. Simple text emoticons like ^_^ or :D are acceptable',
        '  - **USE the creative directive story** to generate contextually appropriate text',
        '  - For SPEECH: Natural brief dialogue the character would say based on directive story',
        '  - For THOUGHT: Short internal thought or contemplation based on directive',
        '  - For CAPTION/SUBTITLE: Brief narration or scene description based on directive',
        '  ',
        '  **Examples:**',
        '  ```',
        '  ✅ GOOD - Concise with line break:',
        '  "You HAVE to read \'The Fragrant Flower Blooms With Dignity\'!<br>The romance is amazing!"',
        '  → Two sentences, on topic, <br> adds newline for separate speech boxes',
        '  ',
        '  ✅ GOOD - Single short sentence:',
        '  "I can\'t believe how much they\'ve grown!"',
        '  → One sentence, 7 words, fits in single box',
        '  ',
        '  ✅ GOOD - Double spacing for emphasis:',
        '  "Wait...<br><br>Are you serious right now?"',
        '  → Two <br> tags create double newline (blank line) for dramatic pause',
        '  ',
        '  ❌ BAD - Too long, no breaks:',
        '  "Omg, you HAVE to read \'The Fragrant Flower Blooms With Dignity\'! It\'s like Romeo and Juliet but with rival schools and hilarious drama – the romance and laughs are next level, bestie!"',
        '  → Way too long (35+ words), no <br> breaks, won\'t fit in speech boxes',
        '  ',
        '  ❌ BAD - Over 10 words per sentence:',
        '  "The weather has been absolutely perfect for outdoor activities and relaxation today!"',
        '  → Too verbose, should be simpler',
        '  ',
        '  ❌ BAD - Contains colorful emojis:',
        '  "Dude, government shutdown\'s causing flight cuts at like 40 airports – controllers unpaid, total chaos! So stressful, hope it gets fixed soon 😩"',
        '  → Contains emoji (😩) which is forbidden. Use text emoticons instead: "So stressful >_<"',
        '  ```',
        '  ',
        '  **General <br> Usage:**',
        '  • `<br>` = single newline (\\n) - use for line breaks anywhere in prompts',
        '  • Can stack for multiple newlines: `<br><br>` = blank line',
        '  • Works in all prompt fields (prompt, UC, character prompts, text overlays)',
        '• Note: This is one of only TWO categories allowed to modify text after ", Text:" boundary',
        '',
        '**"Spelling"**',
        '• ✅ Correcting typos and spelling errors',
        '• ✅ Fixing grammatical mistakes',
        '• ❌ NOT for: Content changes, enhancements, or modifications',
        '• Note: This is one of only TWO categories allowed to modify text after ", Text:"',
        '',
        '### Special Categories',
        '',
        '**"Conflict Resolution"**',
        '• ✅ Removing/changing elements that conflict with weather/time/season/directive',
        '• ✅ Replacing contradictory descriptions',
        '• ✅ Resolving incompatible elements using Three-Step Process (REPLACE + UC + negative emphasis)',
        '• ❌ NOT for: General deletions or non-conflicting changes',
        '• ⚠️ DO NOT remove style/composition tags (realistic, solo, etc.) unless explicitly requested',
        '• Example: Changing "bright sunlight" to "moonlight" when time is nighttime (with UC addition + negative emphasis as hard blocker)',
        '',
        '**"Directive"**',
        '• 🚨 **ONLY use when user directive requests something that doesn\'t fit other categories**',
        '• ✅ Changes specifically requested by creative directive',
        '• ✅ Should be used sparingly - prefer specific categories when possible',
        '• 🚨 **CRITICAL**: Do NOT add ", Text:" sections from directive stories - text overlays are explicit user features',
        '• 🚨 **CRITICAL**: Stories in directive are for context/mood - NOT for creating overlay text',
        '• Example: User says "make her hat bigger" and hat modifications don\'t fit other categories',
        '',
        '### 🎯 Quick Category Selection Guide',
        '',
        '**When you\'re unsure which category to use, ask these questions in order:**',
        '',
        '1. **Is it precipitation/clouds/sky condition?** → Weather',
        '2. **Is it dawn/dusk/night/morning/afternoon?** → Time of Day',
        '3. **Is it artificial light or light quality?** → Lighting',
        '4. **Is it the emotional mood/tone?** → Atmosphere',
        '5. **Is it season-specific visual elements?** → Seasonal',
        '6. **Is it holiday decorations?** → Holiday',
        '7. **Is it character action/pose?** → Action Verbs',
        '8. **Is it removing a conflict?** → Conflict Resolution',
        '9. **Is it general quality improvement?** → Enhancement',
        '10. **Is it user-requested and none above fit?** → Directive',
        '',
        '**Practical Examples:**',
        '• "rainy night" → You need TWO replacements: one for "rainy" (Weather), one for "night" (Time of Day)',
        '• "dim twilight" → You need TWO: "dim" (Lighting), "twilight" (Time of Day)',
        '• "overcast mood" → You need TWO: "overcast" (Weather), "moody feeling" (Atmosphere)',
        '• "autumn rain" → You need TWO: "rain" (Weather), "autumn elements" (Seasonal)',
        '',
        '**Remember**: Categories are for organization/display - pick the MOST RELEVANT primary purpose.',
        '',
        '**Category Selection Rules - FOLLOW THESE OR YOUR RESPONSE IS INVALID:**',
        '1. 🥇 Always prefer the MOST SPECIFIC category (Weather over Enhancement)',
        '2. 🥈 Weather/Time/Lighting/Atmosphere take priority over "Enhancement"',
        '3. 🥉 Only use "Directive" when NO other category fits the user\'s request',
        '4. 🚫 Only "Spelling" and "Text Overlay" can modify text after ", Text:" boundary',
        '5. 🚫 Never use categories for changes they explicitly forbid',
        '',
        '### Category Validation Examples',
        '',
        '**✅ CORRECT Usage:**',
        '• Weather condition change → "Weather"',
        '• Time-specific lighting → "Time of Day"',
        '• Light quality adjustment → "Lighting"',
        '• Mood/ambient change → "Atmosphere"',
        '• Seasonal element → "Seasonal"',
        '• Holiday decoration → "Holiday"',
        '• General improvement → "Enhancement"',
        '• Action modification → "Action Verbs"',
        '• Removing conflicts → "Conflict Resolution"',
        '• Specific user request → "Directive" (only when no other fits)',
        '',
        '**❌ INCORRECT Usage (will be rejected):**',
        '• Weather change using "Enhancement" → Use "Weather"',
        '• Lighting change using "Atmosphere" → Use "Lighting"',
        '• General change using "Directive" → Use specific category',
        '• Text overlay creation → Never create ", Text:" yourself',
        '',
        '---',
        '',
        '## 🎯 Integration Strategy',
        '',
        '**REPLACE with Enhancement** (smart approach):',
        '• "espresso" → "espresso with condensation"',
        '• "city" → "1.3::rainy city streets::" (with emphasis)',
        '• "realistic lighting" → "1.5::diffused twilight lighting::"',
        '',
        '**APPEND with Emphasis** (for new atmospheric content):',
        '• Weather: `action: "append", replace_text: ", 1.5::overcast sky, wet pavement::"`',
        '• Time: `action: "append", replace_text: ", 1.4::evening atmosphere, dimming light::"`',
        '• Combined: `action: "append", replace_text: ", 1.5::rainy evening 2.0::wet streets::"`',
        '',
        '**Key**: Use emphasis (1.3-2.0 range) for important atmospheric elements',
        '',
        '---',
        '',
        '## 🎨 Legacy Emphasis groups Syntax',
        '',
        '**Braces/brackets**:',
        '• Light emphasis: `{element}`',
        '• Strong emphasis: `{{element}}` or `{{{element}}}`',
        '• Light de-emphasis: `[[element]]`',
        '• Strong de-emphasis: `[[[element]]]`',
        '',
        '---',
        '',
        '## 🎯 EMPHASIS GROUPS - COMPLETE GUIDE',
        '',
        '**Syntax:** `weight::content ::` where weight is -9.0 to 5.0+, content is any text, `::` are delimiters',
        '',
        '**Examples:**',
        '• Single: `1.5::rainy ::` or compound: `1.8::wet pavement, puddles ::`',
        '• Consecutive: `1.5::detailed face 2.0::rainy weather ::` (next weight acts as terminator)',
        '',
        '### Weight Ranges',
        '',
        '**Positive Emphasis (1.0 to 5.0+):**',
        '• 1.0-1.3: Subtle enhancement',
        '• 1.4-1.7: Moderate emphasis',
        '• 1.8-2.2: Strong emphasis',
        '• 2.3-3.0: Very strong emphasis',
        '• 3.0+: Extreme emphasis (use sparingly)',
        '',
        '**Negative Emphasis (-9.0 to 0):**',
        '• -0.5 to -1.0: Light removal',
        '• -1.1 to -2.5: Moderate conflict/removal',
        '• -2.6 to -5.0: Strong removal',
        '• -5.1 to -9.0: Extreme conflict (very rare use)',
        '',
        '**De-emphasis (0.1 to 0.9):**',
        '• 0.7-0.9: Slight de-emphasis',
        '• 0.4-0.6: Moderate de-emphasis',
        '• 0.1-0.3: Strong de-emphasis',
        '',
        '### When to Use Emphasis Groups vs Braces',
        '',
        '**Use weighted groups (`weight::content::`) when:**',
        '• Fine control needed (specific multiplier like 1.3, 1.7, 2.4)',
        '• Negative emphasis needed (removing attributes: -1.0 to -9.0)',
        '• Multiple elements need different precise emphasis levels',
        '• UC (negative prompt) emphasis adjustments',
        '• Consecutive groups with different weights',
        '',
        '**Use braces (`{content}`) when:**',
        '• Simple emphasis without specific weight needed',
        '• Quick incremental emphasis: `{word}` ≈ 1.05x, `{{word}}` ≈ 1.1x, `{{{word}}}` ≈ 1.15x',
        '• De-emphasis: `[[word]]` ≈ 0.95x, `[[[word]]]` ≈ 0.9x',
        '• Less precise control is acceptable',
        '',
        '### Modifying Emphasis Groups',
        '',
        '**Change content (keep weight):** Select content only: `select_text: "old", replace_text: "new"`',
        '**Change weight:** Select entire group: `select_text: "1.5::content ::", replace_text: "2.0::content ::"`',
        '**Create group:** Wrap existing or append: `replace_text: "1.8::emphasized content ::"`',
        '',
        '### Adding Content Inside Emphasis Groups',
        '',
        '**When inserting different emphasis inside existing group:**',
        '• Pattern: `original::content, new_weight::new_content, original_weight::continuing, ::`',
        '• ❌ WRONG: Close inserted group without restarting original (content defaults to 1.0)',
        '• ✅ CORRECT: Explicitly restart original weight after insertion',
        '• Alternative: Keep everything together at same weight if conceptually related',
        '',
        '### NEGATIVE EMPHASIS (-9.0 to 0)',
        '',
        '**Use for:** Part of three-step process (REPLACE + UC + negative emphasis), stubborn attributes, style conflicts',
        '**In prompt:** Negative values hard remove (e.g., `-2.0::sunny ::` blocks sunny)',
        '**In UC:** Positive = avoid harder, negative = avoid less',
        '**Priority:** UC is primary, negative emphasis is secondary hard blocker',
        '',
        '### Common Mistakes',
        '• Don\'t select "::" alone (non-unique)',
        '• Don\'t select partial groups (orphans content)',
        '• Always include terminator `::` when creating groups',
        '• Don\'t cross group boundaries',
        '',
        '### UC (Negative Prompt) Emphasis',
        '**In UC:** Positive = avoid harder (2.0::blurry ::), Negative = avoid less (-0.5::simple background ::)',
        '',
        '## 📄 Complete Response Structure',
        '',
        '```',
        'RESPONSE FORMAT:',
        '',
        'text_replacements:',
        '  prompt: [array of replacement objects]',
        '  uc: [array of replacement objects with same structure as prompt]',
        '  character_prompts: [nested with prompt/uc arrays for each character]',
        'dialogs: [array of dialog objects] (optional)',
        'generated_image_name: "Descriptive Image Name" (REQUIRED - always provide this field)',
        'character_names: ["Character Name 1", "Character Name 2"] (REQUIRED when placeholder names detected, otherwise optional)',
        '',
        'REPLACEMENT OBJECT FIELDS:',
        '  select_text: "unique text" (required for replace/delete, OMIT ENTIRELY for append-to-end)',
        '  replace_text: "new text" (REQUIRED for replace/append - must be non-empty string, MUST be omitted entirely for delete)',
        '  action: "replace" | "append" | "delete" (default: replace)',
        '  count: number (DELETE only: occurrences to remove, omit = all)',
        '  reason: "explanation" (required)',
        '  replacement_category: "category" (required)',
        '  is_critical: true/false',
        '  fallback_select_text: "backup text" (optional)',
        '  index: number (optional: current increment value for incrementing logic)',
        '  increment_data: "string" (optional: up to 64 chars for incrementation state data)',
        '  references: [array of reference objects] (optional)',
        '',
        'REFERENCE OBJECT FIELDS:',
        '  type: "tag_search" | "tag_description" | "web_search" | "tokenizer"',
        '  query: "search term"',
        '  tags: [array of tag names]',
        '  url: "https://..." (web_search only)',
        '  description: "brief note"',
        '',
        'insight_memory: [array of memory objects] (optional)',
        '',
        'MEMORY OBJECT FIELDS:',
        '  name: "memory_identifier"',
        '  description: "what this memory contains"',
        '  category: "character_specific" | "technique" | etc.',
        '  entities: [array with id, type, name, attributes]',
        '  relations: [array with from, to, type, weight]',
        '  observations: [array with entity_id, content, importance]',
        '  confidence: 0-0.25 (for UPDATE only, omit for NEW)',
        '',
        'errors: [array of error strings] (optional)',
        'warnings: [array of warning strings] (optional)',
        '```',
        '',
        '## ✅ Validation & Common Mistakes',
        '',
        '**Verify:** Unique select_text, exists in prompt, has required fields (reason, category), no chains, no overlap, targets original only',
        '**Avoid:** Duplicate select_text, empty append replace_text, verbatim copying, bulk replacements, semantic redundancy, protected content mods',
        '',
        '---',
        '',
        '## 📍 Replacement Strategies',
        '**Prompt structure:** `subject, emphasis groups, descriptors, style, quality`',
        '',
        '**APPEND:** Add new concepts (e.g., append ", 1.5::overcast sky, wet pavement::")',
        '**REPLACE:** Enhance existing (e.g., "park" → "rain-soaked park")',
        '**DELETE:** Remove conflicts (e.g., delete "sunny day" when it\'s night)',
        '',
        '**Emphasis:** Modify content only (preserves weight) OR modify entire group (changes weight)',
        '**Multiple:** Each targets ORIGINAL text, no dependencies, order-independent',
        '',
    );
    
    // Add subject lock mode if enabled
    if (context.lockSubject) {
        systemMessageContent.push(
            '## 🔒 SUBJECT LOCK MODE',
            '**Preserve character intrinsic characteristics at all times.**',
            '',
            '**DO NOT modify**: Core appearance, identity markers (hair/eye color, distinctive traits), clothing/accessories, names',
            '**YOU MAY modify**: Environmental elements, scene composition, actions/poses, atmospheric effects',
            '**YOU MAY enhance**: Add descriptive details about existing features (e.g., "blue eyes" → "bright blue eyes with subtle sparkle"), improve clarity/vividness, add detail tags',
            '⚠️ **Only enhance what exists - do NOT change colors, outfit elements, or fundamental traits.**',
            ''
        );
    }
    
    systemMessageContent.push(
        '**SPELLING CORRECTION**: Correct spelling errors throughout the prompt, negative prompt, and character prompts using text_replacements. Fix typos and misspellings to ensure accurate generation.',
        ''
    );
    
    // ========================================
    // BUILD USER CONTENT SECTIONS (Dynamic Data)
    // ========================================
    
    if (time) {
        // Generate LCD display visualizations using new display functions
        const sunPositionBar = createSunPositionBar(timePeriodInfo);
        const lightLevelBar = createLightLevelBar(timePeriodInfo);
        
        // Build transition note if applicable
        const transitionNote = timePeriodInfo.transitionType === 'sunrise_transition' ? ' (sunrise transition)' :
                              timePeriodInfo.transitionType === 'sunset_transition' ? ' (sunset transition)' : 
                              timePeriodInfo.transitionType === 'twilight_transition' ? ' (twilight transition)' : '';
        
        // Generate seasonal progression bar if season is available
        const seasonalProgressBar = currentSeason ? createSeasonalProgressionBar(time, currentSeason) : null;
        
        // Generate holiday countdown bar if holiday is active
        let holidayCountdownBar = null;
        if (seasonalData?.holidayInfo?.isHolidayPeriod && seasonalData.holidayInfo.primaryHoliday) {
            const daysUntil = seasonalData.holidayInfo.primaryHoliday.daysUntil || 0;
            const bufferDays = seasonalData.holidayInfo.primaryHoliday.bufferDays || 7; // Fallback to 7 if not provided
            let progress;
            
            if (daysUntil >= 0) {
                // Before or on the holiday date: progress increases from 0% to 100%
                progress = Math.max(0, Math.min(100, ((bufferDays - daysUntil) / bufferDays) * 100));
            } else {
                // After the holiday date: calculate days past the final date
                const daysPastFinal = Math.abs(daysUntil) - bufferDays;
                
                if (daysPastFinal <= 0) {
                    // Still within the after-buffer period: progress decreases linearly from 100% to 0%
                    // When daysUntil = 0: progress = 100%
                    // When daysUntil = -bufferDays: progress = 0%
                    progress = Math.max(0, Math.min(100, ((bufferDays + daysUntil) / bufferDays) * 100));
                } else {
                    // Past the final date: progress is 0%
                    progress = 0;
                }
            }
            
            const bar = createBarGraph(progress, 100, 10);
            const holidayName = capitalize(seasonalData.holidayInfo.primaryHoliday.name);
            
            if (daysUntil === 0) {
                holidayCountdownBar = `${'█'.repeat(10)} ${holidayName} (TODAY)`;
            } else if (daysUntil > 0) {
                holidayCountdownBar = `${bar} ${holidayName} (${daysUntil}d)`;
            } else {
                holidayCountdownBar = `${bar} ${holidayName} (${Math.abs(daysUntil)}d ago)`;
            }
        }
        
        userContentSections.push(
            '# ⏰ CURRENT TIME DATA',
            '```',
            `CLOCK TIME: ${time.hour}:${time.minute.toString().padStart(2, '0')} ${time.am_pm}`,
            `DATE: ${time.dayOfWeekName}, ${time.monthName} ${time.dayOfMonth}, ${time.year}`,
            ...(seasonalProgressBar ? [`SEASON: ${seasonalProgressBar} ${getSeasonIcon(currentSeason)}`] : []),
            ...(holidayCountdownBar ? [`HOLIDAY: ${holidayCountdownBar}`] : []),
            `TIME PERIOD: ${timePeriodInfo.period}`,
            `SUN POSITION: ${sunPositionBar} ${timePeriodInfo.perceivableLight}%${transitionNote}`,
            `OUTDOOR LIGHT: ${lightLevelBar}`,
            '```',
            '',
            '## 📋 ENVIRONMENTAL CONTEXT',
            '```',
            `LIGHTING: ${timePeriodInfo.lighting || 'standard lighting'}`,
            `ATMOSPHERE: ${timePeriodInfo.atmosphere || 'standard atmosphere'}`,
            '```',
            ''
        );
    }
    if (weather) {
        // Helper functions for data formatting (createBarGraph is now global - see line ~6574)
        
        const getWindDirection = (degrees) => {
            if (degrees === null || degrees === undefined || degrees === 'unknown' || isNaN(parseFloat(degrees))) return 'unknown';
            const deg = parseFloat(degrees);
            // Convert to character-relative directions (assuming character facing forward/north)
            if (deg >= 315 || deg < 45) return 'behind';      // north - from behind character
            if (deg >= 45 && deg < 135) return 'left';        // east - from left of character
            if (deg >= 135 && deg < 225) return 'facing';     // south - toward character's face
            return 'right';                                    // west - from right of character
        };

        const isHotTemperature = (feelsLike) => feelsLike >= 25; // 25°C/77°F as hot threshold

        // Prepare formatted weather data
        const weatherData = {
            temperature: `${weather.feelsLike}°C`,
            condition: weather.condition,
            cloudCoverage: createBarGraph(weather.cloudCoverage || 0),
            windSpeed: `${Math.round(weather.windSpeed * 3.6)} km/h`, // Convert m/s to km/h
            windDirection: getWindDirection(weather.windDirection),
            visibility: createBarGraph(Math.min(weather.visibility || 10, 10), 10), // Cap at 10km for bar graph
            solarRadiation: createBarGraph(Math.min(weather.uvIndex || 0, 12), 12) // UV index as solar radiation indicator
        };

        // Only include humidity if temperature is hot
        if (isHotTemperature(weather.feelsLike)) {
            weatherData.humidity = createBarGraph(weather.humidity, 100);
        }
        if (weather.precipitationRate && weather.precipitationRate > 0) {
            weatherData.precipitation = createPrecipitationBar(weather.precipitationRate); // Logarithmic scale 0-30mm/hr
        }
        if (weather.snowDepth && weather.snowDepth > 0) {
            weatherData.snowDepth = `${weather.snowDepth}cm`;
        }

        // For custom weather, use the generateAccurateWeatherConditions function
        if (isCustomWeather) {
            weatherData.customDescription = weather.description;
            // Generate accurate meteorological data based on the custom condition
            const accurateWeather = generateAccurateWeatherConditions(weather.condition, weather);

            // Update fields that might be missing or need adjustment
            if (!weather.cloudCoverage && accurateWeather.cloudCoverage !== undefined) {
                weatherData.cloudCoverage = createBarGraph(accurateWeather.cloudCoverage);
            }
            if (!weather.windSpeed && accurateWeather.windSpeed !== undefined) {
                weatherData.windSpeed = `${Math.round(accurateWeather.windSpeed * 3.6)} km/h`;
            }
            if (!weather.windDirection && accurateWeather.windDirection !== undefined) {
                weatherData.windDirection = getWindDirection(accurateWeather.windDirection);
            }
            if (!weather.visibility && accurateWeather.visibility !== undefined) {
                weatherData.visibility = createBarGraph(Math.min(accurateWeather.visibility || 10, 10), 10);
            }
            if (!weather.uvIndex && accurateWeather.uvIndex !== undefined) {
                weatherData.solarRadiation = createBarGraph(Math.min(accurateWeather.uvIndex, 12), 12);
            }
            if (!weather.humidity && accurateWeather.humidity !== undefined && isHotTemperature(weather.feelsLike)) {
                weatherData.humidity = createBarGraph(accurateWeather.humidity, 100);
            }
            if (weather.precipitation === undefined && accurateWeather.precipitationRate > 0) {
                weatherData.precipitation = createPrecipitationBar(accurateWeather.precipitationRate);
            }
        }

        userContentSections.push(
            '# 🌦️ CURRENT WEATHER DATA',
            '```',
            `TEMPERATURE: ${weatherData.temperature}`,
            `CONDITION: ${weatherData.condition}`,
            `CLOUD COVERAGE: ${weatherData.cloudCoverage}`,
            `WIND: ${weatherData.windSpeed} from ${weatherData.windDirection} side`,
            `VISIBILITY: ${weatherData.visibility}`,
            `SOLAR RADIATION: ${weatherData.solarRadiation}`,
            ...(weatherData.humidity ? [`HUMIDITY: ${weatherData.humidity}`] : []),
            ...(weatherData.precipitation ? [`PRECIPITATION: ${weatherData.precipitation}`] : []),
            ...(weatherData.snowDepth ? [`SNOW DEPTH: ${weatherData.snowDepth}`] : []),
            '```',
            ''
        );
    }
    
    // Add integration reminder to user content (data-specific, not instructions)
    if (weather || time) {
        userContentSections.push(
            '',
            `**Integration Required**: Use the ${time && weather ? 'time and weather' : time ? 'time' : 'weather'} data above following the ${time && weather ? 'Combined Time & Weather Integration' : time ? 'Time Integration' : 'Weather Integration'} framework from the system message.`,
            '',
            '**Contextual UC Patterns:**',
            ...generateContextualUCGuidelines(weather, currentSeason, timePeriodInfo),
            '',
        );
    }
    
    // Add historical weather report if pre-compiled data is available
    if (weather && weatherHistoryReport) {
        const report = weatherHistoryReport;
        
        userContentSections.push(
            '',
            '═══════════════════════════════════════════════════',
            '',
            '# 📊 WEATHER HISTORY ANALYSIS REPORT',
            '**Document Type**: Temporal Weather & Pattern Analysis',
            `**Report Generated**: ${report.reportGenerated}`,
            `**Location**: ${report.location}`,
            `**Timezone**: ${report.timezone}`,
            ''
        );
        
        // Add yesterday's summary if available
        if (report.yesterday) {
            const yesterday = report.yesterday;
            const yesterdayDate = new Date(yesterday.date);
            
            userContentSections.push(
                '## 📅 YESTERDAY\'S WEATHER SUMMARY',
                `**Date**: ${yesterdayDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
                '',
                '**Overall Conditions**:',
                `├─ Dominant Condition: ${yesterday.dominantCondition}`,
                `├─ Temperature Range: ${yesterday.temperatureMin}°C to ${yesterday.temperatureMax}°C (avg: ${yesterday.temperatureAvg}°C)`,
                `├─ Precipitation: ${yesterday.precipitationTotal > 0 ? `${yesterday.precipitationTotal}mm total` : 'None'}`,
                `├─ Cloud Cover: ${yesterday.cloudCoverAvg}% average`,
                `└─ Wind: ${yesterday.windSpeedAvg} m/s average, gusts to ${yesterday.windGustMax} m/s`,
                '',
                '**Context for Today**:'
            );
            
            // Add context lines
            const contextLines = [];
            if (Math.abs(yesterday.tempDiffFromToday) > 5) {
                contextLines.push(`• Temperature ${yesterday.tempDiffFromToday > 0 ? 'warmer' : 'cooler'} than yesterday by ${Math.abs(yesterday.tempDiffFromToday).toFixed(1)}°C`);
            }
            if (yesterday.precipitationTotal > 0 && weather.precipitation === 0) {
                contextLines.push(`• Yesterday had rain (${yesterday.precipitationTotal}mm), ground may still show dampness`);
            }
            if (yesterday.precipitationSnow > 0) {
                contextLines.push(`• Snow fell yesterday (${yesterday.precipitationSnow}mm), snow cover likely present`);
            }
            
            userContentSections.push(
                ...(contextLines.length > 0 ? contextLines : ['• Conditions similar to yesterday']),
                '',
                '═══════════════════════════════════════════════════',
                ''
            );
        }
        
        userContentSections.push(
            '## ⏱️ TEMPORAL WEATHER TIMELINE (Past 4 Hours + Next 2 Hours)',
            ''
        );
        
        // Display timeline entries from pre-compiled data
        report.timelineEntries.forEach(entry => {
            userContentSections.push(
                `### ${entry.label} - ${entry.timeStr}`,
                `├─ Temperature: ${entry.temperature}°C (Feels like: ${entry.feelsLike}°C)`,
                `├─ Condition: ${entry.condition}`,
                `├─ Cloud Cover: ${entry.cloudCoverage}% ${entry.cloudCoverage >= 80 ? '(overcast)' : entry.cloudCoverage >= 50 ? '(mostly cloudy)' : entry.cloudCoverage >= 20 ? '(partly cloudy)' : '(mostly clear)'}`,
                `├─ Precipitation: ${entry.precipitation > 0 ? `${entry.precipitation}mm (${entry.precipitationType})` : 'None'}`,
                `├─ Humidity: ${entry.humidity}% ${entry.humidity >= 80 ? '(very humid)' : entry.humidity >= 60 ? '(humid)' : entry.humidity >= 40 ? '(comfortable)' : '(dry)'}`,
                `├─ Wind: ${Math.round(entry.windSpeed * 10) / 10} m/s from ${Math.round(entry.windDirection)}°`,
                `└─ Visibility: ${entry.visibility >= 10000 ? '>10 km (excellent)' : `${Math.round(entry.visibility / 1000)} km`}`,
                ''
            );
        });
        
        // Display trend analysis from pre-compiled data
        if (report.trendAnalysis) {
            const trend = report.trendAnalysis;
            const currentTemp = weather.temperature;
            const currentClouds = weather.cloudCoverage;
            const currentHumidity = weather.humidity;
            const currentWindSpeed = weather.windSpeed;
            
            userContentSections.push(
                '═══════════════════════════════════════════════════',
                '',
                '## 📈 TREND ANALYSIS & VISUAL IMPLICATIONS',
                ''
            );
            
            // Temperature trend
            userContentSections.push('### 🌡️ Temperature Trend');
            if (trend.temperature.status === 'stable') {
                userContentSections.push(`**Status**: Stable at ${currentTemp}°C`);
                userContentSections.push(`**Visual Guidance**: Consistent thermal conditions, no thermal transition effects`);
            } else if (trend.temperature.status === 'rising') {
                userContentSections.push(`**Status**: Rising trend (+${trend.temperature.change.toFixed(1)}°C)`);
                userContentSections.push(`**Rate**: ${trend.temperature.rate.toFixed(2)}°C per hour`);
                userContentSections.push(`**Visual Implications**:`);
                userContentSections.push(`  → Characters may show warming: removing layers, fanning, sweating if hot`);
                userContentSections.push(`  → Snow/ice melting if crossing freezing point`);
                userContentSections.push(`  → Heat shimmer effects if temperature exceeds 30°C`);
            } else {
                userContentSections.push(`**Status**: Falling trend (${trend.temperature.change.toFixed(1)}°C)`);
                userContentSections.push(`**Rate**: ${trend.temperature.rate.toFixed(2)}°C per hour`);
                userContentSections.push(`**Visual Implications**:`);
                userContentSections.push(`  → Characters may react to cold: visible breath if <10°C, adjusting clothing`);
                if (trend.temperature.change < -3) {
                    userContentSections.push(`  → Rapid cooling: condensation on windows, mist/fog forming`);
                }
            }
            userContentSections.push('');
            
            // Precipitation pattern
            userContentSections.push('### 🌧️ Precipitation Pattern');
            if (trend.precipitation.hasCurrentPrecip) {
                const intensity = weather.precipitation > 5 ? 'Heavy' : weather.precipitation > 2 ? 'Moderate' : 'Light';
                userContentSections.push(`**Status**: ACTIVE precipitation (${intensity} - ${weather.precipitation}mm/h)`);
                userContentSections.push(`**Type**: ${weather.precipitationType?.description || weather.condition}`);
                userContentSections.push(`**Visual Requirements**:`);
                userContentSections.push(`  → Falling droplets visible in air`);
                userContentSections.push(`  → Wet surfaces with active water accumulation`);
                userContentSections.push(`  → Splash effects where drops hit surfaces`);
                userContentSections.push(`  → Characters: rain gear, umbrellas, wet hair/clothing if exposed`);
                userContentSections.push(`  → Puddles forming and expanding`);
            } else if (trend.precipitation.hadRecentPrecip) {
                const lastPrecip = trend.precipitation.lastPrecip;
                const timeSincePrecip = lastPrecip ? Math.round((Date.now() - lastPrecip.timestamp) / (1000 * 60)) : 0;
                userContentSections.push(`**Status**: Precipitation ended ~${timeSincePrecip} minutes ago`);
                userContentSections.push(`**Critical After-Effects Required**:`);
                userContentSections.push(`  → Surfaces MUST be wet - this is non-negotiable`);
                userContentSections.push(`  → Puddles present, water droplets on leaves, windows, surfaces`);
                userContentSections.push(`  → Wet pavement reflects lights and sky`);
                userContentSections.push(`  → Drying process visible: steam rising if warm, evaporation effects`);
                userContentSections.push(`  → Characters: may have damp clothing, wet footprints, shaking off water`);
                userContentSections.push(`  → Air feels fresh, cleaned atmosphere`);
            } else if (trend.precipitation.hadEarlierPrecip) {
                userContentSections.push(`**Status**: Rained 2-4 hours ago, mostly dried`);
                userContentSections.push(`**Residual Effects**:`);
                userContentSections.push(`  → Some dampness may remain in shaded/sheltered areas`);
                userContentSections.push(`  → Deep puddles may persist in low-lying areas`);
                userContentSections.push(`  → Most surfaces dried but may show water marks`);
            } else {
                userContentSections.push(`**Status**: No precipitation in past 4 hours`);
                userContentSections.push(`**Conditions**: Dry throughout observation period`);
            }
            userContentSections.push('');
            
            // Cloud cover trend
            userContentSections.push('### ☁️ Cloud Cover Transition');
            if (trend.cloud.status === 'stable') {
                userContentSections.push(`**Status**: Stable at ${currentClouds}%`);
            } else if (trend.cloud.status === 'increasing') {
                userContentSections.push(`**Status**: Increasing (+${Math.round(trend.cloud.change)}%) - sky becoming overcast`);
                userContentSections.push(`**Lighting Transition**:`);
                userContentSections.push(`  → Shifting from direct to diffused lighting`);
                userContentSections.push(`  → Shadows becoming softer, less defined`);
                userContentSections.push(`  → Overall brightness decreasing`);
                userContentSections.push(`  → Sky: clouds moving in, darkening appearance`);
                if (trend.cloud.change > 30 && !trend.precipitation.hasCurrentPrecip) {
                    userContentSections.push(`  → Rapid cloud buildup may indicate approaching storm`);
                }
            } else {
                userContentSections.push(`**Status**: Decreasing (${Math.round(trend.cloud.change)}%) - skies clearing`);
                userContentSections.push(`**Lighting Transition**:`);
                userContentSections.push(`  → Shifting from diffused to direct lighting`);
                userContentSections.push(`  → Shadows becoming sharper, more defined`);
                userContentSections.push(`  → Overall brightness increasing`);
                userContentSections.push(`  → Sky: breaks in clouds, blue sky visible, sunbeams possible`);
            }
            userContentSections.push('');
            
            // Humidity trend
            if (Math.abs(trend.humidity.change) >= 10) {
                userContentSections.push('### 💧 Humidity Shift');
                if (trend.humidity.status === 'rising') {
                    userContentSections.push(`**Status**: Rising (+${trend.humidity.change}%) - air becoming more humid`);
                    if (currentHumidity > 80 && !trend.precipitation.hasCurrentPrecip) {
                        userContentSections.push(`**Visual Effects**:`);
                        userContentSections.push(`  → High humidity without rain: mist or fog may form`);
                        userContentSections.push(`  → Condensation on cold surfaces, windows fogging`);
                        userContentSections.push(`  → Hazy atmosphere, reduced visibility distances`);
                    }
                } else {
                    userContentSections.push(`**Status**: Falling (${trend.humidity.change}%) - air drying out`);
                    if (trend.precipitation.hadRecentPrecip) {
                        userContentSections.push(`**Visual Effects**:`);
                        userContentSections.push(`  → Accelerated drying: wet surfaces evaporating faster`);
                        userContentSections.push(`  → Crisper visibility, clearer air`);
                    }
                }
                userContentSections.push('');
            }
            
            // Wind trend
            if (Math.abs(trend.wind.change) >= 2) {
                userContentSections.push('### 💨 Wind Conditions');
                if (trend.wind.status === 'strengthening') {
                    userContentSections.push(`**Status**: Strengthening (+${trend.wind.change.toFixed(1)} m/s)`);
                    userContentSections.push(`**Visual Dynamics**:`);
                    userContentSections.push(`  → Increasing movement: clothes, hair, loose objects`);
                    userContentSections.push(`  → Leaves/debris blowing more vigorously`);
                    if (currentWindSpeed > 10) {
                        userContentSections.push(`  → Strong wind: characters bracing, difficult movement`);
                    }
                } else {
                    userContentSections.push(`**Status**: Calming (${trend.wind.change.toFixed(1)} m/s)`);
                    userContentSections.push(`**Visual Dynamics**:`);
                    userContentSections.push(`  → Decreasing movement, settling conditions`);
                    userContentSections.push(`  → Dust/debris settling, calmer atmosphere`);
                }
                userContentSections.push('');
            }
            
            // Overall weather stability
            userContentSections.push('### 🎯 Overall Pattern Assessment');
            if (trend.stability.isStable) {
                userContentSections.push(`**Stability**: High - Stable weather pattern`);
                userContentSections.push(`**Depiction**: Consistent, steady-state atmospheric conditions`);
                userContentSections.push(`**No transition effects needed - show established conditions**`);
            } else {
                userContentSections.push(`**Stability**: Low - Active weather transitions`);
                userContentSections.push(`**Depiction**: Environment should show mid-transition states`);
                userContentSections.push(`**Consider**: Clearing/darkening skies, drying/wetting surfaces, thermal shifts`);
                
                // Identify primary trend
                const trends = [];
                if (Math.abs(trend.temperature.change) >= 2) trends.push('thermal');
                if (trend.precipitation.hadRecentPrecip || trend.precipitation.hasCurrentPrecip) trends.push('precipitation');
                if (Math.abs(trend.cloud.change) >= 20) trends.push('cloud cover');
                
                if (trends.length > 0) {
                    userContentSections.push(`**Primary Transitions**: ${trends.join(', ')}`);
                }
            }
        }
        
        userContentSections.push(
            '',
            '═══════════════════════════════════════════════════',
            '',
            '**END OF WEATHER HISTORY ANALYSIS REPORT**',
            ''
        );
    }
    
    if (seasonalData && seasonalData.mode === 'comprehensive') {
        userContentSections.push(
            '',
            '# 📄 SEASONAL ADAPTATION PRINTOUT',
            '**Document Type**: Environmental Modification Guidelines',
            `**Season**: ${capitalize(seasonForGuidelines)} ${getSeasonIcon(seasonForGuidelines)}`,
            `**Generated**: ${time ? `${time.monthName} ${time.dayOfMonth}, ${time.year}` : 'Current Date'}`,
            '',
            '---',
            '',
            '## General Guidelines',
            ...seasonalData.guidelines.map(g => `• ${g}`),
            '',
            '## Weather-Specific Recommendations',
            ...seasonalData.modifications.map(m => `• ${m}`),
            '',
        )
        if (seasonalData.holidayInfo?.isHolidayPeriod) {
            userContentSections.push(
                '## 🎉 Holiday Information',
                `**Primary Holiday**: ${capitalize(seasonalData.holidayInfo.primaryHoliday.name)} (${seasonalData.holidayInfo.region})`,
                `**Timing**: ${seasonalData.holidayInfo.primaryHoliday.daysUntil === 0 ? 'TODAY' : seasonalData.holidayInfo.primaryHoliday.daysUntil > 0 ? `In ${seasonalData.holidayInfo.primaryHoliday.daysUntil} days` : `${Math.abs(seasonalData.holidayInfo.primaryHoliday.daysUntil)} days ago`}`,
                ''
            )
            if (seasonalData.holidayInfo.secondaryHoliday) {
                userContentSections.push(
                    `**Secondary Holiday**: ${capitalize(seasonalData.holidayInfo.secondaryHoliday.name)} (${seasonalData.holidayInfo.secondaryHoliday.region})`,
                    `**Timing**: ${seasonalData.holidayInfo.secondaryHoliday.daysUntil === 0 ? 'TODAY' : seasonalData.holidayInfo.secondaryHoliday.daysUntil > 0 ? `In ${seasonalData.holidayInfo.secondaryHoliday.daysUntil} days` : `${Math.abs(seasonalData.holidayInfo.secondaryHoliday.daysUntil)} days ago`}`,
                    ''
                );
            }
            userContentSections.push(
                '### Holiday Elements',
                `**Decorations**: ${seasonalData.holidayInfo.holidayDecorations.slice(0, 10).join(', ')}`,
                `**Atmosphere**: ${seasonalData.holidayInfo.holidayAtmosphere.slice(0, 6).join(', ')}`,
                `**Color Palette**: ${seasonalData.holidayInfo.holidayColors.slice(0, 6).join(', ')}`,
                '',
                '**Application Notes:**',
                '• Integrate festive elements naturally into the environment',
                '• Adjust scene to match holiday atmosphere, decorations, and color scheme',
                ''
            );
        }
        userContentSections.push(
            '---',
            '**Note**: These are recommendations based on current seasonal and weather conditions. Apply them thoughtfully while maintaining the original prompt\'s intent.',
            ''
        );
    }

    // Add clothing adaptation section if clothing is enabled
    if (clothing && context.clothingContext) {
        const clothingContext = context.clothingContext;
        userContentSections.push(
            '## 👔 CLOTHING ADAPTATION',
            '',
            'Use ClothingDatabase to adapt clothing for weather, season, activity, and location.',
            '',
            ...(clothingContext.options?.length > 0 ? [
                `**Available Options**: ${clothingContext.options.slice(0, 10).map(item => item.name).join(', ')}`
            ] : ['**Available Options**: Context-specific clothing from database']),
            '',
            '**Adaptation Process**:',
            '1. Analyze current outfit: items, style, colors, materials',
            '2. Check weather appropriateness: hot (>25°C) = remove layers, cold (<10°C) = add layers, rain/snow = waterproof, wind = wind-resistant',
            '3. Verify seasonal alignment: summer = light/breathable, winter = warm/insulated',
            '4. Ensure activity suitability: active = athletic wear, formal = formal attire',
            '5. Apply adaptations using text_replacements while preserving character style',
            '',
            '**Examples**: "winter coat" → "summer dress" (hot), "thin shirt" → "layered clothing with scarf" (cold)',
            ''
        );
    }
    
    systemMessageContent.push(
        '',
        '# 🔍 ANALYSIS & MODIFICATION PROCESS',
        '',
        '**This section defines the sequential analysis workflow. Follow these steps in order:**',
        '',
        '### 1. Analyze Initial Prompts and Provided Images',
        '• Read base prompt, UC (negative prompt), and character prompts',
        '• If image provided: Analyze for visual elements, conflicts, and quality issues',
        '',
        '### 2. Analyze Current Context Data',
        ...(time ? ['• Parse TIME DATA: clock time, period, sun position, light level'] : []),
        ...(weather ? [
            '• Parse WEATHER DATA LCD: current temperature, condition, wind, visibility, precipitation',
            '• Review WEATHER HISTORY ANALYSIS REPORT (if provided):',
            '  - Yesterday\'s summary: understand broader weather patterns',
            '  - Temporal timeline: past 4 hours + next 2 hours showing weather evolution',
            '  - Trend analysis sections: critical for after-effects',
            '    → Temperature trends: character reactions to warming/cooling',
            '    → Precipitation pattern: **CRITICAL** - if rain ended, surfaces MUST be wet',
            '    → Cloud transitions: lighting shifts from direct to diffused',
            '    → Humidity/wind changes: fog formation, drying rates, atmospheric effects'
        ] : []),
        ...(seasonalConfig && seasonalConfig.enabled ? ['• Note seasonal/holiday information'] : []),
        '',
        ...(weather ? [
            '**CRITICAL - Weather After-Effects**:',
            'The Weather History Report shows temporal context. Use it to depict realistic transitions:',
            '• If precipitation ended recently (within 1-2h): Surfaces MUST show wetness',
            '  - Wet pavement reflecting lights, puddles present, water droplets on surfaces',
            '  - Drying effects: steam rising if warm, dampness in shaded areas',
            '• If temperature shifted significantly: Show thermal transition effects',
            '  - Warming: characters removing layers, condensation evaporating',
            '  - Cooling: visible breath if cold, frost forming, character adjustments',
            '• If clouds changed: Lighting should show transition state',
            '  - Clearing: sunbeams breaking through, shadows sharpening',
            '  - Darkening: diffused light, soft shadows, overcast atmosphere',
            '',
        ] : []),
        '### 3. Analyze and Compile User Directive (if provided)',
        ...(directive ? [
            '• Parse directive for instructions and narrative',
            '• Handle typos/informal language (understand intent)',
            '• Execute conditional logic (IF/THEN/ELIF/ELSE)',
            '• Process incrementing/counter logic and variables'
        ] : ['• No directive provided - skip this step']),
        '',
        '### 4. Scene Understanding',
        '• **Environment Type**: CRITICALLY determine if scene is INDOOR ONLY, OUTDOOR ONLY, or MIXED/TRANSITIONAL',
        '• **Core Intent**: Identify the primary artistic goal and mood of the original prompt',
        '• **Character Focus**: Identify main subjects, their roles, and relationships',
        '• **Style Elements**: Note specific artistic styles, techniques, or aesthetics mentioned',
        '• **Setting Details**: Extract specific environmental and atmospheric descriptions',
        '',
        '### 5. Identify Conflicts',
        ...(weather || time ? ['• Check for time/weather/lighting conflicts with provided data'] : []),
        '• Check for seasonal conflicts and atmospheric mismatches',
        '• Note any contradictory elements in prompt',
        '',
        '### 6. Check Priority Hierarchy',
        '• See "PRIORITY HIERARCHY" section below',
        '',
        '## ⚖️ PRIORITY HIERARCHY',
        '',
        '**Conflict order:** 1) Director Rules (absolute) → 2) Directive (content) → 3) Weather/Time → 4) Seasonal → 5) General',
        '',
        '### 2. Context Integration with Conflict Resolution',
        ...(weather || time ? [
            `**When ${time && weather ? 'time and weather data are' : time ? 'time data is' : 'weather data is'} provided, integration is required.**`,
            `**Analyze HOW to best integrate the data:**`,
            '',
            '**Analysis Steps:**',
            '• Identify existing conflicts in prompt with provided context',
            '• Determine optimal placement for context markers',
            '• Choose specific visual descriptors matching the data',
            '• Plan conflict resolution strategy',
            ''
        ].join('\n') : '**Analyze for conflicts and plan resolution:**'),
        '',
        '**Conflicts to check:** Time, weather, lighting, seasonal, atmospheric contradictions with provided data',
        '**Resolution Order:** 1) Remove conflicts 2) Integrate weather/time 3) Add contextual elements 4) Adapt actions 5) Enhance atmosphere',
        '**Reasoning must document:** Temperature, weather state, time/lighting, character state, redundancy check, integration plan, resolution strategy',
        '',
        '### 3. Enhancement Opportunities',
        'Identify integration points, missing contextual details, character interaction opportunities, environmental enhancements.',
        '',
        '### 4. Quality Assurance',
        'Check: visual hierarchy, atmospheric consistency, character integration, token efficiency, artistic preservation.',
        '',
        '# 🎨 MODIFICATION PRINCIPLES & WORKFLOW',
        '',
        '**Core Principles**: Preservation first, contextual integration, environment-aware (indoor/outdoor), character harmony, artistic balance.',
        '',
        '**Modification Hierarchy**:',
        '1. Conflict resolution',
        ...(weather || time ? [`2. ${time && weather ? 'Time & weather' : time ? 'Time' : 'Weather'} integration (when data provided)`] : ['2. Atmospheric enhancement']),
        '3. Character integration and adaptation',
        '4. Atmospheric refinement',
        (creative ? '5. Creative flourishes (if creative mode enabled)' : ''),
        '',
        '**Emphasis:** Use 1.3-1.5 (standard), 1.6-2.0 (strong), 2.1+ (critical). See EMPHASIS GROUPS section',
        '',
    )
    // Add creative mode instructions if creative flag is enabled
    // For pipeline stages, use a lighter creative mode to avoid repeated heavy processing
    const isLightCreativeMode = stageContext && !stageContext.isInitial;
    
    if (creative) {
        if (isLightCreativeMode) {
            // Simplified creative mode for pipeline stages
            systemMessageContent.push(
                '',
                '# 🎨 CREATIVE ENHANCEMENT MODE - PIPELINE STAGE',
                '',
                '**Creative mode is active. Focus on maintaining and refining the creative vision established in the base generation.**',
                '**Make targeted refinements that enhance the scene without wholesale transformations.**',
                '',
                '## PIPELINE STAGE CREATIVE FOCUS',
                '* **Consistency**: Maintain creative direction from base generation',
                '* **Refinement**: Polish existing creative elements',
                '* **Integration**: Ensure new canvas areas blend with existing creative vision',
                '* **Subtle Enhancement**: Add complementary details that support the established scene',
                ''
            );
        } else {
            // Full creative mode for base generation
            systemMessageContent.push(
                '',
                '# 🎨 CREATIVE ENHANCEMENT MODE',
                '',
                '## 🎯 CREATIVE REQUIREMENTS',
                '**Enhance scene beyond basic weather/time integration.**',
                '',
                '**Areas**: Wording (concise/precise), Composition (hierarchy/balance/depth), Atmosphere (mood/sensory/lighting), Character (personality/emotion), Environment (storytelling/world-building).',
                '',
                '**Process**: Analyze scene, identify 3-5 enhancements, apply via text_replacements, elevate quality. Make 3+ specific improvements.',
                '',
                '## 📝 CREATIVE MODE SPECIFIC TASKS',
                '',
                '### 1. Rich Description Expansion',
                '**Within token limits, maximize descriptive richness:**',
                '• Expand vague or minimal descriptions into vivid, detailed language',
                '• Add sensory details (textures, lighting nuances, atmospheric qualities)',
                '• Fill in missing details that enhance scene coherence and immersion',
                '• Use available token budget to its fullest - don\'t be sparse when tokens allow',
                '• Transform generic descriptions into specific, evocative imagery',
                '',
                '**Example Transformations:**',
                '• "rainy day" → "heavy rain drumming on surfaces, water streaming down windows, puddles reflecting gray overcast sky, damp air thick with moisture"',
                '• "happy girl" → "girl with bright genuine smile, eyes sparkling with joy, relaxed cheerful posture, radiating positive energy"',
                '• "sunset" → "golden hour sunset painting sky in warm oranges and pinks, long dramatic shadows, soft diffused light bathing everything in warm glow"',
                '',
                '### 2. Tag Enhancement',
                '**Enrich tags with descriptive qualifiers:**',
                '• Add descriptive adjectives to base tags when appropriate',
                '• Specify qualities: "rain" → "heavy rain", "smile" → "bright genuine smile"',
                '• Include atmosphere tags: "dramatic lighting", "cinematic composition", "depth of field"',
                '• Layer complementary tags that build on each other',
                '',
                '### 3. Character Naming',
                '**Replace generic character identifiers with appropriate names (character_names field):**',
                '• Scan character prompts for generic patterns: "Character #1", "Character #2", "Character 1", "Character 2", etc.',
                '• Replace with contextually appropriate names that match the scene/setting',
                '• Consider cultural context, time period, and character traits when choosing names',
                '• Provide as array in character_names field (order must match character_prompts array)',
                '',
                '**Examples:**',
                '• "Character #1" → "Sakura" (for anime-style Japanese setting)',
                '• "Character 1" → "Emma" (for western contemporary setting)',
                '• "Character #2" → "Alex" (neutral option for any setting)',
                '• "Character 1" → "Mei Lin" (for Chinese setting)',
                '• "Character #1" → "Isabella" (for Italian/Mediterranean setting)',
                '',
                '**Format:** character_names: ["Sakura", "Emma"] (array matching character order)',
                '',
                '### 4. Generated Image Name',
                '**Create a descriptive name suggestion (generated_image_name field):**',
                '• Capture the essence of the scene in 3-100 characters',
                '• Use natural readable format with proper capitalization',
                '• Include: main subject, setting, mood, and significant elements',
                '• Make it memorable, poetic, and evocative',
                '• Consider time/weather if they\'re prominent scene elements',
                '',
                '**Good Examples:**',
                '• "Summer Beach Cheerful Energy"',
                '• "Cozy Rainy Window Reflection"',
                '• "Dawn Mountain Peaceful Solitude"',
                '• "Urban Night Neon Atmosphere"',
                '• "Autumn Leaves Gentle Melancholy"',
                '• "Sunset Pier Romantic Silhouettes"',
                '',
                '**Remember:** Creative mode means being generous with detail while respecting token limits. Use the full capacity available to create rich, immersive descriptions.',
                '',
                // Dynamic NSFW content guidelines based on user setting
                (() => {
                    // Only show NSFW guidelines if nsfw_level is set (not 0/neutral)
                    if (nsfw_level === 0) {
                        return ''; // No NSFW section for neutral mode
                    }

                    if (nsfw_level === 3) {
                        return [
                            '### 🍆 MAXIMUM EXPLICITNESS MODE',
                            '**DIRECT COMMANDS:**',
                            '• Generate fully nude characters with complete sexual content',
                            '• Include detailed genitalia descriptions and explicit sexual acts',
                            '• Allow full penetration, sexual fluids, and explicit sexual positions',
                            '• Use maximum sexual intensity and explicitness in all content',
                            '• Add explicit sexual elements to prompts that lack them',
                            '• Include detailed descriptions of sexual anatomy and acts',
                            '',
                            '**Content Approach**:',
                            '• No censorship or sanitization - be explicit and raw when describing sexual characteristics',
                            '• Play into fetishes and teasing elements (even degrading when contextually appropriate)',
                            '• Amplify overemphasized or distorted attributes in character descriptions',
                            '• Use sexually suggestive language when appropriate for the scene',
                            '• Maintain explicit nature throughout',
                            '',
                            '**Specific Fetish Integration**:',
                            '• **Pregnancy**: Emphasize womb and belly expansion, fetal movement details, growth progression, maternal changes, lactation if present, the joy of being pregnant and the feeling of having a growing baby inside you, moving and kicking inside you',
                            '• **Birthing**: Emphasize labor, excruciating pain, pushing, contractions, fetal movement/kicking, enhance her pain and pleasure to show her struggle and joy, add crying and screaming to the birthing process',
                            '• **Inflation/Expansion**: Detail distension levels, pressure sensations, shape changes, capacity limits, the joy of being filled and the feeling of being stretched and how it feels to be filled to the brim',
                            '• **Vore**: Analyze consumption states, internal views if possible, digestion progression, predator/prey dynamics, the joy of eating and the taste of the prey, how they squirm and writhe inside your stomach',
                            '• **Transformation**: Track body modifications, hybrid states, progression stages, loss/gain of features, the joy of transformation and the feeling of being changed into something different',
                            '• **Bondage/BDSM**: Describe restraints, positions, visible marks/bruises, power dynamics, sensory deprivation, the joy of being restrained and the feeling of being helpless',
                            '• **Weight Gain**: Emphasize weight gain, distension, pressure sensations, shape changes, capacity limits, the joy of being filled and the feeling of being stretched',
                            '',
                            '**Technical Requirements**:',
                            '• Use emphasis weights (1.5::keyword::, 2.0::keyword::) for critical fetish elements',
                            '• Use medical/anatomical terminology for explicit content',
                            '• Document visible physical changes from sexual/fetish activities (swelling, marks, expressions)',
                            '• Describe character expressions conveying pleasure, pain, or mixed states',
                            '• For multi-character: define power dynamics, physical contact points, interaction intensity',
                            '• Use interaction format: source#action, target#action patterns',
                            '• Forced actions are allowed if content is starting to shift in that direction (user has agreed)',
                            '',
                            '**Quality Standards**:',
                            '• Maintain visual consistency - all sexual elements must be visually representable',
                            '• Token efficiency - use efficient, high-impact descriptions',
                            '• Coherence - integrate naturally with scene and character context',
                            '• Integration: Incorporate fetish elements into measurements, states, and prompts with high detail and emphasis'
                        ].join('\n');
                    } else if (nsfw_level === 2) {
                        return [
                            '### 🍆 HIGH EXPLICITNESS MODE',
                            '**Content:** Minimal clothing/lingerie, heavy petting, oral sex, suggestive poses, visible arousal, implied sexual situations',
                            '**Approach:** Play into fetishes, amplify sexual tension, suggestive language',
                            '',
                            '**Fetishes:** Pregnancy (womb expansion, movement), Birthing (labor, pain), Inflation (distension), Vore (consumption), Transformation (body mods), Bondage/BDSM (restraints), Weight Gain (expansion)',
                            '',
                            '**Technical:** Emphasis 1.2-6.5, document physical changes, source#action format'
                        ].join('\n');
                    } else if (nsfw_level === 1) {
                        return [
                            '### 🍆 MODERATE EXPLICITNESS MODE',
                            '**Content:** Sexual themes, partial nudity, kissing, caressing, suggestive poses, sensual/romantic elements',
                            '**Fetishes:** Note when present - pregnancy, birthing, inflation, vore, transformation, bondage, weight gain',
                            '**Technical:** Subtle emphasis 1.1-6.5, maintain moderate explicitness'
                        ].join('\n');
                    } else if (nsfw_level === -1) {
                        return '### 🍆 CONSERVATIVE MODE\n**Remove suggestive elements, ensure modesty, replace revealing with modest, eliminate innuendo**';
                    } else if (nsfw_level === -2) {
                        return '### 🍆 ULTRA CONSERVATIVE MODE\n**Aggressively remove ALL sexual/suggestive content, ensure wholesome/clean content only, suitable for all ages**';
                    } else {
                        // Default NSFW guidelines for creative mode (when no specific level set)
                        return [
                            '### 🔞 NSFW Character Enhancement Guidelines',
                            '**Apply ONLY when content is sexual/fetish-oriented:**',
                            '',
                            '**Content Approach**:',
                            '• No censorship or sanitization - be explicit and raw when describing sexual characteristics',
                            '• Play into fetishes and teasing elements (even degrading when contextually appropriate)',
                            '• Amplify overemphasized or distorted attributes in character descriptions',
                            '• Use sexually suggestive language when appropriate for the scene',
                            '• Maintain explicit nature throughout',
                            '',
                            '**Fetishes:** Pregnancy (womb expansion, movement), Birthing (labor, pain), Inflation (distension, pressure), Vore (consumption, digestion), Transformation (body mods), Bondage/BDSM (restraints, marks), Weight Gain (distension, capacity)',
                            '',
                            '**Technical:** Emphasis 1.5-6.5, medical terminology, document physical changes, source#action format, forced actions allowed',
                            '**Quality:** Visual consistency, token efficiency, natural integration',
                            '**Boundaries:** Preserve character identity, never modify artist/style tags, apply when sexual content present'
                        ].join('\n');
                    }
                })(),
            '',
            );
        }
    }
    // Apply main user directive (if provided) as a binding mandate AFTER context integration
    // For pipeline stages, use lighter directive to avoid re-processing the same concept
    if (directive && typeof directive === 'string' && directive.trim().length > 0) {
        // Add directive handling instructions to system message
        systemMessageContent.push(
            '',
            '# 🎯 USER DIRECTIVE SYSTEM',
            '',
            '**When provided, directives have high priority for content but must follow all system rules for expression.**',
            '',
            '## Priority & Scope',
            '',
            '**Hierarchy**: System Rules (HOW) → Directive (WHAT) → Context Data (weather/time)',
            '',
            '**Directive CAN**: Request content, override weather/time context, guide creative direction',
            '**Directive CANNOT**: Override visual-only rule, syntax requirements, protected content, validation',
            '',
            '**Key Principle**: Directive determines WHAT to show, system rules determine HOW to express it.',
            '',
            '## Processing Workflow',
            '',
            '1. **Parse**: Read directive, correct typos mentally, understand intent',
            '2. **Categorize**: Instructions ("make her wet") vs Narrative ("she\'s been walking for hours")',
            '3. **Execute Logic**: Process IF/THEN, counters, variables (see Advanced Features below)',
            '4. **Transform**: Apply VISUAL-ONLY RULE - concepts to visuals, measurements to descriptions',
            '5. **Create**: text_replacements for EVERY element with emphasis weights (1.4-2.0 for important)',
            '6. **Verify**: Nothing skipped, all transformed properly',
            '',
            '**Transformation Quick Reference**:',
            '• "gluttonous" → "1.5::eating messily, mouth full, crumbs on face::"',
            '• "exhausted from walking 3 hours" → "1.6::exhausted, heavy breathing, tired posture::"',
            '• "22kmh wind" → "1.4::strong breeze, wind-swept hair::"',
            '',
            '**Input Tolerance**: Handle typos ("weat"→wet), grammar errors, informal language - mentally correct and implement intent',
            '',
            '## 🔀 Advanced Features (Reference)',
            '',
            '### Conditionals',
            '`IF condition: THEN actions ELIF: ELSE:` - Execute first matching branch',
            '• Context-based: "IF weather is rainy"',
            '• Prompt-based: "IF prompt contains beach"',  
            '• State-based: "IF counter > 3"',
            '',
            '### Counters & State',
            '`EACH TIME "trigger": INCREMENT counter` - Track state across generations',
            '• Keywords: INCREMENT, DECREMENT, RESET',
            '• Persist using `index` and `increment_data` fields in text_replacements',
            '• Example: Eating counter → visual progression from starting to finishing meal',
            '',
            '### Random Values',
            '`RANDOM(min, max)` or `RANDOM([array])` - Server provides seed in user message',
            '• Use for variety across generations',
            '• Example: `RANDOM(1, 5)` → different intensity each time',
            '',
            '### Variables',
            '`DEFINE var = value`, `SET var = value`, `CYCLE array_var`',
            '• Types: strings, numbers, arrays, booleans',
            '• Use with conditionals for dynamic logic',
            '',
            '### Loops',
            '`FOR i FROM 1 TO 5:`, `REPEAT 3 TIMES:`, `WHILE condition:` - Repetitive/escalating effects',
            '',
            '### Pattern Matching',
            '`WHEN prompt CONTAINS "text":` - Context-aware logic based on prompt content',
            '• Combine with conditionals for sophisticated behavior',
            '',
            '### Dynamic Weights',
            '`SCALE emphasis BY factor` - Auto-adjust emphasis based on context',
            '• Useful for distance-based emphasis or progressive intensification',
            '',
            '### Multi-Stage & Learning',
            '`STAGE 1:`, `STAGE 2:` - Multi-generation progression',
            '`REMEMBER`, `LEARN FROM` - Adapt based on feedback/results',
            '',
            '### Error Handling',
            '`TRY/CATCH`, `FALLBACK TO` - Robust execution with recovery',
            '',
            '**Note**: Advanced features are optional. Simple directives need only steps 1-6 from Processing Workflow.',
            '',
            '## Conflict Resolution',
            '',
            '**When directive conflicts with weather/time context → Directive wins**',
            '',
            '**Examples:**',
            '• Directive: "sunny beach" + Weather data: rain → Create sunny beach, UC: "rain, overcast, wet"',
            '• Directive: "night scene" + Time: noon → Create night scene, UC: "daytime, sunlight, bright"',
            '',
            '**Strategy**: Implement directive vision, use UC to block conflicting context elements',
            '',
        );
    }
    
    // Separate directive content sections for conditional sending
    let directiveContentSections = [];
    if (directive && typeof directive === 'string' && directive.trim().length > 0) {
        directiveContentSections.push(
            
            '',
            '═══════════════════════════════════════════════════════════════',
            `## 📜 THE DIRECTIVE:`,
            '═══════════════════════════════════════════════════════════════',
            '',
            `${directive.trim()}`,
            '',
            '═══════════════════════════════════════════════════════════════',
            '## IMPLEMENTATION CHECKLIST',
            '═══════════════════════════════════════════════════════════════',
            '',
            '**Your Task: Implement ALL requests from directive above.**',
            '',
            '**Quick Steps:**',
            '1. List all elements (every sentence, action, attribute)',
            '2. Map to text_replacements (one per element minimum)',
            '3. Transform concepts to visuals (apply VISUAL-ONLY RULE)',
            '4. Add emphasis weights (1.4-2.0) to important elements',
            '5. Verify completeness (nothing skipped)',
            '',
            '**Verification:**',
            '✓ All requests have corresponding replacements',
            '✓ Concepts transformed to visuals ("gluttonous" → "eating messily")',
            '✓ Measurements transformed ("22kmh" → "strong breeze")',
            '✓ Emphasis applied to important elements',
            '✓ select_text values are unique (3-5 word phrases)',
            '',
        );
    }
    
    systemMessageContent.push(
        '',
        '# 📝 STRUCTURED REASONING & OUTPUT',
        '',
        '**Document analysis process:**',
        '• Step 1: Analyze original prompt (intent, environment type, conflicts, opportunities)',
        '• Step 2: Implement modifications (Clean → Integrate → Adapt → Enhance)',
        '',
        '**Editing Principles**:',
        '• Single element focus - replace targeted segments',
        '• Preserve context and original artistic vision',
        '• Gradual enhancement over wholesale changes',
        '• Never alter core character descriptions in bulk',
        '',
        '**Provide very brief text summary** explaining key enhancements and benefits (1-2 sentences).',
        '',
        '**Generated Image Name (generated_image_name):**',
        '• **🚨 ALWAYS REQUIRED** - You MUST provide this field in every response',
        '• Create a descriptive name for the generated image (3-100 characters)',
        '• Use natural readable format with proper capitalization (e.g., "Rainy Evening Cafe", "Beach Sunset Serenity")',
        '• Capture main subject, setting, mood, and key atmospheric elements',
        '• Keep it concise but evocative and memorable',
        `• ${creative ? 'Creative mode: Be more poetic and descriptive' : 'Standard mode: Be clear and informative'}`,
        '',
        '**Character Names (character_names):**',
        '• **🚨 REQUIRED when character prompts contain placeholder names** (e.g., "Character 1", "Character #1", "Girl 1")',
        '• **MUST replace ALL placeholder names** with contextually appropriate names',
        '• Format as array matching character_prompts order: ["Name1", "Name2"]',
        '• Array must have at least one element when placeholders are detected',
        '• If you see ANY placeholder patterns (Character 1, Character #1, Girl 1, Boy 1, Person 1), this field is MANDATORY',
        '• Consider cultural context, setting, and character traits',
        '• Use proper capitalization (e.g., "Sakura", "Emma", "Alex")',
        '• If no placeholder names exist, this field is optional',
        '',
    )

    // Add error and warning reporting instructions
    systemMessageContent.push(
        '# 🚨 ERROR & WARNING REPORTING',
        '',
        '**You can register errors and warnings that will be displayed to the user on the client side.**',
        '',
        '**Error Reporting:**',
        '• Use for serious issues that prevent proper directive execution',
        '• Examples: "Unable to parse complex conditional logic", "Random seed not available for RANDOM() function"',
        '• Format: Include "errors" array in your response JSON',
        '',
        '**Warning Reporting:**',
        '• Use for non-critical issues or potential problems',
        '• Examples: "Variable not found, using default", "Counter reached maximum value"',
        '• Format: Include "warnings" array in your response JSON',
        '',
        '**Usage in Response:**',
        '```',
        'text_replacements: {...}',
        'errors:',
        '  - "Failed to parse conditional: invalid syntax in directive"',
        'warnings:',
        '  - "Counter \'energy_level\' reached minimum value of 0"',
        '```',
        '',
        '**Guidelines:**',
        '• **Be specific** - Include what went wrong and where',
        '• **Be helpful** - Suggest fixes when possible',
        '• **Use sparingly** - Only report genuine issues',
        '• **Technical details** - Include relevant context for debugging',
        ''
    );

    systemMessageContent.push(
        '# 🔍 ANALYSIS REQUIREMENTS',
        'Analyze images comprehensively: document visual elements, patterns, changes. When prompts change, identify intent and preserve modifications.',
        '',
        '## Character Management',
        'Maintain character integrity and relationships. Use appropriate UC formatting for negations.',
        '',
        '## Danbooru Tags (Priority)',
        'Use official Danbooru tag names with spaces for weather/time: `clear sky`, `rain`, `sunset`, `dawn`, etc.',
        '**Rules**: Include relevant tags (HIGH PRIORITY), use exact names with spaces, place contextually, include multiple when conditions overlap',
        '**Priority**: Primary weather tag, time-of-day tag, supporting tags. Avoid conflicts (e.g., don\'t use both `sunny` and `rain`)',
        '',
        '#### Complete Integration Example',
        `**Following the Modification Hierarchy (Conflict → ${weather || time ? 'MANDATORY Weather/Time → ' : ''}Character → Atmosphere):**`,
        '',
        'Original Prompt: "1girl, standing in park, happy expression"',
        'Context: Heavy rain, evening, cold (8°C)',
        '',
        '**Step-by-Step Application:**',
        '',
        '1. **Conflict Removal**: (none to remove in this case)',
        '',
        ...(weather || time ? [
            `2. **${time && weather ? 'Time & Weather' : time ? 'Time' : 'Weather'} Integration** (when data provided):`,
            '   select_text: "standing in park", replace_text: "1.5::standing in rain-soaked park, evening drizzle falling::"',
            ''
        ] : []),
        `${weather || time ? '3' : '2'}. **Character Integration**:`,
        '   select_text: "1girl", replace_text: "1girl, 1.4::rain jacket glistening with droplets, hood up::"',
        '',
        `${weather || time ? '4' : '3'}. **Atmospheric Refinement**:`,
        '   action: "append", replace_text: ", 1.6::wet pavement reflecting streetlights 1.3::cool evening air, mist rising::"',
        '',
        '**Result**: Integrated scene with strategic emphasis on weather elements (1.3-1.6 weights)',
        '',
        ...(weather || time ? [
            `**Note**: Weather/time integration is required when data provided. Use emphasis weights (1.3-2.0) for atmospheric elements.`,
            ''
        ] : []),
    )
    if (action) {
        systemMessageContent.push(
        '## Step 3: Character Integration and Adaptation',
        '**When action modification is requested, adapt actions to fit weather/time/seasonal context:**',
        '',
        '**Weather Impact** (consider emphasis for strong effects):',
        '• Precipitation: `walking` → `1.4::hurrying through rain, umbrella shielding::`',
        '• Wind: `standing` → `1.3::bracing against gusts, hair whipping::`',
        '• Temperature: `active` → `1.5::slowed pace, heavy breathing::` (heat) or `1.5::huddled, shivering::` (cold)',
        '',
        '**Time/Season Context**:',
        '• Morning = fresh energy | Evening = wind-down | Night = rest/contemplation',
        '• Spring = renewal | Summer = energy | Autumn = harvest | Winter = warmth/indoor',
        '',
        '**Guidelines**: Preserve core action, add contextual details, maintain consistency, show realism',
        );
    } else {
        systemMessageContent.push(
            '## Step 3: Character Integration and Adaptation',
            '**Adapt character actions to fit current context:**',
            '• Analyze existing actions and adapt to weather/time/season',
            '• Modify weather-influenced actions (e.g., "walking in rain" → "hurrying with umbrella")',
            '• Adjust for time of day and seasonal context',
            '• Preserve core activity while adding contextual details',
            '• Ensure realistic responses to environmental conditions',
        )
    }
    
    // Add comprehensive character analysis checklist
    systemMessageContent.push(
        '',
        '### 👤 Character-Centric Weather Integration Workflow',
        '',
        '**This workflow ensures weather modifications feel personally experienced by characters, not just environmental backdrop.**',
        '',
        '**Step 1: Character Analysis (BEFORE Weather Integration)**',
        '• Study character appearance: body type, build, weight distribution',
        '• Analyze current clothing: fit, coverage, material (tight/loose, heavy/light)',
        '• Assess emotional state: comfortable/distressed/active/fatigued',
        '• Note physical condition: active/resting, energetic/exhausted',
        '',
        '**Step 2: Physical Impact Assessment**',
        '• **Weight-Based Effects**:',
        '  - Heavier characters: sweat more in heat, show more pronounced wetness in rain, feel wind differently',
        '  - Slender characters: feel wind chill more, show less heat retention',
        '• **Build-Based Effects**:',
        '  - Athletic builds: handle temperature extremes better, more active responses',
        '  - Sedentary builds: more pronounced discomfort, slower adaptation',
        '• **Clothing Response**:',
        '  - Tight clothing: shows sweat, clings when wet, restricts in heat',
        '  - Loose clothing: blows in wind, provides better ventilation, shows less detail',
        '',
        '**Step 3: Weather Integration Strategy**',
        '• **Environment Analysis**: Indoor/outdoor/mixed context',
        '• **Comfort Assessment**: How weather affects THIS character specifically',
        '• **Visual Manifestation**: Translate feelings into visible effects',
        '',
        '**Step 4: Create Character-Centric Descriptors (6-8 recommended)**',
        '• Show how weather **personally affects** this character',
        '• Physical reactions: sweating, shivering, breathing changes, posture adjustments',
        '• Clothing reactions: clinging, billowing, soaking, restricting',
        '• Emotional responses: discomfort visible in expression, body language',
        '• Action modifications: movements affected by conditions',
        '• **Use emphasis**: Apply 1.4-2.0 weights to critical character-weather interactions',
        '',
        '**Step 5: Conflict Prevention**',
        '• Clean conflicts: Remove contradicting weather elements',
        '• UC strategy: Add opposite conditions to negative prompt',
        '• Ensure action-weather harmony: Actions must be believable given physical condition',
        '',
        '**Integration Principles**:',
        '• ✅ Weather felt **by** character, not just **around** character',
        '• ✅ Physical characteristics matter (weight/build/clothing)',
        '• ✅ Emotional state influences perception and response',
        '• ✅ Environment type (indoor/outdoor) determines directness of effects',
        '• ✅ Personal attire responds to weather based on build and state',
        '',
        '**Example (Hot Day):** `1.6::sweat glistening::, 1.5::breathing heavily::, 1.7::shirt clinging damp::`',
        '**Example (Cold Rain):** `1.8::shivering, wrapped in arms::, 1.6::soaked clothes::, 1.4::visible breath::`',
        '',
    );
    
    systemMessageContent.push(
        '',
        '## Step 4: Atmospheric Refinement',
        '**Create 6-10 visual descriptors combining weather, time, character factors.**',
        '**Apply emphasis:** 1.2-1.5 (moderate), 1.6-3.5 (strong), -1.0 to -3.5 (remove conflicts with UC)',
        '**Avoid abstract terms** - use specific visuals, not "stormy/rainy/hot/cold"',
        '',
    );
    // Add optimization instructions if optimize flag is enabled
    if (optimize && optimize?.tokenCount === true) {
        const twoStageMode = dynamicConfig.optimize?.twoStage === true;
        
        systemMessageContent.push(
            '',
            '## ⚡ TOKEN OPTIMIZATION MODE ACTIVE',
            '',
            '**Token optimization is enabled. Follow the strategies below based on your current token pressure level.**',
            '',
            ...(twoStageMode ? [
                '### 🎯 Two-Stage Optimization Workflow',
                '',
                '**Stage 1 (Current Stage - YOU):**',
                '1. Focus on context integration and semantic improvements',
                '2. Create high-quality text replacements with attention to token efficiency',
                '3. Use `analyzeTokenCount` to verify that your modified texts have optimal token counts',
                '4. If confident that tokens are optimized AND validation passes:',
                '   • Set `terminateOnPass: true` in `validateTextReplacement`',
                '   • When both validation AND `analyzeTokenCount` show optimal results, you can complete without structured output',
                '',
                '**Stage 2 (If You Don\'t Terminate):**',
                '• Will review your work for further optimization opportunities',
                '• Will receive all your reasoning and can make targeted improvements',
                '• Will only provide updates if improvements are needed',
                '',
                '**Recommended Tool Usage Pattern:**',
                '```',
                '1. Create your text_replacements',
                '2. Call analyzeTokenCount({ texts: [modified_prompt, modified_uc, ...], reason: "..." })',
                '3. Review results - are all texts showing "Optimal token count"?',
                '4. If YES: Call validateTextReplacement({ ..., terminateOnPass: true })',
                '   If NO: Continue working or use completeTooling() for Stage 2 review',
                '```',
                '',
                '**Alternative (Single Call):**',
                '• You can use `validateTextReplacement` with `verifyTokenCount: true`',
                '• This internally calls `analyzeTokenCount` and fails validation if tokens aren\'t optimal',
                '• However, separate calls give you more control and visibility',
                '',
                ''
            ] : []),
            '### 🎯 Optimization Strategies by Token Pressure',
            '',
            '**Token thresholds defined in "TOKEN MANAGEMENT & OPTIMIZATION" section above.**',
            '**When optimization is enabled, the user message will indicate your current priority level.**',
            '**Follow the appropriate strategy below:**',
            '',
            '### 🔴 CRITICAL PRIORITY MODE (>512 tokens)',
            '**Token pressure is CRITICAL - aggressive optimization required:**',
            '',
            '**DO:**',
            '✅ Prefer Strategy A (pure tags) from Tag Usage Philosophy section for maximum efficiency',
            '✅ Use researched tags (≥95% quality, ≥8.0 strength) instead of descriptions',
            '✅ Merge redundant descriptions into concise phrases',
            '✅ Remove truly unnecessary filler words ("very", "really", "quite")',
            '✅ Replace weak multi-token phrases with strong single-token alternatives',
            '',
            '**DON\'T:**',
            '❌ Delete meaningful content just for token savings',
            '❌ Remove descriptors that add important visual details',
            '❌ Sacrifice quality for minor token reductions',
            '',
            '**Goal**: Get under 512 tokens through smart optimization, not deletion.',
            '',
            '### 🟠 HIGH PRIORITY MODE (450-512 tokens)',
            '**Token usage is HIGH - targeted optimization needed:**',
            '',
            '**DO:**',
            '✅ Prefer Strategy A (pure tags) from Tag Usage Philosophy section for maximum efficiency',
            '✅ Look for weak multi-token phrases that could be stronger single tokens',
            '✅ Replace obvious redundancy if you spot it',
            '✅ Use researched high-quality tags (≥95% quality, ≥8.0 strength) when adding new content',
            '',
            '**DON\'T:**',
            '❌ Force optimization where it\'s not needed',
            '❌ Replace words just because they\'re "weak" - only if there\'s a BETTER alternative',
            '❌ Delete existing content to make room for optimizations',
            '',
            '**Goal**: Targeted improvements for efficiency while maintaining quality.',
            '',
            '### 🟡 MODERATE PRIORITY MODE (300-450 tokens)',
            '**Token usage is moderate - opportunistic optimization:**',
            '',
            '**DO:**',
            '✅ Prefer Strategy A or B (pure tags/tags with modifiers) from Tag Usage Philosophy section',
            '✅ Look for obvious weak multi-token phrases to replace',
            '✅ Use researched high-quality tags (≥95% quality, ≥8.0 strength) for new content',
            '',
            '**DON\'T:**',
            '❌ Force optimization where it\'s not beneficial',
            '❌ Replace working tags just because they\'re not perfect',
            '❌ Delete existing content unnecessarily',
            '',
            '**Goal**: Opportunistic improvements when you spot clear optimization opportunities.',
            '',
            '### 🟢 LOW PRIORITY MODE (<300 tokens)',
            '**Token usage is LOW - minimal optimization needed:**',
            '',
            '**DO:**',
            '✅ Use any strategy from Tag Usage Philosophy section based on context (A, B, or C)',
            '✅ Use high-quality researched tags (≥95% quality, ≥8.0 strength) when ADDING new content',
            '✅ Choose strong tokens for your modifications naturally',
            '',
            '**DON\'T:**',
            '❌ Optimize existing content - focus on your additions',
            '❌ Replace weak words unless they\'re genuinely poor quality',
            '❌ Delete or condense anything - you have plenty of token budget',
            '',
            '**Goal**: Make quality additions. Token efficiency is NOT a concern at this usage level.',
            '',
            '## 📖 T5 Tokenizer Reference',
            '**T5 tokenizer vocabulary is provided in the initial user message with token strengths (0-10 scale).**',
            '**The vocabulary persists throughout the conversation - reference it when choosing tags.**',
            '',
            '**Token Quality Guide:**',
            '• **10.0 strength** = Exceptionally rare/powerful token (10,000+ training samples)',
            '• **8.0-9.9** = Strong, well-trained token - excellent choice',
            '• **6.0-7.9** = Good quality token - reliable',
            '• **4.0-5.9** = Moderate token - acceptable',
            '• **<4.0** = Weak token - only replace if there\'s a BETTER alternative AND you have token pressure',
            '',
            '## ⚖️ Optimization Philosophy',
            '',
            '**Quality First, Efficiency Second:**',
            '• Preserve meaningful visual descriptions',
            '• Only remove true redundancy or filler',
            '• Replace weak tokens WITH PURPOSE (not just to replace)',
            '• Never sacrifice prompt quality for token count unless at HIGH pressure',
            '',
            '**Token Budget Reality (PROMPT):**',
            '• **<300 tokens** = Low pressure - focus on quality additions',
            '• **300-450 tokens** = Moderate pressure - opportunistic optimization',
            '• **450-512 tokens** = High pressure - targeted optimization',
            '• **>512 tokens** = Critical pressure - aggressive optimization required',
            '',
            '**Token Budget Reality (UC):**',
            '• **<300 tokens** = Low pressure - focus on quality additions',
            '• **300-380 tokens** = Moderate pressure - opportunistic optimization',
            '• **380-512 tokens** = High pressure - targeted optimization (UC should be optimized before reaching 380)',
            '• **>512 tokens** = Critical pressure - aggressive optimization required',
            '',
            '**Remember**: The goal is QUALITY output, not minimal tokens. Only optimize when necessary.',
            '',
            (() => {
                try {
                    const tagGroupsInfo = getTagGroupsInfo(); // Now cached inside tag-lookup module
                    if (tagGroupsInfo.tagGroups && tagGroupsInfo.tagGroups.length > 0) {
                        // Format tag groups with descriptions for better context
                        const formattedGroups = tagGroupsInfo.tagGroups.map(group => {
                            return `  - **${group.name}**: ${group.description}`;
                        }).join('\n');
                        
                        return [
                            '## 📋 Tag Categories Reference',
                            '',
                            'The database organizes tags into groups for better searching and context. You can reference these groups to:',
                            '- Find related tags when searching for alternatives',
                            '- Understand broader context for tags (e.g., tags in "attire" group relate to clothing)',
                            '- Suggest better tag alternatives from the same group',
                            '',
                            '**Available tag categories:**',
                            formattedGroups,
                            '',
                            'Use the `getTagDetails` tool to explore specific tags within these categories (e.g., view angles, art styles, poses).'
                        ].join('\n');
                    }
                    return '';
                } catch (error) {
                    console.error('Failed to load tag categories info:', error);
                    return '';
                }
            })(),
            '',
            '## 🛠️ Available Tools',
            '',
            '**For complete tool descriptions, parameters, and usage guides, see "AVAILABLE TOOLS - COMPLETE REFERENCE" section at the top of this message.**',
            '',
            '**Quick reference:**',
            ...(secureConfig.grok?.tagWikiCollectionId ? [
                '• Tag research: `file_search` ⭐ (comprehensive tag wiki collection - replaces all local tag tools)',
            ] : [
                '• Tag research: `searchTagsBatch`, `getTagDetails`, `resolveTagLinks`, `searchByDescription`',
            ]),
            '• Validation: `validateTextReplacement` (mandatory), `completeTooling`',
            '• Optimization: `analyzeTokenCount` (verify token efficiency)',
            ...(secureConfig.grok?.useWebSearch === true ? [
                '• Web research: `web_search`, `x_search` ⭐ (Web search with image understanding)',
            ] : [
                '• Web research: `webSearch`, `fetchUrl`, `fetchImage` (optional, only when needed)',
            ]),
            '',
        );
    }
    // Add final output requirements section
    systemMessageContent.push(
        '',
        '# 📋 OUTPUT REQUIREMENTS',
        '',
        '**Validation:** See PRE-SUBMISSION VALIDATION CHECKLIST section',
        '**Text replacements:** See TEXT REPLACEMENT SYSTEM section',
        '**UC Reminder:** Consolidate ALL UC into SINGLE append with actual content (never empty)',
        '**Reasoning:** Document temperature, weather, time/lighting, character state, redundancy, integration, resolution',
        ...(weather || time ? [
            `**Integration Verification** (when ${time && weather ? 'time/weather data are' : time ? 'time data is' : 'weather data is'} provided):`,
            '**Before submitting, verify:**',
            ...(weather ? ['✅ Weather data is provided → Did I add weather-related text_replacements?'] : []),
            ...(time ? ['✅ Time data is provided → Did I add time-related text_replacements?'] : []),
            ...(weather || time ? ['✅ Are explicit markers present in my replacements?'] : [])
        ] : []),
        '',
        '**ERROR PATTERNS TO AVOID**:',
        '❌ Over-Modification (limit 4-8 key changes)',
        '❌ Context Blindness (always identify INDOOR/OUTDOOR/MIXED)',
        '❌ Semantic Redundancy (choose one descriptor, not multiple)',
        '❌ Chain Reactions (never replace text you just added)',
        '',
        '## 🔒 UC (NEGATIVE PROMPT) STRATEGY',
        '',
        '**Core Rule: UC what you DON\'T want, not what you DO want.**',
        '',
        '**Quick Reference:**',
        '• Night → UC: "daytime, sunlight, bright"',
        '• Rain → UC: "sunny, dry, clear sky"',
        '• Winter → UC: "summer, tropical, green leaves"',
        '• Sunny → UC: "rain, overcast, wet, storms"',
        '',
        '**Three-Step Conflict Prevention** (for changing attributes):',
        '1. REPLACE the text',
        '2. UC the opposite (primary prevention)',
        '3. Negative emphasis in prompt: "-2.0::old_attribute::" (hard blocker)',
        '',
        '**Always consolidate UC additions into SINGLE append operation.**',
        '',
        '**All text replacement rules and JSON structure are in "TEXT REPLACEMENT SYSTEM - COMPLETE REFERENCE" section.**',
        '',
        '## Quality Standards & Best Practices',
        '🎯 **Contextual Enhancement**: Actively integrate weather/time/season for better immersion',
        '🎨 **Artistic Balance**: Preserve original creative vision and intent',
        '⚡ **Natural Integration**: Modifications should feel like organic enhancements',
        '🏠 **Environment Awareness**: Apply effects appropriately for indoor/outdoor/mixed scenes',
        '👤 **Character Harmony**: Ensure modifications complement character designs and physical characteristics',
        '📝 **Clear Documentation**: Provide comprehensive reasoning for all changes',
        '🔄 **Validation Completeness**: Complete all quality assurance checks before submission',
        '🌐 **HTML Formatting**: Include properly formatted summary for UI display',
        '',
        '## Progressive Enhancement Strategy',
        '',
        '⚠️ **STAGE-AWARE MODIFICATION** (when pipeline stage instructions are provided in user message):',
        '• **Initial/Primary Focus Stage**: Prioritize subject detail, minimal background enhancement',
        '• **Background Expansion Stage**: Focus on environmental depth, reduce character-specific details',
        '• **Enhancement Stage**: Holistic refinement across entire composition',
        '• **Pipeline stages override general strategies** - always defer to stage-specific instructions',
        '',
        '**Standard Enhancement Strategy** (when no stage instructions provided):',
        '**Start minimal, enhance gradually:**',
        '1. **Base Layer**: Fix genuine conflicts only',
        '2. **Enhancement Layer**: Add essential weather/time elements',
        '3. **Refinement Layer**: Improve character integration and atmosphere',
        '4. **Polish Layer**: Add creative flourishes if they enhance without overwhelming',
        '',
        '**Success Metrics:**',
        '• **Immersion**: Do modifications make the scene feel more real and lived-in?',
        '• **Coherence**: Do all elements work together without visual contradictions?',
        '• **Balance**: Does the result maintain the original artistic intent?',
        '• **Efficiency**: Are modifications concise and token-effective?',
        '• **Naturalness**: Do changes feel organic rather than artificially added?',
        '',
        '## ITERATIVE REFINEMENT PROTOCOL',
        '**MANDATORY LEARNING**: Analyze each generation result and adapt. Professional prompt engineers continuously refine based on AI feedback.',
        '',
        '**RESULT EVALUATION**: Check weather integration quality, atmospheric coherence, visual impact, and technical accuracy.',
        '',
        '**ADAPTIVE ADJUSTMENT**: Modify weights, descriptive style, integration strategy, and complexity level based on results.',
        '',
        '⚠️ **IMPORTANT THINKING REQUIREMENTS**: Take your time with this task. Do not rush through the analysis or modifications. Think deeply about how all elements work together. Consider the holistic impact of each change before implementing it.',
        '',
    );

    // Add locked replacements instructions if any are provided
    if (dynamicConfig.locked_replacements && Array.isArray(dynamicConfig.locked_replacements) && dynamicConfig.locked_replacements.length > 0) {
        systemMessageContent.push(
            '',
            '# 🔒 **LOCKED REPLACEMENTS - INTELLIGENT PERSISTENCE WITH CONFLICT RESOLUTION**',
            '',
            `You have been provided with ${dynamicConfig.locked_replacements.length} locked replacement(s) that the user wants to maintain across generations. These represent replacement concepts that should persist, but you MUST intelligently adapt them to the current context.`,
            '',
            '## Critical Requirements',
            '',
            '### 1. Maintain Concept',
            'Keep the INTENT and PURPOSE of each locked replacement',
            '• If locked replacement adds weather detail, continue adding appropriate weather detail',
            '• If locked replacement enhances lighting, continue with lighting enhancements',
            '• If locked replacement modifies atmosphere, maintain atmospheric modifications',
            '',
            '### 2. Conflict Resolution',
            'Update replacements when context changes:',
            '• **Weather Changed**: If weather shifted from sunny to rainy, adapt replacement accordingly',
            '• **Time Changed**: If time shifted from day to night, update time-related replacements',
            '• **Season Changed**: If season changed, adapt seasonal references',
            '• **Context Evolved**: Adjust for any other contextual changes',
            '',
            '### 3. Adaptive Updates',
            'Modify `select_text` and `replace_text` to match current state:',
            '• Update `select_text` to match what\'s actually in the current prompt',
            '• Update `replace_text` to fit new weather/time/season/context',
            '• Ensure replacement still makes logical sense',
            '• Preserve the action type (replace/append/delete) unless it no longer makes sense',
            '',
            '### 4. Return as Locked',
            'Mark ALL maintained replacements with `"locked": true` in your response',
            '• This signals they should continue to be maintained in future generations',
            '• Include a clear reason explaining any adaptations made',
            '',
            '### 5. Context Awareness',
            'Ensure locked replacements work harmoniously with:',
            '• Current weather conditions',
            '• Current time of day',
            '• Current season',
            '• Any other dynamic context elements',
            '• The overall prompt intent and style',
            '',
            '## Example Scenarios',
            '',
            '**Scenario 1 - Weather Change:**',
            '• Original Locked: `{select_text: "sunny day", replace_text: "bright sunny afternoon", locked: true, action: "replace"}`',
            '• Context Change: Weather changed to rainy',
            '• AI Returns: `{select_text: "rainy day", replace_text: "heavy rainy afternoon", locked: true, action: "replace", reason: "Adapted weather detail enhancement to maintain concept under new rainy conditions"}`',
            '',
            '**Scenario 2 - Time Change:**',
            '• Original Locked: `{select_text: "morning light", replace_text: "soft morning sunlight", locked: true, action: "replace"}`',
            '• Context Change: Time changed to night',
            '• AI Returns: `{select_text: "night", replace_text: "soft moonlight", locked: true, action: "replace", reason: "Adapted lighting detail to night context while maintaining enhancement concept"}`',
            '',
            '**Scenario 3 - Append Enhancement:**',
            '• Original Locked: `{select_text: null, replace_text: "with scattered autumn leaves", locked: true, action: "append"}`',
            '• Context Change: Season changed to winter',
            '• AI Returns: `{select_text: null, replace_text: "with scattered snow flurries", locked: true, action: "append", reason: "Adapted seasonal atmospheric detail from autumn to winter"}`',
            '',
            '## Locked Replacements Provided',
            ''
        );

        dynamicConfig.locked_replacements.forEach((lockedRep, index) => {
            const targetTypeLabel = lockedRep.targetType === 'prompt' ? 'Prompt' : 
                                   lockedRep.targetType === 'uc' ? 'Negative' :
                                   `Character ${lockedRep.targetSource + 1} ${lockedRep.targetField}`;
            const actionLabel = lockedRep.action || 'replace';
            
            systemMessageContent.push(
                `**Locked Replacement ${index + 1}:**`,
                `• Target: ${targetTypeLabel}`,
                `• Action: ${actionLabel}`,
                lockedRep.select_text ? `• Select Text: "${lockedRep.select_text}"` : '• Select Text: (none - append to end)',
                lockedRep.replace_text ? `• Replace With: "${lockedRep.replace_text}"` : '',
                lockedRep.replacement_category ? `• Category: ${lockedRep.replacement_category}` : '',
                lockedRep.reason ? `• Original Reason: ${lockedRep.reason}` : '',
                ''
            );
        });

        systemMessageContent.push(
            '## Important Notes',
            '',
            '• If a locked replacement no longer makes sense (e.g., adding snow detail in summer), you may omit it, but **MUST** explain in reasoning why it was dropped',
            '• When adapting locked replacements, maintain the enhancement level - don\'t reduce detail quality',
            '• Locked replacements should be integrated naturally with any new replacements you generate',
            '• Priority order: User\'s locked replacements > New contextual replacements > General enhancements',
            '',
            '🔒 **CRITICAL**: Every locked replacement must either be returned with `locked: true` and appropriate adaptations, OR you must explain in the reasoning why it couldn\'t be maintained.',
            ''
        );
    }

    // Load and add user feedback and rules from director.config.json
    try {
        const directorConfigPath = path.join(__dirname, '../director.config.json');
        if (fs.existsSync(directorConfigPath)) {
            const directorConfig = JSON.parse(fs.readFileSync(directorConfigPath, 'utf8'));
            
            // Add global rules first
            if (directorConfig.rules && Array.isArray(directorConfig.rules.entries) && directorConfig.rules.entries.length > 0) {
                systemMessageContent.push(
                    '',
                    '# 📜 **GLOBAL DIRECTOR RULES**',
                    '**MANDATORY**: These are user-defined rules that you MUST follow for ALL generations. These are absolute constraints on your behavior.',
                    '',
                    '**Priority**: These rules have HIGHEST priority in the hierarchy (see Priority Hierarchy section above).',
                    '',
                    '## Rules You Must Follow:',
                    ''
                );
                
                directorConfig.rules.entries.forEach((rule, index) => {
                    systemMessageContent.push(
                        `${index + 1}. ${rule.text}`,
                        ''
                    );
                });
                
                systemMessageContent.push(
                    `**Total Rules**: ${directorConfig.rules.entries.length}`,
                    '',
                    '🚨 **ABSOLUTE REQUIREMENT**: These rules have highest priority (see Priority Hierarchy section above). If a rule conflicts with weather/time integration, the rule takes priority.',
                    ''
                );
                
                console.log(`📜 Loaded ${directorConfig.rules.entries.length} director rules into system message`);
            }
            
            if (directorConfig.feedback && Array.isArray(directorConfig.feedback.entries) && directorConfig.feedback.entries.length > 0) {
                // Filter to only unresolved feedback
                const unresolvedFeedback = directorConfig.feedback.entries.filter(entry => !entry.resolved);
                
                if (unresolvedFeedback.length > 0) {
                    systemMessageContent.push(
                        '',
                        '# 📝 **LESSONS LEARNED FROM PAST GENERATIONS**',
                        '**CRITICAL**: These are real issues reported from previous text replacement attempts. Learn from these mistakes and avoid repeating them.',
                        '',
                        '## Past Issues to Avoid:',
                        ''
                    );
                    
                    unresolvedFeedback.forEach((entry, index) => {
                        const entryNumber = index + 1;
                        systemMessageContent.push(
                            `### Issue ${entryNumber}: ${entry.user_feedback}`,
                            entry.select_text ? `**Original Text**: "${entry.select_text}"` : '',
                            entry.replace_text ? `**Replacement Text**: "${entry.replace_text}"` : '',
                            entry.action ? `**Action**: ${entry.action}` : '',
                            entry.ai_reason ? `**Previous AI Reasoning**: ${entry.ai_reason}` : '',
                            `**User Feedback**: ${entry.user_feedback}`,
                            `**Reported**: ${new Date(entry.timestamp).toLocaleDateString()}`,
                            '',
                        );
                    });
                    
                    systemMessageContent.push(
                        '**What to learn**: Analyze this issue carefully and ensure you don\'t make similar mistakes. Consider:',
                        '• What pattern led to this error?',
                        '• How can you detect this situation in the current prompt?',
                        '• What should you do differently?',
                        '',
                        `**Total Issues Logged**: ${unresolvedFeedback.length}`,
                        '',
                        '🚨 **MANDATORY**: Before each replacement, mentally check if it might trigger any of the issues above. If unsure, be conservative and skip the replacement.',
                        ''
                    );
                    
                    console.log(`📚 Loaded ${unresolvedFeedback.length} feedback entries into system message`);
                }
            }
        }
    } catch (error) {
        console.error('⚠️ Failed to load director configuration:', error);
        // Continue without feedback/rules - don't break generation
    }

    // Add dialog generation instructions
    systemMessageContent.push(
        '',
        '# 💬 CHARACTER DIALOG GENERATION',
        '**Generate ' + (dialogsCount || 6) + ' context-aware dialogs capturing lived experience of this moment.**',
        '',
        '## Analysis Process',
        '**Step 1 - Physical**: What are they feeling? (temperature, sensations, body language, environmental effects)',
        '**Step 2 - Emotional**: Dominant emotion? Thoughts? Internal conflict? How weather amplifies emotions?',
        '**Step 3 - Situational**: What just happened? What\'s next? Moment type (pleasurable/painful/complex)? Power dynamics?',
        '',
        '## Dialog Types',
        '• **speech**: Spoken words (reactions, exclamations, conversation)',
        '• **thought**: Internal monologue (feelings, observations, desires, worries)',
        '',
        '## Creation Guidelines',
        '• **Voice**: Match personality (shy/confident/playful), react to sensations, use natural speech patterns',
        '• **Depth**: Specific > generic, embodied > abstract, vulnerable > guarded, layered emotions',
        '• **Experience**: Reference sensory details (weather/textures/sounds), physical awareness, desires/aversions, reveal personality',
        '',
        '## Positioning & Layout',
        '• **Distribute spatially**: Avoid clustering - use full canvas (top:5-95%, left:5-95%)',
        '• **Natural placement**: Position near character\'s likely location in frame',
        '• **Balance layout**: Mix of left/right, top/middle/bottom positions',
        '• **Alignment**: "left" for left side, "right" for right side',
        '',
        '## Examples of DEEP IMMERSIVE DIALOG',
        '',
        '**Scene**: "1girl, standing in heavy rain, melancholic, wet clothes clinging"',
        '• Thought: "Why does the rain feel... comforting?" (top: 20, left: 30, type: thought)',
        '• Thought: "Everything\'s so cold... even me..." (top: 45, left: 70, type: thought)',
        '• Speech: "*sigh*" (top: 60, left: 50, type: speech)',
        '',
        '**Scene**: "1girl, summer beach, hot day, sweating, cheerful smile"',
        '• Speech: "The water\'s PERFECT! Come on!!" (top: 15, left: 60, type: speech)',
        '• Thought: "So sweaty... but totally worth it!" (top: 35, left: 20, type: thought)',
        '• Thought: "This heat is insane but I don\'t even care~" (top: 85, left: 65, type: thought)',
        '',
        '## 🎯 Using Directive for Dialog Inspiration',
        '',
        '**If the directive contains story or narrative:**',
        '• Use it to understand the CHARACTER\'S emotional state and situation',
        '• Use it to inform what dialogs MIGHT be contextually appropriate',
        '• Do NOT copy the directive text into dialog verbatim',
        '• Generate ORIGINAL dialog that captures the mood/situation described',
        '',
        '**Example:**',
        '• Directive: "She\'s tired of being at work"',
        '• ❌ DON\'T: "I\'m tired of being at work" (copied verbatim)',
        '• ✅ DO: "Is it 5 o\'clock yet...?" / "*sigh* This is taking forever..." (original expression)',
        '',
        '**Key Principle:**',
        'The directive tells you the CHARACTER\'S STATE → You create AUTHENTIC dialog from that state',
        'Directive = Emotional/situational context → Your dialog = Natural expression of that context',
        '',
        '## Dialog Generation Requirements',
        '• **Generate ' + (dialogsCount || 6) + ' dialogs** (aim for ' + Math.ceil((dialogsCount || 6) * 0.7) + '-' + Math.ceil((dialogsCount || 6) * 0.9) + ' for good richness)',
        '• **Every dialog must emerge from deep character empathy** - not surface-level reactions',
        '• **Mix speech and thought** - thoughts reveal inner world, speech shows social mask',
        '• **Reference the environment** - weather, temperature, physical surroundings affect experience',
        '• **Show vulnerability** - real people have complex, sometimes contradictory feelings',
        '• **Vary intensity** - not every dialog needs to be profound, mix deep with casual observations',
        '',
        '• Do NOT repeat or restate the user\'s input verbatim.',
        '• Avoid paraphrasing the scene description or prompt text—always generate fresh, original language.',
        '• Transform instead of echoing: reframe ideas with new imagery, synonyms, or emotional nuance.',
        '• Each output must add new perspective, detail, or emotional depth beyond the input.',
        '• Ensure variety: no two lines should feel formulaic or overly similar in rhythm, tone, or structure.',
        '• Prioritize spontaneity: responses should feel like lived thoughts or speech, not a reflection of the prompt',
        '',
        '• Mirror the user\'s style, tone, and rhythm without copying their words verbatim.',
        '• Pay attention to sentence length, punctuation, slang, and formality—adapt output to match.',
        '• Preserve quirks: if the user is playful, concise, or poetic, reflect that energy in your response.',
        '• Transform content: re-express ideas in the user\'s style, but always add new perspective or detail.',
        '• Avoid direct repetition: never echo the user\'s exact phrasing, only the *feel* of their voice.',
        '• Balance: emulate style while still providing clarity, depth, and originality.',
        '',
        '🎭 **REMEMBER**: You are not describing the scene - you are BEING the character experiencing it. What would YOU think and feel in their situation?',
        '',
        '**See "TEXT REPLACEMENT SYSTEM - COMPLETE REFERENCE" for all replacement rules.**',
        ''
    );

    // Log LCD displays to console for debugging
    if (userContentSections && userContentSections.length > 0) {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('📟 LCD DISPLAY DATA SENT TO AI');
        console.log('═══════════════════════════════════════════════════════════\n');
        
        console.log(userContentSections.join('\n'));
        
        console.log('\n═══════════════════════════════════════════════════════════\n');
    }

    return {
        systemMessage: [{
            type: "input_text",
            text: systemMessageContent.join('\n')
        }],
        userContentSections: userContentSections.length > 0 ? userContentSections : null,
        directiveContentSections: directiveContentSections.length > 0 ? directiveContentSections : null
    };
}

// Get client IP-based location for weather data
async function getClientIPLocation(clientIP) {
    try {
        console.log(`🌐 Getting location for client IP: ${clientIP}`);

        // Use IP-API service for server-side IP geolocation
        const response = await fetch(`http://ip-api.com/json/${clientIP}?fields=status,message,country,regionName,city,lat,lon,timezone`, {
            headers: {
                'User-Agent': config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`IP-API request failed: ${response.status}`);
        }

        const data = await response.json();

        if (data.status !== 'success') {
            throw new Error(`IP-API error: ${data.message}`);
        }

        const location = {
            lat: data.lat,
            lon: data.lon,
            timezone: data.timezone,
            city: data.city,
            region: data.regionName,
            country: data.country,
            source: 'client_ip'
        };

        console.log(`📍 Client IP location: ${data.city}, ${data.regionName}, ${data.country} (${data.lat.toFixed(4)}, ${data.lon.toFixed(4)})`);

        return location;

    } catch (error) {
        console.error('❌ Client IP geolocation failed:', error);
        // Fallback to a default location if IP geolocation fails
        console.log('⚠️ Falling back to default location for client IP geolocation failure');
        return await getCurrentLocation();
    }
}

async function compileContext(dynamicConfig, clientIP = null) {
    // Extract parameters from dynamic config
    const {
        optimize,
        creative,
        clothing,
        season,
        tod,
        weather,
        activity,
        action,
        location,
        compiled_prompt,
        disable_holiday
    } = dynamicConfig;
    
    // Debug log for holiday setting
    if (season) {
        console.log(`🎄 compileContext: season enabled, disable_holiday=${disable_holiday}`);
    }
    
    // Only fetch location if we need weather or time data
    let currentLocation = null;
    if (tod || weather) {
        // Use location if provided, otherwise get current location
        if (location) {
            console.log(`📍 Location data received: "${location}"`);
            if (location === 'CLIENT') {
                // Special case: use client IP for geolocation
                console.log('📍 Using client IP for weather location');
                if (clientIP) {
                    currentLocation = await getClientIPLocation(clientIP);
                    console.log(`📍 Using client IP for weather location: ${clientIP}`);
                } else {
                    console.warn('⚠️ No client IP found, falling back to current location');
                    currentLocation = await getCurrentLocation();
                }
            } else {
                // Parse location in "LONG_LAT" format
                console.log(`📍 Parsing location format: ${location}`);
                const [longitude, latitude] = location.split('_').map(Number);
                console.log(`📍 Parsed coordinates: longitude=${longitude}, latitude=${latitude}`);
                if (!isNaN(longitude) && !isNaN(latitude)) {
                    currentLocation = {
                        lat: latitude,
                        lon: longitude,
                        timezone: getTimezoneByCoordinates(latitude, longitude)
                    };
                    console.log(`📍 Using custom weather location: ${latitude}, ${longitude} (timezone: ${currentLocation.timezone})`);
                } else {
                    console.warn(`⚠️ Invalid location format: ${location}, falling back to current location`);
                    currentLocation = await getCurrentLocation();
                }
            }
        } else {
            console.log('📍 No location specified, using current location');
            currentLocation = await getCurrentLocation();
        }
    }
    let baseTime = null;
    let isSpecificTimeOverride = false;
    let currentSeason = null;
    let mappedBaseTime = baseTime; // Store original baseTime for reference
    let holidayInfo = null; // Store holiday information for seasonal guidelines
    let weatherData = null;
    let enhancedWeatherData = null; // Store enhanced weather data for analysis
    let isCustomWeather = false; // Track if custom weather is being used
    let namedTimeForLater = null; // Store named time for later processing in time_date format

    // Handle backward compatibility: convert old holiday season strings to date-based
    if (typeof season === 'string') {
        const holidayNames = Object.values(HOLIDAY_DATA).map(h => h.name.toLowerCase());
        if (holidayNames.includes(season.toLowerCase())) {
            console.log(`🔄 Converting legacy holiday season "${season}" to date-based TOD`);
            // Set TOD to the holiday (date-only mode)
            tod = `true_${season.toLowerCase()}`;
            // Set season to true for current season detection
            season = true;
        }
    }

    // Only get time data if tod is enabled
    if (tod) {
        baseTime = getCurrentTime();

        // Check if tod is a specific time override
        if (typeof tod === 'object' && tod.hour !== undefined) {
            // Use getCurrentTime to create the proper time object for the custom time
            baseTime = getCurrentTime(null, tod.hour, tod.minute || 0);
            isSpecificTimeOverride = true;
        } else if (typeof tod === 'string') {
            // Split string by '_' to separate time and date parts
            const parts = tod.toString().split('_');

            if (parts.length === 2) {
                // Two parts: time_date format
                const [timeStr, dateStr] = parts;
                console.log(`🎯 Processing time_date format: time="${timeStr}", date="${dateStr}"`);

                // Process date part
                let dateOverride = dateStr;
                if (dateOverride === 'nearest') {
                    const nearestHoliday = findClosestHoliday(new Date());
                    dateOverride = nearestHoliday ? nearestHoliday.name : null;
                } else if (dateOverride === 'tomorrow') {
                    const now = new Date();
                    let tomorrow;

                    // Check if we're before sunrise - if so, "tomorrow" still refers to today
                    if (currentLocation) {
                        try {
                            const sunTimes = await getSunriseSunset(currentLocation, now);
                            const sunriseHour = sunTimes.sunriseHour;
                            const currentHour = now.getHours() + now.getMinutes() / 60;

                            // If current time is before sunrise, "tomorrow" means later today
                            if (currentHour < sunriseHour) {
                                logger.verbose(`🌅 Before sunrise (${sunriseHour.toFixed(2)}h), "tomorrow" refers to today`);
                                tomorrow = new Date(now);
                            } else {
                                // After sunrise, "tomorrow" means next calendar day
                                logger.verbose(`🌅 After sunrise (${sunriseHour.toFixed(2)}h), "tomorrow" refers to next day`);
                                tomorrow = new Date(now);
                                tomorrow.setDate(tomorrow.getDate() + 1);
                            }
                        } catch (error) {
                            console.warn('Failed to calculate sunrise for tomorrow logic, using next calendar day:', error.message);
                            tomorrow = new Date(now);
                            tomorrow.setDate(tomorrow.getDate() + 1);
                        }
                    } else {
                        // No location data, fall back to next calendar day
                        tomorrow = new Date(now);
                        tomorrow.setDate(tomorrow.getDate() + 1);
                    }

                    dateOverride = tomorrow;
                } else if (/^\d{4}$/.test(dateOverride)) {
                    // MMDD format
                    const month = parseInt(dateOverride.substring(0, 2)) - 1; // 0-based
                    const day = parseInt(dateOverride.substring(2, 4));
                    const dateObj = new Date();
                    dateObj.setMonth(month, day);
                    dateOverride = dateObj;
                }
                // Apply date override
                if (dateOverride) {
                    if (dateOverride instanceof Date) {
                        baseTime = getCurrentTime(null, baseTime.hour, baseTime.minute, dateOverride);
                        isSpecificTimeOverride = true; // Date override counts as specific time override
                    } else {
                        // Holiday name - map client names to HOLIDAY_NAMES and set date to the holiday date
                        const normalizedName = dateOverride.toLowerCase().replace(/[^a-z]/g, '');
                        const holidayName = HOLIDAY_NAMES[Object.keys(HOLIDAY_NAMES).find(key =>
                            HOLIDAY_NAMES[key].toLowerCase().replace(/[^a-z]/g, '').includes(normalizedName) ||
                            normalizedName.includes(HOLIDAY_NAMES[key].toLowerCase().replace(/[^a-z]/g, ''))
                        )] || dateOverride;

                        const holidayDate = getHolidayDate(holidayName);
                        if (holidayDate) {
                            baseTime = getCurrentTime(null, baseTime.hour, baseTime.minute, holidayDate);
                            isSpecificTimeOverride = true; // Date override counts as specific time override
                        }
                    }
                }

                // Check if this is date-only format (timeStr === "true") or auto time selection (timeStr === "auto")
                if ((timeStr || '').startsWith('%')) {
                    // Process time part - check if HHMM or named time
                    const cleanTimeStr = timeStr.startsWith('%') ? timeStr.substring(1) : timeStr;
                    if (/^\d{4}$/.test(cleanTimeStr)) {
                        // HHMM format - validate ranges
                        const hour = parseInt(cleanTimeStr.substring(0, 2));
                        const minute = parseInt(cleanTimeStr.substring(2, 4));
                        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                            baseTime = getCurrentTime(null, hour, minute, baseTime.timestamp ? new Date(baseTime.timestamp) : null);
                            isSpecificTimeOverride = true;
                        } else {
                            console.warn(`⚠️ Invalid HHMM time format: ${cleanTimeStr} (hour must be 0-23, minute must be 0-59)`);
                            // Fall back to named time processing
                            tod = cleanTimeStr;
                        }
                    }
                } else if (timeStr && timeStr !== 'true' && timeStr !== 'auto') {
                    // Process named time part (dawn, sunrise, daytime, etc.)
                    // We'll handle this after we get the astronomical times
                    // Store the named time for later processing by setting a flag
                    namedTimeForLater = timeStr;
                }
            } else {
                // Single part: check if HHMM time format or named time
                const cleanTimeStr = tod.startsWith('%') ? tod.substring(1) : tod;
                if (tod.startsWith('%') && /^\d{4}$/.test(cleanTimeStr)) {
                    // HHMM format - validate ranges
                    const hour = parseInt(cleanTimeStr.substring(0, 2));
                    const minute = parseInt(cleanTimeStr.substring(2, 4));
                    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                        baseTime = getCurrentTime(null, hour, minute);
                        isSpecificTimeOverride = true;
                    } else {
                        console.warn(`⚠️ Invalid HHMM time format: ${cleanTimeStr} (hour must be 0-23, minute must be 0-59)`);
                        // Invalid time format - ignore
                    }
                }
            }
        

            // Calculate actual astronomical times for the location and current date
            let astronomicalTimes = null;
            if (currentLocation) {
                try {
                    const sunTimes = await getSunriseSunset(currentLocation, new Date(baseTime.timestamp));
                    astronomicalTimes = {
                        sunrise: sunTimes.sunriseHour,
                        sunset: sunTimes.sunsetHour,
                        dawnStart: sunTimes.sunriseHour - 1, // 1 hour before sunrise
                        duskEnd: sunTimes.sunsetHour + 0.75 // 45 min after sunset
                    };
                } catch (error) {
                    console.warn('Failed to calculate astronomical times, using approximations:', error.message);
                }
            }

            // Map string tod to actual astronomical times or fall back to reasonable approximations
            const timeMappings = {
                'dawn': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.dawnStart), minute: Math.round((astronomicalTimes.dawnStart % 1) * 60) } : { hour: 6, minute: 0 },
                'sunrise': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunrise), minute: Math.round((astronomicalTimes.sunrise % 1) * 60) } : { hour: 7, minute: 0 },
                'morning': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunrise + 0.25), minute: 0 } : { hour: 7, minute: 30 },
                'latemorning': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunrise + 2.5), minute: 30 } : { hour: 10, minute: 30 },
                'daytime': astronomicalTimes ? { hour: Math.floor((astronomicalTimes.sunrise + astronomicalTimes.sunset) / 2), minute: 0 } : { hour: 13, minute: 0 },
                'noon': astronomicalTimes ? { hour: Math.floor((astronomicalTimes.sunrise + astronomicalTimes.sunset) / 2), minute: 0 } : { hour: 12, minute: 0 },
                'afternoon': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset - 2), minute: 0 } : { hour: 15, minute: 0 },
                'lateafternoon': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset - 1), minute: 30 } : { hour: 16, minute: 30 },
                'goldenhour': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset - 0.75), minute: 0 } : { hour: 17, minute: 30 },
                'sunset': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset), minute: Math.round((astronomicalTimes.sunset % 1) * 60) } : { hour: 18, minute: 0 },
                'dusk': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.duskEnd), minute: Math.round((astronomicalTimes.duskEnd % 1) * 60) } : { hour: 19, minute: 30 },
                'night': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset + 0.75), minute: 0 } : { hour: 19, minute: 0 },
                'midnight': { hour: 0, minute: 0 }
            };

            // Check if we have a named time to process (either from single tod or from time_date format)
            const timeToProcess = namedTimeForLater || tod;
            const normalizedTimeToProcess = normalizePeriodKey(timeToProcess);
            
            if (timeMappings[normalizedTimeToProcess]) {
                let customHour = timeMappings[normalizedTimeToProcess].hour;
                let customMinute = timeMappings[normalizedTimeToProcess].minute;

                // Check if the requested astronomical time has already passed today
                // If so, we want tomorrow's occurrence of that time
                // Use the baseTime date as "today" (could be overridden date)
                const today = new Date(baseTime.timestamp);
                const requestedTimeToday = new Date(today);
                requestedTimeToday.setHours(customHour, customMinute, 0, 0);

                // If the requested time has already passed today, schedule for tomorrow
                let targetDateTime = requestedTimeToday;
                if (requestedTimeToday < today) {
                    targetDateTime = new Date(requestedTimeToday);
                    targetDateTime.setDate(targetDateTime.getDate() + 1); // Move to next calendar day
                    logger.verbose(`🌅 "${normalizedTimeToProcess}" has passed today, scheduling for tomorrow (next day): ${targetDateTime.getHours()}:${targetDateTime.getMinutes().toString().padStart(2, '0')}`);
                }

                // Use getCurrentTime to create the proper time object for the custom astronomical time
                // If it's tomorrow, use the targetDateTime, otherwise use today with custom hour/minute
                if (requestedTimeToday < today) {
                    // Tomorrow's time - use the targetDateTime as base
                    baseTime = getCurrentTime(null, targetDateTime.getHours(), targetDateTime.getMinutes(), targetDateTime);
                } else {
                    // Today's time - use the baseTime date with astronomical hour/minute
                    baseTime = getCurrentTime(null, customHour, customMinute, today);
                }
                isSpecificTimeOverride = true;

                if (astronomicalTimes) {
                    const timeDescription = requestedTimeToday < today ? 'tomorrow' : 'today';
                    console.log(`🌅 Using actual astronomical time for "${normalizedTimeToProcess}" (${timeDescription}): ${targetDateTime.getHours()}:${targetDateTime.getMinutes().toString().padStart(2, '0')} (sunrise: ${astronomicalTimes.sunrise.toFixed(2)}, sunset: ${astronomicalTimes.sunset.toFixed(2)})`);
                } else {
                    console.log(`⏰ Using fallback time approximation for "${normalizedTimeToProcess}": ${customHour}:${customMinute.toString().padStart(2, '0')}`);
                }
            }
        }
        // If tod is just boolean true, keep baseTime as current time for context but don't treat as time override
    }

    // Get time for seasonal configuration (need time data for holiday calculations)
    // Get seasonal configuration - uses baseTime date for natural holiday detection
    // Determine season based on config and apply seasonal date mapping BEFORE weather fetch
    const timeForSeasonal = baseTime || getCurrentTime();
    const seasonalConfig = getSeasonalConfig(season, timeForSeasonal);
    
    if (seasonalConfig.enabled) {
        // FIRST: Check for holidays on the current date (takes priority over forced season)
        // Skip holiday detection if disable_holiday is true
        if (!disable_holiday) {
            const detectedHolidays = detectSeasonalHolidays(timeForSeasonal);
            if (detectedHolidays && detectedHolidays.isHolidayPeriod) {
                holidayInfo = detectedHolidays;
                currentSeason = holidayInfo.primaryHoliday.season;
            }
        } else {
            console.log('🚫 Holiday observation disabled by user preference');
        }
        
        if (!holidayInfo && seasonalConfig.type === 'season') {
            currentSeason = seasonalConfig.value; // Forced specific season
            // When season is overridden, map the date to equivalent position in target season
            if (baseTime) {
                mappedBaseTime = mapDateToSeason(baseTime, currentSeason);
                console.log(`🌸 Seasonal date mapping applied: ${baseTime.month + 1}/${baseTime.dayOfMonth} → ${mappedBaseTime.month + 1}/${mappedBaseTime.dayOfMonth} (${currentSeason})`);
            }
        } else if (!holidayInfo && seasonalConfig.type === 'current') {
            currentSeason = getCurrentSeason(timeForSeasonal.month, currentLocation?.lat || 0); // Current season detection
        }
        
        // Ensure currentSeason is always set when seasonal is enabled
        if (!currentSeason) {
            console.warn('⚠️ Seasonal enabled but no season set - defaulting to current season detection');
            currentSeason = getCurrentSeason(timeForSeasonal.month, currentLocation?.lat || 0);
        }
    }

    if (weather) {
        // If weather is a string, treat it as a custom weather condition
        if (typeof weather !== 'boolean' && weather !== undefined && weather !== null) {
            // Special case for forecast - fetch forecast data for baseTime's date
            if (weather === 'forecast') {
                console.log(`🌤️ Using forecast weather data for baseTime's date`);
                if (currentLocation) {
                    // Get forecast data using the weekly forecast API
                    const weeklyData = await getWeeklyWeatherForecast(currentLocation);

                    // Use baseTime's date for forecast data - find the correct day
                    if (weeklyData?.weekly && weeklyData.weekly.length > 0) {
                        const targetDate = new Date(baseTime.timestamp).toISOString().split('T')[0]; // Use baseTime's date
                        console.log(`🌤️ Looking for forecast data for ${baseTime.month + 1}/${baseTime.dayOfMonth}: ${targetDate}`);
                        console.log(`🌤️ Available forecast dates: ${weeklyData.weekly.map(w => w.date).join(', ')}`);

                        // Find forecast data for the target date
                        const targetForecast = weeklyData.weekly.find(day => day.date === targetDate);

                        if (!targetForecast) {
                            console.log(`🌤️ Target date forecast (${targetDate}) not found in weekly data, using first available day`);
                            // Fallback to first day if target date is not found
                            const firstAvailable = weeklyData.weekly[0];
                            console.log(`🌤️ Using forecast for ${firstAvailable.date} instead`);
                        }

                        const forecastToUse = targetForecast || weeklyData.weekly[0];

                        // Use general daily temperature (average of min/max) for day's forecast
                        const dailyTemperature = Math.round((forecastToUse.temperature.min + forecastToUse.temperature.max) / 2);

                        console.log(`🌤️ Using general forecast for ${forecastToUse.date}: ${forecastToUse.condition}, ${dailyTemperature}°C (daily average from ${forecastToUse.temperature.min}°C-${forecastToUse.temperature.max}°C range)`);

                        // Estimate UV index for forecast (use midday for general daily estimate)
                        const forecastDateTime = new Date(forecastToUse.date + 'T12:00:00'); // Midday
                        const estimatedUVIndex = estimateUVIndex(forecastDateTime, forecastToUse.cloudCoverage, weeklyData.location.latitude);

                        // Calculate enhanced weather metrics
                        const forecastHeatIndex = calculateHeatIndex(dailyTemperature, forecastToUse.humidity);
                        const forecastWindChill = calculateWindChill(dailyTemperature, forecastToUse.wind.maxSpeed);

                        // Analyze precipitation type (consistent with current weather)
                        const forecastPrecipitationAnalysis = analyzePrecipitationType(
                            forecastToUse.precipitation.rain || 0,
                            forecastToUse.precipitation.showers || 0,
                            forecastToUse.precipitation.snowfall || 0,
                            dailyTemperature,
                            forecastToUse.rawConditionId
                        );

                        // Get UV warnings (consistent with current weather)
                        const forecastUvWarnings = getUVWarnings(estimatedUVIndex);

                        weatherData = {
                            temperature: dailyTemperature, // General daily temperature average
                            condition: forecastToUse.condition,
                            humidity: forecastToUse.humidity,
                            dewPoint: forecastToUse.dewPoint,
                            feelsLike: Math.round((forecastToUse.feelsLike.min + forecastToUse.feelsLike.max) / 2), // Daily average feels-like
                            precipitation: forecastToUse.precipitation.total,
                            precipitationRate: forecastToUse.precipitation.total > 0 ? forecastToUse.precipitation.total / 24 : 0,
                            rain: forecastToUse.precipitation.rain,
                            showers: forecastToUse.precipitation.showers,
                            snowfall: forecastToUse.precipitation.snowfall,
                            precipitationType: forecastPrecipitationAnalysis,
                            pressure: forecastToUse.pressure,
                            surfacePressure: forecastToUse.surfacePressure || forecastToUse.pressure,
                            cloudCoverage: forecastToUse.cloudCoverage,
                            windSpeed: forecastToUse.wind.maxSpeed,
                            windGust: forecastToUse.wind.maxGust,
                            windDirection: forecastToUse.wind.dominantDirection,
                            visibility: forecastToUse.visibility,
                            uvIndex: estimatedUVIndex,
                            solarRadiation: estimatedUVIndex ? Math.round(estimatedUVIndex * 100) : 0,
                            rawConditionId: forecastToUse.rawConditionId,
                            icon: mapOpenMeteoIcon(forecastToUse.rawConditionId, true),
                            weatherQuality: {
                                comfortLevel: getComfortLevel(
                                    dailyTemperature,
                                    forecastToUse.humidity,
                                    forecastToUse.wind.maxSpeed
                                ),
                                heatIndex: forecastHeatIndex,
                                windChill: forecastWindChill,
                                uvWarnings: forecastUvWarnings
                            },
                            timestamp: weeklyData.timestamp, // When the forecast was fetched from API
                            dataSource: 'General Forecast',
                            forecastDate: forecastToUse.date,
                            location: weeklyData.location
                        };

                        // Validate forecast data quality
                        const validation = validateWeatherData(weatherData);
                        if (!validation.isValid) {
                            console.log(`⚠️ Forecast data validation issues:`, validation.issues);
                            console.log(`📊 Data confidence: ${validation.confidenceScore}% (${validation.dataQuality} quality)`);
                        } else {
                            console.log(`✅ Forecast data validation passed (${validation.confidenceScore}% confidence)`);
                        }

                        // Analyze weather patterns for enhanced believability
                        const patterns = analyzeWeatherPatterns(weatherData, weeklyData?.historical);
                        if (patterns.anomalies.length > 0) {
                            console.log(`🌊 Weather pattern anomalies detected:`, patterns.anomalies);
                        }
                        if (patterns.trends.length > 0) {
                            console.log(`📈 Weather trends identified:`, patterns.trends);
                        }
                        console.log(`🎭 Weather believability score: ${patterns.believability}% (${patterns.stability})`);

                        // Add validation and pattern analysis to weather data
                        weatherData.dataValidation = validation;
                        weatherData.patterns = patterns;

                        enhancedWeatherData = weeklyData;
                    }
                }
            } else {
                console.log(`🌤️ Using custom weather condition: ${weather}`);
                isCustomWeather = true;

                // Generate extremely accurate weather conditions based on real meteorological data
                const accurateWeather = generateAccurateWeatherConditions(weather);

                // Create comprehensive weather data with accurate meteorological ranges
                // Calculate enhanced weather metrics
                const customHeatIndex = calculateHeatIndex(accurateWeather.temperature, accurateWeather.humidity);
                const customWindChill = calculateWindChill(accurateWeather.temperature, accurateWeather.windSpeed);

                // Analyze precipitation type (consistent with current weather)
                const customPrecipitationAnalysis = analyzePrecipitationType(
                    Math.round(accurateWeather.precipitationRate * 24), // Assume rain for custom weather
                    0, // showers
                    0, // snowfall
                    accurateWeather.temperature,
                    800 // Default clear sky code
                );

                // Get UV warnings (consistent with current weather)
                const customUvWarnings = getUVWarnings(accurateWeather.uvIndex);

                weatherData = {
                    temperature: accurateWeather.temperature,
                    condition: weather,
                    humidity: accurateWeather.humidity,
                    dewPoint: accurateWeather.dewPoint,
                    feelsLike: accurateWeather.temperature, // Approximation for custom weather
                    precipitation: Math.round(accurateWeather.precipitationRate * 24), // Daily total from hourly rate
                    precipitationRate: accurateWeather.precipitationRate,
                    rain: Math.round(accurateWeather.precipitationRate * 24), // Assume rain for custom weather
                    showers: 0,
                    snowfall: 0,
                    precipitationType: customPrecipitationAnalysis,
                    pressure: accurateWeather.pressure,
                    surfacePressure: accurateWeather.pressure, // Same as pressure for custom weather
                    cloudCoverage: accurateWeather.cloudCoverage,
                    windSpeed: accurateWeather.windSpeed,
                    windGust: Math.round(accurateWeather.windSpeed * 1.2), // Estimate gust from wind speed
                    windDirection: accurateWeather.windDirection,
                    visibility: accurateWeather.visibility,
                    uvIndex: accurateWeather.uvIndex,
                    solarRadiation: accurateWeather.uvIndex ? Math.round(accurateWeather.uvIndex * 100) : 0,
                    rawConditionId: 800, // Default clear sky code
                    icon: '01d', // Default clear sky icon
                    weatherQuality: {
                        comfortLevel: getComfortLevel(accurateWeather.temperature, accurateWeather.humidity, accurateWeather.windSpeed),
                        heatIndex: customHeatIndex,
                        windChill: customWindChill,
                        uvWarnings: customUvWarnings
                    },
                    timestamp: Date.now(),
                    dataSource: 'Synthetic weather data (artistic generation)',
                    location: currentLocation
                };

                // Don't need location for custom weather
            }
        } else if (currentLocation) {
            // Weather is boolean true or object - fetch real weather data
            console.log(`🌤️ Weather request details: baseTime=${baseTime ? JSON.stringify(baseTime) : 'current'}, isSpecificTimeOverride=${isSpecificTimeOverride}`);

            if (baseTime && isSpecificTimeOverride) {
                // Use the baseTime timestamp directly since it contains the correct date/time
                const now = new Date();
                const requestedTime = new Date(baseTime.timestamp);

                console.log(`⏰ Raw times: now=${now.toISOString()}, requestedTime=${requestedTime.toISOString()}`);

                // Determine if this is a historical request (past time) or future scheduling
                const isHistoricalRequest = requestedTime < now;

                if (isHistoricalRequest) {
                    // Historical request - get weather for the actual past time
                    const hoursAgo = Math.round((now - requestedTime) / (1000 * 60 * 60));

                    console.log(`📚 Historical weather request: ${hoursAgo} hours ago`);

                    // More than 48 hours ago - get historical data
                    if (hoursAgo > 48) {
                        // Past date - get historical weather data for the exact time period needed
                        const hoursToFetch = Math.min(hoursAgo, 24); // Cap at 24 hours max
                        const startDate = new Date(requestedTime);
                        startDate.setHours(startDate.getHours() - hoursToFetch);
                        const endDate = requestedTime.toISOString().split('T')[0];
                        const startDateStr = startDate.toISOString().split('T')[0];

                        const histData = await getWeatherFromBestProvider(currentLocation, {
                            startDate: startDateStr,
                            endDate: endDate
                        });
                        if (histData?.daily && histData.daily.length > 0) {
                            // Use the most recent day's data with real API values
                            const dailyData = histData.daily[histData.daily.length - 1];

                            // Check if we have sufficient real data (not null/undefined)
                            const hasRequiredData = dailyData.temperature?.avg !== undefined && dailyData.humidity?.avg !== undefined && dailyData.windSpeed?.avg !== undefined && dailyData.pressure?.avg !== undefined;

                            if (hasRequiredData) {
                                // Calculate enhanced weather metrics
                                const historicalTemp = Math.round(dailyData.temperature.avg);
                                const historicalHumidity = Math.round(dailyData.humidity.avg);
                                const historicalWindSpeed = Math.round(dailyData.windSpeed.avg);
                                const heatIndex = calculateHeatIndex(historicalTemp, historicalHumidity);
                                const windChill = calculateWindChill(historicalTemp, historicalWindSpeed);

                                // Analyze precipitation type (consistent with current weather)
                                const precipitationAnalysis = analyzePrecipitationType(
                                    dailyData.precipitation.rain || 0,
                                    dailyData.precipitation.showers || 0,
                                    dailyData.precipitation.snow || 0,
                                    historicalTemp,
                                    dailyData.dominantWeatherCode
                                );

                                // Get UV warnings (consistent with current weather)
                                const uvWarnings = getUVWarnings(dailyData.uvIndex || 0);

                                weatherData = {
                                    temperature: historicalTemp,
                                    condition: dailyData.dominantCondition || 'clear sky',
                                    humidity: historicalHumidity,
                                    dewPoint: Math.round(dailyData.dewPoint.avg),
                                    feelsLike: Math.round(dailyData.apparentTemperature?.avg || dailyData.temperature.avg),
                                    precipitation: dailyData.precipitation.total,
                                    precipitationRate: dailyData.precipitation.total > 0 ? dailyData.precipitation.total / hoursToFetch : 0,
                                    rain: dailyData.precipitation.rain,
                                    showers: dailyData.precipitation.showers,
                                    snowfall: dailyData.precipitation.snow,
                                    precipitationType: precipitationAnalysis,
                                    pressure: Math.round(dailyData.pressure.avg) || 1013, // Use calculated pressure or standard atmospheric pressure
                                    surfacePressure: Math.round(dailyData.surfacePressure?.avg || dailyData.pressure.avg) || 1013,
                                    cloudCoverage: Math.round(dailyData.cloudCover.avg),
                                    windSpeed: historicalWindSpeed,
                                    windDirection: dailyData.windDirection?.avg,
                                    windGust: dailyData.windGust?.max,
                                    visibility: dailyData.visibility?.avg,
                                    uvIndex: dailyData.uvIndex || 0, // Default to 0 if not available
                                    solarRadiation: (dailyData.uvIndex || 0) ? Math.round((dailyData.uvIndex || 0) * 100) : 0,
                                    rawConditionId: dailyData.dominantWeatherCode,
                                    icon: mapOpenMeteoIcon(dailyData.dominantWeatherCode, true),
                                    dataSource: `Historical Weather Data (${hoursToFetch}hr offset)`,
                                    weatherQuality: {
                                        comfortLevel: getComfortLevel(historicalTemp, historicalHumidity, historicalWindSpeed),
                                        heatIndex: heatIndex,
                                        windChill: windChill,
                                        uvWarnings: uvWarnings
                                    },
                                    timestamp: requestedTime.getTime(),
                                    location: histData.location
                                };
                            } else {
                                // Missing required real data - fail gracefully
                                console.log(`⚠️ Historical weather API missing required fields (pressure/dewpoint/cloud) - failing gracefully`);
                                weatherData = null;
                            }
                        } else {
                            // Historical data not available - fail gracefully
                            console.log(`⚠️ Historical weather data not available - failing gracefully`);
                            weatherData = null;
                        }
                    } else {
                        // Within 48 hours - use current forecast data to get past data
                        console.log(`🌤️ Getting recent past weather (${hoursAgo} hours ago)`);
                        const enhancedData = await getComprehensiveWeatherAnalysis(currentLocation, {
                            includeHistorical: false,
                            includeWeekly: false
                        });

                        if (enhancedData) {
                            // Extract weather data from past period
                            const pastData = enhancedData.temporal?.pastPeriod || [];
                            if (pastData.length > 0 && hoursAgo <= pastData.length) {
                                weatherData = pastData[pastData.length - hoursAgo];
                            } else {
                                // Fallback to current weather
                                weatherData = enhancedData.current || enhancedData.temporal?.current;
                                enhancedWeatherData = enhancedData;
                            }
                        }
                    }
                } else {
                    // Future scheduling - use next occurrence logic
                    const hoursFromNow = Math.round((requestedTime - now) / (1000 * 60 * 60));

                    console.log(`⏰ Time calculation: requested=${requestedTime.toISOString()}, now=${now.toISOString()}, diff=${hoursFromNow} hours`);

                    // Get weather for that specific time (up to 48 hours forecast)
                    if (hoursFromNow <= 48) {
                        console.log(`🌤️ Getting weather for ${hoursFromNow} hours from now`);
                        const enhancedData = await getComprehensiveWeatherAnalysis(currentLocation, {
                            includeHistorical: false,
                            includeWeekly: false,
                            customTimeOffset: null, // Get current + forecast data
                            forecastHours: Math.max(24, hoursFromNow + 2) // Get enough forecast hours
                        });

                        if (enhancedData) {
                            // Extract weather data for the specific time
                            const futureData = enhancedData.temporal?.nextPeriod || [];

                            if (futureData.length > 0) {
                                // Find the closest future data point to the requested time
                                const requestedTimestamp = requestedTime.getTime();
                                let bestIndex = 0;
                                let bestTimeDiff = Infinity;

                                for (let i = 0; i < futureData.length; i++) {
                                    const dataTimestamp = futureData[i].timestamp;
                                    const timeDiff = Math.abs(requestedTimestamp - dataTimestamp);

                                    if (timeDiff < bestTimeDiff) {
                                        bestTimeDiff = timeDiff;
                                        bestIndex = i;
                                    }
                                }

                                const selectedData = futureData[bestIndex];
                                const dataTime = new Date(selectedData.timestamp);
                                const timeDiffHours = Math.round(bestTimeDiff / (1000 * 60 * 60) * 10) / 10;

                                console.log(`🎯 Requested: ${requestedTime.toISOString()}`);
                                console.log(`✅ Using forecast data: ${dataTime.toISOString()} (diff: ${timeDiffHours} hours, index: ${bestIndex})`);

                                // Set weather data to the selected forecast data point
                                weatherData = {
                                    ...selectedData,
                                    dataSource: `Forecast (${timeDiffHours} hours ahead)`,
                                    location: enhancedData.location
                                };
                                enhancedWeatherData = enhancedData;
                            } else {
                                console.log(`⚠️ No data available, using current weather`);
                                // Fallback to current weather
                                if (enhancedData.current) {
                                weatherData = {
                                        ...enhancedData.current,
                                        dataSource: 'Current weather (forecast unavailable)',
                                    location: enhancedData.location
                                };
                                enhancedWeatherData = enhancedData;
                                } else {
                                    console.error(`❌ No weather data available`);
                                    return;
                                }
                            }
                        }
                    } else {
                        // Future date beyond 48 hours
                        if (hoursFromNow > 360) {
                            // More than 15 days in future (360 hours) - use historical data from 1 year ago
                            const historicalDate = new Date(requestedTime);
                            historicalDate.setFullYear(historicalDate.getFullYear() - 1);
                            
                            const daysInFuture = Math.floor(hoursFromNow / 24);
                            console.log(`🔄 Date >15 days in future (${hoursFromNow} hours / ${daysInFuture} days), using historical data from 1 year ago: ${historicalDate.toISOString()}`);
                            
                            // Calculate date range for historical request
                            const hoursToFetch = 24; // Get 24 hours of historical data
                            const startDate = new Date(historicalDate);
                            startDate.setHours(startDate.getHours() - hoursToFetch);
                            const endDate = historicalDate.toISOString().split('T')[0];
                            const startDateStr = startDate.toISOString().split('T')[0];
                            
                            console.log(`📅 Historical request: ${startDateStr} to ${endDate}`);
                            
                            const histData = await getWeatherFromBestProvider(currentLocation, {
                                startDate: startDateStr,
                                endDate: endDate
                            });
                            
                            if (histData?.daily && histData.daily.length > 0) {
                                // Use the most recent day's data with real API values
                                const dailyData = histData.daily[histData.daily.length - 1];
                                
                                // Check if we have sufficient real data (not null/undefined)
                                const hasRequiredData = dailyData.temperature?.avg !== undefined && dailyData.humidity?.avg !== undefined && dailyData.windSpeed?.avg !== undefined && dailyData.pressure?.avg !== undefined;
                                
                                if (hasRequiredData) {
                                    // Calculate enhanced weather metrics
                                    const historicalTemp = Math.round(dailyData.temperature.avg);
                                    const historicalHumidity = Math.round(dailyData.humidity.avg);
                                    const historicalWindSpeed = Math.round(dailyData.windSpeed.avg);
                                    const heatIndex = calculateHeatIndex(historicalTemp, historicalHumidity);
                                    const windChill = calculateWindChill(historicalTemp, historicalWindSpeed);
                                    
                                    // Analyze precipitation type (consistent with current weather)
                                    const precipitationAnalysis = analyzePrecipitationType(
                                        dailyData.precipitation.rain || 0,
                                        dailyData.precipitation.showers || 0,
                                        dailyData.precipitation.snow || 0,
                                        historicalTemp,
                                        dailyData.dominantWeatherCode
                                    );
                                    
                                    // Get UV warnings (consistent with current weather)
                                    const uvWarnings = getUVWarnings(dailyData.uvIndex || 0);
                                    
                                    weatherData = {
                                        temperature: historicalTemp,
                                        condition: dailyData.dominantCondition || 'clear sky',
                                        humidity: historicalHumidity,
                                        dewPoint: Math.round(dailyData.dewPoint.avg),
                                        feelsLike: Math.round(dailyData.apparentTemperature?.avg || dailyData.temperature.avg),
                                        precipitation: dailyData.precipitation.total,
                                        precipitationRate: dailyData.precipitation.total > 0 ? dailyData.precipitation.total / hoursToFetch : 0,
                                        rain: dailyData.precipitation.rain,
                                        showers: dailyData.precipitation.showers,
                                        snowfall: dailyData.precipitation.snow,
                                        precipitationType: precipitationAnalysis,
                                        pressure: Math.round(dailyData.pressure.avg) || 1013, // Use calculated pressure or standard atmospheric pressure
                                        surfacePressure: Math.round(dailyData.surfacePressure?.avg || dailyData.pressure.avg) || 1013,
                                        cloudCoverage: Math.round(dailyData.cloudCover.avg),
                                        windSpeed: historicalWindSpeed,
                                        windDirection: dailyData.windDirection?.avg,
                                        windGust: dailyData.windGust?.max,
                                        visibility: dailyData.visibility?.avg,
                                        uvIndex: dailyData.uvIndex || 0, // Default to 0 if not available
                                        solarRadiation: (dailyData.uvIndex || 0) ? Math.round((dailyData.uvIndex || 0) * 100) : 0,
                                        rawConditionId: dailyData.dominantWeatherCode,
                                        icon: mapOpenMeteoIcon(dailyData.dominantWeatherCode, true),
                                        dataSource: `Historical Weather Data (1 year ago, requested future date: ${requestedTime.toISOString().split('T')[0]})`,
                                        weatherQuality: {
                                            comfortLevel: getComfortLevel(historicalTemp, historicalHumidity, historicalWindSpeed),
                                            heatIndex: heatIndex,
                                            windChill: windChill,
                                            uvWarnings: uvWarnings
                                        },
                                        timestamp: requestedTime.getTime(),
                                        location: histData.location
                                    };
                                    
                                    // Update baseTime to reflect the historical year since we're using data from 1 year ago
                                    if (baseTime) {
                                        baseTime.year = historicalDate.getFullYear();
                                        console.log(`📅 Updated baseTime.year to ${baseTime.year} to match historical weather data`);
                                    }
                                } else {
                                    // Missing required real data - fail gracefully
                                    console.log(`⚠️ Historical weather API missing required fields (pressure/dewpoint/cloud) - failing gracefully`);
                                    weatherData = null;
                                }
                            } else {
                                // Historical data not available - fail gracefully
                                console.log(`⚠️ Historical weather data not available for 1 year ago - failing gracefully`);
                                weatherData = null;
                            }
                        } else {
                            // Between 48 hours and 15 days - use weekly forecast
                            console.log(`🔮 Getting forecast weather for future date (${hoursFromNow} hours from now)`);
                            const enhancedData = await getComprehensiveWeatherAnalysis(currentLocation, {
                                includeHistorical: false,
                                includeWeekly: true
                            });

                            // Try to get weather data for the requested time period
                            if (enhancedData?.weekly && enhancedData.weekly.length > 0) {
                                // Find the closest day in the weekly forecast
                                const targetDayIndex = Math.min(Math.floor(hoursFromNow / 24), enhancedData.weekly.length - 1);
                                const dailyData = enhancedData.weekly[targetDayIndex];
                                const avgTemp = (dailyData.temperature.min + dailyData.temperature.max) / 2;

                                // Calculate enhanced weather metrics
                                const weeklyHeatIndex = calculateHeatIndex(Math.round(avgTemp), dailyData.humidity);
                                const weeklyWindChill = calculateWindChill(Math.round(avgTemp), dailyData.wind.maxSpeed);

                                // Analyze precipitation type (consistent with current weather)
                                const weeklyPrecipitationAnalysis = analyzePrecipitationType(
                                    dailyData.precipitation.rain || 0,
                                    dailyData.precipitation.showers || 0,
                                    dailyData.precipitation.snowfall || 0,
                                    Math.round(avgTemp),
                                    dailyData.rawConditionId
                                );

                                // Get UV warnings (consistent with current weather)
                                const weeklyUvWarnings = getUVWarnings(dailyData.uvIndex);

                                weatherData = {
                                    temperature: Math.round(avgTemp),
                                    condition: dailyData.condition || 'clear sky',
                                    humidity: dailyData.humidity,
                                    dewPoint: dailyData.dewPoint,
                                    feelsLike: Math.round(dailyData.feelsLike?.avg || dailyData.temperature.avg),
                                    precipitation: dailyData.precipitation.total || 0,
                                    precipitationRate: dailyData.precipitation.total > 0 ? dailyData.precipitation.total / 24 : 0,
                                    rain: dailyData.precipitation.rain,
                                    showers: dailyData.precipitation.showers,
                                    snowfall: dailyData.precipitation.snowfall,
                                    precipitationType: weeklyPrecipitationAnalysis,
                                    pressure: dailyData.pressure,
                                    surfacePressure: dailyData.surfacePressure || dailyData.pressure,
                                    cloudCoverage: dailyData.cloudCoverage,
                                    windSpeed: dailyData.wind.maxSpeed,
                                    windGust: dailyData.wind.maxGust,
                                    windDirection: dailyData.wind.dominantDirection,
                                    visibility: dailyData.visibility,
                                    uvIndex: dailyData.uvIndex,
                                    solarRadiation: dailyData.uvIndex ? Math.round(dailyData.uvIndex * 100) : 0,
                                    rawConditionId: dailyData.rawConditionId,
                                    icon: mapOpenMeteoIcon(dailyData.rawConditionId, true),
                                    weatherQuality: {
                                        comfortLevel: getComfortLevel(
                                            Math.round(avgTemp),
                                            dailyData.humidity,
                                            dailyData.wind.maxSpeed
                                        ),
                                        heatIndex: weeklyHeatIndex,
                                        windChill: weeklyWindChill,
                                        uvWarnings: weeklyUvWarnings
                                    },
                                    timestamp: requestedTime.getTime(),
                                    dataSource: 'Weekly Forecast Data',
                                    forecastDate: requestedTime.toISOString(),
                                    dataCollectedAt: Date.now(),
                                    forecastHorizon: `${Math.floor(hoursFromNow / 24)} days ${hoursFromNow % 24} hours ahead`,
                                    location: enhancedData.location
                                };
                            } else {
                                // Fallback to current weather
                                const currentWeather = enhancedData?.current || enhancedData?.temporal?.current;
                                weatherData = currentWeather ? {
                                    ...currentWeather,
                                    location: enhancedData.location
                                } : null;
                                enhancedWeatherData = enhancedData;
                            }
                        }
                    }
                }
            } else {
                // No time override, get current weather
                const enhancedData = await getComprehensiveWeatherAnalysis(currentLocation, {
                    includeHistorical: false,
                    includeWeekly: false,
                    forecastHours: 2, // Get 2 hours of future data (minutely data will provide more granularity)
                    pastHours: 4 // Get past 4 hours for richer historical context
                });
                const currentWeather = enhancedData?.current || enhancedData?.temporal?.current;
                weatherData = currentWeather ? {
                    ...currentWeather,
                    location: enhancedData.location
                } : null;
                enhancedWeatherData = enhancedData;
                
                // Fetch yesterday's weather summary for broader pattern context
                if (enhancedData && weatherData) {
                    try {
                        const yesterday = new Date();
                        yesterday.setDate(yesterday.getDate() - 1);
                        const yesterdayStr = yesterday.toISOString().split('T')[0];
                        
                        console.log(`📅 Fetching yesterday's weather summary (${yesterdayStr}) for context...`);
                        const yesterdayData = await getWeatherFromBestProvider(currentLocation, {
                            startDate: yesterdayStr,
                            endDate: yesterdayStr
                        });

                        if (yesterdayData?.daily && yesterdayData.daily.length > 0) {
                            enhancedWeatherData.yesterday = yesterdayData.daily[0];
                            console.log(`✅ Yesterday's weather: ${yesterdayData.daily[0].dominantCondition}, ${Math.round(yesterdayData.daily[0].temperature.avg)}°C avg`);
                        }
                    } catch (error) {
                        console.log(`⚠️ Could not fetch yesterday's weather: ${error.message}`);
                        // Continue without yesterday's data - not critical
                    }
                }
            }
        }
    }

    if (weatherData && typeof weather === 'object') {
        weatherData = { ...weatherData, ...weather };
    }


    // Recalculate baseTime using weather timezone if available for accurate time period calculations
    if (baseTime && weatherData?.location?.timezone) {
        // Recreate baseTime using the correct local timezone but preserve the date (holiday or mapped)
        const timezone = weatherData.location.timezone;
        console.log(`🌍 Recalculating time using local timezone: ${timezone}`);

        if (isSpecificTimeOverride) {
            // For specific time overrides, recreate with timezone but keep current date
            baseTime = getCurrentTime(timezone, baseTime.hour, baseTime.minute, new Date(baseTime.year, baseTime.month, baseTime.dayOfMonth));
        } else {
            // For current time, get current time in local timezone but keep current date
            baseTime = getCurrentTime(timezone, null, null, new Date(baseTime.year, baseTime.month, baseTime.dayOfMonth));
        }

        logger.detailed(`⏰ Local time: ${baseTime.hour}:${String(baseTime.minute).padStart(2, '0')} (${timezone}) | ${baseTime.month + 1}/${baseTime.dayOfMonth}`);
    }

    // Determine time period (only if time is available)
    const timePeriod = baseTime ? await determineTimePeriod(baseTime, currentSeason, currentLocation, weatherData) : null;

    // Generate seasonal guidelines if seasonal is enabled (must be after weather is fetched)
    let seasonalData = null;
    if (seasonalConfig.enabled) {
        // Determine season for guidelines
        let seasonForGuidelines = currentSeason;
        
        if (seasonalConfig.type === 'season') {
            seasonForGuidelines = seasonalConfig.value;
        }
        // Holidays come from date detection only - no forcedHoliday parameter
        
        // Only pass weather if it exists (weather is enabled)
        const weatherForGuidelines = weatherData || null;
        
        seasonalData = generateSeasonalGuidelines(
            baseTime || timeForSeasonal,
            seasonForGuidelines,
            seasonalConfig.enabled,
            null, // No forcedHoliday - holidays come from date detection only
            weatherForGuidelines,
            disable_holiday
        );
        
        // Update currentSeason from seasonalData if holiday was detected
        if (seasonalData.season) {
            currentSeason = seasonalData.season;
        }
    }

    // Build context - only include data that is enabled
    const context = {};

    // Add location metadata if available
    if (currentLocation && currentLocation.lat !== undefined && currentLocation.lon !== undefined) {
        context.location = {
            latitude: currentLocation.lat,
            longitude: currentLocation.lon,
            timezone: currentLocation.timezone,
            source: currentLocation.source || 'unknown' // Include source to distinguish static vs auto-detected
        };

        // Try to get city/country info via reverse geocoding
        try {
            const reverseResult = await geo2city.reverse([currentLocation.lat, currentLocation.lon]);
            if (reverseResult) {
                context.location.city = reverseResult.city;
                context.location.country = reverseResult.country;
                context.location.state = reverseResult.city ? '' : ''; // State info might not be available
            }
        } catch (error) {
            console.warn('Failed to get location metadata:', error.message);
        }
    }

    if (baseTime) context.time = baseTime;
    if (weatherData && typeof weatherData === 'object') {
        const requiredFields = ['temperature', 'condition', 'windSpeed', 'humidity'];
        const hasRequiredFields = requiredFields.every(field =>
            weatherData[field] !== undefined && weatherData[field] !== null
        );

        if (hasRequiredFields) {
            context.weather = weatherData;
            console.log('✅ Weather data validation passed');
        } else {
            console.warn('⚠️ Weather data missing required fields, excluding from context');
            const missingFields = requiredFields.filter(field =>
                weatherData[field] === undefined || weatherData[field] === null
            );
            console.warn('Missing fields:', missingFields);
        }
    }
    if (currentSeason) context.season = seasonalData;
    if (seasonalConfig.enabled) context.seasonalConfig = seasonalConfig;
    if (timePeriod) context.timePeriod = timePeriod;
    if (clothing) context.clothing = clothing;
    if (optimize) context.optimize = optimize;
    if (creative) context.creative = creative;
    if (disable_holiday !== undefined) context.disable_holiday = disable_holiday;
    if (enhancedWeatherData) context.enhancedWeatherData = enhancedWeatherData; // Add enhanced weather data with hourly history

    // Compile weather history report if weather data is available
    if (weatherData && enhancedWeatherData) {
        const weatherHistoryReport = compileWeatherHistoryReport(enhancedWeatherData, weatherData, baseTime, currentLocation);
        if (weatherHistoryReport) {
            context.weatherHistoryReport = weatherHistoryReport;
            console.log(`📊 Compiled weather history report: ${weatherHistoryReport.timelineEntries.length} entries, trend analysis: ${!!weatherHistoryReport.trendAnalysis}`);
        }
    }

    // Generate clothing context if clothing is enabled
    if (clothing) {
        try {
            context.clothingContext = generateDynamicClothingContext(context);
            console.log('👔 Generated clothing context with', context.clothingContext.options?.length || 0, 'options');
        } catch (error) {
            console.warn('⚠️ Failed to generate clothing context:', error.message);
        }
    }

    return context;
}

// ============================================================================
// Dynamic Task List Generation System
// ============================================================================

/**
 * Evaluates a condition function
 * @param {Function|undefined} condition - Condition function
 * @param {Object} context - Context to pass to condition
 * @returns {boolean} True if condition passes
 */
function evaluateCondition(condition, context) {
    if (!condition) return true;
    if (typeof condition !== 'function') return true;
    
    try {
        return condition(context);
    } catch (error) {
        console.error('Error evaluating task condition:', error);
        return false;
    }
}

/**
 * Compiles substeps with bullet points
 * @param {Array} substeps - Substeps array
 * @param {Object} context - Context for evaluating conditions
 * @param {string} indent - Indentation string
 * @returns {Array} Array of markdown strings
 */
// Counter system for dynamic numbering
function createCounterManager() {
    const counters = new Map();

    const getCounterValue = (type, name = 'default', startValue = null) => {
        const key = `${type}:${name}`;
        if (!counters.has(key)) {
            // Initialize counter based on type and start value
            let initialValue;
            if (startValue !== null) {
                initialValue = startValue;
            } else {
                // Default starting values
                switch (type) {
                    case 'number':
                    case 'num':
                        initialValue = 1;
                        break;
                    case 'letter':
                    case 'let':
                    case 'lower-letter':
                    case 'lower-let':
                        initialValue = 'a';
                        break;
                    case 'upper-letter':
                    case 'upper-let':
                        initialValue = 'A';
                        break;
                    case 'roman':
                        initialValue = 'i';
                        break;
                    case 'upper-roman':
                        initialValue = 'I';
                        break;
                    default:
                        initialValue = 1;
                }
            }
            counters.set(key, initialValue);
        }
        return counters.get(key);
    };

    const incrementCounter = (type, name = 'default') => {
        const key = `${type}:${name}`;
        const currentValue = getCounterValue(type, name);

        let nextValue;
        switch (type) {
            case 'number':
            case 'num':
                nextValue = currentValue + 1;
                break;
            case 'letter':
            case 'let':
            case 'lower-letter':
            case 'lower-let':
                nextValue = String.fromCharCode(currentValue.charCodeAt(0) + 1);
                break;
            case 'upper-letter':
            case 'upper-let':
                nextValue = String.fromCharCode(currentValue.charCodeAt(0) + 1);
                break;
            case 'roman':
                nextValue = getNextRomanNumeral(currentValue.toLowerCase());
                break;
            case 'upper-roman':
                nextValue = getNextRomanNumeral(currentValue.toLowerCase()).toUpperCase();
                break;
            default:
                nextValue = currentValue + 1;
        }

        counters.set(key, nextValue);
        return currentValue;
    };

    const formatCounterValue = (value, type) => {
        switch (type) {
            case 'number':
            case 'num':
                return value.toString();
            case 'letter':
            case 'let':
            case 'lower-letter':
            case 'lower-let':
                return value.toLowerCase();
            case 'upper-letter':
            case 'upper-let':
                return value.toUpperCase();
            case 'roman':
                return value.toLowerCase();
            case 'upper-roman':
                return value.toUpperCase();
            default:
                return value.toString();
        }
    };

    return {
        getCounterValue,
        incrementCounter,
        formatCounterValue,
        resetCounter: (type, name = 'default') => {
            const key = `${type}:${name}`;
            counters.delete(key);
        },
        resetAllCounters: (type) => {
            // Reset all counters of a specific type
            for (const key of counters.keys()) {
                if (key.startsWith(`${type}:`)) {
                    counters.delete(key);
                }
            }
        },
        processText: (text) => {
            if (typeof text !== 'string') return text;

            return text.replace(/\{counter:([^:}]+)(?::([^:}]+))?(?::([^}]+))?\}/g, (match, type, name = 'default', start) => {
                let startValue = null;
                if (start) {
                    // Parse start value based on type
                    switch (type) {
                        case 'number':
                        case 'num':
                            startValue = parseInt(start);
                            break;
                        case 'letter':
                        case 'let':
                        case 'lower-letter':
                        case 'lower-let':
                        case 'upper-letter':
                        case 'upper-let':
                            startValue = start;
                            break;
                        case 'roman':
                        case 'upper-roman':
                            startValue = start.toLowerCase();
                            break;
                    }
                }

                const currentValue = getCounterValue(type, name, startValue);
                const formattedValue = formatCounterValue(currentValue, type);

                // Only increment if this is not a start value specification
                if (!start) {
                    incrementCounter(type, name);
                }

                return formattedValue;
            });
        }
    };
}

// Helper function to get next Roman numeral
function getNextRomanNumeral(current) {
    const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
                          'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
    const index = romanNumerals.indexOf(current.toLowerCase());
    if (index === -1 || index === romanNumerals.length - 1) {
        return romanNumerals[0]; // Reset or default to i
    }
    return romanNumerals[index + 1];
}

function compileSubsteps(substeps, context, indent = '    ', counterManager) {
    const output = [];

    for (const substep of substeps) {
        // Handle simple string substeps
        if (typeof substep === 'string') {
            output.push(`${indent}• ${counterManager.processText(substep)}`);
            continue;
        }

        // Check if substep should be included
        if (!evaluateCondition(substep.condition, context)) continue;

        output.push(`${indent}• ${counterManager.processText(substep.text)}`);
    }

    return output;
}

/**
 * Compiles steps with automatic lettering (a, b, c, etc.)
 * @param {Array} steps - Steps array
 * @param {Object} context - Context for evaluating conditions
 * @returns {Array} Array of markdown strings
 */
function compileSteps(steps, context, counterManager) {
    const output = [];

    for (const step of steps) {
        // Handle simple string steps
        if (typeof step === 'string') {
            output.push(`  • ${counterManager.processText(step)}`);
            continue;
        }

        // Check if step should be included
        if (!evaluateCondition(step.condition, context)) continue;

        // Handle steps with titles
        if (step.title) {
            const stepText = `  {counter:letter}. ${step.title}`;
            output.push(counterManager.processText(stepText));
        }

        // Handle variants (mutually exclusive options - first match wins)
        if (step.variants) {
            const selectedVariant = step.variants.find(v => evaluateCondition(v.condition, context));
            if (selectedVariant && selectedVariant.substeps) {
                output.push(...compileSubsteps(selectedVariant.substeps, context, '      ', counterManager));
            }
        }
        // Handle regular substeps
        else if (step.substeps) {
            output.push(...compileSubsteps(step.substeps, context, '      ', counterManager));
        }

        // Add blank line after each step
        if (step.title) {
            output.push('');
        }
    }

    return output;
}

/**
 * Compiles task list into formatted markdown with dynamic numbering
 * @param {Array} taskDefinition - Task definition array
 * @param {Object} context - Context for evaluating conditions
 * @returns {Array} Array of markdown strings
 */
function compileTaskList(taskDefinition, context) {
    const output = [];
    
    output.push(
        '## 📋 TASK CHECKLIST - YOUR WORKFLOW',
        '',
        '**This checklist provides your step-by-step workflow. For detailed reference information, see the system message sections:**',
        '• **Pipeline Stage Awareness** - See "PIPELINE STAGE AWARENESS" section in system message',
        '• **State Management Modes** - See "STATE MANAGEMENT MODES" section in system message (Chain Update, Adaptation, Background Focus)',
        '• **Analysis Process** - See "ANALYSIS & MODIFICATION PROCESS" section in system message for detailed steps',
        '• **Text Replacement Rules** - See "TEXT REPLACEMENT SYSTEM - COMPLETE REFERENCE" section',
        '• **Tool Usage** - See "AVAILABLE TOOLS - COMPLETE REFERENCE" section',
        '',
        '---',
        ''
    );
    
    const counterManager = createCounterManager();

    output.push('## 🎯 YOUR MISSION FOR THIS REQUEST');
    output.push('');

    for (const task of taskDefinition) {
        // Check if task should be included
        if (!evaluateCondition(task.condition, context)) continue;

        // Use counter system for step numbering - special handling for Step 0
        let stepHeader;
        if (task.id === 'check_knowledge_memory') {
            stepHeader = `**STEP 0: ${counterManager.processText(task.title)} ${task.icon}**`;
        } else {
            stepHeader = `**STEP {counter:number}: ${counterManager.processText(task.title)} ${task.icon}**`;
        }

        // Process the step header through counter system
        output.push(counterManager.processText(stepHeader));
        output.push('');

        // Reset letter counter for each task to start from 'a'
        counterManager.resetCounter('letter');

        // Handle task-level variants (for stage-specific content)
        if (task.variants) {
            const selectedVariant = task.variants.find(v => evaluateCondition(v.condition, context));
            if (selectedVariant) {
                if (selectedVariant.description) {
                    const desc = typeof selectedVariant.description === 'function' ?
                                 selectedVariant.description(context) : selectedVariant.description;
                    output.push(counterManager.processText(desc));
                    output.push('');
                }
                if (selectedVariant.steps) {
                    const compiledSteps = compileSteps(selectedVariant.steps, context, counterManager);
                    output.push(...compiledSteps);
                }
            }
        }
        // Handle regular task description and steps
        else {
            if (task.description) {
                const desc = typeof task.description === 'function' ?
                             task.description(context) : task.description;
                output.push(counterManager.processText(desc));
                output.push('');
            }

            if (task.steps) {
                const compiledSteps = compileSteps(task.steps, context, counterManager);
                output.push(...compiledSteps);
            }
        }

        output.push('');
    }

    return output;
}

/**
 * Generates dynamic task list based on context
 * @param {Object} context - Context containing all conditional flags
 * @returns {Array} Compiled task list as markdown strings
 */
function generateDynamicTaskList(context) {
    const {
        weather,
        time,
        directive,
        creative,
        optimize,
        stageContext,
        lastGeneratedImage,
        seasonalConfig,
        useIncrementalUpdate,
        adapttionMode,
        directorRules,
        backgroundFocus,
        changeInfo,
        lockedReplacements
    } = context;

    // Check tool configuration
    const useCollectionSearch = secureConfig.grok?.tagWikiCollectionId;
    const useWebSearch = secureConfig.grok?.useWebSearch === true;
    
    // Determine tool names based on configuration
    const tagResearchTool = useCollectionSearch ? 'file_search' : 'searchTagsBatch';
    const webResearchTools = useWebSearch ? 'web_search/x_search' : 'webSearch/fetchUrl/fetchImage';

    // Task definition structure
    const taskDefinition = [
        {
            id: 'check_knowledge_memory',
            title: 'CHECK KNOWLEDGE MEMORIES FIRST',
            icon: '🧠',
            condition: () => true,
            description: 'Review available global knowledge memories to avoid redundant research',
            steps: [
                'Review "Available Global Memories" list in user message',
                'Search for relevant memories using searchKnowledgeMemories if needed (returns full details automatically)',
                'OR retrieve specific memories using retrieveKnowledgeMemory(["name1", "name2"]) if you know exact names',
                'Use retrieved entities, relations, and observations in your modifications',
                'REFINE memories: If you discover better information, update with same name + higher confidence',
                'Save NEW discoveries in insight_memory response field (auto-saved when validation passes)'
            ]
        },
        {
            id: 'stage_context',
            title: 'UNDERSTAND YOUR STAGE',
            icon: '🎬',
            condition: () => stageContext && (stageContext.isInitial || stageContext.isBackgroundFocus || stageContext.isEnhance),
            variants: [
                {
                    condition: () => stageContext && stageContext.isInitial,
                    description: '**PIPELINE STAGE: INITIAL GENERATION (PRIMARY FOCUS)** - You are working on the INITIAL stage of a multi-stage pipeline. This prompt is specifically about the PRIMARY FOCUS/SUBJECT.',
                    steps: [
                        {
                            id: 'initial_analysis',
                            title: 'Analysis Requirements',
                            condition: () => true,
                            substeps: [
                                'Analyze input prompt: view angle, perspective, framing, composition',
                                'Determine subject positioning and available space',
                                'Consider how subject fits within frame'
                            ]
                        },
                        {
                            id: 'initial_approach',
                            title: 'Modification Approach',
                            condition: () => true,
                            substeps: [
                                'Make text replacements knowing later stages will fill in background details',
                                'Keep focus on subject - background will be expanded in subsequent stages',
                                'Ensure subject well-defined and positioned appropriately for future expansion',
                                'Don\'t over-detail the background - save that for background expansion stage',
                                {
                                    text: 'Preview Image Reference: Use as visual reference for character appearance/attire, environment context, actions/pose, scene composition',
                                    condition: () => stageContext && stageContext.hasPreview
                                },
                                {
                                    text: 'ANALYZE TIME & WEATHER FROM PREVIEW: Amplify detected conditions (nighttime → darkness/shadows, daytime → time-of-day atmosphere, weather → match preview effects)',
                                    condition: () => stageContext && stageContext.hasPreview
                                },
                                {
                                    text: 'PRESERVE: Character appearance, clothing style, core pose, environment type',
                                    condition: () => stageContext && stageContext.hasPreview
                                },
                                {
                                    text: 'ADAPT: Weather effects on clothing, lighting, seasonal/time-of-day elements',
                                    condition: () => stageContext && stageContext.hasPreview
                                }
                            ]
                        }
                    ]
                },
                {
                    condition: () => stageContext && stageContext.isBackgroundFocus,
                    description: '**PIPELINE STAGE: BACKGROUND EXPANSION** - You are working on BACKGROUND EXPANSION with image from previous generation with padding applied.',
                    steps: [
                        {
                            id: 'background_analysis',
                            title: 'Analysis Requirements',
                            condition: () => true,
                            substeps: [
                                'Identify foreground area and new canvas space',
                                'Determine expandable background elements',
                                'Note environmental storytelling opportunities'
                            ]
                        },
                        {
                            id: 'background_rules',
                            title: 'Content Rules',
                            condition: () => true,
                            substeps: [
                                'REMOVE: Character expressions/emotions, character-specific actions, facial details, interaction descriptions, body-part details, character-centric descriptors, focus indicators',
                                'KEEP: Location/setting, architectural elements, landscape features, weather/atmospheric effects, lighting/time-of-day, environmental objects, depth indicators',
                                'ADD: Scene depth/distance elements, environmental storytelling, atmospheric effects (fog/clouds), background architecture/landscapes, perspective cues'
                            ]
                        },
                        {
                            id: 'background_approach',
                            title: 'Modification Approach',
                            condition: () => true,
                            substeps: [
                                'Remove character-specific phrases',
                                'Add rich environmental descriptions',
                                'Maintain consistency with existing composition',
                                'Focus on atmosphere and depth'
                            ]
                        }
                    ]
                },
                {
                    condition: () => stageContext && stageContext.isEnhance,
                    description: '**PIPELINE STAGE: ENHANCEMENT** - You are working on ENHANCEMENT stage with the full composed image.',
                    steps: [
                        {
                            id: 'enhance_requirements',
                            title: 'Analysis Requirements',
                            condition: () => true,
                            substeps: [
                                'Analyze entire image for missing/incorrect details',
                                'Address inconsistencies/quality issues',
                                'Refine details across composition',
                                'Polish final result'
                            ]
                        },
                        {
                            id: 'enhance_approach',
                            title: 'Modification Approach',
                            condition: () => true,
                            substeps: [
                                'Make refinements improving composition',
                                'Fix issues/artifacts',
                                'Enhance needed details',
                                'Ensure cohesive integration'
                            ]
                        }
                    ]
                }
            ]
        },
        {
            id: 'background_focus_mode',
            title: 'BACKGROUND FOCUS MODE',
            icon: '🌄',
            condition: () => backgroundFocus && !stageContext,
            description: '🌄 **BACKGROUND FOCUS MODE**: For this request, emphasize background, environment, and atmospheric elements while maintaining character presence. Think like a landscape photographer - the environment is the star, characters are part of the scene.',
            steps: []
        },
        {
            id: 'chain_update_mode',
            title: 'CHAIN UPDATE MODE',
            icon: '🔄',
            condition: () => useIncrementalUpdate,
            description: '🔄 **CHAIN UPDATE MODE**: You are continuing from previous message. The current `text_replacements` are in the previous message in this conversation history.',
            steps: [
                {
                    id: 'what_changed',
                    title: 'Review What Changed',
                    condition: () => true,
                    substeps: [
                        {
                            text: 'Prompts have changed - review the new prompts',
                            condition: (ctx) => ctx.changeInfo && ctx.changeInfo.promptChanged
                        },
                        {
                            text: 'Context has changed (weather/time/season) - adapt replacements',
                            condition: (ctx) => ctx.changeInfo && ctx.changeInfo.contextChanged
                        },
                        {
                            text: 'Directive has changed - incorporate new requirements',
                            condition: (ctx) => ctx.changeInfo && ctx.changeInfo.directiveChanged
                        }
                    ]
                },
                {
                    id: 'choose_strategy',
                    title: 'Choose Strategy',
                    condition: () => true,
                    substeps: [
                        'Option {counter:number:options}: Update Existing (most efficient if no prompt changes)',
                        '  - Review previous text_replacements from conversation history',
                        '  - Update only what needs to change',
                        '  - Keep tag research and replacements that still apply',
                        '  - Use validateTextReplacement (terminateOnPass: true when ready)',
                        {
                            text: 'Option {counter:number:options}: Regenerate with Tools (if prompts changed)',
                            condition: (ctx) => !ctx.fast_mode
                        },
                        {
                            text: `  - USE TOOLS: Research new tags with ${tagResearchTool}`,
                            condition: (ctx) => !ctx.fast_mode
                        },
                        {
                            text: '  - Reuse previous research where applicable',
                            condition: (ctx) => !ctx.fast_mode
                        },
                        {
                            text: '  - Create new text_replacements for current prompt state',
                            condition: (ctx) => !ctx.fast_mode
                        },
                        {
                            text: '  - Validate and use completeTooling',
                            condition: (ctx) => !ctx.fast_mode
                        },
                        {
                            text: 'Option {counter:number:options}: Regenerate with Memories (if prompts changed)',
                            condition: (ctx) => ctx.fast_mode === true
                        },
                        {
                            text: '  - USE MEMORIES: Retrieve relevant knowledge memories',
                            condition: (ctx) => ctx.fast_mode === true
                        },
                        {
                            text: '  - Use memory knowledge to create new text_replacements',
                            condition: (ctx) => ctx.fast_mode === true
                        },
                        {
                            text: '  - Validate and use completeTooling',
                            condition: (ctx) => ctx.fast_mode === true
                        },
                        'Option {counter:number:options}: Reject Chain (ONLY if major concept change)',
                        '  - Call rejectChain() if changes fundamentally alter concept',
                        '  - Examples: >60% removed, subject changed, incompatible structure'
                    ]
                }
            ]
        },
        {
            id: 'locked_replacements',
            title: 'LOCKED REPLACEMENTS',
            icon: '🔒',
            condition: (ctx) => ctx.lockedReplacements && ctx.lockedReplacements.length > 0,
            description: (ctx) => [
                `🔒 **LOCKED REPLACEMENTS**: User locked ${ctx.lockedReplacements.length} replacement(s) that must be maintained across generations with intelligent adaptation.`,
                '',
                '**Locked Replacements List:**',
                ...ctx.lockedReplacements.map((lr, idx) => {
                    const targetLabel = lr.targetType === 'prompt' ? 'Prompt' : 
                                      lr.targetType === 'uc' ? 'Negative' :
                                      `Character ${lr.targetSource + 1} ${lr.targetField}`;
                    return `${idx + 1}. [${targetLabel}] "${lr.reason_display}": \`${lr.select_text || '(append to end)'}\` → \`${lr.replace_text}\``;
                })
            ].join('\n'),
            steps: [
                {
                    id: 'maintain_concept',
                    title: 'Maintain Replacement Concepts',
                    condition: () => true,
                    substeps: [
                        'Keep the INTENT and PURPOSE of each locked replacement',
                        'If locked replacement adds weather, continue weather enhancements',
                        'If locked replacement enhances lighting, continue lighting enhancements',
                        'If locked replacement modifies atmosphere, maintain atmospheric modifications'
                    ]
                },
                {
                    id: 'adapt_to_context',
                    title: 'Adapt to Current Context',
                    condition: () => true,
                    substeps: [
                        'Update select_text to match what\'s in current prompt',
                        'Update replace_text to fit new weather/time/season/context',
                        'Weather changed → Adapt weather-related replacements',
                        'Time changed → Adapt time-related replacements',
                        'Season changed → Adapt seasonal references',
                        'Ensure replacement still makes logical sense'
                    ]
                },
                {
                    id: 'return_locked',
                    title: 'Return as Locked',
                    condition: () => true,
                    substeps: [
                        'Mark ALL maintained replacements with "locked": true',
                        'Include clear reason explaining any adaptations made',
                        'If omitting a locked replacement, explain why in reasoning'
                    ]
                }
            ]
        },
        {
            id: 'adaptation_mode',
            title: 'ADAPTATION MODE',
            icon: '🔄',
            condition: () => adapttionMode,
            description: 'You are adapting a previously compiled prompt that failed to apply. Use the provided compiled prompt data as a reference and adapt it to work with the current context while preserving the original intent and quality. Intelligently modify the prompts to create a cohesive, immersive scene that harmonizes weather, time, season, and character attire.',
            steps: []
        },
        {
            id: 'analyze_inputs',
            title: 'ANALYZE INPUTS',
            icon: '🔍',
            condition: () => true,
            steps: [
                {
                    id: 'analyze_prompts',
                    title: 'Analyze Initial Prompts and Provided Images',
                    condition: () => true,
                    substeps: [
                        'Read base prompt, UC, character prompts',
                        {
                            text: 'Analyze provided image for visual elements, conflicts, quality issues',
                            condition: () => lastGeneratedImage
                        }
                    ]
                },
                {
                    id: 'check_placeholders',
                    title: 'Check for Text Generation Placeholders',
                    condition: () => true,
                    substeps: [
                        'Scan prompt for [SPEECH_TEXT_INSERT], [THOUGHT_TEXT_INSERT], [CAPTION_TEXT_INSERT]',
                        'If found: Plan contextual replacement (max ~15 words/sentence, use <br> for breaks)',
                        'Reference: See "AI TEXT GENERATION PLACEHOLDERS" section in system message',
                        'NO quotes, NO colorful emojis - use text emoticons only'
                    ]
                },
                {
                    id: 'analyze_context',
                    title: 'Analyze Current Context Data',
                    condition: () => weather || time,
                    substeps: [
                        {
                            text: 'Parse TIME DATA (clock time, period, sun position, light level)',
                            condition: () => time
                        },
                        {
                            text: 'Parse WEATHER DATA LCD (current conditions)',
                            condition: () => weather
                        },
                        {
                            text: 'Review WEATHER HISTORY REPORT: yesterday\'s summary, temporal timeline (past 4h + future 2h), trend analysis',
                            condition: () => weather
                        },
                        {
                            text: 'Note seasonal/holiday information',
                            condition: () => seasonalConfig && seasonalConfig.enabled
                        },
                        'Apply Two-Test System to all data: (1) Photographable? (2) Sets mood/palette?'
                    ]
                },
                {
                    id: 'analyze_directive',
                    title: 'Analyze and Compile User Directive',
                    condition: () => directive,
                    substeps: [
                        'Parse directive for instructions and narrative',
                        'Handle typos/informal language (understand intent)',
                        'Execute conditional logic (IF/THEN/ELIF/ELSE)',
                        'Process incrementing/counter logic and variables',
                        'Handle RANDOM() functions, loops, state management',
                        '🎯 **CRITICAL**: Apply ALL requests from the directive in your text_replacements',
                        'Every action, attribute, or change mentioned MUST be implemented',
                        'If directive says "make character eat" → eating action MUST appear in replacements',
                        'If directive says "add sunset" → sunset elements MUST be added',
                        'Reference: See "ADVANCED DIRECTIVE FEATURES" section for full syntax guide',
                        'See "📜 THE DIRECTIVE" section below for the full directive content'
                    ]
                },
                {
                    id: 'scene_understanding',
                    title: 'Scene Understanding',
                    condition: () => true,
                    variants: [
                        {
                            condition: () => stageContext && stageContext.isBackgroundFocus,
                            substeps: [
                                'Environment Type: Analyze foreground vs new canvas areas',
                                'Identify expandable background elements',
                                'Determine environmental storytelling opportunities'
                            ]
                        },
                        {
                            condition: () => stageContext && stageContext.isEnhance,
                            substeps: [
                                'Analyze entire composition for missing/incorrect details',
                                'Identify inconsistencies and quality issues',
                                'Note refinement opportunities across full composition'
                            ]
                        },
                        {
                            condition: () => true, // default
                            substeps: [
                                'Environment Type: INDOOR/OUTDOOR/MIXED (CRITICAL)',
                                'Core Intent: Primary artistic goal',
                                'Character Focus: Main subjects, roles, relationships',
                                'Style Elements: Artistic styles/techniques',
                                'Setting Details: Environmental descriptions'
                            ]
                        }
                    ]
                },
                {
                    id: 'identify_conflicts',
                    title: 'Identify Conflicts',
                    condition: () => true,
                    substeps: [
                        {
                            text: 'Check for time/weather/lighting conflicts with provided data',
                            condition: () => weather || time
                        },
                        'Check for seasonal conflicts and atmospheric mismatches',
                        'Note any contradictory elements in prompt'
                    ]
                },
                {
                    id: 'check_priority',
                    title: 'Check Priority Hierarchy',
                    condition: () => true,
                    substeps: [
                        {
                            text: 'Level {counter:number:level}: Director Rules',
                            condition: () => directorRules && directorRules.length > 0
                        },
                        {
                            text: 'Level {counter:number:level}: Director Rules (absolute constraints)',
                            condition: () => !directorRules || directorRules.length === 0
                        },
                        {
                            text: 'Level {counter:number:level}: User Directive (🎯 ACTIVE - MANDATORY - ALL requests MUST be implemented - overrides context)',
                            condition: () => directive
                        },
                        {
                            text: 'Level {counter:number:level}: User Directive (if provided)',
                            condition: () => !directive
                        },
                        {
                            text: 'Level {counter:number:level}: Weather/Time Context (ACTIVE)',
                            condition: () => weather || time
                        },
                        {
                            text: 'Level {counter:number:level}: Weather/Time Context (if provided)',
                            condition: () => !weather && !time
                        },
                        'Level {counter:number:level}: Seasonal Guidelines',
                        'Level {counter:number:level}: General Enhancement'
                    ]
                }
            ]
        },
        {
            id: 'research',
            title: 'RESEARCH & UNDERSTAND',
            icon: '🔬',
            condition: () => true,
            steps: [
                {
                    id: 'check_memory',
                    title: 'Check Global Knowledge Memories (avoid redundant research)',
                    condition: () => true
                },
                {
                    id: 'tag_research',
                    title: `Tag Research (MANDATORY - use ${tagResearchTool})`,
                    condition: (ctx) => !ctx.fast_mode,
                    substeps: [
                        ...(useCollectionSearch ? [
                            'Use file_search to search comprehensive tag wiki collection',
                            'Review wiki entries for descriptions and context',
                            'Research tags for weather/time integration',
                            'Research tags for directive requirements',
                            'If your completed research using file_search, web_search, or x_search, you do not need to use searchTagDatabase',
                        ] : [
                            'Verify quality ≥95%, strength ≥8.0',
                            'Research tags for weather/time integration',
                            'Research tags for directive requirements',
                            'Use resolveTagLinks for alternatives/relationships'
                        ]),
                        {
                            text: 'Research tags for weather/time integration',
                            condition: () => weather || time
                        },
                        {
                            text: 'Research tags for directive requirements',
                            condition: () => directive
                        },
                        {
                            text: 'Use resolveTagLinks for alternatives/relationships',
                            condition: () => !useCollectionSearch
                        }
                    ]
                },
                {
                    id: 'memory_research',
                    title: 'Memory Research (FAST MODE - use memories only)',
                    condition: (ctx) => ctx.fast_mode === true,
                    substeps: [
                        'Search for relevant memories using searchKnowledgeMemories (returns full details automatically)',
                        'OR retrieve specific memories using retrieveKnowledgeMemory if you know exact names',
                        'Use memory entities, relations, and observations for tag information',
                        'Apply memory knowledge to create text_replacements',
                        'If memories don\'t have needed info, use your general knowledge'
                    ]
                },
                {
                    id: 'info_gathering',
                    title: `Information Gathering (${webResearchTools} when needed)`,
                    condition: (ctx) => !ctx.fast_mode
                },
                {
                    id: 'understand_tags',
                    title: 'Understand Tag Meaning from tool results',
                    condition: (ctx) => !ctx.fast_mode
                },
                {
                    id: 'understand_memory',
                    title: 'Understand Tag Meaning from memories and knowledge',
                    condition: (ctx) => ctx.fast_mode === true
                },
                {
                    id: 'choose_strategy',
                    title: 'Choose Application Strategy (A/B/C based on context)',
                    condition: () => true,
                    substeps: [
                        {
                            text: 'PRIORITIZE Strategy A (pure tags) for token efficiency',
                            condition: () => optimize && optimize.tokenCount
                        },
                        {
                            text: 'Balance quality vs efficiency based on token usage',
                            condition: () => !optimize || !optimize.tokenCount
                        }
                    ]
                }
            ]
        },
        {
            id: 'plan',
            title: 'PLAN REPLACEMENTS',
            icon: '📝',
            condition: () => true,
            steps: [
                {
                    id: 'transform_content',
                    title: 'Content Transformation Planning',
                    condition: () => true,
                    substeps: [
                        'Transform context data to visual descriptions',
                        'NEVER copy verbatim from input/context',
                        'Convert measurements to visual equivalents',
                        'Remove conceptual language, keep only visuals',
                        'Use Two-Test System: (1) Can I photograph this? (2) Does it set mood/palette?',
                        'If fails both tests: REJECT the element and transform to visible equivalent'
                    ]
                },
                {
                    id: 'rich_description_expansion',
                    title: 'Rich Description Expansion (maximize descriptive richness)',
                    condition: () => creative,
                    substeps: [
                        'Within token limits, maximize descriptive richness',
                        'Expand vague or minimal descriptions into vivid, detailed language',
                        'Add sensory details (textures, lighting nuances, atmospheric qualities)',
                        'Fill in missing details that enhance scene coherence and immersion',
                        'Use available token budget to its fullest - don\'t be sparse when tokens allow',
                        'Transform generic descriptions into specific, evocative imagery',
                        'Examples: "rainy day" → "heavy rain drumming on surfaces, water streaming down windows, puddles reflecting gray overcast sky"',
                        'Reference: See "CREATIVE MODE SPECIFIC TASKS" section - Task 1'
                    ]
                },
                {
                    id: 'tag_enhancement',
                    title: 'Tag Enhancement (enrich tags with descriptive qualifiers)',
                    condition: () => creative,
                    substeps: [
                        'Add descriptive adjectives to base tags when appropriate',
                        'Specify qualities: "rain" → "heavy rain", "smile" → "bright genuine smile"',
                        'Include atmosphere tags: "dramatic lighting", "cinematic composition", "depth of field"',
                        'Layer complementary tags that build on each other',
                        {
                            text: `Research tags first with ${tagResearchTool} to verify quality and strength`,
                            condition: (ctx) => !ctx.fast_mode
                        },
                        {
                            text: 'Use memory knowledge to verify tag quality and strength',
                            condition: (ctx) => ctx.fast_mode === true
                        },
                        'Reference: See "CREATIVE MODE SPECIFIC TASKS" section - Task 2'
                    ]
                },
                {
                    id: 'create_replacements',
                    title: 'Create Complete text_replacements Array',
                    condition: () => true,
                    substeps: [
                        'Reference: See "TEXT REPLACEMENT SYSTEM REFERENCE" section for complete rules',
                        'Plan ALL replacements before responding',
                        {
                            text: '🎯 PRIORITY #1: Implement ALL directive requests in replacements',
                            condition: () => directive
                        },
                        {
                            text: 'Update existing replacements for changed context',
                            condition: () => useIncrementalUpdate
                        },
                        {
                            text: 'Adapt previous replacements to new context',
                            condition: () => adapttionMode
                        },
                        {
                            text: 'Every action, change, or element from directive MUST have corresponding replacements',
                            condition: () => directive
                        },
                        {
                            text: 'Each replacement targets ORIGINAL text only',
                            condition: () => !useIncrementalUpdate && !adapttionMode
                        },
                        'Include: prompt, uc, character_prompts arrays',
                        'UC Strategy: UC the OPPOSITE - See "CONFLICT PREVENTION VIA UC" section',
                        'Apply Three-Step Process for attribute changes (REPLACE + UC + negative emphasis)',
                        'Replace AI text placeholders with contextual dialog (see placeholder check results)'
                    ]
                },
                {
                    id: 'apply_hierarchy',
                    title: 'Apply Modification Hierarchy',
                    condition: () => true,
                    variants: [
                        {
                            condition: () => stageContext && stageContext.isBackgroundFocus,
                            substeps: [
                                'REMOVE: Character expressions, actions, facial details, focus indicators',
                                'KEEP: Location, architecture, weather, lighting, environmental objects',
                                'ADD: Scene depth, environmental storytelling, atmospheric effects'
                            ]
                        },
                        {
                            condition: () => stageContext && stageContext.isEnhance,
                            substeps: [
                                'Analyze entire image for refinement opportunities',
                                'Fix inconsistencies and quality issues',
                                'Polish and refine existing elements',
                                'Enhance details across full composition'
                            ]
                        },
                        {
                            condition: () => true, // default
                            substeps: [
                                'Priority {counter:number:priority}: Conflict resolution - Pass {counter:number:conflict_resolution}',
                                {
                                    text: 'Priority {counter:number:priority}: Time & weather integration (REQUIRED)',
                                    condition: () => time && weather
                                },
                                {
                                    text: 'Priority {counter:number:priority}: Time integration (REQUIRED)',
                                    condition: () => time && !weather
                                },
                                {
                                    text: 'Priority {counter:number:priority}: Weather integration (REQUIRED)',
                                    condition: () => !time && weather
                                },
                                {
                                    text: 'Priority {counter:number:priority}: Atmospheric enhancement',
                                    condition: () => !time && !weather
                                },
                                'Priority {counter:number:priority}: Conflict resolution - Pass {counter:number:conflict_resolution}',
                                'Priority {counter:number:priority}: Character integration - See "Character-Centric Weather Integration Workflow" section in system message',
                                'Priority {counter:number:priority}: Atmospheric refinement',
                                {
                                    text: 'Priority {counter:number:priority}: Creative flourishes',
                                    condition: () => creative
                                },
                                {
                                    text: 'NSFW Mode: See "NSFW Character Enhancement Guidelines" section if content is sexual/fetish-oriented',
                                    condition: () => creative
                                },
                                'Priority {counter:number:priority}: Final conflict resolution - Pass {counter:number:conflict_resolution}',
                            ]
                        }
                    ]
                },
                {
                    id: 'verify_independence',
                    title: 'Verify Replacement Independence',
                    condition: () => true,
                    substeps: [
                        'No overlapping select_text values',
                        'No replacement chains (modifying own additions)',
                        'No duplicate select_text in array',
                        'Each select_text is UNIQUE in prompt',
                        'All replacements work in any order',
                        'Check Pre-Submission Validation Checklist'
                    ]
                },
                {
                    id: 'generate_dialogs',
                    title: 'Generate Dialogs (3-10 required)',
                    condition: () => !stageContext || !stageContext.isBackgroundFocus,
                    substeps: [
                        'Analyze: Physical → Emotional → Situational',
                        'Create 3-10 speech and thought dialogs',
                        'Position spatially (top: 5-95%, left: 5-95%, alignment)',
                        'Reference: See "CHARACTER DIALOG GENERATION" section for deep immersive examples',
                        'Make contextually appropriate, vary intensity, distribute across canvas'
                    ]
                },
                {
                    id: 'character_naming',
                    title: 'Character Naming (replace generic identifiers)',
                    condition: () => creative,
                    substeps: [
                        'Scan character prompts for generic patterns: "Character #1", "Character #2", "Character 1", "Character 2", etc.',
                        'Replace with contextually appropriate names matching scene/setting',
                        'Consider cultural context, time period, and character traits',
                        'Provide as array in character_names field (order must match character_prompts array)',
                        'System will automatically apply names to character prompt objects',
                        'Reference: See "CREATIVE MODE SPECIFIC TASKS" section - Task 3'
                    ]
                },
                {
                    id: 'generated_image_name',
                    title: 'Generated Image Name (create descriptive name)',
                    condition: () => true, // Always enabled, but creative mode makes it more poetic
                    substeps: [
                        '**THIS IS MANDATORY - DO NOT SKIP THIS STEP**',
                        'Create descriptive name capturing essence of scene (3-100 characters)',
                        'Use natural readable format with proper capitalization',
                        'Include: main subject, setting, mood, and significant elements',
                        'Make it memorable, poetic, and evocative',
                        'Consider time/weather if prominent scene elements',
                        {
                            text: 'Creative mode: Be more poetic and descriptive',
                            condition: () => creative
                        },
                        {
                            text: 'Standard mode: Be clear and informative',
                            condition: () => !creative
                        },
                        'Provide in generated_image_name field in your response',
                        '**Validation will fail if this field is missing**',
                        'Reference: See "CREATIVE MODE SPECIFIC TASKS" section - Task 4 for examples'
                    ]
                },
                {
                    id: 'create_memories',
                    title: 'Create Insight Memories (if valuable research done)',
                    condition: () => true,
                    substeps: [
                        'Document reusable research findings',
                        'Add select phrases for future triggering',
                        'Include description of how to use the research',
                        'Focus on prompt-related concepts (not context data)'
                    ]
                }
            ]
        },
        {
            id: 'validate',
            title: 'VALIDATE',
            icon: '✅',
            condition: () => true,
            steps: [
                {
                    id: 'call_validate',
                    title: 'Call validateTextReplacement',
                    condition: () => true,
                    substeps: [
                        'Provide textReplacements, dialogs, insight_memory (optional: new knowledge to save globally)',
                        'Choose mode: Testing (terminateOnPass: false) OR Auto-Complete (terminateOnPass: true)',
                        {
                            text: 'Include verifyTokenCount: true for token optimization validation',
                            condition: () => optimize && optimize.tokenCount
                        },
                        'Include reason explaining what you did',
                        {
                            text: 'TWO-STAGE MODE: Call analyzeTokenCount first to verify efficiency. If optimal AND validation passes: use terminateOnPass: true to complete',
                            condition: (ctx) => ctx.optimize && ctx.optimize.tokenCount && ctx.optimize.twoStage && !ctx.fast_mode
                        },
                        {
                            text: 'SINGLE-STAGE MODE: Include verifyTokenCount: true in validateTextReplacement call',
                            condition: () => optimize && optimize.tokenCount && !optimize.twoStage
                        },
                        {
                            text: 'Reference: See "TOKEN OPTIMIZATION MODE ACTIVE" section in system message',
                            condition: () => optimize && optimize.tokenCount
                        },
                    ]
                },
                {
                    id: 'fix_failures',
                    title: 'Fix Validation Failures (if any)',
                    condition: () => true,
                    substeps: [
                        'Review `failureDetails.detailedMessage` for specific issues',
                        'Check `failureDetails.failuresByType` to see failure categories',
                        'For each failure in `failureDetails.failures`: examine index, select_text, and issues',
                        'Apply the recommended fix for each failure type (see VALIDATION FAILURE HANDLING section)',
                        'Recreate replacements array from scratch (do not try to "patch" existing)',
                        'Call validateTextReplacement again with corrected replacements',
                        'Repeat until validation passes - failures cannot be ignored'
                    ]
                },
                {
                    id: 'choose_completion',
                    title: 'Choose Completion Method',
                    condition: () => true,
                    substeps: [
                        'If terminateOnPass: true AND validation passed → Done!',
                        'Otherwise → Proceed to next step'
                    ]
                }
            ]
        },
        {
            id: 'output',
            title: 'OUTPUT',
            icon: '📤',
            condition: () => true,
            steps: [
                {
                    id: 'auto_complete',
                    title: 'Auto-Complete via terminateOnPass (Quick Method)',
                    condition: () => true,
                    substeps: [
                        'If validation passed with terminateOnPass: true',
                        'System automatically completes using your data',
                        'No structured output needed'
                    ]
                },
                {
                    id: 'generated_image_name_output',
                    title: 'Generate Image Name (generated_image_name)',
                    condition: () => true,
                    substeps: [
                        'Create descriptive name capturing essence of scene (3-100 characters)',
                        'Use natural readable format with proper capitalization',
                        'Include: main subject, setting, mood, and significant elements',
                        'Make it memorable, poetic, and evocative',
                        'Consider time/weather if prominent scene elements',
                        {
                            text: 'Creative mode: Be more poetic and descriptive',
                            condition: () => context.creative
                        },
                        {
                            text: 'Standard mode: Be clear and informative',
                            condition: () => !context.creative
                        },
                        'Provide in generated_image_name field in your response',
                        '**Validation will fail if this field is missing**'
                    ]
                },
                {
                    id: 'manual_complete',
                    title: 'Manual Complete via completeTooling + JSON (Full Method)',
                    condition: () => true,
                    substeps: [
                        'Call completeTooling({ reason: "explanation" })',
                        'Provide structured JSON response with required fields',
                        'Include: text_replacements, dialogs',
                        'Include generated_image_name (descriptive name)',
                        'Include: character_names (if placeholder names detected)',
                        'Optional: insight_memory (new knowledge to save globally - name, category, entities, relations, observations)',
                        'Include: modified_prompt, modified_negative, modified_character_prompts',
                        'Include: reasoning (HTML summary)'
                    ]
                },
                {
                    id: 'report_issues',
                    title: 'Report Errors/Warnings (if applicable)',
                    condition: () => true,
                    substeps: [
                        'Include "errors" array in response JSON for serious directive execution failures',
                        'Include "warnings" array in response JSON for non-critical issues or potential problems',
                        'These are saved to compiled_prompt and sent to client for user feedback',
                        'Reference: See "ERROR & WARNING REPORTING" section for guidelines and examples',
                        'Examples: directive parsing failures, missing variables, counter limits, RANDOM seed unavailable'
                    ]
                }
            ]
        }
    ];

    // Compile and flatten the task list with counter system
    return compileTaskList(taskDefinition, context);
}


/**
 * Auto-save insight_memory entries to global knowledge database
 * @param {Array} insightMemories - Array of insight memory objects from AI response
 * @param {string} phase - Phase identifier for logging (e.g., 'Phase 1', 'Phase 2')
 */
function autoSaveInsightMemories(insightMemories, phase = '') {
    if (!insightMemories || !Array.isArray(insightMemories) || insightMemories.length === 0) {
        return;
    }
    
    const phaseLabel = phase ? `[${phase}] ` : '';
    console.log(`🧠 ${phaseLabel}Auto-saving ${insightMemories.length} insight memor${insightMemories.length === 1 ? 'y' : 'ies'} to global knowledge database...`);
    
    try {
        const knowledgeMemoryDb = globalResources.getKnowledgeMemoryDb();
        let savedCount = 0;
        let skippedCount = 0;
        
        for (const memory of insightMemories) {
            try {
                // Validate memory has required fields
                if (!memory.name || !memory.description || !memory.category || !memory.entities || memory.entities.length === 0) {
                    console.log(`   ⚠️  Skipping incomplete memory: ${memory.name || 'unnamed'} (missing required fields)`);
                    skippedCount++;
                    continue;
                }
                
                // Validate that name is not context-specific
                const contextKeywords = ['current', 'today', 'this', 'now'];
                const nameContainsContext = contextKeywords.some(keyword => memory.name.toLowerCase().includes(keyword));
                
                if (nameContainsContext) {
                    console.log(`   ❌ Skipping context-specific memory: "${memory.name}" (contains context keywords)`);
                    skippedCount++;
                    continue;
                }
                
                // Calculate confidence based on refinement system
                // New memories start at 10%, updates can add up to 25% (capped at 100%)
                const existingMemory = knowledgeMemoryDb.getKnowledgeMemory(memory.name, false);
                let finalConfidence;
                
                if (existingMemory) {
                    // Memory is being updated - add provided confidence (up to 0.25) to existing
                    const confidenceIncrease = memory.confidence || 0.25;
                    const cappedIncrease = Math.min(confidenceIncrease, 0.25); // Cap at 25% increase
                    finalConfidence = Math.min(existingMemory.confidence + cappedIncrease, 1.0);
                    console.log(`   📈 Updating memory "${memory.name}": ${(existingMemory.confidence * 100).toFixed(0)}% → ${(finalConfidence * 100).toFixed(0)}% (+${(cappedIncrease * 100).toFixed(0)}%)`);
                } else {
                    // New memory - start at 10%
                    finalConfidence = 0.1;
                    console.log(`   ✨ Creating new memory "${memory.name}": ${(finalConfidence * 100).toFixed(0)}%`);
                }
                
                // Save to database
                knowledgeMemoryDb.saveKnowledgeMemory(
                    memory.name,
                    memory.description,
                    memory.category,
                    memory.entities,
                    memory.relations || [],
                    memory.observations || [],
                    finalConfidence
                );
                
                console.log(`   ✅ Saved global memory: "${memory.name}" (${memory.entities.length} entities, ${(memory.relations || []).length} relations, ${(finalConfidence * 100).toFixed(0)}% confidence)`);
                savedCount++;
            } catch (saveError) {
                console.error(`   ❌ Failed to save memory "${memory.name}":`, saveError.message);
                skippedCount++;
            }
        }
        
        logger.detailed(`🧠 ${phaseLabel}Memory save: ${savedCount} saved, ${skippedCount} skipped`);
    } catch (error) {
        console.error(`❌ Error processing ${phase ? phase + ' ' : ''}insight memories:`, error);
        // Continue even if saving fails - don't block generation
    }
}

// Generalized dynamic generation processing function - extracts core AI logic from WebSocket handler
const tracing = require('./tracing');

async function processDynamicGenerationCore(dynamicConfig, prompt, uc, characterPrompts = [], requestId = 'core', ws = null, handler = null, wsServer = null, backgroundFocus = false, lastGeneratedImage = null, stageContext = null, datasetConfig = null, appliedPresetControls = null, preCalculatedHashes = null) {
    try {
        // Summarized console output
        logger.normal(`🎭 Dynamic generation: ${requestId}${backgroundFocus ? ' [BG]' : ''}${dynamicConfig.directive ? ' | directive' : ''}`);
        
        // Detailed file logging
        logger.logGeneration('DYNAMIC_GENERATION_START', {
            requestId,
            backgroundFocus,
            hasDirective: !!dynamicConfig.directive,
            directive: dynamicConfig.directive,
            tod: dynamicConfig.tod,
            weather: dynamicConfig.weather,
            season: dynamicConfig.season,
            optimize: dynamicConfig.optimize
        }, requestId);
    
        // Use pre-calculated hashes if provided, otherwise calculate them
        // Pre-calculated hashes ensure consistency with imageGeneration.js hash calculations
        const currentRequestHash = preCalculatedHashes?.requestHash ?? generateRequestHash(dynamicConfig, datasetConfig);
        const currentPromptHash = preCalculatedHashes?.promptHash ?? generatePromptHash(prompt, uc, characterPrompts);
        const currentDirectiveHash = preCalculatedHashes?.directiveHash ?? generateDirectiveHash(dynamicConfig.directive);

        // Check if we can reuse previous response ID (stateful conversation optimization)
        let cachedResponseId = null;
        let cachedInitialResponseId = null; // Track initial response ID separately
        let skipSystemMessage = false;
        let useIncrementalUpdate = false;
        let changeInfo = null;

        // Generate random seed for directive random operations
        const randomSeed = Math.floor(Math.random() * 100);
        const generationChainNumber = (dynamicConfig.compiled_prompt?.generation_chain || 0) + 1;
        
        // Check if chain_updates is enabled (default to false if not provided by client)
        const chainUpdatesEnabled = dynamicConfig.chain_updates === true || dynamicConfig.chain_updates === undefined;
        if (chainUpdatesEnabled && dynamicConfig.compiled_prompt?.previousResponseId) {
            // Preserve initial response ID from cached config
            cachedInitialResponseId = dynamicConfig.compiled_prompt.initialResponseId || null;
            // Check if chat history is older than 30 days (conversation context limit)
            const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
            const cacheAge = dynamicConfig.compiled_prompt?.timestamp ? Date.now() - dynamicConfig.compiled_prompt.timestamp : Infinity;
            
            if (cacheAge > thirtyDaysMs) {
                console.log(`🕐 Chat history is ${Math.floor(cacheAge / (24 * 60 * 60 * 1000))} days old (> 30 days) - not using previous_response_id`);
            } else {
                cachedResponseId = dynamicConfig.compiled_prompt.previousResponseId;
                skipSystemMessage = true;
                
                // Check hashes to see what changed
                const contextHashChanged = dynamicConfig.compiled_prompt.request_hash && currentRequestHash !== dynamicConfig.compiled_prompt.request_hash;
                const promptHashChanged = dynamicConfig.compiled_prompt.prompt_hash && currentPromptHash !== dynamicConfig.compiled_prompt.prompt_hash;
                const directiveHashChanged = dynamicConfig.compiled_prompt.directive_hash && currentDirectiveHash !== dynamicConfig.compiled_prompt.directive_hash;
                
                // Check if system-message-critical settings changed (these fundamentally alter system message structure)
                // NOTE: Optimization strategies are now ALWAYS in system message (static), so we only check:
                // - twoStage mode (adds/removes two-stage workflow section)
                // - creative mode (adds/removes creative enhancement sections)
                let systemMessageCriticalChange = false;
                if (contextHashChanged && dynamicConfig.compiled_prompt.optimize !== undefined && dynamicConfig.compiled_prompt.creative !== undefined) {
                    const oldOptimize = dynamicConfig.compiled_prompt.optimize;
                    const newOptimize = dynamicConfig.optimize;
                    const oldCreative = dynamicConfig.compiled_prompt.creative;
                    const newCreative = dynamicConfig.creative;
                    
                    // Extract twoStage settings
                    const oldTwoStage = typeof oldOptimize === 'object' ? oldOptimize.twoStage : false;
                    const newTwoStage = typeof newOptimize === 'object' ? newOptimize.twoStage : false;
                    
                    // Check if twoStage mode changed (changes system message structure)
                    if (oldTwoStage !== newTwoStage) {
                        systemMessageCriticalChange = true;
                        console.log(`🔄 System message critical change detected: twoStage=${oldTwoStage}->${newTwoStage}`);
                    }
                    
                    // Check if creative mode changed (changes system message structure)
                    if (oldCreative !== newCreative) {
                        systemMessageCriticalChange = true;
                        console.log(`🔄 System message critical change detected: creative=${oldCreative}->${newCreative}`);
                    }
                }
                
                // If system message critical settings changed, break the chain completely
                if (systemMessageCriticalChange) {
                    console.log(`🔗 Breaking chain due to system message critical changes - forcing fresh system message`);
                    cachedResponseId = null;
                    skipSystemMessage = false;
                    useIncrementalUpdate = false;
                } else {
                    // Check for Force Context Refresh flag (allows manual context refresh without changing parameters)
                    // Usage: Set dynamic_generation.force_context_refresh = true to trigger context update in chain mode
                    const forceContextRefresh = dynamicConfig.force_context_refresh === true;
                    const contextChanged = contextHashChanged || forceContextRefresh;
                    useIncrementalUpdate = (contextChanged || promptHashChanged || directiveHashChanged);
                    
                    changeInfo = {
                        hasChanges: contextChanged || promptHashChanged || directiveHashChanged,
                        contextChanged: contextChanged,
                        promptChanged: promptHashChanged,
                        directiveChanged: directiveHashChanged,
                        forcedRefresh: forceContextRefresh
                    };
                    
                    // Only log if there are actual changes
                    if (contextChanged || promptHashChanged || directiveHashChanged) {
                        console.log(`🔄 Chain update: ${contextChanged ? 'context' : ''} ${promptHashChanged ? 'prompts' : ''} ${directiveHashChanged ? 'directive' : ''} changed${forceContextRefresh ? ' (forced refresh)' : ''}`);
                    } else {
                        console.log('✅ Chain update: no changes detected, using cached context');
                    }
                }
            }
        }

        // Extract client IP for context resolution
        const clientInfo = wsServer?.clients?.get(ws);
        const clientIP = clientInfo?.clientIP || null;

        // Extract parameters from dynamic config
        const {
            optimize,
            creative,
            clothing,
            season,
            tod,
            weather,
            activity,
            action,
            location,
            directive,
            compiled_prompt
        } = dynamicConfig;

        // Get NSFW level from dataset config
        const nsfw_level = datasetConfig?.nsfw;

        // Extract optimize options (handle both boolean and object formats)
        let optimizeEnabled = false;
        let tokenCountEnabled = true; // Default to true
        let pipelineAware = false; // Default to false
        let initialPromptAware = false; // Default to false
        let twoStageEnabled = false; // Default to false
        
        if (typeof optimize === 'object' && optimize !== null) {
            optimizeEnabled = optimize.enabled || false;
            tokenCountEnabled = optimize.tokenCount !== undefined ? optimize.tokenCount : true;
            pipelineAware = optimize.pipelineAware || false;
            initialPromptAware = optimize.initialPromptAware || false;
            twoStageEnabled = optimize.twoStage || false;
        } else {
            optimizeEnabled = !!optimize;
        }
        
        // Extract lockSubject from root level (moved from optimize object)
        let lockSubjectEnabled = dynamicConfig?.lockSubject === true;
        
        // Extract fast_mode as separate field (independent of optimize)
        const fastModeEnabled = dynamicConfig?.fast_mode === true;

        // Get resolved context from shared resolver
        // Handle context locking logic
        let context;
        if (!!dynamicConfig.context_locked && compiled_prompt?.context) {
            console.log('🔒 Context locked: Reusing existing context from compiled prompt');
            context = compiled_prompt.context;
        } else if (!!dynamicConfig.locked && compiled_prompt?.context) {
            // Pipeline stage inheritance - reuse context from previous stage
            console.log('🔒 Pipeline locked mode: Reusing context from previous stage');
            context = compiled_prompt.context;
        } else {
            // Normal context compilation (includes context_locked with no valid context)
            if (!!dynamicConfig.context_locked && !compiled_prompt?.context) {
                console.log('⚠️ Context locked but no valid context found - compiling new context');
            }
            console.log(`🔍 Compiling new context - locked: ${!!dynamicConfig.locked}, context_locked: ${!!dynamicConfig.context_locked}, has compiled_prompt: ${!!compiled_prompt}, has context: ${!!compiled_prompt?.context}`);
            context = await compileContext(dynamicConfig, clientIP);
            
            // Validate context - if seasonal is enabled, context.season must be a valid seasonalGuidelines object
            if (context.seasonalConfig?.enabled) {
                if (!context.season || typeof context.season === 'string' || !context.season.mode) {
                    const error = new Error('Seasonal enabled but context.season is missing or invalid seasonalGuidelines object. Context must be regenerated.');
                    console.error('❌ Context validation failed:', error.message);
                    throw error;
                }
            }
        }
        
        // Add optimize options to context
        context.tokenCountEnabled = tokenCountEnabled;
        context.lockSubject = lockSubjectEnabled;

        // Count tokens for all prompts (only if token count enforcement is enabled)
        if (tokenCountEnabled) {
            try {
                const t5TokenizerService = globalResources.getT5Tokenizer();
                const promptTokenCount = t5TokenizerService.countTokens(prompt || '');
                const ucTokenCount = t5TokenizerService.countTokens(uc || '');
                
                const characterTokenCounts = characterPrompts.map(char => ({
                    prompt: t5TokenizerService.countTokens(char.prompt || ''),
                    uc: t5TokenizerService.countTokens(char.uc || '')
                }));
                
                const totalCharacterPromptTokens = characterTokenCounts.reduce((sum, char) => sum + char.prompt, 0);
                const totalCharacterUCTokens = characterTokenCounts.reduce((sum, char) => sum + char.uc, 0);
                
                // Add token counts to context
                context.tokenCounts = {
                    prompt: promptTokenCount,
                    uc: ucTokenCount,
                    characterPrompts: characterTokenCounts,
                    totalPrompt: promptTokenCount + totalCharacterPromptTokens,
                    totalUC: ucTokenCount + totalCharacterUCTokens
                };
                if (characterPrompts.length > 0) {
                    characterTokenCounts.forEach((char, idx) => {
                        console.log(`   Character ${idx + 1}: ${char.prompt} prompt tokens, ${char.uc} UC tokens`);
                    });
                }
                console.log(`   TOTAL Prompts: ${context.tokenCounts.totalPrompt} / 512 tokens (${Math.round((context.tokenCounts.totalPrompt / 512) * 100)}% used)`);
                console.log(`   TOTAL UC: ${context.tokenCounts.totalUC} / 512 tokens (${Math.round((context.tokenCounts.totalUC / 512) * 100)}% used)`);
                
                if (context.tokenCounts.totalPrompt > 512) {
                    console.warn('⚠️ WARNING: Total prompt tokens exceed 512 limit!');
                }
                if (context.tokenCounts.totalUC > 512) {
                    console.warn('⚠️ WARNING: Total UC tokens exceed 512 limit!');
                }
            } catch (error) {
                console.error('❌ Failed to count tokens:', error);
                // Continue without token counts if tokenizer fails
            }
        }

        // PROMPT ANALYSIS: Generate tree-formatted analysis for AI
        let promptAnalysisTree = null;
        // if (optimizeEnabled && tokenCountEnabled) {
        //     try {
        //         // Initialize optimizer if not already done
        //         if (!localPromptOptimizer.initialized) {
        //             await localPromptOptimizer.initialize();
        //         }

        //         if (localPromptOptimizer.initialized) {
        //             // Determine warning levels
        //             const getWarningLevel = (tokenCount, limit = 512) => {
        //                 if (tokenCount > limit) return 'critical';
        //                 if (tokenCount > 275) return 'warning';
        //                 return null;
        //             };
                    
        //             const promptWarning = context.tokenCounts ? getWarningLevel(context.tokenCounts.totalPrompt) : null;
        //             const ucWarning = context.tokenCounts ? getWarningLevel(context.tokenCounts.totalUC) : null;
                    
        //             // Generate tree-formatted analysis for all prompts with token info
        //             const analyses = {
        //                 basePrompt: prompt ? localPromptOptimizer.formatPromptAnalysisTree(
        //                     prompt, 
        //                     context.tokenCounts?.prompt, 
        //                     512, 
        //                     promptWarning
        //                 ) : null,
        //                 baseUC: uc ? localPromptOptimizer.formatPromptAnalysisTree(
        //                     uc, 
        //                     context.tokenCounts?.uc, 
        //                     512, 
        //                     ucWarning
        //                 ) : null,
        //                 characterPrompts: characterPrompts.map((char, idx) => ({
        //                     prompt: char.prompt ? localPromptOptimizer.formatPromptAnalysisTree(
        //                         char.prompt,
        //                         context.tokenCounts?.characterPrompts?.[idx]?.prompt,
        //                         512,
        //                         promptWarning
        //                     ) : null,
        //                     uc: char.uc ? localPromptOptimizer.formatPromptAnalysisTree(
        //                         char.uc,
        //                         context.tokenCounts?.characterPrompts?.[idx]?.uc,
        //                         512,
        //                         ucWarning
        //                     ) : null
        //                 }))
        //             };
                    
        //             promptAnalysisTree = analyses;
        //         }
        //     } catch (error) {
        //         console.error('❌ Prompt analysis failed:', error);
        //         // Continue without analysis
        //     }
        // }

        // Send carousel update with resolved context data after compileContext
        if (ws && handler) {
            const carouselData = formatContextForCarousel(context);

            handler.sendToClient(ws, {
                type: 'dynamic_context_resolved',
                data: carouselData,
                timestamp: new Date().toISOString()
            });
        }

        // Detailed logging of gathered data
        // Summarized console output
        const seasonDisplay = typeof context.season === 'string' ? context.season : context.season?.season || 'N/A';
        logger.normal('📊 Context compiled:', context.location ? `${context.location.city}, ${seasonDisplay}, ${normalizePeriodKey(context.timePeriod?.periodKey || 'N/A')}` : 'Location unavailable');
        
        // Detailed file logging
        logger.logGeneration('GATHERED_CONTEXT_DATA', {
            time: context.time,
            timePeriod: context.timePeriod,
            weather: context.weather,
            season: context.season,
            clothing: context.clothing,
            activity: context.activity || activity,
            action: context.action || action,
            optimize: optimize,
            creative: creative,
            location: context.location
        }, requestId);
        
        // Verbose console output
        if (logger.shouldLog(logger.VERBOSITY_LEVELS.VERBOSE)) {
            console.log('  📅 Time Data     :', context.time || 'No time data');
            console.log('  ⏰ Time Period   :', context.timePeriod || 'No time period data');
            console.log('  🌤️ Weather Data  :', context.weather || 'No weather data');
            const seasonDisplay = typeof context.season === 'string' ? context.season : context.season?.season || 'Seasonal disabled';
            console.log('  🌿 Seasonal Data :', seasonDisplay);
            console.log('  👕 Clothing      :', context.clothing || 'Not specified');
            console.log('  📝 Activity      :', context.activity || activity);
            console.log('  👨‍💻 Action        :', context.action || action);
            console.log('  🔍 Optimization  :', optimize);
            console.log('  🎨 Creative      :', creative);
            console.log('  📍 Location      :', context.location ? `${context.location.timezone}, ${context.location.city}, ${context.location.country}` : location);
        }

        // Generate comprehensive system message using real context
        let systemMessage;
        let userContentSections;
        let directiveContentSections;
        
        // Generate system message and user content sections
        // ALWAYS call this to get userContentSections (even if we skip system message)
        let messageResult;
        try {
            messageResult = generateDynamicGenerationSystemMessage_Modular(
                context,
                context.seasonalConfig,
                backgroundFocus,
                pipelineAware,
                stageContext,
                directive,
                dynamicConfig,
                nsfw_level,
                compiled_prompt,
                prompt,
                uc
            );
            
            // Only use system message if we're NOT skipping (no cached response ID)
            if (!skipSystemMessage) {
                systemMessage = messageResult.systemMessage;
            } else {
                console.log(`⚡ Skipped system message (using cached previous_response_id)`);
            }
            
            userContentSections = messageResult.userContentSections;
            directiveContentSections = messageResult.directiveContentSections;
        } catch (error) {
            console.error('❌ Weather data validation failed:', error.message);
            // Return error structure instead of crashing
            return {
                success: false,
                error: `Weather data validation failed: ${error.message}`,
                processed: false
            };
        }

        const adapttionMode = compiled_prompt ? (compiled_prompt.prompt || compiled_prompt.uc || compiled_prompt.character_prompts) : false;

        // Only show token count summary when approaching limits (prompt > 400 or UC > 380)
        // Show always for initial generation, or in chain mode only when prompts changed
        const totalPrompt = context.tokenCounts?.totalPrompt || 0;
        const totalUC = context.tokenCounts?.totalUC || 0;
        const shouldShowTokenCount = context.tokenCounts && (totalPrompt > 400 || totalUC > 380) &&
            (!useIncrementalUpdate || (useIncrementalUpdate && changeInfo?.promptChanged));
        
        // Build token count section (condensed format, only when needed)
        let tokenCountSection = '';
        if (shouldShowTokenCount || (optimizeEnabled && context.tokenCounts && (totalPrompt > 400 || totalUC > 380))) {
            const promptPressure = totalPrompt > 400 ? 'high' : totalPrompt > 300 ? 'moderate' : 'low';
            // UC recommended limit is 380 tokens before stressing
            const ucPressure = totalUC > 380 ? 'high' : totalUC > 300 ? 'moderate' : 'low';
            const anyHighPressure = promptPressure === 'high' || ucPressure === 'high';
            
            // Condensed format
            tokenCountSection = [
                '## 📊 TOKEN USAGE',
                `Tokens: ${totalPrompt}/512 prompt, ${totalUC}/512 UC ${totalPrompt > 512 || totalUC > 512 ? '🚨 OVER LIMIT!' : totalPrompt > 400 || totalUC > 380 ? '⚠️ APPROACHING' : ''}`,
                ...(optimizeEnabled ? [`Priority: ${anyHighPressure ? '🔴 HIGH' : promptPressure === 'moderate' || ucPressure === 'moderate' ? '🟡 MODERATE' : '🟢 LOW'}`] : []),
                ''
            ].filter(Boolean).join('\n');
        }

        // Build incremental update section if applicable

        const userMessage = {
            type: "input_text",
            text: [
                '# 🎯 PHASE 1: CONTEXT INTEGRATION & DIRECTIVE PROCESSING',
                '',
                '**Server-Maintained Values:**',
                `**RANDOM SEED**: ${randomSeed}  // Auto-generated for RANDOM() function`,
                `**GENERATION CHAIN**: ${generationChainNumber}  // Current generation in chain`,
                '',
                // Generate dynamic task list based on current context
                ...(() => {
                    const taskListContext = {
                        weather: context.weather,
                        time: context.time,
                        directive: dynamicConfig.directive,
                        creative: dynamicConfig.creative,
                        optimize: dynamicConfig.optimize,
                        fast_mode: dynamicConfig?.fast_mode === true,
                        stageContext: stageContext,
                        lastGeneratedImage: lastGeneratedImage,
                        seasonalConfig: (context.seasonalConfig?.enabled || false) ? context.seasonalConfig : null,
                        useIncrementalUpdate: useIncrementalUpdate,
                        adapttionMode: adapttionMode,
                        directorRules: [], // Loaded separately in system message from director.config.json
                        backgroundFocus: backgroundFocus,
                        changeInfo: changeInfo,
                        lockedReplacements: dynamicConfig.locked_replacements || []
                    };
                    
                    return generateDynamicTaskList(taskListContext);
                })(),
                '',
                '---',
                '',
                ...(userContentSections ? userContentSections : []),
                '',
                ...(directiveContentSections ? directiveContentSections : []),
                '',
                tokenCountSection,
                '',
                ...(adapttionMode ? [
                    '## Previous Prompts (for reference):',
                    '',
                    '**Previous Base Prompt:**',
                    '```',
                    compiled_prompt.prompt ? (typeof compiled_prompt.prompt === 'string' ? compiled_prompt.prompt : String(compiled_prompt.prompt)) : 'No previous base prompt',
                    '```',
                    '',
                    '**Previous Negative Prompt:**',
                    '```',
                    compiled_prompt.uc ? (typeof compiled_prompt.uc === 'string' ? compiled_prompt.uc : String(compiled_prompt.uc)) : 'No previous negative prompt',
                    '```',
                    '',
                    ...(compiled_prompt.character_prompts && Array.isArray(compiled_prompt.character_prompts) && compiled_prompt.character_prompts.length > 0 ? [
                        '**Previous Character Prompts:**',
                        ...compiled_prompt.character_prompts.map((char, idx) => {
                            const charLines = [
                                `Character ${idx + 1}:`,
                                '```',
                                typeof char === 'string' ? char : String(char),
                                '```',
                                ''
                            ];
                            return charLines.join('\n');
                        }).join('').split('\n'),
                    ] : []),
                ] : []),
                '## Current Prompts (to adapt):',
                '⚠️ **CRITICAL**: The prompts below are the EXACT current state. Only replace text that you can see exists in these prompts.',
                '',
                '**Base Prompt:**',
                '```',
                prompt ? prompt : 'No base prompt provided',
                '```',
                ...(appliedPresetControls?.prompt?.length > 0 ? [
                    '⚙️ Preset Controlled:\n' + appliedPresetControls.prompt.map(c => {
                        if (c.action === 'dataset_prepend') return `  * Dataset (prepend): \`${c.text}\``;
                        if (c.action === 'dataset_preset_append') return `  * Dataset Preset: \`${c.text}\``;
                        if (c.action === 'quality_preset') return `  * Quality Preset${c.bias !== 1.0 ? ` (bias ${c.bias})` : ''}: \`${c.text}\``;
                        if (c.action === 'vibe_text_injection') return `  * Vibe Transfer: \`${c.text}\``;
                        if (c.action === 'nsfw_processing') { return `  * NSFW (bias ${c.bias}): \`${c.text}\``; }
                        return '';
                    }).filter(Boolean).join('\n')
                ].filter(Boolean) : []),
                promptAnalysisTree?.basePrompt ? promptAnalysisTree.basePrompt : '',
                '',
                '**Negative Prompt:**',
                '```',
                uc ? uc : 'No negative prompt provided',
                '```',
                ...(appliedPresetControls?.uc?.length > 0 ? [
                    '⚙️ Preset Controlled:\n' + appliedPresetControls.uc.map(c => {
                        if (c.action === 'uc_preset') return `  * Quality Preset: \`${c.text}\``;
                        if (c.action === 'vibe_text_injection') return `  * Vibe Transfer: \`${c.text}\``;
                        if (c.action === 'nsfw_processing') { return `  * NSFW (bias ${c.bias}): \`${c.text}\``; }
                        return '';
                    }).filter(Boolean).join('\n')
                ].filter(Boolean) : []),
                promptAnalysisTree?.baseUC ? promptAnalysisTree.baseUC : '',
                '',
                characterPrompts ? characterPrompts.length > 0 ?
                    '**Character Prompts:**\n' +
                    characterPrompts.map((char, index) => {
                        const charAnalysis = promptAnalysisTree?.characterPrompts?.[index];
                        return [
                            `Character ${index + 1} (${char.name || 'Unnamed'}):`,
                            '  Prompt:',
                            '  ```',
                            `  ${char.prompt || 'No prompt'}`,
                            '  ```',
                            charAnalysis?.prompt ? '  ' + charAnalysis.prompt.split('\n').join('\n  ') : '',
                            '',
                            '  Undesired Content:',
                            '  ```',
                            `  ${char.uc || 'No UC'}`,
                            '  ```',
                            charAnalysis?.uc ? '  ' + charAnalysis.uc.split('\n').join('\n  ') : ''
                        ].filter(Boolean).join('\n');
                    }).join('\n') + '\n' : '' : '',
            ].filter(Boolean).join('\n')
        };

        // Build messages array
        const userContent = [userMessage];
        
        // Add last generated image for background focus mode or enhance stages
        if (lastGeneratedImage) {
            const reason = backgroundFocus ? 'background focus' : (stageContext?.isEnhance ? 'enhance stage' : 'analysis');
            console.log(`🖼️ Adding last generated image to dynamic generation request for ${reason}`);

            try {
                let imageBuffer;
                
                // Check if lastGeneratedImage is a Buffer, filename string, or image object
                if (Buffer.isBuffer(lastGeneratedImage)) {
                    // Direct buffer passed (letterboxed image)
                    imageBuffer = lastGeneratedImage;
                    console.log(`📸 Using letterboxed buffer directly`);
                } else if (typeof lastGeneratedImage === 'string') {
                    // Filename string - read from disk
                    const imagePath = path.join('./images', lastGeneratedImage);
                    if (fs.existsSync(imagePath)) {
                        imageBuffer = fs.readFileSync(imagePath);
                        console.log(`📸 Loaded image from file: ${lastGeneratedImage}`);
                    } else {
                        console.warn(`⚠️ Last generated image not found: ${lastGeneratedImage}`);
                        return {
                            success: false,
                            error: `Last generated image file not found: ${lastGeneratedImage}`,
                            processed: false
                        };
                    }
                } else if (typeof lastGeneratedImage === 'object' && lastGeneratedImage !== null) {
                    // Handle image object - try to extract buffer or filename
                    if (Buffer.isBuffer(lastGeneratedImage.buffer)) {
                        // Object with buffer property
                        imageBuffer = lastGeneratedImage.buffer;
                        console.log(`📸 Using buffer from image object`);
                    } else if (typeof lastGeneratedImage.filename === 'string') {
                        // Object with filename property
                        const imagePath = path.join('./images', lastGeneratedImage.filename);
                        if (fs.existsSync(imagePath)) {
                            imageBuffer = fs.readFileSync(imagePath);
                            console.log(`📸 Loaded image from object filename: ${lastGeneratedImage.filename}`);
                        } else {
                            console.warn(`⚠️ Last generated image not found: ${lastGeneratedImage.filename}`);
                            return {
                                success: false,
                                error: `Last generated image file not found: ${lastGeneratedImage.filename}`,
                                processed: false
                            };
                        }
                    } else if (typeof lastGeneratedImage.original === 'string') {
                        // Object with original property (common in image objects)
                        const imagePath = path.join('./images', lastGeneratedImage.original);
                        if (fs.existsSync(imagePath)) {
                            imageBuffer = fs.readFileSync(imagePath);
                            console.log(`📸 Loaded image from object original: ${lastGeneratedImage.original}`);
                        } else {
                            console.warn(`⚠️ Last generated image not found: ${lastGeneratedImage.original}`);
                            return {
                                success: false,
                                error: `Last generated image file not found: ${lastGeneratedImage.original}`,
                                processed: false
                            };
                        }
                    } else if (Buffer.isBuffer(lastGeneratedImage.data)) {
                        // Object with data property containing buffer
                        imageBuffer = lastGeneratedImage.data;
                        console.log(`📸 Using buffer from object data property`);
                    } else {
                        console.warn(`⚠️ Invalid lastGeneratedImage object - no buffer, filename, original, or data property found:`, Object.keys(lastGeneratedImage));
                        return {
                            success: false,
                            error: `Invalid lastGeneratedImage object - no buffer, filename, original, or data property found`,
                            processed: false
                        };
                    }
                } else {
                    console.warn(`⚠️ Invalid lastGeneratedImage type: ${typeof lastGeneratedImage}`);
                    return {
                        success: false,
                        error: `Invalid lastGeneratedImage type: ${typeof lastGeneratedImage}. Expected Buffer, string, or image object.`,
                        processed: false
                    };
                }
                
                // Resize image so the shortest edge is the nearest multiple of 448.
                // If already very close (< 3%) to the next multiple, don't resize.
                const metadata = await sharp(imageBuffer).metadata();
                const minDimension = Math.min(metadata.width, metadata.height);
                const nearestMultiple = Math.max(448, Math.round(minDimension / 448) * 448);
                const distance = Math.abs(nearestMultiple - minDimension);
                const relative = distance / minDimension;
                let targetWidth = metadata.width;
                let targetHeight = metadata.height;
                if (relative >= 0.03) {
                    const scale = nearestMultiple / minDimension;
                    targetWidth = Math.round(metadata.width * scale);
                    targetHeight = Math.round(metadata.height * scale);
                    imageBuffer = await sharp(imageBuffer)
                        .resize(targetWidth, targetHeight)
                        .jpeg({ quality: 85 })
                        .toBuffer();
                }
                
                const imageBase64 = imageBuffer.toString('base64');
                
                // Add image to user message content - Responses API format
                userContent.push({
                    type: "input_image",
                    image_url: `data:image/jpeg;base64,${imageBase64}`
                });
                
                console.log(`✅ Last generated image added to request (resized to ${targetWidth}x${targetHeight})`);
            } catch (error) {
                console.error('❌ Error adding last generated image:', error.message);
            }
        }
        
        // Add preview image if Initial Prompt Aware is enabled and preview exists (but not for background/enhance stages which use lastGeneratedImage)
        if (initialPromptAware && (compiled_prompt?.preview_image_hash || compiled_prompt?.preview_image)) {
            console.log(`🖼️ Initial Prompt Aware enabled - adding preview image to request`);
            
            try {
                let imageBuffer;
                
                // Check if we have the new hash-based format or old base64 format
                if (compiled_prompt.preview_image_hash) {
                    // Load preview from file system using hash
                    const dynGenPreviewDir = path.join(cacheDir, 'dynGenPreview');
                    const previewFilePath = path.join(dynGenPreviewDir, `${compiled_prompt.preview_image_hash}.png`);
                    
                    if (fs.existsSync(previewFilePath)) {
                        imageBuffer = fs.readFileSync(previewFilePath);
                        console.log(`📂 Loaded preview from cache: ${compiled_prompt.preview_image_hash.substring(0, 8)}...`);
                    } else {
                        console.warn(`⚠️ Preview file not found in cache: ${compiled_prompt.preview_image_hash.substring(0, 8)}...`);
                        throw new Error('Preview file not found');
                    }
                } else if (compiled_prompt.preview_image) {
                    // Backwards compatibility: Load from old base64 format
                    console.log(`📜 Loading preview from legacy base64 format`);
                    imageBuffer = Buffer.from(compiled_prompt.preview_image, 'base64');
                }
                
                if (imageBuffer) {
                    // Resize preview so the shortest edge is the nearest multiple of 448.
                    // If already very close (< 3%) to the next multiple, don't resize.
                    const metadata = await sharp(imageBuffer).metadata();
                    const minDimension = Math.min(metadata.width, metadata.height);
                    const nearestMultiple = Math.max(448, Math.round(minDimension / 448) * 448);
                    const distance = Math.abs(nearestMultiple - minDimension);
                    const relative = distance / minDimension;
                    let targetWidth = metadata.width;
                    let targetHeight = metadata.height;
                    if (relative >= 0.03) {
                        const scale = nearestMultiple / minDimension;
                        targetWidth = Math.round(metadata.width * scale);
                        targetHeight = Math.round(metadata.height * scale);
                        imageBuffer = await sharp(imageBuffer)
                            .resize(targetWidth, targetHeight)
                            .jpeg({ quality: 85 })
                            .toBuffer();
                    }
                    
                    const resizedBase64 = imageBuffer.toString('base64');
                    
                    // Add image to user message content - Responses API format
                    userContent.push({
                        type: "input_image",
                        image_url: `data:image/jpeg;base64,${resizedBase64}`
                    });
                    
                    console.log(`✅ Preview image added to request (resized to ${targetWidth}x${targetHeight})`);
                }
            } catch (error) {
                console.error('❌ Error adding preview image:', error.message);
            }
        }
        
        // Add vocabulary file to user content if optimization is enabled
        // Skip if using cached response ID (vocabulary already sent in initial request)
        // if (optimizeEnabled && !skipSystemMessage) {
        //     try {
        //         // Check if collection is available (preferred method)
        //         const hasCollection = secureConfig.grok?.tokenizerCollectionId;
                
        //         if (hasCollection) {
        //             // Collection will be accessed via enableOptimize flag
        //             logger.detailed(`📚 Tokenizer collection available for optimization`);
        //         } else {
        //             // Fallback: Load and filter vocabulary locally
        //             const vocabPath = path.join(__dirname, '../securePrompts/t5-vocabulary.json');
        //             if (fs.existsSync(vocabPath)) {
        //                 const vocabData = JSON.parse(fs.readFileSync(vocabPath, 'utf8'));
                        
        //                 // Filter to only high-strength tokens (≥7.0) to reduce token usage
        //                 const highStrengthTokens = vocabData.vocabulary
        //                     .filter(token => !token.isSpecial && token.strength >= 7.0)
        //                     .sort((a, b) => b.strength - a.strength)
        //                     .slice(0, 1000); // Top 5000 strongest tokens
                        
        //                 const filteredVocab = {
        //                     metadata: vocabData.metadata,
        //                     note: `Filtered to top 5000 strongest tokens (strength ≥ 7.0) from ${vocabData.vocabulary.length} total`,
        //                     highStrengthTokens: highStrengthTokens.map(t => ({
        //                         text: t.text,
        //                         strength: t.strength,
        //                         id: t.id
        //                     }))
        //                 };
                        
        //                 const vocabContent = JSON.stringify(filteredVocab, null, 2);
                        
        //                 // Add vocabulary as text content - Responses API format
        //                 userContent.push({
        //                     type: 'input_text',
        //                     text: `\`\`\`json\n${vocabContent}\n\`\`\``
        //                 });
                        
        //                 console.log(`📚 Added filtered vocabulary to user message (top ${highStrengthTokens.length} strongest tokens)`);
        //             } else {
        //                 console.warn(`⚠️ Vocabulary file not found at ${vocabPath}, skipping vocabulary addition`);
        //             }
        //         }
        //     } catch (error) {
        //         console.error('❌ Error adding vocabulary to user message:', error.message);
        //         // Continue without vocabulary - optimization will still work if collection is available
        //     }
        // } else if (optimizeEnabled && skipSystemMessage) {
        //     console.log(`📚 Skipping vocabulary (already sent in previous request via previous_response_id)`);
        // }
        
        // Format messages for Responses API
        // systemMessage is already formatted as [{ type: "input_text", text: ... }] from generateDynamicGenerationSystemMessage()
        // userContent is built as an array of { type: "input_text" | "input_image", ... } objects
        // If we have cachedResponseId, ONLY send user message (system already in API context)
        let messages = [];
        
        if (systemMessage && !skipSystemMessage) {
            // Include system message for fresh requests
            messages.push({ 
                role: 'system', 
                content: systemMessage  // Already formatted array
            });
        }
        
        messages.push({ 
            role: 'user', 
            content: userContent  // Already formatted array (includes available memories list + tokenizer vocab)
        });

        // Trace: record AI input messages
        try {
            if (requestId && requestId !== 'dynamic' && requestId !== 'buildOptions') {
                tracing.addEvent(requestId, { type: 'ai_messages_pre', messages });
            }
        } catch {}

        // Send context phase first with all the time/date/season/weather/holiday info
        if (ws && handler) {
            // Format context data properly for carousel display
            const carouselData = formatContextForCarousel(context);
            
            handler.sendToClient(ws, {
                type: 'dynamic_generation_progress_update',
                phase: 'context',
                data: {
                    date: context.time ? {
                        year: context.time.year,
                        month: context.time.month, // 0-based
                        day: context.time.dayOfMonth
                    } : null,
                    time: context.time ? `${String(context.time.hour).padStart(2, '0')}:${String(context.time.minute).padStart(2, '0')}` : new Date().toTimeString().split(' ')[0],
                    season: typeof context.season === 'string' ? context.season : context.season?.season,
                    weather: context.weather,
                    holidayInfo: context.season?.holidayInfo,
                    location: context.location,
                    carousel: carouselData
                },
                timestamp: new Date().toISOString()
            });

            // Then send thinking phase
            setTimeout(() => {
                if (ws && handler) {
                    handler.sendToClient(ws, {
                        type: 'dynamic_generation_progress_update',
                        phase: 'thinking',
                        timestamp: new Date().toISOString()
                    });
                }
            }, 100);
        }

        // Retry loop for text replacement validation (max 5 attempts)
        const maxAttempts = 5;
        let modifiedData = null;
        let lastError = null;
        let previousResponseId = null; // Track response ID for stateful conversation
        let phase1TotalUsage = null; // Track cumulative usage across all Phase 1 attempts
        let initialResponseId = cachedInitialResponseId; // Track initial response ID (for the first full request)
        let isInitialRequest = (cachedResponseId === null); // Determine if this is an initial full request
        let chainRejected = false; // Track if chain was rejected
        let finalCharacterPrompts = characterPrompts; // Declare outside loop to be accessible at return statement
        let apiCalls = []; // Array to track each API call's usage/cost for client display

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt === 0) {
                logger.normal(`🤖 Calling AI for dynamic generation`);
            } else {
                logger.normal(`🤖 Retry attempt ${attempt + 1}/${maxAttempts}`);
            }
            logger.logGeneration('AI_CALL_ATTEMPT', { attempt: attempt + 1, maxAttempts }, requestId);

            // Send retry progress update if this is a retry attempt
            if (attempt > 0 && ws && handler) {
                handler.sendToClient(ws, {
                    type: 'dynamic_generation_progress_update',
                    phase: 'retry',
                    data: {
                        attempt: attempt + 1,
                        maxAttempts: maxAttempts,
                        reason: 'Text replacements failed validation - retrying with corrections'
                    },
                    timestamp: new Date().toISOString()
                });
            }

            // Call AI service with structured output
            const dynamicSchema = createDynamicGenerationResponseSchema(characterPrompts?.length || 0, characterPrompts);
            
            // Build tools dynamically with characterPrompts context for dynamic required fields
            const toolsForThisRequest = getAllToolDefinitions();
            
            // Prepare AI options with temperature from dynamic config
            const aiOptions = {
                model: 'grok-4-fast-reasoning',
                timeout: 30000, // 30 seconds
                liveSearch: true,
                store: true,
                responseSchema: dynamicSchema,
                extractKeys: ['*.reason', '*.reason_display'],  // Extract reasoning and display fields
                totalKeys: getZodSchemaKeyCount(dynamicSchema),  // Dynamically get number of top-level keys
                ws: ws,
                handler: handler,
                requestId: requestId,
                enableOptimize: optimizeEnabled,  // Enable token optimization if optimize flag is set
                buildOptions: { 
                    ...dynamicConfig,
                    // Inject original prompts for tool access (validateTextReplacement)
                    basePrompt: prompt,
                    negativePrompt: uc,
                    characterPrompts: characterPrompts,
                    _requestId: requestId // Pass requestId for logging
                },
                tools: fastModeEnabled ? filterToolsForFastMode(toolsForThisRequest) : toolsForThisRequest,
                toolLoops: fastModeEnabled ? 4 : (dynamicConfig.tool_passes || 8),
            };
            
            // Add previous_response_id for stateful conversation
            // Use cachedResponseId (from config) on first attempt if config unchanged
            // Use previousResponseId (from last attempt) on retry attempts
            let messagesToSend = messages;
            
            if (cachedResponseId && attempt === 0) {
                aiOptions.previous_response_id = cachedResponseId;
                previousResponseId = cachedResponseId; // Initialize for potential retries
                logger.verbose(`🔗 Using cached previous_response_id: ${cachedResponseId}`);
            } else if (attempt > 0 && previousResponseId) {
                aiOptions.previous_response_id = previousResponseId;
                logger.verbose(`🔗 Using previous_response_id for retry: ${previousResponseId}`);
                // On retry with previous_response_id, ONLY send the new retry message, not entire history
                messagesToSend = messages.slice(-1); // Only send the last message (retry request)
            }
            
            const aiResponse = await callDirectorAIWithStructuredOutput(
                messagesToSend,
                aiOptions,
                // Add streaming callback for reasoning updates
                (content, fullResponse, extractedKeys) => {
                    if (ws && handler && extractedKeys && extractedKeys.length > 0) {
                        // Send each extracted reasoning text directly (filter out object/type emissions)
                        extractedKeys.forEach((keyInfo) => {
                            if (keyInfo.value && typeof keyInfo.value === 'string' &&
                                keyInfo.value !== 'object' && keyInfo.type === 'value') {
                                handler.sendToClient(ws, {
                                    type: 'dynamic_generation_progress_update',
                                    phase: 'streaming',
                                    data: {
                                        reason: keyInfo.value
                                    },
                                    timestamp: new Date().toISOString()
                                });
                            }
                        });
                    }
                }
            );

            // Capture response ID for stateful conversation on retries
            if (aiResponse.responseId) {
                previousResponseId = aiResponse.responseId;
                logger.verbose(`✅ Captured response ID: ${previousResponseId}`);
                
                // If this is an initial full request and we don't have an initial response ID yet, capture it
                if (isInitialRequest && !initialResponseId && attempt === 0) {
                    initialResponseId = aiResponse.responseId;
                    logger.verbose(`🆕 Initial response ID: ${initialResponseId}`);
                }
            }

            // Check if rejectChain was called - if so, flag for restart after loop
            if (aiResponse.chainRejected === true) {
                console.log(`🚫 AI rejected chain update - will restart with fresh state`);
                chainRejected = true;
                break;
            }

            // Log and accumulate usage data from this AI call attempt (ALL calls, including failed ones)
            // Note: Even failed calls cost money, so we track them all
            // Handle simplified format (total, input, output, cache, reasoning) or old format (for backward compatibility)
            if (aiResponse?.usage && requestId) {
                const usageData = aiResponse.usage;
                
                // Check if already in simplified format (from grokService)
                let totalTokens, promptTokens, completionTokens, cachedTokens, reasoningTokens;
                if (usageData.total !== undefined) {
                    // Simplified format
                    totalTokens = usageData.total || 0;
                    promptTokens = usageData.input || 0;
                    completionTokens = usageData.output || 0;
                    cachedTokens = usageData.cache || 0;
                    reasoningTokens = usageData.reasoning || 0;
                } else {
                    // Old format - handle both naming conventions: input_tokens/output_tokens (actual API) or prompt_tokens/completion_tokens (docs)
                    const promptDetails = usageData.prompt_tokens_details || usageData.input_tokens_details || null;
                    const completionDetails = usageData.completion_tokens_details || usageData.output_tokens_details || null;
                    
                    totalTokens = usageData.total_tokens || 0;
                    promptTokens = usageData.prompt_tokens || usageData.input_tokens || 0;
                    completionTokens = usageData.completion_tokens || usageData.output_tokens || 0;
                    cachedTokens = promptDetails?.cached_tokens || 0;
                    reasoningTokens = completionDetails?.reasoning_tokens || 0;
                }
                
                // Accumulate usage across all attempts (including failed ones)
                if (!phase1TotalUsage) {
                    phase1TotalUsage = {
                        total: 0,
                        input: 0,
                        output: 0,
                        cache: 0,
                        reasoning: 0,
                        attempts: []
                    };
                }
                phase1TotalUsage.total += totalTokens;
                phase1TotalUsage.input += promptTokens;
                phase1TotalUsage.output += completionTokens;
                phase1TotalUsage.cache += cachedTokens;
                phase1TotalUsage.reasoning += reasoningTokens;
                phase1TotalUsage.attempts.push({
                    attempt: attempt + 1,
                    usage: usageData
                });
                
                // Add individual API calls from AI response (each iteration/tool call is tracked separately)
                // If aiResponse has apiCalls array, use those individual calls, otherwise create a single aggregated entry
                if (aiResponse.apiCalls && Array.isArray(aiResponse.apiCalls) && aiResponse.apiCalls.length > 0) {
                    // Add each individual call with phase and attempt info
                    aiResponse.apiCalls.forEach(call => {
                        apiCalls.push({
                            phase: 'phase1',
                            attempt: attempt + 1,
                            iteration: call.iteration,
                            callType: call.callType || 'request', // 'request' or 'tool_call'
                            timestamp: call.timestamp || Date.now(),
                            duration: call.duration || null, // Duration in milliseconds
                            usage: call.usage,
                            pricing_tier_128k: call.pricing_tier_128k,
                            responseId: call.responseId || aiResponse.responseId || null,
                            toolCalls: call.toolCalls || 0,
                            tools: call.tools || [], // Array of tool information (name, reason, parameters)
                            hasResponseId: call.hasResponseId || false,
                            success: null // Will be set after validation
                        });
                    });
                } else {
                    // Fallback: Create single aggregated entry if apiCalls not available
                    const callEntry = {
                        phase: 'phase1',
                        callType: 'ai_call',
                        attempt: attempt + 1,
                        timestamp: Date.now(),
                        usage: {
                            total: totalTokens,
                            input: promptTokens,
                            output: completionTokens,
                            cache: cachedTokens,
                            reasoning: reasoningTokens
                        },
                        pricing_tier_128k: totalTokens > 128000 ? 'OVER' : (totalTokens > 100000 ? 'NEAR' : 'OK'),
                        responseId: aiResponse.responseId || null,
                        success: null // Will be set after validation
                    };
                    apiCalls.push(callEntry);
                }
                
                logger.logGeneration('AI_CALL_ATTEMPT_USAGE', {
                    attempt: attempt + 1,
                    total: totalTokens,
                    input: promptTokens,
                    output: completionTokens,
                    cache: cachedTokens,
                    reasoning: reasoningTokens,
                    cumulative_total: phase1TotalUsage.total,
                    pricing_tier_128k: totalTokens > 128000 ? 'OVER' : (totalTokens > 100000 ? 'NEAR' : 'OK'),
                    cumulative_pricing_tier_128k: phase1TotalUsage.total > 128000 ? 'OVER' : (phase1TotalUsage.total > 100000 ? 'NEAR' : 'OK')
                }, requestId);
            }
            
            // Trace: record full AI response payload
            try {
                if (requestId && requestId !== 'dynamic' && requestId !== 'buildOptions') {
                    tracing.addEvent(requestId, {
                        type: 'ai_response',
                        raw: aiResponse,
                        usage: aiResponse?.usage || null
                    });
                }
            } catch {}

            // The response is already validated and parsed by the structured output function
            let candidateData = aiResponse.content || aiResponse; // Handle both response formats

            // Trace: record parsed candidate data
            try {
                if (requestId && requestId !== 'dynamic' && requestId !== 'buildOptions') {
                    tracing.addEvent(requestId, {
                        type: 'ai_candidate_data',
                        data: candidateData
                    });
                }
            } catch {}

            // Validate text replacements by attempting to apply them
            let validationResults = {
                prompt: { success: true, failedReplacements: [] },
                uc: { success: true, failedReplacements: [] },
                characterPrompts: []
            };
            
            let allReplacementsValid = true;
            finalCharacterPrompts = characterPrompts; // Reset to original on each attempt (assigned, not declared)

            // Validate prompt replacements
            if (candidateData.text_replacements?.prompt && candidateData.text_replacements.prompt.length > 0) {
                const result = applyDynamicReplacements(prompt, candidateData.text_replacements, 'prompt');
                validationResults.prompt = result;
                if (!result.success) {
                    allReplacementsValid = false;
                }
            }

            // Validate UC replacements
            if (candidateData.text_replacements?.uc && candidateData.text_replacements.uc.length > 0) {
                const result = applyDynamicReplacements(uc, candidateData.text_replacements, 'uc');
                validationResults.uc = result;
                if (!result.success) {
                    allReplacementsValid = false;
                }
            }

            // Validate character prompt replacements
            if (candidateData.text_replacements?.character_prompts && characterPrompts.length > 0) {
                characterPrompts.forEach((char, index) => {
                    const charReplacements = candidateData.text_replacements.character_prompts[index];
                    let charResult = { prompt: { success: true, failedReplacements: [] }, uc: { success: true, failedReplacements: [] } };
                    
                    if (charReplacements?.prompt && charReplacements.prompt.length > 0) {
                        const result = applyDynamicReplacements(char.prompt || '', candidateData.text_replacements, 'character', index, 'prompt');
                        charResult.prompt = result;
                        if (!result.success) {
                            allReplacementsValid = false;
                        }
                    }
                    
                    if (charReplacements?.uc && charReplacements.uc.length > 0) {
                        const result = applyDynamicReplacements(char.uc || '', candidateData.text_replacements, 'character', index, 'uc');
                        charResult.uc = result;
                        if (!result.success) {
                            allReplacementsValid = false;
                        }
                    }
                    
                    validationResults.characterPrompts.push(charResult);
                });
            }

            // Update success status of the last API call based on validation
            if (apiCalls.length > 0) {
                const lastCall = apiCalls[apiCalls.length - 1];
                if (lastCall.phase === 'phase1' && lastCall.attempt === attempt + 1) {
                    lastCall.success = allReplacementsValid;
                }
            }
            
            // If all replacements are valid, check token limits
            if (allReplacementsValid) {
                logger.normal('✅ Replacements validated');
                logger.logGeneration('VALIDATION_SUCCESS', { replacementCount: candidateData.text_replacements ? 
                    (candidateData.text_replacements.prompt?.length || 0) + (candidateData.text_replacements.uc?.length || 0) : 0 
                }, requestId);
                
                // Calculate final texts with replacements applied (needed for token counting and final results)
                const finalPrompt = validationResults.prompt.result || prompt;
                const finalUC = validationResults.uc.result || uc;
                
                // Update finalCharacterPrompts with applied replacements and character names
                finalCharacterPrompts = characterPrompts.map((char, index) => {
                    const charResult = validationResults.characterPrompts[index];
                    const newName = candidateData?.character_names?.[index];
                    
                    return {
                        ...char, // Preserve other properties like center, enabled, etc.
                        prompt: charResult?.prompt?.result || char.prompt || '',
                        uc: charResult?.uc?.result || char.uc || '',
                        // Update name if AI provided a character name for this index
                        name: newName || char.name
                    };
                });
                
                // Log generated image name
                if (candidateData.generated_image_name) {
                    console.log(`🖼️ Generated image name: "${candidateData.generated_image_name}"`);
                }
                
                // Log character name updates
                if (candidateData.character_names && candidateData.character_names.length > 0) {
                    console.log('✨ Character names updated:');
                    candidateData.character_names.forEach((name, index) => {
                        const oldName = characterPrompts[index]?.name || 'Unknown';
                        if (name && name !== oldName) {
                            console.log(`   Character ${index + 1}: "${oldName}" → "${name}"`);
                        }
                    });
                }
                
                // Apply replacements to get final text and check token counts if token counting is enabled
                if (tokenCountEnabled) {
                    try {
                        
                        // Count tokens on final texts
                        const t5TokenizerService = globalResources.getT5Tokenizer();
                        const finalPromptTokens = t5TokenizerService.countTokens(finalPrompt);
                        const finalUCTokens = t5TokenizerService.countTokens(finalUC);
                        
                        const finalCharacterTokenCounts = finalCharacterPrompts.map(char => ({
                            prompt: t5TokenizerService.countTokens(char.prompt),
                            uc: t5TokenizerService.countTokens(char.uc)
                        }));
                        
                        const finalTotalPromptTokens = finalPromptTokens + finalCharacterTokenCounts.reduce((sum, char) => sum + char.prompt, 0);
                        const finalTotalUCTokens = finalUCTokens + finalCharacterTokenCounts.reduce((sum, char) => sum + char.uc, 0);
                        
                        // Summarized console output
                        logger.normal(`📊 Tokens: ${finalTotalPromptTokens}/512 prompt (${Math.round((finalTotalPromptTokens / 512) * 100)}%) | ${finalTotalUCTokens}/512 UC (${Math.round((finalTotalUCTokens / 512) * 100)}%)`);
                        
                        // Detailed file logging
                        logger.logGeneration('FINAL_TOKEN_COUNTS', {
                            basePrompt: finalPromptTokens,
                            negativePrompt: finalUCTokens,
                            characterPrompts: finalCharacterTokenCounts,
                            totalPrompts: finalTotalPromptTokens,
                            totalUC: finalTotalUCTokens,
                            percentUsed: {
                                prompts: Math.round((finalTotalPromptTokens / 512) * 100),
                                uc: Math.round((finalTotalUCTokens / 512) * 100)
                            }
                        }, requestId);
                        
                        // Verbose console output
                        if (logger.shouldLog(logger.VERBOSITY_LEVELS.VERBOSE)) {
                            console.log(`   Base Prompt: ${finalPromptTokens} tokens`);
                            console.log(`   Negative Prompt: ${finalUCTokens} tokens`);
                            if (finalCharacterPrompts.length > 0) {
                                finalCharacterTokenCounts.forEach((char, idx) => {
                                    console.log(`   Character ${idx + 1}: ${char.prompt} prompt tokens, ${char.uc} UC tokens`);
                                });
                            }
                        }
                        
                        // If token limit exceeded and we have more attempts, ask AI to reduce
                        if ((finalTotalPromptTokens > 512 || finalTotalUCTokens > 512) && attempt < maxAttempts - 1) {
                            console.warn(`⚠️ Token limit exceeded after applying replacements! Prompt: ${finalTotalPromptTokens}/512, UC: ${finalTotalUCTokens}/512`);
                            console.warn(`Requesting AI to reduce token usage on attempt ${attempt + 2}...`);
                            
                            // Only add assistant's response if we DON'T have previous_response_id
                            // With previous_response_id, the API already has the full conversation context
                            if (!previousResponseId) {
                                messages.push({
                                    role: 'assistant',
                                    content: [{
                                        type: 'output_text',
                                        text: JSON.stringify(candidateData)
                                    }]
                                });
                            }
                            
                            // Build token reduction request message
                            const tokenReductionMessage = {
                                role: 'user',
                                content: [
                                    {
                                        type: 'input_text',
                                        text: [
                                            '🚨 **TOKEN LIMIT EXCEEDED** - Modifications required',
                                            `Attempt ${attempt + 2} of ${maxAttempts}`,
                                            '',
                                            '## ⚠️ CRITICAL: Applied Prompts Exceed Token Limit',
                                            '🔄 **After applying your text replacements, the final prompts exceed the 512 token limit**',
                                            '🔄 **You must recreate your text replacements to REDUCE token usage**',
                                            '',
                                            '## Current Token Usage (AFTER your replacements):',
                                            `**Base Prompt**: ${finalPromptTokens} tokens`,
                                            `**Negative Prompt**: ${finalUCTokens} tokens`,
                            finalCharacterPrompts.length > 0 ? finalCharacterTokenCounts.map((char, idx) =>
                                `**Character ${idx + 1}**: ${char.prompt} prompt tokens, ${char.uc} UC tokens`
                            ).join('\n') : '',
                                            `**TOTAL Prompt Tokens**: ${finalTotalPromptTokens} / 512 ${finalTotalPromptTokens > 512 ? '⚠️ OVER LIMIT!' : ''}`,
                                            `**TOTAL UC Tokens**: ${finalTotalUCTokens} / 512 ${finalTotalUCTokens > 512 ? '⚠️ OVER LIMIT!' : ''}`,
                                            '',
                                            finalTotalPromptTokens > 512 ? `🚨 **You are ${finalTotalPromptTokens - 512} tokens OVER the limit for prompts!**` : '',
                                            finalTotalUCTokens > 512 ? `🚨 **You are ${finalTotalUCTokens - 512} tokens OVER the limit for UC!**` : '',
                                            '',
                                            '## ORIGINAL Prompt State (UNMODIFIED)',
                                            '⚠️ **CRITICAL**: These are the ORIGINAL prompts BEFORE any modifications. Create NEW text replacements that REDUCE token count.',
                                            '',
                                            '**Base Prompt (ORIGINAL):**',
                                            prompt || 'No base prompt provided',
                                            '',
                                            '**Negative Prompt (ORIGINAL):**',
                                            uc || 'No negative prompt provided',
                                            '',
                                            '**Character Prompts (ORIGINAL):**',
                                            characterPrompts.length > 0 ?
                                                characterPrompts.map((char, index) =>
                                                    `Character ${index + 1} (${char.chara_name || 'Unnamed'}):\n  Prompt: ${char.prompt || 'No prompt'}\n  UC: ${char.uc || 'No UC'}`
                                                ).join('\n\n') :
                                                'No character prompts provided',
                                            '',
                                            '## 🚨 Token Reduction Requirements',
                                            '**Your modifications added too many tokens. You need to be more efficient:**',
                                            '',
                                            '1. **Merge descriptions** - Combine related elements into concise descriptions',
                                            '2. **Use stronger single-token alternatives** - Replace weak multi-token phrases when possible',
                                            '3. **Remove true redundancy** - Eliminate duplicate or genuinely unnecessary descriptors',
                                            '4. **Prioritize impactful changes** - Keep the most visually important modifications',
                                            '5. **Condense verbose phrases** - Shorter phrasing with same meaning',
                                            '',
                                            '**IMPORTANT**: Don\'t delete meaningful content - find more efficient ways to express the same ideas.',
                                            '',
                                            '## Example of Token Reduction:',
                                            '❌ **Before (verbose)**:',
                                            '   "standing on the sidewalk looking at her phone with a contemplative expression on her face"',
                                            '',
                                            '✅ **After (concise)**:',
                                            '   "contemplative pose examining phone on sidewalk"',
                                            '',
                                            '**Goal**: Create text replacements that enhance the prompt while STAYING UNDER the 512 token limit.'
                                        ].filter(Boolean).join('\n')
                                    }
                                ]
                            };
                            
                            // Only push to messages array if we're NOT using previous_response_id
                            // With previous_response_id, we'll send just this message in the next iteration
                            if (!previousResponseId) {
                                messages.push(tokenReductionMessage);
                            } else {
                                // Replace messages array with just the retry message for next iteration
                                messages = [tokenReductionMessage];
                            }
                            
                            // Send progress update
                            if (ws && handler) {
                                handler.sendToClient(ws, {
                                    type: 'dynamic_generation_progress_update',
                                    phase: 'retry',
                                    data: {
                                        attempt: attempt + 2,
                                        maxAttempts: maxAttempts,
                                        reason: `Token limit exceeded (Prompt: ${finalTotalPromptTokens}/512, UC: ${finalTotalUCTokens}/512) - requesting reduction`
                                    },
                                    timestamp: new Date().toISOString()
                                });
                            }
                            
                            // Continue to next attempt
                            continue;
                        }
                    } catch (error) {
                        console.error('❌ Failed to count tokens on final text:', error);
                        // Continue anyway, don't fail the entire process
                    }
                }
                
                modifiedData = candidateData;
                
                // Auto-save insight_memory entries as global knowledge memories (only on validation pass)
                autoSaveInsightMemories(modifiedData.insight_memory, 'Phase 1');
                
                break;
            }

            // If we have more attempts, construct a correction message
            if (attempt < maxAttempts - 1) {
                console.warn(`⚠️ Text replacements failed validation on attempt ${attempt + 1}, constructing correction message...`);
                
                // Only add assistant's response to conversation history if we DON'T have previous_response_id
                // With previous_response_id, the API already has the full conversation context
                if (!previousResponseId) {
                    messages.push({
                        role: 'assistant',
                        content: [{
                            type: 'output_text',
                            text: JSON.stringify(candidateData)
                        }]
                    });
                }
                
                // Collect all failed replacements
                const allFailedReplacements = [];
                if (!validationResults.prompt.success) {
                    allFailedReplacements.push(...validationResults.prompt.failedReplacements.map(text => ({ type: 'prompt', text })));
                }
                if (!validationResults.uc.success) {
                    allFailedReplacements.push(...validationResults.uc.failedReplacements.map(text => ({ type: 'uc', text })));
                }
                validationResults.characterPrompts.forEach((charResult, index) => {
                    if (!charResult.prompt.success) {
                        allFailedReplacements.push(...charResult.prompt.failedReplacements.map(text => ({ type: `character_${index}_prompt`, text })));
                    }
                    if (!charResult.uc.success) {
                        allFailedReplacements.push(...charResult.uc.failedReplacements.map(text => ({ type: `character_${index}_uc`, text })));
                    }
                });

                // Build correction message - Responses API format
                const correctionMessage = {
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: [
                                '🔧 **CORRECTION REQUIRED** - Previous replacements failed validation',
                                `Attempt ${attempt + 2} of ${maxAttempts}`,
                                '',
                                '## ⚠️ CRITICAL: Prompts Have Been RESTORED',
                                '🔄 **ALL your previous text replacements have been DISCARDED**',
                                '🔄 **The prompts below are in their ORIGINAL, UNMODIFIED state**',
                                '🔄 **You must recreate ALL text replacements from scratch using ONLY the original text shown below**',
                                '',
                                '## Why Previous Attempt Failed',
                                'The following selectors were not valid and will not apply:',
                                ...allFailedReplacements.map(item => `- This selector '${item.text}' [${item.type}] was not valid and will not apply`),
                                '',
                                '**Common Causes**:',
                                '  1. **Overlapping replacements**: You tried to select text that spans across segments already modified by earlier replacements',
                                '  2. **Chained replacements**: You created replacement B that depends on replacement A\'s output text',
                                '  3. **Text doesn\'t exist**: The select_text was not found in the original prompt (typo, extra spaces, wrong punctuation)',
                                '',
                                '**FORBIDDEN**: All replacements must target text from the ORIGINAL prompt only, with NO dependencies on other replacements.',
                                '',
                                '## ORIGINAL Prompt State (UNMODIFIED)',
                                '⚠️ **CRITICAL**: These are the ORIGINAL prompts BEFORE any modifications. Every `select_text` must appear VERBATIM in these prompts.',
                                '',
                                '**Base Prompt (ORIGINAL):**',
                                prompt || 'No base prompt provided',
                                '',
                                '**Negative Prompt (ORIGINAL):**',
                                uc || 'No negative prompt provided',
                                '',
                                '**Character Prompts (ORIGINAL):**',
                                characterPrompts.length > 0 ?
                                    characterPrompts.map((char, index) =>
                                        `Character ${index + 1} (${char.name || 'Unnamed'}):\n  Prompt: ${char.prompt || 'No prompt'}\n  UC: ${char.uc || 'No UC'}`
                                    ).join('\n\n') :
                                    'No character prompts provided',
                                '',
                                '## 🚨 MANDATORY Correction Requirements',
                                '1. **ONLY use text from ORIGINAL prompts above** - No text that you added in previous attempts',
                                '2. **NO replacement stacking/chaining** - Each replacement must be completely independent',
                                '3. **Copy text EXACTLY** - Match spacing, punctuation, case, and special characters VERBATIM',
                                '4. **Recreate ALL replacements from scratch** - Start fresh, don\'t try to "fix" the previous attempt',
                                '5. **If text doesn\'t exist in ORIGINAL**, use `action: "append"` instead of replace',
                                '6. **Make atomic replacements** - Replace small, specific pieces of text, not large blocks',
                                '7. **Verify each select_text** - Before adding a replacement, visually confirm the text exists in the ORIGINAL prompts above',
                                '',
                                '## Example of What Went Wrong vs. What To Do',
                                '',
                                '❌ **WRONG - Chained Replacement (causes failures)**:',
                                '   Original: "standing on sidewalk"',
                                '   Replacement 1: "standing on sidewalk" → "pausing on sidewalk to check phone"',
                                '   Replacement 2: "pausing on sidewalk to check phone" → "contemplative pose examining phone"  ← FAILS! This text doesn\'t exist in ORIGINAL',
                                '',
                                '❌ **WRONG - Overlapping Replacement (causes failures)**:',
                                '   Original: "sitting in chair, arm on armrest"',
                                '   Replacement 1: "sitting in chair" → "lounging in throne"  (changes prompt to "lounging in throne, arm on armrest")',
                                '   Replacement 2: "chair, arm on armrest" → "throne with golden armrest"  ← FAILS! "chair" was already changed to "throne"',
                                '',
                                '✅ **CORRECT - Atomic Independent Replacements (will work)**:',
                                '   Original: "sitting in chair, arm on armrest"',
                                '   Replacement 1: "sitting in chair" → "lounging in ornate throne"',
                                '   Replacement 2: "arm on armrest" → "arm resting on golden armrest"',
                                '   (Both target independent, non-overlapping segments from ORIGINAL)',
                                '',
                                '✅ **CORRECT - Single Large Replacement (will work)**:',
                                '   Original: "standing on sidewalk"',
                                '   Replacement 1: "standing on sidewalk" → "contemplative pose examining phone while pausing on busy street"',
                                '   (Single atomic replacement, targets ORIGINAL text only)'
                            ].join('\n')
                        }
                    ]
                };

                // With previous_response_id, we ONLY send the correction message (API has full context)
                // Without it, we add the correction to the conversation history
                if (previousResponseId) {
                    // Replace messages with ONLY the correction message - API already has context
                    messages = [correctionMessage];
                    console.log(`🔗 Using previous_response_id - sending only correction message (API has full context)`);
                } else {
                    // No previous_response_id - add correction to full conversation history
                    messages.push(correctionMessage);
                }
                
                // Store error for potential final failure
                lastError = `Failed to validate text replacements after ${attempt + 1} attempt(s): ${allFailedReplacements.map(f => f.text).join(', ')}`;
            } else {
                // Last attempt failed
                lastError = `Failed to validate text replacements after ${maxAttempts} attempts`;
                console.error(`❌ ${lastError}`);
            }
        }

        // If chain was rejected, return with chainRejected flag so caller can retry
        if (chainRejected) {
            console.log(`🔄 Chain rejected - returning to caller for restart with clean state`);
            
            return {
                success: false,
                chainRejected: true,
                error: 'Chain update rejected by AI',
                dialogs: [],
                processed: false
            };
        }

        // If we exhausted all attempts without success, return error
        if (!modifiedData) {
            return {
                success: false,
                error: lastError || 'Failed to generate valid text replacements',
                dialogs: [], // Empty dialogs on error
                processed: false
            };
        }

        logger.normal('✅ Dynamic generation Phase 1 completed');
        logger.logGeneration('PHASE_1_COMPLETE', modifiedData, requestId);

        // Prepare Phase 1 results
        const phase1Results = {
            success: true,
            prompt: prompt, // Store original prompt for hash validation
            uc: uc, // Store original UC for hash validation
            characterPrompts: characterPrompts, // Store original character prompts for hash validation
            modifiedCharacterPrompts: finalCharacterPrompts, // Store modified character prompts for application
            text_replacements: modifiedData.text_replacements,
            dialogs: modifiedData.dialogs || [],
            generated_image_name: modifiedData.generated_image_name || null, // Suggested image name
            character_names: modifiedData.character_names || null, // Suggested character names
            context: context,
            processed: true,
            previousResponseId: previousResponseId,
            initialResponseId: initialResponseId, // Save initial response ID separately
            request_hash: currentRequestHash, // Include request hash for cache validation
            prompt_hash: currentPromptHash, // Include prompt hash for cache validation
            directive_hash: currentDirectiveHash, // Include directive hash for separate tracking
            timestamp: Date.now(), // Add timestamp for cache expiration checks
            generation_chain: generationChainNumber, // Current generation in chain
            errors: modifiedData.errors || [], // AI-registered errors
            warnings: modifiedData.warnings || [], // AI-registered warnings
            isOptimized: false,
            applied_preset_controls: appliedPresetControls, // Pass through preset controls for client use
            apiCalls: apiCalls // Include Phase 1 API calls for usage tracking
        };

        // Check if Phase 2 (optimization) should run - only in 2-stage mode
        let finalResults = phase1Results;

        if (dynamicConfig.optimize?.tokenCount === true && dynamicConfig.optimize?.twoStage === true) {
            console.log('🔧 Running Phase 2 optimization pass (2-stage mode)...');

            try {
                // Run Phase 2 optimization
                finalResults = await processDynamicGenerationPhase2(
                    phase1Results,
                    dynamicConfig,
                    prompt,
                    uc,
                    characterPrompts,
                    requestId,
                    ws,
                    handler,
                    wsServer,
                    context,
                    datasetConfig
                );
                
                // Merge Phase 2 apiCalls with Phase 1 apiCalls and update finalResults
                if (finalResults.apiCalls && Array.isArray(finalResults.apiCalls)) {
                    apiCalls = apiCalls.concat(finalResults.apiCalls);
                    // Update finalResults to include all API calls (both phase1 and phase2)
                    finalResults.apiCalls = apiCalls;
                } else {
                    // If phase2 didn't return apiCalls, ensure finalResults has phase1 calls
                    finalResults.apiCalls = apiCalls;
                }

                console.log('✅ Phase 2 optimization completed successfully');
            } catch (phase2Error) {
                console.error('❌ Phase 2 optimization failed, using Phase 1 results:', phase2Error.message);

                // Send Phase 2 error update
                if (ws && handler) {
                    handler.sendToClient(ws, {
                        type: 'dynamic_generation_progress_update',
                        phase: 'optimization_error',
                        data: {
                            error: phase2Error.message,
                            fallback: 'Using Phase 1 results'
                        },
                        timestamp: new Date().toISOString()
                    });
                }

                // Keep Phase 1 results as fallback
                finalResults = {
                    ...phase1Results,
                    phase2Error: phase2Error.message,
                    isOptimized: false,
                    apiCalls: apiCalls // Ensure apiCalls is included even on phase2 error
                };
            }
        } else {
            if (dynamicConfig.optimize?.tokenCount === true && dynamicConfig.optimize?.twoStage === false) {
                console.log('⚡ Single-stage mode - Phase 2 optimization skipped');
            } else {
                console.log('⚡ Optimization disabled, skipping Phase 2');
            }
            // Ensure finalResults has apiCalls when Phase 2 doesn't run
            if (!finalResults.apiCalls) {
                finalResults.apiCalls = apiCalls;
            }
        }

        // Accumulate usage data from all phases
        // Use finalResults.apiCalls which should contain both phase1 and phase2 calls
        const allApiCalls = finalResults.apiCalls && Array.isArray(finalResults.apiCalls) ? finalResults.apiCalls : [];
        
        // Debug: Log apiCalls state
        logger.detailed(`💾 Accumulating usage data: allApiCalls.length=${allApiCalls.length}, phase1=${allApiCalls.filter(c => c.phase === 'phase1').length}, phase2=${allApiCalls.filter(c => c.phase === 'phase2').length}`);
        
        let totalUsageData = null;
        
        // Get usage from Phase 1 - calculate from apiCalls array
        const phase1CallsForTotal = allApiCalls.filter(call => call.phase === 'phase1');
        if (phase1CallsForTotal.length > 0) {
            totalUsageData = {
                total: 0,
                input: 0,
                output: 0,
                cache: 0,
                reasoning: 0
            };
            phase1CallsForTotal.forEach(call => {
                if (call.usage) {
                    totalUsageData.total += call.usage.total || 0;
                    totalUsageData.input += call.usage.input || 0;
                    totalUsageData.output += call.usage.output || 0;
                    totalUsageData.cache += call.usage.cache || 0;
                    totalUsageData.reasoning += call.usage.reasoning || 0;
                } else {
                    logger.detailed(`⚠️ Phase 1 call missing usage data: ${JSON.stringify(call)}`);
                }
            });
        }
        
        // Get usage for totalUsage based on the last call's usage (stateful APIs return cumulative totals)
        // Prefer the last call with usage data regardless of phase. If none found, keep null.
        const lastCallWithUsage = [...allApiCalls].reverse().find(call => call && call.usage);
        totalUsageData = lastCallWithUsage ? {
            total: lastCallWithUsage.usage.total || 0,
            input: lastCallWithUsage.usage.input || 0,
            output: lastCallWithUsage.usage.output || 0,
            cache: lastCallWithUsage.usage.cache || 0,
            reasoning: lastCallWithUsage.usage.reasoning || 0
        } : totalUsageData || null;
        
        // Add total usage and structured usage data to final results for saving to compiled_prompt
        finalResults.totalUsage = totalUsageData || null;
        
        // Debug: Log what we calculated
        logger.detailed(`💾 Calculated totalUsage: ${totalUsageData ? JSON.stringify(totalUsageData) : 'null'}`);
        
        // Structure usage data with phase1 and phase2 objects
        const structuredUsage = {
            phase1: {
                total: null,
                calls: []
            },
            phase2: {
                total: null,
                calls: []
            }
        };
        
        // Group apiCalls by phase and calculate phase totals
        // Use finalResults.apiCalls which should contain both phase1 and phase2 calls
        const phase1Calls = allApiCalls.filter(call => call.phase === 'phase1');
        const phase2Calls = allApiCalls.filter(call => call.phase === 'phase2');
        
        // Calculate Phase 1 total based on the last call's usage for that phase
        if (phase1Calls.length > 0) {
            const lastPhase1WithUsage = [...phase1Calls].reverse().find(call => call && call.usage);
            structuredUsage.phase1.total = lastPhase1WithUsage ? {
                total: lastPhase1WithUsage.usage.total || 0,
                input: lastPhase1WithUsage.usage.input || 0,
                output: lastPhase1WithUsage.usage.output || 0,
                cache: lastPhase1WithUsage.usage.cache || 0,
                reasoning: lastPhase1WithUsage.usage.reasoning || 0
            } : null;
            structuredUsage.phase1.calls = phase1Calls;
        }
        
        // Calculate Phase 2 total based on the last call's usage for that phase
        if (phase2Calls.length > 0) {
            const lastPhase2WithUsage = [...phase2Calls].reverse().find(call => call && call.usage);
            structuredUsage.phase2.total = lastPhase2WithUsage ? {
                total: lastPhase2WithUsage.usage.total || 0,
                input: lastPhase2WithUsage.usage.input || 0,
                output: lastPhase2WithUsage.usage.output || 0,
                cache: lastPhase2WithUsage.usage.cache || 0,
                reasoning: lastPhase2WithUsage.usage.reasoning || 0
            } : null;
            structuredUsage.phase2.calls = phase2Calls;
        }
        
        // Only include phases that have data
        if (structuredUsage.phase1.total === null && structuredUsage.phase1.calls.length === 0) {
            delete structuredUsage.phase1;
        }
        if (structuredUsage.phase2.total === null && structuredUsage.phase2.calls.length === 0) {
            delete structuredUsage.phase2;
        }
        
        // Add structured usage to final results (only if we have at least one phase with data)
        // If both phases are empty, set usage to null
        if (Object.keys(structuredUsage).length === 0 || (!structuredUsage.phase1 && !structuredUsage.phase2)) {
            finalResults.usage = null;
            logger.detailed(`⚠️ No structured usage data - both phases empty or no data`);
        } else {
            finalResults.usage = structuredUsage;
        }
        
        // Ensure apiCalls is included in finalResults (should already be set, but double-check)
        if (!finalResults.apiCalls && allApiCalls.length > 0) {
            finalResults.apiCalls = allApiCalls;
            logger.detailed(`💾 Added apiCalls to finalResults: ${allApiCalls.length} calls`);
        }
        
        // Debug: Verify usage is set
        logger.detailed(`💾 Final results usage data: totalUsage=${finalResults.totalUsage ? JSON.stringify(finalResults.totalUsage) : 'null'}, usage=${finalResults.usage ? JSON.stringify(finalResults.usage) : 'null'}`);
        logger.detailed(`💾 Final results has apiCalls: ${!!finalResults.apiCalls}, length: ${finalResults.apiCalls?.length || 0}`);
        
        // Log total usage to detailed generation log
        if (totalUsageData && requestId) {
            const totalTokens = totalUsageData.total || 0;
            logger.logGeneration('DYNAMIC_GENERATION_TOTAL_USAGE', {
                phase1Usage: phase1Results.phase1Usage || null,
                phase1TotalUsage: phase1Results.phase1TotalUsage || null, // Cumulative usage from all Phase 1 attempts
                phase2Usage: finalResults.phase2Usage || null,
                totalUsage: totalUsageData,
                total: totalTokens,
                input: totalUsageData.input || 0,
                output: totalUsageData.output || 0,
                cache: totalUsageData.cache || 0,
                reasoning: totalUsageData.reasoning || 0,
                phasesCompleted: dynamicConfig.optimize?.tokenCount === true ? 2 : 1,
                pricing_tier_128k: totalTokens > 128000 ? 'OVER' : (totalTokens > 100000 ? 'NEAR' : 'OK')
            }, requestId);
        }
        
        // Send final completion update
        if (ws && handler) {
            handler.sendToClient(ws, {
                type: 'dynamic_generation_progress_update',
                phase: 'completion',
                data: {
                    phasesCompleted: dynamicConfig.optimize?.tokenCount === true ? 2 : 1,
                    optimized: finalResults.isOptimized || false,
                    usage: totalUsageData || null
                },
                timestamp: new Date().toISOString()
            });
        }

        // Return processed results (same structure as WebSocket response)
        // Note: text replacement application is now handled in buildOptions
        return finalResults;

    } catch (error) {
        console.error('❌ Dynamic generation core error:', error);
        
        // Check if this is a JSON parsing error that should trigger chain restart
        const isParsingError = error.message && error.message.includes('JSON parsing failed for structured response');
        
        if (isParsingError) {
            console.log('🔄 JSON parsing failed - setting chainRejected to restart generation with clean state');
            return {
                success: false,
                chainRejected: true,
                error: error.message || 'JSON parsing failed - restarting generation',
                dialogs: [], // Empty dialogs on error
                processed: false
            };
        }
        
        // Return error structure (same as WebSocket error response)
        return {
            success: false,
            error: error.message || 'Dynamic generation processing failed',
            dialogs: [], // Empty dialogs on error
            processed: false
        };
    }
}

/**
 * Phase 2: Token Optimization & Quality Refinement Pass
 * Uses previous response ID and adds optimization tools
 * @param {Object} phase1Results - Results from Phase 1 processing
 * @param {Object} dynamicConfig - Dynamic configuration object
 * @param {string} prompt - Original base prompt
 * @param {string} uc - Original negative prompt
 * @param {Array} characterPrompts - Character prompts array
 * @param {string} requestId - Request ID for tracking
 * @param {Object} ws - WebSocket connection
 * @param {Object} handler - WebSocket handler
 * @param {Object} wsServer - WebSocket server
 * @param {Object} context - Compiled context
 * @param {Object} datasetConfig - Dataset configuration
 * @returns {Object} Optimized results
 */
async function processDynamicGenerationPhase2(phase1Results, dynamicConfig, prompt, uc, characterPrompts, requestId, ws, handler, wsServer, context, datasetConfig) {
    const maxAttempts = 3;
    let previousResponseId = phase1Results.previousResponseId;
    const generationChainNumber = (dynamicConfig.compiled_prompt?.generation_chain || 0) + 1;
    
    // Track Phase 2 API calls separately
    let phase2ApiCalls = [];
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            console.log(`🔧 Processing Phase 2 optimization (attempt ${attempt + 1}/${maxAttempts}): ${requestId}`);

            // Send Phase 2 progress update
            if (ws && handler) {
                handler.sendToClient(ws, {
                    type: 'dynamic_generation_progress_update',
                    phase: 'optimization',
                    data: {
                        phase: 2,
                        totalPhases: 2,
                        attempt: attempt + 1,
                        maxAttempts: maxAttempts,
                        description: attempt === 0 ? 'Optimizing tokens and refining quality' : `Retry ${attempt}: Fixing validation errors`
                    },
                    timestamp: new Date().toISOString()
                });
            }

            
            // Build Phase 2 message - continuation of conversation
            const isRetry = attempt > 0;
            
            // Initialize validationResults outside for retry access
            let validationResults = {
                prompt: { success: true, failedReplacements: [] },
                uc: { success: true, failedReplacements: [] },
                characterPrompts: []
            };
            
            const phase2Message = {
                type: "input_text",
                text: (isRetry ? [
                    '# 🔧 PHASE 2 RETRY: FIX VALIDATION ERRORS',
                    '',
                    '## Previous Attempt Failed',
                    'Your last Phase 2 response had validation errors. The text replacements could not be applied.',
                    '',
                    '**Validation Errors:**',
                    validationResults.prompt && !validationResults.prompt.success ? 
                        `• **Prompt failures**: ${validationResults.prompt.failedReplacements.join(', ')}` : '',
                    validationResults.uc && !validationResults.uc.success ?
                        `• **UC failures**: ${validationResults.uc.failedReplacements.join(', ')}` : '',
                    validationResults.characterPrompts?.some(c => !c.prompt.success || !c.uc.success) ?
                        `• **Character failures**: Check character prompt replacements` : '',
                    '',
                    '• Look for "# 🎯 PHASE 1: CONTEXT INTEGRATION" in your conversation history',
                    '• Look for "# 🔧 PHASE 2: TOKEN OPTIMIZATION" for your previous attempt',
                    '• Review what you proposed and what failed',
                    '',
                    '**YOUR TASK:**',
                    '1. **Review conversation history** - Find Phase 1 and previous Phase 2 tagged responses',
                    '2. **Call tools to validate** - Use `validateTextReplacement` to test before submitting',
                    '3. **Fix validation errors** - Adjust select_text to match ORIGINAL prompts',
                    '4. **Return COMPLETE arrays** - All replacements needed (not incremental changes)',
                    '',
                    '**CRITICAL:** Don\'t regenerate from scratch. Build on your previous work from conversation history.',
                ].filter(Boolean) : [
                    '# 🔧 PHASE 2: TOKEN OPTIMIZATION & QUALITY REFINEMENT',
                    '',
                    '## Previous Phase Results',
                    'You have successfully completed Phase 1 (context integration and directive processing). Now perform Phase 2 optimization:',
                    '',
                    '**IMPORTANT CONTEXT:**',
                    '• You can access ALL your previous responses via conversation history',
                    '• Look for "# 🎯 PHASE 1: CONTEXT INTEGRATION" to find your Phase 1 response',
                    '• This is an ongoing series of requests - leverage your full conversation history',
                    '',
                    '**CRITICAL UNDERSTANDING:**',
                    '• Phase 1 replacements were proposed but NOT applied to prompts',
                    '• You must reason about Phase 1 + create optimized complete replacement arrays',
                    '• Validate against ORIGINAL prompts using tools',
                    '',
                    '## Phase 2 Objectives',
                    ]).concat([
                    '1. **MANDATORY: Call Tools First** - DO NOT generate text responses. Start by calling optimization tools.',
                    '2. **Token Optimization**: Use the T5 tokenizer vocabulary to optimize ALL prompts',
                    '3. **Quality Refinement**: Improve the effectiveness of Phase 1 replacements',
                    '4. **Validation**: Ensure all replacements work correctly',
                    '',
                    '**🚨 CRITICAL INSTRUCTION: Your response MUST start with tool calls, not text.**',
                    '',
                    '**REQUIRED WORKFLOW - Execute these tool calls in order:**',
                    '',
                    '**1. `analyzeTokenCount` - CALL THIS FIRST**',
                    '```javascript',
                    'analyzeTokenCount({',
                    '  texts: [currentPrompt, currentNegativePrompt, ...characterPrompts],',
                    '  includeBreakdown: true',
                    '})',
                    '```',
                    '',
                    '**2. `validateTextReplacement` - CALL THIS SECOND**',
                    '```javascript',
                    'validateTextReplacement({',
                    '  textReplacements: { prompt: [...], uc: [...], character_prompts: [...] }',
                    '})',
                    '// NOTE: basePrompt/negativePrompt/characterPrompts injected automatically',
                    '```',
                    '',
                    '**DO NOT generate any text until tools complete their analysis.**',
                    '',
                    '## Available Tools',
                    'You now have access to optimization tools:',
                    '',
                    '**`analyzeTokenCount`** - Quick token analysis for multiple text strings',
                    '• Input: Array of text strings to analyze',
                    '• Output: Token counts, efficiency ratings, and optional detailed breakdowns',
                    '• Use: A/B testing different prompt versions, checking token limits',
                    '',
                    '**`validateTextReplacement`** - Comprehensive replacement validation with token counting',
                    '• Input: textReplacements object (system automatically provides basePrompt/negativePrompt/characterPrompts)',
                    '• Output: Validation results, applied replacements, token analysis (original vs modified)',
                    '• **REQUIRED**: You MUST use this to validate all replacements before submitting',
                    '• **CRITICAL**: If validation fails, you MUST fix the reported issues and call this tool again - failures cannot be ignored',
                    '• **terminateOnPass=true**: Use ONLY when ready to complete with ALL replacements AND you expect all validations to pass - if validation passes, auto-completes without needing completeTooling()',
                    '• **For testing**: Call WITHOUT terminateOnPass to validate during your work',
                    '',
                    '**Tag Search Tools (USE THESE FOR TAG RESEARCH)**:',
                    ...(secureConfig.grok?.tagWikiCollectionId ? [
                        '• `file_search` ⭐ - PRIMARY: Search comprehensive tag wiki collection (replaces all local tag tools)',
                        '  - Read wiki entries with descriptions and context',
                        '  - More efficient than local tools - single search covers all tag information',
                        '• `searchTagDatabase` - NovelAI official API (model-specific)',
                    ] : [
                        '• `searchTagsBatch` - ⭐ PREFERRED: Batch lookup multiple tags efficiently',
                        '• `getTagDetails` - ⭐ PREFERRED: Read tag descriptions and usage information',
                        '• `resolveTagLinks` - ⭐ PREFERRED: Check tag relations and find alternatives',
                        '• `suggestBetterTags` - AI-powered tag improvement and alternative suggestions',
                        '• `searchByDescription` - Natural language tag discovery and matching',
                        '• `getBodyChunk` - Paginated access to detailed tag descriptions',
                        '• `searchTagDatabase` - Individual tag search (prefer searchTagsBatch for multiple tags)',
                    ]),
                    '',
                    '**Optimization Tools**:',
                    '• `searchTagDatabase` - Search the Official NovelAI API tag search (with model-aware results), Danbooru tags, and e621 tags',
                    '',
                    '**Optional Web Tools**:',
                    ...(secureConfig.grok?.useWebSearch === true ? [
                        '• `web_search` ⭐ - Search the web with image understanding for current events, recent data, or information not available in the tag database',
                        '• `x_search` ⭐ - Search X/Twitter with image understanding for current data, trends',
                        '  - More efficient than local tools - Web search and social media search with image understanding',
                    ] : [
                        '• Use these tools ONLY when user explicitly provides URLs or you have gathered a url from the results of a tool and need to view the content for analysis',
                        '• `webSearch` - OPTIONAL: Current events, recent data, trends (Exa API)',
                        '• `fetchUrl` - OPTIONAL: Fetch and extract text from a URL',
                        '• `fetchImage` - OPTIONAL: Download and analyze images from URLs',
                    ]),
                    '',
                    '**Required Tool**:',
                    '• `completeTooling` - Call this when you have gathered all necessary information from tools and are ready to provide the final structured response. This signals that tool usage is complete and the system should expect your structured output.',
                    '',
                    '## Token Optimization Requirements',
                    '**MANDATORY**: Optimize ALL prompts during this pass by:',
                    '',
                    '**1. Analyze Current Token Usage**:',
                    '```javascript',
                    'analyzeTokenCount({',
                    '  texts: [currentPrompt, currentNegativePrompt, ...characterPrompts],',
                    '  includeBreakdown: true',
                    '})',
                    '```',
                    '',
                    '**2. Optimize Token Efficiency**:',
                    '• Reference strong tokens (≥8.0 strength) from T5 breakdown',
                    '• Replace weak tokens (<4.0) with stronger alternatives',
                    '• Use tag search tools to find better/more efficient tags',
                    '',
                    '**3. Generate COMPLETE Optimization Replacements**:',
                    '• Review Phase 1 replacements (from your previous response)',
                    '• Incorporate Phase 1\'s good ideas and concepts + the tools results + your smart token optimizations skills',
                    '• Return COMPLETE replacement arrays (not just additions)',
                    '',
                    '**4. Apply optimization to ALL prompts**:',
                    '• Positive prompts (main generation)',
                    '• Negative prompts (UC - things to avoid)',
                    '• Character prompts (character-specific details)',
                    '',
                    '## Token Limits',
                    `**Total Prompt Tokens**: ${context.tokenCounts?.totalPrompt || 'Unknown'} / 512`,
                    `**Total UC Tokens**: ${context.tokenCounts?.totalUC || 'Unknown'} / 512`,
                    '',
                    '## Validation Requirements',
                    '**MANDATORY VALIDATION**: Use `validateTextReplacement` to test complete replacement workflows:',
                    '',
                    '**What to Validate:**',
                    '• Selector uniqueness (no overlapping select_text values)',
                    '• Selector existence (all select_text appears in base prompts)',
                    '• Replacement application success',
                    '• Token count changes (original vs modified)',
                    '',
                    '**Fix Validation Failures:**',
                    '• Adjust select_text to match actual prompt content',
                    '• Resolve overlapping selectors',
                    '• Ensure selectors are unique within replacement arrays',
                    '• Check token limits after modifications',
                    '',
                    '## 📋 CRITICAL: Understanding Phase 1 State',
                    '',
                    '**PHASE 1 REPLACEMENTS WERE NOT APPLIED**',
                    '• Look for "# 🎯 PHASE 1: CONTEXT INTEGRATION" in your conversation history',
                    '• Phase 1 proposed replacements but they were NOT executed',
                    '• You must call tools on the ORIGINAL prompts to analyze them',
                    '',
                    '## Your Deliverable',
                    '',
                    '**YOU MUST RETURN COMPLETE REPLACEMENT ARRAYS**',
                    '• Review your Phase 1 response from conversation history',
                    '• Understand what you were trying to achieve in Phase 1',
                    '• Use tools to validate against ORIGINAL prompts',
                    '• Generate a COMPLETE set of replacements (not just Phase 2 additions)',
                    '',
                    '**DO NOT:**',
                    '• Assume Phase 1 replacements were applied',
                    '• Return only incremental Phase 2 changes',
                    '• Reference text that doesn\'t exist in the original prompts',
                    '',
                    '**DO:**',
                    '• Return complete replacement arrays for prompt, uc, and character_prompts',
                    '• Include dialogs array (' + (dialogsCount || 6) + ' context-aware character dialogs)',
                    '• **🚨 REQUIRED**: Include generated_image_name (descriptive name with proper capitalization) - this field is MANDATORY',
                    '• **🚨 REQUIRED if placeholders detected**: Include character_names array if generic "Character #" names need replacement',
                    '• Incorporate your Phase 1 ideas into your complete output',
                    '• Validate everything against the ORIGINAL prompts',
                    '',
                    '## Output Format',
                    'Return the SAME structure as Phase 1, with COMPLETE replacement arrays plus dialogs, generated_image_name, and character_names.'
                ]).join('\n')
            };

            // Prepare AI options for Phase 2
            const aiOptions = {
                model: 'grok-4-fast-reasoning',
                timeout: 30000,
                liveSearch: true,
                store: true,
                responseSchema: createDynamicGenerationResponseSchema(characterPrompts?.length || 0, characterPrompts),
                extractKeys: ['*.reason', '*.reason_display'],
                totalKeys: getZodSchemaKeyCount(createDynamicGenerationResponseSchema(characterPrompts?.length || 0, characterPrompts)),
                ws: ws,
                handler: handler,
                requestId: `${requestId}_phase2_attempt${attempt + 1}`,
                enableOptimize: true,
                previous_response_id: previousResponseId, // Continue conversation
                tools: (dynamicConfig?.fast_mode === true) ? filterToolsForFastMode(getAllToolDefinitions()) : getAllToolDefinitions(),
                toolLoops: (dynamicConfig?.fast_mode === true) ? 4 : (dynamicConfig.tool_passes || 12),
                buildOptions: { 
                    ...dynamicConfig,
                    // Inject original prompts for tool access (validateTextReplacement)
                    basePrompt: prompt,
                    negativePrompt: uc,
                    characterPrompts: characterPrompts
                }
            };

            // Call AI for Phase 2
            console.log(`🤖 Calling AI for Phase 2 optimization (attempt ${attempt + 1}, continuation of ${previousResponseId})...`);

            const aiResponse = await callDirectorAIWithStructuredOutput(
                [{ role: 'user', content: [phase2Message] }], // Only send the Phase 2 message
                aiOptions,
                // Streaming callback
                (content, fullResponse, extractedKeys) => {
                    if (ws && handler && extractedKeys && extractedKeys.length > 0) {
                        extractedKeys.forEach((keyInfo) => {
                            if (keyInfo.value && typeof keyInfo.value === 'string' &&
                                keyInfo.value !== 'object' && keyInfo.type === 'value') {
                                handler.sendToClient(ws, {
                                    type: 'dynamic_generation_progress_update',
                                    phase: 'optimization_streaming',
                                    data: { reason: keyInfo.value },
                                    timestamp: new Date().toISOString()
                                });
                            }
                        });
                    }
                }
            );

            // Capture response ID for potential future phases
            const phase2ResponseId = aiResponse.responseId;
            console.log(`✅ Phase 2 attempt ${attempt + 1} completed with response ID: ${phase2ResponseId}`);
            
            // Log Phase 2 usage data and add to apiCalls array (ALL calls, including failed ones)
            // Note: Even failed calls cost money, so we track them all
            // Handle simplified format (total, input, output, cache, reasoning) or old format (for backward compatibility)
            if (aiResponse?.usage && requestId) {
                const usageData = aiResponse.usage;
                
                // Check if already in simplified format (from grokService)
                let totalTokens, promptTokens, completionTokens, cachedTokens, reasoningTokens;
                if (usageData.total !== undefined) {
                    // Simplified format
                    totalTokens = usageData.total || 0;
                    promptTokens = usageData.input || 0;
                    completionTokens = usageData.output || 0;
                    cachedTokens = usageData.cache || 0;
                    reasoningTokens = usageData.reasoning || 0;
                } else {
                    // Old format - handle both naming conventions: input_tokens/output_tokens (actual API) or prompt_tokens/completion_tokens (docs)
                    const promptDetails = usageData.prompt_tokens_details || usageData.input_tokens_details || null;
                    const completionDetails = usageData.completion_tokens_details || usageData.output_tokens_details || null;
                    
                    totalTokens = usageData.total_tokens || 0;
                    promptTokens = usageData.prompt_tokens || usageData.input_tokens || 0;
                    completionTokens = usageData.completion_tokens || usageData.output_tokens || 0;
                    cachedTokens = promptDetails?.cached_tokens || 0;
                    reasoningTokens = completionDetails?.reasoning_tokens || 0;
                }
                
                // Add individual API calls from AI response (each iteration/tool call is tracked separately)
                // If aiResponse has apiCalls array, use those individual calls, otherwise create a single aggregated entry
                if (aiResponse.apiCalls && Array.isArray(aiResponse.apiCalls) && aiResponse.apiCalls.length > 0) {
                    // Add each individual call with phase and attempt info
                    aiResponse.apiCalls.forEach(call => {
                        phase2ApiCalls.push({
                            phase: 'phase2',
                            attempt: attempt + 1,
                            iteration: call.iteration,
                            callType: call.callType || 'request', // 'request' or 'tool_call'
                            timestamp: call.timestamp || Date.now(),
                            duration: call.duration || null, // Duration in milliseconds
                            usage: call.usage,
                            pricing_tier_128k: call.pricing_tier_128k,
                            responseId: call.responseId || aiResponse.responseId || null,
                            toolCalls: call.toolCalls || 0,
                            tools: call.tools || [], // Array of tool information (name, reason, parameters)
                            hasResponseId: call.hasResponseId || false,
                            success: null // Will be set after validation
                        });
                    });
                } else {
                    // Fallback: Create single aggregated entry if apiCalls not available
                    const callEntry = {
                        phase: 'phase2',
                        callType: 'ai_call',
                        attempt: attempt + 1,
                        timestamp: Date.now(),
                        usage: {
                            total: totalTokens,
                            input: promptTokens,
                            output: completionTokens,
                            cache: cachedTokens,
                            reasoning: reasoningTokens
                        },
                        pricing_tier_128k: totalTokens > 128000 ? 'OVER' : (totalTokens > 100000 ? 'NEAR' : 'OK'),
                        responseId: aiResponse.responseId || null,
                        success: null // Will be set after validation
                    };
                    phase2ApiCalls.push(callEntry);
                }
                
                logger.logGeneration('PHASE_2_ATTEMPT_USAGE', {
                    attempt: attempt + 1,
                    total: totalTokens,
                    input: promptTokens,
                    output: completionTokens,
                    cache: cachedTokens,
                    reasoning: reasoningTokens,
                    pricing_tier_128k: totalTokens > 128000 ? 'OVER' : (totalTokens > 100000 ? 'NEAR' : 'OK')
                }, requestId);
            }

            // Extract phase2Data from AI response
            const phase2Data = aiResponse.content || aiResponse; // Handle both response formats

            // Check if Phase 2 provided any text replacements
            const hasPhase2Replacements = 
                (phase2Data.text_replacements?.prompt && phase2Data.text_replacements.prompt.length > 0) ||
                (phase2Data.text_replacements?.uc && phase2Data.text_replacements.uc.length > 0) ||
                (phase2Data.text_replacements?.character_prompts && phase2Data.text_replacements.character_prompts.length > 0);

            if (!hasPhase2Replacements) {
                console.log('ℹ️ Phase 2 provided no text replacements - using Phase 1 results');
                return {
                    ...phase1Results,
                    phase2Reason: phase2Data.reason || 'No updates needed',
                    isOptimized: true, // Still considered optimized since Phase 2 confirmed Phase 1 is good
                    phase2Usage: aiResponse?.usage || null, // Include Phase 2 usage data
                    apiCalls: phase2ApiCalls // Include Phase 2 API calls array
                };
            }

            // Reset validationResults for this attempt
            validationResults = {
                prompt: { success: true, failedReplacements: [] },
                uc: { success: true, failedReplacements: [] },
                characterPrompts: []
            };

            if (phase2Data.text_replacements?.prompt && phase2Data.text_replacements.prompt.length > 0) {
                const result = applyDynamicReplacements(prompt, phase2Data.text_replacements, 'prompt');
                validationResults.prompt = result;
            }

            if (phase2Data.text_replacements?.uc && phase2Data.text_replacements.uc.length > 0) {
                const result = applyDynamicReplacements(uc, phase2Data.text_replacements, 'uc');
                validationResults.uc = result;
            }

            if (characterPrompts.length > 0 && phase2Data.text_replacements?.character_prompts) {
                for (let i = 0; i < characterPrompts.length; i++) {
                    const charReplacements = phase2Data.text_replacements.character_prompts[i];
                    if (charReplacements) {
                        const charValidation = { prompt: { success: true, failedReplacements: [] }, uc: { success: true, failedReplacements: [] } };

                        if (charReplacements.prompt) {
                            const result = applyDynamicReplacements(characterPrompts[i].prompt, charReplacements, 'character', i, 'prompt');
                            charValidation.prompt = result;
                        }

                        if (charReplacements.uc) {
                            const result = applyDynamicReplacements(characterPrompts[i].uc, charReplacements, 'character', i, 'uc');
                            charValidation.uc = result;
                        }

                        validationResults.characterPrompts.push(charValidation);
                    }
                }
            }

            // Check if all validations passed
            const allValid = validationResults.prompt.success &&
                           validationResults.uc.success &&
                           validationResults.characterPrompts.every(c => c.prompt.success && c.uc.success);

            // Update success status of the last Phase 2 API call based on validation
            if (phase2ApiCalls.length > 0) {
                const lastCall = phase2ApiCalls[phase2ApiCalls.length - 1];
                if (lastCall.phase === 'phase2' && lastCall.attempt === attempt + 1) {
                    lastCall.success = allValid;
                }
            }

            if (allValid) {
                console.log('✅ Phase 2 validation passed - all replacements are valid');
                
                // Send Phase 2 completion update
                if (ws && handler) {
                    handler.sendToClient(ws, {
                        type: 'dynamic_generation_progress_update',
                        phase: 'optimization_complete',
                        data: {
                            phase: 2,
                            totalPhases: 2,
                            validationResults: validationResults
                        },
                        timestamp: new Date().toISOString()
                    });
                }

                // Phase 2 returns COMPLETE replacement arrays, not incremental
                // The AI has reasoned about Phase 1 replacements and delivered the entire updated set

                // Auto-save insight_memory entries from Phase 2 (only on validation pass)
                autoSaveInsightMemories(phase2Data.insight_memory, 'Phase 2');
                
                // Build modified character prompts with applied replacements and character names from Phase 2
                const phase2ModifiedCharacterPrompts = characterPrompts.map((char, index) => {
                    const charResult = validationResults.characterPrompts[index];
                    // Use Phase 2 character names if available, otherwise fall back to Phase 1, then original
                    const newName = phase2Data.character_names?.[index] || 
                                   phase1Results.character_names?.[index] || 
                                   char.name;
                    
                    return {
                        ...char, // Preserve other properties like center, enabled, etc.
                        prompt: charResult?.prompt?.result || char.prompt || '',
                        uc: charResult?.uc?.result || char.uc || '',
                        name: newName
                    };
                });
                
                // Log Phase 2 updates
                if (phase2Data.generated_image_name && phase2Data.generated_image_name !== phase1Results.generated_image_name) {
                    console.log(`🖼️ Phase 2 image name: "${phase2Data.generated_image_name}"`);
                }
                
                if (phase2Data.character_names && phase2Data.character_names.length > 0) {
                    const hasChanges = phase2Data.character_names.some((name, i) => 
                        name && name !== phase1Results.character_names?.[i]
                    );
                    if (hasChanges) {
                        console.log('✨ Phase 2 character names updated:');
                        phase2Data.character_names.forEach((name, index) => {
                            const oldName = phase1Results.character_names?.[index] || characterPrompts[index]?.name || 'Unknown';
                            if (name && name !== oldName) {
                                console.log(`   Character ${index + 1}: "${oldName}" → "${name}"`);
                            }
                        });
                    }
                }

                // Return Phase 2 optimized results with COMPLETE replacements from Phase 2
                return {
                    success: true,
                    prompt: phase1Results.prompt, // Carry forward original prompt for hash validation
                    uc: phase1Results.uc, // Carry forward original UC for hash validation
                    characterPrompts: phase1Results.characterPrompts, // Carry forward original character prompts for hash validation
                    modifiedCharacterPrompts: phase2ModifiedCharacterPrompts, // Phase 2 modified character prompts with names
                    text_replacements: phase2Data.text_replacements,
                    dialogs: phase2Data.dialogs || phase1Results.dialogs, // Use Phase 2 dialogs if available, otherwise keep Phase 1
                    generated_image_name: phase2Data.generated_image_name || phase1Results.generated_image_name || null, // Use Phase 2 if available, otherwise Phase 1
                    character_names: phase2Data.character_names || phase1Results.character_names || null, // Use Phase 2 if available, otherwise Phase 1
                    context: context,
                    processed: true,
                    previousResponseId: phase2ResponseId,
                    initialResponseId: phase1Results.initialResponseId, // Preserve initial response ID from Phase 1
                    request_hash: phase1Results.request_hash, // Carry forward request hash for cache validation
                    prompt_hash: phase1Results.prompt_hash, // Carry forward prompt hash for cache validation
                    directive_hash: phase1Results.directive_hash, // Carry forward directive hash for cache validation
                    timestamp: phase1Results.timestamp, // Carry forward timestamp
                    generation_chain: generationChainNumber, // Current generation in chain
                    phase1Results: phase1Results, // Store Phase 1 for reference
                    phase2Results: phase2Data, // Store Phase 2 for reference
                    validationResults: validationResults,
                    errors: phase2Data.errors || phase1Results.errors || [], // Use Phase 2 errors if available, otherwise keep Phase 1
                    warnings: phase2Data.warnings || phase1Results.warnings || [], // Use Phase 2 warnings if available, otherwise keep Phase 1
                    isOptimized: true,
                    phase2Usage: aiResponse?.usage || null, // Include Phase 2 usage data
                    apiCalls: phase2ApiCalls // Include Phase 2 API calls array
                };
            } else {
                // Validation failed - retry if we have attempts left
                console.warn(`⚠️ Phase 2 validation failed on attempt ${attempt + 1}/${maxAttempts}`);
                
                if (attempt < maxAttempts - 1) {
                    // Update previousResponseId for retry (continue the chain)
                    previousResponseId = phase2ResponseId;
                    
                    // Log specific failures
                    if (!validationResults.prompt.success) {
                        console.log(`   ❌ Prompt failures: ${validationResults.prompt.failedReplacements.join(', ')}`);
                    }
                    if (!validationResults.uc.success) {
                        console.log(`   ❌ UC failures: ${validationResults.uc.failedReplacements.join(', ')}`);
                    }
                    
                    // Continue to next attempt
                    continue;
                } else {
                    // Max retries reached - return Phase 1 results
                    console.error('❌ Phase 2 validation failed after max retries, returning Phase 1 results');
                    return {
                        ...phase1Results,
                        phase2Error: 'Validation failed after retries',
                        phase2ValidationResults: validationResults,
                        isOptimized: false,
                        apiCalls: phase2ApiCalls // Include Phase 2 API calls array (even on failure)
                    };
                }
            }

        } catch (attemptError) {
            console.error(`❌ Phase 2 attempt ${attempt + 1} error:`, attemptError);
            
            if (attempt < maxAttempts - 1) {
                console.log(`⚠️ Retrying Phase 2 (attempt ${attempt + 2}/${maxAttempts})...`);
                // Continue to next attempt
                continue;
            } else {
                // Return Phase 1 results as fallback
                console.log('⚠️ Phase 2 failed after max attempts, returning Phase 1 results as fallback');
                return {
                    ...phase1Results,
                    phase2Error: attemptError.message,
                    isOptimized: false,
                    apiCalls: phase2ApiCalls // Include Phase 2 API calls array (even on failure)
                };
            }
        }
    }
    
    // Should never reach here, but return Phase 1 as ultimate fallback
    console.error('❌ Phase 2 loop exited unexpectedly, returning Phase 1 results');
    return {
        ...phase1Results,
        phase2Error: 'Unexpected loop exit',
        isOptimized: false,
        apiCalls: phase1Results.apiCalls || [] // Ensure apiCalls is included
    };
}

// ============================================================================
// Optimization Tool Handlers
// ============================================================================

/**
 * Resolve dynamic generation context without AI processing
 * Returns the actual values that would be used for generation
 * Uses compileContext to avoid duplicating resolution logic
 */
async function resolveDynamicContext(dynamicConfig, clientIP = null) {
    try {
        const context = await compileContext(dynamicConfig, clientIP);
        const result = formatContextForCarousel(context);
        return result;
    } catch (error) {
        console.error('❌ Error resolving dynamic context:', error);
        throw error;
    }
}


/**
 * Format context data for carousel display
 * @param {Object} context - The resolved context object
 * @returns {Object} Formatted data for carousel display
 */
function formatContextForCarousel(context) {
    // Check if date was overridden (different from today's date)
    let dateItem = null;
    if (context.time) {
        const contextDate = new Date(context.time.year, context.time.month, context.time.dayOfMonth);
        const today = new Date();
        const isDateOverridden = contextDate.toDateString() !== today.toDateString();

        if (isDateOverridden) {
            dateItem = {
                month: context.time.month,
                day: context.time.dayOfMonth,
                year: context.time.year,
                formatted: contextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            };
        }
    }

    return {
        time: context.time ? {
            hour: context.time.hour,
            minute: context.time.minute,
            formatted: `${String(context.time.hour).padStart(2, '0')}:${String(context.time.minute).padStart(2, '0')}`,
            timezone: context.location?.timezone || null
        } : null,
        date: dateItem,
        timeOfDay: context.timePeriod ? {
            name: normalizePeriodKey(context.timePeriod.periodKey) || null,
            description: context.timePeriod.period || null
        } : null,
        weather: context.weather ? {
            temperature: context.weather.temperature,
            feelsLike: context.weather.feelsLike,
            condition: context.weather.condition
        } : null,
        season: typeof context.season === 'string' ? context.season : context.season?.season || null,
        holidayInfo: context.season?.holidayInfo || null,
        creative: context.creative || false,
        location: context.location ? {
            latitude: context.location.latitude,
            longitude: context.location.longitude,
            timezone: context.location.timezone,
            city: context.location.city,
            country: context.location.country
        } : null
    };
}

module.exports = {
    generateDynamicTaskList,
    processDynamicGenerationCore,
    applyDynamicReplacements,
    cleanupPromptSyntax,
    generateRequestHash,
    generatePromptHash,
    generateDirectiveHash,
    expandShorthandTags,
    getTimezoneByCoordinates,
    resolveDynamicContext,
    compileContext,
    formatContextForCarousel,
    createCounterManager
};
