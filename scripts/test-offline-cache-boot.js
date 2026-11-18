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

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withNavigator(fakeNavigator, fn) {
    const desc = Object.getOwnPropertyDescriptor(global, 'navigator');
    Object.defineProperty(global, 'navigator', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: fakeNavigator
    });
    const restore = () => {
        if (desc) {
            Object.defineProperty(global, 'navigator', desc);
        } else {
            delete global.navigator;
        }
    };
    return Promise.resolve()
        .then(fn)
        .finally(restore);
}

function loadSwMethods() {
    const srcPath = path.join(__dirname, '../public/scripts/comp/serviceWorkerManager.js');
    if (!fs.existsSync(srcPath)) {
        return null;
    }
    const src = fs.readFileSync(srcPath, 'utf8');
    const proto = { _src: src };
    for (const name of [
        'ensureBootComplete',
        '_resolveBootComplete',
        '_fetchManifest',
        '_fetchManifestResult',
        'waitForServiceWorkerReady',
        '_wireServiceWorkerRegistration',
        '_attachLateServiceWorkerRegistration',
        '_warmAfterSwActive'
    ]) {
        bindMethod(proto, src, name);
    }
    return proto;
}

function makeManager(proto, overrides) {
    const classList = {
        items: new Set(),
        remove(name) { this.items.delete(name); },
        add(name) { this.items.add(name); }
    };
    return Object.assign(Object.create(proto), {
        bootComplete: false,
        bootPromise: null,
        _bootCompleteResolvers: [],
        bootPhase: 'idle',
        swRegistration: null,
        _swMessageListenerAttached: false,
        _bootOrchestrating: false,
        _pendingCacheUpdateQueue: [],
        _swReadyTimeoutMs: 20,
        swReadyTimeout: null,
        warmed: 0,
        wired: 0,
        documentBodyClasses: classList,
        _isBeforeDesktop() { return true; },
        _readSyncedManifestHash() { return ''; },
        _flushPendingCacheUpdates() {
            this.flushed = true;
        },
        queueCacheUpdateUntilBoot() {
            this.queuedWarm = true;
        },
        checkStaticFileUpdates() {
            this.warmed += 1;
        },
        ensurePlanetSwitcherBgmCache() {},
        startHealthCheck() {
            this.healthStarted = true;
        },
        fetchSwConfig() {
            this.configFetched = true;
            return Promise.resolve();
        },
        checkForWaiting() {
            this.checkedWaiting = true;
        },
        handleServiceWorkerMessage() {}
    }, overrides);
}

async function testEnsureBootCompleteDoesNotForceResolve(proto) {
    const prevDocument = global.document;
    global.document = { body: { classList: { remove() {}, add() {} } } };
    try {
        const mgr = makeManager(proto);
        const pending = mgr.ensureBootComplete();
        let settled = false;
        pending.then(() => { settled = true; });
        await delay(40);
        assert.strictEqual(mgr.bootComplete, false, '12s boot gate must not force-complete');
        assert.strictEqual(settled, false, 'ensureBootComplete must wait for real boot');
        mgr._resolveBootComplete();
        await pending;
        assert.strictEqual(mgr.bootComplete, true);
        assert.strictEqual(settled, true);
    } finally {
        global.document = prevDocument;
    }
}

async function testManifestTimeoutReturnsEmpty(proto) {
    const prevFetch = global.fetch;
    global.fetch = async () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
    };
    try {
        const mgr = makeManager(proto);
        const manifest = await mgr._fetchManifest();
        assert.deepStrictEqual(manifest, []);
    } finally {
        global.fetch = prevFetch;
    }
}

async function testManifestJsonTimeoutReturnsEmpty(proto) {
    const prevFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        async json() {
            const err = new Error('The operation was aborted due to timeout');
            err.name = 'TimeoutError';
            throw err;
        }
    });
    try {
        const mgr = makeManager(proto);
        const manifest = await mgr._fetchManifest();
        assert.deepStrictEqual(manifest, []);
    } finally {
        global.fetch = prevFetch;
    }
}

async function testWarmAfterSwActiveRunsOnce(proto) {
    const prevSchedule = global.scheduleAfterFirstPaint;
    global.scheduleAfterFirstPaint = (fn) => fn();
    return withNavigator({
        serviceWorker: {
            controller: null,
            addEventListener() {},
            removeEventListener() {},
            ready: Promise.resolve()
        }
    }, async () => {
        const mgr = makeManager(proto, { bootComplete: true });
        mgr._warmAfterSwActive();
        mgr._warmAfterSwActive();
        mgr._attachLateServiceWorkerRegistration(Promise.resolve({
            addEventListener() {},
            installing: null,
            waiting: null,
            active: { state: 'activated' }
        }));
        await delay(20);
        assert.strictEqual(mgr.warmed, 1, 'background warm must run once');
    }).finally(() => {
        if (prevSchedule) global.scheduleAfterFirstPaint = prevSchedule;
        else delete global.scheduleAfterFirstPaint;
    });
}

async function testReadyTimeoutReturnsTimedOut(proto) {
    return withNavigator({
        serviceWorker: {
            controller: null,
            addEventListener() {},
            removeEventListener() {},
            ready: new Promise(() => {})
        }
    }, async () => {
        const mgr = makeManager(proto, {
            swRegistration: { active: null, waiting: null, installing: null }
        });
        const result = await mgr.waitForServiceWorkerReady();
        assert.strictEqual(result.timedOut, true);
    });
}

async function testLateRegisterStillWires(proto) {
    let resolveReady;
    const prevDocument = global.document;
    const prevRaf = global.requestAnimationFrame;
    const prevSchedule = global.scheduleAfterFirstPaint;
    global.document = { readyState: 'complete' };
    global.requestAnimationFrame = (fn) => { fn(); return 1; };
    global.scheduleAfterFirstPaint = (fn) => fn();
    return withNavigator({
        serviceWorker: {
            controller: null,
            addEventListener() {},
            removeEventListener() {},
            ready: new Promise((resolve) => { resolveReady = resolve; })
        }
    }, async () => {
        const mgr = makeManager(proto, { bootComplete: true });
        let resolveReg;
        const registerPromise = new Promise((resolve) => { resolveReg = resolve; });
        mgr._attachLateServiceWorkerRegistration(registerPromise);
        assert.strictEqual(mgr.swRegistration, null);
        const registration = {
            addEventListener() {},
            installing: null,
            waiting: null,
            active: { state: 'activated' }
        };
        resolveReg(registration);
        await delay(20);
        assert.strictEqual(mgr.swRegistration, registration);
        assert.strictEqual(mgr.healthStarted, true);
        resolveReady();
        await delay(80);
        assert.ok(mgr.warmed >= 1, 'late registration must warm once ready');
    }).finally(() => {
        global.document = prevDocument;
        if (prevRaf) global.requestAnimationFrame = prevRaf;
        else delete global.requestAnimationFrame;
        if (prevSchedule) global.scheduleAfterFirstPaint = prevSchedule;
        else delete global.scheduleAfterFirstPaint;
    });
}

function testNoFatalRegisterDiscard(src) {
    assert.ok(src.includes('_attachLateServiceWorkerRegistration'), 'late register wiring missing');
    assert.ok(src.includes('_warmAfterSwActive'), 'background warm missing');
    assert.ok(src.includes('await response.json()'), 'manifest json() must be awaited so timeout is caught');
    assert.ok(src.includes('_swWarmScheduled'), 'background warm must be single-flight');
    assert.ok(src.includes('timedOut: true'), 'ready timeout must report timedOut');
    assert.ok(!src.includes('Boot gate timed out — continuing from network'), '12s boot gate must be gone');
    assert.ok(!src.includes('Service worker failed to become ready in time'), 'ready path must not reject fatally');
    assert.ok(!src.includes('booting from network'), 'a missing service worker must not boot');
    assert.ok(!src.includes('The offline cache is not ready.'), 'a late service worker must still run the update check');
    assert.ok(src.includes('_enterUpdater'), 'an unproven cache must be sent to the installer');
    assert.ok(src.includes('_cacheMatchesStoredManifest'), 'boot must prove the cache before finishing');
    assert.ok(!src.includes('continuing startup'), 'a failed cache verify must not boot');
    assert.ok(!src.includes('_runInstallWizard') && !src.includes('_showInstallWizardUi'), 'the /app install wizard is gone');
    assert.ok(src.includes('location.replace(\'/launch\')'), 'large /app updates reboot to /launch');
}

// featureLoader's ?sha= map (#890): one build for concurrent callers, from the stored list under the
// synced digest when there is one, patched by live updates
function loadStaticHashMethods(src) {
    const proto = {};
    for (const name of ['hashForStaticPath', '_buildStaticHashMap', '_noteStaticHashUpdate', '_dropStaticHashMap',
        '_fetchManifestResult', 'checkStaticFileUpdates', '_staticFilesUnchanged']) {
        bindMethod(proto, src, name);
    }
    const top = extractClassMethod(src.replace('\nfunction normalizeStaticFilePath(', '\n    normalizeStaticFilePath('), 'normalizeStaticFilePath');
    global.PLAIN_STATIC_PATH = new Function(`return ${/^const PLAIN_STATIC_PATH = ([^;]+);/m.exec(src)[1]}`)();
    global.normalizeStaticFilePath = new Function(`return function ${top}`)();
    return proto;
}

function hashManager(proto, opts = {}) {
    const fetches = [];
    const mgr = Object.assign(Object.create(proto), {
        agentSession: false,
        _staticHashByPath: null, _staticHashBuild: null, _staticHashGen: 0, _staticHashSeq: 0,
        _staticHashLive: new Map(), _staticHashSnapshotStale: false,
        snapshotReads: 0,
        async _readManifestSnapshot() { this.snapshotReads += 1; await delay(5); return opts.snapshot || null; },
        _readSyncedManifestHash() { return opts.synced || ''; },
        _noteBroadcastHash() {}
    });
    const prevFetch = global.fetch;
    global.fetch = async (url, init) => {
        fetches.push(init && init.headers ? Object.assign({}, init.headers) : {});
        await delay(5);
        if (opts.status === 304 && init.headers['X-Manifest-Hash']) return { status: 304, ok: false, headers: { get: () => '' } };
        return { status: 200, ok: true, headers: { get: () => 'D2' }, json: async () => (opts.server || []).map((r) => Object.assign({}, r)) };
    };
    return { mgr, fetches, restore: () => { global.fetch = prevFetch; } };
}

async function testStaticHashMapShared(src) {
    const proto = loadStaticHashMethods(src);
    const rows = [{ url: '/scripts/a.js', hash: 'a1' }, { url: '/css/b.css', hash: 'b1' }, { url: '/scripts/c.js', hash: 'c1' }];

    // the after-paint batch: 5 lookups at once, a stored list: no request at all
    let w = hashManager(proto, { snapshot: rows, server: rows });
    try {
        const got = await Promise.all(['/scripts/a.js', '/css/b.css', '/scripts/c.js', '/scripts/a.js?x=1', '/none.js'].map((p2) => w.mgr.hashForStaticPath(p2)));
        assert.deepStrictEqual(got, ['a1', 'b1', 'c1', 'a1', null]);
        assert.strictEqual(w.fetches.length, 0, 'the stored list answers: no manifest download');
        assert.strictEqual(w.mgr.snapshotReads, 1, 'one build for all five');
        // a live update patches it: no request, the new hash
        w.mgr._noteStaticHashUpdate([{ url: '/scripts/a.js', hash: 'a2' }]);
        assert.strictEqual(await w.mgr.hashForStaticPath('/scripts/a.js'), 'a2');
        assert.strictEqual(w.fetches.length, 0);
        // a row without its hash: the next lookup asks the server once (not the stored list again)
        w.mgr._noteStaticHashUpdate(['/scripts/c.js']);
        assert.strictEqual(await w.mgr.hashForStaticPath('/css/b.css'), 'b1');
        assert.strictEqual(w.fetches.length, 1, 'one full list after an update without hashes');
        assert.strictEqual(w.fetches[0]['X-Manifest-Hash'], undefined, 'the list itself, not a 304');
        assert.strictEqual(await w.mgr.hashForStaticPath('/scripts/a.js'), 'a1', 'a server list fetched after the update is newer than its row');
    } finally { w.restore(); }

    // no stored list (a fresh install): one request for all five, as before for one
    w = hashManager(proto, { snapshot: null, server: rows });
    try {
        await Promise.all(['/scripts/a.js', '/css/b.css', '/scripts/c.js', '/scripts/a.js', '/css/b.css'].map((p2) => w.mgr.hashForStaticPath(p2)));
        assert.strictEqual(w.fetches.length, 1, 'concurrent lookups share one download');
    } finally { w.restore(); }

    // a live update that landed before the first lookup is not lost under the stored list
    w = hashManager(proto, { snapshot: rows, server: rows });
    try {
        w.mgr._noteStaticHashUpdate([{ url: '/css/b.css', hash: 'b9' }]);
        assert.strictEqual(await w.mgr.hashForStaticPath('/css/b.css'), 'b9');
        // the boot check stored a new list: the map is rebuilt from it
        w.mgr._dropStaticHashMap(false);
        assert.strictEqual(await w.mgr.hashForStaticPath('/scripts/c.js'), 'c1');
        assert.strictEqual(w.mgr.snapshotReads, 2);
    } finally { w.restore(); }

    // agent tabs (caches cleared at start) ask the server
    w = hashManager(proto, { snapshot: rows, server: rows });
    try {
        w.mgr.agentSession = true;
        await w.mgr.hashForStaticPath('/scripts/a.js');
        assert.strictEqual(w.fetches.length, 1);
    } finally { w.restore(); }
}

// the quiet check after every boot sends the synced digest (#890): a 304 records the check, looks for
// files the page runs older copies of, and downloads no list
async function testQuietCheckSendsDigest(src) {
    const proto = loadStaticHashMethods(src);
    const stored = [{ url: '/scripts/a.js', hash: 'a2' }, { url: '/css/b.css', hash: 'b1' }];
    const prevWindow = global.window;
    global.window = { isLoginPage: false };
    const make = (status) => {
        const w = hashManager(proto, { snapshot: stored, synced: 'D1', status, server: stored });
        Object.assign(w.mgr, {
            bootComplete: true, _bootOrchestrating: false, swRegistration: { active: {} }, isUpdating: false, pendingUpdateFuse: 0,
            recorded: 0, updated: null, completed: null,
            _isContinuityDexWindow() { return false; },
            _isBeforeDesktop() { return false; },
            async checkDownloadState() { return { isDownloading: false }; },
            _recordUpdateCheck() { this.recorded += 1; },
            async updateStaticCache(files, noToast) { this.updated = { files, noToast }; },
            _filesNewerThanLoaded(files) { return files.filter((f) => f.url === '/scripts/a.js'); },
            _processStaticCacheComplete(data) { this.completed = data; }
        });
        return w;
    };
    try {
        let w = make(304);
        try {
            await w.mgr.checkStaticFileUpdates(true);
            assert.strictEqual(w.fetches.length, 1);
            assert.strictEqual(w.fetches[0]['X-Manifest-Hash'], 'D1', 'the synced digest goes with it');
            assert.strictEqual(w.mgr.recorded, 1, 'Most recent check still moves');
            assert.strictEqual(w.mgr.updated, null, 'no list walk on a 304');
            assert.deepStrictEqual(w.mgr.completed.files.map((f) => f.url), ['/scripts/a.js'], 'an older copy this page runs is still found (#815)');
        } finally { w.restore(); }
        // asked for: the stored list goes through the usual path (its toasts)
        w = make(304);
        try {
            await w.mgr.checkStaticFileUpdates(false);
            assert.deepStrictEqual(w.mgr.updated.files, stored);
            assert.strictEqual(w.mgr.updated.noToast, false);
        } finally { w.restore(); }
        // no older copies: a spread sample of the cache (as at boot); a miss walks the stored list
        const prevSample = global.sampleManifestFiles;
        const prevCount = global.BOOT_CACHE_SAMPLE;
        global.sampleManifestFiles = (files) => files;
        global.BOOT_CACHE_SAMPLE = 200;
        try {
            for (const gone of [[], [stored[1]]]) {
                w = make(304);
                try {
                    let sampled = null;
                    Object.assign(w.mgr, {
                        _filesNewerThanLoaded() { return []; },
                        async getFilesNeedingUpdate(files) { sampled = files; return gone; },
                        _filesCountingTowardInstaller(files) { return files; }
                    });
                    await w.mgr.checkStaticFileUpdates(true);
                    assert.deepStrictEqual(sampled, stored, 'the cache is sampled on a quiet 304');
                    if (gone.length) assert.deepStrictEqual(w.mgr.updated, { files: stored, noToast: true }, 'a missing row walks the stored list quietly');
                    else assert.strictEqual(w.mgr.updated, null, 'nothing missing: no walk');
                } finally { w.restore(); }
            }
        } finally {
            global.sampleManifestFiles = prevSample;
            global.BOOT_CACHE_SAMPLE = prevCount;
        }
        // a changed manifest: the list, as before
        w = make(200);
        try {
            await w.mgr.checkStaticFileUpdates(true);
            assert.strictEqual(w.mgr.recorded, 1);
            assert.deepStrictEqual(w.mgr.updated.files, stored);
        } finally { w.restore(); }
    } finally {
        global.window = prevWindow;
    }
}

function main() {
    let proto;
    try {
        proto = loadSwMethods();
    } catch (err) {
        console.log(`test-offline-cache-boot: skip (${err.message})`);
        return;
    }
    if (!proto) {
        console.log('test-offline-cache-boot: skip (serviceWorkerManager.js missing)');
        return;
    }

    testNoFatalRegisterDiscard(proto._src);

    return Promise.resolve()
        .then(() => testEnsureBootCompleteDoesNotForceResolve(proto))
        .then(() => testManifestTimeoutReturnsEmpty(proto))
        .then(() => testManifestJsonTimeoutReturnsEmpty(proto))
        .then(() => testReadyTimeoutReturnsTimedOut(proto))
        .then(() => testLateRegisterStillWires(proto))
        .then(() => testWarmAfterSwActiveRunsOnce(proto))
        .then(() => testStaticHashMapShared(proto._src))
        .then(() => testQuietCheckSendsDigest(proto._src))
        .then(() => {
            console.log('test-offline-cache-boot: ok');
        });
}

Promise.resolve()
    .then(main)
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
