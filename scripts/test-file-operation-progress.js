#!/usr/bin/env node
// Vista's file operation progress dialog (fileOperationProgress.js): the sizes and times print the
// way the VM's dialog printed them, the movie timetables are sane, run() stops at Cancel, a failure
// asks Try Again / Skip / Cancel (Interrupted Action) with the dialog up and throws without it, and
// batches() moves the bar per chunk. Run: node scripts/test-file-operation-progress.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FP = require('../public/scripts/comp/fileOperationProgress.js');

// StrFormatByteSize as captured on the VM: three significant digits, truncated
assert.strictEqual(FP.formatBytes(4 * 2e9 + 300 * 200000), '7.50 GB', '304 items');
assert.strictEqual(FP.formatBytes(4 * 2e9), '7.45 GB', '4 items');
assert.strictEqual(FP.formatBytes(2e9), '1.86 GB');
assert.strictEqual(FP.formatBytes(40000 * 2000), '76.2 MB', 'Deleting 40,000 items (76.2 MB): truncated, not rounded');
assert.strictEqual(FP.formatBytes(30000 * 2000), '57.2 MB');
assert.strictEqual(FP.formatBytes(15000 * 2000), '28.6 MB');
assert.strictEqual(FP.formatBytes(6000 * 2000), '11.4 MB');
assert.strictEqual(FP.formatBytes(0), '0 bytes', 'Discovered 0 items (0 bytes)...');
assert.strictEqual(FP.formatBytes(1023), '1023 bytes');
assert.strictEqual(FP.formatBytes(1024), '1.00 KB');

// time left in steps of 5 s, Vista's capitalised units
assert.strictEqual(FP.formatDuration(10), '10 Seconds');
assert.strictEqual(FP.formatDuration(13), '15 Seconds');
assert.strictEqual(FP.formatDuration(2), '0 Seconds');
assert.strictEqual(FP.formatDuration(95), '1 Minute and 35 Seconds');
assert.strictEqual(FP.formatDuration(3600 + 120), '1 Hour and 2 Minutes');

// every operation has its movie strip and an increasing timetable inside its loop
for (const [op, movie] of Object.entries(FP.MOVIES)) {
    assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/vista-file-progress/movie-${op}.webp`)), `movie-${op}.webp`);
    assert.strictEqual(movie.times[0], 0, `${op} starts at 0`);
    for (let i = 1; i < movie.times.length; i++) assert.ok(movie.times[i] > movie.times[i - 1], `${op} frame ${i} after ${i - 1}`);
    assert.ok(movie.times[movie.times.length - 1] < movie.period, `${op} last frame inside the loop`);
}

// the dialog's words come from shell32's string tables
const src = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/fileOperationProgress.js'), 'utf8');
for (const s of ['Copying', 'Moving', 'Deleting', 'Recycling', 'More information', 'Less information', 'Items remaining:', 'Time remaining:', 'Calculating time remaining...', 'Canceling...']) {
    assert.ok(src.includes(`'${s}'`), s);
}

/** Enough of the DOM for the dialog's build(): elements, classes, children and events. */
function fakeDom() {
    class Node {
        constructor(tag) {
            this.tagName = tag;
            this.children = [];
            this.parentNode = null;
            this.dataset = {};
            this.attrs = {};
            this.listeners = {};
            this.style = { setProperty(k, v) { this[k] = v; } };
            this._text = '';
            const classes = new Set();
            this.classList = {
                add: (...c) => c.forEach((x) => classes.add(x)),
                remove: (...c) => c.forEach((x) => classes.delete(x)),
                toggle: (c, on) => ((on === undefined ? !classes.has(c) : on) ? classes.add(c) : classes.delete(c)),
                contains: (c) => classes.has(c)
            };
            Object.defineProperty(this, 'className', { get: () => [...classes].join(' '), set: (v) => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => classes.add(x)); } });
        }
        get textContent() { return this.text(); }
        set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v); }
        text() { return this._text + this.children.map((c) => (typeof c === 'string' ? c : c.text())).join(''); }
        append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
        appendChild(n) {
            if (n && typeof n === 'object') { if (n.parentNode) n.remove(); n.parentNode = this; }
            this.children.push(n);
            return n;
        }
        replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
        removeChild(n) { n.remove(); return n; }
        remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; } }
        replaceWith(n) { const p = this.parentNode; const i = p.children.indexOf(this); n.parentNode = p; p.children[i] = n; this.parentNode = null; }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        getAttribute(k) { return this.attrs[k]; }
        removeAttribute(k) { delete this.attrs[k]; }
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
        fire(type, props) { const ev = Object.assign({ preventDefault() {}, stopPropagation() {} }, props); (this.listeners[type] || []).forEach((fn) => fn(ev)); }
        focus() {}
    }
    const body = new Node('body');
    body.classList.add('desktop-mode');
    return { document: { body, createElement: (tag) => new Node(tag) } };
}

// run(): each item in turn, Cancel stops before the next one
(async () => {
    const seen = [];
    const result = await FP.run({ op: 'move', from: { name: 'a', path: '/a' }, to: { name: 'b', path: '/b' } },
        [{ name: 'x', size: 1 }, { name: 'y', size: 2 }, { name: 'z', size: 3 }],
        async (item, i, op) => {
            seen.push(item.name);
            if (i === 1) op.cancel();
        });
    assert.deepStrictEqual(seen, ['x', 'y'], 'Cancel stops before z');
    assert.deepStrictEqual(result, { done: 2, cancelled: true, shown: false, values: [undefined, undefined] });

    const all = await FP.run({ op: 'copy' }, [{ name: 'p' }, { name: 'q' }], async (item) => item.name);
    assert.deepStrictEqual(all, { done: 2, cancelled: false, shown: false, values: ['p', 'q'] });

    // off the desktop (no dialog) a failure throws for the caller's own message
    await assert.rejects(FP.run({ op: 'delete' }, [{ name: 'p' }], async () => { throw new Error('nope'); }), /nope/);

    // batches(): off the desktop one call with the whole list
    const lists = [];
    const one = await FP.batches({ op: 'delete' }, Array.from({ length: 45 }, (_, i) => `f${i}`), async (names) => { lists.push(names.length); return 'r'; });
    assert.deepStrictEqual(lists, [45]);
    assert.deepStrictEqual(one, { done: 45, cancelled: false, shown: false, values: ['r'] });

    // the bar follows bytes when the items have sizes, items otherwise
    const op = FP.begin({ op: 'copy', items: [{ name: 'a', size: 300 }, { name: 'b', size: 100 }] });
    op.done({ name: 'a', size: 300 });
    assert.strictEqual(op.fraction(), 0.75);
    op.finish();
    const op2 = FP.begin({ op: 'delete', items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] });
    op2.done({ name: 'a' });
    assert.strictEqual(op2.fraction(), 0.25);
    op2.finish();
    assert.strictEqual(op2.headerText, 'Deleting 4 items', 'no "(0 bytes)" for items whose size is not known');
    const op3 = FP.begin({ op: 'recycle', items: Array.from({ length: 6000 }, () => ({ size: 2000 })) });
    assert.strictEqual(op3.headerText, 'Recycling 6,000 items (11.4 MB)', 'the VM header');
    op3.finish();

    // with the dialog up (a desktop): the module in a window whose body is the desktop, and the
    // dialog's DOM stubbed; Interrupted Action answers come from showConfirmationDialog
    const answers = [];
    const asked = [];
    const win = {
        showConfirmationDialog: async (message, options, _event, config) => { asked.push({ message, buttons: options.map((o) => o.text), title: config.title }); return answers.shift(); }
    };
    const ctx = vm.createContext({ window: win, console: { ...console, error() {} }, setTimeout, clearTimeout, Promise, Date, Math });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/scripts/comp/fileOperationProgress.js'), 'utf8'), ctx);
    const W = win.fileOperationProgress;
    const up = (options) => {
        const o = W.begin(options);
        // the dialog's parts, as build() would make them
        Object.assign(o, { modal: {}, cancelButton: {}, timeLine: {}, timeValue: {}, render() {}, close() { o.modal = null; } });
        return o;
    };

    // Try Again runs it again; it goes through the second time
    let tries = 0;
    let o = up({ op: 'copy', items: [{ name: 'a.png', size: 10 }] });
    answers.push('retry');
    let r = await o.attempt({ name: 'a.png' }, async () => { tries += 1; if (tries === 1) throw new Error('The network name is no longer available.'); return 'ok'; });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { ok: true, value: 'ok' });
    assert.strictEqual(tries, 2);
    assert.strictEqual(asked[0].title, 'Interrupted Action');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(asked[0].buttons)), ['Try Again', 'Skip', 'Cancel']);
    assert.match(asked[0].message, /keeping you from copying the file/);
    assert.match(asked[0].message, /The network name is no longer available\./);
    assert.match(asked[0].message, /<b>a\.png<\/b>/);

    // Skip goes on (not cancelled), Cancel stops the operation
    o = up({ op: 'delete', items: [{ name: 'x' }] });
    answers.push('skip');
    r = await o.attempt({ name: 'x' }, async () => { throw new Error('denied'); });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(o.cancelled, false);
    answers.push('cancel');
    r = await o.attempt({ name: 'x' }, async () => { throw new Error('denied'); });
    assert.strictEqual(o.cancelled, true);
    assert.match(asked[asked.length - 1].message, /keeping you from deleting the file/);

    // a download (Alchemy): one item whose bytes arrive, the total learned late, Cancel's hook, and
    // the complete state with its own buttons; the real build() over a small DOM
    const dom = fakeDom();
    const dwin = { openModal() {}, closeModal() {} };
    const dctx = vm.createContext({ window: dwin, document: dom.document, console: { ...console, error() {} }, setTimeout, clearTimeout, Promise, Date, Math,
        requestAnimationFrame: () => 1, cancelAnimationFrame() {}, performance: { now: () => 0 } });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/scripts/comp/fileOperationProgress.js'), 'utf8'), dctx);
    const D = dwin.fileOperationProgress;
    let cancels = 0;
    const dl = D.begin({ op: 'copy', items: [{ name: 'gadgets.zip' }], from: { name: 'example.com', path: 'https://example.com/' }, to: { name: 'Downloads', path: '/Workspaces/Main/Downloads' }, onCancel: () => { cancels += 1; } });
    assert.ok(dl.shown, 'up on the desktop');
    assert.strictEqual(dl.headerLabel.textContent, 'Copying 1 item');
    dl.progress(50 * 1048576, 200 * 1048576);
    assert.strictEqual(dl.headerLabel.textContent, 'Copying 1 item (200 MB)', 'the total sizes the header once known');
    assert.strictEqual(dl.barFill.style.width, '25%');
    const answer = dl.complete({
        header: 'Download complete',
        lines: [[{ b: 'gadgets.zip' }, ' from ', 'example.com'], ['Downloaded 200 MB in 5 Seconds']],
        buttons: [{ text: 'Open', value: 'open', primary: true }, { text: 'Open Folder', value: 'folder' }, { text: 'Close', value: 'close' }]
    });
    assert.strictEqual(dl.captionText.textContent, 'Download complete');
    assert.strictEqual(dl.headerLabel.textContent, 'Download complete');
    assert.strictEqual(dl.barFill.style.width, '100%');
    assert.deepStrictEqual(dl.footer.children.map((b) => b.textContent), ['Open', 'Open Folder', 'Close'], 'the buttons in place of More information and Cancel');
    assert.deepStrictEqual(dl.summary.children.map((l) => l.text()), ['gadgets.zip from example.com', 'Downloaded 200 MB in 5 Seconds']);
    assert.ok(dl.modal.classList.contains('file-progress-complete'));
    dl.footer.children[1].fire('click');
    assert.strictEqual(await answer, 'folder');
    assert.strictEqual(dl.shown, false, 'a button shuts it');
    assert.strictEqual(cancels, 0, 'completing is not cancelling');

    // Cancel calls the hook once; Escape on a completed dialog shuts it as Close
    const dl2 = D.begin({ op: 'copy', items: [{ name: 'b.bin' }], onCancel: () => { cancels += 1; } });
    dl2.cancel();
    dl2.cancel();
    assert.strictEqual(cancels, 1);
    dl2.finish();
    const dl3 = D.begin({ op: 'copy', items: [{ name: 'c.bin', size: 5 }] });
    const shut = dl3.complete({ header: 'Download complete', lines: [] });
    dl3.modal.fire('keydown', { key: 'Escape' });
    assert.strictEqual(await shut, 'close');
    // downloads say Downloading (the copy movie), and a failure asks about downloading
    const dl4 = D.begin({ op: 'copy', verb: 'Downloading', items: [{ name: 'g.zip', size: 2048 }] });
    assert.strictEqual(dl4.headerLabel.textContent, 'Downloading 1 item (2.00 KB)');
    assert.strictEqual(dl4.modal.dataset.fileOp, 'copy');
    assert.strictEqual(dl4.errorVerb, 'downloading');
    dl4.finish();

    // a task (a progress toast's work): its title as the header, its status, a percent bar; no
    // Cancel unless something can stop it, and Close then shuts only the window
    const tk = D.task({ title: 'Upscaling Image', line: 'Upscaling image...' });
    assert.strictEqual(tk.headerLabel.textContent, 'Upscaling Image');
    assert.strictEqual(tk.captionText.textContent, 'Upscaling Image');
    assert.strictEqual(tk.summary.children[0].text(), 'Upscaling image...');
    assert.strictEqual(tk.cancelButton.disabled, true, 'nothing can stop it');
    assert.strictEqual(tk.itemsValue, null, 'no items or speed for a task');
    tk.setPercent(30);
    assert.strictEqual(tk.barFill.style.width, '30%');
    tk.setLine('Saving...');
    assert.strictEqual(tk.summary.children[0].text(), 'Saving...');
    tk.setHeader('Upscaling Image (4x)');
    assert.strictEqual(tk.headerLabel.textContent, 'Upscaling Image (4x)');
    tk.modal.fire('keydown', { key: 'Escape' });
    assert.strictEqual(tk.shown, false);
    assert.strictEqual(tk.cancelled, false, 'closing is not cancelling');
    let stops = 0;
    const tk2 = D.task({ title: 'Uploading Images', onCancel: () => { stops += 1; } });
    assert.ok(!tk2.cancelButton.disabled);
    tk2.cancelButton.fire('click');
    assert.strictEqual(stops, 1);
    tk2.finish();
    // the amount not known yet (the gallery's first blocks): a marquee and no bar; once known, the bar
    const tkLoad = D.task({ title: 'Loading Gallery', line: 'Loading...' });
    tkLoad.setMarquee(true);
    tkLoad.setPercent(40);
    assert.ok(tkLoad.bar.classList.contains('marquee'));
    assert.strictEqual(tkLoad.barFill.style.width, '0%');
    tkLoad.setMarquee(false);
    assert.strictEqual(tkLoad.barFill.style.width, '40%');
    tkLoad.setMarquee(true);
    tkLoad.finish();
    assert.ok(!tkLoad.bar.classList.contains('marquee'), 'done: the bar full, not a marquee');
    assert.strictEqual(tkLoad.barFill.style.width, '100%');

    const tkDel = D.task({ title: 'Deleting Images' });
    assert.strictEqual(tkDel.modal.dataset.fileOp, 'delete', 'the movie follows the work');
    tkDel.finish();
    const tk3 = D.task({ title: 'Vibe Encoding' });
    tk3.setOnCancel(() => { stops += 1; });
    assert.strictEqual(tk3.cancelButton.disabled, false, 'a Cancel arriving later');
    tk3.finish();

    assert.strictEqual(D.formatElapsed(2.2), '2 Seconds');
    assert.strictEqual(D.formatElapsed(0.1), '1 Second');
    assert.strictEqual(D.formatElapsed(95), '1 Minute and 35 Seconds');

    console.log('test-file-operation-progress: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
