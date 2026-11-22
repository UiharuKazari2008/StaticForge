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
const styleRefs = (style, archetype) => (STYLE_REFS[style] || STYLE_REFS.wm)[archetype] || (STYLE_REFS[style] || STYLE_REFS.wm).mark;

const colourList = (brief) => brief.colours.map((c) => `${c.part} ${c.hex}`.trim()).join(', ');

function subjectLine(brief, hasBrandRef) {
    const s = brief.subject;
    const lettering = brief.lettering ? ` The only lettering is "${brief.lettering}", as part of the shape.` : ' No lettering.';
    const colours = colourList(brief);
    const slab = `${hasBrandRef ? 'Same outline and proportions as reference image 1. ' : ''}It is a slab of glossy enamel seen straight from the front: no side walls show, depth appears only as a narrow bevel along the rim.`;
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
            ? (brief.archetype === 'object' ? 'View: three-quarter, from slightly above and to the left, as Vista draws objects. Detail suits a 256-pixel picture.' : 'View: straight from the front. Detail suits a 256-pixel picture.')
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
        lines.push(`Image ${n} is the app's current icon. ${userRefs ? 'Take its colours from it.' : 'Take the subject\'s outline, proportions and colours from it.'} The flat tile behind the subject belongs to the phone's launcher, so it is left out.${brief.drop ? ` Also left out: ${brief.drop}.` : ''}`);
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
    if (brief && brief.archetype !== 'object' && fill > 0.84 && aspect > 0.87 && aspect < 1.15) return 'plate';
    return null;
}

/** One more sentence for the draw after a failed check (the rest of the text stays the same). */
const RETRY_NOTES = {
    clipped: 'The previous drawing ran off the canvas. Draw the subject smaller: it spans 70% of the canvas, with empty space on every side.',
    plate: 'The previous drawing put the subject on a square tile. There is no tile: only the subject\'s own shape is drawn, and the canvas around and between its parts stays transparent.',
    empty: ''
};
const retryNote = (why) => RETRY_NOTES[why] || '';

module.exports = { ARCHETYPES, STYLES, briefPrompt, normaliseBrief, styleRefs, renderPrompt, checkMaster, retryNote };
