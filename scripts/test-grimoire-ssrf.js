const assert = require('assert');
const fs = require('fs');

const code = fs.readFileSync(__dirname + '/../services/grimoire-browser/server.js', 'utf8');

// We extract normalizeWebUrl to test it without running the server
const extractFunc = code.match(/function normalizeWebUrl\s*\([^)]*\)\s*{[\s\S]*?^}/m);
if (!extractFunc) throw new Error("Could not find normalizeWebUrl");

const normalizeWebUrl = new Function('value', extractFunc[0] + ' return normalizeWebUrl(value);');

console.log("Testing normalizeWebUrl SSRF blocks...");

const allowed = [
    'http://example.com',
    'https://google.com/',
    'chrome://version',
    'chrome-extension://someid/page.html'
];

const blocked = [
    'http://127.0.0.1',
    'http://localhost',
    'http://0.0.0.0',
    'http://169.254.169.254/latest/meta-data/',
    'https://192.168.1.1',
    'http://10.0.0.5',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://[::1]',
    'http://[fc00::1]',
    'http://[fe80::1]'
];

for (const url of allowed) {
    const res = normalizeWebUrl(url);
    if (!res) throw new Error("Should allow: " + url);
}

for (const url of blocked) {
    const res = normalizeWebUrl(url);
    if (res) throw new Error("Should block: " + url + " (returned: " + res + ")");
}

console.log("All SSRF blocks work as expected.");
