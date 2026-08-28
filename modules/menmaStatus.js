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

function readJsonlTail(filePath, limit) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
        const slice = lines.slice(-Math.max(1, limit || LOG_TAIL));
        const out = [];
        for (const line of slice) {
            try {
                out.push(JSON.parse(line));
            } catch (_) {
                /* skip bad line */
            }
        }
        return out;
    } catch (_) {
        return [];
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

function buildMenmaStatus() {
    const state = readJsonFile(path.join(MENMA_DIR, 'state.json'), null);
    const pile = readJsonFile(path.join(MENMA_DIR, 'work-pile.json'), {
        open: [],
        done_since_breakfast: []
    });
    const log = readJsonlTail(path.join(MENMA_DIR, 'cake-log.jsonl'), LOG_TAIL)
        .map(pickLogEntry)
        .filter(Boolean);

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
        available: Boolean(state),
        character_name: state && state.character && state.character.name
            ? String(state.character.name)
            : 'Menma',
        current_kg: state ? state.current_kg : null,
        baseline_kg: state ? state.baseline_kg : null,
        slices_eaten_total: state ? state.slices_eaten_total : null,
        pending_slices: state ? state.pending_slices : 0,
        overtime_hours_total: state ? state.overtime_hours_total : 0,
        cake_type: (state && (state._cake_type || state.favorite_cake))
            || (lastLog && lastLog.cake_type)
            || null,
        favorite_cake: state ? state.favorite_cake : null,
        cake_ratings: state && state.cake_ratings ? state.cake_ratings : {},
        chair: (state && state.milestones && state.milestones.chair)
            || (lastLog && lastLog.chair)
            || null,
        last_before: safeImageName(state && state.last_before),
        last_after: safeImageName(state && state.last_after),
        last_look: safeImageName(state && state.last_look),
        last_meal: lastMeal,
        work_pile: {
            updated_at: pile.updated_at || null,
            last_breakfast_at: pile.last_breakfast_at || null,
            open: Array.isArray(pile.open) ? pile.open.map(pickWorkItem).filter(Boolean) : [],
            done_since_breakfast: Array.isArray(pile.done_since_breakfast)
                ? pile.done_since_breakfast.map(pickWorkItem).filter(Boolean)
                : []
        },
        cake_log: log
    };
}

function registerMenmaStatusRoutes(app, authMiddleware) {
    app.get('/menma/state', authMiddleware, (req, res) => {
        try {
            res.setHeader('Cache-Control', 'no-store');
            res.json(buildMenmaStatus());
        } catch (err) {
            console.error('GET /menma/state failed:', err && err.message);
            res.status(500).json({ success: false, error: 'Failed to load Menma state' });
        }
    });
}

module.exports = {
    buildMenmaStatus,
    registerMenmaStatusRoutes
};
