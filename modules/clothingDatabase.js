// Comprehensive Clothing Database for Dynamic Selection
// Provides weather, seasonal, and holiday-appropriate clothing options

class ClothingDatabase {
    constructor() {
        this.initializeDatabase();
        this.usedOptions = new Set(); // Track used options for diversity
        this.rotationCounter = 0; // Counter for rotation
    }

    initializeDatabase() {
        // Temperature-based clothing options
        this.temperatureClothing = {
            hot: {
                fabrics: ['cotton', 'linen', 'bamboo', 'modal', 'viscose', 'chiffon', 'organza', 'gauze', 'mesh', 'perforated', 'breathable', 'ventilated', 'lightweight', 'moisture-wicking', 'dri-fit', 'coolmax', 'athletic mesh', 'seersucker', 'eyelet', 'crochet', 'lace', 'sheer', 'transparent', 'airy', 'flowing'],
                layers: ['single layer', 'minimal layers', 'light cardigan', 'vest', 'tank top', 'camisole', 'shell top', 'crop top', 'halter top', 'tube top', 'bandeau', 'bikini top', 'sports bra', 'bralette'],
                accessories: ['wide-brimmed hat', 'sun hat', 'baseball cap', 'visor', 'sunglasses', 'UV protection', 'light scarf', 'bandana', 'headband', 'hair tie', 'sun visor', 'beach hat', 'straw hat', 'fedora', 'bucket hat'],
                colors: ['white', 'cream', 'ivory', 'beige', 'light blue', 'sky blue', 'powder blue', 'mint green', 'pale yellow', 'lemon', 'pastel pink', 'lavender', 'light coral', 'peach', 'champagne', 'bright', 'reflective', 'metallic', 'shimmer'],
                effects: ['sweat-soaked', 'damp clothing', 'heat stress', 'moisture-wicking', 'cooling', 'perspiration', 'glowing', 'dewy', 'humid', 'sticky', 'clinging', 'wet patches']
            },
            moderate: {
                fabrics: ['cotton blend', 'merino wool', 'cashmere', 'alpaca', 'angora', 'softshell', 'stretch', 'jersey', 'knit', 'ribbed', 'cable knit', 'turtleneck', 'polo', 'henley', 'long-sleeve', 'versatile', 'breathable', 'comfortable', 'easy-care', 'wrinkle-resistant'],
                layers: ['base layer', 'mid layer', 'outer shell', 'cardigan', 'light jacket', 'blazer', 'sweater', 'pullover', 'hoodie', 'zip-up', 'vest', 'shirt', 'blouse', 'tunic', 'dress'],
                accessories: ['versatile scarf', 'light hat', 'comfortable shoes', 'sneakers', 'loafers', 'ankle boots', 'ballet flats', 'mules', 'sandals', 'belt', 'watch', 'bracelet', 'necklace'],
                colors: ['neutral', 'earth tones', 'versatile', 'classic', 'navy', 'gray', 'beige', 'brown', 'olive', 'burgundy', 'maroon', 'camel', 'tan', 'khaki', 'stone', 'charcoal'],
                effects: ['comfortable', 'breathable', 'adaptive', 'versatile', 'practical', 'functional', 'stylish', 'polished', 'clean', 'fresh']
            },
            cold: {
                fabrics: ['wool', 'fleece', 'down', 'thermal', 'insulated', 'thick', 'quilted', 'padded', 'flannel', 'corduroy', 'tweed', 'tartan', 'plaid', 'cable knit', 'chunky knit', 'ribbed', 'turtleneck', 'mock neck', 'high neck', 'cowl neck', 'sweater', 'pullover', 'cardigan', 'blazer', 'coat', 'jacket', 'parka', 'anorak', 'windbreaker', 'raincoat', 'trench coat', 'pea coat', 'duffle coat', 'overcoat', 'topcoat', 'suit jacket', 'sports jacket', 'bomber jacket', 'denim jacket', 'leather jacket', 'suede jacket', 'fur coat', 'faux fur', 'shearling', 'sherpa', 'polar fleece', 'microfleece', 'base layer', 'long johns', 'leggings', 'tights', 'pantyhose', 'stockings', 'socks', 'thick socks', 'wool socks', 'thermal socks', 'boot socks', 'knee-high socks', 'jeggings', 'skinny jeans', 'straight jeans', 'bootcut jeans', 'wide-leg jeans', 'cargo pants', 'trousers', 'dress pants', 'slacks', 'chinos', 'khakis', 'corduroy pants', 'wool pants', 'fleece pants', 'sweatpants', 'joggers', 'track pants', 'yoga pants'],
                layers: ['thermal base layer', 'wool sweater', 'insulated jacket', 'heavy coat', 'down jacket', 'puffer jacket', 'quilted jacket', 'bomber jacket', 'parka', 'anorak', 'windbreaker', 'raincoat', 'trench coat', 'pea coat', 'duffle coat', 'overcoat', 'topcoat', 'blazer', 'suit jacket', 'sports jacket', 'denim jacket', 'leather jacket', 'suede jacket', 'fur coat', 'faux fur', 'shearling', 'sherpa', 'fleece', 'polar fleece', 'microfleece', 'thermal', 'base layer', 'long johns', 'leggings', 'tights', 'pantyhose', 'stockings', 'socks', 'thick socks', 'wool socks', 'thermal socks', 'boot socks', 'knee-high socks'],
                accessories: ['gloves', 'mittens', 'fingerless gloves', 'touchscreen gloves', 'leather gloves', 'wool gloves', 'fleece gloves', 'thermal gloves', 'scarf', 'infinity scarf', 'pashmina', 'wrap', 'shawl', 'stole', 'cowl', 'neck warmer', 'gaiter', 'balaclava', 'face mask', 'neck gaiter', 'hat', 'beanie', 'knit cap', 'watch cap', 'stocking cap', 'toboggan', 'ear muffs', 'ear warmers', 'headband', 'ear band', 'ear warmer', 'insulated boots', 'snow boots', 'winter boots', 'hiking boots', 'ankle boots', 'knee-high boots', 'thigh-high boots', 'over-the-knee boots', 'combat boots', 'work boots', 'steel-toe boots', 'safety boots', 'trail boots', 'approach shoes', 'approach boots', 'approach sneakers'],
                colors: ['dark', 'warm', 'rich', 'neutral', 'black', 'navy', 'charcoal', 'brown', 'burgundy', 'maroon', 'forest green', 'hunter green', 'olive', 'camel', 'tan', 'beige', 'cream', 'ivory', 'white', 'gray', 'silver', 'metallic', 'shimmer', 'glitter', 'sparkle'],
                effects: ['frost on fabric', 'shivering', 'cold protection', 'warm layers', 'insulated', 'cozy', 'snug', 'warm', 'toasty', 'comfortable', 'protective', 'shielded', 'covered', 'bundled up', 'layered', 'wrapped up']
            }
        };

        // Weather condition clothing options
        this.weatherClothing = {
            rain: {
                fabrics: ['waterproof', 'water-resistant', 'rain-repellent', 'sealed seams', 'Gore-Tex', 'eVent', 'DWR coating', 'polyester', 'nylon', 'PVC', 'rubber', 'vinyl', 'oilskin', 'waxed cotton', 'treated canvas', 'quick-dry', 'moisture-wicking', 'breathable', 'ventilated'],
                layers: ['rain jacket', 'waterproof pants', 'hooded coat', 'rain poncho', 'trench coat', 'anorak', 'shell jacket', 'rain suit', 'waterproof overalls', 'rain cape', 'waterproof vest', 'rain skirt', 'waterproof dress', 'rain shorts', 'waterproof leggings'],
                accessories: ['umbrella', 'rain boots', 'waterproof hat', 'rain gear', 'galoshes', 'rubber boots', 'waterproof gloves', 'rain cover', 'waterproof bag', 'dry bag', 'rain poncho', 'waterproof phone case', 'rain hood', 'waterproof watch', 'rain scarf'],
                colors: ['bright', 'high-visibility', 'reflective', 'yellow', 'orange', 'lime green', 'neon', 'fluorescent', 'striped', 'checkered', 'polka dot', 'solid', 'transparent', 'clear', 'translucent'],
                effects: ['wet appearance', 'dripping water', 'rain protection', 'water-resistant fabric', 'beading water', 'soaked', 'drenched', 'puddled', 'splashed', 'waterlogged', 'damp', 'moist', 'humid', 'steamy', 'foggy']
            },
            wind: {
                fabrics: ['wind-resistant', 'secure', 'fitted', 'elastic', 'stretchy', 'form-fitting', 'compression', 'tight', 'snug', 'close-fitting', 'body-hugging', 'streamlined', 'aerodynamic', 'smooth', 'sleek', 'taut', 'tapered', 'narrow', 'slim'],
                layers: ['windbreaker', 'zipped jacket', 'secured clothing', 'wind jacket', 'shell', 'wind vest', 'wind pants', 'wind shorts', 'wind skirt', 'wind dress', 'wind shirt', 'wind blouse', 'wind sweater', 'wind cardigan', 'wind hoodie'],
                accessories: ['hair tie', 'hat', 'scarf', 'headband', 'hair clip', 'bobby pins', 'hair band', 'ponytail holder', 'barrette', 'head wrap', 'turban', 'bandana', 'buff', 'neck gaiter', 'face mask'],
                colors: ['stable', 'secure', 'neutral', 'solid', 'dark', 'light', 'bright', 'bold', 'vibrant', 'muted', 'subtle', 'earthy', 'natural', 'classic', 'timeless'],
                effects: ['clothes billowing', 'hair whipping', 'fabric movement', 'wind-blown appearance', 'flapping', 'fluttering', 'swaying', 'dancing', 'waving', 'undulating', 'rippling', 'streaming', 'flowing', 'flying', 'tossing']
            },
            snow: {
                fabrics: ['insulated', 'thermal', 'down', 'fleece', 'warm', 'quilted', 'padded', 'thick', 'heavy', 'bulky', 'chunky', 'knit', 'wool', 'cashmere', 'alpaca', 'angora', 'sherpa', 'faux fur', 'shearling', 'flannel', 'flannel-lined'],
                layers: ['snow pants', 'insulated jacket', 'thermal underwear', 'snow suit', 'snow overalls', 'snow dress', 'snow skirt', 'snow shorts', 'snow vest', 'snow hoodie', 'snow sweater', 'snow cardigan', 'snow blouse', 'snow shirt', 'snow tunic'],
                accessories: ['face mask', 'goggles', 'ear protection', 'warm gloves', 'traction boots', 'snow goggles', 'ski mask', 'balaclava', 'neck gaiter', 'ear muffs', 'ear warmers', 'headband', 'beanie', 'knit cap', 'snow boots'],
                colors: ['bright', 'high-visibility', 'reflective', 'white', 'silver', 'metallic', 'shiny', 'glossy', 'matte', 'satin', 'pearl', 'ivory', 'cream', 'off-white', 'snow white'],
                effects: ['frost on fabric', 'cold protection', 'warm layers', 'insulated', 'snow-covered', 'frosted', 'icy', 'frozen', 'crystallized', 'sparkling', 'glittering', 'shimmering', 'glistening', 'dazzling', 'brilliant']
            },
            sun: {
                fabrics: ['UPF-rated', 'UV-blocking', 'protective', 'lightweight', 'breathable', 'ventilated', 'mesh', 'perforated', 'airy', 'flowing', 'sheer', 'transparent', 'translucent', 'gauze', 'chiffon', 'organza', 'voile', 'batiste', 'lawn', 'cambric'],
                layers: ['long sleeves', 'protective clothing', 'sun shirt', 'sun dress', 'sun pants', 'sun skirt', 'sun shorts', 'sun vest', 'sun hoodie', 'sun sweater', 'sun cardigan', 'sun blouse', 'sun tunic', 'sun cover-up', 'sun wrap'],
                accessories: ['sunglasses', 'wide-brimmed hat', 'UV protection', 'sun hat', 'baseball cap', 'visor', 'sun visor', 'beach hat', 'straw hat', 'fedora', 'bucket hat', 'sun umbrella', 'parasol', 'sun screen', 'UV lotion'],
                colors: ['light', 'reflective', 'protective', 'white', 'cream', 'ivory', 'beige', 'tan', 'sand', 'khaki', 'camel', 'nude', 'neutral', 'pastel', 'soft'],
                effects: ['sun protection', 'UV blocking', 'sun hat', 'sunglasses', 'sun-kissed', 'tanned', 'bronzed', 'glowing', 'radiant', 'luminous', 'bright', 'shining', 'sparkling', 'dazzling', 'brilliant']
            }
        };

        // Seasonal clothing options
        this.seasonalClothing = {
            spring: {
                fabrics: ['cotton', 'lightweight', 'breathable', 'floral'],
                layers: ['light jacket', 'cardigan', 'spring layers'],
                accessories: ['light scarf', 'comfortable shoes', 'umbrella'],
                colors: ['pastel', 'spring colors', 'floral patterns', 'light hues'],
                effects: ['spring freshness', 'light and airy', 'floral prints']
            },
            summer: {
                fabrics: ['cotton', 'linen', 'mesh', 'ventilated', 'lightweight'],
                layers: ['single layer', 'minimal layers', 'tank tops'],
                accessories: ['sun hat', 'sunglasses', 'sandals', 'summer accessories'],
                colors: ['light', 'white', 'pastels', 'bright summer tones'],
                effects: ['summer comfort', 'light and cool', 'summer styling']
            },
            autumn: {
                fabrics: ['cotton blend', 'wool', 'flannel', 'cozy'],
                layers: ['cardigan', 'light jacket', 'vest', 'transitional layers'],
                accessories: ['warm scarf', 'comfortable boots', 'autumn accessories'],
                colors: ['earth tones', 'warm colors', 'autumn palette', 'rich hues'],
                effects: ['autumn warmth', 'cozy fabrics', 'plaid patterns']
            },
            winter: {
                fabrics: ['wool', 'down', 'fleece', 'thermal', 'insulated'],
                layers: ['heavy coat', 'wool layers', 'thermal underwear', 'insulated clothing'],
                accessories: ['gloves', 'scarf', 'hat', 'boots', 'warm accessories'],
                colors: ['dark', 'winter palette', 'neutral tones', 'rich dark hues'],
                effects: ['winter warmth', 'cozy textures', 'warm materials']
            }
        };

        // Holiday clothing options
        this.holidayClothing = {
            christmas: {
                fabrics: ['wool', 'cashmere', 'velvet', 'festive'],
                layers: ['cozy sweaters', 'dressy attire', 'formal pieces'],
                accessories: ['holiday jewelry', 'festive accessories', 'warm accessories'],
                colors: ['red', 'green', 'gold', 'silver', 'holiday colors'],
                effects: ['holiday warmth', 'festive styling', 'winter celebration']
            },
            halloween: {
                fabrics: ['costume', 'themed', 'dark', 'spooky'],
                layers: ['costume pieces', 'themed clothing'],
                accessories: ['themed jewelry', 'costume props', 'halloween accessories'],
                colors: ['black', 'orange', 'purple', 'dark tones', 'spooky colors'],
                effects: ['spooky themes', 'costume styling', 'halloween atmosphere']
            },
            easter: {
                fabrics: ['light', 'floral', 'spring', 'delicate'],
                layers: ['light dresses', 'spring jackets', 'easter attire'],
                accessories: ['floral accessories', 'spring jewelry', 'easter accessories'],
                colors: ['pastel', 'spring colors', 'easter colors', 'floral tones'],
                effects: ['spring freshness', 'floral themes', 'easter celebration']
            },
            independence: {
                fabrics: ['cotton', 'patriotic', 'summer', 'comfortable'],
                layers: ['light clothing', 'summer attire', 'patriotic pieces'],
                accessories: ['patriotic accessories', 'flag themes', 'summer accessories'],
                colors: ['red', 'white', 'blue', 'patriotic patterns', 'flag colors'],
                effects: ['patriotic celebration', 'summer fun', 'independence day']
            },
            valentines: {
                fabrics: ['romantic', 'elegant', 'delicate', 'dressy'],
                layers: ['dressy clothing', 'romantic attire', 'elegant pieces'],
                accessories: ['romantic jewelry', 'heart themes', 'elegant accessories'],
                colors: ['red', 'pink', 'white', 'romantic tones', 'love themes'],
                effects: ['romantic styling', 'elegant sophistication', 'valentine celebration']
            },
            // Additional holiday mappings for better coverage
            newyears: {
                fabrics: ['wool', 'cashmere', 'velvet', 'festive', 'elegant'],
                layers: ['cozy sweaters', 'dressy attire', 'formal pieces', 'evening wear'],
                accessories: ['holiday jewelry', 'festive accessories', 'warm accessories', 'sparkly accessories'],
                colors: ['red', 'green', 'gold', 'silver', 'holiday colors', 'sparkly'],
                effects: ['holiday warmth', 'festive styling', 'new year celebration', 'elegant sophistication']
            },
            thanksgiving: {
                fabrics: ['wool', 'cashmere', 'velvet', 'festive', 'warm'],
                layers: ['cozy sweaters', 'dressy attire', 'formal pieces', 'warm layers'],
                accessories: ['holiday jewelry', 'festive accessories', 'warm accessories'],
                colors: ['red', 'green', 'gold', 'silver', 'holiday colors', 'autumn tones'],
                effects: ['holiday warmth', 'festive styling', 'thanksgiving celebration', 'autumn coziness']
            }
        };

        // Time-of-day clothing options
        this.timeClothing = {
            morning: {
                fabrics: ['comfortable', 'easy-care', 'practical'],
                layers: ['light jacket', 'cardigan', 'morning layers'],
                accessories: ['comfortable shoes', 'practical accessories'],
                colors: ['casual', 'comfortable', 'practical'],
                effects: ['morning comfort', 'casual styling', 'practical pieces']
            },
            daytime: {
                fabrics: ['functional', 'durable', 'practical'],
                layers: ['daytime appropriate', 'functional layers'],
                accessories: ['practical accessories', 'daytime appropriate'],
                colors: ['practical', 'functional', 'daytime appropriate'],
                effects: ['daytime functionality', 'practical styling', 'daytime comfort']
            },
            evening: {
                fabrics: ['elegant', 'formal', 'dressy'],
                layers: ['evening attire', 'formal pieces', 'elegant layers'],
                accessories: ['evening jewelry', 'formal accessories', 'elegant pieces'],
                colors: ['elegant', 'formal', 'evening appropriate'],
                effects: ['evening elegance', 'formal sophistication', 'evening styling']
            },
            night: {
                fabrics: ['comfortable', 'soft', 'relaxed'],
                layers: ['night comfort', 'relaxed fit', 'comfortable layers'],
                accessories: ['comfortable accessories', 'night comfort'],
                colors: ['comfortable', 'relaxed', 'night appropriate'],
                effects: ['night comfort', 'relaxed styling', 'nighttime comfort']
            }
        };

        // Activity-based clothing options
        this.activityClothing = {
            active: {
                fabrics: ['moisture-wicking', 'stretch', 'breathable', 'athletic'],
                layers: ['athletic wear', 'performance layers', 'sports bra'],
                accessories: ['sports accessories', 'athletic shoes', 'performance gear'],
                colors: ['athletic', 'performance', 'sports'],
                effects: ['sweat effects', 'damp clothing', 'athletic performance']
            },
            professional: {
                fabrics: ['business', 'formal', 'professional', 'structured'],
                layers: ['business suit', 'professional attire', 'formal pieces'],
                accessories: ['tie', 'briefcase', 'professional accessories', 'business shoes'],
                colors: ['professional', 'business', 'formal'],
                effects: ['professional appearance', 'business styling', 'formal sophistication']
            },
            casual: {
                fabrics: ['comfortable', 'soft', 'relaxed', 'easy-care'],
                layers: ['casual wear', 'comfortable layers', 'relaxed fit'],
                accessories: ['casual accessories', 'comfortable shoes', 'relaxed styling'],
                colors: ['casual', 'comfortable', 'relaxed'],
                effects: ['casual comfort', 'relaxed styling', 'casual materials']
            }
        };
    }

    // Get clothing options based on multiple factors
    // Accepts full context object or transformed object
    getClothingOptions(context) {
        // Extract values from context object if needed
        const temperature = context.temperature || context.weather?.temperature;
        const weather = context.weather || (context.weather?.condition ? context.weather : null);
        const season = context.season?.name || null;
        const holiday = context.season?.holiday?.primaryHoliday?.name || null;
        const timeOfDay = context.timeOfDay || context.timePeriod?.timeOfDay;
        const activity = context.activity;
        const location = context.location;
        
        const ctx = { temperature, weather, season, holiday, timeOfDay, activity, location };
        const options = {
            fabrics: [],
            layers: [],
            accessories: [],
            colors: [],
            effects: []
        };

        // Temperature-based options
        if (ctx.temperature) {
            const tempCategory = this.getTemperatureCategory(ctx.temperature);
            if (this.temperatureClothing[tempCategory]) {
                const tempOptions = this.temperatureClothing[tempCategory];
                options.fabrics.push(...tempOptions.fabrics);
                options.layers.push(...tempOptions.layers);
                options.accessories.push(...tempOptions.accessories);
                options.colors.push(...tempOptions.colors);
                options.effects.push(...tempOptions.effects);
            }
        }

        // Weather condition options
        if (ctx.weather) {
            const weatherCategory = this.getWeatherCategory(ctx.weather);
            if (this.weatherClothing[weatherCategory]) {
                const weatherOptions = this.weatherClothing[weatherCategory];
                options.fabrics.push(...weatherOptions.fabrics);
                options.layers.push(...weatherOptions.layers);
                options.accessories.push(...weatherOptions.accessories);
                options.colors.push(...weatherOptions.colors);
                options.effects.push(...weatherOptions.effects);
            }
        }

        // Seasonal options
        if (ctx.season) {
            const seasonCategory = ctx.season.toLowerCase();
            if (seasonCategory && this.seasonalClothing[seasonCategory]) {
                const seasonOptions = this.seasonalClothing[seasonCategory];
                options.fabrics.push(...seasonOptions.fabrics);
                options.layers.push(...seasonOptions.layers);
                options.accessories.push(...seasonOptions.accessories);
                options.colors.push(...seasonOptions.colors);
                options.effects.push(...seasonOptions.effects);
            }
        }

        // Holiday options - map holiday names to clothing database keys
        if (ctx.holiday) {
            const holidayName = typeof ctx.holiday === 'string' ? ctx.holiday : ctx.holiday?.name;
            if (holidayName) {
                // Map holiday names to clothing database keys
                const holidayMapping = {
                    'Christmas/Holiday Season': 'christmas',
                    'New Year\'s Celebration': 'christmas',
                    'Halloween': 'halloween',
                    'Thanksgiving': 'christmas',
                    'Independence Day': 'independence',
                    'Valentine\'s Day': 'valentines',
                    'Easter/Spring Holiday': 'easter',
                    'Chinese New Year': 'christmas',
                    'Setsubun': 'independence',
                    'Hinamatsuri': 'easter',
                    'Summer Festival': 'independence',
                    'Japanese New Year (Oshogatsu)': 'christmas',
                    'Cherry Blossom Season (Hanami)': 'easter',
                    'Star Festival (Tanabata)': 'valentines',
                    'Golden Week (Shukujitsu)': 'independence',
                    'Children\'s Day (Kodomo no Hi)': 'easter',
                    'Mid-Autumn Festival (Tsukimi)': 'easter',
                    'Obon Festival (Bon Odori)': 'easter'
                };
                const holidayCategory = (holidayMapping[holidayName] || holidayName.toLowerCase()).toLowerCase();
                if (this.holidayClothing[holidayCategory]) {
                    const holidayOptions = this.holidayClothing[holidayCategory];
                    options.fabrics.push(...holidayOptions.fabrics);
                    options.layers.push(...holidayOptions.layers);
                    options.accessories.push(...holidayOptions.accessories);
                    options.colors.push(...holidayOptions.colors);
                    options.effects.push(...holidayOptions.effects);
                }
            }
        }

        // Time-of-day options
        if (ctx.timeOfDay) {
            const timeCategory = ctx.timeOfDay.toLowerCase();
            if (this.timeClothing[timeCategory]) {
                const timeOptions = this.timeClothing[timeCategory];
                options.fabrics.push(...timeOptions.fabrics);
                options.layers.push(...timeOptions.layers);
                options.accessories.push(...timeOptions.accessories);
                options.colors.push(...timeOptions.colors);
                options.effects.push(...timeOptions.effects);
            }
        }

        // Activity options
        if (ctx.activity) {
            const activityCategory = ctx.activity.toLowerCase();
            if (this.activityClothing[activityCategory]) {
                const activityOptions = this.activityClothing[activityCategory];
                options.fabrics.push(...activityOptions.fabrics);
                options.layers.push(...activityOptions.layers);
                options.accessories.push(...activityOptions.accessories);
                options.colors.push(...activityOptions.colors);
                options.effects.push(...activityOptions.effects);
            }
        }

        // Remove duplicates and return
        return {
            fabrics: [...new Set(options.fabrics)],
            layers: [...new Set(options.layers)],
            accessories: [...new Set(options.accessories)],
            colors: [...new Set(options.colors)],
            effects: [...new Set(options.effects)]
        };
    }

    // Get temperature category based on temperature value
    getTemperatureCategory(temperature) {
        if (temperature >= 25) return 'hot';
        if (temperature <= 5) return 'cold';
        return 'moderate';
    }

    // Get weather category based on weather condition
    getWeatherCategory(weather) {
        const condition = weather.condition ? weather.condition.toLowerCase() : '';
        const precipitation = weather.precipitation || 0;
        const windSpeed = weather.windSpeed || 0;
        const uvIndex = weather.uvIndex || 0;

        if (condition.includes('rain') || precipitation > 0) return 'rain';
        if (condition.includes('snow') || condition.includes('ice')) return 'snow';
        if (windSpeed >= 20) return 'wind';
        if (uvIndex >= 6 || condition.includes('sun')) return 'sun';
        
        return 'clear';
    }

    // Get random clothing option from a category with diversity tracking
    getRandomOption(options, category, usedOptions = []) {
        if (!options[category] || options[category].length === 0) return null;
        
        // Filter out recently used options to ensure diversity
        const availableOptions = options[category].filter(option => !usedOptions.includes(option));
        const optionsToChooseFrom = availableOptions.length > 0 ? availableOptions : options[category];
        
        const randomIndex = Math.floor(Math.random() * optionsToChooseFrom.length);
        return optionsToChooseFrom[randomIndex];
    }

    // Get multiple random options from a category with diversity
    getRandomOptions(options, category, count = 1, usedOptions = []) {
        if (!options[category] || options[category].length === 0) return [];
        
        // Filter out recently used options to ensure diversity
        const availableOptions = options[category].filter(option => !usedOptions.includes(option));
        const optionsToChooseFrom = availableOptions.length > 0 ? availableOptions : options[category];
        
        const shuffled = [...optionsToChooseFrom].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, Math.min(count, optionsToChooseFrom.length));
    }

    // Generate dynamic clothing suggestions based on context
    generateClothingSuggestions(context) {
        const options = this.getClothingOptions(context);
        const suggestions = [];

        // Generate fabric suggestions with diversity
        const fabricOptions = this.getDiverseOptions(options, 'fabrics', 3);
        fabricOptions.forEach(fabric => {
            suggestions.push({
                type: 'fabric',
                value: fabric,
                context: 'fabric replacement'
            });
        });

        // Generate layer suggestions with diversity
        const layerOptions = this.getDiverseOptions(options, 'layers', 2);
        layerOptions.forEach(layer => {
            suggestions.push({
                type: 'layer',
                value: layer,
                context: 'layer addition'
            });
        });

        // Generate accessory suggestions with diversity
        const accessoryOptions = this.getDiverseOptions(options, 'accessories', 2);
        accessoryOptions.forEach(accessory => {
            suggestions.push({
                type: 'accessory',
                value: accessory,
                context: 'accessory addition'
            });
        });

        // Generate color suggestions with diversity
        const colorOptions = this.getDiverseOptions(options, 'colors', 2);
        colorOptions.forEach(color => {
            suggestions.push({
                type: 'color',
                value: color,
                context: 'color adaptation'
            });
        });

        // Generate effect suggestions with diversity
        const effectOptions = this.getDiverseOptions(options, 'effects', 2);
        effectOptions.forEach(effect => {
            suggestions.push({
                type: 'effect',
                value: effect,
                context: 'weather effect'
            });
        });

        return suggestions;
    }

    // Get specific clothing recommendations for a context
    getClothingRecommendations(context) {
        const options = this.getClothingOptions(context);
        const recommendations = {
            primary: {
                fabric: this.getRandomOption(options, 'fabrics'),
                layer: this.getRandomOption(options, 'layers'),
                accessory: this.getRandomOption(options, 'accessories')
            },
            secondary: {
                fabric: this.getRandomOption(options, 'fabrics'),
                layer: this.getRandomOption(options, 'layers'),
                accessory: this.getRandomOption(options, 'accessories')
            },
            colors: this.getRandomOptions(options, 'colors', 3),
            effects: this.getRandomOptions(options, 'effects', 2)
        };

        return recommendations;
    }

    // Generate contextual clothing examples for AI guidance
    generateContextualExamples(context) {
        const options = this.getClothingOptions(context);
        const examples = [];

        // Generate fabric replacement examples
        const fabricOptions = this.getRandomOptions(options, 'fabrics', 3);
        fabricOptions.forEach(fabric => {
            examples.push({
                type: 'fabric_replacement',
                original: 'cotton shirt',
                replacement: `${fabric} shirt`,
                context: 'weather-appropriate fabric'
            });
        });

        // Generate layer addition examples
        const layerOptions = this.getRandomOptions(options, 'layers', 2);
        layerOptions.forEach(layer => {
            examples.push({
                type: 'layer_addition',
                original: 't-shirt',
                replacement: `t-shirt, ${layer}`,
                context: 'temperature adaptation'
            });
        });

        // Generate accessory examples
        const accessoryOptions = this.getRandomOptions(options, 'accessories', 2);
        accessoryOptions.forEach(accessory => {
            examples.push({
                type: 'accessory_addition',
                original: 'casual outfit',
                replacement: `casual outfit, ${accessory}`,
                context: 'weather protection'
            });
        });

        // Generate color examples
        const colorOptions = this.getRandomOptions(options, 'colors', 2);
        colorOptions.forEach(color => {
            examples.push({
                type: 'color_adaptation',
                original: 'blue dress',
                replacement: `${color} dress`,
                context: 'seasonal color palette'
            });
        });

        // Generate effect examples
        const effectOptions = this.getRandomOptions(options, 'effects', 2);
        effectOptions.forEach(effect => {
            examples.push({
                type: 'effect_addition',
                original: 'dry clothing',
                replacement: `${effect} clothing`,
                context: 'weather effects'
            });
        });

        return examples;
    }

    // Get intelligent clothing combinations based on context
    getIntelligentCombinations(context) {
        const options = this.getClothingOptions(context);
        const combinations = [];

        // Generate 3-5 intelligent combinations
        for (let i = 0; i < 5; i++) {
            const combination = {
                name: `Combination ${i + 1}`,
                fabric: this.getRandomOption(options, 'fabrics'),
                layer: this.getRandomOption(options, 'layers'),
                accessory: this.getRandomOption(options, 'accessories'),
                color: this.getRandomOption(options, 'colors'),
                effect: this.getRandomOption(options, 'effects'),
                context: this.getContextualDescription(context)
            };
            combinations.push(combination);
        }

        return combinations;
    }

    // Get contextual description for combinations
    getContextualDescription(context) {
        const descriptions = [];
        
        // Extract values from context object if needed
        const temperature = context.temperature || context.weather?.temperature;
        const weather = context.weather || (context.weather?.condition ? context.weather : null);
        const season = context.season?.name || null;
        const holiday = context.season?.holiday?.primaryHoliday?.name || null;
        const timeOfDay = context.timeOfDay || context.timePeriod?.timeOfDay;
        const activity = context.activity;
        
        if (temperature >= 25) descriptions.push('hot weather');
        else if (temperature <= 5) descriptions.push('cold weather');
        else if (temperature) descriptions.push('moderate weather');

        if (weather?.condition) {
            const condition = weather.condition.toLowerCase();
            if (condition.includes('rain')) descriptions.push('rainy conditions');
            if (condition.includes('wind')) descriptions.push('windy conditions');
            if (condition.includes('snow')) descriptions.push('snowy conditions');
            if (condition.includes('sun')) descriptions.push('sunny conditions');
        }

        if (season) {
            descriptions.push(`${season} season`);
        }
        if (holiday) {
            const holidayName = typeof holiday === 'string' ? holiday : holiday?.name;
            if (holidayName) descriptions.push(`${holidayName} celebration`);
        }
        if (timeOfDay) descriptions.push(`${timeOfDay} time`);
        if (activity) descriptions.push(`${activity} activity`);

        return descriptions.join(', ');
    }

    // Reset used options to ensure diversity
    resetUsedOptions() {
        this.usedOptions.clear();
        this.rotationCounter = 0;
    }

    // Add option to used list for diversity tracking
    addToUsedOptions(option) {
        this.usedOptions.add(option);
        this.rotationCounter++;
        
        // Reset if we've used too many options (prevent memory buildup)
        if (this.rotationCounter > 100) {
            this.resetUsedOptions();
        }
    }

    // Get diverse clothing options with rotation
    getDiverseOptions(options, category, count = 1) {
        const usedArray = Array.from(this.usedOptions);
        const diverseOptions = this.getRandomOptions(options, category, count, usedArray);
        
        // Add selected options to used list
        diverseOptions.forEach(option => this.addToUsedOptions(option));
        
        return diverseOptions;
    }

    // Get all clothing data in a single call
    getAllClothingData(context) {
        return {
            options: this.getClothingOptions(context),
            recommendations: this.getClothingRecommendations(context),
            suggestions: this.generateClothingSuggestions(context),
            examples: this.generateContextualExamples(context),
            combinations: this.getIntelligentCombinations(context)
        };
    }
}

module.exports = ClothingDatabase;
