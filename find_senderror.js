const { execSync } = require('child_process');
const output = execSync('grep -rn "sendError" modules/').toString();
const lines = output.split('\n');
const missingRequestId = lines.filter(line => {
    if (!line.includes('sendError')) return false;
    // Basic heuristics: looks like a function call
    if (line.match(/sendError\s*\(/)) {
        if (!line.includes('requestId') && !line.includes('message.requestId')) {
            return true;
        }
    }
    return false;
});
console.log(missingRequestId.join('\n'));
