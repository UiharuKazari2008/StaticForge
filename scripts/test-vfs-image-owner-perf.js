const assert = require('assert');
const { VfsManager } = require('../modules/vfsManager');

async function runTest() {
    console.log('Testing _findImageOwnerWorkspaceId O(1) set lookup performance, caching and correctness...');

    const mockWorkspaces = {
        'ws-1': {
            files: ['img1.png', 'img2.png'],
            scraps: ['scrap1.png'],
            pinned: ['pin1.png']
        },
        'ws-2': {
            files: ['img3.png'],
            scraps: [],
            pinned: []
        }
    };

    const mockGlobalResources = {
        getWorkspaceManager: () => ({
            getWorkspaces: () => mockWorkspaces
        })
    };

    const vfs = new VfsManager(mockGlobalResources);

    // 1. Test using ctx map
    const mockCtx = {
        imageOwnerMap: new Map([['img1.png', 'ws-1']])
    };
    assert.strictEqual(vfs._findImageOwnerWorkspaceId('img1.png', mockCtx), 'ws-1', 'Should use ctx.imageOwnerMap first');

    // 2. Test without ctx map (fallback to workspace lookup and ensure sets are lazy cached)
    assert.strictEqual(mockWorkspaces['ws-1']._filesSet, undefined, '_filesSet should not exist before call');
    assert.strictEqual(vfs._findImageOwnerWorkspaceId('img1.png'), 'ws-1', 'Should find img1.png in ws-1 files');
    assert.ok(mockWorkspaces['ws-1']._filesSet instanceof Set, '_filesSet should be lazy cached on workspace object');
    assert.strictEqual(mockWorkspaces['ws-1']._filesSet.has('img1.png'), true, '_filesSet should contain img1.png');

    assert.strictEqual(vfs._findImageOwnerWorkspaceId('scrap1.png'), 'ws-1', 'Should find scrap1.png in ws-1 scraps');
    assert.strictEqual(vfs._findImageOwnerWorkspaceId('pin1.png'), 'ws-1', 'Should find pin1.png in ws-1 pinned');
    assert.strictEqual(vfs._findImageOwnerWorkspaceId('img3.png'), 'ws-2', 'Should find img3.png in ws-2 files');
    assert.strictEqual(vfs._findImageOwnerWorkspaceId('nonexistent.png'), null, 'Should return null for missing image');

    console.log('✅ All _findImageOwnerWorkspaceId tests passed successfully.');
}

runTest().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
