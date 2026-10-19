const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../modules/cursorDirector.js'), 'utf8');
assert.ok(!src.includes('checkIdle().xi'), 'dead idle check should be removed');
assert.ok(src.includes("require('./xiDirector').runtimeStatus()"), 'should use runtimeStatus');
console.log('PASS test-director-idle-check-deadcode');
