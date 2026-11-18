#!/usr/bin/env node
'use strict';
// #908: the Android app fetches CaféReady task code from the server - a manifest with each file's sha256, the files
// (only those listed), ETag = sha256 with a 304 for an unchanged one.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const route = require('../modules/cafeTasksRoute');
const handlers = {};
route.mount({ get: (p, _auth, fn) => { handlers[p] = fn; } }, null);
const res = () => { const r = { code: 200, headers: {}, body: null, status(c) { r.code = c; return r; }, set(k, v) { r.headers[k] = v; return r; }, json(b) { r.body = b; return r; }, type() { return r; }, send(b) { r.body = b; return r; }, end() { return r; } }; return r; };

const m = res(); handlers['/api/cafe-tasks/manifest']({}, m);
assert.strictEqual(m.code, 200);
assert.ok(m.body.api >= 1 && m.body.files.length >= 3);
assert.ok(m.body.files.every((f) => typeof f === 'string'), 'files are plain names, as the engine reads them');
const one = { sha256: m.body.sha256['status-bar.js'] };
const disk = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'tasks', 'status-bar.js'));
assert.strictEqual(one.sha256, crypto.createHash('sha256').update(disk).digest('hex'));

const f = res(); handlers['/api/cafe-tasks/file/:name']({ params: { name: 'status-bar.js' }, headers: {} }, f);
assert.strictEqual(f.code, 200);
assert.ok(Buffer.compare(f.body, disk) === 0);
const n = res(); handlers['/api/cafe-tasks/file/:name']({ params: { name: 'status-bar.js' }, headers: { 'if-none-match': `"${one.sha256}"` } }, n);
assert.strictEqual(n.code, 304);
const x = res(); handlers['/api/cafe-tasks/file/:name']({ params: { name: '../../web_server.js' }, headers: {} }, x);
assert.strictEqual(x.code, 404, 'only listed files');
console.log('test-cafe-tasks-route: ok');
