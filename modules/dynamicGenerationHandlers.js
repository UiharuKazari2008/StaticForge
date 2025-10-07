// Dynamic Generation Handler Functions
// Handles intelligent prompt modification based on real-world context (time, weather, etc.)

// Load secure configuration
let secureConfig = require('../secure.config.json');
const config = require('../config.json');

const https = require('https');
const { z } = require('zod');

const { determineTimePeriod, getSunriseSunset } = require('./dynamicGenerationHandlers.timeCalc');

const { callDirectorAIWithStructuredOutput } = require('./aiServices/grokService');

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

        if (current.windSpeed > 10) {
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

        if (current.humidity > 80) {
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
        decorations: 'jack-o-lanterns, ghosts, witches, bats, cobwebs, spooky elements, pumpkins, haunted houses',
        atmosphere: 'mysterious, spooky, playful fright, autumn evening, thrilling, eerie',
        colors: 'orange, black, purple, green, white accents',
        activities: 'trick-or-treating, costume parties, haunted houses, pumpkin carving, spooky events'
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
function createDynamicGenerationResponseSchema(expectedCharacterPrompts = 0) {
    return z.object({
    text_replacements: z.object({
        prompt: z.array(z.object({
            reason: z.string()
                .describe("Plain text brief description of the reason for this replacement"),
            select_text: z.string()
                .describe("EXACT text segment (1-5 words) that currently exists in the prompt as provided below (use 'EOF' to append at end)"),
            replace_text: z.string()
                .describe("Text to replace the selected text with"),
        })).describe("Find-and-replace operations for the main prompt"),
        uc: z.array(z.object({
            reason: z.string()
                .describe("Plain text brief description of the reason for this replacement"),
            select_text: z.string()
                .describe("EXACT text segment (1-5 words) that currently exists in the negative prompt as provided below (use 'EOF' to append at end)"),
            replace_text: z.string()
                .describe("Text to replace the selected text with"),
        })).describe("Find-and-replace operations for the negative prompt"),
        character_prompts: z.array(z.object({
            input: z.array(z.object({
                reason: z.string()
                    .describe("Plain text brief description of the reason for this replacement"),
                select_text: z.string()
                    .describe("EXACT text segment (1-5 words) that currently exists in the character prompt as provided below (use 'EOF' to append at end)"),
                replace_text: z.string()
                    .describe("Text to replace the selected text with")
            })).describe("Find-and-replace operations for this character prompt input"),
            uc: z.array(z.object({
                reason: z.string()
                    .describe("Plain text brief description of the reason for this replacement"),
                select_text: z.string()
                    .describe("EXACT text segment (1-5 words) that currently exists in the character negative prompt as provided below (use 'EOF' to append at end)"),
                replace_text: z.string()
                    .describe("Text to replace the selected text with"),
            })).describe("Find-and-replace operations for this character negative prompt")
        })).describe("Array of find-and-replace operations for character prompts (one per character)")
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

    // Separate EOF replacements from regular replacements
    const eofReplacements = [];
    const regularReplacements = [];

    for (const replacement of targetReplacements) {
        if (replacement.select_text === 'EOF') {
            eofReplacements.push(replacement);
        } else {
            regularReplacements.push(replacement);
        }
    }

    // Apply regular replacements in order, allowing chaining but preventing exact duplicate applications
    const appliedReplacements = new Set();
    const failedReplacements = [];

    for (const replacement of regularReplacements) {
        const { select_text, replace_text } = replacement;
        const trimmedSelectText = select_text.trim();
        const replacementKey = `${select_text}|||${replace_text}`;

        // Skip if we've already applied this exact replacement
        if (appliedReplacements.has(replacementKey)) {
            continue;
        }

        console.log(`🔄 Attempting replacement: "${trimmedSelectText}" → "${replace_text}"`);

        const index = result.indexOf(trimmedSelectText);
        if (index !== -1) {
            const beforeReplace = result;
            result = result.substring(0, index) +
                    replace_text +
                    result.substring(index + trimmedSelectText.length);

            // Mark this replacement as applied
            appliedReplacements.add(replacementKey);
        } else {
            // If exact text not found, track the failure - this will cause the entire process to fail
            console.error(`❌ CRITICAL: Could not find exact text "${select_text}" in current result`);
            failedReplacements.push(select_text);
        }
    }

    // FAIL HARD: If any replacements failed, throw an error to invalidate cache and trigger regeneration
    if (failedReplacements.length > 0) {
        throw new Error(`Text replacement validation FAILED: Could not find ${failedReplacements.length} target text(s): ${failedReplacements.join(', ')}. This indicates the AI provided invalid replacement targets and requires regeneration.`);
    }

    // Apply EOF replacements last
    for (const replacement of eofReplacements) {
        const { replace_text } = replacement;
        // Smart EOF handling - inject before ", Text:" if present, otherwise at the end
        const textBoundaryIndex = result.indexOf(', Text:');
        if (textBoundaryIndex !== -1) {
            // Inject before ", Text:" boundary to avoid placing content in display-only areas
            const beforeText = result.substring(0, textBoundaryIndex).trimEnd();
            const needsComma = beforeText && (!beforeText.endsWith(',') || beforeText.endsWith('::'));
            result = beforeText + (needsComma ? ', ' : ' ') + replace_text +
                    result.substring(textBoundaryIndex);
        } else {
            // No boundary found, append to end with proper comma separation
            const trimmedResult = result.trimEnd();
            const needsComma = trimmedResult && (!trimmedResult.endsWith(',') || trimmedResult.endsWith('::'));
            result = trimmedResult + (needsComma ? ', ' : ' ') + replace_text;
        }
    }

    return result;
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
    if (!seasonal || seasonal === false) {
        return { enabled: false };
    }

    // Boolean true: enable current season detection
    if (seasonal === true) {
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

    console.log(`📅 Holiday data validation: ${validHolidays} valid, ${invalidHolidays} invalid`);
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

    if (windSpeedMph >= 58) {
        return 'dangerous winds - high wind warning conditions';
    } else if (windSpeedMph >= 40) {
        return 'very strong winds - high wind warning';
    } else if (windSpeedMph >= 35) {
        return 'strong winds - potential blizzard conditions';
    } else if (windSpeedMph >= 30) {
        return 'moderate to strong winds - wind advisory';
    } else if (windSpeedMph >= 20) {
        return 'fresh winds - breezy conditions';
    } else if (windSpeedMph >= 10) {
        return 'moderate winds - noticeable breeze';
    } else if (windSpeedMph >= 5) {
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
 * @returns {Object} Seasonal modification guidelines
 */
function generateSeasonalGuidelines(time, season, seasonalEnabled, forcedHoliday = null, weather = null) {
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

    if (forcedHoliday) {
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

            if (weather.humidity > 70) {
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
    if (holidayInfo.isHolidayPeriod && holidayInfo.progressiveElements) {
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
    } else if (holidayInfo.isHolidayPeriod) {
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
    if (temperature <= 10 && windSpeedMph >= 3) { // 50°F and wind >= 3 mph
        // Convert to Fahrenheit for wind chill calculation
        const tempF = (temperature * 9/5) + 32;

        // NOAA Wind Chill Formula (2001)
        let windChillF;
        if (tempF <= 50 && windSpeedMph >= 3) {
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
    if (humidity > 80) return 'humid - high moisture content';
    if (humidity < 20) return 'dry - low humidity';
    if (windSpeedMph > 20) return 'windy - strong wind conditions';

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
        windAdvisory: windSpeedMph >= 30 ? 'Wind Advisory' : null,
        windWarning: windSpeedMph >= 40 ? 'High Wind Warning' : null,
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
            `  - **Other Effects**: Heavy sweat effects, skin heavily glistening, exhausted expressions, wet sticky clothing layers, heat stress visible${effectiveUV >= 8 && !timePeriod.includes('night') ? ', intense light causing visual distortion, UV damage apparent on skin' : effectiveUV >= 6 && !timePeriod.includes('night') ? ', sun-induced skin warming and fatigue' : ''}${transitionType === 'sunrise_transition' ? ', morning heat building from cool dawn' : transitionType === 'sunset_transition' ? ', evening heat fading into twilight' : ''}`
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
            `  - **Other Effects**: Slight goosebumps, brisk atmosphere, light layered clothing visible, comfortable but fresh${effectiveUV >= 2 && timePeriod.includes('day') ? ', cool UV exposure' : cloudCoverage >= 30 ? ', soft diffused coolness' : ''}${transitionType === 'sunrise_transition' ? ', coolness lingering from night' : transitionType === 'sunset_transition' ? ', cooling intensifying in evening' : ''}`
        );
    } else if (adjustedTemp >= 0) {
        result.push(
            `### **Cold** (${uvIndex > 0 && effectiveUV >= 1 ? `UV: ${uvDescription}` : ''}${cloudCoverage > 10 ? cloudEffect : ''})`,
            `  - **Character Effects**: Chilled skin showing goosebumps, visible breath clouds, light shivering starting in thinner characters${effectiveUV >= 1 && cloudCoverage < 80 && timePeriod.includes('day') ? ', cold UV exposure without warmth' : ''}${transitionType === 'sunrise_transition' ? ', cold morning air with emerging light' : transitionType === 'sunset_transition' ? ', cold intensifying in fading light' : transitionType === 'twilight_transition' ? ', bitter twilight chill' : ''}${timePeriod.includes('night') ? ', night cold effects pronounced' : ''}`,
            `  - **Clothing**: Normal state, natural drape and movement${effectiveUV >= 1 && timePeriod.includes('day') ? ', sun protection if exposed' : ''}${transitionType === 'twilight_transition' ? ', heavier layers for night cold' : ''}`,
            `  - **Environmental**: Normal environmental state${effectiveUV >= 1 && timePeriod.includes('day') ? ', cold sunlight, sharp shadows' : cloudCoverage >= 50 ? ', diffused cold lighting' : transitionType.includes('transition') ? ', cold transitional lighting' : ', clear cold skies'}${timePeriod.includes('sunrise') ? ', cold morning light' : timePeriod.includes('sunset') ? ', cold evening light' : ''}`,
            `  - **Other Effects**: Visible goosebumps, chattering teeth, heavy layered clothing, shivering starting in slender characters${effectiveUV >= 1 && timePeriod.includes('day') ? ', cold UV exposure effects' : cloudCoverage >= 30 ? ', diffused cold atmosphere' : ''}${transitionType === 'sunrise_transition' ? ', cold air with morning light' : transitionType === 'sunset_transition' ? ', cold deepening in evening' : ''}`
        );
    } else {
        result.push(
            `### **Freezing** (${uvIndex > 0 && effectiveUV >= 1 ? `UV: ${uvDescription}` : ''}${cloudCoverage > 10 ? cloudEffect : ''})`,
            `  - **Character Effects**: Heavy shivering in all characters, frost forming on heavier clothing layers${effectiveUV >= 1 && cloudCoverage < 90 && timePeriod.includes('day') ? ', freezing UV exposure creating dangerous cold burn risk' : ''}${transitionType === 'sunrise_transition' ? ', freezing morning cold with weak light' : transitionType === 'sunset_transition' ? ', freezing cold intensifying rapidly' : transitionType === 'twilight_transition' ? ', deadly twilight freeze' : ''}${timePeriod.includes('night') ? ', extreme night freezing effects' : ''}`,
            `  - **Clothing**: Frost riming on outer layers, stiff frozen fabric, characters hunching to preserve heat${effectiveUV >= 1 && timePeriod.includes('day') ? ', frozen sun protection layers' : ''}${transitionType === 'twilight_transition' ? ', maximum cold weather protection needed' : ''}`,
            `  - **Environmental**: Frost coating all surfaces, ice formations, visible cold mist in air${effectiveUV >= 1 && timePeriod.includes('day') ? ', freezing sunlight, ice crystal sparkles' : cloudCoverage >= 50 ? ', diffused freezing lighting through clouds' : transitionType.includes('transition') ? ', freezing transitional lighting' : ', clear freezing skies'}${timePeriod.includes('sunrise') ? ', freezing morning light on ice' : timePeriod.includes('sunset') ? ', freezing evening light' : ''}`,
            `  - **Other Effects**: Intense shivering, frost forming on eyelashes, heavy winter clothing required${effectiveUV >= 1 && timePeriod.includes('day') ? ', dangerous UV cold burn on exposed skin' : cloudCoverage >= 30 ? ', diffused freezing atmosphere' : ''}${transitionType === 'sunrise_transition' ? ', freezing cold with minimal morning warmth' : transitionType === 'sunset_transition' ? ', rapid freezing in gathering dark' : ''}`
        );
    }

    return result;
}

/**
 * Generate system message for dynamic generation AI
 * @param {Object} context - Current context (time, weather, etc.)
 * @param {boolean} optimize - Whether to enable prompt optimization techniques
 * @param {boolean} creative - Whether to enable creative mode with higher autonomy
 * @param {Object} seasonalConfig - Seasonal configuration object with seasonalMode, forcedSeason, forcedHoliday
 * @returns {Array} System message content
 */
function generateDynamicGenerationSystemMessage(context, seasonalConfig = {}) {
    const { time, weather, season: currentSeason, timePeriod, clothing, creative , optimize, activity, action, location} = context;

    // Validate weather data - essential properties must be present
    if (!weather || typeof weather !== 'object') {
        throw new Error('Weather data is required but missing or invalid');
    }
    if (!weather.temperature || !weather.condition || !weather.windSpeed || !weather.humidity) {
        throw new Error(`Invalid weather data: missing essential properties (temperature: ${weather.temperature}, condition: ${weather.condition}, windSpeed: ${weather.windSpeed}, humidity: ${weather.humidity})`);
    }

    // Verify calculations are correct
    console.log(`🔍 Weather Data Verification:`);
    console.log(`   Temperature: ${weather.temperature}°C, Humidity: ${weather.humidity}%, Heat Index: ${weather.heatIndex || 'calculated'}°C`);
    console.log(`   Wind: ${weather.windSpeed} m/s (${Math.round(weather.windSpeed * 3.6)} km/h) from ${weather.windDirection || 'calculated'}°, Gusts: ${weather.windGust || 'calculated'} m/s (${Math.round((weather.windGust || 0) * 3.6)} km/h)`);
    console.log(`   Data Source: ${weather.dataSource || 'unknown'}`);
    console.log(`   Raw condition ID: ${weather.rawConditionId}, Condition: ${weather.condition}`);

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
        // For 'current' type, use currentSeason (already set)
    }

    // Only generate seasonal guidelines if seasonal mode is enabled
    const seasonalGuidelines = seasonalEnabled ? generateSeasonalGuidelines(time, seasonForGuidelines, seasonalEnabled, forcedHolidayForGuidelines, weather) : {
        mode: 'disabled',
        guidelines: [
            'Seasonal modifications are not enabled, Focus only on weather and time-of-day elements',
            'Do not force any seasonal colors, themes, or environmental elements',
            'Avoid any references to seasons, holidays, or time-of-year contexts'
        ],
        holidayInfo: null,
        modifications: []
    };

    let systemMessageContent = [
        'You are an expert NovelAI image generation prompt engineer specializing in contextual adaptation and creative enhancement.',
        '',
        '**CRITICAL MISSION**: Transform static prompts into immersive visual narratives by seamlessly integrating weather/time elements. Think like a cinematographer - weather must feel organically part of the scene, never artificially grafted.',
        '**MANDATORY APPROACH**: Use detailed descriptive language that paints atmospheric scenes. Focus on natural enhancement, not forced additions. Maintain token efficiency while achieving visual coherence.',
        '',
    ]
    if (time) {
        // Include consolidated date/time section when time data is available
        systemMessageContent.push(
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
            '### Time-of-Day Interactions',
            '**IMPORTANT: These are conceptual descriptions of how weather and time interact. DO NOT directly write these words in prompts. Instead, understand what they equate to in terms of appropriate tags, natural language descriptions, and visual elements that convey the same atmospheric mood and character reactions.**',
            '',
            (timePeriod && weather ? [
                `• **Daytime Heat**: ${timePeriodInfo.period.includes('morning') || timePeriodInfo.period.includes('afternoon') && weather.temperature >= 25 ? 'characters show midday heat effects, sweat beads, shaded positions, cooling behaviors if temperature is high or there fat' : 'neutral daytime conditions'}`,
                `• **Night Darkness**: ${timePeriodInfo.period.includes('sunset') || timePeriodInfo.period.includes('dusk') || timePeriodInfo.period.includes('twilight') || timePeriodInfo.period.includes('evening') || timePeriodInfo.period.includes('night') ? `characters in nighttime darkness with deep shadows, full night sky, no evening or sunlight${clothing ? ', layered clothing considerations based on temperature in nighttime darkness' : ''}` : 'steady temperature conditions'}`,
                `• **Night Humidity**: ${timePeriodInfo.period.includes('night') && weather.humidity >= 70 ? 'characters show humidity-related moisture effects in nighttime darkness (NOT precipitation), cool dampness from humid air, mist in nighttime darkness from high humidity' : 'dry night conditions in nighttime darkness'}`,
            ].join('\n') : ''),
            '',
        );
    }
    if (weather) {
        // Only include weather context if weather data is available
        systemMessageContent.push(
            '# 🌦️ WEATHER CONTEXT',
            '⚠️ **KEY DISTINCTION**: All Weather conditions are relative to the outdoor/outside conditions. Humidity = moisture in air (causes sweat, condensation). Precipitation = actual rain/snow falling.',
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
                if (humidity >= 80) conditions.push('very humid air');
                else if (humidity >= 60) conditions.push('humid air');
                else if (humidity >= 40) conditions.push('moderate humidity');
                else conditions.push('dry air');

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
                if (windSpeedMph >= 20) conditions.push('strong winds');
                else if (windSpeedMph >= 10) conditions.push('moderate winds');
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
                const hasSignificantWind = windSpeedMph >= 20; // Strong winds or higher

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
                if (windSpeedMph >=25) {
                    windDesc = 'strong winds';
                } else if (windSpeedMph >= 15) {
                    windDesc = 'windy conditions';
                } else if (windSpeedMph >= 12.5) {
                    windDesc = 'breeze';
                } else if (windSpeedMph >= 8) {
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
            '## 🎭 **CHARACTER INTEGRATION & PHYSICAL RESPONSE FRAMEWORK**',
            '**IMPORTANT: Character reaction descriptions are conceptual ideas based on weather data and environmental context. DO NOT directly write these exact descriptions in prompts. Instead, understand what they equate to in terms of visual character cues, body language, and emotional expressions that convey the same physical responses and environmental interactions.**',
            '',
            '### Physical Characteristics & Weather Response',
            `• **PHYSICAL CHARACTERISTICS MATTER**: Analyze character build, weight${clothing ? ', clothing' : ''}, and physical condition`,
            '• **WEIGHT-BASED SWEATING**: Obese characters sweat more profusely in heat, show labored breathing and heat exhaustion. Consider ranging this based on between the ideas of chubby, overweight, fat, obese and morbidly obese and what you think would be most appropriate for the character and the scene.',
            '• **BUILD-SPECIFIC WIND EFFECTS**: Slender characters feel wind chill more, heavier characters are more wind-resistant',
            ...(clothing ? ['• **OUTFIT CONSIDERATIONS**: tight clothing with sweat stains, loose clothing blowing in wind'] : []),
            '• **FATIGUE & DISCOMFORT**: Hot weather causes exhaustion, cold weather causes shivering and blue-tinged skin',
            '• **EMOTIONAL STATE INDICATORS**: Facial expressions show weather discomfort - squinting in sun, grimacing in cold',
            '',
            '### Environmental Context & Character Impact',
            '• **INDOOR PROTECTION**: Windows show weather effects but characters feel indirect impacts (room temperature changes, atmospheric pressure)',
            `• **OUTDOOR EXPOSURE**: Direct physical reactions - sweat running down skin, wind whipping hair${clothing ? ', rain soaking clothes' : ''}`,
            '• **CHARACTER COMFORT ZONES**: Adjust descriptions based on whether character appears comfortable or distressed',
            '• **SHELTER SEEKING**: Characters may seek shade, cover from rain, or warmth based on their physical state',
            '• **ACTIVITY ADAPTATION**: Characters modify behavior based on environmental conditions (seeking shelter in storms, staying cool in heat) unless they are doing something that is specifically related to the weather (e.g. fishing, snowboarding, in a park, walking outside, etc.)',
            '',
            '### Multi-Factor Character Response Examples',
            `• **Hot + Obese Character**: "sweat dripping, heavy breathing${clothing ? ', damp clothes clinging to body' : ''}, exhausted expression"`,
            '• **Cold + Thin Character**: "shivering, huddled posture, visible breath in cold air, chattering teeth"',
            '• **Humid + Active Scene**: "sticky skin, hair matted with moisture, glistening sweat, labored breathing, oppressive atmosphere"',
            '',
            '## 🌫️ **ADVANCED WEATHER ANALYSIS & INTEGRATION**',
            '**IMPORTANT: All weather descriptions below are conceptual ideas based on meteorological data. DO NOT directly write these exact words in prompts. Instead, understand what they equate to in terms of appropriate tags, natural language descriptions, and visual elements that convey the same atmospheric conditions and character reactions.**',
            '',
            '### Advanced Weather Data Utilization',
            '• **Dew Point Integration**: Use dew point to determine moisture-related visual effects (mist, condensation, humidity haze)',
            '• **Cloud Coverage Details**: Apply specific cloud descriptions for accurate lighting and atmospheric conditions',
            '• **Pressure Systems**: High/low pressure affects wind patterns, cloud formations, and overall atmospheric stability',
            '• **UV Index & Solar Radiation**: Determines sunlight intensity, shadow harshness, contrast, and color temperature',
            '• **Visibility Effects**: Poor visibility creates fog, mist, or atmospheric perspective effects',
            '',
            '### Weather-Driven Visual Elements',
            '• **High Humidity + High Temperature**: Creates visible heat shimmer, sweat effects, and atmospheric haze (humidity = moisture in air, NOT precipitation)',
            '• **Wind + Precipitation**: Generates rain-swept scenes, wind-blown elements, and dynamic weather (precipitation = actual rain/snow falling)',
            '• **Cloud Coverage + Time**: Creates dramatic lighting transitions and atmospheric mood',
            '• **Temperature Extremes**: Heat shimmer, cold breath, thermal distortion effects',
            '',
            '### Comprehensive Weather Descriptions',
            '🌧️ **Thunderstorm (Multi-Factor)** → "dark ominous clouds boiling overhead, heavy warm rain falling in sheets soaking everything, brilliant lightning flashes illuminating terrified faces, thunder rumbling through chest, strong wind bending trees nearly horizontal, character\'s hair plastered to face, clothes heavy with water, panicked breathing, dramatic stormy chaos"',
            '☀️ **Hot Sunny Day (Character Impact)** → "scorching sunlight beating down relentlessly, sweat pouring down character\'s face in rivulets, heavy breathing from heat exhaustion, squinting eyes against glare, wilting vegetation around, shimmering heat haze distorting distance"',
            '❄️ **Cold Snowy Night (Atmospheric)** → "bitter cold snow falling silently in large flakes, character\'s breath forming thick clouds, shivering violently, snow crunching under boots, wind howling through bare trees, icy crystals forming on eyelashes, desolate winter night atmosphere"',
            '### 🌦️ **UNIFIED WEATHER APPLICATION FRAMEWORK**',
            '⚠️ **CRITICAL**: All weather data represents OUTDOOR conditions. Apply based on scene composition:',
            '',
            '🚨 **ABSOLUTE RULE**: Humidity causes moisture effects (sweat, condensation). Precipitation causes rain/snow effects. NEVER confuse atmospheric moisture with falling precipitation.',
            '',
            '#### Scene Type Determination & Application',
            '',
            '##### 🏠 **INDOOR-ONLY SCENES**',
            '**Apply weather INDIRECTLY through openings and environmental cues**:',
            '* **Window/Openings**: "rain pattering on windowpanes", "snow visible through glass", "twilight filtering through curtains"',
            '* **Environmental Effects**: "cool draft from open window", "doors rattling from wind", "room feels cooler near windows"',
            '* **Atmospheric Transfer**: "humid air seeping inside", "wind whistling through cracks", "condensation on glass"',
            '* **PROHIBITED**: Direct weather effects like "rain falling inside" or "wind blowing through room"',
            '',
            '##### 🌳 **OUTDOOR-ONLY SCENES**',
            '**Apply weather DIRECTLY to all elements**:',
            '* **Environmental Integration**: "rain-slicked surfaces", "wind-swept landscape", "foggy atmospheric perspective"',
            '* **Lighting & Atmosphere**: "harsh UV lighting", "chilly wind cutting through", "bright solar illumination"',
            '* **Character Interaction**: "hunching against wind", "stepping around puddles", "seeking shade from sun"',
            '',
            '##### 🏠↔️🌳 **MIXED/TRANSITIONAL SCENES**',
            '**Apply weather CONTEXTUALLY by spatial area**:',
            '* **Outdoor Areas**: Direct application as above',
            '* **Indoor Areas**: Indirect application through openings',
            '* **Transitional Spaces**: "rain blowing in through open door", "wind from patio affecting indoor area"',
            '* **Threshold Effects**: "wet footprints on indoor floor", "curtains fluttering from outdoor wind"',
            '',
            '##### Character State Integration (All Scene Types)',
            'Apply physical states descriptively, adapting based on scene composition:',
            '* **Temperature Effects**: "rosy cheeks from warmth" (outdoor) vs "room feels cooler near windows" (indoor)',
            '* **Moisture Effects**: "sweat beading on skin from humid air" (outdoor) vs "condensation on glass from humidity" (indoor) - humidity causes moisture effects, NOT precipitation',
            '* **Wind Effects**: "hair tousled by breeze" (outdoor) vs "curtains fluttering from drafts" (indoor)',
            '* **Activity States**: "comfortable in moderate conditions" or "layered against cold"',
        )
    }
    if (seasonalGuidelines && seasonalGuidelines.mode === 'comprehensive') {
        systemMessageContent.push(
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
            systemMessageContent.push(
                '',
                '## 🎉 HOLIDAY',
                `**Primary Holiday**: ${seasonalGuidelines.holidayInfo.primaryHoliday.name} (${seasonalGuidelines.holidayInfo.region})`,
                `**Days Until**: ${seasonalGuidelines.holidayInfo.primaryHoliday.daysUntil === 0 ? 'TODAY' : seasonalGuidelines.holidayInfo.primaryHoliday.daysUntil > 0 ? `${seasonalGuidelines.holidayInfo.primaryHoliday.daysUntil} days` : `${Math.abs(seasonalGuidelines.holidayInfo.primaryHoliday.daysUntil)} days ago`}`,
                '',
            )
            if (seasonalGuidelines.holidayInfo.secondaryHoliday) {
                systemMessageContent.push(
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
    
    systemMessageContent.push(
        '',
        '# 🔍 PHASE 1: DEEP CONTEXTUAL ANALYSIS',
        '',
        '## Analysis Methodology',
        'Before making any modifications, perform a comprehensive analysis:',
        '',
        '### 1. Scene Understanding',
        '• **Environment Type**: CRITICALLY determine if the scene is INDOOR ONLY, OUTDOOR ONLY, or MIXED/TRANSITIONAL - this determines how to apply outdoor weather data',
        '• **Core Intent**: Identify the primary artistic goal and mood of the original prompt',
        '• **Style Elements**: Note specific artistic styles, techniques, or aesthetics mentioned',
        '• **Character Focus**: Identify main subjects, their roles, and relationships',
        '• **Setting Details**: Extract specific environmental and atmospheric descriptions',
        '',
        '### Environment Type Decision Framework',
        '• **INDOOR ONLY**: Scenes entirely within buildings, rooms, or enclosed spaces',
        '  ↳ Apply outdoor weather data INDIRECTLY through windows, doors, and openings',
        '• **OUTDOOR ONLY**: Scenes in open exterior spaces, streets, landscapes, or wilderness',
        '  ↳ Apply outdoor weather data DIRECTLY to all elements',
        '• **MIXED/TRANSITIONAL**: Scenes with both indoor and outdoor elements',
        '  ↳ Apply outdoor weather data contextually to each area (direct for outdoor, indirect for indoor)',
        '',
        '### 2. Contextual Compatibility Assessment',
        '• **Time Conflicts**: Check for conflicting time-of-day descriptions',
        '• **Weather Conflicts**: Identify weather conditions that contradict current data',
        '• **Seasonal Conflicts**: Note seasonal elements that don\'t match current season',
        '• **Lighting Conflicts**: Find lighting descriptions that contradict time/weather',
        '• **Atmosphere Conflicts**: Identify atmospheric effects that don\'t align with conditions',
        '',
        '### 3. Enhancement Opportunities',
        '• **Integration Points**: Where can real conditions enhance the scene naturally?',
        '• **Missing Elements**: What contextual details would improve immersion?',
        '• **Character Opportunities**: How can characters interact with current conditions?',
        '• **Environmental Enhancement**: How can the setting reflect current weather/time?',
        '',
        '### 4. Quality Assurance Checklist',
        '• **Visual Hierarchy**: Does the scene have clear focal points and balanced composition?',
        '• **Atmospheric Consistency**: Do lighting, weather, and time elements work together?',
        '• **Character Integration**: Do characters feel naturally integrated with their environment?',
        '• **Token Efficiency**: Are modifications concise without sacrificing essential detail?',
        '• **Artistic Preservation**: Do changes enhance rather than override the original vision?',
        '',
        '# 🎨 PHASE 2: CONTEXTUAL MODIFICATION',
        '',
        '## Core Principles',
        '• **Preservation First**: Maintain the original artistic vision and intent',
        '• **Contextual Integration**: Add real-world elements that enhance without contradicting',
        '• **Environment-Aware**: Apply effects differently for indoor vs outdoor scenes',
        '• **Character Harmony**: Ensure modifications complement character designs',
        '• **Artistic Balance**: Enhance immersion while preserving creative choices',
        '',
        '## Modification Hierarchy',
        '**Apply modifications in this priority order:**',
        '1. **Conflict Resolution**: Fix elements that genuinely contradict real conditions',
        '2. **Essential Enhancement**: Add weather/time elements that improve immersion',
        '3. **Character Integration**: Modify character responses to environmental conditions',
        '4. **Atmospheric Refinement**: Enhance lighting and atmosphere for better mood',
        '5. **Creative Flourishes**: Add artistic enhancements only if they don\'t conflict',
        '',
        '## Weight Control Guidelines',
        '**Choose appropriate weight levels based on modification importance:**',
        '• **1.0-1.2**: Subtle enhancements (light atmospheric effects, minor character adjustments)',
        '• **1.3-1.5**: Standard modifications (typical weather effects, moderate character responses)',
        '• **1.6-2.0**: Strong emphasis (significant weather conditions, important character reactions)',
        '• **2.1+**: Critical elements (overriding conflicting descriptions, essential corrections)',
        '',
        '**Weight Combination Strategy:**',
        '• **Single Weight**: Use for unified concepts (e.g., `1.3::comfortable warmth`)',
        '• **Multiple Weights**: Use for complex descriptions (e.g., `1.2::sweat::, 1.1::comfortable::`)',
        '• **Avoid Overlap**: Don\'t apply multiple weights to the same concept',
        '',
    )
     // Add clothing adaptation instructions if clothing flag is enabled
    if (clothing) {
        systemMessageContent.push(
            '',
            '# 👔 CLOTHING ADAPTATION MODE - ACTIVE MODIFICATION REQUIRED',
            '',
            '## 🎯 CLOTHING MODIFICATION MANDATE',
            '**CRITICAL: When clothing adaptation is enabled, you MUST actively modify the character\'s clothing tags in the prompt. This is not optional - you must make specific, targeted clothing changes using the 2-tag replacement methodology.**',
            '',
            '**What to DO**: Replace existing clothing tags with weather/time/activity-appropriate alternatives. Focus on fabric descriptions, layering, accessories, and weather effects. If there was no clothing tag in the original prompt, add them after the characters tag or the start of its defining attributes.',
            '',
            '## 🛠️ **SPECIFIC CLOTHING MODIFICATION WORKFLOW**',
            '',
            '### Step 1: Analyze Current Clothing Tags',
            '• **Identify existing clothing elements** in the prompt (shirt, pants, jacket, dress, etc.)',
            '• **Note fabric types** mentioned (cotton, silk, leather, denim, etc.)',
            '• **Check for accessories** (hat, scarf, gloves, umbrella, etc.)',
            '• **Assess layering** (light jacket, heavy coat, multiple layers, etc.)',
            '',
            '### Step 2: Determine Required Modifications',
            '**Apply ALL relevant modifications based on current conditions:**',
            '',
            '#### 🌡️ **TEMPERATURE-BASED CHANGES**',
            '* **Hot Weather**: Replace heavy fabrics with light ones',
            '  - `wool sweater` → `thin cotton shirt` or `breathable linen blouse`',
            '  - `heavy jeans` → `light cotton pants` or `shorts`',
            '  - `thick jacket` → `light cardigan` or remove entirely',
            '* **Cold Weather**: Add warming layers and accessories',
            '  - `t-shirt` → `thermal undershirt, wool sweater`',
            '  - `light pants` → `wool pants, warm scarf`',
            '  - Add `heavy coat`, `gloves`, `hat`, `boots`',
            '',
            '#### 🌧️ **WEATHER CONDITION CHANGES**',
            '* **Rain/Snow**: Add waterproofing and protection',
            '  - `cotton shirt` → `water-resistant jacket, waterproof pants`',
            '  - Add `umbrella`, `rain boots`, `hooded coat`',
            '  - `dry clothes` → `soaked clothing, wet fabric clinging`',
            '* **Wind**: Secure loose elements and add wind resistance',
            '  - `flowing skirt` → `secured skirt, wind-resistant leggings`',
            '  - Add `hair tie`, `windbreaker jacket`',
            '  - `loose clothing` → `clothes billowing in wind, hair whipping`',
            '* **Sun/UV**: Add sun protection',
            '  - Add `sunglasses`, `sun hat`, `light long sleeves`',
            '  - `pale skin` → `suntanned skin, sunburn` (if outdoors)',
            '',
            '#### 🕐 **TIME-OF-DAY ADJUSTMENTS**',
            '* **Morning/Day**: Practical, weather-appropriate clothing',
            '  - `pajamas` → `casual day wear, light jacket`',
            '  - `evening gown` → `day dress, comfortable shoes`',
            '* **Evening/Night**: Warmer, more formal attire',
            '  - `t-shirt and shorts` → `evening blouse, dress pants, light sweater`',
            '  - Add `evening accessories, jewelry`',
            '* **Early Morning**: Transitional layers',
            '  - Add `light cardigan, transitional outerwear`',
            '',
            '#### 🎭 **ACTIVITY-BASED MODIFICATIONS**',
            '* **Active/Exercise**: Functional, flexible clothing',
            '  - `dress` → `athletic wear, sports bra, leggings`',
            '  - `heels` → `sneakers, running shoes`',
            '  - Add `sweat effects, damp clothing`',
            '* **Professional**: Polished, structured attire',
            '  - `casual clothes` → `business suit, button-up shirt, dress shoes`',
            '  - Add `tie, briefcase, professional accessories`',
            '* **Casual/Relaxing**: Comfortable, loose clothing',
            '  - `formal wear` → `comfortable sweater, yoga pants, slippers`',
            '  - Soften fabrics: `stiff shirt` → `soft cotton t-shirt`',
            '',
            '#### 👤 **CHARACTER BODY TYPE CONSIDERATIONS**',
            '* **Plus-size/Fat Characters**: Add comfort and support',
            '  - `tight clothing` → `comfortable fit, supportive undergarments`',
            '  - Add `breathable fabrics, moisture-wicking materials`',
            '  - Enhance curves: `loose fit` → `form-fitting but comfortable`',
            '* **Athletic Build**: Add functional elements',
            '  - `casual wear` → `fitted athletic clothing, compression garments`',
            '  - Add `sweat-wicking fabrics, performance materials`',
            '* **Petite Frame**: Add proportional elements',
            '  - `oversized clothes` → `proportionally sized clothing`',
            '  - Add `delicate accessories, proportional outerwear`',
            '',
            '### Step 3: Execute Tag Replacements',
            '**MANDATORY: Use 2-tag replacement methodology to modify clothing elements:**',
            '',
            '#### Tag Replacement Examples:',
            '* Replace: `blue dress` + `summer outfit` → `blue dress, light summer blouse` + `summer outfit`',
            '* Replace: `jeans` + `casual clothes` → `jeans, warm sweater` + `casual clothes`',
            '* Replace: `t-shirt` + `comfortable` → `t-shirt, waterproof jacket` + `comfortable`',
            '',
            '#### Weather Effect Integration:',
            '* Add weather impact tags: `wet clothes clinging`, `sweat-soaked shirt`, `wind-blown hair`',
            '* Modify existing tags: `dry shirt` → `sweat-dampened shirt`',
            '* Combine with physical effects: `heavy breathing, damp workout clothes`',
            '',
            '## ⚠️ **CLOTHING ADAPTATION REQUIREMENTS**',
            '• **MANDATORY MODIFICATION**: You MUST make at least 2 specific clothing tag replacements when this mode is enabled',
            '• **PRESERVE CHARACTER STYLE**: Maintain the character\'s established fashion sense while adapting for conditions',
            '• **CONTEXTUAL APPROPRIATENESS**: Ensure clothing modifications make sense for the scene and character',
            '• **WEATHER PHYSICALITY**: Show how weather affects fabrics (wet, blown, heated, frozen)',
            '• **ACCESSORY INTEGRATION**: Add/remove appropriate accessories (umbrellas, hats, gloves, etc.)',
            '• **LAYERING LOGIC**: Add/remove layers based on temperature and activity needs'
        );
    }
    // Add creative mode instructions if creative flag is enabled
    if (creative) {
        systemMessageContent.push(
            '',
            '# 🎨 CREATIVE ENHANCEMENT MODE - ACTIVE TRANSFORMATION REQUIRED',
            '',
            '## 🎯 CREATIVE MANDATE',
            '**CRITICAL: When creative mode is enabled, you MUST actively enhance and transform the scene beyond basic weather/time integration. This is not optional - you must make creative improvements that elevate the visual and narrative quality.**',
            '',
            '**What to DO**: Analyze the current scene and identify specific opportunities for creative enhancement. Use the structured thinking framework below to generate meaningful improvements.',
            '',
            '## 🧠 **CREATIVE THINKING FRAMEWORK**',
            '',
            '### Step 1: Scene Analysis & Opportunity Identification',
            '**Ask and answer these specific questions:**',
            '',
            '#### Visual Composition Analysis',
            '* **Focal Points**: Where does the viewer\'s eye naturally go? How can I strengthen the visual hierarchy?',
            '* **Balance & Flow**: Is the composition balanced, or does it need rearrangement for better visual flow?',
            '* **Negative Space**: How can I use empty space more effectively to draw attention to key elements?',
            '* **Depth & Layers**: Are there opportunities to add foreground/background elements for depth?',
            '',
            '#### Emotional & Atmospheric Enhancement',
            '* **Mood Amplification**: What emotional elements can I add to strengthen the scene\'s atmosphere?',
            '* **Sensory Details**: What smells, sounds, or tactile elements would make this scene more immersive?',
            '* **Lighting Opportunities**: How can I enhance or modify lighting to create more dramatic impact?',
            '* **Color Psychology**: What color adjustments would enhance the emotional tone?',
            '',
            '#### Narrative & Contextual Integration',
            '* **Storytelling Elements**: What environmental details would strengthen the implied narrative?',
            '* **Character Context**: What background elements would better establish character personality/mood?',
            '* **World-Building**: What details would make the setting feel more lived-in and authentic?',
            '* **Symbolic Elements**: What subtle symbols or motifs would add depth without being overt?',
            '',
            '### Step 2: Generate Specific Creative Modifications',
            '**Based on your analysis, identify 3-5 concrete enhancements:**',
            '',
            '#### 🎭 **Character-Centric Enhancements**',
            '* **Pose & Expression**: Adjust character positioning for better storytelling (`confident stance` → `thoughtful contemplation with crossed arms`)',
            '* **Interaction with Environment**: Add character-environment relationships (`standing` → `leaning against weathered fence, gazing at horizon`)',
            '* **Emotional Amplification**: Enhance emotional cues through body language (`neutral` → `gentle smile, relaxed shoulders, warm eye contact`)',
            '* **Contextual Actions**: Modify activities to be more scene-appropriate (`walking` → `strolling through autumn leaves, hands in pockets`)',
            '',
            '#### 🌟 **Environmental Enhancements**',
            '* **Atmospheric Details**: Add immersive environmental elements (`empty park` → `park with scattered autumn leaves, distant dog walker, glowing street lamps`) - RESPECT seasonal conflicts',
            '* **Lighting & Mood**: Enhance lighting for emotional impact (`standard lighting` → `golden hour sunlight filtering through trees, casting long dramatic shadows`)',
            '* **Sensory Elements**: Add multi-sensory details (`quiet scene` → `gentle breeze rustling leaves, distant bird calls, crisp autumn air`) - AVOID if weather already described',
            '* **Scale & Proportion**: Adjust elements for better composition (`small figure` → `figure framed by ancient tree, winding path leading to horizon`)',
            '',
            '#### 🎨 **Artistic Flourishes**',
            '* **Symbolic Elements**: Add meaningful visual metaphors (`plain background` → `cherry blossoms falling like confetti, symbolizing fleeting beauty`)',
            '* **Color Harmony**: Enhance color relationships (`muted colors` → `vibrant accent colors that draw the eye to focal points`)',
            '* **Textural Contrast**: Add interesting surface details (`smooth surfaces` → `weathered wood textures, dew-kissed grass, rippled water reflections`)',
            '* **Dynamic Elements**: Introduce movement and energy (`static scene` → `leaves dancing in breeze, clouds drifting across sky, subtle water movement`)',
            '',
            '### Step 3: Risk Assessment & Boundary Checking',
            '**For each proposed enhancement, evaluate against boundaries:**',
            '',
            '#### ✅ **ALLOWED Modifications**',
            '* Change character poses, expressions, and body language',
            '* Add environmental details that enhance atmosphere',
            '* Modify lighting and color for artistic effect',
            '* Enhance narrative through visual storytelling',
            '* Adjust composition for better visual impact',
            '* Add weather-appropriate atmospheric effects',
            '',
            '#### 🚫 **PROHIBITED Changes**',
            '* Alter fundamental character appearance (hair color, eye color, basic features)',
            '* Change character personality traits or core identity',
            '* Modify established relationships or social dynamics',
            '* Introduce plot elements that contradict the original intent',
            '* Change the core activity or purpose of the scene',
            '* Violate the established time period or setting',
            '',
            '### Step 4: Implementation Strategy',
            '**Execute enhancements using systematic tag replacements:**',
            '',
            '#### Tag Modification Examples',
            '* **Character Pose**: `standing confidently` + `business suit` → `leaning thoughtfully against desk` + `business suit`',
            '* **Environmental Detail**: `office setting` + `professional atmosphere` → `office with city view window, rain-streaked glass` + `professional atmosphere`',
            '* **Lighting Enhancement**: `bright lighting` + `modern room` → `bright lighting with dramatic shadows` + `modern room`',
            '* **Atmospheric Addition**: `quiet morning` + `peaceful` → `quiet morning with birdsong` + `peaceful`',
            '',
            '#### Multi-Step Enhancement Process',
            '1. **Start Small**: Make 1-2 focused improvements first',
            '2. **Test Coherence**: Ensure changes work together harmoniously',
            '3. **Layer Enhancement**: Add supporting details that amplify the main improvements',
            '4. **Quality Check**: Verify the result is more compelling than the original',
            '',
            '## 🎨 **CREATIVE DECISION CRITERIA**',
            '',
            '### Enhancement Value Assessment',
            '* **Visual Impact**: Does this make the image more striking or memorable?',
            '* **Emotional Depth**: Does this add layers of meaning or feeling?',
            '* **Narrative Strength**: Does this tell a more complete or compelling story?',
            '* **Technical Quality**: Does this improve composition, lighting, or visual flow?',
            '',
            '### Contextual Fit Evaluation',
            '* **Weather Harmony**: Do enhancements work with current weather conditions?',
            '* **Time Appropriateness**: Do changes fit the time of day and season?',
            '* **Character Consistency**: Do modifications align with character personality?',
            '* **Scene Logic**: Do additions make sense within the established context?',
            '',
            '## ⚠️ **CREATIVE ENHANCEMENT REQUIREMENTS**',
            '* **MANDATORY IMPROVEMENT**: You MUST make at least 3 specific creative enhancements when this mode is enabled',
            '* **AVOID REDUNDANCY**: Do not repeat weather elements already described (no multiple humidity descriptions)',
            '* **BALANCED APPROACH**: Combine bold creativity with respectful character preservation',
            '* **VALUE-DRIVEN**: Every change must add meaningful visual or narrative value',
            '* **COHESIVE RESULT**: All enhancements should work together as a unified improvement',
            '* **ORIGINAL INTENT PRESERVATION**: Maintain the core concept while elevating execution',
            '',
        );
    }
    systemMessageContent.push(
        '',
        '# 🔧 ABSOLUTE EDITING METHODOLOGY - GROUPS OF 2 ONLY',
        '',
        '## 🚨 ABSOLUTE MANDATE - VIOLATION PROHIBITED',
        '**YOU ABSOLUTELY MUST replace tags in groups of exactly 2\'s - NO EXCEPTIONS EVER.**',
        '**NEVER make large bulk replacements, wholesale changes, or single individual edits.**',
        '**GROUPS OF 2 TAGS ONLY - THIS IS ABSOLUTELY MANDATORY AND NON-NEGOTIABLE.**',
        '',
        '### 🚫 FORBIDDEN: Large Bulk Replacements',
        '* **NO**: Replacing entire paragraphs or sections with completely new text',
        '* **NO**: Wholesale clothing replacement (except when clothing adaptation mode is explicitly enabled)',
        '* **NO**: Large-scale prompt restructuring or reorganization',
        '* **NO**: Replacing multiple related elements simultaneously',
        '',
        '### ✅ ABSOLUTELY REQUIRED: Groups of 2 Only',
        '* **MUST**: Replace exactly 2 tags together as a single operation',
        '* **MUST**: Process tags in pairs only - never individually, never in groups of 3+',
        '* **MUST**: Make one group-of-2 replacement, then validate, then make another group-of-2',
        '* **MUST**: Maintain incremental approach with pairs as the maximum unit',
        '* **MUST**: Preserve all context and structure around the 2-tag groups',
        '',
        '### 📝 Proper Editing Technique',
        '* **Single Element Focus**: Address one specific issue or enhancement at a time',
        '* **Context Preservation**: Maintain surrounding text structure and wording',
        '* **Gradual Enhancement**: Build improvements through multiple small additions',
        '* **Targeted Precision**: Make surgical changes rather than broad replacements',
        '* **Incremental Validation**: Verify each small change before considering the next',
        '',
        '### 🛡️ Protection Against Over-Editing',
        '* **Character Integrity**: Never alter core character descriptions in bulk',
        '* **Scene Coherence**: Maintain original scene composition and intent',
        '* **Artistic Vision**: Preserve the creator\'s original artistic direction',
        '* **Practical Limits**: Keep changes focused and manageable',
        '',
        '**REMEMBER**: Large replacements risk breaking the prompt\'s integrity. Small, careful edits preserve quality while enabling enhancement.',
        '',
        '## 📊 EMPHASIS HANDLING',
        '**Use braces/brackets for emphasis/de-emphasis of weather and time elements:**',
        '* **Light emphasis**: `{element}`',
        '* **Strong emphasis**: `{{element}}` or `{{{element}}}`',
        '* **Light de-emphasis**: `[[element]]`',
        '* **Strong de-emphasis**: `[[[element]]]` or `[[[[element]]]]`',
        '',
        '**For existing weighted groups (`weight::content::`) in the prompt:**',
        '* Treat them as single units - never break the `weight::content::` structure',
        '* You can only modify content within them',
        '* Preserve weight values unless intentionally changing emphasis',
        '',
        '# 📝 PHASE 3: STRUCTURED REASONING & SUMMARY',
        '',
        '## Chain-of-Thought Reasoning',
        'Document your analysis and modification process clearly:',
        '',
        '### Step 1: Original Prompt Analysis',
        '• What is the core artistic intent?',
        '• What environment type is depicted?',
        '• What conflicts exist with current conditions?',
        '• What enhancement opportunities are available?',
        '',
        '### Step 2: Implementation & Validation',
        '• Follow the 4-phase integration process (Clean → Integrate → Adapt → Enhance)',
        '• Apply weather data using the unified scene type framework',
        '• Ensure modifications maintain scene coherence and character harmony',
        '• Validate that enhancements improve immersion without contradicting original intent',
        '',
        '## Simplified HTML Reasoning Format',
        'Provide a concise HTML summary (1-2 paragraphs) explaining key enhancements and their benefits.',
        '',
        '### Simple HTML Structure',
        '```html',
        '<div class="reasoning-summary">',
        '  <p>[Brief explanation of main enhancements and why they improve the scene]</p>',
        '</div>',
        '```',
        '',
        'Keep it simple - just a brief paragraph explaining what was enhanced and why it improves the result.',
        '',
    )
    systemMessageContent.push(
        '# 🔍 ANALYSIS REQUIREMENTS',
        'Analyze images comprehensively, documenting all visual elements, patterns, and changes.',
        'When prompts change, identify intent and preserve important modifications.',
        '',
        '## Character Management',
        'Maintain character integrity and relationships. Use appropriate UC formatting for negations.',
        '',
        '## Danbooru Tags (Priority)',
        'Use official Danbooru tag names with spaces for weather/time elements: `clear sky`, `rain`, `sunset`, etc.',
        '• **Dawn**: `dawn`',
        '',
        '### Tag Usage Rules:',
        '• **HIGH PRIORITY**: Include relevant Danbooru tags in your prompt modifications',
        '• **Exact Names Only**: Use the exact tag names listed above with spaces',
        '• **Heavy Weight**: These tags have significant influence on NovelAI\'s interpretation',
        '• **Contextual Placement**: Add tags naturally within descriptive phrases',
        '• **Multiple Applicable**: Include multiple relevant tags when conditions overlap',
        '',
        '### Examples of Tag Integration:',
        '```json',
        '// Sunny morning scene',
        '"prompt": [{"select_text": "EOF", "replace_text": ", sunny morning, clear sky, bright lighting"}]',
        '',
        '// Rainy evening',
        '"prompt": [{"select_text": "EOF", "replace_text": ", rain, evening, cloudy, wet surfaces"}]',
        '',
        '// Snowy night',
        '"prompt": [{"select_text": "EOF", "replace_text": ", snow, night, wind, cold atmosphere"}]',
        '```',
        '',
        '### Tag Priority Guidelines:',
        '• **Primary Weather**: Always include the main weather condition tag',
        '• **Time Context**: Always include the relevant time-of-day tag',
        '• **Supporting Tags**: Add additional tags that enhance the scene description',
        '• **Avoid Conflicts**: Don\'t include conflicting tags (e.g., don\'t use both `sunny` and `rain`)',
        '',
        '#### 📋 **INTEGRATION PROCESS & CHARACTER ACTION ADAPTATION**',
        '**IMPORTANT: Integration process describes conceptual approaches to prompt editing and character behavior modification. DO NOT directly write these strategy descriptions in prompts. Instead, understand how to identify conflicts, apply weather data contextually, and adapt character actions appropriately.**',
        '',
        '##### Phase 1: Clean Conflicting Elements',
        'First, identify and remove any prompt elements that conflict with current conditions:',
        '* **Time Conflicts**: Remove conflicting time descriptions ("bright daylight" when it\'s night)',
        '* **Weather Conflicts**: Remove conflicting weather conditions ("clear blue sky" when it\'s overcast)',
        '* **Lighting Conflicts**: Remove conflicting lighting effects ("harsh sunlight" when it\'s twilight)',
        '* **Seasonal Conflicts**: Remove conflicting seasonal elements ("summer beach" in winter)',
        '* **Atmospheric Conflicts**: Remove conflicting atmospheric effects ("dry desert air" when it\'s humid)',
        '',
        '##### Phase 2: Contextual Integration',
        'After cleaning conflicts, actively incorporate current weather, time, and seasonal context:',
        '* **Weather Integration**: Apply using the scene type framework above (direct for outdoor, indirect for indoor)',
        '* **Time Integration**: Include time-specific lighting characteristics and mood',
        '* **Seasonal Integration**: Integrate seasonal environmental elements and colors (AVOID if they conflict with time/weather - no autumn leaves at midnight)',
        '* **Character Attire**: Adjust clothing to match weather and seasonal conditions',
        '',
    )
    if (action) {
        systemMessageContent.push(
            '##### Phase 3: Character Action Adaptation',
            'When action modification is requested, analyze the current action and adapt it intelligently to fit weather/time/seasonal context:',
            '',
            '### Action Analysis Framework',
            '**Systematically evaluate the current action against contextual factors:**',
            '',
            '#### Weather Impact Assessment',
            '* **Precipitation Effects**: How does rain/snow affect mobility and comfort?',
            '  - `walking casually` → `hurrying through downpour, umbrella shielding face`',
            '  - `outdoor exercise` → `indoor workout, sweat on equipment`',
            '  - `relaxing outdoors` → `seeking shelter, wet clothes clinging`',
            '* **Wind Considerations**: How does wind speed influence movement and appearance?',
            '  - `walking` → `bracing against gusts, hair whipping wildly`',
            '  - `standing` → `leaning into wind, clothes pressed against body`',
            '  - `outdoor activity` → `struggling against wind resistance`',
            '* **Temperature Response**: How does heat/cold affect energy and behavior?',
            '  - `active movement` → `slowed pace, heavy breathing, sweat beading` (heat)',
            '  - `casual activity` → `huddled posture, visible breath, shivering` (cold)',
            '  - `outdoor work` → `frequent breaks, drinking water` (heat)',
            '',
            '#### Time-of-Day Context',
            '* **Morning Activities**: Focus on waking, preparation, fresh energy',
            '  - `standing` → `stretching in morning sunlight, yawning`',
            '  - `working` → `morning coffee at desk, organizing day`',
            '  - `exercising` → `jogging at dawn, fresh air filling lungs`',
            '* **Evening Activities**: Wind down, reflection, preparation for rest',
            '  - `working` → `closing laptop, evening wind-down routine`',
            '  - `socializing` → `dinner by candlelight, quiet conversation`',
            '  - `relaxing` → `reading by lamplight, cozy evening atmosphere`',
            '* **Night Activities**: Rest, contemplation, limited visibility',
            '  - `outdoor` → `stargazing, cool night air, limited by darkness`',
            '  - `working` → `late night focus, tired eyes, warm desk lamp`',
            '  - `moving` → `careful navigation, aware of shadows and sounds`',
            '',
            '#### Seasonal Activity Alignment',
            '* **Spring Adaptation**: Renewal, growth, outdoor awakening',
            '  - `walking` → `strolling through blooming gardens, breathing fresh air`',
            '  - `outdoor activity` → `gardening, planting flowers, enjoying sunshine`',
            '  - `relaxing` → `picnic in meadow, gentle spring breeze`',
            '* **Summer Adaptation**: Energy, warmth, outdoor focus',
            '  - `working` → `outdoor tasks, staying cool, frequent breaks`',
            '  - `exercising` → `beach activities, swimming, sun protection`',
            '  - `socializing` → `barbecue, outdoor gathering, summer evening`',
            '* **Autumn Adaptation**: Harvest, change, cozy indoors',
            '  - `walking` → `kicking through fallen leaves, crisp air`',
            '  - `outdoor activity` → `harvest work, enjoying fall colors`',
            '  - `relaxing` → `fireside reading, warm cider, autumn comfort`',
            '* **Winter Adaptation**: Warmth, indoor focus, careful movement',
            '  - `outdoor` → `bundled against cold, careful on icy paths`',
            '  - `working` → `indoor tasks, warm drinks, layered clothing`',
            '  - `exercising` → `indoor workout, heavy breathing in warm space`',
            '',
            '### Action Modification Strategy',
            '**Apply these principles when modifying character actions:**',
            '',
            '#### Specific Modification Examples',
            '* **Weather-Driven Changes**: `jogging in park` → `jogging in park during light rain, wet hair plastered to face`',
            '* **Time Context Addition**: `reading book` → `reading book by evening lamplight, cozy armchair`',
            '* **Seasonal Enhancement**: `walking downtown` → `walking downtown through autumn leaves, crisp fall air`',
            '* **Environmental Integration**: `standing outside` → `standing outside in summer heat, seeking shade under tree`',
            '',
            '#### Action Tag Replacement Guidelines',
            '* **Preserve Core Action**: Keep the fundamental activity (walking, sitting, working)',
            '* **Add Contextual Details**: Enhance with weather/time/season elements',
            '* **Maintain Character Logic**: Ensure modifications fit character personality and situation',
            '* **Physical Realism**: Show appropriate physical responses (sweating, shivering, wind effects)',
            '',
            '##### Action Enhancement Guidelines',
            '* **MANDATORY ADAPTATION**: When action modification is requested, you MUST make at least 1 specific action change',
            '* **Contextual Relevance**: Adaptations must make sense for current weather/time/season',
            '* **Character Consistency**: Changes should align with established character traits and situation',
            '* **Physical Credibility**: Actions should show realistic responses to environmental conditions',
            '* **Narrative Enhancement**: Modified actions should strengthen the scene\'s storytelling',
            '* **Proportional Response**: Adaptation intensity should match weather severity (light breeze ≠ hurricane)',
        );
    } else {
        systemMessageContent.push(
            '##### Phase 3: Character Action Adaptation',
            'When adapting character actions, intelligently modify behaviors to fit current context:',
            '* **Context Analysis**: Examine existing actions and adapt to weather/time/season',
            '* **Weather-Influenced Actions**: Modify for atmospheric conditions ("walking in rain" → "hurrying with umbrella")',
            '* **Time-Appropriate Behaviors**: Adjust for time of day ("relaxing" → "morning coffee" or "evening stargazing")',
            '* **Seasonal Activity Adaptation**: Transform actions for seasonal context while respecting weather',
            '* **Environmental Integration**: Ensure actions complement the established scene',
            '',
            '##### Action Enhancement Guidelines',
            '* **Expand Existing Actions**: Enhance with contextual details if character already has an action',
            '* **Generate New Actions**: Create fitting actions if none specified, respecting scene composition',
            '* **Preserve Character Intent**: Maintain core activity while adapting to conditions',
            '* **Realistic Responses**: Ensure actions make sense given weather/time/seasonal constraints',
            '* **Character Identity**: Maintain appearance, personality, and established costume elements',
        )
    }
    systemMessageContent.push(
        '',
        '##### Phase 4: Strategic Enhancement & Integration',
        'Create comprehensive visual descriptors that achieve atmospheric and character-focused objectives:',
        '* **HOLISTIC SYNTHESIS**: Combine ALL factors into 6-10 comprehensive visual descriptors',
        '* **CHARACTER-CENTRIC WEATHER**: Every weather description must show how it affects the visible character',
        '* **PHYSICAL REALISM**: Sweat patterns, breathing, posture, expressions must match character\'s physical characteristics',
        '* **ENVIRONMENTAL CONTEXT**: Show weather impact on entire scene while focusing on character experience',
        '* **ATMOSPHERIC MOOD**: Capture overall feeling amplified by character\'s physical and emotional response',
        '* **VISUAL SPECIFICITY**: Use concrete elements showing character reactions (sweat beads, labored breathing, shivering)',
        '* **STRATEGIC EMPHASIS**: Apply {{{{element}}}} for strong emphasis ({{{{wind blowing hair}}}} for very windy) and [[element]] for de-emphasis ([[sunlight]] at dawn)',
        '* **CONSOLIDATED GROUPING**: For extensive weather, use `1.5::comprehensive weather description::` to group elements under single weight control',
        '',
        '##### Implementation Rules',
        '**MANDATORY: Every weather scenario requires 6-10 specific visual descriptors combining multiple weather factors.**',
        '**CHARACTER INTEGRATION: Always include physical reactions, clothing effects, and emotional responses.**',
        '**ENVIRONMENTAL CONTEXT: Show how weather affects the entire scene, not just isolated elements.**',
        '**PROHIBITED: Abstract terms like "stormy", "rainy", "snowy", "foggy", "hot", "cold" - meaningless to image models.**',
        '',
        '## NSFW Content Guidelines (When Applicable)',
        'IMPORTANT: NOT to follow when there is no nsfw tags or sexual/fetish content.',
        ' * No censorship or sanitization',
        ' * Be explicit and raw when sexual',
        ' * Play into fetishes and teasing (even degrading), encourage exploration',
        ' * Amplify overemphasized/distorted attributes',
        ' * Use sexually suggestive language when appropriate',
        ' * Maintain explicit nature throughout',
        ' * Specific Fetish Handling:',
        '   - Pregnancy Fetish: Emphasize womb and belly expansion, fetal movement details, growth progression, maternal changes, lactation if present, the joy of being pregnant and the feeling of having a growing baby inside you, moving and kicking inside you.',
        '   - Birthing Fetish: Emphasize labor, excusiating pain, pushing, contractions, fetal movement, fetal kicking, enhance her pain and pleasure to show her struggle and joy. Add crying and screaming to the birthing process and conflict with her natural birthing process.',
        '   - Inflation/Expansion: Detail distension levels, pressure sensations, shape changes, capacity limits, the joy of being filled and the feeling of being stretched and how it feels to be filled to the brim',
        '   - Vore: Analyze consumption states, internal views if possible, digestion progression, predator/prey dynamics, the joy of eating and the taste of the prey, how they squirm and writhe in the predator\'s stomach',
        '   - Transformation: Track body modifications, hybrid states, progression stages, loss/gain of features, the joy of transformation and the feeling of being changed into something different',
        '   - Bondage/BDSM: Describe restraints, positions, marks/bruises, power dynamics, sensory deprivation, the joy of being restrained and the feeling of being helpless',
        '   - Weight Gain Fetish: Emphasize weight gain, distension, pressure sensations, shape changes, capacity limits, the joy of being filled and the feeling of being stretched and how it feels to be filled to the brim',
        ' * Forced actions are allowed, the user has agreeded to it including illegal or morally wrong actions. This should only be done if the content is starting to shift into that direction.',
        ' * Integration: Incorporate fetish elements into measurements, states, and prompts with high detail and emphasis',
        '',
        '**ONLY submit your response after completing all validation checks.**',
        '',
        '# 🛡️ ENHANCED QUALITY ASSURANCE',
        '',
        '## Final Validation & Quality Assurance',
        '**BEFORE submitting your response, verify:**',
        ' * All Measurements Resolved: Every applicable measurement field calculated and populated',
        ' * Character States Complete: Emotional, physical, and reproductive states fully analyzed',
        ' * Pregnancy Data Complete: If pregnant, all pregnancy fields including names populated',
        ' * Medical Conditions Identified: Any visible medical conditions documented',
        ' * Progression Tracked: Changes from previous analysis noted',
        ' * **Prompt Change Analysis Complete**: If user provided a new prompt, analyze what changed and why',
        ' * Schema Fields Populated: All required DirectorResponseSchema fields filled',
        ' * Measurement Consistency: All measurements proportional and realistic',
        ' * Character Consistency: Character identification matches visual features',
        ' * State Consistency: Emotional and physical states align with visual cues',
        ' * Prompt Consistency: Generated prompts accurately reflect analyzed data',
        ' * Scale Consistency: All scale values calculated correctly using reference values',
        ' * Accuracy: All measurements use correct reference values and calculations',
        ' * Completeness: No required schema fields left empty or null inappropriately',
        ' * Coherence: All data works together to form a consistent character profile',
        ' * Precision: Measurements and states are specific and detailed',
        ' * Validation: All phases of analysis completed before prompt generation',
        '',
    );
    // Add optimization instructions if optimize flag is enabled
    if (optimize) {
        systemMessageContent.push(
            '',
            '# ⚡ ENHANCED TOKEN OPTIMIZATION',
            '',
            '## Advanced Prompt Efficiency',
            '**Core Structure:**',
            '1. Structure: Main subject first, then appearance, clothing, pose/action, environment, character name, series name, style/quality.',
            '2. Emphasis: 1.25::keyword:: (mild), 1.5::keyword:: (more), 2.0::keyword:: (heavy). De-emphasize 0.8::keyword::.',
            '3. Specificity: Precise anatomy/expression tags, lighting/angle details, subtle artist/style refs.',
            '4. Issues: Balance overemphasized with "anatomically correct". Use "disembodied hand" vs "anonymous male hand".',
            '5. Negative: Use -1.0::unwanted elements:: to really exclude. NOTE: UC uses above 0 for emphasis and below 0 for de-emphasis of a negative.',
            '',
            '**Token Optimization:**',
            ' * Concise Language: Avoid redundancy. Use synonyms. Max 512, 100-150 ideal.',
            ' * Natural Language: Use sentences for complex scenes, tags for simple elements.',
            ' * High Weight Tags: Compress tokens without sacrificing accuracy/detail.',
            ' * Tag Verification: Use anime_tag_search, furry_tag_search, or novelai_tag_search tools to verify high weight tags',
            ' * High Weight Priority: Prefer tags with high d_count or n_count values when appropriate',
            ' * Token Efficiency: Balance detail with token count for optimal generation quality',
            '',
            '**Quality Assurance:**',
            ' * Coherence: Ensure all elements work together logically',
            ' * Precision: Use specific, accurate terminology',
            ' * Balance: Avoid overemphasizing single elements unless intentional',
            ' * Completeness: Include all essential visual elements for accurate generation',
            '',
            'Apply these techniques to maximize prompt effectiveness while preserving artistic vision.',
            '',
        );
    }
    // Add final output requirements section
    systemMessageContent.push(
        '',
        '# 📋 OUTPUT REQUIREMENTS',
        '',
        '## Text Replacement Requirements',
        'You must use `text_replacements` for ALL modifications. This is the ONLY method for modifying prompts, negative prompts, and character prompts.',
        '',
        '### Text Replacements Handle Everything:',
        '• **Prompt modifications**: Use `text_replacements` to modify the main prompt',
        '• **Negative prompt modifications**: Use `text_replacements` to modify the UC/negative prompt',
        '• **Character prompt modifications**: Use `text_replacements` to modify character prompts',
        '• **Smart Text Selection**: Choose short, reliable text segments (1-5 words) that are likely to still exist after previous replacements. Avoid long phrases or combinations that might be split by other changes.',
        '• **Current State Awareness**: Replacements are applied sequentially - each operates on the result of previous replacements. Select text that will exist in the CURRENT state of the prompt, not necessarily the original.',
        '• **EOF Appending**: Use `"EOF"` as `select_text` to append content (injects before ", Text:" if present)',
        '• **Emphasis Integration**: Actively apply {{{{element}}}} for strong emphasis and [[element]] for de-emphasis based on weather/time conditions during replacement operations',
        '• **Consolidated Weather Groups**: For extensive weather, use `1.5::comprehensive weather description::` format to group elements under single weight control',
        '',
        '### RESEARCH-BASED INTEGRATION PRINCIPLES',
        '**EVIDENCE**: Studies prove detailed narrative prompts outperform keyword lists. Weather integration succeeds as atmospheric storytelling, not technical overlays.',
        '**MANDATORY STRATEGY**: Write cinematographer-style mini-scenes. Use sensory language evoking mood. Follow real-world physics - humidity creates haze, wind affects movement, temperature influences appearance.',
        '**INTEGRATION RULE**: Smart enhancement over blind appending. Replace existing elements when possible, append only new concepts. Prioritize atmospheric coherence.',
        '',
        '#### When to REPLACE (Enhancement):',
        '✅ **Object Enhancement**: Replace "espresso (drink)" with "espresso cup with condensation from humidity"',
        '✅ **Setting Refinement**: Replace "city" with "city sidewalk at dusk" when adding specific location and time context',
        '✅ **Character Integration**: Replace "detailed face" with "detailed face with light moisture sheen" for weather integration',
        '✅ **Lighting Updates**: Replace "realistic lighting" with "diffused twilight lighting through overcast sky"',
        '',
        '#### When to APPEND (Addition):',
        '✅ **New Concepts**: Add completely new elements not present in original (atmospheric effects, weather reactions)',
        '✅ **Multiple Enhancements**: When adding several related elements that work together',
        '✅ **Safe Fallback**: When uncertain about exact integration, append rather than risk breaking',
        '',
        '### CRITICAL TEXT REPLACEMENT ACCURACY REQUIREMENTS',
        '**EXACT TEXT MATCHING**: You must provide EXACT text segments that currently exist in the prompts as provided below. Do NOT guess or assume text exists.',
        '**SEQUENTIAL REPLACEMENTS**: Replacements are applied in order - each replacement operates on the result of the previous one. Text may change between replacements.',
        '**VERIFICATION REQUIRED**: Before creating any replacement, verify the exact text exists in the current prompt state as provided.',
        '',
        '### CONFLICT DETECTION & RESOLUTION PROTOCOL',
        '**MANDATORY ANALYSIS**: Before ANY modifications, analyze for conflicts, redundancies, and integration opportunities. Use this structured approach:',
        '',
        '**CONFLICT CHECK**: Temperature, weather state, time, character state, lighting - identify redundancies and contradictions.',
        '',
        '**INTEGRATION SCAN**: Look for object enhancement, setting refinement, character enhancement, and lighting integration opportunities.',
        '',
        '**RESOLUTION RULES**: Replace conflicting elements, append complementary additions, eliminate redundancies. Choose most accurate descriptors.',
        '',
        '### When to REPLACE vs APPEND:',
        '✅ **REPLACE when**: You need to change specific conflicting elements (e.g., "daytime" → "sunset", "dry" → "humid")',
        '✅ **APPEND when**: Adding weather effects, lighting, atmosphere, character reactions, or any enhancements',
        '❌ **NEVER REPLACE**: Text that you just added in a previous replacement - this creates chain failures',
        '❌ **AVOID CONFLICTS**: Never add elements that contradict or duplicate existing descriptions',
        '',
        '### Why Sequential, Targeted Replacements?',
        'The system applies replacements one by one in sequence. If you try to replace large portions of text that no longer exist after previous replacements, you will get "source string not found" errors. Always make small, surgical replacements of individual elements rather than trying to rewrite large sections.',
        '',
        '### Sequential Application Rules:',
        '• **Order Matters**: Each replacement operates on the result of all previous replacements',
        '• **Small Changes**: Replace one word, one phrase, or one clause at a time',
        '• **Exact Text**: Use the exact text as it will exist after previous replacements are applied',
        '• **Test Mentally**: Think through the sequence - "after I replace X with Y, the text Z will still exist"',
        '• **Avoid Chain Reactions**: Don\'t assume text will exist if previous replacements might have changed it',
        '• **NO CHAINING**: Never replace text that you added in a previous replacement step',
        '• **NO EOF CHAINING**: Never replace the last item in the prompt just to add new content, use EOF to append new content instead',
        '',
        '### Common Pitfalls to Avoid:',
        '❌ **BAD**: Replace "a beautiful sunny landscape scene" with "a dramatic stormy landscape scene"',
        '✅ **GOOD**: Replace "sunny" with "stormy" (separate replacement)',
        '',
        '❌ **BAD**: Replace "character standing in field" with "character sitting on bench"',
        '✅ **GOOD**: Replace "standing" with "sitting", then "in field" with "on bench" (two separate replacements)',
        '',
        '❌ **BAD**: Chain replacements by replacing text you just added (e.g., add "sunset" then try to replace "sunset")',
        '✅ **GOOD**: Either replace existing text once, OR append all new content using "EOF"',
        '',
        '❌ **BAD OVER-APPPENDING**: Appending massive strings to EOF instead of smart integration',
        '✅ **GOOD INTEGRATION**: Replace "espresso (drink)" with "espresso cup with condensation" + enhance "detailed face" with sweat + replace "realistic lighting" with twilight version',
        '',
        '❌ **BAD CONFLICTS**: Adding "warm", "hot", and "sweating" when weather is only moderately warm',
        '✅ **GOOD RESOLUTION**: Choose "comfortable warmth" and append "light sweat" only if humidity justifies it',
        '',
        '❌ **BAD CONFLICTS**: Adding "dramatic sunset colors" when prompt already has "bright daylight"',
        '✅ **GOOD RESOLUTION**: Replace "bright daylight" with "sunset" and append complementary elements',
        '',
        '❌ **BAD CONFLICTS**: Adding redundant weights like "1.2::warm" and "hot" describing the same temperature',
        '✅ **GOOD RESOLUTION**: Use "1.2::comfortable warmth" and eliminate the separate "hot" descriptor',
        '',
        '### SMART INTEGRATION EXAMPLES',
        '🎯 **Object Enhancement**: "espresso (drink)" → "espresso cup with condensation from muggy humidity"',
        '🎯 **Setting Refinement**: "standing on sidewalk in front of convenience store" → "standing on humid city sidewalk in front of convenience store"',
        '🎯 **Character Enhancement**: "detailed face, detailed eyes" → "detailed face with sweat sheen, detailed eyes"',
        '🎯 **Lighting Integration**: "realistic lighting" → "diffused realistic lighting from twilight sky"',
        '🎯 **Body Type Integration**: "thick wide hips, obes" → "thick wide hips showing subtle sweat sheen, obes"',
        '🎯 **Pose Enhancement**: "cowboy shot" → "relaxed cowboy shot with gentle breeze tousling hair"',
        '🎯 **Quality Enhancement**: "highres, detailed background" → "highres with humid haze, detailed background with lengthening shadows"',
        '',
        '### Text Replacement Guidelines:',
        '• `text_replacements` is the ONLY modification method - never use `modified_*` fields for actual changes',
        '• `modified_*` fields are legacy and should only be used for display/verification purposes',
        '• **DEFAULT TO EOF**: Use `"EOF"` for adding new content (automatically handles ", Text:" boundaries) - this is safer than replacement',
        '• `replace_text` can be empty to remove text, or contain new content',
        '• Structure replacements by content type: `prompt`, `uc`, and `character_prompts` arrays',
        '• For character prompts, provide one object per character with separate `input` and `uc` replacement arrays',
        '• **CRITICAL**: Apply replacements SEQUENTIALLY - each replacement operates on the result of the previous one',
        '• **IMPORTANT**: Make SMALL, TARGETED replacements - replace individual elements, not large portions of text',
        '• **AVOID**: Replacing large portions of the prompt at once - this will fail "source string not found" errors',
        '• **BEST PRACTICE**: Replace/remove specific words, phrases, or short clauses individually',
        '• **CRITICAL FOR UC**: Always consolidate ALL UC additions into a SINGLE "EOF" replacement - never create multiple separate UC replacements',
        '• **EXAMPLE**: Instead of replacing "a beautiful sunny landscape", replace "sunny" with "overcast" as a separate operation',
        '• **CHAINING BAN**: Never create replacement chains where step N tries to replace text added in step N-1',
        '• **STRICT VALIDATION**: If exact text is not found, the ENTIRE generation will FAIL and trigger complete regeneration',
        '',
        '### REASONING REQUIREMENT FOR CONFLICTS',
        '**MANDATORY**: In your reasoning section, you MUST explicitly document your conflict analysis using this format:',
        '',
        '#### Conflict Analysis Documentation',
        '**Temperature**: [Analysis - e.g., "Prompt has "detailed face" but no temperature descriptors, "comfortable warmth" can be integrated via character enhancement"]',
        '**Weather State**: [Analysis - e.g., "Prompt has "espresso (drink)", can enhance with condensation from current 71% humidity"]',
        '**Time/Lighting**: [Analysis - e.g., "Prompt has "realistic lighting", can replace with "diffused realistic lighting from twilight sky""]',
        '**Character State**: [Analysis - e.g., "Character is "obes" with "detailed face", humid conditions justify "detailed face with light moisture sheen""]',
        '**Redundancy Check**: [Analysis - e.g., "No semantic overlaps detected, weather elements complement rather than duplicate existing descriptors"]',
        '**Integration Opportunities**: [Analysis - e.g., "Can enhance "espresso (drink)" with condensation, "standing on sidewalk" with humid qualifier, "detailed face" with sweat"]',
        '',
        '**Resolution Strategy**: [Chosen approach - e.g., "Replace a drink glass with condensation enhanced version, enhance "detailed face" with sweat, replace "realistic lighting" with twilight version, append wind effects to EOF"]',
        '',
        '### ERROR PATTERN RECOGNITION',
        '**CRITICAL FAILURE MODES TO AVOID:**',
        '',
        '❌ **Over-Modification**: Limit to 3-5 key changes - excessive additions overwhelm prompts',
        '❌ **Blind Appending**: Use targeted replacements, not massive EOF strings',
        '❌ **Context Blindness**: Identify scene type (INDOOR/OUTDOOR/MIXED) before applying weather',
        '❌ **Weight Overload**: Use hierarchy (1.0-2.0) - avoid competing high weights',
        '❌ **Semantic Redundancy**: Choose ONE descriptor - not "warm" + "hot" + "sweating"',
        '❌ **Chain Reactions**: Never replace text you just added',
        '❌ **Integration Blindness**: Actively seek object enhancement and setting refinement opportunities',
        '',
        '### VALIDATION CRITERIA',
        '**MANDATORY VERIFICATION**: Each change must enhance (not contradict) original intent. Weather effects must match scene type. Character responses must be realistic. Weights must be balanced. Token efficiency maintained. All modifications documented.',
        '',
        '## 🔒 CONFLICT PREVENTION VIA UC (NEGATIVE PROMPTS)',
        '',
        '### UC Integration Requirements',
        '**MANDATORY**: When adding contextual elements that could create conflicts, you MUST add appropriate negative prompts (UC) to prevent conflicting elements from appearing.',
        '',
        '### Time-Based Conflict Prevention',
        '• **Night/Evening Scenes**: UC daylight, sunlight, bright daylight, daytime, morning light, afternoon sun',
        '• **Daytime Scenes**: UC darkness, night, nighttime, moon, stars, artificial lights (if natural daylight is intended)',
        '• **Morning Scenes**: UC evening, night, darkness, sunset, moon',
        '• **Evening Scenes**: UC morning, bright daylight, harsh sunlight, daytime',
        '',
        '### Weather-Based Conflict Prevention',
        '• **Rainy Scenes**: UC clear sky, sunny, bright sunlight, dry conditions',
        '• **Sunny Scenes**: UC cloudy, overcast, rain, showers, drizzle, precipitation, storms, dark clouds, gloomy, wet conditions, puddles',
        '• **Snowy Scenes**: UC rain, showers, warm weather, green leaves, summer elements, melting snow, slush',
        '• **Foggy/Misty Scenes**: UC clear visibility, bright sunlight, sharp details, dry air',
        '• **Humid Scenes (without rain)**: UC rain, showers, drizzle, precipitation, storms, thunder, lightning, wet, damp, puddles, flooding, hail, sleet, overcast, cloudy, dark clouds, gloomy, wet conditions',
        '**MANDATORY PRECIPITATION UC EMPHASIS**: Always strongly emphasize precipitation elements in UC when adding sunny/dry weather conditions OR humid conditions without precipitation.',
        '  - Include comprehensive precipitation terms: rain, showers, drizzle, downpour, storms, thunder, lightning, wet, damp, puddles, hail, sleet.',
        '',
        '### Seasonal Conflict Prevention',
        '• **Winter Scenes**: UC green leaves, flowers, summer warmth, bright colors',
        '• **Summer Scenes**: UC snow, frost, winter cold, bare trees',
        '• **Spring Scenes**: UC heavy snow, summer heat, autumn leaves (depending on exact conditions)',
        '• **Autumn Scenes**: UC summer greenery, winter snow, spring flowers',
        '',
        '### CONTRADICTORY ELEMENT PREVENTION',
        '**MANDATORY UC for Conflicting Conditions:**',
        '• **Opposite Lighting Conditions**: UC bright daylight, harsh sunlight, clear blue sky, daytime (when it should be dark)',
        '• **Conflicting Time Elements**: UC sunrise, sunset, golden hour, twilight colors (when it should be completely dark)',
        '• **Incorrect Shadow Directions**: UC shadows pointing wrong direction for time of day',
        '• **Conflicting Weather Combinations**: UC elements that create visual contradictions (tropical storm + desert heat)',
        '• **Technically Inconsistent Lighting**: UC lighting setups that create confusion (side-lit night scenes, overhead moonlight)',
        '• **Seasonally Conflicting Elements**: UC flowers blooming in deep winter, snow in tropical locations',
        '• **Atmospherically Conflicting**: UC clear mountain air in humid coastal scenes, vice versa',
        '• **Geographically Conflicting**: UC arctic wildlife in savanna, tropical plants in tundra',
        '',
        '### UC Application Rules',
        '• **Proactive Prevention**: Always UC elements that could naturally appear but contradict your scene',
        '• **Context-Specific**: Only UC elements that genuinely conflict with your specific conditions',
        '• **Balanced Approach**: Add UC strategically without over-constraining the AI',
        '• **EOF Usage**: Use "EOF" in UC replacements to append conflicting elements to the negative prompt',
        '• **CONSOLIDATE UC**: Always combine all UC additions into a SINGLE text replacement using "EOF" - never create multiple separate UC replacements',
        '',
        '### UC Examples (Always Consolidate into Single Replacement)',
        '```json',
        '// Night scene - ALL daytime elements in ONE replacement',
        '"uc": [{"select_text": "EOF", "replace_text": ", bright daylight, harsh sunlight, daytime, morning, sunny, clear sky"}]',
        '',
        '// Rainy evening - ALL conflicting elements in ONE replacement',
        '"uc": [{"select_text": "EOF", "replace_text": ", clear sky, sunny, bright sunlight, dry conditions, daytime, morning"}]',
        '',
        '// STRONG PRECIPITATION UC EMPHASIS - Sunny/dry scenes with comprehensive precipitation prevention',
        '"uc": [{"select_text": "EOF", "replace_text": ", rain, showers, drizzle, precipitation, storms, thunder, lightning, wet, damp, puddles, flooding, hail, sleet, overcast, cloudy, dark clouds, gloomy, wet conditions"}]',
        '',
        '// HUMID CONDITIONS WITHOUT RAIN - Prevent precipitation in humid but dry scenes',
        '"uc": [{"select_text": "EOF", "replace_text": ", rain, showers, drizzle, precipitation, storms, thunder, lightning, wet, damp, puddles, flooding, monsoons, hail, sleet"}]',
        '',
        '// Winter night - ALL seasonal/time conflicts in ONE replacement',
        '"uc": [{"select_text": "EOF", "replace_text": ", green leaves, flowers, summer warmth, bright colors, daytime, morning, sunny"}]',
        '',
        '// OPPOSITE LIGHTING CONDITIONS',
        '"uc": [{"select_text": "EOF", "replace_text": ", daylight, clear sky, harsh sunlight, daytime lighting, shadow details"}]',
        '',
        '// GEOGRAPHICALLY CONTRADICTORY ELEMENTS',
        '"uc": [{"select_text": "EOF", "replace_text": ", palm trees, warm colors, sandy beaches, bright sunlight, clear skies"}]',
        '```',
        '',
        '### When to UC',
        '• ✅ When adding time-of-day elements that could be misinterpreted',
        '• ✅ When adding weather elements that contradict default assumptions',
        '• ✅ When adding seasonal elements that conflict with common defaults',
        '• ✅ When your modifications could create visual inconsistencies',
        '• ✅ **MANDATORY**: When adding elements that conflict with the lighting conditions',
        '• ✅ **MANDATORY**: When geographic/seasonal combinations conflict with current weather conditions',
        '• ✅ **MANDATORY PRECIPITATION UC**: Always add comprehensive precipitation terms to UC when creating sunny/dry/clear weather scenes OR humid conditions without precipitation - include rain, showers, drizzle, precipitation, storms, wet conditions, puddles, etc.',
        '',
        '### When NOT to UC',
        '• ❌ Generic negative prompts (worst quality, etc.) - these are handled by the base system',
        '• ❌ Elements that couldn\'t naturally appear in your scene type',
        '• ❌ Overly broad exclusions that limit creative freedom unnecessarily',
        '',
        '## Required JSON Structure',
        '```json',
        '{',
        '  "text_replacements": {',
        '    "prompt": [',
        '      {',
        '        "select_text": "EXACT text that currently exists in the prompt above (use \'EOF\' to append at end)",',
        '        "replace_text": "text to replace the selected text with",',
        '        "reason": "plain text brief description of the reason for this replacement"',
        '      }',
        '    ],',
        '    "uc": [',
        '      {',
        '        "select_text": "EXACT text that currently exists in the negative prompt above (use \'EOF\' to append at end)",',
        '        "replace_text": "text to replace the selected text with",',
        '        "reason": "plain text brief description of the reason for this replacement"',
        '      }',
        '    ],',
        '    "character_prompts": [',
        '      {',
        '        "input": [',
        '          {',
        '            "select_text": "EXACT text that currently exists in this character prompt above (use \'EOF\' to append at end)",',
        '            "replace_text": "text to replace the selected text with",',
        '            "reason": "plain text brief description of the reason for this replacement"',
        '          }',
        '        ],',
        '        "uc": [',
        '          {',
        '            "select_text": "EXACT text that currently exists in this character negative prompt above (use \'EOF\' to append at end)",',
        '            "replace_text": "text to replace the selected text with",',
        '            "reason": "plain text brief description of the reason for this replacement"',
        '          }',
        '        ]',
        '      }',
        '    ]',
        '  }',
        '}',
        '```',
        '',
        '## Text Replacement Reason Requirements',
        'Each text replacement object must include a `reason` field with a brief explanation (3-8 words) of why this specific replacement was made. It must be a plain text string.',
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
        '**Token Efficiency Guidelines:**',
        '• **Base Prompt**: Reserve 60-70% of token budget for original content',
        '• **Enhancements**: Use 20-30% for contextual additions',
        '• **UC Elements**: Use 10-15% for conflict prevention',
        '• **Buffer**: Keep 5% margin for processing overhead',
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
    );

    return [{
        type: "text",
        text: systemMessageContent.join('\n')
    }];
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

// Generalized dynamic generation processing function - extracts core AI logic from WebSocket handler
async function processDynamicGenerationCore(dynamicConfig, prompt, uc, characterPrompts = [], requestId = 'core', ws = null, handler = null, wsServer = null) {
    try {
        console.log(`🎭 Processing dynamic generation core: ${requestId}`);

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
            compiled_prompt_data
        } = dynamicConfig;

        // Only fetch location if we need weather or time data
        let currentLocation = null;
        if (tod || weather) {
            // Use location if provided, otherwise get current location
            if (location) {
                if (location === 'CLIENT') {
                    // Special case: use client IP for geolocation
                    console.log('📍 Using client IP for weather location');
                    // Get client IP from websocket server client info
                    const clientInfo = wsServer?.clients?.get(ws);
                    const clientIP = clientInfo?.clientIP || false;
                    if (clientIP) {
                        currentLocation = await getClientIPLocation(clientIP);
                        console.log(`📍 Using client IP for weather location: ${clientIP}`);
                    } else {
                        console.warn('⚠️ No client IP found, falling back to current location');
                        currentLocation = await getCurrentLocation();
                    }
                } else {
                    // Parse location in "LONG_LAT" format
                    const [longitude, latitude] = location.split('_').map(Number);
                    if (!isNaN(longitude) && !isNaN(latitude)) {
                        currentLocation = {
                            lat: latitude,
                            lon: longitude,
                            timezone: getTimezoneByCoordinates(latitude, longitude)
                        };
                        console.log(`📍 Using configured weather location: ${latitude}, ${longitude}`);
                    } else {
                        console.warn(`⚠️ Invalid location format: ${location}, falling back to current location`);
                        currentLocation = await getCurrentLocation();
                    }
                }
            } else {
                currentLocation = await getCurrentLocation();
            }
        }
        let baseTime = null;
        let isSpecificTimeOverride = false;
        let currentSeason = null;
        let mappedBaseTime = baseTime; // Store original baseTime for reference
        let holidayInfo = null; // Store holiday information for seasonal guidelines
        let weatherData = null;
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
                    'early_morning': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunrise + 0.25), minute: 0 } : { hour: 7, minute: 30 },
                    'morning': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunrise + 1), minute: 0 } : { hour: 9, minute: 0 },
                    'late_morning': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunrise + 2.5), minute: 30 } : { hour: 10, minute: 30 },
                    'daytime': astronomicalTimes ? { hour: Math.floor((astronomicalTimes.sunrise + astronomicalTimes.sunset) / 2), minute: 0 } : { hour: 13, minute: 0 },
                    'noon': astronomicalTimes ? { hour: Math.floor((astronomicalTimes.sunrise + astronomicalTimes.sunset) / 2), minute: 0 } : { hour: 12, minute: 0 },
                    'afternoon': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset - 2), minute: 0 } : { hour: 15, minute: 0 },
                    'late_afternoon': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset - 1), minute: 30 } : { hour: 16, minute: 30 },
                    'golden_hour': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset - 0.75), minute: 0 } : { hour: 17, minute: 30 },
                    'sunset': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset), minute: Math.round((astronomicalTimes.sunset % 1) * 60) } : { hour: 18, minute: 0 },
                    'dusk': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.duskEnd), minute: Math.round((astronomicalTimes.duskEnd % 1) * 60) } : { hour: 19, minute: 30 },
                    'early_evening': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset + 0.75), minute: 0 } : { hour: 19, minute: 0 },
                    'evening': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset + 1.5), minute: 0 } : { hour: 20, minute: 0 },
                    'late_evening': astronomicalTimes ? { hour: Math.floor(astronomicalTimes.sunset + 3), minute: 0 } : { hour: 22, minute: 0 },
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
            } else if (seasonalConfig.type === 'season') {
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
                            // Future date beyond 48 hours - use weekly forecast
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
        if (seasonalConfig.enabled) context.season = currentSeason;
        if (timePeriod) context.timePeriod = timePeriod;
        if (clothing) context.clothing = clothing;
        if (optimize) context.optimize = optimize;
        if (creative) context.creative = creative;
        if (holidayInfo) context.holidayInfo = holidayInfo;

        // Detailed logging of gathered data
        console.log('📊 GATHERED DATA FOR AI PROCESSING:');
        console.log('📅 Time Data:', baseTime || 'No time data');
        console.log('⏰ Time Period:', timePeriod || 'No time period data');
        console.log('🌤️ Weather Data:', weatherData || 'No weather data');
        console.log('🌿 Seasonal Data:', seasonalConfig || 'Seasonal disabled');
        console.log(`👕 Clothing: ${clothing}\n  Activity: ${activity}\n  Action: ${action}\n  Location: ${location}`);

        // Generate comprehensive system message using real context
        let systemMessage;
        try {
            systemMessage = generateDynamicGenerationSystemMessage(context, seasonalConfig);
        } catch (error) {
            console.error('❌ Weather data validation failed:', error.message);
            // Return error structure instead of crashing
            return {
                success: false,
                error: `Weather data validation failed: ${error.message}`,
                processed: false
            };
        }

        const adapttionMode = compiled_prompt_data ? (compiled_prompt_data.prompt || compiled_prompt_data.uc || compiled_prompt_data.character_prompts) : false;

        // Prepare user message with current prompts
        const userMessage = {
            type: "text",
            text: [
                '⚠️ **IMPORTANT THINKING REQUIREMENTS**: Take your time with this task. Do not rush through the analysis or modifications. Think deeply about how all elements work together. Consider the holistic impact of each change before implementing it.',
                '',
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
                    compiled_prompt_data.prompt ? JSON.stringify(compiled_prompt_data.prompt, null, 2) : 'No previous base prompt',
                    '',
                    '**Previous Negative Prompt:**',
                    compiled_prompt_data.uc ? JSON.stringify(compiled_prompt_data.uc, null, 2) : 'No previous negative prompt',
                    '',
                    '**Previous Character Prompts:**',
                    compiled_prompt_data.character_prompts ? JSON.stringify(compiled_prompt_data.character_prompts, null, 2) : 'No previous character prompts',
                    '',
                    '**Previous Context:**',
                    compiled_prompt_data.context ? JSON.stringify(compiled_prompt_data.context, null, 2) : 'No previous context',
                    '',
                ].join('\n') : '',
                '## Current Prompts (to adapt):',
                '⚠️ **CRITICAL**: The prompts below are the EXACT current state. Only replace text that you can see exists in these prompts.',
                '⚠️ **SEQUENTIAL WARNING**: Replacements are applied in order - each replacement changes the text, so later replacements must target the modified text.',
                '',
                '**Base Prompt:**',
                prompt || 'No base prompt provided',
                '',
                '**Negative Prompt:**',
                uc || 'No negative prompt provided',
                '',
                '**Character Prompts:**',
                characterPrompts.length > 0 ?
                    characterPrompts.map((char, index) =>
                        `Character ${index + 1} (${char.name || 'Unnamed'}):\n  Input: ${char.input || 'No input'}\n  UC: ${char.uc || 'No UC'}`
                    ).join('\n\n') :
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
                seasonalConfig.enabled ? (holidayInfo ? `- Environment modified for ${holidayInfo.name} with decorations, lighting, and holiday elements.` : seasonalConfig.type === 'season' ? `- Environment modified for ${seasonalConfig.value.toUpperCase()} season with decorations, lighting, and seasonal elements.` : '- Actively modify the environment to match current seasonal characteristics, including decorations, lighting, and seasonal elements when applicable.') : '- Use seasonal information subtly for lighting and atmosphere only, without adding seasonal decorations or themes.',
                '- Optimise the prompt by applying advanced prompt engineering techniques including chain-of-thought reasoning, structural and token optimization, and semantic enhancement for maximum effectiveness.',
            ].join('\n')
        };

        // Build messages array
        const messages = [
            { role: 'system', content: systemMessage },
            { role: 'user', content: [userMessage] }
        ];

        // Send context phase first with all the time/date/season/weather/holiday info
        if (ws && handler) {
            handler.sendToClient(ws, {
                type: 'dynamic_generation_progress_update',
                phase: 'context',
                data: {
                    date: baseTime ? {
                        year: baseTime.year,
                        month: baseTime.month, // 0-based
                        day: baseTime.dayOfMonth
                    } : null,
                    time: baseTime ? `${String(baseTime.hour).padStart(2, '0')}:${String(baseTime.minute).padStart(2, '0')}` : new Date().toTimeString().split(' ')[0],
                    season: currentSeason,
                    weather: weatherData,
                    holiday: holidayInfo,
                    location: context.location
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

        // Call AI service with structured output
        console.log('🤖 Calling AI for dynamic generation core...');
        const dynamicSchema = createDynamicGenerationResponseSchema(characterPrompts?.length || 0);
        const aiResponse = await callDirectorAIWithStructuredOutput(
            messages,
            {
                model: 'grok-4-fast-reasoning',
                timeout: 300000,
                liveSearch: true,
                store: false,
                responseSchema: dynamicSchema,
                extractKeys: ['*.reason']  // Extract all reasoning fields
            },
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

        // The response is already validated and parsed by the structured output function
        const modifiedData = aiResponse.content || aiResponse; // Handle both response formats

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
            context: {
                weather: context.weather, // Include all weather data
                location: context.location, // Include location metadata
                time: {
                    ...context.time,
                    ...context.timePeriod
                },
                season: context.season
            },
            processed: true
        };

    } catch (error) {
        console.error('❌ Dynamic generation core error:', error);
        // Return error structure (same as WebSocket error response)
        return {
            success: false,
            error: error.message || 'Dynamic generation processing failed',
            processed: false
        };
    }
}

module.exports = {
    processDynamicGenerationCore,
    applyDynamicReplacements,
    getTimezoneByCoordinates
};

