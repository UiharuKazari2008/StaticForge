const fs = require('fs');
const assert = require('assert');

// Read textReplacementManager.js file content
const code = fs.readFileSync('public/scripts/comp/textReplacementManager.js', 'utf8');

// Verify dead variables typeSelect and closeBtn in initializeCreateTextReplacementModal were cleaned up
assert(!code.includes("const typeSelect = document.getElementById('textReplacementTypeSelect');"), 'typeSelect variable should be removed');
assert(!code.includes("const closeBtn = document.getElementById('closeCreateTextReplacementBtn');"), 'closeBtn variable should be removed');

console.log('Test passed: textReplacementManager.js dead element handle cleanup verified.');
