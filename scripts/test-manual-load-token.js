// loadIntoManualForm load token (Yozora StaticForge#1269, part 3).
//
// Fast preset switches (A -> B -> A) start a new loadIntoManualForm while an older one is parked on an
// await. The older load must stop there: it may not write its emphasis weight store (or any later state)
// on top of the newer preset. This test pulls the real function out of manualModalManager.js, runs it with
// a Proxy scope that stubs every free identifier, and drives the awaited helpers with deferred promises.
//
//   node scripts/test-manual-load-token.js [path-to-manualModalManager.js]
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');

const file = process.argv[2] || path.join(__dirname, '../public/scripts/comp/manualModalManager.js');
const source = fs.readFileSync(file, 'utf8');

// Slice the function out with the real parser (brace matching by hand breaks on template literals and regexes).
const ast = acorn.parse(source, { ecmaVersion: 'latest', allowHashBang: true });
const fnNode = ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id && n.id.name === 'loadIntoManualForm');
assert(fnNode, 'loadIntoManualForm not found');
const fnSource = source.slice(fnNode.start, fnNode.end);

function makeHarness() {
    const log = [];            // ordered writes: { kind, tag }
    const pending = [];        // parked helper promises: { name, tag, resolve, reject }
    const errors = [];
    let autoRelease = false;
    let latestStarted = null;  // tag of the load most recently started
    let rejectTag = null;      // a helper call from this tag rejects when released
    const overrides = Object.create(null);
    const stubs = Object.create(null);

    const dummyEl = () => {
        const store = { value: '', textContent: '', dataset: {} };
        const target = function () {};
        const el = new Proxy(target, {
            get(_t, k) {
                if (k in store) return store[k];
                if (k === 'then' || typeof k === 'symbol') return undefined;
                if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
                if (k === 'style') return {};
                return () => el;
            },
            set(_t, k, v) { store[k] = v; return true; },
            apply() { return el; }
        });
        return el;
    };

    const gate = (name) => {
        const tag = window.initialEdit && window.initialEdit.source ? window.initialEdit.source.tag : '?';
        return new Promise((resolve, reject) => {
            const entry = { name, tag, resolve, reject };
            if (autoRelease) {
                if (rejectTag === tag && name === 'loadPreciseReferencesFromMetadata') reject(new Error('boom'));
                else resolve();
                return;
            }
            pending.push(entry);
        });
    };

    const promptEl = new Proxy({}, {
        set(_t, k, v) {
            if (k === 'value') log.push({ kind: 'text', tag: String(v).replace(/^prompt-/, ''), latest: latestStarted });
            return true;
        },
        get(_t, k) { return k === 'value' ? '' : () => {}; }
    });

    const window = {};
    Object.assign(stubs, {
        window,
        document: { getElementById: () => dummyEl(), querySelector: () => dummyEl(), querySelectorAll: () => [] },
        manualPrompt: promptEl,
        manualPresetName: dummyEl(),
        hasCompiledContext: false,
        CUSTOM_RESOLUTION_AREA: { normal: 1, large: 2, max: 3 },
        applyForgeEditorInputToMetadata: (d) => d,
        clearManualForm: () => { log.push({ kind: 'clear', tag: window.initialEdit.source.tag, latest: latestStarted }); },
        selectManualResolution: () => gate('selectManualResolution'),
        loadPreciseReferencesFromMetadata: () => gate('loadPreciseReferencesFromMetadata'),
        requestDynamicContextResolution: () => gate('requestDynamicContextResolution'),
        loadEmphasisNormalizationFromForgeData: (fd) => {
            log.push({ kind: 'store', tag: fd && fd.tag, latest: latestStarted });
        },
        applyModelLocks: (d) => { log.push({ kind: 'locks', tag: d.tag, latest: latestStarted }); },
        showError: (msg) => { errors.push(msg); },
        console: { log() {}, warn() {}, error: (...a) => { if (process.env.DEBUG_LOAD) process.stderr.write(a.map(String).join(' ') + '\n'); } }
    });

    // Every other free identifier resolves to a callable dummy element or a recorded assignment.
    const scope = new Proxy(overrides, {
        has: (_t, k) => typeof k === 'string' && !(k in globalThis) && k !== 'arguments',
        get: (t, k) => {
            if (k === Symbol.unscopables) return undefined;
            if (k in stubs) return stubs[k];
            if (k in t) return t[k];
            // Unknown name: a callable dummy element (works as a function, a DOM node or a plain object).
            t[k] = dummyEl();
            return t[k];
        },
        set: (t, k, v) => { t[k] = v; return true; }
    });

    const ctx = vm.createContext({ __scope: scope, console: stubs.console, Promise, Object, Array, Number, String, Error });
    const load = vm.runInContext(`(function () { with (__scope) { return (${fnSource}); } })()`, ctx);

    return {
        log, pending, errors, window,
        setAuto(v) { autoRelease = v; },
        setRejectTag(t) { rejectTag = t; },
        start(tag) {
            latestStarted = tag;
            const data = {
                tag,
                preset_name: `Preset ${tag}`,
                prompt: `prompt-${tag}`,
                chara_reference_source: 'x',
                forge_data: { tag }
            };
            return load('preset', data);
        },
        async flush() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); }
    };
}

function assertNoStaleWrites(h, label) {
    for (const w of h.log) {
        if (w.kind === 'text' || w.kind === 'store' || w.kind === 'locks') {
            assert.strictEqual(w.tag, w.latest, `${label}: stale ${w.kind} from load ${w.tag} while ${w.latest} was the latest`);
        }
    }
}

// Seeded PRNG so a failing order can be replayed.
function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

async function runOverlap(pick, label, opts) {
    const h = makeHarness();
    if (opts && opts.rejectTag) h.setRejectTag(opts.rejectTag);
    const runs = [h.start('A1')];
    await h.flush();
    runs.push(h.start('B'));
    await h.flush();
    runs.push(h.start('A2'));
    // Release the parked helper promises in the order the policy chooses until everything settles.
    for (let guard = 0; guard < 200; guard++) {
        await h.flush();
        if (!h.pending.length) break;
        const idx = pick(h.pending.length);
        const [entry] = h.pending.splice(idx, 1);
        if (opts && opts.rejectTag === entry.tag && entry.name === 'loadPreciseReferencesFromMetadata') {
            entry.reject(new Error('boom'));
        } else {
            entry.resolve();
        }
    }
    await Promise.all(runs); // every load, stale or not, resolves normally
    assertNoStaleWrites(h, label);
    const stores = h.log.filter((w) => w.kind === 'store');
    const texts = h.log.filter((w) => w.kind === 'text');
    assert.strictEqual(texts[texts.length - 1].tag, 'A2', `${label}: final text is not from the last load`);
    assert.strictEqual(stores.length, 1, `${label}: expected exactly one weight store write, got ${stores.length}`);
    assert.strictEqual(stores[0].tag, 'A2', `${label}: final store is not from the last load`);
    assert.strictEqual(h.window.initialEdit.source.tag, 'A2', `${label}: initialEdit points at an older source`);
    return h;
}

(async () => {
    // Sequential, non-overlapping loads still run to the end every time.
    {
        const h = makeHarness();
        h.setAuto(true);
        await h.start('A1');
        await h.start('B');
        assert.deepStrictEqual(h.log.filter((w) => w.kind === 'store').map((w) => w.tag), ['A1', 'B']);
        assert.deepStrictEqual(h.log.filter((w) => w.kind === 'text').map((w) => w.tag), ['A1', 'B']);
        assert.deepStrictEqual(h.log.filter((w) => w.kind === 'locks').map((w) => w.tag), ['A1', 'B']);
        assert.deepStrictEqual(h.errors, []);
        assertNoStaleWrites(h, 'sequential');
    }

    // A lone load parked on every helper in turn still completes.
    {
        const h = makeHarness();
        const run = h.start('A1');
        for (let i = 0; i < 10 && !h.pending.length; i++) await h.flush();
        while (h.pending.length) {
            h.pending.shift().resolve();
            await h.flush();
        }
        await run;
        assert.deepStrictEqual(h.log.filter((w) => w.kind === 'store').map((w) => w.tag), ['A1']);
        assert.deepStrictEqual(h.log.filter((w) => w.kind === 'locks').map((w) => w.tag), ['A1']);
    }

    // Overlap: A1 -> B -> A2, helpers released FIFO, LIFO and in 300 seeded random orders.
    await runOverlap(() => 0, 'fifo');
    await runOverlap((n) => n - 1, 'lifo');
    for (let seed = 1; seed <= 300; seed++) {
        const r = rng(seed);
        await runOverlap((n) => Math.floor(r() * n), `random seed ${seed}`);
    }

    // A superseded load that fails must neither throw nor show an error; the live one still reports.
    {
        const r = rng(7);
        const h = await runOverlap((n) => Math.floor(r() * n), 'stale reject', { rejectTag: 'A1' });
        assert.deepStrictEqual(h.errors, [], 'a stale load reported an error');
        const r2 = rng(7);
        const h2 = makeHarness();
        const runs = [h2.start('A1')];
        await h2.flush();
        while (h2.pending.length) {
            const entry = h2.pending.shift();
            if (entry.name === 'loadPreciseReferencesFromMetadata') entry.reject(new Error('boom'));
            else entry.resolve();
            await h2.flush();
        }
        await Promise.all(runs);
        assert.deepStrictEqual(h2.errors, ['Failed to load data'], 'the live load must still report its own failure');
        void r2;
    }

    console.log('manual load token: ok');
})().catch((err) => {
    console.error(err && err.stack || err);
    process.exit(1);
});
