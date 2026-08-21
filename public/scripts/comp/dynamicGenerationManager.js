/**
 * Dynamic Generation (Rentan) — context menus, modals, carousel, and UI wiring.
 * Phase 1 extract from app.js; originals remain until manifest removal pass.
 *
 * DOM refs (dynamicCarousel, todBtn, …): manualModalManager.js
 * Lock state helpers: dynamicGenerationLockState.js
 * compileToPrompts action: compileToPromptsApplet.js
 * disableDynamicGeneration: manualModalManager.js
 */

let dynamicGenerationUIWired = false;
let dynamicGenContextMenuActionWired = false;

function initDynamicCarousel() {
    if (!dynamicCarousel || dynamicCarousel._dynGenCarouselWired) return;
    dynamicCarousel._dynGenCarouselWired = true;

    // Add hover listeners for pause/resume
    dynamicCarousel.addEventListener('mouseenter', pauseCarousel);
    dynamicCarousel.addEventListener('mouseleave', resumeCarousel);

    // Add click handler to toggle between modes (only left-click, not right-click for context menu)
    dynamicCarousel.addEventListener('click', (e) => {
        // Don't toggle on right-click (context menu)
        if (e.button === 2 || e.ctrlKey || e.metaKey) return;
        // Don't toggle if clicking on indicators (they have their own handlers if needed)
        if (e.target.closest('.carousel-indicators')) return;

        toggleCarouselMode();
    });
}

function setupDynamicGenerationContextMenus() {
    // Time of Day options - Enhanced with detailed transitional periods
    const todMenuConfig = {
        sections: [
            {
                type: 'list',
                title: () => getCurrentTodDisplay(),
                items: [
                    {
                        text: 'Select Date & Time',
                        icon: 'fas fa-clock',
                        action: 'openTimeDateModal'
                    },
                    {
                        text: 'Use Current Time',
                        icon: 'fas fa-clock',
                        action: 'clearTodTimeOverride',
                        initfn: function (item) {
                            item.hidden = !hasTimeOverride();
                        }
                    },
                    {
                        text: 'Tomorrow',
                        icon: 'fas fa-calendar-day',
                        action: 'setTodDateOverride',
                        value: 'tomorrow'
                    },
                    {
                        text: 'Use Current Date',
                        icon: 'fas fa-calendar-check',
                        action: 'clearTodDateOverride',
                        initfn: function (item) {
                            item.hidden = !hasDateOverride();
                        }
                    },
                ]
            },
            {
                type: 'list',
                items: [
                    {
                        text: 'Time of Day',
                        icon: 'fas fa-clock',
                        submenu: [
                            { text: 'Dawn - Pre-sunrise soft light', icon: 'fas fa-sunrise', action: 'setTodTimeOverride', value: 'dawn' },
                            { text: 'Sunrise - Sun rising, golden light', icon: 'fas fa-sunrise', action: 'setTodTimeOverride', value: 'sunrise' },
                            { text: 'Morning - Post-sunrise bright daylight', icon: 'fas fa-sun', action: 'setTodTimeOverride', value: 'morning' },
                            { text: 'Late Morning - Approaching noon', icon: 'fas fa-sun', action: 'setTodTimeOverride', value: 'latemorning' },
                            { text: 'Daytime - Sun at highest point', icon: 'fas fa-sun', action: 'setTodTimeOverride', value: 'daytime' },
                            { text: 'Afternoon - Full warm sunlight', icon: 'fas fa-sun', action: 'setTodTimeOverride', value: 'afternoon' },
                            { text: 'Late Afternoon - Golden hour approaching', icon: 'fas fa-sun', action: 'setTodTimeOverride', value: 'lateafternoon' },
                            { text: 'Golden Hour - Warm magical light', icon: 'fas fa-sun', action: 'setTodTimeOverride', value: 'goldenhour' },
                            { text: 'Evening - Post-afternoon, pre-sunset', icon: 'fas fa-sun-haze', action: 'setTodTimeOverride', value: 'evening' },
                            { text: 'Sunset - Sun setting, dramatic colors', icon: 'fas fa-sunset', action: 'setTodTimeOverride', value: 'sunset' },
                            { text: 'Dusk - Fading light to twilight', icon: 'fas fa-moon', action: 'setTodTimeOverride', value: 'dusk' },
                            { text: 'Night - Nighttime darkness', icon: 'fas fa-moon', action: 'setTodTimeOverride', value: 'night' },
                            { text: 'Midnight - Complete darkness', icon: 'fas fa-star', action: 'setTodTimeOverride', value: 'midnight' },
                        ]
                    },
                    {
                        text: 'Holiday',
                        icon: 'fas fa-party-horn',
                        submenu: [
                            { text: 'Nearest Holiday', icon: 'fas fa-calendar-alt', action: 'setTodDateOverride', value: 'nearest' },
                            { text: 'Christmas', icon: 'fas fa-gift', action: 'setTodDateOverride', value: 'christmas', valueDisplay: '<i class=\"fas fa-flag-usa\"></i>' },
                            { text: 'New Year\'s', icon: 'fas fa-party-horn', action: 'setTodDateOverride', value: 'newyears', valueDisplay: '<i class=\"fas fa-flag-usa\"></i>' },
                            { text: 'Halloween', icon: 'fas fa-ghost', action: 'setTodDateOverride', value: 'halloween', valueDisplay: '<i class=\"fas fa-flag-usa\"></i>' },
                            { text: 'Thanksgiving', icon: 'fas fa-turkey', action: 'setTodDateOverride', value: 'thanksgiving', valueDisplay: '<i class=\"fas fa-flag-usa\"></i>' },
                            { text: 'Independence Day', icon: 'fas fa-flag-usa', action: 'setTodDateOverride', value: 'independenceday', valueDisplay: '<i class=\"fas fa-flag-usa\"></i>' },
                            { text: 'Valentine\'s Day', icon: 'fas fa-heart', action: 'setTodDateOverride', value: 'valentinesday', valueDisplay: '<i class=\"fas fa-flag-usa\"></i>' },
                            { text: 'Easter', icon: 'fas fa-egg', action: 'setTodDateOverride', value: 'easter', valueDisplay: '<i class=\"fas fa-flag-usa\"></i>' },
                            { text: 'Chinese New Year', icon: 'fas fa-dragon', action: 'setTodDateOverride', value: 'chinesenewyear', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Setsubun', icon: 'fas fa-seedling', action: 'setTodDateOverride', value: 'setsubun', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Hinamatsuri', icon: 'fas fa-fan', action: 'setTodDateOverride', value: 'hinamatsuri', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Summer Festival', icon: 'fas fa-umbrella-beach', action: 'setTodDateOverride', value: 'summerfestival', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Japanese New Year', icon: 'fas fa-torii-gate', action: 'setTodDateOverride', value: 'japanesenewyear', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Cherry Blossom', icon: 'fas fa-leaf', action: 'setTodDateOverride', value: 'cherryblossom', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Tanabata Festival', icon: 'fas fa-star-and-crescent', action: 'setTodDateOverride', value: 'tanabatafestival', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Golden Week', icon: 'fas fa-flag', action: 'setTodDateOverride', value: 'goldenweek', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Children\'s Day', icon: 'fas fa-child', action: 'setTodDateOverride', value: 'childrensday', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Mid-Autumn Festival', icon: 'fas fa-moon', action: 'setTodDateOverride', value: 'tsukimi', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                            { text: 'Obon Festival', icon: 'fas fa-pray', action: 'setTodDateOverride', value: 'obonfestival', valueDisplay: '<i class=\"fas fa-flag\"></i>' },
                        ]
                    }
                ]
            }
        ]
    };

    // Weather options - Comprehensive weather conditions
    const weatherMenuConfig = {
        sections: [
            {
                type: 'list',
                title: function () {
                    const weatherBtn = document.getElementById('weatherBtn');
                    const locationDisplay = weatherBtn?.dataset?.locationDisplay;
                    return locationDisplay ? `Weather (${locationDisplay})` : 'Weather';
                },
                items: [
                    {
                        text: 'Forecast',
                        icon: 'fas fa-calendar',
                        action: 'toggleWeatherForecast',
                        keepMenuOpen: true,
                        loadfn: function (item, target) {
                            const weatherBtn = document.getElementById('weatherBtn');
                            const useForecast = weatherBtn?.getAttribute('data-override') === 'forecast';
                            item.checked = useForecast;
                            item.className = useForecast ? 'text-success' : '';
                        }
                    },
                    {
                        text: 'Conditions',
                        icon: 'fas fa-cloud',
                        submenu: [
                            { text: 'Clear Sky - Perfect blue sky, no clouds', icon: 'fas fa-sun', action: 'setWeatherOverride', value: 'clear_sky' },
                            { text: 'Few Clouds - Mostly clear with scattered clouds', icon: 'fas fa-cloud-sun', action: 'setWeatherOverride', value: 'few_clouds' },
                            { text: 'Partly Cloudy - Mix of sun and clouds', icon: 'fas fa-cloud-sun', action: 'setWeatherOverride', value: 'partly_cloudy' },
                            { text: 'Fair Weather - Pleasant, mild conditions', icon: 'fas fa-sun', action: 'setWeatherOverride', value: 'fair' },
                            { separator: true },
                            { text: 'Scattered Clouds - Some cloud coverage', icon: 'fas fa-cloud', action: 'setWeatherOverride', value: 'scattered_clouds' },
                            { text: 'Broken Clouds - Significant cloud coverage', icon: 'fas fa-cloud', action: 'setWeatherOverride', value: 'broken_clouds' },
                            { text: 'Overcast - Completely cloudy sky', icon: 'fas fa-cloud', action: 'setWeatherOverride', value: 'overcast' },
                            { text: 'Mostly Cloudy - Predominantly cloudy', icon: 'fas fa-cloud', action: 'setWeatherOverride', value: 'mostly_cloudy' },
                            { separator: true },
                            { text: 'Light Rain - Gentle, steady rain', icon: 'fas fa-cloud-rain', action: 'setWeatherOverride', value: 'light_rain' },
                            { text: 'Moderate Rain - Steady rainfall', icon: 'fas fa-cloud-rain', action: 'setWeatherOverride', value: 'moderate_rain' },
                            { text: 'Heavy Rain - Intense downpour', icon: 'fas fa-cloud-showers-heavy', action: 'setWeatherOverride', value: 'heavy_rain' },
                            { text: 'Light Snow - Gentle snowfall', icon: 'fas fa-snowflake', action: 'setWeatherOverride', value: 'light_snow' },
                            { text: 'Moderate Snow - Steady snow', icon: 'fas fa-snowflake', action: 'setWeatherOverride', value: 'moderate_snow' },
                            { text: 'Heavy Snow - Intense snowfall', icon: 'fas fa-snowflake', action: 'setWeatherOverride', value: 'heavy_snow' },
                            { text: 'Freezing Rain - Rain that freezes on contact', icon: 'fas fa-cloud-rain', action: 'setWeatherOverride', value: 'freezing_rain' },
                            { text: 'Sleet - Mix of rain and snow', icon: 'fas fa-snowflake', action: 'setWeatherOverride', value: 'sleet' },
                            { separator: true },
                            { text: 'Thunderstorm - Lightning and thunder', icon: 'fas fa-bolt', action: 'setWeatherOverride', value: 'thunderstorm' },
                            { text: 'Severe Thunderstorm - Intense electrical storm', icon: 'fas fa-bolt', action: 'setWeatherOverride', value: 'severe_thunderstorm' },
                            { text: 'Tornado - Severe rotating storm', icon: 'fas fa-tornado', action: 'setWeatherOverride', value: 'tornado' },
                            { text: 'Hurricane - Tropical cyclone', icon: 'fas fa-wind', action: 'setWeatherOverride', value: 'hurricane' },
                            { text: 'Tropical Storm - Weaker tropical system', icon: 'fas fa-wind', action: 'setWeatherOverride', value: 'tropical_storm' },
                            { separator: true },
                            { text: 'Mist - Light fog, poor visibility', icon: 'fas fa-smog', action: 'setWeatherOverride', value: 'mist' },
                            { text: 'Fog - Dense fog, very poor visibility', icon: 'fas fa-smog', action: 'setWeatherOverride', value: 'fog' },
                            { text: 'Dense Fog - Extremely poor visibility', icon: 'fas fa-smog', action: 'setWeatherOverride', value: 'dense_fog' },
                            { text: 'Haze - Atmospheric particles reducing visibility', icon: 'fas fa-smog', action: 'setWeatherOverride', value: 'haze' },
                            { text: 'Dust - Dusty conditions', icon: 'fas fa-dust', action: 'setWeatherOverride', value: 'dust' },
                            { text: 'Volcanic Ash - Ash from volcanic activity', icon: 'fas fa-volcano', action: 'setWeatherOverride', value: 'volcanic_ash' },
                            { text: 'Sand - Sandy conditions', icon: 'fas fa-dust', action: 'setWeatherOverride', value: 'sand' },
                            { text: 'Squalls - Sudden, strong winds', icon: 'fas fa-wind', action: 'setWeatherOverride', value: 'squalls' },
                            { separator: true },
                            { text: 'Rainbow - Colorful arc after rain', icon: 'fas fa-rainbow', action: 'setWeatherOverride', value: 'rainbow' },
                            { text: 'Blizzard - Severe snowstorm with high winds', icon: 'fas fa-snowflake', action: 'setWeatherOverride', value: 'blizzard' },
                            { text: 'High Surf - Large ocean waves', icon: 'fas fa-water', action: 'setWeatherOverride', value: 'high_surf' },
                            { text: 'Heat Wave - Extremely hot conditions', icon: 'fas fa-thermometer-full', action: 'setWeatherOverride', value: 'heat_wave' },
                            { text: 'Cold Wave - Extremely cold conditions', icon: 'fas fa-thermometer-empty', action: 'setWeatherOverride', value: 'cold_wave' }
                        ]
                    },
                    { separator: true },
                    { text: 'Auto Location (IP)', icon: 'fas fa-globe-wifi', action: 'setIPLocation' },
                    { text: 'Static Location (Lookup)', icon: 'fas fa-plane-departure', action: 'openWeatherLocationModal' },
                    { text: 'Static Location (GPS)', icon: 'fas fa-location-crosshairs', action: 'setCurrentLocation' },
                    {
                        text: 'Static Location (Server)',
                        icon: 'fas fa-times',
                        action: 'clearWeatherLocation',
                        loadfn: function (item) {
                            const weatherBtn = document.getElementById('weatherBtn');
                            item.disabled = !weatherBtn || !weatherBtn.getAttribute('data-location');
                        }
                    }
                ]
            }
        ]
    };

    // Season options
    const seasonMenuConfig = {
        sections: [
            {
                type: 'list',
                title: 'Season',
                items: [
                    {
                        text: 'Holidays',
                        icon: 'fas fa-calendar-star',
                        action: 'toggleObserveHoliday',
                        keepMenuOpen: true,
                        loadfn: function (item, target) {
                            const observeHolidayEnabled = target.dataset.toggleHoliday === 'true';
                            item.checked = observeHolidayEnabled;
                            item.className = observeHolidayEnabled ? 'text-success' : '';
                        }
                    },
                    { separator: true },
                    {
                        text: 'Use Date',
                        icon: 'fas fa-times',
                        action: 'setSeasonOverride',
                        value: false,
                        initfn: function (item) {
                            item.hidden = !seasonBtn?.hasAttribute('data-override');
                        }
                    },
                    { text: 'Spring', icon: 'fas fa-leaf', action: 'setSeasonOverride', value: 1 },
                    { text: 'Summer', icon: 'fas fa-sun', action: 'setSeasonOverride', value: 2 },
                    { text: 'Autumn', icon: 'fas fa-tree', action: 'setSeasonOverride', value: 3 },
                    { text: 'Winter', icon: 'fas fa-snowflake', action: 'setSeasonOverride', value: 4 }
                ]
            }
        ]
    };

    // Activity options
    const activityMenuConfig = {
        sections: [{
            type: 'list',
            title: 'Activity',
            items: [
                { text: 'Resting', action: 'setActivityOverride', value: 1 },
                { text: 'Walking', action: 'setActivityOverride', value: 2 },
                { text: 'Running', action: 'setActivityOverride', value: 3 },
                { text: 'Working', action: 'setActivityOverride', value: 4 },
                { text: 'Playing', action: 'setActivityOverride', value: 5 },
                { text: 'Traveling', action: 'setActivityOverride', value: 6 }
            ]
        }]
    };

    // Location options
    const locationMenuConfig = {
        sections: [{
            type: 'list',
            title: 'Location',
            items: [
                { text: 'Home', action: 'setLocationOverride', value: 1 },
                { text: 'Office', action: 'setLocationOverride', value: 2 },
                { text: 'Outdoor', action: 'setLocationOverride', value: 3 },
                { text: 'Urban', action: 'setLocationOverride', value: 4 },
                { text: 'Rural', action: 'setLocationOverride', value: 5 },
                { text: 'Beach', action: 'setLocationOverride', value: 6 },
                { text: 'Mountain', action: 'setLocationOverride', value: 7 },
                { text: 'Forest', action: 'setLocationOverride', value: 8 }
            ]
        }]
    };

    const lockMenuConfig = {
        sections: [
            {
                type: 'custom',
                initfn: function (section, target) {
                    const compiledPrompt = window.dynamicGenerationData?.compiled_prompt;
                    const previewHash = compiledPrompt?.preview_image_hash;

                    // Hide section if no preview exists
                    section.hidden = !previewHash;
                },
                content: function (target) {
                    const compiledPrompt = window.dynamicGenerationData?.compiled_prompt;
                    const previewHash = compiledPrompt?.preview_image_hash;

                    if (!previewHash) {
                        return '';
                    }

                    const container = document.createElement('div');
                    container.className = 'dyn-gen-preview-container';
                    container.style.cssText = 'padding: 4px 8px 0 8px; display: flex; justify-content: center; align-items: center; min-height: 175px; flex-shrink: 0;';

                    const img = document.createElement('img');
                    img.src = `/cache/dynGenPreview/${previewHash}.png`;
                    img.alt = 'Enshutsuka Preview';
                    img.style.cssText = 'max-width: 100%; max-height: 175px; border-radius: 4px; object-fit: contain; cursor: pointer;';
                    img.loading = 'lazy';

                    // Add click handler to open in PhotoSwipe lightbox
                    img.addEventListener('click', async function (e) {
                        e.stopPropagation();

                        // Close the context menu first
                        if (contextMenu) {
                            contextMenu.hideMenu();
                        }

                        // Open in standalone PhotoSwipe
                        const standaloneData = [{
                            src: img.src,
                            width: img.naturalWidth || 1024,
                            height: img.naturalHeight || 1024,
                            data: {
                                filename: 'Enshutsuka Preview',
                                base: img.src,
                                upscaled: img.src,
                                original: img.src,
                                isStandalone: true
                            }
                        }];

                        await openStandalonePhotoSwipe(standaloneData);
                    });

                    // Add error handler
                    img.onerror = function () {
                        container.style.minHeight = 'auto';
                        container.innerHTML = '<div style="padding: 8px; text-align: center; color: var(--text-muted);">Preview not available</div>';
                    };

                    container.appendChild(img);
                    return container;
                }
            },
            {
                type: 'list',
                title: 'Enshutsuka Data',
                items: [
                    {
                        text: 'Inspector',
                        action: 'showInspector',
                        icon: 'fas fa-glasses-round',
                        loadfn: function (item) {
                            item.disabled = !Boolean(window.dynamicGenerationData?.compiled_prompt);
                        }
                    },
                    {
                        text: 'Compile to Prompts',
                        action: 'compileToPrompts',
                        icon: 'fas fa-file-pen',
                        loadfn: function (item) {
                            item.disabled = !isDynamicGenerationEnabled();
                        }
                    },
                    {
                        text: 'Refresh',
                        action: 'toggleForceRefresh',
                        icon: 'fas fa-rotate',
                        keepMenuOpen: true,
                        loadfn: function (item, target) {
                            const forceRefreshEnabled = dynamicCarousel?.dataset.forceRefresh === 'true';
                            const hasPreviousResponse = Boolean(window.dynamicGenerationData?.compiled_prompt?.previousResponseId);
                            const chainUpdatesEnabled = dynamicCarousel?.dataset.chainUpdates === 'true';

                            // Only enable if chain updates are on and we have previous response
                            item.disabled = !hasPreviousResponse;
                            item.checked = forceRefreshEnabled;
                            item.className = forceRefreshEnabled ? 'text-warning' : '';
                        }
                    },
                    {
                        text: 'Fast Mode',
                        action: 'toggleFastMode',
                        icon: 'fas fa-bolt',
                        keepMenuOpen: true,
                        loadfn: function (item, target) {
                            const fastModeEnabled = dynamicCarousel?.dataset.fastMode === 'true';
                            item.checked = fastModeEnabled;
                            item.className = fastModeEnabled ? 'text-success' : '';
                        }
                    },
                    {
                        text: 'Optimization',
                        icon: 'fas fa-merge',
                        submenu: [
                            {
                                text: 'Enable',
                                icon: 'fas fa-cog',
                                action: 'toggleOptimize',
                                keepMenuOpen: true,
                                loadfn: function (item, target) {
                                    const optimizeEnabled = dynamicCarousel?.dataset.optimizeEnabled === 'true';
                                    item.checked = optimizeEnabled;
                                    item.className = optimizeEnabled ? 'text-success' : '';
                                }
                            },
                            {
                                text: 'Token Optimization',
                                icon: 'fas fa-cash-register',
                                action: 'toggleTokenCount',
                                keepMenuOpen: true,
                                loadfn: function (item, target) {
                                    const tokenCountEnabled = dynamicCarousel?.dataset.tokenCount === 'true';
                                    item.checked = tokenCountEnabled;
                                    item.className = tokenCountEnabled ? 'text-success' : '';
                                }
                            },
                            {
                                text: 'Two-Pass',
                                icon: 'fas fa-layer-group',
                                action: 'toggleTwoStage',
                                keepMenuOpen: true,
                                loadfn: function (item, target) {
                                    const fastModeEnabled = dynamicCarousel?.dataset.fastMode === 'true';
                                    const twoStageEnabled = dynamicCarousel?.dataset.twoStage === 'true';
                                    const tokenCountEnabled = dynamicCarousel?.dataset.tokenCount === 'true';

                                    item.checked = twoStageEnabled;
                                    item.className = twoStageEnabled ? 'text-success' : '';
                                    // Disable when optimize is off or fast mode is enabled
                                    item.disabled = !tokenCountEnabled || fastModeEnabled;
                                }
                            },
                            {
                                text: 'Chain Updates',
                                action: 'toggleChainUpdates',
                                icon: 'fas fa-link-horizontal',
                                keepMenuOpen: true,
                                loadfn: function (item, target) {
                                    // Default to false (disabled) if not set
                                    const chainUpdatesEnabled = dynamicCarousel?.dataset.chainUpdates === 'true';
                                    const hasPreviousResponse = Boolean(window.dynamicGenerationData?.compiled_prompt?.previousResponseId);

                                    item.disabled = !hasPreviousResponse;
                                    item.checked = chainUpdatesEnabled;
                                    item.className = chainUpdatesEnabled ? 'text-info' : '';
                                }
                            },
                            {
                                text: 'Visual Awareness',
                                separator: true
                            },
                            {
                                text: 'Prompt Preview',
                                icon: 'fas fa-image-polaroid',
                                action: 'toggleInitialPromptAware',
                                keepMenuOpen: true,
                                loadfn: function (item, target) {
                                    const initialPromptAwareEnabled = dynamicCarousel?.dataset.initialPromptAware === 'true';
                                    item.checked = initialPromptAwareEnabled;
                                    item.className = initialPromptAwareEnabled ? 'text-success' : '';
                                }
                            },
                            {
                                text: 'Stage Results',
                                icon: 'fas fa-arrow-down-triangle-square',
                                action: 'togglePipelineAware',
                                keepMenuOpen: true,
                                loadfn: function (item, target) {
                                    const pipelineAwareEnabled = dynamicCarousel?.dataset.pipelineAware === 'true';
                                    item.checked = pipelineAwareEnabled;
                                    item.className = pipelineAwareEnabled ? 'text-success' : '';
                                    item.disabled = !(document.getElementById('pipelineStagesContainer')?.children?.length > 0);
                                }
                            }
                        ]
                    },
                    {
                        text: 'Strategy',
                        icon: 'fas fa-route',
                        valueDisplay: function (target) {
                            const currentValue = dynamicCarousel?.dataset.creativeDirectiveStrategy || '';
                            return currentValue?.toUpperCase() || 'Auto';
                        },
                        submenu: [
                            {
                                text: 'Auto',
                                action: 'setCreativeDirectiveStrategy',
                                value: null,
                                loadfn: function (item, target) {
                                    const currentValue = dynamicCarousel?.dataset.creativeDirectiveStrategy || '';
                                    item.checked = currentValue === '' || currentValue === null;
                                }
                            },
                            {
                                text: 'Tags Only',
                                action: 'setCreativeDirectiveStrategy',
                                value: 'A',
                                loadfn: function (item, target) {
                                    const currentValue = dynamicCarousel?.dataset.creativeDirectiveStrategy || '';
                                    item.checked = currentValue === 'A';
                                }
                            },
                            {
                                text: 'Tags + Modifiers',
                                action: 'setCreativeDirectiveStrategy',
                                value: 'B',
                                loadfn: function (item, target) {
                                    const currentValue = dynamicCarousel?.dataset.creativeDirectiveStrategy || '';
                                    item.checked = currentValue === 'B';
                                }
                            },
                            {
                                text: 'Descriptive Tags',
                                action: 'setCreativeDirectiveStrategy',
                                value: 'C',
                                loadfn: function (item, target) {
                                    const currentValue = dynamicCarousel?.dataset.creativeDirectiveStrategy || '';
                                    item.checked = currentValue === 'C';
                                }
                            }
                        ]
                    },
                    {
                        text: 'Tool Calls',
                        icon: 'fas fa-hammer',
                        valueDisplay: function (target) {
                            return getEffectiveDynamicToolPasses().toString();
                        },
                        submenu: [
                            {
                                text: '4',
                                action: 'setCreativeDirectiveToolPasses',
                                value: 4,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicToolPasses() === 4;
                                }
                            },
                            {
                                text: '6',
                                action: 'setCreativeDirectiveToolPasses',
                                value: 6,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicToolPasses() === 6;
                                }
                            },
                            {
                                text: '8',
                                action: 'setCreativeDirectiveToolPasses',
                                value: 8,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicToolPasses() === 8;
                                }
                            },
                            {
                                text: '10',
                                action: 'setCreativeDirectiveToolPasses',
                                value: 10,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicToolPasses() === 10;
                                }
                            },
                            {
                                text: '12',
                                action: 'setCreativeDirectiveToolPasses',
                                value: 12,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicToolPasses() === 12;
                                }
                            },
                            {
                                text: '16',
                                action: 'setCreativeDirectiveToolPasses',
                                value: 16,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicToolPasses() === 16;
                                }
                            },
                            {
                                text: '20',
                                action: 'setCreativeDirectiveToolPasses',
                                value: 20,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicToolPasses() === 20;
                                }
                            }
                        ]
                    },
                    {
                        text: 'Dialogs',
                        icon: 'fas fa-comments',
                        valueDisplay: function (target) {
                            const currentValue = getEffectiveDynamicDialogsCount();
                            return currentValue === 0 ? 'Off' : currentValue.toString();
                        },
                        submenu: [
                            {
                                text: 'Disable',
                                icon: 'fas fa-times-circle',
                                action: 'disableCreativeDirectiveDialogs',
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicDialogsCount() === 0;
                                }
                            },
                            { separator: true },
                            {
                                text: '4',
                                action: 'setCreativeDirectiveDialogs',
                                value: 4,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicDialogsCount() === 4;
                                }
                            },
                            {
                                text: '6',
                                action: 'setCreativeDirectiveDialogs',
                                value: 6,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicDialogsCount() === 6;
                                }
                            },
                            {
                                text: '8',
                                action: 'setCreativeDirectiveDialogs',
                                value: 8,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicDialogsCount() === 8;
                                }
                            },
                            {
                                text: '10',
                                action: 'setCreativeDirectiveDialogs',
                                value: 10,
                                loadfn: function (item, target) {
                                    item.checked = getEffectiveDynamicDialogsCount() === 10;
                                }
                            }
                        ]
                    },
                    {
                        text: 'Temperature',
                        icon: 'fas fa-thermometer-three-quarters',
                        valueDisplay: function (target) {
                            return formatDynamicAiTemperature(getEffectiveDynamicAiTemperature());
                        },
                        submenu: [
                            {
                                text: 'Auto',
                                icon: 'fas fa-wand-magic-sparkles',
                                action: 'clearAiTemperature',
                                loadfn: function (item, target) {
                                    item.checked = !hasExplicitDynamicAiTemperature();
                                }
                            },
                            { separator: true },
                            {
                                text: 'Deterministic (0.0)',
                                icon: 'fas fa-lock',
                                action: 'setAiTemperature',
                                value: 0.0,
                                loadfn: function (item, target) {
                                    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
                                    item.checked = aiTemp === '0' || aiTemp === '0.0';
                                }
                            },
                            {
                                text: 'Very Low (0.1)',
                                icon: 'fas fa-snowflake',
                                action: 'setAiTemperature',
                                value: 0.1,
                                loadfn: function (item, target) {
                                    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
                                    item.checked = aiTemp === '0.1';
                                }
                            },
                            {
                                text: 'Low (0.3)',
                                icon: 'fas fa-thermometer-quarter',
                                action: 'setAiTemperature',
                                value: 0.3,
                                loadfn: function (item, target) {
                                    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
                                    item.checked = aiTemp === '0.3';
                                }
                            },
                            {
                                text: 'Medium-Low (0.5)',
                                icon: 'fas fa-thermometer-half',
                                action: 'setAiTemperature',
                                value: 0.5,
                                loadfn: function (item, target) {
                                    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
                                    item.checked = aiTemp === '0.5';
                                }
                            },
                            {
                                text: 'Medium (0.7)',
                                icon: 'fas fa-thermometer-half',
                                action: 'setAiTemperature',
                                value: 0.7,
                                loadfn: function (item, target) {
                                    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
                                    item.checked = aiTemp === '0.7';
                                }
                            },
                            { separator: true },
                            {
                                text: 'Medium-High (1.0)',
                                icon: 'fas fa-thermometer-three-quarters',
                                action: 'setAiTemperature',
                                value: 1.0,
                                loadfn: function (item, target) {
                                    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
                                    item.checked = aiTemp === '1' || aiTemp === '1.0';
                                }
                            },
                            {
                                text: 'High (1.2)',
                                icon: 'fas fa-thermometer-full',
                                action: 'setAiTemperature',
                                value: 1.2,
                                loadfn: function (item, target) {
                                    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
                                    item.checked = aiTemp === '1.2';
                                }
                            },
                            {
                                text: 'Very High (1.5)',
                                icon: 'fas fa-fire',
                                action: 'setAiTemperature',
                                value: 1.5,
                                loadfn: function (item, target) {
                                    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
                                    item.checked = aiTemp === '1.5';
                                }
                            },
                            {
                                text: 'Maximum (2.0)',
                                icon: 'fas fa-fire-flame-curved',
                                action: 'setAiTemperature',
                                value: 2.0,
                                loadfn: function (item, target) {
                                    const aiTemp = dynamicCarousel?.dataset.aiTemperature;
                                    item.checked = aiTemp === '2' || aiTemp === '2.0';
                                }
                            }
                        ]
                    },
                    {
                        text: 'Freeze Data',
                        separator: true
                    },
                    {
                        text: 'Freeze Context',
                        action: 'toggleLockContext',
                        icon: 'fas fa-icicles',
                        keepMenuOpen: true,
                        loadfn: function (item, target) {
                            const { cacheLocked, contextLocked } = getDynamicGenerationLockState();
                            const hasContext = Boolean(window.dynamicGenerationData?.compiled_prompt) &&
                                Boolean(window.dynamicGenerationData?.compiled_prompt?.context);

                            item.disabled = !hasContext || cacheLocked;
                            item.checked = contextLocked || cacheLocked;
                        }
                    },
                    {
                        text: 'Freeze Changes',
                        action: 'toggleLockResults',
                        icon: 'fas fa-lock',
                        keepMenuOpen: true,
                        loadfn: function (item, target) {
                            const { cacheLocked } = getDynamicGenerationLockState();
                            const hasCache = Boolean(window.dynamicGenerationData?.compiled_prompt);

                            item.disabled = !hasCache;
                            item.checked = cacheLocked;
                        }
                    },
                    {
                        text: 'Cache Controls',
                        separator: true
                    },
                    {
                        text: 'Change Cache',
                        action: 'toggleUseCache',
                        icon: 'fas fa-floppy-disk',
                        keepMenuOpen: true,
                        loadfn: function (item, target) {
                            item.checked = dynamicCarousel?.getAttribute('data-use-cache') !== 'false';
                        },
                    },
                    {
                        text: 'Preview Cache',
                        action: 'toggleExpirePreview',
                        keepMenuOpen: true,
                        icon: 'fas fa-image',
                        loadfn: function (item, target) {
                            const expirePreview = dynamicCarousel?.dataset.expirePreview === 'true';
                            const hasPreview = Boolean(window.dynamicGenerationData?.compiled_prompt?.preview_image_hash ||
                                window.dynamicGenerationData?.compiled_prompt?.preview_image);

                            item.disabled = !hasPreview;
                            item.checked = !expirePreview;
                        }
                    },
                    {
                        text: 'Erase Cache',
                        action: 'clearCompiledPrompt',
                        className: 'text-danger',
                        icon: 'fas fa-fire',
                        loadfn: function (item) {
                            const compiledPrompt = Boolean(window.dynamicGenerationData?.compiled_prompt);
                            item.disabled = !compiledPrompt;
                        }
                    },
                    { separator: true },
                    {
                        text: 'Disable',
                        action: 'disableDynamicGeneration',
                        className: 'text-danger',
                        icon: 'fas fa-power-off'
                    }
                ]
            }]
    };

    // Optimize button options
    const optimizeMenuConfig = {
        sections: [{
            type: 'list',
            title: 'Optimization',
            items: [
                {
                    text: 'Optimize Tokens',
                    icon: 'fas fa-hashtag',
                    action: 'toggleTokenCount',
                    keepMenuOpen: true,
                    loadfn: function (item, target) {
                        const tokenCountEnabled = target.dataset.tokenCount === 'true';
                        item.checked = tokenCountEnabled;
                        item.className = tokenCountEnabled ? 'text-success' : '';
                    }
                },
                {
                    text: 'Dual Pass',
                    icon: 'fas fa-layer-group',
                    action: 'toggleTwoStage',
                    keepMenuOpen: true,
                    loadfn: function (item, target) {
                        const fastModeEnabled = dynamicCarousel?.dataset.fastMode === 'true';
                        const twoStageEnabled = target.dataset.twoStage === 'true';
                        item.checked = twoStageEnabled;
                        item.className = twoStageEnabled ? 'text-success' : '';
                        // Disable 2 stage mode when fast mode is enabled
                        if (fastModeEnabled) {
                            item.disabled = true;
                        } else {
                            item.disabled = false;
                        }
                    }
                },
                {
                    text: 'Pass Pipeline Stage Preview',
                    icon: 'fas fa-layer-group',
                    keepMenuOpen: true,
                    action: 'togglePipelineAware',
                    loadfn: function (item, target) {
                        const pipelineAwareEnabled = target.dataset.pipelineAware === 'true';
                        item.checked = pipelineAwareEnabled;
                        item.className = pipelineAwareEnabled ? 'text-success' : '';
                        item.disabled = !(document.getElementById('pipelineStagesContainer')?.children?.length > 0);
                    }
                },
                {
                    text: 'Provide Initial Prompt Preview',
                    icon: 'fas fa-image-polaroid',
                    keepMenuOpen: true,
                    action: 'toggleInitialPromptAware',
                    loadfn: function (item, target) {
                        const initialPromptAwareEnabled = target.dataset.initialPromptAware === 'true';
                        item.checked = initialPromptAwareEnabled;
                        item.className = initialPromptAwareEnabled ? 'text-success' : '';
                    }
                }
            ]
        }]
    };

    // Creative button options
    const creativeMenuConfig = {
        sections: [{
            type: 'list',
            title: 'Creative Options',
            items: [
                {
                    text: 'Lock Subject',
                    icon: 'fas fa-lock',
                    action: 'toggleLockSubject',
                    keepMenuOpen: true,
                    loadfn: function (item, target) {
                        const lockSubjectEnabled = dynamicCarousel?.dataset.lockSubject === 'true';
                        item.checked = lockSubjectEnabled;
                        item.className = lockSubjectEnabled ? 'text-success' : '';
                    }
                },
                {
                    text: 'Adapt Clothing',
                    icon: 'fas fa-shirt',
                    action: 'toggleClothing',
                    keepMenuOpen: true,
                    loadfn: function (item, target) {
                        const toggleClothingEnabled = target.dataset.toggleClothing === 'true';
                        item.checked = toggleClothingEnabled;
                        item.className = toggleClothingEnabled ? 'text-success' : '';
                    }
                },
                {
                    text: 'Adapt Action Verbs',
                    icon: 'fa-regular fa-person-running',
                    action: 'toggleAction',
                    keepMenuOpen: true,
                    loadfn: function (item, target) {
                        const toggleActionEnabled = target.dataset.toggleAction === 'true';
                        item.checked = toggleActionEnabled;
                        item.className = toggleActionEnabled ? 'text-success' : '';
                    }
                },
                {
                    text: 'Seasonal Guidance',
                    icon: 'fas fa-snowflake',
                    action: 'toggleGuidance',
                    keepMenuOpen: true,
                    loadfn: function (item, target) {
                        const seasonBtn = document.getElementById('seasonBtn');
                        const seasonEnabled = seasonBtn?.dataset.state === 'on';
                        const guidanceEnabled = seasonBtn?.dataset.toggleGuidance === 'true';

                        // Disable if season is off
                        item.disabled = !seasonEnabled;
                        item.checked = guidanceEnabled;
                        item.className = guidanceEnabled ? 'text-success' : '';
                    }
                }
            ]
        }]
    };

    // Attach context menus to buttons
    contextMenu.attachToElement(document.getElementById('todBtn'), todMenuConfig);
    contextMenu.attachToElement(document.getElementById('weatherBtn'), weatherMenuConfig);
    contextMenu.attachToElement(document.getElementById('seasonBtn'), seasonMenuConfig);
    contextMenu.attachToElement(dynamicCarousel, lockMenuConfig);
    contextMenu.attachToElement(document.getElementById('creativeBtn'), creativeMenuConfig);
}

/** @returns {boolean} true when this domain handled the action */
function handleDynamicGenerationContextMenuAction(e) {
    const { action, target } = e.detail;
    const dynGenActions = new Set([
        'setTodOverride','setTodTimeOverride','setTodDateOverride','openTimeDateModal',
        'setWeatherOverride','openWeatherLocationModal','clearWeatherLocation','setCurrentLocation','setIPLocation',
        'setSeasonOverride','clearTodDateOverride','clearTodTimeOverride','showInspector','compileToPrompts',
        'clearCompiledPrompt','disableDynamicGeneration','toggleUseCache','toggleOptimize','toggleTokenCount',
        'toggleTwoStage','toggleLockSubject','toggleClothing','toggleAction','toggleObserveHoliday','toggleGuidance',
        'toggleWeatherForecast','setSeasonUseDate','togglePipelineAware','toggleInitialPromptAware','toggleFastMode',
        'toggleLockContext','toggleLockResults','toggleChainUpdates','toggleForceRefresh','toggleExpirePreview',
        'setCreativeDirectiveStrategy','setCreativeDirectiveToolPasses','setCreativeDirectiveDialogs',
        'disableCreativeDirectiveDialogs','setAiTemperature','clearAiTemperature'
    ]);
    if (!dynGenActions.has(action)) return false;

        if (action === 'setTodOverride') {
            setTodOverride(e.detail.item.value);
        } else if (action === 'setTodTimeOverride') {
            setTodTimeOverride(e.detail.item.value);
        } else if (action === 'setTodDateOverride') {
            setTodDateOverride(e.detail.item.value);
        } else if (action === 'openTimeDateModal') {
            openTimeDateModal();
        } else if (action === 'setWeatherOverride') {
            setDynamicOverride(document.getElementById('weatherBtn'), e.detail.item.value);
        } else if (action === 'openWeatherLocationModal') {
            openWeatherLocationModal();
        } else if (action === 'clearWeatherLocation') {
            clearWeatherLocation();
        } else if (action === 'setCurrentLocation') {
            setCurrentLocation();
        } else if (action === 'setIPLocation') {
            setIPLocation();
        } else if (action === 'setSeasonOverride') {
            setSeasonOverride(document.getElementById('seasonBtn'), e.detail.item.value);
        } else if (action === 'clearTodDateOverride') {
            const todBtn = document.getElementById('todBtn');
            const currentOverride = todBtn ? todBtn.getAttribute('data-override') : null;
    
            if (currentOverride && currentOverride.includes('_')) {
                const parts = currentOverride.split('_');
                const timePart = parts[0];
                if (timePart && timePart !== 'auto' && timePart !== 'true') {
                    setDynamicOverride(todBtn, timePart);
                } else {
                    todBtn.removeAttribute('data-override');
                }
            } else if (currentOverride && currentOverride.startsWith('auto_')) {
                todBtn.removeAttribute('data-override');
            }
            updateTodButtonIcon();
            updateDynamicGenerationToggleBtn();
            updatePromptStatusIcons();
            createDebouncedContextResolution();
        } else if (action === 'clearTodTimeOverride') {
            const todBtn = document.getElementById('todBtn');
            const currentOverride = todBtn ? todBtn.getAttribute('data-override') : null;
    
            if (currentOverride && currentOverride.includes('_')) {
                const parts = currentOverride.split('_');
                const datePart = parts[1];
                if (datePart) {
                    setDynamicOverride(todBtn, `auto_${datePart}`);
                } else {
                    todBtn.removeAttribute('data-override');
                }
            } else if (currentOverride && !currentOverride.includes('_')) {
                const timeNames = ['dawn', 'sunrise', 'morning', 'latemorning', 'daytime', 'afternoon', 'lateafternoon', 'goldenhour', 'evening', 'sunset', 'dusk', 'night', 'midnight'];
                const cleanTimeStr = currentOverride.startsWith('%') ? currentOverride.substring(1) : currentOverride;
                if (timeNames.includes(currentOverride) || /^\d{4}$/.test(cleanTimeStr)) {
                    todBtn.removeAttribute('data-override');
                }
            }
            updateTodButtonIcon();
            updateDynamicGenerationToggleBtn();
            updatePromptStatusIcons();
            createDebouncedContextResolution();
        } else if (action === 'showInspector') {
            // public/scripts/comp/featureLoader.js
            void featureLoader.loadFeature('compiled_prompt_inspector').then(() => showCompiledPromptModal());
        } else if (action === 'compileToPrompts') {
            // startCompileToPrompts: compileToPromptsApplet.js
            startCompileToPrompts();
        } else if (action === 'clearCompiledPrompt') {
            clearCompiledPrompt();
        } else if (action === 'disableDynamicGeneration') {
            // disableDynamicGeneration: public/scripts/comp/manualModalManager.js
            disableDynamicGeneration();
        } else if (action === 'toggleUseCache') {
            const currentUseCache = dynamicCarousel.getAttribute('data-use-cache') !== 'false';
            const newUseCache = !currentUseCache;
            dynamicCarousel.setAttribute('data-use-cache', newUseCache.toString());
            if (window.dynamicGenerationData) {
                window.dynamicGenerationData.use_cache_responses = newUseCache;
            }
            updateCarouselIndicators();
        } else if (action === 'toggleOptimize') {
            const optimizeEnabled = dynamicCarousel.dataset.optimizeEnabled === 'true';
            const newState = optimizeEnabled ? 'false' : 'true';
            dynamicCarousel.dataset.optimizeEnabled = newState;
        } else if (action === 'toggleTokenCount') {
            const tokenCountEnabled = dynamicCarousel.dataset.tokenCount === 'true';
            dynamicCarousel.dataset.tokenCount = tokenCountEnabled ? 'false' : 'true';
        } else if (action === 'toggleTwoStage') {
            const fastModeEnabled = dynamicCarousel.dataset.fastMode === 'true';
    
            // Prevent enabling 2 stage mode when fast mode is enabled
            if (fastModeEnabled) {
                return; // Do nothing if fast mode is enabled
            }
    
            const twoStageEnabled = dynamicCarousel.dataset.twoStage === 'true';
            dynamicCarousel.dataset.twoStage = twoStageEnabled ? 'false' : 'true';
        } else if (action === 'toggleLockSubject') {
            const lockSubjectEnabled = dynamicCarousel.dataset.lockSubject === 'true';
            dynamicCarousel.dataset.lockSubject = lockSubjectEnabled ? 'false' : 'true';
        } else if (action === 'toggleClothing') {
            const creativeBtn = document.getElementById('creativeBtn');
            const toggleClothingEnabled = creativeBtn.dataset.toggleClothing === 'true';
            creativeBtn.dataset.toggleClothing = toggleClothingEnabled ? 'false' : 'true';
        } else if (action === 'toggleAction') {
            const creativeBtn = document.getElementById('creativeBtn');
            const toggleActionEnabled = creativeBtn.dataset.toggleAction === 'true';
            creativeBtn.dataset.toggleAction = toggleActionEnabled ? 'false' : 'true';
        } else if (action === 'toggleObserveHoliday') {
            const seasonBtn = document.getElementById('seasonBtn');
            const observeHolidayEnabled = seasonBtn.dataset.toggleHoliday === 'true';
            seasonBtn.dataset.toggleHoliday = observeHolidayEnabled ? 'false' : 'true';
        } else if (action === 'toggleGuidance') {
            const seasonBtn = document.getElementById('seasonBtn');
            // Only allow toggle if season is enabled
            if (seasonBtn?.dataset.state === 'on') {
                const guidanceEnabled = seasonBtn.dataset.toggleGuidance === 'true';
                seasonBtn.dataset.toggleGuidance = guidanceEnabled ? 'false' : 'true';
            }
        } else if (action === 'toggleWeatherForecast') {
            const weatherBtn = document.getElementById('weatherBtn');
            const useForecast = weatherBtn?.getAttribute('data-override') === 'forecast';
            // Toggle forecast: set to 'forecast' if not set, clear if set
            if (useForecast) {
                weatherBtn.removeAttribute('data-override');
            } else {
                weatherBtn.setAttribute('data-override', 'forecast');
            }
            updateDynamicGenerationToggleBtn();
            updatePromptStatusIcons();
        } else if (action === 'setSeasonUseDate') {
            const seasonBtn = document.getElementById('seasonBtn');
            setSeasonOverride(seasonBtn, false);
        } else if (action === 'togglePipelineAware') {
            const pipelineAwareEnabled = dynamicCarousel.dataset.pipelineAware === 'true';
            dynamicCarousel.dataset.pipelineAware = pipelineAwareEnabled ? 'false' : 'true';
        } else if (action === 'toggleInitialPromptAware') {
            const initialPromptAwareEnabled = dynamicCarousel.dataset.initialPromptAware === 'true';
            dynamicCarousel.dataset.initialPromptAware = initialPromptAwareEnabled ? 'false' : 'true';
        } else if (action === 'toggleFastMode') {
            const fastModeEnabled = dynamicCarousel.dataset.fastMode === 'true';
            const newFastModeState = fastModeEnabled ? 'false' : 'true';
            dynamicCarousel.dataset.fastMode = newFastModeState;
            if (newFastModeState === 'true') {
                dynamicCarousel.dataset.twoStage = 'false';
            }
            updateCarouselIndicators();
        } else if (action === 'toggleLockContext') {
            const { contextLocked } = getDynamicGenerationLockState();
            setDynamicGenerationLockState({ contextLocked: !contextLocked });
        } else if (action === 'toggleLockResults') {
            const { cacheLocked } = getDynamicGenerationLockState();
            setDynamicGenerationLockState({ cacheLocked: !cacheLocked });
        } else if (action === 'toggleChainUpdates') {
            // Default to false (disabled) if not set
            const chainUpdatesEnabled = dynamicCarousel.dataset.chainUpdates === 'true';
            dynamicCarousel.dataset.chainUpdates = chainUpdatesEnabled ? 'false' : 'true';
        } else if (action === 'toggleForceRefresh') {
            const forceRefreshEnabled = dynamicCarousel.dataset.forceRefresh === 'true';
            dynamicCarousel.dataset.forceRefresh = forceRefreshEnabled ? 'false' : 'true';
        } else if (action === 'toggleExpirePreview') {
            const expirePreview = dynamicCarousel.dataset.expirePreview === 'true';
            dynamicCarousel.dataset.expirePreview = expirePreview ? 'false' : 'true';
        } else if (action === 'setCreativeDirectiveStrategy') {
            const value = e.detail.item.value;
            if (value === null || value === '') {
                dynamicCarousel.removeAttribute('data-creative-directive-strategy');
            } else {
                dynamicCarousel.dataset.creativeDirectiveStrategy = value;
            }
        } else if (action === 'setCreativeDirectiveToolPasses') {
            const value = e.detail.item.value;
            dynamicCarousel.dataset.creativeDirectiveToolPasses = value.toString();
        } else if (action === 'setCreativeDirectiveDialogs') {
            const value = e.detail.item.value;
            dynamicCarousel.dataset.creativeDirectiveDialogs = value.toString();
        } else if (action === 'disableCreativeDirectiveDialogs') {
            dynamicCarousel.removeAttribute('data-creative-directive-dialogs');
        } else if (action === 'setAiTemperature') {
            const value = e.detail.item.value;
            if (dynamicCarousel) {
                dynamicCarousel.dataset.aiTemperature = value.toString();
            }
        } else if (action === 'clearAiTemperature') {
            if (dynamicCarousel) {
                dynamicCarousel.removeAttribute('data-ai-temperature');
            }
        }
    return true;
}

function wireDynamicGenerationContextMenuActions() {
    if (dynamicGenContextMenuActionWired) return;
    dynamicGenContextMenuActionWired = true;
    document.addEventListener('contextMenuAction', (e) => {
        if (handleDynamicGenerationContextMenuAction(e)) {
            e.stopImmediatePropagation();
        }
    }, true);
}

let timeDateModalWired = false;
function wireTimeDateModalControls() {
    if (timeDateModalWired) return;
    timeDateModalWired = true;
        const closeTimeDateModalBtn = document.getElementById('closeTimeDateModalBtn');
        const saveTimeDateBtn = document.getElementById('saveTimeDateBtn');
    
        if (closeTimeDateModalBtn) {
            closeTimeDateModalBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const modal = document.getElementById('timeDateModal');
                closeModal(modal);
            });
        }
    
        if (saveTimeDateBtn) {
            saveTimeDateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                saveTimeDateModal();
            });
        }
}

let weatherLocationModalWired = false;
function wireWeatherLocationModalControls() {
    if (weatherLocationModalWired) return;
    weatherLocationModalWired = true;
        const weatherLocationModal = document.getElementById('weatherLocationModal');
        const closeWeatherLocationModalBtn = document.getElementById('closeWeatherLocationModalBtn');
        const verifyWeatherLocationBtn = document.getElementById('verifyWeatherLocationBtn');
        const saveWeatherLocationBtn = document.getElementById('saveWeatherLocationBtn');
        const weatherLocationInput = document.getElementById('weatherLocationInput');
    
        if (closeWeatherLocationModalBtn) {
            closeWeatherLocationModalBtn.addEventListener('click', (e) => {
                e.preventDefault();
                closeModal(weatherLocationModal);
            });
        }
    
        if (verifyWeatherLocationBtn) {
            verifyWeatherLocationBtn.addEventListener('click', (e) => {
                e.preventDefault();
                verifyWeatherLocation();
            });
        }
    
        if (saveWeatherLocationBtn) {
            saveWeatherLocationBtn.addEventListener('click', (e) => {
                e.preventDefault();
                saveWeatherLocation();
            });
        }
    
        if (weatherLocationInput) {
            weatherLocationInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    verifyWeatherLocation();
                }
            });
        }
}

let timeDateWheelWired = false;
function wireTimeDateWheelInputs() {
    if (timeDateWheelWired) return;
    timeDateWheelWired = true;
        const timeDateHour = document.getElementById('timeDateHour');
        const timeDateMinute = document.getElementById('timeDateMinute');
        const timeDateDay = document.getElementById('timeDateDay');
        const timeDateMonth = document.getElementById('timeDateMonth');
    
        if (timeDateHour) {
            timeDateHour.addEventListener('wheel', function (e) {
                const delta = e.deltaY > 0 ? -1 : 1;
                const currentValue = parseInt(this.value) || 12;
                const newValue = Math.max(0, Math.min(23, currentValue + delta));
                this.value = newValue;
            }, { passive: true });
        }
    
        if (timeDateMinute) {
            timeDateMinute.addEventListener('wheel', function (e) {
                const delta = e.deltaY > 0 ? -1 : 1;
                const currentValue = parseInt(this.value) || 0;
                const newValue = Math.max(0, Math.min(59, currentValue + delta));
                this.value = newValue;
            }, { passive: true });
        }
    
        if (timeDateDay) {
            timeDateDay.addEventListener('wheel', function (e) {
                const delta = e.deltaY > 0 ? -1 : 1;
                const currentValue = parseInt(this.value) || 15;
                const newValue = Math.max(1, Math.min(31, currentValue + delta));
                this.value = newValue;
            }, { passive: true });
        }
    
        if (timeDateMonth) {
            timeDateMonth.addEventListener('wheel', function (e) {
                const delta = e.deltaY > 0 ? -1 : 1;
                const currentValue = parseInt(this.value) || 6;
                const newValue = Math.max(1, Math.min(12, currentValue + delta));
                this.value = newValue;
            }, { passive: true });
        }
}

let dynamicGenerationButtonsWired = false;
function wireDynamicGenerationButtons() {
    if (dynamicGenerationButtonsWired) return;
    if (!dynamicGenerationToggleBtn) return;
    dynamicGenerationButtonsWired = true;
        dynamicGenerationToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const wasHidden = dynamicGenerationGroup.classList.contains('hidden');
            if (wasHidden) {
                dynamicGenerationGroup.classList.remove('hidden');
            } else {
                dynamicGenerationGroup.classList.add('hidden');
            }
            // Update the button state after toggling
            updateDynamicGenerationToggleBtn();
            // Refresh status icons after toggle (will automatically hide them if controls are visible)
            updatePromptStatusIcons();
            createDebouncedContextResolution();
        });
    
        // Rentan button click handlers
        // Buttons that affect carousel: todBtn, weatherBtn, seasonBtn, creativeBtn
        [todBtn, weatherBtn, seasonBtn, creativeBtn].forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const state = btn.dataset.state === 'on' ? 'off' : 'on';
                btn.dataset.state = state;
                btn.classList.toggle('active', state === 'on');
    
                // Clear override when turning off
                if (state === 'off') {
                    btn.removeAttribute('data-override');
                    btn.removeAttribute('data-location');
                    btn.removeAttribute('data-context-locked');
                    btn.removeAttribute('data-chain-updates');
                }
    
                // Update TOD button icon if this is the TOD button
                if (btn.id === 'todBtn') {
                    updateTodButtonIcon();
                }
    
                // Update status icons to reflect the button state change
                updatePromptStatusIcons();
    
                // Only reload context for buttons that affect the carousel
                const carouselButtons = ['todBtn', 'weatherBtn', 'seasonBtn', 'creativeBtn'];
                if (carouselButtons.includes(btn.id)) {
                    createDebouncedContextResolution();
                }
    
    
                // Toggle main creative directive row visibility when creative button changes
                if (btn.id === 'creativeBtn') {
                    // Update main creative directive visibility
                    updateCreativeDirectiveVisibility();
    
                    // Update all stage creative directive visibility
                    const stageItems = pipelineStagesContainer?.querySelectorAll('.pipeline-stage-item');
                    if (stageItems) {
                        stageItems.forEach(stageItem => {
                            updateStageCreativeDirectiveVisibility(stageItem.id);
                        });
                    }
    
                    updateAllTextOverlayPlaceholders();
                }
            });
        });
}

function wireCompiledPromptModalClose() {
    // Shared closeCompiledPromptBtn with compileToPromptsApplet.js (dataset.wired guard)
    const closeCompiledPromptBtn = document.getElementById('closeCompiledPromptBtn');
    if (!closeCompiledPromptBtn || closeCompiledPromptBtn.dataset.wired === 'true') return;
    closeCompiledPromptBtn.dataset.wired = 'true';
    closeCompiledPromptBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const modal = document.getElementById('compiledPromptModal');
        if (modal) {
            closeModal(modal);
        }
    });
}

let timeDateWeatherKeyboardWired = false;

function handleTimeDateModalKeydown(e) {
    const modal = document.getElementById('timeDateModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal(modal);
        return true;
    }

    if (e.key === 'Enter' && !modalKeyboardSkipPrimaryEnter(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        saveTimeDateModal();
        return true;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        const btn = document.getElementById('saveTimeDateBtn');
        if (btn && !btn.disabled) btn.click();
        return true;
    }
}

function handleWeatherLocationModalKeydown(e) {
    const modal = document.getElementById('weatherLocationModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal(modal);
        return true;
    }

    if (e.key === 'Enter' && !modalKeyboardSkipPrimaryEnter(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        verifyWeatherLocation();
        return true;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        const btn = document.getElementById('saveWeatherLocationBtn');
        if (btn && !btn.disabled) btn.click();
        return true;
    }
}

function wireTimeDateWeatherKeyboard() {
    if (timeDateWeatherKeyboardWired) return;
    timeDateWeatherKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'timeDateModal.keydown',
        handler: handleTimeDateModalKeydown,
        type: 'whenFocused',
        modalId: 'timeDateModal',
        priority: 78,
        critical: true,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'weatherLocationModal.keydown',
        handler: handleWeatherLocationModalKeydown,
        type: 'whenFocused',
        modalId: 'weatherLocationModal',
        priority: 78,
        critical: true,
        showInOverlay: false
    });
    registerModalOverlayEntries('timeDateModal', 'Rentan', [
        { id: 'overlay.timeDateModal.save', label: 'Save', keys: 'Ctrl+S', icon: 'fas fa-save' },
        { id: 'overlay.timeDateModal.close', label: 'Close', keys: 'Esc', icon: 'fas fa-times' }
    ]);
    registerModalOverlayEntries('weatherLocationModal', 'Rentan', [
        { id: 'overlay.weatherLocationModal.verify', label: 'Verify', keys: 'Enter', icon: 'fas fa-check' },
        { id: 'overlay.weatherLocationModal.save', label: 'Save', keys: 'Ctrl+S', icon: 'fas fa-save' },
        { id: 'overlay.weatherLocationModal.close', label: 'Close', keys: 'Esc', icon: 'fas fa-times' }
    ]);
}

function wireDynamicGenerationUI() {
    if (dynamicGenerationUIWired) return;
    dynamicGenerationUIWired = true;
    wireTimeDateModalControls();
    wireWeatherLocationModalControls();
    wireTimeDateWeatherKeyboard();
    wireTimeDateWheelInputs();
    wireDynamicGenerationButtons();
    wireCompiledPromptModalClose();
    setupDynamicGenerationContextMenus();
    initDynamicCarousel();
    wireDynamicGenerationContextMenuActions();
}

if (typeof wsClient !== 'undefined' && wsClient.registerInitStep) {
    wsClient.registerInitStep(85.1, 'Wiring Dynamic Generation UI', async () => {
        wireDynamicGenerationUI();
    });
}
