const assert = require('assert');
const path = require('path');

const vfsDatabasePath = require.resolve('../modules/vfsDatabase');
require.cache[vfsDatabasePath] = {
    id: vfsDatabasePath,
    filename: vfsDatabasePath,
    loaded: true,
    exports: {
        getTrashedTargetIdSet: async () => new Set()
    }
};

const { VfsManager } = require('../modules/vfsManager');

const galleryByWorkspace = {
    'ws-b': {
        files: ['other-a.png', 'other-b.png'],
        scraps: ['scrap-b.png']
    },
    default: {
        files: ['active.png'],
        scraps: []
    }
};

const workspaces = {
    'ws-b': { name: 'B', files: [], scraps: [] },
    default: { name: 'Default', files: ['stale-should-not-use.png'], scraps: [] }
};

const vfs = new VfsManager({
    getWorkspaceManager: () => ({
        getWorkspaces: () => workspaces,
        _readWorkspaceGalleryFilenames: async (workspaceId, bucket) => (
            galleryByWorkspace[workspaceId]?.[bucket] || []
        )
    }),
    getPath: () => path.join('/tmp', 'vfs-pictures-list-missing'),
    getSystemInfoCache: () => null,
    getReferenceMetadataDatabase: () => ({
        getFileCacheForReferences: () => ({})
    }),
    getNotesDatabase: () => ({
        getNotesByWorkspace: async () => []
    })
});

async function run() {
    const pictures = await vfs.listDirectory('/Workspaces/ws-b/Pictures');
    assert.strictEqual(pictures.totalCount, 2);
    assert.deepStrictEqual(
        pictures.items.map((item) => item.name).sort(),
        ['other-a.png', 'other-b.png']
    );
    assert.ok(pictures.items.every((item) => item.workspaceId === 'ws-b'));
    assert.ok(pictures.items.every((item) => item.targetKind === 'image'));

    const scraps = await vfs.listDirectory('/Workspaces/ws-b/Scraps');
    assert.strictEqual(scraps.totalCount, 1);
    assert.strictEqual(scraps.items[0].name, 'scrap-b.png');
    assert.strictEqual(scraps.items[0].workspaceId, 'ws-b');
    assert.strictEqual(scraps.items[0].targetKind, 'scrap');

    const pictureStats = await vfs._getSystemFolderPathStats({
        workspaceId: 'ws-b',
        systemName: 'Pictures'
    });
    assert.strictEqual(pictureStats.itemCount, 2);

    const scrapStats = await vfs._getSystemFolderPathStats({
        workspaceId: 'ws-b',
        systemName: 'Scraps'
    });
    assert.strictEqual(scrapStats.itemCount, 1);

    const emptyMemPictures = await vfs.listDirectory('/Workspaces/default/Pictures');
    assert.strictEqual(emptyMemPictures.totalCount, 1);
    assert.strictEqual(emptyMemPictures.items[0].name, 'active.png');
}

run().then(() => {
    console.log('test-vfs-workspace-pictures-list: ok');
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
