const fs = require('fs');

const swContent = fs.readFileSync('public/sw.js', 'utf8');

const targetLine = "event.waitUntil(deleteAndPrecache(event.data.url, event.data.requestId));";

if (swContent.includes(targetLine)) {
    console.log("Bug is fixed: event.waitUntil is present");
    process.exit(0);
} else {
    console.error("Bug is present: missing event.waitUntil");
    process.exit(1);
}
