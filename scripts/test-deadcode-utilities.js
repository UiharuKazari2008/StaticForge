const fs = require('fs');
const path = require('path');
const assert = require('assert');

const utilitiesPath = path.join(__dirname, '..', 'public', 'scripts', 'comp', 'utilities.js');
const utilitiesContent = fs.readFileSync(utilitiesPath, 'utf8');

assert(!utilitiesContent.includes('function hasWhitespaceBeforeIndex'), 'hasWhitespaceBeforeIndex should be removed');
assert(!utilitiesContent.includes('function skipPromptWhitespaceBackward'), 'skipPromptWhitespaceBackward should be removed');

console.log('Passed: Dead utilities functions successfully removed and verified.');
