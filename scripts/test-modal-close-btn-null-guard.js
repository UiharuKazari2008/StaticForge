const fs = require('fs');
const path = require('path');
const assert = require('assert');

const filesToTest = [
    'public/scripts/comp/characterPositionToolManager.js',
    'public/scripts/comp/stageResultsReview.js',
    'public/scripts/comp/usageToolManager.js'
];

for (const relPath of filesToTest) {
    const fullPath = path.join(__dirname, '..', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Ensure no unsafe document.getElementById(...).addEventListener exists in these files
    const unsafeMatch = content.match(/document\.getElementById\([^)]+\)\.addEventListener/g);
    assert.strictEqual(
        unsafeMatch,
        null,
        `Expected no unsafe document.getElementById(...).addEventListener calls in ${relPath}`
    );

    // Verify optional chaining is used
    const safeMatch = content.match(/document\.getElementById\([^)]+\)\?\.\s*addEventListener/g);
    assert.ok(
        safeMatch && safeMatch.length > 0,
        `Expected safe document.getElementById(...)...addEventListener calls in ${relPath}`
    );
}

console.log('All modal close button optional chaining checks passed successfully.');
