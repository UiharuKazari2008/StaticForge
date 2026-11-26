#!/usr/bin/env node
/**
 * A message box never wears the caption icon of whatever window is in front (Yukimi, Nov 26 2026: the weather rain
 * alarm's box showed Fleet's icon). confirmationDialog.js decides the box's owner itself (modalDialogs.ownerFor, the
 * MessageBox hWnd) and its icon (config.appIcon, the raising program's own), and marks it data-owner-decided so
 * modalUtils.js openModal never links it to the window in front; openModal also links no tool window no click or
 * key of the person opened. Offline, fake DOM.
 *
 *   node scripts/test-message-box-owner-icon.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const comp = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'comp', f), 'utf8');
const CD = comp('confirmationDialog.js');
const MU = comp('modalUtils.js');

/** One top-level function's source, from its declaration to the closing brace at column 0. */
function fnSource(src, name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} is there`);
    const end = src.indexOf('\n}\n', start);
    return src.slice(start, end + 2);
}

function fakeBox() {
    const attrs = new Map();
    const removed = [];
    return {
        id: 'confirmationDialog',
        dataset: {},
        removed,
        setAttribute: (k, v) => attrs.set(k, String(v)),
        removeAttribute: (k) => attrs.delete(k),
        hasAttribute: (k) => attrs.has(k),
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        querySelector: () => ({ querySelectorAll: () => [{ remove: () => removed.push('inherited') }] })
    };
}

function run(owner, config) {
    const box = fakeBox();
    box.setAttribute('data-parent-modal-id', 'staleWindow'); // left from an earlier open
    const ensured = [];
    const ctx = {
        confirmationDialog: box,
        window: { modalDialogs: { ownerFor: () => owner } },
        ensureModalApplicationIcon: (m) => ensured.push(m)
    };
    vm.runInNewContext(`${fnSource(CD, 'setConfirmationDialogOwnerIcon')}\nsetConfirmationDialogOwnerIcon(null, cfg);`, Object.assign(ctx, { cfg: config }));
    return { box, ensured };
}

// a box nobody's click raised (the server, a timer): no owner, so no inherited icon; its own program's icon when named
let r = run(null, { appIcon: 'melaton-weather.png' });
assert.ok(r.box.hasAttribute('data-owner-decided'));
assert.strictEqual(r.box.getAttribute('data-parent-modal-id'), null, 'no owner: no parent link (not the window in front)');
assert.strictEqual(r.box.dataset.appIcon, 'melaton-weather.png');
assert.strictEqual(r.ensured.length, 1);
assert.ok(r.box.removed.length > 0, 'an earlier inherited caption icon is dropped');

// a box with a real owner (MessageBox hWnd): that window, and no named icon left from before
r = run({ id: 'fleetWindow' }, {});
assert.strictEqual(r.box.getAttribute('data-parent-modal-id'), 'fleetWindow');
assert.strictEqual(r.box.dataset.appIcon, undefined);

// both open paths decide it before openModal
const calls = CD.split('setConfirmationDialogOwnerIcon(event, config);\n        openModal(confirmationDialog);').length - 1;
assert.strictEqual(calls, 2, 'message and input boxes both decide their owner before openModal');

// openModal's auto-link to the window in front skips owner-decided boxes and windows nobody's input opened
assert.ok(/!modal\.hasAttribute\('data-owner-decided'\) && personOpened\)/.test(MU), 'openModal guard');
assert.ok(/const personOpened = !navigator\.userActivation \|\| navigator\.userActivation\.isActive;/.test(MU));

// the icon resolver puts the raising program's own icon first
const resolve = fnSource(MU, 'resolveInheritedAppIcon');
assert.ok(resolve.indexOf('modal.dataset.appIcon') < resolve.indexOf('modalIconOwnerId(modal)'));

console.log('message box owner icon: ok');
