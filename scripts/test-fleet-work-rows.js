#!/usr/bin/env node
'use strict';

/**
 * #1256 queue display: a Sent Back row shows its age, a row whose session is gone says so, a parked item reads
 * "Needs a person". Runs the pure helpers of public/scripts/comp/wmClaudeAccounts.js (the qage block), the
 * MCP row builder of modules/claudeFleetMcp.js and the Fleet feed's row builder.
 *
 *   node scripts/test-fleet-work-rows.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmClaudeAccounts.js'), 'utf8');
const block = ui.slice(ui.indexOf('// qage:begin'), ui.indexOf('// qage:end'));
assert.ok(block.includes('function qAgeText') && block.includes('function qWorkLabel'), 'qage block found');
const QSTATE = { held: 'Waiting', queued: 'Queued', starting: 'Starting', running: 'Running', waiting: 'Sent Back', input: 'Input', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
const { qAgeText, qWorkLabel } = new Function('QSTATE', `${block}\nreturn { qAgeText, qWorkLabel };`)(QSTATE);
const { workRow, ageText } = require('../modules/claudeFleetMcp')._test;

const NOW = 1_800_000_000_000;
const MIN = 60000;
const base = { id: 7, title: 'T', source: 'fleet', createdAt: NOW - 1000, message: 'm' };

// client label
assert.strictEqual(qAgeText(NOW - 45 * MIN, NOW), '45 min');
assert.strictEqual(qAgeText(NOW - (2 * 60 + 10) * MIN, NOW), '2 h 10 min');
assert.strictEqual(qAgeText(NOW - 3 * 60 * MIN, NOW), '3 h');
assert.strictEqual(qAgeText(NOW - 26 * 60 * MIN, NOW), '1 d 2 h');
assert.strictEqual(qAgeText(NOW - 10000, NOW), 'under 1 min');
assert.strictEqual(qAgeText(null, NOW), '');
assert.strictEqual(qWorkLabel({ state: 'waiting', sentBackAt: NOW - 45 * MIN }, NOW), 'Sent Back 45 min');
assert.strictEqual(qWorkLabel({ state: 'waiting', sentBackAt: NOW - 130 * MIN }, NOW), 'Sent Back 2 h 10 min');
assert.strictEqual(qWorkLabel({ state: 'waiting', sentBackAt: null }, NOW), 'Sent Back');
assert.strictEqual(qWorkLabel({ state: 'waiting' }, NOW), 'Sent Back', 'fields absent: today');
assert.strictEqual(qWorkLabel({ state: 'input', parked: true, parkedAt: NOW - 3 * 60 * MIN }, NOW), 'Needs a person 3 h');
assert.strictEqual(qWorkLabel({ state: 'input', parked: true }, NOW), 'Needs a person');
assert.strictEqual(qWorkLabel({ state: 'input' }, NOW), 'Input', 'ordinary question stays Input');
assert.strictEqual(qWorkLabel({ state: 'running', sentBackAt: NOW - MIN }, NOW), 'Running', 'age only while Sent Back');
// the client text and the MCP text agree
for (const m of [1, 45, 59, 60, 130, 1500, 3000]) assert.strictEqual(qAgeText(NOW - m * MIN, NOW), ageText(NOW - m * MIN, NOW));

// MCP rows
const row = (w) => workRow(Object.assign({}, base, w));
const plain = row({ state: 'running' });
assert.strictEqual(plain.state, 'Running');
for (const k of ['sentBackFor', 'sessionGone', 'parkedFor']) assert.ok(!(k in plain), `${k} absent on an ordinary row`);
assert.deepStrictEqual(Object.keys(row({ state: 'waiting' })).sort(), Object.keys(plain).sort(), 'Sent Back without fields: same keys as today');
const origNow = Date.now; Date.now = () => NOW;
try {
    assert.strictEqual(row({ state: 'waiting', sentBackAt: NOW - 130 * MIN }).sentBackFor, '2 h 10 min');
    assert.strictEqual(row({ state: 'waiting', sentBackAt: NOW - 45 * MIN }).sentBackFor, '45 min');
    const gone = row({ state: 'waiting', sentBackAt: NOW - 45 * MIN, sessionGone: true });
    assert.strictEqual(gone.sessionGone, true); assert.strictEqual(gone.state, 'Sent Back');
    const parked = row({ state: 'input', parked: true, parkedAt: NOW - 60 * MIN });
    assert.strictEqual(parked.state, 'Input Required (needs a person)'); assert.strictEqual(parked.parkedFor, '1 h');
    assert.strictEqual(row({ state: 'input' }).state, 'Input Required');
} finally { Date.now = origNow; }

// feed rows carry the fields (absent = falsy)
const feed = fs.readFileSync(path.join(ROOT, 'modules/fleetPhoneFeed.js'), 'utf8');
assert.ok(/sentBackAt: w\.sentBackAt \|\| null, sessionGone: !!w\.sessionGone, parked: !!w\.parked, parkedAt: w\.parkedAt \|\| null/.test(feed), 'feed copies the four fields');
console.log('fleet work rows: all passed');
