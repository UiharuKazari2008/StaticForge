const assert = require('assert');
const fs = require('fs');
const path = require('path');

function extractClassMethod(src, methodName) {
    const needles = [`\n    ${methodName}(`, `\n    async ${methodName}(`];
    let idx = -1;
    for (const needle of needles) {
        idx = src.indexOf(needle);
        if (idx >= 0) break;
    }
    if (idx < 0) {
        throw new Error(`missing method ${methodName}`);
    }
    const start = idx + 1;
    const open = src.indexOf('{', start);
    let depth = 0;
    let inStr = null;
    let escape = false;
    for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (inStr) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === inStr) {
                inStr = null;
            }
            continue;
        }
        if (ch === '/' && src[i + 1] === '/') {
            i = src.indexOf('\n', i);
            if (i < 0) break;
            continue;
        }
        if (ch === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            if (end < 0) break;
            i = end + 1;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch;
            continue;
        }
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return src.slice(start, i + 1);
            }
        }
    }
    throw new Error(`unbalanced ${methodName}`);
}

function bindMethod(target, src, name, extras) {
    const body = extractClassMethod(src, name);
    const trimmed = body.replace(/^\s+/, '');
    const isAsync = trimmed.startsWith('async ');
    const fnBody = isAsync ? trimmed.slice('async '.length) : trimmed;
    const prefix = isAsync ? 'return async function ' : 'return function ';
    const fn = new Function('WebSocketClient', 'WebSocket', prefix + fnBody)(
        extras.WebSocketClient,
        extras.WebSocket
    );
    target[name] = fn;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadReconnectPrototype() {
    const srcPath = path.join(__dirname, '../public/scripts/websocket.js');
    if (!fs.existsSync(srcPath)) {
        return null;
    }
    const src = fs.readFileSync(srcPath, 'utf8');
    const WebSocket = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
    const WebSocketClient = {
        DELAY_CONNECTING_WATCHDOG: 15000,
        DELAY_CONNECTING_WATCHDOG_MAX: 60000,
        STALE_OPEN_MS: 90000,
        PING_LIVENESS_MISSES: 2
    };
    const proto = {};
    const names = [
        '_reconnectOnFocusRegain',
        '_socketNeedsReplace',
        '_connectingIsStale',
        '_shouldProbeIdleSocket',
        '_probeIdleSocketOnResume',
        '_connectingWatchdogDelay',
        '_bumpConnectingWatchdogDelay',
        '_resetConnectingWatchdogDelay'
    ];
    for (const name of names) {
        bindMethod(proto, src, name, { WebSocketClient, WebSocket });
    }
    proto._WebSocket = WebSocket;
    proto._WebSocketClient = WebSocketClient;
    return proto;
}

function makeFake(proto, overrides) {
    const fake = Object.assign(Object.create(proto), {
        disconnectedDueToInactivity: false,
        isManualClose: false,
        lastUserActivity: 0,
        ws: null,
        isConnecting: false,
        connectionLock: false,
        _connectingSince: 0,
        _connectingWatchdogDelayMs: proto._WebSocketClient.DELAY_CONNECTING_WATCHDOG,
        _missedPingCount: 0,
        _lastPongAt: 0,
        _replacingSocket: false,
        _resumeProbeInFlight: false,
        circuitBreaker: false,
        reconnectAttempts: 0,
        lastConnectionAttempt: 0,
        connectCalls: 0,
        replaceCalls: [],
        probeSources: [],
        _isStartupHaltedForInstall() { return false; },
        isConnected() {
            return !!(this.ws && this.ws.readyState === this._WebSocket.OPEN);
        },
        _beginTrayOnlyReconnect() {},
        _teardownGenerationUiState() {},
        clearPendingRequests() {},
        _clearConnectingWatchdog() {},
        connect() { this.connectCalls += 1; },
        _replaceStaleSocket(source) { this.replaceCalls.push(source); this.connect(); },
        pingWithAuth() { return Promise.resolve(); }
    }, overrides);
    return fake;
}

async function testVisibilityAndFocusDuringConnectStartExactlyOneConnect(proto) {
    const fake = makeFake(proto, {
        ws: { readyState: proto._WebSocket.CLOSED },
        isConnecting: true,
        connectionLock: true,
        _connectingSince: Date.now() - (2 * 3600 * 1000)
    });

    proto._reconnectOnFocusRegain.call(fake, 'visibilitychange');
    proto._reconnectOnFocusRegain.call(fake, 'window-focus');

    assert.strictEqual(fake.connectCalls, 0, 'visibility+focus mid-connect must not start a second connect');
    assert.deepStrictEqual(fake.replaceCalls, [], 'stale leftover _connectingSince must not replace during pingHost');
}

async function testIdleOpenSocketProbesInsteadOfReplace(proto) {
    let pingCalls = 0;
    const fake = makeFake(proto, {
        ws: { readyState: proto._WebSocket.OPEN, close() {} },
        isConnecting: false,
        connectionLock: false,
        _lastPongAt: Date.now() - 120000,
        pingWithAuth() {
            pingCalls += 1;
            return Promise.resolve();
        }
    });

    proto._reconnectOnFocusRegain.call(fake, 'visibilitychange');
    proto._reconnectOnFocusRegain.call(fake, 'window-focus');
    await delay(20);

    assert.strictEqual(pingCalls, 1, 'resume must send one probe ping');
    assert.strictEqual(fake.connectCalls, 0, 'healthy idle OPEN socket must not be replaced');
    assert.deepStrictEqual(fake.replaceCalls, []);
}

function testConnectingWatchdogBackoff(proto) {
    const fake = makeFake(proto);
    assert.strictEqual(fake._connectingWatchdogDelay(), 15000);
    fake._bumpConnectingWatchdogDelay();
    assert.strictEqual(fake._connectingWatchdogDelay(), 30000);
    fake._bumpConnectingWatchdogDelay();
    assert.strictEqual(fake._connectingWatchdogDelay(), 60000);
    fake._bumpConnectingWatchdogDelay();
    assert.strictEqual(fake._connectingWatchdogDelay(), 60000, 'watchdog backoff must cap at 60s');
    fake._resetConnectingWatchdogDelay();
    assert.strictEqual(fake._connectingWatchdogDelay(), 15000, 'successful open must reset watchdog backoff');
}

async function testIdleOpenSocketReplaceOnlyIfProbeTimesOut(proto) {
    const fake = makeFake(proto, {
        ws: { readyState: proto._WebSocket.OPEN, close() {} },
        isConnecting: false,
        connectionLock: false,
        _lastPongAt: Date.now() - 120000,
        pingWithAuth() {
            return Promise.reject(Object.assign(new Error('Ping request timeout'), { code: 'PING_TIMEOUT' }));
        }
    });

    proto._reconnectOnFocusRegain.call(fake, 'visibilitychange');
    await delay(20);

    assert.deepStrictEqual(fake.replaceCalls, ['visibilitychange-probe']);
    assert.strictEqual(fake.connectCalls, 1);
}

function main() {
    let proto;
    try {
        proto = loadReconnectPrototype();
    } catch (err) {
        console.log(`test-ws-reconnect-lifecycle: skip (${err.message})`);
        return;
    }
    if (!proto) {
        console.log('test-ws-reconnect-lifecycle: skip (websocket.js missing)');
        return;
    }

    return Promise.resolve()
        .then(() => testVisibilityAndFocusDuringConnectStartExactlyOneConnect(proto))
        .then(() => testIdleOpenSocketProbesInsteadOfReplace(proto))
        .then(() => testIdleOpenSocketReplaceOnlyIfProbeTimesOut(proto))
        .then(() => testConnectingWatchdogBackoff(proto))
        .then(() => {
            console.log('test-ws-reconnect-lifecycle: ok');
        });
}

Promise.resolve()
    .then(main)
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
