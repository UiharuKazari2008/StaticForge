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

        // Holiday clothing options - Updated to match enriched holiday data
        this.holidayClothing = {
            christmas: {
                fabrics: ['wool', 'cashmere', 'velvet', 'velour', 'fleece', 'flannel', 'knit', 'cable knit', 'tweed', 'tartan', 'plaid'],
                layers: ['wool sweater', 'cashmere sweater', 'velvet dress', 'velvet blazer', 'knit cardigan', 'turtleneck sweater', 'cozy sweater', 'warm coat', 'wool coat', 'dressy attire', 'formal pieces'],
                accessories: ['christmas jewelry', 'holiday jewelry', 'warm scarf', 'wool scarf', 'warm hat', 'beanie', 'gloves', 'mittens', 'warm boots', 'festive accessories', 'santa hat', 'christmas pins'],
                colors: ['red', 'green', 'gold', 'silver', 'white', 'crimson', 'emerald', 'deep blue', 'candlelight yellow', 'snow white'],
                effects: ['warm layers', 'cozy textures', 'festive styling', 'winter celebration', 'candlelit scenes']
            },
            halloween: {
                fabrics: ['costume fabric', 'themed fabric', 'dark fabric', 'mesh', 'lace', 'sheer', 'velvet', 'satin', 'silk'],
                layers: ['costume pieces', 'themed clothing', 'costume dress', 'costume top', 'costume bottom', 'themed outfit', 'spooky attire'],
                accessories: ['halloween jewelry', 'costume props', 'halloween accessories', 'masks', 'wigs', 'hats', 'gloves', 'boots', 'themed jewelry', 'spooky accessories'],
                colors: ['black', 'orange', 'purple', 'green', 'white', 'deep orange', 'midnight black', 'eerie purple', 'lime green', 'blood red', 'shadowy gray'],
                effects: ['spooky themes', 'costume styling', 'halloween atmosphere', 'dimly lit scenes', 'shadowy environments']
            },
            easter: {
                fabrics: ['cotton', 'linen', 'chiffon', 'organza', 'voile', 'batiste', 'lightweight', 'floral print', 'delicate'],
                layers: ['light dress', 'spring dress', 'floral dress', 'spring jacket', 'light cardigan', 'spring blouse', 'easter dress', 'spring attire'],
                accessories: ['floral accessories', 'spring jewelry', 'easter accessories', 'flower hair accessories', 'ribbon accessories', 'pastel jewelry', 'spring hat', 'light scarf'],
                colors: ['yellow', 'white', 'green', 'lavender', 'pink', 'soft blue', 'mint green', 'peach', 'butter yellow', 'spring green', 'purple', 'cream', 'light coral'],
                effects: ['spring freshness', 'floral themes', 'easter celebration', 'outdoor settings', 'spring scenes']
            },
            independence: {
                fabrics: ['cotton', 'linen', 'denim', 'summer fabric', 'breathable', 'lightweight'],
                layers: ['light clothing', 'summer attire', 'patriotic shirt', 'patriotic dress', 'summer dress', 't-shirt', 'shorts', 'patriotic pieces'],
                accessories: ['patriotic accessories', 'flag themed accessories', 'summer accessories', 'baseball cap', 'sun hat', 'sunglasses', 'patriotic jewelry', 'flag pins'],
                colors: ['red', 'white', 'blue', 'bright red', 'pure white', 'deep blue', 'gold accents'],
                effects: ['patriotic celebration', 'summer fun', 'outdoor celebrations', 'summer festivities']
            },
            valentines: {
                fabrics: ['silk', 'satin', 'lace', 'chiffon', 'velvet', 'romantic fabric', 'elegant fabric', 'delicate', 'dressy'],
                layers: ['dressy clothing', 'romantic dress', 'elegant dress', 'romantic attire', 'elegant blouse', 'dressy top', 'elegant pieces'],
                accessories: ['romantic jewelry', 'heart themed jewelry', 'elegant accessories', 'romantic accessories', 'heart pins', 'romantic flowers', 'elegant scarf'],
                colors: ['red', 'pink', 'white', 'gold', 'silver', 'deep rose', 'blush pink', 'creamy white', 'crimson', 'cherry red', 'rose gold'],
                effects: ['romantic styling', 'elegant sophistication', 'candlelit scenes', 'romantic settings']
            },
            // Additional holiday mappings for better coverage
            newyears: {
                fabrics: ['wool', 'cashmere', 'velvet', 'silk', 'satin', 'sequins', 'metallic', 'shiny', 'elegant'],
                layers: ['cozy sweater', 'dressy attire', 'formal pieces', 'evening wear', 'party dress', 'elegant dress', 'formal suit', 'evening gown'],
                accessories: ['sparkly jewelry', 'festive accessories', 'warm accessories', 'sparkly accessories', 'party accessories', 'elegant jewelry', 'champagne accessories'],
                colors: ['gold', 'silver', 'white', 'black', 'bright yellow', 'shimmering silver', 'midnight blue', 'vibrant purple', 'electric blue', 'neon highlights'],
                effects: ['party atmosphere', 'fireworks displays', 'crowded celebrations', 'evening scenes']
            },
            thanksgiving: {
                fabrics: ['wool', 'cashmere', 'flannel', 'corduroy', 'tweed', 'warm fabric', 'cozy fabric'],
                layers: ['cozy sweater', 'warm cardigan', 'flannel shirt', 'warm layers', 'dressy attire', 'warm dress', 'autumn attire'],
                accessories: ['warm scarf', 'warm hat', 'warm accessories', 'autumn accessories', 'warm boots', 'cozy accessories'],
                colors: ['orange', 'brown', 'yellow', 'gold', 'deep red', 'burgundy', 'amber', 'rust', 'sienna', 'cream', 'harvest orange', 'autumn brown', 'golden yellow'],
                effects: ['warm layers', 'cozy textures', 'candlelit rooms', 'family dining scenes', 'harvest scenes']
            },
            // Japanese holidays
            chinesenewyear: {
                fabrics: ['silk', 'satin', 'brocade', 'traditional fabric', 'festive fabric', 'elegant'],
                layers: ['traditional dress', 'festive attire', 'elegant clothing', 'traditional clothing', 'celebration attire'],
                accessories: ['red accessories', 'gold accessories', 'traditional jewelry', 'festive accessories', 'red envelope accessories', 'lantern accessories'],
                colors: ['red', 'gold', 'black', 'jade green', 'bright crimson', 'gold', 'deep black', 'emerald green', 'warm yellow', 'metallic gold'],
                effects: ['lantern-lit scenes', 'parade scenes', 'crowded celebrations']
            },
            setsubun: {
                fabrics: ['cotton', 'traditional fabric', 'comfortable'],
                layers: ['traditional clothing', 'comfortable attire', 'home celebration attire'],
                accessories: ['traditional accessories', 'ritual accessories'],
                colors: ['red', 'white', 'gold', 'deep red', 'warm white', 'golden yellow', 'wood brown'],
                effects: ['indoor celebrations', 'family gatherings']
            },
            hinamatsuri: {
                fabrics: ['silk', 'chiffon', 'delicate', 'elegant', 'spring fabric'],
                layers: ['elegant dress', 'spring dress', 'traditional dress', 'dressy attire', 'elegant clothing'],
                accessories: ['elegant jewelry', 'spring accessories', 'floral accessories', 'traditional accessories'],
                colors: ['pink', 'white', 'gold', 'sakura pink', 'pure white', 'warm gold', 'deep black', 'spring green', 'lavender'],
                effects: ['indoor displays', 'spring scenes', 'doll displays']
            },
            summerfestival: {
                fabrics: ['cotton', 'linen', 'yukata fabric', 'lightweight', 'breathable'],
                layers: ['yukata', 'summer dress', 'light clothing', 'festival attire', 'summer attire'],
                accessories: ['festival accessories', 'summer accessories', 'yukata accessories', 'festival jewelry'],
                colors: ['navy', 'indigo', 'lantern gold', 'white', 'vibrant colors'],
                effects: ['outdoor evening scenes', 'crowded festivals', 'firework displays']
            },
            japanesenewyear: {
                fabrics: ['silk', 'traditional fabric', 'elegant', 'formal'],
                layers: ['traditional dress', 'formal attire', 'elegant clothing', 'kimono', 'traditional clothing'],
                accessories: ['traditional accessories', 'formal accessories', 'elegant jewelry', 'traditional jewelry'],
                colors: ['red', 'white', 'gold', 'black', 'wood brown'],
                effects: ['shrine visits', 'family gatherings', 'early morning scenes']
            },
            cherryblossom: {
                fabrics: ['cotton', 'chiffon', 'lightweight', 'delicate', 'spring fabric'],
                layers: ['spring dress', 'light dress', 'spring attire', 'picnic attire', 'casual dress'],
                accessories: ['spring accessories', 'floral accessories', 'picnic accessories', 'light accessories'],
                colors: ['pink', 'white', 'sakura pink', 'cherry blossom pink', 'soft white', 'spring green', 'lavender'],
                effects: ['outdoor picnic scenes', 'petal-filled scenes', 'spring scenes']
            },
            starfestival: {
                fabrics: ['cotton', 'lightweight', 'summer fabric'],
                layers: ['summer dress', 'light clothing', 'festival attire', 'summer attire'],
                accessories: ['festival accessories', 'summer accessories', 'star themed accessories'],
                colors: ['blue', 'gold', 'red', 'white', 'deep blue', 'golden yellow', 'vibrant red', 'pure white', 'purple', 'summer sky blue'],
                effects: ['outdoor evening scenes', 'starry nights', 'warm summer nights']
            },
            goldenweek: {
                fabrics: ['cotton', 'comfortable', 'travel fabric'],
                layers: ['comfortable clothing', 'travel attire', 'casual clothing', 'outdoor attire'],
                accessories: ['travel accessories', 'comfortable accessories', 'outdoor accessories'],
                colors: ['red', 'white', 'gold', 'green', 'spring green'],
                effects: ['travel scenes', 'outdoor activities', 'family gatherings']
            },
            childrensday: {
                fabrics: ['cotton', 'comfortable', 'playful'],
                layers: ['comfortable clothing', 'casual attire', 'playful clothing'],
                accessories: ['playful accessories', 'colorful accessories', 'child-friendly accessories'],
                colors: ['blue', 'white', 'red', 'gold', 'vibrant blue', 'pure white', 'bright red', 'warm gold', 'spring green'],
                effects: ['outdoor displays', 'family celebrations']
            },
            midautumnfestival: {
                fabrics: ['silk', 'elegant', 'traditional fabric'],
                layers: ['elegant dress', 'traditional dress', 'formal attire', 'elegant clothing'],
                accessories: ['elegant accessories', 'traditional accessories', 'moon themed accessories'],
                colors: ['white', 'silver', 'gold', 'moonlit white', 'silvery gray', 'warm gold', 'deep indigo', 'autumn orange', 'harvest gold'],
                effects: ['outdoor evening scenes', 'harvest scenes', 'lantern-lit scenes']
            },
            obonfestival: {
                fabrics: ['cotton', 'traditional fabric', 'comfortable'],
                layers: ['traditional dress', 'comfortable clothing', 'festival attire', 'yukata'],
                accessories: ['traditional accessories', 'festival accessories', 'lantern accessories'],
                colors: ['white', 'gold', 'red', 'purple', 'pure white', 'warm gold', 'deep red', 'purple', 'lantern glow'],
                effects: ['outdoor evening scenes', 'lantern-lit scenes', 'community gatherings']
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
                    'Christmas': 'christmas',
                    'New Year\'s': 'newyears',
                    'Halloween': 'halloween',
                    'Thanksgiving': 'thanksgiving',
                    'Independence Day': 'independence',
                    'Valentine\'s Day': 'valentines',
                    'Easter': 'easter',
                    'Chinese New Year': 'chinesenewyear',
                    'Setsubun': 'setsubun',
                    'Hinamatsuri': 'hinamatsuri',
                    'Summer Festival': 'summerfestival',
                    'Japanese New Year': 'japanesenewyear',
                    'Cherry Blossom': 'cherryblossom',
                    'Star Festival': 'starfestival',
                    'Tanabata': 'starfestival',
                    'Golden Week': 'goldenweek',
                    'Children\'s Day': 'childrensday',
                    'Mid-Autumn Festival': 'midautumnfestival',
                    'Obon Festival': 'obonfestival'
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
