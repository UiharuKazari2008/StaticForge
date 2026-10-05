#!/usr/bin/env node
'use strict';

/**
 * update_meal_images + inspect_pantry meal_id (Yozora #277).
 * Proves image re-point + image_history, frozen kg/slices/timestamps/totals,
 * unknown id rejection, and that no delete/scrap paths run.
 * Isolated fixture — does not touch live pantry SQLite or account files.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    inspectPantry,
    updateMealImages,
    deriveMealId,
    attachMealId,
    _test
} = require('../modules/cakePantry');
const {
    composeCakeLogEntry,
    findCakeLogRowByMealId,
    updateCakeLogImagesToDb
} = require('../modules/menmaStatus');

const OLD_BEFORE = '1788887354858_generated_2779763718.png';
const OLD_AFTER = '1788887375993_generated_2137548186.png';
const NEW_BEFORE = '1789000000001_generated_1111111111.png';
const NEW_AFTER = '1789000000002_generated_2222222222.png';
const NOW = '2026-10-02T20:00:00.000Z';
const STAMP = '2026-09-12T23:41:26.375Z';

const noIdMeal = {
    at: STAMP,
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
assert.strictEqual(
    JSON.stringify(_test.frozenMealLedger(attached)),
    JSON.stringify(_test.frozenMealLedger(noIdMeal))
);

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
assert.strictEqual(applied.meal.at, STAMP);
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

(async () => {
    const inspectState = {
        character: { name: 'Ivory' },
        current_kg: 54.96,
        baseline_kg: 54,
        slices_eaten_total: 8,
        pending_slices: 4,
        pending_deliveries: [],
        pending_feeds: [],
        history: [{ at: STAMP, kg: 54.96, slices: 8, gained_kg: 0.96 }],
        last_before: OLD_BEFORE,
        last_after: OLD_AFTER
    };
    const first = await inspectPantry('ivory', { log_limit: 20 }, {
        state: inspectState,
        cakeLog: [noIdMeal]
    });
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.past_consumes.length, 1);
    assert.ok(first.past_consumes[0].meal_id, 'inspect_pantry must return meal_id for each meal');
    assert.strictEqual(first.past_consumes[0].meal_id, derivedA);
    const second = await inspectPantry('ivory', { log_limit: 20 }, {
        state: inspectState,
        cakeLog: [noIdMeal]
    });
    assert.strictEqual(second.past_consumes[0].meal_id, first.past_consumes[0].meal_id);

    const row = {
        id: 17,
        account_id: 'ivory',
        at: STAMP,
        loop: 'pantry-7:30pm',
        date_local: '2026-09-12',
        slices: 8,
        stacks: 1,
        cake_type: 'strawberry shortcake',
        cake_rating: null,
        kg_before: 54,
        kg_after: 54.96,
        gained_kg: 0.96,
        chair: null,
        named_for: '["first pantry plate"]',
        before_img: OLD_BEFORE,
        after_img: OLD_AFTER,
        landed: '[]',
        left_open: '[]',
        extra_data: JSON.stringify({
            visual_gen_status: 'provided',
            landscape: false,
            pending_slices_after: 4
        })
    };
    const composed = composeCakeLogEntry(row);
    assert.strictEqual(composed.meal_id, '17');
    assert.strictEqual(composed.before, OLD_BEFORE);
    assert.strictEqual(composed.after, OLD_AFTER);

    const fakeDb = createFakePantryDb(row);
    const found = await findCakeLogRowByMealId(fakeDb, 'ivory', '17');
    assert.ok(found);
    assert.strictEqual(found.id, 17);

    const known = new Set([OLD_BEFORE, OLD_AFTER, NEW_BEFORE, NEW_AFTER]);
    const resolveImage = (id) => (known.has(id) ? id : null);

    const missingMeal = await updateMealImages('ivory', {
        meal_id: '999999',
        before_image: NEW_BEFORE
    }, {
        now: NOW,
        client: 'grok.menma',
        resolveImage,
        importStatus: { imported: true, db: fakeDb }
    });
    assert.strictEqual(missingMeal.success, false);
    assert.ok(String(missingMeal.error).includes('Unknown meal_id'));

    const missingImage = await updateMealImages('ivory', {
        meal_id: '17',
        before_image: 'no-such-generated-0.png'
    }, {
        now: NOW,
        resolveImage,
        importStatus: { imported: true, db: fakeDb }
    });
    assert.strictEqual(missingImage.success, false);
    assert.ok(String(missingImage.error).includes('Unknown image id'));

    const neither = await updateMealImages('ivory', { meal_id: '17' }, {
        now: NOW,
        resolveImage,
        importStatus: { imported: true, db: fakeDb }
    });
    assert.strictEqual(neither.success, false);
    assert.ok(String(neither.error).includes('before_image') || String(neither.error).includes('after_image'));

    const frozenBefore = snapshotFrozenLogRow(cloneRow(row));
    const extraBefore = JSON.parse(row.extra_data);
    const stateBefore = JSON.stringify(inspectState);

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

    let updated;
    try {
        updated = await updateMealImages('ivory', {
            meal_id: '17',
            before_image: NEW_BEFORE,
            after_image: NEW_AFTER,
            client: 'grok.menma'
        }, {
            now: NOW,
            resolveImage,
            importStatus: { imported: true, db: fakeDb }
        });
    } finally {
        restoreFs.forEach((fn) => fn());
    }

    assert.strictEqual(updated.success, true, updated.error);
    assert.strictEqual(updated.meal_id, '17');
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

    const logAfter = fakeDb.rows[0];
    assert.strictEqual(snapshotFrozenLogRow(logAfter), frozenBefore, 'log kg/slices/timestamps must be byte-identical');
    assert.strictEqual(logAfter.before_img, NEW_BEFORE);
    assert.strictEqual(logAfter.after_img, NEW_AFTER);
    const extraAfter = JSON.parse(logAfter.extra_data);
    assert.deepStrictEqual(extraAfter.image_history, updated.image_history);
    const extraAfterCore = { ...extraAfter };
    delete extraAfterCore.image_history;
    delete extraAfterCore.meal_id;
    assert.strictEqual(JSON.stringify(extraAfterCore), JSON.stringify(extraBefore));

    assert.strictEqual(JSON.stringify(inspectState), stateBefore, 'account totals/state must be byte-identical');
    assert.ok(fakeDb.updates.length >= 1);
    for (const u of fakeDb.updates) {
        if (/INSERT OR REPLACE INTO cake_pantry_state/.test(u.sql)) {
            // denormalized last-pair refresh: only last_before / last_after keys
            assert.ok(['last_before', 'last_after'].includes(u.params[1]), `unexpected state key ${u.params[1]}`);
            continue;
        }
        assert.ok(/SET before_img = \?, after_img = \?, extra_data = \?/.test(u.sql));
        assert.ok(!/kg_before|kg_after|gained_kg|slices|at |date_local/.test(u.sql));
    }

    assert.deepStrictEqual(deleteHits, [], 'update_meal_images must not delete/unlink/rm anything');

    const inspectedAfter = await inspectPantry('ivory', { log_limit: 20 }, {
        state: inspectState,
        cakeLog: [composeCakeLogEntry(logAfter)]
    });
    assert.strictEqual(inspectedAfter.past_consumes[0].meal_id, '17');
    assert.strictEqual(inspectedAfter.past_consumes[0].before, NEW_BEFORE);
    assert.strictEqual(inspectedAfter.past_consumes[0].after, NEW_AFTER);
    assert.strictEqual(inspectedAfter.current_kg, 54.96);
    assert.strictEqual(inspectedAfter.slices_eaten_total, 8);
    assert.strictEqual(inspectedAfter.pending.slices, 4);

    // File-path rewrite keeps neighbor lines byte-identical
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cake-pantry-277-'));
    try {
        const logPath = path.join(tmp, 'cake-log.jsonl');
        const neighbor = JSON.stringify({ at: '2026-09-01T00:00:00.000Z', slices: 2, kg_before: 54, kg_after: 54.24, before: OLD_BEFORE, after: OLD_AFTER });
        const target = JSON.stringify(noIdMeal);
        fs.writeFileSync(logPath, `${neighbor}\n${target}\n`, 'utf8');
        const rawBefore = fs.readFileSync(logPath, 'utf8');
        const rewritten = _test.rewriteJsonlMeal(logPath, 'ivory', derivedA, (meal) => _test.applyMealImageUpdate(meal, {
            before: NEW_BEFORE,
            after: NEW_AFTER,
            now: NOW,
            client: 'dreamscape-menma'
        }));
        assert.ok(rewritten.found);
        const lines = fs.readFileSync(logPath, 'utf8').split('\n');
        assert.strictEqual(lines[0], neighbor, 'neighbor cake_log line must stay byte-identical');
        const rewrittenMeal = JSON.parse(lines[1]);
        assert.strictEqual(rewrittenMeal.before, NEW_BEFORE);
        assert.strictEqual(rewrittenMeal.after, NEW_AFTER);
        assert.strictEqual(rewrittenMeal.kg_before, 54);
        assert.strictEqual(rewrittenMeal.kg_after, 54.96);
        assert.strictEqual(rewrittenMeal.slices, 8);
        assert.strictEqual(rewrittenMeal.at, STAMP);
        assert.notStrictEqual(fs.readFileSync(logPath, 'utf8'), rawBefore);
        assert.ok(!fs.readFileSync(logPath, 'utf8').includes('delete'));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    // Direct SQL helper never writes kg/slices columns
    const patchRow = cloneRow(row);
    patchRow.before_img = OLD_BEFORE;
    patchRow.after_img = OLD_AFTER;
    const helperDb = createFakePantryDb(patchRow);
    await updateCakeLogImagesToDb(helperDb, 'ivory', patchRow, {
        before: NEW_BEFORE,
        after: NEW_AFTER,
        image_history: updated.image_history,
        meal_id: '17'
    });
    assert.strictEqual(helperDb.rows[0].kg_before, 54);
    assert.strictEqual(helperDb.rows[0].kg_after, 54.96);
    assert.strictEqual(helperDb.rows[0].slices, 8);
    assert.strictEqual(helperDb.rows[0].at, STAMP);

    console.log('test-cake-pantry-update-meal-images: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});

function cloneRow(row) {
    return { ...row };
}

function snapshotFrozenLogRow(r) {
    return JSON.stringify({
        at: r.at,
        loop: r.loop,
        date_local: r.date_local,
        slices: r.slices,
        stacks: r.stacks,
        cake_type: r.cake_type,
        cake_rating: r.cake_rating,
        kg_before: r.kg_before,
        kg_after: r.kg_after,
        gained_kg: r.gained_kg,
        chair: r.chair,
        named_for: r.named_for,
        landed: r.landed,
        left_open: r.left_open
    });
}

function createFakePantryDb(seedRow) {
    const rows = [cloneRow(seedRow)];
    const updates = [];
    return {
        rows,
        updates,
        async get(sql, params) {
            if (/account_id = \? AND id = \?/.test(sql)) {
                return rows.find((r) => r.account_id === params[0] && Number(r.id) === Number(params[1]));
            }
            return undefined;
        },
        async all(sql, params) {
            if (/FROM cake_pantry_log/.test(sql)) {
                return rows.filter((r) => r.account_id === params[0]);
            }
            return [];
        },
        async run(sql, params) {
            updates.push({ sql, params });
            if (/UPDATE cake_pantry_log/.test(sql)) {
                const [before, after, extra, id, accountId] = params;
                const target = rows.find((r) => Number(r.id) === Number(id) && r.account_id === accountId);
                if (target) {
                    target.before_img = before;
                    target.after_img = after;
                    target.extra_data = extra;
                }
                return { changes: target ? 1 : 0 };
            }
            return { changes: 0 };
        }
    };
}
