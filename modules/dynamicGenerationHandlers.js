// Dynamic Generation Handler Functions
// Handles intelligent prompt modification based on real-world context (time, weather, etc.)

const https = require('https');
const tzLookup = require('tz-lookup');
const geo2city = require('geo2city');

const { determineTimePeriod, getSunriseSunset } = require('./dynamicGenerationHandlers.timeCalc');
const ClothingDatabase = require('./clothingDatabase');
const { matchCommaTextColon } = require('./promptTextBoundary');
const { generatePromptHash, generateRequestHash, generateDirectiveHash } = require('./dynamicGenerationHandlers.hash');

let __runtimeGr = null;
function bindRuntimeGlobalResources(globalResources) {
    __runtimeGr = globalResources;
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
 * Helper function to extract sessionId from ws connection
 * Uses WebSocketServer to get client info
 */
function getSessionIdFromWs(ws) {
    if (!ws) return null;
    try {
        const wsServer = __runtimeGr.getWebSocketServer();
        if (wsServer && wsServer.clients) {
            const clientInfo = wsServer.clients.get(ws);
            return clientInfo ? clientInfo.sessionId : null;
        }
    } catch (error) {
        // WebSocket server not available
    }
    return null;
}

/**
 * Helper function to send progress updates via plumbing system
 * Replaces handler.sendToClient(ws, ...) pattern
 * Also stores requestId -> sessionId mapping for routing
 */
function sendProgressUpdate(requestId, updateData, ws = null, sessionId = null) {
    try {
        const plumbing = __runtimeGr.getDataPlumbing();
        
        // Extract sessionId from ws if not provided
        if (!sessionId && ws) {
            sessionId = getSessionIdFromWs(ws);
        }
        
        // Store requestId -> sessionId mapping if we have both (for routing)
        if (sessionId && requestId) {
            plumbing.set(`request:${requestId}`, { sessionId }, {
                temporary: true,
                ttl: 60 * 60 * 1000, // 1 hour TTL
                category: 'websocket',
                tags: ['request', 'routing']
            });
        }
        
        plumbing.publish('ws:progress:update', {
            requestId,
            ...updateData
        });
    } catch (error) {
        // Plumbing or globalResources not initialized, skip update
    }
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

// Weather provider - Open-Meteo API (free, no API key required)
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
        0: 'none',
        1: 'few clouds',
        2: 'partly cloudy',
        3: 'cloudy',
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
 * @param {boolean} isDay - Whether it's daytime (default: true)
 * @returns {string} Accurate condition based on cloud coverage and weather code
 */
function reconcileConditionWithCloudCover(condition, cloudCover, isDay = true) {
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
        // At night: translate to moon/stars visibility instead of cloud terms
        // Clear = moon/stars visible, Cloudy = moon/stars NOT visible
        if (!isDay) {
            switch (condition) {
                case 'none':
                    return 'clear starry night sky with moon';
                case 'few clouds':
                    return 'mostly clear night sky with moon';
                case 'partly cloudy':
                    return 'partly clear night sky';
                case 'cloudy':
                    return 'obscured night sky with faint moon glow';
                default:
                    return 'clear starry night sky with moon';
            }
        }
        
        // Daytime: use detailed cloud condition names
        if (cloudCover >= 90) return 'cloudy';
        if (cloudCover >= 80) return 'mostly cloudy';
        if (cloudCover >= 60) return 'partly cloudy';
        if (cloudCover >= 30) return 'mostly clear';
        if (cloudCover >= 10) return 'few clouds';
        return 'clear';
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

        // Cloudy sky/cloudy
        3: `04${dayNight}`, // cloudy sky

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
    __runtimeGr.getLogger().verbose(`🌍 Weather timezone (${timezoneSource}): ${result.location.timezone}, coords: (${rawData.latitude.toFixed(4)}, ${rawData.longitude.toFixed(4)})`);

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

        // Determine if it's day or night based on current time
        // Use a simple heuristic: day is roughly 6 AM to 8 PM (6-20 hours)
        const currentDate = customDate ? new Date(customDate) : new Date();
        const currentHour = currentDate.getHours();
        const isDay = currentHour >= 6 && currentHour < 20;

        const baseCondition = mapOpenMeteoCondition(rawData.current.weather_code);
        const reconciledCondition = reconcileConditionWithCloudCover(baseCondition, cloudCover, isDay);

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
            condition: baseCondition, // For client display (original condition name, e.g., "overcast", "cloudy")
            generationCondition: reconciledCondition, // For SI generation (translated, e.g., "cloudy sky" or night descriptions)
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
            isDay,
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

            // Determine if it's day or night for this hourly data point
            const hourlyDate = new Date(timestamp);
            const hourlyHour = hourlyDate.getHours();
            const hourlyIsDay = hourlyHour >= 6 && hourlyHour < 20;

            const hourlyBaseCondition = mapOpenMeteoCondition(rawData.hourly.weather_code[i]);
            const hourlyReconciledCondition = reconcileConditionWithCloudCover(hourlyBaseCondition, rawData.hourly.cloud_cover[i], hourlyIsDay);

            hourlyData.push({
                timestamp,
                temperature: hourlyTemp,
                humidity: rawData.hourly.relative_humidity_2m[i],
                dewPoint: Math.round(rawData.hourly.dewpoint_2m[i] * 10) / 10,
                feelsLike: Math.round(rawData.hourly.apparent_temperature[i] * 10) / 10,
                condition: hourlyBaseCondition,
                generationCondition: hourlyReconciledCondition,
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
 * Retrieves and analyzes weather data for SI model enhancement
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

    __runtimeGr.getLogger().detailed('🌤️ Retrieving weather analysis...');

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
            __runtimeGr.getLogger().verbose(`📊 Getting current weather with ${pastHours}hr past + ${forecastHours}hr future...`);
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
        __runtimeGr.getLogger().verbose('🔍 Generating comprehensive weather analysis...');
        results.analysis = generateComprehensiveAnalysis(results);

        __runtimeGr.getLogger().verbose('✅ Weather analysis complete');
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

    // Generate SI prompting recommendations
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
 * Generate SI prompting recommendations
 * @param {Object} analysis - Weather analysis
 * @param {Object} weatherData - Raw weather data
 * @returns {Array} SI prompting recommendations
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
            recommendations.push('Cloudy sky conditions: diffused lighting, muted colors, cool tones, no warm/golden lighting, potential for rain, lower visibility');
        } else if (current.cloudCover > 50) {
            recommendations.push('Partly cloudy conditions: filtered lighting, reduced warm tones, muted colors');
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
    MINIMAL: { level: 'minimal', description: 'add a few elements that blend naturally with the scene and hint at the holiday', multiplier: 0.1 },
    EARLY: { level: 'early', description: 'add multiple elements of the holiday without overwhelming the scene', multiplier: 0.3 },
    BUILDING: { level: 'building', description: 'multiple elements of the holiday changing the atmosphere of the scene', multiplier: 0.5 },
    STRONG: { level: 'strong', description: 'add prominent elements of the holiday without overwhelming the scene', multiplier: 0.75 },
    PEAK: { level: 'peak', description: 'fully immerse the holiday into the scene and change elements to fit the holiday', multiplier: 1.0 },
    EXTENDED: { level: 'extended', description: 'add prominent elements of the holiday without overwhelming the scene', multiplier: 0.8 },
    FADING: { level: 'fading', description: 'add a few elements that blend naturally with the scene and hint the end of the holiday', multiplier: 0.2 }
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
    10: 'Christmas',
    11: 'New Year\'s',
    12: 'Halloween',
    13: 'Thanksgiving',
    14: 'Independence Day',
    15: 'Valentine\'s Day',
    16: 'Easter',
    17: 'Chinese New Year',
    18: 'Setsubun',
    19: 'Hinamatsuri',
    20: 'Summer Festival',
    21: 'Japanese New Year',
    22: 'Cherry Blossom',
    23: 'Star Festival',
    24: 'Golden Week',
    25: 'Children\'s Day',
    26: 'Mid-Autumn Festival',
    27: 'Obon Festival'
};

/**
 * Centralized holiday data for consistent maintenance and usage
 * Contains all holiday information including dates, buffers, and visual elements
 */
const HOLIDAY_DATA = {
    // Global Holidays
    10: { // Christmas
        name: 'Christmas',
        region: 'US',
        priority: 5,
        bufferDays: 21,
        dateLogic: (month, dayOfMonth) => month === 11 && dayOfMonth >= 9 && dayOfMonth <= 30,
        targetMonth: 11,
        targetDay: 25,
        decorations: 'christmas tree, santa claus, merry christmas, christmas, mistletoe, santa costume, holiday lights, wreaths, ornaments, stockings, snowflakes, candles, garlands, bells, decorated pine trees, nativity scenes, advent calendars, poinsettia, holly berries, candy canes, ribbon bows, gift boxes, wrapped presents, christmas cookies, snow-covered scenes, fireplace, christmas cards',
        atmosphere: 'festive, warm, magical, cozy, joyful, merry, celebratory, peaceful, winter scenes, candlelit rooms, decorated spaces',
        colors: 'red, green, gold, white, silver, deep blue, crimson, emerald, candlelight yellow, twinkling lights, white',
        activities: 'gift giving, holiday meals, singing, festive celebrations, decorating trees, wrapping presents, baking cookies, watching movies, building snowmen, ice skating, singing, lighting candles, opening presents, setting up decorations'
    },
    11: { // Western New Year
        name: 'New Year\'s',
        region: 'US',
        priority: 4,
        bufferDays: 14,
        dateLogic: (month, dayOfMonth) => (month === 11 && dayOfMonth >= 26) || (month === 0 && dayOfMonth <= 9),
        targetMonth: 0,
        targetDay: 1,
        decorations: 'fireworks, countdown clocks, party hats, streamers, confetti cannons, balloons, banners, disco balls, rooftop launch pads, champagne towers, year numbers displayed, sparklers, noisemakers, glitter, festive banners, celebratory signs, illuminated displays, midnight countdown displays, champagne glasses, party decorations',
        atmosphere: 'celebratory, energetic, exciting, vibrant, joyous, anticipatory, dynamic, party atmosphere, fireworks displays, crowded celebrations',
        colors: 'gold, silver, white, black, metallic accents, bright yellow, shimmering silver, midnight blue, vibrant purple, electric blue, neon highlights',
        activities: 'countdowns, celebrations, fireworks displays, midnight toasts, rooftop viewing parties, street festivals, televised ball drops, watching fireworks, attending parties, kissing at midnight, dancing, singing, drinking champagne, throwing confetti, lighting sparklers'
    },
    12: { // Halloween
        name: 'Halloween',
        region: 'US',
        priority: 5,
        bufferDays: 14,
        dateLogic: (month, dayOfMonth) => (month === 9 && dayOfMonth >= 20) || (month === 10 && dayOfMonth <= 3),
        targetMonth: 9,
        targetDay: 31,
        decorations: 'jack-o\'-lantern, trick or treat, happy halloween, halloween, ghosts, witches, bats, cobwebs, spooky lights, haunted houses, carved pumpkins, skeletons, tombstones, spider webs, black cats, cauldrons, broomsticks, monster masks, eerie shadows, fog machines, orange string lights, candy bowls, trick-or-treat buckets, costume accessories, halloween decorations, spooky props',
        atmosphere: 'mysterious, spooky, playful fright, autumn evening, thrilling, eerie, darkly festive, whimsically scary, fun-loving, creatively macabre, dimly lit scenes, shadowy environments',
        colors: 'orange, black, purple, green, white accents, deep orange, midnight black, eerie purple, lime green, blood red, pale yellow candlelight, shadowy gray',
        activities: 'trick-or-treating, costume parties, cosplay, haunted houses, pumpkin carving, spooky events, candy trading, dressing up in costumes, going door-to-door, watching horror movies, decorating homes, attending halloween parties, bobbing for apples, visiting haunted attractions, making halloween treats, costume contests, neighborhood gatherings, wearing costumes'
    },
    13: { // Thanksgiving
        name: 'Thanksgiving',
        region: 'US',
        priority: 4,
        bufferDays: 10,
        dateLogic: (month, dayOfMonth) => month === 10 && dayOfMonth >= 15 && dayOfMonth <= 25,
        targetMonth: 10,
        targetDay: 23,
        decorations: 'thanksgiving, roasted turkey (food), autumn leaves, cornucopias, harvest displays, gourds, fall centerpieces, pies, food platters, fall wreaths, overflowing dining tables, seasonal floral arrangements, acorns, wheat sheaves, rustic table settings, candlelit dinners, family heirlooms on display, harvest baskets, pumpkins, squash, autumn decorations, traditional table settings, festive centerpieces',
        atmosphere: 'warm, thankful, harvest celebration, family gathering, grateful, cozy, food-centric, nostalgic, homey, abundant, welcoming, traditional, intergenerational connection, comfort, appreciation, togetherness, heartwarming, generous, community-spirited, reflective, celebratory',
        colors: 'orange, brown, yellow, gold, deep reds, burgundy, earth tones, amber, rust, burnt sienna, cream, warm neutrals, harvest oranges, autumn browns, golden yellows, deep burgundies, warm creams',
        activities: 'family dinners, cooking together, preparing traditional recipes, sharing gratitude, watching football games, Thanksgiving parades, playing board games, taking family photos, sharing stories, enjoying dessert, relaxing after the meal, helping with cleanup, setting the table, carving the turkey, passing dishes around the table, harvest celebration, expressing thanks, sharing meals, family traditions, cooking feasts, gathering together, celebrating abundance'
    },
    14: { // Independence Day
        name: 'Independence Day',
        region: 'US',
        priority: 4,
        bufferDays: 7,
        dateLogic: (month, dayOfMonth) => (month === 5 && dayOfMonth >= 29) || (month === 6 && dayOfMonth <= 6),
        targetMonth: 6,
        targetDay: 4,
        decorations: 'fireworks, american flag, sparklers, red white blue streamers, parade floats, block party lights, picnic table spreads, patriotic banners, star-spangled decorations, red white and blue displays, festive decorations, summer party setups, patriotic motifs, flags displayed, bunting, red white blue decorations',
        atmosphere: 'patriotic, celebratory, summer fun, backyard block party energy, vibrant, energetic, festive, outdoor celebrations, summer scenes, crowded gatherings',
        colors: 'red, white, blue, gold accents, bright red, pure white, deep blue',
        activities: 'fireworks displays, barbecues, sparklers, parade marches, backyard games, rooftop viewing parties, lakeside gatherings, patriotic concerts, late-night parties, watching fireworks, grilling, outdoor celebrations, summer festivities, patriotic celebrations, enjoying summer weather, waving flags'
    },
    15: { // Valentine's Day
        name: 'Valentine\'s Day',
        region: 'US',
        priority: 4,
        bufferDays: 7,
        dateLogic: (month, dayOfMonth) => month === 1 && dayOfMonth >= 9 && dayOfMonth <= 16,
        targetMonth: 1,
        targetDay: 14,
        decorations: 'valentine, happy valentine, heart-shaped chocolate, heart-shaped box, box of chocolates, roses, cupids, romantic candles, lace, pink ribbons, love letters, heart motifs, doves, winged cupid figures, romantic flowers, valentine cards, gift wrapping, romantic table settings, heart decorations, romantic lighting, chocolate making displays',
        atmosphere: 'romantic, loving, warm, affectionate, sweet, intimate, passionate, dreamy, sentimental, caring, devoted, candlelit scenes, romantic settings',
        colors: 'red, pink, white, gold, silver accents, deep rose, soft blush, creamy white, warm candlelight, romantic pastels, crimson, cherry red, rose gold',
        activities: 'romantic dinners, gift giving, love celebrations, date nights, affection displays, handwritten notes, exchanging chocolates, giving flowers, writing love letters, sharing special moments, making handmade gifts, chocolate making, romantic walks, candlelit dinners, expressing love, sharing heartfelt messages, celebrating relationships, creating memories together'
    },
    16: { // Easter
        name: 'Easter',
        region: 'US',
        priority: 4,
        bufferDays: 14,
        dateLogic: (month, dayOfMonth) => (month === 2 && dayOfMonth >= 15) || (month === 3 && dayOfMonth <= 25),
        targetMonth: 3,
        targetDay: 12,
        decorations: 'easter, easter egg, decorated eggs, bunnies, spring flowers, baskets, chicks, spring blossoms, easter lilies, easter baskets, easter bunny, spring decorations, floral arrangements, ribbons, easter bonnets, spring wreaths, decorative nests, colorful eggs, springtime motifs, easter decorations, flower arrangements',
        atmosphere: 'renewal, fresh, joyful, spring awakening, uplifting, bright, cheerful, optimistic, peaceful, celebratory, nature-focused, spring scenes, outdoor settings',
        colors: 'yellow, white, green, lavender, pink, soft blue, mint green, peach, butter yellow, spring green, purple, cream, light coral',
        activities: 'egg hunts, spring celebrations, family gatherings, sunrise services, brunch feasts, spring festivals, decorating eggs, easter egg hunting, attending church services, family brunches, spring picnics, nature walks, flower picking, sharing easter baskets, springtime photography, enjoying spring weather, hunting for eggs'
    },
    17: { // Chinese New Year
        name: 'Chinese New Year',
        region: 'Asia',
        priority: 5,
        bufferDays: 18,
        dateLogic: (month, dayOfMonth) => (month === 0 && dayOfMonth >= 20) || (month === 1 && dayOfMonth <= 20),
        targetMonth: 1,
        targetDay: 5,
        decorations: 'chinese new year, lion dance, dragon dance, hongbao, firecrackers, fireworks, dao fu, nian (mythology), lanterns, red envelopes, festive banners, zodiac motifs, red couplets, paper cuttings, kumquat trees, tangerines, red decorations, auspicious symbols, calligraphy scrolls, red paper lanterns, dragon and lion costumes, red decorations displayed',
        atmosphere: 'celebratory, energetic, vibrant, prosperous, joyful, festive, crowded celebrations, lantern-lit scenes, parade scenes',
        colors: 'red, gold, black, jade green, lantern glow, bright crimson, gold, deep black, emerald green, warm yellow, metallic gold',
        activities: 'dumpling feasts, lantern festivals, lion dances, dragon parades, hongbao gifting, temple visits, family reunions, exchanging red envelopes, watching performances, visiting relatives, setting off firecrackers, enjoying traditional foods, community gatherings, eating dumplings, watching parades'
    },
    18: { // Setsubun
        name: 'Setsubun',
        region: 'Japan',
        priority: 3,
        bufferDays: 4,
        dateLogic: (month, dayOfMonth) => month === 1 && dayOfMonth >= 1 && dayOfMonth <= 5,
        targetMonth: 1,
        targetDay: 3,
        decorations: 'setsubun, mamemaki, makizushi, masu, oni masks, roasted soybeans, seasonal lanterns, wooden boxes, oni decorations, ritual items, protective charms, seasonal arrangements, soybeans displayed',
        atmosphere: 'playful, ritualistic, lively home celebration, protective, family-oriented, festive, energetic, indoor celebrations',
        colors: 'red, white, gold, wood brown, deep red, warm white, golden yellow, earthy brown',
        activities: 'bean throwing, ehomaki eating, doorway charms, family gatherings, mamemaki ritual, eating uncut sushi rolls, throwing beans, wearing oni masks, eating sushi rolls'
    },
    19: { // Hinamatsuri
        name: 'Hinamatsuri',
        region: 'Japan',
        priority: 3,
        bufferDays: 5,
        dateLogic: (month, dayOfMonth) => month === 2 && dayOfMonth >= 1 && dayOfMonth <= 5,
        targetMonth: 2,
        targetDay: 3,
        decorations: 'hinamatsuri, hina ningyou, hishimochi, doll platforms, peach blossoms, paper lanterns, ceremonial screens, ornamental dolls, tiered displays, peach flower arrangements, paper decorations, ceremonial items, spring floral displays, doll displays',
        atmosphere: 'elegant, protective, springtime, family focused, graceful, refined, celebratory, beautiful, indoor displays, spring scenes',
        colors: 'pink, white, gold, lacquer black, sakura pink, pure white, warm gold, deep black, spring green, lavender',
        activities: 'doll displays, tea gatherings, amazake sipping, spring photo sessions, displaying hina dolls, tea ceremonies, family celebrations, enjoying traditional foods, springtime gatherings, taking photos with displays, drinking tea, viewing dolls'
    },
    20: { // Summer Festival
        name: 'Summer Festival',
        region: 'Japan',
        priority: 4,
        bufferDays: 20,
        dateLogic: (month, dayOfMonth) => (month === 6 && dayOfMonth >= 10) || (month === 7 && dayOfMonth <= 31),
        targetMonth: 6,
        targetDay: 20,
        decorations: 'summer festival, aerial fireworks, goldfish scooping, bagged fish, shooting gallery, paper lanterns, yukata stalls, festival food carts, festival decorations, yukata displayed',
        atmosphere: 'lively, humid evening, firework filled, community carnival, outdoor evening scenes, crowded festivals',
        colors: 'navy, indigo, lantern gold, white, vibrant colors',
        activities: 'yukata wearing, festival games, taiko performances, street food eating, fireworks watching, night river walks, playing games, eating street food, watching fireworks, wearing yukata'
    },

    // Japanese Holidays (existing)
    21: { // Japanese New Year
        name: 'Japanese New Year',
        region: 'Japan',
        priority: 4,
        bufferDays: 2,
        dateLogic: (month, dayOfMonth) => isWithinBuffer(0, 1, 2) || (month === 0 && dayOfMonth <= 3),
        targetMonth: 0,
        targetDay: 1,
        decorations: 'kadomatsu, kagami mochi, shimekazari, mochitsuki setups, nengajou, bamboo decorations, pine branches, new year motifs, shrine ornaments, decorations displayed',
        atmosphere: 'solemn, family-oriented, auspicious, shrine visits, family gatherings, early morning scenes',
        colors: 'red, white, gold, black, wood brown',
        activities: 'hatsumode temple visits, family gatherings, mochitsuki rice pounding, nengajou writing, first sunrise watching, visiting temples, pounding rice, writing cards, watching sunrise'
    },
    22: { // Cherry Blossom
        name: 'Cherry Blossom',
        region: 'Japan',
        priority: 4,
        bufferDays: 10,
        dateLogic: (month, dayOfMonth) => (month === 2 && dayOfMonth >= 20) || (month === 3 && dayOfMonth <= 20),
        targetMonth: 3,
        targetDay: 15, // Approximate
        decorations: 'cherry blossoms, hanami, pink petals, picnic setups, lanterns, floral arrangements, tatami picnic mats, sake sets, paper fans, sakura trees, falling petals, picnic blankets, bento boxes, seasonal decorations, petal displays, spring motifs, nature arrangements',
        atmosphere: 'serene, beautiful, ephemeral, celebratory, peaceful, romantic, tranquil, nature-connected, aesthetically pleasing, outdoor picnic scenes, petal-filled scenes',
        colors: 'pink, white, light green, sakura pink, cherry blossom pink, soft white, spring green, lavender',
        activities: 'hanami picnics, cherry blossom viewing, photography, festivals, rooftop tea gatherings, petal shower walks, sitting under sakura trees, enjoying seasonal foods, picnics, taking photos, writing haiku, enjoying sake, springtime celebrations, eating bento, drinking sake'
    },
    23: { // Tanabata
        name: 'Star Festival',
        region: 'Japan',
        priority: 3,
        bufferDays: 3,
        dateLogic: (month, dayOfMonth) => isWithinBuffer(6, 7, 3) || (month === 6 && dayOfMonth >= 4 && dayOfMonth <= 10),
        targetMonth: 6,
        targetDay: 7,
        decorations: 'tanabata, tanzaku, colorful paper strips, bamboo branches, stars, wishes, lanterns, summer motifs, wish papers, decorated bamboo, star decorations, summer festival displays, colorful streamers, traditional decorations, celestial motifs',
        atmosphere: 'romantic, magical, celebratory, summer evening, dreamy, festive, starry, warm summer nights, outdoor evening scenes',
        colors: 'blue, gold, red, white, starry night colors, deep blues, golden yellows, vibrant reds, pure whites, starry purples, summer sky blues, warm lantern glows',
        activities: 'wish writing, lantern displays, festivals, romance celebrations, summer events, writing wishes on tanzaku, hanging decorations on bamboo, stargazing, attending festivals, celebrating the meeting of stars, enjoying summer festivities, traditional celebrations, making wishes, community gatherings'
    },
    24: { // Golden Week
        name: 'Golden Week',
        region: 'Japan',
        priority: 4,
        bufferDays: 7,
        dateLogic: (month, dayOfMonth) => (month === 3 && dayOfMonth >= 29) || (month === 4 && dayOfMonth <= 5),
        targetMonth: 4,
        targetDay: 29,
        decorations: 'banners, family crests, seasonal flowers, travel motifs, scrolls, calligraphy displayed, foliage, carp streamers, decorations displayed',
        atmosphere: 'celebratory, relaxed, family-oriented, joyful, restful, travel scenes, outdoor activities, family gatherings',
        colors: 'red, white, gold, green, spring green, carp streamer colors',
        activities: 'travel, family visits, festivals, cherry blossom viewing, shrine visits, theme park trips, countryside getaways, nature hikes, visiting places, attending festivals'
    },
    25: { // Children's Day
        name: 'Children\'s Day',
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
        decorations: 'koinobori, koinobori carp streamers, samurai dolls, iris flowers, traditional toys, warrior imagery, colorful carp flags, traditional displays, iris arrangements, warrior helmets, protective charms, family decorations, traditional motifs',
        atmosphere: 'celebratory, protective, family-oriented, proud, joyful, nurturing, strength-focused, growth-oriented, family-centered, outdoor displays',
        colors: 'blue, white, red, gold, natural tones, vibrant blues, pure whites, bright reds, warm golds, spring greens, traditional colors',
        activities: 'family celebrations, carp streamer displays, traditional foods, child-focused events, displaying koinobori, family gatherings, enjoying traditional foods, celebrating children\'s growth, protective rituals, family traditions, honoring children, community celebrations'
    },
    26: { // Mid-Autumn
        name: 'Mid-Autumn Festival',
        region: 'Asia',
        priority: 2,
        bufferDays: 5,
        dateLogic: (month, dayOfMonth) => month === 8 && dayOfMonth >= 10 && dayOfMonth <= 20,
        targetMonth: 8,
        targetDay: 15, // Approximate
        decorations: 'mid-autumn festival, tsukimi, tsukimi dango, moon rabbit, susuki grass, mooncake, lantern on liquid, moon motifs, offerings displayed, harvest displays, full moon, mooncakes, lanterns, autumn decorations, harvest symbols, moon viewing setups',
        atmosphere: 'serene, natural beauty, lantern-lit calm, peaceful, family-centered, nature-connected, outdoor evening scenes, harvest scenes',
        colors: 'white, silver, gold, indigo, moonlit white, silvery gray, warm gold, deep indigo, autumn orange, harvest gold',
        activities: 'moon viewing, lantern floats, tea offerings, family reunions, tsukimi celebrations, enjoying mooncakes, family gatherings, viewing the full moon, harvest celebrations, sharing mooncakes, lantern displays, autumn festivities, eating mooncakes'
    },
    27: { // Obon
        name: 'Obon Festival',
        region: 'Japan',
        priority: 3,
        bufferDays: 5,
        dateLogic: (month, dayOfMonth) => month === 7 && dayOfMonth >= 10 && dayOfMonth <= 20,
        targetMonth: 7,
        targetDay: 15, // Approximate
        decorations: 'obon, lanterns, ancestor altars, white flowers, memorial displays, floating toro nagashi lanterns, bon fires, lanterns displayed, ancestor memorials, white chrysanthemums, decorations, festival displays',
        atmosphere: 'respectful, celebratory, family-centered, outdoor evening scenes, lantern-lit scenes, community gatherings',
        colors: 'white, gold, red, purple, pure white, warm gold, deep red, purple, lantern glow',
        activities: 'bon odori dancing, lantern displays, family gatherings, memorial services, toro nagashi send-offs, taiko drum circles, grave sweeping rituals, traditional dancing, floating lanterns, community festivals, family reunions, cultural celebrations, dancing, floating lanterns on water'
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
        'light rain': `gentle rain falling softly, light mist hanging in the air, slightly wet surfaces glistening, soft pattering sound, cloudy sky but not dark atmosphere`,
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
        'cloudy sky': `cloudy, diffused lighting, soft shadows, no direct sunlight, uniform cloud cover`,
        'windy': `howling${windDesc} raging violently, trees bent nearly horizontal, debris missiles flying lethally, faces battered by wind pressure, hair ripped like whips, clothes torn at seams, apocalyptic fury with deafening roar`,
        'calm': `gentle light breeze, minimal air movement, still atmosphere, peaceful conditions, stable air`,
        'sunny': `bright sunlight streaming down, clear sky, warm golden lighting, harsh defined shadows, clear visibility`,
        'cloudy': `cloudy, diffused lighting, soft shadows, cooler atmosphere, no direct sunlight`,
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
        'cloudy sky': `cloudy sky, diffused lighting, soft shadows, no direct sunlight, uniform cloud cover`,
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

        // Cloudy sky/cloudy conditions
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

        'cloudy sky': {
            temperature: { min: 0, max: 20, typical: 10 }, // Cool temperatures
            humidity: { min: 70, max: 100, typical: 85 }, // High humidity
            windSpeed: { min: 2, max: 12, typical: 5 }, // Light winds
            windDirection: { min: 0, max: 360, typical: 180 }, // Variable
            cloudCoverage: { min: 80, max: 100, typical: 95 }, // Cloudy skies
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
 * Expand shorthand tag sections to full keyword forms for SI processing
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
 * @param {string} selectText - The original select_text from SI
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

/**
 * Extract bias value from text if it has an emphasis group
 * Uses __runtimeGr.getLocalPromptOptimizer().parseEmphasis() which already exists
 * @param {string} text - The text to extract bias from
 * @returns {number|null} The bias value if found, null otherwise
 */
function extractBiasFromText(text) {
    if (!text || typeof text !== 'string') return null;

    const { hasManagedEmphasisGroupIds, listManagedEmphasisBlocks } = require('./emphasisGroupIdSyntax');
    if (hasManagedEmphasisGroupIds(text)) {
        const blocks = listManagedEmphasisBlocks(text);
        if (blocks.length >= 1 && blocks[0].start === 0 && Number.isFinite(blocks[0].textWeight)) {
            return blocks[0].textWeight;
        }
    }
    
    // Check if text starts with numeric emphasis pattern
    if (!/^(-?\d+\.?\d*)::/.test(text)) {
        return null;
    }
    
    // Use the same robust pattern as the emphasis highlighting system
    // This pattern uses negative lookahead to prevent matching across group boundaries
    // Pattern matches: number::content where content doesn't contain another number:: pattern
    // Terminates at: whitespace+number::, ::, or end of string
    const autoTerminatingPattern = /^(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::).)+?)(?=\s*-?\d+\.?\d*::|::|$)/;
    const autoTerminatingMatch = text.match(autoTerminatingPattern);
    
    if (autoTerminatingMatch) {
        // First group found (auto-terminating or consecutive groups)
        return parseFloat(autoTerminatingMatch[1]);
    }
    
    // Check for traditional complete group: number::content::
    const traditionalPattern = /^(-?\d+\.?\d*)::((?:(?!-?\d+\.?\d*::).)+?)::/;
    const traditionalMatch = text.match(traditionalPattern);
    
    if (traditionalMatch) {
        return parseFloat(traditionalMatch[1]);
    }
    
    // Fallback: try parsing with localPromptOptimizer for edge cases
    const parsed = __runtimeGr.getLocalPromptOptimizer().parseEmphasis(text);
    return parsed.weight;
}

/**
 * Check if text already has an emphasis group
 * @param {string} text - The text to check
 * @returns {boolean} True if text has an emphasis group
 */
function hasEmphasisGroup(text) {
    if (!text || typeof text !== 'string') return false;

    const { hasManagedEmphasisGroupIds } = require('./emphasisGroupIdSyntax');
    if (hasManagedEmphasisGroupIds(text)) return true;
    
    // Check for complete emphasis group: #.#::text::
    const completeGroupPattern = /^(-?\d+\.?\d*)::.+::$/s;
    if (completeGroupPattern.test(text)) return true;
    
    // Check for auto-terminating emphasis group: #.#::text
    const autoTerminatingPattern = /^(-?\d+\.?\d*)::/;
    if (autoTerminatingPattern.test(text)) return true;
    
    return false;
}

/**
 * Apply Rentan modifications (Should have been compiled from Tanei → Tendai) to content.
 * 
 * ⚠️ IMPORTANT: This function expects well-deconflicted Tendai.
 * All overlap detection, type conversion, and segment index adjustments should be handled
 * by hydrateTextReplacements() (Tanei → Tendai) BEFORE calling this function.
 * 
 * This function focuses on the actual text replacement logic and flexible matching for
 * emphasis group variations (auto-termination handling).
 * 
 * @param {string} originalContent - The original content to modify
 * @param {Object} replacements - Well-deconflicted Tendai object (should have been hydrated from Tenei)
 * @param {string} targetType - Type of target ('prompt', 'uc', 'character')
 * @param {number} characterIndex - Character index if targetType is 'character'
 * @param {string} characterField - Character field ('prompt' or 'uc') if targetType is 'character'
 * @returns {Object} { success: boolean, result: string, failedReplacements: string[] }
 */
function applyDynamicReplacements(globalResources, originalContent, replacements, targetType = 'prompt', characterIndex = null, characterField = null) {
    bindRuntimeGlobalResources(globalResources);
    let result = originalContent || '';
    
    // Define the append marker constant (must match imageGeneration.js)
    const APPEND_MARKER = '__ENSHUTSUKA_APPEND_POINT__';
    const appendMarkerRegex = new RegExp(`\\s*,?\\s*${APPEND_MARKER}\\s*,?\\s*`, 'g');
    const stripAppendMarker = (text) => {
        if (typeof text !== 'string') return text;
        return text
            .replace(appendMarkerRegex, ', ')
            .replace(/,\s*,+/g, ', ')
            .replace(/^,\s*|\s*,$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    };

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

    // Separate replaces and appends to process in phases
    const replaces = [];
    const appends = [];
    
    allReplacements.forEach((replacement, index) => {
        const action = (replacement.action || 'replace').toLowerCase();
        if (action === 'append') {
            appends.push({ replacement, originalIndex: index });
        } else {
            replaces.push({ replacement, originalIndex: index });
        }
    });

    // Apply all replacements in order, allowing chaining but preventing exact duplicate applications
    const appliedReplacements = new Set();
    const failedReplacements = [];
    const replacementHistory = new Map(); // Track what was replaced with what
    const replacementMetadata = []; // Track which fallbacks were used

    // Phase 1: Apply all replaces first
    for (const { replacement } of replaces) {
        let { select_text, replace_text, action: rawAction = 'replace', count, is_critical = true, fallback_select_text, alternative_text, replacement_category, segment_emphasis } = replacement;
        // Normalize action to lowercase for consistency
        const action = typeof rawAction === 'string' ? rawAction.toLowerCase() : rawAction;
        
        // 🎨 NEWLINE TRANSLATION: Convert <br> to \n
        // SI uses <br> for readability anywhere newlines are needed, server translates to actual newlines
        if (replace_text) {
            replace_text = replace_text.replace(/<br\s*\/?>/gi, '\n');
        }
        
        // 🎯 BIAS HANDLING: Apply segment_emphasis or extract from selected text
        if (replace_text && (action === 'replace' || action === 'append')) {
            let biasToApply = null;
            
            // Priority 1: Use segment_emphasis parameter if set
            if (segment_emphasis !== null && segment_emphasis !== undefined) {
                biasToApply = segment_emphasis;
            } else if (select_text) {
                // Priority 2: Extract bias from selected text if it has emphasis groups
                const selectedBias = extractBiasFromText(select_text);
                if (selectedBias !== null) {
                    biasToApply = selectedBias;
                }
            }
            
            // Apply bias if we have one and replacement text doesn't already have an emphasis group
            if (biasToApply !== null && !hasEmphasisGroup(replace_text)) {
                replace_text = applyBiasToText(replace_text, biasToApply);
                console.log(`🎯 Applied bias ${biasToApply} to replacement text: "${replace_text.substring(0, 50)}${replace_text.length > 50 ? '...' : ''}"`);
            }
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
        const commaText = matchCommaTextColon(result);
        const textBoundaryIndex = commaText ? commaText.index : -1;
        
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
            __runtimeGr.getLogger().verbose(`🔄 Attempting replacement: "${trimmedSelectText}" → "${replace_text}"`);

            let index = -1;
            let textToReplace = trimmedSelectText;
            let usedFallback = false;
            let replacementApplied = false;
            
            // Handle granular replace if replace_part was specified (Tanei hydration to Tendai should have set this up)
            const replacePartTarget = replacement.replace_part_target;
            const replacePartAnchor = replacement.replace_part_anchor;
            if (replacePartTarget && replacePartAnchor && select_text) {
                // Find the anchor in working content
                const anchorIndex = workingContent.indexOf(replacePartAnchor);
                if (anchorIndex !== -1) {
                    // Find the target part after the anchor
                    const searchStart = anchorIndex + replacePartAnchor.length;
                    const searchText = workingContent.substring(searchStart, searchStart + 100); // Search next 100 chars
                    const targetIndex = searchText.indexOf(replacePartTarget);
                    
                    if (targetIndex !== -1) {
                        const actualTargetStart = searchStart + targetIndex;
                        const actualTargetEnd = actualTargetStart + replacePartTarget.length;
                        
                        // Replace just the target part
                        workingContent = workingContent.substring(0, actualTargetStart) +
                                replace_text +
                                workingContent.substring(actualTargetEnd);
                        
                        // Reconstruct result with boundary protection
                        result = hasBoundary ? workingContent + contentAfterBoundary : workingContent;
                        
                        // Track this replacement
                        replacementHistory.set(replacePartTarget, replace_text);
                        appliedReplacements.add(replacementKey);
                        replacementApplied = true;
                        
                        console.log(`🎯 Granular replace: replaced "${replacePartTarget}" with "${replace_text}" using anchor`);
                    }
                }
            }
            
            if (!replacementApplied) {
                // Normal full segment replacement
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
                        const textAfter = workingContent.substring(index + newText.length);
                        
                        // 🎯 AUTO-TERMINATION CHECK: If replace_text ends with :: and textAfter starts with number::,
                        // remove the terminator to allow auto-termination (consecutive groups)
                        let finalReplaceText = replace_text || '';
                        if (finalReplaceText.endsWith('::')) {
                            const afterTrimmed = textAfter.trim();
                            const nextGroupMatch = afterTrimmed.match(/^(-?\d+\.?\d*)::/);
                            if (nextGroupMatch) {
                                finalReplaceText = finalReplaceText.slice(0, -2);
                                console.log(`🎯 Auto-terminating emphasis group (next group detected: ${nextGroupMatch[1]}::)`);
                            }
                        }
                        
                        workingContent = workingContent.substring(0, index) +
                                finalReplaceText +
                                workingContent.substring(index + newText.length);
                        
                        // Update replacement history: the original maps to the final result
                        replacementHistory.set(trimmedSelectText, finalReplaceText);
                        appliedReplacements.add(replacementKey);
                        replacementApplied = true;
                        // Reconstruct result with boundary protection
                        result = hasBoundary ? workingContent + contentAfterBoundary : workingContent;
                    }
                } else if (index !== -1) {
                    // Normal replacement
                    const textAfter = workingContent.substring(index + trimmedSelectText.length);
                    
                    // 🎯 AUTO-TERMINATION CHECK: If replace_text ends with :: and textAfter starts with number::,
                    // remove the terminator to allow auto-termination (consecutive groups)
                    let finalReplaceText = replace_text || '';
                    if (finalReplaceText.endsWith('::')) {
                        const afterTrimmed = textAfter.trim();
                        const nextGroupMatch = afterTrimmed.match(/^(-?\d+\.?\d*)::/);
                        if (nextGroupMatch) {
                            // Next group detected - remove terminator to allow auto-termination
                            finalReplaceText = finalReplaceText.slice(0, -2); // Remove ::
                            console.log(`🎯 Auto-terminating emphasis group (next group detected: ${nextGroupMatch[1]}::)`);
                        }
                    }
                    
                    workingContent = workingContent.substring(0, index) +
                            finalReplaceText +
                            workingContent.substring(index + trimmedSelectText.length);

                    // Track this replacement
                    replacementHistory.set(trimmedSelectText, finalReplaceText);
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
                        const textAfter = workingContent.substring(index + trimmedFallback.length);
                        
                        // 🎯 AUTO-TERMINATION CHECK: If replace_text ends with :: and textAfter starts with number::,
                        // remove the terminator to allow auto-termination (consecutive groups)
                        let finalReplaceText = replace_text || '';
                        if (finalReplaceText.endsWith('::')) {
                            const afterTrimmed = textAfter.trim();
                            const nextGroupMatch = afterTrimmed.match(/^(-?\d+\.?\d*)::/);
                            if (nextGroupMatch) {
                                finalReplaceText = finalReplaceText.slice(0, -2);
                                console.log(`🎯 Auto-terminating emphasis group (next group detected: ${nextGroupMatch[1]}::)`);
                            }
                        }
                        
                        workingContent = workingContent.substring(0, index) +
                                finalReplaceText +
                                workingContent.substring(index + trimmedFallback.length);
                        
                        replacementHistory.set(trimmedFallback, finalReplaceText);
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
                        const textAfter = workingContent.substring(deconflict.index + deconflict.textToReplace.length);
                        
                        // 🎯 AUTO-TERMINATION CHECK: If replace_text ends with :: and textAfter starts with number::,
                        // remove the terminator to allow auto-termination (consecutive groups)
                        let finalReplaceText = replace_text || '';
                        if (finalReplaceText.endsWith('::')) {
                            const afterTrimmed = textAfter.trim();
                            const nextGroupMatch = afterTrimmed.match(/^(-?\d+\.?\d*)::/);
                            if (nextGroupMatch) {
                                finalReplaceText = finalReplaceText.slice(0, -2);
                                console.log(`🎯 Auto-terminating emphasis group (next group detected: ${nextGroupMatch[1]}::)`);
                            }
                        }
                        
                        workingContent = workingContent.substring(0, deconflict.index) +
                                finalReplaceText +
                                workingContent.substring(deconflict.index + deconflict.textToReplace.length);
                        
                        // Track this replacement - map the ORIGINAL select_text to the final replacement
                        replacementHistory.set(trimmedSelectText, finalReplaceText);
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
                        __runtimeGr.getLogger().verbose(`✅ Appended alternative text instead of replacing`);
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
            }
        }
        // Add metadata to tracking array for Phase 1
        replacementMetadata.push(metadata);
    }

    // Phase 2: Merge appends that select the same value (after replaces have been applied)
    // Group appends by what they're actually targeting (considering replacementHistory)
    const appendGroups = new Map(); // Map<actualTargetText, Array<{replacement, originalIndex}>>
    
    for (const { replacement, originalIndex } of appends) {
        const select_text = replacement.select_text;
        if (!select_text) {
            // Append-to-end - keep as-is, don't merge
            continue;
        }
        
        const trimmedSelect = select_text.trim();
        // Determine what text this append is actually targeting
        // If the select_text was replaced, use the replacement; otherwise use original
        const actualTargetText = replacementHistory.has(trimmedSelect) 
            ? replacementHistory.get(trimmedSelect) 
            : trimmedSelect;
        
        if (!appendGroups.has(actualTargetText)) {
            appendGroups.set(actualTargetText, []);
        }
        appendGroups.get(actualTargetText).push({ replacement, originalIndex });
    }
    
    // Merge appends that target the same final text
    const mergedAppends = [];
    const appendIndicesToSkip = new Set();
    
    for (const [targetText, appendList] of appendGroups.entries()) {
        if (appendList.length > 1) {
            // Multiple appends targeting the same value - merge them
            const mergedReplaceTexts = appendList
                .map(item => item.replacement.replace_text || '')
                .filter(t => t.trim());
            
            if (mergedReplaceTexts.length > 0) {
                const mergedReplaceText = mergedReplaceTexts.join(', ');
                
                // Use the first append as the base and merge replace_text
                const firstAppend = appendList[0];
                firstAppend.replacement.replace_text = mergedReplaceText;
                mergedAppends.push(firstAppend);
                
                // Mark other appends for skipping
                for (let i = 1; i < appendList.length; i++) {
                    appendIndicesToSkip.add(appendList[i].originalIndex);
                }
                
                console.log(`🔗 Merged ${appendList.length} appends targeting "${targetText}" into single append`);
            } else {
                // No valid replace_text, keep all as-is
                mergedAppends.push(...appendList);
            }
        } else {
            // Single append - keep as-is
            mergedAppends.push(appendList[0]);
        }
    }
    
    // Add appends that don't have select_text (append-to-end) - these are not merged
    for (const { replacement, originalIndex } of appends) {
        if (!replacement.select_text && !appendIndicesToSkip.has(originalIndex)) {
            mergedAppends.push({ replacement, originalIndex });
        }
    }
    
    // Sort merged appends by original index to maintain order
    mergedAppends.sort((a, b) => a.originalIndex - b.originalIndex);

    // Phase 3: Apply merged appends
    for (const { replacement } of mergedAppends) {
        let { select_text, replace_text, action: rawAction = 'replace', count, is_critical = true, fallback_select_text, alternative_text, replacement_category, segment_emphasis } = replacement;
        // Normalize action to lowercase for consistency
        const action = typeof rawAction === 'string' ? rawAction.toLowerCase() : rawAction;
        
        // 🎨 NEWLINE TRANSLATION: Convert <br> to \n
        // SI uses <br> for readability anywhere newlines are needed, server translates to actual newlines
        if (replace_text) {
            replace_text = replace_text.replace(/<br\s*\/?>/gi, '\n');
        }
        
        // 🎯 BIAS HANDLING: Apply segment_emphasis or extract from selected text
        if (replace_text && (action === 'replace' || action === 'append')) {
            let biasToApply = null;
            
            // Priority 1: Use segment_emphasis parameter if set
            if (segment_emphasis !== null && segment_emphasis !== undefined) {
                biasToApply = segment_emphasis;
            } else if (select_text) {
                // Priority 2: Extract bias from selected text if it has emphasis groups
                const selectedBias = extractBiasFromText(select_text);
                if (selectedBias !== null) {
                    biasToApply = selectedBias;
                }
            }
            
            // Apply bias if we have one and replacement text doesn't already have an emphasis group
            if (biasToApply !== null && !hasEmphasisGroup(replace_text)) {
                replace_text = applyBiasToText(replace_text, biasToApply);
                console.log(`🎯 Applied bias ${biasToApply} to replacement text: "${replace_text.substring(0, 50)}${replace_text.length > 50 ? '...' : ''}"`);
            }
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
        const commaText = matchCommaTextColon(result);
        const textBoundaryIndex = commaText ? commaText.index : -1;
        
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

        // Phase 3 only processes appends (delete and replace were handled in Phase 1)
        if (action !== 'append') {
            console.warn(`⚠️ Non-append action "${action}" found in Phase 3, skipping`);
            continue;
        }
        
        if (action === 'append') {
            __runtimeGr.getLogger().verbose(`📎 Attempting append: insert "${replace_text.substring(0, 50)}${replace_text.length > 50 ? '...' : ''}"${select_text ? ` after "${trimmedSelectText.substring(0, 30)}${trimmedSelectText.length > 30 ? '...' : ''}"` : ' at end'}`);

            let insertPosition;
            let usedFallback = false;
            let positionFound = false;
            let textToAppend = replace_text;
            
            // Check if this append has an anchor (from prefix overlap conversion or granular append)
            const anchorText = replacement.anchor_text;
            if (anchorText) {
                // This append was either:
                // 1. Converted from a replace with prefix overlap (anchor_text = overlapping prefix)
                // 2. Created with granular append (anchor_text = anchor position)
                // Find the anchor in the content and append after it
                const anchorIndex = workingContent.indexOf(anchorText);
                if (anchorIndex !== -1) {
                    insertPosition = anchorIndex + anchorText.length;
                    positionFound = true;
                    console.log(`🎯 Anchored append: inserting after anchor "${anchorText.substring(0, 30)}..."`);
                    
                    // If not critical and this was from prefix overlap conversion, 
                    // the anchor was just for positioning - don't auto-append
                    // The replace_text should already be set correctly by Tanei hydration
                    if (!is_critical && replacement.mitigations?.some(m => m.type === 'converted_to_append')) {
                        console.log(`   ℹ️  Non-critical anchored append - anchor preserved for positioning only`);
                    }
                }
            }
            
            // Normal append logic (if anchored append didn't already set position)
            if (!positionFound && select_text && select_text.trim()) {
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
                    __runtimeGr.getLogger().verbose(`📍 Found append marker, inserting before presets`);
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
            __runtimeGr.getLogger().verbose(`✅ Appended "${textToAppend.substring(0, 50)}${textToAppend.length > 50 ? '...' : ''}"${select_text ? (positionFound ? (usedFallback ? ' after fallback' : ` after "${trimmedSelectText.substring(0, 30)}..."`) : ' at end (fallback)') : ' at end'}`);
            
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
    // Always strip internal append marker before returning result text.
    result = stripAppendMarker(result);

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
function getSeasonalConfig(seasonal, time, currentLocation = null, disableHoliday = false) {
    // Default: no seasonal modifications
    if (!seasonal || seasonal === false || seasonal === 'false') {
        return { 
            enabled: false, 
            season: null, 
            holiday: null, 
            mappedBaseTime: time 
        };
    }

    let config = { enabled: true };
    let seasonName = null;
    let holiday = null;
    let mappedBaseTime = time;

    // Determine config type and initial season value
    if (seasonal === true || seasonal === 'true') {
        config.forced = false; // Current season detection
    } else if (typeof seasonal === 'number' && seasonal >= 1 && seasonal <= 4) {
        // Specific season override (1=Spring, 2=Summer, 3=Autumn, 4=Winter)
        const seasons = ['spring', 'summer', 'autumn', 'winter'];
        config.forced = true;
        config.value = seasons[seasonal - 1];
        seasonName = config.value;
    } else {
        return { 
            enabled: false, 
            season: null, 
            holiday: null, 
            mappedBaseTime: time 
        };
    }

    // If forced season, map the date FIRST
    if (config.forced) {
        mappedBaseTime = mapDateToSeason(time, seasonName);
        console.log(`🌸 Seasonal date mapping applied: ${time.month + 1}/${time.dayOfMonth} → ${mappedBaseTime.month + 1}/${mappedBaseTime.dayOfMonth} (${seasonName})`);
    }

    // Detect holidays on the FINAL date (mapped if mapped, original if not)
    if (!disableHoliday) {
        const detectedHolidays = detectSeasonalHolidays(mappedBaseTime);
        if (detectedHolidays && detectedHolidays.isHolidayPeriod) {
            holiday = detectedHolidays;
        }
    } else {
        console.log('🚫 Holiday observation disabled by user preference');
    }

    // If no season set yet (no holiday season or no holiday), detect current season
    seasonName = getCurrentSeason(time.month, currentLocation?.lat || 0);

    // Store holiday in config
    config.holiday = holiday;

    return {
        enabled: true,
        forced: config.forced,
        value: config.value,
        holiday: holiday,
        season: seasonName,
        mappedBaseTime: mappedBaseTime
    };
}

// Helper function to find closest holiday
function findClosestHoliday(time) {
    const { month, dayOfMonth, year } = time;
    let closest = null;
    let minDistance = Infinity;

    Object.entries(HOLIDAY_DATA).forEach(([id, holiday]) => {
        let daysUntil = 0;

        if (typeof holiday.dateLogic === 'function' && holiday.targetDay !== null && holiday.targetDay !== undefined) {
            daysUntil = getDaysUntil(holiday.targetMonth, holiday.targetDay, month, dayOfMonth, year);
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

    if (holiday.targetMonth !== undefined && holiday.targetDay !== undefined && holiday.targetDay !== null) {
        holidayDate = new Date(year, holiday.targetMonth, holiday.targetDay);
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
        __runtimeGr.getLogger().warn(`Holiday data validation: ${validHolidays} valid, ${invalidHolidays} invalid`);
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
                        'User-Agent': __runtimeGr.getConfig()?.userAgent || 'StaticForge/1.1a (https://staticforge.app)',
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
    const locationCache = __runtimeGr.getLocationCache();
    const lruCache = __runtimeGr.getConfig({ path: 'lruCache' }) || {};
    const LOCATION_CACHE_DURATION = lruCache.locationDuration || 24 * 60 * 60 * 1000; // 24 hours
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
    const weatherCache = __runtimeGr.getWeatherCache();
    const lruCache = __runtimeGr.getConfig({ path: 'lruCache' }) || {};
    const WEATHER_CACHE_DURATION = lruCache.weatherDuration || 3 * 60 * 1000; // 3 minutes
    const WEATHER_FAILURE_CACHE_DURATION = lruCache.weatherFailureDuration || 15 * 60 * 1000; // 15 minutes
    
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
        const location = __runtimeGr.getSecureConfig({ path: 'location' });
        if (location && location.latitude !== null && location.longitude !== null) {
            const lat = parseFloat(location.latitude);
            const lon = parseFloat(location.longitude);
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
            isActive = holidayData.dateLogic(month, dayOfMonth, year);
            daysUntil = holidayData.targetDay !== null && holidayData.targetDay !== undefined
                ? getDaysUntil(holidayData.targetMonth, holidayData.targetDay, month, dayOfMonth, year)
                : 0;
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
        isHolidayPeriod: sortedHolidays.length > 0,
        primaryHoliday: primaryHoliday,
        secondaryHoliday: secondaryHoliday,
        holidayDecorations: sortedHolidays.flatMap(h => h.decorations.split(', ')),
        holidayAtmosphere: sortedHolidays.flatMap(h => h.atmosphere.split(', ')),
        holidayColors: sortedHolidays.flatMap(h => h.colors.split(', ')),
        region: primaryHoliday?.region || 'Universal',
        progressiveElements: primaryHoliday ? generateProgressiveHolidayElements(primaryHoliday) : null
    };
}

/**
 * Generate progressive holiday elements based on intensity level
 * @param {Object} holiday - Holiday object with intensity information
 * @returns {Object} Progressive holiday elements for SI consumption
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
        // Summary for SI consumption
        elementSummary: `Holiday intensity: ${level} (${description}). Include ${numDecorations} decorations, ${numAtmosphere} atmosphere elements, ${numColors} colors.`
    };
}

/**
 * Generate seasonal environmental modifications
 * @param {Object} time - Time object
 * @param {string} season - Current season
 * @param {boolean} seasonalEnabled - Whether seasonal modifications are enabled
 * @param {Object} weather - Weather data (optional)
 * @param {Object} holiday - Holiday data from config (optional, already detected)
 * @returns {Object} Seasonal modification guidelines
 */
function generateSeasonalGuidelines(time, season, seasonalEnabled, weather = null, holiday = null, guidanceEnabled = true) {
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
    // Holiday is now passed in from config, no need to detect again

    if (!seasonalEnabled) {
        return {
            name: null,
            guidelines: [
                'Seasonal modifications are completely disabled',
                'Do not reference or use any seasonal information',
                'Treat the scene as timeless and non-seasonal',
                'Focus only on weather and time-of-day elements'
            ],
            holiday: null,
            modifications: []
        };
    }

    // If guidance is disabled, return season name and holiday but no guidelines/modifications
    if (!guidanceEnabled) {
        return {
            name: season,
            guidelines: [],
            holiday,
            modifications: []
        };
    }

    const modifications = [];

    // Weather-aware seasonal environmental modifications
    if (season === 'winter') {
        const winterMods = ['Winter may favor indoor scenes with warm lighting - consider if this fits the scene context'];

        // Weather-compliant winter modifications
        if (weather) {
            if (weather.temperature > 10) {
                winterMods.push('Despite winter season, warm weather may reduce traditional winter elements - consider seasonal colors and indoor coziness if applicable');
            } else if (weather.temperature <= 0) {
                winterMods.push('Consider winter atmospheric elements: frost on windows, snow accumulation, cold weather attire (if scene-appropriate)');
            }

            if (weather.condition.toLowerCase().includes('snow')) {
                winterMods.push('Snow conditions align with winter season - consider snow-covered landscapes and winter activities if visible/relevant');
            } else if (weather.condition.toLowerCase().includes('rain')) {
                winterMods.push('Winter rain creates slushy, muddy conditions - consider indoor winter warmth and holiday lighting if scene supports it');
            }
        } else {
            winterMods.push('Consider winter atmospheric elements: frost on windows, snow accumulation, cold weather attire (if scene-appropriate)');
        }

        winterMods.push('Consider cool blue-white lighting, warm indoor contrasts, winter mood (if it enhances the scene)');
        modifications.push(...winterMods);

    } else if (season === 'spring') {
        const springMods = ['Spring may favor outdoor scenes with fresh air and blooming elements - consider if this fits the scene context'];

        // Weather-compliant spring modifications
        if (weather) {
            if (weather.temperature < 10) {
                springMods.push('Cool spring weather may delay blooming - consider early buds, fresh green shoots, and transitional elements if visible');
            } else if (weather.temperature > 20) {
                springMods.push('Warm spring weather accelerates blooming - consider vibrant flowers and lush greenery if scene-appropriate');
            }

            if (weather.windSpeed > 5) {
                springMods.push('Windy spring conditions may scatter petals and leaves - consider dynamic, breezy floral movement if relevant');
            }
        }

        springMods.push('Consider renewal themes: fresh flowers, green leaves, lighter clothing (if they enhance the scene)');
        springMods.push('Consider bright, warm lighting, fresh atmosphere, growth symbolism (if it fits the context)');
        modifications.push(...springMods);

    } else if (season === 'summer') {
        const summerMods = ['Summer may favor outdoor activities and bright, warm environments - consider if this fits the scene context'];

        // Weather-compliant summer modifications
        if (weather) {
            if (weather.temperature > 30) {
                summerMods.push('Intense summer heat aligns with season - consider heat shimmer, bright sunlight, and cooling activities if scene-appropriate');
            } else if (weather.temperature < 20) {
                summerMods.push('Cool summer weather may feel atypical - consider seasonal colors and summer attire if it makes sense for the scene');
            }

            if (weather.humidity > 70 && weather.temperature > 25) {
                summerMods.push('Humid summer conditions may enhance tropical, lush summer atmosphere (if relevant to scene)');
            }

            if (weather.uvIndex >= 8) {
                summerMods.push('High UV summer conditions - consider sun protection, bright shadows, and intense lighting if visible/applicable');
            }
        }

        summerMods.push('Consider summer elements: bright sunlight, heat effects, casual summer attire (if they enhance the scene)');
        summerMods.push('Consider intense lighting, warm atmosphere, vibrant energy (if it fits the context)');
        modifications.push(...summerMods);

    } else if (season === 'autumn') {
        const autumnMods = ['Autumn may create cozy, transitional environments with warm colors - consider if this fits the scene context'];

        // Skip specific autumn elements if they conflict with night time (no autumn leaves at midnight)
        if (!seasonalTimeConflict) {
            // Weather-compliant autumn modifications
            if (weather) {
                if (weather.windSpeed > 8) {
                    autumnMods.push('Windy autumn conditions may accelerate leaf fall - consider swirling leaves, bare branches, and dynamic seasonal change if visible');
                }

                if (weather.temperature < 5) {
                    autumnMods.push('Cool autumn weather may enhance crisp fall atmosphere - consider layered clothing and harvest coziness if scene-appropriate');
                }

                if ((weather.cloudCoverage || 0) >= 60) {
                    autumnMods.push(`Heavy cloud cover${weather.condition.toLowerCase().includes('fog') ? ' and fog' : ''} may create moody fall atmosphere - consider mist-shrouded trees and earthy tones if relevant`);
                }
            }

            autumnMods.push('Consider fall elements: colored leaves, harvest themes, layered clothing (if they enhance the scene)');
        } else {
            // Time-conflicting autumn - use generic seasonal elements only
            autumnMods.push('Consider warm earth tones and cozy transitional atmosphere (avoid specific autumn elements that conflict with night time)');
        }

        autumnMods.push('Consider golden hour lighting in the morning and evening, warm earth tones, nostalgic atmosphere (if it fits the context)');
        modifications.push(...autumnMods);
    }

    return {
        name: season,
        guidelines: [
            'Consider modifying environment to match seasonal characteristics where appropriate',
            'Evaluate indoor/outdoor balance based on seasonal preferences and scene context',
            'Consider seasonal decorations, lighting, and atmospheric elements that enhance the scene',
            'Consider character attire and activities that suit the season when relevant',
            'Create cohesive seasonal scenes that enhance the original prompt when it makes sense'
        ],
        holiday,
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
            ucGuidelines.push('• **Clear/Sunny Scene**: UC cloudy, cloudy sky, rain, showers, drizzle, precipitation, storms, dark clouds, gloomy, wet conditions, puddles');
            ucGuidelines.push('  **MANDATORY PRECIPITATION UC**: Include comprehensive precipitation terms: rain, showers, drizzle, downpour, storms, thunder, lightning, wet, damp, puddles, hail, sleet');
        }
        // Cloudy/Cloudy Sky Scenes (no precipitation)
        else if (isCloudy && !hasPrecipitation) {
            ucGuidelines.push('• **Cloudy/Cloudy Sky Scene (Dry)**: UC bright sunlight, clear sky, sunny, intense shadows, harsh light');
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
                ucGuidelines.push('• **High UV Index**: UC shade, cloudy sky, cloudy, dim lighting, indoor lighting (intense sun exposure)');
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
    ucGuidelines.push('• **Contextual Intelligence**: Focus UC on preventing conflicting elements that the SI might otherwise add');
    ucGuidelines.push('• **Balanced Approach**: Add UC strategically without over-constraining the SI');
    ucGuidelines.push('• **APPEND USAGE**: Use `action: "append"` in UC replacements to add conflicting elements to the negative prompt');
    ucGuidelines.push('• **CONSOLIDATE UC**: Always combine all UC additions into a SINGLE Tanei item using `action: "append"`');
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
    // Pass context directly - clothing database will extract what it needs
    return clothingDB.getAllClothingData(context);
}

/**
 * Compile historical weather report data for SI context
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

// Get client IP-based location for weather data
async function getClientIPLocation(clientIP) {
    try {
        console.log(`🌐 Getting location for client IP: ${clientIP}`);

        // Use IP-API service for server-side IP geolocation
        const response = await fetch(`http://ip-api.com/json/${clientIP}?fields=status,message,country,regionName,city,lat,lon,timezone`, {
            headers: {
                'User-Agent': __runtimeGr.getConfig({ path: 'userAgent' }) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
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
        // Do not geo the Dreamscape host here. CLIENT callers must stay on the user/request IP.
        return null;
    }
}

/**
 * Check if a weather condition is a weather phenomenon (rain, snow, fog, etc.)
 * @param {string} condition - Weather condition to check
 * @returns {boolean} True if condition is a weather phenomenon
 */
function isWeatherPhenomenon(condition) {
    const weatherPhenomena = [
        'thunderstorm', 'severe thunderstorm', 'rain', 'light rain', 'moderate rain', 'heavy rain',
        'drizzle', 'snow', 'light snow', 'moderate snow', 'heavy snow', 'blizzard',
        'sleet', 'hail', 'freezing rain', 'fog', 'dense fog', 'mist',
        'dust storm', 'sandstorm', 'tornado', 'hurricane', 'squall', 'ice storm'
    ];
    return weatherPhenomena.includes(condition);
}

/**
 * Determine if a weather condition change is major enough to affect image generation
 * Minor changes (1 cloud level, slight rain increase) should NOT trigger cache invalidation
 * @param {string} currentCondition - Current weather condition
 * @param {string} nextCondition - Next weather condition
 * @param {number} currentCloudCoverage - Current cloud coverage percentage
 * @param {number} nextCloudCoverage - Next cloud coverage percentage
 * @param {number} currentPrecipRate - Current precipitation rate
 * @param {number} nextPrecipRate - Next precipitation rate
 * @returns {boolean} True if this is a major change that affects image generation
 */
function isMajorWeatherChange(currentCondition, nextCondition, currentCloudCoverage, nextCloudCoverage, currentPrecipRate, nextPrecipRate) {
    // Define weather phenomena that are always major changes
    const weatherPhenomena = [
        'thunderstorm', 'severe thunderstorm', 'rain', 'light rain', 'moderate rain', 'heavy rain',
        'drizzle', 'snow', 'light snow', 'moderate snow', 'heavy snow', 'blizzard',
        'sleet', 'hail', 'freezing rain', 'fog', 'dense fog', 'mist',
        'dust storm', 'sandstorm', 'tornado', 'hurricane', 'squall', 'ice storm'
    ];
    
    // Check if either condition is a weather phenomenon
    const currentIsPhenomenon = weatherPhenomena.includes(currentCondition);
    const nextIsPhenomenon = weatherPhenomena.includes(nextCondition);
    
    // Any change involving weather phenomena is major
    if (currentIsPhenomenon !== nextIsPhenomenon) {
        return true; // Phenomenon appearing or disappearing
    }
    
    // If both are phenomena but different types (e.g., rain → snow)
    if (currentIsPhenomenon && nextIsPhenomenon && currentCondition !== nextCondition) {
        return true; // Different weather phenomena
    }
    
    // For cloud-based conditions, define cloud coverage levels
    // clear (<10%), few clouds (10-29%), mostly clear (30-59%), 
    // partly cloudy (60-79%), mostly cloudy (80-89%), cloudy (90%+)
    const getCloudLevel = (coverage) => {
        if (coverage === null || coverage === undefined) return -1;
        if (coverage >= 90) return 5; // cloudy
        if (coverage >= 80) return 4; // mostly cloudy
        if (coverage >= 60) return 3; // partly cloudy
        if (coverage >= 30) return 2; // mostly clear
        if (coverage >= 10) return 1; // few clouds
        return 0; // clear
    };
    
    const currentLevel = getCloudLevel(currentCloudCoverage);
    const nextLevel = getCloudLevel(nextCloudCoverage);
    
    // Only trigger if cloud coverage changes by 2+ levels
    // (e.g., clear → partly cloudy, or few clouds → mostly cloudy)
    const cloudLevelDiff = Math.abs(nextLevel - currentLevel);
    if (cloudLevelDiff >= 2) {
        return true; // Major cloud coverage change
    }
    
    // Check for major precipitation changes (not just 1 level increase)
    // Ignore minor precipitation rate changes
    if (currentPrecipRate !== null && nextPrecipRate !== null) {
        const precipDiff = Math.abs(nextPrecipRate - currentPrecipRate);
        // Only consider major if precipitation increases/decreases by 5+ mm/h
        if (precipDiff >= 5) {
            return true; // Major precipitation change
        }
    }
    
    // All other condition changes are considered minor (1 cloud level shift)
    return false;
}

/**
 * Preprocess context data based on scene type from analysis
 * Filters out conflicting or irrelevant data based on indoor/outdoor/mixed detection
 * @param {Object} context - Original context object
 * @param {Object} analysisResults - Published analysis results with scene_type
 * @returns {Object} Filtered context object
 */

async function compileContext(globalResources, dynamicConfig, clientIP = null) {
    bindRuntimeGlobalResources(globalResources);
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
        disable_holiday,
        guidance
    } = dynamicConfig;
    
    // Only fetch location if we need weather or time data
    let currentLocation = null;
    if (tod || weather) {
        // Use location if provided, otherwise get current location
        if (location) {
            console.log(`📍 Location data received: "${location}"`);
            if (location === 'CLIENT') {
                // Bound tab clientIP or MCP request IP — never Dreamscape host geo
                console.log('📍 Using client IP for weather location');
                if (clientIP) {
                    currentLocation = await getClientIPLocation(clientIP);
                    console.log(`📍 Using client IP for weather location: ${clientIP}`);
                } else {
                    console.warn('⚠️ No client IP for location=CLIENT; leaving location empty (not server geo)');
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
                                __runtimeGr.getLogger().verbose(`🌅 Before sunrise (${sunriseHour.toFixed(2)}h), "tomorrow" refers to today`);
                                tomorrow = new Date(now);
                            } else {
                                // After sunrise, "tomorrow" means next calendar day
                                __runtimeGr.getLogger().verbose(`🌅 After sunrise (${sunriseHour.toFixed(2)}h), "tomorrow" refers to next day`);
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
                    __runtimeGr.getLogger().verbose(`🌅 "${normalizedTimeToProcess}" has passed today, scheduling for tomorrow (next day): ${targetDateTime.getHours()}:${targetDateTime.getMinutes().toString().padStart(2, '0')}`);
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

    // Get seasonal configuration - handles all season/holiday logic and date mapping
    const seasonalConfig = getSeasonalConfig(season, baseTime || getCurrentTime(), currentLocation, disable_holiday);
    baseTime = seasonalConfig.mappedBaseTime; // Update baseTime with mapped date if season was forced

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

        __runtimeGr.getLogger().detailed(`⏰ Local time: ${baseTime.hour}:${String(baseTime.minute).padStart(2, '0')} (${timezone}) | ${baseTime.month + 1}/${baseTime.dayOfMonth}`);
    }

    let locationWarning = null;
    if (baseTime && !currentLocation) {
        const clientOnly = location === 'CLIENT';
        console.warn(clientOnly
            ? '⚠️ location=CLIENT with no usable client IP; not using Dreamscape host geo'
            : '⚠️ No location for determineTimePeriod; defaulting to client IP then server location (no 500)');
        if (clientIP) {
            currentLocation = await getClientIPLocation(clientIP);
        }
        if (!currentLocation && !clientOnly) {
            currentLocation = await getCurrentLocation();
        }
        locationWarning = currentLocation
            ? 'No location provided; used client/server default. Call get_client_physics, pass the user location, or ask the user.'
            : (clientOnly
                ? 'location=CLIENT needs a bound tab clientIP or the MCP request IP. Dreamscape host geo was not used.'
                : 'No location for time-of-day. Skipped determineTimePeriod (no 500). Call get_client_physics, pass location, or CLIENT.');
    }

    // Determine time period (only if time is available)
    const timePeriod = (baseTime && currentLocation)
        ? await determineTimePeriod(baseTime, seasonalConfig.season, currentLocation, weatherData || {}, enhancedWeatherData || {}, clothing, guidance !== false)
        : null;

    // Generate seasonal guidelines if seasonal is enabled (must be after weather is fetched)
    let seasonalGuidelines = null;
    if (seasonalConfig.enabled) {
        seasonalGuidelines = generateSeasonalGuidelines(
            baseTime || getCurrentTime(),
            seasonalConfig.season,
            seasonalConfig.enabled,
            weatherData || null,
            seasonalConfig.holiday,
            guidance !== false // Default to true if not specified
        );
    }

    // Build context - only include data that is enabled
    const context = {};
    if (locationWarning) {
        context.warning = locationWarning;
        context.locationDefaulted = !!currentLocation;
    }

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
            // Calculate next weather condition change if enhanced weather data is available
            let nextConditionChange = null;
            let nextConditionName = null;
            
            if (enhancedWeatherData) {
                const currentTimestamp = baseTime?.timestamp || Date.now();
                const currentCondition = weatherData.condition;
                const currentCloudCoverage = weatherData.cloudCoverage;
                const currentPrecipRate = weatherData.precipitationRate || 0;
                
                // Check nextPeriod for condition changes
                let nextPeriod = null;
                if (enhancedWeatherData?.nextPeriod && Array.isArray(enhancedWeatherData.nextPeriod)) {
                    nextPeriod = enhancedWeatherData.nextPeriod;
                } else if (enhancedWeatherData?.temporal?.nextPeriod && Array.isArray(enhancedWeatherData.temporal.nextPeriod)) {
                    nextPeriod = enhancedWeatherData.temporal.nextPeriod;
                }
                
                if (nextPeriod && nextPeriod.length > 0) {
                    // Find the first hour where condition changes SIGNIFICANTLY
                    let minorChangesSkipped = 0;
                    for (const hourData of nextPeriod) {
                        if (hourData.timestamp && hourData.timestamp > currentTimestamp) {
                            const hourCondition = hourData.condition || hourData.generationCondition;
                            const hourCloudCoverage = hourData.cloudCoverage;
                            const hourPrecipRate = hourData.precipitationRate || 0;
                            
                            // Check if this is a MAJOR weather change (not just minor cloud cover shifts)
                            if (hourCondition && hourCondition !== currentCondition) {
                                const isMajorChange = isMajorWeatherChange(
                                    currentCondition, 
                                    hourCondition,
                                    currentCloudCoverage,
                                    hourCloudCoverage,
                                    currentPrecipRate,
                                    hourPrecipRate
                                );
                                
                                if (isMajorChange) {
                                    nextConditionChange = hourData.timestamp;
                                    nextConditionName = hourCondition;
                                    if (minorChangesSkipped > 0) {
                                        console.log(`   ℹ️  Skipped ${minorChangesSkipped} minor weather change(s) before finding major change`);
                                    }
                                    break;
                                } else {
                                    minorChangesSkipped++;
                                }
                            }
                        }
                    }
                    
                    if (minorChangesSkipped > 0 && !nextConditionChange) {
                        console.log(`   ℹ️  Ignored ${minorChangesSkipped} minor weather change(s) (not significant for image generation)`);
                    }
                }
            }
            
            // Add next condition change to weather data
            context.weather = {
                ...weatherData,
                nextConditionChange: nextConditionChange, // Timestamp of next condition change
                nextConditionName: nextConditionName // Name of next condition
            };
            console.log('✅ Weather data validation passed');
        } else {
            console.warn('⚠️ Weather data missing required fields, excluding from context');
            const missingFields = requiredFields.filter(field =>
                weatherData[field] === undefined || weatherData[field] === null
            );
            console.warn('Missing fields:', missingFields);
        }
    }

    // Generate clothing context if clothing is enabled
    if (clothing) {
        try {
            context.clothing = generateDynamicClothingContext(context);
            console.log('👔 Generated clothing context with', context.clothing.options?.length || 0, 'options');
        } catch (error) {
            console.warn('⚠️ Failed to generate clothing context:', error.message);
        }
    }
    
    // Store seasonal data as context.season (only if seasonal is enabled)
    if (seasonalGuidelines) context.season = seasonalGuidelines;
    if (timePeriod) context.timePeriod = timePeriod;
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

    // Log expiration-related values from context
    if (context.timePeriod || context.weather) {
        console.log('⏰ Cache expiration context values:');
        
        if (context.timePeriod && context.timePeriod.nextPeriodTransition) {
            const timeTransition = context.timePeriod.nextPeriodTransition;
            const now = context.time?.timestamp || Date.now();
            const msUntilTransition = timeTransition - now;
            const minutesUntil = Math.round(msUntilTransition / (60 * 1000));
            const hoursUntil = Math.round(minutesUntil / 60 * 10) / 10;
            const transitionDate = new Date(timeTransition);
            console.log(`  📅 Next time period transition: ${context.timePeriod.nextPeriodName || 'unknown'} at ${transitionDate.toLocaleTimeString()} (${hoursUntil} hours, ${minutesUntil % 60} minutes)`);
        } else {
            console.log('  📅 Next time period transition: not available');
        }
        
        if (context.weather && context.weather.nextConditionChange) {
            const weatherChange = context.weather.nextConditionChange;
            const now = context.time?.timestamp || Date.now();
            const msUntilChange = weatherChange - now;
            const minutesUntil = Math.round(msUntilChange / (60 * 1000));
            const hoursUntil = Math.round(minutesUntil / 60 * 10) / 10;
            const changeDate = new Date(weatherChange);
            console.log(`  🌦️  Next major weather change: "${context.weather.nextConditionName || 'unknown'}" at ${changeDate.toLocaleTimeString()} (${hoursUntil} hours, ${minutesUntil % 60} minutes)`);
        } else {
            console.log('  🌦️  Next major weather change: none detected in forecast period');
        }
    }

    // Add expiration metadata to context for smart reuse
    context.expirationMetadata = {
        timePeriod: context.timePeriod?.period || null,
        weatherCondition: context.weather?.condition || null,
        cloudCoverage: context.weather?.cloudCoverage || null,
        temperature: context.weather?.temperature || null,
        hasWeatherPhenomenon: context.weather ? isWeatherPhenomenon(context.weather.condition) : false,
        timestamp: Date.now()
    };

    return context;
}

/**
 * Calculate the next time period transition time (in milliseconds from now)
 * Uses pre-calculated nextPeriodTransition from timePeriod if available, otherwise falls back to manual calculation
 * @param {Object} timePeriod - Time period object from determineTimePeriod
 * @param {Object} baseTime - Current time object with timestamp
 * @returns {number|null} Milliseconds until next transition, or null if unable to calculate
 */
function calculateNextTimePeriodTransition(timePeriod, baseTime) {
    // Use pre-calculated nextPeriodTransition if available (preferred method)
    if (timePeriod && timePeriod.nextPeriodTransition) {
        return timePeriod.nextPeriodTransition;
    }

    // Fallback to manual calculation if nextPeriodTransition not available (backward compatibility)
    if (!timePeriod || !baseTime || !baseTime.timestamp) {
        return null;
    }

    const now = baseTime.timestamp;
    const currentHour = baseTime.hour + (baseTime.minute / 60);
    const transitions = [];

    // Get sunrise, sunset, and solar noon for transitions
    const sunriseHour = timePeriod.sunriseHour;
    const sunsetHour = timePeriod.sunsetHour;
    const solarNoon = timePeriod.solarNoon;

    if (sunriseHour !== null) {
        // Calculate next sunrise
        let nextSunrise = sunriseHour;
        if (currentHour >= sunriseHour) {
            nextSunrise += 24;
        }
        const sunriseMs = (nextSunrise - currentHour) * 60 * 60 * 1000;
        transitions.push(now + sunriseMs);
    }

    if (sunsetHour !== null) {
        // Calculate next sunset
        let nextSunset = sunsetHour;
        if (currentHour >= sunsetHour) {
            nextSunset += 24;
        }
        const sunsetMs = (nextSunset - currentHour) * 60 * 60 * 1000;
        transitions.push(now + sunsetMs);
    }

    // Find the nearest transition in the future
    const futureTransitions = transitions.filter(t => t > now);
    if (futureTransitions.length === 0) {
        // Default to 1 hour if no transitions found
        return now + (60 * 60 * 1000);
    }

    const nextTransition = Math.min(...futureTransitions);
    return nextTransition;
}

/**
 * Calculate the next MAJOR weather condition change time (in milliseconds from now)
 * Only considers significant changes that affect image generation (not minor cloud cover shifts)
 * Uses pre-calculated nextConditionChange from weatherData if available, otherwise falls back to manual calculation
 * @param {Object} weatherData - Current weather data (may contain pre-calculated nextConditionChange)
 * @param {Object} enhancedWeatherData - Enhanced weather data with forecast
 * @param {number} currentTimestamp - Current timestamp in milliseconds
 * @returns {number|null} Milliseconds until next major condition change, or null if unable to calculate
 */
function calculateNextWeatherConditionChange(weatherData, enhancedWeatherData, currentTimestamp) {
    // Use pre-calculated nextConditionChange if available (preferred method)
    if (weatherData && weatherData.nextConditionChange) {
        return weatherData.nextConditionChange;
    }

    // Fallback to manual calculation if nextConditionChange not available (backward compatibility)
    if (!weatherData || !weatherData.condition) {
        return null;
    }

    const currentCondition = weatherData.condition;
    
    // Check nextPeriod for condition changes
    let nextPeriod = null;
    if (enhancedWeatherData?.nextPeriod && Array.isArray(enhancedWeatherData.nextPeriod)) {
        nextPeriod = enhancedWeatherData.nextPeriod;
    } else if (enhancedWeatherData?.temporal?.nextPeriod && Array.isArray(enhancedWeatherData.temporal.nextPeriod)) {
        nextPeriod = enhancedWeatherData.temporal.nextPeriod;
    }

    if (!nextPeriod || nextPeriod.length === 0) {
        // Default to 3 hours if no forecast data
        return currentTimestamp + (3 * 60 * 60 * 1000);
    }

    // Find the first hour where condition changes
    for (const hourData of nextPeriod) {
        if (hourData.timestamp && hourData.timestamp > currentTimestamp) {
            const hourCondition = hourData.condition || hourData.generationCondition;
            
            // Check if condition has changed
            if (hourCondition && hourCondition !== currentCondition) {
                return hourData.timestamp;
            }
        }
    }

    // No condition change found in forecast, default to 3 hours
    return currentTimestamp + (3 * 60 * 60 * 1000);
}

/**
 * Calculate dynamic expiration time based on time period and weather changes
 * @param {Object} context - Context object from compileContext
 * @param {number} defaultExpirationMs - Default expiration in milliseconds if unable to calculate (default: 15 minutes)
 * @returns {number} Expiration timestamp in milliseconds
 */
function calculateDynamicExpiration(globalResources, context, defaultExpirationMs = 15 * 60 * 1000) {
    const now = Date.now();
    const expirationTimes = [];
    let timeTransition = null;
    let weatherChange = null;

    // Calculate expiration based on time period transition
    if (context.timePeriod && context.time) {
        timeTransition = calculateNextTimePeriodTransition(context.timePeriod, context.time);
    }

    // Calculate expiration based on weather condition change (only major changes)
    if (context.weather && context.enhancedWeatherData) {
        weatherChange = calculateNextWeatherConditionChange(context.weather, context.enhancedWeatherData, now);
    }

    // Determine which expiration times to use
    // If both valid: use the earliest (with 30 min minimum)
    // If only time transition: use it (with 30 min minimum)
    // If weather change detected but no time transition: use weather change
    if (timeTransition && timeTransition > now) {
        expirationTimes.push(timeTransition);
    }
    
    // Only add weather change if it's a valid major change
    if (weatherChange && weatherChange > now) {
        expirationTimes.push(weatherChange);
    } else if (timeTransition && timeTransition > now) {
        // No major weather change detected, fall back to time of day only
        // (already added above)
    }

    // Log available expiration values
    console.log('🔍 Calculating cache expiration:');
    
    if (timeTransition) {
        const msUntil = timeTransition - now;
        const minutesUntil = Math.round(msUntil / (60 * 1000));
        const hoursUntil = Math.round(minutesUntil / 60 * 10) / 10;
        const transitionDate = new Date(timeTransition);
        const periodName = context.timePeriod?.nextPeriodName || 'unknown period';
        console.log(`  📅 Time period transition: ${periodName} at ${transitionDate.toLocaleTimeString()} (${hoursUntil}h ${minutesUntil % 60}m)`);
    } else {
        console.log('  📅 Time period transition: not available');
    }
    
    if (weatherChange) {
        const msUntil = weatherChange - now;
        const minutesUntil = Math.round(msUntil / (60 * 1000));
        const hoursUntil = Math.round(minutesUntil / 60 * 10) / 10;
        const changeDate = new Date(weatherChange);
        const conditionName = context.weather?.nextConditionName || 'unknown condition';
        console.log(`  🌦️  Major weather change: "${conditionName}" at ${changeDate.toLocaleTimeString()} (${hoursUntil}h ${minutesUntil % 60}m)`);
    } else {
        console.log('  🌦️  Major weather change: none detected');
    }

    // Use the minimum expiration time (whichever comes first)
    if (expirationTimes.length > 0) {
        const minExpiration = Math.min(...expirationTimes);
        // Ensure expiration is at least 30 minutes and at most 24 hours
        const minAllowed = now + (30 * 60 * 1000);
        const maxAllowed = now + (24 * 60 * 60 * 1000);
        const finalExpiration = Math.max(minAllowed, Math.min(maxAllowed, minExpiration));
        
        const msUntilFinal = finalExpiration - now;
        const minutesUntilFinal = Math.round(msUntilFinal / (60 * 1000));
        const hoursUntilFinal = Math.round(minutesUntilFinal / 60 * 10) / 10;
        const finalDate = new Date(finalExpiration);
        
        // Determine which value is being used
        let usedSource = 'default';
        if (expirationTimes.length === 2) {
            usedSource = timeTransition < weatherChange ? 'time period transition' : 'major weather change';
        } else if (timeTransition && !weatherChange) {
            usedSource = 'time period transition (no major weather change detected)';
        } else if (timeTransition) {
            usedSource = 'time period transition';
        } else if (weatherChange) {
            usedSource = 'major weather change';
        }
        
        console.log(`  ✅ Using: ${usedSource} → expires at ${finalDate.toLocaleTimeString()} (${hoursUntilFinal}h ${minutesUntilFinal % 60}m, min: 30min)`);
        
        return finalExpiration;
    }

    // Fall back to default if no dynamic expiration could be calculated
    const defaultExpiration = now + defaultExpirationMs;
    const defaultDate = new Date(defaultExpiration);
    const defaultMinutes = Math.round(defaultExpirationMs / (60 * 1000));
    console.log(`  ⚠️  No dynamic expiration available, using default: ${defaultMinutes} minutes (expires at ${defaultDate.toLocaleTimeString()})`);
    
    return defaultExpiration;
}


// Grok no longer compiles Rentan (#347). Wren owns that in modules/dynagenWren.js.
// Callers that still reach this stub get context only, same as the previous noop.
async function processDynamicGenerationCore(globalResources, dynamicConfig, context = null, prompt, uc, characterPrompts = [], requestId = 'core', ws = null, handler = null, wsServer = null, backgroundFocus = false, lastGeneratedImage = null, stageContext = null, datasetConfig = null, appliedPresetControls = null, preCalculatedHashes = null) {
    bindRuntimeGlobalResources(globalResources);
    return {
        success: true,
        skipped: true,
        noop: true,
        processed: false,
        context: context || null,
        text_replacements: { prompt: [], uc: [], character_prompts: [] },
        citations: [],
        dialogs: []
    };
}

/**
 * Resolve dynamic generation context without SI processing
 * Returns the actual values that would be used for generation
 * Uses compileContext to avoid duplicating resolution logic
 */
async function resolveDynamicContext(globalResources, dynamicConfig, clientIP = null) {
    bindRuntimeGlobalResources(globalResources);
    try {
        const context = await compileContext(__runtimeGr, dynamicConfig, clientIP);
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
    // Holiday / Date() math stays 0-based on context.time.month. Egress month is 1-based.
    let dateItem = null;
    if (context.time) {
        const contextDate = new Date(context.time.year, context.time.month, context.time.dayOfMonth);
        dateItem = {
            month: context.time.month + 1,
            monthName: context.time.monthName,
            day: context.time.dayOfMonth,
            year: context.time.year,
            formatted: contextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        };
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
        season: context.season || null,
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
    generateDirectiveHash,
    expandShorthandTags,
    getTimezoneByCoordinates,
    resolveDynamicContext,
    compileContext,
    formatContextForCarousel,
    calculateDynamicExpiration
};
