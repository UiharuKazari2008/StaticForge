/**
 * Localhost agent session bridge — bind one connected Studio client and drive it.
 * Routes stay under /agent (loopback + devAuth). Share codes and keys are never logged.
 */

const crypto = require('crypto');
const WebSocket = require('ws');
const {
    AVAILABLE_SCOPES,
    scopesAllowPacket
} = require('./applicationAuthManager');
const { getWsPacketEntry } = require('./ws/wsPacketRegistry');
const { buildStudioSettingsCatalog } = require('./studioSettingsCatalog');

const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARE_TTL_MS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 12000;
const UPDATE_COMMAND_TIMEOUT_MS = 20000;
const BIND_IDLE_MS = 15 * 60 * 1000;

const shareCodes = new Map(); // code -> { clientId, expiresAt }
const pendingResults = new Map(); // requestId -> { resolve, reject, timer, clientId }
const bindSessions = new Map(); // bindKey -> { clientId, lastInteractionAt, boundAt, actorName }
let lastBindResources = null;

function generateClientId() {
    return crypto.randomBytes(6).toString('hex');
}

function generateShareCode() {
    const bytes = crypto.randomBytes(6);
    let out = '';
    for (let i = 0; i < 6; i++) {
        out += SHARE_ALPHABET[bytes[i] % SHARE_ALPHABET.length];
    }
    return out;
}

function snippetUserAgent(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function isStudioChangePayload(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const kind = obj.dreamscape || obj.type || obj.kind;
    return kind === 'change' || kind === 'dreamscape-change' || kind === 'studio-change';
}

function readBoolFlag(value, defaultValue) {
    if (value === undefined || value === null) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
    return defaultValue;
}

function objectHasOwn(obj, key) {
    return !!(obj && typeof obj === 'object' && !Array.isArray(obj) && Object.prototype.hasOwnProperty.call(obj, key));
}

function rejectIllegalAutoCombo(autoApply, autoGenerate) {
    if (!autoApply && autoGenerate) {
        const err = new Error('autoGenerate requires autoApply');
        err.status = 400;
        throw err;
    }
}

function coerceStudioChangeObject(change) {
    if (change && typeof change === 'object' && !Array.isArray(change)) return change;
    if (typeof change !== 'string') return null;
    const raw = change.trim();
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_err) {
        return null;
    }
    return null;
}

function readArrayFieldFlag(fields, key) {
    if (!Array.isArray(fields)) return { present: false, value: undefined };
    const item = fields.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const id = entry.id || entry.name || entry.key;
        return id === key;
    });
    if (!item) return { present: false, value: undefined };
    if (item.value !== undefined) return { present: true, value: item.value };
    if (item.text !== undefined) return { present: true, value: item.text };
    const chunk = Array.isArray(item.chunks) && item.chunks[0];
    if (chunk && chunk.text !== undefined) return { present: true, value: chunk.text };
    return { present: true, value: true };
}

function readNestedFlagHost(host) {
    if (!host || typeof host !== 'object') {
        return { applyPresent: false, genPresent: false, autoApply: true, autoGenerate: false };
    }
    if (Array.isArray(host)) {
        const applyField = readArrayFieldFlag(host, 'autoApply');
        const genField = readArrayFieldFlag(host, 'autoGenerate');
        return {
            applyPresent: applyField.present,
            genPresent: genField.present,
            autoApply: readBoolFlag(applyField.present ? applyField.value : undefined, true),
            autoGenerate: readBoolFlag(genField.present ? genField.value : undefined, false)
        };
    }
    const applyPresent = objectHasOwn(host, 'autoApply');
    const genPresent = objectHasOwn(host, 'autoGenerate');
    return {
        applyPresent,
        genPresent,
        autoApply: readBoolFlag(applyPresent ? host.autoApply : undefined, true),
        autoGenerate: readBoolFlag(genPresent ? host.autoGenerate : undefined, false)
    };
}

function collectNestedFlagHosts(change) {
    const hosts = [];
    if (!change) return hosts;
    hosts.push(change);
    if (change.fields != null) hosts.push(change.fields);
    return hosts;
}

function resolveStudioAutoFlags(body) {
    const change = coerceStudioChangeObject(body && body.change);
    const siblingApply = objectHasOwn(body, 'autoApply');
    const siblingGen = objectHasOwn(body, 'autoGenerate');

    const autoApply = readBoolFlag(body && body.autoApply, true);
    const autoGenerate = readBoolFlag(body && body.autoGenerate, false);
    rejectIllegalAutoCombo(autoApply, autoGenerate);

    let nestedPresent = false;
    for (const host of collectNestedFlagHosts(change)) {
        const flags = readNestedFlagHost(host);
        if (flags.applyPresent || flags.genPresent) {
            rejectIllegalAutoCombo(flags.autoApply, flags.autoGenerate);
            nestedPresent = true;
        }
    }

    if (nestedPresent && !siblingApply && !siblingGen) {
        const err = new Error('autoApply/autoGenerate must be siblings of change, not inside change');
        err.status = 400;
        throw err;
    }

    return { autoApply, autoGenerate };
}

function stripStudioAutoFlags(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj || null;
    if (!objectHasOwn(obj, 'autoApply') && !objectHasOwn(obj, 'autoGenerate')) return obj;
    const clean = { ...obj };
    delete clean.autoApply;
    delete clean.autoGenerate;
    return clean;
}

function stripStudioAutoFlagsDeep(obj) {
    const clean = stripStudioAutoFlags(obj);
    if (!clean || typeof clean !== 'object' || Array.isArray(clean)) return clean;
    if (clean.fields && typeof clean.fields === 'object' && !Array.isArray(clean.fields)) {
        const fieldsClean = stripStudioAutoFlags(clean.fields);
        if (fieldsClean !== clean.fields) {
            return { ...clean, fields: fieldsClean };
        }
        return clean;
    }
    if (Array.isArray(clean.fields)) {
        const next = clean.fields.filter((item) => {
            if (!item || typeof item !== 'object') return true;
            const id = item.id || item.name || item.key;
            return id !== 'autoApply' && id !== 'autoGenerate';
        });
        if (next.length !== clean.fields.length) {
            return { ...clean, fields: next };
        }
    }
    return clean;
}

function studioChangePayloadWithoutFlags(body) {
    if (!isStudioChangePayload(body)) return null;
    return stripStudioAutoFlagsDeep(body);
}

const STUDIO_CHANGE_PARAM_KEYS = [
    'steps', 'guidance', 'rescale', 'sampler', 'noiseScheduler', 'model',
    'seed', 'seedLock', 'resolution', 'width', 'height', 'variety', 'upscale',
    'strength', 'noise', 'append_quality', 'append_uc', 'append_transparency', 'nsfw',
    'n', 'normalize_vibes', 'use_coords', 'save_base_output', 'skip_pipeline_stages',
    'nsfw_bias', 'quality_preset_bias', 'transparency_bias',
    'keep_newlines', 'auto_char_numerize', 'prompt_normalize', 'deduplicate_tags', 'auto_clean_uc'
];

function coerceStudioNsfwLevel(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < -2 || n > 3) return undefined;
    return n;
}

function pickDatasetConfigFromStudioArgs(body, params) {
    const src = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
    const fromBody = body && body.dataset_config && typeof body.dataset_config === 'object' && !Array.isArray(body.dataset_config)
        ? body.dataset_config
        : null;
    const fromParams = src.dataset_config && typeof src.dataset_config === 'object' && !Array.isArray(src.dataset_config)
        ? src.dataset_config
        : null;
    if (!fromBody && !fromParams) return null;
    return { ...(fromBody || {}), ...(fromParams || {}) };
}

function pickNsfwFromStudioArgs(body, params) {
    const src = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
    const nested = src.dataset_config && typeof src.dataset_config === 'object' ? src.dataset_config : null;
    const bodyCfg = body && body.dataset_config && typeof body.dataset_config === 'object' ? body.dataset_config : null;
    return coerceStudioNsfwLevel(
        src.nsfw != null ? src.nsfw
            : (nested && nested.nsfw != null ? nested.nsfw
                : (body && body.nsfw != null ? body.nsfw
                    : (bodyCfg && bodyCfg.nsfw)))
    );
}

function studioChangeFieldFromText(id, text) {
    const label = id === 'uc' ? 'UC' : (id === 'promptNegative' ? 'Prompt negative' : 'Prompt');
    return {
        id,
        action: 'replace',
        chunks: [{ name: label, text: String(text) }]
    };
}

function upsertStudioChangeField(fields, id, text) {
    if (text == null) return;
    const next = studioChangeFieldFromText(id, text);
    const index = fields.findIndex((entry) => entry && entry.id === id);
    if (index >= 0) fields[index] = next;
    else fields.push(next);
}

function assembleStudioChangeFromToolArgs(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    let base = coerceStudioChangeObject(body.change);
    if (!base && isStudioChangePayload(body)) {
        base = stripStudioAutoFlagsDeep(body);
    }
    const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
    if (base && base.params && typeof base.params === 'object' && !Array.isArray(base.params)) {
        out.params = { ...base.params };
    }
    if (Array.isArray(base && base.fields)) out.fields = base.fields.slice();
    if (Array.isArray(base && base.characters)) out.characters = base.characters.slice();
    if (Array.isArray(base && base.expanders)) out.expanders = base.expanders.slice();
    if (Array.isArray(base && base.vibes)) out.vibes = base.vibes.slice();

    out.dreamscape = out.dreamscape || 'change';
    out.v = out.v || 1;
    if (body.title && !out.title) out.title = body.title;

    const params = { ...(out.params || {}) };
    if (body.params && typeof body.params === 'object' && !Array.isArray(body.params)) {
        Object.assign(params, body.params);
    }
    STUDIO_CHANGE_PARAM_KEYS.forEach((key) => {
        if (body[key] !== undefined && params[key] === undefined) {
            params[key] = body[key];
        }
    });
    const nsfwLevel = pickNsfwFromStudioArgs(body, params);
    if (nsfwLevel !== undefined) params.nsfw = nsfwLevel;
    const datasetConfig = pickDatasetConfigFromStudioArgs(body, params);
    if (datasetConfig) {
        params.dataset_config = datasetConfig;
        out.dataset_config = datasetConfig;
    }
    if (Object.keys(params).length) out.params = params;

    const fields = Array.isArray(out.fields) ? out.fields.slice() : [];
    if (Array.isArray(body.fields) && !(base && Array.isArray(base.fields))) {
        body.fields.forEach((entry) => fields.push(entry));
    }
    upsertStudioChangeField(fields, 'prompt', body.prompt);
    upsertStudioChangeField(fields, 'uc', body.uc);
    const promptNegative = body.promptNegative != null ? body.promptNegative : body.input_prompt_negative;
    upsertStudioChangeField(fields, 'promptNegative', promptNegative);
    if (fields.length) out.fields = fields;

    if (Array.isArray(body.characters) && !out.characters) out.characters = body.characters;
    if (out.expanders === undefined && Array.isArray(body.expanders)) out.expanders = body.expanders;
    if (out.expanders === undefined && Array.isArray(body.text_replacements)) out.expanders = body.text_replacements;
    if (out.vibes === undefined && Array.isArray(body.vibes)) out.vibes = body.vibes;
    if (out.vibes === undefined && Array.isArray(body.vibe_transfer)) out.vibes = body.vibe_transfer;

    const dyn = body.dynamicGeneration || body.dynamic_generation
        || (base && (base.dynamicGeneration || base.dynamic_generation));
    if (dyn && typeof dyn === 'object' && !Array.isArray(dyn)) {
        out.dynamicGeneration = dyn;
    }
    const director = body.director || (base && base.director);
    if (director && typeof director === 'object' && !Array.isArray(director)) {
        out.director = director;
    }

    const hasContent = !!(
        (out.params && Object.keys(out.params).length)
        || (Array.isArray(out.fields) && out.fields.length)
        || (Array.isArray(out.characters) && out.characters.length)
        || Array.isArray(out.expanders)
        || Array.isArray(out.vibes)
        || out.dynamicGeneration
        || out.director
    );
    if (!hasContent) return null;
    return stripStudioAutoFlagsDeep(out);
}

function mapStudioCharactersToGeneratePrompts(characters) {
    if (!Array.isArray(characters)) return undefined;
    return characters.map((ch, index) => {
        if (!ch || typeof ch !== 'object') {
            return { prompt: '', uc: '', enabled: true, chara_name: `Character ${index + 1}`, center: null };
        }
        const pos = ch.center || ch.position;
        let center = null;
        if (pos && typeof pos === 'object' && pos.x != null && pos.y != null) {
            center = { x: Number(pos.x), y: Number(pos.y) };
        }
        return {
            prompt: ch.prompt || '',
            uc: ch.uc || '',
            input_prompt_negative: ch.input_prompt_negative || ch.promptNegative || '',
            center,
            enabled: ch.enabled !== false,
            chara_name: ch.chara_name || ch.name || `Character ${index + 1}`
        };
    });
}

function flattenGenerateToolArgs(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const out = { ...input };
    if (input.params && typeof input.params === 'object' && !Array.isArray(input.params)) {
        Object.keys(input.params).forEach((key) => {
            if (out[key] === undefined) out[key] = input.params[key];
        });
    }
    delete out.params;
    delete out.change;
    delete out.autoApply;
    delete out.autoGenerate;
    if (out.promptNegative != null && out.input_prompt_negative == null) {
        out.input_prompt_negative = out.promptNegative;
    }
    if (!Array.isArray(out.allCharacterPrompts) && Array.isArray(out.characters)) {
        out.allCharacterPrompts = mapStudioCharactersToGeneratePrompts(out.characters);
    }
    if (Array.isArray(out.allCharacterPrompts) && out.use_coords == null) {
        out.use_coords = out.allCharacterPrompts.some((ch) => ch && ch.center && ch.center.x != null && ch.center.y != null);
    }
    if (!Array.isArray(out.vibe_transfer) && Array.isArray(out.vibes)) {
        out.vibe_transfer = out.vibes;
    }
    if (!Array.isArray(out.text_replacements) && Array.isArray(out.expanders)) {
        out.text_replacements = out.expanders;
    }
    if (out.dynamicGeneration && !out.dynamic_generation) {
        out.dynamic_generation = out.dynamicGeneration;
    }
    if (out.userApprovedPaidRequest === true || out.user_approved_paid_request === true) {
        out.allow_paid = true;
    }
    if (out.nsfw != null && (out.dataset_config == null || out.dataset_config.nsfw == null)) {
        out.dataset_config = { ...(out.dataset_config || {}), nsfw: out.nsfw };
    }
    if (out.n != null) {
        const prints = parseInt(out.n, 10);
        if (!Number.isFinite(prints) || prints <= 1) {
            delete out.n;
        } else {
            out.n = Math.min(8, prints);
        }
    }
    if (out.director && typeof out.director === 'object' && !Array.isArray(out.director)) {
        if (out.director_session_id == null && (out.director.sessionId || out.director.session_id)) {
            out.director_session_id = out.director.sessionId || out.director.session_id;
        }
        if (out.director_message_id == null && (out.director.messageId || out.director.message_id)) {
            out.director_message_id = out.director.messageId || out.director.message_id;
        }
        if (out.dynamic_generation && typeof out.dynamic_generation === 'object'
            && out.director.prompt && out.dynamic_generation.directive == null) {
            out.dynamic_generation = { ...out.dynamic_generation, directive: out.director.prompt };
        }
    }
    return out;
}

function mergeExpansionOverrideParams(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const override = (input.overrideParams && typeof input.overrideParams === 'object' && !Array.isArray(input.overrideParams))
        ? { ...input.overrideParams }
        : {};
    ['model', 'steps', 'guidance', 'rescale', 'sampler', 'noiseScheduler', 'noise_schedule', 'noise', 'seed'].forEach((key) => {
        if (input[key] !== undefined && override[key] === undefined) override[key] = input[key];
    });
    if (input.noiseScheduler && override.noise_schedule === undefined) {
        override.noise_schedule = input.noiseScheduler;
    }
    if (Object.keys(override).length) input.overrideParams = override;
    return input;
}

function getWsServer(globalResources) {
    try {
        return globalResources.getWebSocketServer();
    } catch (_err) {
        return null;
    }
}

function ensureClientId(info) {
    if (!info) return null;
    if (!info.clientId) {
        info.clientId = generateClientId();
    }
    return info.clientId;
}

function pruneShareCodes(now = Date.now()) {
    for (const [code, entry] of shareCodes) {
        if (!entry || entry.expiresAt <= now) {
            shareCodes.delete(code);
        }
    }
}

function findClientById(wsServer, clientId) {
    if (!wsServer || !wsServer.clients || !clientId) return null;
    for (const [ws, info] of wsServer.clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (ensureClientId(info) === clientId) {
            return { ws, info };
        }
    }
    return null;
}

function resolveWorkspaceId(globalResources, info) {
    try {
        const workspaceManager = globalResources.getWorkspaceManager();
        if (info && info.sessionId && typeof workspaceManager.getActiveWorkspace === 'function') {
            return workspaceManager.getActiveWorkspace(info.sessionId) || null;
        }
    } catch (_err) {
        // session/workspace may be unavailable
    }
    return null;
}

function inferBoundWorkspaceId(globalResources, req) {
    const bindKey = resolveBindKey(req);
    const bound = bindKey ? getBoundRecord(globalResources, bindKey) : null;
    if (bound && bound.info) {
        const boundId = resolveWorkspaceId(globalResources, bound.info);
        if (boundId) return boundId;
    }
    const clients = listClients(globalResources, bindKey);
    const ids = [];
    const seen = new Set();
    for (const row of clients) {
        const id = row && row.workspaceId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    if (ids.length === 1) return ids[0];
    return null;
}

function resolveGenerateWorkspaceId(globalResources, req, input) {
    const raw = input && (input.workspace || input.workspaceId);
    if (raw != null && String(raw).trim()) {
        const trimmed = String(raw).trim();
        return trimmed.toLowerCase() === 'default' ? 'default' : trimmed;
    }
    return inferBoundWorkspaceId(globalResources, req) || 'default';
}

function resolveBindKey(req) {
    const auth = req && req.applicationAuth;
    if (auth && auth.applicationKeyId) return `appkey:${auth.applicationKeyId}`;
    if (req && req.authMethod === 'dev_login_key') return 'dev_login_key';
    if (auth && auth.sessionId) return String(auth.sessionId);
    if (req && req.sessionId) return `session:${req.sessionId}`;
    return null;
}

function resolveActorName(req) {
    const auth = req && req.applicationAuth;
    const raw = auth && (auth.appName != null ? auth.appName : auth.applicationAppName);
    const name = String(raw || '').trim();
    return name || null;
}

function boundActorName(bindKey) {
    const session = bindKey ? bindSessions.get(bindKey) : null;
    const name = session && session.actorName;
    return name ? String(name).trim() : null;
}

function requireBindKey(bindKey) {
    const key = String(bindKey || '').trim();
    if (!key) {
        const err = new Error('Application key is required to bind a Studio session');
        err.status = 401;
        throw err;
    }
    return key;
}

function clientLastActivityMs(info) {
    if (!info) return 0;
    const raw = info.lastActivity || info.connectedAt;
    if (!raw) return 0;
    const ms = raw instanceof Date ? raw.getTime() : Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
}

function expireIdleBind(bindKey) {
    if (!bindKey) return null;
    const session = bindSessions.get(bindKey);
    if (!session) return null;
    if (Date.now() - session.lastInteractionAt >= BIND_IDLE_MS) {
        if (lastBindResources) {
            unbindClient(lastBindResources, { bindKey, reason: 'idle' });
        } else {
            bindSessions.delete(bindKey);
        }
        return null;
    }
    return session;
}

function sweepIdleBinds() {
    for (const [key, session] of [...bindSessions]) {
        if (!session || Date.now() - session.lastInteractionAt < BIND_IDLE_MS) continue;
        if (lastBindResources) {
            unbindClient(lastBindResources, { bindKey: key, reason: 'idle' });
        } else {
            bindSessions.delete(key);
        }
    }
}

function getBoundClientId(bindKey) {
    const session = expireIdleBind(bindKey);
    return session ? session.clientId : null;
}

function touchBoundSession(bindKey) {
    const session = bindSessions.get(bindKey);
    if (session) session.lastInteractionAt = Date.now();
}

function clientHasOtherBind(clientId, exceptKey) {
    for (const [key, session] of bindSessions) {
        if (exceptKey && key === exceptKey) continue;
        if (session && session.clientId === clientId) return true;
    }
    return false;
}

function listClients(globalResources, bindKey) {
    const wsServer = getWsServer(globalResources);
    pruneShareCodes();
    expireIdleBind(bindKey);
    if (!wsServer || !wsServer.clients) return [];
    const boundId = getBoundClientId(bindKey);
    const out = [];
    for (const [ws, info] of wsServer.clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const clientId = ensureClientId(info);
        const lastMs = clientLastActivityMs(info);
        out.push({
            clientId,
            userType: info.userType || null,
            workspaceId: resolveWorkspaceId(globalResources, info),
            connectedAt: info.connectedAt ? new Date(info.connectedAt).toISOString() : null,
            lastActivity: lastMs ? new Date(lastMs).toISOString() : null,
            userAgent: snippetUserAgent(info.userAgent),
            bound: boundId === clientId,
            authenticated: !!info.authenticated
        });
    }
    out.sort((a, b) => {
        const aMs = a.lastActivity ? Date.parse(a.lastActivity) : 0;
        const bMs = b.lastActivity ? Date.parse(b.lastActivity) : 0;
        return bMs - aMs;
    });
    return out;
}

function getBoundRecord(globalResources, bindKey) {
    const boundId = getBoundClientId(bindKey);
    if (!boundId) return null;
    const found = findClientById(getWsServer(globalResources), boundId);
    if (!found) {
        if (bindKey) bindSessions.delete(bindKey);
        return null;
    }
    return found;
}

function notifyClient(wsServer, ws, type, data) {
    if (!wsServer || typeof wsServer.sendToClient !== 'function' || !ws) return;
    wsServer.sendToClient(ws, {
        type,
        data: data || {},
        timestamp: new Date().toISOString()
    });
}

function bindClient(globalResources, { clientId, code, bindKey, actorName }) {
    lastBindResources = globalResources;
    const key = requireBindKey(bindKey);
    const wsServer = getWsServer(globalResources);
    pruneShareCodes();
    let targetId = clientId ? String(clientId).trim() : '';
    if (code) {
        const normalized = String(code).trim().toUpperCase();
        const entry = shareCodes.get(normalized);
        if (!entry || entry.expiresAt <= Date.now()) {
            const err = new Error('Share code is invalid or expired');
            err.status = 404;
            throw err;
        }
        targetId = entry.clientId;
        shareCodes.delete(normalized);
    }
    if (!targetId) {
        const err = new Error('clientId or code is required');
        err.status = 400;
        throw err;
    }
    const found = findClientById(wsServer, targetId);
    if (!found) {
        const err = new Error('Client is not connected');
        err.status = 404;
        throw err;
    }
    const previous = bindSessions.get(key);
    if (previous && previous.clientId !== targetId) {
        if (!clientHasOtherBind(previous.clientId, key)) {
            const prevFound = findClientById(wsServer, previous.clientId);
            if (prevFound) {
                notifyClient(wsServer, prevFound.ws, 'agent_session_unbound', {
                    clientId: previous.clientId,
                    reason: 'rebind'
                });
            }
        }
    }
    const alreadyThisKey = previous && previous.clientId === targetId;
    const resolvedActor = String(actorName || (previous && previous.actorName) || '').trim() || null;
    bindSessions.set(key, {
        clientId: targetId,
        lastInteractionAt: Date.now(),
        boundAt: alreadyThisKey && previous.boundAt ? previous.boundAt : Date.now(),
        actorName: resolvedActor
    });
    if (!alreadyThisKey) {
        notifyClient(wsServer, found.ws, 'agent_session_bound', {
            clientId: targetId,
            ...(resolvedActor ? { actorName: resolvedActor } : {})
        });
    }
    return {
        success: true,
        clientId: targetId,
        bound: true,
        userType: found.info.userType || null,
        workspaceId: resolveWorkspaceId(globalResources, found.info)
    };
}

function unbindClient(globalResources, { bindKey, clientId, reason } = {}) {
    const wsServer = getWsServer(globalResources);
    const notified = new Set();
    const released = [];
    for (const [key, session] of [...bindSessions]) {
        const matchKey = bindKey ? key === bindKey : true;
        const matchClient = clientId ? session.clientId === clientId : true;
        if (!matchKey || !matchClient) continue;
        bindSessions.delete(key);
        released.push({ clientId: session.clientId });
        if (notified.has(session.clientId)) continue;
        if (clientHasOtherBind(session.clientId, null)) continue;
        const found = findClientById(wsServer, session.clientId);
        if (found) {
            notifyClient(wsServer, found.ws, 'agent_session_unbound', {
                clientId: session.clientId,
                reason: reason || 'manual'
            });
            notified.add(session.clientId);
        }
    }
    return {
        success: true,
        unbound: released.length > 0,
        clientId: clientId || (released[0] && released[0].clientId) || null,
        reason: reason || 'manual'
    };
}

function handleAgentSessionUnbind(handlersCtx, ws, message, clientInfo) {
    const wsServer = handlersCtx && handlersCtx.globalResources
        ? getWsServer(handlersCtx.globalResources)
        : null;
    const info = clientInfo || (wsServer && wsServer.clients ? wsServer.clients.get(ws) : null);
    if (!info) {
        handlersCtx.sendError(ws, 'Unknown client', 'agent_session_unbind', message.requestId);
        return;
    }
    const thisClientId = ensureClientId(info);
    const result = unbindClient(handlersCtx.globalResources, {
        clientId: thisClientId,
        reason: 'tray'
    });
    handlersCtx.sendToClient(ws, {
        type: 'agent_session_unbind_response',
        requestId: message.requestId,
        data: {
            success: true,
            unbound: result.unbound,
            clientId: thisClientId
        },
        timestamp: new Date().toISOString()
    });
}

function handleSessionShareStart(handlersCtx, ws, message, clientInfo) {
    const wsServer = handlersCtx && handlersCtx.globalResources
        ? getWsServer(handlersCtx.globalResources)
        : null;
    const info = clientInfo || (wsServer && wsServer.clients ? wsServer.clients.get(ws) : null);
    if (!info) {
        handlersCtx.sendError(ws, 'Unknown client', 'session_share_start', message.requestId);
        return;
    }
    const clientId = ensureClientId(info);
    if (message.userAgent) {
        info.userAgent = snippetUserAgent(message.userAgent);
    }
    pruneShareCodes();
    for (const [existingCode, entry] of shareCodes) {
        if (entry.clientId === clientId) {
            shareCodes.delete(existingCode);
        }
    }
    let code = generateShareCode();
    while (shareCodes.has(code)) {
        code = generateShareCode();
    }
    shareCodes.set(code, {
        clientId,
        expiresAt: Date.now() + SHARE_TTL_MS
    });
    handlersCtx.sendToClient(ws, {
        type: 'session_share_code_response',
        requestId: message.requestId,
        data: {
            success: true,
            clientId,
            code,
            expiresInSec: Math.round(SHARE_TTL_MS / 1000)
        },
        timestamp: new Date().toISOString()
    });
}

function handleAgentSessionResult(handlersCtx, ws, message) {
    const requestId = message && message.requestId;
    const entry = pendingResults.get(requestId);
    if (!entry) return;
    const wsServer = handlersCtx && handlersCtx.globalResources
        ? getWsServer(handlersCtx.globalResources)
        : null;
    const info = wsServer && wsServer.clients ? wsServer.clients.get(ws) : null;
    const clientId = info ? ensureClientId(info) : null;
    if (clientId !== entry.clientId) return;
    clearTimeout(entry.timer);
    pendingResults.delete(requestId);
    entry.resolve(message.data || {});
}

function sendBoundCommand(globalResources, command, payload, timeoutMs, bindKey) {
    if (timeoutMs && typeof timeoutMs === 'object') {
        bindKey = timeoutMs.bindKey;
        timeoutMs = timeoutMs.timeoutMs;
    }
    if (timeoutMs == null) timeoutMs = COMMAND_TIMEOUT_MS;
    const key = requireBindKey(bindKey);
    const bound = getBoundRecord(globalResources, key);
    if (!bound) {
        const err = new Error('No Studio client is bound');
        err.status = 404;
        throw err;
    }
    touchBoundSession(key);
    const boundId = getBoundClientId(key);
    const wsServer = getWsServer(globalResources);
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingResults.delete(requestId);
            const err = new Error('Bound client did not reply');
            err.status = 504;
            reject(err);
        }, timeoutMs);
        pendingResults.set(requestId, {
            resolve,
            reject,
            timer,
            clientId: boundId
        });
        const actorName = boundActorName(key);
        wsServer.sendToClient(bound.ws, {
            type: 'agent_session_command',
            requestId,
            data: {
                command,
                ...(payload || {}),
                ...(actorName ? { actorName } : {})
            },
            timestamp: new Date().toISOString()
        });
    });
}

function dynamicConfigFromSnapshot(dyn) {
    const config = { tod: true, weather: true, season: true, location: 'CLIENT' };
    if (!dyn || typeof dyn !== 'object' || Array.isArray(dyn)) return config;
    if (dyn.tod !== undefined && dyn.tod !== null) config.tod = dyn.tod;
    if (dyn.weather !== undefined && dyn.weather !== null) config.weather = dyn.weather;
    if (dyn.season !== undefined && dyn.season !== null) config.season = dyn.season;
    if (dyn.location) config.location = dyn.location;
    return config;
}

async function resolveDynamicContextSafe(globalResources, dynamicConfig, clientIP) {
    const { resolveDynamicContext } = require('./dynamicGenerationHandlers');
    try {
        return await resolveDynamicContext(globalResources, dynamicConfig, clientIP || null);
    } catch (_err) {
        const fallback = { ...dynamicConfig };
        delete fallback.location;
        return resolveDynamicContext(globalResources, fallback, clientIP || null);
    }
}

async function enrichDynamicGenerationForMcp(globalResources, bindKey, dynamicGeneration) {
    const settings = (dynamicGeneration && typeof dynamicGeneration === 'object' && !Array.isArray(dynamicGeneration))
        ? { ...dynamicGeneration }
        : null;
    const bound = bindKey ? getBoundRecord(globalResources, bindKey) : null;
    const clientIP = bound && bound.info ? bound.info.clientIP : null;
    let resolved = null;
    if (!settings || settings.enabled !== false) {
        try {
            resolved = await resolveDynamicContextSafe(globalResources, dynamicConfigFromSnapshot(settings), clientIP);
        } catch (_err) {
            resolved = null;
        }
    }
    if (!settings && !resolved) {
        return { enabled: false, resolved: null, directorApi: 'noop' };
    }
    return {
        ...(settings || { enabled: true }),
        resolved,
        directorApi: 'noop'
    };
}

const DYNAGEN_INTEGRATION_NEXT = 'Bake dynamicGeneration.resolved (time, date, timeOfDay, weather, season, location) into prompt, uc, and characters. Then retry this tool with the compiled prompt and dynamicGeneration.integrated=true. Settings are stamped on the file; the server will not compile. Director API is nooped.';

function normalizeDynagenInput(dyn) {
    if (dyn === true) return { enabled: true };
    if (dyn && typeof dyn === 'object' && !Array.isArray(dyn)) return dyn;
    return null;
}

function pickDynagenFromInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    return normalizeDynagenInput(input.dynamicGeneration || input.dynamic_generation);
}

function pickPhysicsOverrides(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const nested = input.dynamicGeneration || input.dynamic_generation || input.dynamicConfig;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return { ...nested };
    const out = {};
    let any = false;
    ['tod', 'weather', 'season', 'location', 'enabled'].forEach((key) => {
        if (input[key] !== undefined && input[key] !== null) {
            out[key] = input[key];
            any = true;
        }
    });
    return any ? out : null;
}

function dynagenShouldCompile(dyn) {
    const settings = normalizeDynagenInput(dyn);
    if (!settings) return false;
    if (settings.enabled === false) return false;
    return true;
}

function dynagenNeedsIntegration(dyn) {
    const settings = normalizeDynagenInput(dyn);
    if (!settings) return false;
    if (settings.enabled === false) return false;
    if (settings.integrated === true || settings.integrated === 'true') return false;
    const compiled = settings.compiled_prompt;
    if (compiled && typeof compiled === 'object' && compiled.success === false) {
        return false;
    }
    if (compiled && typeof compiled === 'object'
        && compiled.success !== false
        && compiled.prompt_hash
        && compiled.request_hash) {
        return false;
    }
    return true;
}

function sanitizeDynagenForGenerate(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const dyn = payload.dynamic_generation || payload.dynamicGeneration;
    if (!dyn || typeof dyn !== 'object' || Array.isArray(dyn)) return payload;
    const clean = { ...dyn };
    delete clean.integrated;
    delete clean.resolved;
    delete clean.directorApi;
    delete clean.needsIntegration;
    payload.dynamic_generation = clean;
    payload.dynamicGeneration = clean;
    return payload;
}

function buildDynagenIntegrationPayload(enriched) {
    return {
        success: false,
        needsIntegration: true,
        dynamicGeneration: enriched,
        next: DYNAGEN_INTEGRATION_NEXT
    };
}

async function buildDynagenIntegrationBlock(globalResources, bindKey, dyn) {
    const enriched = await enrichDynamicGenerationForMcp(
        globalResources,
        bindKey || null,
        normalizeDynagenInput(dyn)
    );
    return buildDynagenIntegrationPayload(enriched);
}

async function guardStudioAutoGenerateDynagen(globalResources, bindKey, body) {
    const { autoGenerate } = resolveStudioAutoFlags(body || {});
    if (!autoGenerate) return null;
    const assembled = assembleStudioChangeFromToolArgs(body || {});
    const dyn = assembled && assembled.dynamicGeneration;
    if (!dynagenNeedsIntegration(dyn)) return null;
    return buildDynagenIntegrationBlock(globalResources, bindKey, dyn);
}

async function getClientPhysics(globalResources, bindKey, overrides) {
    const key = bindKey ? String(bindKey).trim() : '';
    const bound = key ? getBoundRecord(globalResources, key) : null;
    let settings = pickPhysicsOverrides(overrides);
    if (!settings && bound) {
        try {
            const state = await sendBoundCommand(globalResources, 'get_state', {}, 8000, key);
            if (state && state.dynamicGeneration && typeof state.dynamicGeneration === 'object') {
                settings = state.dynamicGeneration;
            }
        } catch (_err) {
            // fall through to get_physics buttons
        }
        if (!settings) {
            try {
                const data = await sendBoundCommand(globalResources, 'get_physics', {}, 8000, key);
                if (data && data.ok && data.dynamicConfig && typeof data.dynamicConfig === 'object') {
                    settings = { enabled: true, ...data.dynamicConfig };
                }
            } catch (_err) {
                // compile from client IP when the tab does not reply
            }
        }
    }
    const enriched = await enrichDynamicGenerationForMcp(globalResources, bound ? key : null, settings);
    const physics = enriched.resolved || {};
    if (bound) {
        const wsServer = getWsServer(globalResources);
        const actorName = boundActorName(key);
        notifyClient(wsServer, bound.ws, 'agent_session_notice', {
            action: 'physics',
            clientId: getBoundClientId(key),
            ...(actorName ? { actorName } : {})
        });
    }
    return {
        success: true,
        clientId: bound ? getBoundClientId(key) : null,
        unbound: !bound,
        location: physics.location || null,
        tod: physics.timeOfDay || null,
        time: physics.time || null,
        date: physics.date || null,
        weather: physics.weather || null,
        season: physics.season || null,
        resolved: enriched.resolved,
        dynamicGeneration: enriched
    };
}

function handleRouteError(res, error, fallback) {
    const status = error && error.status ? error.status : 500;
    const message = status >= 500 ? fallback : (error.message || fallback);
    return res.status(status).json({ success: false, error: message });
}

function resolveAgentAuthScopes(req) {
    if (req.authMethod === 'dev_login_key' || req.userType === 'dev_admin') {
        return ['universal'];
    }
    const scopes = req.applicationAuth && req.applicationAuth.applicationScopes;
    return Array.isArray(scopes) ? scopes : [];
}

function agentHasNamedScope(scopes, scopeId) {
    if (!scopeId) return true;
    if (!Array.isArray(scopes) || scopes.length === 0) return false;
    if (scopes.includes('universal')) return true;
    return scopes.includes(scopeId);
}

function buildAgentScopePayload(req, globalResources) {
    const scopes = resolveAgentAuthScopes(req);
    const payload = {
        scopes,
        catalog: AVAILABLE_SCOPES.map((item) => ({ ...item }))
    };
    if (agentHasNamedScope(scopes, 'vfs')) {
        payload.vfsPathUuid = globalResources.getVfsPathUuid();
    }
    return payload;
}

function resolveAgentPacketMessage(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const type = String(body.type || body.packet || '').trim();
    if (!type) return null;
    const message = { ...body, type };
    delete message.packet;
    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
        Object.assign(message, body.data);
    }
    if (!message.requestId) {
        message.requestId = `agent-${crypto.randomBytes(6).toString('hex')}`;
    }
    return message;
}

function createAgentPacketSink(liveServer) {
    const replies = [];
    const ws = {
        readyState: 1,
        send(raw) {
            try {
                replies.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
            } catch (_err) {
                replies.push({ type: 'error', message: 'Invalid handler payload' });
            }
        }
    };
    const wsServer = {
        clients: (liveServer && liveServer.clients) || new Map(),
        sendToClient(_ws, payload) {
            if (payload) replies.push(payload);
        },
        broadcast(payload, filter) {
            if (liveServer && typeof liveServer.broadcast === 'function') {
                liveServer.broadcast(payload, filter);
            }
        },
        broadcastToAll(...args) {
            if (liveServer && typeof liveServer.broadcastToAll === 'function') {
                return liveServer.broadcastToAll(...args);
            }
        }
    };
    return { ws, wsServer, replies };
}

async function dispatchAgentPacket(globalResources, req, message) {
    const scopes = resolveAgentAuthScopes(req);
    if (!scopesAllowPacket(scopes, message.type)) {
        const err = new Error('Application key does not have scope for this operation');
        err.status = 403;
        err.code = 'INSUFFICIENT_SCOPE';
        throw err;
    }
    const entry = getWsPacketEntry(message.type);
    if (!entry || typeof entry.handler !== 'function') {
        const err = new Error(`Unknown message type: ${message.type}`);
        err.status = 404;
        throw err;
    }
    const handlers = globalResources.getWebSocketMessageHandlers();
    if (!handlers) {
        const err = new Error('WebSocket handlers are not ready');
        err.status = 503;
        throw err;
    }
    if (req.userType === 'readonly' && handlers.isDestructiveOperation(message.type)) {
        const err = new Error('Non-Administrator Login: This operation is not allowed for read-only users');
        err.status = 403;
        err.code = 'READONLY_RESTRICTED';
        throw err;
    }
    const liveServer = typeof globalResources.getWebSocketServer === 'function'
        ? globalResources.getWebSocketServer()
        : null;
    const sink = createAgentPacketSink(liveServer);
    const clientInfo = {
        authenticated: true,
        userType: req.userType || 'admin',
        authMethod: req.authMethod || 'application_key',
        applicationScopes: scopes,
        sessionId: req.sessionId || (req.applicationAuth && req.applicationAuth.sessionId) || null,
        userAgent: snippetUserAgent(req.headers && req.headers['user-agent'])
    };
    await entry.handler({
        ws: sink.ws,
        message,
        clientInfo,
        wsServer: sink.wsServer,
        handlers
    });
    return sink.replies;
}

function registerRoutes(app, { devAuthMiddleware, globalResources }) {
    app.get('/agent/scopes', devAuthMiddleware, (req, res) => {
        try {
            return res.json({
                success: true,
                ...buildAgentScopePayload(req, globalResources)
            });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to list agent scopes');
        }
    });

    app.post('/agent/packet', devAuthMiddleware, async (req, res) => {
        try {
            const message = resolveAgentPacketMessage(req.body || {});
            if (!message) {
                return res.status(400).json({ success: false, error: 'type is required' });
            }
            const replies = await dispatchAgentPacket(globalResources, req, message);
            const first = replies[0] || null;
            return res.json({
                success: !(first && first.type === 'error'),
                type: first && first.type ? first.type : null,
                requestId: message.requestId,
                data: first && first.data !== undefined ? first.data : null,
                reply: first,
                replies
            });
        } catch (error) {
            const status = error && error.status ? error.status : 500;
            return res.status(status).json({
                success: false,
                error: status >= 500 ? 'Failed to dispatch agent packet' : (error.message || 'Failed to dispatch agent packet'),
                code: error && error.code ? error.code : undefined
            });
        }
    });

    app.get('/agent/clients', devAuthMiddleware, (req, res) => {
        try {
            const bindKey = resolveBindKey(req);
            return res.json({
                success: true,
                clients: listClients(globalResources, bindKey),
                boundClientId: getBoundClientId(bindKey)
            });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to list clients');
        }
    });

    app.post('/agent/bind', devAuthMiddleware, (req, res) => {
        try {
            const body = req.body || {};
            return res.json(bindClient(globalResources, {
                clientId: body.clientId || body.client_id,
                code: body.code,
                bindKey: resolveBindKey(req),
                actorName: resolveActorName(req)
            }));
        } catch (error) {
            return handleRouteError(res, error, 'Failed to bind client');
        }
    });

    app.post('/agent/unbind', devAuthMiddleware, (req, res) => {
        try {
            const body = req.body || {};
            return res.json(unbindClient(globalResources, {
                bindKey: resolveBindKey(req),
                clientId: body.clientId || body.client_id || undefined,
                reason: body.reason || 'manual'
            }));
        } catch (error) {
            return handleRouteError(res, error, 'Failed to unbind client');
        }
    });

    app.post('/agent/session/open-image', devAuthMiddleware, async (req, res) => {
        try {
            const filename = String((req.body && req.body.filename) || '').trim();
            if (!filename) {
                return res.status(400).json({ success: false, error: 'filename is required' });
            }
            const bindKey = resolveBindKey(req);
            const data = await sendBoundCommand(globalResources, 'open_image', { filename }, COMMAND_TIMEOUT_MS, bindKey);
            return res.json({ success: true, ...data });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to open image on bound client');
        }
    });

    app.post('/agent/session/studio', devAuthMiddleware, async (req, res) => {
        try {
            const body = req.body || {};
            const { autoApply, autoGenerate } = resolveStudioAutoFlags(body);
            const assembled = assembleStudioChangeFromToolArgs(body);
            if (!assembled) {
                return res.status(400).json({ success: false, error: 'change JSON or prompt/uc/params fields are required' });
            }
            const bindKey = resolveBindKey(req);
            const blocked = await guardStudioAutoGenerateDynagen(globalResources, bindKey, body);
            if (blocked) {
                return res.status(409).json(blocked);
            }
            const data = await sendBoundCommand(globalResources, 'apply_studio', {
                change: assembled,
                prompt: body.prompt,
                uc: body.uc,
                autoApply,
                autoGenerate
            }, COMMAND_TIMEOUT_MS, bindKey);
            return res.json({ success: true, ...data });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to apply studio change on bound client');
        }
    });

    app.post('/agent/session/update', devAuthMiddleware, async (req, res) => {
        try {
            const bindKey = resolveBindKey(req);
            const data = await sendBoundCommand(globalResources, 'client_update', {}, UPDATE_COMMAND_TIMEOUT_MS, bindKey);
            return res.json({ success: true, ...data });
        } catch (error) {
            return handleRouteError(res, error, 'Failed to push update+restart on bound client');
        }
    });

    app.get('/agent/session/physics', devAuthMiddleware, async (req, res) => {
        try {
            const data = await getClientPhysics(
                globalResources,
                resolveBindKey(req),
                pickPhysicsOverrides(req.query)
            );
            return res.json(data);
        } catch (error) {
            return handleRouteError(res, error, 'Failed to read bound client physics');
        }
    });

    app.get('/agent/session/state', devAuthMiddleware, async (req, res) => {
        try {
            const bindKey = resolveBindKey(req);
            const bound = getBoundRecord(globalResources, bindKey);
            if (!bound) {
                return res.status(404).json({ success: false, error: 'No Studio client is bound' });
            }
            const boundId = getBoundClientId(bindKey);
            const scopePayload = buildAgentScopePayload(req, globalResources);
            const fallback = {
                workspaceId: resolveWorkspaceId(globalResources, bound.info),
                filename: null,
                model: null,
                clientId: boundId,
                change: null,
                settings: buildStudioSettingsCatalog(globalResources),
                scopes: scopePayload.scopes
            };
            if (scopePayload.vfsPathUuid) fallback.vfsPathUuid = scopePayload.vfsPathUuid;
            try {
                const data = await sendBoundCommand(globalResources, 'get_state', {}, 8000, bindKey);
                const change = (data && data.change && typeof data.change === 'object' && !Array.isArray(data.change))
                    ? data.change
                    : null;
                return res.json({
                    success: true,
                    workspaceId: data.workspaceId || fallback.workspaceId,
                    filename: data.filename || null,
                    model: data.model || null,
                    clientId: boundId,
                    bound: true,
                    change,
                    dynamicGeneration: await enrichDynamicGenerationForMcp(
                        globalResources,
                        bindKey,
                        data.dynamicGeneration || (change && change.dynamicGeneration) || null
                    ),
                    director: data.director || (change && change.director) || null,
                    settings: buildStudioSettingsCatalog(globalResources, data.model),
                    scopes: scopePayload.scopes,
                    ...(scopePayload.vfsPathUuid ? { vfsPathUuid: scopePayload.vfsPathUuid } : {})
                });
            } catch (error) {
                if (error.status === 504) {
                    return res.json({
                        success: true,
                        ...fallback,
                        bound: true,
                        partial: true
                    });
                }
                throw error;
            }
        } catch (error) {
            return handleRouteError(res, error, 'Failed to read bound session state');
        }
    });
}

setInterval(sweepIdleBinds, 30000).unref();

module.exports = {
    registerRoutes,
    handleSessionShareStart,
    handleAgentSessionResult,
    handleAgentSessionUnbind,
    listClients,
    bindClient,
    unbindClient,
    getBoundRecord,
    getBoundClientId,
    resolveBindKey,
    resolveActorName,
    getClientPhysics,
    enrichDynamicGenerationForMcp,
    dynamicConfigFromSnapshot,
    normalizeDynagenInput,
    pickDynagenFromInput,
    pickPhysicsOverrides,
    dynagenNeedsIntegration,
    dynagenShouldCompile,
    sanitizeDynagenForGenerate,
    buildDynagenIntegrationBlock,
    guardStudioAutoGenerateDynagen,
    DYNAGEN_INTEGRATION_NEXT,
    dispatchAgentPacket,
    sendBoundCommand,
    resolveStudioAutoFlags,
    coerceStudioChangeObject,
    assembleStudioChangeFromToolArgs,
    flattenGenerateToolArgs,
    resolveGenerateWorkspaceId,
    inferBoundWorkspaceId,
    mergeExpansionOverrideParams,
    stripStudioAutoFlagsDeep,
    studioChangePayloadWithoutFlags,
    isStudioChangePayload,
    resolveAgentPacketMessage,
    resolveAgentAuthScopes,
    agentHasNamedScope,
    buildAgentScopePayload,
    _test: {
        generateShareCode,
        generateClientId,
        pruneShareCodes,
        shareCodes,
        snippetUserAgent,
        isStudioChangePayload,
        readBoolFlag,
        resolveStudioAutoFlags,
        studioChangePayloadWithoutFlags,
        stripStudioAutoFlags,
        stripStudioAutoFlagsDeep,
        coerceStudioChangeObject,
        assembleStudioChangeFromToolArgs,
        flattenGenerateToolArgs,
        resolveGenerateWorkspaceId,
        inferBoundWorkspaceId,
        mergeExpansionOverrideParams,
        mapStudioCharactersToGeneratePrompts,
        dynamicConfigFromSnapshot,
        enrichDynamicGenerationForMcp,
        normalizeDynagenInput,
        pickDynagenFromInput,
        pickPhysicsOverrides,
        dynagenNeedsIntegration,
        dynagenShouldCompile,
        sanitizeDynagenForGenerate,
        buildDynagenIntegrationPayload,
        DYNAGEN_INTEGRATION_NEXT,
        STUDIO_CHANGE_PARAM_KEYS,
        pickNsfwFromStudioArgs,
        pickDatasetConfigFromStudioArgs,
        coerceStudioNsfwLevel,
        objectHasOwn,
        SHARE_TTL_MS,
        SHARE_ALPHABET,
        UPDATE_COMMAND_TIMEOUT_MS,
        BIND_IDLE_MS,
        bindSessions,
        sweepIdleBinds,
        resolveBindKey,
        resolveActorName,
        boundActorName,
        requireBindKey,
        expireIdleBind,
        unbindClient,
        clientLastActivityMs,
        resolveAgentAuthScopes,
        resolveAgentPacketMessage,
        agentHasNamedScope,
        buildAgentScopePayload
    }
};
