'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtimeAssetService = require('../modules/runtimeAssetService');
const agentAssetBundle = require('../modules/agentAssetBundle');

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-sha-'));
const publicDir = path.join(root, 'public');
const cssDir = path.join(publicDir, 'css');
fs.mkdirSync(cssDir, { recursive: true });

const cssBody = 'body{color:red}';
fs.writeFileSync(path.join(cssDir, 'fixture.css'), cssBody);
const cssHash = sha256(cssBody);

const trackedHtml = [
    '<!doctype html>',
    `<link rel="stylesheet" href="/css/fixture.css?sha=stale-hash">`,
    '<script src="/scripts/foo.js"></script>',
    ''
].join('\n');
fs.writeFileSync(path.join(publicDir, 'app.html'), trackedHtml);
fs.writeFileSync(path.join(publicDir, 'launch.html'), trackedHtml);

runtimeAssetService.init({ projectRoot: root });
runtimeAssetService.updateHtmlStylesheetShaLinks(root);

assert.strictEqual(
    fs.readFileSync(path.join(publicDir, 'app.html'), 'utf8'),
    trackedHtml,
    'tracked public/app.html must stay untouched'
);
assert.strictEqual(
    fs.readFileSync(path.join(publicDir, 'launch.html'), 'utf8'),
    trackedHtml,
    'tracked public/launch.html must stay untouched'
);

const cacheApp = path.join(root, '.cache', 'runtime-assets', 'app.html');
const cacheLaunch = path.join(root, '.cache', 'runtime-assets', 'launch.html');
assert.ok(fs.existsSync(cacheApp), 'rewritten app.html lives under .cache/runtime-assets');
assert.ok(fs.existsSync(cacheLaunch), 'rewritten launch.html lives under .cache/runtime-assets');

const rewritten = fs.readFileSync(cacheApp, 'utf8');
assert.ok(rewritten.includes(`href="/css/fixture.css?sha=${cssHash}"`), rewritten);
assert.ok(!rewritten.includes('stale-hash'), rewritten);

assert.strictEqual(runtimeAssetService.isHtmlShaLinkWebPath('/app.html'), true);
assert.strictEqual(runtimeAssetService.isHtmlShaLinkWebPath('launch.html'), true);
assert.strictEqual(runtimeAssetService.isHtmlShaLinkWebPath('/css/app.css'), false);
assert.strictEqual(runtimeAssetService.resolveServedAssetPath(root, '/app.html'), cacheApp);
assert.strictEqual(runtimeAssetService.resolveServedPath(root, '/launch.html', false), cacheLaunch);
assert.strictEqual(
    runtimeAssetService.resolveServedAssetPath(root, '/css/fixture.css'),
    path.join(cssDir, 'fixture.css')
);

agentAssetBundle.init({ projectRoot: root, getManifest: () => [] });
const boot = agentAssetBundle.getBootUrls();
assert.ok(
    boot.some((url) => url === `/css/fixture.css?sha=${cssHash}`),
    JSON.stringify(boot)
);

const withScript = trackedHtml.replace(
    '<script src="/scripts/foo.js"></script>',
    '<script src="/scripts/foo.js"></script>\n<script src="/scripts/bar.js"></script>'
);
fs.writeFileSync(path.join(publicDir, 'app.html'), withScript);
runtimeAssetService.updateHtmlStylesheetShaLinks(root);
assert.strictEqual(fs.readFileSync(path.join(publicDir, 'app.html'), 'utf8'), withScript);
const refreshed = fs.readFileSync(cacheApp, 'utf8');
assert.ok(refreshed.includes('/scripts/bar.js'), refreshed);
assert.ok(refreshed.includes(`href="/css/fixture.css?sha=${cssHash}"`), refreshed);

fs.unlinkSync(cacheApp);
assert.strictEqual(
    runtimeAssetService.resolveServedHtmlPath(root, 'app.html'),
    path.join(publicDir, 'app.html')
);

fs.rmSync(root, { recursive: true, force: true });
console.log('test-runtime-html-sha-links: ok');
