#!/usr/bin/env node
/**
 * ActiveSync Received Items (Yozora #803): what reached the phone while it was away.
 *   node scripts/test-activesync-received.js [dbDir]
 */
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'asrx-'));
const gr = { getPath: () => dir, getWebSocketServer: () => null };
const as = require('../modules/activeSync');

const dev = 'a'.repeat(32);
// receivedOf is internal: go through the exported list/update and a queued delivery stand-in
const internals = as.__test || null;
assert.deepStrictEqual(as.listReceived(gr, dev), []);
if (internals) {
    internals.noteReceived(gr, null, dev, 'open.item', { kind: 'url', url: 'https://example.com', title: 'Example' }, 'PC');
    // a program (#1335): stream.receive into the app's temporary folder, then apps.install by transfer id.
    // An install is machinery, not something a person sent: no row, no unseen count, no received icon.
    internals.noteReceived(gr, null, dev, 'stream.receive', { transferId: 'f'.repeat(32), root: 'internal', dir: '/ActiveSync', name: 'app.apk', size: 10, temp: true }, 'PC');
    internals.noteReceived(gr, null, dev, 'stream.receive', { root: 'internal', dir: '/ActiveSync', name: 'older-app.apk', size: 10 }, 'PC');
    assert.strictEqual(as.listReceived(gr, dev).length, 1, 'an .apk stream records nothing');
    const before = as.receivedUnseen(gr, dev);
    internals.noteReceived(gr, null, dev, 'apps.install', { temp: 'f'.repeat(32), name: 'app.apk', root: 'internal', path: '/ActiveSync/app.apk' }, 'PC');
    assert.strictEqual(internals.receivedOf('apps.install', { temp: 'f'.repeat(32), name: 'app.apk' }), null);
    assert.strictEqual(as.receivedUnseen(gr, dev), before, 'an install leaves the unseen count unchanged');
    assert.strictEqual(as.listReceived(gr, dev).length, 1, 'an install records no row');
    // a picture, a file and clipboard text still record and count
    internals.noteReceived(gr, null, dev, 'stream.receive', { root: 'internal', dir: '/ActiveSync', name: 'cat.jpg', size: 10, mkdirs: true }, 'PC');
    internals.noteReceived(gr, null, dev, 'stream.receive', { root: 'internal', dir: '/ActiveSync', name: 'notes.txt', size: 10 }, 'PC');
    internals.noteReceived(gr, null, dev, 'clipboard.set', { text: 'hello' }, 'PC');
    internals.noteReceived(gr, null, dev, 'status.get', {}, 'PC');
    const list = as.listReceived(gr, dev);
    assert.deepStrictEqual(list.map((i) => i.kind), ['clipboard', 'file', 'picture', 'link'], 'status.get is not an item, no program rows');
    assert.strictEqual(list[3].detail.url, 'https://example.com');
    assert.strictEqual(list[2].detail.path, '/ActiveSync/cat.jpg');
    assert.strictEqual(as.receivedUnseen(gr, dev), 4);
    as.updateReceived(gr, null, dev, 'seen');
    assert.strictEqual(as.receivedUnseen(gr, dev), 0);
    as.updateReceived(gr, null, dev, 'remove', list[0].id);
    assert.strictEqual(as.listReceived(gr, dev).length, 3);
    as.updateReceived(gr, null, dev, 'clear');
    assert.strictEqual(as.listReceived(gr, dev).length, 0);
}
console.log('activeSync received items: ok');
