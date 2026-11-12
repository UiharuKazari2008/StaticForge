/**
 * Cross-workspace move through the VFS path (Yozora #758).
 *
 * moveItems used to refuse every cross-workspace ref except a folder shortcut, so an
 * agent with no desktop menu (Yumiya, Chiyo, any MCP bot) could not move a print to
 * another workspace at all. The workspace-owned surfaces now go through the same calls
 * the desktop's Move to Workspace makes; this pins that routing.
 */
const assert = require('assert');
const path = require('path');

const fileRows = {
    'file-1': {
        id: 'file-1',
        original_name: 'notes.txt',
        mime_type: 'text/plain',
        size: 5,
        scope: 'workspace',
        workspace_id: 'ws-a',
        folder_id: 'folder-a',
        preview_path: null,
        content_hash: 'hash-1',
        trashed_at: null
    }
};

const userFileUpdates = [];

const vfsDatabasePath = require.resolve('../modules/vfsDatabase');
require.cache[vfsDatabasePath] = {
    id: vfsDatabasePath,
    filename: vfsDatabasePath,
    loaded: true,
    exports: {
        getTrashedTargetIdSet: async () => new Set(),
        getUserFileById: async (id) => fileRows[id] || null,
        updateUserFile: async (id, fields) => {
            userFileUpdates.push({ id, fields });
            fileRows[id] = { ...fileRows[id], ...fields };
            return fileRows[id];
        }
    }
};

const { VfsManager } = require('../modules/vfsManager');

const wmCalls = [];
const refCalls = [];
const noteCalls = [];

const vfs = new VfsManager({
    getWorkspaceManager: () => ({
        getWorkspaces: () => ({ 'ws-a': { name: 'A' }, 'ws-b': { name: 'B' } }),
        _readWorkspaceGalleryFilenames: async () => [],
        moveToWorkspaceArray: (type, items, targetWsId, sourceWsId) => {
            wmCalls.push({ type, items, targetWsId, sourceWsId });
            return items.length;
        }
    }),
    getPath: () => path.join('/tmp', 'vfs-cross-workspace-move-missing'),
    getSystemInfoCache: () => null,
    getReferenceMetadataDatabase: () => ({
        getFileCacheForReferences: () => ({}),
        removeReferenceFromWorkspace: (hash, wsId) => refCalls.push(['removeReference', hash, wsId]),
        addReferenceToWorkspace: (hash, wsId) => refCalls.push(['addReference', hash, wsId]),
        removeVibeFromWorkspace: (id, wsId) => refCalls.push(['removeVibe', id, wsId]),
        addVibeToWorkspace: (id, wsId) => refCalls.push(['addVibe', id, wsId])
    }),
    getNotesDatabase: () => ({
        getNotesByWorkspace: async () => [],
        getNote: async (id) => (id === 'note-1' ? { id, name: 'Note' } : null),
        updateNote: async (id, fields) => { noteCalls.push({ id, fields }); return { id, ...fields }; }
    })
});

const DEST = '/Workspaces/ws-b/Desktop';

async function run() {
    userFileUpdates.length = 0;
    wmCalls.length = 0;
    refCalls.length = 0;
    noteCalls.length = 0;

    // A picture and a scrap: the workspace gallery lists own them, so the move is the
    // desktop's own moveToWorkspaceArray.
    const [image] = await vfs.moveItems(
        [{ targetKind: 'image', targetId: 'print.png', name: 'print.png', workspaceId: 'ws-a' }],
        DEST
    );
    assert.deepStrictEqual(wmCalls[0], {
        type: 'files', items: ['print.png'], targetWsId: 'ws-b', sourceWsId: 'ws-a'
    });
    assert.strictEqual(image.targetId, 'print.png');
    assert.strictEqual(image.workspaceId, 'ws-b');
    assert.strictEqual(image.fromWorkspaceId, 'ws-a');

    await vfs.moveItems(
        [{ targetKind: 'scrap', targetId: 'scrap.png', name: 'scrap.png', workspaceId: 'ws-a' }],
        DEST
    );
    assert.deepStrictEqual(wmCalls[1], {
        type: 'scraps', items: ['scrap.png'], targetWsId: 'ws-b', sourceWsId: 'ws-a'
    });

    // References and vibes live in the reference database.
    await vfs.moveItems(
        [{ targetKind: 'reference', targetId: 'refhash', name: 'ref', workspaceId: 'ws-a' }],
        DEST
    );
    assert.deepStrictEqual(refCalls, [
        ['removeReference', 'refhash', 'ws-a'],
        ['addReference', 'refhash', 'ws-b']
    ]);

    refCalls.length = 0;
    await vfs.moveItems(
        [{ targetKind: 'vibe', targetId: 'vibe-1', name: 'vibe', workspaceId: 'ws-a' }],
        DEST
    );
    assert.deepStrictEqual(refCalls, [
        ['removeVibe', 'vibe-1', 'ws-a'],
        ['addVibe', 'vibe-1', 'ws-b']
    ]);

    await vfs.moveItems(
        [{ targetKind: 'note', targetId: 'note-1', name: 'Note', workspaceId: 'ws-a' }],
        DEST
    );
    assert.deepStrictEqual(noteCalls, [{ id: 'note-1', fields: { workspace_id: 'ws-b' } }]);

    // A VFS user file follows its workspace.
    await vfs.moveItems(
        [{ targetKind: 'user-file', targetId: 'file-1', name: 'notes.txt', workspaceId: 'ws-a' }],
        '/Workspaces/ws-b'
    );
    assert.deepStrictEqual(userFileUpdates[0], {
        id: 'file-1',
        fields: { folder_id: null, scope: 'workspace', workspace_id: 'ws-b' }
    });

    // A kind this path does not own still says why.
    await assert.rejects(
        () => vfs.moveItems(
            [{ targetKind: 'desktop-shortcut', targetId: 'x', name: 'x', workspaceId: 'ws-a' }],
            DEST
        ),
        /Cross-workspace move is only supported/
    );

    // Same-workspace moves are untouched: no workspace transfer happens, and the
    // picture lands in the target workspace instead of being reposted there.
    wmCalls.length = 0;
    await vfs.moveItems(
        [{ targetKind: 'image', targetId: 'print.png', name: 'print.png', workspaceId: 'ws-b' }],
        DEST
    ).catch(() => {});
    assert.deepStrictEqual(wmCalls, []);
}

run().then(() => {
    console.log('test-vfs-cross-workspace-move: ok');
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
