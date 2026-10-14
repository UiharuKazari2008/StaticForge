#!/usr/bin/env node
/**
 * Hashed static assets (?sha=) are immutable for a year.
 * Unversioned URLs keep the previous cache policy.
 * modules/agentAssetBundle.js
 */
const assert = require('assert');
const agentAssetBundle = require('../modules/agentAssetBundle');

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_STORE = 'no-cache, no-store, must-revalidate, max-age=0';
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

assert.strictEqual(apply({ url: '/css/fonts.css' }), NO_STORE);
assert.strictEqual(apply({ url: '/css/fonts.css?t=1' }), NO_STORE);
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

console.log('sha immutable cache ok');
