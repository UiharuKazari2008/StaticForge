// #1248: a page start restores the pending record (the updates a reload left owed). A row whose file no copy on
// this client has is not owed: the recorded version is gone (a newer one landed and is what the page runs, or the
// download never arrived), so a restart cannot finish it. Left in, the fuse trips at every start: "Updates ready"
// and its restart prompt come back after each restart, the file it names can never appear, and the client loops.
//
// The loop this guards (live, 2026-11-26): a client's record named /scripts/comp/androidAppName.js at the swap
// before commit f60fc6bc5 (sha 23a1a6d138) while the server, the cache and the page all had the version after it
// (9da9aa937334) - five restarts on the Fold in 75 s, and a desktop client owing a restart since 02:44Z.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/serviceWorkerManager.js'), 'utf8');

/** The text of a method (async or not), by brace matching from its declaration. */
function methodText(name) {
    const at = src.search(new RegExp(`\\n    (?:async )?${name}\\([^)]*\\) \\{`));
    assert.ok(at > 0, `${name} exists`);
    const start = at + 1;
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
            depth -= 1;
            if (!depth) return src.slice(start, i + 1);
        }
    }
    throw new Error(`${name} has no end`);
}

const code = [
    methodText('_restorePendingUpdates'),
    methodText('_rowsHeldByCache'),
    methodText('_prunePendingRows')
].join(',\n');

// the restored set is what the fuse, the batch, the DeX mirror and the toast all use
assert.ok(/const owed = await this\._rowsHeldByCache\(stale\);/.test(src), 'the stale rows are filtered by what the cache holds');
assert.ok(/this\.tripPendingUpdateFuse\(owed\.length\)/.test(src), 'the fuse counts the owed rows');
assert.ok(/if \(!owed\.length\) \{ this\._pendingClear\(\); return; \}/.test(src), 'nothing owed clears the record');

const build = (record, loadedShas, notHeld) => {
    const calls = { cleared: 0, tripped: [], batched: [] };
    const written = [];
    // the real methods sit on the prototype, so the stubs here win and the code under test is the file's own
    const real = new Function(`return { ${code} };`)();
    const self = Object.assign(Object.create(real), {
        agentSession: false,
        pendingUpdateFuse: false,
        pendingUpdateKind: null,
        pendingUpdateUrls: new Set(),
        _localPending: null,
        _pendingChain: Promise.resolve(),
        _pendingRecord: async () => record,
        _pendingWrite: async (next) => { written.push(next); },
        _pendingClear: () => { calls.cleared += 1; },
        _filesNewerThanLoaded: (rows) => rows.filter((f) => loadedShas[f.url] && loadedShas[f.url] !== f.hash),
        // the rows the cache does NOT hold at their hash
        getFilesNeedingUpdate: async (list) => list.filter((f) => notHeld.includes(f.url)),
        _isContinuityDexWindow: () => false,
        _noteUpdateBatch(files) { calls.batched.push(files.map((f) => f.url)); },
        tripPendingUpdateFuse(n) { calls.tripped.push(n); this.pendingUpdateFuse = true; },
        _scheduleUpdateCompleteToast() { /* the balloon */ }
    });
    return { self, calls, written, settle: () => self._pendingChain };
};

(async () => {
    // the loop: the record names a version no copy here has (the client's copy is another one entirely)
    let t = build({ rows: { '/scripts/comp/androidAppName.js': 'a'.repeat(64) }, at: 1 }, { '/scripts/comp/androidAppName.js': 'b'.repeat(64) }, ['/scripts/comp/androidAppName.js']);
    await t.self._restorePendingUpdates();
    await t.settle();
    assert.deepStrictEqual(t.calls.tripped, [], 'no restart is owed for a file this client does not hold');
    assert.strictEqual(t.self.pendingUpdateFuse, false, 'the fuse stays off');
    assert.strictEqual(t.calls.cleared, 1, 'the record is cleared');
    assert.deepStrictEqual(t.written, [null], 'the unheld row leaves the record (an emptied record goes)');

    // the real case: the new copy is here, the page runs the old one -> the restart is owed
    t = build({ rows: { '/scripts/comp/wmShell.js': 'c'.repeat(64) }, at: 1 }, { '/scripts/comp/wmShell.js': 'd'.repeat(64) }, []);
    await t.self._restorePendingUpdates();
    assert.deepStrictEqual(t.calls.tripped, [1], 'the held file keeps its owed restart');
    assert.strictEqual(t.self.pendingUpdateFuse, true);
    assert.deepStrictEqual([...t.self.pendingUpdateUrls], ['/scripts/comp/wmShell.js']);
    assert.deepStrictEqual(t.calls.batched, [['/scripts/comp/wmShell.js']]);

    // mixed: the row nothing here has goes, the one the cache holds stays owed
    t = build(
        { rows: { '/scripts/comp/androidAppName.js': 'a'.repeat(64), '/css/app.css': 'e'.repeat(64) }, at: 1 },
        { '/scripts/comp/androidAppName.js': 'b'.repeat(64), '/css/app.css': 'f'.repeat(64) },
        ['/scripts/comp/androidAppName.js']
    );
    await t.self._restorePendingUpdates();
    await t.settle();
    assert.deepStrictEqual(t.calls.tripped, [1]);
    assert.deepStrictEqual([...t.self.pendingUpdateUrls], ['/css/app.css']);
    assert.deepStrictEqual(Object.keys(t.written[0].rows), ['/css/app.css'], 'the dropped row leaves the record');

    // a record with nothing stale is left as it was (the check clears it, no fuse is tripped)
    t = build({ rows: { '/css/app.css': 'e'.repeat(64) }, at: 1 }, { '/css/app.css': 'e'.repeat(64) }, []);
    await t.self._restorePendingUpdates();
    assert.deepStrictEqual(t.calls.tripped, []);
    assert.strictEqual(t.calls.cleared, 1);

    // a cache that cannot be read never drops an owed restart
    t = build({ rows: { '/css/app.css': 'e'.repeat(64) }, at: 1 }, { '/css/app.css': 'f'.repeat(64) }, []);
    t.self.getFilesNeedingUpdate = async () => { throw new Error('no cache'); };
    await t.self._restorePendingUpdates();
    assert.deepStrictEqual(t.calls.tripped, [1], 'the restart stays owed when the cache cannot be read');

    console.log('pending update restore: ok');
})();
