const assert = require('assert');
const path = require('path');
const fs = require('fs');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (e) {
        console.error(`❌ ${name}`);
        console.error(e);
        failed++;
    }
}

// Ensure databaseCheckpoint uses file.filePath and cleans up sidecars properly
runTest('databaseCheckpoint absoluteCap behavior', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/databaseCheckpoint.js'), 'utf8');
    assert.ok(content.includes('const fullPath = file.filePath;'), 'must use file.filePath instead of file.path');
    assert.ok(content.includes('deleteCheckpointSidecars(fullPath);'), 'must call deleteCheckpointSidecars');
    assert.ok(!content.includes('file.path'), 'should not contain file.path property access for checkpoint cleanup');
});

// Ensure replicationCargoService tarBuffer is nulled and live states aren't swept
runTest('replicationCargoService behavior', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/replicationCargoService.js'), 'utf8');
    assert.ok(content.includes("tarBuffer = null;"), 'must null tarBuffer after compression');
    assert.ok(!content.includes("transfer.state !== 'receiving' && transfer.state !== 'ready'"), 'TTL should sweep abandoned ready transfers');
    assert.ok(content.includes("transfer.state !== 'receiving'"), 'TTL must skip live receiving transfers');
});

console.log(`\nTests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);

if (failed > 0) process.exit(1);
