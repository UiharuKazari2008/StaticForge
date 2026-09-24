const { readFileSync } = require('fs');
const content = readFileSync('modules/websocketHandlers.js', 'utf8');
const lines = content.split('\n');
const sendErrorLines = lines.map((l, i) => [i + 1, l]).filter(([i, l]) => l.includes('sendError('));
console.log(sendErrorLines.filter(([i, l]) => !l.includes('requestId')));
