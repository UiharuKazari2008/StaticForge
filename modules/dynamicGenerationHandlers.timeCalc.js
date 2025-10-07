
const getSunriseSunsetLib = require('sunrise-sunset-js');


/**
 * Get accurate sunrise and sunset times using established astronomical library
 * Uses sunrise-sunset-js package for reliable calculations
 * @param {Object} location - Location object with lat/lon
 * @param {Date} date - Date for which to calculate sunrise/sunset
 * @returns {Promise<Object>} Sunrise and sunset times
 */
async function getSunriseSunset(location, date = new Date()) {
    const { lat, lon } = location || {};

    // Validate inputs
    if (typeof lat !== 'number' || typeof lon !== 'number' ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180 || isNaN(lat) || isNaN(lon)) {
        console.error('Invalid latitude/longitude provided to getSunriseSunset');
        return {
            sunrise: null,
            sunset: null,
            sunriseHour: null,
            sunsetHour: null,
            isPolarDay: false,
            isPolarNight: false,
            error: 'Invalid coordinates'
        };
    }

    // Use established sunrise-sunset-js package for accurate calculations

    try {
        // Create date at noon UTC for the given date to ensure consistent timezone handling
        const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
        const sunrise = getSunriseSunsetLib.getSunrise(lat, lon, utcDate);
        const sunset = getSunriseSunsetLib.getSunset(lat, lon, utcDate);

        // Check for polar conditions - when sunrise and sunset times are the same
        // This indicates either polar day (midnight sun) or polar night
        if (sunrise.getTime() === sunset.getTime()) {
            // Determine if it's polar day or night based on latitude and season
            const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
            const solarDeclination = 23.45 * Math.sin(2 * Math.PI * (dayOfYear - 81) / 365); // In radians

            // Polar day occurs when sun is always above horizon (latitude + solar declination > 0)
            // Polar night occurs when sun is always below horizon (latitude + solar declination < 0)
            const isPolarDay = (lat + solarDeclination) > 0;
            const isPolarNight = (lat + solarDeclination) < 0;

            return {
                sunrise: isPolarDay ? 0 : null,  // Midnight for polar day
                sunset: isPolarDay ? 24 * 60 * 60 * 1000 : null,  // Next midnight for polar day
                sunriseHour: isPolarDay ? 0 : null,
                sunsetHour: isPolarDay ? 24 : null,
                isPolarDay,
                isPolarNight
            };
        }

        // Convert UTC times to local timezone for hour calculation
        const sunriseLocal = new Date(sunrise.toLocaleString('en-US', { timeZone: location.timezone || 'UTC' }));
        const sunsetLocal = new Date(sunset.toLocaleString('en-US', { timeZone: location.timezone || 'UTC' }));

        const sunriseHour = sunriseLocal.getHours() + sunriseLocal.getMinutes() / 60 + sunriseLocal.getSeconds() / 3600;
        const sunsetHour = sunsetLocal.getHours() + sunsetLocal.getMinutes() / 60 + sunsetLocal.getSeconds() / 3600;

        return {
            sunrise: sunrise.getTime(),
            sunset: sunset.getTime(),
            sunriseHour,
            sunsetHour,
            isPolarDay: false,
            isPolarNight: false
        };
    } catch (error) {
        // Fallback to simple approximation if library fails
        console.warn('Sunrise/sunset calculation failed, using approximation:', error.message);

        const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
        const solarDeclination = 23.45 * Math.sin(2 * Math.PI * (dayOfYear - 81) / 365); // Corrected to radians
        const latRad = lat * Math.PI / 180;

        const argument = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(latRad) * Math.sin(solarDeclination)) /
                        (Math.cos(latRad) * Math.cos(solarDeclination));

        if (isNaN(argument) || argument > 1 || argument < -1) {
            // Polar conditions detected in fallback
            const isPolarDay = argument < -1 && (lat + solarDeclination * 180 / Math.PI) > 0;
            const isPolarNight = argument > 1 && (lat + solarDeclination * 180 / Math.PI) < 0;

            return {
                sunrise: null,
                sunset: null,
                sunriseHour: null,
                sunsetHour: null,
                isPolarDay,
                isPolarNight,
                fallback: true
            };
        }

        const hourAngle = Math.acos(argument) * 180 / Math.PI;
        const sunriseHour = 12 - hourAngle/15;
        const sunsetHour = 12 + hourAngle/15;

        const sunrise = new Date(date);
        sunrise.setHours(Math.floor(sunriseHour), (sunriseHour % 1) * 60, 0, 0);

        const sunset = new Date(date);
        sunset.setHours(Math.floor(sunsetHour), (sunsetHour % 1) * 60, 0, 0);

        return {
            sunrise: sunrise.getTime(),
            sunset: sunset.getTime(),
            sunriseHour,
            sunsetHour,
            isPolarDay: false,
            isPolarNight: false,
            fallback: true
        };
    }
}

/**
 * Determine the type of transition currently occurring
 * @param {number} currentHour - Current hour in decimal
 * @param {number} sunriseHour - Sunrise hour in decimal
 * @param {number} sunsetHour - Sunset hour in decimal
 * @returns {string} Transition type description
 */
function getTransitionType(currentHour, sunriseHour, sunsetHour) {
    // Handle polar conditions where sunrise/sunset might be null
    if (sunriseHour === null || sunsetHour === null) {
        return 'polar_conditions';
    }

    const sunriseTransition = Math.abs(currentHour - sunriseHour);
    const sunsetTransition = Math.abs(currentHour - sunsetHour);

    // Check for broad transition windows first (lower priority)
    const inDawnWindow = currentHour >= sunriseHour - 1 && currentHour <= sunriseHour + 1;
    const inTwilightWindow = currentHour >= sunsetHour - 1 && currentHour <= sunsetHour + 1;

    // Then check for narrow transition windows (higher priority)
    if (sunriseTransition <= 0.25) { // 15 minutes
        return 'sunrise_transition';
    } else if (sunsetTransition <= 0.25) { // 15 minutes
        return 'sunset_transition';
    } else if (inTwilightWindow) {
        return 'twilight_transition';
    } else if (inDawnWindow) {
        return 'dawn_dusk_transition';
    } else {
        return 'steady_state';
    }
}

/**
 * Analyze soil conditions based on temperature and moisture data
 * @param {number} soilTemperature - Soil temperature in Celsius
 * @param {number} soilMoisture - Soil moisture content (0-1)
 * @param {number} airTemperature - Air temperature for comparison
 * @returns {Object} Soil condition analysis
 */
function analyzeSoilConditions(soilTemperature, soilMoisture, airTemperature) {
    const analysis = {
        condition: 'normal',
        description: '',
        frostRisk: false,
        droughtRisk: false,
        groundHeatRetention: false
    };

    // Soil temperature analysis
    if (soilTemperature !== null) {
        if (soilTemperature < 0) {
            analysis.condition = 'frozen';
            analysis.description += 'frozen ground, ';
            analysis.frostRisk = true;
        } else if (soilTemperature < 5) {
            analysis.condition = 'very_cold';
            analysis.description += 'very cold ground, ';
            analysis.frostRisk = airTemperature < 5; // Frost risk if air is also cold
        } else if (soilTemperature > airTemperature + 5) {
            analysis.groundHeatRetention = true;
            analysis.description += 'warm ground retaining heat, ';
        } else if (soilTemperature < airTemperature - 5) {
            analysis.description += 'cool ground, ';
        }
    }

    // Soil moisture analysis
    if (soilMoisture !== null) {
        if (soilMoisture < 0.1) {
            analysis.condition = analysis.condition === 'normal' ? 'very_dry' : analysis.condition + '_dry';
            analysis.description += 'extremely dry soil, ';
            analysis.droughtRisk = true;
        } else if (soilMoisture < 0.2) {
            analysis.condition = analysis.condition === 'normal' ? 'dry' : analysis.condition + '_dry';
            analysis.description += 'dry soil, ';
            if (soilMoisture < 0.15) analysis.droughtRisk = true;
        } else if (soilMoisture > 0.4) {
            analysis.condition = analysis.condition === 'normal' ? 'wet' : analysis.condition + '_wet';
            analysis.description += 'wet soil, ';
        } else if (soilMoisture > 0.3) {
            analysis.condition = analysis.condition === 'normal' ? 'moist' : analysis.condition + '_moist';
            analysis.description += 'moist soil, ';
        }
    }

    // Clean up description
    analysis.description = analysis.description.replace(/, $/, '');

    return analysis;
}

/**
 * Analyze atmospheric moisture conditions using evapotranspiration and VPD
 * @param {number} evapotranspiration - ET rate (mm/hr)
 * @param {number} et0 - Reference ET (mm/hr)
 * @param {number} vapourPressureDeficit - VPD (kPa)
 * @param {number} temperature - Air temperature
 * @param {number} humidity - Relative humidity
 * @returns {Object} Atmospheric moisture analysis
 */
function analyzeAtmosphericMoisture(evapotranspiration, et0, vapourPressureDeficit, temperature, humidity) {
    const analysis = {
        atmosphericDryness: 'normal',
        description: '',
        plantStress: false,
        evaporationRate: 'normal'
    };

    // Vapour Pressure Deficit analysis (key indicator of atmospheric dryness)
    if (vapourPressureDeficit !== null) {
        if (vapourPressureDeficit > 2.0) {
            analysis.atmosphericDryness = 'very_dry';
            analysis.description += 'very dry air, ';
            analysis.plantStress = true;
        } else if (vapourPressureDeficit > 1.5) {
            analysis.atmosphericDryness = 'dry';
            analysis.description += 'dry air, ';
            analysis.plantStress = temperature > 20; // Higher stress in warm conditions
        } else if (vapourPressureDeficit < 0.5) {
            analysis.atmosphericDryness = 'humid';
            analysis.description += 'humid air, ';
        }
    }

    // Evapotranspiration analysis
    if (evapotranspiration !== null && et0 !== null) {
        const etRatio = evapotranspiration / et0;

        if (etRatio > 1.2) {
            analysis.evaporationRate = 'high';
            analysis.description += 'high evaporation rates, ';
        } else if (etRatio < 0.8) {
            analysis.evaporationRate = 'low';
            analysis.description += 'low evaporation rates, ';
        }

        // Combine with temperature for better context
        if (temperature > 25 && etRatio > 1.0) {
            analysis.description += 'intense evaporative cooling, ';
        }
    } else if (evapotranspiration !== null) {
        if (evapotranspiration > 0.3) {
            analysis.evaporationRate = 'high';
            analysis.description += 'high moisture loss, ';
        } else if (evapotranspiration < 0.1) {
            analysis.evaporationRate = 'low';
            analysis.description += 'minimal moisture loss, ';
        }
    }

    // Clean up description
    analysis.description = analysis.description.replace(/, $/, '');

    return analysis;
}

/**
 * Analyze surface pressure vs MSL pressure for local atmospheric conditions
 * @param {number} surfacePressure - Surface pressure in hPa
 * @param {number} mslPressure - Mean sea level pressure in hPa
 * @param {number} altitude - Location altitude in meters (if available)
 * @returns {Object} Surface pressure analysis
 */
function analyzeSurfacePressure(surfacePressure, mslPressure, altitude = 0) {
    const pressureDifference = surfacePressure - mslPressure;

    let localPressureTendency = 'normal';
    let atmosphericStability = 'stable';
    let weatherImplications = [];

    // Analyze pressure difference (accounting for altitude)
    // Surface pressure is typically higher than MSL pressure at sea level
    // The difference indicates local atmospheric conditions
    if (pressureDifference > 10) {
        localPressureTendency = 'high_local_pressure';
        atmosphericStability = 'very_stable';
        weatherImplications.push('stable weather patterns', 'clear skies likely', 'minimal weather change');
    } else if (pressureDifference > 5) {
        localPressureTendency = 'elevated_local_pressure';
        atmosphericStability = 'stable';
        weatherImplications.push('settled weather', 'fair conditions');
    } else if (pressureDifference < -10) {
        localPressureTendency = 'low_local_pressure';
        atmosphericStability = 'unstable';
        weatherImplications.push('unstable weather', 'potential for rapid changes', 'increased weather activity');
    } else if (pressureDifference < -5) {
        localPressureTendency = 'depressed_local_pressure';
        atmosphericStability = 'moderately_unstable';
        weatherImplications.push('variable conditions', 'possible weather systems approaching');
    }

    // Create description based on analysis
    let description = '';
    if (atmosphericStability !== 'stable') {
        if (atmosphericStability === 'very_stable') {
            description = 'very stable local atmospheric conditions';
        } else if (atmosphericStability === 'moderately_unstable') {
            description = 'moderately variable local weather patterns';
        } else if (atmosphericStability === 'unstable') {
            description = 'highly variable and potentially unstable local conditions';
        }
    }

    return {
        localPressureTendency,
        atmosphericStability,
        weatherImplications,
        pressureDifference: Math.round(pressureDifference * 10) / 10,
        description
    };
}

/**
 * Analyze cloud cover layers for better weather understanding
 * @param {number} cloudCoverLow - Low cloud cover (0-2km)
 * @param {number} cloudCoverMid - Mid cloud cover (2-6km)
 * @param {number} cloudCoverHigh - High cloud cover (6km+)
 * @param {number} totalCloudCover - Total cloud cover
 * @returns {Object} Cloud layer analysis
 */
function analyzeCloudLayers(cloudCoverLow, cloudCoverMid, cloudCoverHigh, totalCloudCover) {
    const analysis = {
        cloudType: 'mixed',
        description: '',
        weatherPattern: 'variable'
    };

    // Analyze cloud layer distribution
    if (cloudCoverLow !== null && cloudCoverMid !== null && cloudCoverHigh !== null) {
        const lowDominant = cloudCoverLow > cloudCoverMid + 20 && cloudCoverLow > cloudCoverHigh + 20;
        const midDominant = cloudCoverMid > cloudCoverLow + 20 && cloudCoverMid > cloudCoverHigh + 20;
        const highDominant = cloudCoverHigh > cloudCoverLow + 20 && cloudCoverHigh > cloudCoverMid + 20;

        if (lowDominant) {
            analysis.cloudType = 'low';
            analysis.description += 'low cloud layer dominant, ';
            analysis.weatherPattern = cloudCoverLow > 80 ? 'stormy' : 'fair';
        } else if (midDominant) {
            analysis.cloudType = 'mid';
            analysis.description += 'mid-level clouds dominant, ';
            analysis.weatherPattern = 'stable';
        } else if (highDominant) {
            analysis.cloudType = 'high';
            analysis.description += 'high clouds dominant, ';
            analysis.weatherPattern = 'fair_weather';
        } else {
            analysis.cloudType = 'mixed';
            analysis.description += 'mixed cloud layers, ';
        }

        // Specific cloud pattern analysis
        if (cloudCoverLow > 70 && cloudCoverMid > 70) {
            analysis.weatherPattern = 'overcast';
            analysis.description += 'thick cloud cover throughout atmosphere, ';
        } else if (cloudCoverHigh > 60 && cloudCoverLow < 30) {
            analysis.weatherPattern = 'fair_improving';
            analysis.description += 'high clouds with clear lower atmosphere, ';
        }
    }

    // Clean up description
    analysis.description = analysis.description.replace(/, $/, '');

    return analysis;
}

/**
 * Build environmental context description from all analyses, avoiding conflicts
 * @param {Object} soilAnalysis - Soil condition analysis
 * @param {Object} atmosphericMoistureAnalysis - Atmospheric moisture analysis
 * @param {Object} cloudLayerAnalysis - Cloud layer analysis
 * @param {Object} surfacePressureAnalysis - Surface pressure analysis
 * @param {boolean} isDaylight - Whether it's daylight
 * @param {string} existingAtmosphere - Current atmospheric description to avoid conflicts
 * @returns {string} Environmental context description
 */
function buildEnvironmentalContext(soilAnalysis, atmosphericMoistureAnalysis, cloudLayerAnalysis, surfacePressureAnalysis, isDaylight, existingAtmosphere = '') {
    let contextParts = [];
    const existingLower = existingAtmosphere.toLowerCase();

    // Add soil conditions if available and relevant, but avoid conflicts
    if (soilAnalysis.description && soilAnalysis.condition !== 'normal') {
        // Check for various soil/ground related terms in existing description
        const hasExistingSoilInfo = existingLower.includes('soil') || existingLower.includes('ground') ||
                                   existingLower.includes('frost') || existingLower.includes('frozen') ||
                                   existingLower.includes('dry soil') || existingLower.includes('wet soil') ||
                                   existingLower.includes('moist soil');

        // Only add soil info if it's not already covered and provides unique value
        if (!hasExistingSoilInfo) {
            // Prioritize more critical soil conditions
            if (soilAnalysis.droughtRisk && !existingLower.includes('drought')) {
                contextParts.push(soilAnalysis.description);
            } else if (soilAnalysis.frostRisk && !existingLower.includes('frost')) {
                contextParts.push(soilAnalysis.description);
            } else if (soilAnalysis.condition.includes('very_dry') || soilAnalysis.condition.includes('frozen')) {
                // Only add extreme conditions if not already mentioned
                contextParts.push(soilAnalysis.description);
            }
        }
    }

    // Add atmospheric moisture conditions, avoiding conflicts with existing humidity mentions
    if (atmosphericMoistureAnalysis.description) {
        const hasExistingHumidity = existingLower.includes('humid') || existingLower.includes('dry air') ||
                                   existingLower.includes('moisture') || existingLower.includes('evaporation') ||
                                   existingLower.includes('very dry air') || existingLower.includes('dry atmosphere');
        const hasExistingVPD = existingLower.includes('plant stress') || existingLower.includes('atmospheric dryness');

        // Only add if it provides different information than what's already there
        if (!hasExistingHumidity && !hasExistingVPD) {
            contextParts.push(atmosphericMoistureAnalysis.description);
        } else if (hasExistingHumidity && !hasExistingVPD && atmosphericMoistureAnalysis.plantStress) {
            // If humidity is mentioned but plant stress isn't, add plant stress info
            if (atmosphericMoistureAnalysis.atmosphericDryness === 'very_dry') {
                contextParts.push('significant plant stress from dry air');
            }
        }
    }

    // Add surface pressure analysis for local atmospheric conditions
    if (surfacePressureAnalysis.atmosphericStability !== 'stable') {
        // Check for existing weather stability mentions
        const hasExistingStability = existingLower.includes('stable') || existingLower.includes('unstable') ||
                                   existingLower.includes('variable') || existingLower.includes('settled') ||
                                   existingLower.includes('weather pattern');

        // Only add if it provides unique information about local conditions
        if (!hasExistingStability && surfacePressureAnalysis.weatherImplications.length > 0) {
            // Create a subtle description of atmospheric stability
            if (surfacePressureAnalysis.atmosphericStability === 'very_stable') {
                contextParts.push('very stable local atmosphere');
            } else if (surfacePressureAnalysis.atmosphericStability === 'moderately_unstable') {
                contextParts.push('moderately variable local conditions');
            } else if (surfacePressureAnalysis.atmosphericStability === 'unstable') {
                contextParts.push('unstable local weather patterns');
            }
        }
    }

    // Add cloud layer information for daylight periods, avoiding conflicts with existing cloud mentions
    if (isDaylight && cloudLayerAnalysis.description) {
        const hasExistingClouds = existingLower.includes('cloud') || existingLower.includes('overcast') ||
                                 existingLower.includes('sky') || existingLower.includes('atmosphere');
        if (!hasExistingClouds) {
            contextParts.push(cloudLayerAnalysis.description);
        }
    }

    // Filter out undefined values and return combined context
    const validParts = contextParts.filter(part => part !== undefined);
    return validParts.length > 0 ? validParts.join(', ') : '';
}

/**
 * Calculates perceived time adjustment factors based on season, daylight duration, and weather conditions.
 * Perceived time refers to subjective time experience that can differ from clock time due to
 * psychological, cultural, and environmental factors.
 *
 * Based on research showing seasonal variations in human psychology (Hohm et al., 2023):
 * - Winter: Shorter days and colder temperatures may make time feel slower
 * - Summer: Longer days and warmer temperatures may make time feel faster
 * - Spring: Renewal energy and changing conditions may affect time perception
 * - Autumn: Transition and cooling may influence perceived time passage
 *
 * @param {string} season - Current season ('spring', 'summer', 'autumn', 'winter')
 * @param {number} daylightHours - Number of daylight hours (sunset - sunrise)
 * @param {Object} weather - Weather conditions affecting time perception
 * @returns {Object} Time adjustment factors (multipliers for time period durations)
 */
function getPerceivedTimeFactors(season, daylightHours, weather = null) {
    // Base seasonal factors derived from psychological research on seasonal affective patterns
    // These are conservative estimates based on qualitative research findings
    const baseFactors = {
        spring: { morningStretch: 1.03, daytimeStretch: 1.05, eveningStretch: 0.97 }, // Moderate renewal effect
        summer: { morningStretch: 1.06, daytimeStretch: 1.08, eveningStretch: 0.94 }, // Relaxation from long days
        autumn: { morningStretch: 0.97, daytimeStretch: 0.99, eveningStretch: 1.03 }, // Transition slowing
        winter: { morningStretch: 0.94, daytimeStretch: 0.96, eveningStretch: 1.06 }  // Short days, colder temps
    };

    let factors = baseFactors[season] || { morningStretch: 1.0, daytimeStretch: 1.0, eveningStretch: 1.0 };

    // Daylight duration adjustment - longer days may make time feel slower (conservative effect)
    const daylightAdjustment = Math.max(0.95, Math.min(1.05, daylightHours / 12));
    factors.morningStretch *= daylightAdjustment;
    factors.daytimeStretch *= daylightAdjustment;
    factors.eveningStretch /= daylightAdjustment; // Subtle inverse for evening

    // Weather-based adjustments (supported by time perception research)
    if (weather) {
        const temp = weather.temperature || 20;

        // Cold temperatures may slow perceived time (psychophysical research)
        if (temp < 10) {
            factors.morningStretch *= 0.97;
            factors.daytimeStretch *= 0.98;
        } else if (temp > 25) {
            // Warm temperatures may slightly accelerate perceived time
            factors.morningStretch *= 1.02;
            factors.daytimeStretch *= 1.01;
        }
    }

    // Ensure factors stay within conservative bounds to avoid extreme distortions
    factors.morningStretch = Math.max(0.85, Math.min(1.15, factors.morningStretch));
    factors.daytimeStretch = Math.max(0.90, Math.min(1.10, factors.daytimeStretch));
    factors.eveningStretch = Math.max(0.90, Math.min(1.15, factors.eveningStretch));

    return factors;
}

/**
 * Determines the most accurate time period and transitional state for the current moment,
 * factoring in precise solar events, season, and weather conditions.
 *
 * @param {Object} time - The current time object (from getCurrentTime()), including hour, minute, and timestamp.
 * @param {string} season - The current season (e.g., 'spring', 'summer', 'autumn', 'winter').
 * @param {Object} location - Geographic location object used for sunrise/sunset calculations (latitude, longitude).
 * @param {Object} weather - (Optional) Weather data object for adjusting lighting and atmospheric descriptions (e.g., cloudCoverage, uvIndex, temperature).
 * @returns {Object} An object containing:
 *   - period: Human-readable description of the time period (e.g., "Early Morning", "Golden Hour").
 *   - periodKey: Machine-friendly key for the period (e.g., "early_morning", "golden_hour").
 *   - lighting: Description of lighting conditions, accounting for sun position and weather.
 *   - atmosphere: Description of atmospheric qualities, including weather and seasonal context.
 *   - season: The current season.
 *   - timeOfDay: General time of day ("morning", "afternoon", "evening/night", etc.).
 *   - transitionType: Specific transition state (e.g., "sunrise_transition", "sunset_transition", "steady_state").
 */
async function determineTimePeriod(time, season, location, weather = null) {
    const currentHour = time.hour + time.minute / 60; // Decimal hour

    try {
        let sunTimes;

        // Use weather data sunrise/sunset if available (more accurate than astronomical calculation)
        if (weather && weather.sunrise && weather.sunset && location.timezone) {
            // Convert UTC sunrise/sunset to local time using timezone
            const sunriseUTC = new Date(weather.sunrise);
            const sunsetUTC = new Date(weather.sunset);

            // Convert to local time using timezone
            const sunriseLocal = new Date(sunriseUTC.toLocaleString('en-US', { timeZone: location.timezone }));
            const sunsetLocal = new Date(sunsetUTC.toLocaleString('en-US', { timeZone: location.timezone }));

            const sunriseHour = sunriseLocal.getHours() + sunriseLocal.getMinutes() / 60 + sunriseLocal.getSeconds() / 3600;
            const sunsetHour = sunsetLocal.getHours() + sunsetLocal.getMinutes() / 60 + sunsetLocal.getSeconds() / 3600;

            sunTimes = {
                sunrise: sunriseLocal.getTime(),
                sunset: sunsetLocal.getTime(),
                sunriseHour,
                sunsetHour,
                isPolarDay: false,
                isPolarNight: false,
                source: 'weather_api'
            };
        } else {
            // Fall back to astronomical calculation
            // Create date at noon UTC for the given date to ensure consistent timezone handling
            const utcDate = new Date(Date.UTC(time.year, time.month, time.dayOfMonth, 12, 0, 0));
            sunTimes = await getSunriseSunset(location, utcDate);
        }

        // Check for polar conditions or calculation errors
        if (sunTimes.isPolarDay) {
            return {
                period: 'polar day, midnight sun, continuous daylight',
                periodKey: 'polar_day',
                lighting: 'continuous daylight, no darkness, sun always visible',
                atmosphere: 'arctic or antarctic conditions with constant illumination',
                season: season,
                timeOfDay: 'daylight',
                transitionType: 'polar_conditions',
                polarCondition: 'polar_day'
            };
        } else if (sunTimes.isPolarNight) {
            return {
                period: 'polar night, extended darkness',
                periodKey: 'polar_night',
                lighting: 'extended nighttime darkness, no sunlight, stars and aurora visible',
                atmosphere: 'arctic or antarctic conditions with extended darkness',
                season: season,
                timeOfDay: 'night',
                transitionType: 'polar_conditions',
                polarCondition: 'polar_night'
            };
        }

        // Convert sunrise/sunset to decimal hours in local time
        const sunriseHour = sunTimes.sunriseHour;
        const sunsetHour = sunTimes.sunsetHour;

        // Safety check for null values
        if (sunriseHour === null || sunsetHour === null) {
            return {
                period: 'unknown time period',
                periodKey: 'unknown',
                lighting: 'unable to determine lighting conditions',
                atmosphere: 'weather data unavailable for time calculation',
                season: season,
                timeOfDay: 'unknown',
                transitionType: 'unknown',
                error: 'Sunrise/sunset calculation failed'
            };
        }

        // Calculate perceived time adjustments based on season and daylight
        const daylightHours = sunsetHour - sunriseHour;
        const perceivedTimeFactors = getPerceivedTimeFactors(season, daylightHours, weather);

        // Calculate solar noon (when sun is at its highest point) as midpoint between sunrise and sunset
        const solarNoon = (sunriseHour + sunsetHour) / 2;

        // Define granular time periods with transitions and perceived time adjustments
        const dawnStart = sunriseHour - 1;         // 1 hour before sunrise
        const sunriseStart = sunriseHour - 0.25;   // 15 min before sunrise
        const sunriseEnd = sunriseHour + 0.25;     // 15 min after sunrise
        const earlyMorningEnd = sunriseHour + 1 * perceivedTimeFactors.morningStretch;   // 1 hour after sunrise (adjusted)
        const morningEnd = sunriseHour + 2.5 * perceivedTimeFactors.morningStretch;      // 2.5 hours after sunrise (~9-10 AM)
        const daytimeStart = solarNoon - 1.5 * perceivedTimeFactors.daytimeStretch;      // Start 1.5 hours before solar noon (adjusted)

        const goldenHourStart = sunsetHour - 0.75; // 45 min before sunset

        // Define afternoon period as 2 hours before golden hour (adjusted for perceived time)
        const afternoonStart = goldenHourStart - 2 * perceivedTimeFactors.eveningStretch; // 2 hours before golden hour

        // Define daytime period around solar noon (when sun is highest in sky)
        const daytimeEnd = afternoonStart;         // End when afternoon starts
        const sunsetStart = sunsetHour - 0.25;     // 15 min before sunset
        const sunsetEnd = sunsetHour + 0.25;       // 15 min after sunset
        const duskEnd = sunsetHour + 0.75 * perceivedTimeFactors.eveningStretch;         // 45 min after sunset (adjusted)
        const earlyEveningEnd = sunsetHour + 1.5 * perceivedTimeFactors.eveningStretch;  // 1.5 hours after sunset (adjusted)
        const eveningEnd = sunsetHour + 3 * perceivedTimeFactors.eveningStretch;         // 3 hours after sunset (adjusted)

        // Determine detailed time period with lighting characteristics
        let periodKey, periodDescription, lightingDescription, atmosphericNotes;

        // Debug: Log time calculations with perceived time adjustments
        console.log(`🌅 Its Currently ${currentHour.toFixed(2)}:${time.minute.toFixed(2)} // ${time.dayOfWeek} // ${time.month} ${time.dayOfMonth}, ${time.year}`);
        console.log(`🌅 Sunrise: ${sunriseHour.toFixed(2)}, Sunset: ${sunsetHour.toFixed(2)} (${daylightHours.toFixed(1)}h daylight)`);
        console.log(`🌅 Perceived Time Factors (${season}): morning=${perceivedTimeFactors.morningStretch.toFixed(2)}, daytime=${perceivedTimeFactors.daytimeStretch.toFixed(2)}, evening=${perceivedTimeFactors.eveningStretch.toFixed(2)}`);
        console.log(`🌅 Morning End: ${(sunriseHour + 2.5 * perceivedTimeFactors.morningStretch).toFixed(2)}, Daytime Start: ${daytimeStart.toFixed(2)}`);
        console.log(`🌅 Solar Noon: ${solarNoon.toFixed(2)}`);
        console.log(`🌅 Daytime Period: ${daytimeStart.toFixed(2)} - ${daytimeEnd.toFixed(2)}`);
        console.log(`🌅 Afternoon Period: ${afternoonStart.toFixed(2)} - ${goldenHourStart.toFixed(2)}`);

        // Extract comprehensive weather factors for lighting and atmosphere adjustments
        const cloudCoverage = weather?.cloudCoverage || 0;
        const uvIndex = weather?.uvIndex || 0;
        const temperature = weather?.temperature || 20; // Default to moderate temperature
        const humidity = weather?.humidity || 50; // Default to moderate humidity
        const precipitationRate = weather?.precipitationRate || 0;
        const precipitationType = weather?.precipitationType || 'rain'; // Default to rain if not specified
        const environmentType = weather?.environmentType || location?.environmentType || 'mixed'; // urban, natural, or mixed
        // Use average wind speed if available, otherwise use the single windSpeed value
        const windSpeed = (weather?.windSpeed?.avg !== undefined) ? weather.windSpeed.avg : (weather?.windSpeed || 0);
        const dewPoint = weather?.dewPoint || 15; // Default moderate dew point
        const isDaylight = currentHour >= sunriseHour && currentHour <= sunsetHour;

        // Extract advanced environmental data
        const soilTemperature = weather?.soilTemperature;
        const soilMoisture = weather?.soilMoisture;
        const evapotranspiration = weather?.evapotranspiration;
        const et0 = weather?.et0;
        const vapourPressureDeficit = weather?.vapourPressureDeficit;
        const cloudCoverLow = weather?.cloudCoverLow;
        const cloudCoverMid = weather?.cloudCoverMid;
        const cloudCoverHigh = weather?.cloudCoverHigh;

        // Perform advanced environmental analysis
        const soilAnalysis = analyzeSoilConditions(soilTemperature, soilMoisture, temperature);
        const atmosphericMoistureAnalysis = analyzeAtmosphericMoisture(evapotranspiration, et0, vapourPressureDeficit, temperature, humidity);
        const cloudLayerAnalysis = analyzeCloudLayers(cloudCoverLow, cloudCoverMid, cloudCoverHigh, cloudCoverage);
        const surfacePressureAnalysis = analyzeSurfacePressure(weather?.surfacePressure || weather?.pressure, weather?.pressure, weather?.location?.altitude || 0);

        // Calculate derived weather factors
        const temperatureDewPointDiff = temperature - dewPoint; // For moisture assessment
        const isHumid = humidity >= 70;
        const isDry = humidity <= 30;
        const hasPrecipitation = precipitationRate > 0;
        const isWindy = windSpeed >= 20; // m/s threshold for noticeable wind (20 m/s minimum)
        const isCold = temperature <= 5;
        const isHot = temperature >= 25;

        if (currentHour >= dawnStart && currentHour < sunriseStart) {
            periodKey = 'dawn';
            periodDescription = 'dawn, pre-sunrise, soft pre-dawn light';
            // Smooth blend from deep night to pre-sunrise illumination using legacy {} syntax
            const blendFactor = (currentHour - dawnStart) / (sunriseStart - dawnStart); // 0 to 1 over dawn period
            const nightWeight = Math.max(0.8 - blendFactor * 0.6, 0.1); // Night sky fades from 0.8 to 0.1
            const preSunWeight = Math.min(0.2 + blendFactor * 0.6, 0.9); // Pre-sun illumination builds from 0.2 to 0.9

            // Use legacy {} and [] syntax: {} adds emphasis, [] subtracts emphasis
            const nightBrackets = Math.round((1 - nightWeight) * 3); // Night sky fading (use [] to subtract)
            const preSunBraces = Math.round(preSunWeight * 3); // Pre-sun building (use {} to add)
            const nightText = nightBrackets > 0 ? '['.repeat(nightBrackets) + 'night sky fading' + ']'.repeat(nightBrackets) : '';
            const preSunText = preSunBraces > 0 ? '{'.repeat(preSunBraces) + 'pre-sunrise illumination' + '}'.repeat(preSunBraces) : '';

            // Build dawn lighting and atmosphere with comprehensive weather effects
            let lightingParts = [nightText, preSunText].filter(Boolean);

            // Build atmosphere base based on temperature
            let atmosphereBase;
            if (isCold) {
                atmosphereBase = 'cold, crisp and sharp, peaceful';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', frost forming on surfaces';
                }
                // Add soil frost information for dawn
                if (soilAnalysis.frostRisk) {
                    atmosphereBase += ', ground frost';
                }
            } else if (isHot) {
                atmosphereBase = 'warm, humid pre-dawn air, peaceful';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', heavy dew forming';
                }
            } else {
                atmosphereBase = 'cool, peaceful';
            }
            atmosphereBase += ', anticipation of sunrise';

            // Integrate atmospheric moisture for fog/mist formation
            if (atmosphericMoistureAnalysis.atmosphericDryness === 'very_dry') {
                atmosphereBase += ', exceptionally dry air';
            } else if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                atmosphereBase += ', evaporative mist rising from surfaces';
            }

            // Humidity affects lighting quality with environmental context
            if (isHumid && temperatureDewPointDiff < 5) {
                if (atmosphericMoistureAnalysis.atmosphericDryness === 'humid') {
                    atmosphereBase += ', thick fog hanging low with atmospheric moisture content';
                } else {
                    atmosphereBase += ', mist hanging low';
                }
            } else if (isDry) {
                atmosphereBase += ', exceptionally clear and dry air';
                if (atmosphericMoistureAnalysis.atmosphericDryness === 'very_dry') {
                    atmosphereBase += ' with significant atmospheric dryness';
                }
            }

            // Precipitation affects atmosphere
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += `, light ${precipitationType} fall`;
                } else {
                    if (precipitationType === 'rain') {
                        atmosphereBase += ', fine drizzle in the air';
                    } else {
                        atmosphereBase += ', fine mist in the air';
                    }
                }
            }

            // Wind affects atmosphere
            if (isWindy) {
                atmosphereBase += ', noticeable wind stirring the pre-dawn air';
                lightingParts.push('with subtle wind movement');
            } else {
                atmosphereBase += ', still air with minimal movement';
            }

            // Cloud coverage effects
            if (cloudCoverage >= 80) {
                // Heavy overcast completely changes the lighting character
                lightingParts = ['muted pre-dawn illumination under heavy overcast conditions'];
                atmosphereBase += ', heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingParts.push('diffused through moderate cloud cover');
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingParts.push('filtered by light cloud cover');
                atmosphereBase += ' with light cloud filtering of emerging light';
            }

            lightingDescription = lightingParts.join(', ');
            atmosphericNotes = atmosphereBase;
        } else if (currentHour >= sunriseStart && currentHour < sunriseEnd) {
            periodKey = 'sunrise';
            periodDescription = 'sunrise, sun rising, golden morning light';
            // Smooth sunrise transition: pre-sunrise -> sun illuminating -> peak golden using legacy {} syntax
            const blendFactor = (currentHour - sunriseStart) / (sunriseEnd - sunriseStart); // 0 to 1 over sunrise period
            const preSunWeight = Math.max(0.7 - blendFactor * 0.6, 0.1); // Pre-sun fades from 0.7 to 0.1
            const sunIlluminatingWeight = 0.3 + blendFactor * 0.5; // Sun illumination builds from 0.3 to 0.8
            const peakGoldenWeight = Math.max(0.1, blendFactor * 0.4 - 0.1); // Peak golden builds from 0.1 to 0.3

            // Use legacy {} and [] syntax: {} adds emphasis, [] subtracts emphasis
            const preSunBrackets = Math.round((1 - preSunWeight) * 3); // Pre-sun fading (use [] to subtract)
            const sunIlluminatingBraces = Math.round(sunIlluminatingWeight * 3); // Sun illuminating building (use {} to add)
            const peakGoldenBraces = Math.round(peakGoldenWeight * 3); // Peak golden building (use {} to add)
            const preSunText = preSunBrackets > 0 ? '['.repeat(preSunBrackets) + 'pre-sunrise illumination' + ']'.repeat(preSunBrackets) : '';
            const sunIlluminatingText = sunIlluminatingBraces > 0 ? '{'.repeat(sunIlluminatingBraces) + 'sun beginning to illuminate' + '}'.repeat(sunIlluminatingBraces) : '';
            const peakGoldenText = peakGoldenBraces > 0 ? '{'.repeat(peakGoldenBraces) + 'peak golden light' + '}'.repeat(peakGoldenBraces) : '';

            // Build sunrise lighting and atmosphere with comprehensive weather effects
            let lightingParts = [preSunText, sunIlluminatingText, peakGoldenText].filter(Boolean);

            // Build atmosphere base based on temperature
            let atmosphereBase;
            if (isCold) {
                atmosphereBase = 'crisp cold morning air';
                if (temperatureDewPointDiff < 5) {
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ', frost sparkling on surfaces';
                    } else {
                        atmosphereBase += ', ice crystals sparkling on surfaces';
                    }
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' with ground frost catching golden light';
                    }
                }
            } else if (isHot) {
                atmosphereBase = 'warm humid morning air';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', heavy morning dew glistening';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ' with evaporating dew creating misty effects';
                }
            } else {
                atmosphereBase = 'fresh morning air';
            }
            atmosphereBase += ', dew on surfaces, birds awakening, new day energy';

            // Humidity affects light quality and atmosphere with environmental context
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ', morning fog lifting slowly';
                lightingParts.push('with diffused golden rays piercing mist');
                if (atmosphericMoistureAnalysis.atmosphericDryness === 'humid') {
                    atmosphereBase += ' with saturated atmospheric moisture';
                }
            } else if (isDry) {
                atmosphereBase += ', exceptionally clear and dry morning air';
                lightingParts.push('golden illumination');
                if (atmosphericMoistureAnalysis.atmosphericDryness === 'very_dry') {
                    atmosphereBase += ' under extremely dry atmospheric conditions';
                }
            }

            // Precipitation affects atmosphere
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += `, ${precipitationType} with golden lighting`;
                    lightingParts.push(`${precipitationType} with golden light rays`);
                } else {
                    atmosphereBase += ', fine mist enhancing golden glow';
                }
            }

            // Wind affects atmosphere and light
            if (isWindy) {
                atmosphereBase += ', wind carrying fresh morning energy';
                lightingParts.push('wind moving through golden light');
            } else {
                atmosphereBase += ', calm morning stillness';
            }

            // Cloud coverage effects
            if (cloudCoverage >= 80) {
                // Heavy overcast completely changes sunrise character
                lightingParts = ['diffused early morning light under heavy overcast conditions'];
                atmosphereBase += ', heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingParts.push('diffused through moderate cloud cover');
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingParts.push('filtered by light cloud cover');
                atmosphereBase += ' with light cloud filtering of golden sunlight';
            }

            // Add UV effects for sunrise
            if (uvIndex > 0) {
                const effectiveUV = uvIndex * (1 - cloudCoverage / 100);
                if (effectiveUV >= 6) {
                    lightingParts.push('strong UV presence');
                } else if (effectiveUV >= 3) {
                    lightingParts.push('moderate UV levels');
                }
            }

            lightingDescription = lightingParts.join(', ');
            atmosphericNotes = atmosphereBase;
        } else if (currentHour >= sunriseEnd && currentHour < earlyMorningEnd) {
            periodKey = 'early_morning';
            periodDescription = 'early morning, post-sunrise, fresh morning atmosphere';
            // Build early morning lighting and atmosphere with comprehensive weather effects
            // Build lighting and atmosphere bases based on temperature
            let lightingBase, atmosphereBase;
            if (isCold) {
                lightingBase = 'sharp bright morning light, soft shadows, cool blueish undertones';
                atmosphereBase = 'bitterly cold crisp air, morning dew, freezing temperatures, quiet activity';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', frost patterns on surfaces';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' with ground frost clearly visible';
                    }
                }
            } else if (isHot) {
                lightingBase = 'bright morning light, soft shadows, golden undertones';
                atmosphereBase = 'warm humid morning air, morning dew, increasing temperatures, quiet activity';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', heavy dew evaporating quickly';
                    if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                        atmosphereBase += ' creating steamy morning air';
                    }
                }
            } else {
                lightingBase = 'bright morning light, soft shadows, cool blueish undertones';
                atmosphereBase = 'crisp fresh air, morning dew, cool temperatures, quiet activity';
            }

            // Humidity affects atmosphere and light quality
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ', humid mist hanging in low areas';
                lightingBase += ', soft focus, diffused lighting';
            } else if (isDry) {
                atmosphereBase += ', exceptionally dry morning air';
                lightingBase += ', clear lighting';
            }

            // Precipitation affects atmosphere and lighting
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += `, light ${precipitationType} on surfaces`;
                    lightingBase += `, light refraction, ${precipitationType} droplets reflecting sunlight`;
                } else {
                    atmosphereBase += ', fine mist in the air';
                }
            }

            // Wind affects atmosphere (not lighting directly)
            if (isWindy) {
                atmosphereBase += ', windy';
            }

            // Cloud coverage effects
            if (cloudCoverage >= 80) {
                lightingBase = 'muted morning light, soft shadows, cool blueish undertones under heavy overcast conditions';
                atmosphereBase += ', heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'bright morning light diffused through moderate cloud cover, soft shadows, cool blueish undertones';
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'bright morning light filtered by light cloud cover, soft shadows, cool blueish undertones';
                atmosphereBase += ' with light cloud cover';
            }

            // UV effects are atmospheric, not lighting-related

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;
        } else if (currentHour >= earlyMorningEnd && currentHour < morningEnd) {
            periodKey = 'morning';
            periodDescription = 'morning, mid-morning, bright daylight';
            // Build morning lighting and atmosphere with weather effects
            // Build lighting and atmosphere bases based on temperature and season
            let lightingBase, atmosphereBase;
            if (isCold) {
                lightingBase = 'sharp bright morning sunlight, defined shadows, clear illumination';
                atmosphereBase = 'cool, active morning atmosphere';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', frost sublimating in sunlight';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' with lingering ground frost';
                    }
                }
                // Add seasonal context for cold temperatures
                if (season === 'winter') {
                    atmosphereBase += ', crisp winter morning theme';
                } else if (season === 'autumn') {
                    atmosphereBase += ', autumn cool theme';
                }
            } else if (isHot) {
                lightingBase = 'bright morning sunlight, defined shadows, clear illumination';
                atmosphereBase = 'warm, active morning atmosphere theme';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', humidity rising with morning warmth';
                    if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                        atmosphereBase += ' creating warming evaporative effects';
                    }
                }
                // Add seasonal context for hot temperatures
                if (season === 'summer') {
                    atmosphereBase += ', summer morning heat';
                } else if (season === 'spring') {
                    atmosphereBase += ', spring warmth';
                }
            } else {
                // Moderate temperatures - describe based on seasonal context
                lightingBase = 'bright morning sunlight, defined shadows, clear illumination';
                if (season === 'winter') {
                    atmosphereBase = 'chilly morning atmosphere, cool winter air';
                } else if (season === 'spring') {
                    atmosphereBase = 'fresh morning atmosphere, mild spring conditions';
                } else if (season === 'summer') {
                    atmosphereBase = 'golden, active morning atmosphere';
                } else if (season === 'autumn') {
                    atmosphereBase = 'cool morning atmosphere, crisp autumn air';
                } else {
                    atmosphereBase = 'moderate morning atmosphere';
                }
            }

            // Humidity affects atmosphere and light quality
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid air softening morning light';
                lightingBase += ' , softly diffused lighting through haze';
            } else if (isDry) {
                atmosphereBase += ' , exceptionally dry crisp air';
                lightingBase += ' , intense lighting';
            }

            // Precipitation affects atmosphere and lighting
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , ${precipitationType} dampening morning energy`;
                    lightingBase += ` , light refraction, ${precipitationType} droplets reflecting sunlight`;
                } else {
                    atmosphereBase += ' , fine mist softening atmosphere';
                }
            }

            // Wind affects atmosphere (not lighting directly)
            if (isWindy) {
                atmosphereBase += ' , wind energizing morning atmosphere';
            } else {
                atmosphereBase += ' , calm morning serenity';
            }

            // Cloud coverage effects
            if (cloudCoverage >= 80) {
                lightingBase = 'muted morning sunlight, defined shadows, diffused illumination under heavy overcast conditions';
                atmosphereBase += ' , heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'bright morning sunlight diffused through moderate cloud cover, defined shadows, clear illumination';
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'bright morning sunlight filtered by light cloud cover, defined shadows, clear illumination';
                atmosphereBase += ' with light cloud cover';
            }

            // UV effects are atmospheric, not lighting-related

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;

            if (cloudCoverage >= 80) {
                lightingBase = 'muted morning sunlight, defined shadows, diffused illumination under heavy overcast conditions';
                atmosphereBase = 'warm, morning atmosphere, heavy cloud cover reducing visibility';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'bright morning sunlight diffused through moderate cloud cover, defined shadows, clear illumination';
                atmosphereBase = 'warm, morning atmosphere with moderate cloud cover';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'bright morning sunlight filtered by light cloud cover, defined shadows, clear illumination';
                atmosphereBase = 'warm, morning atmosphere with light cloud filtering of sunlight';
            }

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;

            // UV effects are atmospheric, not lighting-related
        } else if (currentHour >= morningEnd && currentHour < daytimeStart) {
            periodKey = 'late_morning';
            periodDescription = 'late morning, approaching noon, intense daylight';
            console.log(`🌅 SELECTED: late_morning (${currentHour.toFixed(2)} is between ${morningEnd.toFixed(2)} and ${daytimeStart.toFixed(2)})`);
            // Build late morning lighting and atmosphere with weather effects
            // Build lighting and atmosphere bases based on temperature
            let lightingBase, atmosphereBase;
            if (isCold) {
                lightingBase = 'sharp overhead light';
                atmosphereBase = 'cool crisp air, peak morning activity, bright and clear';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', frost lingering in shaded areas';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' persistent ground frost in shadows';
                    }
                }
            } else if (isHot) {
                lightingBase = 'intense overhead light';
                atmosphereBase = 'hot building air, peak morning activity, bright and clear';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', humidity creating sultry atmosphere';
                    if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                        atmosphereBase += ' intense evaporative heat';
                    }
                }
                if (atmosphericMoistureAnalysis.atmosphericDryness === 'very_dry') {
                    atmosphereBase += ' under very dry atmospheric conditions';
                }
            } else {
                lightingBase = 'harsh overhead light';
                atmosphereBase = 'warm air, peak morning activity, bright and clear';
            }

            // Humidity affects atmosphere and light quality
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid air softening harsh light';
                lightingBase += ' , softly diffused lighting';
            } else if (isDry) {
                atmosphereBase += ' , exceptionally dry air amplifying brightness';
                lightingBase += ' , intense lighting';
            }

            // Precipitation affects atmosphere and lighting
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , ${precipitationType} in cool morning heat`;
                    lightingBase += ` , light refraction, ${precipitationType} droplets reflecting light`;
                } else {
                    atmosphereBase += ' , fine mist cooling atmosphere';
                }
            }

            // Wind affects atmosphere (not lighting directly)
            if (isWindy) {
                atmosphereBase += ' , wind disrupting morning calm';
            } else {
                atmosphereBase += ' , still morning intensity';
            }

            // Cloud coverage effects
            if (cloudCoverage >= 80) {
                lightingBase = 'diffused overhead light, dark shadows, reduced contrast under heavy overcast conditions';
                atmosphereBase += ' , heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'harsh overhead light diffused through moderate cloud cover, dark shadows';
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'harsh overhead light filtered by light cloud cover, dark shadows';
                atmosphereBase += ' with light cloud cover';
            }

            // UV effects are atmospheric, not lighting-related

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;

            if (cloudCoverage >= 80) {
                lightingBase = 'diffused overhead light, dark shadows, reduced contrast under heavy overcast conditions';
                atmosphereBase = 'warm air, morning activity, heavy cloud cover reducing visibility';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'harsh overhead light diffused through moderate cloud cover, dark shadows';
                atmosphereBase = 'warm air, morning activity, bright conditions with moderate cloud cover';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'harsh overhead light filtered by light cloud cover, dark shadows';
                atmosphereBase = 'warm air, morning activity, bright and clear with light cloud filtering of sunlight';
            }

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;

            // UV effects are atmospheric, not lighting-related
        } else if (currentHour >= daytimeStart && currentHour <= daytimeEnd) {
            periodKey = 'daytime';
            periodDescription = 'daytime, high sun, gentle overhead light';
            console.log(`🌅 SELECTED: daytime (${currentHour.toFixed(2)} is between ${daytimeStart.toFixed(2)} and ${daytimeEnd.toFixed(2)})`);
            // Build daytime lighting and atmosphere with weather effects
            // Similar to afternoon but with more intense overhead lighting
            let lightingBase, atmosphereBase;
            if (isCold) {
                lightingBase = 'gentle overhead light';
                atmosphereBase = 'cool, maximum daylight exposure';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', crisp cool air at peak intensity';
                }
                if (soilAnalysis.groundHeatRetention) {
                    atmosphereBase += ' with cool ground retaining some warmth';
                }
            } else if (isHot) {
                lightingBase = 'overhead lighting, soft shadows';
                atmosphereBase = 'hot, maximum heat shimmer and sun heat exposure';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', oppressive humid heat at its peak';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ', intense heat shimmer';
                }
                if (atmosphericMoistureAnalysis.atmosphericDryness === 'very_dry') {
                    atmosphereBase += ' dry air and extreme heat distortion';
                }
            } else {
                lightingBase = 'gentle overhead light';
                atmosphereBase = 'warm, maximum daylight intensity';
            }

            // Humidity affects atmosphere and light quality
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid air creating intense haze effects';
                lightingBase += ' , softly diffused lighting';
            } else if (isDry) {
                atmosphereBase += ' , exceptionally dry air amplifying maximum brightness';
                lightingBase += ' , intense lighting';
            }

            // Precipitation affects atmosphere and lighting
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , ${precipitationType} cool intense daylight`;
                    lightingBase += ` , light refraction, ${precipitationType} droplets reflecting overhead light rays`;
                } else {
                    atmosphereBase += ' , fine mist cooling hot surfaces under peak sun';
                }
            }

            // Wind affects atmosphere (not lighting directly)
            if (isWindy) {
                atmosphereBase += ' , wind disrupting intense daylight calm';
            } else {
                atmosphereBase += ' , still intense daylight maximum';
            }

            // Cloud coverage effects
            if (cloudCoverage >= 80) {
                lightingBase = 'diffused intense overhead light, reduced contrast under heavy overcast at solar peak';
                atmosphereBase += ' , heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'intense overhead light diffused through moderate cloud cover';
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'intense overhead light filtered by light cloud cover';
                atmosphereBase += ' with light cloud filtering of maximum sunlight';
            }

            // UV effects are atmospheric, not lighting-related

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;
        } else if (currentHour >= afternoonStart && currentHour < goldenHourStart) {
            periodKey = 'afternoon';
            periodDescription = 'afternoon, full daylight, warm sunlight';
            console.log(`🌅 SELECTED: afternoon (${currentHour.toFixed(2)} is between ${afternoonStart.toFixed(2)} and ${goldenHourStart.toFixed(2)})`);
            // Build afternoon lighting and atmosphere with weather effects
            // Build lighting and atmosphere bases based on temperature and season
            let lightingBase, atmosphereBase = 'afternoon atmosphere';
            if (isCold) {
                lightingBase = 'cool daytime light, moderate shadows';
                atmosphereBase = 'cool, active atmosphere, no heat shimmer';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', crisp cool';
                }
                if (soilAnalysis.groundHeatRetention) {
                    atmosphereBase += ' with cool temperatures';
                }
                // Add seasonal context for cold temperatures
                if (season === 'winter') {
                    atmosphereBase += ', winter cool theme';
                } else if (season === 'autumn') {
                    atmosphereBase += ', crisp autumn theme';
                }
            } else if (isHot) {
                lightingBase = 'warm daytime light, soft shadows';
                atmosphereBase = 'golden, active atmosphere, strong heat shimmer developing';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', oppressive humid heat';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ' with intense evaporative cooling effects and pronounced heat waves';
                }
                if (atmosphericMoistureAnalysis.atmosphericDryness === 'very_dry') {
                    atmosphereBase += ' under extremely dry air conditions with severe heat distortion';
                }
                // Add seasonal context for hot temperatures
                if (season === 'summer') {
                    atmosphereBase += ', summer heat';
                } else if (season === 'spring') {
                    atmosphereBase += ', warmth';
                }
            } else {
                // Moderate temperatures - describe based on seasonal context
                lightingBase = 'moderate daytime light, balanced shadows';
                if (season === 'winter') {
                    atmosphereBase = 'chilly, active atmosphere, cool winter theme';
                } else if (season === 'spring') {
                    atmosphereBase = 'fresh, active atmosphere, spring theme';
                } else if (season === 'summer') {
                    atmosphereBase = 'warm, active atmosphere, slight heat shimmer possible';
                } else if (season === 'autumn') {
                    atmosphereBase = 'cool, active atmosphere, crisp autumn theme';
                } else {
                    atmosphereBase = 'moderate';
                }
            }

            // Humidity affects atmosphere and light quality
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid air amplifying heat effects';
                lightingBase += ' , softly diffused lighting through haze';
            } else if (isDry) {
                atmosphereBase += ' , dry air intensifying heat';
                lightingBase += ' , intense lighting';
            }

            // Precipitation affects atmosphere and lighting
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , ${precipitationType} providing cooling relief`;
                    lightingBase += ` , light refraction, ${precipitationType} droplets reflecting light`;
                } else {
                    atmosphereBase += ' , fine mist cooling hot surfaces';
                }
            }

            // Wind affects atmosphere (not lighting directly)
            if (isWindy) {
                atmosphereBase += ' , wind providing some heat relief';
            } else {
                atmosphereBase += ' , still hot afternoon air';
            }

            // Cloud coverage effects
            if (cloudCoverage >= 80) {
                lightingBase = 'muted daytime light, moderate shadows under heavy overcast conditions';
                atmosphereBase += ' , heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'warm daytime light diffused through moderate cloud cover, moderate shadows';
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'warm daytime light filtered by light cloud cover, moderate shadows';
                atmosphereBase += ' with light cloud cover';
            }

            // UV effects are atmospheric, not lighting-related

            // Apply cloud coverage effects while preserving temperature-based atmosphere and lighting
            if (cloudCoverage >= 80) {
                if (season === 'winter') {
                    lightingBase = 'muted cool light, soft shadows under heavy winter overcast';
                } else if (season === 'summer') {
                    lightingBase = 'muted warm light, soft shadows under heavy summer overcast';
                } else {
                    lightingBase = 'muted daytime light, soft shadows under heavy overcast conditions';
                }
                atmosphereBase += 'heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                if (season === 'winter') {
                    lightingBase = 'cool daytime light diffused through moderate cloud cover, soft shadows';
                } else if (season === 'summer') {
                    lightingBase = 'warm daytime light diffused through moderate cloud cover, soft shadows';
                } else {
                    lightingBase = 'moderate daytime light diffused through moderate cloud cover, soft shadows';
                }
                atmosphereBase += 'moderate cloud diffusion affecting light quality';
            } else if (cloudCoverage >= 20) {
                if (season === 'winter') {
                    lightingBase = 'cool daytime light filtered by light cloud cover, moderate shadows';
                } else if (season === 'summer') {
                    lightingBase = 'warm daytime light filtered by light cloud cover, moderate shadows';
                } else {
                    lightingBase = 'moderate daytime light filtered by light cloud cover, moderate shadows';
                }
                atmosphereBase += 'light cloud filtering of sunlight';
            }

            // UV effects are atmospheric, not lighting-related

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;
        } else if (currentHour >= goldenHourStart && currentHour < sunsetStart) {
            periodKey = 'golden_hour';
            periodDescription = 'golden hour, pre-sunset, warm magical light';
            // Smooth golden hour transition: warm daylight -> sunset colors building using legacy {} syntax
            const blendFactor = (currentHour - goldenHourStart) / (sunsetStart - goldenHourStart); // 0 to 1 over golden hour
            const warmDaylightWeight = Math.max(0.8 - blendFactor * 0.7, 0.1); // Daylight fades from 0.8 to 0.1
            const sunsetColorsWeight = Math.min(0.2 + blendFactor * 0.7, 0.9); // Sunset colors build from 0.2 to 0.9

            // Use legacy {} and [] syntax: {} adds emphasis, [] subtracts emphasis
            const warmDaylightBrackets = Math.round((1 - warmDaylightWeight) * 3); // Warm daylight fading (use [] to subtract)
            const sunsetColorsBraces = Math.round(sunsetColorsWeight * 3); // Sunset colors building (use {} to add)
            const warmDaylightText = warmDaylightBrackets > 0 ? '['.repeat(warmDaylightBrackets) + 'warm golden light' + ']'.repeat(warmDaylightBrackets) : '';
            const sunsetColorsText = sunsetColorsBraces > 0 ? '{'.repeat(sunsetColorsBraces) + 'sunset colors building' + '}'.repeat(sunsetColorsBraces) : '';

            // Build golden hour lighting and atmosphere with weather effects
            let lightingParts = [warmDaylightText, sunsetColorsText].filter(Boolean);

            // Build atmosphere base based on temperature
            let atmosphereBase;
            if (isCold) {
                atmosphereBase = 'cool golden glow, peaceful transition, anticipation of evening';
                // Modify lighting parts for cold conditions
                lightingParts = lightingParts.map(part => part.replace('warm golden light', 'cool golden light'));
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', crisp cool air with golden frost highlights';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' and visible ground frost in golden light';
                    }
                }
            } else if (isHot) {
                atmosphereBase = 'intense golden glow, peaceful transition, anticipation of evening';
                lightingParts.push('with heat amplifying golden intensity');
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', humid air enriching golden colors';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ' with lingering evaporative warmth';
                }
                if (atmosphericMoistureAnalysis.atmosphericDryness === 'very_dry') {
                    lightingParts.push('intense golden haze');
                    atmosphereBase += ' under exceptionally dry air conditions';
                }
            } else {
                atmosphereBase = 'warm glow, peaceful transition, anticipation of evening';
            }

            // Humidity affects golden hour quality
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid air softening golden edges';
                lightingParts.push('diffused golden rays through mist');
            } else if (isDry) {
                atmosphereBase += ' , exceptionally clear golden illumination';
            }

            // Precipitation affects golden atmosphere
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , ${precipitationType} catching golden light`;
                    lightingParts.push(`with ${precipitationType} sparkling in golden rays`);
                } else {
                    atmosphereBase += ' , fine mist enhancing golden glow';
                }
            }

            // Wind affects golden light movement
            if (isWindy) {
                atmosphereBase += ' , wind moving through golden atmosphere';
                lightingParts.push('with wind dancing golden light');
            } else {
                atmosphereBase += ' , still golden hour serenity';
            }

            // Cloud coverage effects
            if (cloudCoverage >= 80) {
                // Heavy overcast completely changes golden hour character
                lightingParts = ['muted golden hour illumination under heavy overcast conditions'];
                atmosphereBase += ' , heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingParts.push('diffused through moderate cloud cover');
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingParts.push('filtered by light cloud cover');
                atmosphereBase += ' with light cloud filtering of golden light';
            }

            // Add UV effects for golden hour (lower intensity)
            if (uvIndex > 0 && isDaylight) {
                const effectiveUV = uvIndex * (1 - cloudCoverage / 100) * 0.7; // Reduced for golden hour
                if (effectiveUV >= 6) {
                    lightingParts.push('with moderate UV presence');
                } else if (effectiveUV >= 3) {
                    lightingParts.push('with low UV levels');
                }
            }

            lightingDescription = lightingParts.join(' , ' );
            atmosphericNotes = atmosphereBase;

            if (cloudCoverage >= 80) {
                // Heavy overcast completely changes golden hour character
                lightingParts = ['muted golden hour illumination under heavy overcast conditions'];
                atmosphereBase = 'warm glow, peaceful transition, anticipation of evening, heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingParts.push('diffused through moderate cloud cover');
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingParts.push('filtered by light cloud cover');
                atmosphereBase += ' with light cloud filtering of golden light';
            }

            // Add UV effects for golden hour (lower intensity)
            if (uvIndex > 0 && isDaylight) {
                const effectiveUV = uvIndex * (1 - cloudCoverage / 100) * 0.7; // Reduced for golden hour
                if (effectiveUV >= 6) {
                    lightingParts.push('with moderate UV presence');
                } else if (effectiveUV >= 3) {
                    lightingParts.push('with low UV levels');
                }
            }

            lightingDescription = lightingParts.join(', ');
            atmosphericNotes = atmosphereBase;
        } else if (currentHour >= sunsetStart && currentHour < sunsetEnd) {
            periodKey = 'sunset';
            periodDescription = 'sunset, sun setting, dramatic twilight colors';
            // Smooth sunset transition: sunset colors -> twilight deepening -> night sky emerging using legacy {} syntax
            const blendFactor = (currentHour - sunsetStart) / (sunsetEnd - sunsetStart); // 0 to 1 over sunset period
            const sunsetColorsWeight = Math.max(0.8 - blendFactor * 0.6, 0.2); // Sunset colors fade from 0.8 to 0.2
            const twilightWeight = 0.3 + blendFactor * 0.4; // Twilight builds from 0.3 to 0.7
            const nightEmergingWeight = Math.max(0.1, blendFactor * 0.4 - 0.1); // Night sky builds from 0.1 to 0.3

            // Use legacy {} and [] syntax: {} adds emphasis, [] subtracts emphasis
            const sunsetColorsBrackets = Math.round((1 - sunsetColorsWeight) * 3); // Sunset colors fading (use [] to subtract)
            const twilightBraces = Math.round(twilightWeight * 3); // Twilight deepening building (use {} to add)
            const nightEmergingBraces = Math.round(nightEmergingWeight * 3); // Night sky emerging building (use {} to add)
            const sunsetColorsText = sunsetColorsBrackets > 0 ? '['.repeat(sunsetColorsBrackets) + 'dramatic sunset colors' + ']'.repeat(sunsetColorsBrackets) : '';
            const twilightText = twilightBraces > 0 ? '{'.repeat(twilightBraces) + 'twilight deepening' + '}'.repeat(twilightBraces) : '';
            const nightEmergingText = nightEmergingBraces > 0 ? '{'.repeat(nightEmergingBraces) + 'night sky emerging' + '}'.repeat(nightEmergingBraces) : '';

            // Build sunset lighting and atmosphere with weather effects
            let lightingParts = [sunsetColorsText, twilightText, nightEmergingText].filter(Boolean);

            // Build atmosphere base based on temperature
            let atmosphereBase;
            if (isCold) {
                atmosphereBase = 'rapidly cooling temperatures, peaceful transition, end of day atmosphere';
                lightingParts = lightingParts.map(part => part.replace('dramatic sunset colors', 'sharp dramatic sunset colors'));
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', frost beginning to form in cooling air';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' with ground frost developing rapidly';
                    }
                }
            } else if (isHot) {
                atmosphereBase = 'slowly cooling temperatures, peaceful transition, end of day atmosphere';
                lightingParts.push('with lingering heat in sunset colors');
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', humid air holding day\'s heat';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ' with residual evaporative warmth in the air';
                }
            } else {
                atmosphereBase = 'cooling temperatures, peaceful transition, end of day atmosphere';
            }

            // Humidity affects sunset quality
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid air enriching sunset colors';
                lightingParts.push('diffused through humid evening air');
            } else if (isDry) {
                atmosphereBase += ' , exceptionally clear sunset visibility';
                lightingParts.push('sunset');
            }

            // Precipitation affects sunset atmosphere
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , ${precipitationType} framing sunset`;
                    lightingParts.push(`with ${precipitationType} catching final light`);
                } else {
                    atmosphereBase += ' , fine mist enhancing sunset glow';
                }
            }

            // Wind affects sunset movement
            if (isWindy) {
                atmosphereBase += ' , wind carrying evening chill';
                lightingParts.push('with wind affecting twilight colors');
            } else {
                atmosphereBase += ' , still evening transition';
            }

            // Cloud coverage effects
            if (cloudCoverage >= 80) {
                // Heavy overcast completely changes sunset character
                lightingParts = ['muted twilight illumination under heavy overcast conditions'];
                atmosphereBase += ' , heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingParts.push('diffused through moderate cloud cover');
                atmosphereBase += ' with moderate cloud cover';
            } else if (cloudCoverage >= 20) {
                lightingParts.push('filtered by light cloud cover');
                atmosphereBase += ' with light cloud filtering of sunset light';
            }

            // Sunset has minimal UV effects (very end of day)
            if (uvIndex > 0 && isDaylight) {
                const effectiveUV = uvIndex * (1 - cloudCoverage / 100) * 0.3; // Very reduced for sunset
                if (effectiveUV >= 3) {
                    lightingParts.push('with minimal UV presence');
                }
            }

            lightingDescription = lightingParts.join(' , ' );
            atmosphericNotes = atmosphereBase;

            if (cloudCoverage >= 80) {
                // Heavy overcast completely changes sunset character
                lightingParts = ['muted twilight illumination under heavy overcast conditions'];
                atmosphereBase = 'cooling temperatures, peaceful transition, end of day atmosphere, heavy cloud cover, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingParts.push('diffused through moderate cloud cover');
                atmosphereBase += ' with moderate cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingParts.push('filtered by light cloud cover');
                atmosphereBase += ' with light cloud filtering of sunset light';
            }

            // Sunset has minimal UV effects (very end of day)
            if (uvIndex > 0 && isDaylight) {
                const effectiveUV = uvIndex * (1 - cloudCoverage / 100) * 0.3; // Very reduced for sunset
                if (effectiveUV >= 3) {
                    lightingParts.push('with minimal UV presence');
                }
            }

            lightingDescription = lightingParts.join(', ');
            atmosphericNotes = atmosphereBase;
        } else if (currentHour >= sunsetEnd && currentHour < duskEnd) {
            periodKey = 'dusk';
            periodDescription = 'dusk, post-sunset, fading light to twilight';
            // Smooth dusk transition: twilight -> night sky dominating using legacy {} syntax
            const blendFactor = (currentHour - sunsetEnd) / (duskEnd - sunsetEnd); // 0 to 1 over dusk period
            const twilightWeight = Math.max(0.7 - blendFactor * 0.6, 0.1); // Twilight fades from 0.7 to 0.1
            const nightSkyWeight = Math.min(0.3 + blendFactor * 0.6, 0.9); // Night sky builds from 0.3 to 0.9

            // Use legacy {} and [] syntax: {} adds emphasis, [] subtracts emphasis
            const twilightBrackets = Math.round((1 - twilightWeight) * 3); // Twilight fading (use [] to subtract)
            const nightSkyBraces = Math.round(nightSkyWeight * 3); // Night sky dominating (use {} to add)
            const twilightText = twilightBrackets > 0 ? '['.repeat(twilightBrackets) + 'twilight fading' + ']'.repeat(twilightBrackets) : '';
            const nightSkyText = nightSkyBraces > 0 ? '{'.repeat(nightSkyBraces) + 'night sky' + '}'.repeat(nightSkyBraces) : '';

            // Build dusk lighting and atmosphere with weather effects
            let lightingParts = [twilightText, nightSkyText].filter(Boolean);

            // Build atmosphere base based on temperature
            let atmosphereBase;
            if (isCold) {
                atmosphereBase = 'cold evening air, transition to night, fading day warmth';
                lightingParts = lightingParts.map(part => part.replace('twilight', 'sharp twilight'));
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', frost forming in shadows';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' with ground frost appearing in cooling areas';
                    }
                }
            } else if (isHot) {
                atmosphereBase = 'warm evening air, transition to night, lingering day heat';
                lightingParts.push('with heat rising from surfaces');
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ', humid evening air heavy with moisture';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ' with evening evaporative cooling';
                }
            } else {
                atmosphereBase = 'cool evening air, transition to night, residual warmth';
            }

            // Humidity affects twilight quality
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid mist developing';
                lightingParts.push('diffused through evening humidity');
            } else if (isDry) {
                atmosphereBase += ' , exceptionally clear evening air';
                lightingParts.push('twilight illumination');
            }

            // Precipitation affects evening atmosphere
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , light evening ${precipitationType}`;
                    lightingParts.push(` ${precipitationType} in twilight`);
                } else {
                    atmosphereBase += ' , fine evening mist';
                }
            }

            // Wind affects evening transition
            if (isWindy) {
                atmosphereBase += ' , wind, evening';
                lightingParts.push('with wind affecting twilight shadows');
            } else {
                atmosphereBase += ' , calm evening descent';
            }

            // Cloud coverage effects for twilight period
            if (cloudCoverage >= 80) {
                // Heavy overcast completely changes dusk character
                lightingParts = ['muted twilight illumination under heavy overcast conditions'];
                atmosphereBase += ' , heavy cloud cover completely blocking celestial visibility, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingParts.push('diffused through moderate cloud cover');
                atmosphereBase += ' with partially obscured stars through cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingParts.push('filtered by light cloud cover');
                atmosphereBase += ' with stars visible through thin cloud cover';
            } else {
                // Clear skies - add star visibility
                atmosphereBase += ' , emerging stars becoming visible';
            }

            lightingDescription = lightingParts.join(' , ' );
            atmosphericNotes = atmosphereBase;

            if (cloudCoverage >= 80) {
                // Heavy overcast completely changes dusk character
                lightingParts = ['muted twilight illumination under heavy overcast conditions'];
                atmosphereBase = 'cool evening air, transition to night, residual warmth, heavy cloud cover completely blocking celestial visibility, dimmed lighting';
            } else if (cloudCoverage >= 50) {
                lightingParts.push('diffused through moderate cloud cover');
                atmosphereBase += ' with partially obscured stars through cloud cover, reduced lighting';
            } else if (cloudCoverage >= 20) {
                lightingParts.push('filtered by light cloud cover');
                atmosphereBase += ' with stars visible through thin cloud cover';
            } else {
                // Clear skies - add star visibility
                atmosphereBase += ', emerging stars becoming visible';
            }

            lightingDescription = lightingParts.join(', ');
            atmosphericNotes = atmosphereBase;

            // No UV effects for dusk (night time)
        } else if (currentHour >= duskEnd && currentHour < earlyEveningEnd) {
            periodKey = 'early_evening';
            periodDescription = 'early evening, residual twilight, early night atmosphere';
            // Build early evening lighting and atmosphere with weather effects
            let lightingBase = 'dim twilight illumination, artificial lights emerging';
            let atmosphereBase = 'cooling rapidly, evening activities beginning, mixed lighting';

            // Temperature influences evening activity and atmosphere
            if (isCold) {
                atmosphereBase = atmosphereBase.replace('cooling rapidly', 'cooling quickly');
                lightingBase = lightingBase.replace('dim twilight illumination', 'crisp dim twilight illumination');
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ' , frost visible on cool surfaces';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' with ground frost clearly forming';
                    }
                }
            } else if (isHot) {
                atmosphereBase = atmosphereBase.replace('cooling rapidly', 'slowly cooling');
                lightingBase += ' , residual heat glow';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ' , humid evening air thick with moisture';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ' evening evaporative cooling';
                }
            }

            // Humidity affects atmosphere and evening light quality
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid mist developing in low areas';
                lightingBase += ' , softly diffused lighting';
            } else if (isDry) {
                atmosphereBase += ' , exceptionally clear evening air';
                lightingBase += ' , intense mixed lighting, artificial lighting';
            }

            // Precipitation affects evening activities
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , light evening ${precipitationType}`;
                    lightingBase += ` , ${precipitationType} in artificial lights`;
                } else {
                    atmosphereBase += ' , fine evening mist';
                }
            }

            // Wind affects evening atmosphere
            if (isWindy) {
                atmosphereBase += ' , wind, evening';
            } else {
                atmosphereBase += ' , calm evening';
            }

            // Cloud coverage effects for twilight period
            if (cloudCoverage >= 80) {
                lightingBase = 'dim twilight illumination under heavy overcast conditions, artificial lights emerging';
                atmosphereBase += ' , heavy cloud cover completely blocking celestial visibility';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'dim twilight illumination diffused through moderate cloud cover, artificial lights emerging';
                atmosphereBase += ' partially obscured stars through cloud cover';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'dim twilight illumination filtered by light cloud cover, artificial lights emerging';
                atmosphereBase += ' stars visible through thin cloud cover';
            } else {
                // Clear skies - add star visibility
                atmosphereBase += ' , emerging stars becoming visible';
            }

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;

            if (cloudCoverage >= 80) {
                lightingBase = 'dim twilight illumination under heavy overcast conditions, artificial lights emerging';
                atmosphereBase = 'cooling rapidly, evening activities, mixed lighting, heavy cloud cover completely blocking celestial visibility';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'dim twilight illumination diffused through moderate cloud cover, artificial lights emerging';
                atmosphereBase = 'cooling rapidly, evening activities beginning, mixed lighting with partially obscured stars through cloud cover';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'dim twilight illumination filtered by light cloud cover, artificial lights emerging';
                atmosphereBase = 'cooling rapidly, evening activities beginning, mixed lighting with stars visible through thin cloud cover';
            } else {
                // Clear skies - add star visibility
                atmosphereBase += ', emerging stars becoming visible';
            }

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;

            // No UV effects for early evening (twilight)
        } else if (currentHour >= earlyEveningEnd && currentHour < eveningEnd) {
            periodKey = 'evening';
            periodDescription = 'full night, deep nighttime shadows';
            // Build evening lighting and atmosphere with weather effects
            let lightingBase = 'artificial lighting dominant in nighttime darkness, deep shadows';
            let atmosphereBase = `full night sky, nighttime darkness, deep shadows, ${environmentType === 'urban' ? 'urban night' : environmentType === 'natural' ? 'natural night' : 'mixed urban and natural night'}`;

            // Temperature influences night atmosphere and nighttime darkness
            if (isCold) {
                atmosphereBase = atmosphereBase.replace('full night sky, nighttime darkness, deep shadows', 'full night sky, nighttime darkness, deep shadows, cold night air');
                lightingBase += ' , crisp cold air creating deep nighttime shadows';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ' , frost patterns on surfaces and windows in nighttime darkness';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' with ground frost visible under artificial lights in deep nighttime shadows';
                    }
                }
            } else if (isHot) {
                atmosphereBase = atmosphereBase.replace('full night sky, nighttime darkness, deep shadows', 'full night sky, nighttime darkness, deep shadows, warm night air');
                lightingBase += ' , lingering heat in nighttime darkness';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ' , humid night air heavy and still in nighttime darkness';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ' with night time evaporative cooling in nighttime darkness';
                }
            }

            // Humidity affects atmosphere and night light quality in nighttime darkness
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid mist in nighttime darkness';
                lightingBase += ' , softly diffused lighting in deep nighttime shadows';
            } else if (isDry) {
                atmosphereBase += ' , clear night in nighttime darkness';
                lightingBase += ' , artificial illumination creating deep nighttime shadows';
            }

            // Precipitation affects night in nighttime darkness
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , ${precipitationType} falling in nighttime darkness`;
                    lightingBase += ` , ${precipitationType} reflecting artificial lights in deep nighttime shadows`;
                } else {
                    atmosphereBase += ' , fine mist dampening night air in nighttime darkness';
                }
            }

            // Wind affects night atmosphere in nighttime darkness
            if (isWindy) {
                atmosphereBase += ' , wind, nighttime darkness';
            } else {
                atmosphereBase += ' , still night atmosphere in nighttime darkness';
            }

            // Cloud coverage effects in nighttime darkness
            if (cloudCoverage >= 80) {
                lightingBase = 'artificial lighting dominant under heavy overcast conditions in nighttime darkness, deep shadows';
                atmosphereBase += ' , heavy cloud cover blocking most natural light, dark night atmosphere';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'artificial lighting dominant diffused through moderate cloud cover in nighttime darkness, deep shadows';
                atmosphereBase += ' with moderate cloud cover blocking natural light, dark night atmosphere';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'artificial lighting dominant filtered by light cloud cover in nighttime darkness, deep shadows';
                atmosphereBase += ' with light cloud cover blocking natural light, dark night atmosphere';
            }

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;

            if (cloudCoverage >= 80) {
                lightingBase = 'artificial lighting dominant under heavy overcast conditions in nighttime darkness, deep shadows';
                atmosphereBase = `full night sky, dark night atmosphere, deep shadows, ${environmentType === 'urban' ? 'urban night' : environmentType === 'natural' ? 'natural night' : 'mixed urban and natural night'}, heavy cloud cover blocking most natural light`;
            } else if (cloudCoverage >= 50) {
                lightingBase = 'artificial lighting dominant diffused through moderate cloud cover in nighttime darkness, deep shadows';
                atmosphereBase = `full night sky, dark night atmosphere, deep shadows, ${environmentType === 'urban' ? 'urban night' : environmentType === 'natural' ? 'natural night' : 'mixed urban and natural night'} with moderate cloud cover blocking natural light`;
            } else if (cloudCoverage >= 20) {
                lightingBase = 'artificial lighting dominant filtered by light cloud cover in nighttime darkness, deep shadows';
                atmosphereBase = `full night sky, dark night atmosphere, deep shadows, ${environmentType === 'urban' ? 'urban night' : environmentType === 'natural' ? 'natural night' : 'mixed urban and natural night'} with light cloud cover blocking natural light`;
            }

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;

            // No UV effects for evening (night time)
        } else if (currentHour >= eveningEnd && currentHour < 24) {
            periodKey = 'late_evening';
            periodDescription = 'deep night, dark night atmosphere, deep shadows';
            // Build late evening lighting and atmosphere with weather effects
            let lightingBase = 'dim artificial lighting in nighttime darkness, deep shadows, minimal natural light';
            let atmosphereBase = 'full night sky, dark night atmosphere, deep shadows, minimal activity';

            // Temperature influences deep night atmosphere in nighttime darkness
            if (isCold) {
                atmosphereBase = atmosphereBase.replace('full night sky, dark night atmosphere, deep shadows', 'full night sky, dark night atmosphere, deep shadows, cold deep night');
                lightingBase = lightingBase.replace('dim artificial lighting in nighttime darkness, deep shadows, minimal natural light', 'crisp dim artificial lighting in nighttime darkness, deep shadows');
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ' , frost crystals sparkling in dim artificial light in nighttime darkness';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' with crystalline frost patterns on surfaces in deep shadows';
                    }
                }
            } else if (isHot) {
                atmosphereBase = atmosphereBase.replace('full night sky, dark night atmosphere, deep shadows', 'full night sky, dark night atmosphere, deep shadows, warm deep night');
                lightingBase += ' , residual heat hanging in nighttime darkness';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ' , humid night air amplifying stillness in nighttime darkness';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ' with deep night evaporative cooling in nighttime darkness';
                }
            }

            // Humidity affects atmosphere and deep night light quality in nighttime darkness
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid mist, nighttime darkness';
                lightingBase += ' , softly diffused lighting in deep shadows';
            } else if (isDry) {
                atmosphereBase += ' , clear night in nighttime darkness';
            }

            // Precipitation affects late night quiet in nighttime darkness
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , ${precipitationType} adding to night quiet in nighttime darkness`;
                    lightingBase += ` , ${precipitationType} in dim artificial light, deep shadows`;
                } else {
                    atmosphereBase += ' , fine mist enhancing stillness in nighttime darkness';
                }
            }

            // Wind affects deep night atmosphere in nighttime darkness
            if (isWindy) {
                atmosphereBase += ' , wind whispering through deep night darkness';
            } else {
                atmosphereBase += ' , perfect night stillness in nighttime darkness';
            }

            // Cloud coverage effects on lighting in nighttime darkness (visible cloud descriptions removed for night)
            if (cloudCoverage >= 80) {
                lightingBase = 'dim artificial lighting in nighttime darkness, cloudy night sky blocking most natural light';
                atmosphereBase += ' , dark night atmosphere with dimmed artificial lighting';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'dim artificial lighting diffused through moderate cloud cover in nighttime darkness, cloudy night sky';
                atmosphereBase += ' , dark night atmosphere with reduced artificial lighting';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'dim artificial lighting filtered by light cloud cover in nighttime darkness, minimal natural light visible';
            }

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;


            // No UV effects for late evening (night time)
        } else {
            // Late night/early morning before dawn
            periodKey = 'midnight';
            periodDescription = 'midnight, dark night atmosphere, deep shadows';
            // Build midnight lighting and atmosphere with weather effects
            let lightingBase = 'minimal artificial lighting in nighttime darkness, deep shadows, minimal natural light';
            let atmosphereBase = 'full night sky, dark night atmosphere, deep shadows, stillness';

            // Temperature influences midnight stillness in nighttime darkness
            if (isCold) {
                atmosphereBase = atmosphereBase.replace('full night sky, dark night atmosphere, deep shadows', 'full night sky, dark night atmosphere, deep shadows, cold deep night');
                lightingBase = lightingBase.replace('minimal artificial lighting in nighttime darkness, deep shadows, minimal natural light', 'sharp minimal artificial lighting in nighttime darkness, deep shadows');
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ' , frost creating crystalline silence in nighttime darkness';
                    if (soilAnalysis.frostRisk) {
                        atmosphereBase += ' frost crystals creating perfect acoustic stillness in deep shadows';
                    }
                }
            } else if (isHot) {
                atmosphereBase = atmosphereBase.replace('full night sky, dark night atmosphere, deep shadows', 'full night sky, dark night atmosphere, deep shadows, warm deep night');
                lightingBase += ' , midnight heat in nighttime darkness';
                if (temperatureDewPointDiff < 5) {
                    atmosphereBase += ' , humid air creating heavy stillness in nighttime darkness';
                }
                if (atmosphericMoistureAnalysis.evaporationRate === 'high') {
                    atmosphereBase += ' midnight evaporative cooling creating absolute stillness in nighttime darkness';
                }
            }

            // Humidity affects atmosphere and midnight light quality in nighttime darkness
            if (isHumid && temperatureDewPointDiff < 5) {
                atmosphereBase += ' , humid mist amplifying silence in nighttime darkness';
                lightingBase += ' , softly diffused lighting in deep shadows';
            } else if (isDry) {
                atmosphereBase += ' , exceptionally clear night air with perfect acoustics in nighttime darkness';
                lightingBase += ' , midnight stillness in deep shadows';
            }

            // Precipitation affects midnight minimal activity in nighttime darkness
            if (hasPrecipitation) {
                if (precipitationRate > 5) {
                    atmosphereBase += ` , ${precipitationType} adding subtle stillness in nighttime darkness`;
                    lightingBase += ` , ${precipitationType} falling in nighttime darkness`;
                } else {
                    atmosphereBase += ' , fine mist enhancing midnight calm in nighttime darkness';
                }
            }

            // Wind affects midnight atmosphere in nighttime darkness
            if (isWindy) {
                atmosphereBase += ' , wind creating subtle midnight movement through nighttime darkness';
            } else {
                atmosphereBase += ' , absolute midnight stillness in nighttime darkness';
            }

            // Cloud coverage effects on lighting in nighttime darkness (visible cloud descriptions removed for night)
            if (cloudCoverage >= 80) {
                lightingBase = 'minimal artificial lighting in nighttime darkness, cloudy night sky blocking most natural light';
                atmosphereBase += ' , dark night atmosphere with dimmed artificial lighting';
            } else if (cloudCoverage >= 50) {
                lightingBase = 'minimal artificial lighting diffused through moderate cloud cover in nighttime darkness, cloudy night sky';
                atmosphereBase += ' , dark night atmosphere with reduced artificial lighting';
            } else if (cloudCoverage >= 20) {
                lightingBase = 'minimal artificial lighting filtered by light cloud cover in nighttime darkness, minimal natural light visible';
            }

            lightingDescription = lightingBase;
            atmosphericNotes = atmosphereBase;

            // No UV effects for midnight (night time)
        }

        // Add environmental context to atmospheric notes
        const environmentalContext = buildEnvironmentalContext(soilAnalysis, atmosphericMoistureAnalysis, cloudLayerAnalysis, surfacePressureAnalysis, isDaylight, atmosphericNotes);
        if (environmentalContext && atmosphericNotes) {
            atmosphericNotes += ', ' + environmentalContext;
        }

        console.log(`🌅 FINAL SELECTION: ${periodKey} - "${periodDescription}"\n`);
        console.log(`🌅 ATMOSPHERIC NOTES: ${atmosphericNotes}`);
        console.log(`🌅 LIGHTING NOTES: ${lightingDescription}`);
        console.log(`🌅 SOIL ANALYSIS: ${soilAnalysis.description}`);
        console.log(`🌅 ATMOSPHERIC MOISTURE ANALYSIS: ${atmosphericMoistureAnalysis.description}`);
        console.log(`🌅 CLOUD LAYER ANALYSIS: ${cloudLayerAnalysis.description}`);
        console.log(`🌅 SURFACE PRESSURE ANALYSIS: ${surfacePressureAnalysis.description}`);
        console.log(`🌅 IS DAYLIGHT: ${isDaylight}`);
        console.log(`🌅 SEASON: ${season}`);
        console.log(`🌅 ========================================`);

        return {
            period: periodDescription,
            periodKey: periodKey,
            lighting: lightingDescription,
            atmosphere: atmosphericNotes,
            season: season,
            timeOfDay: currentHour < 12 ? 'morning' : currentHour < 18 ? 'afternoon' : 'evening/night',
            transitionType: getTransitionType(currentHour, sunriseHour, sunsetHour)
        };

    } catch (error) {
        console.error('Failed to calculate sun times, using fallback:', error);
    }
}

module.exports = {
    determineTimePeriod,
    getSunriseSunset
};