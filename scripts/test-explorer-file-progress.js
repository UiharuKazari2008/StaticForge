#!/usr/bin/env node
// Explorer runs its transfers through Vista's progress dialog (fileOperationProgress.js): moves and
// copies go one item per request with the dialog following them, Cancel stops before the next item
// (only the moved items leave the view), a failure is the dialog's question (no toast) and the rest
// go on, uploads go file by file (References asks over the dialog), deletes / Trash moves pick
// Deleting or Recycling, and no success toast follows an operation the dialog showed.
// Run: node scripts/test-explorer-file-progress.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// values made inside the vm context have its own Array / Object prototypes
const plain = (v) => JSON.parse(JSON.stringify(v));

const calls = [];
const begun = [];
const toasts = [];
let cancelAfter = Infinity;
let failIds = new Set();

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document: { body: { classList: { contains: () => false } }, getElementById: () => null, querySelector: () => null },
    window: {},
    showGlassToast: (...args) => { toasts.push(args); },
    desktopTaskMonitor: { sync: () => {} },
    vfsClient: {
        moveItems: async (refs, to) => {
            if (refs.some((r) => failIds.has(r.id))) throw new Error('disk full');
            calls.push(['move', refs.map((r) => r.id), to]);
        },
        copyItems: async (refs, to, opts) => { calls.push(['copy', refs.map((r) => r.id), to, opts]); },
        moveToTrash: async (refs) => { calls.push(['trash', refs.map((r) => r.id)]); },
        restoreFromTrash: async (id) => { calls.push(['restore', id]); },
        permanentlyDelete: async (refs) => { calls.push(['purge', refs.map((r) => r.trashItemId)]); },
        getPathStats: async (p) => ({ stats: { displayName: p.split('/').pop() === 'f42' ? 'Holiday' : 'X', displayPath: '/Workspaces/Main/Desktop/Holiday' } })
    },
    vfsImportRouter: {
        _parsePath: (p) => ({ systemFolder: p.split('/').filter(Boolean)[2] || null }),
        routeFilesToPath: async (p, files) => { calls.push(['upload', files.map((f) => f.name), p]); }
    },
    fileOperationProgress: {
        available: () => true,
        begin(options) {
            let done = 0;
            const op = {
                options,
                cancelled: false,
                finished: false,
                doneItems: [],
                failures: [],
                next() { return !op.cancelled; },
                done(item) { op.doneAll([item]); },
                doneAll(items) { for (const item of items) { op.doneItems.push(item); done += 1; if (done >= cancelAfter) op.cancelled = true; } },
                // the dialog's question, answered Skip
                async attempt(item, fn) {
                    try { return { ok: true, value: await fn() }; } catch (err) { op.failures.push(err.message); return { ok: false, error: err }; }
                },
                setPlace(which, place) { op.options[which] = place; },
                finish() { op.finished = true; }
            };
            begun.push(op);
            return op;
        }
    }
};
vm.createContext(sandbox);
vm.runInContext(read('public/scripts/comp/explorerApplet.js') + '\n;this.ExplorerApplet = ExplorerApplet;', sandbox);
const { ExplorerApplet } = sandbox;

function app(items, currentPath = '/Workspaces/ws1/Pictures') {
    const a = Object.create(ExplorerApplet.prototype);
    a.items = items;
    a.currentPath = currentPath;
    a.clipboard = null;
    a.grid = { replaceItems: () => {}, getSelectedItems: () => [] };
    a.loadedOffset = 0;
    a.el = {};
    a._isReadOnlyUser = () => false;
    a._isSamePasteDestination = () => false;
    a._touchesDesktop = () => false;
    a._isDesktopDestination = () => false;
    a._setBusyState = () => {};
    a._restoreStatusAfterOperation = async () => {};
    a._refsIncludeUserFiles = () => false;
    a.softRefresh = async () => {};
    a.updateStatusBar = async () => {};
    a.updateToolbarState = () => {};
    a.renderStatusText = () => {};
    a._serverItemCount = () => a.items.length;
    a._isWritableFolderPath = () => true;
    return a;
}

(async () => {
    const items = [
        { id: 'a', name: 'one.png', size: 100, kind: 'file', targetKind: 'image' },
        { id: 'b', name: 'two.png', size: 300, kind: 'file', targetKind: 'image' },
        { id: 'c', name: 'three.png', size: 500, kind: 'file', targetKind: 'image' }
    ];

    // a move: one request per item, the dialog told of each with its listed size
    let a = app(items.slice());
    const refs = items.map((i) => ({ id: i.id, name: i.name }));
    assert.strictEqual(await a.deliverItemsToPath(refs, '/Workspaces/ws1/Desktop/f42', 'cut', { sourcePath: a.currentPath }), true);
    assert.deepStrictEqual(plain(calls.map((c) => c.slice(0, 2))), [['move', ['a']], ['move', ['b']], ['move', ['c']]]);
    const move = begun.pop();
    assert.strictEqual(move.options.op, 'move');
    assert.deepStrictEqual(plain(move.options.items), [{ name: 'one.png', size: 100 }, { name: 'two.png', size: 300 }, { name: 'three.png', size: 500 }], 'sizes come from the listed items, not the refs');
    assert.deepStrictEqual(plain(move.options.from), { name: 'Pictures', path: '/Workspaces/ws1/Pictures' });
    assert.deepStrictEqual(plain(move.options.to), { name: 'Holiday', path: '/Workspaces/Main/Desktop/Holiday' }, 'the folder named by the server, not by its id');
    assert.ok(move.finished, 'the dialog closes');

    // Cancel after the first item: the rest stay, and only the moved one leaves the view
    calls.length = 0;
    cancelAfter = 1;
    a = app(items.slice());
    await a.deliverItemsToPath(refs, '/Workspaces/ws1/Desktop/f42', 'cut', { sourcePath: a.currentPath });
    assert.deepStrictEqual(plain(calls.map((c) => c[1])), [['a']]);
    assert.deepStrictEqual(plain(a.items.map((i) => i.id)), ['b', 'c'], 'only the moved item is taken out of the view');
    assert.ok(begun.pop().finished);
    cancelAfter = Infinity;

    // a failure is the dialog's question (Skip here): no toast, the next item still goes, and the
    // failed one stays in the view
    calls.length = 0;
    toasts.length = 0;
    failIds = new Set(['b']);
    a = app(items.slice());
    assert.strictEqual(await a.deliverItemsToPath(refs, '/Workspaces/ws1/Desktop/f42', 'cut', { sourcePath: a.currentPath }), true);
    assert.deepStrictEqual(plain(calls.map((c) => c[1])), [['a'], ['c']]);
    const failedMove = begun.pop();
    assert.deepStrictEqual(plain(failedMove.failures), ['disk full']);
    assert.deepStrictEqual(plain(a.items.map((i) => i.id)), ['b'], 'the item that failed stays');
    assert.deepStrictEqual(toasts, [], 'no toast beside the dialog');
    failIds = new Set();

    // a copy: the same, with the copy options for every item
    calls.length = 0;
    a = app(items.slice());
    await a.deliverItemsToPath(refs.slice(0, 2), '/Workspaces/ws1/Notes', 'copy', { sourcePath: a.currentPath });
    assert.deepStrictEqual(plain(calls.map((c) => [c[0], c[1]])), [['copy', ['a']], ['copy', ['b']]]);
    assert.strictEqual(begun.pop().options.op, 'copy');

    // an upload: file by file, a copy into the folder with no source; References asks per file, so no dialog
    calls.length = 0;
    a = app([]);
    const files = [{ name: 'x.png', size: 10 }, { name: 'y.png', size: 20 }];
    await a.uploadFilesToPath('/Workspaces/ws1/Pictures', files);
    assert.deepStrictEqual(plain(calls), [['upload', ['x.png'], '/Workspaces/ws1/Pictures'], ['upload', ['y.png'], '/Workspaces/ws1/Pictures']]);
    const up = begun.pop();
    assert.strictEqual(up.options.op, 'copy');
    assert.strictEqual(up.options.from, null);
    assert.deepStrictEqual(plain(up.options.items), [{ name: 'x.png', size: 10 }, { name: 'y.png', size: 20 }]);
    assert.ok(up.finished);
    // References asks what each file becomes over the dialog (Vista asks over it); the Desktop
    // folder takes no files, so no dialog for it
    await a.uploadFilesToPath('/Workspaces/ws1/References', files);
    assert.strictEqual(begun.pop().options.op, 'copy', 'References uploads show the dialog too');
    const before = begun.length;
    await a.uploadFilesToPath('/Workspaces/ws1/Desktop', files);
    assert.strictEqual(begun.length, before, 'no dialog for the Desktop folder');

    // restoring from Trash moves the items back, with no toast after the dialog
    calls.length = 0;
    toasts.length = 0;
    a = app([{ id: 't1', name: 'old.png', isTrashItem: true, trashItemId: 'T1' }], '/Workspaces/ws1/Trash');
    a.grid.getSelectedItems = () => a.items;
    await a.restoreTrashSelection();
    assert.deepStrictEqual(plain(calls), [['restore', 'T1']]);
    assert.strictEqual(begun.pop().options.op, 'move');
    assert.deepStrictEqual(toasts, [], 'no "restored" toast');

    // deleting from Trash: Deleting, no "permanently deleted" toast
    calls.length = 0;
    sandbox.showConfirmationDialog = async () => true;
    a = app([{ id: 't2', name: 'gone.png', isTrashItem: true, trashItemId: 'T2' }], '/Workspaces/ws1/Trash');
    a._isTrashPath = () => true;
    a.grid.getSelectedItems = () => a.items;
    await a.deleteSelection();
    assert.deepStrictEqual(plain(calls), [['purge', ['T2']]]);
    assert.strictEqual(begun.pop().options.op, 'delete');
    assert.deepStrictEqual(toasts, [], 'no "permanently deleted" toast');

    // off the desktop there is no dialog: the toasts speak
    sandbox.fileOperationProgress.available = () => false;
    calls.length = 0;
    a = app([{ id: 't3', name: 'back.png', isTrashItem: true, trashItemId: 'T3' }], '/Workspaces/ws1/Trash');
    a.grid.getSelectedItems = () => a.items;
    const begunBefore = begun.length;
    await a.restoreTrashSelection();
    assert.strictEqual(begun.length, begunBefore, 'no dialog off the desktop');
    assert.strictEqual(toasts.length, 1, 'the restored toast instead');
    sandbox.fileOperationProgress.available = () => true;

    // the CSS and script load with the explorer feature, the script before the applet
    const loader = read('public/scripts/comp/featureLoader.js');
    assert.match(loader, /explorer:\s*\{[^}]*css\/vista-file-progress\.css/);
    assert.match(loader, /'scripts\/comp\/fileOperationProgress\.js',[^\]]*'scripts\/comp\/explorerApplet\.js'/);

    console.log('test-explorer-file-progress: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
