'use strict';

/**
 * Menma DSAP SQLite Module
 * 
 * Reads AND writes Menma ledger data (state, cake-log, work-pile) from/to SQLite.
 * After import, ALL reads and writes go through SQLite. Files are read-only for import.
 * 
 * Tables in tag_wiki.db:
 * - menma_state: key-value state (kg, slices, history, etc.)
 * - menma_cake_log: cake consumption entries
 * - menma_work_pile: work items (open, done_since_breakfast, eaten)
 * - menma_meta: migration metadata (imported_at flag)
 */

const fs = require('fs');
const path = require('path');

const MENMA_DIR = path.join(__dirname, '..', '.menma');
const IMAGE_NAME_RE = /^[A-Za-z0-9._-]+\.(png|webp|jpe?g)$/i;
const LOG_TAIL = 16;

function safeImageName(name) {
    if (!name || typeof name !== 'string') return null;
    const base = path.basename(name);
    return IMAGE_NAME_RE.test(base) ? base : null;
}

function readJsonFile(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function pickWorkItem(item) {
    if (!item || typeof item !== 'object') return null;
    return {
        id: item.id || '',
        from: item.from || '',
        added: item.added || null,
        done: item.done || null,
        summary: item.summary || '',
        cake: item.cake || null,
        slices_hint: item.slices_hint != null ? item.slices_hint : null
    };
}

function pickLogEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    return {
        at: entry.at || null,
        loop: entry.loop || null,
        date_local: entry.date_local || null,
        slices: entry.slices != null ? entry.slices : null,
        stacks: entry.stacks != null ? entry.stacks : null,
        cake_type: entry.cake_type || null,
        cake_rating: entry.cake_rating != null ? entry.cake_rating : null,
        kg_before: entry.kg_before != null ? entry.kg_before : null,
        kg_after: entry.kg_after != null ? entry.kg_after : null,
        gained_kg: entry.gained_kg != null ? entry.gained_kg : null,
        chair: entry.chair || null,
        named_for: Array.isArray(entry.named_for) ? entry.named_for.slice(0, 24) : [],
        before: safeImageName(entry.before),
        after: safeImageName(entry.after),
        landed: Array.isArray(entry.landed) ? entry.landed.slice(0, 24) : [],
        left_open: Array.isArray(entry.left_open) ? entry.left_open.slice(0, 24) : []
    };
}

/**
 * Check if migration has been completed using menma_meta.imported_at
 */
async function isMigrated(db) {
    try {
        const row = await db.get("SELECT value FROM menma_meta WHERE key = 'imported_at'");
        return row != null && row.value != null;
    } catch (e) {
        return false;
    }
}

/**
 * Transactional, idempotent one-shot migration from .menma/ files to SQLite.
 * Uses menma_meta.imported_at as gate (not COUNT-based).
 */
async function runMigrationIfNeeded(db) {
    try {
        if (await isMigrated(db)) {
            return;
        }

        console.log('[Menma] Running one-shot migration from .menma/ to tag_wiki.db...');
        const now = new Date().toISOString();

        await db.run('BEGIN TRANSACTION');

        try {
            // 1. Migrate state.json
            const state = readJsonFile(path.join(MENMA_DIR, 'state.json'), null);
            if (state) {
                for (const [key, value] of Object.entries(state)) {
                    await db.run(
                        'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
                        [key, JSON.stringify(value), now]
                    );
                }
            }

            // 2. Migrate work-pile.json
            const pile = readJsonFile(path.join(MENMA_DIR, 'work-pile.json'), null);
            if (pile) {
                if (pile.updated_at) {
                    await db.run(
                        'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
                        ['work_pile_updated_at', JSON.stringify(pile.updated_at), now]
                    );
                }
                if (pile.last_breakfast_at) {
                    await db.run(
                        'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
                        ['work_pile_last_breakfast_at', JSON.stringify(pile.last_breakfast_at), now]
                    );
                }
                if (pile.rule) {
                    await db.run(
                        'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
                        ['work_pile_rule', JSON.stringify(pile.rule), now]
                    );
                }
                if (pile.cake_note) {
                    await db.run(
                        'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
                        ['work_pile_cake_note', JSON.stringify(pile.cake_note), now]
                    );
                }

                const insertWorkItem = async (item, type) => {
                    const picked = pickWorkItem(item);
                    if (!picked) return;
                    const extraData = { ...item };
                    delete extraData.id;
                    delete extraData.from;
                    delete extraData.added;
                    delete extraData.done;
                    delete extraData.summary;
                    delete extraData.cake;
                    delete extraData.slices_hint;

                    await db.run(`
                        INSERT INTO menma_work_pile (type, work_id, source_from, added, done, summary, cake, slices_hint, extra_data)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        type,
                        picked.id,
                        picked.from,
                        picked.added,
                        picked.done,
                        picked.summary,
                        picked.cake,
                        picked.slices_hint,
                        JSON.stringify(extraData)
                    ]);
                };

                if (Array.isArray(pile.open)) {
                    for (const item of pile.open) {
                        await insertWorkItem(item, 'open');
                    }
                }
                if (Array.isArray(pile.done_since_breakfast)) {
                    for (const item of pile.done_since_breakfast) {
                        await insertWorkItem(item, 'done_since_breakfast');
                    }
                }
                if (Array.isArray(pile.eaten)) {
                    for (const item of pile.eaten) {
                        await insertWorkItem(item, 'eaten');
                    }
                }
            }

            // 3. Migrate cake-log.jsonl (idempotent: check 'at' + 'slices' uniqueness)
            const cakeLogPath = path.join(MENMA_DIR, 'cake-log.jsonl');
            if (fs.existsSync(cakeLogPath)) {
                const raw = fs.readFileSync(cakeLogPath, 'utf8');
                const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
                
                for (const line of lines) {
                    try {
                        const item = JSON.parse(line);
                        const picked = pickLogEntry(item);
                        if (!picked || !picked.at) continue;

                        // Check if this log entry already exists (idempotent)
                        const exists = await db.get(
                            'SELECT id FROM menma_cake_log WHERE at = ? AND slices = ?',
                            [picked.at, picked.slices]
                        );
                        if (exists) continue;

                        const extraData = { ...item };
                        delete extraData.at;
                        delete extraData.loop;
                        delete extraData.date_local;
                        delete extraData.slices;
                        delete extraData.stacks;
                        delete extraData.cake_type;
                        delete extraData.cake_rating;
                        delete extraData.kg_before;
                        delete extraData.kg_after;
                        delete extraData.gained_kg;
                        delete extraData.chair;
                        delete extraData.named_for;
                        delete extraData.before;
                        delete extraData.after;
                        delete extraData.landed;
                        delete extraData.left_open;

                        await db.run(`
                            INSERT INTO menma_cake_log (
                                at, loop, date_local, slices, stacks, cake_type, cake_rating,
                                kg_before, kg_after, gained_kg, chair, named_for, before_img, after_img,
                                landed, left_open, extra_data
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [
                            picked.at,
                            picked.loop,
                            picked.date_local,
                            picked.slices,
                            picked.stacks,
                            picked.cake_type,
                            picked.cake_rating,
                            picked.kg_before,
                            picked.kg_after,
                            picked.gained_kg,
                            picked.chair,
                            JSON.stringify(picked.named_for),
                            picked.before,
                            picked.after,
                            JSON.stringify(picked.landed),
                            JSON.stringify(picked.left_open),
                            JSON.stringify(extraData)
                        ]);
                    } catch (e) {
                        console.error('[Menma] Error migrating cake log line:', e);
                    }
                }
            }

            // 4. Set imported_at flag in menma_meta
            await db.run(
                'INSERT OR REPLACE INTO menma_meta (key, value, updated_at) VALUES (?, ?, ?)',
                ['imported_at', now, now]
            );

            await db.run('COMMIT');
            console.log('[Menma] Migration complete.');
        } catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('[Menma] Migration failed:', error);
        throw error;
    }
}

// ============================================================================
// SQLite Writer Functions for cakePantry integration
// ============================================================================

/**
 * Get Menma state from SQLite (called by cakePantry.getAccountState for menma)
 */
async function getMenmaStateFromDb(db) {
    const stateRows = await db.all('SELECT key, value FROM menma_state');
    const state = {};
    for (const row of stateRows) {
        try {
            if (!row.key.startsWith('work_pile_')) {
                state[row.key] = JSON.parse(row.value);
            }
        } catch (e) {}
    }
    return state;
}

/**
 * Save Menma state to SQLite (called by cakePantry.saveAccountState for menma)
 */
async function saveMenmaStateToDb(db, state) {
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(state)) {
        await db.run(
            'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
            [key, JSON.stringify(value), now]
        );
    }
    return true;
}

/**
 * Append cake log entry to SQLite (called by cakePantry.appendCakeLog for menma)
 */
async function appendMenmaCakeLogToDb(db, entry) {
    const picked = pickLogEntry(entry);
    if (!picked) return false;

    const extraData = { ...entry };
    delete extraData.at;
    delete extraData.loop;
    delete extraData.date_local;
    delete extraData.slices;
    delete extraData.stacks;
    delete extraData.cake_type;
    delete extraData.cake_rating;
    delete extraData.kg_before;
    delete extraData.kg_after;
    delete extraData.gained_kg;
    delete extraData.chair;
    delete extraData.named_for;
    delete extraData.before;
    delete extraData.after;
    delete extraData.landed;
    delete extraData.left_open;

    await db.run(`
        INSERT INTO menma_cake_log (
            at, loop, date_local, slices, stacks, cake_type, cake_rating,
            kg_before, kg_after, gained_kg, chair, named_for, before_img, after_img,
            landed, left_open, extra_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        picked.at,
        picked.loop,
        picked.date_local,
        picked.slices,
        picked.stacks,
        picked.cake_type,
        picked.cake_rating,
        picked.kg_before,
        picked.kg_after,
        picked.gained_kg,
        picked.chair,
        JSON.stringify(picked.named_for),
        picked.before,
        picked.after,
        JSON.stringify(picked.landed),
        JSON.stringify(picked.left_open),
        JSON.stringify(extraData)
    ]);
    return true;
}

/**
 * Get cake log from SQLite (called by cakePantry.getCakeLog for menma)
 */
async function getMenmaCakeLogFromDb(db, limit = 50) {
    const rows = await db.all(`
        SELECT * FROM menma_cake_log
        ORDER BY id DESC
        LIMIT ?
    `, [limit]);

    rows.reverse();

    return rows.map(row => {
        let named_for = [];
        let landed = [];
        let left_open = [];
        let extra = {};
        try { named_for = JSON.parse(row.named_for || '[]'); } catch (e) {}
        try { landed = JSON.parse(row.landed || '[]'); } catch (e) {}
        try { left_open = JSON.parse(row.left_open || '[]'); } catch (e) {}
        try { extra = JSON.parse(row.extra_data || '{}'); } catch (e) {}

        return {
            at: row.at,
            loop: row.loop,
            date_local: row.date_local,
            slices: row.slices,
            stacks: row.stacks,
            cake_type: row.cake_type,
            cake_rating: row.cake_rating,
            kg_before: row.kg_before,
            kg_after: row.kg_after,
            gained_kg: row.gained_kg,
            chair: row.chair,
            named_for,
            before: row.before_img,
            after: row.after_img,
            landed,
            left_open,
            ...extra
        };
    });
}

/**
 * Check if Menma state exists in SQLite (for listAccounts has_state)
 */
async function hasMenmaStateInDb(db) {
    try {
        const row = await db.get("SELECT COUNT(*) as count FROM menma_state WHERE key = 'current_kg'");
        return row && row.count > 0;
    } catch (e) {
        return false;
    }
}

// ============================================================================
// Work Pile SQLite Functions
// ============================================================================

/**
 * Get work pile from SQLite
 */
async function getWorkPileFromDb(db) {
    const stateRows = await db.all("SELECT key, value FROM menma_state WHERE key LIKE 'work_pile_%'");
    let updatedAt = null;
    let lastBreakfastAt = null;
    let rule = null;
    let cakeNote = null;

    for (const row of stateRows) {
        try {
            if (row.key === 'work_pile_updated_at') {
                updatedAt = JSON.parse(row.value);
            } else if (row.key === 'work_pile_last_breakfast_at') {
                lastBreakfastAt = JSON.parse(row.value);
            } else if (row.key === 'work_pile_rule') {
                rule = JSON.parse(row.value);
            } else if (row.key === 'work_pile_cake_note') {
                cakeNote = JSON.parse(row.value);
            }
        } catch (e) {}
    }

    const workPileRows = await db.all('SELECT * FROM menma_work_pile ORDER BY id ASC');
    const open = [];
    const doneSinceBreakfast = [];
    const eaten = [];

    for (const row of workPileRows) {
        const item = {
            id: row.work_id,
            from: row.source_from,
            added: row.added,
            done: row.done,
            summary: row.summary,
            cake: row.cake,
            slices_hint: row.slices_hint
        };
        try {
            const extra = JSON.parse(row.extra_data || '{}');
            Object.assign(item, extra);
        } catch (e) {}

        if (row.type === 'open') {
            open.push(item);
        } else if (row.type === 'done_since_breakfast') {
            doneSinceBreakfast.push(item);
        } else if (row.type === 'eaten') {
            eaten.push(item);
        }
    }

    return {
        updated_at: updatedAt,
        last_breakfast_at: lastBreakfastAt,
        rule,
        cake_note: cakeNote,
        open,
        done_since_breakfast: doneSinceBreakfast,
        eaten
    };
}

/**
 * Save work pile to SQLite (replaces all items)
 */
async function saveWorkPileToDb(db, pile) {
    const now = new Date().toISOString();

    await db.run('BEGIN TRANSACTION');
    try {
        // Clear existing work pile items
        await db.run('DELETE FROM menma_work_pile');

        // Save metadata to menma_state
        if (pile.updated_at !== undefined) {
            await db.run(
                'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
                ['work_pile_updated_at', JSON.stringify(pile.updated_at || now), now]
            );
        }
        if (pile.last_breakfast_at !== undefined) {
            await db.run(
                'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
                ['work_pile_last_breakfast_at', JSON.stringify(pile.last_breakfast_at), now]
            );
        }
        if (pile.rule !== undefined) {
            await db.run(
                'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
                ['work_pile_rule', JSON.stringify(pile.rule), now]
            );
        }
        if (pile.cake_note !== undefined) {
            await db.run(
                'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
                ['work_pile_cake_note', JSON.stringify(pile.cake_note), now]
            );
        }

        const insertWorkItem = async (item, type) => {
            const picked = pickWorkItem(item);
            if (!picked) return;
            const extraData = { ...item };
            delete extraData.id;
            delete extraData.from;
            delete extraData.added;
            delete extraData.done;
            delete extraData.summary;
            delete extraData.cake;
            delete extraData.slices_hint;

            await db.run(`
                INSERT INTO menma_work_pile (type, work_id, source_from, added, done, summary, cake, slices_hint, extra_data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                type,
                picked.id,
                picked.from,
                picked.added,
                picked.done,
                picked.summary,
                picked.cake,
                picked.slices_hint,
                JSON.stringify(extraData)
            ]);
        };

        if (Array.isArray(pile.open)) {
            for (const item of pile.open) {
                await insertWorkItem(item, 'open');
            }
        }
        if (Array.isArray(pile.done_since_breakfast)) {
            for (const item of pile.done_since_breakfast) {
                await insertWorkItem(item, 'done_since_breakfast');
            }
        }
        if (Array.isArray(pile.eaten)) {
            for (const item of pile.eaten) {
                await insertWorkItem(item, 'eaten');
            }
        }

        await db.run('COMMIT');
        return true;
    } catch (error) {
        await db.run('ROLLBACK');
        throw error;
    }
}

/**
 * Add a work item to the pile
 */
async function addWorkItemToDb(db, item, type = 'open') {
    const picked = pickWorkItem(item);
    if (!picked) return false;

    const extraData = { ...item };
    delete extraData.id;
    delete extraData.from;
    delete extraData.added;
    delete extraData.done;
    delete extraData.summary;
    delete extraData.cake;
    delete extraData.slices_hint;

    await db.run(`
        INSERT INTO menma_work_pile (type, work_id, source_from, added, done, summary, cake, slices_hint, extra_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        type,
        picked.id,
        picked.from,
        picked.added || new Date().toISOString(),
        picked.done,
        picked.summary,
        picked.cake,
        picked.slices_hint,
        JSON.stringify(extraData)
    ]);

    // Update work_pile_updated_at
    const now = new Date().toISOString();
    await db.run(
        'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
        ['work_pile_updated_at', JSON.stringify(now), now]
    );

    return true;
}

/**
 * Move work item from open to done_since_breakfast
 */
async function completeWorkItemInDb(db, workId) {
    const now = new Date().toISOString();
    
    const result = await db.run(
        "UPDATE menma_work_pile SET type = 'done_since_breakfast', done = ? WHERE work_id = ? AND type = 'open'",
        [now, workId]
    );

    if (result.changes > 0) {
        await db.run(
            'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
            ['work_pile_updated_at', JSON.stringify(now), now]
        );
        return true;
    }
    return false;
}

/**
 * Remove work item from pile
 */
async function removeWorkItemFromDb(db, workId) {
    const now = new Date().toISOString();
    
    const result = await db.run(
        'DELETE FROM menma_work_pile WHERE work_id = ?',
        [workId]
    );

    if (result.changes > 0) {
        await db.run(
            'INSERT OR REPLACE INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)',
            ['work_pile_updated_at', JSON.stringify(now), now]
        );
        return true;
    }
    return false;
}

// ============================================================================
// buildMenmaStatus (read-only, same shape as before)
// ============================================================================

async function buildMenmaStatus(globalResources) {
    if (!globalResources || typeof globalResources.getTagDatabase !== 'function') {
        return {
            success: false,
            available: false,
            error: 'globalResources missing or invalid'
        };
    }

    let tagDb;
    try {
        tagDb = globalResources.getTagDatabase();
    } catch (e) {
        return {
            success: false,
            available: false,
            error: 'tag database not initialized'
        };
    }

    if (!tagDb || !tagDb.db) {
        return {
            success: false,
            available: false,
            error: 'tag_wiki.db not available'
        };
    }
    const db = tagDb.db;

    try {
        await runMigrationIfNeeded(db);
    } catch (e) {
        console.error('[Menma] buildMenmaStatus migration error:', e);
    }

    try {
        const state = await getMenmaStateFromDb(db);
        const workPile = await getWorkPileFromDb(db);
        const log = await getMenmaCakeLogFromDb(db, LOG_TAIL);

        const lastLog = log.length ? log[log.length - 1] : null;
        const history = Array.isArray(state.history) ? state.history : [];
        const lastHistory = history.length ? history[history.length - 1] : null;

        let lastMeal = lastLog ? pickLogEntry(lastLog) : null;
        if (!lastMeal && lastHistory) {
            lastMeal = {
                at: lastHistory.at || null,
                slices: lastHistory.slices != null ? lastHistory.slices : null,
                stacks: lastHistory.stacks != null ? lastHistory.stacks : null,
                kg_after: lastHistory.kg != null ? lastHistory.kg : null,
                gained_kg: lastHistory.gained_kg != null ? lastHistory.gained_kg : null,
                before: safeImageName(lastHistory.before),
                after: safeImageName(lastHistory.after),
                chair: lastHistory.chair || null
            };
        }

        const hasState = Object.keys(state).length > 0;

        return {
            success: true,
            updated_at: new Date().toISOString(),
            available: hasState,
            character_name: hasState && state.character && state.character.name
                ? String(state.character.name)
                : 'Menma',
            current_kg: hasState ? state.current_kg : null,
            baseline_kg: hasState ? state.baseline_kg : null,
            slices_eaten_total: hasState ? state.slices_eaten_total : null,
            pending_slices: hasState ? (state.pending_slices || 0) : 0,
            overtime_hours_total: hasState ? (state.overtime_hours_total || 0) : 0,
            cake_type: (hasState && (state._cake_type || state.favorite_cake))
                || (lastLog && lastLog.cake_type)
                || null,
            favorite_cake: hasState ? state.favorite_cake : null,
            cake_ratings: hasState && state.cake_ratings ? state.cake_ratings : {},
            chair: (hasState && state.milestones && state.milestones.chair)
                || (lastLog && lastLog.chair)
                || null,
            last_before: safeImageName(hasState && state.last_before),
            last_after: safeImageName(hasState && state.last_after),
            last_look: safeImageName(hasState && state.last_look),
            last_meal: lastMeal,
            work_pile: {
                updated_at: workPile.updated_at || null,
                last_breakfast_at: workPile.last_breakfast_at || null,
                open: (workPile.open || []).map(pickWorkItem).filter(Boolean),
                done_since_breakfast: (workPile.done_since_breakfast || []).map(pickWorkItem).filter(Boolean)
            },
            cake_log: log.map(pickLogEntry).filter(Boolean)
        };
    } catch (error) {
        console.error('[Menma] buildMenmaStatus error:', error);
        return {
            success: false,
            available: false,
            error: error.message
        };
    }
}

// ============================================================================
// Helper to get db from globalResources (for cakePantry integration)
// ============================================================================

function getMenmaDb(globalResources) {
    if (!globalResources || typeof globalResources.getTagDatabase !== 'function') {
        return null;
    }
    try {
        const tagDb = globalResources.getTagDatabase();
        return tagDb && tagDb.db ? tagDb.db : null;
    } catch (e) {
        return null;
    }
}

module.exports = {
    buildMenmaStatus,
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
    removeWorkItemFromDb,
    pickWorkItem,
    pickLogEntry,
    safeImageName
};
