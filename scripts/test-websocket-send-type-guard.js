'use strict';
// #1244 (fault_8ba6d530bd22): WebSocketClient.sendMessage(type, ...) rejects at once, with a TypeError coded
// BAD_MESSAGE_TYPE, when `type` is not a non-empty string (before recordUserActivity, nothing queued or sent), and
// isGenerationQuipsMessage(message) is false instead of throwing when message.type is not a string.
// The real class body is cut out of public/scripts/websocket.js and evaluated in a vm context; the instance is
// Object.create(WebSocketClient.prototype) (not constructed: the constructor opens sockets and timers). Stubbed on the
// instance: recordUserActivity, _sendMessageTraced (what a valid type goes on to), send, and the queue members, all as spies.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');
const start = src.indexOf('class WebSocketClient {');
const end = src.indexOf('\n}\n\n// Create global WebSocket instance', start);
assert.ok(start >= 0 && end > start, 'WebSocketClient class in websocket.js');

const ctx = { window: {}, document: {}, console, navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
vm.createContext(ctx);
vm.runInContext(`${src.slice(start, end + 2)}\nthis.WebSocketClient = WebSocketClient;`, ctx);
const WebSocketClient = ctx.WebSocketClient;
assert.strictEqual(typeof WebSocketClient.prototype.sendMessage, 'function');
assert.ok(WebSocketClient.GENERATION_QUIPS_MESSAGE_TYPES.size > 0);

const VmTypeError = vm.runInContext('TypeError', ctx); // the context's own TypeError

function makeClient() {
    const calls = { activity: 0, traced: [], sent: [], queued: [] };
    const c = Object.create(WebSocketClient.prototype);
    c.recordUserActivity = () => { calls.activity++; };
    c._sendMessageTraced = (type, data, showBanner) => { calls.traced.push([type, data, showBanner]); return Promise.resolve({ ok: type }); };
    c.send = (m) => { calls.sent.push(m); };
    c.messageQueue = { push: (m) => calls.queued.push(m) };
    c.pendingRequests = { set: (k, v) => calls.queued.push([k, v]) };
    return { c, calls };
}

(async () => {
    // (a) + (b): each bad type rejects at once, names what it got, and touches nothing
    const cases = [
        [undefined, 'undefined'],
        [null, 'null'],
        [{ type: 'x' }, 'object'],
        ['', 'string'],
        [42, 'number']
    ];
    for (const [bad, got] of cases) {
        const { c, calls } = makeClient();
        let p;
        assert.doesNotThrow(() => { p = c.sendMessage(bad); }, `sendMessage(${String(bad)}) must not throw synchronously`);
        assert.ok(p && typeof p.then === 'function', 'returns a promise');
        let err = null;
        try { await p; } catch (e) { err = e; }
        assert.ok(err, `sendMessage(${JSON.stringify(bad)}) rejects`);
        assert.ok(err instanceof VmTypeError && err.name === 'TypeError', 'TypeError');
        assert.strictEqual(err.code, 'BAD_MESSAGE_TYPE');
        assert.strictEqual(err.message, `sendMessage: message type must be a non-empty string (got ${got})`);
        assert.strictEqual(calls.activity, 0, `recordUserActivity not called for ${got}`);
        assert.deepStrictEqual(calls.traced, [], 'nothing handed to the send path');
        assert.deepStrictEqual(calls.sent, [], 'nothing sent');
        assert.deepStrictEqual(calls.queued, [], 'nothing queued');
    }
    // also with data and showBanner given
    {
        const { c, calls } = makeClient();
        await assert.rejects(c.sendMessage({}, { a: 1 }, true), (e) => e.code === 'BAD_MESSAGE_TYPE');
        assert.strictEqual(calls.activity, 0);
    }

    // (c) a valid type still takes the normal path
    {
        const { c, calls } = makeClient();
        const reply = await c.sendMessage('get_something', { a: 1 }, false);
        assert.deepStrictEqual(reply, { ok: 'get_something' });
        assert.strictEqual(calls.activity, 1, 'recordUserActivity called for a non-ping type');
        assert.deepStrictEqual(calls.traced, [['get_something', { a: 1 }, false]]);
    }
    {
        const { c, calls } = makeClient();
        await c.sendMessage('ping');
        assert.strictEqual(calls.activity, 0, 'ping is no user activity (unchanged)');
        assert.strictEqual(calls.traced.length, 1, 'ping still goes down the path');
    }

    // (d) isGenerationQuipsMessage
    const { c } = makeClient();
    for (const m of [{ type: {} }, { type: 42 }, { type: undefined }, null, undefined, {}, { type: '' }, { type: null }, { type: ['generation_quips'] }]) {
        let r;
        assert.doesNotThrow(() => { r = c.isGenerationQuipsMessage(m); }, `isGenerationQuipsMessage(${JSON.stringify(m)}) must not throw`);
        assert.strictEqual(r, false, `false for ${JSON.stringify(m)}`);
    }
    const known = [...WebSocketClient.GENERATION_QUIPS_MESSAGE_TYPES][0];
    assert.strictEqual(c.isGenerationQuipsMessage({ type: known }), true, `a listed type (${known})`);
    assert.strictEqual(c.isGenerationQuipsMessage({ type: 'x_generation_quips_y' }), true, 'a string containing generation_quips');
    assert.strictEqual(c.isGenerationQuipsMessage({ type: 'get_user_settings' }), false, 'an ordinary type');
    for (const t of WebSocketClient.GENERATION_QUIPS_MESSAGE_TYPES) assert.strictEqual(c.isGenerationQuipsMessage({ type: t }), true);

    console.log('ok: websocket send type guard: 5 bad types reject BAD_MESSAGE_TYPE with no side effects, valid type passes, isGenerationQuipsMessage never throws');
})().catch((err) => { console.error(err); process.exit(1); });
