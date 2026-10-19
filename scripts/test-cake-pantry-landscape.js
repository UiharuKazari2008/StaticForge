#!/usr/bin/env node
'use strict';

/**
 * consume_cake landscape from meal image size, update_meal_images correction,
 * and one-time backfill of meals 146-148 (Yozora #569).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    updateMealImages,
    _test
} = require('../modules/cakePantry');

assert.ok(!_test.MEAL_FROZEN_KEYS.includes('landscape'), 'landscape must not be frozen');
assert.deepStrictEqual(_test.LANDSCAPE_BACKFILL_MEAL_IDS, ['146', '147', '148']);

assert.strictEqual(_test.landscapeFromDimensions(1280, 720), true);
assert.strictEqual(_test.landscapeFromDimensions(720, 1280), false);
assert.strictEqual(_test.landscapeFromDimensions(1024, 1024), false);
assert.strictEqual(_test.landscapeFromDimensions(0, 10), null);
assert.strictEqual(_test.landscapeFromDimensions('nope', 10), null);

function writePng(filePath, width, height) {
    const buf = Buffer.alloc(24);
    buf[0] = 0x89;
    buf.write('PNG\r\n\x1a\n', 1, 7, 'ascii');
    buf.writeUInt32BE(13, 8);
    buf.write('IHDR', 12, 4, 'ascii');
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    fs.writeFileSync(filePath, buf);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cake-landscape-'));
try {
    const wide = path.join(tmp, 'wide.png');
    const tall = path.join(tmp, 'tall.png');
    writePng(wide, 1408, 792);
    writePng(tall, 832, 1216);
    assert.deepStrictEqual(_test.readPngSize(wide), { width: 1408, height: 792 });
    assert.deepStrictEqual(_test.readPngSize(tall), { width: 832, height: 1216 });

    const sizes = {
        'wide.png': { width: 1408, height: 792 },
        'tall.png': { width: 832, height: 1216 }
    };
    const opts = { resolveImageSize: (id) => sizes[id] || null };
    assert.strictEqual(_test.inferLandscapeFromImages('tall.png', 'wide.png', opts), true);
    assert.strictEqual(_test.inferLandscapeFromImages('wide.png', 'tall.png', opts), false);
    assert.strictEqual(_test.resolveMealLandscape({}, 'wide.png', 'wide.png', opts, false), true);
    assert.strictEqual(_test.resolveMealLandscape({ landscape: false }, 'wide.png', 'wide.png', opts, true), false);
    assert.strictEqual(_test.resolveMealLandscape({}, null, null, opts, false), false);

    const applied = _test.applyMealImageUpdate({
        meal_id: '146',
        slices: 8,
        kg_before: 54,
        landscape: false,
        before: 'tall.png',
        after: 'tall.png'
    }, {
        before: 'wide.png',
        after: 'wide.png',
        landscape: true,
        now: '2026-10-19T00:00:00.000Z',
        client: 'test'
    });
    assert.ok(applied.ok);
    assert.strictEqual(applied.meal.landscape, true);
    assert.strictEqual(applied.frozen_before.landscape, undefined);
    assert.strictEqual(applied.frozen_after.landscape, undefined);
    assert.strictEqual(applied.frozen_before.slices, applied.frozen_after.slices);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

function createFakePantryDb(rows) {
    const store = rows.map((row) => ({ ...row }));
    const meta = [];
    return {
        rows: store,
        meta,
        async get(sql, params) {
            if (/account_id = \? AND id = \?/.test(sql)) {
                return store.find((r) => r.account_id === params[0] && Number(r.id) === Number(params[1]));
            }
            if (/FROM cake_pantry_log WHERE id = \?/.test(sql)) {
                return store.find((r) => Number(r.id) === Number(params[0]));
            }
            if (/FROM cake_pantry_meta/.test(sql)) {
                return meta.find((r) => r.account_id === params[0] && r.key === params[1]);
            }
            return undefined;
        },
        async all(sql, params) {
            if (/FROM cake_pantry_log/.test(sql)) {
                return store.filter((r) => r.account_id === params[0]);
            }
            return [];
        },
        async run(sql, params) {
            if (/UPDATE cake_pantry_log/.test(sql)) {
                const row = store.find((r) => Number(r.id) === Number(params[3]) && r.account_id === params[4]);
                if (row) {
                    row.before_img = params[0];
                    row.after_img = params[1];
                    row.extra_data = params[2];
                }
                return;
            }
            if (/INSERT OR REPLACE INTO cake_pantry_meta/.test(sql)) {
                const existing = meta.find((r) => r.account_id === params[0] && r.key === params[1]);
                if (existing) {
                    existing.value = params[2];
                    existing.updated_at = params[3];
                } else {
                    meta.push({ account_id: params[0], key: params[1], value: params[2], updated_at: params[3] });
                }
            }
        }
    };
}

(async () => {
    const sizes = {
        'meal-wide.png': { width: 1216, height: 832 },
        'meal-tall.png': { width: 832, height: 1216 }
    };
    const db = createFakePantryDb([
        {
            id: 146,
            account_id: 'guren',
            at: '2026-10-01T00:00:00.000Z',
            slices: 8,
            kg_before: 54,
            kg_after: 54.96,
            before_img: 'meal-wide.png',
            after_img: 'meal-wide.png',
            extra_data: JSON.stringify({ landscape: false })
        },
        {
            id: 147,
            account_id: 'guren',
            at: '2026-10-02T00:00:00.000Z',
            slices: 8,
            kg_before: 54.96,
            kg_after: 55.92,
            before_img: 'meal-tall.png',
            after_img: 'meal-tall.png',
            extra_data: JSON.stringify({ landscape: true })
        },
        {
            id: 148,
            account_id: 'ivory',
            at: '2026-10-03T00:00:00.000Z',
            slices: 4,
            kg_before: 54,
            kg_after: 54.48,
            before_img: 'meal-wide.png',
            after_img: 'meal-wide.png',
            extra_data: JSON.stringify({ landscape: false })
        }
    ]);

    const first = await _test.runLandscapeBackfillOnce({
        db,
        resolveImageSize: (id) => sizes[id] || null
    });
    assert.strictEqual(first.skipped, false, first.error);
    assert.strictEqual(first.results.length, 3);
    assert.strictEqual(first.results[0].landscape, true);
    assert.strictEqual(first.results[1].landscape, false);
    assert.strictEqual(first.results[2].landscape, true);
    assert.strictEqual(JSON.parse(db.rows[0].extra_data).landscape, true);
    assert.strictEqual(JSON.parse(db.rows[1].extra_data).landscape, false);
    assert.strictEqual(JSON.parse(db.rows[2].extra_data).landscape, true);
    assert.strictEqual(db.rows[0].kg_before, 54);
    assert.strictEqual(db.rows[1].slices, 8);

    const again = await _test.runLandscapeBackfillOnce({
        db,
        resolveImageSize: (id) => sizes[id] || null
    });
    assert.strictEqual(again.skipped, true);
    assert.strictEqual(again.reason, 'already');

    const known = new Set(['meal-wide.png', 'meal-tall.png']);
    const updated = await updateMealImages('guren', {
        meal_id: '146',
        after_image: 'meal-tall.png'
    }, {
        now: '2026-10-19T12:00:00.000Z',
        client: 'test',
        resolveImage: (id) => (known.has(id) ? id : null),
        resolveImageSize: (id) => sizes[id] || null,
        importStatus: { imported: true, db }
    });
    assert.strictEqual(updated.success, true, updated.error);
    assert.strictEqual(updated.meal.landscape, false);

    const explicit = await updateMealImages('ivory', {
        meal_id: '148',
        before_image: 'meal-wide.png',
        landscape: false
    }, {
        now: '2026-10-19T12:00:00.000Z',
        resolveImage: (id) => (known.has(id) ? id : null),
        resolveImageSize: (id) => sizes[id] || null,
        importStatus: { imported: true, db }
    });
    assert.strictEqual(explicit.success, true, explicit.error);
    assert.strictEqual(explicit.meal.landscape, false);

    const facadeSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/mcpAgentFacade.js'), 'utf8');
    assert.match(facadeSrc, /derive from before_image\/after_image pixel size/);
    assert.match(facadeSrc, /Correct the meal landscape flag/);

    console.log('test-cake-pantry-landscape: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
