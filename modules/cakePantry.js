'use strict';

/**
 * Cake Pantry Module
 * 
 * Account-based cake tracking for menma, hoshino, ivory, pyra, chiyo, guren, rook, sala.
 * 
 * ALL accounts use SQLite (tag_wiki.db via menmaStatus.js) after import.
 * After import (cake_pantry_meta.imported_at set per account), ALL reads/writes go to SQLite.
 * 
 * FAIL-CLOSED: After import, if SQLite is unavailable, do NOT write to account files.
 * If import status cannot be confirmed, skip the file path (return error / no-op).
 * 
 * Cake math:
 * - 0.12kg per slice
 * - Cleanup: 1 slice per 40 lines or 10KB removed (min 1, cap 16)
 * - 4x multiplier for grok.menma (Jules/Cursor Lead); Yukimi 2026-10-05 (was 1.25x)
 * - Menma current_kg never decreases (monotonic clamp on every state save)
 * - Soft sitting cap default 8; override via slices/max_slices up to all eligible; remainder carries
 * - Optional delivery_ids on consume eats those deliveries instead of the whole FIFO
 * - FIFO de-dup: the same ship reason/key is eaten once; a later copy stays pending
 * - void_cake_delivery marks one pending delivery do_not_eat (kg unchanged, audit row)
 * - Skip dry-verify forever via cake_type=dry-verify and/or do_not_eat flag
 *   (not reason substring; legacy reason must *start with* marker)
 * 
 * Visual QA invariants (caller-supplied image refs; no auto-gen):
 * - Empty plates
 * - Visible growth
 * - Hip contrast
 * - Up to 10 gens
 */

const fs = require('fs');
const path = require('path');
const {
    ACCOUNT_DIRS,
    getCakePantryDb,
    isAccountImported,
    ensureAccountMigration,
    getAccountStateFromDb,
    saveAccountStateToDb,
    appendCakeLogToDb,
    getCakeLogFromDb,
    findCakeLogRowByMealId,
    updateCakeLogImagesToDb,
    composeCakeLogEntry,
    latestMealImagesFromLog,
    getLatestMealImagesFromDb,
    clampMonotonicKg,
    isMonotonicKgAccount,
    hasAccountStateInDb,
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
/** grok.menma / Lead credit multiplier. Yukimi 2026-10-05 7:28pm ET: 1.25 → 4. */
const LEAD_MULTIPLIER = 4;
const MAX_VISUAL_QA_GENS = 10;
/** Soft default sitting cap (8). Override via slices and/or max_slices up to all eligible pending. */
const MAX_SLICES_PER_SITTING = 8;

/**
 * Normalize cake_type for comparisons (trim, lower, spaces → hyphens).
 */
function normalizeCakeType(cakeType) {
    if (cakeType == null || cakeType === '') return null;
    return String(cakeType).trim().toLowerCase().replace(/\s+/g, '-');
}

function isDryVerifyCakeType(cakeType) {
    return normalizeCakeType(cakeType) === 'dry-verify';
}

function truthyDoNotEatFlag(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes';
    }
    return false;
}

/**
 * Legacy reason-only dry verifies (pre-#154).
 * Match only when the reason *starts with* a dry-verify / do-not-eat marker
 * after trim — never a mid-string ship note like "skip do-not-eat".
 * Prefer cake_type=dry-verify or do_not_eat on new deliveries (Yozora #154).
 */
function legacyReasonIsDoNotEat(reason) {
    if (reason == null) return false;
    const r = String(reason).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!r) return false;
    const exact = new Set([
        'do not eat',
        'do-not-eat',
        'dry verify',
        'dry-verify',
        'dry-verify do not eat',
        'dry verify do not eat'
    ]);
    if (exact.has(r)) return true;
    return /^(dry[ -]?verify|do[ -]?not[ -]?eat)\b/.test(r);
}

/**
 * @deprecated Use isDoNotEatItem. Kept for tests/callers; now prefix-only (not substring).
 */
function isDoNotEatReason(reason) {
    return legacyReasonIsDoNotEat(reason);
}

/**
 * Forever-skip when cake_type is dry-verify, do_not_eat is set, or legacy
 * reason *starts with* a dry-verify / do-not-eat marker (Yozora #154).
 */
function isDoNotEatItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (truthyDoNotEatFlag(item.do_not_eat)) return true;
    if (isDryVerifyCakeType(item.cake_type)) return true;
    return legacyReasonIsDoNotEat(item.reason);
}

/**
 * Resolve cake_type + do_not_eat for deliver/feed.
 * dry-verify cake_type or explicit do_not_eat ⇒ both stamped.
 */
function resolveDoNotEatFields(params = {}) {
    const fromType = isDryVerifyCakeType(params.cake_type);
    const fromFlag = truthyDoNotEatFlag(params.do_not_eat);
    const doNotEat = fromType || fromFlag;
    let cakeType =
        params.cake_type != null && String(params.cake_type).trim() !== ''
            ? params.cake_type
            : null;
    if (doNotEat && !cakeType) {
        cakeType = 'dry-verify';
    }
    return { cake_type: cakeType, do_not_eat: doNotEat };
}

/**
 * Careful migration: stamp flag + cake_type onto legacy reason-only skips
 * so later consumes do not depend on reason text.
 */
function stampDoNotEatMigration(item) {
    if (!item || typeof item !== 'object') return item;
    if (!isDoNotEatItem(item)) return item;
    const next = { ...item, do_not_eat: true };
    if (!next.cake_type) {
        next.cake_type = 'dry-verify';
    }
    return next;
}

/**
 * FIFO take up to `budget` slices from items; may split the last item.
 * Returns { taken, remaining, slicesTaken }.
 */
function takeSlicesFromItems(items, budget) {
    const taken = [];
    const remaining = [];
    let left = budget;
    for (const item of items || []) {
        const slices = Number(item.slices) || 0;
        if (left <= 0) {
            remaining.push(item);
            continue;
        }
        if (slices <= left) {
            taken.push({ ...item });
            left -= slices;
        } else {
            taken.push({ ...item, slices: left, _partial: true, _original_slices: slices });
            remaining.push({ ...item, slices: slices - left });
            left = 0;
        }
    }
    const slicesTaken = taken.reduce((s, i) => s + (Number(i.slices) || 0), 0);
    return { taken, remaining, slicesTaken };
}

function sumItemSlices(items) {
    return (items || []).reduce((s, i) => s + (Number(i.slices) || 0), 0);
}

/** Placeholder reasons are not a ship identity. Two "unspecified" banks may both be eaten. */
const DEDUP_PLACEHOLDER_REASONS = new Set(['unspecified', 'gift']);

/**
 * Ship bank identity from a delivery reason. Same rules as sync_ship_cake:
 * Yozora PR number only when the reason starts with ship:<num>, except GH-labelled
 * mirrors (those dedup by sha only); sha from ship:<token>:<hex> (full and 7-char).
 */
function parseShipBankReason(reasonStr) {
    if (reasonStr == null || reasonStr === '') {
        return { reason: null, pr: null, shas: [] };
    }
    const reason = String(reasonStr);
    let pr = null;
    const numMatch = reason.match(/^ship:(\d+)(?=[:\s]|$)/);
    if (numMatch) {
        const num = parseInt(numMatch[1], 10);
        const ghLabel = new RegExp(`\\bGH\\s*#${num}(?!\\d)`, 'i');
        if (!ghLabel.test(reason)) pr = num;
    }
    const shas = [];
    const shaMatch = reason.match(/^ship:([^:]+):([a-f0-9]+)/);
    if (shaMatch) {
        const sha = shaMatch[2];
        shas.push(sha);
        if (sha.length >= 7) shas.push(sha.substring(0, 7));
    }
    return { reason, pr, shas };
}

/**
 * Tokens that mean "this ship was already banked".
 * Exact reason (case-insensitive) plus PR number and sha, so a duplicate
 * delivery of the same ship is not eaten twice (Rook #388).
 */
function shipDedupTokens(reasonStr) {
    const parsed = parseShipBankReason(reasonStr);
    if (!parsed.reason) return [];
    const trimmed = parsed.reason.trim();
    const tokens = [];
    const lower = trimmed.toLowerCase();
    if (trimmed && !DEDUP_PLACEHOLDER_REASONS.has(lower)) {
        tokens.push(`reason:${lower}`);
    }
    if (parsed.pr != null) tokens.push(`pr:${parsed.pr}`);
    for (const sha of parsed.shas) tokens.push(`sha:${sha}`);
    return tokens;
}

function collectEatenShipTokens(cakeLog) {
    const seen = new Set();
    const add = (reason) => {
        for (const token of shipDedupTokens(reason)) seen.add(token);
    };
    for (const entry of cakeLog || []) {
        if (!entry || typeof entry !== 'object') continue;
        add(entry.reason);
        if (Array.isArray(entry.named_for)) {
            for (const name of entry.named_for) add(name);
        }
    }
    return seen;
}

/**
 * FIFO: the first delivery with a reason/key is eatable; a later delivery
 * that shares that reason, PR number, or sha is a duplicate and is not eaten.
 * `eatenTokens` seeds the set from meals that already consumed the ship.
 */
function partitionFifoDuplicateDeliveries(deliveries, eatenTokens) {
    const seen = new Set(eatenTokens || []);
    const fresh = [];
    const duplicates = [];
    for (const item of deliveries || []) {
        const tokens = shipDedupTokens(item && item.reason);
        if (tokens.length > 0 && tokens.some((token) => seen.has(token))) {
            duplicates.push(item);
            continue;
        }
        fresh.push(item);
        for (const token of tokens) seen.add(token);
    }
    return { fresh, duplicates };
}

/**
 * Rebuild a pending list after a take.
 * Fully eaten ids drop out. Partials and stamped do-not-eat rows replace
 * their originals. Everything else (unselected delivery_ids, FIFO duplicates)
 * stays in place.
 */
function pendingAfterTake(original, taken, remaining, skipped) {
    const takenFully = new Set();
    for (const item of taken || []) {
        if (item && item.id != null && !item._partial) takenFully.add(String(item.id));
    }
    const remainById = new Map();
    for (const item of remaining || []) {
        if (item && item.id != null) remainById.set(String(item.id), item);
    }
    const skippedById = new Map();
    for (const item of skipped || []) {
        if (item && item.id != null) skippedById.set(String(item.id), item);
    }
    const out = [];
    for (const item of original || []) {
        const id = item && item.id != null ? String(item.id) : null;
        if (id && takenFully.has(id)) continue;
        if (id && remainById.has(id)) {
            out.push(remainById.get(id));
            continue;
        }
        if (id && skippedById.has(id)) {
            out.push(skippedById.get(id));
            continue;
        }
        out.push(item);
    }
    return out;
}

function eligiblePendingSliceCount(deliveries, feeds) {
    return sumItemSlices((deliveries || []).filter((item) => !isDoNotEatItem(item)))
        + sumItemSlices((feeds || []).filter((item) => !isDoNotEatItem(item)));
}

function normalizeDeliveryIdList(raw) {
    if (raw == null || raw === '') return { ids: null };
    const list = typeof raw === 'string' ? [raw] : raw;
    if (!Array.isArray(list)) {
        return { error: 'delivery_ids must be an array of delivery ids' };
    }
    const ids = [];
    for (const item of list) {
        const id = item == null ? '' : String(item).trim();
        if (!id) return { error: 'delivery_ids contains an empty id' };
        ids.push(id);
    }
    if (!ids.length) return { error: 'delivery_ids must list at least one delivery id' };
    return { ids };
}

/**
 * Choose what this consume may eat.
 * delivery_ids, when set, replaces FIFO: only those pending deliveries
 * (unknown / already void ids error; feeds are not pulled in).
 * Duplicates of a ship reason/key already eaten, or earlier in this FIFO, are held back.
 */
function selectConsumeItems(pendingDeliveries, pendingFeeds, params, eatenTokens) {
    const idFilter = normalizeDeliveryIdList(params && params.delivery_ids);
    if (idFilter.error) return { ok: false, error: idFilter.error };

    const skippedDeliveries = (pendingDeliveries || [])
        .filter((d) => isDoNotEatItem(d))
        .map(stampDoNotEatMigration);
    const eligibleDeliveries = (pendingDeliveries || []).filter((d) => !isDoNotEatItem(d));
    const skippedFeeds = (pendingFeeds || [])
        .filter((f) => isDoNotEatItem(f))
        .map(stampDoNotEatMigration);
    let eligibleFeeds = (pendingFeeds || []).filter((f) => !isDoNotEatItem(f));

    let pool = eligibleDeliveries;
    if (idFilter.ids) {
        const eligibleById = new Map();
        for (const delivery of eligibleDeliveries) {
            if (delivery && delivery.id != null) eligibleById.set(String(delivery.id), delivery);
        }
        const anyById = new Map();
        for (const delivery of pendingDeliveries || []) {
            if (delivery && delivery.id != null) anyById.set(String(delivery.id), delivery);
        }
        for (const id of idFilter.ids) {
            if (!anyById.has(id) || !eligibleById.has(id)) {
                return { ok: false, error: `Unknown or non-pending delivery_id: ${id}` };
            }
        }
        const wanted = new Set(idFilter.ids);
        pool = eligibleDeliveries.filter((d) => d && d.id != null && wanted.has(String(d.id)));
        eligibleFeeds = [];
    }

    const { fresh, duplicates } = partitionFifoDuplicateDeliveries(pool, eatenTokens);
    return {
        ok: true,
        filtered: Boolean(idFilter.ids),
        skippedDeliveries,
        skippedFeeds,
        eligibleDeliveries: fresh,
        eligibleFeeds,
        duplicateDeliveries: duplicates
    };
}

/**
 * Soft sitting-cap budget for one consume_cake call (Yozora #152).
 * Default ceiling = MAX_SLICES_PER_SITTING (8). Either `slices` and/or `max_slices`
 * may raise (or lower) the ceiling up to all eligible pending — never past eligible,
 * and never into dry-verify / do_not_eat (those are filtered before this runs).
 *
 * Semantics:
 * - neither arg → budget = min(8, eligible)
 * - max_slices alone → budget = min(max_slices, eligible)  (may exceed 8)
 * - slices alone → budget = min(slices, softCeiling, eligible);
 *     softCeiling is 8 unless slices > 8, in which case softCeiling = slices (capped to eligible)
 * - both → ceiling = min(max_slices, eligible); budget = min(slices, ceiling, eligible)
 *
 * Returns { ok, budget, requested, ceiling, default_cap, override, error? }.
 */
function resolveSittingBudget(eligibleSlices, params = {}) {
    const defaultCap = MAX_SLICES_PER_SITTING;
    const eligible = Math.max(0, Number(eligibleSlices) || 0);

    const hasSlices = params.slices != null && params.slices !== '';
    const hasMax = params.max_slices != null && params.max_slices !== '';

    let slicesN = null;
    let maxN = null;

    if (hasSlices) {
        slicesN = Number(params.slices);
        if (!Number.isFinite(slicesN) || slicesN < 1) {
            return {
                ok: false,
                error: 'slices must be a number >= 1 (default soft cap 8; override up to all eligible pending)',
                ceiling: Math.min(defaultCap, eligible),
                requested: null,
                budget: 0,
                default_cap: defaultCap,
                override: true
            };
        }
        slicesN = Math.floor(slicesN);
    }
    if (hasMax) {
        maxN = Number(params.max_slices);
        if (!Number.isFinite(maxN) || maxN < 1) {
            return {
                ok: false,
                error: 'max_slices must be a number >= 1 (raises/lowers sitting ceiling; default 8; up to all eligible)',
                ceiling: Math.min(defaultCap, eligible),
                requested: null,
                budget: 0,
                default_cap: defaultCap,
                override: true
            };
        }
        maxN = Math.floor(maxN);
    }

    let ceiling;
    if (hasMax) {
        ceiling = Math.min(maxN, eligible);
    } else if (hasSlices && slicesN > defaultCap) {
        ceiling = Math.min(slicesN, eligible);
    } else {
        ceiling = Math.min(defaultCap, eligible);
    }

    let requested = null;
    if (hasSlices) {
        requested = slicesN;
    } else if (hasMax) {
        requested = maxN;
    }

    const budget = Math.min(
        eligible,
        ceiling,
        requested != null ? requested : ceiling
    );

    return {
        ok: true,
        budget: Math.max(0, budget),
        requested,
        ceiling,
        default_cap: defaultCap,
        override: hasSlices || hasMax
    };
}
/**
 * Account definitions with identity fields
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
        baseline_kg: 54.0 // visual-feast lock
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
        baseline_kg: 54.0 // visual-feast lock
    },
    pyra: {
        id: 'pyra',
        name: 'Pyra',
        directory: '.pyra',
        identity: {
            name: 'Pyra',
            age_band: null,
            look: null,
            locked: false
        },
        baseline_kg: 54.0 // visual-feast lock
    },
    chiyo: {
        id: 'chiyo',
        name: 'Chiyo',
        directory: '.chiyo',
        identity: {
            name: 'Chiyo',
            age_band: null,
            look: null,
            locked: false
        },
        baseline_kg: 54.0 // visual-feast lock
    },
    guren: {
        id: 'guren',
        name: 'Guren',
        directory: '.guren',
        identity: {
            name: 'Guren',
            age_band: 'adult',
            look: null,
            locked: false
        },
        baseline_kg: 54.0
    },
    rook: {
        id: 'rook',
        name: 'Rook',
        directory: '.rook',
        identity: {
            name: 'Rook',
            age_band: null,
            look: null,
            locked: false
        },
        baseline_kg: 54.0 // same base as the others; state is created lazily on first use
    },
    sala: {
        id: 'sala',
        name: 'Sala',
        directory: '.sala',
        identity: {
            name: 'Sala',
            age_band: null,
            look: null,
            locked: false
        },
        baseline_kg: 54.0 // same base as the others; state is created lazily on first use
    }
};

const VALID_ACCOUNT_IDS = Object.keys(ACCOUNT_DEFS);

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
 * Check account import status. Returns:
 * - { imported: true, db } if imported_at exists and DB available
 * - { imported: false, db } if not imported yet and DB available (use files)
 * - { imported: 'unknown', db: null } if cannot determine (fail-closed: no file writes)
 */
async function getAccountImportStatus(accountId) {
    if (!_globalResources) {
        return { imported: 'unknown', db: null, reason: 'globalResources not set' };
    }
    const db = getCakePantryDb(_globalResources);
    if (!db) {
        return { imported: 'unknown', db: null, reason: 'tag database not available' };
    }
    try {
        const imported = await isAccountImported(db, accountId);
        return { imported, db };
    } catch (e) {
        return { imported: 'unknown', db: null, reason: e.message };
    }
}

/**
 * Ensure migration runs before write operations.
 */
async function ensurePantryMigration(accountId) {
    if (!_globalResources) return false;
    const db = getCakePantryDb(_globalResources);
    if (!db) return false;
    try {
        await ensureAccountMigration(db, accountId);
        return true;
    } catch (e) {
        console.error(`[cakePantry] Migration error for ${accountId}:`, e);
        return false;
    }
}

/** Visual-feast locked start weight for pantry keepers (and Menma/Guren defs). */
const VISUAL_FEAST_BASELINE_KG = 54.0;

/** Highest kg recorded in state.history, or null. */
function maxHistoryKg(state) {
    const hist = Array.isArray(state && state.history) ? state.history : [];
    let max = null;
    for (const h of hist) {
        const kg = h && h.kg != null && h.kg !== '' ? Number(h.kg) : NaN;
        if (Number.isFinite(kg) && (max == null || kg > max)) max = kg;
    }
    return max;
}

/**
 * kg_before for a meal. Monotonic accounts (Menma) never start below the highest
 * recorded history kg, so kg_before/kg_after and the new history entry can't drop
 * even if current_kg was stale or re-seeded. Others: unchanged.
 */
function monotonicKgBefore(accountId, state) {
    const raw = state.current_kg ?? state.baseline_kg ?? VISUAL_FEAST_BASELINE_KG;
    return Number(clampMonotonicKg(accountId, maxHistoryKg(state), raw));
}

/**
 * Fail-closed kg seed: never leave current_kg/baseline_kg null for known accounts.
 * Also one-shot lift accounts that ate from 0 while baseline was null (Pyra 0→0.96 → 54.96).
 * Menma unchanged beyond null-seed; Guren already above baseline stays put.
 * Returns { state, seeded }.
 */
function ensureCurrentKgSeeded(accountId, state) {
    if (!state || state._sqliteUnavailable || state._sqliteError || state._importStatusUnknown) {
        return { state, seeded: false };
    }
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return { state, seeded: false };

    let seeded = false;
    const lockedBaseline = def.baseline_kg != null ? def.baseline_kg : VISUAL_FEAST_BASELINE_KG;

    if (state.baseline_kg == null || state.baseline_kg === '') {
        state.baseline_kg = lockedBaseline;
        seeded = true;
    }

    if (state.current_kg == null || state.current_kg === '') {
        // Menma: never re-seed below the highest kg already in her history.
        state.current_kg = clampMonotonicKg(accountId, maxHistoryKg(state), state.baseline_kg);
        seeded = true;
    }

    // One-shot: consumed from 0 while baseline was null → current is below feast lock
    // Do not touch menma; do not touch anyone already at/above baseline (Guren 72.12).
    if (
        accountId !== 'menma'
        && !state._baseline_lift_applied
        && state.baseline_kg != null
        && state.current_kg != null
        && Number(state.current_kg) < Number(state.baseline_kg)
    ) {
        state.current_kg = Number((Number(state.current_kg) + Number(state.baseline_kg)).toFixed(2));
        state._baseline_lift_applied = true;
        seeded = true;
    }

    return { state, seeded };
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
 * Get or initialize account state (file-based, for pre-import only)
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
    const merged = { ...defaultState, ...state };
    const { state: seededState } = ensureCurrentKgSeeded(accountId, merged);
    return seededState;
}

/**
 * Get account state - async, uses SQLite after import.
 * FAIL-CLOSED: If import status unknown, return error state.
 */
async function getAccountState(accountId) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return null;
    
    const defaultState = getDefaultState(accountId);

    // Ensure migration runs before any operation
    await ensurePantryMigration(accountId);
    
    const status = await getAccountImportStatus(accountId);
    
    if (status.imported === true) {
        // After import: SQLite only
        if (!status.db) {
            return { ...defaultState, _sqliteUnavailable: true };
        }
        try {
            const state = await getAccountStateFromDb(status.db, accountId);
            if (state && Object.keys(state).length > 0) {
                const merged = { ...defaultState, ...state };
                const { state: seededState, seeded } = ensureCurrentKgSeeded(accountId, merged);
                if (seeded) {
                    try {
                        await saveAccountStateToDb(status.db, accountId, seededState);
                    } catch (persistErr) {
                        console.error(`[cakePantry] seed kg persist failed for ${accountId}:`, persistErr);
                    }
                }
                return seededState;
            }
            // Imported accounts stay on SQLite even with no prior rows (no file leftovers)
            try {
                await saveAccountStateToDb(status.db, accountId, defaultState);
            } catch (persistErr) {
                console.error(`[cakePantry] persist default state failed for ${accountId}:`, persistErr);
            }
            return defaultState;
        } catch (e) {
            console.error(`[cakePantry] getAccountState SQLite error for ${accountId}:`, e);
            return { ...defaultState, _sqliteError: e.message };
        }
    } else if (status.imported === false) {
        // Before import: use files
        return getAccountStateFromFile(accountId);
    } else {
        // Unknown import status: fail-closed
        console.error(`[cakePantry] getAccountState: cannot determine import status for ${accountId}:`, status.reason);
        return { ...defaultState, _importStatusUnknown: true, _reason: status.reason };
    }
}

/**
 * Save account state - async, uses SQLite after import.
 * FAIL-CLOSED: After import or unknown status, do NOT write to files.
 */
async function saveAccountState(accountId, state) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return false;

    // Ensure migration runs before any write
    await ensurePantryMigration(accountId);
    
    const status = await getAccountImportStatus(accountId);
    
    if (status.imported === true) {
        // After import: SQLite only, NO file fallback
        if (!status.db) {
            console.error(`[cakePantry] saveAccountState: SQLite unavailable after import for ${accountId}`);
            return false;
        }
        try {
            await saveAccountStateToDb(status.db, accountId, state);
            return true;
        } catch (e) {
            console.error(`[cakePantry] saveAccountState SQLite error for ${accountId}:`, e);
            return false;
        }
    } else if (status.imported === false) {
        // Before import: use files
        const dir = ensureAccountDir(accountId);
        if (!dir) return false;
        const statePath = path.join(dir, 'state.json');
        if (isMonotonicKgAccount(accountId) && Object.prototype.hasOwnProperty.call(state, 'current_kg')) {
            let prev = null;
            try { prev = JSON.parse(fs.readFileSync(statePath, 'utf8')).current_kg; } catch (_) { /* no file yet */ }
            state.current_kg = clampMonotonicKg(accountId, prev, state.current_kg);
        }
        writeJsonFile(statePath, state);
        return true;
    } else {
        // Unknown import status: fail-closed, do NOT write to files
        console.error(`[cakePantry] saveAccountState: cannot determine import status for ${accountId}, refusing file write:`, status.reason);
        return false;
    }
}

/**
 * Append to account's cake log - async, uses SQLite after import.
 * FAIL-CLOSED: After import or unknown status, do NOT write to files.
 */
async function appendCakeLog(accountId, entry) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return false;

    // Ensure migration runs before any write
    await ensurePantryMigration(accountId);
    
    const status = await getAccountImportStatus(accountId);
    
    if (status.imported === true) {
        // After import: SQLite only, NO file fallback
        if (!status.db) {
            console.error(`[cakePantry] appendCakeLog: SQLite unavailable after import for ${accountId}`);
            return false;
        }
        try {
            await appendCakeLogToDb(status.db, accountId, entry);
            return true;
        } catch (e) {
            console.error(`[cakePantry] appendCakeLog SQLite error for ${accountId}:`, e);
            return false;
        }
    } else if (status.imported === false) {
        // Before import: use files
        const dir = ensureAccountDir(accountId);
        if (!dir) return false;
        appendJsonlFile(path.join(dir, 'cake-log.jsonl'), entry);
        return true;
    } else {
        // Unknown import status: fail-closed, do NOT write to files
        console.error(`[cakePantry] appendCakeLog: cannot determine import status for ${accountId}, refusing file write:`, status.reason);
        return false;
    }
}

/**
 * Get account's cake log - async, uses SQLite after import
 */
async function getCakeLog(accountId, limit = 50) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) return [];

    const status = await getAccountImportStatus(accountId);
    
    if (status.imported === true) {
        if (!status.db) return [];
        try {
            return await getCakeLogFromDb(status.db, accountId, limit);
        } catch (e) {
            console.error(`[cakePantry] getCakeLog SQLite error for ${accountId}:`, e);
            return [];
        }
    } else if (status.imported === false) {
        // Before import: use files
        const dir = getAccountDir(accountId);
        if (!dir) return [];
        const logPath = path.join(dir, 'cake-log.jsonl');
        const entries = readJsonlFile(logPath);
        return limit > 0 ? entries.slice(-limit) : entries;
    } else {
        // Unknown: return empty
        return [];
    }
}

/**
 * Calculate cleanup slices from line/byte stats
 * 1 slice per 40 lines or 10KB removed, min 1, cap 16
 */
function calculateCleanupSlices(linesDeleted, bytesRemoved, roundUp = false) {
    const round = roundUp ? Math.ceil : Math.floor;
    const byLines = round((linesDeleted || 0) / CLEANUP_LINES_PER_SLICE);
    const byBytes = round((bytesRemoved || 0) / CLEANUP_BYTES_PER_SLICE);
    const raw = Math.max(byLines, byBytes);
    return Math.min(Math.max(raw, CLEANUP_SLICE_MIN), CLEANUP_SLICE_CAP);
}

/**
 * Apply multiplier for credit roles (LEAD_MULTIPLIER = 4x for Lead/grok.menma; others 1x)
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
    if (state._sqliteUnavailable || state._sqliteError || state._importStatusUnknown) {
        return { success: false, error: state._reason || 'SQLite unavailable', accountId };
    }

    const now = new Date().toISOString();
    let slices = Number(params.slices) || 0;
    
    if (params.line_counts && !params.slices) {
        slices = calculateCleanupSlices(
            params.line_counts.deleted || params.line_counts.lines_deleted,
            params.line_counts.bytes_removed,
            accountId !== 'menma'
        );
    }
    
    const credit = params.credit || null;
    const finalSlices = applyMultiplier(slices, credit);

    const dne = resolveDoNotEatFields(params);
    const delivery = {
        id: `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        at: now,
        slices: finalSlices,
        raw_slices: slices,
        reason: params.reason || 'unspecified',
        cake_type: dne.cake_type,
        do_not_eat: dne.do_not_eat,
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
    if (state._sqliteUnavailable || state._sqliteError || state._importStatusUnknown) {
        return { success: false, error: state._reason || 'SQLite unavailable', accountId };
    }

    const now = new Date().toISOString();
    const slices = Number(params.slices) || 0;

    const dne = resolveDoNotEatFields(params);
    const feed = {
        id: `feed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        at: now,
        slices,
        reason: params.reason || 'gift',
        cake_type: dne.cake_type,
        do_not_eat: dne.do_not_eat,
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
 * Newest meal in the account's FULL cake log with both images (ignores any
 * display log_limit). SQLite after import; jsonl before import.
 */
async function findLatestMealImages(accountId, options = {}) {
    const status = options.importStatus || await getAccountImportStatus(accountId);
    if (status.imported === true) {
        if (!status.db) return { before: null, after: null, meal_id: null };
        return getLatestMealImagesFromDb(status.db, accountId);
    }
    if (status.imported === false) {
        const dir = getAccountDir(accountId);
        if (!dir) return { before: null, after: null, meal_id: null };
        const entries = readJsonlFile(path.join(dir, 'cake-log.jsonl'));
        return { meal_id: null, ...latestMealImagesFromLog(entries) };
    }
    return { before: null, after: null, meal_id: null };
}

/**
 * inspect_pantry - View piles, past consumes, kg history
 */
async function inspectPantry(accountId, params = {}, options = {}) {
    const state = options.state || await getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }
    const { state: seededState, seeded } = ensureCurrentKgSeeded(accountId, state);
    Object.assign(state, seededState);
    if (seeded && !options.state && !state._sqliteUnavailable && !state._sqliteError && !state._importStatusUnknown) {
        await saveAccountState(accountId, state);
    }

    const logLimit = Number(params.log_limit) || 20;
    const cakeLog = options.cakeLog || await getCakeLog(accountId, logLimit);

    const kgHistory = (state.history || []).map((h) => ({
        at: h.at,
        kg: h.kg,
        slices: h.slices,
        gained_kg: h.gained_kg
    }));

    const pastConsumes = cakeLog
        .filter((e) => e.meal || e.loop || e.slices > 0)
        .map((e) => attachMealId(accountId, e));

    // Prefer newest meal that has both shots (any visual_gen_status). An
    // imageless newer meal must not fall back to stale state.last_* — that
    // denormalized cache is only updated on consume with images, never by
    // update_meal_images (Guren/Menma meal 109 vs 108 report).
    let latestShots = latestMealImagesFromLog(cakeLog);
    if (!(latestShots.before && latestShots.after)) {
        // log_limit window (e.g. 1) may hold only an imageless newest meal:
        // search the full log before the stale state cache (Rook, meal 110).
        const lookup = options.findLatestMealImages
            || (options.cakeLog ? null : (id) => findLatestMealImages(id));
        if (lookup) {
            try {
                const full = await lookup(accountId);
                if (full && full.before && full.after) latestShots = full;
            } catch (e) {
                console.error(`[cakePantry] inspectPantry full-log image lookup failed for ${accountId}:`, e);
            }
        }
    }

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
        last_before: latestShots.before || state.last_before || null,
        last_after: latestShots.after || state.last_after || null
    };
}

/**
 * Ledger fields that update_meal_images must never change.
 * visual_gen_status is NOT frozen: once both shots are set it becomes 'provided'
 * (same value consume_cake records when the caller passes both images).
 */
const MEAL_FROZEN_KEYS = [
    'at', 'loop', 'date_local', 'slices', 'stacks', 'cake_type', 'cake_rating',
    'kg_before', 'kg_after', 'gained_kg', 'chair', 'landscape', 'named_for',
    'qa', 'commits', 'deliveries_consumed', 'feeds_consumed', 'slices_requested',
    'max_slices_per_sitting', 'sitting_ceiling', 'soft_cap_override',
    'skipped_do_not_eat', 'pending_slices_after',
    'landed', 'left_open'
];

/**
 * Deterministic meal_id when the record has none (file-era / pre-#277).
 * Does not include image ids so re-pointing keeps the same id.
 */
function deriveMealId(accountId, entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.meal_id != null && String(entry.meal_id).trim() !== '') {
        return String(entry.meal_id);
    }
    if (entry.id != null && String(entry.id).trim() !== '') {
        return String(entry.id);
    }
    const at = entry.at != null ? String(entry.at) : '';
    const slices = entry.slices != null ? String(entry.slices) : '';
    const kgBefore = entry.kg_before != null ? String(entry.kg_before) : '';
    const kgAfter = entry.kg_after != null ? String(entry.kg_after) : '';
    return `meal_${accountId}_${at}_${slices}_${kgBefore}_${kgAfter}`;
}

/**
 * Return a shallow copy with meal_id set. Never mutates other fields.
 */
function attachMealId(accountId, entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const mealId = deriveMealId(accountId, entry);
    if (entry.meal_id === mealId) return entry;
    return { ...entry, meal_id: mealId };
}

function frozenMealLedger(meal) {
    const frozen = {};
    for (const key of MEAL_FROZEN_KEYS) {
        if (meal && Object.prototype.hasOwnProperty.call(meal, key)) {
            frozen[key] = meal[key];
        }
    }
    return frozen;
}

function currentMealImages(meal) {
    if (!meal || typeof meal !== 'object') return { before: null, after: null };
    return {
        before: meal.before || meal.before_image || meal.before_img || null,
        after: meal.after || meal.after_image || meal.after_img || null
    };
}

/** Same basename rules as mcpAgentFacade.sanitizeGalleryFilename / galleryFileExists. */
function sanitizePantryImageName(filename) {
    const raw = String(filename || '').trim();
    if (!raw) return null;
    if (raw.includes('..') || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) {
        return null;
    }
    return path.basename(raw);
}

/**
 * Default lookup: same path generate_image / get_generated_image / consume_cake
 * refs resolve against (gallery images dir + basename).
 */
function defaultResolvePantryImage(imageId) {
    const safe = sanitizePantryImageName(imageId);
    if (!safe) return null;
    const gr = getGlobalResources();
    if (!gr || typeof gr.getPath !== 'function') return null;
    try {
        const imagesDir = path.resolve(gr.getPath('images'));
        const filePath = path.resolve(imagesDir, safe);
        if (!filePath.startsWith(imagesDir + path.sep) && filePath !== imagesDir) {
            return null;
        }
        if (fs.existsSync(filePath)) return safe;
    } catch (_) {
        return null;
    }
    return null;
}

function resolvePantryImageId(imageId, resolveImage) {
    const raw = imageId == null ? '' : String(imageId).trim();
    if (!raw) return { ok: false, error: 'Unknown image id' };
    const safe = sanitizePantryImageName(raw);
    if (!safe) {
        return { ok: false, error: `Unknown image id: ${raw}` };
    }
    const lookup = typeof resolveImage === 'function' ? resolveImage : defaultResolvePantryImage;
    const found = lookup(safe) || lookup(raw);
    if (!found) {
        return { ok: false, error: `Unknown image id: ${safe}` };
    }
    return { ok: true, id: typeof found === 'string' ? found : safe };
}

/**
 * Re-point before/after on one meal object. Never changes frozen ledger fields.
 */
function applyMealImageUpdate(meal, patch = {}) {
    if (!meal || typeof meal !== 'object') {
        return { ok: false, error: 'Unknown meal' };
    }
    const current = currentMealImages(meal);
    const nextBefore = patch.before !== undefined ? patch.before : current.before;
    const nextAfter = patch.after !== undefined ? patch.after : current.after;
    const next = { ...meal };
    next.before = nextBefore;
    next.after = nextAfter;
    if ('before_image' in meal) next.before_image = nextBefore;
    if ('after_image' in meal) next.after_image = nextAfter;
    if ('before_img' in meal) next.before_img = nextBefore;
    if ('after_img' in meal) next.after_img = nextAfter;
    if (nextBefore && nextAfter && meal.visual_gen_status !== 'provided') {
        next.visual_gen_status = 'provided';
    }
    const history = Array.isArray(meal.image_history) ? meal.image_history.slice() : [];
    history.push({
        old_before: current.before,
        old_after: current.after,
        new_before: nextBefore,
        new_after: nextAfter,
        at: patch.now || new Date().toISOString(),
        client: patch.client != null ? patch.client : null
    });
    next.image_history = history;
    return {
        ok: true,
        meal: next,
        frozen_before: frozenMealLedger(meal),
        frozen_after: frozenMealLedger(next)
    };
}

function mealIdMatches(accountId, entry, mealId) {
    const wanted = String(mealId);
    const decorated = attachMealId(accountId, entry);
    if (decorated && String(decorated.meal_id) === wanted) return true;
    if (entry && entry.id != null && String(entry.id) === wanted) return true;
    return false;
}

function rewriteJsonlMeal(filePath, accountId, mealId, updater) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trailing = raw.endsWith('\n');
    const body = trailing ? raw.slice(0, -1) : raw;
    const lines = body.length ? body.split('\n') : [];
    let found = false;
    let updatedMeal = null;
    const out = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        let entry;
        try { entry = JSON.parse(trimmed); } catch (_) { return line; }
        if (found || !mealIdMatches(accountId, entry, mealId)) return line;
        found = true;
        const applied = updater(attachMealId(accountId, entry));
        if (!applied || !applied.ok) {
            throw applied && applied.error ? new Error(applied.error) : new Error('Failed to update meal images');
        }
        updatedMeal = applied.meal;
        return JSON.stringify(applied.meal);
    });
    if (!found) return { found: false };
    fs.writeFileSync(filePath, out.join('\n') + (trailing || out.length ? '\n' : ''), 'utf8');
    return { found: true, meal: updatedMeal };
}

/**
 * After update_meal_images, point the denormalized state.last_before/after at
 * the newest meal (full log) that has both images. Only those two keys are
 * written; kg and totals are never touched. Best-effort: a failure here never
 * fails the image update itself.
 */
async function refreshLastPairState(accountId, status, options = {}) {
    try {
        const pair = await findLatestMealImages(accountId, { importStatus: status });
        if (!(pair && pair.before && pair.after)) return { before: null, after: null };
        if (status.imported === true && status.db) {
            await saveAccountStateToDb(status.db, accountId, { last_before: pair.before, last_after: pair.after });
        } else if (status.imported === false && !options.skipStateRefresh) {
            const state = await getAccountState(accountId);
            if (state && !state._sqliteUnavailable && !state._sqliteError && !state._importStatusUnknown) {
                state.last_before = pair.before;
                state.last_after = pair.after;
                await saveAccountState(accountId, state);
            }
        }
        return { before: pair.before, after: pair.after };
    } catch (e) {
        console.error(`[cakePantry] update_meal_images last-pair refresh failed for ${accountId}:`, e);
        return { before: null, after: null };
    }
}

/**
 * update_meal_images - Re-point before/after image ids on an existing cake_log meal.
 * Never changes kg, slice amounts, timestamps, or totals. Never deletes images.
 */
async function updateMealImages(accountId, params = {}, options = {}) {
    const def = ACCOUNT_DEFS[accountId];
    if (!def) {
        return { success: false, error: 'Unknown account', accountId };
    }

    const mealId = params.meal_id != null ? String(params.meal_id).trim() : '';
    if (!mealId) {
        return { success: false, error: 'meal_id is required', accountId };
    }

    const hasBefore = params.before_image != null && String(params.before_image).trim() !== '';
    const hasAfter = params.after_image != null && String(params.after_image).trim() !== '';
    if (!hasBefore && !hasAfter) {
        return {
            success: false,
            error: 'At least one of before_image or after_image is required',
            accountId,
            meal_id: mealId
        };
    }

    const resolveImage = typeof options.resolveImage === 'function'
        ? options.resolveImage
        : defaultResolvePantryImage;

    let nextBefore;
    let nextAfter;
    if (hasBefore) {
        const resolved = resolvePantryImageId(params.before_image, resolveImage);
        if (!resolved.ok) {
            return { success: false, error: resolved.error, accountId, meal_id: mealId };
        }
        nextBefore = resolved.id;
    }
    if (hasAfter) {
        const resolved = resolvePantryImageId(params.after_image, resolveImage);
        if (!resolved.ok) {
            return { success: false, error: resolved.error, accountId, meal_id: mealId };
        }
        nextAfter = resolved.id;
    }

    if (!options.importStatus) {
        await ensurePantryMigration(accountId);
    }
    const status = options.importStatus || await getAccountImportStatus(accountId);
    if (status.imported === 'unknown') {
        return { success: false, error: status.reason || 'SQLite unavailable', accountId, meal_id: mealId };
    }

    const now = options.now || new Date().toISOString();
    const client = params.client != null ? params.client : (options.client != null ? options.client : null);
    const patch = { now, client };
    if (hasBefore) patch.before = nextBefore;
    if (hasAfter) patch.after = nextAfter;

    const applyFound = (meal) => applyMealImageUpdate(meal, patch);

    if (status.imported === true) {
        if (!status.db) {
            return { success: false, error: 'SQLite unavailable', accountId, meal_id: mealId };
        }
        const row = await findCakeLogRowByMealId(status.db, accountId, mealId);
        if (!row) {
            return { success: false, error: `Unknown meal_id: ${mealId}`, accountId, meal_id: mealId };
        }
        const meal = attachMealId(accountId, composeCakeLogEntry(row));
        const applied = applyFound(meal);
        if (!applied.ok) {
            return { success: false, error: applied.error, accountId, meal_id: mealId };
        }
        const saved = await updateCakeLogImagesToDb(status.db, accountId, row, {
            before: applied.meal.before,
            after: applied.meal.after,
            image_history: applied.meal.image_history,
            meal_id: applied.meal.meal_id,
            visual_gen_status: applied.meal.visual_gen_status
        });
        if (!saved) {
            return { success: false, error: 'Failed to update meal images', accountId, meal_id: mealId };
        }
        const lastPair = await refreshLastPairState(accountId, status, options);
        return {
            success: true,
            accountId,
            last_before: lastPair.before,
            last_after: lastPair.after,
            meal_id: applied.meal.meal_id,
            before_image: applied.meal.before,
            after_image: applied.meal.after,
            image_history: applied.meal.image_history,
            visual_gen_status: applied.meal.visual_gen_status != null ? applied.meal.visual_gen_status : null,
            meal: applied.meal
        };
    }

    const dir = getAccountDir(accountId);
    if (!dir) {
        return { success: false, error: 'Unknown account', accountId, meal_id: mealId };
    }
    const logPath = path.join(dir, 'cake-log.jsonl');
    if (!fs.existsSync(logPath)) {
        return { success: false, error: `Unknown meal_id: ${mealId}`, accountId, meal_id: mealId };
    }
    let rewritten;
    try {
        rewritten = rewriteJsonlMeal(logPath, accountId, mealId, applyFound);
    } catch (e) {
        return { success: false, error: e.message || 'Failed to update meal images', accountId, meal_id: mealId };
    }
    if (!rewritten.found) {
        return { success: false, error: `Unknown meal_id: ${mealId}`, accountId, meal_id: mealId };
    }
    const lastPairFile = await refreshLastPairState(accountId, status, options);
    return {
        success: true,
        accountId,
        last_before: lastPairFile.before,
        last_after: lastPairFile.after,
        meal_id: rewritten.meal.meal_id,
        before_image: rewritten.meal.before,
        after_image: rewritten.meal.after,
        image_history: rewritten.meal.image_history,
        visual_gen_status: rewritten.meal.visual_gen_status != null ? rewritten.meal.visual_gen_status : null,
        meal: rewritten.meal
    };
}

/**
 * consume_cake - Eater eats pending slices
 *
 * Rules:
 * - Soft sitting cap default MAX_SLICES_PER_SITTING (8); remainder stays pending
 * - Override with params.slices and/or params.max_slices up to all eligible pending
 * - Optional params.delivery_ids eats those deliveries instead of FIFO
 * - Same ship reason/key is eaten once; a later duplicate stays pending (#388)
 * - Skip dry-verify forever via cake_type=dry-verify and/or do_not_eat (legacy: reason starts with marker)
 * - Does NOT auto-generate before/after images (pass refs if already generated)
 */

async function persistAccountState(accountId, state, options) {
    if (options && options.state) {
        if (typeof options.saveState === 'function') {
            const ok = await options.saveState(accountId, state);
            return ok !== false;
        }
        return true;
    }
    return saveAccountState(accountId, state);
}

async function persistCakeLogEntry(accountId, entry, options) {
    if (options && options.state) {
        if (typeof options.appendLog === 'function') {
            const ok = await options.appendLog(accountId, entry);
            return ok !== false;
        }
        return true;
    }
    return appendCakeLog(accountId, entry);
}

async function syncShipCake(accountId, params) {
    const state = await getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }
    if (state._sqliteUnavailable || state._sqliteError || state._importStatusUnknown) {
        return { success: false, error: state._reason || 'SQLite unavailable', accountId };
    }


    const GITEA_BASE = 'https://yozora.bluesteel.737.jp.net/api/v1/repos/DreamScape/StaticForge';

    let sinceTime = params.since;
    if (!sinceTime) {
        const lastConsume = state.last_consume_at || state.last_breakfast_at;
        if (lastConsume) {
            sinceTime = lastConsume;
        } else {
            sinceTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        }
    }
    const sinceDate = new Date(sinceTime);

    let issues = [];
    let fetchError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await fetch(`${GITEA_BASE}/issues?state=closed&limit=50`);
            issues = await res.json();
            fetchError = null;
            break;
        } catch (e) {
            fetchError = e;
            if (attempt < 2) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    if (fetchError) {
        return { success: false, error: 'Failed to fetch issues from Gitea after retries', details: fetchError.message };
    }

    const plan = [];
    const cakeLog = await getCakeLog(accountId, 100) || [];
    const pendingDeliveries = state.pending_deliveries || [];

    // JULES: perf sweep - pre-build Set for O(1) reason lookups instead of O(P + L * N) linear searches per issue
    const deliveredReasons = new Set();
    const bankedPrNumbers = new Set();
    const bankedShas = new Set();

    const parseReason = (reasonStr) => {
        if (!reasonStr) return;
        deliveredReasons.add(reasonStr);
        // Yozora PR number: ship:<num>:... / ship:<num> ... (numeric token only).
        // Banks labelled as a GitHub mirror PR ("GH #<num>" / "GH#<num>") use GitHub
        // numbering, which overlaps Yozora's, so they dedup by sha only.
        const parsed = parseShipBankReason(reasonStr);
        if (parsed.pr != null) bankedPrNumbers.add(parsed.pr);
        for (const sha of parsed.shas) bankedShas.add(sha);
    };

    for (const d of pendingDeliveries) {
        if (d?.reason) parseReason(d.reason);
    }
    for (const l of cakeLog) {
        if (l) {
            if (l.reason) parseReason(l.reason);
            if (Array.isArray(l.named_for)) {
                for (const name of l.named_for) {
                    if (name) parseReason(name);
                }
            }
        }
    }

    if (!Array.isArray(issues)) issues = [];
    for (const issue of issues) {
        if (new Date(issue.closed_at) <= sinceDate) continue;

        const labels = (issue.labels || []).map(l => (l.name || '').toLowerCase());
        if (labels.some(l => l.includes('greg'))) continue;

        let credit = null;
        const assigneeNames = (issue.assignees || []).map(a => a.username);
        const userName = issue.user?.username;
        const isMenma = labels.includes('credit:menma') || assigneeNames.includes('grok.menma') || userName === 'grok.menma';
        const isJules = labels.includes('cursor-agent') || assigneeNames.includes('google-labs-jules[bot]') || userName === 'google-labs-jules[bot]' || assigneeNames.includes('grok.cursor') || userName === 'grok.cursor' || assigneeNames.includes('Jules') || userName === 'Jules';

        if (isMenma || isJules) {
            credit = 'grok.menma';
        }

        if (issue.pull_request) {
            let pr = null;
            let commits = null;
            let fetchError = null;
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const prRes = await fetch(`${GITEA_BASE}/pulls/${issue.number}`);
                    pr = await prRes.json();
                    const commitsRes = await fetch(`${GITEA_BASE}/pulls/${issue.number}/commits`);
                    commits = await commitsRes.json();
                    fetchError = null;
                    break;
                } catch (e) {
                    fetchError = e;
                    if (attempt < 2) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }

            if (fetchError) {
                return { success: false, error: `Failed to fetch PR ${issue.number} from Gitea after retries`, details: fetchError.message };
            }

            try {
                const sha = pr.merge_commit_sha || pr.head?.sha || 'unknown';
                const reasonKey = `ship:${issue.number}:${sha}`;

                // Collect all known SHAs for this PR
                const prShas = new Set();
                if (pr.merge_commit_sha) prShas.add(pr.merge_commit_sha);
                if (pr.head && pr.head.sha) prShas.add(pr.head.sha);
                if (Array.isArray(commits)) {
                    for (const c of commits) {
                        if (c && c.sha) prShas.add(c.sha);
                    }
                }

                let alreadyDelivered = bankedPrNumbers.has(issue.number);
                if (!alreadyDelivered) {
                    for (const s of prShas) {
                        if (bankedShas.has(s) || (s.length >= 7 && bankedShas.has(s.substring(0, 7)))) {
                            alreadyDelivered = true;
                            break;
                        }
                    }
                }

                if (alreadyDelivered) continue;

                const deletions = pr.deletions || 0;
                const slices = calculateCleanupSlices(deletions, 0, accountId !== 'menma');

                plan.push({
                    issue: issue.number,
                    sha,
                    title: issue.title,
                    reason: reasonKey,
                    deletions,
                    slices_raw: slices,
                    credit
                });
            } catch (e) {
                console.error(`[syncShipCake] failed to fetch PR ${issue.number}:`, e);
            }
        }
    }

    if (params.dry_run) {
        return {
            success: true,
            accountId,
            since: sinceDate.toISOString(),
            found: plan.length,
            plan
        };
    }

    let delivered = 0;
    const deliveredKeys = [];
    for (const item of plan) {
        const res = await deliverCake(accountId, {
            slices: item.slices_raw,
            reason: item.reason,
            credit: item.credit
        });
        if (res.success) {
            delivered += res.slices;
            deliveredKeys.push(item.reason);
        } else {
            console.error(`[syncShipCake] failed to deliver cake for ${item.reason}:`, res.error);
        }
    }

    return {
        success: true,
        accountId,
        since: sinceDate.toISOString(),
        delivered_slices_total: delivered,
        delivered_keys: deliveredKeys,
        plan
    };
}

async function consumeCake(accountId, params = {}, options = {}) {
    const injected = !!(options && options.state);
    const state = injected ? options.state : await getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }
    if (state._sqliteUnavailable || state._sqliteError || state._importStatusUnknown) {
        return { success: false, error: state._reason || 'SQLite unavailable', accountId };
    }

    let cakeLog = [];
    if (options && options.cakeLog != null) {
        cakeLog = options.cakeLog;
    } else if (!injected) {
        cakeLog = await getCakeLog(accountId, 2000) || [];
    }

    const pendingDeliveries = Array.isArray(state.pending_deliveries) ? state.pending_deliveries : [];
    const pendingFeeds = Array.isArray(state.pending_feeds) ? state.pending_feeds : [];

    // Prefer cake_type / do_not_eat; stamp legacy reason-prefix skips (Yozora #154).
    // delivery_ids replaces FIFO. Duplicate ship reason/key is not eaten twice (#388).
    const selection = selectConsumeItems(
        pendingDeliveries,
        pendingFeeds,
        params,
        collectEatenShipTokens(cakeLog)
    );
    if (!selection.ok) {
        return {
            success: false,
            error: selection.error,
            accountId,
            pending_slices: state.pending_slices || 0
        };
    }

    const skippedDeliveries = selection.skippedDeliveries;
    const eligibleDeliveries = selection.eligibleDeliveries;
    const skippedFeeds = selection.skippedFeeds;
    const eligibleFeeds = selection.eligibleFeeds;
    const duplicateDeliveries = selection.duplicateDeliveries;

    const eligibleSlices = sumItemSlices(eligibleDeliveries) + sumItemSlices(eligibleFeeds);
    const skippedSlices = sumItemSlices(skippedDeliveries) + sumItemSlices(skippedFeeds);
    const duplicateIds = duplicateDeliveries.map((d) => d && d.id).filter(Boolean);

    if (eligibleSlices <= 0) {
        // Nothing left that can be eaten. pending_slices counts eligible slices
        // only, so a void (do_not_eat) stays out of the counter (#388).
        // Do not drop duplicate deliveries that are still pending.
        if (duplicateDeliveries.length === 0) {
            const recalcPending = eligiblePendingSliceCount(skippedDeliveries, skippedFeeds);
            if ((state.pending_slices || 0) !== recalcPending) {
                state.pending_slices = recalcPending;
                state.pending_deliveries = [...skippedDeliveries];
                state.pending_feeds = [...skippedFeeds];
                await persistAccountState(accountId, state, options);
            }
        }
        return {
            success: false,
            error: duplicateDeliveries.length > 0
                ? 'No eligible pending slices to consume (duplicate ship reason/key already eaten)'
                : (skippedSlices > 0
                    ? 'No eligible pending slices to consume (only do-not-eat / dry-verify remain)'
                    : 'No pending slices to consume'),
            accountId,
            pending_slices: state.pending_slices || 0,
            skipped_slices: skippedSlices,
            skipped_deliveries: skippedDeliveries.length,
            skipped_duplicate_deliveries: duplicateIds,
            max_slices_per_sitting: MAX_SLICES_PER_SITTING
        };
    }

    const sitting = resolveSittingBudget(eligibleSlices, params);
    if (!sitting.ok) {
        return {
            success: false,
            error: sitting.error,
            accountId,
            max_slices_per_sitting: MAX_SLICES_PER_SITTING,
            sitting_ceiling: sitting.ceiling,
            eligible_slices: eligibleSlices
        };
    }
    const requested = sitting.requested;
    const budget = sitting.budget;

    const fromDeliveries = takeSlicesFromItems(eligibleDeliveries, budget);
    const remainingBudget = budget - fromDeliveries.slicesTaken;
    const fromFeeds = takeSlicesFromItems(eligibleFeeds, remainingBudget);

    const slicesToConsume = fromDeliveries.slicesTaken + fromFeeds.slicesTaken;
    if (slicesToConsume <= 0) {
        return {
            success: false,
            error: 'No eligible pending slices to consume',
            accountId,
            pending_slices: state.pending_slices || 0,
            max_slices_per_sitting: MAX_SLICES_PER_SITTING
        };
    }

    const now = new Date().toISOString();
    const dateLocal = new Date().toISOString().split('T')[0];

    const { state: kgState, seeded: kgSeeded } = ensureCurrentKgSeeded(accountId, state);
    Object.assign(state, kgState);
    if (kgSeeded) {
        // Persist seed before consume so a crash mid-meal cannot re-null
        await persistAccountState(accountId, state, options);
    }
    const kgBefore = monotonicKgBefore(accountId, state);
    const gainedKg = Number((slicesToConsume * KG_PER_SLICE).toFixed(2));
    const kgAfter = Number((kgBefore + gainedKg).toFixed(2));

    const stacks = params.stacks || Math.ceil(slicesToConsume / 12);

    const namedFor = params.named_for || [];
    for (const d of fromDeliveries.taken) {
        if (d.reason && !namedFor.includes(d.reason)) {
            namedFor.push(d.reason);
        }
    }
    for (const f of fromFeeds.taken) {
        if (f.reason && !namedFor.includes(`[gift] ${f.reason}`)) {
            namedFor.push(`[gift] ${f.reason}`);
        }
    }

    const beforeImage = params.before_image || null;
    const afterImage = params.after_image || null;
    const visualsProvided = Boolean(beforeImage || afterImage);
    // Root cause (Yozora #151): consume_cake never auto-generates images — it only
    // records caller-supplied refs. Silent nulls looked like a Bot/Hoshino MCP key
    // workspace/gallery failure; surface an explicit status instead.
    const visualGen = {
        status: visualsProvided ? 'provided' : 'not_generated',
        error: visualsProvided
            ? null
            : 'consume_cake does not auto-generate before/after images; pass before_image/after_image from generate_image (or leave null). Kg and pantry state still recorded.',
        max_gens: MAX_VISUAL_QA_GENS,
        invariants: ['empty_plates', 'visible_growth', 'hip_contrast'],
        kg_per_slice: KG_PER_SLICE
    };

    const remainingDeliveries = pendingAfterTake(
        pendingDeliveries,
        fromDeliveries.taken,
        fromDeliveries.remaining,
        skippedDeliveries
    );
    const remainingFeeds = pendingAfterTake(
        pendingFeeds,
        fromFeeds.taken,
        fromFeeds.remaining,
        skippedFeeds
    );
    const pendingAfter = eligiblePendingSliceCount(remainingDeliveries, remainingFeeds);

    const logEntry = {
        at: now,
        loop: params.loop || null,
        date_local: dateLocal,
        slices: slicesToConsume,
        stacks,
        cake_type: params.cake_type || state._cake_type || null,
        kg_before: kgBefore,
        kg_after: kgAfter,
        gained_kg: gainedKg,
        chair: params.chair || (state.milestones && state.milestones.chair) || null,
        landscape: params.landscape || false,
        named_for: namedFor.slice(0, 24),
        before: beforeImage,
        after: afterImage,
        qa: params.qa || null,
        commits: params.commits || null,
        deliveries_consumed: fromDeliveries.taken.length,
        feeds_consumed: fromFeeds.taken.length,
        slices_requested: requested,
        max_slices_per_sitting: MAX_SLICES_PER_SITTING,
        sitting_ceiling: sitting.ceiling,
        soft_cap_override: sitting.override,
        skipped_do_not_eat: skippedDeliveries.length + skippedFeeds.length,
        skipped_duplicate_deliveries: duplicateIds,
        pending_slices_after: pendingAfter,
        visual_gen_status: visualGen.status
    };

    state.current_kg = kgAfter;
    state.slices_eaten_total = (state.slices_eaten_total || 0) + slicesToConsume;
    state.pending_slices = pendingAfter;
    state.pending_deliveries = remainingDeliveries;
    state.pending_feeds = remainingFeeds;
    state.last_before = beforeImage || state.last_before;
    state.last_after = afterImage || state.last_after;
    state._cake_type = params.cake_type || state._cake_type;

    if (!Array.isArray(state.history)) {
        state.history = [];
    }
    state.history.push({
        at: now,
        slices: slicesToConsume,
        stacks,
        gained_kg: gainedKg,
        kg: kgAfter,
        chair: logEntry.chair,
        landscape: logEntry.landscape,
        before: logEntry.before,
        after: logEntry.after
    });

    const saved = await persistAccountState(accountId, state, options);
    if (!saved) {
        return { success: false, error: 'Failed to save state', accountId };
    }

    const logged = await persistCakeLogEntry(accountId, logEntry, options);
    if (!logged) {
        console.error(`[cakePantry] consumeCake: failed to append cake log for ${accountId}`);
    }

    return {
        success: true,
        accountId,
        account_name: state.character && state.character.name,
        slices_consumed: slicesToConsume,
        slices_requested: requested,
        max_slices_per_sitting: MAX_SLICES_PER_SITTING,
        sitting_ceiling: sitting.ceiling,
        soft_cap_override: sitting.override,
        stacks,
        cake_type: logEntry.cake_type,
        kg_before: kgBefore,
        kg_after: kgAfter,
        gained_kg: gainedKg,
        before_image: logEntry.before,
        after_image: logEntry.after,
        visual_gen: visualGen,
        visual_qa: visualGen,
        named_for: namedFor,
        slices_eaten_total: state.slices_eaten_total,
        pending_slices: pendingAfter,
        skipped_slices: skippedSlices,
        skipped_deliveries: skippedDeliveries.map((d) => d.id).filter(Boolean),
        skipped_duplicate_deliveries: duplicateIds,
        carry_slices: pendingAfter,
        log_entry: logEntry
    };
}

/**
 * void_cake_delivery - Mark one pending delivery do_not_eat.
 * Keeps cake_type, stores void_reason and optional consumed_by_meal.
 * Writes an audit row (who, when, reason). Never changes kg.
 * Errors on unknown or non-pending ids. pending_slices is recomputed
 * from items that are still eligible to eat (Rook #388).
 */
async function voidCakeDelivery(accountId, params = {}, options = {}) {
    const deliveryId = params.delivery_id != null
        ? String(params.delivery_id).trim()
        : (params.deliveryId != null ? String(params.deliveryId).trim() : '');
    const reason = params.reason != null ? String(params.reason).trim() : '';
    if (!deliveryId) {
        return { success: false, error: 'delivery_id is required', accountId };
    }
    if (!reason) {
        return { success: false, error: 'reason is required', accountId };
    }

    const injected = !!(options && options.state);
    const state = injected ? options.state : await getAccountState(accountId);
    if (!state) {
        return { success: false, error: 'Unknown account', accountId };
    }
    if (state._sqliteUnavailable || state._sqliteError || state._importStatusUnknown) {
        return { success: false, error: state._reason || 'SQLite unavailable', accountId };
    }

    const pending = Array.isArray(state.pending_deliveries) ? state.pending_deliveries : [];
    const idx = pending.findIndex((d) => d && d.id != null && String(d.id) === deliveryId);
    if (idx < 0 || isDoNotEatItem(pending[idx]) || pending[idx].voided === true) {
        return {
            success: false,
            error: `Unknown or non-pending delivery_id: ${deliveryId}`,
            accountId,
            delivery_id: deliveryId
        };
    }

    const item = pending[idx];
    const now = (options && options.now) || new Date().toISOString();
    const who = (options && options.actor) || params.who || params.actor || null;
    const consumedByMeal = params.consumed_by_meal != null && String(params.consumed_by_meal).trim() !== ''
        ? String(params.consumed_by_meal).trim()
        : null;
    const kg = state.current_kg;

    const voided = {
        ...item,
        do_not_eat: true,
        voided: true,
        void_reason: reason,
        voided_at: now,
        voided_by: who || null,
        consumed_by_meal: consumedByMeal
    };

    const nextDeliveries = pending.slice();
    nextDeliveries[idx] = voided;
    const feeds = Array.isArray(state.pending_feeds) ? state.pending_feeds : [];
    state.pending_deliveries = nextDeliveries;
    state.pending_slices = eligiblePendingSliceCount(nextDeliveries, feeds);

    const audit = {
        event: 'void_cake_delivery',
        at: now,
        who: who || null,
        reason,
        void_reason: reason,
        delivery_id: deliveryId,
        consumed_by_meal: consumedByMeal,
        cake_type: item.cake_type != null ? item.cake_type : null,
        slices: 0,
        stacks: 0,
        gained_kg: 0,
        kg_before: kg != null ? kg : null,
        kg_after: kg != null ? kg : null,
        named_for: []
    };
    if (!Array.isArray(state.audit_log)) state.audit_log = [];
    state.audit_log.push(audit);

    const saved = await persistAccountState(accountId, state, options);
    if (!saved) {
        return { success: false, error: 'Failed to save state', accountId };
    }
    const logged = await persistCakeLogEntry(accountId, audit, options);
    if (!logged) {
        console.error(`[cakePantry] voidCakeDelivery: failed to append audit log for ${accountId}`);
    }

    return {
        success: true,
        accountId,
        delivery_id: deliveryId,
        void_reason: reason,
        who: audit.who,
        at: now,
        consumed_by_meal: consumedByMeal,
        cake_type: voided.cake_type != null ? voided.cake_type : null,
        do_not_eat: true,
        current_kg: state.current_kg,
        pending_slices: state.pending_slices,
        delivery: voided,
        audit
    };
}

/**
 * List available accounts
 */
async function listAccounts() {
    const accounts = [];
    for (const def of Object.values(ACCOUNT_DEFS)) {
        let hasState = false;
        
        const status = await getAccountImportStatus(def.id);
        if (status.imported === true && status.db) {
            try {
                hasState = await hasAccountStateInDb(status.db, def.id);
            } catch (e) {
                hasState = false;
            }
        } else if (status.imported === false) {
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
// Work Pile Functions (all accounts, SQLite after import)
// FAIL-CLOSED: After import or unknown status, do NOT write to files.
// ============================================================================

/**
 * Get work pile for an account
 */
async function getWorkPile(accountId) {
    // Ensure migration runs
    await ensurePantryMigration(accountId);
    
    const status = await getAccountImportStatus(accountId);
    
    if (status.imported === true) {
        if (!status.db) return null;
        try {
            return await getWorkPileFromDb(status.db, accountId);
        } catch (e) {
            console.error(`[cakePantry] getWorkPile SQLite error for ${accountId}:`, e);
            return null;
        }
    } else if (status.imported === false) {
        // Before import: read from file
        const pilePath = path.join(WORKSPACE_ROOT, ACCOUNT_DIRS[accountId] || `.${accountId}`, 'work-pile.json');
        return readJsonFile(pilePath, { open: [], done_since_breakfast: [], eaten: [] });
    } else {
        return null;
    }
}

/**
 * Save work pile for an account
 * FAIL-CLOSED: After import or unknown status, do NOT write to files.
 */
async function saveWorkPile(accountId, pile) {
    // Ensure migration runs
    await ensurePantryMigration(accountId);
    
    const status = await getAccountImportStatus(accountId);
    
    if (status.imported === true) {
        // After import: SQLite only, NO file fallback
        if (!status.db) {
            console.error(`[cakePantry] saveWorkPile: SQLite unavailable after import for ${accountId}`);
            return false;
        }
        try {
            await saveWorkPileToDb(status.db, accountId, pile);
            return true;
        } catch (e) {
            console.error(`[cakePantry] saveWorkPile SQLite error for ${accountId}:`, e);
            return false;
        }
    } else if (status.imported === false) {
        // Before import: write to file
        const dir = ensureAccountDir(accountId);
        if (!dir) return false;
        writeJsonFile(path.join(dir, 'work-pile.json'), pile);
        return true;
    } else {
        // Unknown import status: fail-closed, do NOT write to files
        console.error(`[cakePantry] saveWorkPile: cannot determine import status for ${accountId}, refusing file write:`, status.reason);
        return false;
    }
}

/**
 * Add work item to account pile
 * FAIL-CLOSED: After import or unknown status, do NOT write to files.
 */
async function addWorkItem(accountId, item, type = 'open') {
    // Ensure migration runs
    await ensurePantryMigration(accountId);
    
    const status = await getAccountImportStatus(accountId);
    
    if (status.imported === true) {
        // After import: SQLite only, NO file fallback
        if (!status.db) {
            console.error(`[cakePantry] addWorkItem: SQLite unavailable after import for ${accountId}`);
            return false;
        }
        try {
            await addWorkItemToDb(status.db, accountId, item, type);
            return true;
        } catch (e) {
            console.error(`[cakePantry] addWorkItem SQLite error for ${accountId}:`, e);
            return false;
        }
    } else if (status.imported === false) {
        // Before import: read/modify/write file
        const pile = await getWorkPile(accountId) || { open: [], done_since_breakfast: [], eaten: [] };
        if (!Array.isArray(pile[type])) {
            pile[type] = [];
        }
        pile[type].push({ ...item, added: item.added || new Date().toISOString() });
        pile.updated_at = new Date().toISOString();
        return await saveWorkPile(accountId, pile);
    } else {
        // Unknown import status: fail-closed
        console.error(`[cakePantry] addWorkItem: cannot determine import status for ${accountId}, refusing file write:`, status.reason);
        return false;
    }
}

/**
 * Complete work item (move from open to done_since_breakfast)
 * FAIL-CLOSED: After import or unknown status, do NOT write to files.
 */
async function completeWorkItem(accountId, workId) {
    // Ensure migration runs
    await ensurePantryMigration(accountId);
    
    const status = await getAccountImportStatus(accountId);
    
    if (status.imported === true) {
        // After import: SQLite only
        if (!status.db) {
            console.error(`[cakePantry] completeWorkItem: SQLite unavailable after import for ${accountId}`);
            return false;
        }
        try {
            return await completeWorkItemInDb(status.db, accountId, workId);
        } catch (e) {
            console.error(`[cakePantry] completeWorkItem SQLite error for ${accountId}:`, e);
            return false;
        }
    } else if (status.imported === false) {
        // Before import: read/modify/write file
        const pile = await getWorkPile(accountId);
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
        return await saveWorkPile(accountId, pile);
    } else {
        // Unknown import status: fail-closed
        console.error(`[cakePantry] completeWorkItem: cannot determine import status for ${accountId}:`, status.reason);
        return false;
    }
}

/**
 * Remove work item from pile
 * FAIL-CLOSED: After import or unknown status, do NOT write to files.
 */
async function removeWorkItem(accountId, workId) {
    // Ensure migration runs
    await ensurePantryMigration(accountId);
    
    const status = await getAccountImportStatus(accountId);
    
    if (status.imported === true) {
        // After import: SQLite only
        if (!status.db) {
            console.error(`[cakePantry] removeWorkItem: SQLite unavailable after import for ${accountId}`);
            return false;
        }
        try {
            return await removeWorkItemFromDb(status.db, accountId, workId);
        } catch (e) {
            console.error(`[cakePantry] removeWorkItem SQLite error for ${accountId}:`, e);
            return false;
        }
    } else if (status.imported === false) {
        // Before import: read/modify/write file
        const pile = await getWorkPile(accountId);
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
            return await saveWorkPile(accountId, pile);
        }
        return false;
    } else {
        // Unknown import status: fail-closed
        console.error(`[cakePantry] removeWorkItem: cannot determine import status for ${accountId}:`, status.reason);
        return false;
    }
}

// Backward compat aliases for menma-specific functions
const getMenmaWorkPile = () => getWorkPile('menma');
const saveMenmaWorkPile = (pile) => saveWorkPile('menma', pile);
const addMenmaWorkItem = (item, type) => addWorkItem('menma', item, type);
const completeMenmaWorkItem = (workId) => completeWorkItem('menma', workId);
const removeMenmaWorkItem = (workId) => removeWorkItem('menma', workId);

module.exports = {
    ACCOUNT_DEFS,
    VALID_ACCOUNT_IDS,
    KG_PER_SLICE,
    CLEANUP_LINES_PER_SLICE,
    CLEANUP_BYTES_PER_SLICE,
    CLEANUP_SLICE_MIN,
    CLEANUP_SLICE_CAP,
    LEAD_MULTIPLIER,
    MAX_VISUAL_QA_GENS,
    MAX_SLICES_PER_SITTING,
    normalizeCakeType,
    isDryVerifyCakeType,
    truthyDoNotEatFlag,
    legacyReasonIsDoNotEat,
    isDoNotEatReason,
    isDoNotEatItem,
    resolveDoNotEatFields,
    stampDoNotEatMigration,
    takeSlicesFromItems,
    sumItemSlices,
    parseShipBankReason,
    shipDedupTokens,
    collectEatenShipTokens,
    partitionFifoDuplicateDeliveries,
    eligiblePendingSliceCount,
    resolveSittingBudget,
    setGlobalResources,
    getGlobalResources,
    getAccountDir,
    ensureAccountDir,
    getAccountImportStatus,
    ensurePantryMigration,
    getAccountState,
    saveAccountState,
    appendCakeLog,
    getCakeLog,
    calculateCleanupSlices,
    applyMultiplier,
    syncShipCake,
    deliverCake,
    feedCake,
    inspectPantry,
    consumeCake,
    voidCakeDelivery,
    updateMealImages,
    deriveMealId,
    attachMealId,
    listAccounts,
    getAccountDef,
    getWorkPile,
    saveWorkPile,
    addWorkItem,
    completeWorkItem,
    removeWorkItem,
    // Backward compat aliases
    getMenmaWorkPile,
    saveMenmaWorkPile,
    addMenmaWorkItem,
    completeMenmaWorkItem,
    removeMenmaWorkItem,
    _test: {
        maxHistoryKg,
        monotonicKgBefore,
        ensureCurrentKgSeeded,
        MEAL_FROZEN_KEYS,
        deriveMealId,
        attachMealId,
        frozenMealLedger,
        currentMealImages,
        latestMealImagesFromLog,
        findLatestMealImages,
        refreshLastPairState,
        sanitizePantryImageName,
        defaultResolvePantryImage,
        resolvePantryImageId,
        applyMealImageUpdate,
        mealIdMatches,
        rewriteJsonlMeal
    }
};
