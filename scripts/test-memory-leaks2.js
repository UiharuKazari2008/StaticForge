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

// 1. Check localPromptOptimizer
runTest('localPromptOptimizer caps', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/localPromptOptimizer.js'), 'utf8');
    assert.ok(content.includes('this.synonymCache.delete(first)'), 'missing synonymCache delete');
    assert.ok(content.includes('this.tagCache.delete(first)'), 'missing tagCache delete');
});

// 2. Check wordLookupService
runTest('wordLookupService sweep', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/wordLookupService.js'), 'utf8');
    assert.ok(content.includes('this.cache.delete(k)'), 'missing cache sweep delete');
});

// 3. Check tag-lookup
runTest('tag-lookup sweep', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/tag-lookup.js'), 'utf8');
    assert.ok(content.includes('this.tagGroupPresenceCache.clear()'), 'missing presence cache clear');
});

// 4. Check agentClientBridge
runTest('agentClientBridge testingOffer sweep', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/agentClientBridge.js'), 'utf8');
    assert.ok(content.includes('testingOfferState.delete(key)'), 'missing testingOfferState sweep delete');
});

// 5. Check toolBodies and cancelledGeneration
runTest('toolBodies / cancelledGeneration caps', () => {
    const wsContent = fs.readFileSync(path.join(__dirname, '../modules/websocketHandlers.js'), 'utf8');
    assert.ok(wsContent.includes('cancelledGenerationRequestIds.delete(id)'), 'missing cancelled delete');
    assert.ok(wsContent.includes('new Map()'), 'cancelledGeneration should be a Map');

    const cdContent = fs.readFileSync(path.join(__dirname, '../modules/cursorDirector.js'), 'utf8');
    assert.ok(cdContent.includes('TOOL_BODIES_MAX_BYTES'), 'missing byte cap logic');
});

// 6. Check databaseCheckpoint absoluteCap
runTest('databaseCheckpoint absoluteCap', () => {
    const content = fs.readFileSync(path.join(__dirname, '../modules/databaseCheckpoint.js'), 'utf8');
    assert.ok(content.includes('const absoluteCap = Math.max(this.maxCheckpoints * 2, 50);'), 'missing absoluteCap definition');
    assert.ok(content.includes('fs.unlinkSync(fullPath)'), 'missing cleanup operations within absoluteCap check');
});

console.log(`\nTests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);

if (failed > 0) process.exit(1);
