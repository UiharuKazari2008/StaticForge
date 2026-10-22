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

    console.log('test-file-operation-progress: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
