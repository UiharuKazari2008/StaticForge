'use strict';

/**
 * Cake Pantry Module
 * 
 * Account-based cake tracking for Menma, Hoshino, Ivory, and future accounts.
 * 
 * MENMA uses SQLite (tag_wiki.db via menmaStatus.js) after migration.
 * After import (menma_meta.imported_at set), ALL menma reads/writes go to SQLite.
 * NO file fallback after import - DB failure must not write to .menma/ files.
 * 
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
    hasMenmaStateInDb,
    getWorkPileFromDb,
    saveWorkPileToDb,
    addWorkItemToDb,
    completeWorkItemInDb,
    removeWorkItemFromDb
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
        baseline_kg: 54.0
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
        baseline_kg: null
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
        baseline_kg: null
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
 * Check if menma should use SQLite (after migration).
 * Gates on menma_meta.imported_at, not compile-time flag.
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
    if (!_globalResources) return false;
    const db = getMenmaDb(_globalResources);
    if (!db) return false;
    try {
        await runMigrationIfNeeded(db);
        return true;
    } catch (e) {
        console.error('[cakePantry] Migration error:', e);
        return false;
    }
}

/**
 * Get default state for an account
 */
function getDefaultState(accountId) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return null;
    return {
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
}

/**
 * Get or initialize account state (file-based, for non-menma accounts)
 */
function getAccountStateFromFile(accountId) {
    const defaultState = getDefaultState(accountId);
    if (!defaultState) return null;
    
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
 * Get account state - async, uses SQLite for menma after import
 * NO file fallback for menma after import.
 */
async function getAccountState(accountId) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return null;
    
    const defaultState = getDefaultState(accountId);

    if (accountId === 'menma') {
        const useSqlite = await shouldUseMenmaSqlite();
        if (useSqlite) {
            const db = getMenmaDb(_globalResources);
            if (!db) {
                return { ...defaultState, _sqliteUnavailable: true };
            }
            try {
                const state = await getMenmaStateFromDb(db);
                if (state && Object.keys(state).length > 0) {
                    return { ...defaultState, ...state };
                }
                return defaultState;
            } catch (e) {
                console.error('[cakePantry] getAccountState SQLite error:', e);
                return { ...defaultState, _sqliteError: e.message };
            }
        }
        // Before import, use files
        return getAccountStateFromFile(accountId);
    }

    // Hoshino/Ivory use files
    return getAccountStateFromFile(accountId);
}

/**
 * Save account state - async, uses SQLite for menma after import
 * NO file fallback for menma after import.
 */
async function saveAccountState(accountId, state) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return false;

    if (accountId === 'menma') {
        const useSqlite = await shouldUseMenmaSqlite();
        if (useSqlite) {
            const db = getMenmaDb(_globalResources);
            if (!db) {
                console.error('[cakePantry] saveAccountState: SQLite unavailable after import');
                return false;
            }
            try {
                await saveMenmaStateToDb(db, state);
                return true;
            } catch (e) {
                console.error('[cakePantry] saveAccountState SQLite error:', e);
                return false;
            }
        }
        // Before import, use files
        const dir = ensureAccountDir(accountId);
        if (!dir) return false;
        writeJsonFile(path.join(dir, 'state.json'), state);
        return true;
    }

    // Hoshino/Ivory use files
    const dir = ensureAccountDir(accountId);
    if (!dir) return false;
    writeJsonFile(path.join(dir, 'state.json'), state);
    return true;
}

/**
 * Append to account's cake log - async, uses SQLite for menma after import
 * NO file fallback for menma after import.
 */
async function appendCakeLog(accountId, entry) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return false;

    if (accountId === 'menma') {
        const useSqlite = await shouldUseMenmaSqlite();
        if (useSqlite) {
            const db = getMenmaDb(_globalResources);
            if (!db) {
                console.error('[cakePantry] appendCakeLog: SQLite unavailable after import');
                return false;
            }
            try {
                await appendMenmaCakeLogToDb(db, entry);
                return true;
            } catch (e) {
                console.error('[cakePantry] appendCakeLog SQLite error:', e);
                return false;
            }
        }
        // Before import, use files
        const dir = ensureAccountDir(accountId);
        if (!dir) return false;
        appendJsonlFile(path.join(dir, 'cake-log.jsonl'), entry);
        return true;
    }

    // Hoshino/Ivory use files
    const dir = ensureAccountDir(accountId);
    if (!dir) return false;
    appendJsonlFile(path.join(dir, 'cake-log.jsonl'), entry);
    return true;
}

/**
 * Get account's cake log - async, uses SQLite for menma after import
 */
async function getCakeLog(accountId, limit = 50) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return [];

    if (accountId === 'menma') {
        const useSqlite = await shouldUseMenmaSqlite();
        if (useSqlite) {
            const db = getMenmaDb(_globalResources);
            if (!db) return [];
            try {
                return await getMenmaCakeLogFromDb(db, limit);
            } catch (e) {
                console.error('[cakePantry] getCakeLog SQLite error:', e);
                return [];
            }
        }
        // Before import, use files
        const dir = getAccountDir(accountId);
        if (!dir) return [];
        const logPath = path.join(dir, 'cake-log.jsonl');
        const entries = readJsonlFile(logPath);
        return limit > 0 ? entries.slice(-limit) : entries;
    }

    // Hoshino/Ivory use files
    const dir = getAccountDir(accountId);
    if (!dir) return [];
    const logPath = path.join(dir, 'cake-log.jsonl');
    const entries = readJsonlFile(logPath);
    return limit > 0 ? entries.slice(-limit) : entries;
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
    const state = await getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }
    if (state._sqliteUnavailable || state._sqliteError) {
        return { success: false, error: 'SQLite unavailable', accountId };
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

    const saved = await saveAccountState(accountId, state);
    if (!saved) {
        return { success: false, error: 'Failed to save state', accountId };
    }

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
    const state = await getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }
    if (state._sqliteUnavailable || state._sqliteError) {
        return { success: false, error: 'SQLite unavailable', accountId };
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

    const saved = await saveAccountState(accountId, state);
    if (!saved) {
        return { success: false, error: 'Failed to save state', accountId };
    }

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
    const state = await getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }

    const logLimit = Number(params.log_limit) || 20;
    const cakeLog = await getCakeLog(accountId, logLimit);

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
    const state = await getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }
    if (state._sqliteUnavailable || state._sqliteError) {
        return { success: false, error: 'SQLite unavailable', accountId };
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

    const saved = await saveAccountState(accountId, state);
    if (!saved) {
        return { success: false, error: 'Failed to save state', accountId };
    }
    
    const logged = await appendCakeLog(accountId, logEntry);
    if (!logged) {
        console.error('[cakePantry] consumeCake: failed to append cake log');
    }

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
        
        if (def.id === 'menma') {
            const useSqlite = await shouldUseMenmaSqlite();
            if (useSqlite) {
                const db = getMenmaDb(_globalResources);
                if (db) {
                    try {
                        hasState = await hasMenmaStateInDb(db);
                    } catch (e) {
                        hasState = false;
                    }
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

// ============================================================================
// Work Pile Functions (menma only, SQLite after import)
// ============================================================================

/**
 * Get menma work pile
 */
async function getMenmaWorkPile() {
    const useSqlite = await shouldUseMenmaSqlite();
    if (useSqlite) {
        const db = getMenmaDb(_globalResources);
        if (!db) return null;
        try {
            return await getWorkPileFromDb(db);
        } catch (e) {
            console.error('[cakePantry] getMenmaWorkPile SQLite error:', e);
            return null;
        }
    }
    // Before import, read from file
    const pilePath = path.join(WORKSPACE_ROOT, '.menma', 'work-pile.json');
    return readJsonFile(pilePath, { open: [], done_since_breakfast: [], eaten: [] });
}

/**
 * Save menma work pile
 */
async function saveMenmaWorkPile(pile) {
    const useSqlite = await shouldUseMenmaSqlite();
    if (useSqlite) {
        const db = getMenmaDb(_globalResources);
        if (!db) {
            console.error('[cakePantry] saveMenmaWorkPile: SQLite unavailable after import');
            return false;
        }
        try {
            await saveWorkPileToDb(db, pile);
            return true;
        } catch (e) {
            console.error('[cakePantry] saveMenmaWorkPile SQLite error:', e);
            return false;
        }
    }
    // Before import, write to file
    const dir = ensureAccountDir('menma');
    if (!dir) return false;
    writeJsonFile(path.join(dir, 'work-pile.json'), pile);
    return true;
}

/**
 * Add work item to menma pile
 */
async function addMenmaWorkItem(item, type = 'open') {
    const useSqlite = await shouldUseMenmaSqlite();
    if (useSqlite) {
        const db = getMenmaDb(_globalResources);
        if (!db) {
            console.error('[cakePantry] addMenmaWorkItem: SQLite unavailable after import');
            return false;
        }
        try {
            await addWorkItemToDb(db, item, type);
            return true;
        } catch (e) {
            console.error('[cakePantry] addMenmaWorkItem SQLite error:', e);
            return false;
        }
    }
    // Before import, read/modify/write file
    const pile = await getMenmaWorkPile() || { open: [], done_since_breakfast: [], eaten: [] };
    if (!Array.isArray(pile[type])) {
        pile[type] = [];
    }
    pile[type].push({ ...item, added: item.added || new Date().toISOString() });
    pile.updated_at = new Date().toISOString();
    return await saveMenmaWorkPile(pile);
}

/**
 * Complete work item (move from open to done_since_breakfast)
 */
async function completeMenmaWorkItem(workId) {
    const useSqlite = await shouldUseMenmaSqlite();
    if (useSqlite) {
        const db = getMenmaDb(_globalResources);
        if (!db) {
            console.error('[cakePantry] completeMenmaWorkItem: SQLite unavailable after import');
            return false;
        }
        try {
            return await completeWorkItemInDb(db, workId);
        } catch (e) {
            console.error('[cakePantry] completeMenmaWorkItem SQLite error:', e);
            return false;
        }
    }
    // Before import, read/modify/write file
    const pile = await getMenmaWorkPile();
    if (!pile) return false;
    const idx = (pile.open || []).findIndex(i => i.id === workId);
    if (idx === -1) return false;
    const item = pile.open.splice(idx, 1)[0];
    item.done = new Date().toISOString();
    if (!Array.isArray(pile.done_since_breakfast)) {
        pile.done_since_breakfast = [];
    }
    pile.done_since_breakfast.push(item);
    pile.updated_at = new Date().toISOString();
    return await saveMenmaWorkPile(pile);
}

/**
 * Remove work item from pile
 */
async function removeMenmaWorkItem(workId) {
    const useSqlite = await shouldUseMenmaSqlite();
    if (useSqlite) {
        const db = getMenmaDb(_globalResources);
        if (!db) {
            console.error('[cakePantry] removeMenmaWorkItem: SQLite unavailable after import');
            return false;
        }
        try {
            return await removeWorkItemFromDb(db, workId);
        } catch (e) {
            console.error('[cakePantry] removeMenmaWorkItem SQLite error:', e);
            return false;
        }
    }
    // Before import, read/modify/write file
    const pile = await getMenmaWorkPile();
    if (!pile) return false;
    let removed = false;
    for (const type of ['open', 'done_since_breakfast', 'eaten']) {
        if (!Array.isArray(pile[type])) continue;
        const idx = pile[type].findIndex(i => i.id === workId);
        if (idx !== -1) {
            pile[type].splice(idx, 1);
            removed = true;
            break;
        }
    }
    if (removed) {
        pile.updated_at = new Date().toISOString();
        return await saveMenmaWorkPile(pile);
    }
    return false;
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
    shouldUseMenmaSqlite,
    ensureMenmaMigration,
    getAccountState,
    saveAccountState,
    appendCakeLog,
    getCakeLog,
    calculateCleanupSlices,
    applyMultiplier,
    deliverCake,
    feedCake,
    inspectPantry,
    consumeCake,
    listAccounts,
    getAccountDef,
    getMenmaWorkPile,
    saveMenmaWorkPile,
    addMenmaWorkItem,
    completeMenmaWorkItem,
    removeMenmaWorkItem
};
