'use strict';
// fault_76f79816ede4: public/scripts/comp/offlineFiles.js passes { signal: appScopeSignal } to addEventListener.
// melatonSegments.callerSignal() returns null outside a segment and a browser throws "Failed to convert value to
// AbortSignal" for { signal: null }. appScopeSignal is used at two places, both addEventListener: the window
// 'cafeofflinefiles' listener (line ~106) and the document 'DOMContentLoaded' listener (line ~556, only with a host
// and no Sync Center yet). Both are covered. The real file runs in fresh vm contexts; stubbed: window/document
// addEventListener (strict like a browser about `signal`), a minimal window.AndroidOfflineFiles host so the second
// listener is reached, localStorage, CustomEvent.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '../public/scripts/comp/offlineFiles.js');
const src = fs.readFileSync(file, 'utf8');

const NEW_LINE = /^\s*const appScopeSignal = .*$/m;
const OLD_LINE = "const appScopeSignal = root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' ? root.melatonSegments.callerSignal() : undefined;";
assert.ok(NEW_LINE.test(src), 'appScopeSignal line present');
assert.strictEqual(src.match(/const appScopeSignal =/g).length, 1);
assert.strictEqual(src.match(/signal: appScopeSignal/g).length, 2, 'appScopeSignal is used at exactly two places');

function load(source, melatonSegments) {
    const registered = []; // { target, type, options }
    const strict = (target) => (type, fn, options) => {
        if (options && typeof options === 'object' && 'signal' in options) {
            const s = options.signal;
            if (s !== undefined && !(s instanceof AbortSignal)) {
                throw new TypeError(`Failed to execute 'addEventListener' on 'EventTarget': Failed to convert value to 'AbortSignal'. (signal: ${s === null ? 'null' : typeof s})`);
            }
        }
        registered.push({ target, type, options });
    };
    const window = {
        addEventListener: strict('window'),
        dispatchEvent() { return true; },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        AndroidOfflineFiles: { call: () => '{}', endpoint: () => null }
    };
    if (melatonSegments) window.melatonSegments = melatonSegments;
    const document = {
        addEventListener: strict('document'),
        documentElement: { classList: { contains: () => false } }
    };
    const ctx = { window, document, console, CustomEvent: function CustomEvent() {}, AbortSignal };
    vm.createContext(ctx);
    // the file ends with (typeof window !== 'undefined' ? window : globalThis): `window` is the stub
    vm.runInContext(source, ctx, { filename: 'offlineFiles.js' });
    return registered;
}

const oneOf = (reg, target, type) => {
    const hits = reg.filter((r) => r.target === target && r.type === type);
    assert.strictEqual(hits.length, 1, `${target} ${type} registered once, got ${hits.length}`);
    return hits[0];
};

// (i) no melatonSegments
{
    const reg = load(src, null);
    assert.strictEqual(oneOf(reg, 'window', 'cafeofflinefiles').options.signal, undefined, '(i) window listener: no signal');
    assert.strictEqual(oneOf(reg, 'document', 'DOMContentLoaded').options.signal, undefined, '(i) document listener: no signal');
    assert.strictEqual(oneOf(reg, 'document', 'DOMContentLoaded').options.once, true, 'once kept');
}
// (ii) callerSignal() returns null (outside a segment)
{
    let asked = 0;
    const reg = load(src, { callerSignal: () => { asked++; return null; } });
    assert.ok(asked >= 1, 'callerSignal was asked');
    assert.strictEqual(oneOf(reg, 'window', 'cafeofflinefiles').options.signal, undefined, '(ii) window listener: signal undefined, not null');
    assert.strictEqual(oneOf(reg, 'document', 'DOMContentLoaded').options.signal, undefined, '(ii) document listener: signal undefined, not null');
}
// (ii b) a melatonSegments without callerSignal, and callerSignal returning other falsy values
for (const segs of [{}, { callerSignal: 'nope' }, { callerSignal: () => undefined }, { callerSignal: () => 0 }]) {
    const reg = load(src, segs);
    assert.strictEqual(oneOf(reg, 'window', 'cafeofflinefiles').options.signal, undefined);
    assert.strictEqual(oneOf(reg, 'document', 'DOMContentLoaded').options.signal, undefined);
}
// (iii) a real AbortSignal is passed through to both
{
    const signal = new AbortController().signal;
    const reg = load(src, { callerSignal: () => signal });
    assert.strictEqual(oneOf(reg, 'window', 'cafeofflinefiles').options.signal, signal, '(iii) window listener gets the segment signal');
    assert.strictEqual(oneOf(reg, 'document', 'DOMContentLoaded').options.signal, signal, '(iii) document listener gets the segment signal');
}

// the old line, built in memory, throws in case (ii): the test can fail
{
    assert.ok(NEW_LINE.test(src));
    const oldSrc = src.replace(NEW_LINE, `    ${OLD_LINE}`);
    assert.notStrictEqual(oldSrc, src, 'old line substituted');
    assert.ok(oldSrc.includes(OLD_LINE));
    assert.throws(() => load(oldSrc, { callerSignal: () => null }), /Failed to convert value to 'AbortSignal'/, 'old code throws with callerSignal() === null');
    // and the old code was fine in (i) and (iii): the stub is not stricter than a browser
    assert.doesNotThrow(() => load(oldSrc, null));
    assert.doesNotThrow(() => load(oldSrc, { callerSignal: () => new AbortController().signal }));
}

console.log('ok: offlineFiles callerSignal: no segments / null / real signal load cleanly, signal undefined or passed through at both listeners (old line throws on null)');
