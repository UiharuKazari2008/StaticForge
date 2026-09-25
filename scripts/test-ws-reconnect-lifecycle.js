const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');

function assertIncludes(needle, label) {
    assert.ok(src.includes(needle), label || `missing ${needle}`);
}

function main() {
    assertIncludes("addEventListener('online'", 'online reconnect hook');
    assertIncludes('_reconnectOnFocusRegain(\'visibilitychange\')', 'visibility reconnect');
    assertIncludes('_reconnectOnFocusRegain(\'pageshow-bfcache\')', 'pageshow reconnect');
    assertIncludes('_reconnectOnFocusRegain(\'window-focus\')', 'focus reconnect');
    assertIncludes('_replaceStaleSocket(\'ping-liveness\')', 'ping liveness replace');
    assertIncludes('_armConnectingWatchdog', 'connecting watchdog');
    assertIncludes('_disposeExistingSocket', 'duplicate-socket guard');
    assertIncludes('exp * 0.2 * Math.random()', 'reconnect jitter');
    assertIncludes('DELAY_RECONNECT_MAX', 'reconnect cap');
    console.log('test-ws-reconnect-lifecycle: ok');
}

main();
