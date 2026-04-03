
const getSunriseSunsetLib = require('sunrise-sunset-js');
const logger = require('./logger');

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
    // Note: 'evening' is now a valid period name (used for cloudy afternoon golden hour), don't map to 'night'
    const legacyMappings = {
        'earlymorning': 'morning',
        'early_morning': 'morning',
        'earlyevening': 'evening', // Keep as evening, not night
        'early_evening': 'evening',
        // 'evening' is now a valid period name, don't map to 'night'
        'lateevening': 'night',
        'late_evening': 'night'
    };
    
    return legacyMappings[normalized] || normalized;
}

/**
 * Get accurate sunrise and sunset times using established astronomical library
 * Uses sunrise-sunset-js package for reliable calculations
 * 
 * IMPORTANT: The DATE parameter affects timing because it determines the season:
 * - Summer dates (June): Earlier sunrise, later sunset (longer days ~14-16 hours)
 * - Winter dates (December): Later sunrise, earlier sunset (shorter days ~8-10 hours)
 * - Spring/Autumn dates: Intermediate day lengths
 * 
 * The astronomical calculations account for Earth's axial tilt (23.5°) which causes
 * seasonal variations in day length. The date is used to calculate the sun's declination,
 * which directly affects sunrise/sunset times.
 * 
 * @param {Object} location - Location object with lat/lon and timezone
 * @param {Date} date - Date for which to calculate sunrise/sunset (month/day affects timing via season)
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
        // Initialize polar condition flags
        let isPolarDay = false;
        let isPolarNight = false;
        
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
            isPolarDay = (lat + solarDeclination) > 0;
            isPolarNight = (lat + solarDeclination) < 0;

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
        // Uses IANA timezone (e.g., 'America/New_York') which automatically handles DST
        // More robust method using Intl.DateTimeFormat for accurate timezone conversion
        const timezone = location.timezone || 'UTC';
        
        // Convert UTC sunrise/sunset to local timezone (handles DST automatically)
        const formatOptions = { timeZone: timezone, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
        const sunriseFormatter = new Intl.DateTimeFormat('en-US', formatOptions);
        const sunsetFormatter = new Intl.DateTimeFormat('en-US', formatOptions);
        
        // Get local time components
        const sunriseParts = sunriseFormatter.formatToParts(sunrise);
        const sunsetParts = sunsetFormatter.formatToParts(sunset);
        
        const getHourFromParts = (parts) => {
            const hour = parseInt(parts.find(p => p.type === 'hour').value);
            const minute = parseInt(parts.find(p => p.type === 'minute').value);
            const second = parseInt(parts.find(p => p.type === 'second').value);
            return hour + minute / 60 + second / 3600;
        };
        
        const sunriseHour = getHourFromParts(sunriseParts);
        const sunsetHour = getHourFromParts(sunsetParts);
        
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

        // Calculate solar noon and other properties for fallback
        const solarNoon = (sunriseHour + sunsetHour) / 2;
        const daylightHours = sunsetHour - sunriseHour;
        // Calculate current hour in local timezone (fallback doesn't have timezone conversion, so use date directly)
        // Note: This assumes date is already in the correct timezone context
        const currentHour = date.getHours() + date.getMinutes() / 60;
        const isDaylight = currentHour >= sunriseHour && currentHour < sunsetHour;
        
        // Calculate dawn/dusk ranges first (30 minutes before sunrise, 30 minutes after sunset)
        const dawnTwilightWindow = 0.5; // 30 minutes
        const duskTwilightWindow = 0.5; // 30 minutes
        const dawnStartHour = sunriseHour - dawnTwilightWindow;
        const duskEndHour = sunsetHour + duskTwilightWindow;
        
        let sunProgressRaw = 0;
        let sunPhase = 'unknown';
        if (isDaylight) {
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
            sunPhase = currentHour < solarNoon ? 'rising' : 'setting';
        } else if (currentHour >= dawnStartHour && currentHour < sunriseHour) {
            // During dawn twilight period - still 'pre-dawn' but with some light
            sunPhase = 'pre-dawn';
            // Calculate progress as negative (before sunrise)
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
        } else if (currentHour > sunsetHour && currentHour <= duskEndHour) {
            // During dusk twilight period - still 'setting' phase with decreasing light
            sunPhase = 'setting';
            // Calculate progress past sunset (will be > 1.0 during twilight)
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
        } else if (currentHour < dawnStartHour) {
            // Before dawn twilight - true night/pre-dawn
            sunPhase = 'pre-dawn';
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
        } else {
            // After dusk twilight - true night/post-dusk
            sunPhase = 'post-dusk';
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
        }
        
        // Calculate perceivable light using 30-minute windows
        let perceivableLight = 0;
        let lightLevelRaw = 0;
        
        if (currentHour >= dawnStartHour && currentHour < sunriseHour) {
            // Dawn twilight - increasing light over 30 minutes
            perceivableLight = (currentHour - dawnStartHour) / dawnTwilightWindow;
            lightLevelRaw = perceivableLight * 0.3;
        } else if (currentHour >= sunriseHour && currentHour < sunsetHour) {
            // Daylight
            perceivableLight = 1.0;
            const noonDistance = Math.abs(currentHour - solarNoon) / (daylightHours / 2);
            lightLevelRaw = 1.0 - (noonDistance * 0.2);
        } else if (currentHour >= sunsetHour && currentHour <= duskEndHour) {
            // Dusk twilight - decreasing light over 30 minutes
            perceivableLight = 1.0 - ((currentHour - sunsetHour) / duskTwilightWindow);
            lightLevelRaw = perceivableLight * 0.3;
        }
        
        return {
            sunrise: sunrise.getTime(),
            sunset: sunset.getTime(),
            sunriseHour,
            sunsetHour,
            solarNoon,
            daylightHours,
            sunPhase,
            sunProgressRaw,
            perceivableLight,
            lightLevelRaw,
            isPolarDay: false,
            isPolarNight: false,
            fallback: true
        };
    }
}

/**
 * Format decimal hour to readable time string
 * @param {number} hour - Decimal hour (e.g., 6.5 = 6:30 AM)
 * @returns {string} Formatted time (e.g., "6:30 AM")
 */
function formatHour(hour) {
    if (hour === null || hour === undefined) return 'N/A';
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayHour = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return `${displayHour}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Format sun position percentage
 * @param {string} sunPhase - Sun phase
 * @param {number} sunProgressRaw - Sun progress (0-1)
 * @param {number} perceivableLight - Perceivable light (0-1)
 * @returns {string} Sun position description
 */
function formatSunPosition(sunPhase, sunProgressRaw, perceivableLight) {
    if (sunPhase === 'post-dusk' || sunPhase === 'pre-dawn') {
        return '0% (below horizon)';
    } else if (sunPhase === 'rising') {
        const percent = Math.round(sunProgressRaw * 100);
        return `${percent}% (rising)`;
    } else if (sunPhase === 'setting') {
        const percent = Math.round(sunProgressRaw * 100);
        return `${percent}% (setting)`;
    } else if (sunPhase === 'polar_day') {
        return '100% (polar day)';
    } else if (sunPhase === 'polar_night') {
        return '0% (polar night)';
    } else {
        return `${Math.round(perceivableLight * 100)}%`;
    }
}

/**
 * Log period ranges in a detailed table format
 * @param {Object} data - Period calculation data
 */
function logPeriodRangesTable(data) {
    const {
        currentHour,
        sunriseHour,
        sunsetHour,
        solarNoon,
        dawnStartHour,
        duskEndHour,
        periodDescription,
        sunPhase,
        perceivableLight,
        sunProgressRaw,
        isDaylight,
        sunriseIntensity,
        sunsetIntensity,
        dawnIntensity,
        duskIntensity,
        goldenMorningIntensity,
        goldenAfternoonIntensity,
        middayIntensity,
        midnightIntensity,
        cloudCoverage = 0
    } = data;
    
    // Helper function to check if currentHour falls within a time range (same as period selection)
    const isInRange = (startHour, endHour, checkHour) => {
        if (startHour === null || endHour === null || checkHour === null) {
            return false;
        }

        // Handle ranges that extend into the next day by >24h marker (e.g., Night ending at 30.5h)
        if (endHour >= 24 && startHour < endHour) {
            const normalizedCheck = checkHour < startHour ? checkHour + 24 : checkHour;
            return normalizedCheck >= startHour && normalizedCheck < endHour;
        }

        // Handle day wrap using traditional start > end definition (e.g., 22h → 4h)
        if (endHour < startHour) {
            return checkHour >= startHour || checkHour < endHour;
        }

        return checkHour >= startHour && checkHour < endHour;
    };

    logger.detailed('\n' + '='.repeat(80));
    logger.detailed('TIME PERIOD ANALYSIS');
    logger.detailed('='.repeat(80));
    logger.detailed(`Current Time: ${formatHour(currentHour)} (${currentHour.toFixed(3)}h)`);
    logger.detailed(`Sun Position: ${formatSunPosition(sunPhase, sunProgressRaw, perceivableLight)}`);
    logger.detailed(`Selected Period: ${periodDescription.toUpperCase()}`);
    logger.detailed('');

    // Calculate all period ranges
    const periods = [];

    // Dawn
    if (dawnStartHour !== null && sunriseHour !== null) {
        periods.push({
            name: 'Dawn',
            start: formatHour(dawnStartHour),
            end: formatHour(sunriseHour),
            startHour: dawnStartHour,
            endHour: sunriseHour,
            intensity: dawnIntensity,
            active: isInRange(dawnStartHour, sunriseHour, currentHour),
            sunPos: '0-30% (twilight)'
        });
    }

    // Sunrise
    if (sunriseHour !== null) {
        const sunriseStart = sunriseHour - 0.25;
        const sunriseEnd = sunriseHour + 0.25;
        periods.push({
            name: 'Sunrise',
            start: formatHour(sunriseStart),
            end: formatHour(sunriseEnd),
            startHour: sunriseStart,
            endHour: sunriseEnd,
            intensity: sunriseIntensity,
            active: isInRange(sunriseStart, sunriseEnd, currentHour),
            sunPos: '0% (on horizon)'
        });
    }

    // Golden Hour Morning
    if (sunriseHour !== null) {
        const goldenStart = sunriseHour + 0.25;
        const goldenEnd = sunriseHour + 1.5;
        // Use "Morning" when cloudy, "Golden Hour (AM)" when clear
        const periodName = cloudCoverage >= 60 ? 'Morning' : 'Golden Hour (AM)';
        periods.push({
            name: periodName,
            start: formatHour(goldenStart),
            end: formatHour(goldenEnd),
            startHour: goldenStart,
            endHour: goldenEnd,
            intensity: goldenMorningIntensity,
            active: isInRange(goldenStart, goldenEnd, currentHour),
            sunPos: '30-60% (low angle)'
        });
    }

    // Midday
    if (solarNoon !== null) {
        const middayStart = solarNoon - 2.0;
        const middayEnd = solarNoon + 2.0;
        periods.push({
            name: 'Midday',
            start: formatHour(middayStart),
            end: formatHour(middayEnd),
            startHour: middayStart,
            endHour: middayEnd,
            intensity: middayIntensity,
            active: isInRange(middayStart, middayEnd, currentHour),
            sunPos: '90-100% (overhead)'
        });
    }

    // Golden Hour Afternoon
    if (sunsetHour !== null) {
        const goldenStart = sunsetHour - 1.5;
        const goldenEnd = sunsetHour - 0.25;
        // Use "Evening" when cloudy, "Golden Hour (PM)" when clear
        const periodName = cloudCoverage >= 60 ? 'Evening' : 'Golden Hour (PM)';
        periods.push({
            name: periodName,
            start: formatHour(goldenStart),
            end: formatHour(goldenEnd),
            startHour: goldenStart,
            endHour: goldenEnd,
            intensity: goldenAfternoonIntensity,
            active: isInRange(goldenStart, goldenEnd, currentHour),
            sunPos: '30-60% (low angle)'
        });
    }
    
    // Add "Daytime" periods to fill gaps between Golden Hour and Midday
    if (sunriseHour !== null && solarNoon !== null && sunsetHour !== null) {
        const goldenMorningEnd = sunriseHour + 1.5;
        const middayStart = solarNoon - 2.0;
        const middayEnd = solarNoon + 2.0;
        const goldenAfternoonStart = sunsetHour - 1.5;
        
        // Gap between Golden Hour AM and Midday
        if (goldenMorningEnd < middayStart) {
            periods.push({
                name: 'Daytime (AM)',
                start: formatHour(goldenMorningEnd),
                end: formatHour(middayStart),
                startHour: goldenMorningEnd,
                endHour: middayStart,
                intensity: 0,
                active: isDaylight && currentHour >= goldenMorningEnd && currentHour < middayStart,
                sunPos: '60-90% (rising)'
            });
        }
        
        // Gap between Midday and Golden Hour PM
        if (middayEnd < goldenAfternoonStart) {
            periods.push({
                name: 'Daytime (PM)',
                start: formatHour(middayEnd),
                end: formatHour(goldenAfternoonStart),
                startHour: middayEnd,
                endHour: goldenAfternoonStart,
                intensity: 0,
                active: isDaylight && currentHour >= middayEnd && currentHour < goldenAfternoonStart,
                sunPos: '60-90% (setting)'
            });
        }
    }

    // Sunset
    if (sunsetHour !== null) {
        const sunsetStart = sunsetHour - 0.25;
        const sunsetEnd = sunsetHour + 0.25;
        periods.push({
            name: 'Sunset',
            start: formatHour(sunsetStart),
            end: formatHour(sunsetEnd),
            startHour: sunsetStart,
            endHour: sunsetEnd,
            intensity: sunsetIntensity,
            active: isInRange(sunsetStart, sunsetEnd, currentHour),
            sunPos: '0% (on horizon)'
        });
    }

    // Dusk
    if (sunsetHour !== null && duskEndHour !== null) {
        periods.push({
            name: 'Dusk',
            start: formatHour(sunsetHour),
            end: formatHour(duskEndHour),
            startHour: sunsetHour,
            endHour: duskEndHour,
            intensity: duskIntensity,
            active: isInRange(sunsetHour, duskEndHour, currentHour),
            sunPos: '0-30% (twilight)'
        });
    }

    // Midnight (subset of night, higher priority)
    if (duskEndHour !== null) {
        const midnightStart = 22;
        const midnightEnd = 4;
        const midnightCondition = (sunPhase === 'post-dusk' || sunPhase === 'pre-dawn') && midnightIntensity > 0.7;
        periods.push({
            name: 'Midnight',
            start: '10:00 PM',
            end: '4:00 AM',
            startHour: midnightStart,
            endHour: midnightEnd,
            intensity: midnightIntensity,
            active: midnightCondition && isInRange(midnightStart, midnightEnd, currentHour),
            sunPos: '0% (below horizon)'
        });
    }
    
    // Night
    if (duskEndHour !== null && dawnStartHour !== null) {
        const nightEndHour = dawnStartHour < duskEndHour ? dawnStartHour + 24 : dawnStartHour;
        const nightCondition = (sunPhase === 'post-dusk' || sunPhase === 'pre-dawn');
        periods.push({
            name: 'Night',
            start: formatHour(duskEndHour),
            end: formatHour(dawnStartHour),
            startHour: duskEndHour,
            endHour: nightEndHour,
            intensity: 0,
            active: nightCondition && isInRange(duskEndHour, nightEndHour, currentHour),
            sunPos: '0% (below horizon)'
        });
    }

    // Sort periods by start time for better visualization
    periods.sort((a, b) => {
        // Handle day wrap (night/midnight might span midnight)
        let aStart = a.startHour;
        let bStart = b.startHour;
        
        // If period spans midnight, normalize
        if (aStart > 20 && a.endHour < a.startHour) {
            // Night period - keep as is for sorting
        }
        if (bStart > 20 && b.endHour < b.startHour) {
            // Night period - keep as is for sorting
        }
        
        return aStart - bStart;
    });

    // Display table
    logger.detailed('Period Ranges:');
    logger.detailed('-'.repeat(80));
    logger.detailed(
        'Period'.padEnd(22) +
        'Start'.padEnd(12) +
        'End'.padEnd(12) +
        'Intensity'.padEnd(12) +
        'Sun Position'.padEnd(20) +
        'Active'
    );
    logger.detailed('(⭐ = Selected, ✓ = Active & Selected, ~ = In Range, space = Not Active)');
    logger.detailed('-'.repeat(80));

    // Normalize periodDescription for comparison (same as period selection logic)
    const normalizedSelectedPeriod = periodDescription.toLowerCase().replace(/\s+/g, '');
    
    periods.forEach(period => {
        // Normalize period name for comparison
        const normalizedPeriodName = period.name.toLowerCase().replace(/\s+/g, '').replace(/\(am\)|\(pm\)/g, '');
        
        // Check if this period matches the selected period
        // Handle special cases: "morning" matches "Golden Hour (AM)", "evening" matches "Golden Hour (PM)"
        // Also handle reverse: "golden hour" matches "Morning" or "Evening" when they're the same time period
        let isSelected = false;
        if (normalizedSelectedPeriod === normalizedPeriodName) {
            isSelected = true;
        } else if (normalizedSelectedPeriod === 'morning' && normalizedPeriodName.includes('goldenhour') && period.startHour < 12) {
            isSelected = true;
        } else if (normalizedSelectedPeriod === 'evening' && normalizedPeriodName.includes('goldenhour') && period.startHour >= 12) {
            isSelected = true;
        } else if (normalizedSelectedPeriod === 'goldenhour' && normalizedPeriodName.includes('goldenhour')) {
            isSelected = true;
        } else if (normalizedSelectedPeriod === 'goldenhour' && normalizedPeriodName === 'morning' && period.startHour < 12) {
            // Selected is "golden hour" but table shows "Morning" (cloudy) - same time period
            isSelected = true;
        } else if (normalizedSelectedPeriod === 'goldenhour' && normalizedPeriodName === 'evening' && period.startHour >= 12) {
            // Selected is "golden hour" but table shows "Evening" (cloudy) - same time period
            isSelected = true;
        }
        
        // Active if time range matches AND it's the selected period
        const activeMark = (period.active && isSelected) ? '✓' : (period.active ? '~' : ' ');
        const intensityStr = period.intensity !== undefined 
            ? period.intensity.toFixed(3) 
            : 'N/A';
        
        // Add indicator if this is the selected period
        const selectedIndicator = isSelected ? ' ⭐' : '';
        
        logger.detailed(
            (period.name + selectedIndicator).padEnd(22) +
            period.start.padEnd(12) +
            period.end.padEnd(12) +
            intensityStr.padEnd(12) +
            period.sunPos.padEnd(20) +
            activeMark
        );
    });

    logger.detailed('-'.repeat(80));
    
    // Show gaps if any
    const gaps = [];
    for (let i = 0; i < periods.length - 1; i++) {
        const current = periods[i];
        const next = periods[i + 1];
        
        // Handle day wrap
        let currentEnd = current.endHour;
        let nextStart = next.startHour;
        
        // If current period wraps (night), skip gap check
        if (currentEnd < current.startHour) {
            continue;
        }
        
        // If next period is before current (wrapped), skip
        if (nextStart < currentEnd && nextStart < 12) {
            continue;
        }
        
        // Check for gap
        if (nextStart > currentEnd + 0.01) { // Small tolerance for floating point
            gaps.push({
                from: formatHour(currentEnd),
                to: formatHour(nextStart),
                duration: (nextStart - currentEnd).toFixed(2) + 'h'
            });
        }
    }
    
    if (gaps.length > 0) {
        logger.detailed('');
        logger.detailed('⚠️  Gaps detected:');
        gaps.forEach(gap => {
            logger.detailed(`   ${gap.from} → ${gap.to} (${gap.duration})`);
        });
    }
    
    logger.detailed('');
}

/**
 * Get relative wind direction description
 * Wind direction is where the wind is coming FROM (meteorological convention)
 * Returns relative position: facing (front), behind (back), left side, or right side
 * @param {number} windDirection - Wind direction in degrees (0-360, where 0° = North, 90° = East, 180° = South, 270° = West)
 * @returns {string|null} Relative direction ('facing', 'behind', 'left side', 'right side') or null
 */
function getRelativeWindDirection(windDirection) {
    if (windDirection === null || windDirection === undefined || isNaN(windDirection)) {
        return null;
    }
    // Normalize to 0-360
    const normalized = ((windDirection % 360) + 360) % 360;
    
    // Assuming subject/camera faces north (0°)
    // Wind from front (north): 315-45° = facing
    // Wind from back (south): 135-225° = behind
    // Wind from left (west): 225-315° = left side
    // Wind from right (east): 45-135° = right side
    
    if ((normalized >= 315 || normalized < 45)) {
        return 'facing';
    } else if (normalized >= 45 && normalized < 135) {
        return 'right side';
    } else if (normalized >= 135 && normalized < 225) {
        return 'behind';
    } else if (normalized >= 225 && normalized < 315) {
        return 'left side';
    }
    return null;
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

    // Use 30-minute windows to match dawn/dusk calculations
    const dawnTwilightWindow = 0.5; // 30 minutes
    const duskTwilightWindow = 0.5; // 30 minutes
    const dawnStartHour = sunriseHour - dawnTwilightWindow;
    const duskEndHour = sunsetHour + duskTwilightWindow;

    // Check for narrow transition windows first (higher priority)
    if (sunriseTransition <= 0.25) { // 15 minutes around sunrise
        return 'sunrise_transition';
    } else if (sunsetTransition <= 0.25) { // 15 minutes around sunset
        return 'sunset_transition';
    } 
    // Check for dawn/dusk twilight windows (30 minutes)
    else if (currentHour >= dawnStartHour && currentHour < sunriseHour) {
        return 'dawn_transition';
    } else if (currentHour > sunsetHour && currentHour <= duskEndHour) {
        return 'dusk_transition';
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
            analysis.weatherPattern = 'cloudy';
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
            } else if (surfacePressureAnalysis.atmosphericStability === 'moderately_unstable') {
                contextParts.push('moderately variable weather conditions');
            } else if (surfacePressureAnalysis.atmosphericStability === 'unstable') {
                contextParts.push('highly variable and potentially unstable weather conditions');
            }
        }
    }

    // Add cloud layer information for daylight periods, avoiding conflicts with existing cloud mentions
    if (isDaylight && cloudLayerAnalysis.description) {
        const hasExistingClouds = existingLower.includes('cloud') || existingLower.includes('cloudy sky') ||
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
 * @param {Object} timeInput - The current time object from getCurrentTime() with year, month, dayOfMonth, hour, minute, timestamp
 * @param {string} season - The current season (e.g., 'spring', 'summer', 'autumn', 'winter').
 * @param {Object} location - Geographic location object used for sunrise/sunset calculations (latitude, longitude).
 * @param {Object} weather - (Optional) Weather data object for adjusting lighting and atmospheric descriptions (e.g., cloudCoverage, uvIndex, temperature).
 * @param {Object} enhancedWeatherData - (Optional) Enhanced weather data
 * @param {boolean} clothingEffects - Whether to include clothing effects in atmosphere
 * @returns {Object} An object containing:
 *   - period: Human-readable description of the time period (e.g., "Early Morning", "Golden Hour").
 *   - periodKey: Machine-friendly key for the period (e.g., "earlymorning", "goldenhour").
 *   - lighting: Array of {text, bias} objects describing lighting conditions, accounting for sun position and weather.
 *   - atmosphere: Array of {text, bias} objects describing atmospheric qualities, including weather and seasonal context.
 *   - uc: Array of {text, bias} objects for undesired elements (negative prompt).
 *   - season: The current season.
 *   - timeOfDay: General time of day ("morning", "afternoon", "evening/night", etc.).
 *   - transitionType: Specific transition state (e.g., "sunrise_transition", "sunset_transition", "steady_state").
 *   - Additional solar data: sunriseHour, sunsetHour, solarNoon, daylightHours, sunPhase, sunProgressRaw, perceivableLight, lightLevelRaw, etc.
 */
async function determineTimePeriod(timeInput, season = null, location = null, weather = null, enhancedWeatherData = {}, clothingEffects = true, guidanceEnabled = true) {
    // Handle backward compatibility: if first param is location object (has lat/lon), rearrange
    if (timeInput && typeof timeInput === 'object' && 
        !timeInput.timestamp && !timeInput.year && timeInput.lat !== undefined) {
        // First param is actually location, shift parameters
        location = timeInput;
        weather = season;
        season = null;
        throw new Error('determineTimePeriod now requires a time object from getCurrentTime as the first parameter');
    }
    
    // Validate time input
    if (!timeInput || typeof timeInput !== 'object') {
        throw new Error('timeInput must be a time object from getCurrentTime');
    }
    
    // Validate required time object properties
    if (timeInput.hour === undefined || timeInput.minute === undefined) {
        throw new Error('timeInput must have hour and minute properties');
    }
    
    if (!location) {
        throw new Error('Location is required for determineTimePeriod');
    }
    
    if (!weather) {
        weather = {};
    }
    
    // Convert time object to Date for getSunriseSunset (which requires Date object)
    // NOTE: The DATE (month/day) affects timing because it determines the season:
    // - Summer dates: Earlier sunrise, later sunset (longer days)
    // - Winter dates: Later sunrise, earlier sunset (shorter days)
    // The astronomical calculations use the date to account for Earth's tilt throughout the year
    let date;
    if (timeInput.timestamp) {
        date = new Date(timeInput.timestamp);
    } else {
        // Use current year if not provided
        const year = timeInput.year !== undefined ? timeInput.year : new Date().getFullYear();
        const month = timeInput.month !== undefined ? timeInput.month : new Date().getMonth();
        date = new Date(year, month, timeInput.dayOfMonth || 1, 
                       timeInput.hour || 0, timeInput.minute || 0, timeInput.second || 0);
    }
    
    // Calculate sunrise/sunset times based on date (which includes season information)
    // The date determines the season, and season affects timing through astronomical calculations
    const sunriseData = await getSunriseSunset(location, date);
    if (sunriseData.error) throw new Error(sunriseData.error);

    const {
        sunriseHour,
        sunsetHour,
        isPolarDay,
        isPolarNight
    } = sunriseData;

    // Use time object properties directly - these are already in the correct timezone
    const currentHour = timeInput.hour + timeInput.minute / 60;

    // Calculate solar noon and daylight hours
    const solarNoon = (sunriseHour !== null && sunsetHour !== null) ? (sunriseHour + sunsetHour) / 2 : null;
    const daylightHours = (sunriseHour !== null && sunsetHour !== null) ? (sunsetHour - sunriseHour) : 0;

    // Handle polar conditions where sunriseHour/sunsetHour may be null
    const isDaylight = (sunriseHour !== null && sunsetHour !== null) 
        ? (currentHour >= sunriseHour && currentHour < sunsetHour)
        : (isPolarDay ? true : false);

    // Calculate dawn/dusk ranges (30 minutes before sunrise, 30 minutes after sunset)
    const dawnTwilightWindow = 0.5; // 30 minutes
    const duskTwilightWindow = 0.5; // 30 minutes
    const dawnStartHour = (sunriseHour !== null) ? sunriseHour - dawnTwilightWindow : null;
    const duskEndHour = (sunsetHour !== null) ? sunsetHour + duskTwilightWindow : null;

    // Calculate sun progress and phase
    let sunProgressRaw = 0;
    let sunPhase = 'unknown';
    
    if (isPolarDay) {
        sunPhase = 'polar_day';
        sunProgressRaw = 0.5; // Midday
    } else if (isPolarNight) {
        sunPhase = 'polar_night';
        sunProgressRaw = 0;
    } else if (sunriseHour !== null && sunsetHour !== null) {
        if (isDaylight) {
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
            sunPhase = currentHour < solarNoon ? 'rising' : 'setting';
        } else if (dawnStartHour !== null && currentHour >= dawnStartHour && currentHour < sunriseHour) {
            // During dawn twilight period
            sunPhase = 'pre-dawn';
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
        } else if (duskEndHour !== null && currentHour > sunsetHour && currentHour <= duskEndHour) {
            // During dusk twilight period
            sunPhase = 'setting';
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
        } else if (dawnStartHour !== null && currentHour < dawnStartHour) {
            // Before dawn twilight - true night/pre-dawn
            sunPhase = 'pre-dawn';
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
        } else {
            // After dusk twilight - true night/post-dusk
            sunPhase = 'post-dusk';
            sunProgressRaw = (currentHour - sunriseHour) / daylightHours;
        }
    }

    // Calculate perceivable light (0-100 for display, includes civil twilight)
    // Note: Display expects perceivableLight as 0-100 percentage, not 0-1
    let perceivableLight = 0;
    let lightLevelRaw = 0; // Calculate as 0-1, will be scaled to 0-10 after cloud adjustment
    
    if (isPolarDay) {
        perceivableLight = 100;
        lightLevelRaw = 1.0; // Full light (0-1 scale, will be scaled later)
    } else if (isPolarNight) {
        perceivableLight = 0;
        lightLevelRaw = 0;
    } else if (dawnStartHour !== null && sunriseHour !== null && currentHour >= dawnStartHour && currentHour < sunriseHour) {
        // Dawn twilight - increasing light over 30 minutes
        const lightRatio = (currentHour - dawnStartHour) / dawnTwilightWindow;
        perceivableLight = Math.round(lightRatio * 100); // 0-100
        lightLevelRaw = lightRatio * 0.3; // 0-0.3 on 0-1 scale
    } else if (sunriseHour !== null && sunsetHour !== null && currentHour >= sunriseHour && currentHour < sunsetHour) {
        // Daylight - use sunProgressRaw for percentage (0-100)
        perceivableLight = Math.round(sunProgressRaw * 100);
        // Light level peaks at solar noon
        const noonDistance = Math.abs(currentHour - solarNoon) / (daylightHours / 2);
        lightLevelRaw = 1.0 - (noonDistance * 0.2); // 0.8-1.0 during day (0-1 scale)
    } else if (sunsetHour !== null && duskEndHour !== null && currentHour >= sunsetHour && currentHour <= duskEndHour) {
        // Dusk twilight - decreasing light over 30 minutes
        const lightRatio = 1.0 - ((currentHour - sunsetHour) / duskTwilightWindow);
        perceivableLight = Math.round(lightRatio * 100); // 0-100
        lightLevelRaw = lightRatio * 0.3; // 0-0.3 on 0-1 scale
    } else {
        // Night
        perceivableLight = 0;
        lightLevelRaw = 0;
    }

    const feelsLike = weather.feelsLike ?? weather.temperature ?? 15;
    const cloudCoverage = weather.cloudCoverage ?? 0;
    const windSpeed = weather.windSpeed ?? 0;
    const windGust = weather.windGust ?? windSpeed;
    const windRelativeDir = getRelativeWindDirection(weather.windDirection);
    const precipRate = weather.precipitationRate ?? 0;
    const precipType = weather.precipitationType?.type || 'none';
    const hasPrecipitation = precipRate > 0.1;
    
    // Adjust light level based on cloud coverage and weather conditions
    // Clouds reduce light: 0% clouds = no reduction, 100% clouds = 70-85% reduction
    // Heavy cloudy sky (90%+) can reduce light by up to 85%
    // Note: lightLevelRaw is in 0-1 scale for cloud adjustment, will be scaled to 0-10 for display
    let adjustedLightLevelRaw = lightLevelRaw;
    if (cloudCoverage > 0 && lightLevelRaw > 0) {
        // Cloud factor: 0% clouds = 1.0, 100% clouds = 0.15-0.30 (70-85% reduction)
        // Use a curve that's more aggressive at higher cloud coverage
        const cloudFactor = 1.0 - (cloudCoverage / 100) * 0.80; // Up to 80% reduction
        adjustedLightLevelRaw = lightLevelRaw * cloudFactor;
        
        // Additional reduction for heavy precipitation
        if (hasPrecipitation && precipType !== 'none') {
            adjustedLightLevelRaw *= 0.85; // Additional 15% reduction during precipitation
        }
        
        // Ensure minimum light level during daylight (even heavy clouds allow some light)
        if (isDaylight && adjustedLightLevelRaw < 0.1) {
            adjustedLightLevelRaw = 0.1; // Minimum 10% light during daylight (0-1 scale)
        }
    }
    
    // Scale to 0-10 for display (display function expects 0-10, not 0-1)
    adjustedLightLevelRaw = Math.round(adjustedLightLevelRaw * 10);

    // ===================================================================
    // SEASON INFLUENCE (fully dynamic, Danbooru-valid tags only)
    // ===================================================================
    const seasonLower = (season || '').toLowerCase();
    const isAutumn = seasonLower === "autumn" || seasonLower === "fall";
    const isWinter = seasonLower === "winter";
    const isSpring = seasonLower === "spring";
    const isSummer = seasonLower === "summer";

    // Seasonal base bias (higher during daylight when colors are visible)
    const seasonDayBias = isDaylight ? 1.0 : 0.6;

    const seasonalElements = [];

    // Only populate seasonal elements if guidance is enabled
    if (guidanceEnabled) {
        if (isAutumn) {
            seasonalElements.push({text: "autumn, orange leaves, red leaves, yellow leaves, falling leaves", bias: 1.0 + seasonDayBias * 0.9});
            // Adjust color palette based on cloud cover - no warm/orange tint when cloudy
            if (cloudCoverage < 30) {
                seasonalElements.push({text: "warm color palette, orange tinted light", bias: 1.0 + seasonDayBias * 0.7});
            } else if (cloudCoverage < 60) {
                seasonalElements.push({text: "warm color palette, muted colors", bias: 1.0 + seasonDayBias * 0.5});
            } else if (cloudCoverage < 80) {
                seasonalElements.push({text: "muted colors, cool color palette", bias: 1.0 + seasonDayBias * 0.3});
            } else {
                // Heavy clouds: no warm colors, just muted/cool
                seasonalElements.push({text: "muted colors, cool color palette, gray tones", bias: 1.0 + seasonDayBias * 0.2});
            }
        } else if (isWinter) {
            seasonalElements.push({text: "winter, bare trees", bias: 1.0 + seasonDayBias * 1.0});
            seasonalElements.push({text: "cold lighting, blue tinted light, cool color palette", bias: 1.0 + seasonDayBias * 0.8});
        } else if (isSpring) {
            seasonalElements.push({text: "spring, cherry blossoms, pink petals, falling petals, green leaves", bias: 1.0 + seasonDayBias * 0.9});
            // Adjust lighting based on cloud cover - more granular adjustments
            if (cloudCoverage < 30) {
                seasonalElements.push({text: "soft lighting, pastel colors", bias: 1.0 + seasonDayBias * 0.6});
            } else if (cloudCoverage < 60) {
                seasonalElements.push({text: "soft lighting, muted pastel colors", bias: 1.0 + seasonDayBias * 0.4});
            } else if (cloudCoverage < 80) {
                seasonalElements.push({text: "soft lighting, muted colors, cool tones", bias: 1.0 + seasonDayBias * 0.3});
            } else {
                // Heavy clouds: very muted, cool tones
                seasonalElements.push({text: "muted colors, cool tones, gray tones", bias: 1.0 + seasonDayBias * 0.2});
            }
        } else if (isSummer) {
            seasonalElements.push({text: "summer, lush greenery", bias: 1.0 + seasonDayBias * 0.9});
            // Adjust colors based on cloud cover - no warm sunlight when cloudy
            if (cloudCoverage < 30) {
                seasonalElements.push({text: "vibrant colors, warm sunlight", bias: 1.0 + seasonDayBias * 0.7});
            } else if (cloudCoverage < 60) {
                seasonalElements.push({text: "vibrant colors, filtered sunlight", bias: 1.0 + seasonDayBias * 0.5});
            } else if (cloudCoverage < 80) {
                seasonalElements.push({text: "muted vibrant colors, diffused light", bias: 1.0 + seasonDayBias * 0.3});
            } else {
                // Heavy clouds: no warm sunlight, muted colors
                seasonalElements.push({text: "muted colors, cool diffused light", bias: 1.0 + seasonDayBias * 0.2});
            }
        }
    }

    // ===================================================================
    // Dynamic intensity calculators (0.0 → 1.0 = full strength)
    // ===================================================================
    // Handle polar conditions where values may be null
    const hoursFromSunrise = (sunriseHour !== null) ? Math.max(0, currentHour - sunriseHour) : 0;
    const hoursToSunset    = (sunsetHour !== null) ? Math.max(0, sunsetHour - currentHour) : 0;
    const hoursFromNoon    = (solarNoon !== null) ? Math.abs(currentHour - solarNoon) : 0;

    // Sunrise peak intensity (peaks at exact sunrise, falls off fast)
    const sunriseIntensity = (sunriseHour !== null) 
        ? Math.max(0, 1.0 - Math.abs(currentHour - sunriseHour) / 0.25 * 4) 
        : 0;

    // Sunset peak intensity
    const sunsetIntensity = (sunsetHour !== null)
        ? Math.max(0, 1.0 - Math.abs(currentHour - sunsetHour) / 0.25 * 4)
        : 0;

    // Golden hour morning intensity (strongest first 90 min after sunrise)
    // Only applies during daylight hours, after sunrise transition period
    const goldenMorningIntensity = (sunriseHour !== null && currentHour >= sunriseHour && isDaylight)
        ? Math.max(0, 1.0 - hoursFromSunrise / 1.5)
        : 0;

    // Golden hour afternoon intensity (strongest last 90 min before sunset)
    // Only applies during daylight hours, before sunset transition period
    const goldenAfternoonIntensity = (sunsetHour !== null && currentHour < sunsetHour && isDaylight)
        ? Math.max(0, 1.0 - hoursToSunset / 1.5)
        : 0;

    // Midday intensity (peaks at solar noon, full strength ±2 hours)
    const middayIntensity = (solarNoon !== null)
        ? Math.max(0, 1.0 - hoursFromNoon / 2.0)
        : (isPolarDay ? 1.0 : 0);

    // Civil twilight intensity (dawn/dusk)    
    // Dawn intensity: calculate based on actual dawn start time
    const dawnIntensity = (dawnStartHour !== null && sunriseHour !== null && 
                          currentHour >= dawnStartHour && currentHour < sunriseHour)
        ? Math.min(1.0, (sunriseHour - currentHour) / dawnTwilightWindow)
        : 0;
    
    // Dusk intensity: calculate based on actual dusk end time
    const duskIntensity = (duskEndHour !== null && sunsetHour !== null && 
                          currentHour > sunsetHour && currentHour <= duskEndHour)
        ? Math.min(1.0, (currentHour - sunsetHour) / duskTwilightWindow)
        : 0;

    // Night depth (strongest at midnight, weaker near twilight)
    // Calculate distance to nearest twilight period (dawn or dusk)
    const hoursFromMidnight = Math.min(Math.abs(currentHour - 0), Math.abs(currentHour - 24));
    let midnightIntensity = 0;
    
    if (sunriseHour !== null && sunsetHour !== null) {
        // Calculate distance to nearest twilight boundary
        // Dawn starts at dawnStartHour, dusk ends at duskEndHour
        let distanceToTwilight;
        
        if (currentHour >= sunriseHour && currentHour <= sunsetHour) {
            // During daylight - not night
            distanceToTwilight = Infinity;
        } else if (currentHour >= dawnStartHour && currentHour < sunriseHour) {
            // In dawn twilight period - not deep night
            distanceToTwilight = 0;
        } else if (currentHour > sunsetHour && currentHour <= duskEndHour) {
            // In dusk twilight period - not deep night
            distanceToTwilight = 0;
        } else if (currentHour < dawnStartHour) {
            // Before dawn - distance to dawn start
            // If we're very early (like 1 AM) and dawn is later (like 6 AM), 
            // we might be closer to the previous day's dusk end
            const distanceToDawn = dawnStartHour - currentHour;
            const distanceFromDusk = (24 - duskEndHour) + currentHour;
            distanceToTwilight = Math.min(distanceToDawn, distanceFromDusk);
        } else {
            // After dusk - distance from dusk end
            distanceToTwilight = currentHour - duskEndHour;
        }
        
        // Midnight intensity: strongest at midnight, weaker near twilight
        // Full intensity if > 4 hours from twilight, or if it's very late/early (22-4)
        if (currentHour < 4 || currentHour >= 22) {
            midnightIntensity = 1.0;
        } else if (distanceToTwilight > 4.0) {
            midnightIntensity = 1.0;
        } else {
            midnightIntensity = Math.max(0, 1.0 - distanceToTwilight / 4.0);
        }
    } else if (isPolarNight) {
        midnightIntensity = 1.0;
    }

    // Clear sky strength (inversely proportional to cloud cover)
    const clearSkyStrength = 1.0 - (cloudCoverage / 100);

    // Cloudy sky strength
    const overcastStrength = cloudCoverage / 100;

    // ===================================================================
    // LIGHTING + SEASONAL COLOR INFLUENCE
    // ===================================================================
    const lightingElements = [];
    const undesiredElements = [];

    // Sunrise – only appears when intensity > 0
    if (sunriseIntensity > 0) {
        let bias = 1.0 + sunriseIntensity * 1.0;
        if (isAutumn) bias += 0.4; // extra warm in autumn sunrise
        if (isWinter) bias -= 0.2; // cooler in winter
        
        // Adjust for cloud cover - no golden/warm lighting when cloudy
        if (cloudCoverage < 30) {
            // Clear sky - full sunrise effects
            lightingElements.push({text: "sunrise, sun on horizon, golden hour, rim lighting, backlighting, god rays, lens flare", bias});
            lightingElements.push({text: "long shadows", bias: bias - 0.1});
        } else if (cloudCoverage < 60) {
            // Partly cloudy - reduced golden hour effects
            lightingElements.push({text: "sunrise, sun on horizon, soft lighting, rim lighting, backlighting", bias: bias - 0.3});
            lightingElements.push({text: "long shadows, diffuse shadows", bias: bias - 0.3});
        } else if (cloudCoverage < 80) {
            // Mostly cloudy - no golden hour, muted lighting
            lightingElements.push({text: "sunrise, sun on horizon, muted lighting, soft glow, diffuse lighting", bias: bias - 0.5});
            lightingElements.push({text: "soft shadows, cool lighting", bias: bias - 0.4});
        } else {
            // Heavy clouds - no golden/warm terms, flat muted lighting
            lightingElements.push({text: "sunrise, muted lighting, flat lighting, diffuse lighting", bias: bias - 0.7});
            lightingElements.push({text: "soft shadows, cool lighting", bias: bias - 0.5});
        }
        undesiredElements.push({text: "overhead sunlight, short shadows", bias: bias + 0.3});
    }

    // Sunset
    if (sunsetIntensity > 0) {
        let bias = 1.0 + sunsetIntensity * 1.0;
        if (isAutumn) bias += 0.5; // autumn sunsets are legendary
        if (isWinter) bias -= 0.15;
        
        // Adjust for cloud cover - no golden/warm lighting when cloudy
        if (cloudCoverage < 30) {
            // Clear sky - full sunset effects
            lightingElements.push({text: "sunset, sun on horizon, golden hour, rim lighting, backlighting, god rays, lens flare", bias});
            lightingElements.push({text: "long shadows, warm lighting", bias: bias - 0.1});
        } else if (cloudCoverage < 60) {
            // Partly cloudy - reduced golden hour effects
            lightingElements.push({text: "sunset, sun on horizon, soft lighting, rim lighting, backlighting", bias: bias - 0.3});
            lightingElements.push({text: "long shadows, diffuse shadows", bias: bias - 0.3});
        } else if (cloudCoverage < 80) {
            // Mostly cloudy - no golden hour, muted lighting
            lightingElements.push({text: "sunset, sun on horizon, muted lighting, soft glow, diffuse lighting", bias: bias - 0.5});
            lightingElements.push({text: "soft shadows, cool lighting", bias: bias - 0.4});
        } else {
            // Heavy clouds - no golden/warm terms, flat muted lighting
            lightingElements.push({text: "sunset, muted lighting, flat lighting, diffuse lighting", bias: bias - 0.7});
            lightingElements.push({text: "soft shadows, cool lighting", bias: bias - 0.5});
        }
        undesiredElements.push({text: "overhead sunlight, blue hour", bias: bias + 0.3});
    }

    // Golden hour morning
    if (goldenMorningIntensity > 0 && sunriseIntensity === 0) {
        let bias = 1.0 + goldenMorningIntensity * 0.8;
        if (isAutumn || isSummer) bias += 0.3;
        
        // Adjust for cloud cover - no golden/warm lighting when cloudy
        if (cloudCoverage < 30) {
            // Clear: full golden hour with warm lighting
            lightingElements.push({text: "golden hour, warm sunlight, long shadows", bias});
        } else if (cloudCoverage < 60) {
            // Partly cloudy: reduced golden hour, softer lighting
            lightingElements.push({text: "golden hour, soft lighting, diffuse shadows", bias: bias - 0.4});
        } else if (cloudCoverage < 80) {
            // Mostly cloudy: no golden/warm terms, just soft diffused light
            lightingElements.push({text: "soft lighting, diffuse shadows, filtered light", bias: bias - 0.6});
        } else {
            // Heavy clouds: no golden hour lighting at all, flat/cool lighting
            lightingElements.push({text: "flat lighting, diffuse shadows, cool lighting", bias: bias - 0.8});
        }
    }

    // Golden hour afternoon - only during daylight, before sunset
    if (goldenAfternoonIntensity > 0 && sunsetIntensity === 0 && isDaylight) {
        let bias = 1.0 + goldenAfternoonIntensity * 0.8;
        if (isAutumn) bias += 0.4;
        
        // Adjust for cloud cover - no golden/warm lighting when cloudy
        if (cloudCoverage < 30) {
            // Clear: full golden hour with warm lighting
            lightingElements.push({text: "golden hour, warm sunlight, long shadows", bias});
        } else if (cloudCoverage < 60) {
            // Partly cloudy: reduced golden hour, softer lighting
            lightingElements.push({text: "golden hour, soft lighting, diffuse shadows", bias: bias - 0.4});
        } else if (cloudCoverage < 80) {
            // Mostly cloudy: no golden/warm terms, just soft diffused light
            lightingElements.push({text: "soft lighting, diffuse shadows, filtered light", bias: bias - 0.6});
        } else {
            // Heavy clouds: no golden hour lighting at all, flat/cool lighting
            lightingElements.push({text: "flat lighting, diffuse shadows, cool lighting", bias: bias - 0.8});
        }
    }

    // Midday
    if (middayIntensity > 0) {
        let bias = 1.0 + middayIntensity * 0.9;
        if (isWinter) bias -= 0.2; // winter midday is colder/bluer
        
        // Adjust for cloud cover
        if (cloudCoverage < 30) {
            lightingElements.push({text: "overhead sunlight, midday, short shadows, bright daylight", bias});
        } else if (cloudCoverage < 70) {
            lightingElements.push({text: "midday, soft sunlight, diffuse shadows, filtered light", bias: bias - 0.2});
        } else {
            lightingElements.push({text: "midday, cloudy, flat lighting, no shadows, gray sky", bias: bias - 0.4});
        }
    }

    // Dawn - only apply during meaningful twilight period (first 30 minutes before sunrise)
    // Require minimum intensity to match period determination threshold
    if (dawnIntensity > 0.1) {
        let bias = 1.0 + dawnIntensity * 0.9;
        if (isSpring) bias += 0.3; // spring dawn extra soft
        
        // Adjust for cloud cover - more granular like golden hour
        if (cloudCoverage < 30) {
            lightingElements.push({text: "dawn, blue hour, twilight, soft pastel sky", bias});
        } else if (cloudCoverage < 60) {
            lightingElements.push({text: "dawn, blue hour, muted twilight, soft sky", bias: bias - 0.3});
        } else if (cloudCoverage < 80) {
            lightingElements.push({text: "dawn, low light, gray sky, muted colors", bias: bias - 0.5});
        } else {
            // Heavy clouds: very muted, no pastel/blue hour
            lightingElements.push({text: "dawn, very low light, dark gray sky, muted colors", bias: bias - 0.7});
        }
    }

    // Dusk - only apply during meaningful twilight period (first 30 minutes after sunset)
    // Require minimum intensity to avoid applying dusk when sun is completely down
    if (duskIntensity > 0.1) {
        // Base bias is lower for dusk to prevent over-brightness
        let bias = 0.8 + duskIntensity * 0.5; // Reduced from 1.0 + 0.9
        
        // Adjust for cloud cover - cloudy sky dusk should be much darker
        if (cloudCoverage < 30) {
            // Clear sky dusk - can have some twilight/blue hour
            lightingElements.push({text: "dusk, low light, blue hour, twilight, dim lighting, artificial lighting", bias});
            undesiredElements.push({text: "bright daylight, bright sky, sunlight, sky, bright lighting", bias: bias + 0.5});
        } else if (cloudCoverage < 50) {
            // Partly cloudy dusk - reduced light
            lightingElements.push({text: "dusk, very low light, dim twilight, artificial lighting", bias: bias - 0.2});
            undesiredElements.push({text: "bright daylight, bright sky, sunlight, sky, bright lighting, blue hour", bias: bias + 0.6});
        } else if (cloudCoverage < 80) {
            // Cloudy sky dusk - very dark
            lightingElements.push({text: "dusk, very low light, dark sky, dim artificial lighting", bias: bias - 0.4});
            undesiredElements.push({text: "bright daylight, bright sky, sunlight, sky, bright lighting, blue hour, twilight, clear sky", bias: bias + 0.8});
        } else {
            // Heavy cloudy sky dusk - extremely dark
            lightingElements.push({text: "dusk, extremely low light, dark cloudy sky, minimal artificial lighting", bias: bias - 0.6});
            undesiredElements.push({text: "bright daylight, bright sky, sunlight, bright lighting, blue hour, twilight, clear sky, any natural light", bias: bias + 1.0});
        }
    }

    // Base sky with seasonal tint (fallback when no specific period lighting is strong)
    if (lightingElements.length === 0 || lightingElements.every(el => el.bias < 1.5)) {
        if (isDaylight) {
            // Adjust base sky based on cloud cover - don't suggest clear/bright when cloudy
            if (cloudCoverage < 30) {
                let clearBias = 1.0 + clearSkyStrength;
                if (isAutumn) clearBias += 0.3;
                if (isWinter) clearBias -= 0.15;
                lightingElements.push({text: "bright sunlight, hard shadows", bias: clearBias});
            } else if (cloudCoverage < 60) {
                let filteredBias = 1.0 + (1.0 - cloudCoverage / 100) * 0.5;
                if (isAutumn) filteredBias += 0.2;
                lightingElements.push({text: "filtered sunlight, soft shadows", bias: filteredBias});
            } else if (cloudCoverage < 80) {
                let cloudyBias = 1.0 + (cloudCoverage / 100) * 0.3;
                lightingElements.push({text: "diffused light, soft shadows", bias: cloudyBias});
            } else {
                // Heavy clouds: flat, cool lighting
                let overcastBias = 1.0 + (cloudCoverage / 100) * 0.5;
                lightingElements.push({text: "flat lighting, cool tones", bias: overcastBias});
            }

            const overcastBias = 1.0 + overcastStrength;
            undesiredElements.push({text: "cloudy sky, cloudy, diffuse lighting", bias: overcastBias});
        } else if (sunPhase === 'post-dusk' || sunPhase === 'pre-dawn') {
            // Night sky - only when sun is truly at 0% (post-dusk or pre-dawn)
            // Don't apply night sky during dusk twilight period
            const clearBias = 1.0 + clearSkyStrength + midnightIntensity * 0.6;
            lightingElements.push({text: "clear night sky, starry sky, stars, milky way, moon, moonlit", bias: clearBias});
            undesiredElements.push({text: "pitch black, cloudy sky night", bias: 1.0 + overcastStrength});
        }
    }

    // ===================================================================
    // ATMOSPHERIC + SEASONAL ELEMENTS
    // ===================================================================
    const atmosphericElements = [...seasonalElements]; // season first

    // Temperature
    const coldIntensity = Math.max(0, (15 - Math.max(feelsLike, -20)) / 35); // 1.0 at ≤-20°C, 0 at ≥15°C
    const hotIntensity   = Math.max(0, (feelsLike - 25) / 20);           // 1.0 at ≥45°C, 0 at ≤25°C

    if (coldIntensity > 0) {
        atmosphericElements.push({text: "visible breath", bias: 1.0 + coldIntensity * 1.0});
        if (coldIntensity > 0.4) {
            atmosphericElements.push({text: "frost", bias: 1.0 + coldIntensity * 0.9});
        }
    }
    if (hotIntensity > 0) {
        atmosphericElements.push({text: "heat haze", bias: 1.0 + hotIntensity});
        atmosphericElements.push({text: "sweat, glistening skin", bias: 1.0 + hotIntensity * 0.8});
    }

    // Wind
    const windIntensity = Math.min(windSpeed / 40, 1.0);
    if (windIntensity > 0.05) {
        const bias = 1.0 + windIntensity;
        atmosphericElements.push({text: "wind blowing", bias});
        if (clothingEffects) {
            atmosphericElements.push({text: "hair blowing, clothing flapping", bias});
        }
    }

    // Precipitation
    if (hasPrecipitation) {
        const precipIntensity = Math.min(precipRate / 30, 1.0);
        const bias = 1.0 + precipIntensity;
        const typeTag = precipType.includes("snow") ? "snowing, falling snowflakes" : "raining, falling rain";
        atmosphericElements.push({text: typeTag, bias: bias + 0.2});
        atmosphericElements.push({text: "wet surfaces, puddles", bias});
        if (precipType.includes("snow")) {
            atmosphericElements.push({text: "snow covered ground", bias: bias + 0.3});
        }
    }

    // Final period string
    // Use time range matching - same logic as the period ranges table
    // Calculate all period ranges and check which one contains the current time
    let periodDescription = "daytime";
    
    // Helper function to check if currentHour falls within a time range
    const isInRange = (startHour, endHour, checkHour) => {
        if (startHour === null || endHour === null || checkHour === null) {
            return false;
        }

        // Handle ranges expressed past 24h (e.g., duskEnd → dawnStart+24)
        if (endHour >= 24 && startHour < endHour) {
            const normalizedCheck = checkHour < startHour ? checkHour + 24 : checkHour;
            return normalizedCheck >= startHour && normalizedCheck < endHour;
        }

        // Handle traditional wrap-around (start > end)
        if (endHour < startHour) {
            return checkHour >= startHour || checkHour < endHour;
        }

        return checkHour >= startHour && checkHour < endHour;
    };
    
    // Build array of periods with their time ranges (same as table logic)
    const periodRanges = [];
    
    // Dawn
    if (dawnStartHour !== null && sunriseHour !== null) {
        periodRanges.push({
            name: "dawn",
            startHour: dawnStartHour,
            endHour: sunriseHour,
            priority: 9 // Higher priority than daytime
        });
    }
    
    // Sunrise
    if (sunriseHour !== null) {
        const sunriseStart = sunriseHour - 0.25;
        const sunriseEnd = sunriseHour + 0.25;
        periodRanges.push({
            name: "sunrise",
            startHour: sunriseStart,
            endHour: sunriseEnd,
            priority: 10 // Highest priority
        });
    }
    
    // Golden Hour Morning
    if (sunriseHour !== null) {
        const goldenStart = sunriseHour + 0.25;
        const goldenEnd = sunriseHour + 1.5;
        // Use "morning" when cloudy, "golden hour" when clear (matches table display logic)
        const periodName = cloudCoverage >= 60 ? "morning" : "golden hour";
        periodRanges.push({
            name: periodName,
            startHour: goldenStart,
            endHour: goldenEnd,
            priority: 8,
            condition: () => isDaylight
        });
    }
    
    // Daytime (AM) - gap between Golden Hour AM and Midday
    if (sunriseHour !== null && solarNoon !== null) {
        const goldenMorningEnd = sunriseHour + 1.5;
        const middayStart = solarNoon - 2.0;
        if (goldenMorningEnd < middayStart) {
            periodRanges.push({
                name: "daytime",
                startHour: goldenMorningEnd,
                endHour: middayStart,
                priority: 7,
                condition: () => isDaylight
            });
        }
    }
    
    // Midday
    if (solarNoon !== null) {
        const middayStart = solarNoon - 2.0;
        const middayEnd = solarNoon + 2.0;
        periodRanges.push({
            name: "midday",
            startHour: middayStart,
            endHour: middayEnd,
            priority: 7,
            condition: () => isDaylight
        });
    }
    
    // Daytime (PM) - gap between Midday and Golden Hour PM
    if (solarNoon !== null && sunsetHour !== null) {
        const middayEnd = solarNoon + 2.0;
        const goldenAfternoonStart = sunsetHour - 1.5;
        if (middayEnd < goldenAfternoonStart) {
            periodRanges.push({
                name: "daytime",
                startHour: middayEnd,
                endHour: goldenAfternoonStart,
                priority: 7,
                condition: () => isDaylight
            });
        }
    }
    
    // Golden Hour Afternoon
    if (sunsetHour !== null) {
        const goldenStart = sunsetHour - 1.5;
        const goldenEnd = sunsetHour - 0.25;
        // Use "evening" when cloudy, "golden hour" when clear
        const periodName = cloudCoverage >= 60 ? "evening" : "golden hour";
        periodRanges.push({
            name: periodName,
            startHour: goldenStart,
            endHour: goldenEnd,
            priority: 8,
            condition: () => isDaylight
        });
    }
    
    // Sunset
    if (sunsetHour !== null) {
        const sunsetStart = sunsetHour - 0.25;
        const sunsetEnd = sunsetHour + 0.25;
        periodRanges.push({
            name: "sunset",
            startHour: sunsetStart,
            endHour: sunsetEnd,
            priority: 10 // Highest priority
        });
    }
    
    // Dusk
    if (sunsetHour !== null && duskEndHour !== null) {
        periodRanges.push({
            name: "dusk",
            startHour: sunsetHour,
            endHour: duskEndHour,
            priority: 9
        });
    }
    
    // Midnight (subset of night, higher priority)
    if (duskEndHour !== null) {
        periodRanges.push({
            name: "midnight",
            startHour: 22,
            endHour: 4,
            priority: 6,
            condition: () => (sunPhase === 'post-dusk' || sunPhase === 'pre-dawn') && midnightIntensity > 0.7
        });
    }
    
    // Night
    if (duskEndHour !== null && dawnStartHour !== null) {
        periodRanges.push({
            name: "night",
            startHour: duskEndHour,
            endHour: dawnStartHour < duskEndHour ? dawnStartHour + 24 : dawnStartHour,
            priority: 5,
            condition: () => (sunPhase === 'post-dusk' || sunPhase === 'pre-dawn')
        });
    }
    
    // Find which period contains the current time
    // Sort by priority first (higher priority wins if multiple periods overlap)
    const matchingPeriods = periodRanges
        .filter(period => {
            // Check condition if present
            if (period.condition && !period.condition()) {
                return false;
            }
            // Check if current time is in range
            return isInRange(period.startHour, period.endHour, currentHour);
        })
        .sort((a, b) => b.priority - a.priority); // Higher priority first
    
    if (matchingPeriods.length > 0) {
        periodDescription = matchingPeriods[0].name;
    }
    
    // Generate periodKey from periodDescription
    const periodKey = periodDescription.toLowerCase().replace(/\s+/g, '');

    // Calculate next time period transition for cache expiration
    let nextPeriodTransition = null;
    let nextPeriodTransitionHour = null;
    let nextPeriodName = null;
    
    if (timeInput && timeInput.timestamp) {
        const currentTimestamp = timeInput.timestamp;
        const currentDate = new Date(currentTimestamp);
        const transitions = [];
        
        // Collect all unique transition points from period ranges
        periodRanges.forEach(period => {
            // Add period boundaries as transition points
            if (period.startHour !== null && period.startHour !== undefined) {
                transitions.push({
                    hour: period.startHour,
                    periodName: period.name,
                    type: 'start'
                });
            }
            if (period.endHour !== null && period.endHour !== undefined) {
                transitions.push({
                    hour: period.endHour,
                    periodName: period.name,
                    type: 'end'
                });
            }
        });
        
        // Remove duplicates and calculate future timestamps
        const uniqueTransitions = [];
        const seenHours = new Set();
        
        transitions.forEach(transition => {
            const key = `${transition.hour}-${transition.type}`;
            if (!seenHours.has(key)) {
                seenHours.add(key);
                uniqueTransitions.push(transition);
            }
        });
        
        // Calculate timestamps for each transition (today and tomorrow)
        const futureTransitionTimestamps = uniqueTransitions
            .flatMap(transition => {
                const results = [];
                
                // Create timestamp for today's occurrence
                const todayDate = new Date(currentDate);
                todayDate.setHours(Math.floor(transition.hour), (transition.hour % 1) * 60, 0, 0);
                const todayTimestamp = todayDate.getTime();
                
                // If it's in the future today, add it
                if (todayTimestamp > currentTimestamp) {
                    results.push({
                        timestamp: todayTimestamp,
                        hour: transition.hour,
                        periodName: transition.periodName,
                        type: transition.type
                    });
                }
                
                // Always add tomorrow's occurrence as backup
                const tomorrowDate = new Date(todayDate);
                tomorrowDate.setDate(tomorrowDate.getDate() + 1);
                results.push({
                    timestamp: tomorrowDate.getTime(),
                    hour: transition.hour,
                    periodName: transition.periodName,
                    type: transition.type
                });
                
                return results;
            })
            .filter(t => t.timestamp > currentTimestamp)
            .sort((a, b) => a.timestamp - b.timestamp);
        
        // Get the next transition
        if (futureTransitionTimestamps.length > 0) {
            const nextTransition = futureTransitionTimestamps[0];
            nextPeriodTransition = nextTransition.timestamp;
            nextPeriodTransitionHour = nextTransition.hour;
            nextPeriodName = nextTransition.periodName;
        }
    }

    // Detailed logging: Show all period ranges in a table
    if (logger && typeof logger.detailed === 'function') {
        logPeriodRangesTable({
            currentHour,
            sunriseHour,
            sunsetHour,
            solarNoon,
            dawnStartHour,
            duskEndHour,
            periodDescription,
            sunPhase,
            perceivableLight,
            sunProgressRaw,
            isDaylight,
            sunriseIntensity,
            sunsetIntensity,
            dawnIntensity,
            duskIntensity,
            goldenMorningIntensity,
            goldenAfternoonIntensity,
            middayIntensity,
            midnightIntensity,
            cloudCoverage
        });
    }

    return {
        period: periodDescription,
        periodKey: normalizePeriodKey(periodKey),
        lighting: lightingElements,
        atmosphere: atmosphericElements,
        uc: undesiredElements,
        season: season || null,
        timeOfDay: currentHour < 12 ? 'morning' : currentHour < 18 ? 'afternoon' : 'evening/night',
        transitionType: getTransitionType(currentHour, sunriseHour, sunsetHour),
        sunriseHour,
        sunsetHour,
        solarNoon,
        daylightHours,
        sunPhase,
        sunProgressRaw,
        perceivableLight,
        lightLevelRaw: adjustedLightLevelRaw,
        isBeforeSunrise: (sunriseHour !== null) ? (currentHour < sunriseHour) : false,
        isAfterSunset: (sunsetHour !== null) ? (currentHour > sunsetHour) : false,
        isDaytime: isDaylight,
        isRisingPhase: (sunriseHour !== null && solarNoon !== null) ? (currentHour > sunriseHour && currentHour <= solarNoon) : false,
        isSettingPhase: (solarNoon !== null && sunsetHour !== null) ? (currentHour > solarNoon && currentHour <= sunsetHour) : false,
        nextPeriodTransition: nextPeriodTransition, // Timestamp of next period transition
        nextPeriodTransitionHour: nextPeriodTransitionHour, // Hour of next transition (for display)
        nextPeriodName: nextPeriodName // Name of period that starts at next transition
    };
}
module.exports = {
    determineTimePeriod,
    getSunriseSunset
};
