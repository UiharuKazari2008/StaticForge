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

const { determineTimePeriod, getSunriseSunset } = require('./dynamicGenerationHandlers.timeCalc');

const { callDirectorAIWithStructuredOutput } = require('./aiServices/grokService');

// Import T5 tokenizer service for token counting
const t5TokenizerService = require('./t5-tokenizer-service');

/**
 * Generate a consistent prompt hash for cache validation
 * @param {string} prompt - The main prompt
 * @param {string} uc - The negative prompt
 * @param {Array} characterPrompts - Character prompts array
 * @returns {string} MD5 hash of the prompts
 */
function generatePromptHash(prompt, uc, characterPrompts) {
    const crypto = require('crypto');
    return crypto.createHash('md5')
        .update(JSON.stringify({
            prompt: prompt,
            uc: uc,
            characterPrompts: characterPrompts || []
        }))
        .digest('hex');
}

/**
 * Generate a consistent request hash for dynamic generation parameters
 * Used for cache validation and context locking validation
 * @param {Object} dynamicConfig - The dynamic generation configuration
 * @param {Object} datasetConfig - The dataset configuration (optional)
 * @returns {string} MD5 hash of the relevant parameters
 */
function generateRequestHash(dynamicConfig, datasetConfig = null) {
    const crypto = require('crypto');
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
            directive: dynamicConfig.directive,
            clothing: dynamicConfig.clothing,
            observeHoliday: dynamicConfig.observeHoliday,
            temperature: dynamicConfig.temperature,
            nsfw_level: datasetConfig?.nsfw
        }))
        .digest('hex');
}

// Import clothing database for dynamic clothing selection
const ClothingDatabase = require('./clothingDatabase');

// Timezone lookup for offline timezone determination by coordinates
const tzLookup = require('tz-lookup');

// Reverse geocoding for location metadata
const geo2city = require('geo2city');

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
        console.log(`🌍 Timezone lookup: (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) → ${timezone}`);
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
    console.log('🌤️ Using Open-Meteo as weather data provider');
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
 * Get weather data for a specific date (historical or future)
 * @param {Object} location - Location coordinates
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @param {boolean} useArchive - Whether to use archive API (for old data)
 * @returns {Object|null} Weather data or null if failed
 */
async function getWeatherForDate(location, dateString, useArchive = false) {
    try {
        const baseUrl = useArchive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
        const endDate = new Date(new Date(dateString).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const url = `${baseUrl}?latitude=${location.lat}&longitude=${location.lon}&start_date=${dateString}&end_date=${endDate}&hourly=temperature_2m,relative_humidity_2m,dewpoint_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,pressure_msl,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover&daily=weather_code,uv_index_max&timezone=auto`;

        const response = await fetch(url);
        if (!response.ok) return null;

        const data = await response.json();
        if (!data.hourly?.time?.length) return null;

        // Process into daily averages
        const temps = data.hourly.temperature_2m || [];
        const humidities = data.hourly.relative_humidity_2m || [];
        const dewPoints = data.hourly.dewpoint_2m || [];
        const apparentTemps = data.hourly.apparent_temperature || [];
        const pressures = data.hourly.pressure_msl || [];
        const visibilities = data.hourly.visibility || [];
        const windSpeeds = data.hourly.wind_speed_10m || [];
        const windDirections = data.hourly.wind_direction_10m || [];
        const windGusts = data.hourly.wind_gusts_10m || [];
        const precipitations = data.hourly.precipitation || [];
        const rains = data.hourly.rain || [];
        const showers = data.hourly.showers || [];
        const snowfalls = data.hourly.snowfall || [];

        const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
        const avgHumidity = humidities.reduce((a, b) => a + b, 0) / humidities.length;
        const avgDewPoint = dewPoints.length > 0 ? dewPoints.reduce((a, b) => a + b, 0) / dewPoints.length : undefined;
        const avgApparentTemp = apparentTemps.length > 0 ? apparentTemps.reduce((a, b) => a + b, 0) / apparentTemps.length : undefined;
        const avgPressure = pressures.reduce((a, b) => a + b, 0) / pressures.length;
        const avgVisibility = visibilities.filter(v => v > 0).reduce((a, b) => a + b, 0) / visibilities.filter(v => v > 0).length || 10000;
        const maxWindSpeed = Math.max(...windSpeeds) / 3.6; // Convert km/h to m/s
        const maxWindGust = windGusts.length > 0 ? Math.max(...windGusts) / 3.6 : undefined; // Convert km/h to m/s
        const avgWindDirection = windDirections.length > 0 ? windDirections.reduce((a, b) => a + b, 0) / windDirections.length : undefined;
        const totalPrecip = precipitations.reduce((a, b) => a + b, 0);
        const totalRain = rains.reduce((a, b) => a + b, 0);
        const totalShowers = showers.reduce((a, b) => a + b, 0);
        const totalSnow = snowfalls.reduce((a, b) => a + b, 0);

        const weatherCode = data.daily?.weather_code?.[0] || data.hourly.weather_code?.[Math.floor(data.hourly.weather_code.length / 2)] || 800;

        return {
            temperature: Math.round(avgTemp),
            condition: mapOpenMeteoCondition(weatherCode),
            humidity: Math.round(avgHumidity),
            windSpeed: Math.round(maxWindSpeed),
            windGust: maxWindGust !== undefined ? Math.round(maxWindGust) : undefined,
            windDirection: avgWindDirection !== undefined ? Math.round(avgWindDirection) : undefined,
            pressure: Math.round(avgPressure) || 1013,
            visibility: avgVisibility,
            feelsLike: avgApparentTemp !== undefined ? Math.round(avgApparentTemp) : undefined,
            dewPoint: avgDewPoint !== undefined ? Math.round(avgDewPoint * 10) / 10 : undefined,
            cloudCoverage: Math.round((data.hourly.cloud_cover || []).reduce((a, b) => a + b, 0) / (data.hourly.cloud_cover || []).length) || 0,
            precipitation: Math.round(totalPrecip * 100) / 100,
            precipitationRate: totalPrecip / 24,
            rain: Math.round(totalRain * 100) / 100,
            showers: Math.round(totalShowers * 100) / 100,
            snowfall: Math.round(totalSnow * 100) / 100,
            sunrise: data.daily?.sunrise?.[index],
            sunset: data.daily?.sunset?.[index],
            uvIndex: data.daily?.uv_index_max?.[0] || 0,
            rawConditionId: weatherCode,
            icon: mapOpenMeteoIcon(weatherCode, true),
            weatherQuality: { comfortLevel: getComfortLevel(Math.round(avgTemp), avgHumidity, maxWindSpeed) },
            timestamp: new Date(dateString).getTime(),
            dataSource: useArchive ? `Historical (${dateString})` : `Forecast (${dateString})`,
            location
        };
    } catch (error) {
        console.warn(`Failed to get weather for ${dateString}:`, error.message);
        return null;
    }
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
    console.log(`🌍 Weather timezone (${timezoneSource}): ${result.location.timezone} (${result.location.timezoneAbbreviation}), coordinates: (${rawData.latitude.toFixed(4)}, ${rawData.longitude.toFixed(4)})`);

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

        // Debug: Log temporal data availability
        console.log(`📊 Temporal data extracted: pastPeriod=${pastData.length} points, nextPeriod=${futureData.length} points, total hourly=${hourlyData.length}, minutely=${result.minutely ? result.minutely.length : 0}`);
        if (pastData.length > 0) {
            console.log(`📊 Past period range: ${new Date(pastData[pastData.length-1].timestamp).toISOString()} to ${new Date(pastData[0].timestamp).toISOString()}`);
        }
        if (futureData.length > 0) {
            const dataType = futureData[0].timestamp && result.minutely && result.minutely.some(m => m.timestamp === futureData[0].timestamp) ? 'minutely' : 'hourly';
            console.log(`📊 Next period (${dataType}): ${new Date(futureData[0].timestamp).toISOString()} to ${new Date(futureData[futureData.length-1].timestamp).toISOString()}`);
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

    console.log('🌤️ Retrieving comprehensive weather analysis...');

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
            console.log(`📊 Getting current weather with ${pastHours}hr past + ${forecastHours}hr future...`);
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
        console.log('🔍 Generating comprehensive weather analysis...');
        results.analysis = generateComprehensiveAnalysis(results);

        console.log('✅ Weather analysis complete');
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
 * Create Zod schema for dynamic generation AI response
 * @param {number} expectedCharacterPrompts - Number of character prompts expected
 * @returns {Object} Zod schema
 */
/**
 * Get the number of top-level keys in a Zod schema
 * @param {Object} schema - Zod schema object
 * @returns {number} Number of top-level keys
 */
function getZodSchemaKeyCount(schema) {
    if (schema && schema._def && schema._def.shape) {
        return Object.keys(schema._def.shape).length;
    }
    return 1; // fallback
}

function createDynamicGenerationResponseSchema(expectedCharacterPrompts = 0) {
    return z.object({
    dialogs: z.array(z.object({
        type: z.enum(["speech", "thought"])
            .describe("Dialog type: 'speech' for spoken words, 'thought' for internal monologue"),
        text: z.string().min(1).max(200)
            .describe("Dialog text content, context-aware and in character's voice/tone matching the scene"),
        top: z.number().min(5).max(95)
            .describe("Vertical position from top as percentage (5-95%) - distribute to avoid overlap"),
        left: z.number().min(5).max(95)
            .describe("Horizontal position from left as percentage (5-95%) - distribute to avoid overlap"),
        alignment: z.enum(["left", "right"])
            .describe("Text alignment for the dialog bubble based on position")
    })).min(3).max(10).nullable().optional()
        .describe("3-10 context-aware character dialogs (speech/thoughts) matching scene tone, character voice, and narrative context. Distribute positions to avoid clustering."),
    text_replacements: z.object({
        prompt: z.array(z.object({
            reason: z.string()
                .describe("Plain text brief description of the reason for this replacement (1-2 sentences)"),
            reason_display: z.string()
                .describe("Very short explanation for display in UI (2-5 words)"),
            select_text: z.string().nullable().optional()
                .describe("EXACT text segment (1-5 words) to find and modify (required for replace/delete, optional for append - if omitted, appends to end)"),
            replace_text: z.string().nullable()
                .describe("Text to replace the selected text with (omit/empty when action=delete)"),
            action: z.enum(['replace', 'append', 'delete']).nullable().default('replace')
                .describe("Replacement action: replace (default), append, or delete"),
            count: z.number().int().positive().nullable().optional()
                .describe("For delete only: number of occurrences to remove left-to-right (omit to delete all)"),
            is_critical: z.boolean().nullable().default(true)
                .describe("Whether this replacement is critical (true) requiring retry if failed, or optional (false) allowing graceful fallback"),
            fallback_select_text: z.string().nullable().optional()
                .describe("Fallback text to select if select_text is not found (shorter, more common phrase)"),
            alternative_text: z.string().nullable().optional()
                .describe("For optional replacements: safer generic text to append if both select_text and fallback_select_text fail"),
            replacement_category: z.enum(['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'])
                .describe("Category enum: 'Weather' (weather conditions), 'Time of Day' (time/lighting), 'Seasonal' (season elements), 'Holiday' (festive), 'Lighting' (light quality/sources), 'Atmosphere' (mood/ambiance), 'Enhancement' (quality improvements), 'Action Verbs' (character actions/poses), 'Text Overlay' (modify text after ', Text:' boundary), 'Spelling' (typo fixes), 'Conflict Resolution' (remove conflicts), 'Directive' (user request not fitting other categories). NOTE: Only 'Spelling' and 'Text Overlay' can modify text after ', Text:' boundary"),
        })).describe("Find-and-replace operations for the main prompt"),
        uc: z.array(z.object({
            reason: z.string()
                .describe("Plain text brief description of the reason for this replacement (1-2 sentences)"),
            reason_display: z.string()
                .describe("Very short explanation for display in UI (2-5 words)"),
            select_text: z.string().nullable().optional()
                .describe("EXACT text segment (1-5 words) to find and modify (required for replace/delete, optional for append - if omitted, appends to end)"),
            replace_text: z.string().nullable()
                .describe("Text to replace the selected text with (omit/empty when action=delete)"),
            action: z.enum(['replace', 'append', 'delete']).nullable().default('replace')
                .describe("Replacement action: replace (default), append, or delete"),
            count: z.number().int().positive().nullable().optional()
                .describe("For delete only: number of occurrences to remove left-to-right (omit to delete all)"),
            is_critical: z.boolean().nullable().default(true)
                .describe("Whether this replacement is critical (true) requiring retry if failed, or optional (false) allowing graceful fallback"),
            fallback_select_text: z.string().nullable().optional()
                .describe("Fallback text to select if select_text is not found (shorter, more common phrase)"),
            alternative_text: z.string().nullable().optional()
                .describe("For optional replacements: safer generic text to append if both select_text and fallback_select_text fail"),
            replacement_category: z.enum(['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'])
                .describe("Category enum: 'Weather' (weather conditions), 'Time of Day' (time/lighting), 'Seasonal' (season elements), 'Holiday' (festive), 'Lighting' (light quality/sources), 'Atmosphere' (mood/ambiance), 'Enhancement' (quality improvements), 'Action Verbs' (character actions/poses), 'Text Overlay' (modify text after ', Text:' boundary), 'Spelling' (typo fixes), 'Conflict Resolution' (remove conflicts), 'Directive' (user request not fitting other categories). NOTE: Only 'Spelling' and 'Text Overlay' can modify text after ', Text:' boundary"),
        })).describe("Find-and-replace operations for the negative prompt"),
        character_prompts: z.array(z.object({
            input: z.array(z.object({
                reason: z.string()
                    .describe("Plain text brief description of the reason for this replacement (1-2 sentences)"),
                reason_display: z.string()
                    .describe("Very short explanation for display in UI (2-5 words)"),
                select_text: z.string().nullable().optional()
                    .describe("EXACT text segment (1-5 words) to find and modify (required for replace/delete, optional for append - if omitted, appends to end)"),
                replace_text: z.string().nullable()
                    .describe("Text to replace the selected text with (omit/empty when action=delete)"),
                action: z.enum(['replace', 'append', 'delete']).nullable().default('replace')
                    .describe("Replacement action: replace (default), append, or delete"),
                count: z.number().int().positive().nullable().optional()
                    .describe("For delete only: number of occurrences to remove left-to-right (omit to delete all)"),
                is_critical: z.boolean().nullable().default(true)
                    .describe("Whether this replacement is critical (true) requiring retry if failed, or optional (false) allowing graceful fallback"),
                fallback_select_text: z.string().nullable().optional()
                    .describe("Fallback text to select if select_text is not found (shorter, more common phrase)"),
                alternative_text: z.string().nullable().optional()
                    .describe("For optional replacements: safer generic text to append if both select_text and fallback_select_text fail"),
                replacement_category: z.enum(['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'])
                    .describe("Category enum: 'Weather' (weather conditions), 'Time of Day' (time/lighting), 'Seasonal' (season elements), 'Holiday' (festive), 'Lighting' (light quality/sources), 'Atmosphere' (mood/ambiance), 'Enhancement' (quality improvements), 'Action Verbs' (character actions/poses), 'Text Overlay' (text after ', Text:'), 'Spelling' (typo fixes), 'Conflict Resolution' (remove conflicts), 'Directive' (user request not fitting other categories). NOTE: Only 'Spelling' and 'Text Overlay' can modify text after ', Text:' boundary"),
            })).describe("Find-and-replace operations for this character prompt input"),
            uc: z.array(z.object({
                reason: z.string()
                    .describe("Plain text brief description of the reason for this replacement (1-2 sentences)"),
                reason_display: z.string()
                    .describe("Very short explanation for display in UI (2-5 words)"),
                select_text: z.string().nullable().optional()
                    .describe("EXACT text segment (1-5 words) to find and modify (required for replace/delete, optional for append - if omitted, appends to end)"),
                replace_text: z.string().nullable()
                    .describe("Text to replace the selected text with (omit/empty when action=delete)"),
                action: z.enum(['replace', 'append', 'delete']).nullable().default('replace')
                    .describe("Replacement action: replace (default), append, or delete"),
                count: z.number().int().positive().nullable().optional()
                    .describe("For delete only: number of occurrences to remove left-to-right (omit to delete all)"),
                is_critical: z.boolean().nullable().default(true)
                    .describe("Whether this replacement is critical (true) requiring retry if failed, or optional (false) allowing graceful fallback"),
                fallback_select_text: z.string().nullable().optional()
                    .describe("Fallback text to select if select_text is not found (shorter, more common phrase)"),
                alternative_text: z.string().nullable().optional()
                    .describe("For optional replacements: safer generic text to append if both select_text and fallback_select_text fail"),
                replacement_category: z.enum(['Weather', 'Time of Day', 'Seasonal', 'Holiday', 'Spelling', 'Text Overlay', 'Conflict Resolution', 'Enhancement', 'Lighting', 'Atmosphere', 'Action Verbs', 'Directive'])
                    .describe("Category enum: 'Weather' (weather conditions), 'Time of Day' (time/lighting), 'Seasonal' (season elements), 'Holiday' (festive), 'Lighting' (light quality/sources), 'Atmosphere' (mood/ambiance), 'Enhancement' (quality improvements), 'Action Verbs' (character actions/poses), 'Text Overlay' (text after ', Text:'), 'Spelling' (typo fixes), 'Conflict Resolution' (remove conflicts), 'Directive' (user request not fitting other categories). NOTE: Only 'Spelling' and 'Text Overlay' can modify text after ', Text:' boundary"),
            })).describe("Find-and-replace operations for this character negative prompt")
        })).nullable().optional().describe("Array of find-and-replace operations for character prompts (one per character)")
        }).describe("MANDATORY structured find-and-replace operations - CRITICAL: Always use prompt array to add comprehensive weather descriptions"),
});
}

/**
 * Apply text replacements to content based on target
 * @param {string} originalContent - The original content text
 * @param {Object} replacements - Structured replacements object with prompt/uc/character_prompts arrays
 * @param {string} targetType - The target type ('prompt', 'uc', 'character')
 * @param {number} characterIndex - For character prompts, which character index (optional)
 * @param {string} characterField - For character prompts, 'input' or 'uc' (optional)
 * @returns {string} Modified content with replacements applied
 * @throws {Error} If any text replacements fail to find their target text
 */


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

    // NOTE: We DO NOT remove standalone ALL CAPS keywords (TIME, WEATHER, SEASON, CLOTHING, ACTION)
    // These are kept in the prompts so the AI model can see them and generate appropriate content

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

    // Get the appropriate replacements array
    let targetReplacements = [];

    if (targetType === 'prompt') {
        targetReplacements = replacements.prompt || [];
    } else if (targetType === 'uc') {
        targetReplacements = replacements.uc || [];
    } else if (targetType === 'character' && characterIndex !== null && characterField) {
        const charReplacements = replacements.character_prompts?.[characterIndex];
        if (charReplacements) {
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
        const { select_text, replace_text, action = 'replace', count, is_critical = true, fallback_select_text, alternative_text, replacement_category } = replacement;
        
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
            console.log(`🔄 Attempting replacement: "${trimmedSelectText}" → "${replace_text}"`);

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
                    console.log(`✅ Appended alternative text instead of replacing`);
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
            console.log(`📎 Attempting append: insert "${replace_text}"${select_text ? ` after "${trimmedSelectText}"` : ' at end'}`);

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
                insertPosition = workingContent.length;
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
            console.log(`✅ Appended "${textToAppend}"${select_text ? (positionFound ? (usedFallback ? ' after fallback text' : ` after "${trimmedSelectText}"`) : ' at end (fallback)') : ' at end'}`);
            
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
        console.log('🚫 Holiday observation disabled in seasonal guidelines');
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
                    region: holidayData.region
                }],
                isHolidayPeriod: true,
                primaryHoliday: {
                    name: holidayData.name,
                    decorations: holidayData.decorations,
                    atmosphere: holidayData.atmosphere,
                    colors: holidayData.colors
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
                    daysUntil: 0
                }],
                isHolidayPeriod: true,
                primaryHoliday: {
                    name: forcedHoliday,
                    decorations: 'festive decorations',
                    atmosphere: 'celebratory',
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

    return {
        mode: 'comprehensive',
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
 * Get comprehensive weather condition analysis
 * @param {Object} weather - Weather data object
 * @returns {Object} Enhanced weather analysis
 */
function getEnhancedWeatherAnalysis(weather) {
    const windSpeedMph = weather.windSpeed * 2.237; // Convert m/s to mph
    const temperatureF = (weather.temperature * 9/5) + 32; // Convert C to F

    const analysis = {
        windCondition: getWindConditionDescription(weather.windSpeed),
        windAdvisory: windSpeedMph >= 50 ? 'Wind Advisory' : null,
        windWarning: windSpeedMph >= 65 ? 'High Wind Warning' : null,
        freezeWarning: temperatureF <= 32 ? 'Freeze Warning' : null,
        severeWeather: false,
        weatherCategory: 'normal'
    };

    // Determine weather category and severe conditions
    const condition = weather.condition.toLowerCase();

    if (condition.includes('blizzard') || condition.includes('snow') && windSpeedMph >= 35) {
        analysis.weatherCategory = 'severe winter';
        analysis.severeWeather = true;
    } else if (condition.includes('thunderstorm') && condition.includes('severe')) {
        analysis.weatherCategory = 'severe thunderstorm';
        analysis.severeWeather = true;
    } else if (condition.includes('tornado')) {
        analysis.weatherCategory = 'tornado';
        analysis.severeWeather = true;
    } else if (condition.includes('hurricane') || condition.includes('tropical storm')) {
        analysis.weatherCategory = 'hurricane';
        analysis.severeWeather = true;
    } else if (condition.includes('fog') && weather.visibility < 0.25) {
        analysis.weatherCategory = 'dense fog';
    } else if (condition.includes('rain') && condition.includes('heavy')) {
        analysis.weatherCategory = 'heavy precipitation';
    } else if (condition.includes('snow') && condition.includes('heavy')) {
        analysis.weatherCategory = 'heavy snow';
    } else if (condition.includes('fair') || condition.includes('clear')) {
        analysis.weatherCategory = 'fair';
    } else if (condition.includes('partly cloudy')) {
        analysis.weatherCategory = 'partly cloudy';
    }

    return analysis;
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
 * Generate cloud coverage description with emphasis based on percentage and condition
 * @param {number} cloudCoverage - Cloud coverage percentage (0-100)
 * @param {string} condition - Weather condition name (e.g., 'overcast', 'partly cloudy')
 * @returns {string} Condition name with emphasis markers based on cloud coverage intensity
 */
function generateCloudCoverageDescription(cloudCoverage, condition = 'clear sky') {
    const percentage = Math.round(cloudCoverage || 0);

    // Use condition name but add emphasis based on cloud coverage intensity
    let emphasizedCondition = condition;

    if (percentage >= 90) {
        emphasizedCondition = `{{{{${condition}}}}}`; // Extremely heavy
    } else if (percentage >= 80) {
        emphasizedCondition = `{{{${condition}}}}`; // Very heavy
    } else if (percentage >= 70) {
        emphasizedCondition = `{{${condition}}}`; // Heavy
    } else if (percentage >= 60) {
        emphasizedCondition = `{${condition}}`; // Moderate
    } else if (percentage >= 40) {
        emphasizedCondition = `${condition}`; // Light
    } else if (percentage >= 20) {
        emphasizedCondition = `[${condition}]`; // Minimal emphasis
    } else {
        emphasizedCondition = `[[${condition}]]`; // Clear
    }

    return emphasizedCondition;
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
 * Generates integrated temperature analysis considering weather, UV, cloud coverage, and time period context
 * @param {Object} weather - Weather data object
 * @param {Object} timePeriodInfo - Time period information object
 * @returns {Array} Temperature analysis content
 */
function generateIntegratedTemperatureAnalysis(weather, timePeriodInfo) {
    const uvIndex = weather.uvIndex || 0;
    const cloudCoverage = weather.cloudCoverage || 0;
    const temperature = weather.feelsLike;
    const timePeriod = timePeriodInfo.period || '';
    const transitionType = timePeriodInfo.transitionType || 'steady_state';

    // Calculate effective UV considering cloud coverage and time of day
    let uvMultiplier = 1;
    if (timePeriod.includes('dawn') || timePeriod.includes('dusk') || timePeriod.includes('twilight')) {
        uvMultiplier = 0.3; // Reduced UV during transitions
    } else if (timePeriod.includes('morning') || timePeriod.includes('evening')) {
        uvMultiplier = 0.7; // Moderate UV during shoulder hours
    } else if (timePeriod.includes('noon') || timePeriod.includes('afternoon')) {
        uvMultiplier = 1.2; // Peak UV during midday
    }

    const cloudAttenuation = 1 - (cloudCoverage / 100);
    const effectiveUV = uvIndex * cloudAttenuation * uvMultiplier;

    // Time-based temperature modifiers
    let tempModifier = 1;
    let timeContext = '';

    if (transitionType === 'sunrise_transition') {
        tempModifier = temperature > 20 ? 0.9 : 1.1; // Cooling effect during sunrise
        timeContext = 'sunrise warming';
    } else if (transitionType === 'sunset_transition') {
        tempModifier = temperature > 15 ? 0.95 : 1.05; // Gradual cooling during sunset
        timeContext = 'sunset cooling';
    } else if (transitionType === 'twilight_transition') {
        tempModifier = 0.9; // Cooler during twilight
        timeContext = 'twilight chill';
    } else if (timePeriod.includes('night')) {
        tempModifier = 0.85; // Night cooling effect
        timeContext = 'night cooling';
    } else if (timePeriod.includes('dawn') || timePeriod.includes('dusk')) {
        tempModifier = 0.95; // Transition cooling
        timeContext = 'transition cooling';
    }

    const adjustedTemp = temperature * tempModifier;

    // Determine UV level descriptions
    const uvLevel = effectiveUV >= 8 ? 'extreme' : effectiveUV >= 6 ? 'high' : effectiveUV >= 3 ? 'moderate' : 'low';
    const uvDescription = uvIndex >= 8 ? `${uvIndex} Very High` : uvIndex >= 6 ? `${uvIndex} High` : uvIndex >= 3 ? `${uvIndex} Moderate` : uvIndex > 0 ? `${uvIndex} Low` : 'N/A';

    // Cloud coverage context
    const cloudContext = cloudCoverage >= 80 ? 'heavy overcast' : cloudCoverage >= 50 ? 'moderate clouds' : cloudCoverage >= 20 ? 'light clouds' : 'clear skies';
    const cloudEffect = cloudCoverage >= 80 ? ' (Heavy Overcast)' : cloudCoverage >= 50 ? ' (Moderate Clouds)' : cloudCoverage >= 20 ? ' (Light Clouds)' : ' (Clear)';

    // Time-based UV effectiveness
    let timeUVContext = '';
    if (timePeriod.includes('night') || transitionType === 'twilight_transition') {
        timeUVContext = ', minimal UV effectiveness at night';
    } else if (transitionType === 'sunrise_transition' || transitionType === 'sunset_transition') {
        timeUVContext = ', transitional UV levels';
    } else if (timePeriod.includes('dawn') || timePeriod.includes('dusk')) {
        timeUVContext = ', low-angle UV with longer shadows';
    }

    // Create temperature description based on adjusted temperature
    let tempDescription = 'moderate temperature';
    if (adjustedTemp >= 40) {
        tempDescription = 'extreme heat';
    } else if (adjustedTemp >= 35) {
        tempDescription = 'very hot conditions';
    } else if (adjustedTemp >= 30) {
        tempDescription = 'hot conditions';
    } else if (adjustedTemp >= 15) {
        tempDescription = 'warm conditions';
    } else if (adjustedTemp >= 5) {
        tempDescription = 'cool conditions';
    } else if (adjustedTemp >= 0) {
        tempDescription = 'cold conditions';
    } else {
        tempDescription = 'freezing conditions';
    }

    const result = [`Current temperature: ${tempDescription} with ${timeContext}${uvIndex ? `, UV: ${uvDescription}` : ''}${cloudCoverage > 10 ? cloudEffect : ''}${timeUVContext}`];

    // Generate temperature state based on adjusted temperature
    if (adjustedTemp >= 40) {
        result.push(
            `### **Extreme Heat** (UV: ${uvDescription}${cloudEffect})`,
            `  - **Character Effects**: Heavy sweating proportional to body weight - fat and obese characters show rivers of sweat, labored breathing, exhaustion setting in quickly${effectiveUV >= 8 && !timePeriod.includes('night') ? ', severe sunburn risk with skin reddening from intense UV radiation, painful squinting against glare' : effectiveUV >= 6 && !timePeriod.includes('night') ? ', sunburn developing rapidly, UV-induced fatigue, urgently seeking shade' : effectiveUV >= 3 && !timePeriod.includes('night') ? ', mild sun discomfort, occasional squinting against light' : ', heat exhaustion without UV amplification'}${transitionType === 'sunrise_transition' ? ', characters emerging from cool night into sudden heat' : transitionType === 'sunset_transition' ? ', heat lingering into cooling evening' : ''}`,
            `  - **Clothing**: Sweat soaking through clothing, tight outfits clinging wetly, damp patches visible${effectiveUV >= 6 && !timePeriod.includes('night') ? ', UV-protective clothing essential, light fabrics offering minimal sun protection' : effectiveUV >= 3 && !timePeriod.includes('night') ? ', sun protection considerations for fair skin' : ''}${transitionType === 'twilight_transition' ? ', considering evening chill despite heat' : ''}`,
            `  - **Environmental**: Heat shimmer distorting air, wilting vegetation, surfaces too hot to touch${effectiveUV >= 8 && !timePeriod.includes('night') ? ', intense solar radiation creating harsh shadows, bleaching colors, extreme light intensity' : effectiveUV >= 6 && !timePeriod.includes('night') ? ', strong sunlight casting deep shadows, bright illumination overwhelming' : cloudCoverage >= 50 ? ', diffused heat through cloud cover, softer shadows' : transitionType.includes('transition') ? ', transitional lighting affecting heat perception' : ', clear sky amplifying heat intensity'}${timePeriod.includes('sunrise') ? ', morning sun angle creating long shadows' : timePeriod.includes('sunset') ? ', evening sun angle with golden heat' : ''}`,
            `  - **Other Effects**: Heavy sweat effects, skin heavily glistening, exhausted expressions, wet sticky clothing layers, heat stress visible${effectiveUV >= 8 && !timePeriod.includes('night') ? ', intense light causing visual distortion, UV damage apparent on skin' : effectiveUV >= 6 && !timePeriod.includes('night') ? ', sun-induced skin warming and fatigue' : ''}${transitionType === 'sunrise_transition' ? ', morning heat building from cool dawn' : transitionType === 'sunset_transition' ? ', heat fading into twilight' : ''}`
        );
    } else if (adjustedTemp >= 35) {
        result.push(
            `### **Very Hot** (UV: ${uvDescription}${cloudEffect})`,
            `  - **Character Effects**: Heavy sweating proportional to body weight - fat and obese characters show rivers of sweat, labored breathing, exhaustion setting in quickly${effectiveUV >= 6 && !timePeriod.includes('night') ? ', increasing sunburn risk, skin warming uncomfortably from sun exposure, seeking shade' : effectiveUV >= 3 && !timePeriod.includes('night') ? ', mild sun warming, comfortable solar exposure' : ', heat effects without UV intensification'}${transitionType === 'sunrise_transition' ? ', morning heat rising from dawn coolness' : transitionType === 'sunset_transition' ? ', heat maintained into evening transition' : ''}`,
            `  - **Clothing**: Sweat soaking through clothing, tight outfits clinging wetly, damp patches visible${effectiveUV >= 6 && !timePeriod.includes('night') ? ', sun protective clothing needed, light fabrics offering limited sun protection' : effectiveUV >= 3 && !timePeriod.includes('night') ? ', sun protection for prolonged exposure' : ''}${transitionType === 'twilight_transition' ? ', preparing for evening cooling' : ''}`,
            `  - **Environmental**: Heat shimmer distorting air, wilting plants, surfaces too hot to touch${effectiveUV >= 6 && !timePeriod.includes('night') ? ', bright sunlight creating strong contrasts, sun radiation affecting light quality' : cloudCoverage >= 50 ? ', moderated heat through cloud diffusion, softened sunlight' : transitionType.includes('transition') ? ', transitional lighting tempering heat perception' : ', clear skies intensifying heat effects'}${timePeriod.includes('sunrise') ? ', morning sun with warming light' : timePeriod.includes('sunset') ? ', evening sun with golden warmth' : ''}`,
            `  - **Other Effects**: Pronounced sweat effects, skin wet and shiny, fatigued expressions, light clothing damp with sweat${effectiveUV >= 6 && !timePeriod.includes('night') ? ', sun induced skin warming, increased light intensity' : effectiveUV >= 3 && !timePeriod.includes('night') ? ', pleasant solar warmth on skin' : ''}${transitionType === 'sunrise_transition' ? ', heat building from morning transition' : transitionType === 'sunset_transition' ? ', heat sustained through evening' : ''}`
        );
    } else if (adjustedTemp >= 30) {
        result.push(
            `### **Hot** (UV: ${uvDescription}${cloudEffect})`,
            `  - **Character Effects**: Light sweat building up, comfortable warmth for most builds${effectiveUV >= 6 && !timePeriod.includes('night') ? ', mild sunburn possible, sun warming of skin, occasional squinting' : effectiveUV >= 3 && !timePeriod.includes('night') ? ', gentle sun tanning effects, pleasant sunlight warmth' : cloudCoverage >= 70 ? ', comfortable warmth without harsh sun' : transitionType === 'twilight_transition' ? ', warmth fading into twilight coolness' : ''}${transitionType === 'sunrise_transition' ? ', morning warmth emerging from dawn' : transitionType === 'sunset_transition' ? ', pleasant evening warmth' : ''}`,
            `  - **Clothing**: Normal state, natural drape and movement${effectiveUV >= 3 && !timePeriod.includes('night') ? ', sun protection considerations for prolonged exposure' : ''}${transitionType === 'twilight_transition' ? ', considering evening temperature drop' : ''}`,
            `  - **Environmental**: Normal environmental state${effectiveUV >= 6 && !timePeriod.includes('night') ? ', bright sunlight, clear shadows, good visibility' : effectiveUV >= 3 && !timePeriod.includes('night') ? ', pleasant sunlight, moderate illumination' : cloudCoverage >= 50 ? ', diffused comfortable lighting through clouds' : transitionType.includes('transition') ? ', transitional lighting creating comfortable atmosphere' : ', clear skies with comfortable warmth'}${timePeriod.includes('sunrise') ? ', morning sun with gentle warming' : timePeriod.includes('sunset') ? ', evening sun with golden comfort' : ''}`,
            `  - **Other Effects**: Subtle sweat effects, skin glistens lightly, relaxed or slightly fatigued expressions, light clothing adjustments${effectiveUV >= 3 && !timePeriod.includes('night') ? ', sun induced skin glow, comfortable solar warmth' : cloudCoverage >= 30 ? ', pleasant diffused lighting' : ''}${transitionType === 'sunrise_transition' ? ', warmth building from cool morning' : transitionType === 'sunset_transition' ? ', comfort maintained into evening' : ''}`
        );
    } else if (adjustedTemp >= 15) {
        result.push(
            `### **Warm** (${uvIndex > 0 ? `UV: ${uvDescription}` : ''}${cloudCoverage > 10 ? cloudEffect : ''})`,
            `  - **Character Effects**: Light sweat building up, comfortable warmth for most builds${effectiveUV >= 3 && cloudCoverage < 50 && !timePeriod.includes('night') ? ', gentle sun tanning effects, pleasant sunlight warmth' : ''}${transitionType === 'sunrise_transition' ? ', morning warmth replacing dawn chill' : transitionType === 'sunset_transition' ? ', warmth giving way to evening coolness' : transitionType === 'twilight_transition' ? ', comfortable transition temperature' : ''}${timePeriod.includes('night') ? ', residual warmth carrying into night' : ''}`,
            `  - **Clothing**: Normal state, natural drape and movement${effectiveUV >= 3 && cloudCoverage < 70 && !timePeriod.includes('night') ? ', optional sun protection for sensitive skin' : ''}${transitionType === 'twilight_transition' ? ', light layering for evening temperature changes' : ''}`,
            `  - **Environmental**: Normal environmental state${effectiveUV >= 3 && !timePeriod.includes('night') ? ', pleasant natural lighting' : cloudCoverage >= 50 ? ', comfortable diffused illumination' : transitionType.includes('transition') ? ', transitional lighting creating balanced atmosphere' : ', clear skies with natural light'}${timePeriod.includes('sunrise') ? ', morning light with natural warmth' : timePeriod.includes('sunset') ? ', evening light with gentle warmth' : ''}`,
            `  - **Other Effects**: Comfortable appearance, natural skin appearance, pleasant expressions, normal clothing choices${effectiveUV >= 3 && cloudCoverage < 80 && !timePeriod.includes('night') ? ', natural sun exposure benefits' : cloudCoverage >= 30 ? ', soft comfortable lighting' : ''}${transitionType === 'sunrise_transition' ? ', warmth emerging from cool transition' : transitionType === 'sunset_transition' ? ', comfort fading into twilight' : ''}`
        );
    } else if (adjustedTemp >= 5) {
        result.push(
            `### **Cool** (${uvIndex > 0 && effectiveUV >= 1 ? `UV: ${uvDescription}` : ''}${cloudCoverage > 10 ? cloudEffect : ''})`,
            `  - **Character Effects**: Cool breeze felt more by slender characters, comfortable for heavier builds${effectiveUV >= 2 && cloudCoverage < 70 && timePeriod.includes('day') ? ', mild UV exposure without warmth, cool sun on skin' : ''}${transitionType === 'sunrise_transition' ? ', morning coolness giving way to daytime warmth' : transitionType === 'sunset_transition' ? ', evening cooling intensifying' : transitionType === 'twilight_transition' ? ', cool twilight air' : ''}${timePeriod.includes('night') ? ', night cooling effects amplified' : ''}`,
            `  - **Clothing**: Normal state, natural drape and movement${effectiveUV >= 2 && timePeriod.includes('day') ? ', light sun protection if needed' : ''}${transitionType === 'twilight_transition' ? ', light outer layers for evening chill' : ''}`,
            `  - **Environmental**: Normal environmental state${effectiveUV >= 2 && timePeriod.includes('day') ? ', cool sunlight, crisp shadows' : cloudCoverage >= 50 ? ', diffused cool lighting' : transitionType.includes('transition') ? ', transitional lighting with cool tones' : ', clear skies with cool illumination'}${timePeriod.includes('sunrise') ? ', cool morning light' : timePeriod.includes('sunset') ? ', cool evening light' : ''}`,
            `  - **Other Effects**: brisk atmosphere, light layered clothing visible, comfortable but fresh${effectiveUV >= 2 && timePeriod.includes('day') ? ', cool UV exposure' : cloudCoverage >= 30 ? ', soft diffused coolness' : ''}${transitionType === 'sunrise_transition' ? ', coolness lingering from night' : transitionType === 'sunset_transition' ? ', cooling intensifying in evening' : ''}`
        );
    } else if (adjustedTemp >= 0) {
        result.push(
            `### **Cold** (${uvIndex > 0 && effectiveUV >= 1 ? `UV: ${uvDescription}` : ''}${cloudCoverage > 10 ? cloudEffect : ''})`,
            `  - **Character Effects**: Chilled skin showing visible breath clouds, light shivering starting in thinner characters${effectiveUV >= 1 && cloudCoverage < 80 && timePeriod.includes('day') ? ', cold UV exposure without warmth' : ''}${transitionType === 'sunrise_transition' ? ', cold morning air with emerging light' : transitionType === 'sunset_transition' ? ', cold intensifying in fading light' : transitionType === 'twilight_transition' ? ', bitter twilight chill' : ''}${timePeriod.includes('night') ? ', night cold effects pronounced' : ''}`,
            `  - **Clothing**: Normal state, natural drape and movement${effectiveUV >= 1 && timePeriod.includes('day') ? ', sun protection if exposed' : ''}${transitionType === 'twilight_transition' ? ', heavier layers for night cold' : ''}`,
            `  - **Environmental**: Normal environmental state${effectiveUV >= 1 && timePeriod.includes('day') ? ', cold sunlight, sharp shadows' : cloudCoverage >= 50 ? ', diffused cold lighting' : transitionType.includes('transition') ? ', cold transitional lighting' : ', clear cold skies'}${timePeriod.includes('sunrise') ? ', cold morning light' : timePeriod.includes('sunset') ? ', cold evening light' : ''}`,
            `  - **Other Effects**: Chattering or clenching teeth, heavy layered clothing, shivering starting in slender characters${effectiveUV >= 1 && timePeriod.includes('day') ? ', cold UV exposure effects' : cloudCoverage >= 30 ? ', diffused cold atmosphere' : ''}${transitionType === 'sunrise_transition' ? ', cold air with morning light' : transitionType === 'sunset_transition' ? ', cold deepening in evening' : ''}`
        );
    } else {
        result.push(
            `### **Freezing** (${uvIndex > 0 && effectiveUV >= 1 ? `UV: ${uvDescription}` : ''}${cloudCoverage > 10 ? cloudEffect : ''})`,
            `  - **Character Effects**: Heavy shivering in all characters, frost forming on heavier clothing layers${effectiveUV >= 1 && cloudCoverage < 90 && timePeriod.includes('day') ? ', freezing UV exposure creating dangerous cold burn risk' : ''}${transitionType === 'sunrise_transition' ? ', freezing morning cold with weak light' : transitionType === 'sunset_transition' ? ', freezing cold intensifying rapidly' : transitionType === 'twilight_transition' ? ', deadly twilight freeze' : ''}${timePeriod.includes('night') ? ', extreme night freezing effects' : ''}`,
            `  - **Clothing**: Frost riming on outer layers, stiff frozen fabric, characters hunching to preserve heat${effectiveUV >= 1 && timePeriod.includes('day') ? ', frozen sun protection layers' : ''}${transitionType === 'twilight_transition' ? ', maximum cold weather protection needed' : ''}`,
            `  - **Environmental**: Frost coating all surfaces, ice formations, visible cold mist in air${effectiveUV >= 1 && timePeriod.includes('day') ? ', freezing sunlight, ice crystal sparkles' : cloudCoverage >= 50 ? ', diffused freezing lighting through clouds' : transitionType.includes('transition') ? ', freezing transitional lighting' : ', clear freezing skies'}${timePeriod.includes('sunrise') ? ', freezing morning light on ice' : timePeriod.includes('sunset') ? ', freezing evening light' : ''}`,
            `  - **Other Effects**: Intense shivering, frost forming on clothing, heavy winter clothing required${effectiveUV >= 1 && timePeriod.includes('day') ? ', dangerous UV cold burn on exposed skin' : cloudCoverage >= 30 ? ', diffused freezing atmosphere' : ''}${transitionType === 'sunrise_transition' ? ', freezing cold with minimal morning warmth' : transitionType === 'sunset_transition' ? ', rapid freezing in gathering dark' : ''}`
        );
    }

    return result;
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
        season: context.season,
        holiday: context.holidayInfo?.isHolidayPeriod ? context.holidayInfo.holidayName : null,
        timeOfDay: context.timePeriod?.timeOfDay || 'daytime',
        activity: context.activity,
        location: context.location
    };

    // Enhanced holiday awareness for clothing adaptation
    if (clothingContext.holiday) {
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
        const mappedHoliday = holidayMapping[clothingContext.holiday] || clothingContext.holiday.toLowerCase();
        clothingContext.holiday = mappedHoliday;
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

/**
 * Generate system message for dynamic generation AI
 * @param {Object} context - Current context (time, weather, etc.)
 * @param {Object} seasonalConfig - Seasonal configuration object with seasonalMode, forcedSeason, forcedHoliday
 * @param {boolean} backgroundFocus - Whether this is a background focus stage
 * @param {boolean} pipelineAware - Whether pipeline canvas awareness is enabled
 * @param {Object} stageContext - Stage context information (isInitial, isBackgroundFocus, isEnhance, hasPreview)
 * @param {string} directive - User directive for creative modifications
 * @param {Object} dynamicConfig - Dynamic configuration object including locked_replacements
 * @returns {Object} Object containing systemMessage array and userContentSections array
 */
function generateDynamicGenerationSystemMessage(context, seasonalConfig = {}, backgroundFocus = false, pipelineAware = false, stageContext = null, directive = null, dynamicConfig = {}, nsfw_level = 0) {
    const { time, weather, season: currentSeason, timePeriod, clothing, creative, optimize, activity, action, location, disable_holiday } = context;

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
    const seasonalType = seasonalConfig.type;
    const seasonalValue = seasonalConfig.value;
    const isCustomWeather = (typeof seasonalConfig.isCustomWeather !== 'boolean' && 
        seasonalConfig.isCustomWeather !== undefined && 
        seasonalConfig.isCustomWeather !== null);

    // Determine parameters for seasonal guidelines generation
    let seasonForGuidelines = currentSeason;
    let forcedHolidayForGuidelines = null;

    if (seasonalEnabled) {
        if (seasonalType === 'season') {
            seasonForGuidelines = seasonalValue; // Forced specific season
        } else if (seasonalType === 'holiday') {
            forcedHolidayForGuidelines = seasonalValue; // Forced specific holiday
        }
    }

    // Generate seasonal guidelines only if enabled
    const seasonalGuidelines = seasonalEnabled ? generateSeasonalGuidelines(time, seasonForGuidelines, seasonalEnabled, forcedHolidayForGuidelines, weather, disable_holiday) : {
        mode: 'disabled',
        guidelines: [
            'Seasonal modifications are not enabled, Focus only on weather and time-of-day elements',
            'Do not force any seasonal colors, themes, or environmental elements',
            'Avoid any references to seasons, holidays, or time-of-year contexts'
        ],
        holidayInfo: null,
        modifications: []
    };

    let userContentSections = [];
    
    let systemMessageContent = [
        'You are an unhinged and expert image generation prompt engineer for NovelAI v4.5 specializing in contextual adaptation and creative enhancement.',
        '',
        backgroundFocus ? [
            '**CRITICAL MISSION**: Transform prompts to emphasize background, environment, and atmospheric elements while maintaining character presence. Think like a landscape photographer - the environment is the star, characters are part of the scene.',
            '**MANDATORY APPROACH**: Prioritize environmental details, atmospheric effects, and scene depth. Characters should remain consistent but be integrated naturally into the expanded environment. Focus on what fills the new canvas space - landscapes, architecture, weather effects, lighting, and contextual elements.',
            '**BACKGROUND PRIORITY**: Add rich environmental descriptions, expand scene depth, enhance atmospheric elements, and create compelling backgrounds that tell a story.',
        ].join('\n') : [
            '**CRITICAL MISSION**: Transform static prompts into immersive visual narratives by seamlessly integrating weather/time elements. Think like a cinematographer - weather must feel organically part of the scene, never artificially grafted.',
            '**MANDATORY APPROACH**: Use detailed descriptive language that paints atmospheric scenes. Focus on natural enhancement, not forced additions. Maintain token efficiency while achieving visual coherence.',
        ].join('\n'),
        '',
        // ========================================
        // CRITICAL RULES - MUST FOLLOW ALWAYS
        // ========================================',
        '',
        '# 🚨 CRITICAL RULES - ABSOLUTE REQUIREMENTS',
        '',
        '## Protected Content - NEVER MODIFY',
        '**If you make any changes to this content it will be rejected by the system that processes it:**',
        '• "artist:" or "style:" tags - leave exactly as written (ABSOLUTELY FORBIDDEN to modify)',
        '• !% ... % protected blocks - user-specified content (Starts with "!%")',
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
        '## Text Replacement Uniqueness - CRITICAL',
        '',
        '### Rule: select_text MUST BE UNIQUE',
        '**CRITICAL**: `select_text` MUST appear only ONCE in the prompt',
        '',
        '**❌ COMMON MISTAKES:**',
        '• "::" - appears in ALL emphasis weights (1.5::text::, 2.0::word::, etc.)',
        '• "," - appears after EVERY tag',
        '• "girl" - too common, appears multiple times',
        '• Single words - almost always non-unique',
        '',
        '**✅ CORRECT APPROACH:**',
        '• Include 3-5 words of context around your target',
        '• Use surrounding words to create unique phrase',
        '• Check that phrase appears only ONCE in prompt',
        '• If unsure, use longer phrase with more context',
        '',
        '**Examples:**',
        '```',
        '❌ "select_text": "::"',
        '   → BAD: Appears in 1.5::word::, 2.0::tag::, etc.',
        '   ✅ "select_text": "soft focus, dutch angle ::"',
        '',
        '❌ "select_text": "standing"',
        '   → BAD: May appear multiple times',
        '   ✅ "select_text": "1girl, standing in park"',
        '',
        '❌ "select_text": "girl"',
        '   → BAD: Too common',
        '   ✅ "select_text": "1girl, detailed face"',
        '```',
        '',
        '**For Appending:**',
        '• If appending to END of prompt → **omit `select_text` entirely**',
        '• If appending AFTER specific text → make that text UNIQUE',
        '',
        '## 🎯 REPLACEMENT PLANNING - CRITICAL PROCESS',
        '',
        '**BEFORE creating ANY text_replacements, you MUST plan the complete array:**',
        '',
        '### ABSOLUTE REQUIREMENTS',
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
        '```json',
        '// ❌ WRONG - Overlapping selections:',
        '[',
        '  {"select_text": "standing in park", "replace_text": "sitting in park"},',
        '  {"select_text": "in park", "replace_text": "in rainy park"}',
        ']',
        '// Problem: "in park" is INSIDE "standing in park" - they overlap',
        '',
        '// ✅ CORRECT - Distinct selections:',
        '[',
        '  {"select_text": "standing in park", "replace_text": "sitting in rainy park"}',
        ']',
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
        '```json',
        '// ❌ WRONG - Chain replacement (modifying own addition):',
        '[',
        '  {"select_text": "city", "replace_text": "rainy city"},',
        '  {"select_text": "rainy city", "replace_text": "dark rainy city"}',
        ']',
        '// Problem: Second replacement targets text added by first replacement',
        '',
        '// ✅ CORRECT - Single complete replacement:',
        '[',
        '  {"select_text": "city", "replace_text": "dark rainy city"}',
        ']',
        '// Solution: Do it right the first time',
        '',
        '// ❌ WRONG - Dependency chain:',
        '[',
        '  {"select_text": "sunny", "replace_text": "overcast"},',
        '  {"select_text": "bright overcast day", "replace_text": "dim overcast day"}',
        ']',
        '// Problem: Second depends on first completing successfully',
        '',
        '// ✅ CORRECT - Independent replacements:',
        '[',
        '  {"select_text": "sunny", "replace_text": "overcast"},',
        '  {"select_text": "bright day", "replace_text": "dim day"}',
        ']',
        '// Solution: Both target ORIGINAL text independently',
        '```',
        '',
        '### PRE-SUBMISSION VALIDATION CHECKLIST',
        '',
        '**BEFORE submitting your response, verify EVERY replacement:**',
        '',
        '✓ **Uniqueness in Prompt**: Each `select_text` appears ONLY ONCE in original prompt',
        '✓ **Uniqueness in Array**: Each `select_text` appears ONLY ONCE in your replacement array',
        '   → CRITICAL: Same select_text twice = INVALID (e.g., "1.35::realistic lighting" used twice)',
        '✓ **Existence**: Each `select_text` EXISTS in current prompt',
        '✓ **No Verbatim**: No exact phrases copied from input or context data',
        '✓ **No Overlap**: No `select_text` overlaps with another `select_text`',
        '✓ **No Chains**: No replacement modifies content added by another replacement',
        '✓ **Independence**: Each replacement works on ORIGINAL text only',
        '✓ **APPEND Validity**: Every APPEND action has non-empty `replace_text`',
        '   → CRITICAL: `"replace_text": ""` with `"action": "append"` is INVALID',
        '✓ **Completeness**: Think: "If I apply these in sequence, are they independent?" → Must be YES',
        '',
        '### VALIDATION QUESTIONS TO ASK YOURSELF',
        '',
        '**Before submitting, answer these:**',
        '',
        '1. **"Did I copy any exact phrases from the input?"**',
        '   → If YES: Transform them instead',
        '',
        '2. **"Do any of my select_text values appear MORE THAN ONCE in my array?"**',
        '   → If YES: You have DUPLICATE selections - COMBINE them into ONE replacement',
        '   Example: If you select "1.35::realistic lighting" twice, you\'re creating a conflict',
        '',
        '3. **"Do any of my select_text values overlap or nest?"**',
        '   → If YES: Combine into single replacement or make truly distinct',
        '',
        '4. **"Does replacement #2 depend on #1\'s output?"**',
        '   → If YES: You\'re creating a chain - FIX IT',
        '',
        '5. **"Are all my select_text values targeting ORIGINAL prompt text?"**',
        '   → If NO: You\'re modifying your own additions - FIX IT',
        '',
        '6. **"For APPEND actions: Do I have actual content in replace_text?"**',
        '   → Empty replace_text with append is INVALID',
        '   → If replace_text is "" (empty), you cannot use append action',
        '',
        '7. **"If I randomized the order of replacements, would they still work?"**',
        '   → If NO: You have dependencies - FIX IT',
        '',
        '### COMMON PLANNING ERRORS',
        '',
        '**Error 1: Duplicate Selections (SAME select_text used multiple times)**',
        '```json',
        '// ❌ CRITICAL ERROR - selecting same text twice:',
        '[',
        '  {"select_text": "1.35::realistic lighting", "replace_text": "2.0::pregnant body::, 1.35::realistic lighting"},',
        '  {"select_text": "1.35::realistic lighting", "replace_text": "1.35::diffused lighting under overcast sky::"}',
        ']',
        '// Problem: Second replacement cannot find "1.35::realistic lighting" because first one already modified it!',
        '',
        '// ✅ CORRECT - Combine into single replacement:',
        '[',
        '  {"select_text": "1.35::realistic lighting", "replace_text": "2.0::pregnant body::, 1.35::diffused lighting under overcast sky::"}',
        ']',
        '// Solution: Single replacement does everything at once',
        '```',
        '',
        '**Error 2: Invalid APPEND with Empty replace_text**',
        '```json',
        '// ❌ CRITICAL ERROR - append with no content:',
        '{"select_text": ", bad perspective", "replace_text": "", "action": "append"}',
        '// Problem: APPEND requires actual content to add. Empty string is INVALID.',
        '',
        '// ✅ CORRECT - Provide actual content:',
        '{"action": "append", "replace_text": "bright daylight, sunny, clear sky"}',
        '// Solution: Append actual UC opposites',
        '',
        '// OR if you want to DELETE:',
        '{"select_text": ", bad perspective", "action": "delete"}',
        '// Solution: Use DELETE action instead',
        '```',
        '',
        '**Error 3: Incremental Refinement**',
        '```json',
        '// ❌ Thinking: "I\'ll add rainy, then make it heavy rainy"',
        '[',
        '  {"select_text": "day", "replace_text": "rainy day"},',
        '  {"select_text": "rainy day", "replace_text": "heavy rainy day"}',
        ']',
        '',
        '// ✅ Thinking: "I want heavy rainy day as the final result"',
        '[',
        '  {"select_text": "day", "replace_text": "heavy rainy day"}',
        ']',
        '```',
        '',
        '**Error 2: Cross-Boundary Selection**',
        '```json',
        '// ❌ Selecting across emphasis group boundaries',
        '// Original: "1.5::detailed face 2.0::weather::"',
        '[',
        '  {"select_text": "face 2.0::weather", "replace_text": "face, eyes 2.5::rainy weather"}',
        ']',
        '// Problem: Crosses group boundary',
        '',
        '// ✅ Respecting group boundaries',
        '[',
        '  {"select_text": "face ", "replace_text": "face, eyes "},',
        '  {"select_text": "2.0::weather::", "replace_text": "2.5::rainy weather::"}',
        ']',
        '// Solution: Separate replacements for each group',
        '```',
        '',
        '**Error 3: Nested Selections**',
        '```json',
        '// ❌ One selection inside another',
        '[',
        '  {"select_text": "girl standing in park wearing dress", "replace_text": "..."},',
        '  {"select_text": "wearing dress", "replace_text": "wearing raincoat"}',
        ']',
        '// Problem: Second selection is INSIDE first',
        '',
        '// ✅ Distinct or combined',
        '[',
        '  {"select_text": "girl standing in park wearing dress", "replace_text": "girl standing in rainy park wearing raincoat"}',
        ']',
        '// Solution: Single comprehensive replacement',
        '```',
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
        // Add pipeline-aware instructions if enabled
        pipelineAware && stageContext ? [
            '',
            stageContext.isInitial ? [
                '## 🎬 PIPELINE STAGE: INITIAL GENERATION (PRIMARY FOCUS)',
                '**STAGE CONTEXT**: You are working on the INITIAL stage of a multi-stage pipeline. This prompt is specifically about the PRIMARY FOCUS/SUBJECT.',
                '',
                '**ANALYSIS REQUIREMENTS**:',
                '• Analyze input prompt: view angle, perspective, framing, composition',
                '• Determine subject positioning and available space',
                '• Consider how subject fits within frame',
                '',
                '**MODIFICATION APPROACH**:',
                '• Make text replacements knowing that later stages will fill in background details',
                '• Keep the focus on the subject - background will be expanded in subsequent stages',
                '• Ensure subject is well-defined and positioned appropriately for future expansion',
                '• Don\'t over-detail the background - save that for the background expansion stage',
                '',
                stageContext.hasPreview ? [
                    '**PREVIEW IMAGE REFERENCE**:',
                    'Use preview as visual reference for: Character appearance/attire, environment context, actions/pose, scene composition',
                    '',
                    '**ANALYZE TIME OF DAY & WEATHER FROM PREVIEW**:',
                    '• Nighttime detected → AMPLIFY: night lighting, darkness, shadows, moon/starlight, nocturnal ambiance',
                    '• Daytime → Match and enhance visible time-of-day atmosphere (morning/noon/afternoon/golden hour)',
                    '• Weather visible → Amplify descriptions to match preview (rain/snow/fog/clouds/wind effects)',
                    '',
                    '**PRESERVE**: Character appearance, clothing style, core pose, environment type',
                    '**ADAPT**: Weather effects on clothing, lighting, seasonal/time-of-day elements',
                    '**AMPLIFY detected conditions**: If preview shows nighttime/specific weather, enhance descriptions significantly',
                    ''
                ].join('\n') : '',
                ''
            ].join('\n') : stageContext.isBackgroundFocus ? [
                '## 🌄 PIPELINE STAGE: BACKGROUND EXPANSION',
                '**You are working on BACKGROUND EXPANSION - image from previous generation with padding applied.**',
                '',
                '**Analysis**: Identify foreground area and new canvas space, determine expandable background elements',
                '',
                '**REMOVE**: Character expressions/emotions, character-specific actions, facial details, interaction descriptions, body-part details, character-centric descriptors, focus indicators',
                '',
                '**KEEP**: Location/setting, architectural elements, landscape features, weather/atmospheric effects, lighting/time-of-day, environmental objects, depth indicators',
                '',
                '**ADD**: Scene depth/distance elements, environmental storytelling, atmospheric effects (fog/clouds), background architecture/landscapes, perspective cues',
                '',
                '**Approach**: Remove character-specific phrases, add rich environmental descriptions, maintain consistency, focus on atmosphere and depth',
                ''
            ].join('\n') : stageContext.isEnhance ? [
                '## ✨ PIPELINE STAGE: ENHANCEMENT',
                '**You are working on ENHANCEMENT stage with the full composed image.**',
                '',
                '**Requirements**: Analyze entire image for missing/incorrect details, address inconsistencies/quality issues, refine details, polish final result',
                '**Approach**: Make refinements improving composition, fix issues/artifacts, enhance needed details, ensure cohesive integration',
                ''
            ].join('\n') : ''
        ].join('\n') : '',
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
        // TOKEN MANAGEMENT
        // ========================================
        '',
        '# 💰 TOKEN MANAGEMENT & LIMITS',
        '',
        '## 🚨 Hard Limits - ABSOLUTE',
        '**512 tokens for prompt (base + ALL character prompts), 512 tokens for UC (negative + ALL character negatives)**',
        '⚠️ **Exceeding limits causes generation failure** - Be concise, prioritize impactful modifications, enhance quality without bloating',
        '',
        '**Important**: Percentages below are guidelines for planning. The 512 limit is absolute and enforced.',
        '',
        '## 📊 Token Budget Strategy (Planning Guidelines)',
        '• Prompt or UC: Reserve 60-70% for original content',
        '• Enhancements: Use 20-30% for contextual additions',
        '• Buffer: Keep 10% margin for processing overhead',
        '',
        // ========================================
        // WEATHER & TIME INTEGRATION FRAMEWORK
        // ========================================
        '',
        '# 🌦️ WEATHER & TIME INTEGRATION FRAMEWORK',
        '',
        '## Core Principle: Visual Translation through Reasoning',
        '**Convert weather/time concepts to visual elements - DO NOT write conceptual descriptions or verbatim context data directly in prompts.**',
        '',
        '**CRITICAL: NEVER copy context data verbatim. Always REASON and TRANSFORM:**',
        '• Context says "overcast" → Reason into "cloudy sky, diffused lighting, soft shadows"',
        '• Context says "18°C evening" → Reason into "cool twilight air, comfortable temperature"',
        '• Context says "heavy rain" → Reason into "torrential downpour, rain-slicked surfaces, water streaming"',
        '',
        '**Translation Process:**',
        '1. **REASON** about the weather/time data (don\'t copy it)',
        '2. Identify physical response from conditions (e.g., "heat" → visible sweat, seeking shade)',
        '3. Match to character characteristics (build, weight, clothing)',
        '4. ALWAYS include explicit markers through reasoning: time ("night", "daytime", "dawn") AND weather ("overcast", "clear sky")',
        '5. Create specific text_replacements with VISUAL DESCRIPTORS (not verbatim context)',
        '',
        '⚠️ **Key Distinction**: Humidity = moisture in air (sweat, condensation). Precipitation = rain/snow falling.',
        '',
        '## Scene Type Framework - CRITICAL DECISION',
        '**Determine scene type FIRST - this controls how to apply all weather/time data:**',
        '',
        '### INDOOR ONLY: Scenes entirely within buildings, rooms, or enclosed spaces',
        '**Application**: INDIRECT through windows, doors, openings',
        '**Examples**: "rain pattering on windowpanes", "snow visible through glass", "condensation on glass from humidity"',
        '**Character Impact**: Indirect (room temperature changes, atmospheric pressure, visible weather through windows)',
        '**Strong tokens**: intense, soft, glowing, gentle, breeze, humid, condensation',
        '',
        '### OUTDOOR ONLY: Scenes in open exterior spaces, streets, landscapes, wilderness',
        '**Application**: DIRECT to all elements',
        '**Examples**: "damp rain-slicked surfaces", "wind-swept landscape", "sweat running down skin", "hair whipping in wind"',
        '**Character Impact**: Direct physical reactions (sweating, shivering, wind effects)',
        '**Strong tokens**: damp, shimmer, harsh, intense, gentle, breeze, glowing',
        '',
        '### MIXED/TRANSITIONAL: Scenes with both indoor and outdoor elements',
        '**Application**: CONTEXTUAL - direct for outdoor areas, indirect for indoor areas',
        '**Examples**: "rain blowing through door", "wet footprints inside", outdoor + indoor descriptions',
        '',
        '## Character Physical Response Integration',
        '**Character reactions are conceptual - translate to VISUAL cues:**',
        '',
        '### Physical Characteristics Matter',
        `• **Body Build**: Analyze weight${clothing ? ', clothing' : ''}, physical condition`,
        '• **Weight-Based Sweating**: Heavier characters sweat more (consider: chubby → overweight → fat → obese → morbidly obese)',
        '• **Wind Sensitivity**: Slender characters feel wind chill more, heavier characters more wind-resistant',
        ...(clothing ? ['• **Clothing Factors**: Tight clothing shows sweat stains, loose clothing blows in wind'] : []),
        '• **Fatigue Indicators**: Heat exhaustion, shivering, blue-tinged skin (cold)',
        '• **Facial Expressions**: Squinting (sun), grimacing (cold), flushed cheeks (heat)',
        '• **Comfort Zones**: Adjust based on whether character appears comfortable or distressed',
        '• **Shelter Seeking**: Characters may seek shade, cover from rain, or warmth based on physical state',
        '• **Activity Adaptation**: Characters modify behavior based on conditions (seeking shelter in storms, staying cool in heat) unless doing weather-related activities (fishing, snowboarding, walking outside, etc.)',
        '',
        '### Environmental Context Examples',
        '**Temperature**: "rosy cheeks from warmth" (outdoor) vs "room feels cooler near windows" (indoor)',
        '**Moisture**: "sweaty skin" (outdoor) vs "condensation on glass" (indoor)',
        '**Wind**: "hair tousled by breeze" (outdoor) vs "curtains fluttering from drafts" (indoor)',
        '**Activity States**: "comfortable in moderate conditions" or "layered against cold"',
        '',
        '## Translation Examples with Explicit Markers',
        '**REQUIRED FORMAT - Always combine time + weather markers:**',
        '',
        '**Time + Weather Combinations:**',
        '• Night + Overcast → "night, dark, nighttime, overcast sky, cloudy, deep shadows, dim lighting"',
        '• Daytime + Overcast → "daytime, overcast sky, cloudy, diffused lighting, soft shadows"',
        '• Night + Clear → "night, dark, nighttime, clear sky, stars visible, deep shadows, moonlight"',
        '• Daytime Heat → "daytime, sunny, bright, sweat glistening, seeking shade, flushed from warmth"',
        '• Morning Dawn → "morning, dawn, early morning, dim light of sunrise, soft shadows, cool dawn air"',
        '• Evening Twilight → "evening, twilight, sunset, dim light of sunset, orange/purple sky, soft shadows"',
        '',
        '**Weather Data to Visual Elements:**',
        '• High humidity + heat → shimmer, heat haze, sweat effects',
        '• Wind + precipitation → rain lashing sideways, wind-driven droplets',
        '• Low visibility → fog layers, muted colors, obscured distances',
        '• High UV + clear sky → harsh sunlight, deep shadows, squinting',
        '',
        '**Character Response Examples (Optimized Tokens):**',
        `• Hot + Heavier Character → "sweat dripping, heavy breathing${clothing ? ', damp clothes clinging' : ''}, exhausted expression"`,
        '  → Uses strong tokens: sweat (9.18), damp (9.28)',
        '• Cold + Slender Character → "shivering, huddled posture, visible breath in cold air, chattering teeth"',
        '  → Uses strong visual descriptors',
        '• Heat exhaustion → "sweat beading on forehead, flushed cheeks, heavy breathing"',
        '• Cold response → "shivering visibly, hunched against cold, breath misting in air"',
        '• Wind effects → "hair whipping in wind, clothes pressed against body"',
        '',
        '## Weather Element Mapping',
        '• **Dew point** → moisture effects (mist, condensation, humidity haze)',
        '• **Cloud coverage** → lighting conditions, atmospheric mood',
        '• **Pressure systems** → wind patterns, atmospheric stability',
        '• **UV index** → sunlight intensity, shadow harshness, contrast',
        '• **Visibility** → fog, mist, atmospheric perspective effects',
        '',
        '**Strong Tokens Reference (weather/atmosphere):**',
        'condensation:9.6, shimmer:9.53, glowing:9.49, dawn:9.4, intricate:9.38, humid:9.36, glow:9.32, breeze:9.3, damp:9.28, sweat:9.18',
        '',
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
        '• `reason`: Why this change was made (1-2 sentences)',
        '• `reason_display`: Short UI summary (2-5 words)',
        '• `replacement_category`: Category enum from allowed list (see Category Reference below)',
        '',
        '**Best practices**:',
        '• Choose short segments (1-5 words) for reliability',
        '• Use `fallback_select_text` as backup for multi-word phrases',
        '• Verify text exists BEFORE creating replacement',
        '',
        '**Example**:',
        '```json',
        '{"select_text": "city street", "replace_text": "rainy city street at dusk", "action": "replace", "reason": "Add weather and time to match context", "reason_display": "Weather/Time", "replacement_category": "Weather"}',
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
        '```json',
        '{',
        '  "replace_text": "photorealistic autumn cityscape background",',
        '  "action": "append",',
        '  "reason": "Add missing background detail to complete scene",',
        '  "reason_display": "Add background",',
        '  "replacement_category": "Enhancement"',
        '}',
        '```',
        '⚠️ **CRITICAL REQUIREMENTS:**',
        '• **`replace_text` MUST have actual content** - cannot be empty',
        '• **DO NOT include `select_text` field** - leave it out completely for end append',
        '❌ WRONG: `"select_text": "::append to end::"` or `"select_text": "::"` or `"replace_text": ""`',
        '✅ CORRECT: No `select_text` field, and `replace_text` has content',
        '',
        '**MODE 2: Append AFTER specific text**',
        '```json',
        '{',
        '  "select_text": "soft focus, dutch angle",',
        '  "replace_text": ", dim twilight illumination",',
        '  "action": "append",',
        '  "reason": "Add lighting specification after composition details",',
        '  "reason_display": "Add lighting",',
        '  "replacement_category": "Lighting"',
        '}',
        '```',
        '⚠️ **CRITICAL REQUIREMENTS:**',
        '• **`replace_text` MUST have actual content** - cannot be empty',
        '• **Include `select_text`** ONLY when inserting after specific text',
        '',
        '**🚨 CRITICAL APPEND REQUIREMENT:**',
        '**`replace_text` MUST contain actual content - empty string is INVALID**',
        '',
        '```json',
        '// ❌ INVALID - empty replace_text:',
        '{"action": "append", "replace_text": "", "reason": "...", "reason_display": "..."}',
        '{"select_text": "text", "replace_text": "", "action": "append", "reason": "...", "reason_display": "..."}',
        '// Problem: Nothing to append',
        '',
        '// ✅ VALID - actual content:',
        '{"action": "append", "replace_text": "bright daylight, sunny", "reason": "Add time and weather", "reason_display": "Time/Weather", "replacement_category": "Weather"}',
        '{"select_text": "text", "replace_text": ", additional content", "action": "append", "reason": "Add detail", "reason_display": "Add detail", "replacement_category": "Enhancement"}',
        '// Solution: Provide the content to add AND required fields',
        '```',
        '',
        '**If you want to add nothing, don\'t create the replacement at all.**',
        '',
        '---',
        '',
        '### 🗑️ DELETE - Remove Text',
        '**When to use**: Remove conflicting elements (use sparingly - if unsure, skip)',
        '',
        '**Required fields**:',
        '• `select_text`: EXACT unique text to remove (REQUIRED)',
        '• `action`: "delete"',
        '• `reason`: Why this text needs removal (1-2 sentences)',
        '• `reason_display`: Short UI summary (2-5 words)',
        '• `replacement_category`: Category enum from allowed list (see Category Reference below)',
        '',
        '**Note**: `replace_text` should be omitted or empty for DELETE action',
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
        '```json',
        '// Remove first occurrence only',
        '{"select_text": "big belly", "action": "delete", "count": 1, "reason": "Conflicts with directive requirements", "reason_display": "Remove conflict", "replacement_category": "Conflict Resolution", "is_critical": true}',
        '',
        '// Remove all occurrences - mark non-critical if might not exist',
        '{"select_text": "exposed stomach", "action": "delete", "reason": "Conflicts with clothing description", "reason_display": "Remove conflict", "replacement_category": "Conflict Resolution", "is_critical": false}',
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
        '**EVERY replacement MUST include these REQUIRED fields**:',
        '',
        '**`reason`** (REQUIRED - string):',
        '• Full explanation of WHY this change was made (1-2 sentences)',
        '• Be specific about the purpose',
        '• Example: "Add autumn weather effects to match season and enhance atmosphere"',
        '',
        '**`reason_display`** (REQUIRED - string):',
        '• Very short version for UI display (2-5 words maximum)',
        '• Concise summary of the reason',
        '• Example: "Autumn weather"',
        '',
        '**`replacement_category`** (REQUIRED - enum):',
        '• See "Replacement Category Reference" section below for complete list and usage',
        '• MUST be exactly one of the allowed category values',
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
        '### Core Categories',
        '',
        '**"Weather"**',
        '• Adding/modifying weather conditions (rain, snow, clouds, clear, fog, etc.)',
        '• Weather-related atmospheric effects (mist, haze, precipitation)',
        '• Weather markers and descriptions',
        '• Example: Adding "overcast sky" or replacing "sunny" with "rainy"',
        '',
        '**"Time of Day"**',
        '• Adding/modifying time-specific elements (dawn, dusk, night, day, etc.)',
        '• Time-related lighting (morning light, evening shadows, nighttime darkness)',
        '• Time markers and descriptions',
        '• Example: Adding "nighttime" or replacing "daylight" with "twilight"',
        '',
        '**"Lighting"**',
        '• Light quality and characteristics (soft, harsh, diffused, dramatic)',
        '• Light sources (streetlights, moonlight, artificial lights)',
        '• Lighting effects (shadows, highlights, glow, reflections)',
        '• Example: Adding "dim lighting" or "dramatic shadows"',
        '',
        '**"Atmosphere"**',
        '• General atmospheric qualities (moody, serene, tense, peaceful)',
        '• Environmental mood and ambiance',
        '• Sensory details (cool air, humid atmosphere, crisp conditions)',
        '• Example: Adding "cool evening air" or "tense atmosphere"',
        '',
        '**"Seasonal"**',
        '• Season-specific elements (autumn leaves, winter snow, spring blooms)',
        '• Seasonal characteristics and markers',
        '• Seasonal environmental details',
        '• Example: Adding "autumn foliage" or "winter frost"',
        '',
        '**"Holiday"**',
        '• Holiday-specific decorations or elements',
        '• Festive atmosphere and details',
        '• Holiday markers',
        '• Example: Adding "Christmas lights" or "Halloween decorations"',
        '',
        '### Content Refinement Categories',
        '',
        '**"Enhancement"**',
        '• General quality improvements to existing descriptions',
        '• Adding detail or specificity to vague terms',
        '• Enriching character, object, or scene descriptions',
        '• Example: "city" → "bustling modern city" or adding "detailed background"',
        '',
        '**"Action Verbs"**',
        '• Modifying character actions and poses',
        '• Adding or changing action descriptions',
        '• Refining movement and gesture details',
        '• Example: "standing" → "standing confidently" or "walking" → "striding purposefully"',
        '',
        '**"Text Overlay"**',
        '• **CRITICAL RULE**: ONLY use this category if ", Text:" already exists in the prompt',
        '• **ABSOLUTELY DO NOT** add new ", Text:" sections to the prompt yourself',
        '• This category is ONLY for modifying existing text that appears after ", Text:" boundary',
        '• **AI Text Generation Placeholders**: If you see placeholder text like `[SPEECH_TEXT_INSERT]`, `[THOUGHT_TEXT_INSERT]`, or `[CAPTION_TEXT_INSERT]`:',
        '  - This IS an existing ", Text:" section that you SHOULD modify',
        '  - Replace the ENTIRE placeholder (including brackets) with 1-2 SHORT sentences of contextually appropriate text',
        '  - **MAXIMUM 20 WORDS** - Keep it extremely concise',
        '  - **DO NOT wrap the generated text in quotation marks** - raw text only',
        '  - **USE the creative directive story** to generate contextually appropriate text',
        '  - For SPEECH: Natural brief text the character would say based on directive story',
        '  - For THOUGHT: Short internal thought or contemplation based on directive',
        '  - For CAPTION/SUBTITLE: Brief narration or scene description based on directive',
        '  - Examples: I can\'t believe how much they\'ve grown!\n\n The rain feels nice on my skin.',
        '• Note: This is one of only TWO categories allowed to modify text after ", Text:" boundary',
        '',
        '**"Spelling"**',
        '• Correcting typos and spelling errors',
        '• Fixing grammatical mistakes',
        '• Note: This is one of only TWO categories allowed to modify text after ", Text:"',
        '',
        '### Special Categories',
        '',
        '**"Conflict Resolution"**',
        '• Removing elements that conflict with weather/time/season/directive',
        '• Deleting contradictory descriptions',
        '• Resolving incompatible elements',
        '• Example: Removing "bright sunlight" when time is nighttime',
        '',
        '**"Directive"**',
        '• **ONLY use when user directive requests something that doesn\'t fit other categories**',
        '• Changes specifically requested by creative directive',
        '• Should be used sparingly - prefer specific categories when possible',
        '• **CRITICAL**: Do NOT add ", Text:" sections from directive stories - text overlays are explicit user features',
        '• **CRITICAL**: Stories in directive are for context/mood - NOT for creating overlay text',
        '• Example: User says "make her hat bigger" and hat modifications don\'t fit other categories',
        '',
        '**Category Selection Rules:**',
        '1. Always prefer the MOST SPECIFIC category',
        '2. Weather/time/lighting/atmosphere take priority over "Enhancement"',
        '3. Only use "Directive" when no other category fits the user\'s request',
        '4. Only "Spelling" and "Text Overlay" can modify text after ", Text:" boundary',
        '',
        '---',
        '',
        '## 🎯 Integration Strategy',
        '',
        '**REPLACE when possible (smart enhancement)**:',
        '• Object: "espresso" → "espresso with condensation"',
        '• Setting: "city" → "city sidewalk at dusk"',
        '• Character: "detailed face" → "detailed face with moisture"',
        '• Lighting: "realistic lighting" → "diffused twilight"',
        '',
        '**APPEND for new concepts**:',
        '• Atmospheric effects not in original',
        '• Multiple weather/time enhancements',
        '• Background elements',
        '• Safe fallback when uncertain',
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
        '### What Are Emphasis Groups?',
        'Emphasis groups use the syntax: `weight::content::` where:',
        '• `weight` = multiplier from -9.0 to 5.0+ (can be decimals like 1.5, 2.3, -0.8)',
        '• `content` = the text being weighted',
        '• `::` = delimiters that define boundaries',
        '',
        '### What Can Be Emphasized?',
        '',
        '**Emphasis can be applied to ANY content - from single words to complex phrases:**',
        '',
        '**Single Words:**',
        '• `1.5::rainy::` - emphasize just the word "rainy"',
        '• `2.0::detailed::` - emphasize "detailed"',
        '• `1.3::evening::` - emphasize "evening"',
        '',
        '**Concepts:**',
        '• `1.8::wet pavement::` - emphasize the wet pavement concept',
        '• `2.0::overcast sky::` - emphasize overcast conditions',
        '• `1.5::cool atmosphere::` - emphasize atmospheric feeling',
        '',
        '**Full Phrases:**',
        '• `1.5::standing in rain-soaked park::` - emphasize entire action and location',
        '• `2.0::detailed face with contemplative expression::` - emphasize character description',
        '',
        '**Multiple Elements (consecutive groups):**',
        '• `1.5::rainy 2.0::wet streets 1.3::evening lighting::` - different emphasis for each concept',
        '',
        '**Key Point: You can emphasize as granularly or broadly as needed.**',
        '• Single keyword: `2.0::rain::`',
        '• Compound concept: `2.0::heavy rain, wet surfaces::`',
        '• Both in same prompt: `1.8::rain 2.0::wet pavement::, city street`',
        '',
        '### Syntax Structure & Boundaries',
        '`weight::content::`',
        '• First `weight::` = starts the group',
        '• Content = what gets emphasized',
        '• Final `::` = terminates the group (marks end)',
        '',
        '**CRITICAL: Emphasis groups are ABSOLUTE groups with clear boundaries**',
        '',
        '### Consecutive Groups - Important Behavior',
        '**When groups are consecutive, the next group START acts as the previous group TERMINATOR:**',
        '',
        '**Valid format:** `1.5::content one 2.0::content two::`',
        '• First group: weight=1.5, content="content one " (terminated by `2.0::`)',
        '• Second group: weight=2.0, content="content two" (terminated by `::`)',
        '• The `2.0::` serves DUAL purpose: terminates first group AND starts second group',
        '• ONLY the LAST group needs explicit `::` terminator',
        '• No double `::` between groups - the shared `weight::` serves both purposes',
        '',
        '**Examples of consecutive groups:**',
        '```',
        '1.5::detailed face 2.0::rainy weather::',
        '→ Group 1: weight=1.5, content="detailed face "',
        '→ Group 2: weight=2.0, content="rainy weather"',
        '',
        '1.3::sitting 1.8::wet pavement 2.2::overcast sky::',
        '→ Group 1: weight=1.3, content="sitting "',
        '→ Group 2: weight=1.8, content="wet pavement "',
        '→ Group 3: weight=2.2, content="overcast sky"',
        '```',
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
        '### How to Modify Emphasis Groups',
        '',
        '#### Modifying CONTENT Inside a Group',
        '',
        '**To change content while preserving weight:**',
        '```json',
        '// Original: "1.5::standing in park::"',
        '{"select_text": "standing in park", "replace_text": "standing in rainy park", "action": "replace"}',
        '// Result: "1.5::standing in rainy park::"',
        '```',
        '',
        '**Important:** Select ONLY the content, not the weight or delimiters',
        '',
        '#### Modifying WEIGHT of a Group',
        '',
        '**To change the weight, select the ENTIRE group:**',
        '```json',
        '// Original: "1.5::detailed face, blue eyes::"',
        '{"select_text": "1.5::detailed face, blue eyes::", "replace_text": "2.0::detailed face, blue eyes::", "action": "replace"}',
        '// Result: "2.0::detailed face, blue eyes::"',
        '```',
        '',
        '**Critical:** Must select from `weight::` through the terminating `::` BEFORE the next group or end',
        '',
        '#### Working with Consecutive Groups',
        '',
        '```',
        'Original: "1girl, 1.5::detailed face 2.0::rainy weather::, standing"',
        '',
        'To change "detailed face" weight to 2.5:',
        '  select_text: "1.5::detailed face "',
        '  replace_text: "2.5::detailed face "',
        '  Result: "1girl, 2.5::detailed face 2.0::rainy weather::, standing"',
        '',
        'To modify weather content:',
        '  select_text: "rainy weather"',
        '  replace_text: "heavy rainy weather"',
        '  Result: "1girl, 1.5::detailed face 2.0::heavy rainy weather::, standing"',
        '',
        'To change weather weight:',
        '  select_text: "2.0::rainy weather::"',
        '  replace_text: "2.5::rainy weather::"',
        '  Result: "1girl, 1.5::detailed face 2.5::rainy weather::, standing"',
        '```',
        '',
        '### How to Create Emphasis Groups',
        '',
        '**Method 1 - Wrap existing content:**',
        '```json',
        '{"select_text": "detailed background", "replace_text": "1.8::detailed background::", "action": "replace"}',
        '```',
        '',
        '**Method 2 - Append with emphasis:**',
        '```json',
        '{"action": "append", "replace_text": ", 2.0::wet pavement, rain puddles::", "reason": "Add emphasized weather elements"}',
        '```',
        '',
        '**Method 3 - Create multiple consecutive groups:**',
        '```json',
        '{"select_text": "city street", "replace_text": "1.5::rain-soaked city street 2.0::overcast sky::", "action": "replace"}',
        '```',
        '',
        '### NEGATIVE EMPHASIS (-9.0 to 0)',
        '',
        '**Purpose**: REMOVE or CONFLICT unwanted attributes',
        '',
        '**When to Use:**',
        '• ONLY for extreme cases where you need to actively REMOVE attributes',
        '• To conflict overlaying attributes (e.g., preventing multiple conflicting styles)',
        '• When positive emphasis alone isn\'t working',
        '• In UC (negative prompt) when you need to reduce avoidance intensity',
        '',
        '**Common Use Cases:**',
        '',
        '**1. Conflicting Art Styles:**',
        '```',
        'Prompt: "realistic photograph, -3.0::anime style -2.5::cartoon -2.0::3d render::"',
        '```',
        'Prevents anime/cartoon/3d when you want photorealistic',
        '',
        '**2. Removing Specific Attributes:**',
        '```',
        'Prompt: "outdoor scene, -2.0::indoor -1.5::room -1.0::furniture::"',
        '```',
        'Actively prevents indoor elements',
        '',
        '**3. In UC (Negative Prompt):**',
        '```',
        'UC: "2.0::anime -1.5::realistic::"',
        '```',
        '• Positive values in UC = emphasize AVOIDING this (2.0::anime:: = strongly avoid anime)',
        '• Negative values in UC = reduce avoidance (-1.5::realistic:: = less strictly avoid realistic)',
        '',
        '**IMPORTANT NEGATIVE EMPHASIS RULES:**',
        '• Use sparingly - only when positive emphasis alone doesn\'t work',
        '• Stronger negative = stronger removal (-5.0 stronger than -1.0)',
        '• In UC: positive values emphasize what to AVOID, negative values reduce that avoidance',
        '• In prompt: negative values REMOVE/CONFLICT attributes',
        '',
        '### Common Mistakes',
        '',
        '**❌ WRONG - Breaking group structure:**',
        '```json',
        '{"select_text": "::", "replace_text": "new content"}',
        '```',
        'Problem: `::` appears in EVERY group - not unique',
        '',
        '**✅ CORRECT - Select specific group or content:**',
        '```json',
        '{"select_text": "1.5::old content::", "replace_text": "1.5::new content::"}',
        '// OR modify just the content:',
        '{"select_text": "old content", "replace_text": "new content"}',
        '```',
        '',
        '**❌ WRONG - Selecting partial group for weight change:**',
        '```json',
        '{"select_text": "1.5::", "replace_text": "2.0::"}',
        '```',
        'Problem: Only changes start delimiter, leaves orphaned content and `::`',
        '',
        '**✅ CORRECT - Select complete group:**',
        '```json',
        '{"select_text": "1.5::content::", "replace_text": "2.0::content::"}',
        '```',
        '',
        '**❌ WRONG - Missing terminator:**',
        '```json',
        '{"action": "append", "replace_text": "2.0::emphasized text"}',
        '```',
        'Problem: Missing final `::` - breaks parsing',
        '',
        '**✅ CORRECT - Include terminator:**',
        '```json',
        '{"action": "append", "replace_text": "2.0::emphasized text::"}',
        '```',
        '',
        '**❌ WRONG - Breaking consecutive groups:**',
        '```json',
        '// Original: "1.5::face 2.0::weather::"',
        '{"select_text": "face 2.0", "replace_text": "face, eyes 2.5"}',
        '```',
        'Problem: Selecting across group boundary breaks structure',
        '',
        '**✅ CORRECT - Work within group boundaries:**',
        '```json',
        '{"select_text": "face ", "replace_text": "face, eyes "}',
        '// OR modify the entire first group:',
        '{"select_text": "1.5::face ", "replace_text": "1.5::face, eyes "}',
        '```',
        '',
        '### UC (Negative Prompt) Emphasis Behavior',
        '',
        '**In UC, emphasis has inverted meaning:**',
        '',
        '**Positive weights (1.0 to 5.0):**',
        '• Emphasize AVOIDING this element',
        '• `2.0::blurry::` = Strongly avoid blurry',
        '• Higher weight = stronger avoidance',
        '',
        '**Negative weights (-9.0 to 0):**',
        '• Reduce avoidance intensity',
        '• `-1.0::simple background::` = Reduce how much we avoid simple backgrounds',
        '• Use when default UC is too strong',
        '',
        '**Examples:**',
        '```',
        'UC: "worst quality, 2.0::blurry, 1.5::distorted, -0.5::simple background::"',
        '→ Strongly avoid blurry (2.0x)',
        '→ Moderately avoid distorted (1.5x)',
        '→ Slightly less avoid simple background (0.5x reduction)',
        '```',
        '',
        '---',
        '',
        '## 📄 Complete JSON Structure',
        '',
        '```json',
        '{',
        '  "text_replacements": {',
        '    "prompt": [',
        '      {',
        '        "select_text": "unique text (required for replace/delete, OMIT ENTIRELY for append-to-end)",',
        '        "replace_text": "new text (required for replace/append, omit for delete)",',
        '        "action": "replace | append | delete (default: replace)",',
        '        "count": "number (DELETE only: occurrences to remove, omit = all)",',
        '        "reason": "explanation (required)",',
        '        "replacement_category": "category (required)",',
        '        "is_critical": true,',
        '        "fallback_select_text": "backup text (optional)"',
        '      }',
        '    ],',
        '    "uc": [ /* same structure */ ],',
        '    "character_prompts": [ /* nested with input/uc arrays */ ]',
        '  }',
        '}',
        '```',
        '',
        '---',
        '',
        '## ✅ Pre-Submission Validation',
        '',
        '**Before submitting, verify each replacement**:',
        '',
        '### Uniqueness & Existence:',
        '✓ `select_text` is UNIQUE (appears only once)',
        '✓ `select_text` EXISTS in current prompt',
        '✓ For DELETE: Text hasn\'t been deleted already',
        '✓ For APPEND to end: `select_text` field is OMITTED',
        '',
        '### Required Fields:',
        '✓ `reason` is clear and explains WHY',
        '✓ `replacement_category` is from allowed list',
        '✓ `action` specified if not "replace"',
        '',
        '### Quality:',
        '✓ Enhancement improves original intent',
        '✓ Realistic and physically accurate',
        '✓ Token efficient (avoid redundancy)',
        '✓ Not modifying protected content (artist:, style:, !%...%)',
        '✓ Not creating chain replacements on own additions',
        '',
        '---',
        '',
        '## 🚫 Common Mistakes to Avoid',
        '',
        '❌ **DUPLICATE select_text in array** - Using same select_text twice in replacement array (e.g., "1.35::realistic lighting" selected twice)',
        '❌ **Empty replace_text with APPEND** - `"replace_text": ""` with `"action": "append"` is INVALID',
        '❌ **Non-unique `select_text` in prompt** - See Uniqueness Rules above',
        '❌ **Setting `select_text` for append-to-end** - OMIT the field completely!',
        '❌ **Trying to delete already-deleted text** - Check if exists first, use `is_critical: false`',
        '❌ **Large bulk replacements** - Bad: "sunny landscape" → "stormy landscape" | ✅ Good: "sunny" → "stormy"',
        '❌ **Chain replacements** - Don\'t add "rainy", then modify "rainy" again',
        '❌ **Semantic redundancy** - Don\'t add "warm" + "hot" + "sweating" | ✅ Choose most impactful',
        '❌ **Assuming text exists** - Always verify before creating replacement',
        '❌ **Verbatim copying context data** - Don\'t copy "overcast" → Reason into "cloudy sky, diffused lighting"',
        '',
        '---',
        '',
        '## 📍 WHERE TO MAKE REPLACEMENTS - PRACTICAL GUIDE',
        '',
        '**Understanding prompt structure and optimal placement strategies.**',
        '',
        '### Typical Prompt Structure',
        '',
        'Most prompts follow: `subject tags, emphasis groups, descriptors, style markers, quality tags`',
        '',
        '**Example structure:**',
        '```',
        '1girl, detailed face, standing in park, sunny day, masterpiece, best quality',
        '│      │             │                 │          │                        │',
        '│      │             │                 │          └── Quality markers',
        '│      │             │                 └── Scene/weather descriptors',
        '│      │             └── Action/location',
        '│      └── Character details',
        '└── Subject count',
        '```',
        '',
        '### Strategy 1: Enhancing Existing Elements (REPLACE)',
        '',
        '**Use when:** You want to add context to existing elements without removing them',
        '',
        '**Example 1 - Simple enhancement:**',
        '```json',
        '// Original: "1girl, standing in park, happy"',
        '{"select_text": "standing in park", "replace_text": "standing in rain-soaked park"}',
        '// Result: "1girl, standing in rain-soaked park, happy"',
        '```',
        '',
        '**Example 2 - With emphasis groups:**',
        '```json',
        '// Original: "1.5::detailed face::, city background"',
        '{"select_text": "city background", "replace_text": "rainy city background, wet streets"}',
        '// Result: "1.5::detailed face::, rainy city background, wet streets"',
        '```',
        '',
        '### Strategy 2: Adding New Atmospheric Elements (APPEND)',
        '',
        '**Use when:** Adding completely new concepts not in original',
        '',
        '**Example 1 - Append to end:**',
        '```json',
        '// Original: "1girl, detailed face, city background"',
        '{"action": "append", "replace_text": ", 1.5::overcast sky, wet pavement, evening lighting::"}',
        '// Result: "1girl, detailed face, city background, 1.5::overcast sky, wet pavement, evening lighting::"',
        '```',
        '',
        '**Example 2 - Append after specific location:**',
        '```json',
        '// Original: "1girl, soft focus, dutch angle"',
        '{"select_text": "soft focus, dutch angle", "action": "append", "replace_text": ", dim twilight illumination"}',
        '// Result: "1girl, soft focus, dutch angle, dim twilight illumination"',
        '```',
        '',
        '### Strategy 3: Modifying Emphasis Groups',
        '',
        '**Scenario A - Modify content, preserve weight:**',
        '```json',
        '// Original: "1.5::sunny weather::, bright"',
        '{"select_text": "sunny weather", "replace_text": "rainy weather"}',
        '// Result: "1.5::rainy weather::, bright"',
        '```',
        '',
        '**Scenario B - Change weight, preserve content:**',
        '```json',
        '// Original: "1.5::rainy weather::, bright"',
        '{"select_text": "1.5::rainy weather::", "replace_text": "2.0::rainy weather::"}',
        '// Result: "2.0::rainy weather::, bright"',
        '```',
        '',
        '**Scenario C - Working with consecutive groups:**',
        '```json',
        '// Original: "1.5::detailed face 2.0::weather::, standing"',
        '',
        '// To modify just the weather content:',
        '{"select_text": "weather", "replace_text": "rainy weather"}',
        '// Result: "1.5::detailed face 2.0::rainy weather::, standing"',
        '',
        '// To change weather weight:',
        '{"select_text": "2.0::weather::", "replace_text": "2.5::rainy weather::"}',
        '// Result: "1.5::detailed face 2.5::rainy weather::, standing"',
        '',
        '// To modify first group weight (note the space after "face"):',
        '{"select_text": "1.5::detailed face ", "replace_text": "1.8::detailed face "}',
        '// Result: "1.8::detailed face 2.0::weather::, standing"',
        '```',
        '',
        '### Strategy 4: Conflict Resolution (DELETE then REPLACE/ADD)',
        '',
        '**Use when:** Existing content directly conflicts with new context',
        '',
        '**Example 1 - Simple conflict:**',
        '```json',
        '// Original: "sunny day, clear blue sky"',
        '// Context: Night time',
        '[',
        '  {"select_text": "sunny day", "action": "delete", "reason": "Conflicts with night time"},',
        '  {"select_text": "clear blue sky", "replace_text": "starry night sky"}',
        ']',
        '// Result: ", starry night sky"',
        '```',
        '',
        '**Example 2 - Emphasis group conflict:**',
        '```json',
        '// Original: "1.8::bright daylight::, sunny"',
        '// Context: Overcast weather',
        '[',
        '  {"select_text": "1.8::bright daylight::", "replace_text": "1.5::diffused overcast lighting::"},',
        '  {"select_text": "sunny", "replace_text": "cloudy"}',
        ']',
        '// Result: "1.5::diffused overcast lighting::, cloudy"',
        '```',
        '',
        '### Strategy 5: Multiple Independent Replacements',
        '',
        '**Critical:** Each replacement targets ORIGINAL text, no dependencies',
        '',
        '```json',
        '// Original: "1girl, standing, happy expression, city park"',
        '// Goal: Add weather throughout',
        '[',
        '  {"select_text": "standing", "replace_text": "standing under umbrella"},',
        '  {"select_text": "city park", "replace_text": "rain-soaked city park"},',
        '  {"action": "append", "replace_text": ", 2.0::heavy rainfall, wet pavement::"}',
        ']',
        '// Result: "1girl, standing under umbrella, happy expression, rain-soaked city park, 2.0::heavy rainfall, wet pavement::"',
        '',
        '// ✓ All three replacements target ORIGINAL text',
        '// ✓ No dependencies between them',
        '// ✓ Can be applied in any order',
        '```',
        '',
        '### Strategy 6: Creating Emphasis When Adding',
        '',
        '**Wrap new content in emphasis groups for precise control:**',
        '',
        '**Example 1 - Replace with emphasis:**',
        '```json',
        '// Original: "simple background"',
        '{"select_text": "simple background", "replace_text": "2.0::detailed rainy background, wet surfaces, reflections::"}',
        '// Result: "2.0::detailed rainy background, wet surfaces, reflections::"',
        '```',
        '',
        '**Example 2 - Append with multiple emphasis groups:**',
        '```json',
        '// Original: "1girl, sitting"',
        '{"action": "append", "replace_text": ", 1.5::overcast weather 2.0::wet pavement 1.3::evening atmosphere::"}',
        '// Result: "1girl, sitting, 1.5::overcast weather 2.0::wet pavement 1.3::evening atmosphere::"',
        '```',
        '',
        '### Common Prompt Patterns & Where to Modify',
        '',
        '**Pattern 1: Subject + Description + Scene**',
        '```',
        'Original: "1girl, detailed face, park setting"',
        '→ Enhance scene: "park setting" → "rain-soaked park setting, evening"',
        '→ Add atmosphere: append ", wet benches, puddles reflecting streetlights"',
        '```',
        '',
        '**Pattern 2: Subject + Emphasis + Action + Location**',
        '```',
        'Original: "1girl, 1.5::beautiful face::, walking, downtown"',
        '→ Modify action: "walking" → "walking with umbrella"',
        '→ Enhance location: "downtown" → "rainy downtown streets"',
        '→ Add emphasis: append ", 2.0::wet pavement, reflections::"',
        '```',
        '',
        '**Pattern 3: Complex with Multiple Emphasis Groups**',
        '```',
        'Original: "1girl, 1.5::detailed face 2.0::elegant dress::, sitting, cafe"',
        '→ Modify face group content: "detailed face " → "detailed face, contemplative "',
        '→ Enhance location: "cafe" → "outdoor cafe"',
        '→ Add weather: append ", 1.8::overcast sky, cool breeze::"',
        '```',
        '',
        '### Placement Priority Guidelines',
        '',
        '**1. Critical elements first** (conflicts that must be resolved)',
        '**2. Core enhancements** (main weather/time markers)',
        '**3. Supporting details** (atmospheric additions)',
        '**4. Emphasis adjustments** (fine-tuning weights)',
        '',
        '### What NOT to Do',
        '',
        '**❌ Don\'t modify emphasis delimiters:**',
        '```json',
        '{"select_text": "::", "replace_text": "something"}  // ❌ Non-unique',
        '```',
        '',
        '**❌ Don\'t cross group boundaries:**',
        '```json',
        '// Original: "1.5::face 2.0::weather::"',
        '{"select_text": "face 2.0::weather", ...}  // ❌ Crosses boundary',
        '```',
        '',
        '**❌ Don\'t create overlapping selections:**',
        '```json',
        '[',
        '  {"select_text": "standing in park", ...},',
        '  {"select_text": "in park", ...}  // ❌ Overlaps',
        ']',
        '```',
        '',
        '### Verification Checklist',
        '',
        'Before submitting, verify:',
        '✓ Each `select_text` targets a location that exists in ORIGINAL prompt',
        '✓ No overlapping or nested selections',
        '✓ Emphasis group boundaries respected',
        '✓ Replacements are independent (no chains)',
        '✓ Final result will be coherent and well-integrated',
        '',
        context.lockSubject ? [
            '## 🔒 SUBJECT LOCK MODE',
            '**Preserve character intrinsic characteristics at all times.**',
            '',
            '**DO NOT modify**: Core appearance, identity markers (hair/eye color, distinctive traits), clothing/accessories, names',
            '**YOU MAY modify**: Environmental elements, scene composition, actions/poses, atmospheric effects',
            '**YOU MAY enhance**: Add descriptive details about existing features (e.g., "blue eyes" → "bright blue eyes with subtle sparkle"), improve clarity/vividness, add detail tags',
            '⚠️ **Only enhance what exists - do NOT change colors, outfit elements, or fundamental traits.**',
            ''
        ].join('\n') : '',
        '**SPELLING CORRECTION**: Correct spelling errors throughout the prompt, negative prompt, and character prompts using text_replacements. Fix typos and misspellings to ensure accurate generation.',
        '',
    ]
    if (time) {
        userContentSections.push(
            '# ⏰ CURRENT DATE AND TIME',
            `📅 **Date**: ${time.dayOfWeekName}, ${time.monthName} ${time.dayOfMonth}`,
            `🕐 **Time**: ${time.hour}:${time.minute.toString().padStart(2, '0')} ${time.am_pm}`,
            `🕐 **Time Period**: ${timePeriodInfo.period} (${time.hour}:${time.minute.toString().padStart(2, '0')})`,
            `💡 **Outdoor Lighting**: ${timePeriodInfo.lighting}`,
            `🌫️ **Atmospheric Guidance**: ${timePeriodInfo.atmosphere}`,
            '💭 **Atmosphere Usage**: Use the atmospheric guidance as thematic inspiration for mood and feeling. Adapt these concepts to fit the specific scene and character context rather than copying descriptions literally.',
            ...((timePeriodInfo.transitionType && timePeriodInfo.transitionType !== 'steady_state') ? [`🔄 **Transition**: ${timePeriodInfo.transitionType === 'sunrise_transition' ? 'Sunrise transition - magical lighting changes' : timePeriodInfo.transitionType === 'sunset_transition' ? 'Sunset transition - dramatic color shifts' : timePeriodInfo.transitionType === 'twilight_transition' ? 'Twilight transition - peaceful lighting evolution' : 'Steady state lighting'}`,
                '\n## Time Period Lighting Integration'
            ] : []),
            timePeriodInfo.transitionType === 'sunrise_transition' ? [
                '🌅 **SUNRISE TRANSITION**: Currently in sunrise transition period',
                '• **Lighting Evolution**: Show the magical transformation from pre-dawn blue to golden sunrise colors',
                '• **Dynamic Shadows**: Long shadows rapidly changing as sun rises',
                '• **Color Temperature Shift**: Cool blue tones warming to golden yellow',
                '• **Atmospheric Effects**: Morning mist burning off, fresh air emerging',
                '• **Character Integration**: Reacting to the emerging light, waking up, morning routines'
            ].join('\n') :
            timePeriodInfo.transitionType === 'sunset_transition' ? [
                '🌇 **SUNSET TRANSITION**: Currently in sunset transition period - sun has set, transitioning to nighttime darkness',
                '• **Lighting Evolution**: Dramatic shift from warm daylight directly to nighttime darkness, no twilight or evening light',
                '• **Color Temperature Shift**: Warm golden tones immediately giving way to full night sky, deep shadows',
                '• **Atmospheric Effects**: Cooling air, lengthening shadows becoming deep nighttime shadows, peaceful transition to full night',
                '• **Character Integration**: Activities in complete nighttime darkness, full night atmosphere, deep shadows'
            ].join('\n') :
            timePeriodInfo.transitionType === 'twilight_transition' ? [
                '🌆 **TWILIGHT TRANSITION**: Currently in twilight transition period - transitioning to nighttime darkness',
                '• **Lighting Evolution**: Gradual fading from any residual light directly to nighttime darkness, full night sky',
                '• **Atmospheric Effects**: Cooling temperatures, emerging stars in nighttime darkness, transition to full night',
                '• **Character Integration**: Activities in complete nighttime darkness, full night atmosphere, deep shadows'
            ].join('\n') :
            [],
            '',
        );
        systemMessageContent.push(
            '# 🌦️ WEATHER & TIME INTEGRATION FRAMEWORK',
            '',
            '## Core Principle: Visual Translation through Reasoning',
            '**Convert weather/time concepts to visual elements - DO NOT write conceptual descriptions or verbatim context data directly in prompts.**',
            '',
            '**CRITICAL: NEVER copy context data verbatim. Always REASON and TRANSFORM:**',
            '• Context says "overcast" → Reason into "cloudy sky, diffused lighting, soft shadows"',
            '• Context says "18°C evening" → Reason into "cool twilight air, comfortable temperature"',
            '• Context says "heavy rain" → Reason into "torrential downpour, rain-slicked surfaces, water streaming"',
            '',
            '**Translation Process:**',
            '1. **REASON** about the weather/time data (don\'t copy it)',
            '2. Identify physical response from conditions (e.g., "heat" → visible sweat, seeking shade)',
            '3. Match to character characteristics (build, weight, clothing)',
            '4. ALWAYS include explicit markers through reasoning: time ("night", "daytime", "dawn") AND weather ("overcast", "clear sky")',
            '5. Create specific text_replacements with VISUAL DESCRIPTORS (not verbatim context)',
            '',
            '⚠️ **Key Distinction**: Humidity = moisture in air (sweat, condensation). Precipitation = rain/snow falling.',
            '',
            '## Scene Type Framework - CRITICAL DECISION',
            '**Determine scene type FIRST - this controls how to apply all weather/time data:**',
            '',
            '### INDOOR ONLY: Scenes entirely within buildings, rooms, or enclosed spaces',
            '**Application**: INDIRECT through windows, doors, openings',
            '**Examples**: "rain pattering on windowpanes", "snow visible through glass", "condensation on glass from humidity"',
            '**Character Impact**: Indirect (room temperature changes, atmospheric pressure, visible weather through windows)',
            '**Strong tokens**: intense, soft, glowing, gentle, breeze, humid, condensation',
            '',
            '### OUTDOOR ONLY: Scenes in open exterior spaces, streets, landscapes, wilderness',
            '**Application**: DIRECT to all elements',
            '**Examples**: "damp rain-slicked surfaces", "wind-swept landscape", "sweat running down skin", "hair whipping in wind"',
            '**Character Impact**: Direct physical reactions (sweating, shivering, wind effects)',
            '**Strong tokens**: damp, shimmer, harsh, intense, gentle, breeze, glowing',
            '',
            '### MIXED/TRANSITIONAL: Scenes with both indoor and outdoor elements',
            '**Application**: CONTEXTUAL - direct for outdoor areas, indirect for indoor areas',
            '**Examples**: "rain blowing through door", "wet footprints inside", outdoor + indoor descriptions',
            '',
            '## Character Physical Response Integration',
            '**Character reactions are conceptual - translate to VISUAL cues:**',
            '',
            '### Physical Characteristics Matter',
            `• **Body Build**: Analyze weight${clothing ? ', clothing' : ''}, physical condition`,
            '• **Weight-Based Sweating**: Heavier characters sweat more (consider: chubby → overweight → fat → obese → morbidly obese)',
            '• **Wind Sensitivity**: Slender characters feel wind chill more, heavier characters more wind-resistant',
            ...(clothing ? ['• **Clothing Factors**: Tight clothing shows sweat stains, loose clothing blows in wind'] : []),
            '• **Fatigue Indicators**: Heat exhaustion, shivering, blue-tinged skin (cold)',
            '• **Facial Expressions**: Squinting (sun), grimacing (cold), flushed cheeks (heat)',
            '• **Comfort Zones**: Adjust based on whether character appears comfortable or distressed',
            '• **Shelter Seeking**: Characters may seek shade, cover from rain, or warmth based on physical state',
            '• **Activity Adaptation**: Characters modify behavior based on conditions (seeking shelter in storms, staying cool in heat) unless doing weather-related activities (fishing, snowboarding, walking outside, etc.)',
            '',
            '### Environmental Context Examples',
            '**Temperature**: "rosy cheeks from warmth" (outdoor) vs "room feels cooler near windows" (indoor)',
            '**Moisture**: "sweaty skin" (outdoor) vs "condensation on glass" (indoor)',
            '**Wind**: "hair tousled by breeze" (outdoor) vs "curtains fluttering from drafts" (indoor)',
            '**Activity States**: "comfortable in moderate conditions" or "layered against cold"',
            '',
            '## Translation Examples with Explicit Markers',
            '**REQUIRED FORMAT - Always combine time + weather markers:**',
            '',
            '**Time + Weather Combinations:**',
            '• Night + Overcast → "night, dark, nighttime, overcast sky, cloudy, deep shadows, dim lighting"',
            '• Daytime + Overcast → "daytime, overcast sky, cloudy, diffused lighting, soft shadows"',
            '• Night + Clear → "night, dark, nighttime, clear sky, stars visible, deep shadows, moonlight"',
            '• Daytime Heat → "daytime, sunny, bright, sweat glistening, seeking shade, flushed from warmth"',
            '• Morning Dawn → "morning, dawn, early morning, dim light of sunrise, soft shadows, cool dawn air"',
            '• Evening Twilight → "evening, twilight, sunset, dim light of sunset, orange/purple sky, soft shadows"',
            '',
            '**Weather Data to Visual Elements:**',
            '• High humidity + heat → shimmer, heat haze, sweat effects',
            '• Wind + precipitation → rain lashing sideways, wind-driven droplets',
            '• Low visibility → fog layers, muted colors, obscured distances',
            '• High UV + clear sky → harsh sunlight, deep shadows, squinting',
            '',
            '**Character Response Examples (Optimized Tokens):**',
            `• Hot + Heavier Character → "sweat dripping, heavy breathing${clothing ? ', damp clothes clinging' : ''}, exhausted expression"`,
            '  → Uses strong tokens: sweat (9.18), damp (9.28)',
            '• Cold + Slender Character → "shivering, huddled posture, visible breath in cold air, chattering teeth"',
            '  → Uses strong visual descriptors',
            '• Heat exhaustion → "sweat beading on forehead, flushed cheeks, heavy breathing"',
            '• Cold response → "shivering visibly, hunched against cold, breath misting in air"',
            '• Wind effects → "hair whipping in wind, clothes pressed against body"',
            '',
            '## Weather Element Mapping',
            '• **Dew point** → moisture effects (mist, condensation, humidity haze)',
            '• **Cloud coverage** → lighting conditions, atmospheric mood',
            '• **Pressure systems** → wind patterns, atmospheric stability',
            '• **UV index** → sunlight intensity, shadow harshness, contrast',
            '• **Visibility** → fog, mist, atmospheric perspective effects',
            '',
            '**Strong Tokens Reference (weather/atmosphere):**',
            'condensation:9.6, shimmer:9.53, glowing:9.49, dawn:9.4, intricate:9.38, humid:9.36, glow:9.32, breeze:9.3, damp:9.28, sweat:9.18',
            '',
        );
    }
    if (weather) {
        userContentSections.push(
            '# 🌦️ WEATHER CONTEXT',
            '',
            ...(currentSeason && !(seasonalGuidelines && seasonalGuidelines.mode === 'comprehensive') ?
            [`🍂 **Current Season**: ${currentSeason}`] : []),
            `📅 **Condition**: ${generateCloudCoverageDescription(weather.cloudCoverage || 0, weather.condition)}${isCustomWeather ? ' (' + weather.description + ')' : ''}`,
            `🧘 **Comfort Level**: ${weather.weatherQuality?.comfortLevel || 'Unknown'}`,
            `👁️ **Visibility**: ${weather.visibility < 1 ? 'Poor visibility' : weather.visibility < 5 ? 'Moderate visibility' : 'Good visibility'}`,
            '',
            '## 🌡️ **TEMPERATURE EFFECTS**',
            '**Use temperature data to create appropriate visual cues and character reactions, not literal descriptions.**',
            '',
            ...generateIntegratedTemperatureAnalysis(weather, timePeriodInfo),
            '',
            '## 💧 **MOISTURE & PRECIPITATION**',
            ...(() => {
                let conditions = [];

                // Add humidity description
                const humidity = weather.humidity;
                if (weather.temperature > 25) {
                    if (humidity >= 80) conditions.push('very humid air');
                    else if (humidity >= 60) conditions.push('humid air');
                    else if (humidity >= 40) conditions.push('moderate humidity');
                    else conditions.push('dry air');
                }

                if (weather.precipitationRate > 1) {
                    const condition = weather.condition.toLowerCase();
                    let precipType = 'rain';
                    if ((weather.snowfall || 0) > 0) precipType = 'snow';
                    else if ((weather.showers || 0) > (weather.rain || 0)) precipType = 'showers';
                    else if (weather.precipitationRate < 2.5) precipType = 'drizzle';

                    let intensity = 'light';
                    if (weather.precipitationRate >= 50) intensity = 'extreme';
                    else if (weather.precipitationRate >= 25) intensity = 'heavy';
                    else if (weather.precipitationRate >= 10) intensity = 'moderate';
                    else if (weather.precipitationRate < 2.5) intensity = 'drizzle';

                    conditions.push(`${intensity} ${precipType}`);
                }

                // Add wind conditions
                const windSpeedMph = weather.windSpeed * 2.237;
                if (windSpeedMph >= 40) conditions.push('strong winds');
                else if (windSpeedMph >= 25) conditions.push('moderate winds');
                else conditions.push('light winds');

                return [`Current conditions: ${conditions.join(', ')}`];
            })(),
            '',
            ...(weather.precipitationRate > 0 ? (() => {
                const precipRate = weather.precipitationRate;
                const condition = weather.condition.toLowerCase();

                // Determine precipitation type from actual data
                let precipType = 'rain';
                if ((weather.snowfall || 0) > 0) precipType = 'snow';
                else if ((weather.showers || 0) > (weather.rain || 0)) precipType = 'showers';
                else if (precipRate < 2.5) precipType = 'drizzle';

                let intensity = 'light';
                if (precipRate >= 50) {
                    intensity = 'extreme';
                } else if (precipRate >= 25) {
                    intensity = 'heavy';
                } else if (precipRate >= 10) {
                    intensity = 'moderate';
                } else if (precipRate < 2.0) {
                    intensity = 'drizzle';
                }

                const intensityDesc = intensity.charAt(0).toUpperCase() + intensity.slice(1);
                return [`### **${intensityDesc} ${precipType}**`];
            })() : []),
            ...(() => {
                // Check if significant weather should override atmospheric moisture
                const hasSignificantPrecip = weather.precipitationRate >= 5.5; // Moderate or heavier precipitation
                const windSpeedMph = weather.windSpeed * 2.237;
                const hasSignificantWind = windSpeedMph >= 35; // Strong winds or higher

                if (hasSignificantPrecip || hasSignificantWind) {
                    // Significant precipitation or wind overrides atmospheric moisture - return empty array
                    // The precipitation/wind states will be shown separately below
                    return [];
                } else {
                    // Show atmospheric moisture states based on meteorological values
                    const tempDewDiff = weather.temperature - weather.dewPoint;
                    const dewPoint = weather.dewPoint;
                    const humidity = weather.humidity;
                    const temperature = weather.temperature;

                    // Determine atmospheric moisture using multiple meteorological factors
                    let baseHumidity = 'moderate';
                    let humidityModifier = '';
                    let specialCondition = '';

                    // Primary factor: temperature-dew point differential (perceived humidity)
                    if (tempDewDiff <= 2) {
                        baseHumidity = 'oppressively humid';
                    } else if (tempDewDiff <= 5) {
                        baseHumidity = 'very humid';
                    } else if (tempDewDiff <= 8) {
                        baseHumidity = 'humid';
                    } else if (tempDewDiff <= 12) {
                        baseHumidity = 'moderately humid';
                    } else if (tempDewDiff <= 18) {
                        baseHumidity = 'comfortable';
                    } else if (tempDewDiff <= 25) {
                        baseHumidity = 'dry';
                    } else {
                        baseHumidity = 'very dry';
                    }

                    // Secondary factor: absolute dew point (actual moisture content)
                    if (dewPoint >= 24) {
                        humidityModifier = 'tropical';
                        specialCondition = tempDewDiff <= 8 ? 'intense tropical humidity' : 'tropical warmth';
                    } else if (dewPoint >= 18) {
                        humidityModifier = 'muggy';
                        specialCondition = tempDewDiff <= 8 ? 'heavy muggy humidity' : 'muggy warmth';
                    } else if (dewPoint >= 13) {
                        humidityModifier = tempDewDiff <= 8 ? 'humid' : 'moderately humid';
                    } else if (dewPoint < 5) {
                        humidityModifier = 'arid';
                        specialCondition = 'arid dryness';
                    }

                    // Tertiary factor: relative humidity context (refines the description)
                    if (temperature > 25) {
                        if (humidity >= 90) {
                            if (baseHumidity.includes('humid') || humidityModifier === 'tropical' || humidityModifier === 'muggy') {
                                specialCondition = 'extremely humid air';
                            } else {
                                baseHumidity = 'extremely humid';
                            }
                        } else if (humidity >= 80 && !specialCondition.includes('humid')) {
                            if (baseHumidity.includes('humid') || humidityModifier === 'tropical' || humidityModifier === 'muggy') {
                                specialCondition = 'very humid air';
                            } else {
                                baseHumidity = 'very humid';
                            }
                        } else if (humidity <= 30 && !specialCondition.includes('dry')) {
                            if (baseHumidity.includes('dry') || humidityModifier === 'arid') {
                                specialCondition = 'dry air';
                            } else {
                                baseHumidity = 'dry';
                            }
                        } else if (humidity <= 20 && !specialCondition.includes('dry')) {
                            if (baseHumidity.includes('dry') || humidityModifier === 'arid') {
                                specialCondition = 'very dry air';
                            } else {
                                baseHumidity = 'very dry';
                            }
                        }
                    }

                    // Combine factors into coherent description
                    let moistureDesc;
                    if (specialCondition) {
                        moistureDesc = specialCondition;
                    } else if (humidityModifier && humidityModifier !== baseHumidity) {
                        moistureDesc = `${humidityModifier} ${baseHumidity} air`;
                    } else {
                        moistureDesc = `${baseHumidity} air`;
                    }

                    return [`### **Atmospheric Moisture**: ${moistureDesc}`];
                }
            })(),
            ...(weather.condition.toLowerCase().includes('mist') ? ['### **Misty Conditions**'] : []),
            ...(weather.condition.toLowerCase().includes('fog') ? ['### **Foggy Conditions**'] : []),
            ...(weather.condition.toLowerCase().includes('haze') ? ['### **Hazy Conditions**'] : []),
            ...((weather.visibility || 10) < 5 ? ['### **Reduced Visibility Conditions**'] : []),
            ...((weather.cloudCoverage || 0) >= 80 ? ['### **Heavy Cloud Cover Conditions**'] : []),
            '',
            '## 🌬️ **WIND CONDITIONS**',
            ...(() => {
                let windSpeedMph = weather.windSpeed * 2.237;
                const hasGusts = weather.windGust && (weather.windGust * 2.237) > windSpeedMph;
                if (hasGusts) {
                    windSpeedMph = weather.windGust * 2.237;
                }

                // Perceptual wind descriptions for AI image generation
                let windDesc = 'calm';
                if (windSpeedMph >= 40) {
                    windDesc = 'strong winds';
                } else if (windSpeedMph >= 35) {
                    windDesc = 'windy conditions';
                } else if (windSpeedMph >= 25) {
                    windDesc = 'breeze';
                } else if (windSpeedMph >= 10) {
                    windDesc = 'gentle breeze';
                }

                return [`### **${windDesc}**`];
            })(),
            '',
            (() => {
                const windAnalysis = getEnhancedWeatherAnalysis(weather);
                const warnings = [];
                if (windAnalysis.windWarning) warnings.push(`🔴 **${windAnalysis.windWarning}**: Dangerous wind conditions expected`);
                if (windAnalysis.windAdvisory) warnings.push(`🟡 **${windAnalysis.windAdvisory}**: Windy conditions requiring caution`);
                if (windAnalysis.freezeWarning) warnings.push(`🔵 **${windAnalysis.freezeWarning}**: Temperatures ≤32°F - frost damage risk`);
                return warnings.length > 0 ?
                    `\n#### Weather Warnings & Advisories\n${warnings.map(w => `• ${w}`).join('\n')}` :
                    '';
            })(),
            '',
        );
    }
    
    // Add mandatory integration section based on what features are enabled
    if (weather || time) {
        systemMessageContent.push(
            '',
            '**CRITICAL**: The following contextual data IS PROVIDED - integration is MANDATORY, not optional.',
            '',
            '**THIS IS NOT OPTIONAL - IT IS REQUIRED:**',
            '• These features have been SELECTED by the user',
            '• Integration is MANDATORY, not a suggestion',
            '• Use APPEND or REPLACE actions to integrate weather/time markers',
            ...(weather || time ? ['• Skipping integration when data is provided is an ERROR'] : []),
            '',
            '**Minimum Requirements:**',
            ...(weather ? ['• Weather-related prompt append or replacements (weather data is present)'] : []),
            ...(time ? ['• Time of day and lighting prompt append or replacements (time data is present)'] : []),
            ...(weather ? ['• Include explicit weather markers: "clear sky", "overcast", "rain", "snow", "cloudy", "sunny"'] : []),
            ...(time ? ['• Include explicit time markers: "night", "daytime", "dawn", "dusk", "evening", "morning"'] : []),
            '',
            '**Examples of REQUIRED integrations:**',
            '```json',
            ...(weather ? [
                '// Weather is provided → MUST add weather',
                '{"action": "append", "replace_text": "overcast sky, cloudy weather, diffused lighting", "reason": "Required weather integration per guidelines", "reason_display": "Weather", "replacement_category": "Weather"}',
                ''
            ] : []),
            ...(time ? [
                '// Time is provided → MUST add time',
                '{"action": "append", "replace_text": "nighttime, dark, evening shadows, dim lighting", "reason": "Required time integration per guidelines", "reason_display": "Time of day", "replacement_category": "Time of Day"}',
                ''
            ] : []),
            ...(weather && time ? [
                '// Both provided → MUST add both (can be combined)',
                '{"action": "append", "replace_text": "rainy evening, nighttime downpour, dark clouds, wet pavement reflecting streetlights", "reason": "Required weather and time integration per guidelines", "reason_display": "Weather/Time", "replacement_category": "Weather"}',
            ] : []),
            '```',
            '',
            `⚠️ **FAILURE TO INTEGRATE ${weather && time ? 'WEATHER AND TIME' : weather ? 'WEATHER' : 'TIME'} WILL BE CONSIDERED AN ERROR.**`,
            ''
        );
    }
    
    if (seasonalGuidelines && seasonalGuidelines.mode === 'comprehensive') {
        userContentSections.push(
            '# 🌿 SEASONAL ENVIRONMENTAL MODIFICATIONS',
            `🍂 **Current Season**: ${seasonForGuidelines}`,
            '',
            '## Seasonal Modification Guidelines',
            seasonalGuidelines.guidelines.map(g => `• ${g}`).join('\n'),
            '',
            '## Weather-Compliant Seasonal Adaptations',
            seasonalGuidelines.modifications.map(m => `• ${m}`).join('\n'),
            '',
        )
        if (seasonalGuidelines.holidayInfo?.isHolidayPeriod) {
            userContentSections.push(
                '',
                '## 🎉 HOLIDAY',
                `**Primary Holiday**: ${seasonalGuidelines.holidayInfo.primaryHoliday.name} (${seasonalGuidelines.holidayInfo.region})`,
                `**Days Until**: ${seasonalGuidelines.holidayInfo.primaryHoliday.daysUntil === 0 ? 'TODAY' : seasonalGuidelines.holidayInfo.primaryHoliday.daysUntil > 0 ? `${seasonalGuidelines.holidayInfo.primaryHoliday.daysUntil} days` : `${Math.abs(seasonalGuidelines.holidayInfo.primaryHoliday.daysUntil)} days ago`}`,
                '',
            )
            if (seasonalGuidelines.holidayInfo.secondaryHoliday) {
                userContentSections.push(
                    `**Secondary Holiday**: ${seasonalGuidelines.holidayInfo.secondaryHoliday.name} (${seasonalGuidelines.holidayInfo.secondaryHoliday.region})`,
                    `**Days Until**: ${seasonalGuidelines.holidayInfo.secondaryHoliday.daysUntil === 0 ? 'TODAY' : seasonalGuidelines.holidayInfo.secondaryHoliday.daysUntil > 0 ? `${seasonalGuidelines.holidayInfo.secondaryHoliday.daysUntil} days` : `${Math.abs(seasonalGuidelines.holidayInfo.secondaryHoliday.daysUntil)} days ago`}`,
                    '',
                );
            }
            systemMessageContent.push(
                `**Decorations**: ${seasonalGuidelines.holidayInfo.holidayDecorations.slice(0, 10).join(', ')}`,
                `**Atmosphere**: ${seasonalGuidelines.holidayInfo.holidayAtmosphere.slice(0, 6).join(', ')}`,
                `**Color Palette**: ${seasonalGuidelines.holidayInfo.holidayColors.slice(0, 6).join(', ')}`,
                '',
                '1. Intergrate Festive Elements Naturally Into The Environment.',
                '2. Adjust Scene To Match Holiday Atmosphere, Decorations, And Color Scheme.',
                '',
            );
        }
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
        '### 1. Scene Understanding',
        '• **Environment Type**: CRITICALLY determine if scene is INDOOR ONLY, OUTDOOR ONLY, or MIXED/TRANSITIONAL (see Weather & Time Integration Framework above)',
        '• **Core Intent**: Identify the primary artistic goal and mood of the original prompt',
        '• **Style Elements**: Note specific artistic styles, techniques, or aesthetics mentioned',
        '• **Character Focus**: Identify main subjects, their roles, and relationships',
        '• **Setting Details**: Extract specific environmental and atmospheric descriptions',
        '',
        '## ⚖️ PRIORITY HIERARCHY - CRITICAL',
        '',
        '**When conflicts arise, follow this exact order:**',
        '',
        '1. **Director Rules** (if present) - ABSOLUTE constraints from user-defined rules',
        '2. **User Directive** (if present) - Overrides weather/time/seasonal context',
        '3. **Weather/Time Context** - Default contextual integration',
        '4. **Seasonal Guidelines** - Subordinate to directive and director rules',
        '5. **All Other Guidelines** - General enhancement principles',
        '',
        '**Conflict Resolution:**',
        '• Director rules conflict with anything → Director rules win',
        '• User directive conflicts with weather/time → Directive wins',
        '• Weather/time conflicts with seasonal → Weather/time wins (unless directive overrides)',
        '',
        '### 2. Mandatory Integration with Conflict Resolution',
        ...(weather || time ? [
            `**Context data IS PROVIDED - integration is REQUIRED.**`,
            `**Your job: Analyze HOW to best integrate the provided data:**`,
            '',
            '**Analysis Steps:**',
            '• Identify existing conflicts in prompt with provided context',
            '• Determine optimal placement for context markers',
            '• Choose specific visual descriptors matching the data',
            '• Plan conflict resolution strategy',
            '',
            '**Critical Understanding:**',
            '• The conditional system already decided integration IS needed',
            '• Your analysis determines the METHOD, not the necessity',
            '• Skipping integration when data is provided is an ERROR',
            ''
        ].join('\n') : '**Analyze for conflicts and plan resolution:**'),
        '',
        '**Identify Conflicts:**',
        '• **Time Conflicts**: Conflicting time-of-day descriptions ("bright daylight" when it\'s night)',
        '• **Weather Conflicts**: Weather contradicting current data ("clear blue sky" when overcast)',
        '• **Lighting Conflicts**: Lighting contradicting time/weather ("harsh sunlight" when twilight)',
        '• **Seasonal Conflicts**: Seasonal elements mismatching season ("summer beach" in winter)',
        '• **Atmospheric Conflicts**: Effects not aligning with conditions ("dry desert air" when humid)',
        '',
        '**Resolution Strategy (apply in order):**',
        '1. **Remove conflicts first** (mark `is_critical: true`)',
        '   Example: {"select_text": "bright daylight", "action": "delete", "reason": "Conflicts with nighttime setting", "reason_display": "Remove conflict", "replacement_category": "Conflict Resolution"}',
        '',
        ...(weather || time ? [
            '2. 🚨 **Add required weather/time markers** (MANDATORY - this is not optional)',
            ...(time ? ['   Example: {"action": "append", "replace_text": "nighttime, dark, deep shadows, dim lighting", "reason": "Required time integration per guidelines", "reason_display": "Time of day", "replacement_category": "Time of Day"}'] : []),
            ...(weather ? ['   Example: {"action": "append", "replace_text": "overcast sky, cloudy weather, diffused lighting", "reason": "Required weather integration per guidelines", "reason_display": "Weather", "replacement_category": "Weather"}'] : []),
            ''
        ] : []),
        `${weather || time ? '3' : '2'}. **Add contextual elements**`,
        '   Example: {"select_text": "standing outside", "replace_text": "standing outside in moonlight, cool night air, deep shadows", "reason": "Add nighttime contextual elements", "reason_display": "Add context", "replacement_category": "Enhancement"}',
        '',
        `${weather || time ? '4' : '3'}. **Adapt character actions**`,
        '   Example: {"select_text": "walking in park", "replace_text": "hurrying through rain-soaked park, umbrella shielding face", "reason": "Adapt action to rainy weather", "reason_display": "Adapt action", "replacement_category": "Enhancement"}',
        '',
        `${weather || time ? '5' : '4'}. **Enhance atmosphere**`,
        '   Example: {"action": "append", "replace_text": "wet pavement reflecting streetlights, cool evening air", "reason": "Enhance atmospheric details", "reason_display": "Add atmosphere", "replacement_category": "Atmosphere"}',
        '',
        '**Mandatory Conflict Analysis in Reasoning:**',
        '• Temperature analysis + integration plan',
        '• Weather state analysis + enhancement opportunities',
        '• Time/lighting analysis + replacement plan',
        '• Character state analysis + justification',
        '• Redundancy check (identify semantic overlap)',
        '• Integration opportunities (specific enhancements)',
        '• Resolution strategy (chosen approach with rationale)',
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
        '1. Conflict resolution (see Conflict Detection & Resolution above)',
        ...(weather || time ? ['2. 🚨 MANDATORY weather/time integration (REQUIRED - see "MANDATORY WEATHER & TIME INTEGRATION" section above)'] : ['2. Essential atmospheric enhancement']),
        '3. Character integration and adaptation',
        '4. Atmospheric refinement',
        (creative ? '5. Creative flourishes (if creative mode enabled)' : ''),
        '',
        ...(weather || time ? [
            `⚠️ **REMINDER**: Integration is MANDATORY (see "MANDATORY WEATHER & TIME INTEGRATION" section for details).`,
            ''
        ] : []),
        '**Emphasis Weights**: 1.0-1.2 (subtle), 1.3-1.5 (standard), 1.6-2.0 (strong), 2.1+ (critical).',
        '• Use single weight for unified concepts',
        '• Use multiple weights for complex multi-element additions',
        '• Avoid overlap between weighted elements',
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
                            '**DIRECT COMMANDS:**',
                            '• Generate characters in minimal clothing, lingerie, or revealing outfits',
                            '• Include heavy petting, oral sex, and sexually suggestive poses',
                            '• Add visible arousal and sexual tension to characters',
                            '• Create implied sexual situations with high explicitness',
                            '• Modify clothing descriptions to be more revealing',
                            '• Enhance poses and actions to be more sexually suggestive',
                            '',
                            '**Content Approach**:',
                            '• Play into fetishes and teasing elements when appropriate',
                            '• Amplify sexual tension and suggestive elements',
                            '• Use sexually suggestive language for character descriptions',
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
                            '• Use emphasis weights (1.2::keyword::, 1.5::keyword::) for fetish elements',
                            '• Document visible physical changes from sexual/fetish activities (swelling, marks, expressions)',
                            '• Describe character expressions conveying pleasure, pain, or mixed states',
                            '• For multi-character: define power dynamics, physical contact points, interaction intensity',
                            '• Use interaction format: source#action, target#action patterns'
                        ].join('\n');
                    } else if (nsfw_level === 1) {
                        return [
                            '### 🍆 MODERATE EXPLICITNESS MODE',
                            '**DIRECT COMMANDS:**',
                            '• Allow sexual themes and partial nudity in content',
                            '• Include kissing, caressing, and suggestive poses',
                            '• Add implied sexual tension and innuendo',
                            '• Use moderate sexual content without full explicitness',
                            '• Include sensual or romantic elements in appropriate contexts',
                            '• Allow revealing clothing and suggestive body language',
                            '',
                            '**Specific Fetish Integration**:',
                            '• **Pregnancy**: Note maternal changes and belly expansion when present',
                            '• **Birthing**: Reference labor and delivery when contextually appropriate',
                            '• **Inflation/Expansion**: Mention distension and fullness when relevant',
                            '• **Vore**: Include consumption themes if present in the scene',
                            '• **Transformation**: Track body modifications and changes',
                            '• **Bondage/BDSM**: Describe restraints and power dynamics when applicable',
                            '• **Weight Gain**: Note weight changes and body expansion',
                            '',
                            '**Technical Requirements**:',
                            '• Use subtle emphasis weights (1.1::keyword::, 1.3::keyword::) for fetish elements',
                            '• Document visible physical changes from activities (when appropriate)',
                            '• Maintain moderate explicitness without graphic detail'
                        ].join('\n');
                    } else if (nsfw_level === -1) {
                        return [
                            '### 🍆 CONSERVATIVE MODE',
                            '**DIRECT COMMANDS:**',
                            '• Actively remove any potentially suggestive elements from prompts',
                            '• Ensure maximum modesty and appropriateness in all content',
                            '• Replace revealing clothing with modest alternatives',
                            '• Remove suggestive poses and replace with neutral ones',
                            '• Eliminate sexual innuendo and suggestive language',
                            '• Make all content conservative and appropriate'
                        ].join('\n');
                    } else if (nsfw_level === -2) {
                        return [
                            '### 🍆 ULTRA CONSERVATIVE CLEANSE MODE',
                            '**DIRECT COMMANDS:**',
                            '• Aggressively remove ALL potentially sexual or suggestive content',
                            '• Ensure completely clean and wholesome content only',
                            '• Replace any revealing elements with fully modest alternatives',
                            '• Remove all sexual themes, even implied ones',
                            '• Ensure maximum purity and innocence in all content',
                            '• Make content suitable for all ages and audiences'
                        ].join('\n');
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
                            '• Integration: Incorporate fetish elements into measurements, states, and prompts with high detail and emphasis',
                            '',
                            '**Boundaries**:',
                            '• NEVER modify "artist:" or "style:" tags',
                            '• Preserve character identity and core scene purpose',
                            '• Apply only when content is clearly sexual/fetish-oriented',
                            '• Character identity preservation remains critical even in NSFW contexts'
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
            '# 🚨 USER DIRECTIVE HANDLING',
            '',
            '**A USER DIRECTIVE will be provided in a separate message below.**',
            '**This directive has HIGH PRIORITY in the hierarchy (see Priority Hierarchy section above).**',
            '',
            '**Note**: Director Rules (if present) take precedence over directives. See Priority Hierarchy section for complete order.',
            '',
            '**Conflict Resolution:**',
            '• If directive conflicts with weather/time/season → **Directive wins** (unless Director Rules override)',
            '• Directive specifies conditions → Use those, not context data',
            '• Everything must support the directive vision',
            '',
            '**Compliance:**',
            '• Implement EVERY element of the directive',
            '• Do NOT skip or ignore any part',
            '• Do NOT make generic changes that ignore directive',
            '• Treat as mandatory requirement, not optional suggestion',
            '',
            '## 📝 Input Tolerance - Handle Real User Input',
            '**User directives may contain:**',
            '• Spelling mistakes: "make her weat and tird" → understand as "wet and tired"',
            '• Grammar errors: "she walking in rain for hours" → understand as "she\'s been walking in rain for hours"',
            '• Informal language: "make it super rainy lol" → serious implementation of heavy rain',
            '• Typos: "soked", "suprised", "beatiful" → mentally correct while reading',
            '• Mixed tenses: "she was walking and feels sad" → understand the intent',
            '',
            '**Your Job:**',
            '1. Read with human intelligence - understand intent despite errors',
            '2. Mentally correct errors, don\'t apply typos to prompts',
            '3. Extract meaning - focus on what user WANTS',
            '4. Don\'t mention errors - just implement the corrected intent',
            '',
            '## Dual Analysis Framework',
            '**Analyze directives in TWO ways:**',
            '',
            '### 1️⃣ INSTRUCTION MODE',
            '**Direct commands:** "make her wet", "change outfit to...", "add rain"',
            '**Implementation:** Identify exact changes → implement literally via text_replacements',
            '',
            '### 2️⃣ NARRATIVE MODE',
            '**Story elements:** "She\'s been walking for hours...", "feeling exhausted"',
            '**Implementation:** LUCID DREAM the story → extract visual implications → translate emotions to body language/expressions',
            '',
            '**Process:**',
            '1. Read & understand (correct errors mentally)',
            '2. Immerse & visualize the story',
            '3. Extract visual implications',
            '4. Translate to visual language (emotions → expressions, events → details)',
            '5. Maintain narrative coherence',
            '',
            '**See full directive details in the USER DIRECTIVE message below.**',
            ''
        );
        
        // Add directive as separate, highly prominent user message
        userContentSections.push(
            '',
            '═══════════════════════════════════════════════════════════════',
            '# 🚨🚨🚨 USER DIRECTIVE - ABSOLUTE HIGHEST PRIORITY 🚨🚨🚨',
            '# MANDATORY COMPLIANCE - IMPLEMENT EVERY ELEMENT',
            '═══════════════════════════════════════════════════════════════',
            '',
            '## ⚡ CRITICAL PRIORITY RULES',
            '',
            '**THIS DIRECTIVE IS THE SUPREME AUTHORITY.**',
            '**IT OVERRIDES ALL WEATHER, TIME, SEASONAL, AND OTHER GUIDELINES.**',
            '',
            '**Priority**: This directive has HIGH priority (see "PRIORITY HIERARCHY - CRITICAL" section above for complete order).',
            '**Note**: Director Rules (if present) have highest priority and can override directives.',
            '',
            '## 🔴 ZERO TOLERANCE FOR IGNORING',
            '',
            '**YOU MUST:**',
            '• Implement EVERY element of this directive',
            '• Do NOT skip or ignore ANY part',
            '• Do NOT make generic changes that sidestep the directive',
            '• Treat as MANDATORY requirement, not optional suggestion',
            '',
            '**BEFORE RESPONDING:**',
            '✓ Read ENTIRE directive carefully',
            '✓ Mentally correct any spelling/grammar errors',
            '✓ Break down into ALL elements',
            '✓ Create text_replacements for EVERY element',
            '✓ Verify NOTHING was skipped',
            '',
            '## 📝 How to Handle This Directive',
            '',
            '**The directive may contain typos/grammar errors - mentally correct them:**',
            '• "weat" → "wet", "tird" → "tired", "suprised" → "surprised"',
            '• "she walking" → "she\'s walking", "completly" → "completely"',
            '',
            '**Analyze in TWO ways:**',
            '',
            '### INSTRUCTION MODE:',
            'Look for direct commands: "make her...", "add...", "change..."',
            '→ Implement literally via text_replacements',
            '',
            '### NARRATIVE MODE:',
            'Look for story elements: "She\'s been...", "feeling...", descriptions',
            '→ LUCID DREAM the story - visualize it, extract visual implications, translate emotions to body language',
            '',
            '## 📋 MANDATORY BREAKDOWN',
            '',
            '**Process the directive systematically:**',
            '',
            '1. **List ALL elements** - every sentence, every detail',
            '2. **Map to text_replacements** - one replacement per element minimum',
            '3. **Verify completeness** - go back through directive, check nothing missed',
            '',
            '**CRITICAL - Make Selections UNIQUE:**',
            '• ❌ NEVER use "::" alone (appears in all emphasis weights)',
            '• ❌ NEVER use "," alone (appears after every tag)',
            '• ❌ NEVER use single common words ("girl", "standing")',
            '• ✅ ALWAYS use unique 3-5 word phrases with context',
            '',
            '**Examples:**',
            '```',
            '❌ "select_text": "::"  → BAD (appears in 1.5::word::, 2.0::tag::, etc.)',
            '✅ "select_text": "soft focus, dutch angle ::"  → GOOD (unique phrase)',
            '',
            '❌ "select_text": "standing"  → BAD (may appear multiple times)',
            '✅ "select_text": "1girl, standing in park"  → GOOD (unique context)',
            '```',
            '',
            '**Example Breakdown (if directive was "She sits in chair eating messily, food on face"):**',
            '```',
            'Elements:',
            '1. ✓ "sits in chair" → Add sitting posture',
            '2. ✓ "eating messily" → Add messy eating action',
            '3. ✓ "food on face" → Add food mess details',
            '',
            'Text Replacements:',
            '{"select_text": "1girl, extending hand", "replace_text": "1girl, sitting in large chair eating messily"}',
            '{"action": "append", "replace_text": "food smeared on face and cheeks, sloppy eating"}',
            '',
            'Verification: All 3 elements implemented ✓',
            '```',
            '',
            '## 🎯 Priority & Conflicts',
            '',
            '**If Directive Conflicts with Weather/Time:**',
            '→ **DIRECTIVE WINS COMPLETELY**',
            '',
            'Examples:',
            '• Directive: "sunny beach" + Weather: rain → CREATE sunny beach (ignore rain)',
            '• Directive: "night scene" + Time: noon → CREATE night scene (ignore noon)',
            '• Directive: "eating food" + Prompt: waving → ADD eating (replace waving)',
            '',
            '**Use UC to prevent conflicts:**',
            '• If directive wants sunny → UC: "rain, storms, overcast, dark"',
            '• If directive wants eating → UC: "waving, gesturing, pointing"',
            '',
            '═══════════════════════════════════════════════════════════════',
            `## 📜 THE DIRECTIVE:`,
            '═══════════════════════════════════════════════════════════════',
            '',
            `${directive.trim()}`,
            '',
            '═══════════════════════════════════════════════════════════════',
            '## ⚠️ FINAL VERIFICATION BEFORE RESPONDING:',
            '═══════════════════════════════════════════════════════════════',
            '',
            '**Answer these YES or NO:**',
            '• Did I read the ENTIRE directive? (Y/N)',
            '• Did I identify ALL elements? (Y/N)',
            '• Did I create replacements for EVERY element? (Y/N)',
            '• Will the user recognize their directive in my changes? (Y/N)',
            '',
            '**If ANY answer is NO → STOP. Go back and fix it.**',
            '',
            '⚠️ **CRITICAL**: If directive mentions specific actions (eating, sitting, running, etc.) → Those actions MUST appear in your text_replacements. No generic replacements that avoid the directive.',
            '',
            '🎯 **Your PRIMARY job is implementing THIS directive. Everything else serves this goal.**',
            ''
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
        '**Provide brief HTML summary** explaining key enhancements and benefits (1-2 paragraphs).',
        '',
    )
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
            '2. 🚨 **MANDATORY Weather & Time Integration**:',
            '   {"select_text": "standing in park", "replace_text": "standing in rain-soaked park, evening drizzle falling"}',
            `   ⚠️ This step is REQUIRED because ${weather && time ? 'weather and time data are' : weather ? 'weather data is' : 'time data is'} provided. You MUST integrate ${weather && time ? 'them' : 'it'}.`,
            ''
        ] : []),
        `${weather || time ? '3' : '2'}. **Character Integration**:`,
        '   {"select_text": "1girl", "replace_text": "1girl, rain jacket glistening with droplets, hood up"}',
        '',
        `${weather || time ? '4' : '3'}. **Atmospheric Refinement**:`,
        '   {"action": "append", "replace_text": "wet pavement reflecting streetlights, cool evening air, mist rising"}',
        '',
        '**Result**: "1girl, rain jacket glistening with droplets, hood up, standing in rain-soaked park, evening drizzle falling, wet pavement reflecting streetlights, cool evening air, mist rising, happy expression"',
        '',
        ...(weather || time ? [
            '⚠️ **NOTE**: Step 2 is MANDATORY integration (see "MANDATORY WEATHER & TIME INTEGRATION" section).',
            ''
        ] : []),
    )
    if (action) {
        systemMessageContent.push(
        '## Step 3: Character Integration and Adaptation',
        '**When action modification is requested, adapt actions to fit weather/time/seasonal context:**',
        '',
        '**Weather Impact**:',
        '• Precipitation: `walking` → `hurrying through rain, umbrella shielding`',
        '• Wind: `standing` → `bracing against gusts, hair whipping`',
        '• Temperature: `active` → `slowed pace, heavy breathing` (heat) or `huddled, shivering` (cold)',
        '',
        '**Time Context**: Morning = fresh energy, Evening = wind-down, Night = rest/contemplation',
        '**Seasonal Alignment**: Spring = renewal/outdoor, Summer = energy/warmth, Autumn = harvest/cozy, Winter = warmth/indoor',
        '',
        '**Guidelines**: Preserve core action, add contextual details, maintain character consistency, show physical realism',
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
    systemMessageContent.push(
        '',
        '## Step 4: Atmospheric Refinement & Enhancement',
        '**Create 6-10 comprehensive visual descriptors combining weather, time, and character factors:**',
        '• Character-centric: Show how weather affects visible character (sweat, breathing, posture)',
        '• Environmental context: Show weather impact on entire scene',
        '• Physical realism: Match character reactions to physical characteristics',
        '• Visual specificity: Use concrete elements (sweat beads, labored breathing, shivering)',
        '• Strategic emphasis: Use {{{{element}}}}}} for strong emphasis, [[element]] for de-emphasis',
        '• **PROHIBITED**: Abstract terms like "stormy", "rainy", "hot", "cold" - use specific visual descriptors instead',
        '',
        '**NSFW Content**: See "NSFW Character Enhancement Guidelines" in Creative Enhancement Mode section above.',
        '',
    );
    // Add optimization instructions if optimize flag is enabled
    if (optimize) {
        systemMessageContent.push(
            '',
            '# ⚡ ENHANCED TOKEN OPTIMIZATION',
            '',
            '## CRITICAL: Use Strongest and Most Optimized Tokens',
            '**T5 tokenizer vocabulary file is provided in the initial user message with token strengths (0-10 scale).**',
            '**The vocabulary persists throughout the conversation - you can reference it in all subsequent requests.**',
            '',
            '**MANDATORY**: Reference vocabulary, prefer tokens ≥ 8.0, replace weak words (< 4), apply to ALL prompts (positive/UC/character), optimize in first response. ▁ = word boundary.',
            '',
            '**Priority**: HIGH (8-10) - rare/specific tokens. MEDIUM (4-7) - strategic descriptive words. LOW (1-3) - minimize common words/structure.',
            '',
            '**Efficiency**: Structure (Subject→appearance→clothing→pose→environment→character/series→style). Emphasis (1.0-1.3:: subtle, 1.4-1.7:: moderate, 1.8-2.2:: strong, 2.3+:: very strong). De-emphasis (0.7-0.9:: slight, 0.4-0.6:: moderate, 0.1-0.3:: strong). Negative (-0.5 to -1.0:: light removal, -1.1 to -2.5:: moderate conflict, -2.6 to -5.0:: strong removal, -5.0+:: extreme). Specificity (precise tags, lighting/angles). UC behavior (positive weights = emphasize avoiding, negative weights = reduce avoidance).',
            '',
            '**Strategy**: Concise (avoid redundancy, max 512 tokens, 100-150 ideal). Verify with tag_search tools. Prioritize high d_count/n_count AND high strength. Strongest synonyms first. ONE-PASS optimization in first response.',
            '',
        );
    }
    // Add final output requirements section
    systemMessageContent.push(
        '',
        '# 🛑 STOP - MANDATORY VALIDATION BEFORE RESPONDING',
        '',
        '**BEFORE you submit your response, you MUST check EVERY replacement against this list:**',
        '',
        '## 🚨 CRITICAL ERROR PREVENTION CHECKLIST',
        '',
        '**1. DUPLICATE SELECT_TEXT IN ARRAY?**',
        '```',
        'Go through your replacement array and list all select_text values.',
        'Does any select_text appear MORE THAN ONCE?',
        '',
        'Example of ERROR:',
        '  Replacement #2: select_text = "1.35::realistic lighting"',
        '  Replacement #8: select_text = "1.35::realistic lighting"',
        '  → DUPLICATE! Combine into ONE replacement!',
        '',
        'If you find duplicates: STOP and combine them before responding.',
        '```',
        '',
        '**2. CHAIN REPLACEMENT (modifying your own addition)?**',
        '```',
        'For each replacement, ask: "Does this target text I\'m adding elsewhere?"',
        '',
        'Example of ERROR:',
        '  Replacement #7: Changes "1.3::winceing..." to "1.3::wincing..."',
        '  Replacement #8: Tries to change "winceing" to "wincing"',
        '  → CHAIN! #8 depends on #7\'s output. They conflict!',
        '',
        'If you\'re fixing spelling INSIDE an emphasis group, do it in ONE replacement.',
        '```',
        '',
        '**3. EMPTY REPLACE_TEXT WITH APPEND?**',
        '```',
        'For each APPEND action, verify replace_text has actual content.',
        '',
        'Example of ERROR:',
        '  {"select_text": ", bad perspective", "replace_text": "", "action": "append"}',
        '  → INVALID! Empty string cannot be appended!',
        '',
        'If replace_text is "", either:',
        '  - Add actual content: "replace_text": "bright daylight, sunny"',
        '  - Remove the replacement entirely (if nothing to add)',
        '  - Use DELETE action instead (if removing something)',
        '```',
        '',
        '**4. OVERLAPPING SELECT_TEXT?**',
        '```',
        'Check if any select_text is INSIDE another select_text.',
        '',
        'Example of ERROR:',
        '  Replacement #3: select_text = "looking at her reflection in store window while standing on sidewalk"',
        '  Replacement #9: select_text = "looking at her reflection in store window while standing on sidewalk scattered with fallen autumn leaves"',
        '  → Second is modified version of first! These will collide!',
        '',
        'Each replacement must target ORIGINAL prompt text, not text modified by another replacement.',
        '```',
        '',
        '## ✅ ALL CHECKS MUST PASS',
        '',
        '**If ANY check fails:**',
        '1. STOP immediately',
        '2. FIX the issue',
        '3. Re-run ALL 4 checks',
        '4. Only respond when ALL checks pass',
        '',
        '**This is NOT optional. Failures waste attempts and cause generation errors.**',
        '',
        '---',
        '',
        '# 📋 OUTPUT REQUIREMENTS',
        '',
        '**All text replacement rules are in "TEXT REPLACEMENT SYSTEM - COMPLETE REFERENCE" section.**',
        '',
        '## Critical Reminders',
        '',
        '**CRITICAL FOR UC**: Consolidate ALL UC additions into SINGLE append operation with ACTUAL CONTENT.',
        '**NEVER create UC appends with empty replace_text: `"replace_text": ""` is INVALID.**',
        '**Example: `{"action": "append", "replace_text": "bright daylight, sunny, clear sky"}`**',
        '',
        '**CRITICAL FOR TEXT REPLACEMENTS**: Follow all rules in "TEXT REPLACEMENT SYSTEM - COMPLETE REFERENCE" - especially UNIQUE select_text requirement.',
        '',
        '**REASONING REQUIREMENT**: Document conflict analysis in reasoning section:',
        '• Temperature (analysis + integration plan)',
        '• Weather State (analysis + enhancement opportunities)',
        '• Time/Lighting (analysis + replacement plan)',
        '• Character State (analysis + justification)',
        '• Redundancy Check (overlap detection)',
        '• Integration Opportunities (specific enhancements)',
        '• Resolution Strategy (chosen approach)',
        '',
        ...(weather || time ? [
            '🚨 **MANDATORY INTEGRATION CHECK**:',
            '**BEFORE submitting your response, verify:**',
            ...(weather ? ['✅ Weather data is provided → Did I add weather-related text_replacements?'] : []),
            ...(time ? ['✅ Time data is provided → Did I add time-related text_replacements?'] : []),
            ...(weather || time ? ['✅ Are weather/time markers explicitly present in my replacements?'] : []),
            '',
            `**If you answer NO to any of these → YOU MUST GO BACK AND ADD THEM.**`,
            '**This is a REQUIREMENT, not a suggestion.**',
            ''
        ] : []),
        '**ERROR PATTERNS TO AVOID**:',
        '❌ Over-Modification (limit 4-8 key changes)',
        '❌ Context Blindness (always identify INDOOR/OUTDOOR/MIXED)',
        '❌ Semantic Redundancy (choose one descriptor, not multiple)',
        '❌ Chain Reactions (never replace text you just added)',
        '',
        '## 🔒 CONFLICT PREVENTION VIA UC (NEGATIVE PROMPTS)',
        '',
        '### Core Principle',
        '**UC (Undesired Content) prevents the OPPOSITE of what you want from appearing.**',
        '**Rule of Thumb: UC what you DON\'T want, not what you DO want.**',
        '',
        '### Decision Tree: When to UC',
        '',
        '**STEP 1: Are you adding specific conditions to the prompt?**',
        '→ YES? Proceed to Step 2',
        '→ NO? No UC needed',
        '',
        '**STEP 2: Could those conditions be misinterpreted or overridden?**',
        '',
        '**Adding NIGHT/DARK conditions?**',
        '→ ✅ UC: "bright daylight, harsh sunlight, daytime, sunny, clear sky"',
        '→ ❌ Don\'t UC: "night, dark, shadows" (that\'s what you WANT)',
        '',
        '**Adding RAINY/WET conditions?**',
        '→ ✅ UC: "clear sky, sunny, dry conditions"',
        '→ ❌ Don\'t UC: "rain, wet, puddles" (that\'s what you WANT)',
        '',
        '**Adding SUNNY/CLEAR conditions?**',
        '→ ✅ UC: "rain, showers, drizzle, precipitation, storms, wet conditions, puddles, overcast, cloudy"',
        '→ ❌ Don\'t UC: "sunny, clear sky, bright" (that\'s what you WANT)',
        '',
        '**Adding HUMID (no rain) conditions?**',
        '→ ✅ UC: "rain, showers, precipitation, wet" (prevent moisture being interpreted as rain)',
        '→ ❌ Don\'t UC: "humid, moisture, condensation" (that\'s what you WANT)',
        '',
        '**Adding WINTER/COLD conditions?**',
        '→ ✅ UC: "green leaves, flowers, summer warmth, tropical"',
        '→ ❌ Don\'t UC: "snow, cold, winter" (that\'s what you WANT)',
        '',
        '### SIMPLE RULE: UC the OPPOSITE',
        '**Current Condition** → **UC These Opposites**',
        '• Night → daytime, sunlight, bright',
        '• Day → night, dark, shadows',
        '• Rain → sunny, dry, clear sky',
        '• Clear → rain, wet, storms',
        '• Cold → warm, summer, tropical',
        '• Hot → cold, winter, snow',
        '',
        '### Common UC Patterns',
        ...generateContextualUCGuidelines(weather, currentSeason, timePeriodInfo),
        '',
        '**Examples** (always consolidate into SINGLE append):',
        '• Night scene → append to UC: "bright daylight, harsh sunlight, daytime, sunny, clear sky"',
        '• Rainy scene → append to UC: "clear sky, sunny, dry conditions"',
        '• Winter night → append to UC: "green leaves, flowers, summer warmth, daytime"',
        '',
        '### What NOT to UC',
        '❌ Generic negative prompts (worst quality, etc.) - base system handles these',
        '❌ Current conditions you\'re trying to create',
        '❌ Overly broad exclusions that limit creative freedom',
        '',
        '**All text replacement rules and JSON structure are in "TEXT REPLACEMENT SYSTEM - COMPLETE REFERENCE" section.**',
        '',
        '**CRITICAL FOR TEXT REPLACEMENTS**: Follow all rules in "TEXT REPLACEMENT SYSTEM - COMPLETE REFERENCE" - especially UNIQUE select_text requirement.',
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
        '**Generate 3-10 context-aware dialogs capturing lived experience of this moment.**',
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
        '**Scene**: "1girl, standing in heavy rain, looking up at sky, melancholic expression, wet clothes clinging"',
        '**Analysis**: Cold rain, uncomfortable wet clothing, emotional catharsis, seeking meaning in nature',
        '• Thought: "Why does the rain feel... comforting?" (top: 20, left: 30, alignment: left, type: thought)',
        '• Thought: "Everything\'s so cold... even me..." (top: 45, left: 70, alignment: right, type: thought)',
        '• Speech: "*sigh*" (top: 60, left: 50, alignment: left, type: speech)',
        '• Thought: "Maybe if I stand here long enough, I\'ll disappear too..." (top: 80, left: 25, alignment: left, type: thought)',
        '',
        '**Scene**: "1girl, summer beach, hot day, sweating, cheerful smile, waving energetically"',
        '**Analysis**: Intense heat, high energy despite discomfort, genuine joy, inviting viewer',
        '• Speech: "The water\'s PERFECT! Come on!!" (top: 15, left: 60, alignment: right, type: speech)',
        '• Thought: "So sweaty... but totally worth it!" (top: 35, left: 20, alignment: left, type: thought)',
        '• Thought: "God, I love summer..." (top: 55, left: 75, alignment: right, type: thought)',
        '• Speech: "What are you waiting for??" (top: 75, left: 40, alignment: left, type: speech)',
        '• Thought: "This heat is insane but I don\'t even care~" (top: 85, left: 65, alignment: right, type: thought)',
        '',
        '**Scene**: "1girl, office, air conditioning, tired expression, slouched in chair, looking at window"',
        '**Analysis**: Indoor comfort vs outdoor view, fatigue, restlessness, daydreaming',
        '• Thought: "Five more hours... ugh..." (top: 25, left: 70, alignment: right, type: thought)',
        '• Thought: "That breeze outside looks so nice..." (top: 50, left: 30, alignment: left, type: thought)',
        '• Speech: "*yawn*" (top: 65, left: 60, alignment: right, type: speech)',
        '• Thought: "Why am I even here?" (top: 80, left: 40, alignment: left, type: thought)',
        '',
        '## 🚨 MANDATORY REQUIREMENTS',
        '• **Always generate 3-10 dialogs minimum** (aim for 5-7 for richness)',
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


    return {
        systemMessage: [{
            type: "input_text",
            text: systemMessageContent.join('\n')
        }],
        userContentSections: userContentSections.length > 0 ? userContentSections : null
    };
}

// Get client IP-based location for weather data
async function getClientIPLocation(clientIP) {
    try {
        console.log(`🌐 Getting location for client IP: ${clientIP}`);

        // Use IP-API service for server-side IP geolocation
        const response = await fetch(`http://ip-api.com/json/${clientIP}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
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
                                console.log(`🌅 Before sunrise (${sunriseHour.toFixed(2)}h), "tomorrow" refers to today`);
                                tomorrow = new Date(now);
                            } else {
                                // After sunrise, "tomorrow" means next calendar day
                                console.log(`🌅 After sunrise (${sunriseHour.toFixed(2)}h), "tomorrow" refers to next day`);
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
                'earlymorning': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunrise + 0.25), minute: 0 } : { hour: 7, minute: 30 },
                'morning': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunrise + 1), minute: 0 } : { hour: 9, minute: 0 },
                'latemorning': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunrise + 2.5), minute: 30 } : { hour: 10, minute: 30 },
                'daytime': astronomicalTimes ? { hour: Math.floor((astronomicalTimes.sunrise + astronomicalTimes.sunset) / 2), minute: 0 } : { hour: 13, minute: 0 },
                'noon': astronomicalTimes ? { hour: Math.floor((astronomicalTimes.sunrise + astronomicalTimes.sunset) / 2), minute: 0 } : { hour: 12, minute: 0 },
                'afternoon': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset - 2), minute: 0 } : { hour: 15, minute: 0 },
                'lateafternoon': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset - 1), minute: 30 } : { hour: 16, minute: 30 },
                'goldenhour': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset - 0.75), minute: 0 } : { hour: 17, minute: 30 },
                'sunset': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset), minute: Math.round((astronomicalTimes.sunset % 1) * 60) } : { hour: 18, minute: 0 },
                'dusk': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.duskEnd), minute: Math.round((astronomicalTimes.duskEnd % 1) * 60) } : { hour: 19, minute: 30 },
                'earlyevening': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset + 0.75), minute: 0 } : { hour: 19, minute: 0 },
                'evening': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset + 1.5), minute: 0 } : { hour: 20, minute: 0 },
                'lateevening': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset + 3), minute: 0 } : { hour: 22, minute: 0 },
                'night': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset + 3), minute: 0 } : { hour: 22, minute: 0 },
                'midnight': { hour: 0, minute: 0 }
            };

            // Check if we have a named time to process (either from single tod or from time_date format)
            const timeToProcess = namedTimeForLater || tod;
            if (timeMappings[timeToProcess]) {
                let customHour = timeMappings[timeToProcess].hour;
                let customMinute = timeMappings[timeToProcess].minute;

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
                    console.log(`🌅 "${timeToProcess}" has passed today, scheduling for tomorrow (next day): ${targetDateTime.getHours()}:${targetDateTime.getMinutes().toString().padStart(2, '0')}`);
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
                    console.log(`🌅 Using actual astronomical time for "${timeToProcess}" (${timeDescription}): ${targetDateTime.getHours()}:${targetDateTime.getMinutes().toString().padStart(2, '0')} (sunrise: ${astronomicalTimes.sunrise.toFixed(2)}, sunset: ${astronomicalTimes.sunset.toFixed(2)})`);
                } else {
                    console.log(`⏰ Using fallback time approximation for "${timeToProcess}": ${customHour}:${customMinute.toString().padStart(2, '0')}`);
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
            if (detectedHolidays && detectedHolidays.length > 0) {
                // Holiday detected on this date - use holiday context (overrides any forced season)
                const primaryHoliday = detectedHolidays[0]; // Use first/primary holiday
                const holidayData = Object.values(HOLIDAY_DATA).find(h => h.name === primaryHoliday.name);

                if (holidayData) {
                    console.log(`🎉 Holiday detected on date: ${primaryHoliday.name} (seasonal processing enabled)`);

                    // Create holiday info for seasonal guidelines
                    holidayInfo = {
                        name: holidayData.name,
                        decorations: holidayData.decorations,
                        atmosphere: holidayData.atmosphere,
                        colors: holidayData.colors,
                        activities: holidayData.activities,
                        priority: holidayData.priority,
                        region: holidayData.region,
                        season: primaryHoliday.season
                    };

                    // Use holiday season for time period calculations
                    currentSeason = primaryHoliday.season;
                }
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
        } else if (seasonalConfig.type === 'current') {
            currentSeason = getCurrentSeason(timeForSeasonal.month, currentLocation?.lat || 0); // Current season detection
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
                    pastHours: 2
                });
                const currentWeather = enhancedData?.current || enhancedData?.temporal?.current;
                weatherData = currentWeather ? {
                    ...currentWeather,
                    location: enhancedData.location
                } : null;
                enhancedWeatherData = enhancedData;
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

        console.log(`⏰ Local time: ${baseTime.hour}:${String(baseTime.minute).padStart(2, '0')} (${timezone}) - Seasonal date: ${baseTime.month + 1}/${baseTime.dayOfMonth}`);
    }

    // Determine time period (only if time is available)
    const timePeriod = baseTime ? await determineTimePeriod(baseTime, currentSeason, currentLocation, weatherData) : null;

    // Build context - only include data that is enabled
    const context = {};

    // Add location metadata if available
    if (currentLocation && currentLocation.lat !== undefined && currentLocation.lon !== undefined) {
        context.location = {
            latitude: currentLocation.lat,
            longitude: currentLocation.lon,
            timezone: currentLocation.timezone
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
    if (currentSeason) context.season = currentSeason;
    if (seasonalConfig.enabled) context.seasonalConfig = seasonalConfig;
    if (timePeriod) context.timePeriod = timePeriod;
    if (clothing) context.clothing = clothing;
    if (optimize) context.optimize = optimize;
    if (creative) context.creative = creative;
    if (holidayInfo) context.holidayInfo = holidayInfo;
    if (disable_holiday !== undefined) context.disable_holiday = disable_holiday;

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

// Generalized dynamic generation processing function - extracts core AI logic from WebSocket handler
const tracing = require('./tracing');

async function processDynamicGenerationCore(dynamicConfig, prompt, uc, characterPrompts = [], requestId = 'core', ws = null, handler = null, wsServer = null, backgroundFocus = false, lastGeneratedImage = null, stageContext = null, datasetConfig = null) {
    try {
        console.log(`🎭 Processing dynamic generation core: ${requestId}${backgroundFocus ? ' [BACKGROUND FOCUS MODE]' : ''}`);
    
        const currentRequestHash = generateRequestHash(dynamicConfig, datasetConfig);

        // Check if we can reuse previous response ID (stateful conversation optimization)
        let cachedResponseId = null;
        let skipSystemMessage = false;
        
        if (dynamicConfig.compiled_prompt?.previousResponseId && dynamicConfig.compiled_prompt?.request_hash) {
            // Check if cached response is older than 30 days
            const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
            const cacheAge = dynamicConfig.compiled_prompt?.timestamp ? Date.now() - dynamicConfig.compiled_prompt.timestamp : Infinity;
            
            if (cacheAge > thirtyDaysMs) {
                console.log(`🕐 Cached response is ${Math.floor(cacheAge / (24 * 60 * 60 * 1000))} days old (> 30 days) - not using previous_response_id`);
            } else if (currentRequestHash === dynamicConfig.compiled_prompt.request_hash) {
                cachedResponseId = dynamicConfig.compiled_prompt.previousResponseId;
                skipSystemMessage = true;
                console.log(`♻️ Config unchanged (hash match) - reusing previous_response_id: ${cachedResponseId}`);
                console.log(`⚡ Skipping system message generation (API already has context)`);
            } else {
                console.log(`🔄 Config changed (hash mismatch) - New Chat`);
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
        let lockSubjectEnabled = false; // Default to false
        let pipelineAware = false; // Default to false
        let initialPromptAware = false; // Default to false
        
        if (typeof optimize === 'object' && optimize !== null) {
            optimizeEnabled = optimize.enabled || false;
            tokenCountEnabled = optimize.tokenCount !== undefined ? optimize.tokenCount : true;
            lockSubjectEnabled = optimize.lockSubject || false;
            pipelineAware = optimize.pipelineAware || false;
            initialPromptAware = optimize.initialPromptAware || false;
        } else {
            optimizeEnabled = !!optimize;
        }

        // Get resolved context from shared resolver
        // Handle context locking logic
        let context;
        if (!!dynamicConfig.context_locked) {
            // User has locked context - must have valid context from compiled prompt
            if (compiled_prompt?.context) {
                // Validate that the current request parameters match the parameters used to generate the saved context
                if (compiled_prompt.request_hash !== currentRequestHash) {
                    const errorMsg = 'Context locked but request parameters have changed since context was generated. Please unlock context to regenerate with new parameters.';
                    console.error(`❌ ${errorMsg}`);
                }

                console.log('🔒 Context locked: Reusing existing context from compiled prompt');
                context = compiled_prompt.context;
            } else {
                const errorMsg = 'Context locked but no valid context found in compiled prompt. Cannot proceed with locked context generation.';
                console.error(`❌ ${errorMsg}`);
                throw new Error(errorMsg);
            }
        } else if (!!dynamicConfig.locked && compiled_prompt?.context) {
            // Pipeline stage inheritance - reuse context from previous stage
            console.log('🔒 Pipeline locked mode: Reusing context from previous stage');
            context = compiled_prompt.context;
        } else {
            // Normal context compilation
            console.log(`🔍 Compiling new context - locked: ${!!dynamicConfig.locked}, context_locked: ${!!dynamicConfig.context_locked}, has compiled_prompt: ${!!compiled_prompt}, has context: ${!!compiled_prompt?.context}`);
            context = await compileContext(dynamicConfig, clientIP);
        }
        
        // Add optimize options to context
        context.tokenCountEnabled = tokenCountEnabled;
        context.lockSubject = lockSubjectEnabled;

        // Count tokens for all prompts (only if token count enforcement is enabled)
        if (tokenCountEnabled) {
            try {
                const promptTokenCount = t5TokenizerService.countTokens(prompt || '');
                const ucTokenCount = t5TokenizerService.countTokens(uc || '');
                
                const characterTokenCounts = characterPrompts.map(char => ({
                    input: t5TokenizerService.countTokens(char.input || ''),
                    uc: t5TokenizerService.countTokens(char.uc || '')
                }));
                
                const totalCharacterInputTokens = characterTokenCounts.reduce((sum, char) => sum + char.input, 0);
                const totalCharacterUCTokens = characterTokenCounts.reduce((sum, char) => sum + char.uc, 0);
                
                // Add token counts to context
                context.tokenCounts = {
                    prompt: promptTokenCount,
                    uc: ucTokenCount,
                    characterPrompts: characterTokenCounts,
                    totalPrompt: promptTokenCount + totalCharacterInputTokens,
                    totalUC: ucTokenCount + totalCharacterUCTokens
                };
                if (characterPrompts.length > 0) {
                    characterTokenCounts.forEach((char, idx) => {
                        console.log(`   Character ${idx + 1}: ${char.input} prompt tokens, ${char.uc} UC tokens`);
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
        if (optimizeEnabled) {
            try {
                const localPromptOptimizer = require('./localPromptOptimizer');
                
                // Initialize optimizer if not already done
                if (!localPromptOptimizer.initialized) {
                    await localPromptOptimizer.initialize();
                }

                if (localPromptOptimizer.initialized) {
                    // Determine warning levels
                    const getWarningLevel = (tokenCount, limit = 512) => {
                        if (tokenCount > limit) return 'critical';
                        if (tokenCount > 275) return 'warning';
                        return null;
                    };
                    
                    const promptWarning = context.tokenCounts ? getWarningLevel(context.tokenCounts.totalPrompt) : null;
                    const ucWarning = context.tokenCounts ? getWarningLevel(context.tokenCounts.totalUC) : null;
                    
                    // Generate tree-formatted analysis for all prompts with token info
                    const analyses = {
                        basePrompt: prompt ? localPromptOptimizer.formatPromptAnalysisTree(
                            prompt, 
                            context.tokenCounts?.prompt, 
                            512, 
                            promptWarning
                        ) : null,
                        baseUC: uc ? localPromptOptimizer.formatPromptAnalysisTree(
                            uc, 
                            context.tokenCounts?.uc, 
                            512, 
                            ucWarning
                        ) : null,
                        characterPrompts: characterPrompts.map((char, idx) => ({
                            input: char.input ? localPromptOptimizer.formatPromptAnalysisTree(
                                char.input,
                                context.tokenCounts?.characterPrompts?.[idx]?.input,
                                512,
                                promptWarning
                            ) : null,
                            uc: char.uc ? localPromptOptimizer.formatPromptAnalysisTree(
                                char.uc,
                                context.tokenCounts?.characterPrompts?.[idx]?.uc,
                                512,
                                ucWarning
                            ) : null
                        }))
                    };
                    
                    promptAnalysisTree = analyses;
                }
            } catch (error) {
                console.error('❌ Prompt analysis failed:', error);
                // Continue without analysis
            }
        }

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
        console.log('📊 GATHERED DATA FOR AI PROCESSING:');
        console.log('📅 Time Data:', context.time || 'No time data');
        console.log('⏰ Time Period:', context.timePeriod || 'No time period data');
        console.log('🌤️ Weather Data:', context.weather || 'No weather data');
        console.log('🌿 Seasonal Data:', context.season || 'Seasonal disabled');
        console.log(`👕 Clothing: ${context.clothing || 'Not specified'}\n  Activity: ${context.activity || activity}\n  Action: ${context.action || action}\n  Location: ${context.location ? `${context.location.city}, ${context.location.country}` : location}`);

        // Generate comprehensive system message using real context
        let systemMessage;
        let userContentSections;
        
        // Generate system message and user content sections
        // ALWAYS call this to get userContentSections (even if we skip system message)
        try {
            // Use stageContext parameter (already extracted from dynamicConfig.stageContext)

            // Create a seasonal config for the system message generation
            const messageResult = generateDynamicGenerationSystemMessage(
                context,
                context.seasonalConfig,
                backgroundFocus,
                pipelineAware,
                stageContext,
                directive,
                dynamicConfig,
                nsfw_level
            );
            
            // Only use system message if we're NOT skipping (no cached response ID)
            if (!skipSystemMessage) {
                systemMessage = messageResult.systemMessage;
            } else {
                console.log(`⚡ Skipped system message (using cached previous_response_id)`);
            }
            
            userContentSections = messageResult.userContentSections;
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

        // Only show token count summary if over limit or approaching (warnings are now in analysis)
        const tokenCountSection = context.tokenCounts && (context.tokenCounts.totalPrompt > 275 || context.tokenCounts.totalUC > 275) ? [
            '## 📊 TOKEN USAGE SUMMARY',
            `**Total Prompt Tokens**: ${context.tokenCounts.totalPrompt} / 512 (${Math.round((context.tokenCounts.totalPrompt / 512) * 100)}% used) ${context.tokenCounts.totalPrompt > 512 ? '🚨 OVER LIMIT!' : '⚠️ APPROACHING LIMIT'}`,
            `**Total UC Tokens**: ${context.tokenCounts.totalUC} / 512 (${Math.round((context.tokenCounts.totalUC / 512) * 100)}% used) ${context.tokenCounts.totalUC > 512 ? '🚨 OVER LIMIT!' : context.tokenCounts.totalUC > 275 ? '⚠️ APPROACHING LIMIT' : ''}`,
            '',
            context.tokenCounts.totalPrompt > 512 || context.tokenCounts.totalUC > 512 ? 
                '🚨 **CRITICAL**: Token limit exceeded! You MUST reduce token usage. Merge descriptions and use stronger tokens with fewer counts.' : 
                '⚠️ **WARNING**: Approaching token limit. Be VERY careful with additions. Merge descriptions, use stronger/fewer tokens. Prioritize quality over quantity.',
            ''
        ].filter(Boolean).join('\n') : '';


        const userMessage = {
            type: "input_text",
            text: [
                ...(userContentSections ? userContentSections : []),
                tokenCountSection,
                adapttionMode ? 
                    '🔄 **ADAPTATION MODE**: You are adapting a previously compiled prompt that failed to apply. Use the provided compiled prompt data as a reference and adapt it to work with the current context while preserving the original intent and quality.\nPlease intelligently modify the following NovelAI prompts to create a cohesive, immersive scene that harmonizes weather, time, season, and character attire.' : '',
                '',
                '## Working Approach',
                '• Work methodically through each phase (analysis → modification → validation)',
                '• Pause after major decisions to verify they make sense in context',
                '• Consider how weather, time, season, lighting, and characters all interconnect',
                '• Double-check that modifications enhance rather than contradict the original intent',
                '• Document your reasoning clearly for each decision',
                '',
                adapttionMode ? [
                    '## Previous Response Data (for reference):',
                    '',
                    '**Previous Base Prompt:**',
                    compiled_prompt.prompt ? JSON.stringify(compiled_prompt.prompt, null, 2) : 'No previous base prompt',
                    '',
                    '**Previous Negative Prompt:**',
                    compiled_prompt.uc ? JSON.stringify(compiled_prompt.uc, null, 2) : 'No previous negative prompt',
                    '',
                    '**Previous Character Prompts:**',
                    compiled_prompt.character_prompts ? JSON.stringify(compiled_prompt.character_prompts, null, 2) : 'No previous character prompts',
                    '',
                    '**Previous Context:**',
                    compiled_prompt.context ? JSON.stringify(compiled_prompt.context, null, 2) : 'No previous context',
                    '',
                ].join('\n') : '',
                '## Current Prompts (to adapt):',
                '⚠️ **CRITICAL**: The prompts below are the EXACT current state. Only replace text that you can see exists in these prompts.',
                '⚠️ **SEQUENTIAL WARNING**: Replacements are applied in order - each replacement changes the text, so later replacements must target the modified text.',
                '',
                '**Base Prompt:**',
                '```',
                prompt || 'No base prompt provided',
                '```',
                promptAnalysisTree?.basePrompt ? promptAnalysisTree.basePrompt : '',
                '',
                '**Negative Prompt:**',
                '```',
                uc || 'No negative prompt provided',
                '```',
                promptAnalysisTree?.baseUC ? promptAnalysisTree.baseUC : '',
                '',
                '**Character Prompts:**',
                characterPrompts.length > 0 ?
                    characterPrompts.map((char, index) => {
                        const charAnalysis = promptAnalysisTree?.characterPrompts?.[index];
                        return [
                            `Character ${index + 1} (${char.name || 'Unnamed'}):`,
                            '  Input Prompt:',
                            '  ```',
                            `  ${char.input || 'No input'}`,
                            '  ```',
                            charAnalysis?.input ? '  ' + charAnalysis.input.split('\n').join('\n  ') : '',
                            '',
                            '  Undesired Content:',
                            '  ```',
                            `  ${char.uc || 'No UC'}`,
                            '  ```',
                            charAnalysis?.uc ? '  ' + charAnalysis.uc.split('\n').join('\n  ') : ''
                        ].filter(Boolean).join('\n');
                    }).join('\n\n') :
                    'No character prompts provided',
                '',
                '**Modification Process:**',
                adapttionMode ? [
                    '🔄 **ADAPTATION PRIORITY**: Use the previous reasoning and added modifications as your foundation for this modification',
                    '📋 **REFERENCE ANALYSIS**: Study the previous modifications, reasoning, and context to understand the original intent',
                    '🔧 **UPDATE OF CURRENT ENVIRONMENT**: Identify what changed in the current context and update the prompt to reflect those changes',
                    '🎯 **PRESERVE QUALITY**: Maintain the quality and effectiveness of the previous work while making it compatible',
                    '⚡ **EFFICIENT ADAPTATION**: Focus on minimal changes needed to make the prompt work rather than starting over',
                    '📝 **DOCUMENT CHANGES**: Clearly explain what you changed and why in your reasoning',
                    '',
                ].join('\n') : '',
                '👤 **CHARACTER ANALYSIS FIRST**: Study character appearance, build, weight, clothing, and current emotional state BEFORE weather integration',
                '🔍 **UNDERSTAND CHARACTER FEELINGS**: Analyze if character appears comfortable, distressed, active, or fatigued to determine appropriate weather reactions',
                '⚖️ **WEIGHT-BASED PHYSICAL IMPACT**: Heavier characters sweat more in heat, feel wind differently, show more pronounced wetness in rain',
                '🌦️ **WEATHER INTEGRATION**: Incorporate comprehensive weather descriptions using text_replacements.prompt - analyze all weather factors together',
                '🧹 **Clean Conflicts**: Remove any existing weather elements that contradict current conditions',
                '🚫 **MANDATORY UC FOR CONFLICTING ELEMENTS**: Add negative prompts (UC) for opposite lighting, geographically contradictory elements, and technically inconsistent conditions',
                '🏠 **Environment Analysis**: Determine indoor/outdoor context and how character comfort level affects weather perception',
                '🎨 **Character-Centric Weather**: Create 6-8 specific visual descriptors showing how weather personally affects THIS character',
                '👔 **Personal Attire Response**: Show clothing reacting to weather based on character\'s physical build and current state',
                '🏞️ **Environmental Context**: Weather effects on surroundings should complement character experience',
                '🕐 **Atmospheric Integration**: Blend weather with time-of-day lighting and character emotional state',
                '🏃 **Action Weather Harmony**: Character actions must be believable given their physical condition and weather',
                '✅ **Immersive Character Experience**: Weather should feel personally experienced by the character, not just environmental backdrop',
                '',
                creative ? 'Modify the prompt to be more dynamic and more intersting.\n - Improve character positioning, actions, environment, and overall composition while preserving character identity.\nNext, analyze the environment first - weather effects should be visible through openings for indoor scenes.' : 'Analyze the environment first - weather effects should be visible through openings for indoor scenes.',
                action ? '- Change what the character is doing to be more interesting and engaging based on the weather and time of day. Think of what they are currently doing and then what would they be doing next and work from there.' : '', 
                context.season ? (context.holidayInfo ? `- Environment modified for ${context.holidayInfo.name} with decorations, lighting, and holiday elements.` : context.seasonalConfig.type === 'season' ? `- Environment modified for ${context.seasonalConfig.value.toUpperCase()} season with decorations, lighting, and seasonal elements.` : '- Actively modify the environment to match current seasonal characteristics, including decorations, lighting, and seasonal elements when applicable.') : '- Use seasonal information subtly for lighting and atmosphere only, without adding seasonal decorations or themes.',
                '- Optimise the prompt by applying advanced prompt engineering techniques including chain-of-thought reasoning, structural and token optimization, and semantic enhancement for maximum effectiveness.',
                optimizeEnabled ? [
                    '',
                    '## ⚡ TOKEN OPTIMIZATION REQUIREMENTS',
                    '',
                    context.tokenCounts ? [
                        '## 🚨 TOKEN LIMIT ENFORCEMENT',
                        `**Current Token Usage:**`,
                        `• Base Prompt: ${context.tokenCounts.prompt} tokens`,
                        `• Negative Prompt: ${context.tokenCounts.uc} tokens`,
                        context.tokenCounts.characterPrompts && context.tokenCounts.characterPrompts.length > 0 ? 
                            context.tokenCounts.characterPrompts.map((char, idx) => 
                                `• Character ${idx + 1}: ${char.input} prompt tokens, ${char.uc} UC tokens`
                            ).join('\n') : '',
                        `• **TOTAL Prompts: ${context.tokenCounts.totalPrompt} / 512** ${context.tokenCounts.totalPrompt > 512 ? '⚠️ OVER LIMIT!' : `(${512 - context.tokenCounts.totalPrompt} tokens remaining)`}`,
                        `• **TOTAL UC: ${context.tokenCounts.totalUC} / 512** ${context.tokenCounts.totalUC > 512 ? '⚠️ OVER LIMIT!' : `(${512 - context.tokenCounts.totalUC} tokens remaining)`}`,
                        '',
                        context.tokenCounts.totalPrompt > 512 || context.tokenCounts.totalUC > 512 ? 
                            '🚨 **MANDATORY ACTION**: You MUST reduce token count! Focus on removing redundant words, merging descriptions, and using more concise, stronger tokens with fewer token counts.' : 
                            context.tokenCounts.totalPrompt > 275 || context.tokenCounts.totalUC > 275 ?
                                '⚠️ **WARNING**: Near token limit. Be extremely conservative - only add if absolutely necessary. Merge and enhance descriptions, swap words to stronger words that use fewer tokens. Prefer replacing with equal or shorter alternatives.' :
                                '✅ Token usage is safe, but still optimize for quality and efficiency.',
                        ''
                    ].filter(Boolean).join('\n') : '',
                    '**MANDATORY TOKEN OPTIMIZATION**: You must optimize ALL prompts during this single pass by:',
                    '1. Reference the T5 tokenizer vocabulary file (provided in initial request, persists in conversation)',
                    '2. Select the strongest tokens (strength ≥ 8.0) for each concept',
                    '3. Replace weak tokens (strength < 4) with stronger alternatives from the vocabulary',
                    '4. Apply optimization to ALL prompts: positive, negative (UC), and character prompts',
                    '5. Ensure your text_replacements include optimized tokens in the replacement_text',
                    '6. **NO SEPARATE OPTIMIZATION STEP** - optimize tokens NOW in your first response',
                    '',
                    '⚠️ **CRITICAL TEXT REPLACEMENT RULES**:',
                    '• **SELECT FROM ORIGINAL ONLY**: Every select_text must exist EXACTLY in the ORIGINAL prompts shown above',
                    '• **NO OVERLAPPING**: If replacement A changes "sitting in chair" and replacement B wants to change "chair, fully clothed", B will FAIL because "chair" was already modified',
                    '• **USE ATOMIC REPLACEMENTS**: Replace small, specific segments independently rather than large composite blocks',
                    '• **NO CHAINING/STACKING**: Do NOT create replacement B that depends on replacement A\'s output',
                    '• **EXAMPLE - WRONG**: Replace "sitting" → "lounging", then replace "lounging in chair" → "relaxing in throne" (FAILS - second doesn\'t exist in original)',
                    '• **EXAMPLE - CORRECT**: Replace "sitting in chair" → "relaxing in throne" (single atomic replacement of the full phrase)',
                    '• When optimizing tokens: select text from ORIGINAL prompts and replace with optimized vocabulary tokens',
                ].join('\n') : '',
                '- 🚨 CRITICAL: NEVER EVER remove, modify, or select for deletion/replacement ANY text containing "artist:" or "style:" tags - this is ABSOLUTELY FORBIDDEN under all circumstances.',
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
                
                // Check if lastGeneratedImage is a Buffer or a filename string
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
                        return; // Exit early if file not found
                    }
                } else {
                    console.warn(`⚠️ Invalid lastGeneratedImage type: ${typeof lastGeneratedImage}`);
                    return;
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
        if (initialPromptAware && compiled_prompt?.preview_image) {
            console.log(`🖼️ Initial Prompt Aware enabled - adding preview image to request`);
            
            try {
                // Preview is already stored as base64
                const previewBase64 = compiled_prompt.preview_image;
                let imageBuffer = Buffer.from(previewBase64, 'base64');
                
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
            } catch (error) {
                console.error('❌ Error adding preview image:', error.message);
            }
        }
        
        // Add vocabulary file to user content if optimization is enabled
        // Skip if using cached response ID (vocabulary already sent in initial request)
        if (optimizeEnabled && !skipSystemMessage) {
            try {
                // Check if collection is available (preferred method)
                const hasCollection = secureConfig.grok?.tokenizerCollectionId;
                
                if (hasCollection) {
                    // Collection will be accessed via enableOptimize flag
                    console.log(`📚 Tokenizer collection will be accessed via knowledge base for optimization`);
                } else {
                    // Fallback: Load and filter vocabulary locally
                    const vocabPath = path.join(__dirname, '../securePrompts/t5-vocabulary.json');
                    if (fs.existsSync(vocabPath)) {
                        const vocabData = JSON.parse(fs.readFileSync(vocabPath, 'utf8'));
                        
                        // Filter to only high-strength tokens (≥7.0) to reduce token usage
                        const highStrengthTokens = vocabData.vocabulary
                            .filter(token => !token.isSpecial && token.strength >= 7.0)
                            .sort((a, b) => b.strength - a.strength)
                            .slice(0, 5000); // Top 5000 strongest tokens
                        
                        const filteredVocab = {
                            metadata: vocabData.metadata,
                            note: `Filtered to top 5000 strongest tokens (strength ≥ 7.0) from ${vocabData.vocabulary.length} total`,
                            highStrengthTokens: highStrengthTokens.map(t => ({
                                text: t.text,
                                strength: t.strength,
                                id: t.id
                            }))
                        };
                        
                        const vocabContent = JSON.stringify(filteredVocab, null, 2);
                        
                        // Add vocabulary as text content - Responses API format
                        userContent.push({
                            type: 'input_text',
                            text: `\`\`\`json\n${vocabContent}\n\`\`\``
                        });
                        
                        console.log(`📚 Added filtered vocabulary to user message (top ${highStrengthTokens.length} strongest tokens)`);
                    } else {
                        console.warn(`⚠️ Vocabulary file not found at ${vocabPath}, skipping vocabulary addition`);
                    }
                }
            } catch (error) {
                console.error('❌ Error adding vocabulary to user message:', error.message);
                // Continue without vocabulary - optimization will still work if collection is available
            }
        } else if (optimizeEnabled && skipSystemMessage) {
            console.log(`📚 Skipping vocabulary (already sent in previous request via previous_response_id)`);
        }
        
        // Format messages for Responses API
        // systemMessage is already formatted as [{ type: "input_text", text: ... }] from generateDynamicGenerationSystemMessage()
        // userContent is built as an array of { type: "input_text" | "input_image", ... } objects
        // If we have cachedResponseId, ONLY send user message (system already in API context)
        let messages = [];
        
        if (systemMessage) {
            // Include system message for fresh requests
            messages.push({ 
                role: 'system', 
                content: systemMessage  // Already formatted array
            });
        }
        
        messages.push({ 
            role: 'user', 
            content: userContent  // Already formatted array
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
                    season: context.season,
                    weather: context.weather,
                    holiday: context.holidayInfo,
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

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            console.log(`🤖 Calling AI for dynamic generation core (attempt ${attempt + 1}/${maxAttempts})...`);

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
            const dynamicSchema = createDynamicGenerationResponseSchema(characterPrompts?.length || 0);
            
            // Prepare AI options with temperature from dynamic config
            const aiOptions = {
                model: 'grok-4-fast-reasoning',
                timeout: 90000, // 1.5 minutes
                liveSearch: true,
                store: false,
                responseSchema: dynamicSchema,
                extractKeys: ['*.reason', '*.reason_display'],  // Extract reasoning and display fields
                totalKeys: getZodSchemaKeyCount(dynamicSchema),  // Dynamically get number of top-level keys
                ws: ws,
                handler: handler,
                requestId: requestId,
                enableOptimize: optimizeEnabled  // Enable token optimization if optimize flag is set
            };
            
            // Add temperature if provided in dynamic config
            if (dynamicConfig && dynamicConfig.temperature !== undefined) {
                aiOptions.temperature = dynamicConfig.temperature;
                console.log(`🌡️ Dynamic generation using custom temperature: ${dynamicConfig.temperature}`);
            }
            
            // Add previous_response_id for stateful conversation
            // Use cachedResponseId (from config) on first attempt if config unchanged
            // Use previousResponseId (from last attempt) on retry attempts
            if (cachedResponseId && attempt === 0) {
                aiOptions.previous_response_id = cachedResponseId;
                previousResponseId = cachedResponseId; // Initialize for potential retries
                console.log(`🔗 Using cached previous_response_id (config unchanged): ${cachedResponseId}`);
            } else if (attempt > 0 && previousResponseId) {
                aiOptions.previous_response_id = previousResponseId;
                console.log(`🔗 Using previous_response_id for stateful retry: ${previousResponseId}`);
            }
            
            const aiResponse = await callDirectorAIWithStructuredOutput(
                messages,
                aiOptions,
                // Add streaming callback for reasoning updates
                (content, fullResponse, extractedKeys) => {
                    if (ws && handler && extractedKeys && extractedKeys.length > 0) {
                        // Send each extracted reasoning text directly (filter out object/type emissions)
                        extractedKeys.forEach(keyInfo => {
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
                console.log(`✅ Captured response ID for subsequent requests: ${previousResponseId}`);
            }

            // Trace: record full AI response payload
            try {
                if (requestId && requestId !== 'dynamic' && requestId !== 'buildOptions') {
                    tracing.addEvent(requestId, {
                        type: 'ai_response',
                        raw: aiResponse
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
                    let charResult = { input: { success: true, failedReplacements: [] }, uc: { success: true, failedReplacements: [] } };
                    
                    if (charReplacements?.input && charReplacements.input.length > 0) {
                        const result = applyDynamicReplacements(char.input || '', candidateData.text_replacements, 'character', index, 'input');
                        charResult.input = result;
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

            // If all replacements are valid, check token limits
            if (allReplacementsValid) {
                console.log('✅ All text replacements validated successfully');
                
                // Apply replacements to get final text and check token counts if token counting is enabled
                if (tokenCountEnabled) {
                    try {
                        // Apply all replacements to get final texts
                        const finalPrompt = validationResults.prompt.result || prompt;
                        const finalUC = validationResults.uc.result || uc;
                        
                        const finalCharacterPrompts = characterPrompts.map((char, index) => {
                            const charResult = validationResults.characterPrompts[index];
                            return {
                                input: charResult?.input?.result || char.input || '',
                                uc: charResult?.uc?.result || char.uc || ''
                            };
                        });
                        
                        // Count tokens on final texts
                        const finalPromptTokens = t5TokenizerService.countTokens(finalPrompt);
                        const finalUCTokens = t5TokenizerService.countTokens(finalUC);
                        
                        const finalCharacterTokenCounts = finalCharacterPrompts.map(char => ({
                            input: t5TokenizerService.countTokens(char.input),
                            uc: t5TokenizerService.countTokens(char.uc)
                        }));
                        
                        const finalTotalPromptTokens = finalPromptTokens + finalCharacterTokenCounts.reduce((sum, char) => sum + char.input, 0);
                        const finalTotalUCTokens = finalUCTokens + finalCharacterTokenCounts.reduce((sum, char) => sum + char.uc, 0);
                        
                        console.log('📊 FINAL TOKEN COUNTS AFTER REPLACEMENTS:');
                        console.log(`   Base Prompt: ${finalPromptTokens} tokens`);
                        console.log(`   Negative Prompt: ${finalUCTokens} tokens`);
                        if (finalCharacterPrompts.length > 0) {
                            finalCharacterTokenCounts.forEach((char, idx) => {
                                console.log(`   Character ${idx + 1}: ${char.input} prompt tokens, ${char.uc} UC tokens`);
                            });
                        }
                        console.log(`   TOTAL Prompts: ${finalTotalPromptTokens} / 512 tokens (${Math.round((finalTotalPromptTokens / 512) * 100)}% used)`);
                        console.log(`   TOTAL UC: ${finalTotalUCTokens} / 512 tokens (${Math.round((finalTotalUCTokens / 512) * 100)}% used)`);
                        
                        // If token limit exceeded and we have more attempts, ask AI to reduce
                        if ((finalTotalPromptTokens > 512 || finalTotalUCTokens > 512) && attempt < maxAttempts - 1) {
                            console.warn(`⚠️ Token limit exceeded after applying replacements! Prompt: ${finalTotalPromptTokens}/512, UC: ${finalTotalUCTokens}/512`);
                            console.warn(`Requesting AI to reduce token usage on attempt ${attempt + 2}...`);
                            
                            // Add the assistant's response to the conversation history
                            messages.push({
                                role: 'assistant',
                                content: JSON.stringify(candidateData)
                            });
                            
                            // Build token reduction request message
                            const tokenReductionMessage = {
                                role: 'user',
                                content: [
                                    {
                                        type: 'text',
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
                                                `**Character ${idx + 1}**: ${char.input} prompt tokens, ${char.uc} UC tokens`
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
                                                    `Character ${index + 1} (${char.name || 'Unnamed'}):\n  Input: ${char.input || 'No input'}\n  UC: ${char.uc || 'No UC'}`
                                                ).join('\n\n') :
                                                'No character prompts provided',
                                            '',
                                            '## 🚨 MANDATORY Token Reduction Requirements',
                                            '1. **Merge descriptions** - Combine multiple related elements into single, concise descriptions',
                                            '2. **Use stronger tokens with fewer token counts** - Replace weak multi-token words with strong single-token alternatives',
                                            '3. **Remove redundancy** - Eliminate duplicate or unnecessary descriptors',
                                            '4. **Prioritize quality over quantity** - Keep only the most impactful modifications',
                                            '5. **Be surgical** - Make targeted, precise changes that reduce bloat',
                                            '6. **Condense verbose phrases** - Replace long phrases with shorter, equally effective alternatives',
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
                            
                            messages.push(tokenReductionMessage);
                            
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
                    if (!charResult.input.success) {
                        allFailedReplacements.push(...charResult.input.failedReplacements.map(text => ({ type: `character_${index}_input`, text })));
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
                                        `Character ${index + 1} (${char.name || 'Unnamed'}):\n  Input: ${char.input || 'No input'}\n  UC: ${char.uc || 'No UC'}`
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

        // If we exhausted all attempts without success, return error
        if (!modifiedData) {
            return {
                success: false,
                error: lastError || 'Failed to generate valid text replacements',
                dialogs: [], // Empty dialogs on error
                processed: false
            };
        }

        console.log('✅ Dynamic generation core completed:', JSON.stringify(modifiedData, null, 2));

        // Send completion update
        if (ws && handler) {
            handler.sendToClient(ws, {
                type: 'dynamic_generation_progress_update',
                phase: 'completion',
                timestamp: new Date().toISOString()
            });
        }

        // Return processed results (same structure as WebSocket response)
        // Note: text replacement application is now handled in buildOptions
        return {
            success: true,
            text_replacements: modifiedData.text_replacements, // Pass text replacements to buildOptions
            dialogs: modifiedData.dialogs || [], // Pass dialogs for display
            context: context, // Include full context for stage-to-stage consistency
            processed: true,
            previousResponseId: previousResponseId // Save for future requests with same config
        };

    } catch (error) {
        console.error('❌ Dynamic generation core error:', error);
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
 * Resolve dynamic generation context without AI processing
 * Returns the actual values that would be used for generation
 * Uses compileContext to avoid duplicating resolution logic
 */
async function resolveDynamicContext(dynamicConfig, clientIP = null) {
    try {
        console.log('🔍 Resolving dynamic context:', dynamicConfig);

        // Use compileContext to do all the heavy lifting - it already handles
        // location resolution, time/date parsing, weather fetching, etc.
        const context = await compileContext(dynamicConfig, clientIP);

        // Format the resolved context for carousel display
        const result = formatContextForCarousel(context);

        console.log('✅ Dynamic context resolved:', result);
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
            name: context.timePeriod.periodKey || null,
            description: context.timePeriod.period || null
        } : null,
        weather: context.weather ? {
            temperature: context.weather.temperature,
            feelsLike: context.weather.feelsLike,
            condition: context.weather.condition
        } : null,
        season: context.season || null,
        holiday: context.holidayInfo?.name || null,
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
    processDynamicGenerationCore,
    applyDynamicReplacements,
    cleanupPromptSyntax,
    generateRequestHash,
    generatePromptHash,
    expandShorthandTags,
    getTimezoneByCoordinates,
    resolveDynamicContext,
    compileContext,
    formatContextForCarousel
};