#!/usr/bin/env node
// Install manifest rows must exist on disk. Missing files are omitted, not served as 404s.
// Run: node scripts/test-install-manifest-filter.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const filter = require('../modules/installManifestFilter');

function write(root, rel, body) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    return abs;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-manifest-'));
try {
    write(root, 'public/index.html', '<!doctype html>');
    write(root, 'public/app.html', '<!doctype html>');
    write(root, 'public/css/app.css', 'body{}');
    write(root, 'public/images/login_array.jpg', 'jpeg');
    write(root, '.cache/runtime-assets/static_images/app_icons/icon-32.webp', 'webp');
    write(root, 'public/scripts/vendor/fflate.js', 'exports');
    write(root, 'public/cursors/vista/aero_arrow.cur', 'cur');
    write(root, 'public/sounds/vista/Windows Notify.wav', 'wav');

    const entries = [
        { url: '/', name: '/index.html', type: 'route' },
        { url: '/app', name: '/app.html', type: 'route' },
        { url: '/launch', name: '/launch.html', type: 'route' },
        { url: '/css/app.css', hash: 'a' },
        { url: '/css/missing.css', hash: 'b' },
        { url: '/.login.jpg', hash: 'c' },
        { url: '/static_images/app_icons/icon-32.webp', hash: 'd' },
        { url: '/protected/fflate.js', hash: 'e' },
        { url: '/cursors/vista/aero_arrow.cur', hash: 'f' },
        { url: '/cursors/vista/aero_link.cur', hash: 'g' },
        { url: '/sounds/vista/Windows%20Ding.wav', hash: 'h' },
        { url: '/sounds/vista/Windows%20Notify.wav', hash: 'i' },
        { url: '/css/../../.env', hash: 'i' },
        { url: 'not-a-path', hash: 'j' }
    ];

    const kept = filter.filterExistingManifestEntries(root, entries);
    const urls = kept.map((entry) => entry.url);

    assert.deepStrictEqual(urls, [
        '/',
        '/app',
        '/css/app.css',
        '/.login.jpg',
        '/static_images/app_icons/icon-32.webp',
        '/protected/fflate.js',
        '/cursors/vista/aero_arrow.cur',
        '/sounds/vista/Windows%20Notify.wav'
    ]);
    assert.ok(!urls.includes('/launch'), 'missing launch.html is omitted');
    assert.ok(!urls.includes('/css/missing.css'));
    assert.ok(!urls.includes('/cursors/vista/aero_link.cur'));
    assert.ok(!urls.includes('/sounds/vista/Windows%20Ding.wav'), 'a sound not on disk is omitted');
    assert.strictEqual(filter.manifestEntryExists(root, { url: '/css/../../.env' }), false);
    // /protected/fflate.js resolves only to the vendored copy (GH #336)
    assert.deepStrictEqual(filter.candidatePaths(root, '/protected/fflate.js'), [path.join(root, 'public', 'scripts', 'vendor', 'fflate.js')]);

    const marked = filter.markAuthGatedEntries([
        { url: '/protected/fflate.js', hash: 'e' },
        { url: '/protected/t5_tokenizer.json', hash: 't' },
        { url: '/css/app.css', hash: 'a' },
        { url: '/cursors/vista/aero_arrow.cur', hash: 'f' }
    ]);
    assert.strictEqual(marked[0].auth, true);
    assert.strictEqual(marked[1].auth, true);
    assert.strictEqual(marked[2].auth, undefined);
    assert.strictEqual(marked[3].auth, undefined, 'cursor packs are public static files');

    const server = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
    assert.ok(server.includes('filterExistingManifestEntries'), 'manifest builder filters on disk');
    assert.ok(server.includes('markAuthGatedEntries'), 'protected rows are marked auth');
    assert.ok(server.includes('listCursorPackFiles'), 'cursor packs are added to the cache manifest');
    assert.ok(server.includes('resolveLoginSpritePath'), 'login sprite falls back to the committed seed');

    const seeds = fs.readFileSync(path.join(__dirname, 'fetch-seeds.sh'), 'utf8');
    assert.ok(seeds.includes('https://yozora.bluesteel.737.jp.net/seeds/dreamscape/'));
    assert.ok(seeds.includes("SHA256SUMS"), "seeds are verified against the hosted SHA256SUMS");
    assert.ok(!seeds.includes("PLACEHOLDER"), "seed URL is no longer a placeholder");
    assert.ok(seeds.includes('${SEED_BASE_URL:-https://yozora.bluesteel.737.jp.net/seeds/dreamscape/}'));

    const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
    assert.ok(sw.includes('STATIC_FILE_FETCH_TIMEOUT_MS'), 'install fetch has a per-file timeout');
    assert.ok(sw.includes("reason === '404'") || sw.includes("reason: '404'"), '404 is recorded as absent');
    assert.ok(!sw.includes('retryMissing'), 'a missing file is not retried inside the worker');

    console.log('test-install-manifest-filter: ok');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
