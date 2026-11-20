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

async function main() {
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

    // The save guard (#910): a whole-layout save names the revision it was edited from; a client that never read
    // the layout (an offline boot with the defaults on screen) or read an older one cannot replace it.
    const handler = require('../modules/ws/handlers/260-startMenuLayoutHandler');
    const sent = [];
    const ctx = { sendToClient: (ws, m) => sent.push(m), sendError: (ws, msg, code) => sent.push({ error: msg, code }) };
    const owner = startMenuLayout.HUMAN_OWNER;
    startMenuLayout.resetLayout(owner);
    const real = [{ type: 'folder', id: 'f1', name: 'Mine', children: [{ type: 'item', launchId: 'studio' }] }];
    await handler.handleSaveLayout(ctx, null, { layout: real, baseUpdatedAt: null });
    assert.strictEqual(sent.pop().data.success, true, 'nothing saved yet: base null saves');
    await handler.handleGetLayout(ctx, null, {});
    const read = sent.pop().data;
    assert.ok(read.updatedAt, 'the read carries the revision');
    await handler.handleSaveLayout(ctx, null, { layout: [{ type: 'item', launchId: 'chat' }], baseUpdatedAt: null });
    assert.strictEqual(sent.pop().code, 'STALE_LAYOUT', 'a client that never read the saved layout cannot replace it');
    await handler.handleSaveLayout(ctx, null, { layout: [{ type: 'item', launchId: 'chat' }], baseUpdatedAt: '2000-01-01T00:00:00.000Z' });
    assert.strictEqual(sent.pop().code, 'STALE_LAYOUT', 'an older revision cannot replace it');
    assert.strictEqual(startMenuLayout.getLayout(owner)[0].name, 'Mine', 'the saved layout is untouched');
    await new Promise((r) => setTimeout(r, 5));
    await handler.handleSaveLayout(ctx, null, { layout: real, baseUpdatedAt: read.updatedAt });
    const ok = sent.pop().data;
    assert.strictEqual(ok.success, true, 'the current revision saves');
    assert.ok(ok.updatedAt, 'and returns the next one');
    await handler.handleSaveLayout(ctx, null, { layout: real });
    assert.strictEqual(sent.pop().data.success, true, 'clients from before the guard (no baseUpdatedAt) still save');

    console.log('start menu layout tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
