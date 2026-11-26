#!/usr/bin/env node
// #1230: a model that refuses reasoning_effort is learned once, kept on disk, and warned about once.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'noeffort-')), 'sub', 'm.json');
process.env.DREAMSCAPE_NO_EFFORT_FILE = f;
const store = require('../modules/noEffortStore');
assert.strictEqual(store.has('tokenrouter|deepseek/x'), false);
assert.strictEqual(store.add('tokenrouter|deepseek/x'), true, 'first add is new (warn)');
assert.strictEqual(store.add('tokenrouter|deepseek/x'), false, 'second add is silent');
store.reset(); // a restart
assert.strictEqual(store.has('tokenrouter|deepseek/x'), true, 'survives restart');
assert.strictEqual(store.add('tokenrouter|deepseek/x'), false, 'no re-warn after restart');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), ['tokenrouter|deepseek/x']);
assert.ok(require('fs').readFileSync(path.join(__dirname, '../modules/agentSupervisor.js'), 'utf8').includes("require('./noEffortStore')"), 'callEngine uses the store');
console.log('test-no-effort-persist: ok');
