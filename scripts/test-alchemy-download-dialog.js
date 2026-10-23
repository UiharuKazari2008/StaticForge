#!/usr/bin/env node
// Alchemy downloads (grimoireRemoteBrowser.js) each get their own Vista copy dialog
// (fileOperationProgress.js): it follows the bytes, the save into Downloads, and ends at Download
// complete with Open / Open Folder / Close. Cancel stops the remote download and nothing is
// saved; a file reported under another id finds its dialog; no toast at any point on the desktop.
// Run: node scripts/test-alchemy-download-dialog.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const plain = (v) => JSON.parse(JSON.stringify(v));

const ops = [];
const toasts = [];
const saves = [];
const posted = [];
const opened = [];
let handler = null;
let nextAnswer = 'folder';

function fakeOp(options) {
    const op = {
        options,
        items: options.items.map((i) => ({ ...i })),
        from: options.from,
        totalBytes: options.items[0].size || 0,
        started: Date.now(),
        cancelled: false,
        finished: false,
        bytes: [],
        completed: null,
        progress(bytes, total) { if (total) op.totalBytes = total; op.bytes.push(bytes); },
        async attempt(item, fn) { return { ok: true, value: await fn() }; },
        cancel() { if (op.cancelled) return; op.cancelled = true; if (options.onCancel) options.onCancel(); },
        finish() { op.finished = true; },
        async complete(c) { op.completed = c; op.finished = true; return nextAnswer; }
    };
    ops.push(op);
    return op;
}

const frame = { contentWindow: { postMessage: (m) => posted.push(m) } };
const shell = { _grimoireRemoteSessionId: 'abc', _grimoireRemoteViewQuery: 't=1', _grimoireRemoteUrl: 'https://example.com/gadgets' };
const found = { host: {}, shell, frame, tab: null };

const ctx = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    AbortController,
    activeWorkspace: 'ws1',
    workspaces: { ws1: { name: 'Main' } },
    addEventListener: (type, fn) => { if (type === 'message') handler = fn; },
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    window: { addEventListener() {} },
    showGlassToast: (...a) => { toasts.push(a); return 't' + toasts.length; },
    updateGlassToastProgress() {},
    updateGlassToastMessage() {},
    removeGlassToast() {},
    formatBytes: (n) => n + ' B',
    fetch: async (url, init) => {
        const body = JSON.parse(init.body);
        saves.push({ url, body });
        return { ok: true, json: async () => ({ ok: true, name: body.filename, path: '/Workspaces/ws1/f9', fileId: 'file' + saves.length, size: 1234 }) };
    },
    featureLoader: { loadFeature: async () => true },
    initializeExplorerApplet: () => ({
        showFileInFolder: async (p, id) => opened.push(['folder', p, id]),
        openFileInFolder: async (p, id) => opened.push(['open', p, id])
    }),
    fileOperationProgress: { available: () => true, begin: fakeOp, formatBytes: (n) => n + ' bytes', formatElapsed: () => '3 Seconds' }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/scripts/comp/grimoireRemoteBrowser.js'), 'utf8'), ctx);
ctx.grimoireRemoteFromMessage = () => found;
ctx.grimoireBindRemoteBrowserMessages();
const send = (data) => handler({ data });
const settle = () => new Promise((r) => setTimeout(r, 0));

(async () => {
    // two downloads at once: one dialog each, the bytes followed
    send({ type: 'grimoire-browser-download-progress', id: 'guid-aaaa1', filename: 'gadgets.zip', received: 10, total: 100 });
    send({ type: 'grimoire-browser-download-progress', id: 'guid-aaaa1', filename: 'gadgets.zip', received: 60, total: 100 });
    send({ type: 'grimoire-browser-download-progress', id: 'guid-bbbb2', filename: 'other.iso', received: 5, total: 0 });
    assert.strictEqual(ops.length, 2, 'one dialog per download');
    const [a, b] = ops;
    assert.strictEqual(a.options.op, 'copy');
    assert.deepStrictEqual(plain(a.options.items), [{ name: 'gadgets.zip', size: 100 }]);
    assert.deepStrictEqual(plain(a.options.from), { name: 'example.com', path: 'https://example.com/gadgets' });
    assert.deepStrictEqual(plain(a.options.to), { name: 'Downloads', path: '/Workspaces/Main/Downloads' });
    assert.deepStrictEqual(plain(a.bytes), [10, 60]);

    // the file is whole: saved into Downloads, then Download complete with its buttons; Open Folder shows it
    send({ type: 'grimoire-browser-download', id: 'guid-aaaa1', filename: 'gadgets.zip' });
    await settle();
    await settle();
    assert.strictEqual(saves.length, 1);
    assert.match(saves[0].url, /\/api\/grimoire-browser\/sessions\/abc\/save\?t=1/);
    assert.deepStrictEqual(plain(saves[0].body), { filename: 'gadgets.zip', workspaceId: 'ws1', download: 'guid-aaaa1' });
    assert.strictEqual(a.completed.header, 'Download complete');
    assert.deepStrictEqual(plain(a.completed.buttons.map((x) => x.text)), ['Open', 'Open Folder', 'Close']);
    assert.deepStrictEqual(plain(a.completed.lines[0]), [{ b: 'gadgets.zip' }, ' from ', 'example.com']);
    assert.match(plain(a.completed.lines[1]).join(''), /Downloaded 1234 bytes in 3 Seconds to /);
    await settle();
    assert.deepStrictEqual(plain(opened), [['folder', '/Workspaces/ws1/f9', 'file1']]);

    // Cancel: the remote browser is told, the dialog goes, and the finished file is not saved
    b.cancel();
    assert.deepStrictEqual(plain(posted), [{ type: 'grimoire-browser-download-cancel', id: 'guid-bbbb2' }]);
    assert.ok(b.finished);
    send({ type: 'grimoire-browser-download', id: 'guid-bbbb2', filename: 'other.iso' });
    await settle();
    assert.strictEqual(saves.length, 1, 'a cancelled download is not saved');
    assert.strictEqual(ops.length, 2, 'and no new dialog for it');

    // the page cancels: its dialog goes
    send({ type: 'grimoire-browser-download-progress', id: 'guid-cccc3', filename: 'c.bin', received: 1, total: 9 });
    const c = ops[2];
    send({ type: 'grimoire-browser-download-progress', id: 'guid-cccc3', filename: 'c.bin', canceled: true });
    assert.ok(c.finished);

    // the folder watch reports the file under another id first: it finishes the running dialog
    send({ type: 'grimoire-browser-download-progress', id: 'guid-dddd4', filename: 'd.zip', received: 1, total: 9 });
    const d = ops[3];
    nextAnswer = 'open';
    send({ type: 'grimoire-browser-download', id: 'f00dfeedf00dfeed', filename: 'd.zip' });
    await settle();
    await settle();
    await settle();
    assert.strictEqual(ops.length, 4, 'no second dialog for it');
    assert.ok(d.completed, 'the running dialog completes');
    assert.deepStrictEqual(plain(opened[1]), ['open', '/Workspaces/ws1/f9', 'file2']);

    // a quick download with no progress first still gets its dialog
    send({ type: 'grimoire-browser-download', id: 'guid-eeee5', filename: 'quick.txt' });
    await settle();
    await settle();
    assert.strictEqual(ops.length, 5);
    assert.ok(ops[4].completed);

    assert.deepStrictEqual(plain(toasts), [], 'no toast on the desktop');

    // off the desktop there is no dialog: the toasts speak
    ctx.fileOperationProgress.available = () => false;
    send({ type: 'grimoire-browser-download-progress', id: 'guid-ffff6', filename: 'f.zip', received: 1, total: 9 });
    assert.strictEqual(ops.length, 5);
    assert.strictEqual(toasts.length, 1);

    console.log('test-alchemy-download-dialog: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
