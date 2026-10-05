#!/usr/bin/env node
'use strict';

/**
 * Pantry UI shows re-pointed meal images (Oct 5 report, meal 54).
 * - get_menma_state cake_log is no longer cut to the newest 16 meals
 * - last_before/last_after come from the newest cake_log meal, not stale state
 * - update_meal_images sets visual_gen_status 'provided' once both shots exist;
 *   rows already re-pointed read as 'provided' without a data migration
 * Isolated fakes; never touches live pantry SQLite.
 */

const assert = require('assert');
const { updateMealImages, inspectPantry, ACCOUNT_DEFS, VALID_ACCOUNT_IDS, _test } = require('../modules/cakePantry');
const {
    buildAccountStatus,
    buildAllAccountsStatus,
    composeCakeLogEntry,
    pickLogEntry,
    resolveLogLimit,
    LOG_TAIL,
    ACCOUNT_DIRS
} = require('../modules/menmaStatus');

const img = (n) => `17911${String(n).padStart(8, '0')}_generated_${n}.png`;
const STALE_BEFORE = '1788887037895_generated_2741281205.png';
const STALE_AFTER = '1788886947475_generated_749387718.png';

function logRow(id, extra = {}, cols = {}) {
    return {
        id,
        account_id: 'menma',
        at: new Date(Date.UTC(2026, 7, 28) + id * 3600e3).toISOString(),
        loop: 'pantry',
        date_local: '2026-09-01',
        slices: 8,
        stacks: 1,
        cake_type: 'black forest',
        cake_rating: null,
        kg_before: 50 + id,
        kg_after: 51 + id,
        gained_kg: 1,
        chair: null,
        named_for: '[]',
        before_img: img(id * 2),
        after_img: img(id * 2 + 1),
        landed: '[]',
        left_open: '[]',
        extra_data: JSON.stringify({ visual_gen_status: 'provided', ...extra }),
        ...cols
    };
}

function fakeDb(rows, state) {
    const updates = [];
    return {
        rows,
        updates,
        async get(sql, params) {
            if (/cake_pantry_meta/.test(sql)) return { value: '2026-09-01T00:00:00Z' };
            if (/FROM cake_pantry_log WHERE account_id = \? AND id = \?/.test(sql)) {
                return rows.find((r) => r.account_id === params[0] && Number(r.id) === Number(params[1]));
            }
            return undefined;
        },
        async all(sql, params) {
            if (/FROM cake_pantry_log/.test(sql)) {
                let out = rows.filter((r) => r.account_id === params[0]).slice().sort((a, b) => a.id - b.id);
                if (/ORDER BY id DESC/.test(sql)) out = out.reverse();
                if (/LIMIT \?/.test(sql)) out = out.slice(0, params[1]);
                return out.map((r) => ({ ...r }));
            }
            if (/FROM cake_pantry_state/.test(sql) && /work_pile_/.test(sql)) return [];
            if (/FROM cake_pantry_state/.test(sql)) {
                return Object.entries(state[params[0]] || {}).map(([key, value]) => ({ key, value: JSON.stringify(value) }));
            }
            return [];
        },
        async run(sql, params) {
            updates.push({ sql, params });
            if (/UPDATE cake_pantry_log/.test(sql)) {
                const [before, after, extra, id, accountId] = params;
                const t = rows.find((r) => Number(r.id) === Number(id) && r.account_id === accountId);
                if (t) { t.before_img = before; t.after_img = after; t.extra_data = extra; }
                return { changes: t ? 1 : 0 };
            }
            return { changes: 0 };
        },
        async exec() {}
    };
}

(async () => {
    // --- limits
    assert.ok(LOG_TAIL >= 100, 'Pantry Log default must cover every meal, not a 16-meal tail');
    assert.strictEqual(resolveLogLimit(undefined), LOG_TAIL);
    assert.strictEqual(resolveLogLimit('abc'), LOG_TAIL);
    assert.strictEqual(resolveLogLimit(0), LOG_TAIL);
    assert.strictEqual(resolveLogLimit(5), 5);
    assert.strictEqual(resolveLogLimit(99999), 1000);

    // --- compose: stale not_generated reads as provided only when both shots exist
    assert.strictEqual(composeCakeLogEntry(logRow(1, { visual_gen_status: 'not_generated' })).visual_gen_status, 'provided');
    assert.strictEqual(composeCakeLogEntry(logRow(2, { visual_gen_status: 'not_generated' }, { after_img: null })).visual_gen_status, 'not_generated');
    assert.strictEqual(composeCakeLogEntry(logRow(3, { visual_gen_status: 'skipped' })).visual_gen_status, 'skipped');
    const noField = logRow(4); noField.extra_data = '{}';
    assert.ok(!('visual_gen_status' in composeCakeLogEntry(noField)), 'must not invent the field');
    const picked = pickLogEntry(composeCakeLogEntry(logRow(5)));
    assert.strictEqual(picked.meal_id, '5');
    assert.strictEqual(picked.before, img(10));

    // --- status: 58 meals, an old re-pointed one (54-style) must be in cake_log
    const rows = [];
    for (let i = 1; i <= 58; i++) rows.push(logRow(i));
    rows[9].before_img = '1791178597483_generated_1853559052.png';
    const state = {
        menma: {
            character: { name: 'Menma' },
            current_kg: 109,
            baseline_kg: 54,
            last_before: STALE_BEFORE,
            last_after: STALE_AFTER,
            history: [{ at: rows[57].at, kg: 109, before: STALE_BEFORE, after: STALE_AFTER }]
        }
    };
    const db = fakeDb(rows, state);
    const gr = { getTagDatabase: () => ({ db }) };
    const status = await buildAccountStatus(gr, 'menma');
    assert.strictEqual(status.success, true, status.error);
    assert.strictEqual(status.cake_log.length, 58, 'all meals must reach the Log tab');
    assert.ok(status.cake_log.some((e) => e.before === '1791178597483_generated_1853559052.png' && e.meal_id === '10'));
    assert.strictEqual(status.last_before, img(116), 'last_before must follow the newest meal, not stale state');
    assert.strictEqual(status.last_after, img(117));
    assert.strictEqual(status.last_meal.before, img(116));
    const limited = await buildAccountStatus(gr, 'menma', { logLimit: 16 });
    assert.strictEqual(limited.cake_log.length, 16);
    const all = await buildAllAccountsStatus(gr, { logLimit: 3 });
    assert.strictEqual(all.accounts.menma.cake_log.length, 3);

    // empty log falls back to state
    const emptyGr = { getTagDatabase: () => ({ db: fakeDb([], state) }) };
    const empty = await buildAccountStatus(emptyGr, 'menma');
    assert.strictEqual(empty.last_before, STALE_BEFORE);

    // --- update_meal_images: not_generated + both shots -> provided; frozen fields untouched
    const target = logRow(99, { visual_gen_status: 'not_generated', pending_slices_after: 2 }, { before_img: null, after_img: null });
    const udb = fakeDb([target], state);
    const known = new Set([img(1000), img(1001)]);
    const resolveImage = (id) => (known.has(id) ? id : null);
    const half = _test.applyMealImageUpdate(composeCakeLogEntry(target), { before: img(1000), now: 'x' });
    assert.strictEqual(half.meal.visual_gen_status, 'not_generated', 'one shot only stays not_generated');
    const res = await updateMealImages('menma', { meal_id: '99', before_image: img(1000), after_image: img(1001) }, {
        now: '2026-10-05T06:00:00.000Z', resolveImage, importStatus: { imported: true, db: udb }
    });
    assert.strictEqual(res.success, true, res.error);
    assert.strictEqual(res.visual_gen_status, 'provided');
    const after = udb.rows[0];
    const extra = JSON.parse(after.extra_data);
    assert.strictEqual(extra.visual_gen_status, 'provided');
    assert.strictEqual(extra.pending_slices_after, 2);
    assert.strictEqual(after.before_img, img(1000));
    assert.strictEqual(after.kg_before, 149);
    assert.strictEqual(after.slices, 8);
    for (const u of udb.updates) {
        assert.ok(!/kg_before|kg_after|gained_kg|slices|date_local/.test(u.sql));
    }

    // --- inspect_pantry last_* prefer the newest meal
    const insp = await inspectPantry('menma', {}, {
        state: { ...state.menma, pending_deliveries: [], pending_feeds: [] },
        cakeLog: [composeCakeLogEntry(rows[56]), composeCakeLogEntry(rows[57])]
    });
    assert.strictEqual(insp.last_before, img(116));
    assert.strictEqual(insp.last_after, img(117));
    const inspNoLog = await inspectPantry('menma', {}, {
        state: { ...state.menma, pending_deliveries: [], pending_feeds: [] },
        cakeLog: []
    });
    assert.strictEqual(inspNoLog.last_before, STALE_BEFORE);

    // --- Rook + Sala eaters (Oct 5): accepted everywhere, 54 kg base, lazy state
    const fs = require('fs');
    const path = require('path');
    const facadeSrc = fs.readFileSync(path.join(__dirname, '../modules/mcpAgentFacade.js'), 'utf8');
    const appletSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/menmaDsapApplet.js'), 'utf8');
    const OLD_LIST = "['menma', 'hoshino', 'ivory', 'pyra', 'chiyo', 'guren']";
    assert.ok(!facadeSrc.includes(OLD_LIST), 'facade must not keep a 6-eater list');
    assert.ok(!appletSrc.includes(OLD_LIST), 'applet must list the new eaters');
    for (const id of ['rook', 'sala']) {
        assert.ok(VALID_ACCOUNT_IDS.includes(id));
        assert.strictEqual(ACCOUNT_DEFS[id].baseline_kg, 54);
        assert.strictEqual(ACCOUNT_DIRS[id], `.${id}`);
        const fresh = await inspectPantry(id, {}, { state: {}, cakeLog: [] });
        assert.strictEqual(fresh.success, true);
        assert.strictEqual(fresh.baseline_kg, 54);
        assert.strictEqual(fresh.current_kg, 54);
        assert.strictEqual(fresh.slices_eaten_total, undefined);
    }
    for (const id of ['menma', 'hoshino', 'ivory', 'pyra', 'chiyo', 'guren']) {
        assert.ok(VALID_ACCOUNT_IDS.includes(id));
        assert.strictEqual(ACCOUNT_DEFS[id].baseline_kg, 54);
    }
    const eight = await buildAllAccountsStatus(gr, { logLimit: 1 });
    assert.deepStrictEqual(Object.keys(eight.accounts), ['menma', 'hoshino', 'ivory', 'pyra', 'chiyo', 'guren', 'rook', 'sala']);
    assert.strictEqual(eight.accounts.rook.available, false, 'no state is written for a new eater by a status poll');

    console.log('test-cake-pantry-ui-meal-images: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
