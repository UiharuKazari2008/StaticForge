'use strict';

/**
 * Cake Pantry Module
 * 
 * Account-based cake tracking for Menma, Hoshino, Ivory, and future accounts.
 * 
 * MENMA uses SQLite (tag_wiki.db via menmaStatus.js) after migration.
 * Hoshino and Ivory stay on files (.hoshino/, .ivory/).
 * 
 * Cake math:
 * - 0.12kg per slice
 * - Cleanup: 1 slice per 40 lines or 10KB removed (min 1, cap 16)
 * - 1.25x multiplier for grok.menma (Jules/Cursor Lead)
 * 
 * Visual QA invariants:
 * - Empty plates
 * - Visible growth
 * - Hip contrast
 * - Up to 10 gens
 */

const fs = require('fs');
const path = require('path');
const {
    getMenmaDb,
    isMigrated,
    runMigrationIfNeeded,
    getMenmaStateFromDb,
    saveMenmaStateToDb,
    appendMenmaCakeLogToDb,
    getMenmaCakeLogFromDb,
    hasMenmaStateInDb
} = require('./menmaStatus');

const WORKSPACE_ROOT = path.join(__dirname, '..');
const KG_PER_SLICE = 0.12;
const CLEANUP_LINES_PER_SLICE = 40;
const CLEANUP_BYTES_PER_SLICE = 10240; // 10KB
const CLEANUP_SLICE_MIN = 1;
const CLEANUP_SLICE_CAP = 16;
const LEAD_MULTIPLIER = 1.25;
const MAX_VISUAL_QA_GENS = 10;

/**
 * Account definitions with identity fields
 * Menma's look is locked; Hoshino/Ivory start with their own identity fields
 */
const ACCOUNT_DEFS = {
    menma: {
        id: 'menma',
        name: 'Menma',
        directory: '.menma',
        identity: {
            name: 'Menma',
            age_band: 'late 20s adult',
            look: 'adult woman, late 20s, unkempt programmer girl, thick hips, messy long white hair, bangs falling in her face, round glasses, tired brown eyes, faint dark circles, wrinkled cream oversized hoodie, white socks, black and blue gaming chair, high-angle view of a cluttered lived-in night coding desk with four monitors showing code, warm lamp light, bookshelves, papers and empty mugs scattered',
            locked: true
        },
        baseline_kg: 54.0,
        useSqlite: true
    },
    hoshino: {
        id: 'hoshino',
        name: 'Hoshino',
        directory: '.hoshino',
        identity: {
            name: 'Hoshino',
            age_band: null,
            look: null,
            locked: false
        },
        baseline_kg: null,
        useSqlite: false
    },
    ivory: {
        id: 'ivory',
        name: 'Ivory',
        directory: '.ivory',
        identity: {
            name: 'Ivory',
            age_band: null,
            look: null,
            locked: false
        },
        baseline_kg: null,
        useSqlite: false
    }
};

let _globalResources = null;

/**
 * Set global resources for SQLite access (call at startup)
 */
function setGlobalResources(gr) {
    _globalResources = gr;
}

/**
 * Get global resources
 */
function getGlobalResources() {
    return _globalResources;
}

function getAccountDir(accountId) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return null;
    return path.join(WORKSPACE_ROOT, def.directory);
}

function ensureAccountDir(accountId) {
    const dir = getAccountDir(accountId);
    if (!dir) return null;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function readJsonFile(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function appendJsonlFile(filePath, entry) {
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

function readJsonlFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
        return lines.map((line) => {
            try { return JSON.parse(line); }
            catch (_) { return null; }
        }).filter(Boolean);
    } catch (_) {
        return [];
    }
}

/**
 * Check if menma should use SQLite (after migration)
 */
async function shouldUseMenmaSqlite() {
    if (!_globalResources) return false;
    const db = getMenmaDb(_globalResources);
    if (!db) return false;
    try {
        return await isMigrated(db);
    } catch (e) {
        return false;
    }
}

/**
 * Ensure migration is run if needed
 */
async function ensureMenmaMigration() {
    if (!_globalResources) return;
    const db = getMenmaDb(_globalResources);
    if (!db) return;
    try {
        await runMigrationIfNeeded(db);
    } catch (e) {
        console.error('[cakePantry] Migration error:', e);
    }
}

/**
 * Get or initialize account state
 * For menma: reads from SQLite after migration
 */
function getAccountState(accountId) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return null;
    
    const defaultState = {
        character: def.identity,
        baseline_kg: def.baseline_kg,
        current_kg: def.baseline_kg,
        slices_eaten_total: 0,
        pending_slices: 0,
        pending_deliveries: [],
        pending_feeds: [],
        history: [],
        cake_ratings: {},
        milestones: {},
        last_before: null,
        last_after: null
    };

    const dir = getAccountDir(accountId);
    if (!dir) return defaultState;
    
    const statePath = path.join(dir, 'state.json');
    if (!fs.existsSync(statePath)) {
        return defaultState;
    }
    const state = readJsonFile(statePath, defaultState);
    return { ...defaultState, ...state };
}

/**
 * Get account state (async version for menma SQLite)
 */
async function getAccountStateAsync(accountId) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return null;
    
    const defaultState = {
        character: def.identity,
        baseline_kg: def.baseline_kg,
        current_kg: def.baseline_kg,
        slices_eaten_total: 0,
        pending_slices: 0,
        pending_deliveries: [],
        pending_feeds: [],
        history: [],
        cake_ratings: {},
        milestones: {},
        last_before: null,
        last_after: null
    };

    if (accountId === 'menma' && def.useSqlite) {
        const db = getMenmaDb(_globalResources);
        if (db) {
            try {
                await ensureMenmaMigration();
                const state = await getMenmaStateFromDb(db);
                if (state && Object.keys(state).length > 0) {
                    return { ...defaultState, ...state };
                }
            } catch (e) {
                console.error('[cakePantry] getAccountStateAsync SQLite error:', e);
            }
        }
    }

    return getAccountState(accountId);
}

/**
 * Save account state
 * For menma: writes to SQLite after migration
 */
function saveAccountState(accountId, state) {
    const dir = ensureAccountDir(accountId);
    if (!dir) return false;
    writeJsonFile(path.join(dir, 'state.json'), state);
    return true;
}

/**
 * Save account state (async version for menma SQLite)
 */
async function saveAccountStateAsync(accountId, state) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return false;

    if (accountId === 'menma' && def.useSqlite) {
        const db = getMenmaDb(_globalResources);
        if (db) {
            try {
                await ensureMenmaMigration();
                await saveMenmaStateToDb(db, state);
                return true;
            } catch (e) {
                console.error('[cakePantry] saveAccountStateAsync SQLite error:', e);
            }
        }
    }

    return saveAccountState(accountId, state);
}

/**
 * Append to account's cake log
 * For menma: writes to SQLite after migration
 */
function appendCakeLog(accountId, entry) {
    const dir = ensureAccountDir(accountId);
    if (!dir) return false;
    appendJsonlFile(path.join(dir, 'cake-log.jsonl'), entry);
    return true;
}

/**
 * Append to cake log (async version for menma SQLite)
 */
async function appendCakeLogAsync(accountId, entry) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return false;

    if (accountId === 'menma' && def.useSqlite) {
        const db = getMenmaDb(_globalResources);
        if (db) {
            try {
                await ensureMenmaMigration();
                await appendMenmaCakeLogToDb(db, entry);
                return true;
            } catch (e) {
                console.error('[cakePantry] appendCakeLogAsync SQLite error:', e);
            }
        }
    }

    return appendCakeLog(accountId, entry);
}

/**
 * Get account's cake log
 */
function getCakeLog(accountId, limit = 50) {
    const dir = getAccountDir(accountId);
    if (!dir) return [];
    const logPath = path.join(dir, 'cake-log.jsonl');
    const entries = readJsonlFile(logPath);
    return limit > 0 ? entries.slice(-limit) : entries;
}

/**
 * Get cake log (async version for menma SQLite)
 */
async function getCakeLogAsync(accountId, limit = 50) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return [];

    if (accountId === 'menma' && def.useSqlite) {
        const db = getMenmaDb(_globalResources);
        if (db) {
            try {
                await ensureMenmaMigration();
                return await getMenmaCakeLogFromDb(db, limit);
            } catch (e) {
                console.error('[cakePantry] getCakeLogAsync SQLite error:', e);
            }
        }
    }

    return getCakeLog(accountId, limit);
}

/**
 * Calculate cleanup slices from line/byte stats
 * 1 slice per 40 lines or 10KB removed, min 1, cap 16
 */
function calculateCleanupSlices(linesDeleted, bytesRemoved) {
    const byLines = Math.floor((linesDeleted || 0) / CLEANUP_LINES_PER_SLICE);
    const byBytes = Math.floor((bytesRemoved || 0) / CLEANUP_BYTES_PER_SLICE);
    const raw = Math.max(byLines, byBytes);
    return Math.min(Math.max(raw, CLEANUP_SLICE_MIN), CLEANUP_SLICE_CAP);
}

/**
 * Apply multiplier for credit roles (1.25x for Lead/grok.menma)
 */
function applyMultiplier(slices, credit) {
    if (credit === 'grok.menma' || credit === 'Lead') {
        return Math.ceil(slices * LEAD_MULTIPLIER);
    }
    return slices;
}

/**
 * deliver_cake - Add slices to a pile with reason (reward for ship/work)
 */
async function deliverCake(accountId, params) {
    const state = await getAccountStateAsync(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }

    const now = new Date().toISOString();
    let slices = Number(params.slices) || 0;
    
    if (params.line_counts && !params.slices) {
        slices = calculateCleanupSlices(
            params.line_counts.deleted || params.line_counts.lines_deleted,
            params.line_counts.bytes_removed
        );
    }
    
    const credit = params.credit || null;
    const finalSlices = applyMultiplier(slices, credit);

    const delivery = {
        id: `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        at: now,
        slices: finalSlices,
        raw_slices: slices,
        reason: params.reason || 'unspecified',
        cake_type: params.cake_type || null,
        credit,
        multiplier: credit === 'grok.menma' || credit === 'Lead' ? LEAD_MULTIPLIER : 1,
        line_counts: params.line_counts || null,
        source: 'deliver'
    };

    state.pending_slices = (state.pending_slices || 0) + finalSlices;
    if (!Array.isArray(state.pending_deliveries)) {
        state.pending_deliveries = [];
    }
    state.pending_deliveries.push(delivery);

    await saveAccountStateAsync(accountId, state);

    return {
        success: true,
        accountId,
        delivery,
        pending_slices: state.pending_slices,
        pending_count: state.pending_deliveries.length
    };
}

/**
 * feed_cake - Yukimi grants slices (promotion or just because)
 */
async function feedCake(accountId, params) {
    const state = await getAccountStateAsync(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }

    const now = new Date().toISOString();
    const slices = Number(params.slices) || 0;

    const feed = {
        id: `feed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        at: now,
        slices,
        reason: params.reason || 'gift',
        cake_type: params.cake_type || null,
        from: params.from || 'Yukimi',
        source: 'feed'
    };

    state.pending_slices = (state.pending_slices || 0) + slices;
    if (!Array.isArray(state.pending_feeds)) {
        state.pending_feeds = [];
    }
    state.pending_feeds.push(feed);

    await saveAccountStateAsync(accountId, state);

    return {
        success: true,
        accountId,
        feed,
        pending_slices: state.pending_slices,
        pending_feeds_count: state.pending_feeds.length
    };
}

/**
 * inspect_pantry - View piles, past consumes, kg history
 */
async function inspectPantry(accountId, params = {}) {
    const state = await getAccountStateAsync(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }

    const logLimit = Number(params.log_limit) || 20;
    const cakeLog = await getCakeLogAsync(accountId, logLimit);

    const kgHistory = (state.history || []).map((h) => ({
        at: h.at,
        kg: h.kg,
        slices: h.slices,
        gained_kg: h.gained_kg
    }));

    const pastConsumes = cakeLog.filter((e) => e.meal || e.loop || e.slices > 0);

    return {
        success: true,
        accountId,
        account_name: state.character && state.character.name,
        current_kg: state.current_kg,
        baseline_kg: state.baseline_kg,
        gained_total_kg: state.current_kg != null && state.baseline_kg != null
            ? Number((state.current_kg - state.baseline_kg).toFixed(2))
            : null,
        slices_eaten_total: state.slices_eaten_total,
        pending: {
            slices: state.pending_slices || 0,
            deliveries: state.pending_deliveries || [],
            feeds: state.pending_feeds || []
        },
        cake_ratings: state.cake_ratings || {},
        milestones: state.milestones || {},
        kg_history: kgHistory.slice(-logLimit),
        past_consumes: pastConsumes,
        last_before: state.last_before,
        last_after: state.last_after
    };
}

/**
 * consume_cake - Eater eats pending slices
 */
async function consumeCake(accountId, params = {}) {
    const state = await getAccountStateAsync(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }

    const pendingSlices = state.pending_slices || 0;
    if (pendingSlices <= 0) {
        return {
            success: false,
            error: 'No pending slices to consume',
            accountId,
            pending_slices: 0
        };
    }

    const now = new Date().toISOString();
    const dateLocal = new Date().toISOString().split('T')[0];
    
    const kgBefore = state.current_kg || state.baseline_kg || 0;
    const gainedKg = Number((pendingSlices * KG_PER_SLICE).toFixed(2));
    const kgAfter = Number((kgBefore + gainedKg).toFixed(2));

    const stacks = params.stacks || Math.ceil(pendingSlices / 12);

    const namedFor = params.named_for || [];
    for (const d of (state.pending_deliveries || [])) {
        if (d.reason && !namedFor.includes(d.reason)) {
            namedFor.push(d.reason);
        }
    }
    for (const f of (state.pending_feeds || [])) {
        if (f.reason && !namedFor.includes(f.reason)) {
            namedFor.push(`[gift] ${f.reason}`);
        }
    }

    const logEntry = {
        at: now,
        loop: params.loop || null,
        date_local: dateLocal,
        slices: pendingSlices,
        stacks,
        cake_type: params.cake_type || state._cake_type || null,
        kg_before: kgBefore,
        kg_after: kgAfter,
        gained_kg: gainedKg,
        chair: params.chair || (state.milestones && state.milestones.chair) || null,
        landscape: params.landscape || false,
        named_for: namedFor.slice(0, 24),
        before: params.before_image || null,
        after: params.after_image || null,
        qa: params.qa || null,
        commits: params.commits || null,
        deliveries_consumed: (state.pending_deliveries || []).length,
        feeds_consumed: (state.pending_feeds || []).length
    };

    state.current_kg = kgAfter;
    state.slices_eaten_total = (state.slices_eaten_total || 0) + pendingSlices;
    state.pending_slices = 0;
    state.pending_deliveries = [];
    state.pending_feeds = [];
    state.last_before = params.before_image || state.last_before;
    state.last_after = params.after_image || state.last_after;
    state._cake_type = params.cake_type || state._cake_type;

    if (!Array.isArray(state.history)) {
        state.history = [];
    }
    state.history.push({
        at: now,
        slices: pendingSlices,
        stacks,
        gained_kg: gainedKg,
        kg: kgAfter,
        chair: logEntry.chair,
        landscape: logEntry.landscape,
        before: logEntry.before,
        after: logEntry.after
    });

    await saveAccountStateAsync(accountId, state);
    await appendCakeLogAsync(accountId, logEntry);

    return {
        success: true,
        accountId,
        account_name: state.character && state.character.name,
        slices_consumed: pendingSlices,
        stacks,
        cake_type: logEntry.cake_type,
        kg_before: kgBefore,
        kg_after: kgAfter,
        gained_kg: gainedKg,
        before_image: logEntry.before,
        after_image: logEntry.after,
        named_for: namedFor,
        slices_eaten_total: state.slices_eaten_total,
        visual_qa: {
            max_gens: MAX_VISUAL_QA_GENS,
            invariants: ['empty_plates', 'visible_growth', 'hip_contrast'],
            kg_per_slice: KG_PER_SLICE
        },
        log_entry: logEntry
    };
}

/**
 * List available accounts
 */
async function listAccounts() {
    const accounts = [];
    for (const def of Object.values(ACCOUNT_DEFS)) {
        let hasState = false;
        
        if (def.id === 'menma' && def.useSqlite) {
            const db = getMenmaDb(_globalResources);
            if (db) {
                try {
                    hasState = await hasMenmaStateInDb(db);
                } catch (e) {
                    hasState = fs.existsSync(path.join(WORKSPACE_ROOT, def.directory, 'state.json'));
                }
            } else {
                hasState = fs.existsSync(path.join(WORKSPACE_ROOT, def.directory, 'state.json'));
            }
        } else {
            hasState = fs.existsSync(path.join(WORKSPACE_ROOT, def.directory, 'state.json'));
        }

        accounts.push({
            id: def.id,
            name: def.name,
            directory: def.directory,
            baseline_kg: def.baseline_kg,
            has_state: hasState
        });
    }
    return accounts;
}

/**
 * Get account definition
 */
function getAccountDef(accountId) {
    return ACCOUNT_DEFS[accountId] || null;
}

module.exports = {
    ACCOUNT_DEFS,
    KG_PER_SLICE,
    CLEANUP_LINES_PER_SLICE,
    CLEANUP_BYTES_PER_SLICE,
    CLEANUP_SLICE_MIN,
    CLEANUP_SLICE_CAP,
    LEAD_MULTIPLIER,
    MAX_VISUAL_QA_GENS,
    setGlobalResources,
    getGlobalResources,
    getAccountDir,
    ensureAccountDir,
    getAccountState,
    getAccountStateAsync,
    saveAccountState,
    saveAccountStateAsync,
    appendCakeLog,
    appendCakeLogAsync,
    getCakeLog,
    getCakeLogAsync,
    calculateCleanupSlices,
    applyMultiplier,
    deliverCake,
    feedCake,
    inspectPantry,
    consumeCake,
    listAccounts,
    getAccountDef
};
