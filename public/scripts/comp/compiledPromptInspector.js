/**
 * Compiled Prompt Inspector: the Reality Crossover Information tool window (#compiledPromptModal),
 * a light Vista window (css/compiled-prompt-lcd.css): Rentan's scene cards on the Sidebar Weather
 * gadget's faces, then the readings and Rentan's record as a grouped Property / Value list.
 *
 * Dependencies: escapeHtml (utilities.js), showGlassToast, openModal / closeModal (modalUtils.js),
 * toggleWeatherUnits / togglePeriodDetails / calculateSeasonProgress / getSeasonIcon
 * (dynamicGenerationOverrides.js).
 */

// Show compiled prompt modal
function showCompiledPromptModal(compiledPromptData = null) {
    let compiled;

    if (compiledPromptData) {
        compiled = compiledPromptData;
    } else {
        if (!window.dynamicGenerationData || !window.dynamicGenerationData.compiled_prompt) {
            showGlassToast('warning', null, 'No compiled prompt available to view.', false, undefined, '<i class="fas fa-glasses-round"></i>');
            return;
        }
        compiled = window.dynamicGenerationData.compiled_prompt;
    }
    const modal = document.getElementById('compiledPromptModal');
    const content = document.getElementById('compiledPromptContent');

    if (!modal || !content) {
        console.error('Compiled prompt modal not found in HTML');
        return;
    }

    const contextContent = buildCompiledContextHtml(compiled);

    // Rentan's own record of the compile: who wrote it, when, and what it set (escapeHtml:
    // public/scripts/comp/utilities.js). A grouped property list, as a Details tab shows one.
    const stamp = (value) => (value ? new Date(value).toLocaleString() : null);
    const author = compiled.source === 'agent' ? 'Agent' : 'Wren';
    const groups = [
        crossoverPropGroup('Rentan', [
            [author, compiled.summary],
            ['Created', stamp(compiled.timestamp)],
            ['Expires', stamp(compiled.expiresAt)],
            ['Cache', compiled.cache_locked ? 'Locked' : null],
            ['Context', compiled.context_locked ? 'Locked' : null]
        ]),
        crossoverPropGroup('Expanders', (Array.isArray(compiled.dg_expanders) ? compiled.dg_expanders : [])
            .map((entry) => [`!${entry.prefix || ''}`, entry.value])),
        crossoverPropGroup('Applied', Object.entries(compiled.applied || {})
            .map(([control, line]) => [crossoverLabel(control), line]))
    ].filter(Boolean);
    const metadataContent = groups.length ? crossoverPropList(groups.join('')) : '';

    content.innerHTML = [contextContent, metadataContent].filter(Boolean).join('')
        || '<p class="crossover-empty">This compile has no scene or Rentan details.</p>';

    openModal(modal);
    modal.focus();
}

// ---- property list: a white list view with Property / Value columns and Explorer group
// headers (css/compiled-prompt-lcd.css). Values are escaped here unless passed as { html }.

function crossoverLabel(key) {
    return String(key || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function crossoverPropRow(name, value) {
    if (value === null || value === undefined || value === '') return '';
    const html = value && typeof value === 'object' && 'html' in value
        ? value.html
        : escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value));
    return `<div class="crossover-prop" role="row"><span class="crossover-prop-name" role="cell">${escapeHtml(String(name))}</span><span class="crossover-prop-value selectable" role="cell">${html}</span></div>`;
}

function crossoverPropGroup(title, rows) {
    const body = rows.map(([name, value]) => crossoverPropRow(name, value)).join('');
    if (!body) return '';
    return `<div class="crossover-group" role="rowgroup"><div class="crossover-group-head">${escapeHtml(title)}</div>${body}</div>`;
}

function crossoverPropList(groupsHtml) {
    if (!groupsHtml) return '';
    return `<div class="crossover-props" role="table"><div class="crossover-props-head" role="row"><span role="columnheader">Property</span><span role="columnheader">Value</span></div>${groupsHtml}</div>`;
}

// Rentan's weather vocabulary (modules/dynamicGenerationHandlers.js mapOpenMeteoCondition) as the
// Sidebar Weather gadget words it; code 0 is stored as "none" (a clear sky).
const CROSSOVER_CONDITION_NAMES = {
    none: 'Clear',
    'clear sky': 'Clear',
    'few clouds': 'Mostly Clear',
    'mainly clear': 'Mostly Clear',
    'partly cloudy': 'Partly Cloudy',
    cloudy: 'Cloudy',
    overcast: 'Cloudy'
};

function crossoverConditionName(condition) {
    const key = String(condition || '').toLowerCase();
    if (!key) return 'Unknown';
    return CROSSOVER_CONDITION_NAMES[key] || crossoverLabel(key);
}

// The Weather gadget's face, as vistaSidebar.js picks it: black at night, else grey under cloud,
// rain, snow, fog and storms, else blue.
function crossoverGadgetFace(condition, isNight) {
    if (isNight) return 'gadget-face-black';
    if (/drizzle|rain|snow|fog|thunder|hail|showers|sleet|overcast|^cloudy$/i.test(String(condition || ''))) return 'gadget-face-gray';
    return 'gadget-face-blue';
}

// Tonight's moon, for a clear night sky (the gadget draws the moon phase there; same formula as
// vistaSidebar.js vsbMoonPhase)
function crossoverMoonPhase() {
    const phases = ['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent'];
    const days = (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    const age = ((days % 29.530588853) + 29.530588853) % 29.530588853;
    return phases[Math.round(age / 29.530588853 * 8) % 8];
}

// Rentan context cards (time period, holiday, weather, hourly) for compiled_prompt.context.
// Shared by the Reality Crossover window and the image Inspector (imagePromptInspector.js).
function buildCompiledContextHtml(compiled) {
    // Weather icon mapping function using Weather Icons
    function getWeatherIcon(condition, isNight = false) {
        if (!condition) return isNight ? '<i class="wi wi-night-clear"></i>' : '<i class="wi wi-day-sunny"></i>';

        const timePrefix = isNight ? 'night-alt' : 'day';

        // Icons that don't change between day/night (no sun/moon influence)
        const timeNeutralIcons = {
            'overcast': 'cloudy',
            'cloudy': 'cloudy',
            'fog': 'fog',
            'depositing rime fog': 'fog',
            'moderate snow fall': 'snow',
            'heavy snow fall': 'snow',
            'snow grains': 'snow',
            'heavy snow showers': 'snow'
        };

        // Check if this condition uses a time-neutral icon
        if (timeNeutralIcons[condition]) {
            return `<i class="wi wi-${timeNeutralIcons[condition]}"></i>`;
        }

        // Time-dependent icons (different for day/night)
        const iconMap = {
            'none': isNight ? 'night-clear' : 'day-sunny',
            'clear sky': isNight ? 'night-clear' : 'day-sunny',
            'few clouds': isNight ? 'night-alt-partly-cloudy' : 'day-sunny-overcast',
            'mainly clear': isNight ? 'night-alt-partly-cloudy' : 'day-sunny-overcast',
            'partly cloudy': `${timePrefix}-cloudy`,
            'light drizzle': `${timePrefix}-showers`,
            'moderate drizzle': `${timePrefix}-showers`,
            'dense drizzle': `${timePrefix}-showers`,
            'light freezing drizzle': `${timePrefix}-snow`,
            'dense freezing drizzle': `${timePrefix}-snow`,
            'slight rain': `${timePrefix}-rain`,
            'moderate rain': `${timePrefix}-rain`,
            'heavy rain': `${timePrefix}-rain`,
            'light freezing rain': `${timePrefix}-snow`,
            'heavy freezing rain': `${timePrefix}-snow`,
            'slight snow fall': `${timePrefix}-snow`,
            'slight rain showers': `${timePrefix}-showers`,
            'moderate rain showers': `${timePrefix}-rain`,
            'violent rain showers': `${timePrefix}-storm-showers`,
            'slight snow showers': `${timePrefix}-snow`,
            'thunderstorm': `${timePrefix}-thunderstorm`,
            'thunderstorm with slight hail': `${timePrefix}-thunderstorm`,
            'thunderstorm with heavy hail': `${timePrefix}-thunderstorm`
        };

        const iconClass = iconMap[condition] || (isNight ? 'night-clear' : 'day-sunny');
        const moon = iconClass === 'night-clear' ? ` moon-${crossoverMoonPhase()}` : '';
        return `<i class="wi wi-${iconClass}${moon}"></i>`;
    }

    // Unit conversion functions
    function celsiusToFahrenheit(celsius) {
        return Math.round((celsius * 9 / 5) + 32);
    }

    function mpsToMph(mps) {
        return Math.round(mps * 2.237);
    }

    function mpsToKmh(mps) {
        return Math.round(mps * 3.6);
    }

    // Global unit preference (can be made persistent later)
    let useMetric = localStorage.getItem('weather_units_metric') !== 'false'; // Default to true if not set

    // Function to get wind direction from degrees
    function getWindDirection(degrees) {
        if (degrees === null || degrees === undefined) return 'N/A';
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(degrees / 22.5) % 16;
        return directions[index];
    }

    // Build context section
    let contextContent = '';
    if (compiled.context) {
        const context = compiled.context;
        const weather = context.weather || {};
        const time = context.time || {};

        // Build modern weather section
        let weatherContent = '';
        if (weather.condition || weather.temperature !== undefined) {
            // Determine if it's night based on timePeriod
            const isNight = context.timePeriod?.isDaytime === false;
            const weatherIcon = getWeatherIcon(weather.condition, isNight);

            // Get weather alerts
            const alerts = weather.weatherQuality?.alerts || [];
            const hasAlerts = alerts.length > 0;

            // Get heat index and wind chill
            const heatIndex = weather.weatherQuality?.heatIndex;
            const windChill = weather.weatherQuality?.windChill;
            const uvWarnings = weather.weatherQuality?.uvWarnings;

            // Temperature with unit toggle
            const tempC = weather.temperature;
            const tempF = tempC !== undefined ? celsiusToFahrenheit(tempC) : null;
            const tempDisplay = useMetric ?
                (tempC !== undefined ? `${tempC}°C` : 'N/A') :
                (tempF !== undefined ? `${tempF}°F` : 'N/A');

            // Feels like temperature
            const feelsC = weather.feelsLike;
            const feelsF = feelsC !== undefined ? celsiusToFahrenheit(feelsC) : null;
            const feelsDisplay = useMetric ?
                (feelsC !== undefined ? `${feelsC}°C` : 'N/A') :
                (feelsF !== undefined ? `${feelsF}°F` : 'N/A');

            // Wind speed with unit toggle
            const windMps = weather.windSpeed;
            const windMph = windMps !== undefined ? mpsToMph(windMps) : null;
            const windDisplay = useMetric ?
                (windMps !== undefined ? `${windMps} m/s` : 'N/A') :
                (windMph !== undefined ? `${windMph} mph` : 'N/A');

            // Format all weather values as strings with proper units
            const weatherCondition = crossoverConditionName(weather.condition);
            const comfortLevel = weather.weatherQuality?.comfortLevel || 'Unknown conditions';
            const humidityValue = weather.humidity !== undefined ? `${weather.humidity}%` : null;
            const windDirection = weather.windDirection !== undefined ? getWindDirection(weather.windDirection) : null;
            const pressureValue = weather.pressure !== undefined ? (useMetric ? `${weather.pressure} hPa` : `${(weather.pressure / 33.8639).toFixed(2)} inHg`) : null;
            const cloudCoverValue = weather.cloudCoverage !== undefined ? `${weather.cloudCoverage}%` : null;
            const visibilityValue = useMetric ?
                (weather.visibility !== undefined ? `${(weather.visibility / 1000).toFixed(1)} km` : null) :
                (weather.visibility !== undefined ? `${(weather.visibility * 0.000621371).toFixed(1)} mi` : null);
            const uvIndexValue = weather.uvIndex !== undefined ? `${weather.uvIndex} (${uvWarnings?.category || 'Unknown'})` : null;
            const heatIndexValue = heatIndex !== null ? (useMetric ? `${heatIndex}°C` : `${celsiusToFahrenheit(heatIndex)}°F`) : null;
            const windChillValue = windChill !== null ? (useMetric ? `${windChill}°C` : `${celsiusToFahrenheit(windChill)}°F`) : null;

            // Build main weather card - display temperature in correct format based on user preference
            const displayTemp = useMetric ? tempC : tempF;
            const displayFeels = useMetric ? feelsC : feelsF;

            // Format time and date separately
            let timeText = '';
            let dateText = '';

            if (time.hour !== undefined && time.minute !== undefined) {
                // Create date object for formatting
                const now = new Date();
                dateText = now.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                });

                const hour24 = time.hour;
                const minuteStr = String(time.minute).padStart(2, '0');
                timeText = `${hour24}:${minuteStr}`;
            }

            const seasonText = context.season || '';
            const location = context.location || {};
            const locationText = location.city && location.country ?
                `${location.city}, ${location.country}` :
                location.city || location.country || '';
            const timezoneStr = time.timezone || '';

            // Determine main card background based on season and pressure
            let cardBackgroundClass = '';
            if (context.season && weather.pressure !== undefined) {
                const seasonName = typeof context.season === 'object' && context.season?.name ? context.season.name : context.season;
                const season = typeof seasonName === 'string' ? seasonName.toLowerCase() : String(seasonName).toLowerCase();
                const pressure = weather.pressure;

                // Base season colors with pressure variations
                if (season.includes('spring')) {
                    if (pressure < 1000) {
                        cardBackgroundClass = 'season-spring-stormy';
                    } else if (pressure < 1013) {
                        cardBackgroundClass = 'season-spring-unstable';
                    } else if (pressure < 1020) {
                        cardBackgroundClass = 'season-spring-normal';
                    } else {
                        cardBackgroundClass = 'season-spring-stable';
                    }
                } else if (season.includes('summer')) {
                    if (pressure < 1000) {
                        cardBackgroundClass = 'season-summer-stormy';
                    } else if (pressure < 1013) {
                        cardBackgroundClass = 'season-summer-unstable';
                    } else if (pressure < 1020) {
                        cardBackgroundClass = 'season-summer-normal';
                    } else {
                        cardBackgroundClass = 'season-summer-stable';
                    }
                } else if (season.includes('fall') || season.includes('autumn')) {
                    if (pressure < 1000) {
                        cardBackgroundClass = 'season-fall-stormy';
                    } else if (pressure < 1013) {
                        cardBackgroundClass = 'season-fall-unstable';
                    } else if (pressure < 1020) {
                        cardBackgroundClass = 'season-fall-normal';
                    } else {
                        cardBackgroundClass = 'season-fall-stable';
                    }
                } else if (season.includes('winter')) {
                    if (pressure < 1000) {
                        cardBackgroundClass = 'season-winter-stormy';
                    } else if (pressure < 1013) {
                        cardBackgroundClass = 'season-winter-unstable';
                    } else if (pressure < 1020) {
                        cardBackgroundClass = 'season-winter-normal';
                    } else {
                        cardBackgroundClass = 'season-winter-stable';
                    }
                }
            } else if (context.season) {
                // Fallback to season-only colors if no pressure data
                const seasonName = typeof context.season === 'object' && context.season?.name ? context.season.name : context.season;
                const season = typeof seasonName === 'string' ? seasonName.toLowerCase() : String(seasonName).toLowerCase();
                if (season.includes('spring')) {
                    cardBackgroundClass = 'season-spring-normal';
                } else if (season.includes('summer')) {
                    cardBackgroundClass = 'season-summer-normal';
                } else if (season.includes('fall') || season.includes('autumn')) {
                    cardBackgroundClass = 'season-fall-normal';
                } else if (season.includes('winter')) {
                    cardBackgroundClass = 'season-winter-normal';
                }
            }

            const mainCardHtml = `
                <div class="weather-main-card ${cardBackgroundClass} ${crossoverGadgetFace(weather.condition, isNight)}">
                    <div class="weather-current-temp">
                        <div class="weather-temp-value">
                            <span class="weather-temp-number clickable" onclick="toggleWeatherUnits(event)" data-metric="${tempC !== undefined ? tempC : ''}" data-imperial="${tempF !== undefined ? tempF : ''}">${displayTemp !== undefined ? displayTemp : '--'}</span>
                            <span class="weather-temp-unit">${useMetric ? '°C' : '°F'}</span>
                        </div>
                        ${displayFeels !== undefined ? `<div class="weather-feels-like" data-metric="${feelsC !== undefined ? feelsC : ''}" data-imperial="${feelsF !== undefined ? feelsF : ''}">Feels like ${displayFeels}°${useMetric ? 'C' : 'F'}</div>` : ''}
                    </div>
                    <div class="weather-condition-display">
                        <div class="weather-condition-icon">${weatherIcon}</div>
                        <div class="weather-condition-text">${weatherCondition}</div>
                        <div class="weather-condition-details">
                            ${humidityValue ? `<div class="weather-condition-detail"><i class="fa-solid fa-droplet"></i>${humidityValue}</div>` : ''}
                            ${windDisplay !== 'N/A' ? `<div class="weather-condition-detail"><i class="fa-solid fa-wind"></i><span class="weather-wind-speed" data-metric="${windMps !== undefined ? windMps : ''}" data-imperial="${windMph !== undefined ? windMph : ''}">${windDisplay}</span>${windDirection ? ` (${windDirection})` : ''}</div>` : ''}
                            ${(() => {
                    let precipElements = [];

                    // Precipitation rate
                    if (weather.precipitation !== undefined && weather.precipitation > 0) {
                        const precipRate = useMetric ? `${weather.precipitation} mm/hr` : `${(weather.precipitation * 0.0393701).toFixed(2)} in/hr`;
                        precipElements.push(`<div class="weather-condition-detail"><i class="fa-solid fa-cloud-rain"></i><span class="weather-precip-rate" data-metric="${weather.precipitation}" data-unit="mm/hr">${precipRate}</span></div>`);
                    }

                    // Rain amount
                    if (weather.rain > 0) {
                        const rainAmount = useMetric ? `${weather.rain} mm` : `${(weather.rain * 0.0393701).toFixed(2)} in`;
                        precipElements.push(`<div class="weather-condition-detail"><i class="fa-solid fa-cloud-rain"></i>Rain: <span class="weather-rain-amount" data-metric="${weather.rain}" data-unit="mm">${rainAmount}</span></div>`);
                    }

                    // Showers amount
                    if (weather.showers > 0) {
                        const showerAmount = useMetric ? `${weather.showers} mm` : `${(weather.showers * 0.0393701).toFixed(2)} in`;
                        precipElements.push(`<div class="weather-condition-detail"><i class="fa-solid fa-cloud-showers-heavy"></i>Showers: <span class="weather-showers-amount" data-metric="${weather.showers}" data-unit="mm">${showerAmount}</span></div>`);
                    }

                    // Snowfall amount
                    if (weather.snowfall > 0) {
                        const snowAmount = useMetric ? `${weather.snowfall} cm` : `${(weather.snowfall * 0.393701).toFixed(2)} in`;
                        precipElements.push(`<div class="weather-condition-detail"><i class="fa-solid fa-snowflake"></i>Snow: <span class="weather-snow-amount" data-metric="${weather.snowfall}" data-unit="cm">${snowAmount}</span></div>`);
                    }

                    // Precipitation type - only show if there's actual precipitation
                    if (weather.precipitationType && (weather.precipitation > 0 || weather.rain > 0 || weather.showers > 0 || weather.snowfall > 0)) {
                        precipElements.push(`<div class="weather-condition-detail"><i class="fa-solid fa-cloud-rain"></i>${weather.precipitationType.description || weather.precipitationType}</div>`);
                    }

                    return precipElements.join('');
                })()}
                        </div>
                    </div>
                    ${weather.cloudCoverage !== undefined || weather.visibility !== undefined || weather.uvIndex !== undefined ? `
                    <div class="weather-card-header">
                        <div class="weather-quick-indicators">
                            ${weather.uvIndex !== undefined && weather.uvIndex > 0 ? `
                            <div class="weather-quick-indicator">
                                <div class="weather-quick-indicator-label">
                                    <i class="fa-solid fa-sun"></i>
                                    <span>UV ${weather.uvIndex}</span>
                                </div>
                                <div class="weather-quick-progress-bar">
                                    <div class="weather-quick-progress-fill uv-index" style="width: ${Math.min((weather.uvIndex / 12) * 100, 100)}%"></div>
                                </div>
                            </div>
                            ` : ''}
                            ${weather.cloudCoverage !== undefined ? `
                            <div class="weather-quick-indicator">
                                <div class="weather-quick-indicator-label">
                                    <i class="fa-solid fa-cloud"></i>
                                    <span>${weather.cloudCoverage}%</span>
                                </div>
                                <div class="weather-quick-progress-bar">
                                    <div class="weather-quick-progress-fill cloud-coverage" style="width: ${weather.cloudCoverage}%"></div>
                                </div>
                            </div>
                            ` : ''}
                            ${weather.visibility !== undefined ? `
                            <div class="weather-quick-indicator">
                                <div class="weather-quick-indicator-label">
                                    <i class="fa-solid fa-eye"></i>
                                    <span class="weather-visibility" data-metric="${weather.visibility / 1000}" data-unit="km">${useMetric ? `${(weather.visibility / 1000).toFixed(1)} km` : `${(weather.visibility * 0.000621371).toFixed(1)} mi`}</span>
                                </div>
                                <div class="weather-quick-progress-bar">
                                    <div class="weather-quick-progress-fill visibility" style="width: ${Math.min((weather.visibility / 10000) * 100, 100)}%"></div>
                                </div>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                    ` : ''}
                </div>
            `;

            // A reading for the property list; its value keeps the data-metric / data-imperial pair
            // so toggleWeatherUnits (dynamicGenerationOverrides.js) can switch the units in place.
            const weatherRow = (label, value, metricValue = null, imperialValue = null, unitType = null) => {
                if (!value) return null;
                const dataAttrs = (metricValue !== null && imperialValue !== null)
                    ? ` data-metric="${metricValue}" data-imperial="${imperialValue}"${unitType ? ` data-unit-type="${unitType}"` : ''}`
                    : '';
                const clickable = dataAttrs ? ' clickable" onclick="toggleWeatherUnits(event)" title="Click to switch units' : '';
                return [label, { html: `<span class="weather-detail-value${clickable}"${dataAttrs}>${value}</span>` }];
            };

            // Only show heat index if it differs from actual temp by 2°C or more
            const showHeatIndex = heatIndex !== null && heatIndex !== undefined && tempC !== undefined && Math.abs(heatIndex - tempC) >= 2;
            const showWindChill = windChill !== null && windChill !== undefined && tempC !== undefined && Math.abs(windChill - tempC) >= 0.5;

            const weatherRows = [
                ['Comfort', weather.weatherQuality?.comfortLevel ? crossoverLabel(weather.weatherQuality.comfortLevel.split(' - ')[0]) : null],
                weatherRow('Pressure', pressureValue, weather.pressure, weather.pressure ? weather.pressure / 33.8639 : null, 'pressure'),
                showHeatIndex ? weatherRow('Heat index', heatIndexValue, heatIndex, celsiusToFahrenheit(heatIndex), 'temperature') : null,
                showWindChill ? weatherRow('Wind chill', windChillValue, windChill, celsiusToFahrenheit(windChill), 'temperature') : null,
                weather.windGust ? weatherRow('Wind gust', useMetric ? `${weather.windGust} m/s` : `${mpsToMph(weather.windGust)} mph`, weather.windGust, mpsToMph(weather.windGust), 'wind') : null,
                ['Dew point', weather.dewPoint !== undefined && weather.dewPoint !== null ? (useMetric ? `${weather.dewPoint}°C` : `${celsiusToFahrenheit(weather.dewPoint)}°F`) : null],
                ['UV index', uvIndexValue],
                ['Sky', weather.generationCondition || null],
                ['Source', weather.dataSource || null]
            ].filter(Boolean);

            // Hourly forecast: one row an hour, the time then the sky, temperature and rain
            const hourlyRows = [];
            if (Array.isArray(weather.hourly) && weather.hourly.length > 0) {
                weather.hourly.slice(0, 6).forEach((hour, index) => {
                    const hourTime = new Date(hour.timestamp);
                    const hourTempC = hour.temperature !== undefined && hour.temperature !== null ? hour.temperature : null;
                    const hourTempF = hourTempC !== null ? celsiusToFahrenheit(hourTempC) : null;
                    const hourTemp = hourTempC === null ? '' : (useMetric ? `${hourTempC}°C` : `${hourTempF}°F`);
                    const timeLabel = index === 0 ? 'Now' : hourTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    const precipMetric = hour.precipitation > 0 ? hour.precipitation : null;
                    const precipDisplay = precipMetric !== null
                        ? (useMetric ? `${precipMetric}mm` : `${(precipMetric * 0.0394).toFixed(1)}in`) : '';
                    const bits = [escapeHtml(crossoverConditionName(hour.condition))];
                    if (hourTemp) bits.push(`<span class="weather-hour-temp" data-metric="${hourTempC}" data-imperial="${hourTempF}">${hourTemp}</span>`);
                    if (precipDisplay) bits.push(`<span class="weather-hour-precip" data-metric="${precipMetric}" data-unit="mm">${precipDisplay}</span>`);
                    hourlyRows.push([timeLabel, { html: bits.join(', ') }]);
                });
            }

            // Weather alerts: IE's information bar on the light client
            const alertsHtml = hasAlerts ? alerts.map((alert) => `
                    <div class="weather-alert-card ${escapeHtml(String(alert.severity || ''))}">
                        <div class="weather-alert-content">
                            <div class="weather-alert-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
                            <div class="weather-alert-text">
                                <div class="weather-alert-title">${escapeHtml(String(alert.title || ''))}</div>
                                <div class="weather-alert-message">${escapeHtml(String(alert.message || ''))}</div>
                            </div>
                        </div>
                    </div>
                `).join('') : '';

            const weatherList = crossoverPropList(
                crossoverPropGroup('Weather', weatherRows) + crossoverPropGroup('Next hours', hourlyRows)
            );
            weatherContent = `<div class="weather-display">${mainCardHtml}${alertsHtml}${weatherList}</div>`;
        }

        // Time and season information
        // timePeriod is stored at context.timePeriod, not context.time.timePeriod
        const timePeriodInfo = context.timePeriod || {};
        // lighting / atmosphere are [{ text, bias }] lists and season is { name, holiday, ... }
        const phraseList = (value) => (Array.isArray(value)
            ? value.map((el) => (el && typeof el === 'object' ? el.text : el)).filter(Boolean).join(', ')
            : value);
        const seasonName = context.season && typeof context.season === 'object' ? context.season.name : context.season;
        const timeRows = [
            ['Time period', timePeriodInfo.period ? crossoverLabel(timePeriodInfo.period) : null],
            ['Lighting', phraseList(timePeriodInfo.lighting)],
            ['Atmosphere', phraseList(timePeriodInfo.atmosphere)],
            ['Season', seasonName ? crossoverLabel(seasonName) : null],
            ['Hour', time.hour !== undefined ? `${time.hour}:${String(time.minute || 0).padStart(2, '0')}` : null],
            ['Time zone', time.timezone]
        ];

        // Create period information card
        let periodCardHtml = '';
        const hasHoliday = context.season?.holiday?.primaryHoliday;
        if (context.season && timePeriodInfo.period) {
            // Determine background class based on season + time period + lighting/atmosphere
            let periodBgClass = 'period-default';

            const seasonName = typeof context.season === 'object' && context.season?.name ? context.season.name : context.season;
            const season = typeof seasonName === 'string' ? seasonName.toLowerCase() : String(seasonName).toLowerCase();
            const period = timePeriodInfo.period ? timePeriodInfo.period.toLowerCase() : '';
            const lighting = timePeriodInfo.lighting ? (Array.isArray(timePeriodInfo.lighting)
                ? timePeriodInfo.lighting.map(el => (typeof el === 'object' ? el.text : el)).join(' ')
                : String(timePeriodInfo.lighting)).toLowerCase() : '';
            const atmosphere = timePeriodInfo.atmosphere ? (Array.isArray(timePeriodInfo.atmosphere)
                ? timePeriodInfo.atmosphere.map(el => (typeof el === 'object' ? el.text : el)).join(' ')
                : String(timePeriodInfo.atmosphere)).toLowerCase() : '';

            // Combine factors for background selection
            if (season.includes('spring')) {
                if (period.includes('dawn') || period.includes('sunrise')) {
                    periodBgClass = 'period-spring-dawn';
                } else if (period.includes('morning')) {
                    periodBgClass = 'period-spring-morning';
                } else if (period.includes('noon') || period.includes('afternoon')) {
                    periodBgClass = 'period-spring-day';
                } else if (period.includes('dusk') || period.includes('sunset') || period.includes('evening')) {
                    periodBgClass = 'period-spring-dusk';
                } else if (period.includes('night')) {
                    periodBgClass = 'period-spring-night';
                }
            } else if (season.includes('summer')) {
                if (period.includes('dawn') || period.includes('sunrise')) {
                    periodBgClass = 'period-summer-dawn';
                } else if (period.includes('morning') || period.includes('noon') || period.includes('afternoon')) {
                    periodBgClass = 'period-summer-day';
                } else if (period.includes('dusk') || period.includes('sunset') || period.includes('evening')) {
                    periodBgClass = 'period-summer-dusk';
                } else if (period.includes('night')) {
                    periodBgClass = 'period-summer-night';
                }
            } else if (season.includes('fall') || season.includes('autumn')) {
                if (period.includes('dawn') || period.includes('sunrise')) {
                    periodBgClass = 'period-fall-dawn';
                } else if (period.includes('morning') || period.includes('noon') || period.includes('afternoon')) {
                    periodBgClass = 'period-fall-day';
                } else if (period.includes('dusk') || period.includes('sunset') || period.includes('evening')) {
                    periodBgClass = 'period-fall-dusk';
                } else if (period.includes('night')) {
                    periodBgClass = 'period-fall-night';
                }
            } else if (season.includes('winter')) {
                if (period.includes('dawn') || period.includes('sunrise')) {
                    periodBgClass = 'period-winter-dawn';
                } else if (period.includes('morning') || period.includes('noon') || period.includes('afternoon')) {
                    periodBgClass = 'period-winter-day';
                } else if (period.includes('dusk') || period.includes('sunset') || period.includes('evening')) {
                    periodBgClass = 'period-winter-dusk';
                } else if (period.includes('night')) {
                    periodBgClass = 'period-winter-night';
                }
            }

            // Adjust for atmospheric conditions
            if (atmosphere.includes('fog') || atmosphere.includes('mist')) {
                periodBgClass += ' foggy';
            } else if (atmosphere.includes('cloud') || atmosphere.includes('overcast')) {
                periodBgClass += ' cloudy';
            } else if (atmosphere.includes('clear') || atmosphere.includes('bright')) {
                periodBgClass += ' clear';
            }

            // Convert periodKey to pretty display name
            let shortTitle = 'Time';
            if (timePeriodInfo.periodKey) {
                // Special handling for specific period keys
                const periodKeyMap = {
                    'predawn': 'Pre-Dawn',
                    'pre_dawn': 'Pre-Dawn',
                    'dawn': 'Dawn',
                    'sunrise': 'Sunrise',
                    'morning': 'Morning',
                    'latemorning': 'Late Morning',
                    'late_morning': 'Late Morning',
                    'noon': 'Noon',
                    'daytime': 'Daytime',
                    'earlyafternoon': 'Early Afternoon',
                    'early_afternoon': 'Early Afternoon',
                    'afternoon': 'Afternoon',
                    'lateafternoon': 'Late Afternoon',
                    'late_afternoon': 'Late Afternoon',
                    'goldenhour': 'Golden Hour',
                    'golden_hour': 'Golden Hour',
                    'evening': 'Evening',
                    'sunset': 'Sunset',
                    'dusk': 'Dusk',
                    'twilight': 'Twilight',
                    'night': 'Night',
                    'midnight': 'Midnight',
                    'latenight': 'Late Night',
                    'late_night': 'Late Night'
                };

                shortTitle = periodKeyMap[timePeriodInfo.periodKey.toLowerCase()] ||
                    timePeriodInfo.periodKey
                        .split('_')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
            }

            // Format time and date
            const clockTime = time.hour !== undefined ? `${time.hour}:${String(time.minute || 0).padStart(2, '0')}` : '';
            const dateStr = time.dayOfWeekName && time.monthName ?
                `${time.dayOfWeekName}, ${time.monthName} ${time.dayOfMonth}, ${time.year}` :
                (time.month !== undefined && time.dayOfMonth !== undefined && time.year !== undefined ?
                    `${time.month + 1}/${time.dayOfMonth}/${time.year}` : '');
            const timezoneStr = time.timezone || '';

            // Location text for period card
            const location = context.location || {};
            const locationText = location.city && location.country ?
                `${location.city}, ${location.country}` :
                location.city || location.country || '';

            // Progress bar data
            const sunProgressRaw = timePeriodInfo.sunProgressRaw !== undefined ? timePeriodInfo.sunProgressRaw : 0;
            const lightLevelRaw = timePeriodInfo.lightLevelRaw !== undefined ? timePeriodInfo.lightLevelRaw : 0;

            // Calculate sun position for display
            const sunPhase = timePeriodInfo.sunPhase || 'rising';
            let sunPositionPercent;
            if (sunPhase === 'rising') {
                // Rising: sunProgressRaw 0-0.5 maps to 0-50% of total bar
                sunPositionPercent = (sunProgressRaw / 0.5) * 50;
            } else if (sunPhase === 'setting') {
                // Setting: sunProgressRaw 0.5-1.0 maps to 50-100% of total bar
                sunPositionPercent = 50 + ((sunProgressRaw - 0.5) / 0.5) * 50;
            } else {
                sunPositionPercent = sunPhase === 'pre-dawn' ? 0 : (sunPhase === 'post-dusk' ? 100 : 50);
            }

            // Calculate season progress and template (needed for both period and holiday cards)
            const seasonProgress = context.season ? calculateSeasonProgress(time, context.season) : 50;
            const seasonNameForTemplate = typeof context.season === 'object' && context.season?.name ? context.season.name : context.season;
            const seasonForTemplate = typeof seasonNameForTemplate === 'string' ? seasonNameForTemplate : String(seasonNameForTemplate || '');

            periodCardHtml = `
                <div class="period-info-card ${periodBgClass} ${timePeriodInfo.isDaytime === false ? 'gadget-face-black' : 'gadget-face-blue'}">
                    <div class="period-info-content">
                        <div class="period-main-info">
                            <div class="period-title-section">
                                <div class="period-title clickable" onclick="togglePeriodDetails(this)">
                                    ${shortTitle}
                                    <i class="fa-solid fa-chevron-down period-expand-icon"></i>
                                </div>
                                ${context.season ? `<div class="period-season-badge season-${seasonForTemplate.toLowerCase()}">${getSeasonIcon(seasonForTemplate)} ${seasonForTemplate}</div>` : ''}
                                ${time.hour !== undefined ? `
                                <div class="period-title-indicators">
                                    ${context.season ? `
                                    <div class="period-title-indicator">
                                        <div class="period-title-indicator-label">
                                            <span>Season</span>
                                            <span class="period-title-indicator-value">${seasonProgress}%</span>
                                        </div>
                                        <div class="period-title-progress-bar season-position season-${seasonForTemplate.toLowerCase()}">
                                            <div class="period-progress-marker" style="left: ${seasonProgress}%"></div>
                                        </div>
                                    </div>
                                    ` : ''}
                                    ${lightLevelRaw !== undefined && lightLevelRaw > 0 ? `
                                    <div class="period-title-indicator">
                                        <div class="period-title-indicator-label">
                                            <span>Sun</span>
                                        </div>
                                        <div class="period-title-progress-bar sun-position">
                                            <div class="period-progress-marker" style="left: ${sunPositionPercent}%"></div>
                                        </div>
                                    </div>
                                    <div class="period-title-indicator">
                                        <div class="period-title-indicator-label">
                                            <span>Light</span>
                                        </div>
                                        <div class="period-title-progress-bar light-level">
                                            <div class="period-progress-fill light-level" style="width: ${lightLevelRaw * 10}%"></div>
                                        </div>
                                    </div>
                                    ` : ''}
                                </div>
                                ` : ''}
                            </div>
                            ${clockTime || dateStr || locationText ? `
                            <div class="period-time-date">
                                ${clockTime ? `<div class="period-time">${clockTime}</div>` : ''}
                                ${dateStr ? `<div class="period-date">${dateStr}</div>` : ''}
                                ${locationText ? `<div class="period-location"><i class="fas fa-map-marker-alt"></i> ${locationText}</div>` : ''}
                            </div>
                            ` : ''}
                        </div>
                        <div class="period-details hidden">
                            ${timePeriodInfo.lighting ? `<div class="period-detail"><i class="fa-solid fa-lightbulb"></i><div class="detail-content"><div class="detail-label">Lighting</div><div class="detail-value">${Array.isArray(timePeriodInfo.lighting) ? timePeriodInfo.lighting.map(el => {
                const text = typeof el === 'object' ? el.text : el;
                const bias = typeof el === 'object' ? el.bias : 1.0;
                return `${text} (${bias.toFixed(2)})`;
            }).join(', ') : timePeriodInfo.lighting}</div></div></div>` : ''}
                            ${timePeriodInfo.atmosphere ? `<div class="period-detail"><i class="fa-solid fa-smog"></i><div class="detail-content"><div class="detail-label">Atmosphere</div><div class="detail-value">${Array.isArray(timePeriodInfo.atmosphere) ? timePeriodInfo.atmosphere.map(el => {
                const text = typeof el === 'object' ? el.text : el;
                const bias = typeof el === 'object' ? el.bias : 1.0;
                return `${text} (${bias.toFixed(2)})`;
            }).join(', ') : timePeriodInfo.atmosphere}</div></div></div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        // Build holiday card for compiled prompt modal
        let holidayCardHtmlModal = '';
        if (hasHoliday) {
            const holiday = context.season.holiday;
            const holidayName = holiday.primaryHoliday?.name || 'Holiday';
            const daysUntil = holiday.primaryHoliday?.daysUntil ?? holiday.progressiveElements?.daysUntil;
            const daysUntilText = daysUntil !== undefined && daysUntil !== null ? daysUntil : '?';
            const daysUntilLabel = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'day' : 'days';

            // Calculate holiday progress (0-100%)
            let holidayProgress = 50; // Default
            if (daysUntil !== undefined && daysUntil !== null) {
                const bufferDays = 30;
                if (daysUntil >= 0 && daysUntil <= bufferDays) {
                    holidayProgress = Math.max(0, Math.min(100, ((bufferDays - daysUntil) / bufferDays) * 100));
                } else if (daysUntil < 0) {
                    const daysPast = Math.abs(daysUntil);
                    holidayProgress = Math.max(0, Math.min(100, ((bufferDays - daysPast) / bufferDays) * 100));
                }
            }

            // Get holiday data
            const holidayData = holiday.primaryHoliday || {};
            const atmosphere = holidayData.atmosphere || holiday.atmosphere || '';
            const decorations = holidayData.decorations || holiday.decorations || '';
            const colors = holidayData.colors || holiday.colors || '';
            const activities = holidayData.activities || holiday.activities || '';

            // Get country flag icon and region name based on region
            const getCountryFlagIcon = (region) => {
                const flagMap = {
                    'us': 'fa-flag-usa',
                    'asia': 'fa-flag',
                    'japan': 'fa-flag'
                };
                return flagMap[region?.toLowerCase()] || 'fa-flag';
            };
            const getRegionName = (region) => {
                const regionMap = {
                    'us': 'United States',
                    'asia': 'Asia',
                    'japan': 'Japan'
                };
                return regionMap[region?.toLowerCase()] || region || 'Global';
            };
            // Get holiday CSS class name
            const getHolidayClass = (name) => {
                if (!name) return 'holiday-default';
                const nameLower = name.toLowerCase();
                // Map holiday names to CSS classes
                if (nameLower.includes('christmas') || nameLower.includes('holiday season')) return 'holiday-christmas';
                if (nameLower.includes('new year') && !nameLower.includes('japanese') && !nameLower.includes('chinese')) return 'holiday-new-year';
                if (nameLower.includes('halloween')) return 'holiday-halloween';
                if (nameLower.includes('thanksgiving')) return 'holiday-thanksgiving';
                if (nameLower.includes('independence day') || nameLower.includes('4th of july')) return 'holiday-independence-day';
                if (nameLower.includes('valentine')) return 'holiday-valentines-day';
                if (nameLower.includes('easter') || nameLower.includes('spring holiday')) return 'holiday-easter';
                if (nameLower.includes('chinese new year')) return 'holiday-chinese-new-year';
                if (nameLower.includes('setsubun')) return 'holiday-setsubun';
                if (nameLower.includes('hinamatsuri')) return 'holiday-hinamatsuri';
                if (nameLower.includes('summer festival')) return 'holiday-summer-festival';
                if (nameLower.includes('japanese new year') || nameLower.includes('oshogatsu')) return 'holiday-japanese-new-year';
                if (nameLower.includes('cherry blossom') || nameLower.includes('hanami')) return 'holiday-cherry-blossom';
                if (nameLower.includes('tanabata') || nameLower.includes('star festival')) return 'holiday-tanabata';
                if (nameLower.includes('golden week') || nameLower.includes('shukujitsu')) return 'holiday-golden-week';
                if (nameLower.includes('children') || nameLower.includes('kodomo')) return 'holiday-childrens-day';
                if (nameLower.includes('mid-autumn') || nameLower.includes('tsukimi')) return 'holiday-mid-autumn';
                if (nameLower.includes('obon') || nameLower.includes('bon odori')) return 'holiday-obon';
                return 'holiday-default';
            };
            const region = holidayData.region || holiday.region || 'us';
            const flagIconClass = getCountryFlagIcon(region);
            const regionName = getRegionName(region);
            const holidayClass = getHolidayClass(holidayName);

            holidayCardHtmlModal = `
                <div class="period-info-card holiday-info-card ${holidayClass} ${context.timePeriod?.isDaytime === false ? 'gadget-face-black' : 'gadget-face-blue'}">
                    <div class="period-info-content">
                        <div class="period-main-info">
                            <div class="period-title-section">
                                <div class="period-title clickable" onclick="togglePeriodDetails(this)">
                                    ${holidayName}
                                    <i class="fa-solid fa-chevron-down period-expand-icon"></i>
                                </div>
                                ${time.hour !== undefined ? `
                                <div class="period-title-indicators">
                                        <div class="period-season-badge">
                                            <i class="fa-solid ${flagIconClass}"></i>
                                            <span>${regionName}</span>
                                        </div>
                                    <div class="period-title-indicator">
                                        <div class="period-title-indicator-label">
                                            <span>Holiday</span>
                                            <span class="period-title-indicator-value">${holidayProgress.toFixed(0)}%</span>
                                        </div>
                                        <div class="period-title-progress-bar light-level">
                                            <div class="period-progress-fill light-level" style="width: ${holidayProgress}%"></div>
                                        </div>
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                            <div class="period-time-date">
                                <div class="period-time" style="font-size: 1.5rem; font-weight: 600;">
                                    ${daysUntilText} ${daysUntilLabel}
                                </div>
                            </div>
                        </div>
                        <div class="period-details hidden">
                            ${atmosphere ? `<div class="period-detail"><i class="fa-solid fa-smog"></i><div class="detail-content"><div class="detail-label">Atmosphere</div><div class="detail-value selectable">${atmosphere}</div></div></div>` : ''}
                            ${decorations ? `<div class="period-detail"><i class="fa-solid fa-gifts"></i><div class="detail-content"><div class="detail-label">Decorations</div><div class="detail-value selectable">${decorations}</div></div></div>` : ''}
                            ${colors ? `<div class="period-detail"><i class="fa-solid fa-palette"></i><div class="detail-content"><div class="detail-label">Colors</div><div class="detail-value selectable">${colors}</div></div></div>` : ''}
                            ${activities ? `<div class="period-detail"><i class="fa-solid fa-people-group"></i><div class="detail-content"><div class="detail-label">Activities</div><div class="detail-value selectable">${activities}</div></div></div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        // The scene cards, then the readings (or, without weather, the time and season rows)
        contextContent = periodCardHtml + holidayCardHtmlModal
            + (weatherContent || crossoverPropList(crossoverPropGroup('Time', timeRows)));
    }

    return contextContent;
}

function wireCompiledPromptInspectorListeners() {
    // compileToPromptsApplet.js wires the same button behind the same data-wired flag
    const closeCompiledPromptBtn = document.getElementById('closeCompiledPromptBtn');
    if (closeCompiledPromptBtn && closeCompiledPromptBtn.dataset.wired !== 'true') {
        closeCompiledPromptBtn.dataset.wired = 'true';
        closeCompiledPromptBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const modal = document.getElementById('compiledPromptModal');
            if (modal) {
                closeModal(modal);
            }
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => wireCompiledPromptInspectorListeners());
} else {
    wireCompiledPromptInspectorListeners();
}
