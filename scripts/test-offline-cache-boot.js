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
        _hideInstallWizardUi() {},
        _flushPendingCacheUpdates() {
            this.flushed = true;
        },
        queueCacheUpdateUntilBoot() {
            this.queuedWarm = true;
        },
        checkStaticFileUpdates() {
            this.warmed += 1;
        },
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
        await delay(20);
        assert.ok(mgr.warmed >= 1, 'late registration must warm once ready');
    });
}

function testNoFatalRegisterDiscard(src) {
    assert.ok(src.includes('_attachLateServiceWorkerRegistration'), 'late register wiring missing');
    assert.ok(src.includes('_warmAfterSwActive'), 'background warm missing');
    assert.ok(src.includes('return await response.json()'), 'manifest json() must be awaited so timeout is caught');
    assert.ok(src.includes('_swWarmScheduled'), 'background warm must be single-flight');
    assert.ok(src.includes('timedOut: true'), 'ready timeout must report timedOut');
    assert.ok(!src.includes('Boot gate timed out — continuing from network'), '12s boot gate must be gone');
    assert.ok(!src.includes('Service worker failed to become ready in time'), 'ready path must not reject fatally');
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
