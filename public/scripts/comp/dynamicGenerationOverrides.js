/** Dynamic generation TOD/weather/season overrides (Phase 2 batch 13). */
/**
 * Toggle weather units between metric and imperial
 * Updates all weather measurements in the document when called
 * @param {Event} event - The click event (optional)
 */
window.toggleWeatherUnits = function (event) {
    // Read current preference from localStorage and toggle it
    let currentUseMetric = localStorage.getItem('weather_units_metric') !== 'false';
    const useMetric = !currentUseMetric;

    // Find the weather display container - try to find from clicked element, then modal content, then document
    let weatherContainer = null;
    if (event && event.target) {
        weatherContainer = event.target.closest('.weather-display');
    }
    // Try to find modal content dynamically
    const modalContent = document.getElementById('compiledPromptContent');
    if (!weatherContainer && modalContent) {
        weatherContainer = modalContent.querySelector('.weather-display');
    }
    if (!weatherContainer) {
        weatherContainer = document.querySelector('.weather-display');
    }

    // If still no container found, search entire document
    const searchRoot = weatherContainer || document;

    // Helper function to convert temperature
    const formatTemp = (metric, imperial) => {
        if (metric === null || metric === undefined) return '--';
        if (useMetric) {
            // Preserve decimal precision for metric (Celsius can have decimals)
            // Use the same formatting as original display - preserve decimals if present
            const hasDecimals = Math.abs(metric % 1) > 0.0001; // Account for floating point precision
            if (hasDecimals) {
                // Show up to 1 decimal place, removing trailing zeros
                return parseFloat(metric.toFixed(1)).toString();
            } else {
                return Math.round(metric).toString();
            }
        } else {
            // Imperial (Fahrenheit) typically shown as whole numbers
            return Math.round(imperial).toString();
        }
    };

    // Helper function to convert wind speed
    const formatWind = (metric, imperial) => {
        if (metric === null || metric === undefined) return 'N/A';
        if (useMetric) {
            // Preserve decimal precision for metric (m/s can have decimals)
            const hasDecimals = Math.abs(metric % 1) > 0.0001; // Account for floating point precision
            if (hasDecimals) {
                // Show up to 1 decimal place, removing trailing zeros
                return parseFloat(metric.toFixed(1)).toString();
            } else {
                return Math.round(metric).toString();
            }
        } else {
            // Imperial (mph) typically shown as whole numbers
            return Math.round(imperial).toString();
        }
    };

    // Helper function to convert pressure
    const formatPressure = (metric) => {
        if (metric === null || metric === undefined) return 'N/A';
        if (useMetric) {
            return `${Math.round(metric)} hPa`;
        } else {
            return `${(metric / 33.8639).toFixed(2)} inHg`;
        }
    };

    // Helper function to convert visibility
    const formatVisibility = (metricKm) => {
        if (metricKm === null || metricKm === undefined) return 'N/A';
        if (useMetric) {
            return `${metricKm.toFixed(1)} km`;
        } else {
            return `${(metricKm * 0.621371).toFixed(1)} mi`;
        }
    };

    // Helper function to convert precipitation
    const formatPrecip = (metric, unitType) => {
        if (metric === null || metric === undefined) return '';
        if (unitType === 'cm') {
            // Snowfall: cm to in
            if (useMetric) {
                return `${metric.toFixed(1)} cm`;
            } else {
                return `${(metric * 0.393701).toFixed(2)} in`;
            }
        } else if (unitType === 'mm/hr') {
            // Precipitation rate: mm/hr to in/hr
            if (useMetric) {
                return `${metric.toFixed(1)} mm/hr`;
            } else {
                return `${(metric * 0.0393701).toFixed(2)} in/hr`;
            }
        } else {
            // Rain/showers: mm to in
            if (useMetric) {
                return `${metric.toFixed(1)} mm`;
            } else {
                return `${(metric * 0.0393701).toFixed(2)} in`;
            }
        }
    };

    // Update main card temperature
    const mainTempNumber = searchRoot.querySelector('.weather-temp-number');
    const mainTempUnit = searchRoot.querySelector('.weather-temp-unit');
    const feelsLikeElement = searchRoot.querySelector('.weather-feels-like');

    if (mainTempNumber && mainTempUnit) {
        const metricTemp = parseFloat(mainTempNumber.dataset.metric);
        const imperialTemp = parseFloat(mainTempNumber.dataset.imperial);
        if (!isNaN(metricTemp) && !isNaN(imperialTemp)) {
            mainTempNumber.textContent = formatTemp(metricTemp, imperialTemp);
            mainTempUnit.textContent = useMetric ? '°C' : '°F';
        }
    }

    // Update feels like temperature
    if (feelsLikeElement) {
        const metricFeels = parseFloat(feelsLikeElement.dataset.metric);
        const imperialFeels = parseFloat(feelsLikeElement.dataset.imperial);
        if (!isNaN(metricFeels) && !isNaN(imperialFeels)) {
            feelsLikeElement.textContent = `Feels like ${formatTemp(metricFeels, imperialFeels)}°${useMetric ? 'C' : 'F'}`;
        }
    }

    // Update wind speed in condition details
    const windSpeedElement = searchRoot.querySelector('.weather-wind-speed');
    if (windSpeedElement) {
        const metricWind = parseFloat(windSpeedElement.dataset.metric);
        const imperialWind = parseFloat(windSpeedElement.dataset.imperial);
        if (!isNaN(metricWind) && !isNaN(imperialWind)) {
            windSpeedElement.textContent = useMetric ? `${formatWind(metricWind, imperialWind)} m/s` : `${formatWind(metricWind, imperialWind)} mph`;
        }
    }

    // Update visibility in quick indicators
    const visibilityElements = searchRoot.querySelectorAll('.weather-visibility');
    visibilityElements.forEach(visibilityElement => {
        const metricVis = parseFloat(visibilityElement.dataset.metric);
        if (!isNaN(metricVis)) {
            visibilityElement.textContent = formatVisibility(metricVis);
        }
    });

    // Update precipitation elements
    const precipRateElement = searchRoot.querySelector('.weather-precip-rate');
    if (precipRateElement) {
        const metricPrecip = parseFloat(precipRateElement.dataset.metric);
        const unitType = precipRateElement.dataset.unit;
        if (!isNaN(metricPrecip)) {
            precipRateElement.textContent = formatPrecip(metricPrecip, unitType);
        }
    }

    const rainAmountElement = searchRoot.querySelector('.weather-rain-amount');
    if (rainAmountElement) {
        const metricRain = parseFloat(rainAmountElement.dataset.metric);
        const unitType = rainAmountElement.dataset.unit;
        if (!isNaN(metricRain)) {
            rainAmountElement.textContent = formatPrecip(metricRain, unitType);
        }
    }

    const showersAmountElement = searchRoot.querySelector('.weather-showers-amount');
    if (showersAmountElement) {
        const metricShowers = parseFloat(showersAmountElement.dataset.metric);
        const unitType = showersAmountElement.dataset.unit;
        if (!isNaN(metricShowers)) {
            showersAmountElement.textContent = formatPrecip(metricShowers, unitType);
        }
    }

    const snowAmountElement = searchRoot.querySelector('.weather-snow-amount');
    if (snowAmountElement) {
        const metricSnow = parseFloat(snowAmountElement.dataset.metric);
        const unitType = snowAmountElement.dataset.unit;
        if (!isNaN(metricSnow)) {
            snowAmountElement.textContent = formatPrecip(metricSnow, unitType);
        }
    }

    // Update weather detail cards
    const detailValueElements = searchRoot.querySelectorAll('.weather-detail-value[data-metric][data-imperial]');
    detailValueElements.forEach(el => {
        const metricValue = parseFloat(el.dataset.metric);
        const imperialValue = parseFloat(el.dataset.imperial);
        const unitType = el.dataset.unitType;

        if (!isNaN(metricValue) && !isNaN(imperialValue)) {
            if (unitType === 'temperature') {
                el.textContent = `${formatTemp(metricValue, imperialValue)}°${useMetric ? 'C' : 'F'}`;
            } else if (unitType === 'wind') {
                el.textContent = useMetric ? `${formatWind(metricValue, imperialValue)} m/s` : `${formatWind(metricValue, imperialValue)} mph`;
            } else if (unitType === 'pressure') {
                el.textContent = formatPressure(metricValue);
            }
        }
    });

    // Update hourly forecast temperatures
    const hourTempElements = searchRoot.querySelectorAll('.weather-hour-temp[data-metric][data-imperial]');
    hourTempElements.forEach(el => {
        const metricTemp = parseFloat(el.dataset.metric);
        const imperialTemp = parseFloat(el.dataset.imperial);
        if (!isNaN(metricTemp) && !isNaN(imperialTemp)) {
            el.textContent = `${formatTemp(metricTemp, imperialTemp)}°${useMetric ? 'C' : 'F'}`;
        }
    });

    // Update hourly precipitation displays
    const hourPrecipElements = searchRoot.querySelectorAll('.weather-hour-precip[data-metric]');
    hourPrecipElements.forEach(el => {
        const metricPrecip = parseFloat(el.dataset.metric);
        const unitType = el.dataset.unit || 'mm';
        if (!isNaN(metricPrecip)) {
            if (useMetric) {
                el.textContent = `${metricPrecip.toFixed(1)}${unitType}`;
            } else {
                const inches = metricPrecip * 0.0394;
                el.textContent = `${inches.toFixed(1)}in`;
            }
        }
    });

    // Update old info-item format (for backward compatibility)
    const modalContentForInfoItems = document.getElementById('compiledPromptContent');
    if (modalContentForInfoItems) {
        const oldInfoItems = modalContentForInfoItems.querySelectorAll('.info-item span:last-child');
        oldInfoItems.forEach(el => {
            const metricValue = parseFloat(el.dataset.metric);
            const imperialValue = parseFloat(el.dataset.imperial);
            const unitType = el.dataset.unitType;

            if (!isNaN(metricValue) && !isNaN(imperialValue)) {
                if (unitType === 'temperature') {
                    el.textContent = `${formatTemp(metricValue, imperialValue)}°${useMetric ? 'C' : 'F'}`;
                } else if (unitType === 'wind') {
                    el.textContent = useMetric ? `${formatWind(metricValue, imperialValue)} m/s` : `${formatWind(metricValue, imperialValue)} mph`;
                } else if (unitType === 'pressure') {
                    el.textContent = formatPressure(metricValue);
                } else if (unitType === 'visibility') {
                    el.textContent = formatVisibility(metricValue);
                }
            }
        });
    }

    // Save preference to localStorage
    localStorage.setItem('weather_units_metric', useMetric.toString());

  updateRentanContextOverlay(resolvePreviewRentanContext());
};

function updateDynamicGenerationToggleBtn() {
    const isOpen = !dynamicGenerationGroup.classList.contains('hidden');
    dynamicGenerationToggleBtn.setAttribute('data-state', isOpen ? 'open' : 'off');
}

// Holiday mapping from client values to server holiday names
const CLIENT_HOLIDAY_MAP = {
    'christmas': 'Christmas',
    'newyears': 'New Year\'s',
    'halloween': 'Halloween',
    'thanksgiving': 'Thanksgiving',
    'independenceday': 'Independence Day',
    'valentinesday': 'Valentine\'s Day',
    'easter': 'Easter',
    'chinesenewyear': 'Chinese New Year',
    'setsubun': 'Setsubun',
    'hinamatsuri': 'Hinamatsuri',
    'summerfestival': 'Summer Festival',
    'japanesenewyear': 'Japanese New Year',
    'cherryblossom': 'Cherry Blossom',
    'tanabatafestival': 'Star Festival',
    'goldenweek': 'Golden Week',
    'childrensday': 'Children\'s Day',
    'tsukimi': 'Mid-Autumn Festival',
    'obonfestival': 'Obon Festival',
    'nearest': 'nearest' // Special case for nearest holiday
};

// Function to get holiday date (simplified client-side version)
function getHolidayDateClient(holidayValue) {
    const now = new Date();
    const year = now.getFullYear();

    // Handle nearest holiday
    if (holidayValue === 'nearest') {
        // For simplicity, return current date for nearest - server will handle the actual logic
        return now;
    }

    const normalizedValue = (holidayValue || '').startsWith('true_')
        ? holidayValue.substring(5)
        : holidayValue;

    const holidayName = CLIENT_HOLIDAY_MAP[normalizedValue];
    if (!holidayName) return null;

    // Simplified holiday date calculation (basic implementation)
    const holidayDates = {
        'Christmas': new Date(year, 11, 25), // Dec 25
        'New Year\'s': new Date(year, 0, 1), // Jan 1
        'Halloween': new Date(year, 9, 31), // Oct 31
        'Thanksgiving': (() => {
            // Last Thursday in November (approximation)
            const thanksgiving = new Date(year, 10, 26);
            return thanksgiving;
        })(),
        'Independence Day': new Date(year, 6, 4), // Jul 4
        'Valentine\'s Day': new Date(year, 1, 14), // Feb 14
        'Easter': (() => {
            // Simplified - actual calculation varies
            return new Date(year, 3, 4); // Early April approximation
        })(),
        'Chinese New Year': new Date(year, 1, 5), // Early February approximation
        'Setsubun': new Date(year, 1, 3), // Feb 3
        'Hinamatsuri': new Date(year, 2, 3), // Mar 3
        'Summer Festival': new Date(year, 6, 20), // Late July approximation
        'Japanese New Year': new Date(year, 0, 1),
        'Cherry Blossom Season (Hanami)': new Date(year, 3, 1), // April
        'Star Festival': new Date(year, 6, 7), // Jul 7
        'Golden Week': new Date(year, 4, 29), // May 29
        'Children\'s Day': new Date(year, 4, 5), // May 5
        'Mid-Autumn Festival': new Date(year, 8, 15), // Mid-September
        'Obon Festival': new Date(year, 7, 15) // Mid-August
    };

    return holidayDates[holidayName] || null;
}

// Open time/date selection modal
function openTimeDateModal() {
    const modal = document.getElementById('timeDateModal');
    if (!modal) {
        return;
    }

    const todBtn = document.getElementById('todBtn');
    const currentOverride = todBtn ? todBtn.getAttribute('data-override') : null;

    const hourInput = document.getElementById('timeDateHour');
    const minuteInput = document.getElementById('timeDateMinute');
    const dayInput = document.getElementById('timeDateDay');
    const monthInput = document.getElementById('timeDateMonth');

    // Default to current date/time
    let targetDate = new Date();

    if (currentOverride) {
        if (currentOverride.includes('_')) {
            // TIME_DATE format
            const parts = currentOverride.split('_');
            let timePart = parts[0];
            const datePart = parts[1];

            // Strip % prefix if present
            if (timePart.startsWith('%')) {
                timePart = timePart.substring(1);
            }

            // Handle time part
            if (timePart && timePart.length === 4 && /^\d{4}$/.test(timePart)) {
                // HHmm format
                const hour = parseInt(timePart.substring(0, 2));
                const minute = parseInt(timePart.substring(2, 4));
                targetDate.setHours(hour, minute);
            }
            // Named time values (dawn, sunrise, etc.) leave time as current

            // Handle date part
            if (datePart) {
                if (datePart === 'tomorrow') {
                    targetDate.setDate(targetDate.getDate() + 1);
                } else if (datePart.length === 4 && /^\d{4}$/.test(datePart)) {
                    // MMDD numeric format
                    const month = parseInt(datePart.substring(0, 2));
                    const day = parseInt(datePart.substring(2, 4));
                    targetDate.setMonth(month - 1); // JavaScript months are 0-based
                    targetDate.setDate(day);
                } else if (CLIENT_HOLIDAY_MAP[datePart]) {
                    // Holiday date
                    const holidayDate = getHolidayDateClient('true_' + datePart);
                    if (holidayDate) {
                        targetDate = holidayDate;
                        // Preserve time from timePart if it was set (already stripped of % prefix above)
                        if (timePart && timePart.length === 4 && /^\d{4}$/.test(timePart)) {
                            const hour = parseInt(timePart.substring(0, 2));
                            const minute = parseInt(timePart.substring(2, 4));
                            targetDate.setHours(hour, minute);
                        }
                    }
                }
                // Other date values (today, nextweek, etc.) leave date as current
            }
        }
        // Single values without underscore are handled by current date/time
    }

    // Populate inputs with target date
    if (hourInput) hourInput.value = targetDate.getHours();
    if (minuteInput) minuteInput.value = targetDate.getMinutes();
    if (dayInput) dayInput.value = targetDate.getDate();
    if (monthInput) monthInput.value = targetDate.getMonth() + 1; // JavaScript months are 0-based

    openModal(modal);
}

// Handle time/date modal save
/**
 * Saves the time/date settings from the modal and applies them to the UI
 *
 * Validates all input fields (hour, minute, day, month), creates a Date object,
 * formats the values into the required override string format, and applies
 * the override to the time-of-day button. Shows success feedback to the user.
 *
 * @throws {Error} Implicitly throws validation errors via toast notifications
 */
function saveTimeDateModal() {
    const hour = parseInt(document.getElementById('timeDateHour').value);
    const minute = parseInt(document.getElementById('timeDateMinute').value);
    const day = parseInt(document.getElementById('timeDateDay').value);
    const month = parseInt(document.getElementById('timeDateMonth').value);

    // Validate inputs
    if (isNaN(hour) || hour < 0 || hour > 23) {
        showGlassToast('error', null, 'Invalid hour. Must be between 0-23.', false, undefined, '<i class="fas fa-clock"></i>');
        return;
    }
    if (isNaN(minute) || minute < 0 || minute > 59) {
        showGlassToast('error', null, 'Invalid minute. Must be between 0-59.', false, undefined, '<i class="fas fa-clock"></i>');
        return;
    }
    if (isNaN(day) || day < 1 || day > 31) {
        showGlassToast('error', null, 'Invalid day. Must be between 1-31.', false, undefined, '<i class="fas fa-clock"></i>');
        return;
    }
    if (isNaN(month) || month < 1 || month > 12) {
        showGlassToast('error', null, 'Invalid month. Must be between 1-12.', false, undefined, '<i class="fas fa-clock"></i>');
        return;
    }

    // Create a date object with the selected values (using current year)
    const now = new Date();
    const selectedDate = new Date(now.getFullYear(), month - 1, day, hour, minute);

    // Create a custom override value in the format %HHmm_MMDD
    const formattedHour = hour.toString().padStart(2, '0');
    const formattedMinute = minute.toString().padStart(2, '0');
    const formattedDay = day.toString().padStart(2, '0');
    const formattedMonth = month.toString().padStart(2, '0');
    const timeDateValue = `%${formattedHour}${formattedMinute}_${formattedMonth}${formattedDay}`;

    // Set the dynamic override on the time of day button
    setDynamicOverride(document.getElementById('todBtn'), timeDateValue);

    // Close the modal
    const modal = document.getElementById('timeDateModal');
    closeModal(modal);

    showGlassToast('success', null, `Time/Date set to ${selectedDate.toLocaleString()}`, undefined, undefined, '<i class="fas fa-clock"></i>');
}

// WEATHER LOCATION MODAL FUNCTIONS

// Open the weather location modal
function openWeatherLocationModal() {
    const modal = document.getElementById('weatherLocationModal');
    if (!modal) {
        return;
    }

    // Reset form state
    const input = document.getElementById('weatherLocationInput');
    const matchDisplay = document.getElementById('weatherLocationMatch');
    const saveBtn = document.getElementById('saveWeatherLocationBtn');

    input.value = '';
    matchDisplay.textContent = 'Enter a city name and click Verify to see the matched location.';
    matchDisplay.className = 'weather-location-match';
    saveBtn.disabled = true;
    saveBtn.dataset.location = '';

    // Show the modal
    openModal(modal);
}

// Verify weather location via WebSocket
async function verifyWeatherLocation() {
    const input = document.getElementById('weatherLocationInput');
    const matchDisplay = document.getElementById('weatherLocationMatch');
    const saveBtn = document.getElementById('saveWeatherLocationBtn');

    const cityName = input.value.trim();
    if (!cityName) {
        matchDisplay.textContent = 'Please enter a city name.';
        matchDisplay.className = 'weather-location-match error';
        saveBtn.disabled = true;
        return;
    }

    try {
        matchDisplay.textContent = 'Searching...';
        matchDisplay.className = 'weather-location-match loading';

        // Send WebSocket request for city lookup
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const response = await window.wsClient.lookupCity(cityName);

        if (response && response.longitude !== undefined && response.latitude !== undefined) {
            const result = response;

            // Display matched location with current time
            const locationText = `${result.city || cityName}, ${result.state || ''} ${result.country || ''}`.trim();
            let displayText = `Found: ${locationText}`;

            // Add current time if timezone is available
            if (result.timezone) {
                try {
                    const now = new Date();
                    const timeString = now.toLocaleTimeString('en-US', {
                        timeZone: result.timezone,
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });
                    displayText += ` (Current time: ${timeString})`;
                } catch (error) {
                    console.warn('Failed to format time for timezone:', result.timezone, error);
                }
            }

            matchDisplay.textContent = displayText;
            matchDisplay.className = 'weather-location-match success';

            // Enable save button and store coordinates
            saveBtn.disabled = false;
            saveBtn.dataset.location = `${result.longitude}_${result.latitude}`;
            saveBtn.dataset.displayName = locationText;
        } else {
            matchDisplay.textContent = 'City not found. Please try a different name.';
            matchDisplay.className = 'weather-location-match error';
            saveBtn.disabled = true;
        }
    } catch (error) {
        console.error('City lookup error:', error);
        matchDisplay.textContent = error.message || 'Error searching for city. Please try again.';
        matchDisplay.className = 'weather-location-match error';
        saveBtn.disabled = true;
    }
}

// Save weather location
function saveWeatherLocation() {
    const saveBtn = document.getElementById('saveWeatherLocationBtn');
    const locationData = saveBtn.dataset.location;
    const displayName = saveBtn.dataset.displayName;

    if (!locationData) {
        showGlassToast('error', null, 'No location to save.', false, undefined, '<i class="fas fa-location-dot-slash"></i>');
        return;
    }

    // Set the location on the weather button
    const weatherBtn = document.getElementById('weatherBtn');
    if (weatherBtn) {
        weatherBtn.setAttribute('data-location', locationData);
        weatherBtn.dataset.locationDisplay = displayName;

        // Also set it as active if not already
        weatherBtn.dataset.state = 'on';
        weatherBtn.classList.add('active');

        showGlassToast('success', null, `Location set to ${displayName}`, undefined, undefined, '<i class="fas fa-map-marker-alt"></i>');

        // Update status icons to reflect the location change
        updatePromptStatusIcons();

        createDebouncedContextResolution();
    }

    // Close the modal
    const modal = document.getElementById('weatherLocationModal');
    closeModal(modal);
}

// Clear weather location
function clearWeatherLocation() {
    const weatherBtn = document.getElementById('weatherBtn');
    if (weatherBtn) {
        const hadLocation = weatherBtn.hasAttribute('data-location');
        weatherBtn.removeAttribute('data-location');
        delete weatherBtn.dataset.locationDisplay;

        if (hadLocation) {
            updatePromptStatusIcons();
            updateDynamicGenerationToggleBtn();
            createDebouncedContextResolution();
        }
    }
}

// Set current location using browser geolocation, fallback to server-side IP lookup
function setCurrentLocation() {
    if (!navigator.geolocation) {
        showGlassToast('error', null, 'Geolocation is not supported by this browser', false, undefined, '<i class="fas fa-location-dot-slash"></i>');
    }

    showGlassToast('info', null, 'Getting current location...', false, undefined, '<i class="fas fa-location-dot"></i>');

    // Try GPS/network location first, then fallback to server IP lookup
    function tryGPSLocation(options) {
        let timeoutId;

        const successCallback = function (position) {
            clearTimeout(timeoutId);
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            // Set the location on the weather button
            const weatherBtn = document.getElementById('weatherBtn');
            if (weatherBtn) {
                const locationData = `${longitude}_${latitude}`;
                const displayName = `Current Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;

                weatherBtn.setAttribute('data-location', locationData);
                weatherBtn.dataset.locationDisplay = displayName;

                // Also set it as active if not already
                weatherBtn.dataset.state = 'on';
                weatherBtn.classList.add('active');

                showGlassToast('success', null, `Location set to current location`, undefined, undefined, '<i class="fas fa-map-marker-alt"></i>');

                // Update status icons to reflect the location change
                updatePromptStatusIcons();

                createDebouncedContextResolution();
            }
        };

        const errorCallback = function (error) {
            clearTimeout(timeoutId);

            switch (error.code) {
                case error.PERMISSION_DENIED:
                    showGlassToast('error', null, 'Location access denied. Please allow location access in your browser settings.', false, undefined, '<i class="fas fa-location-dot-slash"></i>');
                    break;
                case error.POSITION_UNAVAILABLE:
                case error.TIMEOUT:
                    // Browser geolocation failed, use server-side IP lookup
                    setIPLocation();
                    break;
            }
        };

        // Set a timeout to handle silent failures (some browsers don't call error callback)
        timeoutId = setTimeout(() => {
            setIPLocation();
        }, options.timeout + 1000);

        navigator.geolocation.getCurrentPosition(successCallback, errorCallback, options);
    }

    // Start with high accuracy GPS/network location
    tryGPSLocation({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000 // 5 minutes
    });
}

// Set location using server-side IP geolocation (skip GPS)
function setIPLocation() {
    const weatherBtn = document.getElementById('weatherBtn');
    if (weatherBtn) {
        weatherBtn.setAttribute('data-location', 'CLIENT');
        weatherBtn.dataset.locationDisplay = 'Current Location (GeoIP)';

        // Also set it as active if not already
        weatherBtn.dataset.state = 'on';
        weatherBtn.classList.add('active');

        showGlassToast('success', null, 'Location set to IP-based geolocation', undefined, undefined, '<i class="fas fa-map-marker-alt"></i>');

        // Update status icons to reflect the location change
        updatePromptStatusIcons();

        createDebouncedContextResolution();
    }
}

/**
 * Get season Font Awesome icon
 */
function getSeasonIcon(season) {
    if (!season) return '';
    // Handle both object and string formats
    const seasonName = typeof season === 'object' && season?.name ? season.name : season;
    const seasonStr = typeof seasonName === 'string' ? seasonName : String(seasonName || '');
    const icons = {
        'spring': '<i class="fa-solid fa-seedling"></i>',
        'summer': '<i class="fa-solid fa-sun"></i>',
        'autumn': '<i class="fa-solid fa-leaf"></i>',
        'fall': '<i class="fa-solid fa-leaf"></i>',
        'winter': '<i class="fa-solid fa-snowflake"></i>'
    };
    return icons[seasonStr.toLowerCase()] || '';
}

/**
 * Toggle period details visibility
 */
function togglePeriodDetails(titleElement) {
    const periodDetails = titleElement.closest('.period-info-content').querySelector('.period-details');
    const icon = titleElement.querySelector('.period-expand-icon');

    if (periodDetails) {
        periodDetails.classList.toggle('hidden');
        if (icon) {
            icon.classList.toggle('expanded');
        }
    }
}

/**
 * Calculate season progress (0-100%)
 */
function calculateSeasonProgress(time, season) {
    if (!time || !season || time.month === undefined || time.dayOfMonth === undefined) {
        return 50; // Default to middle if data is missing
    }

    // Handle both object and string formats
    const seasonName = typeof season === 'object' && season?.name ? season.name : season;
    const seasonStr = typeof seasonName === 'string' ? seasonName : String(seasonName || '');

    const seasonBounds = {
        spring: { start: { month: 2, day: 20 }, end: { month: 5, day: 20 } },  // Mar 20 - Jun 20
        summer: { start: { month: 5, day: 21 }, end: { month: 8, day: 22 } },  // Jun 21 - Sep 22
        autumn: { start: { month: 8, day: 23 }, end: { month: 11, day: 20 } }, // Sep 23 - Dec 20
        fall: { start: { month: 8, day: 23 }, end: { month: 11, day: 20 } },   // Same as autumn
        winter: { start: { month: 11, day: 21 }, end: { month: 2, day: 19 } }  // Dec 21 - Mar 19
    };

    const bounds = seasonBounds[seasonStr.toLowerCase()];
    if (!bounds) return 50;

    const currentMonth = time.month;
    const currentDay = time.dayOfMonth;

    // Helper: Get day of year
    const getDayOfYear = (month, day) => {
        const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let dayOfYear = 0;
        for (let i = 0; i < month; i++) {
            dayOfYear += daysInMonth[i];
        }
        dayOfYear += day;
        return dayOfYear;
    };

    const currentDayOfYear = getDayOfYear(currentMonth, currentDay);
    let startDayOfYear = getDayOfYear(bounds.start.month, bounds.start.day);
    let endDayOfYear = getDayOfYear(bounds.end.month, bounds.end.day);

    // Handle winter wrapping around year boundary
    if (seasonStr.toLowerCase() === 'winter') {
        if (currentMonth < 3) {
            // We're in Jan-Feb, part of winter
            const adjustedEnd = getDayOfYear(2, 19); // Feb 19
            const seasonLength = adjustedEnd + (365 - getDayOfYear(11, 21)); // Days from Dec 21 to end + Jan-Feb
            const daysSinceStart = 365 - getDayOfYear(11, 21) + currentDayOfYear;
            return Math.max(0, Math.min(100, Math.round((daysSinceStart / seasonLength) * 100)));
        } else if (currentMonth >= 11) {
            // We're in Dec
            const seasonLength = (365 - startDayOfYear) + getDayOfYear(2, 19);
            const daysSinceStart = currentDayOfYear - startDayOfYear;
            return Math.max(0, Math.min(100, Math.round((daysSinceStart / seasonLength) * 100)));
        }
    }

    // For other seasons
    const seasonLength = endDayOfYear - startDayOfYear;
    const daysSinceStart = currentDayOfYear - startDayOfYear;
    const progress = (daysSinceStart / seasonLength) * 100;

    return Math.max(0, Math.min(100, Math.round(progress)));
}

function collectDynamicButtonState(btn) {
    if (!btn) {
        return false;
    }

    const state = btn.dataset.state;
    const override = btn.getAttribute('data-override');
    const seasonMode = btn.getAttribute('data-season-mode');

    if (state === 'on') {
        // Special handling for season button
        if (btn.id === 'seasonBtn') {
            // If there's a numeric override (season index 1-4), return it as number
            const numValue = parseInt(override);
            if (!isNaN(numValue)) {
                return numValue;
            }

            // No override means auto-detect current season
            return true;
        }

        // For other buttons, if there's a specific override selected, return the index number
        if (override) {
            let v = parseInt(override);
            if (!isNaN(v)) {
                return v;
            }
            return override;
        }
        // If button is just turned on without specific selection, return true
        return true;
    }
    return false;
}

// Effective dynamic-generation settings — must match dynamicGenerationHandlers.js defaults
function getEffectiveDynamicDialogsCount() {
    const dialogsValue = dynamicCarousel?.dataset.creativeDirectiveDialogs;
    if (dialogsValue === undefined || dialogsValue === '') {
        return 0;
    }
    const parsed = parseInt(dialogsValue, 10);
    return isNaN(parsed) ? 0 : parsed;
}

function getEffectiveDynamicToolPasses() {
    if (dynamicCarousel?.dataset.fastMode === 'true') {
        return 4;
    }
    const toolPassesValue = dynamicCarousel?.dataset.creativeDirectiveToolPasses;
    if (toolPassesValue) {
        const parsed = parseInt(toolPassesValue, 10);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    return 8;
}

function getEffectiveDynamicAiTemperature() {
    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
    if (aiTemp !== undefined && aiTemp !== '') {
        return parseFloat(aiTemp);
    }
    const creativeBtn = document.getElementById('creativeBtn');
    return creativeBtn?.dataset.state === 'on' ? 0.95 : 0.1;
}

function hasExplicitDynamicAiTemperature() {
    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
    return aiTemp !== undefined && aiTemp !== '';
}

function formatDynamicAiTemperature(temp) {
    const numeric = typeof temp === 'number' ? temp : parseFloat(temp);
    if (isNaN(numeric)) {
        return '';
    }
    return numeric.toFixed(1);
}

// Get current TOD value display for context menu
function getCurrentTodDisplay() {
    const todBtn = document.getElementById('todBtn');
    const currentOverride = todBtn ? todBtn.getAttribute('data-override') : null;

    if (!currentOverride || todBtn.dataset.state === 'off') {
        return 'No override set';
    }

    if (currentOverride.includes('_')) {
        // TIME_DATE format
        const parts = currentOverride.split('_');
        const timePart = parts[0];
        const datePart = parts[1];

        let timeDisplay = '';
        let dateDisplay = '';

        // Handle time part
        if (timePart) {
            if (timePart.length === 4 && /^\d{4}$/.test(timePart)) {
                // HHmm format - convert to 12-hour with AM/PM
                const hour24 = parseInt(timePart.substring(0, 2));
                const minute = timePart.substring(2, 4);
                timeDisplay = `${hour24}:${minute}`;
            } else {
                // Named time value
                const timeNames = {
                    'dawn': 'Dawn', 'sunrise': 'Sunrise',
                    'morning': 'Morning', 'latemorning': 'Late Morning', 'daytime': 'Daytime',
                    'afternoon': 'Afternoon', 'lateafternoon': 'Late Afternoon', 'goldenhour': 'Golden Hour',
                    'evening': 'Evening',
                    'sunset': 'Sunset', 'dusk': 'Dusk',
                    'night': 'Night', 'midnight': 'Midnight'
                };
                timeDisplay = timeNames[timePart] || timePart;
            }
        }

        // Handle date part
        if (datePart) {
            if (CLIENT_HOLIDAY_MAP[datePart]) {
                // Holiday
                dateDisplay = CLIENT_HOLIDAY_MAP[datePart];
            } else if (datePart.length === 4 && /^\d{4}$/.test(datePart)) {
                // Numeric MMDD format
                const month = parseInt(datePart.substring(0, 2)) - 1; // 0-based
                const day = parseInt(datePart.substring(2, 4));
                const currentYear = new Date().getFullYear();
                const numericDate = new Date(currentYear, month, day);
                dateDisplay = numericDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                });
            } else {
                // Calculate actual dates for relative date values
                let targetDate = new Date();

                switch (datePart) {
                    case 'today':
                        dateDisplay = 'Today';
                        break;
                    case 'tomorrow':
                        dateDisplay = 'Tomorrow';
                        break;
                    default:
                        // Fallback for unknown date values
                        dateDisplay = datePart.replace(/([A-Z])/g, ' $1').trim();
                        break;
                }
            }
        }

        // Combine displays
        if (timeDisplay && dateDisplay) {
            return `${timeDisplay} on ${dateDisplay}`;
        } else if (timeDisplay) {
            return timeDisplay;
        } else if (dateDisplay) {
            return dateDisplay;
        }

        return 'Custom time/date';
    } else {
        // Single value without underscore
        const timeNames = {
            'dawn': 'Dawn', 'sunrise': 'Sunrise',
            'morning': 'Morning', 'latemorning': 'Late Morning', 'daytime': 'Daytime',
            'afternoon': 'Afternoon', 'lateafternoon': 'Late Afternoon', 'goldenhour': 'Golden Hour',
            'sunset': 'Sunset', 'dusk': 'Dusk',
            'night': 'Night', 'midnight': 'Midnight'
        };

        if (timeNames[currentOverride]) {
            return timeNames[currentOverride];
        }

        if (CLIENT_HOLIDAY_MAP[currentOverride]) {
            return CLIENT_HOLIDAY_MAP[currentOverride];
        }

        // Handle numeric MMDD date format
        if (currentOverride.length === 4 && /^\d{4}$/.test(currentOverride)) {
            const month = parseInt(currentOverride.substring(0, 2)) - 1; // 0-based
            const day = parseInt(currentOverride.substring(2, 4));
            const currentYear = new Date().getFullYear();
            const numericDate = new Date(currentYear, month, day);
            return numericDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
        }

        // Handle date-only values
        let targetDate = new Date();
        switch (currentOverride) {
            case 'today':
                return 'Today';
            case 'tomorrow':
                return 'Tomorrow';
        }

        return currentOverride;
    }

    return 'Unknown';
}

// Helper functions to check if date/time overrides exist
function hasDateOverride() {
    const todBtn = document.getElementById('todBtn');
    if (!todBtn) return false;
    const currentOverride = todBtn.getAttribute('data-override');
    if (!currentOverride || todBtn.dataset.state === 'off') return false;

    if (currentOverride.includes('_')) {
        const parts = currentOverride.split('_');
        const datePart = parts[1];
        return !!datePart;
    }

    // Check if it's a date-only value (not a time-only value)
    const timeNames = ['dawn', 'sunrise', 'morning', 'latemorning', 'daytime', 'afternoon', 'lateafternoon', 'goldenhour', 'evening', 'sunset', 'dusk', 'night', 'midnight'];
    const isTimeOnly = timeNames.includes(currentOverride);
    if (isTimeOnly) return false;

    // Check if it's a holiday, date value, or numeric date
    if (typeof CLIENT_HOLIDAY_MAP !== 'undefined' && CLIENT_HOLIDAY_MAP[currentOverride]) return true;
    if (currentOverride === 'today' || currentOverride === 'tomorrow') return true;
    if (currentOverride.length === 4 && /^\d{4}$/.test(currentOverride)) return true;

    return false;
}

function hasTimeOverride() {
    const todBtn = document.getElementById('todBtn');
    if (!todBtn) return false;
    const currentOverride = todBtn.getAttribute('data-override');
    if (!currentOverride || todBtn.dataset.state === 'off') return false;

    if (currentOverride.includes('_')) {
        const parts = currentOverride.split('_');
        const timePart = parts[0];
        return !!timePart;
    }

    // Check if it's a time-only value
    const timeNames = ['dawn', 'sunrise', 'morning', 'latemorning', 'daytime', 'afternoon', 'lateafternoon', 'goldenhour', 'evening', 'sunset', 'dusk', 'night', 'midnight'];
    if (timeNames.includes(currentOverride)) return true;

    // Check if it's HHmm format
    if (currentOverride.length === 4 && /^\d{4}$/.test(currentOverride)) {
        // Could be time or date, but if no underscore, assume it could be time
        // We'll be conservative and check if hour is valid
        const hour = parseInt(currentOverride.substring(0, 2));
        if (hour >= 0 && hour <= 23) return true;
    }

    return false;
}

// Handle TOD override (preserves existing date/time or sets preset values)
function setTodOverride(value) {
    const todBtn = document.getElementById('todBtn');
    setDynamicOverride(todBtn, value);
}

// Handle time-only override (preserves existing date)
function setTodTimeOverride(timeValue) {
    const todBtn = document.getElementById('todBtn');
    const currentOverride = todBtn ? todBtn.getAttribute('data-override') : null;

    let newValue;

    if (currentOverride && currentOverride.includes('_')) {
        // Replace the time part (before "_") with new time
        const parts = currentOverride.split('_');
        newValue = `${timeValue}_${parts[1]}`;
    } else {
        // No existing date, use current date
        newValue = timeValue;
    }

    setDynamicOverride(todBtn, newValue);
}

// Handle date-only override (preserves existing time)
function setTodDateOverride(dateValue) {
    const todBtn = document.getElementById('todBtn');
    const currentOverride = todBtn ? todBtn.getAttribute('data-override') : null;

    let newValue;

    if (currentOverride && currentOverride.includes('_')) {
        // Replace the 2nd part (after "_")
        const parts = currentOverride.split('_');
        newValue = `${parts[0]}_${dateValue}`;
    } else {
        // No current override or no underscore, just use the date value directly
        newValue = 'auto_' + dateValue;
    }

    setDynamicOverride(todBtn, newValue);
}

// Update TOD button icon based on current override state
function updateTodButtonIcon() {
    const todBtn = document.getElementById('todBtn');
    if (!todBtn) return;

    const state = todBtn.dataset.state;
    const override = todBtn.dataset.override;
    const iconElement = todBtn.querySelector('i');

    if (!iconElement) return;

    if (override) {
        // Determine icon based on override type when on
        if (override.includes('_')) {
            if (override.startsWith('auto_')) {
                // Custom date with auto time (e.g., "auto_tomorrow", "auto_christmas")
                iconElement.className = 'fa-solid fa-calendar-day';
            } else {
                // Both custom date and time from modal (e.g., "%1430_1004")
                iconElement.className = 'fa-solid fa-calendar-clock';
            }
        } else {
            // Preset values (dawn, morning, afternoon, etc.) or holiday names
            iconElement.className = 'fa-solid fa-clock';
        }
    } else if (state === 'on') {
        // Reset to original icon
        iconElement.className = 'fa-solid fa-clock';
    } else {
        // Reset to original icon
        iconElement.className = 'fa-regular fa-clock';
    }
}

function setDynamicOverride(btn, value) {
    btn.setAttribute('data-override', value);
    btn.dataset.state = 'on';

    // Update TOD button icon if this is the TOD button
    if (btn.id === 'todBtn') {
        updateTodButtonIcon();
    }

    updateDynamicGenerationToggleBtn();
    updatePromptStatusIcons();
}

function setSeasonOverride(btn, value) {
    if (value === false || value === null) {
        // Disable seasonal
        btn.removeAttribute('data-override');
    } else {
        // Season index (1-4)
        btn.setAttribute('data-override', value);
        btn.dataset.state = 'on';
    }

    updateDynamicGenerationToggleBtn();
    updatePromptStatusIcons();
    createDebouncedContextResolution();
}

