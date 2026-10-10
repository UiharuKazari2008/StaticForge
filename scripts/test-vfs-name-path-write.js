const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STALE_README_ID = '42f8488f-d458-438c-a61d-b59ea42966a2';
const CURRENT_README_ID = 'readme-current';
const GUEST_ID = 'guest-file-id';
const NOTES_OLD_ID = 'notes-old';
const NOTES_NEW_ID = 'notes-new';

const folders = [
    {
        id: 'cake-id',
        scope: 'workspace',
        workspace_id: 'lab-ws',
        parent_id: null,
        name: 'cake-kit',
        trashed_at: null
    },
    {
        id: 'old-id',
        scope: 'workspace',
        workspace_id: 'lab-ws',
        parent_id: 'cake-id',
        name: '_old',
        trashed_at: null
    }
];

const files = [
    fileRow(STALE_README_ID, 'README.json', 'cake-id', 1, 'stale-hash', '{"stale":true}'),
    fileRow(CURRENT_README_ID, 'README.json', 'cake-id', 10, 'current-hash', '{"current":true}'),
    fileRow(GUEST_ID, 'guest.json', 'cake-id', 3, 'guest-hash', '{"guest":true}'),
    fileRow(NOTES_OLD_ID, 'notes.txt', 'cake-id', 1, 'notes-old-hash', 'old notes'),
    fileRow(NOTES_NEW_ID, 'notes.txt', 'cake-id', 8, 'notes-new-hash', 'newer notes')
];

function fileRow(id, name, folderId, updatedAt, hash, text) {
    return {
        id,
        original_name: name,
        mime_type: name.endsWith('.json') ? 'application/json' : 'text/plain',
        size: Buffer.byteLength(text),
        scope: 'workspace',
        workspace_id: 'lab-ws',
        folder_id: folderId,
        preview_path: null,
        content_hash: hash,
        trashed_at: null,
        created_at: updatedAt,
        updated_at: updatedAt,
        text
    };
}

const vfsDatabasePath = require.resolve('../modules/vfsDatabase');
require.cache[vfsDatabasePath] = {
    id: vfsDatabasePath,
    filename: vfsDatabasePath,
    loaded: true,
    exports: {
        async getFolderById(id) {
            return folders.find((folder) => folder.id === id) || null;
        },
        async getFoldersByParent(scope, workspaceId, parentId) {
            return folders.filter((folder) => {
                if (folder.trashed_at) return false;
                if (folder.scope !== scope) return false;
                if (scope === 'workspace' && folder.workspace_id !== workspaceId) return false;
                return (folder.parent_id || null) === (parentId || null);
            });
        },
        async getEntriesByFolder() {
            return [];
        },
        async getUserFileById(id) {
            return files.find((file) => file.id === id) || null;
        },
        async getUserFilesByLocation(scope, workspaceId, folderId) {
            return files.filter((file) => {
                if (file.trashed_at) return false;
                if (file.scope !== scope) return false;
                if (scope === 'workspace' && file.workspace_id !== workspaceId) return false;
                return (file.folder_id || null) === (folderId || null);
            });
        },
        async createUserFile(input) {
            const row = fileRow(
                `created-${files.length + 1}`,
                input.originalName,
                input.folderId,
                Math.floor(Date.now() / 1000),
                input.contentHash,
                ''
            );
            row.mime_type = input.mimeType;
            row.size = input.size;
            row.scope = input.scope;
            row.workspace_id = input.workspaceId;
            row.preview_path = input.previewPath || null;
            row.created_at = row.updated_at;
            files.push(row);
            return row;
        },
        async updateUserFile(id, updates) {
            const row = files.find((file) => file.id === id);
            if (!row) return null;
            if (updates.original_name !== undefined) row.original_name = updates.original_name;
            if (updates.content_hash !== undefined) row.content_hash = updates.content_hash;
            if (updates.mime_type !== undefined) row.mime_type = updates.mime_type;
            if (updates.size !== undefined) row.size = updates.size;
            if (updates.preview_path !== undefined) row.preview_path = updates.preview_path;
            if (updates.folder_id !== undefined) row.folder_id = updates.folder_id;
            if (updates.scope !== undefined) row.scope = updates.scope;
            if (updates.workspace_id !== undefined) row.workspace_id = updates.workspace_id;
            row.updated_at = Math.floor(Date.now() / 1000);
            return row;
        },
        async deleteUserFile(id) {
            const index = files.findIndex((file) => file.id === id);
            if (index < 0) return { success: false, deleted: null };
            const [deleted] = files.splice(index, 1);
            return { success: true, deleted };
        },
        async countUserFilesByContentHash(contentHash) {
            return files.filter((file) => file.content_hash === contentHash).length;
        },
        async getUserFileStats(scope, workspaceId, folderId) {
            const rows = files.filter((file) => !file.trashed_at && file.scope === scope && (file.folder_id || null) === (folderId || null)
                && (scope !== 'workspace' || file.workspace_id === workspaceId));
            return {
                count: rows.length,
                totalSize: rows.reduce((sum, file) => sum + (file.size || 0), 0)
            };
        },
        async getFolderCountByParent(scope, workspaceId, parentId) {
            const rows = await this.getFoldersByParent(scope, workspaceId, parentId);
            return rows.length;
        },
        async getEntryCountByFolder() {
            return 0;
        },
        async getLinkedUserFileStatsByFolder() {
            return { totalSize: 0 };
        }
    }
};

const { VfsManager } = require('../modules/vfsManager');
const VfsWebSocketHandlers = require('../modules/vfsWebSocketHandlers');
const { _test } = require('../modules/mcpAgentFacade');

const userFilesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-name-path-'));
const workspaces = {
    'lab-ws': { name: 'Laboratory', files: [], scraps: [], pinned: [] }
};

const resources = {
    getWorkspaceManager: () => ({
        getWorkspaces: () => workspaces,
        getDesktopShortcuts: () => ({ shortcuts: [] }),
        _readWorkspaceGalleryFilenames: async () => []
    }),
    getPath(key) {
        if (key === 'userFiles') return userFilesDir;
        if (key === 'images') return path.join(userFilesDir, 'images');
        if (key === 'tempDownload') return path.join(userFilesDir, 'tmp');
        throw new Error(`Unexpected path key: ${key}`);
    },
    getSystemInfoCache: () => null,
    getReferenceMetadataDatabase: () => ({ getFileCacheForReferences: () => ({}) }),
    getNotesDatabase: () => ({ getNotesByWorkspace: async () => [] }),
    getVfsPathUuid: () => 'vfs-test',
    getVfsDatabase: () => require.cache[vfsDatabasePath].exports,
    getVfsManager: () => vfs,
    getWebSocketMessageHandlers: () => handlers,
    getWebSocketServer: () => null
};

const vfs = new VfsManager(resources);

const handlers = {
    globalResources: resources,
    sendToClient(ws, message) {
        ws.send(JSON.stringify(message));
    },
    sendError(ws, message, details, requestId) {
        this.sendToClient(ws, { type: 'error', message, details, requestId });
    },
    isDestructiveOperation() {
        return false;
    }
};
handlers.vfsHandlers = new VfsWebSocketHandlers(handlers);
VfsWebSocketHandlers.registerVfsPackets(handlers);

function namedFiles(folderId, name) {
    return files.filter((file) => file.folder_id === folderId && file.original_name === name && !file.trashed_at);
}

function toolJson(result) {
    assert.ok(result && result.content && result.content[0], 'tool result missing text');
    return JSON.parse(result.content[0].text);
}

async function call(name, args) {
    return _test.callTool(resources, { applicationAuth: { applicationScopes: ['vfs'] }, userType: 'admin' }, name, args);
}

async function run() {
    const namePath = await vfs.resolvePathInput('/Workspaces/Laboratory/cake-kit');
    assert.strictEqual(namePath, '/Workspaces/lab-ws/cake-id');
    const mixedPath = await vfs.resolvePathInput('/Workspaces/lab-ws/cake-kit/_old');
    assert.strictEqual(mixedPath, '/Workspaces/lab-ws/cake-id/old-id');
    const idPath = await vfs.resolvePathInput('/Workspaces/lab-ws/cake-id/old-id');
    assert.strictEqual(idPath, '/Workspaces/lab-ws/cake-id/old-id');
    await assert.rejects(
        () => vfs.resolvePathInput('/Workspaces/Laboratory/missing-kit'),
        /Folder not found: missing-kit/
    );

    const listed = toolJson(await call('vfs_list', { path: '/Workspaces/Laboratory/cake-kit' }));
    assert.strictEqual(listed.success, true, listed.error || 'list failed');
    assert.strictEqual(listed.path, '/Workspaces/lab-ws/cake-id');
    assert.ok(listed.items.some((item) => item.id === STALE_README_ID));
    assert.ok(listed.items.some((item) => item.name === '_old' && item.id === 'old-id'));

    const nestedList = toolJson(await call('vfs_list', { path: '/Workspaces/lab-ws/cake-id/old-id' }));
    assert.strictEqual(nestedList.success, true, nestedList.error || 'nested list failed');
    assert.strictEqual(nestedList.items.length, 0);

    const folderStat = toolJson(await call('vfs_stat', { path: '/Workspaces/Laboratory/cake-kit' }));
    assert.strictEqual(folderStat.success, true, folderStat.error || 'stat failed');
    assert.ok(folderStat.stats);
    assert.ok(folderStat.stats.itemCount >= 1);

    const before = files.length;
    const missing = await call('vfs_write', {
        path: '/Workspaces/Laboratory/cake-kit/missing-dir/lost.json',
        name: 'lost.json',
        fileData: Buffer.from('nope').toString('base64')
    });
    assert.strictEqual(missing.isError, true);
    assert.match(toolJson(missing).error, /not found/i);
    assert.strictEqual(files.length, before);
    assert.ok(!files.some((file) => file.folder_id === 'cake-kit' || file.folder_id === 'Laboratory'));

    const written = toolJson(await call('vfs_write', {
        path: '/Workspaces/Laboratory/cake-kit/eater.json',
        name: 'eater.json',
        fileData: Buffer.from('{"slice":1}').toString('base64')
    }));
    assert.strictEqual(written.success, true, written.error || 'name-path write failed');
    assert.strictEqual(written.overwritten, false);
    const eater = files.find((file) => file.original_name === 'eater.json');
    assert.ok(eater, 'eater.json was not stored');
    assert.strictEqual(eater.folder_id, 'cake-id');
    assert.notStrictEqual(eater.folder_id, 'cake-kit');

    const readBack = toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/eater.json' }));
    assert.strictEqual(readBack.success, true, readBack.error || 'read failed');
    assert.strictEqual(readBack.text, '{"slice":1}');

    const fileStat = toolJson(await call('vfs_stat', { path: '/Workspaces/Laboratory/cake-kit/eater.json' }));
    assert.strictEqual(fileStat.success, true, fileStat.error || 'file stat failed');
    assert.strictEqual(fileStat.entry.name, 'eater.json');
    assert.strictEqual(fileStat.entry.targetId, eater.id);

    const fileList = await call('vfs_list', { path: '/Workspaces/Laboratory/cake-kit/eater.json' });
    assert.strictEqual(fileList.isError, true);
    assert.match(toolJson(fileList).error, /not found/i);

    const replaced = toolJson(await call('vfs_write', {
        path: '/Workspaces/Laboratory/cake-kit',
        name: 'eater.json',
        fileData: Buffer.from('{"slice":2}').toString('base64')
    }));
    assert.strictEqual(replaced.success, true, replaced.error || 'overwrite failed');
    assert.strictEqual(replaced.overwritten, true);
    assert.strictEqual(namedFiles('cake-id', 'eater.json').length, 1);
    assert.strictEqual(namedFiles('cake-id', 'eater.json')[0].id, eater.id);
    const readReplaced = toolJson(await call('vfs_read', { path: '/Workspaces/lab-ws/cake-id/eater.json' }));
    assert.strictEqual(readReplaced.text, '{"slice":2}');

    const collapsed = toolJson(await call('vfs_write', {
        path: '/Workspaces/Laboratory/cake-kit/notes.txt',
        fileData: Buffer.from('today').toString('base64')
    }));
    assert.strictEqual(collapsed.success, true, collapsed.error || 'notes overwrite failed');
    const notes = namedFiles('cake-id', 'notes.txt');
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0].id, NOTES_NEW_ID);
    assert.ok(!files.some((file) => file.id === NOTES_OLD_ID));
    const notesRead = toolJson(await call('vfs_read', { path: '/Workspaces/Laboratory/cake-kit/notes.txt' }));
    assert.strictEqual(notesRead.text, 'today');

    const moved = toolJson(await call('vfs_move', {
        path: STALE_README_ID,
        dest: '_old'
    }));
    assert.strictEqual(moved.success, true, moved.error || 'move by id failed');
    const stale = files.find((file) => file.id === STALE_README_ID);
    assert.ok(stale);
    assert.strictEqual(stale.folder_id, 'old-id');
    assert.strictEqual(namedFiles('cake-id', 'README.json').length, 1);
    assert.strictEqual(namedFiles('cake-id', 'README.json')[0].id, CURRENT_README_ID);

    const wrongParent = await call('vfs_move', {
        path: `/Workspaces/Laboratory/cake-kit/_old/${GUEST_ID}`,
        dest: '_old'
    });
    assert.strictEqual(wrongParent.isError, true);
    assert.match(toolJson(wrongParent).error, /Not found/);
    assert.strictEqual(files.find((file) => file.id === GUEST_ID).folder_id, 'cake-id');

    const movedByPath = toolJson(await call('vfs_move', {
        path: `/Workspaces/Laboratory/cake-kit/${GUEST_ID}`,
        dest: '/Workspaces/Laboratory/cake-kit/_old'
    }));
    assert.strictEqual(movedByPath.success, true, movedByPath.error || 'move by id path failed');
    assert.strictEqual(files.find((file) => file.id === GUEST_ID).folder_id, 'old-id');

    const oldList = toolJson(await call('vfs_list', { path: '/Workspaces/Laboratory/cake-kit/_old' }));
    assert.strictEqual(oldList.success, true, oldList.error || 'list _old failed');
    assert.deepStrictEqual(
        oldList.items.map((item) => item.id).sort(),
        [GUEST_ID, STALE_README_ID].sort()
    );

    const stillMissing = await call('vfs_move', { path: 'does-not-exist', dest: '_old' });
    assert.strictEqual(stillMissing.isError, true);
    assert.match(toolJson(stillMissing).error, /Not found/);
}

run().then(() => {
    console.log('test-vfs-name-path-write: ok');
    process.exit(0);
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
