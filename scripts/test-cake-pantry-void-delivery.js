#!/usr/bin/env node
'use strict';

/**
 * void_cake_delivery, consume_cake delivery_ids, and FIFO ship de-dup (Rook #388).
 * In-memory pantry state only — does not open tag_wiki.db or eat live cake.
 */

const assert = require('assert');
const {
    consumeCake,
    voidCakeDelivery,
    KG_PER_SLICE,
    partitionFifoDuplicateDeliveries,
    collectEatenShipTokens
} = require('../modules/cakePantry');
const { _test } = require('../modules/mcpAgentFacade');

const SHA_A = 'abcdef0123456789abcdef0123456789abcd';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SHA_GH = '15fe5e67adbc3745cc69d87a5d3d8e6b7d21838a';
const REASON_A = `ship:179:${SHA_A}`;
const REASON_B = `ship:200:${SHA_B}`;
const REASON_A_NOTE = `ship:179:${SHA_A} oct 5 duplicate`;
const NOW = '2026-10-09T16:00:00.000Z';
const ACTOR = 'Rook';

function delivery(id, slices, reason, extra = {}) {
    return { id, slices, reason, cake_type: 'strawberry shortcake', ...extra };
}

function baseState(deliveries, extras = {}) {
    const feeds = extras.pending_feeds || [];
    return {
        character: { name: 'Hoshino' },
        baseline_kg: 54,
        current_kg: 70.2,
        slices_eaten_total: 40,
        pending_slices: 99,
        pending_deliveries: deliveries,
        pending_feeds: feeds,
        history: [{ at: '2026-10-01T00:00:00.000Z', kg: 70.2, slices: 1, gained_kg: 0.12 }],
        last_before: null,
        last_after: null
    };
}

function kgAfter(before, slices) {
    return Number((before + slices * KG_PER_SLICE).toFixed(2));
}

(async () => {
    const voidDef = _test.TOOL_DEFS.find((t) => t.name === 'void_cake_delivery');
    assert.ok(voidDef, 'void_cake_delivery tool def missing');
    assert.ok(voidDef.inputSchema.required.includes('delivery_id'));
    assert.ok(voidDef.inputSchema.required.includes('reason'));
    assert.ok(voidDef.inputSchema.properties.consumed_by_meal);
    assert.strictEqual(_test.TOOL_RATE_GROUPS.void_cake_delivery, 'write');
    const consumeDef = _test.TOOL_DEFS.find((t) => t.name === 'consume_cake');
    assert.ok(consumeDef.inputSchema.properties.delivery_ids, 'consume_cake needs delivery_ids');
    assert.ok(consumeDef.description.includes('delivery_ids'));
    assert.ok(consumeDef.description.includes('de-dup') || consumeDef.description.includes('duplicate'));

    // --- void: audit row, kg unchanged, other deliveries untouched
    const target = delivery('del_1791382959295_n87bxg', 2, REASON_A);
    const other = delivery('del_other', 4, REASON_B, { cake_type: 'tiramisu' });
    const dry = delivery('del_dry', 5, 'dry-verify pantry probe', { cake_type: 'dry-verify', do_not_eat: true });
    const feed = { id: 'feed_1', slices: 3, reason: 'just because', cake_type: 'chiffon', do_not_eat: false };
    const state = baseState([target, other, dry], { pending_feeds: [feed] });
    const historyBefore = state.history.slice();
    const auditRows = [];
    const voided = await voidCakeDelivery('hoshino', {
        delivery_id: 'del_1791382959295_n87bxg',
        reason: 'already eaten in meal 118',
        consumed_by_meal: '118'
    }, {
        state,
        now: NOW,
        actor: ACTOR,
        appendLog: async (accountId, entry) => {
            auditRows.push({ accountId, entry });
            return true;
        }
    });

    assert.strictEqual(voided.success, true);
    assert.strictEqual(state.current_kg, 70.2, 'void must not change kg');
    assert.strictEqual(voided.current_kg, 70.2);
    assert.strictEqual(state.slices_eaten_total, 40);
    assert.deepStrictEqual(state.history, historyBefore);
    assert.strictEqual(state.pending_deliveries[1], other, 'other delivery object untouched');
    assert.strictEqual(other.slices, 4);
    assert.strictEqual(other.cake_type, 'tiramisu');
    assert.strictEqual(other.do_not_eat, undefined);
    assert.strictEqual(state.pending_deliveries[2], dry, 'dry-verify delivery untouched');
    assert.strictEqual(state.pending_feeds[0], feed);
    const marked = state.pending_deliveries[0];
    assert.strictEqual(marked.id, 'del_1791382959295_n87bxg');
    assert.strictEqual(marked.do_not_eat, true);
    assert.strictEqual(marked.voided, true);
    assert.strictEqual(marked.cake_type, 'strawberry shortcake', 'void keeps cake_type');
    assert.strictEqual(marked.reason, REASON_A, 'ship reason stays on the delivery');
    assert.strictEqual(marked.void_reason, 'already eaten in meal 118');
    assert.strictEqual(marked.consumed_by_meal, '118');
    assert.strictEqual(marked.slices, 2);
    assert.strictEqual(state.pending_slices, 7, 'eligible slices: other 4 + feed 3; void and dry-verify excluded');

    assert.strictEqual(auditRows.length, 1);
    assert.strictEqual(auditRows[0].accountId, 'hoshino');
    const audit = auditRows[0].entry;
    assert.strictEqual(audit.who, ACTOR);
    assert.strictEqual(audit.at, NOW);
    assert.strictEqual(audit.reason, 'already eaten in meal 118');
    assert.strictEqual(audit.delivery_id, 'del_1791382959295_n87bxg');
    assert.strictEqual(audit.consumed_by_meal, '118');
    assert.strictEqual(audit.event, 'void_cake_delivery');
    assert.strictEqual(audit.slices, 0);
    assert.strictEqual(audit.gained_kg, 0);
    assert.strictEqual(audit.kg_before, 70.2);
    assert.strictEqual(audit.kg_after, 70.2);
    assert.strictEqual(state.audit_log.length, 1);
    assert.strictEqual(state.audit_log[0], audit);

    const again = await voidCakeDelivery('hoshino', {
        delivery_id: 'del_1791382959295_n87bxg',
        reason: 'second void'
    }, { state, now: NOW, actor: ACTOR });
    assert.strictEqual(again.success, false);
    assert.ok(again.error.includes('Unknown or non-pending'));
    assert.strictEqual(state.current_kg, 70.2);
    assert.strictEqual(state.audit_log.length, 1, 'failed void must not write another audit row');
    assert.strictEqual(state.pending_deliveries[1], other);

    const afterVoid = await consumeCake('hoshino', {
        delivery_ids: ['del_other'],
        max_slices: 99
    }, { state, cakeLog: [] });
    assert.strictEqual(afterVoid.success, true);
    assert.strictEqual(afterVoid.slices_consumed, 4);
    assert.strictEqual(state.pending_slices, 3, 'voided slices stay out of pending_slices on the next meal');
    assert.strictEqual(state.current_kg, kgAfter(70.2, 4));
    assert.ok(state.pending_deliveries.some((d) => d.id === 'del_1791382959295_n87bxg' && d.do_not_eat === true));
    assert.ok(state.pending_feeds.includes(feed));

    const unknownState = baseState([other]);
    const unknownBefore = JSON.stringify(unknownState);
    const unknown = await voidCakeDelivery('hoshino', {
        delivery_id: 'del_missing',
        reason: 'no such plate'
    }, { state: unknownState, now: NOW, actor: ACTOR });
    assert.strictEqual(unknown.success, false);
    assert.ok(unknown.error.includes('Unknown or non-pending'));
    assert.strictEqual(JSON.stringify(unknownState), unknownBefore);

    const noReason = await voidCakeDelivery('hoshino', {
        delivery_id: other.id
    }, { state: baseState([other]), actor: ACTOR });
    assert.strictEqual(noReason.success, false);
    assert.ok(noReason.error.includes('reason'));

    // --- delivery_ids eats that delivery, not FIFO
    const oct5 = delivery('del_oct5', 2, REASON_A);
    const original = delivery('del_1791382959295_n87bxg', 2, REASON_A);
    const side = delivery('del_side', 1, REASON_B, { cake_type: 'tiramisu' });
    const gift = { id: 'feed_gift', slices: 3, reason: 'promotion', cake_type: 'chiffon' };
    const pickState = baseState([oct5, original, side], { pending_feeds: [gift] });
    const picked = await consumeCake('hoshino', {
        delivery_ids: ['del_1791382959295_n87bxg'],
        max_slices: 99
    }, { state: pickState, cakeLog: [] });
    assert.strictEqual(picked.success, true);
    assert.strictEqual(picked.slices_consumed, 2);
    assert.strictEqual(picked.kg_before, 70.2);
    assert.strictEqual(picked.kg_after, kgAfter(70.2, 2));
    assert.strictEqual(pickState.current_kg, kgAfter(70.2, 2));
    assert.ok(pickState.pending_deliveries.includes(oct5), 'earlier FIFO duplicate was not eaten');
    assert.ok(pickState.pending_deliveries.includes(side));
    assert.strictEqual(oct5.slices, 2);
    assert.strictEqual(side.slices, 1);
    assert.ok(pickState.pending_feeds.includes(gift), 'delivery_ids does not eat feeds');
    assert.strictEqual(gift.slices, 3);
    assert.ok(!pickState.pending_deliveries.some((d) => d.id === 'del_1791382959295_n87bxg'));
    assert.deepStrictEqual(picked.named_for, [REASON_A]);

    const missState = baseState([oct5, side]);
    const missKg = missState.current_kg;
    const miss = await consumeCake('hoshino', {
        delivery_ids: ['del_nope'],
        max_slices: 99
    }, { state: missState, cakeLog: [] });
    assert.strictEqual(miss.success, false);
    assert.ok(miss.error.includes('Unknown or non-pending'));
    assert.strictEqual(missState.current_kg, missKg);
    assert.strictEqual(missState.pending_deliveries[0], oct5);
    assert.strictEqual(missState.pending_deliveries[1], side);

    const voidedOnly = baseState([
        delivery('del_voided', 2, REASON_B, { do_not_eat: true, voided: true, cake_type: 'tiramisu' })
    ]);
    const voidEat = await consumeCake('hoshino', {
        delivery_ids: ['del_voided'],
        max_slices: 99
    }, { state: voidedOnly, cakeLog: [] });
    assert.strictEqual(voidEat.success, false);
    assert.ok(voidEat.error.includes('Unknown or non-pending'));
    assert.strictEqual(voidedOnly.current_kg, 70.2);

    // --- FIFO de-dup: same ship reason/key eaten once
    const first = delivery('del_oct5', 2, REASON_A);
    const dup = delivery('del_1791382959295_n87bxg', 2, REASON_A_NOTE);
    const distinct = delivery('del_distinct', 1, REASON_B, { cake_type: 'tiramisu' });
    const fifoState = baseState([first, dup, distinct]);
    const fifo = await consumeCake('hoshino', { max_slices: 99 }, { state: fifoState, cakeLog: [] });
    assert.strictEqual(fifo.success, true);
    assert.strictEqual(fifo.slices_consumed, 3, 'first ship copy plus the other ship; not the duplicate');
    assert.strictEqual(fifo.kg_after, kgAfter(70.2, 3));
    assert.ok(fifo.skipped_duplicate_deliveries.includes('del_1791382959295_n87bxg'));
    assert.strictEqual(fifoState.pending_deliveries.length, 1);
    assert.strictEqual(fifoState.pending_deliveries[0], dup);
    assert.strictEqual(dup.slices, 2);
    assert.ok(!dup.do_not_eat, 'de-dup leaves the copy pending for void; it does not eat it');

    const second = await consumeCake('hoshino', { max_slices: 99 }, {
        state: fifoState,
        cakeLog: [fifo.log_entry]
    });
    assert.strictEqual(second.success, false);
    assert.ok(second.error.includes('duplicate'));
    assert.strictEqual(fifoState.current_kg, kgAfter(70.2, 3), 'second meal must not eat the duplicate');
    assert.strictEqual(fifoState.pending_deliveries[0], dup);

    const sameReasonA = delivery('del_plate_a', 2, 'evening plate');
    const sameReasonB = delivery('del_plate_b', 2, 'Evening Plate');
    const reasonState = baseState([sameReasonA, sameReasonB]);
    const reasonEat = await consumeCake('hoshino', { max_slices: 99 }, { state: reasonState, cakeLog: [] });
    assert.strictEqual(reasonEat.success, true);
    assert.strictEqual(reasonEat.slices_consumed, 2);
    assert.strictEqual(reasonState.pending_deliveries[0], sameReasonB);

    const plainA = delivery('del_u1', 1, 'unspecified');
    const plainB = delivery('del_u2', 1, 'unspecified');
    const plainState = baseState([plainA, plainB]);
    const plainEat = await consumeCake('hoshino', { max_slices: 99 }, { state: plainState, cakeLog: [] });
    assert.strictEqual(plainEat.success, true);
    assert.strictEqual(plainEat.slices_consumed, 2, 'placeholder reasons are not a ship identity');
    assert.strictEqual(plainState.pending_deliveries.length, 0);

    const bothIds = baseState([
        delivery('del_oct5', 2, REASON_A),
        delivery('del_1791382959295_n87bxg', 2, REASON_A)
    ]);
    const both = await consumeCake('hoshino', {
        delivery_ids: ['del_1791382959295_n87bxg', 'del_oct5'],
        max_slices: 99
    }, { state: bothIds, cakeLog: [] });
    assert.strictEqual(both.success, true);
    assert.strictEqual(both.slices_consumed, 2, 'explicit ids still de-dup in FIFO order');
    assert.ok(both.skipped_duplicate_deliveries.includes('del_1791382959295_n87bxg'));
    assert.ok(bothIds.pending_deliveries.some((d) => d.id === 'del_1791382959295_n87bxg'));

    const partialFirst = delivery('del_big', 10, REASON_A);
    const partialDup = delivery('del_big_dup', 10, REASON_A);
    const partialState = baseState([partialFirst, partialDup]);
    const partial = await consumeCake('hoshino', { max_slices: 4 }, { state: partialState, cakeLog: [] });
    assert.strictEqual(partial.success, true);
    assert.strictEqual(partial.slices_consumed, 4);
    assert.strictEqual(partialDup.slices, 10, 'duplicate must not fill the rest of the sitting');
    const leftover = partialState.pending_deliveries.find((d) => d.id === 'del_big');
    assert.ok(leftover);
    assert.strictEqual(leftover.slices, 6);

    const ghBank = delivery('del_gh', 1, `ship:241:${SHA_GH} GH #241 remainder`);
    const yozora = delivery('del_yozora', 1, 'ship:241:1111111111111111111111111111111111111111');
    const split = partitionFifoDuplicateDeliveries([ghBank, yozora], new Set());
    assert.strictEqual(split.fresh.length, 2, 'GH-labelled bank must not suppress a different Yozora ship:241 by number');
    const already = collectEatenShipTokens([{ named_for: [REASON_A], slices: 2 }]);
    const held = partitionFifoDuplicateDeliveries([
        delivery('del_1791382959295_n87bxg', 2, REASON_A_NOTE)
    ], already);
    assert.strictEqual(held.fresh.length, 0);
    assert.strictEqual(held.duplicates.length, 1);

    console.log('test-cake-pantry-void-delivery: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
