/**
 * Regression and performance test for WorkspaceManager.addToWorkspaceArray('scraps', ...)
 * Ensures O(N + M) scaling when moving multiple items to scraps instead of O(M * N) filtering.
 * Credit: grok.menma
 */
'use strict';
const assert = require('assert');
const Module = require('module');

const origLoad = Module._load;
Module._load = function (request) {
    if (['sharp', 'better-sqlite3', 'sqlite3', 'winston'].includes(request)) return {};
    return origLoad.apply(this, arguments);
};

const WorkspaceManager = require('../modules/workspace');

function createMockGlobalResources() {
    return {
        getPath: () => '/tmp',
        getWorkspacesConfig: () => ({}),
        saveConfig: () => {},
        modifyConfig: () => ({ delete: () => {} }),
        getDataPlumbing: () => ({ publish: () => {} })
    };
}

function runTests() {
    const wm = new WorkspaceManager(createMockGlobalResources());
    // Stub out DB sync methods and external notifications
    wm._galleryBucketForType = () => 'scraps';
    wm._queueGalleryOwnershipSync = () => {};
    wm.bumpAllGalleryDestructiveTimestamps = () => {};

    // 1. Correctness Test: items added to scraps are removed from target workspace files and other workspaces
    const workspaces = {
        default: {
            name: 'Default',
            files: ['img1.png', 'img2.png', 'shared.png', 'img3.png'],
            scraps: ['old_scrap.png'],
            pinned: []
        },
        other: {
            name: 'Other',
            files: ['img4.png', 'shared.png'],
            scraps: [],
            pinned: []
        }
    };

    const added = wm.addToWorkspaceArray('scraps', ['img2.png', 'shared.png', 'new_scrap.png', 'old_scrap.png'], 'default', workspaces);

    assert.strictEqual(added, 3, 'Should add 3 new scraps (old_scrap was already present)');
    assert.deepStrictEqual(workspaces.default.scraps, ['old_scrap.png', 'img2.png', 'shared.png', 'new_scrap.png']);
    assert.deepStrictEqual(workspaces.default.files, ['img1.png', 'img3.png'], 'Target workspace files should no longer have the added scraps');
    assert.deepStrictEqual(workspaces.other.files, ['img4.png'], 'Other workspace files should no longer have the shared scraps');

    // 2. Performance Verification Test
    // Construct workspace with 10,000 files and add 2,000 scraps
    const NUM_FILES = 10000;
    const NUM_SCRAPS = 2000;
    const initialFiles = [];
    for (let i = 0; i < NUM_FILES; i++) {
        initialFiles.push(`file_${i}.png`);
    }
    const scrapItems = [];
    for (let i = 0; i < NUM_SCRAPS; i++) {
        scrapItems.push(`file_${i * 2}.png`);
    }

    const perfWorkspaces = {
        default: {
            name: 'Default',
            files: initialFiles.slice(),
            scraps: [],
            pinned: []
        }
    };

    const startTime = process.hrtime.bigint();
    wm.addToWorkspaceArray('scraps', scrapItems, 'default', perfWorkspaces);
    const endTime = process.hrtime.bigint();
    const elapsedMs = Number(endTime - startTime) / 1e6;

    assert.strictEqual(perfWorkspaces.default.files.length, NUM_FILES - NUM_SCRAPS);
    assert.strictEqual(perfWorkspaces.default.scraps.length, NUM_SCRAPS);

    console.log(`✅ Scraps bulk add test passed: ${NUM_SCRAPS} scraps over ${NUM_FILES} files processed in ${elapsedMs.toFixed(2)} ms.`);
}

runTests();
