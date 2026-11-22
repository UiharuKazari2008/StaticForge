'use strict';

/**
 * Program Icons: the words sent to the models (Yozora #773; rebuilt Nov 22 2026 for repeatable results).
 *
 * The old prompt gave the image model the whole job in one request (choose a concept, read the brand
 * from the launcher icon, draw it in the style) and asked each new attempt for "a clearly different
 * design", so a good icon was a lucky draw. Now every decision is made before the image model is asked:
 *
 *   1. briefPrompt()   a vision model reads the program's icon and answers a small JSON brief: what the
 *                      subject is (geometry in plain words), its colours, the launcher tile's colour.
 *   2. normaliseBrief() code, not a model, picks the treatment from that brief (the same answer every
 *                      time): character | object | mark, and for a mark that is only white on a coloured
 *                      tile, the cut-out rule (drawn in the tile's colour, standing free).
 *   3. renderPrompt()  one fixed text per style ('wm' = the phone's Windows Mobile icon, 'vista' = the
 *                      desktop's) with the brief's values in fixed places. The same brief feeds both
 *                      styles, so the phone and the desktop show the same design.
 *   4. styleRefs()     three of the platform's own icons of the same kind of subject go with each request
 *                      as rendering references (ROM art and Vista's own files, never our generated ones:
 *                      gloss compounds when the model learns from its own output).
 *   5. checkMaster()   the drawing is measured (cut off at the canvas edge, a launcher tile behind the
 *                      subject) before it is accepted; wmProgramIcons draws again when it fails.
 *
 * Tested Nov 22 2026 on gpt-image-2.5-sunburst: 8 programs x 2 styles x 2 draws gave the same design
 * in every pair where the brief's treatment was right; the misses (a white symbol left white, a tile
 * that came back) were all treatment decisions, which is why step 2 is code.
 *
 * Period design (Yukimi, Nov 22 2026: glossy copies of today's glyphs "look too modern"): a symbol or
 * a wordmark is not drawn as the icon. The brief designs the icon the program would have had in
 * 2007-2009 instead: one object of that time that says what the program does, in the brand's colours,
 * with the brand's symbol as a small badge on it. The object is not the model's idea either: a second
 * small call answers only a row number of PERIOD_OBJECTS (periodPrompt), and the row's fixed words are
 * the object (withPeriod). One call that both described the icon and designed the object was tried
 * first and was not repeatable (it named the "N" as the object, changed its mind between runs). A
 * program no row fits, a character and an icon that already is a real thing keep their own treatment.
 * The symbol itself as a glossy emblem for every mark: config wmProgramIcons.design 'mark'.
 *
 * Wording rules that held up (keep them when editing):
 *   - say what is there, in the order subject / rendering / framing / references; no list of things
 *     not to draw (naming a glass orb or a rounded square brings one in);
 *   - one view, one material, one light per style, stated once;
 *   - every reference image gets one job ("outline and colours" or "rendering"), stated with its position;
 *   - nothing left to choose: no "or", no "for example", no request for variety.
 */

const collapse = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

const ARCHETYPES = ['character', 'object', 'mark'];

/**
 * The request for the brief. opts: { category, description, characters (false = Simple mode: a game's
 * emblem or one object, never a figure), direction (the user's own words for a Custom request) }.
 */
// What a 2007-2009 icon shows for each kind of program. The classifier call answers a row number only
// (periodPrompt / parsePeriod); the object's words are fixed here, so every program of a kind gets the same
// object and they differ by colour and badge, as the era's own icon sets do. New rows go at the end of their
// group; the order is the tie-break (the first row that fits). tint: the one part that takes the brand's main
// colour (every other part keeps its natural material); badgeAt: where the brand's emblem sits
// (onTint: the emblem sits on that coloured part, so a one-colour emblem is white there). Both are fixed
// so the phone's drawing and the desktop's agree (left open, two draws put the emblem in different corners and
// coloured different parts).
const PERIOD_OBJECTS = [
    { use: 'chat, messaging, a community', object: 'Two overlapping speech balloons, the front one larger and lower, each with a short pointed tail, facing the viewer', tint: 'both balloons', badgeAt: 'centred on the front balloon', onTint: true },
    { use: 'e-mail', object: 'A paper envelope seen from the front with its flap open and the top of a letter showing', tint: "the letter's edge band and the envelope's inner lining", badgeAt: 'centred on the letter' },
    { use: 'phone calls, voice chat', object: 'A telephone handset standing at a slant, earpiece at the upper left, mouthpiece at the lower right', tint: 'the whole handset', badgeAt: "on the middle of the handset's grip", onTint: true },
    { use: 'video calls, live streaming by people', object: 'A small round webcam with a glass lens on a short folding stand', tint: "the webcam's body shell", badgeAt: 'on the body under the lens', onTint: true },
    { use: 'films and series, video streaming, anime', object: 'A metal film reel with five round holes, standing upright, a strip of cine film with sprocket holes curling off its right side', tint: 'the strip of cine film', badgeAt: "on the reel's round centre hub" },
    { use: 'television, live channels', object: 'A flat television set of the 2000s with a wide bezel on a low stand, the screen lit', tint: "the television's screen", badgeAt: 'centred on the screen', onTint: true },
    { use: 'music streaming, a music player', object: 'A compact disc standing upright with a pair of beamed eighth notes in front of its lower right', tint: 'the eighth notes', badgeAt: "on the disc's upper left" },
    { use: 'radio', object: 'A portable radio with a round speaker grille, a tuning dial and a telescopic antenna raised at the upper right', tint: "the radio's body", badgeAt: 'on the body beside the dial', onTint: true },
    { use: 'recognising or identifying music', object: 'A compact disc standing upright with a magnifying glass over its lower right, handle pointing down and right', tint: "the magnifying glass's rim and handle", badgeAt: 'inside the lens' },
    { use: 'podcasts, voice recording', object: 'A studio microphone with a rounded mesh head on a small desk stand', tint: "the microphone's body under the mesh head", badgeAt: 'on the body band', onTint: true },
    { use: 'photos, a gallery, a camera app', object: 'A compact digital camera seen from the front with a large round lens and a small flash window', tint: "the camera's front panel", badgeAt: 'on the front panel at the upper left', onTint: true },
    { use: 'drawing, painting, image editing, image generation, an art community', object: "An artist's wooden palette with dabs of paint and a brush lying across it", tint: 'the brush handle and the largest dab of paint', badgeAt: "on the palette's open area" },
    { use: 'maps, navigation, places', object: 'A paper map folded in three panels lying at a slight angle, with a round-headed map pin standing in it', tint: "the map pin's head", badgeAt: "on the map pin's head", onTint: true },
    { use: 'driving, traffic, a car companion', object: 'A car key with a remote fob that has two buttons, lying at a slant', tint: "the fob's body", badgeAt: 'on the fob above the buttons', onTint: true },
    { use: 'weather', object: 'A sun partly hidden behind a rounded cloud', tint: "the cloud's shaded underside", badgeAt: 'on the cloud' },
    { use: 'a web browser', object: 'A globe showing continents, tilted slightly', tint: 'the oceans of the globe', badgeAt: "on a small round plate at the globe's lower right" },
    { use: 'search', object: 'A magnifying glass with a round lens, handle pointing down and right', tint: "the magnifying glass's rim and handle", badgeAt: 'inside the lens' },
    { use: 'an AI assistant, a chatbot', object: 'One speech balloon with a short tail at the lower left and a four-point spark set in its middle', tint: 'the whole balloon', badgeAt: "at the balloon's lower right, beside the spark", onTint: true },
    { use: 'shopping, a store, a marketplace', object: 'A paper shopping bag with two cord handles, seen from the front', tint: 'the whole bag', badgeAt: "centred on the bag's front", onTint: true },
    { use: 'food ordering, a restaurant', object: 'A paper take-away bag with a folded-over top, seen from the front', tint: "a wide band across the bag's front", badgeAt: 'centred on that band', onTint: true },
    { use: 'banking, payments, a wallet', object: 'A folded leather wallet with a payment card standing out of its top', tint: 'the payment card', badgeAt: "on the wallet's front, lower right" },
    { use: 'tickets, events, parking', object: 'Two paper admission tickets with notched ends, fanned one over the other', tint: 'the front ticket', badgeAt: 'centred on the front ticket', onTint: true },
    { use: 'notes, writing, documents', object: 'A sheet of paper with a folded top-right corner and ruled lines, a pencil lying across its lower right', tint: "the pencil's barrel and the paper's folded corner", badgeAt: "at the paper's top left, like a letterhead" },
    { use: 'spreadsheets, data', object: 'A sheet of paper with a folded top-right corner carrying a grid of cells', tint: "the grid's header row and first column", badgeAt: "at the paper's top left, like a letterhead" },
    { use: 'reading, comics, books', object: 'An open book lying flat, pages fanned, seen from slightly above', tint: "the book's cover edges and ribbon marker", badgeAt: 'on the left page' },
    { use: 'news', object: 'A folded newspaper with a headline block and columns', tint: 'the headline block', badgeAt: 'on the headline block' },
    { use: 'files, cloud storage', object: 'A manila folder, slightly open, with papers showing at the top', tint: "a tab label on the folder's front", badgeAt: "on the folder's front, lower right" },
    { use: 'code, developer tools, a terminal', object: 'A program window with a title bar and several lines of text', tint: "the window's title bar", badgeAt: "on a small round plate at the window's lower right" },
    { use: 'passwords, authentication, security', object: 'A closed padlock with a key leaning against its lower right', tint: "the padlock's body", badgeAt: "centred on the padlock's body", onTint: true },
    { use: 'a VPN, private networking', object: 'A globe with a closed padlock in front of its lower right', tint: "the padlock's body", badgeAt: "centred on the padlock's body", onTint: true },
    { use: 'networking, Wi-Fi, a router tool', object: 'A wireless router lying flat with two antennas raised and a row of small lights', tint: "the router's body", badgeAt: "on the router's front face", onTint: true },
    { use: 'internet speed, a benchmark, diagnostics', object: 'A round analogue dial gauge with tick marks around its upper half and a needle pointing up and right', tint: "the gauge's face", badgeAt: "on the gauge's face under the needle's pivot", onTint: true },
    { use: 'remote desktop, screen sharing', object: 'A flat monitor on its stand, the screen lit, with a second smaller screen overlapping its lower right', tint: "the monitor's screen", badgeAt: 'centred on the front screen', onTint: true },
    { use: 'smart home, home automation', object: 'A small house with a pitched roof, a door and one window', tint: 'the walls of the house', badgeAt: 'on the wall beside the door', onTint: true },
    { use: 'headphones, earbuds or speakers companion', object: 'A pair of over-ear headphones seen from the front', tint: "the ear cups' outer shells", badgeAt: 'on the nearer ear cup', onTint: true },
    { use: 'a printer or 3D printer companion', object: 'A desktop printer with a sheet of paper coming out of its front', tint: "the printer's top panel", badgeAt: "on the printer's front, upper left" },
    { use: 'social network, a feed, sharing with followers', object: 'A bust of a person in front of a second, paler bust, like two contacts', tint: 'the front bust', badgeAt: "on the front bust's chest", onTint: true },
    { use: 'a game with no character', object: 'A game pad with a directional cross on the left and four round buttons on the right', tint: "the game pad's body", badgeAt: 'between the cross and the buttons', onTint: true },
    { use: 'system tools, settings, utilities', object: 'A metal toolbox with a handle, closed', tint: "the toolbox's body", badgeAt: "centred on the toolbox's front", onTint: true }
];

/** The classifier's text: which row of PERIOD_OBJECTS fits this program. */
function periodPrompt(name, opts = {}) {
    return [
        `Which kind of program is the Android app "${collapse(name)}"?${collapse(opts.category) ? ` Store category: ${collapse(opts.category)}.` : ''}${collapse(opts.description) ? ` Store description: ${collapse(opts.description).slice(0, 500)}` : ''}`,
        'Answer with the number of the FIRST line below that fits what the program is mainly for, or 0 when none fits. JSON only: {"row": <number>}',
        ...PERIOD_OBJECTS.map((r, i) => `${i + 1}. ${r.use}`)
    ].join('\n');
}

/** The classifier's answer as a row of PERIOD_OBJECTS, null for "none fits", undefined when it is not an answer. */
function parsePeriod(raw) {
    const n = raw && typeof raw === 'object' ? Number(raw.row) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > PERIOD_OBJECTS.length) return undefined;
    return n === 0 ? null : PERIOD_OBJECTS[n - 1];
}

/**
 * The brief of a mark as its period design: the row's object, the brand's own symbol (the brief's subject) as
 * the small emblem on it. A brief that is a character or already a real object is left as it is.
 */
function withPeriod(brief, row) {
    if (!brief || brief.archetype !== 'mark' || !row) return brief;
    return { ...brief, object: row.object, badge: brief.subject, tint: row.tint || '', badgeAt: row.badgeAt || '', onTint: row.onTint === true };
}

function briefPrompt(name, opts = {}) {
    const characters = opts.characters !== false;
    const direction = collapse(opts.direction);
    return [
        `You are writing the drawing brief for an icon artist who has never seen this app. Attached: the current icon(s) of the Android app "${collapse(name)}"${collapse(opts.category) ? ` (category: ${collapse(opts.category)})` : ''}.${collapse(opts.description) ? ` Store description: ${collapse(opts.description).slice(0, 400)}` : ''}`,
        'The coloured square, rounded square or circle that fills the icon edge to edge is the launcher tile. It is not part of the design; describe only what sits on it.',
        direction ? `The user requires this for the new icon; the brief follows it over the current icon wherever they differ: ${direction}` : '',
        'Answer with one JSON object, no other text:',
        '{',
        ' "archetype": choose the FIRST rule that fits:',
        characters
            ? '   "character" - the picture is an illustration of a person or creature, shaded like a painting, a cartoon or anime art (a flat one- or two-colour face or mascot symbol is NOT this: it is a "mark");'
            : '   (this icon may not show a person or a creature: for a game, describe its emblem, or the ONE object the game is best known for)',
        '   "object" - the picture is a recognisable real-world thing (a traffic cone, a camera, a map, a folder, a gauge) rather than an abstract symbol;',
        '   "mark" - anything else: an abstract symbol, a letter or a short word,',
        ' "subject": at most 45 words. The exact geometry of what to draw: each shape, how many, where, which way it points, proportions. Shape only: no colour words here (colours go in "colours"). Plain physical words; never the words "logo", "icon", "tile" or the app\'s name. For "character": hair, eyes, headwear, expression, clothing at the shoulders,',
        ' "colours": up to four of {"part": "...", "hex": "#rrggbb"}: the colours of the subject itself (not the tile), sampled from the picture, most important first,',
        ' "tile": the launcher tile\'s colour as "#rrggbb" (the darker end if it is a gradient), or "" when the picture has no tile,',
        ' "lettering": the exact characters that are part of the symbol itself, else "",',
        ' "drop": things in the picture that are not the app\'s own symbol (publisher or studio badge, event or anniversary banner, corner ribbon, background scene), else ""',
        '}'
    ].filter(Boolean).join('\n');
}

const rgb = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(collapse(h));
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
};
const hex = (h) => { const v = rgb(h); return v ? `#${v.map((n) => n.toString(16).padStart(2, '0')).join('')}` : ''; };
const pale = (h) => { const v = rgb(h); return !!v && Math.min(...v) >= 190 && Math.max(...v) - Math.min(...v) <= 48; };
const near = (a, b) => { const x = rgb(a); const y = rgb(b); return !!x && !!y && Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 48; };

/**
 * The model's answer as the fixed brief the prompts use, or null when it is not one. The treatment is
 * decided here:
 *   - colours: the subject's own, without the tile's (briefs often list the tile showing through holes);
 *   - a "character" with no colour of its own (a white mascot silhouette) is a mark;
 *   - cutout: a mark that is only white or one pale colour on a coloured tile exists only as a hole in
 *     that tile. Windows Mobile and Vista icons stand free with no tile, so it is drawn in the tile's
 *     colour instead (the way the brand prints it on white).
 */
function normaliseBrief(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const subject = collapse(raw.subject).replace(/[.\s]+$/, '').slice(0, 420);
    if (!subject) return null;
    const tile = hex(raw.tile);
    const colours = (Array.isArray(raw.colours) ? raw.colours : [])
        .map((c) => ({ part: collapse(c && c.part).slice(0, 60), hex: hex(c && c.hex) }))
        .filter((c) => c.hex && !(tile && near(c.hex, tile)))
        .slice(0, 4);
    let archetype = ARCHETYPES.includes(raw.archetype) ? raw.archetype : 'mark';
    const flat = colours.length === 0 || colours.every((c) => pale(c.hex));
    if (archetype === 'character' && flat) archetype = 'mark';
    const cutout = archetype === 'mark' && !!tile && !pale(tile) && flat;
    return {
        archetype,
        cutout,
        object: '',
        badge: '',
        subject,
        colours,
        tile,
        lettering: collapse(raw.lettering).slice(0, 24),
        drop: collapse(raw.drop).slice(0, 200)
    };
}

// The platform's own icons, by the kind of subject, as rendering references (paths under public/static_images).
// Windows Mobile: the 6.5 ROM's Start icons at 180 px, the largest real Windows Mobile art there is.
const STYLE_REFS = {
    wm: {
        mark: ['wm65/start-ie@4x.png', 'wm65/start-winlive@4x.png', 'wm65/start-wmp@4x.png'],
        object: ['wm65/start-camera@4x.png', 'wm65/start-calc@4x.png', 'wm65/start-games@4x.png'],
        character: ['wm65/start-messenger@4x.png', 'wm65/start-contacts@4x.png', 'wm65/start-winlive@4x.png']
    },
    vista: {
        mark: ['app_icons/vista-iexplore.png', 'app_icons/vista-messenger.png', 'app_icons/vista-favorites.png'],
        object: ['app_icons/vista-calculator.png', 'app_icons/vista-sound.png', 'app_icons/vista-mouse.png'],
        character: ['app_icons/vista-messenger.png', 'app_icons/vista-user-accounts.png', 'app_icons/vista-chess.png']
    }
};
const STYLES = Object.keys(STYLE_REFS);
/** brief: the normalised brief (or an archetype name). A mark drawn as a period object takes the objects' references. */
const kindOf = (brief) => (brief && typeof brief === 'object' ? (brief.object ? 'object' : brief.archetype) : brief);
const styleRefs = (style, brief) => (STYLE_REFS[style] || STYLE_REFS.wm)[kindOf(brief)] || (STYLE_REFS[style] || STYLE_REFS.wm).mark;

const colourList = (brief) => brief.colours.map((c) => `${c.part} ${c.hex}`.trim()).join(', ');

function subjectLine(brief, hasBrandRef) {
    const s = brief.subject;
    const lettering = brief.lettering ? ` The only lettering is "${brief.lettering}", as part of the shape.` : ' No lettering.';
    const colours = colourList(brief);
    const slab = `${hasBrandRef ? 'Same outline and proportions as reference image 1. ' : ''}It is a slab of glossy enamel seen straight from the front: no side walls show, depth appears only as a narrow bevel along the rim.`;
    if (brief.object) {
        // the brand shows as colour, and as one small emblem at most: the object is the icon
        const body = brief.cutout ? brief.tile : (brief.colours[0] && brief.colours[0].hex) || '';
        const rest = brief.cutout ? '' : brief.colours.slice(1).map((c) => c.hex).join(', ');
// the emblem keeps the brand's own colours, except where it would vanish: one colour on the part that
        // already has that colour is white
        const own = brief.colours.map((c) => c.hex).join(', ');
const badgeColour = brief.onTint
            ? (brief.cutout || brief.colours.length < 2 ? 'white' : `in its own colours (${own})`)
            : (brief.cutout ? `in ${brief.tile}` : own ? `in its own colours (${own})` : 'white');
        const reading = brief.lettering ? ` It reads "${brief.lettering}".` : '';
const where = brief.badgeAt || 'on its front';
        const coloured = brief.tint
            ? ` Exactly one part carries the brand's colour: ${brief.tint}, in ${body}${rest ? ` (with ${rest} as small accents on that same part)` : ''}. Every other part keeps the natural tones of its material: silver metal, black or grey plastic, cream paper, clear glass.`
            : ` Its main colour is ${body}${rest ? `, with ${rest} as accents` : ''}; parts that are paper, metal or glass keep their natural silver, cream and clear tones.`;
        return `${brief.object}. One real object of the 2000s, drawn as a product photograph would show it.${body ? coloured : ''}${brief.badge ? ` One small raised emblem, ${badgeColour}, sits ${where}, no wider than a third of the object, and nowhere else: ${brief.badge}.${reading}` : ''} No lettering${brief.badge ? ' beyond that emblem' : ''}.`;
    }
    if (brief.archetype === 'object') return `${s}. One real object, drawn as a product photograph would show it${colours ? `, in these colours: ${colours}` : ''}.${lettering}`;
    if (brief.archetype === 'character') return `A head-and-shoulders bust of one character: ${s}.${colours ? ` Colours: ${colours}.` : ''} The bust ends at the shoulders in its own soft outline; nothing frames it.${lettering}`;
    if (brief.cutout) return `A solid emblem cut to this exact outline: ${s}. The whole emblem is one colour, ${brief.tile}: ${hasBrandRef ? `in reference image 1 this shape is pale on a ${brief.tile} background, and here that is reversed, so ` : ''}the shape itself is ${brief.tile} and stands alone; openings inside the shape are see-through. ${slab}${lettering}`;
    return `A solid emblem cut to this exact outline: ${s}.${colours ? ` Colours: ${colours}.` : ''} ${slab}${lettering}`;
}

/**
 * The image request's text. style 'wm' | 'vista'; opts: { brandRefs (how many pictures of the program
 * come first: 0 or more; image 1 is the one the outline is taken from), userRefs (how many of those
 * are pictures the user attached), styleCount (platform icons attached last), direction }.
 */
function renderPrompt(style, name, brief, opts = {}) {
    const vista = style === 'vista';
    const brandRefs = Math.max(0, Number(opts.brandRefs) || 0);
    const userRefs = Math.max(0, Math.min(brandRefs, Number(opts.userRefs) || 0));
    const styleCount = Math.max(0, Number(opts.styleCount) || 0);
    const direction = collapse(opts.direction);
    const platform = vista ? 'Windows Vista' : 'Windows Mobile 6.5';
    const lines = [
        vista
            ? `A Windows Vista application icon for the program "${collapse(name)}": original 2007 Microsoft Aero-style icon art, a small photorealistic glossy object on nothing.`
            : `A Windows Mobile 6.5 program icon for the program "${collapse(name)}": original 2009 Microsoft-style icon art, a small glossy object on nothing.`,
        '',
        'SUBJECT - draw exactly this and nothing else:',
        subjectLine(brief, brandRefs > 0),
        '',
        styleCount ? `RENDERING - identical to the ${styleCount} style reference images:` : `RENDERING - as ${platform}'s own icons:`,
        'Light comes from the upper left. Every surface shades smoothly from a lighter top to a deeper bottom of its own hue.',
        vista
            ? 'Materials are real: polished glass, lacquered plastic, brushed metal, with one broad curved glass highlight across the upper part of the main form and a faint bright rim light along the lower edge. Colours are rich and saturated; whites are a cool silver, never blank. Edges are crisp and slightly bevelled.'
            : 'Finish is smooth lacquered plastic: one soft, broad highlight band across the upper third of rounded forms, nothing mirror-like. Each shape has a thin rim in a darker shade of its own colour. Colours are clear and saturated; whites are a cool pale grey-blue, never blank.',
        vista
            ? (brief.archetype === 'object' || brief.object ? 'View: three-quarter, from slightly above and to the left, as Vista draws objects. Detail suits a 256-pixel picture.' : 'View: straight from the front. Detail suits a 256-pixel picture.')
            : 'View: straight from the front. Detail suits a 90-pixel picture: a few large shapes, nothing fine.',
        '',
        'FRAMING:',
        'One subject, upright and centred, its whole outline inside the picture with clear empty space on all four sides (it spans about 80% of the canvas).',
        'The background is fully transparent and empty. The outline of the subject is the outline of the picture: it stands alone, unshadowed, on nothing.'
    ];
    if (brandRefs || styleCount) lines.push('', 'REFERENCE IMAGES:');
    if (userRefs) lines.push(`The first ${userRefs === 1 ? 'image is a picture' : `${userRefs} images are pictures`} the user attached for this icon: the subject is taken from ${userRefs === 1 ? 'it' : 'them'} as the user's direction says.`);
    if (brandRefs > userRefs) {
        const n = userRefs + 1;
        if (brief.object) lines.push(`Image ${n} is the app's present-day icon. It gives two things only: the exact colours${brief.badge ? ', and the shape of the small emblem' : ''}. Its flat modern look, its layout and its size on the tile are not used: the picture is the object described above.`);
        else lines.push(`Image ${n} is the app's current icon. ${userRefs ? 'Take its colours from it.' : 'Take the subject\'s outline, proportions and colours from it.'} The flat tile behind the subject belongs to the phone's launcher, so it is left out.${brief.drop ? ` Also left out: ${brief.drop}.` : ''}`);
    }
    if (styleCount) lines.push(`The last ${styleCount} images are genuine ${platform} icons. Take the rendering from them: how much shading, how much gloss, the rim, the amount of detail. Their subjects stay out of this picture.`);
    if (direction) lines.push('', `REQUIRED BY THE USER (this wins over the subject above wherever they differ): ${direction}`);
    return lines.join('\n');
}

/**
 * Measure a drawing before it is accepted. alpha: the master's alpha channel (Uint8Array, width x height).
 * Answers null when it is fine, else why not:
 *   'clipped'  the subject runs off the canvas (opaque pixels along an edge);
 *   'plate'    a mark or a character that fills its box like a square or rounded-square tile: the
 *              launcher tile came back (a free-standing symbol never fills 84% of a square box; a round disc fills 79%, the roundest tile measured 86%).
 */
function checkMaster(alpha, width, height, brief) {
    let x0 = width; let x1 = -1; let y0 = height; let y1 = -1; let solid = 0; let edge = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (alpha[y * width + x] < 128) continue;
            solid++;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
            if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) edge++;
        }
    }
    if (x1 < 0) return 'empty';
    if (edge > (width + height) * 0.02) return 'clipped';
    const w = x1 - x0 + 1; const h = y1 - y0 + 1;
    const fill = solid / (w * h);
    const aspect = w / h;
    if (brief && brief.archetype !== 'object' && !brief.object && fill > 0.84 && aspect > 0.87 && aspect < 1.15) return 'plate';
    return null;
}

/** One more sentence for the draw after a failed check (the rest of the text stays the same). */
const RETRY_NOTES = {
    clipped: 'The previous drawing ran off the canvas. Draw the subject smaller: it spans 70% of the canvas, with empty space on every side.',
    plate: 'The previous drawing put the subject on a square tile. There is no tile: only the subject\'s own shape is drawn, and the canvas around and between its parts stays transparent.',
    empty: ''
};
const retryNote = (why) => RETRY_NOTES[why] || '';

module.exports = { ARCHETYPES, STYLES, PERIOD_OBJECTS, periodPrompt, parsePeriod, withPeriod, briefPrompt, normaliseBrief, styleRefs, renderPrompt, checkMaster, retryNote };
