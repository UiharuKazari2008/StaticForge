// #1167: a client must not be left owing a restart for files its page does not run. reconcilePendingUpdates()
// clears the fuse, kind, count and balloon when nothing in the pending set is used; it keeps what is used.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/serviceWorkerManager.js'), 'utf8');
const start = src.indexOf('    reconcilePendingUpdates() {');
assert.ok(start > 0, 'reconcilePendingUpdates exists');
const end = src.indexOf('\n    }\n', start) + 6;
const body = src.slice(start, end).replace(/^    reconcilePendingUpdates\(\) /, 'function reconcilePendingUpdates() ');
assert.ok(/reconcilePendingUpdates\(\);\s*\n\s*return this\.pendingUpdateFuse/.test(src), 'hasPendingUpdates reconciles first');
const make = (usedPaths) => {
    const calls = [];
    const self = {
        pendingUpdateFuse: true, pendingUpdateKind: 'restart', pendingApplyFiles: null,
        pendingUpdateUrls: new Set(['/css/wm-titanium.css', '/scripts/comp/wmTitanium.js']),
        _pageNeverUsed: (p) => !usedPaths.includes(p),
        tripPendingUpdateFuse(n) { calls.push(['trip', n]); },
        resetPendingUpdateFuse() { calls.push(['reset']); this.pendingUpdateFuse = false; this.pendingUpdateUrls.clear(); },
        hideUpdateToast() { calls.push(['hideToast']); },
        _isDesktopTrayMode: () => true,
        _hideServiceWorkerTrayPopup() { calls.push(['hideTray']); }
    };
    const fn = new Function('normalizeStaticFilePath', body + '; return reconcilePendingUpdates;')((p) => p);
    return { self, calls, run: () => fn.call(self) };
};
// nothing in use: the state is cleared (fuse off, kind null, balloon hidden)
let t = make([]);
assert.strictEqual(t.run(), true);
assert.strictEqual(t.self.pendingUpdateFuse, false);
assert.strictEqual(t.self.pendingUpdateKind, null);
assert.deepStrictEqual(t.calls.map((c) => c[0]), ['reset', 'hideToast', 'hideTray']);
// one file in use: it stays owed, the other is dropped, the count follows
t = make(['/scripts/comp/wmTitanium.js']);
assert.strictEqual(t.run(), false);
assert.strictEqual(t.self.pendingUpdateFuse, true);
assert.deepStrictEqual([...t.self.pendingUpdateUrls], ['/scripts/comp/wmTitanium.js']);
assert.deepStrictEqual(t.calls, [['trip', 1]]);
// an apply-in-place batch or a non-restart kind is left alone
t = make([]); t.self.pendingUpdateKind = 'css-only';
assert.strictEqual(t.run(), false); assert.strictEqual(t.self.pendingUpdateFuse, true);
console.log('pending update reconcile: ok');
