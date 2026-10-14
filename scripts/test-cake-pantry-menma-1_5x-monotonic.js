#!/usr/bin/env node
'use strict';

/**
 * Yukimi #477:
 * - grok.menma / Lead credit multiplier reads CAKE_LEAD_MULTIPLIER, default 1.5 (Math.ceil)
 * - Already-banked slice counts are not rewritten
 * - Menma current_kg never decreases on deliver / feed / consume / plain save
 * - adjust_weight may lower kg only for weight_loss_surgery with an explicit approval note
 * Isolated fake DB and in-memory state. Never touches live pantry SQLite.
 */

delete process.env.CAKE_LEAD_MULTIPLIER;

const assert = require('assert');
const {
    applyMultiplier,
    LEAD_MULTIPLIER,
    leadMultiplier,
    deliverCake,
    feedCake,
    consumeCake,
    adjustWeight,
    ACCOUNT_DEFS
} = require('../modules/cakePantry');
const {
    saveAccountStateToDb,
    clampMonotonicKg,
    isMonotonicKgAccount
} = require('../modules/menmaStatus');

assert.strictEqual(LEAD_MULTIPLIER, 1.5);
assert.strictEqual(leadMultiplier(), 1.5);
assert.strictEqual(applyMultiplier(1, 'grok.menma'), 2, 'ceil(1 * 1.5)');
assert.strictEqual(applyMultiplier(2, 'grok.menma'), 3, 'ceil(2 * 1.5)');
assert.strictEqual(applyMultiplier(3, 'grok.menma'), 5, 'ceil(3 * 1.5)');
assert.strictEqual(applyMultiplier(3, 'Lead'), 5);
assert.strictEqual(applyMultiplier(4, 'grok.menma'), 6);
assert.strictEqual(applyMultiplier(3, 'Frost'), 3, 'other credit stays 1x');
assert.strictEqual(applyMultiplier(3, null), 3, 'no credit stays 1x');
assert.strictEqual(ACCOUNT_DEFS.menma.baseline_kg, 54);

process.env.CAKE_LEAD_MULTIPLIER = '4';
assert.strictEqual(leadMultiplier(), 4);
assert.strictEqual(applyMultiplier(3, 'grok.menma'), 12, 'env override still applies at bank time');
process.env.CAKE_LEAD_MULTIPLIER = '0';
assert.strictEqual(leadMultiplier(), 1.5, 'non-positive env falls back to 1.5');
process.env.CAKE_LEAD_MULTIPLIER = 'nope';
assert.strictEqual(leadMultiplier(), 1.5, 'non-numeric env falls back to 1.5');
delete process.env.CAKE_LEAD_MULTIPLIER;
assert.strictEqual(applyMultiplier(1, 'grok.menma'), 2);

// --- pure clamp (unchanged for every non-surgery path)
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

const withSurgery = [{ kg: 597.2 }, { kind: 'surgery', kg: 110, kg_before: 597.2 }, { kg: 110.12 }];
assert.strictEqual(pantryTest.maxHistoryKg({ history: withSurgery }), 110.12, 'floor starts at the latest surgery, not 597.2');
assert.strictEqual(pantryTest.monotonicKgBefore('menma', { current_kg: 50, history: withSurgery }), 110.12);
assert.strictEqual(pantryTest.monotonicKgBefore('menma', { current_kg: 200, history: withSurgery }), 200);
const reseedAfterSurgery = pantryTest.ensureCurrentKgSeeded('menma', {
    current_kg: null,
    baseline_kg: 54,
    history: withSurgery
}).state;
assert.strictEqual(reseedAfterSurgery.current_kg, 110.12, 'null re-seed uses post-surgery max');
assert.strictEqual(reseedAfterSurgery.baseline_kg, 54);

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

function menmaState(kg) {
    return {
        character: { name: 'Menma' },
        baseline_kg: 54,
        current_kg: kg,
        slices_eaten_total: 4528,
        pending_slices: 0,
        pending_deliveries: [],
        pending_feeds: [],
        history: [{ at: '2026-10-13T23:16:19.415Z', kg, slices: 1, gained_kg: 0.12 }],
        milestones: { chair: 'heavy_duty', chair_broke_at_kg: 67.52 }
    };
}

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

        // deliver / feed never lower kg, and a plain save of a lower kg (no surgery flag) is clamped
        const pile = menmaState(597.2);
        const delivered = await deliverCake('menma', {
            slices: 3,
            reason: 'ship:new after 1.5x',
            credit: 'grok.menma'
        }, { state: pile });
        assert.strictEqual(delivered.success, true);
        assert.strictEqual(delivered.delivery.slices, 5, 'new bank uses ceil(3 * 1.5)');
        assert.strictEqual(delivered.delivery.raw_slices, 3);
        assert.strictEqual(pile.current_kg, 597.2, 'deliver cannot lower kg');

        const fed = await feedCake('menma', { slices: 2, reason: 'gift' }, { state: pile });
        assert.strictEqual(fed.success, true);
        assert.strictEqual(pile.current_kg, 597.2, 'feed cannot lower kg');

        const live = fakeDb({ 'menma:current_kg': 597.2 });
        await saveAccountStateToDb(live, 'menma', { current_kg: 110, pending_slices: pile.pending_slices });
        assert.strictEqual(read(live, 'menma', 'current_kg'), 597.2, 'deliver/feed/consume save path cannot lower kg');

        const meal = await consumeCake('menma', { slices: 20 }, { state: pile, cakeLog: [] });
        assert.strictEqual(meal.success, true);
        assert.strictEqual(meal.slices_consumed, 7);
        assert.strictEqual(meal.kg_before, 597.2);
        assert.strictEqual(meal.kg_after, 598.04, 'consume only adds kg');
        assert.ok(meal.kg_after > meal.kg_before);

        const tampered = menmaState(597.2);
        tampered.current_kg = 50;
        tampered.pending_deliveries = [{ id: 'd-low', slices: 1, reason: 'ship:tamper-guard' }];
        tampered.pending_slices = 1;
        const lifted = await consumeCake('menma', { slices: 1 }, { state: tampered, cakeLog: [] });
        assert.strictEqual(lifted.kg_before, 597.2, 'consume cannot start below history');
        assert.strictEqual(lifted.kg_after, 597.32);

        // already-banked 4x delivery is eaten at its stored slice count
        const oldBank = menmaState(597.2);
        oldBank.pending_deliveries = [{
            id: 'old-4x',
            slices: 12,
            raw_slices: 3,
            multiplier: 4,
            reason: 'ship:already banked at 4x',
            credit: 'grok.menma'
        }];
        oldBank.pending_slices = 12;
        const oldMeal = await consumeCake('menma', { slices: 20 }, { state: oldBank, cakeLog: [] });
        assert.strictEqual(oldMeal.slices_consumed, 12, 'stored 4x slices are not recomputed at 1.5x');
        assert.strictEqual(oldMeal.kg_after, Number((597.2 + 12 * 0.12).toFixed(2)));

        // adjust_weight without approval is rejected and does not write
        let writes = 0;
        const untouched = menmaState(597.2);
        const noApproval = await adjustWeight('menma', {
            kg: 110,
            reason: 'surgery'
        }, {
            state: untouched,
            saveState: () => { writes += 1; return true; },
            appendLog: () => { writes += 1; return true; }
        });
        assert.strictEqual(noApproval.success, false);
        assert.strictEqual(writes, 0);
        assert.strictEqual(untouched.current_kg, 597.2);
        assert.strictEqual(untouched.history.length, 1);

        const bareFlag = await adjustWeight('menma', {
            kg: 110,
            reason: 'surgery',
            approved: true
        }, {
            state: untouched,
            saveState: () => { writes += 1; return true; }
        });
        assert.strictEqual(bareFlag.success, false, 'approved:true without approvalNote is refused');
        assert.strictEqual(writes, 0);

        const blankReason = await adjustWeight('menma', {
            kg: 110,
            reason: '   ',
            approval: 'yukimi-477'
        }, { state: untouched, saveState: () => { writes += 1; return true; } });
        assert.strictEqual(blankReason.success, false);
        assert.strictEqual(writes, 0);

        const wrongEvent = await adjustWeight('menma', {
            kg: 110,
            reason: 'not surgery',
            approval: 'yukimi-477',
            event: 'diet'
        }, { state: untouched, saveState: () => { writes += 1; return true; } });
        assert.strictEqual(wrongEvent.success, false);
        assert.strictEqual(untouched.current_kg, 597.2);

        // approved surgery: 597.2 -> 110, baseline stays 54, chair stays (110 >= 67.52)
        const surgeryDb = fakeDb({ 'menma:current_kg': 597.2 });
        const patient = menmaState(597.2);
        const logs = [];
        let sawBypass = false;
        const surgery = await adjustWeight('menma', {
            kg: 110,
            reason: 'Yukimi #477 weight-loss surgery',
            approval: 'yukimi-477'
        }, {
            state: patient,
            actor: 'rook',
            now: '2026-10-14T08:00:00.000Z',
            saveState: async (id, st, saveOptions) => {
                sawBypass = !!(saveOptions && saveOptions.bypassMonotonicClamp === true);
                await saveAccountStateToDb(surgeryDb, id, st, saveOptions);
                return true;
            },
            appendLog: async (id, entry) => { logs.push(entry); return true; }
        });
        assert.strictEqual(surgery.success, true);
        assert.strictEqual(sawBypass, true, 'only this call bypasses the monotonic clamp');
        assert.strictEqual(surgery.kg_before, 597.2);
        assert.strictEqual(surgery.kg_after, 110);
        assert.strictEqual(surgery.event, 'weight_loss_surgery');
        assert.strictEqual(patient.current_kg, 110);
        assert.strictEqual(patient.baseline_kg, 54);
        assert.strictEqual(read(surgeryDb, 'menma', 'current_kg'), 110);
        assert.strictEqual(read(surgeryDb, 'menma', 'baseline_kg'), 54);
        const histEntry = patient.history[patient.history.length - 1];
        assert.strictEqual(histEntry.kind, 'surgery');
        assert.strictEqual(histEntry.kg, 110);
        assert.strictEqual(histEntry.kg_before, 597.2);
        assert.strictEqual(histEntry.reason, 'Yukimi #477 weight-loss surgery');
        assert.strictEqual(histEntry.approval, 'yukimi-477');
        assert.strictEqual(histEntry.actor, 'rook');
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(logs[0].kind, 'surgery');
        assert.strictEqual(logs[0].reason, 'Yukimi #477 weight-loss surgery');
        assert.strictEqual(logs[0].approval_note, 'yukimi-477');
        assert.strictEqual(logs[0].kg_before, 597.2);
        assert.strictEqual(logs[0].kg_after, 110);
        assert.strictEqual(logs[0].actor, 'rook');
        assert.strictEqual(patient.milestones.chair, 'heavy_duty', '110 kg is still above the chair break');
        assert.strictEqual(patient.milestones.chair_broke_at_kg, 67.52);
        assert.strictEqual(patient.milestones.chair_break_active, true);

        await saveAccountStateToDb(surgeryDb, 'menma', { current_kg: 90 });
        assert.strictEqual(read(surgeryDb, 'menma', 'current_kg'), 110, 'after surgery, plain saves still cannot lower kg');

        patient.current_kg = 40;
        patient.pending_deliveries = [{ id: 'post-op', slices: 1, reason: 'ship:after surgery' }];
        patient.pending_slices = 1;
        const postOp = await consumeCake('menma', { slices: 1 }, { state: patient, cakeLog: [] });
        assert.strictEqual(postOp.kg_before, 110, 'post-surgery floor is 110, not 597.2 and not the tampered 40');
        assert.strictEqual(postOp.kg_after, 110.12);

        const noteForm = menmaState(597.2);
        const byNote = await adjustWeight('menma', {
            kg: 110,
            reason: 'same surgery, flag form',
            approved: true,
            approvalNote: 'yukimi-477'
        }, {
            state: noteForm,
            actor: 'rook',
            appendLog: async () => true
        });
        assert.strictEqual(byNote.success, true);
        assert.strictEqual(byNote.approval, 'yukimi-477');
        assert.strictEqual(noteForm.baseline_kg, 54);
        assert.strictEqual(noteForm.current_kg, 110);

        const dropped = menmaState(597.2);
        const underBreak = await adjustWeight('menma', {
            kg: 60,
            reason: 'below chair break',
            approval: 'yukimi-477'
        }, { state: dropped, appendLog: async () => true });
        assert.strictEqual(underBreak.success, true);
        assert.strictEqual(dropped.current_kg, 60);
        assert.strictEqual(dropped.baseline_kg, 54);
        assert.strictEqual(dropped.milestones.chair, 'gaming');
        assert.strictEqual(dropped.milestones.chair_break_active, false);
        assert.strictEqual(dropped.milestones.chair_broke_at_kg, 67.52);
        assert.strictEqual(dropped.milestones.chair_before_break, 'gaming');
    } finally {
        console.warn = origWarn;
        delete process.env.CAKE_LEAD_MULTIPLIER;
    }
    console.log('test-cake-pantry-menma-1_5x-monotonic: ok');
})().catch((err) => { console.error(err); process.exit(1); });
