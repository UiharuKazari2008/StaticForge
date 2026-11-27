#!/usr/bin/env node
/**
 * scripts/check-ws-names.js decision logic (Yozora #1350): a nameless request fails, a named one passes, a request
 * with ticker:false passes, a name or quiet entry for an unregistered type fails, a rise over the baseline fails,
 * a fall passes, answers are never asked for a name, and the generated client block lists names and ticker-off types.
 */
const assert = require('assert');
const { evaluate, generateBlock, readClientBlock } = require('./check-ws-names');

const item = (type, o = {}) => Object.assign({ type, file: 'modules/ws/handlers/1-a.js', name: '', ticker: null }, o);
const run = (items, o = {}) => evaluate(Object.assign({ items, names: {}, quiet: [], baseline: { files: {} }, accept: [] }, o));

// a nameless request fails (a new file must be clean)
let r = run([item('do_thing')]);
assert.strictEqual(r.totals.undecided, 1);
assert.strictEqual(r.rises.length, 1);
assert.strictEqual(r.rises[0].file, 'modules/ws/handlers/1-a.js');

// a named request passes
r = run([item('do_thing', { name: 'Do Thing', ticker: true })]);
assert.strictEqual(r.totals.undecided, 0);
assert.strictEqual(r.rises.length, 0);

// ticker:false passes (machinery)
r = run([item('do_thing', { ticker: false })]);
assert.strictEqual(r.totals.undecided, 0);
assert.strictEqual(r.rises.length, 0);
assert.strictEqual(r.totals.quiet, 1);

// answers and pushes are never asked for a name
r = run(['a_response', 'a_error', 'a_update', 'a_progress'].map((t) => item(t)));
assert.strictEqual(r.totals.undecided, 0);
assert.strictEqual(r.totals.requests, 0);

// a name for a type that is not registered fails; so does a quiet entry
r = run([item('real', { name: 'Real', ticker: true })], { names: { real: 'Real', gone: 'Gone' }, quiet: ['also_gone'] });
assert.strictEqual(r.errors.length, 2);
assert.ok(r.errors.some((e) => /gone/.test(e) && /dead/.test(e)));
assert.ok(r.errors.some((e) => /also_gone/.test(e)));
assert.deepStrictEqual(r.dead, ['gone']);

// a rise over the baseline fails, equal passes, a fall passes and is reported
const two = [item('x1'), item('x2')];
r = run(two, { baseline: { files: { 'modules/ws/handlers/1-a.js': 1 } } });
assert.strictEqual(r.rises.length, 1);
assert.deepStrictEqual([r.rises[0].was, r.rises[0].is], [1, 2]);
r = run(two, { baseline: { files: { 'modules/ws/handlers/1-a.js': 2 } } });
assert.strictEqual(r.rises.length, 0);
r = run([item('x1')], { baseline: { files: { 'modules/ws/handlers/1-a.js': 2 } } });
assert.strictEqual(r.rises.length, 0);
assert.strictEqual(r.drops.length, 1);

// a rise Yukimi accepted is not a failure
r = run(two, { baseline: { files: {} }, accept: ['modules/ws/handlers/1-a.js'] });
assert.strictEqual(r.rises.length, 0);
assert.strictEqual(r.acceptedRises.length, 1);

// the generated block: every name (table order), then ticker-off types sorted
const block = generateBlock(
    [item('b_quiet', { ticker: false }), item('a_quiet', { ticker: false, name: 'A Quiet' }), item('c', { name: "It's C", ticker: true })],
    { c: "It's C", a_quiet: 'A Quiet' }
);
assert.ok(block.includes("'c': 'It\\'s C',"));
assert.ok(block.indexOf("'c':") < block.indexOf("'a_quiet':"), 'table order is kept');
assert.ok(block.indexOf("'a_quiet',") < block.indexOf("'b_quiet',"), 'ticker-off types are sorted');
assert.ok(!/'c',\s*\n/.test(block.split('TICKER_OFF_TYPES')[1]), 'a named, shown type is not ticker-off');
assert.ok(block.includes('static TICKER_OFF_TYPES = new Set(['));

// the markers: absent -> null; present -> the lines between them
assert.strictEqual(readClientBlock('class A {\n}\n'), null);
const cb = readClientBlock('x\n    // ws-names:begin (note)\n    a\n    b\n    // ws-names:end\ny');
assert.strictEqual(cb.inner, '    a\n    b');

console.log('check-ws-names tests passed');
