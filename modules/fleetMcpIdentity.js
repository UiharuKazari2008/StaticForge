'use strict';

/**
 * Who a Fleet Claude session is, to the Remote Access notice (#1199).
 *
 * Every Claude session used one MCP application key, "Claude Code", so the notice ("Your session was
 * accessed by ...") could not tell Yukimi's own session from a Fleet one. Fleet sessions now carry one
 * of two keys of their own:
 *   - "Fleet"             a session started in Fleet
 *   - "Fleet work items"  a session working a Supervisor work item
 * plus the header X-Fleet-Session: <claude session uuid> (modules/claudeSessionLauncher.js writes the
 * session's MCP config). Key + header become a display label such as
 *   Fleet access "Fix the notice"
 *   Fleet access, work item #42 "Fix the notice"
 * The label is for DISPLAY only (bind, activity and notice packets). Identity and ownership decisions
 * keep the raw key name (agentClientBridge.resolveActorName). Docs: docs/fleet/fleet-mcp-identity.md.
 *
 * Top-level requires are fs / path / os / crypto only: the session launcher loads this at session
 * start, and everything heavier is required lazily inside the function that needs it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const FLEET_SESSION_HEADER = 'x-fleet-session';
const FLEET_KEY_LABELS = Object.freeze({ fleet: 'Fleet', item: 'Fleet work items' });
const FLEET_KEY_UA = 'DreamscapeFleet/1.0';
const KEY_FILE_NAMES = Object.freeze({ fleet: 'fleet.key', item: 'fleet-items.key' });
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TITLE_MAX = 60;
const INFO_TTL_MS = 30 * 1000;
// the Supervisor writes a work item's session_id only after the launch returns: an item session's first calls
// must not keep "no work item" for 30 s
const ITEM_MISS_TTL_MS = 3 * 1000;
const INFO_CACHE_MAX = 500;

function stateDir() {
    return process.env.DREAMSCAPE_CLAUDE_DESK_STATE || path.join(os.homedir(), '.local', 'state', 'dreamscape-agents');
}

function cleanKind(kind) {
    if (kind === 'fleet' || kind === 'item') return kind;
    throw new Error(`Fleet MCP key kind must be 'fleet' or 'item', not '${String(kind)}'`);
}

function keyDir() {
    return path.join(stateDir(), 'fleet-mcp');
}

/** Absolute path of the 0600 file that holds the key of this kind ('fleet' or 'item'). Never read by this function. */
function keyFile(kind) {
    return path.join(keyDir(), KEY_FILE_NAMES[cleanKind(kind)]);
}

function isFleetLabel(name) {
    const text = String(name == null ? '' : name).trim();
    return text === FLEET_KEY_LABELS.fleet || text === FLEET_KEY_LABELS.item;
}

function kindOfLabel(name) {
    const text = String(name == null ? '' : name).trim();
    if (text === FLEET_KEY_LABELS.fleet) return 'fleet';
    if (text === FLEET_KEY_LABELS.item) return 'item';
    return null;
}

// Same rule as agentClientBridge.resolveActorName (kept here so this module never loads the bridge;
// scripts/test-fleet-mcp-identity.js asserts the two agree).
function rawAppName(req) {
    try {
        const auth = req && req.applicationAuth;
        const raw = auth && (auth.appName != null ? auth.appName : auth.applicationAppName);
        const name = String(raw || '').trim();
        return name || null;
    } catch (_) {
        return null;
    }
}

// ---------------------------------------------------------------- the keys

const flights = new Map(); // kind -> in-flight promise, so two parallel launches never mint two keys

function managerOf(gr) {
    let manager = null;
    try {
        manager = gr && typeof gr.getApplicationAuthManager === 'function' ? gr.getApplicationAuthManager() : null;
    } catch (_) {
        manager = null;
    }
    return manager;
}

function readKeyFile(file) {
    try {
        return fs.readFileSync(file, 'utf8').trim();
    } catch (_) {
        return '';
    }
}

function writeKeyFile(file, key) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch (_) { /* not ours to chmod: the write below still works */ }
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
        fs.writeFileSync(tmp, key, { mode: 0o600 });
        fs.renameSync(tmp, file);
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch (_) { /* never written */ }
        throw err;
    }
}

function tightenKeyFile(file) {
    try {
        if ((fs.statSync(file).mode & 0o077) !== 0) fs.chmodSync(file, 0o600);
    } catch (_) { /* gone or not ours */ }
}

// An older active key of the same name and user agent (minted after a Cleanup / Reinstall lost the file) is an
// orphan: retire it, so CardSpace lists one "Fleet" and one "Fleet work items" key (same rule as #781).
async function retireSiblings(manager, keepId, label) {
    if (!keepId || typeof manager.listApplicationKeys !== 'function') return;
    try {
        const keys = await manager.listApplicationKeys({ includeExpired: true });
        for (const key of keys || []) {
            if (!key || key.id === keepId || key.appName !== label || key.userAgent !== FLEET_KEY_UA) continue;
            if (key.status === 'revoked' || key.status === 'replaced' || key.revokedAt) continue;
            await manager.revokeApplicationKey(key.id);
            console.log(`Fleet: retired orphan application key ${key.id} (${label})`);
        }
    } catch (err) {
        console.error(`Fleet key cleanup failed: ${err.message}`);
    }
}

// FLEET_MCP_SCOPES may grow: a stored key minted before a scope existed gets the missing names written onto
// the same row (the secret stays). A key someone widened to 'universal' is left alone.
async function healScopes(manager, keyId, scopes, userType) {
    if (!keyId || typeof manager.updateApplicationKey !== 'function') return;
    const wanted = require('./directorAppKeyScopes').FLEET_MCP_SCOPES;
    const current = Array.isArray(scopes) ? scopes : [];
    if (current.includes('universal')) return;
    const missing = wanted.filter((scope) => !current.includes(scope));
    if (!missing.length) return;
    try {
        const result = await manager.updateApplicationKey(keyId, { scopes: current.concat(missing) }, {
            source: 'fleet_ensure_key',
            actor: 'fleet',
            userType: userType || 'admin'
        });
        if (result && result.success === false) {
            console.error(`Fleet key scope update failed: ${result.error || result.code}`);
        }
    } catch (err) {
        console.error(`Fleet key scope update failed: ${err.message}`);
    }
}

async function mintOrReuse(gr, kind) {
    const manager = managerOf(gr);
    if (!manager) throw new Error('Fleet MCP key: the application key manager is not available');
    const label = FLEET_KEY_LABELS[kind];
    const file = keyFile(kind);
    const raw = readKeyFile(file);

    if (raw) {
        const validation = await manager.validateApplicationKey(raw, FLEET_KEY_UA, { skipUserAgent: true });
        // a file that holds some other key (Claude Code's, say) is not this one: mint
        if (validation.valid && validation.appName === label) {
            await healScopes(manager, validation.applicationKeyId, validation.scopes, validation.userType);
            await retireSiblings(manager, validation.applicationKeyId, label);
            tightenKeyFile(file);
            return { kind, label, keyFile: file };
        }
        if (!validation.valid && validation.code === 'REFRESH_REQUIRED') {
            const refreshed = await manager.refreshApplicationKey(raw, FLEET_KEY_UA);
            if (refreshed && refreshed.valid && refreshed.key && refreshed.summary && refreshed.summary.appName === label) {
                writeKeyFile(file, refreshed.key);
                await healScopes(manager, refreshed.summary.id, refreshed.summary.scopes, refreshed.summary.userType);
                await retireSiblings(manager, refreshed.summary.id, label);
                return { kind, label, keyFile: file };
            }
        }
    }

    const created = await manager.createApplicationKey({
        appName: label,
        userAgent: FLEET_KEY_UA,
        scopes: require('./directorAppKeyScopes').FLEET_MCP_SCOPES.slice(),
        userType: 'admin',
        expiresAt: null,
        refreshIntervalDays: 3650
    });
    const createdId = created.summary ? created.summary.id : created.id;
    try {
        writeKeyFile(file, created.key);
    } catch (err) {
        // no file, no way to use this key: do not leave it active
        try { await manager.revokeApplicationKey(createdId); } catch (_) { /* best effort */ }
        throw err;
    }
    await retireSiblings(manager, createdId, label);
    return { kind, label, keyFile: file };
}

/**
 * Makes sure the Fleet key of this kind exists, is valid, has the Fleet scopes and sits in its 0600 file.
 * Answers { kind, label, keyFile }; never the key itself. One run per kind at a time.
 */
async function ensureFleetKey(gr, kind) {
    const k = cleanKind(kind);
    let flight = flights.get(k);
    if (!flight) {
        flight = mintOrReuse(gr, k).finally(() => {
            if (flights.get(k) === flight) flights.delete(k);
        });
        flights.set(k, flight);
    }
    return flight;
}

/** Where a Fleet session's MCP client connects: this server's own loopback address, or '' when no MCP path uuid exists. */
function mcpUrl(gr) {
    try {
        const uuid = gr && typeof gr.getMcpPathUuid === 'function' ? gr.getMcpPathUuid() : '';
        if (!uuid) return '';
        const port = Number(gr.getConfig({ path: 'port' })) || 9220;
        return `http://127.0.0.1:${port}/${uuid}/mcp`;
    } catch (_) {
        return '';
    }
}

// ---------------------------------------------------------------- the label

const defaultLookups = {
    // the supervisor work item a session works: { id, title } or null
    workForSession(sessionId) {
        try {
            const db = require('./agentCoord/store').open();
            const row = db.prepare('SELECT id, title FROM supervisor_work WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(String(sessionId));
            return row ? { id: Number(row.id), title: String(row.title || '') } : null;
        } catch (_) {
            return null;
        }
    },
    // the agent-coord name of the session (its Fleet title) or ''
    agentName(sessionId) {
        try {
            const agent = require('./agentCoord/store').resolveAgent(`claude-${String(sessionId).slice(0, 8)}`);
            return agent && agent.name ? String(agent.name) : '';
        } catch (_) {
            return '';
        }
    }
};
let lookups = Object.assign({}, defaultLookups);
const infoCache = new Map(); // sessionId -> { at, work, agent }

/** Tests only: replace the two lookups (workForSession, agentName); no argument restores the real ones. */
function _setLookups(overrides) {
    lookups = Object.assign({}, defaultLookups, overrides || {});
    infoCache.clear();
}

/**
 * Item or plain Fleet session: a given workId, or a supervisor_work row naming this session, means 'item'.
 * Never throws.
 */
function sessionKind(sessionId, workId) {
    try {
        if (workId != null && String(workId).trim() !== '') return 'item';
        const id = String(sessionId || '').trim();
        if (id && lookups.workForSession(id)) return 'item';
    } catch (_) { /* fall through */ }
    return 'fleet';
}

/** { sessionId, kind } for a request on a Fleet key with a valid X-Fleet-Session header; else null. */
function fleetSessionOf(req) {
    const kind = kindOfLabel(rawAppName(req));
    if (!kind) return null;
    const header = req && req.headers ? req.headers[FLEET_SESSION_HEADER] : null;
    if (typeof header !== 'string') return null;
    const sessionId = header.trim();
    if (!SESSION_ID_RE.test(sessionId)) return null;
    return { sessionId, kind };
}

function cleanTitle(text) {
    return String(text == null ? '' : text)
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/["\u201c\u201d]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, TITLE_MAX)
        .trim();
}

function infoOf(sessionId, kind) {
    const now = Date.now();
    const hit = infoCache.get(sessionId);
    if (hit && now - hit.at < (kind === 'item' && !hit.work ? ITEM_MISS_TTL_MS : INFO_TTL_MS)) return hit;
    let work = null;
    let agent = '';
    try { work = lookups.workForSession(sessionId) || null; } catch (_) { work = null; }
    try { agent = lookups.agentName(sessionId) || ''; } catch (_) { agent = ''; }
    const info = { at: now, work, agent };
    if (infoCache.size >= INFO_CACHE_MAX) {
        for (const [key, row] of infoCache) {
            if (now - row.at >= INFO_TTL_MS) infoCache.delete(key);
        }
        if (infoCache.size >= INFO_CACHE_MAX) infoCache.delete(infoCache.keys().next().value);
    }
    infoCache.set(sessionId, info);
    return info;
}

/**
 * The name the Remote Access notice, the bind packet and the activity row show for this request.
 * A Fleet key: 'Fleet access "<title>"' or 'Fleet access, work item #<id> "<title>"'; without a valid
 * header: 'Fleet access' / 'Fleet access, work item'. Any other key: the raw app name (or null), exactly
 * what agentClientBridge.resolveActorName answers. Never throws.
 */
function actorLabel(req) {
    const raw = rawAppName(req);
    const kind = kindOfLabel(raw);
    if (!kind) return raw;
    const generic = kind === 'item' ? 'Fleet access, work item' : 'Fleet access';
    try {
        const session = fleetSessionOf(req);
        if (!session) return generic;
        const info = infoOf(session.sessionId, kind);
        const fallback = cleanTitle(info.agent) || session.sessionId.slice(0, 8);
        if (kind === 'item') {
            const itemTitle = info.work ? cleanTitle(info.work.title) : '';
            const title = itemTitle || fallback;
            const id = info.work && Number.isFinite(info.work.id) ? ` #${info.work.id}` : '';
            return `Fleet access, work item${id} "${title}"`;
        }
        return `Fleet access "${fallback}"`;
    } catch (_) {
        return generic;
    }
}

module.exports = {
    FLEET_SESSION_HEADER,
    FLEET_KEY_LABELS,
    FLEET_KEY_UA,
    get FLEET_MCP_SCOPES() { return require('./directorAppKeyScopes').FLEET_MCP_SCOPES; },
    keyFile,
    ensureFleetKey,
    mcpUrl,
    sessionKind,
    fleetSessionOf,
    actorLabel,
    isFleetLabel,
    _setLookups
};
