#!/usr/bin/env node
// A download the service worker lost (a new sw.js activated mid-download, or its
// STATIC_CACHE_COMPLETE never arrived) finishes from the cache or is sent again, instead of
// leaving Melaton Update on "Downloading 2 files (50% complete)" for good.
// Run: node scripts/test-sw-lost-download.js
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
function bindMethod(target, src, name) {
    const body = extractClassMethod(src, name);
    const trimmed = body.replace(/^\s+/, '');
    const isAsync = trimmed.startsWith('async ');
    const fnBody = isAsync ? trimmed.slice('async '.length) : trimmed;
    const fnSrc = isAsync ? `return async function ${fnBody}` : `return function ${fnBody}`;
    target[name] = new Function(fnSrc)();
}

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/serviceWorkerManager.js'), 'utf8');
const proto = {};
for (const name of ['_recoverLostDownload', 'handleStalledDownload', 'startPeriodicStateCheck']) bindMethod(proto, src, name);

const FILES = [{ url: '/scripts/comp/a.js', hash: 'a' }, { url: '/css/b.css', hash: 'b' }];

function makeManager(overrides) {
    const calls = { posted: [], completed: [], popup: [], periodic: 0, stopped: 0, completeToast: 0 };
    const m = Object.assign(Object.create(proto), {
        calls,
        isUpdating: true,
        updateProgress: 50,
        updateToastId: 'service-worker-tray-popup',
        stallDetectionTimeout: null,
        _activeDownloadFiles: FILES,
        _downloadRecoveries: 0,
        missing: [],
        swRegistration: { active: { postMessage: (msg) => calls.posted.push(msg) } },
        stopPeriodicStateCheck() { calls.stopped++; },
        stopHeartbeatTracking() {},
        _clearStallToast() {},
        hideUpdateToast() {},
        showUpdateCompleteToast() { calls.completeToast++; },
        async getFilesNeedingUpdate(files) { return files.filter((f) => this.missing.includes(f.url)); },
        _processStaticCacheComplete(data) { calls.completed.push(data); },
        _showServiceWorkerTrayPopup(state, info) { calls.popup.push([state, info.message]); },
        async checkDownloadState() { return { isDownloading: false }; },
        updateProgressToast() {}
    }, overrides);
    m.startPeriodicStateCheck = () => { calls.periodic++; };
    return m;
}

(async () => {
    // every file reached the cache: finish it as the worker would have
    let m = makeManager();
    await m._recoverLostDownload();
    assert.strictEqual(m.calls.completed.length, 1, 'the download completes');
    assert.deepStrictEqual(m.calls.completed[0].updatedFiles, FILES, 'from every file of the set');
    assert.strictEqual(m.isUpdating, false);
    assert.strictEqual(m._activeDownloadFiles, null);
    assert.strictEqual(m.calls.posted.length, 0, 'nothing is fetched again');

    // a file is missing: the whole set goes again (restart vs apply is classified from all of it)
    m = makeManager({ missing: ['/css/b.css'] });
    await m._recoverLostDownload();
    assert.deepStrictEqual(m.calls.posted, [{ type: 'CACHE_STATIC_FILES', files: FILES }], 'the set is sent again');
    assert.strictEqual(m.isUpdating, true, 'and watched');
    assert.strictEqual(m.calls.periodic, 1);
    assert.strictEqual(m._downloadRecoveries, 1);

    // twice at most, then the page says it failed instead of hanging
    m = makeManager({ missing: ['/css/b.css'], _downloadRecoveries: 2 });
    await m._recoverLostDownload();
    assert.strictEqual(m.calls.posted.length, 0, 'no third try');
    assert.deepStrictEqual(m.calls.popup, [['checking', 'Failed to download updates. Please try again.']], 'Update shows the failure');
    assert.strictEqual(m.isUpdating, false);

    // a download this page did not start keeps the old behaviour
    m = makeManager({ _activeDownloadFiles: null, updateProgress: 100, updateToastId: 'toast-1' });
    await m._recoverLostDownload();
    assert.strictEqual(m.calls.completeToast, 1);
    assert.strictEqual(m.calls.completed.length, 0);

    // the stall handler recovers when the worker has no download
    m = makeManager();
    await m.handleStalledDownload();
    assert.strictEqual(m.calls.completed.length, 1, 'stall check: worker lost it, the page finishes it');

    // the periodic check does too
    m = makeManager();
    const realSetInterval = global.setInterval;
    let tick = null;
    global.setInterval = (fn) => { tick = fn; return 1; };
    try { proto.startPeriodicStateCheck.call(m); } finally { global.setInterval = realSetInterval; }
    await tick();
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(m.calls.completed.length, 1, 'periodic check: worker lost it, the page finishes it');

    // the foreground check watches from the moment it posts
    assert.ok(/this\._activeDownloadFiles = filesToUpdate;[\s\S]{0,400}type: 'CACHE_STATIC_FILES',\s*files: filesToUpdate\s*\}\);[\s\S]{0,300}this\.isUpdating = true;\s*this\.startPeriodicStateCheck\(\);/.test(src), 'updateStaticCache remembers the set and watches it');

    console.log('test-sw-lost-download: ok');
})().catch((err) => { console.error(err); process.exit(1); });
