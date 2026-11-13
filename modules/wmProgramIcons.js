'use strict';

/**
 * Program Icons (Yozora #773): Windows Mobile versions of a phone's Android programs' icons,
 * made on request and kept in one store every phone shares.
 *
 * Melaton Mobile's Settings > Personal > Program Icons sends a batch of the phone's programs (each
 * with its own unthemed launcher icon, read from the app, and its name and Android category). For
 * each one the server reads the program's Play Store page (title, description, category, developer,
 * store icon), asks an image model for a Windows Mobile program icon with that context, and renders
 * the WM sizes as previews. The page lists them; the user keeps some, asks again for others, and
 * presses Done: the kept ones go to the store and the runtime assets are recompiled, so every phone
 * that lists the same program draws the new icon.
 *
 * Store (served and precached like the shell art):
 *   public/static_images/wm-android/<name>.png, @2x, @4x, -lg, -lg@2x, -lg@4x  (wmIconGenerator SIZES)
 *   public/static_images/wm-android/manifest.json  { version, updatedAt, icons: { "<package>/<activity>":
 *                                                     { name, package, label, model, updatedAt } } }
 * A new icon gets a new name, so no client keeps an old copy under a path it reuses.
 *
 * Jobs: .cache/wm-program-icons/jobs/<job>.json and <job>/ (references, masters, previews).
 * Play Store answers are kept a week in .cache/wm-program-icons/play/<package>.json.
 *
 * Image route (Yukimi, Nov 12: OpenAI's latest image model; TokenRouter when it can, for one wallet):
 * config.json wmProgramIcons { provider: 'auto' | 'tokenrouter' | 'openai', model?, quality?, briefModel?,
 * colours? (palette per rendered size, default 32, 0 = full colour) }.
 * model defaults to gpt-image-2.5-sunburst (as good as 2.6 for these, cheaper); 'latest' takes the
 * newest gpt-image Sunburst OpenAI or TokenRouter lists. auto sends it through TokenRouter when
 * TokenRouter lists that model (2.5 only on Nov 12 2026), else to OpenAI directly.
 *
 * HTTP (session auth; generating and writing the store are admin only):
 *   GET  /api/wm-program-icons/manifest
 *   GET  /api/wm-program-icons/jobs                       open jobs (newest first)
 *   POST /api/wm-program-icons/jobs                       { mode?: 'simple' | 'detailed', items: [{ id, package, label, category?, game?, mode?, icon: data URL, themed?: data URL }] }
 *   GET  /api/wm-program-icons/jobs/:job
 *   GET  /api/wm-program-icons/jobs/:job/files/:file      a preview PNG
 *   POST /api/wm-program-icons/jobs/:job/regenerate       { keys: [...], mode? }
 *   POST /api/wm-program-icons/jobs/:job/done             { accept: [...] } -> store, recompile
 *   POST /api/wm-program-icons/jobs/:job/cancel
 *   DELETE /api/wm-program-icons/store?id=<package/activity>   back to the Android icon
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const OpenAI = require('openai');
const appIconGenerator = require('./appIconGenerator');
const wmIconGenerator = require('./wmIconGenerator');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STORE_WEB = '/static_images/wm-android';
// Nov 12 2026 comparison (Spotify, WhatsApp, YouTube, Candy Crush, Angry Birds): 2.5 and 2.6 Sunburst
// drew these equally well; 2.5 is cheaper and TokenRouter carries it (one wallet). model 'latest'
// takes the newest gpt-image Sunburst either route lists.
const DEFAULT_MODEL = 'gpt-image-2.5-sunburst';
const FALLBACK_LATEST = 'gpt-image-2.6-sunburst';
const DEFAULT_QUALITY = 'high';
const CONCURRENCY = 3;
const MAX_ITEMS = 40;
const MAX_ICON_BYTES = 3 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const PLAY_TTL_MS = 7 * 24 * 3600 * 1000;
const MODELS_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 240000;
const JOB_KEEP_MS = 14 * 24 * 3600 * 1000;
const PREVIEW_SIZES = [16, 32, 128];

let projectRoot = PROJECT_ROOT;
let boundGr = null;
const jobs = new Map(); // id -> job
let running = 0;
const queue = []; // [{ job, item }]
let modelsCache = { at: 0, value: null };

const storeDir = () => path.join(projectRoot, 'public', 'static_images', 'wm-android');
const manifestPath = () => path.join(storeDir(), 'manifest.json');
const cacheDir = () => path.join(projectRoot, '.cache', 'wm-program-icons');
const jobsDir = () => path.join(cacheDir(), 'jobs');
const jobDir = (id) => path.join(jobsDir(), id);
const collapse = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

function atomicWrite(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

// ---------------------------------------------------------------- store

function readManifest() {
    const m = readJson(manifestPath(), null);
    if (!m || typeof m !== 'object' || !m.icons || typeof m.icons !== 'object') return { version: 0, updatedAt: null, icons: {} };
    return m;
}

/** The manifest as clients use it: id -> the icon set's path (no extension; wmShell WM_SET). */
function publicManifest() {
    const m = readManifest();
    const icons = {};
    for (const [id, e] of Object.entries(m.icons)) {
        if (e && e.name) icons[id] = { icon: `${STORE_WEB}/${e.name}`, package: e.package || id.split('/')[0], label: e.label || '', updatedAt: e.updatedAt || null };
    }
    return { version: m.version || 0, updatedAt: m.updatedAt || null, icons };
}

function removeSet(name) {
    if (!/^[a-z0-9_-]+$/.test(String(name || ''))) return;
    for (const s of wmIconGenerator.SIZES) {
        try { fs.unlinkSync(path.join(storeDir(), `${name}${s.suffix}.png`)); } catch (_) { /* gone already */ }
    }
}

function setName(item) {
    const pkg = String(item.package || item.id.split('/')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'app';
    return `${pkg}-${item.key.slice(0, 6)}-${Date.now().toString(36)}`;
}

/**
 * Recompile runtime assets (the SW hash cache and the clients' update manifest; every client is
 * told). Resolves when done, so Done can answer after it and the phone's own update check finds
 * the new icons (Yukimi, Nov 12). Bursts share one run.
 */
let recompileRun = null;
function recompileNow() {
    if (recompileRun) return recompileRun.then(() => recompileNow());
    recompileRun = (async () => {
        try {
            const runtimeAssetService = require('./runtimeAssetService');
            const r = await runtimeAssetService.recompileAndRefresh({ showConsoleProgress: false });
            console.log(`[wmProgramIcons] assets recompiled (${r && r.compiled} compiled, ${r && r.errors ? r.errors.length : 0} errors)`);
        } catch (err) {
            console.warn('[wmProgramIcons] recompile failed:', err && err.message ? err.message : err);
        }
    })().finally(() => { recompileRun = null; });
    return recompileRun;
}
const recompileWithin = (ms) => Promise.race([recompileNow(), new Promise((r) => setTimeout(r, ms))]);

// ---------------------------------------------------------------- Play Store context

function decodeEntities(s) {
    return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function fetchWithTimeout(url, opts = {}, ms = 15000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
}

/** { title, description, category, developer, iconUrl } from the program's Play Store page, or null. */
async function playStoreContext(pkg) {
    if (!/^[A-Za-z0-9_.]+$/.test(String(pkg || ''))) return null;
    const file = path.join(cacheDir(), 'play', `${pkg}.json`);
    const cached = readJson(file, null);
    // (answers kept before the store images were read are read again)
    if (cached && Date.now() - (cached.at || 0) < PLAY_TTL_MS && (!cached.value || cached.value.images !== undefined)) return cached.value;
    let value = null;
    try {
        const res = await fetchWithTimeout(`https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en_US&gl=US`, {
            headers: { 'Accept-Language': 'en-US,en;q=0.8', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' }
        });
        if (res.ok) {
            const html = await res.text();
            const ld = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
            let j = null;
            try { j = ld ? JSON.parse(ld[1]) : null; } catch (_) { j = null; }
            // the long description (its markup nests; the first 700 characters of its text are enough)
            const long = html.match(/data-g-id="description"[^>]*>([\s\S]{0,4000})/);
            const description = collapse(decodeEntities((long ? long[1] : (j && j.description) || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))).slice(0, 700);
            const og = html.match(/<meta property="og:image" content="([^"]+)"/);
            const icon = (j && j.image) || (og && decodeEntities(og[1]).replace(/=s\d+.*$/, '')) || null;
            // the program's own store art: its feature graphic and first screenshots (the page's other
            // images are similar apps' icons and videos)
            const images = [];
            for (const m of html.matchAll(/<img[^>]*>/g)) {
                const tag = m[0];
                const src = (tag.match(/src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/) || [])[1];
                if (!src) continue;
                const feature = /class="[^"]*\biFm1E\b/.test(tag);
                if (!feature && !/alt="Screenshot image"/.test(tag)) continue;
                const base = src.replace(/=.*$/, '');
                if (images.includes(base)) continue;
                if (feature) images.unshift(base); else if (images.length < 7) images.push(base);
            }
            value = {
                title: collapse(j && j.name) || null,
                description: description || null,
                category: collapse(j && j.applicationCategory).replace(/_/g, ' ').toLowerCase() || null,
                developer: collapse(j && j.author && j.author.name) || null,
                iconUrl: icon && /^https:\/\/play-lh\.googleusercontent\.com\//.test(icon) ? `${icon.replace(/=.*$/, '')}=s512` : null,
                images
            };
        }
    } catch (_) { value = null; }
    try { atomicWrite(file, JSON.stringify({ at: Date.now(), value })); } catch (_) { /* not kept */ }
    return value;
}

// ---------------------------------------------------------------- prompt

// Modes (Yukimi, Nov 12): chosen when the icons are requested and again on Regenerate.
//   simple    the app's mark or one iconic object, like Windows Mobile's own program icons; a game
//             gets its emblem or one object that stands for it, never a character portrait
//   detailed  the richer take: a game's characters or signature objects, a brand mark with an
//             object that says what the program does
const MODES = ['simple', 'detailed'];
const normMode = (m) => (MODES.includes(m) ? m : 'detailed');
const SIMPLE_TAKE = 'Simple mode: one bold mark only, built from two or three big shapes with two tones each, like Windows Mobile\'s own program icons. Build it from the app\'s real mark as the references show it (its themed one-colour icon and/or its official logo): keep that exact shape, proportions and letterforms, in the brand\'s colours; never invent a different emblem or letter. The icon is square and must read at 16 pixels, so never copy a whole wordmark: if the logo has an emblem (a halo, a star, a crest, a symbol over a letter), that emblem alone becomes the icon, with at most the one letter it sits on; if it is lettering only, use its main word when it is short (six letters or fewer), else its initial, in the logo\'s own letterforms. No faces or figures, no scene, nothing small.';

// Windows Mobile 6's own program icons, attached as style references to every request (Yukimi,
// Nov 12: the results were too glossy next to the OS icons). Plain objects, no logos to copy.
const STYLE_REFS = [
    { file: 'app-calendar-lg@4x.png', label: 'Calendar' },
    { file: 'app-messaging-lg@4x.png', label: 'Messaging' },
    { file: 'app-tasks-lg@4x.png', label: 'Tasks' }
];
let styleBuffers = null;
async function styleRefs() {
    if (styleBuffers) return styleBuffers;
    const out = [];
    for (const r of STYLE_REFS) {
        try {
            // on white: the model reads a transparent reference's edges as dark fringes
            out.push(await sharp(path.join(projectRoot, 'public', 'static_images', 'wm61', r.file)).resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .flatten({ background: '#ffffff' }).png().toBuffer());
        } catch (_) { /* fewer references */ }
    }
    styleBuffers = out;
    return out;
}

// a regeneration asks for another way to turn the brand into a WM object
const TAKES = [
    'Turn the brand mark itself into a solid object with a little depth: a thick emblem with a slight bevel and a soft light top edge, standing free with no plate behind it.',
    'Show the job the program does as a physical object of the era (a handset, an envelope, a camera, a speaker, a globe, a notepad, a disc, a game pad, a map, a chat bubble...) in the brand\'s own colours, with the brand mark set into it or overlapping its lower right like a WM badge.',
    'Combine the two: the brand mark as an emblem in front, with a small object that says what the program does tucked behind or beside it, the way Windows Mobile icons layer a main shape and an accessory.',
    'Set the brand symbol on a simple rounded token or disc seen slightly from the front, in the brand colours, with one soft gradient and a light top edge (not a glass orb).'
];

// a game's store icon is usually a painted scene: the icon is its few signature objects, rebuilt
const GAME_TAKE = 'This is a game whose store icon is a painted illustration. If its icon is a character, draw that character as a free-standing head-and-shoulders figure whose hair and shoulders end in their own outline (never cut off by a straight or rounded edge), like the era\'s Messenger buddy figures. Otherwise pick its one to three signature objects or characters (for example the three candies of a candy game, the bird of a bird game) and draw each again as a clean, chunky object in the Windows Mobile style (few flat tones, soft stepped shading), grouped tightly and overlapping a little, like a 2009 Windows Mobile game icon (Bubble Breaker, Solitaire). Simplify their shapes and surface detail so each reads at 16 pixels; drop the scene, sparkles and background.';

function buildPrompt(item, ctx, attempt, refs, brief, styleCount = 0) {
    const name = collapse(item.label) || collapse(ctx && ctx.title) || item.package;
    const lines = [
        `Redraw the icon of the Android app "${name}"${ctx && ctx.developer ? ` by ${ctx.developer}` : ''} as the program icon it would have had if it had shipped on a 2009 Windows Mobile 6.5 Professional phone, in Microsoft's own icon style of that time (Windows Mobile 6's program icons: Calendar, Messaging, Tasks).`,
        'Context about the app, to keep its purpose clear:',
        `- Name: ${name}${ctx && ctx.title && collapse(ctx.title) !== name ? ` (store title: ${collapse(ctx.title)})` : ''}`
    ];
    const cat = collapse((ctx && ctx.category) || item.category || (item.game ? 'game' : ''));
    if (cat) lines.push(`- Category: ${cat}`);
    if (ctx && ctx.description) lines.push(`- What it does (from its store page): ${ctx.description}`);
    lines.push(
        '',
        'Keep the brand: the same signature colours, the same mark or symbol and its silhouette, so anyone who knows the app recognises it at a glance. Keep what the program is for.',
        'Redraw, never cut out: build the icon again from scratch in the style below. Do not trace, crop or remove the background from the reference and keep its painting; a result that looks like the reference with its tile removed is wrong.',
        'Leave out everything that is not the app\'s own mark: publisher or developer logos and wordmarks (a studio\'s name in a corner, a "King" or "Google" badge), corner ribbons, "new" or "beta" tags, store badges.',
        'But make it a real 2009 Windows Mobile icon, not the modern icon with a filter on it:',
        '- No modern app-icon plate: no flat rounded-square or circle tile behind the mark, no Material Design long shadows, no flat vector look, no 2020s gradients. Windows Mobile icons are free-standing objects on a transparent background.',
        '- Nothing is cropped or masked into a shape: no rounded corners, no rounded-square, circle or badge outline cutting the picture, no vignette. Rounded app-icon shapes did not exist in 2009. Every object ends in its own silhouette.',
        '- Flatter than you would expect, but not flat (Yukimi: the OS icons are flatter, lower complexity, limited colour, staggered shading): a slight three-quarter turn or front-on view, light from the upper left, each surface in two or three tones of its colour as broad soft steps (a lighter top, a mid tone, a slightly darker lower edge). Little shine: at most a faint light band or edge on the top of rounded parts; no wet or glassy gloss, no bright specular streaks, no glass orbs or bubbles, no chrome, no 3D render look, no ambient occlusion, no detailed rendering of hair strands, skin or fabric. Every shape outlined thinly in a darker shade of its own colour (never black).',
        '- Low complexity: a few big, simple shapes that stay readable at 32 and 16 pixels; no fine texture, hairlines or small text.',
        `- ${normMode(item.mode) === 'simple' ? SIMPLE_TAKE : (item.game || /game/i.test(cat)) && (Number(attempt) || 1) === 1 ? GAME_TAKE : TAKES[(Math.max(1, Number(attempt) || 1) - 1) % TAKES.length]}`,
        '- Lettering only where the brand mark itself is a letter or a short word; then keep it as a bold simple shape. No other text.',
        '',
        'The object fills the square canvas almost edge to edge, centred, about 94% of the canvas on its longest side.',
        'Transparent background: no floor, plate, backdrop, drop shadow, contact shadow, reflection or glow. Clean anti-aliased edge with no fringe or halo. Keep surfaces off pure white so highlights stay visible.'
    );
    if (brief) lines.push(`The signature objects to model (from the store icon; nothing else of it): ${brief}`);
    if (refs.length) {
        lines.push(`Reference images attached first, in order: ${refs.join('; ')}. Use them for the brand mark, its shape and colours only; do not copy their plate, framing or flat rendering.`);
    }
    if (styleCount) {
        lines.push(`The last ${styleCount} attached images are Windows Mobile 6's own program icons (${STYLE_REFS.slice(0, styleCount).map((r) => r.label).join(', ')}): style references only. Match their amount of shading, shine, outline and detail exactly; do not copy their subjects, shapes or colours.`);
    }
    const direction = collapse(item.direction);
    if (direction) lines.push(`Required direction from the user for this icon; follow it even when it conflicts with anything above or with the references: ${direction}`);
    if (attempt > 1) lines.push(`This is attempt ${attempt}: the earlier ones were not kept. Make a clearly different design from the obvious one, still faithful to the brand.`);
    return lines.join('\n');
}

// ---------------------------------------------------------------- image route

function settings() {
    let cfg = null;
    try { cfg = boundGr && boundGr.getConfig({ path: 'wmProgramIcons' }); } catch (_) { cfg = null; }
    if (!cfg) cfg = (readJson(path.join(projectRoot, 'config.json'), {}) || {}).wmProgramIcons;
    cfg = cfg && typeof cfg === 'object' ? { ...cfg } : {};
    // a one-off comparison run from a script (WM_PROGRAM_ICONS_MODEL=gpt-image-2.5-sunburst)
    if (process.env.WM_PROGRAM_ICONS_MODEL) cfg.model = process.env.WM_PROGRAM_ICONS_MODEL;
    return cfg;
}

function tokenRouterKey() {
    try {
        const key = boundGr && boundGr.getApiKeyManager().getActiveApiKey('tokenrouter');
        if (key) return String(key).trim();
    } catch (_) { /* key manager not ready */ }
    if (process.env.TOKENROUTER_API_KEY) return String(process.env.TOKENROUTER_API_KEY).trim();
    // outside the server (a script): Security Center's stored key, the selected one first
    const secure = readJson(path.join(projectRoot, 'secure.config.json'), {}) || {};
    const keys = secure.tokenrouter && Array.isArray(secure.tokenrouter.keys) ? secure.tokenrouter.keys : [];
    const sel = ((readJson(path.join(projectRoot, 'config.json'), {}) || {}).selectedApiKeys || {}).tokenrouter;
    const k = (Number.isInteger(sel) && keys[sel] && keys[sel].apiKey) ? keys[sel] : keys.find((e) => e && e.apiKey);
    return k ? String(k.apiKey).trim() : null;
}

function tokenRouterBase() {
    return String(process.env.TOKENROUTER_BASE_URL || 'https://api.tokenrouter.com').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

const versionOf = (id) => {
    const m = /^gpt-image-(\d+(?:\.\d+)?)-sunburst$/.exec(id);
    return m ? Number(m[1]) : -1;
};

async function listModels(url, key) {
    try {
        const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${key}` } }, 15000);
        if (!res.ok) return [];
        const j = await res.json();
        return (j && Array.isArray(j.data) ? j.data : []).map((m) => String(m.id || ''));
    } catch (_) { return []; }
}

/** { provider, model, baseURL, apiKey } for the next request. */
async function chooseRoute() {
    const cfg = settings();
    const want = ['tokenrouter', 'openai'].includes(cfg.provider) ? cfg.provider : 'auto';
    let openaiKey = null;
    try { openaiKey = appIconGenerator.resolveOpenAiKey(projectRoot).apiKey; } catch (_) { openaiKey = null; }
    const trKey = tokenRouterKey();
    if (!modelsCache.value || Date.now() - modelsCache.at > MODELS_TTL_MS) {
        const [oa, tr] = await Promise.all([
            openaiKey ? listModels('https://api.openai.com/v1/models', openaiKey) : [],
            trKey ? listModels(`${tokenRouterBase()}/v1/models`, trKey) : []
        ]);
        modelsCache = { at: Date.now(), value: { openai: oa, tokenrouter: tr.filter((id) => id.startsWith('openai/')).map((id) => id.slice(7)) } };
    }
    const lists = modelsCache.value;
    const newest = (ids) => ids.filter((id) => versionOf(id) >= 0).sort((a, b) => versionOf(b) - versionOf(a))[0] || null;
    const asked = collapse(cfg.model) || DEFAULT_MODEL;
    const model = asked === 'latest' ? (newest(lists.openai.concat(lists.tokenrouter)) || FALLBACK_LATEST) : asked;
    const viaTr = trKey && (want === 'tokenrouter' || (want === 'auto' && lists.tokenrouter.includes(model)));
    if (viaTr) return { provider: 'tokenrouter', model, apiModel: `openai/${model}`, baseURL: `${tokenRouterBase()}/v1`, apiKey: trKey };
    if (!openaiKey) throw new Error(want === 'tokenrouter' ? 'No TokenRouter key.' : 'No OpenAI key (Security Center > API keys).');
    return { provider: 'openai', model, apiModel: model, baseURL: undefined, apiKey: openaiKey };
}

/**
 * A game's store icon is a painted scene; as an edit reference the image model keeps its painting,
 * framing and publisher badge (Yukimi, Nov 12: "recreate the 3 candy pieces, remove the King logo").
 * So a vision model writes a brief of the signature objects first and the icon is drawn from text.
 * config wmProgramIcons.briefModel (default gpt-5.4-mini, OpenAI directly). null when unavailable.
 */
async function describeIcon(name, refBuffers, mode) {
    let key = null;
    try { key = appIconGenerator.resolveOpenAiKey(projectRoot).apiKey; } catch (_) { return null; }
    const model = collapse(settings().briefModel) || 'gpt-5.4-mini';
    const images = [];
    for (const b of refBuffers.slice(0, 2)) images.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${(await sharp(b).resize(384, 384, { fit: 'inside' }).png().toBuffer()).toString('base64')}` } });
    try {
        const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{
                    role: 'user',
                    content: [{
                        type: 'text',
                        text: `These are icons of the game "${name}". ${mode === 'simple'
                            ? 'Name exactly ONE thing for a simple icon of this game and describe it: shape, proportions, colours. Prefer the game\'s emblem or logo symbol (not its wordmark text); if none is visible, use what you know about the game for its best-known symbol or object (a halo, a weapon, a ball, one candy...). Always answer with one thing, never "none", never a group. No characters, faces or figures.'
                            : 'Name its one to three signature objects or characters that make the icon recognisable, and describe each for an illustrator who will model it again from scratch: shape, proportions, colours, distinctive features, pose.'} Leave out the background, the scene, sparkles, the icon tile, any publisher or developer logo, wordmark or badge (studio names, corner ribbons), and all text, event banners and anniversary or season ribbons. Describe colours as a few flat tones. Plain prose, at most 90 words, no preamble.`
                    }, ...images]
                }]
            })
        }, 60000);
        if (!res.ok) return null;
        const j = await res.json();
        const text = collapse(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
        return text ? text.slice(0, 900) : null;
    } catch (_) { return null; }
}

/**
 * The program's official logo, found in its store art (feature graphic, screenshots) by a vision
 * model and cropped (Yukimi, Nov 12: Simple mode drew invented marks - an "N" for NIKKE, a ring for
 * Blue Archive - when it had no picture of the real one). Writes <key>-logo.png; item.logo =
 * { found, what }. Never guesses: nothing found leaves found false.
 */
async function findLogo(item, ctx, dir) {
    if (item.logo !== undefined) return item.logo;
    item.logo = { found: false };
    const urls = (ctx && Array.isArray(ctx.images) ? ctx.images : []).slice(0, 7);
    if (!urls.length) return item.logo;
    let key = null;
    try { key = appIconGenerator.resolveOpenAiKey(projectRoot).apiKey; } catch (_) { return item.logo; }
    const imgs = [];
    for (const u of urls) {
        try {
            const r = await fetchWithTimeout(`${u}=w1024`, {}, 15000);
            if (r.ok) imgs.push(await sharp(Buffer.from(await r.arrayBuffer())).png().toBuffer());
        } catch (_) { /* one image fewer */ }
    }
    if (!imgs.length) return item.logo;
    const content = [{
        type: 'text',
        text: `These are store images of "${item.label}" (numbered from 0 in order). Find its official logo: the emblem or logo lettering as the publisher designed it, not character art, UI text, captions or the publisher's own logo. Answer JSON only: {"found": true|false, "image": <index>, "box": [left, top, right, bottom] as fractions 0..1 of that image, "what": "<short description>"}. Pick the clearest, largest one. If no official logo is visible, answer {"found": false}. Never guess.`
    }];
    for (const b of imgs) content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${(await sharp(b).resize({ width: 768, withoutEnlargement: true }).png().toBuffer()).toString('base64')}` } });
    try {
        const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: collapse(settings().briefModel) || 'gpt-5.4-mini', response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] })
        }, 90000);
        if (!res.ok) return item.logo;
        const j = await res.json();
        const a = JSON.parse((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}');
        const img = imgs[Number(a.image)];
        const box = Array.isArray(a.box) ? a.box.map(Number) : null;
        if (!a.found || !img || !box || box.length !== 4 || box.some((v) => !Number.isFinite(v))) return item.logo;
        const md = await sharp(img).metadata();
        // a generous margin: the boxes come back a little tight
        const [l, t, r, b] = box;
        const L = Math.max(0, Math.floor((l - 0.08) * md.width));
        const T = Math.max(0, Math.floor((t - 0.06) * md.height));
        const R = Math.min(md.width, Math.ceil((r + 0.08) * md.width));
        const B = Math.min(md.height, Math.ceil((b + 0.06) * md.height));
        if (R - L < 12 || B - T < 12) return item.logo;
        const crop = await sharp(img).extract({ left: L, top: T, width: R - L, height: B - T }).resize({ width: 768, height: 768, fit: 'inside' }).png().toBuffer();
        atomicWrite(path.join(dir, `${item.key}-logo.png`), crop);
        item.logo = { found: true, what: collapse(a.what).slice(0, 120) };
    } catch (_) { /* no logo */ }
    return item.logo;
}

async function requestIcon(route, prompt, refBuffers) {
    const gate = route.provider === 'tokenrouter' ? require('./tokenRouterGate') : null;
    const client = new OpenAI({
        apiKey: route.apiKey,
        baseURL: route.baseURL,
        timeout: REQUEST_TIMEOUT_MS,
        maxRetries: gate ? 0 : 2,
        // TokenRouter: every keyed request waits its turn in the account's rate window (#418)
        fetch: gate ? (url, init) => gate.run(() => fetch(url, init), { lane: 'background', label: `program icon ${route.model}` }) : undefined
    });
    const quality = ['low', 'medium', 'high'].includes(settings().quality) ? settings().quality : DEFAULT_QUALITY;
    const req = { model: route.apiModel, prompt, background: 'transparent', output_format: 'png', size: '1024x1024', quality, n: 1 };
    let result;
    if (refBuffers.length) {
        const files = [];
        for (let i = 0; i < refBuffers.length; i++) files.push(await OpenAI.toFile(refBuffers[i], `reference-${i + 1}.png`, { type: 'image/png' }));
        result = await client.images.edit({ ...req, image: files });
    } else {
        result = await client.images.generate(req);
    }
    const b64 = result && result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) throw new Error('The image answer had no picture.');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('The image answer was not a PNG.');
    return buf;
}

/**
 * One WM size, cut to a small palette with no dithering (Yukimi, Nov 12: Windows Mobile art had
 * limited colour and staggered shading; the model's smooth gradients fall into bands). config
 * wmProgramIcons.colours (default 32; 0 = full colour).
 */
async function renderWm(square, size) {
    const out = await wmIconGenerator.renderSize(square, size);
    const n = settings().colours === undefined ? 32 : Math.floor(Number(settings().colours));
    if (!Number.isFinite(n) || n < 2) return out;
    return sharp(out).png({ palette: true, colours: Math.min(256, n), dither: 0, compressionLevel: 9 }).toBuffer();
}

// ---------------------------------------------------------------- jobs

function saveJob(job) {
    job.updatedAt = Date.now();
    try { atomicWrite(path.join(jobsDir(), `${job.id}.json`), JSON.stringify(job)); } catch (err) { console.warn('[wmProgramIcons] job not saved', err.message); }
}

function jobState(job) {
    if (job.state === 'done' || job.state === 'cancelled') return job.state;
    return job.items.some((it) => it.state === 'queued' || it.state === 'working') ? 'working' : 'ready';
}

function publicJob(job) {
    return {
        id: job.id,
        state: jobState(job),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        provider: job.provider || null,
        model: job.model || null,
        items: job.items.map((it) => ({
            key: it.key,
            id: it.id,
            package: it.package,
            label: it.label,
            state: it.state,
            error: it.error || null,
            attempt: it.attempt,
            mode: normMode(it.mode),
            note: it.note || null,
            direction: it.direction || null,
            preview: it.preview ? Object.fromEntries(PREVIEW_SIZES.map((s) => [s, `/api/wm-program-icons/jobs/${job.id}/files/${it.preview}-${s}.png`])) : null,
            original: it.hasRef ? `/api/wm-program-icons/jobs/${job.id}/files/${it.key}-ref.png` : null,
            store: it.store || null
        }))
    };
}

function loadJobs() {
    let names = [];
    try { names = fs.readdirSync(jobsDir()).filter((n) => n.endsWith('.json')); } catch (_) { return; }
    for (const n of names) {
        const job = readJson(path.join(jobsDir(), n), null);
        if (!job || !job.id || !Array.isArray(job.items)) continue;
        if (Date.now() - (job.updatedAt || job.createdAt || 0) > JOB_KEEP_MS) {
            try { fs.rmSync(jobDir(job.id), { recursive: true, force: true }); fs.unlinkSync(path.join(jobsDir(), n)); } catch (_) { /* kept */ }
            continue;
        }
        let changed = false;
        for (const it of job.items) {
            if (it.state === 'queued' || it.state === 'working') { it.state = 'failed'; it.error = 'Stopped when the server restarted.'; changed = true; }
        }
        if (changed) saveJob(job);
        jobs.set(job.id, job);
    }
}

function pump() {
    while (running < CONCURRENCY && queue.length) {
        const next = queue.shift();
        if (next.job.state === 'cancelled' || next.item.state !== 'queued') continue;
        running++;
        runItem(next.job, next.item).catch(() => {}).finally(() => {
            running--;
            saveJob(next.job);
            pump();
        });
    }
}

async function runItem(job, item) {
    item.state = 'working';
    item.error = null;
    saveJob(job);
    try {
        const dir = jobDir(job.id);
        const ctx = item.context !== undefined ? item.context : (item.context = await playStoreContext(item.package));
        const refs = [];
        const refNames = [];
        const refPath = path.join(dir, `${item.key}-ref.png`);
        if (fs.existsSync(refPath)) { refs.push(fs.readFileSync(refPath)); refNames.push('the app\'s own launcher icon'); }
        const playPath = path.join(dir, `${item.key}-play.png`);
        if (!fs.existsSync(playPath) && ctx && ctx.iconUrl) {
            try {
                const r = await fetchWithTimeout(ctx.iconUrl, {}, 15000);
                if (r.ok) atomicWrite(playPath, await sharp(Buffer.from(await r.arrayBuffer())).resize(512, 512, { fit: 'inside' }).png().toBuffer());
            } catch (_) { /* the launcher icon is enough */ }
        }
        if (fs.existsSync(playPath)) { refs.push(fs.readFileSync(playPath)); refNames.push('its Play Store icon'); }
        const route = await chooseRoute();
        job.provider = route.provider;
        job.model = route.model;
        item.attempt = (item.attempt || 0) + 1;
        const isGame = item.game || /game/i.test(String((ctx && ctx.category) || item.category || ''));
        let mode = normMode(item.mode);
        item.note = null;
        let useRefs = refs;
        let useNames = refNames;
        let brief = null;
        if (mode === 'simple') {
            // Simple works from the real mark only: the themed icon and the logo in the store art,
            // with the icons for colour; a game with neither is made in the Detailed style instead
            const own = [];
            const ownNames = [];
            const themedPath = path.join(dir, `${item.key}-themed.png`);
            if (fs.existsSync(themedPath)) { own.push(fs.readFileSync(themedPath)); ownNames.push('the app\'s themed icon (its own one-colour mark: the shape to keep)'); }
            const logo = await findLogo(item, ctx, dir);
            if (logo.found) { own.push(fs.readFileSync(path.join(dir, `${item.key}-logo.png`))); ownNames.push(`its official logo, cropped from its store art (${logo.what || 'logo'})`); }
            if (own.length) {
                useRefs = own.concat(refs);
                useNames = ownNames.concat(refNames.map((n) => `${n} (for its colours)`));
            } else if (isGame) {
                mode = 'detailed';
                item.note = 'No logo or themed icon to work from: made in the Detailed style.';
            }
        }
        if (mode === 'detailed' && isGame && refs.length) {
            // a game in Detailed: drawn from a brief of its objects, with no picture to cut out
            if (!item.briefs || typeof item.briefs !== 'object') item.briefs = {};
            if (item.briefs.detailed === undefined) item.briefs.detailed = await describeIcon(item.label, refs.slice().reverse(), 'detailed');
            brief = item.briefs.detailed;
        }
        // the user's attached pictures come first, and the text says how to use them (#776)
        const att = [];
        for (let i = 0; i < (item.attachments || 0); i++) {
            const f = path.join(dir, `${item.key}-att${i}.png`);
            if (fs.existsSync(f)) att.push(fs.readFileSync(f));
        }
        if (att.length) {
            brief = null;
            useRefs = att.concat(useRefs);
            useNames = att.map((_, i) => `picture ${i + 1} the user attached (use it as their direction says: a character or object to draw, an icon design to follow)`).concat(useNames);
        }
        const style = settings().styleRefs === false ? [] : await styleRefs();
        const prompt = buildPrompt({ ...item, mode }, ctx, item.attempt, brief ? [] : useNames, brief, style.length);
        const master = await requestIcon(route, prompt, (brief ? [] : useRefs).concat(style));
        const base = `${item.key}-${item.attempt}`;
        atomicWrite(path.join(dir, `${base}.png`), master);
        const square = await wmIconGenerator.squareFromCrop(master, await wmIconGenerator.autoCrop(master));
        for (const s of PREVIEW_SIZES) atomicWrite(path.join(dir, `${base}-${s}.png`), await renderWm(square, s));
        item.preview = base;
        item.state = 'ready';
    } catch (err) {
        item.state = 'failed';
        item.error = collapse(err && err.message ? err.message : err).slice(0, 300) || 'Failed.';
        console.warn(`[wmProgramIcons] ${item.package}: ${item.error}`);
    }
}

function enqueue(job, item) {
    item.state = 'queued';
    item.error = null;
    queue.push({ job, item });
}

async function createJob(body) {
    const list = Array.isArray(body && body.items) ? body.items : [];
    if (!list.length) throw Object.assign(new Error('Choose at least one program.'), { status: 400 });
    if (list.length > MAX_ITEMS) throw Object.assign(new Error(`Up to ${MAX_ITEMS} programs at a time.`), { status: 400 });
    const id = `j${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const dir = jobDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const job = { id, createdAt: Date.now(), updatedAt: Date.now(), state: 'working', items: [] };
    const seen = new Set();
    for (const raw of list) {
        const appId = collapse(raw && raw.id);
        if (!/^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/.test(appId) || seen.has(appId)) continue;
        seen.add(appId);
        const item = {
            key: crypto.createHash('sha1').update(appId).digest('hex').slice(0, 12),
            id: appId,
            package: appId.split('/')[0],
            label: collapse(raw.label).slice(0, 80) || appId.split('/')[0],
            category: collapse(raw.category).slice(0, 32) || null,
            game: raw.game === true,
            mode: normMode(raw.mode || (body && body.mode)),
            // a custom request: what the user wants this icon to be (kept for Regenerate)
            direction: collapse(raw.direction).slice(0, 600) || null,
            attempt: 0,
            hasRef: false
        };
        const m = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(raw.icon || ''));
        if (m) {
            const buf = Buffer.from(m[2], 'base64');
            if (buf.length > 0 && buf.length <= MAX_ICON_BYTES) {
                try {
                    atomicWrite(path.join(dir, `${item.key}-ref.png`), await sharp(buf).resize(512, 512, { fit: 'inside' }).png().toBuffer());
                    item.hasRef = true;
                } catch (_) { /* not an image: the store icon will do */ }
            }
        }
        // a custom request's pictures (a character to draw, another icon to follow; #776): up to 3
        item.attachments = 0;
        const atts = Array.isArray(raw.attachments) ? raw.attachments.slice(0, MAX_ATTACHMENTS) : [];
        for (const att of atts) {
            const a = /^data:image\/(png|webp|jpeg|gif|bmp);base64,([A-Za-z0-9+/=]+)$/.exec(String((att && att.data) || ''));
            if (!a) continue;
            const buf = Buffer.from(a[2], 'base64');
            if (!buf.length || buf.length > MAX_ATTACHMENT_BYTES) continue;
            try {
                atomicWrite(path.join(dir, `${item.key}-att${item.attachments}.png`), await sharp(buf).rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true }).png().toBuffer());
                item.attachments++;
            } catch (_) { /* not a picture */ }
        }
        const t = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(raw.themed || ''));
        if (t) {
            const buf = Buffer.from(t[2], 'base64');
            if (buf.length > 0 && buf.length <= MAX_ICON_BYTES) {
                try {
                    atomicWrite(path.join(dir, `${item.key}-themed.png`), await sharp(buf).resize(512, 512, { fit: 'inside' }).png().toBuffer());
                    item.hasThemed = true;
                } catch (_) { /* not an image */ }
            }
        }
        job.items.push(item);
    }
    if (!job.items.length) throw Object.assign(new Error('No program in the request could be read.'), { status: 400 });
    jobs.set(id, job);
    job.items.forEach((it) => enqueue(job, it));
    saveJob(job);
    pump();
    return job;
}

function regenerate(job, keys, mode) {
    if (job.state === 'done' || job.state === 'cancelled') throw Object.assign(new Error('This batch is closed.'), { status: 409 });
    const want = new Set(Array.isArray(keys) ? keys.map(String) : []);
    let n = 0;
    for (const it of job.items) {
        if (!want.has(it.key) || it.state === 'queued' || it.state === 'working') continue;
        if (mode) it.mode = normMode(mode);
        enqueue(job, it);
        n++;
    }
    saveJob(job);
    pump();
    return n;
}

async function finish(job, accept) {
    if (job.state === 'done' || job.state === 'cancelled') throw Object.assign(new Error('This batch is closed.'), { status: 409 });
    if (jobState(job) === 'working') throw Object.assign(new Error('Some icons are still being made.'), { status: 409 });
    const want = new Set(Array.isArray(accept) ? accept.map(String) : []);
    const manifest = readManifest();
    const saved = [];
    for (const it of job.items) {
        if (!want.has(it.key) || it.state !== 'ready' || !it.preview) continue;
        const master = fs.readFileSync(path.join(jobDir(job.id), `${it.preview}.png`));
        const square = await wmIconGenerator.squareFromCrop(master, await wmIconGenerator.autoCrop(master));
        const name = setName(it);
        for (const s of wmIconGenerator.SIZES) atomicWrite(path.join(storeDir(), `${name}${s.suffix}.png`), await renderWm(square, s.size));
        const old = manifest.icons[it.id];
        manifest.icons[it.id] = { name, package: it.package, label: it.label, model: job.model || null, updatedAt: new Date().toISOString() };
        if (old && old.name && old.name !== name) removeSet(old.name);
        it.store = `${STORE_WEB}/${name}`;
        saved.push(it.id);
    }
    if (saved.length) {
        manifest.version = (manifest.version || 0) + 1;
        manifest.updatedAt = new Date().toISOString();
        atomicWrite(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
        await recompileWithin(120000);
    }
    job.state = 'done';
    saveJob(job);
    return saved;
}

function removeFromStore(id) {
    const manifest = readManifest();
    const e = manifest.icons[id];
    if (!e) return false;
    delete manifest.icons[id];
    removeSet(e.name);
    manifest.version = (manifest.version || 0) + 1;
    manifest.updatedAt = new Date().toISOString();
    atomicWrite(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
    return true;
}

// ---------------------------------------------------------------- HTTP

function mount(app, authMiddleware, globalResources) {
    boundGr = globalResources || null;
    projectRoot = PROJECT_ROOT;
    loadJobs();
    const auth = authMiddleware || ((req, res, next) => next());
    const admin = (req, res, next) => (req.userType === 'admin' || req.userType === 'dev_admin' ? next() : res.status(403).json({ success: false, error: 'Only an administrator can change program icons.' }));
    const json = express.json({ limit: `${Math.ceil((MAX_ICON_BYTES * 1.4 * MAX_ITEMS) / (1024 * 1024)) + 2}mb` });
    const fail = (res, err) => res.status(err && err.status ? err.status : 500).json({ success: false, error: err && err.message ? err.message : String(err) });
    const jobOr404 = (req, res) => {
        const job = jobs.get(String(req.params.job || ''));
        if (!job) { res.status(404).json({ success: false, error: 'No such batch.' }); return null; }
        return job;
    };
    const base = '/api/wm-program-icons';

    app.get(`${base}/manifest`, auth, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, ...publicManifest() });
    });
    app.get(`${base}/jobs`, auth, admin, (req, res) => {
        res.set('Cache-Control', 'no-store');
        const list = [...jobs.values()].filter((j) => j.state !== 'done' && j.state !== 'cancelled').sort((a, b) => b.createdAt - a.createdAt).map(publicJob);
        res.json({ success: true, jobs: list });
    });
    app.post(`${base}/jobs`, auth, admin, json, async (req, res) => {
        try { res.json({ success: true, job: publicJob(await createJob(req.body)) }); } catch (err) { fail(res, err); }
    });
    app.get(`${base}/jobs/:job`, auth, admin, (req, res) => {
        const job = jobOr404(req, res);
        if (!job) return;
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, job: publicJob(job) });
    });
    app.get(`${base}/jobs/:job/files/:file`, auth, admin, (req, res) => {
        const job = jobOr404(req, res);
        if (!job) return;
        const file = String(req.params.file || '');
        if (!/^[a-f0-9]{12}-(ref|themed|logo|\d+-(16|32|128))\.png$/.test(file)) return res.status(404).end();
        const p = path.join(jobDir(job.id), file);
        if (!fs.existsSync(p)) return res.status(404).end();
        res.set('Cache-Control', 'private, max-age=86400');
        res.type('png');
        fs.createReadStream(p).pipe(res);
    });
    app.post(`${base}/jobs/:job/regenerate`, auth, admin, json, (req, res) => {
        const job = jobOr404(req, res);
        if (!job) return;
        try { const n = regenerate(job, req.body && req.body.keys, req.body && req.body.mode); res.json({ success: true, queued: n, job: publicJob(job) }); } catch (err) { fail(res, err); }
    });
    app.post(`${base}/jobs/:job/done`, auth, admin, json, async (req, res) => {
        const job = jobOr404(req, res);
        if (!job) return;
        try { const saved = await finish(job, req.body && req.body.accept); res.json({ success: true, saved, manifest: publicManifest() }); } catch (err) { fail(res, err); }
    });
    app.post(`${base}/jobs/:job/cancel`, auth, admin, (req, res) => {
        const job = jobOr404(req, res);
        if (!job) return;
        job.state = 'cancelled';
        job.items.forEach((it) => { if (it.state === 'queued') { it.state = 'failed'; it.error = 'Cancelled.'; } });
        saveJob(job);
        res.json({ success: true });
    });
    app.delete(`${base}/store`, auth, admin, async (req, res) => {
        const id = collapse(req.query && req.query.id);
        if (!removeFromStore(id)) return res.status(404).json({ success: false, error: 'That program has no Windows Mobile icon.' });
        await recompileWithin(120000);
        res.json({ success: true, manifest: publicManifest() });
    });
}

module.exports = {
    mount,
    buildPrompt,
    playStoreContext,
    chooseRoute,
    publicManifest,
    _test: { versionOf, TAKES, createJob, finish, removeFromStore, jobs, setRoot: (r) => { projectRoot = r; } }
};
