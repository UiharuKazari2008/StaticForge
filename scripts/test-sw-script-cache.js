#!/usr/bin/env node
/**
 * GET /sw.js revalidates (#890, modules/swScriptRoute.js): Cache-Control no-cache with an ETag and
 * Last-Modified, so an update check for an unchanged worker is a 304; a changed file is a 200 again.
 *   node scripts/test-sw-script-cache.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createSwScriptHandler } = require('../modules/swScriptRoute');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-script-'));
fs.writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {});\n');

function get(port, headers = {}) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: '/sw.js', headers }, (res) => {
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString() }));
        }).on('error', reject);
    });
}

(async () => {
    const app = express();
    app.get('/sw.js', createSwScriptHandler(dir));
    app.use((req, res) => res.status(404).end());
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.on('listening', r));
    const port = server.address().port;

    let r = await get(port);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['cache-control'], 'no-cache', 'revalidated, not no-store');
    assert.ok(r.headers.etag, 'an ETag');
    assert.ok(r.headers['last-modified'], 'a Last-Modified');
    assert.ok(/addEventListener/.test(r.body));
    const etag = r.headers.etag;

    // the browser's update check (updateViaCache none): a conditional request -> 304, no body
    r = await get(port, { 'If-None-Match': etag, 'Cache-Control': 'max-age=0', 'Service-Worker': 'script' });
    assert.strictEqual(r.status, 304);
    assert.strictEqual(r.body, '');

    // a new worker: a different ETag, 200 with the new bytes
    await new Promise((res) => setTimeout(res, 20));
    fs.writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {}); // v2, longer\n');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(dir, 'sw.js'), later, later);
    r = await get(port, { 'If-None-Match': etag });
    assert.strictEqual(r.status, 200);
    assert.ok(/v2/.test(r.body));
    assert.notStrictEqual(r.headers.etag, etag);

    // no file: on to the next handler
    fs.unlinkSync(path.join(dir, 'sw.js'));
    r = await get(port);
    assert.strictEqual(r.status, 404);

    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('sw script cache: ok');
})().catch((e) => { console.error(e); process.exit(1); });
