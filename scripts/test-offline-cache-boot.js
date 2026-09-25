const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/serviceWorkerManager.js'), 'utf8');

function assertIncludes(needle, label) {
    assert.ok(src.includes(needle), label || `missing ${needle}`);
}

function main() {
    assertIncludes("Loading offline cache…", 'boot copy still present');
    assertIncludes("Service worker registration timed out", 'register timeout');
    assertIncludes("Service Worker ready timeout — continuing from network", 'ready fallback');
    assertIncludes('AbortSignal.timeout(8000)', 'manifest fetch timeout');
    assertIncludes('Boot gate timed out — continuing from network', 'ensureBootComplete timeout');
    assert.ok(!src.includes('Service worker failed to become ready in time'), 'ready path must not reject fatally');
    assert.ok(!src.includes('Hard wait — no timeout bypass'), 'hard wait comment should be gone');
    console.log('test-offline-cache-boot: ok');
}

main();
