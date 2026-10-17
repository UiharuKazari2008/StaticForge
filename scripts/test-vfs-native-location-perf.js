#!/usr/bin/env node
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'winston') {
        return {
            format: {
                combine: () => ({}),
                timestamp: () => ({}),
                printf: () => ({}),
                colorize: () => ({})
            },
            transports: {
                Console: function() {},
                File: function() {}
            },
            createLogger: () => ({
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {}
            })
        };
    }
    try {
        return originalLoad.apply(this, arguments);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            return {};
        }
        throw err;
    }
};

const assert = require('assert');
const { VfsManager } = require('../modules/vfsManager');

async function runTests() {
    console.log('Running VFS native location O(1) optimization test...');

    const mockWorkspaces = {
        'ws1': {
            name: 'Workspace One',
            files: ['img1.png', 'img2.png'],
            scraps: ['scrap1.png', 'scrap2.png']
        }
    };

    const mockGlobalResources = {
        getWorkspaceManager: () => ({
            getWorkspaces: () => mockWorkspaces
        }),
        getPath: () => '/tmp'
    };

    const vfsManager = new VfsManager(mockGlobalResources);

    // Test 1: Fallback without ctx pre-computed Sets
    const ctxFallback = {
        workspaceId: 'ws1',
        ws: mockWorkspaces['ws1']
    };

    const locFallbackImg = await vfsManager._resolveNativeTargetLocation('image', 'img1.png', 'ws1', ctxFallback);
    assert.strictEqual(locFallbackImg, 'Pictures', 'img1.png should resolve to Pictures without pre-computed Sets');

    const locFallbackScrap = await vfsManager._resolveNativeTargetLocation('scrap', 'scrap2.png', 'ws1', ctxFallback);
    assert.strictEqual(locFallbackScrap, 'Scraps', 'scrap2.png should resolve to Scraps without pre-computed Sets');

    const locFallbackOther = await vfsManager._resolveNativeTargetLocation('image', 'nonexistent.png', 'ws1', ctxFallback);
    assert.strictEqual(locFallbackOther, 'Workspace One', 'nonexistent.png should resolve to workspace name');

    // Test 2: With ctx pre-computed Sets
    const ctxOptimized = {
        workspaceId: 'ws1',
        ws: mockWorkspaces['ws1'],
        wsFilesSet: new Set(mockWorkspaces['ws1'].files),
        wsScrapsSet: new Set(mockWorkspaces['ws1'].scraps)
    };

    const locOptimizedImg = await vfsManager._resolveNativeTargetLocation('image', 'img1.png', 'ws1', ctxOptimized);
    assert.strictEqual(locOptimizedImg, 'Pictures', 'img1.png should resolve to Pictures with O(1) Set');

    const locOptimizedScrap = await vfsManager._resolveNativeTargetLocation('scrap', 'scrap2.png', 'ws1', ctxOptimized);
    assert.strictEqual(locOptimizedScrap, 'Scraps', 'scrap2.png should resolve to Scraps with O(1) Set');

    const locOptimizedOther = await vfsManager._resolveNativeTargetLocation('image', 'nonexistent.png', 'ws1', ctxOptimized);
    assert.strictEqual(locOptimizedOther, 'Workspace One', 'nonexistent.png should resolve to workspace name with O(1) Set');

    // Test 3: Verify _buildListMetadataContext populates wsFilesSet and wsScrapsSet
    const parsed = { workspaceId: 'ws1', type: 'workspace-home' };
    const items = [
        { isShortcut: true, targetKind: 'image', targetId: 'img1.png', workspaceId: 'ws1' }
    ];
    const builtCtx = await vfsManager._buildListMetadataContext(items, parsed);
    assert.ok(builtCtx.wsFilesSet instanceof Set, 'wsFilesSet should be created in context');
    assert.ok(builtCtx.wsScrapsSet instanceof Set, 'wsScrapsSet should be created in context');
    assert.strictEqual(builtCtx.wsFilesSet.has('img1.png'), true, 'wsFilesSet should contain img1.png');
    assert.strictEqual(builtCtx.wsScrapsSet.has('scrap1.png'), true, 'wsScrapsSet should contain scrap1.png');

    console.log('✓ All VFS native location tests passed successfully!');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
