'use strict';

// Rentan (dynamic generation) compile step. Wren writes dg_ expanders in a hidden
// per-workspace Director chat (cursorDirector.runDynagenTurn). Called at the top of
// imageGeneration buildOptions so the expanders and prompt edits land before
// text replacement processing. Expiry is calculateDynamicExpiration, same as the
// old Director API cache.

const crypto = require('crypto');
const {
    compileContext,
    calculateDynamicExpiration
} = require('./dynamicGenerationHandlers');
const {
    generatePromptHash,
    generateRequestHash,
    generateDirectiveHash
} = require('./dynamicGenerationHandlers.hash');

const DG_PREFIX = /^dg_/i;
const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;
// An expired scene older than this gets a Wren turn even when the context looks the same (daytime AM and PM share a period).
const MAX_SCENE_AGE_MS = 6 * 60 * 60 * 1000;
const EMPTY_TENDAI = { prompt: [], uc: [], character_prompts: [] };

// Same subset imageGeneration buildOptions hashes, so its cache check agrees.
function dynagenRequestHash(dg) {
    return generateRequestHash({
        tod: dg.tod,
        weather: dg.weather,
        season: dg.season,
        activity: dg.activity,
        action: dg.action,
        location: dg.location,
        optimize: dg.optimize,
        creative: dg.creative,
        clothing: dg.clothing,
        observeHoliday: dg.observeHoliday
    });
}

// Studio re-encodes the managed emphasis invisibles (ZWSP/ZWNJ/ZWJ, word joiner, invisible separator/plus) on every apply.
// Weights are formatting too: Rentan hands the prompt back as classic 1.2::tags:: (expandManagedWeightsForRentan)
// and Studio may store it as managed ids again, so both forms hash the same.
function normalizeForHash(text) {
    return String(text || '')
        .replace(/[\u200B-\u200D\u2060-\u2064\uFEFF]/g, '')
        .replace(/-?\d+(?:\.\d+)?::/g, '')
        .replace(/::/g, '')
        .replace(/!dg_[a-z0-9_]+/gi, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ',')
        .replace(/,+/g, ',')
        .replace(/^,|,$/g, '')
        .trim();
}

// Inputs Wren answered for: prompt text (Studio formatting ignored) plus the raw
// Rentan overrides, so a changed weather or time override is a new tick.
function wrenInputHash(body, dg) {
    const characters = (Array.isArray(body.allCharacterPrompts) ? body.allCharacterPrompts : [])
        .map((c) => `${normalizeForHash(c && c.prompt)}|${normalizeForHash(c && c.uc)}`);
    return crypto.createHash('md5').update(JSON.stringify({
        prompt: normalizeForHash(body.prompt),
        uc: normalizeForHash(body.uc),
        characters,
        tod: dg.tod ?? null,
        weather: dg.weather ?? null,
        season: dg.season ?? null,
        location: dg.location ?? null,
        creative: !!dg.creative,
        clothing: !!dg.clothing,
        action: !!dg.action,
        observeHoliday: dg.observeHoliday ?? null
    })).digest('hex');
}

const RENTAN_CONTROLS = ['tod', 'weather', 'season', 'observeHoliday', 'guidance', 'clothing', 'action', 'creative', 'optimize', 'lockSubject', 'disable_holiday', 'reduced_context'];
// Reduced Prompt Context (#432): Rentan sees only the context and writes dg_ additions for an indoor or outdoor setting.
const REDUCED_SETTINGS = ['indoor', 'outdoor'];

// Studio controls as Wren sees them: true, false, or the override value (a fixed time, weather, or season).
function rentanControls(dg) {
    const out = {};
    RENTAN_CONTROLS.forEach((key) => {
        const value = key === 'guidance' ? dg.guidance !== false : dg[key];
        out[key] = value === undefined || value === null || value === '' ? false : value;
    });
    // Creative carries its level (Creative menu Light / Medium / High), so a level change is a new turn.
    if (out.creative) out.creative = ['light', 'medium', 'high'].includes(dg.creative_level) ? dg.creative_level : 'medium';
    // Indoor / Outdoor or off; a switch is a controls change, so it resolves again.
    out.reduced_context = REDUCED_SETTINGS.includes(dg.reduced_context) ? dg.reduced_context : false;
    return out;
}

function changedControls(before, after) {
    return RENTAN_CONTROLS
        .filter((key) => JSON.stringify(before[key] ?? false) !== JSON.stringify(after[key] ?? false))
        .map((key) => `${key} ${after[key] === false ? 'off' : after[key] === true ? 'on' : JSON.stringify(after[key])}`)
        .join(', ');
}

const round = (n, d = 1) => (typeof n === 'number' ? Math.round(n * 10 ** d) / 10 ** d : n);
const clock = (hours) => (typeof hours === 'number'
    ? `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.round((hours % 1) * 60) % 60).padStart(2, '0')}`
    : undefined);
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const weighted = (rows) => (Array.isArray(rows) && rows.length
    ? rows.map((row) => ({ tags: row.text, weight: round(row.bias, 2) }))
    : undefined);

// compileContext already gates each part by its control; this keeps every visible fact and drops raw API payloads.
// The job's view of the print: the whole prompt, or in reduced mode (#432) only the setting.
function rentanPromptView(body, preset, dg) {
    const reduced = REDUCED_SETTINGS.includes(dg && dg.reduced_context) ? dg.reduced_context : null;
    if (reduced) return { reducedContext: reduced, prompt: '', uc: '', characters: [] };
    return {
        reducedContext: null,
        prompt: body.prompt || (preset && preset.prompt) || '',
        uc: body.uc || '',
        characters: (Array.isArray(body.allCharacterPrompts) ? body.allCharacterPrompts : [])
            .map((c, index) => ({ index, prompt: (c && c.prompt) || '' }))
    };
}

// Rentan runs before imageGeneration expands Studio's managed emphasis ids. Those are invisible
// markers whose weights live in body.emphasis_normalization, so the model never saw a weight and
// its rewrite dropped the markers. Expand them to classic N::tags:: first (same call as the NAI path).
function expandManagedWeightsForRentan(body) {
    const { prepareEmphasisTextForNovelAI, hasManagedEmphasisGroupIds } = require('./emphasisGroupIdSyntax');
    const norm = body.emphasis_normalization || null;
    const expand = (text, fieldHint) => (typeof text === 'string' && hasManagedEmphasisGroupIds(text)
        ? prepareEmphasisTextForNovelAI(text, norm, fieldHint).text
        : text);
    body.prompt = expand(body.prompt, 'prompt');
    body.uc = expand(body.uc, 'uc');
    (Array.isArray(body.allCharacterPrompts) ? body.allCharacterPrompts : []).forEach((c, index) => {
        if (!c || typeof c !== 'object') return;
        c.prompt = expand(c.prompt, `character_${index}`);
        c.uc = expand(c.uc, `character_${index}_uc`);
    });
}

function rentanContextForWren(context) {
    const c = context || {};
    const out = {};
    const t = c.time;
    if (t) {
        out.when = `${t.dayOfWeekName} ${t.monthName} ${t.dayOfMonth} ${t.year}, ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} ${(c.location && c.location.timezone) || t.timezone || ''}`.trim();
    }
    if (c.location) out.where = [c.location.city, c.location.state, c.location.country].filter(Boolean).join(', ') || undefined;
    const p = c.timePeriod;
    if (p) {
        out.period = {
            name: p.period,
            timeOfDay: p.timeOfDay,
            sun: p.isDaytime ? `up, ${p.sunPhase}` : 'down',
            sunrise: clock(p.sunriseHour),
            sunset: clock(p.sunsetHour),
            perceivableLight: p.perceivableLight,
            next: p.nextPeriodName && p.nextPeriodName !== p.periodKey ? `${p.nextPeriodName} at ${clock(p.nextPeriodTransitionHour)}` : undefined,
            lighting: weighted(p.lighting),
            atmosphere: weighted(p.atmosphere),
            uc: weighted(p.uc)
        };
    }
    const w = c.weather;
    if (w) {
        out.weather = {
            sky: w.generationCondition || w.condition,
            cloudPercent: w.cloudCoverage,
            precipitation: w.precipitationType && w.precipitationType.type !== 'none'
                ? `${w.precipitationType.intensity} ${w.precipitationType.description}` : 'none',
            tempC: round(w.temperature),
            feelsLikeC: round(w.feelsLike),
            humidity: w.humidity,
            wind: `${round(w.windSpeed)} m/s, gusts ${round(w.windGust)} m/s, from ${COMPASS[Math.round((w.windDirection || 0) / 22.5) % 16]}`,
            visibilityKm: typeof w.visibility === 'number' ? round(w.visibility / 1000) : undefined,
            uv: w.uvIndex !== undefined ? `${round(w.uvIndex)} ${(w.weatherQuality && w.weatherQuality.uvWarnings && w.weatherQuality.uvWarnings.category) || ''}`.trim() : undefined,
            comfort: w.weatherQuality && w.weatherQuality.comfortLevel,
            next: w.nextConditionName || undefined
        };
    }
    const h = c.weatherHistoryReport;
    if (h) {
        const y = h.yesterday;
        const trend = h.trendAnalysis;
        out.recent = {
            yesterday: y ? `${y.dominantCondition}, ${round(y.temperatureMin)}-${round(y.temperatureMax)} C, rain ${round(y.precipitationTotal)} mm, snow ${round(y.precipitationSnow)} cm` : undefined,
            trend: trend ? [
                `temperature ${trend.temperature.status}`,
                `cloud ${trend.cloud.status}`,
                `wind ${trend.wind.status}`,
                trend.precipitation.hasCurrentPrecip ? 'precipitating now'
                    : trend.precipitation.hadRecentPrecip ? 'rain in the last 2h'
                        : trend.precipitation.hadEarlierPrecip ? 'rain earlier today' : 'dry'
            ].join(', ') : undefined,
            hours: Array.isArray(h.timelineEntries)
                ? h.timelineEntries.map((e) => `${e.timeStr} ${e.condition} ${round(e.temperature)} C cloud ${e.cloudCoverage}% ${e.precipitationType}`)
                : undefined
        };
    }
    const s = c.season;
    if (s) {
        out.season = { name: s.name, guidelines: s.guidelines, modifications: s.modifications };
        const hol = s.holiday && s.holiday.primaryHoliday;
        if (hol) {
            out.holiday = {
                name: hol.name,
                daysUntil: hol.daysUntil,
                intensity: hol.intensity,
                decorations: hol.decorations,
                atmosphere: hol.atmosphere,
                colors: hol.colors,
                activities: hol.activities,
                guidance: s.holiday.progressiveElements && s.holiday.progressiveElements.guidance
            };
        }
    }
    if (c.clothing && Array.isArray(c.clothing.options) && c.clothing.options.length) {
        out.clothingOptions = c.clothing.options.slice(0, 20).map((o) => o.name);
    }
    return out;
}

function dgExpandersFrom(list) {
    return (Array.isArray(list) ? list : [])
        .filter((row) => row && DG_PREFIX.test(String(row.name || '')))
        .map((row) => ({ prefix: row.name, value: row.value }));
}

function contextUnchanged(cached, fresh) {
    const a = cached && cached.expirationMetadata;
    const b = fresh && fresh.expirationMetadata;
    if (!a || !b) return false;
    return a.timePeriod === b.timePeriod
        && a.weatherCondition === b.weatherCondition
        && a.hasWeatherPhenomenon === b.hasWeatherPhenomenon
        && Math.abs((a.cloudCoverage || 0) - (b.cloudCoverage || 0)) < 20
        && Math.abs((a.temperature || 0) - (b.temperature || 0)) < 10;
}

function insertPrefixToken(prompt, token) {
    const text = String(prompt || '');
    const textAt = text.search(/(^|,)\s*Text:/i);
    if (textAt < 0) return text ? `${text}, ${token}` : token;
    const head = text.slice(0, textAt).replace(/[\s,]+$/, '');
    return `${head ? `${head}, ` : ''}${token}${text.slice(textAt)}`;
}

// One tag as Rentan compares it: no managed ids, weights, or case.
function plainTag(tag) {
    return String(tag || '')
        .replace(/[\u200B-\u200D\u2060-\u2064\uFEFF]/g, '')
        .replace(/-?\d+(?:\.\d+)?::/g, '')
        .replace(/::/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// A prompt's tags: plain ones, ones already disabled with !/.../, and its !dg_ tokens.
function promptTags(text) {
    const disabled = new Set();
    const rest = String(text || '').replace(/!\/([^/]*)\//g, (match, inner) => {
        inner.split(',').map(plainTag).filter(Boolean).forEach((tag) => disabled.add(tag));
        return ',';
    });
    const plain = new Set();
    const tokens = [];
    rest.split(',').map(plainTag).filter(Boolean).forEach((tag) => {
        if (/^!dg_[a-z0-9_]+$/.test(tag)) tokens.push(tag);
        else plain.add(tag);
    });
    return { plain, disabled, tokens };
}

// Wraps the first plain occurrence of tag in !/.../ where it stands.
function disableTagInPlace(text, tag) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const re = new RegExp(`(^|,|::)(\\s*)(${escaped})(\\s*)(?=,|::|$)`, 'i');
    return String(text).replace(re, (match, lead, gap, found, tail) => `${lead}${gap}!/${found}/${tail}`);
}

// A character prompt is who the character is. Rentan may disable a tag (!/tag/) and add !dg_
// tokens; it adds plain tags only when Clothing or Action is on, and it never drops a tag.
// An edit that drops or invents tags is rebuilt from the user's prompt with only those moves.
function guardCharacterEdit(original, next, controls) {
    const before = promptTags(original);
    const after = promptTags(next);
    const missing = [...before.plain].filter((tag) => !after.plain.has(tag) && !after.disabled.has(tag));
    const added = [...after.plain].filter((tag) => !before.plain.has(tag) && !before.disabled.has(tag));
    const mayAdd = !!(controls && (controls.clothing || controls.action) && !controls.lockSubject);
    if (!missing.length && (!added.length || mayAdd)) return { prompt: next, restored: [], dropped: [] };
    let text = String(original || '');
    after.disabled.forEach((tag) => {
        if (before.plain.has(tag)) text = disableTagInPlace(text, tag);
    });
    const extra = (mayAdd ? added : []).concat(after.tokens.filter((token) => !before.tokens.includes(token)));
    extra.forEach((tag) => { text = insertPrefixToken(text, tag); });
    return { prompt: text, restored: missing, dropped: mayAdd ? [] : added };
}

function applyWrenChange(body, change) {
    if (change.prompt) body.prompt = change.prompt;
    if (change.uc) body.uc = change.uc;
    if (Array.isArray(body.allCharacterPrompts)) {
        const controls = rentanControls(body.dynamic_generation || {});
        change.characters = change.characters.map((row) => {
            const slot = body.allCharacterPrompts[row.index];
            if (!slot) return row;
            const kept = guardCharacterEdit(slot.prompt || '', row.prompt, controls);
            if (kept.restored.length || kept.dropped.length) {
                console.warn(`Rentan: character ${row.index} edit rebuilt (restored ${kept.restored.length} dropped tags, dropped ${kept.dropped.length} added tags)`);
            }
            slot.prompt = kept.prompt;
            return { ...row, prompt: kept.prompt };
        });
    }
    // A changed Directive can drop an expander it no longer needs (dg_outfit, dg_prop, ...): take its !token out too.
    const live = new Set(change.expanders.map((e) => e.prefix.toLowerCase()));
    const dropStale = (text) => (typeof text === 'string'
        ? text.replace(/\s*,?\s*!(dg_[a-z0-9_]+)(?![a-z0-9_])/gi, (match, prefix) => (live.has(prefix.toLowerCase()) ? match : ''))
            .replace(/^\s*,\s*/, '')
        : text);
    body.prompt = dropStale(body.prompt);
    (Array.isArray(body.allCharacterPrompts) ? body.allCharacterPrompts : []).forEach((c) => {
        if (c && typeof c === 'object') c.prompt = dropStale(c.prompt);
    });
    const kept = (Array.isArray(body.text_replacements) ? body.text_replacements : [])
        .filter((row) => !(row && DG_PREFIX.test(String(row.name || ''))));
    body.text_replacements = kept.concat(change.expanders.map((e) => ({ name: e.prefix, value: e.value })));
    const haystack = [body.prompt, body.uc]
        .concat((body.allCharacterPrompts || []).map((c) => c && c.prompt))
        .join('\n');
    change.expanders.forEach((e) => {
        const token = `!${e.prefix}`;
        if (!new RegExp(`${token}(?![a-z0-9_])`, 'i').test(haystack)) {
            body.prompt = insertPrefixToken(body.prompt, token);
        }
    });
}

function studioChangeFrom(body, change) {
    const out = {
        expanders: body.text_replacements.map((row) => ({
            prefix: row.name,
            value: row.value,
            ...(row.extend ? { extend: true } : {}),
            ...(row.stages != null ? { stages: row.stages } : {})
        }))
    };
    out.prompt = body.prompt;
    if (change.uc) out.uc = change.uc;
    if (change.characters.length) {
        out.characters = change.characters.map((row) => ({ index: row.index, action: 'replace', prompt: row.prompt }));
    }
    return out;
}

// Wren's per-expander reason survives cached reuse while that expander's text is unchanged.
function withReasons(list, from) {
    const reasons = new Map((Array.isArray(from) ? from : [])
        .filter((entry) => entry && entry.reason)
        .map((entry) => [String(entry.prefix).toLowerCase(), entry]));
    return list.map((entry) => {
        const source = reasons.get(String(entry.prefix).toLowerCase());
        return source && normalizeForHash(source.value) === normalizeForHash(entry.value)
            ? { ...entry, reason: source.reason }
            : entry;
    });
}

function promptHashOf(body, preset) {
    const rawPrompt = (body.prompt !== undefined && body.prompt !== null) ? body.prompt : preset?.prompt;
    const rawUc = (body.uc !== undefined && body.uc !== null) ? body.uc : preset?.uc;
    const rawNeg = body.input_prompt_negative ?? body.prompt_negative ?? preset?.input_prompt_negative ?? preset?.prompt_negative ?? '';
    return generatePromptHash(rawPrompt, rawUc, body.allCharacterPrompts || preset?.allCharacterPrompts || [], rawNeg || '');
}

function inputSnapshot(body) {
    return {
        prompt: body.prompt || '',
        uc: body.uc || '',
        characters: (Array.isArray(body.allCharacterPrompts) ? body.allCharacterPrompts : [])
            .map((c, index) => ({ index, prompt: (c && c.prompt) || '' }))
    };
}

// Prompt, UC, and character prompts with Studio formatting ignored: is the Studio text still what Wren left?
function inputHashOf(body) {
    const snap = inputSnapshot(body);
    return crypto.createHash('md5').update(JSON.stringify([
        normalizeForHash(snap.prompt),
        normalizeForHash(snap.uc),
        snap.characters.map((row) => normalizeForHash(row.prompt))
    ])).digest('hex');
}

// Prompt, UC, and character prompts as tag sets: Studio's dedupe, reorder, and weight ids do not change it.
function outputKeyOf(snap) {
    const field = (text) => [...new Set(normalizeForHash(text).split(',').filter(Boolean))].sort().join(',');
    return crypto.createHash('md5').update(JSON.stringify([
        field(snap.prompt),
        field(snap.uc),
        (snap.characters || []).map((row) => field(row.prompt))
    ])).digest('hex');
}

// Rentan output key -> the user's prompt before Rentan, so back-to-back prints keep the first original
// even when the Studio snapshot the next print carries is older than the last Rentan answer.
const LINEAGE_MAX = 200;
const rentanLineage = new Map();
function rememberLineage(key, original) {
    if (!key || !original) return;
    rentanLineage.delete(key);
    rentanLineage.set(key, original);
    while (rentanLineage.size > LINEAGE_MAX) rentanLineage.delete(rentanLineage.keys().next().value);
}

// The original for an incoming prompt that is still a Rentan answer, or null when the user wrote it.
function knownOriginal(existing, incomingHash, incomingKey) {
    if (existing.original_input && (existing.input_hash === incomingHash || existing.output_key === incomingKey)) {
        return existing.original_input;
    }
    return rentanLineage.get(incomingKey) || null;
}

// The prompt before Wren's edits, for carousel Restore Input Prompt. Missing !dg_ tokens are added so a restore keeps the scene.
function originalInputFor(before, after, expanders, existing, incomingHash, incomingKey) {
    const known = knownOriginal(existing, incomingHash, incomingKey || outputKeyOf(before));
    if (known) return known;
    if (JSON.stringify(before) === JSON.stringify(after)) return null;
    const original = { ...before, characters: before.characters.map((row) => ({ ...row })) };
    const haystack = [original.prompt, original.uc, ...original.characters.map((row) => row.prompt)].join('\n');
    expanders.forEach((e) => {
        const token = `!${e.prefix}`;
        if (!new RegExp(`${token}(?![a-z0-9_])`, 'i').test(haystack)) original.prompt = insertPrefixToken(original.prompt, token);
    });
    return original;
}

function stampCompiled(gr, body, dg, preset, context, fields) {
    const now = Date.now();
    const existing = dg.compiled_prompt && typeof dg.compiled_prompt === 'object' ? dg.compiled_prompt : {};
    const promptHash = promptHashOf(body, preset);
    const inputHash = inputHashOf(body);
    const outputKey = outputKeyOf(inputSnapshot(body));
    dg.compiled_prompt = {
        success: true,
        source: fields.source,
        integrated: true,
        context,
        // Legacy Tendai stays read-only on old images; Wren output is dg_expanders.
        text_replacements: EMPTY_TENDAI,
        dg_expanders: withReasons(dgExpandersFrom(body.text_replacements), fields.expanders || existing.dg_expanders),
        summary: fields.summary != null ? fields.summary : (existing.summary || null),
        applied: fields.applied || existing.applied || null,
        original_input: fields.original_input !== undefined
            ? fields.original_input
            : knownOriginal(existing, inputHash, outputKey),
        input_hash: inputHash,
        output_key: outputKey,
        // A server resolve (#422) has no Director chat: it passes sessionId null on purpose.
        wren_session_id: Object.prototype.hasOwnProperty.call(fields, 'sessionId') ? fields.sessionId || null : (existing.wren_session_id || null),
        resolved_by: fields.resolvedBy || existing.resolved_by || null,
        wren_at: fields.wrenAt || existing.wren_at || null,
        wren_input_hash: wrenInputHash(body, dg),
        prompt_hash: promptHash,
        request_hash: dynagenRequestHash(dg),
        controls: rentanControls(dg),
        directive_hash: dg.directive ? generateDirectiveHash(dg.directive) : null,
        timestamp: now,
        expiresAt: fields.expiresAt || calculateDynamicExpiration(gr, context, DEFAULT_EXPIRY_MS),
        cache_locked: !!dg.cache_locked,
        context_locked: !!dg.context_locked
    };
    rememberLineage(outputKey, dg.compiled_prompt.original_input);
}

function sendRentanError(handler, ws, message) {
    if (!ws || !handler) return;
    handler.sendToClient(ws, {
        type: 'dynamic_generation_progress_update',
        phase: 'error',
        data: { error: message },
        timestamp: new Date().toISOString()
    });
}

// Claude CLI errors that mean the engine's API is unreachable, not that the turn went wrong:
// "API Error: 530 Cloudflare Tunnel error", 502/503/504, overloaded, connection and timeout errors.
function isRentanUpstreamOutage(error) {
    const text = String((error && error.message) || '');
    return /API Error: 5\d\d\b/.test(text)
        || /API Error: (Connection error|Request timed out)/i.test(text)
        || /\boverloaded_error\b/.test(text);
}

const RENTAN_MAX_ATTEMPTS = 5;
const RENTAN_ATTEMPT_WAIT_MS = 45 * 1000;

function rentanReviewApplies(body) {
    const dg = body && body.dynamic_generation;
    if (!dg || typeof dg !== 'object' || Array.isArray(dg) || dg.enabled === false) return false;
    if (body._rentanSkipReview || dg._rentanReviewDone) return false;
    if (body.stageIndex !== undefined || body.compile_only) return false;
    if (Array.isArray(body.pipeline) && body.pipeline.length > 0 && body.skip_pipeline_stages !== true) return false;
    if (body.no_save === true || body.preview_only === true) return false;
    if (body.mcp_generated === true || body.mcpGenerated === true) return false;
    if (body.source === 'agent') return false;
    const cp = dg.compiled_prompt;
    if (cp && cp.source === 'agent') return false;
    return true;
}

function rentanReviewStatus(n, max) {
    return `Yumiya is reviewing attempt ${n}/${max}`;
}

function createRentanReview(options) {
    const opts = options || {};
    return {
        chatId: String(opts.chatId || ''),
        controls: opts.controls || null,
        max: opts.max || RENTAN_MAX_ATTEMPTS,
        waitMs: opts.waitMs != null ? opts.waitMs : RENTAN_ATTEMPT_WAIT_MS,
        capWaitMs: opts.capWaitMs != null ? opts.capWaitMs : RENTAN_ATTEMPT_WAIT_MS,
        attempts: [],
        current: null,
        change: null,
        delivered: false,
        atCap: false,
        decision: null,
        failed: null,
        closed: false,
        deferred: opts.deferred === true,
        turnOpen: false,
        homeDir: opts.homeDir || null,
        requestBody: opts.requestBody || null,
        preset: opts.preset || null,
        gr: opts.gr || null,
        statusLine: 'Yumiya is thinking...',
        writePreview: opts.writePreview || null,
        openTurn: opts.openTurn || null,
        log: opts.log || ((message) => console.warn(message)),
        _attemptWaiters: [],
        _decisionWaiters: [],
        _firstWaiters: [],
        _firstRejecters: []
    };
}

function wakeReview(list, value) {
    const waiters = list.splice(0);
    waiters.forEach((waiter) => {
        try { waiter(value); } catch (_) { /* waiter already left */ }
    });
}

function noteRentanDelivery(review, change) {
    review.change = change;
    if (!review.delivered) {
        review.delivered = true;
        wakeReview(review._firstWaiters, change);
        review._firstRejecters.splice(0);
        return { first: true, rebuild: false };
    }
    if (!review.attempts.length) return { first: false, rebuild: false, updated: true };
    const decision = { action: 'rebuild', change };
    review.decision = decision;
    wakeReview(review._decisionWaiters, decision);
    return { first: false, rebuild: true };
}

function waitForFirstDelivery(review) {
    if (review.failed) return Promise.reject(review.failed);
    if (review.delivered && review.change) return Promise.resolve(review.change);
    return new Promise((resolve, reject) => {
        review._firstWaiters.push(resolve);
        review._firstRejecters.push(reject);
    });
}

function failRentanReview(review, error) {
    if (!review || review.delivered || review.failed) return;
    review.failed = error || new Error('Rentan turn ended before deliver_rentan');
    const rejecters = review._firstRejecters.splice(0);
    review._firstWaiters.splice(0);
    rejecters.forEach((reject) => {
        try { reject(review.failed); } catch (_) { /* already settled */ }
    });
}

function formatRentanAttempt(review, attempt) {
    return {
        pending: false,
        attempt: attempt.n,
        max: review.max,
        path: attempt.jailPath,
        previewPath: attempt.previewPath,
        compiledPrompt: attempt.compiledPrompt,
        atCap: review.atCap === true,
        next: review.atCap
            ? `This is attempt ${attempt.n} of ${review.max}. finish_rentan with pick set to the best attempt number.`
            : 'Read the preview. finish_rentan approved:true, or deliver_rentan with a fix.'
    };
}

function awaitRentanAttempt(review, timeoutMs) {
    if (!review) {
        const error = new Error('No Rentan turn is waiting on this chat. Pass the Rentan chat id from your turn prompt.');
        error.code = 'NO_RENTAN_TURN';
        throw error;
    }
    const wait = timeoutMs != null ? timeoutMs : review.waitMs;
    if (review.closed || review.settled || (review.atCap && review.current && review.current.consumed)) {
        // No further attempt can arrive: tell Wren to stop instead of returning pending forever.
        return Promise.resolve({
            pending: false,
            done: true,
            attempt: review.attempts.length,
            max: review.max,
            next: review.settled || review.closed
                ? 'This Rentan review is finished. End your turn now. Do not call await_rentan_attempt again.'
                : `Attempt ${review.max} of ${review.max} was already returned. finish_rentan with pick set to the best attempt number, then end your turn.`
        });
    }
    if (review.current && !review.current.consumed) {
        review.current.consumed = true;
        return Promise.resolve(formatRentanAttempt(review, review.current));
    }
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const onAttempt = (attempt) => {
            attempt.consumed = true;
            finish(formatRentanAttempt(review, attempt));
        };
        const timer = setTimeout(() => {
            const idx = review._attemptWaiters.indexOf(onAttempt);
            if (idx >= 0) review._attemptWaiters.splice(idx, 1);
            finish({
                pending: true,
                attempt: review.attempts.length,
                max: review.max,
                next: 'The print is not ready yet. Call await_rentan_attempt again with the same chatId. Do not guess the picture.'
            });
        }, wait);
        review._attemptWaiters.push(onAttempt);
    });
}

async function writeRentanPreview(review, buffer, relativePath) {
    if (review.writePreview) {
        await review.writePreview({ buffer, relativePath, homeDir: review.homeDir, n: review.attempts.length + 1 });
        return;
    }
    if (!review.homeDir) return;
    const fs = require('fs');
    const path = require('path');
    const sharp = require('sharp');
    const abs = path.join(review.homeDir, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await sharp(buffer).webp({ quality: 80 }).toFile(abs);
}

async function submitRentanAttempt(review, payload) {
    const n = review.attempts.length + 1;
    if (n > review.max) return null;
    const rel = `rentan/${n}.webp`;
    const jailPath = `/home/director/${rel}`;
    await writeRentanPreview(review, payload.buffer, rel);
    const attempt = {
        n,
        buffer: payload.buffer,
        compiledPrompt: payload.compiledPrompt || '',
        previewPath: rel,
        jailPath,
        change: review.change ? JSON.parse(JSON.stringify(review.change)) : null,
        snapshot: payload.snapshot || null,
        consumed: false
    };
    review.attempts.push(attempt);
    review.current = attempt;
    review.atCap = n >= review.max;
    review.statusLine = rentanReviewStatus(n, review.max);
    wakeReview(review._attemptWaiters, attempt);
    return attempt;
}

function finishRentanReview(review, input) {
    if (!review) {
        const error = new Error('No Rentan turn is waiting on this chat.');
        error.code = 'NO_RENTAN_TURN';
        throw error;
    }
    const approved = input && (input.approved === true || input.approved === 'true');
    const pick = input && input.pick != null && input.pick !== '' ? Number(input.pick) : null;
    if (approved) {
        const attempt = review.current || review.attempts[review.attempts.length - 1];
        if (!attempt) {
            const error = new Error('No attempt is ready to approve. Call await_rentan_attempt first.');
            error.code = 'NO_RENTAN_ATTEMPT';
            throw error;
        }
        const decision = { action: 'save', attempt, approved: true };
        review.settled = true;
        review.decision = decision;
        wakeReview(review._decisionWaiters, decision);
        return { chatId: review.chatId, approved: true, attempt: attempt.n };
    }
    if (Number.isInteger(pick) && pick >= 1) {
        if (!review.atCap) {
            const error = new Error(`pick is only available on attempt ${review.max}. Approve this attempt or deliver a fix.`);
            error.code = 'RENTAN_PICK_EARLY';
            throw error;
        }
        const attempt = review.attempts.find((row) => row.n === pick) || review.attempts[review.attempts.length - 1];
        const decision = { action: 'save', attempt, pick: attempt.n };
        review.settled = true;
        review.decision = decision;
        wakeReview(review._decisionWaiters, decision);
        return { chatId: review.chatId, pick: attempt.n, attempt: attempt.n };
    }
    const error = new Error('finish_rentan needs approved:true or, on the last attempt, pick.');
    error.code = 'BAD_RENTAN_FINISH';
    throw error;
}

function waitForRentanDecision(review, timeoutMs) {
    if (review.decision && review.decision.action) {
        const decision = review.decision;
        review.decision = null;
        return Promise.resolve(decision);
    }
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(value);
        };
        let timer = null;
        const onDecision = (decision) => {
            if (review.decision === decision) review.decision = null;
            finish(decision);
        };
        if (timeoutMs != null && timeoutMs >= 0) {
            timer = setTimeout(() => {
                const idx = review._decisionWaiters.indexOf(onDecision);
                if (idx >= 0) review._decisionWaiters.splice(idx, 1);
                finish(null);
            }, timeoutMs);
        }
        review._decisionWaiters.push(onDecision);
    });
}

function forceSaveLastAttempt(review, reason) {
    const attempt = review.attempts[review.attempts.length - 1];
    if (!attempt) return null;
    const message = `Rentan review ${review.chatId || ''}: ${reason || 'Yumiya did not finish'}. Saving attempt ${attempt.n}.`;
    review.log(message);
    const decision = { action: 'save', attempt, forced: true, reason: message };
    review.settled = true;
    review.decision = decision;
    wakeReview(review._decisionWaiters, decision);
    return decision;
}

function closeRentanReview(review, error) {
    if (!review || review.closed) return;
    review.closed = true;
    if (!review.delivered) {
        failRentanReview(review, error || new Error('Rentan turn ended before deliver_rentan'));
        return;
    }
    if (!review.decision && review._decisionWaiters.length) {
        forceSaveLastAttempt(review, error && error.message ? error.message : 'the Rentan turn ended');
    }
}

function snapshotRentanOpts(opts) {
    let dynamic = null;
    if (opts && opts.dynamic_generation) {
        const copy = { ...opts.dynamic_generation };
        delete copy._rentanReviewDone;
        dynamic = JSON.parse(JSON.stringify(copy));
    }
    return {
        prompt: opts.prompt,
        negative_prompt: opts.negative_prompt,
        seed: opts.seed,
        allCharacterPrompts: opts.allCharacterPrompts,
        dynamic_generation: dynamic,
        input_prompt: opts.input_prompt,
        input_uc: opts.input_uc,
        input_prompt_negative: opts.input_prompt_negative,
        input_character_prompts: opts.input_character_prompts,
        text_replacements: opts.text_replacements
    };
}

function restoreRentanSnapshot(opts, snapshot) {
    if (!opts || !snapshot) return;
    Object.keys(snapshot).forEach((key) => {
        if (snapshot[key] !== undefined) opts[key] = snapshot[key];
    });
}

function commitRentanChange(gr, body, preset, change) {
    const dg = body && body.dynamic_generation;
    if (!dg || !change) return;
    const existing = dg.compiled_prompt && typeof dg.compiled_prompt === 'object' ? dg.compiled_prompt : {};
    applyWrenChange(body, change);
    stampCompiled(gr, body, dg, preset, body._dynagenContext || {}, {
        original_input: existing.original_input || null,
        source: 'wren',
        summary: change.summary,
        applied: change.applied,
        expanders: change.expanders,
        sessionId: existing.wren_session_id || null,
        wrenAt: Date.now()
    });
}

function emitApprovedRentanChange(handler, ws, review, change) {
    const body = review && review.requestBody;
    if (!ws || !handler || !change || !body) return;
    commitRentanChange(review.gr, body, review.preset, change);
    if (body.dynamic_generation) body.dynamic_generation._rentanReviewDone = true;
    handler.sendToClient(ws, {
        type: 'dynamic_generation_progress_update',
        phase: 'wren_change',
        data: {
            change: studioChangeFrom(body, change),
            compiled_prompt: body.dynamic_generation && body.dynamic_generation.compiled_prompt
        },
        timestamp: new Date().toISOString()
    });
}

async function holdRentanPrint(args) {
    const review = args && args.review;
    if (!review) return null;
    const attempt = await submitRentanAttempt(review, {
        buffer: args.buffer,
        compiledPrompt: args.compiledPrompt,
        snapshot: args.snapshot
    });
    if (!attempt) return forceSaveLastAttempt(review, 'attempt cap exceeded');
    if (review.deferred && !review.turnOpen && typeof review.openTurn === 'function') {
        review.turnOpen = true;
        await review.openTurn(attempt);
    }
    if (typeof args.onPreview === 'function') {
        args.onPreview({
            n: attempt.n,
            max: review.max,
            status: review.statusLine,
            imageData: args.imageData || null
        });
    }
    const decision = await waitForRentanDecision(review, review.atCap ? review.capWaitMs : null);
    if (!decision || (decision.action === 'rebuild' && review.atCap)) {
        const forced = forceSaveLastAttempt(review, !decision
            ? `Yumiya did not pick within the cap on attempt ${attempt.n}`
            : 'rebuild requested at the attempt cap');
        if (forced && review.requestBody && review.requestBody.dynamic_generation) {
            review.requestBody.dynamic_generation._rentanReviewDone = true;
        }
        return forced;
    }
    if (decision.action === 'save' && review.requestBody && review.requestBody.dynamic_generation) {
        review.requestBody.dynamic_generation._rentanReviewDone = true;
    }
    return decision;
}

function isLegacyTendai(cp) {
    return !!(cp && !cp.wren_input_hash && cp.source !== 'agent' && cp.text_replacements);
}

// The watched blocks are Wren's dg_ expanders and their !dg_ tokens. Other prompt edits keep the scene.
function watchedBlocksReason(cp, body) {
    const kept = Array.isArray(cp.dg_expanders) ? cp.dg_expanders : [];
    if (!kept.length) return null;
    const sent = new Map(dgExpandersFrom(body.text_replacements).map((e) => [String(e.prefix).toLowerCase(), normalizeForHash(e.value)]));
    const characters = Array.isArray(body.allCharacterPrompts) ? body.allCharacterPrompts : [];
    const text = [body.prompt, body.uc, ...characters.flatMap((c) => [c && c.prompt, c && c.uc])].join('\n');
    for (const entry of kept) {
        const key = String(entry.prefix).toLowerCase();
        if (!sent.has(key)) return `${entry.prefix} expander missing`;
        if (sent.get(key) !== normalizeForHash(entry.value)) return `${entry.prefix} expander modified`;
        if (!new RegExp(`!${key}(?![a-z0-9_])`, 'i').test(text)) return `!${entry.prefix} missing from the prompt`;
    }
    if (sent.size !== kept.length) return 'dg_ expanders added';
    return null;
}

function staleReason(cp, dg, body, context, now) {
    if (!cp || !cp.wren_input_hash) return isLegacyTendai(cp) ? 'pre-v1.1 Tendai stamp' : 'first Rentan turn for this prompt';
    if (dg.dyna_no_cache === true || dg.use_cache_responses === false) return 'cache is off';
    if (dg.force_context_refresh === true) return 'refresh requested';
    const flipped = cp.controls ? changedControls(cp.controls, rentanControls(dg)) : '';
    if (flipped) return `Rentan controls changed: ${flipped}`;
    if (cp.request_hash !== dynagenRequestHash(dg)) return 'Rentan toggles changed';
    if ((cp.directive_hash || null) !== (dg.directive ? generateDirectiveHash(dg.directive) : null)) return 'directive changed';
    const watched = watchedBlocksReason(cp, body);
    if (watched) return watched;
    if (cp.expiresAt && now < cp.expiresAt) return null;
    if (now - (cp.wren_at || cp.timestamp || 0) > MAX_SCENE_AGE_MS) return 'scene older than 6h';
    if (contextUnchanged(cp.context, context)) return null;
    return 'context changed since the last tick';
}

function attachDeferredRentanReview(gr, body, preset, ws, handler, context) {
    const dg = body.dynamic_generation;
    const { layout, startRentanReviewTurn } = require('./cursorDirector');
    const requestId = body.requestId || 'buildOptions';
    const progress = (data) => {
        if (ws && handler) handler.sendGenerationProgress(ws, requestId, { hasDynamicGen: true, ...data });
    };
    const review = createRentanReview({
        deferred: true,
        controls: rentanControls(dg),
        requestBody: body,
        preset,
        gr,
        homeDir: layout().home
    });
    review.delivered = true;
    review.openTurn = (attempt) => startRentanReviewTurn(gr, {
        workspaceId: body.workspace || null,
        agent: dg.agent || null,
        reason: 'review cached scene',
        reviewOnly: true,
        review,
        attemptN: attempt.n,
        max: review.max,
        previewPath: attempt.jailPath,
        compiledPrompt: attempt.compiledPrompt,
        context: rentanContextForWren(context),
        controls: rentanControls(dg),
        directive: dg.directive || '',
        ...rentanPromptView(body, preset, dg),
        expanders: REDUCED_SETTINGS.includes(dg.reduced_context) ? [] : dgExpandersFrom(body.text_replacements),
        onThought: (text, reasoningId) => progress({
            phase: 'streaming',
            reasoning: text,
            reasoningId,
            status: review.statusLine || 'Yumiya is thinking...'
        })
    });
    body._rentanReview = review;
}

/**
 * Resolve Rentan before buildOptions processes the prompt. Mutates body
 * (prompt, uc, character prompts, text_replacements, dynamic_generation.compiled_prompt).
 * Throws when Wren cannot answer so the print does not go out unresolved.
 */
async function resolveDynagenWithWren(gr, body, preset, ws, handler, wsServer) {
    const dg = body && body.dynamic_generation;
    if (!dg || typeof dg !== 'object' || Array.isArray(dg) || dg.enabled === false) return;
    if (body.stageIndex !== undefined || body.compile_only || body._dynagenResolved) return;
    if (dg._rentanReviewDone) return;
    body._dynagenResolved = true;

    const cp = dg.compiled_prompt && typeof dg.compiled_prompt === 'object' ? dg.compiled_prompt : null;
    let context = null;
    // A scene still inside its expiry, with cache on and nothing changed, never looks at a fresh
    // context (staleReason returns before contextUnchanged): reuse its own instead of compiling
    // the sun table, weather, clothing and expiry on every print.
    const sceneStillValid = !!(cp && cp.context && cp.wren_input_hash && !isLegacyTendai(cp)
        && cp.expiresAt && Date.now() < cp.expiresAt
        && staleReason(cp, dg, body, cp.context, Date.now()) === null);
    if (sceneStillValid || ((dg.context_locked || dg.locked) && cp && cp.context)) {
        context = cp.context;
    } else {
        const clientInfo = wsServer && wsServer.clients ? wsServer.clients.get(ws) : null;
        context = await compileContext(gr, dg, (clientInfo && clientInfo.clientIP) || null);
    }
    body._dynagenContext = context;

    // Pre-v1.1 Tendai print under Freeze Changes: the cached replay in imageGeneration applies it.
    if (dg.cache_locked && isLegacyTendai(cp)) return;

    // Baked by an agent (MCP generate_image or a Wren chat apply with integrated:true).
    if (cp && cp.source === 'agent' && cp.integrated && !cp.wren_input_hash) {
        stampCompiled(gr, body, dg, preset, context, { source: 'agent' });
        return;
    }

    const now = Date.now();
    const reason = dg.cache_locked && cp && cp.wren_input_hash
        ? null
        : staleReason(cp, dg, body, context, now);
    console.log(`Rentan ${body.workspace || ''}: ${reason ? `Yumiya turn (${reason})` : 'cached scene reused'}`);
    // Server-side resolves (#422, TokenRouter) cannot look at the print, so the image review is agent-only.
    const { rentanRoute } = require('./cursorDirector');
    const route = rentanRoute(gr, { agent: dg.agent || null });
    const reviewWanted = !route.server && rentanReviewApplies(body);
    const reuseCachedScene = () => {
        if (!dgExpandersFrom(body.text_replacements).length && cp.dg_expanders && cp.dg_expanders.length) {
            body.text_replacements = (Array.isArray(body.text_replacements) ? body.text_replacements : [])
                .concat(cp.dg_expanders.map((e) => ({ name: e.prefix, value: e.value })));
        }
        const keepExpiry = cp.expiresAt && now < cp.expiresAt ? cp.expiresAt : null;
        stampCompiled(gr, body, dg, preset, context, { source: cp.source || 'wren', expiresAt: keepExpiry });
    };
    if (!reason) {
        reuseCachedScene();
        if (reviewWanted) attachDeferredRentanReview(gr, body, preset, ws, handler, context);
        return;
    }

    const requestId = body.requestId || 'buildOptions';
    const progress = (data) => {
        if (ws && handler) handler.sendGenerationProgress(ws, requestId, { hasDynamicGen: true, ...data });
    };
    progress({ phase: 'thinking' });

    if (body.prompt === undefined && preset?.prompt) body.prompt = preset.prompt;
    // Restore Input Prompt gives back the Studio text as it was, managed weights included.
    const before = inputSnapshot(body);
    const incomingHash = inputHashOf(body);
    if (!REDUCED_SETTINGS.includes(dg.reduced_context)) expandManagedWeightsForRentan(body);

    const { runDynagenTurn, layout } = require('./cursorDirector');
    const review = reviewWanted ? createRentanReview({
        controls: rentanControls(dg),
        requestBody: body,
        preset,
        gr,
        homeDir: layout().home
    }) : null;
    let result;
    try {
        result = await runDynagenTurn(gr, {
            workspaceId: body.workspace || null,
            // Studio engine / model choice (Rentan menu); null follows the saved default.
            agent: route.agent,
            reason,
            review,
            context: rentanContextForWren(context),
            controls: rentanControls(dg),
            directive: dg.directive || '',
            ...rentanPromptView(body, preset, dg),
            expanders: REDUCED_SETTINGS.includes(dg.reduced_context) ? [] : (dgExpandersFrom(body.text_replacements).length
                ? dgExpandersFrom(body.text_replacements)
                : ((cp && cp.dg_expanders) || [])),
            onThought: (text, reasoningId) => progress({
                phase: 'streaming',
                reasoning: text,
                reasoningId,
                status: (review && review.statusLine) || 'Yumiya is thinking...'
            })
        });
    } catch (error) {
        // Out of Cursor usage even on Auto, the server resolve failed twice, or the engine's
        // upstream is down (5xx, tunnel, timeout): print on the last scene.
        const reusable = error.code === 'CURSOR_USAGE_LIMIT' || error.code === 'RENTAN_SERVER_FAILED'
            || isRentanUpstreamOutage(error);
        if (reusable && cp && Array.isArray(cp.dg_expanders) && cp.dg_expanders.length) {
            console.warn(`Rentan ${body.workspace || ''}: ${error.code === 'CURSOR_USAGE_LIMIT' ? 'Cursor usage limit' : error.message}; last scene reused`);
            reuseCachedScene();
            return;
        }
        const message = `Rentan: Yumiya could not resolve the scene (${error.message || 'unknown error'}). Turn Rentan off or try again.`;
        sendRentanError(handler, ws, message);
        throw new Error(message);
    }

    applyWrenChange(body, result.change);
    stampCompiled(gr, body, dg, preset, context, {
        original_input: originalInputFor(before, inputSnapshot(body), result.change.expanders, cp || {}, incomingHash),
        source: 'wren',
        summary: result.change.summary,
        applied: result.change.applied,
        expanders: result.change.expanders,
        sessionId: result.sessionId,
        resolvedBy: result.resolvedBy || { engine: route.agent.engine, model: route.agent.model || null },
        wrenAt: Date.now()
    });

    if (review) {
        body._rentanReview = review;
        return;
    }

    if (ws && handler && !preset) {
        handler.sendToClient(ws, {
            type: 'dynamic_generation_progress_update',
            phase: 'wren_change',
            data: {
                change: studioChangeFrom(body, result.change),
                compiled_prompt: dg.compiled_prompt
            },
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    resolveDynagenWithWren,
    dynagenRequestHash,
    rentanReviewApplies,
    createRentanReview,
    noteRentanDelivery,
    waitForFirstDelivery,
    failRentanReview,
    closeRentanReview,
    awaitRentanAttempt,
    finishRentanReview,
    submitRentanAttempt,
    holdRentanPrint,
    forceSaveLastAttempt,
    snapshotRentanOpts,
    restoreRentanSnapshot,
    commitRentanChange,
    emitApprovedRentanChange,
    rentanReviewStatus,
    RENTAN_MAX_ATTEMPTS,
    _test: { guardCharacterEdit, promptTags, outputKeyOf, knownOriginal, rentanLineage, expandManagedWeightsForRentan, normalizeForHash, originalInputFor, inputSnapshot, rentanControls, rentanPromptView, changedControls, rentanContextForWren, wrenInputHash, applyWrenChange, studioChangeFrom, staleReason, contextUnchanged, insertPrefixToken, isLegacyTendai, watchedBlocksReason }
};
