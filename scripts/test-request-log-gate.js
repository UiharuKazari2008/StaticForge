#!/usr/bin/env node
// #1230: the request log is a DETAILED-level log; preflights, static GETs and the grimoire input poll stay out.
const assert = require('assert');
const { shouldLogRequest } = require('../modules/requestLogGate');
const none = {};
assert.strictEqual(shouldLogRequest('GET', '/api/x', 1, none), false, 'NORMAL logs nothing');
assert.strictEqual(shouldLogRequest('GET', '/api/x', 2, none), true, 'DETAILED logs API calls');
assert.strictEqual(shouldLogRequest('OPTIONS', '/api/x', 2, none), false, 'preflight skipped');
assert.strictEqual(shouldLogRequest('GET', '/css/app.css', 2, none), false, 'static skipped');
assert.strictEqual(shouldLogRequest('POST', '/grimoire/sessions/abc123/input', 2, none), false, 'ping poll skipped');
assert.strictEqual(shouldLogRequest('GET', '/api/x', 1, { DREAMSCAPE_REQUEST_LOG: '1' }), true, 'env flag');
assert.strictEqual(shouldLogRequest('OPTIONS', '/api/x', 1, { DREAMSCAPE_REQUEST_LOG: '1' }), false, 'env flag still skips noise');
assert.strictEqual(shouldLogRequest('OPTIONS', '/a', 1, { DREAMSCAPE_REQUEST_LOG: 'all' }), true, 'all logs everything');
console.log('test-request-log-gate: ok');
