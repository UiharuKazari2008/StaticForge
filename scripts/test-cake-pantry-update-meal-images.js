#!/usr/bin/env node
'use strict';

/**
 * update_meal_images + inspect_pantry meal_id (Yozora #277).
 * Proves image re-point + image_history, frozen kg/slices/timestamps/totals,
 * unknown id rejection, and that no delete/scrap paths run.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const cakePantry = require('../modules/cakePantry');
const {
    setGlobalResources,
    inspectPantry,
    updateMealImages,
    deriveMealId,
    attachMealId,
    _test
} = cakePantry;
const { composeCakeLogEntry, findCakeLogRowByMealId } = require('../modules/menmaStatus');
const { _test: facadeTest } = require('../modules/mcpAgentFacade');

const OLD_BEFORE = '1788887354858_generated_2779763718.png';
const OLD_AFTER = '1788887375993_generated_2137548186.png';
const NEW_BEFORE = '1789000000001_generated_1111111111.png';
const NEW_AFTER = '1789000000002_generated_2222222222.png';
const NOW = '2026-10-02T20:00:00.000Z';

// --- pure helpers (no live pantry) ---

const noIdMeal = {
    at: '2026-09-12T23:41:26.375Z',
    loop: 'pantry-7:30pm',
    date_local: '2026-09-12',
    slices: 8,
    stacks: 1,
    cake_type: 'strawberry shortcake',
    kg_before: 54,
    kg_after: 54.96,
    gained_kg: 0.96,
    pending_slices_after: 4,
    slices_requested: 8,
    before: OLD_BEFORE,
    after: OLD_AFTER,
    visual_gen_status: 'provided'
};

const derivedA = deriveMealId('ivory', noIdMeal);
const derivedB = deriveMealId('ivory', { ...noIdMeal, before: NEW_BEFORE, after: NEW_AFTER });
assert.strictEqual(derivedA, derivedB, 'meal_id must not depend on image ids');
assert.ok(derivedA.startsWith('meal_ivory_'));
const attached = attachMealId('ivory', noIdMeal);
assert.strictEqual(attached.meal_id, derivedA);
assert.strictEqual(noIdMeal.meal_id, undefined, 'attachMealId must not mutate the original');
assert.strictEqual(JSON.stringify(_test.frozenMealLedger(attached)), JSON.stringify(_test.frozenMealLedger(noIdMeal)));

const applied = _test.applyMealImageUpdate(attachMealId('ivory', noIdMeal), {
    before: NEW_BEFORE,
    after: NEW_AFTER,
    now: NOW,
    client: 'grok.menma'
});
assert.ok(applied.ok);
assert.strictEqual(
    JSON.stringify(applied.frozen_before),
    JSON.stringify(applied.frozen_after),
    'kg / slices / timestamps must be byte-identical after apply'
);
assert.strictEqual(applied.meal.slices, 8);
assert.strictEqual(applied.meal.kg_before, 54);
assert.strictEqual(applied.meal.kg_after, 54.96);
assert.strictEqual(applied.meal.at, noIdMeal.at);
assert.strictEqual(applied.meal.before, NEW_BEFORE);
assert.strictEqual(applied.meal.after, NEW_AFTER);
assert.strictEqual(applied.meal.image_history.length, 1);
assert.deepStrictEqual(applied.meal.image_history[0], {
    old_before: OLD_BEFORE,
    old_after: OLD_AFTER,
    new_before: NEW_BEFORE,
    new_after: NEW_AFTER,
    at: NOW,
    client: 'grok.menma'
});

const unknownImg = _test.resolvePantryImageId('missing_generated_0.png', () => null);
assert.strictEqual(unknownImg.ok, false);
assert.ok(unknownImg.error.includes('Unknown image id'));

const pantrySrc = fs.readFileSync(require.resolve('../modules/cakePantry.js'), 'utf8');
assert.ok(!/delete_images/.test(pantrySrc), 'cakePantry must not call delete_images');
assert.ok(!/scrap_images/.test(pantrySrc), 'cakePantry must not call scrap_images');
assert.ok(!/\bunlink(Sync)?\b/.test(pantrySrc), 'cakePantry must not unlink files');

const updateDef = facadeTest.TOOL_DEFS.find((t) => t.name === 'update_meal_images');
assert.ok(updateDef, 'update_meal_images TOOL_DEF missing');
assert.strictEqual(facadeTest.TOOL_RATE_GROUPS.update_meal_images, 'write');
assert.ok(facadeTest.listToolsForScopes(['sfapp_cake_pantry:consume'], null).some((t) => t.name === 'update_meal_images'));
assert.ok(!facadeTest.listToolsForScopes(['sfapp_cake_pantry:inspect'], null).some((t) => t.name === 'update_meal_images'));

const inspectDef = facadeTest.TOOL_DEFS.find((t) => t.name === 'inspect_pantry');
assert.ok(inspectDef);

// --- sqlite integration (isolated in-memory db; no live pantry files) ---

async function withPantryFixture(run) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cake-pantry-277-'));
    const imagesDir = path.join(tmp, 'images');
    fs.mkdirSync(imagesDir);
    for (const name of [OLD_BEFORE, OLD_AFTER, NEW_BEFORE, NEW_AFTER]) {
        fs.writeFileSync(path.join(imagesDir, name), 'png');
    }

    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE cake_pantry_meta (
            account_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT,
            PRIMARY KEY (account_id, key)
        );
        CREATE TABLE cake_pantry_state (
            account_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT,
            PRIMARY KEY (account_id, key)
        );
        CREATE TABLE cake_pantry_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT NOT NULL,
            at TEXT,
            loop TEXT,
            date_local TEXT,
            slices INTEGER,
            stacks INTEGER,
            cake_type TEXT,
            cake_rating REAL,
            kg_before REAL,
            kg_after REAL,
            gained_kg REAL,
            chair TEXT,
            named_for TEXT,
            before_img TEXT,
            after_img TEXT,
            landed TEXT,
            left_open TEXT,
            extra_data TEXT
        );
        CREATE TABLE cake_pantry_work_pile (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT NOT NULL,
            type TEXT NOT NULL,
            work_id TEXT NOT NULL,
            source_from TEXT,
            added TEXT,
            done TEXT,
            summary TEXT,
            cake TEXT,
            slices_hint INTEGER,
            extra_data TEXT
        );
    `);

    const stamp = '2026-09-12T23:41:26.375Z';
    await db.run(
        "INSERT INTO cake_pantry_meta (account_id, key, value, updated_at) VALUES ('menma', 'legacy_migrated', ?, ?)",
        [stamp, stamp]
    );
    await db.run(
        "INSERT INTO cake_pantry_meta (account_id, key, value, updated_at) VALUES ('ivory', 'imported_at', ?, ?)",
        [stamp, stamp]
    );

    const stateRows = {
        character: { name: 'Ivory', locked: false },
        baseline_kg: 54,
        current_kg: 54.96,
        slices_eaten_total: 8,
        pending_slices: 4,
        pending_deliveries: [],
        pending_feeds: [],
        history: [{
            at: stamp,
            slices: 8,
            gained_kg: 0.96,
            kg: 54.96,
            before: OLD_BEFORE,
            after: OLD_AFTER
        }],
        last_before: OLD_BEFORE,
        last_after: OLD_AFTER
    };
    for (const [key, value] of Object.entries(stateRows)) {
        await db.run(
            'INSERT INTO cake_pantry_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
            ['ivory', key, JSON.stringify(value), stamp]
        );
    }

    const inserted = await db.run(`
        INSERT INTO cake_pantry_log (
            account_id, at, loop, date_local, slices, stacks, cake_type, cake_rating,
            kg_before, kg_after, gained_kg, chair, named_for, before_img, after_img,
            landed, left_open, extra_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        'ivory', stamp, 'pantry-7:30pm', '2026-09-12', 8, 1, 'strawberry shortcake', null,
        54, 54.96, 0.96, null, JSON.stringify(['first pantry plate']),
        OLD_BEFORE, OLD_AFTER, '[]', '[]',
        JSON.stringify({ visual_gen_status: 'provided', landscape: false, pending_slices_after: 4 })
    ]);
    const mealId = String(inserted.lastID);

    const deleteHits = [];
    const restoreFs = ['unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync'].map((name) => {
        const orig = fs[name];
        if (typeof orig !== 'function') return () => {};
        fs[name] = (...args) => {
            deleteHits.push({ name, args });
            return orig.apply(fs, args);
        };
        return () => { fs[name] = orig; };
    });

    setGlobalResources({
        getTagDatabase: () => ({ db }),
        getPath: (kind) => (kind === 'images' ? imagesDir : tmp)
    });

    try {
        await run({ db, mealId, stamp, imagesDir, deleteHits, tmp });
    } finally {
        restoreFs.forEach((fn) => fn());
        setGlobalResources(null);
        await db.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function snapshotState(rows) {
    return JSON.stringify(rows.map((r) => ({ key: r.key, value: r.value })).sort((a, b) => a.key.localeCompare(b.key)));
}

function snapshotFrozenLogRow(row) {
    return JSON.stringify({
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
        named_for: row.named_for,
        landed: row.landed,
        left_open: row.left_open
    });
}

(async () => {
    await withPantryFixture(async ({ db, mealId, stamp, deleteHits }) => {
        const inspected = await inspectPantry('ivory', { log_limit: 20 });
        assert.strictEqual(inspected.success, true);
        assert.ok(Array.isArray(inspected.past_consumes));
        assert.ok(inspected.past_consumes.length >= 1, 'inspect_pantry should list the meal');
        for (const meal of inspected.past_consumes) {
            assert.ok(meal.meal_id, 'inspect_pantry must return meal_id for each meal');
        }
        assert.strictEqual(inspected.past_consumes[0].meal_id, mealId);

        const again = await inspectPantry('ivory', { log_limit: 20 });
        assert.strictEqual(again.past_consumes[0].meal_id, mealId, 'meal_id must be stable');

        const missingMeal = await updateMealImages('ivory', {
            meal_id: '999999',
            before_image: NEW_BEFORE
        }, { now: NOW, client: 'grok.menma' });
        assert.strictEqual(missingMeal.success, false);
        assert.ok(String(missingMeal.error).includes('Unknown meal_id'));

        const missingImage = await updateMealImages('ivory', {
            meal_id: mealId,
            before_image: 'no-such-generated-0.png'
        }, { now: NOW, client: 'grok.menma' });
        assert.strictEqual(missingImage.success, false);
        assert.ok(String(missingImage.error).includes('Unknown image id'));

        const neither = await updateMealImages('ivory', { meal_id: mealId }, { now: NOW });
        assert.strictEqual(neither.success, false);
        assert.ok(String(neither.error).includes('before_image') || String(neither.error).includes('after_image'));

        const stateBefore = snapshotState(await db.all(
            "SELECT key, value FROM cake_pantry_state WHERE account_id = 'ivory'"
        ));
        const logBefore = await db.get('SELECT * FROM cake_pantry_log WHERE id = ?', [Number(mealId)]);
        const frozenBefore = snapshotFrozenLogRow(logBefore);
        const extraBefore = JSON.parse(logBefore.extra_data || '{}');
        delete extraBefore.image_history;
        delete extraBefore.meal_id;

        const updated = await updateMealImages('ivory', {
            meal_id: mealId,
            before_image: NEW_BEFORE,
            after_image: NEW_AFTER,
            client: 'grok.menma'
        }, { now: NOW });
        assert.strictEqual(updated.success, true, updated.error);
        assert.strictEqual(updated.meal_id, mealId);
        assert.strictEqual(updated.before_image, NEW_BEFORE);
        assert.strictEqual(updated.after_image, NEW_AFTER);
        assert.strictEqual(updated.image_history.length, 1);
        assert.deepStrictEqual(updated.image_history[0], {
            old_before: OLD_BEFORE,
            old_after: OLD_AFTER,
            new_before: NEW_BEFORE,
            new_after: NEW_AFTER,
            at: NOW,
            client: 'grok.menma'
        });

        const logAfter = await db.get('SELECT * FROM cake_pantry_log WHERE id = ?', [Number(mealId)]);
        assert.strictEqual(snapshotFrozenLogRow(logAfter), frozenBefore, 'log kg/slices/timestamps must be byte-identical');
        assert.strictEqual(logAfter.before_img, NEW_BEFORE);
        assert.strictEqual(logAfter.after_img, NEW_AFTER);
        const extraAfter = JSON.parse(logAfter.extra_data || '{}');
        assert.deepStrictEqual(extraAfter.image_history, updated.image_history);
        const extraAfterCore = { ...extraAfter };
        delete extraAfterCore.image_history;
        delete extraAfterCore.meal_id;
        assert.strictEqual(JSON.stringify(extraAfterCore), JSON.stringify(extraBefore), 'extra_data besides history/meal_id unchanged');

        const stateAfter = snapshotState(await db.all(
            "SELECT key, value FROM cake_pantry_state WHERE account_id = 'ivory'"
        ));
        assert.strictEqual(stateAfter, stateBefore, 'account totals/state must be byte-identical');

        const composed = composeCakeLogEntry(logAfter);
        assert.strictEqual(composed.meal_id, mealId);
        assert.strictEqual(composed.kg_before, 54);
        assert.strictEqual(composed.kg_after, 54.96);
        assert.strictEqual(composed.slices, 8);
        assert.strictEqual(composed.at, stamp);

        const found = await findCakeLogRowByMealId(db, 'ivory', mealId);
        assert.ok(found);
        assert.strictEqual(String(found.id), mealId);

        assert.deepStrictEqual(deleteHits, [], 'update_meal_images must not delete/unlink/rm anything');

        const inspectedAfter = await inspectPantry('ivory', { log_limit: 20 });
        assert.strictEqual(inspectedAfter.past_consumes[0].meal_id, mealId);
        assert.strictEqual(inspectedAfter.past_consumes[0].before, NEW_BEFORE);
        assert.strictEqual(inspectedAfter.past_consumes[0].after, NEW_AFTER);
        assert.strictEqual(inspectedAfter.current_kg, 54.96);
        assert.strictEqual(inspectedAfter.slices_eaten_total, 8);
        assert.strictEqual(inspectedAfter.pending.slices, 4);
    });

    console.log('test-cake-pantry-update-meal-images: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
