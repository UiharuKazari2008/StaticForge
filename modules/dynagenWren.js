'use strict';

// Rentan (dynamic generation) compile step. Wren writes dg_ expanders in a hidden
// per-workspace Director chat (cursorDirector.runDynagenTurn). Called at the top of
// imageGeneration buildOptions so the expanders and prompt edits land before
// text replacement processing. Expiry is calculateDynamicExpiration, same as the
// old Director API cache.

const crypto = require('crypto');
const {
    compileContext,
    calculateDynamicExpiration,
    formatContextForCarousel
} = require('./dynamicGenerationHandlers');
const {
    generatePromptHash,
    generateRequestHash,
    generateDirectiveHash
} = require('./dynamicGenerationHandlers.hash');

const DG_PREFIX = /^dg_/i;
const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;
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

function stampCompiled(gr, body, dg, preset, context, fields) {
    const now = Date.now();
    const existing = dg.compiled_prompt && typeof dg.compiled_prompt === 'object' ? dg.compiled_prompt : {};
    const rawPrompt = (body.prompt !== undefined && body.prompt !== null) ? body.prompt : preset?.prompt;
    const rawUc = (body.uc !== undefined && body.uc !== null) ? body.uc : preset?.uc;
    const rawNeg = body.input_prompt_negative ?? body.prompt_negative ?? preset?.input_prompt_negative ?? preset?.prompt_negative ?? '';
    dg.compiled_prompt = {
        success: true,
        source: fields.source,
        integrated: true,
        context,
        // Legacy Tendai stays read-only on old images; Wren output is dg_expanders.
        text_replacements: EMPTY_TENDAI,
        dg_expanders: dgExpandersFrom(body.text_replacements),
        summary: fields.summary != null ? fields.summary : (existing.summary || null),
        wren_session_id: fields.sessionId || existing.wren_session_id || null,
        wren_input_hash: wrenInputHash(body, dg),
        prompt_hash: generatePromptHash(rawPrompt, rawUc, body.allCharacterPrompts || preset?.allCharacterPrompts || [], rawNeg || ''),
        request_hash: dynagenRequestHash(dg),
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
    if (cp.request_hash !== dynagenRequestHash(dg)) return 'Rentan toggles changed';
    if ((cp.directive_hash || null) !== (dg.directive ? generateDirectiveHash(dg.directive) : null)) return 'directive changed';
    const watched = watchedBlocksReason(cp, body);
    if (watched) return watched;
    if (cp.expiresAt && now < cp.expiresAt) return null;
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
    if (!dg || typeof dg !== 'object' || Array.isArray(dg) || !dg.enabled) return;
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
    if (!reason) {
        if (!dgExpandersFrom(body.text_replacements).length && cp.dg_expanders && cp.dg_expanders.length) {
            body.text_replacements = (Array.isArray(body.text_replacements) ? body.text_replacements : [])
                .concat(cp.dg_expanders.map((e) => ({ name: e.prefix, value: e.value })));
        }
        const keepExpiry = cp.expiresAt && now < cp.expiresAt ? cp.expiresAt : null;
        stampCompiled(gr, body, dg, preset, context, { source: cp.source || 'wren', expiresAt: keepExpiry });
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
            context: formatContextForCarousel(context),
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
        const message = `Rentan: Wren could not resolve the scene (${error.message || 'unknown error'}). Turn Rentan off or try again.`;
        sendRentanError(handler, ws, message);
        throw new Error(message);
    }

    if (body.prompt === undefined && preset?.prompt) body.prompt = preset.prompt;
    applyWrenChange(body, result.change);
    stampCompiled(gr, body, dg, preset, context, {
        source: 'wren',
        summary: result.change.summary,
        sessionId: result.sessionId
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
    _test: { wrenInputHash, applyWrenChange, studioChangeFrom, staleReason, contextUnchanged, insertPrefixToken, isLegacyTendai, watchedBlocksReason }
};
