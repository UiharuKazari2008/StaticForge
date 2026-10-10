/**
 * How on-image text is shown (Studio text overlays).
 *
 * One catalog for the browser dropdown and the server compile path.
 * Client: load before studioChangeJson.js and textOverlayManager.js.
 * Server: require() this same file.
 *
 * Tags are Danbooru-style (lowercase, comma-separated), the form NovelAI
 * V4.5 / V5 lettering expects in front of Text: (prompt guide: english text,
 * speech bubble). compileTextOverlayAppend still applies length emphasis.
 *
 * Legacy ids speech, thought, and caption keep their previous tag strings.
 * subtitle is an alias of caption. Weighted forms such as
 * 2.0::english text, speech bubble:: and
 * 2.0::english text, 3.0::caption, subtitle:: still resolve to those ids.
 * type custom injects customText; an empty custom string injects no display tag.
 */
'use strict';

const TEXT_DISPLAY_GROUP_ORDER = [
    'Bubbles',
    'Boxes & captions',
    'Signs & surfaces',
    'Screens & messages',
    'Comic & title',
    'Worn/applied',
    'Custom'
];

/** Historical dropdown tag strings. Recognized as type values; injection uses the plain tags. */
const LEGACY_WEIGHTED_TEXT_TAGS = {
    speech: '2.0::english text, speech bubble::',
    thought: '2.0::english text, thought bubble::',
    caption: '2.0::english text, 3.0::caption, subtitle::'
};

const TEXT_DISPLAY_STYLES = [
    { id: 'speech', name: 'Speech Bubble', group: 'Bubbles', icon: 'fas fa-comment-lines', tags: 'english text, speech bubble' },
    { id: 'thought', name: 'Thought Bubble', group: 'Bubbles', icon: 'fas fa-thought-bubble', tags: 'english text, thought bubble' },
    { id: 'shout', name: 'Shout Bubble', group: 'Bubbles', icon: 'fas fa-bullhorn', tags: 'english text, jagged speech bubble, shouting' },
    { id: 'whisper', name: 'Whisper Bubble', group: 'Bubbles', icon: 'fas fa-comment-dots', tags: 'english text, dashed speech bubble, whispering' },

    { id: 'caption', name: 'Subtitle', group: 'Boxes & captions', icon: 'fas fa-closed-captioning', tags: 'english text, caption, subtitle' },
    { id: 'caption_box', name: 'Caption Box', group: 'Boxes & captions', icon: 'fas fa-rectangle-list', tags: 'english text, caption' },
    { id: 'narration', name: 'Narration Box', group: 'Boxes & captions', icon: 'fas fa-book-open', tags: 'english text, narration, rectangular caption' },
    { id: 'label', name: 'Label / Tag', group: 'Boxes & captions', icon: 'fas fa-tag', tags: 'english text, label, tag' },

    { id: 'sign', name: 'Sign / Placard', group: 'Signs & surfaces', icon: 'fas fa-sign-hanging', tags: 'english text, sign, placard' },
    { id: 'chalkboard', name: 'Chalkboard', group: 'Signs & surfaces', icon: 'fas fa-chalkboard', tags: 'english text, chalkboard' },
    { id: 'whiteboard', name: 'Whiteboard', group: 'Signs & surfaces', icon: 'fas fa-square', tags: 'english text, whiteboard' },
    { id: 'neon', name: 'Neon Sign', group: 'Signs & surfaces', icon: 'fas fa-lightbulb', tags: 'english text, neon sign' },
    { id: 'banner', name: 'Banner', group: 'Signs & surfaces', icon: 'fas fa-scroll', tags: 'english text, banner' },
    { id: 'poster', name: 'Poster', group: 'Signs & surfaces', icon: 'fas fa-image', tags: 'english text, poster' },
    { id: 'storefront', name: 'Signboard / Storefront', group: 'Signs & surfaces', icon: 'fas fa-store', tags: 'english text, storefront, signboard' },
    { id: 'road_sign', name: 'Road Sign', group: 'Signs & surfaces', icon: 'fas fa-road', tags: 'english text, road sign' },
    { id: 'warning', name: 'Warning Sign', group: 'Signs & surfaces', icon: 'fas fa-triangle-exclamation', tags: 'english text, warning sign' },

    { id: 'screen', name: 'Screen / UI Text', group: 'Screens & messages', icon: 'fas fa-display', tags: 'english text, screen, user interface' },
    { id: 'phone', name: 'Phone Text Message', group: 'Screens & messages', icon: 'fas fa-mobile-screen', tags: 'english text, smartphone, text message' },
    { id: 'chat', name: 'Chat Window', group: 'Screens & messages', icon: 'fas fa-comments', tags: 'english text, chat window' },
    { id: 'terminal', name: 'Terminal', group: 'Screens & messages', icon: 'fas fa-terminal', tags: 'english text, computer terminal' },
    { id: 'hologram', name: 'Hologram', group: 'Screens & messages', icon: 'fas fa-cube', tags: 'english text, hologram' },

    { id: 'sfx', name: 'Comic Sound Effect', group: 'Comic & title', icon: 'fas fa-bolt', tags: 'english text, comic, sound effect, onomatopoeia' },
    { id: 'title', name: 'Title Text', group: 'Comic & title', icon: 'fas fa-heading', tags: 'english text, title' },
    { id: 'logo', name: 'Logo', group: 'Comic & title', icon: 'fas fa-certificate', tags: 'english text, logo' },
    { id: 'credits', name: 'Credits', group: 'Comic & title', icon: 'fas fa-film', tags: 'english text, credits' },

    { id: 'shirt', name: 'T-shirt Print', group: 'Worn/applied', icon: 'fas fa-shirt', tags: 'english text, shirt, print' },
    { id: 'handwritten', name: 'Handwritten Note', group: 'Worn/applied', icon: 'fas fa-pen-fancy', tags: 'english text, handwritten, note' },
    { id: 'sticky', name: 'Sticky Note', group: 'Worn/applied', icon: 'fas fa-note-sticky', tags: 'english text, sticky note' },
    { id: 'letter', name: 'Letter', group: 'Worn/applied', icon: 'fas fa-envelope', tags: 'english text, letter' },
    { id: 'book', name: 'Book Page', group: 'Worn/applied', icon: 'fas fa-book-open', tags: 'english text, open book' },
    { id: 'newspaper', name: 'Newspaper', group: 'Worn/applied', icon: 'fas fa-newspaper', tags: 'english text, newspaper' },
    { id: 'graffiti', name: 'Graffiti', group: 'Worn/applied', icon: 'fas fa-spray-can', tags: 'english text, graffiti' },
    { id: 'tattoo', name: 'Tattoo', group: 'Worn/applied', icon: 'fas fa-pen-nib', tags: 'english text, tattoo' },
    { id: 'carved', name: 'Carved / Engraved', group: 'Worn/applied', icon: 'fas fa-hammer', tags: 'english text, carved, engraved' },
    { id: 'embroidered', name: 'Embroidered', group: 'Worn/applied', icon: 'fas fa-shirt', tags: 'english text, embroidery' },
    { id: 'parchment', name: 'Scroll / Parchment', group: 'Worn/applied', icon: 'fas fa-scroll', tags: 'english text, scroll, parchment' },
    { id: 'stamp', name: 'Stamp', group: 'Worn/applied', icon: 'fas fa-stamp', tags: 'english text, stamp' },

    { id: 'custom', name: 'Custom', group: 'Custom', icon: 'fas fa-pen', tags: '' }
];

/** Ids that are not their own row. subtitle is the old caption style. */
const TEXT_DISPLAY_ALIASES = {
    subtitle: 'caption',
    subtitles: 'caption',
    speechbubble: 'speech',
    thoughtbubble: 'thought',
    sound_effect: 'sfx',
    onomatopoeia: 'sfx',
    tshirt: 'shirt',
    t_shirt: 'shirt'
};

const TEXT_DISPLAY_BY_ID = Object.create(null);
const TEXT_DISPLAY_BY_TAGS = Object.create(null);
TEXT_DISPLAY_STYLES.forEach((style) => {
    TEXT_DISPLAY_BY_ID[style.id] = style;
    if (style.tags) TEXT_DISPLAY_BY_TAGS[style.tags.toLowerCase()] = style.id;
});
Object.keys(LEGACY_WEIGHTED_TEXT_TAGS).forEach((id) => {
    TEXT_DISPLAY_BY_TAGS[LEGACY_WEIGHTED_TEXT_TAGS[id].toLowerCase()] = id;
});

function normalizeStyleKey(raw) {
    return String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Drop N:: … :: wrappers so 1.5::speech:: and nested caption weights still match. */
function stripTextDisplayEmphasis(raw) {
    return String(raw || '')
        .replace(/-?\d+(?:\.\d+)?::/g, '')
        .replace(/::/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function resolveTextDisplayStyle(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    const direct = normalizeStyleKey(raw);
    if (TEXT_DISPLAY_BY_ID[direct]) return TEXT_DISPLAY_BY_ID[direct];
    if (TEXT_DISPLAY_ALIASES[direct] && TEXT_DISPLAY_BY_ID[TEXT_DISPLAY_ALIASES[direct]]) {
        return TEXT_DISPLAY_BY_ID[TEXT_DISPLAY_ALIASES[direct]];
    }
    const stripped = stripTextDisplayEmphasis(raw);
    const strippedKey = normalizeStyleKey(stripped);
    if (TEXT_DISPLAY_BY_ID[strippedKey]) return TEXT_DISPLAY_BY_ID[strippedKey];
    if (TEXT_DISPLAY_ALIASES[strippedKey] && TEXT_DISPLAY_BY_ID[TEXT_DISPLAY_ALIASES[strippedKey]]) {
        return TEXT_DISPLAY_BY_ID[TEXT_DISPLAY_ALIASES[strippedKey]];
    }
    if (TEXT_DISPLAY_BY_TAGS[stripped]) return TEXT_DISPLAY_BY_ID[TEXT_DISPLAY_BY_TAGS[stripped]];
    const rawLower = String(raw).trim().toLowerCase();
    if (TEXT_DISPLAY_BY_TAGS[rawLower]) return TEXT_DISPLAY_BY_ID[TEXT_DISPLAY_BY_TAGS[rawLower]];
    return null;
}

function customTextFromOverlay(overlay) {
    if (!overlay || typeof overlay !== 'object') return '';
    const raw = overlay.customText != null ? overlay.customText
        : (overlay.custom != null ? overlay.custom
            : (overlay.display != null ? overlay.display : ''));
    return String(raw).trim();
}

/**
 * Tag string injected in front of Text:.
 * textTags is an optional per-id override (prompt config text_tags).
 * Custom with an empty description returns '' (no display tag).
 * Unknown types fall back to the speech-bubble tags.
 */
function tagsForTextOverlay(overlay, textTags) {
    const source = overlay && typeof overlay === 'object' ? overlay : { type: overlay };
    const rawType = source.type != null && String(source.type).trim() !== '' ? source.type : 'speech';
    const style = resolveTextDisplayStyle(rawType);
    const canonical = style ? style.id : null;
    if (canonical === 'custom' || normalizeStyleKey(rawType) === 'custom') {
        return customTextFromOverlay(source);
    }
    const map = textTags && typeof textTags === 'object' ? textTags : null;
    if (map) {
        const spec = (canonical && map[canonical]) || map[rawType];
        if (spec && typeof spec.tags === 'string' && spec.tags.trim()) return spec.tags.trim();
    }
    if (style && style.tags) return style.tags;
    return 'english text, speech bubble';
}

function normalizeTextOverlayRow(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const style = resolveTextDisplayStyle(row.type || 'speech');
    const type = style ? style.id : (row.type != null && String(row.type).trim() !== '' ? String(row.type).trim() : 'speech');
    const out = Object.assign({}, row, { type });
    if (type === 'custom') {
        out.customText = customTextFromOverlay(row);
        delete out.custom;
        delete out.display;
    }
    return out;
}

function textDisplayStyleEnum() {
    const ids = TEXT_DISPLAY_STYLES.map((style) => style.id);
    Object.keys(TEXT_DISPLAY_ALIASES).forEach((alias) => {
        if (ids.indexOf(alias) === -1) ids.push(alias);
    });
    return ids;
}

function textDisplayStyleListText() {
    return TEXT_DISPLAY_STYLES.map((style) => `${style.id} (${style.name})`).join(', ');
}

function groupTextDisplayStyles(configTags) {
    const configured = configTags && typeof configTags === 'object' ? configTags : {};
    const seen = Object.create(null);
    const entries = TEXT_DISPLAY_STYLES.map((style) => {
        seen[style.id] = true;
        const cfg = configured[style.id];
        if (!cfg || typeof cfg !== 'object' || style.id === 'custom') return style;
        return {
            id: style.id,
            name: cfg.name || style.name,
            group: style.group,
            icon: cfg.icon || style.icon,
            tags: typeof cfg.tags === 'string' && cfg.tags.trim() ? cfg.tags.trim() : style.tags
        };
    });
    Object.keys(configured).forEach((key) => {
        if (seen[key] || TEXT_DISPLAY_ALIASES[key]) return;
        const cfg = configured[key];
        if (!cfg || typeof cfg !== 'object') return;
        entries.push({
            id: key,
            name: cfg.name || key,
            group: 'Other',
            icon: cfg.icon || 'fas fa-comment',
            tags: typeof cfg.tags === 'string' ? cfg.tags : ''
        });
    });
    const buckets = new Map();
    entries.forEach((style) => {
        const group = style.group || 'Other';
        if (!buckets.has(group)) buckets.set(group, []);
        buckets.get(group).push(style);
    });
    const names = TEXT_DISPLAY_GROUP_ORDER.filter((group) => buckets.has(group));
    buckets.forEach((_styles, group) => {
        if (names.indexOf(group) === -1) names.push(group);
    });
    return names.map((group) => ({ group, styles: buckets.get(group) }));
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let textOverlayExtractPatternCache = null;
function textOverlayExtractPattern() {
    if (textOverlayExtractPatternCache) return textOverlayExtractPatternCache;
    const phrases = new Set(['speech bubble', 'thought bubble', 'caption', 'subtitle']);
    TEXT_DISPLAY_STYLES.forEach((style) => {
        String(style.tags || '').split(',').forEach((part) => {
            const phrase = part.trim().toLowerCase();
            if (phrase && phrase !== 'english text') phrases.add(phrase);
        });
    });
    const alt = Array.from(phrases).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
    textOverlayExtractPatternCache = new RegExp(`,\\s*(?:${alt})?,?\\s*Text:\\s*(.+?)$`, 'i');
    return textOverlayExtractPatternCache;
}

const textDisplayStylesApi = {
    TEXT_DISPLAY_GROUP_ORDER,
    TEXT_DISPLAY_STYLES,
    TEXT_DISPLAY_ALIASES,
    LEGACY_WEIGHTED_TEXT_TAGS,
    normalizeStyleKey,
    stripTextDisplayEmphasis,
    resolveTextDisplayStyle,
    customTextFromOverlay,
    tagsForTextOverlay,
    normalizeTextOverlayRow,
    textDisplayStyleEnum,
    textDisplayStyleListText,
    groupTextDisplayStyles,
    textOverlayExtractPattern
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = textDisplayStylesApi;
}
