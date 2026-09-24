const { readFileSync } = require('fs');
const content = readFileSync('modules/websocketHandlers.js', 'utf8');
const lines = content.split('\n');
console.log(lines[675]);
