#!/usr/bin/env node
/**
 * #1287: closing a task stops what its Android app plays. wmTodayWidgets.js is too DOM-heavy to load, so this
 * test cuts the real stopPackage / isDismissed block out of the file (between the "const ended = new Map()" line
 * and the "window.wmMediaApps = {" line) and runs that text in a vm sandbox with a stub bridge and a fake clock.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/wmTodayWidgets.js'), 'utf8');
const a = src.indexOf('const ended = new Map()');
const b = src.indexOf('window.wmMediaApps = {');
assert(a > 0 && b > a, 'stopPackage block not found');
const block = src.slice(a, b);

let now = 1000000;
const calls = [];
let state = { sessions: [] };
const events = [];
let repaints = 0;
const ctx = {
    Date: { now: () => now },
    JSON, CustomEvent: function (n) { this.type = n; },
    document: { dispatchEvent: (e) => events.push(e.type) },
    OWN_PKG: /^jp\.net\.seventhreeseven\.dreamscape/,
    musicRepaint: () => { repaints++; },
    mediaBridge: () => ({
        getState: () => JSON.stringify(state),
        pause: (id) => calls.push(['pause', id]),
        stop: (id) => calls.push(['stop', id])
    })
};
vm.createContext(ctx);
vm.runInContext(block + '\nthis.stopPackage = stopPackage; this.isDismissed = isDismissed;', ctx);

state = { sessions: [
    { id: 's1', package: 'com.google.android.youtube', state: 'playing' },
    { id: 's2', package: 'com.google.android.youtube', state: 'paused' },
    { id: 's3', package: 'com.spotify.music', state: 'playing' },
    { id: 's4', package: 'jp.net.seventhreeseven.dreamscape.app', state: 'playing' }
] };

assert.strictEqual(ctx.stopPackage('com.google.android.youtube'), true);
assert.deepStrictEqual(calls, [['pause', 's1'], ['stop', 's1'], ['pause', 's2'], ['stop', 's2']]);
console.log('ok  only the matching package got pause+stop:', JSON.stringify(calls));
assert.strictEqual(repaints, 1);
assert.deepStrictEqual(events, ['wmMediaChange']);
console.log('ok  one repaint and one wmMediaChange');

assert.strictEqual(ctx.isDismissed('com.google.android.youtube', { state: 'paused' }), true);
assert.strictEqual(ctx.isDismissed('com.spotify.music', { state: 'playing' }), false);
console.log('ok  other package never dismissed');

now += 1000; // stale 'playing' right after the stop does not undo it
assert.strictEqual(ctx.isDismissed('com.google.android.youtube', { state: 'playing' }), true);
console.log('ok  stale playing inside the grace is still dismissed');

now += 5000; // really plays again
assert.strictEqual(ctx.isDismissed('com.google.android.youtube', { state: 'paused' }), true);
assert.strictEqual(ctx.isDismissed('com.google.android.youtube', { state: 'playing' }), false);
assert.strictEqual(ctx.isDismissed('com.google.android.youtube', { state: 'paused' }), false);
console.log('ok  dismissal cleared when the package plays again');

calls.length = 0;
assert.strictEqual(ctx.stopPackage('jp.net.seventhreeseven.dreamscape.app'), false);
assert.strictEqual(ctx.stopPackage('com.nobody'), false);
assert.strictEqual(ctx.stopPackage(''), false);
assert.deepStrictEqual(calls, []);
assert.strictEqual(ctx.isDismissed('com.nobody', { state: 'paused' }), false);
console.log('ok  own package / unknown package / empty: nothing called, nothing dismissed');

ctx.stopPackage('com.spotify.music');
now += 10 * 60000 + 1;
assert.strictEqual(ctx.isDismissed('com.spotify.music', { state: 'paused' }), false);
console.log('ok  dismissal expires after 10 minutes');
console.log('all passed');
