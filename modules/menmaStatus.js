'use strict';

/**
 * Cake Pantry SQLite Module
 * 
 * Reads AND writes cake pantry ledger data (state, cake-log, work-pile) from/to SQLite.
 * Accounts: menma, hoshino, ivory, pyra, chiyo
 * After import (cake_pantry_meta.imported_at set per account), ALL reads and writes use SQLite.
 * 
 * Tables in tag_wiki.db:
 * - cake_pantry_state: (account_id, key, value, updated_at)
 * - cake_pantry_log: cake consumption entries per account
 * - cake_pantry_work_pile: work items per account
 * - cake_pantry_meta: migration metadata (imported_at per account)
 * 
 * Legacy menma_* tables kept for backward compat but data migrates to unified tables.
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.join(__dirname, '..');
const IMAGE_NAME_RE = /^[A-Za-z0-9._-]+\.(png|webp|jpe?g)$/i;
const LOG_TAIL = 16;

// Account directories
const ACCOUNT_DIRS = {
    menma: '.menma',
    hoshino: '.hoshino',
    ivory: '.ivory',
    pyra: '.pyra',
    chiyo: '.chiyo'
};

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
 * Check if an account has been imported using cake_pantry_meta.imported_at
 */
async function isAccountImported(db, accountId) {
    try {
        const row = await db.get(
            "SELECT value FROM cake_pantry_meta WHERE account_id = ? AND key = 'imported_at'",
            [accountId]
        );
        return row != null && row.value != null;
    } catch (e) {
        return false;
    }
}

/**
 * Migrate legacy menma tables to unified tables (one-time)
 */
async function migrateLegacyMenmaTables(db) {
    try {
        // Check if legacy migration already done
        const legacyMigrated = await db.get(
            "SELECT value FROM cake_pantry_meta WHERE account_id = 'menma' AND key = 'legacy_migrated'"
        );
        if (legacyMigrated) return;

        // Check if legacy menma tables have data
        const legacyState = await db.get('SELECT COUNT(*) as count FROM menma_state');
        if (!legacyState || legacyState.count === 0) return;

        console.log('[CakePantry] Migrating legacy menma tables to unified tables...');
        const now = new Date().toISOString();

        await db.run('BEGIN TRANSACTION');
        try {
            // Migrate menma_state to cake_pantry_state
            const stateRows = await db.all('SELECT key, value, updated_at FROM menma_state');
            for (const row of stateRows) {
                await db.run(
                    'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                    ['menma', row.key, row.value, row.updated_at || now]
                );
            }

            // Migrate menma_cake_log to cake_pantry_log
            const logRows = await db.all('SELECT * FROM menma_cake_log');
            for (const row of logRows) {
                await db.run(`
                    INSERT INTO cake_pantry_log (account_id, at, loop, date_local, slices, stacks, cake_type, 
                        cake_rating, kg_before, kg_after, gained_kg, chair, named_for, before_img, after_img, 
                        landed, left_open, extra_data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, ['menma', row.at, row.loop, row.date_local, row.slices, row.stacks, row.cake_type,
                    row.cake_rating, row.kg_before, row.kg_after, row.gained_kg, row.chair, row.named_for,
                    row.before_img, row.after_img, row.landed, row.left_open, row.extra_data]);
            }

            // Migrate menma_work_pile to cake_pantry_work_pile
            const pileRows = await db.all('SELECT * FROM menma_work_pile');
            for (const row of pileRows) {
                await db.run(`
                    INSERT INTO cake_pantry_work_pile (account_id, type, work_id, source_from, added, done, 
                        summary, cake, slices_hint, extra_data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, ['menma', row.type, row.work_id, row.source_from, row.added, row.done,
                    row.summary, row.cake, row.slices_hint, row.extra_data]);
            }

            // Migrate menma_meta to cake_pantry_meta
            const metaRows = await db.all('SELECT key, value, updated_at FROM menma_meta');
            for (const row of metaRows) {
                await db.run(
                    'INSERT OR REPLACE INTO cake_pantry_meta (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                    ['menma', row.key, row.value, row.updated_at || now]
                );
            }

            // Mark legacy migration done
            await db.run(
                'INSERT OR REPLACE INTO cake_pantry_meta (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                ['menma', 'legacy_migrated', now, now]
            );

            await db.run('COMMIT');
            console.log('[CakePantry] Legacy menma tables migrated.');
        } catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('[CakePantry] Legacy migration failed:', error);
    }
}

/**
 * Transactional, idempotent one-shot import from account directory files to SQLite.
 * Uses cake_pantry_meta.imported_at as gate per account.
 */
async function runAccountImportIfNeeded(db, accountId) {
    try {
        if (await isAccountImported(db, accountId)) {
            return;
        }

        const dir = ACCOUNT_DIRS[accountId];
        if (!dir) return;
        const accountDir = path.join(WORKSPACE_ROOT, dir);
        
        // Check if directory exists
        if (!fs.existsSync(accountDir)) {
            return;
        }

        console.log(`[CakePantry] Running one-shot import for ${accountId} from ${dir}/ to tag_wiki.db...`);
        const now = new Date().toISOString();

        await db.run('BEGIN TRANSACTION');

        try {
            // 1. Import state.json
            const statePath = path.join(accountDir, 'state.json');
            if (fs.existsSync(statePath)) {
                const state = readJsonFile(statePath, null);
                if (state) {
                    for (const [key, value] of Object.entries(state)) {
                        await db.run(
                            'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                            [accountId, key, JSON.stringify(value), now]
                        );
                    }
                }
            }

            // 2. Import work-pile.json
            const pilePath = path.join(accountDir, 'work-pile.json');
            if (fs.existsSync(pilePath)) {
                const pile = readJsonFile(pilePath, null);
                if (pile) {
                    if (pile.updated_at) {
                        await db.run(
                            'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                            [accountId, 'work_pile_updated_at', JSON.stringify(pile.updated_at), now]
                        );
                    }
                    if (pile.last_breakfast_at) {
                        await db.run(
                            'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                            [accountId, 'work_pile_last_breakfast_at', JSON.stringify(pile.last_breakfast_at), now]
                        );
                    }
                    if (pile.rule) {
                        await db.run(
                            'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                            [accountId, 'work_pile_rule', JSON.stringify(pile.rule), now]
                        );
                    }
                    if (pile.cake_note) {
                        await db.run(
                            'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                            [accountId, 'work_pile_cake_note', JSON.stringify(pile.cake_note), now]
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
                            INSERT INTO cake_pantry_work_pile (account_id, type, work_id, source_from, added, done, summary, cake, slices_hint, extra_data)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [accountId, type, picked.id, picked.from, picked.added, picked.done,
                            picked.summary, picked.cake, picked.slices_hint, JSON.stringify(extraData)]);
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
            }

            // 3. Import cake-log.jsonl (idempotent: check 'at' + 'slices' uniqueness)
            const cakeLogPath = path.join(accountDir, 'cake-log.jsonl');
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
                            'SELECT id FROM cake_pantry_log WHERE account_id = ? AND at = ? AND slices = ?',
                            [accountId, picked.at, picked.slices]
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
                            INSERT INTO cake_pantry_log (account_id, at, loop, date_local, slices, stacks, cake_type, cake_rating,
                                kg_before, kg_after, gained_kg, chair, named_for, before_img, after_img,
                                landed, left_open, extra_data)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `, [accountId, picked.at, picked.loop, picked.date_local, picked.slices, picked.stacks,
                            picked.cake_type, picked.cake_rating, picked.kg_before, picked.kg_after,
                            picked.gained_kg, picked.chair, JSON.stringify(picked.named_for),
                            picked.before, picked.after, JSON.stringify(picked.landed),
                            JSON.stringify(picked.left_open), JSON.stringify(extraData)]);
                    } catch (e) {
                        console.error(`[CakePantry] Error importing cake log line for ${accountId}:`, e);
                    }
                }
            }

            // 4. Set imported_at flag
            await db.run(
                'INSERT OR REPLACE INTO cake_pantry_meta (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                [accountId, 'imported_at', now, now]
            );

            await db.run('COMMIT');
            console.log(`[CakePantry] Import complete for ${accountId}.`);
        } catch (error) {
            await db.run('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error(`[CakePantry] Import failed for ${accountId}:`, error);
        throw error;
    }
}

/**
 * Ensure migration runs for an account (call before any operation)
 */
async function ensureAccountMigration(db, accountId) {
    await migrateLegacyMenmaTables(db);
    await runAccountImportIfNeeded(db, accountId);
}

// ============================================================================
// SQLite Reader/Writer Functions (unified for all accounts)
// ============================================================================

/**
 * Get account state from SQLite
 */
async function getAccountStateFromDb(db, accountId) {
    const stateRows = await db.all(
        'SELECT key, value FROM cake_pantry_state WHERE account_id = ?',
        [accountId]
    );
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
 * Save account state to SQLite
 */
async function saveAccountStateToDb(db, accountId, state) {
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(state)) {
        await db.run(
            'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
            [accountId, key, JSON.stringify(value), now]
        );
    }
    return true;
}

/**
 * Append cake log entry to SQLite
 */
async function appendCakeLogToDb(db, accountId, entry) {
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
        INSERT INTO cake_pantry_log (account_id, at, loop, date_local, slices, stacks, cake_type, cake_rating,
            kg_before, kg_after, gained_kg, chair, named_for, before_img, after_img,
            landed, left_open, extra_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [accountId, picked.at, picked.loop, picked.date_local, picked.slices, picked.stacks,
        picked.cake_type, picked.cake_rating, picked.kg_before, picked.kg_after,
        picked.gained_kg, picked.chair, JSON.stringify(picked.named_for),
        picked.before, picked.after, JSON.stringify(picked.landed),
        JSON.stringify(picked.left_open), JSON.stringify(extraData)]);
    return true;
}

/**
 * Get cake log from SQLite
 */
async function getCakeLogFromDb(db, accountId, limit = 50) {
    const rows = await db.all(`
        SELECT * FROM cake_pantry_log
        WHERE account_id = ?
        ORDER BY id DESC
        LIMIT ?
    `, [accountId, limit]);

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
 * Check if account state exists in SQLite
 */
async function hasAccountStateInDb(db, accountId) {
    try {
        const row = await db.get(
            "SELECT COUNT(*) as count FROM cake_pantry_state WHERE account_id = ? AND key = 'current_kg'",
            [accountId]
        );
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
async function getWorkPileFromDb(db, accountId) {
    const stateRows = await db.all(
        "SELECT key, value FROM cake_pantry_state WHERE account_id = ? AND key LIKE 'work_pile_%'",
        [accountId]
    );
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

    const workPileRows = await db.all(
        'SELECT * FROM cake_pantry_work_pile WHERE account_id = ? ORDER BY id ASC',
        [accountId]
    );
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
 * Save work pile to SQLite (replaces all items for account)
 */
async function saveWorkPileToDb(db, accountId, pile) {
    const now = new Date().toISOString();

    await db.run('BEGIN TRANSACTION');
    try {
        // Clear existing work pile items for this account
        await db.run('DELETE FROM cake_pantry_work_pile WHERE account_id = ?', [accountId]);

        // Save metadata to cake_pantry_state
        if (pile.updated_at !== undefined) {
            await db.run(
                'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                [accountId, 'work_pile_updated_at', JSON.stringify(pile.updated_at || now), now]
            );
        }
        if (pile.last_breakfast_at !== undefined) {
            await db.run(
                'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                [accountId, 'work_pile_last_breakfast_at', JSON.stringify(pile.last_breakfast_at), now]
            );
        }
        if (pile.rule !== undefined) {
            await db.run(
                'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                [accountId, 'work_pile_rule', JSON.stringify(pile.rule), now]
            );
        }
        if (pile.cake_note !== undefined) {
            await db.run(
                'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
                [accountId, 'work_pile_cake_note', JSON.stringify(pile.cake_note), now]
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
                INSERT INTO cake_pantry_work_pile (account_id, type, work_id, source_from, added, done, summary, cake, slices_hint, extra_data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [accountId, type, picked.id, picked.from, picked.added, picked.done,
                picked.summary, picked.cake, picked.slices_hint, JSON.stringify(extraData)]);
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
async function addWorkItemToDb(db, accountId, item, type = 'open') {
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
        INSERT INTO cake_pantry_work_pile (account_id, type, work_id, source_from, added, done, summary, cake, slices_hint, extra_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [accountId, type, picked.id, picked.from, picked.added || new Date().toISOString(),
        picked.done, picked.summary, picked.cake, picked.slices_hint, JSON.stringify(extraData)]);

    // Update work_pile_updated_at
    const now = new Date().toISOString();
    await db.run(
        'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
        [accountId, 'work_pile_updated_at', JSON.stringify(now), now]
    );

    return true;
}

/**
 * Move work item from open to done_since_breakfast
 */
async function completeWorkItemInDb(db, accountId, workId) {
    const now = new Date().toISOString();
    
    const result = await db.run(
        "UPDATE cake_pantry_work_pile SET type = 'done_since_breakfast', done = ? WHERE account_id = ? AND work_id = ? AND type = 'open'",
        [now, accountId, workId]
    );

    if (result.changes > 0) {
        await db.run(
            'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
            [accountId, 'work_pile_updated_at', JSON.stringify(now), now]
        );
        return true;
    }
    return false;
}

/**
 * Remove work item from pile
 */
async function removeWorkItemFromDb(db, accountId, workId) {
    const now = new Date().toISOString();
    
    const result = await db.run(
        'DELETE FROM cake_pantry_work_pile WHERE account_id = ? AND work_id = ?',
        [accountId, workId]
    );

    if (result.changes > 0) {
        await db.run(
            'INSERT OR REPLACE INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
            [accountId, 'work_pile_updated_at', JSON.stringify(now), now]
        );
        return true;
    }
    return false;
}

// ============================================================================
// buildMenmaStatus (backward compat - reads from unified tables)
// ============================================================================

async function buildMenmaStatus(globalResources) {
    return buildAccountStatus(globalResources, 'menma');
}

/**
 * Build status for any account (unified)
 */
async function buildAccountStatus(globalResources, accountId) {
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
        await ensureAccountMigration(db, accountId);
    } catch (e) {
        console.error(`[CakePantry] buildAccountStatus migration error for ${accountId}:`, e);
    }

    try {
        const state = await getAccountStateFromDb(db, accountId);
        const workPile = await getWorkPileFromDb(db, accountId);
        const log = await getCakeLogFromDb(db, accountId, LOG_TAIL);

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
            account_id: accountId,
            character_name: hasState && state.character && state.character.name
                ? String(state.character.name)
                : accountId.charAt(0).toUpperCase() + accountId.slice(1),
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
        console.error(`[CakePantry] buildAccountStatus error for ${accountId}:`, error);
        return {
            success: false,
            available: false,
            error: error.message
        };
    }
}

// ============================================================================
// Helper to get db from globalResources
// ============================================================================

function getCakePantryDb(globalResources) {
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

// Backward compat alias
const getMenmaDb = getCakePantryDb;

module.exports = {
    ACCOUNT_DIRS,
    buildMenmaStatus,
    buildAccountStatus,
    getCakePantryDb,
    getMenmaDb,
    isAccountImported,
    ensureAccountMigration,
    runAccountImportIfNeeded,
    migrateLegacyMenmaTables,
    getAccountStateFromDb,
    saveAccountStateToDb,
    appendCakeLogToDb,
    getCakeLogFromDb,
    hasAccountStateInDb,
    getWorkPileFromDb,
    saveWorkPileToDb,
    addWorkItemToDb,
    completeWorkItemInDb,
    removeWorkItemFromDb,
    pickWorkItem,
    pickLogEntry,
    safeImageName
};
