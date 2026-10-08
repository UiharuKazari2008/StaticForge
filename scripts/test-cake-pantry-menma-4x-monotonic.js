#!/usr/bin/env node
'use strict';

/**
 * Yukimi 2026-10-05 7:28pm ET:
 * - grok.menma / Lead credit multiplier 1.25x → 4x; other credits stay 1x
 * - Menma current_kg never decreases; other eaters unaffected
 * Isolated fake DB; never touches live pantry SQLite.
 */

const assert = require('assert');
const { applyMultiplier, LEAD_MULTIPLIER } = require('../modules/cakePantry');
const {
    saveAccountStateToDb,
    clampMonotonicKg,
    isMonotonicKgAccount
} = require('../modules/menmaStatus');

// --- multiplier
assert.strictEqual(LEAD_MULTIPLIER, 4);
assert.strictEqual(applyMultiplier(1, 'grok.menma'), 4);
assert.strictEqual(applyMultiplier(3, 'grok.menma'), 12);
assert.strictEqual(applyMultiplier(3, 'Lead'), 12);
assert.strictEqual(applyMultiplier(3, 'Frost'), 3, 'other credit stays 1x');
assert.strictEqual(applyMultiplier(3, null), 3, 'no credit stays 1x');

// --- pure clamp
assert.ok(isMonotonicKgAccount('menma'));
for (const id of ['hoshino', 'ivory', 'pyra', 'chiyo', 'guren', 'rook', 'sala']) {
    assert.ok(!isMonotonicKgAccount(id), `${id} must not be monotonic`);
}
assert.strictEqual(clampMonotonicKg('menma', 379.16, 100), 379.16);
assert.strictEqual(clampMonotonicKg('menma', 379.16, 379.64), 379.64);
assert.strictEqual(clampMonotonicKg('menma', 379.16, null), 379.16);
assert.strictEqual(clampMonotonicKg('menma', 379.16, ''), 379.16);
assert.strictEqual(clampMonotonicKg('menma', null, 54), 54, 'no prior value: accept');
assert.strictEqual(clampMonotonicKg('guren', 80, 70), 70);

// --- consume kg_before + null re-seed (cakePantry): Menma never below her history
const { _test: pantryTest } = require('../modules/cakePantry');
const hist = [{ kg: 379.16 }, { kg: 383 }, { kg: 'bad' }];
assert.strictEqual(pantryTest.maxHistoryKg({ history: hist }), 383);
assert.strictEqual(pantryTest.maxHistoryKg({}), null);
assert.strictEqual(pantryTest.monotonicKgBefore('menma', { current_kg: 100, history: hist }), 383, 'stale current_kg cannot lower kg_before');
assert.strictEqual(pantryTest.monotonicKgBefore('menma', { current_kg: '384.2', history: hist }), 384.2, 'higher current_kg kept (as a number)');
assert.strictEqual(pantryTest.monotonicKgBefore('menma', { current_kg: null, baseline_kg: 54, history: [] }), 54, 'no history: baseline');
assert.strictEqual(pantryTest.monotonicKgBefore('guren', { current_kg: 100, history: hist }), 100, 'other eaters unaffected');
const reseeded = pantryTest.ensureCurrentKgSeeded('menma', { current_kg: null, baseline_kg: 54, history: hist }).state;
assert.strictEqual(reseeded.current_kg, 383, 'null current_kg re-seeds from history, not baseline');
const gurenSeed = pantryTest.ensureCurrentKgSeeded('guren', { current_kg: null, baseline_kg: 54, history: [{ kg: 145.44 }] }).state;
assert.strictEqual(gurenSeed.current_kg, 54, 'non-monotonic seed unchanged');

// --- DB save path
function fakeDb(initial) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
    return {
        store,
        async get(sql, params) {
            const [accountId, key] = params;
            const v = store.get(`${accountId}:${key}`);
            return v == null ? undefined : { value: v };
        },
        async run(sql, params) {
            const [accountId, key, value] = params;
            store.set(`${accountId}:${key}`, value);
            return { changes: 1 };
        }
    };
}
const read = (db, id, key) => JSON.parse(db.store.get(`${id}:${key}`));

(async () => {
    const origWarn = console.warn; console.warn = () => {};
    try {
        const db = fakeDb({ 'menma:current_kg': 379.16, 'guren:current_kg': 80 });

        const menmaDown = { current_kg: 120, slices_eaten_total: 2711 };
        await saveAccountStateToDb(db, 'menma', menmaDown);
        assert.strictEqual(read(db, 'menma', 'current_kg'), 379.16, 'menma decrease blocked');
        assert.strictEqual(menmaDown.current_kg, 379.16, 'caller state reflects clamped kg');
        assert.strictEqual(read(db, 'menma', 'slices_eaten_total'), 2711, 'other keys still saved');

        await saveAccountStateToDb(db, 'menma', { current_kg: null });
        assert.strictEqual(read(db, 'menma', 'current_kg'), 379.16, 'menma null reset blocked');

        await saveAccountStateToDb(db, 'menma', { current_kg: 380.12 });
        assert.strictEqual(read(db, 'menma', 'current_kg'), 380.12, 'menma gain allowed');

        await saveAccountStateToDb(db, 'menma', { pending_slices: 3 });
        assert.strictEqual(read(db, 'menma', 'current_kg'), 380.12, 'save without current_kg leaves kg');

        await saveAccountStateToDb(db, 'guren', { current_kg: 70 });
        assert.strictEqual(read(db, 'guren', 'current_kg'), 70, 'guren decrease unaffected');

        await saveAccountStateToDb(db, 'rook', { current_kg: 54 });
        assert.strictEqual(read(db, 'rook', 'current_kg'), 54);
        await saveAccountStateToDb(db, 'rook', { current_kg: 50 });
        assert.strictEqual(read(db, 'rook', 'current_kg'), 50, 'rook decrease unaffected');
    } finally {
        console.warn = origWarn;
    }
    console.log('test-cake-pantry-menma-4x-monotonic: ok');
})().catch((err) => { console.error(err); process.exit(1); });
