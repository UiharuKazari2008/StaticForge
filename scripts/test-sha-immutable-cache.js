#!/usr/bin/env node
/**
 * Hashed static assets (?sha=) are immutable for a year.
 * Unversioned URLs are kept but revalidated every time (no-cache + ETag → 304), and carry
 * X-File-Hash from the manifest so public/sw.js stores a network answer.
 * modules/agentAssetBundle.js
 */
const assert = require('assert');
const agentAssetBundle = require('../modules/agentAssetBundle');

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';
const DEV_ADMIN = 'private, max-age=120';

function mockRes() {
    const headers = {};
    return {
        headers,
        setHeader(name, value) {
            headers[name.toLowerCase()] = value;
        },
        removeHeader(name) {
            delete headers[name.toLowerCase()];
        }
    };
}

function apply(req) {
    const res = mockRes();
    agentAssetBundle.applyServedAssetCacheHeaders(req, res);
    return res.headers['cache-control'];
}

assert.strictEqual(apply({ url: '/css/fonts.css' }), REVALIDATE);
assert.strictEqual(apply({ url: '/css/fonts.css?t=1' }), REVALIDATE);
assert.strictEqual(apply({ originalUrl: '/css/fonts.css?sha=abc' }), IMMUTABLE);
assert.strictEqual(apply({ url: '/static_images/workin.webp?sha=' }), IMMUTABLE);
assert.strictEqual(apply({ url: '/css/app.css', query: { sha: 'deadbeef' } }), IMMUTABLE);

const devAdmin = { session: { authenticated: true, userType: 'dev_admin' } };
assert.strictEqual(apply({ url: '/css/app.css', ...devAdmin }), DEV_ADMIN);
assert.strictEqual(apply({ url: '/css/app.css?sha=abc', ...devAdmin }), IMMUTABLE);

const withStale = mockRes();
withStale.setHeader('Pragma', 'no-cache');
withStale.setHeader('Expires', '0');
agentAssetBundle.applyServedAssetCacheHeaders({ url: '/app.js?sha=1' }, withStale);
assert.strictEqual(withStale.headers['cache-control'], IMMUTABLE);
assert.strictEqual(withStale.headers.pragma, undefined);
assert.strictEqual(withStale.headers.expires, undefined);

// X-File-Hash: the manifest hash for paths in the manifest, nothing for the rest
agentAssetBundle.init({ getFileHash: (p) => (p === '/static_images/header.png' ? 'abc123' : null) });
const hashed = mockRes();
agentAssetBundle.applyServedAssetCacheHeaders({ path: '/static_images/header.png', url: '/static_images/header.png' }, hashed);
assert.strictEqual(hashed.headers['x-file-hash'], 'abc123');
assert.strictEqual(hashed.headers['cache-control'], REVALIDATE);
const unlisted = mockRes();
agentAssetBundle.applyServedAssetCacheHeaders({ path: '/static_images/nope.png', url: '/static_images/nope.png' }, unlisted);
assert.strictEqual(unlisted.headers['x-file-hash'], undefined);

console.log('sha immutable cache ok');
