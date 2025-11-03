// Dynamic Context Collector
// Handles input processing and raw data collection for dynamic generation
// Contains only the data gathering logic, no AI processing or recommendations

// Load secure configuration
let secureConfig = require('../secure.config.json');
const config = require('../config.json');

const https = require('https');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const { determineTimePeriod, getSunriseSunset } = require('./dynamicGenerationHandlers.timeCalc');

// Import T5 tokenizer service for token counting
const t5TokenizerService = require('./t5-tokenizer-service');

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

// Cache durations (in milliseconds)
const WEATHER_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
const ENHANCED_WEATHER_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const LOCATION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Weather cache
const weatherCache = new LRUCache(2000);

// Location cache
const locationCache = new LRUCache(1000);

// Holiday data for seasonal context
const HOLIDAY_DATA = {
    'christmas': {
        name: 'Christmas',
        decorations: 'Christmas decorations, Christmas tree, lights, ornaments',
        atmosphere: 'festive, warm, joyful, family-oriented',
        colors: 'red, green, gold, white',
        activities: 'gift giving, family gatherings, holiday meals',
        priority: 10,
        region: 'global',
        season: 'winter'
    },
    'halloween': {
        name: 'Halloween',
        decorations: 'jack-o-lanterns, cobwebs, spooky decorations',
        atmosphere: 'spooky, mysterious, playful fear',
        colors: 'orange, black, purple',
        activities: 'trick-or-treating, costume parties, haunted houses',
        priority: 8,
        region: 'western',
        season: 'autumn'
    },
    'easter': {
        name: 'Easter',
        decorations: 'Easter eggs, bunnies, spring flowers, baskets',
        atmosphere: 'renewal, hope, family, springtime joy',
        colors: 'pastel colors, yellow, green, white',
        activities: 'Easter egg hunts, family meals, church services',
        priority: 7,
        region: 'western',
        season: 'spring'
    },
    'thanksgiving': {
        name: 'Thanksgiving',
        decorations: 'autumn leaves, harvest decorations, turkeys',
        atmosphere: 'grateful, warm, family-oriented, abundant',
        colors: 'orange, brown, yellow, red',
        activities: 'family dinners, gratitude expressions, parades',
        priority: 6,
        region: 'north_america',
        season: 'autumn'
    },
    'valentines_day': {
        name: 'Valentine\'s Day',
        decorations: 'hearts, roses, candles, romantic decorations',
        atmosphere: 'romantic, loving, affectionate, intimate',
        colors: 'red, pink, white',
        activities: 'romantic dinners, gift giving, date nights',
        priority: 5,
        region: 'global',
        season: 'winter'
    },
    'new_years': {
        name: 'New Year\'s',
        decorations: 'fireworks, party decorations, countdown clocks',
        atmosphere: 'celebratory, hopeful, fresh start, energetic',
        colors: 'gold, silver, white, black',
        activities: 'parties, fireworks, resolutions, celebrations',
        priority: 9,
        region: 'global',
        season: 'winter'
    },
    'st_patricks_day': {
        name: 'St. Patrick\'s Day',
        decorations: 'shamrocks, green decorations, Irish flags',
        atmosphere: 'festive, cultural, celebratory, lighthearted',
        colors: 'green, white, gold',
        activities: 'parades, Irish culture celebration, pub gatherings',
        priority: 4,
        region: 'irish_diaspora',
        season: 'spring'
    },
    'mothers_day': {
        name: 'Mother\'s Day',
        decorations: 'flowers, cards, family photos, heart decorations',
        atmosphere: 'appreciative, loving, family-oriented, warm',
        colors: 'pink, red, yellow, white',
        activities: 'family gatherings, gift giving, special meals',
        priority: 5,
        region: 'global',
        season: 'spring'
    },
    'fathers_day': {
        name: 'Father\'s Day',
        decorations: 'tools, sports equipment, family photos',
        atmosphere: 'appreciative, masculine, family-oriented, relaxed',
        colors: 'blue, green, brown',
        activities: 'barbecues, sports, gift giving, family time',
        priority: 4,
        region: 'global',
        season: 'summer'
    },
    'independence_day': {
        name: 'Independence Day',
        decorations: 'flags, fireworks, patriotic colors, barbecues',
        atmosphere: 'patriotic, celebratory, freedom, community',
        colors: 'red, white, blue',
        activities: 'fireworks, parades, barbecues, celebrations',
        priority: 7,
        region: 'north_america',
        season: 'summer'
    },
    'labor_day': {
        name: 'Labor Day',
        decorations: 'flags, back-to-school, end-of-summer decorations',
        atmosphere: 'relaxed, end-of-summer, appreciative, community',
        colors: 'red, white, blue, yellow',
        activities: 'parades, barbecues, end-of-summer celebrations',
        priority: 4,
        region: 'north_america',
        season: 'summer'
    },
    'memorial_day': {
        name: 'Memorial Day',
        decorations: 'flags, wreaths, patriotic flowers',
        atmosphere: 'respectful, memorial, community, solemn',
        colors: 'red, white, blue',
        activities: 'parades, memorials, family gatherings',
        priority: 6,
        region: 'north_america',
        season: 'spring'
    },
    'columbus_day': {
        name: 'Columbus Day',
        decorations: 'Italian flags, explorer motifs, ships',
        atmosphere: 'cultural, exploratory, historical, celebratory',
        colors: 'green, white, red',
        activities: 'parades, cultural celebrations, historical events',
        priority: 3,
        region: 'north_america',
        season: 'autumn'
    },
    'veterans_day': {
        name: 'Veterans Day',
        decorations: 'flags, wreaths, patriotic symbols',
        atmosphere: 'respectful, grateful, solemn, appreciative',
        colors: 'red, white, blue',
        activities: 'parades, memorials, ceremonies',
        priority: 6,
        region: 'north_america',
        season: 'autumn'
    },
    'hanukkah': {
        name: 'Hanukkah',
        decorations: 'menorahs, dreidels, blue and white decorations',
        atmosphere: 'spiritual, cultural, joyful, family-oriented',
        colors: 'blue, white, gold',
        activities: 'lighting menorah, playing dreidel, special foods',
        priority: 6,
        region: 'jewish',
        season: 'winter'
    },
    'kwanzaa': {
        name: 'Kwanzaa',
        decorations: 'African patterns, kinara, red/black/green colors',
        atmosphere: 'cultural, spiritual, community, celebratory',
        colors: 'red, black, green',
        activities: 'family gatherings, cultural celebrations, ceremonies',
        priority: 4,
        region: 'african_american',
        season: 'winter'
    },
    'diwali': {
        name: 'Diwali',
        decorations: 'oil lamps, flowers, colorful lights, rangoli',
        atmosphere: 'spiritual, joyful, prosperous, celebratory',
        colors: 'gold, red, yellow, white',
        activities: 'lighting lamps, family gatherings, special foods',
        priority: 8,
        region: 'indian_subcontinent',
        season: 'autumn'
    },
    'tet': {
        name: 'Tet',
        decorations: 'red lanterns, peach blossoms, lucky symbols',
        atmosphere: 'renewal, hopeful, family-oriented, prosperous',
        colors: 'red, gold, yellow',
        activities: 'family reunions, ancestor worship, celebrations',
        priority: 9,
        region: 'vietnamese',
        season: 'winter'
    },
    'cinco_de_mayo': {
        name: 'Cinco de Mayo',
        decorations: 'Mexican flags, flowers, vibrant colors',
        atmosphere: 'cultural, celebratory, vibrant, community',
        colors: 'red, white, green',
        activities: 'parades, music, dancing, Mexican culture celebration',
        priority: 5,
        region: 'mexican_american',
        season: 'spring'
    },
    'okanawa': {
        name: 'Okanawa',
        decorations: 'Japanese lanterns, traditional decorations',
        atmosphere: 'memorial, respectful, spiritual, community',
        colors: 'white, black, traditional colors',
        activities: 'memorial services, floating lanterns, ceremonies',
        priority: 5,
        region: 'japanese',
        season: 'summer'
    }
};

// Holiday name mappings for backward compatibility
const HOLIDAY_NAMES = {
    'christmas': 'Christmas',
    'xmas': 'Christmas',
    'halloween': 'Halloween',
    'easter': 'Easter',
    'thanksgiving': 'Thanksgiving',
    'valentines': 'Valentine\'s Day',
    'valentines_day': 'Valentine\'s Day',
    'valentine': 'Valentine\'s Day',
    'new_years': 'New Year\'s',
    'new_years_eve': 'New Year\'s',
    'nye': 'New Year\'s',
    'st_patricks': 'St. Patrick\'s Day',
    'st_patricks_day': 'St. Patrick\'s Day',
    'st_patrick': 'St. Patrick\'s Day',
    'mothers_day': 'Mother\'s Day',
    'fathers_day': 'Father\'s Day',
    'independence_day': 'Independence Day',
    'july_4th': 'Independence Day',
    'labor_day': 'Labor Day',
    'memorial_day': 'Memorial Day',
    'columbus_day': 'Columbus Day',
    'veterans_day': 'Veterans Day',
    'hanukkah': 'Hanukkah',
    'kwanzaa': 'Kwanzaa',
    'diwali': 'Diwali',
    'tet': 'Tet',
    'cinco_de_mayo': 'Cinco de Mayo',
    'okanawa': 'Okanawa'
};

// Holiday intensity levels for different phases of holiday periods
const HOLIDAY_INTENSITY_LEVELS = {
    PEAK: { multiplier: 1.0, description: 'Full holiday intensity' },
    NEAR: { multiplier: 0.7, description: 'Near holiday intensity' },
    EXTENDED: { multiplier: 0.4, description: 'Extended holiday period' },
    FADING: { multiplier: 0.1, description: 'Fading holiday influence' }
};

// Buffer thresholds for holiday intensity calculation (in days)
const HOLIDAY_BUFFER_THRESHOLDS = {
    PEAK_PHASE: 3, // Within 3 days of holiday
    NEAR_PHASE: 7, // Within 1 week of holiday
    EXTENDED_PHASE: 14 // Within 2 weeks of holiday
};

// Helper function to get current time with optional overrides
function getCurrentTime(timezone = null, hour = null, minute = null, dateOverride = null) {
    const now = dateOverride ? new Date(dateOverride) : new Date();

    // Apply timezone if specified
    if (timezone) {
        // This is a simplified timezone handling - in production you'd want proper timezone conversion
        // For now, we'll just use the local time
    }

    // Override hour and minute if specified
    if (hour !== null) {
        now.setHours(hour);
    }
    if (minute !== null) {
        now.setMinutes(minute);
    }

    // Return structured time object
    return {
        timestamp: now.getTime(),
        year: now.getFullYear(),
        month: now.getMonth(), // 0-based
        dayOfMonth: now.getDate(),
        dayOfWeek: now.getDay(), // 0 = Sunday
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    };
}

// Helper function to calculate vector average for wind direction
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

// Get timezone by coordinates
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

// Open-Meteo weather condition mapping
const OPEN_METEO_CONDITIONS = {
    0: 'clear sky',
    1: 'mainly clear sky',
    2: 'partly cloudy sky',
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

// Map Open-Meteo condition codes to weather conditions
function mapOpenMeteoCondition(code) {
    return OPEN_METEO_CONDITIONS[code] || 'unknown';
}

// Map Open-Meteo condition codes to weather icons
function mapOpenMeteoIcon(code, isDay = true) {
    const dayNight = isDay ? 'd' : 'n';

    const iconMap = {
        // Clear sky
        0: `01${dayNight}`,

        // Partly cloudy
        1: `02${dayNight}`,
        2: `03${dayNight}`,

        // Overcast/cloudy
        3: `04${dayNight}`,

        // Fog
        45: `50${dayNight}`,
        48: `50${dayNight}`,

        // Drizzle
        51: `09${dayNight}`,
        53: `09${dayNight}`,
        55: `09${dayNight}`,
        56: `13${dayNight}`, // Freezing drizzle treated as snow
        57: `13${dayNight}`,

        // Rain
        61: `10${dayNight}`,
        63: `10${dayNight}`,
        65: `10${dayNight}`,
        66: `13${dayNight}`, // Freezing rain treated as snow
        67: `13${dayNight}`,

        // Snow
        71: `13${dayNight}`,
        73: `13${dayNight}`,
        75: `13${dayNight}`,
        77: `13${dayNight}`,

        // Rain showers
        80: `09${dayNight}`,
        81: `09${dayNight}`,
        82: `09${dayNight}`,

        // Snow showers
        85: `13${dayNight}`,
        86: `13${dayNight}`,

        // Thunderstorm
        95: `11${dayNight}`,
        96: `11${dayNight}`,
        99: `11${dayNight}`
    };

    return iconMap[code] || `01${dayNight}`; // Default to clear sky
}

// Enhanced condition mapping with cloud coverage consideration
function mapOpenMeteoConditionEnhanced(code, cloudCover = null) {
    let condition = mapOpenMeteoCondition(code);

    // Weather phenomena that override cloud consideration
    const weatherPhenomenaConditions = [
        'thunderstorm',
        'thunderstorm with slight hail',
        'thunderstorm with heavy hail',
        'heavy rain',
        'violent rain showers',
        'heavy snow fall',
        'heavy snow showers',
        'fog',
        'depositing rime fog'
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

// Analyze precipitation type
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

    let description = '';
    switch (primaryType) {
        case 'thunderstorm':
            description = `thunderstorm with ${intensity} rain`;
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
        case 'rain':
            description = `${intensity} rain`;
            break;
        case 'showers':
            description = `${intensity} showers`;
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

// Get comfort level based on temperature and humidity
function getComfortLevel(temperature, humidity, windSpeed) {
    // Simplified comfort level calculation
    if (temperature < 0) return 'freezing';
    if (temperature < 10) return 'cold';
    if (temperature < 20) return 'cool';
    if (temperature < 25) return 'comfortable';
    if (temperature < 30) return 'warm';
    if (temperature < 35) return 'hot';
    return 'very hot';
}

// Get UV warnings based on UV index
function getUVWarnings(uvIndex) {
    if (!uvIndex || uvIndex < 3) return [];
    if (uvIndex < 6) return ['moderate_uv'];
    if (uvIndex < 8) return ['high_uv'];
    if (uvIndex < 11) return ['very_high_uv'];
    return ['extreme_uv'];
}

// Calculate heat index
function calculateHeatIndex(temperature, humidity) {
    // Simplified heat index calculation
    if (temperature < 27) return temperature; // No heat index below 80°F
    // Simple approximation
    return temperature + (humidity / 100) * 5;
}

// Calculate wind chill
function calculateWindChill(temperature, windSpeed) {
    // Simplified wind chill calculation
    if (temperature > 10 || windSpeed < 1.3) return temperature; // No wind chill above 50°F or low wind
    // Simple approximation
    return temperature - (windSpeed / 3.6) * 0.7;
}

// Estimate UV index
function estimateUVIndex(dateTime, cloudCover, latitude) {
    try {
        const date = new Date(dateTime);
        const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
        const solarDeclination = 23.45 * Math.sin((360 / 365) * (284 + dayOfYear) * Math.PI / 180);

        // Solar elevation calculation (simplified)
        const hourAngle = (date.getHours() - 12) * 15; // 15 degrees per hour
        const latitudeRad = latitude * Math.PI / 180;
        const declinationRad = solarDeclination * Math.PI / 180;

        const sinElevation = Math.sin(latitudeRad) * Math.sin(declinationRad) +
                           Math.cos(latitudeRad) * Math.cos(declinationRad) * Math.cos(hourAngle * Math.PI / 180);

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

// Make HTTPS request with promise
function makeHttpsRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const requestOptions = {
            headers: {
                'User-Agent': 'StaticForge/1.0',
                ...options.headers
            },
            timeout: 10000, // 10 second timeout
            ...options
        };

        const req = https.get(url, requestOptions, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse JSON response: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Get cached weather data
function getCachedWeatherData(cacheKey, fetchFunction, cacheDuration = WEATHER_CACHE_DURATION) {
    const cached = weatherCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < cacheDuration) {
        console.log(`🌤️ Using cached weather data for ${cacheKey}`);
        return cached.data;
    }

    return fetchFunction().then(data => {
        weatherCache.set(cacheKey, { data, timestamp: now });
        return data;
    });
}

// Get cached location data
function getCachedLocation(fetchFunction, cacheDuration = LOCATION_CACHE_DURATION) {
    // For location caching, we'll use a simple key since location is relatively static
    const cacheKey = 'current_location';
    const cached = locationCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < cacheDuration) {
        console.log(`📍 Using cached location data`);
        return cached.data;
    }

    return fetchFunction().then(data => {
        locationCache.set(cacheKey, { data, timestamp: now });
        return data;
    });
}

// Get weather from best available provider
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
                'wind_speed_10m_max',
                'wind_gusts_10m_max',
                'wind_direction_10m_dominant',
                'pressure_msl_mean',
                'surface_pressure_mean'
            ].join(','));

            const url = `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`;

            try {
                const data = await makeHttpsRequest(url);

                // Transform and enhance the data
                return transformOpenMeteoHistoricalData(data, options);

            } catch (error) {
                console.error('Open-Meteo historical API error:', error);
                // Return reasonable fallback weather data instead of null
                return createFallbackWeatherData(location, options, error);
            }
        } else if (customDate) {
            // Historical data for specific date
            params.set('start_date', customDate);
            params.set('end_date', customDate);
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
                'wind_speed_10m_max',
                'wind_gusts_10m_max',
                'wind_direction_10m_dominant',
                'pressure_msl_mean',
                'surface_pressure_mean'
            ].join(','));

            const url = `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`;

            try {
                const data = await makeHttpsRequest(url);

                // Transform and enhance the data
                return transformOpenMeteoHistoricalData(data, options);

            } catch (error) {
                console.error('Open-Meteo historical API error:', error);
                // Return reasonable fallback weather data instead of null
                return createFallbackWeatherData(location, options, error);
            }
        } else if (customTimeOffset !== null) {
            // Custom time offset scenario
            const targetTime = new Date(Date.now() + (customTimeOffset * 60 * 60 * 1000));
            const dateString = targetTime.toISOString().split('T')[0];

            params.set('start_date', dateString);
            params.set('end_date', dateString);
            params.set('timezone', timezone || 'auto');

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

            // Add timezone parameter if specified
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

// Transform Open-Meteo data
function transformOpenMeteoData(data, options) {
    const { includeCurrent = true, includeWeekly = false } = options;

    if (!data || !data.hourly) {
        throw new Error('Invalid weather data structure');
    }

    const hourly = data.hourly;
    const daily = data.daily;
    const minutely = data.minutely_15;

    // Find current hour index
    const now = new Date();
    const currentHour = now.getHours();
    let currentIndex = -1;

    if (includeCurrent && hourly.time) {
        // Find the closest past hour in the data
        for (let i = 0; i < hourly.time.length; i++) {
            const hourTime = new Date(hourly.time[i]);
            if (hourTime <= now) {
                currentIndex = i;
            } else {
                break;
            }
        }

        // If no past hour found, use the first available hour
        if (currentIndex === -1 && hourly.time.length > 0) {
            currentIndex = 0;
        }
    }

    // Extract current weather if available
    let current = null;
    if (currentIndex >= 0) {
        const temp = hourly.temperature_2m?.[currentIndex];
        const humidity = hourly.relative_humidity_2m?.[currentIndex];
        const dewPoint = hourly.dewpoint_2m?.[currentIndex];
        const apparentTemp = hourly.apparent_temperature?.[currentIndex];
        const precip = hourly.precipitation?.[currentIndex] || 0;
        const rain = hourly.rain?.[currentIndex] || 0;
        const showers = hourly.showers?.[currentIndex] || 0;
        const snowfall = hourly.snowfall?.[currentIndex] || 0;
        const weatherCode = hourly.weather_code?.[currentIndex];
        const pressure = hourly.pressure_msl?.[currentIndex];
        const surfacePressure = hourly.surface_pressure?.[currentIndex];
        const cloudCover = hourly.cloud_cover?.[currentIndex];
        const visibility = hourly.visibility?.[currentIndex];
        const windSpeed = hourly.wind_speed_10m?.[currentIndex];
        const windDirection = hourly.wind_direction_10m?.[currentIndex];
        const windGust = hourly.wind_gusts_10m?.[currentIndex];

        if (temp !== undefined && weatherCode !== undefined) {
            current = {
                temperature: Math.round(temp),
                condition: mapOpenMeteoCondition(weatherCode),
                humidity: Math.round(humidity || 50),
                dewPoint: dewPoint !== undefined ? Math.round(dewPoint * 10) / 10 : undefined,
                feelsLike: apparentTemp !== undefined ? Math.round(apparentTemp) : undefined,
                pressure: Math.round(pressure || 1013),
                surfacePressure: surfacePressure !== undefined ? Math.round(surfacePressure) : undefined,
                cloudCoverage: Math.round(cloudCover || 0),
                visibility: visibility || 10000,
                windSpeed: windSpeed !== undefined ? Math.round(windSpeed * 10) / 10 : undefined,
                windDirection: windDirection !== undefined ? Math.round(windDirection) : undefined,
                windGust: windGust !== undefined ? Math.round(windGust * 10) / 10 : undefined,
                precipitation: Math.round(precip * 100) / 100,
                rain: Math.round(rain * 100) / 100,
                showers: Math.round(showers * 100) / 100,
                snowfall: Math.round(snowfall * 100) / 100,
                uvIndex: daily?.uv_index_max?.[0] || 0,
                rawConditionId: weatherCode,
                icon: mapOpenMeteoIcon(weatherCode, true),
                weatherQuality: { comfortLevel: getComfortLevel(Math.round(temp), humidity || 50, windSpeed || 0) },
                timestamp: new Date(hourly.time[currentIndex]).getTime()
            };
        }
    }

    // Extract past hours if requested
    let past = [];
    if (options.pastHours > 0 && currentIndex >= 0) {
        const pastStartIndex = Math.max(0, currentIndex - options.pastHours);
        for (let i = pastStartIndex; i < currentIndex; i++) {
            const temp = hourly.temperature_2m?.[i];
            if (temp !== undefined) {
                past.push({
                    temperature: Math.round(temp),
                    timestamp: new Date(hourly.time[i]).getTime()
                });
            }
        }
    }

    // Extract forecast hours if requested
    let forecast = [];
    if (options.forecastHours > 0 && currentIndex >= 0) {
        const forecastEndIndex = Math.min(hourly.time.length - 1, currentIndex + options.forecastHours);
        for (let i = currentIndex + 1; i <= forecastEndIndex; i++) {
            const temp = hourly.temperature_2m?.[i];
            if (temp !== undefined) {
                forecast.push({
                    temperature: Math.round(temp),
                    timestamp: new Date(hourly.time[i]).getTime()
                });
            }
        }
    }

    // Extract minutely data if available
    let minutelyData = [];
    if (minutely && minutely.time) {
        for (let i = 0; i < minutely.time.length; i++) {
            const temp = minutely.temperature_2m?.[i];
            if (temp !== undefined) {
                minutelyData.push({
                    temperature: Math.round(temp),
                    timestamp: new Date(minutely.time[i]).getTime()
                });
            }
        }
    }

    // Extract weekly forecast if requested
    let weekly = [];
    if (includeWeekly && daily) {
        for (let i = 0; i < daily.time.length; i++) {
            const date = daily.time[i];
            const tempMin = daily.temperature_2m_min?.[i];
            const tempMax = daily.temperature_2m_max?.[i];
            const weatherCode = daily.weather_code?.[i];
            const precip = daily.precipitation_sum?.[i] || 0;
            const rain = daily.rain_sum?.[i] || 0;
            const showers = daily.showers_sum?.[i] || 0;
            const snowfall = daily.snowfall_sum?.[i] || 0;
            const windSpeed = daily.wind_speed_10m_max?.[i];
            const windGust = daily.wind_gusts_10m_max?.[i];
            const windDirection = daily.wind_direction_10m_dominant?.[i];
            const pressure = daily.pressure_msl_mean?.[i];
            const surfacePressure = daily.surface_pressure_mean?.[i];
            const humidity = daily.relative_humidity_2m_mean?.[i];
            const uvIndex = daily.uv_index_max?.[i];

            if (tempMin !== undefined && tempMax !== undefined) {
                weekly.push({
                    date: date,
                    temperature: {
                        min: Math.round(tempMin),
                        max: Math.round(tempMax),
                        avg: Math.round((tempMin + tempMax) / 2)
                    },
                    condition: mapOpenMeteoCondition(weatherCode || 800),
                    precipitation: {
                        total: Math.round(precip * 100) / 100,
                        rain: Math.round(rain * 100) / 100,
                        showers: Math.round(showers * 100) / 100,
                        snowfall: Math.round(snowfall * 100) / 100
                    },
                    wind: {
                        maxSpeed: windSpeed !== undefined ? Math.round(windSpeed * 10) / 10 : 0,
                        maxGust: windGust !== undefined ? Math.round(windGust * 10) / 10 : 0,
                        dominantDirection: windDirection !== undefined ? Math.round(windDirection) : 0
                    },
                    pressure: pressure !== undefined ? Math.round(pressure) : 1013,
                    surfacePressure: surfacePressure !== undefined ? Math.round(surfacePressure) : undefined,
                    humidity: humidity !== undefined ? Math.round(humidity) : 50,
                    uvIndex: uvIndex || 0,
                    weatherCode: weatherCode || 800
                });
            }
        }
    }

    return {
        current,
        past,
        forecast,
        minutely: minutelyData,
        weekly,
        location: {
            latitude: data.latitude,
            longitude: data.longitude,
            timezone: data.timezone || 'UTC'
        }
    };
}

// Transform historical Open-Meteo data
function transformOpenMeteoHistoricalData(data, options) {
    if (!data || !data.daily) {
        throw new Error('Invalid historical weather data structure');
    }

    const daily = data.daily;
    const statistics = calculateHistoricalStatistics(daily);

    // Convert daily data to our format
    const dailyData = [];
    for (let i = 0; i < daily.time.length; i++) {
        const date = daily.time[i];
        const tempMin = daily.temperature_2m_min?.[i];
        const tempMax = daily.temperature_2m_max?.[i];
        const tempAvg = daily.apparent_temperature_mean?.[i];
        const weatherCode = daily.weather_code?.[i];
        const precip = daily.precipitation_sum?.[i] || 0;
        const rain = daily.rain_sum?.[i] || 0;
        const showers = daily.showers_sum?.[i] || 0;
        const snowfall = daily.snowfall_sum?.[i] || 0;
        const windSpeed = daily.wind_speed_10m_max?.[i];
        const windGust = daily.wind_gusts_10m_max?.[i];
        const windDirection = daily.wind_direction_10m_dominant?.[i];
        const pressure = daily.pressure_msl_mean?.[i];
        const surfacePressure = daily.surface_pressure_mean?.[i];
        const uvIndex = daily.uv_index_max?.[i];

        if (tempMin !== undefined && tempMax !== undefined) {
            dailyData.push({
                date: date,
                temperature: {
                    min: Math.round(tempMin),
                    max: Math.round(tempMax),
                    avg: tempAvg !== undefined ? Math.round(tempAvg) : Math.round((tempMin + tempMax) / 2)
                },
                condition: mapOpenMeteoCondition(weatherCode || 800),
                precipitation: {
                    total: Math.round(precip * 100) / 100,
                    rain: Math.round(rain * 100) / 100,
                    showers: Math.round(showers * 100) / 100,
                    snowfall: Math.round(snowfall * 100) / 100
                },
                wind: {
                    maxSpeed: windSpeed !== undefined ? Math.round(windSpeed * 10) / 10 : 0,
                    maxGust: windGust !== undefined ? Math.round(windGust * 10) / 10 : 0,
                    dominantDirection: windDirection !== undefined ? Math.round(windDirection) : 0
                },
                pressure: pressure !== undefined ? Math.round(pressure) : 1013,
                surfacePressure: surfacePressure !== undefined ? Math.round(surfacePressure) : undefined,
                uvIndex: uvIndex || 0,
                weatherCode: weatherCode || 800
            });
        }
    }

    return {
        timestamp: Date.now(),
        dataSource: 'Open-Meteo Historical API',
        location: {
            latitude: data.latitude,
            longitude: data.longitude,
            timezone: data.timezone || 'UTC'
        },
        dateRange: { start: options.startDate, end: options.endDate },
        daily: dailyData,
        statistics
    };
}

// Create fallback weather data
function createFallbackWeatherData(location, options, error) {
    console.warn(`Creating fallback weather data due to error: ${error.message}`);

    const now = new Date();
    const temperature = 20; // Default temperature
    const condition = 'clear sky';

    // Create realistic fallback data based on location and time
    const fallbackData = {
        current: {
            temperature: temperature,
            condition: condition,
            humidity: 50,
            pressure: 1013,
            visibility: 10000,
            windSpeed: 5,
            precipitation: 0,
            rain: 0,
            showers: 0,
            snowfall: 0,
            uvIndex: 5,
            rawConditionId: 0,
            icon: '01d',
            weatherQuality: { comfortLevel: 'comfortable' },
            timestamp: now.getTime(),
            dataSource: 'Fallback Data',
            location,
            error: error.message
        },
        past: [],
        forecast: [],
        minutely: [],
        weekly: [],
        location
    };

    return fallbackData;
}

// Get enhanced weather data
async function getEnhancedWeatherData(location, options = {}) {
    const cacheKey = `enhanced_${location.lat}_${location.lon}_${JSON.stringify(options)}`;

    return getCachedWeatherData(cacheKey, async () => {
        return getWeatherFromBestProvider(location, options);
    }, ENHANCED_WEATHER_CACHE_DURATION);
}

// Get current location
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
                timezone: accurateTimezone,
                source: 'config'
            };
        }
    } catch (error) {
        console.warn('Could not load secure config for location:', error.message);
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
                        timezone: getTimezoneByCoordinates(parseFloat(lat), parseFloat(lon)),
                        city: response.city,
                        country: response.country,
                        source: 'ipinfo'
                    };
                }
            }
        ];

        for (const service of services) {
            try {
                console.log(`📍 Trying location service: ${service.name}`);
                const response = await makeHttpsRequest(service.url);
                const location = service.parse(response);

                if (location.lat !== null && location.lon !== null &&
                    !isNaN(location.lat) && !isNaN(location.lon)) {
                    console.log(`📍 Location resolved via ${service.name}: ${location.lat}, ${location.lon}`);
                    return location;
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
            timezone: accurateTimezone,
            city: 'New York',
            country: 'US',
            source: 'fallback'
        };
    });
}

// Get client IP location
async function getClientIPLocation(clientIP) {
    try {
        console.log(`📍 Resolving location for IP: ${clientIP}`);

        // For now, use a simple IP geolocation service
        // In production, you might want to use a more robust service
        const response = await makeHttpsRequest(`https://ipapi.co/${clientIP}/json/`);
        const location = {
            lat: parseFloat(response.latitude),
            lon: parseFloat(response.longitude),
            timezone: getTimezoneByCoordinates(parseFloat(response.latitude), parseFloat(response.longitude)),
            city: response.city,
            country: response.country,
            source: 'ipapi'
        };

        console.log(`📍 Client IP location resolved: ${location.city}, ${location.country} (${location.lat}, ${location.lon})`);
        return location;
    } catch (error) {
        console.warn(`⚠️ Failed to resolve client IP location for ${clientIP}:`, error.message);
        // Fall back to current location
        return await getCurrentLocation();
    }
}

// Get holiday date
function getHolidayDate(holidayName) {
    // This is a simplified implementation
    // In a real application, you'd want a proper holiday calendar
    const currentYear = new Date().getFullYear();

    // Map common holidays to their typical dates
    const holidayDates = {
        'christmas': new Date(currentYear, 11, 25), // December 25
        'new_years': new Date(currentYear, 0, 1), // January 1
        'thanksgiving': new Date(currentYear, 10, 23), // November 23 (approximate)
        'easter': new Date(currentYear, 3, 4), // April 4 (approximate)
        'halloween': new Date(currentYear, 9, 31), // October 31
        'valentines_day': new Date(currentYear, 1, 14), // February 14
        'st_patricks_day': new Date(currentYear, 2, 17), // March 17
        'mothers_day': new Date(currentYear, 4, 14), // May 14 (approximate)
        'fathers_day': new Date(currentYear, 5, 19), // June 19 (approximate)
        'independence_day': new Date(currentYear, 6, 4), // July 4
        'labor_day': new Date(currentYear, 8, 4), // September 4 (approximate)
        'memorial_day': new Date(currentYear, 4, 30), // May 30 (approximate)
        'columbus_day': new Date(currentYear, 9, 9), // October 9 (approximate)
        'veterans_day': new Date(currentYear, 10, 11), // November 11
        'hanukkah': new Date(currentYear, 11, 7), // December 7 (approximate)
        'kwanzaa': new Date(currentYear, 11, 26), // December 26
        'diwali': new Date(currentYear, 10, 4), // November 4 (approximate)
        'tet': new Date(currentYear, 0, 29), // January 29 (approximate)
        'cinco_de_mayo': new Date(currentYear, 4, 5), // May 5
        'okanawa': new Date(currentYear, 7, 16) // August 16 (approximate)
    };

    return holidayDates[holidayName.toLowerCase()];
}

// Find closest holiday
function findClosestHoliday(targetDate) {
    const holidays = Object.keys(HOLIDAY_DATA).map(name => ({
        name: HOLIDAY_DATA[name].name,
        date: getHolidayDate(name),
        priority: HOLIDAY_DATA[name].priority
    })).filter(h => h.date);

    let closest = null;
    let minDiff = Infinity;

    for (const holiday of holidays) {
        const diff = Math.abs(holiday.date - targetDate);
        if (diff < minDiff) {
            minDiff = diff;
            closest = holiday;
        }
    }

    return closest;
}

// Detect seasonal holidays
function detectSeasonalHolidays(time) {
    const holidays = [];

    for (const [key, data] of Object.entries(HOLIDAY_DATA)) {
        const holidayDate = getHolidayDate(key);
        if (holidayDate) {
            const holidayTime = getCurrentTime(null, holidayDate.getHours(), holidayDate.getMinutes(), holidayDate);

            // Check if the holiday falls on the given date
            if (holidayTime.year === time.year &&
                holidayTime.month === time.month &&
                holidayTime.dayOfMonth === time.dayOfMonth) {
                holidays.push({
                    name: data.name,
                    season: data.season,
                    priority: data.priority
                });
            }
        }
    }

    // Sort by priority (higher priority first)
    holidays.sort((a, b) => b.priority - a.priority);

    return holidays;
}

// Get seasonal configuration
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

// Get current season
function getCurrentSeason(month, latitude = 0) {
    // Adjust for southern hemisphere (negate latitude for season calculation)
    const adjustedLatitude = latitude < 0 ? -latitude : latitude;

    // Northern vs Southern hemisphere season adjustment
    const isSouthern = latitude < 0;

    if (month >= 2 && month <= 4) { // Mar-May
        return isSouthern ? 'autumn' : 'spring';
    } else if (month >= 5 && month <= 7) { // Jun-Aug
        return isSouthern ? 'winter' : 'summer';
    } else if (month >= 8 && month <= 10) { // Sep-Nov
        return isSouthern ? 'spring' : 'autumn';
    } else { // Dec-Feb
        return isSouthern ? 'summer' : 'winter';
    }
}

// Map date to season
function mapDateToSeason(baseTime, targetSeason) {
    const year = baseTime.year;
    const currentSeason = getCurrentSeason(baseTime.month, 0); // Use 0 latitude for northern hemisphere default

    // Season date ranges (approximate)
    const seasonRanges = {
        'spring': { start: { month: 2, day: 21 }, end: { month: 5, day: 20 } }, // Mar 21 - Jun 20
        'summer': { start: { month: 5, day: 21 }, end: { month: 8, day: 20 } }, // Jun 21 - Sep 20
        'autumn': { start: { month: 8, day: 21 }, end: { month: 11, day: 19 } }, // Sep 21 - Dec 19
        'winter': { start: { month: 11, day: 20 }, end: { month: 2, day: 20 } }  // Dec 20 - Mar 20
    };

    const targetRange = seasonRanges[targetSeason];
    if (!targetRange) return baseTime;

    // Calculate position within current season (0-1)
    const currentRange = seasonRanges[currentSeason];
    let seasonStart, seasonEnd;

    if (currentSeason === 'winter') {
        // Winter spans year boundary
        seasonStart = new Date(year - 1, currentRange.start.month, currentRange.start.day);
        seasonEnd = new Date(year, currentRange.end.month, currentRange.end.day);
    } else {
        seasonStart = new Date(year, currentRange.start.month, currentRange.start.day);
        seasonEnd = new Date(year, currentRange.end.month, currentRange.end.day);
    }

    const currentDate = new Date(baseTime.year, baseTime.month, baseTime.dayOfMonth);
    const totalSeasonDays = (seasonEnd - seasonStart) / (1000 * 60 * 60 * 24);
    const daysIntoSeason = (currentDate - seasonStart) / (1000 * 60 * 60 * 24);

    const positionRatio = Math.max(0, Math.min(1, daysIntoSeason / totalSeasonDays));

    // Map to target season
    let targetStart, targetEnd, targetYear;

    if (targetSeason === 'winter') {
        // Winter spans year boundary
        targetStart = new Date(year - 1, targetRange.start.month, targetRange.start.day);
        targetEnd = new Date(year, targetRange.end.month, targetRange.end.day);
        targetYear = year;
    } else {
        targetStart = new Date(year, targetRange.start.month, targetRange.start.day);
        targetEnd = new Date(year, targetRange.end.month, targetRange.end.day);
        targetYear = year;
    }

    const targetDayOfYear = Math.round(targetStart.getTime() + positionRatio * (targetEnd.getTime() - targetStart.getTime() - 86400000)); // -1 day to avoid going past end
    const mappedDate = new Date(targetDayOfYear);

    return getCurrentTime(null, baseTime.hour, baseTime.minute, mappedDate);
}

// Main compileContext function
async function compileContext(dynamicConfig, clientIP = null) {
    // Extract parameters from dynamic config
    const {
        locked,
        optimize,
        creative,
        clothing,
        season,
        tod,
        weather,
        activity,
        action,
        location,
        compiled_prompt
    } = dynamicConfig;

    // Check if locked and we have existing context to reuse
    if (locked && compiled_prompt?.context) {
        console.log('🔒 Locked mode: Reusing context from previous stage');
        console.log(`🔍 Compiled prompt has context:`, {
            hasWeather: !!compiled_prompt.context.weather,
            hasTime: !!compiled_prompt.context.time,
            hasSeason: !!compiled_prompt.context.season
        });
        return compiled_prompt.context;
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

    // Get weather data
    let weatherData = null;
    let enhancedWeatherData = null; // Store enhanced weather data for analysis
    let isCustomWeather = false; // Track if custom weather is being used

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
                            heatIndex: forecastHeatIndex,
                            windChill: forecastWindChill,
                            uvWarnings: forecastUvWarnings,
                            comfortLevel: getComfortLevel(dailyTemperature, forecastToUse.humidity, forecastToUse.wind.maxSpeed),
                            dataSource: `Forecast (${forecastToUse.date})`,
                            timestamp: new Date(forecastToUse.date + 'T12:00:00').getTime(), // Midday timestamp
                            location: weeklyData.location
                        };

                        isCustomWeather = true;
                    }
                }
            } else {
                // Custom weather condition specified
                console.log(`🌤️ Using custom weather condition: "${weather}"`);
                isCustomWeather = true;

                // For custom weather, create a basic weather object with the specified condition
                weatherData = {
                    temperature: 20, // Default temperature for custom weather
                    condition: weather,
                    humidity: 50,
                    pressure: 1013,
                    visibility: 10000,
                    windSpeed: 5,
                    precipitation: 0,
                    rain: 0,
                    showers: 0,
                    snowfall: 0,
                    cloudCoverage: 50,
                    uvIndex: 5,
                    dataSource: 'Custom Weather',
                    timestamp: Date.now(),
                    location: currentLocation || { lat: 0, lon: 0, timezone: 'UTC' }
                };
            }
        } else {
            // Standard weather fetching
            console.log('🌤️ Fetching current weather data');
            if (currentLocation) {
                try {
                    // Use enhanced weather data with current conditions
                    enhancedWeatherData = await getEnhancedWeatherData(currentLocation, {
                        includeCurrent: true,
                        pastHours: 2,
                        forecastHours: 1,
                        includeWeekly: false
                    });

                    if (enhancedWeatherData?.current) {
                        weatherData = enhancedWeatherData.current;
                        console.log(`🌤️ Current weather: ${weatherData.condition}, ${weatherData.temperature}°C`);
                    }
                } catch (error) {
                    console.warn('Failed to fetch weather data:', error.message);
                }
            }
        }
    }

    // Determine time period
    let timePeriod = null;
    if (baseTime) {
        timePeriod = determineTimePeriod(baseTime, currentLocation);
    }

    // Create context object with all gathered data
    const context = {
        time: baseTime,
        timePeriod: timePeriod,
        season: currentSeason,
        holidayInfo: holidayInfo,
        weather: weatherData,
        location: currentLocation ? {
            latitude: currentLocation.lat,
            longitude: currentLocation.lon,
            timezone: currentLocation.timezone,
            city: currentLocation.city,
            country: currentLocation.country
        } : null,
        creative: creative || false
    };

    return context;
}

// Get weekly weather forecast
async function getWeeklyWeatherForecast(location) {
    return getCachedWeatherData(`weekly_${location.lat}_${location.lon}`, async () => {
        const params = new URLSearchParams({
            latitude: location.lat,
            longitude: location.lon,
            daily: [
                'weather_code',
                'temperature_2m_max',
                'temperature_2m_min',
                'apparent_temperature_max',
                'apparent_temperature_min',
                'precipitation_sum',
                'rain_sum',
                'showers_sum',
                'snowfall_sum',
                'precipitation_hours',
                'wind_speed_10m_max',
                'wind_gusts_10m_max',
                'wind_direction_10m_dominant',
                'pressure_msl_mean',
                'surface_pressure_mean'
            ].join(','),
            timezone: 'auto'
        });

        const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

        try {
            const data = await makeHttpsRequest(url);

            // Transform to our format
            const weekly = data.daily.time.map((date, index) => ({
                date: date,
                temperature: {
                    min: Math.round(data.daily.temperature_2m_min[index]),
                    max: Math.round(data.daily.temperature_2m_max[index]),
                    avg: Math.round((data.daily.temperature_2m_min[index] + data.daily.temperature_2m_max[index]) / 2)
                },
                condition: mapOpenMeteoCondition(data.daily.weather_code[index]),
                precipitation: {
                    total: Math.round(data.daily.precipitation_sum[index] * 100) / 100,
                    rain: Math.round((data.daily.rain_sum?.[index] || 0) * 100) / 100,
                    showers: Math.round((data.daily.showers_sum?.[index] || 0) * 100) / 100,
                    snowfall: Math.round((data.daily.snowfall_sum?.[index] || 0) * 100) / 100
                },
                wind: {
                    maxSpeed: Math.round(data.daily.wind_speed_10m_max[index] * 10) / 10,
                    maxGust: Math.round((data.daily.wind_gusts_10m_max?.[index] || data.daily.wind_speed_10m_max[index]) * 10) / 10,
                    dominantDirection: Math.round(data.daily.wind_direction_10m_dominant?.[index] || 0)
                },
                pressure: Math.round(data.daily.pressure_msl_mean?.[index] || 1013),
                surfacePressure: Math.round(data.daily.surface_pressure_mean?.[index] || data.daily.pressure_msl_mean?.[index] || 1013),
                rawConditionId: data.daily.weather_code[index]
            }));

            return {
                weekly,
                location: {
                    latitude: data.latitude,
                    longitude: data.longitude,
                    timezone: data.timezone
                }
            };
        } catch (error) {
            console.error('Open-Meteo weekly forecast error:', error);
            throw error;
        }
    }, 24 * 60 * 60 * 1000); // Cache for 24 hours
}

module.exports = {
    compileContext,
    getTimezoneByCoordinates,
    getCurrentLocation,
    getClientIPLocation
};
