const fs = require('fs');

const content = fs.readFileSync('public/scripts/comp/autocompleteUtils.js', 'utf8');

if (content.includes('function splitPromptAtTextColon')) {
    console.error('Test failed: splitPromptAtTextColon is still present.');
    process.exit(1);
}

if (content.includes('function findTextColonIndex')) {
    console.error('Test failed: findTextColonIndex is still present.');
    process.exit(1);
}

console.log('Test passed: Dead code successfully removed.');
