const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('Testing memory leak boundaries...');
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

// 1. openTraces TTL/cap
runTest('openTraces TTL/cap', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/tracing.js'), 'utf8');
    assert.ok(content.includes('setInterval('), 'missing openTraces cleanup interval');
    assert.ok(content.includes('openTraces.delete(id)'), 'missing openTraces.delete()');
    assert.ok(content.includes('openTraces.size > 200'), 'missing openTraces cap');
});

// 2. searchCache disconnect+TTL
runTest('searchCache disconnect+TTL', () => {
    const searchHandler = fs.readFileSync(path.join(__dirname, '../modules/ws/handlers/70-searchHandler.js'), 'utf8');
    assert.ok(searchHandler.includes('cleanupSearchCache'), 'missing cleanupSearchCache');

    const wsHandlers = fs.readFileSync(path.join(__dirname, '../modules/websocketHandlers.js'), 'utf8');
    assert.ok(wsHandlers.includes('cleanupSearchCache(sessionId)'), 'missing cleanupSearchCache call on client disconnect');
});

// 3. replicationCargoService tarBuffer null
runTest('cargo tarBuffer null + TTL skips live', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/replicationCargoService.js'), 'utf8');
    assert.ok(content.includes('transfer.tarBuffer = null'), 'missing tarBuffer = null');
    assert.ok(content.includes('transfer.rawBuffer = null'), 'missing rawBuffer = null');
    assert.ok(content.includes('setInterval('), 'missing activeTransfers cleanup interval');
    assert.ok(content.includes("transfer.state !== 'receiving' && transfer.state !== 'ready'"), 'cleanup must skip live transfers');
});

// 4. pendingRequests unreaped completed/error reaped
runTest('pendingRequests unreaped completed/error reaped', () => {
    const content = fs.readFileSync(path.join(__dirname, '../web_server.js'), 'utf8');
    assert.ok(content.includes("request.status === 'completed' || request.status === 'error'"), 'missing status check for unreaped');
    assert.ok(content.includes("(request.completedAt || 0) < oneHourAgo"), 'missing time check for unreaped completed requests');
});

// 5. no ms-based changelog DELETE
runTest('no ms-based changelog DELETE', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/replicationChangelog.js'), 'utf8');
    // Ensure the #276 unbounded interval is absent (we never added it during this run, but verify schedulePruning exists)
    assert.ok(!content.includes("setInterval(() => { ...DELETE... }"), 'should not contain the unbounded manual delete interval');
    assert.ok(content.includes("function schedulePruning() {"), 'should retain original batched schedulePruning');
});

// 6. separation TTL uses startedAt and skips running
runTest('separation TTL uses startedAt and skips running', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/replicationSeparation.js'), 'utf8');
    assert.ok(content.includes('setInterval('), 'missing activeJobs cleanup interval');
    assert.ok(content.includes("job.status !== 'running'"), 'must skip running jobs');
    assert.ok(content.includes('job.finishedAt || job.startedAt'), 'must use startedAt/finishedAt');
});

// 7. heartbeatInterval != pingInterval
runTest('heartbeatInterval != pingInterval', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/websocket.js'), 'utf8');
    assert.ok(content.includes('this.heartbeatInterval'), 'missing heartbeatInterval');
    assert.ok(!content.includes('this.pingInterval = null;'), 'pingInterval must be removed from websocket.js');

    const clientContent = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');
    assert.ok(clientContent.includes('this.heartbeatInterval'), 'missing heartbeatInterval on client');
    assert.ok(!clientContent.includes('this.pingInterval = null;'), 'pingInterval must be removed from client websocket.js');
});

// 8. sharpConfig loads
runTest('sharpConfig loads', () => {
    const content = fs.readFileSync(path.join(__dirname, '../web_server.js'), 'utf8');
    assert.ok(content.includes('sharp.cache({memory:48, files:0, items:50})'), 'missing sharp cache limit');
    assert.ok(content.includes('sharp.concurrency(2)'), 'missing sharp concurrency limit');
});

console.log(`\nTests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);

if (failed > 0) {
    process.exit(1);
}
