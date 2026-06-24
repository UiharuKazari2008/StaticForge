/**
 * Rentan dynamic context carousel: format items, update DOM, resolve context via WS.
 * getAnalogClockIcon / formatTimezoneInfo: app.js. dynamicCarousel ref: manualModalManager.js
 * initDynamicCarousel: dynamicGenerationManager.js
 */

// Rentan Carousel
let carouselData = [];
let carouselCurrentIndex = 0;
let carouselInterval = null;
let carouselPaused = false;
let carouselMode = 'current'; // 'current' or 'compiled'
let currentContextData = null;
let compiledContextData = null;

function formatCarouselItems(data) {
    const items = [];

    // Time with timezone and analog clock icon (always show if time exists)
    if (data.time) {
        // Compute analog clock icon on client
        const hour = data.time.hour;
        const minute = data.time.minute;

        // Format time if not already formatted (handle both formatted and raw time objects)
        let formattedTime = data.time.formatted;
        if (!formattedTime && hour !== undefined && minute !== undefined) {
            formattedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        }

        if (formattedTime) {
            const analogIcon = getAnalogClockIcon(hour, minute);

            // Compute timezone info on client
            const timezone = data.time.timezone;
            const timezoneInfo = timezone ? formatTimezoneInfo(timezone) : null;

            let timeText = timezoneInfo && timezoneInfo.offset !== 0
                ? `${formattedTime} <span class="timezone-dimmed">${timezoneInfo.formatted}</span>`
                : formattedTime;

            // Add holiday and date next to time - only for compiled context or if explicitly set
            // Check if we're in compiled mode or if date was explicitly set in request
            const isCompiledContext = carouselMode === 'compiled';
            const hasExplicitDate = data.date?.formatted !== undefined;
            // Holiday is always at data.season?.holiday (consistent structure for both live and compiled)
            const holiday = data.season?.holiday;
            const hasHoliday = holiday?.primaryHoliday?.name !== undefined;

            // Add holiday between time and date if available
            if (hasHoliday) {
                const holidayName = holiday.primaryHoliday.name;
                const daysUntil = holiday.primaryHoliday.daysUntil ?? holiday.progressiveElements?.daysUntil;
                const daysText = daysUntil !== undefined && daysUntil !== null ? ` (in ${daysUntil} day${daysUntil !== 1 ? 's' : ''})` : '';
                timeText += ` <span class="carousel-separator">•</span> <i class="fa-solid fa-gifts carousel-inline-icon"></i> ${holidayName}${daysText}`;
            }

            if ((isCompiledContext || hasExplicitDate) && data.time.monthName && data.time.dayOfMonth !== undefined) {
                // Format date as short month name and day number (e.g., "Nov 14")
                const shortMonthName = data.time.monthName.substring(0, 3);
                const dateText = `${shortMonthName} ${data.time.dayOfMonth}`;
                timeText += ` <span class="carousel-separator">•</span> ${dateText}`;
            } else if ((isCompiledContext || hasExplicitDate) && data.time.month !== undefined && data.time.dayOfMonth !== undefined) {
                // Fallback: use month number if monthName is not available
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const monthIndex = typeof data.time.month === 'number' ? data.time.month - 1 : parseInt(data.time.month) - 1;
                if (monthIndex >= 0 && monthIndex < 12) {
                    const dateText = `${monthNames[monthIndex]} ${data.time.dayOfMonth}`;
                    timeText += ` <span class="carousel-separator">•</span> ${dateText}`;
                }
            }

            items.push({
                icon: 'fa-solid ' + analogIcon,
                text: timeText
            });
        }
    }

    // Combine Time of Day and Season into one item
    // Handle both timeOfDay (from current context) and timePeriod (from compiled context)
    let timeOfDayData = null;
    let timePeriodData = null;

    /**
     * Normalizes legacy period keys to new period key names (client-side)
     */
    function normalizePeriodKey(periodKey) {
        if (!periodKey || typeof periodKey !== 'string') {
            return periodKey;
        }

        const normalized = periodKey.toLowerCase().trim();

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

    // Helper function to extract periodKey from period string
    function extractPeriodKeyFromPeriod(periodStr) {
        if (!periodStr) return null;
        const period = periodStr.toLowerCase();

        // Try to match period string to periodKey
        if (period.includes('late morning') || period.includes('late-morning')) {
            return 'latemorning';
        } else if (period.includes('early afternoon') || period.includes('early-afternoon')) {
            return 'earlyafternoon';
        } else if (period.includes('late afternoon') || period.includes('late-afternoon')) {
            return 'lateafternoon';
        } else if (period.includes('late night') || period.includes('late-night')) {
            return 'latenight';
        } else if (period.includes('golden hour') || period.includes('golden-hour')) {
            return 'goldenhour';
        } else if (period.includes('pre-dawn') || period.includes('predawn')) {
            return 'predawn';
        } else {
            // Try to extract the main word (morning, afternoon, evening, night, etc.)
            // Note: 'evening' is now a valid period name (used for cloudy afternoon golden hour)
            const mainWords = ['dawn', 'sunrise', 'morning', 'noon', 'daytime', 'afternoon', 'evening', 'sunset', 'dusk', 'twilight', 'night', 'midnight'];
            for (const word of mainWords) {
                if (period.includes(word)) {
                    return word;
                }
            }
        }
        return null;
    }

    // Check for timeOfDay structure (from current context)
    if (data.timeOfDay && data.timeOfDay.name) {
        // timeOfDay exists and has a valid name - use it
        timeOfDayData = data.timeOfDay;
    }
    // Check for timePeriod structure (from compiled context)
    // Process timePeriod if timeOfDay doesn't exist or doesn't have a valid name
    else if (data.timePeriod) {
        timePeriodData = data.timePeriod;
        // Convert timePeriod to timeOfDay-like structure
        if (typeof timePeriodData === 'object' && timePeriodData !== null) {
            // Extract periodKey or infer from period
            let periodKey = timePeriodData.periodKey;

            // If periodKey is missing but period exists, try to extract periodKey from period
            if (!periodKey && timePeriodData.period) {
                periodKey = extractPeriodKeyFromPeriod(timePeriodData.period);
            }

            // Normalize legacy period keys
            if (periodKey) {
                periodKey = normalizePeriodKey(periodKey);
            }

            timeOfDayData = {
                name: periodKey || timePeriodData.period || null,
                description: timePeriodData.period || null
            };
        } else if (typeof timePeriodData === 'string') {
            // If timePeriod is a string, use it directly
            const extractedKey = extractPeriodKeyFromPeriod(timePeriodData);
            const normalizedKey = normalizePeriodKey(extractedKey || timePeriodData);
            timeOfDayData = {
                name: normalizedKey,
                description: timePeriodData
            };
        }
    }
    // If timeOfDay exists but name is null, try to extract from description
    else if (data.timeOfDay && data.timeOfDay.description) {
        const extractedKey = extractPeriodKeyFromPeriod(data.timeOfDay.description);
        if (extractedKey) {
            timeOfDayData = {
                name: extractedKey,
                description: data.timeOfDay.description
            };
        }
    }

    if (timeOfDayData || data.season) {
        let timeIcon = '';
        let timeText = '';
        let seasonIcon = '';
        let seasonText = '';

        // Time of day - handle timeOfDayData structure
        if (timeOfDayData && timeOfDayData.name) {
            const periodName = timeOfDayData.name;

            if (periodName) {
                // Determine icon based on time period
                let todIcon = 'fa-regular fa-sun';
                const timePeriod = periodName.toLowerCase();

                if (timePeriod.includes('dawn') || timePeriod.includes('sunrise')) {
                    todIcon = 'fa-regular fa-sunrise';
                } else if (timePeriod.includes('morning')) {
                    todIcon = 'fa-regular fa-coffee-pot';
                } else if (timePeriod.includes('daytime')) {
                    todIcon = 'fa-regular fa-sun';
                } else if (timePeriod.includes('afternoon')) {
                    todIcon = 'fa-regular fa-mug-tea-saucer';
                } else if (timePeriod.includes('evening')) {
                    todIcon = 'fa-regular fa-sun-haze';
                } else if (timePeriod.includes('dusk') || timePeriod.includes('sunset')) {
                    todIcon = 'fa-regular fa-sunset';
                } else if (timePeriod.includes('night') || timePeriod.includes('midnight')) {
                    todIcon = 'fa-regular fa-moon';
                }

                // Use the same periodKey mapping as the compiled prompt modal
                let periodDisplayName = 'Time';
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

                periodDisplayName = periodKeyMap[periodName.toLowerCase()] ||
                    periodName
                        .split('_')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');

                timeIcon = todIcon;
                timeText = periodDisplayName;
            }
        }

        // Season - handle both object and string formats (for backward compatibility with compiled prompts)
        if (data.season) {
            let seasonIconClass = 'fas fa-leaf-maple'; // default
            // Extract season name from object or use string directly
            let seasonName;
            if (typeof data.season === 'object' && data.season !== null && data.season.name) {
                seasonName = data.season.name;
            } else if (typeof data.season === 'string') {
                seasonName = data.season;
            } else {
                // Fallback: try to convert to string
                seasonName = String(data.season);
            }
            const season = seasonName.toLowerCase();

            if (season.includes('spring')) {
                seasonIconClass = 'fas fa-flower-tulip';
            } else if (season.includes('summer')) {
                seasonIconClass = 'fas fa-hat-beach';
            } else if (season.includes('autumn') || season.includes('fall')) {
                seasonIconClass = 'fas fa-leaf';
            } else if (season.includes('winter')) {
                seasonIconClass = 'fas fa-snowflake';
            }

            seasonIcon = seasonIconClass;
            seasonText = seasonName.charAt(0).toUpperCase() + seasonName.slice(1);
        }

        // Build text with icons inline - period icon with period text, season icon with season text
        let displayText = '';
        let displayIcon = '';

        if (timeText && seasonText) {
            // Both exist - period icon at start, season icon after separator
            displayText = `<i class="${timeIcon} carousel-inline-icon"></i> ${timeText} <span class="carousel-separator">•</span> <i class="${seasonIcon} carousel-inline-icon"></i> ${seasonText}`;
            displayIcon = ''; // No icon container needed, icons are in text
        } else if (timeText) {
            // Only period
            displayText = `<i class="${timeIcon} carousel-inline-icon"></i> ${timeText}`;
            displayIcon = ''; // No icon container needed
        } else if (seasonText) {
            // Only season
            displayText = `<i class="${seasonIcon} carousel-inline-icon"></i> ${seasonText}`;
            displayIcon = ''; // No icon container needed
        }

        items.push({
            icon: displayIcon,
            text: displayText,
            hasTime: !!timeText,
            hasSeason: !!seasonText,
            timeIcon: timeIcon,
            seasonIcon: seasonIcon,
            inlineIcons: true // Flag to indicate icons are in text
        });
    }


    // Date - only shown if overridden (handled server-side)
    if (data.date?.formatted) {
        items.push({
            icon: 'fa-regular fa-calendar',
            text: data.date.formatted
        });
    }

    // Weather with condition-specific icon
    if (data.weather) {
        // Use feelsLike temperature with proper unit conversion
        const tempData = formatTemperature(data.weather.feelsLike);
        const weatherText = `${tempData.number}<span class="weather-unit">${tempData.unit}</span> <span class="weather-condition">${data.weather.condition}</span>`;

        // Determine if it's night based on timePeriod data
        const isNight = data.timePeriod?.isDaytime === false;
        const timePrefix = isNight ? 'night-alt' : 'day';

        let weatherIcon = isNight ? 'wi wi-night-clear' : 'wi wi-day-sunny'; // default

        if (data.weather.condition) {
            const conditionLower = data.weather.condition.toLowerCase();

            // Icons that don't change between day/night
            const timeNeutralIcons = {
                'overcast': 'wi wi-cloudy',
                'fog': 'wi wi-fog',
                'depositing rime fog': 'wi wi-fog',
                'moderate snow fall': 'wi wi-snow',
                'heavy snow fall': 'wi wi-snow',
                'snow grains': 'wi wi-snow',
                'heavy snow showers': 'wi wi-snow'
            };

            if (timeNeutralIcons[conditionLower]) {
                weatherIcon = timeNeutralIcons[conditionLower];
            } else {
                // Time-dependent icons
                const iconMap = {
                    'clear sky': isNight ? 'wi wi-night-clear' : 'wi wi-day-sunny',
                    'mainly clear': isNight ? 'wi wi-night-alt-partly-cloudy' : 'wi wi-day-sunny-overcast',
                    'partly cloudy': `wi wi-${timePrefix}-cloudy`,
                    'light drizzle': `wi wi-${timePrefix}-showers`,
                    'moderate drizzle': `wi wi-${timePrefix}-showers`,
                    'dense drizzle': `wi wi-${timePrefix}-showers`,
                    'light freezing drizzle': `wi wi-${timePrefix}-snow`,
                    'dense freezing drizzle': `wi wi-${timePrefix}-snow`,
                    'slight rain': `wi wi-${timePrefix}-rain`,
                    'moderate rain': `wi wi-${timePrefix}-rain`,
                    'heavy rain': `wi wi-${timePrefix}-rain`,
                    'light freezing rain': `wi wi-${timePrefix}-snow`,
                    'heavy freezing rain': `wi wi-${timePrefix}-snow`,
                    'slight snow fall': `wi wi-${timePrefix}-snow`,
                    'slight rain showers': `wi wi-${timePrefix}-showers`,
                    'moderate rain showers': `wi wi-${timePrefix}-rain`,
                    'violent rain showers': `wi wi-${timePrefix}-storm-showers`,
                    'slight snow showers': `wi wi-${timePrefix}-snow`,
                    'thunderstorm': `wi wi-${timePrefix}-thunderstorm`,
                    'thunderstorm with slight hail': `wi wi-${timePrefix}-thunderstorm`,
                    'thunderstorm with heavy hail': `wi wi-${timePrefix}-thunderstorm`
                };

                weatherIcon = iconMap[conditionLower] || (isNight ? 'wi wi-night-clear' : 'wi wi-day-sunny');
            }
        }

        items.push({
            icon: weatherIcon,
            text: weatherText
        });
    }

    // Location (if available and static - not auto-detected from IP)
    if (data.location && (data.location.city || data.location.country)) {
        // Check if location was manually set (static) or auto-detected from IP
        // Static locations have source: 'static'
        // Auto-detected locations have source: 'ipinfo', 'ipapi', or 'fallback'
        const isStaticLocation = data.location.source === 'static';

        if (isStaticLocation) {
            const locationText = [data.location.city, data.location.country].filter(Boolean).join(', ');
            items.push({
                icon: 'fa-solid fa-location-dot',
                text: locationText
            });
        }
    }

    return items;
}

function updateDynamicCarousel(data, mode = null) {
    if (!data) return;
    if (!dynamicCarousel) return;

    // Store data based on mode
    if (mode === 'compiled') {
        compiledContextData = data;
        // Update mode if explicitly set to compiled
        carouselMode = 'compiled';
    } else if (mode === 'current') {
        currentContextData = data;
        // Update mode if explicitly set to current
        carouselMode = 'current';
    } else {
        // No mode specified, store as current context
        currentContextData = data;
    }

    // Use specified mode or current mode
    const targetMode = mode || carouselMode;

    // Determine which data to display
    let displayData = targetMode === 'compiled' ? compiledContextData : currentContextData;

    // If target mode is compiled but no compiled data, use current data
    if (targetMode === 'compiled' && !displayData) {
        displayData = currentContextData;
    }

    if (!displayData) return;

    carouselData = formatCarouselItems(displayData);

    if (carouselData.length === 0) {
        carouselData = [{
            icon: 'fa-regular fa-circle-info',
            text: 'Select Options...'
        }];
    }

    // Clear existing carousel items (but preserve indicators)
    const indicators = dynamicCarousel.querySelector('.carousel-indicators');
    dynamicCarousel.innerHTML = '';
    if (indicators) {
        dynamicCarousel.appendChild(indicators);
    }

    // Create all carousel items in the DOM (stacked)
    carouselData.forEach((item, index) => {
        const carouselItem = document.createElement('div');
        carouselItem.className = 'carousel-item';
        if (index === 0) {
            carouselItem.classList.add('active');
        }
        carouselItem.dataset.index = index;

        // If icons are inline in the text, don't create icon container
        if (item.inlineIcons) {
            // Icons are already in the text, just render the text
            const textEl = document.createElement('span');
            textEl.className = 'carousel-text';
            textEl.innerHTML = item.text;
            carouselItem.appendChild(textEl);
        } else {
            // Handle icon container for items with separate icons
            const iconContainer = document.createElement('div');
            iconContainer.className = 'carousel-icon-container';

            if (item.icon && item.icon.includes('|')) {
                // Multiple icons
                const icons = item.icon.split('|');
                icons.forEach(icon => {
                    if (icon.trim()) {
                        const iconEl = document.createElement('i');
                        iconEl.className = `carousel-icon ${icon.trim()}`;
                        iconContainer.appendChild(iconEl);
                    }
                });
            } else if (item.icon) {
                // Single icon
                const iconEl = document.createElement('i');
                iconEl.className = `carousel-icon ${item.icon}`;
                iconContainer.appendChild(iconEl);
            }

            const textEl = document.createElement('span');
            textEl.className = 'carousel-text';
            textEl.innerHTML = item.text;

            carouselItem.appendChild(iconContainer);
            carouselItem.appendChild(textEl);
        }

        dynamicCarousel.insertBefore(carouselItem, indicators || null);
    });

    carouselCurrentIndex = 0;
    updateCarouselIndicators();
    startCarousel();
}

function showCarouselItem(index) {
    if (!dynamicCarousel || carouselData.length === 0) return;

    // Remove active class from all items
    const allItems = dynamicCarousel.querySelectorAll('.carousel-item');
    allItems.forEach(item => {
        item.classList.remove('active');
    });

    // Add active class to current item - CSS handles the animation
    const currentItem = dynamicCarousel.querySelector(`.carousel-item[data-index="${index}"]`);
    if (currentItem) {
        currentItem.classList.add('active');
    }
}

function advanceCarousel() {
    if (carouselPaused || carouselData.length <= 1) return;

    // Move to next index
    carouselCurrentIndex = (carouselCurrentIndex + 1) % carouselData.length;

    // Update active item - CSS handles the animation
    showCarouselItem(carouselCurrentIndex);

    // Update indicators including cache expiration status
    updateCarouselIndicators();
}

function startCarousel() {
    stopCarousel();

    if (carouselData.length > 1) {
        carouselInterval = setInterval(advanceCarousel, 4000);
    }
}

function stopCarousel() {
    if (carouselInterval) {
        clearInterval(carouselInterval);
        carouselInterval = null;
    }
}

function pauseCarousel() {
    carouselPaused = true;
}

function resumeCarousel() {
    carouselPaused = false;
}

function updateCarouselIndicators() {
    const indicators = document.getElementById('carouselIndicators');
    const currentIndicator = document.getElementById('currentContextIndicator');
    const compiledIndicator = document.getElementById('compiledContextIndicator');
    const lockIcon = document.getElementById('carouselLockIcon');
    const fastIcon = document.getElementById('carouselFastIcon');
    const cacheIcon = document.getElementById('carouselCacheIcon');

    if (!dynamicCarousel || !indicators || !currentIndicator || !compiledIndicator) return;

    // Show indicators only if compiled prompt context exists
    // Check both window.dynamicGenerationData and compiledContextData
    const hasCompiledPrompt = window.dynamicGenerationData?.compiled_prompt?.context || compiledContextData;

    if (hasCompiledPrompt) {
        indicators.classList.remove('hidden');
        dynamicCarousel.classList.add('has-indicators');

        // Show/hide lock icon based on freeze state
        // Priority: Freeze Changes (lock icon) > Freeze Context (icicles icon)
        if (lockIcon && dynamicCarousel) {
            const { cacheLocked: isChangesLocked, contextLocked: isContextLocked } = getDynamicGenerationLockState();

            if (isChangesLocked) {
                // Freeze Changes takes priority - show lock icon
                lockIcon.classList.remove('hidden');
                lockIcon.className = 'carousel-lock-icon fa-solid fa-lock';
                lockIcon.title = 'Changes Frozen';
            } else if (isContextLocked) {
                // Freeze Context - show icicles icon
                lockIcon.classList.remove('hidden');
                lockIcon.className = 'carousel-lock-icon fa-solid fa-icicles';
                lockIcon.title = 'Context Frozen';
            } else {
                // Neither is locked - hide icon
                lockIcon.classList.add('hidden');
            }
        }

        // Show/hide fast mode icon based on fast mode state
        if (fastIcon && dynamicCarousel) {
            const isFastMode = dynamicCarousel.dataset.fastMode === 'true';
            if (isFastMode) {
                fastIcon.classList.remove('hidden');
            } else {
                fastIcon.classList.add('hidden');
            }
        }

        // Show/hide cache icon when compiled prompt exists and use-cache is enabled
        // Show triangle exclamation if cache is expired
        if (cacheIcon && dynamicCarousel) {
            const useCache = dynamicCarousel.getAttribute('data-use-cache') !== 'false';
            if (useCache) {
                // Check if compiled prompt has expired
                const compiledPrompt = window.dynamicGenerationData?.compiled_prompt;
                const now = Date.now();
                const isExpired = compiledPrompt?.expiresAt ? now >= compiledPrompt.expiresAt : false;

                if (isExpired) {
                    // Show triangle exclamation for expired cache
                    cacheIcon.className = 'carousel-fast-icon fa-solid fa-triangle-exclamation';
                    cacheIcon.title = 'Cache Expired - Will Regenerate on Next Use';
                    cacheIcon.classList.remove('hidden');
                } else {
                    // Show check circle for valid cache
                    cacheIcon.className = 'carousel-fast-icon fa-regular fa-circle-check';
                    cacheIcon.title = 'Using Cache';
                    cacheIcon.classList.remove('hidden');
                }
            } else {
                cacheIcon.className = 'carousel-fast-icon fa-solid fa-triangle-exclamation';
                cacheIcon.classList.add('hidden');
            }
        }

        // Update active state
        if (carouselMode === 'current') {
            currentIndicator.classList.add('active');
            compiledIndicator.classList.remove('active');
        } else {
            currentIndicator.classList.remove('active');
            compiledIndicator.classList.add('active');
        }
    } else {
        indicators.classList.add('hidden');
        dynamicCarousel.classList.remove('has-indicators');
        if (lockIcon) {
            lockIcon.classList.add('hidden');
        }
        if (fastIcon) {
            fastIcon.classList.add('hidden');
        }
        if (cacheIcon) {
            cacheIcon.classList.add('hidden');
        }
    }
}

function toggleCarouselMode() {
    // Check if compiled prompt context exists
    const hasCompiledPrompt = window.dynamicGenerationData?.compiled_prompt?.context || compiledContextData;

    // Only toggle if compiled prompt exists
    if (!hasCompiledPrompt) return;

    // Toggle mode
    carouselMode = carouselMode === 'current' ? 'compiled' : 'current';

    // Update carousel with current mode's data
    // Use the mode parameter to ensure correct display
    if (carouselMode === 'compiled' && compiledContextData) {
        updateDynamicCarousel(compiledContextData, 'compiled');
    } else if (carouselMode === 'current') {
        // If switching to current context and no context is loaded, refresh it
        if (!currentContextData || (typeof currentContextData === 'object' && Object.keys(currentContextData).length === 0)) {
            requestDynamicContextResolution();
        } else {
            updateDynamicCarousel(currentContextData, 'current');
        }
    } else {
        // If data doesn't exist for the target mode, just update indicators
        updateCarouselIndicators();
    }
}

async function requestDynamicContextResolution() {
    try {
        if (!wsClient || !wsClient.isConnected()) {
            console.warn('⚠️ WebSocket not connected, cannot resolve dynamic context');
            return;
        }

        // Collect current button states
        const todBtn = document.getElementById('todBtn');
        const weatherBtn = document.getElementById('weatherBtn');
        const seasonBtn = document.getElementById('seasonBtn');
        const creativeBtn = document.getElementById('creativeBtn');

        const dynamicConfig = {
            tod: collectDynamicButtonState(todBtn),
            weather: collectDynamicButtonState(weatherBtn),
            season: collectDynamicButtonState(seasonBtn),
            creative: creativeBtn?.dataset.state === 'on'
        };

        // Add location if available
        if (weatherBtn && dynamicConfig.weather && weatherBtn.getAttribute('data-location')) {
            dynamicConfig.location = weatherBtn.getAttribute('data-location');
        }

        // Add disable_holiday if season is enabled and holiday toggle is false
        if (seasonBtn && dynamicConfig.season) {
            const observeHoliday = seasonBtn.dataset.toggleHoliday !== 'false';
            dynamicConfig.disable_holiday = !observeHoliday;
        }

        // Check if any dynamic values are enabled
        const hasAnyEnabled = Object.values(dynamicConfig).some(v => v !== false && v !== null && v !== undefined && v !== '');

        if (!hasAnyEnabled) {
            // Show empty state
            updateDynamicCarousel({});
            return;
        }

        const response = await wsClient.resolveDynamicContext(dynamicConfig);
        if (response) {
            // Store as current context and update carousel
            updateDynamicCarousel(response, 'current');
        }
    } catch (error) {
        console.error('❌ Error resolving dynamic context:', error);
    }
}

// Show loading state in carousel
function showCarouselLoadingState() {
    if (!dynamicCarousel) return;

    // Clear existing carousel items (but preserve indicators)
    const indicators = dynamicCarousel.querySelector('.carousel-indicators');
    dynamicCarousel.innerHTML = '';
    if (indicators) {
        dynamicCarousel.appendChild(indicators);
    }

    // Create loading item
    const loadingItem = document.createElement('div');
    loadingItem.className = 'carousel-item active';
    loadingItem.dataset.index = 0;

    const iconContainer = document.createElement('div');
    iconContainer.className = 'carousel-icon-container';
    const iconEl = document.createElement('i');
    iconEl.className = 'carousel-icon fa-solid fa-spinner-third fa-spin';
    iconContainer.appendChild(iconEl);

    const textEl = document.createElement('span');
    textEl.className = 'carousel-text';
    textEl.textContent = 'Please Wait...';

    loadingItem.appendChild(iconContainer);
    loadingItem.appendChild(textEl);

    dynamicCarousel.insertBefore(loadingItem, indicators || null);

    // Update carousel state
    carouselCurrentIndex = 0;
    carouselData = [{
        icon: 'fa-solid fa-spinner-third fa-spin',
        text: 'Please Wait...'
    }];
    updateCarouselIndicators();
}

// Debounced version to prevent excessive server requests
let debouncedRequestDynamicContextResolution = null;
function createDebouncedContextResolution() {
    // Show loading state immediately when function is called
    showCarouselLoadingState();

    // Create debounced function if it doesn't exist
    if (!debouncedRequestDynamicContextResolution) {
        debouncedRequestDynamicContextResolution = debounce(() => {
            requestDynamicContextResolution();
        }, 2500);
    }
    // Call the debounced function
    return debouncedRequestDynamicContextResolution();
}
