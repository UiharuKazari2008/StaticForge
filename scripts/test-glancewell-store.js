#!/usr/bin/env node
'use strict';
// Glancewell library store (modules/glancewellStore.js, Yozora #446) on a temporary database.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glancewell-'));
const store = require('../modules/glancewellStore');
store.init({ getPath: () => dir });

try {
    const a = { source: 'prints', key: 'a.png' };
    const b = { source: 'prints', key: 'b.png' };
    const p = { source: 'pictures', key: '/DCIM/x.jpg' };

    // Add Tags makes the tag; tags are case-insensitive per parent
    let out = store.setMeta([a, b], { addTags: ['Beach'], caption: 'My day at the beach' });
    assert.strictEqual(out.items.length, 2);
    const beach = out.items[0].tags[0];
    assert.ok(beach);
    store.setMeta([a], { addTags: ['beach'] });
    assert.deepStrictEqual(store.getMeta([a])[0].tags, [beach]);
    assert.strictEqual(store.getMeta([b])[0].caption, 'My day at the beach');

    // forward slash / semicolon refused (WPG 976)
    assert.throws(() => store.setMeta([a], { addTags: ['a/b'] }), /forward slash/);

    // nested tags: Beach > Sunset; Beach's items include Sunset's
    const sunset = store.editTag({ op: 'create', name: 'Sunset', parentId: beach }).id;
    store.setMeta([p], { addTags: [sunset] });
    assert.strictEqual(store.tagItems([beach]).length, 3);
    assert.strictEqual(store.tagItems([beach], 'pictures').length, 1);
    const counts = Object.fromEntries(store.listTags().map((t) => [t.name, t.count]));
    assert.deepStrictEqual(counts, { Beach: 2, Sunset: 1 });

    // a tag cannot move under its own sub-tag
    assert.throws(() => store.editTag({ op: 'move', id: beach, parentId: sunset }), /own sub-tag/);

    // rename onto an existing name reports a conflict; merge folds items and sub-tags in
    const sea = store.editTag({ op: 'create', name: 'Sea' }).id;
    store.setMeta([b], { addTags: [sea] });
    assert.ok(store.editTag({ op: 'rename', id: sea, name: 'BEACH' }).conflict);
    store.editTag({ op: 'merge', id: sea, into: beach });
    assert.ok(!store.listTags().some((t) => t.name === 'Sea'));
    assert.deepStrictEqual(store.getMeta([b])[0].tags, [beach]);

    // Remove All Tags, caption cleared by ''
    store.setMeta([b], { clearTags: true, caption: '' });
    assert.deepStrictEqual(store.getMeta([b])[0], { source: 'prints', key: 'b.png', caption: '', tags: [], taken: null, favorite: false });

    // Change Time Taken: -24..+24 hours from each picture's date
    assert.throws(() => store.setMeta([a], { takenShiftHours: 25 }), /between -24 and \+24/);
    store.setMeta([{ ...a, taken: 1000000 }], { takenShiftHours: -2 });
    assert.strictEqual(store.getMeta([a])[0].taken, 1000000 - 7200);
    store.setMeta([a], { takenShiftHours: 1 });
    assert.strictEqual(store.getMeta([a])[0].taken, 1000000 - 3600);

    // Pictures Favorites
    store.setMeta([p], { favorite: true });
    assert.deepStrictEqual(store.favorites('pictures').map((f) => f.key), ['/DCIM/x.jpg']);
    const idx = store.sourceIndex('pictures');
    assert.deepStrictEqual(idx.favorites, ['/DCIM/x.jpg']);
    assert.strictEqual(idx.tagged[0].tags[0], sunset);

    // device sources are allowed, unknown ones dropped
    assert.strictEqual(store.getMeta([{ source: 'device:abc-1', key: 'k' }, { source: 'nope', key: 'k' }]).length, 1);

    // Folders watched list
    assert.deepStrictEqual(store.setWatched({ add: [{ folder: 'f1', name: 'Holiday' }, { folder: 'f2', name: 'Art' }] }).map((f) => f.name), ['Art', 'Holiday']);
    assert.deepStrictEqual(store.setWatched({ remove: ['f2'] }).map((f) => f.folder), ['f1']);

    // forget clears everything the gallery kept
    store.forget([p]);
    assert.deepStrictEqual(store.getMeta([p])[0].tags, []);
    assert.strictEqual(store.favorites().length, 0);

    // deleting a tag drops it from its pictures, sub-tags included
    store.editTag({ op: 'delete', id: beach });
    assert.strictEqual(store.listTags().length, 0);
    assert.deepStrictEqual(store.getMeta([a])[0].tags, []);

    console.log('glancewell store: ok');
} finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
}
