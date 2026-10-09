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
function normalizeForHash(text) {
    return String(text || '')
        .replace(/[\u200B-\u200D\u2060-\u2064\uFEFF]/g, '')
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

const RENTAN_CONTROLS = ['tod', 'weather', 'season', 'observeHoliday', 'guidance', 'clothing', 'action', 'creative', 'optimize', 'lockSubject', 'disable_holiday'];

// Studio controls as Wren sees them: true, false, or the override value (a fixed time, weather, or season).
function rentanControls(dg) {
    const out = {};
    RENTAN_CONTROLS.forEach((key) => {
        const value = key === 'guidance' ? dg.guidance !== false : dg[key];
        out[key] = value === undefined || value === null || value === '' ? false : value;
    });
    // Creative carries its level (Creative menu Light / Medium / High), so a level change is a new turn.
    if (out.creative) out.creative = ['light', 'medium', 'high'].includes(dg.creative_level) ? dg.creative_level : 'medium';
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

function applyWrenChange(body, change) {
    if (change.prompt) body.prompt = change.prompt;
    if (change.uc) body.uc = change.uc;
    if (Array.isArray(body.allCharacterPrompts)) {
        change.characters.forEach((row) => {
            const slot = body.allCharacterPrompts[row.index];
            if (slot) slot.prompt = row.prompt;
        });
    }
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

// The prompt before Wren's edits, for carousel Restore Input Prompt. Missing !dg_ tokens are added so a restore keeps the scene.
function originalInputFor(before, after, expanders, existing, incomingHash) {
    if (existing.original_input && existing.input_hash === incomingHash) return existing.original_input;
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
            : (existing.input_hash === inputHash ? existing.original_input || null : null),
        input_hash: inputHash,
        wren_session_id: fields.sessionId || existing.wren_session_id || null,
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

/**
 * Resolve Rentan before buildOptions processes the prompt. Mutates body
 * (prompt, uc, character prompts, text_replacements, dynamic_generation.compiled_prompt).
 * Throws when Wren cannot answer so the print does not go out unresolved.
 */
async function resolveDynagenWithWren(gr, body, preset, ws, handler, wsServer) {
    const dg = body && body.dynamic_generation;
    if (!dg || typeof dg !== 'object' || Array.isArray(dg) || dg.enabled === false) return;
    if (body.stageIndex !== undefined || body.compile_only || body._dynagenResolved) return;
    body._dynagenResolved = true;

    const cp = dg.compiled_prompt && typeof dg.compiled_prompt === 'object' ? dg.compiled_prompt : null;
    let context = null;
    if ((dg.context_locked || dg.locked) && cp && cp.context) {
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
    console.log(`Rentan ${body.workspace || ''}: ${reason ? `Wren turn (${reason})` : 'cached scene reused'}`);
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
        return;
    }

    const requestId = body.requestId || 'buildOptions';
    const progress = (data) => {
        if (ws && handler) handler.sendGenerationProgress(ws, requestId, { hasDynamicGen: true, ...data });
    };
    progress({ phase: 'thinking' });

    const { runDynagenTurn } = require('./cursorDirector');
    let result;
    try {
        result = await runDynagenTurn(gr, {
            workspaceId: body.workspace || null,
            reason,
            context: rentanContextForWren(context),
            controls: rentanControls(dg),
            directive: dg.directive || '',
            prompt: body.prompt || preset?.prompt || '',
            uc: body.uc || '',
            characters: (Array.isArray(body.allCharacterPrompts) ? body.allCharacterPrompts : [])
                .map((c, index) => ({ index, prompt: (c && c.prompt) || '' })),
            expanders: dgExpandersFrom(body.text_replacements).length
                ? dgExpandersFrom(body.text_replacements)
                : ((cp && cp.dg_expanders) || []),
            onThought: (text, reasoningId) => progress({ phase: 'streaming', reasoning: text, reasoningId, status: 'Wren is thinking...' })
        });
    } catch (error) {
        // Out of Cursor usage even on Auto (modules/cursorDirector.js executeDynagenTurn): print on the last scene.
        if (error.code === 'CURSOR_USAGE_LIMIT' && cp && Array.isArray(cp.dg_expanders) && cp.dg_expanders.length) {
            console.warn(`Rentan ${body.workspace || ''}: Cursor usage limit, last scene reused`);
            reuseCachedScene();
            return;
        }
        const message = `Rentan: Wren could not resolve the scene (${error.message || 'unknown error'}). Turn Rentan off or try again.`;
        sendRentanError(handler, ws, message);
        throw new Error(message);
    }

    if (body.prompt === undefined && preset?.prompt) body.prompt = preset.prompt;
    const incomingHash = inputHashOf(body);
    const before = inputSnapshot(body);
    applyWrenChange(body, result.change);
    stampCompiled(gr, body, dg, preset, context, {
        original_input: originalInputFor(before, inputSnapshot(body), result.change.expanders, cp || {}, incomingHash),
        source: 'wren',
        summary: result.change.summary,
        applied: result.change.applied,
        expanders: result.change.expanders,
        sessionId: result.sessionId,
        wrenAt: Date.now()
    });

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
    _test: { originalInputFor, inputSnapshot, rentanControls, changedControls, rentanContextForWren, wrenInputHash, applyWrenChange, studioChangeFrom, staleReason, contextUnchanged, insertPrefixToken, isLegacyTendai, watchedBlocksReason }
};
