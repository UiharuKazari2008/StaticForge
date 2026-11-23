'use strict';

/**
 * Program Icons (Yozora #773): Windows Mobile versions of a phone's Android programs' icons,
 * made on request and kept in one store every phone shares.
 *
 * Melaton Mobile's Settings > Personal > Program Icons sends a batch of the phone's programs (each
 * with its own unthemed launcher icon, read from the app, and its name and Android category). For
 * each one the server reads the program's Play Store page (title, description, category, developer,
 * store icon) and makes the icon in steps that leave the image model nothing to decide (Nov 22 2026,
 * modules/wmProgramIconPrompt.js): a vision model writes a brief of the icon, code picks the
 * treatment, and the image model draws that brief twice from fixed texts - the phone's Windows Mobile
 * icon and the desktop's Windows Vista icon (every program has both: the DeX desktop draws the Vista
 * one). Each drawing is measured and drawn again when it is cut off or sits on a tile. The page lists
 * them; the user keeps some, asks again for others, and presses Done: the kept ones go to the store
 * and the runtime assets are recompiled, so every phone that lists the same program draws the new icon.
 *
 * Store (served like the shell art; the phone's sets are in its art packages, the Vista set is
 * fetched on first use and kept by the service worker):
 *   public/static_images/wm-android/<name>.png, @2x, @4x, -lg, -lg@2x, -lg@4x   Windows Mobile 6.1
 *       (wmIconGenerator SIZES: 16/32/64 and 32/64/128; 256 colours and a hard mask, as the ROM's)
 *   public/static_images/wm-android/<name>-65.png, -65@2x, -65@4x               Windows Mobile 6.5 Start
 *       (45/90/180: the art in the ROM's 80-of-90 box with its contact shadow, full colour)
 *   public/static_images/wm-android/<name>-vista-<16|24|32|48|64|96|128|256>.png  Windows Vista (desktop)
 *   public/static_images/wm-android/manifest.json  { version, updatedAt, icons: { "<package>/<activity>":
 *                                                     { name, package, label, model, updatedAt, wm65?, vista?, object? } } }
 *       (object: the period object it shows, so a new icon of the same kind takes another one)
 *       (wm65 / vista: the set has those files; sets made before Nov 22 2026 have the 6.1 files only)
 * A new icon gets a new name, so no client keeps an old copy under a path it reuses.
 *
 * Jobs: .cache/wm-program-icons/jobs/<job>.json and <job>/ (references, masters, previews).
 * Play Store answers are kept a week in .cache/wm-program-icons/play/<package>.json.
 *
 * Image route (Yukimi, Nov 12: OpenAI's latest image model; TokenRouter when it can, for one wallet):
 * config.json wmProgramIcons { provider: 'auto' | 'tokenrouter' | 'openai', model?, quality?, briefModel?,
 * colours? (palette per Windows Mobile 6.1 size, default 256 as the ROM's icons, 0 = full colour),
 * styleRefs? (false = no platform icons attached as rendering references),
 * design? ('mark' = a program's symbol is drawn itself, as a glossy emblem; default: as an object of 2007-2009
 * in the brand's colours with the symbol as a small badge - wmProgramIconPrompt.js) }.
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
 *   POST /api/wm-program-icons/jobs/missing               a batch of the store's programs that have no Vista
 *                                                         icon yet (made from their Play Store icons)
 *   POST /api/wm-program-icons/jobs/:job/regenerate       { keys: [...], mode? }
 *   POST /api/wm-program-icons/jobs/:job/done             { accept: [...] } -> store, recompile
 *   POST /api/wm-program-icons/jobs/:job/cancel
 *   DELETE /api/wm-program-icons/store?id=<package/activity>   back to the Android icon
 *
 * Pushed (#890 P15): every change of a job (an icon starts, is ready or failed, the batch is closed)
 * goes to the sessions that made or asked about it as wm_program_icons_job { success, job } (the
 * GET /jobs/:job answer), so the page need not poll while its socket is up.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const OpenAI = require('openai');
const appIconGenerator = require('./appIconGenerator');
const wmIconGenerator = require('./wmIconGenerator');
const iconPrompt = require('./wmProgramIconPrompt');

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
// the other sets' previews: the 6.5 Start icon at 2x and the Vista icon at 128
const PREVIEW_EXTRA = ['65', 'vista'];
// Windows Mobile 6.5 Start icons (ROM: 45 px, VGA 90; ours 180)
const WM65_SIZES = Object.freeze([{ suffix: '-65', size: 45 }, { suffix: '-65@2x', size: 90 }, { suffix: '-65@4x', size: 180 }]);
// the desktop's sizes (16..48 lists, taskbar, Start; 96..256 desktop icons and 2x)
const VISTA_SIZES = Object.freeze([16, 24, 32, 48, 64, 96, 128, 256]);
// one more draw when the measured check fails
const MAX_DRAWS = 2;

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
        if (e && e.name) icons[id] = { icon: `${STORE_WEB}/${e.name}`, package: e.package || id.split('/')[0], label: e.label || '', updatedAt: e.updatedAt || null, wm65: e.wm65 === true, vista: e.vista === true };
    }
    return { version: m.version || 0, updatedAt: m.updatedAt || null, icons };
}

function removeSet(name) {
    if (!/^[a-z0-9_-]+$/.test(String(name || ''))) return;
    const files = wmIconGenerator.SIZES.concat(WM65_SIZES).map((s) => `${name}${s.suffix}.png`).concat(VISTA_SIZES.map((px) => `${name}-vista-${px}.png`));
    for (const f of files) {
        try { fs.unlinkSync(path.join(storeDir(), f)); } catch (_) { /* gone already, or a set without it */ }
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
//   simple    the app's mark or one object; a game gets its emblem or the one object it is known
//             for, never a figure (the brief is asked without the "character" treatment)
//   detailed  a game whose icon is a character keeps that character, as a free-standing bust
// For a program that is not a game the two give the same brief. The texts are in wmProgramIconPrompt.js.
const MODES = ['simple', 'detailed'];
const normMode = (m) => (MODES.includes(m) ? m : 'detailed');

// The platform's own icons that go with a request as rendering references, flattened on white (the
// model reads a transparent reference's edges as dark fringes). Kept per file.
const styleBuffers = new Map();
async function styleRefs(style, brief) {
    if (settings().styleRefs === false) return [];
    const out = [];
    for (const rel of iconPrompt.styleRefs(style, brief)) {
        if (!styleBuffers.has(rel)) {
            let buf = null;
            try {
                buf = await sharp(path.join(projectRoot, 'public', 'static_images', rel)).resize(512, 512, { fit: 'contain', background: '#ffffff' })
                    .flatten({ background: '#ffffff' }).png().toBuffer();
            } catch (_) { buf = null; }
            styleBuffers.set(rel, buf);
        }
        if (styleBuffers.get(rel)) out.push(styleBuffers.get(rel));
    }
    return out;
}

// ---------------------------------------------------------------- image route

function settings() {
    let cfg = null;
    try { cfg = boundGr && boundGr.getConfig({ path: 'wmProgramIcons' }); } catch (_) { cfg = null; }
    if (!cfg) cfg = (readJson(path.join(projectRoot, 'config.json'), {}) || {}).wmProgramIcons;
    cfg = cfg && typeof cfg === 'object' ? { ...cfg } : {};
    // a one-off comparison run from a script (WM_PROGRAM_ICONS_MODEL=gpt-image-2.5-sunburst)
    if (process.env.WM_PROGRAM_ICONS_MODEL) cfg.model = process.env.WM_PROGRAM_ICONS_MODEL;
    // and its route and preset (a cheap test run: WM_PROGRAM_ICONS_PROVIDER=openai WM_PROGRAM_ICONS_QUALITY=low)
    if (process.env.WM_PROGRAM_ICONS_PROVIDER) cfg.provider = process.env.WM_PROGRAM_ICONS_PROVIDER;
    if (process.env.WM_PROGRAM_ICONS_QUALITY) cfg.quality = process.env.WM_PROGRAM_ICONS_QUALITY;
    if (process.env.WM_PROGRAM_ICONS_DESIGN) cfg.design = process.env.WM_PROGRAM_ICONS_DESIGN;
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
 * A request to the brief model (the vision brief, the kind-of-program row, the logo finder): OpenAI directly, and
 * TokenRouter's copy of the same model when OpenAI answers that the account has no credit (Nov 23 2026: the OpenAI
 * wallet ran dry mid-batch while TokenRouter still had funds; the drawings already fall back the other way).
 * opts: fetch options with the OpenAI Authorization header and a JSON body naming the model.
 */
async function briefFetch(opts, ms) {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', opts, ms);
    if (res.status !== 429 && res.status !== 402 && res.status !== 403) return res;
    const text = await res.clone().text().catch(() => '');
    if (!/insufficient_quota|credit_balance_exhausted|no credits/i.test(text)) return res;
    const trKey = tokenRouterKey();
    if (!trKey) return res;
    let body = null;
    try { body = JSON.parse(opts.body); } catch (_) { return res; }
    if (body && body.model && !String(body.model).includes('/')) body.model = `openai/${body.model}`;
    console.warn('[wmProgramIcons] OpenAI has no credit: the brief asked through TokenRouter');
    const gate = require('./tokenRouterGate');
    return gate.run(() => fetchWithTimeout(`${tokenRouterBase()}/v1/chat/completions`, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${trKey}` }, body: JSON.stringify(body) }, ms), { lane: 'background', label: 'program icon brief' });
}

/**
 * The period object for a program whose icon is a symbol (wmProgramIconPrompt.js periodPrompt): the
 * brief model answers a row number, the row's fixed words are the object. null: no row fits (the
 * symbol is drawn itself). Kept with the Play Store answer's lifetime, per package.
 */
async function periodRow(item, ctx) {
    if (stubs && stubs.period) return stubs.period(item, ctx);
    const file = path.join(cacheDir(), 'period', `${String(item.package).replace(/[^A-Za-z0-9_.]/g, '_')}.json`);
    const cached = readJson(file, null);
    if (cached && cached.rows === iconPrompt.PERIOD_OBJECTS.length && Date.now() - (cached.at || 0) < PLAY_TTL_MS) return cached.row ? iconPrompt.PERIOD_OBJECTS[cached.row - 1] : null;
    let key = null;
    try { key = appIconGenerator.resolveOpenAiKey(projectRoot).apiKey; } catch (_) { throw new Error('No OpenAI key for the icon brief (Security Center > API keys).'); }
    const text = iconPrompt.periodPrompt(item.label, { category: (ctx && ctx.category) || item.category || (item.game ? 'game' : ''), description: ctx && ctx.description });
    for (let i = 0; i < 3; i++) {
        try {
            const res = await briefFetch({
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: collapse(settings().briefModel) || 'gpt-5.4-mini', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: text }] })
            }, 60000);
            if (!res.ok) continue;
            const j = await res.json();
            const raw = JSON.parse((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}');
            const row = iconPrompt.parsePeriod(raw);
            if (row === undefined) continue;
            try { atomicWrite(file, JSON.stringify({ at: Date.now(), rows: iconPrompt.PERIOD_OBJECTS.length, row: row ? Number(raw.row) : 0 })); } catch (_) { /* asked again next time */ }
            return row;
        } catch (_) { /* asked again */ }
    }
    throw new Error('No answer on what kind of program this is.');
}

/**
 * The brief of a program's icon (wmProgramIconPrompt.js briefPrompt / normaliseBrief): a vision model
 * describes what is drawn, code picks the treatment. Asked three times at most (an answer that is not a
 * brief is asked again). config wmProgramIcons.briefModel (default gpt-5.4-mini, OpenAI directly).
 * Throws when no brief could be had: without one nothing is drawn (a guess is what made results vary).
 */
async function iconBrief(name, refBuffers, opts) {
    if (stubs && stubs.brief) return iconPrompt.normaliseBrief(await stubs.brief(name, refBuffers, opts));
    let key = null;
    try { key = appIconGenerator.resolveOpenAiKey(projectRoot).apiKey; } catch (_) { throw new Error('No OpenAI key for the icon brief (Security Center > API keys).'); }
    const model = collapse(settings().briefModel) || 'gpt-5.4-mini';
    const content = [{ type: 'text', text: iconPrompt.briefPrompt(name, opts) }];
    for (const b of refBuffers.slice(0, 4)) {
        const png = await sharp(b).resize(512, 512, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer();
        content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } });
    }
    let why = 'no answer';
    for (let i = 0; i < 3; i++) {
        try {
            const res = await briefFetch({
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] })
            }, 90000);
            if (!res.ok) { why = `the brief model answered ${res.status}`; continue; }
            const j = await res.json();
            const brief = iconPrompt.normaliseBrief(JSON.parse((j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}'));
            if (brief) return brief;
            why = 'the answer was not a brief';
        } catch (err) { why = collapse(err && err.message ? err.message : err).slice(0, 120) || why; }
    }
    throw new Error(`No brief of the icon (${why}).`);
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
        const res = await briefFetch({
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

// (a test draws and briefs with its own functions: _test.stub)
let stubs = null;

async function requestIcon(route, prompt, refBuffers) {
    if (stubs && stubs.request) return stubs.request(route, prompt, refBuffers);
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
 * One Windows Mobile 6.1 size in the ROM's own format: the ROM's 16 / 32 / 64 px program icons are
 * 8-bit pictures (87 to 253 colours each, measured on the 6.1 dump) with a hard mask, drawn with smooth
 * shading, so each size gets its own 256-colour palette with no dithering. config
 * wmProgramIcons.colours (default 256; 0 = full colour).
 */
async function renderWm(square, size) {
    const out = await wmIconGenerator.renderSize(square, size);
    const n = settings().colours === undefined ? 256 : Math.floor(Number(settings().colours));
    if (!Number.isFinite(n) || n < 2) return out;
    return sharp(out).png({ palette: true, colours: Math.min(256, n), dither: 0, compressionLevel: 9 }).toBuffer();
}

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** The picture's opaque box (alpha >= 128) as { left, top, right, bottom } in its own pixels, or null. */
async function opaqueBox(buf) {
    const b = await wmIconGenerator.bodyBox(buf);
    return b ? { left: b.minX, top: b.minY, right: b.maxX, bottom: b.maxY } : null;
}

/**
 * One Windows Mobile 6.5 Start icon, laid out as the ROM's (measured on start-*@2x.png, 90 px): the art
 * inside an 80 px box that starts 4 px from the top and is centred across, and under it the ROM's
 * contact shadow, a flat soft ellipse that ends 3 px below the art. Full colour, soft edge. The shadow
 * is drawn here, the same for every icon, never by the image model.
 */
async function render65(square, px) {
    const u = px / 90;
    const box = Math.round(80 * u);
    const left = Math.round((px - box) / 2);
    const top = Math.round(4 * u);
    const art = await sharp(square).resize(box, box, { fit: 'contain', background: CLEAR, kernel: sharp.kernel.lanczos3 })
        .sharpen({ sigma: px <= 45 ? 0.6 : 0.4, m1: 0.5, m2: 1 }).png().toBuffer();
    const layers = [];
    const b = await opaqueBox(art);
    if (b) {
        const cx = left + (b.left + b.right + 1) / 2;
        const base = top + b.bottom + 1;
        const rx = Math.max(2 * u, (b.right - b.left + 1) * 0.44);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><defs><filter id="f" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="${(1.3 * u).toFixed(2)}"/></filter></defs><ellipse cx="${cx.toFixed(2)}" cy="${(base - 0.5 * u).toFixed(2)}" rx="${rx.toFixed(2)}" ry="${(1.8 * u).toFixed(2)}" fill="#000" fill-opacity="0.5" filter="url(#f)"/></svg>`;
        layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
    }
    layers.push({ input: art, left, top });
    return sharp({ create: { width: px, height: px, channels: 4, background: CLEAR } }).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * One Windows Vista size for the desktop: the art in 86% of the square, a little above centre, on the
 * soft drop shadow Vista's own icons carry (from 32 px up; its 16 and 24 px frames have none). The
 * shadow is the art's own silhouette, blurred and set down and to the right, the same for every icon.
 */
async function renderVista(square, px) {
    const box = Math.round(px * 0.86);
    const left = Math.round((px - box) / 2);
    const top = Math.max(0, Math.round((px - box) / 2 - px * 0.02));
    let art = sharp(square).resize(box, box, { fit: 'contain', background: CLEAR, kernel: sharp.kernel.lanczos3 });
    if (px <= 48) art = art.sharpen({ sigma: 0.5, m1: 0.8, m2: 1.6 });
    art = await art.png().toBuffer();
    const layers = [];
    if (px >= 32) {
        const shadow = await sharp(art).ensureAlpha().linear([0, 0, 0, 0.4], [0, 0, 0, 0])
            .extend({ top, bottom: px - box - top, left, right: px - box - left, background: CLEAR })
            .blur(Math.max(0.6, px * 0.022)).png().toBuffer();
        layers.push({ input: shadow, left: Math.round(px * 0.012), top: Math.round(px * 0.03) });
    }
    layers.push({ input: art, left, top });
    return sharp({ create: { width: px, height: px, channels: 4, background: CLEAR } }).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

/** A drawing measured (wmProgramIconPrompt.js checkMaster): null when fine, else 'clipped' | 'plate' | 'empty'. */
async function checkDrawing(master, brief) {
    const { data, info } = await sharp(master).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
    return iconPrompt.checkMaster(data, info.width, info.height, brief);
}

/**
 * One style's drawing of a brief: the fixed text, the program's pictures first and the platform's
 * icons last. A drawing that fails the measured check is drawn once more with one sentence added;
 * the second is kept either way, with a note when it still fails.
 */
/**
 * The route for a request after TokenRouter refused it for lack of credit (403 insufficient_user_quota):
 * with provider 'auto' and an OpenAI key, OpenAI directly, for the next ten minutes (Yukimi, Nov 22 2026:
 * "use the OpenAI account for now" while the TokenRouter wallet was empty). null: no other route.
 */
let directUntil = 0;
function directRoute(route) {
    const want = settings().provider;
    if (route.provider !== 'tokenrouter' || want === 'tokenrouter') return null;
    let key = null;
    try { key = appIconGenerator.resolveOpenAiKey(projectRoot).apiKey; } catch (_) { return null; }
    return key ? { provider: 'openai', model: route.model, apiModel: route.model, baseURL: undefined, apiKey: key } : null;
}
const outOfCredit = (err) => !!err && (err.status === 403 || err.status === 402) && /insufficient|quota|recharge|balance|forbidden/i.test(`${err.code || ''} ${err.message || ''}`);

async function requestIconRouted(route, prompt, refBuffers) {
    const direct = directRoute(route);
    if (direct && Date.now() < directUntil) return requestIcon(direct, prompt, refBuffers);
    try {
        return await requestIcon(route, prompt, refBuffers);
    } catch (err) {
        if (!direct || !outOfCredit(err)) throw err;
        console.warn('[wmProgramIcons] TokenRouter has no credit: drawing through OpenAI directly for ten minutes');
        directUntil = Date.now() + 10 * 60 * 1000;
        return requestIcon(direct, prompt, refBuffers);
    }
}

async function drawStyle(route, style, name, brief, brand, opts) {
    const refs = await styleRefs(style, brief);
    const text = iconPrompt.renderPrompt(style, name, brief, { brandRefs: brand.length, userRefs: opts.userRefs, styleCount: refs.length, direction: opts.direction });
    let master = null;
    let why = null;
    for (let i = 0; i < MAX_DRAWS; i++) {
        master = await requestIconRouted(route, why ? `${text}\n\n${iconPrompt.retryNote(why)}` : text, brand.concat(refs));
        why = await checkDrawing(master, brief);
        if (!why) break;
    }
    return { master, why, prompt: text };
}

// ---------------------------------------------------------------- jobs

function saveJob(job) {
    job.updatedAt = Date.now();
    try { atomicWrite(path.join(jobsDir(), `${job.id}.json`), JSON.stringify(job)); } catch (err) { console.warn('[wmProgramIcons] job not saved', err.message); }
    pushJob(job);
}

// ---- pushes (#890 P15): job id -> the session ids that made it or asked about it (in memory only)
const JOB_WATCHERS_MAX = 8;
const jobWatchers = new Map();
const pushPending = new Set();

/** A request about a job: its session hears of the job's changes from now on. */
function watchJob(job, req) {
    const sid = req && (req.sessionID || (req.session && req.session.id) || req.sessionId);
    if (!job || !sid) return;
    let set = jobWatchers.get(job.id);
    if (!set) { set = new Set(); jobWatchers.set(job.id, set); }
    set.delete(String(sid));
    set.add(String(sid));
    if (set.size > JOB_WATCHERS_MAX) set.delete(set.values().next().value);
}

/** wm_program_icons_job to the job's sessions, once per turn of the event loop however many changes. */
function pushJob(job) {
    if (!job || !jobWatchers.has(job.id) || pushPending.has(job.id)) return;
    pushPending.add(job.id);
    setImmediate(() => {
        pushPending.delete(job.id);
        const set = jobWatchers.get(job.id);
        if (!set || !set.size) return;
        let server = null;
        try { server = boundGr && typeof boundGr.getWebSocketServer === 'function' ? boundGr.getWebSocketServer() : null; } catch (_) { server = null; }
        if (!server || typeof server.sendToUser !== 'function') return;
        const message = { type: 'wm_program_icons_job', data: { success: true, job: publicJob(job) }, timestamp: new Date().toISOString() };
        for (const sid of set) {
            try { server.sendToUser(sid, message); } catch (_) { /* that session has no socket now */ }
        }
        // a closed batch changes no more
        if (job.state === 'done' || job.state === 'cancelled') jobWatchers.delete(job.id);
    });
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
            preview: it.preview ? Object.fromEntries(PREVIEW_SIZES.concat(it.sets === 2 ? PREVIEW_EXTRA : []).map((s) => [s, `/api/wm-program-icons/jobs/${job.id}/files/${it.preview}-${s}.png`])) : null,
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

const NOTES = {
    clipped: 'runs off the edge',
    plate: 'may still sit on a tile',
    empty: 'came back empty'
};

async function runItem(job, item) {
    item.state = 'working';
    item.error = null;
    saveJob(job);
    try {
        const dir = jobDir(job.id);
        const ctx = item.context !== undefined ? item.context : (item.context = await playStoreContext(item.package));
        // the program's own pictures: its launcher icon from the phone, its Play Store icon
        const own = [];
        const refPath = path.join(dir, `${item.key}-ref.png`);
        if (fs.existsSync(refPath)) own.push(fs.readFileSync(refPath));
        const playPath = path.join(dir, `${item.key}-play.png`);
        if (!fs.existsSync(playPath) && ctx && ctx.iconUrl) {
            try {
                const r = await fetchWithTimeout(ctx.iconUrl, {}, 15000);
                if (r.ok) atomicWrite(playPath, await sharp(Buffer.from(await r.arrayBuffer())).resize(512, 512, { fit: 'inside' }).png().toBuffer());
            } catch (_) { /* the launcher icon is enough */ }
        }
        if (fs.existsSync(playPath)) own.push(fs.readFileSync(playPath));
        const route = stubs && stubs.route ? stubs.route : await chooseRoute();
        job.provider = route.provider;
        job.model = route.model;
        item.attempt = (item.attempt || 0) + 1;
        const isGame = item.game || /game/i.test(String((ctx && ctx.category) || item.category || ''));
        const mode = normMode(item.mode);
        item.note = null;
        // Simple, for a game: its real mark (the logo found in its store art, its themed one-colour
        // icon) is what the brief is written from, ahead of the painted store icon
        const marks = [];
        if (mode === 'simple' && isGame) {
            const themedPath = path.join(dir, `${item.key}-themed.png`);
            const logo = await findLogo(item, ctx, dir);
            if (logo.found) marks.push(fs.readFileSync(path.join(dir, `${item.key}-logo.png`)));
            if (fs.existsSync(themedPath)) marks.push(fs.readFileSync(themedPath));
        }
        // the user's attached pictures come first (#776)
        const att = [];
        for (let i = 0; i < (item.attachments || 0); i++) {
            const f = path.join(dir, `${item.key}-att${i}.png`);
            if (fs.existsSync(f)) att.push(fs.readFileSync(f));
        }
        const pictures = marks.concat(own);
        if (!att.length && !pictures.length) throw new Error('No picture of this program to work from: request its icon from the phone (Settings > Personal > Program Icons).');
        // the brief: once per mode, kept for Regenerate (another draw of the same design, not another design)
        const bv = settings().design === 'mark' ? 'm2' : 'p4';
        if (!item.briefs || typeof item.briefs !== 'object' || item.briefs.v !== bv) item.briefs = { v: bv };
        if (!item.briefs[mode]) {
            item.briefs[mode] = await iconBrief(item.label, att.concat(pictures), {
                category: (ctx && ctx.category) || item.category || (item.game ? 'game' : ''),
                description: ctx && ctx.description,
                characters: mode !== 'simple',
                direction: item.direction
            });
        }
        // a symbol is drawn as an object of 2007-2009 carrying it (Yukimi, Nov 22: the glyphs alone look too
        // modern), unless the user attached pictures or config design is 'mark'; a typed direction is applied on
        // top (Yukimi, Nov 22: Gemini "as a white bubble" keeps its period balloon)
        if (item.briefs[mode].archetype === 'mark' && !item.briefs[mode].object && bv !== 'm2' && !att.length) {
            const row = await periodRow(item, ctx);
            // the row's object the fewest of the store's other icons show
            const used = Object.entries(readManifest().icons).filter(([id, e]) => id !== item.id && e && e.object).map(([, e]) => e.object);
            item.briefs[mode] = iconPrompt.withPeriod(item.briefs[mode], iconPrompt.pickVariant(row, used));
        }
        const brief = item.briefs[mode];
        // image 1 is the picture the outline is taken from; one picture of the program is enough (the
        // second only repeats it with another tile)
        const brand = att.concat(pictures.slice(0, 1));
        const opts = { userRefs: att.length, direction: item.direction };
        const base = `${item.key}-${item.attempt}`;
        const notes = [];
        const wm = await drawStyle(route, 'wm', item.label, brief, brand, opts);
        atomicWrite(path.join(dir, `${base}.png`), wm.master);
        if (wm.why) notes.push(`The phone icon ${NOTES[wm.why]}.`);
        const wmSquare = await wmIconGenerator.squareFromCrop(wm.master, await wmIconGenerator.autoCrop(wm.master));
        for (const s of PREVIEW_SIZES) atomicWrite(path.join(dir, `${base}-${s}.png`), await renderWm(wmSquare, s));
        atomicWrite(path.join(dir, `${base}-65.png`), await render65(wmSquare, 90));
        const vista = await drawStyle(route, 'vista', item.label, brief, brand, opts);
        atomicWrite(path.join(dir, `${base}-vista-master.png`), vista.master);
        if (vista.why) notes.push(`The desktop icon ${NOTES[vista.why]}.`);
        const vistaSquare = await wmIconGenerator.squareFromCrop(vista.master, await wmIconGenerator.autoCrop(vista.master));
        atomicWrite(path.join(dir, `${base}-vista.png`), await renderVista(vistaSquare, 128));
        if (notes.length) item.note = notes.join(' ');
        item.preview = base;
        item.sets = 2; // this drawing has the 6.5 and Vista previews too
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

async function createJob(body, req) {
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
        // a work profile's program carries its profile: "package/activity@u10" (#777)
        // (a store entry kept by package name alone comes back that way from jobs/missing)
        if (!/^[A-Za-z0-9_.]+(\/[A-Za-z0-9_.$]+)?(@u\d{1,6})?$/.test(appId) || seen.has(appId)) continue;
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
    watchJob(job, req);
    job.items.forEach((it) => enqueue(job, it));
    saveJob(job);
    pump();
    return job;
}

/**
 * Every program needs a Vista icon for the desktop, and the store's older sets have none: a batch of
 * those programs (up to MAX_ITEMS; the oldest sets first), drawn from their Play Store icons with no
 * phone in the loop. A program with no store page (a web app, a sideloaded build) fails in the batch
 * with the reason; it is requested from the phone instead. Answers { job, left } (left: programs
 * still without one after this batch), or null when every set has its Vista icon.
 */
async function missingJob(req) {
    const m = readManifest();
    const open = new Set();
    for (const j of jobs.values()) {
        if (j.state !== 'done' && j.state !== 'cancelled') j.items.forEach((it) => open.add(it.id));
    }
    const todo = Object.entries(m.icons)
        .filter(([id, e]) => e && e.name && e.vista !== true && !open.has(id))
        .sort((a, b) => String(a[1].updatedAt || '').localeCompare(String(b[1].updatedAt || '')));
    if (!todo.length) return null;
    const items = todo.slice(0, MAX_ITEMS).map(([id, e]) => ({ id, label: e.label || '', mode: 'detailed' }));
    return { job: await createJob({ items }, req), left: todo.length - items.length };
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
        for (const s of WM65_SIZES) atomicWrite(path.join(storeDir(), `${name}${s.suffix}.png`), await render65(square, s.size));
        // the desktop's Vista set (a batch from before Nov 22 2026 has no Vista drawing)
        let vista = false;
        const vistaMaster = path.join(jobDir(job.id), `${it.preview}-vista-master.png`);
        if (fs.existsSync(vistaMaster)) {
            const vm = fs.readFileSync(vistaMaster);
            const vs = await wmIconGenerator.squareFromCrop(vm, await wmIconGenerator.autoCrop(vm));
            for (const px of VISTA_SIZES) atomicWrite(path.join(storeDir(), `${name}-vista-${px}.png`), await renderVista(vs, px));
            vista = true;
        }
        const old = manifest.icons[it.id];
        const object = (it.briefs && it.briefs[normMode(it.mode)] && it.briefs[normMode(it.mode)].object) || undefined;
        manifest.icons[it.id] = { name, package: it.package, label: it.label, model: job.model || null, updatedAt: new Date().toISOString(), wm65: true, vista, object };
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
        const open = [...jobs.values()].filter((j) => j.state !== 'done' && j.state !== 'cancelled').sort((a, b) => b.createdAt - a.createdAt);
        open.forEach((j) => watchJob(j, req));
        res.json({ success: true, jobs: open.map(publicJob) });
    });
    app.post(`${base}/jobs`, auth, admin, json, async (req, res) => {
        try { res.json({ success: true, job: publicJob(await createJob(req.body, req)) }); } catch (err) { fail(res, err); }
    });
    app.post(`${base}/jobs/missing`, auth, admin, async (req, res) => {
        try {
            const r = await missingJob(req);
            res.json(r ? { success: true, job: publicJob(r.job), left: r.left } : { success: true, job: null, left: 0 });
        } catch (err) { fail(res, err); }
    });
    app.get(`${base}/jobs/:job`, auth, admin, (req, res) => {
        const job = jobOr404(req, res);
        if (!job) return;
        watchJob(job, req);
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, job: publicJob(job) });
    });
    app.get(`${base}/jobs/:job/files/:file`, auth, admin, (req, res) => {
        const job = jobOr404(req, res);
        if (!job) return;
        const file = String(req.params.file || '');
        if (!/^[a-f0-9]{12}-(ref|themed|logo|\d+-(16|32|128|65|vista))\.png$/.test(file)) return res.status(404).end();
        const p = path.join(jobDir(job.id), file);
        fs.promises.stat(p).then(() => {
            res.set('Cache-Control', 'private, max-age=86400');
            res.type('png');
            fs.createReadStream(p).pipe(res);
        }, () => { res.status(404).end(); });
    });
    app.post(`${base}/jobs/:job/regenerate`, auth, admin, json, (req, res) => {
        const job = jobOr404(req, res);
        if (!job) return;
        watchJob(job, req);
        try { const n = regenerate(job, req.body && req.body.keys, req.body && req.body.mode); res.json({ success: true, queued: n, job: publicJob(job) }); } catch (err) { fail(res, err); }
    });
    app.post(`${base}/jobs/:job/done`, auth, admin, json, async (req, res) => {
        const job = jobOr404(req, res);
        if (!job) return;
        watchJob(job, req);
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
    playStoreContext,
    chooseRoute,
    publicManifest,
    _test: { stub: (o) => { stubs = o || null; }, runItem, versionOf, createJob, render65, renderVista, renderWm, checkDrawing, missingJob, finish, removeFromStore, jobs, setRoot: (r) => { projectRoot = r; }, watchJob, pushJob, saveJob, publicJob, jobWatchers, setGr: (g) => { boundGr = g; } }
};
