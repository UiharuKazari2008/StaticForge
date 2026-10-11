'use strict';

// Start menu organizer layout: validates/normalizes the saved tree server-side
// (flat folders only, no nested folders, deduped ids), persists per owner,
// and "reset to default" just clears the saved row.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-menu-layout-'));
const { initializeStartMenuLayoutDatabase } = require('../modules/startMenuLayoutDatabase');
assert.strictEqual(initializeStartMenuLayoutDatabase(tmpDir), true);
const startMenuLayout = require('../modules/startMenuLayout');

function main() {
    // No customization yet.
    assert.strictEqual(startMenuLayout.getLayout(startMenuLayout.HUMAN_OWNER), null);

    // Save a layout with a folder and some top-level items, round-trip it.
    const layout = [
        { type: 'item', launchId: 'workspace' },
        { type: 'folder', id: 'accessories-1', name: 'Accessories', children: [
            { type: 'item', launchId: 'calculator' },
            { type: 'item', launchId: 'alarm' }
        ] },
        { type: 'item', launchId: 'studio' }
    ];
    const saved = startMenuLayout.saveLayout(startMenuLayout.HUMAN_OWNER, layout);
    assert.strictEqual(saved.length, 3);
    assert.strictEqual(saved[1].type, 'folder');
    assert.strictEqual(saved[1].children.length, 2);

    const loaded = startMenuLayout.getLayout(startMenuLayout.HUMAN_OWNER);
    assert.deepStrictEqual(loaded, saved);

    // Folder names get trimmed/control-chars stripped, never empty.
    const withMessyName = startMenuLayout.saveLayout(startMenuLayout.HUMAN_OWNER, [
        { type: 'folder', id: 'f2', name: '  Games  ', children: [] }
    ]);
    assert.strictEqual(withMessyName[0].name, 'Games');

    // Actual control characters (not just whitespace) are stripped too.
    const withControlChars = startMenuLayout.saveLayout(startMenuLayout.HUMAN_OWNER, [
        { type: 'folder', id: 'f2b', name: 'Ga\x00m\x1fes\x7f', children: [] }
    ]);
    assert.strictEqual(withControlChars[0].name, 'Games');

    assert.throws(
        () => startMenuLayout.normalizeLayout([{ type: 'folder', id: 'f3', name: '   ', children: [] }]),
        /empty/
    );

    // Folders cannot nest.
    assert.throws(
        () => startMenuLayout.normalizeLayout([
            { type: 'folder', id: 'f4', name: 'Outer', children: [
                { type: 'folder', id: 'f5', name: 'Inner', children: [] }
            ] }
        ]),
        /nested folders/
    );

    // Unknown node type rejected outright rather than silently dropped.
    assert.throws(
        () => startMenuLayout.normalizeLayout([{ type: 'widget', launchId: 'x' }]),
        /must be "item" or "folder"/
    );

    // Non-array layout rejected.
    assert.throws(() => startMenuLayout.normalizeLayout({ not: 'an array' }), /must be an array/);
    assert.throws(() => startMenuLayout.normalizeLayout(null), /must be an array/);

    // Duplicate launchIds (top-level or across a folder) are silently deduped,
    // keeping only the first occurrence — never a hard error, since a client
    // retry/race shouldn't brick the whole save.
    const deduped = startMenuLayout.normalizeLayout([
        { type: 'item', launchId: 'chat' },
        { type: 'folder', id: 'f6', name: 'Dup folder', children: [
            { type: 'item', launchId: 'chat' },
            { type: 'item', launchId: 'notebook' }
        ] }
    ]);
    assert.strictEqual(deduped[0].launchId, 'chat');
    assert.strictEqual(deduped[1].children.length, 1);
    assert.strictEqual(deduped[1].children[0].launchId, 'notebook');

    // Duplicate folder ids: second occurrence dropped.
    const dedupedFolders = startMenuLayout.normalizeLayout([
        { type: 'folder', id: 'same-id', name: 'First', children: [] },
        { type: 'folder', id: 'same-id', name: 'Second', children: [] }
    ]);
    assert.strictEqual(dedupedFolders.length, 1);
    assert.strictEqual(dedupedFolders[0].name, 'First');

    // Invalid ids (path-unsafe characters etc.) are rejected.
    assert.throws(() => startMenuLayout.normalizeLayout([{ type: 'item', launchId: '../../etc' }]), /Invalid id/);
    assert.throws(() => startMenuLayout.normalizeLayout([{ type: 'item', launchId: '' }]), /Invalid id/);

    // Reset clears the saved customization back to "no layout".
    startMenuLayout.resetLayout(startMenuLayout.HUMAN_OWNER);
    assert.strictEqual(startMenuLayout.getLayout(startMenuLayout.HUMAN_OWNER), null);

    // Per-owner scoping: a different owner never sees another's saved layout.
    startMenuLayout.saveLayout('yukimi', [{ type: 'item', launchId: 'chat' }]);
    assert.strictEqual(startMenuLayout.getLayout('someone-else'), null);

    console.log('start menu layout tests passed');
}

main();
