#!/usr/bin/env node
// On the desktop a progress toast is Vista's progress dialog (toastManager.js ->
// fileOperationProgress.task): title as the header, message as the status, the bar as the bar, a
// Cancel button as the dialog's Cancel; done it closes, an error or result buttons keep it up in
// its complete state; no toast is drawn. Connection / startup status and plain toasts stay toasts.
// Run: node scripts/test-toast-progress-dialog.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const plain = (v) => JSON.parse(JSON.stringify(v));
const appended = [];
const tasks = [];

function mockElement(tagName = 'div') {
    return {
        tagName, className: '', style: {}, innerHTML: '', id: '',
        classList: { add() {}, remove() {}, contains: () => false },
        setAttribute() {}, appendChild: (c) => c, prepend: (c) => c, insertAdjacentHTML() {},
        querySelector: () => null, querySelectorAll: () => [], remove() {}
    };
}

function fakeTask(options) {
    const op = {
        options, header: options.title, line: options.line, percent: 0, shown: true,
        finished: false, completed: null, answer: 'close',
        setPercent(p) { op.percent = p; },
        setLine(t) { op.line = t; },
        setHeader(t) { op.header = t; },
        setOnCancel(fn) { op.options.onCancel = fn; },
        finish() { op.finished = true; },
        complete(c) { op.completed = c; return Promise.resolve(op.answer); }
    };
    tasks.push(op);
    return op;
}

const ctx = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    window: { AndroidNotification: null, isDesktop: true, localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame: (cb) => cb() },
    desktopSounds: { playBalloon() {} },
    requestAnimationFrame: (cb) => cb(),
    document: {
        body: { classList: { contains: (c) => c === 'desktop-mode' }, appendChild: (n) => appended.push(n) },
        getElementById: () => null,
        createElement: (tag) => mockElement(tag),
        querySelector: () => null
    },
    fileOperationProgress: { available: () => true, task: fakeTask }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/scripts/comp/toastManager.js'), 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);

(async () => {
    // Upscaling: the dialog, its bar and status, then done: it closes, nothing toasted
    const up = run(`showGlassToast('info', 'Upscaling Image', 'Upscaling image...', true, false, '<i></i>')`);
    assert.strictEqual(tasks.length, 1);
    const t = tasks[0];
    assert.deepStrictEqual(plain({ title: t.options.title, line: t.options.line }), { title: 'Upscaling Image', line: 'Upscaling image...' });
    run(`updateGlassToastProgress(${JSON.stringify(up)}, 40)`);
    assert.strictEqual(t.percent, 40);
    run(`updateGlassToastMessage(${JSON.stringify(up)}, 'Downloading result...')`);
    assert.strictEqual(t.line, 'Downloading result...');
    run(`updateGlassToastComplete(${JSON.stringify(up)}, { type: 'success', title: 'Upscale Complete', message: 'Done', showProgress: false })`);
    assert.ok(t.finished, 'success with nothing to act on: it closes');
    assert.strictEqual(t.completed, null);
    run(`removeGlassToast(${JSON.stringify(up)})`);

    // an update that is not the end keeps it running (type info, no showProgress false)
    const gen = run(`showGlassToast('info', 'Generating Image', 'Generating image...', true, false)`);
    const g = tasks[1];
    run(`updateGlassToastComplete(${JSON.stringify(gen)}, { type: 'info', title: 'Generating Image', message: 'Step 2 of 3' })`);
    assert.strictEqual(g.line, 'Step 2 of 3');
    assert.strictEqual(g.finished, false);
    run(`updateGlassToastImagePreview(${JSON.stringify(gen)}, 'data:x')`);
    run(`updateGlassToastReasoning(${JSON.stringify(gen)}, 'thinking')`);

    // an error stays up in its complete state with Close
    run(`updateGlassToastComplete(${JSON.stringify(gen)}, { type: 'error', title: 'Generation Failed', message: 'Out of Anlas', showProgress: false })`);
    assert.strictEqual(g.completed.header, 'Generation Failed');
    assert.deepStrictEqual(plain(g.completed.lines), [['Out of Anlas']]);
    assert.deepStrictEqual(plain(g.completed.buttons.map((b) => b.text)), ['Close']);
    run(`removeGlassToast(${JSON.stringify(gen)})`);
    assert.strictEqual(g.finished, false, 'the toast timing out does not shut the complete dialog');

    // result buttons: complete state, the pressed one runs
    let viewed = null;
    ctx.onView = (id) => { viewed = id; };
    const vibe = run(`showGlassToast('info', 'Vibe Encoding', 'Generating vibe...', true, false)`);
    const v = tasks[2];
    v.answer = 0;
    run(`updateGlassToastComplete(${JSON.stringify(vibe)}, { type: 'success', title: 'Vibe Encoded', message: 'Ready', showProgress: false, buttons: [{ text: 'View', onClick: (id) => onView(id) }] })`);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepStrictEqual(plain(v.completed.buttons.map((b) => b.text)), ['View', 'Close']);
    assert.strictEqual(viewed, vibe);

    // a Cancel button is the dialog's Cancel
    let stopped = null;
    ctx.onStop = (id) => { stopped = id; };
    const imp = run(`showGlassToast('info', 'Uploading Images', 'Uploading...', true, false, null, [{ text: 'Cancel', onClick: (id) => onStop(id) }])`);
    tasks[3].options.onCancel();
    assert.strictEqual(stopped, imp);

    // Generation Complete: the dialog closes, the tray balloon (desktop popup) says it
    const gen2 = run(`showGlassToast('info', 'Generating Image', 'Generating image...', true, false)`);
    run(`updateGlassToastComplete(${JSON.stringify(gen2)}, { type: 'success', title: 'Generation Complete', message: 'Image generated successfully!', showProgress: false })`);
    assert.ok(tasks[4].finished);
    assert.strictEqual(tasks[4].completed, null);

    assert.strictEqual(appended.length, 0, 'no toast drawn for any of them');

    // a progress toast removed and then its result toasted in the same turn: the result ends the
    // dialog (an error stays up in it, a success closes it), and no toast is drawn
    const meta = run(`showGlassToast('info', 'Metadata Cache', 'Starting rebuild...', true, false)`);
    const mt = tasks[5];
    run(`removeGlassToast(${JSON.stringify(meta)}); showGlassToast('error', 'Rebuild Failed', 'Disk full', false, 5000)`);
    assert.strictEqual(mt.completed.header, 'Rebuild Failed');
    const copy = run(`showGlassToast('info', 'Copying', 'Copying data to clipboard...', true, false)`);
    const ct = tasks[6];
    run(`removeGlassToast(${JSON.stringify(copy)}); showGlassToast('success', 'Images copied to clipboard!', 'Copied 3 image(s)', false, 3000)`);
    assert.ok(ct.finished);
    assert.strictEqual(ct.completed, null);
    // removed with nothing after: it closes on the next turn, and a later toast is a toast
    const lone = run(`showGlassToast('info', 'Importing Image', 'Importing...', true, false)`);
    run(`removeGlassToast(${JSON.stringify(lone)})`);
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(tasks[7].finished);
    run(`showGlassToast('success', 'Saved', 'Saved', false, 5000)`);
    assert.strictEqual(appended.length, 1, 'that one is a toast');
    // a progress toast with its own timeout: the dialog closes then
    run(`showGlassToast('info', 'Generating...', 'Starting', true, 20)`);
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(tasks[8].finished, 'closed at the timeout');
    // a success toast with the progress flag by mistake stays a toast
    run(`showGlassToast('success', 'Reference replaced successfully', '', true)`);
    assert.strictEqual(tasks.length, 9);
    appended.length = 0;

    // connection status and plain toasts stay toasts
    run(`showGlassToast('info', 'Connecting', 'Connecting...', true, false)`);
    run(`showGlassToast('success', 'Saved', 'Saved', false, 5000)`);
    assert.strictEqual(tasks.length, 9, 'no dialog for them');

    // off the desktop: a toast
    ctx.fileOperationProgress.available = () => false;
    run(`showGlassToast('info', 'Upscaling Image', 'Upscaling image...', true, false)`);
    assert.strictEqual(tasks.length, 9);

    console.log('test-toast-progress-dialog: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
