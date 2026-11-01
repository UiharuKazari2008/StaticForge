const assert = require('assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');

// Extract workspaceCardName code for isolated testing
const match = code.match(/workspaceCardName\([^)]*\)\s*\{[^}]+}/);
if (!match) {
    throw new Error('Failed to extract workspaceCardName from director.js');
}

let funcStr = match[0];
funcStr = 'function ' + funcStr; // Convert to standard function declaration
const workspaceCardName = new Function('data', 'return (function() { ' + funcStr + '; return workspaceCardName(data); })();');

// Execute without workspaces defined globally
try {
    const res = workspaceCardName({ workspaceId: '123' });
    assert.strictEqual(res, '123'); // fallback when workspaces is missing and workspaceName is missing
    console.log('Test passed. No ReferenceError.');
} catch (e) {
    if (e.name === 'ReferenceError' && e.message.includes('workspaces')) {
        console.error('Test failed: ReferenceError workspaces is not defined');
        process.exit(1);
    }
    throw e;
}
