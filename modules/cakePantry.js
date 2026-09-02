'use strict';

/**
 * Cake Pantry Module
 * 
 * Account-based cake tracking for Menma, Hoshino, Ivory, and future accounts.
 * Does not smash Menma's existing .menma/cake-log.jsonl + state.json structure.
 * Extends to per-account ledgers.
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
 * Get or initialize account state
 */
function getAccountState(accountId) {
    const dir = getAccountDir(accountId);
    if (!dir) return null;
    const statePath = path.join(dir, 'state.json');
    const def = ACCOUNT_DEFS[accountId];
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
    if (!fs.existsSync(statePath)) {
        return defaultState;
    }
    const state = readJsonFile(statePath, defaultState);
    // Merge with defaults for any missing fields
    return { ...defaultState, ...state };
}

/**
 * Save account state
 */
function saveAccountState(accountId, state) {
    const dir = ensureAccountDir(accountId);
    if (!dir) return false;
    writeJsonFile(path.join(dir, 'state.json'), state);
    return true;
}

/**
 * Append to account's cake log
 */
function appendCakeLog(accountId, entry) {
    const dir = ensureAccountDir(accountId);
    if (!dir) return false;
    appendJsonlFile(path.join(dir, 'cake-log.jsonl'), entry);
    return true;
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
 * 
 * @param {string} accountId - Account to deliver to (menma, hoshino, ivory)
 * @param {object} params
 * @param {number} params.slices - Number of slices to deliver
 * @param {string} params.reason - Why (reward for which ship/work)
 * @param {string} [params.cake_type] - Type of cake
 * @param {string} [params.credit] - Credit attribution (grok.menma for 1.25x)
 * @param {object} [params.line_counts] - { added, deleted, bytes_removed } for cleanup calc
 * @returns {object} Delivery result
 */
function deliverCake(accountId, params) {
    const state = getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }

    const now = new Date().toISOString();
    let slices = Number(params.slices) || 0;
    
    // Apply cleanup calculation if line_counts provided
    if (params.line_counts && !params.slices) {
        slices = calculateCleanupSlices(
            params.line_counts.deleted || params.line_counts.lines_deleted,
            params.line_counts.bytes_removed
        );
    }
    
    // Apply multiplier
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

    saveAccountState(accountId, state);

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
 * Distinct from deliver - this is a gift, not a reward for work
 * 
 * @param {string} accountId
 * @param {object} params
 * @param {number} params.slices - Number of slices to feed
 * @param {string} [params.reason] - Why (promotion gift, just because, etc.)
 * @param {string} [params.cake_type]
 * @param {string} [params.from] - Who is feeding (default: Yukimi)
 */
function feedCake(accountId, params) {
    const state = getAccountState(accountId);
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

    saveAccountState(accountId, state);

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
 * Returns data, not a wall of text
 * 
 * @param {string} accountId
 * @param {object} [params]
 * @param {number} [params.log_limit] - How many log entries to return (default 20)
 */
function inspectPantry(accountId, params = {}) {
    const state = getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }

    const logLimit = Number(params.log_limit) || 20;
    const cakeLog = getCakeLog(accountId, logLimit);

    // Compute kg history from state.history
    const kgHistory = (state.history || []).map((h) => ({
        at: h.at,
        kg: h.kg,
        slices: h.slices,
        gained_kg: h.gained_kg
    }));

    // Past consumes from cake log
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
 * Returns usual response data plus before and after images and kg before/after
 * 
 * Visual QA invariants: empty plates, visible growth, hip contrast, up to 10 gens
 * 
 * @param {string} accountId
 * @param {object} params
 * @param {string} [params.cake_type] - Override cake type for this consume
 * @param {number} [params.stacks] - Number of cake stacks (default calculated from slices)
 * @param {string} [params.before_image] - Before image filename (if already generated)
 * @param {string} [params.after_image] - After image filename (if already generated)
 * @param {object} [params.qa] - Visual QA notes
 * @param {string} [params.chair] - Chair type (gaming, heavy_duty, etc.)
 * @param {boolean} [params.landscape] - Landscape mode
 * @param {string[]} [params.named_for] - What this consume is named for
 * @param {string[]} [params.commits] - Related commits
 * @param {string} [params.loop] - Loop name (7am-breakfast, etc.)
 */
function consumeCake(accountId, params = {}) {
    const state = getAccountState(accountId);
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

    // Calculate stacks (12 slices per cake)
    const stacks = params.stacks || Math.ceil(pendingSlices / 12);

    // Combine named_for from deliveries and feeds
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

    // Update state
    state.current_kg = kgAfter;
    state.slices_eaten_total = (state.slices_eaten_total || 0) + pendingSlices;
    state.pending_slices = 0;
    state.pending_deliveries = [];
    state.pending_feeds = [];
    state.last_before = params.before_image || state.last_before;
    state.last_after = params.after_image || state.last_after;
    state._cake_type = params.cake_type || state._cake_type;

    // Add to history
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

    // Save state and append to log
    saveAccountState(accountId, state);
    appendCakeLog(accountId, logEntry);

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
function listAccounts() {
    return Object.values(ACCOUNT_DEFS).map((def) => ({
        id: def.id,
        name: def.name,
        directory: def.directory,
        baseline_kg: def.baseline_kg,
        has_state: fs.existsSync(path.join(WORKSPACE_ROOT, def.directory, 'state.json'))
    }));
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
    getAccountDir,
    ensureAccountDir,
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
    getAccountDef
};
