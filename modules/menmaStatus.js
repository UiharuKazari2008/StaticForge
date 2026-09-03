'use strict';

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

async function runMigrationIfNeeded(db) {
    try {
        const hasData = await db.get('SELECT COUNT(*) as count FROM menma_state');
        if (hasData && hasData.count > 0) return; // Already migrated

        console.log('[Menma] Running one-shot migration from .menma/ to tag_wiki.db...');

        // 1. Migrate State
        const state = readJsonFile(path.join(MENMA_DIR, 'state.json'), null);
        if (state) {
            for (const [key, value] of Object.entries(state)) {
                await db.run('INSERT INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)', [
                    key,
                    JSON.stringify(value),
                    new Date().toISOString()
                ]);
            }
        }

        // 2. Migrate Work Pile
        const pile = readJsonFile(path.join(MENMA_DIR, 'work-pile.json'), null);
        if (pile) {
            if (pile.updated_at) {
                await db.run('INSERT INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)', [
                    'work_pile_updated_at',
                    JSON.stringify(pile.updated_at),
                    new Date().toISOString()
                ]);
            }
            if (pile.last_breakfast_at) {
                await db.run('INSERT INTO menma_state (key, value, updated_at) VALUES (?, ?, ?)', [
                    'work_pile_last_breakfast_at',
                    JSON.stringify(pile.last_breakfast_at),
                    new Date().toISOString()
                ]);
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
        }

        // 3. Migrate Cake Log
        const cakeLogPath = path.join(MENMA_DIR, 'cake-log.jsonl');
        if (fs.existsSync(cakeLogPath)) {
            const raw = fs.readFileSync(cakeLogPath, 'utf8');
            const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
            for (const line of lines) {
                try {
                    const item = JSON.parse(line);
                    const picked = pickLogEntry(item);
                    if (!picked) continue;

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

        console.log('[Menma] Migration complete.');
    } catch (error) {
        console.error('[Menma] Migration failed:', error);
    }
}

async function buildMenmaStatus(globalResources) {
    if (!globalResources || typeof globalResources.getTagDatabase !== 'function') {
        throw new Error('globalResources missing or invalid in buildMenmaStatus');
    }

    const tagDb = globalResources.getTagDatabase();
    if (!tagDb || !tagDb.db) {
        throw new Error('tag_wiki.db not available');
    }
    const db = tagDb.db;

    await runMigrationIfNeeded(db);

    const stateRows = await db.all('SELECT key, value FROM menma_state');
    const state = {};
    let workPileUpdatedAt = null;
    let workPileLastBreakfastAt = null;

    for (const row of stateRows) {
        try {
            if (row.key === 'work_pile_updated_at') {
                workPileUpdatedAt = JSON.parse(row.value);
            } else if (row.key === 'work_pile_last_breakfast_at') {
                workPileLastBreakfastAt = JSON.parse(row.value);
            } else {
                state[row.key] = JSON.parse(row.value);
            }
        } catch (e) {
            // ignore JSON parse errors
        }
    }

    const workPileRows = await db.all('SELECT * FROM menma_work_pile ORDER BY id ASC');
    const openPile = [];
    const doneSinceBreakfast = [];

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
            openPile.push(pickWorkItem(item));
        } else if (row.type === 'done_since_breakfast') {
            doneSinceBreakfast.push(pickWorkItem(item));
        }
    }

    const logRows = await db.all(`
        SELECT * FROM menma_cake_log
        ORDER BY id DESC
        LIMIT ?
    `, [LOG_TAIL]);

    // reverse to match the original tail output order (oldest first in the slice)
    logRows.reverse();

    const log = logRows.map(row => {
        let named_for = [];
        let landed = [];
        let left_open = [];
        let extra = {};
        try { named_for = JSON.parse(row.named_for || '[]'); } catch (e) {}
        try { landed = JSON.parse(row.landed || '[]'); } catch (e) {}
        try { left_open = JSON.parse(row.left_open || '[]'); } catch (e) {}
        try { extra = JSON.parse(row.extra_data || '{}'); } catch (e) {}

        const entry = {
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
        return pickLogEntry(entry);
    }).filter(Boolean);

    const lastLog = log.length ? log[log.length - 1] : null;
    const history = Array.isArray(state && state.history) ? state.history : [];
    const lastHistory = history.length ? history[history.length - 1] : null;

    let lastMeal = lastLog;
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

    return {
        success: true,
        updated_at: new Date().toISOString(),
        available: Object.keys(state).length > 0,
        character_name: state && state.character && state.character.name
            ? String(state.character.name)
            : 'Menma',
        current_kg: Object.keys(state).length > 0 ? state.current_kg : null,
        baseline_kg: Object.keys(state).length > 0 ? state.baseline_kg : null,
        slices_eaten_total: Object.keys(state).length > 0 ? state.slices_eaten_total : null,
        pending_slices: Object.keys(state).length > 0 ? state.pending_slices : 0,
        overtime_hours_total: Object.keys(state).length > 0 ? state.overtime_hours_total : 0,
        cake_type: (Object.keys(state).length > 0 && (state._cake_type || state.favorite_cake))
            || (lastLog && lastLog.cake_type)
            || null,
        favorite_cake: Object.keys(state).length > 0 ? state.favorite_cake : null,
        cake_ratings: Object.keys(state).length > 0 && state.cake_ratings ? state.cake_ratings : {},
        chair: (Object.keys(state).length > 0 && state.milestones && state.milestones.chair)
            || (lastLog && lastLog.chair)
            || null,
        last_before: safeImageName(Object.keys(state).length > 0 && state.last_before),
        last_after: safeImageName(Object.keys(state).length > 0 && state.last_after),
        last_look: safeImageName(Object.keys(state).length > 0 && state.last_look),
        last_meal: lastMeal,
        work_pile: {
            updated_at: workPileUpdatedAt || null,
            last_breakfast_at: workPileLastBreakfastAt || null,
            open: openPile.filter(Boolean),
            done_since_breakfast: doneSinceBreakfast.filter(Boolean)
        },
        cake_log: log
    };
}

module.exports = {
    buildMenmaStatus
};
